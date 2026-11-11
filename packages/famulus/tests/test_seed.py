"""Seed-model selection and acquisition branches."""

from __future__ import annotations

import subprocess

import pytest

from famulus.bootstrap import seed
from famulus.bootstrap.ignition import Ignition


class FakeCompleted:
    def __init__(self, returncode=0, stdout=""):
        self.returncode = returncode
        self.stdout = stdout


# --- choose_seed -----------------------------------------------------------

def test_choose_seed_uses_config_over_defaults():
    cfg = {"seed_models": [{"name": "a", "b": 1}, {"name": "b", "b": 4}, {"name": "c", "b": 8}]}
    assert seed.choose_seed(Ignition(ram_total_gb=16), cfg) == "b"


def test_choose_seed_falls_back_to_smallest_when_none_fit():
    cfg = {"seed_models": [{"name": "huge", "b": 99}]}
    assert seed.choose_seed(Ignition(ram_total_gb=4), cfg) == "huge"


def test_choose_seed_uses_builtin_defaults_when_config_empty():
    name = seed.choose_seed(Ignition(ram_total_gb=4), {})
    # hint=1 fits both 0.5b and 1b entries; choose_seed picks the largest fitting
    fitting = [m for m in seed._DEFAULT_SEED_MODELS if m.get("b", 1) <= 1]
    assert name == fitting[-1]["name"]


# --- list_models -----------------------------------------------------------

def test_list_models_empty_when_no_binary(monkeypatch):
    monkeypatch.setattr(seed.shutil, "which", lambda _n: None)
    assert seed.list_models() == []


def test_list_models_parses_and_skips_header(monkeypatch):
    monkeypatch.setattr(seed.shutil, "which", lambda _n: "/bin/ollama")
    out = "NAME           ID   SIZE\nllama3.2:1b  a  1G\ngemma2:2b  b  2G"
    monkeypatch.setattr(seed.subprocess, "run", lambda *a, **k: FakeCompleted(0, out))
    assert seed.list_models() == ["llama3.2:1b", "gemma2:2b"]


def test_list_models_empty_on_error(monkeypatch):
    monkeypatch.setattr(seed.shutil, "which", lambda _n: "/bin/ollama")
    monkeypatch.setattr(seed.subprocess, "run", lambda *a, **k: FakeCompleted(1, ""))
    assert seed.list_models() == []


# --- ensure_seed_model -----------------------------------------------------

def test_ensure_seed_model_returns_existing(monkeypatch, rec_audit, gate_no):
    monkeypatch.setattr(seed, "list_models", lambda: ["already:here"])
    out = seed.ensure_seed_model(gate_no, rec_audit, Ignition(), {})
    assert out == "already:here"
    assert "seed.present" in rec_audit.names


def test_ensure_seed_model_none_when_binary_missing(monkeypatch, rec_audit, gate_yes):
    monkeypatch.setattr(seed, "list_models", lambda: [])
    monkeypatch.setattr(seed.shutil, "which", lambda _n: None)
    assert seed.ensure_seed_model(gate_yes, rec_audit, Ignition(), {}) is None


def test_ensure_seed_model_declined_returns_none(monkeypatch, rec_audit, gate_no):
    monkeypatch.setattr(seed, "list_models", lambda: [])
    monkeypatch.setattr(seed.shutil, "which", lambda _n: "/bin/ollama")
    assert seed.ensure_seed_model(gate_no, rec_audit, Ignition(ram_total_gb=8), {}) is None
    assert "seed.pull_start" not in rec_audit.names


def test_ensure_seed_model_pull_success(monkeypatch, rec_audit, gate_yes):
    monkeypatch.setattr(seed, "list_models", lambda: [])
    monkeypatch.setattr(seed.shutil, "which", lambda _n: "/bin/ollama")
    monkeypatch.setattr(seed.subprocess, "run", lambda *a, **k: FakeCompleted(0))
    out = seed.ensure_seed_model(gate_yes, rec_audit, Ignition(ram_total_gb=8), {})
    assert out  # a model name
    assert "seed.pull_done" in rec_audit.names
    assert rec_audit.data_for("seed.pull_done")["ok"] is True


def test_ensure_seed_model_pull_nonzero_returns_none(monkeypatch, rec_audit, gate_yes):
    monkeypatch.setattr(seed, "list_models", lambda: [])
    monkeypatch.setattr(seed.shutil, "which", lambda _n: "/bin/ollama")
    monkeypatch.setattr(seed.subprocess, "run", lambda *a, **k: FakeCompleted(1))
    assert seed.ensure_seed_model(gate_yes, rec_audit, Ignition(ram_total_gb=8), {}) is None


def test_ensure_seed_model_pull_exception_audited(monkeypatch, rec_audit, gate_yes):
    monkeypatch.setattr(seed, "list_models", lambda: [])
    monkeypatch.setattr(seed.shutil, "which", lambda _n: "/bin/ollama")

    def _boom(*a, **k):
        raise OSError("exec format error")

    monkeypatch.setattr(seed.subprocess, "run", _boom)
    assert seed.ensure_seed_model(gate_yes, rec_audit, Ignition(ram_total_gb=8), {}) is None
    assert "seed.pull_failed" in rec_audit.names
