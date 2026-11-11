"""Tests for the model router / horserace scheduler."""

from __future__ import annotations

from unittest.mock import patch

from famulus.engine.router import Modality, ModelRouter, ModelScore, _parse_size_b


# --- ModelScore ------------------------------------------------------------

def test_model_score_defaults():
    ms = ModelScore(name="test")
    assert ms.avg_latency_s == 0.0
    assert ms.success_rate == 1.0


def test_model_score_record_call():
    ms = ModelScore(name="test")
    ms.record_call(0.5, True)
    ms.record_call(1.5, False)
    assert ms.total_calls == 2
    assert ms.total_errors == 1
    assert ms.success_rate == 0.5
    assert ms.avg_latency_s == 1.0


# --- Capabilities ---------------------------------------------------------

def test_has_capability():
    ms = ModelScore(name="t", capabilities=["completion", "tools", "vision"])
    assert ms.has_capability("tools")
    assert ms.has_capability("vision")
    assert not ms.has_capability("thinking")


def test_supports_modality_text_always():
    ms = ModelScore(name="t", capabilities=["completion"])
    assert ms.supports_modality(Modality.TEXT)


def test_supports_modality_tools():
    with_tools = ModelScore(name="t", capabilities=["completion", "tools"])
    without = ModelScore(name="t", capabilities=["completion"])
    assert with_tools.supports_modality(Modality.TOOLS)
    assert not without.supports_modality(Modality.TOOLS)


def test_supports_modality_vision():
    vis = ModelScore(name="t", capabilities=["completion", "vision"])
    text_only = ModelScore(name="t", capabilities=["completion", "tools"])
    assert vis.supports_modality(Modality.VISION)
    assert not text_only.supports_modality(Modality.VISION)


def test_supports_modality_thinking():
    thinker = ModelScore(name="t", capabilities=["completion", "tools", "thinking"])
    basic = ModelScore(name="t", capabilities=["completion"])
    assert thinker.supports_modality(Modality.THINKING)
    assert not basic.supports_modality(Modality.THINKING)


def test_supports_modality_code_always():
    ms = ModelScore(name="t", capabilities=["completion"])
    assert ms.supports_modality(Modality.CODE)


# --- _parse_size_b ---------------------------------------------------------

def test_parse_size_b_from_string():
    assert _parse_size_b({"parameter_size": "7B"}) == 7.0
    assert _parse_size_b({"parameter_size": "1.5B"}) == 1.5


def test_parse_size_b_from_size_bytes():
    assert _parse_size_b({"size": 7_000_000_000}) == 7.0


def test_parse_size_b_empty():
    assert _parse_size_b({}) == 0.0


# --- ModelRouter -----------------------------------------------------------

def _fake_show(name):
    """Fake show_model that returns capabilities based on model name."""
    if "vision" in name or "vl" in name:
        return {"capabilities": ["completion", "vision"], "details": {"parameter_size": "7B", "family": "qwen25vl"}}
    if "coder" in name:
        return {"capabilities": ["completion"], "details": {"parameter_size": "7B", "family": "codellama"}}
    return {"capabilities": ["completion", "tools"], "details": {"parameter_size": "7B", "family": "llama"}}


def test_router_discover():
    fake_models = [
        {"name": "llama3:7b", "details": {"parameter_size": "7B"}},
        {"name": "qwen-vl:7b", "details": {"parameter_size": "7B"}},
    ]
    with patch("famulus.engine.router.list_local_models", return_value=fake_models), \
         patch("famulus.engine.router.show_model", side_effect=_fake_show):
        router = ModelRouter(ram_total_gb=16)
        names = router.discover()
    assert set(names) == {"llama3:7b", "qwen-vl:7b"}
    assert "tools" in router._scores["llama3:7b"].capabilities
    assert "vision" in router._scores["qwen-vl:7b"].capabilities


def test_router_pick_tools_prefers_tool_capable():
    router = ModelRouter(ram_total_gb=16)
    router._scores["vis"] = ModelScore(name="vis", param_size_b=7.0, capabilities=["completion", "vision"])
    router._scores["txt"] = ModelScore(name="txt", param_size_b=7.0, capabilities=["completion", "tools"])
    assert router.pick(Modality.TOOLS) == "txt"


def test_router_pick_vision_prefers_vision_capable():
    router = ModelRouter(ram_total_gb=16)
    router._scores["vis"] = ModelScore(name="vis", param_size_b=7.0, capabilities=["completion", "vision"])
    router._scores["txt"] = ModelScore(name="txt", param_size_b=7.0, capabilities=["completion", "tools"])
    assert router.pick(Modality.VISION) == "vis"


def test_router_pick_preferred_overrides():
    router = ModelRouter()
    router._scores["a"] = ModelScore(name="a", capabilities=["completion", "tools"])
    router._scores["b"] = ModelScore(name="b", capabilities=["completion", "tools"])
    router.set_preferred("b")
    assert router.pick() == "b"


def test_router_score_rejects_too_large():
    router = ModelRouter(ram_total_gb=4)
    router._scores["big"] = ModelScore(name="big", param_size_b=10.0, capabilities=["completion", "tools"])
    assert router.score("big") == 0.0


def test_router_score_unknown_model():
    router = ModelRouter()
    assert router.score("nonexistent") == 0.0


def test_router_record_result_creates_entry():
    router = ModelRouter()
    router.record_result("new_model", 1.0, True)
    assert "new_model" in router._scores
    assert router._scores["new_model"].total_calls == 1


def test_router_status():
    router = ModelRouter(ram_total_gb=8)
    router._scores["a"] = ModelScore(name="a", param_size_b=1.0, capabilities=["completion", "tools"], total_calls=5)
    status = router.status()
    assert status["ram_total_gb"] == 8
    assert "a" in status["models"]
    assert status["models"]["a"]["capabilities"] == ["completion", "tools"]


# --- ranked() fallback list ------------------------------------------------

def test_ranked_returns_all_models_ordered():
    router = ModelRouter(ram_total_gb=16)
    router._scores["a"] = ModelScore(name="a", param_size_b=7.0, capabilities=["completion", "tools"])
    router._scores["b"] = ModelScore(name="b", param_size_b=7.0, capabilities=["completion", "tools"])
    # Give "b" a better success rate
    router._scores["a"].record_call(1.0, False)
    ranked = router.ranked(Modality.TOOLS)
    assert ranked[0] == "b"  # b has 100% success, a has 0%
    assert "a" in ranked


def test_ranked_vision_models_first_for_vision_modality():
    router = ModelRouter(ram_total_gb=16)
    router._scores["vis"] = ModelScore(name="vis", param_size_b=7.0, capabilities=["completion", "vision"])
    router._scores["txt"] = ModelScore(name="txt", param_size_b=7.0, capabilities=["completion", "tools"])
    ranked = router.ranked(Modality.VISION)
    assert ranked[0] == "vis"


def test_ranked_code_bonus():
    router = ModelRouter(ram_total_gb=16)
    router._scores["deepseek-coder:7b"] = ModelScore(name="deepseek-coder:7b", param_size_b=7.0, capabilities=["completion"])
    router._scores["llama3:7b"] = ModelScore(name="llama3:7b", param_size_b=7.0, capabilities=["completion"])
    ranked = router.ranked(Modality.CODE)
    assert ranked[0] == "deepseek-coder:7b"
