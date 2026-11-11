#!/usr/bin/env bash
# check_traffic.sh - GitHub-native traffic signal (build.md step 1).
# Pulls views, clones, top referrers, and popular paths via the GitHub API.
# Requires push/admin access to the repo (traffic endpoints are owner-only).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

require gh "install GitHub CLI: https://cli.github.com  then run 'gh auth login'"
require jq "install jq: https://jqlang.github.io/jq/"

[[ $# -ge 1 ]] || die "usage: check_traffic.sh <owner/repo>"
REPO="$1"
[[ "$REPO" == */* ]] || die "expected owner/repo, got: $REPO"

ensure_outdir
STAMP="$(now_stamp)"
REPORT="$OUT_DIR/traffic_${REPO//\//_}_$STAMP.json"

gh_api() {
  # $1 = api path. Returns {} on permission/other errors so the report still builds.
  gh api -H "Accept: application/vnd.github+json" "$1" 2>/dev/null || echo '{}'
}

hdr "GitHub traffic for $REPO"

VIEWS="$(gh_api "repos/$REPO/traffic/views")"
CLONES="$(gh_api "repos/$REPO/traffic/clones")"
REFERRERS="$(gh_api "repos/$REPO/traffic/popular/referrers")"
PATHS="$(gh_api "repos/$REPO/traffic/popular/paths")"
META="$(gh_api "repos/$REPO")"

if [[ "$VIEWS" == "{}" && "$CLONES" == "{}" ]]; then
  warn "no traffic data returned — you likely lack push access to $REPO,"
  warn "or 'gh auth login' has not been run. Traffic endpoints are owner-only."
fi

# Print a human summary.
echo "${C_BOLD}Views (14d):${C_RESET}  total=$(jq -r '.count // "n/a"' <<<"$VIEWS")  unique=$(jq -r '.uniques // "n/a"' <<<"$VIEWS")" >&2
echo "${C_BOLD}Clones (14d):${C_RESET} total=$(jq -r '.count // "n/a"' <<<"$CLONES")  unique=$(jq -r '.uniques // "n/a"' <<<"$CLONES")" >&2

echo "${C_BOLD}Top referrers:${C_RESET}" >&2
jq -r 'if type=="array" and length>0 then .[] | "  \(.referrer)  views=\(.count) unique=\(.uniques)" else "  (none / no access)" end' <<<"$REFERRERS" >&2

echo "${C_BOLD}Popular paths:${C_RESET}" >&2
jq -r 'if type=="array" and length>0 then .[] | "  \(.path)  views=\(.count) unique=\(.uniques)" else "  (none / no access)" end' <<<"$PATHS" >&2

# Flag suspicious clone spikes: any day where clones==uniques and count is high
echo "${C_BOLD}Daily clone breakdown (spike heuristic):${C_RESET}" >&2
jq -r '
  if (.clones // null) then
    .clones[] |
    "  \(.timestamp[0:10])  clones=\(.count) unique=\(.uniques)" +
    (if .count > 5 and .count == .uniques then "  <-- possible bot/scraper burst" else "" end)
  else "  (no data)" end' <<<"$CLONES" >&2 || true

# Assemble combined JSON report.
jq -n \
  --arg repo "$REPO" --arg ts "$(now_iso)" \
  --argjson views "$VIEWS" --argjson clones "$CLONES" \
  --argjson referrers "$REFERRERS" --argjson paths "$PATHS" \
  --argjson meta "$META" \
  '{repo:$repo, generated_at:$ts, stars:($meta.stargazers_count // null),
    forks:($meta.forks_count // null), watchers:($meta.subscribers_count // null),
    created_at:($meta.created_at // null), pushed_at:($meta.pushed_at // null),
    views:$views, clones:$clones, referrers:$referrers, popular_paths:$paths}' \
  > "$REPORT"

ok "saved report -> $REPORT"
