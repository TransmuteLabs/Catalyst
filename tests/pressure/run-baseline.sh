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
# Resolve the sha256 tool up front: `echo "$(shasum …)"` swallows the inner
# failure even under pipefail, and a MANIFEST with empty hashes silently
# loses the binding it exists for — refuse instead.
if command -v shasum >/dev/null 2>&1; then sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
elif command -v sha256sum >/dev/null 2>&1; then sha256() { sha256sum "$1" | cut -d' ' -f1; }
else echo "[baseline] no sha256 tool (shasum/sha256sum) — MANIFEST binding impossible, refusing" >&2; exit 1; fi
OUT="$HERE/out/baseline-$(date -u +%Y%m%d-%H%M%S)Z"
# Identity must be unique (same-second runs must not share a dir and
# interleave outputs) — exclusive mkdir, on collision suffix the pid.
# A fresh clone has NO out/ (fully gitignored): the exclusive mkdir would
# fail with raw ENOENT and the pid-suffix retry is meaningless there.
mkdir -p "$HERE/out"
if ! mkdir "$OUT" 2>/dev/null; then
  OUT="$OUT-$$"
  # No set -e in this runner: an unchecked failure here (unwritable out/,
  # ENOSPC) would still rename CLAUDE.md, launch every scenario with failing
  # redirects, and exit 0 over a totally failed destructive run.
  if ! mkdir "$OUT"; then
    echo "[baseline] cannot create output dir '$OUT' — refusing" >&2
    exit 1
  fi
fi
# Bind the run to the exact revision and scenario texts it diagnosed — after
# a scenario/map edit, an unbound old RED cannot be tied to the text that
# later went GREEN. Per-scenario hashes are appended as scenarios enqueue.
{
  echo "head: $(git -C "$FAMILY" rev-parse HEAD 2>/dev/null || echo no-git)"
  echo "dirty: $(git -C "$FAMILY" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  echo "map_sha256: $(sha256 "$HERE/map.tsv")"
  echo "cli: $(claude --version 2>/dev/null | head -1 || echo unknown)"
  echo "utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$OUT/MANIFEST.txt"
# mktemp failure (full/unwritable TMPDIR) must refuse, not degrade into
# paths rooted at "/": this file runs WITHOUT set -e, so the failed
# substitution alone does not stop it, and an empty WORK turns
# "$WORK/$name" into /<name>.
WORK=$(mktemp -d) && [ -n "$WORK" ] || { echo "[baseline] mktemp -d failed — refusing" >&2; exit 1; }
                   # parent; per-scenario subdirs — concurrent sessions must
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
# DEFENSE IN DEPTH — honest residual: every DESTRUCTIVE action (the
# CLAUDE.md rename, the lock removal, the CLAUDE.md restore) re-verifies
# ownership AT ACTION TIME (owns_lock below), the launch loop re-verifies
# before EVERY scenario start, and the CLAUDE.md restore additionally
# requires no live successor. This bounds — but does not erase — the
# multi-actor takeover residual: a holder robbed AFTER a launch-loop check
# finishes its already-running sessions without the lock (their environment
# stays valid: CLAUDE.md remains renamed), and its restore defers to the
# successor. Two baselines can briefly OVERLAP in that window; what the
# layering guarantees is narrower and stated exactly: CLAUDE.md is never
# RESTORED under a live successor's sessions, and no NEW scenario launches
# after ownership is lost.
is_live_baseline() {
  # True only when the pid's argv0 is this script (or a shell running it) —
  # a recycled pid in an editor/pager whose args mention the script must not
  # refuse baselines forever.
  local cmd argv0
  # A nonexistent pid is STALE; but for a pid that EXISTS, a ps FAILURE
  # (sandbox/hardening denying ps, truncated argv table) is indeterminate,
  # not evidence of death: treat as LIVE (conservative refusal), never as
  # stale — a takeover on "couldn't check" robs a live holder.
  kill -0 "$1" 2>/dev/null || return 1
  cmd=$(ps -p "$1" -o command= 2>/dev/null) || return 0
  argv0=${cmd%% *}; argv0=${argv0##*/}
  # Match the WHOLE command string for shell holders, not whitespace field 2:
  # install paths with spaces (or a shell flag before the script) put the
  # script path outside $2 and a LIVE run would read as stale (silent RED
  # contamination via takeover). *run-baseline.sh* on the full string is
  # space-safe; the argv0 gate above it keeps editors/pagers mentioning the
  # script from matching.
  case "$argv0" in
    run-baseline.sh) return 0 ;;
    # Substring match on the full command is DELIBERATELY conservative: a
    # recycled pid landing on an unrelated shell whose argv merely mentions
    # the script reads LIVE and refuses this run (fail-closed, rare, clears
    # when that process exits) — the alternative misreads a legitimately
    # wrapped runner as stale and robs it.
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
    # Re-verify WHAT we actually moved (the same ABA discipline as the
    # symlink takeover below): between our -d test and our mv, a faster
    # starter may have cleared the directory and minted a fresh LIVE
    # symlink lock — blindly rm -rf'ing the moved thing would destroy it.
    if [ -L "$LOCK.stale.$$" ]; then
      local lmoved
      lmoved=$(readlink "$LOCK.stale.$$" 2>/dev/null || echo "")
      if [ -n "$lmoved" ] && kill -0 "$lmoved" 2>/dev/null && is_live_baseline "$lmoved"; then
        if [ ! -e "$LOCK" ] && [ ! -L "$LOCK" ]; then
          mv "$LOCK.stale.$$" "$LOCK" 2>/dev/null || echo "[baseline] WARNING: could not restore robbed live lock (left at $LOCK.stale.$$)" >&2
        else
          echo "[baseline] WARNING: robbed live lock left at $LOCK.stale.$$ (a newer lock already exists)" >&2
        fi
        echo "[baseline] a live baseline run (pid $lmoved) converted the legacy lock first — refusing to start" >&2
        return 1
      fi
    fi
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
      echo "[baseline] WARNING: robbed live lock left at $LOCK.stale.$$ (a newer lock already exists; the robbed run stops launching NEW scenarios at its next loop check — sessions already running finish without the lock)" >&2
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
  # A failed self-heal must refuse: continuing would run "one more" baseline
  # over a machine whose CLAUDE.md silently stays renamed after we exit.
  if ! mv "$BK" "$CM"; then
    echo "[baseline] ERROR: stale backup exists but restore failed (mv '$BK' '$CM') — fix manually, then re-run" >&2
    owns_lock && rm -f "$LOCK"
    exit 1
  fi
  echo "[baseline] stale backup from a killed run restored" >&2
elif [ -f "$BK" ] && [ -f "$CM" ]; then
  echo "[baseline] BOTH $CM and stale backup $BK exist (CLAUDE.md was recreated after a killed run)." >&2
  echo "[baseline] Refusing to overwrite the backup — reconcile the two files manually, then re-run." >&2
  owns_lock && rm -f "$LOCK"
  exit 1
fi

DID_RENAME=0
restore() {
  # CLAUDE.md restore keys on THIS run having done the rename — never on
  # lock state alone (a run that never renamed must not restore someone
  # else's). ADDITIONALLY it defers to a live successor: after a takeover
  # race the lock may name another live baseline whose sessions run with
  # CLAUDE.md renamed — restoring under them is the contamination the lock
  # exists to prevent. Deferred restore is not lost: the successor's exit
  # leaves BK in place and the NEXT acquisition's self-heal restores it.
  if [ "$DID_RENAME" = 1 ] && [ -f "$BK" ]; then
    local cur
    cur=$(readlink "$LOCK" 2>/dev/null || echo "")
    if [ -n "$cur" ] && [ "$cur" != "$$" ] && kill -0 "$cur" 2>/dev/null && is_live_baseline "$cur"; then
      echo "[baseline] WARNING: a live successor (pid $cur) holds the lock — leaving CLAUDE.md renamed for its run; the next acquisition self-heals the backup" >&2
    else
      if mv "$BK" "$CM"; then
        echo "[baseline] CLAUDE.md restored"
      else
        echo "[baseline] ERROR: CLAUDE.md restore FAILED — every fresh session on this machine now runs without global instructions. Restore manually: mv '$BK' '$CM'" >&2
      fi
    fi
  fi
  # Lock removal is ownership-guarded AT ACTION TIME: an unconditional rm
  # here would delete a successor's live lock after a takeover race.
  owns_lock && rm -f "$LOCK" 2>/dev/null || true
}
# INT/TERM must TERMINATE the run, not just restore: a bare handler returns
# control to the interrupted script, which would keep launching baseline
# sessions AGAINST the restored CLAUDE.md with the lock already released
# (demonstrated on bash 3.2 and 5.x). `jobs -pr` names the WRAPPER subshells
# only — the sessions live in their OWN process groups, so a bare TERM here
# never reaches them; each wrapper's own TERM trap kills its session group
# + watchdog and records a durable signal status, which is what makes this
# cascade actually stop the sessions before the EXIT trap's single restore.
on_signal() {
  echo "[baseline] caught SIG$1 — stopping scenario sessions, restoring, exiting" >&2
  local jl
  jl=$(jobs -pr 2>/dev/null || true)
  if [ -n "$jl" ]; then
    kill -TERM $jl 2>/dev/null || true
    # 4s, not 2: each wrapper's trap TERMs its session group, waits 1s, then
    # KILLs it (the escalation is IN the wrapper — killing the wrapper early
    # would strip the KILL step and a TERM-ignoring group member would
    # outlive everything, run-baseline's restore included).
    sleep 4
    kill -KILL $jl 2>/dev/null || true
  fi
  rm -rf "$WORK" 2>/dev/null || true
  exit "$2"
}
trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM
trap restore EXIT

printf '%s\n' "NOTE: baseline ran on this machine's environment. The CLAUDE.md rename does not remove process rules injected through other channels, and the recorded final message CANNOT prove the absence of reliance on such rules (a rule can shape behavior without being named). Treat every baseline as DIAGNOSTIC evidence, never as proof of clean-model defaults (forge-skill's law)." > "$OUT/NOTE-baseline-validity.txt"

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  # `|| [ -n "$n" ]` keeps the LAST row of a map without a trailing newline.
  while IFS=$'\t' read -r n _rest || [ -n "$n" ]; do [ -n "$n" ] && names+=("$n"); done < "$HERE/map.tsv"
fi
# Duplicate map keys would double-launch one identity — refuse the map.
dup_keys=$(cut -f1 "$HERE/map.tsv" | sort | uniq -d)
if [ -n "$dup_keys" ]; then
  echo "[baseline] map.tsv has duplicate scenario keys: $dup_keys — fix the map first" >&2
  exit 1
fi
# Grammar validation runs BEFORE deduplication (mirrors run-green.sh): the
# dedup membership test flattens the set on spaces, so a hostile selector
# `a b` looked identical to members `a`,`b` and was silently SKIPPED as a
# duplicate instead of refused -- validation-first makes the flattening safe.
for n in "${names[@]}"; do
  case "$n" in
    *[!a-z0-9-]*|-*) echo "[baseline] scenario key '$n' outside the portable grammar [a-z0-9-] (must not start with '-') -- refusing" >&2; exit 1 ;;
  esac
done
# Duplicate selectors share one cwd and one output identity — deduplicate.
deduped=()
for n in "${names[@]}"; do
  case " ${deduped[*]-} " in
    *" $n "*) echo "SKIP duplicate selector: $n" >&2 ;;
    *) deduped+=("$n") ;;
  esac
done
# Guard the empty set BEFORE expanding it (bash 3.2 + set -u aborts on an
# empty-array expansion with an opaque "unbound variable").
[ -n "${deduped[*]-}" ] || { echo "[baseline] no scenarios selected (empty map.tsv?) — refusing" >&2; exit 1; }
names=("${deduped[@]}")
# NUL bytes in map.tsv truncate awk/command-substitution output mid-field:
# the MANIFEST would then certify bytes the sessions never consumed. Refuse.
if ! LC_ALL=C tr -d '\000' < "$HERE/map.tsv" | cmp -s - "$HERE/map.tsv"; then
  echo "[baseline] map.tsv contains NUL bytes -- not a text map; refusing" >&2
  exit 1
fi

# Validated pool bound and per-scenario timeout (mirrors run-green.sh —
# 0/negative/nonnumeric would wedge or unbound the pool; a hung session
# would keep CLAUDE.md renamed until manual interruption).
# Leading zeros rejected ("00" passes a digits check but is arithmetically 0
# — the pool guard would wedge); a length gate precedes numeric compares so
# a long digit string can never overflow `[ -gt ]` (its error inside a
# condition is swallowed and reads as false — unbounding the pool).
case "${PRESSURE_MAX_PAR:-4}" in
  ''|*[!0-9]*|0|0?*) echo "[baseline] invalid PRESSURE_MAX_PAR='${PRESSURE_MAX_PAR:-}' — using 4" >&2; MAX_PAR=4 ;;
  *) MAX_PAR="${PRESSURE_MAX_PAR:-4}"
     if [ "${#MAX_PAR}" -gt 2 ] || [ "$MAX_PAR" -gt 32 ]; then echo "[baseline] capping PRESSURE_MAX_PAR at 32" >&2; MAX_PAR=32; fi ;;
esac
case "${PRESSURE_SCENARIO_TIMEOUT_S:-1800}" in
  ''|0|0?*|*[!0-9]*) echo "[baseline] invalid PRESSURE_SCENARIO_TIMEOUT_S — using 1800" >&2; TIMEOUT_S=1800 ;;
  *) TIMEOUT_S="${PRESSURE_SCENARIO_TIMEOUT_S:-1800}"
     if [ "${#TIMEOUT_S}" -gt 5 ]; then echo "[baseline] PRESSURE_SCENARIO_TIMEOUT_S too large — using 1800" >&2; TIMEOUT_S=1800; fi ;;
esac

# Ownership re-verified immediately before the destructive rename — a lock
# lost to a race since acquisition means we must refuse, not proceed.
if ! owns_lock; then
  echo "[baseline] lock no longer ours at rename time — refusing to start (re-run)" >&2
  exit 1
fi
if [ -f "$CM" ]; then
  # A failed rename must refuse the whole run: falling through would launch
  # every "baseline" session against the LIVE CLAUDE.md — a contaminated RED
  # presented as clean. The EXIT trap releases the lock (DID_RENAME stays 0).
  if ! mv "$CM" "$BK"; then
    echo "[baseline] ERROR: could not rename CLAUDE.md aside — refusing (a RED against the live CLAUDE.md is contaminated)" >&2
    exit 1
  fi
  DID_RENAME=1
  echo "[baseline] CLAUDE.md renamed"
fi

for name in "${names[@]}"; do
  # Ownership re-check before EVERY launch — losing the lock mid-run (a
  # takeover race) must stop NEW scenario starts: a successor may already be
  # running, and launching more sessions widens the overlap window the
  # defense-in-depth note above bounds.
  if ! owns_lock; then
    echo "[baseline] lock lost mid-run — no further scenarios will launch (running ones finish; restore defers to the successor)" >&2
    printf 'exit: skip-lostlock\nutc_end: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT/$name.status"
    continue
  fi
  # String-force + first-row-only (mirrors run-green.sh): POSIX numeric
  # coercion matched key `01` against selector `1`, and a multi-row result
  # would corrupt the cut parsing below.
  line=$(awk -F'\t' -v n="$name" '($1 "") == (n "") { print; exit }' "$HERE/map.tsv")
  # Skips are RECORDED failures, not silent continues (a typo'd selector or
  # a drifted map row previously exited 0 with no durable trace).
  if [ -z "$line" ]; then
    echo "SKIP $name: not in map.tsv" >&2
    printf 'exit: skip-notmap\nutc_end: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT/$name.status"
    continue
  fi
  if [ ! -f "$HERE/scenarios/$name.md" ]; then
    echo "SKIP $name: scenario file missing" >&2
    printf 'exit: skip-nofile\nutc_end: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT/$name.status"
    continue
  fi
  # A NUL in the scenario would be HASHED into the manifest yet truncate the
  # stdin the session reads through text tooling -- the manifest would
  # certify bytes the session never saw. Unbindable input, recorded skip.
  if ! LC_ALL=C tr -d '\000' < "$HERE/scenarios/$name.md" | cmp -s - "$HERE/scenarios/$name.md"; then
    echo "SKIP $name: scenario file contains NUL bytes (unbindable input)" >&2
    printf 'exit: skip-badref\nutc_end: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT/$name.status"
    continue
  fi
  model=$(printf '%s' "$line" | cut -f2)
  echo "scenario $name model $model sha256 $(sha256 "$HERE/scenarios/$name.md")" >> "$OUT/MANIFEST.txt"
  while [ "$(jobs -pr | wc -l | tr -d ' ')" -ge "$MAX_PAR" ]; do sleep 1; done
  mkdir -p "$WORK/$name"
  ( cd "$WORK/$name" || exit 1
    # Scenario over STDIN (argv limits are per-platform and the class is
    # gone entirely on stdin); `set -m` puts the session in its OWN process
    # group so the watchdog kills the GROUP (honest residual: a descendant
    # that calls setsid/setpgid escapes a group kill — stated, not solved);
    # a single-pid kill leaves
    # helper/tool children alive, still writing into the outputs after the
    # run is scored.
    set -m
    CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p --model "$model" < "$HERE/scenarios/$name.md" \
      > "$OUT/$name.txt" 2> "$OUT/$name.err" & cpid=$!
    set +m
    # Watchdog: TERM at the deadline, KILL after a grace period — a hung
    # session must not keep CLAUDE.md renamed indefinitely (process group,
    # not single pid).
    ( t=0
      while kill -0 "$cpid" 2>/dev/null && [ "$t" -lt "$TIMEOUT_S" ]; do sleep 5; t=$((t+5)); done
      if kill -0 "$cpid" 2>/dev/null; then
        echo "timeout: ${TIMEOUT_S}s" > "$OUT/$name.timeout"
        kill -TERM -- "-$cpid" 2>/dev/null; sleep 5; kill -KILL -- "-$cpid" 2>/dev/null
      fi ) & wpid=$!
    # A signal to this wrapper must stop the SESSION (own process group —
    # a plain wrapper death orphans it, and here an orphan outlives the
    # CLAUDE.md restore: the exact contamination the lock exists to prevent).
    # Kill the session group + watchdog, record a durable signal status.
    # (Tiny residual: a signal landing before this trap is installed still
    # orphans — aggregation-by-name reports the missing status as broken.)
    trap 'kill -TERM -- "-$cpid" 2>/dev/null; sleep 1
          kill -KILL -- "-$cpid" 2>/dev/null; kill "$wpid" 2>/dev/null
          { echo "exit: 143"; echo "signal: terminated"
            echo "utc_end: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
          } > "$OUT/$name.status.tmp.$$" && mv "$OUT/$name.status.tmp.$$" "$OUT/$name.status"
          exit 143' TERM INT
    ec=0; wait "$cpid" || ec=$?
    trap - TERM INT
    kill "$wpid" 2>/dev/null || true
    # Durable per-scenario status (mirrors run-green.sh).
    { echo "exit: $ec"
      if [ -f "$OUT/$name.timeout" ]; then cat "$OUT/$name.timeout"; fi
      echo "utc_end: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$OUT/$name.status.tmp.$$" && mv "$OUT/$name.status.tmp.$$" "$OUT/$name.status"
    echo "[baseline] $name done exit=$ec" ) &
done
wait
restore
trap - EXIT INT TERM
rm -rf "$WORK" 2>/dev/null || true
# Aggregate durable statuses into the MANIFEST (mirrors run-green.sh):
# iterate the SELECTED names — a scenario whose wrapper died before writing
# its status must surface as broken, never vanish from the results.
broken=0
for sn in "${names[@]}"; do
  st="$OUT/$sn.status"
  if [ ! -f "$st" ]; then
    echo "result $sn exit missing" >> "$OUT/MANIFEST.txt"
    broken=1
    continue
  fi
  # A status without its utc_end tail is TORN (killed/ENOSPC mid-write —
  # writes are atomic now, but legacy/foreign dirs may carry torn files):
  # grammar-complete or broken, never "exit: 0 is enough".
  if ! grep -q '^utc_end: ' "$st"; then
    echo "result $sn exit torn" >> "$OUT/MANIFEST.txt"
    broken=1
    continue
  fi
  sec=$(sed -n 's/^exit: //p' "$st" | head -1)
  # No `exit:` line at all is the same torn class: the atomic writer always
  # emits it — its absence marks a foreign/torn artifact, and an out-of-
  # grammar `unknown` word previously leaked into the MANIFEST here.
  if [ -z "$sec" ]; then
    echo "result $sn exit torn" >> "$OUT/MANIFEST.txt"
    broken=1
    continue
  fi
  flag=""; if [ -f "$OUT/$sn.timeout" ]; then flag=" timeout"; fi
  echo "result $sn exit ${sec}${flag}" >> "$OUT/MANIFEST.txt"
  # A timed-out scenario is broken even when the terminated process exited 0
  # (TERM handled as graceful cancellation) — the deadline fired.
  if [ "${sec:-broken}" != "0" ] || [ -n "$flag" ]; then broken=1; fi
done
echo "[baseline] outputs: $OUT"
if [ "$broken" -ne 0 ]; then
  echo "[baseline] one or more scenarios exited nonzero / timed out / were skipped — see the MANIFEST result lines" >&2
  exit 1
fi
