import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolMotif } from "../src/swarm.ts";
import {
  TOOL_IDENTITY,
  ToolAlgebraTrace,
  atomsIn,
  failed,
  formatToolExpression,
  formatToolMotifExpression,
  layoutToolExpression,
  nested,
  parallel,
  sequence,
  toolExpressionKey,
  type ToolExpression,
} from "../src/tool-algebra.ts";

function atom(id: string, motif: ToolMotif = "gear"): ToolExpression {
  return { kind: "atom", id, name: id, motif, status: "completed" };
}

test("tool-expression constructors are closed and satisfy their declared laws", () => {
  const a = atom("a", "lens");
  const b = atom("b", "pencil");
  const c = atom("c", "hammer");

  assert.deepEqual(sequence(TOOL_IDENTITY, a), a);
  assert.deepEqual(sequence(a, TOOL_IDENTITY), a);
  assert.deepEqual(sequence(sequence(a, b), c), sequence(a, sequence(b, c)));

  assert.deepEqual(parallel(TOOL_IDENTITY, a), a);
  assert.deepEqual(parallel(a, b), parallel(b, a));
  assert.deepEqual(parallel(parallel(a, b), c), parallel(a, parallel(b, c)));

  assert.deepEqual(nested(TOOL_IDENTITY, a), a);
  assert.deepEqual(nested(a, TOOL_IDENTITY), a);
  assert.deepEqual(failed(failed(a)), failed(a));
  assert.equal(
    formatToolMotifExpression(nested(atom("parent", "network"), sequence(a, parallel(b, c)))),
    "network ▷ lens → (pencil ∥ hammer)",
  );

  for (const expression of [sequence(a, b), parallel(a, b), nested(a, b), failed(a)]) {
    assert.ok(["sequence", "parallel", "nested", "failed"].includes(expression.kind));
    assert.ok(toolExpressionKey(expression).length > 0);
    assert.ok(formatToolExpression(expression).length > 0);
  }
});

test("visual projection preserves sequence, parallel, nesting and failure structure", () => {
  const a = atom("a", "lens");
  const b = atom("b", "pencil");

  const sequential = layoutToolExpression(sequence(a, b));
  assert.equal(sequential.operator, "sequence");
  assert.equal(sequential.layers.length, 2);
  assert.ok(sequential.layers[0].x < sequential.layers[1].x);
  assert.equal(sequential.links.filter((link) => link.kind === "sequence").length, 1);

  const concurrent = layoutToolExpression(parallel(a, b));
  assert.equal(concurrent.operator, "parallel");
  assert.equal(concurrent.layers.length, 2);
  assert.notEqual(concurrent.layers[0].x, concurrent.layers[1].x);
  assert.equal(concurrent.links.filter((link) => link.kind === "parallel").length, 2);

  const hierarchy = layoutToolExpression(nested(a, failed(b)));
  assert.equal(hierarchy.operator, "nested");
  assert.deepEqual(hierarchy.layers.map((layer) => layer.depth), [0, 1]);
  assert.equal(hierarchy.layers[1].failed, true);
  assert.equal(hierarchy.links.filter((link) => link.kind === "nested").length, 1);
});

test("trace preserves sequential and parallel composition", () => {
  const trace = new ToolAlgebraTrace();
  trace.start("read-1", "read");
  trace.end("read-1", false);
  trace.start("edit-1", "edit");
  trace.end("edit-1", false);
  let expression = trace.expression();
  assert.equal(expression.kind, "sequence");
  assert.match(formatToolExpression(expression), /read.* ; edit/s);

  trace.reset();
  trace.start("read-1", "read");
  trace.start("edit-1", "edit");
  trace.end("edit-1", false);
  trace.end("read-1", false);
  expression = trace.expression();
  assert.equal(expression.kind, "parallel");
  assert.match(formatToolExpression(expression), /∥/);
});

test("trace preserves nesting, progress, failure and active motifs", () => {
  const trace = new ToolAlgebraTrace();
  trace.start("outer", "codemode");
  trace.start("outer/1", "read", "outer");
  trace.update("outer/1", 0.42);
  assert.deepEqual(trace.activeMotifs, ["network", "lens"]);
  let expression = trace.expression();
  assert.equal(expression.kind, "nested");
  assert.match(formatToolExpression(expression), /42%/);

  trace.end("outer/1", true);
  trace.end("outer", false);
  expression = trace.expression();
  assert.match(toolExpressionKey(expression), /fail\(/);
  const atoms = atomsIn(expression);
  assert.equal(atoms.length, 2);
  assert.equal(atoms.find((entry) => entry.id === "outer/1")?.status, "error");
});

test("settlement closes orphaned active calls without inventing success", () => {
  const trace = new ToolAlgebraTrace();
  trace.start("a", "bash");
  trace.start("b", "read");
  trace.settle(true);
  assert.equal(trace.activeRecords.length, 0);
  assert.ok(atomsIn(trace.expression()).every((entry) => entry.status === "cancelled"));
});
