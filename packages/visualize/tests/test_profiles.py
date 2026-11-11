"""Unit tests for model architecture profile detection."""

import pytest
from unittest.mock import MagicMock, PropertyMock
from src.models.profiles import (
    ModelProfile,
    detect_profile,
    KNOWN_PROFILES,
    _resolve_attr,
)


class TestKnownProfiles:
    def test_qwen_profile_exists(self):
        assert "qwen" in KNOWN_PROFILES
        p = KNOWN_PROFILES["qwen"]
        assert p.name == "Qwen"
        assert p.layers_attr == "model.layers"
        assert p.has_gated_mlp is True

    def test_gpt2_profile_exists(self):
        assert "gpt2" in KNOWN_PROFILES
        p = KNOWN_PROFILES["gpt2"]
        assert p.name == "GPT-2"
        assert p.layers_attr == "transformer.h"
        assert p.has_gated_mlp is False
        assert p.gate_proj_attr is None

    def test_llama_profile_exists(self):
        assert "llama" in KNOWN_PROFILES
        p = KNOWN_PROFILES["llama"]
        assert p.layers_attr == "model.layers"
        assert p.gate_proj_attr == "gate_proj"

    def test_all_profiles_have_required_attrs(self):
        for name, profile in KNOWN_PROFILES.items():
            assert profile.name, f"{name} missing name"
            assert profile.layers_attr, f"{name} missing layers_attr"
            assert profile.mlp_attr, f"{name} missing mlp_attr"
            assert profile.attn_attr, f"{name} missing attn_attr"


class TestResolveAttr:
    def test_single_level(self):
        obj = MagicMock()
        obj.layers = [1, 2, 3]
        assert _resolve_attr(obj, "layers") == [1, 2, 3]

    def test_nested_level(self):
        obj = MagicMock()
        obj.model.layers = [1, 2]
        assert _resolve_attr(obj, "model.layers") == [1, 2]

    def test_missing_attr_raises(self):
        obj = MagicMock(spec=[])
        with pytest.raises(AttributeError):
            _resolve_attr(obj, "nonexistent.attr")


class TestDetectProfile:
    def test_direct_match(self):
        model = MagicMock()
        model.config.model_type = "qwen3"
        profile = detect_profile(model)
        assert profile.name == "Qwen"

    def test_exact_match(self):
        model = MagicMock()
        model.config.model_type = "gpt2"
        profile = detect_profile(model)
        assert profile.name == "GPT-2"

    def test_llama_match(self):
        model = MagicMock()
        model.config.model_type = "llama"
        profile = detect_profile(model)
        assert profile.name == "Llama"

    def test_substring_match(self):
        model = MagicMock()
        model.config.model_type = "mistral-7b"
        profile = detect_profile(model)
        assert profile.name == "Mistral"

    def test_unknown_type_falls_back(self):
        model = MagicMock()
        model.config.model_type = "totally_unknown_model"
        # Should try to probe layer paths and fall back
        profile = detect_profile(model)
        assert profile is not None
