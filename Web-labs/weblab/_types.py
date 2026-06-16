"""Shared data types for the weblab assessment engines.

Every technique module (sqli, xss, ssrf, ...) returns the same :class:`Finding`
object, so the CLI, the capstone, and the tests can treat them uniformly -- the
web-assessment analogue of passlab's ``CrackResult``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


@dataclass
class Response:
    """A minimal HTTP response returned by :class:`weblab.http_client.WebClient`."""

    status: int
    headers: Dict[str, str]
    body: str
    url: str

    @property
    def text(self) -> str:
        return self.body

    def header(self, name: str, default: Optional[str] = None) -> Optional[str]:
        """Case-insensitive header lookup."""
        name = name.lower()
        for key, value in self.headers.items():
            if key.lower() == name:
                return value
        return default

    def json(self) -> Any:
        import json as _json

        return _json.loads(self.body)


@dataclass
class Finding:
    """The result of assessing one vulnerability class against a target.

    Attributes:
        vuln:           Human name, e.g. "SQL Injection".
        endpoint:       The vulnerable request path, e.g. "/search?q=".
        severity:       A :class:`Severity` value (stored as its string).
        discovered:     True if the weakness was confirmed present.
        evidence:       What proved it (the response marker, reflected payload).
        exploit_result: What the exploit recovered (dumped rows, a flag, a PoC).
        remediation:    How to fix it.
        payload:        The payload that worked (if any).
        extra:          Engine-specific extras.
    """

    vuln: str
    endpoint: str
    severity: str
    discovered: bool
    evidence: str = ""
    exploit_result: Any = ""
    remediation: str = ""
    payload: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        status = "VULNERABLE" if self.discovered else "not vulnerable"
        line = f"[{self.severity.upper():<8}] {self.vuln:<28} {status}  ({self.endpoint})"
        if self.discovered and self.evidence:
            line += f"\n           evidence : {self.evidence}"
        if self.discovered and self.exploit_result:
            result = self.exploit_result
            if isinstance(result, (dict, list)):
                import json as _json

                result = _json.dumps(result)[:200]
            line += f"\n           exploited: {result}"
        return line
