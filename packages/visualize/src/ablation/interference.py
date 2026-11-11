"""Concept interference analysis — measure overlap between concept directions."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import torch
import numpy as np

from src.models.loader import ModelBackend
from src.ablation.prompts import make_concept_prompts, make_baseline_prompts

logger = logging.getLogger(__name__)


@dataclass
class InterferenceResult:
    """Result of concept interference analysis."""
    concepts: list[str]
    matrix: list[list[float]]  # [i][j] = cosine sim between concept i and j
    per_layer_matrices: dict[int, list[list[float]]]  # per-layer matrices
    direction_norms: dict[str, list[float]]  # concept -> per-layer norms


def compute_interference(
    backend: ModelBackend,
    concepts: list[str],
) -> InterferenceResult:
    """Compute pairwise cosine similarity between concept directions.

    This reveals how much erasing one concept might affect another.
    High similarity = high interference risk.
    """
    # Compute directions for each concept
    baseline_prompts = make_baseline_prompts()
    concept_directions: dict[str, dict] = {}

    for concept in concepts:
        concept_prompts = make_concept_prompts(concept)
        result = backend.compute_concept_directions(concept_prompts, baseline_prompts)
        concept_directions[concept] = result

    n = len(concepts)
    num_layers = backend.get_model_info()["num_layers"]

    # Global similarity matrix (average across layers)
    matrix = [[0.0] * n for _ in range(n)]
    per_layer_matrices: dict[int, list[list[float]]] = {}
    direction_norms: dict[str, list[float]] = {}

    # Collect direction norms
    for concept in concepts:
        direction_norms[concept] = concept_directions[concept]["norms"]

    # For each layer, compute pairwise cosine similarity
    for layer_idx in range(num_layers):
        layer_matrix = [[0.0] * n for _ in range(n)]

        for i, ci in enumerate(concepts):
            di = concept_directions[ci]["directions"].get(layer_idx)
            for j, cj in enumerate(concepts):
                if i == j:
                    layer_matrix[i][j] = 1.0
                    continue
                dj = concept_directions[cj]["directions"].get(layer_idx)
                if di is not None and dj is not None:
                    sim = torch.nn.functional.cosine_similarity(
                        di.unsqueeze(0), dj.unsqueeze(0)
                    ).item()
                    layer_matrix[i][j] = round(sim, 4)
                else:
                    layer_matrix[i][j] = 0.0

        per_layer_matrices[layer_idx] = layer_matrix

    # Average across layers
    for i in range(n):
        for j in range(n):
            vals = [per_layer_matrices[l][i][j] for l in range(num_layers)]
            matrix[i][j] = round(float(np.mean(vals)), 4)

    return InterferenceResult(
        concepts=concepts,
        matrix=matrix,
        per_layer_matrices=per_layer_matrices,
        direction_norms=direction_norms,
    )
