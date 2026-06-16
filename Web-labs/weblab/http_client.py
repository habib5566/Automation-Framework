"""The shared HTTP client every weblab tool uses -- "Tools for the Web Assessor".

A thin urllib wrapper that keeps a cookie jar (so a tool can log in and stay
authenticated), exposes ``get``/``post``, and -- crucially -- enforces the same
loopback authorization guard passlab uses: it refuses to send traffic to a
non-loopback host unless ``allow_remote=True`` is set explicitly, which you must
only do against systems you are authorised to test.
"""
from __future__ import annotations

import http.cookiejar
import ipaddress
import json as _json
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Optional

from ._types import Response

_LOOPBACK_NAMES = {"localhost", "localhost.localdomain", "ip6-localhost"}


def host_is_loopback(host: str) -> bool:
    if not host:
        return False
    if host.lower() in _LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def assert_authorized(url: str, allow_remote: bool) -> None:
    """Raise PermissionError if ``url`` is non-loopback and not explicitly allowed."""
    host = urllib.parse.urlparse(url).hostname or ""
    if host_is_loopback(host) or allow_remote:
        return
    raise PermissionError(
        f"Refusing to send requests to non-loopback host {host!r}. "
        "Set allow_remote=True only for a system you OWN or have explicit "
        "WRITTEN AUTHORIZATION to test."
    )


class WebClient:
    """A cookie-aware HTTP client scoped to a base URL."""

    def __init__(
        self, base_url: str, *, allow_remote: bool = False, timeout: float = 10.0
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.allow_remote = allow_remote
        self.timeout = timeout
        assert_authorized(self.base_url, allow_remote)
        self.cookies = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )

    # -- url handling --------------------------------------------------------
    def url_for(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            return path
        return self.base_url + path

    # -- requests ------------------------------------------------------------
    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, str]] = None,
        data: Optional[Dict[str, str]] = None,
        body: Optional[bytes] = None,
        json: Optional[object] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Response:
        url = self.url_for(path)
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        assert_authorized(url, self.allow_remote)

        send_headers = dict(headers or {})
        payload: Optional[bytes] = None
        if json is not None:
            payload = _json.dumps(json).encode()
            send_headers.setdefault("Content-Type", "application/json")
        elif data is not None:
            payload = urllib.parse.urlencode(data).encode()
            send_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        elif body is not None:
            payload = body

        req = urllib.request.Request(
            url, data=payload, headers=send_headers, method=method.upper()
        )
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8", "replace")
                return Response(resp.status, dict(resp.headers), raw, url)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")
            return Response(exc.code, dict(exc.headers), raw, url)

    def get(self, path: str, **kw) -> Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw) -> Response:
        return self.request("POST", path, **kw)

    def ws_send(self, path: str, message: dict) -> dict:
        """Open a WebSocket to ``path``, send one JSON message, return the reply.

        A minimal RFC 6455 client: HTTP Upgrade handshake, one masked text frame
        out, one frame back. Used by the WebSocket command-injection module.
        """
        import base64
        import os
        import socket

        from .targetapp import ws_server

        assert_authorized(self.base_url, self.allow_remote)
        parsed = urllib.parse.urlparse(self.base_url)
        host, port = parsed.hostname, parsed.port or 80
        sock = socket.create_connection((host, port), timeout=self.timeout)
        try:
            key = base64.b64encode(os.urandom(16)).decode()
            handshake = (
                f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            )
            sock.sendall(handshake.encode())
            rfile = sock.makefile("rb")
            while True:  # consume the handshake response headers
                line = rfile.readline()
                if line in (b"\r\n", b"\n", b""):
                    break
            sock.sendall(
                ws_server.encode_masked_text_frame(_json.dumps(message), os.urandom(4))
            )
            frame = ws_server.read_frame(rfile)
            if not frame:
                return {}
            try:
                return _json.loads(frame[1].decode("utf-8", "replace"))
            except _json.JSONDecodeError:
                return {"raw": frame[1].decode("utf-8", "replace")}
        finally:
            sock.close()

    def set_cookie(self, name: str, value: str) -> None:
        """Plant a cookie (e.g. simulate the victim's session) for this client."""
        host = urllib.parse.urlparse(self.base_url).hostname or "127.0.0.1"
        cookie = http.cookiejar.Cookie(
            version=0, name=name, value=value, port=None, port_specified=False,
            domain=host, domain_specified=True, domain_initial_dot=False,
            path="/", path_specified=True, secure=False, expires=None,
            discard=True, comment=None, comment_url=None, rest={},
        )
        self.cookies.set_cookie(cookie)
