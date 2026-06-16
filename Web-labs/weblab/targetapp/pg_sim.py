"""A simulated PostgreSQL backend for the WEB-300 PostgreSQL demos.

It understands just enough PG-specific surface to demonstrate the OSWE
techniques, all routed through the sandbox / simulated shell so nothing touches
the real host:

* **stacked queries** (``q1; q2; q3``) -- PG allows them, which is what lets an
  injection escalate from a SELECT to DDL/command execution;
* **CREATE FUNCTION ... LANGUAGE C** then calling it -- the classic UDF -> RCE;
* **COPY ... TO/FROM PROGRAM '<cmd>'** -- direct command execution;
* **large objects** (``lo_from_bytea`` / ``lo_export`` / ``lo_import``) -- an
  arbitrary file-write primitive (drop a webshell);
* **pg_read_file('<path>')** -- arbitrary file read.

Commands run via :func:`simulate_shell`; file paths are jailed to the sandbox.
"""
from __future__ import annotations

import os
import re

from .sim_shell import simulate_shell


class PgError(Exception):
    pass


class PgSim:
    def __init__(self, sandbox) -> None:
        self.sandbox = sandbox
        self.functions = {"sys", "system"}  # builtins an attacker often defines
        self.large_objects: dict = {}
        self._next_oid = 16384

    # -- helpers -------------------------------------------------------------
    def _jail(self, path: str) -> str:
        rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(self.sandbox.root, rel))
        root = os.path.normpath(self.sandbox.root)
        if full != root and not full.startswith(root + os.sep):
            raise PgError("path escapes the lab sandbox")
        return full

    def _split(self, sql: str) -> "list[str]":
        sql = re.sub(r"--[^\n]*", "", sql)  # strip line comments
        # Split on ';' but NOT inside single-quoted strings (so a webshell body
        # containing ';' survives). PG escapes a literal quote as '' inside a string.
        statements, buf, in_str, i = [], [], False, 0
        while i < len(sql):
            ch = sql[i]
            if ch == "'":
                if in_str and i + 1 < len(sql) and sql[i + 1] == "'":
                    buf.append("''")
                    i += 2
                    continue
                in_str = not in_str
            elif ch == ";" and not in_str:
                stmt = "".join(buf).strip()
                if stmt:
                    statements.append(stmt)
                buf = []
                i += 1
                continue
            buf.append(ch)
            i += 1
        tail = "".join(buf).strip()
        if tail:
            statements.append(tail)
        return statements

    # -- execution -----------------------------------------------------------
    def execute(self, sql: str) -> dict:
        rows: list = []
        outputs: list = []
        notices: list = []
        for stmt in self._split(sql):
            self._exec_one(stmt, rows, outputs, notices)
        return {"rows": rows, "outputs": outputs, "notices": notices}

    def _exec_one(self, stmt: str, rows, outputs, notices) -> None:
        low = stmt.lower()

        # COPY ... TO/FROM PROGRAM 'cmd'  -> command execution
        prog = re.search(r"program\s+'([^']+)'", stmt, re.I)
        if "copy" in low and prog:
            out = simulate_shell(prog.group(1), self.sandbox)
            outputs.append(out)
            notices.append("COPY ... PROGRAM executed")
            return

        # CREATE [OR REPLACE] FUNCTION name(...) ... LANGUAGE C
        mf = re.search(r"create\s+(?:or\s+replace\s+)?function\s+([a-z_]\w*)", low)
        if mf and re.search(r"language\s+'?c'?", low):
            self.functions.add(mf.group(1))
            notices.append(f"function {mf.group(1)}() created (LANGUAGE C)")
            return

        # call a UDF:  SELECT name('cmd')
        call = re.search(r"select\s+([a-z_]\w*)\s*\(\s*'([^']*)'\s*\)", stmt, re.I)
        if call and call.group(1).lower() in self.functions:
            out = simulate_shell(call.group(2), self.sandbox)
            outputs.append(out)
            rows.append([out])
            return

        # large objects: lo_from_bytea(0, '<content>') -> oid
        lob = re.search(r"lo_from_bytea\s*\(\s*\d+\s*,\s*'((?:[^']|'')*)'\s*\)", stmt, re.I)
        if lob:
            oid = self._next_oid
            self._next_oid += 1
            self.large_objects[oid] = lob.group(1).replace("''", "'")
            rows.append([oid])
            notices.append(f"large object {oid} created")
            return

        # lo_export(oid, '<path>')  -> write the object to a file (file write!)
        exp = re.search(r"lo_export\s*\(\s*(\d+)\s*,\s*'([^']+)'\s*\)", stmt, re.I)
        if exp:
            oid, path = int(exp.group(1)), exp.group(2)
            content = self.large_objects.get(oid, "")
            full = self._jail(path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(content)
            notices.append(f"large object {oid} exported to {path}")
            return

        # lo_import('<path>') -> read a file into a large object
        imp = re.search(r"lo_import\s*\(\s*'([^']+)'\s*\)", stmt, re.I)
        if imp:
            with open(self._jail(imp.group(1)), "r", encoding="utf-8", errors="replace") as fh:
                content = fh.read()
            oid = self._next_oid
            self._next_oid += 1
            self.large_objects[oid] = content
            rows.append([oid])
            return

        # pg_read_file('<path>') -> arbitrary file read
        rd = re.search(r"pg_read_file\s*\(\s*'([^']+)'", stmt, re.I)
        if rd:
            with open(self._jail(rd.group(1)), "r", encoding="utf-8", errors="replace") as fh:
                content = fh.read()
            rows.append([content])
            outputs.append(content)
            return

        # a plain SELECT we don't special-case: no rows (keeps the result set
        # clean so an injected lo_from_bytea/pg_read_file row is unambiguous).
        if low.startswith("select"):
            notices.append("select executed")
            return
        notices.append("statement executed")
