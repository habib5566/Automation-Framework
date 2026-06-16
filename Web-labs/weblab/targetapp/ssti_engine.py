"""A deliberately-naive ``{{ ... }}`` template engine for the SSTI demo.

It evaluates ``{{ expression }}`` against a context, so ``{{7*7}}`` renders
``49`` -- the classic SSTI fingerprint -- and ``{{ config.secret }}`` leaks a
planted value. That much is the genuine vulnerability.

The real Jinja-style escalation (``{{ ''.__class__.__mro__[1].__subclasses__() }}``
to reach ``os.system``) would be live RCE on the host, so the evaluator is built
on a vetted ``ast`` walk that PERMITS arithmetic / names / non-dunder attribute
reads but REJECTS calls and dunder access. An escalation payload is therefore
recognised and reported as "blocked by the lab sandbox" instead of executing --
the lesson lands without handing an attacker a shell.
"""
from __future__ import annotations

import ast
import re
from typing import Any, Dict

_TEMPLATE_RE = re.compile(r"\{\{(.*?)\}\}", re.DOTALL)


class RCEBlocked(Exception):
    """Raised when an expression tries to escalate beyond the safe subset."""


_ALLOWED = (
    ast.Expression,
    ast.Constant,
    ast.BinOp,
    ast.UnaryOp,
    ast.BoolOp,
    ast.Compare,
    ast.Name,
    ast.Load,
    ast.Attribute,
    ast.Subscript,
    ast.Tuple,
    ast.List,
    # operators
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
    ast.USub, ast.UAdd, ast.Not, ast.And, ast.Or,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
)


def _validate(node: ast.AST) -> None:
    for child in ast.walk(node):
        if not isinstance(child, _ALLOWED):
            # Calls, comprehensions, lambdas, etc. -> escalation attempt.
            raise RCEBlocked(f"disallowed expression node: {type(child).__name__}")
        if isinstance(child, ast.Attribute) and child.attr.startswith("__"):
            raise RCEBlocked(f"dunder attribute access blocked: {child.attr}")
        if isinstance(child, ast.Name) and child.id.startswith("__"):
            raise RCEBlocked(f"dunder name blocked: {child.id}")


def safe_eval(expression: str, context: Dict[str, Any]) -> Any:
    """Evaluate ``expression`` within the safe subset, against ``context``."""
    tree = ast.parse(expression.strip(), mode="eval")
    _validate(tree)
    code = compile(tree, "<ssti>", "eval")
    return eval(code, {"__builtins__": {}}, dict(context))  # noqa: S307 - sandboxed


def render(template: str, context: Dict[str, Any]) -> str:
    """Render ``template``, substituting each ``{{ expr }}``."""

    def _sub(match: "re.Match") -> str:
        expr = match.group(1)
        try:
            return str(safe_eval(expr, context))
        except RCEBlocked as exc:
            return f"[lab-sandbox blocked RCE escalation: {exc}]"
        except Exception as exc:  # noqa: BLE001 - surface template errors verbatim
            return f"[template error: {type(exc).__name__}: {exc}]"

    return _TEMPLATE_RE.sub(_sub, template)
