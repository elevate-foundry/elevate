# tools/braille

## Purpose
Canonical source of truth for elevate-foundry braille concepts.

## Files
- `contractions.json` — UEB grade-2 tables
- `contractions.mjs` — contraction/cell-count helpers
- `validate.mjs` — validation tooling
- `../braille8.mjs` — separate 8-dot byte/cell codec

## Conventions
- New code should import shared tables instead of duplicating them.
- Keep grade-2 contractions distinct from 8-dot lossless byte encoding.
