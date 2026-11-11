"""Tool algebra: READ -> WRITE -> EXEC capability tiers.

Every tool declares which tier it occupies. The consent gate uses this to
decide what needs human approval:
  * READ  -- observing state, never mutates. Auto-allowed under --turbo.
  * WRITE -- creates or modifies files/data. Always prompted.
  * EXEC  -- runs arbitrary commands, touches network. Always prompted,
             even under --turbo (force_prompt=True).

The ordering is a lattice: READ < WRITE < EXEC. A model's per-session
grant ceiling starts at READ and can only be raised by explicit human
consent, never lowered silently.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


class Tier(enum.IntEnum):
    """Capability tier. Higher value = more dangerous = more consent needed."""
    READ = 0
    WRITE = 1
    EXEC = 2


@dataclass(frozen=True)
class ToolSpec:
    """Immutable descriptor for a registered tool.

    Parameters
    ----------
    name : str
        Unique tool name, e.g. ``"file_read"`` or ``"shell_exec"``.
    tier : Tier
        Capability tier (READ, WRITE, EXEC).
    description : str
        Human-readable one-liner shown to both the model and the human
        during consent prompts.
    parameters : dict
        JSON-Schema-style parameter descriptions. The agent loop uses
        these to validate model output before dispatch.
    fn : callable
        The implementation. Signature: ``(params: dict) -> ToolResult``.
    """
    name: str
    tier: Tier
    description: str
    parameters: dict = field(default_factory=dict)
    fn: Optional[Callable[..., Any]] = None


@dataclass
class ToolResult:
    """Uniform envelope returned by every tool invocation."""
    success: bool
    output: str = ""
    error: str = ""
    truncated: bool = False

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"success": self.success}
        if self.output:
            d["output"] = self.output
        if self.error:
            d["error"] = self.error
        if self.truncated:
            d["truncated"] = True
        return d


class CapGrant:
    """Per-model, per-session capability ceiling.

    Starts at READ. The human can escalate to WRITE or EXEC. Once granted
    the ceiling stays until the session ends (no silent downgrade, but the
    human can revoke via the gate).
    """

    def __init__(self, ceiling: Tier = Tier.READ):
        self._ceiling = ceiling

    @property
    def ceiling(self) -> Tier:
        return self._ceiling

    def escalate(self, to: Tier) -> None:
        if to > self._ceiling:
            self._ceiling = to

    def allows(self, tier: Tier) -> bool:
        return tier <= self._ceiling
