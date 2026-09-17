#!/usr/bin/env bash
# Стенд слоёв эффорта: предмет -- tests/scripts/effort-layers.py.
#
# Прибор сверяет объявленный агенту effort (frontmatter `effort:`) с допуском
# его модели ([pins] в hooks/routing-table.toml), обязательность эффорта
# ([channels.agent].effort_required_for), законность отсутствия эффорта у
# Anthropic-носителей ([quota].guarded_models) и идентичность двух копий
# таблицы (исходник против боевой копии плагина). Красные классы R1-R4,
# счётчики и коды возврата описаны в самом инструменте; стенд транслирует
# его исход, не пересказывая.
#
# CONSTRAINT: стенд НИКОГДА не читает живой дом агентов и живую таблицу --
# все случаи гоняются на СИНЕТИКЕ через инъекцию --agents/--table/--live
# (решение #231: без инъекции зубы не смогут подложить синтетику). Живой
# прогон -- отдельный акт оператора: его исход несёт известный конфликт
# glm-auditor (high против допуска ["max"]), который разрешает только юзер,
# и стенд не имеет права ни маскировать его, ни краснить им дерево,
# идущее независимыми волнами.
#
# Коды по контракту агрегатора (tests/run-all.sh):
#   0 -- зелёный: самопроверка прибора доказала пинное число зубов
#        («зубов N») и все случаи трансляции кодов 0/1/2/3 сошлись;
#   1 -- КРАСЕН: зубы прибора или случаи трансляции ответили не тем кодом;
#   2 -- ПРИБОР НЕДОСТУПЕН: нет python3/инструмента, самопроверка рухнула
#        неизвестным кодом, случай ответил кодом вне {0,1,2,3};
#   3 -- НЕ ИЗМЕРЕНО: rc=0 самопроверки без доказанного числа зубов либо
#        число зубов разошлось с пином (зуб выпал или прибавился).
set -u

# CONSTRAINT: неизвестный аргумент отвергается ДО любой работы (форма
# test-judge-serves.sh, d5240bb).
if [ "$#" -ne 0 ]; then
  printf 'ОТКАЗ ПРИБОРА: неизвестный аргумент: %s; стенд принимает только запуск без аргументов\n' "$1" >&2
  exit 2
fi

# Пин числа зубов прибора: самопроверка печатает фактически прогнанное число,
# расхождение в любую сторону -- rc=3, а не зелёный.
EXPECTED_TEETH=16
# Пин числа случаев трансляции: каждый случай обязан дать ровно один ok.
EXPECTED_CASES=6

if ! command -v python3 >/dev/null 2>&1; then
  printf 'ПРИБОР НЕДОСТУПЕН: нет python3\n' >&2
  exit 2
fi

HERE=$(cd "$(dirname "$0")" && pwd) || exit 2
TOOL="$HERE/effort-layers.py"
if [ ! -f "$TOOL" ]; then
  printf 'ПРИБОР НЕДОСТУПЕН: нет %s\n' "$TOOL" >&2
  exit 2
fi

# --- 1. самопроверка прибора: зубы на синтетике + пин числа ------------------
OUT=$(python3 "$TOOL" --self-check 2>&1)
RC=$?
if [ "$RC" -eq 1 ]; then
  printf 'КРАСЕН effort-layers --self-check (rc=1):\n%s\n' "$OUT"
  exit 1
fi
if [ "$RC" -ne 0 ]; then
  printf 'ПРИБОР НЕДОСТУПЕН: effort-layers --self-check rc=%s:\n%s\n' "$RC" "$OUT" >&2
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

# --- 2. трансляция кодов 0/1/2/3 на синтетике --------------------------------
# Каждый случай -- синтетический мир (свой каталог: агенты, таблица, боевая
# копия) и ОЖИДАЕМЫЙ исход: код, поток (stdout/stderr), несущие подстроки.
BATT=$(python3 - "$TOOL" "$EXPECTED_CASES" <<'PY'
import os
import subprocess
import sys
import tempfile

tool = sys.argv[1]
expected_cases = int(sys.argv[2])
cases = []

TABLE = '''schema_version = 1

[pins]
"glm-5.3" = ["max"]
"grok-4.6" = ["medium", "max"]

[channels.agent]
effort_required_for = ["glm-5.3", "grok-4.6"]

[quota]
guarded_models = ["opus"]
'''


def agent(model=None, effort=None):
    lines = ["---", "name: stand-agent",
             "description: Агент стенда.", "tools: Read"]
    if model is not None:
        lines.append("model: %s" % model)
    if effort is not None:
        lines.append("effort: %s" % effort)
    lines += ["---", ""]
    return "\n".join(lines) + "\n"


def world(tag, agents, table_text=TABLE, live_text=TABLE):
    base = os.path.join(WORK, tag)
    agents_dir = os.path.join(base, "agents")
    os.makedirs(agents_dir)
    for fn, text in agents.items():
        with open(os.path.join(agents_dir, fn), "w", encoding="utf-8") as f:
            f.write(text)
    table = os.path.join(base, "hooks", "routing-table.toml")
    os.makedirs(os.path.dirname(table))
    with open(table, "w", encoding="utf-8") as f:
        f.write(table_text)
    live = os.path.join(base, "live-routing-table.toml")
    if live_text is not None:
        with open(live, "w", encoding="utf-8") as f:
            f.write(live_text)
    return ["--agents", agents_dir, "--table", table, "--live", live]


def run(args):
    r = subprocess.run([sys.executable, tool] + args,
                       capture_output=True, text=True, timeout=60)
    return r.returncode, r.stdout, r.stderr


def case(name, args, want_rc, want_stdout=(), want_stderr=(), not_stdout=()):
    got = run(args)
    ok = got[0] == want_rc
    detail = f"получено rc={got[0]}, ожидался {want_rc}"
    if ok and want_stdout:
        ok = all(s in got[1] for s in want_stdout)
        detail += f"; stdout={got[1]!r}"
    if ok and want_stderr:
        ok = all(s in got[2] for s in want_stderr)
        detail += f"; stderr={got[2]!r}"
    if ok and not_stdout:
        ok = all(s not in got[1] for s in not_stdout)
        detail += f"; stdout={got[1]!r}"
    if want_rc == 2:
        ok = ok and got[1] == ""
    cases.append((name, ok, detail))


with tempfile.TemporaryDirectory(prefix="test-effort-layers-") as WORK:
    # случай 1: согласованное дерево -> код 0, итог в stdout
    case("код 0: согласованное дерево", world("ok", {
        "a.md": agent("glm-5.3", "max"),
        "b.md": agent("grok-4.6", "medium"),
        "c.md": agent("opus", None),
    }), 0, want_stdout=("нарушений 0", "агентов 3"),
        not_stdout=("НАРУШЕНИЕ",))

    # случай 2: эффорт вне допуска -> код 1, агент назван в stdout
    case("код 1: эффорт вне допуска", world("r1", {
        "bad.md": agent("glm-5.3", "high"),
    }), 1, want_stdout=("НАРУШЕНИЕ R1", "bad.md",
                        "'glm-5.3' runs at [max]", "got 'high'"))

    # случай 3: пустой предмет -> код 3, НЕ ИЗМЕРЕНО в stdout
    case("код 3: пустой предмет", world("empty", {}), 3,
         want_stdout=("НЕ ИЗМЕРЕНО",))

    # случай 4: неизвестный аргумент -> код 2 ДО работы, отказ в stderr
    case("код 2: неизвестный аргумент", ["--bogus"], 2,
         want_stderr=("ПРИБОР НЕДОСТУПЕН: неизвестный аргумент: --bogus",))

    # случай 5: копии таблицы разошлись -> код 1 с обеими суммами
    import hashlib
    args5 = world("copies", {"a.md": agent("glm-5.3", "max")},
                  live_text=TABLE + "\n[extra]\nx = 1\n")
    sum_t = hashlib.sha256(open(args5[3], "rb").read()).hexdigest()
    sum_l = hashlib.sha256(open(args5[5], "rb").read()).hexdigest()
    case("код 1: копии таблицы разошлись", args5, 1,
         want_stdout=("НАРУШЕНИЕ R4", sum_t, sum_l))

    # случай 6: боевой копии нет -> код 0, счётчик назван
    args6 = world("nolive", {"a.md": agent("glm-5.3", "max")}, live_text=None)
    case("код 0: боевой копии нет -- счётчик, не красный", args6, 0,
         want_stdout=("боевой копии нет",), not_stdout=("НАРУШЕНИЕ",))

for i, (name, ok, detail) in enumerate(cases, 1):
    if ok:
        print(f"случай {i} {name}: зелёный")
    else:
        print(f"случай {i} {name}: ПРОВАЛ — {detail}")
green = sum(1 for _, ok, _ in cases if ok)
print(f"случаев {len(cases)}, зелёных {green}")
if len(cases) != expected_cases:
    print(f"ПРИБОР НЕДОСТУПЕН: случаев {len(cases)}, а стенд ожидает "
          f"{expected_cases} — батарея потеряла случай")
    sys.exit(2)
sys.exit(0 if green == len(cases) else 1)
PY
)
RC=$?
if [ "$RC" -eq 1 ]; then
  printf 'КРАСЕН effort-layers: трансляция кодов:\n%s\n' "$BATT"
  exit 1
fi
if [ "$RC" -eq 2 ]; then
  printf 'ПРИБОР НЕДОСТУПЕН: батарея трансляции:\n%s\n' "$BATT" >&2
  exit 2
fi
if [ "$RC" -ne 0 ]; then
  printf 'ПРИБОР НЕДОСТУПЕН: батарея трансляции rc=%s:\n%s\n' "$RC" "$BATT" >&2
  exit 2
fi
printf '%s\n' "$BATT"
exit 0
