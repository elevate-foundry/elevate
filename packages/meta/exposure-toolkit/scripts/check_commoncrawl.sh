#!/usr/bin/env bash
# check_commoncrawl.sh - query the Common Crawl index (build.md step 3).
# A hit means a major public web crawl captured the page. It does NOT prove
# OpenAI/Anthropic training inclusion — only that the page is web-crawlable.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

require curl "install curl"
require jq "install jq: https://jqlang.github.io/jq/"

[[ $# -ge 1 ]] || die "usage: check_commoncrawl.sh <url-pattern> [more-patterns...]
  e.g. check_commoncrawl.sh 'github.com/elevate-foundry/*'"

# Common Crawl publishes a new monthly index. Override with CC_INDEX env var.
# Pass multiple via CC_INDEX="CC-MAIN-2026-05 CC-MAIN-2025-51".
DEFAULT_INDEXES="${CC_INDEX:-CC-MAIN-2026-05 CC-MAIN-2025-51 CC-MAIN-2025-43}"
COLL_API="https://index.commoncrawl.org/collinfo.json"

ensure_outdir
STAMP="$(now_stamp)"

# Choose indexes. Explicit CC_INDEX always wins; otherwise auto-discover the
# latest available indexes so we don't rely on stale ids.
discover_indexes() {
  if [[ -n "${CC_INDEX:-}" ]]; then printf '%s\n' $CC_INDEX; return; fi
  local json ids
  json="$(curl -fsS --max-time 20 "$COLL_API" 2>/dev/null || echo '[]')"
  ids="$(jq -r '.[0:3][]?.id // empty' <<<"$json" 2>/dev/null || true)"
  if [[ -n "$ids" ]]; then printf '%s\n' "$ids"; else printf '%s\n' $DEFAULT_INDEXES; fi
}

# query_index <index> <pattern>
# Writes the response body to global QI_BODY and the HTTP status to QI_STATUS.
# Retries on timeout/5xx (transient upstream errors). curl write-out appends
# the status as the final line so we can separate it from the JSON body.
query_index() {
  local index="$1" pattern="$2"
  local enc url raw attempt=0 max_attempts=3
  enc="$(urlencode "$pattern")"
  url="https://index.commoncrawl.org/${index}-index?url=${enc}&output=json"
  QI_BODY=""; QI_STATUS="000"
  while (( attempt < max_attempts )); do
    attempt=$((attempt + 1))
    # -s silent, NO -f: we want the body+status even on HTTP errors.
    raw="$(curl -sS --max-time 45 -w $'\n__HTTP_STATUS__:%{http_code}' "$url" 2>/dev/null || printf '\n__HTTP_STATUS__:000')"
    QI_STATUS="${raw##*__HTTP_STATUS__:}"
    QI_BODY="${raw%$'\n'__HTTP_STATUS__:*}"
    case "$QI_STATUS" in
      200|404) return 0 ;;                      # definitive answers
      000|429|5*) sleep $(( attempt * 2 )) ;;    # transient: back off + retry
      *) return 0 ;;                             # other: surface as-is
    esac
  done
  return 0
}

# Portable read into array (macOS ships Bash 3.2, which lacks mapfile).
INDEXES=()
while IFS= read -r _idx; do
  [[ -n "$_idx" ]] && INDEXES+=("$_idx")
done < <(discover_indexes)
info "using Common Crawl indexes: ${INDEXES[*]}"

for pattern in "$@"; do
  hdr "Common Crawl: $pattern"
  out="$OUT_DIR/commoncrawl_$(printf '%s' "$pattern" | tr -c 'A-Za-z0-9' '_')_$STAMP.jsonl"
  : > "$out"
  total=0
  errors=0
  for index in "${INDEXES[@]}"; do
    query_index "$index" "$pattern"
    case "$QI_STATUS" in
      200)
        # 200 with a body of JSON lines = captures; empty body = no results.
        res="$(printf '%s' "$QI_BODY" | grep -E '^\{' || true)"
        if [[ -z "$res" ]]; then
          echo "  ${C_DIM}$index: no captures (200)${C_RESET}" >&2
          continue
        fi
        count="$(printf '%s\n' "$res" | grep -c . || true)"
        total=$((total + count))
        echo "  ${C_GREEN}$index: $count capture(s)${C_RESET}" >&2
        printf '%s\n' "$res" | jq -c --arg idx "$index" '. + {cc_index:$idx}' >> "$out" 2>/dev/null || \
          printf '%s\n' "$res" >> "$out"
        printf '%s\n' "$res" | jq -r '"    \(.url)  [\(.status)] \(.mime // "")"' 2>/dev/null | head -n 5 >&2 || true
        ;;
      404)
        echo "  ${C_DIM}$index: not in this index (404)${C_RESET}" >&2
        ;;
      000)
        err "  $index: request timed out / no response after retries"
        errors=$((errors + 1))
        ;;
      5*)
        err "  $index: server error HTTP $QI_STATUS (index unavailable) after retries"
        errors=$((errors + 1))
        ;;
      *)
        warn "  $index: unexpected HTTP $QI_STATUS"
        errors=$((errors + 1))
        ;;
    esac
  done
  if [[ "$total" -gt 0 ]]; then
    ok "$pattern: $total total capture(s) -> $out"
  elif [[ "$errors" -gt 0 ]]; then
    rm -f "$out"
    err "$pattern: INCONCLUSIVE — $errors index(es) errored (e.g. 504). This is NOT a clean negative."
    err "  The Common Crawl index server may be overloaded/down. Try again later or set CC_INDEX."
  else
    warn "$pattern: no captures found in checked indexes"
    rm -f "$out"
  fi
done
