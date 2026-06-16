"""Deliberately predictable token / session-id generation.

The flaw OSWE teaches: tokens derived from a low-entropy, *recoverable* scheme
instead of a CSPRNG. Here a password-reset token and a session id are each just
``md5("<prefix>:<sequential-counter>")`` -- no secret, no real randomness -- so
an attacker who learns the scheme (e.g. from source code) and one reference
number can predict any other user's token/session and take over the account.

Everything is deterministic so the weak-token and session-hijacking modules can
reproduce it exactly.
"""
from __future__ import annotations

import hashlib


def token_for(counter: int) -> str:
    """The predictable password-reset token for a sequence number."""
    return hashlib.md5(f"reset-token:{counter}".encode()).hexdigest()


def session_for(counter: int) -> str:
    """The predictable session id for a sequence number."""
    return hashlib.md5(f"session:{counter}".encode()).hexdigest()


class WeakTokenIssuer:
    """Hands out sequential password-reset tokens (counter increments by 1)."""

    def __init__(self, start: int = 1000) -> None:
        self.counter = start
        self.issued: dict = {}  # username -> (counter, token)

    def issue(self, username: str) -> "tuple[int, str]":
        self.counter += 1
        token = token_for(self.counter)
        self.issued[username] = (self.counter, token)
        return self.counter, token

    def valid_for(self, username: str, token: str) -> bool:
        record = self.issued.get(username)
        return bool(record) and record[1] == token
