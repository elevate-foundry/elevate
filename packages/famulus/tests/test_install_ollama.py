"""Ollama acquisition chain: presence short-circuit, offline cache, verified
download (incl. the critical checksum gate), and fallback ordering."""

from __future__ import annotations

import hashlib
import io

from famulus.bootstrap import install_ollama as io_mod
from famulus.bootstrap.ignition import Ignition


class _BytesCM:
    def __init__(self, data: bytes):
        self._b = io.BytesIO(data)

    def __enter__(self):
        return self._b

    def __exit__(self, *a):
        return False


# --- ensure_ollama short-circuit + ordering --------------------------------

def test_ensure_ollama_present(monkeypatch, rec_audit, gate_no):
    monkeypatch.setattr(io_mod.shutil, "which", lambda _n: "/usr/bin/ollama")
    assert io_mod.ensure_ollama(gate_no, rec_audit, Ignition(), {}) is True
    assert "ollama.present" in rec_audit.names


def test_ensure_ollama_tries_chain_in_order_until_success(monkeypatch, rec_audit, gate_yes):
    monkeypatch.setattr(io_mod.shutil, "which", lambda _n: None)
    calls = []
    monkeypatch.setattr(io_mod, "_try_cache", lambda *a: calls.append("cache") or False)
    monkeypatch.setattr(io_mod, "_try_verified_download", lambda *a: calls.append("dl") or False)
    monkeypatch.setattr(io_mod, "_try_official_one_liner", lambda *a: calls.append("one") or True)
    monkeypatch.setattr(io_mod, "_verify_installed", lambda _a: True)
    assert io_mod.ensure_ollama(gate_yes, rec_audit, Ignition(), {}) is True
    assert calls == ["cache", "dl", "one"]


def test_ensure_ollama_all_methods_fail(monkeypatch, rec_audit, gate_yes):
    monkeypatch.setattr(io_mod.shutil, "which", lambda _n: None)
    monkeypatch.setattr(io_mod, "_try_cache", lambda *a: False)
    monkeypatch.setattr(io_mod, "_try_verified_download", lambda *a: False)
    monkeypatch.setattr(io_mod, "_try_official_one_liner", lambda *a: False)
    assert io_mod.ensure_ollama(gate_yes, rec_audit, Ignition(), {}) is False
    assert "ollama.install_failed" in rec_audit.names


# --- _cache_dir ------------------------------------------------------------

def test_cache_dir_prefers_explicit_env(monkeypatch, tmp_path):
    monkeypatch.setenv("FAMULUS_CACHE", str(tmp_path))
    assert io_mod._cache_dir() == tmp_path


def test_cache_dir_falls_back_to_root_cache(monkeypatch, tmp_path):
    monkeypatch.delenv("FAMULUS_CACHE", raising=False)
    cache = tmp_path / "config" / "cache"
    cache.mkdir(parents=True)
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))
    assert io_mod._cache_dir() == cache


def test_cache_dir_none_when_absent(monkeypatch, tmp_path):
    monkeypatch.delenv("FAMULUS_CACHE", raising=False)
    monkeypatch.setenv("FAMULUS_ROOT", str(tmp_path))  # has no config/cache
    assert io_mod._cache_dir() is None


# --- _try_cache ------------------------------------------------------------

def test_try_cache_no_installer(monkeypatch, tmp_path, rec_audit, gate_yes):
    monkeypatch.setenv("FAMULUS_CACHE", str(tmp_path))
    assert io_mod._try_cache(gate_yes, rec_audit, Ignition()) is False


def test_try_cache_declined(monkeypatch, tmp_path, rec_audit, gate_no):
    monkeypatch.setenv("FAMULUS_CACHE", str(tmp_path))
    (tmp_path / "ollama.sh").write_text("#!/bin/sh\n")
    assert io_mod._try_cache(gate_no, rec_audit, Ignition()) is False


def test_try_cache_installs_when_allowed(monkeypatch, tmp_path, rec_audit, gate_yes):
    monkeypatch.setenv("FAMULUS_CACHE", str(tmp_path))
    (tmp_path / "ollama.sh").write_text("#!/bin/sh\n")
    monkeypatch.setattr(io_mod, "_install_artifact", lambda ig, path: True)
    assert io_mod._try_cache(gate_yes, rec_audit, Ignition()) is True
    assert "ollama.cache_install" in rec_audit.names


# --- _try_verified_download (checksum gate) --------------------------------

def test_verified_download_no_manifest(rec_audit, gate_yes):
    assert io_mod._try_verified_download(gate_yes, rec_audit, Ignition(os="Linux", arch="x86_64"), {}) is False


def test_verified_download_checksum_match_installs(monkeypatch, rec_audit, gate_yes):
    payload = b"installer-bytes"
    sha = hashlib.sha256(payload).hexdigest()
    monkeypatch.setattr(io_mod.urllib.request, "urlopen", lambda *a, **k: _BytesCM(payload))
    monkeypatch.setattr(io_mod, "_install_artifact", lambda ig, path: True)
    cfg = {"ollama_sources": {"linux/x86_64": {"url": "http://x/installer.sh", "sha256": sha}}}
    ig = Ignition(os="Linux", arch="x86_64")
    assert io_mod._try_verified_download(gate_yes, rec_audit, ig, cfg) is True
    assert "ollama.downloaded" in rec_audit.names


def test_verified_download_checksum_mismatch_aborts(monkeypatch, rec_audit, gate_yes):
    payload = b"installer-bytes"
    monkeypatch.setattr(io_mod.urllib.request, "urlopen", lambda *a, **k: _BytesCM(payload))
    installed = []
    monkeypatch.setattr(io_mod, "_install_artifact", lambda ig, path: installed.append(1) or True)
    cfg = {"ollama_sources": {"linux/x86_64": {"url": "http://x/installer.sh", "sha256": "deadbeef"}}}
    ig = Ignition(os="Linux", arch="x86_64")
    assert io_mod._try_verified_download(gate_yes, rec_audit, ig, cfg) is False
    assert "ollama.checksum_mismatch" in rec_audit.names
    assert installed == []  # never installed an artifact that failed its checksum


# --- _sha256 / _install_artifact ------------------------------------------

def test_sha256_matches_hashlib(tmp_path):
    f = tmp_path / "blob"
    f.write_bytes(b"abc123")
    assert io_mod._sha256(f) == hashlib.sha256(b"abc123").hexdigest()


def test_install_artifact_shell_script(monkeypatch, tmp_path):
    captured = {}
    def fake_run_live(cmd, **_k):
        captured["cmd"] = cmd
        return True

    monkeypatch.setattr(io_mod, "_run_live", fake_run_live)
    script = tmp_path / "x.sh"
    script.write_text("#!/bin/sh\n")
    assert io_mod._install_artifact(Ignition(), script) is True
    assert captured["cmd"][0] == "sh"


def test_install_artifact_unknown_type(tmp_path):
    f = tmp_path / "mystery.xyz"
    f.write_text("?")
    assert io_mod._install_artifact(Ignition(), f) is False
