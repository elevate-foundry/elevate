# Elevate

Consolidated monorepo for the [Elevate Foundry](https://github.com/elevate-foundry) ecosystem — local-first LLM orchestration, braille-native encoding, and multi-model consensus.

## Architecture

```
elevate/
├── libs/                    # Shared libraries (used by all packages)
│   ├── braille/             # Canonical braille byte codec (Python + TypeScript)
│   ├── audit/               # Tamper-evident hash-chained audit log
│   └── bbid/                # Braille Binary Identity (spec + implementations)
│
├── packages/                # Application packages
│   ├── cortex/              # AI-native OS kernel — LLM routing, SCL protocol, CKM
│   ├── famulus/             # Offline-first agent engine — bootstrap, consent gates
│   ├── sal/                 # Auth + tools + money service with BBID identity
│   ├── visualize/           # LLM neuron firing visualizer + ablation
│   ├── cerebellar/          # Multi-model braille consensus (artificial cerebellar loop)
│   ├── braille-bench/       # Braille compression benchmarks
│   └── meta/                # Exposure toolkit, corpus builder, dashboard
│
└── papers/                  # Whitepapers and formal specifications
```

## Packages

| Package | Language | What it does |
|---------|----------|-------------|
| **cortex** | Python | LLM inference router with tiered model selection (L0-L7), cross-family verification (challenger/swarm), SCL protocol, braille fingerprints, gossip sync, and a self-training Cortex Kernel Model (CKM). Includes bootable USB variant. |
| **famulus** | Python | Offline-by-default agent engine wrapping Ollama. Model horserace scheduling, consent-bound tool execution (READ/WRITE/EXEC tiers), cold-start bootstrap from bare POSIX shell, behavioral model probing. |
| **sal** | Node.js | Named local system identity ("Sal") implementing PAES permissions, auth (email/phone/BBID), double-entry money ledger, webhooks, tool harness, and multi-model braiding with Ollama + OpenRouter. |
| **visualize** | Python + React | Interactive neuron-firing visualizer for small LLMs. Real-time activation heatmaps, directional ablation (concept erasure), batch experiments, interference analysis. |
| **cerebellar** | Python (Streamlit) | Bio-inspired multi-model consensus where ~16 LLMs communicate exclusively in 8-dot braille, converging through cerebellar feedback loops. Includes BBID handshake, sonification, and consensus-gated tool execution. |
| **braille-bench** | TypeScript | Benchmarking suite for 8-dot braille compression. Tests LLM encode/decode via braille cells, measures fidelity and compression ratio across model pairs. Includes deterministic "Cerebraille" codec with GraphQL API. |
| **meta** | Bash + Node.js | Exposure measurement toolkit (traffic, forks, Common Crawl, canaries), org corpus builder with LoRA fine-tuning, and Next.js evidence dashboard. |

## Shared Libraries

| Library | Purpose | Used by |
|---------|---------|---------|
| **libs/braille** | Bijective byte-to-braille codec (U+2800-U+28FF), fingerprints, dot patterns | All packages |
| **libs/audit** | Hash-chained JSONL audit log with HMAC, sequence gaps, verification | cortex, famulus, sal, braille-bench, meta |
| **libs/bbid** | Braille Binary Identity — generation, signing, haptics, visit tracking | sal, cerebellar |

## Quick Start

### Python packages (cortex, famulus, visualize, cerebellar)

```bash
cd packages/cortex
python -m venv .venv && source .venv/bin/activate
pip install -e ../../libs/braille/python
pip install -e ../../libs/audit/python
pip install -e ../../libs/bbid/python
# then install package-specific deps
```

### Node.js packages (sal, braille-bench, meta/dashboard)

```bash
cd packages/sal
npm install
# shared libs are linked via workspace protocol or local paths
```

### Visualizer

```bash
cd packages/visualize
source .venv/bin/activate
python -m src.server        # Backend on :8765
cd frontend && npm run dev  # Frontend on :5173
```

## Key Concepts

### Braille-as-bytes

All 256 byte values (0x00-0xFF) map bijectively to Unicode Braille characters (U+2800-U+28FF). One byte = one cell = 3 UTF-8 bytes. This encoding is used for:
- Binary fingerprints of SCL records and audit entries
- Multi-model consensus voting (dot-level agreement)
- BBID identity encoding
- Token-efficient binary data in LLM prompts

### Multi-model consensus

Multiple approaches to the same problem — asking several models and synthesizing:
- **cortex**: Tiered routing (L0-L7) + challenger verification + swarm voting
- **famulus**: Model horserace with behavioral probing
- **cerebellar**: Braille-space consensus with cerebellar feedback loops
- **sal**: 6-model racing with response braiding

### SCL (Semantic Compression Language)

Wire protocol for cortex: `@anchor -> verb [key: value, ...]`. Used for routing decisions, agent state, audit events, and multi-agent gossip. Self-hosting: the coordination file (AGENTS.md) is written in SCL.

### Tamper-evident audit

SHA-256 (or HMAC-SHA256) hash-chained JSONL logs with sequence numbers, actor identity, and chain verification. Implements SOC 2-style technical controls.
