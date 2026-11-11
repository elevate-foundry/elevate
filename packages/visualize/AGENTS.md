# Project Notes

## Running

```bash
source venv/bin/activate
python -m src.server  # serves on http://localhost:8765
```

For development with hot-reload frontend:
```bash
python -m src.server   # terminal 1
cd frontend && npm run dev  # terminal 2, open http://localhost:5173
```

## Testing

```bash
# Unit tests (no server needed, fast)
pytest tests/ --ignore=tests/test_e2e.py -v

# E2E tests (server must be running)
python -m src.server &
pytest tests/test_e2e.py -v

# All tests
python -m src.server &
pytest tests/ -v
```

86 total tests: 62 unit + 24 E2E.

## Architecture

Backend (`src/`):
- `server.py` - FastAPI + WebSocket orchestrator, REST API
- `processing.py` - Activation processing, heatmap downsampling
- `models/` - Model loading, hooks, architecture profiles (Qwen, Llama, GPT-2, Mistral)
- `ablation/` - Directional ablation, concept prompts, quality metrics, interference analysis
- `experiments/` - SQLite store, schemas, batch runner
- `modal_remote/` - Modal GPU worker + client for remote inference

Frontend (`frontend/`):
- React + TypeScript + Vite + Zustand
- Components: Layout (Header, Sidebar, MainPanel), Visualization (LayerHeatmap, FiringRateChart, NetworkView), Ablation (AblationPanel), Experiments (ExperimentHistory, BatchRunner, InterferenceMatrix), Controls (ModelSelector)
- Proxy config in vite.config.ts for dev server

## Key details

- Model: Qwen/Qwen3-0.6B (28 layers, hidden_size=1024, intermediate_size=3072)
- Device: MPS (Apple Metal) preferred, CPU fallback, CUDA supported
- Must load to CPU first then `.to(device)` to avoid MPS segfault
- Uses `local_files_only=True` + `dtype=torch.float32`
- Frontend build served from `frontend/dist/`, fallback to `static/index.html`
- E2E tests rely on specific DOM IDs — preserve them when editing components

## Build frontend

```bash
cd frontend && npm ci && npm run build
```

## Deploy Modal worker

```bash
pip install modal
modal setup
modal deploy src/modal_remote/gpu_worker.py
```
