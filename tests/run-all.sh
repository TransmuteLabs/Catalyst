#!/usr/bin/env bash
# Агрегатор стендов семьи: исполняет всё, что нашёл по маске
# tests/scripts/test-*.sh, плюс scripts/lint.py, и печатает сводку.
#
# CONSTRAINT: список стендов НЕ хардкодится -- новый стенд подхватывается сам,
# а взамен работает гейт числа: автообнаружение ловит ДОБАВЛЕННЫЙ стенд, но не
# ловит исчезнувший -- исчезнувший неотличим от «его и не было». Расхождение
# с объявленным числом в любую сторону -- rc=2 («прибор не может мерить»,
# а не «дерево красно»).
#
# CONSTRAINT: пин сверяется с ОТСЛЕЖИВАЕМЫМ набором, а исполняется всё, что
# лежит на диске. Клон получает только отслеживаемое -- его и защищает число.
# Счёт по диску останавливал ЛЮБОЙ коммит в репозитории, пока соседняя дорожка
# держала свой новый стенд незакоммиченным: параллельные дорожки блокировали
# друг друга через общий пин. Нетронутый стенд обязан быть ВИДЕН в выводе, но
# не имеет права краснить чужой коммит; отслеживаемый, пропавший с диска, --
# наоборот, отказ прибора: исполнить его нечем.
#
# CONSTRAINT: без git (прогон идёт из СНИМКА, а кит едет копированием без .git)
# сверяется диск -- прежнее поведение. Режим счёта НАЗЫВАЕТСЯ в каждой строке
# отказа: «сошлось» в двух разных режимах означает разное, и читать их как одно
# нельзя.
#
# CONSTRAINT: lint.py идёт отдельной строкой ВНЕ счёта стендов (гейт числа --
# про маску), но входит в зелёные/красные своды и в код возврата: красный линт
# не имеет права быть невидимым в сводке.
set -u

EXPECTED_STANDS=15

if [ "${CATALYST_STANDS:-}" = "off" ]; then
  printf 'CATALYST_STANDS=off: прогон стендов ПРОПУЩЕН по явной ручке\n'
  exit 0
fi

HERE="$(cd "$(dirname "$0")" && pwd)" || exit 2
ROOT="$(cd "$HERE/.." && pwd)" || exit 2
cd "$ROOT" || exit 2

shopt -s nullglob
stands=(tests/scripts/test-*.sh)
shopt -u nullglob

# Отслеживаемый набор. Ошибка git не глушится: её первая строка называется
# в строке режима, иначе откат на диск выглядел бы штатным.
TRACKED_LIST=""
TRACKED_N=""
GIT_WHY=""
if GIT_OUT="$(git -C "$ROOT" ls-files -- 'tests/scripts/test-*.sh' 2>&1)"; then
  TRACKED_LIST="$GIT_OUT"
  if [ -z "$GIT_OUT" ]; then
    TRACKED_N=0
  else
    TRACKED_N="$(printf '%s\n' "$GIT_OUT" | wc -l | tr -d ' ')"
  fi
else
  GIT_WHY="$(printf '%s' "$GIT_OUT" | head -1)"
fi

if [ -n "$TRACKED_N" ]; then
  COUNT_MODE="отслеживаемых"
  COUNT_N="$TRACKED_N"
else
  COUNT_MODE="на диске (git не ответил: ${GIT_WHY:-причина не названа})"
  COUNT_N="${#stands[@]}"
fi

if [ "$COUNT_N" -ne "$EXPECTED_STANDS" ]; then
  printf 'run-all: ЧИСЛО_СТЕНДОВ_НЕ_СОШЛОСЬ: по маске tests/scripts/test-*.sh ожидалось %s, %s найдено %s\n' "$EXPECTED_STANDS" "$COUNT_MODE" "$COUNT_N"
  if [ -n "$TRACKED_LIST" ]; then
    printf '%s\n' "$TRACKED_LIST" | while IFS= read -r s; do
      [ -n "$s" ] && printf '  отслеживается: %s\n' "$s"
    done
  fi
  if [ "${#stands[@]}" -gt 0 ]; then
    for s in "${stands[@]}"; do
      printf '  на диске: %s\n' "$s"
    done
  fi
  exit 2
fi

# Отслеживаемый, но пропавший с диска -- отказ ПРИБОРА: исполнить его нечем,
# и молчание здесь читалось бы как «стенд зелён».
if [ -n "$TRACKED_LIST" ]; then
  MISSING=""
  printf '%s\n' "$TRACKED_LIST" | while IFS= read -r s; do
    [ -n "$s" ] && [ ! -f "$s" ] && printf '  пропал с диска: %s\n' "$s"
  done > /tmp/.runall-missing.$$
  MISSING="$(cat /tmp/.runall-missing.$$)"
  rm -f /tmp/.runall-missing.$$
  if [ -n "$MISSING" ]; then
    printf 'run-all: СТЕНД_ПРОПАЛ_С_ДИСКА: отслеживаемый стенд не найден, исполнить нечем\n'
    printf '%s\n' "$MISSING"
    exit 2
  fi
fi

# Нетронутый стенд соседней дорожки: ВИДЕН и ИСПОЛНЯЕТСЯ, но пина не двигает.
if [ -n "$TRACKED_LIST" ] && [ "${#stands[@]}" -gt 0 ]; then
  for s in "${stands[@]}"; do
    if ! printf '%s\n' "$TRACKED_LIST" | grep -Fxq -- "$s"; then
      printf 'run-all: НЕОТСЛЕЖИВАЕМЫЙ СТЕНД (исполняется, пина не двигает): %s\n' "$s"
    fi
  done
fi

green=0
red=0
unmeasured=0
# CONSTRAINT: код 3 -- «НЕ ИЗМЕРЕНО»: прибор исправен, но его предмет в этом
# прогоне не мерился (опт-ин не включён -- например, приёмка, тратящая токены).
# Без отдельной категории такой прогон печатался бы как `ok`, и НЕИЗМЕРЕННАЯ
# приёмка выглядела бы пройденной -- ровно тот молчаливый пропуск, против
# которого заведены сами приёмки. Дверь коммита он не краснит, но в сводке
# виден отдельным числом и своим выводом.
run_one() {   # <метка> <команда...>: зелёный -- одной строкой, красный -- дословно
  local label="$1"; shift
  local out rc
  out=$("$@" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    green=$((green+1))
    printf 'ok   %s\n' "$label"
  elif [ "$rc" -eq 3 ]; then
    unmeasured=$((unmeasured+1))
    printf 'НЕ ИЗМЕРЕНО %s:\n%s\n' "$label" "$out"
  else
    red=$((red+1))
    printf 'КРАСЕН %s (rc=%s):\n%s\n' "$label" "$rc" "$out"
  fi
}

for s in "${stands[@]}"; do
  run_one "$s" bash "$s"
done
run_one scripts/lint.py python3 scripts/lint.py

# CONSTRAINT: знаменатель сводки -- ПРИБОРЫ (стенды плюс линт), а не стенды:
# иначе «стендов N, зелёных N+1» читается как арифметическая ошибка, и читатель
# перестаёт доверять счёту. Число стендов названо отдельно -- гейт числа
# сторожит именно его.
printf 'run-all: приборов %s (стендов %s + линт), зелёных %s, красных %s, НЕ ИЗМЕРЕНО %s\n' \
  "$(( ${#stands[@]} + 1 ))" "${#stands[@]}" "$green" "$red" "$unmeasured"
[ "$red" -eq 0 ] || exit 1
exit 0
