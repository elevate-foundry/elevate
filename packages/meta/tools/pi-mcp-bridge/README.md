# pi-mcp-bridge

A pi package that gives pi an MCP runtime via an extension.

## What it does
- discovers MCP config from project or global files
- starts enabled MCP servers on `session_start`
- lists MCP tools and registers them as normal pi tools
- shuts transports down on `session_shutdown`
- exposes `/mcp-status`

## Config discovery
In order:

1. `PI_MCP_CONFIG`
2. trusted project files while walking upward from cwd:
   - `.pi/mcp.jsonc`
   - `.pi/mcp.json`
   - `opencode.jsonc`
   - `opencode.json`
3. global files:
   - `~/.pi/agent/mcp.jsonc`
   - `~/.pi/agent/mcp.json`
   - `~/opencode.jsonc`

Supported file shapes:
- `{ "mcp": { ... } }`
- `{ "mcpServers": { ... } }`
- direct server map

## Supported server configs

### Local stdio
```json
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp@latest"],
      "timeout": 30000
    }
  }
}
```

### Streamable HTTP
```json
{
  "mcp": {
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ..."
      }
    }
  }
}
```

## Install in pi
```bash
pi install ./tools/pi-mcp-bridge -l
```

Or load directly:
```bash
pi -e ./tools/pi-mcp-bridge/extensions/index.ts
```

## Commands
- `/mcp-status` — show loaded config, connected servers, and registered tools

## Notes
- Project-local MCP config is only used when the project is trusted.
- Tool names are namespaced as `mcp_<server>_<tool>`.
- This is the extension-first path toward a future native pi MCP runtime.
