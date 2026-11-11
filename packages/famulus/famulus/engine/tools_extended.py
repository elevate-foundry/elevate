"""Extended tool groups for famulus.

Implements tools spanning: search, SQLite, logs, scripts, services, maps,
power, LAN, OCR/audio, USB/sensors, camera/radio, and GUI fallback.

All tools follow the same pattern: (params: dict) -> ToolResult.
System commands use subprocess with timeouts and output truncation.
"""

from __future__ import annotations

import shutil
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

from .capability import Tier, ToolResult, ToolSpec

_MAX_OUTPUT = 8192


def _truncate(text: str, limit: int = _MAX_OUTPUT) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[:limit] + "\n... (truncated)", True


def _run(cmd: list[str] | str, timeout: int = 30, shell: bool = False, cwd: str | None = None) -> ToolResult:
    """Run a command and return a ToolResult."""
    try:
        proc = subprocess.run(
            cmd, shell=shell, capture_output=True, text=True,
            timeout=timeout, cwd=cwd,
        )
    except subprocess.TimeoutExpired:
        return ToolResult(success=False, error=f"timed out after {timeout}s")
    except FileNotFoundError as e:
        return ToolResult(success=False, error=f"command not found: {e}")
    except OSError as e:
        return ToolResult(success=False, error=str(e))
    combined = (proc.stdout + proc.stderr).strip()
    text, trunc = _truncate(combined)
    return ToolResult(
        success=proc.returncode == 0,
        output=text,
        error="" if proc.returncode == 0 else f"exit code {proc.returncode}",
        truncated=trunc,
    )


# ===========================================================================
# SEARCH TOOLS
# ===========================================================================

def _man_page(params: dict) -> ToolResult:
    """Read a man page section."""
    topic = params.get("topic", "")
    section = params.get("section", "")
    if not topic:
        return ToolResult(success=False, error="missing 'topic' parameter")
    cmd = ["man"]
    if section:
        cmd.append(str(section))
    cmd.append(topic)
    return _run(cmd, timeout=10)


def _which(params: dict) -> ToolResult:
    """Find the path of an executable."""
    name = params.get("name", "")
    if not name:
        return ToolResult(success=False, error="missing 'name' parameter")
    path = shutil.which(name)
    if path:
        return ToolResult(success=True, output=path)
    return ToolResult(success=False, error=f"'{name}' not found in PATH")


def _find_files(params: dict) -> ToolResult:
    """Find files using the find command with flexible criteria."""
    path = params.get("path", ".")
    name = params.get("name", "")
    file_type = params.get("type", "")
    max_depth = params.get("max_depth", 5)
    cmd = ["find", path, "-maxdepth", str(max_depth)]
    if name:
        cmd += ["-name", name]
    if file_type:
        cmd += ["-type", file_type]
    cmd += ["-print"]
    return _run(cmd, timeout=15)


# ===========================================================================
# SQLITE TOOLS
# ===========================================================================

def _sqlite_query(params: dict) -> ToolResult:
    """Execute a read-only SQL query against a SQLite database."""
    db_path = params.get("database", "")
    query = params.get("query", "")
    if not db_path:
        return ToolResult(success=False, error="missing 'database' parameter")
    if not query:
        return ToolResult(success=False, error="missing 'query' parameter")
    if not Path(db_path).is_file():
        return ToolResult(success=False, error=f"database not found: {db_path}")
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        cur = conn.execute(query)
        rows = cur.fetchmany(200)
        cols = [desc[0] for desc in cur.description] if cur.description else []
        lines = ["\t".join(cols)]
        for row in rows:
            lines.append("\t".join(str(v) for v in row))
        conn.close()
        text, trunc = _truncate("\n".join(lines))
        return ToolResult(success=True, output=text, truncated=trunc)
    except sqlite3.Error as e:
        return ToolResult(success=False, error=f"SQLite error: {e}")


def _sqlite_schema(params: dict) -> ToolResult:
    """Get the schema of a SQLite database."""
    db_path = params.get("database", "")
    if not db_path:
        return ToolResult(success=False, error="missing 'database' parameter")
    if not Path(db_path).is_file():
        return ToolResult(success=False, error=f"database not found: {db_path}")
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = conn.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name")
        schemas = [row[0] for row in cur.fetchall()]
        conn.close()
        text, trunc = _truncate("\n\n".join(schemas) if schemas else "(empty database)")
        return ToolResult(success=True, output=text, truncated=trunc)
    except sqlite3.Error as e:
        return ToolResult(success=False, error=f"SQLite error: {e}")


def _sqlite_execute(params: dict) -> ToolResult:
    """Execute a write SQL statement (INSERT, UPDATE, CREATE, etc.)."""
    db_path = params.get("database", "")
    statement = params.get("statement", "")
    if not db_path or not statement:
        return ToolResult(success=False, error="missing 'database' or 'statement' parameter")
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.execute(statement)
        conn.commit()
        msg = f"OK. rows affected: {cur.rowcount}"
        conn.close()
        return ToolResult(success=True, output=msg)
    except sqlite3.Error as e:
        return ToolResult(success=False, error=f"SQLite error: {e}")


# ===========================================================================
# LOG TOOLS
# ===========================================================================

def _journalctl(params: dict) -> ToolResult:
    """Query systemd journal logs."""
    unit = params.get("unit", "")
    lines = params.get("lines", 50)
    priority = params.get("priority", "")
    since = params.get("since", "")
    cmd = ["journalctl", "--no-pager", "-n", str(lines)]
    if unit:
        cmd += ["-u", unit]
    if priority:
        cmd += ["-p", priority]
    if since:
        cmd += ["--since", since]
    return _run(cmd, timeout=10)


def _dmesg(params: dict) -> ToolResult:
    """Read kernel ring buffer (dmesg)."""
    n = params.get("lines", 50)
    return _run(f"dmesg --human --nopager | tail -n {n}", shell=True, timeout=10)


def _log_file(params: dict) -> ToolResult:
    """Read the tail of a log file."""
    path = params.get("path", "")
    lines = params.get("lines", 100)
    if not path:
        return ToolResult(success=False, error="missing 'path' parameter")
    return _run(["tail", "-n", str(lines), path], timeout=10)


# ===========================================================================
# SCRIPT TOOLS
# ===========================================================================

def _make_executable(params: dict) -> ToolResult:
    """Make a file executable (chmod +x)."""
    path = params.get("path", "")
    if not path:
        return ToolResult(success=False, error="missing 'path' parameter")
    return _run(["chmod", "+x", path])


def _cron_list(params: dict) -> ToolResult:
    """List current user's crontab."""
    return _run(["crontab", "-l"], timeout=5)


def _cron_add(params: dict) -> ToolResult:
    """Add a cron job entry."""
    entry = params.get("entry", "")
    if not entry:
        return ToolResult(success=False, error="missing 'entry' parameter")
    # Append to existing crontab
    existing = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=5)
    new_crontab = (existing.stdout.strip() + "\n" + entry + "\n") if existing.returncode == 0 else entry + "\n"
    proc = subprocess.run(
        ["crontab", "-"], input=new_crontab, capture_output=True, text=True, timeout=5
    )
    if proc.returncode == 0:
        return ToolResult(success=True, output=f"Added cron entry: {entry}")
    return ToolResult(success=False, error=proc.stderr.strip())


# ===========================================================================
# SERVICE TOOLS
# ===========================================================================

def _systemctl(params: dict) -> ToolResult:
    """Manage systemd services (status, start, stop, restart, enable, disable)."""
    action = params.get("action", "status")
    unit = params.get("unit", "")
    if not unit:
        return ToolResult(success=False, error="missing 'unit' parameter")
    if action not in ("status", "start", "stop", "restart", "enable", "disable", "is-active"):
        return ToolResult(success=False, error=f"unsupported action: {action}")
    return _run(["systemctl", action, unit], timeout=15)


def _process_list(params: dict) -> ToolResult:
    """List running processes."""
    filter_str = params.get("filter", "")
    if filter_str:
        result = _run(f"ps aux | grep -i '{filter_str}' | grep -v grep", shell=True, timeout=10)
    else:
        result = _run(["ps", "aux", "--sort=-pcpu"], timeout=10)
    return result


def _kill_process(params: dict) -> ToolResult:
    """Kill a process by PID or name."""
    pid = params.get("pid", "")
    name = params.get("name", "")
    signal = params.get("signal", "TERM")
    if pid:
        return _run(["kill", f"-{signal}", str(pid)])
    if name:
        return _run(["pkill", f"-{signal}", name])
    return ToolResult(success=False, error="provide 'pid' or 'name'")


# ===========================================================================
# POWER TOOLS
# ===========================================================================

def _battery_status(params: dict) -> ToolResult:
    """Get battery/power status."""
    # Try upower first, fall back to /sys
    if shutil.which("upower"):
        return _run(["upower", "-i", "/org/freedesktop/UPower/devices/battery_BAT0"], timeout=5)
    bat_path = Path("/sys/class/power_supply/BAT0")
    if bat_path.exists():
        try:
            status = (bat_path / "status").read_text().strip()
            capacity = (bat_path / "capacity").read_text().strip()
            return ToolResult(success=True, output=f"status: {status}, capacity: {capacity}%")
        except OSError as e:
            return ToolResult(success=False, error=str(e))
    return ToolResult(success=False, error="no battery found")


def _brightness(params: dict) -> ToolResult:
    """Get or set screen brightness (0-100)."""
    value = params.get("value")
    if value is not None:
        # Set brightness
        bl_path = Path("/sys/class/backlight")
        if not bl_path.exists():
            return ToolResult(success=False, error="no backlight interface found")
        devices = list(bl_path.iterdir())
        if not devices:
            return ToolResult(success=False, error="no backlight device")
        dev = devices[0]
        max_br = int((dev / "max_brightness").read_text().strip())
        target = int(float(value) / 100 * max_br)
        try:
            (dev / "brightness").write_text(str(target))
            return ToolResult(success=True, output=f"brightness set to {value}%")
        except OSError as e:
            return ToolResult(success=False, error=str(e))
    else:
        # Get brightness
        bl_path = Path("/sys/class/backlight")
        if not bl_path.exists():
            return ToolResult(success=False, error="no backlight interface found")
        devices = list(bl_path.iterdir())
        if not devices:
            return ToolResult(success=False, error="no backlight device")
        dev = devices[0]
        try:
            cur = int((dev / "brightness").read_text().strip())
            max_br = int((dev / "max_brightness").read_text().strip())
            pct = int(cur / max_br * 100) if max_br > 0 else 0
            return ToolResult(success=True, output=f"brightness: {pct}% ({cur}/{max_br})")
        except OSError as e:
            return ToolResult(success=False, error=str(e))


# ===========================================================================
# LAN / NETWORK TOOLS
# ===========================================================================

def _net_interfaces(params: dict) -> ToolResult:
    """List network interfaces and their IP addresses."""
    return _run(["ip", "-brief", "addr"], timeout=5)


def _ping(params: dict) -> ToolResult:
    """Ping a host."""
    host = params.get("host", "")
    count = params.get("count", 4)
    if not host:
        return ToolResult(success=False, error="missing 'host' parameter")
    return _run(["ping", "-c", str(count), "-W", "2", host], timeout=15)


def _arp_scan(params: dict) -> ToolResult:
    """Scan local network for devices (ARP)."""
    interface = params.get("interface", "")
    if shutil.which("arp-scan"):
        cmd = ["arp-scan", "--localnet"]
        if interface:
            cmd += ["-I", interface]
        return _run(cmd, timeout=15)
    # Fallback to arp
    return _run(["arp", "-a"], timeout=10)


def _ss_ports(params: dict) -> ToolResult:
    """List open ports / listening sockets."""
    return _run(["ss", "-tlnp"], timeout=5)


def _curl(params: dict) -> ToolResult:
    """Make an HTTP request (offline-safe: user must confirm)."""
    url = params.get("url", "")
    method = params.get("method", "GET")
    if not url:
        return ToolResult(success=False, error="missing 'url' parameter")
    cmd = ["curl", "-s", "-S", "-L", "--max-time", "15", "-X", method, url]
    return _run(cmd, timeout=20)


# ===========================================================================
# OCR / AUDIO TOOLS
# ===========================================================================

def _screenshot(params: dict) -> ToolResult:
    """Take a screenshot and save to file."""
    output = params.get("output", "/tmp/famulus_screenshot.png")
    if shutil.which("scrot"):
        return _run(["scrot", output], timeout=10)
    if shutil.which("import"):  # ImageMagick
        return _run(["import", "-window", "root", output], timeout=10)
    if shutil.which("grim"):  # Wayland
        return _run(["grim", output], timeout=10)
    return ToolResult(success=False, error="no screenshot tool found (install scrot, grim, or imagemagick)")


def _ocr(params: dict) -> ToolResult:
    """Run OCR on an image file (requires tesseract)."""
    image = params.get("image", "")
    if not image:
        return ToolResult(success=False, error="missing 'image' parameter")
    if not shutil.which("tesseract"):
        return ToolResult(success=False, error="tesseract not installed")
    return _run(["tesseract", image, "stdout"], timeout=30)


def _audio_record(params: dict) -> ToolResult:
    """Record audio from microphone."""
    duration = params.get("duration", 5)
    output = params.get("output", "/tmp/famulus_recording.wav")
    if shutil.which("arecord"):
        return _run(["arecord", "-d", str(duration), "-f", "cd", output], timeout=int(duration) + 5)
    return ToolResult(success=False, error="arecord not available (install alsa-utils)")


def _audio_play(params: dict) -> ToolResult:
    """Play an audio file."""
    path = params.get("path", "")
    if not path:
        return ToolResult(success=False, error="missing 'path' parameter")
    if shutil.which("aplay"):
        return _run(["aplay", path], timeout=60)
    if shutil.which("paplay"):
        return _run(["paplay", path], timeout=60)
    return ToolResult(success=False, error="no audio player found (install alsa-utils or pulseaudio)")


# ===========================================================================
# USB / SENSOR TOOLS
# ===========================================================================

def _lsusb(params: dict) -> ToolResult:
    """List USB devices."""
    return _run(["lsusb"], timeout=5)


def _serial_ports(params: dict) -> ToolResult:
    """List available serial ports."""
    dev_path = Path("/dev")
    ports = sorted(
        str(p) for p in dev_path.glob("ttyUSB*")
    ) + sorted(
        str(p) for p in dev_path.glob("ttyACM*")
    ) + sorted(
        str(p) for p in dev_path.glob("ttyS*")
    )
    if ports:
        return ToolResult(success=True, output="\n".join(ports))
    return ToolResult(success=True, output="(no serial ports found)")


def _sensors(params: dict) -> ToolResult:
    """Read hardware sensors (temperature, fan, voltage)."""
    if shutil.which("sensors"):
        return _run(["sensors"], timeout=5)
    # Fallback: read thermal zones
    thermal = Path("/sys/class/thermal")
    if thermal.exists():
        lines = []
        for zone in sorted(thermal.glob("thermal_zone*")):
            try:
                temp = int((zone / "temp").read_text().strip()) / 1000
                ztype = (zone / "type").read_text().strip()
                lines.append(f"{ztype}: {temp:.1f}°C")
            except (OSError, ValueError):
                pass
        if lines:
            return ToolResult(success=True, output="\n".join(lines))
    return ToolResult(success=False, error="no sensor data available (install lm-sensors)")


# ===========================================================================
# CAMERA / RADIO TOOLS
# ===========================================================================

def _camera_capture(params: dict) -> ToolResult:
    """Capture a photo from webcam."""
    output = params.get("output", "/tmp/famulus_photo.jpg")
    device = params.get("device", "/dev/video0")
    if shutil.which("fswebcam"):
        return _run(["fswebcam", "-d", device, "--no-banner", output], timeout=10)
    if shutil.which("ffmpeg"):
        return _run([
            "ffmpeg", "-y", "-f", "v4l2", "-i", device,
            "-frames:v", "1", output
        ], timeout=10)
    return ToolResult(success=False, error="no camera tool found (install fswebcam or ffmpeg)")


def _wifi_scan(params: dict) -> ToolResult:
    """Scan for available WiFi networks."""
    if shutil.which("nmcli"):
        return _run(["nmcli", "dev", "wifi", "list"], timeout=15)
    if shutil.which("iwlist"):
        return _run(["iwlist", "scan"], timeout=15)
    return ToolResult(success=False, error="no wifi scan tool (install NetworkManager or wireless-tools)")


def _bluetooth_scan(params: dict) -> ToolResult:
    """Scan for Bluetooth devices."""
    if shutil.which("bluetoothctl"):
        # Quick scan
        return _run(["bluetoothctl", "devices"], timeout=10)
    return ToolResult(success=False, error="bluetoothctl not found")


# ===========================================================================
# GUI FALLBACK TOOLS
# ===========================================================================

def _clipboard_get(params: dict) -> ToolResult:
    """Get clipboard contents."""
    if shutil.which("xclip"):
        return _run(["xclip", "-selection", "clipboard", "-o"], timeout=5)
    if shutil.which("xsel"):
        return _run(["xsel", "--clipboard", "--output"], timeout=5)
    if shutil.which("wl-paste"):  # Wayland
        return _run(["wl-paste"], timeout=5)
    return ToolResult(success=False, error="no clipboard tool found")


def _clipboard_set(params: dict) -> ToolResult:
    """Set clipboard contents."""
    content = params.get("content", "")
    if not content:
        return ToolResult(success=False, error="missing 'content' parameter")
    if shutil.which("xclip"):
        proc = subprocess.run(
            ["xclip", "-selection", "clipboard"],
            input=content, capture_output=True, text=True, timeout=5,
        )
        if proc.returncode == 0:
            return ToolResult(success=True, output=f"copied {len(content)} chars to clipboard")
        return ToolResult(success=False, error=proc.stderr)
    if shutil.which("wl-copy"):
        proc = subprocess.run(
            ["wl-copy"], input=content, capture_output=True, text=True, timeout=5,
        )
        if proc.returncode == 0:
            return ToolResult(success=True, output=f"copied {len(content)} chars to clipboard")
        return ToolResult(success=False, error=proc.stderr)
    return ToolResult(success=False, error="no clipboard tool found")


def _xdotool(params: dict) -> ToolResult:
    """Simulate keyboard/mouse input via xdotool."""
    action = params.get("action", "")
    if not action:
        return ToolResult(success=False, error="missing 'action' parameter (type, key, click, mousemove)")
    args = params.get("args", "")
    if not shutil.which("xdotool"):
        return ToolResult(success=False, error="xdotool not installed")
    return _run(f"xdotool {action} {args}", shell=True, timeout=10)


def _notify(params: dict) -> ToolResult:
    """Send a desktop notification."""
    title = params.get("title", "famulus")
    body = params.get("body", "")
    if not body:
        return ToolResult(success=False, error="missing 'body' parameter")
    if shutil.which("notify-send"):
        return _run(["notify-send", title, body], timeout=5)
    return ToolResult(success=False, error="notify-send not found (install libnotify)")


# ===========================================================================
# MAPS TOOLS
# ===========================================================================

def _geolocation(params: dict) -> ToolResult:
    """Get approximate geolocation from network (if available)."""
    # Try geoclue or fallback to reading from config
    if shutil.which("where-am-i"):
        return _run(["where-am-i"], timeout=10)
    # Offline fallback: check if user has stored location
    loc_file = Path.home() / ".config" / "famulus" / "location.txt"
    if loc_file.exists():
        return ToolResult(success=True, output=loc_file.read_text().strip())
    return ToolResult(success=False, error="geolocation unavailable offline. Set location in ~/.config/famulus/location.txt")


# ===========================================================================
# REGISTRATION
# ===========================================================================

def register_extended_tools(registry: Any) -> int:
    """Register all extended tools into a ToolRegistry. Returns count added."""
    specs = [
        # --- Search ---
        ToolSpec(name="man_page", tier=Tier.READ,
                 description="Read a man page for a command or topic.",
                 parameters={"topic": {"type": "string", "required": True},
                             "section": {"type": "string", "required": False}},
                 fn=_man_page),
        ToolSpec(name="which", tier=Tier.READ,
                 description="Find the full path of an executable.",
                 parameters={"name": {"type": "string", "required": True}},
                 fn=_which),
        ToolSpec(name="find_files", tier=Tier.READ,
                 description="Find files using flexible criteria (name, type, depth).",
                 parameters={"path": {"type": "string", "required": False, "default": "."},
                             "name": {"type": "string", "required": False},
                             "type": {"type": "string", "required": False, "description": "f=file, d=directory"},
                             "max_depth": {"type": "integer", "required": False, "default": 5}},
                 fn=_find_files),

        # --- SQLite ---
        ToolSpec(name="sqlite_query", tier=Tier.READ,
                 description="Execute a read-only SQL query against a SQLite database.",
                 parameters={"database": {"type": "string", "required": True},
                             "query": {"type": "string", "required": True}},
                 fn=_sqlite_query),
        ToolSpec(name="sqlite_schema", tier=Tier.READ,
                 description="Get the schema (CREATE statements) of a SQLite database.",
                 parameters={"database": {"type": "string", "required": True}},
                 fn=_sqlite_schema),
        ToolSpec(name="sqlite_execute", tier=Tier.WRITE,
                 description="Execute a write SQL statement (INSERT, UPDATE, CREATE TABLE, etc.).",
                 parameters={"database": {"type": "string", "required": True},
                             "statement": {"type": "string", "required": True}},
                 fn=_sqlite_execute),

        # --- Logs ---
        ToolSpec(name="journalctl", tier=Tier.READ,
                 description="Query systemd journal logs (filter by unit, priority, time).",
                 parameters={"unit": {"type": "string", "required": False},
                             "lines": {"type": "integer", "required": False, "default": 50},
                             "priority": {"type": "string", "required": False},
                             "since": {"type": "string", "required": False}},
                 fn=_journalctl),
        ToolSpec(name="dmesg", tier=Tier.READ,
                 description="Read kernel ring buffer messages.",
                 parameters={"lines": {"type": "integer", "required": False, "default": 50}},
                 fn=_dmesg),
        ToolSpec(name="log_tail", tier=Tier.READ,
                 description="Read the last N lines of a log file.",
                 parameters={"path": {"type": "string", "required": True},
                             "lines": {"type": "integer", "required": False, "default": 100}},
                 fn=_log_file),

        # --- Scripts ---
        ToolSpec(name="make_executable", tier=Tier.WRITE,
                 description="Make a file executable (chmod +x).",
                 parameters={"path": {"type": "string", "required": True}},
                 fn=_make_executable),
        ToolSpec(name="cron_list", tier=Tier.READ,
                 description="List the current user's crontab entries.",
                 parameters={},
                 fn=_cron_list),
        ToolSpec(name="cron_add", tier=Tier.EXEC,
                 description="Add a cron job entry to the user's crontab.",
                 parameters={"entry": {"type": "string", "required": True}},
                 fn=_cron_add),

        # --- Services ---
        ToolSpec(name="systemctl", tier=Tier.EXEC,
                 description="Manage systemd services (status, start, stop, restart, enable, disable).",
                 parameters={"action": {"type": "string", "required": True, "description": "status|start|stop|restart|enable|disable"},
                             "unit": {"type": "string", "required": True}},
                 fn=_systemctl),
        ToolSpec(name="process_list", tier=Tier.READ,
                 description="List running processes, optionally filtered.",
                 parameters={"filter": {"type": "string", "required": False}},
                 fn=_process_list),
        ToolSpec(name="kill_process", tier=Tier.EXEC,
                 description="Kill a process by PID or name.",
                 parameters={"pid": {"type": "string", "required": False},
                             "name": {"type": "string", "required": False},
                             "signal": {"type": "string", "required": False, "default": "TERM"}},
                 fn=_kill_process),

        # --- Power ---
        ToolSpec(name="battery_status", tier=Tier.READ,
                 description="Get battery and power supply status.",
                 parameters={},
                 fn=_battery_status),
        ToolSpec(name="brightness", tier=Tier.WRITE,
                 description="Get or set screen brightness (0-100).",
                 parameters={"value": {"type": "integer", "required": False, "description": "set to this % (omit to just read)"}},
                 fn=_brightness),

        # --- LAN / Network ---
        ToolSpec(name="net_interfaces", tier=Tier.READ,
                 description="List network interfaces and their IP addresses.",
                 parameters={},
                 fn=_net_interfaces),
        ToolSpec(name="ping", tier=Tier.READ,
                 description="Ping a host to check connectivity.",
                 parameters={"host": {"type": "string", "required": True},
                             "count": {"type": "integer", "required": False, "default": 4}},
                 fn=_ping),
        ToolSpec(name="arp_scan", tier=Tier.READ,
                 description="Scan local network for devices via ARP.",
                 parameters={"interface": {"type": "string", "required": False}},
                 fn=_arp_scan),
        ToolSpec(name="open_ports", tier=Tier.READ,
                 description="List open/listening ports on this machine.",
                 parameters={},
                 fn=_ss_ports),
        ToolSpec(name="http_request", tier=Tier.EXEC,
                 description="Make an HTTP request to a URL (requires network + consent).",
                 parameters={"url": {"type": "string", "required": True},
                             "method": {"type": "string", "required": False, "default": "GET"}},
                 fn=_curl),

        # --- OCR / Audio ---
        ToolSpec(name="screenshot", tier=Tier.READ,
                 description="Take a screenshot and save to a file.",
                 parameters={"output": {"type": "string", "required": False, "default": "/tmp/famulus_screenshot.png"}},
                 fn=_screenshot),
        ToolSpec(name="ocr", tier=Tier.READ,
                 description="Run OCR (text extraction) on an image file.",
                 parameters={"image": {"type": "string", "required": True}},
                 fn=_ocr),
        ToolSpec(name="audio_record", tier=Tier.EXEC,
                 description="Record audio from microphone for N seconds.",
                 parameters={"duration": {"type": "integer", "required": False, "default": 5},
                             "output": {"type": "string", "required": False, "default": "/tmp/famulus_recording.wav"}},
                 fn=_audio_record),
        ToolSpec(name="audio_play", tier=Tier.EXEC,
                 description="Play an audio file.",
                 parameters={"path": {"type": "string", "required": True}},
                 fn=_audio_play),

        # --- USB / Sensors ---
        ToolSpec(name="lsusb", tier=Tier.READ,
                 description="List connected USB devices.",
                 parameters={},
                 fn=_lsusb),
        ToolSpec(name="serial_ports", tier=Tier.READ,
                 description="List available serial ports (ttyUSB, ttyACM, ttyS).",
                 parameters={},
                 fn=_serial_ports),
        ToolSpec(name="sensors", tier=Tier.READ,
                 description="Read hardware sensors (temperature, fan speed, voltage).",
                 parameters={},
                 fn=_sensors),

        # --- Camera / Radio ---
        ToolSpec(name="camera_capture", tier=Tier.EXEC,
                 description="Capture a photo from the webcam.",
                 parameters={"output": {"type": "string", "required": False, "default": "/tmp/famulus_photo.jpg"},
                             "device": {"type": "string", "required": False, "default": "/dev/video0"}},
                 fn=_camera_capture),
        ToolSpec(name="wifi_scan", tier=Tier.READ,
                 description="Scan for available WiFi networks.",
                 parameters={},
                 fn=_wifi_scan),
        ToolSpec(name="bluetooth_scan", tier=Tier.READ,
                 description="Scan for nearby Bluetooth devices.",
                 parameters={},
                 fn=_bluetooth_scan),

        # --- GUI Fallback ---
        ToolSpec(name="clipboard_get", tier=Tier.READ,
                 description="Get the contents of the system clipboard.",
                 parameters={},
                 fn=_clipboard_get),
        ToolSpec(name="clipboard_set", tier=Tier.WRITE,
                 description="Set the system clipboard to the given text.",
                 parameters={"content": {"type": "string", "required": True}},
                 fn=_clipboard_set),
        ToolSpec(name="xdotool", tier=Tier.EXEC,
                 description="Simulate keyboard/mouse input (type, key, click, mousemove).",
                 parameters={"action": {"type": "string", "required": True, "description": "type|key|click|mousemove"},
                             "args": {"type": "string", "required": True}},
                 fn=_xdotool),
        ToolSpec(name="notify", tier=Tier.WRITE,
                 description="Send a desktop notification.",
                 parameters={"title": {"type": "string", "required": False, "default": "famulus"},
                             "body": {"type": "string", "required": True}},
                 fn=_notify),
        ToolSpec(name="geolocation", tier=Tier.READ,
                 description="Get approximate geolocation (offline: from config file).",
                 parameters={},
                 fn=_geolocation),
    ]

    for spec in specs:
        registry.register(spec)
    return len(specs)
