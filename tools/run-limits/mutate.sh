#!/usr/bin/env bash
# RUNLIMITS-PROLOGUE v1 profile=runner
_rl=${RUNLIMITS_HOME:-}; _rls=$_rl; _rld=
if [ -z "$_rl" ]; then _rld=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P); fi
while [ -n "$_rld" ] && [ -z "$_rl" ]; do
    for _rlc in "$_rld/tools/run-limits" "$_rld/Catalyst/tools/run-limits"; do _rls="$_rls $_rlc"
        if [ -z "$_rl" ] && [ -f "$_rlc/runlimits.py" ]; then _rl=$_rlc; fi; done
    _rlp=$(dirname "$_rld"); if [ "$_rlp" = "$_rld" ]; then break; fi; _rld=$_rlp; done
if [ -z "$_rl" ] || [ ! -f "$_rl/runlimits.py" ]; then
    echo "RUNLIMITS: $0 refused: library not found (searched: ${_rls# })" >&2; exit 89; fi
source "$_rl/runlimits.sh"; runlimits_enter runner "$@"
# ---------------------------------------------------------------------------
# Mutation runner for run-limits (bash 3.2 compatible).
#
# Usage: mutate.sh --scope <id>[,<id>...] | --list
# Nothing runs without --scope; there is no "all" word: a full run names every
# id (`--list` prints id, tooth, platform). An unknown id runs nothing either.
#
# 1. Before each row's mutant, runs that row's own teeth (`--scope` = its tooth
#    column) on the unmutated library; red there makes the row BROKEN naming the
#    red teeth - a red on the mutant would prove nothing. By row, not one run of
#    all rows' teeth: a tooth green only next to another one is caught here.
# 2. For every named row of mutations.tsv (id, tooth, platform, file, find,
#    replace; literal strings, `find` must occur exactly once in `file`) copies
#    the library files into a private dir, applies the one edit and runs the
#    row's own teeth against the copy via RL_UNDER_TEST (the runners' copies via
#    RL_TEETH_UNDER_TEST / RL_MUTATE_UNDER_TEST for T29 / T30). The tooth column is
#    one name or a comma list; `--scope` of the run is that list. The mutant is RED
#    only if the teeth exit non-zero AND at least one named tooth printed a FAIL
#    line on the teeth's stdout (stderr is kept apart and never judged); the RED
#    line names which. A FAIL line naming `instrument:` or `sublog:` in either
#    stream makes the row BROKEN (the run proved nothing), not RED. A mutant that
#    does not compile (.py: py_compile; .sh: bash -n, judged by rc AND stderr - the
#    mac's bash -n gives rc 0 on an unclosed quote) is BROKEN, not RED.
#    Rows of another platform (`linux` / `darwin`), and rows whose teeth are all
#    the other platform's only (the teeth runner's --list), are printed as SKIP
#    and are not counted.
# Runs are strictly sequential: one teeth run (at most two small loads) at a time.
# Exit 0 only if every counted mutant is RED.
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PY=$(command -v python3)
TSV="$HERE/mutations.tsv"
KNOWN=$(grep -v -e '^#' -e '^$' "$TSV" | cut -f1 | tr '\n' ' ')
nothing_run() {
    echo "nothing run: scope required (--scope <name>[,<name>...]); known: $(echo $KNOWN | tr ' ' ',')" >&2
    exit 2
}
SCOPE=""; LIST=0
while [ $# -gt 0 ]; do
    case "$1" in
        --scope) [ $# -ge 2 ] || nothing_run; SCOPE="$SCOPE${SCOPE:+,}$2"; shift 2 ;;
        --scope=*) SCOPE="$SCOPE${SCOPE:+,}${1#--scope=}"; shift ;;
        --list) LIST=1; shift ;;
        *) nothing_run ;;
    esac
done
if [ $LIST = 1 ]; then grep -v -e '^#' -e '^$' "$TSV" | cut -f1-3; exit 0; fi
WANT=" "
set -f
for m in $(echo "$SCOPE" | tr ',' ' '); do
    case " $KNOWN " in *" $m "*) ;; *) nothing_run ;; esac
    case "$WANT" in *" $m "*) ;; *) WANT="$WANT$m " ;; esac
done
set +f
[ "$WANT" != " " ] || nothing_run
SCOPE_STR=$(echo $WANT | tr ' ' ',')

case "$(uname -s)" in Darwin) PLAT=darwin ;; Linux) PLAT=linux ;; *) echo "FATAL platform"; exit 2 ;; esac
# the supervisor's full stop: GRACE_S (escalation) + GRACE_S (sweep of survivors) +
# UNIT_SETTLE_S (scope state), +5 s margin; a stop cut shorter leaves its shim dir and unit
STOP_S=$("$PY" -B -c 'import sys; sys.path.insert(0, sys.argv[1]); import runlimits as r; print(int(2 * r.GRACE_S + r.UNIT_SETTLE_S + 5))' "$RUNLIMITS_DIR") \
    || { echo "FATAL stop budget not readable from $RUNLIMITS_DIR/runlimits.py"; exit 2; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/rl-mutate.XXXXXX") || { echo "FATAL mktemp"; exit 2; }
# kill_tree <python> <pid> <limit_s>: the tree below pid (this helper excluded)
# gets SIGTERM; the call returns when every process of that first snapshot has
# exited (orphans are no longer in the tree), what is still alive after
# limit_s gets SIGKILL.
kill_tree() {
    "$1" - "$2" "$3" <<'PY'
import os, signal, subprocess, sys, time
root, me, limit = int(sys.argv[1]), os.getpid(), float(sys.argv[2])
def table():
    rows = {}
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,stat=,lstart="], stdout=subprocess.PIPE, universal_newlines=True, env=dict(os.environ, LC_ALL="C")).stdout
    for ln in out.splitlines():
        f = ln.split()
        if len(f) == 8:
            rows[int(f[0])] = (int(f[1]), f[2], " ".join(f[3:]))
    return rows
def tree(rows):
    kids = {}
    for pid, (ppid, _, start) in rows.items():
        kids.setdefault(ppid, []).append(pid)
    out, todo = [], [root]
    while todo:
        for k in kids.get(todo.pop(), ()):
            if k != me and k not in out:
                out.append(k); todo.append(k)
    return out
def live(rows, pids):
    return [p for p in pids if p in rows and not rows[p][1].startswith("Z")]
def send(pids, sig):
    for p in pids:
        try:
            os.kill(p, sig)
        except OSError:
            pass
rows = table()
first = {p: rows[p][2] for p in live(rows, tree(rows))}
send(first, signal.SIGTERM)
t0 = time.time()
while time.time() - t0 < limit:
    rows = table()
    if not live(rows, [p for p, start in first.items() if p in rows and rows[p][2] == start]):
        break
    time.sleep(0.1)
rows = table()
same = {p for p, start in first.items() if p in rows and rows[p][2] == start}
send(live(rows, same | set(tree(rows))), signal.SIGKILL)
PY
}
cleanup() { trap '' INT HUP TERM; kill_tree "$PY" $$ "$STOP_S"; rm -rf "$TMP"; }
trap cleanup EXIT
trap 'exit 130' INT; trap 'exit 129' HUP; trap 'exit 143' TERM
# teeth <out> <err> <scope> <var=value>...: one teeth run as a background job + wait
# (bash runs a signal trap only after a foreground command ends); stdout and stderr
# go to their own files: only stdout is judged (a sublog FAIL goes to stderr)
teeth() {
    local out=$1 err=$2 scope=$3
    shift 3
    env "$@" bash "$HERE/runlimits-teeth.sh" --scope "$scope" >"$out" 2>"$err" &
    wait $!
}
# instrument_fails <out> <err>: the FAIL lines of either stream naming an instrument
# or sublog failure - such a run proves nothing either way
instrument_fails() { grep -h -E '^FAIL .*(instrument:|sublog:)' "$1" "$2"; }
LIBFILES="runlimits.py runlimits.sh runlimits.mjs census-guard.py NOTES.md runlimits-teeth.sh mutate.sh mutations.tsv"
case $PLAT in darwin) OTHER=linux ;; *) OTHER=darwin ;; esac
bash "$HERE/runlimits-teeth.sh" --list >"$TMP/teeth.list" || { echo "FATAL teeth list not readable from $HERE/runlimits-teeth.sh"; exit 2; }
OTHER_ONLY=" $(awk -F'\t' -v o="$OTHER-only" '$2 == o { printf "%s ", $1 }' "$TMP/teeth.list")"
# runnable <tooth list>: the teeth of the list this platform runs (comma list, may be empty)
runnable() {
    local t r=""
    for t in $(echo "$1" | tr ',' ' '); do
        case "$OTHER_ONLY" in *" $t "*) ;; *) r="$r${r:+,}$t" ;; esac
    done
    printf '%s' "$r"
}

TOTAL=0; RED=0; SURVIVED=0; BROKEN=0; SKIPPED=0
while IFS= read -r row; do
    case "$row" in ''|'#'*) continue ;; esac
    id=$(printf '%s' "$row" | cut -f1)
    case "$WANT" in *" $id "*) ;; *) continue ;; esac
    tooth=$(printf '%s' "$row" | cut -f2)
    plat=$(printf '%s' "$row" | cut -f3)
    file=$(printf '%s' "$row" | cut -f4)
    if [ "$plat" != all ] && [ "$plat" != "$PLAT" ]; then
        echo "SKIP $id: $plat-only branch, not counted on $PLAT"; SKIPPED=$((SKIPPED+1)); continue
    fi
    if [ -z "$(runnable "$tooth")" ]; then
        echo "SKIP $id: tooth $tooth $OTHER-only, not counted on $PLAT"; SKIPPED=$((SKIPPED+1)); continue
    fi
    TOTAL=$((TOTAL+1))
    teeth "$TMP/$id.base.out" "$TMP/$id.base.err" "$tooth" RL_UNDER_TEST="$HERE"
    base_rc=$?
    echo "baseline teeth scope=$tooth EXIT=$base_rc $(grep '^teeth: ' "$TMP/$id.base.out")"
    if [ $base_rc -ne 0 ]; then
        echo "BROKEN $id: baseline of tooth $tooth red without the mutant (EXIT=$base_rc; failing teeth: $(grep -h '^FAIL ' "$TMP/$id.base.out" "$TMP/$id.base.err" | cut -d' ' -f2 | sort -u | tr '\n' ' ')) - the row proves nothing"
        awk '{ print "  | " $0 }' "$TMP/$id.base.out" "$TMP/$id.base.err"
        BROKEN=$((BROKEN+1)); continue
    fi
    M="$TMP/mut-$id"; mkdir -p "$M"
    for f in $LIBFILES; do cp "$HERE/$f" "$M/$f"; done
    if ! printf '%s' "$row" | "$PY" -c '
import sys
row = sys.stdin.read().split("\t", 5)
find, repl = row[4], row[5]
path = sys.argv[1]
src = open(path).read()
n = src.count(find)
if n != 1:
    print("find occurs %d times: %r" % (n, find)); sys.exit(1)
open(path, "w").write(src.replace(find, repl))
' "$M/$file"; then
        echo "BROKEN $id: mutation not applicable"; BROKEN=$((BROKEN+1)); continue
    fi
    broke=""
    case "$file" in
        *.py) if ! out=$("$PY" -m py_compile "$M/$file" 2>&1); then broke="py_compile: $out"; fi ;;
        *.sh) out=$(bash -n "$M/$file" 2>&1); brc=$?
              if [ $brc -ne 0 ] || [ -n "$out" ]; then broke="bash -n rc=$brc: $out"; fi ;;
    esac
    if [ -n "$broke" ]; then
        echo "BROKEN $id: the mutant does not compile: $(printf '%s' "$broke" | tr '\n' ' ' | head -c 300)"
        BROKEN=$((BROKEN+1)); continue
    fi
    teeth "$TMP/$id.out" "$TMP/$id.err" "$tooth" RL_UNDER_TEST="$M" RL_TEETH_UNDER_TEST="$M/runlimits-teeth.sh" RL_MUTATE_UNDER_TEST="$M/mutate.sh"
    mrc=$?
    inst=$(instrument_fails "$TMP/$id.out" "$TMP/$id.err")
    if [ -n "$inst" ]; then
        echo "BROKEN $id: instrument failure in tooth $(printf '%s\n' "$inst" | cut -d' ' -f2 | sort -u | tr '\n' ' ')- the run proves nothing (EXIT=$mrc)"
        printf '%s\n' "$inst" | sed 's/^/  | /'
        BROKEN=$((BROKEN+1)); continue
    fi
    fails=$(grep '^FAIL ' "$TMP/$id.out" | cut -d' ' -f2 | sort -u | tr '\n' ' ')
    redt=""
    for t in $(echo "$tooth" | tr ',' ' '); do
        if grep -q "^FAIL $t " "$TMP/$id.out"; then redt="$redt${redt:+,}$t"; fi
    done
    if [ $mrc -ne 0 ] && [ -n "$redt" ]; then
        echo "RED $id: teeth --scope $tooth EXIT=$mrc, own tooth $redt FAIL; failing teeth: $fails"
        for t in $(echo "$redt" | tr ',' ' '); do grep "^FAIL $t " "$TMP/$id.out" | sed 's/^/  | /'; done
        RED=$((RED+1))
    else
        echo "SURVIVED $id: teeth --scope $tooth EXIT=$mrc, own tooth $tooth not red; failing teeth: $fails"
        awk '{ print "  | " $0 }' "$TMP/$id.out" "$TMP/$id.err"
        SURVIVED=$((SURVIVED+1))
    fi
done <"$TSV"

echo "MUTATIONS platform=$PLAT scope=$SCOPE_STR total=$TOTAL red=$RED survived=$SURVIVED broken=$BROKEN skipped=$SKIPPED"
[ $TOTAL -gt 0 ] && [ $RED -eq $TOTAL ] && [ $BROKEN -eq 0 ] && exit 0
exit 1
