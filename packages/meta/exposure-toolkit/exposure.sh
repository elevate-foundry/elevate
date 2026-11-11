#!/usr/bin/env bash
# exposure.sh - dispatcher for the AI crawl/training exposure-detection toolkit.
#
# Automates the workflow in build.md: check GitHub traffic, query Common Crawl,
# search for exact/canary strings, generate & monitor canaries, and inspect forks.
#
# Usage:
#   ./exposure.sh <command> [args...]
#   ./exposure.sh help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$SCRIPT_DIR/scripts"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<EOF
${C_BOLD}exposure.sh${C_RESET} - detect AI crawl/training exposure of public repos

${C_BOLD}USAGE${C_RESET}
  ./exposure.sh <command> [options]

${C_BOLD}COMMANDS${C_RESET}
  ${C_GREEN}traffic${C_RESET}   <owner/repo>        GitHub views/clones/referrers (needs push access)
  ${C_GREEN}forks${C_RESET}     <owner/repo|owner>  Forks, stars, watchers — extra public copies
  ${C_GREEN}crawl${C_RESET}     <url-pattern>       Query the Common Crawl index for a URL/pattern
  ${C_GREEN}search${C_RESET}    <string>            Search exact strings across GitHub + web engines
  ${C_GREEN}canary${C_RESET}    <new|check> ...     Generate a unique canary or search for one
  ${C_GREEN}scan${C_RESET}      <owner/repo>        Run traffic + forks + crawl in one pass
  ${C_GREEN}sweep${C_RESET}     <owner> [action]    Run an action across ALL public repos in parallel
  ${C_GREEN}help${C_RESET}                          Show this help

${C_BOLD}ENVIRONMENT${C_RESET}
  OUT_DIR     Output directory for reports/canaries (default: ./exposure-output)
  CC_INDEX    Common Crawl index id (default: latest known in scripts/check_commoncrawl.sh)
  JOBS        Max parallel repos for 'sweep' (default: 4)
  NO_COLOR    Disable colored output

${C_BOLD}EXAMPLES${C_RESET}
  ./exposure.sh traffic elevate-foundry/cerebraille
  ./exposure.sh forks   elevate-foundry
  ./exposure.sh crawl   'github.com/elevate-foundry/*'
  ./exposure.sh search  'semantic density operator'
  ./exposure.sh canary  new --repo elevate-foundry/cerebraille
  ./exposure.sh canary  check CANARY_ELEVATE_FOUNDRY_2026_06_09_Q7K3
  ./exposure.sh scan    elevate-foundry/cerebraille
  JOBS=6 ./exposure.sh sweep elevate-foundry forks

${C_DIM}Note: these tools verify EXPOSURE and PROPAGATION, not training inclusion.${C_RESET}
EOF
}

main() {
  local cmd="${1:-help}"
  [[ $# -gt 0 ]] && shift || true

  case "$cmd" in
    traffic) exec "$SCRIPTS_DIR/check_traffic.sh" "$@" ;;
    forks)   exec "$SCRIPTS_DIR/check_forks.sh" "$@" ;;
    crawl)   exec "$SCRIPTS_DIR/check_commoncrawl.sh" "$@" ;;
    search)  exec "$SCRIPTS_DIR/search_strings.sh" "$@" ;;
    canary)  exec "$SCRIPTS_DIR/canary.sh" "$@" ;;
    sweep)   exec "$SCRIPTS_DIR/sweep.sh" "$@" ;;
    scan)
      [[ $# -ge 1 ]] || die "scan requires <owner/repo>"
      local repo="$1"; local owner="${repo%%/*}"
      hdr "SCAN: $repo"
      "$SCRIPTS_DIR/check_traffic.sh" "$repo" || warn "traffic step failed (need push access?)"
      "$SCRIPTS_DIR/check_forks.sh" "$repo" || warn "forks step failed"
      "$SCRIPTS_DIR/check_commoncrawl.sh" "github.com/$repo*" || warn "crawl step failed"
      ok "scan complete"
      ;;
    help|-h|--help) usage ;;
    *) err "unknown command: $cmd"; echo; usage; exit 2 ;;
  esac
}

main "$@"
