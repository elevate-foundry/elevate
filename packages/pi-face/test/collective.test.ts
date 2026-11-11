import { test } from "node:test";
import assert from "node:assert/strict";
import { contourField, curlField, measureCollectiveOrder, vortexField } from "../src/collective-kernel.ts";
import { AgentPresenceNetwork } from "../src/collective-presence.ts";

test("formal fields are deterministic and bounded by their inputs", () => {
  const contour = contourField({ x: 0, y: 0 }, [{ x: 1, y: 0 }, { x: 0, y: 1 }], { x: 0, y: 1 }, 0.25, 0.5);
  assert.deepEqual(contour, { x: 0.375, y: 0.125 });
  assert.deepEqual(curlField({ x: 2, y: 3 }, 4, 5, 0.1), curlField({ x: 2, y: 3 }, 4, 5, 0.1));
  assert.deepEqual(vortexField({ x: 2, y: 3 }, { x: 1, y: 1 }, 0.4, 0.8),
    vortexField({ x: 2, y: 3 }, { x: 1, y: 1 }, 0.4, 0.8));
});

test("collective order exposes cohesion, polarization, entropy and topology", () => {
  const order = measureCollectiveOrder([
    { x: 0.1, y: 0.1, vx: 1, vy: 0 },
    { x: 0.12, y: 0.1, vx: 1, vy: 0 },
    { x: 0.8, y: 0.8, vx: 0, vy: 1 },
  ], 0.08);
  assert.equal(order.clusters, 2);
  assert.ok(order.cohesion >= 0 && order.cohesion <= 1);
  assert.ok(order.polarization > 0 && order.polarization < 1);
  assert.ok(order.motionEntropy > 0);
});

test("multi-agent handoffs are evidence-linked and replayable", () => {
  const network = new AgentPresenceNetwork(77);
  network.dispatch({ type: "agent_added", agentId: "planner", label: "Planner" });
  network.dispatch({ type: "agent_added", agentId: "builder", label: "Builder" });
  network.dispatch({ type: "agent_event", agentId: "planner", event: { type: "run_start" } });
  network.dispatch({
    type: "handoff_started",
    handoffId: "h1",
    from: "planner",
    to: "builder",
    artifactId: "implementation-plan",
  });
  const frame = network.advanceTime(600);
  assert.equal(frame.agents.length, 2);
  assert.equal(frame.handoffs.length, 1);
  assert.equal(frame.handoffs[0].particles.length, 18);
  assert.ok(frame.handoffs[0].progress > 0);
  assert.ok(frame.agents.every((agent) => agent.order.clusters >= 1));

  network.dispatch({ type: "handoff_completed", handoffId: "h1" });
  const tape = network.exportTape();
  assert.equal(tape.length, 5);
  assert.equal(tape[3].event.type, "handoff_started");
  const replayed = AgentPresenceNetwork.replay(77, tape).snapshot();
  assert.equal(replayed.sequence, tape.length);
  assert.deepEqual(replayed.agents.map((agent) => agent.agentId), ["planner", "builder"]);
  assert.equal(replayed.handoffs[0].status, "completed");
});
