#!/usr/bin/env python3
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

CASES = ['sha-before-version', 'signal-term', 'signal-hup', 'args-kit', 'args-base']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scope', required=True)
    parser.add_argument('--plugin', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--mutate', choices=['version-before-sha', 'no-signal-handler'])
    args = parser.parse_args()
    names = args.scope.split(',')
    if set(names) - set(CASES):
        parser.error('unknown binary FIX5 scope')
    root = Path(args.root)
    if not root.is_absolute() or not str(root).startswith('/var/tmp/wf569-'):
        parser.error('root must be own absolute /var/tmp/wf569-* directory')
    root.mkdir(parents=True)
    failures = 0
    for name in names:
        case = root / name
        shutil.copytree(args.plugin, case / 'plugin')
        runner = case / 'plugin/tests/scripts/run-569-controls.py'
        if args.mutate:
            text = runner.read_text()
            if args.mutate == 'version-before-sha':
                old = "        if sha != want:\n            print('binary sha256 mismatch: ' + sha + ' != ' + want)\n            return False\n"
                anchor = "        return True\n    except (OSError, subprocess.SubprocessError)"
                if text.count(old) != 1 or text.count(anchor) != 1:
                    raise ValueError('binary FIX5 order mutation premise')
                changed = text.replace(old, '').replace(anchor, old + anchor)
            else:
                old = '            signal.signal(sig, stop569)\n'
                if text.count(old) != 1:
                    raise ValueError('binary FIX5 signal mutation premise')
                changed = text.replace(old, '            signal.getsignal(sig)\n')
            if changed == text:
                raise ValueError('inert binary FIX5 mutation')
            runner.write_text(changed)
        marker = case / 'executed'
        program = '#!' + sys.executable + '\nfrom pathlib import Path\nimport time\n'
        program += 'Path(' + repr(str(marker)) + ').write_text("version entered")\n'
        if name.startswith('signal-'):
            program += 'time.sleep(60)\n'
        program += 'print("2.1.285 (FIX5 fixture)")\n'
        binary = case / 'fixture-binary'
        binary.write_text(program)
        binary.chmod(0o700)
        sha = hashlib.sha256(program.encode()).hexdigest()
        env = os.environ.copy()
        for key, dirname in [('HOME', 'home'), ('TMPDIR', 'tmp'), ('CLAUDE_CONFIG_DIR', 'config')]:
            path = case / 'caller-env' / dirname
            path.mkdir(parents=True)
            env[key] = str(path)
        scope = {'args-kit': 'parity-current', 'args-base': 'baseline-expanded'}.get(name, 'binary-check')
        command = [sys.executable, str(runner), '--scope', scope, '--root', str(case / 'run'), '--binary', str(binary), '--binary-sha256', '0' * 64 if name == 'sha-before-version' else sha]
        if name.startswith('signal-'):
            sig = signal.SIGTERM if name == 'signal-term' else signal.SIGHUP
            child = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            try:
                deadline = time.monotonic() + 10
                while not marker.exists() and child.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.01)
                if not marker.exists():
                    raise ValueError('signal tooth did not enter version branch')
                child.send_signal(sig)
                out, _ = child.communicate(timeout=10)
                rc = child.returncode
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait()
            ok = rc == 128 + sig and ('controls signal ' + signal.Signals(sig).name) in out
        else:
            result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=20)
            rc, out = result.returncode, result.stdout
            if name == 'sha-before-version':
                ok = rc == 2 and 'binary sha256 mismatch' in out and not marker.exists()
            else:
                message = '--kit required for parity-current' if name == 'args-kit' else '--base-register required'
                ok = rc == 2 and message in out and 'error:' in out
        leftovers = [str(p.relative_to(case / 'run')) for p in (case / 'run').glob('*') if p.name.startswith('controls-version-') or p.name == 'check-env']
        ok = ok and not leftovers
        raw = out + '\nrunner RC=' + str(rc) + '\nmarker=' + str(marker.exists()) + '\nresidue=' + repr(leftovers) + '\n'
        (root / (name + '.log')).write_text(raw)
        print(name + ': ' + raw.strip())
        message = 'binary-fix5-569: ' + name
        print(('PASS ' if ok else 'FAIL ') + message)
        failures += not ok
    print('binary FIX5 inputs=' + str(len(names)) + ' green=' + str(len(names) - failures) + ' red=' + str(failures))
    return int(failures > 0)


if __name__ == '__main__':
    sys.exit(main())
