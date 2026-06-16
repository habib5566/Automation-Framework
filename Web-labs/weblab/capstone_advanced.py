"""Assembling the Pieces (advanced): a full WEB-300 / OSWE assessment.

This is the advanced capstone -- the white-box counterpart to :mod:`weblab.capstone`.
It runs the whole OSWE-grade methodology against the bundled demo app: a white-box
source review FIRST (the audit that, in a real engagement, points you at the sinks),
then every advanced technique's ``assess()``, then it stitches the individual wins
into one realistic attack chain across the classic kill-chain phases --

    audit  ->  recon/leak  ->  authentication bypass  ->  remote code execution
           ->  post-exploitation / exfiltration

-- and finally summarises the findings by severity. Like the WEB-200 capstone, every
dangerous effect is jailed to the sandbox / simulated shell / loopback.
"""
from __future__ import annotations

from collections import Counter
from typing import Callable, Dict, List, Optional

from . import (
    advanced_ssrf,
    advanced_ssti,
    advanced_xxe,
    blind_sqli,
    char_restriction_bypass,
    data_exfiltration,
    dom_xss,
    dotnet_deserialization,
    file_upload_bypass,
    magic_hashes,
    persistent_xss,
    php_type_juggling,
    postgresql_large_objects,
    postgresql_rce,
    prototype_pollution,
    regex_bypass,
    session_hijacking,
    source_analysis,
    udf_reverse_shell,
    weak_tokens,
    websocket_cmdi,
)
from ._types import Finding
from .http_client import WebClient

#: Every WEB-300 technique module, grouped by the kill-chain phase it serves. Each
#: module exposes the same contract: ``assess(client) -> Finding`` + ``REMEDIATION``.
PHASES: Dict[str, list] = {
    "white-box audit": [source_analysis],
    "recon / secret leak": [
        blind_sqli, data_exfiltration, advanced_xxe, advanced_ssrf,
    ],
    "authentication bypass": [
        php_type_juggling, magic_hashes, weak_tokens, session_hijacking,
        prototype_pollution, regex_bypass,
    ],
    "remote code execution": [
        file_upload_bypass, dotnet_deserialization, postgresql_rce,
        udf_reverse_shell, postgresql_large_objects, websocket_cmdi,
    ],
    "client-side / template / exfil": [
        advanced_ssti, char_restriction_bypass, dom_xss, persistent_xss,
    ],
}

#: A flat, ordered list of all 21 advanced modules (audit first, then by phase).
MODULES: List = [m for group in PHASES.values() for m in group]


def assess_all(
    client: WebClient, on_finding: Optional[Callable[[Finding], None]] = None
) -> List[Finding]:
    """Run every advanced technique's ``assess()`` against ``client``.

    One broken probe must never abort the run, so each is wrapped -- a failed
    module yields a non-discovered ``Finding`` carrying the error.
    """
    findings: List[Finding] = []
    for module in MODULES:
        try:
            finding = module.assess(client)
        except Exception as exc:  # noqa: BLE001 - isolate a broken probe
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


def _flag(finding: Finding) -> Optional[str]:
    """Best-effort: pull a recovered flag out of a finding's result/extra."""
    for source in (finding.exploit_result, finding.extra):
        if isinstance(source, dict):
            flag = source.get("flag")
            if isinstance(flag, str) and flag:
                return flag
    return None


def attack_chain(client: WebClient) -> List[str]:
    """Stitch individual advanced findings into one escalation narrative.

    Demonstrates how isolated OSWE-grade bugs compound across the kill chain: a
    white-box review surfaces the sinks; blind/OOB channels leak secrets; loose
    comparisons and predictable tokens defeat authentication; an upload / UDF /
    deserialization sink turns that access into code execution; and stored XSS
    plus OOB exfil carry data and sessions back out.
    """
    steps: List[str] = []

    audit = source_analysis.assess(client)
    if audit.discovered and isinstance(audit.extra, dict):
        total = audit.extra.get("total_findings") or audit.extra.get("total")
        steps.append(
            "1. White-box audit -> source review flagged the dangerous sinks "
            f"({total} findings) that the dynamic exploits below confirm"
        )

    leak = data_exfiltration.assess(client)
    if leak.discovered:
        secret = None
        if isinstance(leak.exploit_result, dict):
            secret = leak.exploit_result.get("extracted_secret") or _flag(leak)
        steps.append(
            f"2. Blind/OOB exfiltration -> drained a secret over no-output channels: {secret}"
        )

    for module, label in (
        (php_type_juggling, "PHP type juggling"),
        (magic_hashes, "magic-hash"),
        (weak_tokens, "predictable reset token"),
        (session_hijacking, "predictable session id"),
    ):
        finding = module.assess(client)
        if finding.discovered:
            steps.append(
                f"3. Authentication bypass ({label}) -> {_flag(finding) or 'auth bypassed'}"
            )
            break

    for module, label in (
        (file_upload_bypass, "upload filter bypass -> webshell"),
        (postgresql_rce, "PostgreSQL stacked-query"),
        (udf_reverse_shell, "PostgreSQL C-UDF"),
        (dotnet_deserialization, ".NET deserialization gadget"),
        (websocket_cmdi, "WebSocket command injection"),
    ):
        finding = module.assess(client)
        if finding.discovered:
            steps.append(
                f"4. Remote code execution ({label}) -> {_flag(finding) or 'code executed (sandboxed)'}"
            )
            break

    persist = persistent_xss.assess(client)
    if persist.discovered:
        steps.append(
            f"5. Post-exploitation (stored XSS -> admin session theft) -> {_flag(persist) or 'admin session stolen'}"
        )

    return steps


def run_assessment(
    client: WebClient, on_finding: Optional[Callable[[Finding], None]] = None
) -> Dict[str, object]:
    """The full advanced capstone: all assessments + chain + phase/severity summary."""
    findings = assess_all(client, on_finding=on_finding)
    confirmed = [f for f in findings if f.discovered]
    summary = {
        "techniques_run": len(findings),
        "confirmed": len(confirmed),
        "by_severity": dict(Counter(f.severity for f in confirmed)),
        "phases": {phase: [m.__name__.split(".")[-1] for m in mods]
                   for phase, mods in PHASES.items()},
    }
    return {
        "findings": findings,
        "chain": attack_chain(client),
        "summary": summary,
    }
