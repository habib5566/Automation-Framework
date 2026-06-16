"""weblab command-line interface.

    python -m weblab serve                 # run the vulnerable demo app (loopback)
    python -m weblab recon                 # crawl + forced-browse + header audit
    python -m weblab sqli                  # run one technique against the demo app
    python -m weblab xss --url http://127.0.0.1:8077   # ...or your own instance
    python -m weblab capstone              # full assessment (recon + all 11 + chain)
    python -m weblab demo                  # guided end-to-end walkthrough

By default every command spins the bundled demo app on an ephemeral loopback
port, attacks it, and tears it down. Pass --url to target a running instance;
non-loopback URLs require --allow-remote (authorized testing only).
"""
from __future__ import annotations

import argparse
import sys
from typing import Callable, List, Optional, Tuple

from . import (
    AUTHORIZATION_BANNER,
    __version__,
    advanced_ssrf,
    advanced_ssti,
    advanced_xxe,
    blind_sqli,
    char_restriction_bypass,
    command_injection,
    cors,
    csrf,
    data_exfiltration,
    db_enum,
    dom_xss,
    dotnet_deserialization,
    file_upload_bypass,
    idor,
    magic_hashes,
    persistent_xss,
    php_type_juggling,
    postgresql_large_objects,
    postgresql_rce,
    prototype_pollution,
    regex_bypass,
    session_hijacking,
    source_analysis,
    sqli,
    ssrf,
    ssti,
    traversal,
    udf_reverse_shell,
    weak_tokens,
    websocket_cmdi,
    xss,
    xxe,
)
from .capstone import recon, run_assessment
from .capstone_advanced import run_assessment as run_advanced_assessment
from .http_client import WebClient
from .targetapp import run_server

#: WEB-200 CLI technique name -> module (each exposes assess(client) + REMEDIATION).
TECHNIQUES = {
    "sqli": sqli,
    "db-enum": db_enum,
    "xss": xss,
    "csrf": csrf,
    "cors": cors,
    "traversal": traversal,
    "xxe": xxe,
    "ssti": ssti,
    "ssrf": ssrf,
    "cmdi": command_injection,
    "idor": idor,
}

#: WEB-300 / OSWE advanced technique name -> module (same assess() contract).
ADVANCED_TECHNIQUES = {
    "prototype-pollution": prototype_pollution,
    "advanced-ssrf": advanced_ssrf,
    "blind-sqli": blind_sqli,
    "data-exfiltration": data_exfiltration,
    "file-upload-bypass": file_upload_bypass,
    "php-type-juggling": php_type_juggling,
    "magic-hashes": magic_hashes,
    "dotnet-deserialization": dotnet_deserialization,
    "postgresql-rce": postgresql_rce,
    "udf-reverse-shell": udf_reverse_shell,
    "postgresql-large-objects": postgresql_large_objects,
    "dom-xss": dom_xss,
    "advanced-ssti": advanced_ssti,
    "weak-tokens": weak_tokens,
    "session-hijacking": session_hijacking,
    "websocket-cmdi": websocket_cmdi,
    "regex-bypass": regex_bypass,
    "char-restriction-bypass": char_restriction_bypass,
    "advanced-xxe": advanced_xxe,
    "persistent-xss": persistent_xss,
    "source-analysis": source_analysis,
}


def _hr(char: str = "-", width: int = 72) -> str:
    return char * width


def _section(title: str) -> None:
    print(f"\n{_hr('=')}\n{title}\n{_hr('=')}")


def _client(args) -> Tuple[WebClient, Callable[[], None]]:
    """Resolve a target: a user-supplied --url, or the auto-spun demo app."""
    if getattr(args, "url", None):
        return WebClient(args.url, allow_remote=getattr(args, "allow_remote", False)), (
            lambda: None
        )
    httpd, _thread, base = run_server()
    print(f"  (spun up vulnerable demo app at {base})")
    return WebClient(base), httpd.shutdown


def _print_finding(finding) -> None:
    print(finding)
    if finding.discovered and finding.remediation:
        print(f"           fix      : {finding.remediation}")


# --------------------------------------------------------------------------- #
def cmd_technique(args) -> int:
    module = TECHNIQUES.get(args.command) or ADVANCED_TECHNIQUES[args.command]
    client, cleanup = _client(args)
    try:
        finding = module.assess(client)
        _section(f"{finding.vuln}")
        _print_finding(finding)
        return 0 if finding.discovered else 1
    finally:
        cleanup()


def cmd_recon(args) -> int:
    client, cleanup = _client(args)
    try:
        _section("Reconnaissance")
        report = recon(client)
        print(f"  crawled paths     : {', '.join(report['crawled'])}")
        print(f"  forced-browse hits: {', '.join(report['fuzzed'])}")
        print("  header hygiene    :")
        for obs in report["header_observations"]:
            print(f"    - {obs}")
        return 0
    finally:
        cleanup()


def cmd_capstone(args) -> int:
    client, cleanup = _client(args)
    try:
        _section("Assembling the Pieces: full web application assessment")
        report = run_assessment(client, on_finding=lambda f: _print_finding(f))
        _print_chain_and_summary(report)
        return 0
    finally:
        cleanup()


def cmd_advanced(args) -> int:
    client, cleanup = _client(args)
    try:
        _section("Assembling the Pieces (advanced): full WEB-300 / OSWE assessment")
        report = run_advanced_assessment(client, on_finding=lambda f: _print_finding(f))
        _print_chain_and_summary(report)
        return 0
    finally:
        cleanup()


def cmd_demo(args) -> int:
    print(AUTHORIZATION_BANNER)
    client, cleanup = _client(args)
    try:
        _section("1. Recon")
        rec = recon(client)
        print(f"  endpoints found   : {', '.join(rec['crawled'])}")
        print(f"  header weaknesses : {len(rec['header_observations'])} observation(s)")

        _section("2. Run every technique (detect -> exploit)")
        report = run_assessment(client, on_finding=lambda f: _print_finding(f))

        _print_chain_and_summary(report)
        return 0
    finally:
        cleanup()


def _print_chain_and_summary(report) -> None:
    _section("Attack chain (assembling the pieces)")
    if report["chain"]:
        for step in report["chain"]:
            print(f"  {step}")
    else:
        print("  (no chain assembled)")

    _section("Summary")
    s = report["summary"]
    print(f"  techniques run : {s['techniques_run']}")
    print(f"  confirmed vulns: {s['confirmed']}")
    for sev, count in sorted(s["by_severity"].items()):
        print(f"    {sev:<10}: {count}")
    print("\nTakeaway: input validation, output encoding, parameterised queries, "
          "allow-lists, anti-CSRF tokens, and least privilege close these in turn.")


def cmd_serve(args) -> int:
    httpd, thread, base = run_server(host=args.host, port=args.port)
    print(AUTHORIZATION_BANNER)
    print(f"\nVulnerable demo app at {base}  (see {base}/ for the endpoint list)")
    print("Ctrl-C to stop.")
    try:
        thread.join()
    except KeyboardInterrupt:
        print("\nstopping...")
        httpd.shutdown()
    return 0


# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="weblab",
        description="Self-contained web-application security assessment lab. "
        "Authorized education only; ships a loopback-only vulnerable demo app.",
    )
    parser.add_argument("--version", action="version", version=f"weblab {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_target(p: argparse.ArgumentParser) -> None:
        p.add_argument("--url", default=None,
                       help="target a running instance instead of the demo app")
        p.add_argument("--allow-remote", action="store_true",
                       help="permit non-loopback URLs (authorized testing ONLY)")

    for name in TECHNIQUES:
        p = sub.add_parser(name, help=f"[WEB-200] assess {name} against the target")
        add_target(p)
        p.set_defaults(func=cmd_technique)

    for name in ADVANCED_TECHNIQUES:
        p = sub.add_parser(name, help=f"[WEB-300] assess {name} against the target")
        add_target(p)
        p.set_defaults(func=cmd_technique)

    p = sub.add_parser("recon", help="crawl, forced-browse, audit headers")
    add_target(p)
    p.set_defaults(func=cmd_recon)

    p = sub.add_parser("capstone", help="full assessment: recon + all 11 + chain")
    add_target(p)
    p.set_defaults(func=cmd_capstone)

    p = sub.add_parser("advanced",
                       help="full WEB-300/OSWE assessment: all 21 advanced + chain")
    add_target(p)
    p.set_defaults(func=cmd_advanced)

    p = sub.add_parser("demo", help="guided end-to-end walkthrough")
    add_target(p)
    p.set_defaults(func=cmd_demo)

    p = sub.add_parser("serve", help="run the vulnerable demo app standalone")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8077)
    p.set_defaults(func=cmd_serve)

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except PermissionError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
