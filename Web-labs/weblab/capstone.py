"""Assembling the Pieces: a full web-application assessment.

This is the WEB-200 capstone -- it runs the whole methodology against a target:
recon first (crawl + forced-browse + header hygiene), then every technique's
``assess()``, then it stitches the individual wins into one attack chain
(SQLi dumps the admin credential -> login bypass yields an admin session ->
that session enables IDOR / SSRF), and finally summarises the findings.
"""
from __future__ import annotations

from collections import Counter
from typing import Callable, Dict, List, Optional

from . import (
    command_injection,
    cors,
    csrf,
    db_enum,
    idor,
    sqli,
    ssrf,
    ssti,
    traversal,
    xss,
    xxe,
)
from ._types import Finding
from .http_client import WebClient
from .tools import Crawler, analyze_headers, fuzz_paths

#: The technique modules, in the order an assessor typically works them.
MODULES = [
    sqli, db_enum, xss, csrf, cors, traversal, xxe, ssti, ssrf,
    command_injection, idor,
]


def recon(client: WebClient) -> Dict[str, object]:
    """Map the target: crawl, forced-browse, and audit response headers."""
    crawler = Crawler()
    crawled = crawler.crawl(client)
    fuzzed = fuzz_paths(client)
    header_obs = analyze_headers(client.get("/"))
    return {
        "crawled": sorted(crawled),
        "fuzzed": [f["path"] for f in fuzzed],
        "header_observations": header_obs,
    }


def assess_all(
    client: WebClient, on_finding: Optional[Callable[[Finding], None]] = None
) -> List[Finding]:
    """Run every technique's ``assess()`` against ``client``."""
    findings: List[Finding] = []
    for module in MODULES:
        try:
            finding = module.assess(client)
        except Exception as exc:  # noqa: BLE001 - one broken probe must not abort the run
            finding = Finding(
                vuln=getattr(module, "__name__", "unknown"),
                endpoint="",
                severity="info",
                discovered=False,
                evidence=f"assessment error: {type(exc).__name__}: {exc}",
            )
        findings.append(finding)
        if on_finding:
            on_finding(finding)
    return findings


def attack_chain(client: WebClient) -> List[str]:
    """Stitch individual findings into one escalation narrative.

    Demonstrates how isolated bugs compound: a read primitive (SQLi) hands over
    the admin credential, the same flaw bypasses authentication, and the
    resulting session unlocks horizontal (IDOR) and server-side (SSRF) reach.
    """
    steps: List[str] = []

    try:
        secret = db_enum.dump_users(client).get("admin")
        if secret:
            steps.append(f"1. SQLi -> dumped admin credential/secret: {secret}")
    except Exception:  # noqa: BLE001
        pass

    try:
        ok, evidence = sqli.exploit_login_bypass(client)
        if ok:
            steps.append(f"2. SQLi auth bypass -> authenticated session ({evidence})")
    except Exception:  # noqa: BLE001
        pass

    idor_finding = idor.assess(client)
    if idor_finding.discovered:
        steps.append(f"3. Session abused for IDOR -> {idor_finding.exploit_result}")

    ssrf_finding = ssrf.assess(client)
    if ssrf_finding.discovered:
        steps.append(f"4. SSRF -> internal metadata -> {ssrf_finding.exploit_result}")

    return steps


def run_assessment(
    client: WebClient, on_finding: Optional[Callable[[Finding], None]] = None
) -> Dict[str, object]:
    """The full capstone: recon + all assessments + chain + summary."""
    reconnaissance = recon(client)
    findings = assess_all(client, on_finding=on_finding)
    confirmed = [f for f in findings if f.discovered]
    summary = {
        "techniques_run": len(findings),
        "confirmed": len(confirmed),
        "by_severity": dict(Counter(f.severity for f in confirmed)),
    }
    return {
        "recon": reconnaissance,
        "findings": findings,
        "chain": attack_chain(client),
        "summary": summary,
    }
