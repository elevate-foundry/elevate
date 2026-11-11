"""Unit tests for activation processing and heatmap generation."""

import pytest
import torch
from unittest.mock import MagicMock
from src.processing import process_activations, downsample_heatmap


class TestDownsampleHeatmap:
    def test_no_downsample_when_small(self):
        tensor = torch.randn(4, 64)
        result = downsample_heatmap(tensor, max_neurons=128)
        assert result.shape == (4, 64)

    def test_downsamples_large_tensor(self):
        tensor = torch.randn(3, 1024)
        result = downsample_heatmap(tensor, max_neurons=128)
        assert result.shape == (3, 128)

    def test_1d_input_gets_unsqueezed(self):
        tensor = torch.randn(256)
        result = downsample_heatmap(tensor, max_neurons=64)
        assert result.shape == (1, 64)

    def test_exact_multiple(self):
        tensor = torch.randn(2, 512)
        result = downsample_heatmap(tensor, max_neurons=256)
        assert result.shape == (2, 256)

    def test_values_are_mean(self):
        # 4 neurons, downsample to 2 -> chunks of 2, average each
        tensor = torch.tensor([[1.0, 3.0, 5.0, 7.0]])
        result = downsample_heatmap(tensor, max_neurons=2)
        assert result.shape == (1, 2)
        assert abs(result[0, 0].item() - 2.0) < 1e-5  # mean(1, 3)
        assert abs(result[0, 1].item() - 6.0) < 1e-5  # mean(5, 7)


class TestProcessActivations:
    def _make_config(self, hidden_size=64, num_heads=4, intermediate=128):
        config = MagicMock()
        config.hidden_size = hidden_size
        config.num_attention_heads = num_heads
        config.intermediate_size = intermediate
        return config

    def test_basic_structure(self):
        captured = {
            "layer_0": torch.randn(1, 3, 64),
            "layer_1": torch.randn(1, 3, 64),
        }
        config = self._make_config()
        result = process_activations(captured, ["The", " dog", " is"], 2, config)

        assert result["tokens"] == ["The", " dog", " is"]
        assert result["num_layers"] == 2
        assert result["hidden_size"] == 64
        assert len(result["layers"]) == 2

    def test_residual_stats(self):
        captured = {"layer_0": torch.randn(1, 3, 64)}
        config = self._make_config()
        result = process_activations(captured, ["a", "b", "c"], 1, config)

        layer = result["layers"][0]
        assert "residual" in layer
        assert len(layer["residual"]["mean"]) == 3
        assert len(layer["residual"]["std"]) == 3
        assert len(layer["residual"]["heatmap"]) == 3

    def test_gate_stats(self):
        captured = {"gate_0": torch.randn(1, 2, 128)}
        config = self._make_config()
        result = process_activations(captured, ["x", "y"], 1, config)

        layer = result["layers"][0]
        assert "gate" in layer
        assert len(layer["gate"]["firing_rate"]) == 2
        assert len(layer["gate"]["mean_activation"]) == 2

    def test_mlp_stats(self):
        captured = {"mlp_0": torch.randn(1, 2, 64)}
        config = self._make_config()
        result = process_activations(captured, ["x", "y"], 1, config)

        layer = result["layers"][0]
        assert "mlp" in layer
        assert len(layer["mlp"]["mean"]) == 2

    def test_attention_stats(self):
        captured = {"attn_0": torch.randn(1, 2, 64)}
        config = self._make_config()
        result = process_activations(captured, ["x", "y"], 1, config)

        layer = result["layers"][0]
        assert "attention" in layer
        assert len(layer["attention"]["mean"]) == 2

    def test_missing_layer_data(self):
        # No captured data at all
        config = self._make_config()
        result = process_activations({}, ["a"], 2, config)
        assert len(result["layers"]) == 2
        # Layers should exist but have no sub-dicts
        assert "residual" not in result["layers"][0]
        assert "gate" not in result["layers"][0]
