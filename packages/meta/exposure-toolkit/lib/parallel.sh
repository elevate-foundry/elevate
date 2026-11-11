#!/usr/bin/env bash
# parallel.sh - portable bounded-concurrency job runner for the toolkit.
# Sourced by scripts that need to fan work out across many repos.
#
# Works on Bash 3.2 (the version macOS ships) — it does NOT rely on `wait -n`,
# which only exists in Bash 4.3+. Concurrency is bounded by waiting on the
# oldest in-flight job whenever the pool is full.

# pmap <max_jobs> <cmd> [args...]
#   Reads newline-delimited items from stdin and runs `<cmd> [args...] <item>`
#   for each one, keeping at most <max_jobs> running concurrently.
#   <cmd> may be a shell function or an external command; it is backgrounded in
#   the current shell so functions and exported variables remain visible.
#   Returns non-zero if any job exited non-zero.
pmap() {
  local max="$1"; shift
  [[ "$max" =~ ^[0-9]+$ && "$max" -ge 1 ]] || max=4

  local -a pids=()
  local item rc=0

  while IFS= read -r item; do
    [[ -z "$item" ]] && continue
    "$@" "$item" &
    pids+=("$!")
    if (( ${#pids[@]} >= max )); then
      # Pool full: block on the oldest job, then drop it so a slot frees up.
      wait "${pids[0]}" || rc=1
      pids=("${pids[@]:1}")
    fi
  done

  # Drain any still-running jobs.
  local p
  for p in "${pids[@]:-}"; do
    [[ -n "$p" ]] || continue
    wait "$p" || rc=1
  done

  return "$rc"
}
