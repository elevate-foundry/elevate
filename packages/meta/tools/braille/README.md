# Braille — canonical org module

Single source of truth for braille concepts used across elevate-foundry.

## Layout

| File | Purpose |
| --- | --- |
| `contractions.json` | Canonical UEB grade-2 tables: strong/lower groupsigns & wordsigns, alphabetic wordsigns, shortforms, indicators. Data only — language-agnostic. |
| `contractions.mjs` | JS API over the JSON: `contractWord`, `contractText`, `cellCount`, dot/cell converters. |
| `../braille8.mjs` | 8-dot **uncontracted** byte↔cell codec (BIFM-256 fingerprints). Orthogonal to grade-2. |

## Two distinct concepts

1. **Grade-2 contractions (6-dot, lossy-ish shorthand)** — linguistic compression of English text. Used for learning apps and the compression experiment.
2. **8-dot byte encoding (BIFM-256)** — bijective, lossless byte↔cell map. No contractions. Used for constellation commit fingerprints and the dashboard.

## Implementations across the org (should validate against this module)

| Repo / path | Language | Notes |
| --- | --- | --- |
| `braille/js/braille-contractions.js` | JS | Learning-app tables; some cells deviate from UEB (e.g. `so` ⠎ is the letter *s* wordsign, listed as a strong sign there). |
| `braille/js/contractions-handler.js`, `src/brailleCompression.{js,ts}` | JS/TS | Compression + UI handling. |
| `braille/src/braille-core/braille-fst.js`, `braille-fst-grade3.js` | JS | FST-based grade-2/grade-3 translation. |
| `black-box/src-tauri/src/braille_contractions.rs` | Rust | Rust port of the tables. |
| `braille-frontier-poc` (`v2/gpu_tokenizer.py`, `eval/inspect_contractions.py`, …) | Python | Contraction-aware tokenization/training. |
| `qwen-agent/braille_stream.py` | Python | Streaming braille encoding. |
| `ai-native-ide/src/braille-harness.js` | JS | Test harness. |
| `corpus-builder/experiments/braille_compression.py` | Python | Cell-count compression experiment; wordsign/groupsign lists mirror `contractions.json`. |

## Usage

```js
import { contractText, cellCount } from "./contractions.mjs";

contractText("the children with knowledge");  // ⠮ ⠡⠝… etc.
cellCount("some text");                        // grade-2 cell estimate
```

## Rule of thumb

New code needing contraction tables should import `contractions.json`
(any language can parse it) rather than re-declaring tables inline.
