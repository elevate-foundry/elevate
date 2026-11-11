"""Modal remote backend client — same interface as LocalModelBackend.

Calls Modal functions for model inference, returning results in the same
format as the local backend so the server doesn't need to know the difference.
"""

from __future__ import annotations

import logging
from typing import Generator

import torch

from src.models.loader import ModelBackend

logger = logging.getLogger(__name__)


class ModalModelBackend(ModelBackend):
    """Remote model backend that runs inference on Modal GPUs.

    Uses the same interface as LocalModelBackend so the server
    can transparently switch between local and remote.
    """

    def __init__(self, model_name: str = "Qwen/Qwen3-0.6B", gpu: str = "L40S"):
        self.model_name = model_name
        self.gpu = gpu
        self._model_info: dict | None = None
        self._worker = None

    def _get_worker(self):
        """Lazily connect to the Modal worker."""
        if self._worker is None:
            import modal
            Cls = modal.Cls.from_name("neuron-visualizer", "ModelWorker")
            self._worker = Cls()
        return self._worker

    def get_model_info(self) -> dict:
        if self._model_info is None:
            worker = self._get_worker()
            self._model_info = worker.get_model_info.remote()
        return self._model_info

    def generate(
        self, prompt: str, max_tokens: int
    ) -> Generator[tuple[str, dict | None, list[str]], None, None]:
        """Generate tokens remotely. Yields events in the same format as local."""
        worker = self._get_worker()
        result = worker.generate_and_capture.remote(prompt, max_tokens)

        # Emit prefill
        yield "prefill", result["prefill"], result["prefill"]["tokens"]

        # Emit token steps
        for step_data in result.get("steps", []):
            yield "token", step_data, step_data.get("all_tokens", [])

        # Emit complete
        yield "complete", None, result["tokens"]

    def compute_concept_directions(
        self, concept_prompts: list[str], baseline_prompts: list[str]
    ) -> dict:
        """Compute concept directions remotely and return tensors on CPU."""
        worker = self._get_worker()
        raw_residuals_concept = worker.collect_residuals.remote(concept_prompts)
        raw_residuals_baseline = worker.collect_residuals.remote(baseline_prompts)

        import numpy as np

        concept_tensor = torch.tensor(raw_residuals_concept)  # [N, L, H]
        baseline_tensor = torch.tensor(raw_residuals_baseline)  # [M, L, H]

        concept_mean = concept_tensor.mean(dim=0)
        baseline_mean = baseline_tensor.mean(dim=0)

        num_layers = concept_mean.shape[0]
        directions = {}
        cosine_sims = []
        norms = []
        concept_mean_norms = []
        baseline_mean_norms = []

        for layer_idx in range(num_layers):
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
                direction = torch.nn.functional.normalize(
                    diff.unsqueeze(0), p=2, dim=1
                ).squeeze(0)
                directions[layer_idx] = direction  # stays on CPU

        return {
            "directions": directions,
            "cosine_sims": cosine_sims,
            "norms": norms,
            "concept_mean_norms": concept_mean_norms,
            "baseline_mean_norms": baseline_mean_norms,
        }

    def install_ablation(self, directions: dict[int, torch.Tensor], alpha: float) -> int:
        # For remote backend, ablation is handled entirely on the Modal side
        # via ablate_and_compare. This is a no-op for the local abstraction.
        logger.info("Modal backend: ablation hooks are managed remotely")
        return len(directions)

    def remove_ablation(self) -> None:
        # No-op for remote backend
        pass

    def ablate_and_compare_remote(
        self,
        concept_prompts: list[str],
        baseline_prompts: list[str],
        prompt: str,
        alpha: float,
        max_tokens: int,
    ) -> dict:
        """Run the full ablation pipeline on Modal in one call.

        This is more efficient than calling compute_directions + install + generate
        separately because it avoids serializing direction tensors over the network.
        """
        worker = self._get_worker()
        return worker.ablate_and_compare.remote(
            concept_prompts, baseline_prompts, prompt, alpha, max_tokens
        )
