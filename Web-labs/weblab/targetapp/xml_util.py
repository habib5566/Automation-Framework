"""Shared XXE-vulnerable XML parsing (external entities enabled, sandbox-jailed).

Used by both the basic ``/xml`` endpoint (WEB-200) and the advanced OOB exfil
endpoint (WEB-300). External ``file://`` entities resolve to files inside the
temp sandbox only -- a successful XXE cannot escape to the real filesystem.
"""
from __future__ import annotations

import io
import os
from xml.sax import make_parser
from xml.sax.handler import ContentHandler, EntityResolver, feature_external_ges
from xml.sax.xmlreader import InputSource


class _Collector(ContentHandler):
    def __init__(self) -> None:
        self.text: list = []

    def characters(self, content: str) -> None:
        self.text.append(content)


class _SandboxEntityResolver(EntityResolver):
    """Resolve external ``file://`` entities, jailed to the sandbox root."""

    def __init__(self, sandbox) -> None:
        self.sandbox = sandbox

    def resolveEntity(self, publicId, systemId):  # noqa: N802 (sax naming)
        path = systemId
        if path.startswith("file://"):
            path = path[len("file://"):]
        rel = path.lstrip("/")
        full = self.sandbox.resolve_public(os.path.join("..", rel))
        source = InputSource()
        source.setByteStream(open(full, "rb"))
        return source


def parse_xxe(body: bytes, sandbox) -> str:
    """Parse ``body`` with external entities ON; return collected character data."""
    parser = make_parser()
    parser.setFeature(feature_external_ges, True)
    collector = _Collector()
    parser.setContentHandler(collector)
    parser.setEntityResolver(_SandboxEntityResolver(sandbox))
    parser.parse(io.BytesIO(body))
    return "".join(collector.text).strip()
