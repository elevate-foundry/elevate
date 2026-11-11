import type { PresenceNetworkEvent } from "./collective-presence.ts";

export interface LangGraphStreamEvent {
  event: string;
  name?: string;
  run_id?: string;
  parent_ids?: readonly string[];
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
  timestamp?: number;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nodeFor(event: LangGraphStreamEvent) {
  return stringValue(event.metadata?.agent_id)
    ?? stringValue(event.metadata?.langgraph_node);
}

function textLength(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((total, item) => total + textLength(item), 0);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textLength(record.content) + textLength(record.text);
  }
  return 0;
}

/**
 * Maps LangGraph astream_events(v2) records and explicit custom handoff events
 * into the renderer-neutral presence network. No chain-of-thought content is read.
 */
export class LangGraphPresenceAdapter {
  private readonly agents = new Set<string>();
  private readonly runOwners = new Map<string, string>();
  private readonly toolOwners = new Map<string, string>();

  ingest(event: LangGraphStreamEvent): PresenceNetworkEvent[] {
    const output: PresenceNetworkEvent[] = [];
    const ensureAgent = (agentId: string) => {
      if (this.agents.has(agentId)) return;
      this.agents.add(agentId);
      output.push({ type: "agent_added", agentId, label: agentId.replaceAll(/[-_]/g, " ") });
    };

    if (event.event === "on_custom_event" && event.name === "agent_handoff") {
      const from = stringValue(event.data?.from);
      const to = stringValue(event.data?.to);
      const artifactId = stringValue(event.data?.artifact_id);
      const handoffId = stringValue(event.data?.handoff_id) ?? `${from ?? "unknown"}-${to ?? "unknown"}-${artifactId ?? "artifact"}`;
      if (!from || !to || !artifactId) return output;
      ensureAgent(from);
      ensureAgent(to);
      if (event.data?.status === "completed" || event.data?.status === "error") {
        output.push({ type: "handoff_completed", handoffId, isError: event.data.status === "error" });
      } else {
        output.push({ type: "handoff_started", handoffId, from, to, artifactId });
      }
      return output;
    }

    const agentId = nodeFor(event);
    if (event.event === "on_chain_start" && agentId) {
      ensureAgent(agentId);
      if (event.run_id) this.runOwners.set(event.run_id, agentId);
      output.push({ type: "agent_event", agentId, event: { type: "run_start" } });
      return output;
    }

    if (event.event === "on_chain_end" && agentId) {
      ensureAgent(agentId);
      output.push({ type: "agent_event", agentId, event: { type: "settled" } });
      return output;
    }

    if (event.event === "on_tool_start") {
      const owner = agentId ?? event.parent_ids?.map((id) => this.runOwners.get(id)).find(Boolean);
      if (!owner) return output;
      ensureAgent(owner);
      const toolId = event.run_id ?? `${owner}-${event.name ?? "tool"}`;
      this.toolOwners.set(toolId, owner);
      output.push({
        type: "agent_event",
        agentId: owner,
        event: { type: "tool_start", id: toolId, name: event.name ?? "tool" },
      });
      return output;
    }

    if (event.event === "on_tool_end" || event.event === "on_tool_error") {
      const toolId = event.run_id ?? "tool";
      const owner = this.toolOwners.get(toolId) ?? agentId;
      if (!owner) return output;
      ensureAgent(owner);
      output.push({
        type: "agent_event",
        agentId: owner,
        event: { type: "tool_end", id: toolId, isError: event.event === "on_tool_error" },
      });
      return output;
    }

    if (event.event === "on_chat_model_stream") {
      const owner = agentId ?? event.parent_ids?.map((id) => this.runOwners.get(id)).find(Boolean);
      if (!owner) return output;
      ensureAgent(owner);
      const length = textLength(event.data?.chunk);
      if (length > 0) {
        output.push({
          type: "agent_event",
          agentId: owner,
          event: { type: "output", intensity: Math.max(0.18, Math.min(1, length / 28)) },
        });
      }
    }
    return output;
  }
}

function parseLine(line: string, lineNumber: number): LangGraphStreamEvent {
  try {
    return JSON.parse(line) as LangGraphStreamEvent;
  } catch (error) {
    throw new Error(`Invalid LangGraph NDJSON at line ${lineNumber}: ${error instanceof Error ? error.message : error}`);
  }
}

export function parseLangGraphNdjson(text: string): LangGraphStreamEvent[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) =>
    parseLine(line, index + 1));
}

export async function consumeLangGraphNdjsonStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: LangGraphStreamEvent) => void | Promise<void>,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let lineNumber = 0;
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = done ? "" : lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      lineNumber++;
      await onEvent(parseLine(line, lineNumber));
    }
    if (done) {
      const finalLine = pending.trim();
      if (finalLine) await onEvent(parseLine(finalLine, ++lineNumber));
      break;
    }
  }
}
