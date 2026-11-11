/** Central app store using Zustand. */

import { create } from 'zustand';
import type {
  ModelInfo,
  ActivationData,
  AblationState,
  LayerStat,
  WSMessage,
} from '../api/types';
import { WebSocketClient } from '../api/websocket';

export type ConnectionStatus = 'connected' | 'disconnected' | 'loading';
export type ViewTab = 'heatmap' | 'firing' | 'network' | 'ablation' | 'batch' | 'interference' | 'experiments';
export type ColorScale = 'fire' | 'viridis' | 'plasma' | 'cool';

interface AppState {
  // Connection
  status: ConnectionStatus;
  ws: WebSocketClient | null;
  modelInfo: ModelInfo | null;

  // Generation
  generating: boolean;
  prefillData: ActivationData | null;
  tokenSteps: ActivationData[];
  allTokens: string[];
  selectedToken: number;

  // Visualization
  activeTab: ViewTab;
  colorScale: ColorScale;

  // Ablation
  ablating: boolean;
  ablation: AblationState;

  // Actions
  init: () => void;
  setStatus: (s: ConnectionStatus) => void;
  setActiveTab: (tab: ViewTab) => void;
  setColorScale: (scale: ColorScale) => void;
  setSelectedToken: (idx: number) => void;
  startGenerate: (prompt: string, maxTokens: number) => void;
  startAblate: (concept: string, prompt: string, maxTokens: number, alpha: number) => void;
  handleMessage: (msg: WSMessage) => void;
}

const DEFAULT_ABLATION: AblationState = {
  normalText: '',
  ablatedText: '',
  normalTokens: [],
  ablatedTokens: [],
  normalPrefill: null,
  ablatedPrefill: null,
  layerStats: {},
  concept: '',
  method: 'directional',
  alpha: 1.0,
};

export const useAppStore = create<AppState>((set, get) => ({
  status: 'disconnected',
  ws: null,
  modelInfo: null,

  generating: false,
  prefillData: null,
  tokenSteps: [],
  allTokens: [],
  selectedToken: -1,

  activeTab: 'heatmap',
  colorScale: 'fire',

  ablating: false,
  ablation: { ...DEFAULT_ABLATION },

  init: () => {
    const wsClient = new WebSocketClient(
      (msg) => get().handleMessage(msg),
      (status) => set({ status }),
    );
    set({ ws: wsClient });
    wsClient.connect();
  },

  setStatus: (s) => set({ status: s }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setColorScale: (scale) => set({ colorScale: scale }),
  setSelectedToken: (idx) => set({ selectedToken: idx }),

  startGenerate: (prompt, maxTokens) => {
    const { ws } = get();
    if (!ws?.isConnected) return;
    set({
      generating: true,
      prefillData: null,
      tokenSteps: [],
      allTokens: [],
      selectedToken: -1,
      status: 'loading',
    });
    ws.send({ type: 'generate', prompt, max_tokens: maxTokens });
  },

  startAblate: (concept, prompt, maxTokens, alpha) => {
    const { ws } = get();
    if (!ws?.isConnected) return;
    set({
      ablating: true,
      activeTab: 'ablation',
      status: 'loading',
      ablation: { ...DEFAULT_ABLATION, concept, alpha },
    });
    ws.send({ type: 'ablate', concept, prompt, max_tokens: maxTokens, alpha });
  },

  handleMessage: (msg) => {
    switch (msg.type) {
      case 'model_info':
        set({ modelInfo: msg.data });
        break;

      case 'prefill':
        set({
          prefillData: msg.data,
          allTokens: msg.data.tokens.slice(),
          tokenSteps: [],
        });
        break;

      case 'token':
        set((s) => ({
          tokenSteps: [...s.tokenSteps, msg.data],
          allTokens: msg.data.all_tokens?.slice() ?? s.allTokens,
        }));
        break;

      case 'done':
      case 'complete':
        set({ generating: false, status: 'connected' });
        break;

      case 'error':
        set({ generating: false, ablating: false, status: 'connected' });
        break;

      case 'ablation_status':
        if (msg.layer_stats) {
          set((s) => ({
            ablation: { ...s.ablation, layerStats: msg.layer_stats! },
          }));
        }
        break;

      case 'ablation_normal':
        set((s) => ({
          ablation: {
            ...s.ablation,
            normalText: msg.text,
            normalTokens: msg.tokens,
            normalPrefill: msg.prefill,
          },
        }));
        break;

      case 'ablation_ablated':
        set((s) => ({
          ablation: {
            ...s.ablation,
            ablatedText: msg.text,
            ablatedTokens: msg.tokens,
            ablatedPrefill: msg.prefill,
          },
        }));
        break;

      case 'ablation_complete':
        set((s) => ({
          ablating: false,
          status: 'connected',
          ablation: {
            ...s.ablation,
            concept: msg.concept,
            method: msg.method,
            alpha: msg.alpha,
          },
        }));
        break;
    }
  },
}));
