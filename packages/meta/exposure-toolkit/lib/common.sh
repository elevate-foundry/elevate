#!/usr/bin/env bash
# common.sh - shared helpers for the exposure-detection toolkit.
# Sourced by all subcommand scripts. Not meant to be run directly.

set -euo pipefail

# ---- colors (disabled when not a TTY or NO_COLOR is set) --------------------
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_DIM=""
fi

log()   { printf '%s\n' "$*" >&2; }
info()  { printf '%s%s%s\n' "$C_BLUE" "$*" "$C_RESET" >&2; }
ok()    { printf '%s%s%s\n' "$C_GREEN" "$*" "$C_RESET" >&2; }
warn()  { printf '%s%s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; }
err()   { printf '%s%s%s\n' "$C_RED" "$*" "$C_RESET" >&2; }
hdr()   { printf '\n%s== %s ==%s\n' "$C_BOLD" "$*" "$C_RESET" >&2; }

die() { err "error: $*"; exit 1; }

# Verify a command exists; otherwise explain how to get it.
require() {
  local cmd="$1" hint="${2:-}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "missing dependency: $cmd"
    [[ -n "$hint" ]] && err "  -> $hint"
    exit 127
  fi
}

# Default output directory for reports/canaries. Override with OUT_DIR env.
OUT_DIR="${OUT_DIR:-$PWD/exposure-output}"
ensure_outdir() { mkdir -p "$OUT_DIR"; }

# UTC timestamp helpers
now_iso()    { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
now_stamp()  { date -u +"%Y%m%d_%H%M%S"; }

# URL-encode a string using jq (already a dependency for JSON parsing).
urlencode() {
  printf '%s' "$1" | jq -sRr @uri
}
