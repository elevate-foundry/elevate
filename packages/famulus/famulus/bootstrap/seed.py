"""Seed-model acquisition (stdlib only).

After Ollama is installed there are zero models, so the scheduler has nothing to
run. This pulls ONE smallest-viable model, chosen from a config manifest using the
ignition probe's discovered RAM (never hardcoded to a specific machine). The pull
is a network action and is gated + audited.
"""

from __future__ import annotations

import shutil
import subprocess
from typing import Optional

from ..safety.audit import AuditLog
from ..safety.gate import Gate
from .ignition import Ignition

# Fallback manifest if config provides none. Ordered small -> large; `b` is the
# approximate parameter budget in billions. These are only DEFAULTS -- config wins.
_DEFAULT_SEED_MODELS = [
    {"name": "qwen2.5:0.5b", "b": 1},
    {"name": "llama3.2:1b", "b": 1},
    {"name": "gemma2:2b", "b": 3},
    {"name": "llama3.2:3b", "b": 3},
    {"name": "qwen2.5:7b", "b": 8},
]


def _narrate(msg: str) -> None:
    print(f"  [seed] {msg}")


def choose_seed(ig: Ignition, config: dict) -> str:
    manifest = (config or {}).get("seed_models") or _DEFAULT_SEED_MODELS
    hint = ig.seed_size_hint_b()
    # largest model whose budget fits under the hint; else the smallest available
    fitting = [m for m in manifest if m.get("b", 1) <= hint]
    chosen = (fitting[-1] if fitting else manifest[0])
    return chosen["name"]


def list_models() -> list[str]:
    ollama = shutil.which("ollama")
    if not ollama:
        return []
    try:
        out = subprocess.run([ollama, "list"], capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.SubprocessError):
        return []
    if out.returncode != 0:
        return []
    models = []
    for line in out.stdout.strip().splitlines()[1:]:
        parts = line.split()
        if parts and parts[0].upper() != "NAME":
            models.append(parts[0])
    return models


def ensure_seed_model(gate: Gate, audit: AuditLog, ig: Ignition, config: dict) -> Optional[str]:
    existing = list_models()
    if existing:
        _narrate(f"model already present: {existing[0]}")
        audit.record("seed.present", model=existing[0])
        return existing[0]

    ollama = shutil.which("ollama")
    if not ollama:
        _narrate("ollama binary missing; cannot pull a model.")
        return None

    model = choose_seed(ig, config)
    _narrate(f"selected seed model '{model}' for ~{ig.ram_total_gb or '?'}GB RAM (hint {ig.seed_size_hint_b()}B).")
    if not gate.confirm(f"Pull seed model '{model}' via Ollama", "this downloads model weights", force_prompt=True):
        return None

    audit.record("seed.pull_start", model=model)
    try:
        ok = subprocess.run([ollama, "pull", model], timeout=3600, check=False).returncode == 0
    except (OSError, subprocess.SubprocessError) as exc:
        _narrate(f"pull failed: {exc}")
        audit.record("seed.pull_failed", model=model, error=str(exc))
        return None

    audit.record("seed.pull_done", model=model, ok=ok)
    if ok:
        _narrate(f"seed model ready: {model}")
        return model
    return None
