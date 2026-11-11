#!/usr/bin/env python3
"""train_lora.py - LoRA continued-pretraining on the elevate-foundry code corpus.

Stable transformers + PEFT recipe (no TRL): tokenize the corpus, pack tokens into
fixed-size blocks, and train LoRA adapters with a causal-LM objective.

Usage:
    python prepare_dataset.py                      # writes data/train.jsonl, data/val.jsonl
    python train_lora.py --config config.yaml      # train (GPU recommended)
    # any config key can be overridden on the CLI, e.g. --epochs 1 --base_model Qwen/Qwen2.5-0.5B
"""
from __future__ import annotations

import argparse
from itertools import chain
from pathlib import Path

import yaml


def load_config() -> argparse.Namespace:
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--config", default="config.yaml")
    known, _ = pre.parse_known_args()

    cfg: dict = {}
    cfg_path = Path(known.config)
    if cfg_path.exists():
        cfg = yaml.safe_load(cfg_path.read_text()) or {}

    ap = argparse.ArgumentParser(parents=[pre])
    for key, val in cfg.items():
        if isinstance(val, bool):
            ap.add_argument(f"--{key}", type=lambda x: str(x).lower() in ("1", "true", "yes"), default=val)
        elif isinstance(val, list):
            ap.add_argument(f"--{key}", nargs="+", default=val)
        elif isinstance(val, int) and not isinstance(val, bool):
            ap.add_argument(f"--{key}", type=int, default=val)
        elif isinstance(val, float):
            ap.add_argument(f"--{key}", type=float, default=val)
        else:
            ap.add_argument(f"--{key}", default=val)
    return ap.parse_args()


def main() -> int:
    args = load_config()

    import torch
    from datasets import load_dataset
    from peft import LoraConfig, get_peft_model
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        DataCollatorForLanguageModeling,
        Trainer,
        TrainingArguments,
    )

    tok = AutoTokenizer.from_pretrained(args.base_model, use_fast=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    # ---- model (optionally 4-bit QLoRA) ----
    model_kwargs = {"torch_dtype": torch.bfloat16 if args.bf16 else torch.float16}
    if getattr(args, "load_in_4bit", False):
        from transformers import BitsAndBytesConfig

        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16 if args.bf16 else torch.float16,
        )
    model = AutoModelForCausalLM.from_pretrained(args.base_model, **model_kwargs)
    model.config.use_cache = False
    if args.gradient_checkpointing:
        model.gradient_checkpointing_enable()

    if getattr(args, "load_in_4bit", False):
        from peft import prepare_model_for_kbit_training

        model = prepare_model_for_kbit_training(model)

    lora = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        target_modules=list(args.target_modules),
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    # ---- data: tokenize then pack into block_size chunks ----
    data_files = {"train": args.train_file, "validation": args.val_file}
    raw = load_dataset("json", data_files=data_files)

    def tokenize(batch):
        return tok(batch[args.text_field])

    tokenized = raw.map(tokenize, batched=True, remove_columns=raw["train"].column_names)

    block = args.block_size

    def group(examples):
        ids = list(chain(*examples["input_ids"]))
        total = (len(ids) // block) * block
        chunks = [ids[i : i + block] for i in range(0, total, block)]
        return {"input_ids": chunks, "labels": [c.copy() for c in chunks]}

    lm = tokenized.map(group, batched=True)

    collator = DataCollatorForLanguageModeling(tok, mlm=False)

    targs = TrainingArguments(
        output_dir=args.output_dir,
        per_device_train_batch_size=args.per_device_batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.learning_rate,
        num_train_epochs=args.epochs,
        warmup_ratio=args.warmup_ratio,
        weight_decay=args.weight_decay,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        eval_strategy="steps",
        eval_steps=args.save_steps,
        bf16=args.bf16,
        fp16=not args.bf16,
        seed=args.seed,
        report_to="none",
    )

    trainer = Trainer(
        model=model,
        args=targs,
        train_dataset=lm["train"],
        eval_dataset=lm["validation"],
        data_collator=collator,
    )
    trainer.train()
    trainer.save_model(args.output_dir)
    tok.save_pretrained(args.output_dir)
    print(f"saved LoRA adapter -> {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
