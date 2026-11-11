"""Zero-dependency self-check: prove famulus's core runs on THIS machine.

Runnable on any host with only the Python standard library -- no pip, no pytest:

    python3 -m famulus.selfcheck

It exercises the portability-critical invariants that decide whether a fresh
`git clone` will work here:

  * the stdlib-only core imports cleanly (it must run before any pip install),
  * the ignition probe runs and returns well-formed output (never crashing,
    even with no curl / no Ollama),
  * the audit log writes, verifies, and detects tampering (plain + HMAC),
  * seed selection scales with discovered RAM.

Exit code 0 = all good; nonzero = at least one failure (the first is printed).
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path


def _check_imports() -> None:
    import famulus.bootstrap.connectivity  # noqa: F401
    import famulus.bootstrap.ignition  # noqa: F401
    import famulus.bootstrap.install_ollama  # noqa: F401
    import famulus.bootstrap.seed  # noqa: F401
    import famulus.bootstrap.wizard  # noqa: F401
    import famulus.safety.audit  # noqa: F401
    import famulus.safety.gate  # noqa: F401


def _check_probe() -> None:
    from famulus.bootstrap.ignition import probe

    ig = probe()
    d = ig.to_dict()
    for key in ("os", "arch", "needs_bootstrap", "seed_size_hint_b", "python_version"):
        assert key in d, f"probe output missing {key!r}"


def _check_audit() -> None:
    from famulus.safety.audit import AuditLog

    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "audit.jsonl"
        log = AuditLog(p)
        log.record("selfcheck", step=1)
        log.record("selfcheck", step=2)
        assert log.verify() is True, "fresh chain failed to verify"

        lines = p.read_text(encoding="utf-8").splitlines()
        lines[0] = lines[0].replace('"step": 1', '"step": 999')
        p.write_text("\n".join(lines) + "\n", encoding="utf-8")
        assert log.verify() is False, "tampering was not detected"

        signed = Path(tmp) / "signed.jsonl"
        keyed = AuditLog(signed, hmac_key="selfcheck-key")
        keyed.record("x")
        assert keyed.verify() is True, "hmac chain failed to verify with correct key"
        # A wrong key must never validate the chain (robust regardless of env).
        assert AuditLog(signed, hmac_key="WRONG").verify() is False, "hmac chain verified with wrong key"


def _check_seed() -> None:
    from famulus.bootstrap import seed
    from famulus.bootstrap.ignition import Ignition

    cfg = {"seed_models": [{"name": "tiny", "b": 1}, {"name": "big", "b": 8}]}
    assert seed.choose_seed(Ignition(ram_total_gb=4), cfg) == "tiny"
    assert seed.choose_seed(Ignition(ram_total_gb=64), cfg) == "big"


_CHECKS = (
    ("core imports load (stdlib-only)", _check_imports),
    ("ignition probe runs & is well-formed", _check_probe),
    ("audit log verifies + detects tampering", _check_audit),
    ("seed selection scales with RAM", _check_seed),
)


def run_checks() -> list[tuple[str, str]]:
    """Run every self-check. Returns a list of (name, error) for failures."""
    failures: list[tuple[str, str]] = []
    print(f"famulus selfcheck :: Python {sys.version.split()[0]} on {sys.platform}")
    for name, fn in _CHECKS:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 -- report any failure, never crash
            failures.append((name, f"{type(exc).__name__}: {exc}"))
            print(f"  [FAIL] {name} -- {type(exc).__name__}: {exc}")
        else:
            print(f"  [ok]   {name}")
    return failures


def main() -> int:
    failures = run_checks()
    if failures:
        print(f"\nFAILED: {len(failures)} check(s) did not pass.")
        return 1
    print("\nOK: all selfchecks passed -- the core is good on this machine.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
