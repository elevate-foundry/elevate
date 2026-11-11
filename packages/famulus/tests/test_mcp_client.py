"""Tests for the MCP client: discovering and consuming external MCP servers."""

from __future__ import annotations

from famulus.engine.mcp_client import MCPClientManager, MCPServerConfig, MCPTool
from famulus.engine.capability import Tier
from famulus.engine.tools import ToolRegistry


# --- MCPServerConfig -------------------------------------------------------

def test_server_config_default_tier():
    cfg = MCPServerConfig(name="test", command="echo")
    assert cfg.tier == Tier.EXEC


def test_server_config_custom_tier():
    cfg = MCPServerConfig(name="test", command="echo", default_tier="READ")
    assert cfg.tier == Tier.READ


# --- MCPClientManager config loading --------------------------------------

def test_add_servers_from_config():
    mgr = MCPClientManager()
    mgr.add_servers_from_config({
        "mcp_servers": [
            {"name": "fs", "command": "npx", "args": ["-y", "server-fs"], "default_tier": "WRITE"},
            {"name": "db", "command": "db-server"},
        ]
    })
    assert mgr.server_count == 2
    assert mgr.get_config("fs").tier == Tier.WRITE
    assert mgr.get_config("db").tier == Tier.EXEC  # default


def test_add_servers_empty_config():
    mgr = MCPClientManager()
    mgr.add_servers_from_config({})
    assert mgr.server_count == 0


def test_get_config_missing():
    mgr = MCPClientManager()
    assert mgr.get_config("nonexistent") is None


# --- Register tools into registry -----------------------------------------

def test_register_tools():
    mgr = MCPClientManager()
    mgr.add_server(MCPServerConfig(name="ext", command="echo", default_tier="WRITE"))
    # Simulate discovered tools
    mgr._discovered["ext"] = [
        MCPTool(
            server_name="ext",
            tool_name="read_file",
            description="Read a file via MCP",
            input_schema={
                "type": "object",
                "properties": {"path": {"type": "string", "description": "file path"}},
                "required": ["path"],
            },
        ),
        MCPTool(
            server_name="ext",
            tool_name="write_file",
            description="Write a file via MCP",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        ),
    ]

    reg = ToolRegistry()
    count = mgr.register_tools(reg)
    assert count == 2
    assert "mcp_ext_read_file" in reg.names()
    assert "mcp_ext_write_file" in reg.names()

    # Check tier inherited from server config
    spec = reg.get("mcp_ext_read_file")
    assert spec.tier == Tier.WRITE

    # Check parameters parsed from input_schema
    assert "path" in spec.parameters
    assert spec.parameters["path"]["required"] is True


def test_register_tools_includes_server_prefix_in_description():
    mgr = MCPClientManager()
    mgr.add_server(MCPServerConfig(name="myserver", command="echo"))
    mgr._discovered["myserver"] = [
        MCPTool(server_name="myserver", tool_name="ping", description="Ping check"),
    ]
    reg = ToolRegistry()
    mgr.register_tools(reg)
    spec = reg.get("mcp_myserver_ping")
    assert "[MCP:myserver]" in spec.description


# --- Status ----------------------------------------------------------------

def test_status():
    mgr = MCPClientManager()
    mgr.add_server(MCPServerConfig(name="s1", command="echo"))
    mgr._discovered["s1"] = [
        MCPTool(server_name="s1", tool_name="t1", description="Tool 1"),
        MCPTool(server_name="s1", tool_name="t2", description="Tool 2"),
    ]
    status = mgr.status()
    assert status["total_tools"] == 2
    assert len(status["servers"]) == 1
    assert status["servers"][0]["tools_discovered"] == 2


def test_tool_count_empty():
    mgr = MCPClientManager()
    assert mgr.tool_count == 0
