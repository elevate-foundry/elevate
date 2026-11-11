# LLM Neuron Firing Visualizer

Interactive visualization of neuron activations and directional ablation for language models. Watch neurons fire in real-time, surgically erase concepts using Heretic-style directional ablation, run batch experiments, and analyze concept interference.

## Features

- **Neuron firing visualization** - Real-time heatmaps of gate activations across all layers during generation
- **Firing rate analysis** - D3.js bar charts showing per-layer activation rates with error bars
- **Network view** - SVG architecture diagram with firing intensity overlaid
- **Directional ablation** - Erase arbitrary concepts (dog, math, love, ...) by projecting out their direction in residual space, side-by-side comparison of normal vs ablated output
- **Batch experiments** - Run ablation across multiple concepts x prompts x alpha values in one click
- **Concept interference** - Cosine similarity matrix showing how concept directions overlap (per-layer or averaged)
- **Experiment history** - Browse, export (JSON/CSV), and compare past experiments from SQLite store
- **Model switching** - Switch between local models or run large models on Modal.com GPUs
- **Quality metrics** - Automatic concept recall and erasure score computation

## How directional ablation works

Based on [Arditi et al. 2024](https://arxiv.org/abs/2406.11717) ("Refusal in Language Models Is Mediated by a Single Direction") and [Heretic](https://github.com/p-e-w/heretic):

1. Run concept-related prompts ("The dog is", "A dog can", ...) and baseline prompts through the model
2. Collect residual stream activations at each layer
3. Compute the **concept direction** = `normalize(mean_concept - mean_baseline)` per layer
4. During generation, **project out** that direction: `h' = h - alpha * (h . d) * d`

This removes the concept from the model's representations while preserving everything orthogonal to it.

## Quick start

```bash
# Clone and set up
git clone https://github.com/elevate-foundry/visualize-llm.git
cd visualize-llm
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Build frontend
cd frontend && npm ci && npm run build && cd ..

# Run (downloads model on first run)
python -m src.server
# Open http://localhost:8765
```

### Docker

```bash
docker compose up --build
# Open http://localhost:8765
```

### Development (hot reload)

```bash
# Terminal 1: Backend
python -m src.server

# Terminal 2: Frontend dev server (proxies to backend)
cd frontend && npm run dev
# Open http://localhost:5173
```

## Usage

1. **Generate & Visualize** - Enter a prompt and see neuron activations across all layers
2. **Ablate & Compare** - Enter a concept to erase, adjust alpha (0-2), see side-by-side output
3. **Batch** - Run ablation across multiple concepts/prompts/alphas, export results as CSV
4. **Interference** - See which concepts share direction space (high overlap = risky co-ablation)
5. **History** - Browse past experiments, export JSON, compare results

## Architecture

```
src/
  server.py              # FastAPI + WebSocket orchestrator
  processing.py          # Activation processing + heatmap downsampling
  models/
    loader.py            # LocalModelBackend + ModelBackend interface
    hooks.py             # HookManager (activation capture + ablation hooks)
    profiles.py          # Architecture profiles (Qwen, Llama, GPT-2, Mistral)
  ablation/
    directional.py       # Concept direction computation
    prompts.py           # Concept/baseline prompt generation
    metrics.py           # KL divergence, concept recall, direction stats
    interference.py      # Pairwise concept direction similarity
  experiments/
    store.py             # SQLite experiment persistence
    schemas.py           # Pydantic schemas
    batch.py             # Batch experiment runner
  modal_remote/
    gpu_worker.py        # Modal GPU worker (remote inference)
    client.py            # ModalModelBackend (same interface as local)
frontend/
  src/
    store/index.ts       # Zustand state management
    api/                 # WebSocket + REST clients, TypeScript types
    components/
      Layout/            # Header, Sidebar, MainPanel
      Visualization/     # LayerHeatmap, FiringRateChart, NetworkView
      Ablation/          # AblationPanel
      Experiments/       # ExperimentHistory, BatchRunner, InterferenceMatrix
      Controls/          # ModelSelector
      shared/            # Tooltip, StatCard
tests/
  test_e2e.py            # 24 Playwright E2E tests
  test_profiles.py       # 12 model profile tests
  test_hooks.py          # 9 hook manager tests
  test_processing.py     # 11 activation processing tests
  test_ablation.py       # 15 ablation/metrics tests
  test_store.py          # 15 experiment store tests
```

## Testing

```bash
# Unit tests (fast, no model needed)
pytest tests/ --ignore=tests/test_e2e.py -v

# E2E tests (requires running server)
python -m src.server &
pytest tests/test_e2e.py -v
```

86 total tests: 62 unit + 24 E2E.

## Modal (remote GPU inference)

For models too large to run locally:

```bash
pip install modal
modal setup  # authenticate
modal deploy src/modal_remote/gpu_worker.py

# In the UI, use the Model Selector dropdown -> "Custom (Modal GPU)"
# Choose a GPU tier and enter a HuggingFace model name
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_NAME` | `Qwen/Qwen3-0.6B` | HuggingFace model to load |
| `DEVICE` | `auto` | `auto`, `mps`, `cuda`, or `cpu` |
| `DB_PATH` | `data/experiments.db` | SQLite database path |
| `LOCAL_FILES_ONLY` | `true` | Skip network calls for model weights |

## Example results

**Ablating "dog" (alpha=1.0)**:
- Normal: "A dog is a wonderful pet because it is so much more than just a dog. It is a companion, a friend, and a"
- Ablated: "A dog is a wonderful pet because it is made of a number of pieces. A piece is made of a number of pieces."

**Ablating "math" (alpha=0.5)**:
- Normal: "The square root of 144 is 12. So, the square root of 144 is 12."
- Ablated: "The square root of 144 is a number that...? The square root of 144 is a number that...?"

## References

- Arditi et al., "Refusal in Language Models Is Mediated by a Single Direction", NeurIPS 2024
- [Heretic](https://github.com/p-e-w/heretic) - Automatic directional ablation for censorship removal
- [LEACE](https://arxiv.org/abs/2306.03819) - Closed-form concept erasure
- PISCES (EMNLP 2025) - Precise concept erasure using feature decomposition
- DOGE (EMNLP 2025) - Direction-guided unlearning

## License

MIT
