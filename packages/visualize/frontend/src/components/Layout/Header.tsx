import { useAppStore } from '../../store';

export function Header() {
  const status = useAppStore((s) => s.status);
  const modelInfo = useAppStore((s) => s.modelInfo);

  const badgeText = modelInfo
    ? `${modelInfo.name} | ${modelInfo.total_params} | ${modelInfo.device.toUpperCase()}`
    : 'Connecting...';

  return (
    <div className="header">
      <h1>Neuron Firing Visualizer</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className={`status-dot ${status}`} id="status-dot" />
        <span className="model-badge" id="model-badge">{badgeText}</span>
      </div>
    </div>
  );
}
