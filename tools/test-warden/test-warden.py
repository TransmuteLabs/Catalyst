#!/usr/bin/env python3
"""test-warden: memory warden for test runs on the mac (python3 stdlib only).

Scope: a process is a "test run" process when it or any ancestor matches one of
the argv forms in classify(). Interactive `claude` sessions never match, and
neither do their descendants unless a matching process sits in between.

Rules, in order, each tick (thresholds from env, see Config):
  P1  scope process RSS > TW_PROC_MB            -> SIGKILL it and its descendants
  P2  scope RSS sum > TW_TOTAL_MB               -> SIGKILL the largest, repeat
      (the sum overstates real use: see the constraint at Config.total_mb)
  P3  system free < TW_FREE_MB, scope not empty -> SIGKILL the largest
  P4  process that itself matched a test form, age > TW_AGE_S -> SIGKILL
      (runners — python / shell scripts — are never killed by age)

Modes: --dry-run (journal only), --once (one tick; prints the scope census).
Test-only knobs (honoured only when TW_LOG_DIR is not the combat dir; in the
combat dir they are ignored and listed in the start line's ignored_env):
TW_FAKE_FREE_MB, TW_SANDBOX_TOKEN, TW_TEST_PS, TW_TEST_KILL_DELAY_S,
TW_TEST_KILL_ERRNO, TW_TEST_ROTATE_BYTES, TW_TEST_HEARTBEAT_S.

Must run on /usr/bin/python3 (3.9): no 3.10+ syntax.
"""
import errno
import fnmatch
import json
import os
import re
import signal
import subprocess
import sys
import time
import traceback

COMBAT_LOG_DIR = os.path.join(os.path.expanduser("~"), "Library", "Logs", "test-warden")
ROTATE_BYTES = 5 * 1024 * 1024
HEARTBEAT_S = 600
ARGV_MAX = 300
ERROR_REPEAT_S = 60
PS_BIN = "/bin/ps"
TEST_KNOBS = ("TW_FAKE_FREE_MB", "TW_SANDBOX_TOKEN", "TW_TEST_PS", "TW_TEST_KILL_DELAY_S",
              "TW_TEST_KILL_ERRNO", "TW_TEST_ROTATE_BYTES", "TW_TEST_HEARTBEAT_S")

SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}
PY_RUNNER_GLOBS = ("mut*.py", "*mut-runner*.py", "*teeth*.py")
SH_RUNNER_GLOBS = ("test-*.sh", "*-teeth.sh", "*-bench.sh")
TEST_TOOLS = {"vitest", "vitest.mjs", "jest", "jest.js", "pytest", "py.test"}
JS_INTERPRETERS = re.compile(r"^(node\d*|bun|deno)$")
PY_INTERPRETER = re.compile(r"^python\d*(\.\d+)?$", re.IGNORECASE)
NEVER = {"target-warden"}


class Config(object):
    def __init__(self, env, argv):
        self.dry_run = "--dry-run" in argv
        self.once = "--once" in argv
        self.interval = float(env.get("TW_INTERVAL", "1.0"))
        self.proc_mb = float(env.get("TW_PROC_MB", "4096"))
        # RSS counts pages shared between processes (the claude binary image,
        # mapped libraries) once per process, so the scope sum overstates real
        # use: one normal `plugin test` run sums ~2.6 GB across its --file
        # workers. P2 is only a backstop for many parallel runs; real memory
        # pressure is P3's job (vm_stat free pages).
        self.total_mb = float(env.get("TW_TOTAL_MB", "16384"))
        self.free_mb = float(env.get("TW_FREE_MB", "1536"))
        self.age_s = float(env.get("TW_AGE_S", "1200"))
        self.log_dir = os.path.abspath(os.path.expanduser(env.get("TW_LOG_DIR", COMBAT_LOG_DIR)))
        self.test_mode = os.path.realpath(self.log_dir) != os.path.realpath(COMBAT_LOG_DIR)
        self.ignored = []
        self.fake_free_mb = None
        self.sandbox = None
        self.ps_bin = PS_BIN
        self.kill_delay_s = 0.0
        self.kill_errno = None
        self.rotate_bytes = ROTATE_BYTES
        self.heartbeat_s = float(HEARTBEAT_S)
        for key in TEST_KNOBS:
            if key in env and not self.test_mode:
                self.ignored.append(key)
        if self.test_mode:
            if env.get("TW_FAKE_FREE_MB"):
                self.fake_free_mb = float(env["TW_FAKE_FREE_MB"])
            if env.get("TW_SANDBOX_TOKEN"):
                self.sandbox = env["TW_SANDBOX_TOKEN"]
            if env.get("TW_TEST_PS"):
                self.ps_bin = env["TW_TEST_PS"]
            if env.get("TW_TEST_KILL_DELAY_S"):
                self.kill_delay_s = float(env["TW_TEST_KILL_DELAY_S"])
            if env.get("TW_TEST_KILL_ERRNO"):
                name = env["TW_TEST_KILL_ERRNO"]
                if not hasattr(errno, name):
                    raise ValueError("TW_TEST_KILL_ERRNO: unknown errno name %r" % name)
                self.kill_errno = name
            if env.get("TW_TEST_ROTATE_BYTES"):
                self.rotate_bytes = int(env["TW_TEST_ROTATE_BYTES"])
            if env.get("TW_TEST_HEARTBEAT_S"):
                self.heartbeat_s = float(env["TW_TEST_HEARTBEAT_S"])

    def describe(self):
        return {
            "dry_run": self.dry_run, "once": self.once, "interval": self.interval,
            "proc_mb": self.proc_mb, "total_mb": self.total_mb, "free_mb": self.free_mb,
            "age_s": self.age_s, "log_dir": self.log_dir, "test_mode": self.test_mode,
            "fake_free_mb": self.fake_free_mb, "sandbox": self.sandbox,
            "ps_bin": self.ps_bin, "kill_delay_s": self.kill_delay_s,
            "kill_errno": self.kill_errno, "rotate_bytes": self.rotate_bytes,
            "heartbeat_s": self.heartbeat_s, "ignored_env": self.ignored,
        }


class Proc(object):
    __slots__ = ("pid", "ppid", "uid", "rss_mb", "age_s", "command", "words", "form")

    def __init__(self, pid, ppid, uid, rss_kb, age_s, command):
        self.pid = pid
        self.ppid = ppid
        self.uid = uid
        self.rss_mb = rss_kb / 1024.0
        self.age_s = age_s
        self.command = command
        self.words = command.split()
        self.form = classify(self.words)


# ------------------------------------------------------------------ argv forms

def base(word):
    return os.path.basename(word)


def matches(name, globs):
    return any(fnmatch.fnmatchcase(name, g) for g in globs)


def python_target(words):
    """('script', path) | ('module', name) | ('code', None) | None."""
    i = 1
    while i < len(words):
        w = words[i]
        if w == "--":
            i += 1
            break
        if w == "-" or not w.startswith("-"):
            break
        if w.startswith("--"):
            i += 2 if w == "--check-hash-based-pycs" else 1
            continue
        flags = w[1:]
        for j, ch in enumerate(flags):
            rest = flags[j + 1:]
            if ch == "c":
                return ("code", None)
            if ch == "m":
                mod = rest or (words[i + 1] if i + 1 < len(words) else "")
                return ("module", mod)
            if ch in "XW":
                if not rest:
                    i += 1
                break
        i += 1
    if i < len(words):
        return ("script", words[i])
    return None


def shell_script(words):
    i = 1
    while i < len(words):
        w = words[i]
        if w == "--":
            i += 1
            break
        if w in ("-o", "+o", "-O", "+O", "--rcfile", "--init-file"):
            i += 2
            continue
        if w.startswith("--"):
            i += 1
            continue
        if (w.startswith("-") or w.startswith("+")) and len(w) > 1:
            if "c" in w[1:]:
                return None
            i += 1
            continue
        break
    if i < len(words):
        return words[i]
    return None


def js_operand(words):
    for w in words[1:]:
        if w == "--":
            continue
        if not w.startswith("-"):
            return w
    return None


def classify(words):
    """None | ('test', desc) | ('runner', desc).

    'test' = the forms P4 may kill by age; 'runner' = python/shell scripts."""
    if not words:
        return None
    a0 = base(words[0])
    if len(words) >= 3 and words[1] == "plugin" and words[2] == "test":
        return ("test", "plugin test")
    if a0 in TEST_TOOLS:
        return ("test", a0)
    if JS_INTERPRETERS.match(a0):
        if a0.startswith("node") and "--test" in words[1:]:
            return ("test", "node --test")
        if a0 == "bun" and len(words) >= 2 and words[1] == "test":
            return ("test", "bun test")
        op = js_operand(words)
        if op is not None and base(op) in TEST_TOOLS:
            return ("test", base(op))
        return None
    if PY_INTERPRETER.match(a0):
        t = python_target(words)
        if t is None:
            return None
        kind, val = t
        if kind == "module" and val == "pytest":
            return ("test", "python -m pytest")
        if kind == "script":
            name = base(val)
            if name in TEST_TOOLS:
                return ("test", name)
            if matches(name, PY_RUNNER_GLOBS):
                return ("runner", "python " + name)
        return None
    if a0 in SHELLS:
        s = shell_script(words)
        if s is not None and matches(base(s), SH_RUNNER_GLOBS):
            return ("runner", "shell " + base(s))
        return None
    if matches(a0, SH_RUNNER_GLOBS):
        return ("runner", "shell " + a0)
    return None


# ------------------------------------------------------------------ system probes

class ProbeError(Exception):
    pass


def parse_etime(s):
    days = 0
    if "-" in s:
        d, s = s.split("-", 1)
        days = int(d)
    parts = [int(p) for p in s.split(":")]
    secs = 0
    for p in parts:
        secs = secs * 60 + p
    return days * 86400 + secs


def snapshot(ps_bin=PS_BIN):
    r = subprocess.run([ps_bin, "-axo", "pid=,ppid=,uid=,rss=,etime=,command="],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise ProbeError("ps rc=%d stderr=%r" % (r.returncode, r.stderr.decode("utf-8", "replace")[:300]))
    uid = os.getuid()
    procs = {}
    for line in r.stdout.decode("utf-8", "replace").splitlines():
        f = line.split(None, 5)
        if len(f) < 5:
            continue
        try:
            p = Proc(int(f[0]), int(f[1]), int(f[2]), int(f[3]), parse_etime(f[4]),
                     f[5] if len(f) > 5 else "")
        except ValueError:
            continue
        if p.uid == uid:
            procs[p.pid] = p
    if not procs:
        raise ProbeError("ps returned no processes of uid %d" % uid)
    return procs


def recheck(pids, ps_bin=PS_BIN):
    """pid -> (uid, command) for pids still present."""
    if not pids:
        return {}
    r = subprocess.run([ps_bin, "-o", "pid=,uid=,command=", "-p", ",".join(str(p) for p in pids)],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    # ps exits 1 when some of the pids are gone; that is data, not an error.
    if r.returncode not in (0, 1) or r.stderr.strip():
        raise ProbeError("ps -p rc=%d stderr=%r" % (r.returncode, r.stderr.decode("utf-8", "replace")[:300]))
    out = {}
    for line in r.stdout.decode("utf-8", "replace").splitlines():
        f = line.split(None, 2)
        if len(f) < 2:
            continue
        out[int(f[0])] = (int(f[1]), f[2] if len(f) > 2 else "")
    return out


def free_mb():
    r = subprocess.run(["/usr/bin/vm_stat"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise ProbeError("vm_stat rc=%d stderr=%r" % (r.returncode, r.stderr.decode("utf-8", "replace")[:300]))
    text = r.stdout.decode("utf-8", "replace")
    m = re.search(r"page size of (\d+) bytes", text)
    if not m:
        raise ProbeError("vm_stat: no page size")
    page = int(m.group(1))
    pages = 0
    for key in ("Pages free", "Pages inactive", "Pages speculative", "Pages purgeable"):
        m = re.search(r"^%s:\s+(\d+)\." % re.escape(key), text, re.M)
        if not m:
            raise ProbeError("vm_stat: no %r" % key)
        pages += int(m.group(1))
    return pages * page / 1048576.0


# ------------------------------------------------------------------ journal

class Journal(object):
    def __init__(self, log_dir, rotate_bytes=ROTATE_BYTES):
        self.dir = log_dir
        self.rotate_bytes = rotate_bytes
        self.beat = 0
        self.path = os.path.join(log_dir, "events.jsonl")
        self.state = os.path.join(log_dir, "state.json")
        os.makedirs(log_dir, exist_ok=True)

    def write(self, event, **fields):
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "event": event}
        rec.update(fields)
        line = json.dumps(rec, ensure_ascii=False) + "\n"
        try:
            if os.path.getsize(self.path) > self.rotate_bytes:
                os.replace(self.path, self.path + ".1")
        except FileNotFoundError:
            pass
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(line)

    def heartbeat(self, **fields):
        self.beat += 1
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "beat": self.beat}
        rec.update(fields)
        tmp = self.state + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, self.state)


# ------------------------------------------------------------------ warden

def excerpt(cmd):
    return cmd[:ARGV_MAX]


class Warden(object):
    def __init__(self, cfg, journal):
        self.cfg = cfg
        self.j = journal
        self.me = os.getpid()
        self.reported = set()
        self.last_error = {}
        self.last_heartbeat = 0.0
        self.ticks = 0

    def error(self, where, exc, key=None, **fields):
        """Journal an error; the same key repeats at most once per ERROR_REPEAT_S."""
        key = where if key is None else key
        now = time.time()
        if now - self.last_error.get(key, 0.0) >= ERROR_REPEAT_S:
            self.last_error[key] = now
            self.j.write("error", where=where, detail=str(exc)[:600], **fields)

    def send_kill(self, pid):
        if self.cfg.kill_errno is not None:
            code = getattr(errno, self.cfg.kill_errno)
            raise OSError(code, os.strerror(code))
        os.kill(pid, signal.SIGKILL)

    def excluded(self, p, procs):
        if p.pid in (0, 1, self.me):
            return True
        if p.words and base(p.words[0]) in NEVER:
            return True
        cur, seen = p, set()
        while cur is not None and cur.pid not in seen:
            if cur.ppid == self.me:
                return True
            seen.add(cur.pid)
            cur = procs.get(cur.ppid)
        return False

    def matched_ancestor(self, p, procs, memo):
        """Nearest process on the chain self -> ancestors that matched a form."""
        chain, cur, found = [], p, None
        while cur is not None and cur.pid not in (0, 1):
            if cur.pid in memo:
                found = memo[cur.pid]
                break
            chain.append(cur.pid)
            if cur.form is not None:
                found = cur
                break
            up = procs.get(cur.ppid)
            if up is not None and up.pid in chain:
                break
            cur = up
        for pid in chain:
            memo[pid] = found
        return found

    def in_sandbox(self, p, procs):
        cur, seen = p, set()
        while cur is not None and cur.pid not in seen and cur.pid not in (0, 1):
            if self.cfg.sandbox in cur.command:
                return True
            seen.add(cur.pid)
            cur = procs.get(cur.ppid)
        return False

    def scope(self, procs):
        """pid -> matched ancestor Proc, for every scope process."""
        memo, area = {}, {}
        for p in procs.values():
            if self.excluded(p, procs):
                continue
            m = self.matched_ancestor(p, procs, memo)
            if m is None:
                continue
            if self.cfg.sandbox is not None and not self.in_sandbox(p, procs):
                continue
            area[p.pid] = m
        return area

    def descendants(self, pid, procs):
        kids = {}
        for p in procs.values():
            kids.setdefault(p.ppid, []).append(p.pid)
        out, stack = [], list(kids.get(pid, []))
        while stack:
            c = stack.pop()
            if c in out or c == pid:
                continue
            out.append(c)
            stack.extend(kids.get(c, []))
        return out

    def kill_tree(self, victim, rule, procs, area, reason):
        """Kill victim + descendants; returns the pids removed from consideration."""
        targets = [victim.pid] + [d for d in self.descendants(victim.pid, procs)
                                  if d in procs and not self.excluded(procs[d], procs)]
        if self.cfg.kill_delay_s:
            time.sleep(self.cfg.kill_delay_s)
        try:
            now_seen = recheck(targets, self.cfg.ps_bin)
        except (ProbeError, OSError) as e:
            self.error("recheck", e)
            return set(targets)
        for pid in targets:
            p = procs[pid]
            m = area.get(pid)
            rec = dict(rule=rule, pid=pid, rss_mb=round(p.rss_mb, 1), age_s=p.age_s,
                       argv=excerpt(p.command), reason=reason,
                       matched=None if m is None else {"pid": m.pid, "argv": excerpt(m.command),
                                                      "form": m.form[1]},
                       victim=victim.pid, dry_run=self.cfg.dry_run)
            cur = now_seen.get(pid)
            if cur is None:
                if pid != victim.pid:
                    continue
                self.j.write("skip", why="gone before kill", **rec)
                continue
            if cur != (p.uid, p.command):
                self.j.write("skip", why="pid reused or argv changed", now_argv=excerpt(cur[1]), **rec)
                continue
            if self.cfg.dry_run:
                key = (pid, rule, p.command)
                if key not in self.reported:
                    self.reported.add(key)
                    self.j.write("kill", **rec)
                continue
            try:
                self.send_kill(pid)
            except OSError as kill_err:
                name = errno.errorcode.get(kill_err.errno, str(kill_err.errno))
                self.error("kill", kill_err, key=("kill", pid, name), errno=name, **rec)
                continue
            self.j.write("kill", **rec)
        return set(targets)

    def tick(self):
        cfg = self.cfg
        self.ticks += 1
        try:
            procs = snapshot(cfg.ps_bin)
        except (ProbeError, OSError) as e:
            self.error("snapshot", e)
            return None
        area = self.scope(procs)
        live = set(area)

        def total():
            return sum(procs[p].rss_mb for p in live)

        def largest():
            return max((procs[p] for p in live), key=lambda q: q.rss_mb)

        for pid in sorted(live, key=lambda q: -procs[q].rss_mb):
            if pid in live and procs[pid].rss_mb > cfg.proc_mb:
                live -= self.kill_tree(procs[pid], "P1", procs, area,
                                       "rss %.0f MB > %.0f" % (procs[pid].rss_mb, cfg.proc_mb))

        while live and total() > cfg.total_mb:
            t = total()
            live -= self.kill_tree(largest(), "P2", procs, area,
                                   "scope sum %.0f MB > %.0f" % (t, cfg.total_mb))

        fm = None
        if cfg.fake_free_mb is not None:
            fm = cfg.fake_free_mb
        else:
            try:
                fm = free_mb()
            except (ProbeError, OSError) as e:
                self.error("vm_stat", e)
        if fm is not None and fm < cfg.free_mb and live:
            live -= self.kill_tree(largest(), "P3", procs, area,
                                   "free %.0f MB < %.0f" % (fm, cfg.free_mb))

        for pid in sorted(live):
            p = procs[pid]
            if pid in live and area[pid] is p and p.form[0] == "test" and p.age_s > cfg.age_s:
                live -= self.kill_tree(p, "P4", procs, area,
                                       "age %d s > %.0f" % (p.age_s, cfg.age_s))

        now = time.time()
        if now - self.last_heartbeat >= cfg.heartbeat_s:
            self.last_heartbeat = now
            try:
                self.j.heartbeat(pid=self.me, ticks=self.ticks, scope_count=len(area),
                                 scope_rss_mb=round(sum(procs[p].rss_mb for p in area), 1),
                                 free_mb=None if fm is None else round(fm, 1), dry_run=cfg.dry_run)
            except OSError as e:
                self.error("heartbeat", e)
        return procs, area, fm


_stop = []


def _on_signal(signum, frame):
    _stop.append(signum)


def main(argv):
    cfg = Config(os.environ, argv[1:])
    journal = Journal(cfg.log_dir, cfg.rotate_bytes)
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGHUP, _on_signal)
    w = Warden(cfg, journal)
    journal.write("start", pid=w.me, config=cfg.describe())
    reason = "once"
    try:
        if cfg.once:
            res = w.tick()
            if res is not None:
                procs, area, fm = res
                print("scope %d processes, %.0f MB; free %s MB" % (
                    len(area), sum(procs[p].rss_mb for p in area),
                    "?" if fm is None else "%.0f" % fm))
                for pid in sorted(area):
                    p, m = procs[pid], area[pid]
                    print("  pid %d rss %.0f MB age %d s matched %d [%s] argv %s" % (
                        pid, p.rss_mb, p.age_s, m.pid, m.form[1], excerpt(p.command)[:160]))
        else:
            while not _stop:
                w.tick()
                if _stop:
                    break
                time.sleep(cfg.interval)
            reason = "signal %d" % _stop[0]
    except Exception:
        journal.write("stop", pid=w.me, reason="crash", detail=traceback.format_exc()[-2000:])
        raise
    journal.write("stop", pid=w.me, reason=reason)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
