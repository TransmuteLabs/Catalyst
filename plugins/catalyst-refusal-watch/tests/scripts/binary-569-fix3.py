#!/usr/bin/env python3
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scope', required=True, choices=['swap-after-version'])
    parser.add_argument('--plugin', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--mutate', action='store_true')
    args = parser.parse_args()
    root = Path(args.root)
    if not root.is_absolute() or not str(root).startswith('/var/tmp/wf569-'):
        parser.error('root must be own absolute /var/tmp/wf569-* directory')
    root.mkdir(parents=True)
    plugin = root / 'plugin'
    shutil.copytree(args.plugin, plugin)
    runner = plugin / 'tests/scripts/run-569-controls.py'
    if args.mutate:
        text = runner.read_text()
        old = "invoke([binary, 'plugin', command, str(plug)]"
        if text.count(old) != 1: raise ValueError('binary-copy mutation premise')
        runner.write_text(text.replace(old, "invoke([args.binary, 'plugin', command, str(plug)]"))
    binary = root / 'supplied-binary'
    replacement = '#!' + sys.executable + '\nprint("FIX3 ORIGINAL REPLACEMENT 2.1.284")\n'
    program = '#!' + sys.executable + '\n' + '''import os
from pathlib import Path
import sys
original = Path(''' + repr(str(binary)) + ''')
if sys.argv[1:] == ['--version']:
    original.write_text(''' + repr(replacement) + ''')
    original.chmod(0o700)
    print('2.1.285 (copy-window fixture)')
else:
    print('FIX3 EXECUTED 2.1.285')
    print('FIX3 MODE=' + oct(Path(sys.argv[0]).stat().st_mode & 0o777))
    print('FIX3 EXEC_PATH=' + sys.argv[0])
'''
    binary.write_text(program)
    binary.chmod(0o700)
    expected_sha = hashlib.sha256(program.encode()).hexdigest()
    env = os.environ.copy()
    for key, dirname in [('HOME', 'home'), ('TMPDIR', 'tmp'), ('CLAUDE_CONFIG_DIR', 'config')]:
        path = root / dirname
        path.mkdir()
        env[key] = str(path)
    command = [sys.executable, str(runner), '--scope', 'after', '--root', str(root / 'run'), '--binary', str(binary), '--binary-sha256', expected_sha]
    result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=90)
    out = result.stdout
    raw = out + '\nrunner RC=' + str(result.returncode) + '\n'
    print(raw)
    (root / 'runner.log').write_text(raw)
    ok = result.returncode == 0 and '2.1.285 (copy-window fixture)' in out and 'FIX3 EXECUTED 2.1.285' in out and 'FIX3 ORIGINAL REPLACEMENT' not in out
    ok = ok and 'FIX3 MODE=0o500' in out and 'sha256=' + expected_sha in out
    paths = [line.split('FIX3 EXEC_PATH=', 1)[1] for line in out.splitlines() if 'FIX3 EXEC_PATH=' in line]
    ok = ok and len(paths) == 1 and paths[0] != str(binary) and str(root / 'run') in paths[0]
    ok = ok and binary.read_text() == replacement
    tooth = subprocess.run([sys.executable, '-c', 'import sys; assert sys.argv[1] == "True", "binary-copy-window-569: replaced original never executes; copy version sha and 0500"', str(ok)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    print(tooth.stdout + 'tooth RC=' + str(tooth.returncode))
    (root / 'tooth.log').write_text(tooth.stdout + '\ntooth RC=' + str(tooth.returncode) + '\n')
    return tooth.returncode


if __name__ == '__main__':
    sys.exit(main())
