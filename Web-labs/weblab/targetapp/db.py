"""Seeded in-memory SQLite database for the vulnerable demo app.

A single shared connection (``check_same_thread=False``) backs the whole app so
that stored state -- changed emails, posted comments -- persists across the demo
server's worker threads.
"""
from __future__ import annotations

import sqlite3
import time

from . import constants


def build_db() -> sqlite3.Connection:
    """Create and seed a fresh in-memory database."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # A user-defined sleep() so the blind-SQLi demo can show time-based
    # extraction (capped so a test can never hang the suite).
    conn.create_function("sleep", 1, lambda s: time.sleep(min(float(s), 0.2)) or 0)
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT,
            password TEXT,
            email TEXT,
            role TEXT,
            secret TEXT
        );
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            item TEXT,
            total REAL,
            private_note TEXT
        );
        CREATE TABLE comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author TEXT,
            body TEXT
        );
        CREATE TABLE app_secrets (
            name TEXT PRIMARY KEY,
            value TEXT
        );
        """
    )
    cur.executemany(
        "INSERT INTO app_secrets (name, value) VALUES (?, ?)",
        list(constants.APP_SECRETS.items()),
    )
    cur.executemany(
        "INSERT INTO users (id, username, password, email, role, secret) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        constants.USERS,
    )
    cur.executemany(
        "INSERT INTO orders (id, user_id, item, total, private_note) "
        "VALUES (?, ?, ?, ?, ?)",
        constants.ORDERS,
    )
    cur.execute(
        "INSERT INTO comments (author, body) VALUES (?, ?)",
        ("system", "Welcome to the demo store! Leave a comment below."),
    )
    conn.commit()
    return conn
