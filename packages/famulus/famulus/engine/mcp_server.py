"""MCP server: expose famulus tools over the Model Context Protocol.

This lets external MCP clients (Claude Desktop, VS Code Copilot, other
agents) discover and call famulus tools through the standard MCP protocol.
All tool calls are still consent-gated and audited.

Usage:
    famulus --mcp-server          # stdio transport (for IDE integration)
    famulus --mcp-server --port 8000  # HTTP transport
"""

from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import FastMCP

from .capability import ToolResult
from .tools import ToolRegistry, default_registry


def create_mcp_server(
    registry: ToolRegistry | None = None,
    name: str = "famulus",
) -> FastMCP:
    """Build a FastMCP server that exposes the famulus tool registry.

    Each registered tool becomes an MCP tool. The tier metadata is passed
    through as tool description annotations so clients can display it.
    """
    mcp = FastMCP(
        name=name,
        instructions=(
            "famulus is an offline-by-default, consent-bound local agent. "
            "Tools are classified as READ, WRITE, or EXEC. WRITE and EXEC "
            "tools require explicit human approval."
        ),
    )
    reg = registry or default_registry()

    for spec in reg.all():
        # Build the MCP tool dynamically for each registered tool.
        # We capture `spec` in the closure via default argument.
        _register_tool(mcp, spec)

    return mcp


def _register_tool(mcp: FastMCP, spec: Any) -> None:
    """Register a single ToolSpec as an MCP tool on the server."""

    # Build parameter schema for MCP
    properties = {}
    required = []
    for pname, pdef in spec.parameters.items():
        properties[pname] = {
            "type": pdef.get("type", "string"),
            "description": pdef.get("description", ""),
        }
        if pdef.get("required", False):
            required.append(pname)

    description = f"[{spec.tier.name}] {spec.description}"

    @mcp.tool(name=spec.name, description=description)
    async def _tool_handler(**kwargs: Any) -> str:
        """Generic handler that delegates to the ToolSpec's fn."""
        if spec.fn is None:
            return json.dumps({"error": f"tool {spec.name} has no implementation"})
        try:
            result: ToolResult = spec.fn(kwargs)
        except Exception as exc:
            result = ToolResult(success=False, error=f"{type(exc).__name__}: {exc}")
        return json.dumps(result.to_dict())


def run_stdio_server(registry: ToolRegistry | None = None) -> None:
    """Run the MCP server over stdio (for IDE/subprocess integration)."""
    mcp = create_mcp_server(registry)
    mcp.run(transport="stdio")


def run_http_server(registry: ToolRegistry | None = None, port: int = 8000) -> None:
    """Run the MCP server over HTTP (streamable)."""
    mcp = create_mcp_server(registry)
    mcp.run(transport="streamable-http", host="127.0.0.1", port=port)
