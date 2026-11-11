import { useRef, useEffect } from 'react';
import { useAppStore } from '../../store';
import { valueToColor } from '../../lib/colorScales';
import { showTooltip, hideTooltip } from '../shared/Tooltip';

export function LayerHeatmap() {
  const prefillData = useAppStore((s) => s.prefillData);
  const selectedToken = useAppStore((s) => s.selectedToken);
  const colorScale = useAppStore((s) => s.colorScale);
  const allTokens = useAppStore((s) => s.allTokens);
  const legendRef = useRef<HTMLCanvasElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);

  // Draw legend gradient
  useEffect(() => {
    if (!legendRef.current || !prefillData) return;
    const ctx = legendRef.current.getContext('2d');
    if (!ctx) return;
    for (let x = 0; x < 120; x++) {
      ctx.fillStyle = valueToColor(x / 119, 0, 1, colorScale);
      ctx.fillRect(x, 0, 1, 10);
    }
  }, [prefillData, colorScale]);

  // Render layer heatmaps
  useEffect(() => {
    if (!layersRef.current || !prefillData) return;
    const container = layersRef.current;
    container.innerHTML = '';

    prefillData.layers.forEach((layer, layerIdx) => {
      const row = document.createElement('div');
      row.className = 'layer-row';

      const label = document.createElement('div');
      label.className = 'layer-label';
      label.textContent = `L${layerIdx}`;
      row.appendChild(label);

      let heatmap: number[][] | null = null;
      let source = '';
      if (layer.gate?.heatmap) {
        heatmap = layer.gate.heatmap;
        source = 'gate (SwiGLU)';
      } else if (layer.mlp?.heatmap) {
        heatmap = layer.mlp.heatmap;
        source = 'MLP output';
      } else if (layer.residual?.heatmap) {
        heatmap = layer.residual.heatmap;
        source = 'residual stream';
      }

      if (!heatmap) {
        const noData = document.createElement('div');
        noData.style.cssText = 'color:var(--text-dim);font-size:11px;';
        noData.textContent = 'No data';
        row.appendChild(noData);
        container.appendChild(row);
        return;
      }

      let values: number[];
      const tokenIdx = selectedToken;
      if (tokenIdx >= 0 && tokenIdx < heatmap.length) {
        values = heatmap[tokenIdx];
      } else {
        const nNeurons = heatmap[0].length;
        values = new Array(nNeurons).fill(0) as number[];
        heatmap.forEach((tokenRow) =>
          tokenRow.forEach((v, i) => {
            values[i] += v;
          }),
        );
        values = values.map((v) => v / heatmap!.length);
      }

      const absValues = values.map(Math.abs);
      const vMin = Math.min(...absValues);
      const vMax = Math.max(...absValues);

      const heatmapDiv = document.createElement('div');
      heatmapDiv.className = 'heatmap-row';

      const canvas = document.createElement('canvas');
      canvas.width = values.length;
      canvas.height = 1;
      canvas.style.width = '100%';
      canvas.style.height = '16px';
      canvas.style.borderRadius = '2px';
      canvas.style.imageRendering = 'pixelated';
      const ctx = canvas.getContext('2d')!;
      values.forEach((v, i) => {
        ctx.fillStyle = valueToColor(Math.abs(v), vMin, vMax, colorScale);
        ctx.fillRect(i, 0, 1, 1);
      });

      const srcCopy = source;
      const layerIdxCopy = layerIdx;
      const valuesCopy = values;
      canvas.addEventListener('mousemove', (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const neuronIdx = Math.floor(
          ((e.clientX - rect.left) / rect.width) * valuesCopy.length,
        );
        const val = valuesCopy[Math.min(neuronIdx, valuesCopy.length - 1)];
        showTooltip(
          e,
          `
          <div class="tt-title">Layer ${layerIdxCopy} - ${srcCopy}</div>
          <div>Neuron group: ${neuronIdx}/${valuesCopy.length}</div>
          <div>Value: ${val.toFixed(4)}</div>
          <div>|Value|: ${Math.abs(val).toFixed(4)}</div>
        `,
        );
      });
      canvas.addEventListener('mouseleave', hideTooltip);

      heatmapDiv.appendChild(canvas);
      row.appendChild(heatmapDiv);

      if (layer.gate?.firing_rate) {
        const rateArr = layer.gate.firing_rate;
        const rate =
          tokenIdx >= 0 && tokenIdx < rateArr.length
            ? rateArr[tokenIdx]
            : rateArr.reduce((a, b) => a + b, 0) / rateArr.length;
        const rateDiv = document.createElement('div');
        rateDiv.style.cssText =
          'font-size:10px;color:var(--text-dim);width:42px;text-align:right;flex-shrink:0;';
        rateDiv.textContent = (rate * 100).toFixed(0) + '%';
        row.appendChild(rateDiv);
      }

      container.appendChild(row);
    });
  }, [prefillData, selectedToken, colorScale]);

  if (!prefillData) {
    return (
      <>
        <div className="empty-state" id="heatmap-empty">
          <div className="icon">&#9881;</div>
          <div>
            Enter a prompt and click Generate to visualize neuron activations
          </div>
        </div>
        <div id="heatmap-content" style={{ display: 'none' }}>
          <div className="legend" id="heatmap-legend" />
          <div id="heatmap-layers" />
        </div>
      </>
    );
  }

  const tokenLabel =
    selectedToken >= 0
      ? `Token "${allTokens[selectedToken]?.trim()}"`
      : 'All tokens (mean)';

  return (
    <>
      <div id="heatmap-empty" style={{ display: 'none' }} />
      <div id="heatmap-content">
        <div className="legend" id="heatmap-legend">
          <span>Low</span>
          <canvas
            ref={legendRef}
            width={120}
            height={10}
            style={{ borderRadius: 3 }}
          />
          <span>High</span>
          <span style={{ marginLeft: 16 }}>Showing: {tokenLabel}</span>
        </div>
        <div id="heatmap-layers" ref={layersRef} />
      </div>
    </>
  );
}
