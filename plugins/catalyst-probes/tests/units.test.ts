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
import {
  bl3, num, clip, classesOf, normTmp, resolvePath,
  parseVal, parseToml, rungsOf, parseVerdict,
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

test("parseVal: массив из чисел даёт ПУСТОЙ массив (режутся только кавычки)", () => {
  assert.deepEqual(parseVal("[1, 2]"), [])
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
  assert.deepEqual(rungsOf({}, "env-model"), [{ model: "env-model" }])
})

test("rungsOf: объектная ступень несёт effort и лимиты", () => {
  assert.deepEqual(
    rungsOf({ models: [{ model: "m", effort: "high", max_tokens: 100, timeout_ms: 2000, context_chars: 1000 }] }, ""),
    [{ model: "m", effort: "high", max_tokens: 100, timeout_ms: 2000, context_chars: 1000 }])
})

test("rungsOf: одиночный cfg.model без models -- одна ступень", () => {
  assert.deepEqual(rungsOf({ model: "x" }, ""), [{ model: "x" }])
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
