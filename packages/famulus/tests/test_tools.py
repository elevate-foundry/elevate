"""Tests for the tool registry and built-in tools."""

from __future__ import annotations

from famulus.engine.capability import Tier, ToolSpec
from famulus.engine.tools import (
    ToolRegistry,
    _file_read,
    _file_write,
    _grep,
    _list_dir,
    _python_eval,
    _search_files,
    _shell_exec,
    default_registry,
)


# --- ToolRegistry ----------------------------------------------------------

def test_registry_register_and_get():
    reg = ToolRegistry()
    spec = ToolSpec(name="test_tool", tier=Tier.READ, description="a test")
    reg.register(spec)
    assert reg.get("test_tool") is spec
    assert reg.get("nonexistent") is None


def test_registry_names_and_all():
    reg = ToolRegistry()
    reg.register(ToolSpec(name="a", tier=Tier.READ, description="a"))
    reg.register(ToolSpec(name="b", tier=Tier.WRITE, description="b"))
    assert set(reg.names()) == {"a", "b"}
    assert len(reg.all()) == 2


def test_registry_for_model_prompt():
    reg = ToolRegistry()
    reg.register(ToolSpec(name="t", tier=Tier.READ, description="desc", parameters={"p": {"type": "string"}}))
    prompts = reg.for_model_prompt()
    assert len(prompts) == 1
    assert prompts[0]["name"] == "t"
    assert prompts[0]["tier"] == "READ"


def test_default_registry_has_all_builtins():
    reg = default_registry(extended=False)
    expected = {"file_read", "file_write", "list_dir", "search_files", "grep", "python_eval", "shell_exec"}
    assert set(reg.names()) == expected


def test_default_registry_extended():
    reg = default_registry(extended=True)
    names = set(reg.names())
    # Core tools still present
    assert "file_read" in names
    assert "shell_exec" in names
    # Extended tools present
    assert "sqlite_query" in names
    assert "journalctl" in names
    assert "systemctl" in names
    assert "ping" in names
    assert "camera_capture" in names
    assert "clipboard_get" in names
    assert "sensors" in names
    assert len(names) > 30  # we have 7 core + 38 extended


# --- Built-in tools --------------------------------------------------------

def test_file_read_success(tmp_path):
    f = tmp_path / "hello.txt"
    f.write_text("hello world")
    r = _file_read({"path": str(f)})
    assert r.success
    assert r.output == "hello world"


def test_file_read_missing():
    r = _file_read({"path": "/nonexistent/file.txt"})
    assert not r.success
    assert "not a file" in r.error


def test_file_read_no_path():
    r = _file_read({})
    assert not r.success
    assert "missing" in r.error


def test_file_write_success(tmp_path):
    f = tmp_path / "out.txt"
    r = _file_write({"path": str(f), "content": "data"})
    assert r.success
    assert f.read_text() == "data"


def test_file_write_creates_parents(tmp_path):
    f = tmp_path / "a" / "b" / "c.txt"
    r = _file_write({"path": str(f), "content": "nested"})
    assert r.success
    assert f.read_text() == "nested"


def test_list_dir_success(tmp_path):
    (tmp_path / "file.txt").touch()
    (tmp_path / "subdir").mkdir()
    r = _list_dir({"path": str(tmp_path)})
    assert r.success
    assert "file.txt" in r.output
    assert "subdir/" in r.output


def test_list_dir_not_a_dir():
    r = _list_dir({"path": "/nonexistent"})
    assert not r.success


def test_shell_exec_success():
    r = _shell_exec({"command": "echo hello"})
    assert r.success
    assert "hello" in r.output


def test_shell_exec_failure():
    r = _shell_exec({"command": "false"})
    assert not r.success
    assert "exit code" in r.error


def test_shell_exec_no_command():
    r = _shell_exec({})
    assert not r.success
    assert "missing" in r.error


def test_search_files(tmp_path):
    (tmp_path / "a.py").touch()
    (tmp_path / "b.txt").touch()
    r = _search_files({"pattern": "*.py", "path": str(tmp_path)})
    assert r.success
    assert "a.py" in r.output
    assert "b.txt" not in r.output


def test_grep_success(tmp_path):
    (tmp_path / "f.txt").write_text("needle in a haystack\njust hay")
    r = _grep({"query": "needle", "path": str(tmp_path)})
    assert r.success
    assert "needle" in r.output


def test_python_eval_success():
    r = _python_eval({"expression": "2 + 2"})
    assert r.success
    assert r.output == "4"


def test_python_eval_error():
    r = _python_eval({"expression": "1 / 0"})
    assert not r.success
    assert "ZeroDivision" in r.error
