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
# run-limits teeth (bash 3.2 compatible: /bin/bash on macOS).
#
# The script enters its own limits through the canonical bash prologue above
# (profile `runner`); that supervisor is the back limit of the whole run, no
# external systemd-run is needed.
#
# Library under test: RL_UNDER_TEST (default: this directory). mutate.sh points
# it at a mutant copy; the prologue above always uses the real library found by
# the standard search, so a mutant never supervises the teeth themselves.
#
# Every tooth uses the test profile `teeth` (mem 150 MB, runtime 3 s,
# max_parallel linux 2 / darwin 1), which exists only while RUNLIMITS_LOG_DIR
# names a non-combat directory; each tooth has its own private log dir.
# The 3 s budget runs from Supervisor.__init__, and preparing a supervisor (nested
# ones included) on a host with systemd may take seconds: every teeth-profile
# supervisor call whose verdict is not about time carries RUNLIMITS_TEST_TIME_S=30
# (nested supervisors inherit it through the env); the rule is per call, not per
# tooth. Only calls with a time verdict keep the profile's 3 s: T2, T31, T38 (b),
# T41 (b), T107, T112-T114, and T78, T116 through the nested T2; a call shared by a
# time and a non-time part would keep 3 s.
# Loads are small allocators (<= 300 MB) that exit by themselves after 20 s.
# Every supervisor call is bounded (kill after a timeout) so a broken library
# cannot hang the run.
#
# Fixture prologues (T4-T8, T11) are cut out of $RL_UNDER_TEST/NOTES.md, the
# canon for phase B, so the teeth test exactly the text phase B will paste.
#
# Usage: runlimits-teeth.sh [--each-alone] --scope <tooth>[,<tooth>...] | --list
# Nothing runs without --scope; there is no "all" word: a full run names every
# tooth (`--list` prints the names). An unknown name runs nothing either.
# --each-alone runs every scoped tooth of this platform by its own `--scope Tn`
# call of this runner (`alone ...` lines, summary `alone ran=N passed=P failed=F`
# and `alone failed: <names>|none`): every tooth builds its own fixtures and must
# pass with no other tooth run before it (T116).
#
# Output: `PASS Tn ...` / `FAIL Tn ...` / `SKIP Tn ...` lines, then a summary;
# exit 0 only if every named tooth ran and passed (LINUX_ONLY / DARWIN_ONLY
# teeth named on the other platform print a SKIP line and are not counted;
# platform-only parts of other teeth print a named sub-skip). EXPECTED_TEETH
# pins the number of known teeth per platform.
set -u
KNOWN="T1 T1b T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 T17 T18 T19 T20 T21 T22 T23 T24 T25 T26 T27 T28 T29 T30 T31 T32 T33 T34 T35 T36 T37 T38 T39 T40 T41 T42 T43 T44 T45 T46 T47 T48 T49 T50 T51 T52 T53 T54 T55 T56 T57 T58 T59 T60 T61 T62 T63 T64 T65 T66 T67 T68 T69 T70 T71 T72 T73 T74 T75 T76 T77 T78 T79 T80 T81 T82 T83 T84 T85 T86 T87 T88 T89 T90 T91 T92 T93 T94 T95 T96 T97 T98 T99 T100 T101 T102 T103 T104 T105 T106 T107 T108 T109 T110 T111 T112 T113 T114 T115 T116 T117 T118 T119 T120 T121 T122 T123 T123s T123b T124 T125 T126 T127 T128 T129 T130 T131 T132 T133 T134 T135 T136 T137 T139 T141 T142 T138 T140 T143 T144 T145 T146"
LINUX_ONLY="T1b T13 T14 T31 T32 T34 T37 T38 T39 T41 T42 T49 T50 T58 T59 T66 T67 T68 T71 T106 T115 T123 T123s T123b T127 T129 T130 T131 T132 T141 T140 T143 T144 T146"
DARWIN_ONLY="T33 T40 T56 T61 T75 T91 T92 T97 T100 T101 T110 T112 T113 T114"
nothing_run() {
    echo "nothing run: scope required (--scope <name>[,<name>...]); known: $(echo $KNOWN | tr ' ' ',')" >&2
    exit 2
}
SCOPE=""; LIST=0; EACH=0
while [ $# -gt 0 ]; do
    case "$1" in
        --scope) [ $# -ge 2 ] || nothing_run; SCOPE="$SCOPE${SCOPE:+,}$2"; shift 2 ;;
        --scope=*) SCOPE="$SCOPE${SCOPE:+,}${1#--scope=}"; shift ;;
        --list) LIST=1; shift ;;
        --each-alone) EACH=1; shift ;;
        *) nothing_run ;;
    esac
done
if [ $LIST = 1 ]; then
    for t in $KNOWN; do
        case " $LINUX_ONLY " in *" $t "*) printf '%s\tlinux-only\n' "$t"; continue ;; esac
        case " $DARWIN_ONLY " in *" $t "*) printf '%s\tdarwin-only\n' "$t"; continue ;; esac
        echo "$t"
    done
    exit 0
fi
WANT=" "
set -f
for t in $(echo "$SCOPE" | tr ',' ' '); do
    case " $KNOWN " in *" $t "*) ;; *) nothing_run ;; esac
    case "$WANT" in *" $t "*) ;; *) WANT="$WANT$t " ;; esac
done
set +f
[ "$WANT" != " " ] || nothing_run
want() { case "$WANT" in *" $1 "*) return 0 ;; esac; return 1; }
linux_only() { case " $LINUX_ONLY " in *" $1 "*) return 0 ;; esac; return 1; }
darwin_only() { case " $DARWIN_ONLY " in *" $1 "*) return 0 ;; esac; return 1; }
other_plat() { if [ $PLAT = darwin ]; then linux_only "$1"; else darwin_only "$1"; fi; }
export PYTHONDONTWRITEBYTECODE=1  # the library dir stays free of __pycache__

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
UT=${RL_UNDER_TEST:-$HERE}
LPY=$(command -v python3)
NODE=$(command -v node)
BASHBIN=${BASH:-$(command -v bash)}
case "$(uname -s)" in
    Darwin) PLAT=darwin; EXPECTED_TEETH=115; MAXPAR=1 ;;
    Linux)  PLAT=linux;  EXPECTED_TEETH=135; MAXPAR=2 ;;
    *) echo "FATAL unsupported platform $(uname -s)"; exit 2 ;;
esac
NPLAT=0; EXPECTED=0; SCOPE_STR=""
for t in $KNOWN; do
    if other_plat "$t"; then continue; fi
    NPLAT=$((NPLAT+1))
done
for t in $WANT; do
    SCOPE_STR="$SCOPE_STR${SCOPE_STR:+,}$t"
    if other_plat "$t"; then continue; fi
    EXPECTED=$((EXPECTED+1))
done
[ $NPLAT -eq $EXPECTED_TEETH ] || { echo "FATAL $NPLAT known teeth on $PLAT, EXPECTED_TEETH pins $EXPECTED_TEETH"; exit 2; }
if [ $EXPECTED -eq 0 ]; then
    # every scoped tooth is for the other platform: nothing would run, exit 2 (B3)
    if [ $PLAT = darwin ]; then OTHER_PLAT=linux; else OTHER_PLAT=darwin; fi
    echo "nothing run on $PLAT: every scoped tooth is $OTHER_PLAT-only" >&2
    exit 2
fi
# sha256 of json.dumps(runlimits.PROFILES, sort_keys=True): pins the table (T12).
PROFILES_DIGEST=555caaf70f5d2dd996b3bd4f31d835ae73ead148028710627210382ce3cd2c7c

# the supervisor's full stop: GRACE_S (escalation) + GRACE_S (sweep of survivors) +
# UNIT_SETTLE_S (scope state), +5 s margin; a stop cut shorter leaves its shim dir and unit
STOP_S=$("$LPY" -B -c 'import sys; sys.path.insert(0, sys.argv[1]); import runlimits as r; print(int(2 * r.GRACE_S + r.UNIT_SETTLE_S + 5))' "$RUNLIMITS_DIR") \
    || { echo "FATAL stop budget not readable from $RUNLIMITS_DIR/runlimits.py"; exit 2; }
BGRACE=$((STOP_S + 5))
TMP=$(mktemp -d "${TMPDIR:-/tmp}/rl-teeth.XXXXXX") || { echo "FATAL mktemp"; exit 2; }
TMP=$(cd "$TMP" && pwd -P)
TOKEN=$(basename "$TMP")
TEETH_PID=$$
export RL_FIXTURE_PID_HELPER="$TMP/fixture_pid.py"
export PYTHONPATH="$TMP${PYTHONPATH:+:$PYTHONPATH}"
cat >"$RL_FIXTURE_PID_HELPER" <<'PY'
import os, pathlib, subprocess, sys, time

def start_of(pid):
    try:
        result = subprocess.run(["ps", "-o", "lstart=", "-p", str(pid)], stdout=subprocess.PIPE, text=True, env=dict(os.environ, LC_ALL="C"), timeout=5)
        if result.returncode == 0 and result.stdout.strip():
            return str(int(time.mktime(time.strptime(result.stdout.strip(), "%a %b %d %H:%M:%S %Y"))))
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print("fixture start: %s" % e, file=sys.stderr)
    return "-"

def record_pid(path, pid, start=None, payload=None, append=False):
    path = pathlib.Path(path)
    start = start_of(pid) if start is None else str(start or "-")
    value = str(pid) if payload is None else payload
    # The identity is published before readiness; readers never acquire a later start.
    mode = "a" if append else "w"
    if append:
        with open(str(path) + ".start", mode) as stream:
            stream.write(start + "\n")
        with path.open(mode) as stream:
            stream.write(value + "\n")
    else:
        identity = pathlib.Path(str(path) + ".start.tmp")
        identity.write_text(start + "\n")
        os.replace(identity, str(path) + ".start")
        pending = pathlib.Path(str(path) + ".tmp")
        pending.write_text(value + "\n")
        os.replace(pending, path)

if __name__ == "__main__":
    if sys.argv[1] == "start":
        value = start_of(sys.argv[2])
        if value != "-":
            print(value)
    elif sys.argv[1] == "by-pid":
        record_pid(sys.argv[3], sys.argv[2])
    else:
        record_pid(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
PY
# the test-mode marker names its runner (E6): this shell's pid and its ps lstart in epoch
# seconds - the unit the library compares against
pstart() { # <pid>: its ps lstart in epoch seconds (empty when not readable)
    "$LPY" "$RL_FIXTURE_PID_HELPER" start "$1"
}
save_pid() { local st; st=$(pstart "$2"); "$LPY" "$RL_FIXTURE_PID_HELPER" "$1" "$2" "${st:--}"; }
same_pid() { local st; st=$(pstart "$1"); [ -n "$st" ] && [ "$st" = "$2" ]; }
signal_saved() { # signal pid start case-log
    if same_pid "$2" "$3"; then
        if alive "$2"; then
            kill -"$1" "$2" || printf 'pid %s signal %s failed: process left before signal\n' "$2" "$1" >>"$4"
        fi
    else printf 'pid %s not signalled: start changed or unreadable (saved %s)\n' "$2" "$3" >>"$4"; fi
}
signal_file() { # signal pid-file case-log
    local p rest st=-
    [ -s "$2" ] || return 0
    read -r p rest <"$2"
    [ -s "$2.start" ] && read -r st <"$2.start"
    signal_saved "$1" "$p" "$st" "$3"
}
wait_pidfile() { # pid-file timeout_s [time origin]
    local p rest st=-
    [ -s "$1" ] || return 0
    read -r p rest <"$1"
    [ -s "$1.start" ] && read -r st <"$1.start"
    wait_dead "$p" "$2" "${3:-$(now)}" "$st"
}
snapshot_pidfile() { # snapshot pid-file (one saved start per pid line)
    "$LPY" - "$1" "$2" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[2])
if path.exists():
    identity = pathlib.Path(str(path) + ".start")
    starts = identity.read_text().splitlines() if identity.exists() else []
    saved = path.read_text().splitlines()
    pids = {line.split()[0] for line in saved if line.split()}
    target = pathlib.Path(sys.argv[1])
    previous = target.read_text().splitlines() if target.exists() else []
    with target.open("w") as stream:
        for line in previous:
            if line.split() and line.split()[0] not in pids:
                stream.write(line + "\n")
        for index, line in enumerate(saved):
            if not line.split():
                continue
            pid = line.split()[0]
            start = starts[index] if index < len(starts) else "-"
            stream.write("%s %s\n" % (pid, start or "-"))
PY
}
snapshot_saved() { # file pids...
    local file=$1 p st; shift
    : >"$file"
    for p in "$@"; do st=$(pstart "$p"); printf '%s %s\n' "$p" "${st:--}" >>"$file"; done
}
signal_snapshot() { # signal snapshot case-log
    local p st
    while read -r p st; do signal_saved "$1" "$p" "$st" "$3"; done <"$2"
}
kill_saved_tree() { # root pid-file case-log
    local p rest st=- targets="$1.targets"
    [ -s "$1" ] || return 0
    read -r p rest <"$1"
    [ -s "$1.start" ] && read -r st <"$1.start"
    : >"$targets"
    if same_pid "$p" "$st"; then snapshot_saved "$targets" $(descendants "$p"); fi
    snapshot_pidfile "$targets" "$1"
    signal_snapshot KILL "$targets" "$2"
}
live_snapshot() {
    local p st
    while read -r p st; do same_pid "$p" "$st" && alive "$p" && printf '%s ' "$p"; done <"$1"
}
TEETH_START=$(pstart "$TEETH_PID")
[ -n "$TEETH_START" ] || { echo "FATAL start time of the teeth shell $TEETH_PID not readable"; exit 2; }
RAN=0; PASSED=0; FAILED=0; SUBSKIPS=0
SUP="$UT/runlimits.py"
GUARD="$UT/census-guard.py"

# subskip <tooth> <reason>: a platform-limited part of a scoped tooth that did not
# run; counted in the summary line (B4)
subskip() { echo "SUBSKIP $1: $2"; SUBSKIPS=$((SUBSKIPS+1)); }

now() { "$LPY" -c 'import time; print("%.3f" % time.time())'; }
elapsed_ge() { "$LPY" -c 'import sys; sys.exit(0 if float(sys.argv[2]) - float(sys.argv[1]) >= float(sys.argv[3]) else 1)' "$1" "$2" "$3"; }
secs_between() { "$LPY" -c 'import sys; print("%.2f" % (float(sys.argv[2]) - float(sys.argv[1])))' "$1" "$2"; }

alive() { # pid alive and not a zombie
    local s
    s=$(ps -o stat= -p "$1") || return 1
    case "$s" in Z*) return 1 ;; esac
    return 0
}

wait_file() { # file timeout_s
    local f=$1 t0; t0=$(now)
    while :; do
        [ -s "$f" ] && return 0
        elapsed_ge "$t0" "$(now)" "$2" && return 1
        sleep 0.05
    done
}

wait_dead() { # pid timeout_s [time origin] [saved process start]
    local pid=$1 t0=${3:-$(now)} st=${4-$(pstart "$1")} current
    while :; do
        alive "$pid" || return 0
        current=$(pstart "$pid")
        if [ -z "$current" ] || [ -z "$st" ] || [ "$st" = - ]; then
            alive "$pid" || return 0
            echo "wait_dead: pid $pid identity unreadable (saved ${st:--})" >&2
            return 1
        fi
        [ "$current" != "$st" ] && return 0
        elapsed_ge "$t0" "$(now)" "$2" && return 1
        sleep 0.05
    done
}

# firstmatch <glob words...>: the first existing path among them (a glob that
# matched nothing stays literal and does not exist); empty and 1 when none
firstmatch() { local f; for f in "$@"; do [ -e "$f" ] && { printf '%s' "$f"; return 0; }; done; return 1; }

pass() { echo "PASS $1 $2"; PASSED=$((PASSED+1)); }
fail() { echo "FAIL $1 $2"; FAILED=$((FAILED+1)); }
skip() { echo "SKIP $1 $2"; }
# the log dir carries the test-mode marker file: without it a non-combat
# RUNLIMITS_LOG_DIR does not arm the knobs nor the teeth profile (A14, T74); it
# arms them only while its runner lives (E6, T96)
testmark() { printf '%s %s\n' "$TEETH_PID" "$TEETH_START" >"$1/.runlimits-test"; }
begin() {
    RAN=$((RAN+1)); TOOTH=$1; LOG="$TMP/log-$1"; mkdir -p "$LOG"; testmark "$LOG"
}
# sublog <dir>: a sub-log-dir passed to a supervisor, same marker rule as begin. The
# path is printed either way (a $(sublog) caller keeps a non-combat dir); a failed
# mkdir or marker write prints a FAIL line of the tooth on stderr and returns 1 (E11).
# A failure inside $(sublog ...) also adds a line to $TMP/subfails: the FAILED counter
# of a subshell dies with it, the file reaches the summary (T105). In the runner's own
# shell the caller's `|| …` fails the tooth, which is counted already (T115)
sublog() {
    local why
    why=$( { mkdir -p "$1" && testmark "$1"; } 2>&1 ) || { echo "FAIL $TOOTH sublog: $1: ${why:-mkdir or marker write failed}" >&2; [ "$BASH_SUBSHELL" -gt 0 ] && echo "$TOOTH $1" >>"$TMP/subfails"; printf '%s' "$1"; return 1; }
    printf '%s' "$1"
}
# awk ends every line with a newline: a log without a final newline must not glue the next PASS/FAIL line to it
show() { awk '{ print "  | " $0 }' "$1"; }

# descendants <pid>: pids of the process tree below pid (one ps snapshot).
descendants() {
    ps -axo pid=,ppid= | "$LPY" -c '
import sys
root, kids = int(sys.argv[1]), {}
for ln in sys.stdin:
    f = ln.split()
    if len(f) == 2:
        kids.setdefault(int(f[1]), []).append(int(f[0]))
out, todo = [], [root]
while todo:
    for k in kids.get(todo.pop(), ()):
        if k not in out:
            out.append(k); todo.append(k)
print(" ".join(map(str, out)))' "$1"
}

# bounded <timeout_s> <tag> cmd... : runs cmd in the background with stdout in
# $TMP/<tag>.out and stderr in $TMP/<tag>.err; after the timeout its whole tree
# gets SIGTERM (a runner cleans up), what is left BGRACE s later SIGKILL (killing
# only the top pid would orphan the tree, which then runs on unwatched; BGRACE
# outlasts a runner's own stop, STOP_S, so a supervisor inside finishes its
# stop); exit code in BRC, BPID = its pid.
bounded() {
    local t=$1 tag=$2 t0=$SECONDS p pids k0 st root_start wdr
    shift 2
    "$@" >"$TMP/$tag.out" 2>"$TMP/$tag.err" &
    BPID=$!
    # CONSTRAINT: not $tag.pid - the T13/T21 fixtures read $TMP/t13x.pid as their
    # own child's pid file; a bounded pid file under that name reads as "child started"
    save_pid "$TMP/$tag.bpid" "$BPID"; root_start=$(cat "$TMP/$tag.bpid.start")
    while alive "$BPID"; do
        if [ $((SECONDS - t0)) -ge "$t" ]; then
            pids="$BPID"
            if same_pid "$BPID" "$root_start"; then pids="$pids $(descendants "$BPID")"; fi
            : >"$TMP/$tag.targets"
            for p in $pids; do
                if [ "$p" = "$BPID" ]; then st=$root_start; else st=$(pstart "$p"); fi
                printf '%s %s\n' "$p" "${st:--}" >>"$TMP/$tag.targets"
            done
            echo "  bounded: $tag still running after $t s, SIGTERM to its tree ($pids), SIGKILL after $BGRACE s"
            while read -r p st; do signal_saved TERM "$p" "$st" "$TMP/$tag.err"; done <"$TMP/$tag.targets"
            k0=$(now)
            while alive "$BPID" && ! elapsed_ge "$k0" "$(now)" "$BGRACE"; do sleep 0.1; done
            if same_pid "$BPID" "$root_start"; then
                for p in $(descendants "$BPID"); do
                    st=$(pstart "$p"); printf '%s %s\n' "$p" "${st:--}" >>"$TMP/$tag.targets"
                done
            fi
            while read -r p st; do signal_saved KILL "$p" "$st" "$TMP/$tag.err"; done <"$TMP/$tag.targets"
            break
        fi
        sleep 0.1
    done
    if alive "$BPID"; then
        wait_dead "$BPID" 5 "$(now)" "$root_start"
        wdr=$?
        # CONSTRAINT: wait_dead's 0 also covers "identity changed" - our own
        # un-reaped child cannot be replaced, so a child still alive here means
        # the identity read itself is unreliable; never block on it (552c G7)
        if [ "$wdr" -ne 0 ] || alive "$BPID"; then
            echo "bounded: child still alive; no blocking wait" >>"$TMP/$tag.err"
            BRC=124; return
        fi
    fi
    wait "$BPID"
    BRC=$?
}

# jrec <logdir> <index> <key>: field of journal record <index> (-1 = last);
# prints MISSING if the journal or the record is absent.
jrec() {
    "$LPY" - "$1/runs.jsonl" "$2" "$3" <<'PY'
import json, sys
path, idx, key = sys.argv[1], int(sys.argv[2]), sys.argv[3]
try:
    recs = [json.loads(l) for l in open(path).read().splitlines() if l.strip()]
    v = recs[idx][key]
except (OSError, ValueError, IndexError, KeyError):
    print("MISSING"); sys.exit(0)
print("null" if v is None else v)
PY
}

# jfind <logdir> <key> <value> <key2>: key2 of the last record whose key equals
# value (compared as strings); MISSING if there is none.
jfind() {
    "$LPY" - "$1/runs.jsonl" "$2" "$3" "$4" <<'PY'
import json, sys
path, key, val, key2 = sys.argv[1:5]
try:
    recs = [json.loads(l) for l in open(path).read().splitlines() if l.strip()]
except (OSError, ValueError):
    recs = []
hit = [r for r in recs if str(r.get(key)) == val]
if not hit or key2 not in hit[-1]:
    print("MISSING"); sys.exit(0)
v = hit[-1][key2]
print("null" if v is None else v)
PY
}

# Kill loads a tooth left behind (a mutant that did not kill): only pids whose
# argv still carries the token (guards against pid reuse).
kill_loads() {
    local f p rest cmd
    for f in "$TMP"/*.pid; do
        [ -s "$f" ] || { rm -f "$f"; continue; }
        read -r p rest <"$f"
        cmd=$(ps -o command= -p "$p") || continue
        case "$cmd" in
            *"$TOKEN"*) signal_file KILL "$f" "$f.err"; wait_pidfile "$f" 2 || echo "  load $p survived SIGKILL" ;;
        esac
        rm -f "$f" "$f.start"
    done
}

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

# Bash defers traps through foreground commands/substitutions; without a trap it
# dies by the signal in the substitution phase, but ignores INT in plain foreground
# waiting. T35 judges raw wait-status: a bash parent's $? folds both kinds to 128+N.
cleanup() { trap '' INT HUP TERM; kill_loads; kill_tree "$LPY" $$ "$STOP_S"; rm -rf "$TMP"; }
trap cleanup EXIT
trap 'exit 130' INT; trap 'exit 129' HUP; trap 'exit 143' TERM

if [ $EACH = 1 ]; then
    SELF="$HERE/$(basename "${BASH_SOURCE[0]}")"
    AR=0; AP=0; AF=0; AFAILED=""
    for t in $WANT; do
        if other_plat "$t"; then echo "alone SKIP $t: not counted on $PLAT"; continue; fi
        AR=$((AR+1))
        "$BASHBIN" "$SELF" --scope "$t" >"$TMP/alone-$t.out" 2>&1 &
        wait $!
        arc=$?
        sed "s/^/alone $t | /" "$TMP/alone-$t.out"
        sum=$(grep '^TEETH ' "$TMP/alone-$t.out")
        if [ $arc -eq 0 ]; then AP=$((AP+1)); echo "alone PASS $t"
        else AF=$((AF+1)); AFAILED="$AFAILED${AFAILED:+ }$t"; echo "alone FAIL $t exit $arc: ${sum:-no summary line}"; fi
    done
    echo "alone ran=$AR passed=$AP failed=$AF"
    echo "alone failed: ${AFAILED:-none}"
    [ $AR -eq $EXPECTED ] && [ $AP -eq $AR ] && exit 0
    exit 1
fi

# ---------------------------------------------------------------- loads
cat >"$TMP/alloc.py" <<'PY'
import os, resource, sys, time
target_mb, hold_s = int(sys.argv[1]), float(sys.argv[2])
if len(sys.argv) > 3:
    with open(sys.argv[3], "w") as f:
        __import__("fixture_pid").record_pid(f.name, os.getpid())
scale = 1 if sys.platform == "darwin" else 1024  # ru_maxrss: bytes on darwin, KiB on Linux
deadline = time.time() + 20
bufs = []
while resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale < target_mb * 1048576 and time.time() < deadline:
    bufs.append(bytearray(b"\x01") * (4 << 20))
    time.sleep(0.005)
time.sleep(max(0.0, min(hold_s, deadline - time.time())))
PY

cat >"$TMP/report.py" <<'PY'
import json, os, subprocess, sys
out = sys.argv[1]
ps = subprocess.run(["ps", "-axo", "pid=,ppid=,command="], stdout=subprocess.PIPE,
                    universal_newlines=True).stdout
procs = {}
for ln in ps.splitlines():
    parts = ln.split(None, 2)
    if len(parts) >= 2:
        procs[int(parts[0])] = (int(parts[1]), parts[2] if len(parts) > 2 else "")
chain, cur = [], os.getppid()
while cur in procs and cur > 1 and len(chain) < 64:
    chain.append([cur, procs[cur][1]])
    cur = procs[cur][0]
with open(out, "w") as f:
    json.dump({"active": os.environ.get("RUNLIMITS_ACTIVE"), "depth": os.environ.get("RUNLIMITS_DEPTH"), "chain": chain}, f)
PY

# chain_check <report> <expected supervisors> [<pid that must NOT be the marker>]:
# the part of the fixture's ancestry below the teeth shell holds exactly N
# supervisors, the innermost one is the marker pid, the marker profile is teeth.
chain_check() {
    "$LPY" - "$1" "$TEETH_PID" "$2" "${3:-0}" <<'PY'
import json, re, sys
path, teeth, want, notpid = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
try:
    r = json.load(open(path))
except (OSError, ValueError) as e:
    print("no report: %s" % e); sys.exit(1)
chain = r["chain"]
pids = [p for p, _ in chain]
if teeth not in pids:
    print("teeth shell %d not an ancestor: %s" % (teeth, pids)); sys.exit(1)
below = chain[:pids.index(teeth)]
wrap = re.compile(r"(^|[\s/])runlimits\.py --wrap(\s|$)")
sups = [p for p, c in below if wrap.search(c)]
act = r.get("active") or ""
if len(sups) != want:
    print("%d supervisors below the teeth shell (want %d): %s" % (len(sups), want, below)); sys.exit(1)
mpid, _, mprof = act.partition(":")
if not mpid.isdigit() or int(mpid) != sups[0]:
    print("marker %r is not the innermost supervisor %d" % (act, sups[0])); sys.exit(1)
if int(mpid) == notpid:
    print("marker still names the leaked pid %d" % notpid); sys.exit(1)
if mprof != "teeth":
    print("marker profile %r, want teeth" % mprof); sys.exit(1)
print("marker %s = ancestor supervisor, %d supervisor(s) below the teeth shell" % (act, len(sups)))
PY
}

# prologue <lang> <profile>: the canonical prologue cut out of $UT/NOTES.md.
prologue() {
    "$LPY" - "$UT/NOTES.md" "$1" "$2" <<'PY'
import sys
path, lang, prof = sys.argv[1:4]
try:
    lines = open(path).read().splitlines()
except OSError as e:
    sys.stderr.write("NOTES.md unreadable: %s\n" % e); sys.exit(1)
b, e = "<!-- prologue:%s:begin -->" % lang, "<!-- prologue:%s:end -->" % lang
if lines.count(b) != 1 or lines.count(e) != 1:
    sys.stderr.write("prologue %s markers missing in NOTES.md\n" % lang); sys.exit(1)
body = [l for l in lines[lines.index(b) + 1:lines.index(e)] if not l.startswith("```")]
sys.stdout.write("\n".join(body).replace("@PROFILE@", prof) + "\n")
PY
}

# mkfix <lang> <file> <body file>: shebang + canonical prologue (profile teeth) + body.
mkfix() {
    local lang=$1 f=$2 body=$3
    case "$lang" in
        bash) echo '#!/usr/bin/env bash' >"$f" ;;
        python) echo '#!/usr/bin/env python3' >"$f" ;;
        node) : >"$f" ;;
    esac
    prologue "$lang" teeth >>"$f" || return 1
    cat "$body" >>"$f"
}

FIX="$TMP/fix"; mkdir -p "$FIX"
cat >"$TMP/body.bash" <<SH
"$LPY" "$TMP/report.py" "\$1"
SH
cat >"$TMP/body.python" <<PY
import subprocess
subprocess.run(["$LPY", "$TMP/report.py", sys.argv[1]])
PY
cat >"$TMP/body.node" <<JS
import { spawnSync as _ss } from 'node:child_process';
_ss('$LPY', ['$TMP/report.py', process.argv[2]], { stdio: 'inherit' });
JS
cat >"$TMP/body.nest" <<SH
"$LPY" "$FIX/probe.py" "\$1"
SH
FIXOK=1
mkfix bash "$FIX/probe.sh" "$TMP/body.bash" || FIXOK=0
mkfix python "$FIX/probe.py" "$TMP/body.python" || FIXOK=0
mkfix node "$FIX/probe.mjs" "$TMP/body.node" || FIXOK=0
mkfix bash "$FIX/nest.sh" "$TMP/body.nest" || FIXOK=0

echo "teeth: platform=$PLAT scope=$SCOPE_STR library=$UT python=$LPY node=$NODE token=$TOKEN expected=$EXPECTED"
[ -f "$SUP" ] || echo "  library file missing: $SUP"
[ $FIXOK = 1 ] || echo "  fixture prologues could not be built from $UT/NOTES.md"

# ---------------------------------------------------------------- T1
# --wrap teeth -- alloc 300 -> 86, `killed: mem` line, journal limit=mem.
# Linux: the kernel form, by=kernel. With MemoryMax = mem_mb the winner is not
# determined (RSS counts warm file pages the cgroup does not charge: 148 vs 144 MB
# measured on usbox), so the kernel gets RUNLIMITS_TEST_KERNEL_MEM_MB=120: a 30 MB
# band wider than that gap. darwin: the watchdog kills -> by=watchdog.
K1=""
if [ $PLAT = linux ]; then
    WANT_MEM_LINE='(kernel oom-kill) > 150 MB (profile teeth)$'; WANT_BY=kernel; K1="RUNLIMITS_TEST_KERNEL_MEM_MB=120"
else
    WANT_MEM_LINE='[0-9.]* MB > 150 MB (profile teeth)$'; WANT_BY=watchdog
fi
if want T1; then
begin T1
bounded 25 t1 env RUNLIMITS_LOG_DIR="$LOG" $K1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t1 -- "$LPY" "$TMP/alloc.py" 300 20 "$TMP/t1.pid"
lim=$(jrec "$LOG" -1 limit); ex=$(jrec "$LOG" -1 exit); by=$(jrec "$LOG" -1 by)
if [ $BRC -ne 86 ]; then fail T1 "exit $BRC, want 86"; show "$TMP/t1.err"
elif ! grep -q "^RUNLIMITS: t1 killed: mem $WANT_MEM_LINE" "$TMP/t1.err"; then fail T1 "no killed: mem line of the $WANT_BY form"; show "$TMP/t1.err"
elif [ "$lim" != mem ] || [ "$ex" != 86 ] || [ "$by" != "$WANT_BY" ]; then fail T1 "journal limit=$lim exit=$ex by=$by, want mem/86/$WANT_BY"
elif [ -s "$TMP/t1.pid" ] && alive "$(cat "$TMP/t1.pid")"; then fail T1 "allocator still alive after the supervisor exited"
else pass T1 "exit 86, $(cat "$TMP/t1.err"), journal limit=mem by=$by"; fi
kill_loads
fi

# ---------------------------------------------------------------- T1b (Linux)
# Linux: the watchdog still kills when the sum of RSS exceeds mem_mb while the
# cgroup charge does not: 100 MB shared copy-on-write by a forked child counts
# twice in RSS, once in the cgroup -> 86 by=watchdog. (darwin: T1 covers it.)
if want T1b; then
if [ $PLAT = linux ]; then
    begin T1b
    cat >"$TMP/cow.py" <<'PY'
import os, sys, time
buf = bytearray(b"\x01") * (100 << 20)
if os.fork() == 0:
    time.sleep(20)
    os._exit(0)
with open(sys.argv[1], "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
time.sleep(20)
PY
    bounded 25 t1b env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t1b -- "$LPY" "$TMP/cow.py" "$TMP/t1b.pid"
    lim=$(jrec "$LOG" -1 limit); by=$(jrec "$LOG" -1 by)
    if [ $BRC -ne 86 ]; then fail T1b "exit $BRC, want 86"; show "$TMP/t1b.err"
    elif ! grep -q '^RUNLIMITS: t1b killed: mem [0-9.]* MB > 150 MB (profile teeth)$' "$TMP/t1b.err"; then fail T1b "no watchdog killed: mem line"; show "$TMP/t1b.err"
    elif [ "$lim" != mem ] || [ "$by" != watchdog ]; then fail T1b "journal limit=$lim by=$by, want mem/watchdog"
    else pass T1b "exit 86, $(cat "$TMP/t1b.err"), journal by=watchdog"; fi
    kill_loads
else
    skip T1b "linux-only (watchdog under the kernel limit), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T2
# --wrap teeth -- sleep 10 -> 87 within 5 s.
if want T2; then
begin T2
t0=$(now)
bounded 15 t2 env RUNLIMITS_LOG_DIR="$LOG" "$LPY" "$SUP" --wrap teeth --label t2 -- sleep 10
t1=$(now); d=$(secs_between "$t0" "$t1")
lim=$(jrec "$LOG" -1 limit)
if [ $BRC -ne 87 ]; then fail T2 "exit $BRC after $d s, want 87"; show "$TMP/t2.err"
elif elapsed_ge "$t0" "$t1" 5; then fail T2 "exit 87 only after $d s (> 5 s)"
elif ! grep -q '^RUNLIMITS: t2 killed: time [0-9.]* s > 3 s (profile teeth)$' "$TMP/t2.err"; then fail T2 "no killed: time line"; show "$TMP/t2.err"
elif [ "$lim" != time ]; then fail T2 "journal limit=$lim, want time"
else pass T2 "exit 87 after $d s, journal limit=time"; fi
fi

# ---------------------------------------------------------------- T3
# --wrap teeth -- alloc 50 (holds 1.5 s) -> child's 0, journal peak_rss_mb > 0.
if want T3; then
begin T3
bounded 15 t3 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t3 -- "$LPY" "$TMP/alloc.py" 50 1.5
pk=$(jrec "$LOG" -1 peak_rss_mb); lim=$(jrec "$LOG" -1 limit); ex=$(jrec "$LOG" -1 exit)
if [ $BRC -ne 0 ]; then fail T3 "exit $BRC, want 0"; show "$TMP/t3.err"
elif [ "$ex" != 0 ] || [ "$lim" != null ]; then fail T3 "journal exit=$ex limit=$lim, want 0/null"
elif ! "$LPY" -c 'import sys; sys.exit(0 if float(sys.argv[1]) > 0 else 1)' "$pk"; then fail T3 "journal peak_rss_mb=$pk"
else pass T3 "exit 0, journal peak_rss_mb=$pk limit=null"; fi
fi

# ---------------------------------------------------------------- T4 T5 T6
# A fixture with the canonical prologue, run bare (no marker in its env), sees
# RUNLIMITS_ACTIVE and its ancestor is that supervisor.
prologue_tooth() { # tooth tag cmd...
    local tooth=$1 tag=$2 msg; shift 2
    begin "$tooth"
    if [ $FIXOK != 1 ]; then fail "$tooth" "fixtures not built"; return; fi
    bounded 15 "$tag" env -u RUNLIMITS_ACTIVE RUNLIMITS_HOME="$UT" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$@" "$TMP/$tag.json"
    if [ $BRC -ne 0 ]; then fail "$tooth" "fixture exit $BRC"; show "$TMP/$tag.err"; return; fi
    if msg=$(chain_check "$TMP/$tag.json" 1); then pass "$tooth" "$msg"; else fail "$tooth" "$msg"; fi
}
if want T4; then prologue_tooth T4 t4 "$BASHBIN" "$FIX/probe.sh"; fi
if want T5; then prologue_tooth T5 t5 "$LPY" "$FIX/probe.py"; fi
if want T6; then prologue_tooth T6 t6 "$NODE" "$FIX/probe.mjs"; fi

# ---------------------------------------------------------------- T7
# bash fixture with prologue calls a python fixture with prologue -> one supervisor.
if want T7; then prologue_tooth T7 t7 "$BASHBIN" "$FIX/nest.sh"; fi

# ---------------------------------------------------------------- T8
# leaked marker: (a) pid of a live supervisor that is not an ancestor, (b) pid
# of an ancestor that is not a supervisor -> the fixture wraps itself anyway.
if want T8; then
begin T8
if [ $FIXOK != 1 ]; then fail T8 "fixtures not built"
else
    env RUNLIMITS_LOG_DIR="$LOG" "$LPY" "$SUP" --wrap unit --label leak -- "$LPY" "$TMP/alloc.py" 1 20 >"$TMP/t8leak.out" 2>&1 &
    leak=$!; save_pid "$TMP/t8leak.pid" "$leak"; sleep 1
    lcmd=$(ps -o command= -p "$leak")
    bounded 15 t8a env RUNLIMITS_ACTIVE="$leak:teeth" RUNLIMITS_HOME="$UT" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$BASHBIN" "$FIX/probe.sh" "$TMP/t8a.json"
    rca=$BRC
    bounded 15 t8b env RUNLIMITS_ACTIVE="$TEETH_PID:teeth" RUNLIMITS_HOME="$UT" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$BASHBIN" "$FIX/probe.sh" "$TMP/t8b.json"
    rcb=$BRC
    case "$lcmd" in
        *"runlimits.py --wrap"*)
            if [ $rca -ne 0 ] || [ $rcb -ne 0 ]; then fail T8 "fixture exits $rca/$rcb"; show "$TMP/t8a.err"; show "$TMP/t8b.err"
            elif ! ma=$(chain_check "$TMP/t8a.json" 1 "$leak"); then fail T8 "(a) live non-ancestor supervisor $leak: $ma"
            elif ! mb=$(chain_check "$TMP/t8b.json" 1 "$TEETH_PID"); then fail T8 "(b) ancestor non-supervisor $TEETH_PID: $mb"
            else pass T8 "(a) leaked pid $leak (live supervisor, not an ancestor): $ma; (b) leaked pid $TEETH_PID (ancestor, not a supervisor): $mb"; fi ;;
        *) fail T8 "leak supervisor $leak not running as a supervisor (argv: $lcmd)"; show "$TMP/t8leak.out" ;;
    esac
    kill -TERM "$leak"; wait "$leak"
fi
kill_loads
fi

# ---------------------------------------------------------------- T9
# run_child from a runner: (a) the 300 MB child is killed with 86, the runner
# lives; (b) runner under a 150 MB cap with a 140 MB child is not killed (the
# nested supervisor's subtree is excluded from the parent's sum).
if want T9; then
begin T9
cat >"$TMP/runner.py" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
import runlimits
mode, lpy, alloc, out = sys.argv[2:6]
if mode == "a":
    r = runlimits.run_child([lpy, alloc, "300", "20"], "teeth")
else:
    r = runlimits.run_child([lpy, alloc, "140", "0.8"], "teeth")
with open(out, "w") as f:
    f.write(str(r.returncode))
PY
bounded 25 t9a env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t9a -- "$LPY" "$TMP/runner.py" "$UT" a "$LPY" "$TMP/alloc.py" "$TMP/t9a.rc"
rca=$BRC; cra=$(cat "$TMP/t9a.rc" 2>&1)
bounded 25 t9b env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t9b -- "$LPY" "$TMP/runner.py" "$UT" b "$LPY" "$TMP/alloc.py" "$TMP/t9b.rc"
rcb=$BRC; crb=$(cat "$TMP/t9b.rc" 2>&1)
by9=$(jfind "$LOG" exit 86 by)
if [ $rca -ne 0 ] || [ "$cra" != 86 ]; then fail T9 "(a) runner exit $rca, child code '$cra' (want 0 / 86)"; show "$TMP/t9a.err"
elif [ "$by9" != "$WANT_BY" ]; then fail T9 "(a) journal record exit=86 has by=$by9, want $WANT_BY"; show "$TMP/t9a.err"
elif [ $rcb -ne 0 ] || [ "$crb" != 0 ]; then fail T9 "(b) runner exit $rcb, child code '$crb' (want 0 / 0: nested subtree counted in the parent?)"; show "$TMP/t9b.err"
else pass T9 "(a) child killed with 86 by=$by9, runner exit 0; (b) runner under 150 MB with a 140 MB nested child: exit 0"; fi
kill_loads
fi

# ---------------------------------------------------------------- T10
# pool('teeth') -> at most max_parallel children alive at once (file counter).
if want T10; then
begin T10
cat >"$TMP/worker.py" <<'PY'
import glob, os, sys, time
d = sys.argv[1]
me = os.path.join(d, "live.%d" % os.getpid())
open(me, "w").close()
peak = 0
for _ in range(8):
    peak = max(peak, len(glob.glob(os.path.join(d, "live.*"))))
    time.sleep(0.1)
with open(os.path.join(d, "seen.%d" % os.getpid()), "w") as f:
    f.write(str(peak))
os.remove(me)
PY
cat >"$TMP/pool.py" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
import runlimits
lpy, worker, d = sys.argv[2:5]
with runlimits.pool("teeth") as ex:
    futs = [ex.submit(runlimits.run_child, [lpy, worker, d], "teeth") for _ in range(6)]
    rcs = [f.result().returncode for f in futs]
print("rcs", " ".join(map(str, rcs)))
PY
D10="$TMP/t10"; mkdir -p "$D10"
bounded 40 t10 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$TMP/pool.py" "$UT" "$LPY" "$TMP/worker.py" "$D10"
msg=$("$LPY" - "$D10" "$MAXPAR" <<'PY'
import glob, os, sys
d, cap = sys.argv[1], int(sys.argv[2])
seen = [int(open(p).read()) for p in glob.glob(os.path.join(d, "seen.*"))]
if len(seen) != 6:
    print("%d of 6 workers reported" % len(seen)); sys.exit(1)
if max(seen) > cap:
    print("%d children alive at once, cap %d" % (max(seen), cap)); sys.exit(1)
if cap > 1 and max(seen) < 2:
    print("parallelism not exercised: max %d alive with cap %d" % (max(seen), cap)); sys.exit(1)
print("6 workers, max %d alive at once, cap %d" % (max(seen), cap))
PY
)
st=$?
if [ $BRC -ne 0 ]; then fail T10 "pool runner exit $BRC"; show "$TMP/t10.err"
elif ! grep -q '^rcs 0 0 0 0 0 0$' "$TMP/t10.out"; then fail T10 "child codes: $(cat "$TMP/t10.out")"
elif [ $st -ne 0 ]; then fail T10 "$msg"
else pass T10 "$msg"; fi
fi

# ---------------------------------------------------------------- T11
# prologue without a reachable library -> 89 and `library not found`:
# (a) RUNLIMITS_HOME names an empty dir; (b) no RUNLIMITS_HOME and the ascent
# from the fixture's own dir finds nothing (needs a dir with no Catalyst
# ancestor; a layout where the temp dir has one prints a named sub-skip).
if want T11; then
begin T11
EMPTY="$TMP/empty"; ISO="$TMP/iso"; mkdir -p "$EMPTY" "$ISO"
ok11=1; det11=""
if [ $FIXOK != 1 ]; then ok11=0; det11="fixtures not built"
else
    for lang in bash python node; do
        case $lang in bash) f=probe.sh; run="$BASHBIN" ;; python) f=probe.py; run="$LPY" ;; node) f=probe.mjs; run="$NODE" ;; esac
        cp "$FIX/$f" "$ISO/$f"
        bounded 15 "t11a-$lang" env -u RUNLIMITS_ACTIVE RUNLIMITS_HOME="$EMPTY" RUNLIMITS_LOG_DIR="$LOG" "$run" "$FIX/$f" "$TMP/t11a-$lang.json"
        if [ $BRC -ne 89 ] || ! grep -q "refused: library not found (searched: .*$EMPTY" "$TMP/t11a-$lang.err"; then
            ok11=0; det11="$det11 (a) $lang exit $BRC: $(tr '\n' ' ' <"$TMP/t11a-$lang.err");"
        else det11="$det11 (a) $lang 89;"; fi
    done
    reach=$("$LPY" - "$ISO" <<'PY'
import os, sys
d = sys.argv[1]
while True:
    for c in (os.path.join(d, "tools", "run-limits"), os.path.join(d, "Catalyst", "tools", "run-limits")):
        if os.path.isfile(os.path.join(c, "runlimits.py")):
            print(c); sys.exit(0)
    if os.path.dirname(d) == d:
        sys.exit(0)
    d = os.path.dirname(d)
PY
)
    if [ -n "$reach" ]; then
        subskip T11 "(b) ascent from $ISO reaches $reach (temp dir layout); (b) not judged here"
    else
        for lang in bash python node; do
            case $lang in bash) f=probe.sh; run="$BASHBIN" ;; python) f=probe.py; run="$LPY" ;; node) f=probe.mjs; run="$NODE" ;; esac
            bounded 15 "t11b-$lang" env -u RUNLIMITS_ACTIVE -u RUNLIMITS_HOME RUNLIMITS_LOG_DIR="$LOG" "$run" "$ISO/$f" "$TMP/t11b-$lang.json"
            if [ $BRC -ne 89 ] || ! grep -q "refused: library not found (searched: $ISO/tools/run-limits" "$TMP/t11b-$lang.err"; then
                ok11=0; det11="$det11 (b) $lang exit $BRC: $(tr '\n' ' ' <"$TMP/t11b-$lang.err");"
            else det11="$det11 (b) $lang 89;"; fi
        done
    fi
fi
if [ $ok11 = 1 ]; then pass T11 "$det11"; else fail T11 "$det11"; fi
fi

# ---------------------------------------------------------------- T12
# the profile table is pinned by digest.
if want T12; then
begin T12
dg=$("$LPY" - "$UT" <<'PY' 2>&1
import hashlib, json, sys
sys.path.insert(0, sys.argv[1])
import runlimits
print(hashlib.sha256(json.dumps(runlimits.PROFILES, sort_keys=True).encode()).hexdigest())
print(json.dumps(runlimits.PROFILES, sort_keys=True))
PY
)
got=$(printf '%s\n' "$dg" | head -1)
if [ "$got" = "$PROFILES_DIGEST" ]; then pass T12 "table digest $got"
else fail T12 "table digest $got, pinned $PROFILES_DIGEST"; printf '%s\n' "$dg" | sed 's/^/  | /'; fi
fi

# ---------------------------------------------------------------- T13 (Linux)
# kernel limit unavailable -> 88 and the child never starts: (a) no systemd-run
# in PATH; (b) systemd-run fails; (c) systemd-run runs the command without a
# scope (the cgroup check must catch it).
if want T13; then
if [ $PLAT = linux ]; then
    begin T13
    B13="$TMP/bin13"; mkdir -p "$B13/a" "$B13/b" "$B13/c"
    ln -s "$LPY" "$B13/a/python3"
    for x in b c; do ln -s "$(command -v systemctl)" "$B13/$x/systemctl"; done
    printf '#!/bin/sh\necho "fake systemd-run failure (teeth)" >&2\nexit 1\n' >"$B13/b/systemd-run"
    printf '#!/bin/sh\nwhile [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done\nshift\nexec "$@"\n' >"$B13/c/systemd-run"
    chmod +x "$B13/b/systemd-run" "$B13/c/systemd-run"
    ok13=1; det13=""
    want13a="systemd-run not found in PATH"; want13b="systemd-run exited 1 before the scope was confirmed"
    want13c="kernel limit not applied: child cgroup "
    for x in a b c; do
        eval "want=\$want13$x"
        rm -f "$TMP/t13$x.pid"
        bounded 20 "t13$x" env PATH="$B13/$x" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label "t13$x" -- "$LPY" "$TMP/alloc.py" 50 5 "$TMP/t13$x.pid"
        if [ $BRC -ne 88 ]; then ok13=0; det13="$det13 ($x) exit $BRC;"; show "$TMP/t13$x.err"
        elif [ -e "$TMP/t13$x.pid" ]; then ok13=0; det13="$det13 ($x) child started without a kernel limit;"
        elif ! grep -qF "RUNLIMITS: t13$x refused: $want" "$TMP/t13$x.err"; then ok13=0; det13="$det13 ($x) no refused line with '$want';"; show "$TMP/t13$x.err"
        else det13="$det13 ($x) 88: $(grep '^RUNLIMITS:' "$TMP/t13$x.err");"; fi
    done
    if [ $ok13 = 1 ]; then pass T13 "$det13"; else fail T13 "$det13"; fi
    kill_loads
else
    skip T13 "linux-only (systemd-run refusal), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T14 (Linux)
# kernel limit: watchdog muted by the test knob, 300 MB child under
# MemoryMax 150M -> killed by the kernel; the supervisor reads the scope's
# oom-kill sign and returns 86, `killed: mem (kernel oom-kill)`, by=kernel.
if want T14; then
if [ $PLAT = linux ]; then
    begin T14
    bounded 25 t14 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_NO_MEM_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t14 -- "$LPY" "$TMP/alloc.py" 300 20 "$TMP/t14.pid"
    lim=$(jrec "$LOG" -1 limit); by=$(jrec "$LOG" -1 by)
    if [ $BRC -ne 86 ]; then fail T14 "exit $BRC, want 86"; show "$TMP/t14.err"
    elif ! grep -q '^RUNLIMITS: t14 killed: mem (kernel oom-kill) > 150 MB (profile teeth)$' "$TMP/t14.err"; then fail T14 "no killed: mem (kernel oom-kill) line"; show "$TMP/t14.err"
    elif grep -q 'killed: mem [0-9]' "$TMP/t14.err"; then fail T14 "watchdog fired although muted"; show "$TMP/t14.err"
    elif [ "$lim" != mem ] || [ "$by" != kernel ]; then fail T14 "journal limit=$lim by=$by, want mem/kernel"
    else pass T14 "exit 86, $(cat "$TMP/t14.err"), journal limit=mem by=kernel"; fi
    kill_loads
else
    skip T14 "linux-only (kernel back limit), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T15
# SIGTERM to the supervisor -> the child tree (a bash and its sleep, both
# ignoring TERM) is dead within 6 s.
if want T15; then
begin T15
cat >"$TMP/term.sh" <<SH
trap '' TERM
sleep 30 &
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$! "$TMP/t15gc.pid"
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$\$ "$TMP/t15c.pid"
wait
SH
env RUNLIMITS_LOG_DIR="$LOG" "$LPY" "$SUP" --wrap unit --label t15 -- "$BASHBIN" "$TMP/term.sh" "$TOKEN" >"$TMP/t15.out" 2>"$TMP/t15.err" &
sp=$!
if ! wait_file "$TMP/t15c.pid" 5 || ! wait_file "$TMP/t15gc.pid" 5; then fail T15 "child tree never started"; show "$TMP/t15.err"; kill -KILL "$sp"; wait "$sp"
else
    c=$(cat "$TMP/t15c.pid"); gc=$(cat "$TMP/t15gc.pid")
    t0=$(now); kill -TERM "$sp"
    if ! wait_pidfile "$TMP/t15c.pid" 6 "$t0" || ! wait_pidfile "$TMP/t15gc.pid" 6 "$t0"; then
        fail T15 "tree alive 6 s after SIGTERM (child $c alive=$(alive "$c" && echo y || echo n), grandchild $gc alive=$(alive "$gc" && echo y || echo n))"
        kill -KILL "$sp"; signal_file KILL "$TMP/t15c.pid" "$TMP/t15.err"; signal_file KILL "$TMP/t15gc.pid" "$TMP/t15.err"; wait "$sp"
    else
        d=$(secs_between "$t0" "$(now)")
        wait "$sp"; src=$?
        if [ $src -ne 137 ]; then fail T15 "tree dead after $d s but supervisor exit $src (want 137: child killed by SIGKILL)"; show "$TMP/t15.err"
        else pass T15 "TERM-ignoring tree dead $d s after SIGTERM, supervisor exit $src"; fi
    fi
fi
rm -f "$TMP/t15c.pid" "$TMP/t15gc.pid"
fi

# ---------------------------------------------------------------- T16..T20 census guard
# guard <tag> args... -> BRC, output in $TMP/<tag>.out/.err
# census-guard.py carries a prologue: RUNLIMITS_HOME lets a mutant copy find the library.
guard() { local tag=$1; shift; bounded 60 "$tag" env RUNLIMITS_HOME="$UT" "$LPY" "$GUARD" "$@"; }
has_summary() { grep -qx "census-guard: $2" "$TMP/$1.out"; }
CG="$TMP/cg"; mkdir -p "$CG"

if want T16; then
begin T16
mkdir -p "$CG/t16"
printf '#!/usr/bin/env bash\n# RUNLIMITS-PROLOGUE v1 profile=unit\nnode --test x.mjs\n' >"$CG/t16/a.sh"
guard t16 --root "$CG/t16"; rc=$BRC
guard t16l --root "$CG/t16" --list; rcl=$BRC
if [ $rc -ne 0 ]; then fail T16 "exit $rc, want 0"; show "$TMP/t16.out"; show "$TMP/t16.err"
elif ! has_summary t16 "1 entry points (1 by form, 0 declared), 1 with prologue, 0 allowlisted, 0 excluded, 0 violations"; then fail T16 "summary: $(tail -1 "$TMP/t16.out")"
elif [ $rcl -ne 0 ] || ! grep -q "a.sh:3 .*profile=unit" "$TMP/t16l.out"; then fail T16 "--list exit $rcl without 'a.sh:3 ... profile=unit'"; show "$TMP/t16l.out"
else pass T16 "prologue present: exit 0, $(tail -1 "$TMP/t16.out")"; fi
fi

if want T17; then
begin T17
mkdir -p "$CG/t17"
# a comment that names the marker mid-line is not a prologue: only an exact
# match counts, a substring search (M16) would accept it
printf '#!/usr/bin/env bash\nD=x\n"$BIN" plugin test "$D"\n# see RUNLIMITS-PROLOGUE v1 profile=unit in the docs\n' >"$CG/t17/b.sh"
# the marker text inside a string literal is not a prologue
printf 'import subprocess\nMARK = "RUNLIMITS-PROLOGUE v1 profile=unit"\nsubprocess.run(["pytest", "-q"])\n' >"$CG/t17/b2.py"
# claude -p across a line continuation
printf '#!/usr/bin/env bash\n"$CLAUDE_BIN" \\\n  -p "hello"\n' >"$CG/t17/b3.sh"
guard t17 --root "$CG/t17"; rc=$BRC
if [ $rc -ne 1 ]; then fail T17 "exit $rc, want 1"; show "$TMP/t17.out"; show "$TMP/t17.err"
elif ! grep -q "b.sh:3" "$TMP/t17.out" || ! grep -q "b2.py:3" "$TMP/t17.out" || ! grep -q "b3.sh:2" "$TMP/t17.out"; then fail T17 "violation lines b.sh:3 / b2.py:3 / b3.sh:2 missing"; show "$TMP/t17.out"
elif ! has_summary t17 "3 entry points (3 by form, 0 declared), 0 with prologue, 0 allowlisted, 0 excluded, 3 violations"; then fail T17 "summary: $(tail -1 "$TMP/t17.out")"; show "$TMP/t17.out"
else pass T17 "no prologue (marker in a string does not count): exit 1, $(grep -c '^VIOLATION' "$TMP/t17.out") VIOLATION lines incl. $(grep -o 'b.sh:3' "$TMP/t17.out")"; fi
fi

if want T18; then
begin T18
mkdir -p "$CG/t18"
printf '#!/usr/bin/env bash\nHERE=$(dirname "$0")\nbash "$HERE/d.sh"\n' >"$CG/t18/c.sh"
printf '#!/usr/bin/env bash\n# RUNLIMITS-PROLOGUE v1 profile=unit\nbun test\n' >"$CG/t18/d.sh"
printf 'import os, subprocess\nHERE = os.path.dirname(__file__)\nsubprocess.run(["bash", os.path.join(HERE, "c.sh")])\n' >"$CG/t18/e.py"
# mentions that are not calls: file read as data, script from stdin, interpreter on another line
printf 'import os\nHERE = os.path.dirname(__file__)\nsh = open(os.path.join(HERE, "d.sh")).read()\n' >"$CG/t18/n1.py"
printf '#!/usr/bin/env bash\npython3 - "$HERE/d.sh" <<'"'"'PY'"'"'\nprint(1)\nPY\n' >"$CG/t18/n2.sh"
printf '#!/usr/bin/env bash\nbash -n "$0"\necho "see d.sh"\n' >"$CG/t18/n3.sh"
# python: importing a sibling module runs its code in this process (import os has no sibling)
printf 'import os\nimport dh\ndh.go()\n' >"$CG/t18/g.py"
printf 'import subprocess\ndef go():\n    subprocess.run(["claude", "-p", "x"])\n' >"$CG/t18/dh.py"
guard t18 --root "$CG/t18"; rc=$BRC
if [ $rc -ne 1 ]; then fail T18 "exit $rc, want 1"; show "$TMP/t18.out"; show "$TMP/t18.err"
elif ! grep -q "c.sh:3" "$TMP/t18.out" || ! grep -q "e.py:3" "$TMP/t18.out" || ! grep -q "g.py:2" "$TMP/t18.out"; then fail T18 "closure lines c.sh:3 / e.py:3 / g.py:2 missing"; show "$TMP/t18.out"
elif ! has_summary t18 "5 entry points (5 by form, 0 declared), 1 with prologue, 0 allowlisted, 0 excluded, 4 violations"; then fail T18 "summary: $(tail -1 "$TMP/t18.out")"; show "$TMP/t18.out"
else pass T18 "closure: exit 1, $(tail -1 "$TMP/t18.out")"; fi
fi

if want T19; then
begin T19
mkdir -p "$CG/t19"
printf '#!/usr/bin/env bash\n# claude -p "hi"\necho ok  # bun test\n' >"$CG/t19/f.sh"
printf 'plugin test\nnode --test x\n' >"$CG/t19/g.md"
printf '"""run pytest and node --test here"""\n# bun test\nx = 1  # vitest\n' >"$CG/t19/h.py"
printf '// vitest run\n/* jest\n systemd-run */\nconst a = 1;\n' >"$CG/t19/i.mjs"
printf '#!/usr/bin/env bash\n# RUNLIMITS-PROLOGUE v1 profile=unit\npytest -q\n' >"$CG/t19/k.sh"
# a variable named CLAUDE_* and an unrelated -p on the next line; -p before a path ending in claude
printf '#!/usr/bin/env bash\nSIGN=${CLAUDE_PATCH_SIGN_ID:-}\nmkdir -p "$d"\ncp -p "$X" "$d/claude"\n' >"$CG/t19/m.sh"
guard t19 --root "$CG/t19"; rc=$BRC
if [ $rc -ne 0 ]; then fail T19 "exit $rc, want 0"; show "$TMP/t19.out"; show "$TMP/t19.err"
elif ! has_summary t19 "1 entry points (1 by form, 0 declared), 1 with prologue, 0 allowlisted, 0 excluded, 0 violations"; then fail T19 "summary: $(tail -1 "$TMP/t19.out")"; show "$TMP/t19.out"
else pass T19 "forms only in comments/markdown/docstring are not entry points: $(tail -1 "$TMP/t19.out")"; fi
fi

if want T20; then
begin T20
mkdir -p "$CG/t20"
printf '#!/usr/bin/env bash\npytest -q\n' >"$CG/t20/l.sh"
printf 't20/l.sh\tfixture: named with a reason\n' >"$CG/t20.allow"
printf 't20/l.sh\n' >"$CG/t20.noreason"
guard t20 --root "$CG/t20" --allowlist "$CG/t20.allow"; rc=$BRC
guard t20n --root "$CG/t20" --allowlist "$CG/t20.noreason"; rcn=$BRC
guard t20r --root "$CG/does-not-exist"; rcr=$BRC
if [ $rc -ne 0 ]; then fail T20 "exit $rc, want 0"; show "$TMP/t20.out"; show "$TMP/t20.err"
elif ! has_summary t20 "1 entry points (1 by form, 0 declared), 0 with prologue, 1 allowlisted, 0 excluded, 0 violations"; then fail T20 "summary: $(tail -1 "$TMP/t20.out")"
elif [ $rcn -ne 2 ]; then fail T20 "allowlist line without a reason: exit $rcn, want 2"
elif [ $rcr -ne 2 ]; then fail T20 "missing root: exit $rcr, want 2"
else pass T20 "allowlist with reason: exit 0, $(tail -1 "$TMP/t20.out"); no reason -> 2; missing root -> 2"; fi
fi

# ---------------------------------------------------------------- T21
# ps fails: (a) before the start -> 88, child never started; (b) mid-run ->
# 88, the tree is killed.
FLAG="$TMP/t21.flag"
printf '#!/bin/sh\nif [ -e "%s" ]; then echo "fake ps failure (teeth)" >&2; exit 1; fi\nexec ps "$@"\n' "$FLAG" >"$TMP/fake-ps.sh"
chmod +x "$TMP/fake-ps.sh"
if want T21; then
begin T21
touch "$FLAG"
bounded 15 t21a env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_PS="$TMP/fake-ps.sh" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t21a -- "$LPY" "$TMP/alloc.py" 50 20 "$TMP/t21a.pid"
rca=$BRC
rm -f "$FLAG"
env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_PS="$TMP/fake-ps.sh" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t21b -- "$LPY" "$TMP/alloc.py" 50 20 "$TMP/t21b.pid" >"$TMP/t21b.out" 2>"$TMP/t21b.err" &
sp=$!
if [ $rca -ne 88 ]; then fail T21 "(a) exit $rca, want 88"; show "$TMP/t21a.err"; kill -KILL "$sp"; wait "$sp"
elif [ -e "$TMP/t21a.pid" ]; then fail T21 "(a) child started although ps failed"; kill -KILL "$sp"; wait "$sp"
elif ! grep -q '^RUNLIMITS: t21a refused: cannot measure: .* (child not started)$' "$TMP/t21a.err"; then fail T21 "(a) not refused before the start"; show "$TMP/t21a.err"; kill -KILL "$sp"; wait "$sp"
elif ! wait_file "$TMP/t21b.pid" 3; then fail T21 "(b) child never started"; show "$TMP/t21b.err"; kill -KILL "$sp"; wait "$sp"
else
    c=$(cat "$TMP/t21b.pid"); t0=$(now); touch "$FLAG"
    if ! wait_pidfile "$TMP/t21b.pid" 6 "$t0"; then fail T21 "(b) child $c alive 6 s after ps began failing"; kill -KILL "$sp"; wait "$sp"
    else
        wait "$sp"; rcb=$?
        lim=$(jrec "$LOG" -1 limit)
        if [ $rcb -ne 88 ]; then fail T21 "(b) exit $rcb, want 88"; show "$TMP/t21b.err"
        elif ! grep -q '^RUNLIMITS: t21b refused: ' "$TMP/t21b.err"; then fail T21 "(b) no refused line"; show "$TMP/t21b.err"
        elif [ "$lim" != unavailable ]; then fail T21 "(b) journal limit=$lim, want unavailable"
        else pass T21 "(a) 88, $(grep '^RUNLIMITS:' "$TMP/t21a.err"); (b) 88, child killed: $(grep '^RUNLIMITS:' "$TMP/t21b.err")"; fi
    fi
fi
kill_loads
fi

# ---------------------------------------------------------------- T22
# combat mode: profile teeth does not exist (no RUNLIMITS_LOG_DIR, or it names
# the combat dir) and test knobs are ignored; an unknown profile -> 88.
if want T22; then
begin T22
H="$TMP/home"; mkdir -p "$H"
bounded 15 t22a env -u RUNLIMITS_LOG_DIR HOME="$H" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t22a -- true; ra=$BRC
bounded 15 t22b env HOME="$H" RUNLIMITS_LOG_DIR="$H/.local/state/run-limits" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t22b -- true; rb=$BRC
bounded 15 t22c env RUNLIMITS_LOG_DIR="$LOG" "$LPY" "$SUP" --wrap nosuch --label t22c -- true; rc=$BRC
touch "$FLAG"
bounded 15 t22d env -u RUNLIMITS_LOG_DIR HOME="$H" RUNLIMITS_TEST_PS="$TMP/fake-ps.sh" "$LPY" "$SUP" --wrap runner --label t22d -- true; rd=$BRC
rm -f "$FLAG"
cj=$(jrec "$H/.local/state/run-limits" -1 label)
lc=$(jrec "$LOG" -1 limit)
if [ $ra -ne 88 ] || ! grep -q "^RUNLIMITS: t22a refused: unknown profile teeth" "$TMP/t22a.err"; then fail T22 "combat --wrap teeth: exit $ra"; show "$TMP/t22a.err"
elif [ $rb -ne 88 ]; then fail T22 "RUNLIMITS_LOG_DIR = combat dir, --wrap teeth: exit $rb"; show "$TMP/t22b.err"
elif [ $rc -ne 88 ] || [ "$lc" != unavailable ]; then fail T22 "unknown profile: exit $rc, journal limit=$lc"; show "$TMP/t22c.err"
elif [ $rd -ne 0 ]; then fail T22 "combat run with a failing RUNLIMITS_TEST_PS: exit $rd (knob honoured?)"; show "$TMP/t22d.err"
elif [ "$cj" != t22d ]; then fail T22 "combat journal under HOME has last label '$cj', want t22d"
else pass T22 "teeth absent in combat (88, 88), unknown profile 88 limit=unavailable, test knob ignored in combat (exit 0, combat journal written)"; fi
fi

# ---------------------------------------------------------------- T23
# journal: rotation to .1 at the size threshold; an unwritable log dir costs
# one stderr line and does not fail the run.
if want T23; then
begin T23
for i in 1 2 3 4; do
    bounded 15 "t23-$i" env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_ROTATE_BYTES=300 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label "t23-$i" -- true
done
rr=$BRC
mkdir -p "$TMP/nowrite"; testmark "$TMP/nowrite"; chmod 0555 "$TMP/nowrite"
bounded 15 t23w env RUNLIMITS_LOG_DIR="$TMP/nowrite" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t23w -- true; rw=$BRC
chmod 0755 "$TMP/nowrite"  # 0555 blocks the suite's own rm -rf of $TMP
nw=$(grep -c '^RUNLIMITS: journal write failed' "$TMP/t23w.err")
msg=$("$LPY" - "$LOG" <<'PY'
import json, os, sys
d = sys.argv[1]
cur, old, older = (os.path.join(d, n) for n in ("runs.jsonl", "runs.jsonl.1", "runs.jsonl.2"))
if not os.path.exists(old):
    print("no runs.jsonl.1"); sys.exit(1)
if os.path.exists(older):
    print("runs.jsonl.2 exists"); sys.exit(1)
a = [json.loads(l) for l in open(old).read().splitlines() if l.strip()]
b = [json.loads(l) for l in open(cur).read().splitlines() if l.strip()] if os.path.exists(cur) else []
if not b or b[-1]["label"] != "t23-4":
    print("current journal does not end with the last run: %r" % [r["label"] for r in b]); sys.exit(1)
if len(a) + len(b) > 4 or os.path.getsize(old) < 300:
    print("rotation threshold not honoured: .1 %d B %d recs, current %d recs" % (os.path.getsize(old), len(a), len(b))); sys.exit(1)
print("rotated: .1 %d recs, current %d recs" % (len(a), len(b)))
PY
)
st=$?
if [ $rr -ne 0 ]; then fail T23 "run exit $rr"; show "$TMP/t23-4.err"
elif [ $st -ne 0 ]; then fail T23 "$msg"
elif [ $rw -ne 0 ]; then fail T23 "unwritable log dir failed the run: exit $rw"; show "$TMP/t23w.err"
elif [ "$nw" != 1 ]; then fail T23 "unwritable log dir: $nw 'journal write failed' lines, want 1"; show "$TMP/t23w.err"
else pass T23 "$msg; unwritable dir: exit 0, one stderr line"; fi
fi

# ---------------------------------------------------------------- T24
# a SIGKILL the supervisor did not send, without a proven oom-kill -> the
# child's 137 and a named `killed: SIGKILL not sent by the supervisor, cause
# unverified (...)` line (no source it did not prove),
# journal limit=unverified: (a) the child SIGKILLs itself; (b) Linux: a real
# kernel oom-kill whose sign the test seam makes unreadable (time budget 30 s by
# RUNLIMITS_TEST_TIME_S: the budget runs from the supervisor's start, scope setup
# included, and a loaded host ate the profile's 3 s before the kernel's kill); (c) the child
# SIGKILLs itself and leaves a TERM-ignoring survivor, which the supervisor
# must SIGKILL (its own SIGKILL to the survivor does not explain the child's).
if want T24; then
begin T24
ok24=1; det24=""
bounded 15 t24a env RUNLIMITS_LOG_DIR="$(sublog "$LOG/a")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t24a -- "$LPY" -c 'import os, signal; os.kill(os.getpid(), signal.SIGKILL)'
lim=$(jrec "$LOG/a" -1 limit); ex=$(jrec "$LOG/a" -1 exit)
if [ $BRC -ne 137 ] || ! grep -q '^RUNLIMITS: t24a killed: SIGKILL not sent by the supervisor, cause unverified (.*)$' "$TMP/t24a.err" || [ "$lim" != unverified ] || [ "$ex" != 137 ]; then
    ok24=0; det24="(a) exit $BRC, journal limit=$lim exit=$ex: $(tr '\n' ' ' <"$TMP/t24a.err");"
else det24="(a) 137, $(grep '^RUNLIMITS:' "$TMP/t24a.err");"; fi
if [ $PLAT = linux ]; then
    bounded 25 t24b env RUNLIMITS_LOG_DIR="$(sublog "$LOG/b")" RUNLIMITS_TEST_NO_MEM_WATCH=1 RUNLIMITS_TEST_OOM_SIGN=unreadable RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t24b -- "$LPY" "$TMP/alloc.py" 300 20 "$TMP/t24b.pid"
    lim=$(jrec "$LOG/b" -1 limit)
    if [ $BRC -ne 137 ] || ! grep -q '^RUNLIMITS: t24b killed: SIGKILL not sent by the supervisor, cause unverified (.*RUNLIMITS_TEST_OOM_SIGN.*)$' "$TMP/t24b.err" || [ "$lim" != unverified ]; then
        ok24=0; det24="$det24 (b) exit $BRC, journal limit=$lim: $(tr '\n' ' ' <"$TMP/t24b.err");"
    else det24="$det24 (b) 137, $(grep '^RUNLIMITS:' "$TMP/t24b.err");"; fi
    kill_loads
else
    subskip T24 "(b) linux-only (kernel oom-kill with the sign unreadable)"
fi
cat >"$TMP/t24c.sh" <<SH
( trap '' TERM; exec "$LPY" "$TMP/alloc.py" 1 20 "$TMP/t24c.pid" ) &
while [ ! -s "$TMP/t24c.pid" ]; do sleep 0.05; done
kill -KILL \$\$
SH
bounded 20 t24c env RUNLIMITS_LOG_DIR="$(sublog "$LOG/c")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t24c -- "$BASHBIN" "$TMP/t24c.sh"
lim=$(jrec "$LOG/c" -1 limit); sk=$(jrec "$LOG/c" -1 survivors_killed)
if [ $BRC -ne 137 ] || ! grep -q '^RUNLIMITS: t24c killed: SIGKILL not sent by the supervisor, cause unverified (.*)$' "$TMP/t24c.err" || [ "$lim" != unverified ]; then
    ok24=0; det24="$det24 (c) exit $BRC, journal limit=$lim survivors_killed=$sk: $(tr '\n' ' ' <"$TMP/t24c.err");"
elif [ ! -s "$TMP/t24c.pid" ] || ! wait_pidfile "$TMP/t24c.pid" 1; then ok24=0; det24="$det24 (c) TERM-ignoring survivor alive after the supervisor exited;"
elif [ "$sk" = MISSING ] || [ "$sk" -lt 1 ]; then ok24=0; det24="$det24 (c) journal survivors_killed=$sk, want >= 1;"
else det24="$det24 (c) 137 with a SIGKILLed survivor (survivors_killed=$sk), $(grep '^RUNLIMITS:' "$TMP/t24c.err");"; fi
kill_loads
if [ $ok24 = 1 ]; then pass T24 "$det24"; else fail T24 "$det24"; fi
fi

# ---------------------------------------------------------------- T25
# the supervisor's parent is gone -> the tree dies: (a) the supervisor's parent
# gets SIGKILL -> a TERM-ignoring child tree is dead within 8 s, `killed:
# parent gone (set RUNLIMITS_DETACH=1 to detach)`, journal limit=parent-gone
# exit=143 detached=false; (b) the node prologue forwards SIGTERM to its
# supervisor -> the tree is dead within 8 s, node exits 143, the supervisor
# journals a forwarded signal (limit=null), not parent-gone; (c) with
# RUNLIMITS_DETACH=1 the parent's SIGKILL does not end the run: the child lives
# to its own end, the supervisor exits with its 0, journal detached=true.
if want T25; then
begin T25
ok25=1; det25=""
cat >"$TMP/launcher.py" <<'PY'
import subprocess, sys, time
p = subprocess.Popen(sys.argv[2:])
with open(sys.argv[1], "w") as f:
    __import__("fixture_pid").record_pid(f.name, p.pid)
time.sleep(60)
PY
cat >"$TMP/term25.sh" <<SH
trap '' TERM
sleep 30 &
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$! "$TMP/t25gc.pid"
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$\$ "$TMP/t25c.pid"
wait
SH
"$LPY" "$TMP/launcher.py" "$TMP/t25s.pid" env RUNLIMITS_LOG_DIR="$(sublog "$LOG/a")" "$LPY" "$SUP" --wrap unit --label t25 -- "$BASHBIN" "$TMP/term25.sh" "$TOKEN" >"$TMP/t25.out" 2>"$TMP/t25.err" &
lp=$!
if ! wait_file "$TMP/t25c.pid" 5 || ! wait_file "$TMP/t25gc.pid" 5 || ! wait_file "$TMP/t25s.pid" 5; then
    ok25=0; det25="(a) child tree never started: $(tr '\n' ' ' <"$TMP/t25.err");"; kill -KILL "$lp"; wait "$lp"
else
    c=$(cat "$TMP/t25c.pid"); gc=$(cat "$TMP/t25gc.pid"); s25=$(cat "$TMP/t25s.pid")
    t0=$(now); kill -KILL "$lp"; wait "$lp"
    if ! wait_pidfile "$TMP/t25c.pid" 8 "$t0" || ! wait_pidfile "$TMP/t25gc.pid" 8 "$t0"; then
        ok25=0; det25="(a) tree alive 8 s after the parent died (child alive=$(alive "$c" && echo y || echo n), grandchild alive=$(alive "$gc" && echo y || echo n), supervisor alive=$(alive "$s25" && echo y || echo n));"
        for f in "$TMP/t25s.pid" "$TMP/t25c.pid" "$TMP/t25gc.pid"; do signal_file KILL "$f" "$TMP/t25.err"; done
    else
        d=$(secs_between "$t0" "$(now)")
        if ! wait_pidfile "$TMP/t25s.pid" 5; then ok25=0; det25="(a) supervisor $s25 alive 5 s after its tree died;"; signal_file KILL "$TMP/t25s.pid" "$TMP/t25.err"
        else
            lim=$(jrec "$LOG/a" -1 limit); ex=$(jrec "$LOG/a" -1 exit); dt=$(jrec "$LOG/a" -1 detached)
            if ! grep -q '^RUNLIMITS: t25 killed: parent gone (set RUNLIMITS_DETACH=1 to detach)$' "$TMP/t25.err" || [ "$lim" != parent-gone ] || [ "$ex" != 143 ] || [ "$dt" != False ]; then
                ok25=0; det25="(a) tree dead after $d s, journal limit=$lim exit=$ex detached=$dt: $(tr '\n' ' ' <"$TMP/t25.err");"
            else det25="(a) tree dead $d s after SIGKILL of the parent, journal limit=parent-gone exit=143;"; fi
        fi
    fi
fi
cat >"$TMP/body.term" <<JS
import { spawnSync as _ss2 } from 'node:child_process';
_ss2('sh', ['-c', '"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$\$ "\$0"; exec sleep 30', process.argv[2]], { stdio: 'inherit' });
JS
if [ $FIXOK != 1 ] || ! mkfix node "$FIX/term.mjs" "$TMP/body.term"; then ok25=0; det25="$det25 (b) fixture not built;"
else
    env -u RUNLIMITS_ACTIVE RUNLIMITS_HOME="$UT" RUNLIMITS_LOG_DIR="$(sublog "$LOG/b")" RUNLIMITS_TEST_TIME_S=30 "$NODE" "$FIX/term.mjs" "$TMP/t25b.pid" >"$TMP/t25b.out" 2>"$TMP/t25b.err" &
    np=$!
    if ! wait_file "$TMP/t25b.pid" 5; then ok25=0; det25="$det25 (b) child never started: $(tr '\n' ' ' <"$TMP/t25b.err");"; kill -KILL "$np"; wait "$np"
    else
        sl=$(cat "$TMP/t25b.pid"); t0=$(now); kill -TERM "$np"
        if ! wait_pidfile "$TMP/t25b.pid" 8 "$t0"; then ok25=0; det25="$det25 (b) sleep $sl alive 8 s after SIGTERM to node;"; signal_file KILL "$TMP/t25b.pid" "$TMP/t25b.err"; kill -KILL "$np"; wait "$np"
        else
            wait "$np"; nrc=$?
            lim=$(jrec "$LOG/b" -1 limit); ex=$(jrec "$LOG/b" -1 exit)
            if [ $nrc -ne 143 ] || [ "$lim" != null ] || [ "$ex" != 143 ]; then
                ok25=0; det25="$det25 (b) node exit $nrc, journal limit=$lim exit=$ex (want 143 / null / 143: SIGTERM forwarded, not parent-gone): $(tr '\n' ' ' <"$TMP/t25b.err");"
            else det25="$det25 (b) SIGTERM forwarded: node exit 143, journal limit=null exit=143;"; fi
        fi
    fi
fi
cat >"$TMP/detach25.sh" <<SH
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$\$ "$TMP/t25d.pid"
sleep 2
echo done >"$TMP/t25d.done"
SH
"$LPY" "$TMP/launcher.py" "$TMP/t25ds.pid" env RUNLIMITS_DETACH=1 RUNLIMITS_LOG_DIR="$(sublog "$LOG/c")" "$LPY" "$SUP" --wrap unit --label t25c -- "$BASHBIN" "$TMP/detach25.sh" "$TOKEN" >"$TMP/t25c.out" 2>"$TMP/t25c.err" &
lp=$!
if ! wait_file "$TMP/t25d.pid" 5 || ! wait_file "$TMP/t25ds.pid" 5; then
    ok25=0; det25="$det25 (c) child never started: $(tr '\n' ' ' <"$TMP/t25c.err");"; kill -KILL "$lp"; wait "$lp"
else
    s25=$(cat "$TMP/t25ds.pid"); kill -KILL "$lp"; wait "$lp"
    if ! wait_pidfile "$TMP/t25ds.pid" 8; then ok25=0; det25="$det25 (c) supervisor $s25 alive 8 s after the parent died;"; signal_file KILL "$TMP/t25ds.pid" "$TMP/t25c.err"; signal_file KILL "$TMP/t25d.pid" "$TMP/t25c.err"
    else
        lim=$(jrec "$LOG/c" -1 limit); ex=$(jrec "$LOG/c" -1 exit); dt=$(jrec "$LOG/c" -1 detached)
        if [ ! -s "$TMP/t25d.done" ] || [ "$lim" != null ] || [ "$ex" != 0 ] || [ "$dt" != True ]; then
            ok25=0; det25="$det25 (c) detached run: child done=$([ -s "$TMP/t25d.done" ] && echo y || echo n), journal limit=$lim exit=$ex detached=$dt: $(tr '\n' ' ' <"$TMP/t25c.err");"
        else det25="$det25 (c) RUNLIMITS_DETACH=1: parent SIGKILLed, child ran to its end, journal exit=0 detached=true;"; fi
    fi
fi
if [ $ok25 = 1 ]; then pass T25 "$det25"; else fail T25 "$det25"; fi
rm -f "$TMP/t25c.pid" "$TMP/t25gc.pid" "$TMP/t25s.pid" "$TMP/t25b.pid" "$TMP/t25d.pid" "$TMP/t25ds.pid"
fi

# ---------------------------------------------------------------- T26
# processes left after the child exits are killed and counted
# (survivors_killed >= 1): (a) a double-forked process that no ps snapshot of
# the tree holds (darwin: the child's process group or the RUNLIMITS_TREE token;
# Linux: the scope); (b) a process that left the child's process group (darwin:
# the last ps snapshot; Linux: the scope); (c) double fork + setsid (Linux: the
# scope; darwin: the token, A15); (d) darwin: the child's own process group
# holds the controlling terminal while it runs and the terminal is given back
# afterwards; (e) a double-forked process that execve-d with an empty
# environment (no token) and stays in the child's process group, never in a
# snapshot of the tree (darwin: only the child's own group finds it - M20;
# Linux: the scope).
if want T26; then
begin T26
ok26=1; det26=""
cat >"$TMP/t26a.sh" <<SH
sleep 0.2
( "$LPY" "$TMP/alloc.py" 1 20 "$TMP/t26a.pid" & )
while [ ! -s "$TMP/t26a.pid" ]; do sleep 0.05; done
exit 0
SH
cat >"$TMP/t26b.sh" <<SH
"$LPY" -c 'import os, sys, time; os.setpgid(0, 0); __import__("fixture_pid").record_pid(sys.argv[1], os.getpid()); time.sleep(20)' "$TMP/t26b.pid" &
while [ ! -s "$TMP/t26b.pid" ]; do sleep 0.05; done
sleep 1.2
exit 0
SH
cat >"$TMP/t26c.sh" <<SH
( "$LPY" -c 'import os, sys, time; os.setsid(); __import__("fixture_pid").record_pid(sys.argv[1], os.getpid()); time.sleep(20)' "$TMP/t26c.pid" & )
while [ ! -s "$TMP/t26c.pid" ]; do sleep 0.05; done
exit 0
SH
cat >"$TMP/t26e.sh" <<SH
sleep 0.2
( "$LPY" -c 'import os, sys; __import__("fixture_pid").record_pid(sys.argv[1], os.getpid()); os.execve("/bin/sleep", ["sleep-" + sys.argv[2], "20"], {})' "$TMP/t26e.pid" "$TOKEN" & )
while [ ! -s "$TMP/t26e.pid" ]; do sleep 0.05; done
exit 0
SH
t26_case() { # sub pidfile
    local sub=$1 pf=$2 p sk
    bounded 20 "t26$sub" env RUNLIMITS_LOG_DIR="$(sublog "$LOG/$sub")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label "t26$sub" -- "$BASHBIN" "$TMP/t26$sub.sh"
    sk=$(jrec "$LOG/$sub" -1 survivors_killed)
    if [ $BRC -ne 0 ]; then ok26=0; det26="$det26 ($sub) exit $BRC: $(tr '\n' ' ' <"$TMP/t26$sub.err");"; return; fi
    if [ ! -s "$pf" ]; then ok26=0; det26="$det26 ($sub) no survivor pid file;"; return; fi
    p=$(cat "$pf")
    if ! wait_pidfile "$pf" 1; then ok26=0; det26="$det26 ($sub) survivor $p alive after the supervisor exited;"; return; fi
    case "$sk" in ''|*[!0-9]*) ok26=0; det26="$det26 ($sub) journal survivors_killed=$sk;"; return ;; esac
    if [ "$sk" -lt 1 ]; then ok26=0; det26="$det26 ($sub) journal survivors_killed=$sk, want >= 1;"; return; fi
    det26="$det26 ($sub) survivor dead, survivors_killed=$sk;"
}
t26_case a "$TMP/t26a.pid"
t26_case b "$TMP/t26b.pid"
t26_case c "$TMP/t26c.pid"
t26_case e "$TMP/t26e.pid"
kill_loads
if [ $PLAT = darwin ]; then
    cat >"$TMP/fg.py" <<'PY'
import os, sys
fd = os.open("/dev/tty", os.O_RDWR)
with open(sys.argv[1], "w") as f:
    f.write("fg" if os.tcgetpgrp(fd) == os.getpgrp() else "bg")
PY
    cat >"$TMP/fgwrap.py" <<'PY'
import os, subprocess, sys
r = subprocess.run(sys.argv[2:])
fd = os.open("/dev/tty", os.O_RDWR)
with open(sys.argv[1], "w") as f:
    f.write("%d %s" % (r.returncode, "fg" if os.tcgetpgrp(fd) == os.getpgrp() else "bg"))
PY
    bounded 20 t26d script -q /dev/null "$LPY" "$TMP/fgwrap.py" "$TMP/t26d.after" env RUNLIMITS_LOG_DIR="$(sublog "$LOG/d")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t26d -- "$LPY" "$TMP/fg.py" "$TMP/t26d.in"
    fgin=$(cat "$TMP/t26d.in" 2>&1); fgaf=$(cat "$TMP/t26d.after" 2>&1)
    if [ "$fgin" != fg ] || [ "$fgaf" != "0 fg" ]; then ok26=0; det26="$det26 (d) child saw '$fgin' (want fg), after the run '$fgaf' (want '0 fg');"; show "$TMP/t26d.out"
    else det26="$det26 (d) child held the terminal, terminal given back;"; fi
else
    subskip T26 "(d) darwin-only (own process group of the child)"
fi
if [ $ok26 = 1 ]; then pass T26 "$det26"; else fail T26 "$det26"; fi
fi

# ---------------------------------------------------------------- T27
# declared entry points (--declared: path TAB profile TAB reason) are judged
# like found ones; a declared path missing on disk -> `stale declaration`, 1;
# a line without a reason -> 2.
if want T27; then
begin T27
mkdir -p "$CG/t27"
printf '#!/usr/bin/env bash\necho root without leaf forms\n' >"$CG/t27/p.sh"
printf '#!/usr/bin/env bash\n# RUNLIMITS-PROLOGUE v1 profile=pipeline\necho ok\n' >"$CG/t27/q.sh"
printf 't27/p.sh\trunner\tfixture root\nt27/q.sh\tpipeline\tfixture root\n' >"$CG/t27.decl"
printf 't27/q.sh\tpipeline\tfixture root\nt27/gone.sh\trunner\tremoved file\n' >"$CG/t27.stale"
printf 't27/p.sh\trunner\n' >"$CG/t27.noreason"
guard t27 --root "$CG/t27" --declared "$CG/t27.decl"; rc=$BRC
guard t27s --root "$CG/t27" --declared "$CG/t27.stale"; rcs=$BRC
guard t27n --root "$CG/t27" --declared "$CG/t27.noreason"; rcn=$BRC
if [ $rc -ne 1 ]; then fail T27 "declared p.sh without prologue: exit $rc, want 1"; show "$TMP/t27.out"; show "$TMP/t27.err"
elif ! grep -q '^VIOLATION .*t27/p.sh:1: declared runner' "$TMP/t27.out" || grep -q 'q.sh' "$TMP/t27.out"; then fail T27 "violation for p.sh (and none for q.sh) missing"; show "$TMP/t27.out"
elif ! has_summary t27 "2 entry points (0 by form, 2 declared), 1 with prologue, 0 allowlisted, 0 excluded, 1 violations"; then fail T27 "summary: $(tail -1 "$TMP/t27.out")"
elif [ $rcs -ne 1 ] || ! grep -q '^VIOLATION .*t27.stale:2: stale declaration .*t27/gone.sh' "$TMP/t27s.out"; then fail T27 "stale declaration: exit $rcs"; show "$TMP/t27s.out"; show "$TMP/t27s.err"
elif ! has_summary t27s "1 entry points (0 by form, 1 declared), 1 with prologue, 0 allowlisted, 0 excluded, 1 violations"; then fail T27 "stale summary: $(tail -1 "$TMP/t27s.out")"
elif [ $rcn -ne 2 ]; then fail T27 "declared line without a reason: exit $rcn, want 2"
else pass T27 "declared: exit 1, $(tail -1 "$TMP/t27.out"); stale: exit 1, $(grep -c 'stale declaration' "$TMP/t27s.out") stale line; no reason -> 2"; fi
fi

# ---------------------------------------------------------------- T28
# excluded copies (--exclude: glob TAB reason) are not judged and are counted;
# a glob matching nothing -> `stale exclusion`, 1; a declared path under an
# exclusion -> `exclusion hides declared entry`, 1; a line without a reason -> 2.
if want T28; then
begin T28
mkdir -p "$CG/t28/orig" "$CG/t28/copies/c1"
printf '#!/usr/bin/env bash\npytest -q\n' >"$CG/t28/orig/r.sh"
cp "$CG/t28/orig/r.sh" "$CG/t28/copies/c1/r.sh"
printf 't28/copies/*/\tfixture copies of orig\n' >"$CG/t28.ex"
printf 't28/copies/*/\tfixture copies of orig\nt28/nomatch-*/\tno such dir\n' >"$CG/t28.exstale"
printf 't28/copies/c1/r.sh\trunner\tdeclared inside an exclusion\n' >"$CG/t28.decl"
printf 't28/copies/*/\n' >"$CG/t28.noreason"
guard t28 --root "$CG/t28" --exclude "$CG/t28.ex"; rc=$BRC
guard t28s --root "$CG/t28" --exclude "$CG/t28.exstale"; rcs=$BRC
guard t28h --root "$CG/t28" --exclude "$CG/t28.ex" --declared "$CG/t28.decl"; rch=$BRC
guard t28n --root "$CG/t28" --exclude "$CG/t28.noreason"; rcn=$BRC
if [ $rc -ne 1 ]; then fail T28 "exit $rc, want 1"; show "$TMP/t28.out"; show "$TMP/t28.err"
elif ! grep -q '^VIOLATION .*t28/orig/r.sh:2' "$TMP/t28.out" || grep -q 'copies/c1' "$TMP/t28.out"; then fail T28 "orig judged / copy not judged: wrong"; show "$TMP/t28.out"
elif ! has_summary t28 "1 entry points (1 by form, 0 declared), 0 with prologue, 0 allowlisted, 1 excluded, 1 violations"; then fail T28 "summary: $(tail -1 "$TMP/t28.out")"
elif [ $rcs -ne 1 ] || ! grep -q '^VIOLATION .*t28.exstale:2: stale exclusion t28/nomatch-\*/' "$TMP/t28s.out"; then fail T28 "stale exclusion: exit $rcs"; show "$TMP/t28s.out"; show "$TMP/t28s.err"
elif [ $rch -ne 1 ] || ! grep -q '^VIOLATION .*t28.decl:1: exclusion hides declared entry .*t28/copies/c1/r.sh' "$TMP/t28h.out"; then fail T28 "declared entry under an exclusion: exit $rch"; show "$TMP/t28h.out"; show "$TMP/t28h.err"
elif [ $rcn -ne 2 ]; then fail T28 "exclusion line without a reason: exit $rcn, want 2"
else pass T28 "excluded copy: exit 1, $(tail -1 "$TMP/t28.out"); stale glob -> 1; declared under exclusion -> 1; no reason -> 2"; fi
fi

# ---------------------------------------------------------------- T29
# this runner runs nothing without an explicit scope: no --scope, an unknown
# name (alone or next to a known one), the word `all` -> 2, the `nothing run`
# line, no tooth line; one name -> exactly that tooth; --list prints the names
# and runs nothing.
# The runner under test: RL_TEETH_UNDER_TEST (default: this script).
if want T29; then
begin T29
RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
NR='^nothing run: scope required (--scope <name>\[,<name>\.\.\.\]); known: T1,'
ok29=1; det29=""
for case29 in none unknown mixed all; do
    case $case29 in
        none) bounded 30 "t29$case29" env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" ;;
        unknown) bounded 30 "t29$case29" env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope T999 ;;
        mixed) bounded 30 "t29$case29" env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope T12,T999 ;;
        all) bounded 30 "t29$case29" env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope all ;;
    esac
    if [ $BRC -ne 2 ] || ! grep -q "$NR" "$TMP/t29$case29.err" || grep -qE '^(PASS|FAIL|SKIP|TEETH) ' "$TMP/t29$case29.out"; then
        ok29=0; det29="$det29 ($case29) exit $BRC, $(grep -cE '^(PASS|FAIL|SKIP) ' "$TMP/t29$case29.out") tooth lines: $(head -c 300 "$TMP/t29$case29.err" | tr '\n' ' ');"
    else det29="$det29 ($case29) 2, nothing run;"; fi
done
bounded 60 t29one env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope T12
n1=$(grep -cE '^(PASS|FAIL|SKIP) ' "$TMP/t29one.out")
if [ $BRC -ne 0 ] || [ "$n1" != 1 ] || ! grep -q '^PASS T12 ' "$TMP/t29one.out" || ! grep -qE "^TEETH platform=$PLAT scope=T12 ran=1 passed=1 failed=0 expected=1 subskips=0\$" "$TMP/t29one.out"; then
    ok29=0; det29="$det29 (one) exit $BRC, $n1 tooth lines: $(grep -E '^(PASS|FAIL|SKIP|TEETH) ' "$TMP/t29one.out" | cut -c1-80 | tr '\n' ' ');"
else det29="$det29 (one) --scope T12: exactly T12 ran;"; fi
bounded 30 t29list env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --list
if [ $BRC -ne 0 ] || ! grep -qx 'T12' "$TMP/t29list.out" || grep -qE '^(PASS|FAIL|SKIP|TEETH) ' "$TMP/t29list.out"; then
    ok29=0; det29="$det29 (list) exit $BRC: $(head -c 200 "$TMP/t29list.out" | tr '\n' ' ');"
else det29="$det29 (list) $(wc -l <"$TMP/t29list.out" | tr -d ' ') names, nothing run;"; fi
if [ $ok29 = 1 ]; then pass T29 "$det29"; else fail T29 "$det29"; fi
fi

# ---------------------------------------------------------------- T30
# mutate.sh runs nothing without an explicit scope: no --scope, an unknown id
# (alone or next to a known one), the word `all` -> 2, the `nothing run` line,
# no baseline and no mutant line;
# one id -> exactly that mutant (baseline = its own tooth only); --list prints
# the ids and runs nothing. The runner under test: RL_MUTATE_UNDER_TEST
# (default: mutate.sh next to this script).
if want T30; then
begin T30
RM=${RL_MUTATE_UNDER_TEST:-$HERE/mutate.sh}
NRM='^nothing run: scope required (--scope <name>\[,<name>\.\.\.\]); known: M1-marker-ancestor-off,'
ok30=1; det30=""
for case30 in none unknown mixed all; do
    case $case30 in
        none) bounded 30 "t30$case30" "$BASHBIN" "$RM" ;;
        unknown) bounded 30 "t30$case30" "$BASHBIN" "$RM" --scope M999-none ;;
        mixed) bounded 30 "t30$case30" "$BASHBIN" "$RM" --scope M6b-table-constant,M999-none ;;
        all) bounded 30 "t30$case30" "$BASHBIN" "$RM" --scope all ;;
    esac
    if [ $BRC -ne 2 ] || ! grep -q "$NRM" "$TMP/t30$case30.err" || grep -qE '^(baseline|RED|SURVIVED|BROKEN|SKIP|MUTATIONS) ' "$TMP/t30$case30.out"; then
        ok30=0; det30="$det30 ($case30) exit $BRC, $(grep -cE '^(baseline|RED|SURVIVED|BROKEN) ' "$TMP/t30$case30.out") run lines: $(head -c 300 "$TMP/t30$case30.err" | tr '\n' ' ');"
    else det30="$det30 ($case30) 2, nothing run;"; fi
done
bounded 120 t30one "$BASHBIN" "$RM" --scope M6b-table-constant
n1=$(grep -cE '^(RED|SURVIVED|BROKEN) ' "$TMP/t30one.out")
if [ $BRC -ne 0 ] || [ "$n1" != 1 ] || ! grep -q '^RED M6b-table-constant: ' "$TMP/t30one.out" \
        || ! grep -q '^baseline teeth scope=T12 EXIT=0 ' "$TMP/t30one.out" \
        || ! grep -qE "^MUTATIONS platform=$PLAT scope=M6b-table-constant total=1 red=1 survived=0 broken=0 skipped=0\$" "$TMP/t30one.out"; then
    ok30=0; det30="$det30 (one) exit $BRC, $n1 mutant lines: $(grep -E '^(baseline|RED|SURVIVED|BROKEN|MUTATIONS) ' "$TMP/t30one.out" | cut -c1-90 | tr '\n' ' ');"
else det30="$det30 (one) --scope M6b-table-constant: baseline T12 only, exactly one mutant, RED;"; fi
bounded 30 t30list "$BASHBIN" "$RM" --list
if [ $BRC -ne 0 ] || ! awk -F'	' '$1 == "M6b-table-constant" && $2 == "T12" && $3 == "all" { f = 1 } END { exit !f }' "$TMP/t30list.out" || grep -qE '^(baseline|RED|SURVIVED|BROKEN|MUTATIONS) ' "$TMP/t30list.out"; then
    ok30=0; det30="$det30 (list) exit $BRC: $(head -c 200 "$TMP/t30list.out" | tr '\n' ' ');"
else det30="$det30 (list) $(wc -l <"$TMP/t30list.out" | tr -d ' ') ids, nothing run;"; fi
if [ $ok30 = 1 ]; then pass T30 "$det30"; else fail T30 "$det30"; fi
fi

# ---------------------------------------------------------------- T31 (Linux)
# the kernel time limit: the time watchdog muted by the test knob, `sleep 60`
# under RuntimeMaxSec (runtime_s + 30 = 33 s) -> systemd stops the scope with
# Result=timeout; the supervisor names the proven cause: 87, `killed: time
# (kernel RuntimeMaxSec) > 33 s (profile teeth)`, journal limit=time by=kernel.
if want T31; then
if [ $PLAT = linux ]; then
    begin T31
    bounded 50 t31 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_NO_TIME_WATCH=1 "$LPY" "$SUP" --wrap teeth --label t31 -- sleep 60
    lim=$(jrec "$LOG" -1 limit); by=$(jrec "$LOG" -1 by)
    if [ $BRC -ne 87 ]; then fail T31 "exit $BRC, want 87"; show "$TMP/t31.err"
    elif ! grep -q '^RUNLIMITS: t31 killed: time (kernel RuntimeMaxSec) > 33 s (profile teeth)$' "$TMP/t31.err"; then fail T31 "no killed: time (kernel RuntimeMaxSec) line"; show "$TMP/t31.err"
    elif grep -q 'killed: time [0-9]' "$TMP/t31.err"; then fail T31 "watchdog fired although muted"; show "$TMP/t31.err"
    elif [ "$lim" != time ] || [ "$by" != kernel ]; then fail T31 "journal limit=$lim by=$by, want time/kernel"
    else pass T31 "exit 87, $(grep '^RUNLIMITS:' "$TMP/t31.err"), journal limit=time by=kernel"; fi
else
    skip T31 "linux-only (kernel RuntimeMaxSec), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T32 (Linux)
# the kernel oom-kills a DESCENDANT (the memory watch muted): the child ignores
# the scope's stop, sees its child die and exits 0 -> still 86 (the run's tree
# hit the limit), the line names the victim and the child's own code: `killed:
# mem (kernel oom-kill of a descendant; child exit 0) > 150 MB (profile
# teeth)`, journal limit=mem by=kernel oom_victim=descendant child_exit=0.
if want T32; then
if [ $PLAT = linux ]; then
    begin T32
    cat >"$TMP/oomkid.py" <<'PY'
import signal, subprocess, sys
signal.signal(signal.SIGTERM, signal.SIG_IGN)
g = subprocess.run([sys.executable, sys.argv[1], "300", "20"])
with open(sys.argv[2], "w") as f:
    f.write(str(g.returncode))
PY
    bounded 40 t32 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_NO_MEM_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t32 -- "$LPY" "$TMP/oomkid.py" "$TMP/alloc.py" "$TMP/t32.gc"
    lim=$(jrec "$LOG" -1 limit); by=$(jrec "$LOG" -1 by); vic=$(jrec "$LOG" -1 oom_victim); cx=$(jrec "$LOG" -1 child_exit)
    gc32=$(cat "$TMP/t32.gc" 2>&1)
    if [ $BRC -ne 86 ]; then fail T32 "exit $BRC, want 86 (grandchild code '$gc32')"; show "$TMP/t32.err"
    elif [ "$gc32" != -9 ]; then fail T32 "grandchild code '$gc32', want -9 (the kernel's SIGKILL)"; show "$TMP/t32.err"
    elif ! grep -q '^RUNLIMITS: t32 killed: mem (kernel oom-kill of a descendant; child exit 0) > 150 MB (profile teeth)$' "$TMP/t32.err"; then fail T32 "no descendant oom-kill line"; show "$TMP/t32.err"
    elif [ "$lim" != mem ] || [ "$by" != kernel ] || [ "$vic" != descendant ] || [ "$cx" != 0 ]; then fail T32 "journal limit=$lim by=$by oom_victim=$vic child_exit=$cx, want mem/kernel/descendant/0"
    else pass T32 "exit 86, $(grep '^RUNLIMITS:' "$TMP/t32.err"), journal oom_victim=descendant child_exit=0"; fi
else
    skip T32 "linux-only (kernel oom-kill of a descendant), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T33 (darwin)
# job control: a job-control shell (a pty from `script`, the shell's moves
# scripted in jc.py) runs the supervisor as a foreground job; the child holds
# the terminal. Ctrl-Z (SIGTSTP to the foreground group) -> the job stops and
# the terminal is back with it; `fg` -> the child holds the terminal again and
# runs; a second Ctrl-Z, then `bg` -> the child runs, the terminal stays with
# the shell; at the end the supervisor does not take the terminal back.
if want T33; then
if [ $PLAT = darwin ]; then
    begin T33
    D33="$TMP/t33"; mkdir -p "$D33"
    cat >"$TMP/tick.py" <<'PY'
import os, sys, time
d = sys.argv[1]
with open(os.path.join(d, "child"), "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid(), payload="%d %d" % (os.getpid(), os.getpgrp()))
n, end = 0, time.time() + 30
while not os.path.exists(os.path.join(d, "stop")) and time.time() < end:
    n += 1
    with open(os.path.join(d, "ticks.tmp"), "w") as f:
        f.write(str(n))
    os.replace(os.path.join(d, "ticks.tmp"), os.path.join(d, "ticks"))
    time.sleep(0.05)
PY
    cat >"$TMP/jc.py" <<'PY'
import json, os, signal, subprocess, sys, time
d, cmd = sys.argv[1], sys.argv[2:]
fd = os.open("/dev/tty", os.O_RDWR)
signal.signal(signal.SIGTTOU, signal.SIG_IGN)
shell = os.getpgrp()
steps = []
def step(name, cond):
    steps.append([name, bool(cond)])
def ticks():
    try:
        return int(open(os.path.join(d, "ticks")).read())
    except (OSError, ValueError):
        return -1
def advancing():
    a = ticks(); time.sleep(0.4); return ticks() > a
def stat(pid):
    return subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], stdout=subprocess.PIPE, universal_newlines=True).stdout.strip()
def until(pred, t):
    end = time.time() + t
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return False
def wait_job(pid, t):
    end = time.time() + t
    while time.time() < end:
        p, st = os.waitpid(pid, os.WNOHANG | os.WUNTRACED)
        if p:
            if os.WIFSTOPPED(st):
                return ("stopped", os.WSTOPSIG(st))
            return ("exited", os.waitstatus_to_exitcode(st))
        time.sleep(0.02)
    return ("timeout", None)
pid = os.fork()
if pid == 0:
    os.setpgid(0, 0)
    while os.tcgetpgrp(fd) != os.getpgrp():
        time.sleep(0.01)
    signal.signal(signal.SIGTTOU, signal.SIG_DFL)
    os.execvp(cmd[0], cmd)
try:
    os.setpgid(pid, pid)
except OSError:
    pass
os.tcsetpgrp(fd, pid)
if not until(lambda: os.path.exists(os.path.join(d, "child")), 5):
    step("child started", False)
    os.kill(pid, signal.SIGKILL)
else:
    cpid, cpg = map(int, open(os.path.join(d, "child")).read().split())
    step("child holds the terminal", until(lambda: os.tcgetpgrp(fd) == cpg, 3))
    os.killpg(os.tcgetpgrp(fd), signal.SIGTSTP)
    r = wait_job(pid, 5)
    step("Ctrl-Z: job stopped (%s %s)" % r, r[0] == "stopped")
    step("Ctrl-Z: terminal back with the job", os.tcgetpgrp(fd) == pid)
    os.tcsetpgrp(fd, shell)
    step("Ctrl-Z: child stopped (stat %s)" % stat(cpid), stat(cpid).startswith("T") and not advancing())
    os.tcsetpgrp(fd, pid)
    os.killpg(pid, signal.SIGCONT)
    step("fg: child holds the terminal again", until(lambda: os.tcgetpgrp(fd) == cpg, 3))
    step("fg: child runs", advancing())
    os.killpg(os.tcgetpgrp(fd), signal.SIGTSTP)
    r = wait_job(pid, 5)
    step("second Ctrl-Z: job stopped (%s %s)" % r, r[0] == "stopped")
    os.tcsetpgrp(fd, shell)
    os.killpg(pid, signal.SIGCONT)
    step("bg: child runs", until(advancing, 3))
    step("bg: terminal stays with the shell", os.tcgetpgrp(fd) == shell)
    open(os.path.join(d, "stop"), "w").close()
    r = wait_job(pid, 10)
    step("job exited (%s %s)" % r, r == ("exited", 0))
    if r[0] != "exited":
        os.kill(pid, signal.SIGKILL)
        os.kill(cpid, signal.SIGKILL)
    step("after the run: terminal with the shell", os.tcgetpgrp(fd) == shell)
with open(os.path.join(d, "steps.json"), "w") as f:
    json.dump(steps, f)
PY
    bounded 60 t33 script -q /dev/null "$LPY" "$TMP/jc.py" "$D33" env RUNLIMITS_LOG_DIR="$LOG" "$LPY" "$SUP" --wrap unit --label t33 -- "$LPY" "$TMP/tick.py" "$D33"
    msg=$("$LPY" - "$D33/steps.json" <<'PY'
import json, sys
try:
    steps = json.load(open(sys.argv[1]))
except (OSError, ValueError) as e:
    print("no steps: %s" % e); sys.exit(1)
bad = [n for n, ok in steps if not ok]
print("; ".join(("FAILED " if not ok else "") + n for n, ok in steps))
sys.exit(1 if bad or not steps else 0)
PY
)
    if [ $? -ne 0 ]; then fail T33 "$msg"; show "$TMP/t33.out"
    else pass T33 "$msg"; fi
else
    skip T33 "darwin-only (job control of the child's own process group), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T34 (Linux)
# leftovers carry their supervisor's pid and start time (scope
# runlimits-<pid>-s<start>.scope, shim dir runlimits-<pid>-s<start>-* in the
# registry, pinned to the tooth's private dir); a
# supervisor at its start removes the leftovers whose owner is dead and leaves a
# live owner's: (a) owner SIGKILLed, its scope then failed by an oom-kill ->
# after the next supervisor's start the unit is gone and so is the shim dir;
# (b) owner stopped (alive), its scope failed -> the next supervisor leaves
# the unit and the dir; the owner resumes and reads Result: 86 by=kernel.
if want T34; then
if [ $PLAT = linux ]; then
    begin T34
    ok34=1; det34=""
    T34T="$TMP/t34tmp"; mkdir -p "$T34T"
    SYSTEMCTL=$(command -v systemctl)
    cat >"$TMP/late-oom.sh" <<SH
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$\$ "\$1"
sleep 1
exec "$LPY" "$TMP/alloc.py" 300 20
SH
    unit_of() { "$SYSTEMCTL" --user list-units --all --plain --no-legend "runlimits-$1-*" | awk '{ print $1 }' | head -1; }
    unit_state() { "$SYSTEMCTL" --user show "$1" -p LoadState -p ActiveState -p Result | tr '\n' ' '; }
    wait_failed() { # unit timeout_s
        local t0; t0=$(now)
        while ! unit_state "$1" | grep -q 'ActiveState=failed'; do
            elapsed_ge "$t0" "$(now)" "$2" && return 1
            sleep 0.1
        done
    }
    start_of() { "$LPY" -B -c 'import sys; sys.path.insert(0, sys.argv[2]); import runlimits; print(runlimits.proc_start(int(sys.argv[1])))' "$1" "$(dirname "$SUP")"; }
    env TMPDIR="$T34T" RUNLIMITS_REGISTRY="$T34T" RUNLIMITS_LOG_DIR="$(sublog "$LOG/a")" RUNLIMITS_TEST_NO_MEM_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t34a -- "$BASHBIN" "$TMP/late-oom.sh" "$TMP/t34a.pid" >"$TMP/t34a.out" 2>"$TMP/t34a.err" &
    sa=$!
    if ! wait_file "$TMP/t34a.pid" 10; then ok34=0; det34="(a) child never started: $(tr '\n' ' ' <"$TMP/t34a.err");"; kill -KILL "$sa"; wait "$sa"
    else
        sta=$(start_of "$sa"); ua=$(unit_of "$sa")
        kill -KILL "$sa"; wait "$sa"
        dira=$(find "$T34T" -maxdepth 1 -name "runlimits-$sa-s$sta-*" -type d)
        if [ "$ua" != "runlimits-$sa-s$sta.scope" ]; then ok34=0; det34="(a) unit of $sa is '$ua', want runlimits-$sa-s$sta.scope;"
        elif ! wait_failed "$ua" 10; then ok34=0; det34="(a) $ua never failed: $(unit_state "$ua");"
        elif [ -z "$dira" ]; then ok34=0; det34="(a) no shim dir runlimits-$sa-s$sta-* of the killed owner in $T34T: $(ls "$T34T" | tr '\n' ' ');"
        else
            bounded 20 t34n env TMPDIR="$T34T" RUNLIMITS_REGISTRY="$T34T" RUNLIMITS_LOG_DIR="$(sublog "$LOG/n")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t34n -- true
            st=$(unit_state "$ua")
            if [ $BRC -ne 0 ]; then ok34=0; det34="(a) next supervisor exit $BRC: $(tr '\n' ' ' <"$TMP/t34n.err");"
            elif ! echo "$st" | grep -q 'LoadState=not-found'; then ok34=0; det34="(a) dead owner's unit after the next start: $st;"
            elif [ -e "$dira" ]; then ok34=0; det34="(a) dead owner's shim dir $dira still there;"
            else det34="(a) dead owner's failed $ua and shim dir removed by the next start;"; fi
        fi
    fi
    kill_loads
    env TMPDIR="$T34T" RUNLIMITS_REGISTRY="$T34T" RUNLIMITS_LOG_DIR="$(sublog "$LOG/b")" RUNLIMITS_TEST_NO_MEM_WATCH=1 RUNLIMITS_TEST_NO_TIME_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t34b -- "$BASHBIN" "$TMP/late-oom.sh" "$TMP/t34b.pid" >"$TMP/t34b.out" 2>"$TMP/t34b.err" &
    sb=$!
    if ! wait_file "$TMP/t34b.pid" 10; then ok34=0; det34="$det34 (b) child never started: $(tr '\n' ' ' <"$TMP/t34b.err");"; kill -KILL "$sb"; wait "$sb"
    else
        kill -STOP "$sb"; ub=$(unit_of "$sb")
        if ! wait_failed "$ub" 10; then ok34=0; det34="$det34 (b) $ub never failed: $(unit_state "$ub");"; kill -CONT "$sb"; wait "$sb"
        else
            dirb=$(find "$T34T" -maxdepth 1 -name "runlimits-$sb-*" -type d)
            bounded 20 t34m env TMPDIR="$T34T" RUNLIMITS_REGISTRY="$T34T" RUNLIMITS_LOG_DIR="$(sublog "$LOG/m")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t34m -- true
            st=$(unit_state "$ub"); dirleft=n; [ -n "$dirb" ] && [ -d "$dirb" ] && dirleft=y
            kill -CONT "$sb"; wait "$sb"; rcb=$?
            if ! echo "$st" | grep -q 'ActiveState=failed'; then ok34=0; det34="$det34 (b) live owner's unit touched by the next start: $st;"
            elif [ $dirleft != y ]; then ok34=0; det34="$det34 (b) live owner's shim dir '$dirb' gone after the next start;"
            elif [ $rcb -ne 86 ] || ! grep -q '^RUNLIMITS: t34b killed: mem (kernel oom-kill) > 150 MB (profile teeth)$' "$TMP/t34b.err"; then ok34=0; det34="$det34 (b) resumed owner exit $rcb: $(tr '\n' ' ' <"$TMP/t34b.err");"
            else det34="$det34 (b) live (stopped) owner's failed unit and shim dir left, owner resumed: 86 $(grep '^RUNLIMITS:' "$TMP/t34b.err");"; fi
        fi
    fi
    kill_loads
    if [ $ok34 = 1 ]; then pass T34 "$det34"; else fail T34 "$det34"; fi
else
    skip T34 "linux-only (scope and shim leftovers), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T35
# a signal to a runner ends it together with its tree and its temp dir: copies
# of the runners under test (RL_TEETH_UNDER_TEST / RL_MUTATE_UNDER_TEST) sit in
# a library whose runlimits.py only sleeps 60 s; the teeth runner (--scope T2)
# gets TERM / INT / HUP, mutate.sh (--scope M3-time-watch-off, in its
# baseline) gets INT - each to its own pid only, while the sleeper runs. Each:
# the runner exits within 10 s with 143 / 130 / 129 / 130, every process of its
# tree (snapshot before the signal) and the sleeper are dead within 12 s, its
# private TMPDIR is empty.
if want T35; then
begin T35
ok35=1; det35=""
RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
RM=${RL_MUTATE_UNDER_TEST:-$HERE/mutate.sh}
L35="$TMP/t35lib"; mkdir -p "$L35"
for f in runlimits.sh runlimits.mjs census-guard.py NOTES.md mutations.tsv; do cp "$UT/$f" "$L35/$f"; done
cp "$RT" "$L35/runlimits-teeth.sh"; cp "$RM" "$L35/mutate.sh"
cat >"$L35/runlimits.py" <<'PY'
import os, time
with open(os.environ["RL_T35_PIDS"], "a") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid(), append=True)
time.sleep(60)
PY
mkdir -p "$L35/bin"
cat >"$L35/bin/ps" <<'SH'
#!/usr/bin/env bash
if [ -n "${RL_T35_SYNC:-}" ] && [ "$1" = -o ] && [ "$2" = stat= ] && [ ! -e "$RL_T35_SYNC" ]; then
    printf 'external ps ready\n' >"$RL_T35_SYNC"
    sleep 2
fi
exec "$RL_T35_REAL_PS" "$@"
SH
chmod +x "$L35/bin/ps"
# A background shell inherits ignored INT; reset it before the shell under test.
DFLINT='import os, signal, subprocess, sys
from fixture_pid import record_pid
try:
    child = subprocess.Popen(sys.argv[1:], preexec_fn=lambda: signal.signal(signal.SIGINT, signal.SIG_DFL))
    record_pid(os.environ["RL_T35_CHILD"], child.pid)
    result = child.wait()
    status = "exited:%d" % result if result >= 0 else "signaled:%d" % -result
    with open(os.environ["RL_T35_STATUS"], "w") as stream:
        stream.write(status + "\n")
except (OSError, subprocess.SubprocessError) as e:
    print("T35 observer waitpid failed: %s" % e, file=sys.stderr)
    sys.exit(2)
'
for case35 in teeth:TERM:143 teeth:INT:130 teeth:HUP:129 mutate:INT:130; do
    kind=${case35%%:*}; sig=${case35#*:}; want35=${sig#*:}; sig=${sig%%:*}
    tag="t35$kind$sig"; tp="$TMP/$tag.tmp"; pf="$TMP/$tag.pids"; mkdir -p "$tp"; : >"$pf"
    if [ $kind = teeth ]; then
        env PATH="$L35/bin:$PATH" RL_T35_SYNC="$TMP/$tag.sync" RL_T35_REAL_PS="$(command -v ps)" RUNLIMITS_HOME="$UT" RL_UNDER_TEST="$L35" RL_T35_PIDS="$pf" RL_T35_CHILD="$TMP/$tag.child" RL_T35_STATUS="$TMP/$tag.status" TMPDIR="$tp" "$LPY" -c "$DFLINT" "$BASHBIN" "$L35/runlimits-teeth.sh" --scope T2 >"$TMP/$tag.out" 2>"$TMP/$tag.err" &
    else
        env RUNLIMITS_HOME="$UT" RL_T35_PIDS="$pf" RL_T35_CHILD="$TMP/$tag.child" RL_T35_STATUS="$TMP/$tag.status" TMPDIR="$tp" "$LPY" -c "$DFLINT" "$BASHBIN" "$L35/mutate.sh" --scope M3-time-watch-off >"$TMP/$tag.out" 2>"$TMP/$tag.err" &
    fi
    op=$!; save_pid "$TMP/root-$op.pid" "$op"; save_pid "$TMP/$tag.observer" "$op"; ost=$(cat "$TMP/$tag.observer.start")
    if ! wait_file "$TMP/$tag.child" 10; then
        ok35=0; det35="$det35 ($kind $sig) status witness missing;"
        snapshot_saved "$TMP/$tag.targets" $(descendants "$op")
        snapshot_pidfile "$TMP/$tag.targets" "$TMP/$tag.observer"
        signal_snapshot KILL "$TMP/$tag.targets" "$TMP/$tag.err"
        wait_pidfile "$TMP/root-$op.pid" 2 "$(now)" "$ost" && wait "$op"; continue
    fi
    rp=$(cat "$TMP/$tag.child"); rst=$(cat "$TMP/$tag.child.start")
    if ! wait_file "$pf" 30 || { [ "$kind" = teeth ] && ! wait_file "$TMP/$tag.sync" 30; }; then
        ok35=0; det35="$det35 ($kind $sig) external fixture never ready;"
        snapshot_saved "$TMP/$tag.targets" $(descendants "$rp")
        snapshot_pidfile "$TMP/$tag.targets" "$TMP/$tag.observer"
        snapshot_pidfile "$TMP/$tag.targets" "$TMP/$tag.child"
        snapshot_pidfile "$TMP/$tag.targets" "$pf"
        signal_snapshot KILL "$TMP/$tag.targets" "$TMP/$tag.err"
        wait_pidfile "$TMP/root-$op.pid" 2 "$(now)" "$ost" && wait "$op"; continue
    fi
    tree=$(echo $op $rp $(descendants "$rp") $(cat "$pf") | tr ' ' '\n' | awk '!seen[$0]++' | tr '\n' ' ')
    snapshot_saved "$TMP/$tag.targets" $tree
    snapshot_pidfile "$TMP/$tag.targets" "$TMP/$tag.observer"
    snapshot_pidfile "$TMP/$tag.targets" "$TMP/$tag.child"
    snapshot_pidfile "$TMP/$tag.targets" "$pf"
    t0=$(now); signal_saved "$sig" "$rp" "$rst" "$TMP/$tag.err"
    if ! wait_dead "$rp" 10 "$t0" "$rst"; then
        ok35=0; det35="$det35 ($kind $sig) runner alive 10 s after SIG$sig;"
        signal_snapshot KILL "$TMP/$tag.targets" "$TMP/$tag.err"
        wait_pidfile "$TMP/root-$op.pid" 2 "$(now)" "$ost" && wait "$op"; continue
    fi
    d=$(secs_between "$t0" "$(now)"); rc35=missing
    if wait_file "$TMP/$tag.status" 2 && wait_pidfile "$TMP/root-$op.pid" 2 "$(now)" "$ost"; then
        wait "$op"; orc=$?
        [ "$orc" = 0 ] && rc35=$(cat "$TMP/$tag.status")
    fi
    while :; do
        left=$(live_snapshot "$TMP/$tag.targets")
        [ -z "$left" ] && break
        elapsed_ge "$t0" "$(now)" 12 && break
        sleep 0.1
    done
    if [ -n "$left" ]; then
        ok35=0; det35="$det35 ($kind $sig) runner exit $rc35 after $d s, its tree alive 12 s after the signal: $left;"
        signal_snapshot KILL "$TMP/$tag.targets" "$TMP/$tag.err"
    elif [ -n "$(ls -A "$tp")" ]; then ok35=0; det35="$det35 ($kind $sig) runner exit $rc35, left in its TMPDIR: $(ls -A "$tp" | tr '\n' ' ');"
    elif [ "$rc35" != "exited:$want35" ]; then
        ok35=0
        case "$rc35" in
            signaled:*) name35=$("$LPY" -c 'import signal, sys; print(signal.Signals(int(sys.argv[1])).name[3:])' "${rc35#*:}"); det35="$det35 ($kind $sig) runner died by signal $name35, want exit $want35;" ;;
            exited:*) det35="$det35 ($kind $sig) runner exit ${rc35#*:}, want $want35;" ;;
            *) det35="$det35 ($kind $sig) status witness missing;" ;;
        esac
    else det35="$det35 ($kind $sig) runner $rc35 after $d s, tree dead, TMPDIR empty;"; fi
done
if [ $ok35 = 1 ]; then pass T35 "$det35"; else fail T35 "$det35"; fi
fi

# ---------------------------------------------------------------- T36
# stopping a runner waits for its supervisors to exit, so no shim dir is left
# at the moment the runner is gone (no later start is needed to reap it). A
# stand-in supervisor (runlimits.py of a copied library) keeps a mark
# runlimits-<pid>-s<start>-* with its real start time (proc_start of the
# library under test) in the registry it inherits (RUNLIMITS_REGISTRY, else
# its temp dir: the runner under test inherits the suite's registry, not its
# private TMPDIR); on SIGTERM it takes the supervisor's full stop time (2
# GRACE_S + UNIT_SETTLE_S of the library under test), then removes the mark and
# exits. (a) the teeth runner under test
# (--scope T2) gets TERM; (b) mutate.sh under test (--scope M3-time-watch-off,
# in its baseline) gets INT; (c) no signal: the runner's own `bounded` times
# out on the stand-in (T2); (d) the real supervisor of T15 (TERM-ignoring
# tree) under the teeth runner, TERM to the runner. Each: right when the runner
# exits its TMPDIR is empty and the registry holds no mark of a pid of the case;
# (a) 143, (b) 130, (d) 143.
if want T36; then
begin T36
ok36=1; det36=""
RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
RM=${RL_MUTATE_UNDER_TEST:-$HERE/mutate.sh}
L36="$TMP/t36lib"; mkdir -p "$L36"
for f in runlimits.sh runlimits.mjs census-guard.py NOTES.md mutations.tsv; do cp "$UT/$f" "$L36/$f"; done
cp "$RT" "$L36/runlimits-teeth.sh"; cp "$RM" "$L36/mutate.sh"
FULL36=$("$LPY" -B -c 'import sys; sys.path.insert(0, sys.argv[1]); import runlimits as r; print(2 * r.GRACE_S + r.UNIT_SETTLE_S)' "$UT")
cat >"$L36/runlimits.py" <<'PY'
import os, signal, sys, tempfile, time
sys.dont_write_bytecode = True
sys.path.insert(0, os.environ["RL_T36_LIB"])
from runlimits import proc_start
reg = os.environ.get("RUNLIMITS_REGISTRY") or tempfile.gettempdir()
d = tempfile.mkdtemp(prefix="runlimits-%d-s%s-" % (os.getpid(), proc_start(os.getpid())), dir=reg)
with open(os.environ["RL_T36_PIDS"], "a") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid(), append=True)
def stop(signum, _frame):
    time.sleep(float(os.environ["RL_T36_STOP_S"]))
    os.rmdir(d)
    os._exit(128 + signum)
signal.signal(signal.SIGTERM, stop)
time.sleep(120)
PY
DFL36='import os, signal, sys; signal.signal(signal.SIGINT, signal.SIG_DFL); os.execv(sys.argv[1], sys.argv[1:])'
REG36=$("$LPY" -c 'import os, tempfile; print(os.environ.get("RUNLIMITS_REGISTRY") or tempfile.gettempdir())')
# marks36 <pids...>: registry and TMPDIR entries runlimits-<pid>-s* of these pids
marks36() { local p d; for p in "$@"; do for d in "$REG36"/runlimits-"$p"-s* "$tp"/runlimits-"$p"-s*; do [ -e "$d" ] && echo "$d"; done; done; }
for case36 in a:teeth:TERM:143 b:mutate:INT:130 c:teeth:none:any d:real:TERM:143; do
    IFS=: read -r c36 kind sig want36 <<EOC
$case36
EOC
    tag="t36$c36"; tp="$TMP/$tag.tmp"; pf="$TMP/$tag.pids"; mkdir -p "$tp"; : >"$pf"
    case $kind in
        teeth) env RUNLIMITS_HOME="$UT" RL_UNDER_TEST="$L36" RL_T36_LIB="$UT" RL_T36_PIDS="$pf" RL_T36_STOP_S="$FULL36" TMPDIR="$tp" "$LPY" -c "$DFL36" "$BASHBIN" "$L36/runlimits-teeth.sh" --scope T2 >"$TMP/$tag.out" 2>"$TMP/$tag.err" & ;;
        mutate) env RUNLIMITS_HOME="$UT" RL_T36_LIB="$UT" RL_T36_PIDS="$pf" RL_T36_STOP_S="$FULL36" TMPDIR="$tp" "$LPY" -c "$DFL36" "$BASHBIN" "$L36/mutate.sh" --scope M3-time-watch-off >"$TMP/$tag.out" 2>"$TMP/$tag.err" & ;;
        real) env RUNLIMITS_HOME="$UT" RL_UNDER_TEST="$UT" TMPDIR="$tp" "$LPY" -c "$DFL36" "$BASHBIN" "$L36/runlimits-teeth.sh" --scope T15 >"$TMP/$tag.out" 2>"$TMP/$tag.err" & ;;
    esac
    rp=$!; save_pid "$TMP/$tag.runner" "$rp"
    if [ $kind = real ]; then
        t0=$(now); started=n
        while ! elapsed_ge "$t0" "$(now)" 30; do
            for f in "$tp"/rl-teeth.*/t15c.pid; do [ -s "$f" ] && started=y; done
            [ $started = y ] && break
            sleep 0.05
        done
        if [ $started = y ]; then : >"$pf"; marks36 $(descendants "$rp") >>"$pf"; fi
    else
        started=n; wait_file "$pf" 30 && started=y
    fi
    if [ $started != y ]; then
        ok36=0; det36="$det36 ($c36) the supervisor never started: $(tr '\n' ' ' <"$TMP/$tag.err" | head -c 300);"
        kill_saved_tree "$TMP/$tag.runner" "$TMP/$tag.err"; wait_pidfile "$TMP/$tag.runner" 2 && wait "$rp"; continue
    fi
    tree=$(echo $rp $(descendants "$rp") | tr ' ' '\n' | awk '!seen[$0]++' | tr '\n' ' ')
    snapshot_saved "$TMP/$tag.targets" $tree
    snapshot_pidfile "$TMP/$tag.targets" "$TMP/$tag.runner"
    [ "$kind" = real ] || snapshot_pidfile "$TMP/$tag.targets" "$pf"
    t0=$(now)
    [ "$sig" = none ] || signal_file "$sig" "$TMP/$tag.runner" "$TMP/$tag.err"
    if ! wait_pidfile "$TMP/$tag.runner" 90 "$t0"; then
        ok36=0; det36="$det36 ($c36) runner alive 90 s after start of the stop;"
        signal_snapshot KILL "$TMP/$tag.targets" "$TMP/$tag.err"; kill_saved_tree "$TMP/$tag.runner" "$TMP/$tag.err"; wait_pidfile "$TMP/$tag.runner" 2 && wait "$rp"; continue
    fi
    left36=$(ls -A "$tp" | tr '\n' ' ')
    reg36=$(marks36 $tree $(awk '{ print $1 }' "$pf" | grep -E '^[0-9]+$') | tr '\n' ' ')
    d=$(secs_between "$t0" "$(now)"); wait "$rp"; rc36=$?
    signal_snapshot KILL "$TMP/$tag.targets" "$TMP/$tag.err"
    if [ $kind = real ] && [ ! -s "$pf" ]; then ok36=0; det36="$det36 ($c36) no mark of the T15 supervisor seen while it ran;"
    elif [ -n "$left36" ] || [ -n "$reg36" ]; then ok36=0; det36="$det36 ($c36) runner exit $rc36 after $d s, left in its TMPDIR at exit: '$left36', marks of the case in the registry $REG36: '$reg36';"
    elif [ "$want36" != any ] && [ $rc36 -ne "$want36" ]; then ok36=0; det36="$det36 ($c36) runner exit $rc36, want $want36;"
    else det36="$det36 ($c36) $kind${sig:+ $sig}: runner exit $rc36 after $d s, TMPDIR and registry clean at exit;"; fi
done
if [ $ok36 = 1 ]; then pass T36 "stand-in stop ${FULL36} s;$det36"; else fail T36 "stand-in stop ${FULL36} s;$det36"; fi
fi

# ---------------------------------------------------------------- T37 (Linux)
# a supervisor's SIGKILL does not cut a nested supervisor's own stop: an outer
# supervisor (profile unit) runs a nested one whose child tree ignores TERM,
# and stops by (a) SIGTERM to the outer (escalation after GRACE_S), (b) the
# outer's parent dying (parent-gone), (c) the outer's child exiting with the
# nested supervisor left running (sweep of survivors). When the outer has
# exited: no runlimits-* shim dir in the private TMPDIR (the registry), no unit of the nested
# supervisor, the nested supervisor's journal record written.
if want T37; then
if [ $PLAT = linux ]; then
    begin T37
    ok37=1; det37=""
    cat >"$TMP/term37.sh" <<SH
trap '' TERM
sleep 60 &
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$! "\$1.gc"
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$\$ "\$1.c"
wait
SH
    # the outer's child exits only once the nested supervisor's child runs: the sweep then finds a set-up nested supervisor
    cat >"$TMP/bg37.sh" <<SH
"\$@" &
while [ ! -s "\$T37TAG.gc" ]; do sleep 0.05; done
exit 0
SH
    if [ ! -f "$TMP/launcher.py" ]; then
        printf '%s\n' 'import subprocess, sys, time' 'p = subprocess.Popen(sys.argv[2:])' 'with open(sys.argv[1], "w") as f:' '    __import__("fixture_pid").record_pid(f.name, p.pid)' 'time.sleep(60)' >"$TMP/launcher.py"
    fi
    for c37 in a b c; do
        tp="$TMP/t37$c37.tmp"; mkdir -p "$tp"; tg="$TMP/t37$c37"; L37="$LOG/$c37"; sublog "$L37" >/dev/null || { ok37=0; det37="$det37 ($c37) sublog failed;"; continue; }
        NEST="$LPY $SUP --wrap unit --label t37${c37}n -- $BASHBIN $TMP/term37.sh $tg"
        case $c37 in
            a) env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$L37" "$LPY" "$SUP" --wrap unit --label t37ao -- $NEST >"$tg.out" 2>"$tg.err" &
               op=$!; save_pid "$TMP/root-$op.pid" "$op" ;;
            b) env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$L37" "$LPY" "$TMP/launcher.py" "$tg.op" "$LPY" "$SUP" --wrap unit --label t37bo -- $NEST >"$tg.out" 2>"$tg.err" &
               lp=$!; wait_file "$tg.op" 10; op=$(cat "$tg.op"); "$LPY" "$RL_FIXTURE_PID_HELPER" "$TMP/root-$op.pid" "$op" "$(cat "$tg.op.start")" ;;
            c) env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$L37" T37TAG="$tg" "$LPY" "$SUP" --wrap unit --label t37co -- "$BASHBIN" "$TMP/bg37.sh" $NEST >"$tg.out" 2>"$tg.err" &
               op=$!; save_pid "$TMP/root-$op.pid" "$op" ;;
        esac
        if ! wait_file "$tg.c" 20 || ! wait_file "$tg.gc" 5; then
            ok37=0; det37="$det37 ($c37) nested child never started: $(tr '\n' ' ' <"$tg.err" | head -c 300);"
            kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"; continue
        fi
        nsup=""; for d37 in "$tp"/runlimits-*; do n=${d37##*/runlimits-}; n=${n%%-*}; [ "$n" != "$op" ] && [ -e "$d37" ] && nsup=$n; done
        t0=$(now)
        case $c37 in
            a) signal_file TERM "$TMP/root-$op.pid" "$TMP/root-$op.err" ;;
            b) kill -KILL "$lp"; wait "$lp" ;;
            c) : ;;
        esac
        if ! wait_pidfile "$TMP/root-$op.pid" 60 "$t0"; then ok37=0; det37="$det37 ($c37) outer alive 60 s after the stop began;"; fi
        d=$(secs_between "$t0" "$(now)")
        left37=$(ls -A "$tp" | tr '\n' ' ')
        u37=""; [ -n "$nsup" ] && u37=$(systemctl --user list-units --all --plain --no-legend "runlimits-$nsup-*" | tr '\n' ' ')
        jn=$(jfind "$L37" label "t37${c37}n" exit)
        [ $c37 = b ] || wait "$op"
        for f in "$tg.c" "$tg.gc"; do signal_file KILL "$f" "$tg.err"; done
        kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"
        if [ -z "$nsup" ]; then ok37=0; det37="$det37 ($c37) no shim dir of the nested supervisor seen: $(ls -A "$tp" | tr '\n' ' ');"
        elif [ -n "$left37" ] || [ -n "$u37" ] || [ "$jn" = MISSING ]; then
            ok37=0; det37="$det37 ($c37) outer gone after $d s, left: TMPDIR '$left37', unit '$u37', nested journal exit=$jn: $(grep '^RUNLIMITS:' "$tg.err" | tr '\n' ' ' | head -c 300);"
        else det37="$det37 ($c37) outer gone after $d s, nested $nsup finished its stop (journal exit=$jn), nothing left;"; fi
    done
    if [ $ok37 = 1 ]; then pass T37 "$det37"; else fail T37 "$det37"; fi
else
    skip T37 "linux-only (scope and shim of a nested supervisor), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T38 (Linux)
# the watchdog stays alive while a nested supervisor is spared: a stand-in
# nested supervisor (publishes the mark runlimits-<pid>-s<start>-* in the registry,
# stays in its "stop" 15 s after SIGTERM) runs, in a scope of its own (the
# outer's kernel limit does not reach it), a grower that starts allocating 6 s
# after SIGTERM (past the outer's 5 s escalation window: the window's own tick,
# T41, would kill before any sparing). The outer (profile teeth) is stopped:
# (a) SIGTERM, time watch muted -> the grower passes 150 MB while spared -> 86 before the stand-in's 15 s,
# `killed: mem <n> MB > 150 MB during the stop, nested supervisors not spared
# (profile teeth)`, journal limit=mem by=watchdog during_stop=null; (b) its
# parent dies, memory watch muted -> the 3 s runtime passes while spared -> 87,
# `killed: time <t> s > 3 s during the stop, nested supervisors not spared
# (profile teeth)`, journal limit=time during_stop=parent-gone. Each: the
# stand-in and the grower are dead when the outer is gone. (c) memory stop: a
# hog outside the stand-in (own scope, ignores TERM) holds 200 MB, the stand-in
# is spared after the window and the tree is still over 150 MB -> one line
# only, `killed: mem <n> MB > 150 MB, then <m> MB during the stop, nested
# supervisors not spared (profile teeth)`, 86, journal stop_kill=sparing
# during_stop=mem.
if want T38; then
if [ $PLAT = linux ]; then
    begin T38
    ok38=1; det38=""
    D38="$TMP/t38sup"; mkdir -p "$D38"
    cat >"$D38/runlimits.py" <<'PY'
import os, signal, subprocess, sys, time
sys.dont_write_bytecode = True
sys.path.insert(0, os.environ["RL_T38_LIB"])
from runlimits import proc_start
tag = os.environ["RL_T38_TAG"]
start = proc_start(os.getpid())
mark = os.path.join(os.environ.get("RUNLIMITS_REGISTRY") or os.environ["TMPDIR"], "runlimits-%d-s%s-t38" % (os.getpid(), start))
os.mkdir(mark)
child = subprocess.Popen(["systemd-run", "--user", "--scope", "--collect", "--quiet", "--"] + sys.argv[sys.argv.index("--") + 1:])
with open(tag + ".sup", "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
stop = []
signal.signal(signal.SIGTERM, lambda *a: stop.append(1))
while not stop:
    time.sleep(0.05)
try:
    child.send_signal(signal.SIGTERM)
except OSError:
    pass
time.sleep(15)
os.rmdir(mark)
os._exit(143)
PY
    cat >"$TMP/grow38.py" <<'PY'
import os, signal, time
with open(os.environ["RL_T38_TAG"] + ".grow", "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
go = []
signal.signal(signal.SIGTERM, lambda *a: go.append(1))
while not go:
    time.sleep(0.05)
time.sleep(6)
bufs, deadline = [], time.time() + 30
while time.time() < deadline:
    if len(bufs) < 100:
        bufs.append(bytearray(b"\x01") * (4 << 20))
    time.sleep(0.02)
PY
    if [ ! -f "$TMP/launcher.py" ]; then
        printf '%s\n' 'import subprocess, sys, time' 'p = subprocess.Popen(sys.argv[2:])' 'with open(sys.argv[1], "w") as f:' '    __import__("fixture_pid").record_pid(f.name, p.pid)' 'time.sleep(60)' >"$TMP/launcher.py"
    fi
    for c38 in a b; do
        tp="$TMP/t38$c38.tmp"; mkdir -p "$tp"; tg="$TMP/t38$c38"; L38="$LOG/$c38"; sublog "$L38" >/dev/null || { ok38=0; det38="$det38 ($c38) sublog failed;"; continue; }
        case $c38 in
            a) env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$L38" RL_T38_TAG="$tg" RL_T38_LIB="$UT" RUNLIMITS_TEST_NO_TIME_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t38a -- "$LPY" "$D38/runlimits.py" --wrap unit -- "$LPY" "$TMP/grow38.py" >"$tg.out" 2>"$tg.err" &
               op=$!; save_pid "$TMP/root-$op.pid" "$op" ;;
            b) env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$L38" RL_T38_TAG="$tg" RL_T38_LIB="$UT" RUNLIMITS_TEST_NO_MEM_WATCH=1 "$LPY" "$TMP/launcher.py" "$tg.op" "$LPY" "$SUP" --wrap teeth --label t38b -- "$LPY" "$D38/runlimits.py" --wrap unit -- "$LPY" "$TMP/grow38.py" >"$tg.out" 2>"$tg.err" &
               lp=$!; wait_file "$tg.op" 10; op=$(cat "$tg.op"); "$LPY" "$RL_FIXTURE_PID_HELPER" "$TMP/root-$op.pid" "$op" "$(cat "$tg.op.start")" ;;
        esac
        if ! wait_file "$tg.sup" 20 || ! wait_file "$tg.grow" 20; then
            ok38=0; det38="$det38 ($c38) stand-in never started: $(tr '\n' ' ' <"$tg.err" | head -c 300);"
            kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"; [ $c38 = b ] && { kill -KILL "$lp"; wait "$lp"; }; continue
        fi
        sp=$(cat "$tg.sup"); gp=$(cat "$tg.grow")
        t0=$(now)
        case $c38 in
            a) signal_file TERM "$TMP/root-$op.pid" "$TMP/root-$op.err" ;;
            b) kill -KILL "$lp"; wait "$lp" ;;
        esac
        if ! wait_pidfile "$TMP/root-$op.pid" 30 "$t0"; then ok38=0; det38="$det38 ($c38) outer alive 30 s after the stop began;"; fi
        tend=$(now); d=$(secs_between "$t0" "$tend")
        sa=n; alive "$sp" && sa=y; ga=n; alive "$gp" && ga=y
        rc38=-; [ $c38 = a ] && { wait "$op"; rc38=$?; }
        signal_file KILL "$tg.sup" "$tg.err"; signal_file KILL "$tg.grow" "$tg.err"; kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"
        lim=$(jfind "$L38" label "t38$c38" limit); ex=$(jfind "$L38" label "t38$c38" exit); ds=$(jfind "$L38" label "t38$c38" during_stop); by=$(jfind "$L38" label "t38$c38" by)
        case $c38 in
            a) want_ex=86; want_lim=mem; want_ds=null; re='^RUNLIMITS: t38a killed: mem [0-9]+ MB > 150 MB during the stop, nested supervisors not spared \(profile teeth\)$' ;;
            b) want_ex=87; want_lim=time; want_ds=parent-gone; re='^RUNLIMITS: t38b killed: time [0-9.]+ s > 3 s during the stop, nested supervisors not spared \(profile teeth\)$' ;;
        esac
        if elapsed_ge "$t0" "$tend" 12; then ok38=0; det38="$det38 ($c38) outer gone only after $d s (the stand-in's stop is 15 s);"
        elif [ $sa = y ] || [ $ga = y ]; then ok38=0; det38="$det38 ($c38) at the outer's exit stand-in alive=$sa grower alive=$ga;"
        elif [ "$ex" != $want_ex ] || [ "$lim" != $want_lim ] || [ "$ds" != $want_ds ] || [ "$by" != watchdog ] || { [ $c38 = a ] && [ "$rc38" != 86 ]; }; then
            ok38=0; det38="$det38 ($c38) exit $rc38, journal exit=$ex limit=$lim by=$by during_stop=$ds: $(grep '^RUNLIMITS:' "$tg.err" | tr '\n' ' ' | head -c 300);"
        elif ! grep -qE "$re" "$tg.err"; then ok38=0; det38="$det38 ($c38) no during-the-stop line: $(grep '^RUNLIMITS:' "$tg.err" | tr '\n' ' ' | head -c 300);"
        else det38="$det38 ($c38) outer gone after $d s, journal exit=$ex limit=$lim during_stop=$ds, $(grep -E "$re" "$tg.err");"; fi
    done
    cat >"$TMP/hog38.py" <<'PY'
import os, signal, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
b = bytearray(b"\x01") * (200 << 20)
with open(sys.argv[1] + ".hog", "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
time.sleep(30)
PY
    cat >"$TMP/l38c.py" <<'PY'
import os, signal, subprocess, sys, time
tag, stand, hog = sys.argv[1], sys.argv[2], sys.argv[3]
signal.signal(signal.SIGTERM, signal.SIG_IGN)
s = subprocess.Popen([sys.executable, stand, "--wrap", "unit", "--", "sleep", "30"])
while not os.path.exists(tag + ".sup"):
    time.sleep(0.02)
subprocess.Popen(["systemd-run", "--user", "--scope", "--collect", "--quiet", "--", sys.executable, hog, tag])
s.wait()
PY
    tp="$TMP/t38c.tmp"; mkdir -p "$tp"; tg="$TMP/t38c"; L38="$LOG/c"; sublog "$L38" >/dev/null || { ok38=0; det38="$det38 (c) sublog failed;"; }
    env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$L38" RL_T38_TAG="$tg" RL_T38_LIB="$UT" RUNLIMITS_TEST_NO_TIME_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t38c -- "$LPY" "$TMP/l38c.py" "$tg" "$D38/runlimits.py" "$TMP/hog38.py" >"$tg.out" 2>"$tg.err" &
    op=$!; save_pid "$TMP/root-$op.pid" "$op"
    if ! wait_file "$tg.sup" 20 || ! wait_file "$tg.hog" 20; then
        ok38=0; det38="$det38 (c) stand-in or hog never started: $(tr '\n' ' ' <"$tg.err" | head -c 300);"
        kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"; wait "$op"
        signal_file KILL "$tg.hog" "$tg.err"
    else
        sp=$(cat "$tg.sup"); hp=$(cat "$tg.hog"); t0=$(now)
        wait_pidfile "$TMP/root-$op.pid" 30 "$t0"; tend=$(now); d=$(secs_between "$t0" "$tend")
        sa=n; alive "$sp" && sa=y; ha=n; alive "$hp" && ha=y
        wait "$op"; rc38=$?
        signal_file KILL "$tg.sup" "$tg.err"; signal_file KILL "$tg.hog" "$tg.err"
        sk=$(jfind "$L38" label t38c stop_kill); ds=$(jfind "$L38" label t38c during_stop); lim=$(jfind "$L38" label t38c limit)
        n38=$(grep -c '^RUNLIMITS: t38c killed' "$tg.err")
        re='^RUNLIMITS: t38c killed: mem [0-9]+ MB > 150 MB, then [0-9]+ MB during the stop, nested supervisors not spared \(profile teeth\)$'
        if [ $rc38 = 86 ] && [ "$lim" = mem ] && [ "$sk" = sparing ] && [ "$ds" = mem ] && [ "$n38" = 1 ] && grep -qE "$re" "$tg.err" && [ $sa = n ] && [ $ha = n ] && ! elapsed_ge "$t0" "$tend" 12; then
            det38="$det38 (c) outer gone after $d s, exit 86, stop_kill=sparing during_stop=mem, $(grep -E "$re" "$tg.err");"
        else ok38=0; det38="$det38 (c) outer gone after $d s, exit $rc38, journal limit=$lim stop_kill=$sk during_stop=$ds, stand-in alive=$sa hog alive=$ha, $n38 killed lines: $(grep '^RUNLIMITS:' "$tg.err" | tr '\n' ' ' | head -c 400);"; fi
    fi
    if [ $ok38 = 1 ]; then pass T38 "$det38"; else fail T38 "$det38"; fi
else
    skip T38 "linux-only (a nested scope outside the outer's kernel limit), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T39 (Linux)
# a nested supervisor is known by the mark it publishes, not by its argv: the
# outer's child has a supervisor's argv (`python3 <dir>/runlimits.py --wrap
# unit -- ...`) and stays alive 15 s after SIGTERM, but (a) publishes no mark,
# (b) publishes runlimits-<pid>-s0-* (start time not its own). SIGTERM to the
# outer -> no grace beyond GRACE_S: the outer is gone within 10 s, the child
# with it.
if want T39; then
if [ $PLAT = linux ]; then
    begin T39
    ok39=1; det39=""
    D39="$TMP/t39imi"; mkdir -p "$D39"
    cat >"$D39/runlimits.py" <<'PY'
import os, signal, time
tag = os.environ["RL_T39_TAG"]
if os.environ.get("RL_T39_MARK"):
    os.mkdir(os.path.join(os.environ.get("RUNLIMITS_REGISTRY") or os.environ["TMPDIR"], "runlimits-%d-s0-t39" % os.getpid()))
with open(tag + ".imi", "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
def stop(*_):
    time.sleep(15)
    os._exit(143)
signal.signal(signal.SIGTERM, stop)
time.sleep(60)
PY
    for c39 in a b; do
        tp="$TMP/t39$c39.tmp"; mkdir -p "$tp"; tg="$TMP/t39$c39"; mk=""; [ $c39 = b ] && mk=1
        env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$(sublog "$LOG/$c39")" RL_T39_TAG="$tg" RL_T39_MARK="$mk" "$LPY" "$SUP" --wrap unit --label t39$c39 -- "$LPY" "$D39/runlimits.py" --wrap unit -- sleep 60 >"$tg.out" 2>"$tg.err" &
        op=$!; save_pid "$TMP/root-$op.pid" "$op"
        if ! wait_file "$tg.imi" 20; then
            ok39=0; det39="$det39 ($c39) imitator never started: $(tr '\n' ' ' <"$tg.err" | head -c 300);"
            kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"; wait "$op"; continue
        fi
        ip=$(cat "$tg.imi"); t0=$(now); signal_file TERM "$TMP/root-$op.pid" "$TMP/root-$op.err"
        wait_pidfile "$TMP/root-$op.pid" 30 "$t0"; tend=$(now); d=$(secs_between "$t0" "$tend")
        ia=n; alive "$ip" && ia=y
        wait "$op"; rc39=$?
        signal_file KILL "$tg.imi" "$tg.err"
        if elapsed_ge "$t0" "$tend" 10 || [ $ia = y ]; then ok39=0; det39="$det39 ($c39) outer gone after $d s (exit $rc39), imitator alive at its exit=$ia;"
        else det39="$det39 ($c39) outer gone after $d s (exit $rc39), imitator dead: no grace;"; fi
    done
    if [ $ok39 = 1 ]; then pass T39 "$det39"; else fail T39 "$det39"; fi
else
    skip T39 "linux-only by pin (nothing platform-bound left since the darwin mark, FIX6), not counted on $PLAT"
fi
fi


# ---------------------------------------------------------------- T40 (darwin)
# darwin publishes the same mark as Linux and spares by it: (a) a running
# supervisor has runlimits-<pid>-s<start>-* in the registry (the private TMPDIR), start = its `ps -o
# lstart=` start (epoch s), gone after its exit; (b) an outer supervisor (unit)
# over a nested one (unit) whose child tree ignores TERM, SIGTERM to the outer
# -> the nested one finishes its stop (journal record written), TMPDIR empty;
# (c) a SIGKILLed supervisor's mark is removed by the next supervisor's start.
if want T40; then
if [ $PLAT = darwin ]; then
    begin T40
    ok40=1; det40=""
    lstart() { LC_ALL=C ps -o lstart= -p "$1" | "$LPY" -c 'import sys, time; s = sys.stdin.read().strip(); print(int(time.mktime(time.strptime(s, "%a %b %d %H:%M:%S %Y"))) if s else "NONE")'; }
    mark_of() { for d40 in "$2"/runlimits-"$1"-s*-*; do [ -d "$d40" ] && { n=${d40##*/runlimits-$1-s}; echo "${n%%-*}"; return 0; }; done; echo NONE; }
    tp="$TMP/t40a.tmp"; mkdir -p "$tp"
    env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$(sublog "$LOG/a")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t40a -- sleep 2 >"$TMP/t40a.out" 2>"$TMP/t40a.err" &
    sp=$!; t0=$(now); m=NONE
    while [ "$m" = NONE ] && ! elapsed_ge "$t0" "$(now)" 5; do m=$(mark_of "$sp" "$tp"); sleep 0.05; done
    ls40=$(lstart "$sp"); wait "$sp"; left=$(ls -A "$tp" | tr '\n' ' ')
    if [ "$m" = NONE ] || [ "$m" != "$ls40" ] || [ -n "$left" ]; then ok40=0; det40="$det40 (a) mark start=$m, ps lstart=$ls40, left after exit '$left': $(tr '\n' ' ' <"$TMP/t40a.err" | head -c 200);"
    else det40="$det40 (a) mark s$m = ps lstart of $sp, removed at exit;"; fi
    tp="$TMP/t40b.tmp"; mkdir -p "$tp"; tg="$TMP/t40b"
    cat >"$TMP/term40.sh" <<SH
trap '' TERM
sleep 60 &
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$! "\$1.gc"
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$\$ "\$1.c"
wait
SH
    env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$(sublog "$LOG/b")" "$LPY" "$SUP" --wrap unit --label t40bo -- "$LPY" "$SUP" --wrap unit --label t40bn -- "$BASHBIN" "$TMP/term40.sh" "$tg" >"$tg.out" 2>"$tg.err" &
    op=$!; save_pid "$TMP/root-$op.pid" "$op"
    if ! wait_file "$tg.c" 20 || ! wait_file "$tg.gc" 5; then ok40=0; det40="$det40 (b) nested child never started: $(tr '\n' ' ' <"$tg.err" | head -c 200);"
        kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"; wait "$op"
    else
        t0=$(now); signal_file TERM "$TMP/root-$op.pid" "$TMP/root-$op.err"; wait_pidfile "$TMP/root-$op.pid" 40 "$t0"; d=$(secs_between "$t0" "$(now)")
        left=$(ls -A "$tp" | tr '\n' ' '); jn=$(jfind "$LOG/b" label t40bn exit); wait "$op"
        for f in "$tg.c" "$tg.gc"; do signal_file KILL "$f" "$tg.err"; done
        if [ "$jn" = MISSING ] || [ -n "$left" ]; then ok40=0; det40="$det40 (b) outer gone after $d s, nested journal exit=$jn, left '$left': $(grep '^RUNLIMITS:' "$tg.err" | tr '\n' ' ' | head -c 200);"
        else det40="$det40 (b) outer gone after $d s, nested finished its stop (journal exit=$jn), TMPDIR empty;"; fi
    fi
    tp="$TMP/t40c.tmp"; mkdir -p "$tp"
    env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$(sublog "$LOG/c")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t40c -- sleep 30 >"$TMP/t40c.out" 2>"$TMP/t40c.err" &
    sp=$!; t0=$(now); m=NONE
    while [ "$m" = NONE ] && ! elapsed_ge "$t0" "$(now)" 5; do m=$(mark_of "$sp" "$tp"); sleep 0.05; done
    kids=$(descendants "$sp"); snapshot_saved "$TMP/t40c.targets" $kids; kill -KILL "$sp"; wait "$sp"; signal_snapshot KILL "$TMP/t40c.targets" "$TMP/t40c.err"
    had=$(ls -A "$tp" | tr '\n' ' ')
    env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$(sublog "$LOG/c")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t40c2 -- true >"$TMP/t40c2.out" 2>"$TMP/t40c2.err"
    left=$(ls -A "$tp" | tr '\n' ' ')
    if [ "$m" = NONE ] || [ -z "$had" ] || [ -n "$left" ]; then ok40=0; det40="$det40 (c) mark=$m, after SIGKILL '$had', after the next start '$left';"
    else det40="$det40 (c) SIGKILLed owner's mark '$had' removed by the next start;"; fi
    if [ $ok40 = 1 ]; then pass T40 "$det40"; else fail T40 "$det40"; fi
else
    skip T40 "darwin-only (the darwin start time of the mark), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T41 (Linux)
# the watchdog ticks inside the 5 s stop windows (SIGTERM sent, SIGKILL not
# yet). The load: a launcher (the outer's child) runs, in a scope of its own
# (the outer's kernel limit does not reach it), a grower; both survive SIGTERM.
# Outer profile teeth (150 MB, 3 s). (a) SIGTERM to the outer, the grower grows
# on TERM past 150 MB -> SIGKILL at once, not after GRACE_S; (b) time stop at
# 3 s, same growth -> at once; (c) memory stop, 200 MB held, no growth -> the
# TERM window is kept (SIGKILL only after GRACE_S); (d) memory stop, 200 MB
# grown to 360 MB on TERM (> 10 % of the level at the stop's start) -> at once,
# one line naming both (`killed: mem <n> MB > 150 MB, then grew more than 10%
# over <b> MB to <m> MB during the stop window (profile teeth)`, no other);
# (e) the launcher exits on its own, the grower is left: in the sweep's window
# it grows past 150 MB -> at once; (f) SIGTERM to the outer, the launcher exits
# on it, the grower grows (the wait for the escalation after the child's exit)
# -> at once. Line `killed: mem <n> MB > 150 MB during the stop window
# (profile teeth)`, for (d) the line above; journal exit 86, limit mem, by watchdog,
# stop_kill window / window-growth, during_stop = the stop's own limit.
if want T41; then
if [ $PLAT = linux ]; then
    begin T41
    ok41=1; det41=""
    cat >"$TMP/gl41.py" <<'PY'
import os, signal, subprocess, sys, time
args = sys.argv[1:]
if "--" in args:
    args = args[len(args) - args[::-1].index("--"):]
mode, tag, how = args
if how == "term-exit":
    signal.signal(signal.SIGTERM, lambda *a: os._exit(0))
else:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
g = subprocess.Popen(["systemd-run", "--user", "--scope", "--collect", "--quiet", "--",
                      sys.executable, os.environ["RL_T41_GROW"], mode, tag])
while not os.path.exists(tag + ".ready"):
    time.sleep(0.02)
if how == "exit":
    time.sleep(1.0)
    os._exit(0)
g.wait()
PY
    cat >"$TMP/grow41.py" <<'PY'
import os, signal, sys, time
mode, tag = sys.argv[1], sys.argv[2]
term = []
signal.signal(signal.SIGTERM, lambda *a: term.append(1))
with open(tag + ".grow", "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
held = {"hold": 200, "hold-grow": 200, "now": 300}.get(mode, 0)
bufs = [bytearray(b"\x01") * (held << 20)] if held else []
with open(tag + ".ready", "w") as f:
    f.write("1")
target = {"on-term": 400, "hold-grow": 360}.get(mode)
deadline = time.time() + 30
while time.time() < deadline:
    if term and target and 4 * (len(bufs) - (1 if held else 0)) + held < target:
        bufs.append(bytearray(b"\x01") * (4 << 20))
    time.sleep(0.02)
PY
    for c41 in a b c d e f; do
        tp="$TMP/t41$c41.tmp"; mkdir -p "$tp"; tg="$TMP/t41$c41"; L41="$LOG/$c41"; sublog "$L41" >/dev/null || { ok41=0; det41="$det41 ($c41) sublog failed;"; continue; }
        case $c41 in
            a) mode=on-term; how=stay; knob=RUNLIMITS_TEST_NO_TIME_WATCH; tk=RUNLIMITS_TEST_TIME_S=30 ;;
            b) mode=on-term; how=stay; knob=RL_T41_UNUSED; tk=RL_T41_UNUSED=1 ;;
            c) mode=hold; how=stay; knob=RUNLIMITS_TEST_NO_TIME_WATCH; tk=RUNLIMITS_TEST_TIME_S=30 ;;
            d) mode=hold-grow; how=stay; knob=RUNLIMITS_TEST_NO_TIME_WATCH; tk=RUNLIMITS_TEST_TIME_S=30 ;;
            e) mode=on-term; how=exit; knob=RUNLIMITS_TEST_NO_TIME_WATCH; tk=RUNLIMITS_TEST_TIME_S=30 ;;
            f) mode=on-term; how=term-exit; knob=RUNLIMITS_TEST_NO_TIME_WATCH; tk=RUNLIMITS_TEST_TIME_S=30 ;;
        esac
        ts=$(now)
        env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$L41" RL_T41_GROW="$TMP/grow41.py" "$knob=1" "$tk" "$LPY" "$SUP" --wrap teeth --label "t41$c41" -- "$LPY" "$TMP/gl41.py" "$mode" "$tg" "$how" >"$tg.out" 2>"$tg.err" &
        op=$!; save_pid "$TMP/root-$op.pid" "$op"
        if ! wait_file "$tg.ready" 20; then
            ok41=0; det41="$det41 ($c41) grower never ready: $(tr '\n' ' ' <"$tg.err" | head -c 300);"
            kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"; wait "$op"
            signal_file KILL "$tg.grow" "$tg.err"
            continue
        fi
        t0=$(now); gp=$(cat "$tg.grow")
        case $c41 in a|f) signal_file TERM "$TMP/root-$op.pid" "$TMP/root-$op.err" ;; esac
        wait_pidfile "$TMP/root-$op.pid" 30 "$t0"; tend=$(now); d=$(secs_between "$t0" "$tend"); dS=$(secs_between "$ts" "$tend")
        ga=n; alive "$gp" && ga=y
        wait "$op"; rc41=$?
        signal_file KILL "$tg.grow" "$tg.err"
        lim=$(jfind "$L41" label "t41$c41" limit); by=$(jfind "$L41" label "t41$c41" by)
        dst=$(jfind "$L41" label "t41$c41" during_stop); sk=$(jfind "$L41" label "t41$c41" stop_kill)
        W='during the stop window \(profile teeth\)$'
        okc=n
        case $c41 in
            a|f) ! elapsed_ge "$t0" "$tend" 3.5 && [ "$sk" = window ] && [ "$dst" = null ] && grep -qE "^RUNLIMITS: t41$c41 killed: mem [0-9]+ MB > 150 MB $W" "$tg.err" && okc=y ;;
            b) ! elapsed_ge "$ts" "$tend" 6.5 && [ "$sk" = window ] && [ "$dst" = time ] && grep -qE "^RUNLIMITS: t41b killed: mem [0-9]+ MB > 150 MB $W" "$tg.err" && okc=y ;;
            c) elapsed_ge "$t0" "$tend" 4.5 && [ "$sk" = MISSING ] && [ "$dst" = MISSING ] && grep -qE '^RUNLIMITS: t41c killed: mem [0-9]+ MB > 150 MB \(profile teeth\)$' "$tg.err" && okc=y ;;
            d) ! elapsed_ge "$t0" "$tend" 3.5 && [ "$sk" = window-growth ] && [ "$dst" = mem ] && [ "$(grep -c '^RUNLIMITS: t41d killed' "$tg.err")" = 1 ] && grep -qE "^RUNLIMITS: t41d killed: mem [0-9]+ MB > 150 MB, then grew more than 10% over [0-9]+ MB to [0-9]+ MB $W" "$tg.err" && okc=y ;;
            e) ! elapsed_ge "$t0" "$tend" 4.5 && [ "$sk" = window ] && [ "$dst" = null ] && grep -qE "^RUNLIMITS: t41e killed: mem [0-9]+ MB > 150 MB $W" "$tg.err" && okc=y ;;
        esac
        if [ $okc = y ] && [ $ga = n ] && [ $rc41 = 86 ] && [ "$lim" = mem ] && [ "$by" = watchdog ]; then
            det41="$det41 ($c41) gone $d s after ready, exit $rc41, stop_kill=$sk during_stop=$dst;"
        else
            ok41=0; det41="$det41 ($c41) gone $d s after ready ($dS s after start), exit $rc41, grower alive at the outer's exit=$ga, journal limit=$lim by=$by stop_kill=$sk during_stop=$dst: $(grep '^RUNLIMITS:' "$tg.err" | tr '\n' ' ' | head -c 300);"
        fi
    done
    if [ $ok41 = 1 ]; then pass T41 "$det41"; else fail T41 "$det41"; fi
else
    skip T41 "linux-only (a load outside the outer's kernel limit), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T42 (Linux)
# the memory budget knows a nested supervisor by its mark, not by its argv: the
# outer's child carries a supervisor's argv (`python3 <dir>/runlimits.py --wrap
# unit -- ...`) and publishes no mark; its grower (a scope of its own) holds
# 300 MB -> the outer's watchdog counts it: exit 86, `killed: mem <n> MB > 150
# MB (profile teeth)`, journal limit mem by watchdog.
if want T42; then
if [ $PLAT = linux ]; then
    begin T42
    D42="$TMP/t42imi"; mkdir -p "$D42"
    cat >"$D42/runlimits.py" <<'PY'
import os, signal, subprocess, sys, time
tag = os.environ["RL_T42_TAG"]
signal.signal(signal.SIGTERM, signal.SIG_IGN)
g = subprocess.Popen(["systemd-run", "--user", "--scope", "--collect", "--quiet", "--",
                      sys.executable, "-c", "import os,time\nb=bytearray(b'\\x01')*(300<<20)\n__import__('fixture_pid').record_pid(os.environ['RL_T42_TAG']+'.grow',os.getpid())\ntime.sleep(30)"])
g.wait()
PY
    tp="$TMP/t42.tmp"; mkdir -p "$tp"; tg="$TMP/t42"
    env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" RL_T42_TAG="$tg" RUNLIMITS_TEST_NO_TIME_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t42 -- "$LPY" "$D42/runlimits.py" --wrap unit -- sleep 30 >"$tg.out" 2>"$tg.err" &
    op=$!; save_pid "$TMP/root-$op.pid" "$op"; t0=$(now)
    gp=""; wait_file "$tg.grow" 20 && gp=$(cat "$tg.grow")
    wait_pidfile "$TMP/root-$op.pid" 20 "$t0"; tend=$(now); d=$(secs_between "$t0" "$tend")
    oa=n; alive "$op" && oa=y
    if [ $oa = y ]; then
        signal_file TERM "$TMP/root-$op.pid" "$TMP/root-$op.err"; wait_pidfile "$TMP/root-$op.pid" "$STOP_S"
        kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"
    fi
    wait "$op"; rc42=$?
    [ -n "$gp" ] && signal_file KILL "$tg.grow" "$tg.err"
    lim=$(jfind "$LOG" label t42 limit); by=$(jfind "$LOG" label t42 by)
    if [ $oa = n ] && [ $rc42 = 86 ] && [ "$lim" = mem ] && [ "$by" = watchdog ] && grep -qE '^RUNLIMITS: t42 killed: mem [0-9]+ MB > 150 MB \(profile teeth\)$' "$tg.err"; then
        pass T42 "argv-only supervisor counted: exit 86 after $d s, $(grep '^RUNLIMITS: t42 killed' "$tg.err")"
    else fail T42 "outer alive after 20 s=$oa (then stopped by the tooth), exit $rc42 after $d s, journal limit=$lim by=$by: $(grep '^RUNLIMITS:' "$tg.err" | tr '\n' ' ' | head -c 300)"; fi
else
    skip T42 "linux-only (a load outside the outer's kernel limit), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T43
# `--is-active` knows an ancestor supervisor by its mark, not by its argv: the
# ancestor sets RUNLIMITS_ACTIVE=<its pid>:teeth and runs `runlimits.py
# --is-active teeth`; (a) it carries a supervisor's argv (`python3
# <dir>/runlimits.py --wrap teeth -- ...`) and publishes no mark -> 1 (not
# active); (b) the same with the mark runlimits-<pid>-s0-* (start time not its
# own) -> 1; (c) control: a real supervisor as the ancestor -> 0.
if want T43; then
begin T43
    D43="$TMP/t43imi"; mkdir -p "$D43"
    cat >"$D43/runlimits.py" <<'PY'
import os, subprocess, sys
if os.environ.get("RL_T43_MARK"):
    os.mkdir(os.path.join(os.environ.get("RUNLIMITS_REGISTRY") or os.environ["TMPDIR"], "runlimits-%d-s0-t43" % os.getpid()))
env = dict(os.environ, RUNLIMITS_ACTIVE="%d:teeth" % os.getpid())
sys.exit(subprocess.call([sys.executable, os.environ["RL_T43_SUP"], "--is-active", "teeth"], env=env))
PY
    ok43=1; det43=""
    for c43 in a b c; do
        tp="$TMP/t43$c43.tmp"; mkdir -p "$tp"; mk=""; [ $c43 = b ] && mk=1
        case $c43 in
            a|b) bounded 20 "t43$c43" env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" RL_T43_SUP="$SUP" RL_T43_MARK="$mk" "$LPY" "$D43/runlimits.py" --wrap teeth -- true; want43=1 ;;
            c) bounded 20 "t43$c43" env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t43c -- "$LPY" "$SUP" --is-active teeth; want43=0 ;;
        esac
        if [ "$BRC" = $want43 ]; then det43="$det43 ($c43) --is-active $BRC;"
        else ok43=0; det43="$det43 ($c43) --is-active $BRC, want $want43: $(tr '\n' ' ' <"$TMP/t43$c43.err" | head -c 200);"; fi
    done
    if [ $ok43 = 1 ]; then pass T43 "$det43"; else fail T43 "$det43"; fi
fi

# ---------------------------------------------------------------- T44
# the registry is seen through a TMPDIR change: a bash entry point with the
# prologue (one supervisor) runs a python entry point with the prologue under
# another TMPDIR -> the python one does not wrap itself (one supervisor below
# the teeth shell, RUNLIMITS_DEPTH as in the bash one) and `--is-active teeth`
# there is 0.
if want T44; then
begin T44
    mkdir -p "$TMP/t44other"
    cat >"$TMP/body.t44" <<SH
echo "\$RUNLIMITS_DEPTH" >"\$1.depth"
TMPDIR="$TMP/t44other" "$LPY" "$SUP" --is-active teeth; echo \$? >"\$1.active"
TMPDIR="$TMP/t44other" "$LPY" "$FIX/probe.py" "\$1"
SH
    if [ $FIXOK != 1 ] || ! mkfix bash "$FIX/t44.sh" "$TMP/body.t44"; then fail T44 "fixtures not built"
    else
        bounded 20 t44 env -u RUNLIMITS_ACTIVE RUNLIMITS_HOME="$UT" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$BASHBIN" "$FIX/t44.sh" "$TMP/t44.json"
        act44=$(cat "$TMP/t44.json.active"); bdep44=$(cat "$TMP/t44.json.depth"); dep44=$("$LPY" -c 'import json, sys; print(json.load(open(sys.argv[1])).get("depth"))' "$TMP/t44.json")
        if [ $BRC -ne 0 ]; then fail T44 "fixture exit $BRC: $(tr '\n' ' ' <"$TMP/t44.err" | head -c 300)"
        elif ! m44=$(chain_check "$TMP/t44.json" 1); then fail T44 "under another TMPDIR: $m44; --is-active $act44, depth $dep44 (bash $bdep44)"
        elif [ "$act44" != 0 ] || [ "$dep44" != "$bdep44" ]; then fail T44 "--is-active $act44 (want 0), RUNLIMITS_DEPTH $dep44 (want the bash one, $bdep44)"
        else pass T44 "under another TMPDIR: $m44, --is-active 0, RUNLIMITS_DEPTH $dep44 = the bash one"; fi
    fi
fi

# ---------------------------------------------------------------- T45
# an unfit RUNLIMITS_REGISTRY is a refusal, never a silent fall back to the
# temp dir: (a) a path that does not exist, (b) a symlink to a dir owned by
# neither root nor this uid (ours, with RUNLIMITS_TEST_UID=1 faking our uid
# foreign), (c) a relative path -> 88 and `RUNLIMITS: <label> refused: RUNLIMITS_REGISTRY
# <path>: <reason>`.
if want T45; then
begin T45
    ok45=1; det45=""
    mkdir -p "$TMP/t45dir"; ln -s "$TMP/t45dir" "$TMP/t45link"
    for c45 in a b c; do
        case $c45 in a) r45="$TMP/t45nope" ;; b) r45="$TMP/t45link" ;; c) r45="t45rel" ;; esac
        u45=""; [ $c45 = b ] && u45=1
        bounded 20 "t45$c45" env RUNLIMITS_REGISTRY="$r45" RUNLIMITS_LOG_DIR="$LOG" ${u45:+RUNLIMITS_TEST_UID=$u45} RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label "t45$c45" -- true
        l45=$(grep '^RUNLIMITS:' "$TMP/t45$c45.err" | head -1)
        case "$l45" in
            "RUNLIMITS: t45$c45 refused: RUNLIMITS_REGISTRY $r45: "?*) [ $BRC = 88 ] && { det45="$det45 ($c45) 88, $l45;"; continue; } ;;
        esac
        ok45=0; det45="$det45 ($c45) exit $BRC, line '$l45';"
    done
    if [ $ok45 = 1 ]; then pass T45 "$det45"; else fail T45 "$det45"; fi
fi

# ---------------------------------------------------------------- T46
# a supervisor exports its registry to the child: RUNLIMITS_REGISTRY in the
# child equals the dir that holds the supervisor's mark; (a) no registry given
# (the supervisor's temp dir), (b) a registry given, TMPDIR elsewhere.
if want T46; then
begin T46
    ok46=1; det46=""
    cat >"$TMP/t46.py" <<'PY'
import os, sys
reg = os.environ.get("RUNLIMITS_REGISTRY")
sup = os.environ.get("RUNLIMITS_ACTIVE", "").partition(":")[0]
names = [n for n in os.listdir(reg) if n.startswith("runlimits-%s-s" % sup)] if reg and os.path.isdir(reg) else []
print("%s %d" % (reg, len(names)))
PY
    for c46 in a b; do
        tp="$TMP/t46$c46.tmp"; mkdir -p "$tp"
        case $c46 in
            a) bounded 20 t46a env -u RUNLIMITS_REGISTRY TMPDIR="$tp" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t46a -- "$LPY" "$TMP/t46.py" ;;
            b) mkdir -p "$TMP/t46b.other"; bounded 20 t46b env RUNLIMITS_REGISTRY="$tp" TMPDIR="$TMP/t46b.other" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t46b -- "$LPY" "$TMP/t46.py" ;;
        esac
        o46=$(cat "$TMP/t46$c46.out")
        r46=$("$LPY" -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$tp")
        if [ $BRC = 0 ] && [ "$o46" = "$r46 1" ]; then det46="$det46 ($c46) child RUNLIMITS_REGISTRY=$r46 holds the supervisor's mark;"
        else ok46=0; det46="$det46 ($c46) exit $BRC, child saw '$o46' (want '$r46 1'): $(tr '\n' ' ' <"$TMP/t46$c46.err" | head -c 200);"; fi
    done
    if [ $ok46 = 1 ]; then pass T46 "$det46"; else fail T46 "$det46"; fi
fi

# ---------------------------------------------------------------- T47, T48
# a process that waits for a nested supervisor is spared with it: the outer
# (profile teeth, time watch muted) runs bash whose EXIT trap waits for a
# stand-in nested supervisor (real mark in the registry, stop 2*GRACE_S on
# SIGTERM), then writes a witness. SIGTERM to the outer. T47: the witness is
# written and the outer exits with bash's own 143, not 137, soon after bash
# (before NESTED_STOP_S - 5 s: the window does not outlive the spared). T48: after the
# witness the trap blocks for good -> bash is SIGKILLed at the end of the
# window, the outer gone no later than NESTED_STOP_S + 4 s after SIGTERM.
NST=$("$LPY" -B -c 'import sys; sys.path.insert(0, sys.argv[1]); import runlimits as r; print(int(r.NESTED_STOP_S))' "$UT")
anc_case() { # tooth tag mode
    local t=$1 tg="$TMP/$2" mode=$3 tp="$TMP/$2.tmp" op sp t0 tend d rc
    mkdir -p "$tp"; rm -f "$tg.fifo"; mkfifo "$tg.fifo"
    cat >"$TMP/sa4x.py" <<'PY'
import os, signal, sys, tempfile, time
sys.dont_write_bytecode = True
sys.path.insert(0, os.environ["RL_T4X_LIB"])
from runlimits import proc_start, GRACE_S
tag = sys.argv[1]
d = tempfile.mkdtemp(prefix="runlimits-%d-s%s-" % (os.getpid(), proc_start(os.getpid())), dir=os.environ["RUNLIMITS_REGISTRY"])
def stop(*_):
    time.sleep(2 * GRACE_S)
    os.rmdir(d)
    os._exit(143)
signal.signal(signal.SIGTERM, stop)
with open(tag + ".sa", "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
time.sleep(120)
PY
    cat >"$TMP/$2.sh" <<SH
trap 'exit 143' TERM
"$LPY" "$TMP/sa4x.py" "$tg" &
n=\$!
trap 'wait \$n; echo done >"$tg.witness"; if [ "$mode" = hang ]; then exec 3<>"$tg.fifo"; read -r -u 3 x; fi' EXIT
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$\$ "$tg.bash"
wait \$n
SH
    env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" RL_T4X_LIB="$UT" RUNLIMITS_TEST_NO_TIME_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label "$2" -- "$BASHBIN" "$TMP/$2.sh" >"$tg.out" 2>"$tg.err" &
    op=$!; save_pid "$TMP/root-$op.pid" "$op"
    if ! wait_file "$tg.sa" 20 || ! wait_file "$tg.bash" 20; then
        kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"; wait "$op"
        R4X="never started: $(tr '\n' ' ' <"$tg.err" | head -c 200)"; return 1
    fi
    sp=$(cat "$tg.sa"); bp=$(cat "$tg.bash"); t0=$(now); signal_file TERM "$TMP/root-$op.pid" "$TMP/root-$op.err"
    wait_pidfile "$TMP/root-$op.pid" 40 "$t0"; tend=$(now); d=$(secs_between "$t0" "$tend")
    ba=n; alive "$bp" && ba=y
    kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"; signal_file KILL "$tg.sa" "$tg.err"; signal_file KILL "$tg.bash" "$tg.err"
    wait "$op"; rc=$?
    wit=n; [ -s "$tg.witness" ] && wit=y
    R4X="outer gone $d s after SIGTERM, exit $rc, witness=$wit, bash alive at the outer's exit=$ba, left in the registry '$(ls -A "$tp" | tr '\n' ' ')'"
    case $mode in
        wait) [ $wit = y ] && [ $rc = 143 ] && [ $ba = n ] && [ -z "$(ls -A "$tp")" ] && ! elapsed_ge "$t0" "$tend" "$((NST - 5))" ;;
        hang) [ $wit = y ] && [ $ba = n ] && elapsed_ge "$t0" "$tend" "$((NST - 1))" && ! elapsed_ge "$t0" "$tend" "$((NST + 4))" ;;
    esac
}
if want T47; then
begin T47
    if anc_case T47 t47 wait; then pass T47 "$R4X"; else fail T47 "$R4X"; fi
fi
if want T48; then
begin T48
    if anc_case T48 t48 hang; then pass T48 "$R4X"; else fail T48 "$R4X"; fi
fi

# ---------------------------------------------------------------- T49 (Linux)
# the T41(e) death-window race made deterministic: with the test knob
# RUNLIMITS_TEST_TICK_AFTER_EXIT=1 the watch loop takes one more last_tree
# snapshot after the launcher died and before the loop notices it (the loop
# finds the child a zombie and its descendants already reparented, ps showing
# e.g. `[python3] <defunct>`). The grower, captured by an earlier live tick,
# must survive that snapshot in last_tree: the sweep kills it (it grows past
# 150 MB on TERM) -> outer exit 86, journal limit=mem by=watchdog
# stop_kill=window during_stop=null, `grower alive at the outer's exit=n`.
# 20 repeats, all must be green.
if want T49; then
if [ $PLAT = linux ]; then
    begin T49
    cat >"$TMP/gl49.py" <<'PY'
import os, signal, subprocess, sys, time
args = sys.argv[1:]
if "--" in args:
    args = args[len(args) - args[::-1].index("--"):]
mode, tag, how = args
signal.signal(signal.SIGTERM, signal.SIG_IGN)
g = subprocess.Popen(["systemd-run", "--user", "--scope", "--collect", "--quiet", "--",
                      sys.executable, os.environ["RL_T49_GROW"], mode, tag])
while not os.path.exists(tag + ".ready"):
    time.sleep(0.02)
if how == "exit":
    time.sleep(1.0)
    os._exit(0)
g.wait()
PY
    cat >"$TMP/grow49.py" <<'PY'
import os, signal, sys, time
mode, tag = sys.argv[1], sys.argv[2]
term = []
signal.signal(signal.SIGTERM, lambda *a: term.append(1))
with open(tag + ".grow", "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
with open(tag + ".ready", "w") as f:
    f.write("1")
bufs = []
deadline = time.time() + 30
while time.time() < deadline:
    if term and 4 * len(bufs) < 400:
        bufs.append(bytearray(b"\x01") * (4 << 20))
    time.sleep(0.02)
PY
    ok49=1; det49=""; n49=0
    while [ $ok49 = 1 ] && [ $n49 -lt 20 ]; do
        n49=$((n49+1))
        tp="$TMP/t49-$n49.tmp"; mkdir -p "$tp"; tg="$TMP/t49-$n49"; L49="$LOG/r$n49"; mkdir -p "$L49"; sublog "$L49" >/dev/null || { ok49=0; det49="rep $n49: sublog failed"; break; }
        env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$L49" RL_T49_GROW="$TMP/grow49.py" RUNLIMITS_TEST_NO_TIME_WATCH=1 RUNLIMITS_TEST_TICK_AFTER_EXIT=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label "t49-$n49" -- "$LPY" "$TMP/gl49.py" on-term "$tg" exit >"$tg.out" 2>"$tg.err" &
        op=$!; save_pid "$TMP/root-$op.pid" "$op"
        if ! wait_file "$tg.ready" 20; then
            ok49=0; det49="rep $n49: grower never ready: $(tr '\n' ' ' <"$tg.err" | head -c 300)"
            kill_saved_tree "$TMP/root-$op.pid" "$TMP/root-$op.err"; wait "$op"
            signal_file KILL "$tg.grow" "$tg.err"
            break
        fi
        t0=$(now); gp=$(cat "$tg.grow")
        wait_pidfile "$TMP/root-$op.pid" 30 "$t0"; tend=$(now); d=$(secs_between "$t0" "$tend")
        ga=n; alive "$gp" && ga=y
        wait "$op"; rc49=$?
        signal_file KILL "$tg.grow" "$tg.err"
        lim=$(jfind "$L49" label "t49-$n49" limit); by=$(jfind "$L49" label "t49-$n49" by)
        dst=$(jfind "$L49" label "t49-$n49" during_stop); sk=$(jfind "$L49" label "t49-$n49" stop_kill)
        if [ $rc49 = 86 ] && [ $ga = n ] && [ "$lim" = mem ] && [ "$by" = watchdog ] && [ "$sk" = window ] && [ "$dst" = null ]; then
            det49="$det49 rep $n49: gone $d s, exit 86, grower alive at the outer's exit=n;"
        else
            ok49=0; det49="rep $n49: gone $d s, exit $rc49, grower alive at the outer's exit=$ga, journal limit=$lim by=$by stop_kill=$sk during_stop=$dst: $(grep '^RUNLIMITS:' "$tg.err" | tr '\n' ' ' | head -c 300)"
        fi
    done
    if [ $ok49 = 1 ]; then pass T49 "20 repeats, the sweep always got the reparented grower"; else fail T49 "$det49"; fi
else
    skip T49 "linux-only (a load outside the outer's kernel limit), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T50 (Linux)
# the default registry is validated like an explicit one, and a shared dir
# passes: on usbox, with TMPDIR and RUNLIMITS_REGISTRY unset (env -u), the temp
# dir is the root-owned sticky /tmp. There a supervisor must not refuse: a
# nested `--is-active teeth` is 0, a nested `--wrap` exits 0, RUNLIMITS_DEPTH
# grew by exactly one, and after the run /tmp holds no mark of this run
# (`runlimits-<supervisor pid>-s*` must be gone).
if want T50; then
if [ $PLAT = linux ]; then
    begin T50
    d0=${RUNLIMITS_DEPTH:-0}
    cat >"$TMP/t50body.sh" <<SH
printf '%s' "\$RUNLIMITS_REGISTRY" >"$TMP/t50.reg"
"$LPY" "$SUP" --is-active teeth; echo \$? >"$TMP/t50.active"
echo "\$RUNLIMITS_DEPTH" >"$TMP/t50.depth"
"$LPY" "$SUP" --wrap teeth --label t50inner -- true &
ip=\$!; "$LPY" "$RL_FIXTURE_PID_HELPER" "$TMP/t50.innerpid" "\$ip"; wait "\$ip"; echo \$? >"$TMP/t50.inner"
SH
    bounded 25 t50 env -u TMPDIR -u TEMP -u TMP -u RUNLIMITS_REGISTRY RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t50 -- "$BASHBIN" "$TMP/t50body.sh"
    # a result file the wrapped body never wrote is a judged outcome (reads
    # empty); a present file that cannot be read fails the tooth naming it
    act50=""; dep50=""; inn50=""; ip50=""; reg50=""; bad50=""
    for r50 in active depth inner innerpid reg; do
        [ -e "$TMP/t50.$r50" ] || continue
        v50=$(cat "$TMP/t50.$r50") || { bad50="$bad50 t50.$r50"; continue; }
        case $r50 in
            active) act50=$v50 ;; depth) dep50=$v50 ;; inner) inn50=$v50 ;;
            innerpid) ip50=$v50 ;; reg) reg50=$v50 ;;
        esac
    done
    rt50=$("$LPY" -c 'import os, sys; print(os.path.realpath("/tmp"))')
    left50=""
    for m50 in "$rt50"/runlimits-$BPID-s* "$rt50"/runlimits-$ip50-s*; do [ -e "$m50" ] && left50="$left50${left50:+ }$m50"; done
    if [ -n "$bad50" ]; then fail T50 "unreadable result file(s):$bad50"
    elif [ $BRC = 0 ] && [ "$act50" = 0 ] && [ "$inn50" = 0 ] && [ "$dep50" = "$((d0 + 1))" ] && [ -z "$left50" ] && [ "$reg50" = "$rt50" ]; then
        pass T50 "under the shared /tmp registry ($rt50): child RUNLIMITS_REGISTRY=$reg50, --is-active 0, nested --wrap 0, depth $dep50 (one layer), no mark of the run left"
    else fail T50 "outer exit $BRC, child registry '$reg50' (want '$rt50'), --is-active $act50 (want 0), nested wrap $inn50 (want 0), depth $dep50 (want $((d0 + 1))), left: '$left50': $(grep '^RUNLIMITS:' "$TMP/t50.err" | tr '\n' ' ' | head -c 300)"; fi
else
    skip T50 "linux-only (the shared root-owned sticky /tmp as the default; on darwin the default /tmp is root's symlink to /private/tmp, followed per T56), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T51
# the default branch is checked too, without an explicit RUNLIMITS_REGISTRY:
# TMPDIR names an existing dir that is not sticky and, under the test knob
# RUNLIMITS_TEST_UID=1 (our own uid faked to a foreign one), is not ours ->
# `--wrap` refuses 88 with `refused: RUNLIMITS_REGISTRY <dir> (from
# gettempdir()): owned by uid <n>, not 1 and not sticky`.
if want T51; then
begin T51
    tp="$TMP/t51.tmp"; mkdir -p "$tp"
    bounded 20 t51 env -u RUNLIMITS_REGISTRY TMPDIR="$tp" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_UID=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t51 -- true
    l51=$(grep '^RUNLIMITS:' "$TMP/t51.err" | head -1)
    ok51=n
    if [ $BRC = 88 ]; then
        case "$l51" in "RUNLIMITS: t51 refused: RUNLIMITS_REGISTRY $tp (from gettempdir()): owned by uid "*?*) ok51=y ;; esac
    fi
    if [ $ok51 = y ]; then pass T51 "88, $l51"; else fail T51 "exit $BRC, line '$l51' (want 88 with the gettempdir reason)"; fi
fi

# ---------------------------------------------------------------- T52
# marks in a shared registry are believed only when they are ours: the case
# runs under a sticky (shared-mode) registry; the supervisor publishes its real
# mark there, and a reader with RUNLIMITS_TEST_UID=1 (our uid faked foreign)
# must not count that mark -> `--is-active teeth` exits 1 (not active). The
# registry dir itself still passes (sticky), so the refusal is the mark's uid,
# not the dir's.
if want T52; then
begin T52
    tp="$TMP/t52.tmp"; mkdir -p "$tp"; chmod 1777 "$tp"
    bounded 20 t52 env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t52 -- env RUNLIMITS_TEST_UID=1 "$LPY" "$SUP" --is-active teeth
    if [ $BRC = 1 ]; then pass T52 "--is-active 1: a foreign uid does not count our mark in the shared registry"; else fail T52 "--is-active $BRC (want 1): $(tr '\n' ' ' <"$TMP/t52.err" | head -c 300)"; fi
fi

# ---------------------------------------------------------------- T53
# a symlink named like a mark is not a mark: a stand-in publishes
# runlimits-<pid>-s<true proc_start>-t53 as a SYMLINK to a real dir in the
# registry and runs `--is-active teeth` as its own child with that marker -> 1.
# Following the link (os.path.isdir) would have accepted it (it matches pid and
# live start time exactly); lstat must see the link and skip it.
if want T53; then
begin T53
    cat >"$TMP/t53stand.py" <<'PY'
import os, subprocess, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.environ["RL_T53_LIB"])
from runlimits import proc_start
reg = os.environ["RUNLIMITS_REGISTRY"]
os.mkdir(os.path.join(reg, "t53target"))
start = proc_start(os.getpid())
if start is None:
    sys.stderr.write("proc_start of the stand-in is unreadable\n"); sys.exit(70)
os.symlink(os.path.join(reg, "t53target"), os.path.join(reg, "runlimits-%d-s%d-t53" % (os.getpid(), start)))
env = dict(os.environ, RUNLIMITS_ACTIVE="%d:teeth" % os.getpid())
sys.exit(subprocess.call([sys.executable, os.environ["RL_T53_SUP"], "--is-active", "teeth"], env=env))
PY
    tp="$TMP/t53.tmp"; mkdir -p "$tp"
    bounded 20 t53 env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" RL_T53_LIB="$UT" RL_T53_SUP="$SUP" "$LPY" "$TMP/t53stand.py"
    if [ $BRC = 1 ]; then pass T53 "--is-active 1: the symlink mark was not counted"; else fail T53 "--is-active $BRC (want 1): $(tr '\n' ' ' <"$TMP/t53.err" | head -c 300)"; fi
fi

# ---------------------------------------------------------------- T54
# a registry named through a symlink this uid owns is followed: TMPDIR names
# <own link> -> <own dir>, no RUNLIMITS_REGISTRY -> `--wrap` runs the child
# (exit 0, no refusal) and exports the resolved dir, not the link.
if want T54; then
begin T54
    mkdir -p "$TMP/t54.real"; ln -s "$TMP/t54.real" "$TMP/t54.lnk"
    real54=$("$LPY" -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$TMP/t54.real")
    bounded 20 t54 env -u RUNLIMITS_REGISTRY -u TEMP -u TMP TMPDIR="$TMP/t54.lnk" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t54 -- sh -c 'printf "%s" "$RUNLIMITS_REGISTRY"'
    got54=$(cat "$TMP/t54.out")
    if [ $BRC = 0 ] && [ "$got54" = "$real54" ] && ! grep -q 'refused' "$TMP/t54.err"; then pass T54 "0, child sees RUNLIMITS_REGISTRY=$got54 (the resolved dir)"
    else fail T54 "exit $BRC, child registry '$got54' (want '$real54'): $(grep '^RUNLIMITS:' "$TMP/t54.err" | tr '\n' ' ' | head -c 300)"; fi
fi

# ---------------------------------------------------------------- T55
# a symlink owned by neither root nor this uid is not followed, even when its
# target would pass: the target is a sticky dir, the link is ours, and
# RUNLIMITS_TEST_UID=1 fakes our uid foreign -> `--wrap` refuses 88 naming the
# link's owner.
if want T55; then
begin T55
    mkdir -p "$TMP/t55.real"; chmod 1777 "$TMP/t55.real"; ln -s "$TMP/t55.real" "$TMP/t55.lnk"
    bounded 20 t55 env -u RUNLIMITS_REGISTRY -u TEMP -u TMP TMPDIR="$TMP/t55.lnk" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_UID=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t55 -- true
    l55=$(grep '^RUNLIMITS:' "$TMP/t55.err" | head -1)
    ok55=n
    if [ $BRC = 88 ]; then
        case "$l55" in "RUNLIMITS: t55 refused: RUNLIMITS_REGISTRY $TMP/t55.lnk (from gettempdir()): a symlink owned by uid "*", not 0 and not 1") ok55=y ;; esac
    fi
    if [ $ok55 = y ]; then pass T55 "88, $l55"; else fail T55 "exit $BRC, line '$l55' (want 88 naming the link's owner)"; fi
fi

# ---------------------------------------------------------------- T56
# darwin with no temp variables at all: the default is /tmp, root's symlink to
# /private/tmp; it is followed (root owns it, the target is root's sticky dir)
# -> `--wrap` runs the child (exit 0, no refusal).
if want T56; then
if [ "$PLAT" = darwin ]; then
    begin T56
    bounded 20 t56 env -u RUNLIMITS_REGISTRY -u TMPDIR -u TEMP -u TMP RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t56 -- sh -c 'printf "%s" "$RUNLIMITS_REGISTRY"'
    got56=$(cat "$TMP/t56.out")
    if [ $BRC = 0 ] && [ "$got56" = /private/tmp ] && ! grep -q 'refused' "$TMP/t56.err"; then pass T56 "0, child sees RUNLIMITS_REGISTRY=$got56"
    else fail T56 "exit $BRC, child registry '$got56' (want /private/tmp): $(grep '^RUNLIMITS:' "$TMP/t56.err" | tr '\n' ' ' | head -c 300)"; fi
else
    skip T56 "darwin-only (root's /tmp -> /private/tmp link), not counted on $PLAT"
fi
fi


# ---------------------------------------------------------------- T57
# A1: a reparented descendant stays counted. The child C keeps running while P
# (C's child) exits and G (P's child, delayed grower) reparents away and grows
# past the teeth cap -> 86 by=watchdog (linux: RUNLIMITS_TEST_KERNEL_MEM_MB
# lifts the kernel limit so the watchdog itself fires).
if want T57; then
begin T57
cat >"$TMP/grow57.py" <<'PY'
import os, resource, sys, time
time.sleep(float(sys.argv[1]))
target_mb, hold_s = int(sys.argv[2]), float(sys.argv[3])
if len(sys.argv) > 4:
    with open(sys.argv[4], "w") as f:
        __import__("fixture_pid").record_pid(f.name, os.getpid())
scale = 1 if sys.platform == "darwin" else 1024
deadline = time.time() + 20
bufs = []
while resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale < target_mb * 1048576 and time.time() < deadline:
    bufs.append(bytearray(b"\x01") * (4 << 20))
    time.sleep(0.005)
time.sleep(max(0.0, min(hold_s, deadline - time.time())))
PY
cat >"$TMP/launch57.py" <<'PY'
import subprocess, sys, time
subprocess.Popen([sys.executable] + sys.argv[1:])
time.sleep(1.5)
PY
cat >"$TMP/t57.sh" <<SH
"$LPY" "$TMP/launch57.py" "$TMP/grow57.py" 2.0 300 25 "$TMP/t57.pid" &
sleep 30 &
wait
SH
K57=""; [ $PLAT = linux ] && K57="RUNLIMITS_TEST_KERNEL_MEM_MB=1024"
bounded 25 t57 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_NO_TIME_WATCH=1 $K57 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t57 -- "$BASHBIN" "$TMP/t57.sh"
lim=$(jrec "$LOG" -1 limit); by=$(jrec "$LOG" -1 by)
if [ $BRC -ne 86 ]; then fail T57 "exit $BRC, want 86"; show "$TMP/t57.err"
elif [ "$lim" != mem ] || [ "$by" != watchdog ]; then fail T57 "journal limit=$lim by=$by, want mem/watchdog"; show "$TMP/t57.err"
elif ! grep -q '^RUNLIMITS: t57 killed: mem [0-9.]* MB > 150 MB (profile teeth)$' "$TMP/t57.err"; then fail T57 "no watchdog mem line"; show "$TMP/t57.err"
elif [ -s "$TMP/t57.pid" ] && alive "$(cat "$TMP/t57.pid")"; then fail T57 "reparented grower still alive"
else pass T57 "reparented G counted: exit 86, journal limit=mem by=watchdog"; fi
kill_loads
fi

# ---------------------------------------------------------------- T58 (Linux)
# A2: identity is (pid, start). The fake ps shifts the lstart of one remembered
# pid a year ahead after a flag (same argv, other start = simulated reuse): the
# live "foreign" sleep gets no signal and survives the stop.
if want T58; then
if [ $PLAT = linux ]; then
    begin T58
    # A2: identity is (pid, start). A live process outside the child tree whose
    # pid is remembered with ANOTHER start (a reused pid) must not be in the
    # signal targets of recheck(): it is foreign.
    probe58() { # <shift 0|1> -> prints YES/NO (in targets) for the probed pid
        "$LPY" - "$UT/runlimits.py" "$1" <<'PY'
import os, subprocess, sys, time
lib = sys.argv[1]
shift = sys.argv[2] == "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(lib)))
import runlimits as r
me = subprocess.Popen(["sleep", "55"])
try:
    time.sleep(0.05)
    st = r.proc_start(me.pid, os.environ)
    if shift:
        st = st + 31622400  # a year ahead: same pid, other start
    sup = r.Supervisor.__new__(r.Supervisor)
    sup.ps_lost = False
    sup.env = dict(os.environ, RUNLIMITS_TEST_NO_MEM_WATCH="1")
    sup.child = sup
    sup.child.pid = os.getpid() + 100000  # never a real pid: nothing of ours is in the tree
    sup.last_tree = {me.pid: st}
    sup.term_targets = {}
    sup.plat = "linux"
    out = sup.recheck(sup.last_tree)
    print("YES" if me.pid in out else "NO")
finally:
    me.kill(); me.wait()
PY
    }
    a58=$(probe58 0); b58=$(probe58 1)
    if [ "$a58" != YES ]; then fail T58 "matching (pid,start) dropped from the targets (probe broken)"
    elif [ "$b58" != NO ]; then fail T58 "pid with a shifted start still in the targets (reuse believed)"
    else pass T58 "shifted start = not ours: the reused pid is not a signal target"; fi
fi
fi

# ---------------------------------------------------------------- T59 (Linux)
# A2: exec in a descendant changes argv, pid and start stay -> the collapse
# still reaches the orphan.
if want T59; then
if [ $PLAT = linux ]; then
    begin T59
    # A2: identity is (pid, start). A remembered pid outside the current tree
    # with an UNCHANGED start (an exec'd descendant: new argv, same pid+start)
    # stays a signal target of recheck(): the collapse still reaches it.
    "$LPY" - "$UT/runlimits.py" <<'PY'
import os, subprocess, sys, time
lib = sys.argv[1]
sys.path.insert(0, os.path.dirname(os.path.abspath(lib)))
import runlimits as r
me = subprocess.Popen(["sleep", "55"])
me2 = subprocess.Popen(["sleep", "55"])  # stays out of remembered: control
try:
    time.sleep(0.05)
    st = r.proc_start(me.pid, os.environ)
    sup = r.Supervisor.__new__(r.Supervisor)
    sup.ps_lost = False
    sup.env = dict(os.environ, RUNLIMITS_TEST_NO_MEM_WATCH="1")
    sup.child = sup
    sup.child.pid = os.getpid() + 100000  # never a real pid: nothing of ours is in the tree
    sup.last_tree = {me.pid: st}
    sup.term_targets = {}
    sup.plat = "linux"
    out = sup.recheck(sup.last_tree)
    sys.exit(0 if (me.pid in out and me2.pid not in out) else 1)
finally:
    me.kill(); me.wait(); me2.kill(); me2.wait()
PY
    if [ $? -eq 0 ]; then pass T59 "exec kept identity: the same (pid,start) stays a target, an unknown pid does not"
    else fail T59 "the remembered (pid,start) left the signal targets, or a stranger entered them"; fi
fi
fi

# ---------------------------------------------------------------- T60
# A3/E3: a ps that stops answering costs at most PS_TIMEOUT_S + GRACE_S + 2 s to
# the child (it ignores SIGTERM: only the SIGKILL GRACE_S after it ends it) and
# PS_TIMEOUT_S + GRACE_S + 5 s to the supervisor; exit 88. The fake ps hangs from
# the moment the child is up and stamps its first hung call; the tooth itself
# polls the child's death with kill -0. R6: the child's own-session grandchild,
# remembered by a tick before the hang, gets no signal without a measure on
# darwin: the kept mark carries `unverified` with its `<pid> <start>`, and the
# next supervisor with the same registry (ps back) kills it and removes the
# mark; on Linux the scope's cgroup.kill already took it.
if want T60; then
begin T60
R60="$TMP/t60reg"; mkdir -p "$R60"
# bounds come from the reference library beside this runner, never from the one
# under test: a mutated constant would move its own bound along (M128)
BOUNDS60=$("$LPY" -B -c 'import sys; sys.path.insert(0, sys.argv[1]); import runlimits as r; print("%s %s" % (r.PS_TIMEOUT_S + r.GRACE_S + 2, r.PS_TIMEOUT_S + r.GRACE_S + 5))' "$HERE") || BOUNDS60="12 15"
cat >"$TMP/fake60.sh" <<SH
#!/bin/sh
if [ -e "$TMP/t60.hang" ]; then
    printf '%s\n' "\$*" >>"$TMP/t60.calls"
    [ -e "$TMP/t60.t0" ] || "$LPY" -c 'import time; print("%.3f" % time.time())' >"$TMP/t60.t0"
    exec sleep 60
fi
exec /bin/ps "\$@"
SH
    chmod +x "$TMP/fake60.sh"
    cat >"$TMP/child60.py" <<'PY'
import os, signal, subprocess, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
subprocess.Popen([sys.executable, "-c", "import os, sys, time; os.setsid(); __import__('fixture_pid').record_pid(sys.argv[1], os.getpid()); time.sleep(60)", sys.argv[2]])
end = time.time() + 5
while not os.path.exists(sys.argv[2]) and time.time() < end:
    time.sleep(0.02)
# two watchdog ticks: a snapshot remembers the grandchild before the ps hangs
time.sleep(1.2)
with open(sys.argv[1], "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
time.sleep(60)
PY
    # CONSTRAINT: RUNLIMITS_TEST_PROC_UNREADABLE keeps this stop on the no-/proc path -
    # with /proc readable stop_unmeasured never reaches signal_unmeasured, and the
    # E3 "no second ps" contract (M121) has no place to break
    env RUNLIMITS_REGISTRY="$R60" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_PS="$TMP/fake60.sh" RUNLIMITS_TEST_PROC_UNREADABLE=1 RUNLIMITS_TEST_NO_TIME_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t60 -- "$LPY" "$TMP/child60.py" "$TMP/t60.pid" "$TMP/t60g.pid" >"$TMP/t60.out" 2>"$TMP/t60.err" &
    s60=$!; save_pid "$TMP/t60.supervisor" "$s60"
    c60=""; cd60=""; sd60=""
    if wait_file "$TMP/t60.pid" 10; then
        c60=$(cat "$TMP/t60.pid"); touch "$TMP/t60.hang"
        t0=$(now)
        while [ -z "$cd60" ] || [ -z "$sd60" ]; do
            if [ -z "$cd60" ] && ! kill -0 "$c60"; then cd60=$(now); fi
            if [ -z "$sd60" ] && ! alive "$s60"; then sd60=$(now); fi
            elapsed_ge "$t0" "$(now)" 40 && break
            sleep 0.05
        done
    fi
    kill_saved_tree "$TMP/t60.supervisor" "$TMP/t60.err"
    [ -n "$c60" ] && signal_file KILL "$TMP/t60.pid" "$TMP/t60.err"
    wait "$s60"; rc60=$?
    lim=$(jrec "$LOG" -1 limit)
    # a stamp the shim never wrote is a judged outcome (v60 names it); a present
    # stamp that cannot be read fails the tooth naming it
    t060=""; unread60=n
    if [ -e "$TMP/t60.t0" ]; then t060=$(cat "$TMP/t60.t0") || unread60=y; fi
    v60=$("$LPY" - "$t060" "$cd60" "$sd60" $BOUNDS60 <<'PY'
import sys
t0, cd, sd, bc, bs = (sys.argv[1:] + [""] * 5)[:5]
if not t0:
    print("no hung-call stamp"); sys.exit(1)
if not cd:
    print("child never died"); sys.exit(1)
if not sd:
    print("supervisor never exited"); sys.exit(1)
dc, ds = float(cd) - float(t0), float(sd) - float(t0)
print("child dead %.2fs, supervisor gone %.2fs after the first hung ps (bounds %s / %s s)" % (dc, ds, bc, bs))
sys.exit(0 if dc <= float(bc) and ds <= float(bs) else 1)
PY
)
    ok60=$?
    g60=""; [ -s "$TMP/t60g.pid" ] && g60=$(cat "$TMP/t60g.pid")
    u60=""; m60=""
    if [ -n "$g60" ] && [ $PLAT = darwin ]; then
        gst60=$(cat "$TMP/t60g.pid.start")
        m60=$(firstmatch "$R60"/runlimits-$s60-s*)
        if [ -z "$m60" ]; then u60="no mark runlimits-$s60-s* kept in $R60: $(ls "$R60" | tr '\n' ' ')"
        elif [ ! -s "$m60/unverified" ]; then u60="kept mark $m60 has no unverified file: $(ls "$m60" | tr '\n' ' ')"
        elif ! grep -qx "$g60 $gst60" "$m60/unverified"; then u60="unverified lacks '$g60 $gst60': $(tr '\n' ';' <"$m60/unverified")"
        elif ! alive "$g60"; then u60="grandchild $g60 already dead before the next supervisor: nothing left for the reap to prove"
        else
            bounded 20 t60n env RUNLIMITS_REGISTRY="$R60" RUNLIMITS_LOG_DIR="$(sublog "$LOG/n")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t60n -- true
            if [ $BRC -ne 0 ]; then u60="next supervisor exit $BRC: $(tr '\n' ' ' <"$TMP/t60n.err" | head -c 200)"
            elif ! wait_pidfile "$TMP/t60g.pid" 3; then u60="grandchild $g60 alive after the next supervisor's reap"
            elif [ -e "$m60" ]; then u60="mark $m60 still there after the next supervisor's reap"
            fi
        fi
    elif [ -n "$g60" ]; then
        wait_pidfile "$TMP/t60g.pid" 3 || u60="grandchild $g60 alive after the stop: the scope did not take it"
    else u60="grandchild pid never written"
    fi
    n60=""; [ -s "$TMP/t60.calls" ] && n60=$(wc -l <"$TMP/t60.calls" | tr -d ' ')
    if [ $unread60 = y ]; then fail T60 "stamp file $TMP/t60.t0 unreadable"; show "$TMP/t60.err"
    elif [ -z "$c60" ]; then fail T60 "child never started"; show "$TMP/t60.err"
    elif [ $rc60 != 88 ] || [ "$lim" != unavailable ]; then fail T60 "exit $rc60, journal limit=$lim (want 88/unavailable); $v60"; show "$TMP/t60.err"
    elif [ $ok60 -ne 0 ]; then fail T60 "$v60"; show "$TMP/t60.err"
    elif [ "$n60" != 1 ]; then fail T60 "$v60; ps calls after the first hang: ${n60:-0} (want 1: the failing watch snapshot only)"; show "$TMP/t60.err"
    elif [ -n "$u60" ]; then fail T60 "$v60; $u60"; show "$TMP/t60.err"
    elif [ $PLAT = darwin ]; then pass T60 "88/limit=unavailable, $v60; one ps call after the hang; grandchild $g60 in unverified of the kept mark, killed by the next reap, mark removed"
    else pass T60 "88/limit=unavailable, $v60; one ps call after the hang; grandchild $g60 taken by the scope"; fi
    kill_loads
fi

# ---------------------------------------------------------------- T61 (darwin)
# A4: Ctrl-Z stops the whole tree, a descendant in its own session included;
# fg/SIGCONT resumes it.
if want T61; then
if [ "$PLAT" = darwin ]; then
    begin T61
    D61="$TMP/t61"; mkdir -p "$D61"
    cat >"$TMP/sess61.py" <<'PY'
import os, sys, time
d = sys.argv[1]
os.setsid()
n, end = 0, time.time() + 60
while not os.path.exists(os.path.join(d, "stop")) and time.time() < end:
    n += 1
    with open(os.path.join(d, "count"), "w") as f:
        f.write(str(n))
    time.sleep(0.05)
PY
    cat >"$TMP/tick61.py" <<'PY'
import os, subprocess, sys, time
d = sys.argv[1]
p = subprocess.Popen([sys.executable, os.environ["RL_T61_SESS"], d])
with open(os.path.join(d, "child"), "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid(), payload="%d %d" % (os.getpid(), os.getpgrp()))
n, end = 0, time.time() + 60
while not os.path.exists(os.path.join(d, "stop")) and time.time() < end:
    n += 1
    with open(os.path.join(d, "ticks.tmp"), "w") as f:
        f.write(str(n))
    os.replace(os.path.join(d, "ticks.tmp"), os.path.join(d, "ticks"))
    time.sleep(0.05)
open(os.path.join(d, "stop"), "w").close()
p.wait()
PY
    cat >"$TMP/jc61.py" <<'PY'
import json, os, signal, subprocess, sys, time
d, cmd = sys.argv[1], sys.argv[2:]
fd = os.open("/dev/tty", os.O_RDWR)
signal.signal(signal.SIGTTOU, signal.SIG_IGN)
shell = os.getpgrp()
steps = []
def step(name, cond):
    steps.append([name, bool(cond)])
def count():
    try:
        return int(open(os.path.join(d, "count")).read())
    except (OSError, ValueError):
        return -1
def frozen(t=0.8):
    a = count(); time.sleep(t); return count() == a
def until(pred, t):
    end = time.time() + t
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return False
def wait_job(pid, t):
    end = time.time() + t
    while time.time() < end:
        p, st = os.waitpid(pid, os.WNOHANG | os.WUNTRACED)
        if p:
            if os.WIFSTOPPED(st):
                return ("stopped", os.WSTOPSIG(st))
            return ("exited", os.waitstatus_to_exitcode(st))
        time.sleep(0.02)
    return ("timeout", None)
pid = os.fork()
if pid == 0:
    os.setpgid(0, 0)
    while os.tcgetpgrp(fd) != os.getpgrp():
        time.sleep(0.01)
    signal.signal(signal.SIGTTOU, signal.SIG_DFL)
    os.execvp(cmd[0], cmd)
try:
    os.setpgid(pid, pid)
except OSError:
    pass
os.tcsetpgrp(fd, pid)
if not until(lambda: os.path.exists(os.path.join(d, "child")), 5):
    step("child started", False)
    os.kill(pid, signal.SIGKILL)
else:
    cpid, cpg = map(int, open(os.path.join(d, "child")).read().split())
    step("session descendant counting", until(lambda: count() > 0, 5))
    os.killpg(os.tcgetpgrp(fd), signal.SIGTSTP)
    r = wait_job(pid, 5)
    step("Ctrl-Z: job stopped (%s %s)" % r, r[0] == "stopped")
    os.tcsetpgrp(fd, shell)
    step("session descendant stopped while the job stands", frozen())
    os.tcsetpgrp(fd, pid)
    os.killpg(pid, signal.SIGCONT)
    step("fg: session descendant runs again", until(lambda: not frozen(0.5), 5))
    open(os.path.join(d, "stop"), "w").close()
    r = wait_job(pid, 10)
    step("job exited (%s %s)" % r, r == ("exited", 0))
    if r[0] != "exited":
        os.kill(pid, signal.SIGKILL)
with open(os.path.join(d, "steps.json"), "w") as f:
    json.dump(steps, f)
PY
    bounded 60 t61 script -q /dev/null "$LPY" "$TMP/jc61.py" "$D61" env RL_T61_SESS="$TMP/sess61.py" RUNLIMITS_LOG_DIR="$LOG" "$LPY" "$SUP" --wrap unit --label t61 -- "$LPY" "$TMP/tick61.py" "$D61"
    msg=$("$LPY" - "$D61/steps.json" <<'PY'
import json, sys
try:
    steps = json.load(open(sys.argv[1]))
except (OSError, ValueError) as e:
    print("no steps: %s" % e); sys.exit(1)
bad = [n for n, ok in steps if not ok]
print("; ".join(("FAILED " if not ok else "") + n for n, ok in steps))
sys.exit(1 if bad or not steps else 0)
PY
)
    if [ $? -ne 0 ]; then fail T61 "$msg"; show "$TMP/t61.out"
    else pass T61 "$msg"; fi
else
    skip T61 "darwin-only (job control), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T62 T63
# A5: the registry dir is ours or root's; sticky whenever writable by group or
# others.
if want T62; then
begin T62
tp="$TMP/t62.tmp"; mkdir -p "$tp"; chmod 1777 "$tp"
bounded 20 t62 env RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_UID=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t62 -- true
l62=$(grep '^RUNLIMITS:' "$TMP/t62.err" | head -1)
ok62=n
if [ $BRC = 88 ]; then
    case "$l62" in "RUNLIMITS: t62 refused: RUNLIMITS_REGISTRY $tp: owned by uid "*", not 1 and not root: a shared registry must be root's") ok62=y ;; esac
fi
if [ $ok62 = y ]; then pass T62 "88, $l62"; else fail T62 "exit $BRC, line '$l62'"; fi
fi

if want T63; then
begin T63
tp="$TMP/t63.tmp"; mkdir -p "$tp"; chmod 0777 "$tp"
bounded 20 t63 env RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t63 -- true
l63=$(grep '^RUNLIMITS:' "$TMP/t63.err" | head -1)
ok63=n
if [ $BRC = 88 ] && [ "$l63" = "RUNLIMITS: t63 refused: RUNLIMITS_REGISTRY $tp: writable by group or others and not sticky" ]; then ok63=y; fi
if [ $ok63 = y ]; then pass T63 "88, $l63"; else fail T63 "exit $BRC, line '$l63'"; fi
fi

# ---------------------------------------------------------------- T64 T65
# A6: every symlink on the chain is checked; the resolved dir is exported.
if want T64; then
begin T64
mkdir -p "$TMP/t64.real/sub"; ln -s "$TMP/t64.real" "$TMP/t64.via"
reg64="$TMP/t64.via/sub"
bounded 20 t64 env RUNLIMITS_REGISTRY="$reg64" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_UID=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t64 -- true
l64=$(grep '^RUNLIMITS:' "$TMP/t64.err" | head -1)
ok64=n
if [ $BRC = 88 ]; then
    case "$l64" in "RUNLIMITS: t64 refused: RUNLIMITS_REGISTRY $TMP/t64.via: a symlink owned by uid "*", not 0 and not 1") ok64=y ;; esac
fi
if [ $ok64 = y ]; then pass T64 "88, intermediate link refused: $l64"; else fail T64 "exit $BRC, line '$l64'"; fi
fi

if want T65; then
begin T65
mkdir -p "$TMP/t65.real/sub"; ln -s "$TMP/t65.real" "$TMP/t65.via"
reg65="$TMP/t65.via/sub"
bounded 20 t65 env RUNLIMITS_REGISTRY="$reg65" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t65 -- sh -c 'printf "%s" "$RUNLIMITS_REGISTRY"'
got65=$(cat "$TMP/t65.out"); want65=$("$LPY" -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$reg65")
if [ $BRC = 0 ] && [ "$got65" = "$want65" ] && ! grep -q 'refused' "$TMP/t65.err"; then pass T65 "0, child sees RUNLIMITS_REGISTRY=$got65 (resolved through the link)"
else fail T65 "exit $BRC, child registry '$got65' (want '$want65'): $(grep '^RUNLIMITS:' "$TMP/t65.err" | tr '\n' ' ' | head -c 300)"; fi
fi

# ---------------------------------------------------------------- T66 (Linux)
# A7: an unreadable start never kills a live owner's mark.
if want T66; then
if [ $PLAT = linux ]; then
    begin T66
    tp="$TMP/t66.tmp"; mkdir -p "$tp"
    env RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$(sublog "$LOG/a")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t66a -- sleep 8 >"$TMP/t66a.out" 2>"$TMP/t66a.err" &
    s66=$!
    m66=""
    t0=$(now)
    while ! elapsed_ge "$t0" "$(now)" 6; do
        m66=$(firstmatch "$tp"/runlimits-$s66-s*)
        [ -n "$m66" ] && break
        sleep 0.05
    done
    bounded 20 t66 env RUNLIMITS_REGISTRY="$tp" RUNLIMITS_TEST_START_UNREADABLE=$s66 RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t66 -- true
    rc66=$BRC
    left66=""; for d66 in "$tp"/runlimits-$s66-s*; do [ -e "$d66" ] && left66="$left66${left66:+ }$d66"; done
    kill -TERM "$s66"; wait "$s66"
    clean66=""; for d66 in "$tp"/runlimits-$s66-s*; do [ -e "$d66" ] && clean66="$clean66${clean66:+ }$d66"; done
    if [ -z "$m66" ]; then fail T66 "live owner's mark never seen in $tp: $(tr '\n' ' ' <"$TMP/t66a.err" | head -c 200)"
    elif [ $rc66 -ne 0 ]; then fail T66 "second supervisor exit $rc66"; show "$TMP/t66.err"
    elif [ -z "$left66" ]; then fail T66 "mark of the live owner vanished while its start was unreadable"
    else pass T66 "unreadable start kept the live owner's mark; after its own exit: '${clean66:-clean}'"; fi
else
    skip T66 "linux-only (/proc liveness + the start knob), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T67 (Linux)
# A8: an unreadable oom sign with a self-exited child: the code passes, the
# verdict does not.
if want T67; then
if [ $PLAT = linux ]; then
    begin T67
    cat >"$TMP/oomkid67.py" <<'PY'
import signal, subprocess, sys
signal.signal(signal.SIGTERM, signal.SIG_IGN)
g = subprocess.run([sys.executable, sys.argv[1], "300", "20"])
with open(sys.argv[2], "w") as f:
    f.write(str(g.returncode))
PY
    bounded 40 t67 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_NO_MEM_WATCH=1 RUNLIMITS_TEST_OOM_SIGN=unreadable RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t67 -- "$LPY" "$TMP/oomkid67.py" "$TMP/alloc.py" "$TMP/t67.gc"
    lim=$(jrec "$LOG" -1 limit); ex=$(jrec "$LOG" -1 exit); os67=$(jrec "$LOG" -1 oom_sign); gc67=$(cat "$TMP/t67.gc" 2>&1)
    if [ $BRC -ne 0 ]; then fail T67 "exit $BRC, want 0 (grandchild code '$gc67')"; show "$TMP/t67.err"
    elif [ "$lim" != unverified ] || [ "$os67" = MISSING ]; then fail T67 "journal limit=$lim oom_sign=$os67, want unverified/<why>"; show "$TMP/t67.err"
    elif ! grep -q '^RUNLIMITS: t67: oom sign unreadable (.*); child exit 0, result not verified$' "$TMP/t67.err"; then fail T67 "no unverified stderr line"; show "$TMP/t67.err"
    else pass T67 "exit 0, journal limit=unverified oom_sign recorded, stderr line present"; fi
    kill_loads
else
    skip T67 "linux-only (kernel oom sign), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T68 (Linux)
# A9: the kernel names no victim when the child itself died: oom_victim is
# unattributed, not "child".
if want T68; then
if [ $PLAT = linux ]; then
    begin T68
    bounded 25 t68 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_NO_MEM_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t68 -- "$LPY" "$TMP/alloc.py" 300 20 "$TMP/t68.pid"
    vic=$(jrec "$LOG" -1 oom_victim); by=$(jrec "$LOG" -1 by); lim=$(jrec "$LOG" -1 limit)
    if [ $BRC -ne 86 ]; then fail T68 "exit $BRC, want 86"; show "$TMP/t68.err"
    elif [ "$vic" != unattributed ] || [ "$by" != kernel ] || [ "$lim" != mem ]; then fail T68 "journal oom_victim=$vic by=$by limit=$lim, want unattributed/kernel/mem"; show "$TMP/t68.err"
    else pass T68 "exit 86, journal oom_victim=unattributed by=kernel"; fi
    kill_loads
else
    skip T68 "linux-only (kernel oom-kill of the child), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T69
# A10/E10: two supervisors rotating at once keep both records, print no failure
# and serialize. The pause knob drops rotate-entered.<pid> inside the critical
# section; the second writer starts only once the first one's flag is there, so
# without the lock it rotates while the first still pauses: from the first flag
# to both writers done takes >= 2 x pause only under the lock.
if want T69; then
begin T69
P69=4
printf '{"seed":1}\n' >"$LOG/runs.jsonl"
env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_ROTATE_BYTES=1 RUNLIMITS_TEST_ROTATE_PAUSE_S=$P69 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t69a -- true >"$TMP/t69a.out" 2>"$TMP/t69a.err" &
pa=$!
f69=""; t0=$(now)
while [ -z "$f69" ] && ! elapsed_ge "$t0" "$(now)" 20; do
    f69=$(firstmatch "$LOG"/rotate-entered.*)
    [ -n "$f69" ] || sleep 0.02
done
pb=""
if [ -n "$f69" ]; then
    env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_ROTATE_BYTES=1 RUNLIMITS_TEST_ROTATE_PAUSE_S=$P69 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t69b -- true >"$TMP/t69b.out" 2>"$TMP/t69b.err" &
    pb=$!
fi
wait "$pa"; ra=$?
rb=0; [ -n "$pb" ] && { wait "$pb"; rb=$?; }
t69end=$(now)
# the shell itself created both err files at launch: their absence or a failed
# read is named, never silently skipped
nf=0; miss69=""
for e69 in "$TMP/t69a.err" "$TMP/t69b.err"; do
    [ -e "$e69" ] || { miss69="$miss69 ${e69##*/}:absent"; continue; }
    n69=$(grep -c '^RUNLIMITS: journal write failed' "$e69"); rc69=$?
    if [ "$rc69" = 2 ]; then miss69="$miss69 ${e69##*/}:unreadable"; continue; fi
    [ "$rc69" = 1 ] && n69=0
    nf=$((nf + n69))
done
msg=$("$LPY" - "$LOG" <<'PY'
import json, os, sys
d = sys.argv[1]
n = 0
for name in ("runs.jsonl", "runs.jsonl.1"):
    p = os.path.join(d, name)
    if not os.path.exists(p):
        continue
    for l in open(p).read().splitlines():
        if not l.strip():
            continue
        try:
            r = json.loads(l)
        except ValueError:
            continue
        if r.get("label") in ("t69a", "t69b"):
            n += 1
print(n)
PY
)
nfl=0; for f69c in "$LOG"/rotate-entered.*; do [ -e "$f69c" ] && nfl=$((nfl+1)); done
span=""; [ -n "$f69" ] && span=$("$LPY" -c 'import os, sys; print("%.2f" % (float(sys.argv[2]) - os.stat(sys.argv[1]).st_mtime))' "$f69" "$t69end")
if [ -n "$miss69" ]; then fail T69 "evidence file(s) missing or unreadable:$miss69"; show "$TMP/t69a.err"; show "$TMP/t69b.err"
elif [ -z "$f69" ]; then fail T69 "the first writer never entered the rotation (no rotate-entered flag)"; show "$TMP/t69a.err"
elif [ $ra -ne 0 ] || [ $rb -ne 0 ]; then fail T69 "supervisors exited $ra/$rb"; show "$TMP/t69a.err"; show "$TMP/t69b.err"
elif [ "$nf" != 0 ]; then fail T69 "$nf journal write failed lines"; show "$TMP/t69a.err"; show "$TMP/t69b.err"
elif [ "$msg" != 2 ]; then fail T69 "$msg of 2 records in runs.jsonl + runs.jsonl.1"
elif [ "$nfl" != 2 ]; then fail T69 "$nfl rotate-entered flags, want 2 (both writers rotated)"
elif ! "$LPY" -c 'import sys; sys.exit(0 if float(sys.argv[1]) >= 2 * float(sys.argv[2]) else 1)' "$span" "$P69"; then fail T69 "both writers done ${span}s after the first entered (< 2 x ${P69}s): the rotations overlapped, no lock"
else pass T69 "concurrent rotations under the lock: both records kept, ${span}s from the first entry >= 2 x ${P69}s, no failure line"; fi
fi

# ---------------------------------------------------------------- T70
# A11: a stopped supervisor's mark is not believed: the outer counts its tree.
if want T70; then
begin T70
tp="$TMP/t70.tmp"; mkdir -p "$tp"
K70=""; [ $PLAT = linux ] && K70="RUNLIMITS_TEST_KERNEL_MEM_MB=1024"
cat >"$TMP/t70.sh" <<SH
"$LPY" "$SUP" --wrap model-session --label t70n -- "$LPY" "$TMP/alloc.py" 300 30 "$TMP/t70n.pid" &
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$! "$TMP/t70n.sup"
sleep 30 &
wait
SH
    env RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_NO_TIME_WATCH=1 $K70 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t70 -- "$BASHBIN" "$TMP/t70.sh" >"$TMP/t70.out" 2>"$TMP/t70.err" &
    op=$!; save_pid "$TMP/root-$op.pid" "$op"
    supn=""
    t0=$(now)
    while ! elapsed_ge "$t0" "$(now)" 10; do [ -s "$TMP/t70n.sup" ] && { supn=$(cat "$TMP/t70n.sup"); break; }; sleep 0.05; done
    m70=""
    while [ -n "$supn" ] && ! elapsed_ge "$t0" "$(now)" 10; do
        m70=$(firstmatch "$tp"/runlimits-$supn-s*)
        [ -n "$m70" ] && break
        sleep 0.05
    done
    # the mark exists before the nested spawns its child: without the child the
    # STOP would freeze a supervisor with nothing under it to count
    [ -n "$m70" ] && wait_file "$TMP/t70n.pid" 10
    [ -n "$supn" ] && signal_file STOP "$TMP/t70n.sup" "$TMP/t70.err"
    t1=$(now)
    while alive "$op" && ! elapsed_ge "$t1" "$(now)" 40; do sleep 0.1; done
    alive "$op" && signal_file KILL "$TMP/root-$op.pid" "$TMP/t70.err"
    wait "$op"; rc70=$?
    [ -n "$supn" ] && { signal_file CONT "$TMP/t70n.sup" "$TMP/t70.err"; signal_file KILL "$TMP/t70n.sup" "$TMP/t70.err"; }
    lim=$(jfind "$LOG" label t70 limit); by=$(jfind "$LOG" label t70 by)
    if [ -z "$m70" ]; then fail T70 "nested supervisor's mark never seen in $tp: $(tr '\n' ' ' <"$TMP/t70.err" | head -c 200)"
    elif [ $rc70 -ne 86 ] || [ "$lim" != mem ] || [ "$by" != watchdog ]; then fail T70 "outer exit $rc70, journal limit=$lim by=$by (want 86/mem/watchdog)"; show "$TMP/t70.err"
    else pass T70 "stopped nested supervisor counted by the outer: 86/mem/watchdog"; fi
    kill_loads
fi

# ---------------------------------------------------------------- T71 (Linux)
# A12, stop path: a nested supervisor SIGKILLed inside the outer's stop leaves
# no mark after the outer exits. Barrier: the nested supervisor's mark is in the
# registry and its child holds 250 MB BEFORE the action that kills the tree (the
# outer's parent gets SIGKILL -> stop parent-gone; its window tick sees the tree
# above 150 MB and SIGKILLs everything, the nested supervisor included, so no
# `finally` of its own removes the mark). A run where the barrier never closed,
# or the nested supervisor journalled its own end, proves nothing: FAIL.
if want T71; then
if [ $PLAT = linux ]; then
    begin T71
    tp="$TMP/t71.tmp"; mkdir -p "$tp"
    cat >"$TMP/hold71.py" <<'PY'
import resource, signal, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
target_mb, hold_s, ready = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
scale = 1024
deadline = time.time() + 20
bufs = []
while resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale < target_mb * 1048576 and time.time() < deadline:
    bufs.append(bytearray(b"\x01") * (4 << 20))
    time.sleep(0.005)
open(ready, "w").write("%d\n" % resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
time.sleep(max(0.0, min(hold_s, deadline - time.time())))
PY
    cat >"$TMP/launch71.py" <<'PY'
import subprocess, sys, time
p = subprocess.Popen(sys.argv[2:])
with open(sys.argv[1], "w") as f:
    __import__("fixture_pid").record_pid(f.name, p.pid)
time.sleep(120)
PY
    cat >"$TMP/t71.sh" <<SH
env RUNLIMITS_TEST_NO_MEM_WATCH=1 RUNLIMITS_TEST_KERNEL_MEM_MB=400 "$LPY" "$SUP" --wrap teeth --label t71n -- "$LPY" "$TMP/hold71.py" 250 40 "$TMP/t71.ready" &
"$LPY" "$RL_FIXTURE_PID_HELPER" by-pid \$! "$TMP/t71n.sup"
wait
SH
    "$LPY" "$TMP/launch71.py" "$TMP/t71s.pid" env RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_NO_TIME_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t71 -- "$BASHBIN" "$TMP/t71.sh" >"$TMP/t71.out" 2>"$TMP/t71.err" &
    lp71=$!
    supn=""; s71=""; mark71=""; bar71=""
    t0=$(now)
    while ! elapsed_ge "$t0" "$(now)" 15; do
        [ -z "$s71" ] && [ -s "$TMP/t71s.pid" ] && s71=$(cat "$TMP/t71s.pid")
        [ -z "$supn" ] && [ -s "$TMP/t71n.sup" ] && supn=$(cat "$TMP/t71n.sup")
        [ -n "$supn" ] && [ -z "$mark71" ] && mark71=$(firstmatch "$tp"/runlimits-$supn-s*)
        if [ -n "$s71" ] && [ -n "$mark71" ] && [ -s "$TMP/t71.ready" ]; then bar71=closed; break; fi
        sleep 0.05
    done
    if [ -z "$bar71" ]; then
        bar71="barrier never closed within 15 s: outer pid '${s71}', nested supervisor '${supn}', its mark '${mark71}', load ready $([ -s "$TMP/t71.ready" ] && echo y || echo n)"
    else
        [ -e "$mark71" ] || bar71="the nested mark $mark71 vanished before the kill"
    fi
    kill -KILL "$lp71"; wait "$lp71"
    t1=$(now)
    while [ -n "$s71" ] && alive "$s71" && ! elapsed_ge "$t1" "$(now)" 40; do sleep 0.1; done
    s71alive=n; [ -n "$s71" ] && alive "$s71" && s71alive=y
    left71=""; [ -n "$mark71" ] && [ -e "$mark71" ] && left71=$mark71
    signal_file KILL "$TMP/t71s.pid" "$TMP/t71.err"; signal_file KILL "$TMP/t71n.sup" "$TMP/t71.err"
    lim=$(jfind "$LOG" label t71 limit); sk=$(jfind "$LOG" label t71 stop_kill); ds=$(jfind "$LOG" label t71 during_stop); ex=$(jfind "$LOG" label t71 exit)
    nex=$(jfind "$LOG" label t71n exit)
    if [ "$bar71" != closed ]; then fail T71 "instrument: $bar71; the tooth proves nothing"; show "$TMP/t71.err"
    elif [ $s71alive = y ]; then fail T71 "outer supervisor $s71 alive 40 s after its parent's SIGKILL"; show "$TMP/t71.err"
    elif [ "$lim" != mem ] || [ "$sk" != window ] || [ "$ds" != parent-gone ] || [ "$ex" != 86 ]; then fail T71 "outer journal limit=$lim stop_kill=$sk during_stop=$ds exit=$ex, want mem/window/parent-gone/86 (the window tick did not SIGKILL the tree)"; show "$TMP/t71.err"
    elif [ "$nex" != MISSING ]; then fail T71 "instrument: the nested supervisor journalled its own end (exit $nex): its finally removed the mark, the tooth proves nothing"
    elif [ -n "$left71" ]; then fail T71 "the SIGKILLed nested supervisor's mark left after the outer exited: '$left71'"
    else pass T71 "barrier closed (mark $(basename "$mark71") + 250 MB load) before the kill; outer 86 mem/window in its parent-gone stop, nested SIGKILLed without its finally, its mark reaped on the stop path"; fi
    kill_loads
else
    skip T71 "linux-only (nested scope stop under sparing), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T72 T73
# A13/E2: the profile half of RUNLIMITS_ACTIVE is checked. The active profile
# covers a request only if it is no looser on any axis (mem_mb and runtime_s both
# <= the request's): a runner prologue under a pipeline supervisor wraps (stricter
# memory), a pipeline prologue under a runner wraps (shorter runtime), a mutation
# prologue under unit wraps (shorter runtime), a unit prologue under mutation does
# not (the active envelope is tighter on both).
# mkfixp <lang> <file> <body> <profile>: like mkfix with a chosen profile (A13 teeth)
mkfixp() {
    local lang=$1 f=$2 body=$3 prof=$4
    case "$lang" in
        bash) echo '#!/usr/bin/env bash' >"$f" ;;
        python) echo '#!/usr/bin/env python3' >"$f" ;;
        node) : >"$f" ;;
    esac
    prologue "$lang" "$prof" >>"$f" || return 1
    cat "$body" >>"$f"
}
nsups() { # <report>: number of supervisors below the teeth shell
    "$LPY" - "$1" "$TEETH_PID" <<'PY'
import json, re, sys
try:
    r = json.load(open(sys.argv[1]))
except (OSError, ValueError) as e:
    print("no report: %s" % e); sys.exit(1)
chain = r["chain"]
pids = [p for p, _ in chain]
teeth = int(sys.argv[2])
if teeth not in pids:
    print("teeth shell %d not an ancestor: %s" % (teeth, pids)); sys.exit(1)
below = chain[:pids.index(teeth)]
wrap = re.compile(r"(^|[\s/])runlimits\.py --wrap(\s|$)")
print(len([p for p, c in below if wrap.search(c)]))
PY
}
if want T72; then
begin T72
cat >"$TMP/body.t72" <<SH
"$LPY" "$TMP/report.py" "\$1"
SH
    if [ $FIXOK != 1 ]; then fail T72 "fixtures not built"
    elif ! mkfixp bash "$FIX/t72.sh" "$TMP/body.t72" runner; then fail T72 "fixture not built"
    else
        bounded 30 t72 env -u RUNLIMITS_ACTIVE RUNLIMITS_HOME="$UT" RUNLIMITS_LOG_DIR="$LOG" "$LPY" "$SUP" --wrap pipeline --label t72 -- "$BASHBIN" "$FIX/t72.sh" "$TMP/t72.json"
        j72=$(jfind "$LOG" label "$FIX/t72.sh" exit); n72=$(nsups "$TMP/t72.json")
        if [ $BRC -ne 0 ]; then fail T72 "outer exit $BRC"; show "$TMP/t72.err"
        elif [ "$n72" != 2 ]; then fail T72 "$n72 supervisors below the teeth shell (want 2: pipeline + nested runner)"
        elif [ "$j72" = MISSING ]; then fail T72 "no nested runner record under the pipeline supervisor"
        else pass T72 "runner prologue under pipeline wrapped: nested record exit=$j72"; fi
    fi
fi

if want T73; then
begin T73
cat >"$TMP/body.t73" <<SH
"$LPY" "$TMP/report.py" "\$1"
SH
    if [ $FIXOK != 1 ]; then fail T73 "fixtures not built"
    elif ! mkfixp bash "$FIX/t73.sh" "$TMP/body.t73" pipeline; then fail T73 "fixture not built"
    else
        bounded 30 t73 env -u RUNLIMITS_ACTIVE RUNLIMITS_HOME="$UT" RUNLIMITS_LOG_DIR="$LOG" "$LPY" "$SUP" --wrap runner --label t73 -- "$BASHBIN" "$FIX/t73.sh" "$TMP/t73.json"
        j73=$(jfind "$LOG" label "$FIX/t73.sh" exit); n73=$(nsups "$TMP/t73.json")
        if [ $BRC -ne 0 ]; then fail T73 "outer exit $BRC"; show "$TMP/t73.err"
        elif [ "$n73" != 2 ]; then fail T73 "$n73 supervisors below the teeth shell (want 2: runner + nested pipeline)"
        elif [ "$j73" = MISSING ]; then fail T73 "no nested pipeline record under the runner supervisor (shorter runtime not set up)"
        else pass T73 "pipeline prologue under runner wrapped (shorter runtime): nested record exit=$j73"; fi
    fi
fi

# nested_tooth <tooth> <outer profile> <prologue profile> <want nested 0|1>
nested_tooth() {
    local t=$1 outer=$2 inner=$3 wantn=$4 tag j n
    tag=$(echo "$t" | tr 'T' 't')
    printf '"%s" "%s" "$1"\n' "$LPY" "$TMP/report.py" >"$TMP/body.$tag"
    if [ $FIXOK != 1 ]; then fail $t "fixtures not built"; return; fi
    if ! mkfixp bash "$FIX/$tag.sh" "$TMP/body.$tag" "$inner"; then fail $t "fixture not built"; return; fi
    bounded 30 $tag env -u RUNLIMITS_ACTIVE RUNLIMITS_HOME="$UT" RUNLIMITS_LOG_DIR="$LOG" "$LPY" "$SUP" --wrap "$outer" --label $tag -- "$BASHBIN" "$FIX/$tag.sh" "$TMP/$tag.json"
    j=$(jfind "$LOG" label "$FIX/$tag.sh" exit); n=$(nsups "$TMP/$tag.json")
    if [ $BRC -ne 0 ]; then fail $t "outer exit $BRC"; show "$TMP/$tag.err"
    elif [ $wantn = 1 ] && { [ "$n" != 2 ] || [ "$j" = MISSING ]; }; then fail $t "$inner prologue under $outer: $n supervisors below the teeth shell, nested record exit=$j (want 2 and a nested $inner record)"
    elif [ $wantn = 0 ] && { [ "$n" != 1 ] || [ "$j" != MISSING ]; }; then fail $t "$inner prologue under $outer: $n supervisors below the teeth shell, nested record exit=$j (want 1, no nested record)"
    elif [ $wantn = 1 ]; then pass $t "$inner prologue under $outer wrapped: nested record exit=$j"
    else pass $t "$inner prologue under $outer: one supervisor, no nested record"; fi
}

# ---------------------------------------------------------------- T88 T89
# E2: mutation (180 s) under unit (900 s), same memory: the shorter runtime
# wraps; unit under mutation: the active envelope is tighter, no wrap.
if want T88; then
begin T88
nested_tooth T88 unit mutation 1
fi

if want T89; then
begin T89
nested_tooth T89 mutation unit 0
fi

# ---------------------------------------------------------------- T74
# A14: a non-combat RUNLIMITS_LOG_DIR without the marker file is combat: the
# knobs are dead and the memory limit still kills.
if want T74; then
begin T74
d74="$TMP/t74log"; mkdir -p "$d74"
# a FAIL shows the run's journal record (peak_rss_mb and the rest), not only its stderr
t74journal() { if [ -s "$d74/runs.jsonl" ]; then echo "  journal $d74/runs.jsonl:"; show "$d74/runs.jsonl"; else echo "  journal: no record in $d74"; fi; }
bounded 45 t74 env RUNLIMITS_LOG_DIR="$d74" RUNLIMITS_TEST_KERNEL_MEM_MB=4096 RUNLIMITS_TEST_NO_MEM_WATCH=1 "$LPY" "$SUP" --wrap model-session --label t74 -- "$LPY" "$TMP/alloc.py" 3400 15 "$TMP/t74.pid"
lim=$(jrec "$d74" -1 limit); ex=$(jrec "$d74" -1 exit)
if [ $BRC -ne 86 ]; then fail T74 "exit $BRC, want 86 (knob honoured without the marker?)"; show "$TMP/t74.err"; t74journal
elif [ "$lim" != mem ] || [ "$ex" != 86 ]; then fail T74 "journal limit=$lim exit=$ex, want mem/86"; t74journal
else pass T74 "86/$lim: knobs dead without .runlimits-test, the memory limit still kills"; fi
kill_loads
fi

# ---------------------------------------------------------------- T75 (darwin)
# A15/E9: a setsid runaway is found by its RUNLIMITS_TREE token, counted and
# killed; the supervisor is gone at most ENV_SCAN_TICKS * TICK_S + 2 s after the
# runaway's own RSS crossed the teeth cap (it stamps that moment).
if want T75; then
if [ "$PLAT" = darwin ]; then
    begin T75
    # the bound from the reference library beside this runner, not the one under
    # test: M128 raises ENV_SCAN_TICKS and would raise its own bound with it
    B75=$("$LPY" -B -c 'import sys; sys.path.insert(0, sys.argv[1]); import runlimits as r; print(r.ENV_SCAN_TICKS * r.TICK_S + 2)' "$HERE") || B75=7
    cat >"$TMP/run75.py" <<'PY'
import os, sys, time
pid = os.fork()
if pid == 0:
    # the double fork leaves the child tree entirely: only the env scan
    # (the RUNLIMITS_TREE token) can find it again
    gpid = os.fork()
    if gpid == 0:
        os.setsid()
        with open(sys.argv[-1], "w") as f:
            __import__("fixture_pid").record_pid(f.name, os.getpid())
        os.execv(sys.executable, [sys.executable] + sys.argv[1:])
        os._exit(127)
    os._exit(0)
time.sleep(30)
PY
    cat >"$TMP/runaway75.py" <<'PY'
import resource, sys, time
target_mb, hold_s, stamp, cap_mb = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3], int(sys.argv[4])
deadline = time.time() + 20
bufs, stamped = [], False
while resource.getrusage(resource.RUSAGE_SELF).ru_maxrss < target_mb * 1048576 and time.time() < deadline:
    bufs.append(bytearray(b"\x01") * (4 << 20))
    if not stamped and resource.getrusage(resource.RUSAGE_SELF).ru_maxrss >= cap_mb * 1048576:
        with open(stamp, "w") as f:
            f.write("%.3f" % time.time())
        stamped = True
    time.sleep(0.005)
time.sleep(max(0.0, min(hold_s, deadline - time.time())))
PY
    bounded 30 t75 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_NO_TIME_WATCH=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t75 -- "$LPY" "$TMP/run75.py" "$TMP/runaway75.py" 300 25 "$TMP/t75.stamp" 150 "$TMP/t75.pid"
    tend=$(now)
    lim=$(jrec "$LOG" -1 limit); by=$(jrec "$LOG" -1 by)
    ra=n; [ -s "$TMP/t75.pid" ] && alive "$(cat "$TMP/t75.pid")" && ra=y
    # a stamp the runaway never wrote is a named FAIL below, not an empty
    # python argument; a present stamp that cannot be read fails naming it
    st75=""; unread75=n
    if [ -e "$TMP/t75.stamp" ]; then st75=$(cat "$TMP/t75.stamp") || unread75=y; fi
    d75=""
    [ -n "$st75" ] && d75=$("$LPY" -c 'import sys; print("%.2f" % (float(sys.argv[2]) - float(sys.argv[1])))' "$st75" "$tend" 2>&1)
    if [ $unread75 = y ]; then fail T75 "stamp file $TMP/t75.stamp unreadable"; show "$TMP/t75.err"
    elif [ $BRC -ne 86 ] || [ "$lim" != mem ] || [ "$by" != watchdog ]; then fail T75 "exit $BRC, journal limit=$lim by=$by (want 86/mem/watchdog)"; show "$TMP/t75.err"
    elif [ $ra = y ]; then signal_file KILL "$TMP/t75.pid" "$TMP/t75.err"; fail T75 "the setsid runaway survived the run"
    elif [ -z "$st75" ]; then fail T75 "the runaway never stamped its crossing of the cap"
    elif ! "$LPY" -c 'import sys; sys.exit(0 if float(sys.argv[1]) <= float(sys.argv[2]) else 1)' "$d75" "$B75"; then fail T75 "supervisor gone ${d75}s after the runaway crossed the cap (bound ${B75}s): the env scan came late"
    else pass T75 "env scan counted the runaway: 86/mem/watchdog, runaway dead, supervisor gone ${d75}s after the crossing (bound ${B75}s)"; fi
    kill_loads
else
    skip T75 "darwin-only (no scope: the env scan), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T76 T77 T78 T79 T80 T81
# B1/B2/B3/B4: scope parsing and sub-skip counting of the runners under test.
if want T76; then
begin T76
RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
mkdir -p "$TMP/t76cwd"; printf '#!/bin/sh\ntrue\n' >"$TMP/t76cwd/T12"
( cd "$TMP/t76cwd" && env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope '*' ) >"$TMP/t76.out" 2>"$TMP/t76.err" &
p76=$!
wait "$p76"; rc76=$?
if [ $rc76 -ne 2 ] || ! grep -q '^nothing run: scope required' "$TMP/t76.err"; then fail T76 "exit $rc76 (glob expanded into a tooth name?)"; show "$TMP/t76.err"
else pass T76 "--scope '*' with a file named T12 in cwd: exit 2, nothing run"; fi
fi

if want T77; then
begin T77
RM=${RL_MUTATE_UNDER_TEST:-$HERE/mutate.sh}
mkdir -p "$TMP/t77cwd"; printf '#!/bin/sh\ntrue\n' >"$TMP/t77cwd/M6b-table-constant"
( cd "$TMP/t77cwd" && "$BASHBIN" "$RM" --scope '*' ) >"$TMP/t77.out" 2>"$TMP/t77.err" &
p77=$!
wait "$p77"; rc77=$?
if [ $rc77 -ne 2 ] || ! grep -q '^nothing run: scope required' "$TMP/t77.err"; then fail T77 "exit $rc77 (glob expanded into a mutant id?)"; show "$TMP/t77.err"
else pass T77 "--scope '*' with a file named M6b-table-constant in cwd: exit 2, nothing run"; fi
fi

if want T78; then
begin T78
RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
bounded 40 t78 env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope T1 --scope T2
if [ $BRC -ne 0 ] || ! grep -qE "^TEETH platform=$PLAT scope=T1,T2 ran=2 passed=2 failed=0 expected=2 subskips=0\$" "$TMP/t78.out"; then fail T78 "exit $BRC: $(grep '^TEETH ' "$TMP/t78.out")"; show "$TMP/t78.err"
else pass T78 "repeated --scope accumulates: ran=2"; fi
fi

if want T79; then
begin T79
RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
bounded 30 t79 env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope=T1
if [ $BRC -ne 0 ] || ! grep -qE "^TEETH platform=$PLAT scope=T1 ran=1 passed=1 failed=0 expected=1 subskips=0\$" "$TMP/t79.out"; then fail T79 "exit $BRC: $(grep '^TEETH ' "$TMP/t79.out")"; show "$TMP/t79.err"
else pass T79 "--scope=T1 works like --scope: ran=1"; fi
fi

if want T80; then
begin T80
RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
t80=T33; [ $PLAT = darwin ] && t80=T13
bounded 30 t80 env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope "$t80"
if [ $BRC -ne 2 ] || ! grep -qF "nothing run on $PLAT: every scoped tooth is " "$TMP/t80.err"; then fail T80 "exit $BRC, want 2 with the other-platform line"; show "$TMP/t80.err"
else pass T80 "foreign-only scope: $(cat "$TMP/t80.err")"; fi
fi

# T81 needs a scope with a sub-skip on this platform: with none the check is 0 = 0 and
# proves nothing (darwin: T24 sub-skips its linux-only (b); linux: T26 its darwin-only (d))
if want T81; then
begin T81
RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
t81=T26; [ $PLAT = darwin ] && t81=T24
bounded 60 t81 env RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope "$t81"
n81=$(grep -c '^SUBSKIP ' "$TMP/t81.out"); s81=$(grep '^TEETH ' "$TMP/t81.out" | sed 's/.*subskips=//')
if [ $BRC -ne 0 ]; then fail T81 "exit $BRC"; show "$TMP/t81.err"
elif [ "$n81" -lt 1 ]; then fail T81 "instrument: предусловие — подскипов 0 (--scope $t81 on $PLAT printed no SUBSKIP line)"
elif [ -z "$s81" ] || [ "$n81" != "$s81" ]; then fail T81 "$n81 SUBSKIP line(s), summary subskips=$s81"
else pass T81 "$n81 SUBSKIP line(s) = subskips=$s81 on $PLAT"; fi
fi

# ---------------------------------------------------------------- T82 T83 T84
# C1: the marker counts only on a real comment line, not inside a string, a
# template literal or a heredoc.
if want T82; then
begin T82
mkdir -p "$CG/t82"
cat >"$CG/t82/s.py" <<'PY'
"""
# RUNLIMITS-PROLOGUE v1 profile=unit
"""
import subprocess
subprocess.run(["pytest", "-q"])
PY
    guard t82 --root "$CG/t82"; rc=$BRC
    if [ $rc -ne 1 ] || ! grep -q '^VIOLATION .*t82/s\.py:5:' "$TMP/t82.out"; then fail T82 "exit $rc (marker inside a triple-quoted string counted?)"; show "$TMP/t82.out"
    else pass T82 "py marker inside a string is not a prologue: $(grep -c '^VIOLATION' "$TMP/t82.out") violation(s)"; fi
fi

if want T83; then
begin T83
mkdir -p "$CG/t83"
cat >"$CG/t83/s.mjs" <<'JS'
const m = `
// RUNLIMITS-PROLOGUE v1 profile=unit
`;
import { spawnSync } from 'node:child_process';
spawnSync('node', ['--test', 'x.mjs']);
JS
    guard t83 --root "$CG/t83"; rc=$BRC
    if [ $rc -ne 1 ] || ! grep -q '^VIOLATION .*t83/s\.mjs:5:' "$TMP/t83.out"; then fail T83 "exit $rc (marker inside a template literal counted?)"; show "$TMP/t83.out"
    else pass T83 "js marker inside a template literal is not a prologue"; fi
fi

if want T84; then
begin T84
mkdir -p "$CG/t84"
cat >"$CG/t84/s.sh" <<'SH'
#!/usr/bin/env bash
cat <<'EOF'
# RUNLIMITS-PROLOGUE v1 profile=unit
EOF
pytest -q
SH
    guard t84 --root "$CG/t84"; rc=$BRC
    if [ $rc -ne 1 ] || ! grep -q '^VIOLATION .*t84/s\.sh:5:' "$TMP/t84.out"; then fail T84 "exit $rc (marker inside a heredoc counted?)"; show "$TMP/t84.out"
    else pass T84 "sh marker inside a heredoc is not a prologue"; fi
fi

# ---------------------------------------------------------------- T85
# C2: the closure is seeded by leaf forms AND declared entry points.
if want T85; then
begin T85
mkdir -p "$CG/t85"
printf '#!/usr/bin/env bash\nbash "$HERE/b.sh"\n' >"$CG/t85/a.sh"
printf '#!/usr/bin/env bash\n# RUNLIMITS-PROLOGUE v1 profile=runner\necho ok\n' >"$CG/t85/b.sh"
printf 't85/b.sh\trunner\tfixture declared leaf\n' >"$CG/t85.decl"
    guard t85 --root "$CG/t85" --declared "$CG/t85.decl"; rc=$BRC
    if [ $rc -ne 1 ] || ! grep -q '^VIOLATION .*t85/a\.sh:2:' "$TMP/t85.out"; then fail T85 "exit $rc (caller of a declared entry point not judged?)"; show "$TMP/t85.out"
    else pass T85 "a.sh judged for running the declared b.sh"; fi
fi

# ---------------------------------------------------------------- T86 T87
# C3: an oversize script-like file is a violation unless excluded by a glob.
if want T86; then
begin T86
mkdir -p "$CG/t86"
{ echo '#!/usr/bin/env bash'; echo 'pytest -q'; head -c 9000000 /dev/zero | tr '\0' x; echo; } >"$CG/t86/big.sh"
    guard t86 --root "$CG/t86"; rc=$BRC
    if [ $rc -ne 1 ] || ! grep -qF "VIOLATION $CG/t86/big.sh: " "$TMP/t86.out" || ! grep -qF ' B > 8388608 B, not scanned (exclude it with a reason or split it)' "$TMP/t86.out"; then fail T86 "exit $rc (oversize not a violation?)"; show "$TMP/t86.out"
    else pass T86 "oversize entry-point-like file: $(grep -c '^VIOLATION' "$TMP/t86.out") violation(s)"; fi
fi

if want T87; then
begin T87
mkdir -p "$CG/t87"
{ echo '#!/usr/bin/env bash'; echo 'pytest -q'; head -c 9000000 /dev/zero | tr '\0' x; echo; } >"$CG/t87/big.sh"
printf 't87/*\tfixture: oversize copy, not scanned\n' >"$CG/t87.ex"
    guard t87 --root "$CG/t87" --exclude "$CG/t87.ex"; rc=$BRC
    if [ $rc -ne 0 ] || grep -q '^VIOLATION' "$TMP/t87.out" || grep -q '^SKIPPED' "$TMP/t87.out"; then fail T87 "exit $rc (excluded oversize still a violation?)"; show "$TMP/t87.out"
    else pass T87 "oversize under an exclusion glob: no violation, no SKIPPED line"; fi
fi

# ---------------------------------------------------------------- T90
# E1: the tick's RSS sum counts every pid once. Fake snapshot child -> P1 -> P2
# -> G, P1 gone, P2 and G alive with their remembered start: C 10 + P2 20 + G 70
# = 100 MB, not G twice through the tree of P2 and its own.
if want T90; then
begin T90
"$LPY" - "$UT/runlimits.py" >"$TMP/t90.out" 2>&1 <<'PY'
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(sys.argv[1])))
import runlimits as r
if not hasattr(r, "tick_pids"):
    print("the library has no tick_pids to probe"); sys.exit(1)
C, P1, P2, G = 4100, 4200, 4300, 4400
procs = {C: (1, 10 * 1024, "c", C, 1000, "S"), P2: (1, 20 * 1024, "p2", C, 1002, "S"), G: (P2, 70 * 1024, "g", C, 1003, "S")}
last = {C: 1000, P1: 1001, P2: 1002, G: 1003}
pids = r.tick_pids(procs, C, last, set())
total = sum(procs[p][1] for p in pids) / 1024.0
dup = sorted(p for p in set(pids) if pids.count(p) > 1)
print("pids=%s sum=%.0f MB twice=%s" % (pids, total, dup))
sys.exit(0 if sorted(pids) == [C, P2, G] and not dup and total == 100 else 1)
PY
if [ $? -eq 0 ]; then pass T90 "every pid once: $(cat "$TMP/t90.out")"
else fail T90 "$(tr '\n' ' ' <"$TMP/t90.out" | head -c 400)"; fi
fi

# ---------------------------------------------------------------- T91 (darwin)
# E4: a supervisor SIGKILLed while it holds an out-of-group descendant with
# SIGSTOP (Ctrl-Z path) leaves `stopped` in its mark; the next supervisor's reap
# with the same registry sends that descendant SIGCONT.
if want T91; then
if [ "$PLAT" = darwin ]; then
    begin T91
    D91="$TMP/t91"; mkdir -p "$D91"; tp="$TMP/t91.tmp"; mkdir -p "$tp"
    cat >"$TMP/sess91.py" <<'PY'
import os, sys, time
d = sys.argv[1]
os.setsid()
with open(os.path.join(d, "sess"), "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
n, end = 0, time.time() + 60
while not os.path.exists(os.path.join(d, "stop")) and time.time() < end:
    n += 1
    with open(os.path.join(d, "count"), "w") as f:
        f.write(str(n))
    time.sleep(0.05)
PY
    cat >"$TMP/tick91.py" <<'PY'
import os, subprocess, sys, time
d = sys.argv[1]
p = subprocess.Popen([sys.executable, os.environ["RL_T91_SESS"], d])
with open(os.path.join(d, "child"), "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid(), payload="%d %d" % (os.getpid(), os.getpgrp()))
end = time.time() + 60
while not os.path.exists(os.path.join(d, "stop")) and time.time() < end:
    time.sleep(0.05)
p.wait()
PY
    cat >"$TMP/jc91.py" <<'PY'
import json, os, signal, sys, time
d, cmd = sys.argv[1], sys.argv[2:]
fd = os.open("/dev/tty", os.O_RDWR)
signal.signal(signal.SIGTTOU, signal.SIG_IGN)
shell = os.getpgrp()
steps = []
def step(name, cond):
    steps.append([name, bool(cond)])
def count():
    try:
        return int(open(os.path.join(d, "count")).read())
    except (OSError, ValueError):
        return -1
def frozen(t=0.8):
    a = count(); time.sleep(t); return count() == a
def until(pred, t):
    end = time.time() + t
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return False
def wait_job(pid, t):
    end = time.time() + t
    while time.time() < end:
        p, st = os.waitpid(pid, os.WNOHANG | os.WUNTRACED)
        if p:
            if os.WIFSTOPPED(st):
                return ("stopped", os.WSTOPSIG(st))
            return ("exited", os.waitstatus_to_exitcode(st))
        time.sleep(0.02)
    return ("timeout", None)
pid = os.fork()
if pid == 0:
    os.setpgid(0, 0)
    while os.tcgetpgrp(fd) != os.getpgrp():
        time.sleep(0.01)
    signal.signal(signal.SIGTTOU, signal.SIG_DFL)
    os.execvp(cmd[0], cmd)
try:
    os.setpgid(pid, pid)
except OSError:
    pass
os.tcsetpgrp(fd, pid)
if not until(lambda: os.path.exists(os.path.join(d, "child")), 5):
    step("child started", False)
    os.kill(pid, signal.SIGKILL)
else:
    step("session descendant counting", until(lambda: count() > 0, 5))
    os.killpg(os.tcgetpgrp(fd), signal.SIGTSTP)
    r = wait_job(pid, 5)
    step("Ctrl-Z: job stopped (%s %s)" % r, r[0] == "stopped")
    os.tcsetpgrp(fd, shell)
    step("session descendant stopped while the job stands", frozen())
    os.kill(pid, signal.SIGKILL)
    r = wait_job(pid, 5)
    step("supervisor SIGKILLed while the job stands (%s %s)" % r, r[0] == "exited")
with open(os.path.join(d, "steps.json"), "w") as f:
    json.dump(steps, f)
PY
    bounded 60 t91 script -q /dev/null "$LPY" "$TMP/jc91.py" "$D91" env RL_T91_SESS="$TMP/sess91.py" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$LOG" "$LPY" "$SUP" --wrap unit --label t91 -- "$LPY" "$TMP/tick91.py" "$D91"
    msg=$("$LPY" - "$D91/steps.json" <<'PY'
import json, sys
try:
    steps = json.load(open(sys.argv[1]))
except (OSError, ValueError) as e:
    print("no steps: %s" % e); sys.exit(1)
print("; ".join(("FAILED " if not ok else "") + n for n, ok in steps))
sys.exit(1 if [n for n, ok in steps if not ok] or not steps else 0)
PY
)
    okj=$?
    # an absent session file is a judged outcome (named below); a present file
    # that cannot be read fails the tooth naming it
    sp91=""; s91err=n
    if [ -e "$D91/sess" ]; then sp91=$(cat "$D91/sess") || s91err=y; fi
    st1=""; [ -n "$sp91" ] && st1=$(ps -o stat= -p "$sp91" | tr -d ' ')
    st2=""
    if [ $okj -eq 0 ] && [ -n "$sp91" ]; then
        bounded 20 t91b env RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$(sublog "$LOG/b")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t91b -- true
        t0=$(now)
        while :; do
            st2=$(ps -o stat= -p "$sp91" | tr -d ' ')
            case "$st2" in T*) ;; *) break ;; esac
            elapsed_ge "$t0" "$(now)" 5 && break
            sleep 0.1
        done
    fi
    touch "$D91/stop"
    [ -n "$sp91" ] && signal_file KILL "$D91/sess" "$TMP/t91.err"
    if [ $s91err = y ]; then fail T91 "session file $D91/sess unreadable"; show "$TMP/t91.out"
    elif [ $okj -ne 0 ]; then fail T91 "$msg"; show "$TMP/t91.out"
    elif [ -z "$sp91" ]; then fail T91 "session descendant pid never written"
    else
        case "$st1" in
            T*) case "$st2" in
                    T*) fail T91 "$msg; after the next supervisor's reap the descendant is still stopped (stat '$st2')"; show "$TMP/t91b.err" ;;
                    '') fail T91 "$msg; the descendant vanished instead of resuming"; show "$TMP/t91b.err" ;;
                    *) pass T91 "$msg; left stopped (stat '$st1'), resumed by the next reap (stat '$st2')" ;;
                esac ;;
            *) fail T91 "$msg; the descendant was not stopped after the supervisor's death (stat '$st1'): nothing to resume" ;;
        esac
    fi
else
    skip T91 "darwin-only (job control), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T92 (darwin)
# E5: an env scan that fails in the sweep leaves the leftovers unverified: the
# stderr line, journal limit=unverified with env_scan, the child's code.
if want T92; then
if [ "$PLAT" = darwin ]; then
    begin T92
    bounded 20 t92 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_ENVSCAN_FAIL_AT_SWEEP=1 RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t92 -- true
    lim=$(jrec "$LOG" -1 limit); es=$(jrec "$LOG" -1 env_scan)
    if [ $BRC -ne 0 ]; then fail T92 "exit $BRC, want the child's 0"; show "$TMP/t92.err"
    elif ! grep -q '^RUNLIMITS: t92: descendant scan unavailable (.*); leftovers not verified$' "$TMP/t92.err"; then fail T92 "no 'descendant scan unavailable' line"; show "$TMP/t92.err"
    elif [ "$lim" != unverified ] || [ "$es" = MISSING ]; then fail T92 "journal limit=$lim env_scan=$es, want unverified/<why>"
    else pass T92 "exit 0, journal limit=unverified env_scan recorded, stderr line present"; fi
else
    skip T92 "darwin-only (the env scan), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T93 T94
# E14: C1 to the end. js: an escaped newline in a string keeps the line indexes
# aligned, so the marker inside the later template literal is not a comment; sh:
# a heredoc with the delimiter '1' hides the marker.
if want T93; then
begin T93
mkdir -p "$CG/t93"
cat >"$CG/t93/s.mjs" <<'JS'
const s = "a\
b";
const t = `
// RUNLIMITS-PROLOGUE v1 profile=unit

`;
spawn("node", ["--test"]);
JS
    guard t93 --root "$CG/t93"; rc=$BRC
    if [ $rc -ne 1 ] || ! grep -q '^VIOLATION .*t93/s\.mjs:7:' "$TMP/t93.out"; then fail T93 "exit $rc (marker in a template after an escaped newline counted?)"; show "$TMP/t93.out"
    else pass T93 "js marker in a template after an escaped newline is not a prologue"; fi
fi

if want T94; then
begin T94
mkdir -p "$CG/t94"
cat >"$CG/t94/s.sh" <<'SH'
#!/usr/bin/env bash
cat <<'1'
# RUNLIMITS-PROLOGUE v1 profile=unit
1
pytest -q
SH
    guard t94 --root "$CG/t94"; rc=$BRC
    if [ $rc -ne 1 ] || ! grep -q '^VIOLATION .*t94/s\.sh:5:' "$TMP/t94.out"; then fail T94 "exit $rc (marker inside a heredoc with the delimiter '1' counted?)"; show "$TMP/t94.out"
    else pass T94 "sh marker inside <<'1' heredoc is not a prologue"; fi
fi

# ---------------------------------------------------------------- T95
# E15: a declared entry point is judged only in the run of the tree that holds
# it: a root without listener.py prints no line about it; a declared file inside
# the root is still judged.
if want T95; then
begin T95
mkdir -p "$CG/t95" "$CG/t95x"
printf '#!/usr/bin/env python3\nimport sys\n' >"$CG/t95x/listener.py"
printf '#!/usr/bin/env bash\necho in\n' >"$CG/t95/in.sh"
printf 't95x/listener.py\trunner\tfixture: declared, outside the scanned root\nt95/in.sh\trunner\tfixture: declared, inside the root\n' >"$CG/t95.decl"
    guard t95 --root "$CG/t95" --declared "$CG/t95.decl"; rc=$BRC
    if grep -q 'listener\.py' "$TMP/t95.out"; then fail T95 "a root without listener.py prints a line about it: $(grep 'listener\.py' "$TMP/t95.out" | head -1)"
    elif [ $rc -ne 1 ] || ! grep -q '^VIOLATION .*t95/in\.sh:1: declared runner' "$TMP/t95.out"; then fail T95 "exit $rc: the declared file inside the root is not judged"; show "$TMP/t95.out"
    else pass T95 "declared outside the root not judged, inside judged: $(tail -1 "$TMP/t95.out")"; fi
fi

# ---------------------------------------------------------------- T96
# E6: a marker whose runner is dead does not arm the knobs: with
# RUNLIMITS_TEST_NO_MEM_WATCH the memory limit still kills (86), as in T74.
if want T96; then
begin T96
d96="$TMP/t96log"; mkdir -p "$d96"
sleep 30 &
dp96=$!
st96=$(pstart "$dp96")
kill -KILL "$dp96"; wait "$dp96"
printf '%s %s\n' "$dp96" "$st96" >"$d96/.runlimits-test"
if [ -z "$st96" ]; then fail T96 "start of the stand-in runner $dp96 not read"
else
    bounded 45 t96 env RUNLIMITS_LOG_DIR="$d96" RUNLIMITS_TEST_KERNEL_MEM_MB=4096 RUNLIMITS_TEST_NO_MEM_WATCH=1 "$LPY" "$SUP" --wrap model-session --label t96 -- "$LPY" "$TMP/alloc.py" 3400 15 "$TMP/t96.pid"
    lim=$(jrec "$d96" -1 limit); ex=$(jrec "$d96" -1 exit)
    if [ $BRC -ne 86 ]; then fail T96 "exit $BRC, want 86 (knob honoured by the marker of a dead runner $dp96?)"; show "$TMP/t96.err"
    elif [ "$lim" != mem ] || [ "$ex" != 86 ]; then fail T96 "journal limit=$lim exit=$ex, want mem/86"
    else pass T96 "86/$lim: the marker of dead runner $dp96 arms nothing"; fi
fi
kill_loads
fi

# ---------------------------------------------------------------- T97 (darwin)
# E7: darwin reads a pid's start through the same ps as the snapshot: the fake
# ps sees the per-pid (-p) calls.
if want T97; then
if [ "$PLAT" = darwin ]; then
    begin T97
    cat >"$TMP/fake97.sh" <<SH
#!/bin/sh
case " \$* " in *" -p "*) echo "\$*" >>"$TMP/t97.calls" ;; esac
exec /bin/ps "\$@"
SH
    chmod +x "$TMP/fake97.sh"
    bounded 20 t97 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_PS="$TMP/fake97.sh" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t97 -- sh -c 'sleep 1 & wait'
    n97=0; [ -s "$TMP/t97.calls" ] && n97=$(wc -l <"$TMP/t97.calls" | tr -d ' ')
    if [ $BRC -ne 0 ]; then fail T97 "exit $BRC"; show "$TMP/t97.err"
    elif [ "$n97" -lt 1 ]; then fail T97 "no per-pid (-p) ps call went through RUNLIMITS_TEST_PS"
    else pass T97 "$n97 per-pid call(s) through the fake ps, e.g. '$(head -1 "$TMP/t97.calls")'"; fi
else
    skip T97 "darwin-only (darwin_start), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T98 T99
# E8: a live pid with another start is not ours: tree_gone counts it gone,
# leftovers leaves it out.
# startprobe <tooth> <what>: YES/NO for a live sleep with its own start, then with a start a year ahead
startprobe() {
    "$LPY" - "$UT/runlimits.py" "$2" <<'PY'
import os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(sys.argv[1])))
import runlimits as r
what = sys.argv[2]
class Exited:
    pid = os.getpid() + 100000  # never a real pid: the child already exited
    returncode = 0
    def poll(self):
        return 0
me = subprocess.Popen(["sleep", "55"])
try:
    time.sleep(0.05)
    st = r.proc_start(me.pid, os.environ)
    sup = r.Supervisor.__new__(r.Supervisor)
    sup.ps_lost = False
    sup.env = dict(os.environ)
    sup.child = Exited()
    sup.plat = r.platform()
    sup.cgroup = None
    out = []
    for s in (st, st + 31622400):
        if what == "gone":
            out.append("YES" if sup.tree_gone({me.pid: s}) else "NO")
        else:
            out.append("YES" if me.pid in sup.leftovers({me.pid: s}) else "NO")
    print(" ".join(out))
finally:
    me.kill(); me.wait()
PY
}
if want T98; then
begin T98
r98=$(startprobe T98 gone 2>&1)
if [ "$r98" = "NO YES" ]; then pass T98 "tree_gone: same start alive, another start gone"
else fail T98 "tree_gone same/other start -> '$r98' (want 'NO YES': a reused pid kept the stop waiting)"; fi
fi

if want T99; then
begin T99
r99=$(startprobe T99 left 2>&1)
if [ "$r99" = "YES NO" ]; then pass T99 "leftovers: same start kept, another start left out"
else fail T99 "leftovers same/other start -> '$r99' (want 'YES NO': a reused pid would get the sweep's signals)"; fi
fi

# ---------------------------------------------------------------- T100 (darwin)
# R1: darwin memory is max(rss, phys_footprint) per pid: a fake ps shows every
# rss as 1 MB, the allocator grows to 400 MB -> the watchdog still kills, 86/mem
# (with rss alone the tree never passes 150 MB and the time limit ends it, 87).
if want T100; then
if [ "$PLAT" = darwin ]; then
    begin T100
    { echo "#!$LPY"; cat <<'PY'
import subprocess, sys
args = sys.argv[1:]
r = subprocess.run(["/bin/ps"] + args, stdout=subprocess.PIPE, universal_newlines=True)
out = r.stdout
if "-axo" in args and any("rss=" in a for a in args):
    lines = []
    for ln in out.splitlines():
        f = ln.split(None, 4)
        lines.append(" ".join(f[:3] + ["1024", f[4]]) if len(f) == 5 else ln)
    out = "\n".join(lines) + "\n"
sys.stdout.write(out)
sys.exit(r.returncode)
PY
    } >"$TMP/fake100.py"
    chmod +x "$TMP/fake100.py"
    bounded 25 t100 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_PS="$TMP/fake100.py" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t100 -- "$LPY" "$TMP/alloc.py" 400 20 "$TMP/t100.pid"
    lim=$(jrec "$LOG" -1 limit); ex=$(jrec "$LOG" -1 exit); pk=$(jrec "$LOG" -1 peak_rss_mb)
    if [ $BRC -ne 86 ]; then fail T100 "exit $BRC, want 86: memory the faked 1 MB rss hides was not counted (journal limit=$lim peak_rss_mb=$pk)"; show "$TMP/t100.err"
    elif [ "$lim" != mem ] || [ "$ex" != 86 ]; then fail T100 "journal limit=$lim exit=$ex, want mem/86"
    elif ! grep -q '^RUNLIMITS: t100 killed: mem [0-9.]* MB > 150 MB (profile teeth)$' "$TMP/t100.err"; then fail T100 "no watchdog killed: mem line"; show "$TMP/t100.err"
    else pass T100 "86/mem with every ps rss faked to 1 MB: phys_footprint counted, peak_rss_mb=$pk"; fi
    kill_loads
else
    skip T100 "darwin-only (phys_footprint), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T101 (darwin)
# R1: a darwin supervisor that cannot read phys_footprint of its own pid refuses
# 88 before the child starts (RUNLIMITS_TEST_FOOTPRINT=unavailable).
if want T101; then
if [ "$PLAT" = darwin ]; then
    begin T101
    bounded 20 t101 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_FOOTPRINT=unavailable RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t101 -- touch "$TMP/t101.started"
    lim=$(jrec "$LOG" -1 limit)
    l101=$(grep '^RUNLIMITS:' "$TMP/t101.err" | head -1)
    if [ $BRC -ne 88 ]; then fail T101 "exit $BRC, want 88"; show "$TMP/t101.err"
    elif [ -e "$TMP/t101.started" ]; then fail T101 "the child started without a darwin memory measure"
    else
        case "$l101" in
            "RUNLIMITS: t101 refused: darwin memory measure unavailable: "?*)
                if [ "$lim" = unavailable ]; then pass T101 "88 before the child, $l101"; else fail T101 "journal limit=$lim, want unavailable"; fi ;;
            *) fail T101 "line '$l101', want 'RUNLIMITS: t101 refused: darwin memory measure unavailable: <why>'" ;;
        esac
    fi
else
    skip T101 "darwin-only (phys_footprint), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T102
# R3: a mark of another uid is not a published supervisor: published_supervisors
# called directly with the reader's uid faked foreign -> set(); with the own uid
# (control) -> the pid. T52 stops at the registry rule A5 before the mark's uid.
if want T102; then
begin T102
r102=$("$LPY" - "$UT/runlimits.py" "$TMP/t102reg" <<'PY' 2>&1
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(sys.argv[1])))
import runlimits as r
reg = sys.argv[2]
os.makedirs(reg)
procs = r.snapshot(dict(os.environ))
me = os.getpid()
os.mkdir(os.path.join(reg, "runlimits-%d-s%d-t102" % (me, procs[me][4])))
own = r.published_supervisors([me], reg, os.getuid(), procs)
foreign = r.published_supervisors([me], reg, os.getuid() + 1, procs)
print("own uid -> %s, foreign uid -> %s" % (sorted(own), sorted(foreign)))
sys.exit(0 if own == {me} and foreign == set() else 1)
PY
)
if [ $? -eq 0 ]; then pass T102 "$r102"
else fail T102 "$(printf '%s' "$r102" | tr '\n' ' ' | head -c 400) (want own uid -> [pid], foreign uid -> [])"; fi
fi

# ---------------------------------------------------------------- T103
# A12 / T34, the start and exit passes of the reap, each alone: (a) a dead
# owner's mark (its supervisor SIGKILLed after publishing) is gone when the next
# supervisor's child starts - removed at that supervisor's start, not at its
# exit; (b) the child SIGKILLs a nested supervisor after its mark appeared and
# exits 0: the outer's exit-path reap removes the mark (no stop path runs).
if want T103; then
begin T103
ok103=1; det103=""
tp="$TMP/t103.tmp"; mkdir -p "$tp"
env RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$(sublog "$LOG/o")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t103o -- "$LPY" "$TMP/alloc.py" 1 20 "$TMP/t103o.pid" >"$TMP/t103o.out" 2>"$TMP/t103o.err" &
so=$!
mo=""; t0=$(now)
while [ -z "$mo" ] && ! elapsed_ge "$t0" "$(now)" 10; do mo=$(firstmatch "$tp"/runlimits-$so-s*); [ -n "$mo" ] || sleep 0.05; done
kill -KILL "$so"; wait "$so"
if [ -z "$mo" ]; then ok103=0; det103="(a) instrument: the first supervisor's mark never appeared: $(tr '\n' ' ' <"$TMP/t103o.err" | head -c 200);"
else
    bounded 20 t103a env RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$(sublog "$LOG/a")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t103a -- "$LPY" -c 'import os, sys; open(sys.argv[2], "w").write("present" if os.path.exists(sys.argv[1]) else "gone")' "$mo" "$TMP/t103a.seen"
    seen=""; [ -s "$TMP/t103a.seen" ] && seen=$(cat "$TMP/t103a.seen")
    if [ $BRC -ne 0 ]; then ok103=0; det103="(a) next supervisor exit $BRC: $(tr '\n' ' ' <"$TMP/t103a.err" | head -c 200);"
    elif [ "$seen" != gone ]; then ok103=0; det103="(a) the dead owner's mark was '$seen' when the next supervisor's child started (want gone: reaped at start);"
    else det103="(a) dead owner's mark reaped at the next start, before its child;"; fi
fi
kill_loads
cat >"$TMP/t103b.sh" <<SH
"$LPY" "$SUP" --wrap teeth --label t103n -- "$LPY" "$TMP/alloc.py" 1 20 "$TMP/t103c.pid" &
n=\$!
i=0
while [ \$i -lt 200 ]; do
    for m in "$tp"/runlimits-\$n-s*; do [ -e "\$m" ] && { echo "\$m" >"$TMP/t103b.mark"; break 2; }; done
    sleep 0.05; i=\$((i+1))
done
[ -s "$TMP/t103b.mark" ] || exit 3
kill -KILL \$n
wait \$n
exit 0
SH
bounded 30 t103b env RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$(sublog "$LOG/b")" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t103b -- "$BASHBIN" "$TMP/t103b.sh"
mb=""; [ -s "$TMP/t103b.mark" ] && mb=$(cat "$TMP/t103b.mark")
nex=$(jfind "$LOG/b" label t103n exit)
if [ -z "$mb" ]; then ok103=0; det103="$det103 (b) instrument: the nested mark never appeared (exit $BRC): $(tr '\n' ' ' <"$TMP/t103b.err" | head -c 200);"
elif [ $BRC -ne 0 ]; then ok103=0; det103="$det103 (b) outer exit $BRC, want 0: $(tr '\n' ' ' <"$TMP/t103b.err" | head -c 200);"
elif [ "$nex" != MISSING ]; then ok103=0; det103="$det103 (b) instrument: the nested supervisor journalled its own end (exit $nex), its finally removed the mark;"
elif [ -e "$mb" ]; then ok103=0; det103="$det103 (b) the SIGKILLed nested supervisor's mark left after the outer's exit: $mb;"
else det103="$det103 (b) nested mark reaped on the outer's exit path;"; fi
kill_loads
if [ $ok103 = 1 ]; then pass T103 "$det103"; else fail T103 "$det103"; fi
fi

# ---------------------------------------------------------------- T104
# R7 (E4): the Ctrl-Z stop set rereads, pid by pid, a start the snapshot could
# not read: readable -> held with it; unreadable (RUNLIMITS_TEST_START_UNREADABLE,
# the T66 seam) -> not held, one stderr line. Direct probe of Supervisor.stop_set:
# the child's own-session descendant sits in the current tree, a fake ps
# (RUNLIMITS_TEST_PS) prints its lstart unparsable in the snapshot only.
# stopprobe <mode> <label>: mode reread (T104), outside (T111) or twice (T117)
stopprobe() {
    local ps0=/bin/ps
    [ -x "$ps0" ] || ps0=/usr/bin/ps
    { echo "#!$LPY"; cat <<PY
import os, subprocess, sys
args = sys.argv[1:]
r = subprocess.run(["$ps0"] + args, stdout=subprocess.PIPE, universal_newlines=True)
out = r.stdout
garble = set(os.environ.get("RL_STOPPROBE_GARBLE", "").split())
if "-axo" in args and garble:
    lines = []
    for ln in out.splitlines():
        f = ln.split(None, 10)
        if len(f) >= 10 and f[0] in garble:
            ln = " ".join(f[:5] + ["?"] * 5 + f[10:])
        lines.append(ln)
    out = "\n".join(lines) + "\n"
sys.stdout.write(out)
sys.exit(r.returncode)
PY
    } >"$TMP/stopps-$2.py"
    chmod +x "$TMP/stopps-$2.py"
    "$LPY" - "$UT/runlimits.py" "$LOG" "$TMP/stopps-$2.py" "$1" "$2" <<'PY'
import io, os, subprocess, sys, time
lib, log, fakeps, mode, label = sys.argv[1:6]
sys.path.insert(0, os.path.dirname(os.path.abspath(lib)))
import runlimits as r
if not hasattr(r.Supervisor, "stop_set"):
    print("the library has no Supervisor.stop_set to probe"); sys.exit(1)
dfile = os.path.join(log, label + ".d")
kid = subprocess.Popen([sys.executable, "-c", "import os, subprocess, sys, time\n"
                        "d = subprocess.Popen(['sleep', '55'], start_new_session=True)\n"
                        "__import__('fixture_pid').record_pid(sys.argv[1], d.pid)\n"
                        "time.sleep(55)", dfile])
outside = subprocess.Popen(["sleep", "55"], start_new_session=True)
d = None
try:
    end = time.time() + 10
    while not os.path.exists(dfile) and time.time() < end:
        time.sleep(0.02)
    d = int(open(dfile).read())
    os.environ["RL_STOPPROBE_GARBLE"] = str(d)
    env = dict(os.environ, RUNLIMITS_LOG_DIR=log, RUNLIMITS_TEST_PS=fakeps)
    env.pop("RUNLIMITS_TEST_START_UNREADABLE", None)
    sup = r.Supervisor.__new__(r.Supervisor)
    sup.ps_lost = False
    sup.label, sup.child, sup.plat = label, kid, r.platform()
    sup.named_unheld = set()
    snap = r.snapshot(env)
    real = r.proc_start(d, env)
    real_out = r.proc_start(outside.pid, env)
    def call(e, last):
        sup.env, sup.last_tree = e, dict(last)
        err, old = io.StringIO(), sys.stderr
        sys.stderr = err
        try:
            got = sup.stop_set()
        finally:
            sys.stderr = old
        return got, err.getvalue().splitlines()
    fixture = (d in snap and snap[d][4] is None and snap[d][0] == kid.pid and real is not None)
    if not fixture:
        print("instrument: fixture not built: descendant %s in snapshot %s, reread start %s"
              % (d, snap.get(d), real)); sys.exit(1)
    if mode == "reread":
        a = call(env, {})
        b = call(dict(env, RUNLIMITS_TEST_START_UNREADABLE=str(d)), {})
        line = "RUNLIMITS: %s: descendant %d not held: start unreadable" % (label, d)
        print("readable -> %s %s; unreadable -> %s %s" % (a[0], a[1], b[0], b[1]))
        ok = a == ({d: real}, []) and b == ({}, [line])
    elif mode == "outside":
        if real_out is None:
            print("instrument: the outside pid's start is unreadable, a reread would not hold it either"); sys.exit(1)
        a = call(env, {outside.pid: None})
        print("tree descendant %d, remembered outside pid %d (start None, not in the tree) -> held %s %s"
              % (d, outside.pid, a[0], a[1]))
        ok = a[0] == {d: real}
    else:
        a = call(env, {outside.pid: None})
        b = call(env, {outside.pid: None})
        line = "RUNLIMITS: %s: remembered %d not held: outside the tree, start not recorded" % (label, outside.pid)
        print("two calls, remembered outside pid %d -> held %s %s / %s %s" % (outside.pid, a[0], a[1], b[0], b[1]))
        ok = a[0] == {d: real} and b[0] == {d: real} and a[1] + b[1] == [line]
    sys.exit(0 if ok else 1)
finally:
    for p in (kid, outside):
        p.kill(); p.wait()
    if d is not None:
        try:
            os.kill(d, 9)
        except OSError:
            pass
PY
}
if want T104; then
begin T104
r104=$(stopprobe reread t104 2>&1)
if [ $? -eq 0 ]; then pass T104 "$r104"
else fail T104 "$(printf '%s' "$r104" | tr '\n' ' ' | head -c 500) (want readable -> {pid: start} [], unreadable -> {} [the not-held line])"; fi
fi

# ---------------------------------------------------------------- T105
# R8: a sublog failure inside $(sublog ...) reaches the runner's summary: the
# runner under test (RL_TEETH_UNDER_TEST) runs T103 with a mkdir that makes the
# dir and its marker but reports failure for log-T103/a -> the FAIL sublog line,
# T103 itself passes, summary failed >= 1, exit != 0. (T103: no kernel or
# timing race of its own, unlike T24(b) on Linux.)
if want T105; then
begin T105
RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
B105="$TMP/t105bin"; mkdir -p "$B105"
MK105=$(command -v mkdir)
cat >"$B105/mkdir" <<SH
#!/bin/sh
for a in "\$@"; do last=\$a; done
case "\$last" in
    */log-T103/a)
        "$MK105" "\$@" || exit 1
        cp "\$(dirname "\$last")/.runlimits-test" "\$last/.runlimits-test" || exit 1
        echo "mkdir: \$last: failure injected by T105" >&2
        exit 1 ;;
esac
exec "$MK105" "\$@"
SH
chmod +x "$B105/mkdir"
bounded 120 t105 env PATH="$B105:$PATH" RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope T103
f105=$(sed -n 's/^TEETH .* failed=\([0-9][0-9]*\) .*/\1/p' "$TMP/t105.out")
if ! grep -q '^FAIL T103 sublog: .*/log-T103/a: ' "$TMP/t105.err"; then fail T105 "instrument: no 'FAIL T103 sublog' line from the injected mkdir failure"; show "$TMP/t105.err"
elif ! grep -q '^PASS T103 ' "$TMP/t105.out"; then fail T105 "instrument: T103 itself did not pass, the count proves nothing"; show "$TMP/t105.out"
elif [ -z "$f105" ] || [ "$f105" -lt 1 ] || [ $BRC -eq 0 ]; then fail T105 "summary failed=${f105:-none} exit $BRC after a sublog failure in \$(...) (want failed >= 1, exit != 0): $(grep '^TEETH ' "$TMP/t105.out")"
else pass T105 "sublog failure in \$(...) counted: $(grep '^TEETH ' "$TMP/t105.out"), exit $BRC"; fi
fi

# ---------------------------------------------------------------- T106 (Linux)
# FIX14 R1: a watchdog memory stop on a tick where the scope's oom_kill count grew
# since the last tick is the kernel's: RUNLIMITS_TEST_OOM_EVENTS=grow makes every
# read of the count one higher, RUNLIMITS_TEST_KERNEL_MEM_MB=1024 keeps the real
# kernel out of the way -> the tick that sees the sum over 150 MB ends 86 with the
# kernel form of the line (no watchdog form), journal limit=mem by=kernel.
if want T106; then
if [ $PLAT = linux ]; then
    begin T106
    bounded 25 t106 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_KERNEL_MEM_MB=1024 RUNLIMITS_TEST_OOM_EVENTS=grow RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t106 -- "$LPY" "$TMP/alloc.py" 300 20 "$TMP/t106.pid"
    lim=$(jrec "$LOG" -1 limit); by=$(jrec "$LOG" -1 by); ex=$(jrec "$LOG" -1 exit)
    if [ $BRC -ne 86 ]; then fail T106 "exit $BRC, want 86"; show "$TMP/t106.err"
    elif grep -q '^RUNLIMITS: t106 killed: mem [0-9.]* MB > 150 MB' "$TMP/t106.err"; then fail T106 "the watchdog form of the killed: mem line on a tick where the kernel's oom_kill count grew"; show "$TMP/t106.err"
    elif ! grep -q '^RUNLIMITS: t106 killed: mem (kernel oom-kill' "$TMP/t106.err"; then fail T106 "no kernel form of the killed: mem line"; show "$TMP/t106.err"
    elif [ "$lim" != mem ] || [ "$by" != kernel ] || [ "$ex" != 86 ]; then fail T106 "journal limit=$lim by=$by exit=$ex, want mem/kernel/86"
    elif [ -s "$TMP/t106.pid" ] && alive "$(cat "$TMP/t106.pid")"; then fail T106 "allocator still alive after the supervisor exited"
    else pass T106 "exit 86, $(grep '^RUNLIMITS:' "$TMP/t106.err" | tr '\n' ' ')journal limit=mem by=kernel"; fi
    kill_loads
else
    skip T106 "linux-only (the scope's oom_kill count), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T107
# FIX14 R3: RUNLIMITS_TEST_TIME_S replaces the profile's time limit: 1 s and a
# sleeping child -> 87, `killed: time <t> s > 1 s`, journal limit=time by=watchdog.
if want T107; then
begin T107
bounded 20 t107 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=1 "$LPY" "$SUP" --wrap teeth --label t107 -- sleep 20
lim=$(jrec "$LOG" -1 limit); by=$(jrec "$LOG" -1 by)
if [ $BRC -ne 87 ]; then fail T107 "exit $BRC, want 87"; show "$TMP/t107.err"
elif ! grep -q '^RUNLIMITS: t107 killed: time [0-9.]* s > 1 s (profile teeth)$' "$TMP/t107.err"; then fail T107 "no 'killed: time <t> s > 1 s' line: the knob did not replace the profile's 3 s"; show "$TMP/t107.err"
elif [ "$lim" != time ] || [ "$by" != watchdog ]; then fail T107 "journal limit=$lim by=$by, want time/watchdog"
else pass T107 "87, $(grep '^RUNLIMITS:' "$TMP/t107.err")"; fi
fi

# ---------------------------------------------------------------- T108
# FIX14 R4, R11: mutate.sh judges a mutant by the teeth's stdout only, a FAIL line
# naming `instrument:` or `sublog:` (either stream) makes the row BROKEN, and a row
# whose teeth are all other-platform-only is a named SKIP. The mutate.sh under test
# (RL_MUTATE_UNDER_TEST) runs in a fixture dir whose teeth runner prints what each
# mutant's NOTES.md asks for: instrument FAIL -> BROKEN; sublog FAIL on stderr next
# to a FAIL on stdout -> BROKEN; FAIL on stderr only -> SURVIVED; FAIL on stdout ->
# RED; a tooth only the other platform has -> SKIP; a row whose own tooth is red
# without the mutant (its baseline, run by row) -> BROKEN naming it (FIX14b).
if want T108; then
begin T108
S108="$TMP/t108"; mkdir -p "$S108"
cp "${RL_MUTATE_UNDER_TEST:-$HERE/mutate.sh}" "$S108/mutate.sh"
for f in runlimits.py runlimits.sh runlimits.mjs census-guard.py; do : >"$S108/$f"; done
printf 'T108 fixture\nclean\n' >"$S108/NOTES.md"
cat >"$S108/runlimits-teeth.sh" <<'SH'
case "$(uname -s)" in Darwin) o=linux ;; *) o=darwin ;; esac
if [ "${1:-}" = --list ]; then printf 'T12\nTB\nTX\t%s-only\n' "$o"; exit 0; fi
if [ "${2:-}" = TB ]; then echo "FAIL TB red without any mutant (T108 baseline fixture)"; exit 1; fi
case "$(cat "$RL_UNDER_TEST/NOTES.md")" in
    *INJECT-INSTRUMENT*) echo "FAIL T12 instrument: injected by T108; the tooth proves nothing"; exit 1 ;;
    *INJECT-SUBLOG*) echo "FAIL T12 sublog: /nowhere: injected by T108" >&2; echo "FAIL T12 red next to the sublog failure"; exit 1 ;;
    *INJECT-STDERR*) echo "FAIL T12 red on stderr only" >&2; exit 1 ;;
    *INJECT-RED*) echo "FAIL T12 red by the mutant"; exit 1 ;;
esac
echo "PASS T12 fixture"
echo "teeth: 1/1"
SH
printf 'M1-inst\tT12\tall\tNOTES.md\tclean\tINJECT-INSTRUMENT\nM2-slog\tT12\tall\tNOTES.md\tclean\tINJECT-SUBLOG\nM3-stderr\tT12\tall\tNOTES.md\tclean\tINJECT-STDERR\nM4-red\tT12\tall\tNOTES.md\tclean\tINJECT-RED\nM5-other\tTX\tall\tNOTES.md\tclean\tINJECT-RED\nM6-base\tTB\tall\tNOTES.md\tclean\tINJECT-RED\n' >"$S108/mutations.tsv"
bounded 120 t108 env RUNLIMITS_HOME="$RUNLIMITS_DIR" "$BASHBIN" "$S108/mutate.sh" --scope M1-inst,M2-slog,M3-stderr,M4-red,M5-other,M6-base
det108=""
grep -q '^BROKEN M1-inst: ' "$TMP/t108.out" || det108="$det108 M1-inst (instrument FAIL) not BROKEN;"
grep -q '^BROKEN M2-slog: ' "$TMP/t108.out" || det108="$det108 M2-slog (sublog FAIL on stderr) not BROKEN;"
grep -q '^SURVIVED M3-stderr: ' "$TMP/t108.out" || det108="$det108 M3-stderr (FAIL on stderr only) not SURVIVED;"
grep -q '^RED M4-red: ' "$TMP/t108.out" || det108="$det108 M4-red (FAIL on stdout) not RED;"
grep -q '^SKIP M5-other: .*TX' "$TMP/t108.out" || det108="$det108 M5-other (other-platform-only tooth TX) not a SKIP naming it;"
grep -q '^BROKEN M6-base: .*baseline.*TB' "$TMP/t108.out" || det108="$det108 M6-base (its tooth TB red without the mutant) not BROKEN naming TB;"
grep -q '^RED M6-base: ' "$TMP/t108.out" && det108="$det108 M6-base counted RED on a tooth red without the mutant;"
grep -qE "^MUTATIONS platform=$PLAT scope=M1-inst,M2-slog,M3-stderr,M4-red,M5-other,M6-base total=5 red=1 survived=1 broken=3 skipped=1\$" "$TMP/t108.out" || det108="$det108 summary '$(grep '^MUTATIONS ' "$TMP/t108.out")', want total=5 red=1 survived=1 broken=3 skipped=1;"
[ $BRC -ne 0 ] || det108="$det108 exit 0 with broken rows;"
if [ -z "$det108" ]; then pass T108 "instrument and sublog FAIL -> BROKEN, stderr-only FAIL -> SURVIVED, stdout FAIL -> RED, other-platform tooth -> SKIP, row baseline red -> BROKEN, exit $BRC"
else fail T108 "$det108 exit $BRC: $(grep -E '^(baseline|RED|SURVIVED|BROKEN|SKIP|MUTATIONS) ' "$TMP/t108.out" | cut -c1-120 | tr '\n' ' ')"; show "$TMP/t108.err"; fi
fi

# ---------------------------------------------------------------- T109
# FIX14 R5, R6, R8: the reap of a dead owner's `unverified` (kill_unverified with a
# snapshot), probed directly: (a) live pid whose start the snapshot could not read
# -> no signal, the record and the mark stay; (b) live pid with another start ->
# no signal, the record goes (a reused pid is not ours); (c) start matches, SIGKILL
# refused (PermissionError) -> the record and the mark stay, a stderr line; (d) (b)
# and (a) in one file -> only (a)'s record is left in it; (e) start matches ->
# SIGKILL, the mark may go.
if want T109; then
begin T109
r109=$("$LPY" - "$UT/runlimits.py" "$LOG" "$TMP/t109reg" <<'PY' 2>&1
import io, os, subprocess, sys, time
lib, log, base = sys.argv[1:4]
sys.path.insert(0, os.path.dirname(os.path.abspath(lib)))
import runlimits as r
env = dict(os.environ, RUNLIMITS_LOG_DIR=log)
sup = r.Supervisor.__new__(r.Supervisor)
sup.ps_lost = False
sup.label, sup.env, sup.plat = "t109", env, r.platform()
n = [0]
def run(lines, procs, deny=()):
    n[0] += 1
    d = os.path.join(base, "runlimits-%d-s1-t109%d" % (os.getpid() + 100000, n[0]))
    os.makedirs(d)
    with open(os.path.join(d, "unverified"), "w") as f:
        f.write("".join(l + "\n" for l in lines))
    real_kill = os.kill
    def kill(pid, sig):
        if pid in deny:
            raise PermissionError(1, "Operation not permitted (injected by T109)")
        return real_kill(pid, sig)
    err, old = io.StringIO(), sys.stderr
    sys.stderr, os.kill = err, kill
    try:
        ok = sup.kill_unverified(d, procs)
    finally:
        sys.stderr, os.kill = old, real_kill
    try:
        left = open(os.path.join(d, "unverified")).read().splitlines()
    except OSError:
        left = None
    return ok, left, err.getvalue().splitlines()
def unread(procs, pid):
    out = dict(procs)
    rec = list(out[pid])
    rec[4] = None
    out[pid] = tuple(rec)
    return out
p = subprocess.Popen(["sleep", "55"])
q = subprocess.Popen(["sleep", "55"])
try:
    time.sleep(0.05)
    procs = r.snapshot(env)
    sp, sq = procs[p.pid][4], procs[q.pid][4]
    if sp is None or sq is None:
        print("instrument: the probe's own sleeps have no readable start"); sys.exit(1)
    bad, det = [], []
    ok, left, lines = run(["%d %d" % (p.pid, sp)], unread(procs, p.pid))
    det.append("(a) %s %s alive=%s" % (ok, left, p.poll() is None))
    if not (ok is False and left == ["%d %d" % (p.pid, sp)] and p.poll() is None):
        bad.append("(a) unreadable start: want False, the record kept, no signal")
    ok, left, lines = run(["%d %d" % (p.pid, sp + 7)], procs)
    det.append("(b) %s alive=%s" % (ok, p.poll() is None))
    if not (ok is True and p.poll() is None):
        bad.append("(b) another start: want True (record goes), no signal")
    ok, left, lines = run(["%d %d" % (p.pid, sp)], procs, deny=(p.pid,))
    want = "RUNLIMITS: t109: SIGKILL to %d left unverified by a dead supervisor failed: " % p.pid
    det.append("(c) %s %s %s" % (ok, left, lines))
    if not (ok is False and left == ["%d %d" % (p.pid, sp)] and p.poll() is None and any(l.startswith(want) for l in lines)):
        bad.append("(c) SIGKILL refused: want False, the record kept, the failed line")
    ok, left, lines = run(["%d %d" % (p.pid, sp + 7), "%d %d" % (q.pid, sq)], unread(procs, q.pid))
    det.append("(d) %s %s" % (ok, left))
    if not (ok is False and left == ["%d %d" % (q.pid, sq)] and p.poll() is None and q.poll() is None):
        bad.append("(d) mixed: want False and only the unreadable record left in the file")
    ok, left, lines = run(["%d %d" % (p.pid, sp)], procs)
    try:
        p.wait(timeout=3)
    except subprocess.TimeoutExpired:
        pass
    det.append("(e) %s rc=%s" % (ok, p.returncode))
    if not (ok is True and p.returncode == -9):
        bad.append("(e) matching start: want True and the pid SIGKILLed")
    print("; ".join(det))
    if bad:
        print("; ".join(bad))
    sys.exit(1 if bad else 0)
finally:
    for x in (p, q):
        if x.poll() is None:
            x.kill()
        x.wait()
PY
)
if [ $? -eq 0 ]; then pass T109 "$r109"
else fail T109 "$(printf '%s' "$r109" | tr '\n' ' ' | head -c 700)"; fi
fi

# ---------------------------------------------------------------- T110 (darwin)
# FIX14 R5: a remembered pid whose start is unknown. (a) The stop without a measure
# (stop_unmeasured, probed directly) records it in `unverified` as `<pid> -` next to
# `<pid> <start>` of a known one, and keeps the mark. (b) The reap of such records
# with a snapshot: pid gone -> the record goes; pid carrying the dead run's token
# RUNLIMITS_TREE=<mark> (env scan, A15) -> SIGKILL; pid without it -> no signal,
# the record stays with a stderr line.
if want T110; then
if [ "$PLAT" = darwin ]; then
    begin T110
    r110=$("$LPY" - "$UT/runlimits.py" "$LOG" "$TMP/t110reg" <<'PY' 2>&1
import io, os, subprocess, sys, time
lib, log, base = sys.argv[1:4]
sys.path.insert(0, os.path.dirname(os.path.abspath(lib)))
import runlimits as r
env = dict(os.environ, RUNLIMITS_LOG_DIR=log)
sup = r.Supervisor.__new__(r.Supervisor)
sup.label, sup.env, sup.plat = "t110", env, r.platform()
def quiet(fn, *a):
    err, old = io.StringIO(), sys.stderr
    sys.stderr = err
    try:
        return fn(*a), err.getvalue().splitlines()
    finally:
        sys.stderr = old
tok = "runlimits-%d-s12345" % (os.getpid() + 200000)
child = subprocess.Popen(["sleep", "55"], start_new_session=True)
known = subprocess.Popen(["sleep", "55"])
unk = subprocess.Popen(["sleep", "55"])
# ps -E prints no environment for Apple's platform binaries (/bin/sleep): the scanned pids are python
nap = [sys.executable, "-c", "import time; time.sleep(55)"]
tp = subprocess.Popen(nap, env=dict(os.environ, RUNLIMITS_TREE=tok))
plain = subprocess.Popen(nap)
gone = subprocess.Popen(["true"])
gone.wait()
try:
    time.sleep(0.1)
    snap = r.snapshot(env)
    if any(snap.get(x.pid, (None,) * 6)[4] is None for x in (child, known)):
        print("instrument: the probe's own sleeps have no readable start"); sys.exit(1)
    bad, det = [], []
    own = os.path.join(base, "own")
    os.makedirs(own)
    r.GRACE_S = 0.2
    sup.child, sup.cgroup, sup.tty, sup.sent_kill, sup.keep_mark, sup.mark_dir = child, None, None, False, False, own
    sup.last_tree = {child.pid: snap[child.pid][4], known.pid: snap[known.pid][4], unk.pid: None}
    left, _ = quiet(sup.stop_unmeasured, "made unavailable by T110")
    try:
        rec = sorted(open(os.path.join(own, "unverified")).read().splitlines())
    except OSError as e:
        rec = "unreadable: %s" % e
    want = sorted(["%d %d" % (known.pid, snap[known.pid][4]), "%d -" % unk.pid])
    det.append("(a) keep_mark=%s unverified=%s" % (sup.keep_mark, rec))
    if not (sup.keep_mark and rec == want):
        bad.append("(a) want the mark kept and unverified %s" % want)
    mark = os.path.join(base, tok + "-t110")
    os.makedirs(mark)
    with open(os.path.join(mark, "unverified"), "w") as f:
        f.write("%d -\n%d -\n%d -\n" % (gone.pid, tp.pid, plain.pid))
    procs = r.snapshot(env)
    ok, lines = quiet(sup.kill_unverified, mark, procs)
    try:
        tp.wait(timeout=3)
    except subprocess.TimeoutExpired:
        pass
    try:
        rest = open(os.path.join(mark, "unverified")).read().splitlines()
    except OSError:
        rest = None
    line = "RUNLIMITS: t110: %d left unverified by a dead supervisor kept: " % plain.pid
    det.append("(b) %s token pid rc=%s plain alive=%s left=%s %s" % (ok, tp.returncode, plain.poll() is None, rest, lines))
    if not (ok is False and tp.returncode == -9 and plain.poll() is None and rest == ["%d -" % plain.pid]
            and any(l.startswith(line) for l in lines)):
        bad.append("(b) want False, the token pid SIGKILLed, the plain pid alive with its record and line, the gone pid's record dropped")
    print("; ".join(det))
    if bad:
        print("; ".join(bad))
    sys.exit(1 if bad else 0)
finally:
    for x in (child, known, unk, tp, plain):
        if x.poll() is None:
            x.kill()
        x.wait()
PY
)
    if [ $? -eq 0 ]; then pass T110 "$r110"
    else fail T110 "$(printf '%s' "$r110" | tr '\n' ' ' | head -c 700)"; fi
else
    skip T110 "darwin-only (unverified is written on darwin, the token scan is ps -E), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T111
# FIX14 R7: stop_set rereads a start only for a pid in this call's current tree: a
# remembered pid outside it, start None, is not reread and not held (so it gets no
# SIGSTOP), while the tree's own unread descendant still is (stopprobe above).
if want T111; then
begin T111
r111=$(stopprobe outside t111 2>&1)
if [ $? -eq 0 ]; then pass T111 "$r111"
else fail T111 "$(printf '%s' "$r111" | tr '\n' ' ' | head -c 500) (want only the tree's descendant held)"; fi
fi

# fakerss: $TMP/fakerss.py, a ps printing every rss column as 1 MB (T112, T114)
fakerss() {
    [ -s "$TMP/fakerss.py" ] && return 0
    { echo "#!$LPY"; cat <<'PY'
import subprocess, sys
args = sys.argv[1:]
r = subprocess.run(["/bin/ps"] + args, stdout=subprocess.PIPE, universal_newlines=True)
out = r.stdout
if "-axo" in args and any("rss=" in a for a in args):
    lines = []
    for ln in out.splitlines():
        f = ln.split(None, 4)
        lines.append(" ".join(f[:3] + ["1024", f[4]]) if len(f) == 5 else ln)
    out = "\n".join(lines) + "\n"
sys.stdout.write(out)
sys.exit(r.returncode)
PY
    } >"$TMP/fakerss.py"
    chmod +x "$TMP/fakerss.py"
}

# ---------------------------------------------------------------- T112 (darwin)
# FIX14 R9: phys_footprint refused with EPERM for the allocator's pid
# (RUNLIMITS_TEST_FOOTPRINT_FAULT=EPERM:<its pid file>), every ps rss faked to 1 MB
# -> the pid counts its rss: no memory stop at 400 MB, the time limit ends it (87);
# journal footprint_unread = [pid]; exactly one stderr line for the run.
if want T112; then
if [ "$PLAT" = darwin ]; then
    begin T112
    fakerss
    bounded 25 t112 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_PS="$TMP/fakerss.py" RUNLIMITS_TEST_FOOTPRINT_FAULT="EPERM:$TMP/t112.pid" "$LPY" "$SUP" --wrap teeth --label t112 -- "$LPY" "$TMP/alloc.py" 400 20 "$TMP/t112.pid"
    lim=$(jrec "$LOG" -1 limit); fu=$(jrec "$LOG" -1 footprint_unread); pk=$(jrec "$LOG" -1 peak_rss_mb)
    ap=""; [ -s "$TMP/t112.pid" ] && ap=$(cat "$TMP/t112.pid")
    nl=$(grep -c '^RUNLIMITS: t112: phys_footprint unread for ' "$TMP/t112.err")
    if [ -z "$ap" ]; then fail T112 "instrument: the allocator never wrote its pid"; show "$TMP/t112.err"
    elif [ $BRC -ne 87 ] || [ "$lim" != time ]; then fail T112 "exit $BRC, journal limit=$lim, want 87/time: the EPERM pid did not count its faked 1 MB rss (peak_rss_mb=$pk)"; show "$TMP/t112.err"
    elif [ "$fu" != "[$ap]" ]; then fail T112 "journal footprint_unread=$fu, want [$ap]"
    elif [ "$nl" != 1 ] || ! grep -qx "RUNLIMITS: t112: phys_footprint unread for $ap: 1; rss used" "$TMP/t112.err"; then fail T112 "$nl phys_footprint unread lines, want exactly one 'RUNLIMITS: t112: phys_footprint unread for $ap: 1; rss used'"; show "$TMP/t112.err"
    else pass T112 "87/time at 400 MB with rss 1 MB counted (peak_rss_mb=$pk), footprint_unread=$fu, one line"; fi
    kill_loads
else
    skip T112 "darwin-only (phys_footprint), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T113 (darwin)
# FIX14 R9: phys_footprint answers ESRCH for the allocator's pid (the pid gone
# between the snapshot and the read) -> the pid counts 0: no memory stop at 400 MB
# of real rss, the time limit ends it (87); no footprint_unread, no stderr line.
if want T113; then
if [ "$PLAT" = darwin ]; then
    begin T113
    bounded 25 t113 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_FOOTPRINT_FAULT="ESRCH:$TMP/t113.pid" "$LPY" "$SUP" --wrap teeth --label t113 -- "$LPY" "$TMP/alloc.py" 400 20 "$TMP/t113.pid"
    lim=$(jrec "$LOG" -1 limit); fu=$(jrec "$LOG" -1 footprint_unread); pk=$(jrec "$LOG" -1 peak_rss_mb)
    if [ ! -s "$TMP/t113.pid" ]; then fail T113 "instrument: the allocator never wrote its pid"; show "$TMP/t113.err"
    elif [ $BRC -ne 87 ] || [ "$lim" != time ]; then fail T113 "exit $BRC, journal limit=$lim, want 87/time: the ESRCH pid was not counted 0 (peak_rss_mb=$pk)"; show "$TMP/t113.err"
    elif [ "$fu" != MISSING ]; then fail T113 "journal footprint_unread=$fu, want none for ESRCH"
    elif grep -q 'phys_footprint unread' "$TMP/t113.err"; then fail T113 "a phys_footprint unread line for ESRCH"; show "$TMP/t113.err"
    else pass T113 "87/time at 400 MB real rss, the ESRCH pid counted 0 (peak_rss_mb=$pk), no footprint_unread"; fi
    kill_loads
else
    skip T113 "darwin-only (phys_footprint), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T114 (darwin)
# FIX14 R10: a Python exception out of the ctypes call itself
# (RUNLIMITS_TEST_FOOTPRINT_FAULT=raise: the call gets an argument ctypes refuses)
# is a FootprintError: (a) for the supervisor's own pid at the start -> 88,
# `refused: darwin memory measure unavailable: proc_pid_rusage(<pid>) raised: ...`,
# the child never starts; (b) for the allocator's pid on a tick -> the other-errno
# branch: rss counted (faked 1 MB -> 87/time), footprint_unread = [pid], one line.
if want T114; then
if [ "$PLAT" = darwin ]; then
    begin T114
    ok114=1; det114=""
    bounded 20 t114s "$BASHBIN" -c '"$1" "$2" "$3" "$$"; shift 3; exec "$@"' t114 "$LPY" "$RL_FIXTURE_PID_HELPER" "$TMP/t114s.pid" env RUNLIMITS_LOG_DIR="$(sublog "$LOG/s")" RUNLIMITS_TEST_FOOTPRINT_FAULT="raise:$TMP/t114s.pid" "$LPY" "$SUP" --wrap teeth --label t114s -- touch "$TMP/t114.started"
    if [ $BRC -ne 88 ] || [ -e "$TMP/t114.started" ] || ! grep -q '^RUNLIMITS: t114s refused: darwin memory measure unavailable: proc_pid_rusage([0-9]*) raised: ' "$TMP/t114s.err"; then
        ok114=0; det114="(a) exit $BRC, child started=$([ -e "$TMP/t114.started" ] && echo y || echo n): $(tr '\n' ' ' <"$TMP/t114s.err" | head -c 300);"
    else det114="(a) 88, $(grep '^RUNLIMITS:' "$TMP/t114s.err");"; fi
    fakerss
    bounded 25 t114t env RUNLIMITS_LOG_DIR="$(sublog "$LOG/t")" RUNLIMITS_TEST_PS="$TMP/fakerss.py" RUNLIMITS_TEST_FOOTPRINT_FAULT="raise:$TMP/t114t.pid" "$LPY" "$SUP" --wrap teeth --label t114t -- "$LPY" "$TMP/alloc.py" 400 20 "$TMP/t114t.pid"
    lim=$(jrec "$LOG/t" -1 limit); fu=$(jrec "$LOG/t" -1 footprint_unread)
    ap=""; [ -s "$TMP/t114t.pid" ] && ap=$(cat "$TMP/t114t.pid")
    nl=$(grep -c '^RUNLIMITS: t114t: phys_footprint unread for ' "$TMP/t114t.err")
    if [ -z "$ap" ]; then ok114=0; det114="$det114 (b) instrument: the allocator never wrote its pid;"
    elif [ $BRC -ne 87 ] || [ "$lim" != time ] || [ "$fu" != "[$ap]" ] || [ "$nl" != 1 ] \
            || ! grep -q "^RUNLIMITS: t114t: phys_footprint unread for $ap: proc_pid_rusage($ap) raised: .*; rss used\$" "$TMP/t114t.err"; then
        ok114=0; det114="$det114 (b) exit $BRC, journal limit=$lim footprint_unread=$fu, $nl unread lines: $(tr '\n' ' ' <"$TMP/t114t.err" | head -c 300);"
    else det114="$det114 (b) 87/time, footprint_unread=$fu, $(grep 'phys_footprint unread' "$TMP/t114t.err");"; fi
    kill_loads
    if [ $ok114 = 1 ]; then pass T114 "$det114"; else fail T114 "$det114"; fi
else
    skip T114 "darwin-only (phys_footprint), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T115 (Linux)
# FIX14 R12: a sublog failure in the runner's own shell (a direct `sublog … || …`,
# T49) is counted once: the tooth's own FAIL, no line in $TMP/subfails. The runner
# under test (RL_TEETH_UNDER_TEST) runs T49 with a mkdir that makes log-T49/r1 and
# its marker but reports failure -> `FAIL T49 sublog` on stderr, `FAIL T49` on
# stdout, summary ran=1 passed=0 failed=1, exit != 0.
if want T115; then
if [ $PLAT = linux ]; then
    begin T115
    RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
    B115="$TMP/t115bin"; mkdir -p "$B115"
    MK115=$(command -v mkdir)
    cat >"$B115/mkdir" <<SH
#!/bin/sh
for a in "\$@"; do last=\$a; done
case "\$last" in
    */log-T49/r1)
        "$MK115" "\$@" || exit 1
        cp "\$(dirname "\$last")/.runlimits-test" "\$last/.runlimits-test" || exit 1
        echo "mkdir: \$last: failure injected by T115" >&2
        exit 1 ;;
esac
exec "$MK115" "\$@"
SH
    chmod +x "$B115/mkdir"
    bounded 120 t115 env PATH="$B115:$PATH" RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope T49
    s115=$(grep '^TEETH ' "$TMP/t115.out")
    if ! grep -q '^FAIL T49 sublog: .*/log-T49/r1: ' "$TMP/t115.err"; then fail T115 "instrument: no 'FAIL T49 sublog' line from the injected mkdir failure"; show "$TMP/t115.err"
    elif ! grep -q '^FAIL T49 ' "$TMP/t115.out"; then fail T115 "instrument: T49 itself did not fail on its direct sublog failure"; show "$TMP/t115.out"
    else
        case "$s115" in
            *" ran=1 passed=0 failed=1 "*) if [ $BRC -ne 0 ]; then pass T115 "direct sublog failure counted once: $s115, exit $BRC"; else fail T115 "exit 0 after a failed tooth: $s115"; fi ;;
            *) fail T115 "summary '$s115' after one direct sublog failure in the runner's own shell (want ran=1 passed=0 failed=1: counted once)" ;;
        esac
    fi
else
    skip T115 "linux-only (T49, the direct sublog caller, is linux-only), not counted on $PLAT"
fi
fi

# ---------------------------------------------------------------- T116
# FIX14b: --each-alone runs every scoped tooth by its own `--scope Tn` call, so a tooth
# that leans on another's fixture fails there. Fixture: a mkdir (PATH) that refuses
# log-T3 unless log-T2 already sits next to it - T3 depends on T2 having run first in
# the same runner. The runner under test (RL_TEETH_UNDER_TEST): (a) --scope T2,T3 ->
# green (the dependency is met); (b) --scope T3 -> red (the fixture works); (c)
# --each-alone --scope T2,T3 -> `alone ran=2 passed=1 failed=1`, T3 named, exit != 0.
if want T116; then
begin T116
RT=${RL_TEETH_UNDER_TEST:-$HERE/runlimits-teeth.sh}
B116="$TMP/t116bin"; mkdir -p "$B116"
MK116=$(command -v mkdir)
cat >"$B116/mkdir" <<SH
#!/bin/sh
for a in "\$@"; do last=\$a; done
case "\$last" in
    */log-T3)
        [ -d "\$(dirname "\$last")/log-T2" ] && exec "$MK116" "\$@"
        echo "mkdir: \$last: refused by T116 (log-T2 absent: T3 ran without T2)" >&2
        exit 1 ;;
esac
exec "$MK116" "\$@"
SH
chmod +x "$B116/mkdir"
bounded 90 t116a env PATH="$B116:$PATH" RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope T2,T3; rca=$BRC
bounded 90 t116b env PATH="$B116:$PATH" RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --scope T3; rcb=$BRC
bounded 180 t116c env PATH="$B116:$PATH" RL_UNDER_TEST="$UT" "$BASHBIN" "$RT" --each-alone --scope T2,T3; rcc=$BRC
if [ $rca -ne 0 ]; then fail T116 "instrument: --scope T2,T3 with the dependency met exit $rca: $(grep -E '^(FAIL|TEETH) ' "$TMP/t116a.out" | tr '\n' ' ' | head -c 300)"
elif [ $rcb -eq 0 ] || ! grep -q '^FAIL T3 ' "$TMP/t116b.out"; then fail T116 "instrument: --scope T3 alone did not fail (exit $rcb): the fixture makes no dependency"
elif ! grep -qE '^alone ran=2 passed=1 failed=1$' "$TMP/t116c.out" || ! grep -qE '^alone failed: T3$' "$TMP/t116c.out" || [ $rcc -eq 0 ]; then
    fail T116 "--each-alone --scope T2,T3 exit $rcc: $(grep '^alone ' "$TMP/t116c.out" | grep -v ' | ' | tr '\n' ' ' | head -c 400) (want alone ran=2 passed=1 failed=1, alone failed: T3, exit != 0)"; show "$TMP/t116c.err"
else pass T116 "T3 leaning on T2: together green, alone red; --each-alone: $(grep -E '^alone (ran|failed)' "$TMP/t116c.out" | tr '\n' ' ')exit $rcc"; fi
fi

# ---------------------------------------------------------------- T117
# FIX14b: a remembered pid outside the current tree with no start is not held and is
# named on stderr once per pid per run: two stop_set calls, one line (stopprobe).
if want T117; then
begin T117
r117=$(stopprobe twice t117 2>&1)
if [ $? -eq 0 ]; then pass T117 "$r117"
else fail T117 "$(printf '%s' "$r117" | tr '\n' ' ' | head -c 500) (want the tree's descendant held both times, exactly one not-held line for the outside pid)"; fi
fi

# ---------------------------------------------------------------- T118 T119
# FIX14c R3: a signal the supervisor itself received is named in its journal record
# (`signal`; the signal neither sets nor clears `limit`, T120) and on one stderr line; a child that exits 143 on its
# own leaves no such field. T118: TERM to the supervisor's own pid while its child
# sleeps -> 143, journal signal=TERM limit=null exit=143, exactly one line `RUNLIMITS:
# t118 stopped: signal TERM from outside`. T119: the child exits 143 by itself -> 143,
# journal limit=null, no `signal` field, no such line.
if want T118; then
begin T118
env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t118 -- "$LPY" -c 'import os, sys, time; __import__("fixture_pid").record_pid(sys.argv[1], os.getpid()); time.sleep(20)' "$TMP/t118.pid" >"$TMP/t118.out" 2>"$TMP/t118.err" &
s118=$!
if ! wait_file "$TMP/t118.pid" 10; then fail T118 "child never started"; show "$TMP/t118.err"; kill -KILL "$s118"; wait "$s118"
else
    t0=$(now); kill -TERM "$s118"
    if ! wait_dead "$s118" "$STOP_S" "$t0"; then fail T118 "supervisor alive $STOP_S s after SIGTERM"; kill -KILL "$s118"; wait "$s118"
    else
        wait "$s118"; rc118=$?
        sg=$(jrec "$LOG" -1 signal); lim=$(jrec "$LOG" -1 limit); ex=$(jrec "$LOG" -1 exit)
        n118=$(grep -c '^RUNLIMITS: t118 stopped: signal ' "$TMP/t118.err")
        if [ $rc118 -ne 143 ] || [ "$ex" != 143 ] || [ "$lim" != null ]; then fail T118 "exit $rc118, journal exit=$ex limit=$lim (want 143 / 143 / null)"; show "$TMP/t118.err"
        elif [ "$sg" != TERM ]; then fail T118 "journal signal=$sg, want TERM: a TERM from outside reads like the child's own 143"; show "$TMP/t118.err"
        elif [ "$n118" != 1 ] || ! grep -qx 'RUNLIMITS: t118 stopped: signal TERM from outside' "$TMP/t118.err"; then fail T118 "$n118 'stopped: signal' line(s), want exactly 'RUNLIMITS: t118 stopped: signal TERM from outside'"; show "$TMP/t118.err"
        else pass T118 "TERM to the supervisor: exit 143, journal signal=TERM limit=null, $(grep '^RUNLIMITS: t118 stopped' "$TMP/t118.err")"; fi
    fi
fi
kill_loads
fi

if want T119; then
begin T119
bounded 15 t119 env RUNLIMITS_LOG_DIR="$LOG" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t119 -- sh -c 'exit 143'
sg=$(jrec "$LOG" -1 signal); lim=$(jrec "$LOG" -1 limit); ex=$(jrec "$LOG" -1 exit)
if [ $BRC -ne 143 ] || [ "$ex" != 143 ] || [ "$lim" != null ]; then fail T119 "exit $BRC, journal exit=$ex limit=$lim (want 143 / 143 / null)"; show "$TMP/t119.err"
elif [ "$sg" != MISSING ]; then fail T119 "journal signal=$sg for a child that exited 143 by itself (want no field)"; show "$TMP/t119.err"
elif grep -q 'stopped: signal' "$TMP/t119.err"; then fail T119 "a 'stopped: signal' line with no signal received"; show "$TMP/t119.err"
else pass T119 "the child's own exit 143: journal limit=null, no signal field, no 'stopped: signal' line"; fi
fi

# ---------------------------------------------------------------- T120
# a limit and a signal are two facts (FIX14d R3): the supervisor's parent dies ->
# parent-gone stop, SIGTERM to the tree; the child survives TERM, so the stop waits
# GRACE_S, and inside that window the supervisor itself gets TERM -> journal
# limit=parent-gone (the first limit; the signal neither sets nor clears it),
# signal=TERM, exit 143, and one line each: `RUNLIMITS: t120 killed: parent gone (set
# RUNLIMITS_DETACH=1 to detach)` and `RUNLIMITS: t120 stopped: signal TERM from outside`.
# The supervisor is re-parented, its exit is read from the journal.
if want T120; then
begin T120
L120="$LOG/t120"
cat >"$TMP/t120l.py" <<'PY'
import subprocess, sys, time
p = subprocess.Popen(sys.argv[2:])
with open(sys.argv[1], "w") as f:
    __import__("fixture_pid").record_pid(f.name, p.pid)
time.sleep(60)
PY
cat >"$TMP/t120c.py" <<'PY'
import os, signal, sys, time
tag = sys.argv[1]
def on_term(*_a):
    with open(tag + ".term", "w") as f:
        f.write("1")
signal.signal(signal.SIGTERM, on_term)
with open(tag + "c.pid", "w") as f:
    __import__("fixture_pid").record_pid(f.name, os.getpid())
deadline = time.time() + 30
while time.time() < deadline:
    time.sleep(0.05)
PY
if ! sublog "$L120" >/dev/null; then fail T120 "sublog failed"
else
    "$LPY" "$TMP/t120l.py" "$TMP/t120s.pid" env RUNLIMITS_LOG_DIR="$L120" RUNLIMITS_TEST_TIME_S=30 "$LPY" "$SUP" --wrap teeth --label t120 -- "$LPY" "$TMP/t120c.py" "$TMP/t120" "$TOKEN" >"$TMP/t120.out" 2>"$TMP/t120.err" &
    lp=$!
    if ! wait_file "$TMP/t120s.pid" 10 || ! wait_file "$TMP/t120c.pid" 20; then
        fail T120 "supervisor or child never started"; show "$TMP/t120.err"; kill -KILL "$lp"; wait "$lp"
    else
        s120=$(cat "$TMP/t120s.pid"); t0=$(now); kill -KILL "$lp"; wait "$lp"
        if ! wait_file "$TMP/t120.term" 10; then fail T120 "no parent-gone stop: the child got no SIGTERM 10 s after the supervisor's parent died"; show "$TMP/t120.err"
        else
            signal_file TERM "$TMP/t120s.pid" "$TMP/t120.err"
            if ! wait_pidfile "$TMP/t120s.pid" "$STOP_S"; then fail T120 "supervisor alive $STOP_S s after SIGTERM inside its stop window"; show "$TMP/t120.err"
            else
                lim=$(jrec "$L120" -1 limit); sg=$(jrec "$L120" -1 signal); ex=$(jrec "$L120" -1 exit)
                npg=$(grep -c '^RUNLIMITS: t120 killed: parent gone (set RUNLIMITS_DETACH=1 to detach)$' "$TMP/t120.err")
                nsg=$(grep -c '^RUNLIMITS: t120 stopped: signal TERM from outside$' "$TMP/t120.err")
                if [ "$ex" != 143 ] || [ "$lim" != parent-gone ]; then fail T120 "journal exit=$ex limit=$lim (want 143 / parent-gone: the signal must not clear the first limit)"; show "$TMP/t120.err"
                elif [ "$sg" != TERM ]; then fail T120 "journal signal=$sg, want TERM: the supervisor received TERM inside its parent-gone stop"; show "$TMP/t120.err"
                elif [ "$npg" != 1 ] || [ "$nsg" != 1 ]; then fail T120 "$npg 'parent gone' line(s), $nsg 'stopped: signal' line(s), want one each"; show "$TMP/t120.err"
                else pass T120 "parent gone, then TERM inside the stop window: journal exit=143 limit=parent-gone signal=TERM, both lines"; fi
            fi
        fi
    fi
fi
kill_loads
fi

# ---------------------------------------------------------------- T121..T126
# #552: a runner's EXIT trap finishes inside its supervisor's stop (NOTES item 6d).
# The fixture t12x.sh has mutate.sh's trap form - kill_tree with the STOP_S limit
# (NESTED_STOP_S of the library under test), then rm -rf of its own dir under
# TMPDIR, then a witness file - over a load that survives TERM and stamps the time
# of its first TERM. It runs under a supervisor of profile runner with a private
# TMPDIR, registry and log dir; the stop is the supervisor's parent dying
# (parent-gone), except T122.
# T121 (S1): the trap finishes - its dir removed, the witness written - and the
#   load is dead within GRACE_S + 1 s of its TERM; journal exit=143 limit=parent-gone.
# T122 (S3): the same by TERM to the supervisor itself, its parent alive: exit 143,
#   journal exit=143 signal=TERM.
# T123 (S6, Linux): as T121, and from the load's TERM on every full ps table fails
#   (a shim through RUNLIMITS_TEST_PS); stderr names `cannot measure during the stop`.
# T123s (Linux): as T123 plus RUNLIMITS_TEST_SCOPE_UNREADABLE=1 - scope_pids() yields
#   nothing; the remembered load is proven by the single-pid ps call alone.
# T123b (Linux): as T123 with RL_T12X_ALL=1 - the shim fails the single-pid ps calls
#   too; the remembered load is proven by scope membership alone.
# T124 (S7): as T121 with a nested supervisor (profile unit) whose child dies on
#   TERM; it must be gone within GRACE_S - 1 s of the TERM (else the case is not set
#   up: instrument), its journal record written.
# T125: as T121, and the load starts a TERM-ignoring process on its TERM: that
#   process is dead within GRACE_S + 1 s of the TERM (a load's newborn is not spared).
# T126: the trap sleeps 60 s after kill_tree: the host dies NESTED_STOP_S - 1 s ..
#   NESTED_STOP_S + 4 s after the TERM (the window's end), no witness; journal
#   exit=143 limit=parent-gone.
# T127 (Linux, #552b D7): every full ps table fails from a regular tick on (the
#   shim, before any stop): the stop without a measure; the load exits 9 s after
#   the TERM of the trap's kill_tree -> the trap finishes (dir removed, witness,
#   kill_tree exit 0), journal exit=88 limit=unavailable, stderr `refused: cannot
#   measure: ...`; after the lost measure the shim logs no further ps call.
# T128 (#552b D8): INT to the supervisor starts the trap, then TERM once kill_tree
#   has sent its TERM to the load -> kill_tree, started after INT, is not killed at
#   GRACE_S after the TERM (its exit 0), the load is dead within GRACE_S + 1 s of
#   the TERM, the trap finishes; exit 130, journal exit=130 signal=INT.
G12=$("$LPY" -B -c 'import sys; sys.path.insert(0, sys.argv[1]); import runlimits as r; print("%s %s" % (r.GRACE_S + 1, r.GRACE_S - 1))' "$UT")
G12P=${G12% *}; G12M=${G12#* }
mk12x() {
    cat >"$TMP/t12x.sh" <<'SH'
# t12x.sh <tag> <python> <stop_s> <mode> <runlimits.py>
set -u
tg=$1 PY=$2 STOP_S=$3 mode=$4 SUPL=$5
pidfile() { "$PY" "$RL_FIXTURE_PID_HELPER" "$1" "$2"; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/rl-t12x.XXXXXX") || exit 2
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
same_fixture = {p for p, start in first.items() if p in rows and rows[p][2] == start}
send(live(rows, same_fixture | set(tree(rows))), signal.SIGKILL)
PY
}
# spawn: kill_tree's first snapshot must hold the load's newborn, so a newborn wrongly spared keeps the trap waiting
cleanup() { trap '' INT HUP TERM; if [ "$mode" = spawn ]; then while [ ! -s "$tg.gc" ]; do sleep 0.05; done; fi; kill_tree "$PY" $$ "$STOP_S"; echo $? >"$tg.kt"; if [ "$mode" = long ]; then sleep 60; fi; rm -rf "$TMP"; echo done >"$tg.rm"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 129' HUP
trap 'exit 143' TERM
if [ "$mode" = nested ]; then
    "$PY" "$SUPL" --wrap unit --label "${tg##*/}n" -- "$PY" "${0%/*}/t12xload.py" "$tg" nested-child &
fi
"$PY" "${0%/*}/t12xload.py" "$tg" "$mode" &
printf '%s\n' "$TMP" >"$tg.tmpd"
pidfile "$tg.host" $$
wait
SH
    cat >"$TMP/t12xload.py" <<'PY'
import os, signal, subprocess, sys, time
tg, mode = sys.argv[1], sys.argv[2]
def put(path, text):
    with open(path + ".w", "w") as f:
        f.write(text)
    os.rename(path + ".w", path)
from fixture_pid import record_pid as put_pid
if mode == "nested-child":
    put_pid(tg + ".nc", os.getpid())
    time.sleep(30)
    sys.exit(0)
def on_term(*_a):
    global deadline
    # ignored from here on: the load survives every later TERM, and a process it starts inherits that
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    put(tg + ".term", "%.3f" % time.time())
    if mode == "unmeasured":
        # past GRACE_S (5), short of NESTED_STOP_S (20): no SIGKILL reaches the load in that stop,
        # the trap's kill_tree waits for this exit
        deadline = time.time() + 9
    if mode in ("psfail", "procstop", "scopefail", "psall"):
        put(tg + ".psfail", "1")
    if mode == "spawn":
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        put_pid(tg + ".gc", p.pid)
signal.signal(signal.SIGTERM, on_term)
put_pid(tg + ".load", os.getpid())
deadline = time.time() + 60
while time.time() < deadline:
    time.sleep(0.05)
PY
    cat >"$TMP/t12xl.py" <<'PY'
import os, subprocess, sys, time
p = subprocess.Popen(sys.argv[2:])
__import__("fixture_pid").record_pid(sys.argv[1], p.pid)
time.sleep(120)
PY
    printf '%s\n' '#!/bin/sh' 'if [ -e "$RL_T12X_FLAG" ]; then printf "%s\n" "$*" >>"$RL_T12X_FLAG.calls"; if [ "${RL_T12X_ALL:-}" = 1 ]; then echo "t130 shim: ps unavailable" >&2; exit 1; fi; fi' 'case "$*" in *-axo*) if [ -e "$RL_T12X_FLAG" ]; then echo "t123 shim: full ps table unavailable" >&2; exit 1; fi ;; esac' "exec $(command -v ps) \"\$@\"" >"$TMP/t12xps.sh"
    chmod +x "$TMP/t12xps.sh"
}
# one line per file: the load's pid files carry no final newline, cat would glue two pids
pids12() { local f; for f in "$@"; do if [ -s "$f" ]; then printf '%s\n' "$(cat "$f")"; fi; done; }
kill12() { # <tag path>: SIGKILL to every pid of the case still alive (its own pid files and the supervisor's tree)
    local p s st f published
    published=" $(pids12 "$1.sup" "$1.host" "$1.load" "$1.gc" "$1.nc" | tr '\n' ' ') "
    s=$(pids12 "$1.sup")
    st=""; [ -s "$1.sup.start" ] && st=$(cat "$1.sup.start")
    : >"$1.cleanup-targets"
    if [ -n "$s" ] && same_pid "$s" "$st"; then
        for p in $(descendants "$s"); do
            case "$published" in *" $p "*) continue ;; esac
            st=$(pstart "$p"); printf '%s %s\n' "$p" "${st:--}" >>"$1.cleanup-targets"
        done
    fi
    for f in "$1.sup" "$1.host" "$1.load" "$1.gc" "$1.nc"; do
        if [ -s "$f" ]; then
            p=$(cat "$f"); st=""; [ -s "$f.start" ] && st=$(cat "$f.start")
            printf '%s %s\n' "$p" "${st:--}" >>"$1.cleanup-targets"
        fi
    done
    while read -r p st; do signal_saved KILL "$p" "$st" "$1.err"; done <"$1.cleanup-targets"
}
trap_case() { # <tag> <mode: parent|term|psfail|nested|spawn|long|unmeasured|int|refuse> -> R12, 0 = pass
    local tag=$1 mode=$2 tg="$TMP/$1" tp="$TMP/$1.tmp" lg="$LOG/$1" lp="" sp hp ld st tmpd gc="" nsp="" hd ldd gcd nsd rc="" ex lim sg jn="" wit tmpl kt ldw=$G12P sref="" iref="" direct=n
    R12=""
    abort12() {
        local ap ast abort_failed=0
        kill12 "$tg"
        for ap in sup launcher; do
            if [ "$ap" = sup ]; then
                [ -s "$tg.sup" ] || continue
                ap=$(cat "$tg.sup"); ast=""; [ -s "$tg.sup.start" ] && ast=$(cat "$tg.sup.start")
            else
                [ -n "$lp" ] || continue
                ap=$lp; ast=""; [ -s "$tg.launcher.start" ] && ast=$(cat "$tg.launcher.start")
                signal_saved KILL "$ap" "$ast" "$tg.err"
            fi
            if ! wait_dead "$ap" 2 "$(now)" "$ast"; then
                R12="instrument: cleanup identity unavailable or process still alive; $R12"
                abort_failed=1
            fi
        done
        return "$abort_failed"
    }
    [ -f "$TMP/t12x.sh" ] || mk12x
    mkdir -p "$tp"
    sublog "$lg" >/dev/null || { R12="sublog failed"; return 1; }
    case $mode in term|int|unmeasured|procunmeasured|refuse) direct=y ;; esac
    # the load leaves on its own 9 s after its TERM, the window is NESTED_STOP_S
    if [ "$mode" = unmeasured ]; then ldw=$((NST - 5)); fi
    case $mode in procstop|procunmeasured) ldw=$("$LPY" -c 'import sys; sys.path.insert(0, sys.argv[1]); import runlimits as r; print(r.GRACE_S + r.TICK_S)' "$UT") ;; esac
    set -- env TMPDIR="$tp" RUNLIMITS_REGISTRY="$tp" RUNLIMITS_LOG_DIR="$lg"
    case $mode in psfail|unmeasured|scopefail|psall) set -- "$@" RUNLIMITS_TEST_PROC_UNREADABLE=1 ;; esac
    case $mode in scopefail) set -- "$@" RUNLIMITS_TEST_SCOPE_UNREADABLE=1 ;; esac
    case $mode in procstop|procunmeasured|psall) set -- "$@" RL_T12X_ALL=1 ;; esac
    case $mode in psfail|unmeasured|procstop|procunmeasured|scopefail|psall) set -- "$@" RUNLIMITS_TEST_PS="$TMP/t12xps.sh" RL_T12X_FLAG="$tg.psfail" ;; esac
    # CONSTRAINT: refuse arms the failing ps shim before the spawn - the start
    # measurement itself must fail, the subject refuses before any child runs
    case $mode in refuse) set -- "$@" RUNLIMITS_TEST_PS="$TMP/t12xps.sh" RL_T12X_FLAG="$tg.psfail" RL_T12X_ALL=1; : >"$tg.psfail" ;; esac
    set -- "$@" "$LPY" "$SUP" --wrap runner --label "$tag" -- "$BASHBIN" "$TMP/t12x.sh" "$tg" "$LPY" "$NST" "$mode" "$SUP"
    if [ $direct = y ]; then
        "$@" >"$tg.out" 2>"$tg.err" &
        sp=$!; save_pid "$tg.sup" "$sp"
    else
        "$LPY" "$TMP/t12xl.py" "$tg.sup" "$@" >"$tg.out" 2>"$tg.err" &
        lp=$!; save_pid "$tg.launcher" "$lp"
    fi
    if ! wait_file "$tg.sup" 10 || ! wait_file "$tg.host" 30 || ! wait_file "$tg.load" 10 || { [ "$mode" = nested ] && ! wait_file "$tg.nc" 30; }; then
        # CONSTRAINT: a start refusal of the subject is its outcome, not an
        # instrument failure (refuse_line, runlimits.py:505); the instrument
        # form stays for a fixture that died without any subject refusal; the
        # refusal is read by the exact label of the subject (`$tag`) or of its
        # nested supervisor (`${tag}n`, fixture `mk12x`); a line of any other
        # label is not the subject's
        sref=""; iref=""
        if [ -s "$tg.err" ]; then
            sref=$(awk -v p="RUNLIMITS: $tag refused: " 'index($0, p) == 1 { print; exit }' "$tg.err")
            iref=$(awk -v p="RUNLIMITS: ${tag}n refused: " 'index($0, p) == 1 { print; exit }' "$tg.err")
        fi
        if [ -n "$sref" ]; then
            R12="subject refused at start: $sref"
        elif [ -n "$iref" ]; then
            R12="inner supervisor refused at start: $iref"
        else
            R12="instrument: fixture never started: $(tr '\n' ' ' <"$tg.err" | head -c 300)"
        fi
        abort12
        rm -f "$tg.psfail"
        return 1
    fi
    sp=$(cat "$tg.sup"); hp=$(cat "$tg.host"); ld=$(cat "$tg.load"); tmpd=$(cat "$tg.tmpd")
    if [ "$mode" = nested ]; then nsp=$(ps -o ppid= -p "$(cat "$tg.nc")" | tr -d ' '); save_pid "$tg.nsup" "$nsp"; fi
    case $mode in
        term) signal_saved TERM "$sp" "$(cat "$tg.sup.start")" "$tg.err" ;;
        int) signal_saved INT "$sp" "$(cat "$tg.sup.start")" "$tg.err" ;;
        unmeasured|procunmeasured) : >"$tg.psfail" ;;
        *) signal_saved KILL "$lp" "$(cat "$tg.launcher.start")" "$tg.err"; wait_dead "$lp" 2 "$(now)" "$(cat "$tg.launcher.start")" && wait "$lp" ;;
    esac
    if ! wait_file "$tg.term" 10; then
        R12="instrument: the load got no TERM within 10 s of the stop: $(tr '\n' ' ' <"$tg.err" | head -c 300)"
        abort12
        rm -f "$tg.psfail"
        return 1
    fi
    st=$(cat "$tg.term")
    # int: the TERM comes once the trap's kill_tree is running (it has TERMed the load); the clock starts there
    if [ "$mode" = int ]; then st=$(now); signal_saved TERM "$sp" "$(cat "$tg.sup.start")" "$tg.err"; fi
    if [ "$mode" = spawn ]; then
        if ! wait_file "$tg.gc" 5; then
            R12="instrument: newborn pid missing after 5 s"; abort12; return 1
        fi
        gc=$(pids12 "$tg.gc")
    fi
    nsd=y; if [ -n "$nsp" ]; then wait_dead "$nsp" "$G12M" "$st" "$(cat "$tg.nsup.start")" || nsd=n; fi
    ldd=y; wait_dead "$ld" "$ldw" "$st" "$(cat "$tg.load.start")" || ldd=n
    gcd=y; if [ -n "$gc" ]; then wait_dead "$gc" "$G12P" "$st" "$(cat "$tg.gc.start")" || gcd=n; fi
    wait_dead "$hp" "$((NST + 5))" "$st" "$(cat "$tg.host.start")"; hd=$(secs_between "$st" "$(now)")
    if ! wait_dead "$sp" $((NST + 10)) "$st" "$(cat "$tg.sup.start")"; then
        R12="trap window unbounded: supervisor still alive after $(secs_between "$st" "$(now)") s (bound $((NST + 10)) s from TERM)"
        signal_saved KILL "$sp" "$(cat "$tg.sup.start")" "$tg.err"
        abort12
        return 1
    fi
    if [ $direct = y ]; then wait "$sp"; rc=$?; fi
    ex=$(jfind "$lg" label "$tag" exit); lim=$(jfind "$lg" label "$tag" limit); sg=$(jfind "$lg" label "$tag" signal)
    if [ "$mode" = nested ]; then jn=$(jfind "$lg" label "${tag}n" exit); fi
    wit=n; [ -s "$tg.rm" ] && wit=y
    tmpl=n; [ -e "$tmpd" ] && tmpl=y
    kt=""; if [ -s "$tg.kt" ]; then kt=$(cat "$tg.kt"); fi
    kill12 "$tg"
    rm -f "$tg.psfail"
    R12="host dead $hd s after the load's TERM, trap dir left=$tmpl, witness=$wit, kill_tree exit=${kt:-none}, load dead within $ldw s=$ldd${gc:+, its newborn dead within $G12P s=$gcd}${nsp:+, nested supervisor gone within $G12M s=$nsd, its journal exit=$jn}, journal exit=$ex limit=$lim signal=$sg${rc:+, supervisor exit $rc}"
    if [ -n "$nsp" ] && [ $nsd = n ]; then R12="instrument: the nested supervisor outlived $G12M s after the TERM, the case (S7) is not set up; $R12"; abort12; return 1; fi
    if [ "$mode" = long ]; then
        if elapsed_ge 0 "$hd" "$((NST - 1))" && ! elapsed_ge 0 "$hd" "$((NST + 4))" && [ $wit = n ] && [ "$ex" = 143 ] && [ "$lim" = parent-gone ]; then return 0; fi
        abort12; return 1
    fi
    [ $tmpl = n ] && [ $wit = y ] && [ $ldd = y ] && [ $gcd = y ] || { abort12; return 1; }
    case $mode in
        term) [ "$ex" = 143 ] && [ "$sg" = TERM ] && [ "$rc" = 143 ] ;;
        int) [ "$ex" = 130 ] && [ "$sg" = INT ] && [ "$rc" = 130 ] && [ "$kt" = 0 ] ;;
        unmeasured)
            R12="$R12, ps calls after fault=$(wc -l <"$tg.psfail.calls" | tr -d ' ') (want 1: the failing watch snapshot only)"
            show "$tg.psfail.calls"
            [ "$ex" = 88 ] && [ "$lim" = unavailable ] && [ "$rc" = 88 ] && [ "$kt" = 0 ] && [ "$(wc -l <"$tg.psfail.calls" | tr -d ' ')" = 1 ] && grep -q "^RUNLIMITS: $tag refused: cannot measure: .*; tree killed$" "$tg.err" ;;
        procstop) [ "$ex" = 143 ] && [ "$lim" = parent-gone ] && [ "$kt" = 0 ] ;;
        procunmeasured)
            R12="$R12, ps calls after fault=$(wc -l <"$tg.psfail.calls" | tr -d ' ') (want 1: the failing watch snapshot only)"
            show "$tg.psfail.calls"
            [ "$ex" = 88 ] && [ "$lim" = unavailable ] && [ "$rc" = 88 ] && [ "$kt" = 0 ] && [ "$(wc -l <"$tg.psfail.calls" | tr -d ' ')" = 1 ] && grep -q "^RUNLIMITS: $tag refused: cannot measure: .*; tree killed$" "$tg.err" ;;
        nested) [ "$ex" = 143 ] && [ "$lim" = parent-gone ] && [ -n "$jn" ] && [ "$jn" != MISSING ] ;;
        psfail|scopefail|psall) [ "$ex" = 143 ] && [ "$lim" = parent-gone ] && grep -q "^RUNLIMITS: $tag: cannot measure during the stop " "$tg.err" ;;
        *) [ "$ex" = 143 ] && [ "$lim" = parent-gone ] ;;
    esac
    local verdict=$?
    [ "$verdict" = 0 ] || abort12
    return "$verdict"
}
if want T121; then
begin T121
    if trap_case t121 parent; then pass T121 "$R12"; else fail T121 "$R12"; show "$TMP/t121.err"; fi
fi
if want T122; then
begin T122
    if trap_case t122 term; then pass T122 "$R12"; else fail T122 "$R12"; show "$TMP/t122.err"; fi
fi
if want T123; then
if [ $PLAT = linux ]; then
    begin T123
    if trap_case t123 psfail; then pass T123 "$R12"; else fail T123 "$R12"; show "$TMP/t123.err"; fi
else
    skip T123 "linux-only (a lost ps keeps the trap spared only under the scope's kernel limits), not counted on $PLAT"
fi
fi
if want T123s; then
if [ $PLAT = linux ]; then
    begin T123s
    if trap_case t123s scopefail; then pass T123s "$R12"; else fail T123s "$R12"; show "$TMP/t123s.err"; fi
else
    skip T123s "linux-only (a lost ps keeps the trap spared only under the scope's kernel limits), not counted on $PLAT"
fi
fi
if want T123b; then
if [ $PLAT = linux ]; then
    begin T123b
    if trap_case t123b psall; then pass T123b "$R12"; else fail T123b "$R12"; show "$TMP/t123b.err"; fi
else
    skip T123b "linux-only (a lost ps keeps the trap spared only under the scope's kernel limits), not counted on $PLAT"
fi
fi
if want T124; then
begin T124
    if trap_case t124 nested; then pass T124 "$R12"; else fail T124 "$R12"; show "$TMP/t124.err"; fi
fi
if want T125; then
begin T125
    if trap_case t125 spawn; then pass T125 "$R12"; else fail T125 "$R12"; show "$TMP/t125.err"; fi
fi
if want T126; then
begin T126
    if trap_case t126 long; then pass T126 "$R12"; else fail T126 "$R12"; show "$TMP/t126.err"; fi
fi
if want T127; then
if [ $PLAT = linux ]; then
    begin T127
    if trap_case t127 unmeasured; then pass T127 "$R12"; else fail T127 "$R12"; show "$TMP/t127.err"; fi
else
    skip T127 "linux-only (the stop without a measure spares the trap only under the scope's kernel limits, D7), not counted on $PLAT"
fi
fi
if want T128; then
begin T128
    if trap_case t128 int; then pass T128 "$R12"; else fail T128 "$R12"; show "$TMP/t128.err"; fi
fi

# The identity oracle is the live process, not the helper's exit status.
reuse_case() { # tooth subject occurrence
    "$LPY" - "$2" "$3" "$TMP/$1-reuse" "$BASHBIN" <<'PY'
import os, pathlib, signal, subprocess, sys
source, occurrence, work, bash = sys.argv[1:]
work = pathlib.Path(work)
work.mkdir()
text = pathlib.Path(source).read_text()
parts = text.split("kill_tree() {")[1:]
if len(parts) <= int(occurrence):
    raise RuntimeError("kill_tree subject missing")
body = "kill_tree() {" + parts[int(occurrence)].split("\nPY\n}", 1)[0] + "\nPY\n}\n"
shim = work / "ps"
shim.write_text("#!" + sys.executable + "\n" + '''import os, pathlib, sys
counter = pathlib.Path(os.environ["REUSE_COUNT"])
n = int(counter.read_text()) + 1 if counter.exists() else 1
counter.write_text(str(n))
root = int(os.environ["REUSE_ROOT"])
pid = int(os.environ["REUSE_PID"])
parent = root if n <= 2 else 1
stamp = "Mon Sep 28 00:00:00 2026" if n == 1 else "Mon Sep 28 00:00:01 2026"
cols = sys.argv[-1]
print("%d %d S%s" % (pid, parent, " " + stamp if "lstart" in cols else ""))
''')
shim.chmod(0o700)
fixture = work / "invoke.sh"
fixture.write_text(body + 'kill_tree "$1" "$2" 0.3\n')
p = subprocess.Popen(["sleep", "60"], preexec_fn=lambda: signal.signal(signal.SIGTERM, signal.SIG_IGN))
try:
    env = dict(os.environ, PATH=str(work) + os.pathsep + os.environ["PATH"],
               REUSE_ROOT=str(os.getpid()), REUSE_PID=str(p.pid), REUSE_COUNT=str(work / "calls"))
    result = subprocess.run([bash, str(fixture), sys.executable, str(os.getpid())], env=env, timeout=5)
    calls = int((work / "calls").read_text())
    survived = p.poll() is None
    print("pid-reuse subject=%s occurrence=%s reads=%s changed-start pid=%s survives=%s helper-exit=%s" %
          (source, occurrence, calls, p.pid, survived, result.returncode))
    sys.exit(0 if result.returncode == 0 and calls >= 3 and survived else 1)
finally:
    if p.poll() is None:
        p.kill()
    p.wait(timeout=5)
PY
}
if want T129; then
if [ $PLAT = linux ]; then
    begin T129
    "$LPY" - "$UT" "$LOG" >"$TMP/t129.out" 2>"$TMP/t129.err" <<'PY'
import os, subprocess, sys, time
sys.path.insert(0, sys.argv[1])
import runlimits as r
children = []
try:
    for _ in range(3):
        children.append(subprocess.Popen(["sleep", "30"]))
        time.sleep(0.4)
    env = dict(os.environ, RUNLIMITS_LOG_DIR=sys.argv[2])
    procs = r.proc_table([p.pid for p in children], env)
    ok = True
    for p in children:
        expected = r.ps_start(r.real_ps(), p.pid)
        actual = procs[p.pid][4]
        match = p.poll() is None and expected is not None and actual == expected
        print("pid=%s proc-start=%s ps-start=%s equal=%s" % (p.pid, actual, expected, match))
        ok = ok and match
    unread = dict(env, RUNLIMITS_TEST_START_UNREADABLE=str(children[0].pid))
    ok = ok and r.proc_table([children[0].pid], unread)[children[0].pid][4] is None
    sys.exit(0 if ok else 1)
finally:
    for p in children:
        if p.poll() is None:
            p.terminate()
        p.wait(timeout=5)
PY
    rc=$?; show "$TMP/t129.out"; show "$TMP/t129.err"
    if [ "$rc" = 0 ]; then pass T129 "three live starts equal ps lstart; unreadable-start knob preserved"; else fail T129 "proc start does not equal ps lstart"; fi
else skip T129 "linux-only /proc identity, not counted on $PLAT"; fi
fi
if want T130; then
if [ $PLAT = linux ]; then
    begin T130
    if trap_case t130 procstop; then pass T130 "$R12"; else fail T130 "$R12"; show "$TMP/t130.err"; fi
else skip T130 "linux-only /proc stop view, not counted on $PLAT"; fi
fi
if want T131; then
if [ $PLAT = linux ]; then
    begin T131
    if trap_case t131 procunmeasured; then pass T131 "$R12; no ps retry in E3"; else fail T131 "$R12"; show "$TMP/t131.err"; fi
else skip T131 "linux-only /proc E3, not counted on $PLAT"; fi
fi
if want T132; then
if [ $PLAT = linux ]; then
    begin T132
    "$LPY" - "$UT" "$LOG" >"$TMP/t132.out" 2>"$TMP/t132.err" <<'PY'
import os, signal, subprocess, sys, time
sys.path.insert(0, sys.argv[1])
import runlimits as r
class Deadline(Exception):
    pass
class Probe(r.Supervisor):
    def signal_unmeasured(self, signum):
        super().signal_unmeasured(signum)
        if signum == signal.SIGTERM:
            self.term_stamp = time.time()
        elif signum == signal.SIGKILL:
            self.kill_stamp = time.time()
    def cgroup_kill(self):
        # The probe and child share the enclosing scope; its kill is a witness only.
        self.scope_kill_called = True
    def scope_pids(self):
        return []
def deadline(*_):
    raise Deadline()
p = subprocess.Popen([sys.executable, "-u", "-c", "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('ready', flush=True); time.sleep(60)"], stdout=subprocess.PIPE, text=True)
try:
    assert p.stdout.readline().strip() == "ready"
    s = Probe("runner", "d7", [], dict(os.environ, RUNLIMITS_LOG_DIR=sys.argv[2], RUNLIMITS_TEST_PROC_UNREADABLE="1"))
    s.child = p
    with open("/proc/%d/cgroup" % p.pid) as f:
        s.cgroup = next(line.strip().split(":", 2)[2] for line in f if line.startswith("0::"))
    s.scope_kill_called = False
    signal.signal(signal.SIGALRM, deadline)
    signal.setitimer(signal.ITIMER_REAL, r.NESTED_STOP_S + 2)
    try:
        s.stop_unmeasured("D7: neither ps nor /proc view")
    except Deadline:
        print("D7 host still alive at upper bound; SIGKILL deadline missed", flush=True)
        sys.exit(1)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    elapsed = s.kill_stamp - s.term_stamp
    ok = r.NESTED_STOP_S <= elapsed < r.NESTED_STOP_S + 2 and p.returncode == -signal.SIGKILL and s.scope_kill_called
    print("D7 SIGKILL after %.6f s; window=[%.1f, %.1f); child rc=%s scope-kill=%s" % (elapsed, r.NESTED_STOP_S, r.NESTED_STOP_S + 2, p.returncode, s.scope_kill_called))
    sys.exit(0 if ok else 1)
finally:
    if p.poll() is None:
        p.kill()
    p.wait(timeout=5)
PY
    rc=$?; show "$TMP/t132.out"; show "$TMP/t132.err"
    if [ "$rc" = 0 ]; then pass T132 "D7 host killed inside the bounded window"; else fail T132 "D7 host SIGKILL outside [NESTED_STOP_S, NESTED_STOP_S + 2)"; fi
else skip T132 "linux-only E3 bound, not counted on $PLAT"; fi
fi
if want T133; then
    begin T133
    if reuse_case T133 "$UT/mutate.sh" 0; then pass T133 "mutation runner preserves changed-start pid"; else fail T133 "mutation runner killed changed-start pid"; fi
fi
if want T134; then
    begin T134
    if reuse_case T134 "$UT/runlimits-teeth.sh" 0; then pass T134 "teeth cleanup preserves changed-start pid"; else fail T134 "teeth cleanup killed changed-start pid"; fi
fi
if want T135; then
    begin T135
    if reuse_case T135 "$UT/runlimits-teeth.sh" 1; then pass T135 "trap fixture preserves changed-start pid"; else fail T135 "trap fixture killed changed-start pid"; fi
fi
# The stubs inject failed waits; the subject remains the extracted trap_case body.
trap_instrument_case() { # tooth mode
    local tc=$1 mode=$2
    "$LPY" - "$UT/runlimits-teeth.sh" "$TMP/$tc-subject.sh" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
body = text.split("\ntrap_case() {", 1)[1].split("\nif want T121;", 1)[0]
pathlib.Path(sys.argv[2]).write_text("trap_case() {" + body)
PY
    "$BASHBIN" -s -- "$TMP/$tc-subject.sh" "$TMP/$tc-stub" "$mode" <<'SH'
source "$1"
TMP=$2 LOG=$2/log mode=$3
mkdir -p "$LOG"
touch "$TMP/t12x.sh"
printf '3\n' >"$TMP/probe.sup"
printf '1\n' >"$TMP/probe.host"
printf '2\n' >"$TMP/probe.load"
printf '0\n' >"$TMP/probe.term"
printf '%s\n' "$TMP/absent" >"$TMP/probe.tmpd"
printf '0\n' >"$TMP/probe.kt"
printf 'done\n' >"$TMP/probe.rm"
for f in sup host load; do printf '1\n' >"$TMP/probe.$f.start"; done
G12P=6 NST=20 G12M=4 LPY=fake_python SUP=unused BASHBIN=bash UT=unused
fake_python() { :; }
env() { :; }
sublog() { :; }
save_pid() { printf '1\n' >"$1.start"; printf '%s\n' "$2" >"$1"; }
signal_saved() { :; }
kill() { :; }
kill12() { echo cleanup >>"$TMP/events"; }
wait() { echo wait >>"$TMP/events"; return 0; }
wait_file() { case "$1" in *.gc) return 1 ;; *) return 0 ;; esac; }
wait_dead() { if [ "$2" = 30 ]; then echo wait_dead >>"$TMP/events"; return 1; fi; return 0; }
pids12() { if [ -s "$1" ]; then cat "$1"; fi; }
now() { echo 5; }
secs_between() { echo 5; }
jfind() { case "$4" in exit) echo 143 ;; limit) if [ "$mode" = spawn ]; then echo parent-gone; else echo null; fi ;; signal) echo TERM ;; esac; }
trap_case probe "$mode"
rc=$?
case "$R12" in "instrument: "*|"trap window unbounded: "*) refused=y ;; *) refused=n ;; esac
if [ "$mode" = spawn ]; then
    after=n; if grep -q wait_dead "$TMP/events"; then after=y; fi
else
    after=n; if grep -qx wait "$TMP/events"; then after=y; fi
fi
printf 'mode=%s return=%s refusal=%s reached-later-wait=%s\n' "$mode" "$rc" "$refused" "$after"
[ "$rc" = 1 ] && [ "$refused" = y ] && [ "$after" = n ]
SH
}
if want T136; then
    begin T136
    if trap_instrument_case T136 term; then pass T136 "supervisor timeout reported before blocking wait: trap window unbounded"; else fail T136 "supervisor timeout swallowed or reached blocking wait"; fi
fi
if want T137; then
    begin T137
    if trap_instrument_case T137 spawn; then pass T137 "missing newborn refuses before later waits"; else fail T137 "missing newborn accepted or reached later waits"; fi
fi

if want T142; then
    begin T142
    "$LPY" - "$UT/runlimits-teeth.sh" "$TMP/t142-subject.sh" "$BASHBIN" <<'PY'
import pathlib, subprocess, sys
text = pathlib.Path(sys.argv[1]).read_text().splitlines()
bodies = []
for name in ("wait_dead", "now", "elapsed_ge", "alive"):
    i = next(i for i, line in enumerate(text) if line.startswith(name + "() {"))
    j = i if text[i].endswith("}") else next(j for j in range(i + 1, len(text)) if text[j] == "}")
    bodies.append("\n".join(text[i:j + 1]))
p = pathlib.Path(sys.argv[2])
prefix = "\n".join(bodies) + '\nLPY=$1\npstart() { echo 222; }\n'
p.write_text(prefix + 'wait_dead $$ 0 "$(now)" 111\n')
rc = subprocess.run([sys.argv[3], str(p), sys.executable], timeout=5).returncode
print("wait_dead changed-start target: exit=%s (want 0)" % rc)
p.write_text(prefix + 'wait_dead $$ 0 "$(now)" ""\n')
empty = subprocess.run([sys.argv[3], str(p), sys.executable], text=True, stderr=subprocess.PIPE, timeout=5)
print("wait_dead empty saved start: exit=%s diagnostic=%s" % (empty.returncode, empty.stderr.strip()))
ok = rc == 0 and empty.returncode == 1 and "identity unreadable" in empty.stderr
sys.exit(0 if ok else 1)
PY
    rc=$?
    if [ "$rc" = 0 ]; then pass T142 "changed-start pid is dead without spending wait budget"; else fail T142 "wait_dead spends budget on changed-start pid"; fi
fi
# The subject is extracted from the library under test, not duplicated in a stub.
trap_early_case() {
    "$LPY" - "$UT/runlimits-teeth.sh" "$TMP/t139-probe" "$BASHBIN" <<'PY'
import os, pathlib, signal, subprocess, sys, time
source, work, bash = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
work.mkdir()
text = source.read_text()
def extract(name):
    lines = text.splitlines()
    i = next(i for i, line in enumerate(lines) if line.startswith(name + "() {"))
    j = i if lines[i].endswith("}") else next(j for j in range(i + 1, len(lines)) if lines[j] == "}")
    return "\n".join(lines[i:j + 1]) + "\n"
names = ("pstart", "save_pid", "same_pid", "signal_saved", "now", "elapsed_ge", "alive", "wait_dead", "descendants", "pids12", "kill12", "trap_case")
body = "".join(extract(n) for n in names).replace("pstart() {", "real_pstart() {", 1)
fixture = work / "t139-owned.sh"
fixture.write_text(body + '''
TMP=$1 LOG=$1/log LPY=$2 BASHBIN=$3 SUP=unused UT=unused NST=20 G12P=6 G12M=4
mkdir -p "$LOG"; touch "$TMP/t12x.sh"
pstart() { [ -e "$TMP/unreadable" ] || real_pstart "$1"; }
sublog() { :; }
env() { "$LPY" -c 'import time; time.sleep(60)' t139-owned; }
wait_file() {
    case "$1" in
        *.host) printf '1\\n' >"$1"; return 0 ;;
        *.load) : >"$TMP/unreadable"; return 1 ;;
        *) [ -s "$1" ] ;;
    esac
}
trap_case probe term
rc=$?
printf 'EARLY return=%s R12=%s\\n' "$rc" "$R12"
case "$R12" in "instrument: "*) [ "$rc" = 1 ] ;; *) exit 2 ;; esac
''')
cleanup = work / "cleanup.sh"
cleanup.write_text('LPY=$1; shift\n' + ''.join(extract(n) for n in ("pstart", "same_pid", "signal_saved", "alive")) + '\ncase "$1" in start) pstart "$2" ;; signal) signal_saved KILL "$2" "$3" "$4" ;; esac\n')
def captured_start(pid):
    return subprocess.check_output([bash, str(cleanup), sys.executable, "start", str(pid)], text=True).strip()
def cleanup_saved(pid, start):
    cmd = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], text=True, stdout=subprocess.PIPE, check=False).stdout
    if "t139-owned" in cmd:
        subprocess.run([bash, str(cleanup), sys.executable, "signal", str(pid), start, str(work / "cleanup.log")], check=True, timeout=5)
out = work / "output"
with out.open("w") as stream:
    p = subprocess.Popen([bash, str(fixture), str(work), sys.executable, bash], stdout=stream, stderr=stream)
    root_start = captured_start(p.pid)
    started = time.monotonic()
    try:
        rc = p.wait(timeout=6)
        elapsed = time.monotonic() - started
        print(out.read_text(), end="")
        print("early trap_case returned in %.3f s; rc=%s" % (elapsed, rc))
        ok = rc == 0 and elapsed < 6
    except subprocess.TimeoutExpired:
        print("early trap_case reached an unbounded wait with unreadable start")
        ok = False
    finally:
        pidfile = work / "probe.sup"
        if pidfile.exists():
            startfile = pathlib.Path(str(pidfile) + ".start")
            cleanup_saved(int(pidfile.read_text()), startfile.read_text().strip() if startfile.exists() else "-")
        if p.poll() is None:
            cleanup_saved(p.pid, root_start)
        p.wait(timeout=5)
sys.exit(0 if ok else 1)
PY
}
trap_abort_sites() {
    local stage ok=0
    "$LPY" - "$UT/runlimits-teeth.sh" "$TMP/t139-abort-subject.sh" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
body = text.split("\ntrap_case() {", 1)[1].split("\nif want T121;", 1)[0]
pathlib.Path(sys.argv[2]).write_text("trap_case() {" + body)
PY
    for stage in fixture term newborn window final; do
        "$BASHBIN" -s -- "$TMP/t139-abort-subject.sh" "$TMP/t139-$stage" "$stage" <<'SH'
source "$1"
TMP=$2 LOG=$2/log stage=$3
mkdir -p "$LOG"; touch "$TMP/t12x.sh" "$TMP/probe.err" "$TMP/events"
for pair in sup:333 host:111 load:222 term:0 kt:0; do
    file=${pair%%:*}; printf '%s\n' "${pair#*:}" >"$TMP/probe.$file"; printf '1\n' >"$TMP/probe.$file.start"
done
printf '%s\n' "$TMP/absent" >"$TMP/probe.tmpd"
G12P=6 NST=20 G12M=4 LPY=fake_python SUP=unused BASHBIN=bash UT=unused
fake_python() { :; }
sublog() { :; }
save_pid() { printf '1\n' >"$1.start"; printf '%s\n' "$2" >"$1"; }
signal_saved() { echo "signal $1 $2" >>"$TMP/events"; }
kill() { echo "bare-kill $*" >>"$TMP/events"; }
kill12() { echo cleanup >>"$TMP/events"; }
wait() { [ "$1" != 333 ] || echo blocking-wait >>"$TMP/events"; return 0; }
wait_file() {
    case "$stage:$1" in fixture:*.load|term:*.term|newborn:*.gc) return 1 ;; esac
    return 0
}
wait_dead() { [ "$stage" = final ] || [ "$1" != 333 ]; }
jfind() { echo MISSING; }
pids12() { [ -s "$1" ] && cat "$1"; }
now() { echo 5; }
secs_between() { echo 5; }
mode=parent; [ "$stage" = newborn ] && mode=spawn
trap_case probe "$mode"; rc=$?
lp=$(cat "$TMP/probe.launcher")
count=$(grep -c "^signal KILL $lp$" "$TMP/events")
minimum=2; [ "$stage" = fixture ] && minimum=1
printf 'abort stage=%s return=%s launcher attempts=%s minimum=%s\n' "$stage" "$rc" "$count" "$minimum"
[ "$rc" = 1 ] && [ "$count" -ge "$minimum" ] && ! grep -q blocking-wait "$TMP/events"
SH
        [ "$?" = 0 ] || ok=1
    done
    return "$ok"
}
if want T139; then
    begin T139
    if trap_early_case && trap_abort_sites; then pass T139 "all refusal branches bounded and attempt launcher cleanup despite unreadable supervisor"; else fail T139 "early trap_case blocks, loses refusal, or skips launcher cleanup"; fi
fi
if want T141; then
if [ "$PLAT" = linux ]; then
    begin T141
    "$LPY" - "$UT" "$LOG" "$TMP/t141" <<'PY'
import json, os, pathlib, select, signal, subprocess, sys
sys.path.insert(0, sys.argv[1])
import runlimits as r
work = pathlib.Path(sys.argv[3]); work.mkdir()
shim = work / "ps-fail"
shim.write_text("#!/bin/sh\necho 't141 ps unavailable' >&2\nexit 1\n"); shim.chmod(0o700)
env = dict(os.environ, RUNLIMITS_LOG_DIR=sys.argv[2], RUNLIMITS_REGISTRY=r.registry_dir(os.environ))
load = "import json,os,time; b=bytearray(2100<<20); print(json.dumps({'pid':os.getpid(),'cgroup':open('/proc/self/cgroup').read()}),flush=True); time.sleep(60)"
p = subprocess.Popen([sys.executable, str(pathlib.Path(sys.argv[1]) / "runlimits.py"), "--wrap", "unit", "--label", "t141-unit", "--", sys.executable, "-c", load, "t141-owned"], env=env, stdout=subprocess.PIPE, text=True)
leaf = None
try:
    if not select.select([p.stdout], [], [], 30)[0]:
        raise RuntimeError("nested allocator ready deadline")
    ready = json.loads(p.stdout.readline()); leaf = ready["pid"]
    scope = pathlib.Path("/proc/self/cgroup").read_text().split("0::", 1)[1].strip()
    nested_scope = ready["cgroup"].split("0::", 1)[1].strip()
    assert nested_scope != scope and nested_scope.endswith(".scope")
    s = r.Supervisor("runner", "t141-outer", [], dict(env, RUNLIMITS_TEST_PS=str(shim)))
    s.spec = r.profile_spec("runner", s.env); s.child = p; s.cgroup = scope
    s.stop_cause = "signal"
    actual = r.proc_table([p.pid, leaf], env)
    targets = {pid: row[4] for pid, row in actual.items()}
    rss = actual[leaf][1] / 1024
    assert rss > 2048
    guard = s.stop_guard(targets)
    window = s.window_guard(targets)
    ok = guard and window and s.stop_limit is not None and s.stop_limit[1] == "mem"
    print("sibling scope runner cap=2048 unit cap=6144 leaf RSS=%.1f MiB guard=%s window=%s limit=%s" % (rss, guard, window, s.stop_limit), flush=True)
    select.select([], [], [], 2.0)
finally:
    if leaf is not None:
        try:
            cmd = pathlib.Path("/proc/%d/cmdline" % leaf).read_bytes()
            if b"t141-owned" not in cmd:
                raise RuntimeError("nested allocator cleanup cmdline mismatch")
            os.kill(leaf, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if p.poll() is None and leaf is None:
        cmd = pathlib.Path("/proc/%d/cmdline" % p.pid).read_bytes()
        if b"t141-unit" not in cmd:
            raise RuntimeError("nested supervisor cleanup cmdline mismatch")
        p.terminate()
    p.wait(timeout=30)
sys.exit(0 if ok else 1)
PY
    rc=$?
    if [ "$rc" = 0 ]; then pass T141 "proc stop guards count nested sibling-scope memory"; else fail T141 "proc stop guards miss nested sibling-scope memory"; fi
else skip T141 "linux-only /proc and sibling scope, not counted on $PLAT"; fi
fi

if want T138; then
    begin T138
    "$LPY" - "$UT/runlimits-teeth.sh" "$TMP/t138-owned" "$BASHBIN" <<'PY'
import pathlib, subprocess, sys
source, work, bash = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
work.mkdir()
lines = source.read_text().splitlines()
def extract(name):
    i = next(i for i, line in enumerate(lines) if line.startswith(name + "() {"))
    j = i if lines[i].endswith("}") else next(j for j in range(i + 1, len(lines)) if lines[j] == "}")
    return "\n".join(lines[i:j + 1]) + "\n"
names = ("pstart", "save_pid", "same_pid", "signal_saved", "now", "elapsed_ge", "alive", "wait_dead", "descendants", "bounded", "pids12", "kill12")
body = "".join(extract(n) for n in names).replace("pstart() {", "real_pstart() {", 1)
fixture = work / "invoke.sh"
fixture.write_text(body + '''
TMP=$1 LPY=$2 BGRACE=0
pstart() {
    local st; st=$(real_pstart "$1")
    if [ ! -e "$TMP/seen-$1" ]; then : >"$TMP/seen-$1"; printf '%s\\n' "$((st - 1))"
    else printf '%s\\n' "$st"; fi
}
cleanup_owned() {
    local p=$1 cmd
    if alive "$p"; then
        cmd=$(ps -o command= -p "$p") || return 1
        case "$cmd" in *t138-owned*)
            pstart() { real_pstart "$1"; }
            signal_saved KILL "$p" "$(real_pstart "$p")" "$TMP/cleanup.log" ;;
            *) return 1 ;;
        esac
    fi
    wait_dead "$p" 5 && wait "$p"
    return 0
}
bounded 0 probe "$LPY" -c 'import time; time.sleep(60)' t138-owned
bp=$BPID; bok=n
if alive "$bp" && grep -q 'not signalled' "$TMP/probe.err"; then bok=y; fi
printf 'bounded changed-start alive=%s BRC=%s\\n' "$bok" "$BRC"
cat "$TMP/probe.err"
cleanup_owned "$bp" || exit 2
pstart() {
    local st; st=$(real_pstart "$1")
    if [ ! -e "$TMP/seen-$1" ]; then : >"$TMP/seen-$1"; printf '%s\\n' "$((st - 1))"
    else printf '%s\\n' "$st"; fi
}
"$LPY" -c 'import time; time.sleep(60)' t138-owned &
kp=$!; save_pid "$TMP/fixture.sup" "$kp"
kill12 "$TMP/fixture"
kok=n; if alive "$kp" && grep -q 'not signalled' "$TMP/fixture.err"; then kok=y; fi
printf 'kill12 changed-start alive=%s\\n' "$kok"
cat "$TMP/fixture.err"
cleanup_owned "$kp" || exit 2
[ "$bok" = y ] && [ "$kok" = y ]
''')
rc = subprocess.run([bash, str(fixture), str(work), sys.executable], timeout=30).returncode
sys.exit(rc)
PY
    rc=$?
    if [ "$rc" = 0 ]; then pass T138 "bounded and kill12 preserve changed-start pid and log not signalled"; else fail T138 "bounded or kill12 signalled changed-start pid or lost refusal log"; fi
fi
if want T140; then
if [ "$PLAT" = linux ]; then
    begin T140
    "$LPY" - "$UT" "$LOG" "$TMP/t140" <<'PY'
import errno, os, pathlib, subprocess, sys, time
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, sys.argv[1]); import runlimits as r
work = pathlib.Path(sys.argv[3]); work.mkdir()
shim = work / "ps-fail"
pslog = work / "ps-calls"
shim.write_text("#!/bin/sh\necho \"$*\" >>%s\necho 't140 ps unavailable' >&2\nexit 1\n" % pslog); shim.chmod(0o700)
env = dict(os.environ, RUNLIMITS_LOG_DIR=sys.argv[2], RUNLIMITS_TEST_PS=str(shim))
result = subprocess.run(["systemd-run", "--user", "--scope", "--quiet", "-p", "MemoryMax=4G", "-p", "MemorySwapMax=0", "sh", "-c", "cat /proc/self/cgroup"], text=True, stdout=subprocess.PIPE, check=True, timeout=10)
cgroup = result.stdout.split("0::", 1)[1].strip()
scope_path = pathlib.Path("/sys/fs/cgroup" + cgroup)
deadline = time.monotonic() + 8
while scope_path.exists() and time.monotonic() < deadline:
    time.sleep(0.05)
assert not scope_path.exists(), "fixture scope not collected within 8 s"
p = subprocess.Popen(["sleep", "30"])
try:
    start = r.proc_start(p.pid, env)
    assert start is not None
    s = r.Supervisor("runner", "t140", [], env); s.cgroup = cgroup
    s.child = SimpleNamespace(pid=os.getpid())
    remembered = {p.pid: start}
    real_proc_start = r.proc_start
    calls = []
    def observed_proc_start(pid, env):
        if pid == p.pid:
            calls.append(pid)
        return real_proc_start(pid, env)
    with patch.object(r, "snapshot", side_effect=r.PsError("t140 ps unavailable")), patch.object(r.os, "scandir", side_effect=OSError(errno.EACCES, "t140 proc enumeration denied")), patch.object(r, "proc_start", side_effect=observed_proc_start):
        # the window starts here: the None branch reads start through /proc only,
        # a single-pid ps must not be consulted in it (M182)
        ps_before = len(pslog.read_text().splitlines()) if pslog.exists() else 0
        rechecked = s.recheck(remembered)
        recheck_none = s.stop_procs is None
        before = len(calls)
        left = s.leftovers(remembered)
        after = len(calls) - before
        ps_after = (len(pslog.read_text().splitlines()) if pslog.exists() else 0) - ps_before
    reason = ""
    if before < 1:
        reason = "T140 recheck: channel 1 not consulted"
    elif after < 1:
        reason = "T140 leftovers: channel 1 not consulted"
    elif ps_after != 0:
        reason = "T140: single-pid ps consulted in the None branch window: %d call(s)" % ps_after
    elif not recheck_none:
        reason = "T140 fixture did not reach the None branch"
    elif rechecked.get(p.pid) != start:
        reason = "recheck lost remembered pid"
    elif left.get(p.pid) != start:
        reason = "leftovers lost remembered pid"
    ok = not reason
    (work / "reason").write_text(reason)
    print("collected scope, None branches, /proc readable: recheck=%s leftovers=%s channel1=%s/%s ps-calls-in-window=%d" % (p.pid in rechecked, p.pid in left, before, after, ps_after))
finally:
    p.terminate(); p.wait(timeout=5)
sys.exit(0 if ok else 1)
PY
    rc=$?
    if [ "$rc" = 0 ]; then pass T140 "proc-start channel retains pid in both None branches after scope collection"; else fail T140 "$(if [ -s "$TMP/t140/reason" ]; then cat "$TMP/t140/reason"; else echo 'T140 fixture did not reach the None branch'; fi)"; fi
else skip T140 "linux-only /proc identity channel, not counted on $PLAT"; fi
fi
if want T143; then
if [ "$PLAT" = linux ]; then
    begin T143
    "$LPY" - "$UT" "$LOG" <<'PY'
import errno, os, sys
from unittest.mock import patch
sys.path.insert(0, sys.argv[1]); import runlimits as r
s = r.Supervisor("runner", "t143", [], dict(os.environ, RUNLIMITS_LOG_DIR=sys.argv[2]))
s.cgroup = "/gone"; s.scope_pids = lambda: []
with patch.object(r, "snapshot", side_effect=r.PsError("ps unavailable")), patch.object(r.os, "scandir", side_effect=OSError(errno.EACCES, "proc denied")):
    try:
        s.stop_view()
    except r.PsError as e:
        print("proc opening refusal is PsError: %s" % e); ok = True
    except OSError as e:
        print("proc opening escaped as OSError: %s" % e); ok = False
    else:
        print("proc opening failure was accepted"); ok = False
sys.exit(0 if ok else 1)
PY
    rc=$?
    if [ "$rc" = 0 ]; then pass T143 "proc opening refusal follows PsError stop path"; else fail T143 "proc opening error escapes stop-view refusal path"; fi
else skip T143 "linux-only /proc opening, not counted on $PLAT"; fi
fi

if want T144; then
if [ "$PLAT" = linux ]; then
    begin T144
    bounded 30 t144 env RUNLIMITS_HOME="$UT" "$LPY" "$SUP" --wrap runner --label t144-held -- "$BASHBIN" "$UT/runlimits-teeth.sh" --scope T141
    if [ "$BRC" = 0 ] && grep -q '^PASS T141 ' "$TMP/t144.out"; then
        pass T144 "held sibling-scope load leaves its runner alive"
    else
        fail T144 "held sibling-scope load killed its runner or lost T141 (exit $BRC)"
        show "$TMP/t144.out"; show "$TMP/t144.err"
    fi
else skip T144 "linux-only T141 sibling-scope registry witness, not counted on $PLAT"; fi
fi

if want T145; then
begin T145
trap_case t145 refuse
rc145=$?
s145=""; [ -s "$TMP/t145.err" ] && s145=$(awk -v p="RUNLIMITS: t145 refused: " 'index($0, p) == 1 { print; exit }' "$TMP/t145.err")
ok145=0; det145=""
if [ "$rc145" != 1 ]; then ok145=1; det145="real fixture returned rc=$rc145 (want 1)"
elif [ -z "$s145" ]; then ok145=1; det145="no start refusal line of the subject in the fixture output"
else
    case "$R12" in
        "subject refused at start: RUNLIMITS: t145 refused: "*) ;;
        *) ok145=1; det145="real run: start refusal of the subject lost its subject form: $s145" ;;
    esac
fi
# the form is judged through the library under test: trap_case is extracted
# from $UT so a mutation of the split is seen here (M198)
"$LPY" - "$UT/runlimits-teeth.sh" "$TMP/t145-subject.sh" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
body = text.split("\ntrap_case() {", 1)[1].split("\nif want T121;", 1)[0]
pathlib.Path(sys.argv[2]).write_text("trap_case() {" + body)
PY
    rcc=$?
    [ "$rcc" = 0 ] || { ok145=1; [ -n "$det145" ] || det145="extraction of trap_case failed (rc=$rcc)"; }
    for case145 in subject inner foreign norefusal; do
        "$BASHBIN" -s -- "$TMP/t145-subject.sh" "$TMP/t145-$case145" "$case145" <<'SH'
source "$1"
TMP=$2 LOG=$2/log refusal_case=$3
mkdir -p "$LOG"; touch "$TMP/t12x.sh"
G12P=6 NST=20 G12M=4 LPY=fake_python SUP=unused BASHBIN=bash UT=unused
fake_python() { :; }
sublog() { :; }
# the subject's refusal reaches the fixture log through the spawn's own stderr;
# trap_case's own `mode` local is term, the case rides on a separate global
env() { case $refusal_case in subject) printf 'RUNLIMITS: probe refused: cannot measure: ps exit 1 (child not started)\n' >&2 ;; inner) printf 'RUNLIMITS: proben refused: cannot measure: ps exit 1 (child not started)\n' >&2 ;; foreign) printf 'RUNLIMITS: other refused: cannot measure: ps exit 1 (child not started)\n' >&2 ;; esac; }
save_pid() { printf '1\n' >"$1.start"; printf '%s\n' "$2" >"$1"; }
signal_saved() { :; }
kill() { :; }
kill12() { :; }
wait() { return 0; }
wait_file() {
    case "$1" in
        *.host) n=0; while [ "$refusal_case" != norefusal ] && [ ! -s "$TMP/probe.err" ] && [ "$n" -lt 100 ]; do sleep 0.05; n=$((n+1)); done; return 1 ;;
        *) return 0 ;;
    esac
}
wait_dead() { return 0; }
pids12() { if [ -s "$1" ]; then cat "$1"; fi; }
now() { echo 5; }
secs_between() { echo 5; }
jfind() { echo MISSING; }
trap_case probe term
rc=$?
printf 'FORM case=%s return=%s R12=%s\n' "$refusal_case" "$rc" "$R12"
case "$refusal_case:$R12" in
    "subject:subject refused at start: "*) [ "$rc" = 1 ] ;;
    "inner:inner supervisor refused at start: "*) [ "$rc" = 1 ] ;;
    "foreign:instrument: fixture never started: "*) [ "$rc" = 1 ] ;;
    "norefusal:instrument: fixture never started: "*) [ "$rc" = 1 ] ;;
    *) exit 3 ;;
esac
SH
        rcc=$?
        [ "$rcc" = 0 ] || { ok145=1; [ -n "$det145" ] || det145="extracted body, case $case145: the refusal form took the wrong side (rc=$rcc)"; }
    done
    if [ $ok145 = 0 ]; then pass T145 "$s145; both refusal forms keep their sides under the extracted body"
    else fail T145 "$det145"; fi
fi

if want T146; then
if [ "$PLAT" = linux ]; then
    begin T146
    "$LPY" - "$UT" "$LOG" "$TMP/t146" <<'PY'
import errno, os, pathlib, subprocess, sys, time
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, sys.argv[1]); import runlimits as r
work = pathlib.Path(sys.argv[3]); work.mkdir()
shim = work / "ps-fail"
pslog = work / "ps-calls"
shim.write_text("#!/bin/sh\necho \"$*\" >>%s\necho 't146 ps unavailable' >&2\nexit 1\n" % pslog); shim.chmod(0o700)
env = dict(os.environ, RUNLIMITS_LOG_DIR=sys.argv[2], RUNLIMITS_TEST_PS=str(shim))
p = subprocess.Popen(["sleep", "30"])
try:
    start = r.proc_start(p.pid, env)
    assert start is not None
    # ps_lost=True with a failing /proc enumeration is the E3-after-a-lost-
    # measure window: recheck consults channel 1 (/proc) and never a single-pid
    # ps (M186); the remembered start is off by one so only channels can match
    s = r.Supervisor("runner", "t146", [], env)
    s.cgroup = "/gone"; s.scope_pids = lambda: []
    s.child = SimpleNamespace(pid=os.getpid()); s.ps_lost = True
    remembered = {p.pid: start + 1}
    real_proc_start = r.proc_start
    calls = []
    def observed_proc_start(pid, env):
        if pid == p.pid:
            calls.append(pid)
        return real_proc_start(pid, env)
    with patch.object(r, "snapshot", side_effect=r.PsError("t146 ps unavailable")), patch.object(r.os, "scandir", side_effect=OSError(errno.EACCES, "t146 proc enumeration denied")), patch.object(r, "proc_start", side_effect=observed_proc_start):
        ps_before = len(pslog.read_text().splitlines()) if pslog.exists() else 0
        rechecked = s.recheck(remembered)
        recheck_none = s.stop_procs is None
        ch1 = len(calls)
        ps_after = (len(pslog.read_text().splitlines()) if pslog.exists() else 0) - ps_before
    reason = ""
    if ch1 < 1:
        reason = "T146: channel 1 not consulted in the lost-measure window"
    elif ps_after != 0:
        reason = "T146: single-pid ps consulted after a lost measure: %d call(s)" % ps_after
    elif not recheck_none:
        reason = "T146 fixture did not reach the None branch"
    elif p.pid in rechecked:
        reason = "T146: an off-by-one start was adopted as remembered"
    ok = not reason
    (work / "reason").write_text(reason)
    print("lost measure, None branch, /proc readable: channel1=%d ps-calls-in-window=%d pid-kept=%s" % (ch1, ps_after, p.pid in rechecked))
finally:
    p.terminate(); p.wait(timeout=5)
sys.exit(0 if ok else 1)
PY
    rc=$?
    if [ "$rc" = 0 ]; then pass T146 "no single-pid ps after a lost measure; channel 1 /proc keeps working"; else fail T146 "$(if [ -s "$TMP/t146/reason" ]; then cat "$TMP/t146/reason"; else echo 'T146 fixture did not reach the None branch'; fi)"; fi
else skip T146 "linux-only /proc identity channel under a lost measure, not counted on $PLAT"; fi
fi

SUBFAILS=0
[ -s "$TMP/subfails" ] && SUBFAILS=$(wc -l <"$TMP/subfails" | tr -d ' ')
FAILED=$((FAILED + SUBFAILS))
echo "TEETH platform=$PLAT scope=$SCOPE_STR ran=$RAN passed=$PASSED failed=$FAILED expected=$EXPECTED subskips=$SUBSKIPS"
if [ "$RAN" -eq "$EXPECTED" ] && [ "$PASSED" -eq "$EXPECTED" ] && [ "$FAILED" -eq 0 ]; then
    echo "teeth: $PASSED/$EXPECTED"
    exit 0
fi
echo "teeth: $PASSED/$EXPECTED (failed $FAILED)"
exit 1
