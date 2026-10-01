#!/usr/bin/env python3
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

CASES = ['fresh-copy', 'symlink', 'wrong-version', 'relative', 'missing-argument']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scope', required=True)
    parser.add_argument('--runner', required=True)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--mutate', choices=['follow-symlink', 'ignore-version', 'accept-relative'])
    args = parser.parse_args()
    names = args.scope.split(',')
    if set(names) - set(CASES):
        parser.error('unknown binary scope')
    root = Path(args.root)
    if not root.is_absolute() or not str(root).startswith('/var/tmp/wf569-'):
        parser.error('root must be own absolute /var/tmp/wf569-* directory')
    root.mkdir(parents=True)
    failed = 0
    for name in names:
        case = root / name
        case.mkdir()
        binary = case / '2.1.285'
        if name == 'fresh-copy': shutil.copy2(args.binary, binary)
        if name == 'symlink': binary.symlink_to(args.binary)
        if name == 'wrong-version':
            binary.write_text('#!/bin/sh\nprintf "2.1.284 (fixture)\\n"\n')
            binary.chmod(0o700)
        runner = Path(args.runner)
        if args.mutate:
            text = runner.read_text()
            old, new = {
                'follow-symlink': ('path.lstat().st_mode', 'path.stat().st_mode'),
                'ignore-version': ("        if rc != 0 or not out.split() or out.split()[0] != '2.1.285':\n            return False\n", "        if False:\n            pass\n"),
                'accept-relative': ('\n    if not valid_binary(args.binary, root, args.binary_sha256):\n', '\n    if False:\n'),
            }[args.mutate]
            if text.count(old) != 1: raise ValueError('binary mutation premise: ' + args.mutate)
            runner = case / 'runner.py'
            runner.write_text(text.replace(old, new))
        command = [sys.executable, str(runner), '--scope', 'binary-check', '--root', str(case)]
        if name != 'missing-argument':
            command += ['--binary', 'claude' if name == 'relative' else str(binary), '--binary-sha256', hashlib.sha256(binary.read_bytes()).hexdigest() if name != 'relative' else '0' * 64]
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=90)
        expected = 0 if name == 'fresh-copy' else 2
        message = 'explicit binary accepted' if name == 'fresh-copy' else '--binary' if name == 'missing-argument' else 'explicit binary refused before launch'
        ok = result.returncode == expected and message in result.stdout
        raw = result.stdout + '\nrunner RC=' + str(result.returncode) + '\n'
        (root / (name + '.log')).write_text(raw)
        print(name + ': ' + raw.strip())
        tooth = subprocess.run([sys.executable, '-c', 'import sys; assert sys.argv[1] == "True", "binary-contract-569: " + sys.argv[2]', str(ok), name], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        (root / (name + '-tooth.log')).write_text(tooth.stdout + '\ntooth RC=' + str(tooth.returncode) + '\n')
        print(tooth.stdout.strip() + ' tooth RC=' + str(tooth.returncode))
        failed += not ok
    print('binary inputs=' + str(len(names)) + ' green=' + str(len(names) - failed) + ' red=' + str(failed))
    return int(failed > 0)


if __name__ == '__main__':
    sys.exit(main())
