#!/usr/bin/env python3
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys


def make_fixture(path):
    program = '#!' + sys.executable + '\nprint("2.1.285 (integrity fixture)")\n'
    path.write_text(program)
    path.chmod(0o700)
    return hashlib.sha256(program.encode()).hexdigest()


def residue(root):
    bad = []
    if not root.exists():
        return bad
    for entry in sorted(root.rglob('*')):
        for part in entry.relative_to(root).parts:
            if part.startswith('controls-version-') or part in ('home', 'config', 'tmp'):
                bad.append(str(entry.relative_to(root)))
                break
    return bad


def launch(runner, binary, sha, root, log):
    env = os.environ.copy()
    for name, dirname in [('HOME', 'home'), ('CLAUDE_CONFIG_DIR', 'config'), ('TMPDIR', 'tmp')]:
        (root / 'caller-env' / dirname).mkdir(parents=True)
        env[name] = str(root / 'caller-env' / dirname)
    command = [sys.executable, str(runner), '--scope', 'binary-check', '--root', str(root / 'run'), '--binary', str(binary), '--binary-sha256', sha]
    result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=90)
    raw = result.stdout + '\nrunner RC=' + str(result.returncode) + '\n'
    print(raw.strip())
    (root / log).write_text(raw)
    return result.returncode, result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plugin', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--mutate', choices=['drop-sha-pin', 'drop-cleanup'])
    args = parser.parse_args()
    root = Path(args.root)
    if not root.is_absolute() or not str(root).startswith('/var/tmp/wf569-'):
        parser.error('root must be own absolute /var/tmp/wf569-* directory')
    root.mkdir(parents=True)
    plug = root / 'plugin'
    shutil.copytree(args.plugin, plug)
    runner = plug / 'tests/scripts/run-569-controls.py'
    binary = root / 'fixture-binary'
    sha = make_fixture(binary)
    wrong = '0' * 64
    if args.mutate == 'drop-sha-pin':
        text = runner.read_text()
        old = '        if sha != want:'
        if text.count(old) != 1:
            raise ValueError('binary-integrity sha mutation premise')
        runner.write_text(text.replace(old, '        if False and sha != want:'))
    if args.mutate == 'drop-cleanup':
        text = runner.read_text()
        old = '        cleanup569(root)'
        if text.count(old) != 1:
            raise ValueError('binary-integrity cleanup mutation premise')
        runner.write_text(text.replace(old, '        pass'))
    rc_ok, out_ok = launch(runner, binary, sha, root / 'accepted', 'accepted.log')
    ok = rc_ok == 0 and 'explicit binary accepted without test launch' in out_ok
    ok = ok and residue(root / 'accepted' / 'run') == []
    rc_no, out_no = launch(runner, binary, wrong, root / 'refused', 'refused.log')
    refused = rc_no == 2 and ('binary sha256 mismatch: ' + sha + ' != ' + wrong) in out_no
    refused = refused and residue(root / 'refused' / 'run') == []
    ok = ok and refused
    tooth = subprocess.run([sys.executable, '-c', 'import sys; assert sys.argv[1] == "True", "binary-integrity-569: sha pin and cleanup hold"', str(ok)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    print(tooth.stdout + 'tooth RC=' + str(tooth.returncode))
    (root / 'tooth.log').write_text(tooth.stdout + '\ntooth RC=' + str(tooth.returncode) + '\n')
    return tooth.returncode


if __name__ == '__main__':
    sys.exit(main())
