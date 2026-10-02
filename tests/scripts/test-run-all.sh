#!/usr/bin/env bash
# Стенд агрегатора стендов (tests/run-all.sh), карты путей (tests/stand-map.tsv,
# tests/stand-scope.sh) и производителя свидетеля (tests/run-witness.sh).
#
# CONSTRAINT: агрегатор и свидетель исполняются ТОЛЬКО на копиях во временном
# мире -- живое дерево C не пишется и как предмет не прогоняется; единственное
# чтение живого дерева -- зубы R-MAP/R-MAP-SNAP/R-FIND (только чтение).
#
# CONSTRAINT: пин числа стендов в копии агрегатора переставляется под мир
# (в мире свои заглушки): гейт числа -- про живое дерево, а не про мир зубов.
set -u
unset CATALYST_STANDS CATALYST_WITNESS_HOST
export LC_ALL=C

# CONSTRAINT: ожидаемое число зубов объявлено ЗДЕСЬ и больше нигде; расхождение
# в любую сторону -- КРАСНЫЙ (зуб, тихо выпавший из прогона, неотличим от зуба,
# которого никогда не писали).
EXPECTED_TEETH=106

HERE="$(cd "$(dirname "$0")" && pwd)"
TESTS="$(cd "$HERE/.." && pwd)"
ROOT_C="$(cd "$TESTS/.." && pwd)"

PASS=0; FAIL=0

# CONSTRAINT: процесс, запущенный через & при выключенном управлении заданиями,
# получает SIGINT/SIGQUIT игнорируемыми, а сигнал, игнорируемый на входе,
# неинтерактивный bash не ловит и не сбрасывает -- сигнальный зуб мерил бы
# игнор, а не ловушку производителя. Запуск идёт через этот сброс в SIG_DFL.
# HUP и TERM сбрасываются тоже: стенд, запущенный под nohup, наследует HUP
# игнорируемым, и HUP-зуб краснел бы на верном дереве от формы запуска.
SIGDFL='import os,signal,sys
for s in (signal.SIGINT, signal.SIGQUIT, signal.SIGHUP, signal.SIGTERM):
    signal.signal(s, signal.SIG_DFL)
os.execvp(sys.argv[1], sys.argv[1:])'
ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/run-all-teeth.XXXXXX") || exit 1
trap 'rm -rf "$WORK"' EXIT

BIN="$WORK/bin"
mkdir -p "$BIN"
cat > "$BIN/ssh" <<'EOF2'
#!/usr/bin/env bash
# заглушка ssh: вызов -- в $STUB_LOG, код -- из $STUB_SSH_RC, выходная строка
# попадает в лог свидетеля и в хвост, печатаемый при отказе
printf 'ssh %s\n' "$*" >> "$STUB_LOG"
# CONSTRAINT: служебные вызовы (mkdir/rm) всегда успешны -- код из STUB_SSH_RC
# адресован именно прогону агрегатора
case "$*" in
  *" mkdir -p "*) exit 0 ;;
  *" rm -rf "*)
    # CONSTRAINT: STUB_KILL_ON_RM=1 шлёт TERM производителю ВО ВРЕМЯ его уборки и
    # продолжает работу -- зуб R59 бьёт в реентерабельность on_exit.
    if [ "${STUB_KILL_ON_RM:-}" = 1 ]; then
      kill -TERM "$PPID"
      sleep 0.3
      printf 'rm-continued\n' >> "$STUB_LOG"
    fi
    exit 0 ;;
esac
# CONSTRAINT: STUB_RO_DIR снимает право записи В МОМЕНТ прогона агрегатора --
# зуб R53 бьёт именно по записи свидетеля, а не по логу прогона.
if [ -n "${STUB_RO_DIR:-}" ]; then chmod a-w "$STUB_RO_DIR"; fi
# CONSTRAINT: метку начала заглушка печатает, только если удалённая команда её
# несёт: метку печатает сама команда (run-witness.sh), и заглушка, печатающая её
# безусловно, делала бы её снятие невидимым.
case "$*" in
  *"printf 'run-witness: прогон начат\n' && "*) [ -n "${STUB_SSH_NOSTART:-}" ] || printf 'run-witness: прогон начат\n' ;;
esac
printf 'stub-ssh: rc=%s\n' "${STUB_SSH_RC:-0}"
exit "${STUB_SSH_RC:-0}"
EOF2
cat > "$BIN/rsync" <<'EOF2'
#!/usr/bin/env bash
# заглушка rsync: вызов -- в $STUB_LOG; источник снимка копируется в
# $STUB_RSYNC_REC -- зубу нужен КОНТЕНТ индексной версии, а не факт вызова
printf 'rsync %s\n' "$*" >> "$STUB_LOG"
# CONSTRAINT: STUB_RSYNC_SLEEP держит производителя внутри rsync -- сигнальные
# зубы R54..R57 бьют ровно в это окно; метка -- знак, что окно открыто.
if [ -n "${STUB_RSYNC_SLEEP:-}" ]; then
  : > "$STUB_RSYNC_MARK"
  sleep "$STUB_RSYNC_SLEEP"
fi
src=""
for a in "$@"; do
  case "$a" in -*) ;; *) [ -z "$src" ] && src="$a" ;; esac
done
case "$src" in
  */) mkdir -p "$STUB_RSYNC_REC" && cp -R "$src". "$STUB_RSYNC_REC"/ ;;
esac
exit "${STUB_RSYNC_RC:-0}"
EOF2
chmod +x "$BIN/ssh" "$BIN/rsync"

# CONSTRAINT: REALGIT фиксируется ДО подмены PATH -- заглушка git звает
# настоящий бинарь напрямую, без рекурсии через себя.
REALGIT="$(command -v git)"
export REALGIT

mk_world() {   # <имя мира> [имена стендов...] -> путь мира
  local w="$WORK/$1"; shift
  local stands="${*:-a b c}"
  mkdir -p "$w/tests/scripts" "$w/scripts" "$w/markers" \
    "$w/docs" "$w/alpha" "$w/beta" "$w/gamma"
  cp "$ROOT_C/tests/run-all.sh" "$w/tests/run-all.sh"
  cp "$ROOT_C/tests/stand-scope.sh" "$w/tests/stand-scope.sh" 2>/dev/null || true
  cp "$ROOT_C/tests/run-witness.sh" "$w/tests/run-witness.sh" 2>/dev/null || true
  local n ns=0
  for n in $stands; do ns=$((ns+1)); done
  sed -i "s/^EXPECTED_STANDS=[0-9][0-9]*/EXPECTED_STANDS=$ns/" "$w/tests/run-all.sh"
  for n in $stands; do
    # CONSTRAINT: журнал порядка -- само доказательство порядка исполнения
    # (Ф9): маркеры-файлы порядка не хранят.
    printf '#!/usr/bin/env bash\nmkdir -p markers\necho %s >> markers/order.log\ntouch "markers/%s"\n' "$n" "$n" > "$w/tests/scripts/test-$n.sh"
  done
  printf 'import pathlib\npathlib.Path("markers").mkdir(exist_ok=True)\nwith open("markers/order.log", "a") as f: f.write("lint\\n")\npathlib.Path("markers/lint").touch()\n' > "$w/scripts/lint.py"
  cat > "$w/tests/stand-map.tsv" <<'EOF2'
alpha/	a
alpha/both.txt	c
beta/exact.txt	b
gamma/	-
docs/	-
EOF2
  printf 'x\n' > "$w/alpha/f.txt"
  printf 'x\n' > "$w/alpha/both.txt"
  printf 'x\n' > "$w/beta/exact.txt"
  printf 'x\n' > "$w/gamma/g.txt"
  printf 'x\n' > "$w/docs/readme"
  git -C "$w" init -q
  git -C "$w" config user.email t@t
  git -C "$w" config user.name t
  git -C "$w" add -A
  git -C "$w" commit -qm base
  printf '%s' "$w"
}

RA_OUT=""; RA_RC=""
run_ra() {   # <мир> <аргументы агрегатора...>
  local w="$1"; shift
  RA_OUT=$(cd "$w" && bash tests/run-all.sh "$@" 2>&1)
  RA_RC=$?
}

markers() {   # <мир> -> имена маркеров через пробел
  ls "$1/markers" 2>/dev/null | grep -vx order.log | sort | tr '\n' ' '
}
order_log() {   # <мир> -> содержимое журнала порядка
  cat "$1/markers/order.log" 2>/dev/null
}
clear_markers() { rm -f "$1"/markers/* 2>/dev/null; :; }

refusal_ok() {   # <мир>: rc 2, ОТКАЗ SCOPE в выводе, ноль маркеров; причина -- в RA_WHY
  RA_WHY=""
  if [ "$RA_RC" = 2 ] && [[ "$RA_OUT" == *"ОТКАЗ SCOPE"* ]] && [ -z "$(markers "$1")" ]; then
    return 0
  fi
  RA_WHY="rc=$RA_RC markers=[$(markers "$1")] out=[$RA_OUT]"
  return 1
}

SS_OUT=""; SS_RC=""; SS_ERR=""
run_ss() {   # <мир> <пути, \n-разделённые>
  local w="$1"
  printf '%s\n' "$2" > "$w/.paths"
  SS_OUT=$(cd "$w" && bash tests/stand-scope.sh --paths "$w/.paths" 2>"$w/.err")
  SS_RC=$?
  SS_ERR=$(cat "$w/.err" 2>/dev/null)
}

SSS_OUT=""; SSS_RC=""; SSS_ERR=""
run_ss_staged() {   # <мир>: stand-scope --staged
  SSS_OUT=$(cd "$1" && bash tests/stand-scope.sh --staged 2>"$1/.err")
  SSS_RC=$?
  SSS_ERR=$(cat "$1/.err" 2>/dev/null)
}

RW_OUT=""; RW_RC=""
run_rw() {   # <мир> [ПЕРЕМЕННАЯ=значение ...]
  local w="$1"; shift
  RW_OUT=$(cd "$w" && env PATH="$BIN:$PATH" "$@" bash tests/run-witness.sh 2>&1)
  RW_RC=$?
}
run_rwa() {   # <мир> <аргументы run-witness...>
  local w="$1"; shift
  RW_OUT=$(cd "$w" && env PATH="$BIN:$PATH" bash tests/run-witness.sh "$@" 2>&1)
  RW_RC=$?
}

W=$(mk_world w1)

# --- R1. ОТКАЗ SCOPE: без аргументов ------------------------------------------
clear_markers "$W"; run_ra "$W"
if refusal_ok "$W"; then
  ok "R1) без аргументов -- rc 2, ОТКАЗ SCOPE, ноль запусков"
else
  bad "R1) без аргументов: $RA_WHY"
fi

# --- R2. ОТКАЗ SCOPE: --scope без значения ------------------------------------
clear_markers "$W"; run_ra "$W" --scope
if refusal_ok "$W"; then
  ok "R2) --scope без значения -- rc 2, ноль запусков"
else
  bad "R2) --scope без значения: $RA_WHY"
fi

# --- R3. ОТКАЗ SCOPE: форма --scope=<…> в любом виде --------------------------
r3=0
clear_markers "$W"; run_ra "$W" --scope=a; refusal_ok "$W" || r3=1
clear_markers "$W"; run_ra "$W" --scope=;  refusal_ok "$W" || r3=1
if [ "$r3" = 0 ]; then
  ok "R3) --scope= (с значением и пустая) -- rc 2, ноль запусков"
else
  bad "R3) --scope=: $RA_WHY"
fi

# --- R4. ОТКАЗ SCOPE: пустое имя в списке -------------------------------------
# CONSTRAINT: причина пинится ДОСЛОВНО («пустое имя»): пустое имя отказывается и
# проверкой неизвестного имени -- без пина причины мутация строки отказа пустого
# имени не краснит зуб (замер M1 первой волны).
r4=0
for v in 'a,,b' ','; do
  clear_markers "$W"; run_ra "$W" --scope "$v"
  refusal_ok "$W" || { r4=1; r4why="«$v»: $RA_WHY"; }
  [[ "$RA_OUT" == *"пустое имя"* ]] || { r4=1; r4why="«$v»: причина не названа [$RA_OUT]"; }
done
clear_markers "$W"; run_ra "$W" --scope 'a, b'
refusal_ok "$W" || { r4=1; r4why="«a, b»: $RA_WHY"; }
# CONSTRAINT: имя с пробелом -- НЕ пустое поле: его отказывает белый список имён
# (Ф7), и пин причины различает эти два класса отказа
[[ "$RA_OUT" == *"недопустимое имя"* ]] || { r4=1; r4why="«a, b»: причина не названа [$RA_OUT]"; }
if [ "$r4" = 0 ]; then
  ok "R4) пустое имя (a,,b | ,) и имя с пробелом (недопустимое) -- rc 2, ноль запусков"
else
  bad "R4) пустое/недопустимое имя: ${r4why:-не все виды отказаны}"
fi

# --- R5. ОТКАЗ SCOPE: неизвестное имя названо ---------------------------------
clear_markers "$W"; run_ra "$W" --scope nope
if refusal_ok "$W" && [[ "$RA_OUT" == *"nope"* ]]; then
  ok "R5) неизвестное имя -- rc 2 и имя названо в отказе"
else
  bad "R5) неизвестное имя: $RA_WHY"
fi

# --- R6. ОТКАЗ SCOPE: повтор ключа --scope ------------------------------------
clear_markers "$W"; run_ra "$W" --scope a --scope b
if refusal_ok "$W"; then
  ok "R6) повтор ключа --scope -- rc 2, ноль запусков"
else
  bad "R6) повтор --scope: $RA_WHY"
fi

# --- R7. ОТКАЗ SCOPE: любой иной аргумент -------------------------------------
clear_markers "$W"; run_ra "$W" --scope a extra
if refusal_ok "$W"; then
  ok "R7) посторонний аргумент -- rc 2, ноль запусков"
else
  bad "R7) посторонний аргумент: $RA_WHY"
fi

# --- R8. --scope a: ровно маркер a --------------------------------------------
clear_markers "$W"; run_ra "$W" --scope a
if [ "$RA_RC" = 0 ] && [ "$(markers "$W")" = "a " ] && [[ "$RA_OUT" == *"scope=a"* ]]; then
  ok "R8) --scope a -- маркер только a, сводка со scope=a"
else
  bad "R8) --scope a: rc=$RA_RC markers=[$(markers "$W")] out=[$RA_OUT]"
fi

# --- R9. --scope b,lint: маркеры b и lint -------------------------------------
clear_markers "$W"; run_ra "$W" --scope b,lint
if [ "$RA_RC" = 0 ] && [ "$(markers "$W")" = "b lint " ]; then
  ok "R9) --scope b,lint -- маркеры b и lint, ничего лишнего"
else
  bad "R9) --scope b,lint: rc=$RA_RC markers=[$(markers "$W")]"
fi

# --- R10. --list: имена построчно, lint последним, ничего не исполняется ------
clear_markers "$W"; run_ra "$W" --list
want_list="$(printf 'a\nb\nc\nlint')"
if [ "$RA_RC" = 0 ] && [ "$RA_OUT" = "$want_list" ] && [ -z "$(markers "$W")" ]; then
  ok "R10) --list -- a b c lint построчно, rc 0, ноль запусков"
else
  bad "R10) --list: rc=$RA_RC markers=[$(markers "$W")] out=[$RA_OUT]"
fi

# --- R11. stand-scope: префикс -------------------------------------------------
run_ss "$W" "alpha/f.txt"
if [ "$SS_RC" = 0 ] && [ "$SS_OUT" = "a" ]; then
  ok "R11) stand-scope: путь под префиксом alpha/ -- стенд a"
else
  bad "R11) префикс: rc=$SS_RC out=[$SS_OUT] err=[$SS_ERR]"
fi

# --- R12. stand-scope: точный путь --------------------------------------------
run_ss "$W" "beta/exact.txt"
if [ "$SS_RC" = 0 ] && [ "$SS_OUT" = "b" ]; then
  ok "R12) stand-scope: точный путь beta/exact.txt -- стенд b"
else
  bad "R12) точный путь: rc=$SS_RC out=[$SS_OUT] err=[$SS_ERR]"
fi

# --- R13. stand-scope: объединение всех подходящих строк ----------------------
run_ss "$W" "alpha/both.txt"
if [ "$SS_RC" = 0 ] && [ "$SS_OUT" = "a,c" ]; then
  ok "R13) stand-scope: путь под двумя строками карты -- объединение a,c"
else
  bad "R13) объединение: rc=$SS_RC out=[$SS_OUT] err=[$SS_ERR]"
fi

# --- R14. stand-scope: вычисляемое правило test-<x>.sh ------------------------
run_ss "$W" "tests/scripts/test-c.sh"
if [ "$SS_RC" = 0 ] && [ "$SS_OUT" = "c" ]; then
  ok "R14) stand-scope: правило tests/scripts/test-<x>.sh -- стенд c"
else
  bad "R14) вычисляемое правило: rc=$SS_RC out=[$SS_OUT] err=[$SS_ERR]"
fi

# --- R15. stand-scope: строка «-» -- покрыто, стендов нет ---------------------
run_ss "$W" "gamma/g.txt"
if [ "$SS_RC" = 0 ] && [ -z "$SS_OUT" ]; then
  ok "R15) stand-scope: строка «-» -- rc 0 и пустая строка"
else
  bad "R15) «-»: rc=$SS_RC out=[$SS_OUT] err=[$SS_ERR]"
fi

# --- R16. stand-scope: НЕ ПОКРЫТ ----------------------------------------------
run_ss "$W" "nowhere/x"
if [ "$SS_RC" = 2 ] && [[ "$SS_ERR" == *"НЕ ПОКРЫТ nowhere/x"* ]] && [ -z "$SS_OUT" ]; then
  ok "R16) stand-scope: путь вне карты -- rc 2 и строка НЕ ПОКРЫТ в stderr"
else
  bad "R16) НЕ ПОКРЫТ: rc=$SS_RC out=[$SS_OUT] err=[$SS_ERR]"
fi

# --- R17. stand-scope: неизвестный стенд в карте ------------------------------
W2=$(mk_world w2)
printf 'alpha/\tghost\n' > "$W2/tests/stand-map.tsv"
run_ss "$W2" "alpha/f.txt"
if [ "$SS_RC" = 4 ] && [[ "$SS_ERR" == *"КАРТА: неизвестный стенд ghost"* ]] && [[ "$SS_ERR" == *"строке 1"* ]]; then
  ok "R17) stand-scope: карта называет несуществующий стенд -- rc 4 с номером строки"
else
  bad "R17) КАРТА: rc=$SS_RC err=[$SS_ERR]"
fi

# --- R18. run-witness: пустой scope -- «стенды не нужны», приборы не зовутся --
W18=$(mk_world w18)
printf 'y\n' > "$W18/docs/readme"
git -C "$W18" add docs/readme
STUB_LOG="$WORK/stub-r18.log"; STUB_RSYNC_REC="$WORK/rsync-r18"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
export STUB_LOG STUB_RSYNC_REC
run_rw "$W18"
if [ "$RW_RC" = 0 ] && [[ "$RW_OUT" == *"стенды не нужны"* ]] && [ ! -e "$STUB_LOG" ] \
   && [ -z "$(ls "$W18/.git/catalyst-witness" 2>/dev/null)" ]; then
  ok "R18) run-witness: пустой scope -- «стенды не нужны», rc 0, ssh/rsync не звались"
else
  bad "R18) пустой scope: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R19. run-witness: rc 0 -- свидетель, полный протокол вызовов --------------
W19=$(mk_world w19)
printf 'y\n' > "$W19/alpha/f.txt"
git -C "$W19" add alpha/f.txt
T19=$(git -C "$W19" write-tree)
STUB_LOG="$WORK/stub-r19.log"; STUB_RSYNC_REC="$WORK/rsync-r19"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W19"
w19file="$W19/.git/catalyst-witness/$T19"
w19want="$(printf 'scope=a\nrc=0\nhost=usbox')"
if [ "$RW_RC" = 0 ] && [ -f "$w19file" ] && [ "$(cat "$w19file")" = "$w19want" ] \
   && [[ "$RW_OUT" == *"run-witness: свидетель $T19 scope=a"* ]] \
   && grep -q "rsync -a --no-xattrs --delete.*catalyst-witness/$T19/" "$STUB_LOG" 2>/dev/null \
   && grep -q "env -u CATALYST_STANDS systemd-run --user --scope --quiet -p MemoryMax=4G bash tests/run-all.sh --scope a" "$STUB_LOG" 2>/dev/null \
   && grep -q "mkdir -p ~/scratch/catalyst-witness" "$STUB_LOG" 2>/dev/null \
   && grep -q "rm -rf ~/scratch/catalyst-witness/$T19" "$STUB_LOG" 2>/dev/null \
   && [[ "$RW_OUT" == *"убран (rc=0)"* ]]; then
  ok "R19) run-witness: rc 0 -- свидетель трёх строк; mkdir/env -u/run/rm-уборка записаны"
else
  bad "R19) свидетель: rc=$RW_RC file=[$(cat "$w19file" 2>/dev/null)] out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R20. run-witness: rc 1 -- свидетеля нет, лог, уборка при любом исходе -----
W20=$(mk_world w20)
printf 'y\n' > "$W20/alpha/f.txt"
git -C "$W20" add alpha/f.txt
T20=$(git -C "$W20" write-tree)
STUB_LOG="$WORK/stub-r20.log"; rm -f "$STUB_LOG"
run_rw "$W20" STUB_SSH_RC=1
if [ "$RW_RC" = 4 ] && [ ! -e "$W20/.git/catalyst-witness/$T20" ] \
   && [ -f "$W20/.git/catalyst-witness/$T20.log" ] \
   && grep -q 'stub-ssh: rc=1' "$W20/.git/catalyst-witness/$T20.log" \
   && [[ "$RW_OUT" == *"stub-ssh: rc=1"* ]] \
   && grep -q "rm -rf ~/scratch/catalyst-witness/$T20" "$STUB_LOG" 2>/dev/null; then
  ok "R20) run-witness: удалённый rc 1 -- rc 4, свидетеля нет, лог <T>.log, удалённый снимок убран"
else
  bad "R20) rc 1: rc=$RW_RC wit=$(ls "$W20/.git/catalyst-witness" 2>/dev/null) out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R21. run-witness: снимок берётся из ИНДЕКСА, не из рабочего дерева -------
W21=$(mk_world w21)
printf 'INDEX-VERSION\n' > "$W21/alpha/f.txt"
git -C "$W21" add alpha/f.txt
printf 'WORKING-VERSION\n' > "$W21/alpha/f.txt"
STUB_LOG="$WORK/stub-r21.log"; STUB_RSYNC_REC="$WORK/rsync-r21"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W21"
if [ "$RW_RC" = 0 ] && [ "$(cat "$STUB_RSYNC_REC/alpha/f.txt" 2>/dev/null)" = "INDEX-VERSION" ]; then
  ok "R21) run-witness: rsync-заглушка видит ИНДЕКСНУЮ версию файла (рабочая -- иная)"
else
  bad "R21) индексный снимок: rc=$RW_RC копия=[$(cat "$STUB_RSYNC_REC/alpha/f.txt" 2>/dev/null)]"
fi

# --- R-MAP (rmap_against): карта покрывает все пути дерева, стенды достижимы --
# CONSTRAINT: источник путей -- git ТОГДА и только тогда, когда каталог сам
# является корнем репозитория (toplevel == каталог по cd -P); иначе -- find.
# Снимок свидетеля .git не содержит, а копия под чужим .git получает чужой
# toplevel -- обе обязаны идти через find (Ф1).
RMAP_WHY=""
rmap_against() {   # <каталог дерева> -> 0 зелёно; причина отказа -- в RMAP_WHY
  local dir="$1" pfz="$WORK/.rmap-z" pf="$WORK/.rmap-paths" topl
  if topl=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) \
     && [ "$(cd "$topl" 2>/dev/null && pwd -P)" = "$(cd "$dir" && pwd -P)" ]; then
    git -C "$dir" ls-files -z > "$pfz" 2>/dev/null || { RMAP_WHY="git ls-files отказ"; return 1; }
    tr '\0' '\n' < "$pfz" > "$pf"
  else
    (cd "$dir" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) > "$pf" || { RMAP_WHY="find отказ"; return 1; }
  fi
  [ -s "$pf" ] || { RMAP_WHY="список путей пуст"; return 1; }
  local map_out map_rc want_names got_names reach_ok f b
  map_out=$(bash "$dir/tests/stand-scope.sh" --paths "$pf" 2>"$WORK/.rmap-err")
  map_rc=$?
  want_names="$(printf 'dispatch-gate\ndispatch-stats\nform-host-parity\njudge-bridge\njudge-ladder-live\njudge-serves\nmod-event-names\nmod-units\nplugin-freshness\nplugin-gate\nplugin-ship\nrender-tree\nrun-all\nrun-hook-forwarding\nscripts\nswe-request\nlint\n' | sort)"
  got_names="$(printf '%s' "$map_out" | tr ',' '\n' | sort)"
  reach_ok=1
  for f in "$dir"/tests/scripts/test-*.sh; do
    [ -e "$f" ] || continue
    b="${f##*/}"; b="${b#test-}"; b="${b%.sh}"
    case ",$map_out," in *",$b,"*) ;; *) reach_ok=0 ;; esac
  done
  if [ "$map_rc" = 0 ] && [ "$got_names" = "$want_names" ] && [ "$reach_ok" = 1 ]; then
    return 0
  fi
  RMAP_WHY="rc=$map_rc err=[$(cat "$WORK/.rmap-err" 2>/dev/null)] got=[$got_names] reach_ok=$reach_ok"
  return 1
}

if rmap_against "$ROOT_C"; then
  ok "R-MAP) каждый путь ls-files C покрыт картой; все стенды диска достижимы"
else
  bad "R-MAP) $RMAP_WHY"
fi

# CONSTRAINT: фикстура копии дерева не требует git у источника: сам стенд
# исполняется в снимках свидетеля БЕЗ .git (замер e2e Ф16). Копия -- РАБОЧЕЕ
# дерево (то, что гейтится), а не индекс: при git, отвечающем за ЭТОТ каталог
# (toplevel == каталог), -- отслеживаемые пути ls-files -z с диска; иначе --
# cp минус .git: снимки неотслеживаемых файлов не содержат, множество путей то же.
snap_of_tree() {   # <источник> <каталог-приёмник>: отслеживаемые пути рабочего дерева без .git
  local src="$1" dst="$2" lz topl f
  lz=$(mktemp "$WORK/.snap-ls.XXXXXX")
  if topl=$(git -C "$src" rev-parse --show-toplevel 2>/dev/null) \
     && [ "$(cd "$topl" 2>/dev/null && pwd -P)" = "$(cd "$src" && pwd -P)" ] \
     && git -C "$src" ls-files -z > "$lz"; then
    while IFS= read -r -d '' f; do
      [ -e "$src/$f" ] || [ -L "$src/$f" ] || continue
      mkdir -p "$dst/$(dirname "$f")"
      cp -P "$src/$f" "$dst/$f"
    done < "$lz"
  else
    cp -R "$src/." "$dst/"
    rm -rf "$dst/.git"
  fi
  rm -f "$lz"
}

# --- R23. R-MAP-SNAP: копия без .git (снимок как у run-witness) -- R-MAP зелёный
SNAPD=$(mktemp -d "$WORK/rmap-snap.XXXXXX")
snap_of_tree "$ROOT_C" "$SNAPD/"
if rmap_against "$SNAPD"; then
  ok "R-MAP-SNAP) снимок без .git -- список путей берётся find-веткой, карта покрывает всё"
else
  bad "R-MAP-SNAP) $RMAP_WHY"
fi

# --- R24. R-FIND: чужой .git над копией -> find-ветка, не чужой ls-files -------
FPAR="$WORK/rmap-foreign"
mkdir -p "$FPAR"
git -C "$FPAR" init -q
git -C "$FPAR" config user.email t@t
git -C "$FPAR" config user.name t
printf 'foreign\n' > "$FPAR/own.txt"
git -C "$FPAR" add own.txt
git -C "$FPAR" commit -qm foreign
FCOPY="$FPAR/waves/copy"
mkdir -p "$FCOPY"
snap_of_tree "$ROOT_C" "$FCOPY/"
# CONSTRAINT: файл, отсутствующий в чужом индексе: git-ветка дала бы чужие пути
# (prefixed waves/copy/...) и НЕ ПОКРЫТ, find-ветка обязана его покрыть картой.
printf 'extra\n' > "$FCOPY/docs/extra-note.md"
if rmap_against "$FCOPY"; then
  ok "R-FIND) чужой .git над копией -- ветка find, свои пути покрыты картой"
else
  bad "R-FIND) $RMAP_WHY"
fi

# --- R25. R-WTTREE: снимок строится из ДЕРЕВА T, а не живого индекса ----------
# Заглушка git мутирует индекс СРАЗУ после настоящего write-tree: живой индекс
# уже отличается от T -- снимок из живого индекса унёс бы mutation-marker.
W25=$(mk_world w25)
printf 'y\n' > "$W25/alpha/f.txt"
git -C "$W25" add alpha/f.txt
mkdir -p "$WORK/bin25"
cat > "$WORK/bin25/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "write-tree" ]; then
  "$REALGIT" "\$@"
  rc=\$?
  printf 'mutated\n' > "\$MUTW25/mutation-marker.txt"
  "$REALGIT" -C "\$MUTW25" add mutation-marker.txt
  exit \$rc
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$WORK/bin25/git"
STUB_LOG="$WORK/stub-r25.log"; STUB_RSYNC_REC="$WORK/rsync-r25"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
RW25_OUT=$(cd "$W25" && env PATH="$WORK/bin25:$BIN:$PATH" MUTW25="$W25" STUB_LOG="$STUB_LOG" STUB_RSYNC_REC="$STUB_RSYNC_REC" bash tests/run-witness.sh 2>&1)
RW25_RC=$?
if [ "$RW25_RC" = 0 ] && [ ! -e "$STUB_RSYNC_REC/mutation-marker.txt" ] \
   && [ "$(cat "$STUB_RSYNC_REC/alpha/f.txt" 2>/dev/null)" = "y" ]; then
  ok "R-WTTREE) индекс меняется между write-tree и снимком -- снимок берётся из дерева T"
else
  bad "R-WTTREE) rc=$RW25_RC маркер-мутации=[$(ls "$STUB_RSYNC_REC" 2>/dev/null)] out=[$RW25_OUT]"
fi

# --- R26. Ф4: staged git rm стенда -- имя не зовётся, объявление в stderr ------
W26=$(mk_world w26)
printf 'tests/scripts/\ta\nscripts/\tlint\n' >> "$W26/tests/stand-map.tsv"
git -C "$W26" add tests/stand-map.tsv
git -C "$W26" commit -qm map
git -C "$W26" rm -q tests/scripts/test-a.sh
run_ss_staged "$W26"
if [ "$SSS_RC" = 0 ] && [ -z "$SSS_OUT" ] \
   && [[ "$SSS_ERR" == *"стенд a удалён этим коммитом -- не зовётся"* ]]; then
  ok "R26) staged git rm test-a.sh -- стенд a не в S, объявление в stderr, rc 0"
else
  bad "R26) удаление стенда: rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
fi

# --- R27. Ф4: staged git rm scripts/lint.py -- lint не зовётся -----------------
W27=$(mk_world w27)
printf 'tests/scripts/\ta\nscripts/\tlint\n' >> "$W27/tests/stand-map.tsv"
git -C "$W27" add tests/stand-map.tsv
git -C "$W27" commit -qm map
git -C "$W27" rm -q scripts/lint.py
run_ss_staged "$W27"
if [ "$SSS_RC" = 0 ] && [ -z "$SSS_OUT" ] \
   && [[ "$SSS_ERR" == *"стенд lint удалён этим коммитом -- не зовётся"* ]]; then
  ok "R27) staged git rm scripts/lint.py -- lint не в S, объявление в stderr"
else
  bad "R27) удаление линта: rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
fi

# --- R28. Ф7: недопустимое имя стенда в вычисляемом правиле --------------------
W28=$(mk_world w28)
printf '#!/usr/bin/env bash\nexit 0\n' > "$W28/tests/scripts/test-ПЛОХО.sh"
git -C "$W28" add tests/scripts/test-ПЛОХО.sh
run_ss_staged "$W28"
if [ "$SSS_RC" = 4 ] && [ -z "$SSS_OUT" ] \
   && [[ "$SSS_ERR" == *"КАРТА: недопустимое имя стенда ПЛОХО в пути tests/scripts/test-ПЛОХО.sh"* ]]; then
  ok "R28) имя вне ^[a-z0-9._-]+\$ в правиле test-<x>.sh -- rc 4 с путём"
else
  bad "R28) недопустимое имя: rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
fi

# --- R29. Ф7: run-all откажет недопустимому имени scope ------------------------
clear_markers "$W"; run_ra "$W" --scope 'a;b'
if refusal_ok "$W" && [[ "$RA_OUT" == *"недопустимое имя"* ]] && [[ "$RA_OUT" == *"a;b"* ]]; then
  ok "R29) --scope 'a;b' -- ОТКАЗ SCOPE: недопустимое имя, rc 2, ноль запусков"
else
  bad "R29) a;b: $RA_WHY"
fi

# --- R30. Ф8: запятая по краям -- пустое поле в любой позиции ------------------
clear_markers "$W"; run_ra "$W" --scope 'a,'
if refusal_ok "$W" && [[ "$RA_OUT" == *"пустое имя"* ]]; then
  ok "R30) --scope 'a,' -- хвостовое пустое поле -- rc 2 «пустое имя», ноль маркеров"
else
  bad "R30) a,: $RA_WHY"
fi

# --- R31. Ф9: порядок исполнения -- сортировка имён, lint последним ------------
W31=$(mk_world w31 aa zz)
clear_markers "$W31"; run_ra "$W31" --scope 'zz,lint,aa'
if [ "$RA_RC" = 0 ] && [ "$(order_log "$W31")" = "$(printf 'aa\nzz\nlint')" ] \
   && [ "$(markers "$W31")" = "aa lint zz " ]; then
  ok "R31) --scope 'zz,lint,aa' -- журнал порядка: aa, zz, lint (lint последним)"
else
  bad "R31) порядок: rc=$RA_RC журнал=[$(order_log "$W31")] markers=[$(markers "$W31")]"
fi

# --- R32. Ф12: нечитаемый --paths файл -> rc 3 (отказ прибора) -----------------
W32=$(mk_world w32)
printf 'alpha/f.txt\n' > "$W32/.paths-secret"
chmod 000 "$W32/.paths-secret"
SS_OUT=$(cd "$W32" && bash tests/stand-scope.sh --paths "$W32/.paths-secret" 2>"$W32/.err")
SS_RC=$?
SS_ERR=$(cat "$W32/.err" 2>/dev/null)
chmod 644 "$W32/.paths-secret"
if [ "$SS_RC" = 3 ] && [[ "$SS_ERR" == *"--paths"* ]] && [ -z "$SS_OUT" ]; then
  ok "R32) нечитаемый файл --paths -- rc 3 (отказ прибора, не «не покрыт»)"
else
  bad "R32) rc=$SS_RC out=[$SS_OUT] err=[$SS_ERR]"
fi

# --- R33. Г5: --tree <hex> --scope run-all -- свидетель под ЭТИМ T ---------------
W33=$(mk_world w33)
TH33=$(git -C "$W33" rev-parse 'HEAD^{tree}')
printf 'y\n' > "$W33/alpha/f.txt"
git -C "$W33" add alpha/f.txt
TI33=$(git -C "$W33" write-tree)
STUB_LOG="$WORK/stub-r33.log"; STUB_RSYNC_REC="$WORK/rsync-r33"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rwa "$W33" --tree "$TH33" --scope run-all
w33want="$(printf 'scope=run-all\nrc=0\nhost=usbox')"
if [ "$RW_RC" = 0 ] && [ "$TH33" != "$TI33" ] \
   && [ "$(cat "$W33/.git/catalyst-witness/$TH33" 2>/dev/null)" = "$w33want" ] \
   && [ ! -e "$W33/.git/catalyst-witness/$TI33" ] \
   && grep -q "rsync -a --no-xattrs --delete .*catalyst-witness/$TH33/\$" "$STUB_LOG" 2>/dev/null \
   && grep -q "cd ~/scratch/catalyst-witness/$TH33 && .*--scope run-all\$" "$STUB_LOG" 2>/dev/null \
   && grep -q "rm -rf ~/scratch/catalyst-witness/$TH33\$" "$STUB_LOG" 2>/dev/null \
   && [ "$(grep -c "catalyst-witness/" "$STUB_LOG")" = "$(grep -c "catalyst-witness/$TH33" "$STUB_LOG")" ] \
   && [ "$(cat "$STUB_RSYNC_REC/alpha/f.txt" 2>/dev/null)" = "x" ]; then
  ok "R33) --tree <hex> --scope run-all -- свидетель под этим T, удалённые команды и снимок -- его"
else
  bad "R33) --tree hex: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R34. Г5/Г1: --tree HEAD -- ссылка разрешается в hex дерева ------------------
W34=$(mk_world w34)
TH34=$(git -C "$W34" rev-parse 'HEAD^{tree}')
STUB_LOG="$WORK/stub-r34.log"; STUB_RSYNC_REC="$WORK/rsync-r34"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rwa "$W34" --tree HEAD --scope a
if [ "$RW_RC" = 0 ] && [ -f "$W34/.git/catalyst-witness/$TH34" ] \
   && [ ! -e "$W34/.git/catalyst-witness/HEAD" ] \
   && grep -q "catalyst-witness/$TH34" "$STUB_LOG" 2>/dev/null \
   && ! grep -q "catalyst-witness/HEAD" "$STUB_LOG" 2>/dev/null \
   && [[ "$RW_OUT" == *"run-witness: свидетель $TH34 scope=a"* ]]; then
  ok "R34) --tree HEAD -- разрешено в hex дерева, свидетель и удалённые команды под hex"
else
  bad "R34) --tree HEAD: rc=$RW_RC out=[$RW_OUT] wit=[$(ls "$W34/.git/catalyst-witness" 2>/dev/null)] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R35. Г5/Г1: --tree <hex блоба> -- отказ, ни одного вызова ssh ----------------
W35=$(mk_world w35)
B35=$(git -C "$W35" rev-parse 'HEAD:alpha/f.txt')
STUB_LOG="$WORK/stub-r35.log"; STUB_RSYNC_REC="$WORK/rsync-r35"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rwa "$W35" --tree "$B35" --scope a
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"--tree не называет дерево этого репозитория"* ]] \
   && [ ! -e "$STUB_LOG" ] && [ -z "$(ls "$W35/.git/catalyst-witness" 2>/dev/null)" ]; then
  ok "R35) --tree <hex блоба> -- ОТКАЗ АРГУМЕНТЫ, ssh/rsync не звались"
else
  bad "R35) --tree блоб: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R36. Г7: rsync rc=23 -- удалённый снимок всё равно убирается ------------------
W36=$(mk_world w36)
printf 'y\n' > "$W36/alpha/f.txt"
git -C "$W36" add alpha/f.txt
T36=$(git -C "$W36" write-tree)
STUB_LOG="$WORK/stub-r36.log"; STUB_RSYNC_REC="$WORK/rsync-r36"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
mkdir -p "$WORK/tmp36"
run_rw "$W36" STUB_RSYNC_RC=23 TMPDIR="$WORK/tmp36"
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"rsync отказ"* ]] \
   && grep -q "rm -rf ~/scratch/catalyst-witness/$T36\$" "$STUB_LOG" 2>/dev/null \
   && [ ! -e "$W36/.git/catalyst-witness/$T36" ] && [ -z "$(ls -A "$WORK/tmp36")" ]; then
  ok "R36) rsync rc=23 -- отказ, rm -rf удалённого снимка T записан, локальные временные убраны"
else
  bad "R36) уборка при отказе rsync: rc=$RW_RC out=[$RW_OUT] tmp=[$(ls -A "$WORK/tmp36")] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R37. Г8: симлинк в дереве T -- ОТКАЗ СНИМОК до доставки -----------------------
W37=$(mk_world w37)
ln -s f.txt "$W37/alpha/link"
git -C "$W37" add alpha/link
STUB_LOG="$WORK/stub-r37.log"; STUB_RSYNC_REC="$WORK/rsync-r37"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W37"
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"ОТКАЗ СНИМОК: дерево несёт симлинк/подмодуль: alpha/link"* ]] \
   && [ ! -e "$STUB_LOG" ]; then
  ok "R37) симлинк в дереве T -- ОТКАЗ СНИМОК с путём, ssh/rsync не звались"
else
  bad "R37) симлинк: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R38. Г8: .gitattributes eol=crlf -- сверка байт снимка с деревом -------------
# CONSTRAINT: исход замерен (FIX3): атрибут eol=crlf сильнее -c core.eol=lf, и
# checkout-index пишет CRLF -- байты расходятся с blob, сверка обязана отказать.
W38=$(mk_world w38)
printf '*.sh text eol=crlf\n' > "$W38/.gitattributes"
git -C "$W38" add .gitattributes
T38=$(git -C "$W38" write-tree)
STUB_LOG="$WORK/stub-r38.log"; STUB_RSYNC_REC="$WORK/rsync-r38"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rwa "$W38" --tree "$T38" --scope a
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"ОТКАЗ СНИМОК: материализация разошлась с деревом"* ]] \
   && [ ! -e "$STUB_LOG" ]; then
  ok "R38) *.sh text eol=crlf -- сверка байт отказывает до доставки"
else
  bad "R38) eol=crlf: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R39. Г9: R/C в stand-scope -- старое имя по карте, новое -- живое -------------
W39=$(mk_world w39)
printf 'tests/scripts/test-a.sh\tb\n' >> "$W39/tests/stand-map.tsv"
git -C "$W39" add tests/stand-map.tsv
git -C "$W39" commit -qm map
git -C "$W39" mv tests/scripts/test-a.sh tests/scripts/test-a2.sh
run_ss_staged "$W39"
t39=""
[ "$SSS_RC" = 0 ] && [ "$SSS_OUT" = "a2,b" ] || t39="R: rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]; "
W39C=$(mk_world w39c)
git -C "$W39C" config diff.renames copies
printf 'tests/scripts/test-b.sh\tc\n' >> "$W39C/tests/stand-map.tsv"
git -C "$W39C" add tests/stand-map.tsv
git -C "$W39C" commit -qm map
cp "$W39C/tests/scripts/test-b.sh" "$W39C/tests/scripts/test-b2.sh"
printf '# m\n' >> "$W39C/tests/scripts/test-b.sh"
git -C "$W39C" add tests/scripts
cst39=$(git -C "$W39C" diff --cached --name-status | grep -c '^C')
run_ss_staged "$W39C"
[ "$cst39" = 1 ] && [ "$SSS_RC" = 0 ] && [ "$SSS_OUT" = "b,b2,c" ] \
  || t39="${t39}C: C-строк=$cst39 rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
if [ -z "$t39" ]; then
  ok "R39) git mv / копия (diff.renames=copies) -- старое имя по карте, новое по правилу"
else
  bad "R39) R/C: $t39"
fi

# --- R40. Г10: фикстура снимка -- РАБОЧЕЕ дерево, отслеживаемые пути, без .git ----
W40=$(mk_world w40)
printf 'INDEX\n' > "$W40/alpha/f.txt"
git -C "$W40" add alpha/f.txt
printf 'WORKTREE\n' > "$W40/alpha/f.txt"
printf 'u\n' > "$W40/alpha/untracked.txt"
D40=$(mktemp -d "$WORK/snapwt.XXXXXX")
snap_of_tree "$W40" "$D40/"
if [ "$(cat "$D40/alpha/f.txt" 2>/dev/null)" = "WORKTREE" ] && [ ! -e "$D40/alpha/untracked.txt" ] \
   && [ ! -e "$D40/.git" ] && [ -f "$D40/tests/run-all.sh" ]; then
  ok "R40) snap_of_tree -- рабочая версия отслеживаемого файла, без неотслеживаемых и без .git"
else
  bad "R40) снимок рабочего дерева: f.txt=[$(cat "$D40/alpha/f.txt" 2>/dev/null)] ls=[$(ls -A "$D40" "$D40/alpha" 2>/dev/null | tr '\n' ' ')]"
fi

# --- R41. Г11: снимок внутри чужого git -- счёт по диску, стенды сходятся ----------
W41=$(mk_world w41)
F41="$WORK/foreign41"
mkdir -p "$F41/snap"
git -C "$F41" init -q
cp -R "$W41/." "$F41/snap/"
rm -rf "$F41/snap/.git"
clear_markers "$F41/snap"; run_ra "$F41/snap" --scope a
if [ "$RA_RC" = 0 ] && [ "$(markers "$F41/snap")" = "a " ] && [[ "$RA_OUT" != *"ЧИСЛО_СТЕНДОВ_НЕ_СОШЛОСЬ"* ]]; then
  ok "R41) run-all в снимке под чужим .git -- ветка без git, число стендов сошлось"
else
  bad "R41) чужой git: rc=$RA_RC markers=[$(markers "$F41/snap")] out=[$RA_OUT]"
fi

# --- R42. Г12: нечитаемая карта -- отказ прибора rc 3 с причиной -------------------
W42=$(mk_world w42)
chmod 000 "$W42/tests/stand-map.tsv"
run_ss "$W42" "alpha/f.txt"
chmod 644 "$W42/tests/stand-map.tsv"
if [ "$SS_RC" = 3 ] && [[ "$SS_ERR" == *"ОТКАЗ ПРИБОР: карта не читается"* ]] && [ -z "$SS_OUT" ]; then
  ok "R42) chmod 000 карты -- rc 3 и названная причина, не «не покрыт»"
else
  bad "R42) нечитаемая карта: rc=$SS_RC out=[$SS_OUT] err=[$SS_ERR]"
fi

# --- R43. Г15: last из окружения не обрывает разбор scope --------------------------
clear_markers "$W"
RA_OUT=$(cd "$W" && env last=x bash tests/run-all.sh --scope a,b 2>&1); RA_RC=$?
if [ "$RA_RC" = 0 ] && [ "$(markers "$W")" = "a b " ]; then
  ok "R43) env last=x --scope a,b -- исполнены оба"
else
  bad "R43) last из окружения: rc=$RA_RC markers=[$(markers "$W")] out=[$RA_OUT]"
fi

# --- R44. Г18: keep-ветка линта -- scripts/lint.py на месте, lint в scope ----------
W44=$(mk_world w44)
printf 'tests/scripts/\ta\nscripts/\tlint\n' >> "$W44/tests/stand-map.tsv"
git -C "$W44" add tests/stand-map.tsv
git -C "$W44" commit -qm map
printf '# edit\n' >> "$W44/scripts/lint.py"
git -C "$W44" add scripts/lint.py
run_ss_staged "$W44"
if [ "$SSS_RC" = 0 ] && [ "$SSS_OUT" = "lint" ] && [[ "$SSS_ERR" != *"удалён этим коммитом"* ]]; then
  ok "R44) staged правка scripts/lint.py -- lint остаётся в S (keep-ветка пробы)"
else
  bad "R44) keep линта: rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
fi

# --- R45. Г1: --tree 'x;true' (тег на дерево) -- в удалённые команды идёт hex -----
W45=$(mk_world w45)
TH45=$(git -C "$W45" rev-parse 'HEAD^{tree}')
git -C "$W45" tag 'x;true' "$TH45"
STUB_LOG="$WORK/stub-r45.log"; STUB_RSYNC_REC="$WORK/rsync-r45"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rwa "$W45" --tree 'x;true' --scope a
w45want="$(printf 'scope=a\nrc=0\nhost=usbox')"
if [ "$RW_RC" = 0 ] && [ "$(cat "$W45/.git/catalyst-witness/$TH45" 2>/dev/null)" = "$w45want" ] \
   && grep '^rsync ' "$STUB_LOG" 2>/dev/null | grep -qF "catalyst-witness/$TH45/" \
   && grep '^ssh ' "$STUB_LOG" 2>/dev/null | grep -qF "cd ~/scratch/catalyst-witness/$TH45 " \
   && grep '^ssh ' "$STUB_LOG" 2>/dev/null | grep -qF "rm -rf ~/scratch/catalyst-witness/$TH45" \
   && ! grep -qF 'x;true' "$STUB_LOG"; then
  ok "R45) --tree 'x;true' (тег на дерево) -- журналы ssh/rsync несут hex T, строки x;true нет"
else
  bad "R45) тег x;true: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R46. отказ уборки по возрасту -- предупреждение, свидетель производится ------
# CONSTRAINT: уборка по возрасту -- локальный find, не удалённая команда: отказ
# подставляется заглушкой find, падающей только на -mtime.
# CONSTRAINT (FIX5 Ж8): заглушка пишет ВСЕ аргументы find построчно -- зуб пинит
# ПОЛИТИКУ уборки (-mtime +30 -delete), а не только факт вызова: мутация порога
# (+30 -> +1) обязана красить именно этот зуб.
W46=$(mk_world w46)
printf 'y\n' > "$W46/alpha/f.txt"
git -C "$W46" add alpha/f.txt
T46=$(git -C "$W46" write-tree)
REALFIND="$(command -v find)"
mkdir -p "$WORK/bin46"
cat > "$WORK/bin46/find" <<EOF2
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$WORK/find-r46.args"
for a in "\$@"; do
  if [ "\$a" = "-mtime" ]; then printf 'stub-find: -mtime rc=1\n' >&2; exit 1; fi
done
exec "$REALFIND" "\$@"
EOF2
chmod +x "$WORK/bin46/find"
STUB_LOG="$WORK/stub-r46.log"; STUB_RSYNC_REC="$WORK/rsync-r46"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
RW_OUT=$(cd "$W46" && env PATH="$WORK/bin46:$BIN:$PATH" bash tests/run-witness.sh 2>&1); RW_RC=$?
mt_line=$(grep -nx -- '-mtime' "$WORK/find-r46.args" 2>/dev/null | head -1 | cut -d: -f1)
mt_line="${mt_line:-}"
plus_line=$(grep -nx -- '+30' "$WORK/find-r46.args" 2>/dev/null | head -1 | cut -d: -f1)
plus_line="${plus_line:-0}"
del_cnt=$(grep -cx -- '-delete' "$WORK/find-r46.args" 2>/dev/null)
del_cnt="${del_cnt:-0}"
if [ "$RW_RC" = 0 ] && [[ "$RW_OUT" == *"run-witness: ПРЕДУПРЕЖДЕНИЕ уборка по возрасту rc=1"* ]] \
   && [ -f "$W46/.git/catalyst-witness/$T46" ] \
   && [ -n "$mt_line" ] && [ "$plus_line" = "$((mt_line+1))" ] && [ "$del_cnt" -ge 1 ]; then
  ok "R46) find -mtime rc=1 -- ПРЕДУПРЕЖДЕНИЕ с rc в выводе, свидетель произведён, rc 0; политика -mtime +30 -delete запинена по аргументам"
else
  bad "R46) уборка по возрасту: rc=$RW_RC mtime@$mt_line +30@$plus_line delete=$del_cnt out=[$RW_OUT]"
fi

# --- R47. FIX5 Ж7: --tree с пустым значением -- отказ, не переход в default --------
W47=$(mk_world w47)
STUB_LOG="$WORK/stub-r47.log"; rm -f "$STUB_LOG"
run_rwa "$W47" --tree '' --scope run-all
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"--tree с пустым значением"* ]] && [ ! -e "$STUB_LOG" ]; then
  ok "R47) --tree '' --scope run-all -- rc 2 с названным пустым значением, удалённых команд нет"
else
  bad "R47) пустой --tree: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R48. FIX5 Ж7: повтор --tree ловится даже после пустого первого значения ------
W48=$(mk_world w48)
STUB_LOG="$WORK/stub-r48.log"; rm -f "$STUB_LOG"
run_rwa "$W48" --tree '' --tree HEAD --scope run-all
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"повтор --tree"* ]] && [ ! -e "$STUB_LOG" ]; then
  ok "R48) --tree '' --tree HEAD -- rc 2 повтор --tree (признак ключа отделён от значения)"
else
  bad "R48) повтор --tree: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R49. FIX5 Ж7: --scope с пустым значением -- отказ, не default-режим ----------
W49=$(mk_world w49)
STUB_LOG="$WORK/stub-r49.log"; rm -f "$STUB_LOG"
run_rwa "$W49" --tree HEAD --scope ''
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"--scope с пустым значением"* ]] && [ ! -e "$STUB_LOG" ]; then
  ok "R49) --tree HEAD --scope '' -- rc 2 с названным пустым значением, удалённых команд нет"
else
  bad "R49) пустой --scope: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R50. FIX6 Ж22: staged git rm стенда без строки в карте -- стенд run-all ------
W50=$(mk_world w50 a b c run-all x)
git -C "$W50" rm -q tests/scripts/test-x.sh
run_ss_staged "$W50"
if [ "$SSS_RC" = 0 ] && [ "$SSS_OUT" = "run-all" ]; then
  ok "R50) staged git rm test-x.sh без строки в карте -- stand-scope --staged: run-all, rc 0"
else
  bad "R50) удалённый стенд без строки: rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
fi

# --- R51. FIX6 Ж18: stand-scope rc 2 без ключей -- rc 3 SCOPE_НЕ_ВЫЧИСЛЕН ---------
W51=$(mk_world w51)
mkdir -p "$W51/nowhere"
printf 'x\n' > "$W51/nowhere/x"
git -C "$W51" add nowhere/x
STUB_LOG="$WORK/stub-r51.log"; rm -f "$STUB_LOG"
run_rw "$W51"
if [ "$RW_RC" = 3 ] && [[ "$RW_OUT" == *"run-witness: ОТКАЗ SCOPE_НЕ_ВЫЧИСЛЕН: tests/stand-scope.sh rc=2"* ]] \
   && [ ! -e "$STUB_LOG" ]; then
  ok "R51) без ключей, stand-scope rc 2 -- run-witness rc 3 SCOPE_НЕ_ВЫЧИСЛЕН с rc источника"
else
  bad "R51) rc stand-scope: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R52. FIX6 Ж18: удалённый прогон rc 1 -- rc 4 ОТКАЗ ПРОГОН --------------------
W52=$(mk_world w52)
printf 'y\n' > "$W52/alpha/f.txt"
git -C "$W52" add alpha/f.txt
STUB_LOG="$WORK/stub-r52.log"; STUB_RSYNC_REC="$WORK/rsync-r52"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W52" STUB_SSH_RC=1
if [ "$RW_RC" = 4 ] && [[ "$RW_OUT" == *"run-witness: ОТКАЗ ПРОГОН: tests/run-all.sh на usbox rc=1"* ]] \
   && [[ "$RW_OUT" == *"stub-ssh: rc=1"* ]]; then
  ok "R52) удалённый прогон rc 1 -- run-witness rc 4 и ОТКАЗ ПРОГОН с хостом и rc"
else
  bad "R52) rc прогона: rc=$RW_RC out=[$RW_OUT]"
fi

# --- R53. FIX6 Ж19: каталог свидетеля без права записи -- отказ, строки свидетеля нет
# CONSTRAINT: право записи снимается заглушкой ssh В МОМЕНТ прогона агрегатора:
# лог <T>.log к этому времени уже открыт, и отказ приходится именно на запись
# свидетеля.
W53=$(mk_world w53)
printf 'y\n' > "$W53/alpha/f.txt"
git -C "$W53" add alpha/f.txt
T53=$(git -C "$W53" write-tree)
mkdir -p "$W53/.git/catalyst-witness"
STUB_LOG="$WORK/stub-r53.log"; STUB_RSYNC_REC="$WORK/rsync-r53"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W53" STUB_RO_DIR="$W53/.git/catalyst-witness"
chmod u+w "$W53/.git/catalyst-witness"
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"свидетель не записан"* ]] \
   && [[ "$RW_OUT" != *"run-witness: свидетель $T53 scope="* ]] \
   && [ ! -e "$W53/.git/catalyst-witness/$T53" ]; then
  ok "R53) каталог свидетеля без записи -- rc 2, «свидетель не записан», строки «свидетель … scope=» нет"
else
  bad "R53) запись свидетеля: rc=$RW_RC out=[$RW_OUT]"
fi

# --- R54..R57. FIX6 Ж21: сигнал во время rsync -- временные и удалённый снимок убраны
# CONSTRAINT: сигнал уходит после старта заглушки rsync (она спит 20 с); код
# выхода 128+N доказывает, что прогон кончился сигналом, а не штатно.
rw_sig() {   # <номер> <сигнал> <ожидаемый rc>
  local n="$1" sig="$2" want="$3" w T td pid rc left i log mark
  w=$(mk_world "w$n")
  printf 'y\n' > "$w/alpha/f.txt"
  git -C "$w" add alpha/f.txt
  T=$(git -C "$w" write-tree)
  td="$WORK/tmp$n"; mkdir -p "$td"
  log="$WORK/stub-r$n.log"; mark="$WORK/rsync-r$n.started"; rm -f "$log" "$mark"
  ( cd "$w" && exec env PATH="$BIN:$PATH" TMPDIR="$td" STUB_LOG="$log" STUB_RSYNC_REC="$WORK/rsync-r$n" \
      STUB_RSYNC_SLEEP=20 STUB_RSYNC_MARK="$mark" python3 -c "$SIGDFL" bash tests/run-witness.sh ) > "$WORK/out-r$n" 2>&1 &
  pid=$!
  for i in $(seq 1 300); do
    [ -e "$mark" ] && break
    sleep 0.1
  done
  kill -"$sig" "$pid"
  wait "$pid"; rc=$?
  left=$(ls -A "$td" | grep '^catalyst-witness' | tr '\n' ' ')
  if [ -e "$mark" ] && [ "$rc" = "$want" ] && [ -z "$left" ] \
     && grep -q "^ssh .*rm -rf ~/scratch/catalyst-witness/$T\$" "$log"; then
    ok "R$n) $sig во время rsync -- rc=$rc, в TMPDIR нет catalyst-witness*, удалённый rm -rf записан"
  else
    bad "R$n) $sig во время rsync: rc=$rc (ждали $want) started=$([ -e "$mark" ] && echo 1 || echo 0) остатки=[$left] stub=[$(cat "$log" 2>/dev/null)] out=[$(cat "$WORK/out-r$n")]"
  fi
}
rw_sig 54 HUP 129
rw_sig 55 INT 130
rw_sig 56 QUIT 131
rw_sig 57 TERM 143

# --- R58. FIX6 Ж20: префикс отказа один -- «ОТКАЗ ОТКАЗ» не печатается -------------
W58=$(mk_world w58)
STUB_LOG="$WORK/stub-r58.log"; rm -f "$STUB_LOG"
run_rwa "$W58" --tree
n58=$(printf '%s\n' "$RW_OUT" | grep -o 'run-witness: ОТКАЗ АРГУМЕНТЫ' | wc -l | tr -d ' ')
if [ "$RW_RC" = 2 ] && [ "$n58" = 1 ] && [[ "$RW_OUT" != *"ОТКАЗ ОТКАЗ"* ]]; then
  ok "R58) --tree без значения -- «run-witness: ОТКАЗ АРГУМЕНТЫ» ровно один раз, «ОТКАЗ ОТКАЗ» нет"
else
  bad "R58) префикс отказа: rc=$RW_RC вхождений=$n58 out=[$RW_OUT]"
fi

# --- R59. FIX7 Ж30: второй сигнал во время уборки её не рвёт ----------------------
# CONSTRAINT: заглушка ssh на удалённом rm -rf шлёт TERM производителю (её
# родителю) и продолжает работу: уборка уже идёт в on_exit, и сигнал обязан не
# оборвать её -- удалённая строка «убран» и локальные временные остаются за ней.
W59=$(mk_world w59)
printf 'y\n' > "$W59/alpha/f.txt"
git -C "$W59" add alpha/f.txt
T59=$(git -C "$W59" write-tree)
STUB_LOG="$WORK/stub-r59.log"; STUB_RSYNC_REC="$WORK/rsync-r59"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
mkdir -p "$WORK/tmp59"
run_rw "$W59" STUB_RSYNC_RC=23 STUB_KILL_ON_RM=1 TMPDIR="$WORK/tmp59"
left59=$(ls -A "$WORK/tmp59" | grep '^catalyst-witness' | tr '\n' ' ')
if [ "$RW_RC" = 2 ] && [ -z "$left59" ] \
   && [[ "$RW_OUT" == *"run-witness: удалённый снимок $T59 убран"* ]] \
   && grep -qx 'rm-continued' "$STUB_LOG" 2>/dev/null; then
  ok "R59) TERM во время удалённого rm -rf -- rc 2, «удалённый снимок … убран», в TMPDIR нет catalyst-witness*"
else
  bad "R59) сигнал во время уборки: rc=$RW_RC остатки=[$left59] out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R60. FIX7 Ж31: удалённый прогон не начался -- ПРОГОН_НЕ_НАЧАТ, rc 2 -----------
W60=$(mk_world w60)
T60=$(git -C "$W60" rev-parse 'HEAD^{tree}')
STUB_LOG="$WORK/stub-r60.log"; STUB_RSYNC_REC="$WORK/rsync-r60"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
RW_OUT=$(cd "$W60" && env PATH="$BIN:$PATH" STUB_SSH_NOSTART=1 STUB_SSH_RC=255 bash tests/run-witness.sh --tree "$T60" --scope run-all 2>&1); RW_RC=$?
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"ПРОГОН_НЕ_НАЧАТ: ssh usbox rc=255"* ]] \
   && [[ "$RW_OUT" != *"ОТКАЗ ПРОГОН:"* ]] && [ ! -e "$W60/.git/catalyst-witness/$T60" ]; then
  ok "R60) ssh rc 255 без метки начала -- rc 2 ПРОГОН_НЕ_НАЧАТ с rc ssh, не ОТКАЗ ПРОГОН, свидетеля нет"
else
  bad "R60) прогон не начат: rc=$RW_RC out=[$RW_OUT]"
fi

# --- R61. FIX7 Ж31: журнал прогона не создаётся -- отказ до удалённого прогона ------
W61=$(mk_world w61)
printf 'y\n' > "$W61/alpha/f.txt"
git -C "$W61" add alpha/f.txt
T61=$(git -C "$W61" write-tree)
mkdir -p "$W61/.git/catalyst-witness/$T61.log"
STUB_LOG="$WORK/stub-r61.log"; STUB_RSYNC_REC="$WORK/rsync-r61"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W61"
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"журнал прогона не создан"* ]] \
   && [ -f "$STUB_LOG" ] && ! grep -q 'run-all\.sh' "$STUB_LOG"; then
  ok "R61) <T>.log -- каталог -- rc 2 «журнал прогона не создан», агрегатор не звался"
else
  bad "R61) журнал прогона: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R62. FIX7 Ж32: префикс отказа один -- ни один fail производителя не начинается с ОТКАЗ
# CONSTRAINT: grep rc 1 -- «совпадений нет»; rc 2 (файл не прочитан) -- красный,
# а не ноль совпадений.
n62=$(grep -cE 'fail[[:space:]]+["'"'"']ОТКАЗ' "$ROOT_C/tests/run-witness.sh"); g62=$?
if [ "$g62" = 1 ] && [ "$n62" = 0 ]; then
  ok "R62) tests/run-witness.sh: вызовов fail с аргументом «ОТКАЗ…» -- 0"
else
  bad "R62) префикс ОТКАЗ в fail производителя: grep rc=$g62 совпадений=$n62 [$(grep -nE 'fail[[:space:]]+["'"'"']ОТКАЗ' "$ROOT_C/tests/run-witness.sh")]"
fi

# --- R63. FIX7 Ж34: без ключей сопоставитель берётся из ИНДЕКСА -------------------
# CONSTRAINT: стенд b даёт только строка карты, которой нет в HEAD: HEAD-проход
# (Ж35) его не восполнит, и исполненная вместо индексной рабочая копия («exit 0»)
# видна по scope.
W63=$(mk_world w63 a b c run-all)
printf 'tests/stand-map.tsv\trun-all\n' >> "$W63/tests/stand-map.tsv"
git -C "$W63" add tests/stand-map.tsv
git -C "$W63" commit -qm map
mkdir -p "$W63/newdir"
printf 'n\n' > "$W63/newdir/x.txt"
printf 'newdir/\tb\n' >> "$W63/tests/stand-map.tsv"
git -C "$W63" add newdir/x.txt tests/stand-map.tsv
T63=$(git -C "$W63" write-tree)
printf 'exit 0\n' > "$W63/tests/stand-scope.sh"
STUB_LOG="$WORK/stub-r63.log"; STUB_RSYNC_REC="$WORK/rsync-r63"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W63"
if [ "$RW_RC" = 0 ] && grep -qF -- "bash tests/run-all.sh --scope $(printf '%q' b,run-all)" "$STUB_LOG" 2>/dev/null \
   && printf '%s\n' "$RW_OUT" | grep -qxF -- "run-witness: свидетель $T63 scope=b,run-all" \
   && [ -f "$W63/.git/catalyst-witness/$T63" ]; then
  ok "R63) рабочая stand-scope.sh = «exit 0» (не staged) -- исполнена индексная копия, run-all.sh позван, свидетель записан"
else
  bad "R63) сопоставитель из индекса: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R64. FIX7 Ж34: stand-scope --staged читает карту из ИНДЕКСА ------------------
W64=$(mk_world w64 a b c run-all)
printf 'beta/new.txt\trun-all\n' >> "$W64/tests/stand-map.tsv"
git -C "$W64" add tests/stand-map.tsv
git -C "$W64" commit -qm idx-map
printf 'alpha/\ta\nalpha/both.txt\tc\nbeta/exact.txt\tb\ngamma/\t-\ndocs/\t-\nbeta/new.txt\t-\n' > "$W64/tests/stand-map.tsv"
printf 'n\n' > "$W64/beta/new.txt"
git -C "$W64" add beta/new.txt
git -C "$W64" diff --quiet -- tests/stand-map.tsv; dq64=$?
run_ss_staged "$W64"
if [ "$dq64" = 1 ] && [ "$SSS_RC" = 0 ] && [ "$SSS_OUT" = "run-all" ]; then
  ok "R64) индексная карта: beta/new.txt -> run-all, рабочая (не staged) -> - -- stand-scope --staged: run-all"
else
  bad "R64) карта из индекса: рабочая≠индексной=$dq64 rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
fi

# --- R65. FIX7 Ж34: стенд карты проверяется по ИНДЕКСУ, не по диску ---------------
W65=$(mk_world w65)
printf 'alpha/\tx\n' >> "$W65/tests/stand-map.tsv"
git -C "$W65" add tests/stand-map.tsv
git -C "$W65" commit -qm idx-map
printf '#!/usr/bin/env bash\nexit 0\n' > "$W65/tests/scripts/test-x.sh"
printf 'y\n' > "$W65/alpha/f.txt"
git -C "$W65" add alpha/f.txt
run_ss_staged "$W65"
if [ -f "$W65/tests/scripts/test-x.sh" ] && [ "$SSS_RC" = 4 ] && [[ "$SSS_ERR" == *"КАРТА: неизвестный стенд x"* ]]; then
  ok "R65) карта в индексе называет x, test-x.sh только на диске -- rc 4 КАРТА: неизвестный стенд x"
else
  bad "R65) стенд по индексу: rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
fi

# --- R66. FIX8 Ж37: метка начала -- часть удалённой команды, перед env -u -----------
W66=$(mk_world w66)
printf 'y\n' > "$W66/alpha/f.txt"
git -C "$W66" add alpha/f.txt
STUB_LOG="$WORK/stub-r66.log"; STUB_RSYNC_REC="$WORK/rsync-r66"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W66"
n66="printf 'run-witness: прогон начат\\n' && env -u CATALYST_STANDS"
if [ "$RW_RC" = 0 ] && grep '^ssh ' "$STUB_LOG" 2>/dev/null | grep -qF -- "$n66"; then
  ok "R66) удалённая команда несёт «printf 'run-witness: прогон начат\\n' &&» перед env -u CATALYST_STANDS (журнал argv ssh)"
else
  bad "R66) метка начала в удалённой команде: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R67. FIX8 Ж36: run-witness из tests/ на валидном индексе -- без ложного отказа ---
W67=$(mk_world w67)
printf 'y\n' > "$W67/alpha/f.txt"
git -C "$W67" add alpha/f.txt
T67=$(git -C "$W67" write-tree)
STUB_LOG="$WORK/stub-r67.log"; STUB_RSYNC_REC="$WORK/rsync-r67"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
RW_OUT=$(cd "$W67/tests" && env PATH="$BIN:$PATH" bash run-witness.sh 2>&1); RW_RC=$?
if [ "$RW_RC" = 0 ] && [[ "$RW_OUT" != *"ПРИБОР_НЕДОСТУПЕН"* ]] \
   && [[ "$RW_OUT" == *"run-witness: свидетель $T67 scope=a"* ]] && [ -f "$W67/.git/catalyst-witness/$T67" ]; then
  ok "R67) cd tests && bash run-witness.sh -- свидетель $T67 scope=a, без ПРИБОР_НЕДОСТУПЕН"
else
  bad "R67) run-witness из подкаталога: rc=$RW_RC out=[$RW_OUT]"
fi

# --- R68. FIX8 Ж36: stand-scope --staged из tests/ -- тот же scope, что из корня -----
W68=$(mk_world w68)
printf 'y\n' > "$W68/alpha/f.txt"
printf 'y\n' > "$W68/beta/exact.txt"
git -C "$W68" add alpha/f.txt beta/exact.txt
s68r=$(cd "$W68" && bash tests/stand-scope.sh --staged 2>"$W68/.err-r"); r68r=$?
s68s=$(cd "$W68/tests" && bash stand-scope.sh --staged 2>"$W68/.err-s"); r68s=$?
if [ "$r68r" = 0 ] && [ "$r68s" = 0 ] && [ "$s68r" = "a,b" ] && [ "$s68s" = "$s68r" ]; then
  ok "R68) stand-scope --staged из tests/ и из корня -- один scope a,b, rc 0"
else
  bad "R68) из подкаталога: корень rc=$r68r [$s68r] err=[$(cat "$W68/.err-r")]; tests/ rc=$r68s [$s68s] err=[$(cat "$W68/.err-s")]"
fi

# --- R69. FIX8 Ж38: ошибка аргументов stand-scope -- rc 3 ------------------------------
W69=$(mk_world w69)
t69=""
for a69 in '' '--bogus' '--staged --staged' '--paths' '--staged --map-rev' '--staged --map-rev X' \
           '--paths /dev/null --map-rev HEAD' '--paths /dev/null --skip-uncovered'; do
  # shellcheck disable=SC2086
  o69=$(cd "$W69" && bash tests/stand-scope.sh $a69 2>&1); r69=$?
  [ "$r69" = 3 ] && [[ "$o69" == *"АРГУМЕНТЫ"* ]] || t69="${t69}«$a69»: rc=$r69 [$o69]; "
done
if [ -z "$t69" ]; then
  ok "R69) stand-scope: без режима / неизвестный / повтор режима / --paths без значения / --map-rev без значения и не HEAD / --map-rev и --skip-uncovered без --staged -- rc 3 АРГУМЕНТЫ"
else
  bad "R69) ошибки аргументов: $t69"
fi

# --- R70. FIX8 Ж38: run-witness, git rev-parse --show-toplevel rc=128 -- отказ с командой
W70=$(mk_world w70)
printf 'y\n' > "$W70/alpha/f.txt"
git -C "$W70" add alpha/f.txt
mkdir -p "$WORK/bin70"
cat > "$WORK/bin70/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ] && [ "\${2:-}" = "--show-toplevel" ]; then
  printf 'FAIL %s\n' "\$*" >> "$WORK/stub-git70.log"
  printf 'stub-git: rev-parse --show-toplevel rc=128\n' >&2
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$WORK/bin70/git"
STUB_LOG="$WORK/stub-r70.log"; rm -f "$STUB_LOG"
RW_OUT=$(cd "$W70" && env PATH="$WORK/bin70:$BIN:$PATH" bash tests/run-witness.sh 2>&1); RW_RC=$?
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"run-witness: ОТКАЗ ПРИБОР_НЕДОСТУПЕН: git rev-parse --show-toplevel"* ]] \
   && grep -qxF 'FAIL rev-parse --show-toplevel' "$WORK/stub-git70.log" && [ ! -e "$STUB_LOG" ]; then
  ok "R70) git rev-parse --show-toplevel rc=128 -- rc 2 ПРИБОР_НЕДОСТУПЕН: git rev-parse --show-toplevel, ssh не звался"
else
  bad "R70) отказ --show-toplevel: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

# --- R71..R73. FIX8 Ж40: отказ git в staged-чтении карты и стенда -- rc 3 -------------
# CONSTRAINT: заглушка отказывает ровно одной команде (условие -- её argv), прочие
# вызовы идут в настоящий git.
ss_gitfail() {   # <номер> <условие bash над "$@" заглушки> <ожидаемая строка stderr>
  local n="$1" cond="$2" want="$3" w o r e
  w=$(mk_world "w$n")
  printf 'y\n' > "$w/alpha/f.txt"
  git -C "$w" add alpha/f.txt
  mkdir -p "$WORK/bin$n"
  cat > "$WORK/bin$n/git" <<EOF2
#!/usr/bin/env bash
if $cond; then
  printf 'FAIL %s\n' "\$*" >> "$WORK/stub-git$n.log"
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
  chmod +x "$WORK/bin$n/git"
  o=$(cd "$w" && env PATH="$WORK/bin$n:$PATH" bash tests/stand-scope.sh --staged 2>"$w/.err"); r=$?
  e=$(cat "$w/.err")
  if [ "$r" = 3 ] && [ -z "$o" ] && [[ "$e" == *"$want"* ]] && [ -s "$WORK/stub-git$n.log" ]; then
    ok "R$n) stand-scope --staged: отказ «$want» -- rc 3 (прибор), журнал заглушки: $(head -1 "$WORK/stub-git$n.log")"
  else
    bad "R$n) отказ git: rc=$r out=[$o] err=[$e] журнал=[$(cat "$WORK/stub-git$n.log" 2>/dev/null)]"
  fi
}
ss_gitfail 71 '[ "$1" = ls-files ] && [ "${2:-}" = -s ] && [ "${3:-}" = -- ] && [ "${4:-}" = tests/stand-map.tsv ]' \
  'git ls-files карты отказ (rc=128)'
ss_gitfail 72 '[ "$1" = show ] && [ "${2:-}" = :tests/stand-map.tsv ]' \
  'git show карты отказ (rc=128)'
ss_gitfail 73 '[ "$1" = ls-files ] && [ "${2:-}" = -- ] && [[ "${3:-}" == tests/scripts/test-*.sh ]]' \
  'git ls-files стенда отказ (rc=128)'

# --- R74. FIX8 Ж40: карта в индексе есть, с диска удалена -- scope прежний -----------
W74=$(mk_world w74)
printf 'y\n' > "$W74/alpha/f.txt"
git -C "$W74" add alpha/f.txt
s74a=$(cd "$W74" && bash tests/stand-scope.sh --staged 2>/dev/null); r74a=$?
rm "$W74/tests/stand-map.tsv"
run_ss_staged "$W74"
if [ "$r74a" = 0 ] && [ "$s74a" = "a" ] && [ ! -e "$W74/tests/stand-map.tsv" ] \
   && [ "$SSS_RC" = 0 ] && [ "$SSS_OUT" = "$s74a" ]; then
  ok "R74) рабочая tests/stand-map.tsv удалена, индексная на месте -- stand-scope --staged: прежний scope a"
else
  bad "R74) карта только в индексе: до [$s74a] rc=$r74a; после rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
fi

# --- R75. FIX8 Ж40: карта изменена только в индексе, в HEAD другая -- scope по индексной
W75=$(mk_world w75 a b c run-all)
printf 'tests/stand-map.tsv\trun-all\n' >> "$W75/tests/stand-map.tsv"
git -C "$W75" add tests/stand-map.tsv
git -C "$W75" commit -qm map
printf 'alpha/\ta\nalpha/both.txt\tc\nbeta/exact.txt\tc\ngamma/\t-\ndocs/\t-\ntests/stand-map.tsv\trun-all\n' > "$W75/tests/stand-map.tsv"
printf 'y\n' > "$W75/beta/exact.txt"
git -C "$W75" add tests/stand-map.tsv beta/exact.txt
h75=$(git -C "$W75" show HEAD:tests/stand-map.tsv | grep -c "^beta/exact.txt$(printf '\t')b\$")
run_ss_staged "$W75"
if [ "$h75" = 1 ] && [ "$SSS_RC" = 0 ] && [ "$SSS_OUT" = "c,run-all" ]; then
  ok "R75) HEAD: beta/exact.txt -> b, индекс: -> c -- stand-scope --staged: c,run-all (индексная карта)"
else
  bad "R75) индексная карта против HEAD: строка b в HEAD=$h75 rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
fi

# --- R76. FIX8 Ж40 F8: TERM самому stand-scope посреди staged-прохода -- остатков нет --
# CONSTRAINT: заглушка git держит staged-проход на diff --cached (оба временных
# файла уже созданы) и отмечает вход в окно; TERM адресован процессу stand-scope.
W76=$(mk_world w76)
printf 'y\n' > "$W76/alpha/f.txt"
git -C "$W76" add alpha/f.txt
mkdir -p "$WORK/bin76" "$WORK/tmp76"
cat > "$WORK/bin76/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = "diff" ] && [ "\${2:-}" = "--cached" ] && [ "\${3:-}" = "--name-status" ]; then
  : > "$WORK/git76.started"
  sleep 3
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$WORK/bin76/git"
( cd "$W76" && exec env PATH="$WORK/bin76:$PATH" TMPDIR="$WORK/tmp76" python3 -c "$SIGDFL" bash tests/stand-scope.sh --staged ) > "$WORK/out-r76" 2>&1 &
pid76=$!
for i in $(seq 1 300); do
  [ -e "$WORK/git76.started" ] && break
  sleep 0.1
done
held76=$(ls -A "$WORK/tmp76" | grep -c '^stand-scope\.')
kill -TERM "$pid76"
wait "$pid76"; rc76=$?
left76=$(ls -A "$WORK/tmp76" | grep '^stand-scope\.' | tr '\n' ' ')
if [ -e "$WORK/git76.started" ] && [ "$held76" = 2 ] && [ "$rc76" = 143 ] && [ -z "$left76" ]; then
  ok "R76) TERM stand-scope посреди staged-прохода (2 временных файла) -- rc=143, остатков stand-scope.* нет"
else
  bad "R76) сигнал stand-scope: rc=$rc76 (ждали 143) started=$([ -e "$WORK/git76.started" ] && echo 1 || echo 0) было=$held76 остатки=[$left76] out=[$(cat "$WORK/out-r76")]"
fi

# --- R77..R79. FIX8 Ж35 И4: scope двери и свидетеля равны на входах И1--И3 ------------
# CONSTRAINT: мир несёт дверь и строки карты C для сопоставителя и карты
# (tests/stand-scope.sh -> run-all,plugin-gate; tests/stand-map.tsv -> run-all);
# scope двери -- из её СВИДЕТЕЛЯ_НЕТ (дверь зовётся до свидетеля), scope
# свидетеля -- из его строки «свидетель <T> scope=<S>».
pair_world() {   # <имя мира> -> путь мира
  local w
  w=$(mk_world "$1" a b c run-all plugin-gate)
  mkdir -p "$w/.githooks"
  cp "$ROOT_C/.githooks/pre-commit" "$w/.githooks/pre-commit"
  printf 'tests/stand-scope.sh\trun-all,plugin-gate\ntests/stand-map.tsv\trun-all\n.githooks/\tplugin-gate\n' >> "$w/tests/stand-map.tsv"
  git -C "$w" add -A
  git -C "$w" commit -qm pair
  printf '%s' "$w"
}
pair_check() {   # <номер> <мир> <ожидаемый scope> <имя входа>
  local n="$1" w="$2" want="$3" what="$4" dout drc ds wout wrc ws
  dout=$(cd "$w" && bash .githooks/pre-commit 2>&1); drc=$?
  ds=""; [[ "$dout" =~ нужен\ scope\ ([a-z0-9._,-]+)\; ]] && ds="${BASH_REMATCH[1]}"
  STUB_LOG="$WORK/stub-r$n.log"; STUB_RSYNC_REC="$WORK/rsync-r$n"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
  wout=$(cd "$w" && env PATH="$BIN:$PATH" bash tests/run-witness.sh 2>&1); wrc=$?
  ws=""; [[ "$wout" =~ свидетель\ [0-9a-f]+\ scope=([a-z0-9._,-]+) ]] && ws="${BASH_REMATCH[1]}"
  if [ "$drc" = 1 ] && [ "$wrc" = 0 ] && [ -n "$ds" ] && [ "$ds" = "$ws" ] && [ "$ds" = "$want" ]; then
    ok "R$n) И4 на входе $what -- scope двери = scope свидетеля = $ds"
  else
    bad "R$n) И4 на входе $what: дверь rc=$drc scope=[$ds] свидетель rc=$wrc scope=[$ws] ждали [$want]; дверь=[$dout] свидетель=[$wout]"
  fi
}
W77=$(pair_world w77)
printf '#!/usr/bin/env bash\nprintf "\\n"\nexit 0\n' > "$W77/tests/stand-scope.sh"
git -C "$W77" add tests/stand-scope.sh
pair_check 77 "$W77" "plugin-gate,run-all" "И1 (индексный сопоставитель кастрирован)"
W78=$(pair_world w78)
sed -i "s/^tests\/stand-map\.tsv$(printf '\t')run-all\$/tests\/stand-map.tsv$(printf '\t')-/" "$W78/tests/stand-map.tsv"
git -C "$W78" add tests/stand-map.tsv
pair_check 78 "$W78" "run-all" "И2 (индексная карта кастрирована)"
W79=$(pair_world w79)
mkdir -p "$W79/newdir"
printf 'n\n' > "$W79/newdir/x.txt"
printf 'newdir/\ta\n' >> "$W79/tests/stand-map.tsv"
git -C "$W79" add newdir/x.txt tests/stand-map.tsv
pair_check 79 "$W79" "a,run-all" "И3 (новый путь и строка карты только в индексе)"

# CONSTRAINT: вариант свидетеля -- копия мира со вставкой после строки-якоря
# (ровно одно вхождение, иначе вариант не строится и зуб красный).
rw_variant() {   # <мир> <строка-якорь целиком> <вставка>
  python3 - "$1/tests/run-witness.sh" "$2" "$3" <<'EOF2'
import io, sys
p, anchor, ins = sys.argv[1:]
lines = io.open(p, encoding='utf-8').read().split('\n')
idx = [i for i, l in enumerate(lines) if l == anchor]
if len(idx) != 1:
    sys.exit('якорь найден %d раз: %s' % (len(idx), anchor))
i = idx[0]
ind = lines[i][:len(lines[i]) - len(lines[i].lstrip())]
lines.insert(i + 1, ind + ins)
io.open(p, 'w', encoding='utf-8').write('\n'.join(lines))
EOF2
}

# --- R80. FIX9 Ж42: ошибка раскрытия в стадии уборки -- rc 3, свидетель не записан ----
# CONSTRAINT: `${#X[@]}` неопределённого массива бросает составную команду, и скрипт
# идёт дальше (замер bash 3.2.57 и 5.2.26); без учёта стадий свидетель писался с rc 0.
W80=$(mk_world w80)
printf 'y\n' > "$W80/alpha/f.txt"
git -C "$W80" add alpha/f.txt
T80=$(git -C "$W80" write-tree)
v80=0; rw_variant "$W80" 'remote_cleanup' ': "${#J42_UNDEF[@]}"' 2>"$WORK/v80.err" || v80=$?
STUB_LOG="$WORK/stub-r80.log"; STUB_RSYNC_REC="$WORK/rsync-r80"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W80"
if [ "$v80" = 0 ] && [ "$RW_RC" = 3 ] && [ ! -e "$W80/.git/catalyst-witness/$T80" ] \
   && [[ "$RW_OUT" == *"J42_UNDEF: unbound variable"* ]] \
   && [[ "$RW_OUT" == *"run-witness: ОТКАЗ СТАДИЯ_НЕ_ЗАВЕРШЕНА: cleanup "* ]]; then
  ok "R80) \${#J42_UNDEF[@]} в стадии cleanup -- rc 3 СТАДИЯ_НЕ_ЗАВЕРШЕНА: cleanup, файла свидетеля нет"
else
  bad "R80) брошенная стадия: вариант rc=$v80 [$(cat "$WORK/v80.err")] rc=$RW_RC file=[$(cat "$W80/.git/catalyst-witness/$T80" 2>/dev/null)] out=[$RW_OUT]"
fi

# --- R81. FIX9 Ж42: стадия метки начала вернулась раньше конца -- rc 3 ----------------
# CONSTRAINT: удалённая команда метки не печатает (STUB_SSH_NOSTART), ssh rc 0: без
# учёта стадий досрочный возврат проверки метки давал свидетеля непрошедшего прогона.
W81=$(mk_world w81)
printf 'y\n' > "$W81/alpha/f.txt"
git -C "$W81" add alpha/f.txt
T81=$(git -C "$W81" write-tree)
v81=0; rw_variant "$W81" 'stage_started() {' 'return 0' 2>"$WORK/v81.err" || v81=$?
STUB_LOG="$WORK/stub-r81.log"; STUB_RSYNC_REC="$WORK/rsync-r81"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W81" STUB_SSH_NOSTART=1
if [ "$v81" = 0 ] && [ "$RW_RC" = 3 ] && [ ! -e "$W81/.git/catalyst-witness/$T81" ] \
   && [[ "$RW_OUT" == *"run-witness: ОТКАЗ СТАДИЯ_НЕ_ЗАВЕРШЕНА: started "* ]]; then
  ok "R81) return 0 в начале stage_started, метки нет -- rc 3 СТАДИЯ_НЕ_ЗАВЕРШЕНА: started, файла свидетеля нет"
else
  bad "R81) досрочный return: вариант rc=$v81 [$(cat "$WORK/v81.err")] rc=$RW_RC file=[$(cat "$W81/.git/catalyst-witness/$T81" 2>/dev/null)] out=[$RW_OUT]"
fi

# --- R82. FIX9 Ж42: штатные пути свидетеля -- без ложного СТАДИЯ_НЕ_ЗАВЕРШЕНА -------------
# CONSTRAINT: три входа с разными наборами :skip -- индекс с HEAD-проходом, --tree,
# «стенды не нужны»; каждый обязан пройти с rc 0 и своей строкой.
r82=""
W82=$(mk_world w82)
printf 'y\n' > "$W82/alpha/f.txt"
git -C "$W82" add alpha/f.txt
T82=$(git -C "$W82" write-tree)
STUB_LOG="$WORK/stub-r82.log"; STUB_RSYNC_REC="$WORK/rsync-r82"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rw "$W82"
[ "$RW_RC" = 0 ] && [ -f "$W82/.git/catalyst-witness/$T82" ] && [[ "$RW_OUT" == *"run-witness: свидетель $T82 scope=a"* ]] \
  && [[ "$RW_OUT" != *"СТАДИЯ_НЕ_ЗАВЕРШЕНА"* ]] || r82="$r82 индекс: rc=$RW_RC [$RW_OUT];"
TH82=$(git -C "$W82" rev-parse 'HEAD^{tree}')
STUB_LOG="$WORK/stub-r82t.log"; STUB_RSYNC_REC="$WORK/rsync-r82t"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
run_rwa "$W82" --tree "$TH82" --scope b
[ "$RW_RC" = 0 ] && [ -f "$W82/.git/catalyst-witness/$TH82" ] && [[ "$RW_OUT" == *"run-witness: свидетель $TH82 scope=b"* ]] \
  && [[ "$RW_OUT" != *"СТАДИЯ_НЕ_ЗАВЕРШЕНА"* ]] || r82="$r82 --tree: rc=$RW_RC [$RW_OUT];"
W82n=$(mk_world w82n)
printf 'd\n' > "$W82n/docs/readme"
git -C "$W82n" add docs/readme
STUB_LOG="$WORK/stub-r82n.log"; rm -f "$STUB_LOG"
run_rw "$W82n"
[ "$RW_RC" = 0 ] && [ "$RW_OUT" = "run-witness: стенды не нужны (изменённые пути не мерит ни один стенд)" ] \
  && [ ! -e "$STUB_LOG" ] || r82="$r82 стенды не нужны: rc=$RW_RC [$RW_OUT];"
if [ -z "$r82" ]; then
  ok "R82) индекс с HEAD-проходом, --tree, «стенды не нужны» -- rc 0 без СТАДИЯ_НЕ_ЗАВЕРШЕНА"
else
  bad "R82) штатные пути:$r82"
fi

# --- R83..R85. FIX9 Ж44: отказ git HEAD-прохода свидетеля -- rc 3 SCOPE_НЕ_ВЫЧИСЛЕН ------
# CONSTRAINT: заглушка отказывает ровно одной команде (условие -- её argv), прочие
# вызовы идут в настоящий git; ssh не зовётся.
rw_gitfail() {   # <номер> <условие bash над "$@" заглушки> <ожидаемая строка stderr>
  local n="$1" cond="$2" want="$3" w
  w=$(mk_world "w$n")
  printf 'y\n' > "$w/alpha/f.txt"
  git -C "$w" add alpha/f.txt
  mkdir -p "$WORK/gbin$n"
  cat > "$WORK/gbin$n/git" <<EOF2
#!/usr/bin/env bash
if $cond; then
  printf 'FAIL %s\n' "\$*" >> "$WORK/stub-git$n.log"
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
  chmod +x "$WORK/gbin$n/git"
  STUB_LOG="$WORK/stub-r$n.log"; rm -f "$STUB_LOG"
  RW_OUT=$(cd "$w" && env PATH="$WORK/gbin$n:$BIN:$PATH" bash tests/run-witness.sh 2>&1); RW_RC=$?
  if [ "$RW_RC" = 3 ] && [[ "$RW_OUT" == *"run-witness: ОТКАЗ SCOPE_НЕ_ВЫЧИСЛЕН: $want"* ]] \
     && [ -s "$WORK/stub-git$n.log" ] && [ ! -e "$STUB_LOG" ]; then
    ok "R$n) заглушка git rc=128 -- rc 3 SCOPE_НЕ_ВЫЧИСЛЕН: $want, ssh не звался"
  else
    bad "R$n) отказ git HEAD-прохода: rc=$RW_RC out=[$RW_OUT] журнал=[$(cat "$WORK/stub-git$n.log" 2>/dev/null)] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
  fi
}
rw_gitfail 83 '[ "$1" = rev-parse ] && [ "${2:-}" = -q ] && [ "${3:-}" = --verify ] && [ "${4:-}" = HEAD:tests/stand-scope.sh ]' \
  'git rev-parse -q --verify HEAD:tests/stand-scope.sh rc=128'
rw_gitfail 84 '[ "$1" = rev-parse ] && [ "${2:-}" = -q ] && [ "${3:-}" = --verify ] && [ "${4:-}" = HEAD:tests/stand-map.tsv ]' \
  'git rev-parse -q --verify HEAD:tests/stand-map.tsv rc=128'
rw_gitfail 85 '[ "$1" = show ] && [ "${2:-}" = HEAD:tests/stand-scope.sh ]' \
  'git show HEAD:tests/stand-scope.sh'

# --- R86. FIX9 Ж44: отказ sort при объединении scope свидетеля -- rc 3 -------------------
W86=$(mk_world w86)
printf 'y\n' > "$W86/alpha/f.txt"
git -C "$W86" add alpha/f.txt
mkdir -p "$WORK/sbin86"
REALSORT86="$(command -v sort)"
# CONSTRAINT: заглушка отказывает только sort САМОГО свидетеля: вызовы из
# stand-scope (родитель -- tests/stand-scope.sh) идут в настоящий sort, иначе
# отказ сопоставителя (rc 3) назывался бы раньше объединения scope.
cat > "$WORK/sbin86/sort" <<EOF2
#!/usr/bin/env bash
if [[ "\$(ps -o args= -p "\$PPID")" == *stand-scope.sh* ]]; then
  exec "$REALSORT86" "\$@"
fi
printf 'FAIL sort %s\n' "\$*" >> "$WORK/stub-sort86.log"
exit 2
EOF2
chmod +x "$WORK/sbin86/sort"
STUB_LOG="$WORK/stub-r86.log"; rm -f "$STUB_LOG"
RW_OUT=$(cd "$W86" && env PATH="$WORK/sbin86:$BIN:$PATH" bash tests/run-witness.sh 2>&1); RW_RC=$?
if [ "$RW_RC" = 3 ] && [[ "$RW_OUT" == *"run-witness: ОТКАЗ SCOPE_НЕ_ВЫЧИСЛЕН: sort объединения scope"* ]] \
   && [ -s "$WORK/stub-sort86.log" ] && [ ! -e "$STUB_LOG" ]; then
  ok "R86) заглушка sort rc=2 -- rc 3 SCOPE_НЕ_ВЫЧИСЛЕН: sort объединения scope, ssh не звался"
else
  bad "R86) отказ sort: rc=$RW_RC out=[$RW_OUT] журнал=[$(cat "$WORK/stub-sort86.log" 2>/dev/null)]"
fi

# --- R87. FIX9 Ж44: stand-scope --map-rev HEAD, карты нет в HEAD -- rc 4 -----------------
W87=$(mk_world w87)
git -C "$W87" rm -q --cached tests/stand-map.tsv
git -C "$W87" commit -qm nomap
git -C "$W87" add tests/stand-map.tsv
printf 'y\n' > "$W87/alpha/f.txt"
git -C "$W87" add alpha/f.txt
o87=$(cd "$W87" && bash tests/stand-scope.sh --staged --map-rev HEAD --skip-uncovered 2>"$W87/.err"); r87=$?
e87=$(cat "$W87/.err")
if [ "$r87" = 4 ] && [ -z "$o87" ] && [[ "$e87" == *"stand-scope: ОТКАЗ КАРТА: tests/stand-map.tsv нет в HEAD"* ]]; then
  ok "R87) --map-rev HEAD при карте, которой нет в HEAD -- rc 4 ОТКАЗ КАРТА"
else
  bad "R87) карты нет в HEAD: rc=$r87 out=[$o87] err=[$e87]"
fi

# --- R88. FIX9 Ж44: stand-scope --map-rev HEAD, rev-parse карты rc 128 -- rc 3 -----------
W88=$(mk_world w88)
printf 'y\n' > "$W88/alpha/f.txt"
git -C "$W88" add alpha/f.txt
mkdir -p "$WORK/gbin88"
cat > "$WORK/gbin88/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = rev-parse ] && [ "\${2:-}" = -q ] && [ "\${3:-}" = --verify ] && [ "\${4:-}" = HEAD:tests/stand-map.tsv ]; then
  printf 'FAIL %s\n' "\$*" >> "$WORK/stub-git88.log"
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$WORK/gbin88/git"
o88=$(cd "$W88" && env PATH="$WORK/gbin88:$PATH" bash tests/stand-scope.sh --staged --map-rev HEAD --skip-uncovered 2>"$W88/.err"); r88=$?
e88=$(cat "$W88/.err")
if [ "$r88" = 3 ] && [ -z "$o88" ] && [[ "$e88" == *"stand-scope: ОТКАЗ ПРИБОР: git rev-parse HEAD:tests/stand-map.tsv отказ (rc=128)"* ]] \
   && [ -s "$WORK/stub-git88.log" ]; then
  ok "R88) --map-rev HEAD, заглушка rev-parse карты rc=128 -- rc 3 ОТКАЗ ПРИБОР"
else
  bad "R88) иной rc rev-parse: rc=$r88 out=[$o88] err=[$e88] журнал=[$(cat "$WORK/stub-git88.log" 2>/dev/null)]"
fi

# --- R89..R95. FIX10b: отказ члена конвейера -- отказ прибора, не пустой список ------------
# CONSTRAINT: заглушка пишет журнал вызова и выходит с rc 1, ничего не выведя; при
# drain=1 она сперва дочитывает stdin встроенным read: левый член конвейера
# дописывает вход и выходит с rc 0, а не 141 от SIGPIPE, -- зуб краснеет только
# на коде заглушки.
stub_fail() {   # <каталог> <команда> <журнал> <drain: 0|1>
  mkdir -p "$1"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'printf %s "$*" >> "%s"\n' "'CALL $2 %s\\n'" "$3"
    [ "$4" = 1 ] && printf 'while IFS= read -r _l || [ -n "$_l" ]; do :; done\n'
    printf 'exit 1\n'
  } > "$1/$2"
  chmod +x "$1/$2"
}

W89=$(mk_world w89)
printf 'y\n' > "$W89/alpha/f.txt"
git -C "$W89" add alpha/f.txt
stub_fail "$WORK/sbin89" sort "$WORK/stub89.log" 1
o89=$(cd "$W89" && env PATH="$WORK/sbin89:$PATH" bash tests/stand-scope.sh --staged 2>"$W89/.err"); r89=$?
e89=$(cat "$W89/.err")
if [ "$r89" = 3 ] && [ -z "$o89" ] && [[ "$e89" == *"stand-scope: ОТКАЗ ПРИБОР: sort имён стендов до отсева удалённых отказ"* ]] \
   && [ -s "$WORK/stub89.log" ]; then
  ok "R89) stand-scope --staged, заглушка sort rc=1 -- rc 3 ОТКАЗ ПРИБОР (sort до отсева), журнал: $(head -1 "$WORK/stub89.log")"
else
  bad "R89) sort до отсева: rc=$r89 out=[$o89] err=[$e89] журнал=[$(cat "$WORK/stub89.log" 2>/dev/null)]"
fi

W90=$(mk_world w90)
printf 'alpha/f.txt\n' > "$W90/.paths"
stub_fail "$WORK/sbin90" sort "$WORK/stub90.log" 1
o90=$(cd "$W90" && env PATH="$WORK/sbin90:$PATH" bash tests/stand-scope.sh --paths "$W90/.paths" 2>"$W90/.err"); r90=$?
e90=$(cat "$W90/.err")
if [ "$r90" = 3 ] && [ -z "$o90" ] && [[ "$e90" == *"stand-scope: ОТКАЗ ПРИБОР: sort итогового списка стендов отказ"* ]] \
   && [ -s "$WORK/stub90.log" ]; then
  ok "R90) stand-scope --paths, заглушка sort rc=1 -- rc 3 ОТКАЗ ПРИБОР (итоговый sort), журнал: $(head -1 "$WORK/stub90.log")"
else
  bad "R90) итоговый sort: rc=$r90 out=[$o90] err=[$e90] журнал=[$(cat "$WORK/stub90.log" 2>/dev/null)]"
fi

ra_stubbed() {   # <номер> <мир> <каталог заглушки> <аргументы агрегатора...>
  local n="$1" w="$2" sb="$3"; shift 3
  RA_OUT=$(cd "$w" && env PATH="$sb:$PATH" bash tests/run-all.sh "$@" 2>&1)
  RA_RC=$?
}
ra_refused() {   # <номер> <мир> <журнал> <причина> <что меряет>
  local n="$1" w="$2" j="$3" want="$4" what="$5"
  if [ "$RA_RC" = 2 ] && [[ "$RA_OUT" == *"run-all: ОТКАЗ ПРИБОР: $want"* ]] && [ -z "$(markers "$w")" ] && [ -s "$j" ]; then
    ok "R$n) $what -- rc 2 ОТКАЗ ПРИБОР: $want, ноль запусков, журнал: $(head -1 "$j")"
  else
    bad "R$n) $what: rc=$RA_RC markers=[$(markers "$w")] журнал=[$(cat "$j" 2>/dev/null)] out=[$RA_OUT]"
  fi
}

W91=$(mk_world w91)
stub_fail "$WORK/sbin91" wc "$WORK/stub91.log" 1
ra_stubbed 91 "$W91" "$WORK/sbin91" --scope a
ra_refused 91 "$W91" "$WORK/stub91.log" "счёт отслеживаемых стендов (wc/tr) отказ" "заглушка wc rc=1 в счёте отслеживаемых"

# CONSTRAINT: оба члена конвейера пропавших -- встроенные (printf, while); отказ
# вносится перенаправлением: заглушка mktemp отдаёт путь КАТАЛОГА, и `> каталог`
# не исполняет цикл. test-c.sh снят с диска, в индексе остаётся: без проверки
# кода список пропавших пуст, и стенд a исполнялся бы мимо СТЕНД_ПРОПАЛ_С_ДИСКА.
W92=$(mk_world w92)
rm -f "$W92/tests/scripts/test-c.sh"
mkdir -p "$WORK/sbin92" "$WORK/missdir92"
cat > "$WORK/sbin92/mktemp" <<EOF2
#!/usr/bin/env bash
printf 'CALL mktemp %s\n' "\$*" >> "$WORK/stub92.log"
printf '%s\n' "$WORK/missdir92"
EOF2
chmod +x "$WORK/sbin92/mktemp"
ra_stubbed 92 "$W92" "$WORK/sbin92" --scope a
ra_refused 92 "$W92" "$WORK/stub92.log" "список пропавших с диска не построен" "запись списка пропавших отказала (mktemp дал каталог), test-c.sh снят с диска"

W93=$(mk_world w93)
rm -f "$W93/tests/scripts/test-c.sh"
stub_fail "$WORK/sbin93" cat "$WORK/stub93.log" 0
ra_stubbed 93 "$W93" "$WORK/sbin93" --scope a
ra_refused 93 "$W93" "$WORK/stub93.log" "список пропавших с диска не прочитан" "заглушка cat rc=1 при чтении списка пропавших, test-c.sh снят с диска"

W94=$(mk_world w94)
stub_fail "$WORK/sbin94" sort "$WORK/stub94.log" 1
ra_stubbed 94 "$W94" "$WORK/sbin94" --list
ra_refused 94 "$W94" "$WORK/stub94.log" "sort списка --list отказ" "--list, заглушка sort rc=1"

W95=$(mk_world w95)
stub_fail "$WORK/sbin95" sort "$WORK/stub95.log" 1
ra_stubbed 95 "$W95" "$WORK/sbin95" --scope a,b
ra_refused 95 "$W95" "$WORK/stub95.log" "sort выбранного scope отказ" "--scope a,b, заглушка sort rc=1"

# --- R96..R97. FIX10c: отказ grep проверки удаляемых стендов -- вина прибора, не карты ------
# CONSTRAINT: карта индекса называет стенд zz, которого нет в индексе: staged-проход
# спрашивает grep, удаляется ли он этим коммитом. R97 -- тот же мир с настоящим grep.
ss_zz_world() {   # <имя мира> -> путь мира
  local w
  w=$(mk_world "$1")
  printf 'delta/\tzz\n' >> "$w/tests/stand-map.tsv"
  git -C "$w" add tests/stand-map.tsv
  printf '%s' "$w"
}

W96=$(ss_zz_world w96)
REALGREP96="$(command -v grep)"
mkdir -p "$WORK/gbin96"
# CONSTRAINT: заглушка отказывает только grep из stand-scope (родитель --
# tests/stand-scope.sh); прочие вызовы идут в настоящий grep.
cat > "$WORK/gbin96/grep" <<EOF2
#!/usr/bin/env bash
if [[ "\$(ps -o args= -p "\$PPID")" == *stand-scope.sh* ]]; then
  printf 'CALL grep %s\n' "\$*" >> "$WORK/stub96.log"
  while IFS= read -r _l || [ -n "\$_l" ]; do :; done
  exit 2
fi
exec "$REALGREP96" "\$@"
EOF2
chmod +x "$WORK/gbin96/grep"
o96=$(cd "$W96" && env PATH="$WORK/gbin96:$PATH" bash tests/stand-scope.sh --staged 2>"$W96/.err"); r96=$?
e96=$(cat "$W96/.err")
if [ "$r96" = 3 ] && [ -z "$o96" ] && [[ "$e96" == *"stand-scope: ОТКАЗ ПРИБОР: grep карты стендов отказ"* ]] \
   && [[ "$e96" != *"КАРТА: неизвестный стенд"* ]] && [ -s "$WORK/stub96.log" ]; then
  ok "R96) заглушка grep rc=2 в проверке удаляемых стендов -- rc 3 ОТКАЗ ПРИБОР, не rc 4 КАРТА, журнал: $(head -1 "$WORK/stub96.log")"
else
  bad "R96) отказ grep: rc=$r96 out=[$o96] err=[$e96] журнал=[$(cat "$WORK/stub96.log" 2>/dev/null)]"
fi

W97=$(ss_zz_world w97)
o97=$(cd "$W97" && bash tests/stand-scope.sh --staged 2>"$W97/.err"); r97=$?
e97=$(cat "$W97/.err")
if [ "$r97" = 4 ] && [ -z "$o97" ] && [[ "$e97" == *"stand-scope: КАРТА: неизвестный стенд zz в строке 6"* ]]; then
  ok "R97) стенд zz карты нет в индексе, коммит его не удаляет -- rc 4 КАРТА: неизвестный стенд zz"
else
  bad "R97) неизвестный стенд: rc=$r97 out=[$o97] err=[$e97]"
fi

# --- R98. FIX12 Р3: мир без единого стенда -- пустой массив стендов под set -u ------
# CONSTRAINT: красен только под bash < 4.4 (площадка коммита -- /bin/bash 3.2.57):
# там "${stands[@]}" пустого массива под set -u -- unbound variable и rc 1; bash
# >= 4.4 раскрывает пустой массив в ноль слов, и зуб зелёный на обеих ветках кода.
W98=$(mk_world w98)
git -C "$W98" rm -q tests/scripts/test-a.sh tests/scripts/test-b.sh tests/scripts/test-c.sh
sed -i "s/^EXPECTED_STANDS=[0-9][0-9]*/EXPECTED_STANDS=0/" "$W98/tests/run-all.sh"
git -C "$W98" add tests/run-all.sh
git -C "$W98" commit -qm nostands
fx98=""
for f98 in "$W98"/tests/scripts/test-*.sh; do
  [ -e "$f98" ] && fx98="на диске $f98"
done
[ -z "$(git -C "$W98" ls-files -- 'tests/scripts/test-*.sh')" ] || fx98="${fx98:+$fx98; }стенды в индексе"
if [ -n "$fx98" ]; then
  bad "R98) фикстура: мир не пуст: $fx98"
else
  run_ra "$W98" --scope foo; o98a="$RA_OUT"; r98a="$RA_RC"
  run_ra "$W98" --list; o98b="$RA_OUT"; r98b="$RA_RC"
  if [ "$r98a" = 2 ] && [[ "$o98a" == *"run-all: ОТКАЗ SCOPE: неизвестное имя: foo"* ]] && [[ "$o98a" != *"unbound variable"* ]] \
     && [ "$r98b" = 0 ] && [ "$o98b" = "lint" ]; then
    ok "R98) стендов нет: --scope foo -- rc 2 неизвестное имя: foo; --list -- rc 0, ровно lint"
  else
    bad "R98) пустой массив стендов: --scope foo rc=$r98a out=[$o98a]; --list rc=$r98b out=[$o98b]"
  fi
fi

# --- R99. удалённый файл вместе со своей строкой карты -- покрыт картой HEAD -------
W99=$(mk_world w99)
printf 'tests/stand-map.tsv\t-\n' >> "$W99/tests/stand-map.tsv"
git -C "$W99" add tests/stand-map.tsv
git -C "$W99" commit -qm mapself
git -C "$W99" rm -q beta/exact.txt
grep -v '^beta/exact.txt	' "$W99/tests/stand-map.tsv" > "$W99/map.new" && mv "$W99/map.new" "$W99/tests/stand-map.tsv"
git -C "$W99" add tests/stand-map.tsv
fx99=""
grep -q '^beta/exact.txt	' "$W99/tests/stand-map.tsv" && fx99="строка beta/exact.txt осталась в карте"
git -C "$W99" show HEAD:tests/stand-map.tsv | grep -q '^beta/exact.txt	b$' || fx99="${fx99:+$fx99; }в HEAD-карте нет строки beta/exact.txt"
if [ -n "$fx99" ]; then
  bad "R99) фикстура: $fx99"
else
  run_ss_staged "$W99"
  o99h=$(cd "$W99" && bash tests/stand-scope.sh --staged --map-rev HEAD --skip-uncovered 2>/dev/null); r99h=$?
  if [ "$SSS_RC" = 0 ] && [ -z "$SSS_OUT" ] && [[ "$SSS_ERR" != *"НЕ ПОКРЫТ"* ]] \
     && [ "$r99h" = 0 ] && [ "$o99h" = "b" ]; then
    ok "R99) git rm beta/exact.txt + снятая строка карты -- индексный проход rc 0 без «НЕ ПОКРЫТ», HEAD-проход даёт b"
  else
    bad "R99) удалённый картированный путь: rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR] head rc=$r99h out=[$o99h]"
  fi
fi

# --- R100. контроль R99: удалённый путь, не покрытый и картой HEAD -- НЕ ПОКРЫТ -----
W100=$(mk_world w100)
mkdir -p "$W100/nowhere"
printf 'x\n' > "$W100/nowhere/y"
git -C "$W100" add nowhere/y
git -C "$W100" commit -qm unmapped
git -C "$W100" rm -q nowhere/y
run_ss_staged "$W100"
if [ "$SSS_RC" = 2 ] && [[ "$SSS_ERR" == *"stand-scope: НЕ ПОКРЫТ nowhere/y"* ]]; then
  ok "R100) git rm nowhere/y без строки ни в индексной, ни в HEAD-карте -- rc 2 НЕ ПОКРЫТ"
else
  bad "R100) удалённый непокрытый путь: rc=$SSS_RC out=[$SSS_OUT] err=[$SSS_ERR]"
fi

# --- R101. отказ git при чтении карты HEAD для удалённого пути -- rc 3 ОТКАЗ ПРИБОР ----
W101=$(mk_world w101)
git -C "$W101" rm -q beta/exact.txt
grep -v '^beta/exact.txt	' "$W101/tests/stand-map.tsv" > "$W101/map.new" && mv "$W101/map.new" "$W101/tests/stand-map.tsv"
printf 'tests/stand-map.tsv\t-\n' >> "$W101/tests/stand-map.tsv"
git -C "$W101" add tests/stand-map.tsv
mkdir -p "$WORK/gbin101"
cat > "$WORK/gbin101/git" <<EOF2
#!/usr/bin/env bash
if [ "\$1" = rev-parse ] && [ "\${2:-}" = -q ] && [ "\${3:-}" = --verify ] && [ "\${4:-}" = HEAD:tests/stand-map.tsv ]; then
  printf 'FAIL %s\n' "\$*" >> "$WORK/stub-git101.log"
  exit 128
fi
exec "$REALGIT" "\$@"
EOF2
chmod +x "$WORK/gbin101/git"
o101=$(cd "$W101" && env PATH="$WORK/gbin101:$PATH" bash tests/stand-scope.sh --staged 2>"$W101/.err"); r101=$?
e101=$(cat "$W101/.err")
if [ "$r101" = 3 ] && [ -z "$o101" ] && [ -s "$WORK/stub-git101.log" ] \
   && [[ "$e101" == *"stand-scope: ОТКАЗ ПРИБОР: git rev-parse HEAD:tests/stand-map.tsv отказ (rc=128)"* ]]; then
  ok "R101) заглушка git rc=128 на карте HEAD для удалённого пути -- rc 3 ОТКАЗ ПРИБОР, не НЕ ПОКРЫТ"
else
  bad "R101) отказ чтения карты HEAD: rc=$r101 out=[$o101] err=[$e101] журнал=[$(cat "$WORK/stub-git101.log" 2>/dev/null)]"
fi

# --- R102..R106. #594: scope со стендом mod-units везёт кит ------------------------
# CONSTRAINT: кит -- git-репо с refs/remotes/origin/main; рабочее дерево кита
# отличается от origin/main, чтобы различить блоб и рабочую копию.
mk_kit() {   # <имя> <строка origin/main> -> путь кита
  local k="$WORK/$1"
  mkdir -p "$k"
  git -C "$k" init -q
  git -C "$k" config user.email t@t
  git -C "$k" config user.name t
  printf '%s\n' "$2" > "$k/tweakcc-patch.js"
  git -C "$k" add tweakcc-patch.js
  git -C "$k" commit -qm kit
  git -C "$k" update-ref refs/remotes/origin/main HEAD
  printf 'KIT-WORKING\n' > "$k/tweakcc-patch.js"
  printf '%s' "$k"
}

W102=$(mk_world w102)
K102=$(mk_kit kit102 KIT-ORIGIN-MAIN)
KO102=$(git -C "$K102" rev-parse 'origin/main:tweakcc-patch.js')
TH102=$(git -C "$W102" rev-parse 'HEAD^{tree}')
STUB_LOG="$WORK/stub-r102.log"; STUB_RSYNC_REC="$WORK/rsync-r102"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
RW_OUT=$(cd "$W102" && env PATH="$BIN:$PATH" CATALYST_PATCH_KIT="$K102" bash tests/run-witness.sh --tree "$TH102" --scope a,mod-units 2>&1); RW_RC=$?
if [ "$RW_RC" = 0 ] && [ -f "$W102/.git/catalyst-witness/$TH102" ] \
   && [ "$(cat "$STUB_RSYNC_REC/tweakcc-patch.js" 2>/dev/null)" = "KIT-ORIGIN-MAIN" ] \
   && grep -q "rsync -a --no-xattrs --delete .*catalyst-witness/$TH102.kit/" "$STUB_LOG" \
   && grep -qF "env -u CATALYST_STANDS CATALYST_PATCH_KIT=\$HOME/scratch/catalyst-witness/$TH102.kit systemd-run" "$STUB_LOG" \
   && grep -qF "rm -rf ~/scratch/catalyst-witness/$TH102 ~/scratch/catalyst-witness/$TH102.kit" "$STUB_LOG" \
   && grep -qF "run-witness: кит origin/main:tweakcc-patch.js $KO102" "$W102/.git/catalyst-witness/$TH102.log" \
   && [[ "$RW_OUT" == *"origin/main:tweakcc-patch.js $KO102"* ]]; then
  ok "R102) scope с mod-units: кит origin/main едет в <T>.kit, CATALYST_PATCH_KIT в команде, уборка обоих, oid в журнале"
else
  bad "R102) кит: rc=$RW_RC rec=[$(cat "$STUB_RSYNC_REC/tweakcc-patch.js" 2>/dev/null)] out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

W103=$(mk_world w103)
TH103=$(git -C "$W103" rev-parse 'HEAD^{tree}')
STUB_LOG="$WORK/stub-r103.log"; rm -f "$STUB_LOG"
RW_OUT=$(cd "$W103" && env PATH="$BIN:$PATH" CATALYST_PATCH_KIT="$WORK/nokit103" bash tests/run-witness.sh --tree "$TH103" --scope mod-units 2>&1); RW_RC=$?
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"run-witness: ОТКАЗ КИТ: в $WORK/nokit103 нет origin/main:tweakcc-patch.js"* ]] \
   && [ ! -e "$STUB_LOG" ] && [ ! -e "$W103/.git/catalyst-witness/$TH103" ]; then
  ok "R103) scope с mod-units, кита нет -- rc 2 ОТКАЗ КИТ до первого удалённого действия"
else
  bad "R103) нет кита: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

W104=$(mk_world w104)
K104=$(mk_kit kit104 KIT-104)
git -C "$K104" update-ref -d refs/remotes/origin/main
TH104=$(git -C "$W104" rev-parse 'HEAD^{tree}')
STUB_LOG="$WORK/stub-r104.log"; rm -f "$STUB_LOG"
RW_OUT=$(cd "$W104" && env PATH="$BIN:$PATH" CATALYST_PATCH_KIT="$K104" bash tests/run-witness.sh --tree "$TH104" --scope mod-units 2>&1); RW_RC=$?
if [ "$RW_RC" = 2 ] && [[ "$RW_OUT" == *"run-witness: ОТКАЗ КИТ: в $K104 нет origin/main:tweakcc-patch.js"* ]] \
   && [ ! -e "$STUB_LOG" ]; then
  ok "R104) кит без origin/main -- rc 2 ОТКАЗ КИТ, рабочая копия кита не подставляется"
else
  bad "R104) кит без origin/main: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

W105=$(mk_world w105)
TH105=$(git -C "$W105" rev-parse 'HEAD^{tree}')
STUB_LOG="$WORK/stub-r105.log"; STUB_RSYNC_REC="$WORK/rsync-r105"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
RW_OUT=$(cd "$W105" && env PATH="$BIN:$PATH" CATALYST_PATCH_KIT="$WORK/nokit105" bash tests/run-witness.sh --tree "$TH105" --scope a 2>&1); RW_RC=$?
if [ "$RW_RC" = 0 ] && [ -f "$W105/.git/catalyst-witness/$TH105" ] \
   && ! grep -q 'CATALYST_PATCH_KIT' "$STUB_LOG" && ! grep -q '\.kit/' "$STUB_LOG" \
   && [[ "$RW_OUT" != *"run-witness: кит "* ]]; then
  ok "R105) scope без mod-units -- кит не читается и не едет, команда без CATALYST_PATCH_KIT"
else
  bad "R105) без mod-units: rc=$RW_RC out=[$RW_OUT] stub=[$(cat "$STUB_LOG" 2>/dev/null)]"
fi

W106=$(mk_world w106)
K106=$(mk_kit Catalyst-CC-Patch KIT-DEFAULT)
TH106=$(git -C "$W106" rev-parse 'HEAD^{tree}')
STUB_LOG="$WORK/stub-r106.log"; STUB_RSYNC_REC="$WORK/rsync-r106"; rm -f "$STUB_LOG"; rm -rf "$STUB_RSYNC_REC"
RW_OUT=$(cd "$W106" && env -u CATALYST_PATCH_KIT PATH="$BIN:$PATH" bash tests/run-witness.sh --tree "$TH106" --scope mod-units 2>&1); RW_RC=$?
if [ "$RW_RC" = 0 ] && [ "$(cat "$STUB_RSYNC_REC/tweakcc-patch.js" 2>/dev/null)" = "KIT-DEFAULT" ] \
   && [[ "$RW_OUT" == *"/Catalyst-CC-Patch origin/main:tweakcc-patch.js $(git -C "$K106" rev-parse 'origin/main:tweakcc-patch.js')"* ]]; then
  ok "R106) CATALYST_PATCH_KIT не задана -- кит берётся рядом с главным чекаутом"
else
  bad "R106) умолчание кита: rc=$RW_RC rec=[$(cat "$STUB_RSYNC_REC/tweakcc-patch.js" 2>/dev/null)] out=[$RW_OUT]"
fi

printf '\nRUN-ALL-TEETH PASS=%d FAILED=%d\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_TEETH )); then
  printf 'ПРОВАЛ: прогнано зубов %d при объявленных %d -- прогон не тот, который пинили\n' \
    "$((PASS + FAIL))" "$EXPECTED_TEETH" >&2
  exit 1
fi
[[ $FAIL -eq 0 ]]
