#!/usr/bin/env bash
# Имя события, на которое подписывается мод, обязано быть НАСТОЯЩЕЙ дверью
# головной версии (#291).
#
# ЗАЧЕМ. Замер 18.09 на образах 2.1.272/273/276: официальный `claude plugin
# validate` судит ГЛАГОЛ только внутри ИЗВЕСТНОГО ему пространства имён
# (`session.__never__` -> rc=1), а НЕИЗВЕСТНОЕ пространство пропускает МОЛЧА
# (`nosuchns.never`, `catalyst.whatever` -> rc=0). Значит опечатка в
# пространстве («sesion.start») даёт мёртвый хук, который не краснит ни у
# апстрима, ни у нас: подписка просто никогда не сработает, а все приборы
# зелены. Эта дверь закрывает ровно тот случай.
#
# CONSTRAINT: список дверей пинован ЗАМЕРОМ пристинного образа головной версии,
# а не догадкой и не копией документации. Дом списка -- tests/data/.
set -u

# CONSTRAINT: оба числа объявлены ЗДЕСЬ и больше нигде; расхождение в ЛЮБУЮ
# сторону -- КРАСНЫЙ (#292). Потерянная подписка и подписка, которой никогда не
# было, неразличимы по нулю провалов.
EXPECTED_TEETH=8
EXPECTED_EVENTS=8
# CONSTRAINT: пин числа проверок самопроверки (--self-check): меньше пина --
# отказ прибора, а не зелень; каждая проверка сходится или краснеет именной
# причиной.
EXPECTED_SELF=7

case "${1:-}" in
  ''|--self-check) ;;
  *) printf 'mod-event-names: ПРИБОР НЕДОСТУПЕН: неизвестный аргумент: %s\n' "$1" >&2
     printf 'mod-event-names: допустимо только: (без аргументов) | --self-check\n' >&2
     exit 2 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# CONSTRAINT: env-ручки MOD/DOORS существуют ТОЛЬКО для --self-check: копия
# предмета живёт во временном каталоге и не может вычислить ROOT от своего $0.
# Живой прогон (run-all) ручек не задаёт и получает деревные пути.
MOD="${CATALYST_MOD_FILE:-$ROOT/plugins/catalyst-probes/hooks/register.ts}"
# CONSTRAINT: пин головной версии; имя двери -- в форме адресации (#336).
DOORS="${CATALYST_DOORS_PIN:-$ROOT/tests/data/host-doors-2.1.278.txt}"

[ -f "$MOD" ] || { printf 'mod-event-names: ПРИБОР НЕДОСТУПЕН: нет %s\n' "$MOD" >&2; exit 2; }
[ -f "$DOORS" ] || { printf 'mod-event-names: ПРИБОР НЕДОСТУПЕН: нет %s\n' "$DOORS" >&2; exit 2; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }

# Имена, на которые мод ПОДПИСЫВАЕТСЯ. Форма вызова объявлена констрейнтом в
# голове самого мода: «on(event) argument is a string literal».
events="$(grep -o -E 'on\("[a-z]+\.[a-zA-Z.]+"' "$MOD" | sed -E 's/^on\("//; s/"$//' | sort -u)"
n_events="$(printf '%s\n' "$events" | grep -c . || true)"

# Пинованные двери: строки-имена, без заголовка, полей паспорта И контролей
# метода ценза -- CONTROL= исключается ТЕМ ЖЕ выражением, что и паспорт: второй
# фильтр ниже разнёс бы «что исключено» на два места.
doors="$(grep -v -E '^#|^VERSION=|^IMAGE_SHA256=|^CONTROL=' "$DOORS" | grep -E '\S' | sort -u)"
n_doors="$(printf '%s\n' "$doors" | grep -c . || true)"
ver="$(sed -n 's/^VERSION=//p' "$DOORS")"
sha="$(sed -n 's/^IMAGE_SHA256=//p' "$DOORS")"

in_doors() { printf '%s\n' "$doors" | grep -q -x -F "$1"; }

# Набор имён как массив: зубы 7/8 судят ИМЕННО его, а не сырые строки файла
# (иначе CONTROL= краснил бы зуб 7 ложно).
dlist=()
while IFS= read -r d; do
  [ -n "$d" ] && dlist+=("$d")
done <<< "$doors"

# --- самопроверка: копия предмета + точечная подстановка + краснота ----------
# CONSTRAINT: приём тот же, что у run-harness/*-teeth.sh (#378: зуб без
# вызывающего зелён лишь в памяти оператора). Обе мутации бьют по КОПИИ стенда;
# живые файлы не трогаются.

substitute() {   # <файл> <что> <чем>: ровно одно вхождение, иначе отказ
  python3 - "$1" "$2" "$3" <<'PY'
import io, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = io.open(path, encoding='utf-8').read()
n = text.count(old)
if n != 1:
    sys.stderr.write('подмена не однозначна: вхождений %d\n' % n)
    raise SystemExit(2)
io.open(path, 'w', encoding='utf-8').write(text.replace(old, new, 1))
PY
}

# apply_mut: копия + подмена; применение доказывается РАЗЛИЧИЕМ shasum и
# выживанием bash -n («не упало» -- не свидетельство).
apply_mut() {   # <источник> <копия> <что> <чем> -> 0 ok
  local before after
  cp "$1" "$2" || return 2
  before="$(shasum -a 256 "$2" | cut -d' ' -f1)"
  substitute "$2" "$3" "$4" || return 2
  bash -n "$2" || { printf 'ПРИБОР НЕДОСТУПЕН: мутация сломала синтаксис копии\n' >&2; return 2; }
  after="$(shasum -a 256 "$2" | cut -d' ' -f1)"
  [ "$before" != "$after" ] || { printf 'ПРИБОР НЕДОСТУПЕН: мутация не изменила копию\n' >&2; return 2; }
}

self_check() {
  local SELF_SRC CLEAN pin7 pin8 mut7 mut8
  local caught=0 fail=0 unmeas=0 unappl=0
  # CONSTRAINT: якоря подмен собираются конкатенацией смежных литералов: цельная
  # строка-аргумент совпала бы и с телом зуба, и с самим этим вызовом -- и
  # «ровно одно вхождение» падало бы на второй копии.
  local m7_old m8_old
  m7_old='*) bare="$bare $d"'' ;;'
  m8_old='*."$x") dup="$dup $x+$y"'' ;;'
  SELF_SRC="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  # T -- ГЛОБАЛЬНАЯ: EXIT-трап живёт вне функции, локальная T в нём -- unbound.
  T="$(mktemp -d "${TMPDIR:-/tmp}/modnames-self.XXXXXX")" || return 2
  trap 'rm -rf "$T"' EXIT

  run_stand() {   # <стенд> <пин>: код в ST_RC, вывод в ST_OUT
    ST_RC=0
    ST_OUT="$(CATALYST_MOD_FILE="$MOD" CATALYST_DOORS_PIN="$2" bash "$1" 2>&1)" || ST_RC=$?
  }

  # s<id> green: прогон обязан быть зелёным.
  want_green() {   # <id> <стенд> <пин>
    run_stand "$2" "$3"
    if [ "$ST_RC" -eq 0 ]; then
      printf '  ok     %s: зелён, как пинили\n' "$1"; caught=$((caught+1))
    else
      printf '  ПРОВАЛ %s: ждали зелёный, получили rc=%s [%s]\n' "$1" "$ST_RC" "$ST_OUT"; fail=$((fail+1))
    fi
  }

  # s<id> red: прогон обязан краснеть СВОЕЙ именной причиной (rc=1; rc=2 --
  # прибор недоступен, это НЕ ИЗМЕРЕНО, а не пойманная мутация).
  want_red() {   # <id> <стенд> <пин> <подстрока-причина>
    run_stand "$2" "$3"
    if [ "$ST_RC" -eq 2 ]; then
      printf '  НЕ ИЗМЕРЕНО %s: прибор недоступен [%s]\n' "$1" "$ST_OUT"; unmeas=$((unmeas+1)); return
    fi
    if [ "$ST_RC" -eq 1 ] && printf '%s' "$ST_OUT" | grep -qF "$4"; then
      printf '  ok     %s: краснен своей причиной «%s»\n' "$1" "$4"; caught=$((caught+1))
    else
      printf '  ПРОВАЛ %s: ждали красный с «%s», получили rc=%s [%s]\n' "$1" "$4" "$ST_RC" "$ST_OUT"; fail=$((fail+1))
    fi
  }

  CLEAN="$T/stand-clean.sh"; cp "$SELF_SRC" "$CLEAN"
  pin7="$T/pin-bare.txt";   pin8="$T/pin-pair.txt"
  mut7="$T/stand-no7.sh";   mut8="$T/stand-no8.sh"

  # Входы: pin7 -- голый хвост БЕЗ префиксной пары (краснеет только зуб 7);
  # pin8 -- пара session.turns + session.session.turns, обе формы с точкой
  # (краснеет только зуб 8: зуб 7 тут молчит по построению).
  apply_mut "$DOORS" "$pin7" 'classic.PreToolUse' 'PreToolUse' \
    || { printf '  НЕ_ПРИМЕНИЛОСЬ pin7\n'; unappl=$((unappl+1)); }
  apply_mut "$DOORS" "$pin8" 'session.turns
session.updated' 'session.turns
session.session.turns
session.updated' \
    || { printf '  НЕ_ПРИМЕНИЛОСЬ pin8\n'; unappl=$((unappl+1)); }
  # Мутации зубов: ослепление ровно одного зуба на копии стенда.
  apply_mut "$SELF_SRC" "$mut7" "$m7_old" '*) ;;' \
    || { printf '  НЕ_ПРИМЕНИЛОСЬ mut7\n'; unappl=$((unappl+1)); }
  apply_mut "$SELF_SRC" "$mut8" "$m8_old" '*."$x") ;;' \
    || { printf '  НЕ_ПРИМЕНИЛОСЬ mut8\n'; unappl=$((unappl+1)); }

  [ "$unappl" -eq 0 ] || {
    printf 'mod-event-names SELF-CHECK: проверок=%d поймано=%d провалов=%d НЕ_ИЗМЕРЕНО=%d НЕ_ПРИМЕНИЛОСЬ=%d\n' \
      "$EXPECTED_SELF" "$caught" "$fail" "$unmeas" "$unappl"
    return 2
  }

  # Контроль: чистая копия на живом пине зелёна -- иначе краснота ниже ничего
  # бы не доказывала.
  want_green s1-контроль-чист "$CLEAN" "$DOORS"
  # Зуб 7: голое имя без пары ловится ИМЕННО им (ослепление зуба 7 даёт зелень).
  want_red   s2-зуб7-голое-имя "$CLEAN" "$pin7" 'PreToolUse'
  want_green s3-мут7-слеп-зелен "$mut7" "$pin7"
  # Зуб 8: пара форм ловится ИМЕННО им (ослепление зуба 8 даёт зелень).
  want_red   s4-зуб8-пара-форм "$CLEAN" "$pin8" 'session.session.turns'
  want_green s5-мут8-слеп-зелен "$mut8" "$pin8"
  # Обе ветви независимы: каждый зуб краснеет и при ослеплённом соседе.
  want_red   s6-зуб7-без-зуба8 "$mut8" "$pin7" 'PreToolUse'
  want_red   s7-зуб8-без-зуба7 "$mut7" "$pin8" 'session.session.turns'

  printf 'mod-event-names SELF-CHECK: проверок=%d поймано=%d провалов=%d НЕ_ИЗМЕРЕНО=%d НЕ_ПРИМЕНИЛОСЬ=%d\n' \
    "$EXPECTED_SELF" "$caught" "$fail" "$unmeas" "$unappl"
  if [ $((caught + fail + unmeas)) -ne "$EXPECTED_SELF" ]; then
    printf '  ОТКАЗ ПРИБОРА: корзины самопроверки не сходятся\n' >&2
    return 2
  fi
  [ "$unmeas" -eq 0 ] || return 1
  [ "$fail" -eq 0 ] || return 1
  return 0
}

if [ "${1:-}" = "--self-check" ]; then
  __rc=0; self_check || __rc=$?
  exit "$__rc"
fi

# 1. ПУСТО != НОЛЬ: извлекатель, переставший находить подписки (апстрим сменил
# форму вызова), обязан быть отказом прибора, а не зелёным «нарушений нет».
if [ "$n_events" -gt 0 ]; then
  ok "1 извлекатель нашёл подписки: $n_events"
else
  bad "1 извлекатель не нашёл НИ ОДНОЙ подписки -- зелень здесь была бы слепотой, а не чистотой"
fi

# 2. То же для пинованного списка: пустой список сделал бы зуб 4 вакуумным.
if [ "$n_doors" -gt 0 ] && [ -n "$ver" ] && [ -n "$sha" ]; then
  ok "2 список дверей цел: имён $n_doors, версия $ver, образ ${sha:0:12}"
else
  bad "2 список дверей пуст или без паспорта (имён=$n_doors версия=[$ver] sha=[${sha:0:12}])"
fi

# 3. Число подписок пиновано: потерянная подписка не пройдёт молча.
if [ "$n_events" -eq "$EXPECTED_EVENTS" ]; then
  ok "3 подписок $n_events при объявленных $EXPECTED_EVENTS"
else
  bad "3 подписок $n_events при объявленных $EXPECTED_EVENTS -- мод подписан не на то, что пинили"
fi

# 4. ПРЕДМЕТ: каждая подписка -- настоящая дверь головной версии.
unknown=""
while IFS= read -r e; do
  [ -z "$e" ] && continue
  in_doors "$e" || unknown="$unknown $e"
done <<< "$events"
if [ -z "$unknown" ]; then
  ok "4 все подписки -- настоящие двери $ver"
else
  bad "4 подписки вне дверей $ver:$unknown (такой хук никогда не сработает)"
fi

# 5. КРАСНЫЙ-ПЕРВЫЙ: опечатка в ПРОСТРАНСТВЕ имён. Именно её официальный
# валидатор пропускает молча -- без этого контроля зуб 4 зелен и у предиката,
# который всё принимает.
if in_doors "sesion.start"; then
  bad "5 контроль НЕ покраснел: выдуманное пространство «sesion.start» принято за дверь"
else
  ok "5 контроль: опечатка в пространстве имён дверью не считается"
fi

# 6. КРАСНЫЙ-ПЕРВЫЙ: выдуманный ГЛАГОЛ в известном пространстве. Этот случай
# ловит и апстрим, но зуб доказывает, что наш предикат сверяет ПОЛНОЕ имя, а не
# только его левую часть.
if in_doors "session.__catalyst_never_an_event__"; then
  bad "6 контроль НЕ покраснел: выдуманный глагол в известном пространстве принят за дверь"
else
  ok "6 контроль: сверяется полное имя, а не одно пространство"
fi

# 7. ГОЛОЕ ИМЯ -- отказ ФОРМЫ, а не «нарушений нет»: извлекатель подписок
# (`on("<пространство>.<глагол>"`) понимает только имя с точкой; строка без
# точки не совпадёт НИ С ОДНОЙ подпиской НИКОГДА -- мертва по построению
# (29 недостижимых строк пина 276, #336). Судится набор имён, не сырые строки
# файла.
bare=""
for d in ${dlist[@]+"${dlist[@]}"}; do
  case "$d" in *.*) ;; *) bare="$bare $d" ;; esac
done
if [ -z "$bare" ]; then
  ok "7 голых имён в наборе нет -- каждая строка достижима сверкой полного имени"
else
  bad "7 голое имя в наборе -- недостижимо извлекателем:$bare"
fi

# 8. ОДНО ИМЯ В ДВУХ ФОРМАХ: наличие и X, и <пространство>.X считает одну дверь
# дважды и рвёт констрейнт «имя в форме адресации» (#361, #356). X может быть
# составным (session.turns + session.session.turns): зуб 7 ловит только хвост
# без точки, эта пара -- работа зуба 8.
dup=""
for x in ${dlist[@]+"${dlist[@]}"}; do
  for y in ${dlist[@]+"${dlist[@]}"}; do
    case "$y" in *."$x") dup="$dup $x+$y" ;; esac
  done
done
if [ -z "$dup" ]; then
  ok "8 имя в двух формах не встречается -- одна дверь, одна форма"
else
  bad "8 одно имя в двух формах:$dup"
fi

printf '\nmod-event-names teeth: прошло=%d провалов=%d ожидалось=%d\n' "$PASS" "$FAIL" "$EXPECTED_TEETH"
if (( PASS + FAIL != EXPECTED_TEETH )); then
  printf 'ПРОВАЛ: прогнано зубов %d при объявленных %d -- прогон не тот, который пинили\n' \
    "$((PASS + FAIL))" "$EXPECTED_TEETH" >&2
  exit 1
fi
[[ $FAIL -eq 0 ]]
