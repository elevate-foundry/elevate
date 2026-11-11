"""Portability contracts: the invariants that make `git pull` -> run work on
ANY machine, not merely on the box this was written on.

These lock the properties that actually determine cross-machine behavior:
  * the stdlib-only core imports NOTHING third-party (it runs before pip),
  * the ignition probe never crashes on a bare host (no curl / no ollama / no
    working subprocess) and still reports a sane state,
  * an unknown OS (no probe branch) is handled gracefully,
  * the zero-dependency selfcheck passes here.
"""

from __future__ import annotations

import ast
import importlib.util
import sys
import sysconfig
from pathlib import Path

import famulus
from famulus.bootstrap import ignition

REPO_ROOT = Path(famulus.__file__).resolve().parent.parent

# The layer that MUST stay importable on a fresh interpreter (before any pip).
STDLIB_ONLY_TARGETS = (
    "famulus/bootstrap",
    "famulus/safety",
    "famulus/selfcheck.py",
)

_STDLIB_DIRS = {
    Path(p).resolve()
    for k in ("stdlib", "platstdlib")
    for p in [sysconfig.get_paths().get(k)]
    if p
}


def _iter_py_files():
    for target in STDLIB_ONLY_TARGETS:
        path = REPO_ROOT / target
        if path.is_dir():
            yield from sorted(path.rglob("*.py"))
        elif path.is_file():
            yield path


def _imported_roots(py_file: Path) -> set[str]:
    tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level:  # relative import -> first-party, skip
                continue
            if node.module:
                roots.add(node.module.split(".")[0])
    return roots


def _is_stdlib(modname: str) -> bool:
    if modname in sys.builtin_module_names:
        return True
    names = getattr(sys, "stdlib_module_names", None)
    if names is not None and modname in names:
        return True
    try:
        spec = importlib.util.find_spec(modname)
    except (ImportError, ValueError):
        return False
    if spec is None:
        return False
    origin = spec.origin
    if origin in (None, "built-in", "frozen"):
        return True
    p = Path(origin).resolve()
    if "site-packages" in p.parts or "dist-packages" in p.parts:
        return False
    return any(str(p).startswith(str(d)) for d in _STDLIB_DIRS)


def test_core_layer_imports_are_stdlib_only():
    offenders: dict[str, set[str]] = {}
    for py in _iter_py_files():
        for root in _imported_roots(py):
            if root == "famulus":  # first-party
                continue
            if not _is_stdlib(root):
                offenders.setdefault(str(py.relative_to(REPO_ROOT)), set()).add(root)
    assert not offenders, f"third-party imports found in the stdlib-only core: {offenders}"


def test_probe_never_crashes_on_bare_machine(monkeypatch):
    # No helper binaries, and any subprocess attempt explodes.
    monkeypatch.setattr(ignition.shutil, "which", lambda _name: None)

    def _boom(*_a, **_k):
        raise OSError("no usable subprocess on this host")

    monkeypatch.setattr(ignition.subprocess, "run", _boom)

    ig = ignition.probe()
    d = ig.to_dict()
    for key in ("os", "arch", "needs_bootstrap", "seed_size_hint_b", "python_version"):
        assert key in d
    assert ig.has_ollama is False
    assert ig.has_curl is False
    assert ig.needs_bootstrap is True  # nothing present -> bootstrap is required


def test_probe_handles_unknown_os(monkeypatch):
    monkeypatch.setattr(ignition.platform, "system", lambda: "Plan9")
    ig = ignition.probe()  # must not raise on an OS with no probe branch
    assert ig.to_dict()["os"] == "Plan9"


def test_selfcheck_passes_on_this_machine():
    from famulus import selfcheck

    assert selfcheck.run_checks() == []
