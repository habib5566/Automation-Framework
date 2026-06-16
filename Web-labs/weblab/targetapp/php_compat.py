"""A faithful model of PHP's loose ``==`` comparison (PHP 5/7 semantics).

This is the engine behind the type-juggling and magic-hash demos. PHP's loose
equality coerces operands before comparing, which produces the surprising
results those attacks rely on:

* two numeric strings compare as numbers, so ``"0e1" == "0e9"`` is ``0 == 0`` ->
  ``true`` (the magic-hash bug -- md5/sha1 outputs of the form ``0e[0-9]+``);
* ``int == string`` coerces the string to a number, so (pre-PHP-8) ``0 == "abc"``
  is ``true``;
* ``bool == anything`` coerces to bool, so a non-empty secret ``== true`` is
  ``true`` (the JSON ``{"token": true}`` auth bypass).

PHP 8 changed string<->number juggling; these helpers model the still-widely-
deployed PHP 5/7 behaviour the technique targets.
"""
from __future__ import annotations

import hashlib
import re

_NUMERIC_RE = re.compile(r"^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$")


def _is_numeric_string(s: str) -> bool:
    return bool(_NUMERIC_RE.match(s))


def _to_number(value) -> float:
    """PHP-style numeric coercion (leading-numeric prefix; else 0)."""
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        m = re.match(r"\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", value)
        return float(m.group(0)) if m else 0.0
    return 0.0


def _to_bool(value) -> bool:
    """PHP truthiness: '', '0', 0, 0.0, None, [] are falsey; else truthy."""
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, str):
        return value not in ("", "0")
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return True


def php_loose_equals(a, b) -> bool:
    """Model PHP 5/7 ``$a == $b``."""
    # bool (or null) on either side -> compare as booleans.
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None:
        if a is None and isinstance(b, str):
            return b == ""
        if b is None and isinstance(a, str):
            return a == ""
        return _to_bool(a) == _to_bool(b)

    # int/float vs string -> coerce the string to a number (pre-PHP-8).
    if isinstance(a, (int, float)) and isinstance(b, str):
        return float(a) == _to_number(b)
    if isinstance(b, (int, float)) and isinstance(a, str):
        return float(b) == _to_number(a)

    # two strings: if BOTH look numeric, compare as numbers (the magic-hash bug).
    if isinstance(a, str) and isinstance(b, str):
        if _is_numeric_string(a) and _is_numeric_string(b):
            return _to_number(a) == _to_number(b)
        return a == b

    return a == b


def md5_hex(value: str) -> str:
    return hashlib.md5(value.encode()).hexdigest()


def is_magic_hash(hexdigest: str) -> bool:
    """True for a ``0e`` + all-digits hash that loose-compares as numeric zero."""
    return bool(re.match(r"^0[eE]\d+$", hexdigest))
