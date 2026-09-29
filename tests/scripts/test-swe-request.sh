#!/usr/bin/env bash
# Стенд мода catalyst-swe-request на ОФИЦИАЛЬНОМ харнесе образа: пин sha256
# hooks/register.ts, `claude plugin validate` и `claude plugin test`.
#
# CONSTRAINT: коды возврата -- только 0/1/2, как понимает tests/run-all.sh:
# 0 -- зелёный, ОДНОЙ строкой с числами сводки харнеса;
# 1 -- красный: пин register.ts разошёлся, validate не прошёл, есть провалы,
#     прогнано не EXPECTED_TESTS тестов или не EXPECTED_FILES файлов (вывод
#     харнеса ДОСЛОВНО);
# 2 -- ОТКАЗ ПРИБОРА с названной причиной: нет бинарника claude, нечем считать
#     sha256, команда не регистрируется, вывод не разобран.
# Код 3 («НЕ ИЗМЕРЕНО») здесь не выдаётся: run-all даёт на него rc 0, и
# неразобранная сводка прошла бы дверь коммита как не-красная.
#
# CONSTRAINT: число тестов доказывается СТРОКАМИ сводки харнеса, а не кодом
# возврата; каждая строка сводки («N pass», «M fail», «Ran R tests across F
# file(s).») обязана встретиться РОВНО один раз: отсутствующая строка -- отказ
# прибора, а не ноль (ПУСТО != НОЛЬ).
#
# CONSTRAINT: пин sha256 register.ts сверяется ДО запуска бинарника: подмена
# мода без пересъёмки стенда обязана краснеть этим пином, а не тем, что
# случайно заденет тест. Дайджест самого правила пинит behavior.test.ts --
# здесь пин файла целиком.
set -u
export LC_ALL=C

# Пин числа тестов: молча выпавший тест обязан быть виден. Поднимается ВМЕСТЕ
# с добавлением тестов, в этой же строке -- другого дома у числа нет.
EXPECTED_TESTS=20
# Пин числа файлов тестов мода (*.test.ts): второй файл или пропавший первый виден здесь.
EXPECTED_FILES=1
# Пин файла мода; пересъёмка -- вместе с правкой register.ts.
REGISTER_SHA256=8e8268a88aaeef81868d7eb4de9b33582b74a08a0a851d5223a6e333999c5073

instrument_refuse() {   # <причина>
  printf 'swe-request: ОТКАЗ ПРИБОРА: %s\n' "$1" >&2
  exit 2
}

HERE="$(cd "$(dirname "$0")" && pwd)" || instrument_refuse "каталог стенда не открывается: $(dirname "$0")"
ROOT="$(cd "$HERE/../.." && pwd)" || instrument_refuse "корень дерева не открывается: $HERE/../.."
PLUGIN_DIR="$ROOT/plugins/catalyst-swe-request"
REGISTER="$PLUGIN_DIR/hooks/register.ts"

# --- (c) пин sha256 register.ts ---------------------------------------------
[ -f "$REGISTER" ] || instrument_refuse "предмета нет: $REGISTER"
if command -v sha256sum >/dev/null; then
  DIG_OUT="$(sha256sum -- "$REGISTER")"
  DIG_RC=$?
elif command -v shasum >/dev/null; then
  DIG_OUT="$(shasum -a 256 -- "$REGISTER")"
  DIG_RC=$?
else
  instrument_refuse "нечем считать sha256 (нет ни sha256sum, ни shasum)"
fi
DIG="${DIG_OUT%% *}"
if [ "$DIG_RC" -ne 0 ] || [ "${#DIG}" -ne 64 ]; then
  instrument_refuse "sha256 register.ts не посчитан (код $DIG_RC, вывод [$DIG_OUT])"
fi
case "$DIG" in
  *[!0-9a-f]*) instrument_refuse "sha256 register.ts не разобран: [$DIG]" ;;
esac
if [ "$DIG" != "$REGISTER_SHA256" ]; then
  printf 'swe-request: ПИН_REGISTER_РАЗОШЁЛСЯ: sha256 %s, пин %s (%s)\n' "$DIG" "$REGISTER_SHA256" "$REGISTER"
  exit 1
fi

# --- прибор ------------------------------------------------------------------
BIN="$(command -v claude)" || instrument_refuse "бинарник claude не найден в PATH"
[ -x "$BIN" ] || instrument_refuse "бинарник claude не исполняем: $BIN"

OUT="$(mktemp "${TMPDIR:-/tmp}/swe-request-out.XXXXXX")" || instrument_refuse "mktemp отказ"
trap 'rm -f "$OUT"' EXIT

# --- (a) plugin validate -----------------------------------------------------
"$BIN" plugin validate "$PLUGIN_DIR" >"$OUT" 2>&1 </dev/null
VAL_RC=$?
if grep -q "unknown command 'validate'" "$OUT"; then
  cat "$OUT" >&2
  instrument_refuse "$BIN не регистрирует \`plugin validate\`"
fi
if [ "$VAL_RC" -ne 0 ]; then
  printf 'swe-request: VALIDATE_КРАСЕН: claude plugin validate код %s:\n' "$VAL_RC"
  cat "$OUT"
  exit 1
fi
if ! grep -q 'Validation passed' "$OUT"; then
  cat "$OUT" >&2
  instrument_refuse "plugin validate: код 0 без строки «Validation passed» -- вывод не разобран"
fi

# --- (b) plugin test ---------------------------------------------------------
# Ручка обязательна: при выключенной раскатке мод-хуков ветка перехвата
# `plugin test` не берётся вовсе, и argv проваливается в разбор подкоманд.
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 "$BIN" plugin test "$PLUGIN_DIR" >"$OUT" 2>&1 </dev/null
RC=$?
if grep -q "unknown command 'test'" "$OUT"; then
  cat "$OUT" >&2
  instrument_refuse "$BIN не регистрирует \`plugin test\` (раскатка мод-хуков выключена у этого образа)"
fi

# CONSTRAINT: у одного файла харнес пишет «across 1 file.» -- в ЕДИНСТВЕННОМ
# числе; регексп только на «files» слепнет ровно на этом моде (файл один).
SUMMARY="$(awk '
  /^[[:space:]]*[0-9]+ pass$/ { np++; p = $1 }
  /^[[:space:]]*[0-9]+ fail$/ { nf++; f = $1 }
  /^Ran [0-9]+ tests? across [0-9]+ files?\./ { nr++; r = $2; fl = $5 }
  END { printf "%d %d %d %s %s %s %s\n", np, nf, nr, (np ? p : "-"), (nf ? f : "-"), (nr ? r : "-"), (nr ? fl : "-") }
' "$OUT")" || instrument_refuse "awk разбора сводки отказ"
read -r NP NF NR PASS_N FAIL_N RAN_N RAN_F <<EOF
$SUMMARY
EOF
if [ "$NP" != 1 ] || [ "$NF" != 1 ] || [ "$NR" != 1 ]; then
  cat "$OUT" >&2
  instrument_refuse "сводка plugin test не разобрана: строк pass=$NP fail=$NF ran=$NR (нужно ровно по одной), код $RC"
fi

if [ "$RC" -ne 0 ] || [ "$FAIL_N" -ne 0 ]; then
  printf 'swe-request: PLUGIN_TEST_КРАСЕН: код %s, %s pass, %s fail:\n' "$RC" "$PASS_N" "$FAIL_N"
  cat "$OUT"
  exit 1
fi

if [ "$RAN_F" -ne "$EXPECTED_FILES" ]; then
  printf 'swe-request: ЧИСЛО_ФАЙЛОВ_НЕ_СОШЛОСЬ: прогнано файлов %s, объявлено %s (EXPECTED_FILES в этом файле)\n' \
    "$RAN_F" "$EXPECTED_FILES"
  cat "$OUT"
  exit 1
fi

if [ "$PASS_N" -ne "$EXPECTED_TESTS" ] || [ "$RAN_N" -ne "$EXPECTED_TESTS" ]; then
  printf 'swe-request: ЧИСЛО_ТЕСТОВ_НЕ_СОШЛОСЬ: %s pass, прогнано %s, объявлено %s (EXPECTED_TESTS в этом файле)\n' \
    "$PASS_N" "$RAN_N" "$EXPECTED_TESTS"
  cat "$OUT"
  exit 1
fi

printf 'swe-request: %s pass, %s fail (Ran %s tests across %s file(s); validate ok; register.ts sha256 = пин)\n' \
  "$PASS_N" "$FAIL_N" "$RAN_N" "$RAN_F"
exit 0
