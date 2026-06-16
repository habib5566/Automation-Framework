"""weblab -- a self-contained web-application security assessment lab.

Covers the WEB-200 / OSWA technique set (SQLi, XSS, CSRF, CORS, traversal, XXE,
SSTI, SSRF, command injection, IDOR, database enumeration) as a detect -> exploit
-> remediate triad, run against a bundled, intentionally-vulnerable demo app that
binds to LOOPBACK ONLY. See the README's ETHICS section before use.

Attack submodules import directly (``import weblab.sqli``) so the core stays
importable while engines are developed.
"""
from __future__ import annotations

__version__ = "1.0.0"

from ._types import Finding, Response, Severity  # noqa: F401
from .http_client import WebClient, assert_authorized, host_is_loopback  # noqa: F401

AUTHORIZATION_BANNER = (
    "weblab is for AUTHORIZED web-application security education only.\n"
    "It ships a deliberately-vulnerable demo app that binds to loopback. Do not\n"
    "point any tool at a system you do not own or lack written permission to test."
)

__all__ = [
    "__version__",
    "Finding",
    "Response",
    "Severity",
    "WebClient",
    "assert_authorized",
    "host_is_loopback",
    "AUTHORIZATION_BANNER",
]
