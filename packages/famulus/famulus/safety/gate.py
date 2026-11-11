"""Human approval gate (bootstrap-grade, stdlib only).

Phase 0 will extend this into the full tool-algebra typecheck. For Phase -1 it
provides consent prompts that:
  * auto-allow only when explicitly safe (READ-ish) under --turbo,
  * ALWAYS prompt for network / EXEC actions even under --turbo (per the plan),
  * fail closed when non-interactive,
  * record every request + decision to the audit log.
"""

from __future__ import annotations

import sys
from getpass import getpass
from typing import Optional

from .audit import AuditLog


class Gate:
    def __init__(
        self,
        audit: AuditLog,
        turbo: bool = False,
        noninteractive: bool = False,
    ):
        self.audit = audit
        self.turbo = turbo
        self.noninteractive = noninteractive

    def _has_tty(self) -> bool:
        try:
            return sys.stdin is not None and sys.stdin.isatty()
        except ValueError:
            return False

    def confirm(
        self,
        action: str,
        detail: str = "",
        *,
        force_prompt: bool = False,
    ) -> bool:
        """Ask permission for an action. force_prompt=True means even --turbo asks
        (used for network + EXEC-class actions)."""
        self.audit.record("gate.request", action=action, detail=detail, force_prompt=force_prompt)

        if self.turbo and not force_prompt:
            self.audit.record("gate.auto_allow", action=action, reason="turbo")
            print(f"  [turbo] auto-allowed: {action}")
            return True

        if self.noninteractive or not self._has_tty():
            self.audit.record("gate.deny", action=action, reason="noninteractive_fail_closed")
            print(f"  [denied: non-interactive] {action}", file=sys.stderr)
            return False

        prompt = f"\n  >> {action}"
        if detail:
            prompt += f"\n     {detail}"
        prompt += "\n     Allow? [y/N] "
        try:
            ans = input(prompt).strip().lower()
        except (EOFError, KeyboardInterrupt):
            ans = ""
        allowed = ans in ("y", "yes")
        self.audit.record("gate.decision", action=action, allowed=allowed)
        return allowed

    def ask(self, prompt: str, *, secret: bool = False) -> Optional[str]:
        """Prompt for a value (e.g. SSID or wifi password). None if unavailable."""
        if self.noninteractive or not self._has_tty():
            self.audit.record("gate.ask_skipped", prompt=prompt, reason="noninteractive")
            return None
        try:
            value = getpass(f"  {prompt}: ") if secret else input(f"  {prompt}: ")
        except (EOFError, KeyboardInterrupt):
            return None
        self.audit.record("gate.ask", prompt=prompt, provided=bool(value), secret=secret)
        return value or None
