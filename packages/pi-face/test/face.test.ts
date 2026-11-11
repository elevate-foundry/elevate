import { test } from "node:test";
import assert from "node:assert/strict";
import { FACE_ANIMATIONS, FaceState, faceLines, FACES, isMood } from "../src/face.ts";

test("normal lifecycle tracks tools and ends without claiming task success", () => {
  const state = new FaceState();
  state.setManual("idle");
  assert.equal(state.mood, "idle");
  state.start();
  assert.equal(state.mood, "thinking");
  state.toolStart("a");
  assert.equal(state.mood, "tool");
  state.toolEnd("a", false);
  assert.equal(state.mood, "thinking");
  state.end();
  assert.equal(state.mood, "happy");
  assert.match(faceLines(state.mood).join("\n"), /turn ended/);
  state.idle();
  assert.equal(state.mood, "idle");
});

test("concurrent and nested tools keep the tool face until all finish", () => {
  const state = new FaceState();
  state.start();
  state.toolStart("a", "bash"); state.toolStart("a/child", "read"); state.toolStart("b", "edit");
  assert.equal(state.currentToolName, "edit");
  state.toolEnd("a", false); state.toolEnd("b", false);
  assert.equal(state.mood, "tool");
  assert.equal(state.currentToolName, "read");
  state.toolEnd("a/child", false);
  assert.equal(state.currentToolName, undefined);
  assert.equal(state.mood, "thinking");
});

test("errors remain visible even if subsequent tools succeed", () => {
  const state = new FaceState();
  state.start(); state.toolStart("a"); state.toolEnd("a", true);
  assert.equal(state.mood, "error");
  state.toolStart("b"); state.toolEnd("b", false); state.end();
  assert.equal(state.mood, "error");
  state.idle();
  assert.equal(state.mood, "error");
  state.start();
  assert.equal(state.mood, "thinking");
});

test("model errors and cancellations do not show a happy face", () => {
  for (const [reason, expected] of [["error", "error"], ["aborted", "cancelled"]]) {
    const state = new FaceState();
    state.start(); state.messageEnd(reason); state.end();
    assert.equal(state.mood, expected);
  }
});

test("nested UI prompts take precedence and restore the underlying activity", () => {
  const state = new FaceState();
  state.start(); state.toolStart("a"); state.promptStart(); state.promptStart();
  assert.equal(state.mood, "waiting");
  state.promptEnd();
  assert.equal(state.mood, "waiting");
  state.promptEnd(); state.promptEnd();
  assert.equal(state.mood, "tool");
});

test("manual moods reset when real activity starts", () => {
  const state = new FaceState();
  state.setManual("sleep");
  assert.equal(state.mood, "sleep");
  state.start();
  assert.equal(state.mood, "thinking");
});

test("observable phases distinguish startup, streaming, continuation and finalization", () => {
  const state = new FaceState();
  state.setManual("idle");
  state.prepare();
  assert.equal(state.phase, "starting");
  assert.equal(state.label, "starting run");
  state.start();
  assert.equal(state.phase, "running");
  state.observeOutput();
  assert.equal(state.phase, "streaming");
  assert.equal(state.label, "streaming output");
  state.runEnd();
  assert.equal(state.phase, "continuing");
  assert.equal(state.label, "checking next step");
  state.start();
  assert.equal(state.runCount, 2);
  assert.equal(state.label, "continuing run");
  state.beforeSettle();
  assert.equal(state.phase, "finalizing");
  state.end();
  assert.equal(state.phase, "settled");
  state.modelSelected("provider/model");
  assert.equal(state.phase, "model-selected");
  assert.equal(state.modelName, "provider/model");

  const idle = new FaceState();
  idle.setManual("idle");
  idle.modelSelected("provider/other");
  assert.equal(idle.mood, "idle");
  assert.equal(idle.phase, "model-selected");
  assert.equal(idle.label, "model selected");
});

test("tool progress, nesting, concurrency and approval prompts remain observable", () => {
  const state = new FaceState();
  state.start();
  state.toolStart("outer", "codemode");
  state.toolStart("outer/1", "read", "outer");
  assert.equal(state.activeToolCount, 2);
  assert.equal(state.nestedToolCount, 1);
  assert.equal(state.label, "using 2 tools");
  state.toolUpdate("outer/1", 0.42);
  assert.equal(state.currentToolProgress, 0.42);
  assert.match(state.label, /42%/);
  state.promptStart("confirm");
  assert.equal(state.label, "waiting for approval");
  state.promptEnd();
  assert.match(state.label, /42%/);
});

test("one-shot reactions settle while ambient poses keep looping", () => {
  const body = (mood: Parameters<typeof faceLines>[0], tick: number) => faceLines(mood, tick).slice(2, -1);
  assert.deepEqual(body("error", 99), body("error", 2));
  assert.deepEqual(body("cancelled", 99), body("cancelled", 1));
  assert.deepEqual(body("idle", 4), body("idle", 0));
});

test("all animated faces have five-line poses, aligned borders and valid commands", () => {
  for (const mood of Object.keys(FACES)) {
    assert.ok(isMood(mood));
    const animation = FACE_ANIMATIONS[mood];
    assert.ok(animation.frames.length >= 2);
    assert.ok(animation.frames.every((frame) => frame.length === 5));
    assert.ok(new Set(animation.frames.map((frame) => frame.join("\n"))).size >= 2);
    for (let tick = 0; tick < animation.frames.length; tick++) {
      const lines = faceLines(mood, tick);
      assert.equal(lines.length, 8);
      assert.equal(new Set(lines.map((line) => line.length)).size, 1);
    }
  }
  assert.equal(isMood("toString"), false);
  assert.equal(isMood("missing"), false);
});
