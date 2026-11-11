"""Tests for conversation memory."""

from __future__ import annotations

from famulus.engine.capability import Tier, ToolSpec
from famulus.engine.memory import (
    ConversationMemory,
    build_system_prompt,
    gather_system_facts,
    _format_tool_manifest,
)
from famulus.engine.model import Message


def test_memory_starts_with_system():
    mem = ConversationMemory()
    assert len(mem.messages) == 1
    assert mem.messages[0].role == "system"


def test_add_user_and_assistant():
    mem = ConversationMemory()
    mem.add_user("hello")
    mem.add_assistant("hi there")
    assert len(mem.messages) == 3
    assert mem.messages[1].role == "user"
    assert mem.messages[2].role == "assistant"


def test_add_tool_result():
    mem = ConversationMemory()
    mem.add_tool_result("call_1", '{"output": "ok"}')
    assert mem.messages[-1].role == "tool"
    assert mem.messages[-1].tool_call_id == "call_1"


def test_trim_preserves_system():
    mem = ConversationMemory(max_messages=5)
    for i in range(20):
        mem.add_user(f"msg {i}")
    assert len(mem.messages) == 5
    assert mem.messages[0].role == "system"


def test_to_messages_is_copy():
    mem = ConversationMemory()
    msgs = mem.to_messages()
    msgs.append(Message(role="user", content="extra"))
    assert len(mem.messages) == 1  # original unchanged


def test_save_and_load(tmp_path):
    mem = ConversationMemory()
    mem.add_user("test prompt")
    mem.add_assistant("test response")
    path = tmp_path / "conv.json"
    mem.save(path)

    loaded = ConversationMemory.load(path)
    assert len(loaded.messages) == 3
    assert loaded.messages[1].content == "test prompt"
    assert loaded.messages[2].content == "test response"


def test_load_missing_file(tmp_path):
    mem = ConversationMemory.load(tmp_path / "nope.json")
    assert len(mem.messages) == 1  # fresh with system prompt


def test_clear():
    mem = ConversationMemory()
    mem.add_user("a")
    mem.add_user("b")
    mem.clear()
    assert len(mem.messages) == 1
    assert mem.messages[0].role == "system"


def test_update_system_prompt():
    mem = ConversationMemory(system_prompt="old prompt")
    mem.add_user("hello")
    mem.update_system_prompt("new prompt")
    assert mem.messages[0].content == "new prompt"
    assert mem.system_prompt == "new prompt"
    assert len(mem.messages) == 2  # system + user still there


# --- Dynamic system prompt builder ----------------------------------------

def test_gather_system_facts_has_expected_keys():
    facts = gather_system_facts()
    for key in ("hostname", "os", "arch", "user", "home", "cwd", "shell"):
        assert key in facts, f"missing key: {key}"
    assert facts["hostname"]  # non-empty


def test_build_system_prompt_includes_tools():
    tools = [
        ToolSpec(name="file_read", tier=Tier.READ, description="Read a file.",
                 parameters={"path": {"type": "string", "required": True}}),
        ToolSpec(name="shell_exec", tier=Tier.EXEC, description="Run a command.",
                 parameters={"command": {"type": "string", "required": True}}),
    ]
    prompt = build_system_prompt(tools=tools)
    assert "file_read" in prompt
    assert "shell_exec" in prompt
    assert "READ tier" in prompt
    assert "EXEC tier" in prompt


def test_build_system_prompt_includes_system_facts():
    facts = {"hostname": "testbox", "os": "Linux 6.1", "user": "alice"}
    prompt = build_system_prompt(system_facts=facts)
    assert "testbox" in prompt
    assert "alice" in prompt


def test_build_system_prompt_includes_user_name():
    prompt = build_system_prompt(user_name="Ryan")
    assert "Ryan" in prompt


def test_build_system_prompt_no_user_name():
    prompt = build_system_prompt(user_name="")
    assert "The user's name is" not in prompt


def test_format_tool_manifest_empty():
    assert _format_tool_manifest([]) == "(no tools available)"


def test_format_tool_manifest_groups_by_tier():
    tools = [
        ToolSpec(name="a", tier=Tier.READ, description="read tool", parameters={}),
        ToolSpec(name="b", tier=Tier.WRITE, description="write tool", parameters={}),
        ToolSpec(name="c", tier=Tier.EXEC, description="exec tool", parameters={}),
    ]
    result = _format_tool_manifest(tools)
    # READ should appear before WRITE before EXEC
    assert result.index("READ") < result.index("WRITE") < result.index("EXEC")


def test_build_system_prompt_with_model_roster():
    roster = {"VISION": ["qwen-vl:7b"], "CODE": ["deepseek-coder:7b", "codellama:7b"]}
    prompt = build_system_prompt(model_roster=roster)
    assert "VISION" in prompt
    assert "qwen-vl:7b" in prompt
    assert "CODE" in prompt
    assert "deepseek-coder:7b" in prompt


def test_build_system_prompt_no_roster():
    prompt = build_system_prompt(model_roster=None)
    assert "specialist models" not in prompt
