#!/usr/bin/env python3
"""prepare_dataset.py - turn out/corpus.jsonl into train/val files for LoRA.

Each source file becomes one document, prefixed with a small provenance header so
the model learns the elevate-foundry repo/path structure as well as the code.
Documents are shuffled and split into train/val.

Usage:
    python prepare_dataset.py \
        --corpus ../out/corpus.jsonl \
        --out-dir data \
        --val-frac 0.02
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="../out/corpus.jsonl")
    ap.add_argument("--out-dir", default="data")
    ap.add_argument("--val-frac", type=float, default=0.02)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--min-chars", type=int, default=24, help="drop near-empty files")
    args = ap.parse_args()

    corpus = Path(args.corpus)
    if not corpus.exists():
        raise SystemExit(f"corpus not found: {corpus} (run clone.sh && extract.mjs first)")

    docs: list[str] = []
    with corpus.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            text = rec.get("text", "")
            if len(text) < args.min_chars:
                continue
            header = f"<|repo|> {rec.get('repo','?')}/{rec.get('path','?')} <|lang|> {rec.get('lang','?')}\n"
            docs.append(header + text)

    if not docs:
        raise SystemExit("no documents after filtering")

    random.seed(args.seed)
    random.shuffle(docs)
    n_val = max(1, int(len(docs) * args.val_frac))
    val, train = docs[:n_val], docs[n_val:]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in (("train.jsonl", train), ("val.jsonl", val)):
        with (out_dir / name).open("w") as fh:
            for d in rows:
                fh.write(json.dumps({"text": d}) + "\n")

    print(f"prepared {len(train)} train / {len(val)} val docs -> {out_dir}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
