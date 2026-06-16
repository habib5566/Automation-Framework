"""A *simulated* shell for the command-injection demo.

The vulnerable ``/ping`` endpoint builds ``ping -c1 <host>`` from user input.
A real lab would hand that to ``os.system`` -- but then attacker-controlled
input would run on the host. Instead we feed it to this interpreter, which
honours the shell metacharacters (``;`` ``|`` ``&&`` ``||`` ``` `` ``` ``$()``)
that an injection relies on, then "runs" each resulting command against a tiny
virtual command set. The injection mechanics are real and observable; no real
process is ever spawned from user input.
"""
from __future__ import annotations

import os
import re

from .sandbox import Sandbox

# Split on the metacharacters that chain/break out of the intended command.
_SPLIT_RE = re.compile(r"&&|\|\||[;\n|`]|\$\(|\)")


def _virtual(cmd: str, sandbox: Sandbox) -> str:
    cmd = cmd.strip()
    if not cmd:
        return ""
    parts = cmd.split()
    prog, args = parts[0], parts[1:]

    if prog == "ping":
        host = args[-1] if args else "localhost"
        return (
            f"PING {host}: 56 data bytes\n"
            f"64 bytes from {host}: icmp_seq=0 ttl=64 time=0.043 ms\n"
            "--- ping statistics ---\n1 packets transmitted, 1 received, 0% loss"
        )
    if prog == "id":
        return "uid=33(www-data) gid=33(www-data) groups=33(www-data)"
    if prog == "whoami":
        return "www-data"
    if prog == "uname":
        return "Linux demo-host 5.15.0 #1 SMP x86_64 GNU/Linux"
    if prog == "pwd":
        return "/var/www/app"
    if prog in ("ls", "dir"):
        target = args[-1] if args else ""
        base = _resolve(sandbox, target) if target else sandbox.root
        try:
            return "  ".join(sorted(os.listdir(base)))
        except OSError:
            return f"ls: cannot access '{target}': No such file or directory"
    if prog == "cat":
        if not args:
            return "cat: missing operand"
        path = _resolve(sandbox, args[-1])
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                return fh.read().rstrip("\n")
        except OSError:
            return f"cat: {args[-1]}: No such file or directory"
    if prog == "echo":
        return " ".join(args)
    return f"sh: {prog}: command not found"


def _resolve(sandbox: Sandbox, path: str) -> str:
    """Jail any path the simulated shell reads to the sandbox root."""
    rel = path.lstrip("/")  # absolute paths are treated as sandbox-relative
    full = os.path.normpath(os.path.join(sandbox.root, rel))
    root = os.path.normpath(sandbox.root)
    if full != root and not full.startswith(root + os.sep):
        return root
    return full


def simulate_shell(command: str, sandbox: Sandbox) -> str:
    """Run ``command`` through the simulated shell and return combined output."""
    segments = _SPLIT_RE.split(command)
    outputs = [_virtual(seg, sandbox) for seg in segments]
    return "\n".join(o for o in outputs if o)
