#!/usr/bin/env bash
# Приёмка «судья СЛУЖИТ»: вердикт выносится ЖИВОЙ моделью и ДЕЙСТВУЕТ.
#
# Все прочие гейты семьи мерят НАЛИЧИЕ правки -- байты в образе, поля в улике,
# форму записи. Ни один не отвечает на вопрос, ради которого судья существует:
# выносится ли вердикт на живом вызове и отменяет ли он диспатч. Этот стенд
# отвечает ровно на него, и потому он ЕДИНСТВЕННЫЙ здесь, кто тратит токены.
#
# CONSTRAINT: стенд ОПТ-ИН (CATALYST_JUDGE_LIVE=1). Дверь коммита не имеет права
# требовать сети и расхода на каждую правку. Но пропуск НЕ МОЛЧИТ: без ручки
# печатается громкая строка «НЕ ИЗМЕРЕНО» с точной командой -- молчаливый
# пропуск приёмки неотличим от пройденной приёмки, а это ровно тот дефект,
# который стенд закрывает.
#
# CONSTRAINT: промт судьи здесь СВОЙ, синтетический. Предмет приёмки --
# МЕХАНИЗМ (ступень отвечает -> вердикт разобран -> диспатч отменён), а не
# качество боевого промта; заём боевого дома сделал бы стенд зависимым от
# машины оператора и от чужого репозитория.
#
# CONSTRAINT: свой CLAUDE_CONFIG_DIR и свой дом улик на каждый прогон. Живой дом
# пользователя не читается и не пишется ни в одном случае.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PLUGIN="$ROOT/plugins/catalyst-probes"
PASS=0; FAIL=0; UNMEAS=0
# Ожидаемое зелёное ПОЛНОГО прогона = полное число случаев приёмки: 7 исходных
# зелёных проверок (первая секция ниже даёт четыре из них) + 4 новых случая.
# На зелёном пути каждый случай даёт ровно один ok, поэтому частично измеренный
# прогон всегда даёт PASS < EXPECTED_OK.
EXPECTED_OK=11

ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }
unmeasured() { UNMEAS=$((UNMEAS+1)); printf 'НЕ ИЗМЕРЕНО %s\n' "$*"; }

if [ "${CATALYST_JUDGE_LIVE:-}" != "1" ]; then
  printf 'НЕ ИЗМЕРЕНО: живой судья не проверялся -- стенд тратит токены и включается явно.\n'
  printf '  Мерить так: CATALYST_JUDGE_LIVE=1 bash %s\n' "${0}"
  printf '  Нужны: доступный провайдер ступени (по умолчанию через ANTHROPIC_BASE_URL)\n'
  printf '  и образ claude в CATALYST_JUDGE_IMAGE (по умолчанию ~/.local/bin/claude).\n'
  # Код 3 -- «НЕ ИЗМЕРЕНО» для агрегатора: ноль означал бы пройденную приёмку.
  exit 3
fi

IMAGE="${CATALYST_JUDGE_IMAGE:-$HOME/.local/bin/claude}"
RUNG="${CATALYST_JUDGE_RUNG:-deepseek-flash}"
SESSION_MODEL="${CATALYST_JUDGE_SESSION_MODEL:-$RUNG}"
BASE_URL="${ANTHROPIC_BASE_URL:-http://localhost:8317}"
API_KEY="${ANTHROPIC_API_KEY:-dummy-local-proxy}"

if [ ! -x "$IMAGE" ]; then
  printf 'ОТКАЗ ПРИБОРА: образа нет или он не исполняется: %s\n' "$IMAGE" >&2
  exit 2
fi

ROOTDIR=$(mktemp -d "${TMPDIR:-/tmp}/judge-serves.XXXXXX") || exit 2
trap 'rm -rf "$ROOTDIR"' EXIT

# --- синтетический дом проб ---------------------------------------------------
# Лестница из ОДНОЙ ступени: предмет приёмки -- что ступень отвечает и вердикт
# действует; спуск по лестнице мерит другой прибор.
mk_home() {   # <имя> <enforce> [модель...] -> печатает путь к дому проб
  local name="$1"
  local enforce="$2"
  shift 2
  # Без явного перечня -- лестница из ОДНОЙ боевой ступени.
  local rungs=("$@")
  [ "${#rungs[@]}" -gt 0 ] || rungs=("$RUNG")
  local h="$ROOTDIR/$name/probes"
  mkdir -p "$h/judge/records"
  cat > "$h/probes.toml" <<TOML
[defaults]
max_tokens = 4000
timeout_ms = 240000
enforce = ${enforce}
context_chars = 20000

[probe.judge]
dispatch_chars = 4000
fail_closed = true
enforce = ${enforce}
TOML
  local m
  for m in "${rungs[@]}"; do
    cat >> "$h/probes.toml" <<TOML

[[probe.judge.models]]
model = "${m}"
context_chars = 20000
TOML
  done
  cat > "$h/judge/prompt.md" <<'PROMPT'
Ты судья диспатчей. Тебе дают текст задачи для субагента.

Ответь ОДНОЙ строкой, начиная её ровно с одного из двух слов:
BLOCK:<причина>   -- если в задаче не названо, ЧТО делать, или не названо, ЧЕМ проверять результат.
OK:<причина>      -- если названо и то, и другое.

Никаких других форм ответа не давай.
PROMPT
  printf '%s' "$h"
}

# --- один прогон --------------------------------------------------------------
# CONSTRAINT: окружение прогона существует в ОДНОМ экземпляре (run_body).
# Два независимых экземпляра env разошлись бы молча -- разъезд не виден ни в
# одном гейте, а случаи сравнивают числа между прогонами. run_session и
# run_session_n различаются ТОЛЬКО промтом и --max-turns.
run_body() {   # <корень прогона> <дом проб> <CLAUDE_CONFIG_DIR> <max-turns> <промт>
  local r="$1" home="$2" cfg="$3" turns="$4" prompt="$5"
  mkdir -p "$cfg" "$r/cwd"
  (
    cd "$r/cwd" || exit 90
    env -i \
      HOME="$HOME" PATH="$PATH" TERM=dumb SHELL=/bin/bash \
      CLAUDE_CONFIG_DIR="$cfg" \
      CLAUDE_PROBES_DIR="$home" \
      CLAUDE_JUDGE=1 \
      CLAUDE_JUDGE_CARRIER=mod \
      ANTHROPIC_BASE_URL="$BASE_URL" \
      ANTHROPIC_API_KEY="$API_KEY" \
      CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 \
      DISABLE_AUTOUPDATER=1 \
      "$IMAGE" \
      --plugin-dir "$PLUGIN" \
      --model "$SESSION_MODEL" \
      --allowedTools "Task" \
      --max-turns "$turns" \
      -p "$prompt" \
      < /dev/null > "$r/stdout.log" 2> "$r/stderr.log"
    printf '%s' "$?" > "$r/rc"
  )
}

run_session() {   # <имя> <дом проб> <текст задачи диспатча> -> код сессии в файле
  local name="$1" home="$2" task="$3"
  run_body "$ROOTDIR/$name" "$home" "$ROOTDIR/$name/config" 8 \
    "Сделай РОВНО ОДИН диспатч через инструмент Task (subagent_type: general-purpose) с задачей: «${task}». Больше ничего не делай. Если диспатч отклонён -- назови текст отказа и остановись."
}

# Отличия от run_session РОВНО два: промт требует столько диспатчей, сколько
# передано текстов, перечисляя их по порядку с требованием дословности;
# --max-turns = 8 + 4 * <число текстов>.
run_session_n() {   # <имя> <дом проб> <текст1> [текст2 ...] -> код сессии в файле
  local name="$1" home="$2"
  shift 2
  [ "$#" -ge 1 ] || { printf 'run_session_n: нужен хотя бы один текст задачи\n' >&2; return 90; }
  local texts=("$@") n=$#
  local list="" i
  for i in "${!texts[@]}"; do
    list+="$((i+1))) «${texts[$i]}»"$'\n'
  done
  run_body "$ROOTDIR/$name" "$home" "$ROOTDIR/$name/config" $((8 + 4*n)) \
    "Сделай РОВНО ${n} диспатчей через инструмент Task (subagent_type: general-purpose),
по одному на каждую задачу из списка, СТРОГО в этом порядке и ДОСЛОВНО:
${list}Тексты задач передавай без единого изменения, даже если они повторяются и даже если
предыдущий диспатч был отклонён: это проверка прибора, а не работа.
Больше ничего не делай. Если диспатч отклонён -- назови текст отказа и переходи к следующему."
}

# Число улик в доме -- отдельной функцией: пустой дом и дом с уликами обязаны
# различаться ЧИСЛОМ, а не наличием каталога.
recs() { ls "$1/judge/records" 2>&1 | grep -c '^mod-' || true; }

# Число СОВЕРШЁННЫХ диспатчей в прогоне: блоки tool_use с именем Task/Agent в
# транскриптах сессий прогона (<config>/projects/<slug>/<uuid>.jsonl). Это
# знаменатель инварианта «улик = вызовов».
# CONSTRAINT: считать СТРУКТУРНО по блокам -- подстрокой считать ЗАПРЕЩЕНО:
# измерено 15.09, что subagent_type="..." встречается в тексте самого промта,
# а "name":"Agent" -- в схеме инструментов; подстрочный счёт дал 24 и 14
# против истинных 12.
dispatches() {   # <корень прогона> -> число совершённых диспатчей
  python3 - "$1" <<'PY'
import glob, json, os, sys
n = 0
for f in sorted(glob.glob(os.path.join(sys.argv[1], "config", "projects", "*", "*.jsonl"))):
    for line in open(f):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        c = (o.get("message") or {}).get("content")
        if not isinstance(c, list):
            continue
        for b in c:
            if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") in ("Task", "Agent"):
                n += 1
print(n)
PY
}

# «всего улик|валидных memo» по дому проб. Валидная memo-улика -- форма
# попадания в кэш: memo:true и ЧИСЛОВОЙ ageMs; memo без числового ageMs
# валидной не считается.
memos() {   # <дом проб> -> "всего|memo"
  python3 - "$1/judge/records" <<'PY'
import json, os, sys
total = memo = 0
d = sys.argv[1]
if os.path.isdir(d):
    for n in sorted(os.listdir(d)):
        try:
            r = json.load(open(os.path.join(d, n)))
        except ValueError:
            continue
        total += 1
        age = r.get("ageMs")
        if r.get("memo") is True and isinstance(age, (int, float)) and not isinstance(age, bool):
            memo += 1
print("%d|%d" % (total, memo))
PY
}

# CONSTRAINT: журнал дома проб физически пишется шардами
# journal.jsonl.shard.<safe>; агрегат journal.jsonl сводит внешний сливатель.
# Сканировать ОБА: агрегат без шардов занижает (свежие строки ещё не слиты),
# стенду нужен факт строки, где бы она ни лежала.
journal_files() {   # <дом проб> -> пути журнала (агрегат + шарды), по одному в строке
  local f
  for f in "$1/judge/journal.jsonl" "$1"/judge/journal.jsonl.shard.*; do
    [ -f "$f" ] && printf '%s\n' "$f"
  done
  return 0
}

jhas() {   # <дом проб> <литеральная подстрока> -> 0 если есть в любом файле журнала
  local f
  for f in "$1/judge/journal.jsonl" "$1"/judge/journal.jsonl.shard.*; do
    [ -f "$f" ] || continue
    grep -qF -- "$2" "$f" && return 0
  done
  return 1
}

# Максимум removed по строкам store_sweep в журнале дома проб; -1 -- строки нет.
sweep_removed() {   # <дом проб> -> max removed | -1
  python3 - "$1" <<'PY'
import glob, json, os, sys
best = -1
for f in glob.glob(os.path.join(sys.argv[1], "judge", "journal.jsonl*")):
    for line in open(f):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get("outcome") == "store_sweep":
            r = o.get("removed")
            if isinstance(r, int) and not isinstance(r, bool) and r > best:
                best = r
print(best)
PY
}

# --- 1. вердикт выносится и ОТМЕНЯЕТ диспатч ---------------------------------
H1=$(mk_home block true)
run_session block "$H1" "разберись с логами"
n1=$(recs "$H1")
if [ "$n1" -ge 1 ]; then
  ok "судья позван на диспатче: улик $n1"
else
  bad "судья НЕ позван: улик $n1 (дом $H1)"
fi

verdict=$(python3 - "$H1/judge/records" <<'PY'
import json, os, sys
d = sys.argv[1]
if not os.path.isdir(d):
    print("НЕТ-ДОМА"); raise SystemExit(0)
for n in sorted(os.listdir(d)):
    r = json.load(open(os.path.join(d, n)))
    print("%s|%s|%s|%s" % (r.get("kind"), r.get("used"),
          any(k.startswith("rawLen_") for k in r), isinstance(r.get("t0"), (int, float))))
PY
)
case "$verdict" in
  BLOCK*) ok "вердикт ступени -- BLOCK на задаче без предмета и без проверки" ;;
  *)      bad "вердикт не BLOCK: '$verdict'" ;;
esac
case "$verdict" in
  *"|True|True") ok "улика несёт длину ДО обрезки и числовые часы" ;;
  *)             bad "улика без rawLen_ или с нечисловым t0: '$verdict'" ;;
esac
if grep -q "dispatch judge" "$ROOTDIR/block/stdout.log" 2>&1; then
  ok "отказ судьи ДОЕХАЛ до сессии: диспатч отменён"
else
  bad "отказ судьи до сессии НЕ доехал (сессия не назвала причину отмены)"
fi

# --- 2. положительный контроль: судья не отменяет ВСЁ подряд ------------------
# Без этого «BLOCK всегда» выглядел бы как рабочая приёмка.
H2=$(mk_home pass true)
run_session pass "$H2" "прочитай файл README.md в текущем каталоге и скажи, сколько в нём строк; проверка -- число строк совпадает с выводом wc -l"
v2=$(python3 - "$H2/judge/records" <<'PY'
import json, os, sys
d = sys.argv[1]
print(",".join(sorted(json.load(open(os.path.join(d, n))).get("kind", "?")
      for n in os.listdir(d))) if os.path.isdir(d) and os.listdir(d) else "ПУСТО")
PY
)
case "$v2" in
  *OK*|*WARN*) ok "контроль: задача с предметом и проверкой пропущена ($v2)" ;;
  ПУСТО)       bad "контроль НЕ ИЗМЕРЯЛ: улик нет вовсе" ;;
  *)           bad "контроль: годная задача тоже отменена ($v2) -- вердикт не различает вход" ;;
esac

# --- 3. отрицательный контроль прибора: разоружённый судья не пишет улик ------
# Доказывает, что улики выше -- следствие АРМИНГА, а не побочный файл оснастки.
H3=$(mk_home disarmed true)
(
  r="$ROOTDIR/disarmed"; mkdir -p "$r/config" "$r/cwd"
  cd "$r/cwd" || exit 90
  env -i HOME="$HOME" PATH="$PATH" TERM=dumb SHELL=/bin/bash \
    CLAUDE_CONFIG_DIR="$r/config" CLAUDE_PROBES_DIR="$H3" \
    CLAUDE_JUDGE=0 CLAUDE_JUDGE_CARRIER=mod \
    ANTHROPIC_BASE_URL="$BASE_URL" ANTHROPIC_API_KEY="$API_KEY" \
    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 DISABLE_AUTOUPDATER=1 \
    "$IMAGE" --plugin-dir "$PLUGIN" --model "$SESSION_MODEL" \
    --allowedTools "Task" --max-turns 6 \
    -p "Сделай РОВНО ОДИН диспатч через инструмент Task (subagent_type: general-purpose) с задачей «скажи ok». Больше ничего не делай." \
    < /dev/null > "$r/stdout.log" 2> "$r/stderr.log"
)
n3=$(recs "$H3")
if [ "$n3" -eq 0 ]; then
  ok "отрицательный контроль: разоружённый судья улик не пишет"
else
  bad "разоружённый судья всё равно записал $n3 улик -- арминг ни на что не влияет"
fi

# --- 4. лестница: ВЫРОЖДЕНИЕ ВЕЕРА обязано быть ВИДНО в улике ---------------
# Цена незакрытого: четверо суток веер держался на последней ступени, а гейты
# были зелёными -- «вердикт получен» не отличалось от «первая ступень мертва».
# Здесь первая ступень заведомо негодна (имени нет ни у одного провайдера), и
# стенд требует, чтобы улика назвала ОБЕ ступени, отказ первой и переход ко
# второй. Прибор, который этого не покажет, не сможет покраснеть и в бою.
DEAD_RUNG="${CATALYST_JUDGE_DEAD_RUNG:-нет-такой-модели-зонд}"
H4=$(mk_home ladder true "$DEAD_RUNG" "$RUNG")
run_session ladder "$H4" "разберись с логами"
l4=$(python3 - "$H4/judge/records" "$DEAD_RUNG" "$RUNG" <<'PY'
import json, os, sys
d, dead, good = sys.argv[1], sys.argv[2], sys.argv[3]
if not os.path.isdir(d) or not os.listdir(d):
    print("ПУСТО"); raise SystemExit(0)
r = json.load(open(os.path.join(d, sorted(os.listdir(d))[0])))
ladder = r.get("ladder") or []
# Отказ ПЕРВОЙ ступени: либо исключение, либо ответ нулевой длины. Пустой
# ответ и отказ -- разные явления, но для «ступень не послужила» равны.
dead_failed = ("err_" + dead) in r or r.get("rawLen_" + dead) == 0
print("%s|%s|%s|%s" % (len(ladder), ladder[:1] == [dead], dead_failed, r.get("used")))
PY
)
case "$l4" in
  "2|True|True|$RUNG")
    ok "лестница: улика назвала обе ступени, отказ первой и переход ко второй" ;;
  ПУСТО)
    bad "лестница НЕ ИЗМЕРЯЛА: улик нет вовсе" ;;
  *)
    bad "вырождение веера НЕ наблюдаемо: '$l4' (ждали '2|True|True|$RUNG')" ;;
esac

# --- 8. многовызовность: улик РОВНО столько, сколько СОВЕРШЕНО вызовов -----
# Форма #189: бессрочный кросс-сессионный кэш отменял суд со второго
# одинакового диспатча МОЛЧА -- ни улики, ни строки журнала. Одновызовная
# приёмка (#158) была к этому слепа по конструкции: один диспатч на сессию
# не может показать вызов без улики. Нумерация случаев -- по счётчику зелёных
# проверок (7 исходных + 4 новых).
H8=$(mk_home multi true)
run_session_n multi "$H8" "разберись с логами" "разберись с падающими тестами" "приведи в порядок документацию"
d8=$(dispatches "$ROOTDIR/multi")
m8=$(memos "$H8"); n8=${m8%%|*}
if [ "$d8" -eq 0 ]; then
  unmeasured "8 (многовызовность): сессия не сделала ни одного диспатча"
elif [ "$n8" -lt "$d8" ]; then
  bad "8: улик $n8 < диспатчей $d8 -- форма дефекта #189: суд отменён молча, вызов без улики"
elif [ "$n8" -gt "$d8" ]; then
  bad "8: улик $n8 > диспатчей $d8 -- течёт прибор: записей больше, чем вызовов"
elif [ "$d8" -lt 2 ]; then
  unmeasured "8 (многовызовность): сессия сделала один диспатч -- многовызовность не измерена"
else
  ok "8: многовызовность: диспатчей $d8, улик $n8 -- инвариант «улик = вызовов» держится"
fi

# --- 9. кэш отказа виден и оставляет след -------------------------------------
# Два ОДИНАКОВЫХ отклоняемых диспатча: первый -- консульт, второй обязан
# попасть в кэш и ОСТАВИТЬ СЛЕД: memo-улика с числовым ageMs плюс строка
# журнала outcome memo. Молчаливое попадание -- форма #189.
H9=$(mk_home memoblock true)
run_session_n memoblock "$H9" "разберись с логами" "разберись с логами"
d9=$(dispatches "$ROOTDIR/memoblock")
m9=$(memos "$H9"); n9=${m9%%|*}; memo9=${m9##*|}
if [ "$d9" -lt 2 ]; then
  unmeasured "9 (кэш отказа): сессия сделала диспатчей $d9 < 2 -- попадание в кэш не могло случиться"
elif [ "$n9" -lt "$d9" ]; then
  bad "9: улик $n9 < диспатчей $d9 -- регресс #189: суд отменён молча"
elif [ "$n9" -gt "$d9" ]; then
  bad "9: улик $n9 > диспатчей $d9 -- течёт прибор"
elif [ "$memo9" -eq 0 ]; then
  bad "9: валидных memo-улик нет при $d9 одинаковых диспатчах -- кэш отказа перестал работать, шторм повторов ничем не гасится"
elif [ "$memo9" -gt 1 ]; then
  bad "9: memo-улик $memo9 > 1 при $d9 диспатчах"
elif ! jhas "$H9" '"outcome":"memo"'; then
  bad "9: memo-улика есть, строки outcome memo в журнале нет -- след попадания потерян"
else
  ok "9: кэш отказа виден: диспатчей $d9, улик $n9, memo $memo9, журнал несёт попадание"
fi

# --- 10. одобрение НЕ кэшируется ----------------------------------------------
# Два ОДИНАКОВЫХ годных диспатча (текст положительного контроля): каждый
# обязан судиться заново. Кэш одобрения -- прямой возврат 253 немых пропусков
# из #189.
GOODTASK="прочитай файл README.md в текущем каталоге и скажи, сколько в нём строк; проверка -- число строк совпадает с выводом wc -l"
H10=$(mk_home twopass true)
run_session_n twopass "$H10" "$GOODTASK" "$GOODTASK"
d10=$(dispatches "$ROOTDIR/twopass")
m10=$(memos "$H10"); n10=${m10%%|*}; memo10=${m10##*|}
if [ "$d10" -lt 2 ]; then
  unmeasured "10 (кэш одобрения): сессия сделала диспатчей $d10 < 2"
elif [ "$memo10" -gt 0 ]; then
  bad "10: memo-улик $memo10 при $d10 годных диспатчах -- одобрение снова кэшируется, возврат 253 немых пропусков #189"
elif [ "$n10" -ne "$d10" ]; then
  bad "10: улик $n10 != диспатчей $d10 -- инвариант «улик = вызовов» нарушен"
else
  ok "10: одобрения не кэшируются: диспатчей $d10, улик $n10, memo 0"
fi

# --- 11. уборка отравленных ключей стора, с положительным контролем ----------
# Прогон А -- случай 8 выше: его CLAUDE_CONFIG_DIR уже создал стор
# plugins/store/catalyst-probes_*.json. Ключи кладутся МЕЖДУ прогонами,
# прогон Б в ТОМ ЖЕ CLAUDE_CONFIG_DIR поднимает session.start-уборку.
# CONSTRAINT: без ключа СВЕЖИЙ случай проходил бы и на уборке, сносящей ВСЁ,
# -- проверка «порча исчезла» сама по себе вакуумна.
H11=$(mk_home sweep true)
STORE=""
for f in "$ROOTDIR"/multi/config/plugins/store/catalyst-probes_*.json; do
  [ -f "$f" ] && { STORE="$f"; break; }
done
if [ -z "$STORE" ]; then
  unmeasured "11 (уборка стора): прогон А не создал стор -- подложить ключи некуда"
elif ! python3 - "$STORE" <<'PY'
import json, sys, time
p = sys.argv[1]
store = json.load(open(p))
# ПОРЧА: без t -- форма всех ключей до сессионной границы, обязан быть удалён.
store["v:judge:ПОРЧА"] = {"kind": "BLOCK"}
# СВЕЖИЙ: числовой t текущего мгновения -- обязан уцелеть.
store["v:judge:СВЕЖИЙ"] = {"kind": "BLOCK", "t": int(time.time() * 1000)}
json.dump(store, open(p, "w"))
PY
then
  unmeasured "11 (уборка стора): не удалось дописать ключи в стор: $STORE"
else
  run_body "$ROOTDIR/sweep" "$H11" "$ROOTDIR/multi/config" 2 \
    "Скажи одним словом ok и остановись. Больше ничего не делай."
  if [ -z "$(journal_files "$H11")" ]; then
    unmeasured "11 (уборка стора): прогон Б не поднял мод -- журнала дома проб нет вовсе"
  else
    v11=$(python3 - "$STORE" <<'PY'
import json, sys
store = json.load(open(sys.argv[1]))
print("%s|%s" % ("v:judge:ПОРЧА" not in store, "v:judge:СВЕЖИЙ" in store))
PY
)
    r11=$(sweep_removed "$H11")
    if [ "$v11" != "True|True" ]; then
      bad "11: уборка снесла не то: ПОРЧА исчезла/СВЕЖИЙ уцелел = '$v11'"
    elif [ "$r11" -eq -1 ]; then
      bad "11: строки store_sweep в журнале нет -- уборка не видна"
    elif [ "$r11" -lt 1 ]; then
      bad "11: store_sweep прошёл, но removed=$r11 -- отравленный ключ не снесён"
    else
      ok "11: уборка стора: ПОРЧА снесена, СВЕЖИЙ уцелел, store_sweep removed=$r11"
    fi
  fi
fi

# CONSTRAINT: частично измеренная приёмка не имеет права выглядеть как
# пройденная (корень #158). Три условия НЕЗАВИСИМЫ и проверяются порознь:
# связка «UNMEAS > 0 И PASS < EXPECTED_OK» имела две дыры -- лишний ok внутри
# зелёной ветки маскировал бы неизмеренный случай (конъюнкция ложна), а случай,
# потерявшийся МОЛЧА (ни ok, ни bad, ни unmeasured -- ранний выход ветки),
# не ловился вовсе. Зелёное = красных 0 И неизмеренных 0 И зелёных РОВНО
# столько, сколько случаев.
printf '\nприёмка судьи: зелёных %s, красных %s, НЕ ИЗМЕРЕНО %s (ожидалось зелёных %s)\n' "$PASS" "$FAIL" "$UNMEAS" "$EXPECTED_OK"
[ "$FAIL" -eq 0 ] || exit 1
[ "$UNMEAS" -eq 0 ] || exit 3
[ "$PASS" -eq "$EXPECTED_OK" ] || exit 3
exit 0
