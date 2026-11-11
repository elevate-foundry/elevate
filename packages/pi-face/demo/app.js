// src/face.ts
var FACE_ANIMATIONS = {
  idle: {
    frames: [
      ["  /\\_/\\  ", " ( o.o ) ", "  > ^ <  ", " /|   |\\ ", "(_|___|_)~"],
      ["  /\\_/\\  ", " ( o.o ) ", "  > ^ <  ", " /|   |\\ ", "~(_|___|_)"],
      ["  /\\_/|  ", " ( -.- ) ", "  > ^ <  ", " /|   |\\ ", " (_|___|_)"],
      ["  /\\_/\\  ", " ( o.o ) ", "  > ^ <  ", " /|   |\\ ", "(_|___|_)~"]
    ]
  },
  thinking: {
    frames: [
      ["  /\\_/\\   ", " ( o_O )  ?", "  > ^ <   .", " /|   |\\   ", "(_|___|_)  "],
      ["  /\\_/\\   ", " ( O_o )  ?", "  > ^ <  ..", " /|   |\\   ", "(_|___|_)  "],
      ["  /\\_/\\   ", " ( O_O )  ?", "  > ^ < ...", " /|   |\\   ", "(_|___|_)  "],
      ["  /\\_/\\   ", " ( o_O )  ?", "  > ^ <  ..", " /|   |\\   ", "(_|___|_)  "]
    ]
  },
  tool: {
    frames: [
      ["  /\\_/\\  ", " ( o_o ) ", "  /|_|\\  ", " /|===|\\ ", "(_|___|_)"],
      ["  /\\_/\\  ", " ( o_o ) ", "  \\|_|/  ", " /|===|\\ ", "(_|___|_)"]
    ]
  },
  happy: {
    frames: [
      ["  /\\_/\\  ", " ( ^.^ ) ", "  > w <  ", " /|~~~|\\ ", "(_|___|_)"],
      ["  /\\_/\\  ", " ( -.- ) ", "  > w <  ", " /|~p~|\\ ", "(_|___|_)"]
    ]
  },
  error: {
    frames: [
      [" /\\_/\\   ", "( >_< )  ", " > ! <   ", "/|   |\\  ", "(_|___|_)"],
      ["   /\\_/\\ ", "  ( >_< )", "   > ! < ", "  /|   |\\", " (_|___|_)"],
      ["  /\\_/\\  ", " ( x_x ) ", "  > ! <  ", " /|   |\\ ", "(_|___|_)"]
    ],
    loop: false
  },
  sleep: {
    frames: [
      ["  /\\_/\\    ", " ( -.- )  z", "  > ^ <  z ", " /|   |\\   ", "(_|___|_)  "],
      ["  /\\_/\\   Z", " ( -.- ) z ", "  > ^ <    ", " /|  ~|\\   ", "(_|___|_)  "]
    ]
  },
  waiting: {
    frames: [
      ["  /\\_/\\   ", " ( O.O )  ", "  > ^ <  /", " /|   |_/ ", "(_|___|_) "],
      ["  /\\_/\\   ", " ( O.O )  ", "  > ^ <  |", " /|   | | ", "(_|___|_) "],
      ["  /\\_/\\   ", " ( O.O )  ", "  > ^ <  \\", " /|   |_\\ ", "(_|___|_) "]
    ]
  },
  cancelled: {
    frames: [
      ["  /\\_/\\  ", " ( O_O ) ", "  > ! <  ", " /|   |\\ ", "(_|___|_)"],
      ["  /\\_/\\  ", " ( -_- ) ", "  > - <  ", " /|   |\\ ", "(_|___|_)"]
    ],
    loop: false
  }
};
var FACES = {
  idle: FACE_ANIMATIONS.idle.frames[0],
  thinking: FACE_ANIMATIONS.thinking.frames[0],
  tool: FACE_ANIMATIONS.tool.frames[0],
  happy: FACE_ANIMATIONS.happy.frames[0],
  error: FACE_ANIMATIONS.error.frames[0],
  sleep: FACE_ANIMATIONS.sleep.frames[0],
  waiting: FACE_ANIMATIONS.waiting.frames[0],
  cancelled: FACE_ANIMATIONS.cancelled.frames[0]
};
var LABELS = {
  idle: "idle",
  thinking: "thinking",
  tool: "using tools",
  happy: "turn ended",
  error: "error observed",
  sleep: "sleeping",
  waiting: "waiting for you",
  cancelled: "interrupted"
};
var FaceState = class {
  active = false;
  tools = /* @__PURE__ */ new Map();
  prompts = [];
  error = false;
  aborted = false;
  manual;
  preparing = false;
  betweenRuns = false;
  finalizing = false;
  streaming = false;
  runs = 0;
  selectedModel;
  modelNotice = false;
  resetActivity() {
    this.active = true;
    this.tools.clear();
    this.prompts = [];
    this.error = false;
    this.aborted = false;
    this.manual = void 0;
    this.preparing = false;
    this.betweenRuns = false;
    this.finalizing = false;
    this.streaming = false;
    this.runs = 0;
    this.modelNotice = false;
  }
  prepare() {
    this.resetActivity();
    this.preparing = true;
  }
  start() {
    if (!this.active) this.resetActivity();
    this.manual = void 0;
    this.preparing = false;
    this.betweenRuns = false;
    this.finalizing = false;
    this.streaming = false;
    this.modelNotice = false;
    this.runs++;
  }
  runEnd() {
    if (!this.active) return;
    this.betweenRuns = true;
    this.streaming = false;
  }
  beforeSettle() {
    if (!this.active) return;
    this.finalizing = true;
    this.betweenRuns = false;
    this.streaming = false;
  }
  observeOutput() {
    if (!this.active) return;
    this.streaming = true;
    this.preparing = false;
    this.betweenRuns = false;
    this.finalizing = false;
    this.manual = void 0;
  }
  toolStart(id, name = "tool", parentId) {
    this.manual = void 0;
    this.streaming = false;
    this.betweenRuns = false;
    this.tools.set(id, { name, parentId, updates: 0 });
  }
  toolUpdate(id, progress) {
    const tool = this.tools.get(id);
    if (!tool) return;
    tool.updates++;
    if (progress !== void 0 && Number.isFinite(progress)) {
      tool.progress = Math.max(0, Math.min(1, progress));
    }
  }
  toolEnd(id, isError) {
    this.tools.delete(id);
    this.error ||= isError;
    this.manual = void 0;
  }
  messageEnd(stopReason) {
    this.streaming = false;
    this.error ||= stopReason === "error";
    this.aborted ||= stopReason === "aborted";
  }
  promptStart(kind = "custom") {
    this.prompts.push(kind);
    this.streaming = false;
    this.manual = void 0;
  }
  promptEnd() {
    this.prompts.pop();
  }
  end(aborted = false) {
    this.aborted ||= aborted;
    this.active = false;
    this.tools.clear();
    this.prompts = [];
    this.preparing = false;
    this.betweenRuns = false;
    this.finalizing = false;
    this.streaming = false;
  }
  modelSelected(name) {
    this.selectedModel = name;
    this.modelNotice = !this.active;
  }
  setManual(mood) {
    this.manual = mood;
    this.modelNotice = false;
  }
  idle() {
    if (this.mood === "happy") this.manual = "idle";
  }
  get currentToolName() {
    return [...this.tools.values()].at(-1)?.name;
  }
  get currentToolProgress() {
    return [...this.tools.values()].at(-1)?.progress;
  }
  get activeToolCount() {
    return this.tools.size;
  }
  get nestedToolCount() {
    return [...this.tools.values()].filter((tool) => tool.parentId !== void 0).length;
  }
  get runCount() {
    return this.runs;
  }
  get modelName() {
    return this.selectedModel;
  }
  get mood() {
    if (this.prompts.length > 0) return "waiting";
    if (this.manual) return this.manual;
    if (this.tools.size > 0) return "tool";
    if (this.aborted) return "cancelled";
    if (this.active) return this.error ? "error" : "thinking";
    if (this.error) return "error";
    return "happy";
  }
  get phase() {
    if (this.prompts.length > 0) return "waiting";
    if (this.modelNotice && !this.active && this.manual === "idle") return "model-selected";
    if (this.manual) return this.manual === "idle" ? "idle" : "manual";
    if (this.tools.size > 0) return "tool";
    if (this.aborted) return "cancelled";
    if (this.error) return "error";
    if (this.active && this.finalizing) return "finalizing";
    if (this.active && this.streaming) return "streaming";
    if (this.active && this.preparing) return "starting";
    if (this.active && (this.betweenRuns || this.runs > 1)) return "continuing";
    if (this.active) return "running";
    if (this.modelNotice) return "model-selected";
    return this.mood === "happy" ? "settled" : "idle";
  }
  get label() {
    if (this.prompts.length > 0) {
      const kind = this.prompts.at(-1);
      if (kind === "confirm") return "waiting for approval";
      if (kind === "select") return "waiting for selection";
      if (kind === "input" || kind === "editor") return "waiting for input";
      return "waiting for you";
    }
    if (this.modelNotice && !this.active && this.manual === "idle") return "model selected";
    if (this.manual) return LABELS[this.manual];
    if (this.tools.size > 0) {
      const count = this.tools.size;
      const nested2 = this.nestedToolCount;
      const base = count > 1 ? `using ${count} tools` : nested2 > 0 ? "using nested tool" : "using tools";
      const progress = this.currentToolProgress;
      return progress === void 0 ? base : `${base} \xB7 ${Math.round(progress * 100)}%`;
    }
    if (this.aborted) return "interrupted";
    if (this.error) return "error observed";
    if (this.active && this.finalizing) return "finalizing";
    if (this.active && this.streaming) return "streaming output";
    if (this.active && this.preparing) return "starting run";
    if (this.active && this.betweenRuns) return "checking next step";
    if (this.active && this.runs > 1) return "continuing run";
    if (this.active) return "thinking";
    if (this.modelNotice) return "model selected";
    return LABELS[this.mood];
  }
};

// src/braille.ts
var BRAILLE_PIXEL_WIDTH = 48;
var BRAILLE_PIXEL_HEIGHT = 32;
var WIDTH = BRAILLE_PIXEL_WIDTH;
var HEIGHT = BRAILLE_PIXEL_HEIGHT;
var TAU = Math.PI * 2;
var Pixels = class {
  values = /* @__PURE__ */ new Set();
  set(x, y) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) this.values.add(y * WIDTH + x);
  }
  has(x, y) {
    return this.values.has(y * WIDTH + x);
  }
  line(x0, y0, x1, y1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      this.set(x0, y0);
      if (x0 === x1 && y0 === y1) return;
      const twice = error * 2;
      if (twice >= dy) {
        error += dy;
        x0 += sx;
      }
      if (twice <= dx) {
        error += dx;
        y0 += sy;
      }
    }
  }
  quadratic(x0, y0, cx, cy, x1, y1) {
    const length = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
    const steps = Math.max(8, Math.ceil(length * 1.5));
    let previousX = x0;
    let previousY = y0;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const inverse = 1 - t;
      const x = inverse * inverse * x0 + 2 * inverse * t * cx + t * t * x1;
      const y = inverse * inverse * y0 + 2 * inverse * t * cy + t * t * y1;
      this.line(previousX, previousY, x, y);
      previousX = x;
      previousY = y;
    }
  }
  arc(cx, cy, rx, ry, start = 0, end = TAU) {
    const steps = Math.max(12, Math.ceil(Math.abs(end - start) * Math.max(rx, ry) * 2));
    let previousX = cx + Math.cos(start) * rx;
    let previousY = cy + Math.sin(start) * ry;
    for (let step = 1; step <= steps; step++) {
      const angle = start + (end - start) * step / steps;
      const x = cx + Math.cos(angle) * rx;
      const y = cy + Math.sin(angle) * ry;
      this.line(previousX, previousY, x, y);
      previousX = x;
      previousY = y;
    }
  }
};
function drawEyes(pixels, mood, frame, shift) {
  const point = (x, y) => pixels.set(x + shift, y);
  const line = (x0, y0, x1, y1) => pixels.line(x0 + shift, y0, x1 + shift, y1);
  const curve = (x0, y0, cx, cy, x1, y1) => pixels.quadratic(x0 + shift, y0, cx + shift, cy, x1 + shift, y1);
  const openEye = (x, glance) => {
    curve(x - 3, 13, x, 10, x + 3, 13);
    curve(x - 3, 13, x, 16, x + 3, 13);
    point(x + glance, 13);
  };
  if (mood === "idle" && frame % 4 === 2 || mood === "sleep" || mood === "cancelled" && frame > 0) {
    curve(14, 13, 17, 15, 20, 13);
    curve(28, 13, 31, 15, 34, 13);
  } else if (mood === "happy") {
    curve(14, 14, 17, 10, 20, 14);
    curve(28, 14, 31, 10, 34, 14);
  } else if (mood === "error") {
    line(14, 11, 20, 15);
    line(20, 11, 14, 15);
    line(28, 11, 34, 15);
    line(34, 11, 28, 15);
  } else {
    const glance = mood === "thinking" ? [-1, 1, 0, -1][frame % 4] : [0, 1, 0, -1][frame % 4];
    openEye(17, glance);
    openEye(31, glance);
    if (mood === "thinking") curve(14, 9, 17, 8, 20, 9);
  }
  if (mood === "happy") {
    point(12, 17 + frame % 2);
    point(36, 17 + frame % 2);
  }
}
function drawCat(mood, tick) {
  const frame = Math.max(0, Math.floor(tick));
  const pixels = new Pixels();
  const shift = mood === "error" && frame < 2 ? frame === 0 ? -1 : 1 : 0;
  const point = (x, y) => pixels.set(x + shift, y);
  const line = (x0, y0, x1, y1) => pixels.line(x0 + shift, y0, x1 + shift, y1);
  const curve = (x0, y0, cx, cy, x1, y1) => pixels.quadratic(x0 + shift, y0, cx + shift, cy, x1 + shift, y1);
  curve(7, 15, 8, 8, 10, 2);
  line(10, 2, 18, 8);
  curve(18, 8, 24, 5, 30, 8);
  line(30, 8, 38, 2);
  curve(38, 2, 40, 8, 41, 15);
  curve(41, 15, 41, 21, 35, 24);
  curve(35, 24, 30, 27, 24, 27);
  curve(24, 27, 18, 27, 13, 24);
  curve(13, 24, 7, 21, 7, 15);
  curve(11, 10, 12, 6, 12, 5);
  line(12, 5, 16, 9);
  curve(37, 10, 36, 6, 36, 5);
  line(36, 5, 32, 9);
  drawEyes(pixels, mood, frame, shift);
  line(22, 17, 24, 19);
  line(24, 19, 26, 17);
  line(22, 17, 26, 17);
  line(24, 19, 24, 20);
  curve(24, 20, 21, 23, 18, 20);
  curve(24, 20, 27, 23, 30, 20);
  point(15, 18);
  point(15, 21);
  point(33, 18);
  point(33, 21);
  curve(14, 18, 8, 16, 2, 17);
  curve(14, 22, 8, 24, 3, 23);
  curve(34, 18, 40, 16, 46, 17);
  curve(34, 22, 40, 24, 45, 23);
  curve(17, 25, 12, 28, 11, 31);
  curve(31, 25, 36, 28, 37, 31);
  curve(20, 27, 18, 29, 19, 31);
  curve(28, 27, 30, 29, 29, 31);
  if (mood === "idle") {
    if (frame % 4 === 1) curve(37, 29, 42, 27, 44, 30);
    else curve(11, 29, 6, 27, 4, 30);
    if (frame % 4 === 2) line(38, 2, 39, 0);
  } else if (mood === "thinking") {
    const count = Math.min(frame % 4 + 1, 3);
    for (let i = 0; i < count; i++) pixels.arc(41 + i * 2, 10 - i * 3, 1, 1);
  } else if (mood === "tool") {
    curve(12, 27, 24, 25, 36, 27);
    line(12, 27, 13, 31);
    line(36, 27, 35, 31);
    line(13, 31, 35, 31);
    for (let x = 16; x <= 32; x += 4) point(x, 29);
    if (frame % 2 === 0) {
      curve(16, 25, 18, 28, 20, 29);
      curve(32, 25, 30, 28, 28, 29);
    } else {
      curve(17, 26, 20, 28, 22, 29);
      curve(31, 26, 28, 28, 26, 29);
    }
  } else if (mood === "happy") {
    line(10, 25, 7, 23);
    line(38, 25, 41, 23);
    point(9, 28 + frame % 2);
    point(39, 28 + frame % 2);
  } else if (mood === "error") {
    line(22, 24, 24, 25);
    line(24, 25, 26, 24);
  } else if (mood === "sleep") {
    const rise = frame % 2;
    line(39, 17 - rise, 46, 17 - rise);
    line(46, 17 - rise, 40, 12 - rise);
    line(40, 12 - rise, 46, 12 - rise);
    line(36, 9 - rise, 40, 9 - rise);
    line(40, 9 - rise, 37, 6 - rise);
    line(37, 6 - rise, 40, 6 - rise);
  } else if (mood === "waiting") {
    const handX = [42, 44, 40][frame % 3];
    curve(32, 27, 36, 24, 37, 20);
    curve(37, 20, handX, 16, handX, 11);
    line(handX, 11, handX - 2, 8);
  } else if (mood === "cancelled" && frame === 0) {
    line(12, 28, 6, 25);
    line(36, 28, 42, 25);
  }
  return pixels;
}
var DOTS = [
  [1, 8],
  [2, 16],
  [4, 32],
  [64, 128]
];
function toBraille(pixels) {
  const lines = [];
  for (let y = 0; y < HEIGHT; y += 4) {
    let line = "";
    for (let x = 0; x < WIDTH; x += 2) {
      let value = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (pixels.has(x + dx, y + dy)) value |= DOTS[dy][dx];
        }
      }
      line += value === 0 ? " " : String.fromCodePoint(10240 + value);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
function brailleArtLines(mood, tick = 0) {
  return toBraille(drawCat(mood, Math.max(0, Math.floor(tick))));
}

// src/collective-kernel.ts
function nearestFieldPoint(origin, points) {
  let nearest = points[0] ?? origin;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest;
}
function contourField(origin, points, probe, distribution, strength) {
  const nearest = nearestFieldPoint(origin, points);
  const blend = Math.max(0, Math.min(1, distribution));
  const targetX = nearest.x * (1 - blend) + probe.x * blend;
  const targetY = nearest.y * (1 - blend) + probe.y * blend;
  return { x: (targetX - origin.x) * strength, y: (targetY - origin.y) * strength };
}
function curlField(origin, time, phase, strength) {
  const fieldTime = time * 0.11 + phase;
  const coupled = origin.x * 0.17 + origin.y * 0.19 - fieldTime * 0.7;
  const dPsiDx = 0.23 * Math.cos(origin.x * 0.23 + fieldTime) + 0.17 * Math.cos(coupled) * 0.17;
  const dPsiDy = -0.27 * Math.sin(origin.y * 0.27 - fieldTime * 0.83) + 0.17 * Math.cos(coupled) * 0.19;
  return { x: dPsiDy * strength, y: -dPsiDx * strength };
}
function vortexField(origin, center, phase, strength) {
  const dx = origin.x - center.x;
  const dy = origin.y - center.y;
  const distance = Math.hypot(dx, dy) || 1;
  const wave = Math.sin(distance * 1.35 - phase);
  return {
    x: strength * (-dy / distance * 0.11 + dx / distance * wave * 0.055),
    y: strength * (dx / distance * 0.11 + dy / distance * wave * 0.055)
  };
}

// src/tool-motifs.ts
function motifForTool(toolName = "") {
  const name = toolName.toLowerCase();
  if (/(^|[_.-])(bash|shell|exec|terminal|command)([_.-]|$)/.test(name) || name === "bash") return "hammer";
  if (/(read|search|grep|find|list|whyline|inspect|fetch)/.test(name)) return "lens";
  if (/(edit|write|patch|replace|format)/.test(name)) return "pencil";
  if (/(parallel|multi|codemode|dispatch|batch)/.test(name)) return "network";
  if (/(jev|judge|judgment|classify|score|evaluate)/.test(name)) return "gear";
  return "gear";
}

// src/tool-algebra.ts
var TOOL_IDENTITY = Object.freeze({ kind: "identity" });
function structuralKey(expression) {
  if (expression.kind === "identity") return "0";
  if (expression.kind === "atom") return `a:${expression.id}`;
  if (expression.kind === "failed") return `f:${structuralKey(expression.expression)}`;
  if (expression.kind === "nested") {
    return `n:${structuralKey(expression.parent)}>${structuralKey(expression.children)}`;
  }
  const operator = expression.kind === "sequence" ? "s" : "p";
  return `${operator}:${expression.items.map(structuralKey).join(",")}`;
}
function sequence(...expressions) {
  const items = expressions.flatMap((expression) => expression.kind === "identity" ? [] : expression.kind === "sequence" ? expression.items : [expression]);
  if (items.length === 0) return TOOL_IDENTITY;
  if (items.length === 1) return items[0];
  return { kind: "sequence", items };
}
function parallel(...expressions) {
  const items = expressions.flatMap((expression) => expression.kind === "identity" ? [] : expression.kind === "parallel" ? expression.items : [expression]);
  if (items.length === 0) return TOOL_IDENTITY;
  if (items.length === 1) return items[0];
  return { kind: "parallel", items: [...items].sort((left, right) => structuralKey(left).localeCompare(structuralKey(right))) };
}
function nested(parent, children) {
  if (parent.kind === "identity") return children;
  if (children.kind === "identity") return parent;
  return { kind: "nested", parent, children };
}
function failed(expression) {
  if (expression.kind === "identity" || expression.kind === "failed") return expression;
  return { kind: "failed", expression };
}
function toolExpressionKey(expression) {
  if (expression.kind === "identity") return "identity";
  if (expression.kind === "atom") {
    const progress = expression.progress === void 0 ? "" : `@${Math.round(expression.progress * 100)}`;
    return `${expression.name}#${expression.id}:${expression.motif}:${expression.status}${progress}`;
  }
  if (expression.kind === "sequence") return `seq(${expression.items.map(toolExpressionKey).join(",")})`;
  if (expression.kind === "parallel") return `par(${expression.items.map(toolExpressionKey).join(",")})`;
  if (expression.kind === "nested") {
    return `nest(${toolExpressionKey(expression.parent)},${toolExpressionKey(expression.children)})`;
  }
  return `fail(${toolExpressionKey(expression.expression)})`;
}
function formatToolExpression(expression) {
  if (expression.kind === "identity") return "idle";
  if (expression.kind === "atom") {
    const progress = expression.progress === void 0 ? "" : ` ${Math.round(expression.progress * 100)}%`;
    return `${expression.name}[${expression.motif}:${expression.status}${progress}]`;
  }
  if (expression.kind === "sequence") return expression.items.map(formatToolExpression).join(" ; ");
  if (expression.kind === "parallel") return `(${expression.items.map(formatToolExpression).join(" \u2225 ")})`;
  if (expression.kind === "nested") {
    return `${formatToolExpression(expression.parent)} \u25B7 ${formatToolExpression(expression.children)}`;
  }
  return `failed(${formatToolExpression(expression.expression)})`;
}
function formatToolMotifExpression(expression) {
  if (expression.kind === "identity") return "idle";
  if (expression.kind === "atom") return expression.motif;
  if (expression.kind === "sequence") return expression.items.map(formatToolMotifExpression).join(" \u2192 ");
  if (expression.kind === "parallel") return `(${expression.items.map(formatToolMotifExpression).join(" \u2225 ")})`;
  if (expression.kind === "nested") {
    return `${formatToolMotifExpression(expression.parent)} \u25B7 ${formatToolMotifExpression(expression.children)}`;
  }
  return `!${formatToolMotifExpression(expression.expression)}`;
}
function layerWeight(status) {
  if (status === "active" || status === "error") return 1;
  if (status === "completed") return 0.46;
  return 0.6;
}
function layoutExpression(expression, bounds, depth, relation, inheritedFailure) {
  const center = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
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
        weight: layerWeight(expression.status)
      }],
      links: [],
      center
    };
  }
  if (expression.kind === "nested") {
    const parent = layoutExpression(expression.parent, bounds, depth, "nested-parent", inheritedFailure);
    const childBounds = {
      x: bounds.x + bounds.width * 0.46,
      y: bounds.y + bounds.height * 0.18,
      width: bounds.width * 0.48,
      height: bounds.height * 0.48
    };
    const children = layoutExpression(expression.children, childBounds, depth + 1, "nested-child", inheritedFailure);
    return {
      operator: "nested",
      layers: [...parent.layers, ...children.layers],
      links: [...parent.links, ...children.links, { kind: "nested", from: parent.center, to: children.center }],
      center: parent.center
    };
  }
  const items = expression.items;
  const results = [];
  if (expression.kind === "sequence") {
    const gap = Math.min(0.045, bounds.width / Math.max(8, items.length * 4));
    const width = Math.max(0.08, (bounds.width - gap * (items.length - 1)) / items.length);
    items.forEach((item, index) => {
      results.push(layoutExpression(item, {
        x: bounds.x + index * (width + gap),
        y: bounds.y,
        width,
        height: bounds.height
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
        height: cellHeight * 0.94
      }, depth, "parallel", inheritedFailure));
    });
  }
  const links = results.flatMap((result) => result.links);
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
    center
  };
}
function layoutToolExpression(expression) {
  const result = layoutExpression(expression, { x: 0.06, y: 0.06, width: 0.88, height: 0.88 }, 0, "atom", false);
  return { operator: expression.kind, layers: result.layers, links: result.links };
}
function intervalEnd(record2) {
  return record2.endedAt ?? Number.POSITIVE_INFINITY;
}
function composeIntervals(records, build) {
  const ordered = [...records].sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id));
  const components = [];
  let group = [];
  let groupEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    if (group.length === 0) return;
    components.push(group.length === 1 ? build(group[0]) : parallel(...group.map(build)));
    group = [];
    groupEnd = Number.NEGATIVE_INFINITY;
  };
  for (const record2 of ordered) {
    if (group.length > 0 && record2.startedAt > groupEnd) flush();
    group.push(record2);
    groupEnd = Math.max(groupEnd, intervalEnd(record2));
  }
  flush();
  return sequence(...components);
}
var ToolAlgebraTrace = class {
  records = /* @__PURE__ */ new Map();
  clock = 0;
  reset() {
    this.records.clear();
    this.clock = 0;
  }
  start(id, name, parentId) {
    if (this.records.has(id)) throw new Error(`Duplicate tool call id: ${id}`);
    this.records.set(id, {
      id,
      name,
      motif: motifForTool(name),
      parentId,
      status: "active",
      startedAt: ++this.clock
    });
  }
  update(id, progress) {
    const record2 = this.records.get(id);
    if (!record2 || record2.status !== "active" || progress === void 0 || !Number.isFinite(progress)) return;
    record2.progress = Math.max(0, Math.min(1, progress));
  }
  end(id, isError) {
    const record2 = this.records.get(id);
    if (!record2 || record2.status !== "active") return;
    record2.status = isError ? "error" : "completed";
    record2.progress = record2.progress === void 0 ? void 0 : isError ? record2.progress : 1;
    record2.endedAt = ++this.clock;
  }
  settle(aborted = false) {
    for (const record2 of this.records.values()) {
      if (record2.status !== "active") continue;
      record2.status = aborted ? "cancelled" : "incomplete";
      record2.endedAt = ++this.clock;
    }
  }
  get activeRecords() {
    return [...this.records.values()].filter((record2) => record2.status === "active").sort((left, right) => left.startedAt - right.startedAt);
  }
  get activeMotifs() {
    return this.activeRecords.map((record2) => record2.motif);
  }
  expression() {
    const records = [...this.records.values()];
    if (records.length === 0) return TOOL_IDENTITY;
    const byParent = /* @__PURE__ */ new Map();
    for (const record2 of records) {
      if (!record2.parentId || !this.records.has(record2.parentId)) continue;
      const siblings = byParent.get(record2.parentId);
      if (siblings) siblings.push(record2);
      else byParent.set(record2.parentId, [record2]);
    }
    const build = (record2) => {
      const atom = {
        kind: "atom",
        id: record2.id,
        name: record2.name,
        motif: record2.motif,
        status: record2.status,
        progress: record2.progress
      };
      const children = byParent.get(record2.id) ?? [];
      const expression = children.length === 0 ? atom : nested(atom, composeIntervals(children, build));
      return record2.status === "error" ? failed(expression) : expression;
    };
    const roots = records.filter((record2) => !record2.parentId || !this.records.has(record2.parentId));
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
      visualPlan: layoutToolExpression(expression)
    };
  }
};

// src/swarm.ts
function scaleLegacyPoints(points) {
  const scaleX = (BRAILLE_PIXEL_WIDTH - 1) / (LEGACY_PIXEL_WIDTH - 1);
  const scaleY = (BRAILLE_PIXEL_HEIGHT - 1) / (LEGACY_PIXEL_HEIGHT - 1);
  return points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
}
var PARTICLE_COUNT = 220;
var CORE_PARTICLE_COUNT = 44;
var LEGACY_PIXEL_WIDTH = 32;
var LEGACY_PIXEL_HEIGHT = 24;
var DOTS2 = [
  [1, 8],
  [2, 16],
  [4, 32],
  [64, 128]
];
var Shape = class {
  pixels = /* @__PURE__ */ new Map();
  set(x, y) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= BRAILLE_PIXEL_WIDTH || y < 0 || y >= BRAILLE_PIXEL_HEIGHT) return;
    this.pixels.set(y * BRAILLE_PIXEL_WIDTH + x, { x, y });
  }
  line(x0, y0, x1, y1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      this.set(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const twice = error * 2;
      if (twice >= dy) {
        error += dy;
        x0 += sx;
      }
      if (twice <= dx) {
        error += dx;
        y0 += sy;
      }
    }
  }
  dottedLine(x0, y0, x1, y1, spacing = 2) {
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(distance));
    for (let step = 0; step <= steps; step++) {
      if (step % spacing !== 0) continue;
      const t = step / steps;
      this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }
  circle(cx, cy, radius, phase = 0) {
    this.ellipse(cx, cy, radius, radius, phase);
  }
  ellipse(cx, cy, radiusX, radiusY, phase = 0) {
    const steps = Math.max(20, Math.ceil(Math.max(radiusX, radiusY) * Math.PI * 3));
    for (let step = 0; step < steps; step++) {
      const angle = phase + step / steps * Math.PI * 2;
      this.set(cx + Math.cos(angle) * radiusX, cy + Math.sin(angle) * radiusY);
    }
  }
  arc(cx, cy, radiusX, radiusY, start, end) {
    const steps = Math.max(8, Math.ceil(Math.abs(end - start) * Math.max(radiusX, radiusY) * 1.8));
    for (let step = 0; step <= steps; step++) {
      const angle = start + (end - start) * step / steps;
      this.set(cx + Math.cos(angle) * radiusX, cy + Math.sin(angle) * radiusY);
    }
  }
  get points() {
    return [...this.pixels.values()];
  }
};
function rotate(x, y, angle, cx = 16, cy = 12) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: cx + x * cosine - y * sine, y: cy + x * sine + y * cosine };
}
function hammerPoints(tick) {
  const shape = new Shape();
  const angle = -0.12 + Math.sin(tick * 0.34) * 0.2;
  const add = (x, y) => {
    const point = rotate(x, y, angle, 16, 12);
    shape.set(point.x, point.y);
  };
  for (let y = -3; y <= 10; y++) for (let x = -1; x <= 1; x++) add(x, y);
  for (let y = -8; y <= -4; y++) for (let x = -9; x <= 8; x++) add(x, y);
  for (let y = -7; y <= -5; y++) for (let x = -11; x <= -10; x++) add(x, y);
  if (Math.sin(tick * 0.34) > 0.72) {
    const impact = rotate(-11, -6, angle, 16, 12);
    for (const [dx, dy] of [[-4, -2], [-4, 2], [-2, -4], [-1, 4], [2, -3]]) {
      shape.line(impact.x, impact.y, impact.x + dx, impact.y + dy);
    }
  }
  return shape.points;
}
function lensPoints(tick) {
  const shape = new Shape();
  const drift = Math.sin(tick * 0.22) * 1.5;
  shape.circle(13 + drift, 10, 6, tick * 0.04);
  shape.line(17 + drift, 14, 25 + drift, 22);
  shape.line(18 + drift, 13, 26 + drift, 21);
  const scanX = 10 + drift + tick % 9;
  shape.line(scanX, 6, scanX, 14);
  return shape.points;
}
function pencilPoints(tick) {
  const shape = new Shape();
  const bob = Math.sin(tick * 0.3) * 1.2;
  for (let offset = -1; offset <= 1; offset++) {
    shape.line(7 + offset, 19 + bob, 23 + offset, 3 + bob);
  }
  shape.line(5, 22 + bob, 7, 18 + bob);
  shape.line(5, 22 + bob, 9, 20 + bob);
  shape.line(21, 2 + bob, 25, 4 + bob);
  shape.line(23, 3 + bob, 25, 6 + bob);
  const trail = tick % 6;
  shape.line(8, 22, 13 + trail, 22);
  shape.line(13 + trail, 22, 16 + trail, 20);
  return shape.points;
}
function networkPoints(tick) {
  const shape = new Shape();
  const pulse = 1 + (tick % 8 < 4 ? 0 : 1);
  const nodes = [
    { x: 7, y: 7 },
    { x: 16, y: 4 },
    { x: 25, y: 8 },
    { x: 10, y: 18 },
    { x: 22, y: 19 }
  ];
  for (const [from, to] of [[0, 1], [1, 2], [0, 3], [1, 3], [1, 4], [2, 4], [3, 4]]) {
    shape.line(nodes[from].x, nodes[from].y, nodes[to].x, nodes[to].y);
  }
  nodes.forEach((node, index) => shape.circle(node.x, node.y, index === tick % nodes.length ? pulse + 1 : pulse));
  return shape.points;
}
function gearPoints(tick) {
  const shape = new Shape();
  const phase = tick * 0.12;
  shape.circle(16, 12, 7, phase);
  shape.circle(16, 12, 3, -phase);
  for (let tooth = 0; tooth < 8; tooth++) {
    const angle = phase + tooth / 8 * Math.PI * 2;
    const inner = { x: 16 + Math.cos(angle) * 6, y: 12 + Math.sin(angle) * 6 };
    const outer = { x: 16 + Math.cos(angle) * 10, y: 12 + Math.sin(angle) * 9 };
    shape.line(inner.x, inner.y, outer.x, outer.y);
  }
  return shape.points;
}
function emergentFacePoints(mood, tick, outputEnergy) {
  const shape = new Shape();
  const core = new Shape();
  const breathe = Math.sin(tick * 0.09) * 0.18;
  shape.ellipse(16, 12, 10.2 + breathe, 10.4 - breathe, tick * 2e-3);
  shape.arc(16, 12.4, 8.8, 8.9, 0.12 * Math.PI, 0.88 * Math.PI);
  const scan = mood === "thinking" ? Math.sin(tick * 0.24) * 1.15 : 0;
  const pupilY = mood === "waiting" ? 0.35 : mood === "error" ? -0.45 : 0;
  const sleepy = mood === "sleep" || mood === "cancelled";
  if (mood === "error") {
    core.line(8, 8, 13, 10);
    core.line(19, 10, 24, 8);
    core.line(9, 11, 13, 10);
    core.line(19, 10, 23, 11);
  } else if (sleepy) {
    core.arc(11, 10.5, 3, 1.2, 0.12 * Math.PI, 0.88 * Math.PI);
    core.arc(21, 10.5, 3, 1.2, 0.12 * Math.PI, 0.88 * Math.PI);
  } else {
    const eyeHeight = mood === "waiting" ? 2.2 : 1.55;
    core.ellipse(11, 10.3, 3.25, eyeHeight);
    core.ellipse(21, 10.3, 3.25, eyeHeight);
    core.circle(11 + scan, 10.3 + pupilY, mood === "waiting" ? 1.15 : 0.85);
    core.circle(21 + scan, 10.3 + pupilY, mood === "waiting" ? 1.15 : 0.85);
  }
  const browLift = mood === "waiting" ? -1.1 : mood === "error" ? 0.4 : 0;
  core.line(8, 6.8 + browLift, 13.2, 6.2 - browLift * 0.2);
  core.line(18.8, 6.2 - browLift * 0.2, 24, 6.8 + browLift);
  core.line(16, 10.5, 15.3, 14.2);
  core.line(15.3, 14.2, 17.3, 14.4);
  const voice = Math.max(0, Math.min(1, outputEnergy));
  if (voice > 0.04) {
    const open = 0.7 + voice * (1.4 + Math.abs(Math.sin(tick * 0.72)) * 1.4);
    shape.ellipse(16, 18, 3.3 - voice * 0.35, open);
    if (open > 1.6) shape.arc(16, 18.2, 2.1, open * 0.45, 0.12 * Math.PI, 0.88 * Math.PI);
  } else if (mood === "happy") {
    shape.arc(16, 16.2, 4.7, 3.3, 0.12 * Math.PI, 0.88 * Math.PI);
  } else if (mood === "error") {
    shape.line(11, 18, 14, 16.8);
    shape.line(14, 16.8, 17, 18.4);
    shape.line(17, 18.4, 21, 17);
  } else if (mood === "waiting") {
    shape.ellipse(16, 18, 2.2, 2.7);
  } else if (mood === "cancelled") {
    shape.arc(16, 20, 4.2, 2.6, 1.15 * Math.PI, 1.85 * Math.PI);
  } else if (mood === "sleep") {
    shape.line(13, 18, 19, 18);
  } else {
    const mouthShift = mood === "thinking" ? Math.sin(tick * 0.18) * 0.55 : 0;
    shape.arc(16 + mouthShift, 16.9, 3.7, 1.35, 0.12 * Math.PI, 0.88 * Math.PI);
  }
  for (const point of core.points) shape.set(point.x, point.y);
  return { points: shape.points, core: core.points };
}
function ambientPresencePoints(mood, tick) {
  const points = [];
  const energy = mood === "thinking" ? 1.2 : mood === "error" ? 1.45 : mood === "cancelled" ? 1.3 : mood === "sleep" ? 0.72 : 0.92;
  for (let index = 0; index < 180; index++) {
    const unit = (index + 0.5) / 180;
    const radius = (1.7 + Math.sqrt(unit) * 8.8) * energy;
    const direction = index % 3 === 0 ? -1 : 1;
    const angle = index * 2.399963 + tick * 0.014 * direction;
    const ripple = Math.sin(index * 1.73 + tick * 0.11) * (mood === "thinking" ? 0.8 : 0.4);
    points.push({
      x: 16 + Math.cos(angle) * (radius + ripple) * 1.06 + Math.sin(index * 0.37) * 0.65,
      y: 12 + Math.sin(angle) * (radius - ripple) * 0.76 + Math.cos(index * 0.29) * 0.45
    });
  }
  return points;
}
function identityConstellationPoints(tick) {
  const shape = new Shape();
  const phase = tick * 0.035;
  const nodes = [
    { x: 11 + Math.cos(phase) * 1.4, y: 8 + Math.sin(phase) * 1.1 },
    { x: 21 + Math.cos(phase + 2.1) * 1.6, y: 11 + Math.sin(phase + 2.1) * 1.2 },
    { x: 14 + Math.cos(phase + 4.2) * 1.2, y: 18 + Math.sin(phase + 4.2) * 1.1 },
    { x: 23 + Math.cos(phase + 5.4), y: 17 + Math.sin(phase + 5.4) }
  ];
  nodes.forEach((node, index) => shape.circle(node.x, node.y, index === tick % nodes.length ? 1.4 : 0.8));
  return shape.points;
}
function emergentHomePoints(mood, tick, outputEnergy) {
  if (outputEnergy > 0.04 || mood === "waiting") {
    return emergentFacePoints(mood, tick, outputEnergy).points;
  }
  const cloud = ambientPresencePoints(mood, tick);
  const reveal = mood === "happy" ? Math.max(0, 0.58 - tick * 0.026) : mood === "error" ? 0.24 : mood === "cancelled" ? 0.12 : mood === "sleep" ? 0.08 : 0;
  if (reveal <= 0) return cloud;
  const face = emergentFacePoints(mood, tick, 0).points.filter((_, index) => (index * 47 + 13) % 101 / 100 < reveal);
  return [...cloud.slice(0, Math.max(100, 170 - face.length)), ...face];
}
function motifPoints(motif, tick) {
  const points = motif === "hammer" ? hammerPoints(tick) : motif === "lens" ? lensPoints(tick) : motif === "pencil" ? pencilPoints(tick) : motif === "network" ? networkPoints(tick) : gearPoints(tick);
  return scaleLegacyPoints(points);
}
function toolVisualPlanPoints(plan, tick) {
  const shape = new Shape();
  const width = BRAILLE_PIXEL_WIDTH - 1;
  const height = BRAILLE_PIXEL_HEIGHT - 1;
  const centerX = width / 2;
  const centerY = height / 2;
  for (const link of plan.links) {
    const fromX = link.from[0] * width;
    const fromY = link.from[1] * height;
    const toX = link.to[0] * width;
    const toY = link.to[1] * height;
    if (link.kind === "sequence") shape.line(fromX, fromY, toX, toY);
    else shape.dottedLine(fromX, fromY, toX, toY, link.kind === "nested" ? 3 : 2);
    if (link.kind === "sequence") {
      const angle = Math.atan2(toY - fromY, toX - fromX);
      shape.line(toX, toY, toX - Math.cos(angle - 0.7) * 2.5, toY - Math.sin(angle - 0.7) * 2.5);
      shape.line(toX, toY, toX - Math.cos(angle + 0.7) * 2.5, toY - Math.sin(angle + 0.7) * 2.5);
    }
  }
  plan.layers.forEach((layer, layerIndex) => {
    const layerX = layer.x * width;
    const layerY = layer.y * height;
    shape.circle(layerX, layerY, layer.failed ? 1.6 : 0.8, tick * 0.04);
    const points = motifPoints(layer.motif, tick + layerIndex * 3);
    const progressVisibility = layer.status === "active" && layer.progress !== void 0 ? Math.max(0.18, layer.progress) : 1;
    points.forEach((point, pointIndex) => {
      const sample = (pointIndex * 47 + layerIndex * 29 + layer.id.length * 13) % 101 / 100;
      if (sample > layer.weight || sample > progressVisibility) return;
      const failureJitter = layer.failed ? Math.sin(pointIndex * 1.7 + tick * 0.45) * 1.1 : 0;
      shape.set(
        layerX + (point.x - centerX) * layer.scale + failureJitter,
        layerY + (point.y - centerY) * layer.scale - Math.abs(failureJitter) * 0.35
      );
    });
  });
  return shape.points;
}
function decodeBraille(lines) {
  const points = [];
  for (let cellY = 0; cellY < lines.length; cellY++) {
    const chars = [...lines[cellY]];
    for (let cellX = 0; cellX < chars.length; cellX++) {
      const value = chars[cellX].codePointAt(0) - 10240;
      if (value <= 0 || value > 255) continue;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (value & DOTS2[dy][dx]) points.push({ x: cellX * 2 + dx, y: cellY * 4 + dy });
        }
      }
    }
  }
  return points;
}
function encodeBraille(particles) {
  const occupied = /* @__PURE__ */ new Set();
  for (const particle of particles) {
    const x = Math.max(0, Math.min(BRAILLE_PIXEL_WIDTH - 1, Math.round(particle.x)));
    const y = Math.max(0, Math.min(BRAILLE_PIXEL_HEIGHT - 1, Math.round(particle.y)));
    occupied.add(y * BRAILLE_PIXEL_WIDTH + x);
  }
  const lines = [];
  for (let y = 0; y < BRAILLE_PIXEL_HEIGHT; y += 4) {
    let line = "";
    for (let x = 0; x < BRAILLE_PIXEL_WIDTH; x += 2) {
      let value = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (occupied.has((y + dy) * BRAILLE_PIXEL_WIDTH + x + dx)) value |= DOTS2[dy][dx];
        }
      }
      line += value === 0 ? " " : String.fromCodePoint(10240 + value);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
var NEIGHBOR_CELL_SIZE = 3.2;
var NEIGHBOR_RADIUS = 4.4;
var SEPARATION_RADIUS = 1.45;
function cellKey(x, y) {
  return `${Math.floor(x / NEIGHBOR_CELL_SIZE)},${Math.floor(y / NEIGHBOR_CELL_SIZE)}`;
}
function buildSpatialHash(particles) {
  const hash = /* @__PURE__ */ new Map();
  particles.forEach((particle, index) => {
    const key = cellKey(particle.x, particle.y);
    const cell = hash.get(key);
    if (cell) cell.push(index);
    else hash.set(key, [index]);
  });
  return hash;
}
var BrailleSwarm = class {
  particles = [];
  mood;
  moodAge = 0;
  motif = "gear";
  toolPlan = layoutToolExpression({ kind: "identity" });
  toolSummary = "idle";
  motifEcho = 0;
  outputEnergy = 0;
  voiceLevels = [0, 0, 0, 0, 0];
  homeForm;
  randomState;
  flowPhase;
  constructor(seed2 = Date.now() ^ Math.floor(Math.random() * 4294967295), mood = "idle", homeForm = "cat") {
    this.randomState = seed2 >>> 0 || 2654435769;
    this.flowPhase = this.randomState / 4294967296 * Math.PI * 2;
    this.mood = mood;
    this.homeForm = homeForm;
    this.reset(mood);
  }
  random() {
    let value = this.randomState;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value >>> 0;
    return this.randomState / 4294967296;
  }
  homeTargets(mood, tick) {
    if (this.homeForm === "emergent-face") {
      return scaleLegacyPoints(emergentHomePoints(mood, tick, this.outputEnergy));
    }
    return decodeBraille(brailleArtLines(mood, Math.floor(tick / 4)));
  }
  coreTargets(mood, tick) {
    if (this.homeForm !== "emergent-face") return [];
    if (this.outputEnergy > 0.04 || mood === "waiting") {
      return scaleLegacyPoints(emergentFacePoints(mood, tick, this.outputEnergy).core);
    }
    return scaleLegacyPoints(identityConstellationPoints(tick));
  }
  targets(mood, tick, forceMotif = false) {
    if (mood === "tool" || forceMotif) {
      return this.toolPlan.layers.length > 0 ? toolVisualPlanPoints(this.toolPlan, tick) : motifPoints(this.motif, tick);
    }
    return this.homeTargets(mood, tick);
  }
  reset(mood, tick = 0) {
    this.mood = mood;
    this.moodAge = 0;
    this.motifEcho = 0;
    this.outputEnergy = 0;
    this.voiceLevels.fill(0);
    const targets = this.targets(mood, tick);
    this.particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      const target = targets[Math.floor(index * targets.length / PARTICLE_COUNT)] ?? {
        x: BRAILLE_PIXEL_WIDTH / 2,
        y: BRAILLE_PIXEL_HEIGHT / 2
      };
      return {
        x: target.x + (this.random() - 0.5) * 1.5,
        y: target.y + (this.random() - 0.5) * 1.5,
        vx: (this.random() - 0.5) * 0.25,
        vy: (this.random() - 0.5) * 0.25,
        phase: this.random() * Math.PI * 2,
        role: this.random(),
        lag: Math.floor(this.random() * 4),
        core: index < CORE_PARTICLE_COUNT,
        member: index % 5
      };
    });
  }
  setHomeForm(homeForm) {
    if (homeForm === this.homeForm) return;
    this.homeForm = homeForm;
    this.moodAge = 0;
    for (const particle of this.particles) {
      particle.vx += (this.random() - 0.5) * 0.8;
      particle.vy += (this.random() - 0.5) * 0.8;
    }
  }
  pulseOutput(intensity = 1, members) {
    const bounded = Math.max(0, Math.min(1, intensity));
    this.outputEnergy = Math.max(this.outputEnergy, bounded);
    for (let member = 0; member < this.voiceLevels.length; member++) {
      const level = members?.[member] ?? bounded;
      this.voiceLevels[member] = Math.max(this.voiceLevels[member], Math.max(0, Math.min(1, level)));
    }
    for (const particle of this.particles) {
      if (!particle.core) continue;
      particle.vx += (this.random() - 0.5) * 0.16;
      particle.vy += (this.random() - 0.5) * 0.12;
    }
  }
  setToolExpression(expression) {
    this.toolPlan = layoutToolExpression(expression);
    this.toolSummary = formatToolMotifExpression(expression);
    const active = this.toolPlan.layers.filter((layer) => layer.status === "active");
    this.motif = active.length > 1 ? "network" : active[0]?.motif ?? this.toolPlan.layers.at(-1)?.motif ?? "gear";
    this.moodAge = 0;
    if (active.length > 0) this.motifEcho = 0;
    for (const particle of this.particles) {
      particle.vx += (this.random() - 0.5) * 0.5;
      particle.vy += (this.random() - 0.5) * 0.5;
    }
  }
  clearToolExpression() {
    this.toolPlan = layoutToolExpression({ kind: "identity" });
    this.toolSummary = "idle";
    this.motif = "gear";
    this.motifEcho = 0;
  }
  startTool(toolName = "") {
    this.setToolExpression({
      kind: "atom",
      id: `tool:${toolName || "tool"}`,
      name: toolName || "tool",
      motif: motifForTool(toolName),
      status: "active"
    });
  }
  finishTool(isError) {
    this.motifEcho = isError ? 0 : 10;
    for (const particle of this.particles) {
      const dx = particle.x - BRAILLE_PIXEL_WIDTH / 2;
      const dy = particle.y - BRAILLE_PIXEL_HEIGHT / 2;
      const distance = Math.hypot(dx, dy) || 1;
      const force = isError ? 2.2 : 0.2;
      particle.vx += dx / distance * force + (this.random() - 0.5) * (isError ? 1.5 : 0.25);
      particle.vy += dy / distance * force + (this.random() - 0.5) * (isError ? 1.5 : 0.25);
    }
  }
  setMood(mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    this.moodAge = 0;
    for (const particle of this.particles) {
      if (mood === "error") {
        particle.vx += (this.random() - 0.5) * 4;
        particle.vy += (this.random() - 0.5) * 3;
      } else if (mood === "cancelled") {
        particle.vx += (this.random() - 0.5) * 2;
        particle.vy += this.random() * 1.5;
      } else if (mood === "happy") {
        const dx = particle.x - BRAILLE_PIXEL_WIDTH / 2;
        const dy = particle.y - BRAILLE_PIXEL_HEIGHT / 2;
        const distance = Math.hypot(dx, dy) || 1;
        particle.vx += dx / distance;
        particle.vy += dy / distance;
      }
    }
  }
  step(mood, tick, stepScale = 1) {
    this.setMood(mood);
    const scale = Math.max(0.01, Math.min(1, stepScale));
    this.moodAge += scale;
    const visualTool = mood === "tool" || this.motifEcho > 0;
    const targets = this.targets(mood, tick, visualTool);
    const faceCoreTargets = visualTool ? this.coreTargets(mood, tick) : [];
    if (targets.length === 0) return;
    const center = targets.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
    center.x /= targets.length;
    center.y /= targets.length;
    const spatialHash = buildSpatialHash(this.particles);
    const accelerations = [];
    const noiseScale = Math.sqrt(scale);
    for (let index = 0; index < this.particles.length; index++) {
      const particle = this.particles[index];
      particle.phase += (0.045 + this.random() * 0.02) * scale;
      const persistentCore = visualTool && particle.core && faceCoreTargets.length > 0;
      const semanticPoints = persistentCore ? faceCoreTargets : targets;
      const probeIndex = Math.floor((particle.role + particle.member * 0.173) % 1 * semanticPoints.length);
      const probe = semanticPoints[probeIndex] ?? semanticPoints[0];
      const distribution = persistentCore ? 0.18 : visualTool ? 0.48 : this.outputEnergy > 0.04 || mood === "waiting" ? 0.28 : 0.08;
      const toolScout = visualTool && !particle.core && particle.role > 0.94;
      const toolStraggler = visualTool && !particle.core && particle.role > 0.86;
      const waitingToJoin = visualTool && !particle.core && this.moodAge <= particle.lag;
      let semanticStrength = persistentCore ? 0.22 : visualTool ? 0.255 : this.outputEnergy > 0.04 || mood === "waiting" ? 0.125 : mood === "error" ? 0.045 : mood === "sleep" ? 0.028 : 0.038;
      let semanticForce = contourField(particle, semanticPoints, probe, distribution, semanticStrength);
      if (toolScout) {
        const radius = 8 + particle.role * 4;
        const scoutTarget = {
          x: center.x + Math.cos(particle.phase + tick * 0.08) * radius,
          y: center.y + Math.sin(particle.phase + tick * 0.08) * radius * 0.65
        };
        semanticForce = {
          x: (scoutTarget.x - particle.x) * semanticStrength * 0.58,
          y: (scoutTarget.y - particle.y) * semanticStrength * 0.58
        };
      } else if (toolStraggler) {
        semanticForce.x *= 0.68;
        semanticForce.y *= 0.68;
      }
      if (waitingToJoin) {
        semanticForce.x *= 0.18;
        semanticForce.y *= 0.18;
      }
      let separationX = 0;
      let separationY = 0;
      let alignmentX = 0;
      let alignmentY = 0;
      let cohesionX = 0;
      let cohesionY = 0;
      let neighborWeight = 0;
      const cellX = Math.floor(particle.x / NEIGHBOR_CELL_SIZE);
      const cellY = Math.floor(particle.y / NEIGHBOR_CELL_SIZE);
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const neighbors = spatialHash.get(`${cellX + offsetX},${cellY + offsetY}`) ?? [];
          for (const neighborIndex of neighbors) {
            if (neighborIndex === index) continue;
            const neighbor = this.particles[neighborIndex];
            const dx = particle.x - neighbor.x;
            const dy = particle.y - neighbor.y;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared <= 1e-4 || distanceSquared > NEIGHBOR_RADIUS * NEIGHBOR_RADIUS) continue;
            const distance = Math.sqrt(distanceSquared);
            const memberWeight = neighbor.member === particle.member ? 1.45 : 1;
            if (distance < SEPARATION_RADIUS) {
              const pressure = (SEPARATION_RADIUS - distance) / SEPARATION_RADIUS;
              separationX += dx / distance * pressure;
              separationY += dy / distance * pressure;
            }
            alignmentX += neighbor.vx * memberWeight;
            alignmentY += neighbor.vy * memberWeight;
            cohesionX += neighbor.x * memberWeight;
            cohesionY += neighbor.y * memberWeight;
            neighborWeight += memberWeight;
          }
        }
      }
      if (neighborWeight > 0) {
        alignmentX = alignmentX / neighborWeight - particle.vx;
        alignmentY = alignmentY / neighborWeight - particle.vy;
        cohesionX = cohesionX / neighborWeight - particle.x;
        cohesionY = cohesionY / neighborWeight - particle.y;
      }
      const flowStrength = visualTool ? 0.025 : mood === "thinking" ? 0.075 : mood === "sleep" ? 0.018 : 0.052;
      const flow = curlField(particle, tick, this.flowPhase, flowStrength);
      const voiceLevel = this.voiceLevels[particle.member] ?? 0;
      const memberAngle = this.flowPhase + particle.member / 5 * Math.PI * 2 + tick * 0.018 * (particle.member % 2 ? -1 : 1);
      const voiceCenter = {
        x: BRAILLE_PIXEL_WIDTH / 2 + Math.cos(memberAngle) * 8.7,
        y: BRAILLE_PIXEL_HEIGHT / 2 + Math.sin(memberAngle) * 5.1
      };
      const voice = vortexField(particle, voiceCenter, tick * 0.82 - particle.member * 1.7, voiceLevel);
      const separationWeight = visualTool ? 0.065 : 0.14;
      const alignmentWeight = visualTool ? 0.038 : 0.052;
      const neighborCohesionWeight = visualTool ? 0.014 : 0.014;
      const randomNoise = persistentCore ? 0.012 : mood === "thinking" ? 0.055 : mood === "error" ? 0.085 : 0.035;
      accelerations.push({
        x: semanticForce.x + separationX * separationWeight + alignmentX * alignmentWeight + cohesionX * neighborCohesionWeight + flow.x + voice.x + (this.random() - 0.5) * randomNoise * noiseScale,
        y: semanticForce.y + separationY * separationWeight + alignmentY * alignmentWeight + cohesionY * neighborCohesionWeight + flow.y + voice.y + (this.random() - 0.5) * randomNoise * noiseScale
      });
    }
    const baseDamping = visualTool ? 0.77 : mood === "error" ? 0.88 : mood === "sleep" ? 0.84 : 0.865;
    const damping = Math.pow(baseDamping, scale);
    for (let index = 0; index < this.particles.length; index++) {
      const particle = this.particles[index];
      const acceleration = accelerations[index];
      particle.vx = (particle.vx + acceleration.x * scale) * damping;
      particle.vy = (particle.vy + acceleration.y * scale) * damping;
      const speed = Math.hypot(particle.vx, particle.vy);
      const limit = mood === "error" ? 2.7 : visualTool ? 2.5 : this.outputEnergy > 0.04 ? 1.9 : 1.45;
      if (speed > limit) {
        particle.vx = particle.vx / speed * limit;
        particle.vy = particle.vy / speed * limit;
      }
      particle.x += particle.vx * scale;
      particle.y += particle.vy * scale;
      if (particle.x < 0 || particle.x >= BRAILLE_PIXEL_WIDTH) {
        particle.x = Math.max(0, Math.min(BRAILLE_PIXEL_WIDTH - 1, particle.x));
        particle.vx *= -0.72;
      }
      if (particle.y < 0 || particle.y >= BRAILLE_PIXEL_HEIGHT) {
        particle.y = Math.max(0, Math.min(BRAILLE_PIXEL_HEIGHT - 1, particle.y));
        particle.vy *= -0.72;
      }
    }
    if (mood !== "tool" && this.motifEcho > 0) this.motifEcho = Math.max(0, this.motifEcho - scale);
    if (this.outputEnergy > 0) {
      this.outputEnergy *= Math.pow(0.72, scale);
      if (this.outputEnergy < 0.035) this.outputEnergy = 0;
    }
    for (let member = 0; member < this.voiceLevels.length; member++) {
      this.voiceLevels[member] *= Math.pow(0.68, scale);
      if (this.voiceLevels[member] < 0.02) this.voiceLevels[member] = 0;
    }
  }
  snapshot() {
    return {
      motif: this.motif,
      motifs: this.toolPlan.layers.map((layer) => layer.motif),
      toolOperator: this.toolPlan.operator,
      toolSummary: this.toolSummary,
      homeForm: this.homeForm,
      echoActive: this.motifEcho > 0,
      outputActive: this.outputEnergy > 0,
      particles: this.particles.map((particle) => ({
        x: particle.x / (BRAILLE_PIXEL_WIDTH - 1),
        y: particle.y / (BRAILLE_PIXEL_HEIGHT - 1),
        vx: particle.vx / (BRAILLE_PIXEL_WIDTH - 1),
        vy: particle.vy / (BRAILLE_PIXEL_HEIGHT - 1),
        role: particle.role,
        core: particle.core,
        member: particle.member
      }))
    };
  }
  faceLines(mood, tick = 0) {
    this.setMood(mood);
    return swarmSnapshotFaceLines(this.snapshot(), mood, tick);
  }
};
function swarmSnapshotFaceLines(snapshot, mood, tick = 0, label = LABELS[mood]) {
  const displayTick = Math.floor(Math.max(0, tick) / 4);
  const pulse = [".", "o", "O", "o"][displayTick % 4];
  const operatorName = snapshot.toolOperator === "sequence" ? "sequence" : snapshot.toolOperator === "parallel" ? "parallel" : snapshot.toolOperator === "nested" ? "nested" : snapshot.toolOperator === "failed" ? "failed" : "atom";
  const summary = snapshot.toolOperator === "parallel" && snapshot.toolSummary.startsWith("(") ? snapshot.toolSummary.slice(1, -1) : snapshot.toolSummary;
  const suffix = mood === "tool" ? `[${operatorName}: ${summary}]` : snapshot.echoActive ? `[${operatorName}: ${summary} \xB7 echo]` : snapshot.homeForm === "emergent-face" ? `[emergent face${snapshot.outputActive ? " speaking" : ""}]` : "[braille swarm]";
  const title = `pi face ${pulse} ${label} ${suffix}`;
  const face = encodeBraille(snapshot.particles.map((particle) => ({
    x: particle.x * (BRAILLE_PIXEL_WIDTH - 1),
    y: particle.y * (BRAILLE_PIXEL_HEIGHT - 1)
  })));
  const innerWidth = Math.max(title.length, ...face.map((line) => line.length));
  const top = `\u256D${"\u2500".repeat(innerWidth + 2)}\u256E`;
  const bottom = `\u2570${"\u2500".repeat(innerWidth + 2)}\u256F`;
  const row = (text) => `\u2502 ${text.padEnd(innerWidth)} \u2502`;
  return [top, row(title), ...face.map(row), bottom];
}

// src/presence.ts
var AgentFaceEngine = class {
  state = new FaceState();
  swarm;
  toolAlgebra = new ToolAlgebraTrace();
  animationTick = 0;
  constructor(seed2, initialMood = "idle", homeForm = "cat") {
    this.state.setManual(initialMood);
    this.swarm = new BrailleSwarm(seed2, initialMood, homeForm);
  }
  get mood() {
    return this.state.mood;
  }
  get tick() {
    return this.animationTick;
  }
  dispatch(event) {
    const previousMood = this.state.mood;
    if (event.type === "reset") {
      this.state = new FaceState();
      this.state.setManual(event.mood ?? "idle");
      this.toolAlgebra.reset();
      this.swarm.clearToolExpression();
      this.animationTick = 0;
      this.swarm.reset(this.state.mood);
      return this.snapshot();
    }
    if (event.type === "run_prepare") {
      this.toolAlgebra.reset();
      this.swarm.clearToolExpression();
      this.state.prepare();
    } else if (event.type === "run_start") {
      if (!this.state.active) {
        this.toolAlgebra.reset();
        this.swarm.clearToolExpression();
      }
      this.state.start();
    } else if (event.type === "run_end") this.state.runEnd();
    else if (event.type === "finalizing") this.state.beforeSettle();
    else if (event.type === "tool_start") {
      this.toolAlgebra.start(event.id, event.name, event.parentId);
      this.state.toolStart(event.id, event.name, event.parentId);
      this.swarm.setToolExpression(this.toolAlgebra.expression());
    } else if (event.type === "tool_update") {
      this.toolAlgebra.update(event.id, event.progress);
      this.state.toolUpdate(event.id, event.progress);
      this.swarm.setToolExpression(this.toolAlgebra.expression());
      this.swarm.pulseOutput(0.24);
    } else if (event.type === "tool_end") {
      this.toolAlgebra.end(event.id, event.isError);
      this.state.toolEnd(event.id, event.isError);
      this.swarm.setToolExpression(this.toolAlgebra.expression());
      this.swarm.finishTool(event.isError);
      if (this.state.activeToolCount > 0) this.swarm.setToolExpression(this.toolAlgebra.expression());
    } else if (event.type === "message_end") this.state.messageEnd(event.stopReason);
    else if (event.type === "output") {
      this.state.observeOutput();
      this.swarm.pulseOutput(event.intensity, event.members);
    } else if (event.type === "form") this.swarm.setHomeForm(event.form);
    else if (event.type === "prompt_start") this.state.promptStart(event.kind);
    else if (event.type === "prompt_end") this.state.promptEnd();
    else if (event.type === "settled") {
      this.toolAlgebra.settle(event.aborted);
      this.swarm.setToolExpression(this.toolAlgebra.expression());
      this.state.end(event.aborted);
    } else if (event.type === "model_selected") this.state.modelSelected(event.name);
    else if (event.type === "manual") this.state.setManual(event.mood);
    else if (event.type === "idle") this.state.idle();
    if (this.state.mood !== previousMood) {
      this.animationTick = 0;
      this.swarm.setMood(this.state.mood);
    }
    return this.snapshot();
  }
  advance(steps = 1) {
    for (let step = 0; step < Math.max(0, Math.floor(steps)); step++) {
      this.animationTick++;
      this.swarm.step(this.state.mood, this.animationTick);
    }
    return this.snapshot();
  }
  /** Advance with a fixed-step 60 Hz physics clock while preserving legacy 125 ms animation time. */
  advanceTime(milliseconds) {
    const boundedMilliseconds = Math.max(0, Math.min(250, milliseconds));
    if (boundedMilliseconds === 0) return this.snapshot();
    const totalScale = boundedMilliseconds / 125;
    const substeps = Math.max(1, Math.ceil(boundedMilliseconds / (1e3 / 60)));
    const stepScale = totalScale / substeps;
    for (let step = 0; step < substeps; step++) {
      this.animationTick += stepScale;
      this.swarm.step(this.state.mood, this.animationTick, stepScale);
    }
    return this.snapshot();
  }
  restartAnimation(resetParticles = false) {
    this.animationTick = 0;
    if (resetParticles) this.swarm.reset(this.state.mood);
    return this.snapshot();
  }
  snapshot() {
    const swarm = this.swarm.snapshot();
    const algebra = this.toolAlgebra.snapshot();
    const motifVisible = this.state.mood === "tool" || swarm.echoActive;
    return {
      mood: this.state.mood,
      phase: this.state.phase,
      label: this.state.label,
      tick: this.animationTick,
      runCount: this.state.runCount,
      activeToolName: this.state.currentToolName,
      activeToolCount: this.state.activeToolCount,
      nestedToolCount: this.state.nestedToolCount,
      toolProgress: this.state.currentToolProgress,
      modelName: this.state.modelName,
      toolExpression: algebra.expression,
      toolExpressionKey: algebra.key,
      toolExpressionText: algebra.text,
      toolSummary: algebra.motifText,
      toolVisualPlan: algebra.visualPlan,
      activeMotifs: algebra.activeMotifs,
      motifs: swarm.motifs,
      toolOperator: swarm.toolOperator,
      motif: swarm.motif,
      motifVisible,
      motifEcho: swarm.echoActive,
      homeForm: swarm.homeForm,
      outputActive: swarm.outputActive,
      particles: swarm.particles
    };
  }
};

// demo/sal-voice.ts
var DEFAULT_ASSET_BASE = "https://salus-ryan.github.io/sal-ensemble-lab/assets";
var SalVoiceAdapter = class {
  constructor(assetBase = DEFAULT_ASSET_BASE) {
    this.assetBase = assetBase;
  }
  context;
  buffers = [];
  sources = [];
  analyser;
  memberAnalysers = [];
  samples = new Uint8Array(1024);
  memberSamples = Array.from({ length: 5 }, () => new Uint8Array(256));
  playbackId = 0;
  _active = false;
  get active() {
    return this._active;
  }
  async load() {
    this.context ??= new AudioContext();
    if (this.buffers.length) return;
    const paths = Array.from({ length: 5 }, (_, index) => `${this.assetBase}/member-${index + 1}.mp3`);
    this.buffers = await Promise.all(paths.map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Sal Voice member failed to load: HTTP ${response.status}`);
      return this.context.decodeAudioData(await response.arrayBuffer());
    }));
  }
  async play(onEnded) {
    this.stop();
    await this.load();
    await this.context.resume();
    const playbackId = ++this.playbackId;
    const mix = this.context.createGain();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.58;
    mix.connect(analyser).connect(this.context.destination);
    this.analyser = analyser;
    const launch = this.context.currentTime + 0.06;
    let ended = 0;
    this.sources = this.buffers.map((buffer, index) => {
      const source = this.context.createBufferSource();
      const delay = this.context.createDelay(0.02);
      const panner = this.context.createStereoPanner();
      const gain = this.context.createGain();
      const memberAnalyser = this.context.createAnalyser();
      memberAnalyser.fftSize = 256;
      memberAnalyser.smoothingTimeConstant = 0.45;
      source.buffer = buffer;
      delay.delayTime.value = index / Math.max(1, this.buffers.length - 1) * 8e-3;
      panner.pan.value = -0.7 + index / Math.max(1, this.buffers.length - 1) * 1.4;
      gain.gain.value = 0.72 / Math.sqrt(this.buffers.length);
      source.connect(delay).connect(panner).connect(gain).connect(memberAnalyser).connect(mix);
      this.memberAnalysers[index] = memberAnalyser;
      source.addEventListener("ended", () => {
        ended++;
        if (ended !== this.buffers.length || playbackId !== this.playbackId) return;
        this._active = false;
        this.sources = [];
        this.analyser = void 0;
        this.memberAnalysers = [];
        onEnded();
      });
      source.start(launch);
      return source;
    });
    this._active = true;
  }
  stop() {
    this.playbackId++;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
      }
    }
    this.sources = [];
    this.analyser = void 0;
    this.memberAnalysers = [];
    this._active = false;
  }
  readIntensity(analyser, samples) {
    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) {
      const centered = (sample - 128) / 128;
      energy += centered * centered;
    }
    const rms = Math.sqrt(energy / samples.length);
    return Math.max(0, Math.min(1, (rms - 0.012) * 8.5));
  }
  intensity() {
    if (!this._active || !this.analyser) return 0;
    return this.readIntensity(this.analyser, this.samples);
  }
  memberIntensities() {
    if (!this._active) return [0, 0, 0, 0, 0];
    return this.memberAnalysers.map((analyser, index) => this.readIntensity(analyser, this.memberSamples[index]));
  }
};

// demo/app.ts
var canvas = document.querySelector("#face");
var context = canvas.getContext("2d");
var stateText = document.querySelector("#state");
var motifText = document.querySelector("#motif");
var eventText = document.querySelector("#event");
var seedText = document.querySelector("#seed");
var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function hash32(value) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
var parameters = new URLSearchParams(location.search);
var identity = parameters.get("identity") ?? "agent-face:pi:ryan:primary:v1";
var session = parameters.get("session");
var seed = hash32(session ? `${identity}:${session}` : identity);
var engine = new AgentFaceEngine(seed, "idle", "emergent-face");
seedText.textContent = `0x${seed.toString(16).padStart(8, "0")}`;
var lastAdvance = performance.now();
var activeTool;
var toolCounter = 0;
var scheduled = [];
var lastSalPulse = 0;
var salVoice = new SalVoiceAdapter();
var colors = {
  idle: [117, 211, 255],
  thinking: [128, 150, 255],
  tool: [255, 193, 94],
  waiting: [255, 139, 207],
  happy: [104, 239, 176],
  error: [255, 94, 117],
  cancelled: [180, 142, 255],
  sleep: [113, 147, 194]
};
var salMemberColors = [
  [158, 126, 255],
  [105, 174, 255],
  [92, 222, 222],
  [126, 207, 255],
  [191, 139, 255]
];
function record(label) {
  eventText.textContent = label;
}
function clearSchedule() {
  for (const timer of scheduled) clearTimeout(timer);
  scheduled = [];
  salVoice.stop();
}
function schedule(delay, action) {
  scheduled.push(window.setTimeout(action, delay));
}
function ensureRun() {
  if (["idle", "happy", "cancelled", "error", "sleep"].includes(engine.mood)) {
    engine.dispatch({ type: "run_start" });
  }
}
function endTool(isError = false) {
  if (!activeTool) return;
  engine.dispatch({ type: "tool_end", id: activeTool, isError });
  record(isError ? "tool error" : "tool completed");
  activeTool = void 0;
}
function startTool(name, duration = 5e3) {
  ensureRun();
  endTool();
  const id = `demo-${++toolCounter}`;
  activeTool = id;
  engine.dispatch({ type: "tool_start", id, name });
  record(`tool started: ${name}`);
  schedule(duration, () => endTool());
}
function playStory() {
  clearSchedule();
  engine.dispatch({ type: "reset", mood: "idle" });
  activeTool = void 0;
  record("story started");
  schedule(500, () => {
    engine.dispatch({ type: "run_start" });
    record("run started");
  });
  const tools = ["bash", "read", "edit", "multi_tool_use.parallel", "custom_operation"];
  tools.forEach((tool, index) => schedule(1300 + index * 3e3, () => startTool(tool, 1900)));
  const outputStart = 1300 + tools.length * 3e3;
  for (let pulse = 0; pulse < 9; pulse++) {
    schedule(outputStart + pulse * 260, () => {
      engine.dispatch({ type: "output", intensity: 0.65 + pulse % 3 * 0.16 });
      record("streaming output");
    });
  }
  schedule(outputStart + 2800, () => {
    endTool();
    engine.dispatch({ type: "settled" });
    record("run settled");
  });
}
function speak() {
  clearSchedule();
  ensureRun();
  endTool();
  for (let pulse = 0; pulse < 12; pulse++) {
    schedule(pulse * 230, () => {
      engine.dispatch({ type: "output", intensity: 0.62 + pulse % 4 * 0.11 });
      record("streaming output");
    });
  }
  schedule(3100, () => {
    engine.dispatch({ type: "settled" });
    record("response completed");
  });
}
async function speakWithSal() {
  clearSchedule();
  ensureRun();
  endTool();
  const button = document.querySelector("[data-action=sal]");
  button.disabled = true;
  record("loading Sal voice");
  try {
    await salVoice.play(() => {
      engine.dispatch({ type: "settled" });
      record("Sal voice completed");
    });
    record("Sal voice playing \xB7 audio drives face");
  } catch (error) {
    engine.dispatch({ type: "message_end", stopReason: "error" });
    engine.dispatch({ type: "settled" });
    record(error instanceof Error ? error.message : "Sal voice failed");
  } finally {
    button.disabled = false;
  }
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(devicePixelRatio, 2);
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  context.setTransform(scale, 0, 0, scale, 0, 0);
}
function render(now) {
  const elapsed = Math.max(0, Math.min(100, now - lastAdvance));
  if (!reduceMotion || elapsed >= 250) {
    engine.advanceTime(elapsed);
    lastAdvance = now;
  }
  const salIntensity = salVoice.intensity();
  if (salIntensity > 0.025 && now - lastSalPulse >= 70) {
    engine.dispatch({
      type: "output",
      intensity: salIntensity,
      members: salVoice.memberIntensities()
    });
    lastSalPulse = now;
  }
  const frame = engine.snapshot();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const availableWidth = Math.max(1, width - 96);
  const availableHeight = Math.max(1, height - 150);
  const drawHeight = Math.min(availableHeight, availableWidth * 0.75);
  const drawWidth = drawHeight * 4 / 3;
  const paddingX = (width - drawWidth) / 2;
  const paddingY = (height - drawHeight) / 2;
  const [red, green, blue] = colors[frame.mood] ?? colors.idle;
  context.clearRect(0, 0, width, height);
  const glow = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.48);
  glow.addColorStop(0, `rgba(${red},${green},${blue},0.10)`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "lighter";
  for (const particle of frame.particles) {
    const x = paddingX + particle.x * drawWidth;
    const y = paddingY + particle.y * drawHeight;
    const scout = !particle.core && particle.role > 0.94;
    const radius = particle.core ? 2.15 : scout ? 2.7 : 1.35 + particle.role * 0.75;
    const memberColor = salVoice.active ? salMemberColors[particle.member] : [red, green, blue];
    const [particleRed, particleGreen, particleBlue] = memberColor;
    const velocityX = particle.vx * drawWidth;
    const velocityY = particle.vy * drawHeight;
    const speed = Math.hypot(velocityX, velocityY);
    if (speed > 0.5) {
      context.beginPath();
      context.moveTo(x - velocityX * 0.85, y - velocityY * 0.85);
      context.lineTo(x, y);
      context.strokeStyle = `rgba(${particleRed},${particleGreen},${particleBlue},${Math.min(0.34, speed * 0.025)})`;
      context.lineWidth = Math.max(0.55, radius * 0.42);
      context.stroke();
    }
    context.beginPath();
    context.arc(x, y, radius * (particle.core ? 4.3 : 3.2), 0, Math.PI * 2);
    context.fillStyle = `rgba(${particleRed},${particleGreen},${particleBlue},${particle.core ? 0.075 : scout ? 0.06 : 0.035})`;
    context.fill();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    const lift = particle.core ? 70 : 35;
    context.fillStyle = `rgba(${Math.min(255, particleRed + lift)},${Math.min(255, particleGreen + lift)},${Math.min(255, particleBlue + lift)},${particle.core ? 0.98 : scout ? 0.95 : 0.78})`;
    context.fill();
  }
  context.globalCompositeOperation = "source-over";
  stateText.textContent = frame.label;
  motifText.textContent = frame.motifVisible ? `${frame.motif}${frame.motifEcho ? " echo" : ""}` : frame.outputActive && frame.homeForm === "emergent-face" ? "emergent voice" : frame.homeForm === "emergent-face" ? "ambient cloud" : "cat form";
  requestAnimationFrame(render);
}
document.querySelectorAll("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    clearSchedule();
    startTool(button.dataset.tool);
  });
});
document.querySelector("[data-action=story]").addEventListener("click", playStory);
document.querySelector("[data-action=speak]").addEventListener("click", speak);
document.querySelector("[data-action=sal]").addEventListener("click", speakWithSal);
var formButton = document.querySelector("[data-action=form]");
formButton.addEventListener("click", () => {
  clearSchedule();
  const form = engine.snapshot().homeForm === "emergent-face" ? "cat" : "emergent-face";
  engine.dispatch({ type: "form", form });
  formButton.textContent = form === "emergent-face" ? "Cat form" : "Emergent face";
  record(`form changed: ${form}`);
});
document.querySelector("[data-action=wait]").addEventListener("click", () => {
  clearSchedule();
  ensureRun();
  endTool();
  engine.dispatch({ type: "prompt_start" });
  record("waiting for user");
  schedule(1800, () => {
    engine.dispatch({ type: "prompt_end" });
    record("prompt answered");
  });
});
document.querySelector("[data-action=error]").addEventListener("click", () => {
  clearSchedule();
  ensureRun();
  endTool(true);
  engine.dispatch({ type: "message_end", stopReason: "error" });
  engine.dispatch({ type: "settled" });
  record("error observed");
});
document.querySelector("[data-action=collective]").addEventListener("click", () => {
  location.href = "./collective.html";
});
document.querySelector("[data-action=reset]").addEventListener("click", () => {
  clearSchedule();
  activeTool = void 0;
  engine.dispatch({ type: "reset", mood: "idle" });
  record("reset");
});
addEventListener("resize", resize);
addEventListener("beforeunload", () => salVoice.stop());
resize();
requestAnimationFrame(render);
if (parameters.get("action") === "speak") speak();
else playStory();
