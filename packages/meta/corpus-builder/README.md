# corpus-builder

Builds an LLM training corpus from the **source code** of the native (non-fork)
public repositories under `github.com/elevate-foundry`, so a small open model can
be fine-tuned to "speak elevate-foundry."

> Forks (`ray`, `openclaw`, `opencode`) are excluded by default — their code is
> upstream authors', not the org's voice.

## Pipeline

```
clone.sh ──► repos/<repo>/        shallow (depth 1) clones of native repos
extract.mjs ──► out/corpus.jsonl  filtered, deduped source text (one file per line)
              out/stats.json      token estimate + per-lang/per-repo breakdown
push_hf.py ──► Hugging Face dataset
```

Every clone is recorded in the SOC 2 audit trail at
`out/audit/corpus_audit.jsonl` (hash-chained, verifiable with the toolkit's
`audit_verify`).

## Usage

```bash
./clone.sh elevate-foundry        # depth-1 clone of native repos
node extract.mjs                  # build out/corpus.jsonl + out/stats.json

# inspect
cat out/stats.json | jq '{files, totalBytes, estTokensHuman, byLang}'

# publish (needs a write token)
pip install huggingface_hub
export HF_TOKEN=hf_xxx
python push_hf.py --repo-id elevate-foundry/elevate-corpus   # private by default
```

### Options

| Var / flag | Where | Meaning |
|------------|-------|---------|
| `INCLUDE_FORKS=1` | `clone.sh` | also clone fork repos |
| `MAX_KB=N` | `clone.sh` | skip repos whose GitHub diskUsage exceeds N KB |
| `MAX_FILE_BYTES=N` | `extract.mjs` | per-file size cap (default 512 KB) |
| `--public` | `push_hf.py` | make the HF dataset public (default private) |

## Current snapshot

29 native repos → **1,007 files / ~11 MB / ~2.76M tokens** (Python-heavy). Big
binary/data files (e.g. in `salutations`) are filtered out by the source-extension
allowlist and binary detection.

## Filtering

`extract.mjs` keeps an allowlist of source/text extensions and drops:
`node_modules`, `dist`, `build`, `target`, `vendor`, `venv`, `__pycache__`, etc.;
lockfiles and minified/`.map` files; files >512 KB; and anything containing NUL
bytes (binary). Records are deduplicated by SHA-256 of file content.

## Next step: fine-tune

The corpus is LoRA-ready. A typical run (separate, GPU-bearing environment):
pack `corpus.jsonl` `text` fields, then LoRA fine-tune a small base model
(e.g. Qwen2.5-1.5B or Llama-3.2-1B). Keep a held-out split for eval.
