#!/usr/bin/env bash
# Зубы инструмента «пуш и активация -- ОДИН шаг» (scripts/ship-plugin.sh).
#
# Измерено 2026-09-15 (#188): реестр установки стоял на версии позади кэша и
# зеркала маркетплейса -- коммит и пуш не влекут активации, и ни одна дверь
# этого не назвала. Зубы мерят ровно этот шаг: сверку-доказательство.
#
# CONSTRAINT: синтетика целиком -- свой git-дом во временном каталоге, свой
# PLUGINS_REGISTRY и своя заглушка claude через CLAUDE_BIN. Живой дом
# пользователя (~/.claude) не читается и не пишется ни в одном случае, и
# настоящая команда claude не зовётся ни разу.
#
# CONSTRAINT: случаи 10--12 держат форму .githooks/post-commit -- слепые
# зоны прежней формулы diff-tree (первичный коммит и слияние) измерены на
# живом репозитории; без пина прежняя форма вернётся.
#
# CONSTRAINT: каждый красный случай краснеет СВОЕЙ названной причиной и НЕ
# тянет чужих -- иначе зуб зеленеет на чужой поломке. Каждый зелёный держится
# положительным контролем: след заглушки обязан показать, что инструмент её
# действительно позвал, иначе «зелёный» мог бы означать «не звали никого».
#
# CONSTRAINT: два шага активации (обновление маркетплейса и обновление
# плагина) не имеют права быть неразличимыми -- у каждого своя причина.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SHIP="$(cd "$HERE/../.." && pwd)/scripts/ship-plugin.sh"
if [ ! -f "$SHIP" ]; then
  printf 'plugin-ship teeth: ПРИБОР НЕДОСТУПЕН: нет scripts/ship-plugin.sh\n' >&2
  exit 2
fi
HOOK="$(cd "$HERE/../.." && pwd)/.githooks/post-commit"
if [ ! -f "$HOOK" ]; then
  printf 'plugin-ship teeth: ПРИБОР НЕДОСТУПЕН: нет .githooks/post-commit\n' >&2
  exit 2
fi
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/plugin-ship-teeth.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

# CONSTRAINT: «ПРИБОР НЕДОСТУПЕН» с пробелом -- форма брифа #188, не
# подчёркивание соседних дверей. Поэтому причины -- МАССИВ: разбивка строки
# по словам резала бы двухсловную причину на два ложных куска.
REASONS=("ДЕРЕВО_ГРЯЗНОЕ" "НЕ_ЗАПУШЕНО" "АКТИВАЦИЯ_НЕ_ПЕРЕСТАВИЛА" "ОБНОВЛЕНИЕ_МАРКЕТПЛЕЙСА_ОТКАЗАЛО" "ОБНОВЛЕНИЕ_ПЛАГИНА_ОТКАЗАЛО" "ПРИБОР НЕДОСТУПЕН")

check_only() {   # <ожидаемая причина> <вывод инструмента>
  local exp="$1" out="$2" r
  for r in "${REASONS[@]}"; do
    if [[ "$r" == "$exp" ]]; then
      [[ "$out" == *"$r"* ]] || { printf 'причина %s не названа; ' "$r"; return 1; }
    else
      [[ "$out" != *"$r"* ]] || { printf 'тянется чужая причина %s; ' "$r"; return 1; }
    fi
  done
  return 0
}

# Дерево мира: манифест 0.1.10, заглушка claude, пустой пуш в bare-origin.
# Реестр НЕ пишется -- его пишет write_registry для случаев, где он есть:
# случай «реестра нет» пользуется миром как есть.
mk_world() {   # <имя мира> -> путь мира
  local w="$ROOT/$1"
  mkdir -p "$w/plugins/catalyst-probes/.claude-plugin" "$w/bin" "$w/home/plugins"
  cat > "$w/plugins/catalyst-probes/.claude-plugin/plugin.json" <<JSON
{
  "name": "catalyst-probes",
  "version": "0.1.10",
  "description": "synthetic plugin for the ship teeth",
  "author": {"name": "t"}
}
JSON
  # CONSTRAINT: заглушка только пишет след и возвращает заданный код/текст --
  # «действий» у неё нет, живой claude не зовётся.
  cat > "$w/bin/claude" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CLAUDE_STUB_LOG"
case "$2" in
  marketplace) printf '%s\n' "${STUB_MARKET_OUT:-}"; exit "${STUB_MARKET_RC:-0}" ;;
  update)      printf '%s\n' "${STUB_UPDATE_OUT:-}"; exit "${STUB_UPDATE_RC:-0}" ;;
esac
exit 0
STUB
  chmod +x "$w/bin/claude"
  git -C "$w" init -q
  git -C "$w" config user.email t@t
  git -C "$w" config user.name t
  git -C "$w" add plugins bin home
  git -C "$w" commit -qm base
  git -C "$w" branch -M main
  # CONSTRAINT: bare-origin и пуш ДО следа -- «HEAD запушен» обязан быть
  # нормой мира, а НЕ_ЗАПУШЕНО -- отдельной поломкой случая 6.
  git init -q --bare "$w.origin.git"
  git -C "$w" remote add origin "$w.origin.git"
  git -C "$w" push -q origin main
  printf '%s' "$w"
}

write_registry() {   # <мир> <версия> [рынок записи]
  local w="$1" v="$2" mkt="${3:-catalyst}"
  cat > "$w/home/plugins/installed_plugins.json" <<JSON
{"version":2,"plugins":{"catalyst-probes@$mkt":[{"scope":"user",
 "installPath":"/синтетика-без-кэша","version":"$v","gitCommitSha":"0123456789abcdef"}]}}
JSON
}

# Код возврата берётся у САМОЙ подстановки, а не через переменную внутри неё:
# run_ship исполняется в подоболочке, присваивания внутри неё наружу не
# выходят. stderr гасить нельзя -- туда пишутся отказы инструмента.
run_ship() {   # <мир> [VAR=val ...] -> вывод инструмента, код = код инструмента
  local w="$1"; shift
  # CONSTRAINT: след заглушки живёт ВНЕ репозитория мира -- tracked-файл,
  # растущий от вызова к вызову, краснел бы ДЕРЕВО_ГРЯЗНОЕ в каждом случае.
  : > "$w.stub.log"
  (cd "$w" && env \
    CLAUDE_BIN="$w/bin/claude" \
    PLUGINS_REGISTRY="$w/home/plugins/installed_plugins.json" \
    CLAUDE_STUB_LOG="$w.stub.log" \
    "$@" bash "$SHIP") 2>&1
}

# --- 1. версии совпали -> rc=0 и ОДНА строка ---------------------------------
W=$(mk_world c1)
write_registry "$W" 0.1.10
out=$(run_ship "$W"); rc=$?
if (( rc == 0 )) && [[ "$out" == "в бою catalyst-probes v0.1.10 (дерево v0.1.10)" ]]; then
  ok "1) реестр сошёлся с деревом -- rc=0, одна строка «в бою … (дерево …)»"
else
  bad "1) сходимость: ждали rc=0 и ровно одну строку, получили rc=$rc [$out]"
fi

# --- 2. реестр отстал -> АКТИВАЦИЯ_НЕ_ПЕРЕСТАВИЛА с ОБОИМИ числами ------------
W=$(mk_world c2)
write_registry "$W" 0.1.7
out=$(run_ship "$W"); rc=$?
why=$(check_only "АКТИВАЦИЯ_НЕ_ПЕРЕСТАВИЛА" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"реестр v0.1.7"* && "$out" == *"дерево v0.1.10"* ]]; then
  ok "2) реестр отстал -- АКТИВАЦИЯ_НЕ_ПЕРЕСТАВИЛА, названы обе версии"
else
  bad "2) отставание реестра: rc=$rc $why[$out]"
fi

# --- 3. реестра нет -> ПРИБОР НЕДОСТУПЕН ---------------------------------------
W=$(mk_world c3)
out=$(run_ship "$W"); rc=$?
why=$(check_only "ПРИБОР НЕДОСТУПЕН" "$out")
if (( rc == 2 )) && [[ -z "$why" ]] && [[ "$out" != *"в бою"* ]]; then
  ok "3) реестра нет -- rc=2 ПРИБОР НЕДОСТУПЕН, а не «совпало»"
else
  bad "3) пропавший реестр: rc=$rc $why[$out]"
fi

# --- 4. запись есть, но у ДРУГОГО рынка -> нечего сверять ---------------------
# Тот самый живой случай: запись в реестре существует, версия в ней та же, что
# в дереве -- но под чужим рынком. Совпадение строк без рынка -- ложное зелёное.
W=$(mk_world c4)
write_registry "$W" 0.1.10 другой-рынок
out=$(run_ship "$W"); rc=$?
why=$(check_only "ПРИБОР НЕДОСТУПЕН" "$out")
if (( rc == 2 )) && [[ -z "$why" ]] && [[ "$out" != *"в бою"* ]]; then
  ok "4) запись под чужим рынком -- rc=2 (нечего сверять), не «совпало»"
else
  bad "4) чужой рынок: rc=$rc $why[$out]"
fi

# --- 5. дерево грязное по путям плагина -> ДЕРЕВО_ГРЯЗНОЕ с перечнем ----------
W=$(mk_world c5)
write_registry "$W" 0.1.10
printf 'несохранённое\n' > "$W/plugins/catalyst-probes/hooks-new.ts"
out=$(run_ship "$W"); rc=$?
why=$(check_only "ДЕРЕВО_ГРЯЗНОЕ" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"plugins/catalyst-probes/hooks-new.ts"* ]]; then
  ok "5) несохранённая правка плагина -- ДЕРЕВО_ГРЯЗНОЕ, файл назван"
else
  bad "5) грязное дерево: rc=$rc $why[$out]"
fi

# --- 6. HEAD не запушен -> НЕ_ЗАПУШЕНО ----------------------------------------
W=$(mk_world c6)
write_registry "$W" 0.1.10
printf 'докум\n' > "$W/README-мира.md"
git -C "$W" add README-мира.md
git -C "$W" commit -qm docs
out=$(run_ship "$W"); rc=$?
why=$(check_only "НЕ_ЗАПУШЕНО" "$out")
if (( rc == 1 )) && [[ -z "$why" ]]; then
  ok "6) локальный коммит без пуша -- НЕ_ЗАПУШЕНО (активация взяла бы прошлое)"
else
  bad "6) непушеный HEAD: rc=$rc $why[$out]"
fi

# --- 7. marketplace update отказал -> своя причина и дословный вывод заглушки --
W=$(mk_world c7)
write_registry "$W" 0.1.10
out=$(run_ship "$W" STUB_MARKET_RC=7 'STUB_MARKET_OUT=СТУБ-ОТКАЗ: рынок не обновился (синтетика)'); rc=$?
why=$(check_only "ОБНОВЛЕНИЕ_МАРКЕТПЛЕЙСА_ОТКАЗАЛО" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"СТУБ-ОТКАЗ: рынок не обновился (синтетика)"* ]]; then
  ok "7) отказ обновления маркетплейса -- своя причина, вывод заглушки дословно"
else
  bad "7) рынок отказал: rc=$rc $why[$out]"
fi

# --- 8. plugin update отказал -> СВОЯ причина, отличимая от шага 7 ------------
W=$(mk_world c8)
write_registry "$W" 0.1.10
out=$(run_ship "$W" STUB_UPDATE_RC=8 'STUB_UPDATE_OUT=СТУБ-ОТКАЗ: плагин не обновился (синтетика)'); rc=$?
why=$(check_only "ОБНОВЛЕНИЕ_ПЛАГИНА_ОТКАЗАЛО" "$out")
if (( rc == 1 )) && [[ -z "$why" ]] && [[ "$out" == *"СТУБ-ОТКАЗ: плагин не обновился (синтетика)"* ]]; then
  ok "8) отказ обновления плагина -- своя причина, отличима от шага рынка"
else
  bad "8) плагин отказал: rc=$rc $why[$out]"
fi

# --- 9. ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: заглушка ПОЗВАНА ------------------------------
# Случай 1 зелёный -- но зелёным он обязан быть потому, что инструмент ходил
# к claude и сверил ОТВЕТ, а не потому, что никого не звал. След заглушки --
# единственное доказательство; пустой rc=0 ничего не доказывает.
W=$(mk_world c9)
write_registry "$W" 0.1.10
out=$(run_ship "$W"); rc=$?
trace=$(cat "$W.stub.log")
if (( rc == 0 )) && [[ "$trace" == *"plugin marketplace update catalyst"* ]] \
  && [[ "$trace" == *"plugin update catalyst-probes@catalyst"* ]]; then
  ok "9) контроль: на зелёном заглушка ПОЗВАНА -- оба вызова в следе"
else
  bad "9) контроль: зелёный без вызова прибора ничего не доказывает (rc=$rc след=[$trace])"
fi

# --- post-commit: напоминание в момент, когда расхождение рождается ----------
# CONSTRAINT: хук зовётся ПРЯМЫМ вызовом по пути из синтетического репозитория
# -- core.hooksPath мерил бы настройку клона, а не сам хук.
# CONSTRAINT: случаи 10--11 -- СЛЕПЫЕ ЗОНЫ прежней формы diff-tree (без
# --root -m --first-parent): первичный коммит и слияние давали 0 строк, и
# напоминание молчало ровно на них.
hook_manifest() {   # <файл> <версия>
  cat > "$1" <<JSON
{
  "name": "catalyst-probes",
  "version": "$2",
  "description": "synthetic plugin for the post-commit teeth",
  "author": {"name": "t"}
}
JSON
}

mk_hook_repo() {   # <имя> -> путь; root-коммит СОЗДАЁТ манифест 0.1.10
  local h="$ROOT/$1"
  mkdir -p "$h/plugins/catalyst-probes/.claude-plugin"
  hook_manifest "$h/plugins/catalyst-probes/.claude-plugin/plugin.json" 0.1.10
  git -C "$h" init -q
  git -C "$h" config user.email t@t
  git -C "$h" config user.name t
  git -C "$h" add plugins
  git -C "$h" commit -qm base
  git -C "$h" branch -M main
  printf '%s' "$h"
}

run_hook() {   # <репо> -> вывод хука, код = код хука
  local h="$1"
  (cd "$h" && bash "$HOOK") 2>&1
}

# --- 10. ПЕРВИЧНЫЙ коммит создаёт манифест -> ОБЕ строки ----------------------
H=$(mk_hook_repo c10)
out=$(run_hook "$H"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"версия catalyst-probes поднята до v0.1.10"* ]] \
  && [[ "$out" == *"scripts/ship-plugin.sh catalyst-probes"* ]]; then
  ok "10) root-коммит с манифестом -- ОБЕ строки напоминания, rc=0"
else
  bad "10) root-коммит: ждали обе строки и rc=0, получили rc=$rc [$out]"
fi

# --- 11. Коммит СЛИЯНИЯ вносит бамп -> ОБЕ строки ------------------------------
H=$(mk_hook_repo c11)
git -C "$H" checkout -q -b feature
hook_manifest "$H/plugins/catalyst-probes/.claude-plugin/plugin.json" 0.2.0
git -C "$H" add plugins
git -C "$H" commit -qm bump
git -C "$H" checkout -q main
git -C "$H" merge -q --no-ff -m merge feature
out=$(run_hook "$H"); rc=$?
if (( rc == 0 )) && [[ "$out" == *"версия catalyst-probes поднята до v0.2.0"* ]] \
  && [[ "$out" == *"scripts/ship-plugin.sh catalyst-probes"* ]]; then
  ok "11) слияние с бампом манифеста -- ОБЕ строки напоминания, rc=0"
else
  bad "11) merge-коммит: ждали обе строки и rc=0, получили rc=$rc [$out]"
fi

# --- 12. Обычный коммит БЕЗ манифеста -> хук молчит ----------------------------
H=$(mk_hook_repo c12)
printf 'докум\n' > "$H/README-мира.md"
git -C "$H" add README-мира.md
git -C "$H" commit -qm docs
out=$(run_hook "$H"); rc=$?
if (( rc == 0 )) && [[ -z "$out" ]]; then
  ok "12) коммит без манифеста -- хук молчит (вывод пуст), rc=0"
else
  bad "12) без манифеста: ждали пустой вывод и rc=0, получили rc=$rc [$out]"
fi

printf '\nplugin-ship teeth: прошло=%d провалов=%d\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
