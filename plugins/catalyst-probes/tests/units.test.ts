// Unit teeth for plugins/catalyst-probes/hooks/register.ts, run outside the
// image: `node --test --experimental-strip-types` (wrapper
// tests/scripts/test-mod-units.sh).
// CONSTRAINT: expected values are pinned FROM THE CODE (register.ts @ HEAD),
// not from what the format "should" be. A pin that looks wrong is a report
// finding, never a test edit. The rx vocabularies below are copied from
// profileOf (register.ts:361-399): judge register.ts:367, idle-watch :377,
// generic :393, form :386 ("" -- parseVerdict falls back at :235).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  bl3, num, clip, classesOf, normTmp, resolvePath,
  parseVal, parseToml, rungsOf, rungCtx, parseVerdict,
  verdictKey, memoUsable, effortOk, EFFORTS, markEffort,
  MOD_VERSION,
} from "../hooks/register.ts"

const RX_JUDGE = "OK|WARN|BLOCK|STOP|DENY"
const RX_IDLE = "SILENT|NUDGE"
const RX_GENERIC = "OK|WARN|BLOCK|SILENT|NUDGE"

// --- bl3: тройная логика флага ----------------------------------------------

test("bl3: undefined/null отдают умолчание", () => {
  assert.equal(bl3(undefined, true), true)
  assert.equal(bl3(undefined, false), false)
  assert.equal(bl3(null, true), true)
  assert.equal(bl3(null, false), false)
})

test("bl3: false и 0 -- всегда false", () => {
  assert.equal(bl3(false, true), false)
  assert.equal(bl3(0, true), false)
})

test("bl3: строковые выключатели", () => {
  assert.equal(bl3("", true), false)
  assert.equal(bl3("0", true), false)
  assert.equal(bl3("false", true), false)
  assert.equal(bl3("off", true), false)
  assert.equal(bl3("no", true), false)
  assert.equal(bl3(" no ", true), false)
})

test("bl3: TRUE и произвольная строка -- true", () => {
  assert.equal(bl3("TRUE", false), true)
  assert.equal(bl3("arbitrary", false), true)
  assert.equal(bl3(1, false), true)
})

// --- num: пол значения --------------------------------------------------------

test("num: число и строка-число проходят", () => {
  assert.equal(num(5, 9, 1), 5)
  assert.equal(num("42", 9, 1), 42)
})

test("num: нечисло, undefined, null -- fallback", () => {
  assert.equal(num("abc", 9, 1), 9)
  assert.equal(num(undefined, 9, 1), 9)
  assert.equal(num(null, 9, 1), 9)
})

test("num: ниже пола -- fallback; ровно пол -- проходит", () => {
  assert.equal(num(0, 9, 1), 9)
  assert.equal(num(1, 9, 1), 1)
})

test("num: parseInt ест числовой префикс; готовое число дробью не режется", () => {
  assert.equal(num("12px", 9, 1), 12)
  assert.equal(num(2.7, 9, 1), 2.7)
})

// --- clip: обрезка ------------------------------------------------------------

test("clip: короче и ровно потолок -- без изменений", () => {
  assert.equal(clip("abc", 5), "abc")
  assert.equal(clip("abcde", 5), "abcde")
})

test("clip: длиннее -- обрезан до потолка", () => {
  assert.equal(clip("abcdef", 5), "abcde")
})

test("clip: undefined на входе -- пустая строка", () => {
  assert.equal(clip(undefined as unknown as string, 5), "")
})

// --- parseVal: разбор значения TOML -------------------------------------------

test("parseVal: решётка ВНУТРИ кавычек не комментарий", () => {
  assert.equal(parseVal('"текст # не комментарий"'), "текст # не комментарий")
  assert.equal(parseVal("'a # b'"), "a # b")
})

test("parseVal: комментарий после голого значения отрезан", () => {
  assert.equal(parseVal("значение # комментарий"), "значение")
})

test("parseVal: комментарий после ЗАКРЫВАЮЩЕЙ кавычки отрезан", () => {
  assert.equal(parseVal('"a" # c'), "a")
})

test("parseVal: массив строк", () => {
  assert.deepEqual(parseVal('["a", "b"]'), ["a", "b"])
})

test("parseVal: числа и дробь", () => {
  assert.equal(parseVal("42"), 42)
  assert.equal(parseVal("-7"), -7)
  assert.equal(parseVal("4.5"), 4.5)
})

test("parseVal: булевы литералы", () => {
  assert.equal(parseVal("true"), true)
  assert.equal(parseVal("false"), false)
})

test("parseVal: тройные кавычки", () => {
  assert.equal(parseVal("'''abc'''"), "abc")
  assert.equal(parseVal('"""x"""'), "x")
})

test("parseVal: одинарные кавычки без эскейпов", () => {
  assert.equal(parseVal("'text'"), "text")
})

test("parseVal: голая строка возвращается как есть", () => {
  assert.equal(parseVal("голая строка"), "голая строка")
})

test("parseVal: двойные кавычки разворачивают \\n и \\\"", () => {
  assert.equal(parseVal('"a\\nb"'), "a\nb")
  assert.equal(parseVal('"a\\"b"'), 'a"b')
})

test("parseVal: массив из чисел -- числа остаются числами", () => {
  assert.deepEqual(parseVal("[1, 2]"), [1, 2])
})

test("parseVal: массив в одинарных кавычках", () => {
  assert.deepEqual(parseVal("['a', 'b']"), ["a", "b"])
})

test("parseVal: массив булевых литералов", () => {
  assert.deepEqual(parseVal("[true, false]"), [true, false])
})

test("parseVal: пустые массивы -- [] и [ ]", () => {
  assert.deepEqual(parseVal("[]"), [])
  assert.deepEqual(parseVal("[ ]"), [])
})

test("parseVal: хвостовая запятая не плодит элемент", () => {
  assert.deepEqual(parseVal('["a",]'), ["a"])
})

test("parseVal: запятая ВНУТРИ кавычек не делит", () => {
  assert.deepEqual(parseVal('["a, b", "c"]'), ["a, b", "c"])
})

test("parseVal: вложенные массивы не рушат верхний уровень", () => {
  assert.deepEqual(parseVal('[["a"], ["b"]]'), [["a"], ["b"]])
})

// --- parseVal: inline-таблицы (ступень одной строкой) --------------------------

// CONSTRAINT: контроль -- запятая ВНУТРИ таблицы. Пока глубина считала только
// квадратные скобки, этот вход давал четыре куска-строки вместо двух таблиц, и
// в модель ступени уезжало `{ model = "a"`.
test("parseVal: массив inline-таблиц -- запятая внутри {} не делит", () => {
  assert.deepEqual(
    parseVal('[{ model = "a", effort = "max" }, { model = "b", effort = "high" }]'),
    [{ model: "a", effort: "max" }, { model: "b", effort: "high" }])
})

test("parseVal: одиночная inline-таблица со всеми типами значений", () => {
  assert.deepEqual(
    parseVal('{ model = "m", max_tokens = 8000, fail_closed = true, tags = ["a", "b"] }'),
    { model: "m", max_tokens: 8000, fail_closed: true, tags: ["a", "b"] })
})

test("parseVal: пустая inline-таблица", () => {
  assert.deepEqual(parseVal("{}"), {})
  assert.deepEqual(parseVal("{ }"), {})
})

test("parseVal: вложенная inline-таблица", () => {
  assert.deepEqual(parseVal('{ a = { b = "c" }, d = 1 }'), { a: { b: "c" }, d: 1 })
})

test("parseVal: запятая внутри кавычек внутри таблицы не делит", () => {
  assert.deepEqual(parseVal('{ note = "a, b", model = "m" }'), { note: "a, b", model: "m" })
})

// CONSTRAINT: пара без `=` не имеет права ни ронять разбор, ни исчезать --
// годные пары остаются, негодная уходит в __unread.
test("parseVal: пара без знака равенства -- в __unread, соседи целы", () => {
  assert.deepEqual(parseVal('{ model = "m", мусор }'), { model: "m", __unread: ["мусор"] })
})

// --- parseToml ----------------------------------------------------------------

test("parseToml: вложенная секция", () => {
  assert.deepEqual(parseToml("[a.b]\nx = 1\n"), { a: { b: { x: 1 } } })
})

test("parseToml: массив секций дважды -- ДВА элемента по порядку", () => {
  const t = parseToml(
    "[[probe.judge.models]]\nmodel = \"m1\"\n" +
    "[[probe.judge.models]]\nmodel = \"m2\"\n")
  assert.ok(Array.isArray(t.probe.judge.models))
  assert.equal(t.probe.judge.models.length, 2)
  assert.equal(t.probe.judge.models[0].model, "m1")
  assert.equal(t.probe.judge.models[1].model, "m2")
})

test("parseToml: ключ с подчёркиванием", () => {
  assert.deepEqual(parseToml("[s]\nmax_tokens = 5\n"), { s: { max_tokens: 5 } })
})

test("parseToml: строка-комментарий и пустая строка пропущены", () => {
  assert.deepEqual(parseToml("# комментарий\n\n[s]\nx = 1\n"), { s: { x: 1 } })
})

test("parseToml: повтор секции НЕ затирает ранее прочитанные ключи", () => {
  assert.deepEqual(parseToml("[a]\nx = 1\n[a]\ny = 2\n"), { a: { x: 1, y: 2 } })
})

test("parseToml: ключ с дефисом", () => {
  assert.deepEqual(parseToml("[s]\nmy-key = 1\n"), { s: { "my-key": 1 } })
})

test("parseToml: ключ в двойных кавычках -- ОДИН ключ, точки внутри НЕ делят", () => {
  assert.deepEqual(parseToml('[s]\n"a.b" = 1\n'), { s: { "a.b": 1 } })
})

test("parseToml: ключ в одинарных кавычках", () => {
  assert.deepEqual(parseToml("[s]\n'a.b' = 1\n"), { s: { "a.b": 1 } })
})

test("parseToml: голый точечный ключ -- путь", () => {
  assert.deepEqual(parseToml("[s]\na.b = 1\n"), { s: { a: { b: 1 } } })
})

test("parseToml: мусорная строка попадает в __unread", () => {
  const t = parseToml("[s]\nx = 1\nэто мусор\n")
  assert.deepEqual(t.__unread, ["это мусор"])
})

test("parseToml: чистый конфиг НЕ заводит __unread", () => {
  const t = parseToml("[s]\nx = 1\n")
  assert.ok(!("__unread" in t))
  assert.ok(!("__unreadN" in t))
})

test("parseToml: __unreadN считает ВСЕ строки, __unread хранит первые 20", () => {
  const junk = Array.from({ length: 25 }, (_, i) => "мусор " + (i + 1)).join("\n")
  const t = parseToml(junk + "\n")
  assert.equal(t.__unreadN, 25)
  assert.equal(t.__unread.length, 20)
})

// CONSTRAINT: непрочитанная пара ВНУТРИ inline-таблицы обязана попасть в тот же
// счётчик, что и непрочитанная строка файла -- cfgUnread собирается из
// __unreadN КОРНЯ, и отдельный счётчик у вложенной формы был бы невидим.
test("parseToml: непрочитанная пара inline-таблицы уходит в корневой __unreadN", () => {
  const t = parseToml('[s]\nmodels = [{ model = "m", мусор }]\n')
  assert.equal(t.__unreadN, 1)
  assert.deepEqual(t.__unread, ["мусор"])
  assert.deepEqual(t.s.models, [{ model: "m" }])
})

test("parseToml: строка и вложенная пара считаются ОДНИМ счётчиком", () => {
  const t = parseToml('[s]\nсвоя мусорная строка\nmodels = [{ model = "m", мусор }]\n')
  assert.equal(t.__unreadN, 2)
})

// CONSTRAINT: служебная отметка не имеет права уехать в конфиг ступени --
// иначе мусорная пара стала бы полем разобранной модели.
test("parseToml: __unread снят с узла ступени", () => {
  const t = parseToml('[s]\nmodels = [{ model = "m", мусор }]\n')
  assert.equal("__unread" in t.s.models[0], false)
})

test("parseToml: ступени inline-формой разбираются как array-of-tables", () => {
  const inline = parseToml('[probe.judge]\nmodels = [{ model = "a", effort = "max" }, { model = "b", effort = "high" }]\n')
  const aot = parseToml([
    "[probe.judge]",
    "[[probe.judge.models]]",
    'model = "a"',
    'effort = "max"',
    "[[probe.judge.models]]",
    'model = "b"',
    'effort = "high"',
  ].join("\n"))
  assert.deepEqual(inline.probe.judge.models, aot.probe.judge.models)
  assert.deepEqual(rungsOf(inline.probe.judge, ""), rungsOf(aot.probe.judge, ""))
})

// --- rungsOf: лестница ступеней ------------------------------------------------

test("rungsOf: три модели -- три ступени по порядку", () => {
  assert.deepEqual(
    rungsOf({ models: ["a", "b", "c"] }, ""),
    [{ model: "a" }, { model: "b" }, { model: "c" }])
})

test("rungsOf: пустой конфиг -- встроенная последняя ступень glm-5.3", () => {
  assert.deepEqual(rungsOf({}, ""), [{ model: "glm-5.3" }])
  assert.deepEqual(rungsOf(null, ""), [{ model: "glm-5.3" }])
})

test("rungsOf: непустой modelEnv замораживает лестницу в ОДНУ ступень", () => {
  assert.deepEqual(
    rungsOf({ models: ["a", "b"] }, "env-model"),
    [{ model: "env-model" }])
  assert.deepEqual(rungsOf({ model: "x" }, "env-model"), [{ model: "env-model" }])
})

test("rungsOf: modelEnv наследует effort и лимиты ПЕРВОЙ ступени конфига", () => {
  assert.deepEqual(
    rungsOf({ models: [
      { model: "a", effort: "high", max_tokens: 100, timeout_ms: 2000, context_chars: 1000 },
      { model: "b", max_tokens: 500 },
    ] }, "env-model"),
    [{ model: "env-model", effort: "high", max_tokens: 100, timeout_ms: 2000, context_chars: 1000 }])
})

test("rungsOf: modelEnv при пустом конфиге -- ровно [{ model: modelEnv }]", () => {
  assert.deepEqual(rungsOf({}, "env-model"), [{ model: "env-model" }])
  assert.deepEqual(rungsOf(null, "env-model"), [{ model: "env-model" }])
})

test("rungsOf: объектная ступень несёт effort и лимиты", () => {
  assert.deepEqual(
    rungsOf({ models: [{ model: "m", effort: "high", max_tokens: 100, timeout_ms: 2000, context_chars: 1000 }] }, ""),
    [{ model: "m", effort: "high", max_tokens: 100, timeout_ms: 2000, context_chars: 1000 }])
})

test("rungsOf: одиночный cfg.model без models -- одна ступень", () => {
  assert.deepEqual(rungsOf({ model: "x" }, ""), [{ model: "x" }])
})

// --- effortOk / негодный эффорт ступени (#141) ---------------------------------

test("effortOk: ось канона целиком годна", () => {
  assert.deepEqual(EFFORTS, ["low", "medium", "high", "xhigh", "max"])
  for (const v of EFFORTS) assert.equal(effortOk(v), true)
})

// CONSTRAINT: регистр и пробел -- ЧАСТЬ значения: поле уезжает провайдеру
// дословно, поэтому послабление здесь вернуло бы ровно тот дефект, который
// правка закрывает.
test("effortOk: негодные формы -- false", () => {
  for (const v of ["High", "HIGH", "higj", "extra-high", " high", "high ", "", "ultra"])
    assert.equal(effortOk(v), false)
})

// CONSTRAINT: предикат сравнивает СТРОГО, поэтому не-строка отвергается без
// отдельной проверки типа; зуб пинит поведение, а не наличие проверки.
test("effortOk: не-строка -- false, даже если приводится к годному", () => {
  assert.equal(effortOk({ toString: () => "high" }), false)
  assert.equal(effortOk(["high"]), false)
  assert.equal(effortOk(3), false)
  assert.equal(effortOk(null), false)
  assert.equal(effortOk(undefined), false)
})

test("rungsOf: негодный эффорт НЕ уезжает, а называется effortBad", () => {
  assert.deepEqual(
    rungsOf({ models: [{ model: "m", effort: "higj", max_tokens: 100 }] }, ""),
    [{ model: "m", effortBad: "higj", max_tokens: 100 }])
  assert.deepEqual(
    rungsOf({ models: [{ model: "m", effort: "HIGH" }] }, ""),
    [{ model: "m", effortBad: "HIGH" }])
})

test("rungsOf: числовой эффорт -- негодный, а не приведённый к строке", () => {
  const r = rungsOf({ models: [{ model: "m", effort: 3 }] }, "")
  assert.equal(r[0].effort, undefined)
  assert.equal(r[0].effortBad, "3")
})

// CONSTRAINT: ручка модели наследует ПЕРВУЮ ступень целиком -- отметка о
// негодном эффорте обязана ехать вместе с ней, иначе замер через
// CLAUDE_JUDGE_MODEL терял бы диагноз конфига.
test("rungsOf: modelEnv наследует и отметку негодного эффорта", () => {
  assert.deepEqual(
    rungsOf({ models: [{ model: "a", effort: "ultra" }] }, "env-model"),
    [{ model: "env-model", effortBad: "ultra" }])
})

// CONSTRAINT: улика -- единственная дорога, по которой негодный эффорт
// становится видимым; без этих зубов снятие отметки было молчаливым.
test("markEffort: негодный эффорт попадает в улику полем по модели", () => {
  const rec: any = {}
  markEffort(rec, "glm-5.3", { model: "glm-5.3", effortBad: "higj" })
  assert.deepEqual(rec, { "effortBad_glm-5.3": "higj" })
})

test("markEffort: годная ступень улику не трогает", () => {
  const rec: any = { a: 1 }
  markEffort(rec, "m", { model: "m", effort: "max" })
  markEffort(rec, "m", null)
  assert.deepEqual(rec, { a: 1 })
})

test("markEffort: разные ступени -- разные поля", () => {
  const rec: any = {}
  markEffort(rec, "a", { effortBad: "x" })
  markEffort(rec, "b", { effortBad: "y" })
  assert.deepEqual(rec, { effortBad_a: "x", effortBad_b: "y" })
})

test("rungsOf: годный эффорт отметки не порождает", () => {
  const r = rungsOf({ models: [{ model: "m", effort: "xhigh" }] }, "")
  assert.equal(r[0].effort, "xhigh")
  assert.equal("effortBad" in (r[0] as any), false)
})

// CONSTRAINT: ось пинится литералом и зубом выше. Сверки с БОЕВЫМ
// ~/.claude/probes/probes.toml здесь нет намеренно: зуб, читающий файл вне
// дерева, мерит машину, а не код, и краснеет от чужой правки конфига.
test("rungsOf: разбор ступени с эффортом из TOML, конец в конец", () => {
  const cfg = parseToml([
    "[probe.judge]",
    'models = [{ model = "glm-5.3", effort = "max" }, { model = "m2", effort = "turbo" }]',
  ].join("\n"))
  const rungs = rungsOf((cfg as any).probe.judge, "")
  assert.equal(rungs.length, 2)
  assert.equal(rungs[0].effort, "max")
  assert.equal(rungs[1].effort, undefined)
  assert.equal(rungs[1].effortBad, "turbo")
})

// --- rungCtx: потолок контекста ступени ----------------------------------------

test("rungCtx: ступень со своим context_chars", () => {
  assert.equal(rungCtx({ context_chars: 1000 }, { context_chars: 500 }), 1000)
})

test("rungCtx: ступень без него -- уровень пробы", () => {
  assert.equal(rungCtx({}, { context_chars: 500 }), 500)
})

test("rungCtx: ни ступени, ни пробы -- 24000", () => {
  assert.equal(rungCtx({}, {}), 24000)
  assert.equal(rungCtx(null, null), 24000)
})

test("rungCtx: нечисло на ступени -- уровень пробы; нечисло у пробы -- 24000", () => {
  assert.equal(rungCtx({ context_chars: "abc" }, { context_chars: 700 }), 700)
  assert.equal(rungCtx({}, { context_chars: "abc" }), 24000)
})

// --- parseVerdict ---------------------------------------------------------------

test("parseVerdict: BLOCK/OK/WARN в начале первой строки", () => {
  assert.deepEqual(parseVerdict("BLOCK: причина", RX_JUDGE), { kind: "BLOCK", rest: "причина" })
  assert.deepEqual(parseVerdict("OK:", RX_JUDGE), { kind: "OK", rest: "" })
  assert.deepEqual(parseVerdict("WARN: w", RX_JUDGE), { kind: "WARN", rest: "w" })
})

test("parseVerdict: без вердикта и пустая строка -- null", () => {
  assert.equal(parseVerdict("просто текст", RX_JUDGE), null)
  assert.equal(parseVerdict("", RX_JUDGE), null)
})

test("parseVerdict: первая строка приоритетнее поздних строк", () => {
  assert.deepEqual(
    parseVerdict("OK: первая\nBLOCK: вторая", RX_JUDGE),
    { kind: "OK", rest: "первая" })
})

test("parseVerdict: вердикт не в начале первой строки, но в конце текста -- найден", () => {
  assert.deepEqual(
    parseVerdict("первая строка\nнет\nBLOCK: вторая", RX_JUDGE),
    { kind: "BLOCK", rest: "вторая" })
})

test("parseVerdict: вердикт в СЕРЕДИНЕ строки не считается", () => {
  assert.equal(parseVerdict("xx BLOCK: y", RX_JUDGE), null)
})

test("parseVerdict: словарь rx решает, что вердикт", () => {
  assert.deepEqual(parseVerdict("STOP: x", RX_JUDGE), { kind: "STOP", rest: "x" })
  assert.equal(parseVerdict("STOP: x", ""), null)
  assert.deepEqual(parseVerdict("NUDGE: n", RX_IDLE), { kind: "NUDGE", rest: "n" })
  assert.equal(parseVerdict("BLOCK: b", RX_IDLE), null)
  assert.deepEqual(parseVerdict("SILENT: s", RX_GENERIC), { kind: "SILENT", rest: "s" })
})

test("parseVerdict: пустой rx падает на встроенный словарь OK|WARN|BLOCK", () => {
  assert.deepEqual(parseVerdict("BLOCK: b", ""), { kind: "BLOCK", rest: "b" })
})

test("parseVerdict: пробелы в rest съедаются; пробелы в rx вырезаются", () => {
  assert.deepEqual(parseVerdict("BLOCK:   r", RX_JUDGE), { kind: "BLOCK", rest: "r" })
  assert.deepEqual(parseVerdict("BLOCK: x", "OK | BLOCK"), { kind: "BLOCK", rest: "x" })
})

// --- classesOf -------------------------------------------------------------------

test("classesOf: маркер извлечён; повтор не дублируется", () => {
  assert.deepEqual(classesOf("[dispatch-class:exec-0p] текст"), ["exec-0p"])
  assert.deepEqual(
    classesOf("[dispatch-class:a] x [dispatch-class:b] y [dispatch-class:a]"),
    ["a", "b"])
})

test("classesOf: без маркеров и пустой вход -- пустой список", () => {
  assert.deepEqual(classesOf(""), [])
  assert.deepEqual(classesOf("нет маркеров"), [])
  assert.deepEqual(classesOf(undefined as unknown as string), [])
})

// --- normTmp ---------------------------------------------------------------------

test("normTmp: /private/tmp свёрнут в /tmp", () => {
  assert.equal(normTmp("/private/tmp/x"), "/tmp/x")
  assert.equal(normTmp("/private/tmp"), "/tmp")
})

test("normTmp: чужой префикс и пустой вход не тронуты", () => {
  assert.equal(normTmp("/tmp/x"), "/tmp/x")
  assert.equal(normTmp("/private/tmporary"), "/private/tmporary")
  assert.equal(normTmp(""), "")
  assert.equal(normTmp(null as unknown as string), "")
})

// --- resolvePath -------------------------------------------------------------------

test("resolvePath: тильда, абсолютный и относительный путь", () => {
  assert.equal(resolvePath("~/d/f", "/H", "/C"), "/H/d/f")
  assert.equal(resolvePath("/abs", "/H", "/C"), "/abs")
  assert.equal(resolvePath("rel", "/H", "/C"), "/C/rel")
})

test("resolvePath: пустой cwd даёт ./; пустой путь не расширяется", () => {
  assert.equal(resolvePath("rel", "/H", ""), "./rel")
  assert.equal(resolvePath("", "/H", "/C"), "/C/")
})

// --- MOD_VERSION: константа сходится с манифестом --------------------------------

test("MOD_VERSION: сходится с version манифеста plugin.json", () => {
  const manifest = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"))
  assert.equal(MOD_VERSION, manifest.version)
})

// --- verdictKey: сессионная и текстовая грань вердиктного кэша -------------------

test("verdictKey: разный sid даёт разные ключи", () => {
  assert.notEqual(
    verdictKey("judge", "sid-a", "Agent", "scout", "один текст"),
    verdictKey("judge", "sid-b", "Agent", "scout", "один текст"))
})

test("verdictKey: разный текст даёт разные ключи", () => {
  assert.notEqual(
    verdictKey("judge", "sid", "Agent", "scout", "текст один"),
    verdictKey("judge", "sid", "Agent", "scout", "текст два"))
})

test("verdictKey: длина ключа <= 256 на длинном тексте и длинном sid", () => {
  const long = "x".repeat(10000)
  assert.ok(verdictKey("judge", "sid", "Agent", "scout", long).length <= 256)
  assert.ok(verdictKey("judge", long, "Agent", "scout", long).length <= 256)
})

// --- memoUsable: годность записи вердиктного кэша ---------------------------------

test("memoUsable: undefined -- false", () => {
  assert.equal(memoUsable(undefined, 1000, 100), false)
})

test("memoUsable: объект без t (форма всех прежних ключей) -- false", () => {
  assert.equal(memoUsable({ kind: "BLOCK", rest: "r", used: "m", dtMs: 5 }, 1000, 100), false)
})

test("memoUsable: t старше ttl -- false; ровно на границе ttl -- годен", () => {
  assert.equal(memoUsable({ kind: "BLOCK", t: 899 }, 1000, 100), false)
  assert.equal(memoUsable({ kind: "BLOCK", t: 900 }, 1000, 100), true)
})

test("memoUsable: свежий t с kind BLOCK -- true", () => {
  assert.equal(memoUsable({ kind: "BLOCK", t: 950, rest: "r" }, 1000, 100), true)
})

// CONSTRAINT: t обязан быть ЧИСЛОМ, а не всем, что вычитается. Без явной
// проверки числа строка "950" прошла бы приведением и оживила запись, а стор
// -- общий JSON, куда значение могло лечь от другого производителя. Отрицательный
// контроль 15.09: снятие Number.isFinite оставляло набор зубов ЗЕЛЁНЫМ.
test("memoUsable: t числовой строкой -- false", () => {
  assert.equal(memoUsable({ kind: "BLOCK", t: "950" }, 1000, 100), false)
  assert.equal(memoUsable({ kind: "BLOCK", t: "2026-09-15T00:00:00Z" }, 1000, 100), false)
})

test("memoUsable: свежий t с kind OK/WARN -- false (одобрения не кэшируются)", () => {
  assert.equal(memoUsable({ kind: "OK", t: 950 }, 1000, 100), false)
  assert.equal(memoUsable({ kind: "WARN", t: 950 }, 1000, 100), false)
})
