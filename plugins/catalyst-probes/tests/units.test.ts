// Unit teeth for plugins/catalyst-probes/hooks/register.ts on the official
// harness: `claude plugin test <plugin dir>` (claude-code/testing).
// CONSTRAINT: the runner's loader admits relative imports of the plugin's own
// files and "claude-code"/"claude-code/testing" only — node:test, node:assert
// and node:fs are refused (measured: "cannot import \"node:test\"").
// CONSTRAINT: expected values are pinned FROM THE CODE (register.ts @ HEAD),
// not from what the format "should" be. A pin that looks wrong is a report
// finding, never a test edit. The rx vocabularies below are copied from
// profileOf (register.ts:361-399): judge register.ts:367, idle-watch :377,
// generic :393, form :386 ("" -- parseVerdict falls back at :235).
import { test, expect } from "claude-code/testing"
import {
  bl3, num, clip, classesOf, normTmp, resolvePath,
  parseVal, parseToml, rungsOf, rungCtx, parseVerdict,
  verdictKey, memoUsable, effortOk, EFFORTS, markEffort,
  readComplete, blocksLine,
  MOD_VERSION,
  failoverLadder, nextFailoverModel, failoverAttemptModels,
  isCarrierRefusal, FAILOVER_MAX_NEXT, FAILOVER_BIND_CAP,
  failoverBindSet, failoverBindGet, failoverBindReset,
} from "../hooks/register.ts"

const RX_JUDGE = "OK|WARN|BLOCK|STOP|DENY"
const RX_IDLE = "SILENT|NUDGE"
const RX_GENERIC = "OK|WARN|BLOCK|SILENT|NUDGE"

// --- bl3: тройная логика флага ----------------------------------------------

test("bl3: undefined/null отдают умолчание", () => {
  expect(bl3(undefined, true)).toBe(true)
  expect(bl3(undefined, false)).toBe(false)
  expect(bl3(null, true)).toBe(true)
  expect(bl3(null, false)).toBe(false)
})

test("bl3: false и 0 -- всегда false", () => {
  expect(bl3(false, true)).toBe(false)
  expect(bl3(0, true)).toBe(false)
})

test("bl3: строковые выключатели", () => {
  expect(bl3("", true)).toBe(false)
  expect(bl3("0", true)).toBe(false)
  expect(bl3("false", true)).toBe(false)
  expect(bl3("off", true)).toBe(false)
  expect(bl3("no", true)).toBe(false)
  expect(bl3(" no ", true)).toBe(false)
})

test("bl3: TRUE и произвольная строка -- true", () => {
  expect(bl3("TRUE", false)).toBe(true)
  expect(bl3("arbitrary", false)).toBe(true)
  expect(bl3(1, false)).toBe(true)
})

// --- num: пол значения --------------------------------------------------------

test("num: число и строка-число проходят", () => {
  expect(num(5, 9, 1)).toBe(5)
  expect(num("42", 9, 1)).toBe(42)
})

test("num: нечисло, undefined, null -- fallback", () => {
  expect(num("abc", 9, 1)).toBe(9)
  expect(num(undefined, 9, 1)).toBe(9)
  expect(num(null, 9, 1)).toBe(9)
})

test("num: ниже пола -- fallback; ровно пол -- проходит", () => {
  expect(num(0, 9, 1)).toBe(9)
  expect(num(1, 9, 1)).toBe(1)
})

test("num: parseInt ест числовой префикс; готовое число дробью не режется", () => {
  expect(num("12px", 9, 1)).toBe(12)
  expect(num(2.7, 9, 1)).toBe(2.7)
})

// --- clip: обрезка ------------------------------------------------------------

test("clip: короче и ровно потолок -- без изменений", () => {
  expect(clip("abc", 5)).toBe("abc")
  expect(clip("abcde", 5)).toBe("abcde")
})

test("clip: длиннее -- обрезан до потолка", () => {
  expect(clip("abcdef", 5)).toBe("abcde")
})

test("clip: undefined на входе -- пустая строка", () => {
  expect(clip(undefined as unknown as string, 5)).toBe("")
})

// --- parseVal: разбор значения TOML -------------------------------------------

test("parseVal: решётка ВНУТРИ кавычек не комментарий", () => {
  expect(parseVal('"текст # не комментарий"')).toBe("текст # не комментарий")
  expect(parseVal("'a # b'")).toBe("a # b")
})

test("parseVal: комментарий после голого значения отрезан", () => {
  expect(parseVal("значение # комментарий")).toBe("значение")
})

test("parseVal: комментарий после ЗАКРЫВАЮЩЕЙ кавычки отрезан", () => {
  expect(parseVal('"a" # c')).toBe("a")
})

test("parseVal: массив строк", () => {
  expect(parseVal('["a", "b"]')).toStrictEqual(["a", "b"])
})

test("parseVal: числа и дробь", () => {
  expect(parseVal("42")).toBe(42)
  expect(parseVal("-7")).toBe(-7)
  expect(parseVal("4.5")).toBe(4.5)
})

test("parseVal: булевы литералы", () => {
  expect(parseVal("true")).toBe(true)
  expect(parseVal("false")).toBe(false)
})

test("parseVal: тройные кавычки", () => {
  expect(parseVal("'''abc'''")).toBe("abc")
  expect(parseVal('"""x"""')).toBe("x")
})

test("parseVal: одинарные кавычки без эскейпов", () => {
  expect(parseVal("'text'")).toBe("text")
})

test("parseVal: голая строка возвращается как есть", () => {
  expect(parseVal("голая строка")).toBe("голая строка")
})

test("parseVal: двойные кавычки разворачивают \\n и \\\"", () => {
  expect(parseVal('"a\\nb"')).toBe("a\nb")
  expect(parseVal('"a\\"b"')).toBe('a"b')
})

test("parseVal: массив из чисел -- числа остаются числами", () => {
  expect(parseVal("[1, 2]")).toStrictEqual([1, 2])
})

test("parseVal: массив в одинарных кавычках", () => {
  expect(parseVal("['a', 'b']")).toStrictEqual(["a", "b"])
})

test("parseVal: массив булевых литералов", () => {
  expect(parseVal("[true, false]")).toStrictEqual([true, false])
})

test("parseVal: пустые массивы -- [] и [ ]", () => {
  expect(parseVal("[]")).toStrictEqual([])
  expect(parseVal("[ ]")).toStrictEqual([])
})

test("parseVal: хвостовая запятая не плодит элемент", () => {
  expect(parseVal('["a",]')).toStrictEqual(["a"])
})

test("parseVal: запятая ВНУТРИ кавычек не делит", () => {
  expect(parseVal('["a, b", "c"]')).toStrictEqual(["a, b", "c"])
})

test("parseVal: вложенные массивы не рушат верхний уровень", () => {
  expect(parseVal('[["a"], ["b"]]')).toStrictEqual([["a"], ["b"]])
})

// --- parseVal: inline-таблицы (ступень одной строкой) --------------------------

// CONSTRAINT: контроль -- запятая ВНУТРИ таблицы. Пока глубина считала только
// квадратные скобки, этот вход давал четыре куска-строки вместо двух таблиц, и
// в модель ступени уезжало `{ model = "a"`.
test("parseVal: массив inline-таблиц -- запятая внутри {} не делит", () => {
  expect(parseVal('[{ model = "a", effort = "max" }, { model = "b", effort = "high" }]'))
    .toStrictEqual([{ model: "a", effort: "max" }, { model: "b", effort: "high" }])
})

test("parseVal: одиночная inline-таблица со всеми типами значений", () => {
  expect(parseVal('{ model = "m", max_tokens = 8000, fail_closed = true, tags = ["a", "b"] }'))
    .toStrictEqual({ model: "m", max_tokens: 8000, fail_closed: true, tags: ["a", "b"] })
})

test("parseVal: пустая inline-таблица", () => {
  expect(parseVal("{}")).toStrictEqual({})
  expect(parseVal("{ }")).toStrictEqual({})
})

test("parseVal: вложенная inline-таблица", () => {
  expect(parseVal('{ a = { b = "c" }, d = 1 }')).toStrictEqual({ a: { b: "c" }, d: 1 })
})

test("parseVal: запятая внутри кавычек внутри таблицы не делит", () => {
  expect(parseVal('{ note = "a, b", model = "m" }')).toStrictEqual({ note: "a, b", model: "m" })
})

// CONSTRAINT: пара без `=` не имеет права ни ронять разбор, ни исчезать --
// годные пары остаются, негодная уходит в __unread.
test("parseVal: пара без знака равенства -- в __unread, соседи целы", () => {
  expect(parseVal('{ model = "m", мусор }')).toStrictEqual({ model: "m", __unread: ["мусор"] })
})

// --- parseToml ----------------------------------------------------------------

test("parseToml: вложенная секция", () => {
  expect(parseToml("[a.b]\nx = 1\n")).toStrictEqual({ a: { b: { x: 1 } } })
})

test("parseToml: массив секций дважды -- ДВА элемента по порядку", () => {
  const t = parseToml(
    "[[probe.judge.models]]\nmodel = \"m1\"\n" +
    "[[probe.judge.models]]\nmodel = \"m2\"\n")
  expect(Array.isArray(t.probe.judge.models)).toBeTruthy()
  expect(t.probe.judge.models.length).toBe(2)
  expect(t.probe.judge.models[0].model).toBe("m1")
  expect(t.probe.judge.models[1].model).toBe("m2")
})

test("parseToml: ключ с подчёркиванием", () => {
  expect(parseToml("[s]\nmax_tokens = 5\n")).toStrictEqual({ s: { max_tokens: 5 } })
})

test("parseToml: строка-комментарий и пустая строка пропущены", () => {
  expect(parseToml("# комментарий\n\n[s]\nx = 1\n")).toStrictEqual({ s: { x: 1 } })
})

test("parseToml: повтор секции НЕ затирает ранее прочитанные ключи", () => {
  expect(parseToml("[a]\nx = 1\n[a]\ny = 2\n")).toStrictEqual({ a: { x: 1, y: 2 } })
})

test("parseToml: ключ с дефисом", () => {
  expect(parseToml("[s]\nmy-key = 1\n")).toStrictEqual({ s: { "my-key": 1 } })
})

test("parseToml: ключ в двойных кавычках -- ОДИН ключ, точки внутри НЕ делят", () => {
  expect(parseToml('[s]\n"a.b" = 1\n')).toStrictEqual({ s: { "a.b": 1 } })
})

test("parseToml: ключ в одинарных кавычках", () => {
  expect(parseToml("[s]\n'a.b' = 1\n")).toStrictEqual({ s: { "a.b": 1 } })
})

test("parseToml: голый точечный ключ -- путь", () => {
  expect(parseToml("[s]\na.b = 1\n")).toStrictEqual({ s: { a: { b: 1 } } })
})

test("parseToml: мусорная строка попадает в __unread", () => {
  const t = parseToml("[s]\nx = 1\nэто мусор\n")
  expect(t.__unread).toStrictEqual(["это мусор"])
})

test("parseToml: чистый конфиг НЕ заводит __unread", () => {
  const t = parseToml("[s]\nx = 1\n")
  expect("__unread" in t).toBe(false)
  expect("__unreadN" in t).toBe(false)
})

test("parseToml: __unreadN считает ВСЕ строки, __unread хранит первые 20", () => {
  const junk = Array.from({ length: 25 }, (_, i) => "мусор " + (i + 1)).join("\n")
  const t = parseToml(junk + "\n")
  expect(t.__unreadN).toBe(25)
  expect(t.__unread.length).toBe(20)
})

// CONSTRAINT: непрочитанная пара ВНУТРИ inline-таблицы обязана попасть в тот же
// счётчик, что и непрочитанная строка файла -- cfgUnread собирается из
// __unreadN КОРНЯ, и отдельный счётчик у вложенной формы был бы невидим.
test("parseToml: непрочитанная пара inline-таблицы уходит в корневой __unreadN", () => {
  const t = parseToml('[s]\nmodels = [{ model = "m", мусор }]\n')
  expect(t.__unreadN).toBe(1)
  expect(t.__unread).toStrictEqual(["мусор"])
  expect(t.s.models).toStrictEqual([{ model: "m" }])
})

test("parseToml: строка и вложенная пара считаются ОДНИМ счётчиком", () => {
  const t = parseToml('[s]\nсвоя мусорная строка\nmodels = [{ model = "m", мусор }]\n')
  expect(t.__unreadN).toBe(2)
})

// CONSTRAINT: служебная отметка не имеет права уехать в конфиг ступени --
// иначе мусорная пара стала бы полем разобранной модели.
test("parseToml: __unread снят с узла ступени", () => {
  const t = parseToml('[s]\nmodels = [{ model = "m", мусор }]\n')
  expect("__unread" in t.s.models[0]).toBe(false)
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
  expect(inline.probe.judge.models).toStrictEqual(aot.probe.judge.models)
  expect(rungsOf(inline.probe.judge, "")).toStrictEqual(rungsOf(aot.probe.judge, ""))
})

// --- rungsOf: лестница ступеней ------------------------------------------------

test("rungsOf: три модели -- три ступени по порядку", () => {
  expect(rungsOf({ models: ["a", "b", "c"] }, ""))
    .toStrictEqual([{ model: "a" }, { model: "b" }, { model: "c" }])
})

test("rungsOf: пустой конфиг -- встроенная последняя ступень glm-5.3", () => {
  expect(rungsOf({}, "")).toStrictEqual([{ model: "glm-5.3" }])
  expect(rungsOf(null, "")).toStrictEqual([{ model: "glm-5.3" }])
})

test("rungsOf: непустой modelEnv замораживает лестницу в ОДНУ ступень", () => {
  expect(rungsOf({ models: ["a", "b"] }, "env-model"))
    .toStrictEqual([{ model: "env-model" }])
  expect(rungsOf({ model: "x" }, "env-model")).toStrictEqual([{ model: "env-model" }])
})

test("rungsOf: modelEnv наследует effort и лимиты ПЕРВОЙ ступени конфига", () => {
  expect(rungsOf({ models: [
    { model: "a", effort: "high", max_tokens: 100, timeout_ms: 2000, context_chars: 1000 },
    { model: "b", max_tokens: 500 },
  ] }, "env-model"))
    .toStrictEqual([{ model: "env-model", effort: "high", max_tokens: 100, timeout_ms: 2000, context_chars: 1000 }])
})

test("rungsOf: modelEnv при пустом конфиге -- ровно [{ model: modelEnv }]", () => {
  expect(rungsOf({}, "env-model")).toStrictEqual([{ model: "env-model" }])
  expect(rungsOf(null, "env-model")).toStrictEqual([{ model: "env-model" }])
})

test("rungsOf: объектная ступень несёт effort и лимиты", () => {
  expect(rungsOf({ models: [{ model: "m", effort: "high", max_tokens: 100, timeout_ms: 2000, context_chars: 1000 }] }, ""))
    .toStrictEqual([{ model: "m", effort: "high", max_tokens: 100, timeout_ms: 2000, context_chars: 1000 }])
})

test("rungsOf: одиночный cfg.model без models -- одна ступень", () => {
  expect(rungsOf({ model: "x" }, "")).toStrictEqual([{ model: "x" }])
})

// --- effortOk / негодный эффорт ступени (#141) ---------------------------------

test("effortOk: ось канона целиком годна", () => {
  expect(EFFORTS).toStrictEqual(["low", "medium", "high", "xhigh", "max"])
  for (const v of EFFORTS) expect(effortOk(v)).toBe(true)
})

// CONSTRAINT: регистр и пробел -- ЧАСТЬ значения: поле уезжает провайдеру
// дословно, поэтому послабление здесь вернуло бы ровно тот дефект, который
// правка закрывает.
test("effortOk: негодные формы -- false", () => {
  for (const v of ["High", "HIGH", "higj", "extra-high", " high", "high ", "", "ultra"])
    expect(effortOk(v)).toBe(false)
})

// CONSTRAINT: предикат сравнивает СТРОГО, поэтому не-строка отвергается без
// отдельной проверки типа; зуб пинит поведение, а не наличие проверки.
test("effortOk: не-строка -- false, даже если приводится к годному", () => {
  expect(effortOk({ toString: () => "high" })).toBe(false)
  expect(effortOk(["high"])).toBe(false)
  expect(effortOk(3)).toBe(false)
  expect(effortOk(null)).toBe(false)
  expect(effortOk(undefined)).toBe(false)
})

test("rungsOf: негодный эффорт НЕ уезжает, а называется effortBad", () => {
  expect(rungsOf({ models: [{ model: "m", effort: "higj", max_tokens: 100 }] }, ""))
    .toStrictEqual([{ model: "m", effortBad: "higj", max_tokens: 100 }])
  expect(rungsOf({ models: [{ model: "m", effort: "HIGH" }] }, ""))
    .toStrictEqual([{ model: "m", effortBad: "HIGH" }])
})

test("rungsOf: числовой эффорт -- негодный, а не приведённый к строке", () => {
  const r = rungsOf({ models: [{ model: "m", effort: 3 }] }, "")
  expect(r[0].effort).toBe(undefined)
  expect(r[0].effortBad).toBe("3")
})

// CONSTRAINT: ручка модели наследует ПЕРВУЮ ступень целиком -- отметка о
// негодном эффорте обязана ехать вместе с ней, иначе замер через
// CLAUDE_JUDGE_MODEL терял бы диагноз конфига.
test("rungsOf: modelEnv наследует и отметку негодного эффорта", () => {
  expect(rungsOf({ models: [{ model: "a", effort: "ultra" }] }, "env-model"))
    .toStrictEqual([{ model: "env-model", effortBad: "ultra" }])
})

// CONSTRAINT: улика -- единственная дорога, по которой негодный эффорт
// становится видимым; без этих зубов снятие отметки было молчаливым.
test("markEffort: негодный эффорт попадает в улику полем по модели", () => {
  const rec: any = {}
  markEffort(rec, "glm-5.3", { model: "glm-5.3", effortBad: "higj" })
  expect(rec).toStrictEqual({ "effortBad_glm-5.3": "higj" })
})

test("markEffort: годная ступень улику не трогает", () => {
  const rec: any = { a: 1 }
  markEffort(rec, "m", { model: "m", effort: "max" })
  markEffort(rec, "m", null)
  expect(rec).toStrictEqual({ a: 1 })
})

test("markEffort: разные ступени -- разные поля", () => {
  const rec: any = {}
  markEffort(rec, "a", { effortBad: "x" })
  markEffort(rec, "b", { effortBad: "y" })
  expect(rec).toStrictEqual({ effortBad_a: "x", effortBad_b: "y" })
})

test("rungsOf: годный эффорт отметки не порождает", () => {
  const r = rungsOf({ models: [{ model: "m", effort: "xhigh" }] }, "")
  expect(r[0].effort).toBe("xhigh")
  expect("effortBad" in (r[0] as any)).toBe(false)
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
  expect(rungs.length).toBe(2)
  expect(rungs[0].effort).toBe("max")
  expect(rungs[1].effort).toBe(undefined)
  expect(rungs[1].effortBad).toBe("turbo")
})

// --- rungCtx: потолок контекста ступени ----------------------------------------

test("rungCtx: ступень со своим context_chars", () => {
  expect(rungCtx({ context_chars: 1000 }, { context_chars: 500 })).toBe(1000)
})

test("rungCtx: ступень без него -- уровень пробы", () => {
  expect(rungCtx({}, { context_chars: 500 })).toBe(500)
})

test("rungCtx: ни ступени, ни пробы -- 24000", () => {
  expect(rungCtx({}, {})).toBe(24000)
  expect(rungCtx(null, null)).toBe(24000)
})

test("rungCtx: нечисло на ступени -- уровень пробы; нечисло у пробы -- 24000", () => {
  expect(rungCtx({ context_chars: "abc" }, { context_chars: 700 })).toBe(700)
  expect(rungCtx({}, { context_chars: "abc" })).toBe(24000)
})

// --- parseVerdict ---------------------------------------------------------------

test("parseVerdict: BLOCK/OK/WARN в начале первой строки", () => {
  expect(parseVerdict("BLOCK: причина", RX_JUDGE)).toStrictEqual({ kind: "BLOCK", rest: "причина" })
  expect(parseVerdict("OK:", RX_JUDGE)).toStrictEqual({ kind: "OK", rest: "" })
  expect(parseVerdict("WARN: w", RX_JUDGE)).toStrictEqual({ kind: "WARN", rest: "w" })
})

test("parseVerdict: без вердикта и пустая строка -- null", () => {
  expect(parseVerdict("просто текст", RX_JUDGE)).toBe(null)
  expect(parseVerdict("", RX_JUDGE)).toBe(null)
})

test("parseVerdict: первая строка приоритетнее поздних строк", () => {
  expect(parseVerdict("OK: первая\nBLOCK: вторая", RX_JUDGE))
    .toStrictEqual({ kind: "OK", rest: "первая" })
})

test("parseVerdict: вердикт не в начале первой строки, но в конце текста -- найден", () => {
  expect(parseVerdict("первая строка\nнет\nBLOCK: вторая", RX_JUDGE))
    .toStrictEqual({ kind: "BLOCK", rest: "вторая" })
})

test("parseVerdict: вердикт в СЕРЕДИНЕ строки не считается", () => {
  expect(parseVerdict("xx BLOCK: y", RX_JUDGE)).toBe(null)
})

test("parseVerdict: словарь rx решает, что вердикт", () => {
  expect(parseVerdict("STOP: x", RX_JUDGE)).toStrictEqual({ kind: "STOP", rest: "x" })
  expect(parseVerdict("STOP: x", "")).toBe(null)
  expect(parseVerdict("NUDGE: n", RX_IDLE)).toStrictEqual({ kind: "NUDGE", rest: "n" })
  expect(parseVerdict("BLOCK: b", RX_IDLE)).toBe(null)
  expect(parseVerdict("SILENT: s", RX_GENERIC)).toStrictEqual({ kind: "SILENT", rest: "s" })
})

test("parseVerdict: пустой rx падает на встроенный словарь OK|WARN|BLOCK", () => {
  expect(parseVerdict("BLOCK: b", "")).toStrictEqual({ kind: "BLOCK", rest: "b" })
})

test("parseVerdict: пробелы в rest съедаются; пробелы в rx вырезаются", () => {
  expect(parseVerdict("BLOCK:   r", RX_JUDGE)).toStrictEqual({ kind: "BLOCK", rest: "r" })
  expect(parseVerdict("BLOCK: x", "OK | BLOCK")).toStrictEqual({ kind: "BLOCK", rest: "x" })
})

// --- classesOf -------------------------------------------------------------------

test("classesOf: маркер извлечён; повтор не дублируется", () => {
  expect(classesOf("[dispatch-class:exec-0p] текст")).toStrictEqual(["exec-0p"])
  expect(classesOf("[dispatch-class:a] x [dispatch-class:b] y [dispatch-class:a]"))
    .toStrictEqual(["a", "b"])
})

test("classesOf: без маркеров и пустой вход -- пустой список", () => {
  expect(classesOf("")).toStrictEqual([])
  expect(classesOf("нет маркеров")).toStrictEqual([])
  expect(classesOf(undefined as unknown as string)).toStrictEqual([])
})

// --- normTmp ---------------------------------------------------------------------

test("normTmp: /private/tmp свёрнут в /tmp", () => {
  expect(normTmp("/private/tmp/x")).toBe("/tmp/x")
  expect(normTmp("/private/tmp")).toBe("/tmp")
})

test("normTmp: чужой префикс и пустой вход не тронуты", () => {
  expect(normTmp("/tmp/x")).toBe("/tmp/x")
  expect(normTmp("/private/tmporary")).toBe("/private/tmporary")
  expect(normTmp("")).toBe("")
  expect(normTmp(null as unknown as string)).toBe("")
})

// --- resolvePath -------------------------------------------------------------------

test("resolvePath: тильда, абсолютный и относительный путь", () => {
  expect(resolvePath("~/d/f", "/H", "/C")).toBe("/H/d/f")
  expect(resolvePath("/abs", "/H", "/C")).toBe("/abs")
  expect(resolvePath("rel", "/H", "/C")).toBe("/C/rel")
})

test("resolvePath: пустой cwd даёт ./; пустой путь не расширяется", () => {
  expect(resolvePath("rel", "/H", "")).toBe("./rel")
  expect(resolvePath("", "/H", "/C")).toBe("/C/")
})

// --- MOD_VERSION: константа против манифеста --------------------------------

// CONSTRAINT: манифест .claude-plugin/plugin.json в среде раннера НЕЧИТАЕМ:
// JSON-импорт парсится как JS («Unexpected token ':'»), суффикс ?raw не
// резолвится загрузчиком, node:fs запрещён. Проверка пинит литерал версии из
// манифеста HEAD; сверка константы с САМИМ файлом манифеста живёт вне
// официального харнеса (волна #200, отчёт).
test("MOD_VERSION: пин версии манифеста plugin.json (файл в раннере нечитаем)", () => {
  expect(MOD_VERSION).toBe("0.1.23")
})

// --- verdictKey: сессионная и текстовая грань вердиктного кэша -------------------

test("verdictKey: разный sid даёт разные ключи", () => {
  expect(verdictKey("judge", "sid-a", "Agent", "scout", "один текст"))
    .not.toBe(verdictKey("judge", "sid-b", "Agent", "scout", "один текст"))
})

test("verdictKey: разный текст даёт разные ключи", () => {
  expect(verdictKey("judge", "sid", "Agent", "scout", "текст один"))
    .not.toBe(verdictKey("judge", "sid", "Agent", "scout", "текст два"))
})

test("verdictKey: длина ключа <= 256 на длинном тексте и длинном sid", () => {
  const long = "x".repeat(10000)
  expect(verdictKey("judge", "sid", "Agent", "scout", long).length).toBeLessThanOrEqual(256)
  expect(verdictKey("judge", long, "Agent", "scout", long).length).toBeLessThanOrEqual(256)
})

// --- memoUsable: годность записи вердиктного кэша ---------------------------------

test("memoUsable: undefined -- false", () => {
  expect(memoUsable(undefined, 1000, 100)).toBe(false)
})

test("memoUsable: объект без t (форма всех прежних ключей) -- false", () => {
  expect(memoUsable({ kind: "BLOCK", rest: "r", used: "m", dtMs: 5 }, 1000, 100)).toBe(false)
})

test("memoUsable: t старше ttl -- false; ровно на границе ttl -- годен", () => {
  expect(memoUsable({ kind: "BLOCK", t: 899 }, 1000, 100)).toBe(false)
  expect(memoUsable({ kind: "BLOCK", t: 900 }, 1000, 100)).toBe(true)
})

test("memoUsable: свежий t с kind BLOCK -- true", () => {
  expect(memoUsable({ kind: "BLOCK", t: 950, rest: "r" }, 1000, 100)).toBe(true)
})

// CONSTRAINT: t обязан быть ЧИСЛОМ, а не всем, что вычитывается. Без явной
// проверки числа строка "950" прошла бы приведением и оживила запись, а стор
// -- общий JSON, куда значение могло лечь от другого производителя. Отрицательный
// контроль 15.09: снятие Number.isFinite оставляло набор зубов ЗЕЛЁНЫМ.
test("memoUsable: t числовой строкой -- false", () => {
  expect(memoUsable({ kind: "BLOCK", t: "950" }, 1000, 100)).toBe(false)
  expect(memoUsable({ kind: "BLOCK", t: "2026-09-15T00:00:00Z" }, 1000, 100)).toBe(false)
})

test("memoUsable: свежий t с kind OK/WARN -- false (одобрения не кэшируются)", () => {
  expect(memoUsable({ kind: "OK", t: 950 }, 1000, 100)).toBe(false)
  expect(memoUsable({ kind: "WARN", t: 950 }, 1000, 100)).toBe(false)
})

// --- readComplete: две формы ответа модели (#190) -----------------------------
// CONSTRAINT: ожидания запинены ОТ КОДА -- шаг 31 патча отдаёт конверт
// {text, stopReason, blocks:[{type,len}], usage}, а образ без шага возвращает
// прежнюю строку (склейку текстовых блоков). Обе формы законны.

test("readComplete: строка -- текст, detailed=false, причин нет", () => {
  const a = readComplete("BLOCK: нет предмета")
  expect(a.text).toBe("BLOCK: нет предмета")
  expect(a.detailed).toBe(false)
  expect(a.stopReason).toBe(null)
  expect(a.blocks).toBe(null)
  expect(a.outTok).toBe(null)
})

test("readComplete: ПУСТАЯ строка старого образа -- пустой текст, но НЕ измеренный ноль", () => {
  const a = readComplete("")
  expect(a.text).toBe("")
  expect(a.detailed).toBe(false)
  expect(a.blocks).toBe(null)
})

test("readComplete: null/undefined -- пустой текст без конверта", () => {
  for (const v of [null, undefined]) {
    const a = readComplete(v)
    expect(a.text).toBe("")
    expect(a.detailed).toBe(false)
    expect(a.stopReason).toBe(null)
  }
})

test("readComplete: конверт с пустым текстом -- ИЗМЕРЕННЫЙ ноль и причина", () => {
  const a = readComplete({
    text: "", stopReason: "max_tokens",
    blocks: [{ type: "thinking", len: 4096 }],
    usage: { output_tokens: 4096 },
  })
  expect(a.detailed).toBe(true)
  expect(a.text).toBe("")
  expect(a.stopReason).toBe("max_tokens")
  expect(a.outTok).toBe(4096)
  expect(a.blocks).toStrictEqual([{ type: "thinking", len: 4096 }])
})

test("readComplete: конверт опознаётся по любому из трёх своих полей", () => {
  expect(readComplete({ text: "x", stopReason: "end_turn" }).detailed).toBe(true)
  expect(readComplete({ text: "x", blocks: [] }).detailed).toBe(true)
  expect(readComplete({ text: "x", usage: {} }).detailed).toBe(true)
})

test("readComplete: ЧУЖОЙ объект без полей конверта не становится текстом", () => {
  // Без этой ветки String(объект) дал бы "[object Object]" в роли ответа модели.
  const a = readComplete({ foo: 1 })
  expect(a.text).toBe("")
  expect(a.detailed).toBe(false)
})

test("readComplete: нестроковый stopReason и нечисловой usage не подделываются", () => {
  const a = readComplete({ text: "x", stopReason: 7, usage: { output_tokens: "12" }, blocks: [] })
  expect(a.detailed).toBe(true)
  expect(a.stopReason).toBe(null)
  expect(a.outTok).toBe(null)
})

test("readComplete: blocks -- только объекты, тип и длина нормализуются", () => {
  const a = readComplete({ text: "", blocks: [{ type: "text" }, "мусор", { len: 5 }] })
  expect(a.blocks).toStrictEqual([{ type: "text", len: 0 }, { type: "?", len: 5 }])
})

test("readComplete: blocks не массив -- поля нет вовсе (нечем измерить)", () => {
  const a = readComplete({ text: "", blocks: "нет", stopReason: "end_turn" })
  expect(a.detailed).toBe(true)
  expect(a.blocks).toBe(null)
})

test("readComplete: нестроковый text при живом конверте -- пусто, не подделка", () => {
  const a = readComplete({ text: 42, stopReason: "end_turn" })
  expect(a.text).toBe("")
  expect(a.detailed).toBe(true)
})

// --- blocksLine: улика однострочна ---------------------------------------------

test("blocksLine: перечень типов с длинами через запятую", () => {
  expect(blocksLine([{ type: "thinking", len: 4096 }, { type: "text", len: 0 }]))
    .toBe("thinking:4096,text:0")
})

test("blocksLine: пустой массив -- пустая строка; null -- тоже", () => {
  expect(blocksLine([])).toBe("")
  expect(blocksLine(null)).toBe("")
})

// --- failover: лестница, пропуск, потолок, признак отказа ---------------------

const FAILOVER_TOML = `[failover.default]
models = ["d1", "d2"]

[failover.class.exec-0p]
models = ["c1", "c2"]

[failover.agent.glm-executor]
models = ["a1", "a2", "a3"]
`

test("failoverLadder: ключ agent выигрывает у class и default", () => {
  const fo = parseToml(FAILOVER_TOML).failover
  expect(failoverLadder(fo, "glm-executor", "exec-0p")).toStrictEqual(["a1", "a2", "a3"])
})

test("failoverLadder: ключ class выигрывает, когда agent-таблицы нет", () => {
  const fo = parseToml(FAILOVER_TOML).failover
  expect(failoverLadder(fo, "other-agent", "exec-0p")).toStrictEqual(["c1", "c2"])
})

test("failoverLadder: default, когда нет ни agent, ни class", () => {
  const fo = parseToml(FAILOVER_TOML).failover
  expect(failoverLadder(fo, "other-agent", "exec-1n")).toStrictEqual(["d1", "d2"])
})

test("failoverLadder: нет ни одной таблицы -- пустая лестница", () => {
  expect(failoverLadder(undefined, "glm-executor", "exec-0p")).toStrictEqual([])
  expect(failoverLadder({}, "glm-executor", "exec-0p")).toStrictEqual([])
})

test("nextFailoverModel: пропуск уже отказавшей модели", () => {
  expect(nextFailoverModel(["glm-5.3", "grok-4.6"], ["glm-5.3"])).toBe("grok-4.6")
  expect(nextFailoverModel(["glm-5.3", "grok-4.6"], ["glm-5.3", "grok-4.6"])).toBe(null)
  expect(nextFailoverModel(["a", "b", "c"], ["b"])).toBe("a")
})

test("failoverAttemptModels: потолок трёх вызовов", () => {
  const seq = failoverAttemptModels("incoming", null, ["m1", "m2", "m3", "m4", "m5"])
  expect(seq).toStrictEqual(["incoming", "m1", "m2"])
  expect(seq.length).toBe(FAILOVER_MAX_NEXT)
})

test("isCarrierRefusal: usage null и stopReason null -- отказ носителя", () => {
  expect(isCarrierRefusal({
    turnId: "t", index: 0, answer: "", toolUses: [],
    stopReason: null, usage: null,
  })).toBe(true)
})

test("isCarrierRefusal: честный пустой текст не считается отказом", () => {
  expect(isCarrierRefusal({
    turnId: "t", index: 0, answer: "", toolUses: [],
    stopReason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 4, model: "glm-5.3" },
  })).toBe(false)
  expect(isCarrierRefusal({
    turnId: "t", index: 0, answer: "", toolUses: [],
    stopReason: null,
    usage: { input_tokens: 10, output_tokens: 4, model: "glm-5.3" },
  })).toBe(false)
  expect(isCarrierRefusal({
    turnId: "t", index: 0, answer: "", toolUses: [],
    stopReason: "end_turn",
    usage: null,
  })).toBe(false)
})

test("failover binds: потолок 512, вытеснение старейших", () => {
  failoverBindReset()
  for (let i = 0; i < FAILOVER_BIND_CAP + 1; i++) {
    failoverBindSet("id-" + i, { ladder: ["m"], subagentType: "t", class: "", sticky: null })
  }
  expect(failoverBindGet("id-0")).toBe(undefined)
  expect(failoverBindGet("id-1") && failoverBindGet("id-1").ladder).toStrictEqual(["m"])
  expect(failoverBindGet("id-" + FAILOVER_BIND_CAP) && failoverBindGet("id-" + FAILOVER_BIND_CAP).ladder).toStrictEqual(["m"])
  failoverBindReset()
})
