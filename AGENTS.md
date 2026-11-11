# Elevate Monorepo — Agent Coordination

## Workspace Map

```
elevate/
├── libs/braille/          # Canonical braille byte codec (Python + TS)
├── libs/audit/            # Hash-chained audit log (Python + TS)
├── libs/bbid/             # Braille Binary Identity (Python + TS + spec)
├── packages/cortex/       # LLM routing kernel (Python)
├── packages/famulus/      # Offline agent engine (Python)
├── packages/sal/          # Auth + tools + money service (Node.js)
├── packages/visualize/    # LLM neuron visualizer (Python + React)
├── packages/cerebellar/   # Multi-model braille consensus (Python/Streamlit)
├── packages/braille-bench/# Braille compression benchmarks (TypeScript)
├── packages/meta/         # Exposure toolkit + corpus builder + dashboard
└── papers/                # Whitepapers and specs
```

## Dependency Graph

```
libs/braille  <── libs/bbid
     ↑              ↑
     │              │
  ┌──┴──────────────┤
  │                 │
cortex  famulus  sal  cerebellar  braille-bench  visualize  meta
  │                                                          │
  └── libs/audit ←──────────────────────────────────────────┘
```

## Shared Libraries

When modifying shared code in `libs/`, check all consumers:
- `libs/braille/` → used by every package
- `libs/audit/`   → used by cortex, famulus, sal, braille-bench, meta
- `libs/bbid/`    → used by sal, cerebellar

## Package-Specific Notes

### packages/cortex
- Entry: `python -m src.daemon` (HTTP proxy on :11411)
- Tests: `pytest tests/ -v` (200+ tests)
- Has its own AGENTS.md written in SCL format
- `models/` directory is for runtime model downloads, not committed

### packages/famulus
- Entry: `famulus` CLI (via pyproject.toml entry point)
- Bootstrap: `bash bootstrap.sh` (cold-start from bare shell)
- Tests: `pytest tests/ -v`
- Zero third-party deps in Phase -1 (bootstrap)

### packages/sal
- Entry: `npm start` (Express on :3000)
- Tests: `npm test`
- Tauri desktop app in `src-tauri/` (build with `cargo tauri build`)

### packages/visualize
- Backend: `python -m src.server` (FastAPI on :8765)
- Frontend: `cd frontend && npm run dev` (Vite on :5173)
- Tests: `pytest tests/ -v` (86 tests: 62 unit + 24 E2E)
- E2E tests need server running

### packages/cerebellar
- Entry: `streamlit run app.py`
- Tests: `pytest tests/ -v`
- Requires API keys: `MAMMOUTH_API_KEY`, `OPENROUTER_API_KEY`

### packages/braille-bench
- Entry: `npm start` (Express + GraphQL on default port)
- Benchmarks: `npm run suite`
- Requires API keys for model providers

### packages/meta
- Exposure toolkit: `cd exposure-toolkit && ./exposure.sh help`
- Dashboard: `cd dashboard && npm install && npm run ingest && npm run dev`
- Corpus builder: `cd corpus-builder && ./clone.sh elevate-foundry`

## Common Commands

```bash
# Run all Python tests
for pkg in cortex famulus visualize cerebellar; do
  (cd packages/$pkg && pytest tests/ -v)
done

# Run all Node tests
for pkg in sal braille-bench; do
  (cd packages/$pkg && npm test)
done

# Build shared TS libs
for lib in braille audit bbid; do
  (cd libs/$lib/typescript && npm install && npm run build)
done
```

## Conventions

- Braille codec: always use `libs/braille/`, never reimplement
- Audit logs: always use `libs/audit/`, never reimplement
- BBID: always use `libs/bbid/`, never reimplement
- Model weights: never committed; downloaded at runtime
- Secrets: never in code; use env vars or `.env` files
- API keys: use `ELEVATE_*` prefix for shared config
