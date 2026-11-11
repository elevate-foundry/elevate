"""Consent gate contracts -- the heart of the safety model.

Every side effect in famulus passes through Gate.confirm/ask, so these lock the
exact behavior the plan promises:
  * --turbo auto-allows ONLY non-forced actions,
  * network/EXEC-class actions (force_prompt) ALWAYS prompt, even under --turbo,
  * non-interactive / no-TTY contexts FAIL CLOSED (deny),
  * yes/no parsing is strict, and
  * every request + decision is written to the audit log (secret values are not).
"""

from __future__ import annotations

import builtins

import pytest

from famulus.safety import gate as gate_mod
from famulus.safety.gate import Gate


class RecAudit:
    def __init__(self):
        self.events = []

    def record(self, event, **data):
        self.events.append((event, data))

    @property
    def names(self):
        return [e for e, _ in self.events]

    def last(self):
        return self.events[-1]


def make_gate(monkeypatch, *, turbo=False, noninteractive=False, tty=True, answer="y"):
    audit = RecAudit()
    g = Gate(audit, turbo=turbo, noninteractive=noninteractive)
    monkeypatch.setattr(g, "_has_tty", lambda: tty)
    monkeypatch.setattr(builtins, "input", lambda prompt="": answer)
    return g, audit


def test_confirm_always_records_request(monkeypatch):
    g, audit = make_gate(monkeypatch, turbo=True)
    g.confirm("read a file")
    assert "gate.request" in audit.names


def test_turbo_autoallows_nonforced(monkeypatch):
    g, audit = make_gate(monkeypatch, turbo=True)
    assert g.confirm("read a file") is True
    assert "gate.auto_allow" in audit.names


def test_turbo_still_prompts_for_forced_action(monkeypatch):
    g, audit = make_gate(monkeypatch, turbo=True, answer="n")
    # force_prompt = network/EXEC class -> must prompt even under turbo.
    assert g.confirm("install software", force_prompt=True) is False
    assert "gate.auto_allow" not in audit.names
    assert "gate.decision" in audit.names


def test_noninteractive_fails_closed(monkeypatch):
    g, audit = make_gate(monkeypatch, noninteractive=True)
    assert g.confirm("do thing") is False
    assert audit.last()[0] == "gate.deny"
    assert audit.last()[1]["reason"] == "noninteractive_fail_closed"


def test_no_tty_fails_closed(monkeypatch):
    g, audit = make_gate(monkeypatch, tty=False)
    assert g.confirm("do thing") is False
    assert "gate.deny" in audit.names


@pytest.mark.parametrize(
    "answer,expected",
    [("y", True), ("yes", True), ("Y", True), ("YES", True),
     ("n", False), ("no", False), ("", False), ("maybe", False), ("yep", False)],
)
def test_interactive_yes_no_parsing(monkeypatch, answer, expected):
    g, audit = make_gate(monkeypatch, answer=answer)
    assert g.confirm("proceed?") is expected
    decision = [d for e, d in audit.events if e == "gate.decision"][0]
    assert decision["allowed"] is expected


def test_confirm_handles_eof_as_deny(monkeypatch):
    g, audit = make_gate(monkeypatch)

    def _raise(_prompt=""):
        raise EOFError

    monkeypatch.setattr(builtins, "input", _raise)
    assert g.confirm("proceed?") is False


def test_ask_returns_value_and_records(monkeypatch):
    g, audit = make_gate(monkeypatch, answer="MyWifi")
    assert g.ask("SSID") == "MyWifi"
    ask_events = [d for e, d in audit.events if e == "gate.ask"]
    assert ask_events and ask_events[0]["provided"] is True


def test_ask_secret_uses_getpass_and_does_not_log_value(monkeypatch):
    g, audit = make_gate(monkeypatch)
    monkeypatch.setattr(gate_mod, "getpass", lambda prompt="": "hunter2")
    assert g.ask("Password", secret=True) == "hunter2"
    ask = [d for e, d in audit.events if e == "gate.ask"][0]
    assert ask["secret"] is True
    # The audit must record only that a value was provided, never the value.
    assert "hunter2" not in str(audit.events)


def test_ask_empty_input_is_none(monkeypatch):
    g, _ = make_gate(monkeypatch, answer="")
    assert g.ask("SSID") is None


def test_ask_noninteractive_returns_none_and_records_skip(monkeypatch):
    g, audit = make_gate(monkeypatch, noninteractive=True)
    assert g.ask("SSID") is None
    assert "gate.ask_skipped" in audit.names
