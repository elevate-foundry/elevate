"""The zero-dependency selfcheck must pass on a healthy tree and FAIL (non-zero)
when a core invariant breaks -- otherwise it gives false confidence on a device."""

from __future__ import annotations

from famulus import selfcheck
from famulus.bootstrap import ignition


def test_selfcheck_passes_clean():
    assert selfcheck.run_checks() == []
    assert selfcheck.main() == 0


def test_selfcheck_reports_failure_when_probe_breaks(monkeypatch):
    def _boom():
        raise RuntimeError("probe exploded")

    monkeypatch.setattr(ignition, "probe", _boom)
    failures = selfcheck.run_checks()
    assert failures, "selfcheck should have reported a failure"
    assert any("probe" in name for name, _ in failures)
    assert selfcheck.main() == 1
