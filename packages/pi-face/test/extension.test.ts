import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import extension from "../extensions/face.ts";

function harness(mode = "tui", initialEntries: unknown[] = []) {
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
  const entries = [...initialEntries];
  let command: any;
  let widget: any;
  let status: string | undefined;
  const notices: string[] = [];
  let renders = 0;
  const theme = { fg: (_color: string, text: string) => text };
  const ctx = {
    mode, hasUI: mode === "tui",
    sessionManager: { getEntries: () => entries },
    ui: {
      setWidget: (_key: string, value: unknown) => { widget = value; renders++; },
      setStatus: (_key: string, value: string | undefined) => { status = value; },
      notify: (text: string) => { notices.push(text); },
    },
  } as unknown as ExtensionContext;
  extension({
    on: (name: string, fn: any) => { handlers.set(name, fn); },
    appendEntry: (customType: string, data: unknown) => { entries.push({ type: "custom", customType, data }); },
    registerCommand: (_name: string, value: any) => { command = value; },
  } as unknown as ExtensionAPI);
  return {
    emit: (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx),
    command: (args: string) => command.handler(args, ctx),
    complete: (prefix: string) => command.getArgumentCompletions(prefix),
    lines: (width: number) => widget?.({}, theme).render(width) as string[] | undefined,
    get widget() { return widget; },
    get status() { return status; },
    get renders() { return renders; },
    entries,
    notices,
  };
}

test("interactive adapter observes lifecycle, errors and narrow terminal widths", async () => {
  const h = harness();
  try {
    h.emit("session_start");
    assert.match(h.status!, /idle/);
    h.emit("agent_start");
    assert.match(h.status!, /thinking/);
    h.emit("tool_execution_start", { toolCallId: "1" });
    assert.match(h.status!, /using tools/);
    for (const width of [1, 5, 20, 80]) {
      assert.ok(h.lines(width)!.every((line) => visibleWidth(line) <= width));
    }
    h.emit("ui_prompt_start");
    assert.match(h.status!, /waiting for you/);
    h.emit("ui_prompt_end");
    h.emit("tool_execution_end", { toolCallId: "1", isError: true });
    h.emit("agent_settled");
    assert.match(h.status!, /error observed/);
    await h.command("off");
    assert.equal(h.widget, undefined);
    assert.equal(h.status, undefined);
    h.emit("agent_start");
    assert.equal(h.widget, undefined);
    await h.command("on");
    assert.match(h.status!, /thinking/);
  } finally { h.emit("session_shutdown"); }
});

test("adapter maps streaming, continuation, progress, approval, finalization and model selection", () => {
  const h = harness();
  try {
    h.emit("session_start");
    h.emit("before_agent_start");
    assert.match(h.status!, /starting run/);
    h.emit("agent_start");
    assert.match(h.status!, /thinking/);
    h.emit("message_update", { assistantMessageEvent: { type: "text_delta", delta: "hello" } });
    assert.match(h.status!, /streaming output/);
    h.emit("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: "private" } });
    assert.match(h.status!, /streaming output/);
    h.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
    h.emit("tool_execution_start", { toolCallId: "outer", toolName: "codemode" });
    h.emit("tool_execution_update", {
      toolCallId: "outer",
      toolName: "codemode",
      partialResult: { details: { completed: 21, total: 50 } },
    });
    assert.match(h.status!, /42%/);
    h.emit("tool_execution_start", {
      toolCallId: "outer/1",
      toolName: "read",
      parentToolCallId: "outer",
    });
    assert.match(h.status!, /using 2 tools/);
    h.emit("ui_prompt_start", { kind: "confirm" });
    assert.match(h.status!, /waiting for approval/);
    h.emit("ui_prompt_end");
    h.emit("tool_execution_end", { toolCallId: "outer/1", toolName: "read", isError: false });
    h.emit("tool_execution_end", { toolCallId: "outer", toolName: "codemode", isError: false });
    h.emit("agent_end");
    assert.match(h.status!, /checking next step/);
    h.emit("agent_start");
    assert.match(h.status!, /continuing run/);
    h.emit("agent_before_settle");
    assert.match(h.status!, /finalizing/);
    h.emit("agent_settled", { aborted: false });
    h.emit("model_select", { model: { provider: "openai", id: "example" } });
    assert.match(h.status!, /model selected/);
    assert.match(h.lines(80)!.join("\n"), /model selected/);
  } finally { h.emit("session_shutdown"); }
});

test("headless modes never render widgets or create animation work", async () => {
  for (const mode of ["print", "json", "rpc"]) {
    const h = harness(mode);
    h.emit("session_start"); h.emit("agent_start");
    h.emit("tool_execution_start", { toolCallId: "a" });
    h.emit("agent_settled");
    await h.command("thinking");
    h.emit("session_shutdown");
    assert.equal(h.renders, 0);
  }
});

test("help, presets and argument completion make the command discoverable", async () => {
  const h = harness();
  try {
    h.emit("session_start");
    await h.command("help");
    assert.match(h.notices.at(-1)!, /compact.*character.*showcase/s);
    assert.deepEqual(h.complete("sho"), [{ value: "showcase", label: "showcase" }]);

    await h.command("compact");
    assert.equal(h.lines(80)!.length, 2);
    assert.match(h.notices.at(-1)!, /compact/);

    await h.command("character");
    assert.ok(h.lines(80)!.length > 2);
    assert.match(h.lines(80)!.join("\n"), /\[braille\]/);

    await h.command("showcase");
    assert.match(h.lines(80)!.join("\n"), /\[braille swarm\]/);

    await h.command("preview waiting");
    assert.match(h.status!, /waiting for you/);
    assert.match(h.notices.at(-1)!, /Cosmetic preview/);
    await h.command("not-a-mode");
    assert.match(h.notices.at(-1)!, /\/face help/);
  } finally { h.emit("session_shutdown"); }
});

test("rendering falls back to the compact rail instead of clipping on narrow terminals", () => {
  const h = harness();
  try {
    h.emit("session_start");
    assert.ok(h.lines(80)!.length > 2);
    assert.equal(h.lines(12)!.length, 2);
    assert.ok(h.lines(12)!.every((line) => visibleWidth(line) <= 12));
    assert.match(h.lines(12)![0], /^[\x20-\x7e]+$/);
    assert.match(h.lines(12)![1], /idle/);
  } finally { h.emit("session_shutdown"); }
});

test("display preferences survive session reload and resume", async () => {
  const first = harness();
  first.emit("session_start");
  await first.command("compact");
  first.emit("session_shutdown");

  const resumed = harness("tui", first.entries);
  resumed.emit("session_start");
  assert.equal(resumed.lines(80)!.length, 2);
  await resumed.command("status");
  assert.match(resumed.notices.at(-1)!, /style=ambient; glyphs=braille; motion=pose/);
  await resumed.command("off");
  resumed.emit("session_shutdown");

  const hidden = harness("tui", resumed.entries);
  hidden.emit("session_start");
  assert.equal(hidden.widget, undefined);
  hidden.emit("session_shutdown");
});

test("ascii, braille and ambient commands switch rendering styles", async () => {
  const h = harness();
  try {
    h.emit("session_start");
    await h.command("braille");
    assert.match(h.lines(80)!.join("\n"), /\[braille\]/);
    await h.command("status");
    assert.match(h.notices.at(-1)!, /style=braille/);
    await h.command("style ascii");
    assert.doesNotMatch(h.lines(80)!.join("\n"), /\[braille\]/);
    await h.command("style braille");
    assert.match(h.lines(80)!.join("\n"), /\[braille\]/);
    await h.command("ambient");
    assert.equal(h.lines(80)!.length, 2);
    assert.match(h.lines(80)![1], /idle/);
    assert.match(h.lines(80)![0], /[\u2800-\u28ff]/u);
    assert.doesNotMatch(h.lines(80)!.join("\n"), /pi face|\[braille\]/);
    await h.command("status");
    assert.match(h.notices.at(-1)!, /style=ambient; glyphs=braille/);
    await h.command("ambient ascii");
    assert.match(h.lines(80)![0], /^[\x20-\x7e]+$/);
    await h.command("status");
    assert.match(h.notices.at(-1)!, /style=ambient; glyphs=ascii/);
    await h.command("ambient unicode");
    h.emit("agent_start");
    h.emit("tool_execution_start", { toolCallId: "a", toolName: "read" });
    h.emit("tool_execution_start", { toolCallId: "b", toolName: "edit" });
    assert.match(h.lines(80)![1], /parallel.*lens ∥ pencil/);
    await h.command("style");
    assert.match(h.notices.at(-1)!, /ambient/);
  } finally { h.emit("session_shutdown"); }
});

test("swarm motion animates quickly and still motion stops its timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  h.emit("session_start");
  await h.command("motion swarm");
  const first = h.lines(80)!.join("\n");
  assert.match(first, /\[braille swarm\]/);
  t.mock.timers.tick(125);
  const second = h.lines(80)!.join("\n");
  assert.notEqual(second, first);
  h.emit("tool_execution_start", { toolCallId: "hammer", toolName: "bash" });
  assert.match(h.lines(80)!.join("\n"), /\[atom: hammer\]/);
  h.emit("tool_execution_start", { toolCallId: "lens", toolName: "read" });
  assert.match(h.lines(80)!.join("\n"), /\[parallel: hammer ∥ lens\]/);
  t.mock.timers.tick(500);
  h.emit("tool_execution_end", { toolCallId: "lens", toolName: "read", isError: false });
  h.emit("tool_execution_end", { toolCallId: "hammer", toolName: "bash", isError: false });
  await h.command("status");
  assert.match(h.notices.at(-1)!, /style=braille; motion=swarm/);
  await h.command("motion still");
  const afterStill = h.renders;
  t.mock.timers.tick(1000);
  assert.equal(h.renders, afterStill);
  await h.command("ascii");
  assert.doesNotMatch(h.lines(80)!.join("\n"), /braille swarm/);
  h.emit("session_shutdown");
});

test("mood changes restart their animation from the first pose", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  h.emit("session_start");
  assert.ok(h.lines(80)!.some((line) => line.includes("(_|___|_)~")));
  t.mock.timers.tick(500);
  assert.ok(h.lines(80)!.some((line) => line.includes("~(_|___|_)")));
  h.emit("agent_start");
  assert.ok(h.lines(80)!.some((line) => line.includes("( o_O )  ?")));
  t.mock.timers.tick(500);
  assert.ok(h.lines(80)!.some((line) => line.includes("( O_o )  ?")));
  h.emit("tool_execution_start", { toolCallId: "1" });
  assert.ok(h.lines(80)!.some((line) => line.includes("/|_|\\")));
  h.emit("session_shutdown");
});

test("happy timeout cannot overwrite a new run; shutdown stops animation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  h.emit("session_start");
  h.emit("agent_start");
  h.emit("agent_settled");
  assert.match(h.status!, /turn ended/);
  t.mock.timers.tick(2500);
  assert.match(h.status!, /idle/);
  h.emit("agent_start"); h.emit("agent_settled");
  t.mock.timers.tick(1000);
  h.emit("agent_start");
  t.mock.timers.tick(2000);
  assert.match(h.status!, /thinking/);
  h.emit("session_shutdown");
  const afterShutdown = h.renders;
  t.mock.timers.tick(10000);
  assert.equal(h.renders, afterShutdown);
  assert.equal(h.widget, undefined);
});

test("off cancels the completion timer and a fresh session uses defaults", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  h.emit("session_start"); h.emit("agent_start"); h.emit("agent_settled");
  await h.command("off");
  const afterOff = h.renders;
  t.mock.timers.tick(5000);
  assert.equal(h.renders, afterOff);
  h.emit("session_shutdown");

  const fresh = harness();
  fresh.emit("session_start");
  assert.match(fresh.status!, /idle/);
  await fresh.command("sleep");
  assert.match(fresh.status!, /sleeping/);
  await fresh.command("bad-command");
  assert.match(fresh.notices.at(-1)!, /\/face help/);
  fresh.emit("session_shutdown");
});
