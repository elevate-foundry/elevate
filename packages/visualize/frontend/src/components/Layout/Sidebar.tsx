import { useState, useMemo, useCallback } from 'react';
import { useAppStore, type ColorScale } from '../../store';
import { ModelSelector } from '../Controls/ModelSelector';

export function Sidebar() {
  const status = useAppStore((s) => s.status);
  const modelInfo = useAppStore((s) => s.modelInfo);
  const generating = useAppStore((s) => s.generating);
  const ablating = useAppStore((s) => s.ablating);
  const allTokens = useAppStore((s) => s.allTokens);
  const selectedToken = useAppStore((s) => s.selectedToken);
  const prefillData = useAppStore((s) => s.prefillData);
  const colorScale = useAppStore((s) => s.colorScale);
  const startGenerate = useAppStore((s) => s.startGenerate);
  const startAblate = useAppStore((s) => s.startAblate);
  const setSelectedToken = useAppStore((s) => s.setSelectedToken);
  const setColorScale = useAppStore((s) => s.setColorScale);

  const [prompt, setPrompt] = useState('A dog is a wonderful pet because');
  const [maxTokens, setMaxTokens] = useState(20);
  const [concept, setConcept] = useState('dog');
  const [alpha, setAlpha] = useState(1.0);

  const isConnected = status === 'connected' || status === 'loading';
  const isBusy = generating || ablating;

  const handleGenerate = useCallback(() => {
    if (!isConnected || isBusy || !prompt.trim()) return;
    startGenerate(prompt, maxTokens);
  }, [isConnected, isBusy, prompt, maxTokens, startGenerate]);

  const handleAblate = useCallback(() => {
    if (!isConnected || isBusy || !concept.trim() || !prompt.trim()) {
      if (!concept.trim() || !prompt.trim()) alert('Enter both a concept and a prompt');
      return;
    }
    startAblate(concept, prompt, maxTokens, alpha);
  }, [isConnected, isBusy, concept, prompt, maxTokens, alpha, startAblate]);

  // Compute stats
  const avgFiring = useMemo(() => {
    if (!prefillData) return '-';
    let total = 0, count = 0;
    prefillData.layers.forEach((l) => {
      if (l.gate?.firing_rate) {
        l.gate.firing_rate.forEach((r) => { total += r; count++; });
      }
    });
    return count > 0 ? (total / count * 100).toFixed(1) + '%' : '-';
  }, [prefillData]);

  return (
    <div className="sidebar">
      <ModelSelector />
      <div>
        <div className="section-title">Prompt</div>
        <textarea
          className="prompt-area"
          id="prompt-input"
          placeholder="Enter a prompt to see neurons fire..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      <div className="controls">
        <label>Tokens:</label>
        <input
          type="range"
          id="max-tokens"
          min={1}
          max={64}
          value={maxTokens}
          onChange={(e) => setMaxTokens(Number(e.target.value))}
        />
        <span id="max-tokens-val">{maxTokens}</span>
      </div>

      <button
        className="btn btn-primary"
        id="generate-btn"
        disabled={!isConnected || isBusy}
        onClick={handleGenerate}
      >
        {generating ? 'Generating...' : 'Generate & Visualize'}
      </button>

      <div>
        <div className="section-title">Ablation</div>
        <div className="ablation-section">
          <div className="controls" style={{ marginBottom: 8 }}>
            <label>Erase concept:</label>
            <input
              className="input-field"
              id="ablate-concept"
              value={concept}
              placeholder="e.g. dog, math, love"
              style={{ flex: 1 }}
              onChange={(e) => setConcept(e.target.value)}
            />
          </div>
          <div className="controls" style={{ marginBottom: 8 }}>
            <label>Strength (alpha):</label>
            <input
              type="range"
              id="ablate-alpha"
              min={0}
              max={2.0}
              step={0.1}
              value={alpha}
              style={{ flex: 1 }}
              onChange={(e) => setAlpha(Number(e.target.value))}
            />
            <span id="ablate-alpha-val">{alpha.toFixed(1)}</span>
          </div>
          <button
            className="btn btn-danger"
            id="ablate-btn"
            disabled={!isConnected || isBusy}
            onClick={handleAblate}
          >
            {ablating ? 'Ablating...' : 'Ablate & Compare'}
          </button>
        </div>
      </div>

      <div>
        <div className="section-title">Generated Output</div>
        <div className="token-stream" id="token-stream">
          {allTokens.length === 0 ? (
            <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>Output will appear here...</span>
          ) : (
            allTokens.map((tok, i) => (
              <span
                key={i}
                className={`token${i === selectedToken ? ' active' : ''}`}
                onClick={() => {
                  setSelectedToken(i);
                  const sel = document.getElementById('token-select') as HTMLSelectElement;
                  if (sel) sel.value = String(i);
                }}
              >
                {tok}
              </span>
            ))
          )}
        </div>
      </div>

      <div>
        <div className="section-title">Statistics</div>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Layers</div>
            <div className="stat-value" id="stat-layers">{modelInfo?.num_layers ?? '-'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Hidden Size</div>
            <div className="stat-value" id="stat-hidden">{modelInfo?.hidden_size ?? '-'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Firing</div>
            <div className="stat-value" id="stat-firing">{avgFiring}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Tokens</div>
            <div className="stat-value" id="stat-tokens">{allTokens.length || '-'}</div>
          </div>
        </div>
      </div>

      <div>
        <div className="section-title">View Controls</div>
        <div className="controls">
          <label>Token:</label>
          <select
            id="token-select"
            value={selectedToken}
            onChange={(e) => setSelectedToken(Number(e.target.value))}
          >
            <option value={-1}>All tokens</option>
            {allTokens.map((tok, i) => (
              <option key={i} value={i}>{`${i}: "${tok.trim() || '\\n'}"`}</option>
            ))}
          </select>
        </div>
        <div className="controls" style={{ marginTop: 8 }}>
          <label>Color scale:</label>
          <select
            id="color-scale"
            value={colorScale}
            onChange={(e) => setColorScale(e.target.value as ColorScale)}
          >
            <option value="fire">Fire</option>
            <option value="viridis">Viridis</option>
            <option value="plasma">Plasma</option>
            <option value="cool">Cool</option>
          </select>
        </div>
      </div>
    </div>
  );
}
