#!/usr/bin/env bash
# Script-level tests for the pressure runners. Covers, by name:
#   (a) run-baseline.sh's is_live_baseline() classifier — the lock's
#       stale-vs-live decision (a LIVE-as-stale misclassification re-creates
#       the CLAUDE.md-restore contamination the rounds 29-33 fixes closed,
#       incl. the space-in-path defect);
#   (b) the verified-exclusive pid-write guard — the single-winner property
#       of every lock-takeover interleaving;
#   (c) bash -n syntax on BOTH runners (the rest of their lifecycle — traps,
#       rename/restore, scenario loop — cannot be smoked without running a
#       baseline; syntax is the strongest safe whole-file check).
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

# 6-7. Verified-exclusive pid-write guard: extract the guard block and run it
# in a sandbox lock dir. A pre-claimed pid file must refuse (exit 1); a free
# one must claim and pass through.
sed -n '/^# VERIFIED exclusive pid write/,/^fi$/p' "$SRC" > "$TMP/guard.sh"
grep -q 'noclobber' "$TMP/guard.sh" || { echo "FAIL: could not extract pid-write guard from $SRC"; fails=$((fails+1)); }
mkdir -p "$TMP/lock-taken"; echo 99999 > "$TMP/lock-taken/pid"
if LOCK="$TMP/lock-taken" bash -c ". '$TMP/guard.sh' && echo claimed" >/dev/null 2>&1; then
  echo "FAIL: guard claimed a pid file another writer already owns"; fails=$((fails+1))
else echo "ok: pre-claimed pid file refused"; fi
mkdir -p "$TMP/lock-free"
if LOCK="$TMP/lock-free" bash -c ". '$TMP/guard.sh' && echo claimed" 2>/dev/null | grep -q claimed; then
  echo "ok: free pid file claimed and verified"
else echo "FAIL: guard refused a free lock dir"; fails=$((fails+1)); fi

# 8. Syntax gate on both runners.
if bash -n "$SRC" && bash -n "$HERE/run-green.sh"; then echo "ok: bash -n both runners"
else echo "FAIL: bash -n"; fails=$((fails+1)); fi

if [ "$fails" -eq 0 ]; then echo "PASS: runner script gates (8/8)"; exit 0
else echo "FAIL: $fails assertion(s)"; exit 1; fi
