/** Model selector — switch between local models and Modal remote. */

import { useState, useCallback } from 'react';
import { useAppStore } from '../../store';

const LOCAL_MODELS = [
  { name: 'Qwen/Qwen3-0.6B', label: 'Qwen3-0.6B (local)' },
  { name: 'openai-community/gpt2', label: 'GPT-2 (local)' },
  { name: 'meta-llama/Llama-3.2-1B', label: 'Llama-3.2-1B (local)' },
];

const MODAL_GPUS = ['T4', 'L4', 'A10', 'L40S', 'A100', 'H100'];

export function ModelSelector() {
  const modelInfo = useAppStore((s) => s.modelInfo);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const [selectedGpu, setSelectedGpu] = useState('L40S');

  const handleSwitch = useCallback(async (modelName: string, backendType: 'local' | 'modal', gpu?: string) => {
    setSwitching(true);
    setError('');
    try {
      const res = await fetch('/api/models/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: modelName, backend: backendType, gpu }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Switch failed');
      // Reconnect WebSocket to pick up new model
      const { ws } = useAppStore.getState();
      ws?.disconnect();
      setTimeout(() => {
        useAppStore.getState().init();
      }, 500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSwitching(false);
    }
  }, []);

  return (
    <div>
      <div className="section-title">Model</div>
      <div className="ablation-section">
        <select
          className="input-field"
          id="model-selector"
          style={{ width: '100%', marginBottom: 8 }}
          value={modelInfo?.name ?? ''}
          disabled={switching}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '__custom__') {
              setShowCustom(true);
            } else {
              setShowCustom(false);
              handleSwitch(val, 'local');
            }
          }}
        >
          {LOCAL_MODELS.map((m) => (
            <option key={m.name} value={m.name}>{m.label}</option>
          ))}
          <option value="__custom__">Custom (Modal GPU)...</option>
        </select>

        {showCustom && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              className="input-field"
              placeholder="HuggingFace model name"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
            />
            <div className="controls">
              <label>GPU:</label>
              <select
                value={selectedGpu}
                onChange={(e) => setSelectedGpu(e.target.value)}
              >
                {MODAL_GPUS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <button
                className="btn btn-primary"
                style={{ width: 'auto', padding: '6px 12px', fontSize: 11 }}
                disabled={switching || !customModel.trim()}
                onClick={() => handleSwitch(customModel, 'modal', selectedGpu)}
              >
                {switching ? 'Loading...' : 'Load on Modal'}
              </button>
            </div>
          </div>
        )}

        {switching && (
          <div style={{ fontSize: 11, color: 'var(--fire-warm)', marginTop: 4 }}>
            <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, marginRight: 6 }} />
            Switching model...
          </div>
        )}
        {error && (
          <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{error}</div>
        )}
      </div>
    </div>
  );
}
