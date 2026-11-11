import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ambientPresenceLines } from "../src/ambient.ts";
import { AgentFaceEngine } from "../src/presence.ts";

function assertCompact(lines: readonly string[], width: number) {
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => visibleWidth(line) <= width));
  assert.doesNotMatch(lines.join("\n"), /pi face|[+╭╰]/);
}

test("ambient renderer provides compact distinct lifecycle signals", () => {
  const engine = new AgentFaceEngine(123, "idle");
  const idle = ambientPresenceLines(engine.snapshot(), 28);
  assertCompact(idle, 28);
  assert.match(idle[1], /idle/);

  engine.dispatch({ type: "run_prepare" });
  const starting = ambientPresenceLines(engine.advance(2), 28);
  assertCompact(starting, 28);
  assert.match(starting[1], /starting run/);
  assert.notEqual(starting[0], idle[0]);

  engine.dispatch({ type: "run_start" });
  engine.dispatch({ type: "output", intensity: 0.8 });
  const streaming = ambientPresenceLines(engine.advance(2), 28);
  assert.match(streaming[1], /streaming output/);
  assert.match(streaming[0], /[\u2801-\u28ff]/u);

  engine.dispatch({ type: "prompt_start", kind: "confirm" });
  const waiting = ambientPresenceLines(engine.advance(), 28);
  assert.match(waiting[1], /waiting for approval/);
  assert.match(waiting[0], /[⣿⠿]/u);
});

test("ambient rail renders the closed tool algebra without a character", () => {
  const engine = new AgentFaceEngine(456, "idle");
  engine.dispatch({ type: "run_start" });
  engine.dispatch({ type: "tool_start", id: "a-read", name: "read" });
  engine.dispatch({ type: "tool_start", id: "b-edit", name: "edit" });
  let frame = engine.advance(4);
  let lines = ambientPresenceLines(frame, 40);
  assertCompact(lines, 40);
  assert.match(lines[1], /parallel.*lens ∥ pencil/);
  assert.match(lines[0], /[\u2800-\u28ff]/u);

  const nestedEngine = new AgentFaceEngine(789, "idle");
  nestedEngine.dispatch({ type: "run_start" });
  nestedEngine.dispatch({ type: "tool_start", id: "outer", name: "codemode" });
  nestedEngine.dispatch({ type: "tool_start", id: "outer/1", name: "jev_ask", parentId: "outer" });
  frame = nestedEngine.advance(4);
  lines = ambientPresenceLines(frame, 40);
  assert.match(lines[1], /nested.*network ▷ gear/);
  assert.match(lines[0], /(?:⠛[⣭⠭]⣤|⣤[⣭⠭]⠛)/u);
});

test("ambient output is deterministic and adapts to narrow terminals", () => {
  const first = new AgentFaceEngine(77, "idle");
  const second = new AgentFaceEngine(77, "idle");
  for (const engine of [first, second]) {
    engine.dispatch({ type: "run_start" });
    engine.dispatch({ type: "tool_start", id: "a", name: "bash" });
    engine.dispatch({ type: "tool_update", id: "a", progress: 0.5 });
    engine.advance(3);
  }
  assert.deepEqual(ambientPresenceLines(first.snapshot(), 16), ambientPresenceLines(second.snapshot(), 16));
  assertCompact(ambientPresenceLines(first.snapshot(), 6), 6);
  const ascii = ambientPresenceLines(first.snapshot(), 32, "ascii");
  assertCompact(ascii, 32);
  assert.match(ascii[0], /^[\x20-\x7e]+$/);
  assert.match(ascii[0], /H/);
});
