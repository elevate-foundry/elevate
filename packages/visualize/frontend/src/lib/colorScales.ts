/** Color scale functions matching the original D3-based color schemes. */

import * as d3 from 'd3';
import type { ColorScale } from '../store';

export function getColorInterpolator(scale: ColorScale) {
  switch (scale) {
    case 'fire':
      return (t: number) => d3.interpolateRgb('#000', '#ff4500')(t);
    case 'viridis':
      return d3.interpolateViridis;
    case 'plasma':
      return d3.interpolatePlasma;
    case 'cool':
      return d3.interpolateCool;
  }
}

export function valueToColor(value: number, min: number, max: number, scale: ColorScale): string {
  const range = max - min;
  if (range === 0) return '#000';
  const t = Math.max(0, Math.min(1, (value - min) / range));
  return getColorInterpolator(scale)(t);
}
