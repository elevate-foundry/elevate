"""Wizard orchestration: config/root resolution and the cold-start decision tree
(probe-only, declined, happy path, and each failure stage)."""

from __future__ import annotations

import json

from famulus.bootstrap import wizard
from famulus.bootstrap.ignition import Ignition


def _fixed_probe(**kw):
    return lambda: Ignition(**kw)


# --- helpers ---------------------------------------------------------------

def test_root_prefers_env(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))
    assert wizard._root() == tmp_path


def test_load_config_reads_json(tmp_path):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "bootstrap.json").write_text('{"k": 1}')
    assert wizard._load_config(tmp_path) == {"k": 1}


def test_load_config_missing_is_empty(tmp_path):
    assert wizard._load_config(tmp_path) == {}


def test_load_config_invalid_json_is_empty(tmp_path):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "bootstrap.json").write_text("{not json")
    assert wizard._load_config(tmp_path) == {}


def test_write_discovered_creates_file(tmp_path):
    wizard._write_discovered(tmp_path, Ignition(os="Linux"))
    out = tmp_path / "config" / "discovered_system.json"
    assert out.is_file()
    assert json.loads(out.read_text())["os"] == "Linux"


# --- main() decision tree --------------------------------------------------

def test_probe_only_returns_zero_and_writes_discovered(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))
    monkeypatch.setattr(wizard, "probe", _fixed_probe(has_ollama=True, ollama_models=["m"]))
    assert wizard.main(["--probe-only"]) == 0
    assert (tmp_path / "config" / "discovered_system.json").is_file()


def test_declined_coldstart_returns_one(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))
    monkeypatch.setattr(wizard, "probe", _fixed_probe(has_ollama=False))
    monkeypatch.setattr(wizard.Gate, "confirm", lambda self, *a, **k: False)
    assert wizard.main([]) == 1


def test_happy_path_returns_zero(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))
    monkeypatch.setattr(wizard, "probe", _fixed_probe(has_ollama=False))
    monkeypatch.setattr(wizard.Gate, "confirm", lambda self, *a, **k: True)
    monkeypatch.setattr(wizard.connectivity, "is_online", lambda: True)
    monkeypatch.setattr(wizard.install_ollama, "ensure_ollama", lambda *a: True)
    monkeypatch.setattr(wizard.seed, "ensure_seed_model", lambda *a: "llama3.2:1b")
    assert wizard.main([]) == 0


def test_ollama_failure_returns_two(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))
    monkeypatch.setattr(wizard, "probe", _fixed_probe(has_ollama=False))
    monkeypatch.setattr(wizard.Gate, "confirm", lambda self, *a, **k: True)
    monkeypatch.setattr(wizard.connectivity, "is_online", lambda: True)
    monkeypatch.setattr(wizard.install_ollama, "ensure_ollama", lambda *a: False)
    assert wizard.main([]) == 2


def test_seed_failure_returns_three(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))
    monkeypatch.setattr(wizard, "probe", _fixed_probe(has_ollama=False))
    monkeypatch.setattr(wizard.Gate, "confirm", lambda self, *a, **k: True)
    monkeypatch.setattr(wizard.connectivity, "is_online", lambda: True)
    monkeypatch.setattr(wizard.install_ollama, "ensure_ollama", lambda *a: True)
    monkeypatch.setattr(wizard.seed, "ensure_seed_model", lambda *a: None)
    assert wizard.main([]) == 3


def test_skips_when_already_provisioned(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))
    monkeypatch.setattr(wizard, "probe", _fixed_probe(has_ollama=True, ollama_models=["llama3.2:1b"]))
    assert wizard.main([]) == 0
