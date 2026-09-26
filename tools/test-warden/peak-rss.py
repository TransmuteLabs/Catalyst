#!/usr/bin/env python3
"""Peak-RSS sampler for one command, using test-warden's own scope rules.

Usage: peak-rss.py [--interval S] [--out FILE] -- cmd args...

Starts cmd, samples the whole test-warden scope every S seconds (default 0.2)
while cmd lives, and reports the peak scope RSS sum and the peak single
process (pid, argv). Exit code = cmd's exit code. Read-only: never kills.
"""
import importlib.util
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def load_warden():
    spec = importlib.util.spec_from_file_location("test_warden", os.path.join(HERE, "test-warden.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main(argv):
    interval, out = 0.2, None
    args = argv[1:]
    while args and args[0] != "--":
        if args[0] == "--interval":
            interval = float(args[1]); args = args[2:]
        elif args[0] == "--out":
            out = args[1]; args = args[2:]
        else:
            print("unknown option %r" % args[0], file=sys.stderr); return 2
    if not args or len(args) < 2:
        print(__doc__, file=sys.stderr); return 2
    cmd = args[1:]
    tw = load_warden()
    cfg = tw.Config({}, [])
    w = tw.Warden.__new__(tw.Warden)
    w.cfg, w.j, w.reported, w.last_error, w.last_heartbeat = cfg, None, set(), {}, 0.0
    # the command is our child; our own pid must not hide it from the scope
    w.me = -1
    t0 = time.time()
    child = subprocess.Popen(cmd)
    peak_sum, peak_sum_at, peak_proc, samples, errors = 0.0, None, None, 0, []
    while True:
        rc = child.poll()
        try:
            procs = tw.snapshot()
            area = w.scope(procs)
            s = sum(procs[p].rss_mb for p in area)
            samples += 1
            if s > peak_sum:
                peak_sum, peak_sum_at = s, round(time.time() - t0, 2)
            for p in area:
                q = procs[p]
                if peak_proc is None or q.rss_mb > peak_proc["rss_mb"]:
                    peak_proc = {"pid": q.pid, "rss_mb": round(q.rss_mb, 1), "argv": q.command[:300],
                                 "at_s": round(time.time() - t0, 2), "matched": area[p].pid}
        except tw.ProbeError as e:
            errors.append(str(e))
        if rc is not None:
            break
        time.sleep(interval)
    res = {"cmd": cmd, "rc": rc, "wall_s": round(time.time() - t0, 2), "samples": samples,
           "interval_s": interval, "peak_scope_sum_mb": round(peak_sum, 1),
           "peak_scope_sum_at_s": peak_sum_at, "peak_process": peak_proc, "probe_errors": errors[:5]}
    text = json.dumps(res, indent=2, ensure_ascii=False)
    print(text)
    if out:
        with open(out, "w") as f:
            f.write(text + "\n")
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
