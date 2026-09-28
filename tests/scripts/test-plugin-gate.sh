#!/usr/bin/env bash
# Зубы двери приёмки плагина (.githooks/pre-commit).
#
# CONSTRAINT: каждый красный случай обязан краснеть СВОЕЙ названной причиной
# и НЕ тянуть чужие -- иначе зуб зеленеет на чужой поломке.
#
# CONSTRAINT: живой репозиторий не читается и не пишется ни в одном случае:
# каждый случай строит свой git init во временном каталоге; валидатору
# подставляется синтетический CLAUDE_CONFIG_DIR.
#
# CONSTRAINT: вывод двери берётся вместе со stderr -- стадия 5 печатает строки
# stand-scope «НЕ ПОКРЫТ» в stderr, и зуб на КАРТА_НЕ_ПОКРЫВАЕТ обязан их видеть.
set -u

# CONSTRAINT: ожидаемое число зубов объявлено ЗДЕСЬ и больше нигде. Стенд
# печатает фактически прогнанное, и расхождение в ЛЮБУЮ сторону -- КРАСНЫЙ, а не
# «НЕ ИЗМЕРЕНО»: зуб, тихо выпавший из прогона (ранний выход, потерянный вызов),
# неотличим от зуба, которого никогда не писали. Код 1, а не 3, выбран замером
# агрегатора: `tests/run-all.sh` считает НЕ ИЗМЕРЕНО отдельной категорией, и
# дверь приёмки на ней НЕ краснеет -- пин с кодом 3 был бы декоративным.
EXPECTED_TEETH=110

HERE="$(cd "$(dirname "$0")" && pwd)"
DOOR="$(cd "$HERE/../.." && pwd)/.githooks/pre-commit"
SCOPE="$(cd "$HERE/.." && pwd)/stand-scope.sh"
# CONSTRAINT: REALGIT -- до любых подмен PATH: заглушки git звают настоящий
# бинарь напрямую, без рекурсии через себя.
REALGIT="$(command -v git)"
PASS=0; FAIL=0

# CONSTRAINT: процесс, запущенный через & при выключенном управлении заданиями,
# получает SIGINT/SIGQUIT игнорируемыми, а сигнал, игнорируемый на входе,
# неинтерактивный bash не ловит и не сбрасывает -- сигнальный зуб мерил бы
# игнор, а не ловушку двери. Запуск идёт через этот сброс в SIG_DFL.
# HUP и TERM сбрасываются тоже: стенд, запущенный под nohup, наследует HUP
# игнорируемым, и HUP-зуб краснел бы на верном дереве от формы запуска.
SIGDFL='import os,signal,sys
for s in (signal.SIGINT, signal.SIGQUIT, signal.SIGHUP, signal.SIGTERM):
    signal.signal(s, signal.SIG_DFL)
os.execvp(sys.argv[1], sys.argv[1:])'

ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/plugin-gate-teeth.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

REASONS="ВЕРСИЯ_НЕ_ПОДНЯТА ВАЛИДАТОР_ОТКАЗАЛ СИНТАКСИС_МОДУЛЯ ЗЕРКАЛА_РАЗОШЛИСЬ ПРИБОР_НЕДОСТУПЕН КАРТА_НЕ_ПОКРЫВАЕТ КАРТА_НЕИСПРАВНА СТАДИЯ_НЕ_ЗАВЕРШЕНА СВИДЕТЕЛЯ_НЕТ МАНИФЕСТ_НЕЧИТАЕМ МАНИФЕСТ_БЕЗ_ВЕРСИИ ПУТЬ_СЕМЬИ_НЕ_КЛАССИФИЦИРОВАН МАНИФЕСТА_НЕТ"

# Код возврата берётся у САМОЙ подстановки: run_door исполняется в подоболочке,
# присваивания внутри неё наружу не выходят.
run_door() {   # <репо> [VAR=val ...] -> stdout+stderr двери, код возврата = код двери
  local r="$1"; shift
  (cd "$r" && env CLAUDE_CONFIG_DIR="$r/home" "$@" bash "$DOOR" 2>&1)
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

add_witness() {   # <репо> <scope> <rc> -> путь мира; свидетель пишется под текущий индекс
  local r="$1" scope="$2" rc="$3" T
  T=$(git -C "$r" write-tree)
  mkdir -p "$r/.git/catalyst-witness"
  printf 'scope=%s\nrc=%s\nhost=usbox\n' "$scope" "$rc" > "$r/.git/catalyst-witness/$T"
  printf '%s' "$T"
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
    "$r/skills" "$r/docs" "$r/tests/scripts" "$r/tests/pressure"
  mini_manifest "$r/plugins/mini/.claude-plugin/plugin.json" 0.1.0
  printf '{\n  "modules": ["./register.ts"]\n}\n' > "$r/plugins/mini/hooks/hooks.json"
  register_one "$r/plugins/mini/hooks/register.ts"
  root_manifest "$r/.claude-plugin/plugin.json" 0.1.0
  printf '{"name":"catalyst","version":"0.1.0"}\n' > "$r/.codex-plugin/plugin.json"
  printf '{"name":"catalyst","version":"0.1.0"}\n' > "$r/.cursor-plugin/plugin.json"
  printf '{"name":"catalyst","version":"0.1.0"}\n' > "$r/.kimi-plugin/plugin.json"
  printf 'skill\n' > "$r/skills/s.md"
  printf 'doc\n' > "$r/docs/d.md"
  printf 'p\n' > "$r/tests/pressure/p.txt"
  # CONSTRAINT: стадия 5 сопоставляет пути со стендами НАСТОЯЩИМ tests/stand-scope.sh
  # по карте мира; стаб tests/run-all.sh -- ловушка: маркер .run-all-called
  # доказывает, что стадия 5 стенды НЕ исполняет (зуб 18).
  cp "$SCOPE" "$r/tests/stand-scope.sh"
  cat > "$r/tests/run-all.sh" <<'EOF2'
#!/usr/bin/env bash
printf 'called\n' >> "$(dirname "$0")/.run-all-called"
exit 0
EOF2
  cat > "$r/tests/stand-map.tsv" <<'EOF2'
plugins/mini/	mini-stand
tests/run-all.sh	run-all
tests/stand-scope.sh	run-all,plugin-gate
tests/pressure/	-
docs/	-
EOF2
  local n
  for n in mini-stand run-all plugin-gate; do
    printf '#!/usr/bin/env bash\nexit 0\n' > "$r/tests/scripts/test-$n.sh"
  done
  git -C "$r" init -q
  git -C "$r" config user.email t@t
  git -C "$r" config user.name t
  git -C "$r" add -A
  git -C "$r" commit -qm base
  printf '%s' "$r"
}

# --- 1. КОНТРОЛЬ: плагины не затронуты -> rc 0, стенды не звались ---------------
# CONSTRAINT: стадия 5 будится любым staged-путём; docs/ в карте мира -- «-»,
# ветка «стендов нет»: ни одной причины отказа, свидетель не спрашивается.
R=$(mk_world quiet)
printf 'doc more\n' > "$R/docs/d.md"
git -C "$R" add docs/d.md
out=$(run_door "$R"); rc=$?
why=$(check_only "" "$out")
if (( rc == 0 )) && [[ -z "$why" ]] && [[ "$out" == *"стенды не звались"* ]]; then
  ok "1) коммит трогает только docs/ -- rc=0, ветка «стендов нет», ни одной причины отказа"
else
  bad "1) незатронутые плагины: ждали rc=0 и «стенды не звались», получили rc=$rc $why[$out]"
fi

# --- 2. КОНТРОЛЬ: всё поднято и сошлось + свидетель -> rc=0 -------------------
R=$(mk_world green)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"стадия 5: свидетель"* ]]; then
  ok "2) версия поднята, валидатор зелёный, синтаксис цел, зеркала сошлись, свидетель на месте -- rc=0"
else
  bad "2) зелёный мир: ждали rc=0 со свидетелем, получили rc=$rc [$out]"
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
add_witness "$R" mini-stand 0 >/dev/null
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" != *"ВЕРСИЯ_НЕ_ПОДНЯТА"* ]] && [[ "$out" == *"стадия 5: свидетель"* ]]; then
  ok "4) изменён только plugin.json -- ось A молчит, свидетель принят"
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

# --- 11. СТАДИЯ 5: путь вне карты -> КАРТА_НЕ_ПОКРЫВАЕТ -----------------------
R=$(mk_world uncovered)
printf 's\n' > "$R/tests/strange.txt"
git -C "$R" add tests/strange.txt
out=$(run_door "$R"); rc=$?
why=$(check_only "КАРТА_НЕ_ПОКРЫВАЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"НЕ ПОКРЫТ tests/strange.txt"* ]]; then
  ok "11) семейный путь вне карты -- КАРТА_НЕ_ПОКРЫВАЕТ с названным путём"
else
  bad "11) карта: rc=$rc $why[$out]"
fi

# --- 12. СТАДИЯ 5: пустой scope -> проход БЕЗ свидетеля -----------------------
R=$(mk_world empty_scope)
printf 'more\n' >> "$R/tests/pressure/p.txt"
git -C "$R" add tests/pressure/p.txt
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"не мерит ни один стенд"* ]] && [[ "$out" != *"СВИДЕТЕЛЯ_НЕТ"* ]]; then
  ok "12) строка карты «-» -- стенды не звались, свидетель не нужен, rc=0"
else
  bad "12) пустой scope: ждали rc=0 с объявлением, получили rc=$rc [$out]"
fi

# --- 13. СТАДИЯ 5: нет свидетеля -> СВИДЕТЕЛЯ_НЕТ -----------------------------
R=$(mk_world no_wit)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
T=$(git -C "$R" write-tree)
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"дерево $T"* ]] \
   && [[ "$out" == *"нужен scope run-all"* ]] \
   && [[ "$out" == *"bash tests/run-witness.sh --tree $T --scope run-all"* ]]; then
  ok "13) свидетель не произведён -- СВИДЕТЕЛЯ_НЕТ с деревом, scope и командой --tree"
else
  bad "13) нет свидетеля: rc=$rc $why[$out]"
fi

# --- 14. СТАДИЯ 5: свидетель с МЕНЬШИМ scope -> отказ -------------------------
R=$(mk_world small_scope)
printf '# tweak\n' >> "$R/tests/run-all.sh"
printf '\n# tweak\n' >> "$R/tests/stand-scope.sh"
git -C "$R" add tests/run-all.sh tests/stand-scope.sh
add_witness "$R" run-all 0 >/dev/null
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"нужен scope plugin-gate,run-all"* ]]; then
  ok "14) свидетель уже требуемого не накрывает -- СВИДЕТЕЛЯ_НЕТ (проверка ⊇)"
else
  bad "14) меньший scope: rc=$rc $why[$out]"
fi

# --- 15. СТАДИЯ 5: свидетель rc=1 -> отказ ------------------------------------
R=$(mk_world wit_rc1)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
add_witness "$R" run-all 1 >/dev/null
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]]; then
  ok "15) свидетель с rc=1 -- СВИДЕТЕЛЯ_НЕТ: красный прогон не свидетель"
else
  bad "15) свидетель rc=1: rc=$rc $why[$out]"
fi

# --- 16. СТАДИЯ 5: верный свидетель -> проход ---------------------------------
R=$(mk_world wit_ok)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
T=$(add_witness "$R" run-all 0)
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"стадия 5: свидетель $T scope=run-all"* ]]; then
  ok "16) свидетель дерева с точным scope -- проход с названным деревом"
else
  bad "16) верный свидетель: ждали rc=0 и строку свидетеля, получили rc=$rc [$out]"
fi

# --- 17. СТАДИЯ 5: свидетель ШИРЕ требуемого -> проход ------------------------
R=$(mk_world wit_wide)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
add_witness "$R" plugin-gate,run-all 0 >/dev/null
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"стадия 5: свидетель"* ]]; then
  ok "17) свидетель шире требуемого scope -- проход (⊇, не ==)"
else
  bad "17) широкий свидетель: ждали rc=0, получили rc=$rc [$out]"
fi

# --- 18. СТАДИЯ 5 НЕ исполняет агрегатор --------------------------------------
# Стаб tests/run-all.sh -- ловушка: маркер при вызове. Положительный контроль
# доказывает, что ловушка жива; сама дверь маркер оставить не обязана.
R=$(mk_world no_exec)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
add_witness "$R" run-all 0 >/dev/null
bash "$R/tests/run-all.sh"
if [ -f "$R/tests/.run-all-called" ]; then
  rm -f "$R/tests/.run-all-called"
  out=$(run_door "$R"); rc=$?
  if (( rc == 0 )) && [ ! -e "$R/tests/.run-all-called" ]; then
    ok "18) стадия 5 проверяет свидетеля и НЕ зовёт tests/run-all.sh"
  else
    bad "18) агрегатор исполнен дверью: rc=$rc [$out]"
  fi
else
  bad "18) контроль: ловушка не пишет маркер при прямом вызове"
fi

# --- 19. СТАДИЯ 5: нет tests/stand-scope.sh -> ПРИБОР_НЕДОСТУПЕН --------------
R=$(mk_world no_scope_sh)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
rm "$R/tests/stand-scope.sh"
git -C "$R" add tests/stand-scope.sh
out=$(run_door "$R"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"tests/stand-scope.sh"* ]]; then
  ok "19) tests/stand-scope.sh отсутствует -- ПРИБОР_НЕДОСТУПЕН, не молчаливый пропуск"
else
  bad "19) нет stand-scope: rc=$rc $why[$out]"
fi

# --- 20. СТАДИЯ 5 читает ИНДЕКС ХУКА (GIT_INDEX_FILE) -------------------------
# git экспортирует хуку GIT_INDEX_FILE: при `git commit --only/--include <paths>`
# -- АБСОЛЮТНЫЙ путь к временному индексу репо. Сопоставление карты обязано
# видеть ИМЕННО его (снятие переменной -- прямая порча двери). Контроль: в чистом
# индексе дверь молчит -- будит её только индекс-копия.
R=$(mk_world hook_env)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
cp "$R/.git/index" "$R/.git/next-index-teeth.lock"
git -C "$R" reset -q
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ -z "$out" ]]; then
  # CONSTRAINT: T считается от КОПИИ индекса -- дверь обязана назвать дерево
  # именно временного индекса и рецепт --tree для него (Ф13).
  T20=$(GIT_INDEX_FILE="$R/.git/next-index-teeth.lock" git -C "$R" write-tree)
  out=$(run_door "$R" GIT_INDEX_FILE="$R/.git/next-index-teeth.lock"); rc=$?
  why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
  if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"bash tests/run-witness.sh --tree $T20 --scope run-all"* ]]; then
    ok "20) стадия 5 под GIT_INDEX_FILE хука -- карта читает индекс хука, рецепт --tree называет его дерево"
  else
    bad "20) индекс хука не прочитан: rc=$rc $why[$out]"
  fi
else
  bad "20) контроль: чистый индекс не молчит rc=$rc [$out]"
fi

# --- 21. ОСЬ B судит ИНДЕКС: staged манифест битый, рабочий целый -> отказ ----
R=$(mk_world axis_b_idx)
printf '{ broken json\n' > "$R/plugins/mini/.claude-plugin/plugin.json"
git -C "$R" add plugins/mini/.claude-plugin/plugin.json
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
out=$(run_door "$R"); rc=$?
# FIX6 Ж12: версия собственного манифеста читается при любой правке плагина --
# битый staged-манифест ловит ось A по ИНДЕКСУ раньше оси B.
why=$(check_only "МАНИФЕСТ_НЕЧИТАЕМ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_НЕЧИТАЕМ: plugins/mini/.claude-plugin/plugin.json (индекс)"* ]]; then
  ok "21) битый манифест в ИНДЕКСЕ при целом рабочем -- МАНИФЕСТ_НЕЧИТАЕМ (индекс)"
else
  bad "21) битый staged-манифест: rc=$rc $why[$out]"
fi

# --- 22. ОСЬ B судит ИНДЕКС: staged целый, рабочий битый -> проход -----------
R=$(mk_world axis_b_work)
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
printf '{ broken json\n' > "$R/plugins/mini/.claude-plugin/plugin.json"
add_witness "$R" mini-stand 0 >/dev/null
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"стадия 5: свидетель"* ]]; then
  ok "22) целый манифест в ИНДЕКСЕ при битом рабочем -- проход: ось B не читает рабочее дерево"
else
  bad "22) ось B по индексу (битый рабочий): ждали rc=0, получили rc=$rc [$out]"
fi

# --- 23. СТАДИЯ 5 на коммите вне дерева семьи: стендов нет -> свидетель не нужен ---
# Положительный контроль -- случай 16: та же дверь на семейном коммите печатает
# строку свидетеля; здесь её быть не обязано.
R=$(mk_world stands_docs)
printf 'doc more\n' > "$R/docs/d.md"
git -C "$R" add docs/d.md
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" != *"стадия 5: свидетель"* ]] && [[ "$out" == *"стенды не звались"* ]]; then
  ok "23) коммит только docs/ -- стенды не меряют, строки свидетеля нет, rc=0"
else
  bad "23) docs-only: ждали rc=0 без строки свидетеля, получили rc=$rc [$out]"
fi

# --- 24. ОСНАСТКА без плагина: оси A--D не запускаются, приборы не требуются --
R=$(mk_world harness_green)
printf 'echo tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
add_witness "$R" run-all 0 >/dev/null
out=$(run_door "$R" PATH="/usr/bin:/bin"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"плагины не затронуты"* ]] && [[ "$out" == *"стадия 5: свидетель"* ]] && [[ "$out" != *"ПРИБОР_НЕДОСТУПЕН"* ]]; then
  ok "24) оснастка без плагина -- оси A--D не запускались, claude/bun не требуются, свидетель принят"
else
  bad "24) оснастка без плагина: ждали rc=0 с объявлением, получили rc=$rc [$out]"
fi

# --- 25. ОСЬ A на СЛИЯНИИ: версию подняла ВТОРАЯ сторона -> дверь МОЛЧИТ ------
# У merge-коммита предков ДВА, и сравнение только с HEAD (первым родителем)
# отбивало слияние, в котором поднимать нечего: версию уже подняла сливаемая
# сторона. Отказ при этом назывался ВЕРСИЯ_НЕ_ПОДНЯТА -- ЧУЖОЙ причиной, а
# обход требовал искусственного подъёма, врущего в истории выпусков.
R=$(mk_world merge_side)
git -C "$R" checkout -q -b side
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.5
git -C "$R" add plugins/mini
git -C "$R" commit -qm side
git -C "$R" checkout -q -
printf 'doc A\n' > "$R/docs/d.md"
git -C "$R" add docs/d.md
git -C "$R" commit -qm mainside
if ! git -C "$R" merge --no-commit --no-ff -q side >/dev/null; then
  bad "25) фикстура: слияние не состоялось, ряд ничего не измерил"
else
  # положительный контроль фикстуры: без MERGE_HEAD ряд мерил бы обычный коммит
  if [ ! -f "$R/.git/MERGE_HEAD" ]; then
    bad "25) фикстура: MERGE_HEAD отсутствует -- состояние слияния не построено"
  else
    add_witness "$R" mini-stand 0 >/dev/null
    out=$(run_door "$R"); rc=$?
    if (( rc == 0 )) && [[ "$out" != *"ВЕРСИЯ_НЕ_ПОДНЯТА"* ]] && [[ "$out" == *"стадия 5: свидетель"* ]]; then
      ok "25) слияние, версию поднял второй предок -- дверь молчит, свидетель принят"
    else
      bad "25) слияние отбито: ждали rc=0 без ВЕРСИЯ_НЕ_ПОДНЯТА, получили rc=$rc [$out]"
    fi
  fi
fi

# --- 26. ОСЬ A на СЛИЯНИИ: СОБСТВЕННАЯ правка сверх обеих сторон -> отказ -----
# Зеркало ряда 25: послабление не должно стать дырой. Разрешение слияния внесло
# код, которого нет НИ У ОДНОГО предка, а версия осталась равной версии второго
# предка -- одна версия называла бы ДВА разных дерева.
R=$(mk_world merge_edit)
git -C "$R" checkout -q -b side2
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.5
git -C "$R" add plugins/mini
git -C "$R" commit -qm side2
git -C "$R" checkout -q -
printf 'doc A\n' > "$R/docs/d.md"
git -C "$R" add docs/d.md
git -C "$R" commit -qm mainside2
if ! git -C "$R" merge --no-commit --no-ff -q side2 >/dev/null; then
  bad "26) фикстура: слияние не состоялось, ряд ничего не измерил"
else
  printf '// resolved\n' >> "$R/plugins/mini/hooks/register.ts"
  git -C "$R" add plugins/mini
  out=$(run_door "$R"); rc=$?
  why=$(check_only "ВЕРСИЯ_НЕ_ПОДНЯТА" "$out")
  if (( rc == 1 )) && [[ -z "$why" ]]; then
    ok "26) слияние с собственной правкой сверх обеих сторон -- ВЕРСИЯ_НЕ_ПОДНЯТА и только она"
  else
    bad "26) слияние с правкой: ждали rc=1 ВЕРСИЯ_НЕ_ПОДНЯТА, получили rc=$rc $why[$out]"
  fi
fi

# --- 27. ОСЬ A на СЛИЯНИИ: обе стороны подняли до ОДНОГО числа -> отказ -------
# ЖИВОЙ СЛУЧАЙ 2026-09-21: две параллельные сессии в одном дереве независимо
# подняли версию до одного и того же номера. Слитое дерево -- ТРЕТЬЕ, отличное
# от обоих, и носит тот же номер. Отказ здесь ВЕРЕН: одна версия не может
# называть два разных дерева. Ряд стоит сторожем послабления рядов 25/26 --
# пропуск предка с совпавшим кодом не должен снимать этот отказ.
R=$(mk_world merge_same_ver)
git -C "$R" checkout -q -b side3
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.5
git -C "$R" add plugins/mini
git -C "$R" commit -qm side3
git -C "$R" checkout -q -
# та же правка манифеста ДОСЛОВНО -> git сливает её без конфликта
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.5
git -C "$R" add plugins/mini
git -C "$R" commit -qm mainside3
if ! git -C "$R" merge --no-commit --no-ff -q side3 >/dev/null; then
  bad "27) фикстура: слияние не состоялось, ряд ничего не измерил"
else
  out=$(run_door "$R"); rc=$?
  why=$(check_only "ВЕРСИЯ_НЕ_ПОДНЯТА" "$out")
  if (( rc == 1 )) && [[ -z "$why" ]]; then
    ok "27) слияние, обе стороны подняли до одного числа -- ВЕРСИЯ_НЕ_ПОДНЯТА и только она"
  else
    bad "27) одинаковый номер у обеих сторон: ждали rc=1 ВЕРСИЯ_НЕ_ПОДНЯТА, получили rc=$rc $why[$out]"
  fi
fi

# --- 28. Ф5: кириллический путь -- классификатор и карта видят его без кавычек
# CONSTRAINT: без -z git кавычит не-ASCII путь (core.quotePath) -- дверь молча
# выходила на классификации, а карта не покрывала его. Ось C обязана найти битый
# файл и назвать путь ДОСЛОВНО. Версия поднята: ось A видит путь (зуб 36) и без
# подъёма отказала бы раньше оси C -- зуб остаётся проверкой оси C.
R=$(mk_world utf8_gate)
printf 'function broken( {\n' > "$R/plugins/mini/hooks/тест.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
SSS=$(cd "$R" && bash tests/stand-scope.sh --staged 2>/dev/null)
out=$(run_door "$R"); rc=$?
why=$(check_only "СИНТАКСИС_МОДУЛЯ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"plugins/mini/hooks/тест.ts"* ]] && [ "$SSS" = "mini-stand" ]; then
  ok "28) staged plugins/mini/тест.ts -- дверь не молчит, ось C называет путь, карта даёт mini-stand"
else
  bad "28) кириллица: rc=$rc $why scope=[$SSS] [$out]"
fi

# --- 29. Ф5: имя с пробелом -- тот же сквозной путь ----------------------------
R=$(mk_world space_gate)
printf 'function broken( {\n' > "$R/plugins/mini/hooks/файл с пробелом.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
SSS=$(cd "$R" && bash tests/stand-scope.sh --staged 2>/dev/null)
out=$(run_door "$R"); rc=$?
why=$(check_only "СИНТАКСИС_МОДУЛЯ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"plugins/mini/hooks/файл с пробелом.ts"* ]] && [ "$SSS" = "mini-stand" ]; then
  ok "29) staged имя с пробелом -- ось C называет путь дословно, карта даёт mini-stand"
else
  bad "29) пробел: rc=$rc $why scope=[$SSS] [$out]"
fi

# --- 30. Ф6: отказ checkout-index в снимке осей B/C -> ПРИБОР_НЕДОСТУПЕН -------
R=$(mk_world snap_rc)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
GBIN="$ROOT/gbin30"; mkdir -p "$GBIN"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "checkout-index" ]; then
  printf 'stub-git: checkout-index rc=1\n' >&2
  exit 1
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"снимок индекса для осей B/C не построен"* ]]; then
  ok "30) checkout-index rc 1 -- ПРИБОР_НЕДОСТУПЕН: снимок индекса не построен"
else
  bad "30) rc снимка: rc=$rc $why[$out]"
fi

# --- 31. Ф10: свидетель со смешанным rc -> отказ с причиной rc -----------------
R=$(mk_world wit_mixed)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
T=$(git -C "$R" write-tree)
mkdir -p "$R/.git/catalyst-witness"
printf 'scope=run-all\nrc=1\nrc=0\nhost=usbox\n' > "$R/.git/catalyst-witness/$T"
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"(rc);"* ]]; then
  ok "31) свидетель rc=1 и rc=0 вперемешку -- СВИДЕТЕЛЯ_НЕТ (строгий формат), причина названа"
else
  bad "31) смешанный rc: rc=$rc $why[$out]"
fi

# --- 32. Ф10: свидетель-симлинк -> отказ с причиной симлинк --------------------
R=$(mk_world wit_symlink)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
T=$(git -C "$R" write-tree)
mkdir -p "$R/.git/catalyst-witness"
printf 'scope=run-all\nrc=0\nhost=usbox\n' > "$R/.git/catalyst-witness/good"
ln -s good "$R/.git/catalyst-witness/$T"
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"(симлинк);"* ]]; then
  ok "32) свидетель-симлинк на годный файл -- СВИДЕТЕЛЯ_НЕТ (симлинк)"
else
  bad "32) симлинк: rc=$rc $why[$out]"
fi

# --- 33. Ф10: свидетель с чужого хоста -> отказ с названным хостом -------------
R=$(mk_world wit_host)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
add_witness "$R" run-all 0 >/dev/null
sed -i 's/^host=usbox$/host=elsewhere/' "$R/.git/catalyst-witness/$(git -C "$R" write-tree)"
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"(хост elsewhere не площадка прогонов);"* ]]; then
  ok "33) свидетель host=elsewhere -- СВИДЕТЕЛЯ_НЕТ: хост не площадка прогонов"
else
  bad "33) чужой хост: rc=$rc $why[$out]"
fi

# --- 34. Ф10: четвёртая строка в свидетеле -> отказ с причиной формат ----------
R=$(mk_world wit_extra)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
T=$(git -C "$R" write-tree)
mkdir -p "$R/.git/catalyst-witness"
printf 'scope=run-all\nrc=0\nhost=usbox\nextra\n' > "$R/.git/catalyst-witness/$T"
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"(формат);"* ]]; then
  ok "34) четвёртая строка свидетеля -- СВИДЕТЕЛЯ_НЕТ (формат)"
else
  bad "34) формат: rc=$rc $why[$out]"
fi

# --- 35. Ф12: отказ git в stand-scope -> ПРИБОР_НЕДОСТУПЕН, не КАРТА -----------
R=$(mk_world ss_rc3)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
add_witness "$R" run-all 0 >/dev/null
GBIN="$ROOT/gbin35"; mkdir -p "$GBIN"
# CONSTRAINT: заглушка отказывает только вызову ИЗ stand-scope (родитель --
# tests/stand-scope.sh): тот же diff --name-status -z дверь читает и сама на
# входе (Г3), и отказ там назывался бы иной причиной.
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "diff" ] && [[ "\$*" == *--name-status* ]] \\
   && [[ "\$(ps -o args= -p "\$PPID")" == *stand-scope.sh* ]]; then
  printf 'stub-git: diff --name-status rc=1\n' >&2
  exit 1
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"stand-scope.sh вернул rc=3"* ]]; then
  ok "35) stand-scope rc 3 (отказ git) -- ПРИБОР_НЕДОСТУПЕН, а не КАРТА_НЕ_ПОКРЫВАЕТ"
else
  bad "35) отказ прибора: rc=$rc $why[$out]"
fi

# --- 36. Г2: ось A видит не-ASCII путь (NUL-список) -----------------------------
R=$(mk_world utf8_axis_a)
register_one "$R/plugins/mini/hooks/тест.ts"
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
why=$(check_only "ВЕРСИЯ_НЕ_ПОДНЯТА" "$out")
t36=""
(( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ВЕРСИЯ_НЕ_ПОДНЯТА: plugins/mini --"* ]] \
  || t36="плагин: rc=$rc $why[$out]; "
R=$(mk_world utf8_axis_a_root)
mkdir -p "$R/skills/тест"
printf 'skill\n' > "$R/skills/тест/SKILL.md"
git -C "$R" add skills
out=$(run_door "$R"); rc=$?
why=$(check_only "ВЕРСИЯ_НЕ_ПОДНЯТА" "$out")
(( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ВЕРСИЯ_НЕ_ПОДНЯТА: . --"* ]] \
  || t36="${t36}корень: rc=$rc $why[$out]"
if [ -z "$t36" ]; then
  ok "36) plugins/mini/hooks/тест.ts и skills/тест/SKILL.md без подъёма -- ВЕРСИЯ_НЕ_ПОДНЯТА (ось A по NUL-списку)"
else
  bad "36) не-ASCII путь в оси A: $t36"
fi

# --- 37. Г3: отказ git diff --cached на входе -> ПРИБОР_НЕДОСТУПЕН ---------------
R=$(mk_world diff_rc)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
GBIN="$ROOT/gbin37"; mkdir -p "$GBIN"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "diff" ] && [ "\$2" = "--cached" ] && [[ "\${3:-}" == --name-* ]]; then
  printf 'fatal: stub-git diff --cached rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git diff --cached rc=128"* ]]; then
  ok "37) git diff --cached rc=128 на входе -- ПРИБОР_НЕДОСТУПЕН с rc, не тихий выход"
else
  bad "37) отказ git на входе: rc=$rc $why[$out]"
fi

# --- 38. Г4: PATH без python3 -> ПРИБОР_НЕДОСТУПЕН до оси A ----------------------
R=$(mk_world no_python)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
NOPY="$ROOT/nopy38"; mkdir -p "$NOPY"
for f in /usr/bin/* /bin/*; do
  b="${f##*/}"
  case "$b" in python|python2*|python3|python3.*) continue ;; esac
  [ -e "$NOPY/$b" ] || ln -s "$f" "$NOPY/$b"
done
out=$(run_door "$R" PATH="$NOPY"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: python3"* ]]; then
  ok "38) PATH без python3 -- ПРИБОР_НЕДОСТУПЕН: python3 (оси A и D не выключаются молча)"
else
  bad "38) без python3: rc=$rc $why[$out]"
fi

# --- 39. Г4: существующий манифест не разбирается -> МАНИФЕСТ_НЕЧИТАЕМ -----------
R=$(mk_world manifest_broken)
register_two "$R/plugins/mini/hooks/register.ts"
printf '{ broken json\n' > "$R/plugins/mini/.claude-plugin/plugin.json"
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТ_НЕЧИТАЕМ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_НЕЧИТАЕМ: plugins/mini/.claude-plugin/plugin.json"* ]]; then
  ok "39) битый JSON манифеста при правке кода -- МАНИФЕСТ_НЕЧИТАЕМ, не пропуск оси A"
else
  bad "39) нечитаемый манифест: rc=$rc $why[$out]"
fi

# --- 40. Г6: незавершённая последняя строка свидетеля -> формат -------------------
t40=""; i40=0
for body in 'scope=run-all\nrc=0\nhost=usbox\nextra' 'scope=run-all\nrc=0\nhost=usbox'; do
  i40=$((i40+1)); R=$(mk_world "wit_nonl$i40")
  printf '# tweak\n' >> "$R/tests/run-all.sh"
  git -C "$R" add tests/run-all.sh
  T=$(git -C "$R" write-tree)
  mkdir -p "$R/.git/catalyst-witness"
  printf "$body" > "$R/.git/catalyst-witness/$T"
  out=$(run_door "$R"); rc=$?
  why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
  (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"(формат);"* ]] \
    || t40="${t40}«$body»: rc=$rc $why[$out]; "
done
if [ -z "$t40" ]; then
  ok "40) последняя строка свидетеля без \\n (4-я и 3-я) -- СВИДЕТЕЛЯ_НЕТ (формат)"
else
  bad "40) незавершённая строка: $t40"
fi

# --- 41. Г13: хост свидетеля -- точное членство в WITNESS_HOSTS ------------------
t41=""; i41=0
for hv in ' usbox' '*' 'usbox*'; do
  i41=$((i41+1)); R=$(mk_world "wit_hostglob$i41")
  printf '# tweak\n' >> "$R/tests/run-all.sh"
  git -C "$R" add tests/run-all.sh
  T=$(git -C "$R" write-tree)
  mkdir -p "$R/.git/catalyst-witness"
  printf 'scope=run-all\nrc=0\nhost=%s\n' "$hv" > "$R/.git/catalyst-witness/$T"
  out=$(run_door "$R"); rc=$?
  why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
  (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"(хост $hv не площадка прогонов);"* ]] \
    || t41="${t41}«host=$hv»: rc=$rc $why[$out]; "
done
if [ -z "$t41" ]; then
  ok "41) host=' usbox' / host=* / host=usbox* -- СВИДЕТЕЛЯ_НЕТ: точное сравнение, не паттерн"
else
  bad "41) хост паттерном: $t41"
fi

# --- 42. Г14: имена плагинов с glob-символами -- точное членство, без раскрытия ---
# CONSTRAINT: пара foo/foo* -- форма брифа; пара x/[x] -- вектор, который
# раскрытие реально теряет: [x] раскрывается в x и сам себя не называет.
t42=""; i42=0
for pair in 'foo foo*' 'x [x]'; do
  pa="${pair%% *}"; pb="${pair#* }"
  i42=$((i42+1)); R=$(mk_world "glob_names$i42")
  for pn in "$pa" "$pb"; do
    mkdir -p "$R/plugins/$pn/.claude-plugin" "$R/plugins/$pn/hooks"
    mini_manifest "$R/plugins/$pn/.claude-plugin/plugin.json" 0.1.0
    printf '{\n  "modules": ["./register.ts"]\n}\n' > "$R/plugins/$pn/hooks/hooks.json"
    register_one "$R/plugins/$pn/hooks/register.ts"
  done
  git -C "$R" add -A
  git -C "$R" commit -qm plugins
  register_two "$R/plugins/$pa/hooks/register.ts"
  mini_manifest "$R/plugins/$pa/.claude-plugin/plugin.json" 0.1.1
  register_two "$R/plugins/$pb/hooks/register.ts"
  git -C "$R" add -A plugins
  out=$(run_door "$R"); rc=$?
  why=$(check_only "ВЕРСИЯ_НЕ_ПОДНЯТА" "$out")
  (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ВЕРСИЯ_НЕ_ПОДНЯТА: plugins/$pb --"* ]] \
    || t42="${t42}«$pair»: rc=$rc $why[$out]; "
done
if [ -z "$t42" ]; then
  ok "42) plugins/foo* и plugins/[x] без подъёма рядом с поднятыми foo/x -- ВЕРСИЯ_НЕ_ПОДНЯТА за них"
else
  bad "42) glob в именах плагинов: $t42"
fi

# --- 43. Г16: переименование из плагина наружу -- старое имя классифицируется ------
R=$(mk_world rename_out)
register_one "$R/plugins/mini/hooks/x.ts"
git -C "$R" add plugins/mini
git -C "$R" commit -qm x
git -C "$R" mv plugins/mini/hooks/x.ts docs/x.ts
out=$(run_door "$R"); rc=$?
why=$(check_only "ВЕРСИЯ_НЕ_ПОДНЯТА" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ВЕРСИЯ_НЕ_ПОДНЯТА: plugins/mini --"* ]]; then
  ok "43) git mv plugins/mini/hooks/x.ts docs/x.ts без подъёма -- ВЕРСИЯ_НЕ_ПОДНЯТА за plugins/mini"
else
  bad "43) переименование наружу: rc=$rc $why[$out]"
fi

# --- 44. Г17: .ts-симлинк под hooks/ судится осью C ------------------------------
R=$(mk_world ts_symlink)
mkdir -p "$R/plugins/mini/src"
printf 'function broken( {\n' > "$R/plugins/mini/src/broken.ts"
ln -s ../src/broken.ts "$R/plugins/mini/hooks/link.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
why=$(check_only "СИНТАКСИС_МОДУЛЯ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"СИНТАКСИС_МОДУЛЯ: plugins/mini/hooks/link.ts"* ]]; then
  ok "44) .ts-симлинк на битый код -- СИНТАКСИС_МОДУЛЯ с путём симлинка"
else
  bad "44) симлинк в оси C: rc=$rc $why[$out]"
fi

# --- 45. Г19: rc=0x -- не rc=0 (сравнение строки целиком, не префикс) -------------
R=$(mk_world wit_rc0x)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
T=$(git -C "$R" write-tree)
mkdir -p "$R/.git/catalyst-witness"
printf 'scope=run-all\nrc=0x\nhost=usbox\n' > "$R/.git/catalyst-witness/$T"
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"(rc);"* ]]; then
  ok "45) свидетель rc=0x -- СВИДЕТЕЛЯ_НЕТ (rc)"
else
  bad "45) rc=0x: rc=$rc $why[$out]"
fi

# --- 46. Г19: rc=0\r -- CR не отбрасывается ---------------------------------------
R=$(mk_world wit_rc0cr)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
T=$(git -C "$R" write-tree)
mkdir -p "$R/.git/catalyst-witness"
printf 'scope=run-all\nrc=0\r\nhost=usbox\n' > "$R/.git/catalyst-witness/$T"
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"(rc);"* ]]; then
  ok "46) свидетель rc=0\\r -- СВИДЕТЕЛЯ_НЕТ (rc)"
else
  bad "46) rc=0\\r: rc=$rc $why[$out]"
fi

# --- 47. отказ git diff --cached --quiet в оси A -> ПРИБОР_НЕДОСТУПЕН ------------
# CONSTRAINT: rc 128 не «код отличается»: иначе сравнение версий шло бы по
# неизмеренной разнице, и отказ git проходил бы как штатная ветка.
R=$(mk_world quiet_rc)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
GBIN="$ROOT/gbin47"; mkdir -p "$GBIN"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "diff" ] && [ "\$2" = "--cached" ] && [ "\${3:-}" = "--quiet" ]; then
  printf 'fatal: stub-git diff --cached --quiet rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git diff --cached --quiet rc=128"* ]]; then
  ok "47) git diff --cached --quiet rc=128 в оси A -- ПРИБОР_НЕДОСТУПЕН, не «код отличается»"
else
  bad "47) rc diff --quiet: rc=$rc $why[$out]"
fi

# --- 48. FIX5 Ж1: staged-манифест без version при правке кода -> МАНИФЕСТ_БЕЗ_ВЕРСИИ
R=$(mk_world manifest_nov)
printf '{"name":"mini"}\n' > "$R/plugins/mini/.claude-plugin/plugin.json"
register_one "$R/plugins/mini/hooks/x.ts"
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТ_БЕЗ_ВЕРСИИ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_БЕЗ_ВЕРСИИ: plugins/mini/.claude-plugin/plugin.json"* ]]; then
  ok "48) манифест без version + правка кода -- МАНИФЕСТ_БЕЗ_ВЕРСИИ и только она"
else
  bad "48) манифест без версии (ось A): rc=$rc $why[$out]"
fi

# --- 49. FIX5 Ж1: зеркало без version -> МАНИФЕСТ_БЕЗ_ВЕРСИИ, не ЗЕРКАЛА_РАЗОШЛИСЬ
R=$(mk_world mirror_nov)
printf '{"name":"x"}\n' > "$R/.codex-plugin/plugin.json"
git -C "$R" add .codex-plugin
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТ_БЕЗ_ВЕРСИИ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_БЕЗ_ВЕРСИИ: .codex-plugin/plugin.json"* ]]; then
  ok "49) зеркало без version при трёх сошедшихся -- МАНИФЕСТ_БЕЗ_ВЕРСИИ и только она"
else
  bad "49) манифест без версии (ось D): rc=$rc $why[$out]"
fi

# --- 50. FIX5 Ж1 (swe2 H1, вход дословно): ДОМ без version -- сравнение не уводится
R=$(mk_world swe2_home_nov)
printf '{"name":"catalyst"}\n' > "$R/.claude-plugin/plugin.json"
mkdir -p "$R/skills/x"
printf 'skill\n' > "$R/skills/x/SKILL.md"
git -C "$R" add .claude-plugin skills
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТ_БЕЗ_ВЕРСИИ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_БЕЗ_ВЕРСИИ"* ]] \
   && [[ "$out" != *"зеркала"* ]]; then
  ok "50) home без version + зеркала 0.1.0 + skills -- МАНИФЕСТ_БЕЗ_ВЕРСИИ, строки успеха про зеркала нет"
else
  bad "50) пустая первая версия: rc=$rc $why[$out]"
fi

# --- 51. FIX5 Ж2: отказ git show :<manifest> -- ПРИБОР_НЕДОСТУПЕН, не «манифеста нет»
R=$(mk_world showfail_index)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
GBIN="$ROOT/gbin51"; mkdir -p "$GBIN"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "show" ] && [ "\${2:-}" = ":plugins/mini/.claude-plugin/plugin.json" ]; then
  printf 'stub-git: show :manifest rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git show :plugins/mini/.claude-plugin/plugin.json"* ]] \
   && [[ "$out" == *"stub-git: show :manifest rc=128"* ]]; then
  ok "51) git show :<manifest> rc=128 при правке кода -- ПРИБОР_НЕДОСТУПЕН (заглушка названа в выводе)"
else
  bad "51) отказ show индексного манифеста: rc=$rc $why[$out]"
fi

# --- 52. FIX5 Ж2: отказ git show :<зеркало> -- ПРИБОР_НЕДОСТУПЕН, не ОТСУТСТВУЕТ ----
R=$(mk_world showfail_mirror)
printf '{"name":"catalyst","version":"0.1.0","mirror":"t"}\n' > "$R/.codex-plugin/plugin.json"
git -C "$R" add .codex-plugin
GBIN="$ROOT/gbin52"; mkdir -p "$GBIN"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "show" ] && [ "\${2:-}" = ":.codex-plugin/plugin.json" ]; then
  printf 'stub-git: show :mirror rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git show :.codex-plugin/plugin.json"* ]] \
   && [[ "$out" == *"stub-git: show :mirror rc=128"* ]]; then
  ok "52) git show :<зеркало> rc=128 при прежней версии -- ПРИБОР_НЕДОСТУПЕН, не «ОТСУТСТВУЕТ»"
else
  bad "52) отказ show зеркального манифеста: rc=$rc $why[$out]"
fi

# --- 53. FIX5 Ж2: отказ git show HEAD:<manifest> -- ПРИБОР_НЕДОСТУПЕН, не «нет у предка»
R=$(mk_world showfail_parent)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
GBIN="$ROOT/gbin53"; mkdir -p "$GBIN"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "show" ] && [ "\${2:-}" = "HEAD:plugins/mini/.claude-plugin/plugin.json" ]; then
  printf 'stub-git: show HEAD:manifest rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git show HEAD:"* ]] \
   && [[ "$out" == *"stub-git: show HEAD:manifest rc=128"* ]]; then
  ok "53) git show HEAD:<manifest> rc=128 при поднятой версии -- ПРИБОР_НЕДОСТУПЕН (заглушка названа)"
else
  bad "53) отказ show родительского манифеста: rc=$rc $why[$out]"
fi

# --- 54. FIX5 Ж2: rev-parse HEAD rc=128 (не 0/1) -- ПРИБОР_НЕДОСТУПЕН с rc ----------
R=$(mk_world headrc)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
GBIN="$ROOT/gbin54"; mkdir -p "$GBIN"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ] && [ "\${2:-}" = "-q" ] && [ "\${3:-}" = "--verify" ] && [ "\${4:-}" = "HEAD" ]; then
  printf 'stub-git: rev-parse HEAD rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git rev-parse HEAD rc=128"* ]] \
   && [[ "$out" == *"stub-git: rev-parse HEAD rc=128"* ]]; then
  ok "54) git rev-parse -q --verify HEAD rc=128 -- ПРИБОР_НЕДОСТУПЕН с названным rc (заглушка названа)"
else
  bad "54) отказ rev-parse HEAD: rc=$rc $why[$out]"
fi

# --- 55. ПИН РЕГРЕССИИ: unborn-ветка, первый коммит с плагином -- ось A молчит ------
# CONSTRAINT: зелёный на старом дереве (FIX4); красит его мутация GH6b (rc==1 -> fail).
R=$(mk_world unborn)
rm -rf "$R/.git"
git -C "$R" init -q
git -C "$R" config user.email t@t
git -C "$R" config user.name t
git -C "$R" add plugins/mini
printf 'tests/stand-map.tsv\trun-all\n' >> "$R/tests/stand-map.tsv"
git -C "$R" add tests/stand-scope.sh tests/stand-map.tsv tests/scripts/test-mini-stand.sh tests/scripts/test-run-all.sh tests/scripts/test-plugin-gate.sh
add_witness "$R" mini-stand,plugin-gate,run-all 0 >/dev/null
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" != *"ВЕРСИЯ_НЕ_ПОДНЯТА"* ]] && [[ "$out" != *"ПРИБОР_НЕДОСТУПЕН"* ]]; then
  ok "55) unborn HEAD + первый коммит с версионным манифестом -- без ВЕРСИЯ_НЕ_ПОДНЯТА и без ПРИБОР_НЕДОСТУПЕН, rc=0"
else
  bad "55) unborn-ветка: ждали rc=0 без этих причин, получили rc=$rc [$out]"
fi

# --- 56. FIX5 Ж3: отказ mktemp LSF -- trap убирает SNAP; в TMPDIR зуба чисто --------
R=$(mk_world mktempfail)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
REALMKTEMP="$(command -v mktemp)"
MBIN="$ROOT/tbin56"; mkdir -p "$MBIN"
cat > "$MBIN/mktemp" <<EOF2
#!/usr/bin/env bash
for a in "\$@"; do
  case "\$a" in *plugin-gate-ls*) printf 'stub-mktemp: plugin-gate-ls rc=1\n' >&2; exit 1 ;; esac
done
exec "$REALMKTEMP" "\$@"
EOF2
chmod +x "$MBIN/mktemp"
T56="$ROOT/tmp56"; mkdir -p "$T56"
out=$(run_door "$R" PATH="$MBIN:$PATH" TMPDIR="$T56"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
left56=$(find "$T56" -name 'plugin-gate-snap.*' 2>/dev/null | tr '\n' ' ')
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: не создан файл списка снимка"* ]] \
   && [[ "$out" == *"stub-mktemp: plugin-gate-ls rc=1"* ]] && [ -z "$left56" ]; then
  ok "56) mktemp LSF rc=1 -- ПРИБОР_НЕДОСТУПЕН и ни одного plugin-gate-snap.* в TMPDIR зуба (заглушка названа)"
else
  bad "56) уборка SNAP при отказе LSF: rc=$rc $why leftovers=[$left56] [$out]"
fi

# --- 57. FIX5 Ж4: awk отказал (пусто) -- счёт не «3», свидетель красится по форме ---
R=$(mk_world awkfail)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
T=$(git -C "$R" write-tree)
mkdir -p "$R/.git/catalyst-witness"
printf 'scope=run-all\nrc=0\nhost=usbox\nextra\n' > "$R/.git/catalyst-witness/$T"
REALAWK="$(command -v awk)"
ABIN="$ROOT/tbin57"; mkdir -p "$ABIN"
cat > "$ABIN/awk" <<EOF2
#!/usr/bin/env bash
printf 'stub-awk: rc=1\n' >&2
exit 1
EOF2
chmod +x "$ABIN/awk"
out=$(run_door "$R" PATH="$ABIN:$PATH"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"(формат);"* ]] && [[ "$out" == *"stub-awk: rc=1"* ]]; then
  ok "57) отказавший awk (пустой счёт) при 4-строчном свидетеле -- СВИДЕТЕЛЯ_НЕТ (формат), не молчаливый пропуск"
else
  bad "57) пустой счёт строк: rc=$rc $why[$out]"
fi

# --- 58. FIX5 Ж5: голый путь plugins/x -- классификатор не молчит -------------------
R=$(mk_world familyfile)
printf 'x\n' > "$R/plugins/x"
git -C "$R" add plugins/x
out=$(run_door "$R"); rc=$?
why=$(check_only "ПУТЬ_СЕМЬИ_НЕ_КЛАССИФИЦИРОВАН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПУТЬ_СЕМЬИ_НЕ_КЛАССИФИЦИРОВАН: plugins/x"* ]]; then
  ok "58) staged файл plugins/x -- ПУТЬ_СЕМЬИ_НЕ_КЛАССИФИЦИРОВАН, не молчаливый exit 0"
else
  bad "58) голый путь семьи: rc=$rc $why[$out]"
fi

# --- 59. FIX5 Ж5: голый файл с именем каталога семьи .claude-plugin -----------------
R59="$ROOT/bare-family59"; mkdir -p "$R59"
git -C "$R59" init -q
git -C "$R59" config user.email t@t
git -C "$R59" config user.name t
printf 'x\n' > "$R59/.claude-plugin"
git -C "$R59" add .claude-plugin
out=$(run_door "$R59"); rc=$?
why=$(check_only "ПУТЬ_СЕМЬИ_НЕ_КЛАССИФИЦИРОВАН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПУТЬ_СЕМЬИ_НЕ_КЛАССИФИЦИРОВАН: .claude-plugin"* ]]; then
  ok "59) staged голый файл .claude-plugin -- ПУТЬ_СЕМЬИ_НЕ_КЛАССИФИЦИРОВАН: .claude-plugin"
else
  bad "59) имя каталога семьи как файл: rc=$rc $why[$out]"
fi

# --- 60. FIX6: отказ git ls-files -s манифеста в оси A -- ПРИБОР_НЕДОСТУПЕН ----------
R=$(mk_world lsfail_a)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
GBIN="$ROOT/gbin60"; mkdir -p "$GBIN"; J60="$ROOT/stub60.log"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "ls-files" ] && [ "\${2:-}" = "-s" ] && [ "\${4:-}" = ":(literal)plugins/mini/.claude-plugin/plugin.json" ]; then
  printf 'FAIL %s\n' "\$*" >> "$J60"
  printf 'stub-git: ls-files -s manifest rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git ls-files plugins/mini/.claude-plugin/plugin.json"* ]] \
   && grep -qxF 'FAIL ls-files -s -- :(literal)plugins/mini/.claude-plugin/plugin.json' "$J60"; then
  ok "60) git ls-files -s манифеста rc=128 в оси A -- ПРИБОР_НЕДОСТУПЕН (журнал заглушки: уронен именно этот вызов)"
else
  bad "60) отказ ls-files оси A: rc=$rc $why журнал=[$(cat "$J60" 2>/dev/null)] [$out]"
fi

# --- 61. FIX6: отказ git rev-parse --git-dir в оси A -- ПРИБОР_НЕДОСТУПЕН -----------
# CONSTRAINT: заглушка роняет только ПЕРВЫЙ вызов --git-dir (ось A): второй
# (стадия 5) проходит -- иначе отказ стадии 5 выдавал бы себя за отказ оси A.
R=$(mk_world gitdir_a)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
GBIN="$ROOT/gbin61"; mkdir -p "$GBIN"; J61="$ROOT/stub61.log"; C61="$ROOT/stub61.cnt"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ] && [ "\${2:-}" = "--git-dir" ] && [ \$# -eq 2 ]; then
  n=0; [ -f "$C61" ] && n=\$(cat "$C61"); n=\$((n+1)); printf '%s' "\$n" > "$C61"
  if [ "\$n" = 1 ]; then
    printf 'FAIL#%s %s\n' "\$n" "\$*" >> "$J61"
    printf 'stub-git: rev-parse --git-dir rc=128\n' >&2
    exit 128
  fi
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git rev-parse --git-dir"* ]] && [[ "$out" != *"(свидетель)"* ]] \
   && grep -qxF 'FAIL#1 rev-parse --git-dir' "$J61"; then
  ok "61) git rev-parse --git-dir rc=128 в оси A -- ПРИБОР_НЕДОСТУПЕН (журнал: уронен вызов №1)"
else
  bad "61) отказ --git-dir оси A: rc=$rc $why журнал=[$(cat "$J61" 2>/dev/null)] [$out]"
fi

# --- 62. FIX6: предок HEAD не разрешается (rev-parse HEAD^{commit} rc 1) -----------
R=$(mk_world parent_commit)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
GBIN="$ROOT/gbin62"; mkdir -p "$GBIN"; J62="$ROOT/stub62.log"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ] && [ "\${2:-}" = "-q" ] && [ "\${3:-}" = "--verify" ] && [ "\${4:-}" = "HEAD^{commit}" ]; then
  printf 'FAIL %s\n' "\$*" >> "$J62"
  printf 'stub-git: rev-parse HEAD^{commit} rc=1\n' >&2
  exit 1
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: предок HEAD не разрешается"* ]] \
   && grep -qxF 'FAIL rev-parse -q --verify HEAD^{commit}' "$J62"; then
  ok "62) rev-parse -q --verify HEAD^{commit} rc=1 -- ПРИБОР_НЕДОСТУПЕН: предок не разрешается"
else
  bad "62) предок не разрешается: rc=$rc $why журнал=[$(cat "$J62" 2>/dev/null)] [$out]"
fi

# --- 63. FIX6: rev-parse HEAD:<manifest> rc=128 (не 0/1) -- ПРИБОР_НЕДОСТУПЕН -------
R=$(mk_world parent_manifest)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
GBIN="$ROOT/gbin63"; mkdir -p "$GBIN"; J63="$ROOT/stub63.log"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ] && [ "\${2:-}" = "-q" ] && [ "\${3:-}" = "--verify" ] && [ "\${4:-}" = "HEAD:plugins/mini/.claude-plugin/plugin.json" ]; then
  printf 'FAIL %s\n' "\$*" >> "$J63"
  printf 'stub-git: rev-parse HEAD:manifest rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git rev-parse HEAD:plugins/mini/.claude-plugin/plugin.json rc=128"* ]] \
   && grep -qxF 'FAIL rev-parse -q --verify HEAD:plugins/mini/.claude-plugin/plugin.json' "$J63"; then
  ok "63) rev-parse -q --verify HEAD:<manifest> rc=128 -- ПРИБОР_НЕДОСТУПЕН с rc, не «нет у предка»"
else
  bad "63) rc манифеста предка: rc=$rc $why журнал=[$(cat "$J63" 2>/dev/null)] [$out]"
fi

# --- 64. FIX6: отказ git ls-files -s зеркала в оси D -- ПРИБОР_НЕДОСТУПЕН ----------
R=$(mk_world lsfail_d)
printf '{"name":"catalyst","version":"0.1.0","mirror":"t"}\n' > "$R/.codex-plugin/plugin.json"
git -C "$R" add .codex-plugin
GBIN="$ROOT/gbin64"; mkdir -p "$GBIN"; J64="$ROOT/stub64.log"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "ls-files" ] && [ "\${2:-}" = "-s" ] && [ "\${4:-}" = ":(literal).codex-plugin/plugin.json" ]; then
  printf 'FAIL %s\n' "\$*" >> "$J64"
  printf 'stub-git: ls-files -s mirror rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git ls-files .codex-plugin/plugin.json"* ]] \
   && grep -qxF 'FAIL ls-files -s -- :(literal).codex-plugin/plugin.json' "$J64"; then
  ok "64) git ls-files -s зеркала rc=128 в оси D -- ПРИБОР_НЕДОСТУПЕН, не «ОТСУТСТВУЕТ»"
else
  bad "64) отказ ls-files оси D: rc=$rc $why журнал=[$(cat "$J64" 2>/dev/null)] [$out]"
fi

# --- 65. FIX6: отказ git write-tree на стадии 5 -- ПРИБОР_НЕДОСТУПЕН ---------------
R=$(mk_world wtfail)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
add_witness "$R" run-all 0 >/dev/null
GBIN="$ROOT/gbin65"; mkdir -p "$GBIN"; J65="$ROOT/stub65.log"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "write-tree" ]; then
  printf 'FAIL %s\n' "\$*" >> "$J65"
  printf 'stub-git: write-tree rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git write-tree"* ]] \
   && grep -qxF 'FAIL write-tree' "$J65"; then
  ok "65) git write-tree rc=128 на стадии 5 -- ПРИБОР_НЕДОСТУПЕН, не СВИДЕТЕЛЯ_НЕТ"
else
  bad "65) отказ write-tree: rc=$rc $why журнал=[$(cat "$J65" 2>/dev/null)] [$out]"
fi

# --- 66. FIX6: отказ git rev-parse --git-dir на стадии 5 -- ПРИБОР_НЕДОСТУПЕН -------
# CONSTRAINT: первый вызов --git-dir -- ось A (правка кода с подъёмом версии),
# заглушка роняет ВТОРОЙ -- тот, что ищет каталог свидетеля.
R=$(mk_world gitdir_wit)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
GBIN="$ROOT/gbin66"; mkdir -p "$GBIN"; J66="$ROOT/stub66.log"; C66="$ROOT/stub66.cnt"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ] && [ "\${2:-}" = "--git-dir" ] && [ \$# -eq 2 ]; then
  n=0; [ -f "$C66" ] && n=\$(cat "$C66"); n=\$((n+1)); printf '%s' "\$n" > "$C66"
  if [ "\$n" = 2 ]; then
    printf 'FAIL#%s %s\n' "\$n" "\$*" >> "$J66"
    printf 'stub-git: rev-parse --git-dir rc=128\n' >&2
    exit 128
  fi
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git rev-parse --git-dir (свидетель)"* ]] \
   && grep -qxF 'FAIL#2 rev-parse --git-dir' "$J66"; then
  ok "66) git rev-parse --git-dir rc=128 на стадии 5 (вызов №2) -- ПРИБОР_НЕДОСТУПЕН (свидетель)"
else
  bad "66) отказ --git-dir стадии 5: rc=$rc $why журнал=[$(cat "$J66" 2>/dev/null)] [$out]"
fi

# --- 67. FIX6 Ж13: staged файл с именем plugins -- отказ классификатора -------------
R67="$ROOT/bare-plugins67"; mkdir -p "$R67"
git -C "$R67" init -q
git -C "$R67" config user.email t@t
git -C "$R67" config user.name t
printf 'x\n' > "$R67/plugins"
git -C "$R67" add plugins
out=$(run_door "$R67"); rc=$?
why=$(check_only "ПУТЬ_СЕМЬИ_НЕ_КЛАССИФИЦИРОВАН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПУТЬ_СЕМЬИ_НЕ_КЛАССИФИЦИРОВАН: plugins" ]]; then
  ok "67) staged голый файл plugins -- ПУТЬ_СЕМЬИ_НЕ_КЛАССИФИЦИРОВАН: plugins"
else
  bad "67) голый plugins: rc=$rc $why[$out]"
fi

# --- 68. FIX6 Ж14: коммит удаляет плагин целиком -- оси B и C к нему не применимы ----
# CONSTRAINT: заглушка claude отказывает на несуществующем каталоге -- без
# пропуска удалённого плагина зуб краснеет ВАЛИДАТОР_ОТКАЗАЛ.
R=$(mk_world removed_plugin)
git -C "$R" rm -r -q plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
REALCLAUDE="$(command -v claude)"
CBIN="$ROOT/cbin68"; mkdir -p "$CBIN"
cat > "$CBIN/claude" <<EOF2
#!/usr/bin/env bash
if [ "\${1:-}" = "plugin" ] && [ "\${2:-}" = "validate" ] && [ ! -d "\${3:-}" ]; then
  printf 'stub-claude: validate %s: каталога нет rc=1\n' "\${3:-}" >&2
  exit 1
fi
exec "$REALCLAUDE" "\$@"
EOF2
chmod +x "$CBIN/claude"
out=$(run_door "$R" PATH="$CBIN:$PATH"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"плагин plugins/mini удалён"* ]] && [[ "$out" == *"стадия 5: свидетель"* ]] \
   && [[ "$out" != *"ВАЛИДАТОР_ОТКАЗАЛ"* ]]; then
  ok "68) удалены все файлы plugins/mini -- rc 0, «плагин plugins/mini удалён», валидатор к нему не звался"
else
  bad "68) удалённый плагин: rc=$rc [$out]"
fi

# --- 69. FIX6 Ж15: коммит только norms.yaml -- стадия 5 требует свидетеля lint ------
R=$(mk_world norms_only)
mkdir -p "$R/scripts"
printf 'print(1)\n' > "$R/scripts/lint.py"
printf 'norms.yaml\tlint\n' >> "$R/tests/stand-map.tsv"
git -C "$R" add scripts/lint.py tests/stand-map.tsv
git -C "$R" commit -qm lint
printf 'norms: 1\n' > "$R/norms.yaml"
git -C "$R" add norms.yaml
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"нужен scope lint"* ]]; then
  ok "69) коммит только norms.yaml без свидетеля -- СВИДЕТЕЛЯ_НЕТ (scope lint), не молчаливый exit 0"
else
  bad "69) norms.yaml: rc=$rc $why[$out]"
fi

# --- 70. FIX6 Ж15: коммит только нового файла вне карты -- КАРТА_НЕ_ПОКРЫВАЕТ -------
R=$(mk_world newfile)
printf 'x\n' > "$R/newfile.xyz"
git -C "$R" add newfile.xyz
out=$(run_door "$R"); rc=$?
why=$(check_only "КАРТА_НЕ_ПОКРЫВАЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"НЕ ПОКРЫТ newfile.xyz"* ]]; then
  ok "70) коммит только newfile.xyz -- КАРТА_НЕ_ПОКРЫВАЕТ с путём"
else
  bad "70) новый файл вне карты: rc=$rc $why[$out]"
fi

# --- 71. FIX6 Ж12: только манифест плагина без version -- МАНИФЕСТ_БЕЗ_ВЕРСИИ -------
R=$(mk_world manifest_only_nov)
printf '{"name":"mini","description":"d","author":{"name":"t"}}\n' > "$R/plugins/mini/.claude-plugin/plugin.json"
git -C "$R" add plugins/mini/.claude-plugin/plugin.json
add_witness "$R" mini-stand 0 >/dev/null
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТ_БЕЗ_ВЕРСИИ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_БЕЗ_ВЕРСИИ: plugins/mini/.claude-plugin/plugin.json (индекс): version отсутствует или не является непустой печатаемой строкой без пробелов по краям"* ]]; then
  ok "71) коммит только манифеста без version -- МАНИФЕСТ_БЕЗ_ВЕРСИИ без правки кода"
else
  bad "71) манифест без версии без кода: rc=$rc $why[$out]"
fi

# --- 72. FIX6 Ж11: version null / 1 / "  " / {} при правке кода -- МАНИФЕСТ_БЕЗ_ВЕРСИИ
t72=""; i72=0
for vj in 'null' '1' '"  "' '{}'; do
  i72=$((i72+1)); R=$(mk_world "vbad$i72")
  register_two "$R/plugins/mini/hooks/register.ts"
  printf '{"name":"mini","version":%s,"description":"d","author":{"name":"t"}}\n' "$vj" > "$R/plugins/mini/.claude-plugin/plugin.json"
  git -C "$R" add plugins/mini
  out=$(run_door "$R"); rc=$?
  why=$(check_only "МАНИФЕСТ_БЕЗ_ВЕРСИИ" "$out")
  (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_БЕЗ_ВЕРСИИ: plugins/mini/.claude-plugin/plugin.json (индекс): version отсутствует или не является непустой печатаемой строкой без пробелов по краям"* ]] \
    || t72="${t72}«version:$vj»: rc=$rc $why[$out]; "
done
if [ -z "$t72" ]; then
  ok "72) version null / 1 / \"  \" / {} при правке кода -- МАНИФЕСТ_БЕЗ_ВЕРСИИ в каждом"
else
  bad "72) нестроковая/пробельная версия: $t72"
fi

# --- 73. FIX6 Ж11: зеркало с version null -- МАНИФЕСТ_БЕЗ_ВЕРСИИ, не ЗЕРКАЛА_РАЗОШЛИСЬ
R=$(mk_world mirror_null)
printf '{"name":"catalyst","version":null}\n' > "$R/.codex-plugin/plugin.json"
git -C "$R" add .codex-plugin
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТ_БЕЗ_ВЕРСИИ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_БЕЗ_ВЕРСИИ: .codex-plugin/plugin.json (индекс): version отсутствует или не является непустой печатаемой строкой без пробелов по краям"* ]]; then
  ok "73) зеркало .codex-plugin с version null -- МАНИФЕСТ_БЕЗ_ВЕРСИИ"
else
  bad "73) зеркало с null: rc=$rc $why[$out]"
fi

# --- 74/75. FIX6 Ж17: сигнал двери во время оси B -- временные убраны ---------------
# CONSTRAINT: сигнал уходит только после появления снимка И старта заглушки
# claude (дверь стоит в оси B); код выхода 128+N доказывает, что прогон
# кончился сигналом, а не штатно после сна заглушки.
sig_door() {   # <номер> <сигнал> <ожидаемый rc>
  local n="$1" sig="$2" want="$3" R CB TD pid rc left i
  R=$(mk_world "sig$n")
  register_two "$R/plugins/mini/hooks/register.ts"
  mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
  git -C "$R" add plugins/mini
  CB="$ROOT/cbin$n"; mkdir -p "$CB"
  cat > "$CB/claude" <<EOF2
#!/usr/bin/env bash
printf '%s' "\$\$" > "$ROOT/claude$n.pid"
: > "$ROOT/claude$n.started"
exec sleep 20
EOF2
  chmod +x "$CB/claude"
  TD="$ROOT/tmp$n"; mkdir -p "$TD"
  ( cd "$R" && exec env CLAUDE_CONFIG_DIR="$R/home" PATH="$CB:$PATH" TMPDIR="$TD" python3 -c "$SIGDFL" bash "$DOOR" ) > "$ROOT/out$n" 2>&1 &
  pid=$!
  for i in $(seq 1 300); do
    ls "$TD" | grep -q '^plugin-gate-snap\.' && break
    sleep 0.1
  done
  for i in $(seq 1 300); do
    [ -e "$ROOT/claude$n.started" ] && break
    sleep 0.1
  done
  kill -"$sig" "$pid"
  wait "$pid"; rc=$?
  [ -f "$ROOT/claude$n.pid" ] && kill "$(cat "$ROOT/claude$n.pid")" 2>/dev/null
  left=$(ls -A "$TD" | grep -E '^plugin-gate-(snap|ls)\.' | tr '\n' ' ')
  if [ -e "$ROOT/claude$n.started" ] && [ "$rc" = "$want" ] && [ -z "$left" ]; then
    ok "$n) $sig двери во время оси B -- rc=$rc, в TMPDIR нет plugin-gate-snap.* и plugin-gate-ls.*"
  else
    bad "$n) $sig во время оси B: rc=$rc (ждали $want) started=$([ -e "$ROOT/claude$n.started" ] && echo 1 || echo 0) остатки=[$left] [$(cat "$ROOT/out$n")]"
  fi
}
sig_door 74 HUP 129
sig_door 75 QUIT 131

# --- 77. FIX6 AR-3: ось B судит ИНДЕКС -- индексный манифест отвергнут валидатором -
# CONSTRAINT: индексный манифест проходит Ж11 (version -- корректная строка), и
# отказ оси A его не перехватывает; рабочая копия манифеста -- без метки, так что
# валидатор, читающий рабочее дерево, прошёл бы. Заглушка validate отвергает
# ровно метку REJECT-ME.
R=$(mk_world axis_b_idx_red)
printf '{"name":"mini","version":"0.1.1","description":"REJECT-ME","author":{"name":"t"}}\n' > "$R/plugins/mini/.claude-plugin/plugin.json"
git -C "$R" add plugins/mini/.claude-plugin/plugin.json
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
add_witness "$R" mini-stand 0 >/dev/null
REALCLAUDE77="$(command -v claude)"
CBIN="$ROOT/cbin77"; mkdir -p "$CBIN"
cat > "$CBIN/claude" <<EOF2
#!/usr/bin/env bash
if [ "\${1:-}" = "plugin" ] && [ "\${2:-}" = "validate" ] && grep -q REJECT-ME "\${3:-}/.claude-plugin/plugin.json"; then
  printf 'stub-claude: validate %s: REJECT-ME rc=1\n' "\${3:-}" >&2
  exit 1
fi
exec "$REALCLAUDE77" "\$@"
EOF2
chmod +x "$CBIN/claude"
out=$(run_door "$R" PATH="$CBIN:$PATH"); rc=$?
why=$(check_only "ВАЛИДАТОР_ОТКАЗАЛ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ВАЛИДАТОР_ОТКАЗАЛ: claude plugin validate plugins/mini"* ]] \
   && [[ "$out" == *"stub-claude: validate"*"REJECT-ME rc=1"* ]]; then
  ok "77) индексный манифест с корректной версией отвергнут валидатором при чистой рабочей копии -- ВАЛИДАТОР_ОТКАЗАЛ"
else
  bad "77) ось B по индексу (отказ валидатора): rc=$rc $why[$out]"
fi

# --- 78. FIX7 Ж23: манифест снят из индекса, код плагина в нём -- МАНИФЕСТА_НЕТ -----
R=$(mk_world manifest_gone)
register_two "$R/plugins/mini/hooks/register.ts"
git -C "$R" rm -q plugins/mini/.claude-plugin/plugin.json
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТА_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТА_НЕТ: plugins/mini/.claude-plugin/plugin.json"* ]]; then
  ok "78) git rm манифеста плагина + правка кода -- МАНИФЕСТА_НЕТ, не ветка «удалён/новый»"
else
  bad "78) манифест снят при живом коде: rc=$rc $why[$out]"
fi

# --- 79. FIX7 Ж23: корневой манифест снят, skills/ в индексе -- МАНИФЕСТА_НЕТ -------
R=$(mk_world root_manifest_gone)
printf 'skill more\n' > "$R/skills/s.md"
git -C "$R" rm -q .claude-plugin/plugin.json
git -C "$R" add skills
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТА_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТА_НЕТ: .claude-plugin/plugin.json"* ]]; then
  ok "79) git rm .claude-plugin/plugin.json + правка skills/ -- МАНИФЕСТА_НЕТ"
else
  bad "79) корневой манифест снят: rc=$rc $why[$out]"
fi

# --- 80. FIX7 Ж24: плагин удалён целиком -- итог не называет осей плагина -----------
R=$(mk_world removed_summary)
git -C "$R" rm -r -q plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"дверь приёмки плагина: плагины удалены"* ]] \
   && [[ "$out" == *"удалены: plugins/mini"* ]] && [[ "$out" != *"версия/валидатор"* ]]; then
  ok "80) git rm -r plugins/mini -- итог «плагины удалены … удалены: plugins/mini», оси плагина не объявлены"
else
  bad "80) итог удалённого плагина: rc=$rc [$out]"
fi

# --- 81. FIX7 Ж24: правка плагина -- итог без оси зеркал --------------------------
R=$(mk_world summary_plugin)
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
add_witness "$R" mini-stand 0 >/dev/null
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"дверь приёмки плагина: прошло (версия/валидатор/синтаксис; свидетель стендов mini-stand) -- plugins/mini"* ]] \
   && [[ "$out" != *"зеркала"* ]]; then
  ok "81) правка plugins/mini с подъёмом -- итог называет plugins/mini, оси зеркал в нём нет"
else
  bad "81) итог плагина: rc=$rc [$out]"
fi

# --- 82. FIX7 Ж24: правка корня с подъёмом во всех зеркалах -- итог с /зеркала -------
R=$(mk_world summary_root)
printf 'skills/\t-\n.claude-plugin/\t-\n.codex-plugin/\t-\n.cursor-plugin/\t-\n.kimi-plugin/\t-\n' >> "$R/tests/stand-map.tsv"
git -C "$R" add tests/stand-map.tsv
git -C "$R" commit -qm map
printf 'skill more\n' > "$R/skills/s.md"
root_manifest "$R/.claude-plugin/plugin.json" 0.2.0
for m in .codex-plugin .cursor-plugin .kimi-plugin; do
  printf '{"name":"catalyst","version":"0.2.0"}\n' > "$R/$m/plugin.json"
done
git -C "$R" add skills .claude-plugin .codex-plugin .cursor-plugin .kimi-plugin
out=$(run_door "$R"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"дверь приёмки плагина: прошло (версия/валидатор/синтаксис/зеркала; стенды не звались: пути вне стендов по карте) -- ."* ]]; then
  ok "82) правка корня, 0.2.0 во всех четырёх зеркалах -- итог с осью /зеркала"
else
  bad "82) итог корня: rc=$rc [$out]"
fi

# --- 83. FIX7 Ж25: version с управляющим символом (\u0007) -- МАНИФЕСТ_БЕЗ_ВЕРСИИ ----
R=$(mk_world vbell)
register_two "$R/plugins/mini/hooks/register.ts"
printf '%s\n' '{"name":"mini","version":"0.2\u0007","description":"d","author":{"name":"t"}}' > "$R/plugins/mini/.claude-plugin/plugin.json"
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТ_БЕЗ_ВЕРСИИ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_БЕЗ_ВЕРСИИ: plugins/mini/.claude-plugin/plugin.json"* ]]; then
  ok "83) version \"0.2\\u0007\" при правке кода -- МАНИФЕСТ_БЕЗ_ВЕРСИИ (непечатаемая версия)"
else
  bad "83) непечатаемая версия: rc=$rc $why[$out]"
fi

# --- 84. FIX7 Ж26: манифест ПРЕДКА не JSON, staged целый -- МАНИФЕСТ_НЕЧИТАЕМ (предок)
R=$(mk_world parent_broken)
printf '{ broken json\n' > "$R/plugins/mini/.claude-plugin/plugin.json"
git -C "$R" add plugins/mini/.claude-plugin/plugin.json
git -C "$R" commit -qm broken-manifest
register_two "$R/plugins/mini/hooks/register.ts"
mini_manifest "$R/plugins/mini/.claude-plugin/plugin.json" 0.1.1
git -C "$R" add plugins/mini
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТ_НЕЧИТАЕМ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_НЕЧИТАЕМ: plugins/mini/.claude-plugin/plugin.json (предок"* ]]; then
  ok "84) манифест HEAD не JSON, staged с новой версией + код -- МАНИФЕСТ_НЕЧИТАЕМ (предок)"
else
  bad "84) нечитаемый манифест предка: rc=$rc $why[$out]"
fi

# --- 85. FIX7 Ж26: зеркало в индексе не JSON при правке корня -- МАНИФЕСТ_НЕЧИТАЕМ ----
R=$(mk_world mirror_broken)
printf 'skill more\n' > "$R/skills/s.md"
root_manifest "$R/.claude-plugin/plugin.json" 0.2.0
printf '{ broken json\n' > "$R/.codex-plugin/plugin.json"
git -C "$R" add skills .claude-plugin .codex-plugin
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТ_НЕЧИТАЕМ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТ_НЕЧИТАЕМ: .codex-plugin/plugin.json (индекс)"* ]]; then
  ok "85) .codex-plugin/plugin.json в индексе не JSON, правка корня -- МАНИФЕСТ_НЕЧИТАЕМ (индекс)"
else
  bad "85) нечитаемое зеркало: rc=$rc $why[$out]"
fi

# --- 86. FIX7 Ж32: префикс отказа один -- ни один fail двери не начинается с ОТКАЗ ----
# CONSTRAINT: grep rc 1 -- «совпадений нет»; rc 2 (файл не прочитан) -- красный,
# а не ноль совпадений.
n86=$(grep -cE 'fail[[:space:]]+["'"'"']ОТКАЗ' "$DOOR"); g86=$?
if [ "$g86" = 1 ] && [ "$n86" = 0 ]; then
  ok "86) .githooks/pre-commit: вызовов fail с аргументом «ОТКАЗ…» -- 0"
else
  bad "86) префикс ОТКАЗ в fail двери: grep rc=$g86 совпадений=$n86 [$(grep -nE 'fail[[:space:]]+["'"'"']ОТКАЗ' "$DOOR")]"
fi

# --- 87. FIX7 Ж34: карта берётся из ИНДЕКСА -- рабочая карта ничего не решает --------
R=$(mk_world idx_map)
cat > "$R/tests/stand-map.tsv" <<'EOF2'
plugins/mini/	mini-stand
tests/run-all.sh	run-all
tests/stand-scope.sh	run-all,plugin-gate
tests/pressure/	-
docs/	mini-stand
EOF2
git -C "$R" add tests/stand-map.tsv
git -C "$R" commit -qm idx-map
cat > "$R/tests/stand-map.tsv" <<'EOF2'
plugins/mini/	mini-stand
tests/run-all.sh	run-all
tests/stand-scope.sh	run-all,plugin-gate
tests/pressure/	-
docs/	-
EOF2
printf 'doc more\n' > "$R/docs/d.md"
git -C "$R" add docs/d.md
git -C "$R" diff --quiet -- tests/stand-map.tsv; dq87=$?
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if [ "$dq87" = 1 ] && (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"нужен scope mini-stand"* ]]; then
  ok "87) индексная карта: docs/ -> mini-stand, рабочая (не staged): docs/ -> - -- СВИДЕТЕЛЯ_НЕТ по индексной"
else
  bad "87) карта из индекса: рабочая≠индексной=$dq87 rc=$rc $why[$out]"
fi

# --- 88. FIX7 Ж34: сопоставитель берётся из ИНДЕКСА -- рабочая копия не исполняется --
# CONSTRAINT: стенд mini-stand даёт только строка карты, которой нет в HEAD: HEAD-
# проход (Ж35) его не восполнит, и исполненная вместо индексной рабочая копия
# («exit 0») видна по scope.
R=$(mk_world idx_scope)
printf 'tests/stand-map.tsv\trun-all\n' >> "$R/tests/stand-map.tsv"
git -C "$R" add tests/stand-map.tsv
git -C "$R" commit -qm map
mkdir -p "$R/newdir"
printf 'n\n' > "$R/newdir/x.txt"
printf 'newdir/\tmini-stand\n' >> "$R/tests/stand-map.tsv"
git -C "$R" add newdir/x.txt tests/stand-map.tsv
printf 'exit 0\n' > "$R/tests/stand-scope.sh"
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"нужен scope mini-stand,run-all;"* ]]; then
  ok "88) рабочая tests/stand-scope.sh = «exit 0» (не staged), строка newdir/ только в индексе -- исполнена индексная копия, СВИДЕТЕЛЯ_НЕТ со scope mini-stand,run-all"
else
  bad "88) сопоставитель из индекса: rc=$rc $why[$out]"
fi

# CONSTRAINT: миры зубов 89--91 несут в HEAD строку карты tests/stand-map.tsv ->
# run-all (как строка :17 карты C): без неё staged правка карты -- НЕ ПОКРЫТ.
mk_head_world() {   # <имя мира> -> путь репо; HEAD: настоящие сопоставитель и карта со строкой карты
  local r
  r=$(mk_world "$1")
  printf 'tests/stand-map.tsv\trun-all\n' >> "$r/tests/stand-map.tsv"
  git -C "$r" add tests/stand-map.tsv
  git -C "$r" commit -qm map
  printf '%s' "$r"
}

# --- 89. FIX8 Ж35 И1: индексный сопоставитель кастрирован -- scope из HEAD-копии ----
R=$(mk_head_world h_castr_scope)
printf '#!/usr/bin/env bash\nprintf "\\n"\nexit 0\n' > "$R/tests/stand-scope.sh"
git -C "$R" add tests/stand-scope.sh
SSI=$(cd "$R" && bash tests/stand-scope.sh --staged 2>&1); ssirc=$?
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if [ "$ssirc" = 0 ] && [ -z "$SSI" ] && (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"нужен scope plugin-gate,run-all;"* ]]; then
  ok "89) индексная tests/stand-scope.sh печатает пустоту -- дверь требует scope plugin-gate,run-all по HEAD-копии"
else
  bad "89) кастрированный сопоставитель: индексная копия rc=$ssirc [$SSI]; rc=$rc $why[$out]"
fi

# --- 90. FIX8 Ж35 И2: индексная карта кастрирована -- scope из HEAD-карты -----------
R=$(mk_head_world h_castr_map)
printf 'plugins/mini/\tmini-stand\ntests/run-all.sh\trun-all\ntests/stand-scope.sh\trun-all,plugin-gate\ntests/pressure/\t-\ndocs/\t-\ntests/stand-map.tsv\t-\n' > "$R/tests/stand-map.tsv"
git -C "$R" add tests/stand-map.tsv
SSI=$(cd "$R" && bash tests/stand-scope.sh --staged 2>&1); ssirc=$?
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if [ "$ssirc" = 0 ] && [ -z "$SSI" ] && (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"нужен scope run-all;"* ]]; then
  ok "90) индексная карта: tests/stand-map.tsv -> - -- дверь требует scope run-all по HEAD-карте"
else
  bad "90) кастрированная карта: индексный scope rc=$ssirc [$SSI]; rc=$rc $why[$out]"
fi

# --- 91. FIX8 Ж35 И3: новый путь и его строка карты только в индексе -- без ложного отказа
R=$(mk_head_world h_newline)
mkdir -p "$R/newdir"
printf 'n\n' > "$R/newdir/x.txt"
printf 'newdir/\tmini-stand\n' >> "$R/tests/stand-map.tsv"
git -C "$R" add newdir/x.txt tests/stand-map.tsv
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"нужен scope mini-stand,run-all;"* ]]; then
  ok "91) newdir/x.txt + строка newdir/ -> mini-stand только в индексе -- СВИДЕТЕЛЯ_НЕТ со scope mini-stand,run-all, без ПРИБОР_НЕДОСТУПЕН"
else
  bad "91) новая строка карты: rc=$rc $why[$out]"
fi

# --- 92. FIX8 Ж35 И5: в HEAD нет сопоставителя -- scope равен индексному ------------
t92=""
R=$(mk_world h_nohead)
git -C "$R" rm -q --cached tests/stand-scope.sh tests/stand-map.tsv
git -C "$R" commit -qm drop-matcher
printf 'tests/stand-map.tsv\trun-all\n' >> "$R/tests/stand-map.tsv"
git -C "$R" add tests/stand-scope.sh tests/stand-map.tsv
SSI=$(cd "$R" && bash tests/stand-scope.sh --staged 2>/dev/null)
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
[ "$SSI" = "plugin-gate,run-all" ] && (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"нужен scope $SSI;"* ]] \
  || t92="HEAD без сопоставителя: индексный [$SSI] rc=$rc $why[$out]; "
R=$(mk_world h_unborn)
rm -rf "$R/.git"
git -C "$R" init -q
git -C "$R" config user.email t@t
git -C "$R" config user.name t
printf 'tests/stand-map.tsv\trun-all\n' >> "$R/tests/stand-map.tsv"
git -C "$R" add tests/stand-scope.sh tests/stand-map.tsv tests/scripts/test-mini-stand.sh tests/scripts/test-run-all.sh tests/scripts/test-plugin-gate.sh
SSI=$(cd "$R" && bash tests/stand-scope.sh --staged 2>/dev/null)
out=$(run_door "$R"); rc=$?
why=$(check_only "СВИДЕТЕЛЯ_НЕТ" "$out")
[ "$SSI" = "mini-stand,plugin-gate,run-all" ] && (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"нужен scope $SSI;"* ]] \
  || t92="${t92}нерождённый HEAD: индексный [$SSI] rc=$rc $why[$out]"
if [ -z "$t92" ]; then
  ok "92) HEAD без tests/stand-scope.sh (коммит до добавления и нерождённый HEAD) -- дверь требует ровно индексный scope"
else
  bad "92) HEAD без сопоставителя: $t92"
fi

# --- 93. FIX8 Ж38: карта снята из индекса -- КАРТА_НЕИСПРАВНА, не КАРТА_НЕ_ПОКРЫВАЕТ --
R=$(mk_world map_gone)
git -C "$R" rm -q --cached tests/stand-map.tsv
printf 'doc more\n' > "$R/docs/d.md"
git -C "$R" add docs/d.md
out=$(run_door "$R"); rc=$?
why=$(check_only "КАРТА_НЕИСПРАВНА" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"КАРТА_НЕИСПРАВНА: карта tests/stand-map.tsv негодна"* ]] \
   && [[ "$out" == *"tests/stand-map.tsv нет в индексе"* ]]; then
  ok "93) git rm --cached tests/stand-map.tsv + правка docs/ -- КАРТА_НЕИСПРАВНА с причиной stand-scope"
else
  bad "93) карта снята из индекса: rc=$rc $why[$out]"
fi

# --- 94. FIX8 Ж38: git rev-parse --show-toplevel rc=128 -- ПРИБОР_НЕДОСТУПЕН с командой
R=$(mk_world toplevel_rc)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
add_witness "$R" run-all 0 >/dev/null
GBIN="$ROOT/gbin94"; mkdir -p "$GBIN"; J94="$ROOT/stub94.log"
cat > "$GBIN/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ] && [ "\${2:-}" = "--show-toplevel" ]; then
  printf 'FAIL %s\n' "\$*" >> "$J94"
  printf 'stub-git: rev-parse --show-toplevel rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$GBIN/git"
out=$(run_door "$R" PATH="$GBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git rev-parse --show-toplevel"* ]] \
   && grep -qxF 'FAIL rev-parse --show-toplevel' "$J94"; then
  ok "94) git rev-parse --show-toplevel rc=128 -- ПРИБОР_НЕДОСТУПЕН: git rev-parse --show-toplevel (журнал заглушки)"
else
  bad "94) отказ --show-toplevel: rc=$rc $why журнал=[$(cat "$J94" 2>/dev/null)] [$out]"
fi

# --- 95. FIX8 Ж39: корневой манифест снят, в индексе осталось зеркало -- МАНИФЕСТА_НЕТ
# CONSTRAINT: skills/s.md снят тем же коммитом: из файлов корневого плагина в
# индексе остаются только зеркала манифеста -- проба удаления обязана их видеть.
R=$(mk_world root_gone_mirror)
git -C "$R" rm -q .claude-plugin/plugin.json skills/s.md
lsm95=$(git -C "$R" ls-files -- .codex-plugin/plugin.json)
out=$(run_door "$R"); rc=$?
why=$(check_only "МАНИФЕСТА_НЕТ" "$out")
if [ -n "$lsm95" ] && (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"МАНИФЕСТА_НЕТ: .claude-plugin/plugin.json"* ]]; then
  ok "95) git rm .claude-plugin/plugin.json skills/s.md, .codex-plugin/plugin.json в индексе -- МАНИФЕСТА_НЕТ"
else
  bad "95) зеркало при снятом корневом манифесте: зеркало в индексе=[$lsm95] rc=$rc $why[$out]"
fi

# --- 96. FIX8 Ж40 F7: сигнал в первом окне (mktemp staged-списка) -- остатков нет ----
# CONSTRAINT: заглушка mktemp создаёт файл plugin-gate-staged.* и спит, не вернув
# путь: сигнал приходит, когда ресурс уже есть, -- ловушки первого окна обязаны
# стоять раньше ресурса.
R=$(mk_world sig_stg)
printf 'doc more\n' > "$R/docs/d.md"
git -C "$R" add docs/d.md
REALMKTEMP96="$(command -v mktemp)"
MBIN="$ROOT/tbin96"; mkdir -p "$MBIN"
cat > "$MBIN/mktemp" <<EOF2
#!/usr/bin/env bash
case "\$*" in
  *plugin-gate-staged*)
    f=\$("$REALMKTEMP96" "\$@") || exit 1
    : > "$ROOT/mktemp96.started"
    sleep 2
    printf '%s\n' "\$f"
    exit 0 ;;
esac
exec "$REALMKTEMP96" "\$@"
EOF2
chmod +x "$MBIN/mktemp"
T96="$ROOT/tmp96"; mkdir -p "$T96"
( cd "$R" && exec env CLAUDE_CONFIG_DIR="$R/home" PATH="$MBIN:$PATH" TMPDIR="$T96" python3 -c "$SIGDFL" bash "$DOOR" ) > "$ROOT/out96" 2>&1 &
pid96=$!
for i in $(seq 1 300); do
  [ -e "$ROOT/mktemp96.started" ] && break
  sleep 0.1
done
kill -TERM "$pid96"
wait "$pid96"; rc=$?
left96=$(ls -A "$T96" | grep '^plugin-gate-staged\.' | tr '\n' ' ')
if [ -e "$ROOT/mktemp96.started" ] && [ "$rc" = 143 ] && [ -z "$left96" ]; then
  ok "96) TERM, пока mktemp staged-списка создал файл и не вернулся -- rc=143, в TMPDIR нет plugin-gate-staged.*"
else
  bad "96) сигнал в первом окне: rc=$rc (ждали 143) started=$([ -e "$ROOT/mktemp96.started" ] && echo 1 || echo 0) остатки=[$left96] [$(cat "$ROOT/out96")]"
fi

# CONSTRAINT: вариант двери -- копия со вставкой после строки-якоря (ровно одно
# вхождение, иначе вариант не строится и зуб красный): зуб меряет учёт стадий
# на брошенной или досрочно вернувшейся стадии, не трогая саму дверь.
door_variant() {   # <назначение> <строка-якорь целиком> <вставка>
  python3 - "$DOOR" "$1" "$2" "$3" <<'EOF2'
import io, sys
src, dst, anchor, ins = sys.argv[1:]
lines = io.open(src, encoding='utf-8').read().split('\n')
idx = [i for i, l in enumerate(lines) if l == anchor]
if len(idx) != 1:
    sys.exit('якорь найден %d раз: %s' % (len(idx), anchor))
i = idx[0]
ind = lines[i][:len(lines[i]) - len(lines[i].lstrip())]
lines.insert(i + 1, ind + ins)
io.open(dst, 'w', encoding='utf-8').write('\n'.join(lines))
EOF2
}
run_door_file() {   # <репо> <файл двери> [VAR=val ...]
  local r="$1" f="$2"; shift 2
  (cd "$r" && env CLAUDE_CONFIG_DIR="$r/home" "$@" bash "$f" 2>&1)
}

# --- 97. FIX9 Ж42: ошибка раскрытия внутри стадии HEAD-прохода -- СТАДИЯ_НЕ_ЗАВЕРШЕНА --
# CONSTRAINT: `${#X[@]}` неопределённого массива бросает составную команду, и скрипт
# идёт дальше (замер bash 3.2.57 и 5.2.26); на входе И1 брошенный HEAD-проход без
# учёта стадий давал rc 0 без свидетеля.
R=$(mk_head_world j42_undef)
printf '#!/usr/bin/env bash\nprintf "\\n"\nexit 0\n' > "$R/tests/stand-scope.sh"
git -C "$R" add tests/stand-scope.sh
V97="$ROOT/door97"
vrc=0
door_variant "$V97" '  hsx=$(git show HEAD:tests/stand-scope.sh) || fail "ПРИБОР_НЕДОСТУПЕН: git show HEAD:tests/stand-scope.sh"' ': "${#J42_UNDEF[@]}"' 2>"$ROOT/door97.err" || vrc=$?
out=$(run_door_file "$R" "$V97"); rc=$?
why=$(check_only "СТАДИЯ_НЕ_ЗАВЕРШЕНА" "$out")
if [ "$vrc" = 0 ] && (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"J42_UNDEF: unbound variable"* ]] \
   && [[ "$out" == *"ОТКАЗ СТАДИЯ_НЕ_ЗАВЕРШЕНА: scope_head "* ]] && [[ "$out" != *"прошло"* ]]; then
  ok "97) \${#J42_UNDEF[@]} в стадии scope_head на входе И1 -- rc=1 СТАДИЯ_НЕ_ЗАВЕРШЕНА: scope_head, не «прошло»"
else
  bad "97) брошенная стадия: вариант rc=$vrc [$(cat "$ROOT/door97.err")] rc=$rc $why[$out]"
fi

# --- 98. FIX9 Ж42: стадия свидетеля вернулась раньше конца -- СТАДИЯ_НЕ_ЗАВЕРШЕНА -----
R=$(mk_world j42_return)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
V98="$ROOT/door98"
vrc=0
door_variant "$V98" 'stage_witness() {' 'return 0' 2>"$ROOT/door98.err" || vrc=$?
out=$(run_door_file "$R" "$V98"); rc=$?
why=$(check_only "СТАДИЯ_НЕ_ЗАВЕРШЕНА" "$out")
if [ "$vrc" = 0 ] && (( rc == 1 )) && [[ -z "$why" ]] \
   && [[ "$out" == *"ОТКАЗ СТАДИЯ_НЕ_ЗАВЕРШЕНА: witness "* ]] && [[ "$out" != *"прошло"* ]]; then
  ok "98) return 0 в начале stage_witness, свидетеля нет -- rc=1 СТАДИЯ_НЕ_ЗАВЕРШЕНА: witness, не СВИДЕТЕЛЯ_НЕТ и не «прошло»"
else
  bad "98) досрочный return: вариант rc=$vrc [$(cat "$ROOT/door98.err")] rc=$rc $why[$out]"
fi

# --- 99. FIX9 Ж42: штатные пути -- без ложного СТАДИЯ_НЕ_ЗАВЕРШЕНА ------------------
# CONSTRAINT: три входа с разными наборами :skip -- пустой staged-список, ручка off,
# свидетель есть; каждый обязан пройти с rc 0 и своей строкой.
r99=""
R=$(mk_world j42_empty)
out=$(run_door "$R"); rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] || r99="$r99 пустой: rc=$rc [$out];"
R=$(mk_world j42_off)
printf 'doc more\n' > "$R/docs/d.md"
git -C "$R" add docs/d.md
out=$(run_door "$R" CATALYST_PLUGIN_GATE=off); rc=$?
[ "$rc" = 0 ] && [ "$out" = "CATALYST_PLUGIN_GATE=off: дверь приёмки плагина ПРОПУЩЕНА по явной ручке" ] \
  || r99="$r99 off: rc=$rc [$out];"
R=$(mk_world j42_wit)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
T99=$(add_witness "$R" run-all 0)
out=$(run_door "$R"); rc=$?
why=$(check_only "" "$out")
[ "$rc" = 0 ] && [ -z "$why" ] && [[ "$out" == *"стадия 5: свидетель $T99 scope=run-all"* ]] \
  && [[ "$out" == *"дверь приёмки плагина: плагины не затронуты -- прошло (свидетель стендов run-all); оси плагина не запускались"* ]] \
  || r99="$r99 свидетель: rc=$rc $why[$out];"
if [ -z "$r99" ]; then
  ok "99) пустой staged-список, CATALYST_PLUGIN_GATE=off, свидетель есть -- rc=0 без СТАДИЯ_НЕ_ЗАВЕРШЕНА"
else
  bad "99) штатные пути:$r99"
fi

# --- 100..102. FIX9 Ж44: отказ git HEAD-прохода -- ПРИБОР_НЕДОСТУПЕН с командой ---------
# CONSTRAINT: заглушка отказывает ровно одной команде (условие -- её argv), прочие
# вызовы идут в настоящий git; без заглушки вход проходит (свидетель есть).
door_gitfail() {   # <номер> <условие bash над "$@" заглушки> <ожидаемая строка>
  local n="$1" cond="$2" want="$3" r g j o rc w
  r=$(mk_world "gitfail$n")
  printf '# tweak\n' >> "$r/tests/run-all.sh"
  git -C "$r" add tests/run-all.sh
  add_witness "$r" run-all 0 >/dev/null
  g="$ROOT/gbin$n"; mkdir -p "$g"; j="$ROOT/stub$n.log"
  cat > "$g/git" <<EOF2
#!/usr/bin/env bash
if $cond; then
  printf 'FAIL %s\n' "\$*" >> "$j"
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
  chmod +x "$g/git"
  o=$(run_door "$r" PATH="$g:$PATH"); rc=$?
  w=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$o")
  if (( rc == 1 )) && [[ -z "$w" ]] && [[ "$o" == *"$want"* ]] && [ -s "$j" ]; then
    ok "$n) заглушка git rc=128 -- «$want», журнал заглушки: $(head -1 "$j")"
  else
    bad "$n) отказ git HEAD-прохода: rc=$rc $w журнал=[$(cat "$j" 2>/dev/null)] [$o]"
  fi
}
door_gitfail 100 '[ "$1" = rev-parse ] && [ "${2:-}" = -q ] && [ "${3:-}" = --verify ] && [ "${4:-}" = HEAD:tests/stand-scope.sh ]' \
  'ПРИБОР_НЕДОСТУПЕН: git rev-parse -q --verify HEAD:tests/stand-scope.sh rc=128'
door_gitfail 101 '[ "$1" = rev-parse ] && [ "${2:-}" = -q ] && [ "${3:-}" = --verify ] && [ "${4:-}" = HEAD:tests/stand-map.tsv ]' \
  'ПРИБОР_НЕДОСТУПЕН: git rev-parse -q --verify HEAD:tests/stand-map.tsv rc=128'
door_gitfail 102 '[ "$1" = show ] && [ "${2:-}" = HEAD:tests/stand-scope.sh ]' \
  'ПРИБОР_НЕДОСТУПЕН: git show HEAD:tests/stand-scope.sh'

# --- 103. FIX9 Ж44: отказ sort при объединении scope -- ПРИБОР_НЕДОСТУПЕН ---------------
R=$(mk_world sortfail)
printf '# tweak\n' >> "$R/tests/run-all.sh"
git -C "$R" add tests/run-all.sh
add_witness "$R" run-all 0 >/dev/null
SBIN="$ROOT/sbin103"; mkdir -p "$SBIN"; J103="$ROOT/stub103.log"
REALSORT103="$(command -v sort)"
# CONSTRAINT: заглушка отказывает только sort САМОЙ двери: вызовы из stand-scope
# (родитель -- tests/stand-scope.sh) идут в настоящий sort, иначе отказ
# сопоставителя (rc 3) назывался бы раньше объединения scope.
cat > "$SBIN/sort" <<EOF2
#!/usr/bin/env bash
if [[ "\$(ps -o args= -p "\$PPID")" == *stand-scope.sh* ]]; then
  exec "$REALSORT103" "\$@"
fi
printf 'FAIL sort %s\n' "\$*" >> "$J103"
exit 2
EOF2
chmod +x "$SBIN/sort"
out=$(run_door "$R" PATH="$SBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: sort объединения scope"* ]] && [ -s "$J103" ]; then
  ok "103) заглушка sort rc=2 -- ПРИБОР_НЕДОСТУПЕН: sort объединения scope"
else
  bad "103) отказ sort: rc=$rc $why журнал=[$(cat "$J103" 2>/dev/null)] [$out]"
fi

# --- 104..105. FIX10: отказ tr в списке файлов плагина при снятом манифесте -- ПРИБОР_НЕДОСТУПЕН
# CONSTRAINT: коммит -- тот же, что у близнецов с целым tr (104 -- зуб 78, 105 -- зуб 79).
# Заглушка tr дочитывает stdin до конца и только потом выходит с rc 1, ничего не
# выведя: git дописывает список и выходит с rc 0, а не 141 от SIGPIPE, -- зуб
# краснеет только на коде tr, не на коде git.
stub_tr_fail() {   # <каталог> <журнал>
  mkdir -p "$1"
  cat > "$1/tr" <<EOF2
#!/usr/bin/env bash
printf 'CALL tr %s\n' "\$*" >> "$2"
cat > /dev/null
exit 1
EOF2
  chmod +x "$1/tr"
}

R=$(mk_world trfail_plugin)
register_two "$R/plugins/mini/hooks/register.ts"
git -C "$R" rm -q plugins/mini/.claude-plugin/plugin.json
git -C "$R" add plugins/mini
TBIN="$ROOT/tbin104"; J104="$ROOT/stub104.log"
stub_tr_fail "$TBIN" "$J104"
out=$(run_door "$R" PATH="$TBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git ls-files plugins/mini"* ]] && [ -s "$J104" ]; then
  ok "104) манифест plugins/mini снят, код в индексе, tr rc=1 без вывода -- ПРИБОР_НЕДОСТУПЕН: git ls-files plugins/mini, журнал: $(head -1 "$J104")"
else
  bad "104) отказ tr в списке файлов плагина: rc=$rc $why журнал=[$(cat "$J104" 2>/dev/null)] [$out]"
fi

R=$(mk_world trfail_root)
printf 'skill more\n' > "$R/skills/s.md"
git -C "$R" rm -q .claude-plugin/plugin.json
git -C "$R" add skills
TBIN="$ROOT/tbin105"; J105="$ROOT/stub105.log"
stub_tr_fail "$TBIN" "$J105"
out=$(run_door "$R" PATH="$TBIN:$PATH"); rc=$?
why=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"ПРИБОР_НЕДОСТУПЕН: git ls-files ."* ]] && [ -s "$J105" ]; then
  ok "105) корневой манифест снят, skills/ в индексе, tr rc=1 без вывода -- ПРИБОР_НЕДОСТУПЕН: git ls-files ., журнал: $(head -1 "$J105")"
else
  bad "105) отказ tr в списке файлов корня: rc=$rc $why журнал=[$(cat "$J105" 2>/dev/null)] [$out]"
fi

# --- 106..108. FIX11 Ф1: MERGE_HEAD есть, но не читается или пуст -- ПРИБОР_НЕДОСТУПЕН ------
# CONSTRAINT: мир -- слияние зуба 26 (правка разрешения сверх обеих сторон, версия
# равна версии второго предка) плюс свидетель: без сверки со вторым предком дверь
# проходит до конца с rc 0, со сверкой -- ВЕРСИЯ_НЕ_ПОДНЯТА. MERGE_HEAD портится
# после построения слияния; положительный контроль -- MERGE_HEAD был обычным файлом.
merge_world() {   # <имя мира> -> путь мира; пустой вывод -- фикстура не построена
  local r
  r=$(mk_world "$1")
  git -C "$r" checkout -q -b "side_$1"
  register_two "$r/plugins/mini/hooks/register.ts"
  mini_manifest "$r/plugins/mini/.claude-plugin/plugin.json" 0.1.5
  git -C "$r" add plugins/mini
  git -C "$r" commit -qm "side_$1"
  git -C "$r" checkout -q -
  printf 'doc A\n' > "$r/docs/d.md"
  git -C "$r" add docs/d.md
  git -C "$r" commit -qm "main_$1"
  git -C "$r" merge --no-commit --no-ff -q "side_$1" >/dev/null || return 0
  [ -f "$r/.git/MERGE_HEAD" ] && [ -s "$r/.git/MERGE_HEAD" ] || return 0
  printf '// resolved\n' >> "$r/plugins/mini/hooks/register.ts"
  git -C "$r" add plugins/mini
  add_witness "$r" mini-stand 0 >/dev/null
  printf '%s' "$r"
}
merge_head_tooth() {   # <номер> <мир> <ожидаемая строка> <что меряет>
  local n="$1" r="$2" want="$3" what="$4" o rc w
  if [ -z "$r" ]; then
    bad "$n) фикстура: слияние или MERGE_HEAD не построены, ряд ничего не измерил"
    return
  fi
  o=$(run_door "$r"); rc=$?
  w=$(check_only "ПРИБОР_НЕДОСТУПЕН" "$o")
  if (( rc == 1 )) && [[ -z "$w" ]] && [[ "$o" == *"$want"* ]]; then
    ok "$n) $what -- «$want»"
  else
    bad "$n) $what: rc=$rc $w[$o]"
  fi
}

R=$(merge_world mh_unreadable)
mh106="chmod 000"
if [ -n "$R" ]; then
  chmod 000 "$R/.git/MERGE_HEAD"
  # CONSTRAINT: под root chmod 000 не снимает чтение -- тогда MERGE_HEAD становится
  # каталогом, и отказ тот же на обеих ветках.
  if [ -r "$R/.git/MERGE_HEAD" ]; then
    rm -f "$R/.git/MERGE_HEAD"; mkdir "$R/.git/MERGE_HEAD"; mh106="каталог (root)"
  fi
fi
merge_head_tooth 106 "$R" "ПРИБОР_НЕДОСТУПЕН: MERGE_HEAD не читается" "MERGE_HEAD есть, $mh106, версия равна версии второго предка"

R=$(merge_world mh_dir)
if [ -n "$R" ]; then
  rm -f "$R/.git/MERGE_HEAD"; mkdir "$R/.git/MERGE_HEAD"
fi
merge_head_tooth 107 "$R" "ПРИБОР_НЕДОСТУПЕН: MERGE_HEAD не читается" "MERGE_HEAD -- каталог, версия равна версии второго предка"

R=$(merge_world mh_empty)
if [ -n "$R" ]; then
  : > "$R/.git/MERGE_HEAD"
fi
merge_head_tooth 108 "$R" "ПРИБОР_НЕДОСТУПЕН: MERGE_HEAD пуст" "MERGE_HEAD пуст, версия равна версии второго предка"

# --- 109..111. FIX12: слово MERGE_HEAD обязано иметь форму sha -- ПРИБОР_НЕДОСТУПЕН ------
R=$(merge_world mh_word_head)
if [ -n "$R" ]; then
  printf 'HEAD\n' > "$R/.git/MERGE_HEAD"
fi
merge_head_tooth 109 "$R" "ПРИБОР_НЕДОСТУПЕН: MERGE_HEAD: слово не sha: HEAD" "MERGE_HEAD = HEAD, версия равна версии второго предка"

R=$(merge_world mh_blank)
if [ -n "$R" ]; then
  printf ' \t\n' > "$R/.git/MERGE_HEAD"
fi
merge_head_tooth 110 "$R" "ПРИБОР_НЕДОСТУПЕН: MERGE_HEAD не содержит предка" "MERGE_HEAD из пробела и табуляции, версия равна версии второго предка"

# CONSTRAINT: корень мира не сводится к одному элементу: tests/ обязан лежать на
# диске (дверь зовёт индексную копию stand-scope с $0 = <корень>/tests/stand-scope.sh,
# stand-scope делает cd в dirname $0). Поэтому каждому не-скрытому имени корня
# заведена ветка на HEAD, а рядом лежит файл с именем полного sha HEAD: без set -f
# и без проверки формы глоб дал бы только предков, равных HEAD, и дверь прошла бы.
R=$(merge_world mh_glob)
fx111=""
if [ -n "$R" ]; then
  h111=$(git -C "$R" rev-parse HEAD)
  : > "$R/$h111"
  for e in "$R"/*; do
    b="${e##*/}"
    [ "$b" = "$h111" ] || git -C "$R" branch -q "$b" HEAD || fx111="ветка $b не создана"
  done
  for e in "$R"/*; do
    b="${e##*/}"
    [ "$(git -C "$R" rev-parse -q --verify "$b^{commit}")" = "$h111" ] || fx111="${fx111:+$fx111; }$b не разрешается в HEAD"
  done
  [ -f "$R/$h111" ] || fx111="${fx111:+$fx111; }файла $h111 нет"
  printf '*\n' > "$R/.git/MERGE_HEAD"
fi
if [ -n "$R" ] && [ -n "$fx111" ]; then
  bad "111) фикстура: имена корня не сведены к HEAD: $fx111"
else
  merge_head_tooth 111 "$R" "ПРИБОР_НЕДОСТУПЕН: MERGE_HEAD: слово не sha: *" "MERGE_HEAD = *, каждое имя корня разрешается в HEAD, версия равна версии второго предка"
fi

printf '\nplugin-gate teeth: прошло=%d провалов=%d ожидалось=%d\n' "$PASS" "$FAIL" "$EXPECTED_TEETH"
if (( PASS + FAIL != EXPECTED_TEETH )); then
  printf 'ПРОВАЛ: прогнано зубов %d при объявленных %d -- прогон не тот, который пинили\n' \
    "$((PASS + FAIL))" "$EXPECTED_TEETH" >&2
  exit 1
fi
[[ $FAIL -eq 0 ]]
