#!/usr/bin/env bash
# RED baseline: fresh headless sessions WITHOUT the skill and WITHOUT the
# global CLAUDE.md.
#
# WARNING: this script temporarily renames ~/.claude/CLAUDE.md — while it runs,
# other FRESHLY-started Claude sessions lose global instructions (already
# running sessions are unaffected: the harness caches CLAUDE.md at startup —
# which is also why a baseline cannot be produced from within a running
# session; you need this script). Restoration is guaranteed by a trap on
# EXIT/INT/TERM; a SIGKILL/power loss leaves CLAUDE.md renamed (backup:
# CLAUDE.md.pressure-baseline-backup) — the next baseline run self-heals
# the stale backup at startup.
#
# BASELINE VALIDITY: the rename removes ONLY ~/.claude/CLAUDE.md. Machine-
# level process rules injected through other channels still reach baseline
# sessions — before crediting a compliant baseline to clean model defaults,
# check the transcript for reliance on injected rules (forge-skill's law).
#
# Every scenario runs in a neutral empty cwd.
# Usage: run-baseline.sh [scenario-name ...]   # no args = all from map.tsv
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/out/baseline-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
WORK=$(mktemp -d)  # parent; per-scenario subdirs — concurrent sessions must
                   # not share a cwd (cross-scenario contamination)
CM="$HOME/.claude/CLAUDE.md"
BK="$HOME/.claude/CLAUDE.md.pressure-baseline-backup"
LOCK="$HOME/.claude/.pressure-baseline-lock"

# Single-writer lock FIRST (the self-heal below must never run while another
# baseline is live — it would restore CLAUDE.md under that run's sessions).
# The lock carries the holder's PID. mkdir→pid-write is two steps, so an
# EMPTY pid can be a winner mid-acquisition, not a corpse: give it a grace
# re-read before calling the lock stale. A holder pid is live only if the
# process both exists AND is a run-baseline invocation (a recycled pid
# belonging to an unrelated process must not refuse baselines forever).
is_live_baseline() {
  # True only when the pid's argv0 is this script (or a shell running it) —
  # a recycled pid in an editor/pager whose args mention the script must not
  # refuse baselines forever.
  local cmd argv0
  cmd=$(ps -p "$1" -o command= 2>/dev/null) || return 1
  argv0=${cmd%% *}; argv0=${argv0##*/}
  # Match the WHOLE command string for shell holders, not whitespace field 2:
  # install paths with spaces (or a shell flag before the script) put the
  # script path outside $2 and a LIVE run would read as stale (silent RED
  # contamination via takeover). *run-baseline.sh* on the full string is
  # space-safe; the argv0 gate above it keeps editors/pagers mentioning the
  # script from matching.
  case "$argv0" in
    run-baseline.sh) return 0 ;;
    sh|bash|zsh|dash) case "$cmd" in *run-baseline.sh*) return 0 ;; esac ;;
  esac
  return 1
}
if ! mkdir "$LOCK" 2>/dev/null; then
  holder=$(cat "$LOCK/pid" 2>/dev/null || echo "")
  if [ -z "$holder" ]; then
    sleep 2
    holder=$(cat "$LOCK/pid" 2>/dev/null || echo "")
  fi
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null && is_live_baseline "$holder"; then
    echo "[baseline] a live baseline run (pid $holder) holds $LOCK — refusing to start" >&2
    exit 1
  fi
  # Atomic takeover: rename the stale lock aside — only ONE of two concurrent
  # starters wins the rename; the loser must not rm a lock the winner already
  # replaced with its own live one.
  if ! mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null; then
    echo "[baseline] another starter is taking over the stale lock — refusing to start (re-run)" >&2
    exit 1
  fi
  echo "[baseline] removed stale lock (holder pid ${holder:-unknown} was not a live baseline run)" >&2
  rm -rf "$LOCK.stale.$$"
  mkdir "$LOCK" || { echo "[baseline] cannot acquire $LOCK" >&2; exit 1; }
fi
echo $$ > "$LOCK/pid"

# Self-heal a stale backup from a hard-killed previous run (safe: we hold
# the lock, so no other baseline is live).
if [ -f "$BK" ] && [ ! -f "$CM" ]; then
  mv "$BK" "$CM" && echo "[baseline] stale backup from a killed run restored" >&2
elif [ -f "$BK" ] && [ -f "$CM" ]; then
  echo "[baseline] BOTH $CM and stale backup $BK exist (CLAUDE.md was recreated after a killed run)." >&2
  echo "[baseline] Refusing to overwrite the backup — reconcile the two files manually, then re-run." >&2
  rm -rf "$LOCK"
  exit 1
fi

restore() {
  if [ -f "$BK" ]; then mv "$BK" "$CM" && echo "[baseline] CLAUDE.md restored"; fi
  rm -rf "$LOCK" 2>/dev/null || true
}
trap restore EXIT INT TERM

printf '%s\n' "NOTE: baseline ran on this machine's environment. The CLAUDE.md rename does not remove process rules injected through other channels; check transcripts for reliance on injected rules before crediting model defaults (forge-skill's law)." > "$OUT/NOTE-baseline-validity.txt"

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  while IFS=$'\t' read -r n _rest; do [ -n "$n" ] && names+=("$n"); done < "$HERE/map.tsv"
fi

[ -f "$CM" ] && mv "$CM" "$BK" && echo "[baseline] CLAUDE.md renamed"

for name in "${names[@]}"; do
  line=$(awk -F'\t' -v n="$name" '$1==n' "$HERE/map.tsv")
  [ -z "$line" ] && { echo "SKIP $name: not in map.tsv" >&2; continue; }
  [ -f "$HERE/scenarios/$name.md" ] || { echo "SKIP $name: scenario file missing" >&2; continue; }
  model=$(printf '%s' "$line" | cut -f2)
  mkdir -p "$WORK/$name"
  ( cd "$WORK/$name" && claude -p "$(cat "$HERE/scenarios/$name.md")" --model "$model" \
      > "$OUT/$name.txt" 2> "$OUT/$name.err"
    echo "[baseline] $name done exit=$?" ) &
done
wait
restore
trap - EXIT INT TERM
rm -rf "$WORK" 2>/dev/null || true
echo "[baseline] outputs: $OUT"
