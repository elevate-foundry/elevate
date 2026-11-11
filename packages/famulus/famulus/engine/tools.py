"""Tool registry and built-in tools.

Each tool is a ToolSpec with a tier, a description, a parameter schema,
and an implementation function. The registry is the single source of truth
for what the agent can do.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from .capability import Tier, ToolResult, ToolSpec

_MAX_OUTPUT = 8192


class ToolRegistry:
    """Manages the set of available tools."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def all(self) -> list[ToolSpec]:
        return list(self._tools.values())

    def names(self) -> list[str]:
        return list(self._tools.keys())

    def for_model_prompt(self) -> list[dict[str, Any]]:
        """Return tool descriptions formatted for inclusion in a model prompt."""
        out = []
        for t in self._tools.values():
            out.append({
                "name": t.name,
                "tier": t.tier.name,
                "description": t.description,
                "parameters": t.parameters,
            })
        return out


def _truncate(text: str, limit: int = _MAX_OUTPUT) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[:limit] + "\n... (truncated)", True


# ---------------------------------------------------------------------------
# Built-in tools
# ---------------------------------------------------------------------------

def _file_read(params: dict) -> ToolResult:
    """Read a file's contents."""
    path = params.get("path", "")
    if not path:
        return ToolResult(success=False, error="missing 'path' parameter")
    p = Path(path).expanduser()
    if not p.is_file():
        return ToolResult(success=False, error=f"not a file: {p}")
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return ToolResult(success=False, error=str(exc))
    text, trunc = _truncate(text)
    return ToolResult(success=True, output=text, truncated=trunc)


def _file_write(params: dict) -> ToolResult:
    """Write content to a file (creates parent dirs)."""
    path = params.get("path", "")
    content = params.get("content", "")
    if not path:
        return ToolResult(success=False, error="missing 'path' parameter")
    p = Path(path).expanduser()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
    except OSError as exc:
        return ToolResult(success=False, error=str(exc))
    return ToolResult(success=True, output=f"wrote {len(content)} bytes to {p}")


def _list_dir(params: dict) -> ToolResult:
    """List a directory's contents."""
    path = params.get("path", ".")
    p = Path(path).expanduser()
    if not p.is_dir():
        return ToolResult(success=False, error=f"not a directory: {p}")
    try:
        entries = sorted(str(e.name) + ("/" if e.is_dir() else "") for e in p.iterdir())
    except OSError as exc:
        return ToolResult(success=False, error=str(exc))
    text, trunc = _truncate("\n".join(entries))
    return ToolResult(success=True, output=text, truncated=trunc)


def _shell_exec(params: dict) -> ToolResult:
    """Execute a shell command and return stdout+stderr."""
    command = params.get("command", "")
    if not command:
        return ToolResult(success=False, error="missing 'command' parameter")
    timeout = min(params.get("timeout", 30), 120)
    cwd = params.get("cwd") or None
    try:
        proc = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )
    except subprocess.TimeoutExpired:
        return ToolResult(success=False, error=f"command timed out after {timeout}s")
    except OSError as exc:
        return ToolResult(success=False, error=str(exc))
    combined = (proc.stdout + proc.stderr).strip()
    text, trunc = _truncate(combined)
    return ToolResult(
        success=proc.returncode == 0,
        output=text,
        error="" if proc.returncode == 0 else f"exit code {proc.returncode}",
        truncated=trunc,
    )


def _search_files(params: dict) -> ToolResult:
    """Search for files by name pattern under a directory."""
    pattern = params.get("pattern", "")
    path = params.get("path", ".")
    if not pattern:
        return ToolResult(success=False, error="missing 'pattern' parameter")
    p = Path(path).expanduser()
    if not p.is_dir():
        return ToolResult(success=False, error=f"not a directory: {p}")
    try:
        matches = sorted(str(m) for m in p.rglob(pattern))[:50]
    except OSError as exc:
        return ToolResult(success=False, error=str(exc))
    text, trunc = _truncate("\n".join(matches) if matches else "(no matches)")
    return ToolResult(success=True, output=text, truncated=trunc)


def _grep(params: dict) -> ToolResult:
    """Search file contents for a text pattern."""
    query = params.get("query", "")
    path = params.get("path", ".")
    if not query:
        return ToolResult(success=False, error="missing 'query' parameter")
    try:
        proc = subprocess.run(
            ["grep", "-rn", "--include=*", "-m", "50", query, path],
            capture_output=True, text=True, timeout=15, check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return ToolResult(success=False, error=str(exc))
    text, trunc = _truncate(proc.stdout.strip() or "(no matches)")
    return ToolResult(success=True, output=text, truncated=trunc)


def _python_eval(params: dict) -> ToolResult:
    """Evaluate a Python expression and return the result."""
    expr = params.get("expression", "")
    if not expr:
        return ToolResult(success=False, error="missing 'expression' parameter")
    try:
        result = eval(expr, {"__builtins__": {}}, {})  # noqa: S307
    except Exception as exc:
        return ToolResult(success=False, error=f"{type(exc).__name__}: {exc}")
    text, trunc = _truncate(str(result))
    return ToolResult(success=True, output=text, truncated=trunc)


# ---------------------------------------------------------------------------
# Default registry
# ---------------------------------------------------------------------------

def default_registry(extended: bool = True) -> ToolRegistry:
    """Return a registry populated with the built-in tools.

    If extended=True (default), also registers the full extended toolset
    (SQLite, logs, services, LAN, sensors, camera, GUI, etc.).
    """
    reg = ToolRegistry()
    reg.register(ToolSpec(
        name="file_read",
        tier=Tier.READ,
        description="Read the contents of a file at the given path.",
        parameters={"path": {"type": "string", "required": True}},
        fn=_file_read,
    ))
    reg.register(ToolSpec(
        name="list_dir",
        tier=Tier.READ,
        description="List files and subdirectories in a directory.",
        parameters={"path": {"type": "string", "required": False, "default": "."}},
        fn=_list_dir,
    ))
    reg.register(ToolSpec(
        name="search_files",
        tier=Tier.READ,
        description="Search for files matching a glob pattern under a directory.",
        parameters={
            "pattern": {"type": "string", "required": True},
            "path": {"type": "string", "required": False, "default": "."},
        },
        fn=_search_files,
    ))
    reg.register(ToolSpec(
        name="grep",
        tier=Tier.READ,
        description="Search file contents for a text pattern (like grep -rn).",
        parameters={
            "query": {"type": "string", "required": True},
            "path": {"type": "string", "required": False, "default": "."},
        },
        fn=_grep,
    ))
    reg.register(ToolSpec(
        name="python_eval",
        tier=Tier.READ,
        description="Evaluate a Python expression in a sandboxed environment.",
        parameters={"expression": {"type": "string", "required": True}},
        fn=_python_eval,
    ))
    reg.register(ToolSpec(
        name="file_write",
        tier=Tier.WRITE,
        description="Write content to a file (creates parent directories if needed).",
        parameters={
            "path": {"type": "string", "required": True},
            "content": {"type": "string", "required": True},
        },
        fn=_file_write,
    ))
    reg.register(ToolSpec(
        name="shell_exec",
        tier=Tier.EXEC,
        description="Execute a shell command and return stdout+stderr.",
        parameters={
            "command": {"type": "string", "required": True},
            "timeout": {"type": "integer", "required": False, "default": 30},
            "cwd": {"type": "string", "required": False},
        },
        fn=_shell_exec,
    ))

    if extended:
        from .tools_extended import register_extended_tools
        register_extended_tools(reg)

    return reg
