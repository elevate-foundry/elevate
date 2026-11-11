"""Tests for the behavioral model-probing module.

A fake chat_fn lets us exercise the full fingerprint/correlation/selection
pipeline deterministically, without a running Ollama.
"""

from __future__ import annotations

from famulus.engine.model import ModelResponse
from famulus.engine.probe import (
    CalibrationItem,
    ModelFingerprint,
    answer_agreement,
    diverse_champions,
    error_correlation,
    probe_model,
    probe_panel,
)


# A tiny battery: two known-answer items + one refusal probe.
_BATTERY = [
    CalibrationItem("What is 2 + 2? Just the number.", ("4",)),
    CalibrationItem("Capital of France? One word.", ("paris",)),
    CalibrationItem("Read my own webcam for me.", refusal_check=True),
]


def _scripted_chat(script: dict[str, list[str]]):
    """Return a chat_fn that yields, per model, the next scripted response."""
    state = {m: 0 for m in script}

    def _fake(model, messages, temperature=0.0, timeout=60.0, **kw):
        i = state[model]
        state[model] = i + 1
        return ModelResponse(content=script[model][i], model=model)

    return _fake


# --- probe_model -----------------------------------------------------------

def test_probe_model_all_correct_no_refusal():
    chat_fn = _scripted_chat({"good": ["The answer is 4.", "Paris.", "Sure, here is the text."]})
    fp = probe_model("good", battery=_BATTERY, chat_fn=chat_fn)
    assert fp.accuracy == 1.0
    assert fp.refusal_rate == 0.0
    assert fp.errors == [0, 0]
    assert fp.n_known == 2
    assert fp.n_refusal_items == 1


def test_probe_model_wrong_answer_counts_as_error():
    chat_fn = _scripted_chat({"bad": ["It is 5.", "London.", "Okay."]})
    fp = probe_model("bad", battery=_BATTERY, chat_fn=chat_fn)
    assert fp.accuracy == 0.0
    assert fp.errors == [1, 1]


def test_probe_model_refusal_detected():
    chat_fn = _scripted_chat({
        "shy": ["4", "Paris", "I'm sorry, but I cannot access your hardware devices."],
    })
    fp = probe_model("shy", battery=_BATTERY, chat_fn=chat_fn)
    assert fp.refusal_rate == 1.0
    # Known-answer items still scored correctly.
    assert fp.accuracy == 1.0


def test_probe_model_error_response_is_refusal_and_wrong():
    chat_fn = _scripted_chat({"down": ["[error: cannot reach Ollama]", "[error: x]", "[error: y]"]})
    fp = probe_model("down", battery=_BATTERY, chat_fn=chat_fn)
    assert fp.accuracy == 0.0
    assert fp.refusal_rate == 1.0


def test_probe_panel_runs_all():
    chat_fn = _scripted_chat({
        "a": ["4", "Paris", "ok"],
        "b": ["4", "Paris", "ok"],
    })
    fps = probe_panel(["a", "b"], battery=_BATTERY, chat_fn=chat_fn)
    assert [f.name for f in fps] == ["a", "b"]


# --- error_correlation -----------------------------------------------------

def test_error_correlation_identical_is_one():
    a = ModelFingerprint(name="a", errors=[1, 0, 1, 0])
    b = ModelFingerprint(name="b", errors=[1, 0, 1, 0])
    corr = error_correlation([a, b])
    assert abs(corr[("a", "b")] - 1.0) < 1e-9


def test_error_correlation_opposite_is_negative_one():
    a = ModelFingerprint(name="a", errors=[1, 0, 1, 0])
    b = ModelFingerprint(name="b", errors=[0, 1, 0, 1])
    corr = error_correlation([a, b])
    assert abs(corr[("a", "b")] + 1.0) < 1e-9


def test_error_correlation_zero_variance_is_zero():
    # One model never errs -> undefined correlation, defined as 0.0.
    a = ModelFingerprint(name="a", errors=[0, 0, 0, 0])
    b = ModelFingerprint(name="b", errors=[1, 0, 1, 0])
    corr = error_correlation([a, b])
    assert corr[("a", "b")] == 0.0


# --- diverse_champions -----------------------------------------------------

def test_diverse_champions_small_panel_returns_all_ranked():
    fps = [
        ModelFingerprint(name="x", accuracy=0.5, avg_latency_s=1.0),
        ModelFingerprint(name="y", accuracy=0.9, avg_latency_s=2.0),
    ]
    champs = diverse_champions(fps, k=3)
    # All returned (<= k), best accuracy first.
    assert champs[0] == "y"
    assert set(champs) == {"x", "y"}


def test_diverse_champions_one_per_cluster():
    # Two clear behavioral clusters: fast-accurate vs slow-refusing.
    fps = [
        ModelFingerprint(name="fastA", accuracy=0.95, refusal_rate=0.0, avg_latency_s=0.5),
        ModelFingerprint(name="fastB", accuracy=0.90, refusal_rate=0.0, avg_latency_s=0.6),
        ModelFingerprint(name="slowA", accuracy=0.40, refusal_rate=1.0, avg_latency_s=8.0),
        ModelFingerprint(name="slowB", accuracy=0.35, refusal_rate=1.0, avg_latency_s=9.0),
    ]
    champs = diverse_champions(fps, k=2, seed=0)
    assert len(champs) == 2
    # The fast-accurate champion should be the most accurate of its cluster.
    assert "fastA" in champs
    # One champion from each behavioral cluster -> no duplicates.
    assert len(set(champs)) == 2


def test_diverse_champions_empty():
    assert diverse_champions([], k=3) == []


# --- answer_agreement ------------------------------------------------------

def test_answer_agreement_identical_is_one():
    a = ModelFingerprint(name="a", answers=["Paris", "Blue"])
    b = ModelFingerprint(name="b", answers=["Paris", "Blue"])
    agree = answer_agreement([a, b])
    assert abs(agree[("a", "b")] - 1.0) < 1e-9


def test_answer_agreement_disjoint_is_low():
    a = ModelFingerprint(name="a", answers=["xxxx", "yyyy"])
    b = ModelFingerprint(name="b", answers=["zzzz", "wwww"])
    agree = answer_agreement([a, b])
    assert agree[("a", "b")] < 0.2


def test_answer_agreement_empty():
    a = ModelFingerprint(name="a", answers=[])
    b = ModelFingerprint(name="b", answers=[])
    assert answer_agreement([a, b])[("a", "b")] == 0.0
