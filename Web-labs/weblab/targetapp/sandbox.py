"""A throwaway temp-dir filesystem for the file-touching vulnerabilities.

Directory traversal, XXE, and (simulated) command injection all read files.
To keep the lab safe we never touch the real filesystem: each demo server gets
its own temp sandbox seeded with planted "secret" files. A jail check confines
even a successful traversal to this sandbox so payloads like
``../../../../etc/passwd`` cannot escape to the real host.
"""
from __future__ import annotations

import os
import shutil
import tempfile

from . import constants


class Sandbox:
    """An isolated temp directory tree with planted decoy/secret files."""

    def __init__(self) -> None:
        self.root = tempfile.mkdtemp(prefix="weblab-sandbox-")
        self.public = os.path.join(self.root, "public")
        self._seed()

    def _seed(self) -> None:
        os.makedirs(self.public, exist_ok=True)
        os.makedirs(os.path.join(self.root, "etc"), exist_ok=True)
        os.makedirs(os.path.join(self.root, "secret"), exist_ok=True)

        self._write("public/welcome.txt", "Welcome to the demo file server.\n")
        self._write("public/readme.txt", "Public downloads live here.\n")
        # A fake /etc/passwd -- the traversal prize.
        self._write(
            "etc/passwd",
            "root:x:0:0:root:/root:/bin/bash\n"
            "www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\n"
            f"# {constants.FLAGS['traversal']}\n",
        )
        # The XXE / command-injection prize.
        self._write("secret/flag.txt", constants.FLAGS["xxe"] + "\n")
        self._write("secret/cmd_flag.txt", constants.FLAGS["command_injection"] + "\n")
        # WEB-300 RCE-proof files: each is read by a command an exploit injects
        # through a different sink (upload webshell, deserialization gadget,
        # PostgreSQL UDF / COPY TO PROGRAM / large object, WebSocket cmdi).
        self._write("secret/upload_flag.txt", constants.FLAGS["file_upload"] + "\n")
        self._write("secret/deser_flag.txt", constants.FLAGS["dotnet_deserialization"] + "\n")
        self._write("secret/pg_rce_flag.txt", constants.FLAGS["postgresql_rce"] + "\n")
        self._write("secret/udf_shell_flag.txt", constants.FLAGS["udf_reverse_shell"] + "\n")
        self._write("secret/ws_flag.txt", constants.FLAGS["websocket_cmdi"] + "\n")
        # The advanced-XXE OOB exfil prize (read via a parameter-entity channel).
        self._write("secret/oob_flag.txt", constants.FLAGS["advanced_xxe"] + "\n")

    def _write(self, relpath: str, content: str) -> None:
        path = os.path.join(self.root, relpath)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)

    def resolve_public(self, user_path: str) -> str:
        """Resolve ``user_path`` relative to the public dir (TRAVERSABLE).

        The traversal vulnerability is that ``..`` escapes ``public/``. The only
        thing we forbid is escaping the sandbox root entirely -- that jail keeps
        the real host filesystem untouchable while still letting the classic
        ``../etc/passwd`` payload succeed against the planted decoy.

        Returns the absolute path, or raises ``PermissionError`` if the request
        would escape the sandbox root.
        """
        requested = os.path.normpath(os.path.join(self.public, user_path))
        root = os.path.normpath(self.root)
        if requested != root and not requested.startswith(root + os.sep):
            raise PermissionError("path escapes the lab sandbox")
        return requested

    def path(self, relpath: str) -> str:
        return os.path.join(self.root, relpath)

    def cleanup(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)
