"""Unit tests for directional ablation math and metrics."""

import pytest
import torch
import numpy as np
from unittest.mock import MagicMock
from src.ablation.directional import compute_directions
from src.ablation.prompts import make_concept_prompts, make_baseline_prompts
from src.ablation.metrics import (
    kl_divergence,
    concept_recall,
    direction_magnitude_stats,
)


class TestComputeDirections:
    def _make_mock_backend(self, num_layers=4, hidden_size=16, num_concept=3, num_baseline=3):
        """Create a mock backend with deterministic residuals."""
        backend = MagicMock()
        backend.device = "cpu"

        # Create concept residuals that are distinguishable from baseline
        concept_residuals = torch.randn(num_concept, num_layers, hidden_size)
        concept_residuals += 2.0  # shift concept mean up
        baseline_residuals = torch.randn(num_baseline, num_layers, hidden_size)

        backend.collect_residuals = MagicMock(
            side_effect=[concept_residuals, baseline_residuals]
        )
        return backend

    def test_returns_expected_keys(self):
        backend = self._make_mock_backend()
        result = compute_directions(backend, ["c1", "c2", "c3"], ["b1", "b2", "b3"])

        assert "directions" in result
        assert "cosine_sims" in result
        assert "norms" in result
        assert "concept_mean_norms" in result
        assert "baseline_mean_norms" in result

    def test_directions_are_normalized(self):
        backend = self._make_mock_backend()
        result = compute_directions(backend, ["c1", "c2", "c3"], ["b1", "b2", "b3"])

        for layer_idx, direction in result["directions"].items():
            norm = direction.norm().item()
            assert abs(norm - 1.0) < 1e-4, f"Layer {layer_idx} direction not normalized: {norm}"

    def test_correct_number_of_layers(self):
        backend = self._make_mock_backend(num_layers=6)
        result = compute_directions(backend, ["c1"], ["b1"])
        assert len(result["cosine_sims"]) == 6
        assert len(result["norms"]) == 6

    def test_identical_residuals_produce_zero_norm(self):
        backend = MagicMock()
        backend.device = "cpu"
        same_data = torch.randn(2, 3, 8)
        backend.collect_residuals = MagicMock(side_effect=[same_data.clone(), same_data.clone()])

        result = compute_directions(backend, ["c1", "c2"], ["b1", "b2"])

        # All norms should be ~0 (within float precision)
        for norm in result["norms"]:
            assert norm < 1e-6

    def test_directions_on_correct_device(self):
        backend = self._make_mock_backend()
        result = compute_directions(backend, ["c1"], ["b1"])
        for direction in result["directions"].values():
            assert direction.device == torch.device("cpu")


class TestPrompts:
    def test_concept_prompts_contain_concept(self):
        prompts = make_concept_prompts("dog")
        assert all("dog" in p.lower() for p in prompts)
        assert len(prompts) == 8

    def test_baseline_prompts_are_generic(self):
        prompts = make_baseline_prompts()
        assert len(prompts) == 8
        # Baseline shouldn't contain common test concepts
        all_text = " ".join(prompts).lower()
        assert "dog" not in all_text

    def test_different_concepts_produce_different_prompts(self):
        dog_prompts = make_concept_prompts("dog")
        math_prompts = make_concept_prompts("math")
        assert dog_prompts != math_prompts


class TestKLDivergence:
    def test_identical_distributions(self):
        logits = torch.randn(5, 100)
        kl = kl_divergence(logits, logits)
        assert abs(kl) < 1e-5

    def test_different_distributions_positive(self):
        logits_a = torch.randn(5, 100)
        logits_b = torch.randn(5, 100) + 5.0
        kl = kl_divergence(logits_a, logits_b)
        assert kl > 0

    def test_kl_not_symmetric(self):
        logits_a = torch.randn(5, 50)
        logits_b = torch.randn(5, 50) + 2.0
        kl_ab = kl_divergence(logits_a, logits_b)
        kl_ba = kl_divergence(logits_b, logits_a)
        # KL divergence is generally not symmetric
        assert kl_ab != kl_ba or abs(kl_ab - kl_ba) < 1e-5


class TestConceptRecall:
    def test_concept_present(self):
        score = concept_recall("The dog ran across the field", "dog")
        assert score == 1.0

    def test_concept_absent(self):
        score = concept_recall("The cat sat on a mat", "dog")
        assert score == 0.0

    def test_case_insensitive(self):
        score = concept_recall("A Dog is here", "dog")
        assert score == 1.0

    def test_multiple_probe_words(self):
        score = concept_recall(
            "The puppy and the canine played",
            "dog",
            probe_words=["dog", "puppy", "canine"],
        )
        assert abs(score - 2.0 / 3.0) < 1e-5  # puppy and canine found, not dog


class TestDirectionMagnitudeStats:
    def test_empty_directions(self):
        stats = direction_magnitude_stats({})
        assert stats["mean_norm"] == 0.0
        assert stats["num_layers"] == 0

    def test_single_direction(self):
        d = torch.tensor([3.0, 4.0])  # norm = 5
        stats = direction_magnitude_stats({0: d})
        assert abs(stats["mean_norm"] - 5.0) < 1e-4
        assert stats["num_layers"] == 1

    def test_multiple_directions(self):
        d1 = torch.tensor([1.0, 0.0])  # norm = 1
        d2 = torch.tensor([0.0, 2.0])  # norm = 2
        stats = direction_magnitude_stats({0: d1, 1: d2})
        assert abs(stats["mean_norm"] - 1.5) < 1e-4
        assert abs(stats["max_norm"] - 2.0) < 1e-4
        assert abs(stats["min_norm"] - 1.0) < 1e-4
        assert stats["num_layers"] == 2
