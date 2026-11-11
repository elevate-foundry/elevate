import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { parse } from "jsonc-parser";

type McpServerConfig = {
  type?: string;
  command?: string[] | string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
};

type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
type TransportType = "stdio" | "sse" | "streamable-http";
type ServerStatus = "connected" | "disabled" | "failed";

type RegisteredToolInfo = {
  piToolName: string;
  serverName: string;
  toolName: string;
  title?: string;
  description?: string;
};

type ServerHandle = {
  serverName: string;
  client: Client;
  transport: Transport;
  transportType: TransportType;
  toolCount: number;
};

type ServerSummary = {
  serverName: string;
  transportType?: TransportType;
  toolCount: number;
  status: ServerStatus;
  note?: string;
};

type RuntimeState = {
  configPath?: string;
  configError?: string;
  handles: Map<string, ServerHandle>;
  tools: Map<string, RegisteredToolInfo>;
  serverSummaries: Map<string, ServerSummary>;
  toolNameCounts: Map<string, number>;
  toolCount: number;
  loaded: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const STATUS_KEY = "mcp";
const CLIENT_INFO = { name: "pi-mcp-bridge", version: "0.2.0" };

function createState(): RuntimeState {
  return {
    handles: new Map(),
    tools: new Map(),
    serverSummaries: new Map(),
    toolNameCounts: new Map(),
    toolCount: 0,
    loaded: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeObjectRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === "string") out[key] = val;
  }
  return out;
}

function asServerMap(value: unknown): Record<string, McpServerConfig> {
  if (!isRecord(value)) return {};
  if (isRecord(value.mcp)) return value.mcp as Record<string, McpServerConfig>;
  if (isRecord(value.mcpServers)) return value.mcpServers as Record<string, McpServerConfig>;
  return value as Record<string, McpServerConfig>;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function* walkUp(startDir: string): AsyncGenerator<string> {
  let current = path.resolve(startDir);
  while (true) {
    yield current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function findConfig(cwd: string, projectTrusted: boolean): Promise<string | undefined> {
  const envPath = process.env.PI_MCP_CONFIG?.trim();
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (await exists(resolved)) return resolved;
  }

  if (projectTrusted) {
    for await (const dir of walkUp(cwd)) {
      for (const candidate of [
        path.join(dir, CONFIG_DIR_NAME, "mcp.jsonc"),
        path.join(dir, CONFIG_DIR_NAME, "mcp.json"),
        path.join(dir, "opencode.jsonc"),
        path.join(dir, "opencode.json"),
      ]) {
        if (await exists(candidate)) return candidate;
      }
    }
  }

  for (const candidate of [
    path.join(os.homedir(), ".pi", "agent", "mcp.jsonc"),
    path.join(os.homedir(), ".pi", "agent", "mcp.json"),
    path.join(os.homedir(), "opencode.jsonc"),
    path.join(os.homedir(), "opencode.json"),
  ]) {
    if (await exists(candidate)) return candidate;
  }

  return undefined;
}

async function loadServerConfigs(cwd: string, projectTrusted: boolean) {
  const configPath = await findConfig(cwd, projectTrusted);
  if (!configPath) {
    return {
      configPath: undefined,
      configError: undefined,
      servers: {} as Record<string, McpServerConfig>,
    };
  }

  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = parse(raw);
    return {
      configPath,
      configError: undefined,
      servers: asServerMap(parsed),
    };
  } catch (error) {
    return {
      configPath,
      configError: String(error),
      servers: {} as Record<string, McpServerConfig>,
    };
  }
}

function isEnabled(config: McpServerConfig): boolean {
  return config.enabled !== false;
}

function normalizeToolNamePart(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool"
  );
}

function buildBasePiToolName(serverName: string, toolName: string): string {
  return `mcp_${normalizeToolNamePart(serverName)}_${normalizeToolNamePart(toolName)}`;
}

function allocatePiToolName(state: RuntimeState, serverName: string, toolName: string): string {
  const base = buildBasePiToolName(serverName, toolName);
  const count = state.toolNameCounts.get(base) ?? 0;
  state.toolNameCounts.set(base, count + 1);
  return count === 0 ? base : `${base}_${count + 1}`;
}

async function connectWithTimeout(client: Client, transport: Transport, timeoutMs: number) {
  await Promise.race([
    client.connect(transport),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`connection timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

async function listAllTools(client: Client) {
  const tools: ListedTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

function resolveCommand(config: McpServerConfig): { command: string; args: string[] } {
  if (Array.isArray(config.command)) {
    const [command, ...rest] = config.command;
    if (!command) throw new Error("missing command");
    return { command, args: config.args ?? rest };
  }
  if (typeof config.command === "string" && config.command.trim()) {
    return { command: config.command.trim(), args: config.args ?? [] };
  }
  throw new Error("missing command");
}

function resolveTransportType(config: McpServerConfig): TransportType {
  const type = (config.type ?? "local").trim().toLowerCase();
  if (type === "streamable-http" || type === "http") return "streamable-http";
  if (type === "sse") return "sse";
  return "stdio";
}

async function createHandle(serverName: string, config: McpServerConfig): Promise<ServerHandle> {
  const client = new Client(CLIENT_INFO, {});
  const transportType = resolveTransportType(config);
  let transport: Transport;

  if (transportType === "streamable-http") {
    if (!config.url) throw new Error("missing url");
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  } else if (transportType === "sse") {
    if (!config.url) throw new Error("missing url");
    transport = new SSEClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  } else {
    const { command, args } = resolveCommand(config);
    transport = new StdioClientTransport({
      command,
      args,
      env: normalizeObjectRecord(config.env),
      cwd: config.cwd,
      stderr: "pipe",
    });
  }

  await connectWithTimeout(client, transport, config.timeout ?? DEFAULT_TIMEOUT_MS);
  const tools = await listAllTools(client);
  return { serverName, client, transport, transportType, toolCount: tools.length };
}

async function disposeHandle(handle: ServerHandle) {
  if (handle.transportType === "streamable-http") {
    await (handle.transport as StreamableHTTPClientTransport).terminateSession?.().catch(() => {});
  }
  await handle.client.close().catch(() => {});
  await handle.transport.close().catch(() => {});
}

function toPiToolResult(serverName: string, toolName: string, result: CallToolResult) {
  const content = Array.isArray(result.content) ? result.content : [];
  return {
    content:
      content.length > 0
        ? content
        : [
            {
              type: "text",
              text: JSON.stringify(result.structuredContent ?? { ok: result.isError !== true }, null, 2),
            },
          ],
    details: {
      mcpServer: serverName,
      mcpTool: toolName,
      structuredContent: result.structuredContent,
      isError: result.isError === true,
    },
    isError: result.isError === true,
  };
}

function summarizeStatus(state: RuntimeState): string {
  if (state.configError) return "mcp: config error";
  if (!state.configPath) return "mcp: no config";
  const connected = Array.from(state.serverSummaries.values()).filter((s) => s.status === "connected").length;
  const failed = Array.from(state.serverSummaries.values()).filter((s) => s.status === "failed").length;
  return failed > 0
    ? `mcp: ${connected} up, ${failed} failed, ${state.toolCount} tool(s)`
    : `mcp: ${connected} server(s), ${state.toolCount} tool(s)`;
}

export default function piMcpBridge(pi: ExtensionAPI) {
  let state = createState();

  async function shutdown() {
    const handles = Array.from(state.handles.values());
    state = createState();
    for (const handle of handles) await disposeHandle(handle);
  }

  async function ensureLoaded(ctx: { cwd: string; isProjectTrusted(): boolean; ui: any }) {
    if (state.loaded) return;

    const loaded = await loadServerConfigs(ctx.cwd, ctx.isProjectTrusted());
    state.configPath = loaded.configPath;
    state.configError = loaded.configError;
    state.loaded = true;

    if (state.configError) {
      ctx.ui.setStatus(STATUS_KEY, summarizeStatus(state));
      ctx.ui.notify(`MCP config parse failed: ${state.configError}`, "warning");
      return;
    }

    if (!state.configPath) {
      ctx.ui.setStatus(STATUS_KEY, summarizeStatus(state));
      return;
    }

    for (const [serverName, rawConfig] of Object.entries(loaded.servers)) {
      const config = isRecord(rawConfig) ? (rawConfig as McpServerConfig) : {};
      if (!isEnabled(config)) {
        state.serverSummaries.set(serverName, {
          serverName,
          status: "disabled",
          toolCount: 0,
          note: "disabled",
        });
        continue;
      }

      try {
        const handle = await createHandle(serverName, config);
        state.handles.set(serverName, handle);
        state.serverSummaries.set(serverName, {
          serverName,
          transportType: handle.transportType,
          toolCount: handle.toolCount,
          status: "connected",
        });

        const listedTools = await listAllTools(handle.client);
        for (const tool of listedTools) {
          const toolName = tool.name?.trim();
          if (!toolName) continue;
          const piToolName = allocatePiToolName(state, serverName, toolName);
          if (state.tools.has(piToolName)) continue;
          state.tools.set(piToolName, {
            piToolName,
            serverName,
            toolName,
            title: tool.title,
            description: tool.description,
          });
          state.toolCount += 1;

          pi.registerTool({
            name: piToolName,
            label: tool.title ?? `${serverName}:${toolName}`,
            description: tool.description ?? `MCP tool ${toolName} from ${serverName}`,
            promptSnippet: `Call MCP tool ${toolName} from server ${serverName}`,
            promptGuidelines: [`Use ${piToolName} when the task clearly maps to MCP server ${serverName}.`],
            parameters: (tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: true }) as any,
            async execute(_toolCallId, params) {
              const active = state.handles.get(serverName);
              if (!active) throw new Error(`MCP server not connected: ${serverName}`);
              const result = await active.client.callTool({
                name: toolName,
                arguments: isRecord(params) ? params : {},
              });
              return toPiToolResult(serverName, toolName, result as CallToolResult);
            },
          });
        }
      } catch (error) {
        state.serverSummaries.set(serverName, {
          serverName,
          status: "failed",
          toolCount: 0,
          note: String(error),
        });
      }
    }

    ctx.ui.setStatus(STATUS_KEY, summarizeStatus(state));
  }

  async function renderStatus(ctx: { cwd: string; isProjectTrusted(): boolean; ui: any }) {
    await ensureLoaded(ctx);
    const lines = [
      `config: ${state.configPath ?? "none"}`,
      `config_error: ${state.configError ?? "none"}`,
      `project_trusted: ${ctx.isProjectTrusted() ? "yes" : "no"}`,
      `connected_servers: ${state.handles.size}`,
      `registered_tools: ${state.toolCount}`,
    ];

    const servers = Array.from(state.serverSummaries.values()).sort((a, b) => a.serverName.localeCompare(b.serverName));
    if (servers.length > 0) {
      lines.push("servers:");
      for (const server of servers) {
        lines.push(
          `- ${server.serverName} status=${server.status} transport=${server.transportType ?? "n/a"} tools=${server.toolCount}${server.note ? ` note=${server.note}` : ""}`,
        );
      }
    }

    const tools = Array.from(state.tools.values()).sort((a, b) => a.piToolName.localeCompare(b.piToolName));
    if (tools.length > 0) {
      lines.push("tools:");
      for (const tool of tools) {
        lines.push(`- ${tool.piToolName} -> ${tool.serverName}:${tool.toolName}`);
      }
    }

    ctx.ui.notify(lines.join("\n"), "info");
  }

  pi.on("session_start", async (_event, ctx) => {
    await ensureLoaded(ctx);
  });

  pi.on("session_shutdown", async () => {
    await shutdown();
  });

  pi.registerCommand("mcp-status", {
    description: "Show MCP config, server, and tool status",
    handler: async (_args, ctx) => {
      await renderStatus(ctx);
    },
  });

  pi.registerCommand("mcp-reload", {
    description: "Reconnect MCP servers for the current session",
    handler: async (_args, ctx) => {
      await shutdown();
      await renderStatus(ctx);
    },
  });
}
