"""L3 ignition probe: the tiny, read-only, stdlib-only host probe.

This is deliberately the *only* place with OS-specific branches. It hardcodes no
specs -- it runs real commands and parses their output, degrading gracefully to
``None`` whenever a probe is unavailable. Its output is just enough to:

  1. decide whether bootstrap is even needed (is Ollama + a model present?), and
  2. size the smallest viable seed model (from discovered RAM).

The richer, model-driven discovery (Step 0) happens later, after Ollama is up.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from typing import Optional


def _run(cmd: list[str], timeout: float = 5.0) -> Optional[str]:
    """Run a read-only command, returning stripped stdout or None on any failure."""
    try:
        out = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def _read_text(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def _cpu_count() -> Optional[int]:
    # Module-level helper: referencing os.cpu_count directly in the dataclass body
    # would clash with the field named `os`, so we wrap it here.
    return os.cpu_count()


@dataclass
class Ignition:
    os: str = field(default_factory=lambda: platform.system() or "unknown")
    os_version: Optional[str] = None
    arch: str = field(default_factory=lambda: platform.machine() or "unknown")
    cpu_brand: Optional[str] = None
    cpu_logical_cores: Optional[int] = field(default_factory=_cpu_count)
    ram_total_gb: Optional[float] = None
    ram_available_gb: Optional[float] = None
    disk_free_gb: Optional[float] = None
    python_executable: str = field(default_factory=lambda: _python_path())
    python_version: str = field(default_factory=platform.python_version)
    has_curl: bool = False
    has_ollama: bool = False
    ollama_version: Optional[str] = None
    ollama_models: list[str] = field(default_factory=list)

    # ---- derived helpers -----------------------------------------------------
    @property
    def needs_bootstrap(self) -> bool:
        """True when Ollama is missing or has no model -> Phase -1 should run."""
        return not (self.has_ollama and bool(self.ollama_models))

    def seed_size_hint_b(self) -> int:
        """Pick a conservative seed-model parameter budget (in billions) from RAM.

        Derived, never hardcoded to a specific machine. Falls back to the smallest
        tier when RAM is unknown.
        """
        ram = self.ram_total_gb or 0.0
        if ram >= 32:
            return 8
        if ram >= 16:
            return 4
        if ram >= 8:
            return 3
        return 1

    def to_dict(self) -> dict:
        d = asdict(self)
        d["needs_bootstrap"] = self.needs_bootstrap
        d["seed_size_hint_b"] = self.seed_size_hint_b()
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, sort_keys=True)


def _python_path() -> str:
    import sys

    return sys.executable or "python3"


def _probe_macos(ig: Ignition) -> None:
    ig.os_version = _run(["sw_vers", "-productVersion"]) or ig.os_version
    memsize = _run(["sysctl", "-n", "hw.memsize"])
    if memsize and memsize.isdigit():
        ig.ram_total_gb = round(int(memsize) / (1024 ** 3), 1)
    ig.cpu_brand = _run(["sysctl", "-n", "machdep.cpu.brand_string"]) or _run(
        ["sysctl", "-n", "hw.model"]
    )
    # available memory: (free + inactive + speculative) pages * page size
    vm = _run(["vm_stat"])
    page_size = _run(["sysctl", "-n", "hw.pagesize"])
    if vm and page_size and page_size.isdigit():
        ps = int(page_size)
        free_pages = 0
        for key in ("Pages free", "Pages inactive", "Pages speculative"):
            for line in vm.splitlines():
                if line.startswith(key + ":"):
                    digits = line.split(":")[1].strip().rstrip(".")
                    if digits.isdigit():
                        free_pages += int(digits)
        if free_pages:
            ig.ram_available_gb = round(free_pages * ps / (1024 ** 3), 1)


def _probe_linux(ig: Ignition) -> None:
    rel = _read_text("/etc/os-release")
    if rel:
        for line in rel.splitlines():
            if line.startswith("PRETTY_NAME="):
                ig.os_version = line.split("=", 1)[1].strip().strip('"')
                break
    meminfo = _read_text("/proc/meminfo")
    if meminfo:
        total_kb = avail_kb = None
        for line in meminfo.splitlines():
            if line.startswith("MemTotal:"):
                total_kb = int(line.split()[1])
            elif line.startswith("MemAvailable:"):
                avail_kb = int(line.split()[1])
        if total_kb:
            ig.ram_total_gb = round(total_kb / (1024 ** 2), 1)
        if avail_kb:
            ig.ram_available_gb = round(avail_kb / (1024 ** 2), 1)
    cpuinfo = _read_text("/proc/cpuinfo")
    if cpuinfo:
        for line in cpuinfo.splitlines():
            if line.lower().startswith("model name"):
                ig.cpu_brand = line.split(":", 1)[1].strip()
                break


def _probe_windows(ig: Ignition) -> None:
    ig.os_version = platform.version()
    ig.cpu_brand = os.environ.get("PROCESSOR_IDENTIFIER")
    # Best-effort RAM via wmic (deprecated) or PowerShell CIM.
    out = _run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
        ]
    )
    if out and out.strip().isdigit():
        ig.ram_total_gb = round(int(out.strip()) / (1024 ** 3), 1)


def _probe_ollama(ig: Ignition) -> None:
    ig.has_curl = shutil.which("curl") is not None
    ollama = shutil.which("ollama")
    ig.has_ollama = ollama is not None
    if not ig.has_ollama:
        return
    ver = _run([ollama, "--version"])
    if ver:
        # e.g. "ollama version is 0.17.7"
        ig.ollama_version = ver.split()[-1] if ver.split() else ver
    listing = _run([ollama, "list"])
    if listing:
        for line in listing.splitlines()[1:]:  # skip header row
            name = line.split()[0] if line.split() else ""
            if name and name.upper() != "NAME":
                ig.ollama_models.append(name)


def probe() -> Ignition:
    """Run the full read-only ignition probe and return the result."""
    ig = Ignition()
    system = ig.os
    try:
        if system == "Darwin":
            _probe_macos(ig)
        elif system == "Linux":
            _probe_linux(ig)
        elif system == "Windows":
            _probe_windows(ig)
    except Exception:
        # The probe must never crash the bootstrap; partial info is fine.
        pass

    try:
        usage = shutil.disk_usage(os.path.expanduser("~"))
        ig.disk_free_gb = round(usage.free / (1024 ** 3), 1)
    except OSError:
        pass

    try:
        _probe_ollama(ig)
    except Exception:
        pass

    return ig


if __name__ == "__main__":
    print(probe().to_json())
