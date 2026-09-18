#!/usr/bin/env bash
# Стенд политики лестниц замены модели: предмет -- tests/scripts/ladder-policy.py
# на БОЕВЫХ данных. Реестр проб берётся по порядку (описан в самом
# инструменте): env CATALYST_PROBES_REGISTRY -> соседний канон
# ../Catalyst-CC-Patch/probes/probes.toml -> боевой ~/.claude/probes/probes.toml;
# таблица допуска -- hooks/routing-table.toml. ТРИ правила (допуск клетки,
# запрет Anthropic-носителей, пин эффорта по [pins]), разбор элемента ступени
# и коды возврата описаны в инструменте; стенд транслирует его исход дословно,
# не пересказывая.
#
# --self-check гоняет зубы прибора на синтетических входах (офлайн: ни сети,
# ни боевых домов) и зубы оболочки на копии стенда с поддельным прибором;
# два числа сверяются с отдельными пинами ниже.
#
# Коды по контракту агрегатора (tests/run-all.sh):
#   0 -- зелёный: ОДНА итоговая строка прибора. Она несёт число лестниц,
#        ступеней, ступеней С ОБЪЯВЛЕННЫМ ЭФФОРТОМ, имя файла и исход каждого
#        правила. При нуле ступеней с эффортом правило-3 объявляется НЕ
#        ИЗМЕРЕННЫМ ВНУТРИ кода 0: знаменатель пуст, а пусто не есть ноль;
#   1 -- нарушение правила: клетка/ступень/правило названы дословно;
#   2 -- прибор недоступен (нет python3 / инструмента / реестра или таблицы);
#   3 -- НЕ ИЗМЕРЕНО: реестр без единой таблицы [failover.*] (ПУСТО != НОЛЬ)
#        либо --self-check ответил без доказанного числа зубов.
#
# CONSTRAINT: ожидаемое число зубов объявлено ЗДЕСЬ и больше нигде --
# самопроверка печатает фактически прогнанное число, и расхождение в любую
# сторону это rc=3, а не зелёный (форма test-judge-bridge.sh).
set -u

EXPECTED_TEETH=33
EXPECTED_SHELL_TEETH=10

shell_self_check() {
  local work rc
  work=$(mktemp -d "${TMPDIR:-/tmp}/ladder-policy-shell.XXXXXX") || return 2
  if ! cp "$0" "$work/test-ladder-policy.sh"; then
    rm -rf "$work"
    return 2
  fi
  python3 - "$work" "$EXPECTED_TEETH" <<'PY'
import os
from pathlib import Path
import re
import subprocess
import sys

work = Path(sys.argv[1])
expected_teeth = int(sys.argv[2])
stand = work / "test-ladder-policy.sh"
tool = work / "ladder-policy.py"
env = dict(os.environ, CATALYST_LADDER_SHELL_TEETH="0")
teeth = []


def tooth(name, ok, detail):
    teeth.append(bool(ok))
    print(f"зуб оболочки {len(teeth)} {name}: "
          + ("зелёный" if ok else f"КРАСЕН — {detail}"))


def run(rc, text, stream="stdout", self_check=False):
    tool.write_text(
        f"import sys\nprint({text!r}, file=sys.{stream})\nsys.exit({rc})\n",
        encoding="utf-8",
    )
    args = ["bash", str(stand)] + (["--self-check"] if self_check else [])
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=10)
    return result.returncode, result.stdout, result.stderr


def expect(name, result, wanted):
    tooth(name, result == wanted, f"получено={result!r}, ожидалось={wanted!r}")


text = "первая строка поддельного прибора\nвторая строка"
for rc in (0, 1, 3):
    expect(f"боевой код {rc} дословно", run(rc, text), (rc, text + "\n", ""))
expect("боевой код 2 в stderr", run(2, text, stream="stderr"),
       (2, "", text + "\n"))
expect("неизвестный код 7 -> 2", run(7, text),
       (2, "", "ПРИБОР НЕДОСТУПЕН: ladder-policy.py ответил неизвестным кодом 7:\n"
        + text + "\n"))
expect("самопроверка rc=1 красна", run(1, text, self_check=True),
       (1, "КРАСЕН ladder-policy --self-check (rc=1):\n" + text + "\n", ""))
expect("самопроверка rc=7 недоступна", run(7, text, self_check=True),
       (2, "", "ПРИБОР НЕДОСТУПЕН: ladder-policy --self-check rc=7:\n" + text + "\n"))
expect("самопроверка без числа не измерена", run(0, text, self_check=True),
       (3, "НЕ ИЗМЕРЕНО: rc=0 без доказанного числа зубов (в выводе нет «зубов N»):\n"
        + text + "\n", ""))
wrong_count = f"зубов {expected_teeth + 1}, все зелёны"
expect("самопроверка мимо пина не измерена", run(0, wrong_count, self_check=True),
       (3, f"НЕ ИЗМЕРЕНО: зубов в выводе {expected_teeth + 1}, а стенд ожидает "
        f"{expected_teeth} (зуб выпал или прибавился):\n{wrong_count}\n", ""))

# Второй уровень обязан быть наблюдаемым, даже если копия погасит его ошибку.
bin_dir = work / "bin"
bin_dir.mkdir()
witness = work / "mktemp.calls"
probe = bin_dir / "mktemp"
probe.write_text(
    f"#!{sys.executable}\n"
    f"with open({str(witness)!r}, 'a') as out:\n    out.write('called\\n')\n"
    "raise SystemExit(2)\n", encoding="utf-8",
)
probe.chmod(0o755)
env["PATH"] = str(bin_dir) + os.pathsep + env.get("PATH", os.defpath)
control = subprocess.run(["mktemp", "-d"], env=env, capture_output=True, text=True)
control_calls = witness.read_text(encoding="utf-8")
result = run(0, f"зубов {expected_teeth}, все зелёны", self_check=True)
rc, out, err = result
calls = witness.read_text(encoding="utf-8")
tooth("стоп-признак: без второго уровня и без ложной зелени",
      control.returncode == 2 and control_calls == "called\n" and calls == control_calls
      and rc == 3 and err == ""
      and "НЕ ИЗМЕРЕНО: число зубов оболочки не доказано" in out
      and re.search(r"(?m)^зубов оболочки [0-9]+", out) is None,
      f"контроль={control.returncode}, вызовы={calls!r}, получено={result!r}")

if all(teeth):
    print(f"зубов оболочки {len(teeth)}, все зелёны")
    sys.exit(0)
print(f"зубов оболочки {len(teeth)}, красных {teeth.count(False)}")
sys.exit(1)
PY
  rc=$?
  rm -rf "$work"
  return "$rc"
}

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
  SHELL_OUT=''
  # Маркер гасит только рекурсию самопроверки, не выбор прибора и не счётный гейт.
  if [ "${CATALYST_LADDER_SHELL_TEETH:-1}" != "0" ]; then
    SHELL_OUT=$(shell_self_check 2>&1)
    SHELL_RC=$?
    if [ "$SHELL_RC" -eq 1 ]; then
      printf 'КРАСЕН ladder-policy: зубы оболочки:\n%s\n' "$SHELL_OUT"
      exit 1
    fi
    if [ "$SHELL_RC" -ne 0 ]; then
      printf 'ПРИБОР НЕДОСТУПЕН: зубы оболочки rc=%s:\n%s\n' "$SHELL_RC" "$SHELL_OUT" >&2
      exit 2
    fi
  fi
  SHELL_TEETH=''
  if [[ "$SHELL_OUT" =~ зубов[[:space:]]+оболочки[[:space:]]+([0-9]+) ]]; then
    SHELL_TEETH="${BASH_REMATCH[1]}"
  fi
  if [ -z "$SHELL_TEETH" ]; then
    printf 'НЕ ИЗМЕРЕНО: число зубов оболочки не доказано\n%s\n' "$SHELL_OUT"
    exit 3
  fi
  if [ "$SHELL_TEETH" -ne "$EXPECTED_SHELL_TEETH" ]; then
    printf 'НЕ ИЗМЕРЕНО: зубов оболочки в выводе %s, а стенд ожидает %s:\n%s\n' \
      "$SHELL_TEETH" "$EXPECTED_SHELL_TEETH" "$SHELL_OUT"
    exit 3
  fi
  printf '%s\n' "$SHELL_OUT"
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
