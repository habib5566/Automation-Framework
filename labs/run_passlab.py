"""Launcher for passlab when only .pyc bytecode is present (no .py sources)."""
from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = ROOT / "passlab" / "__pycache__"
DEMO = ROOT / "passlab" / "demo" / "__pycache__"


def _load(name: str, pyc: Path):
    spec = importlib.util.spec_from_file_location(name, str(pyc))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def bootstrap() -> None:
    pkg = types.ModuleType("passlab")
    pkg.__path__ = [str(ROOT / "passlab")]
    sys.modules["passlab"] = pkg

    demo_pkg = types.ModuleType("passlab.demo")
    demo_pkg.__path__ = [str(ROOT / "passlab" / "demo")]
    sys.modules["passlab.demo"] = demo_pkg
    pkg.demo = demo_pkg

    for name, pyc in [
        ("passlab._types", BASE / "_types.cpython-311.pyc"),
        ("passlab.hashing", BASE / "hashing.cpython-311.pyc"),
        ("passlab.bruteforce", BASE / "bruteforce.cpython-311.pyc"),
        ("passlab.dictionary", BASE / "dictionary.cpython-311.pyc"),
        ("passlab.rainbow", BASE / "rainbow.cpython-311.pyc"),
        ("passlab.online", BASE / "online.cpython-311.pyc"),
        ("passlab.auditor", BASE / "auditor.cpython-311.pyc"),
    ]:
        _load(name, pyc)

    init = _load("passlab.__init__", BASE / "__init__.cpython-311.pyc")
    for key in init.__all__:
        setattr(pkg, key, getattr(init, key))
    pkg.__version__ = init.__version__
    pkg.AUTHORIZATION_BANNER = init.AUTHORIZATION_BANNER

    _load("passlab.demo.generate_targets", DEMO / "generate_targets.cpython-311.pyc")
    _load("passlab.demo.target_server", DEMO / "target_server.cpython-311.pyc")
    _load("passlab.cli", BASE / "cli.cpython-311.pyc")


if __name__ == "__main__":
    bootstrap()
    sys.modules["passlab.cli"].main()
