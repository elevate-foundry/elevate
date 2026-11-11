// Braille rendering for Agent Face / Pi Face.
// Uses U+2800-U+28FF (same encoding as libs/braille/) to draw pixel art
// in terminal. The 8-dot cell layout maps 2x4 pixel blocks to single
// braille characters — the shared codec's BRAILLE_BASE (0x2800) is the
// same constant used here.

import type { Mood } from "./face.ts";
import { LABELS } from "./face.ts";

export const BRAILLE_PIXEL_WIDTH = 48;
export const BRAILLE_PIXEL_HEIGHT = 32;
const WIDTH = BRAILLE_PIXEL_WIDTH;
const HEIGHT = BRAILLE_PIXEL_HEIGHT;
const TAU = Math.PI * 2;

class Pixels {
  private readonly values = new Set<number>();

  set(x: number, y: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) this.values.add(y * WIDTH + x);
  }

  has(x: number, y: number) {
    return this.values.has(y * WIDTH + x);
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
      if (x0 === x1 && y0 === y1) return;
      const twice = error * 2;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  }

  quadratic(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) {
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

  arc(cx: number, cy: number, rx: number, ry: number, start = 0, end = TAU) {
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
}

function drawEyes(pixels: Pixels, mood: Mood, frame: number, shift: number) {
  const point = (x: number, y: number) => pixels.set(x + shift, y);
  const line = (x0: number, y0: number, x1: number, y1: number) =>
    pixels.line(x0 + shift, y0, x1 + shift, y1);
  const curve = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) =>
    pixels.quadratic(x0 + shift, y0, cx + shift, cy, x1 + shift, y1);
  const openEye = (x: number, glance: number) => {
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
    line(14, 11, 20, 15); line(20, 11, 14, 15);
    line(28, 11, 34, 15); line(34, 11, 28, 15);
  } else {
    const glance = mood === "thinking" ? [-1, 1, 0, -1][frame % 4] : [0, 1, 0, -1][frame % 4];
    openEye(17, glance);
    openEye(31, glance);
    if (mood === "thinking") curve(14, 9, 17, 8, 20, 9);
  }

  if (mood === "happy") {
    point(12, 17 + frame % 2); point(36, 17 + frame % 2);
  }
}

function drawCat(mood: Mood, tick: number): Pixels {
  const frame = Math.max(0, Math.floor(tick));
  const pixels = new Pixels();
  const shift = mood === "error" && frame < 2 ? (frame === 0 ? -1 : 1) : 0;
  const point = (x: number, y: number) => pixels.set(x + shift, y);
  const line = (x0: number, y0: number, x1: number, y1: number) =>
    pixels.line(x0 + shift, y0, x1 + shift, y1);
  const curve = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) =>
    pixels.quadratic(x0 + shift, y0, cx + shift, cy, x1 + shift, y1);

  // A high-resolution portrait: tapered ears, soft cheeks, chin, shoulders, and chest.
  curve(7, 15, 8, 8, 10, 2);
  line(10, 2, 18, 8);
  curve(18, 8, 24, 5, 30, 8);
  line(30, 8, 38, 2);
  curve(38, 2, 40, 8, 41, 15);
  curve(41, 15, 41, 21, 35, 24);
  curve(35, 24, 30, 27, 24, 27);
  curve(24, 27, 18, 27, 13, 24);
  curve(13, 24, 7, 21, 7, 15);

  // Inner ears and brow line keep the silhouette light rather than blocky.
  curve(11, 10, 12, 6, 12, 5); line(12, 5, 16, 9);
  curve(37, 10, 36, 6, 36, 5); line(36, 5, 32, 9);

  drawEyes(pixels, mood, frame, shift);

  // Nose, split muzzle, and whiskers use long shallow curves.
  line(22, 17, 24, 19); line(24, 19, 26, 17); line(22, 17, 26, 17);
  line(24, 19, 24, 20);
  curve(24, 20, 21, 23, 18, 20);
  curve(24, 20, 27, 23, 30, 20);
  point(15, 18); point(15, 21); point(33, 18); point(33, 21);
  curve(14, 18, 8, 16, 2, 17);
  curve(14, 22, 8, 24, 3, 23);
  curve(34, 18, 40, 16, 46, 17);
  curve(34, 22, 40, 24, 45, 23);

  // Bust and chest fit beneath the face without making the portrait heavy.
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
    // Slim keyboard with alternating paws.
    curve(12, 27, 24, 25, 36, 27);
    line(12, 27, 13, 31); line(36, 27, 35, 31); line(13, 31, 35, 31);
    for (let x = 16; x <= 32; x += 4) point(x, 29);
    if (frame % 2 === 0) { curve(16, 25, 18, 28, 20, 29); curve(32, 25, 30, 28, 28, 29); }
    else { curve(17, 26, 20, 28, 22, 29); curve(31, 26, 28, 28, 26, 29); }
  } else if (mood === "happy") {
    line(10, 25, 7, 23); line(38, 25, 41, 23);
    point(9, 28 + frame % 2); point(39, 28 + frame % 2);
  } else if (mood === "error") {
    line(22, 24, 24, 25); line(24, 25, 26, 24);
  } else if (mood === "sleep") {
    const rise = frame % 2;
    line(39, 17 - rise, 46, 17 - rise); line(46, 17 - rise, 40, 12 - rise); line(40, 12 - rise, 46, 12 - rise);
    line(36, 9 - rise, 40, 9 - rise); line(40, 9 - rise, 37, 6 - rise); line(37, 6 - rise, 40, 6 - rise);
  } else if (mood === "waiting") {
    const handX = [42, 44, 40][frame % 3];
    curve(32, 27, 36, 24, 37, 20);
    curve(37, 20, handX, 16, handX, 11);
    line(handX, 11, handX - 2, 8);
  } else if (mood === "cancelled" && frame === 0) {
    line(12, 28, 6, 25); line(36, 28, 42, 25);
  }

  return pixels;
}

const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

function toBraille(pixels: Pixels): string[] {
  const lines: string[] = [];
  for (let y = 0; y < HEIGHT; y += 4) {
    let line = "";
    for (let x = 0; x < WIDTH; x += 2) {
      let value = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (pixels.has(x + dx, y + dy)) value |= DOTS[dy][dx];
        }
      }
      line += value === 0 ? " " : String.fromCodePoint(0x2800 + value);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function brailleArtLines(mood: Mood, tick = 0): string[] {
  return toBraille(drawCat(mood, Math.max(0, Math.floor(tick))));
}

export function brailleFaceLines(mood: Mood, tick = 0, label = LABELS[mood]): string[] {
  const step = Math.max(0, Math.floor(tick));
  const pulse = [".", "o", "O", "o"][step % 4];
  const title = `pi face ${pulse} ${label} · [braille]`;
  const face = brailleArtLines(mood, step);
  const innerWidth = Math.max(title.length, ...face.map((line) => line.length));
  const top = `╭${"─".repeat(innerWidth + 2)}╮`;
  const bottom = `╰${"─".repeat(innerWidth + 2)}╯`;
  const row = (text: string) => `│ ${text.padEnd(innerWidth)} │`;
  return [top, row(title), ...face.map(row), bottom];
}
