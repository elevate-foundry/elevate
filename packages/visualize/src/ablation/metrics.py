"""Ablation quality metrics.

Quantifies how well an ablation worked beyond eyeballing the output.
"""

from __future__ import annotations

import logging

import torch
import numpy as np

logger = logging.getLogger(__name__)


def kl_divergence(
    normal_logits: torch.Tensor,
    ablated_logits: torch.Tensor,
) -> float:
    """Compute mean KL divergence between normal and ablated output distributions.

    Args:
        normal_logits: [seq_len, vocab_size] logits from normal generation
        ablated_logits: [seq_len, vocab_size] logits from ablated generation

    Returns scalar KL divergence averaged across positions.
    """
    normal_probs = torch.nn.functional.softmax(normal_logits, dim=-1)
    ablated_log_probs = torch.nn.functional.log_softmax(ablated_logits, dim=-1)
    normal_log_probs = torch.nn.functional.log_softmax(normal_logits, dim=-1)

    # KL(P || Q) = sum P * (log P - log Q)
    kl = (normal_probs * (normal_log_probs - ablated_log_probs)).sum(dim=-1)
    return kl.mean().item()


def concept_recall(
    output_text: str,
    concept: str,
    probe_words: list[str] | None = None,
) -> float:
    """Measure whether the concept still appears in the ablated output.

    Returns a score from 0 (concept fully erased) to 1 (concept fully present).
    Simple keyword-based metric — counts how many probe words appear.
    """
    text_lower = output_text.lower()
    if probe_words is None:
        probe_words = [concept.lower()]

    found = sum(1 for w in probe_words if w in text_lower)
    return found / len(probe_words) if probe_words else 0.0


def direction_magnitude_stats(directions: dict[int, torch.Tensor]) -> dict:
    """Compute statistics about the concept direction across layers.

    Returns dict with mean_norm, max_norm, min_norm, std_norm across layers.
    """
    if not directions:
        return {"mean_norm": 0.0, "max_norm": 0.0, "min_norm": 0.0, "std_norm": 0.0, "num_layers": 0}

    norms = [d.norm().item() for d in directions.values()]
    return {
        "mean_norm": float(np.mean(norms)),
        "max_norm": float(np.max(norms)),
        "min_norm": float(np.min(norms)),
        "std_norm": float(np.std(norms)),
        "num_layers": len(norms),
    }
