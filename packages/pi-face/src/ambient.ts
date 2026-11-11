import type { AgentFaceFrame } from "./presence.ts";
import type { ToolMotif } from "./tool-motifs.ts";

const ACTIVE_GLYPHS: Record<ToolMotif, string> = {
  hammer: "◆",
  lens: "◉",
  pencil: "╱",
  network: "●",
  gear: "◎",
};

const COMPLETE_GLYPHS: Record<ToolMotif, string> = {
  hammer: "◇",
  lens: "○",
  pencil: "╱",
  network: "○",
  gear: "◌",
};

function set(cells: string[], index: number, value: string) {
  if (index >= 0 && index < cells.length) cells[index] = value;
}

function indexFor(value: number, width: number) {
  return Math.max(0, Math.min(width - 1, Math.round(value * (width - 1))));
}

function fill(cells: string[], from: number, to: number, value: string, spacing = 1) {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  for (let index = start; index <= end; index++) {
    if ((index - start) % spacing === 0 && cells[index] === " ") cells[index] = value;
  }
}

function centeredPulse(cells: string[], tick: number, glyph = "●", satellite = "·") {
  const center = Math.floor(cells.length / 2);
  const radius = Math.max(1, tick % Math.max(2, Math.floor(cells.length / 5)));
  set(cells, center, glyph);
  set(cells, center - radius, satellite);
  set(cells, center + radius, satellite);
}

function unicodeToolRail(frame: AgentFaceFrame, cells: string[]) {
  for (const link of frame.toolVisualPlan.links) {
    const from = indexFor(link.from[0], cells.length);
    const to = indexFor(link.to[0], cells.length);
    if (link.kind === "sequence") {
      fill(cells, from, to, "─");
      set(cells, Math.round((from + to) / 2), "→");
    } else if (link.kind === "parallel") {
      fill(cells, from, to, "·", 2);
    } else {
      fill(cells, from, to, "┄", 2);
      set(cells, Math.round((from + to) / 2), "◇");
    }
  }

  frame.toolVisualPlan.layers.forEach((layer) => {
    const index = indexFor(layer.x, cells.length);
    const glyph = layer.failed ? "×"
      : layer.status === "active" ? ACTIVE_GLYPHS[layer.motif]
        : COMPLETE_GLYPHS[layer.motif];
    set(cells, index, glyph);
    if (layer.status === "active" && layer.progress !== undefined) {
      const length = Math.max(1, Math.round(layer.progress * 4));
      for (let offset = 1; offset <= length; offset++) set(cells, index + offset, "━");
    }
  });
}

function unicodePhaseRail(frame: AgentFaceFrame, cells: string[]) {
  const tick = Math.max(0, Math.floor(frame.tick));
  const center = Math.floor(cells.length / 2);
  if (frame.phase === "idle") {
    set(cells, center, "·");
  } else if (frame.phase === "starting") {
    centeredPulse(cells, tick, "◇");
  } else if (frame.phase === "running" || frame.phase === "continuing") {
    centeredPulse(cells, Math.floor(tick / 2), frame.phase === "continuing" ? "◎" : "●");
  } else if (frame.phase === "streaming") {
    const wave = ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"];
    for (let index = 0; index < cells.length; index++) cells[index] = wave[(index + tick) % wave.length];
  } else if (frame.phase === "waiting") {
    fill(cells, 1, cells.length - 2, "┄", 2);
    set(cells, center, tick % 2 === 0 ? "◉" : "◎");
  } else if (frame.phase === "finalizing") {
    const radius = Math.max(1, Math.floor(cells.length / 3) - tick % Math.max(2, Math.floor(cells.length / 3)));
    set(cells, center - radius, "▶");
    set(cells, center, "◆");
    set(cells, center + radius, "◀");
  } else if (frame.phase === "error") {
    fill(cells, 1, cells.length - 2, "─");
    set(cells, center, "×");
  } else if (frame.phase === "cancelled") {
    fill(cells, 1, center - 1, "─");
    fill(cells, center + 1, cells.length - 2, "─");
    set(cells, center, "╱");
  } else if (frame.phase === "model-selected") {
    set(cells, center, "◇");
  } else if (frame.phase === "settled") {
    set(cells, center, tick % 2 === 0 ? "*" : "·");
  } else {
    centeredPulse(cells, tick, "○");
  }
}

function sliceColumns(value: string, width: number) {
  return [...value].slice(0, Math.max(0, width)).join("");
}

function brailleToolRail(frame: AgentFaceFrame, cells: string[]) {
  const active: Record<ToolMotif, string> = {
    hammer: "⣶",
    lens: "⢎",
    pencil: "⠸",
    network: "⠿",
    gear: "⣭",
  };
  const complete: Record<ToolMotif, string> = {
    hammer: "⠶",
    lens: "⠎",
    pencil: "⠐",
    network: "⠛",
    gear: "⠭",
  };
  for (const link of frame.toolVisualPlan.links) {
    const from = indexFor(link.from[0], cells.length);
    const to = indexFor(link.to[0], cells.length);
    fill(cells, from, to, link.kind === "parallel" ? "⠂" : "⠒", link.kind === "parallel" ? 2 : 1);
    if (link.kind === "sequence") set(cells, Math.round((from + to) / 2), "⠶");
    if (link.kind === "nested") set(cells, Math.round((from + to) / 2), "⠿");
  }
  frame.toolVisualPlan.layers.forEach((layer) => {
    const index = indexFor(layer.x, cells.length);
    set(cells, index, layer.failed ? "⣿" : layer.status === "active" ? active[layer.motif] : complete[layer.motif]);
    // A one-cell gear looked like a faint generic dot once fast judgment tools
    // completed. Teeth keep the fallback/judgment motif recognizable, while an
    // active gear alternates orientation with the observable animation tick.
    if (!layer.failed && layer.motif === "gear") {
      const activeGear = layer.status === "active";
      const alternate = frame.tick % 2 >= 1;
      set(cells, index - 1, activeGear && alternate ? "⣤" : "⠛");
      set(cells, index + 1, activeGear && alternate ? "⠛" : "⣤");
    }
    if (layer.status === "active" && layer.progress !== undefined) {
      const length = Math.max(1, Math.round(layer.progress * 4));
      for (let offset = 1; offset <= length; offset++) set(cells, index + offset, "⣀");
    }
  });
}

function braillePhaseRail(frame: AgentFaceFrame, cells: string[]) {
  const tick = Math.max(0, Math.floor(frame.tick));
  const center = Math.floor(cells.length / 2);
  if (frame.phase === "idle") set(cells, center, "⠂");
  else if (frame.phase === "starting" || frame.phase === "running" || frame.phase === "continuing") {
    centeredPulse(cells, Math.floor(tick / 2), frame.phase === "starting" ? "⠿" : "⣶", "⠂");
  } else if (frame.phase === "streaming") {
    const wave = ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"];
    for (let index = 0; index < cells.length; index++) cells[index] = wave[(index + tick) % wave.length];
  } else if (frame.phase === "waiting") {
    fill(cells, 1, cells.length - 2, "⠂", 2);
    set(cells, center, tick % 2 === 0 ? "⣿" : "⠿");
  } else if (frame.phase === "finalizing") {
    const radius = Math.max(1, Math.floor(cells.length / 3) - tick % Math.max(2, Math.floor(cells.length / 3)));
    set(cells, center - radius, "⠶"); set(cells, center, "⣿"); set(cells, center + radius, "⠶");
  } else if (frame.phase === "error") {
    fill(cells, 1, cells.length - 2, "⠒"); set(cells, center, "⣿");
  } else if (frame.phase === "cancelled") {
    fill(cells, 1, center - 1, "⠒"); fill(cells, center + 1, cells.length - 2, "⠒"); set(cells, center, "⠸");
  } else if (frame.phase === "model-selected") set(cells, center, "⠿");
  else if (frame.phase === "settled") set(cells, center, tick % 2 === 0 ? "⠶" : "⠂");
  else centeredPulse(cells, tick, "⠿", "⠂");
}

function asciiToolRail(frame: AgentFaceFrame, cells: string[]) {
  const glyphs: Record<ToolMotif, readonly [string, string]> = {
    hammer: ["H", "h"],
    lens: ["L", "l"],
    pencil: ["P", "p"],
    network: ["N", "n"],
    gear: ["G", "g"],
  };
  for (const link of frame.toolVisualPlan.links) {
    const from = indexFor(link.from[0], cells.length);
    const to = indexFor(link.to[0], cells.length);
    fill(cells, from, to, link.kind === "sequence" ? "-" : link.kind === "parallel" ? "." : ":", link.kind === "sequence" ? 1 : 2);
    if (link.kind === "sequence") set(cells, Math.round((from + to) / 2), ">");
  }
  frame.toolVisualPlan.layers.forEach((layer) => {
    const index = indexFor(layer.x, cells.length);
    set(cells, index, layer.failed ? "X" : glyphs[layer.motif][layer.status === "active" ? 0 : 1]);
    if (layer.status === "active" && layer.progress !== undefined) {
      const length = Math.max(1, Math.round(layer.progress * 4));
      for (let offset = 1; offset <= length; offset++) set(cells, index + offset, "=");
    }
  });
}

function asciiPhaseRail(frame: AgentFaceFrame, cells: string[]) {
  const tick = Math.max(0, Math.floor(frame.tick));
  const center = Math.floor(cells.length / 2);
  if (frame.phase === "idle") set(cells, center, ".");
  else if (frame.phase === "starting" || frame.phase === "running" || frame.phase === "continuing") {
    centeredPulse(cells, Math.floor(tick / 2), frame.phase === "starting" ? "O" : "o", ".");
  } else if (frame.phase === "streaming") {
    const wave = [".", ":", "-", "="];
    for (let index = 0; index < cells.length; index++) cells[index] = wave[(index + tick) % wave.length];
  } else if (frame.phase === "waiting") {
    fill(cells, 1, cells.length - 2, ".", 2);
    set(cells, center, "!");
  } else if (frame.phase === "finalizing") {
    const radius = Math.max(1, Math.floor(cells.length / 3) - tick % Math.max(2, Math.floor(cells.length / 3)));
    set(cells, center - radius, ">"); set(cells, center, "o"); set(cells, center + radius, "<");
  } else if (frame.phase === "error") {
    fill(cells, 1, cells.length - 2, "-"); set(cells, center, "X");
  } else if (frame.phase === "cancelled") {
    fill(cells, 1, center - 1, "-"); fill(cells, center + 1, cells.length - 2, "-"); set(cells, center, "/");
  } else if (frame.phase === "model-selected") set(cells, center, "M");
  else if (frame.phase === "settled") set(cells, center, "*");
  else centeredPulse(cells, tick, "o", ".");
}

export type AmbientGlyphStyle = "braille" | "unicode" | "ascii";

/** Compact, character-free status renderer for peripheral awareness. */
export function ambientPresenceLines(
  frame: AgentFaceFrame,
  availableWidth = 32,
  glyphStyle: AmbientGlyphStyle = "braille",
): string[] {
  const width = Math.max(1, Math.min(40, Math.floor(availableWidth)));
  const cells = Array.from({ length: width }, () => " ");
  const hasToolStructure = frame.toolVisualPlan.layers.length > 0;
  const showToolStructure = hasToolStructure && (
    frame.phase === "tool" || frame.motifEcho || frame.phase === "error" || frame.phase === "cancelled"
  );
  if (glyphStyle === "ascii") {
    if (showToolStructure) asciiToolRail(frame, cells);
    else asciiPhaseRail(frame, cells);
  } else if (glyphStyle === "unicode") {
    if (showToolStructure) unicodeToolRail(frame, cells);
    else unicodePhaseRail(frame, cells);
  } else {
    if (showToolStructure) brailleToolRail(frame, cells);
    else braillePhaseRail(frame, cells);
  }

  const summary = frame.toolOperator === "parallel" && frame.toolSummary.startsWith("(")
    ? frame.toolSummary.slice(1, -1)
    : frame.toolSummary;
  const operator = frame.toolOperator === "identity" ? "idle" : frame.toolOperator;
  const progress = frame.toolProgress === undefined ? "" : ` · ${Math.round(frame.toolProgress * 100)}%`;
  const detail = showToolStructure
    ? `${operator}: ${summary}${progress}${frame.motifEcho ? " · echo" : ""}`
    : frame.label;
  return [cells.join(""), sliceColumns(detail, width)];
}
