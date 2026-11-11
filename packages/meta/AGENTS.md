# elevate-foundry workspace

## Purpose
This workspace contains tools for measuring public repo exposure, building an org corpus, and publishing a dashboard over the results.

## Read this first
1. `AGENTS.md` (this file)
2. `build.md`
3. Component-local `AGENTS.md` or `README.md`

## Workspace map
- `exposure-toolkit/` — Bash toolkit for traffic, forks, Common Crawl, canaries, and scans.
- `dashboard/` — Next.js static dashboard over toolkit output.
- `corpus-builder/` — clones native org repos and extracts source into a training corpus.
- `tools/` — shared scripts, braille utilities, manifest tooling.
- `exposure-output/` — generated output; treat as data/artifacts, not hand-edited source.

## Shared conventions
- Prefer reading generated artifacts instead of editing them by hand.
- Keep the distinction clear: exposure/propagation evidence is not proof of training inclusion.
- Use native elevate-foundry repos by default; forks are excluded unless explicitly requested.
- When changing data flow, update both producer and consumer docs.

## Common commands
```bash
# exposure toolkit
( cd exposure-toolkit && ./exposure.sh help )

# dashboard
( cd dashboard && npm install && npm run ingest && npm run dev )

# corpus builder
( cd corpus-builder && ./clone.sh elevate-foundry && node extract.mjs )
```

## Cross-component flow
`exposure-toolkit/exposure-output` -> `dashboard/scripts/ingest.mjs` -> `dashboard/data/snapshot.json`

`corpus-builder/clone.sh` -> `corpus-builder/repos/` -> `extract.mjs` -> `out/corpus.jsonl`

## Gotchas
- `dashboard` build does not run ingest; commit `data/snapshot.json` after refreshing locally.
- `traffic` requires authenticated GitHub CLI access with owner visibility.
- `corpus-builder/finetune` needs a separate CUDA environment.
- Large generated directories may exist locally (`node_modules`, `.next`, cloned repos, output artifacts); avoid noisy commits.
