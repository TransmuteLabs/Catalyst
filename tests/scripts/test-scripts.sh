#!/usr/bin/env bash
# Fast deterministic tests for the family's shell scripts. NO live sessions,
# no network, no CLAUDE.md touching — pure input-gate behavior, <1s total.
# (The user's no-more-tests policy retired LIVE pressure runs; shell scripts
# are code and keep code's cheap tests.)
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
TB="$ROOT/skills/arcane-mode/scripts/task-brief"
GREEN="$ROOT/tests/pressure/run-green.sh"
WORK=$(mktemp -d) || exit 1
trap 'rm -rf "$WORK"' EXIT
cd "$WORK" || exit 1

pass=0; fail=0
check() { # check <name> <expected-exit> <actual-exit>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1: expected exit $2, got $3"; fi
}

# ---- task-brief ----
cat > plan.md <<'EOF'
# Plan

## Task 1: Do a thing
**Files:** `src/app.py`, `tests/test_app.py`
Steps:
1. write test
2. implement
EOF

bash "$TB" plan.md 1 out-ok.md >/dev/null 2>&1;            check "tb normal extraction" 0 $?
grep -q 'BRIEF COMPLETE' out-ok.md;                        check "tb terminal marker present" 0 $?
bash "$TB" plan.md 1 out-ok.md >/dev/null 2>&1;            check "tb exclusive publish refuses" 7 $?
bash "$TB" plan.md 9 out-nf.md >/dev/null 2>&1;            check "tb task not found" 3 $?
bash "$TB" plan.md x out-x.md  >/dev/null 2>&1;            check "tb non-numeric id" 2 $?
bash "$TB" missing.md 1 out-m.md >/dev/null 2>&1;          check "tb missing plan" 2 $?

printf '## Task 1: x\x00y\n**Files:** `a.py`\n' > plan-nul.md
bash "$TB" plan-nul.md 1 out-nul.md >/dev/null 2>&1;       check "tb NUL plan refused" 2 $?

cp plan.md 'x=plan.md'
bash "$TB" 'x=plan.md' 1 out-eq.md >/dev/null 2>&1;        check "tb =-operand plan name" 0 $?

printf '## Task 1: t\n**Files:** `/etc/hosts`\nSteps:\n1. x\n' > plan-abs.md
bash "$TB" plan-abs.md 1 out-abs.md >/dev/null 2>&1;       check "tb absolute path refused" 5 $?

printf '## Task 1: t\n**Files:** `../../evil.py`\nSteps:\n1. x\n' > plan-trav.md
bash "$TB" plan-trav.md 1 out-trav.md >/dev/null 2>&1;     check "tb traversal refused" 5 $?

printf '## Task 1: a\n**Files:** `a.py`\n\n## Task 1: b\n**Files:** `b.py`\n' > plan-dup.md
bash "$TB" plan-dup.md 1 out-dup.md >/dev/null 2>&1;       check "tb duplicate task ids" 4 $?

# ---- run-green.sh input gates (all refuse BEFORE any session launches) ----
# The runner creates its out/ dir before selector validation; snapshot the
# listing so the stub dirs these refusals leave can be removed afterwards.
OUTDIR="$ROOT/tests/pressure/out"
before=$(ls "$OUTDIR" 2>/dev/null || true)
bash "$GREEN" 'a b'        >/dev/null 2>&1;                check "green selector with space refused" 1 $?
bash "$GREEN" 'evil*'      >/dev/null 2>&1;                check "green metachar selector refused" 1 $?
bash "$GREEN" '-flag'      >/dev/null 2>&1;                check "green dash-leading selector refused" 1 $?
bash "$GREEN" 'UPPER'      >/dev/null 2>&1;                check "green uppercase selector refused" 1 $?
after=$(ls "$OUTDIR" 2>/dev/null || true)
comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | while IFS= read -r d; do
  [ -n "$d" ] && rm -rf "$OUTDIR/${d:?}"
done

# map lookup string-force (the 01 vs 1 coercion class)
printf '01\tmodelA\n1\tmodelB\n' > map-test.tsv
got=$(awk -F'\t' -v n="1" '($1 "") == (n "") { print $2; exit }' map-test.tsv)
[ "$got" = "modelB" ];                                     check "awk string-force lookup exact" 0 $?

echo "test-scripts: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
