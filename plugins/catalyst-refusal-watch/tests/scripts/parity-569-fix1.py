#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

CASES = ['good', 'two-literals', 'comment-literal', 'duplicate-pin', 'duplicate-rule', 'single-quote', 'backtick', 'comment-backtick', 'absent', 'missing-kit', 'unreadable-kit', 'missing-mod', 'unreadable-mod', 'no-rule', 'no-pin', 'bad-byte', 'pin-backtick', 'rule-backtick', 'destructured-object', 'destructured-array', 'typed-rule']
NESTED_CASES = ['nested-kit-object', 'nested-kit-array', 'nested-mod-object', 'nested-mod-array', 'nested-alone', 'nested-depth3']
SKIP_CASES = ['skip-string-brackets', 'skip-comment-brackets', 'skip-template-brackets']
NESTED_CASES += ['line-comment-ls', 'line-comment-ps']
REGEX_CASES = ['regex-hole', 'regex-hole-mod', 'regex-in-interp', 'division-chain', 'division-newline']
UNCLOSED_CASES = ['unclosed-block-comment', 'unclosed-string-double', 'unclosed-string-single', 'unclosed-template', 'unclosed-template-interp', 'unclosed-regex-lineend', 'unclosed-regex-eof', 'unclosed-bracket']
UNCLOSED_KIND = {
    'unclosed-block-comment': 'block comment',
    'unclosed-string-double': 'string',
    'unclosed-string-single': 'string',
    'unclosed-template': 'template',
    'unclosed-template-interp': 'template interpolation',
    'unclosed-regex-lineend': 'regex',
    'unclosed-regex-eof': 'regex',
    'unclosed-bracket': 'bracket',
}
SLASH_CASES = {
    'slash-property': ('x.delete / const { REFUSAL_RULE } = s; / y', 'unclosed regex'),
    'slash-increment': ('i++ / const { REFUSAL_RULE } = s; / y', 'unclosed regex'),
    'slash-optional-property': ('x?.of / const { REFUSAL_RULE } = s; / y', 'unclosed regex'),
    'slash-property-closed': ('x.delete / const { REFUSAL_RULE } = s; / y /;', 'destructured declaration'),
    'slash-increment-closed': ('i++ / const { REFUSAL_RULE } = s; / y /;', 'destructured declaration'),
    'slash-optional-property-closed': ('x?.of / const { REFUSAL_RULE } = s; / y /;', 'destructured declaration'),
    'slash-return-property': ('const q = obj.return / 2;', 'PASS'),
    'slash-postfix': ('const q = a++ / b;', 'PASS'),
    'slash-block-backtick': ('{} /`/.test(x);', 'PASS'),
    'slash-postfix-simple': ('let i = 0; i++ / 2', 'PASS'),
    'slash-property-simple': ('x.delete / 2', 'PASS'),
    'slash-block': ('if (a) {b()} /const { REFUSAL_RULE } = s/', 'PASS'),
    'slash-header': ('if (a)\n/const { REFUSAL_RULE } = s/', 'PASS'),
}
LINE_CASES = {
    'regex-' + branch + '-' + ending + '-' + canon: (branch, point, canon == 'canon')
    for branch in ('class', 'escape')
    for ending, point in [('lf', '\n'), ('cr', '\r'), ('ls', chr(0x2028)), ('ps', chr(0x2029))]
    for canon in ('canon', 'alone')
}
MISMATCH_CASES = {'mismatched-nested': 'const { nested: [x }', 'mismatched-name': 'const { REFUSAL_RULE ]'}
FIX5_CASES = list(SLASH_CASES) + list(LINE_CASES) + list(MISMATCH_CASES)
CASES += NESTED_CASES + SKIP_CASES + REGEX_CASES + UNCLOSED_CASES + FIX5_CASES
COVERAGE_MUTATIONS = {
    'reject-good': ('if a != b or sha != pin:', 'if True:'),
    'reject-single-quote': ('return json.loads(raw) if raw.startswith(\'"\') else ast.literal_eval(raw)', 'return json.loads(raw)'),
    'ignore-kit-bytes': ('if a != b or sha != pin:', 'if sha != pin:'),
    'skip-kit-read': ("source = kit.read_text(encoding='utf-8')", "source = mod.replace('RULE_TEXT', 'REFUSAL_RULE')"),
    'ignore-destructured': ('if destructured:', 'if False:'),
    'unsupported-ambiguous': ("name + ' unsupported literal'", "name + ' ambiguous: 1 declarations'"),
    'old-destructured-regex': ('destructured = destructured_name(text, name)', r"destructured = any(re.search(r'\b' + re.escape(name) + r'\b', match.group(1)) for match in re.finditer(r'\b(?:const|let|var)\s*(\{[^{}]*\}|\[[^\[\]]*\])', text))"),
    'force-destructured': ('destructured = destructured_name(text, name)', 'destructured = True'),
    'line-comment-lf-only': (r"('\r', '\n', chr(0x2028), chr(0x2029))", r"('\n',)"),
    'ignore-regex': ('def regex_start(prev):\n', 'def regex_start(prev):\n    return False\n'),
    'regex-always': ('def regex_start(prev):\n', 'def regex_start(prev):\n    return True\n'),
    'ignore-property': ("emit('id', text[i:j], prop=prop)", "emit('id', text[i:j], prop=False)"),
    'split-postfix': ("elif text[i:i + 2] in ('++', '--'):", 'elif False:'),
    'ignore-stmt-close': ("return bool(prev.get('stmtClose'))", 'return False'),
    'ignore-header-close': ("    if kind == 'punct' and value == ')' and prev.get('headerClose'):\n        return True", "    if kind == 'punct' and value == ')' and prev.get('headerClose'):\n        return False"),
    'ignore-regex-class-lineend': ('                if ch in LINE_ENDS:\n', '                if ch in LINE_ENDS and not klass:\n'),
    'ignore-regex-escape-lineend': ('if j + 1 >= n or text[j + 1] in LINE_ENDS:', 'if j + 1 >= n:'),
    'ignore-mismatched-bracket': ("                    raise ValueError('unsupported literal: mismatched bracket')", '                    break'),
    'ignore-unclosed-comment': ("            if end < 0:\n                raise ValueError('unsupported literal: unclosed block comment')", "            if end < 0:\n                end = n - 2"),
    'ignore-unclosed-string': ("            if j >= n or text[j] != c:\n                raise ValueError('unsupported literal: unclosed string')", "            if j >= n or text[j] != c:\n                j = n - 1"),
    'ignore-unclosed-regex': ("            if not closed:\n                raise ValueError('unsupported literal: unclosed regex')", "            if not closed:\n                j = n"),
    'ignore-unclosed-bracket': ("                raise ValueError('unsupported literal: unclosed bracket')", '                pass'),
    'ignore-unclosed-template': ("    if stack:\n        kind = 'template' if stack[-1][0] == 'tpl' else 'template interpolation'\n        raise ValueError('unsupported literal: unclosed ' + kind)", '    if False:\n        pass'),
}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--scope', required=True)
    p.add_argument('--plugin', required=True)
    p.add_argument('--root', required=True)
    p.add_argument('--observe', action='store_true')
    p.add_argument('--first-match', action='store_true')
    p.add_argument('--read-outside', action='store_true')
    p.add_argument('--mutate', choices=COVERAGE_MUTATIONS)
    a = p.parse_args()
    names = a.scope.split(',')
    if set(names) - set(CASES):
        p.error('unknown parity scope')
    root = Path(a.root)
    if not root.is_absolute() or not str(root).startswith('/var/tmp/wf569-'):
        p.error('root must be own absolute /var/tmp/wf569-* directory')
    root.mkdir(parents=True)
    source = Path(a.plugin)
    text = (source / 'hooks/register.ts').read_text()
    rule = json.loads(re.search(r'export const RULE_TEXT\s*=\s*("(?:[^"\\]|\\.)*")', text).group(1))
    good = 'const REFUSAL_RULE = ' + json.dumps(rule, ensure_ascii=False) + ';\n'
    failed = 0
    for name in names:
        case = root / name
        shutil.copytree(source, case)
        kit = case / 'kit.js'
        mod = case / 'hooks/register.ts'
        kit.write_text(good)
        env = os.environ.copy()
        env['CATALYST_PATCH_KIT'] = str(kit)
        expected, message = (0, 'PASS') if name in ['good', 'single-quote'] + SKIP_CASES + ['division-chain', 'division-newline'] else (1, 'FAIL') if name == 'bad-byte' else (2, 'НЕ ИЗМЕРЕНО')
        if name == 'two-literals': kit.write_text('function unused(){' + good + '}\nconst REFUSAL_RULE="wrong";\n')
        if name == 'comment-literal': kit.write_text('// ' + good + 'const REFUSAL_RULE="wrong";\n')
        if name == 'duplicate-pin': mod.write_text(text + '\nfunction unused(){const RULE_TEXT_SPLICE_SHA256="wrong";}\n')
        if name == 'duplicate-rule': mod.write_text(text + '\nfunction unused(){const RULE_TEXT="wrong";}\n')
        if name == 'single-quote': kit.write_text("const REFUSAL_RULE='" + rule + "';\n")
        if name == 'backtick': kit.write_text('const REFUSAL_RULE=`' + rule + '`;\n')
        if name == 'comment-backtick': kit.write_text('// ' + good + 'const REFUSAL_RULE=`wrong`;\n')
        if name == 'absent': env.pop('CATALYST_PATCH_KIT')
        if name == 'missing-kit': env['CATALYST_PATCH_KIT'] = str(case / 'not-created.js')
        if name == 'unreadable-kit': kit.chmod(0)
        if name == 'missing-mod': mod.unlink()
        if name == 'unreadable-mod': mod.chmod(0)
        if name == 'no-rule': mod.write_text(text.replace('export const RULE_TEXT =', 'export const UNUSED_RULE ='))
        if name == 'no-pin': mod.write_text(text.replace('export const RULE_TEXT_SPLICE_SHA256 =', 'export const UNUSED_PIN ='))
        if name == 'bad-byte': kit.write_text('const REFUSAL_RULE = ' + json.dumps(rule[:-1] + '!', ensure_ascii=False) + ';\n')
        if name == 'pin-backtick': mod.write_text(re.sub(r'(export const RULE_TEXT_SPLICE_SHA256 = )"[^"]+"', r'\1`unsupported`', text))
        if name == 'rule-backtick': mod.write_text(re.sub(r'(export const RULE_TEXT\s*=\s*)"(?:[^"\\]|\\.)*"', r'\1`unsupported`', text))
        if name == 'destructured-object': kit.write_text('function unused(){const { REFUSAL_RULE } = source;}\n' + good)
        if name == 'destructured-array': kit.write_text('function unused(){let [REFUSAL_RULE] = source;}\n' + good)
        if name == 'typed-rule': mod.write_text(text.replace('export const RULE_TEXT =', 'export const RULE_TEXT: string ='))
        if name in NESTED_CASES:
            label = 'RULE_TEXT' if name.startswith('nested-mod-') else 'REFUSAL_RULE'
            pattern = '{ a: { ' + label + ' } }' if 'array' not in name else '[[ ' + label + ' ]]'
            if name == 'nested-depth3': pattern = '{ a: [{ ' + label + ' }] }'
            declaration = 'const ' + pattern + ' = source;\n'
            if name.startswith('nested-mod-'): mod.write_text(declaration + text)
            else: kit.write_text(declaration + ('' if name == 'nested-alone' else good))
            if name in ('line-comment-ls', 'line-comment-ps'):
                kit.write_text('// ignored' + chr(0x2028 if name == 'line-comment-ls' else 0x2029) + declaration + good)
        if name == 'skip-string-brackets': kit.write_text('const unrelated = "{ [ REFUSAL_RULE } ]";\nconst { a = "{ [ REFUSAL_RULE } ]" } = source;\n' + good)
        if name == 'skip-comment-brackets': kit.write_text('/* const { REFUSAL_RULE } = source; [ */\nconst { a /* { [ REFUSAL_RULE } ] */ } = source;\n// const [ REFUSAL_RULE ] = source; {\n' + good)
        if name == 'skip-template-brackets': kit.write_text('const { a = `} [ REFUSAL_RULE ${ { a: `nested ${"}"}` } }` } = source;\n' + good)
        if name == 'regex-hole': kit.write_text('function unused(){ const { a = /}/, REFUSAL_RULE } = source; }\n' + good)
        if name == 'regex-hole-mod': mod.write_text(text + '\nfunction unused(){ const { a = /}/, RULE_TEXT } = source; }\n')
        if name == 'regex-in-interp': kit.write_text('const t = `${ /`/ }`;\nconst { REFUSAL_RULE } = source;\n')
        if name == 'division-chain': kit.write_text('const q = a / b / c;\n' + good)
        if name in SLASH_CASES:
            fragment, message = SLASH_CASES[name]
            kit.write_text(fragment + '\n' + good)
            expected = 0 if message == 'PASS' else 2
        if name in LINE_CASES:
            branch, ending, canon = LINE_CASES[name]
            body = '[' + ending + ']' if branch == 'class' else '\\' + ending
            kit.write_text(('const u = /' + body + '/;\n') + (good if canon else ''))
            expected, message = 2, 'unsupported literal: unclosed regex'
        if name in MISMATCH_CASES:
            kit.write_text(MISMATCH_CASES[name] + '\n' + good)
            expected, message = 2, 'mismatched bracket'
        if name == 'division-newline': kit.write_text('const q = a\n/ b\n;\n' + good)
        if name == 'unclosed-block-comment': kit.write_text('/* const { REFUSAL_RULE } = s;\n' + good)
        if name == 'unclosed-string-double': kit.write_text('const u = "abc\n' + good)
        if name == 'unclosed-string-single': kit.write_text("const u = 'abc\n" + good)
        if name == 'unclosed-template': kit.write_text('const u = `abc\n' + good)
        if name == 'unclosed-template-interp': kit.write_text('const u = `abc${ x\n' + good)
        if name == 'unclosed-regex-lineend': kit.write_text('const u = /abc\n' + good)
        if name == 'unclosed-regex-eof': kit.write_text('const u = /abc')
        if name == 'unclosed-bracket': kit.write_text('function unused(){ const { REFUSAL_RULE\n' + good)
        script = case / 'tests/scripts/check-splice-parity.sh'
        if a.mutate:
            s = script.read_text()
            old, new = COVERAGE_MUTATIONS[a.mutate]
            if s.count(old) != 1:
                raise ValueError('parity mutation premise: ' + a.mutate)
            script.write_text(s.replace(old, new))
        if a.first_match:
            s = script.read_text()
            old = '    if len(declarations) != 1:'
            if s.count(old) != 1:
                raise ValueError('first-match mutation premise')
            script.write_text(s.replace(old, '    if len(declarations) == 0:'))
        if a.read_outside:
            s = script.read_text()
            old = "try:\n    mod = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')"
            if s.count(old) != 1:
                raise ValueError('read-outside mutation premise')
            script.write_text(s.replace(old, "mod = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')\ntry:\n    pass"))
        result = subprocess.run(['bash', str(script)], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        ok = result.returncode == expected and message in result.stdout
        if name == 'division-chain':
            namespace = {}
            body = script.read_text().split("<<'PY'\n", 1)[1].split('kit = pathlib.Path', 1)[0]
            exec(compile(body, str(script), 'exec'), namespace)
            decide = namespace['regex_start']
            decisions = []
            def observed(prev):
                value = decide(prev)
                decisions.append(value)
                return value
            namespace['regex_start'] = observed
            namespace['mask_noise']('const q = a / b / c;')
            print('division-chain slash decisions=' + repr(decisions))
            ok = ok and decisions == [False, False]
        if name in ('two-literals', 'comment-literal', 'comment-backtick'):
            ok = ok and 'REFUSAL_RULE ambiguous: 2 declarations' in result.stdout
        if name == 'duplicate-pin': ok = ok and 'RULE_TEXT_SPLICE_SHA256 ambiguous: 2 declarations' in result.stdout
        if name == 'duplicate-rule': ok = ok and 'RULE_TEXT ambiguous: 2 declarations' in result.stdout
        if name in ('backtick', 'pin-backtick', 'rule-backtick'):
            label = {'backtick': 'REFUSAL_RULE', 'pin-backtick': 'RULE_TEXT_SPLICE_SHA256', 'rule-backtick': 'RULE_TEXT'}[name]
            ok = ok and label + ' unsupported literal' in result.stdout
        if name in ['destructured-object', 'destructured-array'] + NESTED_CASES:
            label = 'RULE_TEXT' if name.startswith('nested-mod-') else 'REFUSAL_RULE'
            ok = ok and label + ' destructured declaration' in result.stdout
        if name == 'typed-rule': ok = ok and 'RULE_TEXT unsupported literal' in result.stdout
        if name in ('regex-hole', 'regex-in-interp'):
            ok = ok and 'REFUSAL_RULE destructured declaration' in result.stdout
        if name == 'regex-hole-mod': ok = ok and 'RULE_TEXT destructured declaration' in result.stdout
        if name in UNCLOSED_CASES: ok = ok and ('unsupported literal: unclosed ' + UNCLOSED_KIND[name]) in result.stdout
        raw = result.stdout + '\nscript RC=' + str(result.returncode) + '\n'
        print(name + ': ' + raw.strip().replace('\n', '; '))
        (root / (name + '.log')).write_text(raw)
        tooth = subprocess.run([sys.executable, '-c', 'import sys; assert sys.argv[1] == "True", "byte-parity-unique-569: " + sys.argv[2]', str(ok), name], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        (root / (name + '-tooth.log')).write_text(tooth.stdout + '\ntooth RC=' + str(tooth.returncode) + '\n')
        print(tooth.stdout.strip() + ' tooth RC=' + str(tooth.returncode))
        failed += not ok
    print('parity inputs=' + str(len(names)) + ' green=' + str(len(names)-failed) + ' red=' + str(failed))
    return 0 if a.observe else int(failed > 0)


if __name__ == '__main__':
    sys.exit(main())
