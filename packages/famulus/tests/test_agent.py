"""Tests for the agent loop -- the kernel of famulus.

These tests mock the Ollama API and verify the full consent-gated
reasoning cycle without needing a running model.
"""

from __future__ import annotations

from unittest.mock import patch

from famulus.engine.agent import Agent, AgentConfig
from famulus.engine.capability import Tier
from famulus.engine.model import ModelResponse
from famulus.engine.router import ModelRouter, ModelScore
from famulus.engine.tools import default_registry


# --- Helpers ---------------------------------------------------------------

def _fake_chat_text(content: str):
    """Return a patcher that makes chat() return plain text."""
    def _fake(*a, **kw):
        return ModelResponse(content=content, model="test")
    return patch("famulus.engine.agent.chat", side_effect=_fake)


def _fake_chat_tool_then_text(tool_calls: list[dict], final_text: str):
    """First call returns tool_calls, second returns text."""
    responses = [
        ModelResponse(content="", tool_calls=tool_calls, model="test"),
        ModelResponse(content=final_text, model="test"),
    ]
    call_count = {"n": 0}
    def _fake(*a, **kw):
        idx = min(call_count["n"], len(responses) - 1)
        call_count["n"] += 1
        return responses[idx]
    return patch("famulus.engine.agent.chat", side_effect=_fake)


def _make_agent(rec_audit, gate, model="test-model"):
    """Build an Agent with a known model and the test fixtures."""
    router = ModelRouter()
    router._scores[model] = ModelScore(name=model, capabilities=["completion", "tools"])
    config = AgentConfig(model=model)
    return Agent(default_registry(), gate, rec_audit, router, config)


# --- Plain text response ---------------------------------------------------

def test_agent_plain_text_response(rec_audit, gate_yes):
    agent = _make_agent(rec_audit, gate_yes)
    with _fake_chat_text("Hello, human!"):
        result = agent.step("hi")
    assert result == "Hello, human!"
    assert any(s.kind == "user" for s in agent.trace)
    assert any(s.kind == "assistant" for s in agent.trace)


# --- No model available ----------------------------------------------------

def test_agent_no_model(rec_audit, gate_yes):
    router = ModelRouter()
    config = AgentConfig(model="")
    agent = Agent(default_registry(), gate_yes, rec_audit, router, config)
    with patch("famulus.engine.router.list_local_models", return_value=[]), \
         patch("famulus.engine.router.show_model", return_value={}):
        result = agent.step("hello")
    assert "No model" in result


# --- READ tool auto-executed (no extra gate for READ) ----------------------

def test_agent_read_tool_executes(rec_audit, gate_yes, tmp_path):
    f = tmp_path / "test.txt"
    f.write_text("file contents here")
    tool_calls = [{"function": {"name": "file_read", "arguments": {"path": str(f)}}}]

    agent = _make_agent(rec_audit, gate_yes)
    # Start at READ ceiling -- no escalation needed
    with _fake_chat_tool_then_text(tool_calls, "I read the file."):
        result = agent.step("read test.txt")
    assert result == "I read the file."
    assert any(s.kind == "tool_result" for s in agent.trace)


# --- WRITE tool needs escalation + per-action gate -------------------------

def test_agent_write_tool_gated(rec_audit, gate_yes, tmp_path):
    out = tmp_path / "out.txt"
    tool_calls = [{
        "function": {
            "name": "file_write",
            "arguments": {"path": str(out), "content": "hello"},
        }
    }]
    agent = _make_agent(rec_audit, gate_yes)
    with _fake_chat_tool_then_text(tool_calls, "File written."):
        result = agent.step("write a file")
    assert result == "File written."
    assert out.read_text() == "hello"


def test_agent_write_tool_denied(rec_audit, gate_no, tmp_path):
    out = tmp_path / "out.txt"
    tool_calls = [{
        "function": {
            "name": "file_write",
            "arguments": {"path": str(out), "content": "hello"},
        }
    }]
    agent = _make_agent(rec_audit, gate_no)
    with _fake_chat_tool_then_text(tool_calls, "Could not write."):
        result = agent.step("write a file")
    # The file should NOT have been written
    assert not out.exists()


# --- EXEC tool needs escalation + per-action gate -------------------------

def test_agent_exec_tool_gated(rec_audit, gate_yes):
    tool_calls = [{
        "function": {
            "name": "shell_exec",
            "arguments": {"command": "echo hello"},
        }
    }]
    agent = _make_agent(rec_audit, gate_yes)
    with _fake_chat_tool_then_text(tool_calls, "Done."):
        result = agent.step("run echo")
    assert result == "Done."
    assert "agent.tool_exec" in rec_audit.names


def test_agent_exec_tool_denied(rec_audit, gate_no):
    tool_calls = [{
        "function": {
            "name": "shell_exec",
            "arguments": {"command": "rm -rf /"},
        }
    }]
    agent = _make_agent(rec_audit, gate_no)
    with _fake_chat_tool_then_text(tool_calls, "Denied."):
        agent.step("delete everything")
    assert "agent.tool_denied" in rec_audit.names or "agent.escalate_denied" in rec_audit.names


# --- Unknown tool ----------------------------------------------------------

def test_agent_unknown_tool(rec_audit, gate_yes):
    tool_calls = [{"function": {"name": "nonexistent_tool", "arguments": {}}}]
    agent = _make_agent(rec_audit, gate_yes)
    with _fake_chat_tool_then_text(tool_calls, "Tool not found."):
        result = agent.step("use unknown tool")
    assert "agent.tool_unknown" in rec_audit.names


# --- Max rounds exhaustion -------------------------------------------------

def test_agent_max_rounds_exhaustion(rec_audit, gate_yes):
    tool_calls = [{"function": {"name": "file_read", "arguments": {"path": "/dev/null"}}}]
    # Make chat always return tool calls (never plain text)
    def _always_tools(*a, **kw):
        return ModelResponse(content="", tool_calls=tool_calls, model="test")

    agent = _make_agent(rec_audit, gate_yes)
    agent.config.max_tool_rounds = 3
    with patch("famulus.engine.agent.chat", side_effect=_always_tools):
        result = agent.step("loop forever")
    assert "stopped" in result
    assert "agent.exhausted" in rec_audit.names


# --- Output handler --------------------------------------------------------

def test_agent_output_handler(rec_audit, gate_yes):
    captured = []
    agent = _make_agent(rec_audit, gate_yes)
    agent.set_output_handler(lambda t: captured.append(t))
    with _fake_chat_text("Hello!"):
        agent.step("hi")
    assert captured == ["Hello!"]


# --- CapGrant escalation is persistent within session ----------------------

def test_agent_grant_persists(rec_audit, gate_yes, tmp_path):
    """After escalating to WRITE once, subsequent WRITE calls still gate
    the specific action but don't re-prompt for tier escalation."""
    f1 = tmp_path / "a.txt"
    f2 = tmp_path / "b.txt"
    tc1 = [{"function": {"name": "file_write", "arguments": {"path": str(f1), "content": "a"}}}]
    tc2 = [{"function": {"name": "file_write", "arguments": {"path": str(f2), "content": "b"}}}]

    agent = _make_agent(rec_audit, gate_yes)

    with _fake_chat_tool_then_text(tc1, "wrote a"):
        agent.step("write a")
    assert agent.grant.ceiling >= Tier.WRITE

    with _fake_chat_tool_then_text(tc2, "wrote b"):
        agent.step("write b")
    assert f1.exists() and f2.exists()


# --- Fallback across models ------------------------------------------------

def test_agent_fallback_on_model_error(rec_audit, gate_yes):
    """When the first model errors, the agent falls back to the next one."""
    router = ModelRouter(ram_total_gb=16)
    router._scores["bad"] = ModelScore(name="bad", param_size_b=7.0, capabilities=["completion", "tools"])
    router._scores["good"] = ModelScore(name="good", param_size_b=7.0, capabilities=["completion", "tools"])
    config = AgentConfig()  # no forced model -- use router
    agent = Agent(default_registry(), gate_yes, rec_audit, router, config)

    call_count = {"n": 0}
    def _fail_then_succeed(model, *a, **kw):
        call_count["n"] += 1
        if model == "bad":
            return ModelResponse(content="[error: HTTP 400]", model=model)
        return ModelResponse(content="Success from good!", model=model)

    with patch("famulus.engine.agent.chat", side_effect=_fail_then_succeed):
        result = agent.step("hello")
    assert "Success from good!" in result
    assert "agent.model_error" in rec_audit.names


def test_agent_dispatch_to_specialist(rec_audit, gate_yes):
    """dispatch() routes to the best model for a given modality."""
    from famulus.engine.router import Modality
    router = ModelRouter(ram_total_gb=16)
    router._scores["general"] = ModelScore(name="general", param_size_b=7.0, capabilities=["completion", "tools"])
    router._scores["vision"] = ModelScore(name="vision", param_size_b=7.0, capabilities=["completion", "vision"])
    config = AgentConfig()
    agent = Agent(default_registry(), gate_yes, rec_audit, router, config)

    def _vision_handler(model, *a, **kw):
        if model == "vision":
            return ModelResponse(content="I see a cat in the image.", model=model)
        return ModelResponse(content="[error: not a vision model]", model=model)

    with patch("famulus.engine.agent.chat", side_effect=_vision_handler):
        result = agent.dispatch("describe this image", Modality.VISION)
    assert "cat" in result
    assert "agent.dispatch_done" in rec_audit.names


def test_agent_dispatch_all_fail(rec_audit, gate_yes):
    """dispatch() returns failure message when all models error for the modality."""
    from famulus.engine.router import Modality
    router = ModelRouter(ram_total_gb=16)
    router._scores["text"] = ModelScore(name="text", param_size_b=7.0, capabilities=["completion", "tools"])
    config = AgentConfig()
    agent = Agent(default_registry(), gate_yes, rec_audit, router, config)

    def _always_error(model, *a, **kw):
        return ModelResponse(content="[error: not supported]", model=model)

    with patch("famulus.engine.agent.chat", side_effect=_always_error):
        result = agent.dispatch("describe this", Modality.VISION)
    assert "failed" in result.lower()


def test_agent_all_models_fail(rec_audit, gate_yes):
    """When every model errors, the agent reports total failure."""
    router = ModelRouter(ram_total_gb=16)
    router._scores["m1"] = ModelScore(name="m1", param_size_b=7.0, capabilities=["completion", "tools"])
    router._scores["m2"] = ModelScore(name="m2", param_size_b=7.0, capabilities=["completion", "tools"])
    config = AgentConfig()
    agent = Agent(default_registry(), gate_yes, rec_audit, router, config)

    def _always_fail(model, *a, **kw):
        return ModelResponse(content="[error: nope]", model=model)

    with patch("famulus.engine.agent.chat", side_effect=_always_fail):
        result = agent.step("hello")
    assert "All available models failed" in result
    assert "agent.all_models_failed" in rec_audit.names


# --- Refusal detection and fallback ----------------------------------------

def test_agent_refusal_triggers_fallback(rec_audit, gate_yes):
    """When the first model refuses, the agent falls back to the next one."""
    router = ModelRouter(ram_total_gb=16)
    router._scores["prudish"] = ModelScore(name="prudish", param_size_b=7.0, capabilities=["completion", "tools"])
    router._scores["willing"] = ModelScore(name="willing", param_size_b=7.0, capabilities=["completion", "tools"])
    config = AgentConfig()
    agent = Agent(default_registry(), gate_yes, rec_audit, router, config)

    def _refuse_then_comply(model, *a, **kw):
        if model == "prudish":
            return ModelResponse(
                content="I'm not comfortable doing that. As an AI, I cannot access your hardware.",
                model=model,
            )
        return ModelResponse(content="Camera activated, recording now.", model=model)

    with patch("famulus.engine.agent.chat", side_effect=_refuse_then_comply):
        result = agent.step("start my camera")
    assert "Camera activated" in result
    assert "agent.model_refusal" in rec_audit.names


def test_agent_refusal_all_models_refuse(rec_audit, gate_yes):
    """When all models refuse, the agent reports total failure."""
    router = ModelRouter(ram_total_gb=16)
    router._scores["m1"] = ModelScore(name="m1", param_size_b=7.0, capabilities=["completion", "tools"])
    router._scores["m2"] = ModelScore(name="m2", param_size_b=7.0, capabilities=["completion", "tools"])
    config = AgentConfig()
    agent = Agent(default_registry(), gate_yes, rec_audit, router, config)

    def _always_refuse(model, *a, **kw):
        return ModelResponse(
            content="I cannot do that. As an AI, I do not have the capability to control your devices.",
            model=model,
        )

    with patch("famulus.engine.agent.chat", side_effect=_always_refuse):
        result = agent.step("turn on camera")
    assert "All available models failed" in result
    assert "agent.model_refusal" in rec_audit.names


def test_refusal_detection_does_not_false_positive(rec_audit, gate_yes):
    """A response that happens to mention 'cannot' in context should not be flagged."""
    from famulus.engine.agent import _is_refusal
    # Legitimate response mentioning limitations in a factual way
    assert not _is_refusal("The camera cannot focus when the lens cap is on.")
    assert not _is_refusal("I found that you cannot install this package without root.")
    # Genuine refusals
    assert _is_refusal("I'm not comfortable doing that for safety reasons.")
    assert _is_refusal("As an AI, I cannot access your hardware devices.")


# --- Swarm horse-race ------------------------------------------------------

def _swarm_agent(rec_audit, gate, models, swarm_size=3):
    """Build a swarm-enabled Agent with several scored models (no forced model)."""
    router = ModelRouter()
    for m in models:
        router._scores[m] = ModelScore(name=m, capabilities=["completion", "tools"])
    config = AgentConfig(swarm=True, swarm_size=swarm_size)
    return Agent(default_registry(), gate, rec_audit, router, config)


def _fake_chat_by_model(behaviors):
    """Patch chat() with per-model latency + content/refusal behavior.

    behaviors: dict model -> (delay_seconds, content)
    """
    import time as _t

    def _fake(model, messages, tools=None, **kw):
        delay, content = behaviors[model]
        _t.sleep(delay)
        return ModelResponse(content=content, model=model)

    return patch("famulus.engine.agent.chat", side_effect=_fake)


def test_swarm_picks_fastest_response(rec_audit, gate_yes):
    agent = _swarm_agent(rec_audit, gate_yes, ["fast", "mid", "slow"])
    behaviors = {
        "fast": (0.01, "Quick answer from fast model."),
        "mid": (0.05, "Slower answer from mid model."),
        "slow": (0.10, "Slowest answer from slow model."),
    }
    with _fake_chat_by_model(behaviors):
        result = agent.step("do it")
    assert result == "Quick answer from fast model."
    assert "agent.swarm_winner" in rec_audit.names


def test_swarm_abates_refusal_and_takes_next_fastest(rec_audit, gate_yes):
    agent = _swarm_agent(rec_audit, gate_yes, ["fast", "mid", "slow"])
    behaviors = {
        # fastest finisher refuses -> must be abated
        "fast": (0.01, "I'm sorry, but I cannot help with that request."),
        "mid": (0.05, "Here is the real answer from the mid model."),
        "slow": (0.10, "Slow answer that should not win."),
    }
    with _fake_chat_by_model(behaviors):
        result = agent.step("do it")
    assert result == "Here is the real answer from the mid model."
    assert "agent.swarm_refusal" in rec_audit.names
    assert "agent.swarm_winner" in rec_audit.names


def test_swarm_all_refuse_exhausts(rec_audit, gate_yes):
    agent = _swarm_agent(rec_audit, gate_yes, ["a", "b"])
    refusal = "I'm sorry, but I cannot assist with that request."
    behaviors = {"a": (0.01, refusal), "b": (0.02, refusal)}
    with _fake_chat_by_model(behaviors):
        result = agent.step("do it")
    assert "exhausted" in result.lower()
    assert "agent.swarm_failed" in rec_audit.names
