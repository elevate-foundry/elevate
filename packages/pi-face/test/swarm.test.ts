import { test } from "node:test";
import assert from "node:assert/strict";
import { BRAILLE_PIXEL_HEIGHT } from "../src/braille.ts";
import { BrailleSwarm, motifForTool } from "../src/swarm.ts";

test("tool names select a visual motif grammar", () => {
  assert.equal(motifForTool("bash"), "hammer");
  assert.equal(motifForTool("read"), "lens");
  assert.equal(motifForTool("whyline_search"), "lens");
  assert.equal(motifForTool("edit"), "pencil");
  assert.equal(motifForTool("multi_tool_use.parallel"), "network");
  assert.equal(motifForTool("jev_ask"), "gear");
  assert.equal(motifForTool("custom_operation"), "gear");
});

test("seeded swarms are reproducible and remain aligned", () => {
  const first = new BrailleSwarm(1234, "idle");
  const second = new BrailleSwarm(1234, "idle");
  assert.deepEqual(first.faceLines("idle"), second.faceLines("idle"));
  for (let tick = 1; tick <= 20; tick++) {
    first.step("thinking", tick);
    second.step("thinking", tick);
  }
  const lines = first.faceLines("thinking", 20);
  assert.deepEqual(lines, second.faceLines("thinking", 20));
  assert.equal(lines.length, BRAILLE_PIXEL_HEIGHT / 4 + 3);
  assert.equal(new Set(lines.map((line) => line.length)).size, 1);
  assert.match(lines.join("\n"), /[\u2801-\u28ff]/u);
});

test("tool choreography assembles a motif and releases it afterward", () => {
  const swarm = new BrailleSwarm(99, "thinking");
  swarm.startTool("bash");
  for (let tick = 1; tick <= 16; tick++) swarm.step("tool", tick);
  const hammer = swarm.faceLines("tool", 16);
  assert.match(hammer[1], /using tools.*atom: hammer/);
  swarm.finishTool(false);
  for (let tick = 1; tick <= 8; tick++) swarm.step("thinking", tick);
  const released = swarm.faceLines("thinking", 8);
  assert.notDeepEqual(released.slice(2, -1), hammer.slice(2, -1));
});

test("fast tools leave a short motif echo so their choreography is visible", () => {
  const swarm = new BrailleSwarm(17, "thinking");
  swarm.startTool("edit");
  swarm.finishTool(false);
  for (let tick = 1; tick <= 4; tick++) swarm.step("thinking", tick);
  assert.match(swarm.faceLines("thinking", 4)[1], /atom: pencil · echo/);
  for (let tick = 5; tick <= 12; tick++) swarm.step("thinking", tick);
  assert.match(swarm.faceLines("thinking", 12)[1], /braille swarm/);
});

test("emergent face preserves a luminous core and responds to observed output", () => {
  const swarm = new BrailleSwarm(1863820086, "idle", "emergent-face");
  for (let tick = 1; tick <= 12; tick++) swarm.step("idle", tick);
  let snapshot = swarm.snapshot();
  assert.equal(snapshot.homeForm, "emergent-face");
  assert.equal(snapshot.particles.filter((particle) => particle.core).length, 44);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, member) => snapshot.particles.filter((particle) => particle.member === member).length),
    [44, 44, 44, 44, 44],
  );
  assert.equal(snapshot.outputActive, false);

  swarm.pulseOutput(0.9);
  swarm.step("thinking", 13);
  snapshot = swarm.snapshot();
  assert.equal(snapshot.outputActive, true);
  assert.match(swarm.faceLines("thinking", 13)[1], /emergent face speaking/);

  swarm.startTool("bash");
  for (let tick = 14; tick <= 24; tick++) swarm.step("tool", tick);
  snapshot = swarm.snapshot();
  assert.ok(snapshot.particles.filter((particle) => particle.core).every((particle) =>
    particle.x > 0.15 && particle.x < 0.85 && particle.y > 0.1 && particle.y < 0.75));
});

test("mood changes preserve particles while changing swarm behavior", () => {
  const swarm = new BrailleSwarm(42, "idle");
  const idle = swarm.faceLines("idle");
  swarm.setMood("error");
  for (let tick = 1; tick <= 8; tick++) swarm.step("error", tick);
  const error = swarm.faceLines("error", 8);
  assert.notDeepEqual(error.slice(2, -1), idle.slice(2, -1));
  assert.match(error[1], /error observed.*braille swarm/);
  assert.deepEqual(error, swarm.faceLines("error", 8));
});
