"""Run the vulnerable demo app on a loopback socket."""
from __future__ import annotations

import argparse
import threading
from http.server import ThreadingHTTPServer
from typing import Optional, Tuple

from .app import VulnState, make_handler
from .db import build_db
from .sandbox import Sandbox


class DemoServer(ThreadingHTTPServer):
    """ThreadingHTTPServer that also owns the sandbox/db lifecycle."""

    daemon_threads = True

    def __init__(self, addr, handler, state: VulnState):
        super().__init__(addr, handler)
        self.state = state

    def shutdown(self) -> None:  # noqa: D401
        super().shutdown()
        self.state.sandbox.cleanup()


def run_server(
    host: str = "127.0.0.1", port: int = 0
) -> Tuple[DemoServer, threading.Thread, str]:
    """Start the demo app on a background daemon thread.

    Returns ``(server, thread, base_url)``. ``port=0`` picks a free port. Call
    ``server.shutdown()`` to stop it (also cleans the temp sandbox).
    """
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise PermissionError(
            "the vulnerable demo app must bind loopback only; refusing host "
            f"{host!r}"
        )
    state = VulnState(build_db(), Sandbox())
    httpd = DemoServer((host, port), make_handler(state), state)
    actual_port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://{host}:{actual_port}"
    return httpd, thread, base_url


def _main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the weblab vulnerable demo app (loopback only)."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8077)
    args = parser.parse_args(argv)
    httpd, thread, base_url = run_server(args.host, args.port)
    print(f"weblab demo app listening at {base_url} (Ctrl-C to stop)")
    try:
        thread.join()
    except KeyboardInterrupt:
        print("\nstopping...")
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
