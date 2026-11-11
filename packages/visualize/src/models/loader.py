"""Model loading and backend abstraction.

Provides a LocalModelBackend that loads HuggingFace models locally,
and a ModelBackend protocol that can be implemented for remote backends (e.g. Modal).
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Generator

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from src.models.hooks import HookManager
from src.models.profiles import ModelProfile, detect_profile, _resolve_attr
from src.processing import process_activations, downsample_heatmap

logger = logging.getLogger(__name__)


def _detect_device() -> str:
    """Detect the best available device."""
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_model(
    model_name: str,
    device: str = "auto",
    dtype: torch.dtype = torch.float32,
    local_files_only: bool = False,
) -> tuple[Any, Any, ModelProfile, str]:
    """Load a HuggingFace model, auto-detect its profile, and return everything.

    Returns (model, tokenizer, profile, device_str).
    """
    if device == "auto":
        device = _detect_device()

    logger.info(f"Loading {model_name} on {device}...")
    tokenizer = AutoTokenizer.from_pretrained(
        model_name, trust_remote_code=True, local_files_only=local_files_only
    )
    # Load to CPU first, then move — avoids MPS segfaults on some models
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        dtype=dtype,
        trust_remote_code=True,
        local_files_only=local_files_only,
    )
    if device != "cpu":
        model = model.to(device)
    model.eval()

    profile = detect_profile(model)
    total_params = sum(p.numel() for p in model.parameters()) / 1e6
    logger.info(f"Model loaded: {total_params:.1f}M params, profile={profile.name}")

    return model, tokenizer, profile, device


class ModelBackend(ABC):
    """Abstract interface for model inference + activation capture.

    Implemented by LocalModelBackend (this file) and ModalModelBackend (modal_remote/).
    """

    @abstractmethod
    def get_model_info(self) -> dict:
        """Return model metadata for the frontend."""
        ...

    @abstractmethod
    def generate(
        self, prompt: str, max_tokens: int
    ) -> Generator[tuple[str, dict | None, list[str]], None, None]:
        """Generate tokens, yielding (event, data_dict, all_tokens) per step."""
        ...

    @abstractmethod
    def compute_concept_directions(
        self, concept_prompts: list[str], baseline_prompts: list[str]
    ) -> dict:
        """Compute per-layer concept directions."""
        ...

    @abstractmethod
    def install_ablation(self, directions: dict[int, torch.Tensor], alpha: float) -> int:
        """Install ablation hooks. Returns number of hooks installed."""
        ...

    @abstractmethod
    def remove_ablation(self) -> None:
        """Remove ablation hooks."""
        ...


class LocalModelBackend(ModelBackend):
    """Local model backend — loads model on MPS/CUDA/CPU and runs inference directly."""

    def __init__(
        self,
        model_name: str = "Qwen/Qwen3-0.6B",
        device: str = "auto",
        local_files_only: bool = True,
    ):
        self.model_name = model_name
        self.model, self.tokenizer, self.profile, self.device = load_model(
            model_name, device=device, local_files_only=local_files_only
        )
        self.hooks = HookManager()
        self.hooks.register(self.model, self.profile)

    def get_model_info(self) -> dict:
        config = self.model.config
        return {
            "name": self.model_name,
            "num_layers": config.num_hidden_layers,
            "hidden_size": config.hidden_size,
            "num_attention_heads": config.num_attention_heads,
            "num_kv_heads": getattr(config, "num_key_value_heads", config.num_attention_heads),
            "intermediate_size": getattr(config, "intermediate_size", 3072),
            "vocab_size": config.vocab_size,
            "total_params": f"{sum(p.numel() for p in self.model.parameters())/1e6:.1f}M",
            "device": self.device,
        }

    def generate(
        self, prompt: str, max_tokens: int
    ) -> Generator[tuple[str, dict | None, list[str]], None, None]:
        inputs = self.tokenizer(
            prompt, return_tensors="pt", padding=False, truncation=True, max_length=512
        )
        input_ids = inputs["input_ids"].to(self.device)

        # Prefill
        self.hooks.clear()
        with torch.no_grad():
            outputs = self.model(input_ids, use_cache=True)

        token_strings = [self.tokenizer.decode(t) for t in input_ids[0]]
        num_layers = self._num_layers()
        prefill_data = process_activations(
            self.hooks.captured, token_strings, num_layers, self.model.config
        )
        yield "prefill", prefill_data, token_strings

        # Autoregressive generation
        past_key_values = outputs.past_key_values
        next_token_id = outputs.logits[:, -1, :].argmax(dim=-1, keepdim=True)
        all_token_strings = list(token_strings)

        for step in range(max_tokens):
            new_token_str = self.tokenizer.decode(next_token_id[0])
            all_token_strings.append(new_token_str)

            if next_token_id.item() == self.tokenizer.eos_token_id:
                yield "eos", None, all_token_strings
                break

            self.hooks.clear()
            with torch.no_grad():
                outputs = self.model(
                    next_token_id, past_key_values=past_key_values, use_cache=True
                )
            past_key_values = outputs.past_key_values

            step_data = process_activations(
                self.hooks.captured, [new_token_str], num_layers, self.model.config
            )
            step_data["step"] = step
            step_data["all_tokens"] = all_token_strings
            yield "token", step_data, all_token_strings

            next_token_id = outputs.logits[:, -1, :].argmax(dim=-1, keepdim=True)

        else:
            yield "complete", None, all_token_strings

    def collect_residuals(self, prompts: list[str]) -> torch.Tensor:
        """Run prompts and collect per-layer residual vectors at the last token.
        Returns [num_prompts, num_layers, hidden_size].
        """
        num_layers = self._num_layers()
        all_residuals = []

        for prompt in prompts:
            inputs = self.tokenizer(prompt, return_tensors="pt", truncation=True, max_length=128)
            input_ids = inputs["input_ids"].to(self.device)

            self.hooks.clear()
            with torch.no_grad():
                self.model(input_ids)

            layer_residuals = []
            for layer_idx in range(num_layers):
                key = f"layer_{layer_idx}"
                if key in self.hooks.captured:
                    residual = self.hooks.captured[key].squeeze(0)[-1].float()
                    layer_residuals.append(residual)
                else:
                    layer_residuals.append(torch.zeros(self.model.config.hidden_size))

            all_residuals.append(torch.stack(layer_residuals))

        return torch.stack(all_residuals)

    def compute_concept_directions(
        self, concept_prompts: list[str], baseline_prompts: list[str]
    ) -> dict:
        from src.ablation.directional import compute_directions
        return compute_directions(self, concept_prompts, baseline_prompts)

    def install_ablation(self, directions: dict[int, torch.Tensor], alpha: float) -> int:
        return self.hooks.install_ablation(self.model, self.profile, directions, alpha)

    def remove_ablation(self) -> None:
        self.hooks.remove_ablation()

    def _num_layers(self) -> int:
        layers = _resolve_attr(self.model, self.profile.layers_attr)
        return len(layers)
