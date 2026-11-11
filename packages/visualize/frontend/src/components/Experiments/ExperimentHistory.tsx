import { useState, useEffect, useCallback } from 'react';
import { listExperiments, getExperiment, deleteExperiment, exportExperiment } from '../../api/rest';
import type { Experiment, ExperimentDetail } from '../../api/types';

export function ExperimentHistory() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState<ExperimentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'generation' | 'ablation'>('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const exps = await listExperiments({
        type: filter === 'all' ? undefined : filter,
        limit: 50,
      });
      setExperiments(exps);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSelect = async (exp: Experiment) => {
    const detail = await getExperiment(exp.id);
    setSelected(detail);
  };

  const handleDelete = async (id: number) => {
    if (!confirm(`Delete experiment #${id}?`)) return;
    await deleteExperiment(id);
    if (selected?.experiment.id === id) setSelected(null);
    refresh();
  };

  const handleExport = async (id: number) => {
    const data = await exportExperiment(id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `experiment-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* Left: list */}
      <div style={{ width: 300, overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['all', 'generation', 'ablation'] as const).map((f) => (
            <button
              key={f}
              className={`viz-tab${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
              style={{ padding: '4px 10px', fontSize: 11 }}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button
            className="viz-tab"
            onClick={refresh}
            style={{ padding: '4px 10px', fontSize: 11, marginLeft: 'auto' }}
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>

        {experiments.length === 0 && (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: 20 }}>
            No experiments yet
          </div>
        )}

        {experiments.map((exp) => (
          <div
            key={exp.id}
            className={`exp-item${selected?.experiment.id === exp.id ? ' selected' : ''}`}
            onClick={() => handleSelect(exp)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600 }}>#{exp.id}</span>
              <span style={{
                background: exp.type === 'ablation' ? 'rgba(239,68,68,0.2)' : 'rgba(99,102,241,0.2)',
                color: exp.type === 'ablation' ? 'var(--red)' : 'var(--accent)',
                padding: '1px 6px',
                borderRadius: 3,
                fontSize: 9,
              }}>
                {exp.type}
              </span>
            </div>
            <div style={{ color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {exp.prompt}
            </div>
            {exp.concept && (
              <div style={{ color: 'var(--fire-warm)', marginTop: 2, fontSize: 10 }}>
                concept: {exp.concept} | alpha: {exp.alpha}
              </div>
            )}
            <div style={{ color: 'var(--text-dim)', marginTop: 2, fontSize: 9 }}>
              {new Date(exp.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Right: detail */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!selected ? (
          <div className="empty-state" style={{ height: '100%' }}>
            <div className="icon" style={{ fontSize: 36 }}>&#128269;</div>
            <div>Select an experiment to view details</div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>
                Experiment #{selected.experiment.id}: {selected.experiment.type}
              </h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-primary"
                  style={{ width: 'auto', padding: '4px 12px', fontSize: 11 }}
                  onClick={() => handleExport(selected.experiment.id)}
                >
                  Export JSON
                </button>
                <button
                  className="btn btn-danger"
                  style={{ width: 'auto', padding: '4px 12px', fontSize: 11 }}
                  onClick={() => handleDelete(selected.experiment.id)}
                >
                  Delete
                </button>
              </div>
            </div>

            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12 }}>
              <div><strong>Model:</strong> {selected.experiment.model_name}</div>
              <div><strong>Prompt:</strong> {selected.experiment.prompt}</div>
              {selected.experiment.concept && (
                <>
                  <div><strong>Concept:</strong> {selected.experiment.concept}</div>
                  <div><strong>Alpha:</strong> {selected.experiment.alpha}</div>
                </>
              )}
              <div><strong>Max tokens:</strong> {selected.experiment.max_tokens}</div>
              <div><strong>Created:</strong> {new Date(selected.experiment.created_at).toLocaleString()}</div>
            </div>

            {selected.results.map((result) => (
              <div
                key={result.id}
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span
                    className="dot"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      display: 'inline-block',
                      background: result.variant === 'normal' ? 'var(--green)' : 'var(--red)',
                    }}
                  />
                  <strong style={{ fontSize: 12 }}>
                    {result.variant.charAt(0).toUpperCase() + result.variant.slice(1)}
                  </strong>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                  {result.output_text}
                </div>
                {result.metrics && Object.keys(result.metrics).length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(result.metrics).map(([k, v]) => (
                      <span key={k} style={{
                        background: 'var(--bg3)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        padding: '2px 6px',
                        fontSize: 10,
                        color: 'var(--text-dim)',
                      }}>
                        {k}: {typeof v === 'number' ? v.toFixed(4) : String(v)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
