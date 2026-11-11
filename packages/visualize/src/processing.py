"""Activation processing and visualization data preparation.

Converts raw captured activation tensors into JSON-serializable dicts
suitable for the frontend heatmaps, firing rate charts, etc.
"""

from __future__ import annotations

import torch


def downsample_heatmap(tensor: torch.Tensor, max_neurons: int = 128) -> torch.Tensor:
    """Downsample a [seq_len, hidden_dim] tensor to [seq_len, max_neurons] for visualization."""
    if tensor.dim() == 1:
        tensor = tensor.unsqueeze(0)
    seq_len, hidden_dim = tensor.shape
    if hidden_dim <= max_neurons:
        return tensor
    chunk_size = hidden_dim // max_neurons
    trimmed = tensor[:, : chunk_size * max_neurons]
    return trimmed.reshape(seq_len, max_neurons, chunk_size).mean(dim=-1)


def process_activations(
    captured: dict[str, torch.Tensor],
    tokens: list[str],
    num_layers: int,
    config,
) -> dict:
    """Process captured activations into visualization-ready data.

    Args:
        captured: dict of activation tensors from HookManager
        tokens: list of token strings for this step
        num_layers: number of transformer layers
        config: model config object (has hidden_size, num_attention_heads, etc.)

    Returns a dict with layer-by-layer activation statistics and heatmaps.
    """
    result = {
        "tokens": tokens,
        "num_layers": num_layers,
        "hidden_size": config.hidden_size,
        "num_attention_heads": config.num_attention_heads,
        "intermediate_size": getattr(config, "intermediate_size", 3072),
        "layers": [],
    }

    for layer_idx in range(num_layers):
        layer_data = {"layer_idx": layer_idx}

        key = f"layer_{layer_idx}"
        if key in captured:
            act = captured[key].squeeze(0)
            layer_data["residual"] = {
                "mean": act.mean(dim=-1).tolist(),
                "std": act.std(dim=-1).tolist(),
                "max": act.max(dim=-1).values.tolist(),
                "min": act.min(dim=-1).values.tolist(),
                "heatmap": downsample_heatmap(act, max_neurons=128).tolist(),
            }

        key = f"mlp_{layer_idx}"
        if key in captured:
            act = captured[key].squeeze(0)
            layer_data["mlp"] = {
                "mean": act.mean(dim=-1).tolist(),
                "std": act.std(dim=-1).tolist(),
                "max": act.max(dim=-1).values.tolist(),
                "l2_norm": act.norm(dim=-1).tolist(),
                "heatmap": downsample_heatmap(act, max_neurons=128).tolist(),
            }

        key = f"gate_{layer_idx}"
        if key in captured:
            act = captured[key].squeeze(0)
            gate_values = torch.nn.functional.silu(act)
            threshold = 0.1
            firing_mask = (gate_values.abs() > threshold).float()
            layer_data["gate"] = {
                "firing_rate": firing_mask.mean(dim=-1).tolist(),
                "mean_activation": gate_values.mean(dim=-1).tolist(),
                "max_activation": gate_values.max(dim=-1).values.tolist(),
                "heatmap": downsample_heatmap(gate_values, max_neurons=256).tolist(),
                "firing_heatmap": downsample_heatmap(firing_mask, max_neurons=256).tolist(),
            }

        key = f"attn_{layer_idx}"
        if key in captured:
            act = captured[key].squeeze(0)
            layer_data["attention"] = {
                "mean": act.mean(dim=-1).tolist(),
                "std": act.std(dim=-1).tolist(),
                "l2_norm": act.norm(dim=-1).tolist(),
                "heatmap": downsample_heatmap(act, max_neurons=128).tolist(),
            }

        result["layers"].append(layer_data)

    return result
