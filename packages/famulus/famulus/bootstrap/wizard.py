"""Cold-start wizard: orchestrates Phase -1.

Flow:
  ignition probe
    -> if Ollama + >=1 model present: narrate + hand off to Step 0 (skip everything)
    -> else: one-time EXEC+network consent, then
         connectivity ladder (if offline) -> ensure Ollama -> ensure seed model
    -> re-probe, report readiness, offer to restore offline posture

Stdlib only. Safe to run repeatedly: it no-ops when the host is already provisioned.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from ..safety.audit import default_audit_log
from ..safety.gate import Gate
from . import connectivity, install_ollama, seed
from .ignition import Ignition, probe


def _root() -> Path:
    env = os.environ.get("FAMULUS_ROOT")
    if env:
        return Path(env)
    # famulus/bootstrap/wizard.py -> repo root is two parents up from famulus/
    return Path(__file__).resolve().parents[2]


def _load_config(root: Path) -> dict:
    cfg = root / "config" / "bootstrap.json"
    if cfg.is_file():
        try:
            return json.loads(cfg.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  [wizard] warning: could not read {cfg}: {exc}", file=sys.stderr)
    return {}


def _write_discovered(root: Path, ig: Ignition) -> None:
    out = root / "config" / "discovered_system.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        out.write_text(ig.to_json(), encoding="utf-8")
    except OSError:
        pass


def _print_banner(ig: Ignition) -> None:
    print("=" * 64)
    print(" famulus :: Phase -1 cold-start")
    print("=" * 64)
    print(f"  OS         : {ig.os} {ig.os_version or ''} ({ig.arch})")
    print(f"  CPU        : {ig.cpu_brand or 'unknown'} x{ig.cpu_logical_cores or '?'}")
    print(f"  RAM        : {ig.ram_total_gb or '?'} GB total / {ig.ram_available_gb or '?'} GB avail")
    print(f"  Disk free  : {ig.disk_free_gb or '?'} GB")
    print(f"  Python     : {ig.python_version} ({ig.python_executable})")
    print(f"  curl       : {'yes' if ig.has_curl else 'no'}")
    print(f"  Ollama     : {('v' + ig.ollama_version) if ig.ollama_version else 'NOT INSTALLED'}")
    print(f"  Models     : {', '.join(ig.ollama_models) if ig.ollama_models else 'none'}")
    print("-" * 64)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="famulus-bootstrap")
    parser.add_argument("--turbo", action="store_true", help="auto-allow non-forced steps")
    parser.add_argument("--noninteractive", action="store_true", help="never prompt; fail closed")
    parser.add_argument("--probe-only", action="store_true", help="print ignition probe and exit")
    args, _passthrough = parser.parse_known_args(argv)

    root = _root()
    audit = default_audit_log(root)
    gate = Gate(audit, turbo=args.turbo, noninteractive=args.noninteractive)

    ig = probe()
    _write_discovered(root, ig)
    _print_banner(ig)
    audit.record("bootstrap.probe", **ig.to_dict())

    if args.probe_only:
        print(ig.to_json())
        return 0

    # Skip-if-present: the whole phase is a no-op when already provisioned.
    if not ig.needs_bootstrap:
        print("  Ollama and at least one model are present. Phase -1 not needed.")
        print("  -> handing off to Step 0 (model-driven discovery).")
        audit.record("bootstrap.skip", reason="already_provisioned")
        return 0

    print("  Ollama and/or a model are MISSING. Cold-start is required.")
    print("  This is the only step that touches the network and installs software.")
    config = _load_config(root)

    if not gate.confirm(
        "Begin one-time cold-start (network + install)?",
        "covers: bring up connectivity, install Ollama, pull one seed model",
        force_prompt=True,
    ):
        print("  Cold-start declined. Nothing changed.")
        audit.record("bootstrap.declined")
        return 1

    # 1) connectivity (only if we appear offline)
    online = connectivity.is_online()
    if not online:
        online = connectivity.ensure_connectivity(gate, audit, ig, config)
    if online:
        print("  network: online")
    else:
        print("  network: still offline -- will rely on offline cache if available")

    # 2) ensure ollama (cache works offline; download/one-liner need network)
    if not install_ollama.ensure_ollama(gate, audit, ig, config):
        print("  Could not install Ollama. See https://ollama.com/download")
        audit.record("bootstrap.failed", stage="ollama")
        return 2

    # 3) ensure a seed model (re-probe so we see the freshly installed ollama)
    ig = probe()
    model = seed.ensure_seed_model(gate, audit, ig, config)
    if not model:
        print("  Ollama is installed but no seed model is available.")
        audit.record("bootstrap.partial", stage="seed")
        return 3

    # 4) re-probe + report + posture
    ig = probe()
    _write_discovered(root, ig)
    print("-" * 64)
    print(f"  Cold-start complete. Ollama v{ig.ollama_version}, models: {', '.join(ig.ollama_models)}")
    audit.record("bootstrap.complete", version=ig.ollama_version, models=ig.ollama_models)

    if connectivity.is_online() and not args.noninteractive:
        if gate.confirm("Restore offline posture now (recommended)?", force_prompt=True):
            print("  (network teardown is OS-managed; disable wifi/ethernet via your settings)")
            audit.record("bootstrap.posture", choice="restore_offline")
        else:
            audit.record("bootstrap.posture", choice="stay_online")

    print("  -> handing off to Step 0 (model-driven discovery).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
