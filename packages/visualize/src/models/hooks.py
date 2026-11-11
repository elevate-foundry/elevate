"""Activation hook management for capturing intermediate representations.

Registers forward hooks on transformer layers to capture activations
from attention, MLP, gate projection, and full layer outputs.
"""

from __future__ import annotations

import logging
from typing import Any

import torch

from src.models.profiles import ModelProfile, _resolve_attr

logger = logging.getLogger(__name__)


class HookManager:
    """Manages forward hooks for activation capture across transformer layers."""

    def __init__(self):
        self._hooks: list[torch.utils.hooks.RemovableHook] = []
        self._ablation_hooks: list[torch.utils.hooks.RemovableHook] = []
        self.captured: dict[str, torch.Tensor] = {}

    def register(self, model: torch.nn.Module, profile: ModelProfile) -> int:
        """Register activation capture hooks on all layers.

        Returns the number of hooks registered.
        """
        self.remove_all()
        layers = _resolve_attr(model, profile.layers_attr)

        for layer_idx, layer in enumerate(layers):
            # Attention output hook (returns tuple: hidden_states, attn_weights, ...)
            attn = getattr(layer, profile.attn_attr, None)
            if attn is not None:
                h = attn.register_forward_hook(self._make_hook(f"attn_{layer_idx}", unpack_tuple=True))
                self._hooks.append(h)

            # MLP output hook
            mlp = getattr(layer, profile.mlp_attr, None)
            if mlp is not None:
                h = mlp.register_forward_hook(self._make_hook(f"mlp_{layer_idx}"))
                self._hooks.append(h)

            # Full layer output hook (residual stream)
            h = layer.register_forward_hook(self._make_hook(f"layer_{layer_idx}", unpack_tuple=True))
            self._hooks.append(h)

            # Gate projection hook (for gated MLPs like SwiGLU)
            if profile.gate_proj_attr and mlp is not None:
                gate = getattr(mlp, profile.gate_proj_attr, None)
                if gate is not None:
                    h = gate.register_forward_hook(self._make_hook(f"gate_{layer_idx}"))
                    self._hooks.append(h)

        logger.info(f"Registered {len(self._hooks)} hooks across {len(layers)} layers")
        return len(self._hooks)

    def _make_hook(self, key: str, unpack_tuple: bool = False):
        """Create a forward hook that captures output to self.captured[key]."""
        captured = self.captured

        def hook(module: torch.nn.Module, input: Any, output: Any) -> None:
            if unpack_tuple and isinstance(output, tuple):
                tensor = output[0]
            else:
                tensor = output
            captured[key] = tensor.detach().cpu().float()

        return hook

    def clear(self) -> None:
        """Clear all captured activations."""
        self.captured.clear()

    def remove_all(self) -> None:
        """Remove all activation capture hooks."""
        for h in self._hooks:
            h.remove()
        self._hooks.clear()
        self.captured.clear()

    # ── Ablation hooks ─────────────────────────────────────────────────

    def install_ablation(
        self,
        model: torch.nn.Module,
        profile: ModelProfile,
        directions: dict[int, torch.Tensor],
        alpha: float = 1.0,
    ) -> int:
        """Install directional ablation hooks that project out concept directions.

        At each layer, for hidden state h and concept direction d:
            h_ablated = h - alpha * (h . d) * d

        Returns the number of ablation hooks installed.
        """
        self.remove_ablation()
        layers = _resolve_attr(model, profile.layers_attr)

        for layer_idx, direction in directions.items():
            if layer_idx >= len(layers):
                continue
            layer = layers[layer_idx]

            def make_projection_hook(d: torch.Tensor, a: float):
                def hook(module, input, output):
                    if isinstance(output, tuple):
                        hidden = output[0]
                    else:
                        hidden = output
                    proj = torch.einsum("...h,h->...", hidden, d).unsqueeze(-1) * d
                    hidden_ablated = hidden - a * proj
                    if isinstance(output, tuple):
                        return (hidden_ablated,) + output[1:]
                    return hidden_ablated
                return hook

            h = layer.register_forward_hook(make_projection_hook(direction, alpha))
            self._ablation_hooks.append(h)

        logger.info(f"Installed directional ablation on {len(self._ablation_hooks)} layers (alpha={alpha})")
        return len(self._ablation_hooks)

    def remove_ablation(self) -> None:
        """Remove all ablation hooks."""
        for h in self._ablation_hooks:
            h.remove()
        self._ablation_hooks.clear()

    @property
    def num_hooks(self) -> int:
        return len(self._hooks)

    @property
    def num_ablation_hooks(self) -> int:
        return len(self._ablation_hooks)
