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
# sessions, and the recorded final message cannot PROVE absence of reliance
# on them — every baseline is DIAGNOSTIC evidence, never proof of clean
# model defaults (forge-skill's law; see NOTE-baseline-validity.txt).
#
# Every scenario runs in a neutral empty cwd.
# Usage: run-baseline.sh [scenario-name ...]   # no args = all from map.tsv
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
FAMILY=$(cd "$HERE/../.." && pwd)
OUT="$HERE/out/baseline-$(date -u +%Y%m%d-%H%M%S)Z"
# Identity must be unique (same-second runs must not share a dir and
# interleave outputs) — exclusive mkdir, on collision suffix the pid.
if ! mkdir "$OUT" 2>/dev/null; then
  OUT="$OUT-$$"
  mkdir "$OUT"
fi
# Bind the run to the exact revision and scenario texts it diagnosed — after
# a scenario/map edit, an unbound old RED cannot be tied to the text that
# later went GREEN. Per-scenario hashes are appended as scenarios enqueue.
{
  echo "head: $(git -C "$FAMILY" rev-parse HEAD 2>/dev/null || echo no-git)"
  echo "dirty: $(git -C "$FAMILY" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  echo "map_sha256: $(shasum -a 256 "$HERE/map.tsv" | cut -d' ' -f1)"
  echo "cli: $(claude --version 2>/dev/null | head -1 || echo unknown)"
  echo "utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$OUT/MANIFEST.txt"
WORK=$(mktemp -d)  # parent; per-scenario subdirs — concurrent sessions must
                   # not share a cwd (cross-scenario contamination)
CM="$HOME/.claude/CLAUDE.md"
BK="$HOME/.claude/CLAUDE.md.pressure-baseline-backup"
LOCK="$HOME/.claude/.pressure-baseline-lock"

# Single-writer lock FIRST (the self-heal below must never run while another
# baseline is live — it would restore CLAUDE.md under that run's sessions).
# The lock is a SYMLINK whose target string is the holder's pid: creation is
# one atomic syscall (O_EXCL), so there is NO window in which a lock exists
# without its pid — the whole empty-pid/mid-acquisition class is gone by
# construction, and a moved-aside lock's content can never change under the
# taker (symlink targets are immutable). A holder pid is live only if the
# process both exists AND is a run-baseline invocation (a recycled pid
# belonging to an unrelated process must not refuse baselines forever).
# DEFENSE IN DEPTH: acquisition races can at worst rob a runner of its lock
# (spurious refusal); they can never mint two owners — because every
# DESTRUCTIVE action (the CLAUDE.md rename, the lock removal, the CLAUDE.md
# restore) re-verifies ownership AT ACTION TIME (owns_lock below), and the
# CLAUDE.md restore keys on this run having done the rename (DID_RENAME),
# never on lock state alone.
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
# True only while THIS process is the current lock holder — re-checked
# immediately before every destructive action, never assumed from an earlier
# successful acquisition (a takeover race may have moved our lock since).
owns_lock() {
  [ "$(readlink "$LOCK" 2>/dev/null)" = "$$" ]
}
acquire_lock() {
  # Fast path: atomic create-with-pid. Every ln is followed by an ownership
  # verify: `ln -s` into a path that is an existing DIRECTORY (the legacy
  # lock shape) "succeeds" by creating the link INSIDE it — success of ln
  # alone is not acquisition.
  ln -s "$$" "$LOCK" 2>/dev/null && owns_lock && return 0
  # Legacy shape: a pre-symlink DIRECTORY lock ($LOCK/pid) from an older
  # script version. Same liveness rules; a live legacy holder refuses us.
  if [ -d "$LOCK" ] && [ ! -L "$LOCK" ]; then
    local lpid
    lpid=$(cat "$LOCK/pid" 2>/dev/null || echo "")
    if [ -n "$lpid" ] && kill -0 "$lpid" 2>/dev/null && is_live_baseline "$lpid"; then
      echo "[baseline] a live baseline run (pid $lpid, legacy lock) holds $LOCK — refusing to start" >&2
      return 1
    fi
    mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null || { echo "[baseline] another starter is clearing the legacy lock — refusing (re-run)" >&2; return 1; }
    rm -rf "$LOCK.stale.$$"
    ln -s "$$" "$LOCK" 2>/dev/null && owns_lock && return 0
  fi
  local holder
  holder=$(readlink "$LOCK" 2>/dev/null || echo "")
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null && is_live_baseline "$holder"; then
    echo "[baseline] a live baseline run (pid $holder) holds $LOCK — refusing to start" >&2
    return 1
  fi
  # Takeover of a stale symlink: move it aside atomically, re-read what we
  # actually moved (its content is immutable, so this is a true re-check,
  # not a racy re-read): if the moved link names a LIVE run, a faster
  # starter replaced the stale lock between our read and our mv — put it
  # back ONLY into an empty slot (mv onto an existing dir would NEST, and
  # onto an existing link would REPLACE a third starter's live lock).
  if ! mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null; then
    echo "[baseline] another starter is taking over the stale lock — refusing to start (re-run)" >&2
    return 1
  fi
  local moved
  moved=$(readlink "$LOCK.stale.$$" 2>/dev/null || echo "")
  if [ -n "$moved" ] && [ "$moved" != "$holder" ] && kill -0 "$moved" 2>/dev/null && is_live_baseline "$moved"; then
    if [ ! -e "$LOCK" ] && [ ! -L "$LOCK" ]; then
      mv "$LOCK.stale.$$" "$LOCK" 2>/dev/null || echo "[baseline] WARNING: could not restore robbed live lock (left at $LOCK.stale.$$)" >&2
    else
      echo "[baseline] WARNING: robbed live lock left at $LOCK.stale.$$ (a newer lock already exists; the robbed run will self-refuse at its ownership re-check)" >&2
    fi
    echo "[baseline] a live baseline run (pid $moved) took over first — refusing to start" >&2
    return 1
  fi
  rm -f "$LOCK.stale.$$"
  echo "[baseline] removed stale lock (holder pid ${holder:-unknown} was not a live baseline run)" >&2
  # Re-acquire atomically; losing here means a concurrent starter won — refuse.
  ln -s "$$" "$LOCK" 2>/dev/null && owns_lock && return 0
  holder=$(readlink "$LOCK" 2>/dev/null || echo "")
  echo "[baseline] lost the acquisition race (pid ${holder:-unknown} acquired first) — refusing to start (re-run)" >&2
  return 1
}
acquire_lock || exit 1

# Self-heal a stale backup from a hard-killed previous run (safe: we hold
# the lock, so no other baseline is live).
if [ -f "$BK" ] && [ ! -f "$CM" ]; then
  mv "$BK" "$CM" && echo "[baseline] stale backup from a killed run restored" >&2
elif [ -f "$BK" ] && [ -f "$CM" ]; then
  echo "[baseline] BOTH $CM and stale backup $BK exist (CLAUDE.md was recreated after a killed run)." >&2
  echo "[baseline] Refusing to overwrite the backup — reconcile the two files manually, then re-run." >&2
  owns_lock && rm -f "$LOCK"
  exit 1
fi

DID_RENAME=0
restore() {
  # CLAUDE.md restore keys on THIS run having done the rename — never on
  # lock state (a run that never renamed must not restore someone else's).
  if [ "$DID_RENAME" = 1 ] && [ -f "$BK" ]; then
    mv "$BK" "$CM" && echo "[baseline] CLAUDE.md restored"
  fi
  # Lock removal is ownership-guarded AT ACTION TIME: an unconditional rm
  # here would delete a successor's live lock after a takeover race.
  owns_lock && rm -f "$LOCK" 2>/dev/null || true
}
trap restore EXIT INT TERM

printf '%s\n' "NOTE: baseline ran on this machine's environment. The CLAUDE.md rename does not remove process rules injected through other channels, and the recorded final message CANNOT prove the absence of reliance on such rules (a rule can shape behavior without being named). Treat every baseline as DIAGNOSTIC evidence, never as proof of clean-model defaults (forge-skill's law)." > "$OUT/NOTE-baseline-validity.txt"

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  while IFS=$'\t' read -r n _rest; do [ -n "$n" ] && names+=("$n"); done < "$HERE/map.tsv"
fi
# Duplicate map keys would double-launch one identity — refuse the map.
dup_keys=$(cut -f1 "$HERE/map.tsv" | sort | uniq -d)
if [ -n "$dup_keys" ]; then
  echo "[baseline] map.tsv has duplicate scenario keys: $dup_keys — fix the map first" >&2
  exit 1
fi
# Duplicate selectors share one cwd and one output identity — deduplicate.
deduped=()
for n in "${names[@]}"; do
  case " ${deduped[*]-} " in
    *" $n "*) echo "SKIP duplicate selector: $n" >&2 ;;
    *) deduped+=("$n") ;;
  esac
done
names=("${deduped[@]}")

# Validated pool bound and per-scenario timeout (mirrors run-green.sh —
# 0/negative/nonnumeric would wedge or unbound the pool; a hung session
# would keep CLAUDE.md renamed until manual interruption).
case "${PRESSURE_MAX_PAR:-4}" in
  ''|*[!0-9]*) echo "[baseline] invalid PRESSURE_MAX_PAR='${PRESSURE_MAX_PAR:-}' — using 4" >&2; MAX_PAR=4 ;;
  0) echo "[baseline] PRESSURE_MAX_PAR=0 would never launch — using 4" >&2; MAX_PAR=4 ;;
  *) MAX_PAR="${PRESSURE_MAX_PAR:-4}"
     if [ "$MAX_PAR" -gt 32 ]; then echo "[baseline] capping PRESSURE_MAX_PAR at 32" >&2; MAX_PAR=32; fi ;;
esac
case "${PRESSURE_SCENARIO_TIMEOUT_S:-1800}" in
  ''|0|*[!0-9]*) echo "[baseline] invalid PRESSURE_SCENARIO_TIMEOUT_S — using 1800" >&2; TIMEOUT_S=1800 ;;
  *) TIMEOUT_S="${PRESSURE_SCENARIO_TIMEOUT_S:-1800}" ;;
esac

# Ownership re-verified immediately before the destructive rename — a lock
# lost to a race since acquisition means we must refuse, not proceed.
if ! owns_lock; then
  echo "[baseline] lock no longer ours at rename time — refusing to start (re-run)" >&2
  exit 1
fi
if [ -f "$CM" ]; then
  mv "$CM" "$BK" && DID_RENAME=1 && echo "[baseline] CLAUDE.md renamed"
fi

for name in "${names[@]}"; do
  line=$(awk -F'\t' -v n="$name" '$1==n' "$HERE/map.tsv")
  [ -z "$line" ] && { echo "SKIP $name: not in map.tsv" >&2; continue; }
  [ -f "$HERE/scenarios/$name.md" ] || { echo "SKIP $name: scenario file missing" >&2; continue; }
  # argv preflight: the scenario travels as ONE exec argument.
  if [ "$(wc -c < "$HERE/scenarios/$name.md" | tr -d ' ')" -gt 400000 ]; then
    echo "SKIP $name: scenario exceeds the argv budget" >&2
    printf 'exit: oversize\n' > "$OUT/$name.status"
    continue
  fi
  model=$(printf '%s' "$line" | cut -f2)
  echo "scenario $name model $model sha256 $(shasum -a 256 "$HERE/scenarios/$name.md" | cut -d' ' -f1)" >> "$OUT/MANIFEST.txt"
  while [ "$(jobs -pr | wc -l | tr -d ' ')" -ge "$MAX_PAR" ]; do sleep 1; done
  mkdir -p "$WORK/$name"
  ( cd "$WORK/$name" || exit 1
    claude -p "$(cat "$HERE/scenarios/$name.md")" --model "$model" \
      > "$OUT/$name.txt" 2> "$OUT/$name.err" & cpid=$!
    # Watchdog: TERM at the deadline, KILL after a grace period — a hung
    # session must not keep CLAUDE.md renamed indefinitely.
    ( t=0
      while kill -0 "$cpid" 2>/dev/null && [ "$t" -lt "$TIMEOUT_S" ]; do sleep 5; t=$((t+5)); done
      if kill -0 "$cpid" 2>/dev/null; then
        echo "timeout: ${TIMEOUT_S}s" > "$OUT/$name.timeout"
        kill -TERM "$cpid" 2>/dev/null; sleep 5; kill -KILL "$cpid" 2>/dev/null
      fi ) & wpid=$!
    ec=0; wait "$cpid" || ec=$?
    kill "$wpid" 2>/dev/null || true
    # Durable per-scenario status (mirrors run-green.sh).
    { echo "exit: $ec"
      if [ -f "$OUT/$name.timeout" ]; then cat "$OUT/$name.timeout"; fi
      echo "utc_end: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$OUT/$name.status"
    echo "[baseline] $name done exit=$ec" ) &
done
wait
restore
trap - EXIT INT TERM
rm -rf "$WORK" 2>/dev/null || true
# Aggregate durable statuses into the MANIFEST (mirrors run-green.sh).
broken=0
for st in "$OUT"/*.status; do
  [ -f "$st" ] || continue
  sn=$(basename "$st" .status)
  sec=$(sed -n 's/^exit: //p' "$st" | head -1)
  flag=""; if [ -f "$OUT/$sn.timeout" ]; then flag=" timeout"; fi
  echo "result $sn exit ${sec:-unknown}$flag" >> "$OUT/MANIFEST.txt"
  [ "${sec:-broken}" = "0" ] || broken=1
done
echo "[baseline] outputs: $OUT"
if [ "$broken" -ne 0 ]; then
  echo "[baseline] one or more scenarios exited nonzero / timed out / were skipped — see the MANIFEST result lines" >&2
  exit 1
fi
