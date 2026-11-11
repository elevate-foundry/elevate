"""MCP client: discover and consume external MCP servers as tools.

This lets famulus connect to any MCP server (filesystem, database, GitHub,
Slack, custom tools, etc.) and register their tools into the agent's
registry at runtime. The tool algebra still applies: all external MCP tools
default to EXEC tier (highest consent) unless explicitly mapped lower.

The client manages the lifecycle of MCP server connections -- spawning
stdio subprocesses or connecting to HTTP endpoints as configured.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from mcp.client.stdio import stdio_client, StdioServerParameters
from mcp.client.session import ClientSession

from .capability import Tier, ToolResult, ToolSpec
from .tools import ToolRegistry

logger = logging.getLogger(__name__)


@dataclass
class MCPServerConfig:
    """Configuration for a single external MCP server."""
    name: str
    command: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] | None = None
    cwd: str | None = None
    default_tier: str = "EXEC"

    @property
    def tier(self) -> Tier:
        return Tier[self.default_tier.upper()]


@dataclass
class MCPTool:
    """A tool discovered from an external MCP server."""
    server_name: str
    tool_name: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)


class MCPClientManager:
    """Manages connections to external MCP servers and registers their tools."""

    def __init__(self) -> None:
        self._configs: list[MCPServerConfig] = []
        self._discovered: dict[str, list[MCPTool]] = {}

    def add_server(self, config: MCPServerConfig) -> None:
        self._configs.append(config)

    def add_servers_from_config(self, config_data: dict[str, Any]) -> None:
        """Load server configs from a dict (typically parsed from JSON/YAML).

        Expected format:
          {"mcp_servers": [
            {"name": "...", "command": "...", "args": [...], "default_tier": "EXEC"},
            ...
          ]}
        """
        for entry in config_data.get("mcp_servers", []):
            self.add_server(MCPServerConfig(
                name=entry["name"],
                command=entry["command"],
                args=entry.get("args", []),
                env=entry.get("env"),
                cwd=entry.get("cwd"),
                default_tier=entry.get("default_tier", "EXEC"),
            ))

    async def discover_server(self, config: MCPServerConfig) -> list[MCPTool]:
        """Connect to a single MCP server, list its tools, and disconnect."""
        params = StdioServerParameters(
            command=config.command,
            args=config.args,
            env=config.env,
            cwd=config.cwd,
        )
        tools: list[MCPTool] = []
        try:
            async with stdio_client(params) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.list_tools()
                    for t in result.tools:
                        tools.append(MCPTool(
                            server_name=config.name,
                            tool_name=t.name,
                            description=t.description or "",
                            input_schema=t.inputSchema if hasattr(t, "inputSchema") else {},
                        ))
        except Exception as exc:
            logger.warning("Failed to discover tools from MCP server %s: %s", config.name, exc)
        self._discovered[config.name] = tools
        return tools

    async def discover_all(self) -> dict[str, list[MCPTool]]:
        """Discover tools from all configured MCP servers."""
        for config in self._configs:
            await self.discover_server(config)
        return dict(self._discovered)

    def discover_all_sync(self) -> dict[str, list[MCPTool]]:
        """Synchronous wrapper for discover_all."""
        return asyncio.run(self.discover_all())

    async def call_tool(
        self,
        config: MCPServerConfig,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> ToolResult:
        """Call a tool on a specific MCP server."""
        params = StdioServerParameters(
            command=config.command,
            args=config.args,
            env=config.env,
            cwd=config.cwd,
        )
        try:
            async with stdio_client(params) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool(tool_name, arguments)
                    # Extract text from result content
                    texts = []
                    for content in result.content:
                        if hasattr(content, "text"):
                            texts.append(content.text)
                        else:
                            texts.append(str(content))
                    output = "\n".join(texts)
                    is_error = getattr(result, "isError", False)
                    return ToolResult(
                        success=not is_error,
                        output=output if not is_error else "",
                        error=output if is_error else "",
                    )
        except Exception as exc:
            return ToolResult(success=False, error=f"MCP call failed: {exc}")

    def call_tool_sync(
        self,
        config: MCPServerConfig,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> ToolResult:
        """Synchronous wrapper for call_tool."""
        return asyncio.run(self.call_tool(config, tool_name, arguments))

    def get_config(self, server_name: str) -> MCPServerConfig | None:
        for c in self._configs:
            if c.name == server_name:
                return c
        return None

    def register_tools(self, registry: ToolRegistry) -> int:
        """Register all discovered MCP tools into a famulus ToolRegistry.

        Each tool gets a namespaced name: "mcp_{server}_{tool}" and defaults
        to the server's configured tier. Returns the count of tools added.
        """
        count = 0
        for server_name, tools in self._discovered.items():
            config = self.get_config(server_name)
            tier = config.tier if config else Tier.EXEC
            for tool in tools:
                registry_name = f"mcp_{server_name}_{tool.tool_name}"

                # Build parameter schema from MCP's inputSchema
                params = {}
                props = tool.input_schema.get("properties", {})
                required_list = tool.input_schema.get("required", [])
                for pname, pdef in props.items():
                    params[pname] = {
                        "type": pdef.get("type", "string"),
                        "description": pdef.get("description", ""),
                        "required": pname in required_list,
                    }

                # Create a closure that captures the right config and tool name
                def _make_fn(cfg: MCPServerConfig, tname: str):
                    def _fn(call_params: dict) -> ToolResult:
                        return self.call_tool_sync(cfg, tname, call_params)
                    return _fn

                spec = ToolSpec(
                    name=registry_name,
                    tier=tier,
                    description=f"[MCP:{server_name}] {tool.description}",
                    parameters=params,
                    fn=_make_fn(config, tool.tool_name) if config else None,
                )
                registry.register(spec)
                count += 1
        return count

    @property
    def server_count(self) -> int:
        return len(self._configs)

    @property
    def tool_count(self) -> int:
        return sum(len(tools) for tools in self._discovered.values())

    def status(self) -> dict[str, Any]:
        return {
            "servers": [
                {
                    "name": c.name,
                    "command": c.command,
                    "default_tier": c.default_tier,
                    "tools_discovered": len(self._discovered.get(c.name, [])),
                }
                for c in self._configs
            ],
            "total_tools": self.tool_count,
        }
