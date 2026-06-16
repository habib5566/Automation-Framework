"""A .NET-style insecure deserializer (faithful to the vulnerable pattern).

Insecure deserialization is dangerous when the serialized data is allowed to
choose which *type* gets instantiated -- e.g. ``BinaryFormatter``, ``LosFormatter``,
or ``Json.NET`` with ``TypeNameHandling.Auto``. An attacker supplies a "gadget"
type whose construction/initialisation has a side effect (running a process),
turning "load this object" into remote code execution.

Here the wire format is JSON carrying a ``__type`` discriminator. Benign types
are reconstructed as data; a known gadget type instead executes its ``command``
through the simulated shell -- modelling the gadget chain without a real .NET
runtime or a real ``os.system``.
"""
from __future__ import annotations

import json

from .sim_shell import simulate_shell

#: Types whose deserialization triggers code execution (the gadgets). These
#: mirror the real-world chains taught in OSWE (ObjectDataProvider, the
#: Process/ProcessStartInfo gadget, the LosFormatter activator).
GADGET_TYPES = {
    "System.Diagnostics.Process",
    "System.Windows.Data.ObjectDataProvider",
    "System.Configuration.Install.AssemblyInstaller",
}


class DeserializationError(Exception):
    pass


def deserialize(blob: str, sandbox) -> dict:
    """Deserialize ``blob``; gadget types execute their command (RCE)."""
    try:
        data = json.loads(blob)
    except json.JSONDecodeError as exc:
        raise DeserializationError(f"malformed payload: {exc}") from exc
    if not isinstance(data, dict):
        raise DeserializationError("expected a serialized object")

    type_name = data.get("__type", "")
    if type_name in GADGET_TYPES:
        command = data.get("command") or data.get("MethodParameters") or ""
        output = simulate_shell(str(command), sandbox)
        return {"__type": type_name, "instantiated": True,
                "executed": command, "output": output, "rce": True}

    # Benign object: reconstruct as plain data (no type instantiation).
    obj = {k: v for k, v in data.items() if k != "__type"}
    return {"__type": type_name or "object", "instantiated": True, "data": obj}
