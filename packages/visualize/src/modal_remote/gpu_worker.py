"""Modal GPU worker — remote inference and activation capture.

Runs model loading and inference on Modal's GPU infrastructure.
Results are serialized back to the local server.
"""

from __future__ import annotations

import logging
import os

import modal

logger = logging.getLogger(__name__)

# ── Modal app definition ─────────────────────────────────────────────────

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch>=2.0",
        "transformers>=4.40",
        "numpy>=1.24",
        "safetensors>=0.4",
    )
    .env({"HF_HUB_CACHE": "/cache", "HF_XET_HIGH_PERFORMANCE": "1", "MODEL_NAME": "Qwen/Qwen3-0.6B"})
)

app = modal.App("neuron-visualizer", image=image)
vol = modal.Volume.from_name("hf-hub-cache", create_if_missing=True)


@app.cls(
    gpu="L40S",
    volumes={"/cache": vol},
    timeout=600,
    scaledown_window=300,
)
class ModelWorker:
    """Remote model worker that runs on Modal GPUs."""

    @modal.enter()
    def load(self):
        """Load model and set up hooks on container start."""
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        # Import our modules — they're bundled in the image
        # For now, we inline the critical logic since the full src package
        # isn't in the Modal image. The client handles serialization.
        self.model_name = os.environ.get("MODEL_NAME", "Qwen/Qwen3-0.6B")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Loading {self.model_name} on {self.device}...")

        self.tokenizer = AutoTokenizer.from_pretrained(
            self.model_name, trust_remote_code=True
        )
        self.model = AutoModelForCausalLM.from_pretrained(
            self.model_name,
            dtype=torch.float32,
            trust_remote_code=True,
        ).to(self.device)
        self.model.eval()

        # Detect layers
        if hasattr(self.model, "model") and hasattr(self.model.model, "layers"):
            self.layers = self.model.model.layers
        elif hasattr(self.model, "transformer") and hasattr(self.model.transformer, "h"):
            self.layers = self.model.transformer.h
        else:
            raise ValueError(f"Cannot find layers in {self.model_name}")

        self.num_layers = len(self.layers)
        self.hidden_size = self.model.config.hidden_size
        self._captured = {}
        self._hooks = []
        self._ablation_hooks = []
        self._register_hooks()

        logger.info(f"Model loaded: {sum(p.numel() for p in self.model.parameters())/1e6:.1f}M params")

    def _register_hooks(self):
        """Register activation capture hooks."""
        import torch

        for h in self._hooks:
            h.remove()
        self._hooks = []
        self._captured = {}

        for layer_idx, layer in enumerate(self.layers):
            def make_hook(key, unpack=False):
                captured = self._captured
                def hook(module, inp, output):
                    if unpack and isinstance(output, tuple):
                        tensor = output[0]
                    else:
                        tensor = output
                    captured[key] = tensor.detach().cpu().float()
                return hook

            # Layer output
            self._hooks.append(
                layer.register_forward_hook(make_hook(f"layer_{layer_idx}", unpack=True))
            )

    @modal.method()
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
            "backend": "modal_gpu",
        }

    @modal.method()
    def collect_residuals(self, prompts: list[str]) -> list:
        """Collect per-layer residuals for a list of prompts.

        Returns list of [num_layers, hidden_size] arrays as nested lists
        (JSON-serializable).
        """
        import torch

        all_residuals = []
        for prompt in prompts:
            inputs = self.tokenizer(prompt, return_tensors="pt", truncation=True, max_length=128)
            input_ids = inputs["input_ids"].to(self.device)

            self._captured.clear()
            with torch.no_grad():
                self.model(input_ids)

            layer_residuals = []
            for layer_idx in range(self.num_layers):
                key = f"layer_{layer_idx}"
                if key in self._captured:
                    residual = self._captured[key].squeeze(0)[-1].float().tolist()
                else:
                    residual = [0.0] * self.hidden_size
                layer_residuals.append(residual)

            all_residuals.append(layer_residuals)

        return all_residuals

    @modal.method()
    def generate_and_capture(self, prompt: str, max_tokens: int = 32) -> dict:
        """Run generation and return results as a serializable dict.

        Returns {tokens, text, prefill_activations, steps}.
        """
        import torch

        inputs = self.tokenizer(prompt, return_tensors="pt", padding=False, truncation=True, max_length=512)
        input_ids = inputs["input_ids"].to(self.device)

        # Prefill
        self._captured.clear()
        with torch.no_grad():
            outputs = self.model(input_ids, use_cache=True)

        token_strings = [self.tokenizer.decode(t) for t in input_ids[0]]
        prefill_act = self._serialize_activations(token_strings)

        # Autoregressive
        past_key_values = outputs.past_key_values
        next_token_id = outputs.logits[:, -1, :].argmax(dim=-1, keepdim=True)
        all_token_strings = list(token_strings)
        steps = []

        for step in range(max_tokens):
            new_token_str = self.tokenizer.decode(next_token_id[0])
            all_token_strings.append(new_token_str)

            if next_token_id.item() == self.tokenizer.eos_token_id:
                break

            self._captured.clear()
            with torch.no_grad():
                outputs = self.model(
                    next_token_id, past_key_values=past_key_values, use_cache=True
                )
            past_key_values = outputs.past_key_values

            step_act = self._serialize_activations([new_token_str])
            step_act["step"] = step
            step_act["all_tokens"] = list(all_token_strings)
            steps.append(step_act)

            next_token_id = outputs.logits[:, -1, :].argmax(dim=-1, keepdim=True)

        return {
            "tokens": all_token_strings,
            "text": "".join(all_token_strings),
            "prefill": prefill_act,
            "steps": steps,
        }

    @modal.method()
    def ablate_and_compare(
        self,
        concept_prompts: list[str],
        baseline_prompts: list[str],
        prompt: str,
        alpha: float = 1.0,
        max_tokens: int = 32,
    ) -> dict:
        """Full ablation pipeline: compute directions, generate normal + ablated.

        Returns everything needed by the frontend.
        """
        import torch
        import numpy as np

        # Step 1: Compute concept directions
        concept_residuals = self.collect_residuals.local(concept_prompts)
        baseline_residuals = self.collect_residuals.local(baseline_prompts)

        concept_tensor = torch.tensor(concept_residuals)  # [N, L, H]
        baseline_tensor = torch.tensor(baseline_residuals)  # [M, L, H]

        concept_mean = concept_tensor.mean(dim=0)
        baseline_mean = baseline_tensor.mean(dim=0)

        directions = {}
        cosine_sims = []
        norms = []
        concept_mean_norms = []
        baseline_mean_norms = []

        for layer_idx in range(self.num_layers):
            c = concept_mean[layer_idx]
            b = baseline_mean[layer_idx]
            diff = c - b

            raw_norm = diff.norm().item()
            norms.append(raw_norm)
            concept_mean_norms.append(c.norm().item())
            baseline_mean_norms.append(b.norm().item())

            cos_sim = torch.nn.functional.cosine_similarity(
                c.unsqueeze(0), b.unsqueeze(0)
            ).item()
            cosine_sims.append(cos_sim)

            if raw_norm > 1e-8:
                direction = torch.nn.functional.normalize(diff.unsqueeze(0), p=2, dim=1).squeeze(0)
                directions[layer_idx] = direction.to(self.device)

        # Build layer stats
        layer_stats = {}
        for layer_idx in range(self.num_layers):
            layer_stats[str(layer_idx)] = {
                "has_direction": layer_idx in directions,
                "cosine_sim": round(cosine_sims[layer_idx], 4),
                "diff_norm": round(norms[layer_idx], 4),
                "concept_norm": round(concept_mean_norms[layer_idx], 4),
                "baseline_norm": round(baseline_mean_norms[layer_idx], 4),
            }

        # Step 2: Normal generation
        normal_result = self.generate_and_capture.local(prompt, max_tokens)

        # Step 3: Ablated generation
        self._install_ablation(directions, alpha)
        ablated_result = self.generate_and_capture.local(prompt, max_tokens)
        self._remove_ablation()

        return {
            "layer_stats": layer_stats,
            "num_direction_layers": len(directions),
            "mean_cosine_sim": round(float(np.mean(cosine_sims)), 4),
            "mean_diff_norm": round(float(np.mean(norms)), 4),
            "normal": normal_result,
            "ablated": ablated_result,
        }

    def _install_ablation(self, directions: dict, alpha: float):
        """Install directional ablation hooks."""
        import torch

        self._remove_ablation()
        for layer_idx, direction in directions.items():
            if layer_idx >= self.num_layers:
                continue
            layer = self.layers[layer_idx]

            def make_hook(d, a):
                def hook(module, inp, output):
                    if isinstance(output, tuple):
                        hidden = output[0]
                    else:
                        hidden = output
                    proj = torch.einsum("...h,h->...", hidden, d).unsqueeze(-1) * d
                    ablated = hidden - a * proj
                    if isinstance(output, tuple):
                        return (ablated,) + output[1:]
                    return ablated
                return hook

            self._ablation_hooks.append(
                layer.register_forward_hook(make_hook(direction, alpha))
            )

    def _remove_ablation(self):
        for h in self._ablation_hooks:
            h.remove()
        self._ablation_hooks = []

    def _serialize_activations(self, tokens: list[str]) -> dict:
        """Convert captured activations to JSON-serializable format."""
        layers = []
        for layer_idx in range(self.num_layers):
            layer_data = {"layer_idx": layer_idx}
            key = f"layer_{layer_idx}"
            if key in self._captured:
                act = self._captured[key].squeeze(0)
                layer_data["residual"] = {
                    "mean": act.mean(dim=-1).tolist(),
                    "std": act.std(dim=-1).tolist(),
                    "max": act.max(dim=-1).values.tolist(),
                    "min": act.min(dim=-1).values.tolist(),
                    "heatmap": self._downsample(act, 128).tolist(),
                }
            layers.append(layer_data)

        return {
            "tokens": tokens,
            "num_layers": self.num_layers,
            "hidden_size": self.hidden_size,
            "num_attention_heads": self.model.config.num_attention_heads,
            "intermediate_size": getattr(self.model.config, "intermediate_size", 3072),
            "layers": layers,
        }

    @staticmethod
    def _downsample(tensor, max_neurons: int = 128):
        """Downsample [seq, hidden] to [seq, max_neurons]."""
        import torch
        if tensor.dim() == 1:
            tensor = tensor.unsqueeze(0)
        seq_len, hidden_dim = tensor.shape
        if hidden_dim <= max_neurons:
            return tensor
        chunk_size = hidden_dim // max_neurons
        trimmed = tensor[:, : chunk_size * max_neurons]
        return trimmed.reshape(seq_len, max_neurons, chunk_size).mean(dim=-1)
