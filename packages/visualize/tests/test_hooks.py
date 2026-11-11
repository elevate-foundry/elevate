"""Unit tests for the HookManager."""

import pytest
import torch
import torch.nn as nn
from src.models.hooks import HookManager
from src.models.profiles import ModelProfile


def _make_simple_model(num_layers=3, hidden_size=16):
    """Create a simple model matching the Qwen-like profile structure."""

    class SimpleMLP(nn.Module):
        def __init__(self, h):
            super().__init__()
            self.gate_proj = nn.Linear(h, h * 2, bias=False)
            self.up_proj = nn.Linear(h, h * 2, bias=False)
            self.down_proj = nn.Linear(h * 2, h, bias=False)

        def forward(self, x):
            gate = self.gate_proj(x)
            up = self.up_proj(x)
            return self.down_proj(torch.nn.functional.silu(gate) * up)

    class SimpleAttn(nn.Module):
        def __init__(self, h):
            super().__init__()
            self.proj = nn.Linear(h, h, bias=False)

        def forward(self, x):
            return (self.proj(x), None)  # returns tuple like real attn

    class SimpleLayer(nn.Module):
        def __init__(self, h):
            super().__init__()
            self.self_attn = SimpleAttn(h)
            self.mlp = SimpleMLP(h)

        def forward(self, x):
            attn_out, _ = self.self_attn(x)
            return (x + self.mlp(attn_out),)  # returns tuple like real layer

    class SimpleModel(nn.Module):
        def __init__(self, n, h):
            super().__init__()
            self.model = nn.Module()
            self.model.layers = nn.ModuleList([SimpleLayer(h) for _ in range(n)])

        def forward(self, x):
            for layer in self.model.layers:
                x = layer(x)[0]
            return x

    return SimpleModel(num_layers, hidden_size)


PROFILE = ModelProfile(
    name="Test",
    layers_attr="model.layers",
    mlp_attr="mlp",
    attn_attr="self_attn",
    gate_proj_attr="gate_proj",
    has_gated_mlp=True,
)


class TestHookManager:
    def test_register_hooks(self):
        model = _make_simple_model(3, 16)
        hm = HookManager()
        count = hm.register(model, PROFILE)
        # 4 hooks per layer: attn, mlp, layer, gate
        assert count == 12
        assert hm.num_hooks == 12

    def test_capture_activations(self):
        model = _make_simple_model(2, 8)
        hm = HookManager()
        hm.register(model, PROFILE)

        x = torch.randn(1, 4, 8)
        model(x)

        # Check that activations were captured for each layer
        assert "layer_0" in hm.captured
        assert "layer_1" in hm.captured
        assert "mlp_0" in hm.captured
        assert "attn_0" in hm.captured
        assert "gate_0" in hm.captured

    def test_captured_shapes(self):
        model = _make_simple_model(2, 8)
        hm = HookManager()
        hm.register(model, PROFILE)

        x = torch.randn(1, 3, 8)
        model(x)

        # layer output should be [batch, seq, hidden]
        assert hm.captured["layer_0"].shape == (1, 3, 8)
        # gate output should be [batch, seq, intermediate]
        assert hm.captured["gate_0"].shape == (1, 3, 16)  # 8 * 2

    def test_clear(self):
        model = _make_simple_model(2, 8)
        hm = HookManager()
        hm.register(model, PROFILE)

        model(torch.randn(1, 2, 8))
        assert len(hm.captured) > 0

        hm.clear()
        assert len(hm.captured) == 0

    def test_remove_all(self):
        model = _make_simple_model(2, 8)
        hm = HookManager()
        hm.register(model, PROFILE)
        assert hm.num_hooks > 0

        hm.remove_all()
        assert hm.num_hooks == 0

        # Hooks should no longer capture
        model(torch.randn(1, 2, 8))
        assert len(hm.captured) == 0


class TestAblationHooks:
    def test_install_ablation(self):
        model = _make_simple_model(3, 8)
        hm = HookManager()
        hm.register(model, PROFILE)

        directions = {
            0: torch.randn(8),
            2: torch.randn(8),
        }
        count = hm.install_ablation(model, PROFILE, directions, alpha=1.0)
        assert count == 2
        assert hm.num_ablation_hooks == 2

    def test_ablation_changes_output(self):
        model = _make_simple_model(2, 8)
        hm = HookManager()
        hm.register(model, PROFILE)

        x = torch.randn(1, 3, 8)

        # Normal output
        out_normal = model(x).detach()

        # Install ablation on layer 0
        direction = torch.nn.functional.normalize(torch.randn(8), dim=0)
        hm.install_ablation(model, PROFILE, {0: direction}, alpha=1.0)

        out_ablated = model(x).detach()

        # Outputs should differ
        assert not torch.allclose(out_normal, out_ablated, atol=1e-6)

    def test_remove_ablation(self):
        model = _make_simple_model(2, 8)
        hm = HookManager()
        hm.register(model, PROFILE)

        direction = torch.nn.functional.normalize(torch.randn(8), dim=0)
        hm.install_ablation(model, PROFILE, {0: direction}, alpha=1.0)
        assert hm.num_ablation_hooks == 1

        hm.remove_ablation()
        assert hm.num_ablation_hooks == 0

    def test_ablation_alpha_zero_is_identity(self):
        model = _make_simple_model(2, 8)
        hm = HookManager()
        hm.register(model, PROFILE)

        x = torch.randn(1, 3, 8)
        out_normal = model(x).detach()

        direction = torch.nn.functional.normalize(torch.randn(8), dim=0)
        hm.install_ablation(model, PROFILE, {0: direction}, alpha=0.0)

        out_alpha0 = model(x).detach()

        assert torch.allclose(out_normal, out_alpha0, atol=1e-5)
