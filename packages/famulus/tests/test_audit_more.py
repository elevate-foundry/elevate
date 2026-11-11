"""Deeper audit-log contracts: thread-safety, precise failure diagnosis,
backward compatibility with pre-hardening records, and actor capture."""

from __future__ import annotations

import json
import threading

import pytest

from famulus.safety import audit as audit_mod
from famulus.safety.audit import AuditLog, _actor, _digest


@pytest.fixture(autouse=True)
def _no_env_key(monkeypatch):
    monkeypatch.delenv("FAMULUS_AUDIT_HMAC_KEY", raising=False)


def test_concurrent_records_keep_chain_valid_and_unique_seq(tmp_path):
    log = AuditLog(tmp_path / "audit.jsonl")
    n_threads, per_thread = 8, 25

    def worker(tid):
        for i in range(per_thread):
            log.record("concurrent", tid=tid, i=i)

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert log.verify() is True
    seqs = []
    with (tmp_path / "audit.jsonl").open() as fh:
        for line in fh:
            seqs.append(json.loads(line)["seq"])
    assert sorted(seqs) == list(range(1, n_threads * per_thread + 1))  # no gaps, no dupes


def test_verify_detailed_reports_specific_problems(tmp_path):
    p = tmp_path / "audit.jsonl"
    log = AuditLog(p)
    log.record("a")
    log.record("b")
    good = p.read_text().splitlines()

    # (1) altered data -> digest mismatch
    p.write_text(good[0].replace('"event": "a"', '"event": "X"') + "\n" + good[1] + "\n")
    ok, why = log.verify_detailed()
    assert ok is False and "digest mismatch" in why

    # (2) not-JSON line
    p.write_text("this is not json\n")
    ok, why = log.verify_detailed()
    assert ok is False and "not valid JSON" in why

    # (3) duplicated record -> broken link
    p.write_text(good[0] + "\n" + good[0] + "\n" + good[1] + "\n")
    ok, why = log.verify_detailed()
    assert ok is False and "broken link" in why


def test_missing_hash_is_rejected(tmp_path):
    p = tmp_path / "audit.jsonl"
    log = AuditLog(p)
    log.record("a")
    rec = json.loads(p.read_text().splitlines()[0])
    rec.pop("hash")
    p.write_text(json.dumps(rec) + "\n")
    ok, why = log.verify_detailed()
    assert ok is False and "missing hash" in why


def test_legacy_record_without_v_seq_alg_still_verifies(tmp_path):
    """Records written by the pre-hardening format (no v/seq/alg) must still
    verify under the new code."""
    p = tmp_path / "audit.jsonl"
    genesis = "0" * 64
    legacy = {
        "ts": "2024-01-01T00:00:00+00:00",
        "host": "old-host",
        "pid": 123,
        "event": "legacy.event",
        "data": {"x": 1},
        "prev_hash": genesis,
    }
    legacy["hash"] = _digest(legacy, genesis, "sha256", None)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(legacy) + "\n")

    assert AuditLog(p).verify() is True


def test_actor_has_user_and_uid_fields():
    a = _actor()
    assert "user" in a and "uid" in a
    assert isinstance(a["user"], str)


def test_hmac_from_env_is_picked_up(tmp_path, monkeypatch):
    monkeypatch.setenv("FAMULUS_AUDIT_HMAC_KEY", "env-key")
    log = AuditLog(tmp_path / "audit.jsonl")
    rec = log.record("x")
    assert rec["alg"] == "hmac-sha256"
    assert log.verify() is True
    # Without the env key a fresh verifier cannot validate it.
    monkeypatch.delenv("FAMULUS_AUDIT_HMAC_KEY", raising=False)
    assert AuditLog(tmp_path / "audit.jsonl").verify() is False
