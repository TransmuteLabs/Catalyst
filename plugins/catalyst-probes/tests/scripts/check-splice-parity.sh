#!/usr/bin/env bash
# Ступень 2 сторожа побайтового паритета правила отмены диспатча (волна #116).
# Ступень 1 -- юнит units.test.ts: сверяет sha256(COACHING) с пином
# COACHING_SPLICE_SHA256 из register.ts, но раннер юнитов не читает файлы
# кита (node:fs запрещён). Эта ступень кросс-репозиторна: корень кита берётся
# из CATALYST_PATCH_KIT, из tweakcc-patch.js извлекается RULE шага 26 и его
# sha256 сверяется с ТЕМ ЖЕ пином, а при расхождении печатается длина и первая
# расходящаяся позиция двух домов.
#
# CONSTRAINT: режим всегда строгий -- кит не найден или путь не задан => НЕ
# ИЗМЕРЕНО (код 3), тихая зелень при отсутствии кита запрещена; расхождение
# текстов или пина -- красный (код 1). Коды согласованы с test-mod-units.sh.
set -u

# CONSTRAINT: дом прибора добывается С ПРОВЕРКОЙ КОДА. Прибор, молча
# перепутавший собственный дом, читает не тот файл и выдаёт отказ за вердикт;
# под `set -u` пустая подстановка сама по себе не останавливает прогон.
HERE="$(cd "$(dirname "$0")" && pwd)" || { printf 'ПРИБОР НЕДОСТУПЕН: не определён дом сторожа\n' >&2; exit 3; }
PLUGIN_DIR="$(cd "$HERE/../.." && pwd)" || { printf 'ПРИБОР НЕДОСТУПЕН: не определён дом плагина\n' >&2; exit 3; }
REGISTER="$PLUGIN_DIR/hooks/register.ts"
PATCH_JS="${CATALYST_PATCH_KIT:-}/tweakcc-patch.js"

if [ -z "${CATALYST_PATCH_KIT:-}" ]; then
  printf 'НЕ ИЗМЕРЕНО: путь к киту не задан (CATALYST_PATCH_KIT)\n' >&2
  exit 3
fi
if [ ! -f "$PATCH_JS" ]; then
  printf 'НЕ ИЗМЕРЕНО: кит не найден по пути %s\n' "$CATALYST_PATCH_KIT" >&2
  exit 3
fi

python3 - "$REGISTER" "$PATCH_JS" <<'PY'
import hashlib
import pathlib
import re
import sys

register = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
patch = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")

LIT = r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\""


def chain(src, decl):
    # Цепочка строковых литералов, соединённых '+'; режется по разрыву цепочки,
    # а не по ';' -- декларация в моде живёт на ASI, без точки с запятой.
    i = src.index(decl)
    pos = i
    parts = []
    while True:
        m = re.compile(LIT).search(src, pos)
        if m is None:
            raise SystemExit("ПРИБОР НЕДОСТУПЕН: литерал не найден у " + decl)
        if pos != i and not re.fullmatch(r"\s*\+\s*", src[pos:m.start()]):
            break
        parts.append(m.group(1) if m.group(1) is not None else m.group(2))
        pos = m.end()
    if not parts:
        raise SystemExit("ПРИБОР НЕДОСТУПЕН: пустая цепочка у " + decl)
    return "".join(parts)


rule = chain(patch, "const RULE =")
coach = chain(register, "const COACHING =")
pin = chain(register, "const COACHING_SPLICE_SHA256 =")
h_rule = hashlib.sha256(rule.encode("utf-8")).hexdigest()
h_coach = hashlib.sha256(coach.encode("utf-8")).hexdigest()

if h_rule == pin and h_coach == pin:
    print("splice-parity: 1 passed (RULE шага 26 == COACHING == пин, len=%d)" % len(rule))
    sys.exit(0)

print("SPLICE_PARITY_RED: паритет домов правила отмены диспатча нарушен")
print("  patch RULE : len=%d sha256=%s" % (len(rule), h_rule))
print("  mod  COACH : len=%d sha256=%s" % (len(coach), h_coach))
print("  пин        : %s" % pin)
if rule == coach:
    print("  дома побайтово согласны, но пин не совпадает: пин протух --")
    print("  при намеренной смене формулировки правят ОБА дома И пин вместе")
else:
    n = min(len(rule), len(coach))
    k = next((x for x in range(n) if rule[x] != coach[x]), None)
    if k is None:
        # CONSTRAINT: один текст -- строгий префикс другого. Расходящейся
        # ПОЗИЦИИ здесь не существует, и обращение по индексу n дало бы выход
        # за границу: отказ прибора вместо названного вердикта.
        print("  общая часть длиной %d совпадает; расходится ДЛИНА: "
              "patch=%d mod=%d" % (n, len(rule), len(coach)))
    else:
        print("  первая расходящаяся позиция: %d" % k)
        print("  patch: %r U+%04X" % (rule[k], ord(rule[k])))
        print("  mod  : %r U+%04X" % (coach[k], ord(coach[k])))
        lo = max(0, k - 25)
        print("  контекст: %r" % (rule[lo:k] + "[" + rule[k] + "|" + coach[k] + "]" + rule[k + 1:k + 26],))
    total = sum(1 for x in range(n) if rule[x] != coach[x]) + abs(len(rule) - len(coach))
    print("  всего расходящихся позиций: %d" % total)
sys.exit(1)
PY
RC=$?
exit "$RC"
