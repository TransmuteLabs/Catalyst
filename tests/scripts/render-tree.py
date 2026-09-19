#!/usr/bin/env python3
# Оснастка приёмки рендера (#258): снимает ОБЕ поверхности мода, а не то, что
# нарисовал терминал.
#
# Поверхности (замерено по чужим модам, поправка брифа 2026-09-19):
#   1) панель -- обработчик ui.render ВОЗВРАЩАЕТ дерево;
#   2) статусная строка -- мод ВЫЗЫВАЕТ $.ui.status(text), text -- строка,
#      undefined/null -- ОЧИСТКА строки; компонента у поверхности нет.
# Очистка -- событие: «строку очистили» и «строку не трогали» различаются.
# Статусная строка -- главная поверхность будущего мода: прибор, снимающий
# только возврат, не увидел бы её ни разу и был бы при этом зелёным.
#
# Дорога снятия: безголовый node-субпроцесс (--experimental-strip-types) грузит
# TS-мод, зовёт register(on), находит обработчика заданного события и вызывает
# его с мок-$ (без доступа к боевому дому: fs-гвард корня, env только из
# инъекции, перехват $.ui.status в самом моке -- он и есть дорога вызова).
# Конверт несёт ОБЕ формы: {status, tree?, uiStatus{calls}} плюс три РАЗНЫХ
# статуса беды -- empty / threw / unloadable; их неразличимость и есть причина,
# по которой глаз негоден. Статус «empty» ставится только когда пусты ОБЕ
# формы: мод, пишущий строку и вернувший пусто, снят как строка и «пустым»
# не назван. Безголовый `claude -p` рендер не зовёт (замер 2026-09-19:
# свидетель statusLine не создан, изолированный дом без учётки сессию не
# стартует) -- прямая дорога названа в HARNESS-render-tree.md.
#
# Устойчивый вид: ключи сортируются, пробелы нормализуются, подвижные величины
# (время, длительности, счётчики, проценты, пути) заменяются меткой РОДА
# («⟨время:iso⟩», «⟨счётчик:токены⟩», ...), не выбрасываются: потеря элемента и
# смена его значения -- разные события. Правила двух сортов: по ФОРМЕ ЗНАЧЕНИЯ
# (tree-агностично: ISO, часы, epoch, пути, проценты, длительности -- и на
# токенах строки статуса тоже) и по СЕМЕЙСТВУ ИМЕНИ КЛЮЧА (t/at/ms/dur/tok/...
# -- семейства, не имена поверхностей предмета). Канон захвата --
# {tree: ..., string: [текст|очистка, ...]} с отсутствующими пустыми слотами:
# потеря формы именуется сравнением как ПРОПАЛ.
#
# Сравнение называет расхождение: ПРОПАЛ / ЛИШНИЙ / ФОРМА / ЗНАЧЕНИЕ с путём
# в дереве ($, $.items[1].text, $.string[0]). Отказа вида «не совпало» здесь
# нет. Списки сравниваются ПО ИНДЕКСУ: удаление из середины даёт объявленный
# каскад ФОРМА+ПРОПАЛ хвоста, удаление хвоста -- чистый ПРОПАЛ.
#
# Коды возврата: 0 -- зелёный; 1 -- красный (расхождение/провал зуба);
# 2 -- ПРИБОР НЕДОСТУПЕН (нет node/python3/драйвера, ввод не разобран);
# 3 -- НЕ ИЗМЕРЕНО (зарезервировано за стендом test-render-tree.sh).
import argparse
import copy
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile

# --- метки рода подвижных величин --------------------------------------------

LBL_TIME_ISO = "⟨время:iso⟩"
LBL_TIME_CLOCK = "⟨время:часы⟩"
LBL_TIME_EPOCH_MS = "⟨время:epoch-ms⟩"
LBL_TIME_EPOCH_S = "⟨время:epoch-s⟩"
LBL_TIME_NAME = "⟨время:по-имени⟩"
LBL_DURATION = "⟨длительность⟩"
LBL_PCT = "⟨процент⟩"
LBL_PATH = "⟨путь⟩"
LBL_TOKENS = "⟨счётчик:токены⟩"
LBL_COST = "⟨счётчик:цена⟩"

# --- правила по форме значения (tree-агностичные) ----------------------------

ISO_RX = re.compile(
    r"^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$")
CLOCK_RX = re.compile(r"^\d{1,2}:\d{2}(?::\d{2})?$")
DUR_SIMPLE_RX = re.compile(r"^\d+(?:\.\d+)?(?:ms|s|m|h)$")
DUR_COMPOUND_RX = re.compile(r"^(?:\d+h)?(?:\d+m)?(?:\d+s)?$")
PCT_RX = re.compile(r"^\d+(?:\.\d+)?\s?%$")
PATH_RX = re.compile(r"^(/|~/)\S*$")
NUMISH_RX = re.compile(r"^\d[\d\s.,]*$")

# Окна epoch сужены до текущего десятилетия намеренно: широкое окно метило бы
# стабильные большие счётчики (цена в микродолларах, байты) -- их дрейф стал бы
# невидим. Сужение = меньше ложной маскировки, цена -- метка умрёт в 2030-х.
EPOCH_MS_LO, EPOCH_MS_HI = 1_600_000_000_000, 1_900_000_000_000
EPOCH_S_LO, EPOCH_S_HI = 1_600_000_000, 1_900_000_000

# --- правила по семейству имени ключа (не имена поверхностей предмета) -------

NAME_TIME_RX = re.compile(
    r"(^|[_-])(t|ts|dt|at|time|ms|dur|duration|elapsed|age|uptime|since)([_-]|\d|$)",
    re.I)
NAME_TOKEN_RX = re.compile(r"tok", re.I)
NAME_COST_RX = re.compile(r"cost|price|usd", re.I)
NAME_PCT_RX = re.compile(r"pct|percent", re.I)


def norm_spaces(s: str) -> str:
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" ?\n ?", "\n", s)
    return s.strip()


def label_token(t: str) -> str:
    """Токен строки статуса: подвижные величины по форме -- метками рода.

    Голые числа не метятся: в прозе строки счётчик неотличим от стабильного
    числа -- объявленное ограничение; счётчики будущего мода обязаны ехать
    деревом, где работает правило по имени ключа.
    """
    if ISO_RX.match(t):
        return LBL_TIME_ISO
    if CLOCK_RX.match(t):
        return LBL_TIME_CLOCK
    if PCT_RX.match(t):
        return LBL_PCT
    if DUR_SIMPLE_RX.match(t):
        return LBL_DURATION
    if DUR_COMPOUND_RX.match(t) and any(c.isalpha() for c in t):
        return LBL_DURATION
    if PATH_RX.match(t):
        return LBL_PATH
    if re.fullmatch(r"\d+", t):
        n = int(t)
        if EPOCH_MS_LO <= n <= EPOCH_MS_HI:
            return LBL_TIME_EPOCH_MS
        if EPOCH_S_LO <= n <= EPOCH_S_HI:
            return LBL_TIME_EPOCH_S
    return t


def canon_text(s: str) -> str:
    s = norm_spaces(s)
    return " ".join(label_token(t) for t in s.split(" ")) if s else ""


def canonical(v, key: str = ""):
    if isinstance(v, dict):
        return {k: canonical(v[k], k) for k in sorted(v.keys(), key=str)}
    if isinstance(v, list):
        return [canonical(x, key) for x in v]
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        if isinstance(v, int) and EPOCH_MS_LO <= v <= EPOCH_MS_HI:
            return LBL_TIME_EPOCH_MS
        if isinstance(v, int) and EPOCH_S_LO <= v <= EPOCH_S_HI:
            return LBL_TIME_EPOCH_S
        if NAME_TIME_RX.search(key or ""):
            return LBL_TIME_NAME
        if NAME_TOKEN_RX.search(key or ""):
            return LBL_TOKENS
        if NAME_COST_RX.search(key or ""):
            return LBL_COST
        if NAME_PCT_RX.search(key or ""):
            return LBL_PCT
        return v
    if isinstance(v, str):
        if ISO_RX.match(v):
            return LBL_TIME_ISO
        if PCT_RX.match(v):
            return LBL_PCT
        if DUR_SIMPLE_RX.match(v):
            return LBL_DURATION
        if DUR_COMPOUND_RX.match(v) and any(c.isalpha() for c in v):
            return LBL_DURATION
        if PATH_RX.match(v):
            return LBL_PATH
        if NUMISH_RX.match(v):
            if NAME_TOKEN_RX.search(key or ""):
                return LBL_TOKENS
            if NAME_COST_RX.search(key or ""):
                return LBL_COST
            if NAME_PCT_RX.search(key or ""):
                return LBL_PCT
            if NAME_TIME_RX.search(key or ""):
                return LBL_TIME_NAME
        return norm_spaces(v)
    return norm_spaces(str(v))


def canonical_status_call(c: dict) -> dict:
    """Событие статусной строки -- элемент дерева канона: текст либо очистка."""
    if c.get("op") == "clear":
        return {"очистка": True}
    return {"текст": canon_text(str(c.get("text", "")))}


def canon_of_envelope(env: dict):
    """Канон захвата: {tree: ..., string: [...]} без пустых слотов.

    None -- конверт не нёс ни одной формы (status != ok): пустота обеих форм
    именуется статусом конверта, а не пустым каноном.
    """
    if env.get("status") != "ok":
        return None
    out = {}
    if "tree" in env:
        out["tree"] = canonical(env["tree"])
    calls = (env.get("uiStatus") or {}).get("calls") or []
    if calls:
        out["string"] = [canonical_status_call(c) for c in calls]
    return out


def short(v) -> str:
    return json.dumps(v, ensure_ascii=False)[:80]


def compare(exp, got, path: str = "$"):
    """Именованные расхождения канонических форм: ПРОПАЛ/ЛИШНИЙ/ФОРМА/ЗНАЧЕНИЕ."""
    out = []
    if isinstance(exp, dict) and isinstance(got, dict):
        for k in exp.keys():
            if k not in got:
                out.append("ПРОПАЛ %s.%s (ожидался элемент, в снятом его нет)" % (path, k))
            else:
                out.extend(compare(exp[k], got[k], "%s.%s" % (path, k)))
        for k in got.keys():
            if k not in exp:
                out.append("ЛИШНИЙ %s.%s (в снятом есть, в ожидаемом нет)" % (path, k))
        return out
    if isinstance(exp, list) and isinstance(got, list):
        for i in range(min(len(exp), len(got))):
            out.extend(compare(exp[i], got[i], "%s[%d]" % (path, i)))
        for i in range(min(len(exp), len(got)), len(exp)):
            out.append("ПРОПАЛ %s[%d] (ожидался элемент, в снятом его нет)" % (path, i))
        for i in range(min(len(exp), len(got)), len(got)):
            out.append("ЛИШНИЙ %s[%d] (в снятом есть, в ожидаемом нет)" % (path, i))
        return out
    if _kind(exp) != _kind(got):
        out.append("ФОРМА %s: было %s, стало %s" % (path, short(exp), short(got)))
    elif exp != got:
        out.append("ЗНАЧЕНИЕ %s: было %s, стало %s" % (path, short(exp), short(got)))
    return out


def _kind(v) -> str:
    if isinstance(v, dict):
        return "объект"
    if isinstance(v, list):
        return "массив"
    if isinstance(v, bool):
        return "булево"
    if isinstance(v, (int, float)):
        return "число"
    if isinstance(v, str):
        return "строка"
    if v is None:
        return "пусто"
    return "прочее"


# --- безголовый драйвер снятия (node --experimental-strip-types) -------------
# Драйвер печатает ОДНУ строку конверта; статусы: ok / empty / threw /
# unloadable / no-subscription / ambiguous / instrument-broken.
# CONSTRAINT: on() в моде семьи чейнится .catch() -- мок обязан возвращать
# цепляемый объект (замерено на живом register.ts: без .catch падает сам
# register, и это было бы ложной «незагрузкой»).

DRIVER_JS = r'''
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function argOf(name, def) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}
function cut(x, n) {
  const s = String(x);
  return s.length > n ? s.slice(0, n) : s;
}

const modPath = path.resolve(argOf("--mod", ""));
const eventName = argOf("--event", "");
const payloadPath = argOf("--payload", "");
const clockBase = Number(argOf("--clock-base", "1750000000000"));
const root = fs.realpathSync(path.resolve(argOf("--root", ".")));

let done = false;
function emit(obj) {
  if (done) return;
  done = true;
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

// Состояние прогона объявлено ДО первой emit: конверт обязан нести след
// даже на раннем отказе (пустой след читался бы как «мод не звался»).
let clockSeq = 0;
const calls = {};
const callsLog = [];
const writes = [];
const uiStatusCalls = [];
const envDict = { HOME: root, CLAUDE_CONFIG_DIR: path.join(root, ".claude"), PWD: root };
const storeMap = new Map();
const files = new Map();
function rec(op) {
  calls[op] = (calls[op] || 0) + 1;
  if (callsLog.length < 32) callsLog.push(op);
}
function inRoot(p) {
  const r = path.resolve(String(p));
  return r === root || r.startsWith(root + path.sep);
}
const base = () => ({
  root,
  envHome: envDict.HOME,
  mod: path.basename(modPath),
  event: eventName,
  clockBase,
  calls,
  callsLog: callsLog.slice(),
  writes: writes.slice(),
  uiStatus: { touched: uiStatusCalls.length > 0, calls: uiStatusCalls.slice() },
});

// Часы мока: монотонная детерминированная лента от --clock-base, шаг 1000 мс.
// Движение между прогонами задаёт РАЗНЫЕ базы, а не стенные часы -- зуб
// «подвижное не краснит» не зависит от времени суток машины.
const $ = {
  clock: {
    async now() { rec("clock.now"); return clockBase + (clockSeq++) * 1000; },
    async sleep(_ms) { rec("clock.sleep"); return; },
    every(_ms, _cb) { rec("clock.every"); return { cancel() {} }; },
  },
  fs: {
    async read(p) {
      rec("fs.read");
      const rp = path.resolve(String(p));
      if (!inRoot(rp)) throw new Error("fs-guard: чтение вне корня прогона отказано: " + rp);
      if (files.has(rp)) return files.get(rp);
      try { return fs.readFileSync(rp, "utf8"); } catch (_x) { return null; }
    },
    async write(p, data) {
      rec("fs.write");
      const rp = path.resolve(String(p));
      if (!inRoot(rp)) throw new Error("fs-guard: запись вне корня прогона отказана: " + rp);
      files.set(rp, String(data));
      writes.push(rp);
      return;
    },
  },
  env: {
    async get(name) {
      rec("env.get");
      const k = String(name);
      return Object.prototype.hasOwnProperty.call(envDict, k) ? envDict[k] : "";
    },
  },
  store: {
    async get(k) { rec("store.get"); return storeMap.get(String(k)); },
    async set(k, v) { rec("store.set"); storeMap.set(String(k), v); },
    async delete(k) { rec("store.delete"); storeMap.delete(String(k)); },
    async keys() { rec("store.keys"); return Array.from(storeMap.keys()); },
  },
  session: {
    async id() { rec("session.id"); return "capture-session"; },
    async messages() { rec("session.messages"); return []; },
  },
  // Перехват статусной строки: КАЖДЫЙ вызов -- событие конверта; вызов без
  // строки (undefined/null) -- ОЧИСТКА, а не отсутствие события.
  ui: {
    async status(t) {
      rec("ui.status");
      uiStatusCalls.push(t === undefined || t === null
        ? { op: "clear" }
        : { op: "set", text: String(t) });
      return;
    },
    async toast(_t) { rec("ui.toast"); return; },
  },
  command: { async register(_c) { rec("command.register"); return; } },
  agent: { async list() { rec("agent.list"); return []; } },
  model: {
    async complete(_a) {
      rec("model.complete");
      return { text: "", stopReason: null, blocks: [], usage: { output_tokens: 0 } };
    },
  },
};

// Дедлайн прибора: обработчик, не вернувшийся за 20 c, -- названный отказ
// «threw», а не вечное молчание драйвера.
const hardTimer = setTimeout(() => {
  emit(Object.assign({ status: "threw", error: "дедлайн прибора: обработчик не вернулся за 20 c" }, base()));
}, 20000);

let mod;
try {
  mod = await import(pathToFileURL(modPath).href);
} catch (x) {
  clearTimeout(hardTimer);
  emit(Object.assign({ status: "unloadable", stage: "import", error: cut(x && x.message ? x.message : x, 400) }, base()));
}
if (typeof mod.register !== "function") {
  clearTimeout(hardTimer);
  emit(Object.assign({ status: "unloadable", stage: "register", error: "register не экспортирован функцией" }, base()));
}
const subs = [];
function on(ev, a, b) {
  const handler = b === undefined ? a : b;
  subs.push({ event: String(ev), handler });
  const r = { catch(_h) { return r; } };
  return r;
}
try {
  mod.register(on);
} catch (x) {
  clearTimeout(hardTimer);
  emit(Object.assign({ status: "unloadable", stage: "register-call", error: cut(x && x.message ? x.message : x, 400) }, base()));
}
const matches = subs.filter((s) => s.event === eventName);
if (matches.length === 0) {
  clearTimeout(hardTimer);
  emit(Object.assign({ status: "no-subscription", events: subs.map((s) => s.event) }, base()));
}
if (matches.length > 1) {
  clearTimeout(hardTimer);
  emit(Object.assign({ status: "ambiguous", n: matches.length, events: subs.map((s) => s.event) }, base()));
}
let payload = {};
if (payloadPath) {
  try {
    payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  } catch (x) {
    clearTimeout(hardTimer);
    emit(Object.assign({ status: "instrument-broken", error: "payload не разобран: " + cut(x, 160) }, base()));
  }
}
let res = null;
try {
  res = await matches[0].handler($, payload, async (_e) => {
    rec("next");
    return { ok: true };
  });
} catch (x) {
  clearTimeout(hardTimer);
  emit(Object.assign({ status: "threw", error: cut(x && x.message ? x.message : x, 400) }, base()));
}
clearTimeout(hardTimer);
function emptyForm(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string" && v === "") return "пустая строка";
  if (Array.isArray(v) && v.length === 0) return "пустой массив";
  if (v && typeof v === "object" && Object.keys(v).length === 0) return "пустой объект";
  return null;
}
const ef = emptyForm(res);
// «Пусто» -- только когда пусты ОБЕ формы: строка, уже выведенная в
// $.ui.status, снята, и мод, вернувший пусто после этого, «пустым» не назван.
if (ef !== null && uiStatusCalls.length === 0) {
  emit(Object.assign({ status: "empty", form: ef }, base()));
}
const okEnv = Object.assign({ status: "ok" }, base());
if (ef === null) okEnv.tree = res;
emit(okEnv);
'''


class InstrumentBroken(Exception):
    pass


def write_driver(d: str) -> str:
    p = os.path.join(d, "render-tree-driver.mjs")
    with open(p, "w", encoding="utf-8") as f:
        f.write(DRIVER_JS)
    return p


def run_capture(node: str, driver: str, mod: str, event: str, root: str,
                clock_base: int, payload: str = "", timeout: int = 45) -> dict:
    cmd = [node, "--experimental-strip-types", driver,
           "--mod", mod, "--event", event, "--clock-base", str(clock_base),
           "--root", root]
    if payload:
        cmd += ["--payload", payload]
    # Изоляция прогона: среда субпроцесса стирается до PATH+HOME=корень прогона,
    # боевыми CLAUDE_* ручками драйвер и мок-$ не достигаются вовсе.
    env = {"PATH": os.environ.get("PATH", ""), "HOME": root}
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        raise InstrumentBroken("драйвер не ответил за %d c" % timeout)
    if r.returncode != 0:
        raise InstrumentBroken("драйвер упал rc=%d: %s" % (r.returncode, r.stderr[-400:]))
    lines = [ln for ln in r.stdout.splitlines() if ln.strip()]
    if not lines:
        raise InstrumentBroken("драйвер не напечатал конверт (stdout пуст), stderr: %s" % r.stderr[-400:])
    try:
        return json.loads(lines[-1])
    except ValueError:
        raise InstrumentBroken("конверт не разобран как JSON: %s" % lines[-1][:200])


# --- CLI ----------------------------------------------------------------------

def cli_refuse(msg: str) -> int:
    print("ПРИБОР НЕДОСТУПЕН: %s" % msg, file=sys.stderr)
    return 2


def cmd_capture(a) -> int:
    node = shutil.which("node")
    if not node:
        return cli_refuse("нет node: снятие TS-мода несёт --experimental-strip-types")
    if not os.path.isfile(a.mod):
        return cli_refuse("мода нет: %s" % a.mod)
    d = tempfile.mkdtemp(prefix="render-tree-capture-")
    try:
        driver = write_driver(d)
        env = run_capture(node, driver, os.path.abspath(a.mod), a.event,
                          os.path.abspath(a.root), a.clock_base, a.payload)
    except InstrumentBroken as x:
        return cli_refuse(str(x))
    finally:
        shutil.rmtree(d, ignore_errors=True)
    print(json.dumps(env, ensure_ascii=False, indent=1))
    return 0


def cmd_canon(a) -> int:
    try:
        with open(a.envelope, "r", encoding="utf-8") as f:
            env = json.load(f)
    except (OSError, ValueError) as x:
        return cli_refuse("конверт не прочитан: %s" % x)
    c = canon_of_envelope(env)
    if c is None:
        print("КРАСЕН canon: формы нет -- статус конверта %s (%s): обе формы пусты или мод не дошёл до рендера"
              % (env.get("status"), env.get("form", env.get("error", "причины не названо"))))
        return 1
    print(json.dumps(c, ensure_ascii=False, sort_keys=True, indent=1))
    return 0


def cmd_compare(a) -> int:
    try:
        with open(a.expected, "r", encoding="utf-8") as f:
            exp = json.load(f)
        with open(a.captured, "r", encoding="utf-8") as f:
            got = json.load(f)
    except (OSError, ValueError) as x:
        return cli_refuse("канонические формы не прочитаны: %s" % x)
    diffs = compare(exp, got)
    if not diffs:
        print("сравнение: расхождений 0")
        return 0
    for d in diffs:
        print(d)
    print("расхождений %d" % len(diffs))
    return 1


# --- самопроверка: зубы на синтетических модах --------------------------------
# CONSTRAINT: прибор не пинит ни имён поверхностей, ни имён событий предмета --
# событие в батарее («status.render») выбрано произвольно нарочно; боевой
# прогон задаёт своё имя ручкой capture --event. То же для текста строки:
# перехват $.ui.status не зависит от того, ЧТО мод пишет.

CHAIN_PRELUDE = """export function register(on: any) {
  const chain = (): any => { const r: any = { catch: (_h: any) => r }; return r }
"""

MOD_SOURCES = {
    "mod_ok.ts": """// Синтетический предмет зуба 1: метка @@TOKEN@@ доказывает, что снятое
// дерево приехало из МОДА, а не порождено прибором. Строку этот мод НЕ пишет.
export function register(on: any) {
  const chain = (): any => { const r: any = { catch: (_h: any) => r }; return r }
  on("status.other", async () => ({ side: true }))
  on("status.render", async ($: any, _e: any, _next: any) => {
    const at = await $.clock.now()
    return {
      marker: "@@TOKEN@@",
      surface: "wide",
      items: [
        { kind: "label", text: "  branch:   main  " },
        { kind: "time", at, dt: 42, pct: "37.5%", home: "/private/tmp/xyz", toks: 1234 },
        { kind: "blank", text: "" },
      ],
      repeat: ["x", "x"],
    }
  }).catch(chain())
}
""",
    "mod_null.ts": """export function register(on: any) {
  on("status.render", async () => null)
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
    "mod_emptystr.ts": """export function register(on: any) {
  on("status.render", async () => "")
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
    "mod_threw.ts": """export function register(on: any) {
  on("status.render", async () => {
    throw new Error("рендер уронен намеренно")
  })
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
    "mod_unloadable.ts": """// Синтаксическая ошибка нарочно: мод не компилируется вовсе.
export function register(on: any {
""",
    "mod_noregister.ts": """// Мод компилируется, но register не экспортирует.
export const helper = 1
""",
    "mod_onlyother.ts": """export function register(on: any) {
  on("status.other", async () => ({ side: true }))
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
    "mod_ambiguous.ts": """export function register(on: any) {
  on("status.render", async () => ({ dup: 1 }))
  on("status.render", async () => ({ dup: 2 }))
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
    "mod_escape.ts": """// Проба гварда корня: запись за границей прогона обязана быть отказана поимённо.
export function register(on: any) {
  on("status.render", async ($: any) => {
    await $.fs.write("/etc/render-tree-escape-probe", "x")
    return { done: 1 }
  })
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
    "mod_flat.ts": """export function register(on: any) {
  on("status.render", async () => ({ only: "один" }))
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
    "mod_scalar.ts": """export function register(on: any) {
  on("status.render", async () => "один")
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
    "mod_status_set.ts": """// Обе поверхности: строка статуса с подвижными токенами И возвращённое дерево.
export function register(on: any) {
  on("status.render", async ($: any) => {
    const at = await $.clock.now()
    await $.ui.status("готово " + at + " 12:34 37.5% /tmp/x 5ms")
    return { kind: "tree", at }
  })
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
    "mod_status_clear.ts": """// Очистка строки: undefined -- СОБЫТИЕ, отличимое от «не звал».
export function register(on: any) {
  on("status.render", async ($: any) => {
    await $.ui.status(undefined)
    return { cleared: 1 }
  })
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
    "mod_status_only_empty.ts": """// Несущий случай поправки: строка написана, возврат пуст -- это НЕ «пусто».
export function register(on: any) {
  on("status.render", async ($: any) => {
    await $.ui.status("строка живёт, дерева нет")
    return null
  })
  const r: any = { catch: (_h: any) => r }
  return r
}
""",
}

# Ровно столько «ок»-захватов planned в батарее (зуб 8: зелёный без дерева
# невозможен). Пересчитать ВМЕСТЕ с добавлением захватов.
EXPECTED_CAPTURES = 8
EXPECTED_TEETH_N = 13


def cmd_self_check(_a) -> int:
    node = shutil.which("node")
    if not node:
        print("ПРИБОР НЕДОСТУПЕН: нет node (снятие TS-мода несёт --experimental-strip-types)",
              file=sys.stderr)
        return 2
    teeth = []       # (имя, зелёный, деталь)
    cases = []       # (имя, зелёный, деталь)

    def tooth(name, ok, detail=""):
        teeth.append((name, bool(ok), detail))

    def case(name, ok, detail=""):
        cases.append((name, bool(ok), detail))

    batt = os.path.realpath(tempfile.mkdtemp(prefix="render-tree-batt-"))
    captured_ok = 0
    try:
        driver = write_driver(batt)
        token = "MARK-" + secrets.token_hex(8)
        mods = {}
        for fname, src in MOD_SOURCES.items():
            p = os.path.join(batt, fname)
            with open(p, "w", encoding="utf-8") as f:
                f.write(src.replace("@@TOKEN@@", token))
            mods[fname] = p

        def ok_capture(mod_name, base=1750000000000):
            nonlocal captured_ok
            env = run_capture(node, driver, mods[mod_name], "status.render", batt, base)
            if env.get("status") == "ok":
                captured_ok += 1
            return env

        def ok_canon(env):
            c = canon_of_envelope(env)
            return c, json.dumps(c, ensure_ascii=False, sort_keys=True)

        # --- зуб 1: мод вернул дерево -> снято; происхождение доказано меткой
        r1 = ok_capture("mod_ok.ts")
        c1, s1 = ok_canon(r1)
        c1t = (c1 or {}).get("tree")
        t1_details = []
        t1_ok = r1.get("status") == "ok" and isinstance(c1t, dict)
        if not t1_ok:
            t1_details.append("статус %s (%s)" % (r1.get("status"), r1.get("error", "")))
        else:
            if token not in s1:
                t1_ok = False
                t1_details.append("метки мода %s в снятом нет" % token)
            if "clock.now" not in r1.get("callsLog", []):
                t1_ok = False
                t1_details.append("$.clock.now в следе прогона нет")
            for lbl in (LBL_PCT, LBL_PATH, LBL_TOKENS, LBL_TIME_NAME, LBL_TIME_EPOCH_MS):
                if lbl not in s1:
                    t1_ok = False
                    t1_details.append("метки рода %s в каноне нет" % lbl)
            if "branch: main" not in s1 or "branch:   main" in s1:
                t1_ok = False
                t1_details.append("пробелы не нормализованы")
            items = c1t.get("items") or []
            if c1t.get("repeat") != ["x", "x"]:
                t1_ok = False
                t1_details.append("повторяющиеся элементы потеряны: %s" % short(c1t.get("repeat")))
            if len(items) < 3 or items[2].get("text") != "":
                t1_ok = False
                t1_details.append("элемент без текста потерян")
        tooth("capture-tree", t1_ok, "; ".join(t1_details))

        # --- случай изоляции: прогон шёл в корне батареи, env-дом там же
        iso_ok = r1.get("root") == batt and r1.get("envHome") == batt
        case("изоляция: корень и env-дом внутри прогона", iso_ok,
             "root=%s envHome=%s" % (r1.get("root"), r1.get("envHome")))

        # --- зуб 6: подвижная величина изменилась -> канон НЕ краснеет (обе формы)
        r2 = ok_capture("mod_ok.ts", 1750000000123)
        c2, s2 = ok_canon(r2)
        moved_tree = (r1.get("status") == "ok" and r2.get("status") == "ok"
                      and r1["tree"]["items"][1]["at"] != r2["tree"]["items"][1]["at"])
        same_tree = (c1 is not None and c2 is not None
                     and json.dumps(c1, sort_keys=True) == json.dumps(c2, sort_keys=True))
        r_set1 = ok_capture("mod_status_set.ts", 1750000000000)
        r_set2 = ok_capture("mod_status_set.ts", 1750000000456)
        cs1, ss1 = ok_canon(r_set1)
        cs2, _ss2 = ok_canon(r_set2)
        moved_text = (r_set1.get("status") == "ok" and r_set2.get("status") == "ok"
                      and r_set1["uiStatus"]["calls"][0]["text"]
                      != r_set2["uiStatus"]["calls"][0]["text"])
        same_string = (cs1 is not None and cs2 is not None
                       and cs1.get("string") == cs2.get("string"))
        tooth("moving-green",
              moved_tree and same_tree and moved_text and same_string,
              "дерево: движение %s, канон %s; строка: движение %s, канон %s"
              % (moved_tree, same_tree, moved_text, same_string))

        # --- зуб 2: мод вернул ПУСТО (обе формы) -> названо «пусто», не «упал»
        rn = run_capture(node, driver, mods["mod_null.ts"], "status.render", batt, 1750000000000)
        rs = run_capture(node, driver, mods["mod_emptystr.ts"], "status.render", batt, 1750000000000)
        tooth("empty-named",
              rn.get("status") == "empty" and rn.get("form") == "null"
              and rs.get("status") == "empty" and rs.get("form") == "пустая строка",
              "null: %s/%s, строка: %s/%s" % (rn.get("status"), rn.get("form"),
                                              rs.get("status"), rs.get("form")))

        # --- зуб 3: мод БРОСИЛ -> названо «упал», отлично от «пусто» и «незагрузка»
        rt = run_capture(node, driver, mods["mod_threw.ts"], "status.render", batt, 1750000000000)
        tooth("threw-named",
              rt.get("status") == "threw" and "уронен" in str(rt.get("error", ""))
              and rt.get("status") != rn.get("status") and rt.get("status") != "unloadable",
              "статус %s, отказ: %s" % (rt.get("status"), str(rt.get("error"))[:120]))

        # --- зуб 4: мод не загрузился вовсе -> отлично от обоих предыдущих
        ru1 = run_capture(node, driver, mods["mod_unloadable.ts"], "status.render", batt, 1750000000000)
        ru2 = run_capture(node, driver, mods["mod_noregister.ts"], "status.render", batt, 1750000000000)
        tooth("unloadable-named",
              ru1.get("status") == "unloadable" and ru1.get("stage") == "import"
              and ru2.get("status") == "unloadable" and ru2.get("stage") == "register"
              and ru1.get("status") != rn.get("status") and ru1.get("status") != rt.get("status"),
              "синтаксис: %s/%s, без register: %s/%s"
              % (ru1.get("status"), ru1.get("stage"), ru2.get("status"), ru2.get("stage")))

        # --- зуб 5: элемент пропал из дерева -> краснеет и называет пропавшего
        # (направление: ожидаем ПОЛНОЕ дерево, снятое -- без хвостового элемента)
        if isinstance(c1t, dict):
            cap_miss = copy.deepcopy(c1t)
            del cap_miss["items"][2]
            d_miss = compare(c1t, cap_miss)
            tooth("missing-named",
                  any(x.startswith("ПРОПАЛ $.items[2]") for x in d_miss)
                  and not any(x.startswith("ЛИШНИЙ") for x in d_miss),
                  "; ".join(d_miss[:3]))

        # --- зуб 7: форма изменилась при той же подвижной величине -> ФОРМА
        if isinstance(c1t, dict):
            exp_shape = copy.deepcopy(c1t)
            exp_shape["items"][0]["text"] = {"v": 1}
            d_shape = compare(exp_shape, c1t)
            tooth("shape-named",
                  any(x.startswith("ФОРМА $.items[0].text") for x in d_shape),
                  "; ".join(d_shape[:2]))

        # --- зуб 9: $.ui.status("текст") -> снято строкой с этим текстом
        cset1 = cs1 or {}
        str_slot = cset1.get("string") or []
        s9_ok = (r_set1.get("status") == "ok"
                 and len(str_slot) == 1
                 and "готово" in json.dumps(str_slot, ensure_ascii=False))
        for lbl in (LBL_TIME_EPOCH_MS, LBL_TIME_CLOCK, LBL_PCT, LBL_PATH, LBL_DURATION):
            if lbl not in json.dumps(str_slot, ensure_ascii=False):
                s9_ok = False
        tooth("string-captured", s9_ok,
              "канон строки: %s" % short(str_slot))

        # --- зуб 10: $.ui.status(undefined) -> снято ОЧИСТКОЙ, отличимой от записи
        # Запись и очистка -- оба словари, расхождение именуется на уровне
        # ключей: ПРОПАЛ текста + ЛИШНИЙ очистки.
        r_clear = ok_capture("mod_status_clear.ts")
        cclr, _ = ok_canon(r_clear)
        clr_slot = (cclr or {}).get("string") or []
        d_clr = compare({"string": str_slot}, {"string": clr_slot})
        tooth("string-clear-named",
              clr_slot == [{"очистка": True}]
              and any(x.startswith("ПРОПАЛ $.string[0].текст") for x in d_clr)
              and any(x.startswith("ЛИШНИЙ $.string[0].очистка") for x in d_clr),
              "канон очистки: %s; расхождения против записи: %s"
              % (short(clr_slot), "; ".join(d_clr[:2])))

        # --- зуб 11: $.ui.status не звали вовсе -> слота «string» нет, и это
        # отлично от очистки: сравнение называет ПРОПАЛ $.string
        t11_ok = c1 is not None and "string" not in c1
        d_abs = compare({"string": str_slot}, (c1 or {}))
        t11_ok = t11_ok and any(x.startswith("ПРОПАЛ $.string") for x in d_abs)
        tooth("string-untouched-named", t11_ok,
              "канон без строки: %s; %s" % ("string" in (c1 or {}), "; ".join(d_abs[:2])))

        # --- зуб 12: строка И дерево в одном захвате -- ни одна форма не потеряна
        tooth("both-forms",
              r_set1.get("status") == "ok"
              and "tree" in cset1 and "string" in cset1
              and (cset1.get("tree") or {}).get("kind") == "tree",
              "слоты канона: %s" % sorted(cset1.keys()))

        # --- зуб 13 (несущий): строка написана, возврат пуст -- НЕ «пусто»
        r13 = ok_capture("mod_status_only_empty.ts")
        c13, _ = ok_canon(r13)
        tooth("status-only-string",
              r13.get("status") == "ok"
              and isinstance(c13, dict) and "string" in c13 and "tree" not in c13
              and "строка живёт" in json.dumps(c13.get("string"), ensure_ascii=False),
              "статус %s, канон: %s" % (r13.get("status"), short(c13)))

        # --- случаи именованных отказов сравнения
        if isinstance(c1t, dict):
            exp_val = copy.deepcopy(c1t)
            exp_val["surface"] = "wide2"
            d_val = compare(exp_val, c1t)
            case("ЗНАЧЕНИЕ: стабильная величина дрейфует красным",
                 any(x.startswith("ЗНАЧЕНИЕ $.surface") for x in d_val),
                 "; ".join(d_val[:2]))
            got_extra = copy.deepcopy(c1t)
            got_extra["extra"] = 1
            d_extra = compare(c1t, got_extra)
            case("ЛИШНИЙ: лишний элемент назван",
                 any(x.startswith("ЛИШНИЙ $.extra") for x in d_extra),
                 "; ".join(d_extra[:2]))
            # Направление: ожидаем полное, снятое -- с удалённой серединой.
            # Списки сравниваются ПО ИНДЕКСУ: середина даёт каскад (ключи
            # элемента расходятся), а хвост уезжает в ПРОПАЛ -- объявленное
            # поведение, названное в шапке прибора.
            cap_mid = copy.deepcopy(c1t)
            del cap_mid["items"][1]
            d_mid = compare(c1t, cap_mid)
            case("список: удаление из середины -- объявленный каскад по индексам",
                 any(x.startswith("ПРОПАЛ $.items[2]") for x in d_mid)
                 and any("$.items[1]" in x for x in d_mid),
                 "; ".join(d_mid[:3]))

        # --- именованные состояния без дерева
        rns = run_capture(node, driver, mods["mod_onlyother.ts"], "status.render", batt, 1750000000000)
        case("нет подписки: названо с перечнем подписок мода",
             rns.get("status") == "no-subscription" and "status.other" in rns.get("events", []),
             "статус %s, события %s" % (rns.get("status"), rns.get("events")))
        ramb = run_capture(node, driver, mods["mod_ambiguous.ts"], "status.render", batt, 1750000000000)
        case("двусмысленность: два обработчика одного события названы",
             ramb.get("status") == "ambiguous" and ramb.get("n") == 2,
             "статус %s, n=%s" % (ramb.get("status"), ramb.get("n")))

        # --- гвард корня: попытка записи вне прогона отказана поимённо
        resc = run_capture(node, driver, mods["mod_escape.ts"], "status.render", batt, 1750000000000)
        case("fs-гвард: запись вне корня отказана поимённо",
             resc.get("status") == "threw" and "fs-guard" in str(resc.get("error", "")),
             "статус %s, отказ: %s" % (resc.get("status"), str(resc.get("error"))[:120]))

        # --- край: глубина один элемент -- объект с одним листом и скалярный корень
        r_flat = ok_capture("mod_flat.ts")
        r_scalar = ok_capture("mod_scalar.ts")
        c_flat, _ = ok_canon(r_flat)
        c_scalar, _ = ok_canon(r_scalar)
        case("край: дерево глубиной один элемент (объект и скаляр)",
             (c_flat or {}).get("tree") == {"only": "один"}
             and (c_scalar or {}).get("tree") == "один"
             and r_flat.get("status") == "ok" and r_scalar.get("status") == "ok",
             "объект: %s, скаляр: %s" % (short((c_flat or {}).get("tree")),
                                         short((c_scalar or {}).get("tree"))))

        # --- зуб 8: вакуумная зелень невозможна -- зелёный прогон обязан нести
        # снятые формы. Проверяется ПОСЛЕДНИМ: знаменатель -- ВСЕ захваты
        # батареи, а не только те, что шли до середины.
        tooth("vacuum-guard", captured_ok == EXPECTED_CAPTURES,
              "снятых захватов %d, объявлено %d" % (captured_ok, EXPECTED_CAPTURES))
    except InstrumentBroken as x:
        print("ПРИБОР НЕДОСТУПЕН: %s" % x, file=sys.stderr)
        return 2
    except Exception as x:  # рухнувшая батарея -- негодность прибора, не краснота дерева
        print("ПРИБОР НЕДОСТУПЕН: батарея рухнула: %r" % (x,), file=sys.stderr)
        return 2
    finally:
        shutil.rmtree(batt, ignore_errors=True)

    for i, (name, ok, detail) in enumerate(teeth, 1):
        print("зуб %d %s: %s%s" % (i, name, "зелёный" if ok else "ПРОВАЛ",
                                   (" — " + detail) if (detail and not ok) else ""))
    for i, (name, ok, detail) in enumerate(cases, 1):
        print("случай %d %s: %s%s" % (i, name, "зелёный" if ok else "ПРОВАЛ",
                                      (" — " + detail) if (detail and not ok) else ""))
    n_teeth_green = sum(1 for _, ok, _ in teeth if ok)
    n_cases_green = sum(1 for _, ok, _ in cases if ok)
    print("зубов %d" % n_teeth_green)
    print("случаев %d, зелёных %d" % (len(cases), n_cases_green))
    if len(teeth) != EXPECTED_TEETH_N:
        print("ПРИБОР НЕДОСТУПЕН: зубов в батарее %d, а набор обязан нести %d"
              % (len(teeth), EXPECTED_TEETH_N), file=sys.stderr)
        return 2
    if n_teeth_green != len(teeth) or n_cases_green != len(cases):
        return 1
    return 0


def main(argv) -> int:
    # --self-check перехватывается ДО argparse: argparse не признаёт подкоманду
    # с ведущим дефисом, а форма флага семьи (--self-check) сохраняется.
    if argv == ["--self-check"]:
        return cmd_self_check(None)
    p = argparse.ArgumentParser(prog="render-tree.py", add_help=True)
    sub = p.add_subparsers(dest="cmd")

    pc = sub.add_parser("capture")
    pc.add_argument("--mod", required=True)
    pc.add_argument("--event", required=True)
    pc.add_argument("--root", required=True)
    pc.add_argument("--clock-base", type=int, default=1750000000000)
    pc.add_argument("--payload", default="")
    pc.set_defaults(fn=cmd_capture)

    pn = sub.add_parser("canon")
    pn.add_argument("--envelope", required=True)
    pn.set_defaults(fn=cmd_canon)

    pm = sub.add_parser("compare")
    pm.add_argument("--expected", required=True)
    pm.add_argument("--captured", required=True)
    pm.set_defaults(fn=cmd_compare)

    a = p.parse_args(argv)
    if not getattr(a, "fn", None):
        p.print_usage(sys.stderr)
        return 2
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
