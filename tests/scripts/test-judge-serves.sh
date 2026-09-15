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
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }

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
run_session() {   # <имя> <дом проб> <текст задачи диспатча> -> код сессии в файле
  local name="$1" home="$2" task="$3"
  local r="$ROOTDIR/$name"
  mkdir -p "$r/config" "$r/cwd"
  (
    cd "$r/cwd" || exit 90
    env -i \
      HOME="$HOME" PATH="$PATH" TERM=dumb SHELL=/bin/bash \
      CLAUDE_CONFIG_DIR="$r/config" \
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
      --max-turns 8 \
      -p "Сделай РОВНО ОДИН диспатч через инструмент Task (subagent_type: general-purpose) с задачей: «${task}». Больше ничего не делай. Если диспатч отклонён -- назови текст отказа и остановись." \
      < /dev/null > "$r/stdout.log" 2> "$r/stderr.log"
    printf '%s' "$?" > "$r/rc"
  )
}

# Число улик в доме -- отдельной функцией: пустой дом и дом с уликами обязаны
# различаться ЧИСЛОМ, а не наличием каталога.
recs() { ls "$1/judge/records" 2>&1 | grep -c '^mod-' || true; }

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

printf '\nприёмка судьи: зелёных %s, красных %s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
