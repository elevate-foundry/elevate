"""Shared test fixtures and lightweight fakes.

The bootstrap modules only ever call two collaborators -- the audit log and the
consent gate -- through tiny interfaces, so we stand them in with recording
fakes. This keeps the orchestration tests fast, deterministic, and free of real
prompts / subprocesses.
"""

from __future__ import annotations

import pytest


class RecordingAudit:
    """Stand-in for AuditLog that just remembers what was recorded."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    def record(self, event: str, **data) -> dict:
        self.events.append((event, data))
        return {"event": event, "data": data}

    @property
    def names(self) -> list[str]:
        return [name for name, _ in self.events]

    def data_for(self, event: str) -> dict:
        for name, data in self.events:
            if name == event:
                return data
        raise KeyError(event)


class ScriptedGate:
    """Stand-in for Gate. `confirm` returns a constant or per-call callable;
    `ask` pops from a queue of answers. All calls are recorded."""

    def __init__(self, confirm=True, answers=None) -> None:
        self._confirm = confirm
        self._answers = list(answers or [])
        self.confirms: list[tuple[str, str, bool]] = []
        self.asks: list[tuple[str, bool]] = []

    def confirm(self, action: str, detail: str = "", *, force_prompt: bool = False) -> bool:
        self.confirms.append((action, detail, force_prompt))
        if callable(self._confirm):
            return bool(self._confirm(action))
        return bool(self._confirm)

    def ask(self, prompt: str, *, secret: bool = False):
        self.asks.append((prompt, secret))
        return self._answers.pop(0) if self._answers else None


@pytest.fixture
def rec_audit() -> RecordingAudit:
    return RecordingAudit()


@pytest.fixture
def gate_yes() -> ScriptedGate:
    return ScriptedGate(confirm=True)


@pytest.fixture
def gate_no() -> ScriptedGate:
    return ScriptedGate(confirm=False)
