#!/usr/bin/env bash
# Приёмка БОЕВОГО веера судьи: каждая ступень живого конфига -- поодиночке,
# и полная лестница -- целиком. Стенд test-judge-serves.sh мерит МЕХАНИЗМ на
# СИНТЕТИЧЕСКИХ ступенях; числа по боевым ступеням до этого стенда брать
# было неоткуда (#158).
#
# CONSTRAINT: боевой probes.toml (${CLAUDE_PROBES_HOME:-$HOME/.claude/probes})
# открывается ТОЛЬКО на чтение. Все записи стенда идут во временный корень
# прогона (mktemp), снесённый по EXIT; дом проб каждого случая -- свой,
# внутри этого корня.
#
# CONSTRAINT: fail_closed в копии боевой секции выставляется в false --
# приёмка не имеет права зависеть от того, отменит ли судья диспатч.
#
# CONSTRAINT: «первая пуста, ответила следующая» -- КРАСНОЕ, а не зелёное:
# запасная ступень отработала, но веер при этом выродился в одну модель,
# и именно эта форма четверо суток проходила все гейты (#158, #153).
#
# CONSTRAINT: стенд ОПТ-ИН (CATALYST_JUDGE_LIVE=1) -- живой прогон тратит
# токены; без ручки -- код 3 и громкая строка «НЕ ИЗМЕРЕНО» с точной
# командой: молчаливый пропуск приёмки неотличим от пройденной.
#
# Самопроверка прибора: bash <стенд> --self-check. Мутационные зубы на КОПИИ
# дерева, БЕЗ единого живого вызова модели (сценарии исполняются поддельным
# образом claude). Коды самопроверки: 0 -- каждая мутация поймана заявленным
# кодом и причиной; 1 -- есть мутация, прошедшая молча или чужой причиной;
# 2 -- прибор не может мерить (пристинный контроль провален / якорь мутации
# не уникален / мутация сломала разбор жертвы / сценария нет); 4 --
# объявленные числа таблиц не сходятся или сценарий остался без своего зуба.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PLUGIN="$ROOT/plugins/catalyst-probes"
PASS=0; FAIL=0; UNMEAS=0
# Ожидаемое зелёное = число боевых ступеней (случай L1: по одной проверке на
# ступень) + 1 (случай L2). Считается после разбора боевого конфига.
EXPECTED_OK=0

JUDGE_EMPTY_MAXLEN=0      # «пусто» -- РОВНО ноль знаков: $.model.complete
                          # отдаёт конкатенацию текстовых блоков, и ноль
                          # означает «текстовых блоков не было» (#190)
JUDGE_STUB_MAXLEN=2       # 1..2 знака -- огрызок: кратчайший РАЗБИРАЕМЫЙ
                          # вердикт «OK:» занимает 3 знака, короче вердикта
                          # быть не может

ok()  { PASS=$((PASS+1)); printf 'ok     %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf 'ПРОВАЛ %s\n' "$*"; }
unmeasured() { UNMEAS=$((UNMEAS+1)); printf 'НЕ ИЗМЕРЕНО %s\n' "$*"; }

# Классификация длины ответа ступени; обе границы -- числами выше, и обе
# участвуют в проверках ниже (пусто/огрызок -- отдельные красные ветки).
len_class() {   # <N> -> ровно одно слово: пусто | огрызок | ответ
  local n="$1"
  if [ "$n" -le "$JUDGE_EMPTY_MAXLEN" ]; then printf 'пусто\n'
  elif [ "$n" -le "$JUDGE_STUB_MAXLEN" ]; then printf 'огрызок\n'
  else printf 'ответ\n'
  fi
}

# --- САМОПРОВЕРКА (--self-check): мутационные зубы --------------------------------
# Образец формы -- judge-tools-bench.py и probes-sync-bench.sh (дом
# Catalyst-CC-Patch): пристинный контроль ДО мутаций; каждая мутация обязана
# отклонить СВОЙ именованный сценарий ЗАЯВЛЕННЫМ кодом и причиной;
# объявленные длины таблиц сверяются; «сценария нет» -- отказ прибора.
#
# CONSTRAINT: самопроверка не делает НИ ОДНОГО живого вызова модели: сценарий
# исполняется поддельным образом claude, который строит только артефакты, по
# которым стенд судит о прогоне (транскрипт сессии с одним tool_use Task,
# журнал дома проб, одну улику судьи) из синтетической улики. Живые вызовы
# остаются только у приёмки CATALYST_JUDGE_LIVE=1.
#
# CONSTRAINT: «мутация поймана» -- это НЕ «любой ненулевой код» (отвергнутая
# форма judge-ladder-probe.py: там удаление сценария из таблицы давало
# зелёное «покрытие=полное», а любой упавший мутант засчитывался зубом).
# Пойманность -- три условия РАЗОМ: РОВНО заявленный код возврата, заявленная
# причина в выводе, и причина пристинного прогона СНЯТА. Падение жертвы с
# незаявленным кодом или текстом зубом не считается.
#
# CONSTRAINT: мутации применяются к КОПИИ дерева; между мутациями жертва
# восстанавливается из пристинного снимка, и восстановление сверяется по
# sha256: мутация, приехавшая поверх предыдущей, мерила бы смесь, а не свой
# зуб. До первой мутации пристинная копия обязана пройти ВСЕ сценарии с
# заявленными исходами -- уже красная копия «подтвердит» любую мутацию чужим
# отказом, и зелёный итог ничего бы не значил.
#
# CONSTRAINT: якоря мутаций хранятся СКЛЕЙКОЙ ПОЛОВИН: полный литерал якоря
# в таблице был бы вторым вхождением этого якоря в исходник, и требование
# уникальности якоря отказало бы на первой же мутации.

SCEN_DECLARED=11     # объявленное число сценариев: сверяется с таблицей (4)
MUT_DECLARED=12      # объявленное число мутаций: сверяется с таблицей (4)

# Сценарий = один прогон КОПИИ стенда на синтетическом мире. «Боевой» конфиг
# сценария -- три ступени fake-rung-0/1/2 (те же формы таблиц, что в живом
# probes.toml); улика сценария подставляется в дом проб поддельным образом.
# Ожидаемый исход -- (код возврата, причина в выводе) пристинной копии.
SC_NAMES=(green-full l1-empty l1-stub l1-none l1-no-kind l2-no-kind-used l2-degenerated l2-none-answered l2-all-refused live-toml-absent live-toml-no-judge)
SC_RCS=(0 1 1 1 3 3 1 1 3 2 2)
SC_MARKERS=(
  'веер не выродился'
  'вернула пусто'
  'огрызок'
  'вердикт не разобран'
  'не несёт поля kind'
  'не несёт kind/used'
  'веер выродился'
  'ни одна ступень не дала вердикта'
  'все ступени отказали'
  'боевого конфига нет'
  'ступеней судьи нет'
)

# Мутация = снятие РОВНО одного зуба стенда. Поля: id | сценарий | якорь
# (половина-1 + половина-2) | замена | код, который должен дать mutant |
# причина, которую mutant обязан произнести | причина пристинного прогона,
# обязанная ИСЧЕЗНУТЬ (пусто -- если в мутанте она остаётся законно).
MUT_IDS=(l2-green-drop expected-arith empty-boundary stub-boundary l1-none-blind l1-kind-forged l2-kindused-blind degen-blind none-reason-lost allref-forged toml-blind nojudge-blind)
MUT_SCEN=(green-full green-full l1-empty l1-stub l1-none l1-no-kind l2-no-kind-used l2-degenerated l2-none-answered l2-all-refused live-toml-absent live-toml-no-judge)
MUT_A1=(
  'ok "веер не выро'
  'EXPECTED_OK=$(( ${#RUNG_MO'
  '[ "$n" -le "$JUDGE_EMPTY_M'
  'JUDGE_STUB_MAX'
  'elif [ "$kind1" = "NO'
  'elif [ "$kind1" = "-" ] || [ -z "$kin'
  'elif [ "$kind2" = "-" ] || [ -z "$kind2" ] |'
  'elif [ "$used2" = "$fi'
  '[ "$em" = "-" ] && aller'
  'if [ "$allerr" -eq 1 ]; th'
  'if [ ! -f "$LIVE_TOML" ]; th'
  'if j0 is None or m0 is No'
)
MUT_A2=(
  'дился, первая ступень ответила"'
  'DELS[@]} + 1 ))'
  'AXLEN" ]; then'
  'LEN=2'
  'NE" ]; then'
  'd1" ]; then'
  '| [ "$used2" = "-" ] || [ -z "$used2" ]; then'
  'rst" ]; then'
  'r=0'
  'en'
  'en'
  'ne:'
)
MUT_NEW=(
  ': # мутация: зелёное L2 не посчитано'
  'EXPECTED_OK=$(( ${#RUNG_MODELS[@]} + 0 ))'
  '[ "$n" -lt "$JUDGE_EMPTY_MAXLEN" ]; then'
  'JUDGE_STUB_MAXLEN=1'
  'elif false; then'
  'elif false; then'
  'elif false; then'
  'elif [ "$used2" != "$first" ]; then'
  '[ "$em" = "-" ] && allerr=1'
  'if false; then'
  'if false; then'
  'if False:'
)
MUT_RC=(3 3 1 1 1 3 1 0 1 1 2 2)
MUT_SUB=(
  'ожидалось зелёных 4'
  'ожидалось зелёных 3'
  'огрызок'
  'вердикт не разобран'
  'вердикт NONE'
  'вердикт -'
  'веер выродился'
  'веер не выродился'
  'все ступени отказали'
  'ни одна ступень не дала вердикта'
  'боевой конфиг не читается'
  'Traceback'
)
MUT_ABS=(
  'веер не выродился'
  ''
  'вернула пусто'
  'огрызок'
  'вердикт не разобран'
  'не несёт поля kind'
  'не несёт kind/used'
  'веер выродился'
  'ни одна ступень не дала вердикта'
  'все ступени отказали'
  'боевого конфига нет'
  'ступеней судьи нет'
)

sc_tables_check() {   # числа объявлены; сценарий мутации существует; каждый сценарий покрыт
  local n m found
  if [ "${#SC_NAMES[@]}" -ne "$SCEN_DECLARED" ] || [ "${#MUT_IDS[@]}" -ne "$MUT_DECLARED" ]; then
    printf 'self-check: ОТКАЗ -- объявлено сценариев %s и мутаций %s, в таблицах %s и %s\n' \
      "$SCEN_DECLARED" "$MUT_DECLARED" "${#SC_NAMES[@]}" "${#MUT_IDS[@]}"
    return 4
  fi
  for m in "${MUT_SCEN[@]}"; do
    found=0
    for n in "${SC_NAMES[@]}"; do [ "$n" = "$m" ] && found=1; done
    if [ "$found" -ne 1 ]; then
      # Ссылка мутации в пустоту -- отказ прибора, а не зелёное «покрытие»:
      # ровно этот дефект (удалённый сценарий = зелёное) погубил отвергнутую
      # копию прибора.
      printf 'self-check: ОТКАЗ ПРИБОРА: мутация ссылается на несуществующий сценарий: %s\n' "$m" >&2
      return 2
    fi
  done
  for n in "${SC_NAMES[@]}"; do
    found=0
    for m in "${MUT_SCEN[@]}"; do [ "$n" = "$m" ] && found=1; done
    if [ "$found" -ne 1 ]; then
      printf 'self-check: ОТКАЗ -- сценарий %s не покрыт ни одной мутацией: непокрытый сценарий не доказывает ничего\n' "$n"
      return 4
    fi
  done
  return 0
}

sc_build_world() {   # синтетические дома и поддельные образы всех сценариев
  python3 - "$SC_ROOT" "${SC_NAMES[@]}" <<'PY'
import json, os, sys
root, names = sys.argv[1], sys.argv[2:]
RUNGS = ["fake-rung-0", "fake-rung-1", "fake-rung-2"]
# Синтетический «боевой» конфиг -- в тех же формах, что и живой probes.toml.
LIVE_TOML = "[probe.judge]\ntimeout_ms = 240000\n\n" + "".join(
    "[[probe.judge.models]]\nmodel = \"%s\"\n\n" % r for r in RUNGS)

def fake(evidence_json):
    # Поддельный образ claude: живых вызовов нет; строятся только артефакты,
    # по которым стенд судит о прогоне.
    tool = "'" + json.dumps({"message": {"content": [
        {"type": "tool_use", "name": "Task", "input": {}}]}}) + "'"
    lines = [
        "#!/usr/bin/env bash",
        "set -u",
        'mkdir -p "$CLAUDE_CONFIG_DIR/projects/fake" "$CLAUDE_PROBES_DIR/judge/records"',
        "printf '%s\\n' " + tool
        + ' > "$CLAUDE_CONFIG_DIR/projects/fake/session.jsonl"',
        "printf '%s\\n' '{\"fake\": \"journal\"}'"
        ' > "$CLAUDE_PROBES_DIR/judge/journal.jsonl"',
        "cat > \"$CLAUDE_PROBES_DIR/judge/records/mod-0001.json\" <<'FAKE_EVIDENCE'",
        evidence_json,
        "FAKE_EVIDENCE",
        "exit 0",
    ]
    return "\n".join(lines) + "\n"

def evidence(kind=None, used=None, ladder=None, raw=None, err=None):
    d = {}
    if kind is not None:
        d["kind"] = kind
    if used is not None:
        d["used"] = used
    if ladder is not None:
        d["ladder"] = ladder
    if raw is not None:
        for i, r in enumerate(RUNGS):
            n = raw if isinstance(raw, int) else raw[i]
            if n is not None:
                d["rawLen_" + r] = n
    if err is not None:
        for r in RUNGS:
            d["err_" + r] = err
    return json.dumps(d, ensure_ascii=False)

SPECS = {
    # Полностью зелёный мир: контроль «стенд умеет давать зелёное».
    "green-full": dict(kind="BLOCK", used=RUNGS[0], ladder=RUNGS, raw=5),
    # L1: ровно ноль знаков -- «пусто» (нижняя граница порога пустоты).
    "l1-empty": dict(kind="BLOCK", used=RUNGS[0], ladder=RUNGS, raw=[0, 5, 5]),
    # L1: два знака -- «огрызок» (верхняя граница класса огрызка).
    "l1-stub": dict(kind="NONE", used=RUNGS[0], ladder=RUNGS, raw=[2, 5, 5]),
    # L1: непустой ответ, вердикт не разобран.
    "l1-none": dict(kind="NONE", used=RUNGS[0], ladder=RUNGS, raw=5),
    # L1: улика без поля kind -- НЕ ИЗМЕРЕНО, не вердикт.
    "l1-no-kind": dict(used=RUNGS[0], ladder=RUNGS, raw=5),
    # L2: улика без kind/used -- НЕ ИЗМЕРЕНО, не «веер выродился».
    "l2-no-kind-used": dict(ladder=RUNGS, raw=5),
    # L2: вердикт дала ВТОРАЯ ступень -- веер выродился.
    "l2-degenerated": dict(kind="BLOCK", used=RUNGS[1], ladder=RUNGS, raw=5),
    # L2: вердикта нет, но ступени ОТВЕЧАЛИ -- красное своей причиной.
    "l2-none-answered": dict(kind="NONE", used=RUNGS[0], ladder=RUNGS, raw=5),
    # L2: вердикта нет и ВСЕ ступени отказали -- прибор, не находка.
    "l2-all-refused": dict(kind="NONE", used=RUNGS[0], ladder=RUNGS,
                           err="HTTP 529"),
}

for name in names:
    d = os.path.join(root, "scen-" + name)
    if name == "live-toml-absent":
        # Дом не создаём ВОВСЕ: отсутствие боевого конфига -- предмет
        # сценария. Образ всё равно нужен: стенд проверяет образ РАНЬШЕ
        # боевого конфига.
        os.makedirs(d, exist_ok=True)
    elif name == "live-toml-no-judge":
        os.makedirs(os.path.join(d, "home"), exist_ok=True)
        open(os.path.join(d, "home", "probes.toml"), "w").write(
            "[probe.other]\nx = 1\n")
    elif name in SPECS:
        os.makedirs(os.path.join(d, "home"), exist_ok=True)
        open(os.path.join(d, "home", "probes.toml"), "w").write(LIVE_TOML)
    else:
        sys.stderr.write("нет спецификации сценария: %s\n" % name)
        raise SystemExit(2)
    ev = evidence(**SPECS[name]) if name in SPECS else "{}"
    img = os.path.join(d, "fake-claude")
    open(img, "w").write(fake(ev))
    os.chmod(img, 0o755)
print("синтетических миров: %d" % len(names))
PY
}

sc_sha256() {   # <файл> -> sha256: восстановление жертвы сверяется побайтово
  python3 -c 'import hashlib, sys
print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$1"
}

sc_run() {   # <сценарий> <корень копии> <файл вывода> -> код возврата копии стенда
  # CONSTRAINT: присваивания РАЗНЕСЕНЫ: в `local d=$x home="$d/y"` слова
  # аргументов раскрываются ДО исполнения local, и под set -u второе падает
  # «unbound variable» (тот же класс, что закомментирован в
  # test-plugin-freshness.sh).
  local name="$1"
  local copy="$2"
  local outf="$3"
  local d="$SC_ROOT/scen-$name"
  local home="$d/home"
  # Для сценария отсутствующего дома подставляем путь, которого нет: сам
  # факт «дома нет» и есть предмет сценария.
  [ "$name" = live-toml-absent ] && home="$d/нет-такого-дома"
  env CATALYST_JUDGE_LIVE=1 \
      CATALYST_JUDGE_IMAGE="$d/fake-claude" \
      CLAUDE_PROBES_HOME="$home" \
      bash "$copy/tests/scripts/test-judge-ladder-live.sh" > "$outf" 2>&1
  return $?
}

self_check() {
  local trc=0
  sc_tables_check
  trc=$?
  [ "$trc" -eq 0 ] || return "$trc"
  SC_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/ladder-selfcheck.XXXXXX") || return 2
  trap 'rm -rf "$SC_ROOT"' EXIT
  sc_build_world || return 2
  # Копия дерева и пристинный снимок жертвы: рабочий файл не трогается.
  mkdir "$SC_ROOT/tree" || return 2
  cp -R "$ROOT/." "$SC_ROOT/tree/" || return 2
  rm -rf "$SC_ROOT/tree/.git"
  local VICTIM="$SC_ROOT/tree/tests/scripts/test-judge-ladder-live.sh"
  cp "$VICTIM" "$SC_ROOT/pristine.sh" || return 2
  local PRISTINE_SHA i rc out reddened=0 now_sha
  PRISTINE_SHA=$(sc_sha256 "$SC_ROOT/pristine.sh")
  bash -n "$VICTIM" || {
    printf 'self-check: ОТКАЗ ПРИБОРА: жертва не разбирается bash\n' >&2
    return 2
  }

  # КОНТРОЛЬ: пристинная копия обязана дать КАЖДОМУ сценарию его заявленный
  # исход. Контроль провален -- мутации не меряют ничего, прибор не может
  # мерить (2), а не «зубы прошли с одной оговоркой».
  for i in "${!SC_NAMES[@]}"; do
    out="$SC_ROOT/out.control.${SC_NAMES[$i]}"
    sc_run "${SC_NAMES[$i]}" "$SC_ROOT/tree" "$out"
    rc=$?
    if [ "$rc" -ne "${SC_RCS[$i]}" ] || ! grep -qF -- "${SC_MARKERS[$i]}" "$out"; then
      printf 'self-check: КОНТРОЛЬ ПРОВАЛЕН -- пристинная копия на сценарии %s дала rc=%s, ждали rc=%s с причиной «%s»:\n' \
        "${SC_NAMES[$i]}" "$rc" "${SC_RCS[$i]}" "${SC_MARKERS[$i]}"
      cat "$out"
      return 2
    fi
    printf '  контроль %-21s rc=%s, причина на месте\n' "${SC_NAMES[$i]}" "$rc"
  done
  printf 'self-check: КОНТРОЛЬ без мутаций: %s сценариев дали заявленные исходы\n' "${#SC_NAMES[@]}"

  for i in "${!MUT_IDS[@]}"; do
    cp "$SC_ROOT/pristine.sh" "$VICTIM"
    now_sha=$(sc_sha256 "$VICTIM")
    if [ "$now_sha" != "$PRISTINE_SHA" ]; then
      printf 'self-check: ОТКАЗ ПРИБОРА: восстановление жертвы из снимка не сошлось по sha256 (мутация %s)\n' "${MUT_IDS[$i]}" >&2
      return 2
    fi
    printf '%s' "${MUT_A1[$i]}${MUT_A2[$i]}" > "$SC_ROOT/anchor.txt"
    printf '%s' "${MUT_NEW[$i]}" > "$SC_ROOT/repl.txt"
    python3 - "$VICTIM" "$SC_ROOT/anchor.txt" "$SC_ROOT/repl.txt" <<'PY' || return 2
import sys
victim, anchor_f, repl_f = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(victim, encoding="utf-8").read()
anchor = open(anchor_f, encoding="utf-8").read()
repl = open(repl_f, encoding="utf-8").read()
n = text.count(anchor)
if n != 1:
    sys.stderr.write("якорь найден %d раз, ожидался ровно один\n" % n)
    raise SystemExit(2)
open(victim, "w", encoding="utf-8").write(text.replace(anchor, repl, 1))
PY
    bash -n "$VICTIM" || {
      printf 'self-check: ОТКАЗ ПРИБОРА: мутация %s сломала разбор жертвы -- покраснение разбором ничего не доказывает\n' "${MUT_IDS[$i]}" >&2
      return 2
    }
    out="$SC_ROOT/out.mut.${MUT_IDS[$i]}"
    sc_run "${MUT_SCEN[$i]}" "$SC_ROOT/tree" "$out"
    rc=$?
    if [ "$rc" -eq "${MUT_RC[$i]}" ] \
       && grep -qF -- "${MUT_SUB[$i]}" "$out" \
       && { [ -z "${MUT_ABS[$i]}" ] || ! grep -qF -- "${MUT_ABS[$i]}" "$out"; }; then
      reddened=$((reddened+1))
      printf '  ok     %-19s сценарий %-19s отклонился заявленно (rc=%s)\n' \
        "${MUT_IDS[$i]}" "${MUT_SCEN[$i]}" "$rc"
    else
      printf '  ПРОВАЛ %-19s ждали rc=%s, причину «%s», без «%s»; получили rc=%s:\n' \
        "${MUT_IDS[$i]}" "${MUT_RC[$i]}" "${MUT_SUB[$i]}" "${MUT_ABS[$i]}" "$rc"
      cat "$out"
    fi
  done
  printf 'self-check: SELF-CHECK мутаций=%s покраснели=%s\n' \
    "${#MUT_IDS[@]}" "$reddened"
  [ "$reddened" -eq "${#MUT_IDS[@]}" ] || return 1
  return 0
}

if [ "${1:-}" = "--self-check" ]; then
  self_check
  exit $?
fi

if [ "${CATALYST_JUDGE_LIVE:-}" != "1" ]; then
  printf 'НЕ ИЗМЕРЕНО: боевой веер судьи не мерился -- стенд тратит токены и включается явно.\n'
  printf '  Мерить так: CATALYST_JUDGE_LIVE=1 bash %s\n' "${0}"
  printf '  Читается (только чтение): %s/probes.toml\n' "${CLAUDE_PROBES_HOME:-$HOME/.claude/probes}"
  printf '  Нужны: доступные провайдеры ступеней (по умолчанию через ANTHROPIC_BASE_URL)\n'
  printf '  и образ claude в CATALYST_JUDGE_IMAGE (по умолчанию ~/.local/bin/claude).\n'
  printf '  Самопроверка прибора (мутации, без живых вызовов): bash %s --self-check\n' "${0}"
  # Код 3 -- «НЕ ИЗМЕРЕНО» для агрегатора: ноль означал бы пройденную приёмку.
  exit 3
fi

IMAGE="${CATALYST_JUDGE_IMAGE:-$HOME/.local/bin/claude}"
LIVE_HOME="${CLAUDE_PROBES_HOME:-$HOME/.claude/probes}"
LIVE_TOML="$LIVE_HOME/probes.toml"
BASE_URL="${ANTHROPIC_BASE_URL:-http://localhost:8317}"
API_KEY="${ANTHROPIC_API_KEY:-dummy-local-proxy}"

if [ ! -x "$IMAGE" ]; then
  printf 'ОТКАЗ ПРИБОРА: образа нет или он не исполняется: %s\n' "$IMAGE" >&2
  exit 2
fi
if [ ! -f "$LIVE_TOML" ]; then
  printf 'ОТКАЗ ПРИБОРА: боевого конфига нет: %s\n' "$LIVE_TOML" >&2
  exit 2
fi

ROOTDIR=$(mktemp -d "${TMPDIR:-/tmp}/judge-ladder.XXXXXX") || exit 2
trap 'rm -rf "$ROOTDIR"' EXIT

# --- разбор боевого конфига (ТОЛЬКО ЧТЕНИЕ) ------------------------------------
# CONSTRAINT: секция [probe.judge] и таблицы [[probe.judge.models]] копируются
# в дом прогона ДОСЛОВНО; единственная правка копии -- fail_closed -> false.
# Боевого [defaults] не заимствуем ничего: [defaults] в доме -- синтетический,
# как в test-judge-serves.sh. Нет боевого файла или ступеней судьи в нём --
# код 2 (прибор недоступен), не красное: это немощь машины оператора, не находка.
live_fan() {   # -> $ROOTDIR/live/{judge.toml,rungs.tsv,rung_N.toml}
  mkdir -p "$ROOTDIR/live" || return 2
  python3 - "$LIVE_TOML" "$ROOTDIR/live" <<'PY'
import os, re, sys
src, outdir = sys.argv[1], sys.argv[2]

def die(why):
    sys.stderr.write("ОТКАЗ ПРИБОРА: %s\n" % why)
    raise SystemExit(2)

try:
    # боевой конфиг открывается ТОЛЬКО на чтение
    lines = open(src).read().split("\n")
except OSError as e:
    die("боевой конфиг не читается: %s" % e)

def find_exact(header):
    for i, l in enumerate(lines):
        if l.strip() == header:
            return i
    return None

j0 = find_exact("[probe.judge]")
m0 = find_exact("[[probe.judge.models]]")
if j0 is None or m0 is None:
    die("в боевом конфиге нет секции [probe.judge] или таблиц [[probe.judge.models]] -- ступеней судьи нет")
if m0 < j0:
    die("таблицы ступеней стоят раньше секции [probe.judge] -- порядок боевого файла неожиданен")

m_end = len(lines)
for i in range(m0 + 1, len(lines)):
    s = lines[i].strip()
    if s.startswith("[") and s != "[[probe.judge.models]]":
        m_end = i
        break

judge = lines[j0:m0]
flipped = False
for i in range(len(judge)):
    if re.match(r"^\s*fail_closed\s*=", judge[i]):
        judge[i] = re.sub(r"=\s*\S.*$", "= false", judge[i], count=1)
        flipped = True
if not flipped:
    judge.append("fail_closed = false")

tables, cur = [], None
for l in lines[m0:m_end]:
    if l.strip() == "[[probe.judge.models]]":
        cur = [l]
        tables.append(cur)
    elif cur is not None:
        cur.append(l)

rungs = []
for t in tables:
    body = "\n".join(t)
    mm = re.search(r'^\s*model\s*=\s*"([^"]+)"', body, re.M)
    if mm is None:
        continue
    eff = re.search(r'^\s*effort\s*=\s*"([^"]+)"', body, re.M)
    ctx = re.search(r'^\s*context_chars\s*=\s*(\d+)', body, re.M)
    rungs.append({
        "text": "\n".join(t).rstrip("\n") + "\n",
        "model": mm.group(1),
        "effort": eff.group(1) if eff else "-",
        "ctx": ctx.group(1) if ctx else "-",
    })
if not rungs:
    die("таблицы [[probe.judge.models]] есть, но ни одна не называет model")

os.makedirs(outdir, exist_ok=True)
open(os.path.join(outdir, "judge.toml"), "w").write(
    "\n".join(judge).rstrip("\n") + "\n")
with open(os.path.join(outdir, "rungs.tsv"), "w") as f:
    for r in rungs:
        f.write("%s\t%s\t%s\n" % (r["model"], r["effort"], r["ctx"]))
for i, r in enumerate(rungs):
    open(os.path.join(outdir, "rung_%d.toml" % i), "w").write(r["text"])
print("боевых ступеней: %d (%s)" % (
    len(rungs), ", ".join(r["model"] for r in rungs)))
PY
}

live_fan || exit 2

RUNG_MODELS=(); RUNG_EFFORTS=(); RUNG_CTXS=()
while IFS=$'\t' read -r m e c; do
  RUNG_MODELS+=("$m"); RUNG_EFFORTS+=("$e"); RUNG_CTXS+=("$c")
done < "$ROOTDIR/live/rungs.tsv"
EXPECTED_OK=$(( ${#RUNG_MODELS[@]} + 1 ))
SESSION_MODEL="${CATALYST_JUDGE_SESSION_MODEL:-${RUNG_MODELS[0]}}"

# CONSTRAINT: промт судьи здесь СВОЙ, синтетический (как в
# test-judge-serves.sh): предмет приёмки -- ступени, а не качество боевого
# промта; боевой промт не читается даже.
mk_home_from_live() {   # <имя> [индексы ступеней...] -> печатает путь к дому проб
  local name="$1"
  shift
  local h="$ROOTDIR/$name/probes"
  mkdir -p "$h/judge/records"
  {
    printf '[defaults]\nmax_tokens = 4000\ntimeout_ms = 240000\nenforce = true\ncontext_chars = 20000\n\n'
    cat "$ROOTDIR/live/judge.toml"
    local i
    if [ "$#" -gt 0 ]; then
      for i in "$@"; do printf '\n'; cat "$ROOTDIR/live/rung_$i.toml"; done
    else
      i=0
      while [ "$i" -lt "${#RUNG_MODELS[@]}" ]; do
        printf '\n'; cat "$ROOTDIR/live/rung_$i.toml"; i=$((i+1))
      done
    fi
  } > "$h/probes.toml"
  cat > "$h/judge/prompt.md" <<'PROMPT'
Ты судья диспатчей. Тебе дают текст задачи для субагента.

Ответь ОДНОЙ строкой, начиная её ровно с одного из двух слов:
BLOCK:<причина>   -- если в задаче не названо, ЧТО делать, или не названо, ЧЕМ проверять результат.
OK:<причина>      -- если названо и то, и другое.

Никаких других форм ответа не давай.
PROMPT
  printf '%s' "$h"
}

# CONSTRAINT: окружение прогона -- в ОДНОМ экземпляре (рецепт run_body из
# test-judge-serves.sh); CLAUDE_PROBES_DIR всегда указывает во временный
# корень прогона, боевой дом проб ни читается, ни пишется образом.
run_body() {   # <корень прогона> <дом проб> <max-turns> <промт сессии>
  local r="$1" home="$2" turns="$3" prompt="$4"
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
      --max-turns "$turns" \
      -p "$prompt" \
      < /dev/null > "$r/stdout.log" 2> "$r/stderr.log"
    printf '%s' "$?" > "$r/rc"
  )
}

# Один диспатч с заведомо отклоняемой задачей: без предмета и без проверки.
REFUSE_TASK="разберись с логами"
run_case() {   # <имя> <дом проб>
  local name="$1" home="$2"
  run_body "$ROOTDIR/$name" "$home" 8 \
    "Сделай РОВНО ОДИН диспатч через инструмент Task (subagent_type: general-purpose) с задачей: «${REFUSE_TASK}». Больше ничего не делай. Если диспатч отклонён -- назови текст отказа и остановись."
}

# Число улик в доме -- числом, а не наличием каталога (рецепт test-judge-serves.sh).
recs() { ls "$1/judge/records" 2>&1 | grep -c '^mod-' || true; }

# Число СОВЕРШЁННЫХ диспатчей -- СТРУКТУРНО по блокам tool_use в транскриптах
# сессий: подстрочный счёт врёт (промт и схема инструментов несут те же строки).
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

# Журнал дома пишется шардами; пустой набор журналов -- мод не поднялся.
journal_files() {   # <дом проб> -> пути журнала, по одному в строке
  local f
  for f in "$1/judge/journal.jsonl" "$1"/judge/journal.jsonl.shard.*; do
    [ -f "$f" ] && printf '%s\n' "$f"
  done
  return 0
}

# Поля улики поимённо; значения сглаживаются в одну строку -- протокол
# «ключ<TAB>значение» обязан оставаться однострочным. Последняя запись дома:
# в каждом случае стенда диспатч ровно один.
rec_fields() {   # <дом проб> <модель...> -> строки «ключ<TAB>значение»
  local home="$1"
  shift
  python3 - "$home/judge/records" "$@" <<'PY'
import json, os, sys
d, models = sys.argv[1], sys.argv[2:]

def flat(v):
    return "-" if v is None else str(v).replace("\t", " ").replace("\n", " ")

files = sorted(os.listdir(d)) if os.path.isdir(d) else []
if not files:
    print("нет\tулик отсутствует"); raise SystemExit(0)
r = json.load(open(os.path.join(d, files[-1])))
print("kind\t%s" % flat(r.get("kind")))
print("used\t%s" % flat(r.get("used")))
print("ladder\t%s" % ",".join(r.get("ladder") or []))
for m in models:
    for k in ("rawLen_", "ms_", "err_", "effortBad_"):
        print("%s%s\t%s" % (k, m, flat(r.get(k + m))))
PY
}

getf() {   # <поля> <ключ> -> значение (точное равенство ключа до таба; «-» если нет)
  printf '%s\n' "$1" | awk -F'\t' -v k="$2" '$1 == k {print $2; f=1} END {if (!f) print "-"}'
}

# --- L1: КАЖДАЯ боевая ступень поодиночке --------------------------------------
# По каждой ступени -- свой дом с лестницей РОВНО из этой одной ступени,
# значения model/effort/context_chars -- дословно из боевого конфига.
idx=0
for m in "${RUNG_MODELS[@]}"; do
  H1=$(mk_home_from_live "l1-$idx" "$idx")
  run_case "l1-$idx" "$H1"
  d1=$(dispatches "$ROOTDIR/l1-$idx")
  n1=$(recs "$H1")
  if [ "$d1" -eq 0 ]; then
    unmeasured "L1 $m: сессия не сделала ни одного диспатча -- ступень не измерена"
    idx=$((idx+1)); continue
  fi
  if [ -z "$(journal_files "$H1")" ]; then
    unmeasured "L1 $m: прогон не поднял мод -- журнала дома проб нет вовсе"
    idx=$((idx+1)); continue
  fi
  if [ "$n1" -ne 1 ]; then
    bad "L1 $m: диспатчей $d1, улик $n1 -- вызов без улики (форма #189)"
    idx=$((idx+1)); continue
  fi
  f1=$(rec_fields "$H1" "$m")
  kind1=$(getf "$f1" kind)
  raw1=$(getf "$f1" "rawLen_$m")
  ms1=$(getf "$f1" "ms_$m")
  err1=$(getf "$f1" "err_$m")
  ebad1=$(getf "$f1" "effortBad_$m")
  cls1="нет"
  [ "$raw1" != "-" ] && cls1=$(len_class "$raw1")
  line1="ступень $m (effort ${RUNG_EFFORTS[$idx]}): kind=$kind1 rawLen_$m=$raw1 ms_$m=$ms1 класс=$cls1"
  [ "$err1" != "-" ] && line1="$line1 err_$m=$err1"
  printf '%s\n' "$line1"
  if [ "$err1" != "-" ]; then
    # Отказ ступени -- прибор, а не находка; негодный эффорт виден той же
    # отказанной попыткой (см. комментарий у ступеней в боевом конфиге).
    unmeas1="L1 $m: ступень отказала -- $err1"
    [ "$ebad1" != "-" ] && unmeas1="$unmeas1 (effortBad=$ebad1)"
    unmeasured "$unmeas1"
  elif [ "$raw1" = "-" ]; then
    unmeasured "L1 $m: улика не несёт rawLen_$m -- длину ответа нечем измерить"
  elif [ "$cls1" = "пусто" ]; then
    bad "ступень $m вернула пусто (rawLen=$raw1)"
  elif [ "$cls1" = "огрызок" ]; then
    bad "ступень $m ответила $raw1 зн. -- огрызок, короче кратчайшего вердикта"
  elif [ "$kind1" = "NONE" ]; then
    bad "ступень $m ответила $raw1 знаков, вердикт не разобран"
  elif [ "$cls1" != "ответ" ]; then
    # CONSTRAINT: НЕопознанное значение уходит в НЕ ИЗМЕРЕНО, а не в зелёное.
    # len_class отдаёт ровно три слова; всё прочее значит, что rawLen был
    # нечисловым и классификатор не отработал -- это немощь прибора, и
    # зелёное на ней утверждало бы ответ, которого никто не измерял.
    unmeasured "L1 $m: длина ответа не классифицирована (rawLen=$raw1, класс «${cls1}»)"
  elif [ "$kind1" = "-" ] || [ -z "$kind1" ]; then
    unmeasured "L1 $m: улика не несёт поля kind -- вердикт нечем измерить"
  else
    ok "ступень $m ответила, вердикт $kind1"
  fi
  idx=$((idx+1))
done

# --- L2: ПОЛНАЯ боевая лестница, вердикт двусторонний ---------------------------
H2=$(mk_home_from_live l2)
run_case l2 "$H2"
d2=$(dispatches "$ROOTDIR/l2")
n2=$(recs "$H2")
first="${RUNG_MODELS[0]}"
if [ "$d2" -eq 0 ]; then
  unmeasured "L2: сессия не сделала ни одного диспатча -- лестница не измерена"
elif [ -z "$(journal_files "$H2")" ]; then
  unmeasured "L2: прогон не поднял мод -- журнала дома проб нет вовсе"
elif [ "$n2" -ne 1 ]; then
  bad "L2: диспатчей $d2, улик $n2 -- вызов без улики (форма #189)"
else
  f2=$(rec_fields "$H2" "${RUNG_MODELS[@]}")
  kind2=$(getf "$f2" kind)
  used2=$(getf "$f2" used)
  lad2=$(getf "$f2" ladder)
  exp_lad=$(IFS=,; printf '%s' "${RUNG_MODELS[*]}")
  raw0=$(getf "$f2" "rawLen_$first")
  err0=$(getf "$f2" "err_$first")
  printf 'лестница «%s»: used=%s, kind=%s\n' "$lad2" "$used2" "$kind2"
  if [ "$lad2" != "$exp_lad" ]; then
    bad "L2: лестница улики не совпала с боевой: «${lad2}» против «${exp_lad}»"
  elif [ "$kind2" = "-" ] || [ -z "$kind2" ] || [ "$used2" = "-" ] || [ -z "$used2" ]; then
    # CONSTRAINT: улика без kind/used -- НЕ ИЗМЕРЕНО, а не вердикт. Иначе
    # пустое used сравнивалось бы с первой ступенью и давало КРАСНОЕ
    # «веер выродился» на прогоне, где веер вообще не наблюдался.
    # CONSTRAINT: переменные здесь ТОЛЬКО в скобочной форме: bash 3.2 (живой
    # интерпретатор на darwin) склеивает байт » с концом имени -- «$kind2»
    # даёт «kind2<мусор>: unbound variable» под set -u, и ветка НЕ ИЗМЕРЕНО
    # падает вместо того, чтобы отчитаться (замерено самопроверкой 16.09).
    unmeasured "L2: улика не несёт kind/used (kind=«${kind2}», used=«${used2}») -- веер нечем измерить"
  elif [ "$kind2" = "NONE" ]; then
    # Вердикта нет: если отказали ВСЕ ступени -- это немощь прибора (провайдеры
    # недоступны), не находка; если хоть одна отвечала -- находка.
    allerr=1; errs2=""
    for m in "${RUNG_MODELS[@]}"; do
      em=$(getf "$f2" "err_$m")
      [ "$em" = "-" ] && allerr=0
      errs2="$errs2$m: $em; "
    done
    if [ "$allerr" -eq 1 ]; then
      unmeasured "L2: все ступени отказали (недоступность провайдера это прибор): $errs2"
    else
      bad "ни одна ступень не дала вердикта (used=$used2)"
    fi
  elif [ "$used2" = "$first" ]; then
    ok "веер не выродился, первая ступень ответила"
  else
    bad "веер выродился: первая ступень $first не ответила (rawLen=$raw0, err=$err0), вердикт дала $used2"
  fi
fi

# CONSTRAINT: частично измеренная приёмка не имеет права выглядеть пройденной
# (корень #158): три условия независимы и проверяются порознь.
printf '\nприёмка боевого веера: зелёных %s, красных %s, НЕ ИЗМЕРЕНО %s (ожидалось зелёных %s)\n' "$PASS" "$FAIL" "$UNMEAS" "$EXPECTED_OK"
[ "$FAIL" -eq 0 ] || exit 1
[ "$UNMEAS" -eq 0 ] || exit 3
[ "$PASS" -eq "$EXPECTED_OK" ] || exit 3
exit 0
