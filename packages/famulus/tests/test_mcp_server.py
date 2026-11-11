"""Tests for the MCP server: exposing famulus tools over MCP."""

from __future__ import annotations

from famulus.engine.mcp_server import create_mcp_server
from famulus.engine.tools import default_registry


def test_create_server_has_all_builtin_tools():
    """The MCP server should expose every tool in the registry."""
    reg = default_registry()
    mcp = create_mcp_server(reg)
    # FastMCP stores tools internally; check they were registered
    # by inspecting the _tool_manager
    manager = mcp._tool_manager
    tool_names = set()
    for tool in manager._tools.values():
        tool_names.add(tool.name)
    expected = set(reg.names())
    assert expected.issubset(tool_names), f"Missing: {expected - tool_names}"


def test_server_tool_descriptions_include_tier():
    """Each tool description should be prefixed with the tier."""
    reg = default_registry()
    mcp = create_mcp_server(reg)
    manager = mcp._tool_manager
    for tool in manager._tools.values():
        # Description should start with [READ], [WRITE], or [EXEC]
        assert tool.description.startswith("["), f"{tool.name}: {tool.description}"


def test_server_custom_name():
    mcp = create_mcp_server(name="my-agent")
    assert mcp.name == "my-agent"
