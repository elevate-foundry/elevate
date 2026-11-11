"""famulus CLI: the user-facing entry point.

Usage:
    famulus                  # interactive REPL
    famulus "do something"   # one-shot mode
    famulus --probe          # print ignition probe and exit
    famulus --status         # print router/model status
    famulus --turbo          # auto-allow READ-tier tools
    famulus --mcp-server     # run as MCP server (stdio)
    famulus --mcp-config X   # load MCP servers from config file
"""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path


def _ensure_engine_deps() -> bool:
    """Check that Phase 0 engine deps are importable."""
    try:
        from famulus.engine.agent import Agent  # noqa: F401
        return True
    except ImportError:
        return False


def _root() -> Path:
    env = os.environ.get("FAMULUS_ROOT")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent


def _load_user_name(profile_path: Path) -> str:
    """Load the user's name from the profile file, or return empty string."""
    try:
        import json as _j
        data = _j.loads(profile_path.read_text(encoding="utf-8"))
        return data.get("name", "")
    except (OSError, ValueError):
        return ""


def _save_user_name(profile_path: Path, name: str) -> None:
    """Persist the user's name to the profile file."""
    import json as _j
    profile_path.parent.mkdir(parents=True, exist_ok=True)
    data: dict = {}
    try:
        data = _j.loads(profile_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    data["name"] = name
    profile_path.write_text(_j.dumps(data, indent=2), encoding="utf-8")


def _extract_name_from_input(text: str) -> str | None:
    """Try to extract a name from casual self-introductions.

    Returns the name if found, or None.
    """
    import re
    low = text.lower().strip()
    # "i'm ryan", "im ryan", "i am ryan", "my name is ryan", "call me ryan"
    patterns = [
        r"^(?:i'?m|i am)\s+(.+)",
        r"^my name(?:'s| is)\s+(.+)",
        r"^call me\s+(.+)",
        r"^(?:it'?s|the name'?s)\s+(.+)",
    ]
    for pat in patterns:
        m = re.match(pat, low)
        if m:
            # Capitalize properly, strip trailing punctuation
            raw = m.group(1).strip().rstrip(".!,")
            # Take just the first word if they said "ryan, nice to meet you"
            name = raw.split(",")[0].split(" and ")[0].strip()
            return name.title() if name else None
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="famulus",
        description="Offline-by-default, consent-bound local agent.",
    )
    parser.add_argument("prompt", nargs="*", help="one-shot prompt (omit for interactive REPL)")
    parser.add_argument("--turbo", action="store_true", help="auto-allow READ-tier tools")
    parser.add_argument("--noninteractive", action="store_true", help="never prompt; fail closed")
    parser.add_argument("--model", default="", help="force a specific Ollama model")
    parser.add_argument("--probe", action="store_true", help="print ignition probe and exit")
    parser.add_argument("--status", action="store_true", help="print router/model status and exit")
    parser.add_argument("--bootstrap", action="store_true", help="run Phase -1 bootstrap")
    parser.add_argument("--mcp-server", action="store_true", help="run as MCP server (stdio transport)")
    parser.add_argument("--mcp-port", type=int, default=0, help="run as MCP server on HTTP port")
    parser.add_argument("--mcp-config", default="", help="path to MCP servers config JSON")
    parser.add_argument("--no-stream", action="store_true", help="disable streaming model output")
    parser.add_argument("--swarm", action="store_true", help="race the top-K models concurrently; fastest non-refusing answer wins")
    parser.add_argument("--swarm-size", type=int, default=3, help="number of models to race in swarm mode (default 3)")
    args = parser.parse_args(argv)

    root = _root()

    if args.probe:
        from famulus.bootstrap.ignition import probe
        print(probe().to_json())
        return 0

    if args.bootstrap:
        from famulus.bootstrap.wizard import main as bootstrap_main
        return bootstrap_main(argv or [])

    if args.mcp_server or args.mcp_port:
        from famulus.engine.mcp_server import run_stdio_server, run_http_server
        from famulus.engine.tools import default_registry as _dr
        if args.mcp_port:
            print(f"Starting famulus MCP server on port {args.mcp_port}...")
            run_http_server(_dr(), port=args.mcp_port)
        else:
            run_stdio_server(_dr())
        return 0

    if not _ensure_engine_deps():
        print("Engine dependencies not installed. Run:")
        print("  pip install famulus[engine]")
        print("Or run the bootstrap first:")
        print("  ./bootstrap.sh")
        return 1

    from famulus.engine.agent import Agent, AgentConfig
    from famulus.engine.memory import ConversationMemory, build_system_prompt
    from famulus.engine.router import ModelRouter
    from famulus.engine.tools import default_registry
    from famulus.safety.audit import default_audit_log
    from famulus.safety.gate import Gate

    audit = default_audit_log(root)
    gate = Gate(audit, turbo=args.turbo, noninteractive=args.noninteractive)
    registry = default_registry()

    # Load external MCP servers if configured
    mcp_manager = None
    mcp_config_path = args.mcp_config or str(root / "config" / "mcp_servers.json")
    try:
        import json as _json
        with open(mcp_config_path) as f:
            mcp_data = _json.load(f)
        from famulus.engine.mcp_client import MCPClientManager
        mcp_manager = MCPClientManager()
        mcp_manager.add_servers_from_config(mcp_data)
        if mcp_manager.server_count > 0:
            try:
                mcp_manager.discover_all_sync()
                n = mcp_manager.register_tools(registry)
                if n > 0:
                    print(f"  MCP: loaded {n} tools from {mcp_manager.server_count} server(s)")
            except Exception as exc:
                print(f"  MCP: discovery failed ({exc}), continuing without external tools")
    except FileNotFoundError:
        pass  # no MCP config -- that's fine
    except Exception as exc:
        print(f"  MCP config error: {exc}")

    # Discover hardware for router
    try:
        from famulus.bootstrap.ignition import probe
        ig = probe()
        ram_gb = ig.ram_total_gb
    except Exception:
        ram_gb = None

    router = ModelRouter(ram_total_gb=ram_gb)
    models = router.discover()

    if args.status:
        import json
        print(json.dumps(router.status(), indent=2))
        return 0

    if not models:
        print("No models found. Is Ollama running?")
        print("  ollama serve &")
        print("  ollama pull llama3.2:1b")
        return 1

    config = AgentConfig(
        model=args.model,
        turbo=args.turbo,
        noninteractive=args.noninteractive,
        stream=not args.no_stream and not args.swarm,
        swarm=args.swarm,
        swarm_size=args.swarm_size,
    )

    # Load user profile
    profile_path = root / "config" / "profile.json"
    user_name = _load_user_name(profile_path)

    # Build model roster: which specialist models are available per modality
    from famulus.engine.router import Modality
    model_roster: dict[str, list[str]] = {}
    for mod in Modality:
        ranked = router.ranked(mod)
        if ranked:
            model_roster[mod.name] = ranked[:3]

    # Build the dynamic system prompt with real tools + system facts + roster
    sys_prompt = build_system_prompt(
        tools=registry.all(),
        user_name=user_name,
        model_roster=model_roster if len(model_roster) > 1 else None,
    )
    memory = ConversationMemory(system_prompt=sys_prompt)
    agent = Agent(registry, gate, audit, router, config, memory)
    streamed = False

    def _stream(text: str) -> None:
        nonlocal streamed
        print(text, end="", flush=True)
        streamed = True

    agent.set_output_handler(_stream)

    # One-shot mode
    if args.prompt:
        prompt = " ".join(args.prompt)
        result = agent.step(prompt)
        if streamed:
            print()
        else:
            print(result)
        return 0

    # Interactive REPL — introduction and rapport
    if not user_name:
        print()
        print("Hello! I'm famulus — your private, offline AI assistant.")
        print("I run entirely on this machine. Nothing leaves here without your say-so.")
        print()
        try:
            user_name = input("What should I call you? ").strip()
        except (EOFError, KeyboardInterrupt):
            user_name = ""
        if not user_name:
            user_name = "friend"
        _save_user_name(profile_path, user_name)
        # Rebuild prompt with the name now known
        sys_prompt = build_system_prompt(tools=registry.all(), user_name=user_name)
        memory.update_system_prompt(sys_prompt)
        print(f"\nNice to meet you, {user_name}. Let's get to work.\n")
    else:
        print(f"\nWelcome back, {user_name}.")

    print(f"  session: {datetime.now(timezone.utc).isoformat()}")

    print(f"  model: {router.pick() or '(auto)'}")
    print(f"  tools: {', '.join(registry.names())}")
    print("  type 'quit' or Ctrl-D to exit\n")

    while True:
        try:
            user_input = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\nSee you later, {user_name}. [{datetime.now(timezone.utc).isoformat()}]")
            break
        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            print(f"See you later, {user_name}. [{datetime.now(timezone.utc).isoformat()}]")
            break
        if user_input.lower() == "/status":
            import json
            print(json.dumps(router.status(), indent=2))
            continue
        if user_input.lower() == "/clear":
            memory.clear()
            print("(memory cleared)")
            continue
        if user_input.lower() == "/mcp":
            if mcp_manager:
                import json
                print(json.dumps(mcp_manager.status(), indent=2))
            else:
                print("(no MCP servers configured)")
            continue

        # Detect name introductions and update profile + prompt
        detected = _extract_name_from_input(user_input)
        if detected and detected.lower() != user_name.lower():
            user_name = detected
            _save_user_name(profile_path, user_name)
            memory.update_system_prompt(
                build_system_prompt(tools=registry.all(), user_name=user_name)
            )

        streamed = False
        print("\nfamulus> ", end="", flush=True)
        result = agent.step(user_input)
        if streamed:
            print("\n")
        else:
            print(f"{result}\n")

    # Save conversation
    conv_path = root / "logs" / "last_conversation.json"
    try:
        memory.save(conv_path)
    except OSError:
        pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
