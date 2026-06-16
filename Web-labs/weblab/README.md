# weblab — a self-contained web-application assessment lab

`weblab` is a hands-on lab for the WEB-200 / OSWA **and** WEB-300 / OSWE technique
sets. It ships an intentionally-vulnerable demo web app plus a tool per
vulnerability class that **discovers**, **exploits**, and **explains the fix** for
each — the full detect → exploit → remediate triad. 11 foundational modules
(WEB-200) and 21 advanced modules (WEB-300) all share one `Finding` contract.

Everything runs against the bundled demo app, which binds to **loopback only**.
No third-party systems are involved.

> ## ⚠️ ETHICS & AUTHORIZATION
>
> For **authorized web-application security education only** — the role Burp,
> sqlmap, and the OWASP testing guide play in a sanctioned assessment.
>
> - The demo app is deliberately insecure; never expose it on a public interface.
> - Every tool defaults to the local demo app. Targeting a `--url` on a
>   non-loopback host requires `--allow-remote`, which you must use only against
>   systems you **own** or have **explicit written permission** to test.
> - File reads (traversal/XXE), "command execution" (a *simulated* shell), and
>   SSRF are confined to a temp sandbox / loopback — they cannot touch the real
>   filesystem, spawn a real shell from your input, or reach the internet.

## Quick start

Runs on the Python 3.8+ standard library — no installs:

```bash
python -m weblab demo        # guided end-to-end: recon → exploit all 11 → attack chain
python -m weblab capstone    # WEB-200: recon + all 11 + attack chain + summary
python -m weblab advanced    # WEB-300: all 21 advanced techniques + OSWE attack chain
python -m weblab serve       # run the vulnerable app, browse http://127.0.0.1:8077/
```

## Commands

| Command | What it does |
|---|---|
| `python -m weblab serve` | run the vulnerable demo app standalone |
| `python -m weblab recon` | crawl + forced-browse + security-header audit |
| `python -m weblab <technique>` | run one technique (see list below) |
| `python -m weblab capstone` | WEB-200 assessment: recon + all 11 + attack chain + summary |
| `python -m weblab advanced` | WEB-300 assessment: all 21 advanced + OSWE attack chain + summary |
| `python -m weblab demo` | the guided walkthrough |

WEB-200 techniques: `sqli`, `db-enum`, `xss`, `csrf`, `cors`, `traversal`, `xxe`,
`ssti`, `ssrf`, `cmdi`, `idor`.

WEB-300 techniques: `prototype-pollution`, `advanced-ssrf`, `blind-sqli`,
`data-exfiltration`, `file-upload-bypass`, `php-type-juggling`, `magic-hashes`,
`dotnet-deserialization`, `postgresql-rce`, `udf-reverse-shell`,
`postgresql-large-objects`, `dom-xss`, `advanced-ssti`, `weak-tokens`,
`session-hijacking`, `websocket-cmdi`, `regex-bypass`, `char-restriction-bypass`,
`advanced-xxe`, `persistent-xss`, `source-analysis`.

Each defaults to the auto-spun demo app; add `--url http://127.0.0.1:8077` to
target a running `serve` instance.

## The syllabus → what each module demonstrates

| Module | Vulnerable endpoint | Exploit (recovers a planted flag) |
|---|---|---|
| `sqli` | `/search`, `/login` | error/boolean/UNION dump of `users`; auth bypass |
| `db_enum` | `/search` | enumerate tables/columns via `sqlite_master` |
| `xss` | `/greet`, `/comments` | reflected + stored; cookie-stealer PoC |
| `csrf` | `/account/email` | forged state change + auto-submit HTML PoC |
| `cors` | `/api/userinfo` | reflected-Origin + credentials → cross-origin read |
| `traversal` | `/download` | `../etc/passwd` (with encoded-bypass variants) |
| `xxe` | `/xml` | external `file://` entity reads a sandbox secret |
| `ssti` | `/render` | `{{7*7}}` → `49` → config-secret exfil (RCE sandboxed) |
| `ssrf` | `/fetch` | reach the loopback-only `/internal/metadata` |
| `command_injection` | `/ping` | `;`/`|` breakout against a **simulated** shell |
| `idor` | `/api/orders/<id>` | read another user's order (no ownership check) |
| `tools` | — | "Tools for the Web Assessor": crawler, fuzzer, header analyzer |

The `capstone` then **assembles the pieces**: SQLi dumps the admin credential →
the same flaw bypasses auth → the session enables IDOR and SSRF — one chain from
many bugs.

## Advanced (WEB-300 / OSWE) — what each module demonstrates

These 21 modules model the white-box, exploit-development half of the curriculum.
The same demo app exposes one advanced sink per technique; flags are planted in a
temp sandbox / the DB and recovered by each exploit.

| Module | Vulnerable endpoint | Exploit (recovers a planted flag) |
|---|---|---|
| `prototype_pollution` | `/api/profile/merge`, `/api/profile` | `__proto__` merge sets `isAdmin` on the shared prototype |
| `advanced_ssrf` | `/proxy` | filter bypass via decimal / IPv6 / octal / hex loopback encodings |
| `blind_sqli` | `/api/check-user` | boolean **and** time-based char-by-char extraction |
| `data_exfiltration` | `/api/check-user`, `/xxe-oob`, `/collected` | OOB chain: blind SQLi + XXE drain secrets over no-output channels |
| `file_upload_bypass` | `/upload`, `/uploads/<f>` | double-extension / null-byte / content-type bypass → stored webshell |
| `php_type_juggling` | `/php/login` | loose `==` coerces JSON `true`/`0` → auth bypass |
| `magic_hashes` | `/php/hash-login` | `0e`-prefixed md5 "magic hash" loose-equals as `0.0` |
| `dotnet_deserialization` | `/api/import` | type-discriminator gadget → RCE (sandboxed shell) |
| `postgresql_rce` | `/pg/search` | stacked queries → `COPY … TO PROGRAM` / `CREATE FUNCTION … C` |
| `udf_reverse_shell` | `/pg/search` | stacked queries → C `sys()` UDF → reverse-shell command |
| `postgresql_large_objects` | `/pg/search` | `lo_from_bytea`/`lo_export` arbitrary file write |
| `dom_xss` | `/dom` | static source→sink analysis: `location.hash` → `innerHTML` |
| `advanced_ssti` | `/tpl` | `${…}` engine leaks `config.secret` (RCE escalation blocked) |
| `weak_tokens` | `/api/password-reset[/confirm]` | predictable reset token → account takeover |
| `session_hijacking` | `/api/login-weak` | predictable session id → forge the admin session |
| `websocket_cmdi` | `/ws` (RFC 6455) | OS command injection over a real WebSocket frame |
| `regex_bypass` | `/api/redirect` | missing `$` anchor → `trusted.demo.evil.com` slips the allow-list |
| `char_restriction_bypass` | `/filter` | dot/space deny-list defeated by subscript `${data['secret']}` |
| `advanced_xxe` | `/xxe-oob`, `/collected` | blind/OOB XXE: read-here, exfil-there |
| `persistent_xss` | `/feedback`, `/collected` | stored XSS fires in a simulated admin bot → session theft |
| `source_analysis` | *(white-box)* | regex SAST over planted `sample.{py,php,js}` (source→sink) |

The `advanced` capstone **assembles the pieces** across the kill chain: a
white-box source review surfaces the sinks → blind/OOB channels leak secrets →
loose comparisons and predictable tokens defeat authentication → an upload / UDF /
deserialization sink yields code execution → stored XSS + OOB exfil carry data and
the admin session back out.

## Architecture

```
weblab/
  _types.py          Finding / Severity / Response (shared contract)
  http_client.py     WebClient (urllib, cookie jar) + loopback authorization guard
  tools.py           Crawler, fuzz_paths/fuzz_param, analyze_headers
  sqli.py db_enum.py xss.py csrf.py cors.py traversal.py
  xxe.py  ssti.py    ssrf.py command_injection.py idor.py   # WEB-200: assess(client) -> Finding
  prototype_pollution.py advanced_ssrf.py blind_sqli.py data_exfiltration.py
  file_upload_bypass.py php_type_juggling.py magic_hashes.py dotnet_deserialization.py
  postgresql_rce.py udf_reverse_shell.py postgresql_large_objects.py dom_xss.py
  advanced_ssti.py weak_tokens.py session_hijacking.py websocket_cmdi.py
  regex_bypass.py char_restriction_bypass.py advanced_xxe.py persistent_xss.py
  source_analysis.py                                        # WEB-300: same Finding contract
  capstone.py          recon + run_assessment + attack_chain (WEB-200)
  capstone_advanced.py all 21 advanced assess() + kill-chain attack_chain (WEB-300)
  cli.py / __main__.py
  targetapp/         the vulnerable demo app = the locked contract
    app.py server.py db.py sandbox.py constants.py ssti_engine.py sim_shell.py
    advanced_routes.py   the 21 WEB-300 sinks (dispatched from app.py)
    pg_sim.py            stacked-query PostgreSQL simulator (RCE / large objects)
    ws_server.py         minimal RFC 6455 WebSocket (handshake + frame codec)
    php_compat.py        faithful PHP loose-`==` + md5 magic-hash semantics
    weak_random.py       predictable token / session generators
    deserialize_sim.py   .NET-style gadget deserializer    xml_util.py  XXE parser
  data/              payload lists + vulnerable_samples/ (sample.py/php/js for SAST)
```

Every technique module returns the same `Finding` (`vuln`, `endpoint`,
`severity`, `discovered`, `evidence`, `exploit_result`, `remediation`, …), so the
CLI and capstone treat them uniformly. The demo app is stdlib-only
(`http.server` + `sqlite3`) and exposes exactly one injectable surface per class.

## Safety by design

- The vulnerable app refuses to bind any non-loopback host.
- `WebClient` refuses non-loopback URLs unless `allow_remote=True`.
- **Directory traversal / XXE** are jailed to a temp sandbox: `../etc/passwd`
  hits a *planted decoy*; escaping the sandbox root returns `403`.
- **Command injection** runs against a *simulated* shell interpreter — attacker
  input never reaches a real `os.system`, yet the `;`/`|`/`&&` breakout mechanics
  are genuine and observable.
- **SSTI** uses an `ast`-vetted evaluator: `{{7*7}}` computes and `{{config.secret}}`
  leaks, but the classic `{{''.__class__…}}` RCE escalation is recognised and
  blocked instead of executing.
- **SSRF** `/fetch` and the advanced `/proxy` filter-bypass are jailed to loopback
  (the internal-service / metadata case) — no external host is ever contacted.
- **PostgreSQL RCE / UDF / large objects** run against a *simulated* PG engine:
  `COPY … TO PROGRAM`, `CREATE FUNCTION … C`, and `lo_export` exercise the real
  stacked-query mechanics but route through the simulated shell / sandbox jail.
- **Deserialization** dispatches gadget *types* to the simulated shell, never a
  real `pickle`/`BinaryFormatter`; **WebSocket cmdi** is a real RFC 6455 frame but
  the injected command hits the same simulated shell.
- **Source analysis** is pure static regex matching over bundled sample files — it
  executes nothing.

## Tests

```bash
python -m pytest tests/test_web_*.py -q   # 361 tests (WEB-200 + WEB-300)
```

Each technique test spins the demo app on an ephemeral port, asserts its detector
fires and its exploit recovers the planted flag, and checks the safety jails. The
two capstone tests confirm all 11 (WEB-200) and all 21 (WEB-300) classes are found
and that each attack chain assembles end-to-end.
