#!/usr/bin/env bash
# Зубы модульных функций мода catalyst-probes (hooks/register.ts) ВНЕ образа:
# node --test --experimental-strip-types на plugins/catalyst-probes/tests/.
#
# CONSTRAINT: коды возврата -- только 0/1/2/3, как понимает tests/run-all.sh:
# 0 -- зелёный, ровно ОДНОЙ строкой с числом прошедших тестов;
# 1 -- красный, вывод node --test ДОСЛОВНО;
# 2 -- ПРИБОР НЕДОСТУПЕН (нет node или флага) с названной причиной -- молчаливый
#     пропуск невозможен;
# 3 -- НЕ ИЗМЕРЕНО: код 0 без ДОКАЗАННОГО числа выполненных тестов (ПУСТО != НОЛЬ).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
TEST_FILE="$(cd "$HERE/../.." && pwd)/plugins/catalyst-probes/tests/units.test.ts"

if ! command -v node >/dev/null 2>&1; then
  printf 'ПРИБОР НЕДОСТУПЕН: node не найден в PATH\n' >&2
  exit 2
fi

PROBE_ERR="$(mktemp "${TMPDIR:-/tmp}/mod-units-probe.XXXXXX")"
OUT="$(mktemp "${TMPDIR:-/tmp}/mod-units-out.XXXXXX")"
trap 'rm -f "$PROBE_ERR" "$OUT"' EXIT

# Флаг поддержан? Проба на пустом коде: unsupported CLI-флаг -- это ненулевой
# код и "bad option" в stderr, а не ошибка нашего предмета.
if ! node --experimental-strip-types -e "" 2>"$PROBE_ERR"; then
  printf 'ПРИБОР НЕДОСТУПЕН: node %s не поддерживает --experimental-strip-types: %s\n' \
    "$(node --version 2>/dev/null || echo '?')" "$(tr '\n' ' ' <"$PROBE_ERR")" >&2
  exit 2
fi

node --test --experimental-strip-types --test-reporter=tap "$TEST_FILE" >"$OUT" 2>&1
RC=$?

if [ "$RC" -ne 0 ]; then
  cat "$OUT"
  exit 1
fi

# Исполнение доказывается ЧИСЛОМ из сводки TAP, а не кодом 0.
TESTS_N="$(sed -n 's/^# tests \([0-9][0-9]*\)$/\1/p' "$OUT" | tail -n 1)"
PASS_N="$(sed -n 's/^# pass \([0-9][0-9]*\)$/\1/p' "$OUT" | tail -n 1)"
FAIL_N="$(sed -n 's/^# fail \([0-9][0-9]*\)$/\1/p' "$OUT" | tail -n 1)"

if [ -z "${TESTS_N:-}" ] || [ "${TESTS_N:-0}" -eq 0 ] || [ -z "${PASS_N:-}" ] || [ "${PASS_N:-0}" -eq 0 ]; then
  printf 'НЕ ИЗМЕРЕНО: node --test отработал без доказанных выполненных тестов (tests=%s pass=%s)\n' \
    "${TESTS_N:-нет}" "${PASS_N:-нет}" >&2
  exit 3
fi

# Код 0 при заявленных провалах -- не зелёный (защита от пустой арифметики).
if [ "${FAIL_N:-0}" -ne 0 ]; then
  cat "$OUT"
  exit 1
fi

printf 'mod-units: %s passed\n' "$PASS_N"
exit 0
