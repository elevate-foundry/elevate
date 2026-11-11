"""Ignition probe internals: the command-runner contract and the per-OS parsers.

These have fiddly string parsing (sysctl, /proc, vm_stat, ollama list) that is
exactly where silent breakage hides, so we feed canned outputs and assert the
derived fields.
"""

from __future__ import annotations

import subprocess

import pytest

from famulus.bootstrap import ignition
from famulus.bootstrap.ignition import Ignition


class FakeCompleted:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


# --- _run / _read_text -----------------------------------------------------

def test_run_returns_stripped_stdout_on_success(monkeypatch):
    monkeypatch.setattr(ignition.subprocess, "run", lambda *a, **k: FakeCompleted(0, "  hi \n"))
    assert ignition._run(["whatever"]) == "hi"


def test_run_returns_none_on_nonzero(monkeypatch):
    monkeypatch.setattr(ignition.subprocess, "run", lambda *a, **k: FakeCompleted(1, "out"))
    assert ignition._run(["whatever"]) is None


def test_run_returns_none_on_exception(monkeypatch):
    def _boom(*a, **k):
        raise subprocess.TimeoutExpired(cmd="x", timeout=1)

    monkeypatch.setattr(ignition.subprocess, "run", _boom)
    assert ignition._run(["whatever"]) is None


def test_read_text_missing_file_is_none(tmp_path):
    assert ignition._read_text(str(tmp_path / "nope")) is None


def test_read_text_reads_existing(tmp_path):
    f = tmp_path / "f.txt"
    f.write_text("hello")
    assert ignition._read_text(str(f)) == "hello"


# --- derived helpers -------------------------------------------------------

@pytest.mark.parametrize(
    "ram,expected",
    [(0, 1), (4, 1), (7.9, 1), (8, 3), (15, 3), (16, 4), (31, 4), (32, 8), (128, 8), (None, 1)],
)
def test_seed_size_hint_boundaries(ram, expected):
    assert Ignition(ram_total_gb=ram).seed_size_hint_b() == expected


def test_to_json_roundtrips_with_derived_keys():
    import json

    ig = Ignition(ram_total_gb=16, has_ollama=True, ollama_models=["m"])
    d = json.loads(ig.to_json())
    assert d["needs_bootstrap"] is False
    assert d["seed_size_hint_b"] == 4
    assert d["ram_total_gb"] == 16


# --- _probe_ollama ---------------------------------------------------------

def test_probe_ollama_parses_version_and_models(monkeypatch):
    monkeypatch.setattr(ignition.shutil, "which", lambda name: "/usr/local/bin/" + name)

    def fake_run(cmd, timeout=5.0):
        if cmd[-1] == "--version":
            return "ollama version is 0.17.7"
        if cmd[-1] == "list":
            return "NAME            ID    SIZE\nllama3.2:1b  abc  1GB\nqwen2.5:7b  def  4GB"
        return None

    monkeypatch.setattr(ignition, "_run", fake_run)
    ig = Ignition()
    ignition._probe_ollama(ig)
    assert ig.has_ollama is True
    assert ig.has_curl is True
    assert ig.ollama_version == "0.17.7"
    assert ig.ollama_models == ["llama3.2:1b", "qwen2.5:7b"]


def test_probe_ollama_absent(monkeypatch):
    monkeypatch.setattr(ignition.shutil, "which", lambda name: None)
    ig = Ignition()
    ignition._probe_ollama(ig)
    assert ig.has_ollama is False
    assert ig.ollama_models == []


# --- _probe_linux ----------------------------------------------------------

def test_probe_linux_parses_meminfo_and_release(monkeypatch):
    files = {
        "/etc/os-release": 'PRETTY_NAME="Ubuntu 24.04 LTS"\nID=ubuntu\n',
        "/proc/meminfo": "MemTotal:       16384000 kB\nMemAvailable:    8192000 kB\n",
        "/proc/cpuinfo": "processor\t: 0\nmodel name\t: AMD Ryzen 7\n",
    }
    monkeypatch.setattr(ignition, "_read_text", lambda path: files.get(path))
    ig = Ignition()
    ignition._probe_linux(ig)
    assert ig.os_version == "Ubuntu 24.04 LTS"
    assert ig.ram_total_gb == round(16384000 / (1024 ** 2), 1)
    assert ig.ram_available_gb == round(8192000 / (1024 ** 2), 1)
    assert ig.cpu_brand == "AMD Ryzen 7"


# --- _probe_macos ----------------------------------------------------------

def test_probe_macos_parses_memory_and_cpu(monkeypatch):
    def fake_run(cmd, timeout=5.0):
        joined = " ".join(cmd)
        if "hw.memsize" in joined:
            return str(16 * 1024 ** 3)
        if "machdep.cpu.brand_string" in joined:
            return "Apple M1 Pro"
        if "hw.pagesize" in joined:
            return "16384"
        if cmd[0] == "vm_stat":
            return "Pages free: 100000.\nPages inactive: 50000.\nPages speculative: 10000."
        if cmd[0] == "sw_vers":
            return "15.5"
        return None

    monkeypatch.setattr(ignition, "_run", fake_run)
    ig = Ignition()
    ignition._probe_macos(ig)
    assert ig.os_version == "15.5"
    assert ig.ram_total_gb == 16.0
    assert ig.cpu_brand == "Apple M1 Pro"
    assert ig.ram_available_gb is not None and ig.ram_available_gb > 0


# --- _probe_windows --------------------------------------------------------

def test_probe_windows_parses_total_memory(monkeypatch):
    monkeypatch.setattr(ignition.platform, "version", lambda: "10.0.22631")
    monkeypatch.setenv("PROCESSOR_IDENTIFIER", "Intel64 Family 6")
    monkeypatch.setattr(ignition, "_run", lambda cmd, timeout=5.0: str(8 * 1024 ** 3))
    ig = Ignition()
    ignition._probe_windows(ig)
    assert ig.os_version == "10.0.22631"
    assert ig.cpu_brand == "Intel64 Family 6"
    assert ig.ram_total_gb == 8.0
