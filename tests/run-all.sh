#!/usr/bin/env bash
# Агрегатор стендов семьи: исполняет ТОЛЬКО названные по --scope стенды из
# маски tests/scripts/test-*.sh плюс scripts/lint.py, и печатает сводку.
#
# CONSTRAINT: без scope ничего не запускается, ключа «всё» нет -- правка одного
# куска запускает проверку только этой части (слово юзера 26.09). Режимы ровно
# два: --scope <имя>[,<имя>…] и --list.
#
# CONSTRAINT: список стендов НЕ хардкодируется -- новый стенд подхватывается сам,
# а взамен работает гейт числа: автообнаружение ловит ДОБАВЛЕННЫЙ стенд, но не
# ловит исчезнувший -- исчезнувший неотличим от «его и не было». Расхождение
# с объявленным числом в любую сторону -- rc=2 («прибор не может мерить»,
# а не «дерево красно»).
#
# CONSTRAINT: пин сверяется с ОТСЛЕЖИВАЕМЫМ набором, а исполняется всё, что
# лежит на диске. Клон получает только отслеживаемое -- его и защищает число.
# Счёт по диску останавливал ЛЮБОЙ коммит в репозитории, пока соседняя дорожка
# держала свой новый стенд незакоммиченным: параллельные дорожки блокировали
# друг друга через общий пин. Нетронутый стенд обязан быть ВИДЕН в выводе, но
# не имеет права краснить чужой коммит; отслеживаемый, пропавший с диска, --
# наоборот, отказ прибора: исполнить его нечем.
#
# CONSTRAINT: без git (прогон идёт из СНИМКА, а кит едет копированием без .git)
# сверяется диск -- прежнее поведение. Режим счёта НАЗЫВАЕТСЯ в каждой строке
# отказа: «сошлось» в двух разных режимах означает разное, и читать их как одно
# нельзя.
#
# CONSTRAINT: lint.py идёт отдельной строкой ВНЕ счёта стендов (гейт числа --
# про маску), но входит в зелёные/красные своды и в код возврата: красный линт
# не имеет права быть невидимым в сводке. В scope lint -- имя как у стендов
# (заглушка в зубах подставляется тем же путём scripts/lint.py).
set -u
export LC_ALL=C

EXPECTED_STANDS=16

refuse() {   # <причина>: отказ ПРИБОРА до единого запуска
  printf 'run-all: ОТКАЗ SCOPE: %s\n' "$1"
  exit 2
}

if [ "${CATALYST_STANDS:-}" = "off" ]; then
  printf 'CATALYST_STANDS=off: прогон стендов ПРОПУЩЕН по явной ручке\n'
  exit 0
fi

instrument_refuse() {   # <причина>: отказ ПРИБОРА (rc 2 -- «не может мерить»)
  printf 'run-all: ОТКАЗ ПРИБОР: %s\n' "$1"
  exit 2
}

HERE="$(cd "$(dirname "$0")" && pwd)" || instrument_refuse "каталог агрегатора не открывается: $(dirname "$0")"
ROOT="$(cd "$HERE/.." && pwd)" || instrument_refuse "корень дерева не открывается: $HERE/.."
cd "$ROOT" || instrument_refuse "cd в корень дерева отказ: $ROOT"

# CONSTRAINT: массив бывает пуст (nullglob); раскрытие без проверки счёта -- только ${stands[@]+"${stands[@]}"}: bash < 4.4 (/bin/bash 3.2 площадки коммита) под set -u роняет пустой "${stands[@]}" в unbound variable с rc 1 вместо отказа rc 2.
shopt -s nullglob
stands=(tests/scripts/test-*.sh)
shopt -u nullglob

# --- разбор аргументов: режимы ровно два, всё прочее -- отказ -----------------
MODE=""
SCOPE_RAW=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list)
      [ -z "$MODE" ] || refuse "любой иной аргумент: --list при уже заданном режиме"
      MODE=list
      ;;
    --scope=*)
      refuse "--scope= не принимается ни в каком виде: значение даётся отдельным словом ($1)"
      ;;
    --scope)
      [ "$MODE" = "scope" ] && refuse "повтор ключа --scope"
      [ -z "$MODE" ] || refuse "любой иной аргумент: --scope вместе с --list"
      MODE=scope
      shift
      [ $# -gt 0 ] || refuse "--scope без значения"
      SCOPE_RAW="$1"
      ;;
    *)
      refuse "любой иной аргумент: $1"
      ;;
  esac
  shift
done
[ -n "$MODE" ] || refuse "без аргументов -- нужен --scope <имя>[,<имя>…] или --list"

stand_name() {   # <путь tests/scripts/test-<x>.sh> -> x
  local b="${1##*/}"
  b="${b#test-}"
  printf '%s' "${b%.sh}"
}

# --- валидация имён: разбор ЦИКЛОМ, а не read -a --------------------------------
# CONSTRAINT: read -a молча роняет хвостовое пустое поле («a,» -> [a]) -- отказ
# за пустое имя обязан срабатывать в ЛЮБОЙ позиции, включая последнюю (Ф8).
# Имя обязано соответствовать ^[a-z0-9._-]+$: дальше оно попадает в пути и в
# аргументы агрегатора (Ф7).
valid_stand_name() {   # ^[a-z0-9._-]+$
  case "$1" in
    ''|*[!a-z0-9._-]*) return 1 ;;
  esac
  return 0
}

SCOPE_SEL=""
if [ "$MODE" = "scope" ]; then
  # CONSTRAINT: пустое значение -- тоже пустое имя: молчаливый «прогон ничего»
  # читался бы как зелёный, а на bash 3.2 пустой список ещё и роняет set -u.
  [ -n "$SCOPE_RAW" ] || refuse "пустое имя в списке scope: «$SCOPE_RAW»"
  rest="$SCOPE_RAW"
  last=""
  while :; do
    case "$rest" in
      *,*) r="${rest%%,*}"; rest="${rest#*,}" ;;
      *)   r="$rest"; rest=""; last=1 ;;
    esac
    [ -n "$r" ] || refuse "пустое имя в списке scope: «$SCOPE_RAW»"
    valid_stand_name "$r" || refuse "недопустимое имя: $r"
    known=0
    [ "$r" = "lint" ] && known=1
    if [ "$known" = 0 ]; then
      for s in ${stands[@]+"${stands[@]}"}; do
        [ "$(stand_name "$s")" = "$r" ] && known=1
      done
    fi
    [ "$known" = 1 ] || refuse "неизвестное имя: $r"
    case ",$SCOPE_SEL," in *",$r,"*) ;; *) SCOPE_SEL="$SCOPE_SEL,$r" ;; esac
    if [ -n "$last" ]; then
      break
    fi
  done
  SCOPE_SEL="${SCOPE_SEL#,}"
fi

# Отслеживаемый набор. Ошибка git не глушится: её первая строка называется
# в строке режима, иначе откат на диск выглядел бы штатным.
# CONSTRAINT: git-ветка -- только если ROOT сам корень репозитория (toplevel ==
# ROOT после cd -P): снимок внутри ЧУЖОГО репозитория отдал бы чужой (пустой)
# отслеживаемый набор, и гейт числа краснел бы на исправном снимке.
TRACKED_LIST=""
TRACKED_N=""
GIT_WHY=""
ROOT_P="$(cd -P "$ROOT" && pwd)"
if TOPL="$(git -C "$ROOT" rev-parse --show-toplevel 2>&1)"; then
  TOPL_P="$(cd -P "$TOPL" 2>/dev/null && pwd)"
  if [ "$TOPL_P" != "$ROOT_P" ]; then
    GIT_WHY="корень репозитория $TOPL -- не корень прогона $ROOT_P"
  elif GIT_OUT="$(git -C "$ROOT" ls-files -- 'tests/scripts/test-*.sh' 2>&1)"; then
    TRACKED_LIST="$GIT_OUT"
    if [ -z "$GIT_OUT" ]; then
      TRACKED_N=0
    else
      # CONSTRAINT: код КАЖДОГО члена конвейера: пустой счёт отказавшего wc/tr
      # уводил в счёт по диску, и неотслеживаемый стенд соседней дорожки
      # закрывал пропажу отслеживаемого.
      TRACKED_N="$(printf '%s\n' "$GIT_OUT" | wc -l | tr -d ' '; p=("${PIPESTATUS[@]}"); [ "${p[0]}" -eq 0 ] && [ "${p[1]}" -eq 0 ] && [ "${p[2]}" -eq 0 ])" \
        || instrument_refuse "счёт отслеживаемых стендов (wc/tr) отказ"
    fi
  else
    GIT_WHY="$(printf '%s' "$GIT_OUT" | head -1)"
  fi
else
  GIT_WHY="$(printf '%s' "$TOPL" | head -1)"
fi

if [ -n "$TRACKED_N" ]; then
  COUNT_MODE="отслеживаемых"
  COUNT_N="$TRACKED_N"
else
  COUNT_MODE="на диске (git не ответил: ${GIT_WHY:-причина не названа})"
  COUNT_N="${#stands[@]}"
fi

if [ "$COUNT_N" -ne "$EXPECTED_STANDS" ]; then
  printf 'run-all: ЧИСЛО_СТЕНДОВ_НЕ_СОШЛОСЬ: по маске tests/scripts/test-*.sh ожидалось %s, %s найдено %s\n' "$EXPECTED_STANDS" "$COUNT_MODE" "$COUNT_N"
  if [ -n "$TRACKED_LIST" ]; then
    printf '%s\n' "$TRACKED_LIST" | while IFS= read -r s; do
      [ -n "$s" ] && printf '  отслеживается: %s\n' "$s"
    done
  fi
  if [ "${#stands[@]}" -gt 0 ]; then
    for s in "${stands[@]}"; do
      printf '  на диске: %s\n' "$s"
    done
  fi
  exit 2
fi

# Отслеживаемый, но пропавший с диска -- отказ ПРИБОРА: исполнить его нечем,
# и молчание здесь читалось бы как «стенд зелён».
if [ -n "$TRACKED_LIST" ]; then
  MISSF=$(mktemp "${TMPDIR:-/tmp}/runall-missing.XXXXXX") || instrument_refuse "mktemp отказ"
  trap 'rm -f "$MISSF"' EXIT
  # CONSTRAINT: код КАЖДОГО члена конвейера и код чтения: пустой список пропавших
  # от отказа записи или чтения читался бы «пропавших нет». Тело цикла кончается
  # кодом 0 на присутствующем стенде: его код -- код цикла.
  printf '%s\n' "$TRACKED_LIST" | while IFS= read -r s; do
    if [ -n "$s" ] && [ ! -f "$s" ]; then
      printf '  пропал с диска: %s\n' "$s" || exit 1
    fi
  done > "$MISSF"
  p=("${PIPESTATUS[@]}"); [ "${p[0]}" -eq 0 ] && [ "${p[1]}" -eq 0 ] \
    || instrument_refuse "список пропавших с диска не построен"
  MISSING="$(cat "$MISSF")" || instrument_refuse "список пропавших с диска не прочитан"
  rm -f "$MISSF"
  trap - EXIT
  if [ -n "$MISSING" ]; then
    printf 'run-all: СТЕНД_ПРОПАЛ_С_ДИСКА: отслеживаемый стенд не найден, исполнить нечем\n'
    printf '%s\n' "$MISSING"
    exit 2
  fi
fi

# Нетронутый стенд соседней дорожки: ВИДЕН и ИСПОЛНЯЕТСЯ, но пина не двигает.
if [ -n "$TRACKED_LIST" ] && [ "${#stands[@]}" -gt 0 ]; then
  for s in "${stands[@]}"; do
    if ! printf '%s\n' "$TRACKED_LIST" | grep -Fxq -- "$s"; then
      printf 'run-all: НЕОТСЛЕЖИВАЕМЫЙ СТЕНД (исполняется, пина не двигает): %s\n' "$s"
    fi
  done
fi

if [ "$MODE" = "list" ]; then
  # CONSTRAINT: --list ничего не исполняет: список -- ответ на вопрос «что есть»,
  # а не прогон; lint печатается ПОСЛЕДНИМ, как и в порядке исполнения scope.
  # CONSTRAINT: код КАЖДОГО члена конвейера: отказ sort давал бы список из одного
  # lint с rc 0 -- «стендов нет».
  for s in ${stands[@]+"${stands[@]}"}; do
    stand_name "$s"
    printf '\n'
  done | sort
  p=("${PIPESTATUS[@]}"); [ "${p[0]}" -eq 0 ] && [ "${p[1]}" -eq 0 ] \
    || instrument_refuse "sort списка --list отказ"
  printf 'lint\n'
  exit 0
fi

green=0
red=0
unmeasured=0
# CONSTRAINT: код 3 -- «НЕ ИЗМЕРЕНО»: прибор исправен, но его предмет в этом
# прогоне не мерился (опт-ин не включён -- например, приёмка, тратящая токены).
# Без отдельной категории такой прогон печатался бы как `ok`, и НЕИЗМЕРЕННАЯ
# приёмка выглядела бы пройденной -- ровно тот молчаливый пропуск, против
# которого заведены сами приёмки. Дверь коммита он не краснит, но в сводке
# виден отдельным числом и своим выводом.
run_one() {   # <метка> <команда...>: зелёный -- одной строкой, красный -- дословно
  local label="$1"; shift
  local out rc
  out=$("$@" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    green=$((green+1))
    printf 'ok   %s\n' "$label"
  elif [ "$rc" -eq 3 ]; then
    unmeasured=$((unmeasured+1))
    printf 'НЕ ИЗМЕРЕНО %s:\n%s\n' "$label" "$out"
  else
    red=$((red+1))
    printf 'КРАСЕН %s (rc=%s):\n%s\n' "$label" "$rc" "$out"
  fi
}

# CONSTRAINT: исполнение идёт в порядке СОРТИРОВКИ имён, lint -- последним:
# порядок перечисления в --scope не меняет порядок прогона. Счётчики живут в
# ЭТОЙ оболочке: итерация по here-string, не по пайпу.
sel_stands=0
sel_lint=0
# CONSTRAINT: код КАЖДОГО члена конвейера: отказ sort давал пустой выбор -- ноль
# исполненных стендов и rc 0.
sorted_sel="$(printf '%s\n' ${SCOPE_SEL//,/ } | sort -u; p=("${PIPESTATUS[@]}"); [ "${p[0]}" -eq 0 ] && [ "${p[1]}" -eq 0 ])" \
  || instrument_refuse "sort выбранного scope отказ"
while IFS= read -r n; do
  [ -n "$n" ] || continue
  [ "$n" = "lint" ] && continue
  run_one "tests/scripts/test-$n.sh" bash "tests/scripts/test-$n.sh"
  sel_stands=$((sel_stands+1))
done <<< "$sorted_sel"
case ",$SCOPE_SEL," in
  *,lint,*) run_one scripts/lint.py python3 scripts/lint.py; sel_lint=1 ;;
esac

# CONSTRAINT: знаменатель сводки -- НАЗВАННЫЕ ПРИБОРЫ (выбранные стенды плюс
# линт, если назван), а не все стенды дерева: сводка описывает ЭТОТ прогон.
printf 'run-all: приборов %s (стендов %s + линт %s), зелёных %s, красных %s, НЕ ИЗМЕРЕНО %s, scope=%s\n' \
  "$(( sel_stands + sel_lint ))" "$sel_stands" "$sel_lint" "$green" "$red" "$unmeasured" "$SCOPE_SEL"
[ "$red" -eq 0 ] || exit 1
exit 0
