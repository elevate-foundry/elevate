#!/bin/sh
# Portable cross-device verification for famulus.
#
# Runs anywhere with a POSIX shell + Python 3.9+:
#   * macOS, Linux
#   * Windows via Git Bash or WSL
#   * Android via Termux (pkg install python git)
#
# It runs the zero-dependency selfcheck (the must-pass gate) and then, best
# effort, the full pytest suite. Invoke as:  sh scripts/verify.sh
#
# Exit code 0 = the selfcheck passed on this device.

# Move to the repo root (the parent of this script's directory).
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd) || exit 1
cd "$ROOT" || exit 1

# Find a Python interpreter (3.9+ required).
PY=""
for cand in python3 python py; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  echo "ERROR: no Python found. Install Python 3.9+ (Termux: 'pkg install python git') and retry." >&2
  exit 127
fi

echo "============================================================"
echo " famulus :: cross-device verification"
echo "============================================================"
echo " host   : $(hostname 2>/dev/null || echo unknown)"
echo " system : $(uname -a 2>/dev/null || echo 'non-POSIX shell')"
echo " python : $($PY -V 2>&1) ($PY)"
echo " commit : $(git rev-parse --short HEAD 2>/dev/null || echo 'no-git')"
echo "------------------------------------------------------------"

# 1) Zero-dependency selfcheck -- the gate. Fails the whole run if it fails.
echo "[1/2] zero-dependency selfcheck"
if ! "$PY" -m famulus.selfcheck; then
  echo "------------------------------------------------------------"
  echo " RESULT: SELFCHECK FAILED on this device. Copy the output above." >&2
  exit 1
fi
echo "------------------------------------------------------------"

# 2) Full pytest suite -- best effort; skips cleanly if venv/pip are unavailable.
echo "[2/2] full pytest suite (best-effort)"
VPY=""
if "$PY" -m venv .venv >/dev/null 2>&1; then
  if   [ -x .venv/bin/python ];        then VPY=.venv/bin/python
  elif [ -x .venv/Scripts/python.exe ]; then VPY=.venv/Scripts/python.exe
  fi
fi
if [ -n "$VPY" ] && "$VPY" -m pip install -q -U pip pytest >/dev/null 2>&1; then
  if ! "$VPY" -m pytest -q; then
    echo " RESULT: pytest reported FAILURES on this device." >&2
    exit 1
  fi
else
  echo "  (skipped: venv/pytest unavailable here -- the selfcheck above is the gate)"
fi

echo "============================================================"
echo " RESULT: OK on $(uname -s 2>/dev/null || echo this-device) / $($PY -V 2>&1)"
echo "============================================================"
