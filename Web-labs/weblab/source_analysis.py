r"""White-box source-code analysis (SAST): scanning source for source->sink bugs.

WHAT IT IS
----------
This module is the lab's WEB-300/OSWE **white-box** companion to the dynamic,
black-box modules (``sqli``, ``command injection``, ``deserialization`` ...).
Where those send HTTP requests at a *running* target and watch what comes back,
this one needs **no server at all**: it reads source *text* and flags the
dangerous patterns a code auditor looks for first -- a tainted **source** (user
input: ``$_GET``, ``req.query``, a function argument) flowing into a dangerous
**sink** (``cursor.execute``, ``exec``, ``unserialize``, ``innerHTML`` ...).

The lab ships three deliberately-vulnerable sample files in
:data:`SAMPLES_DIR` -- ``sample.py`` / ``sample.php`` / ``sample.js`` -- each
seeded with several well-known, clearly-commented weaknesses. The analyzer
scans them (and any source you hand it) and reports each finding with file,
line number, the matched code, vulnerability class, severity, a CWE id, and a
one-line remediation.

HOW WE DISCOVER IT
------------------
Pattern-based, line-by-line **regex** matching, grouped by language (``py`` /
``php`` / ``js``, plus ``any`` rules that apply everywhere). Each rule
(:class:`Rule`) pairs a compiled regex for a source->sink shape -- e.g.
``cursor.execute(f"... {x} ...")`` (an f-string SQL build) or ``exec(... +
req.query``  -- with a severity, a CWE, and a fix.

Be honest about the technique's limits: **regex SAST has false positives and
false negatives.** It cannot follow data flow, so it cannot tell a tainted
argument from a constant, and it misses bugs split across lines or hidden behind
indirection. Real engagements escalate to **AST / data-flow / taint analysis**
(CodeQL, Semgrep, Bandit, language compilers) which model the program
structurally and track taint from source to sink. Regex matching is the fast
first pass that tells you *where to look*; it is not proof of exploitability.
That is why this module's rules are tuned to fire on the *concatenation /
interpolation of input into a sink* (the smell), and the lab's NEGATIVE tests
prove they stay quiet on the safe forms (parameterised queries, ``subprocess``
list-args, ``textContent``).

HOW WE EXPLOIT IT
-----------------
In OSWE the static finding is the *map* to the dynamic exploit -- each class
here is the SAME bug one of the running-target modules then weaponises:

* A concatenated/interpolated-SQL finding is exactly the bug
  :mod:`weblab.sqli` / :mod:`weblab.blind_sqli` exploit against the live app.
* A ``system()``/``exec()``/``child_process.exec`` on input finding is what
  the command-injection modules turn into RCE.
* A ``pickle.loads`` / ``unserialize`` / .NET-deserialize finding is what
  :mod:`weblab.dotnet_deserialization` (and friends) drive to code execution.
* ``echo $_GET`` / ``res.send`` / ``innerHTML`` of input is the reflected/DOM
  XSS that :mod:`weblab.dom_xss` confirms in the served script.
* A loose ``==`` on a hash is the magic-hash bypass :mod:`weblab.magic_hashes`
  proves dynamically.

So the audit output is the to-do list: read source -> find the sink -> confirm
the source reaches it -> hand it to the matching dynamic module for a PoC.

THE FIX
-------
See :data:`REMEDIATION`. In one line: never build a sink's argument by
concatenating/interpolating untrusted input -- use parameterised queries,
argument-vector (no-shell) process calls, safe deserialisers / allow-lists,
output encoding for HTML, and a salted slow password hash; keep secrets out of
source; and back the regex pass with AST/data-flow tooling in CI.
"""
from __future__ import annotations

import os
from typing import Dict, List, NamedTuple, Optional, Pattern as RePattern

import re

from ._types import Finding, Severity

# ---------------------------------------------------------------------------
# Where the bundled vulnerable samples live -- resolved relative to THIS file
# so the analyzer works regardless of the current working directory.
# ---------------------------------------------------------------------------
SAMPLES_DIR: str = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "data", "vulnerable_samples"
)

#: The three bundled sample files, by language code.
SAMPLE_FILES: Dict[str, str] = {
    "py": os.path.join(SAMPLES_DIR, "sample.py"),
    "php": os.path.join(SAMPLES_DIR, "sample.php"),
    "js": os.path.join(SAMPLES_DIR, "sample.js"),
}

#: Map file extension -> language code understood by the rules.
_EXT_LANG: Dict[str, str] = {
    ".py": "py",
    ".php": "php",
    ".js": "js",
    ".mjs": "js",
    ".jsx": "js",
    ".ts": "js",
    ".tsx": "js",
}


class Rule(NamedTuple):
    """One source->sink detection rule.

    Attributes:
        id:          stable short identifier, e.g. ``"py-sql-fstring"``.
        name:        the vulnerability class, e.g. ``"SQL Injection"``.
        regex:       compiled pattern matched against each source line.
        severity:    a :class:`Severity` *string value* ("critical".."low").
        language:    "py" / "php" / "js" / "any" -- which files it applies to.
        remediation: one-line fix guidance.
        cwe:         the relevant CWE id, e.g. ``"CWE-89"``.
    """

    id: str
    name: str
    regex: RePattern
    severity: str
    language: str
    remediation: str
    cwe: str


def _rx(pattern: str) -> RePattern:
    return re.compile(pattern)


# ---------------------------------------------------------------------------
# The rules. Tuned to fire on the *interpolation/concatenation of input into a
# sink* (the smell) and to stay quiet on the safe forms (parameterised queries,
# list-arg subprocess, textContent) -- see the negative tests.
# ---------------------------------------------------------------------------
RULES: List[Rule] = [
    # --- Python --------------------------------------------------------------
    Rule(
        "py-sql-fstring",
        "SQL Injection",
        _rx(r"""\.execute\s*\(\s*f["'].*\{.*\}.*["']"""),
        Severity.CRITICAL.value,
        "py",
        "Use parameterised queries: cursor.execute(sql, (params,)); never f-string SQL.",
        "CWE-89",
    ),
    Rule(
        "py-sql-concat",
        "SQL Injection",
        _rx(r"""\.execute\s*\(\s*["'].*["']\s*(?:%|\+)"""),
        Severity.CRITICAL.value,
        "py",
        "Use parameterised queries: cursor.execute(sql, params); never % or + into SQL.",
        "CWE-89",
    ),
    Rule(
        "py-shell-true",
        "Command Injection",
        _rx(r"""subprocess\.\w+\s*\(.*shell\s*=\s*True"""),
        Severity.HIGH.value,
        "py",
        "Pass an argument list and shell=False: subprocess.run([cmd, arg]); never shell=True on input.",
        "CWE-78",
    ),
    Rule(
        "py-os-system",
        "Command Injection",
        _rx(r"""os\.system\s*\("""),
        Severity.HIGH.value,
        "py",
        "Avoid os.system; use subprocess.run([...]) with an argument vector (no shell).",
        "CWE-78",
    ),
    Rule(
        "py-pickle-loads",
        "Insecure Deserialization",
        _rx(r"""pickle\.loads?\s*\("""),
        Severity.CRITICAL.value,
        "py",
        "Never unpickle untrusted data; use JSON or a signed, schema-checked format.",
        "CWE-502",
    ),
    Rule(
        "py-yaml-load",
        "Insecure Deserialization",
        _rx(r"""yaml\.load\s*\((?!.*Safe(?:Loader)?)"""),
        Severity.HIGH.value,
        "py",
        "Use yaml.safe_load() (or Loader=SafeLoader); plain yaml.load can build arbitrary objects.",
        "CWE-502",
    ),
    Rule(
        "py-eval-exec",
        "Code Injection",
        _rx(r"""(?<![\w.])(?:eval|exec)\s*\("""),
        Severity.CRITICAL.value,
        "py",
        "Never eval/exec input; parse with ast.literal_eval or a real parser / allow-list.",
        "CWE-95",
    ),
    Rule(
        "py-md5-password",
        "Weak Password Hash",
        _rx(r"""hashlib\.(?:md5|sha1)\s*\("""),
        Severity.MEDIUM.value,
        "py",
        "Use a salted slow KDF (bcrypt/argon2/scrypt) for passwords; md5/sha1 are broken for this.",
        "CWE-327",
    ),
    # --- PHP -----------------------------------------------------------------
    Rule(
        "php-sql-concat",
        "SQL Injection",
        _rx(r"""(?:->query|mysqli_query)\s*\(.*\$_(?:GET|POST|REQUEST|COOKIE)"""),
        Severity.CRITICAL.value,
        "php",
        "Use prepared statements with bound params ($stmt->bind_param); never concat $_GET into SQL.",
        "CWE-89",
    ),
    Rule(
        "php-sql-concat2",
        "SQL Injection",
        _rx(r"""(?:->query|mysqli_query)\s*\(.*["']\s*\.\s*\$"""),
        Severity.CRITICAL.value,
        "php",
        "Use prepared statements with bound params; never build SQL by string concatenation.",
        "CWE-89",
    ),
    Rule(
        "php-xss-echo",
        "Cross-Site Scripting (XSS)",
        _rx(r"""echo\b.*\$_(?:GET|POST|REQUEST)\b"""),
        Severity.HIGH.value,
        "php",
        "Encode output with htmlspecialchars($v, ENT_QUOTES) before echoing user input.",
        "CWE-79",
    ),
    Rule(
        "php-cmd-injection",
        "Command Injection",
        _rx(r"""(?:system|exec|shell_exec|passthru|popen|proc_open)\s*\(.*\$_(?:GET|POST|REQUEST|COOKIE)"""),
        Severity.HIGH.value,
        "php",
        "Avoid shell calls on input; use escapeshellarg() at minimum, or a no-shell API.",
        "CWE-78",
    ),
    Rule(
        "php-file-inclusion",
        "File Inclusion (LFI/RFI)",
        _rx(r"""(?:include|include_once|require|require_once)\s*\(?.*\$_(?:GET|POST|REQUEST|COOKIE)"""),
        Severity.HIGH.value,
        "php",
        "Never include() user input; map requests to a fixed allow-list of file paths.",
        "CWE-98",
    ),
    Rule(
        "php-unserialize",
        "Insecure Deserialization",
        _rx(r"""unserialize\s*\(.*\$_(?:GET|POST|REQUEST|COOKIE)"""),
        Severity.CRITICAL.value,
        "php",
        "Never unserialize() untrusted data (PHP object injection); use json_decode().",
        "CWE-502",
    ),
    Rule(
        "php-loose-compare-hash",
        "Type Juggling (loose comparison)",
        _rx(r"""(?:md5|sha1|hash|crypt)\s*\([^)]*\)\s*==[^=]"""),
        Severity.HIGH.value,
        "php",
        "Compare hashes/tokens with hash_equals() or ===, never loose == (magic-hash bypass).",
        "CWE-697",
    ),
    Rule(
        "php-extract",
        "Variable Overwrite (extract)",
        _rx(r"""extract\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)"""),
        Severity.MEDIUM.value,
        "php",
        "Never extract() request data into the symbol table; read named keys explicitly.",
        "CWE-621",
    ),
    # --- JavaScript / Node ---------------------------------------------------
    Rule(
        "js-sql-template",
        "SQL Injection",
        _rx(r"""\.query\s*\(\s*`[^`]*\$\{[^}]*\}"""),
        Severity.CRITICAL.value,
        "js",
        "Use parameterised queries (db.query(sql, [params])); never template-literal SQL.",
        "CWE-89",
    ),
    Rule(
        "js-sql-concat",
        "SQL Injection",
        _rx(r"""\.query\s*\(\s*["'].*["']\s*\+"""),
        Severity.CRITICAL.value,
        "js",
        "Use parameterised queries with placeholders; never build SQL with + concatenation.",
        "CWE-89",
    ),
    Rule(
        "js-child-process",
        "Command Injection",
        _rx(r"""(?:child_process\.)?exec(?:Sync)?\s*\(.*(?:\+|`.*\$\{|req\.)"""),
        Severity.HIGH.value,
        "js",
        "Use execFile/spawn with an args array (no shell); never concat input into exec().",
        "CWE-78",
    ),
    Rule(
        "js-eval-function",
        "Code Injection",
        _rx(r"""(?<![\w.])(?:eval\s*\(|new\s+Function\s*\()"""),
        Severity.CRITICAL.value,
        "js",
        "Never eval()/new Function() on input; use JSON.parse or a real parser / allow-list.",
        "CWE-95",
    ),
    Rule(
        "js-xss-send",
        "Cross-Site Scripting (XSS)",
        _rx(r"""(?:res\.send|res\.write)\s*\(.*(?:\+|`.*\$\{).*req\."""),
        Severity.HIGH.value,
        "js",
        "Encode/escape user input before reflecting it; set a strict CSP and Content-Type.",
        "CWE-79",
    ),
    Rule(
        "js-innerhtml",
        "Cross-Site Scripting (XSS)",
        _rx(r"""\.innerHTML\s*=\s*(?!["'`][^"'`]*["'`]\s*;?\s*$).*(?:req\.|\+|\$\{)"""),
        Severity.HIGH.value,
        "js",
        "Assign with .textContent or sanitise (DOMPurify) before .innerHTML of untrusted input.",
        "CWE-79",
    ),
    Rule(
        "js-require-dynamic",
        "Arbitrary Module Load",
        _rx(r"""require\s*\(\s*(?!["'`])"""),
        Severity.HIGH.value,
        "js",
        "Never require() a runtime value; use a fixed allow-list mapping names to modules.",
        "CWE-94",
    ),
    # --- any language --------------------------------------------------------
    Rule(
        "any-hardcoded-secret",
        "Hardcoded Secret",
        _rx(
            r"""(?i)(?:password|passwd|secret|api[_-]?key|jwt[_-]?secret|token|aws[_-]?\w*key)"""
            r"""\s*[:=]\s*["'][^"']{6,}["']"""
        ),
        Severity.MEDIUM.value,
        "any",
        "Load secrets from env/secret-manager; never hardcode credentials in source.",
        "CWE-798",
    ),
]


def _rules_for(language: str) -> List[Rule]:
    """Return the rules that apply to ``language`` (its own plus the ``any`` ones)."""
    lang = language.lower()
    return [r for r in RULES if r.language == lang or r.language == "any"]


def analyze_source(
    code: str, *, language: str, filename: str = "<memory>"
) -> List[dict]:
    """Scan ``code`` line by line for the rules applicable to ``language``.

    Returns a list of finding dicts, each::

        {filename, line, line_text, rule_id, vuln, severity, remediation, cwe}

    ``line`` is 1-based; ``line_text`` is the stripped source line.
    """
    rules = _rules_for(language)
    findings: List[dict] = []
    for lineno, raw in enumerate(code.splitlines(), start=1):
        for rule in rules:
            if rule.regex.search(raw):
                findings.append(
                    {
                        "filename": filename,
                        "line": lineno,
                        "line_text": raw.strip(),
                        "rule_id": rule.id,
                        "vuln": rule.name,
                        "severity": rule.severity,
                        "remediation": rule.remediation,
                        "cwe": rule.cwe,
                    }
                )
    return findings


def _language_for_path(path: str) -> str:
    """Infer the language code from a file extension (default ``"any"``)."""
    _, ext = os.path.splitext(path)
    return _EXT_LANG.get(ext.lower(), "any")


def analyze_file(path: str) -> List[dict]:
    """Read ``path``, infer its language from the extension, and analyze it."""
    language = _language_for_path(path)
    with open(path, "r", encoding="utf-8") as fh:
        code = fh.read()
    return analyze_source(code, language=language, filename=os.path.basename(path))


def analyze_samples() -> List[dict]:
    """Analyze all three bundled vulnerable samples; return the combined findings."""
    findings: List[dict] = []
    for path in SAMPLE_FILES.values():
        findings.extend(analyze_file(path))
    return findings


# --- the contract entry point ------------------------------------------------
REMEDIATION: str = (
    "Treat every byte of attacker-controlled input as hostile and never let it "
    "reach a sink as code or structure. Concretely, per class: (SQLi) use "
    "PARAMETERISED queries / prepared statements with bound parameters -- "
    "cursor.execute(sql, params), $stmt->bind_param, db.query(sql, [vals]) -- "
    "never f-strings, %, +, or template literals to build SQL. (Command "
    "injection) call processes with an ARGUMENT VECTOR and no shell -- "
    "subprocess.run([cmd, arg]), execFile/spawn -- never os.system/system()/"
    "shell_exec/exec() on input; if a shell is unavoidable, escapeshellarg each "
    "argument. (Deserialization) never pickle.loads / unserialize() / "
    "BinaryFormatter on untrusted bytes; use JSON or a signed, schema-validated "
    "format, and yaml.safe_load not yaml.load. (Code injection) never eval/exec/"
    "new Function on input; use ast.literal_eval, JSON.parse, or a real parser "
    "with an allow-list. (XSS) contextually ENCODE output (htmlspecialchars, "
    "framework auto-escaping, .textContent not .innerHTML) and ship a strict "
    "Content-Security-Policy. (File inclusion / dynamic require) map requests to "
    "a FIXED allow-list of paths/modules; never include()/require() a runtime "
    "value. (Type juggling) compare secrets with a strict, constant-time check "
    "(hash_equals / ===), never loose ==. (Secrets) load credentials from env / "
    "a secret manager; never hardcode them. (Passwords) hash with a salted slow "
    "KDF (bcrypt/argon2/scrypt), never md5/sha1. Finally: regex SAST is a FIRST "
    "PASS that finds candidate source->sink pairs; back it with AST/data-flow "
    "tooling (CodeQL, Semgrep, Bandit) in CI and confirm exploitability with the "
    "matching dynamic test before triaging."
)

#: Shown in the umbrella Finding -- this is static analysis, not one endpoint.
ENDPOINT: str = "(static analysis)"


def assess(client=None) -> Finding:  # noqa: ANN001 -- signature kept uniform
    """White-box SAST sweep of the bundled samples (ignores ``client``).

    Runs :func:`analyze_samples` and rolls the per-file findings into a single
    umbrella :class:`Finding`. ``discovered`` is True iff findings were produced
    across ALL THREE languages AND the high-severity classes (SQL Injection,
    Command Injection, Insecure Deserialization) were each detected at least
    once. ``exploit_result``/``extra`` carry the totals, the breakdowns by
    severity / language / vuln class, and the per-file findings. The umbrella
    severity is "info"; the individual finding severities live inside ``extra``.
    """
    findings = analyze_samples()

    # --- breakdowns ----------------------------------------------------------
    by_severity: Dict[str, int] = {}
    by_vuln: Dict[str, int] = {}
    by_language: Dict[str, int] = {}
    per_file: Dict[str, List[dict]] = {}
    # filename -> language, to count languages with >=1 finding
    file_lang = {os.path.basename(p): lang for lang, p in SAMPLE_FILES.items()}
    for f in findings:
        by_severity[f["severity"]] = by_severity.get(f["severity"], 0) + 1
        by_vuln[f["vuln"]] = by_vuln.get(f["vuln"], 0) + 1
        per_file.setdefault(f["filename"], []).append(f)
    for fname, file_findings in per_file.items():
        lang = file_lang.get(fname, "any")
        by_language[lang] = by_language.get(lang, 0) + len(file_findings)

    languages_with_findings = {
        file_lang.get(fname, "any") for fname in per_file if per_file[fname]
    }
    all_three_languages = {"py", "php", "js"}.issubset(languages_with_findings)

    required_classes = {
        "SQL Injection",
        "Command Injection",
        "Insecure Deserialization",
    }
    classes_found = set(by_vuln)
    required_classes_found = required_classes.issubset(classes_found)

    discovered = bool(findings) and all_three_languages and required_classes_found

    total = len(findings)
    summary = (
        f"static SAST scan of {len(SAMPLE_FILES)} sample files found {total} "
        f"findings across {len(languages_with_findings)} languages "
        f"({', '.join(sorted(languages_with_findings))}); vuln classes: "
        f"{', '.join(sorted(classes_found))}. Each maps to a dynamic module that "
        f"can prove exploitability on a running target."
    )

    exploit_result = {
        "total_findings": total,
        "by_severity": by_severity,
        "by_language": by_language,
        "by_vuln": by_vuln,
        "per_file": per_file,
        "summary": summary,
    }

    evidence = (
        f"{total} source->sink findings ({by_severity}) across "
        f"{sorted(languages_with_findings)}; required high-severity classes "
        f"{sorted(required_classes)} all detected: {required_classes_found}"
    )

    return Finding(
        vuln="Source Code Analysis (white-box SAST)",
        endpoint=ENDPOINT,
        severity=Severity.INFO.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload="",
        extra={
            "total_findings": total,
            "by_severity": by_severity,
            "by_language": by_language,
            "by_vuln": by_vuln,
            "languages_with_findings": sorted(languages_with_findings),
            "required_classes": sorted(required_classes),
            "required_classes_found": required_classes_found,
            "all_three_languages": all_three_languages,
            "per_file": per_file,
            "samples_dir": SAMPLES_DIR,
        },
    )
