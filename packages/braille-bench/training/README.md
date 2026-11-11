# Cerebraille Training

Poetry-managed PyTorch scaffold for training Cerebraille codecs.

## Install

```bash
poetry install
```

## Export dataset from the TypeScript service

Start the TypeScript server from the repository root:

```bash
npm run dev
```

Then export training examples:

```bash
poetry run cerebraille-export --out data/cerebraille_pairs.jsonl
```

## Run a smoke training pass

```bash
poetry run cerebraille-train --data data/cerebraille_pairs.jsonl --epochs 1
```

This scaffold trains a small Llama-shaped autoregressive sequence model over byte-level text plus 8-dot braille symbols. It is intentionally minimal: the purpose is to establish the PyTorch side of the Cerebraille architecture, not to claim a production-quality codec yet.
