import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import type { ColorScale } from '../../store';
import { valueToColor } from '../../lib/colorScales';
import { showTooltip, hideTooltip } from '../shared/Tooltip';
import type { WSMessage, LayerData } from '../../api/types';

interface LogEntry {
  message: string;
  status: string;
}

export function AblationPanel() {
  const ablation = useAppStore((s) => s.ablation);
  const ablating = useAppStore((s) => s.ablating);
  const colorScale = useAppStore((s) => s.colorScale);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [hasContent, setHasContent] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const heatmapsRef = useRef<HTMLDivElement>(null);
  const neuronMapRef = useRef<HTMLDivElement>(null);

  // Subscribe to store messages for log accumulation
  useEffect(() => {
    const origHandler = useAppStore.getState().handleMessage;
    const wrappedHandler = (msg: WSMessage) => {
      if (msg.type === 'ablation_status') {
        setHasContent(true);
        setLogEntries((prev) => [
          ...prev,
          { message: msg.message, status: msg.status },
        ]);
      } else if (msg.type === 'ablation_complete') {
        setLogEntries((prev) => [
          ...prev,
          {
            message: `Done! Directional ablation on ${msg.layers_affected} layers (alpha=${msg.alpha}, cos_sim=${msg.mean_cosine_sim}, diff_norm=${msg.mean_diff_norm}${msg.erasure_score !== undefined ? `, erasure=${(msg.erasure_score * 100).toFixed(0)}%` : ''})`,
            status: 'complete',
          },
        ]);
      }
      origHandler(msg);
    };
    useAppStore.setState({ handleMessage: wrappedHandler });
    return () => {
      useAppStore.setState({ handleMessage: origHandler });
    };
  }, []);

  // Clear log when a new ablation starts
  useEffect(() => {
    if (ablating) {
      setLogEntries([]);
      setHasContent(true);
    }
  }, [ablating]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logEntries]);

  // Render neuron map (layer chips)
  useEffect(() => {
    if (!neuronMapRef.current) return;
    const map = neuronMapRef.current;
    map.innerHTML = '';
    const stats = ablation.layerStats;
    if (!stats || !Object.keys(stats).length) return;

    const norms = Object.values(stats).map((s) => s.diff_norm);
    const maxNorm = Math.max(...norms, 0.001);

    const sortedEntries = Object.entries(stats).sort(
      (a, b) => +a[0] - +b[0],
    );
    for (const [layerIdx, data] of sortedEntries) {
      const chip = document.createElement('div');
      chip.className = 'layer-chip';
      const intensity = data.diff_norm / maxNorm;
      if (intensity > 0.5) chip.classList.add('hot');
      chip.textContent = `L${layerIdx}`;
      if (intensity > 0.3) {
        chip.style.borderColor = valueToColor(intensity, 0, 1, colorScale);
        chip.style.background = `rgba(239, 68, 68, ${intensity * 0.15})`;
      }
      chip.addEventListener('mouseenter', (e: MouseEvent) => {
        showTooltip(
          e,
          `
          <div class="tt-title">Layer ${layerIdx}</div>
          <div>Direction norm: ${data.diff_norm.toFixed(4)}</div>
          <div>Cosine sim (concept vs baseline): ${data.cosine_sim.toFixed(4)}</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
            Concept mean norm: ${data.concept_norm.toFixed(2)} |
            Baseline mean norm: ${data.baseline_norm.toFixed(2)}
          </div>
        `,
        );
      });
      chip.addEventListener('mouseleave', hideTooltip);
      map.appendChild(chip);
    }
  }, [ablation.layerStats, colorScale]);

  // Render heatmap comparison
  useEffect(() => {
    if (!heatmapsRef.current) return;
    const container = heatmapsRef.current;
    container.innerHTML = '';
    const normalPrefill = ablation.normalPrefill;
    const ablatedPrefill = ablation.ablatedPrefill;
    if (!normalPrefill || !ablatedPrefill) return;

    const numLayers = normalPrefill.num_layers;
    for (let layerIdx = 0; layerIdx < numLayers; layerIdx++) {
      const normalLayer = normalPrefill.layers[layerIdx];
      const ablatedLayer = ablatedPrefill.layers[layerIdx];

      const row = document.createElement('div');
      row.className = 'layer-row';

      const label = document.createElement('div');
      label.className = 'layer-label';
      label.textContent = `L${layerIdx}`;

      const ls = ablation.layerStats[String(layerIdx)];
      if (ls?.has_direction) {
        const allNorms = Object.values(ablation.layerStats).map(
          (s) => s.diff_norm,
        );
        const maxN = Math.max(...allNorms, 0.001);
        const intensity = ls.diff_norm / maxN;
        if (intensity > 0.3) {
          label.style.color = 'var(--red)';
          label.style.fontWeight = '700';
        }
      }
      row.appendChild(label);

      const pair = document.createElement('div');
      pair.className = 'heatmap-pair';
      pair.style.flex = '1';

      pair.appendChild(
        makeHeatmapCanvas(normalLayer, layerIdx, 'normal', colorScale),
      );
      pair.appendChild(
        makeHeatmapCanvas(ablatedLayer, layerIdx, 'ablated', colorScale),
      );

      row.appendChild(pair);
      container.appendChild(row);
    }
  }, [ablation.normalPrefill, ablation.ablatedPrefill, ablation.layerStats, colorScale]);

  const statusIcons: Record<string, string> = {
    probing:
      '<span class="spinner" style="width:10px;height:10px;border-width:1.5px;"></span>',
    found: '<span style="color:var(--fire-warm);">&#9733;</span>',
    generating_normal:
      '<span class="spinner" style="width:10px;height:10px;border-width:1.5px;"></span>',
    generating_ablated:
      '<span class="spinner" style="width:10px;height:10px;border-width:1.5px;"></span>',
    complete: '<span style="color:var(--green);">&#10003;</span>',
  };

  if (!hasContent) {
    return (
      <>
        <div className="empty-state" id="ablation-empty">
          <div className="icon">&#9881;</div>
          <div>
            Enter a concept and click &quot;Ablate &amp; Compare&quot; to erase
            it via directional ablation
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Projects out the concept&apos;s direction in residual space at each
            layer (Heretic-style abliteration)
          </div>
        </div>
        <div id="ablation-content" style={{ display: 'none' }}>
          <div className="ablation-log" id="ablation-log" />
          <div style={{ marginTop: 16 }}>
            <div className="section-title">Concept Direction (per layer)</div>
            <div className="neuron-map" id="neuron-map" />
          </div>
          <div className="side-by-side" style={{ marginTop: 16 }}>
            <div className="comparison-panel">
              <h3>
                <span className="dot" style={{ background: 'var(--green)' }} />{' '}
                Normal Output
              </h3>
              <div className="output-text" id="normal-output">
                ...
              </div>
            </div>
            <div className="comparison-panel">
              <h3>
                <span className="dot" style={{ background: 'var(--red)' }} />{' '}
                Ablated Output
              </h3>
              <div className="output-text" id="ablated-output">
                ...
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="section-title">
              Activation Comparison (per layer)
            </div>
            <div className="side-by-side" style={{ marginBottom: 8 }}>
              <div className="heatmap-pair-label">Normal</div>
              <div className="heatmap-pair-label">Ablated</div>
            </div>
            <div id="ablation-heatmaps" />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div id="ablation-empty" style={{ display: 'none' }} />
      <div id="ablation-content">
        <div className="ablation-log" id="ablation-log" ref={logRef}>
          {logEntries.map((entry, i) => (
            <div key={i} className="log-entry">
              <span
                className="log-icon"
                dangerouslySetInnerHTML={{
                  __html: statusIcons[entry.status] || '&#8226;',
                }}
              />
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="section-title">Concept Direction (per layer)</div>
          <div className="neuron-map" id="neuron-map" ref={neuronMapRef} />
        </div>
        <div className="side-by-side" style={{ marginTop: 16 }}>
          <div className="comparison-panel">
            <h3>
              <span className="dot" style={{ background: 'var(--green)' }} />{' '}
              Normal Output
            </h3>
            <div className="output-text" id="normal-output">
              {ablation.normalText || '...'}
            </div>
          </div>
          <div className="comparison-panel">
            <h3>
              <span className="dot" style={{ background: 'var(--red)' }} />{' '}
              Ablated Output
            </h3>
            <div className="output-text" id="ablated-output">
              {ablation.ablatedText || '...'}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="section-title">Activation Comparison (per layer)</div>
          <div className="side-by-side" style={{ marginBottom: 8 }}>
            <div className="heatmap-pair-label">Normal</div>
            <div className="heatmap-pair-label">Ablated</div>
          </div>
          <div id="ablation-heatmaps" ref={heatmapsRef} />
        </div>
      </div>
    </>
  );
}

function makeHeatmapCanvas(
  layerData: LayerData,
  layerIdx: number,
  label: string,
  colorScale: ColorScale,
): HTMLCanvasElement {
  let heatmap: number[][] | null = null;
  if (layerData.gate?.heatmap) heatmap = layerData.gate.heatmap;
  else if (layerData.mlp?.heatmap) heatmap = layerData.mlp.heatmap;
  else if (layerData.residual?.heatmap) heatmap = layerData.residual.heatmap;

  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '14px';
  canvas.style.borderRadius = '2px';
  canvas.style.imageRendering = 'pixelated';

  if (!heatmap || !heatmap.length) {
    canvas.width = 1;
    canvas.height = 1;
    return canvas;
  }

  const nNeurons = heatmap[0].length;
  const values = new Array(nNeurons).fill(0) as number[];
  heatmap.forEach((row) =>
    row.forEach((v, i) => {
      values[i] += v;
    }),
  );
  for (let i = 0; i < nNeurons; i++) values[i] /= heatmap.length;

  canvas.width = nNeurons;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  const absValues = values.map(Math.abs);
  const vMin = Math.min(...absValues);
  const vMax = Math.max(...absValues);

  values.forEach((v, i) => {
    ctx.fillStyle = valueToColor(Math.abs(v), vMin, vMax, colorScale);
    ctx.fillRect(i, 0, 1, 1);
  });

  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const neuronIdx = Math.floor(
      ((e.clientX - rect.left) / rect.width) * nNeurons,
    );
    const val = values[Math.min(neuronIdx, nNeurons - 1)];
    showTooltip(
      e,
      `
      <div class="tt-title">${label} - Layer ${layerIdx}</div>
      <div>Neuron group: ${neuronIdx}/${nNeurons}</div>
      <div>Value: ${val.toFixed(4)}</div>
    `,
    );
  });
  canvas.addEventListener('mouseleave', hideTooltip);

  return canvas;
}
