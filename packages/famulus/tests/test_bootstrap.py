"""Phase -1 bootstrap tests (stdlib + pytest only).

These lock the key safety/behavior contracts:
  * the ignition probe never crashes and hardcodes no specs,
  * the audit log is a verifiable hash chain (tamper-evident),
  * seed selection scales with discovered RAM,
  * the wizard SKIPS when already provisioned,
  * the wizard FAILS CLOSED (no network) when non-interactive but bootstrap is needed.
"""

from __future__ import annotations

import pytest

from famulus.bootstrap import seed, wizard
from famulus.bootstrap.ignition import Ignition, probe
from famulus.safety.audit import AuditLog


# --- ignition --------------------------------------------------------------

def test_probe_runs_and_is_well_formed():
    ig = probe()
    assert ig.os in {"Darwin", "Linux", "Windows", "unknown"}
    d = ig.to_dict()
    for key in ("os", "arch", "needs_bootstrap", "seed_size_hint_b", "python_version"):
        assert key in d


def test_seed_size_hint_scales_with_ram():
    assert Ignition(ram_total_gb=4).seed_size_hint_b() == 1
    assert Ignition(ram_total_gb=8).seed_size_hint_b() == 3
    assert Ignition(ram_total_gb=16).seed_size_hint_b() == 4
    assert Ignition(ram_total_gb=64).seed_size_hint_b() == 8
    assert Ignition(ram_total_gb=None).seed_size_hint_b() == 1  # unknown -> smallest


def test_needs_bootstrap_logic():
    assert Ignition(has_ollama=False).needs_bootstrap is True
    assert Ignition(has_ollama=True, ollama_models=[]).needs_bootstrap is True
    assert Ignition(has_ollama=True, ollama_models=["llama3.2:1b"]).needs_bootstrap is False


# --- audit chain -----------------------------------------------------------

def test_audit_chain_verifies_and_detects_tampering(tmp_path, monkeypatch):
    monkeypatch.delenv("FAMULUS_AUDIT_HMAC_KEY", raising=False)
    log = AuditLog(tmp_path / "audit.jsonl")
    log.record("a", x=1)
    log.record("b", y=2)
    assert log.verify() is True

    # Tamper with a record's data; chain must break.
    p = tmp_path / "audit.jsonl"
    lines = p.read_text().splitlines()
    lines[0] = lines[0].replace('"x": 1', '"x": 999')
    p.write_text("\n".join(lines) + "\n")
    assert log.verify() is False


def test_audit_records_carry_identity_sequence_and_schema(tmp_path, monkeypatch):
    monkeypatch.delenv("FAMULUS_AUDIT_HMAC_KEY", raising=False)
    log = AuditLog(tmp_path / "audit.jsonl")
    r1 = log.record("first", a=1)
    r2 = log.record("second", b=2)
    for key in ("v", "seq", "ts", "host", "actor", "pid", "event", "data", "prev_hash", "alg", "hash"):
        assert key in r1
    assert r1["seq"] == 1 and r2["seq"] == 2  # monotonic
    assert r1["alg"] == "sha256"
    assert "user" in r1["actor"]
    assert log.verify() is True


def test_audit_hmac_chain_is_unforgeable_without_key(tmp_path, monkeypatch):
    monkeypatch.delenv("FAMULUS_AUDIT_HMAC_KEY", raising=False)
    signed = AuditLog(tmp_path / "audit.jsonl", hmac_key="topsecret")
    signed.record("x", v=1)
    signed.record("y", v=2)
    assert signed.verify() is True  # correct key verifies

    assert AuditLog(tmp_path / "audit.jsonl").verify() is False  # no key
    assert AuditLog(tmp_path / "audit.jsonl", hmac_key="wrong").verify() is False  # wrong key


def test_audit_detects_inserted_record(tmp_path, monkeypatch):
    monkeypatch.delenv("FAMULUS_AUDIT_HMAC_KEY", raising=False)
    log = AuditLog(tmp_path / "audit.jsonl")
    log.record("a")
    log.record("b")
    p = tmp_path / "audit.jsonl"
    lines = p.read_text().splitlines()
    # Re-insert the first record in the middle: breaks prev_hash linkage.
    p.write_text("\n".join([lines[0], lines[0], lines[1]]) + "\n")
    ok, problem = log.verify_detailed()
    assert ok is False and problem is not None


def test_audit_verify_tip_detects_trailing_truncation(tmp_path, monkeypatch):
    monkeypatch.delenv("FAMULUS_AUDIT_HMAC_KEY", raising=False)
    log = AuditLog(tmp_path / "audit.jsonl")
    log.record("a")
    log.record("b")
    tip = log.tip()
    assert log.verify_tip(tip) is True

    # Drop the last record: the chain still self-verifies, but the tip moved.
    p = tmp_path / "audit.jsonl"
    lines = p.read_text().splitlines()
    p.write_text("\n".join(lines[:-1]) + "\n")
    assert log.verify() is True          # backward chain alone cannot see this
    assert log.verify_tip(tip) is False  # external high-water mark catches it


# --- seed selection --------------------------------------------------------

def test_choose_seed_picks_largest_that_fits():
    cfg = {"seed_models": [
        {"name": "tiny", "b": 1},
        {"name": "mid", "b": 4},
        {"name": "big", "b": 8},
    ]}
    assert seed.choose_seed(Ignition(ram_total_gb=16), cfg) == "mid"   # hint 4
    assert seed.choose_seed(Ignition(ram_total_gb=64), cfg) == "big"   # hint 8
    assert seed.choose_seed(Ignition(ram_total_gb=4), cfg) == "tiny"   # hint 1


# --- wizard orchestration --------------------------------------------------

def _fake_probe(**kw):
    def _p():
        return Ignition(**kw)
    return _p


def test_wizard_skips_when_provisioned(tmp_path, monkeypatch):
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))
    monkeypatch.setattr(
        wizard, "probe", _fake_probe(has_ollama=True, ollama_models=["llama3.2:1b"], ollama_version="0.17.7")
    )
    rc = wizard.main([])
    assert rc == 0
    assert (tmp_path / "config" / "discovered_system.json").exists()


def test_wizard_fails_closed_when_needed_and_noninteractive(tmp_path, monkeypatch):
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))
    monkeypatch.setattr(wizard, "probe", _fake_probe(has_ollama=False))

    # If connectivity is ever attempted, force a hard failure -- it must NOT be.
    def _boom(*a, **k):
        raise AssertionError("network must not be touched when failing closed")

    monkeypatch.setattr(wizard.connectivity, "is_online", _boom)
    monkeypatch.setattr(wizard.connectivity, "ensure_connectivity", _boom)

    rc = wizard.main(["--noninteractive"])
    assert rc == 1  # declined at the one-time consent gate, fail-closed
