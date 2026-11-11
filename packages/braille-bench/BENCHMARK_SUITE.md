# Benchmark Suite

This project now includes a repeatable benchmark suite for testing Braille Code Encoding (BCE) across model pairs, tasks, trials, and output formats.

## What it measures

For each `(encoder, decoder, task, trial)` case, the suite records:

- Baseline model output
- Encoded braille payload
- Decoded reconstruction
- Braille cell count
- Compression ratio vs baseline text
- Compression ratio vs original prompt
- Provider token counts when available
- Encode/decode latency
- Heuristic fidelity via normalized word overlap
- Exact normalized match
- LaTeX compile success for LaTeX tasks
- Error/refusal rate

Outputs are saved to `results/` as:

- `suite-<id>.json` — full structured result
- `suite-<id>.jsonl` — one result per line
- `suite-<id>.csv` — case-level rows for spreadsheets
- `suite-<id>-summary.csv` — aggregate table by task kind and model pair

Model-call metadata is logged append-only to:

- `audit/model-calls-YYYY-MM-DD.jsonl`

Raw request/response payloads are written separately to:

- `results/raw/<trace-number>-input.json`
- `results/raw/<trace-number>-output.json`

Each model call receives a check-number-style trace number:

```text
BCE-<suite>-<run>-T<trial>-<task>-<phase>-<random>
```

Example phases:

- `baseline`
- `encode`
- `decode`
- `judge`

The case-level JSON and CSV include `trace_numbers` and `audit_paths`, allowing every metric row to be traced back to the exact request/response record. Audit records include provider, model, role, input/output SHA-256 hashes, redacted previews, raw payload paths, token counts, latency, timestamp, and error text if present. API keys and provider secrets are not logged.

## Smoke test

Fastest sanity check: one pair, one task, one trial.

```bash
npx tsx scripts/run-suite.ts --trials=1 --max-pairs=1 --tasks=prose_photosynthesis --include-latex=false
```

## Shared codec mode

Use the deterministic shared codec to measure the upper-bound architecture: both sides share the same codebook, encoding uses longest-match replacement, and decoding expands cells exactly.

```bash
npx tsx scripts/run-suite.ts --codec=shared --trials=1 --max-pairs=1 --tasks=prose_photosynthesis,latex_paper --include-latex=true
```

This mode is no-cost except for local compute because it does not call external models for encode/decode. It is the right baseline for optimal compression with perfect codec agreement.

## Paper-scale run

A practical run for the white paper: 3 trials, first 5 reliable pairs, all tasks including LaTeX.

```bash
npx tsx scripts/run-suite.ts --trials=3 --max-pairs=5 --include-latex=true
```

## Larger run

More expensive but better evidence: 5 trials across all default pairs.

```bash
npx tsx scripts/run-suite.ts --trials=5 --include-latex=true
```

## Selected task run

```bash
npx tsx scripts/run-suite.ts --trials=3 --max-pairs=4 --tasks=prose_photosynthesis,structured_planets,latex_minimal
```

## API endpoint

If the server is running on port `3900`, POST to:

```bash
curl -s http://localhost:3900/api/experiment/suite \
  -H "Content-Type: application/json" \
  -d '{"trials":1,"maxPairs":1,"taskIds":["prose_photosynthesis"],"includeLatex":false}'
```

## Current default model-pair selection

The suite prefers practical/reliable pairs:

- Claude Haiku -> Gemini 2.5 Flash
- Claude Haiku -> Claude Haiku
- Claude Sonnet -> Gemini 2.5 Flash
- Gemini 2.5 Flash -> Claude Haiku
- Gemini 2.0 Flash -> Gemini 2.5 Flash
- Claude Opus 4.5 -> Claude Haiku
- Mistral Large -> Gemini 2.5 Flash

OpenAI models are intentionally not prioritized while the key is quota-limited.

## Interpreting results

Strong evidence requires:

- `success_rate` close to 1.0
- `avg_compression_vs_baseline` > 1.0
- `avg_fidelity` high enough for the task type
- low error/refusal rate
- LaTeX `compile_success_rate` near 1.0 for structural claims

The heuristic fidelity metric is intentionally cheap and imperfect. For a publication-grade run, add an LLM judge pass or human evaluation on a stratified sample.
