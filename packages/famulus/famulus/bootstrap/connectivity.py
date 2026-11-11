"""Connectivity ladder (stdlib only).

Goal: get the host online so Ollama can be fetched -- "full assisted connect."
Tries rungs in order, narrating and stopping at the first success. Every action
that changes network state is gated (force_prompt=True) and audited. Reachability
checks are read-only (no state change).

Rungs: existing link -> ethernet/DHCP -> known wifi -> scan+prompt -> USB tether
-> captive portal -> manual fallback.
"""

from __future__ import annotations

import socket
import subprocess
import urllib.request
from typing import Optional

from ..safety.audit import AuditLog
from ..safety.gate import Gate
from .ignition import Ignition

_REACH_TARGETS = [("1.1.1.1", 53), ("8.8.8.8", 53), ("9.9.9.9", 53)]
_PORTAL_CHECK_URL = "http://connectivitycheck.gstatic.com/generate_204"


def _narrate(msg: str) -> None:
    print(f"  [connectivity] {msg}")


def is_online(timeout: float = 2.0) -> bool:
    """Read-only reachability check: can we open a TCP socket outbound?"""
    for host, port in _REACH_TARGETS:
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            continue
    return False


def _run(cmd: list[str], timeout: float = 30.0) -> tuple[bool, str]:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        return False, str(exc)
    return out.returncode == 0, (out.stdout + out.stderr).strip()


# ---------------------------------------------------------------------------
# OS-specific helpers (detection is read-only; mutation is gated by callers)
# ---------------------------------------------------------------------------

def _macos_wifi_iface() -> Optional[str]:
    ok, out = _run(["networksetup", "-listallhardwareports"], timeout=10)
    if not ok:
        return None
    lines = out.splitlines()
    for i, line in enumerate(lines):
        if "Wi-Fi" in line or "AirPort" in line:
            for j in range(i, min(i + 3, len(lines))):
                if lines[j].startswith("Device:"):
                    return lines[j].split(":", 1)[1].strip()
    return None


def _scan_wifi(ig: Ignition) -> list[str]:
    if ig.os == "Linux":
        ok, out = _run(["nmcli", "-t", "-f", "SSID", "dev", "wifi"], timeout=20)
        if ok:
            return [s for s in dict.fromkeys(out.splitlines()) if s]
    elif ig.os == "Darwin":
        # Newer macOS deprecates the `airport` tool; system_profiler still lists nets.
        ok, out = _run(["system_profiler", "SPAirPortDataType"], timeout=20)
        if ok:
            ssids = []
            for line in out.splitlines():
                line = line.strip()
                if line.endswith(":") and "PHY Mode" not in line and len(line) > 1:
                    ssids.append(line[:-1])
            return list(dict.fromkeys(ssids))
    return []


def detect_captive_portal(timeout: float = 3.0) -> bool:
    """True if a captive portal appears to be intercepting traffic."""
    try:
        req = urllib.request.Request(_PORTAL_CHECK_URL, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            # generate_204 should be exactly 204 with empty body; anything else = portal
            return resp.status != 204
    except Exception:
        return False


# ---------------------------------------------------------------------------
# The ladder
# ---------------------------------------------------------------------------

def ensure_connectivity(gate: Gate, audit: AuditLog, ig: Ignition, config: dict) -> bool:
    """Walk the ladder. Returns True if the host ends up online."""
    audit.record("connectivity.start", os=ig.os)

    # Rung 1: existing link
    if is_online():
        _narrate("already online.")
        audit.record("connectivity.rung", rung="existing", online=True)
        return True
    _narrate("offline; attempting to bring up a link...")

    # Rung 2: ethernet / generic DHCP renew
    if ig.os == "Linux":
        if gate.confirm("Bring up wired network (nmcli)", "sudo nmcli networking on", force_prompt=True):
            _run(["sudo", "nmcli", "networking", "on"])
            if is_online():
                audit.record("connectivity.rung", rung="ethernet", online=True)
                return True

    # Rung 3: known wifi from config
    known = config.get("known_wifi", []) if isinstance(config, dict) else []
    iface = _macos_wifi_iface() if ig.os == "Darwin" else None
    for net in known:
        ssid = net.get("ssid")
        password = net.get("password", "")
        if not ssid:
            continue
        if gate.confirm(f"Connect to known wifi '{ssid}'", force_prompt=True):
            _connect_wifi(gate, ig, iface, ssid, password)
            if is_online():
                audit.record("connectivity.rung", rung="known_wifi", ssid=ssid, online=True)
                return True

    # Rung 4: scan + prompt
    ssids = _scan_wifi(ig)
    if ssids:
        _narrate("visible networks: " + ", ".join(ssids[:12]))
        ssid = gate.ask("SSID to join (blank to skip)")
        if ssid:
            password = gate.ask(f"Password for '{ssid}' (blank if open)", secret=True) or ""
            if gate.confirm(f"Connect to '{ssid}'", force_prompt=True):
                _connect_wifi(gate, ig, iface, ssid, password)
                if is_online():
                    audit.record("connectivity.rung", rung="scan_prompt", ssid=ssid, online=True)
                    return True

    # Rung 5: USB tether / cellular (detection is OS-specific; we narrate + retry link)
    _narrate("if you have a phone/LTE stick, connect & enable tethering now.")
    if gate.confirm("Re-check link after enabling USB tether?", force_prompt=True):
        if is_online():
            audit.record("connectivity.rung", rung="tether", online=True)
            return True

    # Rung 6: captive portal
    if detect_captive_portal():
        _narrate("a captive portal was detected. Open a browser to authenticate (GUI fallback).")
        if gate.confirm("Re-check link after completing captive-portal login?", force_prompt=True):
            if is_online():
                audit.record("connectivity.rung", rung="captive_portal", online=True)
                return True

    # Rung 7: manual fallback
    _narrate("could not establish connectivity automatically.")
    _print_manual_instructions(ig)
    audit.record("connectivity.exhausted", online=False)
    return is_online()


def _connect_wifi(gate: Gate, ig: Ignition, iface: Optional[str], ssid: str, password: str) -> None:
    if ig.os == "Darwin":
        dev = iface or "en0"
        _run(["networksetup", "-setairportpower", dev, "on"])
        cmd = ["networksetup", "-setairportnetwork", dev, ssid]
        if password:
            cmd.append(password)
        _run(cmd)
    elif ig.os == "Linux":
        _run(["nmcli", "radio", "wifi", "on"])
        cmd = ["nmcli", "dev", "wifi", "connect", ssid]
        if password:
            cmd += ["password", password]
        _run(cmd)


def _print_manual_instructions(ig: Ignition) -> None:
    print("\n  --- manual connectivity steps ---")
    if ig.os == "Darwin":
        print("    networksetup -setairportpower en0 on")
        print("    networksetup -setairportnetwork en0 <SSID> <PASSWORD>")
    elif ig.os == "Linux":
        print("    nmcli radio wifi on")
        print("    nmcli dev wifi connect <SSID> password <PASSWORD>")
        print("    # or wired: sudo dhclient <iface>")
    else:
        print("    Connect to a network using your OS network settings, then re-run.")
    print("  ----------------------------------\n")
