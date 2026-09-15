#!/usr/bin/env bash
# Зубы двери свежести плагина (hooks/plugin-freshness.py).
#
# Каждая из трёх осей обязана краснеть СВОЕЙ названной причиной, а сошедшееся
# состояние -- молчать. Молчание тут несёт смысл («шума в контексте нет»),
# поэтому оно проверяется положительным контролем: тот же прибор на том же
# прогоне обязан уметь заговорить.
#
# Все реестры и клоны -- СИНТЕТИЧЕСКИЕ, под своим CLAUDE_CONFIG_DIR. Живой дом
# пользователя не читается и не пишется ни в одном случае.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
DOOR="$(cd "$HERE/../.." && pwd)/hooks/plugin-freshness.py"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/freshness-teeth.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

# --- постройка синтетического мира ------------------------------------------
# `origin` -- «удалённый источник», `mirror` -- зеркало маркетплейса,
# `install` -- кэш установки. Три отдельных дома, ровно как в бою.
mk_world() {   # <имя мира> -> печатает путь к CLAUDE_CONFIG_DIR
  local w="$ROOT/$1"
  mkdir -p "$w/origin" "$w/home/plugins/marketplaces" "$w/home/plugins/cache/catalyst/catalyst/9.9.9"
  git -C "$w/origin" init -q
  git -C "$w/origin" config user.email t@t; git -C "$w/origin" config user.name t
  echo one > "$w/origin/f"; git -C "$w/origin" add f; git -C "$w/origin" commit -qm one
  git -C "$w/origin" branch -M main
  git clone -q "$w/origin" "$w/home/plugins/marketplaces/catalyst"
  printf '%s' "$w"
}

mirror_sha() { git -C "$1/home/plugins/marketplaces/catalyst" rev-parse HEAD; }

write_registries() {   # <мир> <sha установки> [путь установки]
  local w="$1" sha="$2" ip="${3:-$1/home/plugins/cache/catalyst/catalyst/9.9.9}"
  cat > "$w/home/plugins/installed_plugins.json" <<JSON
{"version":2,"plugins":{"catalyst@catalyst":[{"scope":"user",
 "installPath":"$ip","version":"9.9.9","gitCommitSha":"$sha"}]}}
JSON
  cat > "$w/home/plugins/known_marketplaces.json" <<JSON
{"catalyst":{"source":{"source":"github","repo":"t/t"},
 "installLocation":"$w/home/plugins/marketplaces/catalyst"}}
JSON
}

# Код возврата берётся у САМОЙ подстановки, а не через переменную внутри неё:
# `out=$(run_door ...)` исполняет функцию в подоболочке, и любое присваивание
# внутри неё наружу не выходит -- та же ловушка, за которую платил корпусный
# стенд кита.
run_door() {   # <мир> -> stdout двери, код возврата = код двери
  local w="$1"
  CLAUDE_CONFIG_DIR="$w/home" CLAUDE_PLUGIN_ROOT="$w/home/plugins/cache/catalyst/catalyst/9.9.9" \
    python3 "$DOOR"
}

# --- КОНТРОЛЬ: всё сошлось -> дверь МОЛЧИТ ----------------------------------
W=$(mk_world converged)
write_registries "$W" "$(mirror_sha "$W")"
out=$(run_door "$W"); rc=$?
if (( rc == 0 )) && [[ -z "$out" ]]; then
  ok "КОНТРОЛЬ: три оси сошлись -- дверь молчит (rc=0)"
else
  bad "КОНТРОЛЬ: сошедшееся состояние должно молчать, получили rc=$rc вывод=[$out]"
fi

# --- ОСЬ A: исполняется не та копия, что учтена -----------------------------
W=$(mk_world axis_a)
write_registries "$W" "$(mirror_sha "$W")" "$W/home/plugins/cache/catalyst/catalyst/ДРУГАЯ"
out=$(run_door "$W"); rc=$?
if [[ "$out" == *"ОСЬ A"* ]] && [[ "$out" != *"ОСЬ B"* ]] && [[ "$out" != *"ОСЬ C"* ]]; then
  ok "ОСЬ A краснеет своей причиной и НЕ тянет соседние"
else
  bad "ОСЬ A: ждали только её, получили [$out]"
fi

# --- ОСЬ B: установка позади зеркала ----------------------------------------
# Зеркало двигается вперёд, запись об установке остаётся на прежнем sha.
W=$(mk_world axis_b)
old=$(mirror_sha "$W")
echo two > "$W/origin/f"; git -C "$W/origin" add f; git -C "$W/origin" commit -qm two
git -C "$W/home/plugins/marketplaces/catalyst" pull -q origin main
write_registries "$W" "$old"
out=$(run_door "$W"); rc=$?
if [[ "$out" == *"ОСЬ B"* && "$out" == *"Переустановить плагин"* && "$out" != *"ОСЬ A"* ]]; then
  ok "ОСЬ B краснеет своей причиной и называет действие"
else
  bad "ОСЬ B: ждали её с действием, получили [$out]"
fi

# --- ОСЬ C: зеркало позади удалённого источника -----------------------------
# Ровно случай, измеренный 2026-09-14 в бою.
W=$(mk_world axis_c)
write_registries "$W" "$(mirror_sha "$W")"
echo two > "$W/origin/f"; git -C "$W/origin" add f; git -C "$W/origin" commit -qm two
out=$(run_door "$W"); rc=$?
if [[ "$out" == *"ОСЬ C"* && "$out" == *"Обновить"* && "$out" != *"ОСЬ B"* ]]; then
  ok "ОСЬ C краснеет своей причиной и называет действие"
else
  bad "ОСЬ C: ждали её с действием, получили [$out]"
fi

# --- ОСЬ C НЕ ИЗМЕРЕНА: источник недосягаем ---------------------------------
# Главный зуб задачи #101: «не смог спросить» обязан быть отличим от «не
# двигался», а не сливаться с ним в зелёное.
W=$(mk_world axis_c_dead)
write_registries "$W" "$(mirror_sha "$W")"
git -C "$W/home/plugins/marketplaces/catalyst" remote set-url origin "$ROOT/нет-такого-дома"
out=$(run_door "$W"); rc=$?
if [[ "$out" == *"ОСЬ C НЕ ИЗМЕРЕНА"* ]] && (( rc == 0 )); then
  ok "недосягаемый источник даёт «НЕ ИЗМЕРЕНА», а не зелёное"
else
  bad "ось C при мёртвом источнике: ждали «НЕ ИЗМЕРЕНА», получили rc=$rc [$out]"
fi

# --- ПРИБОР НЕ МЕРИТ: нет реестра установки ---------------------------------
W=$(mk_world no_registry)
write_registries "$W" "$(mirror_sha "$W")"
rm -f "$W/home/plugins/installed_plugins.json"
out=$(run_door "$W" 2>"$ROOT/no_registry.err"); rc=$?
if (( rc == 2 )); then
  ok "пропавший реестр установки -- класс 2 «прибор не мерит», не 0"
else
  bad "пропавший реестр: ждали код 2, получили $rc"
fi

# --- КЭШ ОСИ C: молчание по кэшу ОБЪЯСНЕНО, а не слепо --------------------
# Мир «converged» уже спрашивал сеть в первом случае, поэтому sha источника
# лежит в НАШЕМ доме состояния. Двигаем источник и ждём МОЛЧАНИЯ -- но
# молчание принимается только вместе с уликой: в кэше лежит доTTL-шный sha,
# равный зеркалу. Без этого случая молчание по кэшу и молчание по сходимости
# были бы неотличимы, а бюджет TTL -- незамеренным.
W="$ROOT/converged"
STATE="$W/home/probes/catalyst/freshness.json"
echo two > "$W/origin/f"; git -C "$W/origin" add f; git -C "$W/origin" commit -qm two
cached=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(next(iter(d.values()))["sha"])' "$STATE")
out=$(run_door "$W"); rc=$?
if (( rc == 0 )) && [[ -z "$out" ]] && [[ "$cached" == "$(mirror_sha "$W")" ]]; then
  ok "ось C внутри TTL молчит ПО КЭШУ -- и кэш предъявлен (${cached:0:12})"
else
  bad "кэш оси C: ждали молчание при кэше=$cached зеркало=$(mirror_sha "$W"), получили rc=$rc [$out]"
fi

# --- ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ МОЛЧАНИЯ ----------------------------------------
# Первый случай проверял ПУСТОТУ. Пустота недействительна, пока не показано,
# что тот же прибор на тех же реестрах умеет заговорить. Снимаем ровно одну
# причину молчания -- кэш оси C (файл СВОЙ, синтетического мира) -- и ничего
# больше: источник уже сдвинут выше. Заговорила дверь -> молчание обоих
# предыдущих случаев измерено, а не приписано.
rm -f "$STATE"
out=$(run_door "$W")
if [[ "$out" == *"ОСЬ C"* ]]; then
  ok "КОНТРОЛЬ ПУСТОТЫ: снят кэш -- тот же мир заговорил осью C"
else
  bad "КОНТРОЛЬ ПУСТОТЫ: прибор молчит и на разошедшемся мире без кэша -- молчание выше недействительно"
fi

# --- НАПРАВЛЕНИЕ: зеркало ВПЕРЕДИ источника -> обновлять нечего ------------
# «Не равны» не значит «отстало». Требовать обновления маркетплейса за то, что
# зеркало ушло вперёд, значит звать оператора впустую.
W=$(mk_world ahead)
git -C "$W/home/plugins/marketplaces/catalyst" config user.email t@t
git -C "$W/home/plugins/marketplaces/catalyst" config user.name t
echo ahead > "$W/home/plugins/marketplaces/catalyst/f"
git -C "$W/home/plugins/marketplaces/catalyst" commit -qam ahead
write_registries "$W" "$(mirror_sha "$W")"
out=$(run_door "$W"); rc=$?
if (( rc == 0 )) && [[ -z "$out" ]]; then
  ok "зеркало впереди источника -- дверь молчит, а не зовёт обновляться"
else
  bad "зеркало впереди: ждали молчание, получили rc=$rc [$out]"
fi

# --- КЭШ, КОТОРЫЙ ЗЕРКАЛО УЖЕ СОДЕРЖИТ, НЕ ПРОДЛЕВАЕТСЯ --------------------
# Живой случай 2026-09-14: дверь позвала обновлять маркетплейс через 23 минуты
# после пуша, потому что в кэше лежал доTTL-шный sha источника, а зеркало с тех
# пор ушло вперёд ровно до него. Срок годности тут не единственное условие:
# значение, которое зеркало уже содержит, устарело ПО ПОСТРОЕНИЮ.
W=$(mk_world stale_cache)
write_registries "$W" "$(mirror_sha "$W")"
out=$(run_door "$W"); rc=$?            # прогон 1: кладёт в кэш старый sha
[[ -z "$out" ]] || bad "подготовка кэша: ждали молчание, получили [$out]"
echo two > "$W/origin/f"; git -C "$W/origin" add f; git -C "$W/origin" commit -qm two
git -C "$W/home/plugins/marketplaces/catalyst" pull -q origin main
write_registries "$W" "$(mirror_sha "$W")"
out=$(run_door "$W"); rc=$?            # прогон 2: кэш устарел, но «свеж» по TTL
if (( rc == 0 )) && [[ -z "$out" ]]; then
  ok "устаревший кэш не продлевается: дверь переспросила и молчит"
else
  bad "устаревший кэш: ждали молчание после переспроса, получили rc=$rc [$out]"
fi

# --- РАЗОШЛИСЬ: у каждого есть своё -----------------------------------------
# Отличимо от отставания только когда объект источника есть локально, поэтому
# зеркало здесь ЗАБИРАЕТ объекты, но не сливает их.
W=$(mk_world diverged)
M="$W/home/plugins/marketplaces/catalyst"
git -C "$M" config user.email t@t; git -C "$M" config user.name t
echo origin-side > "$W/origin/f"; git -C "$W/origin" add f; git -C "$W/origin" commit -qm origin-side
git -C "$M" fetch -q origin
echo mirror-side > "$M/f"; git -C "$M" commit -qam mirror-side
write_registries "$W" "$(mirror_sha "$W")"
out=$(run_door "$W"); rc=$?
if [[ "$out" == *"РАЗОШЛИСЬ"* ]] && [[ "$out" != *"Обновить маркетплейс"* ]]; then
  ok "разошедшиеся зеркало и источник названы своим состоянием, не отставанием"
else
  bad "расхождение: ждали «РАЗОШЛИСЬ» без совета обновляться, получили rc=$rc [$out]"
fi

# --- ЗУБЫ ВЫЗЫВАЮЩЕГО: отказ прибора обязан быть ВИДЕН ----------------------
# Прибор пишет диагноз в stderr и отдаёт код 2. Пока вызывающий гасил stderr и
# терял код (`$(... 2>/dev/null) || x=""`), отказ был неотличим от «всё
# сошлось»: дверь молчала ровно в том случае, ради которого заведена. Здесь
# мерится ВЫЗЫВАЮЩИЙ (hooks/session-start), а не прибор.
REPO="$(cd "$HERE/../.." && pwd)"
LOUD='PLUGIN FRESHNESS UNMEASURED'

mk_plugin() {   # <имя> <код прибора> <stdout прибора> -> путь копии плагина
  # CONSTRAINT: присваивания РАЗНЕСЕНЫ. В `local a=$1 p=$ROOT/$a` правая часть
  # второго читает ещё не присвоенное имя (bash 3.2 -- живой интерпретатор на
  # darwin), и под `set -u` это отказ «unbound variable», а не пустая строка.
  local name="$1"
  local rc="$2"
  local out="$3"
  local p="$ROOT/$name"
  mkdir -p "$p/skills/using-catalyst"
  cp -R "$REPO/hooks" "$p/hooks"
  cp "$REPO/skills/using-catalyst/SKILL.md" "$p/skills/using-catalyst/SKILL.md"
  {
    printf '#!/usr/bin/env python3\nimport sys\n'
    printf 'sys.stderr.write("plugin-freshness: ПРИБОР НЕ МЕРИТ -- синтетический отказ зуба\\n")\n'
    printf 'sys.stdout.write(%s)\n' "\"\"\"$out\"\"\""
    printf 'sys.exit(%s)\n' "$rc"
  } > "$p/hooks/plugin-freshness.py"
  chmod +x "$p/hooks/plugin-freshness.py"
  printf '%s' "$p"
}

run_start() {   # <путь копии> -> stdout хука
  CLAUDE_PLUGIN_ROOT="$1" bash "$1/hooks/session-start"
}

P=$(mk_plugin caller-refused 2 "")
out=$(run_start "$P"); rc=$?
if [[ $rc -eq 0 && "$out" == *"$LOUD"* && "$out" == *"ПРИБОР НЕ МЕРИТ"* ]]; then
  ok "отказ прибора объявлен в контексте вместе со своей причиной"
else
  bad "отказ прибора: ждали громкую строку с причиной, получили rc=$rc [$out]"
fi

# Положительный контроль молчания: тот же путь при исправном приборе обязан
# НЕ вносить громкую строку -- иначе первое утверждение держалось бы на том,
# что строка есть всегда.
P=$(mk_plugin caller-silent 0 "")
out=$(run_start "$P"); rc=$?
if [[ $rc -eq 0 && "$out" != *"$LOUD"* ]]; then
  ok "исправный молчащий прибор не вносит громкой строки"
else
  bad "молчание: громкая строка появилась там, где мерить удалось [rc=$rc]"
fi

# Положительный контроль дороги: находка прибора обязана ДОЕХАТЬ до контекста.
P=$(mk_plugin caller-speaks 0 "ОТСТАЛА УСТАНОВКА: синтетическая находка зуба")
out=$(run_start "$P"); rc=$?
if [[ $rc -eq 0 && "$out" == *"ОТСТАЛА УСТАНОВКА"* && "$out" != *"$LOUD"* ]]; then
  ok "находка исправного прибора доезжает до контекста сессии"
else
  bad "находка прибора не доехала до контекста [rc=$rc]"
fi

# Отрицательный контроль: вернуть вызывающему прежнюю форму -- первое
# утверждение обязано покраснеть, иначе оно ничего не сторожит.
P=$(mk_plugin caller-control 2 "")
python3 - "$P/hooks/session-start" <<'MUT'
import sys
p = sys.argv[1]
t = open(p, encoding='utf-8').read()
NEEDLE = 'freshness=$(python3 "${SCRIPT_DIR}/plugin-freshness.py" 2>"$freshness_errfile") || freshness_rc=$?'
if t.count(NEEDLE) != 1:
    sys.stderr.write('МУТАЦИЯ НЕ ПРИМЕНИЛАСЬ: якорь найден %d раз\n' % t.count(NEEDLE))
    sys.exit(2)
open(p, 'w', encoding='utf-8').write(t.replace(
    NEEDLE,
    'freshness=$(python3 "${SCRIPT_DIR}/plugin-freshness.py" 2>/dev/null) || freshness=""', 1))
MUT
mrc=$?
if [[ $mrc -ne 0 ]]; then
  printf 'ОТКАЗ: контроль вызывающего НЕ ИЗМЕРЯЛ -- мутация не применилась (код %s)\n' "$mrc" >&2
  exit 2
fi
if ! bash -n "$P/hooks/session-start"; then
  printf 'ОТКАЗ: контроль вызывающего НЕ ИЗМЕРЯЛ -- мутация сломала разбор жертвы\n' >&2
  exit 2
fi
out=$(run_start "$P"); rc=$?
if [[ "$out" != *"$LOUD"* ]]; then
  ok "контроль краснит утверждение своей причиной: прежняя форма глушит отказ"
else
  bad "контроль НЕ покраснел: громкая строка держится и без правки вызывающего"
fi

printf '\nplugin-freshness teeth: прошло=%d провалов=%d\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
