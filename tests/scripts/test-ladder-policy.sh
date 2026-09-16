#!/usr/bin/env bash
# Стенд политики лестниц замены модели: предмет -- tests/scripts/ladder-policy.py
# на БОЕВЫХ данных. Реестр проб берётся по порядку (описан в самом
# инструменте): env CATALYST_PROBES_REGISTRY -> соседний канон
# ../Catalyst-CC-Patch/probes/probes.toml -> боевой ~/.claude/probes/probes.toml;
# таблица допуска -- hooks/routing-table.toml. Правила (допуск клетки,
# запрет Anthropic-носителей) и коды возврата описаны в инструменте; стенд
# транслирует его исход дословно, не пересказывая.
#
# --self-check гоняет зубы прибора на синтетических входах (офлайн: ни сети,
# ни боевых домов) и сверяет их число с пином ниже.
#
# Коды по контракту агрегатора (tests/run-all.sh):
#   0 -- зелёный: ОДНА итоговая строка прибора (число лестниц + имя файла);
#   1 -- нарушение правила: клетка/ступень/правило названы дословно;
#   2 -- прибор недоступен (нет python3 / инструмента / реестра или таблицы);
#   3 -- НЕ ИЗМЕРЕНО: реестр без единой таблицы [failover.*] (ПУСТО != НОЛЬ)
#        либо --self-check ответил без доказанного числа зубов.
#
# CONSTRAINT: ожидаемое число зубов объявлено ЗДЕСЬ и больше нигде --
# самопроверка печатает фактически прогнанное число, и расхождение в любую
# сторону это rc=3, а не зелёный (форма test-judge-bridge.sh).
set -u

EXPECTED_TEETH=8

if ! command -v python3 >/dev/null 2>&1; then
  printf 'ПРИБОР НЕДОСТУПЕН: нет python3\n' >&2
  exit 2
fi

HERE=$(cd "$(dirname "$0")" && pwd) || exit 2
TOOL="$HERE/ladder-policy.py"
if [ ! -f "$TOOL" ]; then
  printf 'ПРИБОР НЕДОСТУПЕН: нет %s\n' "$TOOL" >&2
  exit 2
fi

OUT=$(python3 "$TOOL" "$@" 2>&1)
RC=$?

if [ "${1:-}" = "--self-check" ]; then
  if [ "$RC" -eq 1 ]; then
    printf 'КРАСЕН ladder-policy --self-check (rc=1):\n%s\n' "$OUT"
    exit 1
  fi
  if [ "$RC" -ne 0 ]; then
    printf 'ПРИБОР НЕДОСТУПЕН: ladder-policy --self-check rc=%s:\n%s\n' "$RC" "$OUT" >&2
    exit 2
  fi
  # rc=0 обязан ДОКАЗЫВАТЬ число зубов строкой «зубов N».
  TEETH=''
  if [[ "$OUT" =~ зубов[[:space:]]+([0-9]+) ]]; then
    TEETH="${BASH_REMATCH[1]}"
  fi
  if [ -z "$TEETH" ]; then
    printf 'НЕ ИЗМЕРЕНО: rc=0 без доказанного числа зубов (в выводе нет «зубов N»):\n%s\n' "$OUT"
    exit 3
  fi
  if [ "$TEETH" -ne "$EXPECTED_TEETH" ]; then
    printf 'НЕ ИЗМЕРЕНО: зубов в выводе %s, а стенд ожидает %s (зуб выпал или прибавился):\n%s\n' \
      "$TEETH" "$EXPECTED_TEETH" "$OUT"
    exit 3
  fi
  printf '%s\n' "$OUT"
  exit 0
fi

# Боевой прогон: исход инструмента уходит дословно, код -- как есть.
case "$RC" in
  0|1|3)
    printf '%s\n' "$OUT"
    exit "$RC"
    ;;
  2)
    printf '%s\n' "$OUT" >&2
    exit 2
    ;;
  *)
    printf 'ПРИБОР НЕДОСТУПЕН: ladder-policy.py ответил неизвестным кодом %s:\n%s\n' "$RC" "$OUT" >&2
    exit 2
    ;;
esac
