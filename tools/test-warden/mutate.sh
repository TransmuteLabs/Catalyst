#!/usr/bin/env bash
# Mutation runner for test-warden (bash 3.2 compatible).
#
# 1. Runs the teeth on the unmutated warden; they must be green (else exit 2,
#    a red on a mutant would prove nothing).
# 2. For every row of mutations.tsv (id, tooth, find, replace; literal strings,
#    `find` must occur exactly once) builds a mutant copy of test-warden.py and
#    runs the teeth against it via TW_WARDEN_PY. The mutant is RED only if the
#    teeth exit non-zero AND the row's own tooth printed a FAIL line.
# Runs are strictly sequential: one warden and at most two small loads at a time.
# Exit 0 only if every mutant is RED.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
PY=$(command -v python3)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/tw-mutate.XXXXXX") || { echo "FATAL mktemp"; exit 2; }
trap 'rm -rf "$TMP"' EXIT

bash "$HERE/test-warden-teeth.sh" >"$TMP/baseline.out" 2>&1
rc=$?
echo "baseline teeth EXIT=$rc"
if [ $rc -ne 0 ]; then sed 's/^/  | /' "$TMP/baseline.out"; exit 2; fi

TOTAL=0; RED=0; SURVIVED=0; BROKEN=0
while IFS= read -r row; do
    case "$row" in ''|'#'*) continue ;; esac
    id=$(printf '%s' "$row" | cut -f1)
    tooth=$(printf '%s' "$row" | cut -f2)
    mutant="$TMP/test-warden.$id.py"
    TOTAL=$((TOTAL+1))
    if ! printf '%s' "$row" | "$PY" -c '
import sys
row = sys.stdin.read().split("\t", 3)
find, repl = row[2], row[3]
src = open(sys.argv[1]).read()
n = src.count(find)
if n != 1:
    print("find occurs %d times: %r" % (n, find)); sys.exit(1)
open(sys.argv[2], "w").write(src.replace(find, repl))
' "$HERE/test-warden.py" "$mutant"; then
        echo "BROKEN $id: mutation not applicable"; BROKEN=$((BROKEN+1)); continue
    fi
    TW_WARDEN_PY="$mutant" bash "$HERE/test-warden-teeth.sh" >"$TMP/$id.out" 2>&1
    mrc=$?
    fails=$(grep '^FAIL ' "$TMP/$id.out" | cut -d' ' -f2 | sort -u | tr '\n' ' ')
    if [ $mrc -ne 0 ] && grep -q "^FAIL $tooth " "$TMP/$id.out"; then
        echo "RED $id: teeth EXIT=$mrc, own tooth $tooth FAIL; failing teeth: $fails"
        grep "^FAIL $tooth " "$TMP/$id.out" | sed 's/^/  | /'
        RED=$((RED+1))
    else
        echo "SURVIVED $id: teeth EXIT=$mrc, own tooth $tooth not red; failing teeth: $fails"
        sed 's/^/  | /' "$TMP/$id.out"
        SURVIVED=$((SURVIVED+1))
    fi
done <"$HERE/mutations.tsv"

echo "MUTATIONS total=$TOTAL red=$RED survived=$SURVIVED broken=$BROKEN"
[ $TOTAL -gt 0 ] && [ $RED -eq $TOTAL ] && exit 0
exit 1
