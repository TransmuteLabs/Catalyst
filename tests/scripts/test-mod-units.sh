#!/usr/bin/env bash
# Зубы мода catalyst-probes на ОФИЦИАЛЬНОМ харнесе образа: `claude plugin test`
# гоняет каждый *.test.ts в дочернем процессе бинарника, в среде, подобной среде
# хуков (движковое `$`, mock.clock/mock.env, импорт "claude-code/testing").
# Прежний прибор -- node --test --experimental-strip-types -- мёртв: тесты
# импортируют "claude-code/testing", которого у node нет.
#
# CONSTRAINT: коды возврата -- только 0/1/2/3, как понимает tests/run-all.sh:
# 0 -- зелёный, ровно ОДНОЙ строкой с числом прошедших тестов;
# 1 -- красный: провалившиеся тесты (вывод харнеса ДОСЛОВНО) либо рассинхрон
#     домов версии мода;
# 2 -- ПРИБОР НЕДОСТУПЕН (нет бинарника; команда не регистрируется; ценз версии
#     недействителен) с названной причиной -- молчаливый пропуск невозможен;
# 3 -- НЕ ИЗМЕРЕНО: код 0 без ДОКАЗАННОГО числа выполненных тестов и файлов
#     (ПУСТО != НОЛЬ).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PLUGIN_DIR="$ROOT/plugins/catalyst-probes"
TESTS_DIR="$PLUGIN_DIR/tests"
REGISTER="$PLUGIN_DIR/hooks/register.ts"
MANIFEST="$PLUGIN_DIR/.claude-plugin/plugin.json"
UNITS="$TESTS_DIR/units.test.ts"

# Пин числа зубов: молча выпавший тест обязан быть виден. Поднимается ВМЕСТЕ с
# добавлением тестов, в этой же строке -- другого дома у числа нет.
EXPECTED_TESTS=229

# --- прибор ------------------------------------------------------------------

BIN="${CLAUDE_BIN:-}"
if [ -z "$BIN" ]; then
  BIN="$(command -v claude 2>/dev/null || true)"
fi
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  printf 'ПРИБОР НЕДОСТУПЕН: бинарник claude не найден (PATH или CLAUDE_BIN)\n' >&2
  exit 2
fi

# --- ценз домов версии мода --------------------------------------------------
# Версия объявлена в ТРЁХ местах, и раннер официального харнеса манифест прочесть
# не может (JSON-импорт парсится как JS, node:fs запрещён) -- поэтому сверка
# живёт здесь, а не в самих тестах.

V_CODE="$(sed -n 's/^export const MOD_VERSION = "\([^"]*\)".*$/\1/p' "$REGISTER" | head -n 1)"
V_MANIFEST="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*$/\1/p' "$MANIFEST" | head -n 1)"
V_TEST="$(sed -n 's/.*expect(MOD_VERSION)\.toBe("\([^"]*\)").*/\1/p' "$UNITS" | head -n 1)"

if [ -z "$V_CODE" ] || [ -z "$V_MANIFEST" ] || [ -z "$V_TEST" ]; then
  printf 'ПРИБОР НЕДОСТУПЕН: ценз версии недействителен -- форма объявления сменилась (код=%s манифест=%s тест=%s)\n' \
    "${V_CODE:-НЕТ}" "${V_MANIFEST:-НЕТ}" "${V_TEST:-НЕТ}" >&2
  exit 2
fi

if [ "$V_CODE" != "$V_MANIFEST" ] || [ "$V_CODE" != "$V_TEST" ]; then
  printf 'ВЕРСИЯ_МОДА_РАЗОШЛАСЬ: register.ts=%s plugin.json=%s units.test.ts=%s\n' \
    "$V_CODE" "$V_MANIFEST" "$V_TEST" >&2
  printf 'Без бампа ОБЪЯВЛЕННОЙ version правки мода не доезжают в бой (дверь #179).\n' >&2
  exit 1
fi

# CONSTRAINT: consultBg не экспортируется, поэтому функциональные зубы не
# наблюдают его проводку. Исходник читается здесь: node:fs в харнесе запрещён.
python3 - "$REGISTER" <<'PY'
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1]).read_text()
try:
    start = source.index("async function consultBg(")
    build = source.index("    let ladder = rungsOf(cfg, modelEnv)", start)
    record = source.index("    rec.ladder = ladder.map", build)
    loop = source.index("    for (let i = 0; i < ladder.length; i++)", record)
    wiring = source[build:record]
    expected = (
        r"^    let ladder = rungsOf\(cfg, modelEnv\)\n"
        r"    const cooldown = rungsAfterCooldown\(ladder, await nowMs\(\$\)\)\n"
        r"    ladder = cooldown\.ladder\n"
        r"    Object\.assign\(rec, cooldown\.evidence\)\n$"
    )
    assert re.fullmatch(expected, wiring), "фильтр или улика не подключены перед rec.ladder"
    assert build < record < loop, "фильтр не предшествует циклу"
    body = source[loop:source.index("    rec.dtMs =", loop)]
    assert "let rungBudgetClipped = false\n      try {" in body, "признак урезания недоступен в catch"
    assert "rungBudgetClipped = tmo !== rungTmo" in body, "урезание не измерено по бюджету ступени"
    timeout_branch = (
        "if (noteRungTimeout(used, es, await nowMs($), undefined, rungBudgetClipped)) {\n"
        "          rec.rungTimeouts = num(rec.rungTimeouts, 0, 0) + 1\n"
        '          if (rungBudgetClipped) rec["rungDeadlineClipped_" + used] = true\n'
        "        }"
    )
    assert timeout_branch in body, "метка, счётчик или улика урезания не подключены к дедлайну"
except (ValueError, AssertionError) as error:
    print("rung-cooldown-wiring: FAIL: " + str(error), file=sys.stderr)
    sys.exit(1)
PY
WIRING_RC=$?
if [ "$WIRING_RC" -ne 0 ]; then
  exit "$WIRING_RC"
fi

# --- ступень 2: кросс-репозиторный паритет правила (волна #116) ----------------
# Ступень 1 живёт в юнитах (sha-пин; раннер файлов кита не читает). Эта ступень
# сверяет пин с САМИМ китом, когда путь задан. Коды скрипта согласованы здесь:
# при заданной CATALYST_PATCH_KIT любой его ненулевой код проваливает прогон.
if [ -n "${CATALYST_PATCH_KIT:-}" ]; then
  bash "$PLUGIN_DIR/tests/scripts/check-splice-parity.sh"
  SPLICE_RC=$?
  if [ "$SPLICE_RC" -ne 0 ]; then
    exit "$SPLICE_RC"
  fi
else
  printf 'splice-parity: НЕ ИЗМЕРЕНО (CATALYST_PATCH_KIT не задана; ступень 2 не исполнена)\n'
fi

# --- ступень 3: поверхность мода по официальному статическому разбору --------
# Хост вычисляет поверхность register.ts сам: подписки, $.-вызовы, записи и
# чтения env; пин снимком закрывает молчаливую потерю подписки, новый op или
# новое чтение окружения. CONSTRAINT: снимок -- артефакт ПРИЁМКИ, живёт ВНЕ
# plugins/** (внутри каталога мода требовал бы бампа version и уехал бы в
# доставку) и при отсутствии НЕ пересоздаётся: автосоздание -- тавтология,
# прибор сверял бы выдачу с самой собой.

MOD_SURFACE="$ROOT/tests/fixtures/mod-surface.txt"
if [ ! -s "$MOD_SURFACE" ]; then
  printf 'ПРИБОР НЕДОСТУПЕН: снимку поверхности нечем сверять (%s нет или пуст)\n' "$MOD_SURFACE" >&2
  exit 2
fi

VAL_OUT="$(mktemp "${TMPDIR:-/tmp}/mod-surface-out.XXXXXX")"
# Ручка обязательна по той же причине, что и у `plugin test`: без неё ветка
# мод-подкоманд у образа не берётся вовсе.
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 "$BIN" plugin validate --json --strict "$PLUGIN_DIR" >"$VAL_OUT" 2>&1 </dev/null
VAL_RC=$?

if LC_ALL=C grep -q "unknown command 'validate'" "$VAL_OUT"; then
  printf 'ПРИБОР НЕДОСТУПЕН: %s не регистрирует `plugin validate` (раскатка мод-хуков выключена у этого образа)\n' "$BIN" >&2
  tail -n 8 "$VAL_OUT" >&2
  rm -f "$VAL_OUT"
  exit 2
fi

python3 - "$VAL_OUT" "$MOD_SURFACE" "$VAL_RC" <<'PY'
import json
import pathlib
import sys

raw_path, snapshot_path, bin_rc = sys.argv[1], sys.argv[2], sys.argv[3]
raw = pathlib.Path(raw_path).read_text(errors="replace")
snapshot = pathlib.Path(snapshot_path).read_text().split("\n")
if snapshot and snapshot[-1] == "":
    snapshot = snapshot[:-1]

def refuse(code, message):
    print(message, file=sys.stderr)
    for line in raw.splitlines()[-12:]:
        print(line, file=sys.stderr)
    sys.exit(code)

try:
    doc = json.loads(raw)
except ValueError:
    if bin_rc != "0":
        refuse(2, "ПРИБОР НЕДОСТУПЕН: бинарник не ответил (код %s), JSON не получен:" % bin_rc)
    refuse(3, "НЕ ИЗМЕРЕНО: вывод plugin validate не разобран как JSON (код %s):" % bin_rc)

if not isinstance(doc, dict) or not isinstance(doc.get("contents"), list):
    refuse(3, "НЕ ИЗМЕРЕНО: JSON без объекта/contents[]")

errors = []
manifest = doc.get("manifest")
if isinstance(manifest, dict) and manifest.get("errors"):
    errors.append("manifest.errors: " + json.dumps(manifest["errors"], ensure_ascii=False))
notes = []
for element in doc["contents"]:
    if not isinstance(element, dict):
        continue
    if element.get("errors"):
        errors.append(
            "contents[%s].errors: %s" % (
                element.get("type", "?"),
                json.dumps(element["errors"], ensure_ascii=False),
            )
        )
    if element.get("type") == "hooks" and isinstance(element.get("notes"), list):
        notes.extend(str(note) for note in element["notes"])

if doc.get("success") is not True or errors:
    print("ПОВЕРХНОСТЬ_МОДА_НЕПРИГОДНА: success=%s" % json.dumps(doc.get("success")), file=sys.stderr)
    for line in errors:
        print(line, file=sys.stderr)
    for line in raw.splitlines()[-20:]:
        print(line, file=sys.stderr)
    sys.exit(1)

if not notes:
    refuse(3, "НЕ ИЗМЕРЕНО: у элемента contents[] с type == hooks заметок нет (ПУСТО != НОЛЬ)")

if notes != snapshot:
    print("ПОВЕРХНОСТЬ_МОДА_РАЗОШЛАСЬ: живая выдача против снимка %s" % snapshot_path, file=sys.stderr)
    for i in range(max(len(notes), len(snapshot))):
        was = snapshot[i] if i < len(snapshot) else "<строки нет>"
        now = notes[i] if i < len(notes) else "<строки нет>"
        if was != now:
            print("  строка %d:" % (i + 1), file=sys.stderr)
            print("    было:  %s" % was, file=sys.stderr)
            print("    стало: %s" % now, file=sys.stderr)
    sys.exit(1)

# Разложение счётчиков идёт ПОСЛЕ сверки со снимком, поэтому недостающий
# префикс означает не расхождение мода, а смену формата заметок у хоста:
# такой исход неизмерим (3), а не красен (1) -- иначе отказ прибора читался
# бы как вина мода.
def counted(prefix):
    for line in notes:
        if line.startswith(prefix):
            items = [item for item in line[len(prefix):].split(", ") if item]
            return len(items)
    return None

hooks_n = counted("./register.ts hooks: ")
calls_n = counted("./register.ts calls: ")
env_n = counted("./register.ts env reads: ")
if hooks_n is None or calls_n is None or env_n is None:
    refuse(3, "НЕ ИЗМЕРЕНО: формат заметок хоста сменился -- префикса нет "
              "(подписки=%s вызовы=%s чтения=%s)" % (hooks_n, calls_n, env_n))

print("mod-surface: %d проекции сверены (подписок %d, вызовов %d, чтений env %d)"
      % (len(notes), hooks_n, calls_n, env_n))
PY
MOD_SURFACE_RC=$?
rm -f "$VAL_OUT"
if [ "$MOD_SURFACE_RC" -ne 0 ]; then
  exit "$MOD_SURFACE_RC"
fi

# --- перечень файлов зубов ---------------------------------------------------
# Знаменатель берётся из ФАЙЛОВОЙ СИСТЕМЫ, а не из памяти: файл, который харнес
# не подхватил, иначе неотличим от отсутствующего.

FILES_N=0
for f in "$TESTS_DIR"/*.test.ts "$TESTS_DIR"/*.test.tsx; do
  [ -e "$f" ] || continue
  FILES_N=$((FILES_N + 1))
done
if [ "$FILES_N" -eq 0 ]; then
  printf 'ПРИБОР НЕДОСТУПЕН: в %s нет ни одного *.test.ts\n' "$TESTS_DIR" >&2
  exit 2
fi

# --- прогон ------------------------------------------------------------------

OUT="$(mktemp "${TMPDIR:-/tmp}/mod-units-out.XXXXXX")"
trap 'rm -f "$OUT"' EXIT

# Ручка обязательна: при выключенной раскатке мод-хуков ветка перехвата
# `plugin test` не берётся вовсе, и argv проваливается в разбор подкоманд.
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 "$BIN" plugin test "$PLUGIN_DIR" >"$OUT" 2>&1 </dev/null
RC=$?

if LC_ALL=C grep -q "unknown command 'test'" "$OUT"; then
  printf 'ПРИБОР НЕДОСТУПЕН: %s не регистрирует `plugin test` (раскатка мод-хуков выключена у этого образа)\n' "$BIN" >&2
  exit 2
fi
if LC_ALL=C grep -q 'no hooks module to load\|no \*\.test\.ts' "$OUT"; then
  printf 'ПРИБОР НЕДОСТУПЕН: харнес не нашёл предмет: %s\n' "$(tr '\n' ' ' <"$OUT")" >&2
  exit 2
fi

# Исполнение доказывается ЧИСЛАМИ из сводки, а не кодом возврата.
PASS_N="$(sed -n 's/^[[:space:]]*\([0-9][0-9]*\) pass$/\1/p' "$OUT" | tail -n 1)"
FAIL_N="$(sed -n 's/^[[:space:]]*\([0-9][0-9]*\) fail$/\1/p' "$OUT" | tail -n 1)"
# CONSTRAINT: у одного файла харнес пишет "across 1 file." -- в ЕДИНСТВЕННОМ
# числе; регексп на "files" слепнет ровно на прогоне единственного файла.
RAN_N="$(sed -n 's/^Ran \([0-9][0-9]*\) tests across [0-9][0-9]* files\{0,1\}\..*$/\1/p' "$OUT" | tail -n 1)"
RAN_F="$(sed -n 's/^Ran [0-9][0-9]* tests across \([0-9][0-9]*\) files\{0,1\}\..*$/\1/p' "$OUT" | tail -n 1)"

if [ -z "${PASS_N:-}" ] || [ -z "${RAN_N:-}" ] || [ -z "${RAN_F:-}" ]; then
  printf 'НЕ ИЗМЕРЕНО: сводка харнеса не разобрана (pass=%s ran=%s files=%s, код %s)\n' \
    "${PASS_N:-нет}" "${RAN_N:-нет}" "${RAN_F:-нет}" "$RC" >&2
  cat "$OUT" >&2
  exit 3
fi

if [ "${FAIL_N:-0}" -ne 0 ] || [ "$RC" -ne 0 ]; then
  cat "$OUT"
  exit 1
fi

if [ "$RAN_F" -ne "$FILES_N" ]; then
  printf 'НЕ ИЗМЕРЕНО: харнес прогнал %s файлов, а в %s их %s -- файл зубов молча не подхвачен\n' \
    "$RAN_F" "$TESTS_DIR" "$FILES_N" >&2
  exit 3
fi

if [ "$RAN_N" -ne "$EXPECTED_TESTS" ]; then
  printf 'НЕ ИЗМЕРЕНО: прогнано %s зубов, объявлено %s (EXPECTED_TESTS в этом файле)\n' \
    "$RAN_N" "$EXPECTED_TESTS" >&2
  exit 3
fi

if [ "$PASS_N" -ne "$RAN_N" ]; then
  printf 'НЕ ИЗМЕРЕНО: прошло %s из %s прогнанных -- остаток не объявлен ни провалом, ни пропуском\n' \
    "$PASS_N" "$RAN_N" >&2
  exit 3
fi

printf 'mod-units: %s passed (%s файлов, официальный харнес %s)\n' "$PASS_N" "$RAN_F" "$V_CODE"
printf 'rung-cooldown-wiring: 1 passed\n'
exit 0
