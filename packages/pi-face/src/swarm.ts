import { BRAILLE_PIXEL_HEIGHT, BRAILLE_PIXEL_WIDTH, brailleArtLines } from "./braille.ts";
import { contourField, curlField, vortexField } from "./collective-kernel.ts";
import type { Mood } from "./face.ts";
import { LABELS } from "./face.ts";
import {
  formatToolMotifExpression,
  layoutToolExpression,
  type ToolExpression,
  type ToolVisualPlan,
} from "./tool-algebra.ts";
import { motifForTool, type ToolMotif } from "./tool-motifs.ts";

export { motifForTool } from "./tool-motifs.ts";
export type { ToolMotif } from "./tool-motifs.ts";
export type SwarmHomeForm = "cat" | "emergent-face";

export interface NormalizedParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  role: number;
  core: boolean;
  member: number;
}

export interface SwarmSnapshot {
  motif: ToolMotif;
  motifs: readonly ToolMotif[];
  toolOperator: ToolVisualPlan["operator"];
  toolSummary: string;
  homeForm: SwarmHomeForm;
  echoActive: boolean;
  outputActive: boolean;
  particles: readonly NormalizedParticle[];
}

type Point = { x: number; y: number };

function scaleLegacyPoints(points: readonly Point[]): Point[] {
  const scaleX = (BRAILLE_PIXEL_WIDTH - 1) / (LEGACY_PIXEL_WIDTH - 1);
  const scaleY = (BRAILLE_PIXEL_HEIGHT - 1) / (LEGACY_PIXEL_HEIGHT - 1);
  return points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
}

type Particle = Point & {
  vx: number;
  vy: number;
  phase: number;
  role: number;
  lag: number;
  core: boolean;
  member: number;
};

const PARTICLE_COUNT = 220;
const CORE_PARTICLE_COUNT = 44;
const LEGACY_PIXEL_WIDTH = 32;
const LEGACY_PIXEL_HEIGHT = 24;
const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

class Shape {
  private readonly pixels = new Map<number, Point>();

  set(x: number, y: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= BRAILLE_PIXEL_WIDTH || y < 0 || y >= BRAILLE_PIXEL_HEIGHT) return;
    this.pixels.set(y * BRAILLE_PIXEL_WIDTH + x, { x, y });
  }

  line(x0: number, y0: number, x1: number, y1: number) {
    x0 = Math.round(x0); y0 = Math.round(y0);
    x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      this.set(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const twice = error * 2;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  }

  dottedLine(x0: number, y0: number, x1: number, y1: number, spacing = 2) {
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(distance));
    for (let step = 0; step <= steps; step++) {
      if (step % spacing !== 0) continue;
      const t = step / steps;
      this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }

  circle(cx: number, cy: number, radius: number, phase = 0) {
    this.ellipse(cx, cy, radius, radius, phase);
  }

  ellipse(cx: number, cy: number, radiusX: number, radiusY: number, phase = 0) {
    const steps = Math.max(20, Math.ceil(Math.max(radiusX, radiusY) * Math.PI * 3));
    for (let step = 0; step < steps; step++) {
      const angle = phase + step / steps * Math.PI * 2;
      this.set(cx + Math.cos(angle) * radiusX, cy + Math.sin(angle) * radiusY);
    }
  }

  arc(cx: number, cy: number, radiusX: number, radiusY: number, start: number, end: number) {
    const steps = Math.max(8, Math.ceil(Math.abs(end - start) * Math.max(radiusX, radiusY) * 1.8));
    for (let step = 0; step <= steps; step++) {
      const angle = start + (end - start) * step / steps;
      this.set(cx + Math.cos(angle) * radiusX, cy + Math.sin(angle) * radiusY);
    }
  }

  get points() {
    return [...this.pixels.values()];
  }
}

function rotate(x: number, y: number, angle: number, cx = 16, cy = 12): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: cx + x * cosine - y * sine, y: cy + x * sine + y * cosine };
}

function hammerPoints(tick: number): Point[] {
  const shape = new Shape();
  // Keep the silhouette bold and nearly upright; motion comes from a restrained swing.
  const angle = -0.12 + Math.sin(tick * 0.34) * 0.2;
  const add = (x: number, y: number) => {
    const point = rotate(x, y, angle, 16, 12);
    shape.set(point.x, point.y);
  };
  for (let y = -3; y <= 10; y++) for (let x = -1; x <= 1; x++) add(x, y);
  for (let y = -8; y <= -4; y++) for (let x = -9; x <= 8; x++) add(x, y);
  for (let y = -7; y <= -5; y++) for (let x = -11; x <= -10; x++) add(x, y);

  // Impact sparks appear near the broad striking face during the downward swing.
  if (Math.sin(tick * 0.34) > 0.72) {
    const impact = rotate(-11, -6, angle, 16, 12);
    for (const [dx, dy] of [[-4, -2], [-4, 2], [-2, -4], [-1, 4], [2, -3]] as const) {
      shape.line(impact.x, impact.y, impact.x + dx, impact.y + dy);
    }
  }
  return shape.points;
}

function lensPoints(tick: number): Point[] {
  const shape = new Shape();
  const drift = Math.sin(tick * 0.22) * 1.5;
  shape.circle(13 + drift, 10, 6, tick * 0.04);
  shape.line(17 + drift, 14, 25 + drift, 22);
  shape.line(18 + drift, 13, 26 + drift, 21);
  const scanX = 10 + drift + (tick % 9);
  shape.line(scanX, 6, scanX, 14);
  return shape.points;
}

function pencilPoints(tick: number): Point[] {
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

function networkPoints(tick: number): Point[] {
  const shape = new Shape();
  const pulse = 1 + (tick % 8 < 4 ? 0 : 1);
  const nodes = [
    { x: 7, y: 7 }, { x: 16, y: 4 }, { x: 25, y: 8 },
    { x: 10, y: 18 }, { x: 22, y: 19 },
  ];
  for (const [from, to] of [[0, 1], [1, 2], [0, 3], [1, 3], [1, 4], [2, 4], [3, 4]] as const) {
    shape.line(nodes[from].x, nodes[from].y, nodes[to].x, nodes[to].y);
  }
  nodes.forEach((node, index) => shape.circle(node.x, node.y, index === tick % nodes.length ? pulse + 1 : pulse));
  return shape.points;
}

function gearPoints(tick: number): Point[] {
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

type EmergentFaceShape = { points: Point[]; core: Point[] };

/** A face suggested by density and negative space rather than a rigid sprite. */
function emergentFacePoints(mood: Mood, tick: number, outputEnergy: number): EmergentFaceShape {
  const shape = new Shape();
  const core = new Shape();
  const breathe = Math.sin(tick * 0.09) * 0.18;
  shape.ellipse(16, 12, 10.2 + breathe, 10.4 - breathe, tick * 0.002);
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

function ambientPresencePoints(mood: Mood, tick: number): Point[] {
  const points: Point[] = [];
  const energy = mood === "thinking" ? 1.2 : mood === "error" ? 1.45
    : mood === "cancelled" ? 1.3 : mood === "sleep" ? 0.72 : 0.92;
  for (let index = 0; index < 180; index++) {
    const unit = (index + 0.5) / 180;
    const radius = (1.7 + Math.sqrt(unit) * 8.8) * energy;
    const direction = index % 3 === 0 ? -1 : 1;
    const angle = index * 2.399963 + tick * 0.014 * direction;
    const ripple = Math.sin(index * 1.73 + tick * 0.11) * (mood === "thinking" ? 0.8 : 0.4);
    points.push({
      x: 16 + Math.cos(angle) * (radius + ripple) * 1.06 + Math.sin(index * 0.37) * 0.65,
      y: 12 + Math.sin(angle) * (radius - ripple) * 0.76 + Math.cos(index * 0.29) * 0.45,
    });
  }
  return points;
}

function identityConstellationPoints(tick: number): Point[] {
  const shape = new Shape();
  const phase = tick * 0.035;
  const nodes = [
    { x: 11 + Math.cos(phase) * 1.4, y: 8 + Math.sin(phase) * 1.1 },
    { x: 21 + Math.cos(phase + 2.1) * 1.6, y: 11 + Math.sin(phase + 2.1) * 1.2 },
    { x: 14 + Math.cos(phase + 4.2) * 1.2, y: 18 + Math.sin(phase + 4.2) * 1.1 },
    { x: 23 + Math.cos(phase + 5.4), y: 17 + Math.sin(phase + 5.4) },
  ];
  nodes.forEach((node, index) => shape.circle(node.x, node.y, index === tick % nodes.length ? 1.4 : 0.8));
  return shape.points;
}

function emergentHomePoints(mood: Mood, tick: number, outputEnergy: number): Point[] {
  if (outputEnergy > 0.04 || mood === "waiting") {
    return emergentFacePoints(mood, tick, outputEnergy).points;
  }

  const cloud = ambientPresencePoints(mood, tick);
  const reveal = mood === "happy" ? Math.max(0, 0.58 - tick * 0.026)
    : mood === "error" ? 0.24
      : mood === "cancelled" ? 0.12
        : mood === "sleep" ? 0.08 : 0;
  if (reveal <= 0) return cloud;

  const face = emergentFacePoints(mood, tick, 0).points.filter((_, index) =>
    ((index * 47 + 13) % 101) / 100 < reveal);
  return [...cloud.slice(0, Math.max(100, 170 - face.length)), ...face];
}

function motifPoints(motif: ToolMotif, tick: number): Point[] {
  const points = motif === "hammer" ? hammerPoints(tick)
    : motif === "lens" ? lensPoints(tick)
      : motif === "pencil" ? pencilPoints(tick)
        : motif === "network" ? networkPoints(tick)
          : gearPoints(tick);
  return scaleLegacyPoints(points);
}

function toolVisualPlanPoints(plan: ToolVisualPlan, tick: number): Point[] {
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
    const progressVisibility = layer.status === "active" && layer.progress !== undefined
      ? Math.max(0.18, layer.progress)
      : 1;
    points.forEach((point, pointIndex) => {
      const sample = ((pointIndex * 47 + layerIndex * 29 + layer.id.length * 13) % 101) / 100;
      if (sample > layer.weight || sample > progressVisibility) return;
      const failureJitter = layer.failed ? Math.sin(pointIndex * 1.7 + tick * 0.45) * 1.1 : 0;
      shape.set(
        layerX + (point.x - centerX) * layer.scale + failureJitter,
        layerY + (point.y - centerY) * layer.scale - Math.abs(failureJitter) * 0.35,
      );
    });
  });
  return shape.points;
}

function decodeBraille(lines: readonly string[]): Point[] {
  const points: Point[] = [];
  for (let cellY = 0; cellY < lines.length; cellY++) {
    const chars = [...lines[cellY]];
    for (let cellX = 0; cellX < chars.length; cellX++) {
      const value = chars[cellX].codePointAt(0)! - 0x2800;
      if (value <= 0 || value > 0xff) continue;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (value & DOTS[dy][dx]) points.push({ x: cellX * 2 + dx, y: cellY * 4 + dy });
        }
      }
    }
  }
  return points;
}

function encodeBraille(particles: readonly Point[]): string[] {
  const occupied = new Set<number>();
  for (const particle of particles) {
    const x = Math.max(0, Math.min(BRAILLE_PIXEL_WIDTH - 1, Math.round(particle.x)));
    const y = Math.max(0, Math.min(BRAILLE_PIXEL_HEIGHT - 1, Math.round(particle.y)));
    occupied.add(y * BRAILLE_PIXEL_WIDTH + x);
  }

  const lines: string[] = [];
  for (let y = 0; y < BRAILLE_PIXEL_HEIGHT; y += 4) {
    let line = "";
    for (let x = 0; x < BRAILLE_PIXEL_WIDTH; x += 2) {
      let value = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (occupied.has((y + dy) * BRAILLE_PIXEL_WIDTH + x + dx)) value |= DOTS[dy][dx];
        }
      }
      line += value === 0 ? " " : String.fromCodePoint(0x2800 + value);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

const NEIGHBOR_CELL_SIZE = 3.2;
const NEIGHBOR_RADIUS = 4.4;
const SEPARATION_RADIUS = 1.45;

type SpatialHash = Map<string, number[]>;

function cellKey(x: number, y: number) {
  return `${Math.floor(x / NEIGHBOR_CELL_SIZE)},${Math.floor(y / NEIGHBOR_CELL_SIZE)}`;
}

function buildSpatialHash(particles: readonly Particle[]): SpatialHash {
  const hash: SpatialHash = new Map();
  particles.forEach((particle, index) => {
    const key = cellKey(particle.x, particle.y);
    const cell = hash.get(key);
    if (cell) cell.push(index);
    else hash.set(key, [index]);
  });
  return hash;
}

/** A seeded particle simulation: organic per session, reproducible when a seed is supplied. */
export class BrailleSwarm {
  private particles: Particle[] = [];
  private mood: Mood;
  private moodAge = 0;
  private motif: ToolMotif = "gear";
  private toolPlan: ToolVisualPlan = layoutToolExpression({ kind: "identity" });
  private toolSummary = "idle";
  private motifEcho = 0;
  private outputEnergy = 0;
  private voiceLevels = [0, 0, 0, 0, 0];
  private homeForm: SwarmHomeForm;
  private randomState: number;
  private readonly flowPhase: number;

  constructor(
    seed = Date.now() ^ Math.floor(Math.random() * 0xffffffff),
    mood: Mood = "idle",
    homeForm: SwarmHomeForm = "cat",
  ) {
    this.randomState = seed >>> 0 || 0x9e3779b9;
    this.flowPhase = this.randomState / 0x100000000 * Math.PI * 2;
    this.mood = mood;
    this.homeForm = homeForm;
    this.reset(mood);
  }

  private random() {
    let value = this.randomState;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value >>> 0;
    return this.randomState / 0x100000000;
  }

  private homeTargets(mood: Mood, tick: number) {
    if (this.homeForm === "emergent-face") {
      return scaleLegacyPoints(emergentHomePoints(mood, tick, this.outputEnergy));
    }
    return decodeBraille(brailleArtLines(mood, Math.floor(tick / 4)));
  }

  private coreTargets(mood: Mood, tick: number) {
    if (this.homeForm !== "emergent-face") return [];
    if (this.outputEnergy > 0.04 || mood === "waiting") {
      return scaleLegacyPoints(emergentFacePoints(mood, tick, this.outputEnergy).core);
    }
    return scaleLegacyPoints(identityConstellationPoints(tick));
  }

  private targets(mood: Mood, tick: number, forceMotif = false) {
    if (mood === "tool" || forceMotif) {
      return this.toolPlan.layers.length > 0 ? toolVisualPlanPoints(this.toolPlan, tick) : motifPoints(this.motif, tick);
    }
    return this.homeTargets(mood, tick);
  }

  reset(mood: Mood, tick = 0) {
    this.mood = mood;
    this.moodAge = 0;
    this.motifEcho = 0;
    this.outputEnergy = 0;
    this.voiceLevels.fill(0);
    const targets = this.targets(mood, tick);
    this.particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      const target = targets[Math.floor(index * targets.length / PARTICLE_COUNT)] ?? {
        x: BRAILLE_PIXEL_WIDTH / 2,
        y: BRAILLE_PIXEL_HEIGHT / 2,
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
        member: index % 5,
      };
    });
  }

  setHomeForm(homeForm: SwarmHomeForm) {
    if (homeForm === this.homeForm) return;
    this.homeForm = homeForm;
    this.moodAge = 0;
    for (const particle of this.particles) {
      particle.vx += (this.random() - 0.5) * 0.8;
      particle.vy += (this.random() - 0.5) * 0.8;
    }
  }

  pulseOutput(intensity = 1, members?: readonly number[]) {
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

  setToolExpression(expression: ToolExpression) {
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
      status: "active",
    });
  }

  finishTool(isError: boolean) {
    // Fast tools still get a visible afterimage long enough for the swarm to assemble.
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

  setMood(mood: Mood) {
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

  step(mood: Mood, tick: number, stepScale = 1) {
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
    const accelerations: Point[] = [];
    const noiseScale = Math.sqrt(scale);

    for (let index = 0; index < this.particles.length; index++) {
      const particle = this.particles[index];
      particle.phase += (0.045 + this.random() * 0.02) * scale;
      const persistentCore = visualTool && particle.core && faceCoreTargets.length > 0;
      const semanticPoints = persistentCore ? faceCoreTargets : targets;
      const probeIndex = Math.floor(((particle.role + particle.member * 0.173) % 1) * semanticPoints.length);
      const probe = semanticPoints[probeIndex] ?? semanticPoints[0];
      const distribution = persistentCore ? 0.18 : visualTool ? 0.48
        : this.outputEnergy > 0.04 || mood === "waiting" ? 0.28 : 0.08;
      const toolScout = visualTool && !particle.core && particle.role > 0.94;
      const toolStraggler = visualTool && !particle.core && particle.role > 0.86;
      const waitingToJoin = visualTool && !particle.core && this.moodAge <= particle.lag;

      let semanticStrength = persistentCore ? 0.22 : visualTool ? 0.255
        : this.outputEnergy > 0.04 || mood === "waiting" ? 0.125
          : mood === "error" ? 0.045 : mood === "sleep" ? 0.028 : 0.038;
      let semanticForce = contourField(particle, semanticPoints, probe, distribution, semanticStrength);

      if (toolScout) {
        const radius = 8 + particle.role * 4;
        const scoutTarget = {
          x: center.x + Math.cos(particle.phase + tick * 0.08) * radius,
          y: center.y + Math.sin(particle.phase + tick * 0.08) * radius * 0.65,
        };
        semanticForce = {
          x: (scoutTarget.x - particle.x) * semanticStrength * 0.58,
          y: (scoutTarget.y - particle.y) * semanticStrength * 0.58,
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
            if (distanceSquared <= 0.0001 || distanceSquared > NEIGHBOR_RADIUS * NEIGHBOR_RADIUS) continue;
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

      const flowStrength = visualTool ? 0.025 : mood === "thinking" ? 0.075
        : mood === "sleep" ? 0.018 : 0.052;
      const flow = curlField(particle, tick, this.flowPhase, flowStrength);

      const voiceLevel = this.voiceLevels[particle.member] ?? 0;
      const memberAngle = this.flowPhase + particle.member / 5 * Math.PI * 2 + tick * 0.018 * (particle.member % 2 ? -1 : 1);
      const voiceCenter = {
        x: BRAILLE_PIXEL_WIDTH / 2 + Math.cos(memberAngle) * 8.7,
        y: BRAILLE_PIXEL_HEIGHT / 2 + Math.sin(memberAngle) * 5.1,
      };
      const voice = vortexField(particle, voiceCenter, tick * 0.82 - particle.member * 1.7, voiceLevel);

      const separationWeight = visualTool ? 0.065 : 0.14;
      const alignmentWeight = visualTool ? 0.038 : 0.052;
      const neighborCohesionWeight = visualTool ? 0.014 : 0.014;
      const randomNoise = persistentCore ? 0.012 : mood === "thinking" ? 0.055
        : mood === "error" ? 0.085 : 0.035;
      accelerations.push({
        x: semanticForce.x
          + separationX * separationWeight
          + alignmentX * alignmentWeight
          + cohesionX * neighborCohesionWeight
          + flow.x + voice.x
          + (this.random() - 0.5) * randomNoise * noiseScale,
        y: semanticForce.y
          + separationY * separationWeight
          + alignmentY * alignmentWeight
          + cohesionY * neighborCohesionWeight
          + flow.y + voice.y
          + (this.random() - 0.5) * randomNoise * noiseScale,
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

  snapshot(): SwarmSnapshot {
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
        member: particle.member,
      })),
    };
  }

  faceLines(mood: Mood, tick = 0): string[] {
    this.setMood(mood);
    return swarmSnapshotFaceLines(this.snapshot(), mood, tick);
  }
}

export function swarmSnapshotFaceLines(
  snapshot: SwarmSnapshot,
  mood: Mood,
  tick = 0,
  label = LABELS[mood],
): string[] {
  const displayTick = Math.floor(Math.max(0, tick) / 4);
  const pulse = [".", "o", "O", "o"][displayTick % 4];
  const operatorName = snapshot.toolOperator === "sequence" ? "sequence"
    : snapshot.toolOperator === "parallel" ? "parallel"
      : snapshot.toolOperator === "nested" ? "nested"
        : snapshot.toolOperator === "failed" ? "failed" : "atom";
  const summary = snapshot.toolOperator === "parallel" && snapshot.toolSummary.startsWith("(")
    ? snapshot.toolSummary.slice(1, -1)
    : snapshot.toolSummary;
  const suffix = mood === "tool" ? `[${operatorName}: ${summary}]`
    : snapshot.echoActive ? `[${operatorName}: ${summary} · echo]`
      : snapshot.homeForm === "emergent-face"
        ? `[emergent face${snapshot.outputActive ? " speaking" : ""}]`
        : "[braille swarm]";
  const title = `pi face ${pulse} ${label} ${suffix}`;
  const face = encodeBraille(snapshot.particles.map((particle) => ({
    x: particle.x * (BRAILLE_PIXEL_WIDTH - 1),
    y: particle.y * (BRAILLE_PIXEL_HEIGHT - 1),
  })));
  const innerWidth = Math.max(title.length, ...face.map((line) => line.length));
  const top = `╭${"─".repeat(innerWidth + 2)}╮`;
  const bottom = `╰${"─".repeat(innerWidth + 2)}╯`;
  const row = (text: string) => `│ ${text.padEnd(innerWidth)} │`;
  return [top, row(title), ...face.map(row), bottom];
}
