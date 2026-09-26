#!/usr/bin/env bash
# test-warden teeth (bash 3.2 compatible: /bin/bash on macOS).
#
# Each tooth starts its OWN foreground warden instance with test thresholds
# (TW_INTERVAL=0.2 TW_PROC_MB=200 TW_TOTAL_MB=350 TW_AGE_S=3) and a private
# TW_LOG_DIR, runs one small self-limiting load (every load exits by itself
# after 20 s), checks the outcome and the journal, and stops the warden.
#
# Isolation from the live machine:
# - Loads are started detached, `( cmd & )`, so they are reparented to launchd.
#   This script's own name matches the `*-teeth.sh` runner form; without the
#   detach every load would inherit the test scope from this script and the
#   negative teeth (Z2, Z6) would be meaningless.
# - TW_SANDBOX_TOKEN = the unique temp-dir name. Every load is launched by an
#   absolute path inside that dir, so its argv (or its parent's argv) carries
#   the token; the warden honours the token only in test mode (TW_LOG_DIR not
#   the combat dir) and then never looks at any other process. Test thresholds
#   therefore never reach real test runs of the machine.
# - TW_FAKE_FREE_MB is pinned high for every tooth except Z8, so the real free
#   memory of the mac never fires P3 during the teeth.
#
# Env: TW_WARDEN_PY overrides the warden under test (mutate.sh uses it).
# Output: one `PASS Zn ...` / `FAIL Zn ...` line per tooth, then a summary;
# exit 0 only if every tooth passed and the count equals EXPECTED_TEETH.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
WARDEN=${TW_WARDEN_PY:-$HERE/test-warden.py}
WPY=/usr/bin/python3            # the interpreter the LaunchAgent uses
LPY=$(command -v python3)       # interpreter for python loads
NODE=$(command -v node)
EXPECTED_TEETH=15

TMP=$(mktemp -d "${TMPDIR:-/tmp}/tw-teeth.XXXXXX") || { echo "FATAL mktemp"; exit 2; }
TMP=$(cd "$TMP" && pwd -P)
TOKEN=$(basename "$TMP")
RAN=0; PASSED=0; FAILED=0
WPID=""; WLOG=""

now() { "$LPY" -c 'import time; print("%.3f" % time.time())'; }
elapsed_ge() { "$LPY" -c 'import sys; sys.exit(0 if float(sys.argv[2]) - float(sys.argv[1]) >= float(sys.argv[3]) else 1)' "$1" "$2" "$3"; }

alive() { # pid alive and not a zombie
    local s
    s=$(ps -o stat= -p "$1") || return 1
    case "$s" in Z*) return 1 ;; esac
    return 0
}

rss_mb() { local r; r=$(ps -o rss= -p "$1") || { echo 0; return; }; echo $(( ${r// /} / 1024 )); }

wait_file() { # file timeout_s
    local f=$1 t0; t0=$(now)
    while :; do
        [ -s "$f" ] && return 0
        elapsed_ge "$t0" "$(now)" "$2" && return 1
        sleep 0.05
    done
}

wait_dead() { # pid timeout_s (measured from start stamp $3 or now)
    local pid=$1 t0=${3:-$(now)}
    while :; do
        alive "$pid" || return 0
        elapsed_ge "$t0" "$(now)" "$2" && return 1
        sleep 0.05
    done
}

pass() { echo "PASS $1 $2"; PASSED=$((PASSED+1)); }
fail() { echo "FAIL $1 $2"; FAILED=$((FAILED+1)); }

spawn() { # name cmd... -> detached; top pid in $TMP/<name>.top.pid
    local name=$1; shift
    ( "$@" >"$TMP/$name.out" 2>&1 & echo $! >"$TMP/$name.top.pid" )
    wait_file "$TMP/$name.top.pid" 2
}

start_warden() { # tooth [KEY=VAL...] [-- warden-args...]
    local tooth=$1; shift
    local envs="" args=""
    while [ $# -gt 0 ]; do
        if [ "$1" = "--" ]; then shift; args="$*"; break; fi
        envs="$envs $1"; shift
    done
    WLOG="$TMP/log-$tooth"; mkdir -p "$WLOG"
    # shellcheck disable=SC2086
    env TW_INTERVAL=0.2 TW_PROC_MB=200 TW_TOTAL_MB=350 TW_AGE_S=3 \
        TW_LOG_DIR="$WLOG" TW_SANDBOX_TOKEN="$TOKEN" TW_FAKE_FREE_MB=100000 $envs \
        "$WPY" "$WARDEN" $args >"$WLOG/stdout" 2>&1 &
    WPID=$!
    local i=0
    while [ $i -lt 100 ]; do
        if [ -s "$WLOG/events.jsonl" ] && grep -q '"event": "start"' "$WLOG/events.jsonl"; then return 0; fi
        alive "$WPID" || break
        sleep 0.05; i=$((i+1))
    done
    echo "  warden did not start for $tooth; stdout/stderr:"; sed 's/^/  | /' "$WLOG/stdout"
    return 1
}

stop_warden() { # tooth -> 0 if the warden was still alive
    local ok=0
    if ! alive "$WPID"; then
        ok=1; echo "  warden died during $1; stdout/stderr:"; sed 's/^/  | /' "$WLOG/stdout"
    fi
    kill -TERM "$WPID" 2>&1
    wait "$WPID"
    return $ok
}

jhas() { # pid rule [dry] -> 0 if the journal has a matching kill line
    "$LPY" - "$WLOG/events.jsonl" "$1" "$2" "${3:-}" <<'PY'
import json, sys
path, pid, rule, dry = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
want_dry = dry == "dry"
try:
    lines = open(path).read().splitlines()
except OSError as e:
    print("  journal unreadable:", e); sys.exit(1)
for ln in lines:
    e = json.loads(ln)
    if e.get("event") == "kill" and e.get("pid") == pid and e.get("rule") == rule \
            and bool(e.get("dry_run")) == want_dry:
        sys.exit(0)
sys.exit(1)
PY
}

jkills() { # count of kill lines
    "$LPY" - "$WLOG/events.jsonl" <<'PY'
import json, sys
n = 0
for ln in open(sys.argv[1]).read().splitlines():
    if json.loads(ln).get("event") == "kill":
        n += 1
print(n)
PY
}

jfield() { # pid key -> value of key on the first kill line for pid
    "$LPY" - "$WLOG/events.jsonl" "$1" "$2" <<'PY'
import json, sys
pid, key = int(sys.argv[2]), sys.argv[3]
for ln in open(sys.argv[1]).read().splitlines():
    e = json.loads(ln)
    if e.get("event") == "kill" and e.get("pid") == pid:
        v = e.get(key)
        print(json.dumps(v) if isinstance(v, (dict, list)) else v); break
PY
}

# Kill the loads of the tooth that just ran so leftovers (a load a mutant did
# not kill) cannot leak into the next tooth's sandbox. A pid is killed only if
# its argv still carries the token (guards against pid reuse); pid files are
# removed so a later tooth never touches a recycled pid.
kill_loads() {
    local f p cmd
    for f in "$TMP"/*.pid; do
        [ -s "$f" ] || { rm -f "$f"; continue; }
        p=$(cat "$f"); rm -f "$f"
        cmd=$(ps -o command= -p "$p") || continue
        case "$cmd" in
            *"$TOKEN"*) kill -KILL "$p"; wait_dead "$p" 2 || echo "  load $p survived SIGKILL" ;;
        esac
    done
}

jcount() { # file event [key=value ...] -> number of matching journal lines
    "$LPY" - "$@" <<'PY'
import json, sys
path, event, conds = sys.argv[1], sys.argv[2], [a.split("=", 1) for a in sys.argv[3:]]
n = 0
try:
    lines = open(path).read().splitlines()
except OSError:
    lines = []
for ln in lines:
    e = json.loads(ln)
    if e.get("event") == event and all(str(e.get(k)) == v for k, v in conds):
        n += 1
print(n)
PY
}

cleanup() {
    kill_loads
    [ -n "$WPID" ] && alive "$WPID" && kill -TERM "$WPID"
    rm -rf "$TMP"
}
trap cleanup EXIT

# ---------------------------------------------------------------- loads
cat >"$TMP/alloc.mjs" <<'JS'
import { writeFileSync } from 'node:fs';
const target = Number(process.env.ALLOC_MB || '0');
if (process.env.ALLOC_PIDFILE) writeFileSync(process.env.ALLOC_PIDFILE, String(process.pid));
setTimeout(() => process.exit(0), 20000);
const bufs = [];
while (process.memoryUsage().rss < target * 1048576) bufs.push(Buffer.alloc(4 << 20, 1));
JS

cat >"$TMP/sleep.mjs" <<'JS'
setTimeout(() => process.exit(0), 20000);
JS

cat >"$TMP/alloc.py" <<'PY'
import os, resource, sys, time
target_mb, pidfile = int(sys.argv[1]), sys.argv[2]
with open(pidfile, "w") as f:
    f.write(str(os.getpid()))
base = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss  # bytes on darwin
need = max(0, target_mb * 1048576 - base)
buf = bytearray(b"\x01") * need
if os.environ.get("ALLOC_EXEC"):
    # Z9: same pid, different argv, after a window in which the warden sees the RSS
    time.sleep(0.8)
    del buf
    os.execv("/bin/sleep", ["sleep", "20"])
time.sleep(20)
PY

cat >"$TMP/fake-ps.sh" <<'SH'
#!/bin/sh
echo "fake ps failure (teeth)" >&2
exit 1
SH
chmod +x "$TMP/fake-ps.sh"

cat >"$TMP/mut-fake.py" <<'PY'
import time
time.sleep(20)
PY

cat >"$TMP/test-fake.sh" <<SH
#!/bin/bash
# args: tag mb... ; one python allocator per mb, pid in <dir>/<tag>-<i>.pid
dir=\$(cd "\$(dirname "\$0")" && pwd -P)
tag=\$1; shift
i=0
for mb in "\$@"; do
    "$LPY" "\$dir/alloc.py" "\$mb" "\$dir/\$tag-\$i.pid" &
    i=\$((i+1))
done
sleep 20 &
wait
SH

echo "teeth: warden=$WARDEN python=$WPY node=$NODE token=$TOKEN"
[ -f "$WARDEN" ] || echo "  warden file missing: $WARDEN"

# ---------------------------------------------------------------- Z1
# node --test with a 300 MB allocator -> killed within 3 s by P1.
RAN=$((RAN+1))
if start_warden Z1; then
    t0=$(now)
    spawn z1 env ALLOC_MB=300 ALLOC_PIDFILE="$TMP/z1.pid" "$NODE" --test "$TMP/alloc.mjs"
    if ! wait_file "$TMP/z1.pid" 3; then fail Z1 "allocator never started"
    else
        pid=$(cat "$TMP/z1.pid")
        if ! wait_dead "$pid" 3 "$t0"; then fail Z1 "pid $pid alive 3 s after launch (rss $(rss_mb "$pid") MB)"
        elif ! jhas "$pid" P1; then fail Z1 "pid $pid dead but no P1 kill line"
        else pass Z1 "pid $pid killed by P1 within 3 s"; fi
    fi
    stop_warden Z1 || fail Z1 "warden not alive at end"
else fail Z1 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z2
# plain node (no --test) with 300 MB -> NOT killed.
RAN=$((RAN+1))
if start_warden Z2; then
    spawn z2 env ALLOC_MB=300 ALLOC_PIDFILE="$TMP/z2.pid" "$NODE" "$TMP/alloc.mjs"
    if ! wait_file "$TMP/z2.pid" 3; then fail Z2 "allocator never started"
    else
        pid=$(cat "$TMP/z2.pid"); sleep 3
        r=$(rss_mb "$pid"); k=$(jkills)
        if ! alive "$pid"; then fail Z2 "pid $pid was killed"
        elif [ "$r" -lt 250 ]; then fail Z2 "pid $pid rss only $r MB, load did not allocate"
        elif [ "$k" != 0 ]; then fail Z2 "journal has $k kill lines"
        else pass Z2 "pid $pid alive at $r MB, 0 kill lines"; fi
    fi
    stop_warden Z2 || fail Z2 "warden not alive at end"
else fail Z2 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z3
# test-fake.sh -> python child 300 MB -> killed (scope inherited from the runner).
RAN=$((RAN+1))
if start_warden Z3; then
    t0=$(now)
    spawn z3 /bin/bash "$TMP/test-fake.sh" z3 300
    if ! wait_file "$TMP/z3-0.pid" 3; then fail Z3 "child never started"
    else
        pid=$(cat "$TMP/z3-0.pid"); top=$(cat "$TMP/z3.top.pid")
        if ! wait_dead "$pid" 3 "$t0"; then fail Z3 "child $pid alive 3 s after launch (rss $(rss_mb "$pid") MB)"
        elif ! jhas "$pid" P1; then fail Z3 "child $pid dead but no P1 kill line"
        else
            m=$(jfield "$pid" matched)
            case "$m" in
                *"\"pid\": $top,"*|*"\"pid\": $top}"*) pass Z3 "child $pid killed by P1, matched ancestor = runner $top" ;;
                *) fail Z3 "child $pid killed but matched ancestor is not runner $top: $m" ;;
            esac
        fi
    fi
    stop_warden Z3 || fail Z3 "warden not alive at end"
else fail Z3 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z4
# two scope processes (190 + 172 MB): each below P1, sum above P2 -> the bigger dies.
RAN=$((RAN+1))
if start_warden Z4; then
    t0=$(now)
    spawn z4 /bin/bash "$TMP/test-fake.sh" z4 190 172
    if ! wait_file "$TMP/z4-0.pid" 3 || ! wait_file "$TMP/z4-1.pid" 3; then fail Z4 "children never started"
    else
        big=$(cat "$TMP/z4-0.pid"); small=$(cat "$TMP/z4-1.pid")
        if ! wait_dead "$big" 4 "$t0"; then fail Z4 "big $big alive (rss $(rss_mb "$big") MB, small $(rss_mb "$small") MB)"
        else
            sleep 1.5
            if ! jhas "$big" P2; then fail Z4 "big $big dead but no P2 kill line"
            elif ! alive "$small"; then fail Z4 "small $small was killed too"
            elif [ "$(jkills)" != 1 ]; then fail Z4 "expected exactly 1 kill line, got $(jkills)"
            else pass Z4 "big $big killed by P2, small $small alive"; fi
        fi
    fi
    stop_warden Z4 || fail Z4 "warden not alive at end"
else fail Z4 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z5
# node --test sleep.mjs older than 3 s -> killed by P4.
RAN=$((RAN+1))
if start_warden Z5; then
    t0=$(now)
    spawn z5 "$NODE" --test "$TMP/sleep.mjs"
    top=$(cat "$TMP/z5.top.pid")
    if ! wait_dead "$top" 8 "$t0"; then fail Z5 "node --test $top alive 8 s after launch"
    elif ! jhas "$top" P4; then fail Z5 "node --test $top dead but no P4 kill line"
    else pass Z5 "node --test $top killed by P4"; fi
    stop_warden Z5 || fail Z5 "warden not alive at end"
else fail Z5 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z6
# python runner mut-fake.py older than 3 s, no memory -> NOT killed.
RAN=$((RAN+1))
if start_warden Z6; then
    spawn z6 "$LPY" "$TMP/mut-fake.py"
    top=$(cat "$TMP/z6.top.pid"); sleep 5
    if ! alive "$top"; then fail Z6 "runner $top was killed"
    elif [ "$(jkills)" != 0 ]; then fail Z6 "journal has $(jkills) kill lines"
    else pass Z6 "runner $top alive after 5 s, 0 kill lines"; fi
    stop_warden Z6 || fail Z6 "warden not alive at end"
else fail Z6 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z7
# --dry-run on Z1 -> process alive, journal line present.
RAN=$((RAN+1))
if start_warden Z7 -- --dry-run; then
    spawn z7 env ALLOC_MB=300 ALLOC_PIDFILE="$TMP/z7.pid" "$NODE" --test "$TMP/alloc.mjs"
    if ! wait_file "$TMP/z7.pid" 3; then fail Z7 "allocator never started"
    else
        pid=$(cat "$TMP/z7.pid"); sleep 2.5
        if ! alive "$pid"; then fail Z7 "pid $pid was killed in dry-run"
        elif ! jhas "$pid" P1 dry; then fail Z7 "pid $pid alive but no dry-run P1 line"
        else pass Z7 "pid $pid alive, dry-run P1 line present"; fi
    fi
    stop_warden Z7 || fail Z7 "warden not alive at end"
else fail Z7 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z8
# free memory below TW_FREE_MB (faked 100 MB < 1536 MB) with a non-empty scope
# -> the largest scope process (the 60 MB child) is killed by P3.
RAN=$((RAN+1))
if start_warden Z8 TW_FAKE_FREE_MB=100; then
    t0=$(now)
    spawn z8 /bin/bash "$TMP/test-fake.sh" z8 60
    if ! wait_file "$TMP/z8-0.pid" 3; then fail Z8 "child never started"
    else
        pid=$(cat "$TMP/z8-0.pid")
        if ! wait_dead "$pid" 3 "$t0"; then fail Z8 "child $pid alive 3 s after launch"
        elif ! jhas "$pid" P3; then fail Z8 "child $pid dead but no P3 kill line"
        else pass Z8 "child $pid killed by P3"; fi
    fi
    stop_warden Z8 || fail Z8 "warden not alive at end"
else fail Z8 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z9
# pid re-used between snapshot and kill: the 300 MB child re-execs itself as
# `sleep 20` (same pid, other argv) while the warden holds TW_TEST_KILL_DELAY_S
# between its snapshot and the pre-kill recheck -> no kill, skip line names why.
RAN=$((RAN+1))
if start_warden Z9 TW_TEST_KILL_DELAY_S=1.5; then
    spawn z9 env ALLOC_EXEC=1 /bin/bash "$TMP/test-fake.sh" z9 300
    if ! wait_file "$TMP/z9-0.pid" 3; then fail Z9 "child never started"
    else
        pid=$(cat "$TMP/z9-0.pid"); sleep 3.5
        cmd=$(ps -o command= -p "$pid")
        sk=$(jcount "$WLOG/events.jsonl" skip pid="$pid" "why=pid reused or argv changed")
        kl=$(jcount "$WLOG/events.jsonl" kill pid="$pid")
        if ! alive "$pid"; then fail Z9 "pid $pid was killed"
        else
            case "$cmd" in
                sleep*)
                    if [ "$sk" -lt 1 ]; then fail Z9 "pid $pid re-exec'd but no skip line naming the argv change"
                    elif [ "$kl" != 0 ]; then fail Z9 "$kl kill lines for $pid"
                    else pass Z9 "pid $pid re-exec'd as '$cmd' before the kill: not killed, skip line present"; fi ;;
                *) fail Z9 "pid $pid did not re-exec (argv: $cmd)" ;;
            esac
        fi
    fi
    stop_warden Z9 || fail Z9 "warden not alive at end"
else fail Z9 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z10
# ps fails (TW_TEST_PS -> a script that exits 1): no kill in the tick, one
# error line for the snapshot within the 60 s repeat window, warden alive.
RAN=$((RAN+1))
if start_warden Z10 TW_TEST_PS="$TMP/fake-ps.sh"; then
    spawn z10 /bin/bash "$TMP/test-fake.sh" z10 300
    if ! wait_file "$TMP/z10-0.pid" 3; then fail Z10 "child never started"
    else
        pid=$(cat "$TMP/z10-0.pid"); sleep 3
        er=$(jcount "$WLOG/events.jsonl" error where=snapshot)
        kl=$(jcount "$WLOG/events.jsonl" kill)
        if ! alive "$pid"; then fail Z10 "child $pid was killed while ps was failing"
        elif [ "$kl" != 0 ]; then fail Z10 "$kl kill lines while ps was failing"
        elif [ "$er" != 1 ]; then fail Z10 "expected exactly 1 snapshot error line in 3 s, got $er"
        else pass Z10 "ps failing: child $pid alive, 0 kill lines, 1 snapshot error line in ~15 ticks"; fi
    fi
    stop_warden Z10 || fail Z10 "warden not alive at end"
else fail Z10 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z11, Z12
# kill fails (TW_TEST_KILL_ERRNO=EPERM / ESRCH) -> error line naming the errno,
# no kill line, warden alive, one line per pid within the repeat window.
kill_err_tooth() { # tooth errno
    local tooth=$1 en=$2 pid er kl
    RAN=$((RAN+1))
    if start_warden "$tooth" TW_TEST_KILL_ERRNO="$en"; then
        spawn "$tooth-load" env ALLOC_MB=300 ALLOC_PIDFILE="$TMP/$tooth.pid" "$NODE" --test "$TMP/alloc.mjs"
        if ! wait_file "$TMP/$tooth.pid" 3; then fail "$tooth" "allocator never started"
        else
            pid=$(cat "$TMP/$tooth.pid"); sleep 2
            er=$(jcount "$WLOG/events.jsonl" error where=kill pid="$pid" errno="$en")
            kl=$(jcount "$WLOG/events.jsonl" kill pid="$pid")
            if ! alive "$pid"; then fail "$tooth" "pid $pid died although kill was failing"
            elif [ "$kl" != 0 ]; then fail "$tooth" "$kl kill lines for $pid"
            elif [ "$er" != 1 ]; then fail "$tooth" "expected exactly 1 kill error line ($en) for $pid, got $er"
            else pass "$tooth" "kill -> $en: error line for $pid, no kill line"; fi
        fi
        stop_warden "$tooth" || fail "$tooth" "warden not alive at end"
    else fail "$tooth" "warden start"; fi
    kill_loads
}
kill_err_tooth Z11 EPERM
kill_err_tooth Z12 ESRCH

# ---------------------------------------------------------------- Z13
# rotation: TW_TEST_ROTATE_BYTES=1000, four start/stop cycles into one log dir
# -> events.jsonl.1 exists (one old copy, no .2), events.jsonl continues.
RAN=$((RAN+1))
WLOG="$TMP/log-Z13"; mkdir -p "$WLOG"; rc13=0
for i in 1 2 3 4; do
    env TW_LOG_DIR="$WLOG" TW_SANDBOX_TOKEN="$TOKEN" TW_FAKE_FREE_MB=100000 TW_TEST_ROTATE_BYTES=1000 \
        "$WPY" "$WARDEN" --dry-run --once >>"$WLOG/stdout" 2>&1 || rc13=$?
done
msg=$("$LPY" - "$WLOG" <<'PY'
import json, os, sys
d = sys.argv[1]
cur, old, older = (os.path.join(d, n) for n in ("events.jsonl", "events.jsonl.1", "events.jsonl.2"))
if not os.path.exists(old):
    print("no events.jsonl.1"); sys.exit(1)
if os.path.exists(older):
    print("events.jsonl.2 exists"); sys.exit(1)
if not os.path.exists(cur):
    print("no events.jsonl after rotation"); sys.exit(1)
a = [json.loads(l) for l in open(old).read().splitlines()]
b = [json.loads(l) for l in open(cur).read().splitlines()]
if not b or b[-1]["event"] != "stop":
    print("current journal does not end with the last stop line"); sys.exit(1)
starts = [e for e in a + b if e["event"] == "start"]
if not starts or starts[-1]["pid"] != b[-1]["pid"]:
    print("last stop is not the stop of the last start (journal did not continue)"); sys.exit(1)
if os.path.getsize(old) <= 1000:
    print(".1 is %d bytes, not over the threshold" % os.path.getsize(old)); sys.exit(1)
print("rotated: .1 %d B (%d lines), current %d B (%d lines)" % (os.path.getsize(old), len(a), os.path.getsize(cur), len(b)))
PY
)
st=$?
if [ $rc13 -ne 0 ]; then fail Z13 "a --once run exited $rc13"; sed 's/^/  | /' "$WLOG/stdout"
elif [ $st -ne 0 ]; then fail Z13 "$msg"
else pass Z13 "$msg"; fi

# ---------------------------------------------------------------- Z14
# heartbeat: TW_TEST_HEARTBEAT_S=1.0 with TW_INTERVAL=0.1 over a 3 s window ->
# state.json rewritten 2..5 times while >= 10 ticks ran and beat/ticks <= 0.5,
# i.e. on the heartbeat interval, not per tick (a per-tick writer gives ~1.0),
# and it carries the scope. Judged by the ratio: tick cost varies with load.
RAN=$((RAN+1))
if start_warden Z14 TW_INTERVAL=0.1 TW_TEST_HEARTBEAT_S=1.0; then
    spawn z14 /bin/bash "$TMP/test-fake.sh" z14 60
    if ! wait_file "$TMP/z14-0.pid" 3; then fail Z14 "child never started"
    else
        sleep 1
        msg=$("$LPY" - "$WLOG/state.json" <<'PY'
import json, sys, time
p = sys.argv[1]
try:
    s1 = json.load(open(p))
    time.sleep(3.0)
    s2 = json.load(open(p))
except (OSError, ValueError) as e:
    print("state.json unreadable: %s" % e); sys.exit(1)
b1, b2, t1, t2 = s1.get("beat"), s2.get("beat"), s1.get("ticks"), s2.get("ticks")
if not all(isinstance(v, int) for v in (b1, b2, t1, t2)):
    print("no beat/ticks counters: beat %r %r ticks %r %r" % (b1, b2, t1, t2)); sys.exit(1)
db, dt = b2 - b1, t2 - t1
what = "beat %d, ticks %d in 3 s (beat/ticks %.2f)" % (db, dt, db / float(dt) if dt else float("inf"))
if db < 2:
    print("state.json not rewritten on the interval: " + what); sys.exit(1)
if dt < 10:
    print("too few ticks to judge: " + what); sys.exit(1)
if db > 5 or db > 0.5 * dt:
    print("state.json rewritten per tick, not per heartbeat: " + what); sys.exit(1)
if s2.get("scope_count", 0) < 2 or s2.get("scope_rss_mb", 0) < 60:
    print("scope not carried: count %r sum %r" % (s2.get("scope_count"), s2.get("scope_rss_mb"))); sys.exit(1)
print(what + ", scope_count %d, scope_rss_mb %s" % (s2["scope_count"], s2["scope_rss_mb"]))
PY
)
        if [ $? -ne 0 ]; then fail Z14 "$msg"; else pass Z14 "$msg"; fi
    fi
    stop_warden Z14 || fail Z14 "warden not alive at end"
else fail Z14 "warden start"; fi
kill_loads

# ---------------------------------------------------------------- Z15
# combat mode (no TW_LOG_DIR; HOME points into the temp dir so the combat dir
# is a private copy): every test knob is ignored and listed in ignored_env,
# defaults are the brief's (P2 = 16384), a failing TW_TEST_PS / TW_FAKE_FREE_MB=1
# leave no trace. Dry-run --once: reads the live ps, never kills.
RAN=$((RAN+1))
H="$TMP/home"; mkdir -p "$H"
env HOME="$H" TW_FAKE_FREE_MB=1 TW_SANDBOX_TOKEN="$TOKEN" TW_TEST_PS="$TMP/fake-ps.sh" \
    TW_TEST_KILL_DELAY_S=1 TW_TEST_KILL_ERRNO=EPERM TW_TEST_ROTATE_BYTES=10 TW_TEST_HEARTBEAT_S=0.1 \
    "$WPY" "$WARDEN" --dry-run --once >"$TMP/z15.out" 2>&1
rc15=$?
msg=$("$LPY" - "$H/Library/Logs/test-warden" <<'PY'
import json, os, sys
d = sys.argv[1]
p = os.path.join(d, "events.jsonl")
if os.path.exists(p + ".1"):
    print("journal rotated: TW_TEST_ROTATE_BYTES honoured in combat mode"); sys.exit(1)
try:
    ev = [json.loads(l) for l in open(p).read().splitlines()]
except OSError as e:
    print("combat journal missing: %s" % e); sys.exit(1)
c = [e for e in ev if e["event"] == "start"][0]["config"]
knobs = {"TW_FAKE_FREE_MB", "TW_SANDBOX_TOKEN", "TW_TEST_PS", "TW_TEST_KILL_DELAY_S",
         "TW_TEST_KILL_ERRNO", "TW_TEST_ROTATE_BYTES", "TW_TEST_HEARTBEAT_S"}
want = {"test_mode": False, "fake_free_mb": None, "sandbox": None, "ps_bin": "/bin/ps",
        "kill_delay_s": 0.0, "kill_errno": None, "rotate_bytes": 5242880, "heartbeat_s": 600.0,
        "proc_mb": 4096.0, "total_mb": 16384.0, "free_mb": 1536.0, "age_s": 1200.0, "interval": 1.0}
bad = ["%s=%r (want %r)" % (k, c.get(k), v) for k, v in sorted(want.items()) if c.get(k) != v]
if set(c.get("ignored_env") or []) != knobs:
    bad.append("ignored_env=%r" % sorted(c.get("ignored_env") or []))
errs = [e for e in ev if e["event"] == "error"]
p3 = [e for e in ev if e.get("rule") == "P3"]
if errs:
    bad.append("%d error lines (TW_TEST_PS honoured?)" % len(errs))
if p3:
    bad.append("%d P3 lines (TW_FAKE_FREE_MB honoured?)" % len(p3))
if bad:
    print("; ".join(bad)); sys.exit(1)
print("combat mode: 7 knobs ignored and listed, defaults 4096/16384/1536/1200/1.0")
PY
)
st=$?
if [ $rc15 -ne 0 ]; then fail Z15 "warden exited $rc15"; sed 's/^/  | /' "$TMP/z15.out"
elif [ $st -ne 0 ]; then fail Z15 "$msg"
else pass Z15 "$msg"; fi

echo "TEETH ran=$RAN passed=$PASSED failed=$FAILED expected=$EXPECTED_TEETH"
if [ "$RAN" -eq "$EXPECTED_TEETH" ] && [ "$PASSED" -eq "$EXPECTED_TEETH" ] && [ "$FAILED" -eq 0 ]; then
    exit 0
fi
exit 1
