#!/usr/bin/env bash
# search_strings.sh - search exact/unique strings across code & web indexes
# (build.md steps 2 & 7). Finds propagation onto mirrors, forks, datasets, etc.
#
# - GitHub code search runs live via `gh` (authenticated).
# - Web/code indexes that lack a free no-auth API are emitted as ready-to-open
#   query URLs so you can click through (Google, Bing, grep.app, Sourcegraph,
#   PyPI, npm, Hugging Face, Software Heritage, Papers with Code).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

require jq "install jq: https://jqlang.github.io/jq/"

[[ $# -ge 1 ]] || die "usage: search_strings.sh <exact string> [--open]
  --open   open the generated web-search URLs in your default browser (macOS: open)"

OPEN=0
ARGS=()
for a in "$@"; do
  [[ "$a" == "--open" ]] && { OPEN=1; continue; }
  ARGS+=("$a")
done
QUERY="${ARGS[*]}"
[[ -n "$QUERY" ]] || die "empty search string"

ensure_outdir
STAMP="$(now_stamp)"
REPORT="$OUT_DIR/search_$(printf '%s' "$QUERY" | tr -c 'A-Za-z0-9' '_' | cut -c1-40)_$STAMP.txt"
ENC="$(urlencode "\"$QUERY\"")"

{
  echo "exact-string exposure search"
  echo "query     : \"$QUERY\""
  echo "generated : $(now_iso)"
  echo
} | tee "$REPORT" >&2

# ---- live GitHub code search (if gh is available + authed) ------------------
if command -v gh >/dev/null 2>&1; then
  hdr "GitHub code search (live)"
  if gh api -H "Accept: application/vnd.github+json" \
      "search/code?q=$(urlencode "\"$QUERY\"")&per_page=20" >"$OUT_DIR/.gh_code_$STAMP.json" 2>/dev/null; then
    n="$(jq -r '.total_count // 0' "$OUT_DIR/.gh_code_$STAMP.json")"
    echo "  total_count=$n" | tee -a "$REPORT" >&2
    jq -r '.items[]? | "  \(.repository.full_name)  \(.path)  \(.html_url)"' \
      "$OUT_DIR/.gh_code_$STAMP.json" | tee -a "$REPORT" >&2 || true
    mv "$OUT_DIR/.gh_code_$STAMP.json" "$OUT_DIR/gh_code_search_$STAMP.json"
  else
    warn "GitHub code search failed (auth required / rate limited). Use the URL below."
    rm -f "$OUT_DIR/.gh_code_$STAMP.json"
  fi
else
  warn "gh not installed — skipping live GitHub code search"
fi

# ---- click-through query URLs for indexes without free no-auth APIs ---------
hdr "Open these to check web/code/dataset indexes"
declare -a URLS=(
  "Google|https://www.google.com/search?q=$ENC"
  "Bing|https://www.bing.com/search?q=$ENC"
  "DuckDuckGo|https://duckduckgo.com/?q=$ENC"
  "GitHub code|https://github.com/search?type=code&q=$ENC"
  "grep.app|https://grep.app/search?q=$(urlencode "$QUERY")"
  "Sourcegraph|https://sourcegraph.com/search?q=context:global+$(urlencode "$QUERY")&patternType=literal"
  "PyPI|https://pypi.org/search/?q=$(urlencode "$QUERY")"
  "npm|https://www.npmjs.com/search?q=$(urlencode "$QUERY")"
  "Hugging Face|https://huggingface.co/search/full-text?q=$(urlencode "$QUERY")"
  "Software Heritage|https://archive.softwareheritage.org/browse/search/?q=$(urlencode "$QUERY")"
  "Papers with Code|https://paperswithcode.com/search?q=$(urlencode "$QUERY")"
)

for entry in "${URLS[@]}"; do
  name="${entry%%|*}"; url="${entry#*|}"
  printf '  %-18s %s\n' "$name" "$url" | tee -a "$REPORT" >&2
  if [[ "$OPEN" -eq 1 ]] && command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  fi
done

ok "saved -> $REPORT"
[[ "$OPEN" -eq 0 ]] && info "tip: re-run with --open to launch these in your browser"
