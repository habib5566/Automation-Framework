"""Tools for the Web Assessor -- the shared recon toolkit.

WHAT THIS IS
------------
Unlike the single-vulnerability engines (``sqli``, ``xss``, ``ssrf`` ...), this
module is the *reconnaissance* layer every assessor reaches for first: the small
set of generic tools you run against an unfamiliar app to map its attack surface
*before* you pick a technique. It is the web analogue of a port-scanner +
content-discovery + header-audit kit. Four tools live here, each a teaching
example of one recon primitive:

``Crawler.crawl``  -- *spidering*. Breadth-first walk the app starting at ``/``,
    extracting links (``href``/``src`` attributes AND bare path tokens the demo
    app prints in plain text) with a regex, following only same-app paths, to
    enumerate the reachable endpoints. This is how you DISCOVER what exists.

``fuzz_paths``     -- *content discovery / forced browsing*. Request every entry
    in a path wordlist (real endpoints mixed with decoys) and keep the ones whose
    status is not 404 -- the unlinked admin panel, the stray ``.git/config``, the
    backup file. Finds resources the crawler never saw because nothing linked them.

``fuzz_param``     -- *parameter fuzzing*. Fire a list of payloads at one
    parameter of one endpoint and report, per payload, the status, response length
    and whether the payload was *reflected* in the body. Differences in
    status/length/reflection are the breadcrumbs that point a technique module
    (SQLi error, XSS reflection, traversal 403-vs-200) at the right input.

``analyze_headers`` -- *security-header audit*. Inspect a response's headers and
    flag MISSING defensive headers (CSP, X-Frame-Options, X-Content-Type-Options,
    HSTS, Referrer-Policy) and RISKY ones (a reflected/wildcard
    ``Access-Control-Allow-Origin``, ``Access-Control-Allow-Credentials: true``).
    This is passive: it spots whole classes of weakness from one response.

HOW IT FITS THE LAB
-------------------
These tools do not (by themselves) recover a flag -- they *find the doors* the
flag-recovering engines then walk through. A typical workflow: ``crawl`` +
``fuzz_paths`` to map endpoints, ``analyze_headers`` on each to triage, then
``fuzz_param`` to confirm an injectable input before handing the endpoint to the
matching ``assess()``.

THE FIX (for the things these tools find)
-----------------------------------------
See :data:`REMEDIATION`. The recon tools are the *attacker's* side; defensively,
ship the security headers ``analyze_headers`` looks for, do not leak unlinked
sensitive paths (``fuzz_paths``' quarry), and validate/encode every parameter
(what ``fuzz_param`` probes) so reflection and injection are impossible.
"""
from __future__ import annotations

import os
import re
from collections import deque
from typing import Dict, List, Optional, Set

from ._types import Response
from .http_client import WebClient

REMEDIATION: str = (
    "Reconnaissance tools only surface what an attacker can already see, so the "
    "defence is to give them nothing useful. (1) Security headers: send a strict "
    "Content-Security-Policy, X-Content-Type-Options: nosniff, a framing control "
    "(X-Frame-Options: DENY or CSP frame-ancestors), Strict-Transport-Security "
    "with a long max-age on HTTPS, and a privacy-preserving Referrer-Policy -- "
    "their absence is exactly what analyze_headers flags. (2) Content exposure: "
    "do not rely on a path being unlinked for its security ('security through "
    "obscurity'); forced-browsing wordlists find unlinked admin panels, .git "
    "directories, .env files and backups, so require authN/authZ on every "
    "sensitive route and keep VCS/dotfiles/backups out of the web root entirely. "
    "(3) Information leakage: return consistent 404s for things that do not exist "
    "(so fuzzers cannot distinguish 'forbidden' from 'absent'), and disable "
    "verbose errors and directory listings. (4) Input handling: validate, "
    "allow-list and context-encode every parameter so a fuzzed payload is never "
    "reflected unescaped nor reaches an interpreter -- this closes the reflection/"
    "injection that fuzz_param hunts for. (5) CORS: never reflect the Origin "
    "header and never pair a wildcard/any-origin ACAO with Allow-Credentials: "
    "true. Defence in depth: rate-limit and monitor for the burst of 404s and "
    "odd parameter values these tools generate."
)

# --- security-header policy --------------------------------------------------
#: Defensive response headers whose ABSENCE analyze_headers reports, mapped to the
#: human explanation of what each one defends against.
SECURITY_HEADERS: Dict[str, str] = {
    "Content-Security-Policy": (
        "no Content-Security-Policy -- the browser will execute any injected "
        "inline script/resource (mitigates XSS/data-injection)"
    ),
    "X-Frame-Options": (
        "no X-Frame-Options (and no CSP frame-ancestors) -- the page can be "
        "framed by any site (clickjacking)"
    ),
    "X-Content-Type-Options": (
        "no X-Content-Type-Options: nosniff -- the browser may MIME-sniff "
        "responses and run them as an unintended type"
    ),
    "Strict-Transport-Security": (
        "no Strict-Transport-Security -- connections can be downgraded to "
        "cleartext HTTP (SSL-strip / MITM)"
    ),
    "Referrer-Policy": (
        "no Referrer-Policy -- full URLs (with any sensitive query params) leak "
        "to third parties via the Referer header"
    ),
}

#: The CORS headers analyze_headers treats as RISKY when present and permissive.
_ACAO = "Access-Control-Allow-Origin"
_ACAC = "Access-Control-Allow-Credentials"

#: Regex that finds linkable paths in HTML: href/src attribute values plus bare
#: path-like tokens (the demo app prints "/search?q=" as text, not as <a href>).
_ATTR_LINK_RE = re.compile(
    r"""(?:href|src|action)\s*=\s*["']([^"'#>]+)["']""", re.IGNORECASE
)
#: Bare in-text paths like "/search?q=" or "/api/orders/<id>" -- start at a slash
#: that is NOT preceded by '<' (so HTML close tags like "</ul>" are not mistaken
#: for the path "/ul"), and run until whitespace, a quote, an angle bracket or a
#: closing paren.
_TEXT_PATH_RE = re.compile(r"(?<!<)(/[A-Za-z0-9][^\s\"'<>()]*)")


class Crawler:
    """A breadth-first web spider that maps an app's reachable endpoints.

    The crawler starts at a seed path, fetches it, extracts every link it can
    see (attribute links *and* bare path tokens, because the demo app advertises
    routes as plain text), normalises them to same-app paths, and repeats over a
    BFS frontier until it runs out of new pages or hits ``max_pages``. The result
    is the set of distinct *paths* (query strings stripped) it reached -- the
    surface the technique modules then probe.

    Only same-app links are followed: absolute ``http(s)://`` URLs to other hosts,
    ``mailto:``/``javascript:`` schemes and fragments are ignored, so the crawl
    stays on-target and on-loopback.
    """

    def __init__(self) -> None:
        #: Populated after :meth:`crawl`: every path that returned a response.
        self.visited: Set[str] = set()

    # -- link extraction -----------------------------------------------------
    @staticmethod
    def extract_links(html: str) -> Set[str]:
        """Pull candidate link targets out of an HTML body.

        Returns the raw (un-normalised) link strings found in ``href``/``src``/
        ``action`` attributes and as bare ``/path`` tokens in the text. Caller
        is responsible for normalising/filtering these to same-app paths.
        """
        links: Set[str] = set()
        for match in _ATTR_LINK_RE.findall(html):
            links.add(match)
        for match in _TEXT_PATH_RE.findall(html):
            links.add(match)
        return links

    @staticmethod
    def _normalise(link: str, base_url: str) -> Optional[str]:
        """Reduce a raw link to a same-app *path* (no query/fragment), or None.

        Drops off-host absolute URLs, non-HTTP schemes (mailto:, javascript:,
        data:), fragments and empties. Absolute URLs pointing back at ``base_url``
        are accepted and reduced to their path so the crawler does not loop on the
        host form vs. the path form of the same page.
        """
        link = link.strip()
        if not link or link.startswith("#"):
            return None
        low = link.lower()
        if low.startswith(("mailto:", "javascript:", "data:", "tel:")):
            return None
        if low.startswith(("http://", "https://")):
            if link.startswith(base_url):
                link = link[len(base_url):] or "/"
            else:
                return None  # off-host -- do not follow
        if not link.startswith("/"):
            link = "/" + link
        # Strip query string and fragment -- the crawler enumerates *paths*.
        link = link.split("#", 1)[0].split("?", 1)[0]
        # Collapse a trailing slash (except the root) so "/x" and "/x/" coalesce.
        if len(link) > 1 and link.endswith("/"):
            link = link.rstrip("/")
        return link or "/"

    # -- the spider ----------------------------------------------------------
    def crawl(
        self, client: WebClient, start: str = "/", max_pages: int = 20
    ) -> Set[str]:
        """Breadth-first walk the app from ``start``; return reached paths.

        Args:
            client:    The cookie-aware HTTP client scoped to the target.
            start:     Seed path to begin from (default the site root).
            max_pages: Safety cap on how many distinct paths to fetch.

        Returns:
            The set of same-app paths that returned a (non-404) response. A 404 is
            still *visited* (so we don't re-queue it) but excluded from the result,
            since it names nothing real.
        """
        start_path = self._normalise(start, client.base_url) or "/"
        frontier: deque[str] = deque([start_path])
        queued: Set[str] = {start_path}
        self.visited = set()
        found: Set[str] = set()

        while frontier and len(self.visited) < max_pages:
            path = frontier.popleft()
            self.visited.add(path)
            try:
                resp = client.get(path)
            except Exception:  # noqa: BLE001 - a dead link must not abort the crawl
                continue
            if resp.status == 404:
                continue
            found.add(path)
            # Only parse HTML-ish bodies for more links.
            ctype = (resp.header("Content-Type") or "").lower()
            if "html" not in ctype and "<" not in resp.body[:256]:
                continue
            for raw in self.extract_links(resp.body):
                nxt = self._normalise(raw, client.base_url)
                if nxt and nxt not in queued and len(queued) < max_pages * 4:
                    queued.add(nxt)
                    frontier.append(nxt)
        return found


# --- content discovery / forced browsing -------------------------------------
def _load_wordlist() -> List[str]:
    """Load the default path wordlist (one path per non-comment line)."""
    path = os.path.join(os.path.dirname(__file__), "data", "fuzz_paths.txt")
    words: List[str] = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                words.append(line)
    except OSError:
        # Fall back to the essentials so the fuzzer still runs without the file.
        words = ["/", "/search", "/login", "/admin", "/robots.txt"]
    return words


#: The default content-discovery wordlist (loaded once at import).
DEFAULT_WORDLIST: List[str] = _load_wordlist()


def fuzz_paths(
    client: WebClient, wordlist: Optional[List[str]] = None
) -> List[Dict[str, object]]:
    """Forced-browse a path wordlist; return the entries that are NOT 404.

    For each candidate path we issue a GET and keep it if the server returns
    something other than 404 -- a 200 (it exists and is readable), a 401/403 (it
    exists but is protected -- itself a finding), a redirect, etc. A 404 means
    "nothing here". Because a route may exist for a *different* method (the demo
    app's ``/login`` is POST-only and 404s on GET), when the GET 404s we send a
    lightweight POST probe before giving up: a non-404 POST response means the
    path is real but method-specific -- still a discovery, just not GET-reachable.
    This is how an assessor finds *unlinked* resources the crawler can never
    reach: admin panels, ``.git``, backups, POST-only API actions.

    Args:
        client:   The HTTP client scoped to the target.
        wordlist: Paths to try; defaults to :data:`DEFAULT_WORDLIST`. Leading
                  slashes are optional and normalised.

    Returns:
        A list of ``{"path", "status", "length", "method"}`` dicts, one per
        non-404 hit, in wordlist order. ``method`` is the verb that found it
        ("GET" or, for a method-specific route, "POST"); ``length`` is the
        response body size -- useful for spotting near-identical soft-404 pages.
    """
    words = wordlist if wordlist is not None else DEFAULT_WORDLIST
    hits: List[Dict[str, object]] = []
    seen: Set[str] = set()
    for raw in words:
        path = raw.strip()
        if not path:
            continue
        if not path.startswith("/"):
            path = "/" + path
        if path in seen:
            continue
        seen.add(path)
        try:
            resp = client.get(path)
            method = "GET"
            if resp.status == 404:
                # The path may be real but reachable only via another verb.
                resp = client.post(path)
                method = "POST"
        except Exception:  # noqa: BLE001 - keep fuzzing past a transport error
            continue
        if resp.status != 404:
            hits.append(
                {
                    "path": path,
                    "status": resp.status,
                    "length": len(resp.body),
                    "method": method,
                }
            )
    return hits


# --- parameter fuzzing -------------------------------------------------------
def fuzz_param(
    client: WebClient, path: str, param: str, payloads: List[str]
) -> List[Dict[str, object]]:
    """Fire each payload at one query parameter and report the response signal.

    For every payload we send ``GET {path}?{param}={payload}`` and record the
    status code, the response body length, and whether the payload was
    *reflected* verbatim in the body. The assessor reads the *deltas* across
    payloads -- a status change (e.g. a SQL error 200-with-marker, a 403 on a
    traversal escape), a length jump, or a reflection -- as the signal that the
    parameter feeds an injectable sink, then hands it to the right engine.

    Args:
        client:   The HTTP client scoped to the target.
        path:     The endpoint path (without a query string), e.g. ``/search``.
        param:    The parameter name to fuzz, e.g. ``q``.
        payloads: The payload strings to try.

    Returns:
        One ``{"payload", "status", "length", "reflected"}`` dict per payload, in
        order. ``reflected`` is True when the exact payload string appears in the
        response body (the precursor to reflected XSS / error leakage).
    """
    results: List[Dict[str, object]] = []
    for payload in payloads:
        try:
            resp = client.get(path, params={param: payload})
        except Exception:  # noqa: BLE001 - record nothing, keep going
            continue
        reflected = payload != "" and payload in resp.body
        results.append(
            {
                "payload": payload,
                "status": resp.status,
                "length": len(resp.body),
                "reflected": reflected,
            }
        )
    return results


# --- passive security-header audit -------------------------------------------
def analyze_headers(response: Response) -> List[str]:
    """Audit one response's headers; return human observations of weaknesses.

    Two checks:

    * **Missing defensive headers.** For each entry in :data:`SECURITY_HEADERS`
      that the response does not carry, emit the explanatory note. (Framing is
      satisfied by *either* ``X-Frame-Options`` or a CSP ``frame-ancestors``
      directive, so we don't double-report it.)
    * **Risky CORS headers.** A reflected/wildcard ``Access-Control-Allow-Origin``
      -- especially paired with ``Access-Control-Allow-Credentials: true`` -- is
      flagged as present-and-dangerous, because it permits cross-origin
      (credentialed) reads.

    Args:
        response: Any :class:`~weblab._types.Response` to audit.

    Returns:
        A list of human-readable observation strings (empty if the response is
        well-hardened). The list is the report an assessor pastes into findings.
    """
    observations: List[str] = []

    csp = response.header("Content-Security-Policy") or ""
    has_csp_frame_ancestors = "frame-ancestors" in csp.lower()

    for header, note in SECURITY_HEADERS.items():
        if response.header(header) is not None:
            continue
        # Framing is also satisfied by CSP frame-ancestors -- don't double-flag.
        if header == "X-Frame-Options" and has_csp_frame_ancestors:
            continue
        observations.append(f"MISSING {header}: {note}")

    # Risky CORS.
    acao = response.header(_ACAO)
    acac = (response.header(_ACAC) or "").lower()
    if acao is not None:
        if acao == "*":
            observations.append(
                f"RISKY {_ACAO}: * -- any origin may read this response "
                "cross-origin (no allow-list)"
            )
        elif acao not in ("", "null"):
            # A specific, non-wildcard ACAO that is not the app's own origin is
            # most likely a *reflected* Origin -- the credentialed-read footgun.
            observations.append(
                f"RISKY {_ACAO}: {acao!r} -- looks like a reflected Origin "
                "(server echoes the caller's Origin instead of using an "
                "allow-list)"
            )
        if acac == "true":
            observations.append(
                f"RISKY {_ACAC}: true -- combined with the above ACAO the "
                "browser will expose the CREDENTIALED response cross-origin"
            )

    return observations


__all__ = [
    "REMEDIATION",
    "SECURITY_HEADERS",
    "DEFAULT_WORDLIST",
    "Crawler",
    "fuzz_paths",
    "fuzz_param",
    "analyze_headers",
]
