#!/usr/bin/env python3
# host-doors.py -- ценз дверей мод-API хоста по ПРИСТИННОМУ образу.
# CONSTRAINT: пинуются ИМЕНА, ИЗМЕРЕННЫЕ в образе; документация и догадки --
# не источник (замер по патченому образу принёс бы нашу собственную правку).
# CONSTRAINT: классы дверей -- classic (classic-массив, форма classic.<хвост>),
# event (реестр событий: литералы hSt-списка + G-массив + свип "session.*"),
# method (двери-методы $-ноунов из таблицы ноунов ядра, БЕЗ собственного
# события -- событийная часть их не видит). Столбец «в таблице плагинов» --
# прошёл ли ноун двери фильтр таблицы ноунов плагина хоста; «—» -- дверь
# вне ноун-таблицы.
# CONSTRAINT: отказ кодом 2 с ИМЕНОВАННОЙ причиной при нуле method-дверей
# (вакуумный пин), при пустых classic/реестре и при нераспознанной форме любой
# структуры: съём, который «ничего не нашёл», -- не зелень, а отказ прибора.
# latin-1, образ не исполняется.
import re, sys, json, hashlib, unicodedata
from pathlib import Path

def refuse(reason):
    sys.stderr.write('host-doors: ОТКАЗ: %s\n' % reason)
    raise SystemExit(2)

MULTI_OPS = ('>>>=', '===', '!==', '**=', '<<=', '>>=', '&&=', '||=', '??=', '>>>', '=>', '&&', '||', '??', '==', '!=', '+=', '-=', '*=', '%=', '&=', '|=', '^=', '<=', '>=', '<<', '>>', '**', '?.')
REGEX_PUNCT = {'(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '<', '>', '~', '^'}
REGEX_KW = {'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await'}
HEADER_KW = {'if', 'while', 'for', 'with', 'catch', 'switch'}
STMT_KW = {'else', 'do', 'try', 'finally'}

def decide_slash(prev):
    if prev is None: return True
    kind, value = prev['type'], prev['value']
    if kind == 'punct' and value == '}': return prev.get('stmtClose', False)
    if kind == 'punct' and value in REGEX_PUNCT: return True
    if kind == 'op': return True
    if kind == 'id' and not prev.get('prop') and value in REGEX_KW: return True
    if kind == 'punct' and value == ')' and prev.get('headerClose'): return True
    return False

def asi_block(prev, before):
    # CONSTRAINT: { on a new line after a finished expression opens a block
    # (ASI): an expression cannot continue with {. Excluded: ) (function and
    # method parameters) and the name after class/extends (class body).
    kind, value = prev['type'], prev['value']
    if kind in ('num', 'str', 'tmpl', 'regex'): return True
    if kind == 'punct': return value == ']'
    if kind != 'id': return False
    if before and before['type'] == 'id' and before['value'] in ('class', 'extends'): return False
    return prev.get('prop') or value not in REGEX_KW or value in ('return', 'yield')

def lex_js(text, start=0):
    # CONSTRAINT: port of tweakcc-patch.js lexModule (14b6a77b), streamed
    # so a factory slice does not retain tokens from the entire image.
    # CONSTRAINT: a closed literal (string, template, regex) is the previous
    # token for the next /, { and identifier: the kit leaves none (#582), and
    # the operator before the literal would turn a division into a regex.
    i = start; n = len(text); mode = 'code'; brace = 0; lit = 0
    parens = []; interps = []; braces = []; history = []; nl = [False]
    def emit(kind, value, begin, end, **extra):
        tok = dict(type=kind, value=value, start=begin, end=end, **extra)
        history.append(tok); nl[0] = False
        if len(history) > 3: del history[0]
        return tok
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ''
        if mode == 'line':
            if c in '\n\r  ':
                mode = 'code'; nl[0] = True
                yield dict(type='newline', value=c, start=i, end=i + 1)
            i += 1; continue
        if mode == 'block':
            if c == '*' and nxt == '/': i += 2; mode = 'code'
            else:
                if c in '\n\r  ': nl[0] = True
                i += 1
            continue
        if mode in ('sq', 'dq'):
            if c == '\\': i += 2; continue
            if c == ("'" if mode == 'sq' else '"'):
                mode = 'code'
                yield emit('str', text[lit + 1:i], lit, i + 1, quote=c)
            i += 1; continue
        if mode == 'tmpl':
            if c == '\\': i += 2; continue
            if c == '`':
                yield emit('tmpl', '`', i, i + 1)
                i += 1; mode = 'code'; continue
            if c == '$' and nxt == '{':
                braces.append(False); interps.append(brace); brace += 1
                # CONSTRAINT: ${ begins an expression; its previous token
                # is { even in a tagged template (kit #582 is not carried);
                # that { opens no statement position.
                yield emit('punct', '{', i + 1, i + 2, interpOpen=True)
                i += 2; mode = 'code'; continue
            i += 1; continue
        if mode == 'regex':
            if c == '\\': i += 2; continue
            if c == '[':
                i += 1
                while i < n:
                    if text[i] == '\\': i += 2; continue
                    if text[i] == ']': i += 1; break
                    i += 1
                continue
            if c == '/':
                i += 1
                while i < n and text[i] in 'gimsuyvd': i += 1
                mode = 'code'
                yield emit('regex', text[lit:i], lit, i)
                continue
            i += 1; continue
        if c in ' \t\n\r\v\f' or (c > '\x7f' and (c in '﻿  ' or unicodedata.category(c) == 'Zs')):
            if c in '\n\r  ':
                nl[0] = True
                yield dict(type='newline', value=c, start=i, end=i + 1)
            i += 1; continue
        if c == '/' and nxt in ('/', '*'):
            mode = 'line' if nxt == '/' else 'block'; i += 2; continue
        if c in "'\"`":
            mode = {"'": 'sq', '"': 'dq', '`': 'tmpl'}[c]
            lit = i; i += 1; continue
        prev = history[-1] if history else None
        if c == '/':
            if decide_slash(prev): mode = 'regex'; lit = i; i += 1; continue
            yield emit('punct', '/', i, i + 1)
            i += 1; continue
        if c == '}':
            brace -= 1
            stmt_close = braces.pop() if braces else False
            if interps and brace == interps[-1]:
                interps.pop()
                yield dict(type='punct', value='}', start=i, end=i + 1)
                mode = 'tmpl'
            else:
                yield emit('punct', '}', i, i + 1, stmtClose=stmt_close)
            i += 1; continue
        if c == '{':
            stmt_pos = (prev is None or
                        (prev['type'] == 'punct' and prev['value'] in (';', '{', '}') and not prev.get('interpOpen')) or
                        (prev['type'] == 'punct' and prev['value'] == ')' and prev.get('headerClose')) or
                        (prev['type'] == 'id' and prev['value'] in STMT_KW) or
                        (nl[0] and asi_block(prev, history[-2] if len(history) >= 2 else None)))
            braces.append(bool(stmt_pos)); brace += 1
            yield emit('punct', '{', i, i + 1)
            i += 1; continue
        if c == '(':
            parens.append(bool(prev and prev['type'] == 'id' and not prev.get('prop') and prev['value'] in HEADER_KW))
            yield emit('punct', '(', i, i + 1)
            i += 1; continue
        if c == ')':
            header = parens.pop() if parens else False
            yield emit('punct', ')', i, i + 1, headerClose=header)
            i += 1; continue
        if c.isascii() and (c.isalpha() or c in '_$'):
            begin = i; i += 1
            while i < n and text[i].isascii() and (text[i].isalnum() or text[i] in '_$'): i += 1
            before2 = history[-2] if len(history) >= 2 else None
            prop = bool(prev and ((prev['type'] == 'punct' and prev['value'] == '.' and
                                  not (before2 and before2['type'] == 'punct' and before2['value'] == '.')) or
                                 (prev['type'] == 'op' and prev['value'] == '?.')))
            yield emit('id', text[begin:i], begin, i, prop=prop)
            continue
        if c in '0123456789' or (c == '.' and nxt in '0123456789' and nxt):
            begin = i
            if text[i:i + 2].lower() in ('0x', '0b', '0o'):
                i += 2
                while i < n and text[i] in '0123456789abcdefABCDEF': i += 1
            else:
                while i < n and text[i] in '0123456789': i += 1
                if i < n and text[i] == '.':
                    i += 1
                    while i < n and text[i] in '0123456789': i += 1
                if i < n and text[i] in 'eE':
                    i += 1
                    if i < n and text[i] in '+-': i += 1
                    while i < n and text[i] in '0123456789': i += 1
            yield emit('num', text[begin:i], begin, i)
            continue
        if c in '+-' and nxt == c:
            yield emit('punct', c + c, i, i + 2)
            i += 2; continue
        op = next((op for op in MULTI_OPS if text.startswith(op, i)), None)
        if op:
            yield emit('op', op, i, i + len(op))
            i += len(op); continue
        yield emit('punct', c, i, i + 1)
        i += 1

def balanced(t, open_i):
    depth = 0
    for tok in lex_js(t, open_i):
        if tok['type'] != 'punct': continue
        c = tok['value']
        if c in ('[', '{', '('): depth += 1
        elif c in (']', '}', ')'):
            depth -= 1
            if depth == 0: return tok['start']
    ch = t[open_i]
    refuse('скобки не сбалансированы: %s на позиции %d среза' % (ch, open_i))

def depth1_strings(seg):
    # строковые литералы на глубине 1 внутренности массива
    out = []; depth = 1
    for tok in lex_js(seg):
        if tok['type'] == 'str':
            if depth == 1: out.append(tok['value'])
        elif tok['type'] == 'tmpl':
            if depth == 1: refuse('шаблонный литерал в списке имён')
        elif tok['type'] == 'punct':
            if tok['value'] in ('[', '{', '('): depth += 1
            elif tok['value'] in (']', '}', ')'): depth -= 1
    return out

def list_start(t, si):
    # CONSTRAINT: обратный ход от ...<G>] к открывающей [ пропускает строковые
    # литералы; шаблон, regex или выход за начало образа -- None, а найденная
    # [ обязана замыкаться лексером ровно на ] после ...<G>.
    j = si - 1; depth = 0
    while j >= 0:
        c = t[j]
        if c in '"\'':
            k = j - 1
            while k >= 0:
                if t[k] == c:
                    m = k - 1
                    while m >= 0 and t[m] == '\\': m -= 1
                    if (k - 1 - m) % 2 == 0: break
                k -= 1
            if k < 0: return None
            j = k - 1; continue
        if c in '`/': return None
        if c in ']})': depth += 1
        elif c in '[{(':
            if depth == 0: return j if c == '[' else None
            depth -= 1
        j -= 1
    return None

def split_top(seg):
    parts = []; depth = 0; begin = 0
    for tok in lex_js(seg):
        if tok['type'] != 'punct': continue
        c = tok['value']
        if c in ('[', '{', '('): depth += 1
        elif c in (']', '}', ')'): depth -= 1
        elif c == ',' and depth == 0:
            parts.append(seg[begin:tok['start']])
            begin = tok['end']
    if seg[begin:].strip(): parts.append(seg[begin:])
    return parts

def expr_span(t, i):
    depth = 0
    for tok in lex_js(t, i):
        c = tok['value']
        if tok['type'] == 'punct':
            if c in ('[', '{', '('): depth += 1
            elif c in (']', '}', ')'): depth -= 1
            elif c == ';' and depth == 0: return tok['start']
        elif tok['type'] == 'newline' and depth == 0:
            return tok['start']
    return len(t)

def method_objects(body):
    # объектные литералы-аргументы вызовов X({...}) с одними
    # идентификаторными ключами -- кандидаты в таблицы методов ноуна
    out = []
    for m in re.finditer(r'[\w$]\(\{', body):
        bopen = m.end() - 1
        bend = balanced(body, bopen)
        keys = []
        ok = True
        for part in split_top(body[bopen+1:bend]):
            km = re.match(r'^([\w$]+):', part)
            if not km: ok = False; break
            keys.append(km.group(1))
        if ok and keys: out.append(keys)
    return out

def noun_table(t):
    # таблица ноунов: сборка <noun>:<wrap>(<F>(...)) по якорю вызова с
    # pluginName:"core" (якорь единственный; имя сборки из него, не догадкой)
    cm = re.findall(r'([\w$]+)\(\{pluginName:"core"', t)
    if len(cm) != 1:
        refuse('якорь таблицы ноунов (pluginName:"core") найден %d раз' % len(cm))
    jn = cm[0]
    dm = list(re.finditer(r'function ' + re.escape(jn) + r'\(\{pluginName', t)) + \
          list(re.finditer(r'var ' + re.escape(jn) + r'=\(\{pluginName', t))
    if len(dm) != 1:
        refuse('определение сборки ноунов %s найдено %d раз' % (jn, len(dm)))
    d = dm[0]
    if t.startswith('function', d.start()):
        popen = t.index('(', d.start())
        pclose = balanced(t, popen)
        bopen = t.index('{', pclose)
    else:
        popen = t.index('(', d.start())
        pclose = balanced(t, popen)
        bopen = t.index('{', t.index('=>', pclose))
    bend = balanced(t, bopen)
    body = t[bopen+1:bend]
    # return{...} на верхнем уровне тела сборки -- ровно один
    lit = None
    for m in re.finditer(r'return\{', body):
        # глубина от начала тела (не считая самой открывающей)
        pre = body[:m.start()]
        if _depth_of(pre) == 0:
            if lit is not None:
                refuse('у сборки ноунов больше одного верхнего return{')
            lit = m
    if lit is None:
        refuse('у сборки ноунов нет верхнего return{}')
    oopen = lit.end() - 1
    oend = balanced(body, oopen)
    entries = []
    wrapper = None
    for part in split_top(body[oopen+1:oend]):
        em = re.match(r'^([\w$]+):([\w$]+)\(([\w$]+)\(', part)
        if not em:
            refuse('запись таблицы ноунов не формы <ноун>:<обёртка>(<фабрика>(: [%s]' % part[:60])
        if wrapper is None: wrapper = em.group(2)
        elif wrapper != em.group(2):
            refuse('обёртка записей таблицы ноунов не одна: %s и %s' % (wrapper, em.group(2)))
        entries.append((em.group(1), em.group(3), part))
    if len(entries) < 2:
        refuse('в таблице ноунов меньше двух записей: %d' % len(entries))
    # CONSTRAINT: сборка замораживается по Object.keys (таблица ноун->методы);
    # след заморозки обязан стоять у вызова -- иначе якорь указал не на сборку
    call_pos = t.index(jn + '({pluginName:"core"')
    if 'Object.freeze(Object.keys(' not in t[call_pos:call_pos+2048]:
        refuse('след таблицы методов (Object.freeze(Object.keys) после сборки не найден')
    return entries

def _depth_of(s):
    depth = 0
    for tok in lex_js(s):
        if tok['type'] != 'punct': continue
        if tok['value'] in ('[', '{', '('): depth += 1
        elif tok['value'] in (']', '}', ')'): depth -= 1
    return depth

def factory_methods(t, factory, noun):
    # методы ноуна: ключи объектного литерала фабрики; фабрика подтверждается
    # литералами "ноун.метод" в её теле (имена в бандле переиспользуются)
    candidates = []
    for m in re.finditer(r'(?:var|function) ' + re.escape(factory) + r'[=(]', t):
        if t.startswith('var', m.start()):
            span_end = expr_span(t, m.end())
            body = t[m.end():span_end]
        else:
            popen = t.index('(', m.start())
            pclose = balanced(t, popen)
            bopen = t.index('{', pclose)
            bend = balanced(t, bopen)
            body = t[bopen+1:bend]
        for keys in method_objects(body):
            score = sum(1 for k in keys if ('"%s.%s"' % (noun, k)) in body)
            candidates.append((score, frozenset(keys)))
    best_score = max((score for score, keys in candidates), default=0)
    best_keys = {keys for score, keys in candidates if score == best_score}
    if best_score >= 1 and len(best_keys) >= 2:
        refuse('фабрика %s ноуна %s: два кандидата с равным счётом' % (factory, noun))
    return set(next(iter(best_keys))) if best_score >= 1 else set()

def plugin_filter(t, nouns):
    # таблица ноунов плагина: {owner,methods} собирается по фильтру if(<fn>(t));
    # исключённые ноуны -- те, что фильтр отсекает константой лжи
    fm = re.findall(r'if\(([\w$]+)\(([\w$]+)\)\)([\w$]+)\[\2\]=\{owner:[\w$]+,methods:\[\.\.\.[\w$]+\]\}', t)
    if len(fm) != 1:
        refuse('строитель таблицы ноунов плагина (owner/methods по фильтру) найден %d раз' % len(fm))
    fn = fm[0][0]
    for d in re.finditer(r'var ' + re.escape(fn) + r'=\(([\w$]+)\)=>', t):
        body = t[d.end():expr_span(t, d.end())]
        bm = re.match(r'^([\w$]+)\!==([\w$]+)\|\|([\w$]+)\(\)$', body)
        if not bm: continue
        varA, varB = bm.group(2), bm.group(3)
        am = None
        for a in re.finditer(r'var ' + re.escape(varA) + r'="([^"]*)"', t[:d.end()]):
            am = a
        bm2 = None
        for b in re.finditer(r'var ' + re.escape(varB) + r'=\(\)=>(!0|!1)\b', t[:d.end()]):
            bm2 = b
        if am is None or bm2 is None: continue
        if am.group(1) not in nouns: continue
        return set([am.group(1)]) if bm2.group(1) == '!1' else set()
    refuse('фильтр таблицы ноунов плагина %s не распознан (форма сменилась)' % fn)

def census(path, version):
    data = open(path, 'rb').read()
    t = data.decode('latin-1')
    r = {'image_bytes': len(data)}
    m = re.search(r'var ([\w$]+)=([\w$]+)\.map\(\(e\)=>`classic\.\$\{e\}`\)', t)
    if not m: refuse('голова реестра (classic.map) не найдена')
    alias = m.group(2)
    for _ in range(6):
        bm = re.search(r'var ' + re.escape(alias) + r'=\[', t)
        if bm: break
        am = re.search(r'var ' + re.escape(alias) + r'=([\w$]+);', t)
        if not am: refuse('цепочка алиасов классик-массива оборвана на %s' % alias)
        alias = am.group(1)
    occ = [mm.start() for mm in re.finditer(r'(?:var |,|;)' + re.escape(alias) + r'=\[', t)]
    if not occ: refuse('классик-массив не найден')
    # CONSTRAINT: первый по цепочке алиасов -- сам классик-массив (пин
    # метод doors-ценза); одноимённые массивы других скоупов -- коллизии имён,
    # не копии. Копии (#356) -- побайтно равные ЛИТЕРАЛЫ, кто бы их ни нес:
    # имя считается один раз, число копий уходит в шапку пина.
    bi = t.index('[', occ[0])
    bend = balanced(t, bi)
    classic = depth1_strings(t[bi+1:bend])
    if not classic: refuse('classic-массив пуст')
    copies = t.count(t[bi:bend+1])
    r['classic_count'] = len(classic)
    r['classic_copies'] = copies
    gm = re.search(r'var ([\w$]+)=\["model\.complete"', t[m.start():])
    if not gm: refuse('G-массив не найден')
    g = gm.group(1)
    gi = t.index('var ' + g + '=[')
    abr = t.index('[', gi)
    gnames = depth1_strings(t[abr+1:balanced(t, abr)])
    r['g_count'] = len(gnames)
    if not gnames: refuse('G-массив пуст')
    try:
        si = t.index('...' + g + ']')
    except ValueError:
        refuse('hSt-список (раскрытие ...%s]) не найден' % g)
    hend = si + len('...' + g) + 1
    hstart = list_start(t, si)
    if hstart is None or balanced(t, hstart) != hend - 1:
        refuse('начало hSt-списка перед ...%s] не определено' % g)
    hlits = depth1_strings(t[hstart+1:hend-1])
    r['hst_count'] = len(hlits)
    if not hlits: refuse('литералы hSt-списка пусты')
    sweep = sorted(set(re.findall(r'"(session\.[\w.]+)"', t)))
    r['session_sweep'] = len(sweep)
    entries = noun_table(t)
    nouns = [e[0] for e in entries]
    r['nouns'] = len(nouns)
    methods = {}
    for noun, factory, part in entries:
        keys = factory_methods(t, factory, noun)
        lits = set(re.findall(r'"' + re.escape(noun) + r'\.([\w$]+)"', part))
        ms = keys | lits
        if not ms: refuse('ноун %s: методы не измерены' % noun)
        methods[noun] = ms
    r['noun_methods'] = {n: sorted(methods[n]) for n in nouns}
    excluded = plugin_filter(t, set(nouns))
    r['plugin_table_excluded'] = sorted(excluded)
    classic_doors = set('classic.' + c for c in classic)
    registry = set(hlits) | set(gnames)
    noun_doors = set(n + '.' + mth for n, ms in methods.items() for mth in ms)
    method_class = noun_doors - registry - set(sweep) - classic_doors
    r['method_class'] = sorted(method_class)
    if not method_class:
        refuse('method-дверей 0 (вакуумный пин: двери-методы без события не найдены)')
    doors = classic_doors | registry | set(sweep) | noun_doors
    r['doors_total'] = len(doors)
    r['registry_unique'] = len(registry | classic_doors)
    r['ctrl_api_retry'] = t.count('api_retry')
    r['ctrl_error_status'] = t.count('error_status')
    lines = []
    lines.append('# Двери хоста, ИЗМЕРЕННЫЕ присутствующими в ПРИСТИННОМ образе головной версии.')
    lines.append('# CONSTRAINT: источник -- ценз tests/tools/host-doors.py на образе VERSION ниже;')
    lines.append('# пополняется ТОЛЬКО перезамером на новой головной версии, не правкой списка.')
    lines.append('# CONSTRAINT: имя записывается в ТОЙ форме, в которой дверь адресуется')
    lines.append('# потребителем; классик-семейство -- в форме classic.<хвост>, одной формой')
    lines.append('# на дверь (#361, #356). Голых имён (без пространства имён) в наборе не')
    lines.append('# бывает: сверка стенда идёт ПОЛНЫМ именем (#336).')
    lines.append('# CONSTRAINT: классик-литерал встречается в образе %d раз(а) ПОБАЙТОВО равными' % r['classic_copies'])
    lines.append('# копиями (питают разные механизмы): имя считается ОДИН раз (#356).')
    lines.append('# CONSTRAINT: формат строки: <имя><TAB><класс event|method|classic><TAB><в таблице плагинов: да|нет|—>; класс method -- дверь-метод $-ноуна БЕЗ собственного события; «в таблице плагинов» -- ноун двери прошёл фильтр таблицы ноунов плагина хоста, «—» -- дверь вне ноун-таблицы (фильтр не про неё).')
    lines.append('# CONSTRAINT: api_retry и error_status -- контроли метода ценза, НЕ двери;')
    lines.append('# выведены из набора имён в ключи CONTROL= (ключевая форма, как VERSION=).')
    lines.append('VERSION=%s' % version)
    lines.append('IMAGE_SHA256=%s' % hashlib.sha256(data).hexdigest())
    lines.append('CONTROL=api_retry')
    lines.append('CONTROL=error_status')
    for d in sorted(doors):
        if d in classic_doors: cls = 'classic'
        elif d in method_class: cls = 'method'
        else: cls = 'event'
        noun = d.split('.', 1)[0]
        if noun in methods and methods[noun]:
            col = 'нет' if noun in excluded else 'да'
        else:
            col = '—'
        lines.append('%s\t%s\t%s' % (d, cls, col))
    return '\n'.join(lines) + '\n', r

def pin_rows(path):
    return [tuple(line.split('\t')) for line in Path(path).read_text(encoding='utf-8').splitlines()
            if line and not line.startswith(('#', 'VERSION=', 'IMAGE_SHA256=', 'CONTROL='))]

def usage(pin, root):
    root = Path(root)
    files = sorted((p for p in (root / 'plugins').rglob('*')
                    if p.is_file() and p.suffix in {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts'}),
                   key=lambda p: p.relative_to(root).as_posix())
    sources = [(p.relative_to(root).as_posix(), p.read_text(encoding='utf-8').splitlines()) for p in files]
    rows = pin_rows(pin)
    pin_arg = Path(pin).resolve().relative_to(root.resolve()).as_posix() if Path(pin).resolve().is_relative_to(root.resolve()) else str(pin)
    print('# Потребители дверей хоста в plugins/** этого репо\n')
    print('Правило: суффиксы .ts .tsx .js .mjs .cjs .mts .cts; строка пропускается, если после пробелов начинается с //, /* или *;')
    print(r"совпадение: re.search(r'(?<![\w$])' + re.escape(имя) + r'(?![\w$])', строка).")
    print('Порядок: sorted по POSIX-пути от корня репо, строки по возрастанию; потребитель — первое совпадение, иначе 0.\n')
    print('Команда: `python3 tests/tools/host-doors.py --usage %s .`\n' % pin_arg)
    print('| дверь | класс | в таблице плагинов | потребитель |')
    print('|---|---|---|---|')
    missing = 0
    for name, cls, col in rows:
        pattern = re.compile(r'(?<![\w$])' + re.escape(name) + r'(?![\w$])')
        consumer = '0'
        for path, lines in sources:
            for lineno, line in enumerate(lines, 1):
                if line.lstrip().startswith(('//', '/*', '*')):
                    continue
                if pattern.search(line):
                    consumer = '%s:%d' % (path, lineno)
                    break
            if consumer != '0':
                break
        missing += consumer == '0'
        print('| %s | %s | %s | %s |' % (name, cls, col, consumer))
    print('\nбез потребителя: %d из %d' % (missing, len(rows)))

def application():
    sys.stderr.write('host-doors: применение: host-doors.py <образ> --version <v> --prev <пин>|none [--removed <имя,…>] [--out <файл>] | host-doors.py --usage <пин> <корень-репо>\n')
    raise SystemExit(2)

def main():
    args = sys.argv[1:]
    if args and args[0] == '--usage':
        if len(args) != 3 or any(a.startswith('--') for a in args[1:]):
            application()
        usage(args[1], args[2])
        return
    if len(args) < 5 or args[0].startswith('--') or args[1] != '--version' or args[3] != '--prev' or any(a.startswith('--') for a in (args[2], args[4])):
        application()
    path, version, prev = args[0], args[2], args[4]
    removed = set()
    out = None
    i = 5
    if i < len(args) and args[i] == '--removed':
        if i + 1 >= len(args) or args[i + 1].startswith('--'):
            application()
        removed = set(args[i + 1].split(','))
        i += 2
    if i < len(args) and args[i] == '--out':
        if i + 1 >= len(args) or args[i + 1].startswith('--'):
            application()
        out = args[i + 1]
        i += 2
    if i != len(args):
        application()
    text, r = census(path, version)
    if prev != 'none':
        previous = {row[0] for row in pin_rows(prev)}
        current = {line.split('\t')[0] for line in text.splitlines() if '\t' in line and not line.startswith('#')}
        lost = previous - current - removed
        if lost:
            refuse('двери пропали: ' + ','.join(sorted(lost)))
    sys.stdout.write(text)
    sys.stderr.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + '\n')
    if out:
        Path(out).write_text(text, encoding='utf-8')

if __name__ == '__main__':
    main()
