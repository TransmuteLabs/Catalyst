#!/usr/bin/env bash
# Дверь протухания контракта типов (`.claude/types/`, раскладка 287): баннер
# `claude-code/index.d.ts` обязан совпадать с версией бинарника стендов и с
# «Текущим изданием» PROVENANCE.md. sha256 трёх файлов раскладки — со строками
# PROVENANCE. Бинарник резолвит lib-claude-bin.sh.
#
# CONSTRAINT: предикат свежести — версия API, не sha образа: образы площадок
# разные, контракт — функция версии. tools/mcp баннера не несут по построению движка.
#
# CONSTRAINT: коды возврата — 0/1/2; код 3 стенд не выдаёт: tests/run-all.sh
# читает его красным у любого стенда вне OPTIN_STANDS, а этот стенд не опт-ин.
# 0 — зелёный (зубы + живая сверка + tsc + счёт any);
# 1 — красный: сломан зуб, контракт протух, PROVENANCE лжёт, sha разошёлся,
#     нет файла раскладки, плоский *.d.ts в .claude/types, tsc сообщил ошибку,
#     счёт any разошёлся с пином;
# 2 — ОТКАЗ ПРИБОРА: нет бинарника, каталог или неисполняемый файл
#     (lib-claude-bin.sh), бинарник не ответил версией, контракт/PROVENANCE не
#     читается, нечем считать sha256, нет python3, нет tsc, пустой
#     `tsc --version`, tsc без вывода.
set -u
export LC_ALL=C

# Пин числа зубов: молча выпавший зуб обязан быть виден. Поднимается ВМЕСТЕ
# с добавлением зубов, в этой строке — другого дома у числа нет.
EXPECTED_TEETH=14
# Пин `tsc --version` площадки прогонов (usbox, эта волна).
EXPECTED_TSC_VERSION="Version 7.0.2"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)" || {
  printf 'contract-freshness: ОТКАЗ: каталог стенда не открывается\n' >&2
  exit 2
}
# shellcheck source=lib-claude-bin.sh
source "$SCRIPT_DIR/lib-claude-bin.sh" || {
  printf 'contract-freshness: ОТКАЗ: нет lib-claude-bin.sh\n' >&2
  exit 2
}

sha256_of() { # <файл> → hex на stdout; отказ прибора — exit 2
  local f="$1" out rc dig
  if command -v sha256sum >/dev/null; then
    out="$(sha256sum -- "$f")"
    rc=$?
  elif command -v shasum >/dev/null; then
    out="$(shasum -a 256 -- "$f")"
    rc=$?
  else
    printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: нечем считать sha256 (нет ни sha256sum, ни shasum)\n' >&2
    exit 2
  fi
  dig="${out%% *}"
  if [ "$rc" -ne 0 ] || [ "${#dig}" -ne 64 ]; then
    printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: sha256 не посчитан (%s, код %s)\n' "$f" "$rc" >&2
    exit 2
  fi
  case "$dig" in
    *[!0-9a-f]*) printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: sha256 не разобран: [%s]\n' "$dig" >&2; exit 2 ;;
  esac
  printf '%s' "$dig"
}

prov_sha() { # <имя-файла> <PROVENANCE> → hex или пусто
  local name="$1" prov="$2" line hex
  line="$(grep -F "SHA-256 \`${name}\`" "$prov" | head -n 1 || true)"
  hex="$(printf '%s\n' "$line" | sed -n 's/.*`\([0-9a-f]\{64\}\)`.*/\1/p' | head -n 1)"
  printf '%s' "$hex"
}

# CONSTRAINT: счёт any — только переданный каталог (стенд даёт plugins/*/hooks).
# Строковый литерал и хвост // на той же строке не считаются. .claude/types и tests не входят.
count_any_lines() { # <каталог>
  if ! command -v python3 >/dev/null; then
    printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: нет python3 для счёта any\n' >&2
    return 2
  fi
  python3 - "$1" << 'PY'
import re, sys, pathlib
root = pathlib.Path(sys.argv[1])
pat = re.compile(r":\s*any\b|\bas any\b|<any>|\bany\[\]")

def strip_line(line):
    out = []
    i = 0
    n = len(line)
    while i < n:
        c = line[i]
        if c == "/" and i + 1 < n and line[i + 1] == "/":
            break
        if c in ('"', "'", "`"):
            q = c
            j = i + 1
            while j < n:
                if line[j] == "\\":
                    j += 2
                    continue
                if line[j] == q:
                    j += 1
                    break
                j += 1
            else:
                out.append(line[i:])
                break
            i = j
            continue
        out.append(c)
        i += 1
    return "".join(out)

files = [root] if root.is_file() else list(root.rglob("*.ts")) + list(root.rglob("*.tsx"))
n = 0
for p in files:
    for line in p.read_text(encoding="utf-8").splitlines():
        if pat.search(strip_line(line)):
            n += 1
print(n)
PY
}

# --- ступень живой сверки: --check <корень> -----------------------------------
if [ "${1:-}" = "--check" ]; then
  [ $# -eq 2 ] || { printf 'contract-freshness: ОТКАЗ АРГУМЕНТЫ: --check принимает ровно один корень\n' >&2; exit 2; }
  ROOT="$2"
  TYPES="$ROOT/.claude/types"
  PROV="$TYPES/PROVENANCE.md"
  DTS_CC="$TYPES/claude-code/index.d.ts"
  DTS_TOOLS="$TYPES/claude-code-tools/index.d.ts"
  DTS_MCP="$TYPES/claude-code-mcp/index.d.ts"

  BIN="$(resolve_claude_bin)"
  BRC=$?
  if [ "$BRC" -ne 0 ]; then
    exit "$BRC"
  fi

  for f in "$DTS_CC" "$DTS_TOOLS" "$DTS_MCP"; do
    if [ ! -s "$f" ]; then
      printf 'contract-freshness: нет файла раскладки: %s\n' "$f" >&2
      exit 1
    fi
  done
  shopt -s nullglob
  FLAT=( "$TYPES"/*.d.ts )
  shopt -u nullglob
  if [ "${#FLAT[@]}" -ne 0 ]; then
    printf 'contract-freshness: ПЛОСКАЯ_РАСКЛАДКА: %s — раскладка 287 держит контракт только каталогами (claude-code/, claude-code-tools/, claude-code-mcp/)\n' "${FLAT[0]##*/}" >&2
    exit 1
  fi
  if [ ! -s "$PROV" ]; then
    printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: сверки не с чем — %s отсутствует или пуст\n' "$PROV" >&2
    exit 2
  fi

  VER_A="$(sed -n '1s|^// Written by Claude Code \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)\.$|\1|p' "$DTS_CC")"
  VER_P="$(sed -n 's/^## Текущее издание: \([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*$/\1/p' "$PROV" | head -n 1)"
  if [ -z "$VER_A" ] || [ -z "$VER_P" ]; then
    printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: издание не читается (баннер=%s, PROVENANCE=%s) — форма сменилась\n' \
      "${VER_A:-НЕТ}" "${VER_P:-НЕТ}" >&2
    exit 2
  fi

  VOUT="$(mktemp "${TMPDIR:-/tmp}/cf-version.XXXXXX")" || { printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: mktemp отказ\n' >&2; exit 2; }
  "$BIN" --version >"$VOUT" 2>&1
  VRC=$?
  VER_BIN="$(sed -n '1s/^\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\) .*$/\1/p' "$VOUT")"
  if [ "$VRC" -ne 0 ] || [ -z "$VER_BIN" ]; then
    printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: %s --version не ответил версией (код %s):\n' "$BIN" "$VRC" >&2
    tail -n 5 "$VOUT" >&2
    rm -f "$VOUT"
    exit 2
  fi
  rm -f "$VOUT"

  if [ "$VER_A" != "$VER_BIN" ]; then
    printf 'contract-freshness: КОНТРАКТ_РАЗОШЁЛСЯ: контракт %s, бинарник %s\n' "$VER_A" "$VER_BIN" >&2
    exit 1
  fi
  if [ "$VER_A" != "$VER_P" ]; then
    printf 'contract-freshness: PROVENANCE_ЛЖЁТ: контракт %s, «Текущее издание» PROVENANCE.md %s\n' "$VER_A" "$VER_P" >&2
    exit 1
  fi

  check_sha() { # <имя> <путь>
    local name="$1" path="$2" want got
    want="$(prov_sha "$name" "$PROV")"
    got="$(sha256_of "$path")"
    if [ -z "$want" ] || [ "$got" != "$want" ]; then
      printf 'contract-freshness: SHA_РАЗОШЁЛСЯ: %s файл %s, PROVENANCE %s\n' "$name" "$got" "${want:-НЕТ}" >&2
      exit 1
    fi
  }
  check_sha "claude-code/index.d.ts" "$DTS_CC"
  check_sha "claude-code-tools/index.d.ts" "$DTS_TOOLS"
  check_sha "claude-code-mcp/index.d.ts" "$DTS_MCP"

  printf 'contract-freshness: издание %s = баннер claude-code/index.d.ts = бинарник %s = PROVENANCE\n' "$VER_A" "$BIN"
  printf 'contract-freshness: sha256 трёх файлов раскладки = PROVENANCE\n'
  exit 0
fi

# --- зубы ---------------------------------------------------------------------
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)" || { printf 'contract-freshness: ОТКАЗ: корень дерева не открывается\n' >&2; exit 2; }
SELF="$SCRIPT_DIR/test-contract-freshness.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cf-teeth.XXXXXX")" || { printf 'contract-freshness: ОТКАЗ: mktemp отказ\n' >&2; exit 2; }
TSC_OUT=""
cleanup() {
  if [ -n "${WORK:-}" ]; then rm -rf "$WORK"; fi
  if [ -n "${TSC_OUT:-}" ]; then rm -f "$TSC_OUT"; fi
}
trap cleanup EXIT

# Синтетическая раскладка 287: баннер только у claude-code; sha — в PROVENANCE.
mk_world() { # <имя> <версия-баннера> <версия-PROVENANCE> → путь корня
  local name="$1" v_dts="$2" v_prov="$3"
  local r="$WORK/$name" sa st sm
  mkdir -p "$r/.claude/types/claude-code" "$r/.claude/types/claude-code-tools" "$r/.claude/types/claude-code-mcp" "$r/bin"
  printf '// Written by Claude Code %s.\n// синтетический зуб двери протухания\n' "$v_dts" > "$r/.claude/types/claude-code/index.d.ts"
  printf '// The inputs of the built-in tools this build has, synthetic tooth\n' > "$r/.claude/types/claude-code-tools/index.d.ts"
  printf '// The inputs of the MCP tools, synthetic tooth\n' > "$r/.claude/types/claude-code-mcp/index.d.ts"
  sa="$(sha256_of "$r/.claude/types/claude-code/index.d.ts")"
  st="$(sha256_of "$r/.claude/types/claude-code-tools/index.d.ts")"
  sm="$(sha256_of "$r/.claude/types/claude-code-mcp/index.d.ts")"
  printf '# PROVENANCE\n\n## Текущее издание: %s (зуб)\n\n- SHA-256 `claude-code/index.d.ts` `%s`.\n- SHA-256 `claude-code-tools/index.d.ts` `%s`.\n- SHA-256 `claude-code-mcp/index.d.ts` `%s`.\n' \
    "$v_prov" "$sa" "$st" "$sm" > "$r/.claude/types/PROVENANCE.md"
  printf '%s' "$r"
}

mk_bin() { # <корень> <версия> → путь поддельного бинарника
  local r="$1" v="$2"
  printf '#!/usr/bin/env bash\nprintf "%s (Claude Code)\\n"\n' "$v" > "$r/bin/claude"
  chmod +x "$r/bin/claude"
  printf '%s' "$r/bin/claude"
}

run_check() { # <корень> <бинарник|->
  local r="$1" b="$2"
  if [ "$b" = "-" ]; then
    env -u CLAUDE_BIN PATH="/usr/bin:/bin" "$BASH" "$SELF" --check "$r" 2>&1
  else
    CLAUDE_BIN="$b" "$BASH" "$SELF" --check "$r" 2>&1
  fi
}

# --- КОНТРОЛЬ: всё сошлось → 0 ------------------------------------------------
R=$(mk_world converged 9.9.9 9.9.9)
B=$(mk_bin "$R" 9.9.9)
out=$(run_check "$R" "$B"); rc=$?
if [ "$rc" = 0 ] && printf '%s' "$out" | LC_ALL=C grep -qF 'издание 9.9.9'; then
  ok "КОНТРОЛЬ: баннер = бинарник = PROVENANCE — зелёный"
else
  bad "КОНТРОЛЬ: ждали rc=0 со сводкой, получили rc=$rc вывод=[$out]"
fi

# --- ЗУБ 1: чужой баннер d.ts → 1 ---------------------------------------------
R=$(mk_world stale-dts 9.8.7 9.9.9)
B=$(mk_bin "$R" 9.9.9)
out=$(run_check "$R" "$B"); rc=$?
if [ "$rc" = 1 ] && printf '%s' "$out" | LC_ALL=C grep -qF 'контракт 9.8.7, бинарник 9.9.9'; then
  ok "ЗУБ 1: чужой баннер d.ts краснеет своей причиной и называет обе версии"
else
  bad "ЗУБ 1: ждали rc=1 «контракт 9.8.7, бинарник 9.9.9», получили rc=$rc вывод=[$out]"
fi

# --- ЗУБ 2: поддельный бинарник другой версии → 1 -----------------------------
R=$(mk_world stale-bin 9.9.9 9.9.9)
B=$(mk_bin "$R" 1.0.0)
out=$(run_check "$R" "$B"); rc=$?
if [ "$rc" = 1 ] && printf '%s' "$out" | LC_ALL=C grep -qF 'контракт 9.9.9, бинарник 1.0.0'; then
  ok "ЗУБ 2: бинарник другой версии краснеет своей причиной"
else
  bad "ЗУБ 2: ждали rc=1 «контракт 9.9.9, бинарник 1.0.0», получили rc=$rc вывод=[$out]"
fi

# --- ЗУБ 3: PROVENANCE без издания / пустой → 2 своей причиной ----------------
R=$(mk_world no-edition 9.9.9 9.9.9)
printf '# PROVENANCE\n\nнет строки издания\n' > "$R/.claude/types/PROVENANCE.md"
B=$(mk_bin "$R" 9.9.9)
out=$(run_check "$R" "$B"); rc=$?
: > "$R/.claude/types/PROVENANCE.md"
outb=$(run_check "$R" "$B"); rcb=$?
if [ "$rc" = 2 ] && printf '%s' "$out" | LC_ALL=C grep -qF 'ПРИБОР НЕ МЕРИТ: издание не читается' \
   && [ "$rcb" = 2 ] && printf '%s' "$outb" | LC_ALL=C grep -qF 'сверки не с чем'; then
  ok "ЗУБ 3: PROVENANCE без издания / пустой → 2 своей причиной"
else
  bad "ЗУБ 3: ждали (а) rc=2 «издание не читается» и (б) rc=2 «сверки не с чем», получили (а) rc=$rc [$out] (б) rc=$rcb [$outb]"
fi

# --- ЗУБ 4: без бинарника → 2, текст причины из lib ---------------------------
R=$(mk_world no-bin 9.9.9 9.9.9)
out=$(run_check "$R" -); rc=$?
outb=$(CLAUDE_BIN= PATH="/usr/bin:/bin" "$BASH" "$SELF" --check "$R" 2>&1); rcb=$?
if [ "$rc" = 2 ] && printf '%s' "$out" | LC_ALL=C grep -qF 'resolve_claude_bin: бинарник claude не найден (CLAUDE_BIN не задан или пуст' \
   && [ "$rcb" = 2 ] && printf '%s' "$outb" | LC_ALL=C grep -qF 'resolve_claude_bin: бинарник claude не найден (CLAUDE_BIN не задан или пуст'; then
  ok "ЗУБ 4: без бинарника (CLAUDE_BIN не задан / задан пустым) — код 2 с причиной lib"
else
  bad "ЗУБ 4: ждали (а) и (б) rc=2 «бинарник claude не найден (CLAUDE_BIN не задан или пуст», получили (а) rc=$rc [$out] (б) rc=$rcb [$outb]"
fi

# --- ЗУБ 5: нет файла раскладки → 1 -------------------------------------------
R=$(mk_world missing-layout 9.9.9 9.9.9)
rm -f "$R/.claude/types/claude-code-tools/index.d.ts"
B=$(mk_bin "$R" 9.9.9)
out=$(run_check "$R" "$B"); rc=$?
if [ "$rc" = 1 ] && printf '%s' "$out" | LC_ALL=C grep -qF 'нет файла раскладки:'; then
  ok "ЗУБ 5: нет файла раскладки краснеет своей причиной"
else
  bad "ЗУБ 5: ждали rc=1 «нет файла раскладки», получили rc=$rc вывод=[$out]"
fi

# --- ЗУБ 6: баннер ≠ «Текущее издание» при совпадающем бинарнике → 1 ---------
R=$(mk_world banner-vs-prov 7.7.7 6.6.6)
B=$(mk_bin "$R" 7.7.7)
out=$(run_check "$R" "$B"); rc=$?
if [ "$rc" = 1 ] && printf '%s' "$out" | LC_ALL=C grep -qF 'PROVENANCE_ЛЖЁТ'; then
  ok "ЗУБ 6: баннер ≠ «Текущее издание» при совпадающем бинарнике — PROVENANCE_ЛЖЁТ"
else
  bad "ЗУБ 6: ждали rc=1 «PROVENANCE_ЛЖЁТ», получили rc=$rc вывод=[$out]"
fi

# --- ЗУБ 7: правленный байт tools при неизменном баннере → sha ----------------
R=$(mk_world edited-tools 9.9.9 9.9.9)
printf 'X' >> "$R/.claude/types/claude-code-tools/index.d.ts"
B=$(mk_bin "$R" 9.9.9)
out=$(run_check "$R" "$B"); rc=$?
if [ "$rc" = 1 ] && printf '%s' "$out" | LC_ALL=C grep -qF 'SHA_РАЗОШЁЛСЯ: claude-code-tools/index.d.ts'; then
  ok "ЗУБ 7: правленный байт tools при неизменном баннере краснеет sha"
else
  bad "ЗУБ 7: ждали rc=1 «SHA_РАЗОШЁЛСЯ: claude-code-tools/index.d.ts», получили rc=$rc вывод=[$out]"
fi

# --- ЗУБ 8: any внутри строкового литерала счёт не растит ---------------------
AT="$WORK/any-tooth/hooks"
mkdir -p "$AT"
printf 'export const x: any = 1\n' > "$AT/a.ts"
n1="$(count_any_lines "$AT")"
n1rc=$?
printf 'export const s = "access any file: any"\n' >> "$AT/a.ts"
n2="$(count_any_lines "$AT")"
n2rc=$?
if [ "$n1rc" = 0 ] && [ "$n2rc" = 0 ] && [ "$n1" = 1 ] && [ "$n2" = 1 ]; then
  ok "ЗУБ 8: строка с any внутри строкового литерала счёт не растит"
else
  bad "ЗУБ 8: ждали 1→1, получили rc=$n1rc/$n2rc счёт=${n1}→${n2}"
fi

# --- ЗУБ 9: CLAUDE_BIN на каталог → 2 ------------------------------------------
R=$(mk_world bin-dir 9.9.9 9.9.9)
out=$(run_check "$R" "$R/bin"); rc=$?
if [ "$rc" = 2 ] && printf '%s' "$out" | LC_ALL=C grep -qF "resolve_claude_bin: бинарник claude — не исполняемый файл: $R/bin"; then
  ok "ЗУБ 9: CLAUDE_BIN на каталог — код 2 с причиной lib"
else
  bad "ЗУБ 9: ждали rc=2 «не исполняемый файл: $R/bin», получили rc=$rc вывод=[$out]"
fi

# --- ЗУБ 10: CLAUDE_BIN на неисполняемый файл → 2 -------------------------------
R=$(mk_world bin-noexec 9.9.9 9.9.9)
B=$(mk_bin "$R" 9.9.9)
chmod -x "$B"
out=$(run_check "$R" "$B"); rc=$?
if [ "$rc" = 2 ] && printf '%s' "$out" | LC_ALL=C grep -qF "resolve_claude_bin: бинарник claude — не исполняемый файл: $B"; then
  ok "ЗУБ 10: CLAUDE_BIN на неисполняемый файл — код 2 с причиной lib"
else
  bad "ЗУБ 10: ждали rc=2 «не исполняемый файл: $B», получили rc=$rc вывод=[$out]"
fi

# --- ЗУБ 11: относительный CLAUDE_BIN → абсолютный путь ------------------------
R=$(mk_world bin-relative 9.9.9 9.9.9)
B=$(mk_bin "$R" 9.9.9)
ABS="$(cd "$R/bin" && pwd -P)/claude"
out=$(cd "$R" && CLAUDE_BIN="bin/claude" "$BASH" "$SELF" --check "$R" 2>&1); rc=$?
if [ "$rc" = 0 ] && printf '%s' "$out" | LC_ALL=C grep -qF "= бинарник $ABS = PROVENANCE"; then
  ok "ЗУБ 11: относительный CLAUDE_BIN резолвится в абсолютный путь"
else
  bad "ЗУБ 11: ждали rc=0 «= бинарник $ABS = PROVENANCE», получили rc=$rc вывод=[$out]"
fi

# --- ЗУБ 12: бинарник не ответил версией → 2 ------------------------------------
R=$(mk_world bin-silent 9.9.9 9.9.9)
printf '#!/usr/bin/env bash\nexit 1\n' > "$R/bin/claude"
chmod +x "$R/bin/claude"
out=$(run_check "$R" "$R/bin/claude"); rc=$?
if [ "$rc" = 2 ] && printf '%s' "$out" | LC_ALL=C grep -qF 'не ответил версией (код 1)'; then
  ok "ЗУБ 12: бинарник без ответа --version — код 2 своей причиной"
else
  bad "ЗУБ 12: ждали rc=2 «не ответил версией (код 1)», получили rc=$rc вывод=[$out]"
fi

# --- ЗУБ 13: плоский *.d.ts в .claude/types → 1 ---------------------------------
R=$(mk_world flat-layout 9.9.9 9.9.9)
printf '// Written by Claude Code 9.9.9.\n' > "$R/.claude/types/claude-code.d.ts"
B=$(mk_bin "$R" 9.9.9)
out=$(run_check "$R" "$B"); rc=$?
if [ "$rc" = 1 ] && printf '%s' "$out" | LC_ALL=C grep -qF 'ПЛОСКАЯ_РАСКЛАДКА: claude-code.d.ts'; then
  ok "ЗУБ 13: плоский claude-code.d.ts рядом с раскладкой 287 краснеет своей причиной"
else
  bad "ЗУБ 13: ждали rc=1 «ПЛОСКАЯ_РАСКЛАДКА: claude-code.d.ts», получили rc=$rc вывод=[$out]"
fi

printf '\ncontract-freshness teeth: прошло=%d провалов=%d ожидалось=%d\n' "$PASS" "$FAIL" "$EXPECTED_TEETH"
if [ "$((PASS + FAIL))" -ne "$EXPECTED_TEETH" ]; then
  printf 'ПРОВАЛ: прогнано зубов %d при объявленных %d — прогон не тот, который пинили\n' \
    "$((PASS + FAIL))" "$EXPECTED_TEETH" >&2
  exit 1
fi
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

# --- живая сверка на корне репозитория ----------------------------------------
FRESH_OUT="$(CLAUDE_BIN="${CLAUDE_BIN:-}" "$BASH" "$SELF" --check "$ROOT" 2>&1)"
FRESH_RC=$?
printf '%s\n' "$FRESH_OUT"
if [ "$FRESH_RC" -ne 0 ]; then
  exit "$FRESH_RC"
fi

# --- tsc-гейт ------------------------------------------------------------------
# CONSTRAINT: глоб tsconfig — от корня дерева, не от CWD вызывающего.
TSC="$(command -v tsc || true)"
if [ -z "$TSC" ]; then
  printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: нет tsc в PATH и нет источника версии typescript (package.json/lock статус-мода в дереве нет)\n' >&2
  exit 2
fi
TSC_VER="$("$TSC" --version 2>&1 | head -n 1 || true)"
printf 'contract-freshness: tsc --version: %s\n' "$TSC_VER"
if [ -z "$TSC_VER" ]; then
  printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: tsc --version пуст\n' >&2
  exit 2
fi
if [ "$TSC_VER" != "$EXPECTED_TSC_VERSION" ]; then
  printf 'contract-freshness: TSC_ВЕРСИЯ: получено [%s], пин [%s]\n' "$TSC_VER" "$EXPECTED_TSC_VERSION" >&2
  exit 1
fi

shopt -s nullglob
configs=( "$ROOT"/plugins/*/tsconfig.json )
shopt -u nullglob
if [ "${#configs[@]}" -eq 0 ]; then
  printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: ни одного plugins/*/tsconfig.json — tsc-ступени нечего мерить\n' >&2
  exit 2
fi
TSC_OUT="$(mktemp "${TMPDIR:-/tmp}/cf-tsc.XXXXXX")" || { printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: mktemp отказ\n' >&2; exit 2; }
TSC_N=0
for cfg in "${configs[@]}"; do
  rel="${cfg#"$ROOT"/}"
  dir="$(dirname "$rel")"
  "$TSC" -p "$cfg" --noEmit >"$TSC_OUT" 2>&1
  trc=$?
  if [ "$trc" -ne 0 ] && [ ! -s "$TSC_OUT" ]; then
    printf 'contract-freshness: ПРИБОР НЕ МЕРИТ: tsc не дал вывода (код %s) для %s\n' "$trc" "$dir" >&2
    exit 2
  fi
  ERR_N="$(grep -c 'error TS' "$TSC_OUT" || true)"
  if [ "$trc" -ne 0 ] || [ "${ERR_N:-0}" -ne 0 ]; then
    printf 'contract-freshness: TSC_КРАСЕН: %s ожидалось 0 ошибок, код %s, ошибок %s:\n' "$dir" "$trc" "${ERR_N:-?}"
    cat "$TSC_OUT"
    exit 1
  fi
  printf 'contract-freshness tsc: %s — 0 ошибок (tsc %s)\n' "$dir" "$TSC_VER"
  TSC_N=$((TSC_N+1))
done

# --- счёт явных any -----------------------------------------------------------
pin_of() {
  case "$1" in
    catalyst-probes) printf '419' ;;
    *) printf '0' ;;
  esac
}
ANY_BAD=0
shopt -s nullglob
hookdirs=( "$ROOT"/plugins/*/hooks )
shopt -u nullglob
for hd in "${hookdirs[@]}"; do
  plug="$(basename "$(dirname "$hd")")"
  got="$(count_any_lines "$hd")"
  crc=$?
  if [ "$crc" -ne 0 ]; then
    exit "$crc"
  fi
  want="$(pin_of "$plug")"
  if [ "$got" != "$want" ]; then
    printf 'contract-freshness: ANY_РАЗОШЁЛСЯ: %s счёт %s, пин %s\n' "$plug" "$got" "$want" >&2
    ANY_BAD=1
  else
    printf 'contract-freshness any: %s %s\n' "$plug" "$got"
  fi
done
if [ "$ANY_BAD" -ne 0 ]; then
  exit 1
fi

printf 'contract-freshness: %s зубов зелёных, живая сверка, tsc по %s плагинам и счёт any — зелёные\n' "$PASS" "$TSC_N"
exit 0
