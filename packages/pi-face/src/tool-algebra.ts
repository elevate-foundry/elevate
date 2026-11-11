import { motifForTool, type ToolMotif } from "./tool-motifs.ts";

export type ToolStatus = "active" | "completed" | "error" | "cancelled" | "incomplete";

export type ToolExpression =
  | { readonly kind: "identity" }
  | {
      readonly kind: "atom";
      readonly id: string;
      readonly name: string;
      readonly motif: ToolMotif;
      readonly status: ToolStatus;
      readonly progress?: number;
    }
  | { readonly kind: "sequence"; readonly items: readonly ToolExpression[] }
  | { readonly kind: "parallel"; readonly items: readonly ToolExpression[] }
  | { readonly kind: "nested"; readonly parent: ToolExpression; readonly children: ToolExpression }
  | { readonly kind: "failed"; readonly expression: ToolExpression };

export const TOOL_IDENTITY: ToolExpression = Object.freeze({ kind: "identity" });

function structuralKey(expression: ToolExpression): string {
  if (expression.kind === "identity") return "0";
  if (expression.kind === "atom") return `a:${expression.id}`;
  if (expression.kind === "failed") return `f:${structuralKey(expression.expression)}`;
  if (expression.kind === "nested") {
    return `n:${structuralKey(expression.parent)}>${structuralKey(expression.children)}`;
  }
  const operator = expression.kind === "sequence" ? "s" : "p";
  return `${operator}:${expression.items.map(structuralKey).join(",")}`;
}

/** Associative sequential composition with identity elimination. */
export function sequence(...expressions: readonly ToolExpression[]): ToolExpression {
  const items = expressions.flatMap((expression) =>
    expression.kind === "identity" ? [] : expression.kind === "sequence" ? expression.items : [expression]);
  if (items.length === 0) return TOOL_IDENTITY;
  if (items.length === 1) return items[0];
  return { kind: "sequence", items };
}

/** Associative and commutative parallel composition with identity elimination. */
export function parallel(...expressions: readonly ToolExpression[]): ToolExpression {
  const items = expressions.flatMap((expression) =>
    expression.kind === "identity" ? [] : expression.kind === "parallel" ? expression.items : [expression]);
  if (items.length === 0) return TOOL_IDENTITY;
  if (items.length === 1) return items[0];
  return { kind: "parallel", items: [...items].sort((left, right) => structuralKey(left).localeCompare(structuralKey(right))) };
}

/** Parent-child composition. Identity behaves neutrally on either side. */
export function nested(parent: ToolExpression, children: ToolExpression): ToolExpression {
  if (parent.kind === "identity") return children;
  if (children.kind === "identity") return parent;
  return { kind: "nested", parent, children };
}

/** Idempotent failure decoration. */
export function failed(expression: ToolExpression): ToolExpression {
  if (expression.kind === "identity" || expression.kind === "failed") return expression;
  return { kind: "failed", expression };
}

export function toolExpressionKey(expression: ToolExpression): string {
  if (expression.kind === "identity") return "identity";
  if (expression.kind === "atom") {
    const progress = expression.progress === undefined ? "" : `@${Math.round(expression.progress * 100)}`;
    return `${expression.name}#${expression.id}:${expression.motif}:${expression.status}${progress}`;
  }
  if (expression.kind === "sequence") return `seq(${expression.items.map(toolExpressionKey).join(",")})`;
  if (expression.kind === "parallel") return `par(${expression.items.map(toolExpressionKey).join(",")})`;
  if (expression.kind === "nested") {
    return `nest(${toolExpressionKey(expression.parent)},${toolExpressionKey(expression.children)})`;
  }
  return `fail(${toolExpressionKey(expression.expression)})`;
}

export function formatToolExpression(expression: ToolExpression): string {
  if (expression.kind === "identity") return "idle";
  if (expression.kind === "atom") {
    const progress = expression.progress === undefined ? "" : ` ${Math.round(expression.progress * 100)}%`;
    return `${expression.name}[${expression.motif}:${expression.status}${progress}]`;
  }
  if (expression.kind === "sequence") return expression.items.map(formatToolExpression).join(" ; ");
  if (expression.kind === "parallel") return `(${expression.items.map(formatToolExpression).join(" ∥ ")})`;
  if (expression.kind === "nested") {
    return `${formatToolExpression(expression.parent)} ▷ ${formatToolExpression(expression.children)}`;
  }
  return `failed(${formatToolExpression(expression.expression)})`;
}

/** Compact motif-only notation that preserves the complete expression tree. */
export function formatToolMotifExpression(expression: ToolExpression): string {
  if (expression.kind === "identity") return "idle";
  if (expression.kind === "atom") return expression.motif;
  if (expression.kind === "sequence") return expression.items.map(formatToolMotifExpression).join(" → ");
  if (expression.kind === "parallel") return `(${expression.items.map(formatToolMotifExpression).join(" ∥ ")})`;
  if (expression.kind === "nested") {
    return `${formatToolMotifExpression(expression.parent)} ▷ ${formatToolMotifExpression(expression.children)}`;
  }
  return `!${formatToolMotifExpression(expression.expression)}`;
}

export function atomsIn(expression: ToolExpression): readonly Extract<ToolExpression, { kind: "atom" }>[] {
  if (expression.kind === "identity") return [];
  if (expression.kind === "atom") return [expression];
  if (expression.kind === "failed") return atomsIn(expression.expression);
  if (expression.kind === "nested") return [...atomsIn(expression.parent), ...atomsIn(expression.children)];
  return expression.items.flatMap(atomsIn);
}

export type ToolVisualRelation = "atom" | "sequence" | "parallel" | "nested-parent" | "nested-child";

export interface ToolVisualLayer {
  id: string;
  name: string;
  motif: ToolMotif;
  status: ToolStatus;
  progress?: number;
  x: number;
  y: number;
  scale: number;
  depth: number;
  relation: ToolVisualRelation;
  failed: boolean;
  weight: number;
}

export interface ToolVisualLink {
  kind: "sequence" | "parallel" | "nested";
  from: readonly [number, number];
  to: readonly [number, number];
}

export interface ToolVisualPlan {
  operator: ToolExpression["kind"];
  layers: readonly ToolVisualLayer[];
  links: readonly ToolVisualLink[];
}

type Bounds = { x: number; y: number; width: number; height: number };
type LayoutResult = ToolVisualPlan & { center: readonly [number, number] };

function layerWeight(status: ToolStatus) {
  if (status === "active" || status === "error") return 1;
  if (status === "completed") return 0.46;
  return 0.6;
}

function layoutExpression(
  expression: ToolExpression,
  bounds: Bounds,
  depth: number,
  relation: ToolVisualRelation,
  inheritedFailure: boolean,
): LayoutResult {
  const center = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2] as const;
  if (expression.kind === "identity") return { operator: "identity", layers: [], links: [], center };
  if (expression.kind === "failed") {
    return layoutExpression(expression.expression, bounds, depth, relation, true);
  }
  if (expression.kind === "atom") {
    return {
      operator: "atom",
      layers: [{
        ...expression,
        x: center[0],
        y: center[1],
        scale: Math.max(0.16, Math.min(bounds.width, bounds.height)),
        depth,
        relation,
        failed: inheritedFailure || expression.status === "error",
        weight: layerWeight(expression.status),
      }],
      links: [],
      center,
    };
  }
  if (expression.kind === "nested") {
    const parent = layoutExpression(expression.parent, bounds, depth, "nested-parent", inheritedFailure);
    const childBounds = {
      x: bounds.x + bounds.width * 0.46,
      y: bounds.y + bounds.height * 0.18,
      width: bounds.width * 0.48,
      height: bounds.height * 0.48,
    };
    const children = layoutExpression(expression.children, childBounds, depth + 1, "nested-child", inheritedFailure);
    return {
      operator: "nested",
      layers: [...parent.layers, ...children.layers],
      links: [...parent.links, ...children.links, { kind: "nested", from: parent.center, to: children.center }],
      center: parent.center,
    };
  }

  const items = expression.items;
  const results: LayoutResult[] = [];
  if (expression.kind === "sequence") {
    const gap = Math.min(0.045, bounds.width / Math.max(8, items.length * 4));
    const width = Math.max(0.08, (bounds.width - gap * (items.length - 1)) / items.length);
    items.forEach((item, index) => {
      results.push(layoutExpression(item, {
        x: bounds.x + index * (width + gap),
        y: bounds.y,
        width,
        height: bounds.height,
      }, depth, "sequence", inheritedFailure));
    });
  } else {
    const columns = items.length === 2 ? 2 : Math.ceil(Math.sqrt(items.length));
    const rows = Math.ceil(items.length / columns);
    const cellWidth = bounds.width / columns;
    const cellHeight = bounds.height / rows;
    items.forEach((item, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      results.push(layoutExpression(item, {
        x: bounds.x + column * cellWidth + cellWidth * 0.03,
        y: bounds.y + row * cellHeight + cellHeight * 0.03,
        width: cellWidth * 0.94,
        height: cellHeight * 0.94,
      }, depth, "parallel", inheritedFailure));
    });
  }

  const links: ToolVisualLink[] = results.flatMap((result) => result.links);
  if (expression.kind === "sequence") {
    for (let index = 1; index < results.length; index++) {
      links.push({ kind: "sequence", from: results[index - 1].center, to: results[index].center });
    }
  } else {
    for (const result of results) links.push({ kind: "parallel", from: center, to: result.center });
  }
  return {
    operator: expression.kind,
    layers: results.flatMap((result) => result.layers),
    links,
    center,
  };
}

/** Deterministic homomorphism from tool expressions into normalized visual layers. */
export function layoutToolExpression(expression: ToolExpression): ToolVisualPlan {
  const result = layoutExpression(expression, { x: 0.06, y: 0.06, width: 0.88, height: 0.88 }, 0, "atom", false);
  return { operator: expression.kind, layers: result.layers, links: result.links };
}

type ToolRecord = {
  id: string;
  name: string;
  motif: ToolMotif;
  parentId?: string;
  status: ToolStatus;
  progress?: number;
  startedAt: number;
  endedAt?: number;
};

function intervalEnd(record: ToolRecord) {
  return record.endedAt ?? Number.POSITIVE_INFINITY;
}

/** Compose interval-overlap components in sequence; calls in one component are parallel. */
function composeIntervals(records: readonly ToolRecord[], build: (record: ToolRecord) => ToolExpression): ToolExpression {
  const ordered = [...records].sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id));
  const components: ToolExpression[] = [];
  let group: ToolRecord[] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (group.length === 0) return;
    components.push(group.length === 1 ? build(group[0]) : parallel(...group.map(build)));
    group = [];
    groupEnd = Number.NEGATIVE_INFINITY;
  };

  for (const record of ordered) {
    if (group.length > 0 && record.startedAt > groupEnd) flush();
    group.push(record);
    groupEnd = Math.max(groupEnd, intervalEnd(record));
  }
  flush();
  return sequence(...components);
}

/**
 * Event-sourced runtime for the closed tool-expression algebra.
 *
 * Deterministic event facts stay in code. The resulting expression preserves
 * sequence, parallel overlap, nesting, progress, completion, and failure.
 */
export class ToolAlgebraTrace {
  private readonly records = new Map<string, ToolRecord>();
  private clock = 0;

  reset() {
    this.records.clear();
    this.clock = 0;
  }

  start(id: string, name: string, parentId?: string) {
    if (this.records.has(id)) throw new Error(`Duplicate tool call id: ${id}`);
    this.records.set(id, {
      id,
      name,
      motif: motifForTool(name),
      parentId,
      status: "active",
      startedAt: ++this.clock,
    });
  }

  update(id: string, progress?: number) {
    const record = this.records.get(id);
    if (!record || record.status !== "active" || progress === undefined || !Number.isFinite(progress)) return;
    record.progress = Math.max(0, Math.min(1, progress));
  }

  end(id: string, isError: boolean) {
    const record = this.records.get(id);
    if (!record || record.status !== "active") return;
    record.status = isError ? "error" : "completed";
    record.progress = record.progress === undefined ? undefined : isError ? record.progress : 1;
    record.endedAt = ++this.clock;
  }

  settle(aborted = false) {
    for (const record of this.records.values()) {
      if (record.status !== "active") continue;
      record.status = aborted ? "cancelled" : "incomplete";
      record.endedAt = ++this.clock;
    }
  }

  get activeRecords(): readonly ToolRecord[] {
    return [...this.records.values()]
      .filter((record) => record.status === "active")
      .sort((left, right) => left.startedAt - right.startedAt);
  }

  get activeMotifs(): readonly ToolMotif[] {
    return this.activeRecords.map((record) => record.motif);
  }

  expression(): ToolExpression {
    const records = [...this.records.values()];
    if (records.length === 0) return TOOL_IDENTITY;
    const byParent = new Map<string, ToolRecord[]>();
    for (const record of records) {
      if (!record.parentId || !this.records.has(record.parentId)) continue;
      const siblings = byParent.get(record.parentId);
      if (siblings) siblings.push(record);
      else byParent.set(record.parentId, [record]);
    }

    const build = (record: ToolRecord): ToolExpression => {
      const atom: ToolExpression = {
        kind: "atom",
        id: record.id,
        name: record.name,
        motif: record.motif,
        status: record.status,
        progress: record.progress,
      };
      const children = byParent.get(record.id) ?? [];
      const expression = children.length === 0 ? atom : nested(atom, composeIntervals(children, build));
      return record.status === "error" ? failed(expression) : expression;
    };

    const roots = records.filter((record) => !record.parentId || !this.records.has(record.parentId));
    return composeIntervals(roots, build);
  }

  snapshot() {
    const expression = this.expression();
    return {
      expression,
      key: toolExpressionKey(expression),
      text: formatToolExpression(expression),
      motifText: formatToolMotifExpression(expression),
      activeMotifs: this.activeMotifs,
      visualPlan: layoutToolExpression(expression),
    };
  }
}
