"""Directional ablation — Heretic-style concept direction computation.

Computes per-layer concept directions as the normalized mean difference
between concept and baseline residual activations. These directions can
then be projected out of the residual stream to erase concepts.
"""

from __future__ import annotations

import logging

import numpy as np
import torch

logger = logging.getLogger(__name__)


def compute_directions(
    backend,
    concept_prompts: list[str],
    baseline_prompts: list[str],
) -> dict:
    """Compute per-layer concept directions using directional ablation.

    The concept direction at each layer is the normalized difference between
    the mean residual for concept prompts and the mean residual for baseline
    prompts. This is the same approach used by Heretic/abliteration and
    Arditi et al. 2024.

    Args:
        backend: a ModelBackend instance (must have .collect_residuals and .device)
        concept_prompts: prompts that activate the concept
        baseline_prompts: generic prompts that don't

    Returns dict with:
        - directions: {layer_idx: normalized direction tensor on device}
        - cosine_sims: per-layer cosine similarity between concept/baseline means
        - norms: per-layer norm of the raw (un-normalized) difference
        - concept_mean_norms: per-layer norm of concept mean residual
        - baseline_mean_norms: per-layer norm of baseline mean residual
    """
    logger.info(
        f"Computing concept directions from {len(concept_prompts)} concept + "
        f"{len(baseline_prompts)} baseline prompts..."
    )

    concept_residuals = backend.collect_residuals(concept_prompts)  # [N, L, H]
    baseline_residuals = backend.collect_residuals(baseline_prompts)  # [M, L, H]

    concept_mean = concept_residuals.mean(dim=0)  # [L, H]
    baseline_mean = baseline_residuals.mean(dim=0)  # [L, H]

    num_layers = concept_mean.shape[0]
    directions = {}
    cosine_sims = []
    norms = []
    concept_mean_norms = []
    baseline_mean_norms = []

    device = backend.device

    for layer_idx in range(num_layers):
        c = concept_mean[layer_idx]  # [H]
        b = baseline_mean[layer_idx]  # [H]
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
            directions[layer_idx] = direction.to(device)

    logger.info(
        f"Computed directions for {len(directions)} layers, "
        f"mean cosine_sim={np.mean(cosine_sims):.4f}, "
        f"mean diff_norm={np.mean(norms):.4f}"
    )

    return {
        "directions": directions,
        "cosine_sims": cosine_sims,
        "norms": norms,
        "concept_mean_norms": concept_mean_norms,
        "baseline_mean_norms": baseline_mean_norms,
    }
