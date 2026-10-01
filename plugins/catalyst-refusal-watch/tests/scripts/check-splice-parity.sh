#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
python3 - "$SCRIPT_DIR/../../hooks/register.ts" "${CATALYST_PATCH_KIT:-}" <<'PY'
import ast
import hashlib
import json
import pathlib
import re
import sys

LINE_ENDS = ('\r', '\n', chr(0x2028), chr(0x2029))
# CONSTRAINT: решения `/` и разметка предыдущих токенов следуют неизменённому lexModule кита; литералы и `${` не сбрасывают историю токенов.
REGEX_PUNCT = set('(,=:[!&|?{;+-*%<>~^')
REGEX_KW = {'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await'}
HEADER_KW = {'if', 'while', 'for', 'with', 'catch', 'switch'}
STMT_KW = {'else', 'do', 'try', 'finally'}
MULTI_OPS = ['>>>=', '===', '!==', '**=', '<<=', '>>=', '&&=', '||=', '??=', '>>>', '=>', '&&', '||', '??', '==', '!=', '+=', '-=', '*=', '%=', '&=', '|=', '^=', '<=', '>=', '<<', '>>', '**', '?.']


def regex_start(prev):
    if not prev:
        return True
    kind, value = prev['type'], prev['value']
    if kind == 'punct' and value == '}':
        return bool(prev.get('stmtClose'))
    if kind == 'punct' and value in REGEX_PUNCT:
        return True
    if kind == 'op':
        return True
    if kind == 'id' and not prev.get('prop') and value in REGEX_KW:
        return True
    if kind == 'punct' and value == ')' and prev.get('headerClose'):
        return True
    return False


def mask_noise(text):
    import unicodedata
    n = len(text)
    out = list(text)
    prev = None
    before = None

    def emit(kind, value, **extra):
        nonlocal prev, before
        before, prev = prev, dict(type=kind, value=value, **extra)

    def blank(a, b):
        for k in range(a, min(b, n)):
            out[k] = ' '

    # CONSTRAINT: stack хранит открытые шаблоны ['tpl', index] и интерполяции ['code', depth]; незакрытость — отказ до подсчёта объявлений.
    stack = []
    braces = []
    parens = []
    i = 0
    while i < n:
        if stack and stack[-1][0] == 'tpl':
            c = text[i]
            nxt = text[i + 1] if i + 1 < n else ''
            if c == '\\':
                i += 2
            elif c == '`':
                blank(stack[-1][1], i + 1)
                stack.pop()
                i += 1
            elif c == '$' and nxt == '{':
                stack.append(['code', 1])
                braces.append(False)
                i += 2
            else:
                i += 1
            continue
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ''
        if c == '/' and nxt == '/':
            end = i + 2
            while end < n and text[end] not in LINE_ENDS:
                end += 1
            blank(i, end)
            i = end
        elif c == '/' and nxt == '*':
            end = text.find('*/', i + 2)
            if end < 0:
                raise ValueError('unsupported literal: unclosed block comment')
            blank(i, end + 2)
            i = end + 2
        elif c == '/' and regex_start(prev):
            j = i + 1
            closed = False
            klass = False
            while j < n:
                ch = text[j]
                if ch in LINE_ENDS:
                    break
                if ch == '\\':
                    if j + 1 >= n or text[j + 1] in LINE_ENDS:
                        break
                    j += 2
                    continue
                if klass:
                    if ch == ']':
                        klass = False
                elif ch == '[':
                    klass = True
                elif ch == '/':
                    closed = True
                    break
                j += 1
            if not closed:
                raise ValueError('unsupported literal: unclosed regex')
            j += 1
            while j < n and text[j] in 'gimsuyvd':
                j += 1
            blank(i, j)
            i = j
        elif c == '"' or c == "'":
            j = i + 1
            while j < n and text[j] != c and text[j] not in LINE_ENDS:
                if text[j] == '\\':
                    j += 1
                j += 1
            if j >= n or text[j] != c:
                raise ValueError('unsupported literal: unclosed string')
            blank(i, j + 1)
            i = j + 1
        elif c == '`':
            stack.append(['tpl', i])
            i += 1
        elif re.match(r'[A-Za-z_$]', c):
            j = i + 1
            while j < n and re.match(r'[A-Za-z0-9_$]', text[j]):
                j += 1
            prop = bool(prev and ((prev['type'] == 'punct' and prev['value'] == '.' and not (before and before['type'] == 'punct' and before['value'] == '.')) or (prev['type'] == 'op' and prev['value'] == '?.')))
            emit('id', text[i:j], prop=prop)
            i = j
        elif '0' <= c <= '9' or (c == '.' and nxt and '0' <= nxt <= '9'):
            j = i
            if text[i:i + 2] in ('0x', '0X', '0b', '0B', '0o', '0O'):
                j += 2
                while j < n and re.match(r'[0-9a-fA-F]', text[j]):
                    j += 1
            else:
                while j < n and '0' <= text[j] <= '9':
                    j += 1
                if j < n and text[j] == '.':
                    j += 1
                    while j < n and '0' <= text[j] <= '9':
                        j += 1
                if j < n and text[j] in ('e', 'E'):
                    j += 1
                    if j < n and text[j] in ('+', '-'):
                        j += 1
                    while j < n and '0' <= text[j] <= '9':
                        j += 1
            emit('num', text[i:j])
            i = j
        else:
            if c in ' \t\n\r\v\f﻿  ' or unicodedata.category(c) == 'Zs':
                i += 1
                continue
            if c == '{':
                if stack:
                    stack[-1][1] += 1
                stmt = not prev or (prev['type'] == 'punct' and prev['value'] in (';', '{', '}')) or (prev['type'] == 'punct' and prev['value'] == ')' and prev.get('headerClose')) or (prev['type'] == 'id' and prev['value'] in STMT_KW)
                braces.append(bool(stmt))
                emit('punct', c)
            elif c == '}':
                stmt = braces.pop() if braces else False
                if stack:
                    stack[-1][1] -= 1
                    if stack[-1][1] == 0:
                        stack.pop()
                        i += 1
                        continue
                emit('punct', c, stmtClose=stmt)
            elif c == '(':
                parens.append(bool(prev and prev['type'] == 'id' and not prev.get('prop') and prev['value'] in HEADER_KW))
                emit('punct', c)
            elif c == ')':
                emit('punct', c, headerClose=parens.pop() if parens else False)
            elif text[i:i + 2] in ('++', '--'):
                emit('punct', text[i:i + 2])
                i += 2
                continue
            else:
                op = next((op for op in MULTI_OPS if text.startswith(op, i)), None)
                emit('op' if op else 'punct', op or c)
                i += len(op) if op else 1
                continue
            i += 1
    if stack:
        kind = 'template' if stack[-1][0] == 'tpl' else 'template interpolation'
        raise ValueError('unsupported literal: unclosed ' + kind)
    return ''.join(out)


def destructured_name(text, name):
    code = mask_noise(text)
    for match in re.finditer(r'\b(?:const|let|var)\b\s*([\{\[])', code):
        start = match.end() - 1
        stack = []
        i = start
        while i < len(code):
            char = code[i]
            if char in '{[': stack.append('}' if char == '{' else ']')
            elif char in '}]':
                if not stack or char != stack.pop():
                    raise ValueError('unsupported literal: mismatched bracket')
                if not stack:
                    if re.search(r'\b' + re.escape(name) + r'\b', code[start:i + 1]): return True
                    break
            i += 1
        else:
            if stack:
                raise ValueError('unsupported literal: unclosed bracket')
    return False


def literal(text, name):
    destructured = destructured_name(text, name)
    if destructured:
        raise ValueError(name + ' destructured declaration')
    declarations = list(re.finditer(r'\b(?:const|let|var)\s+' + re.escape(name) + r'\b\s*(?::[^=;\n]+)?\s*=', text))
    if len(declarations) != 1:
        raise ValueError(name + ' ambiguous: ' + str(len(declarations)) + ' declarations')
    match = re.match(r'\s*("(?:[^"\\]|\\.)*"|\x27(?:[^\x27\\]|\\.)*\x27)', text[declarations[0].end():])
    if not match or ':' in declarations[0].group(0):
        raise ValueError(name + ' unsupported literal')
    raw = match.group(1)
    return json.loads(raw) if raw.startswith('"') else ast.literal_eval(raw)


kit = pathlib.Path(sys.argv[2]) if sys.argv[2] else None
if kit is None or not kit.exists():
    print('[569] splice-parity НЕ ИЗМЕРЕНО: CATALYST_PATCH_KIT is absent or missing')
    sys.exit(2)
if kit.is_dir():
    kit = kit / 'tweakcc-patch.js'
try:
    mod = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
    source = kit.read_text(encoding='utf-8')
    refusal = literal(source, 'REFUSAL_RULE')
    rule = literal(mod, 'RULE_TEXT')
    pin = literal(mod, 'RULE_TEXT_SPLICE_SHA256')
except (OSError, ValueError) as error:
    print('[569] splice-parity НЕ ИЗМЕРЕНО: ' + str(error))
    sys.exit(2)
a, b = rule.encode('utf-8'), refusal.encode('utf-8')
sha = hashlib.sha256(a).hexdigest()
if a != b or sha != pin:
    print('[569] splice-parity FAIL: RULE_TEXT/REFUSAL_RULE/pin differ; bytes=' + str(len(a)) + '/' + str(len(b)))
    sys.exit(1)
print('[569] splice-parity PASS: bytes=' + str(len(a)) + ' sha256=' + sha)
PY
