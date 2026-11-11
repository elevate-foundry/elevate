"""Connectivity ladder: reachability checks, captive-portal detection, wifi
scan parsing, and the 'already online' short-circuit."""

from __future__ import annotations

from famulus.bootstrap import connectivity
from famulus.bootstrap.ignition import Ignition


class _CM:
    """Minimal context manager stand-in for a socket / urlopen response."""

    def __init__(self, status=None):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


# --- is_online -------------------------------------------------------------

def test_is_online_true_on_first_success(monkeypatch):
    monkeypatch.setattr(connectivity.socket, "create_connection", lambda *a, **k: _CM())
    assert connectivity.is_online() is True


def test_is_online_false_when_all_targets_fail(monkeypatch):
    def _refuse(*a, **k):
        raise OSError("network unreachable")

    monkeypatch.setattr(connectivity.socket, "create_connection", _refuse)
    assert connectivity.is_online() is False


# --- captive portal --------------------------------------------------------

def test_captive_portal_false_on_204(monkeypatch):
    monkeypatch.setattr(connectivity.urllib.request, "urlopen", lambda *a, **k: _CM(status=204))
    assert connectivity.detect_captive_portal() is False


def test_captive_portal_true_on_non_204(monkeypatch):
    monkeypatch.setattr(connectivity.urllib.request, "urlopen", lambda *a, **k: _CM(status=200))
    assert connectivity.detect_captive_portal() is True


def test_captive_portal_false_on_exception(monkeypatch):
    def _boom(*a, **k):
        raise OSError("no route")

    monkeypatch.setattr(connectivity.urllib.request, "urlopen", _boom)
    assert connectivity.detect_captive_portal() is False


# --- wifi scan parsing -----------------------------------------------------

def test_scan_wifi_linux_dedupes_and_drops_blanks(monkeypatch):
    monkeypatch.setattr(connectivity, "_run", lambda cmd, timeout=30.0: (True, "HomeNet\n\nCafe\nHomeNet"))
    out = connectivity._scan_wifi(Ignition(os="Linux"))
    assert out == ["HomeNet", "Cafe"]


def test_scan_wifi_darwin_parses_system_profiler(monkeypatch):
    sp = "          MyNetwork:\n            PHY Mode: 802.11\n          Other:\n"
    monkeypatch.setattr(connectivity, "_run", lambda cmd, timeout=30.0: (True, sp))
    out = connectivity._scan_wifi(Ignition(os="Darwin"))
    assert "MyNetwork" in out and "Other" in out


def test_scan_wifi_unknown_os_empty():
    assert connectivity._scan_wifi(Ignition(os="Plan9")) == []


# --- ensure_connectivity short-circuit ------------------------------------

def test_ensure_connectivity_returns_true_when_already_online(monkeypatch, rec_audit, gate_no):
    monkeypatch.setattr(connectivity, "is_online", lambda: True)
    assert connectivity.ensure_connectivity(gate_no, rec_audit, Ignition(os="Linux"), {}) is True
    assert "connectivity.start" in rec_audit.names
    # No gate prompts should have happened on the happy path.
    assert gate_no.confirms == []
