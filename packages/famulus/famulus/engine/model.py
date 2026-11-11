"""Ollama model interface.

Wraps Ollama's HTTP API (localhost:11434) for chat completions with tool
calling. Uses only the stdlib so the engine can degrade gracefully; httpx
is used when available for better streaming support.

The model interface is deliberately thin: it sends messages, parses tool
calls from the response, and returns structured output. All intelligence
about *what* to do lives in the agent loop, not here.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


_OLLAMA_BASE = "http://127.0.0.1:11434"


@dataclass
class Message:
    role: str  # "system", "user", "assistant", "tool"
    content: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    tool_call_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"role": self.role, "content": self.content}
        if self.tool_calls:
            d["tool_calls"] = self.tool_calls
        if self.tool_call_id:
            d["tool_call_id"] = self.tool_call_id
        return d


@dataclass
class ModelResponse:
    """Parsed model output."""
    content: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    model: str = ""
    done: bool = True
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def has_tool_calls(self) -> bool:
        return bool(self.tool_calls)


def list_local_models(base_url: str = _OLLAMA_BASE) -> list[dict[str, Any]]:
    """Return the list of locally available models from Ollama."""
    try:
        req = urllib.request.Request(f"{base_url}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("models", [])
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return []


def chat(
    model: str,
    messages: list[Message],
    tools: list[dict[str, Any]] | None = None,
    base_url: str = _OLLAMA_BASE,
    temperature: float = 0.7,
    timeout: float = 120.0,
) -> ModelResponse:
    """Send a chat completion request to Ollama and return the parsed response.

    If ``tools`` is provided, the model may return tool_calls in its response
    instead of (or alongside) text content.
    """
    payload: dict[str, Any] = {
        "model": model,
        "messages": [m.to_dict() for m in messages],
        "stream": False,
        "options": {"temperature": temperature},
    }
    if tools:
        payload["tools"] = tools

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except (OSError, urllib.error.URLError) as exc:
        return ModelResponse(content=f"[error: cannot reach Ollama: {exc}]", done=True)
    except json.JSONDecodeError:
        return ModelResponse(content="[error: invalid JSON from Ollama]", done=True)

    msg = raw.get("message", {})
    tool_calls = msg.get("tool_calls", [])

    return ModelResponse(
        content=msg.get("content", ""),
        tool_calls=tool_calls,
        model=raw.get("model", model),
        done=raw.get("done", True),
        raw=raw,
    )


def chat_stream(
    model: str,
    messages: list[Message],
    on_delta: Callable[[str], None],
    tools: list[dict[str, Any]] | None = None,
    base_url: str = _OLLAMA_BASE,
    temperature: float = 0.7,
    timeout: float = 120.0,
) -> ModelResponse:
    payload: dict[str, Any] = {
        "model": model,
        "messages": [m.to_dict() for m in messages],
        "stream": True,
        "options": {"temperature": temperature},
    }
    if tools:
        payload["tools"] = tools

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    content_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    last_raw: dict[str, Any] = {}
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for line in resp:
                if not line.strip():
                    continue
                raw = json.loads(line.decode("utf-8"))
                last_raw = raw
                msg = raw.get("message", {})
                delta = msg.get("content", "")
                if delta:
                    content_parts.append(delta)
                    on_delta(delta)
                if msg.get("tool_calls"):
                    tool_calls.extend(msg.get("tool_calls", []))
    except (OSError, urllib.error.URLError) as exc:
        return ModelResponse(content=f"[error: cannot reach Ollama: {exc}]", done=True)
    except json.JSONDecodeError:
        return ModelResponse(content="[error: invalid JSON from Ollama]", done=True)

    return ModelResponse(
        content="".join(content_parts),
        tool_calls=tool_calls,
        model=last_raw.get("model", model),
        done=last_raw.get("done", True),
        raw=last_raw,
    )


def show_model(name: str, base_url: str = _OLLAMA_BASE) -> dict[str, Any]:
    """Call /api/show to get full model metadata including capabilities."""
    body = json.dumps({"name": name}).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/show",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return {}


def format_tools_for_ollama(tool_specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert our ToolSpec dicts into Ollama's tool-calling format."""
    ollama_tools = []
    for spec in tool_specs:
        properties = {}
        required = []
        for pname, pdef in spec.get("parameters", {}).items():
            properties[pname] = {"type": pdef.get("type", "string"), "description": pdef.get("description", "")}
            if pdef.get("required", False):
                required.append(pname)

        ollama_tools.append({
            "type": "function",
            "function": {
                "name": spec["name"],
                "description": spec.get("description", ""),
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                },
            },
        })
    return ollama_tools
