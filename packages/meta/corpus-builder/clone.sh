#!/usr/bin/env bash
# clone.sh - shallow-clone an owner's NATIVE (non-fork) public repos into
# corpus-builder/repos/ to build an LLM training corpus from their source code.
#
# Forks are skipped by default (their history/code is upstream authors', not the
# org's "voice"). Every clone is recorded in the SOC 2 audit trail.
#
# Usage:
#   ./clone.sh [owner]            # default owner: elevate-foundry
#   INCLUDE_FORKS=1 ./clone.sh    # also clone forks
#   MAX_KB=250000 ./clone.sh      # skip repos whose GitHub diskUsage exceeds MAX_KB

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT="$SCRIPT_DIR/../exposure-toolkit"

# Route the SOC 2 audit trail into this project's output dir.
export OUT_DIR="${OUT_DIR:-$SCRIPT_DIR/out}"
export AUDIT_LOG="${AUDIT_LOG:-$OUT_DIR/audit/corpus_audit.jsonl}"
# shellcheck source=../exposure-toolkit/lib/common.sh
source "$TOOLKIT/lib/common.sh"
# shellcheck source=../exposure-toolkit/lib/audit.sh
source "$TOOLKIT/lib/audit.sh"

require gh "install GitHub CLI: https://cli.github.com"
require jq "install jq"
require git "install git"

OWNER="${1:-elevate-foundry}"
INCLUDE_FORKS="${INCLUDE_FORKS:-0}"
MAX_KB="${MAX_KB:-0}"            # 0 = no cap
REPOS_DIR="$SCRIPT_DIR/repos"
mkdir -p "$REPOS_DIR"

AUDIT_ACTOR="$(gh api user -q '.login' 2>/dev/null || echo unknown)"
export AUDIT_ACTOR
audit_init

hdr "CLONE $OWNER (include_forks=$INCLUDE_FORKS max_kb=$MAX_KB)"

# name<TAB>diskUsageKB<TAB>isFork
META="$(gh repo list "$OWNER" --visibility public --limit 1000 \
  --json name,diskUsage,isFork \
  -q '.[] | [.name, (.diskUsage|tostring), (.isFork|tostring)] | @tsv')"

audit_event "corpus.clone.start" "$OWNER" "info" \
  "$(jq -cn --arg if "$INCLUDE_FORKS" --arg mk "$MAX_KB" '{include_forks:$if, max_kb:$mk}')"

cloned=0; skipped=0; failed=0
while IFS=$'\t' read -r name kb isfork; do
  [[ -n "$name" ]] || continue

  if [[ "$isfork" == "true" && "$INCLUDE_FORKS" != "1" ]]; then
    info "skip $name (fork)"
    audit_event "corpus.clone.skip" "$OWNER/$name" "skipped" '{"reason":"fork"}'
    skipped=$((skipped+1)); continue
  fi
  if [[ "$MAX_KB" -gt 0 && "$kb" =~ ^[0-9]+$ && "$kb" -gt "$MAX_KB" ]]; then
    warn "skip $name (${kb}KB > MAX_KB=$MAX_KB)"
    audit_event "corpus.clone.skip" "$OWNER/$name" "skipped" \
      "$(jq -cn --arg kb "$kb" '{reason:"too_large", disk_kb:$kb}')"
    skipped=$((skipped+1)); continue
  fi

  dest="$REPOS_DIR/$name"
  rm -rf "$dest"
  if git clone --depth 1 --quiet "https://github.com/$OWNER/$name.git" "$dest" 2>/dev/null; then
    sha="$(git -C "$dest" rev-parse HEAD 2>/dev/null || echo unknown)"
    bytes="$(du -sk "$dest" 2>/dev/null | awk '{print $1*1024}')"
    ok "cloned $name @ ${sha:0:8} (${bytes} bytes)"
    audit_event "corpus.clone.ok" "$OWNER/$name" "success" \
      "$(jq -cn --arg sha "$sha" --arg b "$bytes" --arg fork "$isfork" \
         '{head:$sha, bytes:($b|tonumber? // 0), fork:$fork}')"
    cloned=$((cloned+1))
  else
    err "clone failed: $name"
    audit_event "corpus.clone.fail" "$OWNER/$name" "failure" '{}'
    failed=$((failed+1))
  fi
done <<< "$META"

audit_event "corpus.clone.end" "$OWNER" "success" \
  "$(jq -cn --argjson c "$cloned" --argjson s "$skipped" --argjson f "$failed" \
     '{cloned:$c, skipped:$s, failed:$f}')"

hdr "DONE: cloned=$cloned skipped=$skipped failed=$failed -> $REPOS_DIR"
audit_verify "$AUDIT_LOG" >&2
