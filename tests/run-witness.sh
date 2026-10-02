#!/usr/bin/env bash
# Производитель свидетеля прогона стендов: гоняет агрегатор на usbox ПО СНИМКУ
# ДЕРЕВА T (не рабочего дерева и не живого индекса) и оставляет файл свидетеля
# для стадии 5 хука (.githooks/pre-commit).
#
# CONSTRAINT: свидетель привязан к дереву T -- по умолчанию T = git write-tree
# ТЕКУЩЕГО индекса; ключи --tree <T> --scope <S> производят свидетеля для
# названного дерева (штатный путь для `git commit --only/--include`, где хук
# видит временный индекс: T считается под тем же GIT_INDEX_FILE). Снимок
# материализуется из T через read-tree во временный индекс: живой индекс может
# измениться между write-tree и снимком, и снимок из живого индекса лгал бы о
# прогоне чужого дерева.
#
# CONSTRAINT: хост -- ручка CATALYST_WITNESS_HOST (умолчание usbox); кит -- ручка
# CATALYST_PATCH_KIT (умолчание -- Catalyst-CC-Patch рядом с главным чекаутом этого
# репозитория); других ручек нет: зубы подставляют заглушки ssh/rsync через PATH.
#
# CONSTRAINT: scope со стендом mod-units везёт на хост блоб origin/main:tweakcc-patch.js
# кита, а не его рабочее дерево (снимок обязан быть воспроизводим), в
# ~/scratch/catalyst-witness/<T>.kit и задаёт прогону CATALYST_PATCH_KIT на него:
# без кита ступень splice-parity не исполняется: mod-units даёт код 3, агрегатор -- красный.
# Нечитаемый кит -- собственный отказ (rc 2) до первого удалённого действия.
#
# CONSTRAINT: rc=0 выдаётся ТОЛЬКО при rc=0 агрегатора. Код 3 («НЕ ИЗМЕРЕНО»)
# обязательного стенда агрегатор читает красным (rc 1) -- свидетеля нет; rc 0
# при НЕ ИЗМЕРЕНО бывает только у стендов-опт-инов (OPTIN_STANDS в
# tests/run-all.sh), и такой свидетель приёмку опт-ина не доказывает.
# Коды возврата -- по источнику, чужой код наружу как есть не пробрасывается:
#   2 -- собственные отказы (fail);
#   3 -- scope не вычислен (ОТКАЗ SCOPE_НЕ_ВЫЧИСЛЕН): индексная или HEAD-копия
#        tests/stand-scope.sh вернула ненулевой код либо отказал git HEAD-прохода;
#   4 -- удалённый прогон вернул ненулевой код (ОТКАЗ ПРОГОН -- только у прогона,
#        который начался: метка начала есть).
# S экранируется printf %q: имя попадает в удалённую команду и обязано
# переноситься дословно (белый список имён -- ^[a-z0-9._-]+$, проверяется здесь).
#
# CONSTRAINT: удалённый снимок ~/scratch/catalyst-witness/<T> убирается при
# ЛЮБОМ исходе -- уборка взводится сразу после первого удалённого действия, и
# отказ rsync/rev-parse/mkdir её не отменяет; локальные свидетель и логи старше
# 30 суток чистятся только внутри <git-dir>/catalyst-witness.
#
# CONSTRAINT: T -- ВСЕГДА hex дерева этого репозитория (40 или 64 знака): --tree
# разрешается через rev-parse <x>^{tree}, и значение ключа в удалённую команду не
# попадает никогда; в удалённые команды T идёт только через printf %q.
#
# CONSTRAINT: снимок -- ровно дерево T: симлинк/подмодуль в T -- отказ до
# доставки (агрегатор исполнил бы цель вне снимка), а материализованные байты
# сверяются с blob-id дерева (фильтры и eol-атрибуты расходились бы молча).
set -u
export LC_ALL=C

fail() { printf 'run-witness: ОТКАЗ %s\n' "$1" >&2; exit 2; }
fail_scope() { printf 'run-witness: ОТКАЗ SCOPE_НЕ_ВЫЧИСЛЕН: %s\n' "$1" >&2; exit 3; }

# CONSTRAINT: bash вне POSIX-режима обрывает составную команду на ошибке раскрытия и продолжает скрипт -- успех свидетеля требует записи каждой стадии.
# Стадия -- функция, вызванная отдельной командой верхнего уровня; её последний
# оператор -- запись имени в STAGES_DONE; пропущенная по объявленному правилу
# пишет имя с пометкой :skip. Файл свидетеля пишется и rc 0 выдаётся только после
# stages_check: каждое имя STAGES_EXPECTED записано ровно один раз и в этом порядке.
STAGES_EXPECTED="args tree_arg scope_index head_probe scope_head scope_union tree_index tree_check snapshot kit deliver run cleanup started"
STAGES_DONE=""
PASS_MSG=""
stages_skip() {   # <имя>...: стадии, пропущенные по объявленному правилу
  local n
  for n in "$@"; do
    STAGES_DONE="$STAGES_DONE $n:skip"
  done
}
stages_check() {
  local got="" s e missing=""
  for s in $STAGES_DONE; do
    got="${got:+$got }${s%:skip}"
  done
  [ "$got" = "$STAGES_EXPECTED" ] && return 0
  for e in $STAGES_EXPECTED; do
    case " $got " in
      *" $e "*) ;;
      *) missing="${missing:+$missing }$e" ;;
    esac
  done
  printf 'run-witness: ОТКАЗ СТАДИЯ_НЕ_ЗАВЕРШЕНА: %s (записано:%s)\n' "${missing:-порядок или повтор записей}" "$STAGES_DONE" >&2
  exit 3
}
pass_exit() {
  stages_check
  [ -z "$PASS_MSG" ] || printf '%s\n' "$PASS_MSG"
  exit 0
}

valid_stand_name() {   # ^[a-z0-9._-]+$
  case "$1" in
    ''|*[!a-z0-9._-]*) return 1 ;;
  esac
  return 0
}

# --- ключи: --tree <T> --scope <S> | без ключей --------------------------------
MODE_TREE=""; MODE_SCOPE=""; seen_tree=0; seen_scope=0
stage_args() {
while [ $# -gt 0 ]; do
  case "$1" in
    --tree)
      [ "$seen_tree" = 0 ] || fail "АРГУМЕНТЫ: повтор --tree"
      shift
      [ $# -gt 0 ] || fail "АРГУМЕНТЫ: --tree без значения"
      MODE_TREE="$1"
      seen_tree=1
      ;;
    --scope)
      [ "$seen_scope" = 0 ] || fail "АРГУМЕНТЫ: повтор --scope"
      shift
      [ $# -gt 0 ] || fail "АРГУМЕНТЫ: --scope без значения"
      MODE_SCOPE="$1"
      seen_scope=1
      ;;
    *)
      fail "АРГУМЕНТЫ: неизвестный аргумент: $1"
      ;;
  esac
  shift
done
if [ "$seen_tree" = 1 ] || [ "$seen_scope" = 1 ]; then
  [ "$seen_tree" = 1 ] && [ "$seen_scope" = 1 ] \
    || fail "АРГУМЕНТЫ: --tree и --scope даются парой"
fi
# CONSTRAINT: отказ пустого значения -- на парных гейтах, не в ветке case: входы
# R47 и R48 делят префикс «--tree ''» при разных ожидаемых причинах (пустое
# значение / повтор ключа), а отказ в ветке обнулил бы проверку повтора seen_*.
[ "$seen_tree" = 1 ] && { [ -n "$MODE_TREE" ] || fail "АРГУМЕНТЫ: --tree с пустым значением"; }
[ "$seen_scope" = 1 ] && { [ -n "$MODE_SCOPE" ] || fail "АРГУМЕНТЫ: --scope с пустым значением"; }
STAGES_DONE="$STAGES_DONE args"
}
stage_args "$@"

HOST="${CATALYST_WITNESS_HOST:-usbox}"
TREE_RE='^[0-9a-f]{40}([0-9a-f]{24})?$'
T=""; S=""; S_head=""; hvrc=""

stage_tree_arg() {
  T=$(git rev-parse --verify --quiet "$MODE_TREE^{tree}") \
    || fail "АРГУМЕНТЫ: --tree не называет дерево этого репозитория"
  [ -n "$T" ] || fail "АРГУМЕНТЫ: --tree не называет дерево этого репозитория"
  S="$MODE_SCOPE"
  rest="$S"
  last=""
  while :; do
    case "$rest" in
      *,*) r="${rest%%,*}"; rest="${rest#*,}" ;;
      *)   r="$rest"; rest=""; last=1 ;;
    esac
    [ -n "$r" ] || fail "SCOPE: пустое имя в списке: «$S»"
    valid_stand_name "$r" || fail "SCOPE: недопустимое имя: $r"
    if [ -n "$last" ]; then break; fi
  done
  STAGES_DONE="$STAGES_DONE tree_arg"
}
stage_scope_index() {
  # CONSTRAINT: pathspec'и ниже относительны cwd, а `git show :<путь>` -- корня
  # дерева: ветка индекса идёт из корня, иначе вызов из подкаталога не находил
  # в индексе файл, который там есть.
  top=$(git rev-parse --show-toplevel) || fail "ПРИБОР_НЕДОСТУПЕН: git rev-parse --show-toplevel"
  cd "$top" || fail "ПРИБОР_НЕДОСТУПЕН: корень дерева не открывается: $top"
  # CONSTRAINT: сопоставитель и карта берутся из индекса, как оси B/C; рабочая копия ничего не доказывает.
  lss=$(git ls-files -s -- tests/stand-scope.sh) || fail "ПРИБОР_НЕДОСТУПЕН: git ls-files tests/stand-scope.sh"
  [ -n "$lss" ] || fail "ПРИБОР_НЕДОСТУПЕН: tests/stand-scope.sh нет в индексе"
  ssx=$(git show :tests/stand-scope.sh) || fail "ПРИБОР_НЕДОСТУПЕН: git show :tests/stand-scope.sh"
  # CONSTRAINT: $0 индексной копии -- путь стенда в дереве, от него stand-scope считает HERE/ROOT.
  S=$(bash -c "$ssx" "$top/tests/stand-scope.sh" --staged)
  src=$?
  if [ "$src" -ne 0 ]; then
    printf 'run-witness: ОТКАЗ SCOPE_НЕ_ВЫЧИСЛЕН: tests/stand-scope.sh rc=%s\n' "$src" >&2
    exit 3
  fi
  STAGES_DONE="$STAGES_DONE scope_index"
}
stage_head_probe() {
  git rev-parse -q --verify HEAD:tests/stand-scope.sh >/dev/null
  hvrc=$?
  [ "$hvrc" -eq 0 ] || [ "$hvrc" -eq 1 ] || fail_scope "git rev-parse -q --verify HEAD:tests/stand-scope.sh rc=$hvrc"
  if [ "$hvrc" -eq 0 ]; then
    git rev-parse -q --verify HEAD:tests/stand-map.tsv >/dev/null
    hvrc=$?
    [ "$hvrc" -eq 0 ] || [ "$hvrc" -eq 1 ] || fail_scope "git rev-parse -q --verify HEAD:tests/stand-map.tsv rc=$hvrc"
  fi
  STAGES_DONE="$STAGES_DONE head_probe"
}
stage_scope_head() {
  hsx=$(git show HEAD:tests/stand-scope.sh) || fail_scope "git show HEAD:tests/stand-scope.sh"
  S_head=$(bash -c "$hsx" "$top/tests/stand-scope.sh" --staged --map-rev HEAD --skip-uncovered)
  hsrc=$?
  [ "$hsrc" -eq 0 ] || fail_scope "HEAD-копия rc=$hsrc"
  STAGES_DONE="$STAGES_DONE scope_head"
}
stage_scope_union() {
  # CONSTRAINT: проверяется код одного sort: запись встроенного printf в трубу падает, только если sort закрылся до EOF, а это отказ sort.
  su=$(printf '%s\n' ${S//,/ } ${S_head//,/ } | LC_ALL=C sort -u) || fail_scope "sort объединения scope"
  S=""
  for sn in $su; do S="${S:+$S,}$sn"; done
  STAGES_DONE="$STAGES_DONE scope_union"
}
stage_tree_index() {
  T=$(git write-tree) || fail "git write-tree отказ"
  STAGES_DONE="$STAGES_DONE tree_index"
}
# CONSTRAINT: каждая стадия зовётся отдельной командой верхнего уровня: брошенная составная команда уносит только свою стадию.
if [ -n "$MODE_TREE" ]; then stage_tree_arg; else STAGES_DONE="$STAGES_DONE tree_arg:skip"; fi
if [ -z "$MODE_TREE" ]; then stage_scope_index; else STAGES_DONE="$STAGES_DONE scope_index:skip"; fi
# CONSTRAINT: индексная копия не может урезать scope ниже HEAD-копии; первый коммит сопоставителя свидетельствует сам по построению.
if [ -z "$MODE_TREE" ]; then stage_head_probe; else STAGES_DONE="$STAGES_DONE head_probe:skip"; fi
# CONSTRAINT: :skip у HEAD-прохода -- режим --tree или rc 1 пробы (в HEAD нет сопоставителя или карты); иной rc проба уже отвергла.
if [ -n "$MODE_TREE" ] || [ "$hvrc" = 1 ]; then
  STAGES_DONE="$STAGES_DONE scope_head:skip"
elif [ "$hvrc" = 0 ]; then
  stage_scope_head
fi
if [ -z "$MODE_TREE" ]; then stage_scope_union; else STAGES_DONE="$STAGES_DONE scope_union:skip"; fi
if [ -z "$MODE_TREE" ] && [ -z "$S" ]; then
  PASS_MSG='run-witness: стенды не нужны (изменённые пути не мерит ни один стенд)'
  stages_skip tree_index tree_check snapshot kit deliver run cleanup started
  pass_exit
fi
if [ -z "$MODE_TREE" ]; then stage_tree_index; else STAGES_DONE="$STAGES_DONE tree_index:skip"; fi

stage_tree_check() {
if ! [[ $T =~ $TREE_RE ]]; then
  [ -n "$MODE_TREE" ] && fail "АРГУМЕНТЫ: --tree не называет дерево этого репозитория"
  fail "git write-tree дал не hex дерева: $T"
fi
TQ=$(printf '%q' "$T")
STAGES_DONE="$STAGES_DONE tree_check"
}
stage_tree_check

TMP=""; TMPIDX=""; TLS=""; THP=""; TMPKIT=""; KITOID=""; REMOTE_ARMED=0
remote_cleanup() {
  REMOTE_ARMED=0
  if [ -n "$KITOID" ]; then
    ssh "$HOST" "rm -rf ~/scratch/catalyst-witness/$TQ ~/scratch/catalyst-witness/$TQ.kit"
  else
    ssh "$HOST" "rm -rf ~/scratch/catalyst-witness/$TQ"
  fi
  rmrc=$?
  printf 'run-witness: удалённый снимок %s убран (rc=%s)\n' "$T" "$rmrc"
}
on_exit() {
  local rc=$?
  # CONSTRAINT: уборка многошаговая (удалённая, затем локальная), и сигнал посреди неё оставлял бы остатки.
  trap '' HUP INT QUIT TERM
  [ "$REMOTE_ARMED" = 1 ] && remote_cleanup
  [ -n "$TMP" ] && rm -rf "$TMP"
  [ -n "$TMPKIT" ] && rm -rf "$TMPKIT"
  [ -n "$TMPIDX" ] && rm -f "$TMPIDX"
  [ -n "$TLS" ] && rm -f "$TLS"
  [ -n "$THP" ] && rm -f "$THP"
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 131' QUIT; trap 'exit 143' TERM

stage_snapshot() {
TLS=$(mktemp "${TMPDIR:-/tmp}/catalyst-witness-ls.XXXXXX") || fail "mktemp отказ"
git ls-tree -r -z "$T" > "$TLS" || fail "СНИМОК: git ls-tree $T отказ"
THP=$(mktemp "${TMPDIR:-/tmp}/catalyst-witness-paths.XXXXXX") || fail "mktemp отказ"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/catalyst-witness.XXXXXX") || fail "mktemp отказ"
TMPIDX=$(mktemp "${TMPDIR:-/tmp}/catalyst-witness-idx.XXXXXX") || fail "mktemp отказ"

TAB=$'\t'
blob_n=0
want_ids=""
while IFS= read -r -d '' ent; do
  meta="${ent%%"$TAB"*}"
  path="${ent#*"$TAB"}"
  mode="${meta%% *}"
  oid="${meta##* }"
  case "$mode" in
    120000|160000) fail "СНИМОК: дерево несёт симлинк/подмодуль: $path" ;;
  esac
  blob_n=$((blob_n+1))
  want_ids="$want_ids$oid
"
  printf '%s\n' "$TMP/$path"
done < "$TLS" > "$THP"

# CONSTRAINT: снимок читается из ДЕРЕВА T через отдельный индекс: живой индекс
# между write-tree и снимком меняется (гонка Ф3), а снимок из живого индекса
# свидетельствовал бы не то дерево.
GIT_INDEX_FILE=$TMPIDX git read-tree "$T" || fail "git read-tree отказ"
GIT_INDEX_FILE=$TMPIDX git -c core.autocrlf=false -c core.eol=lf -c core.symlinks=true \
  checkout-index --all --prefix="$TMP/" || fail "git checkout-index отказ"

got_ids=$(git hash-object --no-filters --stdin-paths < "$THP") \
  || fail "СНИМОК: материализация разошлась с деревом (hash-object отказ)"
snap_n=$(find "$TMP" ! -type d -print0 | tr -cd '\000' | wc -c | tr -d ' ')
if [ "$got_ids" != "${want_ids%
}" ] || [ "$snap_n" != "$blob_n" ]; then
  fail "СНИМОК: материализация разошлась с деревом (файлов снимка $snap_n, blob-записей $blob_n)"
fi
STAGES_DONE="$STAGES_DONE snapshot"
}
stage_snapshot

stage_kit() {
case ",$S," in
  *,mod-units,*) ;;
  *) STAGES_DONE="$STAGES_DONE kit:skip"; return 0 ;;
esac
local kit="${CATALYST_PATCH_KIT:-}" common
if [ -z "$kit" ]; then
  common=$(git rev-parse --path-format=absolute --git-common-dir) || fail "КИТ: git rev-parse --git-common-dir отказ"
  kit="$(dirname "$(dirname "$common")")/Catalyst-CC-Patch"
fi
KITOID=$(git -C "$kit" rev-parse --verify --quiet 'origin/main:tweakcc-patch.js') \
  || fail "КИТ: в $kit нет origin/main:tweakcc-patch.js (ступень splice-parity стенда mod-units не исполнится)"
TMPKIT=$(mktemp -d "${TMPDIR:-/tmp}/catalyst-witness-kit.XXXXXX") || fail "mktemp отказ"
git -C "$kit" cat-file blob "$KITOID" > "$TMPKIT/tweakcc-patch.js" || fail "КИТ: git cat-file $KITOID отказ"
[ "$(git hash-object --no-filters "$TMPKIT/tweakcc-patch.js")" = "$KITOID" ] \
  || fail "КИТ: материализованный tweakcc-patch.js разошёлся с блобом $KITOID"
printf 'run-witness: кит %s origin/main:tweakcc-patch.js %s\n' "$kit" "$KITOID"
STAGES_DONE="$STAGES_DONE kit"
}
stage_kit

stage_deliver() {
# CONSTRAINT: промежуточный каталог на хосте создаётся явно: rsync без --mkpath
# на чистом хосте отказывает, и ни один свидетель не производился бы вовсе.
ssh "$HOST" 'mkdir -p ~/scratch/catalyst-witness' || fail "ssh mkdir отказ"
REMOTE_ARMED=1

rsync -a --no-xattrs --delete "$TMP/" "$HOST:scratch/catalyst-witness/$TQ/" \
  || fail "rsync отказ (снимок не доставлен на $HOST)"

if [ -n "$KITOID" ]; then
  rsync -a --no-xattrs --delete "$TMPKIT/" "$HOST:scratch/catalyst-witness/$TQ.kit/" \
    || fail "rsync отказ (кит не доставлен на $HOST)"
fi

# CONSTRAINT: git-dir берётся rev-parse'ом, а не литерой .git: в worktree
# git-каталог лежит вне рабочего дерева, и хук ищет свидетеля по тому же правилу.
GITDIR=$(git rev-parse --git-dir) || fail "git rev-parse --git-dir отказ"
mkdir -p "$GITDIR/catalyst-witness" || fail "не создан $GITDIR/catalyst-witness"
LOG="$GITDIR/catalyst-witness/$T.log"
# CONSTRAINT: уборка только ЭТОГО каталога и только по возрасту: чужие файлы и
# свежие свидетели не трогаются; отказ уборки не отменяет прогон (в гарантию
# свидетеля она не входит), но печатается с rc -- не глушится.
find "$GITDIR/catalyst-witness" -maxdepth 1 -type f -mtime +30 -delete
frc=$?
[ "$frc" -eq 0 ] || printf 'run-witness: ПРЕДУПРЕЖДЕНИЕ уборка по возрасту rc=%s\n' "$frc" >&2

: > "$LOG" || fail "журнал прогона не создан: $LOG"
STAGES_DONE="$STAGES_DONE deliver"
}
stage_deliver

wrc=""
stage_run() {
SQ=$(printf '%q' "$S")
local kitenv=""
[ -z "$KITOID" ] || kitenv="CATALYST_PATCH_KIT=\$HOME/scratch/catalyst-witness/$TQ.kit "
ssh "$HOST" "cd ~/scratch/catalyst-witness/$TQ && printf 'run-witness: прогон начат\n' && env -u CATALYST_STANDS ${kitenv}systemd-run --user --scope --quiet -p MemoryMax=4G bash tests/run-all.sh --scope $SQ" > "$LOG" 2>&1
wrc=$?
[ -z "$KITOID" ] || printf 'run-witness: кит origin/main:tweakcc-patch.js %s\n' "$KITOID" >> "$LOG"
STAGES_DONE="$STAGES_DONE run"
}
stage_run

# CONSTRAINT: удалённый снимок не хранится: дерево одноразовое, а копии
# накапливались бы бессрочно; rc уборки печатается, исход прогона не меняет.
stage_cleanup() {
remote_cleanup
STAGES_DONE="$STAGES_DONE cleanup"
}
stage_cleanup

# CONSTRAINT: метка начала печатается удалённой командой сразу после cd: без
# неё отказ ssh или cd до агрегатора подписывался бы как ОТКАЗ ПРОГОН (rc 4),
# хотя прогона не было -- это отказ доставки (rc 2).
stage_started() {
if ! grep -Fqx 'run-witness: прогон начат' "$LOG"; then
  tail -n 40 "$LOG"
  fail "ПРОГОН_НЕ_НАЧАТ: ssh $HOST rc=$wrc -- агрегатор на снимке не запускался"
fi
STAGES_DONE="$STAGES_DONE started"
}
stage_started

# CONSTRAINT: исход прогона (свидетель или ОТКАЗ ПРОГОН) называется только после полного списка стадий.
stages_check
if [ "$wrc" -eq 0 ]; then
  printf 'scope=%s\nrc=0\nhost=%s\n' "$S" "$HOST" > "$GITDIR/catalyst-witness/$T" || fail "свидетель не записан: $GITDIR/catalyst-witness/$T"
  PASS_MSG=$(printf 'run-witness: свидетель %s scope=%s' "$T" "$S")
  pass_exit
fi

tail -n 40 "$LOG"
printf 'run-witness: ОТКАЗ ПРОГОН: tests/run-all.sh на %s rc=%s\n' "$HOST" "$wrc" >&2
exit 4
