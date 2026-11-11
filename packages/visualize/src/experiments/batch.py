"""Batch experiment runner — run ablation across multiple concepts/prompts/alphas."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Generator

from src.models.loader import ModelBackend
from src.ablation.prompts import make_concept_prompts, make_baseline_prompts
from src.ablation.metrics import concept_recall
from src.experiments.store import ExperimentStore
from src.experiments.schemas import Experiment, ExperimentResult, ConceptDirection

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class BatchConfig:
    """Configuration for a batch experiment."""
    concepts: list[str]
    prompts: list[str]
    alphas: list[float] = field(default_factory=lambda: [1.0])
    max_tokens: int = 32


@dataclass
class BatchResult:
    """Result from a single batch run."""
    concept: str
    prompt: str
    alpha: float
    normal_text: str
    ablated_text: str
    concept_recall_normal: float
    concept_recall_ablated: float
    erasure_score: float
    layers_affected: int
    mean_cosine_sim: float
    mean_diff_norm: float
    experiment_id: int | None = None


def run_batch(
    backend: ModelBackend,
    store: ExperimentStore,
    config: BatchConfig,
) -> Generator[BatchResult, None, None]:
    """Run batch ablation experiments. Yields results as they complete.

    Optimization: reuses concept directions across prompts with the same concept.
    """
    model_info = backend.get_model_info()
    direction_cache: dict[str, dict] = {}

    for concept in config.concepts:
        # Compute directions once per concept
        if concept not in direction_cache:
            concept_prompts = make_concept_prompts(concept)
            baseline_prompts = make_baseline_prompts()
            result = backend.compute_concept_directions(concept_prompts, baseline_prompts)
            direction_cache[concept] = result

        dir_result = direction_cache[concept]
        directions = dir_result["directions"]

        for prompt in config.prompts:
            for alpha in config.alphas:
                logger.info(f"Batch: concept={concept!r}, prompt={prompt!r}, alpha={alpha}")

                # Create experiment
                exp = Experiment(
                    model_name=model_info["name"],
                    model_backend=f"local_{model_info['device']}",
                    type="ablation",
                    prompt=prompt,
                    concept=concept,
                    alpha=alpha,
                    max_tokens=config.max_tokens,
                    metadata={"batch": True},
                )
                exp_id = store.create_experiment(exp)

                # Normal generation
                normal_tokens = []
                for event, _, tokens in backend.generate(prompt, config.max_tokens):
                    normal_tokens = tokens

                store.add_result(ExperimentResult(
                    experiment_id=exp_id,
                    variant="normal",
                    output_text="".join(normal_tokens),
                    tokens=normal_tokens,
                ))

                # Ablated generation
                backend.install_ablation(directions, alpha=alpha)
                ablated_tokens = []
                for event, _, tokens in backend.generate(prompt, config.max_tokens):
                    ablated_tokens = tokens
                backend.remove_ablation()

                normal_text = "".join(normal_tokens)
                ablated_text = "".join(ablated_tokens)
                recall_normal = concept_recall(normal_text, concept)
                recall_ablated = concept_recall(ablated_text, concept)

                metrics = {
                    "concept_recall": round(recall_ablated, 4),
                    "erasure_score": round(1.0 - recall_ablated, 4),
                    "alpha": alpha,
                    "layers_affected": len(directions),
                    "mean_cosine_sim": round(float(np.mean(dir_result["cosine_sims"])), 4),
                    "mean_diff_norm": round(float(np.mean(dir_result["norms"])), 4),
                }

                store.add_result(ExperimentResult(
                    experiment_id=exp_id,
                    variant="ablated",
                    output_text=ablated_text,
                    tokens=ablated_tokens,
                    metrics=metrics,
                ))

                # Save concept directions
                layer_stats = []
                for layer_idx in range(model_info["num_layers"]):
                    layer_stats.append({
                        "layer_idx": layer_idx,
                        "has_direction": layer_idx in directions,
                        "cosine_sim": round(dir_result["cosine_sims"][layer_idx], 4),
                        "diff_norm": round(dir_result["norms"][layer_idx], 4),
                        "concept_norm": round(dir_result["concept_mean_norms"][layer_idx], 4),
                        "baseline_norm": round(dir_result["baseline_mean_norms"][layer_idx], 4),
                    })
                store.add_concept_direction(ConceptDirection(
                    experiment_id=exp_id,
                    model_name=model_info["name"],
                    concept=concept,
                    layer_stats=layer_stats,
                ))

                batch_result = BatchResult(
                    concept=concept,
                    prompt=prompt,
                    alpha=alpha,
                    normal_text=normal_text,
                    ablated_text=ablated_text,
                    concept_recall_normal=recall_normal,
                    concept_recall_ablated=recall_ablated,
                    erasure_score=1.0 - recall_ablated,
                    layers_affected=len(directions),
                    mean_cosine_sim=float(np.mean(dir_result["cosine_sims"])),
                    mean_diff_norm=float(np.mean(dir_result["norms"])),
                    experiment_id=exp_id,
                )
                yield batch_result
