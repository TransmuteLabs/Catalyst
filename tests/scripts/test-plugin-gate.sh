#!/usr/bin/env bash
# Зубы двери приёмки плагина (.githooks/pre-commit).
#
# CONSTRAINT: каждый красный случай обязан краснеть СВОЕЙ названной причиной
# и НЕ тянуть чужие -- иначе зуб зеленеет на чужой поломке.
#
# CONSTRAINT: живой репозиторий не читается и не пишется ни в одном случае:
# каждый случай строит свой git init во временном каталоге; валидатору
# подставляется синтетический CLAUDE_CONFIG_DIR.
set -u

# CONSTRAINT: ожидаемое число зубов объявлено ЗДЕСЬ и больше нигде. Стенд
# печатает фактически прогнанное, и расхождение в ЛЮБУЮ сторону -- КРАСНЫЙ, а не
# «НЕ ИЗМЕРЕНО»: зуб, тихо выпавший из прогона (ранний выход, потерянный вызов),
# неотличим от зуба, которого никогда не писали. Код 1, а не 3, выбран замером
# агрегатора: `tests/run-all.sh` считает НЕ ИЗМЕРЕНО отдельной категорией, и
# дверь приёмки на ней НЕ краснеет -- пин с кодом 3 был бы декоративным.
EXPECTED_TEETH=16

HERE="$(cd "$(dirname "$0")" && pwd)"
DOOR="$(cd "$HERE/../.." && pwd)/.githooks/pre-commit"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/plugin-gate-teeth.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

REASONS="ВЕРСИЯ_НЕ_ПОДНЯТА ВАЛИДАТОР_ОТКАЗАЛ СИНТАКСИС_МОДУЛЯ ЗЕРКАЛА_РАЗОШЛИСЬ ПРИБОР_НЕДОСТУПЕН СТЕНД_КРАСЕН"

# Код возврата берётся у САМОЙ подстановки: run_door исполняется в подоболочке,
# присваивания внутри неё наружу не выходят.
run_door() {   # <репо> [VAR=val ...] -> stdout двери, код возврата = код двери
  local r="$1"; shift
  (cd "$r" && env CLAUDE_CONFIG_DIR="$r/home" "$@" bash "$DOOR")
}

check_only() {   # <ожидаемая причина> <вывод двери>
  local exp="$1" out="$2" r
  for r in $REASONS; do
    if [[ "$r" == "$exp" ]]; then
      [[ "$out" == *"$r"* ]] || { printf 'причина %s не названа; ' "$r"; return 1; }
    else
      [[ "$out" != *"$r"* ]] || { printf 'тянется чужая причина %s; ' "$r"; return 1; }
    fi
  done
  return 0
}

mini_manifest() {   # <файл> <версия>
  cat > "$1" <<EOF2
{
  "name": "mini",
  "version": "$2",
  "description": "synthetic plugin for the gate teeth",
  "author": {"name": "t"}
}
EOF2
}

root_manifest() {   # <файл> <версия>
  cat > "$1" <<EOF2
{
  "name": "catalyst",
  "version": "$2",
  "description": "synthetic root",
  "author": {"name": "t"}
}
EOF2
}

register_one() {   # валидный модуль с одним событием (форма обязательна валидатору)
  cat > "$1" <<'EOF2'
export function register(on: any) {
  on("session.start", async ($: any, e: any, next: any) => {
    const v = await $.env.get("MINI_PROBE")
    next(e)
    return {}
  })
}
EOF2
}

register_two() {   # валидное ИЗМЕНЕНИЕ кода: добавлено второе событие
  cat > "$1" <<'EOF2'
export function register(on: any) {
  on("session.start", async ($: any, e: any, next: any) => {
    const v = await $.env.get("MINI_PROBE")
    next(e)
    return {}
  })
  on("prompt.section", async ($: any, e: any, next: any) => {
    next(e)
    return {}
  })
}
EOF2
}

register_mutant() {   # мутация: событие, которого у хоста нет -> валидатор даёт rc=1
  # CONSTRAINT: имя события -- сигил проекта ВНУТРИ известного пространства имён.
  # Два замера 18.09 задают обе половины формы. Первая: апстрим завёл session.end
  # настоящим событием в 2.1.276 (2.1.272 и 2.1.273 его отвергают, 2.1.276
  # принимает) -- мутация, опознаваемая по ЧУЖОМУ имени, умирает в день, когда имя
  # легализуют. Вторая: валидатор судит ГЛАГОЛ только внутри известного
  # пространства (session.__never__ и tool.__never__ отвергаются, а nosuchns.never
  # и catalyst.<что угодно> проходят молча) -- сигил с собственным префиксом
  # СЛЕВА от точки не краснит ничего и делает зуб вакуумным.
  # Положительный контроль этой оси -- register_one: валидное событие session.start
  # обязано ПРОХОДИТЬ (зубы 2 и 4). Без него зелёный зуб 5 неотличим от валидатора,
  # переставшего грузить модули вовсе.
  cat > "$1" <<'EOF2'
export function register(on: any) {
  on("session.__catalyst_never_an_event__", async ($: any, e: any, next: any) => {
    next(e)
    return {}
  })
}
EOF2
}

mk_world() {   # <имя мира> -> путь репо; зеркала в базе СОШЛИСЬ (0.1.0 везде)
  local r="$ROOT/$1"
  mkdir -p "$r/home" \
    "$r/plugins/mini/.claude-plugin" "$r/plugins/mini/hooks" \
    "$r/.claude-plugin" "$r/.codex-plugin" "$r/.cursor-plugin" "$r/.kimi-plugin" \
    "$r/skills" "$r/docs"
  mini_manifest "$r/plugins/mini/.claude-plugin/plugin.json" 0.1.0
  printf '{\n  "modules": ["./register.ts"]\n}\n' > "$r/plugins/mini/hooks/hooks.json"
  register_one "$r/plugins/mini/hooks/register.ts"
  root_manifest "$r/.claude-plugin/plugin.json" 0.1.0
  printf '{"name":"catalyst","version":"0.1.0"}\n' > "$r/.codex-plugin/plugin.json"
  printf '{"name":"catalyst","version":"0.1.0"}\n' > "$r/.cursor-plugin/plugin.json"
  printf '{"name":"catalyst","version":"0.1.0"}\n' > "$r/.kimi-plugin/plugin.json"
  printf 'skill\n' > "$r/skills/s.md"
  printf 'doc\n' > "$r/docs/d.md"
  # CONSTRAINT: в мире обязан жить зелёный стаб tests/run-all.sh -- пятая стадия
  # двери зовёт агрегатор по рабочему дереву; без стаба каждый случай, дошедший
  # до стадии, краснел бы ПРИБОР_НЕДОСТУПЕН. Красные случаи подменяют стаб.
  mkdir -p "$r/tests"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$r/tests/run-all.sh"
  git -C "$r" init -q
  git -C "$r" config user.email t@t
  git -C "$r" config user.name t
  git -C "$r" add plugins .claude-plugin .codex-plugin .cursor-plugin .kimi-plugin skills docs
  git -C "$r" commit -qm base
  printf '%s' "$r"
}

# --- 1. КОНТРОЛЬ: плагины не затронуты -> дверь МОЛЧИТ ------------------------
R=$(mk_world quiet)
printf 'doc more\n' > "$R/docs/d.md"
git -C "$R" add docs/d.md
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ -z "$out" ]]; then
  ok "1) коммит трогает только docs/ -- дверь молчит, rc=0"
else
  bad "1) незатронутые плагины: ждали молчание rc=0, получили rc=$rc [$out]"
fi

# --- 2. КОНТРОЛЬ: всё поднято и сошлось -> rc=0 -------------------------------
R=$(mk_world green)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
if (( rc == 0 )); then
  ok "2) версия поднята, валидатор зелёный, синтаксис цел, зеркала сошлись -- rc=0"
else
  bad "2) зелёный мир: ждали rc=0, получили rc=$rc [$out]"
fi

# --- 3. ОСЬ A: код изменён, версия та же -> ВЕРСИЯ_НЕ_ПОДНЯТА -----------------
R=$(mk_world axis_a)
register_two "$R/plugins/mini/hooks/register.ts"
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
why=$(check_only "ВЕРСИЯ_НЕ_ПОДНЯТА" "$out")
if (( rc == 1 )) && [[ -z "$why" ]]; then
  ok "3) код без бампа -- ВЕРСИЯ_НЕ_ПОДНЯТА и только она"
else
  bad "3) ось A: rc=$rc $why[$out]"
fi

# --- 4. ОСЬ A НЕ краснеет, когда изменён ТОЛЬКО plugin.json -------------------
R=$(mk_world manifest_only)
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini/.claude-plugin/plugin.json
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" != *"ВЕРСИЯ_НЕ_ПОДНЯТА"* ]]; then
  ok "4) изменён только plugin.json -- ось A молчит"
else
  bad "4) только манифест: ждали rc=0 без ВЕРСИЯ_НЕ_ПОДНЯТА, получили rc=$rc [$out]"
fi

# --- 5. ОСЬ B: несуществующее событие в модуле -> ВАЛИДАТОР_ОТКАЗАЛ -----------
R=$(mk_world axis_b)
register_mutant "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
why=$(check_only "ВАЛИДАТОР_ОТКАЗАЛ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"is not an event"* ]]; then
  ok "5) собственный сигил события -- ВАЛИДАТОР_ОТКАЗАЛ с дословным выводом прибора"
else
  bad "5) ось B: rc=$rc $why[$out]"
fi

# --- 6. ОСЬ C: битый TS вне modules валидатора -> СИНТАКСИС_МОДУЛЯ -------------
R=$(mk_world axis_c)
printf 'function broken( {\n' > "$R/plugins/mini/hooks/broken.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
why=$(check_only "СИНТАКСИС_МОДУЛЯ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]]; then
  ok "6) битый *.ts под hooks/ -- СИНТАКСИС_МОДУЛЯ и только она"
else
  bad "6) ось C: rc=$rc $why[$out]"
fi

# --- 7. ОСЬ D: зеркала разведены -> ЗЕРКАЛА_РАЗОШЛИСЬ -------------------------
R=$(mk_world axis_d)
printf 'skill more\n' > "$R/skills/s.md"
root_manifest "$R/.claude-plugin/plugin.json" 0.2.0
git -C "$R" add skills .claude-plugin
out=$(run_door "$R"); rc=$?
why=$(check_only "ЗЕРКАЛА_РАЗОШЛИСЬ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *".codex-plugin/plugin.json → 0.1.0"* ]]; then
  ok "7) версия дома 0.2.0 против зеркал 0.1.0 -- ЗЕРКАЛА_РАЗОШЛИСЬ с перечнем файл→версия"
else
  bad "7) ось D: rc=$rc $why[$out]"
fi

# --- 8. ПРИБОР_НЕДОСТУПЕН: PATH без claude -> отказ, не тихий пропуск ----------
R=$(mk_world no_tool)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
out=$(run_door "$R" PATH="/usr/bin:/bin"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]]; then
  ok "8) PATH без claude -- ПРИБОР_НЕДОСТУПЕН (rc=1), не молчаливый пропуск"
else
  bad "8) недоступный прибор: rc=$rc $why[$out]"
fi

# --- 9. Ручка CATALYST_PLUGIN_GATE=off: пропуск ОБЪЯВЛЕН ----------------------
R=$(mk_world bypass)
register_two "$R/plugins/mini/hooks/register.ts"
git -C "$R" add plugins/mini
out=$(run_door "$R" CATALYST_PLUGIN_GATE=off); rc=$?
if (( rc == 0 )) && [[ "$out" == *"ПРОПУЩЕНА"* ]]; then
  ok "9) ручка off на красном дереве -- rc=0 И строка, объявляющая пропуск"
else
  bad "9) ручка off: ждали rc=0 со строкой объявления, получили rc=$rc [$out]"
fi

# --- 10. ОСЬ D будится правкой ТОЛЬКО зеркала --------------------------------
# Без этого случая дверь сторожит зеркала лишь когда затронут корневой плагин,
# и правка одного зеркала проходит молча -- ровно тот класс, что дал #181.
R=$(mk_world mirror_only)
printf '{"name":"catalyst","version":"0.2.0"}\n' > "$R/.codex-plugin/plugin.json"
git -C "$R" add .codex-plugin
out=$(run_door "$R"); rc=$?
why=$(check_only "ЗЕРКАЛА_РАЗОШЛИСЬ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *".codex-plugin/plugin.json → 0.2.0"* ]]; then
  ok "10) правка ТОЛЬКО зеркала будит дверь -- ЗЕРКАЛА_РАЗОШЛИСЬ и только она"
else
  bad "10) зеркало в одиночку: rc=$rc $why[$out]"
fi

# --- 11. СТАДИЯ 5: агрегатор красен -> СТЕНД_КРАСЕН ----------------------------
# Пробуждение через skills/ требует одновременного подъёма дома и трёх зеркал
# (0.1.1 везде), иначе краснеет ось A или D раньше стадии.
R=$(mk_world stands_red)
printf 'skill more\n' > "$R/skills/s.md"
root_manifest "$R/.claude-plugin/plugin.json" 0.1.1
printf '{"name":"catalyst","version":"0.1.1"}\n' > "$R/.codex-plugin/plugin.json"
printf '{"name":"catalyst","version":"0.1.1"}\n' > "$R/.cursor-plugin/plugin.json"
printf '{"name":"catalyst","version":"0.1.1"}\n' > "$R/.kimi-plugin/plugin.json"
printf '#!/usr/bin/env bash\nprintf "run-all: стендов 1, зелёных 0, красных 1\\n"\nexit 1\n' > "$R/tests/run-all.sh"
git -C "$R" add skills .claude-plugin .codex-plugin .cursor-plugin .kimi-plugin
out=$(run_door "$R"); rc=$?
why=$(check_only "СТЕНД_КРАСЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"красных 1"* ]]; then
  ok "11) красный агрегатор -- СТЕНД_КРАСЕН и только она, вывод дословно"
else
  bad "11) стадия стендов: rc=$rc $why[$out]"
fi

# --- 12. СТАДИЯ 5: агрегатор отсутствует -> ПРИБОР_НЕДОСТУПЕН ------------------
R=$(mk_world stands_missing)
printf 'skill more\n' > "$R/skills/s.md"
root_manifest "$R/.claude-plugin/plugin.json" 0.1.1
printf '{"name":"catalyst","version":"0.1.1"}\n' > "$R/.codex-plugin/plugin.json"
printf '{"name":"catalyst","version":"0.1.1"}\n' > "$R/.cursor-plugin/plugin.json"
printf '{"name":"catalyst","version":"0.1.1"}\n' > "$R/.kimi-plugin/plugin.json"
rm "$R/tests/run-all.sh"
git -C "$R" add skills .claude-plugin .codex-plugin .cursor-plugin .kimi-plugin
out=$(run_door "$R"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"tests/run-all.sh"* ]]; then
  ok "12) tests/run-all.sh отсутствует -- ПРИБОР_НЕДОСТУПЕН, не молчаливый пропуск"
else
  bad "12) нет агрегатора: rc=$rc $why[$out]"
fi

# --- 13. СТАДИЯ 5 спит на коммите вне дерева семьи -----------------------------
# Положительный контроль -- случай 11: та же дверь на семейном коммите печатает
# строку агрегатора; здесь её быть не обязано.
R=$(mk_world stands_docs)
printf 'doc more\n' > "$R/docs/d.md"
git -C "$R" add docs/d.md
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" != *"run-all"* ]]; then
  ok "13) коммит только docs/ -- стенды не гоняются, строки агрегатора нет"
else
  bad "13) docs-only: ждали rc=0 без строки агрегатора, получили rc=$rc [$out]"
fi

# --- 14. ОСНАСТКА будит СТАДИЮ 5, но НЕ оси плагина --------------------------
# Без этого случая дверь слепа к своей собственной поломке: правка стенда или
# самой двери не гоняла бы стенды, и коммит, ломающий стенд, проходил бы молча.
R=$(mk_world harness_only)
printf '#!/usr/bin/env bash\necho "run-all probe: заведомо красный стенд"\nexit 1\n' > "$R/tests/run-all.sh"
git -C "$R" add tests
out=$(run_door "$R"); rc=$?
why=$(check_only "СТЕНД_КРАСЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]]; then
  ok "14) правка одной оснастки будит стадию 5 -- СТЕНД_КРАСЕН и только она"
else
  bad "14) оснастка в одиночку: rc=$rc $why[$out]"
fi

# --- 15. ОСНАСТКА без плагина: оси A--D не запускаются, приборы не требуются ---
R=$(mk_world harness_green)
printf 'echo tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests
out=$(run_door "$R" PATH="/usr/bin:/bin"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"только оснастка"* ]] && [[ "$out" != *"ПРИБОР_НЕДОСТУПЕН"* ]]; then
  ok "15) оснастка без плагина -- оси A--D не запускались, claude/bun не требуются"
else
  bad "15) оснастка без плагина: ждали rc=0 с объявлением, получили rc=$rc [$out]"
fi

# --- 16. СТАДИЯ 5 гоняет стенд БЕЗ git-окружения хука -------------------------
# git экспортирует хуку GIT_INDEX_FILE: при обычном коммите -- относительный
# `.git/index`, при `git commit --only/--include <paths>` -- АБСОЛЮТНЫЙ путь к
# временному индексу репо. Стенды строят свои временные репо; унаследованный
# путь заставил бы их писать чужой индекс («invalid object … Error building
# trees»), и дверь краснела бы ложно (замер 2026-09-18, посадка 0.8.31).
# Индекс подставляется КОПИЕЙ настоящего: несуществующий файл дал бы двери
# пустой staged-список и ранний rc=0 -- ряд был бы вакуумным.
R=$(mk_world hook_env)
printf '#!/usr/bin/env bash\nfor v in GIT_INDEX_FILE GIT_PREFIX GIT_DIR GIT_WORK_TREE; do\n  [ -z "${!v:-}" ] || { echo "run-all: унаследовано $v=${!v}"; exit 1; }\ndone\nexit 0\n' > "$R/tests/run-all.sh"
git -C "$R" add tests
cp "$R/.git/index" "$R/.git/next-index-teeth.lock"
# Положительный контроль прибора: стаб сам по себе краснеет под переменной.
if (cd "$R" && GIT_INDEX_FILE="$R/.git/next-index-teeth.lock" bash tests/run-all.sh >/dev/null 2>&1); then
  bad "16) контроль: стаб не краснеет под GIT_INDEX_FILE -- прибор ничего не измеряет"
else
  out=$(run_door "$R" GIT_INDEX_FILE="$R/.git/next-index-teeth.lock" GIT_PREFIX=); rc=$?
  if (( rc == 0 )) && [[ "$out" == *"только оснастка"* ]] && [[ "$out" != *"унаследовано"* ]]; then
    ok "16) стадия 5 под GIT_INDEX_FILE хука (абсолютный путь) -- стенд получает чистое окружение, rc=0"
  else
    bad "16) окружение хука протекло в стенд: rc=$rc [$out]"
  fi
fi

printf '\nplugin-gate teeth: прошло=%d провалов=%d ожидалось=%d\n' "$PASS" "$FAIL" "$EXPECTED_TEETH"
if (( PASS + FAIL != EXPECTED_TEETH )); then
  printf 'ПРОВАЛ: прогнано зубов %d при объявленных %d -- прогон не тот, который пинили\n' \
    "$((PASS + FAIL))" "$EXPECTED_TEETH" >&2
  exit 1
fi
[[ $FAIL -eq 0 ]]
