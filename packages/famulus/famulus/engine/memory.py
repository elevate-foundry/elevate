"""Conversation memory and context management.

Keeps the rolling message history within a token budget, persists
conversations to disk for resumption, and manages the system prompt.

The system prompt is built dynamically at startup from real system facts
and the actual tool registry, so the model knows exactly what it can do.
"""

from __future__ import annotations

import json
import os
import platform
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .capability import ToolSpec
from .model import Message


# ---------------------------------------------------------------------------
# Dynamic system prompt builder
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_TEMPLATE = """\
You are famulus, a private local AI assistant. You are NOT running in the cloud
or in a sandbox. You are running directly on the user's physical computer as a
local process, using Ollama as your inference engine. You have real access to
the user's real filesystem and can execute real shell commands on their machine.

## System facts
{system_facts}

## Your tools
You have EXACTLY the tools listed below. Do NOT claim capabilities you do not
have. If a task cannot be done with these tools, say so honestly.

{tool_manifest}

## Tool chaining
You can call multiple tools in sequence within a single turn. For example, you
can list a directory, then read a file from that listing, then grep its
contents — all in one conversation turn. Plan your tool calls step by step.

{model_roster}

## Rules
1. You MUST use tools to answer questions about the system — do not guess or
   fabricate file contents, command output, or system state.
2. Every action that changes the system (writing files, running commands) will
   be shown to the human for approval before execution. Do not assume approval.
3. Be concise and direct. State what you intend to do before doing it.
4. If you are unsure, ask. Never guess at destructive actions.
5. You run offline by default. You do not have internet access unless the user
   explicitly tells you otherwise.
6. Never claim you are sandboxed, isolated, or running in the cloud. You are
   local. Be honest about your capabilities and limitations.
{user_section}\
"""


def gather_system_facts() -> dict[str, str]:
    """Probe the host for basic facts the model should know."""
    return {
        "hostname": socket.gethostname(),
        "os": f"{platform.system()} {platform.release()}",
        "arch": platform.machine(),
        "user": os.environ.get("USER", os.environ.get("USERNAME", "unknown")),
        "home": str(Path.home()),
        "cwd": os.getcwd(),
        "shell": os.environ.get("SHELL", "unknown"),
    }


def _format_system_facts(facts: dict[str, str]) -> str:
    """Format system facts as a readable block for the prompt."""
    lines = [f"- **{k}**: {v}" for k, v in facts.items()]
    return "\n".join(lines)


def _format_tool_manifest(tools: list[ToolSpec]) -> str:
    """Format the tool list as a readable manifest for the prompt."""
    if not tools:
        return "(no tools available)"
    lines = []
    by_tier: dict[str, list[ToolSpec]] = {}
    for t in tools:
        tier_name = t.tier.name
        by_tier.setdefault(tier_name, []).append(t)
    for tier_name in ("READ", "WRITE", "EXEC"):
        tier_tools = by_tier.get(tier_name, [])
        if not tier_tools:
            continue
        lines.append(f"### {tier_name} tier")
        for t in tier_tools:
            params = ", ".join(
                f"{p}" + (" (required)" if d.get("required") else "")
                for p, d in t.parameters.items()
            )
            lines.append(f"- **{t.name}**({params}): {t.description}")
    return "\n".join(lines)


def _format_model_roster(model_roster: dict[str, list[str]] | None) -> str:
    """Format the available specialist models for the prompt.

    model_roster maps modality name -> list of model names.
    """
    if not model_roster:
        return ""
    lines = ["## Available specialist models",
             "Other models are available on this machine for specific tasks:"]
    for modality, models in model_roster.items():
        lines.append(f"- **{modality}**: {', '.join(models[:3])}")
    lines.append("The system will automatically route to these when appropriate.")
    return "\n".join(lines)


def build_system_prompt(
    tools: list[ToolSpec] | None = None,
    system_facts: dict[str, str] | None = None,
    user_name: str = "",
    model_roster: dict[str, list[str]] | None = None,
) -> str:
    """Build the complete system prompt from live data.

    This is called once at session start. The model sees exactly what tools
    it has, what machine it's on, and who it's talking to.

    Parameters
    ----------
    tools : list of ToolSpec, optional
        The full tool registry (built-in + MCP).
    system_facts : dict, optional
        Host facts. Gathered automatically if not provided.
    user_name : str
        The human's name, if known.
    model_roster : dict mapping modality -> model names, optional
        Specialist models available for dispatch.
    """
    facts = system_facts or gather_system_facts()
    user_section = ""
    if user_name:
        user_section = f"\nThe user's name is {user_name}. Address them by name occasionally.\n"

    return _SYSTEM_PROMPT_TEMPLATE.format(
        system_facts=_format_system_facts(facts),
        tool_manifest=_format_tool_manifest(tools or []),
        model_roster=_format_model_roster(model_roster),
        user_section=user_section,
    )


# Keep a simple default for tests that don't inject tools
_DEFAULT_SYSTEM_PROMPT = build_system_prompt()


@dataclass
class ConversationMemory:
    """Manages message history with a rolling window."""

    messages: list[Message] = field(default_factory=list)
    system_prompt: str = _DEFAULT_SYSTEM_PROMPT
    max_messages: int = 100

    def __post_init__(self) -> None:
        if not self.messages:
            self.messages = [Message(role="system", content=self.system_prompt)]

    def add_user(self, content: str) -> None:
        self.messages.append(Message(role="user", content=content))
        self._trim()

    def add_assistant(self, content: str, tool_calls: list[dict[str, Any]] | None = None) -> None:
        self.messages.append(Message(
            role="assistant",
            content=content,
            tool_calls=tool_calls or [],
        ))
        self._trim()

    def add_tool_result(self, tool_call_id: str, content: str) -> None:
        self.messages.append(Message(
            role="tool",
            content=content,
            tool_call_id=tool_call_id,
        ))
        self._trim()

    def _trim(self) -> None:
        """Keep the system message + last N messages."""
        if len(self.messages) <= self.max_messages:
            return
        system = self.messages[0] if self.messages and self.messages[0].role == "system" else None
        tail = self.messages[-(self.max_messages - 1):]
        self.messages = ([system] if system else []) + tail

    def to_messages(self) -> list[Message]:
        return list(self.messages)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = [m.to_dict() for m in self.messages]
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> ConversationMemory:
        if not path.is_file():
            return cls()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return cls()
        messages = [
            Message(
                role=m.get("role", "user"),
                content=m.get("content", ""),
                tool_calls=m.get("tool_calls", []),
                tool_call_id=m.get("tool_call_id", ""),
            )
            for m in data
        ]
        mem = cls.__new__(cls)
        mem.messages = messages
        mem.system_prompt = messages[0].content if messages and messages[0].role == "system" else _DEFAULT_SYSTEM_PROMPT
        mem.max_messages = 100
        return mem

    def update_system_prompt(self, new_prompt: str) -> None:
        """Replace the system prompt (e.g. after learning the user's name)."""
        self.system_prompt = new_prompt
        if self.messages and self.messages[0].role == "system":
            self.messages[0] = Message(role="system", content=new_prompt)
        else:
            self.messages.insert(0, Message(role="system", content=new_prompt))

    def clear(self) -> None:
        self.messages = [Message(role="system", content=self.system_prompt)]
