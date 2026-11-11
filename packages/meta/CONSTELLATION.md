# elevate-foundry constellation

## Components

### exposure-toolkit
- Role: collects evidence of repo exposure and propagation.
- Inputs: GitHub API/CLI, Common Crawl, search terms, canary metadata.
- Outputs: `exposure-toolkit/exposure-output/**`

### dashboard
- Role: visualizes the latest toolkit snapshot.
- Inputs: toolkit output via `scripts/ingest.mjs`
- Outputs: static `data/snapshot.json`, Next.js site
- Depends on: `exposure-toolkit`

### corpus-builder
- Role: clones native repos and extracts source into a deduped training corpus.
- Inputs: public elevate-foundry repos
- Outputs: `out/corpus.jsonl`, `out/stats.json`, audit log

### tools
- Role: shared scripts and specifications.
- Includes:
  - `braille/` canonical braille tables and JS APIs
  - `manifest/` signed repo manifest spec + generators/verifiers
  - repo utility scripts

## Operating rule
If a task touches one component only, work in that component's local context first.
If it crosses components, update docs at both the source and sink.
