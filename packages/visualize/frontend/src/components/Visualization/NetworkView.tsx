import { useRef, useEffect } from 'react';
import { useAppStore } from '../../store';
import { valueToColor } from '../../lib/colorScales';

export function NetworkView() {
  const prefillData = useAppStore((s) => s.prefillData);
  const colorScale = useAppStore((s) => s.colorScale);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !prefillData) return;
    const svg = svgRef.current;
    svg.innerHTML = '';

    const parentEl = svg.parentElement;
    if (!parentEl) return;
    const rect = parentEl.getBoundingClientRect();
    const width = rect.width - 40;
    const height = Math.max(600, prefillData.num_layers * 25 + 100);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const ns = 'http://www.w3.org/2000/svg';
    const numLayers = prefillData.num_layers;
    const layerHeight = (height - 80) / numLayers;
    const centerX = width / 2;
    const nodesPerLayer = 16;
    const nodeSpacing = Math.min(32, (width - 120) / nodesPerLayer);

    prefillData.layers.forEach((layer, layerIdx) => {
      const y = 40 + layerIdx * layerHeight;
      const startX = centerX - (nodesPerLayer / 2) * nodeSpacing;

      let firingValues: number[] | null = null;
      if (layer.gate?.heatmap) {
        const hm = layer.gate.heatmap;
        const nNeurons = hm[0].length;
        const avg = new Array(nNeurons).fill(0) as number[];
        hm.forEach((row) =>
          row.forEach((v, i) => {
            avg[i] += v;
          }),
        );
        for (let i = 0; i < nNeurons; i++) avg[i] /= hm.length;
        const chunk = Math.floor(nNeurons / nodesPerLayer);
        firingValues = [];
        for (let i = 0; i < nodesPerLayer; i++) {
          let sum = 0;
          for (let j = i * chunk; j < (i + 1) * chunk; j++) sum += Math.abs(avg[j]);
          firingValues.push(sum / chunk);
        }
      }

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', '10');
      label.setAttribute('y', String(y + 4));
      label.setAttribute('fill', '#8888a0');
      label.setAttribute('font-size', '9');
      label.textContent = `L${layerIdx}`;
      svg.appendChild(label);

      if (layer.gate?.firing_rate) {
        const rate =
          layer.gate.firing_rate.reduce((a, b) => a + b, 0) /
          layer.gate.firing_rate.length;
        const rateLabel = document.createElementNS(ns, 'text');
        rateLabel.setAttribute('x', String(width - 10));
        rateLabel.setAttribute('y', String(y + 4));
        rateLabel.setAttribute('fill', '#8888a0');
        rateLabel.setAttribute('font-size', '9');
        rateLabel.setAttribute('text-anchor', 'end');
        rateLabel.textContent = `${(rate * 100).toFixed(0)}%`;
        svg.appendChild(rateLabel);
      }

      for (let n = 0; n < nodesPerLayer; n++) {
        const cx = startX + n * nodeSpacing;
        const r = nodeSpacing * 0.35;
        let intensity = 0.1;
        if (firingValues) {
          const maxV = Math.max(...firingValues.map(Math.abs));
          intensity = maxV > 0 ? Math.abs(firingValues[n]) / maxV : 0;
        }

        if (intensity > 0.3) {
          const glow = document.createElementNS(ns, 'circle');
          glow.setAttribute('cx', String(cx));
          glow.setAttribute('cy', String(y));
          glow.setAttribute('r', String(r * (1 + intensity)));
          glow.setAttribute(
            'fill',
            valueToColor(intensity, 0, 1, colorScale),
          );
          glow.setAttribute('opacity', String(intensity * 0.3));
          svg.appendChild(glow);
        }

        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(y));
        circle.setAttribute('r', String(r));
        circle.setAttribute(
          'fill',
          valueToColor(intensity, 0, 1, colorScale),
        );
        circle.setAttribute(
          'stroke',
          intensity > 0.5
            ? valueToColor(intensity, 0, 1, colorScale)
            : '#2a2a3a',
        );
        circle.setAttribute('stroke-width', '0.5');
        circle.setAttribute('opacity', String(0.3 + intensity * 0.7));
        svg.appendChild(circle);
      }

      if (layerIdx < numLayers - 1) {
        const nextY = 40 + (layerIdx + 1) * layerHeight;
        for (let n = 0; n < nodesPerLayer; n += 3) {
          const line = document.createElementNS(ns, 'line');
          line.setAttribute('x1', String(startX + n * nodeSpacing));
          line.setAttribute('y1', String(y + nodeSpacing * 0.35));
          line.setAttribute('x2', String(startX + n * nodeSpacing));
          line.setAttribute('y2', String(nextY - nodeSpacing * 0.35));
          line.setAttribute('stroke', '#1a1a25');
          line.setAttribute('stroke-width', '0.5');
          svg.appendChild(line);
        }
      }
    });
  }, [prefillData, colorScale]);

  if (!prefillData) {
    return (
      <>
        <div className="empty-state" id="network-empty">
          <div className="icon">&#9881;</div>
          <div>
            Network view shows the model architecture with firing intensity
          </div>
        </div>
        <svg id="network-svg" style={{ display: 'none' }} />
      </>
    );
  }

  return (
    <>
      <div id="network-empty" style={{ display: 'none' }} />
      <svg id="network-svg" ref={svgRef} style={{ width: '100%' }} />
    </>
  );
}
