#!/usr/bin/env bash
# sweep.sh - run an exposure check across ALL public repos of an owner in
# parallel (build.md steps 1, 3, 8 at org scale).
#
# Usage:
#   ./exposure.sh sweep <owner> [action]
#     action: scan (default) | traffic | forks | crawl
#
# Concurrency is controlled by JOBS (default 4). Each repo writes a full log to
# OUT_DIR/sweep/<repo>.log plus a one-line machine-readable summary to
# OUT_DIR/sweep/<repo>.sum; an aggregated table is printed and saved at the end.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"
# shellcheck source=../lib/parallel.sh
source "$SCRIPT_DIR/../lib/parallel.sh"
# shellcheck source=../lib/audit.sh
source "$SCRIPT_DIR/../lib/audit.sh"

require gh "install GitHub CLI: https://cli.github.com  then run 'gh auth login'"
require jq "install jq: https://jqlang.github.io/jq/"

[[ $# -ge 1 ]] || die "usage: sweep.sh <owner> [scan|traffic|forks|crawl]"
OWNER="$1"
ACTION="${2:-scan}"
JOBS="${JOBS:-4}"

case "$ACTION" in
  scan|traffic|forks|crawl) ;;
  *) die "unknown action: $ACTION (expected scan|traffic|forks|crawl)" ;;
esac

ensure_outdir
STAMP="$(now_stamp)"
SWEEP_DIR="$OUT_DIR/sweep_${ACTION}_$STAMP"
mkdir -p "$SWEEP_DIR"

# ---- SOC 2 audit trail -------------------------------------------------------
AUDIT_ACTOR="$(gh api user -q '.login' 2>/dev/null || echo unknown)"
export AUDIT_ACTOR
audit_init

# ---- worker: runs the chosen action for ONE repo, then distills a summary ----
sweep_one() {
  local name="$1"
  local repo="$OWNER/$name"
  local log="$SWEEP_DIR/$name.log"
  local sum="$SWEEP_DIR/$name.sum"

  {
    case "$ACTION" in
      traffic) "$SCRIPT_DIR/check_traffic.sh" "$repo" ;;
      forks)   "$SCRIPT_DIR/check_forks.sh" "$repo" ;;
      crawl)   "$SCRIPT_DIR/check_commoncrawl.sh" "github.com/$repo*" ;;
      scan)
        "$SCRIPT_DIR/check_traffic.sh" "$repo"            || true
        "$SCRIPT_DIR/check_forks.sh" "$repo"              || true
        "$SCRIPT_DIR/check_commoncrawl.sh" "github.com/$repo*" || true
        ;;
    esac
  } >"$log" 2>&1 || true

  # Distill machine-readable signals from the (color-free, redirected) log.
  local forks="-" views="-" clones="-" crawl="-"

  if grep -q 'Fork copies' "$log" 2>/dev/null; then
    forks="$(grep -oE 'Fork copies \(([0-9]+)\)' "$log" | grep -oE '[0-9]+' | head -1)"
    forks="${forks:-0}"
  fi

  if grep -q 'Views (14d)' "$log" 2>/dev/null; then
    views="$(grep 'Views (14d)' "$log" | grep -oE 'total=[0-9a-z/]+' | head -1 | cut -d= -f2)"
    clones="$(grep 'Clones (14d)' "$log" | grep -oE 'total=[0-9a-z/]+' | head -1 | cut -d= -f2)"
    views="${views:-n/a}"; clones="${clones:-n/a}"
  fi

  if grep -q 'total capture(s)' "$log" 2>/dev/null; then
    crawl="$(grep -oE '[0-9]+ total capture' "$log" | grep -oE '[0-9]+' | head -1)"
    crawl="${crawl:-0}"
  elif grep -q 'INCONCLUSIVE' "$log" 2>/dev/null; then
    crawl="ERR"
  elif grep -qE 'no captures|not in this index' "$log" 2>/dev/null; then
    crawl="0"
  fi

  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$forks" "$views" "$clones" "$crawl" >"$sum"
  ok "[$ACTION] $name  forks=$forks views=$views clones=$clones crawl=$crawl"
}

# ---- enumerate targets -------------------------------------------------------
hdr "SWEEP $OWNER  action=$ACTION  jobs=$JOBS"
REPOS="$(gh repo list "$OWNER" --visibility public --limit 1000 --json name -q '.[].name' 2>/dev/null | sort || true)"
[[ -n "$REPOS" ]] || die "no public repos found for $OWNER (or 'gh auth login' not run)"
COUNT="$(printf '%s\n' "$REPOS" | grep -c . || true)"
info "$COUNT public repos -> $SWEEP_DIR"

audit_event "sweep.start" "$OWNER" "info" \
  "$(jq -cn --arg a "$ACTION" --argjson j "$JOBS" --argjson c "$COUNT" --arg d "$SWEEP_DIR" \
     '{action:$a, jobs:$j, repo_count:$c, output_dir:$d}')"

# ---- fan out -----------------------------------------------------------------
printf '%s\n' "$REPOS" | pmap "$JOBS" sweep_one || warn "one or more repos errored (see logs)"

# ---- aggregate ---------------------------------------------------------------
SUMMARY="$SWEEP_DIR/summary.tsv"
{
  printf 'repo\tforks\tviews\tclones\tcrawl\n'
  cat "$SWEEP_DIR"/*.sum 2>/dev/null | sort
} >"$SUMMARY"

# Emit one audit record per repo (serially, from this single process so the
# hash chain stays well-ordered) capturing the outcome of each access.
for sumfile in "$SWEEP_DIR"/*.sum; do
  [[ -e "$sumfile" ]] || continue
  IFS=$'\t' read -r r_name r_forks r_views r_clones r_crawl < "$sumfile"
  r_outcome="success"
  [[ "$r_crawl" == "ERR" ]] && r_outcome="inconclusive"
  audit_event "repo.checked" "$OWNER/$r_name" "$r_outcome" \
    "$(jq -cn --arg f "$r_forks" --arg v "$r_views" --arg c "$r_clones" --arg cc "$r_crawl" \
       '{forks:$f, views:$v, clones:$c, crawl:$cc}')"
done

hdr "SUMMARY ($ACTION)"
column -t -s $'\t' "$SUMMARY" >&2 2>/dev/null || cat "$SUMMARY" >&2
ok "summary -> $SUMMARY"

# Highlight anything noteworthy.
NOTABLE="$(awk -F'\t' 'NR>1 && (($2 ~ /^[0-9]+$/ && $2>0) || ($5 ~ /^[0-9]+$/ && $5>0) || $5=="ERR") {print "  "$1": forks="$2" crawl="$5}' "$SUMMARY" || true)"
if [[ -n "$NOTABLE" ]]; then
  hdr "NOTABLE (forks>0 or crawl captures/errors)"
  printf '%s\n' "$NOTABLE" >&2
else
  info "no forks or Common Crawl captures detected across $COUNT repos"
fi

# ---- close + integrity-check the audit trail ---------------------------------
NOTABLE_COUNT="$(printf '%s' "$NOTABLE" | grep -c . || true)"
audit_event "sweep.end" "$OWNER" "success" \
  "$(jq -cn --arg s "$SUMMARY" --argjson n "${NOTABLE_COUNT:-0}" \
     '{summary:$s, notable_count:$n}')"

hdr "AUDIT (SOC 2)"
info "audit log -> $AUDIT_LOG (run_id=$AUDIT_RUN_ID)"
audit_verify "$AUDIT_LOG" >&2
