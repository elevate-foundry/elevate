import { useAppStore, type ViewTab } from '../../store';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { LayerHeatmap } from '../Visualization/LayerHeatmap';
import { FiringRateChart } from '../Visualization/FiringRateChart';
import { NetworkView } from '../Visualization/NetworkView';
import { AblationPanel } from '../Ablation/AblationPanel';
import { ExperimentHistory } from '../Experiments/ExperimentHistory';
import { BatchRunner } from '../Experiments/BatchRunner';
import { InterferenceMatrix } from '../Experiments/InterferenceMatrix';

const TABS: { key: ViewTab; label: string }[] = [
  { key: 'heatmap', label: 'Layer Heatmap' },
  { key: 'firing', label: 'Firing Rate' },
  { key: 'network', label: 'Network View' },
  { key: 'ablation', label: 'Ablation' },
  { key: 'batch', label: 'Batch' },
  { key: 'interference', label: 'Interference' },
  { key: 'experiments', label: 'History' },
];

export function MainPanel() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <div className="viz-container">
      <div className="viz-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`viz-tab${activeTab === tab.key ? ' active' : ''}`}
            data-tab={tab.key}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="viz-panel" id="panel-heatmap" style={{ display: activeTab === 'heatmap' ? undefined : 'none' }}>
        <ErrorBoundary><LayerHeatmap /></ErrorBoundary>
      </div>
      <div className="viz-panel" id="panel-firing" style={{ display: activeTab === 'firing' ? undefined : 'none' }}>
        <ErrorBoundary><FiringRateChart /></ErrorBoundary>
      </div>
      <div className="viz-panel" id="panel-network" style={{ display: activeTab === 'network' ? undefined : 'none' }}>
        <ErrorBoundary><NetworkView /></ErrorBoundary>
      </div>
      <div className="viz-panel" id="panel-ablation" style={{ display: activeTab === 'ablation' ? undefined : 'none' }}>
        <ErrorBoundary><AblationPanel /></ErrorBoundary>
      </div>
      <div className="viz-panel" id="panel-batch" style={{ display: activeTab === 'batch' ? undefined : 'none' }}>
        <ErrorBoundary><BatchRunner /></ErrorBoundary>
      </div>
      <div className="viz-panel" id="panel-interference" style={{ display: activeTab === 'interference' ? undefined : 'none' }}>
        <ErrorBoundary><InterferenceMatrix /></ErrorBoundary>
      </div>
      <div className="viz-panel" id="panel-experiments" style={{ display: activeTab === 'experiments' ? undefined : 'none' }}>
        <ErrorBoundary><ExperimentHistory /></ErrorBoundary>
      </div>
    </div>
  );
}
