#!/usr/bin/env bash
# audit.sh - SOC 2-oriented audit logging for the exposure toolkit.
#
# Provides an append-only, tamper-evident (hash-chained) JSONL audit trail that
# captures WHO did WHAT, to WHICH target, WHEN, and the OUTCOME. Designed to map
# onto the SOC 2 Trust Services Criteria:
#   - CC6 (Logical Access): records the acting identity (OS user, host, GitHub login).
#   - CC7 (System Operations / monitoring): timestamped event log of every action.
#   - Integrity: each record chains sha256(prev_hash + canonical_body); any edit,
#     deletion, or reordering breaks the chain and is caught by audit_verify.
#   - Confidentiality: log file is created 0600 and a redaction filter strips
#     anything resembling a GitHub token or Bearer credential.
#
# Requires: jq, shasum (both already toolkit dependencies / macOS built-ins).
# Must be sourced AFTER lib/common.sh (uses OUT_DIR, now_iso).

AUDIT_LOG="${AUDIT_LOG:-$OUT_DIR/audit/audit.jsonl}"
AUDIT_RUN_ID="${AUDIT_RUN_ID:-$(now_stamp)_$$}"
AUDIT_ACTOR="${AUDIT_ACTOR:-unknown}"   # set to the GitHub login by the caller
_AUDIT_SEQ=0
_AUDIT_PREV_HASH="GENESIS"

# Strip obvious secrets so credentials never land in the audit trail.
_audit_redact() {
  sed -E \
    -e 's/gh[posru]_[A-Za-z0-9]{20,}/[REDACTED_TOKEN]/g' \
    -e 's/(Bearer )[A-Za-z0-9._-]{8,}/\1[REDACTED]/g'
}

_audit_sha256() { shasum -a 256 | awk '{print $1}'; }

# audit_init - create the log with restrictive perms and resume the hash chain.
audit_init() {
  mkdir -p "$(dirname "$AUDIT_LOG")"
  touch "$AUDIT_LOG"
  chmod 600 "$AUDIT_LOG" 2>/dev/null || true
  if [[ -s "$AUDIT_LOG" ]]; then
    local last
    last="$(tail -n1 "$AUDIT_LOG")"
    _AUDIT_PREV_HASH="$(jq -r '.integrity.hash // "GENESIS"' <<<"$last" 2>/dev/null || echo GENESIS)"
    _AUDIT_SEQ="$(jq -r '.seq // 0' <<<"$last" 2>/dev/null || echo 0)"
  fi
}

# audit_event <event> <target> <outcome> [detail_json]
#   Appends one hash-chained audit record. Call serially from a single process
#   so the chain stays well-ordered (do NOT call from parallel workers).
audit_event() {
  local event="$1" target="$2" outcome="$3" detail="${4:-}"
  [[ -n "$detail" ]] || detail='{}'
  _AUDIT_SEQ=$((_AUDIT_SEQ + 1))

  local body canon hash line
  body="$(jq -cn \
    --arg ts "$(now_iso)" --arg run "$AUDIT_RUN_ID" --argjson seq "$_AUDIT_SEQ" \
    --arg event "$event" --arg target "$target" --arg outcome "$outcome" \
    --arg osuser "${USER:-unknown}" --arg host "$(hostname)" --arg gh "$AUDIT_ACTOR" \
    --argjson detail "$detail" \
    '{ts:$ts, run_id:$run, seq:$seq,
      actor:{os_user:$osuser, host:$host, github:$gh},
      event:$event, target:$target, outcome:$outcome, detail:$detail}')"

  # Canonical (sorted-key) form is what we hash, so verification is order-stable.
  canon="$(jq -cS . <<<"$body")"
  hash="$(printf '%s%s' "$_AUDIT_PREV_HASH" "$canon" | _audit_sha256)"

  line="$(jq -cn --argjson b "$body" --arg prev "$_AUDIT_PREV_HASH" --arg h "$hash" \
    '$b + {integrity:{alg:"sha256", prev_hash:$prev, hash:$h}}')"

  printf '%s\n' "$line" | _audit_redact >> "$AUDIT_LOG"
  _AUDIT_PREV_HASH="$hash"
}

# audit_verify [log] - re-walk the chain; prints status and returns non-zero on tamper.
audit_verify() {
  local log="${1:-$AUDIT_LOG}"
  [[ -s "$log" ]] || { echo "audit: empty/absent log ($log)"; return 0; }
  local prev="GENESIS" n=0 bad=0 line stored recprev canon calc
  while IFS= read -r line; do
    n=$((n + 1))
    stored="$(jq -r '.integrity.hash' <<<"$line" 2>/dev/null)"
    recprev="$(jq -r '.integrity.prev_hash' <<<"$line" 2>/dev/null)"
    canon="$(jq -cS 'del(.integrity)' <<<"$line" 2>/dev/null)"
    calc="$(printf '%s%s' "$recprev" "$canon" | _audit_sha256)"
    if [[ "$recprev" != "$prev" || "$calc" != "$stored" ]]; then
      bad=$((bad + 1))
      printf 'audit: INTEGRITY FAILURE at line %s (seq %s)\n' "$n" "$(jq -r '.seq // "?"' <<<"$line")" >&2
    fi
    prev="$stored"
  done < "$log"
  if (( bad == 0 )); then
    printf 'audit: chain OK — %s records verified, no tampering detected\n' "$n"
    return 0
  fi
  printf 'audit: chain BROKEN — %s/%s records failed verification\n' "$bad" "$n" >&2
  return 1
}
