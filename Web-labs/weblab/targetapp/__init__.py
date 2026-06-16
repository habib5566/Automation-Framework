"""The intentionally-vulnerable demo web app that weblab attacks.

Loopback-only by construction. Import :func:`run_server` to start it.
"""
from .server import DemoServer, run_server  # noqa: F401

__all__ = ["run_server", "DemoServer"]
