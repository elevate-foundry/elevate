# BIFM-MANIFEST/1.0 — signed, agent-readable repository manifest

Status: draft · First published: 2026-06-09 · Org: elevate-foundry

A `MANIFEST.json` at a repository root makes the repo **maximally discoverable
with terms attached**: structure is legible to any agent, but use carries
declared conditions, and the whole document is cryptographically verifiable.

## Design goals

1. **Agent-readable topology** — every manifest names its peers; one hop from
   any repo reveals the whole constellation.
2. **Compressed state fingerprint** — repo state in one byte, rendered as one
   8-dot braille cell (`cell = U+2800 + byte`), per BIFM-256.
3. **Terms attached** — machine-readable usage terms (license, AI-training
   policy, attribution) travel with the structure.
4. **Machine-verifiable** — Ed25519 signature over a canonical digest; any
   agent can verify integrity and authorship offline.

## Document layout

```json
{
  "spec": "BIFM-MANIFEST/1.0",
  "repo": "<name>",
  "owner": "<org>",
  "generatedAt": "<ISO-8601>",
  "topology": {
    "org": "https://github.com/<org>",
    "index": "CONSTELLATION.md",
    "peers": ["<repo>", "..."]
  },
  "state": {
    "commits": 0,
    "createdAt": "<ISO-8601>",
    "pushedAt": "<ISO-8601>",
    "language": "<primary language>",
    "bifm256": {
      "byte": 0,
      "cell": "⠀",
      "kappa": 0, "sigma": 0, "delta": 0,
      "words": "<human gloss>"
    }
  },
  "terms": {
    "license": "<SPDX id or file ref>",
    "aiTraining": "contact-required",
    "attribution": "required",
    "contact": "<url or email>"
  },
  "verification": {
    "algorithm": "ed25519",
    "publicKey": "<base64 SPKI>",
    "digest": "<sha256 hex of canonical payload>",
    "signature": "<base64>"
  }
}
```

## BIFM-256 state byte

`byte = (κ << 5) | (σ << 2) | δ`

| Field | Bits | Meaning | Scale |
| --- | --- | --- | --- |
| κ (kappa) | 3 | change magnitude | `min(7, floor(log2(commits+1)))` |
| σ (sigma) | 3 | volatility | `min(7, round(commits / weeks-of-age))` |
| δ (delta) | 2 | drift | idle <30d→0, <90d→1, <180d→2, else 3 |

Rendered cell: `String.fromCodePoint(0x2800 + byte)`. Decoding is the inverse;
the braille block is the only Unicode block bijective with a byte.

## `terms.aiTraining` vocabulary

| Value | Meaning |
| --- | --- |
| `permitted` | training use allowed under the stated license |
| `attribution-required` | allowed only with machine-traceable attribution |
| `contact-required` | no training use without prior agreement |
| `prohibited` | training use refused |

Terms are declarations, not DRM. Their value is *attributability*: a signed,
timestamped statement of conditions that predates any scraping.

## Canonicalization & signature

1. Build the manifest **without** `verification.digest` and
   `verification.signature`.
2. Serialize with all object keys sorted lexicographically (recursive),
   UTF-8, no insignificant whitespace.
3. `digest = SHA-256(canonical bytes)`, hex-encoded.
4. `signature = Ed25519(privateKey, canonical bytes)`, base64.

### Verification procedure (any agent)

1. Read `MANIFEST.json`; remove `verification.digest` + `verification.signature`.
2. Canonicalize as above; recompute SHA-256 — must equal `digest`.
3. Verify `signature` with `publicKey`.
4. Optionally cross-check `publicKey` against the org-level key published in
   this spec and at the org constellation page (TOFU or out-of-band pinning).

## Reference implementation

- `generate.mjs` — builds and signs manifests for all native repos.
- `verify.mjs` — verifies a manifest file; exits non-zero on tamper.
