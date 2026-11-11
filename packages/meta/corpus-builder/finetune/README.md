# finetune — LoRA on the elevate-foundry corpus

Continued-pretraining of a small open base model on the native-repo source corpus
so it learns to "speak elevate-foundry." Stable `transformers` + `peft` recipe
(tokenize → pack into blocks → causal-LM LoRA). **Run on a CUDA GPU** (a 1.5B model
with QLoRA fits in ~8–12 GB; full bf16 LoRA wants ~16–24 GB).

## Steps

```bash
# 0. build the corpus first (from corpus-builder/)
./clone.sh elevate-foundry && node extract.mjs

# 1. install (in a GPU env)
cd finetune
pip install -r requirements.txt

# 2. prepare train/val from the corpus
python prepare_dataset.py --corpus ../out/corpus.jsonl --out-dir data --val-frac 0.02

# 3. train (edit config.yaml or override on CLI)
python train_lora.py --config config.yaml
#   low-VRAM (QLoRA):   python train_lora.py --load_in_4bit true --base_model Qwen/Qwen2.5-0.5B
#   quick smoke test:   python train_lora.py --epochs 1 --save_steps 50

# 4. generate with the trained adapter
python infer.py --adapter out/lora-elevate --prompt "<|repo|> elevate-foundry/braille-mcp <|lang|> JavaScript\n"
```

## How it works

- `prepare_dataset.py` — one document per source file, prefixed with a
  `<|repo|> name/path <|lang|> Lang` header so the model learns repo/path structure
  alongside the code. Shuffled, split into `data/train.jsonl` / `data/val.jsonl`.
- `train_lora.py` — tokenizes, **packs** tokens into `block_size` chunks (efficient
  continued pretraining), applies LoRA to attention + MLP projections, trains with
  the HF `Trainer`, and saves the adapter to `output_dir`.
- `infer.py` — loads the base model + adapter and samples completions.

## Config

All knobs live in `config.yaml` (base model, `block_size`, LoRA `r/alpha/dropout`,
`target_modules`, batch/accum, LR, epochs, `bf16`, `load_in_4bit`,
`gradient_checkpointing`). Every value is CLI-overridable.

## Notes / honesty

- Corpus is ~2.76M tokens. That's enough for a **LoRA** to pick up the org's style
  and recurring patterns; it is **not** enough to teach new fundamental capabilities,
  and the model will partially memorize. Keep the held-out `val.jsonl` to watch for
  overfitting (rising eval loss).
- Default base `Qwen/Qwen2.5-1.5B` is a strong code+text small model. `Llama-3.2-1B`
  or `Qwen2.5-0.5B` also work — the LoRA `target_modules` match both families.
- This machine has no GPU; run the training step elsewhere (cloud GPU, Colab, etc.).
