"""Phase 0: the agent engine.

This is the kernel -- the agent loop, tool algebra, model interface, and
orchestration layer that turns famulus from a bootstrapper into an actual
local AI agent. All engine modules may import third-party deps declared
in pyproject.toml's [engine] extra; they are loaded lazily so that
Phase -1 (bootstrap) never touches them.

STRICT RULE: every tool invocation that mutates state (WRITE, EXEC) must
pass through the consent gate before execution. READ-tier tools can be
auto-allowed under --turbo.
"""
