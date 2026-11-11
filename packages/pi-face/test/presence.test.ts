import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentFaceEngine } from "../src/presence.ts";

test("frontend-neutral engine maps lifecycle events to normalized frames", () => {
  const engine = new AgentFaceEngine(123, "idle");
  assert.equal(engine.snapshot().mood, "idle");
  engine.dispatch({ type: "run_start" });
  assert.equal(engine.mood, "thinking");
  engine.dispatch({ type: "tool_start", id: "a", name: "bash" });
  let frame = engine.advance(6);
  assert.equal(frame.mood, "tool");
  assert.equal(frame.motif, "hammer");
  assert.equal(frame.motifVisible, true);
  assert.equal(frame.activeToolName, "bash");
  assert.ok(frame.particles.length > 100);
  assert.ok(frame.particles.every((particle) =>
    particle.x >= 0 && particle.x <= 1 && particle.y >= 0 && particle.y <= 1));

  engine.dispatch({ type: "tool_end", id: "a", isError: false });
  frame = engine.advance(2);
  assert.equal(frame.mood, "thinking");
  assert.equal(frame.motifEcho, true);
  assert.equal(frame.motifVisible, true);
  engine.dispatch({ type: "settled" });
  assert.equal(engine.mood, "happy");
});

test("frames expose richer observable lifecycle metadata", () => {
  const engine = new AgentFaceEngine(456, "idle");
  engine.dispatch({ type: "run_prepare" });
  assert.equal(engine.snapshot().phase, "starting");
  engine.dispatch({ type: "run_start" });
  engine.dispatch({ type: "output", intensity: 0.5 });
  assert.equal(engine.snapshot().phase, "streaming");
  engine.dispatch({ type: "run_end" });
  assert.equal(engine.snapshot().label, "checking next step");
  engine.dispatch({ type: "run_start" });
  assert.equal(engine.snapshot().runCount, 2);
  assert.equal(engine.snapshot().label, "continuing run");
  engine.dispatch({ type: "tool_start", id: "outer", name: "codemode" });
  engine.dispatch({ type: "tool_start", id: "outer/1", name: "read", parentId: "outer" });
  let frame = engine.snapshot();
  assert.equal(frame.activeToolCount, 2);
  assert.equal(frame.nestedToolCount, 1);
  assert.deepEqual(frame.activeMotifs, ["network", "lens"]);
  assert.equal(frame.toolExpression.kind, "nested");
  assert.equal(frame.toolVisualPlan.operator, "nested");
  assert.match(frame.toolExpressionText, /codemode.*▷.*read/s);
  assert.equal(frame.toolSummary, "network ▷ lens");
  assert.deepEqual(frame.motifs, ["network", "lens"]);
  assert.equal(frame.toolOperator, "nested");
  assert.equal(frame.motif, "network");
  engine.dispatch({ type: "tool_update", id: "outer/1", progress: 0.64 });
  frame = engine.snapshot();
  assert.equal(frame.toolProgress, 0.64);
  assert.match(frame.label, /64%/);
  assert.match(frame.toolExpressionKey, /@64/);
  engine.dispatch({ type: "prompt_start", kind: "confirm" });
  assert.equal(engine.snapshot().label, "waiting for approval");
  engine.dispatch({ type: "prompt_end" });
  engine.dispatch({ type: "tool_end", id: "outer/1", isError: false });
  engine.dispatch({ type: "tool_end", id: "outer", isError: false });
  engine.dispatch({ type: "finalizing" });
  assert.equal(engine.snapshot().phase, "finalizing");
  engine.dispatch({ type: "settled" });
  engine.dispatch({ type: "model_selected", name: "openai/example" });
  frame = engine.snapshot();
  assert.equal(frame.phase, "model-selected");
  assert.equal(frame.modelName, "openai/example");
});

test("frontends can select an emergent face and pulse it from observed output", () => {
  const engine = new AgentFaceEngine(123, "idle", "emergent-face");
  assert.equal(engine.snapshot().homeForm, "emergent-face");
  engine.dispatch({ type: "run_start" });
  engine.dispatch({ type: "output", intensity: 0.8 });
  assert.equal(engine.advance().outputActive, true);
  engine.dispatch({ type: "form", form: "cat" });
  assert.equal(engine.snapshot().homeForm, "cat");
});

test("fixed-step frontend time remains deterministic", () => {
  const first = new AgentFaceEngine(5150, "idle", "emergent-face");
  const second = new AgentFaceEngine(5150, "idle", "emergent-face");
  first.dispatch({ type: "run_start" });
  second.dispatch({ type: "run_start" });
  first.dispatch({ type: "output", intensity: 0.8, members: [0.2, 0.4, 0.6, 0.8, 1] });
  second.dispatch({ type: "output", intensity: 0.8, members: [0.2, 0.4, 0.6, 0.8, 1] });
  for (let frame = 0; frame < 30; frame++) {
    first.advanceTime(1000 / 60);
    second.advanceTime(1000 / 60);
  }
  assert.deepEqual(first.snapshot(), second.snapshot());
});

test("event streams are deterministic when the frontend supplies a seed", () => {
  const first = new AgentFaceEngine(77);
  const second = new AgentFaceEngine(77);
  const events = [
    { type: "run_start" as const },
    { type: "tool_start" as const, id: "r", name: "read" },
    { type: "tool_end" as const, id: "r", isError: false },
  ];
  for (const event of events) {
    first.dispatch(event);
    second.dispatch(event);
    first.advance(4);
    second.advance(4);
  }
  assert.deepEqual(first.snapshot(), second.snapshot());
});
