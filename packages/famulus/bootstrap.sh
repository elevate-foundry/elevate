#!/bin/sh
# famulus :: L2 seed launcher (THE SEED)
#
# Pure POSIX sh. This is the lowest software rung we control. Its only job is to
# get from "a shell + curl" (L1) up to "a usable python3 interpreter" (L3) and then
# hand off to the python ignition probe. It is sh -- NOT python -- on purpose:
# python is the very dependency a bare machine may lack.
#
# It hardcodes NO host specs. It only detects what exists and reacts.
#
# Env overrides (no hardcoding):
#   FAMULUS_PYTHON  explicit python interpreter to use
#   FAMULUS_CACHE   path to an offline seed medium (USB) holding installers
#   FAMULUS_NONINTERACTIVE=1  never prompt (fail closed instead)
#
# Usage: ./bootstrap.sh [--turbo] [engine args...]

set -eu

# --- locate ourselves so the engine root is never hardcoded -------------------
SELF="$0"
# resolve symlinks without readlink -f (not on macOS by default)
while [ -h "$SELF" ]; do
    dir=$(cd -P "$(dirname "$SELF")" && pwd)
    SELF=$(ls -ld "$SELF" | sed 's/.* -> //')
    case "$SELF" in /*) ;; *) SELF="$dir/$SELF" ;; esac
done
ROOT=$(cd -P "$(dirname "$SELF")" && pwd)

MIN_PY_MAJOR=3
MIN_PY_MINOR=9

# --- narration: every step is visible (auditable, non-silent) -----------------
narrate() { printf '[bootstrap] %s\n' "$*" >&2; }
die()     { printf '[bootstrap] FATAL: %s\n' "$*" >&2; exit 1; }

confirm() {
    # confirm "question"  -> 0 if yes. Fails closed when non-interactive.
    if [ "${FAMULUS_NONINTERACTIVE:-0}" = "1" ] || [ "${TURBO:-0}" = "1" ]; then
        narrate "auto-yes (non-interactive/turbo): $1"
        return 0
    fi
    printf '[bootstrap] %s [y/N] ' "$1" >&2
    read ans </dev/tty 2>/dev/null || ans=""
    case "$ans" in [yY]*) return 0 ;; *) return 1 ;; esac
}

# --- parse a leading --turbo (passed through to the engine too) ---------------
TURBO=0
for a in "$@"; do
    [ "$a" = "--turbo" ] && TURBO=1
done

# --- L1 sanity: do we have a shell fetcher? -----------------------------------
FETCH=""
if command -v curl >/dev/null 2>&1; then
    FETCH="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
    FETCH="wget -qO-"
else
    narrate "no curl/wget found; network-based steps will be unavailable (offline-only)."
fi

OS=$(uname -s 2>/dev/null || echo unknown)
narrate "host: $(uname -srm 2>/dev/null || echo unknown)"

# --- find a usable python3 (L3 interpreter) -----------------------------------
py_ok() {
    # py_ok <interpreter>  -> 0 if it meets the minimum version
    "$1" - "$MIN_PY_MAJOR" "$MIN_PY_MINOR" <<'PYEOF' >/dev/null 2>&1
import sys
need_major, need_minor = int(sys.argv[1]), int(sys.argv[2])
sys.exit(0 if sys.version_info[:2] >= (need_major, need_minor) else 1)
PYEOF
}

find_python() {
    if [ -n "${FAMULUS_PYTHON:-}" ] && py_ok "$FAMULUS_PYTHON"; then
        echo "$FAMULUS_PYTHON"; return 0
    fi
    for c in python3 python python3.13 python3.12 python3.11 python3.10 python3.9; do
        if command -v "$c" >/dev/null 2>&1 && py_ok "$c"; then
            command -v "$c"; return 0
        fi
    done
    return 1
}

# --- attempt to provision python if absent (the paradox rung) -----------------
install_python() {
    narrate "no suitable python3 (>= ${MIN_PY_MAJOR}.${MIN_PY_MINOR}) found."

    # offline seed medium first
    if [ -n "${FAMULUS_CACHE:-}" ] && [ -d "${FAMULUS_CACHE}" ]; then
        seed_py=$(find "${FAMULUS_CACHE}" -maxdepth 2 -name 'python3*' -type f 2>/dev/null | head -1 || true)
        if [ -n "$seed_py" ] && py_ok "$seed_py"; then
            narrate "using python from offline seed cache: $seed_py"
            echo "$seed_py"; return 0
        fi
    fi

    case "$OS" in
        Darwin)
            # On macOS, the Command Line Tools ship python3. Trigger the GUI installer.
            if confirm "Install Apple Command Line Tools (provides python3)?"; then
                xcode-select --install >/dev/null 2>&1 || true
                narrate "follow the macOS dialog, then re-run ./bootstrap.sh"
            fi
            if command -v brew >/dev/null 2>&1 && confirm "Install python via Homebrew?"; then
                brew install python >&2 || true
            fi
            ;;
        Linux)
            if command -v apt-get >/dev/null 2>&1; then
                confirm "sudo apt-get install python3?" && sudo apt-get update && sudo apt-get install -y python3
            elif command -v dnf >/dev/null 2>&1; then
                confirm "sudo dnf install python3?" && sudo dnf install -y python3
            elif command -v pacman >/dev/null 2>&1; then
                confirm "sudo pacman -S python?" && sudo pacman -S --noconfirm python
            elif command -v apk >/dev/null 2>&1; then
                confirm "sudo apk add python3?" && sudo apk add python3
            else
                narrate "unknown Linux package manager; install python3 manually."
            fi
            ;;
        *)
            narrate "unsupported OS for auto-install; install python3 manually."
            ;;
    esac

    find_python
}

PYTHON=$(find_python || true)
if [ -z "${PYTHON:-}" ]; then
    PYTHON=$(install_python || true)
fi
[ -n "${PYTHON:-}" ] || die "could not obtain python3. Install it (or provide FAMULUS_CACHE) and re-run."

narrate "python: $PYTHON ($("$PYTHON" -V 2>&1))"

# --- hand off to L3: the python ignition probe / bootstrap wizard -------------
narrate "handing off to the ignition probe..."
export FAMULUS_ROOT="$ROOT"
export FAMULUS_FETCH="$FETCH"
cd "$ROOT"
exec "$PYTHON" -m famulus.bootstrap "$@"
