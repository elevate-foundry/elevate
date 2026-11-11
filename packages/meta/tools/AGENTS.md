# tools

## Purpose
Shared utilities and specs used across the elevate-foundry workspace.

## Subareas
- `braille/` — canonical braille data and JS helpers
- `manifest/` — signed manifest spec, generator, verifier
- top-level scripts — repo fusion, README refresh, constellation utilities

## Conventions
- Prefer central shared definitions here over re-declaring org-wide concepts elsewhere.
- If another component depends on a tool contract, update its docs when the contract changes.

## Gotchas
- `braille/` covers grade-2 contraction logic; `braille8.mjs` is separate 8-dot byte encoding.
- Manifest files are meant to be agent-readable and cryptographically verifiable.
