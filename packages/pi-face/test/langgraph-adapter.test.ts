import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeLangGraphNdjsonStream,
  LangGraphPresenceAdapter,
  parseLangGraphNdjson,
} from "../src/langgraph-adapter.ts";

test("LangGraph v2 lifecycle records map to truthful presence events", () => {
  const adapter = new LangGraphPresenceAdapter();
  assert.deepEqual(adapter.ingest({
    event: "on_chain_start", run_id: "agent-run", metadata: { langgraph_node: "researcher" },
  }), [
    { type: "agent_added", agentId: "researcher", label: "researcher" },
    { type: "agent_event", agentId: "researcher", event: { type: "run_start" } },
  ]);
  assert.deepEqual(adapter.ingest({
    event: "on_tool_start", name: "read", run_id: "tool-1", parent_ids: ["agent-run"],
  }), [
    { type: "agent_event", agentId: "researcher", event: { type: "tool_start", id: "tool-1", name: "read" } },
  ]);
  assert.deepEqual(adapter.ingest({ event: "on_tool_end", run_id: "tool-1" }), [
    { type: "agent_event", agentId: "researcher", event: { type: "tool_end", id: "tool-1", isError: false } },
  ]);
});

test("LangGraph custom events carry explicit artifact handoffs", () => {
  const adapter = new LangGraphPresenceAdapter();
  const started = adapter.ingest({
    event: "on_custom_event",
    name: "agent_handoff",
    data: { handoff_id: "h1", from: "planner", to: "builder", artifact_id: "plan", status: "started" },
  });
  assert.equal(started.at(-1)?.type, "handoff_started");
  assert.deepEqual(adapter.ingest({
    event: "on_custom_event",
    name: "agent_handoff",
    data: { handoff_id: "h1", from: "planner", to: "builder", artifact_id: "plan", status: "completed" },
  }), [{ type: "handoff_completed", handoffId: "h1", isError: false }]);
});

test("NDJSON parser reports the failing line", () => {
  assert.equal(parseLangGraphNdjson('{"event":"on_chain_start"}\n').length, 1);
  assert.throws(() => parseLangGraphNdjson('{"event":"ok"}\nnot-json'), /line 2/);
});

test("chunked NDJSON streams dispatch complete LangGraph records", async () => {
  const encoder = new TextEncoder();
  const chunks = ['{"event":"on_chain_', 'start"}\n{"event":"on_chain_end"}\n'];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const events: string[] = [];
  await consumeLangGraphNdjsonStream(stream, (event) => { events.push(event.event); });
  assert.deepEqual(events, ["on_chain_start", "on_chain_end"]);
});
