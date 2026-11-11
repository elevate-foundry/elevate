#!/usr/bin/env python3
"""infer.py - load the base model + trained LoRA adapter and generate.

Usage:
    python infer.py --adapter out/lora-elevate \
        --prompt "<|repo|> elevate-foundry/braille-mcp <|lang|> JavaScript\n"
"""
from __future__ import annotations

import argparse


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base_model", default="Qwen/Qwen2.5-1.5B")
    ap.add_argument("--adapter", default="out/lora-elevate")
    ap.add_argument("--prompt", default="<|repo|> elevate-foundry/")
    ap.add_argument("--max_new_tokens", type=int, default=256)
    ap.add_argument("--temperature", type=float, default=0.7)
    args = ap.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(args.base_model, use_fast=True)
    base = AutoModelForCausalLM.from_pretrained(args.base_model, torch_dtype=torch.bfloat16)
    model = PeftModel.from_pretrained(base, args.adapter)
    model.eval()

    inputs = tok(args.prompt, return_tensors="pt").to(model.device)
    out = model.generate(
        **inputs,
        max_new_tokens=args.max_new_tokens,
        do_sample=True,
        temperature=args.temperature,
        top_p=0.95,
        pad_token_id=tok.eos_token_id,
    )
    print(tok.decode(out[0], skip_special_tokens=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
