/** Shared TypeScript types matching backend WebSocket and REST schemas. */

// ── Model info ──────────────────────────────────────────────────────────

export interface ModelInfo {
  name: string;
  num_layers: number;
  hidden_size: number;
  num_attention_heads: number;
  num_kv_heads: number;
  intermediate_size: number;
  vocab_size: number;
  total_params: string;
  device: string;
}

// ── Activation data ─────────────────────────────────────────────────────

export interface LayerData {
  layer_idx: number;
  residual?: {
    mean: number[];
    std: number[];
    max: number[];
    min: number[];
    heatmap: number[][];
  };
  mlp?: {
    mean: number[];
    std: number[];
    max: number[];
    l2_norm: number[];
    heatmap: number[][];
  };
  gate?: {
    firing_rate: number[];
    mean_activation: number[];
    max_activation: number[];
    heatmap: number[][];
    firing_heatmap: number[][];
  };
  attention?: {
    mean: number[];
    std: number[];
    l2_norm: number[];
    heatmap: number[][];
  };
}

export interface ActivationData {
  tokens: string[];
  num_layers: number;
  hidden_size: number;
  num_attention_heads: number;
  intermediate_size: number;
  layers: LayerData[];
  step?: number;
  all_tokens?: string[];
}

// ── Ablation ────────────────────────────────────────────────────────────

export interface LayerStat {
  layer_idx?: number;
  has_direction: boolean;
  cosine_sim: number;
  diff_norm: number;
  concept_norm: number;
  baseline_norm: number;
}

export interface AblationState {
  normalText: string;
  ablatedText: string;
  normalTokens: string[];
  ablatedTokens: string[];
  normalPrefill: ActivationData | null;
  ablatedPrefill: ActivationData | null;
  layerStats: Record<string, LayerStat>;
  concept: string;
  method: string;
  alpha: number;
}

// ── WebSocket messages ──────────────────────────────────────────────────

export type WSMessage =
  | { type: 'model_info'; data: ModelInfo }
  | { type: 'prefill'; data: ActivationData }
  | { type: 'token'; data: ActivationData }
  | { type: 'done'; all_tokens: string[] }
  | { type: 'complete'; all_tokens: string[]; text: string }
  | { type: 'error'; message: string }
  | {
      type: 'ablation_status';
      status: string;
      message: string;
      layer_stats?: Record<string, LayerStat>;
      method?: string;
      total_layers?: number;
    }
  | {
      type: 'ablation_normal';
      text: string;
      tokens: string[];
      prefill: ActivationData | null;
    }
  | {
      type: 'ablation_ablated';
      text: string;
      tokens: string[];
      prefill: ActivationData | null;
    }
  | {
      type: 'ablation_complete';
      concept: string;
      experiment_id?: number;
      normal_text: string;
      ablated_text: string;
      method: string;
      alpha: number;
      layers_affected: number;
      mean_cosine_sim: number;
      mean_diff_norm: number;
      concept_recall_normal?: number;
      concept_recall_ablated?: number;
      erasure_score?: number;
    };

// ── Experiments (REST API) ──────────────────────────────────────────────

export interface Experiment {
  id: number;
  model_name: string;
  model_backend: string;
  type: string;
  prompt: string;
  concept: string | null;
  alpha: number | null;
  max_tokens: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ExperimentResult {
  id: number;
  experiment_id: number;
  variant: string;
  output_text: string;
  tokens: string[];
  activations_path: string | null;
  metrics: Record<string, unknown>;
  created_at: string;
}

export interface ExperimentDetail {
  experiment: Experiment;
  results: ExperimentResult[];
  concept_directions: unknown[];
}
