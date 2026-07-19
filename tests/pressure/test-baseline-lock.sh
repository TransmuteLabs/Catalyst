#!/usr/bin/env bash
# Script-level tests for the pressure runners. Covers, by name:
#   (a) run-baseline.sh's is_live_baseline() classifier — the lock's
#       stale-vs-live decision (a LIVE-as-stale misclassification re-creates
#       the CLAUDE.md-restore contamination the rounds 29-33 fixes closed,
#       incl. the space-in-path defect);
#   (b) the atomic symlink acquisition (acquire_lock/owns_lock) — free path,
#       live-holder refusal, stale takeover, legacy-dir conversion;
#   (c) bash -n syntax on BOTH runners (run-baseline's remaining lifecycle —
#       traps, CLAUDE.md rename/restore, scenario loop — cannot be smoked
#       without running a baseline, so syntax is its strongest safe whole-file
#       check; run-green's lifecycle has its own one-scenario smoke, named in
#       forge-skill).
# Anything outside (a)-(c) is NOT covered here.
#
# This is a SCRIPT-level test: the pressure harness (map.tsv scenarios) cannot
# exercise shell behavior, so this file is the compensating gate for
# runner edits — run it after touching run-baseline.sh or run-green.sh.
#
# Extracts function/guard blocks from run-baseline.sh (never sources the whole
# script — that would RUN a baseline) and asserts behavior on real processes.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/run-baseline.sh"
TMP=$(mktemp -d)
trap 'kill $(jobs -p) 2>/dev/null; rm -rf "$TMP"' EXIT

sed -n '/^is_live_baseline()/,/^}/p' "$SRC" > "$TMP/fn.sh"
[ -s "$TMP/fn.sh" ] || { echo "FAIL: could not extract is_live_baseline from $SRC"; exit 1; }
# shellcheck disable=SC1091
. "$TMP/fn.sh"

fails=0
check() { # $1=expect(0|1) $2=pid $3=label
  is_live_baseline "$2"; got=$?
  if [ "$got" -eq "$1" ]; then echo "ok: $3"
  else echo "FAIL: $3 (expected $1, got $got)"; fails=$((fails+1)); fi
}

# 1. A shell running a script named run-baseline.sh at a PLAIN path → live.
mkdir -p "$TMP/plain"; printf 'sleep 30\n' > "$TMP/plain/run-baseline.sh"
bash "$TMP/plain/run-baseline.sh" & p1=$!
sleep 0.3; check 0 "$p1" "shell + plain path classified LIVE"
kill "$p1" 2>/dev/null

# 2. A shell running it from a path WITH SPACES → live (the fixed defect).
mkdir -p "$TMP/with space"; printf 'sleep 30\n' > "$TMP/with space/run-baseline.sh"
bash "$TMP/with space/run-baseline.sh" & p2=$!
sleep 0.3; check 0 "$p2" "shell + space-containing path classified LIVE"
kill "$p2" 2>/dev/null

# 3. An unrelated shell process → stale (takeover allowed).
bash -c 'sleep 30' & p3=$!
sleep 0.3; check 1 "$p3" "unrelated shell classified STALE"
kill "$p3" 2>/dev/null

# 4. A non-shell process merely MENTIONING the script name in args → stale
#    (recycled-pid editor/pager must not refuse baselines forever).
tail -f "$TMP/plain/run-baseline.sh" >/dev/null 2>&1 & p4=$!
sleep 0.3; check 1 "$p4" "non-shell argv0 mentioning script classified STALE"
kill "$p4" 2>/dev/null

# 5. A dead pid → stale.
bash -c 'exit 0' & p5=$!; wait "$p5" 2>/dev/null
check 1 "$p5" "dead pid classified STALE"

# 6-9. Atomic symlink acquisition (acquire_lock/owns_lock): extract the
# functions and exercise them against sandbox lock paths.
{ sed -n '/^owns_lock()/,/^}/p' "$SRC"; sed -n '/^acquire_lock()/,/^}/p' "$SRC"; } >> "$TMP/fn.sh"
grep -q 'acquire_lock()' "$TMP/fn.sh" || { echo "FAIL: could not extract acquire_lock from $SRC"; fails=$((fails+1)); }

# 6. Free path: atomic create claims, ownership verifies.
if LOCK="$TMP/l-free" bash -c ". '$TMP/fn.sh'; acquire_lock 2>/dev/null && owns_lock && echo claimed" | grep -q claimed; then
  echo "ok: free path claimed atomically and owned"
else echo "FAIL: free acquisition"; fails=$((fails+1)); fi

# 7. Held by a LIVE baseline-shaped process → refuse.
bash "$TMP/plain/run-baseline.sh" & p7=$!
sleep 0.3
ln -s "$p7" "$TMP/l-live"
if LOCK="$TMP/l-live" bash -c ". '$TMP/fn.sh'; acquire_lock 2>/dev/null && echo claimed" | grep -q claimed; then
  echo "FAIL: acquired over a live baseline holder"; fails=$((fails+1))
else echo "ok: live holder refused takeover"; fi
kill "$p7" 2>/dev/null

# 8. Stale symlink holder (dead pid) → takeover succeeds and re-owns.
ln -s "$p5" "$TMP/l-stale"
if LOCK="$TMP/l-stale" bash -c ". '$TMP/fn.sh'; acquire_lock 2>/dev/null && owns_lock && echo claimed" | grep -q claimed; then
  echo "ok: stale symlink holder taken over"
else echo "FAIL: stale takeover"; fails=$((fails+1)); fi

# 9. Legacy DIRECTORY lock with a dead pid → converted and claimed.
mkdir -p "$TMP/l-legacy"; echo "$p5" > "$TMP/l-legacy/pid"
if LOCK="$TMP/l-legacy" bash -c ". '$TMP/fn.sh'; acquire_lock 2>/dev/null && owns_lock && echo claimed" | grep -q claimed; then
  echo "ok: legacy dir lock converted and claimed"
else echo "FAIL: legacy conversion"; fails=$((fails+1)); fi

# 10. Syntax gate on both runners.
if bash -n "$SRC" && bash -n "$HERE/run-green.sh"; then echo "ok: bash -n both runners"
else echo "FAIL: bash -n"; fails=$((fails+1)); fi

if [ "$fails" -eq 0 ]; then echo "PASS: runner script gates (10/10)"; exit 0
else echo "FAIL: $fails assertion(s)"; exit 1; fi
