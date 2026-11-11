"""Tests for the tool algebra capability system."""

from __future__ import annotations

from famulus.engine.capability import CapGrant, Tier, ToolResult, ToolSpec


# --- Tier ordering ---------------------------------------------------------

def test_tier_ordering():
    assert Tier.READ < Tier.WRITE < Tier.EXEC


def test_tier_values():
    assert Tier.READ == 0
    assert Tier.WRITE == 1
    assert Tier.EXEC == 2


# --- ToolSpec --------------------------------------------------------------

def test_toolspec_is_frozen():
    spec = ToolSpec(name="test", tier=Tier.READ, description="a test tool")
    try:
        spec.name = "changed"
        assert False, "should be frozen"
    except AttributeError:
        pass


def test_toolspec_defaults():
    spec = ToolSpec(name="t", tier=Tier.READ, description="d")
    assert spec.parameters == {}
    assert spec.fn is None


# --- ToolResult ------------------------------------------------------------

def test_tool_result_to_dict_minimal():
    r = ToolResult(success=True)
    d = r.to_dict()
    assert d == {"success": True}


def test_tool_result_to_dict_full():
    r = ToolResult(success=False, output="out", error="err", truncated=True)
    d = r.to_dict()
    assert d == {"success": False, "output": "out", "error": "err", "truncated": True}


# --- CapGrant --------------------------------------------------------------

def test_cap_grant_starts_at_read():
    g = CapGrant()
    assert g.ceiling == Tier.READ
    assert g.allows(Tier.READ)
    assert not g.allows(Tier.WRITE)
    assert not g.allows(Tier.EXEC)


def test_cap_grant_escalate():
    g = CapGrant()
    g.escalate(Tier.WRITE)
    assert g.ceiling == Tier.WRITE
    assert g.allows(Tier.READ)
    assert g.allows(Tier.WRITE)
    assert not g.allows(Tier.EXEC)


def test_cap_grant_escalate_to_exec():
    g = CapGrant()
    g.escalate(Tier.EXEC)
    assert g.ceiling == Tier.EXEC
    assert g.allows(Tier.EXEC)


def test_cap_grant_no_downgrade():
    g = CapGrant(Tier.EXEC)
    g.escalate(Tier.READ)  # should not downgrade
    assert g.ceiling == Tier.EXEC
