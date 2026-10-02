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
EXPECTED_TEETH=16
EXPECTED_EVENTS=39
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
# CONSTRAINT: env-ручки MOD/DOORS/DOORS_TOOL существуют ТОЛЬКО для
# --self-check: копия предмета живёт во временном каталоге и не может вычислить
# ROOT от своего $0. Живой прогон (run-all) ручек не задаёт и получает деревные
# пути.
MOD="${CATALYST_MOD_FILE:-$ROOT/plugins/catalyst-probes/hooks/register.ts}"
# CONSTRAINT: пин головной версии; имя двери -- в форме адресации (#336).
DOORS="${CATALYST_DOORS_PIN:-$ROOT/tests/data/host-doors-2.1.285.txt}"
# CONSTRAINT: прибор ценза дверей -- часть репо (тесты его не исполняют,
# пин уже снят; стенд гоняет прибор только на синтетическом входе зуба 11).
DOORS_TOOL="${CATALYST_DOORS_TOOL:-$ROOT/tests/tools/host-doors.py}"

[ -f "$MOD" ] || { printf 'mod-event-names: ПРИБОР НЕДОСТУПЕН: нет %s\n' "$MOD" >&2; exit 2; }
[ -f "$DOORS" ] || { printf 'mod-event-names: ПРИБОР НЕДОСТУПЕН: нет %s\n' "$DOORS" >&2; exit 2; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }

# Имена, на которые мод ПОДПИСЫВАЕТСЯ. Форма вызова объявлена констрейнтом в
# голове самого мода: «on(event) argument is a string literal».
events="$(grep -o -E 'on\("[a-z]+\.[a-zA-Z.]+"' "$MOD" | sed -E 's/^on\("//; s/"$//' | sort -u)"
n_events="$(printf '%s\n' "$events" | grep -c . || true)"

# Пинованные двери: ПЕРВОЕ ПОЛЕ строки (имя), без заголовка, полей паспорта И
# контролей метода ценза -- CONTROL= исключается ТЕМ ЖЕ выражением, что и
# паспорт: второй фильтр ниже разнёс бы «что исключено» на два места.
# Столбцы 2/3 (класс, «в таблице плагинов») судятся зубами 9/10 по СВОИМ
# условиям; здесь нужна только колонка имени.
doors="$(grep -v -E '^#|^VERSION=|^IMAGE_SHA256=|^CONTROL=' "$DOORS" | grep -E '\S' | cut -f1 | sort -u)"
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
    ST_OUT="$(CATALYST_MOD_FILE="$MOD" CATALYST_DOORS_PIN="$2" CATALYST_DOORS_TOOL="$DOORS_TOOL" bash "$1" 2>&1)" || ST_RC=$?
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
  # (краснеет только зуб 8: зуб 7 тут молчит по построению). Иглы -- ПО ИМЕНИ
  # ДВЕРИ, не по целой строке: столбцы класса/таблицы от версии к версии
  # меняются, зуб судит только первый столбец.
  apply_mut "$DOORS" "$pin7" 'classic.PreToolUse' 'PreToolUse' \
    || { printf '  НЕ_ПРИМЕНИЛОСЬ pin7\n'; unappl=$((unappl+1)); }
  apply_mut "$DOORS" "$pin8" 'session.surface	' 'session.session.turns	' \
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
# CONSTRAINT: паспорт сверяется по форме, а не с пристиной площадки: паспорта
# образов разные по площадкам (darwin/linux), а стенд гоняется на любой из них.
# Привязку пина к образу держит перезамер host-doors.py с побайтовым cmp.
class_counts="$(awk -F'\t' 'NF==3{c[$2]++} END{printf "%d/%d/%d/%d",c["event"],c["classic"],c["method"],c["sweep"]}' "$DOORS")"
if [ "$n_doors" -eq 152 ] && [ "$ver" = "2.1.285" ] && printf '%s' "$sha" | grep -Eqx '[0-9a-f]{64}' && [ "$class_counts" = "118/33/1/0" ]; then
  ok "2 список дверей цел: doors_total=$n_doors, классы=$class_counts, версия $ver, IMAGE_SHA256=${sha:0:12}"
else
  bad "2 список дверей/паспорт: doors_total=$n_doors классы=$class_counts версия=[$ver] IMAGE_SHA256=[$sha]"
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

# 9. ДВЕРЬ-МЕТОД БЕЗ СОБЫТИЯ: ui.ask не видна событийному цензу (реестр
# событий её не содержит) -- её обязана находить таблица ноунов ядра, и в пине
# она обязана стоять классом method. Пропажа строки = метод ценза ослеп.
uaclass="$(awk -F'\t' '$1=="ui.ask"{print $2; exit}' "$DOORS")"
if [ "$uaclass" = "method" ]; then
  ok "9 ui.ask в пине класса method (дверь-метод без события)"
else
  bad "9 ui.ask в пине отсутствует или не класса method (класс=[$uaclass]) -- дверь без события потеряна"
fi

# 10. НОУН flag исключён из таблицы плагинов хоста, но дверь flag.value не
# исчезает из пина: столбец «в таблице плагинов» обязан говорить «нет» --
# «нет» и есть измеренный факт, молчаливое исчезновение -- потеря.
flagcol="$(awk -F'\t' '$1=="flag.value"{print $3; exit}' "$DOORS")"
if [ "$flagcol" = "нет" ]; then
  ok "10 flag.value в пине, в таблице плагинов: нет"
else
  bad "10 flag.value в пине отсутствует или столбец «в таблице плагинов» не «нет» (значение=[$flagcol])"
fi

# 11. ВАКУУМНЫЙ ПИН: прибор ценза на входе БЕЗ дверей-методов (ноун-таблица
# есть, все её двери покрыты реестром) обязан отказывать кодом 2 с именованной
# причиной, а не выдавать пин с пустым классом method. Синтетический вход
# собирается здесь же -- прибора без входа не бывает.
INSTRUMENT="$DOORS_TOOL"
SYN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/modnames-syn.XXXXXX")" || exit 2
trap 'rm -rf "$SYN_DIR"' EXIT
SYN="$SYN_DIR/image"
cat > "$SYN" <<'EOSYN'
var jm=["Stop"];var iKn=jm;var Xe=iKn.map((e)=>`classic.${e}`);
var $pn=["model.complete","flag.value"];var UFt=[...Xe,"session.start",...$pn];
var cx=(e)=>qh({value:(t,o)=>e("flag.value",{name:t,fallback:o})});
var zc=(e)=>qh({value:()=>e("zz.value")});
var ux="flag";var YMo=()=>!1;var lx=(e)=>e!==ux||YMo();
function Jn({pluginName:e,host:t}){let m=(c)=>gx(c,p);return{flag:m(cx(t)),zz:m(zc(t))}}
function Kp(){let e={},t=Jn({pluginName:"core",host:t2});for(let[o,r]of Object.entries(t))e[o]=Object.freeze(Object.keys(r));return Object.freeze(e)}var Wp=Kp();
function tKn(){let e={};for(let[t,o]of Object.entries(Wp))if(lx(t))e[t]={owner:zye,methods:[...o]};return e}
EOSYN
if [ ! -f "$INSTRUMENT" ]; then
  printf 'mod-event-names: нет прибора %s\n' "$INSTRUMENT" >&2
  exit 2
fi
cp "$SYN" "$SYN_DIR/vacuum"
substitute "$SYN_DIR/vacuum" '"model.complete","flag.value"' '"model.complete","flag.value","zz.value"' || exit 2
syn_rc=0
syn_out="$(python3 "$INSTRUMENT" "$SYN_DIR/vacuum" --version synthetic --prev none 2>&1)" || syn_rc=$?
if [ "$syn_rc" -eq 2 ] && printf '%s' "$syn_out" | grep -qF 'method-дверей 0'; then
  ok "11 прибор отказал на входе без method-дверей: rc=2, причина названа"
else
  bad "11 прибор на входе без method-дверей: rc=$syn_rc (ждали 2 с «method-дверей 0») [$syn_out]"
fi

# CONSTRAINT: две позиции balanced() представлены отдельно; grep считает
# также определение refuse(), поэтому число строк на единицу больше веток.
cat > "$SYN_DIR/refusals.tsv" <<'EOREFUSALS'
balanced-classic	["Stop"]	["Stop"	скобки не сбалансированы
balanced-noun	zz:m(zc(t))}}	zz:m(zc(t))}	скобки не сбалансированы
noun-anchor	Jn({pluginName:"core"	Jn({pluginName:"other"	якорь таблицы ноунов
noun-definition	function Jn({pluginName	function Other({pluginName	определение сборки ноунов
noun-returns	return{flag:m(cx(t))	return{};return{flag:m(cx(t))	больше одного верхнего return
noun-return-missing	return{flag:m(cx(t))	yield{flag:m(cx(t))	нет верхнего return
noun-entry	zz:m(zc(t))	zz:zc(t)	запись таблицы ноунов не формы
noun-wrapper	zz:m(zc(t))	zz:n(zc(t))	обёртка записей таблицы ноунов не одна
noun-count	,zz:m(zc(t))	 	в таблице ноунов меньше двух записей
noun-freeze	Object.freeze(Object.keys(r))	Object.seal(Object.keys(r))	след таблицы методов
factory-tie	var zc=(e)=>qh({value:()=>e("zz.value")});	var zc=(e)=>{qh({value:()=>e("zz.value")});qh({other:()=>e("zz.other")})};	два кандидата с равным счётом
noun-empty	var zc=(e)=>qh({value:()=>e("zz.value")});	var zc=(e)=>qh({value:()=>e("other.value")});	ноун zz: методы не измерены
plugin-builder	if(lx(t))e[t]={owner:zye,methods:[...o]}	if(lx(t))e[t]={other:zye,methods:[...o]}	строитель таблицы ноунов плагина
plugin-filter	var YMo=()=>!1	var YMo=()=>false	фильтр таблицы ноунов плагина lx не распознан
registry-head	iKn.map((e)=>`classic.${e}`)	iKn.map((e)=>`other.${e}`)	голова реестра
classic-alias	var jm=["Stop"]	var other=["Stop"]	цепочка алиасов классик-массива оборвана
classic-array	var jm=["Stop"];var iKn=jm;	var jm=iKn;var iKn=jm;	классик-массив не найден
classic-empty	["Stop"]	[]	classic-массив пуст
g-missing	["model.complete","flag.value"]	["other.complete","flag.value"]	G-массив не найден
g-empty	var $pn=["model.complete","flag.value"]	var $pn=[];var $pn=["model.complete","flag.value"]	G-массив пуст
hst-spread	...$pn]	...other]	hSt-список
hst-start	var UFt=[...Xe,	var UFt=[`x`,...Xe,	начало hSt-списка
tmpl-elem	var jm=["Stop"]	var jm=["Stop",`Go`]	шаблонный литерал в списке имён
hst-empty	...Xe,"session.start",...$pn	...Xe,...$pn	литералы hSt-списка пусты
method-vacuum	"model.complete","flag.value"	"model.complete","flag.value","zz.value"	method-дверей 0
prev-loss	var zc=(e)=>qh({value:()=>e("zz.value")});	var zc=(e)=>qh({changed:()=>e("zz.changed")});	двери пропали: zz.value
EOREFUSALS
refusal_rows="$(wc -l < "$SYN_DIR/refusals.tsv")"
refusal_sites="$(grep -c 'refuse(' "$INSTRUMENT")"
usage_sites="$(grep -c 'refuse(.*применение' "$INSTRUMENT" || true)"
refusal_expected=$((refusal_sites - usage_sites))
printf '12 ветки отказа: строки=%d refuse=%d применение=%d ожидалось=%d\n' "$refusal_rows" "$refusal_sites" "$usage_sites" "$refusal_expected"
refusal_fail=0
[ "$refusal_rows" -eq "$refusal_expected" ] || refusal_fail=$((refusal_fail+1))
base_rc=0
python3 "$INSTRUMENT" "$SYN" --version synthetic --prev none > "$SYN_DIR/prev" 2> "$SYN_DIR/base.err" || base_rc=$?
if [ "$base_rc" -ne 0 ]; then
  printf 'mod-event-names: синтетический контроль rc=%d\n' "$base_rc" >&2
  cat "$SYN_DIR/base.err" >&2
  exit 2
fi
while IFS=$'\t' read -r id old new reason; do
  cp "$SYN" "$SYN_DIR/mutant"
  if ! substitute "$SYN_DIR/mutant" "$old" "$new"; then
    printf 'mod-event-names: строка отказа %s: замена не однозначна\n' "$id" >&2
    exit 2
  fi
  row_rc=0
  python3 "$INSTRUMENT" "$SYN_DIR/mutant" --version synthetic --prev "$SYN_DIR/prev" > "$SYN_DIR/row.out" 2> "$SYN_DIR/row.err" || row_rc=$?
  if [ "$row_rc" -eq 2 ] && grep -qF "$reason" "$SYN_DIR/row.err"; then
    printf '  refusal %s: rc=%d причина=%s\n' "$id" "$row_rc" "$reason"
  else
    printf '  ПРОВАЛ refusal %s: rc=%d ожидалось=2 причина=%s\n' "$id" "$row_rc" "$reason"
    cat "$SYN_DIR/row.err"
    refusal_fail=$((refusal_fail+1))
  fi
done < "$SYN_DIR/refusals.tsv"
if [ "$refusal_fail" -eq 0 ]; then
  ok "12 все строки веток отказа: $refusal_rows/$refusal_expected"
else
  bad "12 ветки отказа: провалов=$refusal_fail строки=$refusal_rows/$refusal_expected"
fi

# CONSTRAINT: кавычки не мешают границе имени; комментарии и README не потребители.
mkdir -p "$SYN_DIR/repo/plugins"
cat > "$SYN_DIR/usage.pin" <<'EOUSAGEPIN'
classic.PostToolUse	event	—
classic.PostToolUseFailure	event	—
engine.create	event	—
session.surface	event	—
session.surfaces	event	—
EOUSAGEPIN
printf 'engine.create\n' > "$SYN_DIR/repo/plugins/README.md"
cat > "$SYN_DIR/repo/plugins/a.ts" <<'EOUSAGE'
  // "engine.create"
  /* "engine.create"
  * "engine.create"
const a = "classic.PostToolUseFailure";
const b = "session.surfaces";
const c = "xengine.create";
const d = "$engine.create";
const e = "engine.create$";
const f = "engine.create";
EOUSAGE
printf 'const z = "engine.create";\n' > "$SYN_DIR/repo/plugins/z.ts"
usage_rc=0
python3 "$INSTRUMENT" --usage "$SYN_DIR/usage.pin" "$SYN_DIR/repo" > "$SYN_DIR/usage.out" 2> "$SYN_DIR/usage.err" || usage_rc=$?
if [ "$usage_rc" -eq 0 ] && grep -qxF '| classic.PostToolUse | event | — | 0 |' "$SYN_DIR/usage.out" && grep -qxF '| session.surface | event | — | 0 |' "$SYN_DIR/usage.out" && grep -qxF '| classic.PostToolUseFailure | event | — | plugins/a.ts:4 |' "$SYN_DIR/usage.out" && grep -qxF '| session.surfaces | event | — | plugins/a.ts:5 |' "$SYN_DIR/usage.out" && grep -qxF '| engine.create | event | — | plugins/a.ts:9 |' "$SYN_DIR/usage.out" && grep -qxF 'без потребителя: 2 из 5' "$SYN_DIR/usage.out"; then
  ok "13 USAGE: границы, кавычки, суффиксы, комментарии, порядок"
else
  bad "13 USAGE: rc=$usage_rc"
  cat "$SYN_DIR/usage.out" "$SYN_DIR/usage.err"
fi

cli_fail=0
for invalid in missing-prev dangling-out unknown extra duplicate-version; do
  case "$invalid" in
    missing-prev) args=("$SYN" --version synthetic) ;;
    dangling-out) args=("$SYN" --version synthetic --prev none --out) ;;
    unknown) args=("$SYN" --version synthetic --prev none --unknown x) ;;
    extra) args=("$SYN" --version synthetic --prev none extra) ;;
    duplicate-version) args=("$SYN" --version synthetic --prev none --version other) ;;
  esac
  cli_rc=0
  python3 "$INSTRUMENT" "${args[@]}" > "$SYN_DIR/cli.out" 2> "$SYN_DIR/cli.err" || cli_rc=$?
  if [ "$cli_rc" -ne 2 ] || ! grep -qF 'применение:' "$SYN_DIR/cli.err"; then
    printf '  ПРОВАЛ применение %s: rc=%d\n' "$invalid" "$cli_rc"
    cat "$SYN_DIR/cli.err"
    cli_fail=$((cli_fail+1))
  fi
done
if [ "$cli_fail" -eq 0 ]; then
  ok "14 применение: 5/0"
else
  bad "14 применение: провалов=$cli_fail"
fi

# CONSTRAINT: каждый лексический контекст имеет дверь после него;
# отказ или отсутствие именно этой двери краснит именованную строку.
cat > "$SYN_DIR/lexer.tsv" <<'EOLEXER'
tmpl	var zc=(e)=>qh({tmpl:()=>{const a=`outer ${[`The user's } text`]}`;return e("zz.tmpl")}});
escaped-tmpl	var zc=(e)=>qh({escaped:()=>{const a=`outer ${`a\`' } b`}`;return e("zz.escaped")}});
regex	var zc=(e)=>qh({regex:()=>{const a=/[`]/;return e("zz.regex")}});
kw	var zc=(e)=>qh({kw:()=>{function f(){return /[`]/}return e("zz.kw")}});
division	var zc=(e)=>qh({a:w/2,division:()=>e("zz.division"),b:w/2});
block	var zc=(e)=>qh({block:()=>{if(x){} /[`]/.test(x);return e("zz.block")}});
interp	var zc=(e)=>qh({interp:()=>{const a=tag`outer ${ /[`]/ }`;return e("zz.interp")}});
header	var zc=(e)=>qh({header:()=>{if(x)/[`]/.test(x);return e("zz.header")}});
span	var zc=(e)=>{const a=/[``}]/;return qh({span:()=>e("zz.span")})};
lit-tmpl	var zc=(e)=>qh({t:`a`/a,littmpl:()=>e("zz.littmpl")/1});
lit-str	var zc=(e)=>qh({s:"a"/a,litstr:()=>e("zz.litstr")/1});
lit-regex	var zc=(e)=>qh({r:/a/g/a,litregex:()=>e("zz.litregex")/1});
iopen	var zc=(e)=>qh({i:`${ {a:1}/2 }`,iopen:()=>e("zz.iopen")});
asi	var zc=(e)=>qh({f:()=>{x="a"@CR@{}/[)]/.test(y)},asi:()=>e("zz.asi")});
EOLEXER
lexer_rows="$(wc -l < "$SYN_DIR/lexer.tsv")"
lexer_fail=0
while IFS=$'\t' read -r id factory; do
  # CONSTRAINT: перевод строки в ряду пишется меткой @CR@: сырой CR в файле
  # стенда рвёт строку ряда при копировании самопроверкой.
  factory="${factory//@CR@/$'\r'}"
  cp "$SYN" "$SYN_DIR/lexer-image"
  substitute "$SYN_DIR/lexer-image" 'var zc=(e)=>qh({value:()=>e("zz.value")});' "$factory" || exit 2
  lexer_rc=0
  python3 "$INSTRUMENT" "$SYN_DIR/lexer-image" --version synthetic --prev none > "$SYN_DIR/lexer.out" 2> "$SYN_DIR/lexer.err" || lexer_rc=$?
  door="$(printf '%s' "$factory" | grep -oE 'zz\.[a-z]+' | sort -u)"
  if [ "$lexer_rc" -eq 0 ] && grep -qF "$door"$'\tmethod\t' "$SYN_DIR/lexer.out"; then
    printf '  lexer %s: rc=0 дверь=%s\n' "$id" "$door"
  else
    printf '  ПРОВАЛ lexer %s: rc=%d дверь=%s\n' "$id" "$lexer_rc" "$door"
    cat "$SYN_DIR/lexer.err"
    lexer_fail=$((lexer_fail+1))
  fi
done < "$SYN_DIR/lexer.tsv"
if [ "$lexer_fail" -eq 0 ] && [ "$lexer_rows" -eq 14 ]; then
  ok "15 лексер: 14/0"
else
  bad "15 лексер: провалов=$lexer_fail строк=$lexer_rows/14"
fi

# CONSTRAINT: литералы массивов и обратный ход hSt-списка читаются лексером:
# кавычка другого вида и ] внутри строки не сдвигают глубину.
cat > "$SYN_DIR/lists.tsv" <<'EOLISTS'
classic-quotes	var jm=["Stop"]	var jm=["Stop",'a"b','Go']	classic.Go	classic
hst-string	var UFt=[...Xe,	var UFt=["x]","hook.only",...Xe,	hook.only	event
classic-regex	var jm=["Stop"]	var jm=["Stop",/"/,"Go"]	classic.Go	classic
EOLISTS
lists_fail=0
while IFS=$'\t' read -r id old new door class; do
  cp "$SYN" "$SYN_DIR/lists-image"
  substitute "$SYN_DIR/lists-image" "$old" "$new" || exit 2
  lists_rc=0
  python3 "$INSTRUMENT" "$SYN_DIR/lists-image" --version synthetic --prev none > "$SYN_DIR/lists.out" 2> "$SYN_DIR/lists.err" || lists_rc=$?
  if [ "$lists_rc" -eq 0 ] && grep -qF "$door"$'\t'"$class"$'\t' "$SYN_DIR/lists.out"; then
    printf '  lists %s: rc=0 дверь=%s\n' "$id" "$door"
  else
    printf '  ПРОВАЛ lists %s: rc=%d дверь=%s\n' "$id" "$lists_rc" "$door"
    cat "$SYN_DIR/lists.err"
    lists_fail=$((lists_fail+1))
  fi
done < "$SYN_DIR/lists.tsv"
lists_rows="$(wc -l < "$SYN_DIR/lists.tsv")"
if [ "$lists_fail" -eq 0 ] && [ "$lists_rows" -eq 3 ]; then
  ok "16 списки: 3/0"
else
  bad "16 списки: провалов=$lists_fail строк=$lists_rows/3"
fi

printf '\nmod-event-names teeth: прошло=%d провалов=%d ожидалось=%d\n' "$PASS" "$FAIL" "$EXPECTED_TEETH"
if (( PASS + FAIL != EXPECTED_TEETH )); then
  printf 'ПРОВАЛ: прогнано зубов %d при объявленных %d -- прогон не тот, который пинили\n' \
    "$((PASS + FAIL))" "$EXPECTED_TEETH" >&2
  exit 1
fi
[[ $FAIL -eq 0 ]]
