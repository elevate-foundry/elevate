#!/usr/bin/env bash
# canary.sh - generate & monitor unique canary tokens (build.md steps 5 & 6).
#
#   canary.sh new   [--repo owner/repo] [--label TEXT]   -> mint a unique token
#   canary.sh check <token>                              -> search for a token's spread
#   canary.sh list                                       -> show minted canaries
#
# A canary is a harmless unique string you place in public README/docs. If it
# later appears in search results, mirrors, datasets, or model output (with
# browsing disabled), you have propagation/memorization evidence.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

require jq "install jq: https://jqlang.github.io/jq/"

ensure_outdir
LEDGER="$OUT_DIR/canaries.jsonl"

rand_token() {
  # 8 uppercase base32-ish chars from a secure source, no ambiguous 0/O/1/I.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 8 | tr 'a-f' 'A-F' | tr -d '01OI' | cut -c1-8
  else
    LC_ALL=C tr -dc 'A-HJ-NP-Z2-9' </dev/urandom | head -c 8
  fi
}

cmd_new() {
  local repo="" label=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo)  repo="$2"; shift 2 ;;
      --label) label="$2"; shift 2 ;;
      *) die "unknown option: $1" ;;
    esac
  done
  local date_part rnd token
  date_part="$(date -u +%Y_%m_%d)"
  rnd="$(rand_token)"
  token="CANARY_ELEVATE_FOUNDRY_${date_part}_${rnd}"
  [[ -n "$label" ]] && token="${token}_$(printf '%s' "$label" | tr -c 'A-Za-z0-9' '_' | tr 'a-z' 'A-Z')"

  hdr "New canary minted"
  echo "  ${C_BOLD}$token${C_RESET}" >&2
  echo >&2
  info "Place it (verbatim) in public, crawlable locations:"
  cat >&2 <<EOF
  - README.md
  - docs site / generated docs
  - package description (PyPI/npm)
  - release notes
  - a comment in a noncritical source file
EOF

  jq -nc --arg token "$token" --arg repo "$repo" --arg label "$label" --arg ts "$(now_iso)" \
    '{token:$token, repo:$repo, label:$label, created_at:$ts}' >> "$LEDGER"
  ok "recorded in $LEDGER"
}

cmd_check() {
  [[ $# -ge 1 ]] || die "usage: canary.sh check <token>"
  local token="$1"
  hdr "Checking canary spread: $token"
  warn "Search engines/code indexes have no free no-auth bulk API; opening query URLs."
  # Reuse the string searcher for consistent output + report.
  "$SCRIPT_DIR/search_strings.sh" "$token" "${@:2}"
  echo >&2
  info "Model-memorization test (run with browsing/search DISABLED):"
  cat >&2 <<EOF
  Prompt 1: Complete this exact phrase: "${token%_*}_..."
  Prompt 2: What repository contains the identifier "$token"?
  If a model reproduces it without retrieval -> stronger training/memorization signal.
EOF
}

cmd_list() {
  hdr "Minted canaries"
  if [[ -s "$LEDGER" ]]; then
    jq -r '"  \(.created_at)  \(.token)" + (if .repo != "" then "  (\(.repo))" else "" end)' "$LEDGER" >&2
  else
    echo "  (none yet — run: canary.sh new)" >&2
  fi
}

SUB="${1:-}"; [[ $# -gt 0 ]] && shift || true
case "$SUB" in
  new)   cmd_new "$@" ;;
  check) cmd_check "$@" ;;
  list)  cmd_list ;;
  *) die "usage: canary.sh <new|check|list> [...]" ;;
esac
