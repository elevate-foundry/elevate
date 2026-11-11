#!/usr/bin/env bash
# check_forks.sh - inspect forks/stars/watchers (build.md step 8).
# Accepts either a single repo (owner/repo) or an owner/org (lists all public repos).
# Forks matter because each is an additional public copy that can be crawled separately.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

require gh "install GitHub CLI: https://cli.github.com  then run 'gh auth login'"
require jq "install jq: https://jqlang.github.io/jq/"

[[ $# -ge 1 ]] || die "usage: check_forks.sh <owner/repo | owner>"
TARGET="$1"
ensure_outdir
STAMP="$(now_stamp)"

list_owner_repos() {
  local owner="$1"
  hdr "Public repos for $owner"
  local out="$OUT_DIR/repos_${owner}_$STAMP.json"
  gh repo list "$owner" --visibility public --limit 1000 \
    --json name,stargazerCount,forkCount,updatedAt,url 2>/dev/null > "$out" || { warn "could not list repos for $owner"; echo "[]" > "$out"; }
  jq -r '.[] | "  \(.name)  stars=\(.stargazerCount) forks=\(.forkCount)  \(.url)"' "$out" >&2
  ok "saved -> $out"
}

inspect_repo() {
  local repo="$1"
  hdr "Repo + forks for $repo"
  local meta forks out
  meta="$(gh repo view "$repo" --json name,stargazerCount,forkCount,watchers,createdAt,updatedAt,url 2>/dev/null || echo '{}')"
  echo "${C_BOLD}stars=$(jq -r '.stargazerCount // "n/a"' <<<"$meta")  forks=$(jq -r '.forkCount // "n/a"' <<<"$meta")  watchers=$(jq -r '.watchers.totalCount // "n/a"' <<<"$meta")${C_RESET}" >&2

  forks="$(gh api --paginate "repos/$repo/forks" 2>/dev/null | jq -s 'add // []' 2>/dev/null || echo '[]')"
  local n; n="$(jq 'length' <<<"$forks")"
  echo "${C_BOLD}Fork copies ($n):${C_RESET}" >&2
  jq -r 'if length>0 then .[] | "  \(.full_name)  created=\(.created_at[0:10])  \(.html_url)" else "  (no forks)" end' <<<"$forks" >&2

  out="$OUT_DIR/forks_${repo//\//_}_$STAMP.json"
  jq -n --argjson meta "$meta" --argjson forks "$forks" --arg ts "$(now_iso)" \
    '{repo:$meta, generated_at:$ts, fork_count:($forks|length), forks:$forks}' > "$out"
  ok "saved -> $out"
}

if [[ "$TARGET" == */* ]]; then
  inspect_repo "$TARGET"
else
  list_owner_repos "$TARGET"
fi
