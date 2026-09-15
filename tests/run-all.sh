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
# CONSTRAINT: lint.py идёт отдельной строкой ВНЕ счёта стендов (гейт числа --
# про маску), но входит в зелёные/красные своды и в код возврата: красный линт
# не имеет права быть невидимым в сводке.
set -u

EXPECTED_STANDS=8

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

if [ "${#stands[@]}" -ne "$EXPECTED_STANDS" ]; then
  printf 'run-all: ЧИСЛО_СТЕНДОВ_НЕ_СОШЛОСЬ: по маске tests/scripts/test-*.sh ожидалось %s, найдено %s\n' "$EXPECTED_STANDS" "${#stands[@]}"
  if [ "${#stands[@]}" -gt 0 ]; then
    for s in "${stands[@]}"; do
      printf '  найдено: %s\n' "$s"
    done
  fi
  exit 2
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
