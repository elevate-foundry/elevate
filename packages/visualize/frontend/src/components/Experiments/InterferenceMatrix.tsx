import { useState, useCallback } from 'react';
import { valueToColor } from '../../lib/colorScales';
import { useAppStore } from '../../store';
import { showTooltip, hideTooltip } from '../shared/Tooltip';

interface InterferenceData {
  concepts: string[];
  matrix: number[][];
  per_layer_matrices: Record<string, number[][]>;
  direction_norms: Record<string, number[]>;
}

export function InterferenceMatrix() {
  const colorScale = useAppStore((s) => s.colorScale);
  const [concepts, setConcepts] = useState('dog, cat, math, love, science');
  const [data, setData] = useState<InterferenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCompute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/interference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concepts: concepts.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      const result = await res.json();
      setData(result);
      setSelectedLayer(null);
    } catch (e: any) {
      setError(e.message || 'Computation failed');
    } finally {
      setLoading(false);
    }
  }, [concepts]);

  const matrix = data
    ? selectedLayer !== null && data.per_layer_matrices[String(selectedLayer)]
      ? data.per_layer_matrices[String(selectedLayer)]
      : data.matrix
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="input-field"
          style={{ flex: 1 }}
          value={concepts}
          onChange={(e) => setConcepts(e.target.value)}
          placeholder="Concepts, comma-separated"
        />
        <button
          className="btn btn-primary"
          style={{ width: 'auto', padding: '8px 16px' }}
          disabled={loading}
          onClick={handleCompute}
        >
          {loading ? 'Computing...' : 'Compute'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--red)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {data && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            className={`viz-tab${selectedLayer === null ? ' active' : ''}`}
            style={{ padding: '3px 8px', fontSize: 10 }}
            onClick={() => setSelectedLayer(null)}
          >
            All (mean)
          </button>
          {Object.keys(data.per_layer_matrices).sort((a, b) => +a - +b).map((l) => (
            <button
              key={l}
              className={`viz-tab${selectedLayer === +l ? ' active' : ''}`}
              style={{ padding: '3px 8px', fontSize: 10 }}
              onClick={() => setSelectedLayer(+l)}
            >
              L{l}
            </button>
          ))}
        </div>
      )}

      {matrix && data && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ padding: '6px 8px', color: 'var(--text-dim)', fontWeight: 500 }} />
                {data.concepts.map((c) => (
                  <th key={c} style={{ padding: '6px 8px', color: 'var(--accent)', fontWeight: 600, textAlign: 'center', minWidth: 60 }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.concepts.map((rowConcept, i) => (
                <tr key={rowConcept}>
                  <td style={{ padding: '6px 8px', color: 'var(--accent)', fontWeight: 600 }}>
                    {rowConcept}
                  </td>
                  {matrix[i].map((val, j) => {
                    const absVal = Math.abs(val);
                    const bg = i === j
                      ? 'var(--bg3)'
                      : valueToColor(absVal, 0, 1, colorScale);
                    return (
                      <td
                        key={j}
                        style={{
                          padding: '6px 8px',
                          textAlign: 'center',
                          background: bg,
                          color: absVal > 0.5 && i !== j ? 'white' : 'var(--text)',
                          fontWeight: absVal > 0.5 ? 700 : 400,
                          cursor: 'default',
                          border: '1px solid var(--border)',
                        }}
                        onMouseEnter={(e) => {
                          if (i !== j) {
                            showTooltip(e, `
                              <div class="tt-title">${rowConcept} vs ${data!.concepts[j]}</div>
                              <div>Cosine similarity: ${val.toFixed(4)}</div>
                              <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
                                ${absVal > 0.7 ? 'High interference risk!' : absVal > 0.4 ? 'Moderate overlap' : 'Low interference'}
                              </div>
                            `);
                          }
                        }}
                        onMouseLeave={hideTooltip}
                      >
                        {i === j ? '-' : val.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Legend */}
          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-dim)' }}>
            <strong>Interpretation:</strong> Values near 0 = independent concepts. Values near 1 = highly overlapping directions (erasing one will affect the other).
            Negative values = anti-correlated (erasing one may enhance the other).
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="icon" style={{ fontSize: 36 }}>&#9881;</div>
          <div>Enter concepts and click Compute to see how their directions overlap</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            High similarity means erasing one concept risks affecting another
          </div>
        </div>
      )}
    </div>
  );
}
