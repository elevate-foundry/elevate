"""Ollama acquisition chain (stdlib only): cache -> verified download -> one-liner.

Resilient by design (crisis framing): try the most trustworthy/offline method
first, fall back toward convenience. Every network fetch and every install step
is gated (force_prompt) and audited. The download path REFUSES to run an installer
whose checksum is unknown unless the user explicitly allows an unverified install.

Nothing is hardcoded: versions, URLs, and checksums come from config (bootstrap.json).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Optional

from ..safety.audit import AuditLog
from ..safety.gate import Gate
from .ignition import Ignition

_INSTALLER_GLOBS = ("ollama*", "Ollama*")


def _narrate(msg: str) -> None:
    print(f"  [ollama] {msg}")


def _run_live(cmd: list[str] | str, shell: bool = False, timeout: float = 1800.0) -> bool:
    try:
        return subprocess.run(cmd, shell=shell, timeout=timeout, check=False).returncode == 0
    except (OSError, subprocess.SubprocessError) as exc:
        _narrate(f"command failed: {exc}")
        return False


def ensure_ollama(gate: Gate, audit: AuditLog, ig: Ignition, config: dict) -> bool:
    """Make sure the `ollama` binary exists. Returns True on success."""
    if shutil.which("ollama"):
        _narrate("already installed.")
        audit.record("ollama.present", version=ig.ollama_version)
        return True

    audit.record("ollama.install_start", os=ig.os, arch=ig.arch)
    _narrate("not found; starting acquisition chain (cache -> verified -> one-liner).")

    if _try_cache(gate, audit, ig):
        return _verify_installed(audit)
    if _try_verified_download(gate, audit, ig, config):
        return _verify_installed(audit)
    if _try_official_one_liner(gate, audit, ig):
        return _verify_installed(audit)

    audit.record("ollama.install_failed")
    _narrate("all acquisition methods failed.")
    return False


def _cache_dir() -> Optional[Path]:
    env = os.environ.get("FAMULUS_CACHE")
    if env and Path(env).is_dir():
        return Path(env)
    root = os.environ.get("FAMULUS_ROOT")
    if root:
        cand = Path(root) / "config" / "cache"
        if cand.is_dir():
            return cand
    return None


def _try_cache(gate: Gate, audit: AuditLog, ig: Ignition) -> bool:
    cache = _cache_dir()
    if not cache:
        _narrate("no offline cache present; skipping.")
        return False
    installer = None
    for pattern in _INSTALLER_GLOBS:
        for path in sorted(cache.glob(pattern)):
            if path.is_file():
                installer = path
                break
        if installer:
            break
    if not installer:
        _narrate(f"cache {cache} has no Ollama installer; skipping.")
        return False
    if not gate.confirm(f"Install Ollama from offline cache: {installer.name}", force_prompt=True):
        return False
    audit.record("ollama.cache_install", path=str(installer))
    return _install_artifact(ig, installer)


def _try_verified_download(gate: Gate, audit: AuditLog, ig: Ignition, config: dict) -> bool:
    sources = (config or {}).get("ollama_sources", {})
    key = f"{ig.os}/{ig.arch}".lower()
    entry = sources.get(key) or sources.get(ig.os.lower())
    if not entry or not entry.get("url"):
        _narrate(f"no download manifest for '{key}'; skipping verified download.")
        return False
    url = entry["url"]
    expected_sha = entry.get("sha256")
    if not gate.confirm(f"Download Ollama from {url}", f"sha256={expected_sha or 'UNKNOWN'}", force_prompt=True):
        return False

    tmp = Path(tempfile.mkdtemp(prefix="ollama-dl-")) / Path(url).name
    try:
        _narrate(f"downloading {url} ...")
        with urllib.request.urlopen(url, timeout=120) as resp, open(tmp, "wb") as fh:
            shutil.copyfileobj(resp, fh)
    except Exception as exc:
        _narrate(f"download failed: {exc}")
        audit.record("ollama.download_failed", url=url, error=str(exc))
        return False

    actual_sha = _sha256(tmp)
    audit.record("ollama.downloaded", url=url, sha256=actual_sha, expected=expected_sha)
    if expected_sha:
        if actual_sha.lower() != expected_sha.lower():
            _narrate(f"CHECKSUM MISMATCH: got {actual_sha}, expected {expected_sha}. Aborting.")
            audit.record("ollama.checksum_mismatch", got=actual_sha, expected=expected_sha)
            return False
        _narrate("checksum verified.")
    else:
        _narrate("WARNING: no checksum in manifest -- this download is UNVERIFIED.")
        if not gate.confirm("Proceed with UNVERIFIED installer?", force_prompt=True):
            return False
    return _install_artifact(ig, tmp)


def _try_official_one_liner(gate: Gate, audit: AuditLog, ig: Ignition) -> bool:
    if ig.os == "Linux":
        cmd = "curl -fsSL https://ollama.com/install.sh | sh"
        _narrate("LEAST-VERIFIABLE fallback: pipes a remote script to sh.")
        if not gate.confirm("Run official Linux one-liner?", cmd, force_prompt=True):
            return False
        audit.record("ollama.one_liner", cmd=cmd)
        return _run_live(cmd, shell=True)
    if ig.os == "Darwin":
        if shutil.which("brew"):
            if gate.confirm("Install Ollama via Homebrew?", "brew install ollama", force_prompt=True):
                audit.record("ollama.brew")
                return _run_live(["brew", "install", "ollama"])
        _narrate("No Homebrew. Download the macOS app from https://ollama.com/download")
        audit.record("ollama.manual_macos")
        return False
    _narrate("No automated installer for this OS; see https://ollama.com/download")
    return False


def _install_artifact(ig: Ignition, path: Path) -> bool:
    """Install a cached/downloaded artifact by type (best-effort, OS-aware)."""
    suffix = path.suffix.lower()
    if suffix in (".sh",):
        return _run_live(["sh", str(path)])
    if suffix in (".tgz", ".gz", ".tar"):
        dest = Path(os.path.expanduser("~/.local/bin"))
        dest.mkdir(parents=True, exist_ok=True)
        return _run_live(["tar", "-xzf", str(path), "-C", str(dest)])
    if suffix in (".pkg",) and ig.os == "Darwin":
        return _run_live(["sudo", "installer", "-pkg", str(path), "-target", "/"])
    if suffix in (".dmg",) and ig.os == "Darwin":
        _narrate(f"mount the dmg and drag Ollama to /Applications: {path}")
        return _run_live(["open", str(path)])
    if suffix == "" and os.access(path, os.X_OK):
        dest = Path(os.path.expanduser("~/.local/bin/ollama"))
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
        os.chmod(dest, 0o755)
        return True
    _narrate(f"don't know how to install artifact type '{suffix or 'binary'}': {path}")
    return False


def _verify_installed(audit: AuditLog) -> bool:
    ok = shutil.which("ollama") is not None
    audit.record("ollama.verify", installed=ok)
    if ok:
        _narrate("Ollama is now installed.")
    return ok


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
