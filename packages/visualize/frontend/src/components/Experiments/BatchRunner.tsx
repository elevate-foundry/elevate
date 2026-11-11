import { useState, useCallback } from 'react';

interface BatchResult {
  concept: string;
  prompt: string;
  alpha: number;
  normal_text: string;
  ablated_text: string;
  concept_recall_normal: number;
  concept_recall_ablated: number;
  erasure_score: number;
  layers_affected: number;
  mean_cosine_sim: number;
  mean_diff_norm: number;
  experiment_id: number | null;
}

export function BatchRunner() {
  const [concepts, setConcepts] = useState('dog, cat, math');
  const [prompts, setPrompts] = useState('A dog is a wonderful pet because\nThe cat sat on the warm\nThe square root of 144 is');
  const [alphas, setAlphas] = useState('0.5, 1.0, 1.5');
  const [maxTokens, setMaxTokens] = useState(20);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [sortBy, setSortBy] = useState<'erasure_score' | 'concept' | 'alpha'>('erasure_score');
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setResults([]);
    setError(null);
    try {
      const res = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concepts: concepts.split(',').map((s) => s.trim()).filter(Boolean),
          prompts: prompts.split('\n').map((s) => s.trim()).filter(Boolean),
          alphas: alphas.split(',').map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n)),
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResults(data.results || []);
    } catch (e: any) {
      setError(e.message || 'Batch failed');
    } finally {
      setRunning(false);
    }
  }, [concepts, prompts, alphas, maxTokens]);

  const sorted = [...results].sort((a, b) => {
    if (sortBy === 'erasure_score') return b.erasure_score - a.erasure_score;
    if (sortBy === 'concept') return a.concept.localeCompare(b.concept);
    return a.alpha - b.alpha;
  });

  const handleExportCSV = () => {
    if (results.length === 0) return;
    const headers = ['concept', 'prompt', 'alpha', 'erasure_score', 'concept_recall_normal', 'concept_recall_ablated', 'layers_affected', 'mean_cosine_sim', 'normal_text', 'ablated_text'];
    const rows = results.map((r) =>
      headers.map((h) => {
        const v = (r as any)[h];
        return typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : String(v);
      }).join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'batch-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      {/* Config */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div className="section-title">Concepts (comma-separated)</div>
          <input className="input-field" value={concepts} onChange={(e) => setConcepts(e.target.value)} />
        </div>
        <div>
          <div className="section-title">Alpha values (comma-separated)</div>
          <input className="input-field" value={alphas} onChange={(e) => setAlphas(e.target.value)} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="section-title">Prompts (one per line)</div>
          <textarea
            className="prompt-area"
            value={prompts}
            onChange={(e) => setPrompts(e.target.value)}
            style={{ minHeight: 60 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className="btn btn-primary"
          style={{ width: 'auto', padding: '8px 20px' }}
          disabled={running}
          onClick={handleRun}
        >
          {running ? 'Running batch...' : 'Run Batch'}
        </button>
        {results.length > 0 && (
          <>
            <button
              className="btn btn-primary"
              style={{ width: 'auto', padding: '8px 20px', opacity: 0.8 }}
              onClick={handleExportCSV}
            >
              Export CSV
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>
              {results.length} results
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {(['erasure_score', 'concept', 'alpha'] as const).map((s) => (
                <button
                  key={s}
                  className={`viz-tab${sortBy === s ? ' active' : ''}`}
                  style={{ padding: '3px 8px', fontSize: 10 }}
                  onClick={() => setSortBy(s)}
                >
                  {s === 'erasure_score' ? 'Erasure' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Results table */}
      {results.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>Concept</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>Alpha</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>Erasure</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>Normal</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>Ablated</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{ color: 'var(--fire-warm)', fontWeight: 600 }}>{r.concept}</span>
                  </td>
                  <td style={{ padding: '6px 8px' }}>{r.alpha}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{
                      background: r.erasure_score > 0.5 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                      color: r.erasure_score > 0.5 ? 'var(--green)' : 'var(--red)',
                      padding: '1px 6px',
                      borderRadius: 3,
                    }}>
                      {(r.erasure_score * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>
                    {r.normal_text}
                  </td>
                  <td style={{ padding: '6px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>
                    {r.ablated_text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--red)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {running && results.length === 0 && (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
          <div>Running batch experiments...</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            This may take a while depending on the number of combinations
          </div>
        </div>
      )}

      {results.length === 0 && !running && (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="icon" style={{ fontSize: 36 }}>&#9881;</div>
          <div>Configure concepts, prompts, and alpha values above, then click Run Batch</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Runs ablation for every combination of concept x prompt x alpha
          </div>
        </div>
      )}
    </div>
  );
}
