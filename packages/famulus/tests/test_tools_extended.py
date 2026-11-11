"""Tests for extended tool groups."""

from __future__ import annotations

import sqlite3

from famulus.engine.tools_extended import (
    _which,
    _sqlite_query,
    _sqlite_schema,
    _sqlite_execute,
    _serial_ports,
    _net_interfaces,
    register_extended_tools,
)
from famulus.engine.tools import ToolRegistry


def test_which_found():
    r = _which({"name": "python3"})
    assert r.success
    assert "python3" in r.output


def test_which_not_found():
    r = _which({"name": "nonexistent_binary_xyz"})
    assert not r.success


def test_sqlite_query(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(str(db))
    conn.execute("CREATE TABLE t (id INTEGER, name TEXT)")
    conn.execute("INSERT INTO t VALUES (1, 'alice')")
    conn.execute("INSERT INTO t VALUES (2, 'bob')")
    conn.commit()
    conn.close()

    r = _sqlite_query({"database": str(db), "query": "SELECT * FROM t"})
    assert r.success
    assert "alice" in r.output
    assert "bob" in r.output


def test_sqlite_schema(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(str(db))
    conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)")
    conn.commit()
    conn.close()

    r = _sqlite_schema({"database": str(db)})
    assert r.success
    assert "users" in r.output
    assert "email" in r.output


def test_sqlite_execute(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(str(db))
    conn.execute("CREATE TABLE t (val TEXT)")
    conn.commit()
    conn.close()

    r = _sqlite_execute({"database": str(db), "statement": "INSERT INTO t VALUES ('hello')"})
    assert r.success
    assert "rows affected" in r.output


def test_sqlite_query_missing_db():
    r = _sqlite_query({"database": "/nonexistent.db", "query": "SELECT 1"})
    assert not r.success


def test_serial_ports():
    r = _serial_ports({})
    assert r.success  # always succeeds, may just say "(no serial ports found)"


def test_net_interfaces():
    r = _net_interfaces({})
    # May fail if 'ip' not in PATH, but on Linux it should work
    assert r.success or "not found" in r.error


def test_register_extended_tools_count():
    reg = ToolRegistry()
    count = register_extended_tools(reg)
    assert count >= 35
    assert "sqlite_query" in reg.names()
    assert "camera_capture" in reg.names()
    assert "notify" in reg.names()
