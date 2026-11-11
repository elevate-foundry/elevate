"""Tests for the Ollama model interface (mocked, no real Ollama needed)."""

from __future__ import annotations

import json
from unittest.mock import patch, MagicMock

from famulus.engine.model import (
    Message,
    ModelResponse,
    chat,
    format_tools_for_ollama,
    list_local_models,
    show_model,
)


# --- Message ---------------------------------------------------------------

def test_message_to_dict_basic():
    m = Message(role="user", content="hello")
    d = m.to_dict()
    assert d == {"role": "user", "content": "hello"}


def test_message_to_dict_with_tool_calls():
    m = Message(role="assistant", content="", tool_calls=[{"id": "1"}])
    d = m.to_dict()
    assert d["tool_calls"] == [{"id": "1"}]


def test_message_to_dict_with_tool_call_id():
    m = Message(role="tool", content="result", tool_call_id="abc")
    d = m.to_dict()
    assert d["tool_call_id"] == "abc"


# --- ModelResponse ---------------------------------------------------------

def test_model_response_has_tool_calls():
    r = ModelResponse(tool_calls=[{"function": {"name": "test"}}])
    assert r.has_tool_calls
    r2 = ModelResponse(content="hello")
    assert not r2.has_tool_calls


# --- format_tools_for_ollama -----------------------------------------------

def test_format_tools_for_ollama():
    specs = [{
        "name": "file_read",
        "description": "Read a file",
        "parameters": {"path": {"type": "string", "required": True}},
    }]
    result = format_tools_for_ollama(specs)
    assert len(result) == 1
    assert result[0]["type"] == "function"
    f = result[0]["function"]
    assert f["name"] == "file_read"
    assert "path" in f["parameters"]["properties"]
    assert "path" in f["parameters"]["required"]


# --- list_local_models (mocked) -------------------------------------------

def test_list_local_models_success():
    fake_resp = MagicMock()
    fake_resp.read.return_value = json.dumps({
        "models": [{"name": "llama3.2:1b"}, {"name": "gemma2:2b"}]
    }).encode()
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = MagicMock(return_value=False)

    with patch("famulus.engine.model.urllib.request.urlopen", return_value=fake_resp):
        models = list_local_models()
    assert len(models) == 2
    assert models[0]["name"] == "llama3.2:1b"


def test_list_local_models_failure():
    with patch("famulus.engine.model.urllib.request.urlopen", side_effect=OSError("refused")):
        models = list_local_models()
    assert models == []


# --- chat (mocked) --------------------------------------------------------

def test_chat_plain_response():
    fake_body = json.dumps({
        "model": "test",
        "message": {"role": "assistant", "content": "Hello!"},
        "done": True,
    }).encode()
    fake_resp = MagicMock()
    fake_resp.read.return_value = fake_body
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = MagicMock(return_value=False)

    with patch("famulus.engine.model.urllib.request.urlopen", return_value=fake_resp):
        resp = chat("test", [Message(role="user", content="hi")])
    assert resp.content == "Hello!"
    assert not resp.has_tool_calls
    assert resp.done


def test_chat_tool_call_response():
    fake_body = json.dumps({
        "model": "test",
        "message": {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"function": {"name": "file_read", "arguments": {"path": "/tmp/x"}}}],
        },
        "done": True,
    }).encode()
    fake_resp = MagicMock()
    fake_resp.read.return_value = fake_body
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = MagicMock(return_value=False)

    with patch("famulus.engine.model.urllib.request.urlopen", return_value=fake_resp):
        resp = chat("test", [Message(role="user", content="read /tmp/x")])
    assert resp.has_tool_calls
    assert resp.tool_calls[0]["function"]["name"] == "file_read"


def test_chat_connection_error():
    with patch("famulus.engine.model.urllib.request.urlopen", side_effect=OSError("refused")):
        resp = chat("test", [Message(role="user", content="hi")])
    assert "error" in resp.content.lower()
    assert resp.done


# --- show_model (mocked) --------------------------------------------------

def test_show_model_success():
    fake_body = json.dumps({
        "capabilities": ["completion", "tools"],
        "details": {"family": "llama", "parameter_size": "8B"},
    }).encode()
    fake_resp = MagicMock()
    fake_resp.read.return_value = fake_body
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = MagicMock(return_value=False)

    with patch("famulus.engine.model.urllib.request.urlopen", return_value=fake_resp):
        meta = show_model("hermes3:latest")
    assert meta["capabilities"] == ["completion", "tools"]
    assert meta["details"]["family"] == "llama"


def test_show_model_with_vision():
    fake_body = json.dumps({
        "capabilities": ["completion", "vision"],
        "details": {"family": "qwen25vl"},
    }).encode()
    fake_resp = MagicMock()
    fake_resp.read.return_value = fake_body
    fake_resp.__enter__ = lambda s: s
    fake_resp.__exit__ = MagicMock(return_value=False)

    with patch("famulus.engine.model.urllib.request.urlopen", return_value=fake_resp):
        meta = show_model("qwen2.5vl:7b")
    assert "vision" in meta["capabilities"]
    assert "tools" not in meta["capabilities"]


def test_show_model_failure():
    with patch("famulus.engine.model.urllib.request.urlopen", side_effect=OSError("down")):
        meta = show_model("anything")
    assert meta == {}
