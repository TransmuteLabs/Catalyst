#!/usr/bin/env python3
"""Run limits built into the process: supervisor (--wrap), prologue entry
(enter), limited children (run_child, pool). Rules, codes and the prologue
canon: NOTES.md next to this file. Python 3.9+, stdlib only."""
import concurrent.futures
import errno
import fcntl
import json
import os
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time

# The profile table. Numbers change only here; T12 pins the digest.
PROFILES = {
    "unit": {"mem_mb": 6144, "runtime_s": 900, "max_parallel": {"linux": 4, "darwin": 1}},
    "mutation": {"mem_mb": 6144, "runtime_s": 180, "max_parallel": {"linux": 4, "darwin": 1}},
    "model-session": {"mem_mb": 3072, "runtime_s": 1800, "max_parallel": {"linux": 8, "darwin": 4}},
    "runner": {"mem_mb": 2048, "runtime_s": 7200, "max_parallel": None},
    "pipeline": {"mem_mb": {"darwin": 12288, "linux": 16384}, "runtime_s": 5400, "max_parallel": None},
}
# Exists only in test mode (RUNLIMITS_LOG_DIR set and not the combat dir).
TEETH_PROFILE = {"mem_mb": 150, "runtime_s": 3, "max_parallel": {"linux": 2, "darwin": 1}}

EXIT_MEM = 86
EXIT_TIME = 87
EXIT_UNAVAILABLE = 88
EXIT_NO_LIBRARY = 89

TICK_S = 0.5
GRACE_S = 5.0
KERNEL_RUNTIME_MARGIN_S = 30
CONFIRM_TIMEOUT_S = 15.0
UNIT_SETTLE_S = 5.0
# one ps read must not hold the watchdog longer than this (a hung ps is a lost measure, T60)
PS_TIMEOUT_S = 5
# darwin: how often the env scan (RUNLIMITS_TREE tokens) runs, in ticks (A15)
ENV_SCAN_TICKS = 10
# registry walk: at most this many symlinks on the chain (A6)
REGISTRY_MAX_LINKS = 40
# a nested supervisor's full stop: escalation + sweep of survivors + scope state, and a margin
NESTED_STOP_S = 2 * GRACE_S + UNIT_SETTLE_S + 5
# a stop by memory keeps its SIGTERM window unless the tree grows past this share of its size at the stop's start
WINDOW_GROWTH = 1.10
ROTATE_BYTES = 5 << 20
MAX_DEPTH = 16
COMBAT_LOG_DIR = "~/.local/state/run-limits"
SELF = os.path.abspath(__file__)

# scope unit / mark dir (in the registry) of a supervisor: runlimits-<pid>-s<start time of pid>
LEFTOVER_RE = re.compile(r"^runlimits-(\d+)-s(\d+)(?:\.scope$|-)")


class RegistryError(Exception):
    pass


def my_uid(env):
    """The uid the registry and mark ownership checks compare against; RUNLIMITS_TEST_UID
    replaces it in test mode, so own dirs and marks can be made to look foreign (T51, T52)."""
    k = knob(env, "RUNLIMITS_TEST_UID")
    try:
        return int(k) if k else os.getuid()
    except ValueError:
        return os.getuid()


def registry_walk(path, uid):
    """Component-wise realpath: every symlink met on the way (first, intermediate,
    nested) must be root's or uid's; at most REGISTRY_MAX_LINKS links. Returns
    (resolved, None, None) or (None, why, where) with where naming the offending
    link for the refusal."""
    links = 0
    resolved = "/"
    stack = [c for c in path.split("/") if c not in ("", ".")]
    while stack:
        comp = stack.pop(0)
        if comp == "..":
            # resolved holds no symlinks, so the lexical parent is the real one
            resolved = os.path.dirname(resolved) or "/"
            continue
        step = os.path.join(resolved, comp)
        try:
            st = os.lstat(step)
        except OSError as e:
            return None, e.strerror or str(e), None
        if stat.S_ISLNK(st.st_mode):
            if st.st_uid not in (0, uid):
                return None, "a symlink owned by uid %d, not 0 and not %d" % (st.st_uid, uid), step
            links += 1
            if links > REGISTRY_MAX_LINKS:
                return None, "too many symlinks", step
            try:
                tgt = os.readlink(step)
            except OSError as e:
                return None, e.strerror or str(e), None
            tcomps = [c for c in tgt.split("/") if c not in ("", ".")]
            if tgt.startswith("/"):
                resolved = "/"
            elif not tcomps:
                continue
            # the target's components re-enter the walk: each gets its own lstat
            stack = tcomps + stack
            continue
        resolved = step
    return resolved, None, None


def registry_dir(env):
    """Dir of the supervisors' marks: RUNLIMITS_REGISTRY when set, else the temp dir.
    One rule for both: absolute, existing, a directory, owned by this uid or root,
    and sticky whenever it is writable by group or others; every symlink on the
    chain must be root's or this uid's, the resolved dir is returned and exported.
    RegistryError when unfit; the default is checked, never returned unverified."""
    # a mark is read by processes whose TMPDIR may differ from its publisher's (T36): one dir
    # named in the environment, never each reader's own gettempdir()
    path = env.get("RUNLIMITS_REGISTRY")
    default = path is None
    if default:
        path = tempfile.gettempdir()
    why = where = None
    if not os.path.isabs(path):
        why = "not an absolute path"
    else:
        # darwin's own /tmp is root's link to /private/tmp; a link another uid planted in
        # a shared dir is never followed - at any depth of the chain (T64)
        resolved, why, where = registry_walk(path, my_uid(env))
        if why is None:
            st = os.lstat(resolved)
            if not stat.S_ISDIR(st.st_mode):
                why = "not a directory"
            elif st.st_uid not in (0, my_uid(env)):
                if st.st_mode & stat.S_ISVTX:
                    # a shared registry only root may hand out (A5)
                    why = "owned by uid %d, not %d and not root: a shared registry must be root's" % (st.st_uid, my_uid(env))
                else:
                    why = "owned by uid %d, not %d and not sticky" % (st.st_uid, my_uid(env))
            elif (st.st_mode & (stat.S_IWGRP | stat.S_IWOTH)) and not (st.st_mode & stat.S_ISVTX):
                why = "writable by group or others and not sticky"
    if why:
        raise RegistryError("RUNLIMITS_REGISTRY %s%s: %s" % (where or path, " (from gettempdir())" if default else "", why))
    return resolved


class PsError(Exception):
    pass


# ------------------------------------------------------------------ modes

def platform():
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform.startswith("linux"):
        return "linux"
    return None


def log_dir(env):
    return env.get("RUNLIMITS_LOG_DIR") or os.path.expanduser(COMBAT_LOG_DIR)


_TEST_MODE = {}


def test_mode(env):
    d = env.get("RUNLIMITS_LOG_DIR")
    if not d or os.path.realpath(d) == os.path.realpath(os.path.expanduser(COMBAT_LOG_DIR)):
        return False
    key = (os.getpid(), d)
    if key not in _TEST_MODE:
        _TEST_MODE[key] = test_marker_live(d)
    return _TEST_MODE[key]


def test_marker_live(d):
    """The marker `.runlimits-test` in d arms test mode only while its runner lives:
    a regular file of this uid holding `<pid> <start>` of the process that wrote it,
    that pid alive with that start (E6, T96)."""
    # a non-combat dir alone is not enough: it must carry our own marker file, so a
    # stray RUNLIMITS_LOG_DIR cannot silently arm the test knobs and the teeth profile (T74)
    try:
        st = os.lstat(os.path.join(d, ".runlimits-test"))
        if not (stat.S_ISREG(st.st_mode) and st.st_uid == os.getuid()):
            return False
        with open(os.path.join(d, ".runlimits-test")) as f:
            owner = f.read().split()
    except OSError:
        return False
    if len(owner) != 2 or not (owner[0].isdigit() and owner[1].isdigit()):
        return False
    # read with the real ps, never through knob(): test_mode is what knob() asks
    return ps_start(real_ps(), int(owner[0])) == int(owner[1])


def knob(env, name):
    """Test knobs are honoured only in test mode."""
    return env.get(name) if test_mode(env) else None


def profile_spec(name, env=None):
    env = os.environ if env is None else env
    if name in PROFILES:
        spec = PROFILES[name]
    elif name == "teeth" and test_mode(env):
        spec = TEETH_PROFILE
    else:
        raise ValueError("unknown profile %s" % name)
    plat = platform()
    if plat is None:
        raise ValueError("unsupported platform %s" % sys.platform)
    mem = spec["mem_mb"]
    mp = spec["max_parallel"]
    return {
        "name": name,
        "mem_mb": mem[plat] if isinstance(mem, dict) else mem,
        "runtime_s": spec["runtime_s"],
        "max_parallel": mp[plat] if mp else None,
    }


# ------------------------------------------------------------------ public API

def max_parallel(profile):
    spec = profile_spec(profile)
    if spec["max_parallel"] is None:
        raise ValueError("profile %s is not a leaf profile: no max_parallel" % profile)
    return spec["max_parallel"]


def pool(profile):
    return concurrent.futures.ThreadPoolExecutor(max_workers=max_parallel(profile))


def run_child(argv, profile, label=None, **popen_kw):
    """One child under a NEW supervisor with its own limits; returns CompletedProcess."""
    argv = [str(a) for a in argv]
    cmd = [sys.executable, SELF, "--wrap", profile, "--label", label or os.path.basename(argv[0]), "--"] + argv
    return subprocess.run(cmd, **popen_kw)


def enter(profile):
    """Prologue entry: no-op inside a live supervisor, else re-exec under one."""
    label = sys.argv[0] if sys.argv and sys.argv[0] else sys.executable
    try:
        profile_spec(profile)
    except ValueError as e:
        refuse_line(label, str(e))
        sys.exit(EXIT_UNAVAILABLE)
    if is_active(profile=profile):
        return
    orig = getattr(sys, "orig_argv", None)  # 3.10+: keeps -m/-c/-u and interpreter flags
    rest = list(orig[1:]) if orig else list(sys.argv)
    sys.stdout.flush()
    sys.stderr.flush()
    os.execv(sys.executable, [sys.executable, SELF, "--wrap", profile, "--label", label, "--",
                              sys.executable] + rest)


def is_active(env=None, profile=None):
    """The marker counts only if its pid is an ANCESTOR, that ancestor published a
    supervisor's mark (published_supervisors) and - when a profile is asked for -
    the active envelope covers it: the active profile is no looser on any axis
    (its mem_mb and its runtime_s both <= the request's). A request tighter on
    either axis wraps its own supervisor; an unknown active profile is not active
    (T72, T73, T88, T89). argv proves nothing."""
    env = os.environ if env is None else env
    pid_s, _, act_prof = env.get("RUNLIMITS_ACTIVE", "").partition(":")
    if not pid_s.isdigit():
        return False
    pid = int(pid_s)
    try:
        procs = snapshot(env)
    except PsError:
        return False
    chain = ancestors(procs, os.getppid())
    if pid not in chain:
        return False
    try:
        registry = registry_dir(env)
    except RegistryError:
        return False
    if pid not in published_supervisors([pid], registry, my_uid(env), procs):
        return False
    if profile is not None:
        try:
            want = profile_spec(profile, env)
            act = profile_spec(act_prof, env)
        except ValueError:
            return False
        if want["mem_mb"] < act["mem_mb"] or want["runtime_s"] < act["runtime_s"]:
            return False
    return True


# ------------------------------------------------------------------ processes

def ps_path(env):
    k = knob(env, "RUNLIMITS_TEST_PS")
    if k:
        return k
    return real_ps()


def real_ps():
    for p in ("/bin/ps", "/usr/bin/ps"):
        if os.path.exists(p):
            return p
    return "ps"


# struct rusage_info_v2 (<sys/resource.h>): ri_uuid[16], then these uint64 fields in order
RUSAGE_INFO_V2 = 2
RUSAGE_INFO_V2_FIELDS = (
    "ri_user_time", "ri_system_time", "ri_pkg_idle_wkups", "ri_interrupt_wkups", "ri_pageins",
    "ri_wired_size", "ri_resident_size", "ri_phys_footprint", "ri_proc_start_abstime",
    "ri_proc_exit_abstime", "ri_child_user_time", "ri_child_system_time", "ri_child_pkg_idle_wkups",
    "ri_child_interrupt_wkups", "ri_child_pageins", "ri_child_elapsed_abstime",
    "ri_diskio_bytesread", "ri_diskio_byteswritten")
_FOOTPRINT = []


class FootprintError(Exception):
    pass


def footprint_fault(pid, env):
    """Test mode only: RUNLIMITS_TEST_FOOTPRINT_FAULT=<ESRCH|EPERM|raise>:<file> makes
    phys_footprint fail that way for the pid written in file (T112-T114); else None."""
    k = knob(env, "RUNLIMITS_TEST_FOOTPRINT_FAULT") if env is not None else None
    if not k:
        return None
    mode, _, path = k.partition(":")
    try:
        with open(path) as f:
            target = int(f.read().strip())
    except (OSError, ValueError):
        return None
    return mode if target == pid else None


def phys_footprint(pid, env=None):
    """darwin: (phys_footprint of pid in bytes, 0) via proc_pid_rusage(pid,
    RUSAGE_INFO_V2), or (None, errno) when the call fails for that pid.
    phys_footprint holds the pages in the compressor and in swap, which the rss
    column of ps does not (R1). FootprintError when libproc or the symbol cannot
    be loaded, or the call itself raises (R10)."""
    fault = footprint_fault(pid, env)
    if fault in ("ESRCH", "EPERM"):
        return None, getattr(errno, fault)
    if not _FOOTPRINT:
        try:
            import ctypes

            class RusageInfoV2(ctypes.Structure):
                _fields_ = [("ri_uuid", ctypes.c_uint8 * 16)] + [(n, ctypes.c_uint64) for n in RUSAGE_INFO_V2_FIELDS]
            fn = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True).proc_pid_rusage
        except (ImportError, OSError, AttributeError) as e:
            raise FootprintError("libproc proc_pid_rusage not loadable: %s" % e)
        fn.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        fn.restype = ctypes.c_int
        _FOOTPRINT.append((ctypes, RusageInfoV2, fn))
    ctypes, cls, fn = _FOOTPRINT[0]
    buf = cls()
    # the test fault "raise" hands the real call an argument ctypes refuses: the call itself raises (T114)
    arg = "fault" if fault == "raise" else pid
    try:
        rc = fn(arg, RUSAGE_INFO_V2, ctypes.byref(buf))
    except Exception as call_error:
        raise FootprintError("proc_pid_rusage(%d) raised: %s: %s" % (pid, type(call_error).__name__, call_error))
    if rc != 0:
        return None, ctypes.get_errno()
    return buf.ri_phys_footprint, 0


def footprint_unavailable(env):
    """darwin, before the child starts: why phys_footprint of this very process
    cannot be read, or None (R1, T101)."""
    if knob(env, "RUNLIMITS_TEST_FOOTPRINT") == "unavailable":
        return "made unavailable by the test knob RUNLIMITS_TEST_FOOTPRINT"
    try:
        fp, err = phys_footprint(os.getpid(), env)
    except FootprintError as e:
        return str(e)
    if fp is None:
        return "proc_pid_rusage(%d) failed: errno %d" % (os.getpid(), err)
    return None


def snapshot(env):
    """{pid: (ppid, rss_kb, command, pgid, start, state)}; start is the lstart epoch
    second, state the ps stat column; PsError when ps cannot be read."""
    try:
        r = subprocess.run([ps_path(env), "-axo", "pid=,ppid=,pgid=,rss=,stat=,lstart=,command="],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
                           timeout=PS_TIMEOUT_S, env=dict(os.environ, LC_ALL="C"))
    except (OSError, subprocess.SubprocessError) as e:
        raise PsError("ps not runnable: %s" % e)
    if r.returncode != 0:
        raise PsError("ps exit %d: %s" % (r.returncode, r.stderr.strip()[:200]))
    procs = {}
    for ln in r.stdout.splitlines():
        # pid ppid pgid rss stat + lstart (5 tokens) + command (rest)
        parts = ln.split(None, 10)
        if len(parts) < 10:
            continue
        try:
            procs[int(parts[0])] = (int(parts[1]), int(parts[3]), parts[10] if len(parts) > 10 else "",
                                    int(parts[2]), lstart_epoch(" ".join(parts[5:10])), parts[4])
        except ValueError:
            continue
    if not procs:
        raise PsError("ps printed no processes")
    return procs


def proc_table(pids, env):
    """The scope's /proc view in snapshot units; no process is started to read it."""
    if knob(env, "RUNLIMITS_TEST_PROC_UNREADABLE") == "1":
        raise PsError("/proc made unavailable by RUNLIMITS_TEST_PROC_UNREADABLE")
    try:
        with open("/proc/stat") as f:
            btime = next(int(line.split()[1]) for line in f if line.startswith("btime "))
    except (OSError, ValueError, StopIteration) as e:
        raise PsError("/proc/stat btime unreadable: %s" % e)
    hz = os.sysconf("SC_CLK_TCK")
    page_kb = os.sysconf("SC_PAGE_SIZE") // 1024
    unreadable = knob(env, "RUNLIMITS_TEST_START_UNREADABLE")
    procs = {}
    for pid in pids:
        try:
            with open("/proc/%d/stat" % pid) as f:
                fields = f.read().rsplit(")", 1)[1].split()
            start = btime + int(fields[19]) // hz
            ppid, pgid, rss = int(fields[1]), int(fields[2]), int(fields[21]) * page_kb
        except (OSError, ValueError, IndexError):
            continue
        try:
            with open("/proc/%d/cmdline" % pid, "rb") as f:
                command = f.read().replace(b"\0", b" ").decode("utf-8", "replace").strip()
        except OSError:
            command = ""
        procs[pid] = (ppid, rss, command, pgid, None if unreadable == str(pid) else start, fields[0])
    if not procs:
        raise PsError("/proc yielded no processes")
    return procs


def ancestors(procs, start):
    chain, cur = [], start
    while cur in procs and cur > 1 and cur not in chain:
        chain.append(cur)
        cur = procs[cur][0]
    return chain


def tree(procs, root, skip=()):
    """root and its descendants by ppid; subtrees rooted at a pid in skip (the
    nested supervisors, known by their mark: they live in their own budget) are
    left out."""
    kids = {}
    for pid, rec in procs.items():
        kids.setdefault(rec[0], []).append(pid)
    out, todo = [], [root]
    while todo:
        pid = todo.pop()
        if pid not in procs or pid in out:
            continue
        if pid in skip:
            continue
        out.append(pid)
        todo.extend(kids.get(pid, ()))
    return out


def tick_pids(procs, child, last_tree, sups):
    """The pids whose RSS makes one tick's sum, each at most once: the child's tree
    plus the trees of remembered pids still alive with their start (reparented
    descendants, env-scan finds). Subtrees of believed nested supervisors (sups)
    stay out of both parts (A1, T9b, E1, T90)."""
    nested_all = set()
    for sup in sups:
        nested_all.update(tree(procs, sup))
    counted = tree(procs, child, sups)
    seen = set(counted)
    for pid, st in last_tree.items():
        if pid in seen or pid in nested_all or pid not in procs or procs[pid][4] != st:
            continue
        for q in tree(procs, pid, sups):
            if q not in seen and q not in nested_all:
                seen.add(q)
                counted.append(q)
    return counted


# ------------------------------------------------------------------ journal / lines

def refuse_line(label, why):
    sys.stderr.write("RUNLIMITS: %s refused: %s\n" % (label, why))
    sys.stderr.flush()


def journal(env, rec):
    d = log_dir(env)
    path = os.path.join(d, "runs.jsonl")
    # the rotation is one critical section under an exclusive lock: two supervisors
    # deciding to rotate at once would lose one record or fail the replace (T69)
    lock = os.path.join(d, "runs.jsonl.lock")
    try:
        rotate = int(knob(env, "RUNLIMITS_TEST_ROTATE_BYTES") or ROTATE_BYTES)
    except ValueError:
        rotate = ROTATE_BYTES
    try:
        pause = float(knob(env, "RUNLIMITS_TEST_ROTATE_PAUSE_S") or 0)
    except ValueError:
        pause = 0.0
    line = json.dumps(rec, sort_keys=True) + "\n"
    try:
        os.makedirs(d, exist_ok=True)
        with open(lock, "a") as lf:
            fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
            if os.path.exists(path) and os.path.getsize(path) >= rotate:
                if pause:
                    # the tooth's barrier: the second writer starts only after this flag (T69)
                    open(os.path.join(d, "rotate-entered.%d" % os.getpid()), "w").close()
                    time.sleep(pause)
                os.replace(path, path + ".1")
            with open(path, "a") as f:
                f.write(line)
    except OSError as e:
        sys.stderr.write("RUNLIMITS: journal write failed: %s: %s\n" % (path, e))


# ------------------------------------------------------------------ supervisor

class Supervisor:
    def __init__(self, profile, label, argv, env):
        self.profile, self.label, self.argv, self.env = profile, label, argv, env
        self.plat = platform()
        self.t0 = time.time()
        self.peak_kb = 0
        self.child = None
        self.spec = None
        self.limit = None
        self.sent_kill = False
        self.unit = None
        self.cgroup = None
        self.pending = []
        self.escalate_at = None
        self.term_t = None
        self.term_targets = {}
        self.born_ref = None
        self.stop_procs = None
        self.stop_ps = None
        self.ps_lost = False
        self.stop_ps_named = False
        self.last_tree = {}
        self.ppid0 = os.getppid()
        self.survivors = set()
        self.systemctl = None
        self.tty = None
        self.collected = False
        self.oom_seen = 0
        self.oom_fake = 0
        self.detached = env.get("RUNLIMITS_DETACH") == "1"
        self.tty_child = False
        self.stop_cause = None
        self.stop_limit = None
        self.stop_base_kb = None
        self.window_growth = None
        self.sparing_mem = None
        self.registry = None
        self.mark = None
        self.env_ticks = 0
        self.mark_dir = None
        self.keep_mark = False
        self.env_scan_lost = None
        self.footprint_unread = set()
        self.named_unheld = set()
        self.got_signal = None

    # -- lines / exit
    def finish(self, code, limit, by=None, extra=None):
        if self.stop_limit is not None:
            # the watchdog killed the tree during the stop: that limit is what ended the run
            extra = dict(extra or {}, during_stop=limit, stop_kill=self.stop_limit[2])
            code, limit, by = self.stop_limit[0], self.stop_limit[1], "watchdog"
        if self.systemctl and self.unit and self.child is not None and not self.collected:
            self.unit_state()
        rec = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.t0)),
            "host": socket.gethostname(),
            "profile": self.profile,
            "label": self.label,
            "argv": " ".join(self.argv)[:300],
            "peak_rss_mb": round(self.peak_kb / 1024.0, 1),
            "duration_s": round(time.time() - self.t0, 2),
            "exit": code,
            "limit": limit,
            "by": by,
            "survivors_killed": len(self.survivors),
            "detached": self.detached,
        }
        if self.footprint_unread:
            rec["footprint_unread"] = sorted(self.footprint_unread)
        if self.got_signal is not None:
            # a child that exits 143 on its own writes the same exit and limit: only this field tells them apart
            sys.stderr.write("RUNLIMITS: %s stopped: signal %s from outside\n" % (self.label, self.got_signal))
            rec["signal"] = self.got_signal
        rec.update(extra or {})
        journal(self.env, rec)
        return code

    def refuse(self, why):
        refuse_line(self.label, why)
        return self.finish(EXIT_UNAVAILABLE, "unavailable")

    # -- signals
    def on_signal(self, signum, _frame):
        if self.got_signal is None:
            self.got_signal = signal.Signals(signum).name[3:]
        self.pending.append(signum)

    def forward_pending(self):
        while self.pending:
            signum = self.pending.pop(0)
            targets = self.current_tree()
            self.signal_tree(signum, targets)
            # D8: INT too - a runner's trap may start on INT, before any TERM
            self.note_term(targets=targets)
            if signum != signal.SIGINT:
                self.term_targets.update(targets)
                if self.escalate_at is None:
                    self.term_t = time.time()
                    self.escalate_at = time.time() + GRACE_S

    def escalate(self):
        self.sent_kill = True
        self.kill_sparing_nested(lambda: self.recheck(self.term_targets), self.signal_tree, self.term_t)
        self.escalate_at = None

    def kill_sparing_nested(self, live, send, t_term):
        """SIGKILL what live() returns, then the scope. A nested supervisor there (with
        its tree) is spared until t_term + NESTED_STOP_S: a SIGKILL inside its own stop
        leaves its mark, its unit and its journal record undone. Its ancestors inside
        what live() returns (a runner waiting for it in an EXIT trap) are spared in the
        same window, also after it exits: their own cleanup comes after the wait. The
        watchdog keeps its ticks meanwhile (stop_guard): a limit passed while sparing
        kills everything. A runner's own child - the host of its EXIT trap - and what
        its trap starts are spared in the same window while the child lives (trap_own,
        NOTES item 6d)."""
        next_tick = 0.0
        keep = set()
        self.stop_ps_named = False
        while True:
            self.stop_procs = None
            left = live()
            procs = self.stop_procs
            in_window = time.time() < t_term + NESTED_STOP_S
            spared, anc = self.nested_trees(left) if in_window else ({}, set())
            keep |= anc
            if self.child.poll() is not None:
                # an exited child stays in ps until reaped here: sparing it would hold the window open
                keep.discard(self.child.pid)
            spared.update((p, left[p]) for p in keep if p in left and in_window)
            # CONSTRAINT (NOTES 6d): only the runner profile, whose EXIT trap is promised STOP_S;
            # spared: the child while it lives and what is born after the stop's first signal
            # (born_ref) through spared parents only; not past t_term + NESTED_STOP_S; a lost ps keeps it on
            # Linux (the scope's MemoryMax / RuntimeMaxSec bound it) and drops it on darwin
            host = in_window and self.child.returncode is None and self.profile == "runner" and (procs is not None or self.cgroup)
            if host:
                spared.update(self.trap_own(procs, left, keep | {self.child.pid}))
            if spared and time.time() >= next_tick:
                next_tick = time.time() + TICK_S
                if self.stop_guard(left):
                    spared = self.trap_own(procs, left, {self.child.pid}) if host and self.stop_ps is not None and self.cgroup else {}
            send(signal.SIGKILL, {p: c for p, c in left.items() if p not in spared})
            if not spared:
                break
            time.sleep(0.1)
        self.cgroup_kill()

    def proc_stop_view(self):
        # Sibling scopes are outside this cgroup, but remain in the ppid tree.
        pids = set()
        try:
            entries = os.scandir("/proc")
        except OSError as e:
            raise PsError("cannot open /proc: %s" % e) from e
        with entries:
            for entry in entries:
                if not entry.name.isdigit():
                    continue
                try:
                    if entry.stat().st_uid == os.getuid():
                        pids.add(int(entry.name))
                except OSError:
                    continue
        return proc_table(sorted(pids | set(self.scope_pids())), self.env)

    def stop_view(self):
        if self.ps_lost:
            return self.proc_stop_view()
        try:
            return snapshot(self.env)
        except PsError as original:
            if self.plat == "linux" and self.cgroup:
                try:
                    return self.proc_stop_view()
                except PsError:
                    pass
            raise original

    def stop_guard(self, left):
        """One watchdog tick while nested supervisors are spared, over everything still
        waited for (their trees included: on darwin no kernel limit backs them). True =
        stop sparing: a limit is passed (named on stderr and, via finish, in the journal)
        or the tree cannot be measured (then stop_ps holds the error; one stderr line
        per sparing pass)."""
        self.stop_ps = None
        try:
            procs = self.stop_view()
        except PsError as e:
            if not self.stop_ps_named:
                sys.stderr.write("RUNLIMITS: %s: cannot measure during the stop (%s); nested supervisors not spared\n"
                                 % (self.label, e))
            self.stop_ps, self.stop_ps_named = e, True
            return True
        rss_kb = self.mem_kb(procs, left)
        self.peak_kb = max(self.peak_kb, rss_kb)
        if rss_kb > self.spec["mem_mb"] * 1024 and not knob(self.env, "RUNLIMITS_TEST_NO_MEM_WATCH"):
            if self.stop_cause != "mem":
                sys.stderr.write("RUNLIMITS: %s killed: mem %.0f MB > %d MB during the stop, nested supervisors not spared (profile %s)\n"
                                 % (self.label, rss_kb / 1024.0, self.spec["mem_mb"], self.profile))
            else:
                # one event, one line: the memory stop's own line names it (watch)
                self.sparing_mem = self.sparing_mem or rss_kb
            self.stop_limit = self.stop_limit or (EXIT_MEM, "mem", "sparing")
            return True
        elapsed = time.time() - self.t0
        if (elapsed > self.spec["runtime_s"] and self.stop_cause != "time"
                and not knob(self.env, "RUNLIMITS_TEST_NO_TIME_WATCH")):
            sys.stderr.write("RUNLIMITS: %s killed: time %.1f s > %d s during the stop, nested supervisors not spared (profile %s)\n"
                             % (self.label, elapsed, self.spec["runtime_s"], self.profile))
            self.stop_limit = self.stop_limit or (EXIT_TIME, "time", "sparing")
            return True
        return False

    def stop_rss(self, pids, procs=None):
        """Memory (kB, mem_kb) of the pids still alive; None when ps cannot be read."""
        if procs is None:
            try:
                procs = self.stop_view()
            except PsError:
                return None
        return self.mem_kb(procs, pids)

    def mem_kb(self, procs, pids):
        """Memory (kB) of the pids alive in procs, the sum every limit judges. darwin:
        each pid counts max(rss, phys_footprint); a pid gone meanwhile (ESRCH) counts
        0, another error counts its rss, the pid joins footprint_unread (journal) and
        the first one of the run is named on stderr (R1)."""
        if self.plat != "darwin":
            return sum(procs[p][1] for p in pids if p in procs)
        total = 0
        for p in pids:
            if p not in procs:
                continue
            rss = procs[p][1]
            try:
                fp, err = phys_footprint(p, self.env)
            except FootprintError as e:
                fp, err = None, str(e)
            if fp is None and err == errno.ESRCH:
                continue
            # a named bound, not a fix: without privileges darwin does not measure another uid's
            # process (EPERM) and rss is the only source left; the shortfall is in the journal
            # and on stderr (NOTES item 8)
            if fp is None:
                if not self.footprint_unread:
                    sys.stderr.write("RUNLIMITS: %s: phys_footprint unread for %d: %s; rss used\n" % (self.label, p, err))
                self.footprint_unread.add(p)
                total += rss
                continue
            # darwin: ps rss does not see compressed or swapped pages; the limit judges max(rss, phys_footprint)
            total += max(rss, fp // 1024)
        return total

    def window_guard(self, pids, procs=None):
        """One watchdog tick inside a stop window (SIGTERM sent, SIGKILL not yet) over
        everything waited for, nested supervisors included (the outer's limit bounds
        the whole tree during its stop). A stop by memory keeps its window unless the
        tree grows past WINDOW_GROWTH of its size at the stop's start; any other stop
        ends at once when the tree passes the memory limit. True = SIGKILL now. An
        unreadable ps changes nothing: the window ends with its SIGKILL anyway."""
        if knob(self.env, "RUNLIMITS_TEST_NO_MEM_WATCH"):
            return False
        rss_kb = self.stop_rss(pids, procs)
        if rss_kb is None:
            return False
        self.peak_kb = max(self.peak_kb, rss_kb)
        cap_kb = self.spec["mem_mb"] * 1024
        if self.stop_cause == "mem":
            base_kb = cap_kb if self.stop_base_kb is None else self.stop_base_kb
            if rss_kb <= base_kb * WINDOW_GROWTH:
                return False
            # one event, one line: the memory stop's own line names the growth (watch)
            self.window_growth = self.window_growth or (base_kb, rss_kb)
            self.stop_limit = self.stop_limit or (EXIT_MEM, "mem", "window-growth")
            return True
        if rss_kb <= cap_kb:
            return False
        sys.stderr.write("RUNLIMITS: %s killed: mem %.0f MB > %d MB during the stop window (profile %s)\n"
                         % (self.label, rss_kb / 1024.0, self.spec["mem_mb"], self.profile))
        self.stop_limit = self.stop_limit or (EXIT_MEM, "mem", "window")
        return True

    def window_kill(self, live, send):
        self.sent_kill = True
        send(signal.SIGKILL, live)
        self.cgroup_kill()

    def nested_trees(self, targets):
        """({pid: start} of the nested supervisors among targets and of their trees,
        {pids of targets on the ppid chain above each of them}); empty when ps fails
        (nothing is spared)."""
        try:
            procs = self.stop_view()
        except PsError:
            return {}, set()
        sups = published_supervisors(targets, self.registry, my_uid(self.env), procs)
        if not sups:
            return {}, set()
        out, anc = {}, set()
        for sup in sups:
            for pid in tree(procs, sup):
                out[pid] = procs[pid][4]
            cur = procs[sup][0] if sup in procs else None
            while cur in targets and cur not in anc:
                anc.add(cur)
                cur = procs[cur][0] if cur in procs else None
        return out, anc

    def note_term(self, targets):
        """born_ref: {pid: start} of what exists at the first stop signal sent to the
        tree - a forwarded INT / TERM / HUP or terminate's SIGTERM, whichever comes
        first: its targets over the tree remembered by the last tick (targets win)."""
        if self.born_ref is None:
            self.born_ref = dict(self.last_tree)
            self.born_ref.update(targets)

    def born_after(self, pid, start):
        """True for a pid not in born_ref, or the same pid with another start; an
        unknown start on either side counts as existing."""
        if self.born_ref is None:
            return False
        if pid not in self.born_ref:
            return True
        ref = self.born_ref[pid]
        return ref is not None and start is not None and ref != start

    def trap_own(self, procs, left, roots):
        """{pid: start} of roots and of the pids in left born after the stop's first
        signal (born_ref) whose parent is already in the result: a runner's EXIT trap with its
        helpers and its rm. Without a snapshot (procs None) only the roots."""
        own = {p: (procs[p][4] if procs is not None and p in procs else None) for p in roots}
        if procs is None:
            return own
        grew = True
        while grew:
            grew = False
            for pid in left:
                if pid in own or pid not in procs or not self.born_after(pid, procs[pid][4]):
                    continue
                if procs[pid][0] in own:
                    own[pid] = procs[pid][4]
                    grew = True
        return own

    def lost_measure(self, e):
        # the measure is lost: the stop runs without a single ps (E3, T60)
        left = self.terminate("unavailable", measured=False, why=e)
        refuse_line(self.label, "cannot measure: %s; tree killed" % e)
        return self.finish(EXIT_UNAVAILABLE, "unavailable", extra={"unverified_pids": left})

    def env_scan_tree(self, mark=None):
        """darwin: {pid: start} of own-uid processes whose ps -E line carries the
        whole token RUNLIMITS_TREE=<mark> (this run's mark unless another is named)
        - runaways that left both the tree and the child's group (double fork +
        setsid, A15). PsError like snapshot."""
        try:
            r = subprocess.run([ps_path(self.env), "-axE", "-o", "pid=,uid=,command="],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
                               timeout=PS_TIMEOUT_S, env=dict(os.environ, LC_ALL="C"))
        except (OSError, subprocess.SubprocessError) as e:
            raise PsError("ps not runnable: %s" % e)
        if r.returncode != 0:
            raise PsError("ps exit %d: %s" % (r.returncode, r.stderr.strip()[:200]))
        # a named bound: ps -E prints no environment for Apple's platform binaries (/bin/sleep), so
        # such a runaway with the token stays and is not killed; the run's tree dies by its group
        # before, only re-parented escapees reach this scan (NOTES item 8)
        tok = "RUNLIMITS_TREE=" + (mark or self.mark or "")
        out = {}
        for ln in r.stdout.splitlines():
            parts = ln.split(None, 2)
            if len(parts) < 3:
                continue
            try:
                pid, uid = int(parts[0]), int(parts[1])
            except ValueError:
                continue
            if uid != os.getuid() or tok not in parts[2].replace("\\012", " ").split():
                continue
            st = proc_start(pid, self.env)
            if st is not None:
                out[pid] = st
        return out

    def env_remember(self, sweeping=False):
        """Fold the env scan into last_tree ahead of a stop or a sweep. A scan that
        fails mid-stop is skipped (the windows already handle a dead ps their way);
        in the sweep it leaves what the child left unverified: a stderr line, and
        env_scan_lost turns the verdict of a self-exited child into unverified (E5, T92)."""
        if self.plat != "darwin":
            return
        try:
            if sweeping and knob(self.env, "RUNLIMITS_TEST_ENVSCAN_FAIL_AT_SWEEP") == "1":
                raise PsError("made unavailable by the test knob RUNLIMITS_TEST_ENVSCAN_FAIL_AT_SWEEP")
            self.last_tree.update(self.env_scan_tree())
        except PsError as e:
            if sweeping:
                self.env_scan_lost = str(e)
                sys.stderr.write("RUNLIMITS: %s: descendant scan unavailable (%s); leftovers not verified\n"
                                 % (self.label, e))

    # -- tree helpers
    def remember_tree(self, procs):
        # accumulate, never re-snapshot: at a child's death its descendants reparent and the
        # tick in that window holds only the zombie root, erasing them from the sweep (T41e);
        # identity is (pid, start), a reused pid with another start drops out (T58)
        kept = {p: s for p, s in self.last_tree.items() if p in procs and procs[p][4] == s}
        kept.update((p, procs[p][4]) for p in tree(procs, self.child.pid))
        self.last_tree = kept

    def current_tree(self):
        """{pid: start} of the whole child tree (nested supervisors included)."""
        try:
            procs = self.stop_view()
        except PsError:
            return {self.child.pid: None}
        return {pid: procs[pid][4] for pid in tree(procs, self.child.pid)}

    def signal_tree(self, signum, targets):
        for pid in targets:
            if pid == self.child.pid:
                if self.child.returncode is None:
                    try:
                        self.child.send_signal(signum)
                    except OSError as e:
                        sys.stderr.write("RUNLIMITS: %s: signal %d to %d failed: %s\n" % (self.label, signum, pid, e))
                continue
            try:
                os.kill(pid, signum)
            except ProcessLookupError:
                pass
            except OSError as e:
                sys.stderr.write("RUNLIMITS: %s: signal %d to %d failed: %s\n" % (self.label, signum, pid, e))

    def recheck(self, remembered):
        """Pids to signal now: the fresh tree, plus remembered pids that left the
        tree (orphans) whose start time is unchanged (a changed start = reused pid).
        The snapshot read (None without one) stays in stop_procs for trap_own."""
        try:
            procs = self.stop_view()
        except PsError:
            procs = None
        self.stop_procs = procs
        if procs is None:
            out = {self.child.pid: None}
            # one scope read per call: membership alone proves a remembered pid ours
            # (a reused pid inside our scope is still our descendant)
            scope = self.scope_pids()
            for pid, st in remembered.items():
                if pid == self.child.pid or st is None:
                    continue
                if self.plat == "linux":
                    # CONSTRAINT (channel order): /proc, then scope membership, then a
                    # single ps call - never ps after a lost measure (E3, T131)
                    if proc_start(pid, self.env) == st:
                        out[pid] = st
                    elif pid in scope:
                        out[pid] = st
                    elif not self.ps_lost and ps_start(ps_path(self.env), pid) == st:
                        out[pid] = st
                else:
                    out[pid] = st  # darwin: no /proc and ps is down; the snapshot is <= TICK_S old
            return out
        out = {pid: procs[pid][4] for pid in tree(procs, self.child.pid)}
        for pid, st in remembered.items():
            if pid not in out and pid in procs and procs[pid][4] == st:
                out[pid] = st
        return out

    def tree_gone(self, targets):
        if self.child.poll() is None:
            return False
        try:
            procs = self.stop_view()
        except PsError:
            return True
        return not any(pid in procs and procs[pid][4] == st for pid, st in targets.items() if pid != self.child.pid)

    def terminate(self, cause, measured=True, why=None):
        """SIGTERM the tree, SIGKILL after GRACE_S what is left; reaps the child.
        Returns the remembered pids left unsignalled (only a stop without a measure
        on darwin leaves any, stop_unmeasured)."""
        self.stop_cause = cause
        if not measured:
            return self.stop_unmeasured(why)
        self.env_remember()
        targets = self.recheck(self.last_tree)
        self.stop_base_kb = self.stop_rss(targets)
        self.note_term(targets)
        self.signal_tree(signal.SIGTERM, targets)
        t_term = time.time()
        deadline = t_term + GRACE_S
        next_tick = t_term
        while time.time() < deadline:
            if self.tree_gone(targets):
                break
            if time.time() >= next_tick:
                next_tick = time.time() + TICK_S
                live = self.recheck(targets)
                if self.window_guard(live):
                    self.window_kill(live, self.signal_tree)
                    break
            time.sleep(0.1)
        else:
            self.sent_kill = True
            self.kill_sparing_nested(lambda: self.recheck(targets), self.signal_tree, t_term)
        self.child.wait()
        self.tty_give_back()
        self.sweep()
        self.reap_leftovers()  # A12: stop path
        return []

    def stop_unmeasured(self, why):
        """E3 never retries ps. A readable Linux /proc view preserves the tree's
        identities and the stop rules of 6d. Without it, the unreaped child and
        Linux scope (darwin: the child's group) are the only known targets.
        A runner's Linux trap host is spared until exit or SIGTERM + NESTED_STOP_S.
        darwin: remembered pids outside the child cannot be told from reused ones
        without a measure - not signalled, named on stderr and returned; the mark
        stays in the registry with their `<pid> <start>` in its `unverified` for a
        reap with a working measure (R6); a start never read is written `-` (R5)."""
        if self.cgroup:
            try:
                procs = self.proc_stop_view()
            except PsError:
                pass
            else:
                self.ps_lost = True
                targets = {pid: procs[pid][4] for pid in tree(procs, self.child.pid)}
                self.note_term(targets)
                self.signal_tree(signal.SIGTERM, targets)
                t_term = time.time()
                while time.time() < t_term + GRACE_S and self.child.poll() is None:
                    time.sleep(0.1)
                self.sent_kill = True
                self.kill_sparing_nested(lambda: self.recheck(targets), self.signal_tree, t_term=t_term)
                self.child.wait()
                self.tty_give_back()
                return []
        self.signal_unmeasured(signal.SIGTERM)
        t_term = time.time()
        kill_at = t_term + GRACE_S
        while time.time() < kill_at:
            self.child.poll()
            time.sleep(0.1)
        # CONSTRAINT (NOTES 6d, D7): Linux only - the scope's MemoryMax / RuntimeMaxSec bound the
        # spared trap; the trap's newborns are unseen without ps and the SIGKILL goes to the child alone
        if self.cgroup and self.profile == "runner":
            while self.child.poll() is None and time.time() < t_term + NESTED_STOP_S:
                time.sleep(0.1)
        self.sent_kill = True
        self.signal_unmeasured(signal.SIGKILL)
        self.cgroup_kill()
        self.child.wait()
        self.tty_give_back()
        left = sorted(p for p in self.last_tree if p != self.child.pid) if self.plat == "darwin" else []
        if left:
            self.keep_mark = True
            self.record_marks_file("unverified", {p: self.last_tree[p] for p in left})
            sys.stderr.write("RUNLIMITS: %s: remembered descendants not signalled: cannot measure (%s): %s\n"
                             % (self.label, why, " ".join(str(p) for p in left)))
        return left

    def signal_unmeasured(self, signum):
        try:
            # send_signal polls first: a reaped child's pid is never signalled
            self.child.send_signal(signum)
        except OSError as e:
            sys.stderr.write("RUNLIMITS: %s: signal %d to %d failed: %s\n" % (self.label, signum, self.child.pid, e))
        if self.plat == "darwin":
            try:
                os.killpg(self.child.pid, signum)
            except ProcessLookupError:
                pass
            except OSError as e:
                sys.stderr.write("RUNLIMITS: %s: signal %d to group %d failed: %s\n" % (self.label, signum, self.child.pid, e))

    def cgroup_kill(self):
        if not self.cgroup:
            return
        path = "/sys/fs/cgroup%s/cgroup.kill" % self.cgroup
        try:
            with open(path, "w") as f:
                f.write("1")
        except FileNotFoundError:
            pass
        except OSError as e:
            sys.stderr.write("RUNLIMITS: %s: %s failed: %s\n" % (self.label, path, e))

    # -- what is left after the child exited
    def leftovers(self, remembered):
        """{pid: start} still alive of what the child left behind: remembered pids
        with an unchanged start time, the scope's processes (Linux), members of
        the child's process group (darwin), and their current descendants.
        darwin: a process that left both the child's process group and the tree
        before the last snapshot is found by the env scan (A15)."""
        me = os.getpid()
        try:
            procs = self.stop_view()
        except PsError:
            procs = None
        roots = set()
        if procs is None:
            out = {}
            # one scope read per call: it feeds both the membership channel and the
            # scope members added below with an unread start
            scope_members = self.scope_pids()
            for pid, st in remembered.items():
                if pid in (self.child.pid, me) or st is None:
                    continue
                if self.plat == "linux":
                    # CONSTRAINT: /proc, then scope membership, then one ps call.
                    # E3 returns before the sweep; this path has not lost its measure.
                    if proc_start(pid, self.env) == st:
                        out[pid] = st
                    elif pid in scope_members:
                        out[pid] = st
                    elif st == ps_start(ps_path(self.env), pid):
                        out[pid] = st
                else:
                    out[pid] = st  # darwin: no /proc and ps is down; the snapshot is <= TICK_S old
            for pid in scope_members:
                out.setdefault(pid, None)
            return out
        for pid, st in remembered.items():
            if pid != self.child.pid and pid in procs and procs[pid][4] == st:
                roots.add(pid)
        roots.update(p for p in self.scope_pids() if p in procs)
        # the child's pid still in use = it was reused; its group is no longer ours
        if self.plat == "darwin" and self.child.pid not in procs:
            roots.update(pid for pid, rec in procs.items() if rec[3] == self.child.pid)
        out = {}
        for r in roots:
            for pid in tree(procs, r):
                out[pid] = procs[pid][4]
        out.pop(me, None)
        return out

    def scope_pids(self):
        if not self.cgroup:
            return []
        # CONSTRAINT: the test knob fails only this read (T123s); cgroup_kill and
        # check_scope must keep working with it set
        if knob(self.env, "RUNLIMITS_TEST_SCOPE_UNREADABLE") == "1":
            return []
        try:
            with open("/sys/fs/cgroup%s/cgroup.procs" % self.cgroup) as f:
                return [int(x) for x in f.read().split()]
        except (OSError, ValueError):
            return []

    def signal_pids(self, signum, targets):
        for pid in targets:
            try:
                os.kill(pid, signum)
            except ProcessLookupError:
                pass
            except OSError as e:
                sys.stderr.write("RUNLIMITS: %s: signal %d to %d failed: %s\n" % (self.label, signum, pid, e))

    def sweep(self):
        """After the child exited: everything it left dies (SIGTERM, SIGKILL after GRACE_S)."""
        self.env_remember(sweeping=True)
        remembered = dict(self.last_tree)
        remembered.update(self.term_targets)
        targets = self.leftovers(remembered)
        if not targets:
            self.cgroup_kill()
            return
        self.survivors.update(targets)
        self.signal_pids(signal.SIGTERM, targets)
        t_term = time.time()
        deadline = t_term + GRACE_S
        next_tick = t_term
        while time.time() < deadline:
            left = self.leftovers(targets)
            if not left:
                self.cgroup_kill()
                return
            self.survivors.update(left)
            targets.update(left)
            if time.time() >= next_tick:
                next_tick = time.time() + TICK_S
                if self.window_guard(left):
                    self.window_kill(left, self.signal_pids)
                    return
            time.sleep(0.1)

        def live():
            left = self.leftovers(targets)
            self.survivors.update(left)
            return left
        self.sent_kill = True
        self.kill_sparing_nested(live, self.signal_pids, t_term)

    def oom_events(self):
        """oom_kill of the scope's memory.events while the cgroup exists, else None.
        Test mode: RUNLIMITS_TEST_OOM_EVENTS=grow makes every read one higher (T106)."""
        if not self.cgroup:
            return None
        if knob(self.env, "RUNLIMITS_TEST_OOM_EVENTS") == "grow":
            self.oom_fake += 1
            return self.oom_fake
        try:
            with open("/sys/fs/cgroup%s/memory.events" % self.cgroup) as f:
                data = f.read()
        except OSError:
            return None
        for ln in data.splitlines():
            name, _, value = ln.partition(" ")
            if name == "oom_kill":
                try:
                    return int(value)
                except ValueError:
                    return None
        return None

    def unit_state(self):
        """Settled {LoadState, ActiveState, Result} of the scope, or (None, reason).
        The scope runs without --collect so that a failed scope keeps its
        Result until it is read here; a failed scope is collected here."""
        self.collected = True
        unit = self.unit + ".scope"
        deadline = time.time() + UNIT_SETTLE_S
        while True:
            try:
                r = subprocess.run([self.systemctl, "--user", "show", unit, "-p", "LoadState", "-p", "ActiveState",
                                    "-p", "Result"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   universal_newlines=True, timeout=10)
            except (OSError, subprocess.SubprocessError) as e:
                return None, "systemctl show %s failed: %s" % (unit, e)
            if r.returncode != 0:
                return None, "systemctl show %s exit %d: %s" % (unit, r.returncode, r.stderr.strip()[:200])
            st = {}
            for ln in r.stdout.splitlines():
                k, _, v = ln.partition("=")
                st[k] = v
            if st.get("LoadState") == "not-found" or st.get("ActiveState") in ("inactive", "failed"):
                break
            if time.time() >= deadline:
                return None, "scope %s still %s after %d s" % (unit, st.get("ActiveState"), UNIT_SETTLE_S)
            time.sleep(0.05)
        if st.get("ActiveState") == "failed":
            try:
                rr = subprocess.run([self.systemctl, "--user", "reset-failed", unit], stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, universal_newlines=True, timeout=10)
                if rr.returncode != 0:
                    sys.stderr.write("RUNLIMITS: %s: systemctl reset-failed %s exit %d: %s\n"
                                     % (self.label, unit, rr.returncode, rr.stderr.strip()[:200]))
            except (OSError, subprocess.SubprocessError) as e:
                sys.stderr.write("RUNLIMITS: %s: systemctl reset-failed %s failed: %s\n" % (self.label, unit, e))
        return st, None

    def kernel_sign(self, events):
        """What the kernel limits of the scope did: ("oom" | "timeout" | "none", what was read),
        or (None, reason) when it cannot be read."""
        if self.plat != "linux":
            return None, "darwin: no kernel memory limit to read"
        st, why = self.unit_state()
        if knob(self.env, "RUNLIMITS_TEST_OOM_SIGN") == "unreadable":
            return None, "oom sign made unreadable by the test knob RUNLIMITS_TEST_OOM_SIGN"
        if events:
            return "oom", "memory.events oom_kill %d" % events
        if st is None:
            if events is not None:
                return "none", "memory.events oom_kill 0; scope state unreadable: %s" % why
            return None, "oom sign unreadable: %s" % why
        if st.get("LoadState") == "not-found":
            return "none", "scope collected without failure"
        result = st.get("Result")
        if result == "oom-kill":
            return "oom", "scope result oom-kill"
        if result == "timeout":
            return "timeout", "scope result timeout"
        return "none", "scope result %s" % result

    def kernel_oom(self, rc):
        """86 by=kernel for an oom-kill in the scope; rc is the child's returncode."""
        code = rc if rc >= 0 else 128 - rc
        # an oom-kill anywhere in the scope: the run's tree hit the limit, its result is not trusted
        if rc == -signal.SIGKILL:
            sys.stderr.write("RUNLIMITS: %s killed: mem (kernel oom-kill) > %d MB (profile %s)\n"
                             % (self.label, self.spec["mem_mb"], self.profile))
            # the kernel names no victim when the child itself died: unattributed (A9)
            return self.finish(EXIT_MEM, "mem", "kernel", {"oom_victim": "unattributed", "child_exit": code})
        sys.stderr.write("RUNLIMITS: %s killed: mem (kernel oom-kill of a descendant; child exit %d) > %d MB (profile %s)\n"
                         % (self.label, code, self.spec["mem_mb"], self.profile))
        return self.finish(EXIT_MEM, "mem", "kernel", {"oom_victim": "descendant", "child_exit": code})

    def tty_take(self):
        """darwin: the child's own process group gets the controlling terminal
        while it runs, if the supervisor holds it (else a child reading the
        terminal would stop on SIGTTIN)."""
        try:
            fd = os.open("/dev/tty", os.O_RDWR | os.O_NOCTTY)
        except OSError:
            return
        try:
            if os.tcgetpgrp(fd) != os.getpgrp():
                os.close(fd)
                return
            old = signal.signal(signal.SIGTTOU, signal.SIG_IGN)
            try:
                os.tcsetpgrp(fd, self.child.pid)
            finally:
                signal.signal(signal.SIGTTOU, old)
            self.tty = fd
            self.tty_child = True
            os.killpg(self.child.pid, signal.SIGCONT)
        except OSError:
            if self.tty is None:
                os.close(fd)

    def tty_set(self, pgid):
        old = signal.signal(signal.SIGTTOU, signal.SIG_IGN)
        try:
            os.tcsetpgrp(self.tty, pgid)
        finally:
            signal.signal(signal.SIGTTOU, old)

    def tty_to_job(self):
        """The terminal goes back to the supervisor's group only while the child's
        group holds it (after `bg` it is the shell's: taking it would steal it)."""
        if self.tty_child:
            try:
                if os.tcgetpgrp(self.tty) == self.child.pid:
                    self.tty_set(os.getpgrp())
            except OSError:
                pass
            self.tty_child = False

    def tty_give_back(self):
        if self.tty is None:
            return
        self.tty_to_job()
        os.close(self.tty)
        self.tty = None

    def job_control(self):
        """darwin, the child's group holding the job's terminal: a stopped child
        (Ctrl-Z, SIGTTIN) stops the job - terminal back to it, the job's group
        stops like a foreground job would; on SIGCONT the child's group gets the
        terminal again if the job is in the foreground (`fg`), not after `bg`,
        and SIGCONT. Descendants that left the child's group (their own session)
        get SIGSTOP before it and SIGCONT after, or they would run on unwatched
        while the job stands (A4, T61). Their `<pid> <start>` is in the mark's
        `stopped` before the SIGSTOP and leaves it after the SIGCONT: a supervisor
        killed in between leaves them to the next reap (E4, T91)."""
        try:
            r = os.waitid(os.P_PID, self.child.pid, os.WSTOPPED | os.WNOHANG)
        except ChildProcessError:
            return
        if r is None or r.si_code not in (os.CLD_STOPPED, os.CLD_TRAPPED):
            return
        held = self.stop_set()
        self.record_stopped(held)
        extra = set()
        for pid in held:
            try:
                os.kill(pid, signal.SIGSTOP)
                extra.add(pid)
            except OSError:
                pass
        self.tty_to_job()
        os.killpg(os.getpgrp(), signal.SIGTSTP)
        try:
            if os.tcgetpgrp(self.tty) == os.getpgrp():
                self.tty_set(self.child.pid)
                self.tty_child = True
        except OSError:
            pass
        try:
            os.killpg(self.child.pid, signal.SIGCONT)
        except ProcessLookupError:
            pass
        for pid in extra:
            try:
                os.kill(pid, signal.SIGCONT)
            except OSError:
                pass
        self.record_stopped({})

    def stop_set(self):
        """{pid: start} Ctrl-Z holds with SIGSTOP: the remembered and the current
        tree, without the child, this process and the child's own group (it stops
        with the job itself). A start the snapshot could not read is read again for
        that pid alone, and only for a pid in this call's current tree; still
        unreadable, the pid is named on stderr and not held: without its start it
        cannot go into `stopped`, and a stopped process nobody recorded has nobody
        to resume it (R7, T104). A remembered pid outside the current tree with no
        start is neither reread nor held (T111) and is named on stderr once per pid
        per run (T117)."""
        cur = self.current_tree()
        cand = dict(self.last_tree)
        cand.update(cur)
        held = {}
        for pid, st in cand.items():
            if pid in (self.child.pid, os.getpid()):
                continue
            try:
                if os.getpgid(pid) == self.child.pid:
                    continue
            except OSError:
                continue
            if st is None:
                # outside the tree the pid may have died and been reused: its new start would claim a
                # stranger. Bound left: a pid of the tree that dies and is reused between
                # current_tree() and this read (NOTES item 7)
                if pid not in cur:
                    if pid not in self.named_unheld:
                        self.named_unheld.add(pid)
                        sys.stderr.write("RUNLIMITS: %s: remembered %d not held: outside the tree, start not recorded\n" % (self.label, pid))
                    continue
                st = proc_start(pid, self.env)
                if st is None:
                    sys.stderr.write("RUNLIMITS: %s: descendant %d not held: start unreadable\n" % (self.label, pid))
                    continue
            held[pid] = st
        return held

    def record_stopped(self, held):
        """The mark's `stopped` file: `<pid> <start>` lines of the descendants held
        with SIGSTOP, replaced atomically; an empty held removes it."""
        self.record_marks_file("stopped", held)

    def record_marks_file(self, name, pids):
        """The mark's file name: `<pid> <start>` lines (`-` for a start never read),
        replaced atomically (a reaper reads either the old or the new whole file);
        empty pids remove it."""
        path = os.path.join(self.mark_dir, name)
        try:
            if not pids:
                if os.path.exists(path):
                    os.unlink(path)
                return
            with open(path + ".tmp", "w") as f:
                f.write("".join("%d %s\n" % (p, "-" if s is None else s) for p, s in sorted(pids.items())))
            os.replace(path + ".tmp", path)
        except OSError as e:
            sys.stderr.write("RUNLIMITS: %s: %s descendants not recorded in %s: %s\n" % (self.label, name, path, e))

    def resume_stopped(self, mark, procs):
        """SIGCONT to what the dead owner of mark left stopped (its `stopped`), each
        pid only while it still has its recorded start. False = keep the mark: there
        is a `stopped` and no snapshot to tell a reused pid (E4)."""
        try:
            with open(os.path.join(mark, "stopped")) as f:
                lines = f.read().splitlines()
        except FileNotFoundError:
            return True
        except OSError:
            return False
        if procs is None:
            return False
        for ln in lines:
            f = ln.split()
            if len(f) != 2 or not (f[0].isdigit() and f[1].isdigit()):
                continue
            pid, st = int(f[0]), int(f[1])
            if pid in procs and procs[pid][4] == st:
                try:
                    os.kill(pid, signal.SIGCONT)
                except OSError as e:
                    sys.stderr.write("RUNLIMITS: %s: SIGCONT to %d left stopped by a dead supervisor failed: %s\n"
                                     % (self.label, pid, e))
        return True

    def kill_unverified(self, mark, procs):
        """SIGKILL to what the dead owner of mark could not signal in its stop without
        a measure (its `unverified`), each pid only while it still has its recorded
        start; another start or no such pid drops the record - a reused pid is not
        ours (R6, R8). A record stays (the file keeps it, the mark lives on) while its
        pid is live and unproven: start unreadable (R5, A7), start never recorded
        (`-`) and no token of the dead run found by the env scan (R5, A15), SIGKILL
        refused (R6). False = keep the mark: records stay, or the file cannot be
        read or rewritten."""
        path = os.path.join(mark, "unverified")
        try:
            with open(path) as f:
                lines = f.read().splitlines()
        except FileNotFoundError:
            return True
        except OSError:
            return False
        kept = []
        scan = None
        for ln in lines:
            f = ln.split()
            if len(f) != 2 or not f[0].isdigit() or not (f[1].isdigit() or f[1] == "-"):
                continue
            pid, st = int(f[0]), (None if f[1] == "-" else int(f[1]))
            if procs is not None:
                if pid not in procs:
                    continue
                now = procs[pid][4]
            elif not os.path.exists("/proc/%d" % pid):
                continue
            else:
                now = proc_start(pid, self.env)
            if st is None:
                # no identity was recorded: only the dead run's own env token proves the pid ours
                if scan is None:
                    scan = self.unverified_scan(mark)
                if isinstance(scan, str) or pid not in scan:
                    kept.append(ln)
                    sys.stderr.write("RUNLIMITS: %s: %d left unverified by a dead supervisor kept: start not recorded, %s\n"
                                     % (self.label, pid, scan if isinstance(scan, str) else "no RUNLIMITS_TREE token of its run"))
                    continue
            elif now is None:
                kept.append(ln)
                continue
            elif now != st:
                continue
            if not self.sigkill_unverified(pid):
                kept.append(ln)
        if kept and len(kept) < len(lines):
            try:
                with open(path + ".tmp", "w") as f:
                    f.write("".join(k + "\n" for k in kept))
                os.replace(path + ".tmp", path)
            except OSError as e:
                sys.stderr.write("RUNLIMITS: %s: %s not rewritten: %s\n" % (self.label, path, e))
        return not kept

    def sigkill_unverified(self, pid):
        """SIGKILL to one pid left unverified; False when it was refused (named on stderr)."""
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError as e:
            sys.stderr.write("RUNLIMITS: %s: SIGKILL to %d left unverified by a dead supervisor failed: %s\n"
                             % (self.label, pid, e))
            return False
        return True

    def unverified_scan(self, mark):
        """{pid: start} carrying the token of mark's run (RUNLIMITS_TREE=runlimits-<pid>-s<start>),
        or the reason it cannot be told (a string)."""
        m = LEFTOVER_RE.match(os.path.basename(mark))
        if not m:
            return "mark name %s carries no run token" % os.path.basename(mark)
        try:
            return self.env_scan_tree("runlimits-%s-s%s" % m.groups())
        except PsError as e:
            return "descendant scan unavailable (%s)" % e

    # -- Linux kernel limit
    def linux_preflight(self):
        path = self.env.get("PATH", os.defpath)
        self.systemd_run = shutil.which("systemd-run", path=path)
        if not self.systemd_run:
            return "systemd-run not found in PATH (no kernel limit on Linux without it)"
        systemctl = shutil.which("systemctl", path=path)
        if not systemctl:
            return "systemctl not found in PATH"
        self.systemctl = systemctl
        try:
            r = subprocess.run([systemctl, "--user", "is-system-running"], stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, universal_newlines=True, timeout=10)
        except (OSError, subprocess.SubprocessError) as e:
            return "systemctl --user is-system-running failed: %s" % e
        state = r.stdout.strip()
        if state not in ("running", "degraded"):
            return "user manager state %r (want running/degraded)" % (state or r.stderr.strip()[:120])
        return None

    def leftover_name(self):
        """runlimits-<pid>-s<start time>: a later supervisor can tell a dead owner from a
        live one; None when the start time cannot be read."""
        # The knob models /proc loss after mark publication; without a mark the stop path is unreachable.
        start_env = dict(self.env)
        start_env.pop("RUNLIMITS_TEST_PROC_UNREADABLE", None)
        start = proc_start(os.getpid(), start_env)
        return None if start is None else "runlimits-%d-s%d" % (os.getpid(), start)

    def reap_leftovers(self):
        """Removes failed scopes (Linux) and mark dirs (in the registry) of dead supervisors
        (live owners still read their scope's Result). Names of another form are left alone.
        darwin takes one snapshot for the whole pass and removes nothing at all when it
        cannot measure (A7)."""
        procs = None
        if self.plat == "darwin":
            try:
                procs = snapshot(self.env)
            except PsError as e:
                sys.stderr.write("RUNLIMITS: %s: leftovers not reaped: cannot measure (%s)\n" % (self.label, e))
                return
        if self.systemctl:
            try:
                r = subprocess.run([self.systemctl, "--user", "list-units", "--all", "--plain", "--no-legend",
                                    "--state=failed", "runlimits-*.scope"], stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, universal_newlines=True, timeout=10)
                units = [ln.split()[0] for ln in r.stdout.splitlines() if ln.split()] if r.returncode == 0 else []
                if r.returncode != 0:
                    sys.stderr.write("RUNLIMITS: %s: systemctl list-units exit %d: %s\n"
                                     % (self.label, r.returncode, r.stderr.strip()[:200]))
            except (OSError, subprocess.SubprocessError) as e:
                units = []
                sys.stderr.write("RUNLIMITS: %s: systemctl list-units failed: %s\n" % (self.label, e))
            for unit in units:
                if owner_dead(unit, procs):
                    try:
                        subprocess.run([self.systemctl, "--user", "reset-failed", unit], stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, timeout=10)
                    except (OSError, subprocess.SubprocessError) as e:
                        sys.stderr.write("RUNLIMITS: %s: systemctl reset-failed %s failed: %s\n" % (self.label, unit, e))
        try:
            names = os.listdir(self.registry)
        except OSError:
            names = []
        for name in names:
            path = os.path.join(self.registry, name)
            if owner_dead(name, procs):
                # in a shared registry only marks of our own uid are ours to remove
                try:
                    st = os.lstat(path)
                except OSError:
                    continue
                if (stat.S_ISDIR(st.st_mode) and st.st_uid == my_uid(self.env) and self.resume_stopped(path, procs)
                        and self.kill_unverified(path, procs)):
                    shutil.rmtree(path, ignore_errors=True)

    def time_s(self):
        """runtime_s for this run: the profile's, or the test knob's value (test mode
        only), which replaces it wherever the profile's time limit is read (T24 (b), T107).
        The budget runs from Supervisor.__init__: the whole call, scope setup included."""
        k = knob(self.env, "RUNLIMITS_TEST_TIME_S")
        if k:
            try:
                return int(k)
            except ValueError:
                pass
        return self.spec["runtime_s"]

    def kernel_mem_mb(self):
        """MemoryMax for the scope: the profile's mem_mb, or the test knob's value
        (test mode only) so a tooth can lift the kernel limit out of the watchdog's
        way and watch the watchdog itself (A1, T57)."""
        k = knob(self.env, "RUNLIMITS_TEST_KERNEL_MEM_MB")
        if k:
            try:
                return int(k)
            except ValueError:
                pass
        return self.spec["mem_mb"]

    def linux_argv(self, confirm):
        self.unit = self.mark
        mem = self.kernel_mem_mb()
        shim = '/bin/cat /proc/self/cgroup >"$0" || exit 125; while [ -e "$0" ]; do /bin/sleep 0.01; done; exec "$@"'
        return [self.systemd_run, "--user", "--scope", "--quiet", "--unit", self.unit,
                "-p", "MemoryMax=%dM" % mem, "-p", "MemorySwapMax=0",
                "-p", "RuntimeMaxSec=%d" % (self.spec["runtime_s"] + KERNEL_RUNTIME_MARGIN_S),
                "--", "/bin/sh", "-c", shim, confirm] + self.argv

    def linux_confirm(self, confirm):
        """None once the child sits in our scope with the kernel limits set; else the reason."""
        deadline = time.time() + CONFIRM_TIMEOUT_S
        data = ""
        while time.time() < deadline:
            try:
                with open(confirm) as f:
                    data = f.read()
            except FileNotFoundError:
                data = ""
            if data.endswith("\n"):
                break
            rc = self.child.poll()
            if rc is not None:
                return "systemd-run exited %d before the scope was confirmed" % rc
            time.sleep(0.01)
        else:
            return "scope not confirmed within %d s" % CONFIRM_TIMEOUT_S
        line = [l for l in data.splitlines() if l.startswith("0::")]
        if not line:
            return "no cgroup v2 line in /proc/self/cgroup of the child: %r" % data[:200]
        return self.check_scope(line[0][3:])

    def check_scope(self, cg):
        if not cg.endswith("/%s.scope" % self.unit):
            return "kernel limit not applied: child cgroup %s is not %s.scope" % (cg, self.unit)
        self.cgroup = cg
        want = {"memory.max": str(self.kernel_mem_mb() * 1048576), "memory.swap.max": "0"}
        for name, value in want.items():
            p = "/sys/fs/cgroup%s/%s" % (cg, name)
            try:
                got = open(p).read().strip()
            except OSError as e:
                return "kernel limit not readable: %s: %s" % (p, e)
            if got != value:
                return "kernel limit not applied: %s = %s, want %s" % (p, got, value)
        return None

    # -- main
    def run(self):
        try:
            self.spec = profile_spec(self.profile, self.env)
        except ValueError as e:
            return self.refuse(str(e))
        self.spec["runtime_s"] = self.time_s()
        try:
            depth = int(self.env.get("RUNLIMITS_DEPTH", "0"))
        except ValueError:
            depth = 0
        if depth >= MAX_DEPTH:
            return self.refuse("nesting depth %d reached" % depth)
        if not self.argv:
            return self.refuse("no command after --")
        try:
            snapshot(self.env)
        except PsError as e:
            return self.refuse("cannot measure: %s (child not started)" % e)
        if self.plat == "darwin":
            # no kernel limit on darwin: without phys_footprint the watchdog would judge rss alone (R1)
            why = footprint_unavailable(self.env)
            if why:
                return self.refuse("darwin memory measure unavailable: %s" % why)

        try:
            self.registry = registry_dir(self.env)
        except RegistryError as e:
            return self.refuse(str(e))
        child_env = dict(self.env)
        child_env["RUNLIMITS_ACTIVE"] = "%d:%s" % (os.getpid(), self.profile)
        child_env["RUNLIMITS_REGISTRY"] = self.registry
        child_env["RUNLIMITS_DEPTH"] = str(depth + 1)
        # detach frees this supervisor from its parent only; nested supervisors keep watching theirs
        child_env.pop("RUNLIMITS_DETACH", None)
        cmd, confirm = self.argv, None
        kernel = self.plat == "linux"
        if kernel:
            why = self.linux_preflight()
            if why:
                return self.refuse(why)
        self.mark = self.leftover_name()
        if self.mark is None:
            return self.refuse("cannot read the start time of pid %d (a supervisor's mark)" % os.getpid())
        # darwin finds setsid runaways by this token in their environment (A15, T75)
        child_env["RUNLIMITS_TREE"] = self.mark
        self.reap_leftovers()  # T34: dead owners at start
        try:
            # the mark (both platforms): nested supervisors are known by it, for sparing and the memory budget
            tmpd = tempfile.mkdtemp(prefix=self.mark + "-", dir=self.registry)
        except OSError as e:
            return self.refuse("cannot create the mark dir: %s" % e)
        self.mark_dir = tmpd
        if kernel:
            confirm = os.path.join(tmpd, "cgroup")
            cmd = self.linux_argv(confirm)

        for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(s, self.on_signal)
        popen_kw = {}
        if self.plat == "darwin":
            popen_kw["preexec_fn"] = os.setpgrp
        try:
            try:
                self.child = subprocess.Popen(cmd, env=child_env, **popen_kw)
            except OSError as e:
                return self.refuse("cannot start %s: %s" % (cmd[0], e))
            if self.plat == "darwin":
                self.tty_take()
            if confirm:
                why = self.linux_confirm(confirm)
                if why:
                    if self.child.poll() is None:
                        self.terminate("unavailable")
                    return self.refuse(why)
                os.unlink(confirm)
            return self.watch()
        finally:
            self.tty_give_back()
            if not self.keep_mark:
                shutil.rmtree(tmpd, ignore_errors=True)

    def watch(self):
        mute_mem = bool(knob(self.env, "RUNLIMITS_TEST_NO_MEM_WATCH"))
        mute_time = bool(knob(self.env, "RUNLIMITS_TEST_NO_TIME_WATCH"))
        tick_after = knob(self.env, "RUNLIMITS_TEST_TICK_AFTER_EXIT") == "1"
        cap_kb = self.spec["mem_mb"] * 1024
        cap_s = self.spec["runtime_s"]
        next_tick = time.time()
        while True:
            self.forward_pending()
            if tick_after and pid_zombie(self.child.pid):
                # the knob reproduces the T41e window deterministically: one more tick snapshot
                # while the child is a zombie and this loop has not noticed its death yet
                tick_after = False
                try:
                    self.remember_tree(snapshot(self.env))
                except PsError as e: return self.lost_measure(e)
            if self.child.poll() is not None:
                break
            if not self.detached and os.getppid() != self.ppid0:
                self.terminate("parent-gone")
                sys.stderr.write("RUNLIMITS: %s killed: parent gone (set RUNLIMITS_DETACH=1 to detach)\n" % self.label)
                return self.finish(128 + signal.SIGTERM, "parent-gone")
            if self.escalate_at is not None and time.time() >= self.escalate_at:
                self.escalate()
            now = time.time()
            if now >= next_tick:
                next_tick = now + TICK_S
                try:
                    procs = snapshot(self.env)
                except PsError as e:
                    return self.lost_measure(e)
                sups = published_supervisors(list(procs), self.registry, my_uid(self.env), procs)
                if self.plat == "darwin":
                    self.env_ticks += 1
                    if self.env_ticks % ENV_SCAN_TICKS == 0:
                        # one-line handler: a wrapped form would duplicate M10's find string
                        try:
                            found = self.env_scan_tree()
                        except PsError as e: return self.lost_measure(e)
                        # the finds join the remembered roots the sum below counts (A15)
                        for pid in found:
                            for q in tree(procs, pid, sups):
                                self.last_tree[q] = procs[q][4]
                counted = tick_pids(procs, self.child.pid, self.last_tree, sups)
                rss_kb = self.mem_kb(procs, counted)
                self.peak_kb = max(self.peak_kb, rss_kb)
                self.remember_tree(procs)
                oom_prev = self.oom_seen
                self.oom_seen = max(self.oom_seen, self.oom_events() or 0)
                if self.escalate_at is not None:
                    live = dict(self.last_tree)
                    live.update((p, s) for p, s in self.term_targets.items() if p in procs and procs[p][4] == s)
                    if self.window_guard(live, procs):
                        self.window_kill(live, self.signal_tree)
                        self.escalate_at = None
                        continue
                if rss_kb > cap_kb and not mute_mem:
                    self.terminate("mem")
                    # RSS counts warm file pages the cgroup does not charge: with MemoryMax = mem_mb
                    # either limit may act first; the kernel's oom_kill grown on this very tick
                    # makes the verdict the kernel's (T106)
                    if self.oom_seen > oom_prev:
                        return self.kernel_oom(self.child.returncode)
                    if self.window_growth:
                        sys.stderr.write("RUNLIMITS: %s killed: mem %.0f MB > %d MB, then grew more than 10%% over %.0f MB"
                                         " to %.0f MB during the stop window (profile %s)\n"
                                         % (self.label, rss_kb / 1024.0, self.spec["mem_mb"], self.window_growth[0] / 1024.0,
                                            self.window_growth[1] / 1024.0, self.profile))
                    elif self.sparing_mem:
                        sys.stderr.write("RUNLIMITS: %s killed: mem %.0f MB > %d MB, then %.0f MB during the stop, nested"
                                         " supervisors not spared (profile %s)\n"
                                         % (self.label, rss_kb / 1024.0, self.spec["mem_mb"], self.sparing_mem / 1024.0,
                                            self.profile))
                    else:
                        sys.stderr.write("RUNLIMITS: %s killed: mem %.0f MB > %d MB (profile %s)\n"
                                         % (self.label, rss_kb / 1024.0, self.spec["mem_mb"], self.profile))
                    return self.finish(EXIT_MEM, "mem", "watchdog")
                if now - self.t0 > cap_s and not mute_time:
                    self.terminate("time")
                    sys.stderr.write("RUNLIMITS: %s killed: time %.1f s > %d s (profile %s)\n"
                                     % (self.label, now - self.t0, cap_s, self.profile))
                    return self.finish(EXIT_TIME, "time", "watchdog")
            if self.tty is not None:
                self.job_control()
            if tick_after:
                # wait() would reap the zombie before the knob's probe at the loop top can see the death
                time.sleep(max(0.01, min(next_tick - time.time(), 0.1)))
            else:
                try:
                    self.child.wait(timeout=max(0.01, min(next_tick - time.time(), 0.1)))
                except subprocess.TimeoutExpired:
                    pass
        # a forwarded TERM/HUP: descendants that outlive the child still get the SIGKILL
        next_tick = 0.0
        while self.escalate_at is not None and not self.tree_gone(self.term_targets):
            if time.time() >= self.escalate_at:
                self.escalate()
                break
            if time.time() >= next_tick:
                next_tick = time.time() + TICK_S
                live = self.recheck(self.term_targets)
                if self.window_guard(live):
                    self.window_kill(live, self.signal_tree)
                    self.escalate_at = None
                    break
            time.sleep(0.1)
        rc = self.child.returncode
        code = rc if rc >= 0 else 128 - rc
        self.tty_give_back()
        # read before the sweep: survivors keep the scope's cgroup (and memory.events) alive
        events = self.oom_events()
        if events is None and self.oom_seen:
            events = self.oom_seen
        # the sweep's own SIGKILLs hit survivors, not the child: decide from the state before it
        killed_by_us = self.sent_kill
        self.sweep()
        self.reap_leftovers()  # A12: exit path
        cause, what = self.kernel_sign(events)
        if cause == "oom":
            return self.kernel_oom(rc)
        if cause == "timeout":
            sys.stderr.write("RUNLIMITS: %s killed: time (kernel RuntimeMaxSec) > %d s (profile %s)\n"
                             % (self.label, self.spec["runtime_s"] + KERNEL_RUNTIME_MARGIN_S, self.profile))
            return self.finish(EXIT_TIME, "time", "kernel", {"child_exit": code})
        if rc == -signal.SIGKILL and not killed_by_us:
            sys.stderr.write("RUNLIMITS: %s killed: SIGKILL not sent by the supervisor, cause unverified (%s)\n"
                             % (self.label, what))
            return self.finish(code, "unverified")
        if cause is None and self.plat == "linux" and rc != -signal.SIGKILL:
            # an unreadable oom sign with a self-exited child: the code passes, the verdict does not (A8)
            sys.stderr.write("RUNLIMITS: %s: oom sign unreadable (%s); child exit %d, result not verified\n"
                             % (self.label, what, code))
            return self.finish(code, "unverified", extra={"oom_sign": what})
        if self.env_scan_lost:
            # the sweep could not look for descendants that left the tree: same form as A8 (E5)
            return self.finish(code, "unverified", extra={"env_scan": self.env_scan_lost})
        return self.finish(code, None)


def lstart_epoch(s):
    """Epoch seconds of a ps lstart string ("Mon Sep 27 03:12:45 2026"); None when unparsable."""
    try:
        return int(time.mktime(time.strptime(s, "%a %b %d %H:%M:%S %Y")))
    except ValueError:
        return None


# Linux start comes from /proc without fork: ps is the failed stop-path measure (#553).
def proc_start(pid, env=None):
    """Start time of pid in ps lstart epoch seconds - the same unit the snapshot
    carries, so identity is (pid, start) on both platforms; None when unreadable
    (the test knob RUNLIMITS_TEST_START_UNREADABLE forces it for one pid, T66)."""
    env = os.environ if env is None else env
    if knob(env, "RUNLIMITS_TEST_START_UNREADABLE") == str(pid):
        return None
    if sys.platform == "darwin":
        return darwin_start(pid, env)
    try:
        return proc_table([pid], env).get(pid, (None,) * 5)[4]
    except PsError:
        return None


def ps_start(ps, pid):
    """Start time of pid in ps lstart epoch seconds read by the ps at ps; None when unreadable."""
    try:
        r = subprocess.run([ps, "-o", "lstart=", "-p", str(pid)], stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, universal_newlines=True, timeout=PS_TIMEOUT_S,
                           env=dict(os.environ, LC_ALL="C"))
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0:
        return None
    return lstart_epoch(r.stdout.strip())


def darwin_start(pid, env):
    """Start time of pid in epoch seconds from `ps -o lstart=` (1 s precision), read
    by the same ps as the snapshot (E7, T97); None when gone."""
    ps = ps_path(env)
    return ps_start(ps, pid)


def published_supervisors(pids, registry, uid, procs=None):
    """The pids among pids that published a supervisor's mark: a runlimits-<pid>-s<start>-*
    dir in the registry (registry_dir) whose start is the pid's live start time. The
    start comes from the given snapshot when there is one (no extra ps); a mark whose
    owner is stopped or a zombie is not believed - it cannot watch its tree (A11).
    argv proves nothing: any process can carry a supervisor's command line. In a
    shared registry a name counts only as our own mark: an lstat-ed directory of
    uid, never a symlink (another user could plant a name and fake an active
    supervisor, silencing a layer)."""
    try:
        names = os.listdir(registry)
    except OSError:
        return set()
    marks = {}
    for n in names:
        m = LEFTOVER_RE.match(n)
        if m and not n.endswith(".scope"):
            try:
                st = os.lstat(os.path.join(registry, n))
            except OSError:
                continue
            if stat.S_ISDIR(st.st_mode) and st.st_uid == uid:
                marks.setdefault(int(m.group(1)), set()).add(int(m.group(2)))
    out = set()
    for p in pids:
        if p not in marks:
            continue
        if procs is not None:
            if p not in procs or procs[p][4] not in marks[p] or procs[p][5][:1] in ("T", "Z"):
                continue
        elif proc_start(p) not in marks[p]:
            continue
        out.add(p)
    return out


def owner_dead(name, procs=None):
    """True only when the name's supervisor is proven gone: its pid is definitely
    absent, or its start was read and differs from the recorded one. An unreadable
    start never kills the mark (A7)."""
    m = LEFTOVER_RE.match(name)
    if not m:
        return False
    pid, want = int(m.group(1)), int(m.group(2))
    if procs is not None:
        if pid not in procs:
            return True
        start = procs[pid][4]
    elif sys.platform != "darwin" and not os.path.exists("/proc/%d" % pid):
        return True
    else:
        start = proc_start(pid)
    return start is not None and start != want


def pid_zombie(pid):
    """True while /proc shows pid a zombie: exited but not yet reaped (Linux). Only the
    RUNLIMITS_TEST_TICK_AFTER_EXIT knob reads it, to catch the tick inside the death window."""
    try:
        with open("/proc/%d/stat" % pid) as f:
            data = f.read()
    except OSError:
        return False
    try:
        return data.rsplit(")", 1)[1].split()[0] == "Z"
    except IndexError:
        return False


# ------------------------------------------------------------------ CLI

def main(args):
    if len(args) == 2 and args[0] == "--is-active":
        try:
            profile_spec(args[1])
        except ValueError as e:
            refuse_line("is-active", str(e))
            return EXIT_UNAVAILABLE
        return 0 if is_active(profile=args[1]) else 1
    if not args or args[0] != "--wrap" or len(args) < 2:
        sys.stderr.write("usage: runlimits.py --wrap <profile> [--label <name>] -- <argv...>\n"
                         "       runlimits.py --is-active <profile>\n")
        return 2
    profile, rest = args[1], args[2:]
    label = None
    if len(rest) >= 2 and rest[0] == "--label":
        label, rest = rest[1], rest[2:]
    if not rest or rest[0] != "--":
        sys.stderr.write("runlimits.py: expected -- before the command\n")
        return 2
    argv = rest[1:]
    label = label or (os.path.basename(argv[0]) if argv else "runlimits")
    return Supervisor(profile, label, argv, dict(os.environ)).run()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
