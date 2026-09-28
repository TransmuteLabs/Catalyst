#!/usr/bin/env bash
# Единственный дом сопоставления «путь коммита -> стенды»: карту читают и хук
# (.githooks/pre-commit), и производитель свидетеля (tests/run-witness.sh);
# копий логики сопоставления нет нигде.
#
# CONSTRAINT: карта -- tests/stand-map.tsv; строка «<путь-или-префикс><TAB><стенды
# через запятую | ->»; ключ, кончающийся на «/», -- ПРЕФИКС, иначе ТОЧНЫЙ путь;
# «-» -- «объявлено: ни один стенд не мерит» (путь покрыт, стендов нет); строки
# «#» -- комментарии. Вне таблицы действует вычисляемое правило:
# tests/scripts/test-<x>.sh -> <x>. Путь без единого совпадения -- НЕ ПОКРЫТ.
#
# CONSTRAINT: имя стенда (в карте и вычисленное) обязано соответствовать
# ^[a-z0-9._-]+$ -- имя дальше попадает в пути, в аргументы агрегатора и в
# удалённую команду свидетеля; имя вне списка -- ошибка КАРТЫ, а не «не покрыт».
#
# CONSTRAINT: карта проверяется ЦЕЛИКОМ на каждом вызове: имя стенда, под
# которым нет tests/scripts/test-<x>.sh и которое не lint, -- дефект карты
# (rc 4), а не тихий пропуск строки: карта, которая ссылается в никуда,
# не может объявлять покрытие.
#
# CONSTRAINT: коды возврата делятся по вине: rc 2 -- ТОЛЬКО «путь не покрыт
# картой»; rc 4 -- карта негодна (нет в индексе/HEAD или на диске, пустой список,
# недопустимое или неизвестное имя стенда); rc 3 -- прибор не мерил (отказ git,
# чтения или cd; ошибка аргументов): подмена «не покрыт» отказом прибора
# закрывала бы дыры карты отказами среды, а дефект карты -- не дыра покрытия.
#
# CONSTRAINT: --map-rev HEAD (только с --staged) читает карту из HEAD, staged-пути
# и файлы стендов -- по-прежнему из индекса; --skip-uncovered (только с --staged)
# молчит о непокрытом пути: покрытие решает индексная карта, а в HEAD-карте нет
# строк для новых путей коммита. Так зовёт дверь и свидетель HEAD-копию
# сопоставителя, чей scope объединяется с индексным.
#
# CONSTRAINT: --staged читает ИНДЕКС ВЫЗЫВАЮЩЕГО (git diff --cached): в хуке
# это индекс коммита, при `git commit --only/--include` -- временный индекс
# через GIT_INDEX_FILE; окружение НЕ счищается. Свидетель для временного
# индекса производится явно: bash tests/run-witness.sh --tree <T> --scope <S>,
# где T -- дерево этого индекса (git write-tree под тем же GIT_INDEX_FILE).
#
# CONSTRAINT: staged-пути читаются в NUL-режиме (--name-status -z): без -z git
# кавычит не-ASCII пути (core.quotePath), и кавыченный путь не матчится ни
# префиксом, ни правилом -- «НЕ ПОКРЫТ» без лекарства. Путь со статусом D не
# порождает имени по вычисляемому правилу, а имя, файла которого нет в индексе,
# выбрасывается с объявлением в stderr: удалённый этим коммитом стенд не зовётся.
set -u
export LC_ALL=C

fail4() {   # вина карты: rc 4
  printf 'stand-scope: %s\n' "$1" >&2
  exit 4
}
fail_args() {   # ошибка аргументов: rc 3
  printf 'stand-scope: ОТКАЗ АРГУМЕНТЫ: %s\n' "$1" >&2
  exit 3
}
fail3() {   # вина прибора: git/чтение/cd отказали, rc 3
  printf 'stand-scope: ОТКАЗ ПРИБОР: %s\n' "$1" >&2
  exit 3
}

HERE="$(cd "$(dirname "$0")" && pwd)" || fail3 "каталог стенда не открывается: $(dirname "$0")"
ROOT="$(cd "$HERE/.." && pwd)" || fail3 "корень дерева не открывается: $HERE/.."
MAP="$ROOT/tests/stand-map.tsv"

valid_stand_name() {   # ^[a-z0-9._-]+$
  case "$1" in
    ''|*[!a-z0-9._-]*) return 1 ;;
  esac
  return 0
}

MODE=""
PATHS_FILE=""
MAP_REV=""
SKIP_UNCOVERED=0
# CONSTRAINT: интерфейс `--staged --map-rev HEAD --skip-uncovered` стабилен: коммит, меняющий его, обязан принимать прежние опции -- иначе HEAD-проход двери отказывает на нём.
while [ $# -gt 0 ]; do
  case "$1" in
    --staged)
      [ -z "$MODE" ] || fail_args "режим уже задан ($MODE), повтор: $1"
      MODE=staged
      ;;
    --paths)
      [ -z "$MODE" ] || fail_args "режим уже задан ($MODE), повтор: $1"
      MODE=paths
      shift
      [ $# -gt 0 ] || fail_args "--paths без значения"
      PATHS_FILE="$1"
      ;;
    --map-rev)
      shift
      [ $# -gt 0 ] || fail_args "--map-rev без значения"
      [ "$1" = "HEAD" ] || fail_args "--map-rev: допустимо только HEAD, дано: $1"
      MAP_REV=HEAD
      ;;
    --skip-uncovered)
      SKIP_UNCOVERED=1
      ;;
    *)
      fail_args "неизвестный аргумент: $1"
      ;;
  esac
  shift
done
[ -n "$MODE" ] || fail_args "нужен ровно один режим: --staged | --paths <файл>"
if [ "$MODE" != "staged" ]; then
  [ -z "$MAP_REV" ] || fail_args "--map-rev допустим только вместе с --staged"
  [ "$SKIP_UNCOVERED" = 0 ] || fail_args "--skip-uncovered допустим только вместе с --staged"
fi

# CONSTRAINT: в staged-режиме карта терпит имя стенда, удаляемого ЭТИМ коммитом:
# файл уже нет ни на диске, ни в индексе, но это не «карта ссылается в никуда»,
# а штатное удаление прибора -- drop-стадия ниже объявит его и не позовёт.
deleted_files=""
collect_deleted() {   # <статус> <путь>: D и старый путь R/C -- удаления
  case "$1" in
    D*|R*|C*) deleted_files="$deleted_files$2
" ;;
  esac
}
if [ "$MODE" = "staged" ]; then
  # CONSTRAINT: pathspec'и ниже относительны cwd, а `git show :<путь>` -- корня
  # дерева: staged-проход идёт из корня, иначе вызов из подкаталога сверял бы
  # присутствие одного пути, а читал другой.
  top=$(git rev-parse --show-toplevel) || fail3 "git rev-parse --show-toplevel отказ"
  cd "$top" || fail3 "корень дерева не открывается: $top"
  TMPF=$(mktemp "${TMPDIR:-/tmp}/stand-scope.XXXXXX") || fail3 "mktemp отказ"
  MAPF=""
  trap 'rm -f "$TMPF" ${MAPF:+"$MAPF"}' EXIT
  MAPF=$(mktemp "${TMPDIR:-/tmp}/stand-scope.XXXXXX") || fail3 "mktemp отказ"
  # CONSTRAINT: в staged-режиме карта -- копия ИНДЕКСА (или HEAD при --map-rev
  # HEAD): сопоставляются staged-пути, и рабочая карта (не staged) ничего о
  # коммите не доказывает.
  if [ "$MAP_REV" = "HEAD" ]; then
    git rev-parse -q --verify HEAD:tests/stand-map.tsv >/dev/null
    hmrc=$?
    [ "$hmrc" -ne 1 ] || fail4 "ОТКАЗ КАРТА: tests/stand-map.tsv нет в HEAD"
    [ "$hmrc" -eq 0 ] || fail3 "git rev-parse HEAD:tests/stand-map.tsv отказ (rc=$hmrc)"
    git show HEAD:tests/stand-map.tsv > "$MAPF"
    gsrc=$?
    [ "$gsrc" -eq 0 ] || fail3 "git show HEAD:tests/stand-map.tsv отказ (rc=$gsrc)"
  else
    lsm=$(git ls-files -s -- tests/stand-map.tsv)
    lmrc=$?
    [ "$lmrc" -eq 0 ] || fail3 "git ls-files карты отказ (rc=$lmrc)"
    [ -n "$lsm" ] || fail4 "ОТКАЗ КАРТА: tests/stand-map.tsv нет в индексе"
    git show :tests/stand-map.tsv > "$MAPF"
    gsrc=$?
    [ "$gsrc" -eq 0 ] || fail3 "git show карты отказ (rc=$gsrc)"
  fi
  MAP="$MAPF"
  git diff --cached --name-status -z > "$TMPF" 2>/dev/null
  grc=$?
  [ "$grc" -eq 0 ] || fail3 "git diff --cached отказ (rc=$grc)"
  while IFS= read -r -d '' st; do
    IFS= read -r -d '' p || continue
    collect_deleted "$st" "$p"
    case "$st" in
      R*|C*) IFS= read -r -d '' p2 || true ;;
    esac
  done < "$TMPF"
fi

[ -f "$MAP" ] || fail4 "ОТКАЗ КАРТА: $MAP не найден"
# CONSTRAINT: нечитаемая карта -- отказ прибора (rc 3): иначе чтение карты
# молча падало на каждой строке, и каждый путь выходил «НЕ ПОКРЫТ» (rc 2).
[ -r "$MAP" ] || fail3 "карта не читается: $MAP"

map_line_no=0
while IFS=$'\t' read -r mkey mval || [ -n "$mkey" ]; do
  map_line_no=$((map_line_no+1))
  case "$mkey" in ''|'#'*) continue ;; esac
  [ -n "$mval" ] || fail4 "КАРТА: пустой список стендов в строке $map_line_no"
  [ "$mval" = "-" ] && continue
  IFS=',' read -r -a mstands <<< "$mval"
  for ms in "${mstands[@]}"; do
    valid_stand_name "$ms" || fail4 "КАРТА: недопустимое имя стенда $ms в строке $map_line_no"
    [ "$ms" = "lint" ] && continue
    ms_file="tests/scripts/test-$ms.sh"
    # CONSTRAINT: в staged-режиме файл стенда ищется в ИНДЕКСЕ, как и карта:
    # файл только на диске коммитом не едет.
    if [ "$MODE" = "staged" ]; then
      msl=$(git ls-files -- "$ms_file")
      mrc=$?
      [ "$mrc" -eq 0 ] || fail3 "git ls-files стенда отказ (rc=$mrc)"
    else
      msl=""; [ -f "$ROOT/$ms_file" ] && msl=1
    fi
    if [ -z "$msl" ]; then
      # CONSTRAINT: вина карты -- только rc 1 grep (совпадения нет) при целом printf;
      # rc >= 2 grep или отказ printf -- вина прибора (rc 3). Совпадение (rc 0)
      # достоверно при любом коде printf: grep -q закрывает трубу на первом совпадении.
      if [ "$MODE" = "staged" ]; then
        printf '%s' "$deleted_files" | grep -Fxq -- "$ms_file"
        pst=("${PIPESTATUS[@]}")
        [ "${pst[1]}" -eq 0 ] && continue
        [ "${pst[0]}" -eq 0 ] && [ "${pst[1]}" -eq 1 ] \
          || fail3 "grep карты стендов отказ (printf rc=${pst[0]}, grep rc=${pst[1]})"
      fi
      fail4 "КАРТА: неизвестный стенд $ms в строке $map_line_no"
    fi
  done
done < "$MAP"

names=""

add_name() {
  names="$names$1
"
}

miss=0

process_path() {   # <путь> <удалён: 0|1>: карта для любого, правило -- только для живого
  local p="$1" isdel="$2" hit=0 mkey mval v
  local covered=0
  if [ "$isdel" = 0 ]; then
    case "$p" in
      tests/scripts/test-*.sh)
        local x="${p##*/}"
        x="${x#test-}"
        x="${x%.sh}"
        valid_stand_name "$x" || fail4 "КАРТА: недопустимое имя стенда $x в пути $p"
        covered=1
        add_name "$x"
        ;;
    esac
  fi
  while IFS=$'\t' read -r mkey mval || [ -n "$mkey" ]; do
    case "$mkey" in ''|'#'*) continue ;; esac
    hit=0
    case "$mkey" in
      */) case "$p" in "$mkey"*) hit=1 ;; esac ;;
      *)  case "$p" in "$mkey") hit=1 ;; esac ;;
    esac
    if [ "$hit" = 1 ]; then
      covered=1
      if [ "$mval" != "-" ]; then
        IFS=',' read -r -a vs <<< "$mval"
        for v in "${vs[@]}"; do
          add_name "$v"
        done
      fi
    fi
  done < "$MAP"
  # CONSTRAINT (только --staged): удалённый стенд tests/scripts/test-<x>.sh без
  # строки в карте сопоставляется со стендом run-all -- удаление стенда проверяет
  # агрегатор: карта и маска стендов сверяются им.
  if [ "$covered" = 0 ] && [ "$isdel" = 1 ]; then
    case "$p" in
      tests/scripts/test-*.sh) covered=1; add_name run-all ;;
    esac
  fi
  if [ "$covered" = 0 ]; then
    [ "$SKIP_UNCOVERED" = 1 ] && return 0
    printf 'stand-scope: НЕ ПОКРЫТ %s\n' "$p" >&2
    miss=1
  fi
}

if [ "$MODE" = "staged" ]; then
  while IFS= read -r -d '' st; do
    IFS= read -r -d '' p || continue
    case "$st" in
      D*)
        process_path "$p" 1
        ;;
      R*|C*)
        # при переименовании/копировании git даёт ДВА пути: старый и новый
        p2=""
        IFS= read -r -d '' p2 || true
        process_path "$p" 1
        [ -n "$p2" ] && process_path "$p2" 0
        ;;
      *)
        process_path "$p" 0
        ;;
    esac
  done < "$TMPF"
else
  # CONSTRAINT: отказ чтения -- rc 3, не rc 2: нечитаемый файл путей не «не
  # покрыт», а «не измерено».
  if ! paths_src=$(cat "$PATHS_FILE" 2>/dev/null); then
    fail3 "не читается --paths: $PATHS_FILE"
  fi
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    process_path "$p" 0
  done <<< "$paths_src"
fi

[ "$miss" = 0 ] || exit 2

# CONSTRAINT (только --staged): имя, файла которого нет в индексе, не зовётся --
# коммит, удаляющий стенд, иначе требовал бы свидетель для несуществующего
# прибора и дверь становилась неудовлетворимой.
# CONSTRAINT: список имён собирается в переменную с кодом КАЖДОГО члена конвейера:
# `for … in $(… | sort -u)` терял код sort, и его отказ давал пустой список --
# rc 0 «стендов нет» вместо отказа прибора.
if [ "$MODE" = "staged" ]; then
  kept=""
  srt=$(printf '%s' "$names" | sort -u; pst=("${PIPESTATUS[@]}"); [ "${pst[0]}" -eq 0 ] && [ "${pst[1]}" -eq 0 ]) \
    || fail3 "sort имён стендов до отсева удалённых отказ"
  for n in $srt; do
    [ -n "$n" ] || continue
    if [ "$n" = "lint" ]; then nf="scripts/lint.py"; else nf="tests/scripts/test-$n.sh"; fi
    # CONSTRAINT: проба -- ls-files по индексу с явным rc: cat-file -e :<путь>
    # отвечает 128 и «есть», и «нет», и «прибор отказал» -- не различить.
    lout=$(git ls-files -- "$nf" 2>/dev/null)
    lrc=$?
    [ "$lrc" -eq 0 ] || fail3 "git ls-files отказ (rc=$lrc)"
    if [ -n "$lout" ]; then
      kept="$kept$n
"
    else
      printf 'stand-scope: стенд %s удалён этим коммитом -- не зовётся\n' "$n" >&2
    fi
  done
  names="$kept"
fi

out=""
srt=$(printf '%s' "$names" | sort -u; pst=("${PIPESTATUS[@]}"); [ "${pst[0]}" -eq 0 ] && [ "${pst[1]}" -eq 0 ]) \
  || fail3 "sort итогового списка стендов отказ"
for n in $srt; do
  out="${out:+$out,}$n"
done
printf '%s\n' "$out"
exit 0
