# corpus-builder

## Purpose
Build a deduped source-code corpus from native `elevate-foundry` public repos for analysis and fine-tuning.

## Key files
- `clone.sh` — shallow-clones native repos into `repos/`
- `extract.mjs` — filters/dedupes source files into `out/corpus.jsonl` and `out/stats.json`
- `push_hf.py` — publishes the dataset to Hugging Face
- `finetune/` — optional LoRA training workflow in a GPU environment

## Common commands
```bash
./clone.sh elevate-foundry
node extract.mjs
python push_hf.py --repo-id elevate-foundry/elevate-corpus
```

## Conventions
- Exclude forks by default.
- Treat `out/` and `repos/` as generated artifacts.
- Preserve audit logging when changing clone/extract behavior.

## Gotchas
- Large repos and binary files are intentionally filtered.
- Local machine here is not suitable for GPU fine-tuning; use `finetune/` elsewhere.
