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
EXPECTED_TESTS=167

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
exit 0
