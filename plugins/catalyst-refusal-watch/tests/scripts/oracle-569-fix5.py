#!/usr/bin/env python3
import argparse
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re
import subprocess
import sys

OUTCOMES = {
    'slash-tag-template': ('unclosed template interpolation', 2),
    'kit-canon': ('REFUSAL_RULE ambiguous: 0 declarations', 2),
}


def readable(path):
    mode = path.stat().st_mode & 0o777
    try:
        path.chmod(mode | 0o400)
        return path.read_text()
    finally:
        path.chmod(mode)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scope', required=True)
    parser.add_argument('--plugin', required=True)
    parser.add_argument('--kit', required=True)
    parser.add_argument('--cases-root', required=True)
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    plugin = Path(args.plugin)
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location('parity569', here / 'parity-569-fix1.py')
    parity = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(parity)
    names = args.scope.split(',')
    allowed = set(parity.CASES) | {'slash-tag-template', 'kit-canon'}
    if set(names) - allowed:
        parser.error('unknown oracle scope')
    root = Path(args.root)
    if not root.is_absolute() or not str(root).startswith('/var/tmp/wf569-'):
        parser.error('root must be own absolute /var/tmp/wf569-* directory')
    root.mkdir(parents=True)
    script = plugin / 'tests/scripts/check-splice-parity.sh'
    body = script.read_text().split("<<'PY'\n", 1)[1].split('kit = pathlib.Path', 1)[0]
    namespace = {}
    exec(compile(body, str(script), 'exec'), namespace)
    module_text = (plugin / 'hooks/register.ts').read_text()
    rule = json.loads(re.search(r'export const RULE_TEXT\s*=\s*("(?:[^"\\]|\\.)*")', module_text).group(1))
    good = 'const REFUSAL_RULE = ' + json.dumps(rule, ensure_ascii=False) + ';\n'
    inputs = []
    missing = []
    for name in names:
        if name == 'kit-canon':
            inputs.append({'name': name, 'text': Path(args.kit).read_text()})
        elif name == 'slash-tag-template':
            inputs.append({'name': name, 'text': 'const t = tag`${ /`/ }`;\n' + good})
        else:
            case = Path(args.cases_root) / name
            if not (case / 'kit.js').exists():
                missing.append(name)
            for label, path in [('kit', case / 'kit.js'), ('mod', case / 'hooks/register.ts')]:
                if path.exists():
                    inputs.append({'name': name + '/' + label, 'text': readable(path)})
    command = ['node', str(here / 'oracle-569-fix5.mjs'), args.kit]
    result = subprocess.run(command, input=json.dumps(inputs), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=90)
    (root / 'kit-raw.json').write_text(result.stdout)
    if result.returncode:
        print(result.stderr)
        return result.returncode
    oracle = json.loads(result.stdout)
    print('kit sha256=' + oracle['kitSha256'])
    print('extracted sha256=' + oracle['extractedSha256'])
    failed = 0
    checked = 0
    unmet = 0
    rows = []
    for item, kit in zip(inputs, oracle['results'], strict=True):
        text = item['text']
        seen = []
        decide = namespace['regex_start']
        def observed(prev):
            value = decide(prev)
            pos = inspect.currentframe().f_back.f_locals['i']
            seen.append({'pos': len(text[:pos].encode('utf-16-le')) // 2, 'mode': 'regex' if value else 'code'})
            return value
        namespace['regex_start'] = observed
        try:
            namespace['mask_noise'](text)
            error = None
        except ValueError as exc:
            error = str(exc)
        finally:
            namespace['regex_start'] = decide
        ok = seen == kit['decisions'] and item['name'] == kit['name']
        row = {'input': item['name'], 'scanner': seen, 'kit': kit['decisions'], 'match': ok, 'scanner_error': error}
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False))
        if not ok:
            print('oracle mismatch: ' + item['name'])
        failed += not ok
        if item['name'] in OUTCOMES:
            fixture = root / (item['name'] + '.js')
            fixture.write_text(text)
            env = os.environ.copy()
            env['CATALYST_PATCH_KIT'] = str(fixture)
            measured = subprocess.run(['bash', str(script)], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            print(item['name'] + ' actual: ' + measured.stdout.strip() + ' RC=' + str(measured.returncode))
            want, code = OUTCOMES[item['name']]
            held = measured.returncode == code and want in measured.stdout
            print(item['name'] + (' outcome ok' if held else ' outcome mismatch: expected ' + want + ' RC=' + str(code)))
            checked += 1
            unmet += not held
    (root / 'table.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    # CONSTRAINT: строка с пустыми обеими сторонами зеленеет молча — каждая обязана быть объявлена в EXPECT_EMPTY с основанием из байтов входа; основание перестало держаться — красная как stale.
    EXPECT_EMPTY = {
        'good/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'two-literals/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'comment-literal/kit': 'оба байта 0x2f — пара // строчного комментария, кодовых слэшей нет',
        'duplicate-pin/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'duplicate-rule/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'single-quote/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'backtick/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'comment-backtick/kit': 'оба байта 0x2f — пара // строчного комментария, кодовых слэшей нет',
        'absent/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'missing-kit/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'unreadable-kit/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'missing-mod/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'unreadable-mod/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'no-rule/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'no-pin/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'bad-byte/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'pin-backtick/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'rule-backtick/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'destructured-object/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'destructured-array/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'typed-rule/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'nested-kit-object/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'nested-kit-array/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'nested-mod-object/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'nested-mod-array/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'nested-alone/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'nested-depth3/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'line-comment-ls/kit': 'оба байта 0x2f — пара // строчного комментария, кодовых слэшей нет',
        'line-comment-ps/kit': 'оба байта 0x2f — пара // строчного комментария, кодовых слэшей нет',
        'skip-string-brackets/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'skip-comment-brackets/kit': 'все 6 байтов 0x2f — пары /* */ и // комментариев, кодовых слэшей нет',
        'skip-template-brackets/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'regex-hole-mod/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'unclosed-block-comment/kit': 'единственный байт 0x2f — открывашка /* незакрытого комментария, кодовых слэшей нет',
        'unclosed-string-double/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'unclosed-string-single/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'unclosed-template/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'unclosed-template-interp/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'unclosed-bracket/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'mismatched-nested/kit': 'нет байта 0x2f — решений regex-старта не возникает',
        'mismatched-name/kit': 'нет байта 0x2f — решений regex-старта не возникает',
    }
    vacuous = []
    stale = []
    for row in rows:
        if not row['scanner'] and not row['kit']:
            if row['input'] not in EXPECT_EMPTY:
                vacuous.append(row['input'] + ' scanner=0 kit=0')
        elif row['input'] in EXPECT_EMPTY:
            stale.append(row['input'])
        if row['input'] == 'kit-canon' and not (row['scanner'] and row['kit']):
            vacuous.append('kit-canon scanner=' + str(len(row['scanner'])) + ' kit=' + str(len(row['kit'])))
    totals = {side: sum(len(row[side]) for row in rows) for side in ('scanner', 'kit')}
    vacuous += [side + ' total=0' for side, total in totals.items() if total == 0]
    for name in missing:
        print('oracle missing case: ' + name)
    for reason in vacuous:
        print('oracle vacuous: ' + reason)
    for name in stale:
        print('oracle stale expect-empty: ' + name)
    print('oracle cases=' + str(len(names)) + ' sources=' + str(len(inputs)) + ' green=' + str(len(inputs) - failed) + ' red=' + str(failed) + ' outcomes=' + str(checked - unmet) + '/' + str(checked) + ' decisions scanner=' + str(totals['scanner']) + ' kit=' + str(totals['kit']))
    return int(failed > 0 or unmet > 0 or bool(vacuous) or bool(missing) or bool(stale))


if __name__ == '__main__':
    sys.exit(main())
