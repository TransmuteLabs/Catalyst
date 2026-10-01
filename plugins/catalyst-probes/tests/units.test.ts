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
  readComplete, blocksLine, reTestMark,
  outcomeOf, verdictVocabSeed, verdictVocabReset,
  formVerdictUpper, formVocabRefusal,
  MOD_VERSION, RUNG_COOLDOWN_MS, noteRungTimeout, rungsAfterCooldown,
  failoverLadder, failoverLadderBind, loadAllowedByClass, loadWorld, worldFor, nextFailoverModel, failoverAttemptModels,
  isCarrierRefusal, FAILOVER_BIND_CAP, chunkCarriesContent,
  failoverBindSet, failoverBindGet, failoverBindReset,
  FAILOVER_FOLD_PERIOD_MS, FOLD_ARM_RETRY_MS, failoverAttemptIsBoring, armFailoverFoldTimer,
  failoverFoldCount, failoverFoldNote, failoverFoldFlush, failoverFoldReset, failoverFoldWriteErr, failoverFoldSplitLost, failoverFoldResetLost,
  failoverFoldObserve, failoverWouldSetSticky,
  sessionExecutorHas, sessionExecutorModelAdd, sessionExecutorsReset, hostMemoReset,
  cooldownSnapshot, ladderCommandText, clipLadderArg,
  isModelCooling, noteRungCarrierRefusal, deferCoolingAttemptModels, rungCooldownReset,
  LADDER_COMMAND, LADDER_COMMAND_DESCRIPTION, LADDER_COMMAND_ARG_HINT,
  LADDER_COMMAND_ARG_MAX, register as registerRaw514,
  COACHING, COACHING_SPLICE_SHA256,
} from "../hooks/register.ts"
// CONSTRAINT (#393-A2): lostWrites -- состояние МОДУЛЯ, а раннер держит один
// процесс на файл; снапшот читается через namespace-импорт, потому что на коде
// ДО волны экспорта lostWritesSnapshot нет и именованный импорт ронял бы весь
// файл -- красная фаза обязана показывать отказ КАЖДОГО зуба отдельной строкой.
import * as registerModule393 from "../hooks/register.ts"
import { TERMINAL_PARITY_509 } from "./terminal-parity-509.ts"

import { STAND_MODEL_CAP_TEXT, standModelOver, cappedRegister } from "./stand-cap-514.ts"

const register = cappedRegister(registerRaw514)

// CONSTRAINT: sha256-прибор несёт сам набор юнитов: раннер отказывает
// node:test/node:assert/node:fs, а веб-глобалы (crypto, TextEncoder) в нём
// не гарантированы -- ступень паритета обязана быть исполнимой всегда.
function sha256hex(s: string): string {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length &&
             s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      const cp = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(i + 1) - 0xdc00)
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
      i++
    } else if (c >= 0xd800 && c <= 0xdfff) bytes.push(0xef, 0xbf, 0xbd)
    else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const bitLenHi = Math.floor((bytes.length / 0x20000000) % 4096)
  const bitLenLo = (bytes.length << 3) >>> 0
  const msg = bytes.concat([0x80])
  while (msg.length % 64 !== 56) msg.push(0)
  msg.push(bitLenHi >>> 24, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255,
           bitLenHi & 255, bitLenLo >>> 24, (bitLenLo >>> 16) & 255,
           (bitLenLo >>> 8) & 255, bitLenLo & 255)
  const w = new Array<number>(64)
  const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0
  for (let off = 0; off < msg.length; off += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) |
              (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) >>> 0
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = H
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const mj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + mj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  let out = ""
  for (let i = 0; i < 8; i++) {
    for (let sh = 28; sh >= 0; sh -= 4) {
      out += "0123456789abcdef"[(H[i] >>> sh) & 15]
    }
  }
  return out
}

test("rung-cooldown: свежая метка исключает ступень, включая границу окна", () => {
  expect(RUNG_COOLDOWN_MS).toBe(900000)
  const ladder = [{ model: "cold", effort: "high" }, { model: "ready", timeout_ms: 42 }]
  const marks = new Map<string, any>([["cold", { at: 0, reason: "rung-timeout" }]])
  expect(rungsAfterCooldown(ladder, 1, marks).ladder).toEqual([ladder[1]])
  expect(rungsAfterCooldown(ladder, RUNG_COOLDOWN_MS, marks).ladder).toEqual([ladder[1]])
  expect(ladder.length).toBe(2)
})

test("rung-cooldown: просроченная метка возвращает ступень", () => {
  const ladder = [{ model: "expired" }, { model: "ready" }]
  const marks = new Map<string, any>([["expired", { at: 10, reason: "rung-timeout" }]])
  expect(rungsAfterCooldown(ladder, 10 + RUNG_COOLDOWN_MS + 1, marks).ladder).toEqual(ladder)
  expect(rungsAfterCooldown(ladder, 10, new Map()).ladder).toEqual(ladder)
})

test("rung-cooldown: все метки не вырождают лестницу", () => {
  const ladder = [{ model: "a", max_tokens: 17 }, { model: "b", effort: "max" }]
  const marks = new Map<string, any>([["a", { at: 100, reason: "rung-timeout" }], ["b", { at: 100, reason: "rung-timeout" }]])
  expect(rungsAfterCooldown(ladder, 101, marks).ladder).toEqual(ladder)
  expect(rungsAfterCooldown([ladder[0]], 101, marks).ladder).toEqual([ladder[0]])
  expect(rungsAfterCooldown([], 101, marks).ladder).toEqual([])
})

test("rung-cooldown: метка только на rung-deadline", () => {
  const marks = new Map<string, any>()
  expect(noteRungTimeout("deadline", "Error: rung-deadline deadline 240000ms", 10, marks)).toBe(true)
  expect(marks.get("deadline")).toEqual({ at: 10, reason: "rung-timeout" })
  expect(noteRungTimeout("deadline", "Error: rung-deadline deadline 240000ms", 20, marks)).toBe(true)
  expect(marks.get("deadline")).toEqual({ at: 20, reason: "rung-timeout" })
  for (const errText of ["", "carrier refusal", "BLOCK: retry", "cancelled"]) {
    expect(noteRungTimeout("other", errText, 30, marks)).toBe(false)
    expect(marks.has("other")).toBe(false)
  }
  expect(noteRungTimeout("deadline", "carrier refusal", 30, marks)).toBe(false)
  expect(marks.get("deadline")).toEqual({ at: 20, reason: "rung-timeout" })
})

test("rung-cooldown: улика называет только фактические пропуски и возраст", () => {
  const ladder = [{ model: "cold" }, { model: "ready" }]
  const marks = new Map<string, any>([["cold", { at: 100, reason: "rung-timeout" }]])
  expect(rungsAfterCooldown(ladder, 123, marks).evidence).toEqual({
    rungCooldownSkipped: ["cold"], rungCooldownAgeMs_cold: 23,
  })
  expect(rungsAfterCooldown(ladder, 123, new Map()).evidence).toEqual({})
  expect(rungsAfterCooldown([ladder[0]], 123, marks).evidence).toEqual({})
  expect(rungsAfterCooldown(ladder, 100 + RUNG_COOLDOWN_MS + 1, marks).evidence).toEqual({})
})

test("rung-cooldown: урезанный бюджет считается таймаутом без метки", () => {
  const marks = new Map<string, any>()
  const error = "Error: rung-deadline model 10ms"
  expect(noteRungTimeout("model", error, 10, marks, true)).toBe(true)
  expect(marks.has("model")).toBe(false)
  expect(noteRungTimeout("model", error, 20, marks, false)).toBe(true)
  expect(marks.get("model")).toEqual({ at: 20, reason: "rung-timeout" })
  expect(noteRungTimeout("model", error, 30, marks, true)).toBe(true)
  expect(marks.get("model")).toEqual({ at: 20, reason: "rung-timeout" })
})

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

test("#391 B: негодный словарь профиля подменяется общим, и подмена НАЗВАНА", () => {
  const bad: string[] = []
  expect(parseVerdict("BLOCK: причина", "OK|(BLOCK", bad))
    .toStrictEqual({ kind: "BLOCK", rest: "причина" })
  expect(bad, "разбор чужим словарём перестал быть молчаливым").toStrictEqual(["rx=OK|(BLOCK"])
  const bad2: string[] = []
  expect(parseVerdict("текст без вердикта", "(", bad2)).toBe(null)
  expect(bad2, "улика доезжает и когда разбор не нашёл ничего").toStrictEqual(["rx=("])
  const bad3: string[] = []
  parseVerdict("BLOCK: x", RX_JUDGE, bad3)
  expect(bad3, "годный словарь улики не даёт").toStrictEqual([])
})

test("#391 reTestMark: негодный образец даёт false и улику с именем поля", () => {
  const bad: string[] = []
  expect(reTestMark("exec-.*", "exec-0p", "classes_judge", bad)).toBe(true)
  expect(bad).toStrictEqual([])
  expect(reTestMark("exec-(", "exec-0p", "classes_judge", bad)).toBe(false)
  expect(bad).toStrictEqual(["classes_judge=exec-("])
  expect(reTestMark("exec-(", "", "classes_judge", bad), "пустой предмет: до компиляции дело не доходит").toBe(false)
  expect(bad.length, "образец, который не тестировали, уликой не считается").toBe(1)
  const long = "(" + "y".repeat(80)
  reTestMark(long, "z", "agents_judge", bad)
  expect(bad[1], "граница 64 символа -- та же, что у effortBad").toBe("agents_judge=" + long.slice(0, 64))
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

// --- исход: один дом, одна свёртка (#374) ----------------------------------------
// CONSTRAINT: таблица ниже -- ДОГОВОР мода с прибором (judge/compact.py):
// для КАЖДОЙ клетки оба дают ОДИН класс. Пин снимается с дома файла
// (VERDICT_VOCAB); смена любой строки дома обязана краснеть здесь.

test("outcomeOf: семь клеток таблицы -- один класс с прибором", () => {
  expect(outcomeOf("OK", "judge")).toBe("ok")
  expect(outcomeOf("WARN", "judge")).toBe("ok")
  expect(outcomeOf("BLOCK", "judge")).toBe("block")
  expect(outcomeOf("STOP", "judge")).toBe("block")
  expect(outcomeOf("DENY", "judge")).toBe("block")
  expect(outcomeOf("PASS", "form")).toBe("ok")
  expect(outcomeOf("WARN", "form")).toBe("block")
  expect(outcomeOf("REFUSE", "form")).toBe("block")
  expect(outcomeOf("SILENT", "idle-watch")).toBe("ok")
  expect(outcomeOf("NUDGE", "idle-watch")).toBe("block")
})

test("outcomeOf: служебные исходы -- вне словаря, литерально", () => {
  expect(outcomeOf("NONE", "judge")).toBe("block_no_verdict")
  expect(outcomeOf("TIMEOUT", "judge")).toBe("skip")
  expect(outcomeOf("TRUNCATED", "form")).toBe("skip")
  expect(outcomeOf("SKIP", "idle-watch")).toBe("skip")
  expect(outcomeOf("STALE_EPOCH", "judge")).toBe("skip")
})

test("outcomeOf: удаление строки дома меняет класс мода -- профиль падает на *", () => {
  try {
    verdictVocabSeed([
      { probe: "idle-watch", emits: "SILENT|NUDGE", folds: "NUDGE" },
      { probe: "*", emits: "OK|WARN|BLOCK|SILENT|NUDGE", folds: "BLOCK" },
    ])
    // строки «form» и «judge» нет: их виды ищутся в профиле «*», где WARN
    // не свёрнут, PASS/REFUSE/STOP/DENY не объявлены вовсе -- каждый класс
    // отличается от дома файла. Второй потребитель дома не имеет права
    // молча пережить такую смену.
    expect(outcomeOf("WARN", "form")).toBe("ok")
    expect(outcomeOf("PASS", "form")).toBe("skip")
    expect(outcomeOf("REFUSE", "form")).toBe("skip")
    expect(outcomeOf("STOP", "judge")).toBe("skip")
    expect(outcomeOf("DENY", "judge")).toBe("skip")
  } finally {
    verdictVocabReset()
  }
  expect(outcomeOf("WARN", "form"), "после сброса -- дом файла").toBe("block")
  expect(outcomeOf("STOP", "judge"), "после сброса -- дом файла").toBe("block")
})

// --- #375: рассогласование дома и правил формы -------------------------------
//
// CONSTRAINT: зубы стоят ЗДЕСЬ, а не в behavior: официальный стенд исполняет
// хук в экземпляре модуля, недоступном посеву, и поведенческий сценарий
// проверял бы дом файла вместо посеянного.

test("formVerdictUpper: дом файла знает все три вида правил формы", () => {
  expect(formVerdictUpper("pass")).toBe("PASS")
  expect(formVerdictUpper("warn")).toBe("WARN")
  expect(formVerdictUpper("refuse")).toBe("REFUSE")
})

test("formVerdictUpper: вида нет в доме -- null, а НЕ пустая строка", () => {
  try {
    verdictVocabSeed([
      { probe: "form", emits: "PASS|WARN", folds: "WARN" },
      { probe: "*", emits: "OK|WARN|BLOCK|SILENT|NUDGE", folds: "BLOCK" },
    ])
    expect(formVerdictUpper("refuse"), "дом не знает вид -- отказ, не пустой вид").toBe(null)
    expect(formVerdictUpper("pass"), "известный вид продолжает разбираться").toBe("PASS")
  } finally {
    verdictVocabReset()
  }
  expect(formVerdictUpper("refuse"), "после сброса -- дом файла").toBe("REFUSE")
})

test("formVocabRefusal: причина называет и вид, и текущий emits дома", () => {
  try {
    verdictVocabSeed([
      { probe: "form", emits: "PASS|WARN", folds: "WARN" },
      { probe: "*", emits: "OK|WARN|BLOCK|SILENT|NUDGE", folds: "BLOCK" },
    ])
    const why = formVocabRefusal("refuse")
    expect(why, "причина называет вид").toContain('вид "refuse"')
    expect(why, "причина называет emits дома").toContain("PASS|WARN")
    expect(why, "причина не называет несуществующий в доме вид").not.toContain("REFUSE")
  } finally {
    verdictVocabReset()
  }
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

// --- chunkCarriesContent: что считается выдачей (#239, замер #242b) ----------

// CONSTRAINT: предикат решает, РАЗРЕШЁН ЛИ ПЕРЕХОД по лестнице. Ложное «да»
// стоит времени (лишний запрет перехода); ложное «нет» склеивает ответы двух
// ступеней (#224) и портит данные молча. Поэтому зубы закрывают обе стороны,
// и умолчание на неразбираемом входе пинится ЯВНО.
// Формы взяты из замера #242b дословно, не придуманы.

test("chunkCarriesContent: служебный кусок отказа {kind,ref} выдачей НЕ считается", () => {
  expect(chunkCarriesContent({ kind: "engine", ref: 1 })).toBe(false)
  // порядок ключей значения не имеет -- предикат структурный, не позиционный
  expect(chunkCarriesContent({ ref: 11, kind: "engine" })).toBe(false)
})

test("chunkCarriesContent: text и stop -- выдача (обе измеренные формы успеха)", () => {
  expect(chunkCarriesContent({ kind: "text", index: 0, text: "ok", ref: 3 })).toBe(true)
  expect(chunkCarriesContent({
    kind: "stop", stopReason: "end_turn", usage: { input_tokens: 0 }, ref: 6,
  })).toBe(true)
})

test("chunkCarriesContent: неизвестный вид С ПОЛЯМИ -- выдача (алфавит kind измерен не полностью)", () => {
  expect(chunkCarriesContent({ kind: "thinking", thinking: "…", ref: 2 })).toBe(true)
  expect(chunkCarriesContent({ kind: "tool_use", id: "t1", ref: 5 })).toBe(true)
  // вид, которого мы не видели вовсе, но он несёт поле
  expect(chunkCarriesContent({ kind: "whatever-upstream-adds", payload: 1 })).toBe(true)
})

test("chunkCarriesContent: неразбираемый вход -- КОНСЕРВАТИВНО выдача, а не пусто", () => {
  expect(chunkCarriesContent(null)).toBe(true)
  expect(chunkCarriesContent(undefined)).toBe(true)
  expect(chunkCarriesContent("text")).toBe(true)
  expect(chunkCarriesContent(7)).toBe(true)
})

test("chunkCarriesContent: пустой объект полей сверх kind/ref не несёт", () => {
  expect(chunkCarriesContent({})).toBe(false)
  expect(chunkCarriesContent({ kind: "engine" })).toBe(false)
  expect(chunkCarriesContent({ ref: 4 })).toBe(false)
})

test("chunkCarriesContent: одиннадцать служебных кусков отказа дают НОЛЬ выдачи", () => {
  // Дословная форма замера #242b: 503/429/529 -- все одиннадцать {kind,ref}.
  // Это и есть случай, из-за которого веер обнулялся до передачи содержимого.
  const refusal = []
  for (let i = 1; i <= 11; i++) refusal.push({ kind: "engine", ref: i })
  expect(refusal.filter(chunkCarriesContent).length).toBe(0)
  // положительный контроль прибора: успех из того же замера даёт ДВА
  const success = [
    { kind: "engine", ref: 1 },
    { kind: "engine", ref: 2 },
    { kind: "text", index: 0, text: "ok", ref: 3 },
    { kind: "engine", ref: 4 },
    { kind: "engine", ref: 5 },
    { kind: "stop", stopReason: "end_turn", usage: {}, ref: 6 },
    { kind: "engine", ref: 7 },
  ]
  expect(success.filter(chunkCarriesContent).length).toBe(2)
})

// --- MOD_VERSION: константа против манифеста --------------------------------

// CONSTRAINT: манифест .claude-plugin/plugin.json в среде раннера НЕЧИТАЕМ:
// JSON-импорт парсится как JS («Unexpected token ':'»), суффикс ?raw не
// резолвится загрузчиком, node:fs запрещён. Проверка пинит литерал версии из
// манифеста HEAD; сверка константы с САМИМ файлом манифеста живёт вне
// официального харнеса (волна #200, отчёт).
test("MOD_VERSION: пин версии манифеста plugin.json (файл в раннере нечитаем)", () => {
  expect(MOD_VERSION).toBe("0.1.55")
})

// --- COACHING: побайтовый паритет со сплайсом шага 26 --------------------------

// CONSTRAINT: положительный контроль прибора обязателен (ПУСТО != НОЛЬ):
// NIST-вектор гонит однобайтовый путь энкодера, U+2014 -- многобайтовый
// (именно он отличал разошедшиеся дома до волны #116).
test("sha256-прибор: векторы NIST и многобайтовый UTF-8", () => {
  expect(sha256hex("abc"))
    .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  expect(sha256hex("—"))
    .toBe("bda050585a00f0f6cb502350559d75532ae3b244c9498b996e7c5df2d98dfc8d")
})

test("COACHING: побайтовый паритет со сплайсом шага 26 (пин sha256)", () => {
  const got = sha256hex(COACHING)
  if (got !== COACHING_SPLICE_SHA256) {
    throw new Error(
      "COACHING_SPLICE_PARITY: текст правила разошёлся со сплайсом шага 26 " +
      "(tweakcc-patch.js кита): длина=" + COACHING.length + " (пин 400), " +
      "sha256=" + got + ", пин=" + COACHING_SPLICE_SHA256 +
      "; первую расходящуюся позицию называет ступень 2 " +
      "(CATALYST_PATCH_KIT=<путь к киту> tests/scripts/check-splice-parity.sh)")
  }
  expect(COACHING.length).toBe(400)
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

test("failoverLadderBind: явная поклеточная лестница выигрывает у allowed", () => {
  const fo = parseToml(FAILOVER_TOML).failover
  const info = failoverLadderBind(fo, "other-agent", "exec-0p")
  expect(info.ladder).toStrictEqual(["c1", "c2"])
  expect(info.source).toBe("class")
})

test("loadAllowedByClass: оба адреса недоступны -- allowedSrc absent:, без исключения", async () => {
  const $: any = {
    fs: { read: async (p: string) => { throw new Error("ENOENT " + p) } },
  }
  const env = { ROUTING_TABLE: "/no/such/env-table.toml", CONFIG_DIR: "/no-such-config", HOME: "/no-such-home" }
  const got = await loadAllowedByClass($, env)
  expect(got.allowedSrc.indexOf("env:absent")).toBe(0)
  expect(got.allowedByClass).toEqual({})
})

function spawnHook(): any {
  let fn: any = null
  register((ev: string, ...rest: any[]) => {
    if (ev === "agent.spawn") fn = rest.length >= 2 ? rest[1] : rest[0]
    return { catch: () => {} }
  })
  return fn
}

function fsEnv$(files: Record<string, string>, env: Record<string, string>, now: number, envRefuses: string[] = []) {
  hostMemoReset()
  const reads: string[] = []
  const writes: { path: string, text: string }[] = []
  const $: any = {
    clock: { now: async () => now },
    // CONSTRAINT (#393): дверь env ДОЛЖНА уметь БРОСАТЬ -- иначе отказ чтения
    // ручки неотличим от «ручка не закреплена» и дефект неизмерим.
    env: { get: async (k: string) => {
      if (envRefuses.indexOf(k) >= 0) throw new Error("env.get: scripted read refusal for " + k)
      return env[k] || ""
    } },
    fs: {
      read: async (p: string) => {
        reads.push(p)
        if (files[p] === undefined) throw new Error("ENOENT " + p)
        return files[p]
      },
      write: async (p: string, text: string) => {
        writes.push({ path: p, text: String(text) })
      },
    },
    store: { get: async () => "" },
    session: { id: async () => "sid-units" },
  }
  return { $, reads, writes }
}

test("agent.spawn: пустая лестница 1d всё равно кладёт source/allowedSrc в привязку", async () => {
  failoverBindReset()
  const table = "/tbl-1d/routing-table.toml"
  const probes = "/probes-1d/probes.toml"
  const files: Record<string, string> = {
    [probes]: "[failover]\nenabled = true\n",
    [table]: "[classes.1d]\nallowed = [\"glm-5.3\"]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-1d",
    CATALYST_ROUTING_TABLE: table,
  }, 91_000_000)
  const result = await spawnHook()($, {
    subagentType: "any-agent",
    prompt: "[dispatch-class:1d] x",
    model: "glm-5.3",
  }, async () => ({ agentId: "ag-empty-1d" }))
  expect(result.agentId).toBe("ag-empty-1d")
  const bind = failoverBindGet("ag-empty-1d")
  expect(bind && bind.source).toBe("none")
  expect(bind && bind.ladder).toStrictEqual([])
  expect(bind && bind.allowedSrc).toBe("env")
  const shards = writes.filter(w => String(w.path).indexOf("/failover/journal.jsonl.shard.") >= 0)
    .filter(w => String(JSON.parse(String(w.text)).rec).indexOf("terminal-absent-") !== 0)
  expect(shards.length).toBe(1)
  const rec = JSON.parse(String(shards[0].text))
  expect(String(rec.rec).indexOf("empty-ladder")).toBe(0)
  expect(rec.source).toBe("none")
  expect(rec.allowedSrc).toBe("env")
  expect(rec.agentId).toBe("ag-empty-1d")
  expect(rec.class).toBe("1d")
  expect(rec.subagentType).toBe("any-agent")
  expect(rec.sid).toBe("sid-units")
  failoverBindReset()
})

test("agent.spawn: таблица недоступна -- привязка несёт source none и allowedSrc absent:", async () => {
  failoverBindReset()
  const probes = "/probes-abs/probes.toml"
  const files: Record<string, string> = {
    [probes]: "[failover]\nenabled = true\n",
  }
  const { $ } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-abs",
    CLAUDE_CONFIG_DIR: "/no-such-config",
    HOME: "/no-such-home",
  }, 91_006_000)
  const result = await spawnHook()($, {
    subagentType: "any-agent",
    prompt: "[dispatch-class:1a] x",
    model: "glm-5.3",
  }, async () => ({ agentId: "ag-empty-abs" }))
  expect(result.agentId).toBe("ag-empty-abs")
  const bind = failoverBindGet("ag-empty-abs")
  expect(bind && bind.source).toBe("none")
  expect(bind && String(bind.allowedSrc).slice(0, 7)).toBe("absent:")
  failoverBindReset()
})

test("loadWorld: два вызова в окне мемо -- одно чтение файла таблицы", async () => {
  const table = "/tbl-memo/routing-table.toml"
  const probes = "/probes-memo/probes.toml"
  const files: Record<string, string> = {
    [probes]: "[failover]\nenabled = true\n",
    [table]: "[classes.1a]\nallowed = [\"glm-5.3-flash\", \"glm-5.3\"]\n",
  }
  const { $, reads } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-memo",
    CATALYST_ROUTING_TABLE: table,
  }, 92_000_000)
  const env = { PROBES_DIR: "/probes-memo", ROUTING_TABLE: table, CONFIG_DIR: "", HOME: "", PWD: "/work" }
  await loadWorld($, env, env.PWD)
  await loadWorld($, env, env.PWD)
  expect(reads.filter(p => p === table).length).toBe(1)
})

// CONSTRAINT: worldFor -- мемо уровня модуля, раннер держит один процесс на
// файл, поэтому окно часов этого зуба (95_000_000) обязано держаться дальше
// 5000 мс от часов соседей, иначе зуб мерил бы чужое мемо.
// Два `$` моделируют один процесс со сменой рабочего каталога (#308: субагент
// в другом worktree): часы общие, PWD разные.
test("worldFor: смена рабочего каталога внутри окна мемо даёт projectHome вызывающего каталога", async () => {
  const files: Record<string, string> = {
    "/hh/.claude/probes/probes.toml": "[failover]\nenabled = true\n",
    "/wA/.claude/probes/probes.toml": "[failover]\nenabled = true\n",
    "/wB/.claude/probes/probes.toml": "[failover]\nenabled = false\n",
  }
  const a = fsEnv$(files, { HOME: "/hh", PWD: "/wA" }, 95_000_000)
  const b = fsEnv$(files, { HOME: "/hh", PWD: "/wB" }, 95_000_000)
  const wa = await worldFor(a.$)
  const wb = await worldFor(b.$)
  expect(wa.world.projectHome).toBe("/wA/.claude/probes")
  expect(wb.world.projectHome).toBe("/wB/.claude/probes")
  expect(wb.world.cwd).toBe("/wB")
  const wa2 = await worldFor(a.$)
  expect(wa2.world.projectHome).toBe("/wA/.claude/probes")
})

test("worldFor: неопределимый каталог не использует и не заполняет мемо мира", async () => {
  const probesA = "/wA2/.claude/probes/probes.toml"
  const files: Record<string, string> = {
    [probesA]: "[failover]\nenabled = true\n",
  }
  // PWD не задана, store.get отдаёт "" -- каталог неопределим.
  const a = fsEnv$(files, { HOME: "/hh2", PWD: "/wA2" }, 95_100_000)
  const u = fsEnv$(files, { HOME: "/hh2" }, 95_100_000)
  await worldFor(a.$)
  const wu = await worldFor(u.$)
  expect(wu.world.projectHome).toBe("")
  expect(wu.world.cwd).toBe("")
  // Неопределимый вызов не перезаписал мемо: повтор из известного каталога в
  // том же окне обязан попасть в кэш -- мир A загружен ОДИН раз (два чтения
  // probes-файла на загрузку: layerHit в findProjectHome + чтение проекта).
  await worldFor(a.$)
  expect(a.reads.concat(u.reads).filter(p => p === probesA).length).toBe(2)
})

// --- #495: мемо окружения при неизвестном каталоге -----------------------------
//
// CONSTRAINT: счётчик чтений CLAUDE_JUDGE_CARRIER -- счётчик вызовов envBundle:
// это имя читает только он. Каталог неизвестен, потому что PWD бросает, а
// store.get отдаёт "". Мемо окружения -- состояние модуля и ключуется лишь
// временем и эпохой, поэтому каждый зуб начинает с clear393 (новая эпоха), а
// часы 495_xxx_xxx не пересекаются с часами соседей. Окно 5000 мс --
// register.ts WORLD_MEMO_MS.
function env495$(files: Record<string, string>, env: Record<string, string>, refuse: string[], clock: { now: number }) {
  hostMemoReset()
  const count = { carrier: 0 }
  const $: any = {
    clock: { now: async () => clock.now },
    env: { get: async (k: string) => {
      if (k === "CLAUDE_JUDGE_CARRIER") count.carrier++
      if (refuse.indexOf(k) >= 0) throw new Error("env.get: scripted read refusal for " + k)
      return env[k] || ""
    } },
    fs: {
      read: async (p: string) => {
        if (files[p] === undefined) throw new Error("ENOENT " + p)
        return files[p]
      },
      write: async () => {},
    },
    store: { get: async () => "" },
    session: { id: async () => "sid-495" },
  }
  return { $, count, env, refuse }
}

test("#495 Z495-a worldFor: неизвестный каталог -- второй вызов в окне берёт окружение из мемо", async () => {
  await drainFold393()
  await clear393()
  const clock = { now: 495_000_000 }
  const f = env495$({ "/probes-495a/probes.toml": "[failover]\nenabled = true\n" },
    { CLAUDE_PROBES_DIR: "/probes-495a" }, ["PWD"], clock)
  const w1 = await worldFor(f.$)
  clock.now += 1000
  const w2 = await worldFor(f.$)
  expect(w1.cwd, "каталог неизвестен").toBe("")
  expect(w2.cwd, "каталог неизвестен").toBe("")
  expect(f.count.carrier, "envBundle отработал один раз на два вызова в окне").toBe(1)
  expect(lostN393("env-unreadable:PWD"), "нечитаемая PWD названа один раз на два вызова в окне").toBe(1)
  // Известный каталог идёт мимо мемо окружения: окружение читается заново.
  f.refuse.length = 0
  f.env.PWD = "/work-495a"
  clock.now += 1000
  const w3 = await worldFor(f.$)
  expect(w3.cwd).toBe("/work-495a")
  expect(f.count.carrier, "ветка известного каталога не берёт мемо окружения").toBe(2)
})

test("#495 Z495-b worldFor: неизвестный каталог -- вызов после окна читает окружение заново", async () => {
  await clear393()
  const clock = { now: 495_100_000 }
  const f = env495$({ "/probes-495b/probes.toml": "[failover]\nenabled = true\n" },
    { CLAUDE_PROBES_DIR: "/probes-495b" }, ["PWD"], clock)
  await worldFor(f.$)
  clock.now += 1000
  await worldFor(f.$)
  clock.now = 495_100_000 + 5000
  await worldFor(f.$)
  expect(f.count.carrier, "третий вызов на границе окна -- новое чтение окружения").toBe(2)
})

test("#495 Z495-c worldFor: неизвестный каталог -- смена эпохи сбрасывает мемо окружения", async () => {
  await clear393()
  const clock = { now: 495_200_000 }
  const f = env495$({ "/probes-495c/probes.toml": "[failover]\nenabled = true\n" },
    { CLAUDE_PROBES_DIR: "/probes-495c" }, ["PWD"], clock)
  await worldFor(f.$)
  await clear393(f)
  clock.now += 1000
  await worldFor(f.$)
  expect(f.count.carrier, "после смены эпохи окружение читается заново").toBe(2)
})

test("#495 Z495-e worldFor: смена эпохи в полёте запрещает запись envMemo", async () => {
  await clear393()
  const clock = { now: 495_250_000 }
  const f = env495$({}, {}, ["PWD"], clock)
  let entered!: () => void
  let release!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  const parked = new Promise<void>(resolve => { release = resolve })
  const get = f.$.env.get
  let held = false
  f.$.env.get = async (name: string) => {
    if (name === "CLAUDE_JUDGE_CARRIER" && !held) {
      held = true
      entered()
      await parked
    }
    return get(name)
  }
  const pending = worldFor(f.$)
  await waiting
  expect(f.count.carrier, "первое чтение окружения ещё висит").toBe(0)
  await clear393(f)
  release()
  expect((await pending).cwd, "старый вызов вернул мир неизвестного каталога").toBe("")
  expect(f.count.carrier).toBe(1)
  clock.now++
  await worldFor(f.$)
  expect(f.count.carrier, "новая эпоха не берёт мемо старого вызова").toBe(2)
  await worldFor(f.$)
  expect(f.count.carrier, "мемо новой эпохи попадает на тех же часах").toBe(2)
})

test("#495 Z495-d worldFor: неизвестный каталог -- мир не мемоизирован, правка probes.toml видна в окне (#308)", async () => {
  await clear393()
  const clock = { now: 495_300_000 }
  const files: Record<string, string> = { "/probes-495d/probes.toml": "[failover]\nenabled = true\n" }
  const f = env495$(files, { CLAUDE_PROBES_DIR: "/probes-495d" }, ["PWD"], clock)
  const w1 = await worldFor(f.$)
  expect(w1.cwd).toBe("")
  expect(w1.world.failover.enabled).toBe(true)
  files["/probes-495d/probes.toml"] = "[failover]\nenabled = false\n"
  clock.now += 1000
  const w2 = await worldFor(f.$)
  expect(w2.world.failover.enabled, "второй вызов в окне видит новое содержимое probes.toml").toBe(false)
})

test("#495 AR2-env: откат часов промахивается мимо envMemo, равные часы попадают", async () => {
  await clear393()
  const clock = { now: 495_400_000 }
  const f = env495$({}, {}, ["PWD"], clock)
  await worldFor(f.$)
  await worldFor(f.$)
  expect(f.count.carrier, "now === t берёт окружение из мемо").toBe(1)
  clock.now--
  await worldFor(f.$)
  expect(f.count.carrier, "now === t - 1 читает окружение заново").toBe(2)
})

test("#495 AR2-world: откат часов промахивается мимо worldMemo, равные часы попадают", async () => {
  await clear393()
  const clock = { now: 495_500_000 }
  const f = env495$({}, { PWD: "/work-495-ar2-world" }, [], clock)
  const first = await worldFor(f.$)
  expect(await worldFor(f.$), "now === t берёт тот же мир из мемо").toBe(first)
  expect(f.count.carrier).toBe(1)
  clock.now--
  const back = await worldFor(f.$)
  expect(back.t, "now === t - 1 собирает новый мир").toBe(clock.now)
  expect(f.count.carrier).toBe(2)
})

test("#495 AR2-allowed: откат часов промахивается мимо allowedMemo, равные часы попадают", async () => {
  await clear393()
  const clock = { now: 495_600_000 }
  const table = "/tbl-495-ar2/routing-table.toml"
  const files = { [table]: '[classes.1a]\nallowed = ["before495"]\n' }
  const f = env495$(files, {}, [], clock)
  const env = { ROUTING_TABLE: table, CONFIG_DIR: "", HOME: "", PWD: "/work-495-ar2-allowed" }
  const first = await loadAllowedByClass(f.$, env, env.PWD)
  expect(first.allowedByClass["1a"]).toEqual(["before495"])
  files[table] = '[classes.1a]\nallowed = ["after495"]\n'
  expect(await loadAllowedByClass(f.$, env, env.PWD), "now === t берёт тот же допуск из мемо").toBe(first)
  clock.now--
  const back = await loadAllowedByClass(f.$, env, env.PWD)
  expect(back.allowedByClass["1a"], "now === t - 1 читает новый допуск").toEqual(["after495"])
})

test("#495 Z495-f hostMemoReset: новый хост промахивается во всех трёх мемо внутри окна", async () => {
  const clock = { now: 495_700_000 }
  const cwd = "/work-495-host-reset"
  const table = "/tbl-495-host-reset/routing-table.toml"
  const files = { [table]: '[classes.1a]\nallowed = ["host495"]\n' }
  const a = env495$(files, {}, [], clock)
  const b = env495$(files, {}, [], clock)
  const tableReads = { a: 0, b: 0 }
  for (const [name, host] of [["a", a], ["b", b]] as const) {
    const read = host.$.fs.read
    host.$.fs.read = async (path: string) => {
      if (path === table) tableReads[name]++
      return read(path)
    }
  }
  const allowedEnv = { ROUTING_TABLE: table, CONFIG_DIR: "", HOME: "", PWD: cwd }
  // CONSTRAINT: оба конструктора сбрасывают мемо, поэтому оба хоста созданы
  // ДО наполнения; после наполнения A единственная граница хоста -- дверь ниже.
  await worldFor(a.$)
  await worldFor(a.$)
  expect(a.count.carrier, "A попадает в envMemo на тех же часах").toBe(1)
  a.env.PWD = cwd
  await worldFor(a.$)
  await worldFor(a.$)
  expect(a.count.carrier, "A попадает в worldMemo на тех же часах").toBe(2)
  await loadAllowedByClass(a.$, allowedEnv, cwd)
  await loadAllowedByClass(a.$, allowedEnv, cwd)
  expect(tableReads.a, "A попадает в allowedMemo на тех же часах").toBe(1)

  hostMemoReset()

  // CONSTRAINT: допуск проверяется первым -- loadWorld иначе сменит ключ
  // allowedMemo и скроет отсутствие его сброса дверью.
  await loadAllowedByClass(b.$, allowedEnv, cwd)
  expect(tableReads.b, "B читает таблицу после сброса allowedMemo").toBe(1)
  await worldFor(b.$)
  expect(b.count.carrier, "B читает окружение после сброса envMemo").toBe(1)
  b.env.PWD = cwd
  await worldFor(b.$)
  expect(b.count.carrier, "B читает окружение после сброса worldMemo").toBe(2)
})

test("loadAllowedByClass: битая env-таблица не выигрывает, цепочка env:unusable→marketplace", async () => {
  const envPath = "/tbl-bad/routing-table.toml"
  const market = "/cfg-ok/plugins/marketplaces/catalyst/hooks/routing-table.toml"
  const files: Record<string, string> = {
    [envPath]: "[classes.1a]\nallowed = [\"glm-5.3\",\n",
    [market]: "[classes.1a]\nallowed = [\"glm-5.3-flash\", \"glm-5.3\", \"grok-4.6\"]\n",
  }
  const { $ } = fsEnv$(files, {}, 93_000_000)
  const got = await loadAllowedByClass($, {
    ROUTING_TABLE: envPath,
    CONFIG_DIR: "/cfg-ok",
    HOME: "",
  })
  expect(got.allowedSrc).toBe("env:unusable→marketplace")
  expect(got.allowedByClass["1a"]).toStrictEqual(["glm-5.3-flash", "glm-5.3", "grok-4.6"])
})

test("loadAllowedByClass: заданный env-путь без файла -- env:absent в цепочке", async () => {
  const envPath = "/tbl-gone/routing-table.toml"
  const market = "/cfg-ok2/plugins/marketplaces/catalyst/hooks/routing-table.toml"
  const files: Record<string, string> = {
    [market]: "[classes.1a]\nallowed = [\"glm-5.3-flash\", \"glm-5.3\"]\n",
  }
  const { $ } = fsEnv$(files, {}, 93_100_000)
  const got = await loadAllowedByClass($, {
    ROUTING_TABLE: envPath,
    CONFIG_DIR: "/cfg-ok2",
    HOME: "",
  })
  expect(got.allowedSrc).toBe("env:absent→marketplace")
  expect(got.allowedByClass["1a"]).toStrictEqual(["glm-5.3-flash", "glm-5.3"])
})

test("loadAllowedByClass: env без классов -- env:noclasses, marketplace выигрывает", async () => {
  const envPath = "/tbl-noclass/routing-table.toml"
  const market = "/cfg-ok3/plugins/marketplaces/catalyst/hooks/routing-table.toml"
  const files: Record<string, string> = {
    [envPath]: "# truncated before any [classes.*]\n",
    [market]: "[classes.1a]\nallowed = [\"glm-5.3\", \"grok-4.6\"]\n",
  }
  const { $ } = fsEnv$(files, {}, 93_200_000)
  const got = await loadAllowedByClass($, {
    ROUTING_TABLE: envPath,
    CONFIG_DIR: "/cfg-ok3",
    HOME: "",
  })
  expect(got.allowedSrc).toBe("env:noclasses→marketplace")
  expect(got.allowedByClass["1a"]).toStrictEqual(["glm-5.3", "grok-4.6"])
})

test("loadAllowedByClass: битое allowed и отсутствие классов -- разные причины", async () => {
  const envBad = "/tbl-kind-bad/routing-table.toml"
  const envEmpty = "/tbl-kind-empty/routing-table.toml"
  const market = "/cfg-kind/plugins/marketplaces/catalyst/hooks/routing-table.toml"
  const files: Record<string, string> = {
    [envBad]: "[classes.1a]\nallowed = [\"glm-5.3\",\n",
    [envEmpty]: "# no classes\n",
    [market]: "[classes.1a]\nallowed = [\"x\"]\n",
  }
  const { $ } = fsEnv$(files, {}, 93_300_000)
  const bad = await loadAllowedByClass($, { ROUTING_TABLE: envBad, CONFIG_DIR: "/cfg-kind", HOME: "" })
  const empty = await loadAllowedByClass($, { ROUTING_TABLE: envEmpty, CONFIG_DIR: "/cfg-kind", HOME: "" })
  expect(bad.allowedSrc).toBe("env:unusable→marketplace")
  expect(empty.allowedSrc).toBe("env:noclasses→marketplace")
  expect(bad.allowedSrc).not.toBe(empty.allowedSrc)
})

test("tool.call: два вызова в окне мемо -- одно чтение probes.toml", async () => {
  const probes = "/probes-wmemo/probes.toml"
  const table = "/tbl-wmemo/routing-table.toml"
  const files: Record<string, string> = {
    [probes]: "[failover]\nenabled = true\n",
    [table]: "[classes.1a]\nallowed = [\"glm-5.3\"]\n",
  }
  const { $, reads } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-wmemo",
    CATALYST_ROUTING_TABLE: table,
    // Мемо мира ключуется рабочим каталогом (#308): без каталога мир не
    // мемоится вовсе, и предмет этого зуба (окно мемо) исчезает.
    PWD: "/work-wmemo",
  }, 96_000_000)
  $.agent = { list: async () => [] }
  let hook: any = null
  register((ev: string, ...rest: any[]) => {
    if (ev === "tool.call") hook = rest.length >= 2 ? rest[1] : rest[0]
    return { catch: () => {} }
  })
  const next = async (e: any) => e
  await hook($, { tool: "Read" }, next)
  await hook($, { tool: "Read" }, next)
  expect(reads.filter(p => p === probes).length).toBe(1)
})

// --- #335: чужой носитель -- громкий отказ --------------------------------------
//
// CONSTRAINT: зубы секции идут через живой tool.call, а не через экспорт
// внутренней функции: предмет -- поведение сайта вызова (дедуп журнала при
// бездедупном отказе), которого прямой вызов вооружения не касался бы. У
// каждого зуба свой PWD и свой домашний каталог: мемо мира и модульный дедуп
// не переносят состояние между зубами; значения чужих ручек уникальны по той
// же причине -- дедуп журнала ключуется парой «проба x значение ручки».

function carrierHook335(): () => any {
  let hook: any = null
  register((ev: string, ...rest: any[]) => {
    if (ev === "tool.call") hook = rest.length >= 2 ? rest[1] : rest[0]
    return { catch: () => {} }
  })
  return () => hook
}

// CONSTRAINT (#391): carrierHook335 обработчик отказа выбрасывает, поэтому
// текст fail-closed им НЕ проверяем. Здесь он перехватывается -- иначе правка
// текста отказа осталась бы без зуба вовсе.
function failClosedHandler391(): any {
  let handler: any = null
  register((ev: string, ...rest: any[]) => {
    return { catch: (h: any) => { if (ev === "tool.call") handler = h } }
  })
  return handler
}

function carrierRefusals335(writes: { path: string, text: string }[]): any[] {
  return writes
    .filter(w => String(w.path).indexOf("/failover/journal.jsonl.shard.") >= 0)
    .map(w => { try { return JSON.parse(String(w.text)) } catch (x) { return null } })
    .filter(r => r && r.rec === "carrier-foreign-refused")
}

function judgeSkips391(writes: { path: string, text: string }[]): any[] {
  return writes
    .filter(w => String(w.path).indexOf("/judge/journal.jsonl.shard.") >= 0)
    .map(w => { try { return JSON.parse(String(w.text)) } catch (x) { return null } })
    .filter(r => r && r.outcome === "skip")
}

// Минимальный годный конфиг форм-пробы: все поля FORM_REQ непусты, ни один
// образец не совпадает с предметными событиями зубов -- форма прогоняется,
// но вердикт всегда pass. Без этого набора runForm молча выходит до улики.
const FORM_CFG_335 = [
  "[probe.form]",
  "path_lines_min = 1",
  'brief_path = "^zzz-brief-path"',
  'brief_ref = "zzz-brief-ref"',
  'brief_head = "^zzz-brief-head"',
  'brief_tail = "zzz-brief-tail"',
  'report_path = "report[.]md$"',
  'fence = "^```"',
  'arm_line = "^zzz-arm-line"',
  'arm_ellipsis = "[$][$][$]"',
  'arm_cmd = "^zzz-arm-cmd"',
  'arm_remote = "zzz-arm-remote"',
  'arm_log = "zzz-arm-log"',
  'witness_remote = "zzz-witness-remote"',
  'witness_worker = "zzz-witness-worker"',
  'open_door = "zzz-open-door"',
  'negation = "zzz-negation"',
  'rule_line = "zzz-rule-line"',
  'path_line = "^zzz-path-line"',
  'decision_head = "^zzz-decision-head"',
  'decision_basis = "zzz-decision-basis"',
  'decision_referent = "zzz-decision-referent"',
  'legalize = "zzz-legalize"',
  'git_commit = "zzz-git-commit"',
  'git_commit_ok = "zzz-git-commit-ok"',
  'git_push = "zzz-git-push"',
  'git_push_ok = "zzz-git-push-ok"',
  'git_force = "zzz-git-force"',
  'trailer_a = "zzz-trailer-a"',
  'trailer_b = "zzz-trailer-b"',
  'write_target = "zzz-write-redirect"',
  'heredoc = "zzz-heredoc"',
].join("\n") + "\n"

test("#335 judge: включена, носитель НЕ задан -- вооружена (пустая ручка = мод)", async () => {
  // Наблюдаемая обязана жить ПОСЛЕ точки отказа чужого носителя (за
  // выключателем enabled): skip по classes_judge пишется только вооружённой
  // пробе -- чужой носитель погасил бы диспатч раньше этой записи.
  const files: Record<string, string> = {
    "/probes-335-j1/probes.toml": "[probe.judge]\n[probe.judge.filter]\nclasses_judge = [\"exec-*\"]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-j1",
    CLAUDE_JUDGE: "1",
    PWD: "/work-335-j1",
  }, 97_000_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(out.deny, "вооружённая проба диспатч не гасит").toBe(undefined)
  // Свидетель вооружённости: включённый judge без маркера класса при
  // выстреле (Agent) пишет skip (no_class_marker); невооружённая или
  // задержанная чужим носителем проба записи не оставляет.
  expect(writes.filter(w => String(w.path).indexOf("/judge/journal.jsonl.shard.") >= 0).length).toBe(1)
})

test("#335 judge: включена, носитель patch -- громкий отказ, значение ручки в исходе = patch", async () => {
  const files: Record<string, string> = {
    "/probes-335-j2/probes.toml": "[probe.judge]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-j2",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch",
    PWD: "/work-335-j2",
  }, 97_001_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(String(out.deny)).toContain("judge")
  expect(String(out.deny)).toContain("CLAUDE_JUDGE_CARRIER")
  expect(String(out.deny)).toContain("patch")
  const shards = carrierRefusals335(writes)
  expect(shards.length, "ровно одна запись carrier-foreign-refused").toBe(1)
  expect(shards[0].probe).toBe("judge")
  expect(shards[0].handle).toBe("CLAUDE_JUDGE_CARRIER")
  expect(shards[0].value).toBe("patch")
})

test("#335 judge: ВЫКЛЮЧЕНА, носитель patch -- тихо: ни отказа, ни записи (выключатель старше носителя)", async () => {
  const files: Record<string, string> = {
    "/probes-335-j3/probes.toml": "[probe.judge]\nenabled = false\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-j3",
    CLAUDE_JUDGE: "0",
    CLAUDE_JUDGE_CARRIER: "patch",
    PWD: "/work-335-j3",
  }, 97_002_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(out.deny, "выключенная проба молчит и при чужой ручке").toBe(undefined)
  expect(carrierRefusals335(writes).length).toBe(0)
  expect(writes.filter(w => String(w.path).indexOf("/judge/journal.jsonl.shard.") >= 0).length).toBe(0)
})

test("#335 form: включена, носитель НЕ задан -- вооружена", async () => {
  const files: Record<string, string> = {
    "/probes-335-f1/probes.toml": FORM_CFG_335,
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-f1",
    CLAUDE_FORM: "1",
    PWD: "/work-335-f1",
  }, 97_003_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Write", file_path: "/work-335-f1/report.md", content: "заголовок\nтело отчёта\n" }, async (e: any) => e)
  expect(out.deny, "проходная форма диспатч не гасит").toBe(undefined)
  // Свидетель вооружённости: form-проба прогоняет Write через runForm и
  // пишет вердикт в form/journal.jsonl; невооружённая записи не оставляет.
  expect(writes.filter(w => String(w.path).indexOf("/form/journal.jsonl.shard.") >= 0).length).toBe(1)
})

test("#391 D2: fail-closed несёт ПРИЧИНУ броска, не только факт", async () => {
  const h = failClosedHandler391()
  expect(typeof h, "обработчик отказа tool.call зарегистрирован").toBe("function")
  const out = await h({}, { tool: "Write" }, {
    called: false,
    error: new Error("негодный образец конфига форм (report_path): report[.]md$("),
  })
  expect(String(out && out.deny), "fail-closed не ослаблен").toContain("Fail-closed")
  expect(String(out && out.deny), "причина названа").toContain("report_path")
  const timed = await h({}, { tool: "Write" }, { called: false, error: { kind: "timeout" } })
  expect(String(timed && timed.deny), "молчание по времени -- по-прежнему своя ветка").toContain("timeout")
})

test("#391 D: бросок на негодном образце конфига форм НАЗЫВАЕТ поле", async () => {
  // Fail-closed выше по стеку верен и НЕ меняется -- проверяется ровно то,
  // что текст броска называет поле конфига, а не только факт отказа.
  const files: Record<string, string> = {
    "/probes-391-d/probes.toml": FORM_CFG_335.replace(
      'report_path = "report[.]md$"', 'report_path = "report[.]md$("'),
  }
  const { $ } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-391-d",
    CLAUDE_FORM: "1",
    PWD: "/work-391-d",
  }, 97_043_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  let thrown = ""
  try {
    await hook()($, { tool: "Write", file_path: "/work-391-d/report.md", content: "тело\n" }, async (e: any) => e)
  } catch (x) { thrown = String(x) }
  expect(thrown, "отказ называет ИМЯ поля конфига").toContain("report_path")
  expect(thrown, "и сам негодный образец").toContain("report[.]md$(")
})

test("#335 form: включена, носитель patch -- громкий отказ, значение ручки в исходе = patch", async () => {
  const files: Record<string, string> = {
    "/probes-335-f2/probes.toml": "[probe.form]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-f2",
    CLAUDE_FORM: "1",
    CLAUDE_FORM_CARRIER: "patch",
    PWD: "/work-335-f2",
  }, 97_004_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Write", file_path: "/work-335-f2/report.md", content: "тело отчёта\n" }, async (e: any) => e)
  expect(String(out.deny)).toContain("form")
  expect(String(out.deny)).toContain("CLAUDE_FORM_CARRIER")
  expect(String(out.deny)).toContain("patch")
  const shards = carrierRefusals335(writes)
  expect(shards.length).toBe(1)
  expect(shards[0].probe).toBe("form")
  expect(shards[0].handle).toBe("CLAUDE_FORM_CARRIER")
  expect(shards[0].value).toBe("patch")
})

test("#335 form: ВЫКЛЮЧЕНА (formOn), носитель patch -- тихо: ни отказа, ни записи", async () => {
  const files: Record<string, string> = {
    "/probes-335-f3/probes.toml": FORM_CFG_335,
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-f3",
    CLAUDE_FORM: "0",
    CLAUDE_FORM_CARRIER: "patch",
    PWD: "/work-335-f3",
  }, 97_005_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Write", file_path: "/work-335-f3/report.md", content: "заголовок\nтело отчёта\n" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(carrierRefusals335(writes).length).toBe(0)
  expect(writes.filter(w => String(w.path).indexOf("/form/journal.jsonl.shard.") >= 0).length).toBe(0)
})

test("#335 idle-watch: включена, носитель НЕ задан -- вооружена", async () => {
  const files: Record<string, string> = {
    "/probes-335-i1/probes.toml": "[probe.idle-watch]\nact = \"log_only\"\nwindow_min = 0\n",
  }
  const { $ } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-i1",
    CLAUDE_IDLE: "1",
    PWD: "/work-335-i1",
  }, 97_006_000)
  $.agent = { list: async () => [] }
  const storeSets: string[] = []
  $.store = { get: async () => "", set: async (k: string, _v: any) => { storeSets.push(String(k)) } }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Read" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  // Свидетель вооружённости: выстрел log_only ставит cap- и last-ключи ДО
  // запуска фонового канала; невооружённая проба стора не касается вовсе.
  expect(storeSets.length).toBe(2)
})

test("#335 idle-watch: включена, носитель patch -- громкий отказ, значение ручки в исходе = patch", async () => {
  const files: Record<string, string> = {
    "/probes-335-i2/probes.toml": "[probe.idle-watch]\nact = \"log_only\"\nwindow_min = 0\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-i2",
    CLAUDE_IDLE: "1",
    CLAUDE_IDLE_CARRIER: "patch",
    PWD: "/work-335-i2",
  }, 97_007_000)
  $.agent = { list: async () => [] }
  const storeSets: string[] = []
  $.store = { get: async () => "", set: async (k: string, _v: any) => { storeSets.push(String(k)) } }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Read" }, async (e: any) => e)
  expect(String(out.deny)).toContain("idle-watch")
  expect(String(out.deny)).toContain("CLAUDE_IDLE_CARRIER")
  expect(String(out.deny)).toContain("patch")
  const shards = carrierRefusals335(writes)
  expect(shards.length).toBe(1)
  expect(shards[0].probe).toBe("idle-watch")
  expect(shards[0].handle).toBe("CLAUDE_IDLE_CARRIER")
  expect(shards[0].value).toBe("patch")
  expect(storeSets.length, "до тела пробы дело не доходит").toBe(0)
})

test("#335 idle-watch: ВЫКЛЮЧЕНА, носитель patch -- тихо: ни отказа, ни записи, ни выстрела", async () => {
  const files: Record<string, string> = {
    "/probes-335-i3/probes.toml": "[probe.idle-watch]\nact = \"log_only\"\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-i3",
    CLAUDE_IDLE: "0",
    CLAUDE_IDLE_CARRIER: "patch",
    PWD: "/work-335-i3",
  }, 97_008_000)
  $.agent = { list: async () => [] }
  const storeSets: string[] = []
  $.store = { get: async () => "", set: async (k: string, _v: any) => { storeSets.push(String(k)) } }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Read" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(carrierRefusals335(writes).length).toBe(0)
  expect(storeSets.length).toBe(0)
})

test("#335 дедуп журнала: два диспатча с чужим носителем -- ОДНА запись carrier-foreign-refused", async () => {
  const files: Record<string, string> = {
    "/probes-335-d10/probes.toml": "[probe.judge]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-d10",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-dedup-10",
    PWD: "/work-335-d10",
  }, 97_009_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out1 = await hook()($, { tool: "Agent", prompt: "a" }, async (e: any) => e)
  const out2 = await hook()($, { tool: "Task", prompt: "b" }, async (e: any) => e)
  expect(String(out1.deny)).toContain("patch-dedup-10")
  expect(String(out2.deny)).toContain("patch-dedup-10")
  expect(carrierRefusals335(writes).length, "журнал -- однократно на процесс").toBe(1)
})

test("#335 отказ БЕЗ дедупа: второй диспатч с чужим носителем гасится так же, как первый", async () => {
  const files: Record<string, string> = {
    "/probes-335-d11/probes.toml": "[probe.judge]\n",
  }
  const { $ } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-d11",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-dedup-11",
    PWD: "/work-335-d11",
  }, 97_010_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out1 = await hook()($, { tool: "Agent", prompt: "a" }, async (e: any) => e)
  const out2 = await hook()($, { tool: "Task", prompt: "b" }, async (e: any) => e)
  expect(String(out1.deny)).toContain("patch-dedup-11")
  expect(String(out2.deny), "дедуп журнала НЕ распространяется на отказ").toContain("patch-dedup-11")
})

test("#335 нормализация носителя: \"  MOD  \" / \"MOD\" / \"mod \" / \" \" -- вооружена", async () => {
  const hook = carrierHook335()
  for (const carrier of ["  MOD  ", "MOD", "mod ", " "]) {
    const tag = carrier.trim() || "spaces"
    const files: Record<string, string> = {
      ["/probes-335-t12-" + tag + "/probes.toml"]: "[probe.judge]\n[probe.judge.filter]\nclasses_judge = [\"exec-*\"]\n",
    }
    const { $, writes } = fsEnv$(files, {
      CLAUDE_PROBES_DIR: "/probes-335-t12-" + tag,
      CLAUDE_JUDGE: "1",
      CLAUDE_JUDGE_CARRIER: carrier,
      PWD: "/work-335-t12-" + tag,
    }, 97_011_000)
    $.agent = { list: async () => [] }
    const out = await hook()($, { tool: "Agent", prompt: "x" }, async (e: any) => e)
    expect(out.deny, JSON.stringify(carrier) + " после trim+toLowerCase -- это мод (пустое = мод)").toBe(undefined)
    expect(writes.filter(w => String(w.path).indexOf("/judge/journal.jsonl.shard.") >= 0).length).toBe(1)
    expect(carrierRefusals335(writes).length).toBe(0)
  }
})

test("#335 отказ живёт без улики: appendJournal бросает -- диспатч всё равно гасится", async () => {
  const files: Record<string, string> = {
    "/probes-335-e14/probes.toml": "[probe.judge]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-e14",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-err-14",
    PWD: "/work-335-e14",
  }, 97_013_000)
  $.agent = { list: async () => [] }
  const origWrite = $.fs.write
  $.fs.write = async (p: string, t: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) throw new Error("EIO")
    return origWrite(p, t)
  }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(String(out.deny), "запись -- улика, отказ -- механизм: механизм живёт").toContain("patch-err-14")
  expect(carrierRefusals335(writes).length, "улика не легла -- и не должна была").toBe(0)
})

test("#335 область: чужой носитель судьи + Read (не Agent/Task) -- вызов проходит, ни отказа, ни записи", async () => {
  const files: Record<string, string> = {
    "/probes-335-n1/probes.toml": "[probe.judge]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-n1",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-scope-n1",
    PWD: "/work-335-n1",
  }, 97_020_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Read", file_path: "/work-335-n1/notes.txt" }, async (e: any) => e)
  expect(out.deny, "судья действует только на Agent/Task -- вне их отказа быть не может").toBe(undefined)
  expect(out.file_path, "вызов прошёл насквозь").toBe("/work-335-n1/notes.txt")
  expect(carrierRefusals335(writes).length).toBe(0)
})

test("#335 область: чужой носитель судьи + вызов из субагента (agentId) -- отказа нет", async () => {
  const files: Record<string, string> = {
    "/probes-335-n2/probes.toml": "[probe.judge]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-n2",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-scope-n2",
    PWD: "/work-335-n2",
  }, 97_021_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "x", agentId: "ag-335-n2" }, async (e: any) => e)
  expect(out.deny, "событие субагента не доходит до проб вовсе").toBe(undefined)
  expect(carrierRefusals335(writes).length).toBe(0)
})

test("#335 область: чужой носитель + проба выключена конфигурацией (enabled=false) -- тихо", async () => {
  const files: Record<string, string> = {
    "/probes-335-n4/probes.toml": "[probe.judge]\nenabled = false\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-n4",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-scope-n4",
    PWD: "/work-335-n4",
  }, 97_022_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(out.deny, "конфигурационно выключенная проба -- тот же класс, что выключатель ручкой").toBe(undefined)
  expect(carrierRefusals335(writes).length).toBe(0)
  // skip_disabled пишется как у вооружённой выключенной: решение о носителе
  // приходит ПОСЛЕ конфигурационного выключателя.
  expect(writes.filter(w => String(w.path).indexOf("/judge/journal.jsonl.shard.") >= 0).length).toBe(1)
})

test("#335 область-регресс: вооружённая боевая конфигурация на Write -- форма действует, порядок как до волны", async () => {
  const files: Record<string, string> = {
    "/probes-335-n5/probes.toml":
      "[probe.judge]\nenabled = false\n" + FORM_CFG_335 + "[probe.idle-watch]\nenabled = false\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-n5",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "mod",
    CLAUDE_FORM: "1",
    CLAUDE_FORM_CARRIER: "mod",
    CLAUDE_IDLE: "1",
    CLAUDE_IDLE_CARRIER: "mod",
    CLAUDE_PROBES: "1",
    PWD: "/work-335-n5",
  }, 97_023_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Write", file_path: "/work-335-n5/report.md", content: "заголовок\nтело\n" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(writes.filter(w => String(w.path).indexOf("/form/journal.jsonl.shard.") >= 0).length, "живая форма вынесла вердикт").toBe(1)
  expect(writes.filter(w => String(w.path).indexOf("/judge/journal.jsonl.shard.") >= 0).length, "судья на Write не действует").toBe(0)
  expect(carrierRefusals335(writes).length).toBe(0)
})

test("#335 область: чужой носитель формы + Read -- вызов проходит (форма не действует на Read)", async () => {
  const files: Record<string, string> = {
    "/probes-335-n6/probes.toml": "[probe.form]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-n6",
    CLAUDE_FORM: "1",
    CLAUDE_FORM_CARRIER: "patch-scope-n6",
    PWD: "/work-335-n6",
  }, 97_024_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Read", file_path: "/work-335-n6/notes.txt" }, async (e: any) => e)
  expect(out.deny, "форма действует на Write/Edit/Bash/Agent/Task/SendMessage -- Read не её точка действия").toBe(undefined)
  expect(out.file_path, "вызов прошёл насквозь").toBe("/work-335-n6/notes.txt")
  expect(carrierRefusals335(writes).length).toBe(0)
})

test("#335 граница судьи: чужой носитель + classes_skip -- вызов ПРОХОДИТ", async () => {
  const files: Record<string, string> = {
    "/probes-335-c1/probes.toml": "[probe.judge]\n[probe.judge.filter]\nclasses_skip = [\"skip-me\"]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-c1",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-c1",
    PWD: "/work-335-c1",
  }, 97_030_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "[dispatch-class:skip-me] работа" }, async (e: any) => e)
  expect(out.deny, "вооружённый судья пропустил бы этот диспатч молча -- отказ вне границы действия").toBe(undefined)
  expect(carrierRefusals335(writes).length).toBe(0)
})

test("#335 граница судьи: чужой носитель + agents_skip -- вызов ПРОХОДИТ", async () => {
  const files: Record<string, string> = {
    "/probes-335-c2/probes.toml": "[probe.judge]\n[probe.judge.filter]\nagents_skip = [\"scout-x1\"]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-c2",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-c2",
    PWD: "/work-335-c2",
  }, 97_031_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", subagent_type: "scout-x1", prompt: "без маркера класса" }, async (e: any) => e)
  expect(out.deny, "пропуск по агенту -- та же граница действия, что и по классу").toBe(undefined)
  expect(carrierRefusals335(writes).length).toBe(0)
})

test("#335 граница судьи: чужой носитель + класс вне judge-списка (not_in_judge_list) -- вызов ПРОХОДИТ", async () => {
  const files: Record<string, string> = {
    "/probes-335-c3/probes.toml": "[probe.judge]\n[probe.judge.filter]\nclasses_judge = [\"exec-*\"]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-c3",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-c3",
    PWD: "/work-335-c3",
  }, 97_032_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "[dispatch-class:crit-mech] работа" }, async (e: any) => e)
  expect(out.deny, "судья, чьи judge-списки не берут этот класс, не действовал бы -- и не гасит").toBe(undefined)
  expect(carrierRefusals335(writes).length).toBe(0)
})

test("#335 граница судьи: чужой носитель + нет маркера класса при judge-списках (no_class_marker) -- вызов ПРОХОДИТ", async () => {
  const files: Record<string, string> = {
    "/probes-335-c4/probes.toml": "[probe.judge]\n[probe.judge.filter]\nclasses_judge = [\"exec-*\"]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-c4",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-c4",
    PWD: "/work-335-c4",
  }, 97_033_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "диспатч без маркера класса" }, async (e: any) => e)
  expect(out.deny, "без маркера судья со списками не судит -- отказа быть не может").toBe(undefined)
  expect(carrierRefusals335(writes).length).toBe(0)
})

test("#335 граница судьи: чужой носитель + диспатч, ПРОХОДЯЩИЙ все списки -- ОТКАЗ", async () => {
  const files: Record<string, string> = {
    "/probes-335-c5/probes.toml": "[probe.judge]\n[probe.judge.filter]\nclasses_judge = [\"exec-*\"]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-c5",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-c5",
    PWD: "/work-335-c5",
  }, 97_034_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "[dispatch-class:exec-0p] работа" }, async (e: any) => e)
  expect(String(out.deny), "граница с другой стороны: дошедший до суда диспатч гасится").toContain("patch-c5")
  expect(carrierRefusals335(writes).length).toBe(1)
  expect(carrierRefusals335(writes)[0].probe).toBe("judge")
})

test("#391 A: негодный образец в classes_judge НЕ снимает судью -- диспатч гасится", async () => {
  // Зуб подкласса A: до фикса пустой catch оставлял hit=false, ветка уходила
  // в not_in_judge_list, и защита снималась ОПЕЧАТКОЙ в конфиге. Направление
  // отказа при негодном образце -- в сторону защиты.
  const files: Record<string, string> = {
    "/probes-391-a1/probes.toml": "[probe.judge]\n[probe.judge.filter]\nclasses_judge = [\"exec-(\"]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-391-a1",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-391-a1",
    PWD: "/work-391-a1",
  }, 97_040_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "[dispatch-class:crit-mech] работа" }, async (e: any) => e)
  expect(String(out.deny), "опечатка в списке судьи не имеет права снимать защиту").toContain("patch-391-a1")
  expect(carrierRefusals335(writes).length).toBe(1)
})

test("#391 A': негодный образец в classes_skip ветку НЕ меняет, но НАЗВАН уликой", async () => {
  // Зуб подкласса A': направление пропуска уже безопасное (пропуск просто не
  // случится), поэтому ветка остаётся прежней -- проверяется ИМЕННО это, плюс
  // что негодность skip-списка не включает судью через границу badBefore.
  const files: Record<string, string> = {
    "/probes-391-a2/probes.toml": "[probe.judge]\n[probe.judge.filter]\nclasses_skip = [\"skip-(\"]\nclasses_judge = [\"exec-*\"]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-391-a2",
    CLAUDE_JUDGE: "1",
    PWD: "/work-391-a2",
  }, 97_041_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "[dispatch-class:crit-mech] работа" }, async (e: any) => e)
  expect(out.deny, "негодный skip-образец отказа не создаёт").toBe(undefined)
  const sk = judgeSkips391(writes)
  expect(sk.length, "пропуск записан").toBe(1)
  expect(sk[0].reason, "ветка прежняя: негодность skip-списка судью не включает").toBe("not_in_judge_list")
  expect(sk[0].badPattern, "негодный образец назван вместе с именем поля").toBe("classes_skip=skip-(")
})

test("#391 C: негодный образец в when пробу НЕ запускает, но правило названо мёртвым", async () => {
  const files: Record<string, string> = {
    "/probes-391-c/probes.toml":
      "[probe.judge]\nenabled = false\n[probe.form]\nenabled = false\n" +
      "[probe.idle-watch]\nenabled = false\n[probe.dead-rule]\nkind = \"consult\"\non = [\"PreToolUse\"]\n" +
      "[probe.dead-rule.when]\nfield = \"tool\"\nmatches = \"Age(nt\"\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-391-c",
    PWD: "/work-391-c",
  }, 97_042_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "работа" }, async (e: any) => e)
  expect(out.deny, "fail-closed к срабатыванию: мёртвое правило пробу не запускает").toBe(undefined)
  const j = writes
    .filter(w => String(w.path).indexOf("/dead-rule/journal.jsonl.shard.") >= 0)
    .map(w => { try { return JSON.parse(String(w.text)) } catch (x) { return null } })
    .filter(r => r)
  expect(j.length, "мёртвое правило оставило СВОЮ строку -- иначе улика никуда не доедет").toBe(1)
  expect(j[0].outcome).toBe("when_bad")
  expect(j[0].whenBad, "названо поле и сам образец").toBe("matches=Age(nt")
})

test("#335 граница судьи: пропуск при чужом носителе МОЛЧИТ -- записи судьи нет вовсе", async () => {
  const files: Record<string, string> = {
    "/probes-335-c6/probes.toml": "[probe.judge]\n[probe.judge.filter]\nclasses_skip = [\"skip-me\"]\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-c6",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-c6",
    PWD: "/work-335-c6",
  }, 97_035_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "[dispatch-class:skip-me] работа" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  // Журнал судьи описывает содеянное ИМ; не работавший судья не оставляет
  // записи решения -- ни своей, ни отказной.
  expect(writes.filter(w => String(w.path).indexOf("/judge/journal.jsonl.shard.") >= 0).length).toBe(0)
  expect(carrierRefusals335(writes).length).toBe(0)
})

test("#335 carrier журнала: skip_disabled при чужом носителе несёт ФАКТИЧЕСКОЕ значение ручки", async () => {
  const files: Record<string, string> = {
    "/probes-335-c7/probes.toml": "[probe.judge]\nenabled = false\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-c7",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "patch-c7",
    PWD: "/work-335-c7",
  }, 97_036_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(out.deny, "конфигурационно выключенная проба молчит и при чужой ручке").toBe(undefined)
  const recs = writes
    .filter(w => String(w.path).indexOf("/judge/journal.jsonl.shard.") >= 0)
    .map(w => { try { return JSON.parse(String(w.text)) } catch (x) { return null } })
  expect(recs.length).toBe(1)
  expect(recs[0].outcome).toBe("skip_disabled")
  expect(recs[0].carrier, "константа mod здесь лгала бы о том, кто работал").toBe("patch-c7")
})

test("#335 граница без списков: консультация БЕЗ списков классов + чужой носитель -- отказ звучит", async () => {
  const files: Record<string, string> = {
    "/probes-335-c8/probes.toml": "[probe.idle-watch]\nwindow_min = 0\n",
  }
  const { $ } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-c8",
    CLAUDE_IDLE: "1",
    CLAUDE_IDLE_CARRIER: "patch-c8",
    PWD: "/work-335-c8",
  }, 97_037_000)
  $.agent = { list: async () => [] }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Read" }, async (e: any) => e)
  expect(String(out.deny), "у консультации без списков нет блока классов -- точка отказа не уезжает глубже").toContain("patch-c8")
})

test("#335 регресс: боевая конфигурация (все носители mod, все выключатели включены) ведёт себя как раньше", async () => {
  // Судья живой: его skip-запись -- свидетель, что боевая конфигурация
  // доходит до ТОЧКИ ДЕЙСТВИЯ и ведёт себя там как до волны.
  const files: Record<string, string> = {
    "/probes-335-r13/probes.toml":
      "[probe.judge]\n[probe.judge.filter]\nclasses_judge = [\"exec-*\"]\n[probe.form]\nenabled = false\n[probe.idle-watch]\nenabled = false\n[probe.edge-no-carrier]\nkind = \"consult\"\n",
  }
  const { $, writes } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-335-r13",
    CLAUDE_JUDGE: "1",
    CLAUDE_JUDGE_CARRIER: "mod",
    CLAUDE_FORM: "1",
    CLAUDE_FORM_CARRIER: "mod",
    CLAUDE_IDLE: "1",
    CLAUDE_IDLE_CARRIER: "mod",
    CLAUDE_PROBES: "1",
    PWD: "/work-335-r13",
  }, 97_012_000)
  $.agent = { list: async () => [] }
  const storeSets: string[] = []
  $.store = { get: async () => "", set: async (k: string, _v: any) => { storeSets.push(String(k)) } }
  const hook = carrierHook335()
  const out = await hook()($, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(carrierRefusals335(writes).length).toBe(0)
  expect(writes.filter(w => String(w.path).indexOf("/judge/journal.jsonl.shard.") >= 0).length, "судья дошёл до точки действия и записал skip").toBe(1)
  expect(storeSets.length).toBe(0)
})

test("failoverLadderBind: агентная лестница выигрывает у class и allowed", () => {
  const fo = parseToml(`[failover.agent.glm-executor]
models = ["a1", "a2"]
[failover.class.exec-0p]
models = ["c1"]
`).failover
  const info = failoverLadderBind(fo, "glm-executor", "exec-0p")
  expect(info.ladder).toStrictEqual(["a1", "a2"])
  expect(info.source).toBe("agent")
})

test("nextFailoverModel: пропуск уже отказавшей модели", () => {
  expect(nextFailoverModel(["glm-5.3", "grok-4.6"], ["glm-5.3"])).toBe("grok-4.6")
  expect(nextFailoverModel(["glm-5.3", "grok-4.6"], ["glm-5.3", "grok-4.6"])).toBe(null)
  expect(nextFailoverModel(["a", "b", "c"], ["b"])).toBe("a")
})

test("#509 D-1: все ступени без потолка", () => {
  const seq = failoverAttemptModels("incoming", null, ["m1", "m2", "m3", "m4", "m5"])
  expect(seq).toStrictEqual(["incoming", "m1", "m2", "m3", "m4", "m5"])
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

// --- #227-A: свёртка скучных улик ------------------------------------------------

test("failoverAttemptIsBoring: ok attempt 0 без отметок -- скучный", () => {
  expect(failoverAttemptIsBoring({ outcome: "ok", attempt: 0 }, false)).toBe(true)
  expect(FAILOVER_FOLD_PERIOD_MS).toBe(1000)
})

test("failoverAttemptIsBoring: отказ, переход, липкость, негодный эффорт -- не скучный", () => {
  expect(failoverAttemptIsBoring({ outcome: "empty", attempt: 0 }, false)).toBe(false)
  expect(failoverAttemptIsBoring({ outcome: "ok", attempt: 1 }, false)).toBe(false)
  expect(failoverAttemptIsBoring({ outcome: "ok", attempt: 0 }, true)).toBe(false)
  expect(failoverAttemptIsBoring({ outcome: "ok", attempt: 0, startMatch: true }, false)).toBe(false)
  expect(failoverAttemptIsBoring({ outcome: "ok", attempt: 0, rungsFiltered: 1 }, false)).toBe(false)
  expect(failoverAttemptIsBoring({ outcome: "ok", attempt: 0, effortBad_m: "High" }, false)).toBe(false)
})

test("#227-A зуб 5: два одновременных сброса -- один файл, счёт не теряется и не удваивается", async () => {
  failoverFoldReset()
  failoverFoldNote(1000)
  failoverFoldNote(1001)
  failoverFoldNote(1002)
  failoverFoldNote(1003)
  failoverFoldNote(1004)
  expect(failoverFoldCount()).toBe(5)

  const writes: { path: string; text: string }[] = []
  let release: () => void = () => {}
  const held = new Promise<void>(r => { release = r })
  const $: any = {
    fs: {
      write: async (path: string, text: string) => {
        writes.push({ path, text })
        await held
      },
    },
    clock: { now: async () => 1_000_000 },
  }
  const world = { globalHome: "/probes-home" }

  const p1 = failoverFoldFlush($, world)
  await Promise.resolve()
  const p2 = failoverFoldFlush($, world)
  await Promise.resolve()
  release()
  await Promise.all([p1, p2])

  expect(writes, "сторож: один файл, не два").toHaveLength(1)
  const rec = JSON.parse(writes[0].text)
  expect(rec.fold, "агрегат отличим полем fold").toBe(true)
  expect(rec.n, "счёт не потерян и не удвоен").toBe(5)
  expect(String(rec.rec).indexOf("agg-"), "rec агрегата не схлопнется с попыткой").toBe(0)
  expect(failoverFoldCount()).toBe(0)
  failoverFoldReset()
})

test("#227-A зуб 6: нулевой сброс файла не создаёт; агрегат несёт fold", async () => {
  failoverFoldReset()
  const writes: { path: string; text: string }[] = []
  const $: any = {
    fs: { write: async (path: string, text: string) => { writes.push({ path, text }) } },
    clock: { now: async () => 1_000_000 },
  }
  const world = { globalHome: "/probes-home" }
  await failoverFoldFlush($, world)
  expect(writes, "тик при нуле не пишет").toHaveLength(0)

  failoverFoldNote(2000)
  await failoverFoldFlush($, world)
  expect(writes).toHaveLength(1)
  const rec = JSON.parse(writes[0].text)
  expect(rec.fold).toBe(true)
  expect(rec.n).toBe(1)
  failoverFoldReset()
})

test("#227-A зуб 7: агрегат называет липкую ступень", async () => {
  failoverFoldReset()
  const writes: { path: string; text: string }[] = []
  const $: any = {
    fs: { write: async (path: string, text: string) => { writes.push({ path, text }) } },
    clock: { now: async () => 1_000_000 },
  }
  const world = { globalHome: "/probes-home" }
  await failoverFoldObserve($, world, 3000, "glm-5.3", "sid-fold")
  await failoverFoldObserve($, world, 3001, "glm-5.3", "sid-fold")
  await failoverFoldFlush($, world)
  expect(writes).toHaveLength(1)
  const rec = JSON.parse(writes[0].text)
  expect(rec.fold).toBe(true)
  expect(rec.n).toBe(2)
  expect(rec.sticky, "агрегат несёт липкую ступень, не модель события").toBe("glm-5.3")
  failoverFoldReset()
})

test("#227-A зуб 8: смена липкой ступени не схлопывается в одну запись", async () => {
  failoverFoldReset()
  const writes: { path: string; text: string }[] = []
  const $: any = {
    fs: { write: async (path: string, text: string) => { writes.push({ path, text }) } },
    clock: { now: async () => 1_000_000 },
  }
  const world = { globalHome: "/probes-home" }
  await failoverFoldObserve($, world, 4000, "glm-5.3", "sid-a")
  await failoverFoldObserve($, world, 4001, "glm-5.3", "sid-a")
  await failoverFoldObserve($, world, 5000, "grok-4.6", "sid-b")
  await failoverFoldFlush($, world)
  expect(writes, "смена sticky — два агрегата, не один").toHaveLength(2)
  const a = JSON.parse(writes[0].text)
  const b = JSON.parse(writes[1].text)
  expect(a.sticky).toBe("glm-5.3")
  expect(a.n).toBe(2)
  expect(b.sticky).toBe("grok-4.6")
  expect(b.n).toBe(1)
  failoverFoldReset()
})

test("#227-A зуб 9: отказ записи возвращает счёт; следующий проход пишет те же n", async () => {
  failoverFoldReset()
  const writes: { path: string; text: string }[] = []
  let fail = true
  const $: any = {
    fs: {
      write: async (path: string, text: string) => {
        if (fail) throw new Error("ENOSPC-fold")
        writes.push({ path, text })
      },
    },
    clock: { now: async () => 1_000_000 },
  }
  const world = { globalHome: "/probes-home" }
  await failoverFoldObserve($, world, 6000, "glm-5.3", "sid-e")
  await failoverFoldObserve($, world, 6001, "glm-5.3", "sid-e")
  expect(failoverFoldCount()).toBe(2)
  let threw = ""
  try { await failoverFoldFlush($, world) } catch (x) { threw = String(x) }
  expect(threw.indexOf("ENOSPC-fold") >= 0, "отказ записи не глотается").toBe(true)
  expect(failoverFoldCount(), "после отказа счётчик не обнулён").toBe(2)
  expect(writes).toHaveLength(0)
  fail = false
  await failoverFoldFlush($, world)
  expect(writes).toHaveLength(1)
  const rec = JSON.parse(writes[0].text)
  expect(rec.n, "следующий проход дописывает те же n шагов").toBe(2)
  expect(rec.sticky).toBe("glm-5.3")
  failoverFoldReset()
})

test("#227-A зуб 10: отказ записи виден на следующей записи (journalWriteErr)", async () => {
  failoverFoldReset()
  const writes: { path: string; text: string }[] = []
  let fail = true
  const $: any = {
    fs: {
      write: async (path: string, text: string) => {
        if (fail) throw new Error("ENOSPC-j")
        writes.push({ path, text })
      },
    },
    clock: { now: async () => 1_000_000 },
  }
  const world = { globalHome: "/probes-home" }
  await failoverFoldObserve($, world, 7000, "glm-5.3", "sid-j")
  try { await failoverFoldFlush($, world) } catch (x) {}
  fail = false
  await failoverFoldFlush($, world)
  expect(writes).toHaveLength(1)
  const rec = JSON.parse(writes[0].text)
  expect(String(rec.journalWriteErr || ""), "след отказа на следующей записи, не молча").toContain("ENOSPC-j")
  failoverFoldReset()
})

test("#227-A зуб 12: след отказа НАЗЫВАЕТ журнал-владелец, а не только причину", async () => {
  failoverFoldReset()
  const writes: { path: string; text: string }[] = []
  let fail = true
  const $: any = {
    fs: {
      write: async (path: string, text: string) => {
        if (fail) throw new Error("ENOSPC-owner")
        writes.push({ path, text })
      },
    },
    clock: { now: async () => 1_000_000 },
  }
  const world = { globalHome: "/probes-home" }
  await failoverFoldObserve($, world, 7000, "glm-5.3", "sid-o")
  try { await failoverFoldFlush($, world) } catch (x) {}
  fail = false
  await failoverFoldFlush($, world)
  const rec = JSON.parse(writes[0].text)
  const trace = String(rec.journalWriteErr || "")
  expect(trace, "причина названа").toContain("ENOSPC-owner")
  expect(trace, "владелец журнала назван: один след обслуживает все пробы")
    .toContain("/probes-home/failover/journal.jsonl")
  failoverFoldReset()
})

test("#227-A зуб 11: шаг, потерянный на разрезе окна, назван и не смешан со старым", async () => {
  await drainFold393()
  const writes: { path: string; text: string }[] = []
  let fail = true
  const $: any = {
    fs: {
      write: async (path: string, text: string) => {
        if (fail) throw new Error("ENOSPC-split")
        writes.push({ path, text })
      },
    },
    clock: { now: async () => 1_000_000 },
  }
  const world = { globalHome: "/probes-home" }
  await failoverFoldObserve($, world, 8000, "glm-5.3", "sid-s")
  await failoverFoldObserve($, world, 8001, "glm-5.3", "sid-s")
  let threw = ""
  try { await failoverFoldObserve($, world, 9000, "grok-4.6", "sid-s") } catch (x) { threw = String(x) }
  expect(threw.indexOf("ENOSPC-split") >= 0).toBe(true)
  expect(failoverFoldCount(), "старое окно возвращено, новый шаг в него не смешан").toBe(2)
  fail = false
  await failoverFoldFlush($, world)
  expect(writes).toHaveLength(1)
  const rec = JSON.parse(writes[0].text)
  expect(rec.sticky).toBe("glm-5.3")
  expect(rec.n).toBe(2)
  expect(rec.foldSplitLost, "потерянный на разрезе шаг назван").toBe(1)
  expect(Object.prototype.hasOwnProperty.call(rec, "foldSplitLost")).toBe(true)
  failoverFoldReset()
})

test("#251 зуб: агрегат несёт разбивку по agentId, сумма карты равна n", async () => {
  failoverFoldReset()
  const writes: { path: string; text: string }[] = []
  const $: any = {
    fs: { write: async (path: string, text: string) => { writes.push({ path, text }) } },
    clock: { now: async () => 1_000_000 },
  }
  const world = { globalHome: "/probes-home" }
  // два агента с ОДНОЙ липкостью делят окно -- старая свёртка теряла их id
  await failoverFoldObserve($, world, 3000, "glm-5.3", "sid-fold", "agent-A")
  await failoverFoldObserve($, world, 3001, "glm-5.3", "sid-fold", "agent-A")
  await failoverFoldObserve($, world, 3002, "glm-5.3", "sid-fold", "agent-B")
  await failoverFoldFlush($, world)
  expect(writes).toHaveLength(1)
  const rec = JSON.parse(writes[0].text)
  expect(rec.n).toBe(3)
  expect(rec.agents, "агрегат несёт атрибуцию по agentId").toEqual({ "agent-A": 2, "agent-B": 1 })
  const sum = Object.values(rec.agents as Record<string, number>).reduce((a: number, b: number) => a + b, 0)
  expect(sum, "сумма карты агентов равна n -- ни одна попытка не потеряна").toBe(rec.n)
  failoverFoldReset()
})

test("#251 зуб: отказ записи возвращает карту агентов; следующий проход несёт её целиком", async () => {
  failoverFoldReset()
  const writes: { path: string; text: string }[] = []
  let fail = true
  const $: any = {
    fs: {
      write: async (path: string, text: string) => {
        if (fail) throw new Error("ENOSPC-agents")
        writes.push({ path, text })
      },
    },
    clock: { now: async () => 1_000_000 },
  }
  const world = { globalHome: "/probes-home" }
  await failoverFoldObserve($, world, 6000, "glm-5.3", "sid-e", "agent-A")
  await failoverFoldObserve($, world, 6001, "glm-5.3", "sid-e", "agent-B")
  try { await failoverFoldFlush($, world) } catch (x) {}
  expect(failoverFoldCount(), "после отказа счёт не обнулён").toBe(2)
  fail = false
  await failoverFoldFlush($, world)
  expect(writes).toHaveLength(1)
  const rec = JSON.parse(writes[0].text)
  expect(rec.n).toBe(2)
  expect(rec.agents, "атрибуция пережила возврат снимка").toEqual({ "agent-A": 1, "agent-B": 1 })
  failoverFoldReset()
})

test("failoverWouldSetSticky: бросок, отказ носителя, совпадение проверяющего -- false", () => {
  sessionExecutorsReset()
  rungCooldownReset()
  const ok = { stopReason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, model: "m" } }
  const empty = { stopReason: null, usage: null }
  // CONSTRAINT (#489-B1-FIX5 Z13.4): второй аргумент — Булево refusal, а не res:
  // на попытку isCarrierRefusal вычисляется один раз вызывающим.
  expect(failoverWouldSetSticky(true, isCarrierRefusal(ok), false, "m")).toBe(false)
  expect(failoverWouldSetSticky(false, isCarrierRefusal(empty), false, "m")).toBe(false)
  expect(failoverWouldSetSticky(false, isCarrierRefusal(ok), false, "m")).toBe(true)
  sessionExecutorModelAdd("glm-5.3")
  expect(sessionExecutorHas("glm-5.3")).toBe(true)
  expect(failoverWouldSetSticky(false, isCarrierRefusal(ok), true, "glm-5.3")).toBe(false)
  expect(failoverWouldSetSticky(false, isCarrierRefusal(ok), true, "grok-4.6")).toBe(true)
  sessionExecutorsReset()
  rungCooldownReset()
})

// --- #178w3: слэш-команда catalyst-ladder ---------------------------------------
// CONSTRAINT: хостовая половина двери $.command.register в харнесе ЗАМОКАНА
// (волна 1 #178: «no implementation for command.register» на всех валидных
// спеках), поэтому зубы пинят НАШУ сторону -- подачу, обрезку и проводку, --
// а не ответ хоста.

test("ladder-cmd: snapshot возвращает остывающие с убывающим остатком; истёкшая не возвращается", () => {
  const marks = new Map<string, any>([
    ["glm-5.3", { at: 1000, reason: "rung-timeout" }],
    ["grok-4.6", { at: 2000, reason: "carrier-refusal" }],
  ])
  const a = cooldownSnapshot(61000, marks)
  expect(a).toStrictEqual([
    { model: "glm-5.3", leftMs: RUNG_COOLDOWN_MS - 60000, reason: "rung-timeout" },
    { model: "grok-4.6", leftMs: RUNG_COOLDOWN_MS - 59000, reason: "carrier-refusal" },
  ])
  const b = cooldownSnapshot(62000, marks)
  expect(b[0].leftMs).toBeLessThan(a[0].leftMs)
  // граница окна ровно: ещё остывает (тот же предикат, что у фильтра лестницы)
  expect(cooldownSnapshot(1000 + RUNG_COOLDOWN_MS, new Map<string, any>([["edge", { at: 1000, reason: "rung-timeout" }]])))
    .toStrictEqual([{ model: "edge", leftMs: 0, reason: "rung-timeout" }])
  expect(cooldownSnapshot(1001 + RUNG_COOLDOWN_MS, new Map<string, any>([["old", { at: 1000, reason: "rung-timeout" }]])))
    .toStrictEqual([])
})

test("ladder-cmd: ПУСТО не НОЛЬ -- без остывающих текст говорит об этом явно", () => {
  const empty = new Map<string, any>()
  expect(cooldownSnapshot(12345, empty)).toStrictEqual([])
  const text0 = ladderCommandText(12345, "", empty)
  expect(text0).toContain("остывающих ступеней нет")
  // положительный контроль: тот же вызов с непустой картой несёт модель
  const marks = new Map<string, any>([["glm-5.3", { at: 100, reason: "rung-timeout" }]])
  const text1 = ladderCommandText(12345, "", marks)
  expect(text1).toContain("glm-5.3")
  expect(text1.indexOf("остывающих ступеней нет")).toBe(-1)
})

test("ladder-cmd: текст несёт версию мода и окно остывания", () => {
  const marks = new Map<string, any>([["glm-5.3", { at: 0, reason: "rung-timeout" }]])
  const text = ladderCommandText(1, "", marks)
  expect(text).toContain(MOD_VERSION)
  expect(text).toContain((RUNG_COOLDOWN_MS / 60000) + " мин")
})

test("ladder-cmd: фильтр-подстрока оставляет совпавшие; пусто после фильтра -- явная строка", () => {
  const marks = new Map<string, any>([
    ["glm-5.3", { at: 0, reason: "rung-timeout" }],
    ["grok-4.6", { at: 0, reason: "rung-timeout" }],
  ])
  const text = ladderCommandText(1, "glm", marks)
  expect(text).toContain("glm-5.3")
  expect(text.indexOf("grok-4.6")).toBe(-1)
  expect(ladderCommandText(1, "qwen", marks)).toContain("под фильтр не попала ни одна ступень")
})

test("ladder-cmd: аргумент длиннее 32000 обрезается НАШЕЙ стороной до границы", () => {
  expect(LADDER_COMMAND_ARG_MAX).toBe(32000)
  expect(clipLadderArg("x".repeat(32001)).length).toBe(32000)
  expect(clipLadderArg("x".repeat(32000)).length).toBe(32000)
  expect(clipLadderArg("glm")).toBe("glm")
  expect(clipLadderArg("")).toBe("")
})

test("ladder-cmd: имя и описание подачи укладываются в измеренные пределы двери", () => {
  expect(LADDER_COMMAND).toBe("catalyst-ladder")
  expect(LADDER_COMMAND.length).toBeLessThanOrEqual(64)
  expect(/^[A-Za-z0-9_-]+$/.test(LADDER_COMMAND)).toBe(true)
  expect(LADDER_COMMAND_DESCRIPTION.length).toBeGreaterThan(0)
  expect(LADDER_COMMAND_DESCRIPTION.length).toBeLessThanOrEqual(4096)
  expect(LADDER_COMMAND_ARG_HINT).toBe("[модель]")
})

test("ladder-cmd: ПРОВОДКА -- регистрация из session.start, подписка на catalyst-ladder", async () => {
  // on(...) вызывается с матчером (command.run) и без него (session.start) --
  // собиратель нормализует арность сам.
  // Регистрации несут цепочку .catch на месте вызова -- мок on обязан
  // отдавать дескриптор с .catch, иначе сама проводка падает на undefined.
  const subs: Array<{ ev: string; matcher: any; fn: any }> = []
  register((...a: any[]) => {
    if (a.length >= 3) subs.push({ ev: a[0], matcher: a[1], fn: a[2] })
    else subs.push({ ev: a[0], matcher: null, fn: a[1] })
    return { catch: () => {} }
  })
  const started = subs.filter(s => s.ev === "session.start")
  expect(started.length).toBe(1)
  const specs: any[] = []
  hostMemoReset()
  const $: any = {
    store: { set: async () => {} },
    command: { register: async (spec: any) => { specs.push(spec) } },
  }
  await started[0].fn($, { cwd: "/probe" }, async (x: any) => "NEXT-" + String(x && x.cwd))
  // CONSTRAINT (stale-agents Д8): вторая команда мода -- catalyst-fleet, регистрируется после лестницы.
  expect(specs.length).toBe(2)
  expect(specs[1].name).toBe("catalyst-fleet")
  expect(specs[0].name).toBe("catalyst-ladder")
  expect(specs[0].description).toBe(LADDER_COMMAND_DESCRIPTION)
  expect(specs[0].argumentHint).toBe("[модель]")
  expect(specs[0].immediate).toBe(false)
  const own = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("catalyst-ladder") >= 0)
  expect(own.length).toBe(1)
})

test("ladder-cmd: отказ двери регистрации не ломает session.start", async () => {
  const subs: Array<{ ev: string; matcher: any; fn: any }> = []
  register((...a: any[]) => {
    if (a.length >= 3) subs.push({ ev: a[0], matcher: a[1], fn: a[2] })
    else subs.push({ ev: a[0], matcher: null, fn: a[1] })
    return { catch: () => {} }
  })
  const started = subs.filter(s => s.ev === "session.start")
  expect(started.length).toBe(1)
  hostMemoReset()
  const $: any = {
    store: { set: async () => {} },
    command: { register: async () => { throw new Error("no implementation for command.register") } },
  }
  let nextArg: any = null
  const next = async (x: any) => { nextArg = x; return "NEXT-OK" }
  const out = await started[0].fn($, { cwd: "/probe" }, next)
  expect(out).toBe("NEXT-OK")
  expect(nextArg).toEqual({ cwd: "/probe" })
  const snapCmd = registerModule393.lostWritesSnapshot()
  expect(snapCmd["ladder-command-register"] && snapCmd["ladder-command-register"].n >= 1,
    "отказ двери регистрации назван в lostWrites").toBe(true)
})

// --- Обработчик отказа регистрации (.catch): решающие ветви -------------------

// CONSTRAINT: движковый маршрут для этих ветвей в ките НЕИЗМЕРИМ и это
// ИЗМЕРЕНО, а не обойдено: (1) пер-тестовый таймаут кита 5000 мс меньше
// бюджета хоста 10000 мс -- хук, висящий до отказа, убивает тест раньше
// отказа ("Error: timed out after 5000 ms", красный прогон 2026-09-17);
// (2) до первого next мод не бросается ничем -- каждый op-вызов на этом
// пути сидит под глухим try (register.ts: worldFor/loadWorld/nowMs/sidFor/
// agent.list). Хост зовёт обработчик в форме хука ($, e, next): e --
// событие, next несёт caught-поля поднятыми прямо на себя --
// next.error = {kind, budget}, next.called (живой зонд 2026-09-17 и байты
// 2.1.273/274: Object.assign(s, e.caught)); $ внутри обработчика читаться
// не может (статическая проверка), поэтому заглушка Dollar не читается и
// самим обработчиком. Зуб зовёт обработчики, снятые с РЕАЛЬНЫХ регистраций.
// Загрузку мода с .catch на всех девяти регистрациях движком держит каждый
// движковый зуб набора: отвергни валидатор форму -- упал бы весь файл
// behavior.test.ts.
const Dollar = { probe: "не читается обработчиком отказа" }

function catchOfRegister(): Record<string, any> {
  const caught: Record<string, any> = {}
  register(((ev: string, ..._rest: any[]) => ({
    catch: (h: any) => { caught[ev] = h },
  })) as any)
  return caught
}

test("catch: звавшийся next -- прозрачный проход, отмена не нужна", async () => {
  const caught = catchOfRegister()
  for (const ev of ["tool.call", "agent.spawn"]) {
    expect(typeof caught[ev], `${ev} несёт обработчик отказа на месте регистрации`).toBe("function")
  }
  for (const ev of ["tool.call", "agent.spawn"]) {
    let passed: any = "НЕ ЗВАЛСЯ"
    const next: any = (x: any) => { passed = x; return "PASSED-" + ev }
    next.called = true
    next.error = Object.freeze({ kind: "throw", budget: 1000 })
    const out = await caught[ev](Dollar, { tool: "Agent", prompt: "x" }, next)
    expect(out, `${ev}: прозрачный проход без нового deny`).toBe("PASSED-" + ev)
    expect(passed, `${ev}: next получил исходное событие`).toEqual({ tool: "Agent", prompt: "x" })
  }
})

test("catch: не звавшийся next -- deny с видом отказа", async () => {
  const caught = catchOfRegister()
  expect(typeof caught["agent.spawn"], "agent.spawn несёт обработчик отказа").toBe("function")
  const next: any = () => "НИКОГДА: ОТМЕНА ДО ПРОХОДА"
  next.called = false
  next.error = Object.freeze({ kind: "timeout", budget: 1000 })
  const out = await caught["agent.spawn"](Dollar, { subagentType: "glm-executor" }, next)
  expect(out).toEqual({
    deny:
      "Subagent dispatch cancelled: the catalyst-probes agent.spawn hook timed out " +
      "without answering [timeout]. Fail-closed: the dispatch never runs " +
      "unreviewed. This is NOT the routing-table.toml gate. Tell the human and " +
      "do the work without a subagent, or retry later.",
  })
  // CONSTRAINT: next.error.budget -- грейс обработчика отказа (Be=1000), не
  // бюджет упавшего хука (1e4); в текст deny число не входит.
  const nextThrow: any = () => "НИКОГДА: ОТМЕНА ДО ПРОХОДА"
  nextThrow.called = false
  nextThrow.error = Object.freeze({ kind: "throw", budget: 1000 })
  const outThrow = await caught["agent.spawn"](Dollar, { subagentType: "glm-executor" }, nextThrow)
  expect(outThrow).toEqual({
    deny:
      "Subagent dispatch cancelled: the catalyst-probes agent.spawn hook threw " +
      "[throw]. Fail-closed: the dispatch never runs unreviewed. This is NOT " +
      "the routing-table.toml gate. Tell the human and do the work without a " +
      "subagent, or retry later.",
  })
  // Тот же вид отказа у второй решающей регистрации -- с названием её события.
  const out2 = await caught["tool.call"](Dollar, { tool: "Agent", prompt: "x" }, next)
  expect(String(out2.deny)).toContain("the catalyst-probes tool.call hook")
  expect(String(out2.deny)).toContain("[timeout]")
  expect(String(out2.deny)).toContain("timed out without answering")
})

// CONSTRAINT: turn.step стримит, и его обработчик отказа обязан прогонять
// поток next так же, как основной хук (driveNext по Symbol.asyncIterator,
// register.ts): голый `return next(e)` отдаёт ОБЪЕКТ ГЕНЕРАТОРА вместо
// потока -- шаги не эмитятся, и второе место расходится молча (класс
// предупреждения у driveNext).
async function drainStream(g: any): Promise<{ chunks: any[]; value: any }> {
  const out = { chunks: [] as any[], value: undefined as any }
  if (g == null || typeof g.next !== "function") { out.value = g; return out }
  for (;;) {
    const n: any = await g.next()
    if (n.done) { out.value = n.value; return out }
    out.chunks.push(n.value)
  }
}

test("catch: стримовая регистрация прогоняет поток next -- шаги наружу, не объект генератора", async () => {
  const caught = catchOfRegister()
  expect(typeof caught["turn.step"], "turn.step несёт обработчик отказа").toBe("function")
  const first = { kind: "text", index: 0, text: "step-one" }
  const second = { kind: "text", index: 1, text: "step-two" }
  const next: any = () => (async function* () {
    yield first
    yield second
    return "STREAM-RESULT"
  })()
  next.called = true
  next.error = Object.freeze({ kind: "throw", budget: 1000 })
  const out = await drainStream(caught["turn.step"](Dollar, { turnId: "t1", index: 0, model: "m1" }, next))
  expect(out.chunks, "оба шага потока эмитились наружу").toEqual([first, second])
  expect(out.value, "возвращено значение потока, а не объект генератора").toBe("STREAM-RESULT")
})

// --- #313: веер turn.step помнит отказ носителя -------------------------------

// CONSTRAINT: зубы веера прогоняют РЕАЛЬНЫЙ обработчик turn.step, снятый с
// регистрации (catchOfRegister), с настоящей привязкой failoverBindSet:
// прямой вызов функций памяти проверял бы не тот путь (промах волны #311).
// Метки читаются из дефолтной карты процесса -- той самой, куда пишет веер;
// имена моделей уникальны на зуб, карта между зубами не сбрасывается
// (недоступность модели относится к процессу, не к сессии).
const FAN313_NOW = 91_313_000

function fan313$(): any {
  hostMemoReset()
  const files: Record<string, string> = {
    "/probes-f313/probes.toml": "[failover]\nenabled = true\n",
  }
  return {
    clock: { now: async () => FAN313_NOW },
    env: { get: async (k: string) => (k === "CLAUDE_PROBES_DIR" ? "/probes-f313" : "") },
    store: { get: async () => "" },
    fs: {
      read: async (p: string) => {
        if (files[p] !== undefined) return files[p]
        throw new Error("ENOENT " + p)
      },
    },
  }
}

function fan313Stream(script: { [model: string]: () => any }): any {
  const seen: string[] = []
  const next: any = (req: any) => {
    const model = String(req && req.model)
    seen.push(model)
    const act = script[model]
    if (!act) throw new Error("fan313: нет сценария для " + model)
    return act()
  }
  next.seen = seen
  return next
}

function fan313Refuse(): any {
  return (async function* () { return { usage: null, stopReason: null } })()
}

function fan313RefuseAfterChunk(): any {
  return (async function* () {
    yield { kind: "text", text: "кусок до отказа" }
    return { usage: null, stopReason: null }
  })()
}

function fan313Throw(): any {
  return (async function* () { throw new Error("transport-down") })()
}

function fan313Ok(tag: string): any {
  return (async function* () {
    return { usage: { out: 1 }, stopReason: "end_turn", text: "OK-" + tag }
  })()
}

// CONSTRAINT: turn.step — основной хук сидит во ВТОРОМ аргументе on();
// .catch-обработчик (observerFailThroughStream) — прозрачный next(e), он
// ВЕЕРА НЕ НЕСЁТ: снятый с него «хук» прогонял бы только попытку original.
function fan313Step(): any {
  let fn: any = null
  register((ev: string, ...rest: any[]) => {
    if (ev === "turn.step") fn = rest.length >= 2 ? rest[1] : rest[0]
    return { catch: () => {} }
  })
  return fn
}

async function fan313Run(aid: string, original: string, ladder: string[], next: any): Promise<any> {
  // CONSTRAINT (#266): ступени веера несут ОБЪЯВЛЕННЫЙ эффорт -- голая ступень
  // без пина клетки отказывает ДО вызова, и зубы остывания мерили бы отказ,
  // а не метки. Пин клетки в мире f313 отсутствует намеренно: объявление на
  // ступени -- единственный годный источник.
  const rungEffort: { [k: string]: string } = {}
  for (const m of ladder) rungEffort[m] = "max"
  failoverBindSet(aid, { ladder, rungEffort, subagentType: "fan313", class: "", sticky: null })
  const step = fan313Step()
  return await drainStream(step(fan313$(), { agentId: aid, turnId: "f313", index: 0, model: original }, next))
}

test("#313 T1: отказ носителя до содержимого ставит метку остывания", async () => {
  failoverBindReset()
  const next = fan313Stream({
    "f313-t1-refuse": fan313Refuse,
    "f313-t1-ok": () => fan313Ok("t1"),
  })
  const out = await fan313Run("f313-t1", "f313-t1-refuse", ["f313-t1-ok"], next)
  expect(out.value && out.value.text).toBe("OK-t1")
  expect(isModelCooling("f313-t1-refuse", FAN313_NOW + 1)).toBe(true)
  const row = cooldownSnapshot(FAN313_NOW + 1).filter((r: any) => r.model === "f313-t1-refuse")
  expect(row.length).toBe(1)
  expect(row[0].reason).toBe("carrier-refusal")
  expect(isModelCooling("f313-t1-ok", FAN313_NOW + 1)).toBe(false)
  failoverBindReset()
})

test("#313 T2: отказ носителя ПОСЛЕ содержимого метки НЕ ставит", async () => {
  failoverBindReset()
  const next = fan313Stream({
    "f313-t2-refuse": fan313RefuseAfterChunk,
    "f313-t2-next": () => fan313Ok("t2"),
  })
  const out = await fan313Run("f313-t2", "f313-t2-refuse", ["f313-t2-next"], next)
  expect(out.chunks.length).toBe(1)
  expect(next.seen, "ступень с выданным содержимым состоялась -- перехода нет").toEqual(["f313-t2-refuse"])
  expect(isModelCooling("f313-t2-refuse", FAN313_NOW + 1)).toBe(false)
  expect(cooldownSnapshot(FAN313_NOW + 1).filter((r: any) => r.model === "f313-t2-refuse").length).toBe(0)
  failoverBindReset()
})

// CONSTRAINT (#514 H1/H8): бросок до выдачи -- отказ по общему пути и ставит
// метку; различение #239 живёт в ПРИЧИНЕ метки (carrier-throw против
// carrier-refusal).
test("#313 T3: бросок ставит метку с причиной carrier-throw -- различение #239 в причине", async () => {
  failoverBindReset()
  const next = fan313Stream({
    "f313-t3-throw": fan313Throw,
    "f313-t3-ok": () => fan313Ok("t3"),
  })
  const out = await fan313Run("f313-t3", "f313-t3-throw", ["f313-t3-ok"], next)
  expect(out.value && out.value.text).toBe("OK-t3")
  expect(isModelCooling("f313-t3-throw", FAN313_NOW + 1)).toBe(true)
  const row = cooldownSnapshot(FAN313_NOW + 1).filter((r: any) => r.model === "f313-t3-throw")
  expect(row.map((r: any) => [r.reason, r.class])).toEqual([["carrier-throw", "temporary-unknown"]])
  failoverBindReset()
})

test("#313 T4: удачная попытка метки НЕ ставит", async () => {
  failoverBindReset()
  const next = fan313Stream({ "f313-t4-ok": () => fan313Ok("t4") })
  const out = await fan313Run("f313-t4", "f313-t4-ok", ["f313-t4-backup"], next)
  expect(next.seen).toEqual(["f313-t4-ok"])
  expect(isModelCooling("f313-t4-ok", FAN313_NOW + 1)).toBe(false)
  failoverBindReset()
})

test("#313 T5: остывающая модель в плане -- перестановка в хвост, не вырезка", async () => {
  failoverBindReset()
  noteRungCarrierRefusal("f313-t5-cold", FAN313_NOW - 5000)
  // CONSTRAINT: прямой ассерт перестановки идёт ДО веера -- веер этого зуба
  // отказом каждой ступени сам ставит метки всем моделям плана, и после
  // него перестановка стала бы тождественной.
  const defer = deferCoolingAttemptModels(["f313-t5-h1", "f313-t5-cold", "f313-t5-h2"], FAN313_NOW)
  expect(defer.plan.length).toBe(3)
  expect(defer.plan).toEqual(["f313-t5-h1", "f313-t5-h2", "f313-t5-cold"])
  const next = fan313Stream({
    "f313-t5-h1": fan313Refuse,
    "f313-t5-cold": fan313Refuse,
    "f313-t5-h2": fan313Refuse,
  })
  // план failoverAttemptModels: [h1, cold, h2]; перестановка: холодная в хвост
  const out = await fan313Run("f313-t5", "f313-t5-h1", ["f313-t5-cold", "f313-t5-h2"], next)
  expect(next.seen, "остывающая достигнута последней, здоровые в прежнем порядке").toEqual(["f313-t5-h1", "f313-t5-h2", "f313-t5-cold"])
  expect(isCarrierRefusal(out.value)).toBe(true)
  failoverBindReset()
})

test("#313 T6: ВСЕ модели плана остывают -- план неизменен и полон", async () => {
  failoverBindReset()
  noteRungCarrierRefusal("f313-t6-x", FAN313_NOW)
  noteRungCarrierRefusal("f313-t6-y", FAN313_NOW)
  noteRungCarrierRefusal("f313-t6-solo", FAN313_NOW)
  const next = fan313Stream({
    "f313-t6-x": fan313Refuse,
    "f313-t6-y": fan313Refuse,
  })
  const out = await fan313Run("f313-t6", "f313-t6-x", ["f313-t6-y"], next)
  expect(next.seen, "перестановка тождественна: исходный порядок, обе попытки").toEqual(["f313-t6-x", "f313-t6-y"])
  expect(isCarrierRefusal(out.value)).toBe(true)
  // план из одного элемента, и он остывает: модель не теряется
  const nextSolo = fan313Stream({ "f313-t6-solo": fan313Refuse })
  const solo = await fan313Run("f313-t6-solo", "f313-t6-solo", ["f313-t6-solo"], nextSolo)
  expect(nextSolo.seen).toEqual(["f313-t6-solo"])
  expect(isCarrierRefusal(solo.value)).toBe(true)
  expect(deferCoolingAttemptModels(["f313-t6-x", "f313-t6-y"], FAN313_NOW).plan).toEqual(["f313-t6-x", "f313-t6-y"])
  expect(deferCoolingAttemptModels(["f313-t6-solo"], FAN313_NOW).plan).toEqual(["f313-t6-solo"])
  failoverBindReset()
})

test("#313 T7: собственная модель агента остывает -- план держит её последней", async () => {
  failoverBindReset()
  noteRungCarrierRefusal("f313-t7-own", FAN313_NOW)
  const next = fan313Stream({
    "f313-t7-own": () => fan313Ok("t7-own"),
    "f313-t7-step": fan313Refuse,
  })
  const out = await fan313Run("f313-t7", "f313-t7-own", ["f313-t7-step"], next)
  expect(next.seen, "собственная модель достигается после здоровой ступени").toEqual(["f313-t7-step", "f313-t7-own"])
  expect(out.value && out.value.text).toBe("OK-t7-own")
  expect(isModelCooling("f313-t7-own", FAN313_NOW + 1), "успех модели снимает её метку (#514 H3)").toBe(false)
  failoverBindReset()
})

test("#313 T8: дорога консультаций судит ТОЛЬКО отказ по времени", () => {
  const marks = new Map<string, any>([
    ["f313-cons-carrier", { at: 100, reason: "carrier-refusal" }],
    ["f313-cons-timeout", { at: 100, reason: "rung-timeout" }],
  ])
  const ladder = [{ model: "f313-cons-carrier" }, { model: "f313-cons-timeout" }, { model: "f313-cons-ready" }]
  const got = rungsAfterCooldown(ladder, 200, marks)
  expect(got.ladder, "метка отказа носителя ступень консультации НЕ выбрасывает").toEqual([{ model: "f313-cons-carrier" }, { model: "f313-cons-ready" }])
  expect(got.evidence).toEqual({
    rungCooldownSkipped: ["f313-cons-timeout"],
    "rungCooldownAgeMs_f313-cons-timeout": 100,
  })
})

test("#313 T9: дверь наблюдения называет причину метки", () => {
  const marks = new Map<string, any>([
    ["f313-t9-carrier", { at: 1000, reason: "carrier-refusal" }],
    ["f313-t9-timeout", { at: 2000, reason: "rung-timeout" }],
  ])
  const snap = cooldownSnapshot(61_000, marks)
  const reasons: { [m: string]: string } = {}
  for (const r of snap) reasons[r.model] = r.reason
  expect(reasons["f313-t9-carrier"]).toBe("carrier-refusal")
  expect(reasons["f313-t9-timeout"]).toBe("rung-timeout")
  const lines = ladderCommandText(61_000, "", marks).split("\n")
  const carrierLine = lines.filter((l) => l.indexOf("f313-t9-carrier") >= 0)
  const timeoutLine = lines.filter((l) => l.indexOf("f313-t9-timeout") >= 0)
  expect(carrierLine.length).toBe(1)
  expect(timeoutLine.length).toBe(1)
  expect(carrierLine[0]).toContain("carrier-refusal")
  expect(carrierLine[0].indexOf("rung-timeout")).toBe(-1)
  expect(timeoutLine[0]).toContain("rung-timeout")
  expect(timeoutLine[0].indexOf("carrier-refusal")).toBe(-1)
})

test("#313 T10: один дом предиката -- граница окна у трёх читателей одна", () => {
  const marks = new Map<string, any>([["f313-t10-edge", { at: 1000, reason: "rung-timeout" }]])
  const edge = 1000 + RUNG_COOLDOWN_MS
  // мусорный ключ не бросает
  expect(isModelCooling("f313-no-such-key", edge, marks)).toBe(false)
  expect(isModelCooling("f313-t10-edge", edge, marks), "граница включающая").toBe(true)
  // фильтр консультаций
  const ladder = [{ model: "f313-t10-edge" }, { model: "f313-t10-ready" }]
  expect(rungsAfterCooldown(ladder, edge, marks).ladder).toEqual([{ model: "f313-t10-ready" }])
  // дверь наблюдения
  expect(cooldownSnapshot(edge, marks)).toStrictEqual([{ model: "f313-t10-edge", leftMs: 0, reason: "rung-timeout" }])
  // веер: остывающая уходит в хвост и не удаляется
  expect(deferCoolingAttemptModels(["f313-t10-edge", "f313-t10-ready"], edge, marks).plan)
    .toEqual(["f313-t10-ready", "f313-t10-edge"])
})

test("#313 R: дверь сброса меток -- вторая проверка с чистого листа", () => {
  rungCooldownReset()
  noteRungCarrierRefusal("f313-r-door", 1000)
  expect(isModelCooling("f313-r-door", 1001)).toBe(true)
  rungCooldownReset()
  expect(isModelCooling("f313-r-door", 1001), "после сброса модель годна").toBe(false)
  expect(cooldownSnapshot(1001)).toStrictEqual([])
})

// CONSTRAINT: семь наблюдательских регистраций не дёргаются решающими
// зубами; снимок поверхности поле catch не отражает. Равенство множеств
// (подписка vs .catch получил обработчик) краснеет и на снятии catch с
// существующей регистрации, и на новой подписке без обработчика. Род:
// turn.step -- async function* (валидатор хоста), остальные восемь --
// обычная функция; зуб, не различающий род, пропустит подмену стрима.
test("catch: каждое подписанное событие несёт обработчик отказа, род совпадает с формой события", () => {
  const subscribed = new Set<string>()
  const caught = new Set<string>()
  const handlers: Array<{ ev: string; h: any }> = []
  register(((ev: string, ..._rest: any[]) => {
    subscribed.add(ev)
    return {
      catch: (h: any) => {
        caught.add(ev)
        handlers.push({ ev, h })
      },
    }
  }) as any)
  expect(subscribed.size, "подписки непусты -- иначе равенство пустых множеств вакуумно").toBeGreaterThan(0)
  expect([...caught].sort(), "события с обработчиком отказа = события подписки").toEqual([...subscribed].sort())
  const step = handlers.filter(x => x.ev === "turn.step")
  expect(step.length, "turn.step -- одна стримовая регистрация").toBe(1)
  expect(step[0].h.constructor.name, "turn.step -- async-генератор").toBe("AsyncGeneratorFunction")
  const others = handlers.filter(x => x.ev !== "turn.step")
  // CONSTRAINT (stale-agents Д6, Д8, FIX1): +2 регистрации -- session.end, command.run{catalyst-fleet}; fleet_status обслуживает основная tool.call, второй tool.call у плагина нет.
  // CONSTRAINT (#531 Р2): +30 регистраций classic.* -- CLASSIC_EVENTS без PreToolUse, PostToolUse, MessageDisplay.
  expect(others.length, "остальные сорок регистраций -- не стрим").toBe(40)
  for (const x of others) {
    expect(typeof x.h, `${x.ev} несёт функцию`).toBe("function")
    expect(x.h.constructor.name, `${x.ev} не async-генератор`).not.toBe("AsyncGeneratorFunction")
    expect(x.h.constructor.name, `${x.ev} не sync-генератор`).not.toBe("GeneratorFunction")
  }
})

// CONSTRAINT (#393): окна часов держатся дальше 5000 мс от соседей по файлу
// (worldMemo уровня модуля, раннер -- один процесс на файл).
test("envBundle (#393): отказ чтения ручки виден поимённо в UNREADABLE, без отказов -- пустой массив", async () => {
  await drainFold393()
  const files: Record<string, string> = {
    "/wU1/.claude/probes/probes.toml": "[failover]\nenabled = true\n",
  }
  // Порядок -- порядок чтения в envBundle (register.ts:1921..1951).
  const ALL16 = [
    "CLAUDE_JUDGE_CARRIER", "CLAUDE_JUDGE", "CLAUDE_JUDGE_MODEL", "CLAUDE_JUDGE_PROMPT",
    "CLAUDE_JUDGE_TIMEOUT_MS", "CLAUDE_FORM_CARRIER", "CLAUDE_FORM", "CLAUDE_IDLE_CARRIER",
    "CLAUDE_IDLE", "CLAUDE_PROBES", "CLAUDE_PROMPTS", "CLAUDE_PROBES_DIR", "CLAUDE_CONFIG_DIR",
    "HOME", "PWD", "CATALYST_ROUTING_TABLE",
  ]
  const bad = fsEnv$(files, { HOME: "/hhU1", PWD: "/wU1" }, 95_200_000, ALL16)
  const w = await worldFor(bad.$)
  expect(w.env.UNREADABLE, "каждая из 16 ручек -- поимённо, отсортировано")
    .toEqual(ALL16.slice().sort())
  const good = fsEnv$(files, { HOME: "/hhU1b", PWD: "/wU1b" }, 95_200_000)
  const wg = await worldFor(good.$)
  expect(wg.env.UNREADABLE, "без отказов чтения UNREADABLE пуст -- «ручка не закреплена» не подмешивается").toEqual([])
})

// --- #393-A2: 29 пустых catch -- отказ обязан быть виден ------------------------
//
// CONSTRAINT: у каждого зуба свои каталоги, своё значение ручек и свой сид:
// дедупи, мемо и зеркала модуля переживают зубы (один процесс на файл), и без
// этого сосед молча менял бы смысл зуба. Убеждается каждый зуб, которому нужен
// чистый старт (sweepDone, sidMemo), -- через command.run clear.
// Хук сброса зовётся с настоящим $ стенда: пустой $ ронял запись хвоста и оставлял journalWriteErr и lost следующему зубу.

function lostSnap393(): Record<string, { n: number; last: string }> {
  return registerModule393.lostWritesSnapshot()
}

function lostN393(site: string): number {
  const snap = lostSnap393()
  return snap[site] ? Number(snap[site].n) : 0
}

type Fail393 = {
  fsWrite?: (path: string, text: string) => boolean
  fsReadErr?: string[]
  fsReadPoison?: string[]
  envPoison?: string[]
  toast?: boolean
  storeGet?: (key: string) => boolean
  storeSet?: (key: string) => boolean
  storeDelete?: (key: string) => boolean
  storeKeys?: () => boolean
  agentList?: () => boolean
  everyCancel?: boolean
}

// CONSTRAINT (#514 FIX2 Д2): предел вызовов двери паузы на один стенд. Зуб,
// ушедший в цикл ожидания, падает названным броском, а не растит память
// процесса харнеса без предела (26.09 мак упал: прогоны по 18-42 GiB).
const STAND_PROC_CALL_CAP = 2000

function mod$393(o: {
  files?: Record<string, string>
  env?: Record<string, string>
  now?: number
  sid?: string
  stored?: Record<string, unknown>
  answers?: any[]
  envRefuses?: string[]
  fail?: Fail393
  // CONSTRAINT (#514): двери process/messages -- ТОЛЬКО по заказу зуба. Без
  // заказа двери process нет вовсе (как у движкового харнеса: «no
  // implementation for process.run»), и ожидание исчерпанного шага выходит
  // названной записью, а не циклом на неподвижных часах.
  proc?: (argv: string[], init: any, setNow: (n: number) => void, getNow: () => number) => Promise<any>
  messages?: (arg: any) => any
}) {
  hostMemoReset()
  let now = o.now ?? 97_600_000
  const sid = o.sid ?? "sid-units"
  const writes: { path: string; text: string }[] = []
  const storeSets: { key: string; value: any }[] = []
  const storeDeletes: string[] = []
  const everyCbs: any[] = []
  // CONSTRAINT: clock.after стенда сам не срабатывает -- срок наступает только
  // явным вызовом cb зубом; отменённый таймер помечается и зубом не зовётся.
  const afterCbs: Array<{ ms: number; cb: any; cancelled: boolean }> = []
  const toasts: string[] = []
  const store = new Map<string, any>(Object.entries(o.stored || {}))
  const modelKey = {}
  const $: any = {
    clock: {
      now: async () => now,
      every: (_ms: number, cb: any) => {
        everyCbs.push(cb)
        return {
          cancel: () => { if (o.fail && o.fail.everyCancel) throw new Error("clock.every: scripted cancel refusal") },
        }
      },
      after: (ms: number, cb: any) => {
        const h = { ms, cb, cancelled: false }
        afterCbs.push(h)
        return { cancel: () => { h.cancelled = true } }
      },
    },
    env: {
      get: async (k: string) => {
        if (o.fail && (o.fail.envPoison || []).indexOf(k) >= 0) {
          return { toString() { throw new Error("poison") } }
        }
        if ((o.envRefuses || []).indexOf(k) >= 0) throw new Error("env.get: scripted read refusal for " + k)
        return (o.env || {})[k] ?? ""
      },
    },
    fs: {
      read: async (p: string) => {
        if (o.fail && (o.fail.fsReadPoison || []).indexOf(p) >= 0) {
          throw { toString() { throw new Error("poison") } }
        }
        if (o.fail && (o.fail.fsReadErr || []).indexOf(p) >= 0) throw new Error("EIO: scripted read refusal for " + p)
        const t = (o.files || {})[p]
        if (t === undefined) throw new Error("ENOENT " + p)
        return t
      },
      write: async (p: string, text: string) => {
        if (o.fail && o.fail.fsWrite && o.fail.fsWrite(String(p), String(text))) {
          throw new Error("EIO: scripted write refusal for " + p)
        }
        writes.push({ path: String(p), text: String(text) })
        if (String(p).includes('/form/records/')) (o.files || (o.files = {}))[String(p)] = String(text)
      },
    },
    store: {
      get: async (k: string) => {
        if (o.fail && o.fail.storeGet && o.fail.storeGet(String(k))) throw new Error("store.get: scripted refusal for " + k)
        return store.get(String(k))
      },
      set: async (k: string, v: any) => {
        if (o.fail && o.fail.storeSet && o.fail.storeSet(String(k))) throw new Error("store.set: scripted refusal for " + k)
        store.set(String(k), v)
        storeSets.push({ key: String(k), value: v })
      },
      delete: async (k: string) => {
        if (o.fail && o.fail.storeDelete && o.fail.storeDelete(String(k))) throw new Error("store.delete: scripted refusal for " + k)
        store.delete(String(k))
        storeDeletes.push(String(k))
      },
      keys: async () => {
        if (o.fail && o.fail.storeKeys && o.fail.storeKeys()) throw new Error("store.keys: scripted refusal")
        return [...store.keys()]
      },
    },
    session: { id: async () => sid, messages: async (arg: any) => (o.messages ? o.messages(arg) : []) },
    agent: {
      list: async () => {
        if (o.fail && o.fail.agentList && o.fail.agentList()) throw new Error("agent.list: scripted refusal")
        return []
      },
    },
    model: {
      complete: async (arg: any) => {
        if (standModelOver(modelKey)) throw new Error(STAND_MODEL_CAP_TEXT)
        const a = (o.answers || []).shift()
        if (a === undefined) throw new Error("model.complete: no answer scripted for " + String(arg && arg.model))
        return a
      },
    },
    command: { register: async () => {} },
    ui: {
      toast: async (text: string) => {
        if (o.fail && o.fail.toast) throw new Error("scripted toast refusal")
        toasts.push(String(text))
      },
    },
  }
  if (o.proc) {
    const proc = o.proc
    let procCalls = 0
    $.process = {
      run: async (argv: string[], init: any) => {
        procCalls++
        if (procCalls > STAND_PROC_CALL_CAP) throw new Error("stand: process.run call cap " + String(STAND_PROC_CALL_CAP))
        return proc(argv, init, (n: number) => { now = n }, () => now)
      },
    }
  }
  return { $, writes, files: o.files || (o.files = {}), storeSets, storeDeletes, store, everyCbs, afterCbs, toasts, setNow: (n: number) => { now = n }, getNow: () => now }
}

function subs393(): Array<{ ev: string; matcher: any; fn: any }> {
  const subs: Array<{ ev: string; matcher: any; fn: any }> = []
  register((...a: any[]) => {
    if (a.length >= 3) subs.push({ ev: a[0], matcher: a[1], fn: a[2] })
    else subs.push({ ev: a[0], matcher: null, fn: a[1] })
    return { catch: () => {} }
  })
  return subs
}

function hook393(subs: Array<{ ev: string; matcher: any; fn: any }>, ev: string): any {
  const hit = subs.filter(s => s.ev === ev && !s.matcher)
  expect(hit.length, ev + " -- ровно одна подписка без матчера").toBe(1)
  return hit[0].fn
}

async function clear393(m: { $: any } = mod$393({})): Promise<void> {
  const subs = subs393()
  const cl = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)
  await cl[0].fn(m.$, { command: "clear", args: "" }, async (e: any) => e)
  await settle393()
}

function shards393(writes: { path: string; text: string }[], infix: string): any[] {
  return writes
    .filter(w => String(w.path).indexOf(infix) >= 0)
    .map(w => { try { return JSON.parse(String(w.text)) } catch (x) { return null } })
    .filter(r => r)
}

function sweeps393(writes: { path: string; text: string }[]): number {
  return shards393(writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep").length
}

async function settle393(): Promise<void> {
  for (let i = 0; i < 500; i++) await Promise.resolve()
}

// CONSTRAINT: сброс сам называет потерю (отмена таймера), а слить её может только удачная запись ПОСЛЕ него; зубы, сравнивающие перенос и lostWrites на равенство, стартуют с пустого состояния, а не с оставленного соседом; хвост второго сброса обязан быть пуст: непустой = шаг возник между записью и сбросом, и его перенос ушёл бы мимо проверки.
async function drainFold393(): Promise<any[]> {
  failoverFoldReset()
  const m = mod$393({
    files: { "/probes-drain/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-drain" },
    now: 98_799_000,
  })
  const world = { globalHome: "/probes-drain" }
  await failoverFoldObserve(m.$, world, 98_799_001, "sticky-drain", "sid-drain", "ag-drain")
  await failoverFoldFlush(m.$, world)
  const tail2 = failoverFoldReset()
  if (tail2 !== null)
    throw new Error("drainFold393: второй сброс вернул хвост: " + JSON.stringify(tail2.rec))
  const left = Object.keys(registerModule393.lostWritesSnapshot())
  if (failoverFoldWriteErr() !== "" || failoverFoldResetLost() !== 0 || failoverFoldSplitLost() !== 0 || left.length !== 0)
    throw new Error("drainFold393: состояние не слито: err=" + JSON.stringify(failoverFoldWriteErr()) + " reset=" + failoverFoldResetLost() + " split=" + failoverFoldSplitLost() + " lost=" + left.join(","))
  return shards393(m.writes, "/failover/journal.jsonl.shard.")
}

function judgeFiles393(home: string): Record<string, string> {
  return {
    [home + "/probes.toml"]: '[probe.judge]\nmodels = ["m1"]\n',
    [home + "/judge/prompt.md"]: "JUDGE PROMPT",
  }
}

test("#393-A2 B(1286) prompt-applied-record: отказ записи applied- назван", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-a2-1286/probes.toml": '[prompt.pr1]\ntool = "Read"\ntext = "RULE-A2-1286"\n' },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-1286", PWD: "/work-a2-1286" },
    now: 97_601_000,
    fail: { fsWrite: (p) => p.indexOf("/prompts/records/applied-") >= 0 },
  })
  const out = await hook393(subs393(), "tool.describe")(m.$, { tool: "Read", description: "Base" }, async (e: any) => e)
  expect(out.description, "поведение пути не изменилось: текст применён").toContain("RULE-A2-1286")
  expect(lostN393("prompt-applied-record") >= 1, "отказ записи назван местом").toBe(true)
})

test("#393-A2 B(2039) journal-carrier-foreign: отказ журнала чужого носителя назван", async () => {
  await drainFold393()
  const m = mod$393({
    files: judgeFiles393("/probes-a2-2039"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-2039", PWD: "/work-a2-2039", CLAUDE_JUDGE: "1", CLAUDE_JUDGE_CARRIER: "patch-a2-2039" },
    now: 97_602_000,
    fail: { fsWrite: (p) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(String(out.deny)).toContain("patch-a2-2039")
  expect(lostN393("journal-carrier-foreign") >= 1).toBe(true)
})

test("#393-A2 B(2069) journal-carrier-env-unreadable: отказ журнала нечитаемой ручки назван", async () => {
  await drainFold393()
  const m = mod$393({
    files: judgeFiles393("/probes-a2-2069"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-2069", PWD: "/work-a2-2069", CLAUDE_JUDGE: "1", CLAUDE_JUDGE_CARRIER: "mod" },
    envRefuses: ["CLAUDE_JUDGE"],
    now: 97_603_000,
    fail: { fsWrite: (p) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(String(out.deny)).toContain("CLAUDE_JUDGE")
  expect(lostN393("journal-carrier-env-unreadable") >= 1).toBe(true)
})

test("#393-A2 B(2157) journal-admission-refused: отказ журнала слоя допуска назван", async () => {
  await drainFold393()
  const m = mod$393({
    files: {
      "/probes-a2-2157/probes.toml": "[probe.judge]\n",
      "/tbl-a2-2157/routing-table.toml": '[classes.x]\nallowed = ["m"]\n',
    },
    env: {
      CLAUDE_PROBES_DIR: "/probes-a2-2157", PWD: "/work-a2-2157", CLAUDE_JUDGE: "0",
      CATALYST_ROUTING_TABLE: "/tbl-a2-2157/routing-table.toml", HOME: "/hh-a2-2157",
    },
    now: 97_604_000,
    fail: {
      fsReadErr: ["/hh-a2-2157/.claude/catalyst/routing-override.toml"],
      fsWrite: (p) => p.indexOf("/failover/journal.jsonl") >= 0,
    },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Read" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(lostN393("journal-admission-refused") >= 1).toBe(true)
})

test("#393-A2 B(2222) journal-store-sweep: отказ журнала уборки назван", async () => {
  await drainFold393()
  await clear393()
  const m = mod$393({
    files: judgeFiles393("/probes-a2-2222"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-2222", PWD: "/work-a2-2222", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 97_605_000,
    stored: { "v:judge:stale-a2222": { kind: "BLOCK", rest: "no t" } },
    answers: ["OK: a2-2222"],
    fail: { fsWrite: (p) => p.indexOf("/judge/journal.jsonl") >= 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p-a2222", subagent_type: "scout" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(lostN393("journal-store-sweep") >= 1).toBe(true)
})

test("#393-A2 B(2351) judge-record-inflight: отказ предзаписи несёт inflightWriteErr", async () => {
  await clear393()
  const m = mod$393({
    files: judgeFiles393("/probes-a2-2351"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-2351", PWD: "/work-a2-2351", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 97_606_000,
    answers: ["OK: a2-2351"],
    fail: { fsWrite: (p, t) => p.indexOf("/judge/records/") >= 0 && t.indexOf('"inflight":true') >= 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p-a2351", subagent_type: "scout", tool_use_id: "tu-a2351" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  // CONSTRAINT: журнал консультации пишется ПОСЛЕ предзаписи и забирает ключ
  // полем lost -- снапшот к моменту возврата хука уже осушен (дизайн #393-A2).
  const jline = shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.verdict !== undefined)
  expect(jline.length).toBe(1)
  expect(jline[0].lost && jline[0].lost["judge-record-inflight"] ? jline[0].lost["judge-record-inflight"].n : 0,
    "отказ предзаписи уехал полем lost").toBeGreaterThanOrEqual(1)
  const recs = m.writes
    .filter(w => w.path.indexOf("/judge/records/mod-tu-a2351.json") >= 0)
    .map(w => JSON.parse(String(w.text)))
  expect(recs.length, "финальная улика легла").toBe(1)
  expect(String(recs[0].inflightWriteErr), "отказ предзаписи назван в финальной улике").toContain("scripted write refusal")
})

test("#393-A2 B(2519) judge-record: отказ финальной улики назван", async () => {
  await clear393()
  const m = mod$393({
    files: judgeFiles393("/probes-a2-2519"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-2519", PWD: "/work-a2-2519", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 97_607_000,
    answers: ["OK: a2-2519"],
    fail: { fsWrite: (p, t) => p.indexOf("/judge/records/") >= 0 && t.indexOf('"inflight":true') < 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p-a2519", subagent_type: "scout" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  // CONSTRAINT: журнальная строка пишется ПОСЛЕ финальной улики и забирает ключ
  // полем lost -- снапшот к моменту возврата хука уже осушен (дизайн #393-A2).
  const jline = shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.verdict !== undefined)
  expect(jline.length).toBe(1)
  expect(jline[0].lost && jline[0].lost["judge-record"] ? jline[0].lost["judge-record"].n : 0,
    "отказ финальной улики уехал полем lost").toBeGreaterThanOrEqual(1)
})

test("#393-A2 B(2536) judge-record-journalErr: отказ дублирующей записи назван", async () => {
  await drainFold393()
  await clear393()
  const m = mod$393({
    files: judgeFiles393("/probes-a2-2536"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-2536", PWD: "/work-a2-2536", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 97_608_000,
    answers: ["OK: a2-2536"],
    fail: { fsWrite: (p, t) => p.indexOf("/judge/journal.jsonl") >= 0 || (p.indexOf("/judge/records/") >= 0 && t.indexOf('"journalErr"') >= 0) },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p-a2536", subagent_type: "scout" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(lostN393("judge-record-journalErr") >= 1).toBe(true)
})

test("#393-A2 B(2650) journal-form-vocab-refused: отказ журнала словаря назван", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-a2-2650/probes.toml": FORM_CFG_335 },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-2650", PWD: "/work-a2-2650", CLAUDE_FORM: "1" },
    now: 97_609_000,
    fail: { fsWrite: (p) => p.indexOf("/form/journal.jsonl") >= 0 },
  })
  verdictVocabSeed([{ probe: "form", emits: "", folds: "" }])
  try {
    const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Write", file_path: "/work-a2-2650/report.md", content: "заголовок\n" }, async (e: any) => e)
    expect(String(out.deny)).toContain("Form probe refused")
    expect(lostN393("journal-form-vocab-refused") >= 1).toBe(true)
  } finally {
    verdictVocabReset()
  }
})

test("#393-A2 B(2679) form-record: отказ записи улики формы назван", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-a2-2679/probes.toml": FORM_CFG_335 },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-2679", PWD: "/work-a2-2679", CLAUDE_FORM: "1" },
    now: 97_610_000,
    fail: { fsWrite: (p) => p.indexOf("/form/records/") >= 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Write", file_path: "/work-a2-2679/report.md", content: "строка с zzz-legalize внутри\n" }, async (e: any) => e)
  expect(out.deny, "act=log_only: отказ записи не гасит вызов").toBe(undefined)
  expect(lostN393("form-record") >= 1).toBe(true)
})

test("#393-A2 B(3006) journal-when-bad: отказ журнала мёртвого правила назван", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-a2-3006/probes.toml": '[probe.dead3006]\nkind = "consult"\non = ["PreToolUse"]\n[probe.dead3006.when]\nfield = "tool"\nmatches = "Age(nt"\n' },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-3006", PWD: "/work-a2-3006" },
    now: 97_611_000,
    fail: { fsWrite: (p) => p.indexOf("/dead3006/journal.jsonl") >= 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(lostN393("journal-when-bad") >= 1).toBe(true)
})

test("#393-A2 B(3019) journal-skip-disabled: отказ журнала выключенного судьи назван", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-a2-3019/probes.toml": "[probe.judge]\nenabled = false\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-3019", PWD: "/work-a2-3019", CLAUDE_JUDGE: "1" },
    now: 97_612_000,
    fail: { fsWrite: (p) => p.indexOf("/judge/journal.jsonl") >= 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "x" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(lostN393("journal-skip-disabled") >= 1).toBe(true)
})

test("#393-A2 B(3075) journal-skip: отказ журнала пропуска назван", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-a2-3075/probes.toml": '[probe.judge]\n[probe.judge.filter]\nclasses_skip = ["skipme"]\n' },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-3075", PWD: "/work-a2-3075", CLAUDE_JUDGE: "1" },
    now: 97_613_000,
    fail: { fsWrite: (p) => p.indexOf("/judge/journal.jsonl") >= 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "[dispatch-class:skipme] x" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(lostN393("journal-skip") >= 1).toBe(true)
})

test("#393-A2 B(3134) judge-memo-record: отказ дублирующей записи мемо назван", async () => {
  await drainFold393()
  await clear393()
  const prompt = "p-a23134"
  const vkey = verdictKey("judge", "sid-units", "Agent", "scout", prompt)
  const m = mod$393({
    files: judgeFiles393("/probes-a2-3134"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-3134", PWD: "/work-a2-3134", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 97_614_000,
    stored: { [vkey]: { kind: "BLOCK", rest: "cached-a23134", t: 97_614_000, dtMs: 3 } },
    fail: { fsWrite: (p, t) => p.indexOf("/judge/journal.jsonl") >= 0 || (p.indexOf("/judge/records/") >= 0 && t.indexOf('"journalErr"') >= 0) },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt, subagent_type: "scout" }, async (e: any) => e)
  expect(String(out.deny)).toContain("cached-a23134")
  expect(lostN393("judge-memo-record") >= 1).toBe(true)
})

test("#393-A2 B(3222) journal-empty-ladder: отказ журнала пустой лестницы назван", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-a2-3222/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-3222", PWD: "/work-a2-3222" },
    now: 97_615_000,
    fail: { fsWrite: (p) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const out = await hook393(subs393(), "agent.spawn")(m.$, { subagentType: "any", prompt: "[dispatch-class:x] q", model: "m" }, async () => ({ agentId: "ag-a23222" }))
  expect(out.agentId).toBe("ag-a23222")
  expect(lostN393("journal-empty-ladder") >= 1).toBe(true)
})

test("#393-A2 B(3372) journal-rung-effort-refused: отказ журнала негодной ступени назван", async () => {
  await drainFold393()
  failoverBindReset()
  const m = mod$393({
    files: { "/probes-a2-3372/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-3372" },
    now: 97_616_000,
    fail: { fsWrite: (p) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  failoverBindSet("ag-a23372", { ladder: ["bare-a23372"], rungEffort: {}, subagentType: "t", class: "", sticky: "busy-a23372" })
  // CONSTRAINT: удачная попытка 0 возвращает управление ДО ступени -- исходная
  // модель обязана отказать носителем, иначе отказ негодной ступени недостижим.
  const refuse: any = () => (async function* () { return { usage: null, stopReason: null } })()
  await drainStream(hook393(subs393(), "turn.step")(m.$, {
    agentId: "ag-a23372", turnId: "t-a23372", index: 0, model: "busy-a23372", messageCount: 1,
  }, refuse))
  expect(lostN393("journal-rung-effort-refused") >= 1).toBe(true)
  failoverBindReset()
})

test("#393-A2 B(3444) failover-fold-journal: отказ журнала попытки назван", async () => {
  await drainFold393()
  failoverBindReset()
  const m = mod$393({
    files: { "/probes-a2-3444/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-3444" },
    now: 97_617_000,
    fail: { fsWrite: (p) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  failoverBindSet("ag-a23444", { ladder: ["r-a23444"], rungEffort: { "r-a23444": "max" }, subagentType: "t", class: "", sticky: "busy-a23444" })
  const refuse: any = () => (async function* () { return { usage: null, stopReason: null } })()
  const out = await drainStream(hook393(subs393(), "turn.step")(m.$, {
    agentId: "ag-a23444", turnId: "t-a23444", index: 0, model: "busy-a23444", messageCount: 1,
  }, refuse))
  expect(isCarrierRefusal(out.value), "последний отказ носителя возвращён вызывающему").toBe(true)
  expect(lostN393("failover-fold-journal") >= 1).toBe(true)
  failoverBindReset()
})

test("#393-A2 appendJournal: lost едет следующей удачной записью и складывается", async () => {
  await drainFold393()
  await clear393()
  const files = { "/probes-a2-lost/probes.toml": '[probe.judge]\n[probe.judge.filter]\nclasses_skip = ["skipme"]\n' }
  const env = { CLAUDE_PROBES_DIR: "/probes-a2-lost", PWD: "/work-a2-lost", CLAUDE_JUDGE: "1" }
  const skipCall = (m: ReturnType<typeof mod$393>, prompt: string) =>
    hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "[dispatch-class:skipme] " + prompt }, async (e: any) => e)
  let fail = true
  const m = mod$393({ files, env, now: 97_618_000, fail: { fsWrite: (p) => fail && p.indexOf("/judge/journal.jsonl") >= 0 } })
  // смыв остатка от предыдущих зубов: удачная запись забирает накопитель целиком
  fail = false
  await skipCall(m, "flush-a2-lost")
  expect(lostN393("journal-skip")).toBe(0)
  // отказ места: ключ в накопителе
  fail = true
  await skipCall(m, "one-a2-lost")
  expect(lostN393("journal-skip")).toBe(1)
  // следующая удачная запись несёт lost и очищает накопитель
  fail = false
  await skipCall(m, "two-a2-lost")
  const carry = shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "skip")
  expect(carry.length).toBe(2)
  expect(carry[1].lost && carry[1].lost["journal-skip"] ? carry[1].lost["journal-skip"].n : 0).toBe(1)
  expect(lostN393("journal-skip")).toBe(0)
  // отказ самой записи возвращает ключ в накопитель со сложением
  fail = true
  await skipCall(m, "three-a2-lost")
  await skipCall(m, "four-a2-lost")
  expect(lostN393("journal-skip")).toBe(2)
  fail = false
  await skipCall(m, "five-a2-lost")
  const carry2 = shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "skip")
  expect(carry2.length).toBe(3)
  expect(carry2[2].lost && carry2[2].lost["journal-skip"] ? carry2[2].lost["journal-skip"].n : 0).toBe(2)
  expect(lostN393("journal-skip")).toBe(0)
})

test("#393-A2 appendJournal: несериализуемый объект бросает и метит journalWriteErr", async () => {
  await drainFold393()
  failoverBindReset()
  let fail = true
  const m = mod$393({
    files: { "/probes-a2-circ/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-circ" },
    now: 97_619_000,
    fail: { fsWrite: (p) => fail && p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  failoverBindSet("ag-a2circ", { ladder: ["r-a2circ"], rungEffort: { "r-a2circ": "max" }, subagentType: "t", class: "", sticky: "busy-a2circ" })
  const refuse: any = () => (async function* () { return { usage: null, stopReason: null } })()
  const circ: any = {}
  circ.self = circ
  const step = hook393(subs393(), "turn.step")
  await drainStream(step(m.$, { agentId: "ag-a2circ", turnId: circ, index: 0, model: "busy-a2circ", messageCount: 1 }, refuse))
  expect(lostN393("failover-fold-journal") >= 1, "бросок сериализации дошёл до catch места").toBe(true)
  fail = false
  await drainStream(step(m.$, { agentId: "ag-a2circ", turnId: "t-clean-a2circ", index: 0, model: "busy-a2circ", messageCount: 1 }, refuse))
  const lines = shards393(m.writes, "/failover/journal.jsonl.shard.").filter(r => r.attempt !== undefined)
  expect(lines.length).toBe(2)
  expect(String(lines[0].journalWriteErr || ""), "след отказавшей сериализации уехал следующей записью").toContain("/failover/journal.jsonl")
  failoverBindReset()
})

test("#393-A2 journalWriteErr переживает /clear", async () => {
  await clear393()
  const files = { "/probes-a2-clear/probes.toml": '[probe.judge]\n[probe.judge.filter]\nclasses_skip = ["skipme"]\n' }
  const env = { CLAUDE_PROBES_DIR: "/probes-a2-clear", PWD: "/work-a2-clear", CLAUDE_JUDGE: "1" }
  let fail = true
  const m = mod$393({ files, env, now: 97_620_000, fail: { fsWrite: (p) => fail && p.indexOf("/judge/journal.jsonl") >= 0 } })
  const call = () => hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "[dispatch-class:skipme] p" }, async (e: any) => e)
  await call()
  await clear393()
  fail = false
  await call()
  const lines = shards393(m.writes, "/judge/journal.jsonl.shard.")
  expect(lines.length).toBe(1)
  expect(String(lines[0].journalWriteErr || ""), "след не снят сменой сессии").toContain("/judge/journal.jsonl")
})

test("#393-A2 дедуп(2039): отказ записи снимает ключ -- второй отказ пишет строку", async () => {
  let fail = true
  const m = mod$393({
    files: judgeFiles393("/probes-a2-d2039"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-d2039", PWD: "/work-a2-d2039", CLAUDE_JUDGE: "1", CLAUDE_JUDGE_CARRIER: "patch-a2-d2039" },
    now: 97_621_000,
    fail: { fsWrite: (p) => fail && p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const hook = hook393(subs393(), "tool.call")
  const out1 = await hook(m.$, { tool: "Agent", prompt: "a" }, async (e: any) => e)
  expect(String(out1.deny)).toContain("patch-a2-d2039")
  fail = false
  const out2 = await hook(m.$, { tool: "Task", prompt: "b" }, async (e: any) => e)
  expect(String(out2.deny)).toContain("patch-a2-d2039")
  const recs = shards393(m.writes, "/failover/journal.jsonl.shard.").filter(r => r.rec === "carrier-foreign-refused")
  expect(recs.length, "первая запись отказала -- вторая обязана лечь").toBe(1)
})

test("#393-A2 дедуп(2069): отказ записи снимает ключ -- второй отказ пишет строку", async () => {
  let fail = true
  const m = mod$393({
    files: judgeFiles393("/probes-a2-d2069"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-d2069", PWD: "/work-a2-d2069", CLAUDE_JUDGE: "1", CLAUDE_JUDGE_CARRIER: "mod" },
    envRefuses: ["CLAUDE_JUDGE"],
    now: 97_622_000,
    fail: { fsWrite: (p) => fail && p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const hook = hook393(subs393(), "tool.call")
  const out1 = await hook(m.$, { tool: "Agent", prompt: "a" }, async (e: any) => e)
  expect(String(out1.deny)).toContain("CLAUDE_JUDGE")
  fail = false
  const out2 = await hook(m.$, { tool: "Task", prompt: "b" }, async (e: any) => e)
  expect(String(out2.deny)).toContain("CLAUDE_JUDGE")
  const recs = shards393(m.writes, "/failover/journal.jsonl.shard.").filter(r => r.rec === "carrier-env-unreadable-refused")
  expect(recs.length).toBe(1)
})

test("#393-A2 дедуп(2157): отказ записи снимает ключ -- второй отказ пишет строку", async () => {
  let fail = true
  const m = mod$393({
    files: {
      "/probes-a2-d2157/probes.toml": "[probe.judge]\n",
      "/tbl-a2-d2157/routing-table.toml": '[classes.x]\nallowed = ["m"]\n',
    },
    env: {
      CLAUDE_PROBES_DIR: "/probes-a2-d2157", PWD: "/work-a2-d2157", CLAUDE_JUDGE: "0",
      CATALYST_ROUTING_TABLE: "/tbl-a2-d2157/routing-table.toml", HOME: "/hh-a2-d2157",
    },
    now: 97_623_000,
    fail: {
      fsReadErr: ["/hh-a2-d2157/.claude/catalyst/routing-override.toml"],
      fsWrite: (p) => fail && p.indexOf("/failover/journal.jsonl") >= 0,
    },
  })
  const hook = hook393(subs393(), "tool.call")
  await hook(m.$, { tool: "Read" }, async (e: any) => e)
  m.setNow(97_630_000)
  fail = false
  await hook(m.$, { tool: "Read" }, async (e: any) => e)
  const recs = shards393(m.writes, "/failover/journal.jsonl.shard.").filter(r => r.rec === "routing-admission-refused")
  expect(recs.length).toBe(1)
})

test("#393-A2-FIX1 уборка: store.keys бросает -- повтор не раньше SWEEP_RETRY_MS", async () => {
  await clear393()
  let keysFail = true
  const m = mod$393({
    files: judgeFiles393("/probes-a2-sw6"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-sw6", PWD: "/work-a2-sw6", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 97_631_000,
    answers: ["OK: sw6-one", "OK: sw6-two", "OK: sw6-three"],
    fail: { storeKeys: () => keysFail },
  })
  const hook = hook393(subs393(), "tool.call")
  const sweeps = () => shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep").length
  const out1 = await hook(m.$, { tool: "Agent", prompt: "p-sw6a", subagent_type: "scout" }, async (e: any) => e)
  expect(out1.deny).toBe(undefined)
  expect(sweeps()).toBe(0)
  // CONSTRAINT: журнал консультации забирает ключ уборки полем lost (дизайн #393-A2).
  const j1 = shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.verdict !== undefined)
  expect(j1.length).toBe(1)
  expect(j1[0].lost && j1[0].lost["judge-store-sweep"] ? j1[0].lost["judge-store-sweep"].n : 0,
    "отказ обхода уборки уехал полем lost").toBeGreaterThanOrEqual(1)
  keysFail = false
  m.setNow(97_631_000 + 1_000)
  const out2 = await hook(m.$, { tool: "Agent", prompt: "p-sw6b", subagent_type: "scout" }, async (e: any) => e)
  expect(out2.deny).toBe(undefined)
  expect(sweeps(), "через 1000 мс повтора нет").toBe(0)
  m.setNow(97_631_000 + 600_001)
  const out3 = await hook(m.$, { tool: "Agent", prompt: "p-sw6c", subagent_type: "scout" }, async (e: any) => e)
  expect(out3.deny).toBe(undefined)
  expect(sweeps(), "уборка, не прошедшая целиком, повторяется через SWEEP_RETRY_MS").toBe(1)
})

test("#393-A2-FIX2 B-F4b: окно повтора уборки считается от момента отказа, не от начала вызова", async () => {
  await clear393()
  const poison = "v:judge:poison-f2b4b"
  const m = mod$393({
    files: judgeFiles393("/probes-f2-b4b"),
    env: { CLAUDE_PROBES_DIR: "/probes-f2-b4b", PWD: "/work-f2-b4b", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poison]: { kind: "BLOCK", rest: "x", t: 900_000 } },
    answers: ["OK: f2b4b-a", "OK: f2b4b-b", "OK: f2b4b-c"],
    fail: { storeGet: (k: string) => k === poison },
  })
  // CONSTRAINT: часы двигаются ВНУТРИ уборки -- отказ фиксируется в 1 600 001,
  // а не в момент начала вызова (1 000 000).
  const origGet = m.$.store.get
  m.$.store.get = async (k: string) => {
    if (String(k) === poison) m.setNow(1_600_001)
    return origGet(k)
  }
  const hook = hook393(subs393(), "tool.call")
  const sweeps = () => shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep").length
  const consult = (p: string) => hook(m.$, { tool: "Agent", prompt: p, subagent_type: "scout" }, async (e: any) => e)

  await consult("f2b4b one")
  expect(sweeps(), "уборка состоялась, отказ зафиксирован в 1 600 001").toBe(1)

  m.setNow(1_600_002)
  await consult("f2b4b two")
  expect(sweeps(), "миг после отказа -- уборки нет").toBe(1)

  m.setNow(1_600_001 + 600_000)
  await consult("f2b4b three")
  expect(sweeps(), "через SWEEP_RETRY_MS от момента отказа уборка повторяется").toBe(2)
})

test("#393-A2-FIX2 B-F4c: откат часов за момент отказа разрешает повтор уборки", async () => {
  await clear393()
  const poison = "v:judge:poison-f2b4c"
  const m = mod$393({
    files: judgeFiles393("/probes-f2-b4c"),
    env: { CLAUDE_PROBES_DIR: "/probes-f2-b4c", PWD: "/work-f2-b4c", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1e15,
    stored: { [poison]: { kind: "BLOCK", rest: "x", t: 1e15 - 1000 } },
    answers: ["OK: f2b4c-a", "OK: f2b4c-b"],
    fail: { storeGet: (k: string) => k === poison },
  })
  const hook = hook393(subs393(), "tool.call")
  const sweeps = () => shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep").length
  const consult = (p: string) => hook(m.$, { tool: "Agent", prompt: p, subagent_type: "scout" }, async (e: any) => e)

  await consult("f2b4c one")
  expect(sweeps(), "уборка при 1e15 состоялась").toBe(1)

  m.setNow(1.7e12)
  await consult("f2b4c two")
  expect(sweeps(), "откат часов за момент отказа -- уборка повторяется").toBe(2)
})

test("#393-A2 уборка: store.delete бросает -- store_sweep несёт deleteFailed", async () => {
  await clear393()
  const m = mod$393({
    files: judgeFiles393("/probes-a2-sw7"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-sw7", PWD: "/work-a2-sw7", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 97_632_000,
    stored: { "v:judge:stale-sw7": { kind: "BLOCK", rest: "x" } },
    answers: ["OK: sw7"],
    fail: { storeDelete: (k) => k.indexOf("v:judge:") === 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p-sw7", subagent_type: "scout" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  const sweep = shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep")
  expect(sweep.length).toBe(1)
  expect(sweep[0].deleteFailed).toBe(1)
  expect(String(sweep[0].deleteErr)).toContain("store.delete")
  expect(sweep[0].lost && sweep[0].lost["judge-store-sweep-items"] ? sweep[0].lost["judge-store-sweep-items"].n : 0,
    "отказ сноса уехал полем lost самой записи store_sweep").toBeGreaterThanOrEqual(1)
})

test("#393-A2 уборка: store.get бросает -- ключ не сносится, readFailed назван", async () => {
  await clear393()
  const m = mod$393({
    files: judgeFiles393("/probes-a2-sw8"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-sw8", PWD: "/work-a2-sw8", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 97_633_000,
    stored: { "v:judge:stale-sw8": { kind: "BLOCK", rest: "x" } },
    answers: ["OK: sw8"],
    fail: { storeGet: (k) => k === "v:judge:stale-sw8" },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p-sw8", subagent_type: "scout" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  expect(m.storeDeletes, "нечитаемая запись не сносится").toEqual([])
  const sweep = shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep")
  expect(sweep.length).toBe(1)
  expect(sweep[0].readFailed).toBe(1)
  expect(sweep[0].lost && sweep[0].lost["judge-store-sweep-items"] ? sweep[0].lost["judge-store-sweep-items"].n : 0,
    "отказ чтения уехал полем lost самой записи store_sweep").toBeGreaterThanOrEqual(1)
})

test("#393-A2 флот неизвестен: idle-watch молчит, причина уходит в when_bad", async () => {
  const m = mod$393({
    files: {
      "/probes-a2-live/probes.toml":
        '[probe.idle-watch]\nact = "log_only"\nwindow_min = 0\n[probe.live393]\nkind = "consult"\non = ["PreToolUse"]\n[probe.live393.when]\nfield = "live_works"\ncount_below = 1\n',
    },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-live", PWD: "/work-a2-live", CLAUDE_IDLE: "1" },
    now: 97_634_000,
    fail: { agentList: () => true },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Read" }, async (e: any) => e)
  expect(out.deny).toBe(undefined)
  await settle393()
  const bad = shards393(m.writes, "/journal.jsonl.shard.").filter(r => r.outcome === "when_bad")
  expect(bad.length, "обе пробы отчитались о неизвестном поле").toBe(2)
  for (const r of bad) expect(String(r.whenBad)).toContain("unknown=live_works")
  expect(m.writes.filter(w => w.path.indexOf("/records/") >= 0), "консультаций не было").toEqual([])
  expect(shards393(m.writes, "/journal.jsonl.shard.").filter(r => r.verdict !== undefined), "ни одного вердикта").toEqual([])
  expect(bad.filter(r => r.lost && r.lost["agent-list"]).length,
    "отказ agent.list уехал полем lost записи when_bad").toBeGreaterThanOrEqual(1)
})

test("#393-A2 кэш вердикта: отказ store.set несёт cacheErr в улике", async () => {
  await clear393()
  const m = mod$393({
    files: judgeFiles393("/probes-a2-cache"),
    env: { CLAUDE_PROBES_DIR: "/probes-a2-cache", PWD: "/work-a2-cache", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 97_635_000,
    answers: ["BLOCK: cache-a2"],
    fail: { storeSet: (k) => k.indexOf("v:judge:") === 0 },
  })
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p-cache", subagent_type: "scout", tool_use_id: "tu-cache" }, async (e: any) => e)
  expect(String(out.deny)).toContain("cache-a2")
  const recs = m.writes
    .filter(w => w.path.indexOf("/judge/records/mod-tu-cache.json") >= 0)
    .map(w => JSON.parse(String(w.text)))
  expect(recs.length).toBe(2)
  expect(String(recs[1].cacheErr), "отказ кэширования назван в финальной улике").toContain("store.set")
  const jline = shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.verdict !== undefined)
  expect(jline.length).toBe(1)
  expect(jline[0].lost && jline[0].lost["judge-verdict-cache"] ? jline[0].lost["judge-verdict-cache"].n : 0,
    "отказ кэширования уехал полем lost").toBeGreaterThanOrEqual(1)
})

test("#393-A2 cwd: несостоявшаяся запись не подменяет каталог прошлой сессией", async () => {
  await drainFold393()
  let fail = true
  const m = mod$393({
    now: 97_636_000,
    stored: { "catalyst-probes:cwd": "/dir-A-a2cwd" },
    fail: { storeSet: (k) => fail && k === "catalyst-probes:cwd" },
  })
  const start = hook393(subs393(), "session.start")
  await start(m.$, { cwd: "/dir-B-a2cwd" }, async (e: any) => "NEXT")
  expect(lostN393("session-cwd") >= 1).toBe(true)
  const w = await worldFor(m.$)
  expect(w.world.cwd, "фолбэк на чужой каталог запрещён").toBe("")
  expect(w.world.projectHome).toBe("")
  fail = false
  await start(m.$, { cwd: "/dir-C-a2cwd" }, async (e: any) => "NEXT")
  const w2 = await worldFor(m.$)
  expect(w2.world.cwd).toBe("/dir-C-a2cwd")
})

test("#393-A2 кэп: отказ записи стора не снимает кэп на девятом вызове", async () => {
  await drainFold393()
  await clear393()
  const m = mod$393({
    files: {
      "/probes-a2-cap/probes.toml":
        '[probe.c393cap]\nkind = "consult"\nact = "nudge"\non = ["PreToolUse"]\n[probe.c393cap.when]\nfield = "tool_name"\nequals = "Read"\n',
    },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-cap", PWD: "/work-a2-cap" },
    now: 97_637_000,
    sid: "sid-a2-cap",
    answers: ["OK: cap", "OK: cap", "OK: cap", "OK: cap", "OK: cap", "OK: cap", "OK: cap", "OK: cap"],
    fail: { storeSet: (k) => k.indexOf("catalyst-probes:sesscap") === 0 },
  })
  const hook = hook393(subs393(), "tool.call")
  for (let i = 0; i < 9; i++) {
    await hook(m.$, { tool: "Read" }, async (e: any) => e)
    await settle393()
  }
  const verdicts = shards393(m.writes, "/c393cap/journal.jsonl.shard.").filter(r => r.verdict !== undefined)
  expect(verdicts.length, "ровно capMax консультаций, девятый вызов молчит").toBe(8)
  const lostSum = verdicts.reduce((a: number, r: any) => a + (r.lost && r.lost["session-cap"] ? Number(r.lost["session-cap"].n) : 0), 0)
  expect(lostSum + lostN393("session-cap"),
    "каждый отказ записи кэпа учтён -- в поле lost или в остатке снапшота").toBeGreaterThanOrEqual(8)
})

test("#393-A2 кулдаун: отказ записи отметки не снимает кулдаун", async () => {
  await clear393()
  const m = mod$393({
    files: { "/probes-a2-cd/probes.toml": '[probe.idle-watch]\nact = "nudge"\nwindow_min = 0\n' },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-cd", PWD: "/work-a2-cd", CLAUDE_IDLE: "1" },
    now: 97_638_000,
    sid: "sid-a2-cd",
    answers: ["SILENT: cd"],
    fail: { storeSet: (k) => k.indexOf("catalyst-probes:last:") === 0 },
  })
  const hook = hook393(subs393(), "tool.call")
  await hook(m.$, { tool: "Read" }, async (e: any) => e)
  await settle393()
  await hook(m.$, { tool: "Read" }, async (e: any) => e)
  await settle393()
  const verdicts = shards393(m.writes, "/idle-watch/journal.jsonl.shard.").filter(r => r.verdict !== undefined)
  expect(verdicts.length, "вторая консультация внутри окна не состоялась").toBe(1)
  expect(verdicts[0].lost && verdicts[0].lost["consult-last"] ? verdicts[0].lost["consult-last"].n : 0,
    "отказ записи отметки уехал полем lost").toBeGreaterThanOrEqual(1)
})

test("#393-A2 таймер свёртки: cancel бросает -- старый колбэк инертен", async () => {
  await drainFold393()
  failoverBindReset()
  const m = mod$393({
    files: { "/probes-a2-fold/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-a2-fold" },
    now: 97_639_000,
    fail: { everyCancel: true },
  })
  failoverBindSet("ag-a2fold", { ladder: ["m-a2fold"], rungEffort: { "m-a2fold": "max" }, subagentType: "t", class: "", sticky: "m-a2fold" })
  const okNext: any = () => (async function* () {
    return { usage: { out: 1 }, stopReason: "end_turn", text: "ok" }
  })()
  const step = hook393(subs393(), "turn.step")
  await drainStream(step(m.$, { agentId: "ag-a2fold", turnId: "t-f1", index: 0, model: "m-a2fold", messageCount: 1 }, okNext))
  expect(m.everyCbs.length).toBe(1)
  failoverFoldReset()
  await drainStream(step(m.$, { agentId: "ag-a2fold", turnId: "t-f2", index: 0, model: "m-a2fold", messageCount: 1 }, okNext))
  expect(m.everyCbs.length).toBe(2)
  expect(lostN393("failover-fold-timer-cancel") >= 1).toBe(true)
  await m.everyCbs[0]()
  expect(shards393(m.writes, "/failover/journal.jsonl.shard.").length,
    "колбэк отменённого таймера ничего не пишет").toBe(0)
  await m.everyCbs[1]()
  const folds = shards393(m.writes, "/failover/journal.jsonl.shard.")
  expect(folds.length).toBe(1)
  expect(folds[0].fold).toBe(true)
  expect(folds[0].n).toBe(1)
  failoverBindReset()
})

// --- #393-A2-FIX1: фиксы по ревью A-2 ------------------------------------------
//
// CONSTRAINT: зубы U-F2* работают напрямую с экспортированной свёрткой; их
// задвижки -- подмена $.fs.write промисом, который разрешает тест. Порядок
// «запись на задвижке -> сброс -> открыть» держит каждый зуб сам: микрозадач
// settle393 хватает, чтобы свёртка дошла до подвешенной записи.

test("#393-A2-FIX1 U-F2a: отказ старой записи свёртки после сброса не портит новую сессию", async () => {
  failoverBindReset()
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f1-f2a/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f1-f2a" },
    now: 97_700_000,
  })
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0 && !gateOpen) {
      await gate
      throw new Error("EIO: f1-f2a gated write refusal")
    }
    return origWrite(p, text)
  }
  failoverFoldNote(97_700_001, "sticky-f2a", "ag-f2a")
  failoverFoldNote(97_700_002, "", "ag-f2a")
  failoverFoldNote(97_700_003, "", "ag-f2a2")
  const world = { globalHome: "/probes-f1-f2a" }
  const flush1 = failoverFoldFlush(m.$, world)
  const wrapped1 = flush1.then(() => ({ ok: true as boolean }), (e: unknown) => ({ ok: false as boolean, e }))
  await settle393()
  failoverFoldReset()
  gateOpen = true
  openGate()
  const res1 = await wrapped1
  expect(res1.ok, "запись, начатая до сброса, разрешается, а не бросает").toBe(true)
  expect(failoverFoldCount(), "счётчики новой сессии не тронуты отказом старой записи").toBe(0)
  expect(lostN393("failover-fold-stale"), "потеря старой записи названа").toBe(1)
  failoverBindReset()
})

test("#393-A2-FIX1 U-F2b: удачная старая запись не стирает ошибку новой сессии", async () => {
  failoverBindReset()
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f1-f2b/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f1-f2b" },
    now: 97_710_000,
  })
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  const origWrite = m.$.fs.write
  let jn = 0
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) {
      // CONSTRAINT: номер записи фиксируется НА ВХОДЕ -- возобновлённая после
      // задвижки первая запись остаётся первой и не видит счётчик соседа.
      const mine = ++jn
      if (mine === 1 && !gateOpen) await gate
      if (mine === 2) throw new Error("EIO: f1-f2b refusal-new")
    }
    return origWrite(p, text)
  }
  const world = { globalHome: "/probes-f1-f2b" }
  failoverFoldNote(97_710_001, "sticky-f2b-old", "ag-f2b-old")
  const flush1 = failoverFoldFlush(m.$, world)
  const wrapped1 = flush1.then(() => ({ ok: true as boolean }), (e: unknown) => ({ ok: false as boolean, e }))
  await settle393()
  failoverFoldReset()
  // запись НОВОЙ сессии отказывает -- ошибка обязана остаться названной
  failoverFoldNote(97_710_101, "", "ag-f2b-new")
  let flushed2 = true
  try { await failoverFoldFlush(m.$, world) } catch (x) { flushed2 = false }
  expect(flushed2, "отказ записи новой сессии бросает").toBe(false)
  gateOpen = true
  openGate()
  const res1 = await wrapped1
  expect(res1.ok, "старая удачная запись разрешается молча").toBe(true)
  failoverFoldNote(97_710_201, "", "ag-f2b-new2")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl.shard.").filter(r => r.fold)
  expect(folds.length).toBe(2)
  expect(folds[1].n).toBe(2)
  expect(String(folds[1].foldWriteErr || ""), "ошибка новой сессии пережила удачную старую запись").toContain("refusal-new")
  failoverBindReset()
})

test("#393-A2-FIX1 U-F2c: ожидающий свёртки не виснет после сброса сессии", async () => {
  failoverBindReset()
  failoverFoldReset()
  const m = mod$393({
    files: { "/probes-f1-f2c/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f1-f2c" },
    now: 97_720_000,
  })
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0 && !gateOpen) await gate
    return origWrite(p, text)
  }
  const world = { globalHome: "/probes-f1-f2c" }
  failoverFoldNote(97_720_001, "", "ag-f2c")
  const flush1 = failoverFoldFlush(m.$, world)
  const wrapped1 = flush1.then(() => ({ ok: true as boolean }), (e: unknown) => ({ ok: false as boolean, e }))
  await settle393()
  const writesBefore = m.writes.length
  let state2 = "pending"
  const flush2 = failoverFoldFlush(m.$, world)
  flush2.then(() => { state2 = "resolved" }, () => { state2 = "rejected" })
  await settle393()
  failoverFoldReset()
  await settle393()
  expect(state2, "ожидающий освобождается сбросом, а не виснет вечно").toBe("resolved")
  expect(m.writes.length, "освобождённый ожидающий ничего не пишет").toBe(writesBefore)
  gateOpen = true
  openGate()
  const res1 = await wrapped1
  expect(res1.ok).toBe(true)
  failoverBindReset()
})

test("#393-A2-FIX1 U-F3: отказ clock.every не ставит молчаливую пустышку", async () => {
  await drainFold393()
  let everyThrows = true
  let everyN = 0
  const m = mod$393({
    files: { "/probes-f1-f3/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f1-f3" },
    now: 97_730_000,
  })
  const world = { globalHome: "/probes-f1-f3" }
  m.$.clock.every = (_ms: number, _cb: any) => {
    everyN++
    if (everyThrows) throw new Error("clock.every: scripted arm refusal")
    return { cancel: () => {} }
  }
  // CONSTRAINT: доступ через namespace-импорт -- на коде ДО волны экспорта нет,
  // именованный импорт ронял бы весь файл (тот же приём, что у lostWritesSnapshot).
  const arm = (registerModule393 as any).armFailoverFoldTimer
  expect(typeof arm, "armFailoverFoldTimer экспортирован для юнит-зуба").toBe("function")
  const T = 97_730_000
  arm(m.$, world, T)
  expect(everyN).toBe(1)
  expect(lostN393("failover-fold-timer-arm")).toBe(1)
  arm(m.$, world, T + 1000)
  expect(everyN, "внутри окна FOLD_ARM_RETRY_MS повтор взвода не бьёт в отказавший clock.every").toBe(1)
  expect(lostN393("failover-fold-timer-arm")).toBe(1)
  arm(m.$, world, T + FOLD_ARM_RETRY_MS)
  expect(everyN, "за границей окна -- новая попытка").toBe(2)
  expect(lostN393("failover-fold-timer-arm")).toBe(2)
  // ручка без cancel -- своя названная потеря, не молчаливая пустышка
  failoverFoldReset()
  m.$.clock.every = (_ms: number, _cb: any) => { everyN++; return {} }
  arm(m.$, world, T)
  expect(everyN).toBe(3)
  expect(lostN393("failover-fold-timer-handle")).toBe(1)
  failoverFoldReset()
})

test("#393-A2-FIX2 U-F3b: откат часов снимает окно повтора взвода", async () => {
  failoverFoldReset()
  let everyN = 0
  const m = mod$393({
    files: { "/probes-f2-f3b/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f2-f3b" },
    now: 97_840_000,
  })
  const world = { globalHome: "/probes-f2-f3b" }
  m.$.clock.every = (_ms: number, _cb: any) => {
    everyN++
    throw new Error("clock.every: scripted arm refusal")
  }
  const arm = (registerModule393 as any).armFailoverFoldTimer
  const T = 97_840_000
  arm(m.$, world, T)
  expect(everyN).toBe(1)
  arm(m.$, world, T - 1000)
  expect(everyN, "шаг часов назад за момент отказа разрешает повтор").toBe(2)
  failoverFoldReset()
})

test("#393-A2-FIX1 U-F5sum: потерянное складывается при отказе записи журнала", async () => {
  await clear393()
  // CONSTRAINT: ключ = lastKey("f5sum", "/work-f1-sum5") из register.ts (не
  // экспортирован -- собирается литералом по той же форме: safeId буквенен).
  const lastK = "catalyst-probes:last:f5sum:/work-f1-sum5"
  let refusals = 0
  const m = mod$393({
    files: {
      "/probes-f1-sum5/probes.toml":
        '[probe.f5sum]\nkind = "consult"\nact = "nudge"\non = ["PreToolUse"]\n[probe.f5sum.when]\nfield = "tool_name"\nequals = "Read"\n',
    },
    env: { CLAUDE_PROBES_DIR: "/probes-f1-sum5", PWD: "/work-f1-sum5" },
    now: 97_740_000,
    sid: "sid-f1-sum5",
    answers: ["OK: f5sum-one", "OK: f5sum-two"],
  })
  const origGet = m.$.store.get
  m.$.store.get = async (k: string) => {
    if (k === lastK) {
      refusals++
      throw new Error("store.get: scripted refusal " + (refusals === 1 ? "f5sum-a" : "f5sum-b"))
    }
    return origGet(k)
  }
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  const origWrite = m.$.fs.write
  let jn = 0
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/f5sum/journal.jsonl") >= 0) {
      jn++
      if (jn === 1 && !gateOpen) await gate
      throw new Error("EIO: f5sum journal refusal")
    }
    return origWrite(p, text)
  }
  const hook = hook393(subs393(), "tool.call")
  // вызов 1: потеря "a" уезжает в подвешенную запись журнала (lostSnap снят)
  await hook(m.$, { tool: "Read" }, async (e: any) => e)
  await settle393()
  // вызов 2: потеря "b" копится, пока первая запись висит; его запись отказывает
  await hook(m.$, { tool: "Read" }, async (e: any) => e)
  await settle393()
  gateOpen = true
  openGate()
  await settle393()
  const snap = lostSnap393()["consult-last-read"]
  expect(snap ? snap.n : 0, "обе потери сложились").toBe(2)
  expect(snap ? snap.last : "", "названа последняя потеря").toBe("store.get: scripted refusal f5sum-b")
})

test("#393-A2-FIX2 U-F1t: catch таймера свёртки не пишет состояние чужой сессии", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f2-f1t/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f2-f1t" },
    now: 97_850_000,
    fail: { fsWrite: (p: string) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const world = { globalHome: "/probes-f2-f1t" }
  const T = 97_850_000
  const before = lostN393("failover-fold-timer-flush")
  failoverFoldNote(T, "", "ag-f1t")
  armFailoverFoldTimer(m.$, world, T)
  expect(m.everyCbs.length, "таймер взведён").toBe(1)
  const p = m.everyCbs[0]()
  for (let i = 0; i < 50 && !failoverFoldWriteErr(); i++) await Promise.resolve()
  expect(failoverFoldWriteErr(), "зуб не вакуумен: отказ записи виден в своём поколении").toContain("f1t")
  failoverFoldReset()
  await p
  expect(lostN393("failover-fold-timer-flush") - before, "отказ таймера учтён по месту").toBe(1)
  expect(failoverFoldWriteErr(), "ошибка старой сессии не записана в новую").toBe("")
})

test("#393-A2-FIX2 U-F2d: finally чужого поколения не пробуждает ждущих нового", async () => {
  failoverFoldReset()
  const m = mod$393({
    files: { "/probes-f2-f2d/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f2-f2d" },
    now: 97_860_000,
  })
  const world = { globalHome: "/probes-f2-f2d" }
  const T = 97_860_000
  const gates: Array<() => void> = []
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0 && gates.length < 2) {
      let go: () => void = () => {}
      const gate = new Promise<void>(r => { go = r })
      gates.push(go)
      await gate
    }
    return origWrite(p, text)
  }
  failoverFoldNote(T, "", "ag-n1")
  const flush1 = failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await settle393()
  expect(gates.length, "запись №1 стоит на задвижке").toBe(1)
  failoverFoldReset()
  failoverFoldNote(T + 1, "", "ag-gen2")
  const flush2 = failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await settle393()
  expect(gates.length, "запись №2 нового поколения стоит на задвижке").toBe(2)
  // CONSTRAINT: задвижка №1 открывается после сброса, и только первые две
  // записи стоят. finally чужого поколения не снимает foldBusy -- иначе №3
  // пишет ag-n2, пока №2 ещё на своей задвижке.
  gates[0]()
  await flush1
  await settle393()
  failoverFoldNote(T + 2, "", "ag-n2")
  const flush3 = failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await settle393()
  const withN2 = () => shards393(m.writes, "/failover/journal.jsonl").filter(r => r.agents && r.agents["ag-n2"])
  expect(withN2().length, "пока №2 стоит, агент ag-n2 не уезжает в записи").toBe(0)
  gates[1]()
  await flush2
  await flush3
  expect(withN2().length, "после отпуска №2 агент ag-n2 записан -- зуб не вакуумен").toBe(1)
  failoverFoldReset()
})

test("#393-A2-FIX2 U-F2e: ожидающий чужого поколения уступает очередь новому", async () => {
  failoverFoldReset()
  const m = mod$393({
    files: { "/probes-f2-f2e/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f2-f2e" },
    now: 97_870_000,
  })
  const world = { globalHome: "/probes-f2-f2e" }
  const T = 97_870_000
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  let held = 0
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) {
      held++
      if (held === 1 && !gateOpen) await gate
    }
    return origWrite(p, text)
  }
  failoverFoldNote(T, "", "ag-e1")
  const flush1 = failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await settle393()
  failoverFoldNote(T + 1, "", "ag-e2")
  const flush2 = failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await settle393()
  failoverFoldReset()
  // CONSTRAINT: ожидающий старого поколения просыпается микрозадачей. Без
  // уступки новая запись стартует раньше пробуждения, и return чужого
  // поколения не стоит на её пути.
  await settle393()
  failoverFoldNote(T + 2, "", "ag-e3")
  let state3 = "pending"
  const flush3 = failoverFoldFlush(m.$, world).then(() => { state3 = "resolved" }, () => { state3 = "rejected" })
  await settle393()
  expect(state3, "№3 разрешается, не вися за ожидающим чужого поколения").toBe("resolved")
  const recs = shards393(m.writes, "/failover/journal.jsonl")
  const n1 = recs.filter(r => r.n === 1)
  expect(n1.length, "новое поколение записало ровно своё окно n=1").toBe(1)
  expect(n1[0].agents && n1[0].agents["ag-e3"], "запись принадлежит новой заметке").toBe(1)
  gateOpen = true
  openGate()
  await flush1
  await flush2
  await flush3
  failoverFoldReset()
})

test("#393-A2-FIX2 U-F2f: смена липкости после сброса названа потерей", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f2-f2f/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f2-f2f" },
    now: 97_880_000,
    fail: { fsWrite: (p: string) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const world = { globalHome: "/probes-f2-f2f" }
  const T = 97_880_000
  const sid = "sid-f2f"
  failoverFoldNote(T, "A", "ag-f2f")
  const p = failoverFoldObserve(m.$, world, T + 1, "B", sid)
  for (let i = 0; i < 50 && !failoverFoldWriteErr(); i++) await Promise.resolve()
  expect(failoverFoldWriteErr(), "внутренний flush отказал -- зуб не вакуумен").not.toBe("")
  failoverFoldReset()
  let rejected = false
  try { await p } catch (x) { rejected = true }
  expect(rejected, "observe отклоняется").toBe(true)
  expect(lostN393("failover-fold-stale-split"), "потеря смены липкости названа").toBe(1)
  expect(failoverFoldCount(), "новое поколение пусто").toBe(0)
})

test("#393-A2-FIX2 U-F6a: хвост свёртки при сбросе пишется с resetTail", async () => {
  failoverFoldReset()
  const m = mod$393({
    files: { "/probes-f2-f6a/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f2-f6a" },
    now: 97_890_000,
  })
  const world = { globalHome: "/probes-f2-f6a" }
  const T = 97_890_000
  failoverFoldNote(T, "", "ag-a")
  failoverFoldNote(T + 1, "", "ag-b")
  armFailoverFoldTimer(m.$, world, T)
  const tail = failoverFoldReset()
  expect(tail, "хвост возвращён").not.toBeNull()
  expect(tail!.rec.n).toBe(2)
  expect(tail!.rec.resetTail).toBe(true)
  expect(tail!.rec.agents["ag-a"]).toBe(1)
  expect(tail!.rec.agents["ag-b"]).toBe(1)
  expect(tail!.world).toBe(world)
})

test("#393-A2-FIX3 U-F6b: отказ записи хвоста /clear назван по месту, команда отвечает", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f2-f6b/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f2-f6b" },
    now: 97_900_000,
    fail: { fsWrite: (p: string) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const world = { globalHome: "/probes-f2-f6b" }
  const T = 97_900_000
  failoverFoldNote(T, "", "ag-b1")
  armFailoverFoldTimer(m.$, world, T)
  const subs = subs393()
  const cl = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)
  const before = lostN393("failover-fold-reset-tail")
  const res = { text: "cleared-f6b" }
  const out = await cl[0].fn(m.$, { command: "clear", args: "" }, async () => res)
  expect(out, "команда отвечает своим результатом").toBe(res)
  await settle393()
  expect(lostN393("failover-fold-reset-tail") - before, "отказ записи хвоста учтён по месту").toBe(1)
  expect(String(lostSnap393()["failover-fold-reset-tail"].last), "причина -- отказ журнала").toContain("EIO")
  expect(failoverFoldCount(), "новое поколение пусто").toBe(0)
})

test("#393-A2-FIX2 U-J1: удачная запись не стирает чужую ошибку журнала", async () => {
  failoverFoldReset()
  const m = mod$393({
    files: { "/probes-f2-j1/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f2-j1" },
    now: 97_910_000,
  })
  const world = { globalHome: "/probes-f2-j1" }
  const T = 97_910_000
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  let held = 0
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) {
      const ord = ++held
      // CONSTRAINT: номер вызова фиксируется до ожидания. Общий held к моменту
      // возобновления A уже равен 2, и проверка после await бросила бы саму A.
      if (ord === 1 && !gateOpen) await gate
      if (ord === 2) throw new Error("EIO: j1-b")
    }
    return origWrite(p, text)
  }
  // CONSTRAINT: две свёртки сериализованы foldBusy и не встречаются внутри
  // appendJournal. Хвост /clear пишется мимо foldBusy, поэтому отказ B
  // случается, пока A ещё несёт свой carriedErr.
  const subs = subs393()
  const cl = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)
  failoverFoldNote(T, "", "ag-j1a")
  armFailoverFoldTimer(m.$, world, T)
  await cl[0].fn(m.$, { command: "clear", args: "" }, async (e: any) => e)
  await settle393()
  expect(held, "запись A (хвост сброса) стоит на задвижке").toBe(1)
  failoverFoldNote(T + 1, "", "ag-j1b")
  const flushB = failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await flushB
  await settle393()
  expect(held, "запись B отказала, пока A ещё внутри appendJournal").toBe(2)
  gateOpen = true
  openGate()
  await settle393()
  failoverFoldNote(T + 2, "", "ag-j1c")
  await failoverFoldFlush(m.$, world)
  const recs = shards393(m.writes, "/failover/journal.jsonl")
  const c = recs.filter(r => r.agents && r.agents["ag-j1c"])
  expect(c.length, "запись C состоялась").toBe(1)
  expect(String(c[0].journalWriteErr || ""), "C несёт ошибку отказавшей B").toContain("j1-b")
  failoverFoldReset()
})

test("#393-A2-FIX3 U-J2: отказ соседней записи с ТЕМ ЖЕ текстом не стирается", async () => {
  failoverFoldReset()
  const m = mod$393({
    files: { "/probes-f3-j2/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f3-j2" },
    now: 97_920_000,
  })
  const world = { globalHome: "/probes-f3-j2" }
  const T = 97_920_000
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  let held = 0
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) {
      const ord = ++held
      if (ord === 1) throw new Error("EIO: j2-same")
      if (ord === 2 && !gateOpen) await gate
      if (ord === 3) throw new Error("EIO: j2-same")
    }
    return origWrite(p, text)
  }
  const subs = subs393()
  const cl = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)
  armFailoverFoldTimer(m.$, world, T)
  failoverFoldNote(T, "", "ag-j2a")
  await failoverFoldFlush(m.$, world).then(() => {}, () => {})
  expect(held, "первая запись отказала текстом j2-same").toBe(1)
  await cl[0].fn(m.$, { command: "clear", args: "" }, async (e: any) => e)
  await settle393()
  expect(held, "запись A (хвост сброса) несёт j2-same и стоит на задвижке").toBe(2)
  armFailoverFoldTimer(m.$, world, T)
  failoverFoldNote(T + 1, "", "ag-j2b")
  await failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await settle393()
  expect(held, "запись B отказала тем же текстом, пока A внутри appendJournal").toBe(3)
  gateOpen = true
  openGate()
  await settle393()
  failoverFoldNote(T + 2, "", "ag-j2c")
  await failoverFoldFlush(m.$, world)
  const recs = shards393(m.writes, "/failover/journal.jsonl")
  const c = recs.filter(r => r.agents && r.agents["ag-j2c"])
  expect(c.length, "запись C состоялась").toBe(1)
  expect(String(c[0].journalWriteErr || ""), "C несёт отказ B").toContain("j2-same")
  failoverFoldReset()
})

test("#393-A2-FIX3 U-F6c: хвост сброса несёт foldWriteErr и foldSplitLost", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f3-f6c/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f3-f6c" },
    now: 97_930_000,
    fail: { fsWrite: (p: string) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const world = { globalHome: "/probes-f3-f6c" }
  const T = 97_930_000
  failoverFoldNote(T, "A", "ag-f6c")
  let rejected = false
  try { await failoverFoldObserve(m.$, world, T + 1, "B", "sid-f6c") } catch (x) { rejected = true }
  expect(rejected, "смена липкости при отказе записи отклоняется").toBe(true)
  const tail = failoverFoldReset()
  expect(tail, "хвост возвращён").not.toBeNull()
  expect(tail!.rec.foldSplitLost, "хвост несёт потерю окна").toBe(1)
  expect(String(tail!.rec.foldWriteErr || ""), "хвост несёт ошибку записи").toContain("EIO")
})

test("#393-A2-FIX3 U-F3z: отказ взвода в момент 0 держит окно", async () => {
  failoverFoldReset()
  let everyN = 0
  const m = mod$393({
    files: { "/probes-f3-f3z/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f3-f3z" },
    now: 0,
  })
  const world = { globalHome: "/probes-f3-f3z" }
  m.$.clock.every = (_ms: number, _cb: any) => {
    everyN++
    throw new Error("clock.every: scripted arm refusal")
  }
  const arm = (registerModule393 as any).armFailoverFoldTimer
  arm(m.$, world, 0)
  expect(everyN).toBe(1)
  arm(m.$, world, 1)
  expect(everyN, "миг после отказа в момент 0 -- повтора нет").toBe(1)
  arm(m.$, world, FOLD_ARM_RETRY_MS)
  expect(everyN, "через окно от момента 0 -- повтор").toBe(2)
  failoverFoldReset()
})

test("#393-A2-FIX3 U-F3f: стоящие часы не держат окно взвода вечно", async () => {
  failoverFoldReset()
  let everyN = 0
  const m = mod$393({
    files: { "/probes-f3-f3f/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f3-f3f" },
    now: 97_940_000,
  })
  const world = { globalHome: "/probes-f3-f3f" }
  m.$.clock.every = (_ms: number, _cb: any) => {
    everyN++
    throw new Error("clock.every: scripted arm refusal")
  }
  const arm = (registerModule393 as any).armFailoverFoldTimer
  const K = (registerModule393 as any).FOLD_ARM_RETRY_CALLS
  expect(K).toBe(64)
  const T = 97_940_000
  arm(m.$, world, T)
  expect(everyN).toBe(1)
  for (let i = 0; i < K; i++) arm(m.$, world, T)
  expect(everyN, "K пропусков при стоящих часах").toBe(1)
  arm(m.$, world, T)
  expect(everyN, "после K пропусков -- повтор").toBe(2)
  failoverFoldReset()
})

test("#393-A2-FIX3 B-F4z: отказ уборки в момент 0 повторяется через окно", async () => {
  await clear393()
  const poison = "v:judge:poison-f3b4z"
  const m = mod$393({
    files: judgeFiles393("/probes-f3-b4z"),
    env: { CLAUDE_PROBES_DIR: "/probes-f3-b4z", PWD: "/work-f3-b4z", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poison]: { kind: "BLOCK", rest: "x", t: 0 } },
    answers: ["OK: f3b4z-a", "OK: f3b4z-b", "OK: f3b4z-c"],
    fail: { storeGet: (k: string) => k === poison },
  })
  let first = true
  const origGet = m.$.store.get
  m.$.store.get = async (k: string) => {
    if (String(k) === poison && first) { first = false; m.setNow(0) }
    return origGet(k)
  }
  const hook = hook393(subs393(), "tool.call")
  const sweeps = () => shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep").length
  const consult = (p: string) => hook(m.$, { tool: "Agent", prompt: p, subagent_type: "scout" }, async (e: any) => e)

  await consult("f3b4z one")
  expect(sweeps(), "уборка состоялась, отказ зафиксирован в момент 0").toBe(1)
  m.setNow(1)
  await consult("f3b4z two")
  expect(sweeps(), "миг после отказа -- уборки нет").toBe(1)
  m.setNow(600_000)
  await consult("f3b4z three")
  expect(sweeps(), "через SWEEP_RETRY_MS от момента 0 уборка повторяется").toBe(2)
})

test("#393-A2-FIX3 B-F4f: стоящие часы не держат окно уборки вечно", async () => {
  await clear393()
  const poison = "v:judge:poison-f3b4f"
  const K = (registerModule393 as any).SWEEP_RETRY_CALLS
  expect(K).toBe(64)
  const m = mod$393({
    files: judgeFiles393("/probes-f3-b4f"),
    env: { CLAUDE_PROBES_DIR: "/probes-f3-b4f", PWD: "/work-f3-b4f", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poison]: { kind: "BLOCK", rest: "x", t: 900_000 } },
    answers: Array.from({ length: K + 4 }, (_, i) => "OK: f3b4f-" + i),
    fail: { storeGet: (k: string) => k === poison },
  })
  const hook = hook393(subs393(), "tool.call")
  const sweeps = () => shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep").length
  const consult = (p: string) => hook(m.$, { tool: "Agent", prompt: p, subagent_type: "scout" }, async (e: any) => e)

  await consult("f3b4f first")
  expect(sweeps(), "первая уборка отказала").toBe(1)
  for (let i = 0; i < K; i++) await consult("f3b4f skip " + i)
  expect(sweeps(), "K пропусков при стоящих часах").toBe(1)
  await consult("f3b4f after")
  expect(sweeps(), "после K пропусков -- повтор").toBe(2)
})

test("#393-A2-FIX3 B-F4g: консультация, начатая до чужого отказа, не повторяет уборку немедленно", async () => {
  await clear393()
  const poison = "v:judge:poison-f3b4g"
  const m = mod$393({
    files: judgeFiles393("/probes-f3-b4g"),
    env: { CLAUDE_PROBES_DIR: "/probes-f3-b4g", PWD: "/work-f3-b4g", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poison]: { kind: "BLOCK", rest: "x", t: 900_000 } },
    answers: ["OK: f3b4g-a", "OK: f3b4g-b", "OK: f3b4g-c"],
    fail: { storeGet: (k: string) => k === poison },
  })
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  let gated = 0
  const origGet = m.$.store.get
  m.$.store.get = async (k: string) => {
    if (String(k).indexOf("catalyst-probes:last:judge") === 0 && gated++ === 0) await gate
    return origGet(k)
  }
  const hook = hook393(subs393(), "tool.call")
  const sweeps = () => shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep").length
  const consult = (p: string) => hook(m.$, { tool: "Agent", prompt: p, subagent_type: "scout" }, async (e: any) => e)

  const x = consult("f3b4g early")
  await settle393()
  expect(gated, "ранняя консультация (t0 = 1 000 000) стоит на задвижке").toBe(1)
  m.setNow(1_600_001)
  await consult("f3b4g late")
  expect(sweeps(), "поздняя консультация убрала, отказ в 1 600_001").toBe(1)
  m.setNow(1_600_002)
  openGate()
  await x
  expect(sweeps(), "ранний t0 не читается как откат часов").toBe(1)
})

test("#393-A2-FIX3 U-F6d: хвост без дома журнала назван по месту", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f3-f6d/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f3-f6d" },
    now: 97_950_000,
  })
  const T = 97_950_000
  failoverFoldNote(T, "", "ag-f6d")
  armFailoverFoldTimer(m.$, {}, T)
  const subs = subs393()
  const cl = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)
  const before = lostN393("failover-fold-reset-tail")
  const res = { text: "cleared-f6d" }
  const out = await cl[0].fn(m.$, { command: "clear", args: "" }, async () => res)
  expect(out, "команда отвечает своим результатом").toBe(res)
  await settle393()
  expect(lostN393("failover-fold-reset-tail") - before, "хвост без дома учтён по месту").toBe(1)
  expect(String(lostSnap393()["failover-fold-reset-tail"].last)).toContain("no journal home")
})

test("#393-A2-FIX3 U-G6a: время вне диапазона Date не уносит запись свёртки", async () => {
  failoverFoldReset()
  const m = mod$393({
    files: { "/probes-f3-g6a/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f3-g6a" },
    now: 97_960_000,
  })
  const world = { globalHome: "/probes-f3-g6a" }
  failoverFoldNote(1e16, "", "ag-g6a")
  await failoverFoldFlush(m.$, world)
  const recs = shards393(m.writes, "/failover/journal.jsonl").filter(r => r.agents && r.agents["ag-g6a"])
  expect(recs.length, "запись свёртки состоялась").toBe(1)
  expect(recs[0].t).toBe("invalid-time:10000000000000000")
  expect(recs[0].tFirst).toBe("invalid-time:10000000000000000")
  expect(failoverFoldCount(), "снимок снят").toBe(0)
})

test("#393-A2-FIX3 U-G6b: время вне диапазона Date не срывает сброс", async () => {
  failoverFoldReset()
  failoverFoldNote(1e16, "", "ag-g6b")
  const tail = failoverFoldReset()
  expect(tail, "хвост возвращён").not.toBeNull()
  expect(tail!.rec.t).toBe("invalid-time:10000000000000000")
  expect(failoverFoldCount(), "новое поколение пусто").toBe(0)
})

// --- #393-A2-FIX4: хвост /clear без потерь, повтор уборки без гонки ----------
//
// CONSTRAINT: новые экспорты регистрово читаются ТОЛЬКО через namespace-импорт
// (as any): на коде ДО волны их нет, и именованный импорт уронил бы весь файл.

test("#393-A2-FIX4 U-T1: хвост /clear при отказе записи возвращает содержимое в состояние", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f4-t1/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f4-t1" },
    now: 97_980_000,
  })
  const world = { globalHome: "/probes-f4-t1" }
  const T = 97_980_000
  let mode = "ok"
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) {
      if (mode === "split") throw new Error("EIO: t1-split")
      if (mode === "tail") throw new Error("EIO: t1-tail")
    }
    return origWrite(p, text)
  }
  const subs = subs393()
  const cl = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)
  armFailoverFoldTimer(m.$, world, T)
  failoverFoldNote(T, "A", "ag-t1")
  mode = "split"
  await failoverFoldObserve(m.$, world, T + 1, "B", "sid-t1").then(() => {}, () => {})
  mode = "tail"
  await cl[0].fn(m.$, { command: "clear", args: "" }, async (e: any) => e)
  await settle393()
  const foldResetLost = (registerModule393 as any).failoverFoldResetLost
  const foldSplitLost = (registerModule393 as any).failoverFoldSplitLost
  expect(foldResetLost(), "шаги неписаного хвоста вернулись счётом foldResetLost").toBe(1)
  expect(foldSplitLost(), "потеря окна вернулась счётом foldSplitLost").toBe(1)
  expect(failoverFoldWriteErr(), "ошибка хвоста в состоянии").toContain("t1-tail")
  expect(failoverFoldWriteErr(), "ошибка окна в состоянии").toContain("t1-split")
  mode = "ok"
  failoverFoldNote(T + 2, "", "ag-t1b")
  await failoverFoldFlush(m.$, world)
  const recs = shards393(m.writes, "/failover/journal.jsonl")
  const c = recs.filter(r => r.agents && r.agents["ag-t1b"])
  expect(c.length, "запись новой сессии состоялась").toBe(1)
  expect(c[0].foldResetLost, "запись несёт вернувшийся foldResetLost").toBe(1)
  expect(c[0].foldSplitLost, "запись несёт вернувшийся foldSplitLost").toBe(1)
  expect(String(c[0].foldWriteErr || ""), "запись несёт ошибку хвоста").toContain("t1-tail")
  expect(foldResetLost(), "после удачи состояние чисто").toBe(0)
  expect(foldSplitLost(), "потеря окна доставлена").toBe(0)
  expect(failoverFoldWriteErr(), "ошибка доставлена").toBe("")
  failoverFoldReset()
})

test("#393-A2-FIX4 U-T2: возврат хвоста во время удачной записи не стирается", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f4-t2/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f4-t2" },
    now: 97_981_000,
  })
  const world = { globalHome: "/probes-f4-t2" }
  const T = 97_981_000
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  let held = 0
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) {
      held++
      if (!gateOpen) await gate
    }
    return origWrite(p, text)
  }
  failoverFoldNote(T, "", "ag-t2")
  const flushP = failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await settle393()
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  const foldResetLost = (registerModule393 as any).failoverFoldResetLost
  const foldSplitLost = (registerModule393 as any).failoverFoldSplitLost
  let cleanupLeft = -1
  try {
    expect(held, "запись стоит на задвижке").toBe(1)
    tailLost({ n: 3, foldSplitLost: 2, foldWriteErr: "EIO: t2-carried" }, new Error("EIO: t2-tail"))
    gateOpen = true
    openGate()
    await flushP
    expect(foldResetLost(), "шаги хвоста, вернувшиеся во время записи, не стёрты").toBe(3)
    expect(foldSplitLost(), "потеря окна, вернувшаяся во время записи, не стёрта").toBe(2)
    expect(failoverFoldWriteErr(), "ошибка хвоста не стёрта").toContain("t2-tail")
    expect(failoverFoldWriteErr(), "ошибка-пассажир не стёрта").toContain("t2-carried")
  } finally {
    // CONSTRAINT: зачистка состояния зуба: сценарий оставляет недоставленное,
    // и без записи здесь следующий зуб начинался бы с чужой ошибки.
    failoverFoldNote(T + 1, "", "ag-t2b")
    await failoverFoldFlush(m.$, world)
    cleanupLeft = foldResetLost()
    failoverFoldReset()
  }
  expect(cleanupLeft, "зачистка зуба доставила недоставленное").toBe(0)
})

test("#393-A2-FIX4 U-T3: сброс без шагов не теряет недоставленное", async () => {
  await drainFold393()
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  const foldResetLost = (registerModule393 as any).failoverFoldResetLost
  tailLost({ n: 2 }, new Error("EIO: t3"))
  expect(failoverFoldReset(), "без шагов хвоста нет").toBeNull()
  expect(foldResetLost(), "недоставленные шаги остались в состоянии").toBe(2)
  expect(failoverFoldWriteErr(), "недоставленная ошибка осталась в состоянии").toContain("t3")
  failoverFoldNote(97_982_000, "", "ag-t3")
  const tail = failoverFoldReset()
  expect(tail, "хвост новой записи возвращён").not.toBeNull()
  expect(tail!.rec.foldResetLost, "хвост несёт недоставленные шаги").toBe(2)
  expect(String(tail!.rec.foldWriteErr || ""), "хвост несёт недоставленную ошибку").toContain("t3")
  expect(foldResetLost(), "хвост забрал недоставленное из состояния").toBe(0)
  expect(failoverFoldWriteErr()).toBe("")
})

test("#393-A2-FIX4 U-T4: отказ записи сохраняет прежнюю недоставленную ошибку", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f4-t4/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f4-t4" },
    now: 97_983_000,
  })
  const world = { globalHome: "/probes-f4-t4" }
  const T = 97_983_000
  let writeN = 0
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) {
      writeN++
      throw new Error("EIO: t4-" + (writeN === 1 ? "first" : "second"))
    }
    return origWrite(p, text)
  }
  failoverFoldNote(T, "", "ag-t4")
  await failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await failoverFoldFlush(m.$, world).then(() => {}, () => {})
  const err = failoverFoldWriteErr()
  expect(err, "новый отказ в состоянии").toContain("t4-second")
  expect(err, "прежний отказ сохранён").toContain("t4-first")
  expect(err.indexOf("t4-second") < err.indexOf("t4-first"), "новый отказ впереди прежнего").toBe(true)
  failoverFoldReset()
})

test("#393-A2-FIX4 B-F4r1: две консультации одного окна повтора -- одна уборка", async () => {
  await clear393()
  const poison = "v:judge:poison-f4r1"
  const m = mod$393({
    files: judgeFiles393("/probes-f4-r1"),
    env: { CLAUDE_PROBES_DIR: "/probes-f4-r1", PWD: "/work-f4-r1", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poison]: { kind: "BLOCK", rest: "x", t: 900_000 } },
    answers: ["OK: f4r1-a", "OK: f4r1-b", "OK: f4r1-c"],
    fail: { storeGet: (k: string) => k === poison },
  })
  const hook = hook393(subs393(), "tool.call")
  const sweeps = () => shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep").length
  const consult = (p: string) => hook(m.$, { tool: "Agent", prompt: p, subagent_type: "scout" }, async (e: any) => e)

  await consult("f4r1 one")
  expect(sweeps(), "первая уборка состоялась, отказ зафиксирован").toBe(1)
  m.setNow(1_000_000 + 600_000)
  await Promise.all([consult("f4r1 two"), consult("f4r1 three")])
  expect(sweeps(), "две консультации одного окна запускают одну уборку").toBe(2)
})

test("#393-A2-FIX4 B-F4r2: уборка, начатая до /clear, не пишет отказ в новую сессию", async () => {
  await clear393()
  const poison = "v:judge:poison-f4r2"
  let poisonOn = true
  const m = mod$393({
    files: judgeFiles393("/probes-f4-r2"),
    env: { CLAUDE_PROBES_DIR: "/probes-f4-r2", PWD: "/work-f4-r2", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poison]: { kind: "BLOCK", rest: "x", t: 900_000 } },
    answers: ["OK: f4r2-a", "OK: f4r2-b", "OK: f4r2-c"],
    fail: { storeGet: (k: string) => poisonOn && k === poison },
  })
  let poisonReads = 0
  let holdClock = false
  let clockHeld = 0
  let clockGateOpen = false
  let openClockGate: () => void = () => {}
  const clockGate = new Promise<void>(r => { openClockGate = r })
  const origGet = m.$.store.get
  m.$.store.get = async (k: string) => {
    if (String(k) === poison) {
      poisonReads++
      if (poisonReads === 1) holdClock = true
    }
    return origGet(k)
  }
  const origNow = m.$.clock.now
  m.$.clock.now = async () => {
    if (holdClock) {
      holdClock = false
      clockHeld++
      await clockGate
    }
    return origNow()
  }
  const hook = hook393(subs393(), "tool.call")
  const sweeps = () => shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep").length
  const consult = (p: string) => hook(m.$, { tool: "Agent", prompt: p, subagent_type: "scout" }, async (e: any) => e)
  const subs = subs393()
  const cl = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)

  const p1 = consult("f4r2 one")
  await settle393()
  expect(clockHeld, "отказ старой уборки встал на задвижке часов").toBe(1)
  await cl[0].fn(m.$, { command: "clear", args: "" }, async (e: any) => e)
  await settle393()
  poisonOn = false
  await consult("f4r2 two")
  clockGateOpen = true
  openClockGate()
  await p1
  const before = sweeps()
  m.setNow(1_000_000 + 600_000)
  await consult("f4r2 three")
  expect(sweeps() - before, "отказ старой уборки не открыл повтор в новой сессии").toBe(0)
})

test("#393-A2-FIX4 U-N1: время вне диапазона Date -- отказ часов", async () => {
  failoverFoldReset()
  const nowMs = (registerModule393 as any).nowMs
  const v1 = await nowMs({ clock: { now: async () => 1e308 } })
  expect(Number.isFinite(v1) && Math.abs(v1) <= 8.64e15, "1e308 отвергнут: значение в диапазоне Date").toBe(true)
  expect(v1, "1e308 не возвращён часами").not.toBe(1e308)
  expect(await nowMs({ clock: { now: async () => 8.64e15 } }), "граница диапазона принимается").toBe(8.64e15)
  const v3 = await nowMs({ clock: { now: async () => 8.64e15 + 1 } })
  expect(v3, "за границей -- отказ часов, не сырое значение").not.toBe(8.64e15 + 1)
  expect(Number.isFinite(v3) && Math.abs(v3) <= 8.64e15, "после отказа значение в диапазоне").toBe(true)
})

// CONSTRAINT: зуб держит правило экспорта; боевой вход конечен по nowMs (Р1 A2-FIX4)
test("#393-A2-FIX4 U-F3n: нечисловое время взвода меряет окно счётом", async () => {
  failoverFoldReset()
  let everyN = 0
  const m = mod$393({
    files: { "/probes-f4-f3n/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f4-f3n" },
    now: 97_970_000,
  })
  const world = { globalHome: "/probes-f4-f3n" }
  m.$.clock.every = (_ms: number, _cb: any) => {
    everyN++
    throw new Error("clock.every: scripted arm refusal")
  }
  const arm = (registerModule393 as any).armFailoverFoldTimer
  const K = (registerModule393 as any).FOLD_ARM_RETRY_CALLS
  expect(K).toBe(64)
  const T = 97_970_000
  arm(m.$, world, T)
  expect(everyN).toBe(1)
  for (let i = 0; i < K; i++) arm(m.$, world, Infinity)
  expect(everyN, "K пропусков при нечисловом времени").toBe(1)
  arm(m.$, world, Infinity)
  expect(everyN, "после K пропусков -- повтор").toBe(2)
  failoverFoldReset()
})

// CONSTRAINT: зуб держит правило экспорта; боевой вход конечен по nowMs (Р1 A2-FIX4)
test("#393-A2-FIX4 B-F4n: нечисловое время уборки меряет окно счётом", async () => {
  await clear393()
  const poison = "v:judge:poison-f4n"
  const m = mod$393({
    files: judgeFiles393("/probes-f4n"),
    env: { CLAUDE_PROBES_DIR: "/probes-f4n", PWD: "/work-f4n", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poison]: { kind: "BLOCK", rest: "x", t: 900_000 } },
    answers: ["OK: f4n-a"],
    fail: { storeGet: (k: string) => k === poison },
  })
  const hook = hook393(subs393(), "tool.call")
  const sweeps = () => shards393(m.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep").length
  const consult = (p: string) => hook(m.$, { tool: "Agent", prompt: p, subagent_type: "scout" }, async (e: any) => e)
  await consult("f4n one")
  expect(sweeps(), "первая уборка с отказом состоялась").toBe(1)
  const due = (registerModule393 as any).sweepRetryDue
  for (let i = 0; i < 64; i++) expect(due(Infinity), "пропуск " + i).toBe(false)
  expect(due(Infinity), "после SWEEP_RETRY_CALLS пропусков -- повтор").toBe(true)
})

test("#393-A2-FIX5 B-F5g1: поздний finally старой уборки не открывает третью уборку, пока новая внутри", async () => {
  await clear393()
  const poison = "v:judge:poison-d1"
  const m = mod$393({
    files: judgeFiles393("/probes-d1"),
    env: { CLAUDE_PROBES_DIR: "/probes-d1", PWD: "/work-d1", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poison]: { kind: "BLOCK", rest: "x", t: 900_000 } },
    answers: ["OK: d1-a", "OK: d1-b", "OK: d1-c", "OK: d1-d"],
    fail: { storeGet: (k: string) => k === poison },
  })
  let poisonReads = 0
  let holdClock = false
  let clockHeld = 0
  const clockGates: Array<() => void> = []
  const origGet = m.$.store.get
  m.$.store.get = async (k: string) => {
    if (String(k) === poison) { poisonReads++; if (poisonReads <= 2) holdClock = true }
    return origGet(k)
  }
  const origNow = m.$.clock.now
  m.$.clock.now = async () => {
    if (holdClock) {
      holdClock = false
      clockHeld++
      let open: () => void = () => {}
      const p = new Promise<void>(r => { open = r })
      clockGates.push(open)
      await p
    }
    return origNow()
  }
  let keysCalls = 0
  const origKeys = m.$.store.keys
  m.$.store.keys = async () => { keysCalls++; return origKeys() }
  let sweepWrites = 0
  let openSweepWrite: () => void = () => {}
  const sweepWriteP = new Promise<void>(r => { openSweepWrite = r })
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/judge/journal.jsonl") >= 0 && String(text).indexOf("store_sweep") >= 0) {
      sweepWrites++
      if (sweepWrites === 2) await sweepWriteP
    }
    return origWrite(p, text)
  }
  const hook = hook393(subs393(), "tool.call")
  const subs = subs393()
  const cl = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)
  const consult = (p: string) => hook(m.$, { tool: "Agent", prompt: p, subagent_type: "scout" }, async (e: any) => e)

  const pA = consult("d1 A")
  await settle393()
  expect(clockHeld, "A: отказ прочитан, публикация стоит на часах").toBe(1)
  await cl[0].fn(m.$, { command: "clear", args: "" }, async (e: any) => e)
  await settle393()
  const pB = consult("d1 B")
  await settle393()
  expect(clockHeld, "B: та же задвижка в новой сессии").toBe(2)
  clockGates[0]()
  await pA
  expect(sweepWrites, "A дописала свою запись уборки и вышла").toBe(1)
  const keysAfterA = keysCalls
  clockGates[1]()
  await settle393()
  expect(sweepWrites, "B стоит внутри себя, на записи уборки").toBe(2)
  m.setNow(1_000_000 + 600_000)
  const pC = consult("d1 C")
  await settle393()
  expect(keysCalls - keysAfterA, "пока B внутри, третья уборка не стартует (окно повтора истекло)").toBe(0)
  openSweepWrite()
  await Promise.all([pB, pC])
  expect(sweeps393(m.writes), "две записи уборки: A и B").toBe(2)
})

test("#393-A2-FIX5 B-F5g2: консультация, прочитавшая часы до публикации отказа, не открывает вторую уборку, пока первая внутри", async () => {
  await drainFold393()
  await clear393()
  const poison = "v:judge:poison-f5g2"
  const m = mod$393({
    files: judgeFiles393("/probes-f5g2"),
    env: { CLAUDE_PROBES_DIR: "/probes-f5g2", PWD: "/work-f5g2", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poison]: { kind: "BLOCK", rest: "x", t: 900_000 } },
    answers: ["OK: g2-one", "OK: g2-C", "OK: g2-B"],
    fail: { storeGet: (k: string) => k === poison },
  })
  const hook = hook393(subs393(), "tool.call")
  const consult = (p: string) => hook(m.$, { tool: "Agent", prompt: p, subagent_type: "scout" }, async (e: any) => e)
  let keysCalls = 0
  const origKeys = m.$.store.keys
  m.$.store.keys = async () => { keysCalls++; return origKeys() }
  let sweepWrites = 0
  let openSweepWrite: () => void = () => {}
  const sweepWriteP = new Promise<void>(r => { openSweepWrite = r })
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/judge/journal.jsonl") >= 0 && String(text).indexOf("store_sweep") >= 0) {
      sweepWrites++
      if (sweepWrites === 2) await sweepWriteP
    }
    return origWrite(p, text)
  }
  // CONSTRAINT (форма стенда): часы парковки различаются по флагу parkClock,
  // а не по вызывающему: обе консультации обязаны стоять на часах проверки
  // повтора (:3406) ДО старта уборки A -- иначе внешняя проверка (не брать
  // уборку при идущей) закрыла бы консультации B ещё до часов.
  let parkClock = false
  let clockHeld = 0
  const clockGates: Array<() => void> = []
  const origNow = m.$.clock.now
  m.$.clock.now = async () => {
    if (!parkClock) return origNow()
    clockHeld++
    let open: () => void = () => {}
    const p = new Promise<void>(r => { open = r })
    clockGates.push(open)
    await p
    return origNow()
  }

  // --- предыстория как в B-F4r1: первая консультация, уборка отказала --------
  await consult("g2 one")
  expect(sweeps393(m.writes), "первая уборка состоялась и отказалась").toBe(1)
  const lostBefore = lostN393("judge-store-sweep-items")
  m.setNow(1_000_000 + 600_000)

  // --- две конкурентные консультации: C и B, обе на часах проверки повтора ---
  // Нумерация парковок (детерминирована порядком открытия ниже): у каждой
  // консультации ТРИ чтения часов до проверки повтора -- worldFor:1386,
  // loadAllowedByClass:298 (мемо мира на предыстории протухло на 600 000 мс,
  // а мемо C ещё не записано, пока C стоит на своих часах) и t0:3211; затем
  // часы проверки повтора :3406. B обязана пройти внешнюю проверку ДО старта
  // уборки A -- иначе идущая уборка закрыла бы ей ветку раньше часов.
  parkClock = true
  const pC = consult("g2 C")
  await settle393()
  clockGates[0]()
  await settle393()
  const pB = consult("g2 B")
  await settle393()
  clockGates[2]()
  await settle393()
  clockGates[1]()
  await settle393()
  clockGates[3]()
  await settle393()
  clockGates[4]()
  await settle393()
  clockGates[5]()
  await settle393()
  expect(clockHeld, "обе консультации удержали часы: по три в преамбуле и по одному в проверке повтора").toBe(8)

  // --- часы C отвечают первыми: C запускает уборку A --------------------------
  clockGates[6]()
  await settle393()
  clockGates[8]()
  await settle393()
  // CONSTRAINT: контроль меряется до открытия часов публикации A: appendJournal
  // записи уборки осушает lostWrites в летящую строку, и после задвижки записи
  // снапшот модуля уже пуст -- но и здесь отказ A записан раньше часов B.
  expect(lostN393("judge-store-sweep-items") - lostBefore, "отказ A записан до ответа часов B").toBe(1)
  m.setNow(1_000_000 + 700_000)
  clockGates[9]()
  await settle393()
  expect(sweepWrites, "A дошла до записи своей строки и стоит на задвижке").toBe(2)
  const keysAfterA = keysCalls

  // --- часы B отвечают значением меньше sweepFailedAt: «шаг часов назад» -----
  parkClock = false
  m.setNow(1_000_000 + 650_000)
  clockGates[7]()
  await pB
  expect(keysCalls - keysAfterA, "пока A внутри, вторая уборка не стартует (шаг часов назад повтор разрешает, идущая уборка -- нет)").toBe(0)

  openSweepWrite()
  await pC
  expect(sweeps393(m.writes), "после открытия задвижки -- ровно одна новая запись уборки").toBe(2)
})

test("#393-A2-FIX5 U-F5d: запись свёртки в полёте через /clear без шагов не доставляет перенос дважды", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f5d/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f5d" },
    now: 98_710_000,
  })
  const world = { globalHome: "/probes-f5d" }
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  const foldResetLost = (registerModule393 as any).failoverFoldResetLost
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0 && !gateOpen) await gate
    return origWrite(p, text)
  }
  tailLost({ n: 2 }, new Error("EIO: f5d-tail"))
  failoverFoldNote(98_710_001, "", "ag-f5d")
  const flushP = failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await settle393()
  failoverFoldReset()
  gateOpen = true
  openGate()
  await flushP
  failoverFoldNote(98_710_101, "", "ag-f5d2")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  const sumReset = folds.reduce((acc: number, r: any) => acc + Number(r.foldResetLost || 0), 0)
  expect(sumReset, "перенос 2 доставлен ровно один раз").toBe(2)
  expect(foldResetLost(), "после всего состояние чисто").toBe(0)
  failoverFoldReset()
})

test("#393-A2-FIX5 U-F5c1: отрезанный текст ошибок свёртки назван числом", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f5c1/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f5c1" },
    now: 98_720_000,
  })
  const world = { globalHome: "/probes-f5c1" }
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  const msgs: string[] = []
  for (let k = 1; k <= 4; k++) {
    // CONSTRAINT: вход хвоста режется до 240 символов (failoverFoldTailLost),
    // полная склейка считается по той же форме -- разрезанные сообщения.
    const msg = ("EIO: M" + k + "-" + "x".repeat(400)).slice(0, 240)
    msgs.unshift(msg)
    tailLost({ n: 1 }, new Error(msg))
  }
  failoverFoldNote(98_720_001, "", "ag-f5c1")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(folds.length, "одна строка свёртки в журнале").toBe(1)
  expect(String(folds[0].foldWriteErr || "").length, "текст ошибки держит голову длиной FOLD_ERR_CAP").toBe(720)
  expect(Number(folds[0].foldWriteErrCut || 0) > 0, "отрезанное названо числом, не молчанием").toBe(true)
  expect(String(folds[0].foldWriteErr).length + Number(folds[0].foldWriteErrCut || 0),
    "голова плюс отрезанное равно полному склеенному тексту").toBe(msgs.join(" | ").length)
  expect(String(folds[0].foldWriteErr), "выжила голова: новое впереди, отрезан хвост старого").toBe(msgs.join(" | ").slice(0, 720))
  failoverFoldReset()
})

test("#393-A2-FIX5 U-F5c2: доставленный текст ошибки не едет второй раз", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f5c2/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f5c2" },
    now: 98_730_000,
  })
  const world = { globalHome: "/probes-f5c2" }
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  let writeN = 0
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) {
      // CONSTRAINT: номер записи фиксируется НА ВХОДЕ -- возобновлённая после
      // задвижки вторая запись остаётся второй и не видит счётчик соседа.
      const mine = ++writeN
      if (mine === 1) throw new Error("EIO: c2-first")
      if (mine === 2 && !gateOpen) await gate
    }
    return origWrite(p, text)
  }
  failoverFoldNote(98_730_001, "", "ag-f5c2a")
  await failoverFoldFlush(m.$, world).then(() => {}, () => {})
  failoverFoldNote(98_730_101, "", "ag-f5c2b")
  const flushP = failoverFoldFlush(m.$, world).then(() => {}, () => {})
  await settle393()
  tailLost({ n: 0 }, new Error("EIO: c2-during"))
  gateOpen = true
  openGate()
  await flushP
  failoverFoldNote(98_730_201, "", "ag-f5c2c")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(folds.length).toBe(2)
  expect(String(folds[0].foldWriteErr || ""), "первая удачная строка несёт прежний отказ").toContain("c2-first")
  expect(String(folds[0].foldWriteErr || ""), "ошибка, пришедшая за время записи, не въехала в летящую запись").not.toContain("c2-during")
  expect(String(folds[1].foldWriteErr || ""), "вторая несёт отказ, накопленный за время первой записи").toContain("c2-during")
  expect(String(folds[1].foldWriteErr || ""), "доставленный отказ не едет повторно").not.toContain("c2-first")
  failoverFoldReset()
})

test("#393-A2-FIX5 U-F5s: отказ записи, начатой до сброса, возвращает шаги счётом с происхождением", async () => {
  failoverBindReset()
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f5s/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f5s" },
    now: 98_700_000,
  })
  const world = { globalHome: "/probes-f5s" }
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  let staleSid = ""
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0 && !gateOpen) {
      try { staleSid = String((JSON.parse(String(text)) || {}).sid || "") } catch (x) { staleSid = "" }
      await gate
      throw new Error("EIO: d2 gated write refusal")
    }
    return origWrite(p, text)
  }
  await failoverFoldObserve(m.$, world, 98_700_001, "sticky-d2", "sid-f5s-old", "ag-d2")
  await failoverFoldObserve(m.$, world, 98_700_002, "", "sid-f5s-old", "ag-d2")
  await failoverFoldObserve(m.$, world, 98_700_003, "", "sid-f5s-old", "ag-d2")
  await failoverFoldObserve(m.$, world, 98_700_004, "", "sid-f5s-old", "ag-d2")
  const flush1 = failoverFoldFlush(m.$, world)
  const wrapped = flush1.then(() => ({ ok: true as boolean }), (e: unknown) => ({ ok: false as boolean, e }))
  await settle393()
  failoverFoldReset()
  gateOpen = true
  openGate()
  await wrapped
  const lostSteps = (registerModule393 as any).failoverFoldResetLost()
  expect(lostSteps, "n=4 шага старой свёртки вернулись счётом (правило хвоста)").toBe(4)
  expect(lostN393("failover-fold-stale"), "потеря старой записи названа").toBe(1)
  await failoverFoldObserve(m.$, world, 98_700_010, "", "sid-f5s-new", "ag-f5s-new")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(folds.length, "одна строка свёртки в журнале").toBe(1)
  expect(folds[0].foldResetLost, "запись новой сессии несёт вернувшиеся шаги счётом").toBe(4)
  expect(String(folds[0].foldWriteErr || ""), "запись несёт текст отказа старой записи").toContain("d2 gated write refusal")
  expect(Array.isArray(folds[0].lostFrom) && folds[0].lostFrom.indexOf(staleSid) >= 0,
    "запись несёт происхождение -- sid отказавшей записи").toBe(true)
  failoverBindReset()
})

test("#393-A2-FIX7 U-F7cut: отказ записи, начатой до сброса, с длинным текстом называет отрезанное числом", async () => {
  failoverBindReset()
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f7c/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f7c" },
    now: 98_731_000,
  })
  const world = { globalHome: "/probes-f7c" }
  let gateOpen = false
  let openGate: () => void = () => {}
  const gate = new Promise<void>(r => { openGate = r })
  let staleSid = ""
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0 && !gateOpen) {
      try { staleSid = String((JSON.parse(String(text)) || {}).sid || "") } catch (x) { staleSid = "" }
      await gate
      throw new Error("EIO: f7 gated write refusal " + "x".repeat(372))
    }
    return origWrite(p, text)
  }
  await failoverFoldObserve(m.$, world, 98_731_001, "sticky-d2", "sid-f7c-old", "ag-d2")
  await failoverFoldObserve(m.$, world, 98_731_002, "", "sid-f7c-old", "ag-d2")
  await failoverFoldObserve(m.$, world, 98_731_003, "", "sid-f7c-old", "ag-d2")
  await failoverFoldObserve(m.$, world, 98_731_004, "", "sid-f7c-old", "ag-d2")
  const flush1 = failoverFoldFlush(m.$, world)
  const wrapped = flush1.then(() => ({ ok: true as boolean }), (e: unknown) => ({ ok: false as boolean, e }))
  await settle393()
  failoverFoldReset()
  gateOpen = true
  openGate()
  await wrapped
  const lostSteps = (registerModule393 as any).failoverFoldResetLost()
  expect(lostSteps, "n=4 шага старой свёртки вернулись счётом (правило хвоста)").toBe(4)
  expect(lostN393("failover-fold-stale"), "потеря старой записи названа").toBe(1)
  await failoverFoldObserve(m.$, world, 98_731_010, "", "sid-f7c-new", "ag-f7c-new")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(folds.length, "одна строка свёртки в журнале").toBe(1)
  expect(folds[0].foldResetLost, "запись новой сессии несёт вернувшиеся шаги счётом").toBe(4)
  expect(String(folds[0].foldWriteErr || ""), "запись несёт голову текста отказа старой записи").toContain("f7 gated write refusal")
  expect(String(folds[0].foldWriteErr || "").length, "текст отказа отрезан до 240").toBe(240)
  expect(folds[0].foldWriteErrCut, "160 отрезанных символов старой записи названы числом").toBe(160)
  expect(Array.isArray(folds[0].lostFrom) && folds[0].lostFrom.indexOf(staleSid) >= 0,
    "запись несёт происхождение -- sid отказавшей записи").toBe(true)
  failoverBindReset()
})

test("#393-A2-FIX8 U-F8drain: помощник drainFold393 оставляет чистое состояние, когда перенос едет вместе с шагами (хвостом сброса)", async () => {
  failoverBindReset()
  failoverFoldReset()
  const m = mod$393({
    files: { "/probes-f8d/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f8d" },
    now: 98_798_000,
    fail: { fsWrite: (p) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const world = { globalHome: "/probes-f8d" }
  armFailoverFoldTimer(m.$, world, 98_798_001)
  await failoverFoldObserve(m.$, world, 98_798_001, "sticky-f8d", "sid-f8d", "ag-f8d")
  expect(m.everyCbs.length, "таймер взведён").toBe(1)
  await m.everyCbs[0]()
  expect(failoverFoldWriteErr(), "перенос засеян").not.toBe("")
  expect(Object.keys(registerModule393.lostWritesSnapshot()).length > 0, "lostWrites засеян").toBe(true)
  expect(registerModule393.lostWritesSnapshot()["failover-fold-timer-flush"]?.n, "потеря таймерной записи названа").toBe(1)
  await drainFold393()
  expect(failoverFoldWriteErr(), "перенос слит: foldWriteErr пуст").toBe("")
  expect(failoverFoldResetLost(), "перенос слит: foldResetLost нулевой").toBe(0)
  expect(failoverFoldSplitLost(), "перенос слит: foldSplitLost нулевой").toBe(0)
  expect(Object.keys(registerModule393.lostWritesSnapshot()).length, "lostWrites слит: снапшот пуст").toBe(0)
})

test("#393-A2-FIX9 U-F9write: перенос при пустых шагах уезжает ТОЛЬКО записью помощника", async () => {
  await drainFold393()
  failoverBindReset()
  failoverFoldReset()
  const m = mod$393({
    files: { "/probes-f9w/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f9w" },
    now: 98_797_000,
    fail: { fsWrite: (p) => p.indexOf("/failover/journal.jsonl") >= 0 },
  })
  const world = { globalHome: "/probes-f9w" }
  armFailoverFoldTimer(m.$, world, 98_797_001)
  await failoverFoldObserve(m.$, world, 98_797_001, "sticky-f9w", "sid-f9w", "ag-f9w")
  await m.everyCbs[0]()
  expect(failoverFoldWriteErr(), "перенос засеян отказом таймерной записи").not.toBe("")
  const tail = failoverFoldReset()
  expect(tail !== null, "сброс при шагах вернул хвост").toBe(true)
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  tailLost(tail!.rec, new Error("scripted tail refusal f9w"))
  expect(failoverFoldCount(), "засев при ПУСТЫХ шагах").toBe(0)
  expect(failoverFoldResetLost() > 0, "шаги хвоста ушли в foldResetLost").toBe(true)
  expect(failoverFoldWriteErr(), "ошибка хвоста в переносе").toContain("scripted tail refusal f9w")
  expect(failoverFoldWriteErr(), "первичная ошибка таймерной записи пережила хвост").toContain("EIO: scripted write refusal")
  const recs = await drainFold393()
  expect(recs.length, "помощник записал ровно одну строку свёртки").toBe(1)
  expect(String(recs[0].foldWriteErr), "запись несёт ошибку хвоста").toContain("scripted tail refusal f9w")
  expect(String(recs[0].foldWriteErr), "запись несёт первичную ошибку").toContain("EIO: scripted write refusal")
  expect(String(recs[0].foldWriteErr), "запись несёт путь отказавшего шарда").toContain("for /probes-f9w/failover/journal.jsonl.shard.")
  expect(recs[0].foldResetLost, "запись несёт шаги хвоста").toBe(1)
  expect(recs[0].lostFrom, "запись несёт происхождение и только его").toEqual(["sid-f9w"])
  expect(recs[0].lost && recs[0].lost["failover-fold-timer-flush"] && recs[0].lost["failover-fold-timer-flush"].n, "запись несёт снимок потери таймерной записи").toBe(1)
  expect(String(recs[0].journalWriteErr || ""), "запись несёт ошибку журнала").toContain("/probes-f9w/failover/journal.jsonl")
  expect(String(recs[0].lost && recs[0].lost["failover-fold-timer-flush"] && recs[0].lost["failover-fold-timer-flush"].last), "снимок потери несёт текст отказа").toContain("EIO: scripted write refusal")
  expect(Object.keys(recs[0].lost || {}), "снимок потери несёт только таймерную запись").toEqual(["failover-fold-timer-flush"])
  expect(Object.keys(recs[0].lost["failover-fold-timer-flush"]).sort(), "запись потери несёт ровно счёт и текст").toEqual(["last", "n"])
  expect(recs[0].sid, "запись принадлежит сессии помощника").toBe("sid-drain")
  expect(recs[0].n, "запись несёт один шаг помощника").toBe(1)
  expect(recs[0].agents, "запись несёт агента помощника").toEqual({ "ag-drain": 1 })
  // CONSTRAINT: полный перечень ключей — лишнее поле потери в записи (например foldSplitLost без отказа) обязано краснеть.
  const shard = "EIO: scripted write refusal for /probes-f9w/failover/journal\\.jsonl\\.shard\\.agg-\\d+-98797001-1"
  expect(String(recs[0].lost["failover-fold-timer-flush"].last), "текст потери несёт путь отказавшего шарда целиком").toMatch(new RegExp("^" + shard + "$"))
  expect(String(recs[0].foldWriteErr), "первичная ошибка склеена из хвоста и шарда").toMatch(new RegExp("^scripted tail refusal f9w \\| " + shard + "$"))
  expect(String(recs[0].journalWriteErr), "ошибка журнала названа по дому журнала").toMatch(new RegExp("^/probes-f9w/failover/journal\\.jsonl: " + shard + "$"))
  expect(String(recs[0].rec), "идентификатор записи — свёртка помощника").toMatch(/^agg-\d+-98799001-1$/)
  expect(recs[0].t, "время записи — такт помощника").toBe("1970-01-02T03:26:39.001Z")
  expect(recs[0].tFirst, "начало окна — такт помощника").toBe("1970-01-02T03:26:39.001Z")
  expect(recs[0].tLast, "конец окна — такт помощника").toBe("1970-01-02T03:26:39.001Z")
  expect(recs[0].dtMs, "длительность окна одного шага").toBe(0)
  expect(recs[0].sticky, "липкость помощника").toBe("sticky-drain")
  expect(recs[0].carrier, "носитель — мод").toBe("mod")
  expect(recs[0].probe, "проба — failover").toBe("failover")
  expect(recs[0].fold, "запись — свёртка").toBe(true)
  expect(Object.keys(recs[0]).sort(), "запись несёт ровно ожидаемые поля").toEqual(["agents", "carrier", "dtMs", "fold", "foldResetLost", "foldWriteErr", "journalWriteErr", "lost", "lostFrom", "n", "probe", "rec", "sid", "sticky", "t", "tFirst", "tLast"])
  expect(failoverFoldWriteErr(), "перенос слит записью: foldWriteErr пуст").toBe("")
  expect(failoverFoldResetLost(), "перенос слит записью: foldResetLost нулевой").toBe(0)
  expect(failoverFoldSplitLost(), "перенос слит записью: foldSplitLost нулевой").toBe(0)
  expect(Object.keys(registerModule393.lostWritesSnapshot()).length, "lostWrites слит").toBe(0)
  failoverBindReset()
})

test("#393-A2-FIX5 U-F5o: перенос через /clear несёт происхождение", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f5o/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f5o" },
    now: 98_980_000,
    sid: "sid-new-f5o",
  })
  const world = { globalHome: "/probes-f5o" }
  const T = 98_980_000
  let mode = "ok"
  let tailSid = ""
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0 && mode !== "ok") {
      try { tailSid = String((JSON.parse(String(text)) || {}).sid || "") } catch (x) { tailSid = "" }
      throw new Error("EIO: d3-" + mode)
    }
    return origWrite(p, text)
  }
  const subs = subs393()
  const cl = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)
  armFailoverFoldTimer(m.$, world, T)
  await failoverFoldObserve(m.$, world, T, "A", "sid-f5o-old", "ag-d3-old")
  mode = "tail"
  await cl[0].fn(m.$, { command: "clear", args: "" }, async (e: any) => e)
  await settle393()
  mode = "ok"
  await failoverFoldObserve(m.$, world, T + 2, "", "sid-f5o-new", "ag-d3-new")
  await failoverFoldFlush(m.$, world)
  let recs = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(recs.length, "одна строка свёртки в журнале").toBe(1)
  expect(recs[0].lostFrom, "строка переноса несёт происхождение -- sid отказавшего хвоста").toEqual([tailSid])
  expect(recs[0].lostFrom.indexOf(recs[0].sid) < 0, "происхождение -- не sid самой строки").toBe(true)
  // --- второй сценарий: /clear без шагов при недоставленной потере -----------
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  await failoverFoldObserve(m.$, world, T + 10, "", "sid-f5o-old2", "ag-o2")
  await failoverFoldFlush(m.$, world)
  tailLost({ n: 2 }, new Error("EIO: f5o-undelivered"))
  mode = "tail2"
  await cl[0].fn(m.$, { command: "clear", args: "" }, async (e: any) => e)
  await settle393()
  mode = "ok"
  await failoverFoldObserve(m.$, world, T + 12, "", "sid-f5o-new2", "ag-o2new")
  await failoverFoldFlush(m.$, world)
  recs = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  const last = recs[recs.length - 1]
  expect(last.foldResetLost, "недоставленные шаги доехали записью новой сессии").toBe(2)
  expect(Array.isArray(last.lostFrom) && last.lostFrom.indexOf("sid-f5o-old2") >= 0,
    "запись новой сессии несёт происхождение прежней").toBe(true)
  failoverFoldReset()
})

test("#393-A2-FIX5 B-F5del: удаление исчезнувшего ключа -- не отказ уборки", async () => {
  await drainFold393()
  await clear393()
  const hook = hook393(subs393(), "tool.call")
  const sweepsOf = (mm: any) => shards393(mm.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep")
  // (а) ключ исчезает до броска: снесла соседняя уборка после /clear
  // CONSTRAINT: яд без t -- каноническая протухлость (B(2222)): с t внутри
  // ttl (120 000 мс) memoUsable истинен и уборка ключ не трогает вовсе.
  const poisonA = "v:judge:poison-f5del-a"
  const mA = mod$393({
    files: judgeFiles393("/probes-f5del-a"),
    env: { CLAUDE_PROBES_DIR: "/probes-f5del-a", PWD: "/work-f5del-a", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poisonA]: { kind: "BLOCK", rest: "x" } },
    answers: ["OK: f5del-a"],
  })
  const origDeleteA = mA.$.store.delete
  mA.$.store.delete = async (k: string) => {
    if (String(k) === poisonA) {
      mA.store.delete(String(k))
      throw new Error("store.delete: scripted refusal for " + k)
    }
    return origDeleteA(k)
  }
  const lostBeforeA = lostN393("judge-store-sweep-items")
  await hook(mA.$, { tool: "Agent", prompt: "f5del-a", subagent_type: "scout" }, async (e: any) => e)
  const sweepsA = sweepsOf(mA)
  expect(sweepsA.length).toBe(1)
  expect(sweepsA[0].deleteFailed, "ключа уже нет -- отказа уборки нет").toBe(0)
  expect(sweepsA[0].goneMeanwhile, "исчезновение под нами названо").toBe(1)
  expect(lostN393("judge-store-sweep-items") - lostBeforeA, "потеря не объявлена").toBe(0)
  // (б) ключ остаётся: отказ уборки честный
  await clear393()
  const poisonB = "v:judge:poison-f5del-b"
  const mB = mod$393({
    files: judgeFiles393("/probes-f5del-b"),
    env: { CLAUDE_PROBES_DIR: "/probes-f5del-b", PWD: "/work-f5del-b", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poisonB]: { kind: "BLOCK", rest: "x" } },
    answers: ["OK: f5del-b"],
  })
  const origDeleteB = mB.$.store.delete
  mB.$.store.delete = async (k: string) => {
    if (String(k) === poisonB) throw new Error("store.delete: scripted refusal for " + k)
    return origDeleteB(k)
  }
  await hook(mB.$, { tool: "Agent", prompt: "f5del-b", subagent_type: "scout" }, async (e: any) => e)
  const sweepsB = sweepsOf(mB)
  expect(sweepsB.length).toBe(1)
  expect(sweepsB[0].deleteFailed, "ключ остался -- отказ уборки назван").toBe(1)
  expect(sweepsB[0].goneMeanwhile, "исчезновения не было").toBe(0)
  // CONSTRAINT: журнал уборки записан удачно -- потеря уехала ВНУТРИ строки
  // (appendJournal осушает lostWrites в летящую запись), снапшот модуля чист.
  expect(sweepsB[0].lost && sweepsB[0].lost["judge-store-sweep-items"] ? sweepsB[0].lost["judge-store-sweep-items"].n : 0,
    "отказ опубликован в самой строке").toBe(1)
})

test("#393-A2-FIX6 U-F6from: отказ записи возвращает происхождение переноса", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f6from/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f6from" },
    now: 98_740_000,
  })
  const world = { globalHome: "/probes-f6from" }
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  tailLost({ n: 1, sid: "sid-f6-x", lostFrom: ["sid-f6-p"], lostFromMore: 3 }, new Error("EIO: f6from-tail"))
  let writeN = 0
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) {
      // CONSTRAINT: номер записи фиксируется НА ВХОДЕ -- возобновлённая после
      // отказа вторая запись остаётся второй и не видит счётчик соседа.
      const mine = ++writeN
      if (mine === 1) throw new Error("EIO: f6from-first")
    }
    return origWrite(p, text)
  }
  failoverFoldNote(98_740_001, "", "ag-f6from-a")
  await failoverFoldFlush(m.$, world).then(() => {}, () => {})
  failoverFoldNote(98_740_101, "", "ag-f6from-b")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(folds.length).toBe(1)
  expect(folds[0].lostFrom, "происхождение пережило отказ записи").toEqual(["sid-f6-p", "sid-f6-x"])
  expect(folds[0].lostFromMore, "безымянный счёт пережил отказ").toBe(3)
  failoverFoldReset()
})

test("#393-A2-FIX6 U-F6cut1: отрезанное сообщение хвоста посчитано", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f6cut1/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f6cut1" },
    now: 98_750_000,
  })
  const world = { globalHome: "/probes-f6cut1" }
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  const long = "EIO: " + "y".repeat(395)
  expect(long.length).toBe(400)
  tailLost({ n: 1 }, new Error(long))
  failoverFoldNote(98_750_001, "", "ag-f6cut1")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(folds.length).toBe(1)
  expect(String(folds[0].foldWriteErr)).toBe(long.slice(0, 240))
  expect(folds[0].foldWriteErrCut, "160 отрезанных символов названы числом").toBe(160)
  failoverFoldReset()
})

test("#393-A2-FIX6 U-F6cut2: отрезанное сообщение отказа записи посчитано", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f6cut2/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f6cut2" },
    now: 98_760_000,
  })
  const world = { globalHome: "/probes-f6cut2" }
  const long = "EIO: f6cut2 " + "z".repeat(388)
  expect(long.length).toBe(400)
  let writeN = 0
  const origWrite = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (String(p).indexOf("/failover/journal.jsonl") >= 0) {
      // CONSTRAINT: номер записи фиксируется НА ВХОДЕ -- возобновлённая после
      // отказа вторая запись остаётся второй и не видит счётчик соседа.
      const mine = ++writeN
      if (mine === 1) throw new Error(long)
    }
    return origWrite(p, text)
  }
  failoverFoldNote(98_760_001, "", "ag-f6cut2a")
  await failoverFoldFlush(m.$, world).then(() => {}, () => {})
  failoverFoldNote(98_760_101, "", "ag-f6cut2b")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(folds.length).toBe(1)
  expect(String(folds[0].foldWriteErr)).toBe(long.slice(0, 240))
  expect(folds[0].foldWriteErrCut, "160 отрезанных символов названы числом").toBe(160)
  failoverFoldReset()
})

test("#393-A2-FIX6 U-F6dedup: один sid дважды -- одно происхождение", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f6dedup/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f6dedup" },
    now: 98_770_000,
  })
  const world = { globalHome: "/probes-f6dedup" }
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  tailLost({ n: 1, sid: "sid-f6-d" }, new Error("EIO: d1"))
  tailLost({ n: 1, sid: "sid-f6-d" }, new Error("EIO: d2"))
  failoverFoldNote(98_770_001, "", "ag-f6dedup")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(folds[0].lostFrom).toEqual(["sid-f6-d"])
  expect(folds[0].lostFromMore === undefined, "дубликат -- не переполнение").toBe(true)
  expect(folds[0].foldResetLost).toBe(2)
  failoverFoldReset()
})

test("#393-A2-FIX6 U-F6cap: кап происхождения 16, остаток безымянным счётом", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f6cap/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f6cap" },
    now: 98_780_000,
  })
  const world = { globalHome: "/probes-f6cap" }
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  for (let k = 0; k < 20; k++) tailLost({ n: 1, sid: "sid-f6-c" + k }, new Error("EIO: c" + k))
  tailLost({ n: 1, sid: "sid-f6-c0" }, new Error("EIO: c0-again"))
  failoverFoldNote(98_780_001, "", "ag-f6cap")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(folds[0].lostFrom).toEqual(Array.from({ length: 16 }, (_, k) => "sid-f6-c" + k))
  expect(folds[0].lostFromMore).toBe(4)
  expect(folds[0].foldResetLost).toBe(21)
  failoverFoldReset()
})

test("#393-A2-FIX6 U-F6clear2: двойной /clear без наблюдения не метит перенос ложным sid", async () => {
  await drainFold393()
  const m = mod$393({
    files: { "/probes-f6clear2/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-f6clear2" },
    now: 98_790_000,
  })
  const world = { globalHome: "/probes-f6clear2" }
  const tailLost = (registerModule393 as any).failoverFoldTailLost
  tailLost({ n: 1, sid: "sid-f6-a" }, new Error("EIO: a"))
  expect(failoverFoldReset(), "без шагов хвоста нет").toBeNull()
  expect(failoverFoldReset(), "без шагов хвоста нет").toBeNull()
  failoverFoldNote(98_790_001, "", "ag-f6clear2")
  await failoverFoldFlush(m.$, world)
  const folds = shards393(m.writes, "/failover/journal.jsonl").filter((r: any) => r.fold)
  expect(folds[0].lostFrom).toEqual(["sid-f6-a"])
  expect(folds[0].lostFromMore === undefined, "дубликат -- не переполнение").toBe(true)
  failoverFoldReset()
})

test("#393-A2-FIX6 B-F6reread: отказ удаления с отказавшей перечиткой -- отказ уборки", async () => {
  await clear393()
  const hook = hook393(subs393(), "tool.call")
  const sweepsOf = (mm: any) => shards393(mm.writes, "/judge/journal.jsonl.shard.").filter(r => r.outcome === "store_sweep")
  const poison = "v:judge:poison-f6reread"
  let deleteRefused = false
  let rereadThrown = 0
  const mC = mod$393({
    files: judgeFiles393("/probes-f6reread"),
    env: { CLAUDE_PROBES_DIR: "/probes-f6reread", PWD: "/work-f6reread", CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 1_000_000,
    stored: { [poison]: { kind: "BLOCK", rest: "x" } },
    answers: ["OK: f6reread"],
  })
  const origDelete = mC.$.store.delete
  mC.$.store.delete = async (k: string) => {
    if (String(k) === poison) {
      deleteRefused = true
      throw new Error("store.delete: scripted refusal for " + k)
    }
    return origDelete(k)
  }
  const origGet = mC.$.store.get
  mC.$.store.get = async (k: string) => {
    if (String(k) === poison && deleteRefused) {
      rereadThrown++
      throw new Error("store.get: scripted reread refusal")
    }
    return origGet(k)
  }
  await hook(mC.$, { tool: "Agent", prompt: "f6reread", subagent_type: "scout" }, async (e: any) => e)
  const sweeps = sweepsOf(mC)
  expect(sweeps.length).toBe(1)
  expect(sweeps[0].deleteFailed, "перечитать нельзя -- отказ уборки назван").toBe(1)
  expect(sweeps[0].goneMeanwhile, "исчезновения не было").toBe(0)
  expect(rereadThrown, "перечитка после отказа состоялась").toBe(1)
  expect(sweeps[0].lost && sweeps[0].lost["judge-store-sweep-reread"] ? sweeps[0].lost["judge-store-sweep-reread"].n : 0,
    "повторный отказ чтения назван judge-store-sweep-reread").toBeGreaterThanOrEqual(1)
  const rereadLast = String(sweeps[0].lost["judge-store-sweep-reread"].last || "")
  expect(rereadLast, "last несёт текст перечитки y").toContain("scripted reread refusal")
  expect(rereadLast.indexOf("store.delete") < 0, "last не несёт текст удаления x").toBe(true)
})

test("#489-B1 Z1 loadWorld: яд toString глобального probes.toml не бросает, сайт global-probes-toml", async () => {
  await drainFold393()
  const home = "/z1-b1"
  const m = mod$393({
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-z1-b1" },
    now: 200_000_000,
    fail: { fsReadPoison: [home + "/probes.toml"] },
  })
  let thrown = ""
  try {
    await loadWorld(m.$, { PROBES_DIR: home, ROUTING_TABLE: "", CONFIG_DIR: "", HOME: home, PWD: "/work-z1-b1" }, "/work-z1-b1")
  } catch (x) { thrown = String(x) }
  expect(thrown, "непечатный отказ чтения не выходит из loadWorld").toBe("")
  expect(lostN393("global-probes-toml"), "отказ назван сайтом").toBeGreaterThanOrEqual(1)
})

test("#489-B1 Z2 loadWorld: нечитаемый проектный probes.toml назван project-probes-toml", async () => {
  await drainFold393()
  const proj = "/work-z2-b1/.claude/probes/probes.toml"
  const m = mod$393({
    env: { HOME: "/hh-z2-b1", PWD: "/work-z2-b1" },
    now: 200_010_000,
    fail: { fsReadErr: [proj] },
  })
  let thrown = ""
  try {
    await loadWorld(m.$, {
      PROBES_DIR: "", ROUTING_TABLE: "", CONFIG_DIR: "", HOME: "/hh-z2-b1", PWD: "/work-z2-b1",
    }, "/work-z2-b1")
  } catch (x) { thrown = String(x) }
  expect(thrown, "нечитаемый проектный слой не бросает loadWorld").toBe("")
  expect(lostN393("project-probes-toml"), "слой найден layerHit и отказ назван").toBeGreaterThanOrEqual(1)
})

test("#489-B1 Z3 allowedSrc: нечитаемая env-таблица — env:unreadable, отсутствие — env:absent", async () => {
  await drainFold393()
  const bad = "/tbl-z3-b1/routing-table.toml"
  const gone = "/tbl-z3-gone-b1/routing-table.toml"
  const m = mod$393({
    env: { CLAUDE_PROBES_DIR: "/probes-z3-b1", PWD: "/work-z3-b1" },
    now: 200_020_000,
    fail: { fsReadErr: [bad] },
  })
  const envBase = { PROBES_DIR: "/probes-z3-b1", CONFIG_DIR: "/cfg-z3-b1", HOME: "", PWD: "/work-z3-b1" }
  const badWorld = await loadWorld(m.$, Object.assign({ ROUTING_TABLE: bad }, envBase), "/work-z3-b1")
  expect(String(badWorld.allowedSrc), "нечитаемая таблица не пишется как absent").toContain("env:unreadable")
  const goneWorld = await loadWorld(m.$, Object.assign({ ROUTING_TABLE: gone }, envBase), "/work-z3-b1")
  expect(String(goneWorld.allowedSrc), "отсутствующий путь остаётся env:absent").toContain("env:absent")
  expect(String(goneWorld.allowedSrc).indexOf("env:unreadable") < 0, "отсутствие не метится unreadable").toBe(true)
})

test("#489-B1 Z4 allowedSrc: нечитаемая marketplace-таблица — marketplace:unreadable", async () => {
  await drainFold393()
  const market = "/cfg-z4-b1/plugins/marketplaces/catalyst/hooks/routing-table.toml"
  const m = mod$393({
    env: { CLAUDE_PROBES_DIR: "/probes-z4-b1", CLAUDE_CONFIG_DIR: "/cfg-z4-b1", PWD: "/work-z4-b1" },
    now: 200_030_000,
    fail: { fsReadErr: [market] },
  })
  const world = await loadWorld(m.$, {
    PROBES_DIR: "/probes-z4-b1", ROUTING_TABLE: "", CONFIG_DIR: "/cfg-z4-b1", HOME: "", PWD: "/work-z4-b1",
  }, "/work-z4-b1")
  expect(String(world.allowedSrc)).toContain("marketplace:unreadable")
})

test("#489-B1 Z5 consult: нечитаемый prompt.md пробы назван probe-prompt-read", async () => {
  await drainFold393()
  const home = "/probes-z5-b1"
  const m = mod$393({
    files: { [home + "/probes.toml"]: '[probe.idle-watch]\nact = "nudge"\nwindow_min = 0\n' },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-z5-b1", CLAUDE_IDLE: "1" },
    now: 200_040_000,
    answers: ["SILENT: z5"],
    fail: { fsReadErr: [home + "/idle-watch/prompt.md"] },
  })
  await hook393(subs393(), "tool.call")(m.$, { tool: "Read" }, async (e: any) => e)
  await settle393()
  const lines = shards393(m.writes, "/idle-watch/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.lost && r.lost["probe-prompt-read"]), "отказ чтения промпта уехал в журнал").toBe(true)
})

test("#489-B1 Z6 consult: нечитаемое вложение названо probe-attach-read", async () => {
  await drainFold393()
  const home = "/probes-z6-b1"
  const m = mod$393({
    files: { [home + "/probes.toml"]: '[probe.idle-watch]\nact = "nudge"\nattach_files = 1\nwindow_min = 0\n' },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-z6-b1", CLAUDE_IDLE: "1" },
    now: 200_050_000,
    answers: ["SILENT: z6"],
    fail: { fsReadErr: ["/z6-b1/note.md"] },
  })
  await hook393(subs393(), "tool.call")(m.$, { tool: "Read", prompt: "see /z6-b1/note.md" }, async (e: any) => e)
  await settle393()
  const lines = shards393(m.writes, "/idle-watch/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.lost && r.lost["probe-attach-read"]), "пропущенный файл вложения назван").toBe(true)
})

test("#489-B1 Z7 ruleText: нечитаемый text_file не мемоизируется пустым", async () => {
  await drainFold393()
  const home = "/probes-z7-b1"
  const rule = "/z7-b1/rule.txt"
  const files: Record<string, string> = {
    [home + "/probes.toml"]: '[prompt.z7]\ntool = "Read"\ntext_file = "' + rule + '"\n',
  }
  const bad = [rule]
  const m = mod$393({
    files,
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-z7-b1", CLAUDE_PROMPTS: "1" },
    now: 200_060_000,
    fail: { fsReadErr: bad },
  })
  const hook = hook393(subs393(), "tool.describe")
  const first = await hook(m.$, { tool: "Read", description: "Base" }, async (e: any) => e)
  expect(String(first.description), "нечитаемый файл правила не применяется").toBe("Base")
  expect(lostN393("prompt-rule-text")).toBeGreaterThanOrEqual(1)
  bad.splice(0, bad.length)
  files[rule] = "RULE-Z7"
  const second = await hook(m.$, { tool: "Read", description: "Base" }, async (e: any) => e)
  expect(String(second.description), "повторное чтение не заморожено пустой строкой").toContain("RULE-Z7")
})

test("#489-B1 Z8 form: Edit не судит нечитаемое тело, Bash даёт F и откат", async () => {
  await drainFold393()
  const formZ8 = FORM_CFG_335
    .replace('write_target = "zzz-write-redirect"', () => String.raw`write_target = '\.md$'`)
    .replace('heredoc = "zzz-heredoc"', "heredoc = \"(<<'EOF'\\n)([\\s\\S]*?)(\\nEOF)\"")
  const homeE = "/probes-z8e-b1"
  const editPath = "/z8e-b1/report.md"
  const mE = mod$393({
    files: { [homeE + "/probes.toml"]: formZ8 },
    env: { CLAUDE_PROBES_DIR: homeE, PWD: "/work-z8e-b1", CLAUDE_FORM: "1" },
    now: 200_070_000,
    fail: { fsReadErr: [editPath] },
  })
  await hook393(subs393(), "tool.call")(mE.$, {
    tool: "Edit", file_path: editPath, old_string: "a", new_string: "b",
  }, async (e: any) => e)
  const linesE = shards393(mE.writes, "/form/journal.jsonl.shard.")
  expect(linesE.some((r: any) => r.outcome === "refuse"), "Edit нечитаемого файла не судит тело").toBe(false)
  expect(lostN393("form-path-read") + linesE.filter((r: any) => r.lost && r.lost["form-path-read"]).length,
    "Edit нечитаемого файла назван").toBeGreaterThanOrEqual(1)

  await drainFold393()
  const homeB = "/probes-z8b-b1"
  const bashPath = "/z8b-b1/report.md"
  const cmdU = "cat >> " + bashPath + " <<'EOF'\nzzz-legalize\nEOF"
  const mB = mod$393({
    files: { [homeB + "/probes.toml"]: formZ8 + '\n[probe.form.act]\nF = "cancel"\n', [bashPath]: "old" },
    env: { CLAUDE_PROBES_DIR: homeB, PWD: "/work-z8b-b1", CLAUDE_FORM: "1" },
    now: 200_080_000,
    fail: { fsReadErr: [bashPath] },
  })
  const outB = await hook393(subs393(), "tool.call")(mB.$, { tool: "Bash", command: cmdU }, formNext393(mB, { [bashPath]: "zzz-legalize\n" }, "Darwin"))
  const linesB = shards393(mB.writes, "/form/journal.jsonl.shard.")
  expect(linesB.some((r: any) => r.outcome === "refuse" && r.cls.includes("F")), "Z8 unreadable post is F").toBe(true)
  expect(linesB.some((r: any) => Array.isArray(r.cls) && r.cls.includes("C1")), "Z8 unreadable body is not judged").toBe(false)
  expect(typeof outB.deny, "Z8 unreadable denial").toBe("string")
  expect(linesB.filter((r: any) => r.outcome === "error" && r.verdict === "rollback failed: " + bashPath).length, "Z8 rollback failure journaled").toBe(1)
  expect(String(outB.deny), "Z8 model reads form refusal").toContain("Form probe refused")
  expect(String(outB.deny), "Z8 model reads rollback failure").toContain("rollback failed: " + bashPath)
  const unreadB = mB.writes.filter(w => w.path.includes("/form/records/")).flatMap(w => JSON.parse(String(w.text)).refuse || []).find(r => r.c === "F")
  expect(String(unreadB?.q), "Z8 unreadable cause named").toContain("target unreadable after write")
  expect(String(unreadB?.q), "Z8 EIO retained").toContain("EIO")
  expect(String(unreadB?.src), "Z8 unreadable path named").toContain(bashPath)
  expect(mB.files[bashPath], "Z8 readable-stat unreadable-text restored").toBe("old")
  expect(lostN393("form-path-read") + linesB.filter((r: any) => r.lost && r.lost["form-path-read"]).length,
    ">> нечитаемого файла назван").toBeGreaterThanOrEqual(1)

  await drainFold393()
  const homeC = "/probes-z8c-b1"
  const gonePath = "/z8c-b1/report.md"
  const cmdC = "cat >> " + gonePath + " <<'EOF'\nzzz-legalize\nEOF"
  const mC = mod$393({
    files: { [homeC + "/probes.toml"]: formZ8 },
    env: { CLAUDE_PROBES_DIR: homeC, PWD: "/work-z8c-b1", CLAUDE_FORM: "1" },
    now: 200_090_000,
  })
  await hook393(subs393(), "tool.call")(mC.$, { tool: "Bash", command: cmdC }, formNext393(mC, { [gonePath]: "zzz-legalize\n" }))
  const lines = shards393(mC.writes, "/form/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.outcome === "refuse"), ">> отсутствующего файла судит тело").toBe(true)
})

test("#489-B1 Z9 world: отказ worldFor на пяти хуках назван своим сайтом и хук отдаёт next", async () => {
  await drainFold393()
  const rows: Array<{ ev: string; e: any; site: string; pwd: string }> = [
    { ev: "prompt.section", e: { name: "communication:L", text: "T" }, site: "prompt-section-world", pwd: "/work-z9-ps-b1" },
    { ev: "tool.describe", e: { tool: "Read", description: "D" }, site: "tool-describe-world", pwd: "/work-z9-td-b1" },
    { ev: "command.describe", e: { command: "help", description: "D" }, site: "command-describe-world", pwd: "/work-z9-cd-b1" },
  ]
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const marker = { via: "next-z9", ev: row.ev }
    const m = mod$393({
      env: { PWD: row.pwd, HOME: "/hh-z9-b1" },
      now: 200_100_000 + i * 10_000,
      fail: { envPoison: ["HOME"] },
    })
    const out = await hook393(subs393(), row.ev)(m.$, row.e, async () => marker)
    expect(out, row.ev + " отдаёт результат next").toEqual(marker)
    expect(lostN393(row.site), row.site).toBeGreaterThanOrEqual(1)
  }
  const mS = mod$393({
    env: { PWD: "/work-z9-sp-b1", HOME: "/hh-z9-b1" },
    now: 200_140_000,
    fail: { envPoison: ["HOME"] },
  })
  const spawned = { agentId: "ag-z9-b1" }
  const outS = await hook393(subs393(), "agent.spawn")(
    mS.$, { subagentType: "any", prompt: "q", model: "m" }, async () => spawned,
  )
  expect(outS, "agent.spawn отдаёт результат next").toEqual(spawned)
  expect(lostN393("failover-spawn-world")).toBeGreaterThanOrEqual(1)

  failoverBindSet("ag-z9s-b1", { ladder: ["m-z9"], subagentType: "t", class: "1a", sticky: null })
  const mT = mod$393({
    env: { PWD: "/work-z9-ts-b1", HOME: "/hh-z9-b1" },
    now: 200_150_000,
    fail: { envPoison: ["HOME"] },
  })
  const stepped = { via: "next-z9s" }
  const outT = await drainStream(hook393(subs393(), "turn.step")(
    mT.$,
    { agentId: "ag-z9s-b1", turnId: "t-z9", index: 0, model: "m-z9" },
    () => (async function* () { return stepped })(),
  ))
  expect(outT.value, "turn.step отдаёт результат next").toEqual(stepped)
  expect(lostN393("failover-step-world")).toBeGreaterThanOrEqual(1)
  failoverBindReset()
})

test("#489-B1 Z10 chunkCarriesContent: отказ Object.keys — выдача и сайт turn-step-chunk-keys", () => {
  const before = lostN393("turn-step-chunk-keys")
  const got = chunkCarriesContent(new Proxy({}, { ownKeys() { throw new Error("keys") } }))
  expect(got).toBe(true)
  expect(lostN393("turn-step-chunk-keys") - before).toBeGreaterThanOrEqual(1)
})

test("#448-B1 Z11 worldFor: нечитаемая ручка из девяти названа env-unreadable:<имя>", async () => {
  await drainFold393()
  const nine = [
    "CLAUDE_JUDGE_MODEL", "CLAUDE_JUDGE_PROMPT", "CLAUDE_JUDGE_TIMEOUT_MS",
    "CLAUDE_PROMPTS", "CLAUDE_PROBES_DIR", "CLAUDE_CONFIG_DIR",
    "HOME", "PWD", "CATALYST_ROUTING_TABLE",
  ]
  const m = mod$393({
    env: { PWD: "/work-z11-b1" },
    now: 200_160_000,
    envRefuses: nine.slice(),
  })
  await worldFor(m.$)
  for (let i = 0; i < nine.length; i++) {
    expect(lostN393("env-unreadable:" + nine[i]), nine[i]).toBeGreaterThanOrEqual(1)
  }
})

test("#448-B1 Z12 applyPromptRules: нечитаемый CLAUDE_PROMPTS не применяет правило", async () => {
  await drainFold393()
  const toml = '[prompt.z12]\ntool = "Read"\ntext = "RULE-Z12"\n'
  const refused = mod$393({
    files: { "/probes-z12a-b1/probes.toml": toml },
    env: { CLAUDE_PROBES_DIR: "/probes-z12a-b1", PWD: "/work-z12a-b1", CLAUDE_PROMPTS: "1" },
    now: 200_170_000,
    envRefuses: ["CLAUDE_PROMPTS"],
  })
  const hidden = await hook393(subs393(), "tool.describe")(
    refused.$, { tool: "Read", description: "Base" }, async (e: any) => e,
  )
  expect(String(hidden.description), "нечитаемый выключатель не включает правила").toBe("Base")
  const open = mod$393({
    files: { "/probes-z12b-b1/probes.toml": toml },
    env: { CLAUDE_PROBES_DIR: "/probes-z12b-b1", PWD: "/work-z12b-b1", CLAUDE_PROMPTS: "1" },
    now: 200_180_000,
  })
  const shown = await hook393(subs393(), "tool.describe")(
    open.$, { tool: "Read", description: "Base" }, async (e: any) => e,
  )
  expect(String(shown.description), "без отказа правило применяется").toContain("RULE-Z12")
})

test("#448-B1 Z13 envSelected: нечитаемый when_env не выбирает правило", async () => {
  await drainFold393()
  const m = mod$393({
    files: {
      "/probes-z13-b1/probes.toml":
        '[prompt.z13]\ntool = "Read"\ntext = "RULE-Z13"\nwhen_env = "CLAUDE_FORM"\n',
    },
    env: { CLAUDE_PROBES_DIR: "/probes-z13-b1", PWD: "/work-z13-b1", CLAUDE_FORM: "1", CLAUDE_PROMPTS: "1" },
    now: 200_190_000,
    envRefuses: ["CLAUDE_FORM"],
  })
  const out = await hook393(subs393(), "tool.describe")(
    m.$, { tool: "Read", description: "Base" }, async (e: any) => e,
  )
  expect(String(out.description), "нечитаемое имя when_env не выбирает правило").toBe("Base")
})

test("#455-B1 Z14 idle-watch: enforce=false не тостит и пишет block_not_enforced", async () => {
  await drainFold393()
  const home = "/probes-z14-b1"
  const m = mod$393({
    files: { [home + "/probes.toml"]: '[probe.idle-watch]\nact = "nudge"\nenforce = false\nwindow_min = 0\n' },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-z14-b1", CLAUDE_IDLE: "1" },
    now: 200_200_000,
    answers: ["NUDGE: x"],
  })
  await hook393(subs393(), "tool.call")(m.$, { tool: "Read" }, async (e: any) => e)
  await settle393()
  expect(m.toasts.length, "ручка enforce выключена — тоста нет").toBe(0)
  const lines = shards393(m.writes, "/idle-watch/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.outcome === "block_not_enforced")).toBe(true)
})

// CONSTRAINT (#531 Р6): тост -- дополнительный канал: он пишется полем toast,
// метку nudge_delivered ставит только доставка очереди (context/submit).
test("#455-B1 Z15 idle-watch: без enforce тост один и исход не block_not_enforced", async () => {
  await drainFold393()
  const home = "/probes-z15-b1"
  const m = mod$393({
    files: { [home + "/probes.toml"]: '[probe.idle-watch]\nact = "nudge"\nwindow_min = 0\n' },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-z15-b1", CLAUDE_IDLE: "1" },
    now: 200_210_000,
    answers: ["NUDGE: x"],
  })
  await hook393(subs393(), "tool.call")(m.$, { tool: "Read" }, async (e: any) => e)
  await settle393()
  expect(m.toasts.length, "дефолт nudge даёт ровно один тост").toBe(1)
  expect(String(m.toasts[0])).toContain("x")
  const lines = shards393(m.writes, "/idle-watch/journal.jsonl.shard.")
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.some((r: any) => r.toast === true && r.outcome !== "block_not_enforced"), "тост -- полем toast").toBe(true)
  expect(lines.some((r: any) => r.outcome === "nudge_delivered"), "один тост доставкой не метится").toBe(false)
  const recs = m.writes
    .filter(w => w.path.indexOf("/idle-watch/records/") >= 0)
    .map(w => JSON.parse(String(w.text)))
  expect(recs.some((r: any) => r.toast === true && r.queued === true), "улика: тост и постановка в очередь").toBe(true)
  await clear393()
})

test("#455-B1 Z16 idle-watch: отказ тоста при enforce — toast false и toastErr", async () => {
  await drainFold393()
  const home = "/probes-z16-b1"
  const m = mod$393({
    files: { [home + "/probes.toml"]: '[probe.idle-watch]\nact = "nudge"\nwindow_min = 0\n' },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-z16-b1", CLAUDE_IDLE: "1" },
    now: 200_220_000,
    answers: ["NUDGE: x"],
    fail: { toast: true },
  })
  await hook393(subs393(), "tool.call")(m.$, { tool: "Read" }, async (e: any) => e)
  await settle393()
  const lines = shards393(m.writes, "/idle-watch/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.toast === false)).toBe(true)
  const recs = m.writes
    .filter(w => w.path.indexOf("/idle-watch/records/") >= 0)
    .map(w => JSON.parse(String(w.text)))
  expect(recs.some((r: any) => String(r.toastErr || "").indexOf("scripted toast refusal") >= 0)).toBe(true)
  await clear393()
})

test("#455-B1 Z17 generic cancel: enforce=false не отменяет диспатч, без ручки — отменяет", async () => {
  await drainFold393()
  const off = mod$393({
    files: {
      "/probes-z17a-b1/probes.toml":
        '[probe.z17a]\nkind = "consult"\nact = "cancel"\nenforce = false\non = ["PreToolUse"]\n[probe.z17a.when]\nfield = "tool_name"\nequals = "Read"\n',
    },
    env: { CLAUDE_PROBES_DIR: "/probes-z17a-b1", PWD: "/work-z17a-b1", CLAUDE_PROBES: "1" },
    now: 200_230_000,
    answers: ["BLOCK: z17a"],
  })
  const outOff = await hook393(subs393(), "tool.call")(
    off.$, { tool: "Read", prompt: "z17a" }, async () => ({ ran: true }),
  )
  expect(outOff.deny, "enforce=false свёрнутый вердикт не отменяет").toBe(undefined)
  expect(outOff.ran).toBe(true)

  const on = mod$393({
    files: {
      "/probes-z17b-b1/probes.toml":
        '[probe.z17b]\nkind = "consult"\nact = "cancel"\non = ["PreToolUse"]\n[probe.z17b.when]\nfield = "tool_name"\nequals = "Read"\n',
    },
    env: { CLAUDE_PROBES_DIR: "/probes-z17b-b1", PWD: "/work-z17b-b1", CLAUDE_PROBES: "1" },
    now: 200_240_000,
    answers: ["BLOCK: z17b"],
  })
  const outOn = await hook393(subs393(), "tool.call")(
    on.$, { tool: "Read", prompt: "z17b" }, async () => ({ ran: true }),
  )
  expect(String(outOn.deny || ""), "без ручки свёрнутый вердикт отменяет диспатч").toContain("cancelled")
})

function poisonSelf393(): any {
  const p: any = { toString() { throw p } }
  return p
}

test("#489-B1-FIX1 W1 chunkCarriesContent: яд toString не обрывает, сайт записан", async () => {
  await drainFold393()
  const before = lostN393("turn-step-chunk-keys")
  let thrown = ""
  let got = false
  try {
    got = chunkCarriesContent(new Proxy({}, { ownKeys() { throw poisonSelf393() } }))
  } catch (x) { thrown = String(x) }
  expect(thrown, "носитель отказа не обрывает вызывающего").toBe("")
  expect(got).toBe(true)
  expect(lostN393("turn-step-chunk-keys") - before).toBeGreaterThanOrEqual(1)
  expect(registerModule393.lostWritesSnapshot()["turn-step-chunk-keys"].last).toBe("unprintable error")
})

test("#489-B1-FIX1 W2 tool.describe: тот же яд через worldFor не обрывает хук", async () => {
  await drainFold393()
  const m = mod$393({
    env: { PWD: "/work-w2-b1", HOME: "/hh-w2-b1" },
    now: 210_010_000,
  })
  const orig = m.$.env.get
  m.$.env.get = async (k: string) => {
    if (k === "HOME") return poisonSelf393()
    return orig(k)
  }
  let thrown = ""
  let out: any = null
  try {
    out = await hook393(subs393(), "tool.describe")(
      m.$, { tool: "Read", description: "D" }, async () => ({ via: "next-w2" }),
    )
  } catch (x) { thrown = String(x) }
  expect(thrown, "хук не бросает").toBe("")
  expect(out).toEqual({ via: "next-w2" })
  expect(lostN393("tool-describe-world")).toBeGreaterThanOrEqual(1)
  expect(registerModule393.lostWritesSnapshot()["tool-describe-world"].last).toBe("unprintable error")
})

test("#489-B1-FIX1 W3 ruleText: отказ чтения пустой строкой — unreadable и без мемо", async () => {
  await drainFold393()
  const home = "/probes-w3-b1"
  const rule = "/w3-b1/rule.txt"
  const files: Record<string, string> = {
    [home + "/probes.toml"]: '[prompt.w3]\ntool = "Read"\ntext_file = "' + rule + '"\n',
  }
  let empty = true
  const m = mod$393({
    files,
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-w3-b1", CLAUDE_PROMPTS: "1" },
    now: 210_020_000,
  })
  const orig = m.$.fs.read
  m.$.fs.read = async (p: string) => {
    if (empty && p === rule) throw ""
    return orig(p)
  }
  const hook = hook393(subs393(), "tool.describe")
  const before = lostN393("prompt-rule-text")
  const first = await hook(m.$, { tool: "Read", description: "Base" }, async (e: any) => e)
  expect(String(first.description)).toBe("Base")
  expect(lostN393("prompt-rule-text") - before, "пустой отказ — не отсутствие файла").toBeGreaterThanOrEqual(1)
  expect(registerModule393.lostWritesSnapshot()["prompt-rule-text"].last).toBe(rule + ": (empty error)")
  empty = false
  files[rule] = "RULE-W3"
  const second = await hook(m.$, { tool: "Read", description: "Base" }, async (e: any) => e)
  expect(String(second.description), "пустой отказ не заморожен").toContain("RULE-W3")
})

test("#489-B1-FIX1 W4 read: code ENOENT без текста — файл отсутствует", async () => {
  await drainFold393()
  const home = "/probes-w4-b1"
  const rule = "/w4-b1/rule.txt"
  const files: Record<string, string> = {
    [home + "/probes.toml"]: '[prompt.w4]\ntool = "Read"\ntext_file = "' + rule + '"\n',
  }
  let armed = true
  const m = mod$393({
    files,
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-w4-b1", CLAUDE_PROMPTS: "1" },
    now: 210_030_000,
  })
  const orig = m.$.fs.read
  m.$.fs.read = async (p: string) => {
    if (armed && p === rule) throw { code: "ENOENT" }
    return orig(p)
  }
  const hook = hook393(subs393(), "tool.describe")
  const before = lostN393("prompt-rule-text")
  const first = await hook(m.$, { tool: "Read", description: "Base" }, async (e: any) => e)
  expect(String(first.description)).toBe("Base")
  expect(lostN393("prompt-rule-text") - before, "ENOENT по code — не unreadable").toBe(0)
  armed = false
  files[rule] = "RULE-W4"
  const second = await hook(m.$, { tool: "Read", description: "Base" }, async (e: any) => e)
  expect(String(second.description), "отсутствие заморожено пустой строкой").toBe("Base")
})

test("#448-B1-FIX1 W5 allowedSrc: нечитаемый CATALYST_ROUTING_TABLE как env — env:unreadable", async () => {
  await drainFold393()
  const m = mod$393({ now: 210_040_000 })
  const unread = await loadAllowedByClass(m.$, {
    ROUTING_TABLE: "", CONFIG_DIR: "/cfg-w5-b1", HOME: "", PWD: "/work-w5-b1",
    UNREADABLE: ["CATALYST_ROUTING_TABLE"],
  }, "/work-w5-b1")
  expect(String(unread.allowedSrc)).toContain("env:unreadable")
  const empty = await loadAllowedByClass(m.$, {
    ROUTING_TABLE: "", CONFIG_DIR: "/cfg-w5-b1", HOME: "", PWD: "/work-w5-b1",
    UNREADABLE: [],
  }, "/work-w5-b1")
  expect(String(empty.allowedSrc).indexOf("env:unreadable") < 0, "пустое и нечитаемое не делят мемо").toBe(true)
  expect(String(empty.allowedSrc)).toContain("absent:")
})

test("#455-B1-FIX1 W6 nudge: тост отвергнут пустой строкой — toast false", async () => {
  await drainFold393()
  const home = "/probes-w6-b1"
  const m = mod$393({
    files: { [home + "/probes.toml"]: '[probe.idle-watch]\nact = "nudge"\nwindow_min = 0\n' },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-w6-b1", CLAUDE_IDLE: "1" },
    now: 210_050_000,
    answers: ["NUDGE: x"],
  })
  m.$.ui.toast = async () => { throw "" }
  await hook393(subs393(), "tool.call")(m.$, { tool: "Read" }, async (e: any) => e)
  await settle393()
  const lines = shards393(m.writes, "/idle-watch/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.toast === false)).toBe(true)
  const recs = m.writes
    .filter(w => w.path.indexOf("/idle-watch/records/") >= 0)
    .map(w => JSON.parse(String(w.text)))
  expect(recs.some((r: any) => r.toastErr === "(empty error)")).toBe(true)
  expect(recs.some((r: any) => r.toast === false), "улика -- toast false").toBe(true)
  await clear393()
})

test("#455-B1-FIX1 W7 memo: threw пустой строкой присутствует в улике", async () => {
  await clear393()
  await drainFold393()
  const home = "/probes-w7-b1"
  const sid = "sid-w7-b1"
  const prompt = "w7-prompt"
  const key = verdictKey("w7p", sid, "Read", "", prompt)
  const m = mod$393({
    files: {
      [home + "/probes.toml"]:
        '[probe.w7p]\nkind = "consult"\nact = "cancel"\non = ["PreToolUse"]\n[probe.w7p.when]\nfield = "tool_name"\nequals = "Read"\n',
    },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-w7-b1", CLAUDE_PROBES: "1" },
    now: 210_060_000,
    sid,
    stored: { [key]: { kind: "BLOCK", rest: "w7", t: 210_060_000, threw: "" } },
  })
  await hook393(subs393(), "tool.call")(
    m.$, { tool: "Read", prompt }, async () => ({ ran: true }),
  )
  const recs = m.writes
    .filter(w => w.path.indexOf("/w7p/records/") >= 0)
    .map(w => JSON.parse(String(w.text)))
  expect(recs.length).toBeGreaterThan(0)
  expect(Object.prototype.hasOwnProperty.call(recs[0], "threw"), "пустое threw присутствует").toBe(true)
  expect(recs[0].threw).toBe("")
})

test("#489-B1-FIX1 W9 form: нечитаемый post — F с EIO, путь и откат", async () => {
  await drainFold393()
  const formZ8 = FORM_CFG_335
    .replace('write_target = "zzz-write-redirect"', () => String.raw`write_target = '\.md$'`)
    .replace('heredoc = "zzz-heredoc"', "heredoc = \"(<<'EOF'\\n)([\\s\\S]*?)(\\nEOF)\"")
  const home = "/probes-w9-b1"
  const fp = "/w9-b1/report.md"
  const m = mod$393({
    files: { [home + "/probes.toml"]: formZ8 + '\n[probe.form.act]\nF = "cancel"\n', [fp]: "old" },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-w9-b1", CLAUDE_FORM: "1" },
    now: 210_070_000,
    fail: { fsReadErr: [fp] },
  })
  const cmd = "cat >> " + fp + " <<'EOF'\nzzz-legalize\nEOF"
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Bash", command: cmd }, formNext393(m, { [fp]: "zzz-legalize\n" }, "Darwin"))
  const lines = shards393(m.writes, "/form/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.outcome === "refuse" && r.cls.includes("F")), "W9 unreadable post is F").toBe(true)
  expect(lines.filter((r: any) => r.outcome === "error" && r.verdict === "rollback failed: " + fp).length, "W9 rollback failure journaled").toBe(1)
  const recs = formRecordsFinal393(m)
  const refusal = recs.flatMap(r => r.refuse || []).find(r => r.c === "F" && String(r.q).includes("target unreadable after write"))
  expect(!!refusal, "W9 named unreadable refusal").toBe(true)
  expect(refusal.n).toBe(0)
  expect(String(refusal.q), "W9 EIO retained").toContain("EIO")
  expect(String(refusal.src), "W9 path retained").toContain(fp)
  expect(typeof out.deny, "W9 F cancel denies").toBe("string")
  expect(m.files[fp], "W9 bytes restored").toBe("old")
  expect(lostN393("form-path-read") + lines.filter((r: any) => r.lost && r.lost["form-path-read"]).length, "W9 loss named").toBeGreaterThanOrEqual(1)
})

function formRecordsFinal393(m: any): any[] {
  return Object.entries(m.files).filter(([path]) => path.includes('/form/records/')).map(([, text]) => JSON.parse(String(text)))
}
function formNext393(m: any, post: Record<string, string>, platform = "Linux"): (e: any) => Promise<any> {
  const files = m.files
  m.$.fs.list = async (dir: string) => {
    const prefix = dir.replace(/\/$/, "") + "/"
    if (!Object.keys(files).some(p => p.startsWith(prefix))) throw new Error("ENOENT " + dir)
    return Object.keys(files).filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes("/")).map(p => ({ name: p.slice(prefix.length), kind: "file" }))
  }
  ioFix2_510({ state: {}, platform }).setup(m, files, [], () => false)
  return async (e: any) => { Object.assign(files, post); return e }
}

function formRedirect393(): string {
  return FORM_CFG_335
    .replace('write_target = "zzz-write-redirect"', () => String.raw`write_target = '\.md$'`)
    .replace('heredoc = "zzz-heredoc"', "heredoc = \"(<<'EOF'\\n)([\\s\\S]*?)(\\nEOF)\"")
}

function formCombat393(): string {
  const hd = String.raw`<<-?\s*["']?(\w+)["']?[^\n]*\n([\s\S]*?)\n\1(?:\n|$)`
  return formRedirect393().replace(/heredoc = "[\s\S]*"/, 'heredoc = "' + hd + '"')
}

test("#489-B1-FIX2 V1 memo key: путь env-unreadable не делит мемо с нечитаемой ручкой", async () => {
  await clear393()
  const cfg = "/cfg-v1-fix2"
  const market = cfg + "/plugins/marketplaces/catalyst/hooks/routing-table.toml"
  const filePath = "env-unreadable"
  const m = mod$393({
    now: 220_000_000,
    files: {
      [market]: '[classes.m-market]\nallowed = ["from-market"]\n',
      [filePath]: '[classes.m-file]\nallowed = ["from-file"]\n',
    },
  })
  const envBase = { CONFIG_DIR: cfg, HOME: "", PWD: "/work-v1-fix2" }
  const first = await loadAllowedByClass(m.$, {
    ...envBase, ROUTING_TABLE: "", UNREADABLE: ["CATALYST_ROUTING_TABLE"],
  }, "/work-v1-fix2")
  expect(first.allowedByClass["m-market"]).toStrictEqual(["from-market"])
  const second = await loadAllowedByClass(m.$, {
    ...envBase, ROUTING_TABLE: filePath, UNREADABLE: [],
  }, "/work-v1-fix2")
  expect(second.allowedByClass["m-file"], "второй вызов читает файл, а не мемо нечитаемой ручки").toStrictEqual(["from-file"])
  let tableReads = 0
  const origRead = m.$.fs.read
  m.$.fs.read = async (p: string) => {
    if (p === filePath) tableReads++
    return origRead(p)
  }
  const third = await loadAllowedByClass(m.$, {
    ...envBase, ROUTING_TABLE: filePath, UNREADABLE: [],
  }, "/work-v1-fix2")
  expect(third.allowedByClass["m-file"]).toStrictEqual(["from-file"])
  expect(tableReads, "третий вызов внутри окна мемо не читает таблицу").toBe(0)
})

test("#489-B1-FIX2 V2a form: два >> — нечитаемый, затем читаемый с zzz-legalize", async () => {
  await drainFold393()
  const home = "/probes-v2a-fix2"
  const a = "/v2a-fix2/a/report.md"
  const b = "/v2a-fix2/b/report.md"
  const m = mod$393({
    files: {
      [home + "/probes.toml"]: formRedirect393() + '\n[probe.form.act]\nF = "cancel"\nC1 = "cancel"\n',
      [a]: "old",
      [b]: "kept\n",
    },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-v2a-fix2", CLAUDE_FORM: "1" },
    now: 220_010_000,
    fail: { fsReadErr: [a] },
  })
  const cmd = "cat >> " + a + "\ncat >> " + b + " <<'EOF'\nzzz-legalize\nEOF"
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Bash", command: cmd }, formNext393(m, { [a]: "", [b]: "kept\nzzz-legalize\n" }, "Darwin"))
  const lines = shards393(m.writes, "/form/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.outcome === "refuse" && r.cls.includes("C1") && r.cls.includes("F")), "V2a body and unreadable classes coexist").toBe(true)
  expect(typeof out.deny, "V2a denies").toBe("string")
  expect(m.files[a], "V2a unreadable restored").toBe("old")
  expect(m.files[b], "V2a body restored").toBe("kept\n")
})

test("#489-B1-FIX2 V2b form: два >> — читаемый с zzz-legalize, затем нечитаемый", async () => {
  await drainFold393()
  const home = "/probes-v2b-fix2"
  const a = "/v2b-fix2/a/report.md"
  const b = "/v2b-fix2/b/report.md"
  const m = mod$393({
    files: {
      [home + "/probes.toml"]: formRedirect393() + '\n[probe.form.act]\nF = "cancel"\nC1 = "cancel"\n',
      [a]: "old",
      [b]: "kept\n",
    },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-v2b-fix2", CLAUDE_FORM: "1" },
    now: 220_020_000,
    fail: { fsReadErr: [a] },
  })
  const cmd = "cat >> " + b + " <<'EOF'\nzzz-legalize\nEOF\ncat >> " + a
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Bash", command: cmd }, formNext393(m, { [a]: "", [b]: "kept\nzzz-legalize\n" }, "Darwin"))
  const lines = shards393(m.writes, "/form/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.outcome === "refuse" && r.cls.includes("C1") && r.cls.includes("F")), "V2b body and unreadable classes coexist").toBe(true)
  expect(typeof out.deny, "V2b denies").toBe("string")
  expect(m.files[a], "V2b unreadable restored").toBe("old")
  expect(m.files[b], "V2b body restored").toBe("kept\n")
})

test("#489-B1-FIX2 V2c form: одна цель, heredoc до redirect — тело судится", async () => {
  await drainFold393()
  const home = "/probes-v2c-fix2"
  const f = "/v2c-fix2/r/report.md"
  const m = mod$393({
    files: { [home + "/probes.toml"]: formCombat393() },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-v2c-fix2", CLAUDE_FORM: "1" },
    now: 220_030_000,
  })
  const cmd = "cat <<'EOF' >> " + f + "\nzzz-legalize\nEOF"
  await hook393(subs393(), "tool.call")(m.$, { tool: "Bash", command: cmd }, formNext393(m, { [f]: "zzz-legalize\n" }))
  const lines = shards393(m.writes, "/form/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.outcome === "refuse"), "буквальная форма <<'EOF' >> file держит тело").toBe(true)
})

test("#489-B1-FIX2 V3 safeText: точные тексты через last noteLost", () => {
  const lastOf = (x: any): string => {
    chunkCarriesContent(new Proxy({}, { ownKeys() { throw x } }))
    return String(registerModule393.lostWritesSnapshot()["turn-step-chunk-keys"].last)
  }
  expect(lastOf(new Error("m")), "вход 1 Error").toBe("m")
  expect(lastOf(new TypeError("m")), "вход 2 TypeError").toBe("TypeError: m")
  expect(lastOf({ name: "TypeError", message: "m" }), "вход 3 имя без String").toBe("TypeError: m")
  expect(lastOf({ message: "hello", get name() { throw 1 } }), "вход 4 бросок name").toBe("hello")
  expect(lastOf({ name: "Error", message: "m", toString() { throw 0 } }), "вход 5 бросок toString").toBe("m")
  const boom: any = { toString() { throw 1 } }
  Object.defineProperty(boom, "message", { get() { throw 1 } })
  Object.defineProperty(boom, "name", { get() { throw 1 } })
  expect(lastOf(boom), "вход 6 всё бросает").toBe("unprintable error")
  expect(lastOf(""), "вход 7 пустая строка").toBe("(empty error)")
  expect(lastOf(null), "вход 8 null").toBe("null")
  expect(lastOf({ name: "Foo" }), "вход Foo").toBe("Foo")
  expect(lastOf({ name: "Foo", message: "", toString() { return "" } }), "вход Foo пустой").toBe("Foo")
  expect(lastOf({ name: "X", message: "m", toString() { return "m extra" } }), "вход full содержит msg").toBe("m extra")
  expect(lastOf({ name: "Foo", message: "", toString() { return "[object Foo]" } }), "F7 ярлык Foo").toBe("Foo")
  expect(lastOf({ name: "Error", message: "", toString() { return "[object Object]" } }), "F7 Error без текста").toBe("Error")
})

test("#455-B1-FIX2 V4 fail-closed: бросок строки boom назван в deny", async () => {
  const h = failClosedHandler391()
  expect(typeof h).toBe("function")
  const out = await h({}, { tool: "Write" }, { called: false, error: "boom" })
  expect(String(out && out.deny), "причина строки в deny").toContain("(boom)")
})

test("#489-B1-FIX2 V5 turn.step: бросающий kind не обрывает поток", async () => {
  await drainFold393()
  failoverBindReset()
  failoverBindSet("ag-v5-fix2", { ladder: ["m-v5"], rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const m = mod$393({
    files: { "/probes-v5-fix2/probes.toml": "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: "/probes-v5-fix2", PWD: "/work-v5-fix2" },
    now: 220_040_000,
  })
  const chunk: any = {}
  Object.defineProperty(chunk, "kind", { get() { throw new Error("kind-poison") }, enumerable: true })
  const before = lostN393("turn-step-chunk-kind")
  let thrown = ""
  let out: any = null
  try {
    out = await drainStream(hook393(subs393(), "turn.step")(
      m.$,
      { agentId: "ag-v5-fix2", turnId: "t-v5", index: 0, model: "m-v5" },
      () => (async function* () { yield chunk; return "V5-OK" })(),
    ))
  } catch (x) { thrown = String(x) }
  expect(thrown, "поток не оборван").toBe("")
  expect(out && out.value).toBe("V5-OK")
  expect(out && out.chunks.length).toBe(1)
  const carried = shards393(m.writes, "/failover/journal.jsonl.shard.")
    .reduce((n: number, r: any) => n + (r.lost && r.lost["turn-step-chunk-kind"] ? r.lost["turn-step-chunk-kind"].n : 0), 0)
  expect(lostN393("turn-step-chunk-kind") - before + carried, "сайт turn-step-chunk-kind").toBeGreaterThanOrEqual(1)
  const kindRows = shards393(m.writes, "/failover/journal.jsonl.shard.")
    .filter((r: any) => r.lost && r.lost["turn-step-chunk-kind"])
  expect(kindRows.some((r: any) => r.lost["turn-step-chunk-kind"].n === 1), "n ровно 1").toBe(true)
  expect(kindRows.some((r: any) => Array.isArray(r.emittedKinds) && r.emittedKinds.indexOf("?unprintable") >= 0), "вид ?unprintable").toBe(true)
  failoverBindReset()
})

test("#455-B1-FIX2 Y6a memo: отказ журнала — вторая улика несёт threw", async () => {
  await clear393()
  await drainFold393()
  const home = "/probes-y6a-fix2"
  const sid = "sid-y6a-fix2"
  const prompt = "y6a-prompt"
  const key = verdictKey("y6a", sid, "Read", "", prompt)
  const m = mod$393({
    files: {
      [home + "/probes.toml"]:
        '[probe.y6a]\nkind = "consult"\nact = "cancel"\non = ["PreToolUse"]\n[probe.y6a.when]\nfield = "tool_name"\nequals = "Read"\n',
    },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-y6a-fix2", CLAUDE_PROBES: "1" },
    now: 220_050_000,
    sid,
    stored: { [key]: { kind: "BLOCK", rest: "y6a", t: 220_050_000, threw: "y6a-threw" } },
    fail: { fsWrite: (p: string) => p.indexOf("/journal.jsonl") >= 0 },
  })
  await hook393(subs393(), "tool.call")(m.$, { tool: "Read", prompt }, async () => ({ ran: true }))
  const recs = m.writes
    .filter(w => w.path.indexOf("/y6a/records/") >= 0)
    .map(w => JSON.parse(String(w.text)))
  const second = recs.filter((r: any) => Object.prototype.hasOwnProperty.call(r, "journalErr"))
  expect(second.length, "вторая запись после отказа журнала").toBeGreaterThan(0)
  expect(second[0].threw).toBe("y6a-threw")
})

test("#489-B1-FIX2 Y6b Edit: нечитаемая цель — warn target-unreadable", async () => {
  await drainFold393()
  const home = "/probes-y6be-fix2"
  const fp = "/y6be-fix2/report.md"
  const m = mod$393({
    files: { [home + "/probes.toml"]: formRedirect393() },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-y6be-fix2", CLAUDE_FORM: "1" },
    now: 220_060_000,
    fail: { fsReadErr: [fp] },
  })
  await hook393(subs393(), "tool.call")(m.$, {
    tool: "Edit", file_path: fp, old_string: "a", new_string: "b",
  }, async (e: any) => e)
  const lines = shards393(m.writes, "/form/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.outcome === "warn" && Array.isArray(r.cls) && r.cls.indexOf("target-unreadable") >= 0)).toBe(true)
  const named = lostN393("form-path-read") + lines.filter((r: any) => r.lost && r.lost["form-path-read"]).length
  expect(named, "Edit: сайт form-path-read посчитан").toBeGreaterThanOrEqual(1)
})

test("#489-B1-FIX2 Y6b Agent: нечитаемый brief_ref — warn target-unreadable", async () => {
  await drainFold393()
  const home = "/probes-y6ba-fix2"
  const fp = "/y6ba-fix2/report.md"
  const cfg = formRedirect393().replace('brief_ref = "zzz-brief-ref"', 'brief_ref = "/y6ba-fix2/report[.]md"')
  const m = mod$393({
    files: { [home + "/probes.toml"]: cfg },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-y6ba-fix2", CLAUDE_FORM: "1" },
    now: 220_070_000,
    fail: { fsReadErr: [fp] },
  })
  await hook393(subs393(), "tool.call")(m.$, {
    tool: "Agent", prompt: "see " + fp, subagent_type: "scout",
  }, async (e: any) => e)
  const lines = shards393(m.writes, "/form/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.outcome === "warn" && Array.isArray(r.cls) && r.cls.indexOf("target-unreadable") >= 0)).toBe(true)
  const named = lostN393("form-path-read") + lines.filter((r: any) => r.lost && r.lost["form-path-read"]).length
  expect(named, "Agent: сайт form-path-read посчитан").toBeGreaterThanOrEqual(1)
})

test("#455-B1-FIX2 Y6c memo: BLOCK при enforce=false не отменяет диспатч", async () => {
  await clear393()
  await drainFold393()
  const home = "/probes-y6c-fix2"
  const sid = "sid-y6c-fix2"
  const prompt = "y6c-prompt"
  const key = verdictKey("y6c", sid, "Read", "", prompt)
  const m = mod$393({
    files: {
      [home + "/probes.toml"]:
        '[probe.y6c]\nkind = "consult"\nact = "cancel"\nenforce = false\non = ["PreToolUse"]\n[probe.y6c.when]\nfield = "tool_name"\nequals = "Read"\n',
    },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-y6c-fix2", CLAUDE_PROBES: "1" },
    now: 220_080_000,
    sid,
    stored: { [key]: { kind: "BLOCK", rest: "y6c", t: 220_080_000 } },
    answers: ["BLOCK: y6c-live"],
  })
  let judgeCalls = 0
  const origComplete = m.$.model.complete
  m.$.model.complete = async (arg: any) => { judgeCalls++; return origComplete(arg) }
  const out = await hook393(subs393(), "tool.call")(
    m.$, { tool: "Read", prompt }, async () => ({ ran: true }),
  )
  expect(out.deny, "мемо BLOCK при enforce=false не отменяет").toBe(undefined)
  expect(out.ran).toBe(true)
  expect(judgeCalls, "мемо-ветка: судья не вызван").toBe(0)
  const recs = m.writes
    .filter(w => w.path.indexOf("/y6c/records/") >= 0)
    .map(w => JSON.parse(String(w.text)))
  expect(recs.some((r: any) => r.memo === true), "улика мемо").toBe(true)
})

test("#455-B1-FIX2 Y6d nudge: тост бросает undefined — toast false, toastErr undefined", async () => {
  await drainFold393()
  const home = "/probes-y6d-fix2"
  const m = mod$393({
    files: { [home + "/probes.toml"]: '[probe.idle-watch]\nact = "nudge"\nwindow_min = 0\n' },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-y6d-fix2", CLAUDE_IDLE: "1" },
    now: 220_090_000,
    answers: ["NUDGE: x"],
  })
  m.$.ui.toast = async () => { throw undefined }
  await hook393(subs393(), "tool.call")(m.$, { tool: "Read" }, async (e: any) => e)
  await settle393()
  const lines = shards393(m.writes, "/idle-watch/journal.jsonl.shard.")
  expect(lines.some((r: any) => r.toast === false)).toBe(true)
  const recs = m.writes
    .filter(w => w.path.indexOf("/idle-watch/records/") >= 0)
    .map(w => JSON.parse(String(w.text)))
  expect(recs.some((r: any) => r.toastErr === "undefined")).toBe(true)
  expect(recs.some((r: any) => r.toast === false), "улика -- toast false").toBe(true)
  await clear393()
})

test("#489-B1-FIX2 Y6e read: бросающий code не рвёт чтение, unreadable EIO", async () => {
  await drainFold393()
  const home = "/probes-y6e-fix2"
  const rule = "/y6e-fix2/rule.txt"
  const m = mod$393({
    files: { [home + "/probes.toml"]: '[prompt.y6e]\ntool = "Read"\ntext_file = "' + rule + '"\n' },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-y6e-fix2", CLAUDE_PROMPTS: "1" },
    now: 220_100_000,
  })
  const orig = m.$.fs.read
  m.$.fs.read = async (p: string) => {
    if (p === rule) {
      const err: any = { message: "EIO" }
      Object.defineProperty(err, "code", { get() { throw 1 } })
      throw err
    }
    return orig(p)
  }
  let thrown = ""
  try {
    await hook393(subs393(), "tool.describe")(m.$, { tool: "Read", description: "Base" }, async (e: any) => e)
  } catch (x) { thrown = String(x) }
  expect(thrown, "чтение не рвётся").toBe("")
  expect(registerModule393.lostWritesSnapshot()["prompt-rule-text"].last).toBe(rule + ": EIO")
})

function formLines393(writes: { path: string; text: string }[]): any[] {
  return shards393(writes, "/form/journal.jsonl.shard.")
}

test("#489-B1-FIX3 F1 form: второе тело не прячется за первым", async () => {
  await drainFold393()
  const home = "/probes-f1-fix3"
  const a = "/f1-fix3/a/log.txt"
  const b = "/f1-fix3/b/report.md"
  const m = mod$393({
    files: {
      [home + "/probes.toml"]: formRedirect393(),
      [a]: "log\n",
      [b]: "kept\n",
    },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-f1-fix3", CLAUDE_FORM: "1" },
    now: 230_000_000,
  })
  const cmd = "cat >> " + a + " <<'EOF'\nordinary\nEOF\ncat >> " + b + " <<'EOF'\nzzz-legalize\nEOF"
  await hook393(subs393(), "tool.call")(m.$, { tool: "Bash", command: cmd }, formNext393(m, { [a]: "log\nordinary\n", [b]: "kept\nzzz-legalize\n" }))
  const recs = formRecordsFinal393(m)
  expect(formLines393(m.writes).some((r: any) => r.outcome === "refuse")).toBe(true)
  expect(recs.some((r: any) => (r.refuse || []).some((x: any) => x.c === "C1" && String(x.src).indexOf(b) >= 0)), "C1 по b/report.md").toBe(true)
})

test("#489-B1-FIX3 F2 form: третье тело, tee и повтор пути (D7c)", async () => {
  await drainFold393()
  const home = "/probes-f2a-fix3"
  const c = "/f2a-fix3/c/report.md"
  const m = mod$393({
    files: {
      [home + "/probes.toml"]: formRedirect393(),
      ["/f2a-fix3/a/log.txt"]: "a\n",
      ["/f2a-fix3/b/log.txt"]: "b\n",
      [c]: "c\n",
    },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-f2a-fix3", CLAUDE_FORM: "1" },
    now: 230_010_000,
  })
  const cmd = "cat >> /f2a-fix3/a/log.txt <<'EOF'\nA\nEOF\ncat >> /f2a-fix3/b/log.txt <<'EOF'\nB\nEOF\ncat >> " + c + " <<'EOF'\nzzz-legalize\nEOF"
  await hook393(subs393(), "tool.call")(m.$, { tool: "Bash", command: cmd }, formNext393(m, { "/f2a-fix3/a/log.txt": "a\nA\n", "/f2a-fix3/b/log.txt": "b\nB\n", [c]: "c\nzzz-legalize\n" }))
  expect(formLines393(m.writes).some((r: any) => r.outcome === "refuse"), "тело C судится").toBe(true)

  await drainFold393()
  const homeT = "/probes-f2t-fix3"
  const rep = "/f2t-fix3/r/report.md"
  const teeCfg = formCombat393().replace(
    String.raw`write_target = '\.md$'`,
    () => String.raw`write_target = '''\.md$'''`,
  )
  const mt = mod$393({
    files: { [homeT + "/probes.toml"]: teeCfg, [rep]: "old\n", ["/f2t-fix3/x.log"]: "x\n" },
    env: { CLAUDE_PROBES_DIR: homeT, PWD: "/work-f2t-fix3", CLAUDE_FORM: "1" },
    now: 230_020_000,
  })
  const tee = "cat <<'EOF' | tee -a /f2t-fix3/x.log | tee -a " + rep + "\nzzz-legalize\nEOF"
  await hook393(subs393(), "tool.call")(mt.$, { tool: "Bash", command: tee }, formNext393(mt, { [rep]: "old\nzzz-legalize\n", "/f2t-fix3/x.log": "x\nzzz-legalize\n" }))
  expect(formLines393(mt.writes).some((r: any) => r.outcome === "refuse"), "tee -a судит report").toBe(true)

  await drainFold393()
  const homeD = "/probes-f2d-fix3"
  const same = "/f2d-fix3/report.md"
  const md = mod$393({
    files: { [homeD + "/probes.toml"]: formRedirect393() + '\n[probe.form.act]\nC1 = "cancel"\n', [same]: "old\n" },
    env: { CLAUDE_PROBES_DIR: homeD, PWD: "/work-f2d-fix3", CLAUDE_FORM: "1" },
    now: 230_030_000,
  })
  const twice = "cat >> " + same + " <<'EOF'\nzzz-legalize\nEOF\ncat >> " + same + " <<'EOF'\nzzz-legalize\nEOF"
  const outD = await hook393(subs393(), "tool.call")(md.$, { tool: "Bash", command: twice }, formNext393(md, { [same]: "old\nzzz-legalize\nzzz-legalize\n" }))
  const recs = md.writes.filter(w => w.path.indexOf("/form/records/") >= 0).map(w => JSON.parse(String(w.text)))
  const c1 = recs.reduce((n: number, r: any) => n + (r.refuse || []).filter((x: any) => x.c === "C1" && x.src === "Bash:" + same).length, 0)
  expect(c1, "D7c: candidate path judged once").toBe(1)
  expect(recs.flatMap((r: any) => r.refuse || []).some((r: any) => r.c === "C1" && r.src === "Bash:" + same), "D7c: own target refusal").toBe(true)
  expect(typeof outD.deny, "D7c: model receives denial").toBe("string")
  expect(md.files[same], "D7c: both appends rolled back").toBe("old\n")
})

test("#489-B1-FIX3 F5 brief_ref: второй вызов не наследует lastIndex", async () => {
  await drainFold393()
  const home = "/probes-f5-fix3"
  const paths = [0, 1, 2, 3, 4].map(i => "/f5-fix3/r" + i + "/report.md")
  const one = "/f5-fix3/only/report.md"
  const files: Record<string, string> = { [home + "/probes.toml"]: formRedirect393().replace('brief_ref = "zzz-brief-ref"', 'brief_ref = "/f5-fix3/\\S+/report\\.md"') }
  for (const p of paths) files[p] = "zzz-legalize\n"
  files[one] = "zzz-legalize\n"
  const m = mod$393({
    files,
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-f5-fix3", CLAUDE_FORM: "1" },
    now: 230_050_000,
  })
  const hook = hook393(subs393(), "tool.call")
  await hook(m.$, { tool: "Agent", prompt: paths.join(" "), subagent_type: "scout" }, async (e: any) => e)
  const judged = formRecordsFinal393(m).flatMap(r => r.refuse || []).filter((r: any) => r.c === "C1").map((r: any) => r.src)
  expect(judged, "F5 первые четыре пути").toEqual(paths.slice(0, 4).map(p => "Agent:" + p))
  const before = formLines393(m.writes).length
  await hook(m.$, { tool: "Agent", prompt: one, subagent_type: "scout" }, async (e: any) => e)
  const added = formLines393(m.writes).slice(before)
  expect(added.some((r: any) => r.outcome === "refuse"), "ref в позиции 0 судится").toBe(true)
})

test("#455-B1-FIX3 F6 fail-closed: скобка только по контракту", async () => {
  const h = failClosedHandler391()
  const plain = await h({}, { tool: "Write" }, { called: false, error: Object.freeze({ kind: "throw", budget: 1000 }) })
  expect(String(plain.deny), "контракт без message — без скобки").not.toContain("([object Object])")
  expect(String(plain.deny)).toContain("threw")
  const withMsg = await h({}, { tool: "Write" }, { called: false, error: Object.freeze({ kind: "throw", budget: 1000, message: "m" }) })
  expect(String(withMsg.deny)).toContain("(m)")
  const empty = await h({}, { tool: "Write" }, { called: false, error: new Error("(empty error)") })
  expect(String(empty.deny)).toContain("((empty error))")
  const boom = await h({}, { tool: "Write" }, { called: false, error: "boom" })
  expect(String(boom.deny)).toContain("(boom)")
  const bad: any = { message: "k-boom" }
  Object.defineProperty(bad, "kind", { get() { throw 1 } })
  let thrown = ""
  let out: any = null
  try { out = await h({}, { tool: "Write" }, { called: false, error: bad }) } catch (x) { thrown = String(x) }
  expect(thrown, "геттер kind не обрывает").toBe("")
  expect(String(out && out.deny)).toContain("(k-boom)")
  for (const [error, text] of [[0, "0"], [false, "false"], ["", "(empty error)"], [{ kind: null }, "[object Object]"], [{ kind: "" }, "[object Object]"], [{ kind: undefined }, "[object Object]"], [{ kind: 1 }, "[object Object]"]] as any[]) {
    const out = await h({}, { tool: "Write" }, { called: false, error })
    expect(out.deny, "F6 точный deny " + String(error)).toBe("Subagent dispatch cancelled: the catalyst-probes tool.call hook threw (" + text + ") [throw]. Fail-closed: the dispatch never runs unreviewed. This is NOT the routing-table.toml gate. Tell the human and do the work without a subagent, or retry later.")
  }
})

test("#489-B1-FIX3 F13 read: code ENOENT — отсутствие, не unreadable", async () => {
  for (const code of ["ENOENT", "EIO"]) {
    await clear393()
    await drainFold393()
    const home = "/probes-f13-fix4-" + code
    const rule = "/f13-fix4-" + code + "/rule.txt"
    const m = mod$393({
      files: { [home + "/probes.toml"]: '[prompt.f13]\ntool = "Read"\ntext_file = "' + rule + '"\n' },
      env: { CLAUDE_PROBES_DIR: home, PWD: "/work-f13-fix4-" + code, CLAUDE_PROMPTS: "1" },
      now: 230_060_000,
    })
    let reads = 0
    const orig = m.$.fs.read
    m.$.fs.read = async (p: string) => {
      if (p === rule) { reads++; throw { code } }
      return orig(p)
    }
    const before = lostN393("prompt-rule-text")
    const out = await hook393(subs393(), "tool.describe")(m.$, { tool: "Read", description: "Base" }, async (e: any) => e)
    expect(String(out.description)).toBe("Base")
    expect(reads, "F13 read witness " + code).toBeGreaterThanOrEqual(1)
    expect(lostN393("prompt-rule-text") - before, "F13 classification " + code).toBe(code === "ENOENT" ? 0 : 1)
  }
})

test("#489-B1-FIX3 F4 form: пустые совпадения и суррогат не зависают", async () => {
  await drainFold393()
  const home = "/probes-f4-fix3"
  const clef = String.fromCodePoint(0x1D11E)
  const cfg = formRedirect393()
    .replace(String.raw`write_target = '\.md$'`, 'write_target = "()"')
    .replace(/heredoc = "[\s\S]*"/, 'heredoc = "()"')
    .replace('brief_ref = "zzz-brief-ref"', 'brief_ref = "x*"')
  const m = mod$393({
    files: { [home + "/probes.toml"]: cfg },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-f4-fix3", CLAUDE_FORM: "1" },
    now: 230_040_000,
  })
  let thrown = ""
  try {
    await hook393(subs393(), "tool.call")(m.$, { tool: "Bash", command: "echo " + clef }, formNext393(m, {}))
    await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: clef, subagent_type: "scout" }, async (e: any) => e)
  } catch (x) { thrown = String(x) }
  expect(thrown, "вызов завершается").toBe("")
  expect(formLines393(m.writes).length, "событий нет").toBe(0)
})

async function formFix4(id: string, command: string, cfg = formCombat393(), files: Record<string, string> = {}) {
  const path = "/fix4/r/report.md"
  const bodies: Record<string, string> = {
    f15: "ordinary\n", f16b: "zzz-legalize\n", f16c: "zzz-legalize\n",
    f4b: String.fromCodePoint(0x1D11E) + "\n", f18: "noise\n",
    f19: (files[path] || "") + "ordinary\n",
  }
  const post = id in bodies ? { [path]: bodies[id] } : {}
  return form510("fix4-" + id, command, { cfg, files, post, cwd: "/fix4" })
}

test("#489-B1-FIX4 F15 bodies belong to their operator line", async () => {
  const r = await formFix4("f15", "cat <<'EOF' >> a/log.txt\nzzz-legalize\nEOF\ncat <<'EOF' >> r/report.md\nordinary\nEOF")
  expect(r.rows.some((r: any) => r.outcome === "refuse"), "F15 no cross-body refusal").toBe(false)
  expect(r.records.flatMap(r => r.refuse || []).some((r: any) => r.c === "C1"), "F15 no C1").toBe(false)
})

test("#489-B1-FIX4 F16a redirect inside body is not a write", async () => {
  const r = await formFix4("f16a", "cat <<'EOF' >> a.log\necho x >> r/report.md\nEOF")
  expect(r.reads.includes("/fix4/r/report.md"), "F16a no body-target read").toBe(false)
  expect(r.records.flatMap(r => [...(r.refuse || []), ...(r.warn || [])]).some((r: any) => String(r.src).includes("r/report.md")), "F16a no body-target event").toBe(false)
})

test("#489-B1-FIX4 F16b first body remains attached", async () => {
  const r = await formFix4("f16b", "cat >> r/report.md <<'EOF'\nzzz-legalize\nEOF\ncat >> a.log <<'EOF'\nordinary\nEOF")
  expect(r.rows.some((r: any) => r.outcome === "refuse"), "F16b first body judged").toBe(true)
})

test("#489-B1-FIX4 F16c continued operator line", async () => {
  const r = await formFix4("f16c", "cat >> r/report.md \\\n  <<'EOF'\nzzz-legalize\nEOF")
  expect(r.rows.some((r: any) => r.outcome === "refuse"), "F16c continuation binds target").toBe(true)
})

// #489-B1-FIX4 F16d удалён в волне B1-FIX5: он мерил снятие индексов у
// регулярки cfg.heredoc; регулярка снята с чтения (лекссер shellScan), её
// место занимает L18.

test("#489-B1-FIX4 F4b empty matches preserve a later target", async () => {
  const cfg = formCombat393().replace(String.raw`write_target = '\.md$'`, String.raw`write_target = '\.md$|(?:)'`)
  const r = await formFix4("f4b", "echo " + String.fromCodePoint(0x1D11E) + " >> r/report.md <<'EOF'\nzzz-legalize\nEOF", cfg)
  expect(r.postReads, "F4b later target judged from actual output").toContain("/fix4/r/report.md")
  expect(r.rows.some((r: any) => r.outcome === "refuse"), "F4b echo does not copy its stdin").toBe(false)
})

test("#489-B1-FIX4 F17 safeText reads each accessor once", () => {
  for (const field of ["message", "name"]) {
    let n = 0
    const x: any = { toString() { return "[object Object]" } }
    Object.defineProperty(x, field, { get() { if (n++) throw 1; return field === "message" ? "m" : "Foo" } })
    chunkCarriesContent(new Proxy({}, { ownKeys() { throw x } }))
    expect(registerModule393.lostWritesSnapshot()["turn-step-chunk-keys"].last, "F17 safeText " + field).toBe(field === "message" ? "m" : "Foo")
    expect(n, "F17 one read " + field).toBe(1)
  }
})

test("#455-B1-FIX4 F17 contract message read once", async () => {
  let n = 0
  const error = Object.freeze({ kind: "throw", budget: 1000, get message() { if (n++) throw 1; return "m" } })
  const out = await failClosedHandler391()({}, { tool: "Write" }, { called: false, error })
  expect(out.deny, "F17 contract keeps first message").toContain("(m)")
  expect(n, "F17 contract one read").toBe(1)
})

test("#489-B1-FIX4 F17 model envelope fields read once", () => {
  const counts: Record<string, number> = {}
  const once = (k: string, value: any) => ({ get() { counts[k] = (counts[k] || 0) + 1; if (counts[k] > 1) throw k; return value } })
  const raw: any = {}
  const usage: any = {}
  Object.defineProperty(usage, "output_tokens", once("output_tokens", 7))
  for (const [k, v] of Object.entries({ text: "m", stopReason: "end_turn", blocks: [{ type: "text", len: 1 }], usage })) Object.defineProperty(raw, k, once(k, v))
  expect(registerModule393.readComplete(raw), "F17 host envelope").toEqual({ text: "m", stopReason: "end_turn", blocks: [{ type: "text", len: 1 }], outTok: 7, detailed: true })
  expect(counts).toEqual({ text: 1, stopReason: 1, blocks: 1, usage: 1, output_tokens: 1 })
})

test("#489-B1-FIX4 F18 empty target capture is skipped", async () => {
  const cfg = formCombat393().replace(String.raw`write_target = '\.md$'`, String.raw`write_target = '\.md$|noise'`)
  const r = await formFix4("f18", "echo noise >> r/report.md <<'EOF'\nzzz-legalize\nEOF", cfg)
  expect(r.reads.filter(p => p === "/fix4/r/report.md").length, "F18 one target read").toBe(1)
  expect(r.reads.some(p => p.endsWith("/undefined")), "F18 no undefined read").toBe(false)
  expect(JSON.stringify(r.records).includes("/undefined"), "F18 no undefined skip").toBe(false)
  expect(r.rows.length, "F18 journal row present").toBeGreaterThan(0)
  expect(r.rows.some((x: any) => (x.skipped || []).some((p: string) => String(p).endsWith("/undefined"))), "F18 journal skipped has no undefined target").toBe(false)
})

test("#489-B1-FIX4 F19 tee includes existing target", async () => {
  const cfg = formCombat393().replace(String.raw`write_target = '\.md$'`, () => String.raw`write_target = '''\.md$'''`)
  const r = await formFix4("f19", "cat <<'EOF' | tee -a r/report.md\nordinary\nEOF", cfg, { "/fix4/r/report.md": "zzz-legalize\n" })
  expect(r.rows.some((r: any) => r.outcome === "refuse"), "F19 tee reads cur").toBe(true)
})

test("#489-B1-FIX4 F20 cached regexp starts at zero", () => {
  const r = (registerModule393 as any).K("a", "gu", "f20")
  r.exec("aa")
  expect(r.lastIndex, "F20 positive input").toBe(1)
  expect([..."a".matchAll((registerModule393 as any).K("a", "gu", "f20"))].length, "F20 cache reset").toBe(1)
})

test("#489-B1-FIX4 F17 stream accessors read once", async () => {
  for (const exit of ["next", "return", "throw"]) {
    await clear393()
    await drainFold393()
    failoverBindSet("f17-stream", { ladder: ["f17-model"], rungEffort: {}, subagentType: "t", class: "", sticky: null })
    const m = mod$393({ files: { "/f17-stream/probes.toml": "[failover]\nenabled = true\n" }, env: { CLAUDE_PROBES_DIR: "/f17-stream", PWD: "/f17-stream" }, now: 250_000_000 })
    const counts: Record<string, number> = {}
    const once = (key: string, value: any) => ({ get() { counts[key] = (counts[key] || 0) + 1; if (counts[key] > 1) throw new Error("second read " + key); return value } })
    const chunk = { kind: "text", text: "first" }
    const result: any = {}
    Object.defineProperty(result, "done", once("done", false))
    Object.defineProperty(result, "value", once("value", chunk))
    let n = 0
    const it: any = { next: async () => n++ ? { done: true, value: "END" } : result }
    Object.defineProperty(it, "return", once("return", async function(this: any, v: any) { expect(this).toBe(it); return { done: true, value: v } }))
    Object.defineProperty(it, "throw", once("throw", async function(this: any, v: any) { expect(this).toBe(it); return { done: true, value: v } }))
    const src: any = {}
    Object.defineProperty(src, Symbol.asyncIterator, once("iterator", function(this: any) { expect(this).toBe(src); return it }))
    const g = hook393(subs393(), "turn.step")(m.$, { agentId: "f17-stream", turnId: "f17", index: 0, model: "f17-model" }, () => src)
    expect((await g.next()).value, "F17 first chunk").toBe(chunk)
    await g[exit]("STOP")
    for (const key of ["iterator", "done", "value", "return", "throw"]) expect(counts[key], "F17 stream one read " + key + " / " + exit).toBe(1)
    failoverBindReset()
  }
})

test("#489-B1-FIX4 F17 session cwd read once", async () => {
  const m = mod$393({})
  let n = 0
  const e = { get cwd() { if (n++) throw new Error("second cwd read"); return "/f17-cwd" } }
  await hook393(subs393(), "session.start")(m.$, e, async () => ({}))
  expect(n, "F17 cwd one read").toBe(1)
  expect(m.storeSets.some(r => r.value === "/f17-cwd"), "F17 cwd persisted").toBe(true)
})

test("#489-B1-FIX4 F17 memo predicate accessors read once", () => {
  let kind = 0, t = 0
  const stored = { get kind() { if (kind++) throw new Error("kind twice"); return "BLOCK" }, get t() { if (t++) throw new Error("t twice"); return 100 } }
  expect(registerModule393.memoUsable(stored, 101, 50), "F17 memo predicate").toBe(true)
  expect([kind, t]).toEqual([1, 1])
})

test("#489-B1-FIX4 F17 memo consumer reads host fields once", async () => {
  await clear393()
  await drainFold393()
  const home = "/f17-memo"
  const sid = "f17-memo"
  const prompt = "f17"
  const key = verdictKey("f17", sid, "Read", "", prompt)
  const m = mod$393({ files: { [home + "/probes.toml"]: '[probe.f17]\nkind = "consult"\nact = "cancel"\nenforce = false\non = ["PreToolUse"]\n[probe.f17.when]\nfield = "tool_name"\nequals = "Read"\n' }, env: { CLAUDE_PROBES_DIR: home, PWD: home, CLAUDE_PROBES: "1" }, now: 260_000_000, sid })
  const reads: Record<string, number> = {}
  const values: any = { kind: "BLOCK", t: 260_000_000, rest: "f17", used: "model", dtMs: 1, threw: "first" }
  const stored: any = {}
  for (const k of Object.keys(values)) Object.defineProperty(stored, k, { get() { reads[k] = (reads[k] || 0) + 1; if (reads[k] > 1) throw new Error("twice " + k); return values[k] } })
  const get = m.$.store.get
  m.$.store.get = async (k: string) => k === key ? stored : get(k)
  let called = 0
  const capKey = {}
  m.$.model.complete = async () => {
    if (standModelOver(capKey)) throw new Error(STAND_MODEL_CAP_TEXT)
    called++
    return "BLOCK: live"
  }
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Read", prompt }, async () => ({ ran: true }))
  expect(out.ran, "F17 memo consumer proceeds").toBe(true)
  expect(called, "F17 memo consumer no consult").toBe(0)
  for (const k of Object.keys(reads)) expect(reads[k], "F17 host memo one read " + k).toBe(1)
})

// --- #489-B1-FIX5: лексер heredoc (Z12), снимок события (Z13), skippedN (Z16) ---
// CONSTRAINT: shellScan/snapEvent читаются через namespace-импорт, как
// lostWritesSnapshot выше: на R ДО волны их экспорта нет, а именованный импорт
// несуществующего символа ронял бы весь файл зубов, и красная фаза не показала
// бы отказ каждого зуба отдельной строкой.

const TRIG5 = "zzz-legalize"

function scan5(cmd: string): any {
  const fn: any = (registerModule393 as any).shellScan
  if (typeof fn !== "function") throw new Error("shellScan: нет экспорта на этом R")
  return fn(cmd)
}

function snap5($: any, e: any, site: string): any {
  const fn: any = (registerModule393 as any).snapEvent
  if (typeof fn !== "function") throw new Error("snapEvent: нет экспорта на этом R")
  return fn($, e, site)
}

async function formFix5(id: string, command: string, cfg = formCombat393(), files: Record<string, string> = {}) {
  const post: Record<string, string> = {}
  if (["l1", "l2", "l4", "l5", "l12", "l13", "l15", "l16", "l17", "l18", "z16"].includes(id)) post["/fix5/r/report.md"] = (files["/fix5/r/report.md"] || "") + TRIG5 + "\n"
  if (["l21", "l27", "l28"].includes(id)) {
    post["/fix5/r/1report.md"] = id === "l21" ? "ok\n" : "hi\n"
    post["/fix5/r/2report.md"] = TRIG5 + "\n"
  }
  if (id === "l3") { post["/fix5/r/report.md"] = "ok \\\n"; post["/fix5/a/notes.md"] = TRIG5 + "\n" }
  if (id === "w2") post["/fix5/r/report.md"] = (files["/fix5/r/report.md"] || "") + "clean\n"
  return form510("fix5-" + id, command, { cfg, files, post })
}

// Hunt-требование волны: refuse обязан прийти ОТ НУЖНОЙ цели, а не от соседней.
function refusedOn5(r: any, target: string): boolean {
  return r.rows.some((x: any) => x.outcome === "refuse") &&
    r.records.flatMap((x: any) => x.refuse || []).some((x: any) => String(x.src) === target)
}

// CONSTRAINT (#489-B1-FIX6 F2): значения полей — дословно канон
// ~/.claude/probes/probes.toml:164–171 (только чтение); проверка заглушек
// держит фикстуру от молчаливого «замена не сработала».
function formGit6(): string {
  const out = formCombat393()
    .replace('git_commit = "zzz-git-commit"', String.raw`git_commit = '(?<![\w.-])git\s+commit(?![\w-])'`)
    .replace('git_commit_ok = "zzz-git-commit-ok"', () => String.raw`git_commit_ok = '^(?:--only|-o)$'`)
    .replace('trailer_a = "zzz-trailer-a"', "trailer_a = '^Session:'")
    .replace('trailer_b = "zzz-trailer-b"', "trailer_b = '^Co-Authored-By:'")
  for (const stub of ["zzz-git-commit", "zzz-trailer-a", "zzz-trailer-b"]) {
    if (out.indexOf(stub) >= 0) throw new Error("formGit6: заглушка не заменена: " + stub)
  }
  return out
}

function gitF6(r: any): string[] {
  return r.records.flatMap((x: any) => [...(x.refuse || []), ...(x.warn || [])])
    .filter((x: any) => x.c === "F").map((x: any) => String(x.q))
}

// CONSTRAINT (#489-B1-FIX6 F4): write_target — дословно канон :172.
function formTee6(): string {
  const out = formCombat393()
  if (!out.includes(String.raw`write_target = '\.md$'`)) throw new Error("formTee6: канон write_target отсутствует")
  return out
}

test("#489-B1-FIX5 L1: продолжение backslash-newline держит цель на строке оператора", async () => {
  const cmd = "cat <<'EOF' \\\n>> r/report.md\n" + TRIG5 + "\nEOF"
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(1)
  expect(s.heredocs[0].body).toBe(TRIG5)
  expect(s.heredocs[0].terminated).toBe(true)
  expect(s.inert(cmd.indexOf(">>"))).toBe(false)
  const r = await formFix5("l1", cmd)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "L1 refuse от цели продолженной строки").toBe(true)
})

test("#489-B1-FIX5 L2: два heredoc одной строки читаются телами по порядку очереди", async () => {
  const cmd = "cat <<A <<B >> r/report.md\nok\nA\n" + TRIG5 + "\nB"
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(2)
  expect(s.heredocs[0].delim).toBe("A")
  expect(s.heredocs[0].body).toBe("ok")
  expect(s.heredocs[1].delim).toBe("B")
  expect(s.heredocs[1].body).toBe(TRIG5)
  expect(s.heredocs[0].op < s.heredocs[1].op, "op в порядке появления").toBe(true)
  const r = await formFix5("l2", cmd)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "L2 второе тело судится").toBe(true)
})

test("#489-B1-FIX5 L3: чётность косой -- две косые подряд это пара, newline после них режет строку", async () => {
  const cmd = "echo ok >> r/report.md \\\\\ncat <<'EOF' > a/notes.md\n" + TRIG5 + "\nEOF"
  const s = scan5(cmd)
  const line2 = "echo ok >> r/report.md \\\\\n".length
  expect(s.heredocs.length).toBe(1)
  expect(s.heredocs[0].lineStart).toBe(line2)
  expect(s.lineOf(cmd.indexOf(">>"))[0]).toBe(0)
  expect(s.lineOf(cmd.indexOf("cat <<"))[0]).toBe(line2)
  expect(s.lineOf(cmd.indexOf(">>"))[0] === s.heredocs[0].lineStart, "строка цели ≠ строке heredoc").toBe(false)
  const r = await formFix5("l3", cmd)
  expect(r.rows.some((x: any) => x.outcome === "refuse"), "L3 НЕ refuse: тело чужой строки").toBe(false)
})

test("#489-B1-FIX5 L4: `<<\\EOF` -- снятие backslash в слове-разделителе", async () => {
  const cmd = "cat <<\\EOF >> r/report.md\n" + TRIG5 + "\nEOF"
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(1)
  expect(s.heredocs[0].delim).toBe("EOF")
  expect(s.heredocs[0].body).toBe(TRIG5)
  const r = await formFix5("l4", cmd)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "L4 refuse").toBe(true)
})

test("#489-B1-FIX5 L5: `<<-` снимает ведущие табы и с тела, и с терминатора", async () => {
  const cmd = "cat <<-EOF >> r/report.md\n\t" + TRIG5 + "\n\tEOF"
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(1)
  expect(s.heredocs[0].strip).toBe(true)
  expect(s.heredocs[0].body).toBe(TRIG5)
  expect(s.heredocs[0].terminated).toBe(true)
  const r = await formFix5("l5", cmd)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "L5 refuse").toBe(true)
})

test("#489-B1-FIX5 L6: `$(` внутри двойных кавычек возвращает код (git commit -m)", async () => {
  const cmd = "git commit -m \"$(cat <<'EOF'\nmsg\n\nSession: x\nCo-Authored-By: y\nEOF\n)\""
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(1)
  expect(s.heredocs[0].body).toBe("msg\n\nSession: x\nCo-Authored-By: y")
})

test("#489-B1-FIX5 L7: цель в `\"…\"` инертна: ни тела, ни чтения цели", async () => {
  const cmd = "echo \"cat <<EOF >> r/report.md\""
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(0)
  expect(s.inert(cmd.indexOf(">>"))).toBe(true)
  const r = await formFix5("l7", cmd)
  expect(r.reads.indexOf("/fix5/r/report.md") < 0, "L7 $.fs.read цели не звался").toBe(true)
  expect(r.rows.length, "L7 событий нет").toBe(0)
})

test("#489-B1-FIX5 L8: цель в комментарии инертна", async () => {
  const cmd = "true # >> r/report.md"
  const s = scan5(cmd)
  expect(s.inert(cmd.indexOf(">>"))).toBe(true)
  const r = await formFix5("l8", cmd)
  expect(r.rows.length, "L8 событий по цели нет").toBe(0)
})

test("#489-B1-FIX5 L9: `<<<` -- here-string, не heredoc", async () => {
  const cmd = "cat <<< \"x\" >> r/report.md"
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(0)
})

test("#489-B1-FIX5 L10: `<<` внутри арифметики -- сдвиг, не оператор", async () => {
  const cmd = "echo $((1<<2)) >> r/report.md"
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(0)
})

test("#489-B1-FIX5 L11: закон Z5 -- все тела строки судятся для каждой цели строки (D7a)", async () => {
  const cmd = "cat <<A >> r/report.md ; cat <<B > a/notes.md\nok\nA\n" + TRIG5 + "\nB"
  expect(scan5(cmd).heredocs.length).toBe(2)
  const before = "original\u0000bytes\r\n"
  const r = await form510("l11", cmd, { cfg: CANCEL510().replace('report_path = "report[.]md$"', 'report_path = "(report|notes)[.]md$"'), files: { "/fix5/r/report.md": before }, materialize: true })
  expect(refusedOn5(r, "Bash:/fix5/a/notes.md"), "D7a B: own offending target").toBe(true)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "D7a B: no cross-body refusal").toBe(false)
  expect(r.files["/fix5/r/report.md"], "D7a B: append survives").toBe(before + "ok\n")
  expect(r.files["/fix5/a/notes.md"], "D7a B: new offending file removed").toBe(undefined)
  expect(typeof r.out.deny, "D7a B: result denied").toBe("string")
})

test("#489-B1-FIX5 L12: `2>&1` между оператором и целью не режет логическую строку", async () => {
  const cmd = "cat <<'EOF' 2>&1 >> r/report.md\n" + TRIG5 + "\nEOF"
  const r = await formFix5("l12", cmd)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "L12 refuse").toBe(true)
})

test("#489-B1-FIX5 L13: тело без терминатора доходит до конца команды", async () => {
  const cmd = "cat <<EOF >> r/report.md\n" + TRIG5
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(1)
  expect(s.heredocs[0].terminated).toBe(false)
  expect(s.heredocs[0].body).toBe(TRIG5)
  const r = await formFix5("l13", cmd)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "L13 refuse незавершённым телом").toBe(true)
})

test("#489-B1-FIX5 L14: цель в `$'…'` инертна, `\\'` строку не закрывает", async () => {
  const cmd = "echo $'it\\'s >> r/report.md'"
  const s = scan5(cmd)
  expect(s.inert(cmd.indexOf(">>"))).toBe(true)
  const r = await formFix5("l14", cmd)
  expect(r.rows.length, "L14 событий нет").toBe(0)
})

test("#489-B1-FIX5 L15: `E\"O\"F` -- кавычки в слове-разделителе снимаются", async () => {
  const cmd = "cat <<E\"O\"F >> r/report.md\n" + TRIG5 + "\nEOF"
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(1)
  expect(s.heredocs[0].delim).toBe("EOF")
  const r = await formFix5("l15", cmd)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "L15 refuse").toBe(true)
})

test("#489-B1-FIX5 L16: обратная кавычка открывает код, оператор внутри неё живой", async () => {
  const cmd = "echo `cat <<EOF\n" + TRIG5 + "\nEOF\n` >> r/report.md"
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(1)
  const r = await formFix5("l16", cmd)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "L16 refuse").toBe(true)
})

test("#489-B1-FIX5 L17: heredoc внутри `$(…)` растянут в одну строку глубины 0", async () => {
  const cmd = "echo \"$(cat <<'EOF'\n" + TRIG5 + "\nEOF\n)\" >> r/report.md"
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(1)
  expect(s.heredocs[0].lineStart).toBe(0)
  expect(s.heredocs[0].lineEnd).toBe(cmd.length)
  expect(s.lineOf(cmd.length - 1)).toStrictEqual([0, cmd.length])
  const r = await formFix5("l17", cmd)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "L17 refuse").toBe(true)
})

test("#489-B1-FIX5 L18: форма без ключа `heredoc` в конфиге судит (ключ снят из FORM_REQ)", async () => {
  const cmd = "cat <<'EOF' \\\n>> r/report.md\n" + TRIG5 + "\nEOF"
  const cfg = formCombat393().replace(/^heredoc = ".*"\n/m, "")
  expect(cfg.indexOf("heredoc") < 0, "L18 фикстура без ключа heredoc").toBe(true)
  const r = await formFix5("l18", cmd, cfg)
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "L18 проба судит без ключа").toBe(true)
})

test("#489-B1-FIX5b L19: подоболочка внутри `$(…)` не закрывает подстановку", async () => {
  const cmd = "x=$( (true)\ntrue ) > r/report.md"
  const s = scan5(cmd)
  expect(s.lineOf(cmd.indexOf(">"))[0]).toBe(0)
})

test("#489-B1-FIX5b L20: шаблон case внутри `$(…)` не закрывает подстановку, `esac)` закрывает", async () => {
  const cmd = "x=$(case y in a) true;;\nesac) > r/report.md\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.lineOf(cmd.indexOf(") > r"))[0]).toBe(0)
  expect(s.heredocs.length).toBe(1)
  expect(s.heredocs[0].lineStart).toBe(cmd.indexOf("cat <<"))
})

test("#489-B1-FIX6 L21: `echo case` не открывает шаблон", async () => {
  // Отклонение от буквальной таблицы брифа (доказательство — REPORT, concerns C1):
  // фикстурный report_path = "report[.]md$" (FORM_CFG_335) не матчит "report1.md"/
  // "report2.md" -> вердикт report2 был недостижим ни на каком R. Имена 1report.md/
  // 2report.md матчат фильтр, порядок и смысл утверждений те же.
  const cmd = "x=$(echo case); cat >> r/1report.md <<EOF\nok\nEOF\ncat >> r/2report.md <<EOF\n" + TRIG5 + "\nEOF"
  const s = scan5(cmd)
  expect(s.heredocs.length).toBe(2)
  expect(s.heredocs[0].lineStart).not.toBe(s.heredocs[1].lineStart)
  const r = await formFix5("l21", cmd)
  const srcs = r.records.flatMap((x: any) => x.refuse || []).map((x: any) => String(x.src))
  expect(srcs).toContain("Bash:/fix5/r/2report.md")
  expect(srcs).not.toContain("Bash:/fix5/r/1report.md")
})

test("#489-B1-FIX6 L22: `grep -c case` не открывает шаблон", async () => {
  const cmd = "n=$(grep -c case f)\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.heredocs[0].lineStart).toBe(cmd.indexOf("cat <<"))
})

test("#489-B1-FIX6 L23: `then case` — командная позиция", async () => {
  const cmd = "x=$(if true; then case y in a) true;;\nesac; fi) > r/report.md\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.lineOf(cmd.indexOf(") > r"))[0]).toBe(0)
  expect(s.heredocs[0].lineStart).toBe(cmd.indexOf("cat <<"))
})

test("#489-B1-FIX6 L24: `in esac` — пустой case", async () => {
  const cmd = "x=$(case y in esac)\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.heredocs[0].lineStart).toBe(cmd.indexOf("cat <<"))
})

test("#489-B1-FIX6 L25: `case` после шаблона `a)` — командная позиция", async () => {
  const cmd = "x=$(case a in x) case b in y) true;; esac;; z) true;;\nesac)\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.lineOf(cmd.indexOf("esac)"))[0]).toBe(0)
})

test("#489-B1-FIX6 L26: `echo esac` внутри case не закрывает шаблон", async () => {
  const cmd = "x=$(case y in a) echo esac;; b) true;;\nesac)\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.lineOf(cmd.indexOf("esac)"))[0]).toBe(0)
})

test("#489-B1-FIX6 C1: чужой heredoc в цепочке не подменяет `-m`", async () => {
  const cmd = "git commit --only -m \"Session: a\nnoise\nCo-Authored-By: b\" && cat <<\\EOF >> notes.md\nSession: x\nCo-Authored-By: y\nEOF"
  const r = await formFix5("c1", cmd, formGit6())
  expect(gitF6(r)).toContain("трейлеры Session: и Co-Authored-By: не соседние")
})

test("#489-B1-FIX6 C2: `-F -` берёт heredoc своей команды", async () => {
  const cmd = "git commit --only -F - <<'EOF'\nSession: x\nnoise\nCo-Authored-By: y\nEOF"
  const r = await formFix5("c2", cmd, formGit6())
  expect(gitF6(r)).toContain("трейлеры Session: и Co-Authored-By: не соседние")
})

test("#489-B1-FIX6 C3: `-m` и heredoc вместе — судится полное сообщение", async () => {
  const cmd = "git commit --only -m \"Session: z\" -m \"$(cat <<'EOF'\nCo-Authored-By: y\nEOF\n)\""
  const r = await formFix5("c3", cmd, formGit6())
  expect(gitF6(r)).toContain("трейлеры Session: и Co-Authored-By: не соседние")
})

test("#489-B1-FIX6 C4: тело heredoc внутри `-m \"$(…)\"` заменяет сырой захват", async () => {
  const cmd = "git commit --only -m \"$(cat <<-'EOF'\n\tSession: x\n\tnoise\n\tCo-Authored-By: y\nEOF\n)\""
  const r = await formFix5("c4", cmd, formGit6())
  expect(gitF6(r)).toContain("трейлеры Session: и Co-Authored-By: не соседние")
})

test("#489-B1-FIX6 C5: `--only` соседней команды не засчитывается", async () => {
  const cmd = "git commit -m \"x\"; echo --only"
  const r = await formFix5("c5", cmd, formGit6())
  expect(gitF6(r).some((q) => q.indexOf("git commit: нет") === 0)).toBe(true)
})

test("#489-B1-FIX6 C6: перенаправления не режут команду", async () => {
  const cmd = "git commit &>/dev/null >|x.log 2>&1 --only -m \"ok\""
  const r = await formFix5("c6", cmd, formGit6())
  expect(gitF6(r).some((q) => q.indexOf("git commit: нет") === 0)).toBe(false)
  expect(scan5(cmd).cmdOf(0)[1]).toBe(cmd.length)
})

test("#489-B1-FIX6 C7: heredoc соседней команды на той же строке не берётся", async () => {
  const cmd = "git commit --only -F - <<'EOF' && cat <<'A' > n.md\nSession: x\nnoise\nCo-Authored-By: y\nEOF\nSession: x\nCo-Authored-By: y\nA"
  const r = await formFix5("c7", cmd, formGit6())
  expect(gitF6(r)).toContain("трейлеры Session: и Co-Authored-By: не соседние")
})

test("#489-B1-FIX6 C8: `-m` соседней команды не входит в сообщение", async () => {
  const cmd = "git commit --only -m \"Co-Authored-By: b\"; git notes add -m \"Session: a\""
  const r = await formFix5("c8", cmd, formGit6())
  expect(gitF6(r)).not.toContain("трейлеры Session: и Co-Authored-By: не соседние")
})

// --- #489-B1-FIX7: фазы case, разделители по рамкам, [[ ]], суд коммита ------

test("#489-B1-FIX7 L27: `)` вложенной подстановки не даёт командной позиции", async () => {
  const cmd = "x=$(case y in a) echo $(p) case z;; esac)\necho hi >> r/1report.md\ncat <<E >> r/2report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.heredocs[0].lineStart).toBe(cmd.indexOf("cat <<"))
  const r = await formFix5("l27", cmd)
  const srcs = r.records.flatMap((x: any) => x.refuse || []).map((x: any) => String(x.src))
  expect(srcs).toContain("Bash:/fix5/r/2report.md")
  expect(srcs).not.toContain("Bash:/fix5/r/1report.md")
})

test("#489-B1-FIX7 L28: закрывающая обратная кавычка не даёт командной позиции", async () => {
  const cmd = "x=$(case y in a) echo `p` case z;; esac)\necho hi >> r/1report.md\ncat <<E >> r/2report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.heredocs[0].lineStart).toBe(cmd.indexOf("cat <<"))
  const r = await formFix5("l28", cmd)
  const srcs = r.records.flatMap((x: any) => x.refuse || []).map((x: any) => String(x.src))
  expect(srcs).toContain("Bash:/fix5/r/2report.md")
  expect(srcs).not.toContain("Bash:/fix5/r/1report.md")
})

test("#489-B1-FIX7 L29-do: `case` после `do` — командная позиция", async () => {
  const cmd = "x=$(for v in 1; do case y in a|b) true;; esac; done)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-else: `case` после `else` — командная позиция", async () => {
  const cmd = "x=$(if false; then :; else case y in a|b) true;; esac; fi)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-elif: `case` после `elif` — командная позиция", async () => {
  const cmd = "x=$(if false; then :; elif case y in a|b) true;; esac; then :; fi)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-if: `case` после `if` — командная позиция", async () => {
  const cmd = "x=$(if case y in a|b) true;; esac; then :; fi)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-while: `case` после `while` — командная позиция", async () => {
  const cmd = "x=$(while case y in a|b) false;; esac; do :; done)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-until: `case` после `until` — командная позиция", async () => {
  const cmd = "x=$(until case y in a|b) true;; esac; do :; done)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-brace: `case` после `{` — командная позиция", async () => {
  const cmd = "x=$({ case y in a|b) true;; esac; })"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-bang: `case` после `!` — командная позиция", async () => {
  const cmd = "x=$(! case y in a|b) true;; esac)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-time: `case` после `time` — командная позиция", async () => {
  const cmd = "x=$(time case y in a|b) true;; esac)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-semi: `case` после `;` — командная позиция", async () => {
  const cmd = "x=$(true; case y in a|b) true;; esac)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-pipe: `case` после `|` — командная позиция", async () => {
  const cmd = "x=$(echo | case y in a|b) true;; esac)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-amp: `case` после `&` — командная позиция", async () => {
  const cmd = "x=$(true & case y in a|b) true;; esac)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-andand: `case` после `&&` — командная позиция", async () => {
  const cmd = "x=$(true && case y in a|b) true;; esac)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-bt-open: открывающая обратная кавычка держит командную позицию", async () => {
  const cmd = "x=`case y in a|b) true;; esac`"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L29-subshell: `case` в подоболочке внутри `$(…)`", async () => {
  const cmd = "x=$( (case y in a|b) true;; esac) )"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("b)"))[0]).toBeLessThanOrEqual(cmd.indexOf("case y"))
})

test("#489-B1-FIX7 L30-noclobber: `>|` перед case — имя файла", async () => {
  const cmd = "x=$(echo hi >| case; for v in a b; do :; done)\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.heredocs[0].lineStart).toBe(cmd.indexOf("cat <<"))
})

test("#489-B1-FIX7 L30-dupout: `>&`", async () => {
  const cmd = "x=$(echo hi >& case; for v in a b; do :; done)\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.heredocs[0].lineStart).toBe(cmd.indexOf("cat <<"))
})

test("#489-B1-FIX7 L30-dupin: `<&`", async () => {
  const cmd = "x=$(cat <& case; for v in a b; do :; done)\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.heredocs[0].lineStart).toBe(cmd.indexOf("cat <<"))
})

test("#489-B1-FIX7 L31: extglob-скобки в шаблоне", async () => {
  const cmd = "shopt -s extglob\nx=$(case y in @(a|b)) true;;\nesac) > r/report.md\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.lineOf(cmd.indexOf(") > r"))[0]).toBe(cmd.indexOf("x=$("))
})

test("#489-B1-FIX7 L32: ведущая `(` шаблона", async () => {
  const cmd = "x=$(case y in (a) true;;\nesac)\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.heredocs[0].lineStart).toBe(cmd.indexOf("cat <<"))
})

test("#489-B1-FIX7 L33: терминаторы `;&` и `;;&`", async () => {
  const cmd = "x=$(case y in a) true;& b) true;;& c) true;;\nesac) > r/report.md\ncat <<E >> r/report.md\n" + TRIG5 + "\nE"
  const s = scan5(cmd)
  expect(s.lineOf(cmd.indexOf(") > r"))[0]).toBe(0)
})

test("#489-B1-FIX7 L34a: `&&` внутри `[[ ]]` не режет", async () => {
  const cmd = "[[ -n a && -n b ]]"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("-n b"))[0]).toBe(0)
})

test("#489-B1-FIX7 L34b: `]]` закрывает выражение", async () => {
  const cmd = "[[ -n a ]] && echo b"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("echo b"))[0]).toBeGreaterThan(cmd.indexOf("]]"))
})

test("#489-B1-FIX7 L34c: `[[` в шаблоне case — не выражение", async () => {
  const cmd = "case y in a) true;; [[:alpha:]]) true;; esac; echo p && echo q"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("echo q"))[0]).toBeGreaterThan(cmd.indexOf("echo p"))
})

test("#489-B1-FIX7 L35: терминатор heredoc — разделитель своей рамки", async () => {
  const cmd = "x=$(cat <<E\nt\nE\necho b)"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("echo b"))[0]).toBe(cmd.indexOf("echo b"))
})

test("#489-B1-FIX7 C9: две команды в `$(…)` через `;`", async () => {
  const cmd = "x=$(git commit -m \"Session: a\nnoise\nCo-Authored-By: b\"; git commit --only -m \"ok\")"
  const r = await formFix5("c9", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
  expect(gitF6(r).filter((q) => q === "трейлеры Session: и Co-Authored-By: не соседние").length).toBe(1)
})

test("#489-B1-FIX7 C10: две команды в обратных кавычках", async () => {
  const cmd = "x=`git commit -m \"a\"; git commit --only -m \"b\"`"
  const r = await formFix5("c10", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C11: перевод строки внутри `$(…)`", async () => {
  const cmd = "x=$(git commit -m \"a\"\ngit commit --only -m \"b\")"
  const r = await formFix5("c11", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C12: `-m` вложенной подстановки не входит в сообщение", async () => {
  const cmd = "git commit --only -m \"Co-Authored-By: b\" $(printf %s -m 'Session: a')"
  const r = await formFix5("c12", cmd, formGit6())
  expect(gitF6(r).filter((q) => q === "трейлеры Session: и Co-Authored-By: не соседние").length).toBe(0)
})

test("#489-B1-FIX7 C13: обёртка `bash -c` судится", async () => {
  const cmd = "bash -c 'git commit -m \"x\"'"
  const r = await formFix5("c13", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C14: `git commit` в тексте сообщения не судится второй раз", async () => {
  const cmd = "git commit -m \"see git commit x\""
  const r = await formFix5("c14", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C15: `--only` в тексте сообщения не засчитывается", async () => {
  const cmd = "git commit -m \"use --only please\""
  const r = await formFix5("c15", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C16: `--only` в комментарии не засчитывается", async () => {
  const cmd = "git commit -m \"x\" # --only"
  const r = await formFix5("c16", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C17: `git commit` в комментарии не судится", async () => {
  const cmd = "true # git commit -m x"
  const r = await formFix5("c17", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7 C18: `echo` — данные", async () => {
  const cmd = "echo \"git commit -m x\""
  const r = await formFix5("c18", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7 C19: `echo … | bash` судится", async () => {
  const cmd = "echo \"git commit -m x\" | bash"
  const r = await formFix5("c19", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C20: тело `cat`-heredoc — данные", async () => {
  const cmd = "cat <<'EOF'\ngit commit -m \"Session: a\nnoise\nCo-Authored-By: b\"\nEOF"
  const r = await formFix5("c20", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7 C21: тело `bash`-heredoc судится рекурсивно", async () => {
  const cmd = "bash <<'EOF'\ngit commit -m \"Session: a\nnoise\nCo-Authored-By: b\"\nEOF"
  const r = await formFix5("c21", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
  expect(gitF6(r).filter((q) => q === "трейлеры Session: и Co-Authored-By: не соседние").length).toBe(1)
})

test("#489-B1-FIX7 C22: `cat`-heredoc в `| bash` судится", async () => {
  const cmd = "cat <<'EOF' | bash\ngit commit -m x\nEOF"
  const r = await formFix5("c22", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C23: тело heredoc своего commit — сообщение", async () => {
  const cmd = "git commit --only -F - <<'EOF'\nfix: git commit hook\nEOF"
  const r = await formFix5("c23", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7 C24: `cat` внутри `-m \"$(…)\"` — данные", async () => {
  const cmd = "git commit --only -m \"$(cat <<'EOF'\nfix git commit hook\nEOF\n)\""
  const r = await formFix5("c24", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7 C25: присваивание перед `cat`", async () => {
  const cmd = "X=1 cat <<'EOF'\ngit commit -m x\nEOF"
  const r = await formFix5("c25", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7 C26: `cat` по пути", async () => {
  const cmd = "/bin/cat <<'EOF'\ngit commit -m x\nEOF"
  const r = await formFix5("c26", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7 C27: `||` — не труба", async () => {
  const cmd = "echo \"git commit -m x\" || true"
  const r = await formFix5("c27", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7 C28: рекурсия на второй уровень", async () => {
  const cmd = "bash <<'A'\nbash <<'B'\ngit commit -m x\nB\nA"
  const r = await formFix5("c28", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C29: закрытая `$(…)` не держит следующую команду", async () => {
  const cmd = "x=$(echo --only); git commit -m \"a\""
  const r = await formFix5("c29", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C30: закрытые обратные кавычки не держат следующую команду", async () => {
  const cmd = "x=`echo --only`; git commit -m \"a\""
  const r = await formFix5("c30", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C31: перевод строки комментария — разделитель рамки", async () => {
  const cmd = "x=$(git commit -m \"a\" # c\ngit commit --only -m \"b\")"
  const r = await formFix5("c31", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7 C32: `-m` в кавычках не входит в сообщение", async () => {
  const cmd = "git commit --only -m 'Session: a' \"x -m Co-Authored-By:b\""
  const r = await formFix5("c32", cmd, formGit6())
  expect(gitF6(r).filter((q) => q === "трейлеры Session: и Co-Authored-By: не соседние").length).toBe(0)
})

test("#489-B1-FIX7 C33: ключевое слово перед данными", async () => {
  const cmd = "if true; then echo \"git commit -m x\"; fi"
  const r = await formFix5("c33", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7 C34: подоболочка вокруг данных", async () => {
  const cmd = "( echo \"git commit -m x\" )"
  const r = await formFix5("c34", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7 C35: `cat | tee` — tee пишет в файл, тело судится (FIX10)", async () => {
  const cmd = "cat <<'EOF' | tee r.txt\ngit commit -m x\nEOF"
  const r = await formFix5("c35", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7b L36: комментарий сразу за открывающей кавычкой bt, следующий кадр — код", async () => {
  const cmd = "x=`#c`\ngit commit -m \"a\""
  const s = scan5(cmd)
  expect(s.comment(cmd.indexOf("#c"))).toBe(true)
  expect(s.comment(cmd.indexOf("git"))).toBe(false)
  expect(s.inert(cmd.indexOf("git"))).toBe(false)
})

test("#489-B1-FIX7b L37: хвостовой `#`-комментарий внутри bt-рамки не держит следующую команду", async () => {
  const cmd = "x=`true #c`; git commit -m \"a\""
  const s = scan5(cmd)
  expect(s.comment(cmd.indexOf("#c"))).toBe(true)
  expect(s.inert(cmd.indexOf("git"))).toBe(false)
})

test("#489-B1-FIX7b L38: `#` после закрытия `$(…)` не комментарий", async () => {
  const cmd = "echo $(true)#x; git commit -m \"a\""
  const s = scan5(cmd)
  expect(s.comment(cmd.indexOf("#x"))).toBe(false)
  expect(s.inert(cmd.indexOf("git"))).toBe(false)
})

test("#489-B1-FIX7b L39: `#` после закрытия обратной кавычки не комментарий", async () => {
  const cmd = "echo `true`#x; git commit -m \"a\""
  const s = scan5(cmd)
  expect(s.comment(cmd.indexOf("#x"))).toBe(false)
  expect(s.inert(cmd.indexOf("git"))).toBe(false)
})

test("#489-B1-FIX7b L40: `#` после закрытия арифметики не комментарий", async () => {
  const cmd = "echo $((1))#x; git commit -m \"a\""
  const s = scan5(cmd)
  expect(s.comment(cmd.indexOf("#x"))).toBe(false)
  expect(s.inert(cmd.indexOf("git"))).toBe(false)
})

test("#489-B1-FIX7b L41: `#` после `)` подоболочки — комментарий", async () => {
  const cmd = "(true)#x\ngit commit -m \"a\""
  const s = scan5(cmd)
  expect(s.comment(cmd.indexOf("#x"))).toBe(true)
  expect(s.comment(cmd.indexOf("git"))).toBe(false)
})

test("#489-B1-FIX7b L42: экранированная кавычка в комментарии bt не закрывает рамку", async () => {
  const cmd = "x=`true #a \\` b`; git commit -m \"a\""
  const s = scan5(cmd)
  expect(s.comment(cmd.indexOf(" b`") + 1)).toBe(true)
  expect(s.inert(cmd.indexOf("git"))).toBe(false)
})

test("#489-B1-FIX7b C36: коммит после bt-рамки с хвостовым комментарием судится", async () => {
  const cmd = "x=`true #c`; git commit -m \"a\""
  const r = await formFix5("c36", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7b C37: коммит после `$(…)#x` судится", async () => {
  const cmd = "echo $(true)#x; git commit -m \"a\""
  const r = await formFix5("c37", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7c L43: `#` после закрытия голой `((1))` — комментарий", async () => {
  const cmd = "((1))#x\ngit commit -m \"a\""
  const s = scan5(cmd)
  expect(s.comment(cmd.indexOf("#x"))).toBe(true)
  expect(s.comment(cmd.indexOf("git"))).toBe(false)
})

test("#489-B1-FIX7c L44: `(` командной позиции после if начинает отрезок команды", async () => {
  const cmd = "if (git commit -m \"a\") then :; fi"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("git"))[0]).toBe(cmd.indexOf("(") + 1)
})

test("#489-B1-FIX7c L45: `(` присваивания массива не начинает отрезок", async () => {
  const cmd = "x=(a b); echo q"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf(" b") + 1)[0]).toBe(0)
})

test("#489-B1-FIX7c L46: `(` внутри `[[` не начинает отрезок", async () => {
  const cmd = "[[ a && (b) ]] && echo q"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("(b)") + 1)[0]).toBe(0)
})

test("#489-B1-FIX7c L34d: `[[` в шаблоне case не открывает выражение — `&&` после esac режет отрезок", async () => {
  const cmd = "case x in a) true;; [[) true;; esac; echo p && echo q"
  const s = scan5(cmd)
  expect(s.cmdOf(cmd.indexOf("echo q"))[0]).toBeGreaterThan(cmd.indexOf("echo p"))
})

test("#489-B1-FIX7c C38: коммит судится после `$(true)` с идущим следом case", async () => {
  const cmd = "echo $(true) case in; echo --only | git commit -m \"a\""
  const r = await formFix5("c38", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7c C39: коммит судится после закрытия обратной кавычки с идущим следом case", async () => {
  const cmd = "echo `true` case in; echo --only | git commit -m \"a\""
  const r = await formFix5("c39", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7c C40: `--only` из скобок if не покрывает коммит внутри них", async () => {
  const cmd = "if (echo --only ) then git commit -m \"a\"; fi"
  const r = await formFix5("c40", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7c C41: `--only` из скобок while не покрывает коммит внутри них", async () => {
  const cmd = "while (echo --only ) do git commit -m \"a\"; done"
  const r = await formFix5("c41", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("git commit: нет") === 0).length).toBe(1)
})

test("#489-B1-FIX7c C42: инертный `-m` из чужого отрезка не даёт трейлерного предупреждения", async () => {
  const cmd = "x \"git commit --only -m a\"; echo -m \"Session: s\n\nCo-Authored-By: c\""
  const r = await formFix5("c42", cmd, formGit6())
  expect(gitF6(r).filter((q) => q.indexOf("трейлеры Session: и Co-Authored-By: не соседние") >= 0).length).toBe(0)
})

// CONSTRAINT: после FIX9 `(` командной позиции — разделитель, и C34 держится им; снятие `{`/`!` в cmdWord пинят эти два зуба.
test("#489-B1-FIX7c C43: группа `{ … }` вокруг данных", async () => {
  const cmd = "{ echo \"git commit -m x\"; }"
  const r = await formFix5("c43", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX7c C44: отрицание `!` перед данными", async () => {
  const cmd = "! echo \"git commit -m x\""
  const r = await formFix5("c44", cmd, formGit6())
  expect(gitF6(r).length).toBe(0)
})

test("#489-B1-FIX6 W1: голый `tee` усекает цель", async () => {
  const cmd = "cat <<'EOF' | tee r/report.md\nclean\nEOF"
  const r = await form510("w1", cmd, { cfg: formTee6(), files: { "/fix5/r/report.md": TRIG5 + "\n" }, post: { "/fix5/r/report.md": "clean\n" } })
  expect(r.preReads, "D7b W1: no old-content read before next").not.toContain("/fix5/r/report.md")
  expect(r.postReads, "D7b W1: actual-content read after next").toContain("/fix5/r/report.md")
  expect(r.files["/fix5/r/report.md"], "D7b W1: truncation materialized").toBe("clean\n")
  expect(refusedOn5(r, "Bash:/fix5/r/report.md")).toBe(false)
})

test("#510 D7b W1-with-backup", async () => {
  const path = "/fix5/r/report.md"
  const cmd = "cat <<'EOF' | tee r/report.md\nclean\nEOF"
  const r = await form510("w1-with-backup", cmd, { cfg: CANCEL510(), files: { [path]: TRIG5 + "\n" }, post: { [path]: "clean\n" } })
  expect(r.proc.some((argv: string[]) => argv[0] === "/bin/cp" && argv[argv.length - 2] === path && argv[argv.length - 1].includes("/form-backup/")), "D7b with backup: target backup copy witnessed").toBe(true)
  expect(r.preReads, "D7b with backup: no old-content read before next").not.toContain(path)
  expect(r.postReads, "D7b with backup: actual-content read after next").toContain(path)
})
test("#489-B1-FIX6 W2: `tee -a` дописывает (положительный контроль W1)", async () => {
  const cmd = "cat <<'EOF' | tee -a r/report.md\nclean\nEOF"
  const r = await formFix5("w2", cmd, formTee6(), { "/fix5/r/report.md": TRIG5 + "\n" })
  expect(r.reads).toContain("/fix5/r/report.md")
  expect(refusedOn5(r, "Bash:/fix5/r/report.md")).toBe(true)
})

test("#489-B1-FIX5 Z13-a: tool.call читает tool_use_id ровно один раз", async () => {
  await clear393()
  await drainFold393()
  const home = "/probes-z13a"
  const cmd = "cat <<'EOF' >> r/report.md\n" + TRIG5 + "\nEOF"
  const m = mod$393({
    files: { [home + "/probes.toml"]: formCombat393() },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/z13a", CLAUDE_FORM: "1" },
    now: 270_000_100,
  })
  let n = 0
  const ev: any = { tool: "Bash", command: cmd }
  Object.defineProperty(ev, "tool_use_id", { enumerable: true, get() { n++; return n === 1 ? "id1" : "id2" } })
  await hook393(subs393(), "tool.call")(m.$, ev, async (e: any) => e)
  expect(n, "tool_use_id ровно одно чтение хоста").toBe(1)
  expect(m.writes.some(w => String(w.path).endsWith("/form/records/mod-id1.json")), "имя улики из первого чтения").toBe(true)
})

test("#489-B1-FIX5 Z13-b: prompt.section читает text ровно один раз", async () => {
  await clear393()
  await drainFold393()
  const home = "/probes-z13b"
  const rule = "/z13b/rule.txt"
  const m = mod$393({
    files: {
      [home + "/probes.toml"]: '[prompt.z13b]\nsection = "sec-z13b"\ntext_file = "' + rule + '"\n',
      [rule]: "RULE-B",
    },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/z13b", CLAUDE_PROMPTS: "1" },
    now: 270_000_200,
  })
  let n = 0
  const ev: any = { name: "sec-z13b" }
  Object.defineProperty(ev, "text", { enumerable: true, get() { n++; return n === 1 ? "BASE" : "SECOND" } })
  const out = await hook393(subs393(), "prompt.section")(m.$, ev, async (e: any) => e)
  expect(n, "text ровно одно чтение хоста").toBe(1)
  expect(String(out.text), "next получил текст правила от первого чтения").toBe("BASE\n\nRULE-B")
})

test("#489-B1-FIX5 Z13-c: tool.describe читает description ровно один раз", async () => {
  await clear393()
  await drainFold393()
  const home = "/probes-z13c"
  const rule = "/z13c/rule.txt"
  const m = mod$393({
    files: {
      [home + "/probes.toml"]: '[prompt.z13c]\ntool = "Read"\ntext_file = "' + rule + '"\n',
      [rule]: "RULE-C",
    },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/z13c", CLAUDE_PROMPTS: "1" },
    now: 270_000_300,
  })
  let n = 0
  const ev: any = { tool: "Read" }
  Object.defineProperty(ev, "description", { enumerable: true, get() { n++; return n === 1 ? "D1" : "D2" } })
  const out = await hook393(subs393(), "tool.describe")(m.$, ev, async (e: any) => e)
  expect(n, "description ровно одно чтение хоста").toBe(1)
  expect(String(out.description)).toBe("D1\n\nRULE-C")
})

test("#489-B1-FIX5 Z13-d: command.describe читает description ровно один раз", async () => {
  await clear393()
  await drainFold393()
  const home = "/probes-z13d"
  const rule = "/z13d/rule.txt"
  const m = mod$393({
    files: {
      [home + "/probes.toml"]: '[prompt.z13d]\ncommand = "cmd-z13d"\ntext_file = "' + rule + '"\n',
      [rule]: "RULE-D",
    },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/z13d", CLAUDE_PROMPTS: "1" },
    now: 270_000_400,
  })
  let n = 0
  const ev: any = { command: "/cmd-z13d" }
  Object.defineProperty(ev, "description", { enumerable: true, get() { n++; return n === 1 ? "C1D" : "C2D" } })
  const out = await hook393(subs393(), "command.describe")(m.$, ev, async (e: any) => e)
  expect(n, "description ровно одно чтение хоста").toBe(1)
  expect(String(out.description)).toBe("C1D\n\nRULE-D")
})

test("#489-B1-FIX5 Z13-e: agent.spawn читает result.agentId ровно один раз", async () => {
  await clear393()
  await drainFold393()
  failoverBindReset()
  const home = "/probes-z13e"
  const m = mod$393({
    files: { [home + "/probes.toml"]: "[failover]\nenabled = true\n" },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/z13e" },
    now: 270_000_500,
  })
  const result: any = { deny: undefined }
  let n = 0
  Object.defineProperty(result, "agentId", { enumerable: true, get() { n++; return "ag-z13e" } })
  const out = await hook393(subs393(), "agent.spawn")(m.$, { subagentType: "z13e", prompt: "p", model: "mm" }, async () => result)
  expect(n, "agentId результата ровно одно чтение").toBe(1)
  expect(out, "возвращён сам result").toBe(result)
  expect(!!failoverBindGet("ag-z13e"), "привязка построена по первому чтению").toBe(true)
  failoverBindReset()
})

test("#489-B1-FIX5 Z13-f: turn.step читает turnId и index ровно по одному разу", async () => {
  await clear393()
  await drainFold393()
  failoverBindReset()
  const aid = "ag-z13f"
  failoverBindSet(aid, { ladder: ["z13f-rung"], rungEffort: { "z13f-rung": "max" }, subagentType: "t", class: "", sticky: null })
  const ev: any = { agentId: aid, model: "z13f-orig" }
  let tN = 0
  let iN = 0
  Object.defineProperty(ev, "turnId", { enumerable: true, get() { tN++; return "z13f" } })
  Object.defineProperty(ev, "index", { enumerable: true, get() { iN++; return 7 } })
  const next = fan313Stream({ "z13f-orig": () => fan313Ok("z13f") })
  const out = await drainStream(fan313Step()(fan313$(), ev, next))
  expect(tN, "turnId ровно одно чтение хоста").toBe(1)
  expect(iN, "index ровно одно чтение хоста").toBe(1)
  expect(out.value && out.value.text, "ступень отработала").toBe("OK-z13f")
  failoverBindReset()
})

test("#489-B1-FIX5 Z13-g: turn.step вычисляет refusal один раз на попытку", async () => {
  await clear393()
  await drainFold393()
  failoverBindReset()
  const aid = "ag-z13g"
  const mk = (refusal: boolean) => {
    const o: any = {}
    const c = { u: 0, s: 0 }
    Object.defineProperty(o, "usage", { enumerable: true, get() { c.u++; return refusal ? null : { out: 1 } } })
    Object.defineProperty(o, "stopReason", { enumerable: true, get() { c.s++; return refusal ? null : "end_turn" } })
    return { o, c }
  }
  // CONSTRAINT: обе попытки — отказные: isCarrierRefusal (R:427) читает поля
  // через `&&` и на неуказывающем ответе до stopReason не доходит, а зуб
  // пинит «каждый счётчик = 1 НА попытку» для обоих геттеров.
  const r1 = mk(true)
  const r2 = mk(true)
  failoverBindSet(aid, { ladder: ["z13g-two"], rungEffort: { "z13g-two": "max" }, subagentType: "t", class: "", sticky: null })
  const next = fan313Stream({
    "z13g-one": () => (async function* () { return r1.o })(),
    "z13g-two": () => (async function* () { return r2.o })(),
  })
  const out = await drainStream(fan313Step()(fan313$(), { agentId: aid, turnId: "z13g", index: 0, model: "z13g-one" }, next))
  expect([r1.c.u, r1.c.s], "первая попытка: usage/stopReason по одному чтению").toEqual([1, 1])
  expect([r2.c.u, r2.c.s], "вторая попытка: usage/stopReason по одному чтению").toEqual([1, 1])
  expect(out.value, "последний ответ возвращён как есть").toBe(r2.o)
  failoverBindReset()
})

test("#489-B1-FIX5 Z13-h: поток читает свойство next итератора один раз", async () => {
  await clear393()
  await drainFold393()
  failoverBindReset()
  const aid = "ag-z13h"
  failoverBindSet(aid, { ladder: ["z13h-back"], rungEffort: { "z13h-back": "max" }, subagentType: "t", class: "", sticky: null })
  let nextReads = 0
  let steps = 0
  const iter: any = {}
  Object.defineProperty(iter, "next", {
    enumerable: true,
    get() {
      nextReads++
      return async () => {
        steps++
        if (steps <= 3) return { done: false, value: { kind: "text", text: "c" + steps } }
        return { done: true, value: { usage: { out: 1 }, stopReason: "end_turn" } }
      }
    },
  })
  iter[Symbol.asyncIterator] = () => iter
  const out = await drainStream(fan313Step()(fan313$(), { agentId: aid, turnId: "z13h", index: 0, model: "z13h-orig" }, () => iter))
  expect(out.chunks.length, "три куска прошли наружу").toBe(3)
  expect(nextReads, "свойство next прочитано один раз за три шага").toBe(1)
  failoverBindReset()
})

test("#489-B1-FIX5 Z13-i: snapEvent теряет бросивший ключ и учитывает его по сайту", async () => {
  const raw: any = { keep: 1 }
  let boomN = 0
  Object.defineProperty(raw, "boom", { enumerable: true, get() { boomN++; throw new Error("boom-getter") } })
  const snap = snap5({}, raw, "z13i-site")
  expect(boomN, "отказавший геттер прочитан ровно раз").toBe(1)
  expect(Object.prototype.hasOwnProperty.call(snap, "boom"), "ключа нет в снимке").toBe(false)
  expect(snap.keep, "прочитанные ключи в снимке").toBe(1)
  const lost = registerModule393.lostWritesSnapshot()["z13i-site:boom"]
  expect(!!lost, "noteLost с сайтом <событие>:<ключ>").toBe(true)
  expect(lost.n).toBe(1)
  expect(String(lost.last)).toContain("boom-getter")
  expect(snap5({}, null, "z13i-null")).toStrictEqual({})
  expect(snap5({}, "str", "z13i-str")).toStrictEqual({})
  await drainFold393()
})

test("#489-B1-FIX5 Z13-j: `\"agentId\" in e` вычисляется один раз на обработчик", async () => {
  await clear393()
  await drainFold393()
  const home = "/probes-z13j"
  const m = mod$393({
    files: { [home + "/probes.toml"]: formCombat393() },
    env: { CLAUDE_PROBES_DIR: home, PWD: "/z13j", CLAUDE_FORM: "1" },
    now: 270_000_900,
  })
  let hasN = 0
  const prox = new Proxy({ tool: "Bash", command: "true", tool_use_id: "z13j" }, {
    has(t: any, k: any) { if (k === "agentId") hasN++; return Reflect.has(t, k) },
  })
  await hook393(subs393(), "tool.call")(m.$, prox, async (e: any) => e)
  expect(hasN, "ловушка has по agentId сработала один раз").toBe(1)
})

test("#489-B1-FIX5 Z16: журнал формы несёт полное число пропусков рядом со срезом", async () => {
  const targets: string[] = []
  for (let i = 0; i < 10; i++) targets.push("echo x >> r/n" + i + ".md")
  const cmd = "cat <<'EOF' >> r/report.md\n" + TRIG5 + "\nEOF\n" + targets.join("\n")
  const r = await formFix5("z16", cmd)
  expect(r.rows.length, "журнальная строка одна").toBe(1)
  const row = r.rows[0]
  expect(row.outcome, "цель report отсуждена").toBe("refuse")
  expect(row.skippedN, "skippedN -- полное число пропусков").toBe(10)
  expect(row.skipped.length, "срез остаётся восьми").toBe(8)
})
const PROBE10: Array<[string, string, boolean]> = [
  ["R1", "case b in a) true;; --only |b) git commit -m a;; esac", true],
  ["R2", "case $m in\necho) git commit -m a;;\nesac", true],
  ["R3", "cat <(git commit -m a)", true],
  ["R4", "tee >(git commit -m a) < /dev/null", true],
  ["R5", "echo git commit -m a > >(sh)", true],
  ["R6", "echo git commit -m a | tee >(sh)", true],
  ["R7", "$(echo git commit -m a)", true],
  ["R8", "`echo git commit -m a`", true],
  ["R9", "eval $(echo git commit -m a)", true],
  ["R10", "eval \"$(echo git commit -m a)\"", true],
  ["R11", "eval `printf 'git commit -m a'`", true],
  ["R12", "sh -c \"$(echo git commit -m a)\"", true],
  ["R13", "x=$(echo git commit -m a); $x", true],
  ["R14", "bash <<D1\nbash <<D2\nbash <<D3\nbash <<D4\ngit commit -m a\nD4\nD3\nD2\nD1", true],
  ["R15", "cat <<X > s.sh\ngit commit -m a\nX\nbash s.sh", true],
  ["R16", "bash -c \"echo --only ; git commit -m a\"", true],
  ["R17", "\"git\" commit -m a", true],
  ["R18", "g''it commit -m a", true],
  ["R19", "git -C . commit -m a", true],
  ["R20", "echo() { git commit -m x; }", true],
  ["R21", "diff <(echo --only ) <(git commit -m a)", true],
  ["R22", "printf -v x 'git commit -m a'; $x", true],
  ["R23", "rg --pre 'git commit -m a' x", true],
  ["R24", "bash <(echo git commit -m a)", true],
  ["R25", "echo \"git commit -m a\" > s.sh", true],
  ["R26", "git --git-dir .git commit -m a", true],
  ["R27", "\\git commit -m a", true],
  ["P1", "git commit --only a -m \"$(cat <<'EOF'\nfix: guard git commit form\nEOF\n)\"", false],
  ["P2", "echo \"git commit -m a\"", false],
  ["P3", "cat <(echo git commit -m a)", false],
  ["P4", "echo \"git commit -m a\" > /dev/null", false],
  ["P5", "echo \"$(echo git commit -m a)\"", false],
  ["P6", "gh pr create --body \"$(cat <<'EOF'\nrun git commit -m x\nEOF\n)\"", false],
  ["P7", "\"git\" commit --only a -m x", false],
  ["P8", "git -C . commit --only a -m x", false],
  ["P9", "bash -c \"git commit --only a -m x\"", false],
  ["P10", "echo git commit -m a 2>&1", false],
  ["P11", "case x in a) echo \"git commit -m a\";; esac", false],
  ["P12", "git commit --only x -m 'use git commit wisely'", false],
  ["P13", "cat <<'EOF'\ngit commit -m x\nEOF", false],
  ["P14", "git commit --only a -m x && echo \"done git commit\"", false],
  ["P15", "git -c user.name=x commit --only a -m y", false],
  ["R28", "git -C . push origin main", true],
  ["R29", "\"git\" push --force origin a:b", true],
  ["P16", "git -C . push origin main:main", false],
  ["P17", "cat <<'EOF' > notes.txt\nplain text\nEOF", false],
  ["R30", "git com''mit -m a", true],
  ["R31", "\"$G\" commit -m a", true],
  ["R32", "$G commit -m a", true],
  ["R33", "$(which git) commit -m a", true],
  ["R34", "g\\it commit -m a", true],
  ["R35", "bash -c \"echo --only ; git commit -m a", true],
  ["R36", "sh -c 'echo --only ; git commit -m a'", true],
  ["R37", "bash -c $'echo --only ; git commit -m a'", true],
  ["R38", "git $opt commit -m a", true],
  ["P18", "cat <<'X'\n\"git\" commit -m a\nX", false],
  ["P19", "true # \"git\" commit -m a", false],
  ["P20", "bash <(true) ; echo \"git commit -m a\"", false],
  ["P21", "echo \"git commit -m a\" >> /dev/null", false],
  ["P22", "echo $G commit", false],
  ["R39", 'echo "$(case b in @(a|(b))) :;; esac; git commit -m a)"', true],
  ["R40", 'x=$(case b in @(a|(b))) :;; esac; git commit -m a)', true],
  ["R41", 'case b in @(a|(b))) git commit -m a;; esac', true],
  ["P23", 'case b in @(a|(b))) echo "git commit -m a";; esac', false],
  ["P24", "bash -c $'x ; git commit --only a -m y'", false],
  ["P25", "bash -c \"x ; git commit --only a -m y", false],
  ["P26", "bash -c \"x ; git commit --only a -m y\"", false],
  ["P27", "sh -c 'x ; git commit --only a -m y'", false],
  ["R42", "echo --only >(git commit -m a)", true],
  ["R43", "bash <<'X'\n\"git\" commit -m a\nX", true],
  ["R44", "bash -c '\"git\" commit -m a'", true],
  ["R45", "bash -c 'g\\it commit -m a'", true],
  ["R46", "eval '\"git\" commit -m a'", true],
  ["R47", "bash <<'X'\ngit -C . commit -m a\nX", true],
  ["R48", "bash -c \"\\\\git commit -m a\"", true],
  ["R49", "bash -c \"bash -c '\\\"git\\\" commit -m a'\"", true],
  ["R50", "bash -c '\"git\" push -f origin a:a'", true],
  ["R51", "cat <<'X' > f.sh\n\"git\" commit -m a\nX", true],
  ["P28", "echo \"git commit -m a\" | grep x", false],
  ["P29", "true # git commit -m a", false],
  ["P30", "echo '\"git\" commit -m a'", false],
  ["P31", "git commit --only a -m 'run \"git\" commit'", false],
  ["P32", "sh -c '\"git\" commit --only a -m y'", false],
  ["P33", "cat <<'X' > /dev/null\n\"git\" commit -m a\nX", false],
  ["P34", "bash -c 'git -C . push origin a:a'", false],
  ["P35", "bash -c 'git push origin a:a'", false],
  ["P36", "git push origin a:a && rm -f x", false],
  ["P37", "true # git push -f origin a:a", false],
]

const formGit10 = (): string => {
  const cfg = formGit6()
    .replace('git_push = "zzz-git-push"', String.raw`git_push = '(?<![\w.-])git\s+push(?![\w-])'`)
    .replace('git_push_ok = "zzz-git-push-ok"', () => String.raw`git_push_ok = '^origin [\w./-]+:[\w./-]+$'`)
    .replace('git_force = "zzz-git-force"', () => String.raw`git_force = '^(?:--force(?:-with-lease(?:=.*)?)?|-f)$'`)
  if (cfg.indexOf("zzz-git-push") >= 0 || cfg.indexOf("zzz-git-force") >= 0) throw new Error("push stub not replaced")
  return cfg
}
for (const [id, cmd, refuse] of PROBE10) {
  test("#494-B1-FIX10 " + id + (refuse ? ": отказ" : ": пропуск"), async () => {
    const r = await formFix5("p10" + id.toLowerCase(), cmd, formGit10())
    const f = gitF6(r)
    expect({ id, refused: f.length > 0, f }).toEqual({ id, refused: refuse, f: refuse ? f : [] })
  })
}

// CONSTRAINT (#497): канон probes.toml больше не несёт ключа `heredoc`; проба
// формы обязана судить без него. Отсутствующий ключ FORM_REQ глушит пробу
// молча (runForm возвращает null) -- поэтому зуб требует ВЕРДИКТ, а не
// отсутствие отказа.
test("#497 Z497 form: мир без ключа `heredoc` -- проба судит `git push` в теле heredoc", async () => {
  const cfg = formGit10().replace(/^heredoc = ".*"\n/m, "")
  expect(cfg.indexOf("heredoc"), "Z497 фикстура без ключа heredoc").toBe(-1)
  const r = await formFix5("z497", "bash <<'X'\ngit push -f origin a:a\nX", cfg)
  const f = gitF6(r)
  expect(f.length > 0, "Z497 push из тела heredoc осуждён").toBe(true)
  expect(r.rows.some((x: any) => x.outcome === "refuse"), "Z497 исход refuse").toBe(true)
})

// CONSTRAINT: next и cp/rm меняют независимый снимок файлов; проверка отката
// сравнивает содержимое, а не факт вызова двери.
async function form510(id: string, command: string, opts: any = {}) {
  await clear393()
  await drainFold393()
  const home = "/probes-510-" + id
  const files: Record<string, string> = { [home + "/probes.toml"]: opts.cfg || formGit10(), ...(opts.files || {}) }
  const proc: string[][] = []
  const dirs = fixtureDirs4_510(opts, files, opts.links), links: any = {}, modes: any = {}, attrs: any = {}
  const m = mod$393({ files, env: { HOME: "/home510", PWD: opts.cwd || "/fix5", CLAUDE_PROBES_DIR: home, CLAUDE_FORM: "1", ...(opts.env || {}) }, now: 510_000_000 })
  m.$.fs.list = async (dir: string) => {
    const prefix = dir.replace(/\/$/, "") + "/"
    const entries = new Map<string, any>()
    for (const path of Object.keys(files).filter(p => p.startsWith(prefix))) {
      const rest = path.slice(prefix.length), name = rest.split("/")[0]
      if (name) entries.set(name, { name, kind: rest.includes("/") ? "dir" : "file", isLink: false })
    }
    if (!entries.size) throw new Error("ENOENT " + dir)
    return [...entries.values()]
  }
  m.$.fs.stat = async (p: string, init: any) => {
    if (!(p in files)) {
      if (dirs.includes(p)) return { kind: 'dir', size: 0, mtimeMs: 42, isLink: false, ...(init?.resolve ? { realPath: p } : {}) }
      throw new Error("ENOENT " + p)
    }
    return { kind: "file", size: opts.large === p ? 4 * 1024 * 1024 + 1 : unescape(encodeURIComponent(files[p])).length, mtimeMs: 42, isLink: false, ...(init?.resolve ? { realPath: p } : {}) }
  }
  const read = m.$.fs.read
  const reads: string[] = [], preReads: string[] = [], postReads: string[] = []
  let afterNext = false
  m.$.fs.read = async (p: string, init: any) => {
    reads.push(p)
    ;(afterNext ? postReads : preReads).push(p)
    if ((opts.unread || []).includes(p)) throw new Error("EACCES " + p)
    const text = await read(p)
    return init?.as === "bytes" ? { base64: bytes510(text) } : text
  }
  m.$.process = { run: async (argv: string[]) => {
    proc.push(argv.slice())
    const dst = argv.at(-1)!
    if (argv[0] === '/bin/cp' && ((opts.failBackup && dst.includes('/form-backup/')) || (opts.failRollback && !dst.includes('/form-backup/')))) return { exitCode: 13, stderr: 'EACCES: directory not writable' }
    if (argv[0] === '/usr/bin/uname') return { exitCode: 0, stdout: 'Linux' }
    if (argv[0] === '/usr/bin/sha256sum') return { exitCode: 0, stdout: sha256hex(files[dst]) + '  ' + dst + '\n' }
    const result = commandModel4_510(argv, files, links, dirs, modes, attrs, 'Linux')
    if (!result) throw new Error('unexpected process command')
    return result
  } }
  let ran = 0
  opts.state = { files, proc }
  if (opts.setup) opts.setup(m, files, proc, () => afterNext)
  const out = await hook393(subs393(), "tool.call")(m.$, { tool: "Bash", command, tool_use_id: id }, async () => {
    afterNext = true
    ran++
    if (opts.materialize) {
      let cursor = command.indexOf("\n") + 1
      const line = command.slice(0, cursor)
      for (const match of line.matchAll(/cat\s+<<([A-Z]+)\s+(>>?)\s+(\S+)/g)) {
        const end = command.indexOf("\n" + match[1], cursor)
        if (end < 0) throw new Error("fixture delimiter missing")
        const body = command.slice(cursor, end + 1)
        const path = "/fix5/" + match[3]
        files[path] = (match[2] === ">>" ? files[path] || "" : "") + body
        // CONSTRAINT: каталог, созданный командой, существует только после next -- регистрация здесь, не при построении фикстуры.
        const parts = path.split("/").filter(Boolean)
        for (let i = 0; i < parts.length; i++) {
          const ancestor = "/" + parts.slice(0, i).join("/")
          if (!dirs.includes(ancestor)) dirs.push(ancestor)
        }
        cursor = end + match[1].length + 2
      }
    }
    Object.assign(files, opts.post || {})
    if (opts.onNext) opts.onNext(files)
    if (opts.throwNext) throw new Error("scripted next failure")
    return { result: { stdout: "done" } }
  })
  const records = formRecordsFinal393(m)
  return { m, reads, preReads, postReads, out, records, rows: formLines393(m.writes), files, proc, ran }
}

const SNAP510 = "/home510/.claude/shell-snapshots/snapshot-zsh-1.sh"
const ALIAS510 = [
  "alias -- g=git", "alias -- gc='git commit --verbose'", "alias -- gpf!='git push --force'",
  "alias -- gwip='git commit --no-verify --message wip'", "alias -- lead='git '",
  "alias -- cm=commit", "alias -- cycle=cycle", "alias -- loopa=loopb", "alias -- loopb=loopa",
  "f510 () {\n git commit -m function\n}",
].join("\n")
const CMD510: Array<[string, string, boolean, string?]> = [
  ["D1-alias-only", "gc --only -m x", false],
  ["D1-alias-refuse", "gc -m x", true, "git commit: нет "],
  ["D1-force", "gpf! origin a:b", true, "git push --force"],
  ["D1-passthrough", "g commit -m x", true, "git commit: нет "],
  ["D1-wip", "gwip", true, "git commit: нет "],
  ["D1-trailing", "lead cm -m x", true, "git commit: нет "],
  ["D1-cycle", "cycle", false],
  ["D1-mutual-cycle", "loopa", false],
  ["D1-function", "f510", true, "git commit: нет "],
  ["D2-static", "A=commit; git $A -m x", true, "git commit: нет "],
  ["D2-bash-split", "A='commit -m x'; git $A", true, "git commit: нет "],
  ["D2-unknown", "git $X", true, "subcommand not static"],
  ["D2-command", "$G commit -m x", true, "git commit: нет "],
  ["D2-prefix", "A=commit git $A --only -m x; git $A", true, "subcommand not static"],
  ["D2-subshell", "A=status; (A=commit); git $A", false],
  ["D2-nested-scope", "A=status; (A=commit; (git $A --only -m x))", false],
  ["D3-group", "git com(mit|X) -m y", true, "git commit: нет "],
  ["D3-group-only", "git (commit|nope) --only -m y", false],
  ["D3-command", "gi? commit -m x", true, "git commit: нет "],
  ["D3-only-glob", "git commit --onl? -m x", true, "git commit: нет "],
  ["D4-extglob", "echo @(a|b) ; git commit -m x", true, "git commit: нет "],
  ["D4-word-group", "echo x(a|b) ; git commit -m x", true, "git commit: нет "],
  ["D5-message-option", "git commit -m --only", true, "git commit: нет "],
  ["D5-nested-message", 'bash -c \'git commit -m "x --only"\'', true, "git commit: нет "],
  ["D5-short", "git commit -o -m x", false],
  ["D5-cluster", "git commit -ao -m x", false],
  ["D5-attached-message", "git commit -mo", true, "git commit: нет "],
  ["D5-end-options", "git commit -m x -- --only", true, "git commit: нет "],
  ["D5-file-stdin", "git commit --only -F - <<'MSG'\nx\nMSG", false],
  ["D5-file", "git commit --only -F msg.txt", false],
  ["D5-reuse", "git commit --only -C HEAD -m x", true, "message undeterminable"],
  ["D5-file-dynamic", "git commit --only -F $P -m x", true, "message undeterminable"],
  ["D5-file-unreadable", "git commit --only -F absent.txt -m x", true, "message undeterminable"],
  ["D5b-cluster", "git push -uf origin a:b", true, "git push -uf"],
  ["D5b-lease", "git push --force-with-lease=x origin a:b", true, "git push --force-with-lease=x"],
  ["D5b-pair", "git push origin a:b", false],
  ["D5b-plus", "git push origin +a:b", true, "git push: нет "],
  ["D9-row1", "A='commit --only -m x'; git $A", false],
  ["D9-row9", "=git commit --only -m x", false],
  ["D9-row10", "git @(commit|X) --only -m x", false],
]
for (const [id, cmd, refuse, detail] of CMD510) {
  test("#510 " + id, async () => {
    const r = await form510(id, cmd, { files: { [SNAP510]: ALIAS510, "/fix5/msg.txt": "message" } })
    const f = gitF6(r)
    expect(f.length > 0, id + ": own F verdict").toBe(refuse)
    if (detail) expect(f.join("\n"), id + ": own reason").toContain(detail)
    if (id === "D1-alias-only") expect(r.rows.some((x: any) => x.outcome === "pass"), "D1 alias judged once").toBe(true)
  })
}

test("#510 D1-values", async () => {
  const r = await form510("values", "gc --only -m x", { files: { [SNAP510]: "alias -- gc='git commit'", "/home510/.claude/shell-snapshots/snapshot-bash-2.sh": "alias -- gc='git push --force'" } })
  expect(gitF6(r).length > 0, "D1 every snapshot value judged").toBe(true)
})
test("#510 D1-bash-function-wrapped", async () => {
  const encoded = "ZmJhc2UgKCkgewogIGdpdCBjb21taXQgLW0geHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4\neHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eAp9Cg=="
  const snapshot = 'eval "$(echo \'' + encoded + '\' | base64 -d)" > /dev/null 2>&1'
  const r = await form510("bash-function-wrapped", "fbase", { files: { "/home510/.claude/shell-snapshots/snapshot-bash-2.sh": snapshot } })
  expect(gitF6(r).length > 0, "D1 wrapped bash function: own F verdict").toBe(true)
})

test("#510 D1-bash-function-unwrapped", async () => {
  const encoded = "ZmJhc2UgKCkgewogIGdpdCBjb21taXQgLW0geHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eAp9Cg=="
  const snapshot = 'eval "$(echo \'' + encoded + '\' | base64 -d)" > /dev/null 2>&1'
  const r = await form510("bash-function-unwrapped", "fbase", { files: { "/home510/.claude/shell-snapshots/snapshot-bash-2.sh": snapshot } })
  expect(gitF6(r).length > 0, "D1 unwrapped bash function: own F verdict").toBe(true)
})
test("#510 D1-bash-function-crlf", async () => {
  const encoded = "ZmJhc2UgKCkgewogIGdpdCBjb21taXQgLW0geHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4\r\neHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eAp9Cg=="
  const snapshot = 'eval "$(echo \'' + encoded + '\' | base64 -d)" > /dev/null 2>&1'
  const r = await form510("bash-function-crlf", "fbase", { files: { "/home510/.claude/shell-snapshots/snapshot-bash-2.sh": snapshot } })
  expect(gitF6(r).length > 0, "D1 CRLF bash function: own F verdict").toBe(true)
})
test("#510 D1-base64-normalization", () => {
  const normalize = (registerModule393 as any).formBase64Payload
  expect(typeof normalize, "D1 base64 normalization helper exists").toBe("function")
  expect(normalize("QU\r\nJD @\t"), "D1 base64 normalization removes only CR/LF").toBe("QUJD @\t")
})
test("#510 D1-bash-function-invalid-symbol", async () => {
  const snapshot = 'eval "$(echo \'ZmJhc2UgKCkgewogIGdpdCBjb21taXQgLW0geAo@KfQ==\' | base64 -d)" > /dev/null 2>&1'
  const path = "/home510/.claude/shell-snapshots/snapshot-bash-2.sh"
  const r = await form510("bash-function-invalid-symbol", "fbase", { files: { [path]: snapshot } })
  expect(gitF6(r), "D1 invalid symbol: function not taken").toEqual([])
  const warnings = r.records.flatMap((record: any) => record.warn || []).filter((warning: any) => warning.c === "form-alias-source-unreadable")
  expect(warnings.length, "D1 invalid symbol: one named warning").toBe(1)
  expect(warnings[0].q, "D1 invalid symbol: source named").toBe("snapshot-bash-2.sh")
})
test("#510 D1-bash-function-decode-failed", async () => {
  const snapshot = 'eval "$(echo \'/w==\' | base64 -d)" > /dev/null 2>&1'
  const r = await form510("bash-function-decode-failed", "fbase", { files: { "/home510/.claude/shell-snapshots/snapshot-bash-2.sh": snapshot } })
  expect(gitF6(r), "D1 decode failure: function not taken").toEqual([])
  const warnings = r.records.flatMap((record: any) => record.warn || []).filter((warning: any) => warning.c === "form-alias-source-unreadable")
  expect(warnings.length, "D1 decode failure: one named warning").toBe(1)
})

test("#510 D1-unreadable", async () => {
  const r = await form510("unreadable", "true", { files: { [SNAP510]: "unreadable" }, unread: [SNAP510] })
  expect(r.records.flatMap((x: any) => x.warn || []).some((x: any) => x.c === "form-alias-source-unreadable"), "D1 unreadable snapshot warning").toBe(true)
})
test("#510 D1-depth", async () => {
  const snapshot = Array.from({ length: 10 }, (_, i) => "alias -- a" + i + "=a" + (i + 1)).join("\n")
  const r = await form510("depth", "a0", { files: { [SNAP510]: snapshot } })
  expect(gitF6(r).join("\n"), "D1 alias depth is refusal").toContain("alias expansion too deep")
})
for (const [id, cmd] of [["D4-segments-ext", "echo @(a|b) ; git commit -m x"], ["D4-segments-group", "echo x(a|b) ; git commit -m x"]]) {
  test("#510 " + id, () => {
    const segments = scan5(cmd).segments().filter((x: any) => cmd.slice(x[0], x[1]).trim())
    expect(segments.length, id + ": two simple commands").toBe(2)
  })
}
const WRITE510: Array<[string, string, string[]]> = [
  ["D6-tee-ai", "tee -ai r/report.md", ["/fix5/r/report.md"]],
  ["D6-tee-append", "tee --append -- r/report.md s/report.md", ["/fix5/r/report.md", "/fix5/s/report.md"]],
  ["D6-tee-p", "tee -p r/report.md", ["/fix5/r/report.md"]],
  ["D6-clobber", "cat >| r/report.md", ["/fix5/r/report.md"]],
  ["D6-all-append", "cat &>> r/report.md", ["/fix5/r/report.md"]],
  ["D6-fd", "cat 2> r/report.md", ["/fix5/r/report.md"]],
  ["D6-glob", "cat > r/repor*.md", ["/fix5/r/report.md"]],
  ["D6-cwd", "cd sub && cat > r/report.md", ["/fix5/sub/r/report.md"]],
]
for (const [id, cmd, paths] of WRITE510) {
  test("#510 " + id, async () => {
    const files: Record<string, string> = {}, post: Record<string, string> = {}
    for (const p of paths) { files[p] = "before\n"; post[p] = TRIG5 }
    const r = await form510(id, cmd, { files, post })
    for (const p of paths) expect(refusedOn5(r, "Bash:" + p), id + ": own target " + p).toBe(true)
  })
}
test("#510 D6-dynamic-cwd", async () => {
  const r = await form510("dynamic-cwd", "cd $D && cat > r/report.md")
  expect(r.records.flatMap((x: any) => x.warn || []).some((x: any) => x.c === "form-cwd-unknown"), "D6 unknown cwd warning").toBe(true)
})
test("#510 D6-group-target", async () => {
  const fn = (registerModule393 as any).formTargets
  expect(typeof fn, "D6 target lexer export").toBe("function")
  const targets = await fn({ fs: { list: async () => [{ name: "readme.mdN", kind: "file" }] } }, "echo hi > readme.md(N)", "/fix5", "/home510")
  expect(targets.map((x: any) => x.path), "D6 zsh grouped filename resolved").toContain("/fix5/readme.mdN")
})
const CANCEL510 = () => formGit10() + '\n[probe.form.act]\nC1 = "cancel"\nA1 = "cancel"\nF = "cancel"\n'
for (const created of [false, true]) {
  test("#510 D7-rollback-" + (created ? "new" : "existing"), async () => {
    const path = "/fix5/r/report.md", before = "original\u0000bytes\r\n"
    const r = await form510("rollback-" + created, "cat src > r/report.md", { cfg: CANCEL510(), files: created ? {} : { [path]: before }, post: { [path]: TRIG5 } })
    expect(typeof r.out.deny, "D7 model reads deny after rollback").toBe("string")
    expect(r.files[path], "D7 byte-exact old state").toBe(created ? undefined : before)
    expect(Object.keys(r.files).filter(p => p.includes("/form-backup/")), "D7 copies removed").toEqual([])
  })
}
test("#510 D7-log-only", async () => {
  const path = "/fix5/r/report.md"
  const r = await form510("log-only", "cat src > r/report.md", { files: { [path]: "before" }, post: { [path]: TRIG5 } })
  expect(r.files[path], "D7 log_only does not roll back").toBe(TRIG5)
  expect(refusedOn5(r, "Bash:" + path), "D7 actual contents recorded").toBe(true)
  expect(Object.keys(r.files).filter(p => p.includes("/form-backup/")), "D7 cleanup log_only").toEqual([])
})
test("#510 D7-log-only-with-backup", async () => {
  const path = "/fix5/r/report.md"
  const command = "cat src > r/report.md"
  const cfg = formGit10() + '\n[probe.form.act]\nF = "cancel"\n'
  const r = await form510("log-only-with-backup", command, { cfg, files: { [path]: "before" }, post: { [path]: TRIG5 } })
  const classes = [...new Set(r.records.flatMap((x: any) => x.refuse || []).filter((x: any) => x.src === "Bash:" + path).map((x: any) => x.c))].sort()
  expect(classes, "D7 log_only backup refusal classes are exactly C1").toEqual(["C1"])
  expect(r.files[path], "D7 log_only class does not roll back even with a backup").toBe(TRIG5)
  expect(refusedOn5(r, "Bash:" + path), "D7 log_only backup actual contents recorded").toBe(true)
  expect(Object.keys(r.files).filter(p => p.includes("/form-backup/")), "D7 log_only backup copies removed").toEqual([])
  const cancel = await form510("log-only-with-backup-cancel", command, { cfg: cfg + 'C1 = "cancel"\n', files: { [path]: "before" }, post: { [path]: TRIG5 } })
  expect(cancel.files[path], "D7 cancel class reaches actual rollback with the same backup input").toBe("before")
  expect(Object.keys(cancel.files).filter(p => p.includes("/form-backup/")), "D7 cancel backup copies removed").toEqual([])
})
test("#510 D7-exact-heredoc", async () => {
  const r = await form510("exact-heredoc", "cat > r/report.md <<'END'\n" + TRIG5 + "\nEND", { cfg: CANCEL510() })
  expect(r.ran, "D7 exact heredoc denied before next").toBe(0)
  expect(typeof r.out.deny, "D7 pre-execution deny").toBe("string")
})
test("#510 D7-backup-failed", async () => {
  const r = await form510("backup-failed", "cat src > r/report.md", { cfg: CANCEL510(), files: { "/fix5/r/report.md": "before" }, failBackup: true })
  expect(r.ran, "D7 cannot execute without backup").toBe(0)
  expect(String(r.out.deny), "D7 unwritable backup directory").toContain("form-backup-failed")
})
test("#510 D7-rollback-failed", async () => {
  const r = await form510("rollback-failed", "cat src > r/report.md", { cfg: CANCEL510(), files: { "/fix5/r/report.md": "before" }, post: { "/fix5/r/report.md": TRIG5 }, failRollback: true })
  expect(String(r.out.deny), "D7 failed restoration is explicit").toContain("rollback failed:")
})
test("#510 D7-too-large", async () => {
  const path = "/fix5/r/report.md"
  const r = await form510("too-large", "cat src > r/report.md", { cfg: CANCEL510(), files: { [path]: "before" }, post: { [path]: TRIG5 }, large: path })
  expect(r.records.flatMap((x: any) => x.refuse || []).map((x: any) => x.q).join("\n"), "D7 actual file size gate").toContain("target too large to judge")
})

test("#510 D7c F2 mirror: second append reaches actual judgment", async () => {
  const path = "/fix5/r/report.md"
  const cmd = "cat <<A >> r/report.md ; cat <<B >> r/report.md\nok\nA\n" + TRIG5 + "\nB"
  const r = await form510("f2-mirror", cmd, { cfg: CANCEL510(), files: { [path]: "old\n" }, materialize: true })
  expect(refusedOn5(r, "Bash:" + path), "D7c mirror: second body judged").toBe(true)
  expect(typeof r.out.deny, "D7c mirror: model receives denial").toBe("string")
  expect(r.files[path], "D7c mirror: both appends rolled back").toBe("old\n")
})

test("#510 D7a L11 mirror: append owns its body", async () => {
  const before = "original\u0000bytes\r\n"
  const cmd = "cat <<A >> r/report.md ; cat <<B > a/notes.md\n" + TRIG5 + "\nA\nok\nB"
  const r = await form510("l11-mirror", cmd, { cfg: CANCEL510().replace('report_path = "report[.]md$"', 'report_path = "(report|notes)[.]md$"'), files: { "/fix5/r/report.md": before }, materialize: true })
  expect(refusedOn5(r, "Bash:/fix5/r/report.md"), "D7a A: own append refusal").toBe(true)
  expect(refusedOn5(r, "Bash:/fix5/a/notes.md"), "D7a A: no cross-body refusal").toBe(false)
  expect(r.files["/fix5/r/report.md"], "D7a A: byte-exact rollback").toBe(before)
  expect(r.files["/fix5/a/notes.md"], "D7a A: ordinary body survives").toBe("ok\n")
  expect(typeof r.out.deny, "D7a A: result denied").toBe("string")
})
test("#510 D7 exception cleanup", async () => {
  const opts: any = { cfg: CANCEL510(), files: { "/fix5/r/report.md": "before" }, throwNext: true }
  let thrown = ""
  try { await form510("exception", "cat src > r/report.md", opts) } catch (x) { thrown = String(x) }
  expect(thrown, "D7 next exception propagated").toContain("scripted next failure")
  expect(opts.state.proc.some((argv: string[]) => argv[0] === "/bin/cp"), "D7 exception test had a backup").toBe(true)
  expect(Object.keys(opts.state.files).filter(p => p.includes("/form-backup/")), "D7 finally removed backup").toEqual([])
})

const FIX2_COMMAND510: Array<[string, string, boolean, string?]> = [
  ["F1-u", "git commit -uno -m x", true],
  ["F1-au", "git commit -auno -m x", true],
  ["F1-S", "git commit -So -m x", true],
  ["F1-only-u", "git commit -o -u -m x", false],
  ["F2-editor", "git commit --only", true, "message undeterminable"],
  ["F2-e", "git commit -o -e -m x", true, "message undeterminable"],
  ["F2-t", "git commit -o -t template", true, "message undeterminable"],
  ["F2-amend", "git commit -o --amend", true, "message undeterminable"],
  ["F2-fixup", "git commit -o --fixup HEAD -m x", true, "message undeterminable"],
  ["F2-fixup-eq", "git commit -o --fixup=amend:HEAD -m x", true, "message undeterminable"],
  ["F2-squash", "git commit -o --squash HEAD -m x", true, "message undeterminable"],
  ["F2-squash-eq", "git commit -o --squash=HEAD -m x", true, "message undeterminable"],
  ["F2-amend-static", "git commit -o --amend -m x", false],
  ["F5-delete-ref", "git push origin a:b :d", true],
  ["F5-force-ref", "git push origin a:b +c:d", true],
  ["F5-mirror", "git push --mirror origin", true],
  ["F5-delete", "git push --delete origin x", true],
  ["F5-all", "git push --all origin a:b", true],
  ["F5-tags", "git push --tags origin a:b", true],
]
for (const [id, command, refused, reason] of FIX2_COMMAND510) test("#510 FIX2 " + id, async () => {
  const r = await form510("fix2-" + id, command)
  expect(gitF6(r).length > 0, id + " own verdict").toBe(refused)
  if (reason) expect(gitF6(r).join("\n"), id + " own reason").toContain(reason)
})
test("#510 FIX2 F6 trailing chain", async () => {
  const r = await form510("fix2-chain", "lead mid tail -m x", { files: { [SNAP510]: "alias -- lead='git '\nalias -- mid=' '\nalias -- tail=commit" } })
  expect(gitF6(r).length > 0, "F6 own verdict").toBe(true)
})
test("#510 FIX2 F7 config snapshot", async () => {
  const r = await form510("fix2-config", "custom -m x", { env: { CLAUDE_CONFIG_DIR: "/custom510" }, files: { "/custom510/shell-snapshots/snapshot-zsh-1.sh": "alias -- custom='git commit'" } })
  expect(gitF6(r).length > 0, "F7 own verdict").toBe(true)
})
test("#510 FIX2 F8 git cwd cumulative", async () => {
  const text = "x\nSession: s\nintervening\nCo-Authored-By: c\n"
  const r = await form510("fix2-gitcwd", "git -C a -C b commit -o -F msg", { files: { "/fix5/a/b/msg": text, "/fix5/msg": "ordinary" } })
  expect(gitF6(r).join("\n"), "F8 judged cumulative file").toContain("не соседние")
})
for (const op of [">>!", "2>>!", "&>>!", "&>!"]) test("#510 FIX2 F3 " + op, async () => {
  const path = "/fix5/r/report.md"
  const r = await form510("fix2-redirect-" + op, "cat src " + op + " r/report.md", { cfg: CANCEL510(), files: { [path]: "old" }, post: { [path]: TRIG5 } })
  expect(typeof r.out.deny, "F3 own denial " + op).toBe("string")
  expect(r.files[path], "F3 own restoration " + op).toBe("old")
})
for (const option of ["--", "-P", "-L", "-q", "-s"]) test("#510 FIX2 F9 cd " + option, async () => {
  const path = "/fix5/sub/r/report.md"
  const r = await form510("fix2-cd-" + option, "cd " + option + " sub; cat src > r/report.md", { cfg: CANCEL510(), files: { [path]: "old" }, post: { [path]: TRIG5 } })
  expect(typeof r.out.deny, "F9 own denial " + option).toBe("string")
  expect(r.files[path], "F9 own restoration " + option).toBe("old")
})
for (const command of ["cd; cat src > r/report.md", "cd -; cat src > r/report.md"]) test("#510 FIX2 F9 unknown " + command, async () => {
  const r = await form510("fix2-unknown-cd", command)
  expect(r.records.flatMap((x: any) => x.warn || []).map((x: any) => x.c), "F9 named unknown cwd").toContain("form-cwd-unknown")
})
test("#510 FIX2 F4 pipeline isolated", async () => {
  const path = "/fix5/r/report.md"
  const r = await form510("fix2-pipe-base", "cd sub | cat src > r/report.md", { cfg: CANCEL510(), files: { [path]: "old" }, post: { [path]: TRIG5 } })
  expect(r.files[path], "F4 base target restored").toBe("old")
  expect(typeof r.out.deny, "F4 base refusal").toBe("string")
})
test("#510 FIX2 F4 pipeline union", async () => {
  const a = "/fix5/r/report.md", b = "/fix5/sub/r/report.md"
  const r = await form510("fix2-pipe-union", "cat x | cd sub; cat src > r/report.md", { cfg: CANCEL510(), files: { [a]: "old-a", [b]: "old-b" }, post: { [a]: TRIG5, [b]: TRIG5 } })
  expect(r.files[a], "F4 bash candidate restored").toBe("old-a")
  expect(r.files[b], "F4 zsh candidate restored").toBe("old-b")
})
test("#510 FIX2 F10 stderr heredoc", async () => {
  const path = "/fix5/r/report.md"
  const r = await form510("fix2-stderr", "cat 2> r/report.md <<'END'\n" + TRIG5 + "\nEND", { cfg: CANCEL510(), post: { [path]: "" } })
  expect(r.ran, "F10 next runs").toBe(1)
  expect(r.files[path], "F10 actual empty target").toBe("")
  expect(r.out.deny, "F10 no pre-denial").toBe(undefined)
})
for (const target of ["$FILE", "`target`", "$(target)"]) test("#510 FIX2 F11 dynamic " + target, async () => {
  const r = await form510("fix2-dynamic", "cat src > " + target)
  expect(r.records.flatMap((x: any) => x.warn || []).map((x: any) => x.c), "F11 named dynamic target " + target).toContain("form-target-dynamic")
})
for (const [id, command] of [
  ["cp", "cp src r/report.md"], ["cp-t", "cp -t r src/report.md"], ["cp-long", "cp --target-directory=r src/report.md"],
  ["mv", "mv -- src r/report.md"], ["install", "install -m 644 src r/report.md"], ["dd", "dd if=src of=r/report.md"],
  ["sed", "sed -i 's/a/b/' r/report.md"], ["sed-long", "sed --in-place=.bak -e 's/a/b/' -- r/report.md"],
  ["perl", "perl -i -pe 's/a/b/' r/report.md"], ["truncate", "truncate -s 0 -- r/report.md"], ["ln", "ln -sf src r/report.md"],
]) test("#510 FIX2 F21 writer " + id, async () => {
  const path = "/fix5/r/report.md"
  const r = await form510("fix2-writer-" + id, command, { cfg: CANCEL510(), files: { [path]: "old" }, post: { [path]: TRIG5 } })
  expect(typeof r.out.deny, "F21 own denial " + id).toBe("string")
  expect(r.files[path], "F21 own restoration " + id).toBe("old")
})
test("#510 FIX2 F22 canon missing", async () => {
  const r = await form510("fix2-canon", "echo x", { cfg: CANCEL510().replace(/^write_target = .*\n/m, "") })
  expect(r.records.flatMap((x: any) => x.refuse || []).map((x: any) => x.q).join("\n"), "F22 missing key named").toContain("form-canon-key-missing write_target")
  expect(typeof r.out.deny, "F22 actionable missing canon").toBe("string")
})

function bytes510(text: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const bytes = Array.from(unescape(encodeURIComponent(text))).map(c => c.charCodeAt(0))
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
    out += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63] + (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : "=") + (i + 2 < bytes.length ? alphabet[n & 63] : "=")
  }
  return out
}
function ioFix2_510(opts: any): any {
  const links = { ...(opts.links || {}) }, attrs = { ...(opts.attrs || {}) }, modes: any = {}
  opts.io = { links, attrs, modes }
  opts.setup = (m: any, files: any, proc: any, post: () => boolean) => {
    const normalize = (path: string) => {
      const parts: string[] = []
      for (const part of path.split("/")) { if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part) }
      return "/" + parts.join("/")
    }
    const referent = (p: string): string => {
      for (let i = 0; i < 32 && p in links; i++) p = normalize(links[p].startsWith("/") ? links[p] : p.slice(0, p.lastIndexOf("/") + 1) + links[p])
      return p
    }
    const dirs = fixtureDirs4_510(opts, files, links)
    const oldRead = m.$.fs.read, oldWrite = m.$.fs.write
    let interleaved = false
    m.$.fs.read = async (p: string, init: any) => {
      if (post() && opts.unreadRead && p === "/fix5/r/report.md") throw new Error("EACCES read " + p)
      const real = referent(p)
      if (init?.as === "bytes") return { base64: bytes510(await oldRead(real)) }
      return oldRead(real)
    }
    m.$.fs.stat = async (p: string, init: any) => {
      if (post() && opts.unreadStat && p === "/fix5/r/report.md") throw new Error("EACCES stat " + p)
      const real = referent(p)
      if (dirs.includes(real)) return { kind: 'dir', size: 0, mtimeMs: 42, isLink: p in links, ...(init?.resolve ? { realPath: real } : {}) }
      if (!(real in files) && !(p in links)) throw new Error('ENOENT ' + p)
      return { kind: real in files ? 'file' : 'other', size: opts.sizes?.[p] || (files[real] ? unescape(encodeURIComponent(files[real])).length : 0), mtimeMs: 42, isLink: p in links, ...(init?.resolve && real in files ? { realPath: real } : {}) }
    }
    m.$.fs.write = async (p: string, text: any) => {
      const result = await oldWrite(p, text)
      if (post() && p.includes("/form/records/") && opts.interleave && !interleaved) { interleaved = true; opts.interleave(files, links) }
      return result
    }
    if (!m.$.process) m.$.process = {}
    m.$.process.run = async (argv: string[]) => {
      proc.push(argv.slice())
      const dst = argv[argv.length - 1]
      if (argv[0] === "/usr/bin/uname") return { exitCode: 0, stdout: opts.platform || "Linux" }
      if (argv[0] === "/usr/bin/readlink") return dst in links ? { exitCode: 0, stdout: links[dst] + "\n" } : { exitCode: 1, stdout: "" }
      if (argv[0] === '/bin/mkdir' && opts.failMkdir) return { exitCode: 1 }
      if (argv[0] === '/bin/cp' && opts.failBackup && dst.includes('/form-backup/')) return { exitCode: 13 }
      if (argv[0] === '/usr/bin/sha256sum' || argv[0] === '/usr/bin/shasum') return { exitCode: 0, stdout: sha256hex(files[referent(dst)]) + '  ' + dst + '\n' }
      const result = commandModel4_510(argv, files, links, dirs, modes, attrs, opts.platform || 'Linux')
      if (!result) throw new Error('FIX2 fixture unexpected command ' + argv[0])
      return result
    }
    opts.state.m = m
  }
  return opts
}
for (const [id, unreadStat, changed, warning] of [
  ["F12a-a", false, false, ""], ["F12a-b", true, false, "form-rollback-skipped-unfingerprintable"],
  ["F12a-c", false, true, "form-rollback-skipped-changed"],
] as Array<[string, boolean, boolean, string]>) test("#510 FIX2 " + id, async () => {
  const path = "/fix5/r/report.md", opts = ioFix2_510({ cfg: CANCEL510(), files: { [path]: "old" }, post: { [path]: TRIG5 }, unreadRead: true, unreadStat,
    interleave: changed ? (files: any) => { files[path] = "external-size-changed" } : undefined })
  const r = await form510(id, "cat src > r/report.md", opts)
  expect(typeof r.out.deny, id + " denies unreadable post").toBe("string")
  expect(r.files[path], id + " compare restore result").toBe(changed ? "external-size-changed" : unreadStat ? TRIG5 : "old")
  if (warning) expect(r.rows.map((x: any) => JSON.stringify(x)).join("\n"), id + " named skipped record").toContain(warning)
})
test("#510 FIX2 F13 exception restoration", async () => {
  const path = "/fix5/r/report.md", opts = ioFix2_510({ cfg: CANCEL510(), files: { [path]: "old" }, post: { [path]: TRIG5 }, throwNext: true })
  let error = ""
  try { await form510("fix2-exception", "cat src > r/report.md", opts) } catch (x) { error = String(x) }
  expect(error, "F13 original exception propagated").toContain("scripted next failure")
  expect(opts.state.files[path], "F13 bytes restored before cleanup").toBe("old")
})
for (const fresh of [false, true]) test("#510 FIX2 F15 changed " + (fresh ? "new" : "existing"), async () => {
  const path = "/fix5/r/report.md", changed = TRIG5.replace("zzz", "xxx")
  const r = await form510("fix2-change-" + fresh, "cat src > r/report.md", ioFix2_510({ cfg: CANCEL510(), files: fresh ? {} : { [path]: "old" }, post: { [path]: TRIG5 }, interleave: (files: any) => { files[path] = changed } }))
  expect(typeof r.out.deny, "F15 denial remains").toBe("string")
  expect(r.files[path], "F15 different bytes same size mtime untouched").toBe(changed)
  expect(r.rows.map((x: any) => JSON.stringify(x)).join("\n"), "F15 named changed record").toContain("form-rollback-skipped-changed")
})
test("#510 FIX2 F14 dangling link", async () => {
  const path = "/fix5/r/report.md", real = "/fix5/r/original.md", opts = ioFix2_510({ cfg: CANCEL510(), links: { [path]: "original.md" }, post: { [real]: TRIG5 } })
  const r = await form510("fix2-dangling", "cat src > r/report.md", opts)
  expect(r.ran, "F14 dangling write actually materialized").toBe(1)
  expect(typeof r.out.deny, "F14 dangling denial").toBe("string")
  expect(opts.io.links[path], "F14 original link survives").toBe("original.md")
  expect(r.files[real], "F14 absent original referent restored").toBe(undefined)
})
test("#510 FIX2 F14 retarget link", async () => {
  const path = "/fix5/r/report.md", real = "/fix5/r/original.md", other = "/fix5/r/other.md"
  const opts: any = { cfg: CANCEL510(), links: { [path]: "original.md" }, files: { [real]: "original", [other]: "other" }, post: { [other]: TRIG5 } }
  ioFix2_510(opts)
  opts.onNext = () => { opts.io.links[path] = "other.md" }
  const r = await form510("fix2-retarget", "cat src > r/report.md", opts)
  expect(typeof r.out.deny, "F14 retarget denial").toBe("string")
  expect(r.proc.some(argv => argv[0] === "/bin/ln" && argv[argv.length - 2] === "original.md" && argv[argv.length - 1] === path), "F14 retarget restore branch").toBe(true)
  expect(warnings3_510(r), "F14 retarget readable referent").not.toContain("form-rollback-skipped-unfingerprintable")
  expect(opts.io.links[path], "F14 original link restored").toBe("original.md")
  expect(r.files[real], "F14 original referent bytes").toBe("original")
  expect(r.files[other], "F14 no old bytes into different referent").toBe(TRIG5)
})
for (const platform of ["Linux", "Darwin"]) test("#510 FIX2 F16 attributes " + platform, async () => {
  const path = "/fix5/r/report.md", opts = ioFix2_510({ cfg: CANCEL510(), platform, files: { [path]: "old" }, attrs: { [path]: { "user.form510": "old-attribute" } }, post: { [path]: TRIG5 } })
  opts.onNext = () => { opts.io.attrs[path] = { "user.form510": "new-attribute" } }
  await form510("fix2-attrs-" + platform, "cat src > r/report.md", opts)
  expect(opts.io.attrs[path], "F16 attributes restored " + platform).toEqual({ "user.form510": "old-attribute" })
})
test("#510 FIX2 F17 private copies", async () => {
  const path = "/fix5/r/report.md", opts = ioFix2_510({ cfg: CANCEL510(), files: { [path]: "old" } })
  const r = await form510("fix2-private", "cat src > r/report.md", opts)
  expect(r.proc.some(argv => argv[0] === "/bin/mkdir" && argv.includes("700")), "F17 directory explicitly private").toBe(true)
  expect(Object.values(opts.io.modes).every(mode => mode === "700"), "F17 modes private").toBe(true)
})
test("#510 FIX2 F17 mkdir failure", async () => {
  const path = "/fix5/r/report.md", r = await form510("fix2-mkdir", "cat src > r/report.md", ioFix2_510({ cfg: CANCEL510(), files: { [path]: "old" }, failMkdir: true }))
  expect(r.ran, "F17 checked mkdir status").toBe(0)
  expect(String(r.out.deny), "F17 mkdir exit named").toContain("mkdir exit")
  expect(r.proc.some((argv: string[]) => argv[0] === "/bin/chmod"), "F17 no chmod after mkdir failure").toBe(false)
  expect(String(r.out.deny), "F17 named backup failure").toContain("form-backup-failed")
})
test("#510 FIX2 F18 log only no copy", async () => {
  const path = "/fix5/r/report.md", r = await form510("fix2-logonly", "cat src > r/report.md", ioFix2_510({ files: { [path]: "old" }, post: { [path]: TRIG5 }, failBackup: true }))
  expect(r.ran, "F18 log only runs despite copy refusal").toBe(1)
  expect(r.proc.filter(argv => argv[0] === "/bin/cp"), "F18 no copies for log only").toEqual([])
  expect(refusedOn5(r, "Bash:" + path), "F18 post judgment still observed").toBe(true)
})
for (const logOnly of [false, true]) test("#510 FIX2 F20 paths " + logOnly, async () => {
  const files: any = {}
  for (let i = 0; i < 257; i++) files["/fix5/r/" + i + "/report.md"] = "old"
  const r = await form510("fix2-path-cap-" + logOnly, "cat src > r/*/report.md", { cfg: logOnly ? formGit10() : CANCEL510(), files })
  expect(r.ran, "F20 candidate cap next action").toBe(logOnly ? 1 : 0)
  expect(gitF6(r).join("\n"), "F20 path cap named").toContain("form-fanout-exceeded")
})
test("#510 FIX2 F20 variants", async () => {
  const files: any = {}
  for (let i = 0; i < 65; i++) files["/home510/.claude/shell-snapshots/snapshot-zsh-cap" + i + ".sh"] = "alias -- fan='echo " + i + "'"
  const r = await form510("fix2-variant-cap", "fan", { cfg: CANCEL510(), files })
  expect(r.ran, "F20 variant cap before next").toBe(0)
  expect(gitF6(r).join("\n"), "F20 variant cap named").toContain("form-fanout-exceeded")
})
test("#510 FIX2 F20 backup volume", async () => {
  const files: any = {}, sizes: any = {}, commands: string[] = []
  for (let i = 0; i < 9; i++) { const path = "/fix5/r/" + i + "/report.md"; files[path] = "old"; sizes[path] = 4 * 1024 * 1024; commands.push("cat src > r/" + i + "/report.md") }
  const r = await form510("fix2-backup-cap", commands.join("; "), ioFix2_510({ cfg: CANCEL510(), files, sizes }))
  expect(r.ran, "F20 volume cap before next").toBe(0)
  expect(r.out.deny, "F20 volume cap named").toContain("form-backup-failed")
  expect(r.out.deny, "F20 volume cap reason").toContain("backup volume exceeded")
})

test("#510 FIX2 F19 post observer", async () => {
  const path = "/fix5/r/report.md", calls: any[] = []
  const opts = ioFix2_510({ cfg: CANCEL510() + '\n[probe.after510]\non = ["PostToolUse"]\nact = "log_only"\nmodels = ["mock510"]\nshow = ["tool"]\n', files: { [path]: "old", "/probes-510-fix2-after/after510/prompt.md": "Observe tool result." }, post: { [path]: TRIG5 } })
  const setup = opts.setup
  opts.setup = (...args: any[]) => { setup(...args); args[0].$.model.complete = async (request: any) => { calls.push(request); return "OK: observed" } }
  const r = await form510("fix2-after", "cat src > r/report.md", opts)
  await settle393()
  expect(typeof r.out.deny, "F19 form still denies").toBe("string")
  expect(calls.length, "F19 other post observer sees result").toBe(1)
})

test("#510 FIX2 F21 directory operands", async () => {
  let cfg = CANCEL510()
  const targetKey = String.raw`write_target = '\.md$'`, reportKey = 'report_path = "report[.]md$"'
  expect(cfg.split(targetKey).length - 1, "F21 directory write_target anchor exactly once").toBe(1)
  cfg = cfg.replace(targetKey, () => String.raw`write_target = '/[ab]$'`)
  expect(cfg.split(reportKey).length - 1, "F21 directory report_path anchor exactly once").toBe(1)
  cfg = cfg.replace(reportKey, () => String.raw`report_path = '/[ab]$'`)
  const opts = ioFix2_510({ cfg, files: { "/fix5/r/a": "old", "/fix5/r/b": "old" }, post: { "/fix5/r/a": TRIG5 } })
  const setup = opts.setup
  opts.setup = (...args: any[]) => {
    setup(...args)
    const stat = args[0].$.fs.stat
    args[0].$.fs.stat = async (path: string, init: any) => path === "/fix5/r" ? { kind: "dir", size: 0, mtimeMs: 42, isLink: false, ...(init?.resolve ? { realPath: path } : {}) } : stat(path, init)
  }
  const r = await form510("fix2-directory", "cp a b r/", opts)
  expect(r.reads, "F21 directory child a candidate").toContain("/fix5/r/a")
})
test("#510 FIX2 F12b absent glob literal", async () => {
  const r = await form510("fix2-absent-glob", "cat src > r/*/report.md", { cfg: CANCEL510(), files: { "/fix5/r/a/report.md": "ordinary" } })
  expect(gitF6(r).join("\n"), "F12b absent literal is not unreadable").not.toContain("target unreadable after write")
  expect(r.out.deny, "F12b unchanged absence has no judgment").toBe(undefined)
})
for (const link of [false, true]) test("#510 FIX2 F12b deletion " + (link ? "link" : "file"), async () => {
  const path = "/fix5/r/report.md", real = link ? "/fix5/r/original.md" : path
  const opts = ioFix2_510({ cfg: CANCEL510(), files: { [real]: "old" }, links: link ? { [path]: "original.md" } : {} })
  opts.onNext = (files: any) => { if (link) delete opts.io.links[path]; else delete files[path] }
  const r = await form510("fix2-deletion-" + link, "cat src > r/report.md", opts)
  expect(typeof r.out.deny, "F12b deletion denies").toBe("string")
  expect(gitF6(r).join("\n"), "F12b deletion is not unreadable").not.toContain("target unreadable after write")
  expect(r.files[real], "F12b deletion restores bytes").toBe("old")
  if (link) expect(opts.io.links[path], "F12b deletion restores link").toBe("original.md")
})
test("#510 FIX2 F22 once per module", async () => {
  const logs: string[] = []
  const r = await form510("fix2-canon-once", "echo x", {
    cfg: CANCEL510().replace(/^trailer_a = .*\n/m, ""),
    setup: (m: any) => { m.$.ui.log = async (text: string) => { logs.push(text) } },
  })
  const second = await hook393(subs393(), "tool.call")(r.m.$, { tool: "Bash", command: "echo y" }, async () => ({}))
  expect(typeof r.out.deny, "F22 first missing key denies").toBe("string")
  expect(typeof second.deny, "F22 second missing key denies").toBe("string")
  expect(logs.filter(text => text === "form-canon-key-missing trailer_a").length, "F22 exactly one module log").toBe(1)
})
test("#510 FIX2 F14 two-level link", async () => {
  const path = "/fix5/r/report.md", middle = "/fix5/r/middle.md", real = "/fix5/r/original.md", other = "/fix5/r/other.md"
  const opts = ioFix2_510({ cfg: CANCEL510(), links: { [path]: "middle.md", [middle]: "original.md" }, files: { [real]: "old", [other]: "other" }, post: { [other]: TRIG5 } })
  opts.onNext = () => { opts.io.links[middle] = "other.md" }
  const r = await form510("fix2-two-level", "cat src > r/report.md", opts)
  expect(r.ran, "F14 two-level write runs").toBe(1)
  expect(typeof r.out.deny, "F14 two-level denies actual referent").toBe("string")
  expect(r.proc.some(argv => argv[0] === "/bin/ln" && argv[argv.length - 2] === "middle.md" && argv[argv.length - 1] === path), "F14 two-level restore branch").toBe(true)
  expect(warnings3_510(r), "F14 two-level readable referent").not.toContain("form-rollback-skipped-unfingerprintable")
  expect(opts.io.links[middle], "F14 two-level changed middle remains external").toBe("other.md")
  expect(opts.io.links[path], "F14 two-level original link spelling").toBe("middle.md")
  expect(r.files[real], "F14 two-level original terminal bytes").toBe("old")
  expect(r.files[other], "F14 two-level different referent untouched").toBe(TRIG5)
})

test("#510 FIX4 F14 equal-size retarget", async () => {
  const path = "/fix5/r/report.md", real = "/fix5/r/original.md", other = "/fix5/r/other.md", original = "originalABCD"
  expect(original.length, "F14 equal-size fixture").toBe(TRIG5.length)
  const opts = ioFix2_510({ cfg: CANCEL510(), links: { [path]: "original.md" }, files: { [real]: original, [other]: "other" }, post: { [other]: TRIG5 } })
  const setup = opts.setup, independent: string[] = []
  opts.setup = (...args: any[]) => {
    setup(...args)
    const read = args[0].$.fs.read
    args[0].$.fs.read = async (p: string, init: any) => {
      if (args[3]() && p === real && init?.as === "bytes") independent.push(p)
      return read(p, init)
    }
  }
  opts.onNext = () => { opts.io.links[path] = "other.md" }
  const r = await form510("fix4-equal-retarget", "cat src > r/report.md", opts)
  expect(typeof r.out.deny, "F14 equal-size denial").toBe("string")
  expect(independent.length > 0, "F14 equal-size independent referent read").toBe(true)
  expect(r.proc.some(argv => argv[0] === "/bin/ln" && argv[argv.length - 2] === "original.md" && argv[argv.length - 1] === path), "F14 equal-size restore branch").toBe(true)
  expect(warnings3_510(r), "F14 equal-size readable referent").not.toContain("form-rollback-skipped-unfingerprintable")
  expect(opts.io.links[path], "F14 equal-size original link restored").toBe("original.md")
  expect(r.files[real], "F14 equal-size original bytes").toBe(original)
  expect(r.files[other], "F14 equal-size other bytes unchanged").toBe(TRIG5)
})

function ioFix3_510(opts: any): any {
  ioFix2_510(opts)
  const setup = opts.setup
  opts.setup = (m: any, files: any, proc: any, post: () => boolean) => {
    setup(m, files, proc, post)
    const stat = m.$.fs.stat, read = m.$.fs.read, run = m.$.process.run, write = m.$.fs.write
    const map = (p: string) => opts.prefix ? p.replace(/^\/fix5\/d(?=\/|$)/, '/fix5/' + opts.prefix.dir) : p
    m.$.fs.stat = async (p: string, init: any) => {
      if (opts.dirs?.includes(p) || Object.keys(files).some(t => t.startsWith(map(p).replace(/\/$/, '') + '/'))) return { kind: 'dir', size: 0, mtimeMs: 42, isLink: false, ...(init?.resolve ? { realPath: map(p + '/').replace(/\/$/, '') } : {}) }
      const result = await stat(map(p), init)
      return post() && opts.sizes?.[p] === 4194304 ? { ...result, size: unescape(encodeURIComponent(files[map(p)])).length } : result
    }
    m.$.fs.read = (p: string, init: any) => read(map(p), init)
    m.$.fs.write = async (p: string, text: any) => { files[p] = String(text); return write(p, text) }
    m.$.process.run = async (argv: string[]) => {
      const v = argv.map(map), dst = v.at(-1)!, src = v.at(-2)!
      if (v[0] === '/bin/mv' && opts.failMove) { proc.push(v.slice()); return { exitCode: 1 } }
      if (v[0] === '/usr/bin/sha256sum' || v[0] === '/usr/bin/shasum') {
        proc.push(v.slice())
        if (opts.throwHash) throw new Error('scripted hash command refusal')
        return { exitCode: opts.failHash ? 1 : 0, stdout: opts.badHash ? 'invalid' : sha256hex(files[dst]) + '  ' + dst + '\n' }
      }
      if (v[0] === '/bin/chmod' && opts.failChmod) { proc.push(v.slice()); return { exitCode: 1 } }
      if (v[0] === '/bin/cp' && opts.failPreserve && (v.includes('--preserve=all') || v.includes('-p'))) { proc.push(v.slice()); return { exitCode: 1 } }
      if (v[0] === '/bin/cp' && opts.failRestoreCopy && dst.includes('.form-restore.')) { proc.push(v.slice()); files[dst] = 'partial'; return { exitCode: 1 } }
      return run(v)
    }
  }
  return opts
}
const warnings3_510 = (r: any) => r.records.flatMap((x: any) => x.warn || []).map((x: any) => x.q).join('\n')
const final3_510 = (r: any) => {
  const path = r.m.writes.filter((w: any) => w.path.includes('/form/records/')).at(-1)?.path
  return path ? JSON.parse(r.files[path]) : null
}
test('#510 FIX3 G1 terminal-link', async () => {
  const p = '/fix5/r/report.md', a = '/fix5/r/original.md', b = '/fix5/r/other.md'
  const o = ioFix3_510({ cfg: CANCEL510(), files: { [a]: 'ORIGINAL', [b]: 'OTHER' }, links: { [p]: 'original.md' }, post: { [b]: TRIG5 } })
  o.onNext = (f: any) => { delete f[a]; o.io.links[a] = 'other.md' }
  const r = await form510('fix3-terminal', 'cat src > r/report.md', o)
  expect(o.io.links[a], 'G1 terminal becomes regular file').toBe(undefined)
  expect(r.files[a], 'G1 terminal bytes restored').toBe('ORIGINAL')
  expect(r.files[b], 'G1 other bytes not restored through link').toBe(TRIG5)
  expect(warnings3_510(r), 'G2 terminal unrestored warning').toContain('form-rollback-unrestored ' + b)
})
test('#510 FIX3 G2 prefix-retarget', async () => {
  const a = '/fix5/a/report.md', b = '/fix5/b/report.md', prefix = { dir: 'a' }
  const o = ioFix3_510({ cfg: CANCEL510(), prefix, files: { [a]: 'ORIGINAL', [b]: 'OTHER' }, post: { [b]: 'OTHER\n' + TRIG5 } })
  o.onNext = () => { prefix.dir = 'b' }
  const r = await form510('fix3-prefix', 'cat src > /fix5/d/report.md', o)
  expect(r.files[b], 'G2 retargeted bytes remain').toBe('OTHER\n' + TRIG5)
  expect(warnings3_510(r), 'G2 retargeted warning').toContain('form-rollback-skipped-retargeted /fix5/d/report.md')
})
test('#510 FIX3 G2 middle-retarget', async () => {
  const p = '/fix5/r/report.md', a = '/fix5/r/original.md', b = '/fix5/r/other.md', mid = '/fix5/r/middle.md'
  const o = ioFix3_510({ cfg: CANCEL510(), files: { [a]: 'ORIGINAL', [b]: 'OTHER' }, links: { [p]: 'middle.md', [mid]: 'original.md' }, post: { [b]: TRIG5 } })
  o.onNext = () => { o.io.links[mid] = 'other.md' }
  const r = await form510('fix3-middle', 'cat src > r/report.md', o)
  expect(r.files[b], 'G2 middle other bytes remain').toBe(TRIG5)
  expect(warnings3_510(r), 'G2 middle unrestored warning').toContain('form-rollback-unrestored ' + b)
})
for (const count of [8, 9]) test('#510 FIX3 G3 volume-' + count, async () => {
  const files: any = {}, sizes: any = {}, post: any = {}, commands: string[] = []
  for (let i = 0; i < count; i++) { const p = '/fix5/r/' + i + '/report.md'; files[p] = 'old-' + i; sizes[p] = 4194304; post[p] = TRIG5; commands.push('cat src > ' + p) }
  const r = await form510('fix3-volume-' + count, commands.join('; '), ioFix3_510({ cfg: formGit10() + '\n[probe.form.act]\nF="log_only"\nC1="cancel"\n', files, sizes, post }))
  expect(r.ran, 'G3 volume execution ' + count).toBe(count === 9 ? 0 : 1)
  if (count === 9) { expect(r.out.deny, 'G3 volume failure named').toContain('form-backup-failed'); expect(r.out.deny, 'G3 volume reason named').toContain('backup volume exceeded') }
  for (const p of Object.keys(files)) expect(r.files[p], 'G3 original preserved ' + p).toBe(files[p])
})
test('#510 FIX3 G3 file-null-backup', async () => {
  const p = '/fix5/r/report.md', o = ioFix3_510({ cfg: CANCEL510(), files: { [p]: 'old' }, post: { [p]: TRIG5 } })
  const setup = o.setup
  o.setup = (...args: any[]) => { setup(...args); const run = args[0].$.process.run; args[0].$.process.run = async (v: string[]) => { if (v[0] === '/bin/cp' && v.at(-1)?.includes('/form-backup/')) { return { exitCode: 0 } }; return run(v) } }
  const post = (registerModule393 as any).formPost
  expect(typeof post, 'G3 direct rollback entry exists').toBe('function')
  const r = await form510('fix3-null', 'true', o)
  const state = { p: { cfg: (registerModule393 as any).parseToml(CANCEL510()).probe.form }, targets: [{ path: p }], backups: [{ path: p, kind: 'file', backup: null, parentReal: '/fix5/r', real: p }], skipped: [], before: new Map([[p, 'file']]), copyFlag: '--preserve=all' }
  r.files[p] = TRIG5
  const denial = await post(r.m.$, state, { HOME: '/home510' }, { globalHome: '/probes-510-fix3-null', cwd: '/fix5' }, { tool: 'Bash', tool_use_id: 'null-direct' })
  expect(String(denial), 'G3 missing backup rollback fails').toContain('rollback failed')
  expect(r.files[p], 'G3 missing backup leaves file intact').toBe(TRIG5)
})
test('#510 FIX3 G4 before-fingerprint', async () => {
  const p = '/fix5/r/report.md', external = TRIG5.replace('zzz', 'xxx')
  const o = ioFix3_510({ cfg: CANCEL510(), files: { [p]: 'old' }, post: { [p]: TRIG5 } }), setup = o.setup
  o.setup = (m: any, f: any, proc: any, after: any) => { setup(m, f, proc, after); const read = m.$.fs.read; let changed = false; m.$.fs.read = async (t: string, init: any) => { const result = await read(t, init); if (after() && t === p && !changed) { changed = true; f[p] = external }; return result } }
  const r = await form510('fix3-before', 'cat src > r/report.md', o)
  expect(r.files[p], 'G4 external bytes preserved').toBe(external)
  expect(warnings3_510(r), 'G4 changed warning').toContain('form-rollback-skipped-changed')
})
test('#510 FIX3 G5 final-refuse-record', async () => {
  const p = '/fix5/r/report.md'
  const r = await form510('fix3-record', 'cat src > r/report.md', ioFix3_510({ cfg: CANCEL510(), files: { [p]: 'old' }, post: { [p]: TRIG5 }, interleave: (f: any) => { f[p] = TRIG5.replace('zzz', 'xxx') } }))
  const rec = final3_510(r)
  expect(rec.kind, 'G5 final kind remains REFUSE').toBe('REFUSE')
  expect(rec.refuse.some((x: any) => x.c === 'C1'), 'G5 final refusal retained').toBe(true)
  expect(rec.warn.some((x: any) => x.c === 'form-rollback-skipped-changed'), 'G5 final warning merged').toBe(true)
})
for (const platform of ['Linux', 'Darwin']) test('#510 FIX3 G6 large-digest ' + platform, async () => {
  const p = '/fix5/r/report.md', external = TRIG5.replace('zzz', 'xxx')
  const r = await form510('fix3-large-' + platform, 'cat src > r/report.md', ioFix3_510({ cfg: CANCEL510(), platform, files: { [p]: 'old' }, sizes: { [p]: 5 * 1024 * 1024 }, post: { [p]: TRIG5 }, interleave: (f: any) => { f[p] = external } }))
  expect(r.files[p], 'G6 full digest preserves external ' + platform).toBe(external)
  expect(warnings3_510(r), 'G6 changed warning ' + platform).toContain('form-rollback-skipped-changed')
})
for (const failHash of [true, false, 'throw']) test('#510 FIX3 G6 hash-refusal ' + failHash, async () => {
  const p = '/fix5/r/report.md'
  const r = await form510('fix3-hash-' + failHash, 'cat src > r/report.md', ioFix3_510({ cfg: CANCEL510(), failHash: failHash === true, badHash: failHash === false, throwHash: failHash === 'throw', files: { [p]: 'old' }, sizes: { [p]: 5 * 1024 * 1024 }, post: { [p]: TRIG5 } }))
  expect(r.files[p], 'G6 hash refusal leaves bytes').toBe(TRIG5)
  expect(warnings3_510(r), 'G6 hash refusal named').toContain('form-rollback-skipped-unfingerprintable')
})
test('#510 FIX3 G7 perl-script', async () => {
  const s = '/fix5/script/report.md', p = '/fix5/r/report.md'
  const r = await form510('fix3-perl', 'perl -pi script/report.md r/report.md', ioFix3_510({ cfg: CANCEL510(), files: { [s]: 'script', [p]: 'old' } }))
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === s), 'G7 script is not candidate').toBe(false)
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === p), 'G7 data file is candidate').toBe(true)
})
for (const kind of ['paths', 'variants']) test('#510 FIX3 G8 boundary-' + kind, async () => {
  const files: any = {}
  if (kind === 'paths') for (let i = 0; i < 256; i++) files['/fix5/r/' + i + '/report.md'] = 'ordinary'
  else for (let i = 0; i < 64; i++) files['/home510/.claude/shell-snapshots/snapshot-zsh-bound' + i + '.sh'] = 'alias -- fan="echo ' + i + '"'
  const r = await form510('fix3-boundary-' + kind, kind === 'paths' ? Object.keys(files).map(p => 'cat src > ' + p).join('; ') : 'fan', ioFix3_510({ cfg: CANCEL510(), files }))
  expect(r.ran, 'G8 exact boundary runs ' + kind).toBe(1)
})
for (const refusal of ['chmod', 'preserve']) test('#510 FIX3 platform-refusal ' + refusal, async () => {
  const p = '/fix5/r/report.md'
  const r = await form510('fix3-platform-' + refusal, 'cat src > r/report.md', ioFix3_510({ cfg: CANCEL510(), files: { [p]: 'old' }, failChmod: refusal === 'chmod', failPreserve: refusal === 'preserve' }))
  expect(r.ran, 'platform refusal before next ' + refusal).toBe(0)
  expect(r.out.deny, 'platform backup failure ' + refusal).toContain('form-backup-failed')
})
for (const failure of ['move', 'copy']) test('#510 FIX3 G1 cleanup-' + failure, async () => {
  const p = '/fix5/r/report.md'
  const r = await form510('fix3-cleanup-' + failure, 'cat src > r/report.md', ioFix3_510({ cfg: CANCEL510(), files: { [p]: 'old' }, post: { [p]: TRIG5 }, failMove: failure === 'move', failRestoreCopy: failure === 'copy' }))
  expect(r.out.deny, 'G1 restore failure explicit ' + failure).toContain('rollback failed')
  expect(Object.keys(r.files).filter(p => p.includes('.form-restore.')), 'G1 restore temp removed ' + failure).toEqual([])
})

function rawBase64_510(bytes: number[]): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
    out += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63] + (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[n & 63] : '=')
  }
  return out
}
for (const encoding of ['utf8', 'invalid', 'bom']) test('#510 FIX3 G4 decode-' + encoding, async () => {
  const p = '/fix5/r/report.md', suffix = encoding === 'utf8' ? ' Ж😀' : encoding === 'invalid' ? '�(�' : '﻿'
  const text = encoding === 'bom' ? suffix + TRIG5 : TRIG5 + suffix
  const raw = encoding === 'invalid' ? Array.from(TRIG5).map(c => c.charCodeAt(0)).concat([0xe2, 0x28, 0xa1]) : Array.from(unescape(encodeURIComponent(text))).map(c => c.charCodeAt(0))
  const o = ioFix3_510({ files: { [p]: 'old' }, post: { [p]: text } }), setup = o.setup
  o.setup = (m: any, f: any, proc: any, after: any) => {
    setup(m, f, proc, after)
    const read = m.$.fs.read, stat = m.$.fs.stat
    m.$.fs.read = async (t: string, init: any) => after() && t === p ? init?.as === 'bytes' ? { base64: rawBase64_510(raw) } : text : read(t, init)
    m.$.fs.stat = async (t: string, init: any) => { const s = await stat(t, init); return after() && t === p ? { ...s, size: raw.length } : s }
  }
  const r = await form510('fix3-decode-' + encoding, 'cat src > r/report.md', o)
  const readText = await r.m.$.fs.read(p)
  expect(r.records.flatMap((x: any) => x.refuse || []).find((x: any) => x.c === 'C1')?.q, 'G4 judged text equals readText ' + encoding).toBe(readText)
})
test('#510 FIX3 G4 changed-during-read', async () => {
  const p = '/fix5/r/report.md', o = ioFix3_510({ cfg: CANCEL510(), files: { [p]: 'old' }, post: { [p]: TRIG5 } }), setup = o.setup
  o.setup = (m: any, f: any, proc: any, after: any) => {
    setup(m, f, proc, after)
    const read = m.$.fs.read, stat = m.$.fs.stat
    let readPost = false
    m.$.fs.read = async (t: string, init: any) => { const v = await read(t, init); if (after() && t === p) readPost = true; return v }
    m.$.fs.stat = async (t: string, init: any) => { const s = await stat(t, init); return after() && t === p && readPost ? { ...s, mtimeMs: 43 } : s }
  }
  const r = await form510('fix3-during', 'cat src > r/report.md', o)
  expect(gitF6(r).join('\n'), 'G4 changed during judgement named').toContain('target changed during judgement')
  expect(warnings3_510(r), 'G4 unstable read unfingerprintable').toContain('form-rollback-skipped-unfingerprintable')
  expect(r.files[p], 'G4 unstable read is not restored').toBe(TRIG5)
})

const COMMAND_CASES4_510: Array<[string, string[], number]> = [
  ['cp-dir', ['/bin/cp', '--', '/model/src', '/model/dir'], 0],
  ['cp-linkdir', ['/bin/cp', '--', '/model/src', '/model/linkdir'], 0],
  ['cp-missing', ['/bin/cp', '--', '/model/missing', '/model/dst'], 1],
  ['cp-dangling', ['/bin/cp', '--', '/model/src', '/model/dangling'], 1],
  ['mv-dir', ['/bin/mv', '-f', '--', '/model/src', '/model/dir'], 0],
  ['mv-linkdir', ['/bin/mv', '-f', '--', '/model/src', '/model/linkdir'], 0],
  ['mv-missing', ['/bin/mv', '-f', '--', '/model/missing', '/model/dst'], 1],
  ['mv-dangling', ['/bin/mv', '-f', '--', '/model/src', '/model/dangling'], 0],
  ['mv-T-dir', ['/bin/mv', '-f', '-T', '--', '/model/src', '/model/dir'], 1],
  ['mv-T-linkdir', ['/bin/mv', '-f', '-T', '--', '/model/src', '/model/linkdir'], 0],
  ['ln-dir', ['/bin/ln', '-s', '-f', '--', 'src', '/model/dir'], 0],
  ['ln-linkdir', ['/bin/ln', '-s', '-f', '--', 'src', '/model/linkdir'], 0],
  ['ln-missing', ['/bin/ln', '-s', '-f', '--', 'missing', '/model/dst'], 0],
  ['ln-dangling', ['/bin/ln', '-s', '-f', '--', 'src', '/model/dangling'], 0],
  ['ln-T-dir', ['/bin/ln', '-s', '-f', '-T', '--', 'src', '/model/dir'], 1],
  ['ln-T-linkdir', ['/bin/ln', '-s', '-f', '-T', '--', 'src', '/model/linkdir'], 0],
  ['mkdir-file', ['/bin/mkdir', '-p', '--', '/model/src'], 1],
  ['mkdir-dir', ['/bin/mkdir', '-p', '--', '/model/dir'], 0],
  ['mkdir-dangling', ['/bin/mkdir', '-p', '--', '/model/dangling'], 1],
  ['rm-dir', ['/bin/rm', '-f', '--', '/model/dir'], 1],
  ['rm-linkdir', ['/bin/rm', '-f', '--', '/model/linkdir'], 0],
  ['rm-missing', ['/bin/rm', '-f', '--', '/model/missing'], 0],
  ['rm-dangling', ['/bin/rm', '-f', '--', '/model/dangling'], 0],
  ['chmod-dir', ['/bin/chmod', '700', '--', '/model/dir'], 0],
  ['chmod-linkdir', ['/bin/chmod', '700', '--', '/model/linkdir'], 0],
  ['chmod-missing', ['/bin/chmod', '700', '--', '/model/missing'], 1],
  ['chmod-dangling', ['/bin/chmod', '700', '--', '/model/dangling'], 1],
]
for (const [name, argv, rc] of COMMAND_CASES4_510) test('#510 FIX4 G20 command-' + name, async () => {
  const o = ioFix3_510({ files: { '/model/src': 'SOURCE' }, dirs: ['/model', '/model/dir'], links: { '/model/linkdir': 'dir', '/model/dangling': 'missing' } })
  const r = await form510('g20-' + name, 'true', o)
  const got = await r.m.$.process.run(argv)
  expect(got.exitCode, 'G20 command rc ' + name).toBe(rc)
})

function fixtureDirs4_510(opts: any, files: any, links: any = {}): string[] {
  const dirs = opts.dirs || (opts.dirs = ['/', '/fix5', '/fix5/r', '/fix5/sub', '/fix5/sub/r'])
  for (const p of [...Object.keys(files), ...Object.keys(links)]) {
    let parent = p.slice(0, p.lastIndexOf('/')) || '/'
    for (;;) {
      if (!dirs.includes(parent)) dirs.push(parent)
      if (parent === '/') break
      parent = parent.slice(0, parent.lastIndexOf('/')) || '/'
    }
  }
  return dirs
}
function commandModel4_510(argv: string[], files: any, links: any, dirs: string[], modes: any, attrs: any, platform: string): any {
  const normalize = (p: string) => {
    const parts: string[] = []
    for (const part of p.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part) }
    return '/' + parts.join('/')
  }
  const resolve = (p: string): string => {
    p = normalize(p)
    for (let n = 0; n < 32; n++) {
      const pieces = p.split('/'); let changed = false
      for (let i = 1; i < pieces.length; i++) {
        const prefix = pieces.slice(0, i + 1).join('/')
        if (prefix in links) { p = normalize((links[prefix].startsWith('/') ? links[prefix] : prefix.slice(0, prefix.lastIndexOf('/') + 1) + links[prefix]) + '/' + pieces.slice(i + 1).join('/')); changed = true; break }
      }
      if (!changed) return p
    }
    throw new Error('ELOOP model')
  }
  const cmd = argv[0], src = argv.at(-2)!, originalDst = argv.at(-1)!
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
  const path = normalize(originalDst)
  const exists = (p: string) => p in files || p in links || dirs.includes(p)
  const force = argv.includes('-f'), noDirectory = argv.includes('-T') || argv.includes('--no-target-directory')
  const noLinkDirectory = noDirectory || (platform === 'Darwin' && argv.includes('-h'))
  if (cmd === '/bin/mkdir') {
    let current = ''
    for (const part of path.split('/').filter(Boolean)) {
      current += '/' + part
      const real = resolve(current)
      if ((exists(current) || exists(real)) && !dirs.includes(real)) return { exitCode: 1 }
      if (!dirs.includes(real)) { if (!argv.includes('-p') && current !== path) return { exitCode: 1 }; dirs.push(real) }
      else if (current === path && !argv.includes('-p')) return { exitCode: 1 }
    }
    if (argv.includes('-m')) modes[path] = argv[argv.indexOf('-m') + 1]
    return { exitCode: 0 }
  }
  if (cmd === '/bin/chmod') {
    const real = resolve(path)
    if (!(real in files) && !dirs.includes(real)) return { exitCode: 1 }
    modes[real] = argv[1]; return { exitCode: 0 }
  }
  if (cmd === '/bin/rm') {
    if (dirs.includes(path) && !(path in links)) return { exitCode: 1 }
    if (!exists(path) && !force) return { exitCode: 1 }
    delete links[path]; delete files[path]; delete attrs[path]; delete modes[path]
    return { exitCode: 0 }
  }
  if (!['/bin/cp', '/bin/mv', '/bin/ln'].includes(cmd)) return null
  const source = cmd === '/bin/ln' ? src : cmd === '/bin/cp' ? resolve(src) : normalize(src)
  if (cmd !== '/bin/ln' && !exists(source)) return { exitCode: 1 }
  let dest = path
  if (dirs.includes(path) || (!noLinkDirectory && dirs.includes(resolve(path)))) {
    if (noDirectory) return { exitCode: 1 }
    dest = normalize(resolve(path) + '/' + src.split('/').at(-1))
  }
  if (!dirs.includes(resolve(parent(dest)))) return { exitCode: 1 }
  if (cmd === '/bin/ln') {
    if (!argv.includes('-s')) return { exitCode: 1 }
    if (dirs.includes(dest) || (exists(dest) && !force)) return { exitCode: 1 }
    delete files[dest]; delete links[dest]; links[dest] = src
    return { exitCode: 0 }
  }
  if (cmd === '/bin/cp') {
    if (dest in links && !exists(resolve(dest))) return { exitCode: 1 }
    dest = resolve(dest)
    if (dirs.includes(source) || dirs.includes(dest) || source === dest) return { exitCode: 1 }
    files[dest] = files[source]
    attrs[dest] = argv.includes('--preserve=all') || (platform === 'Darwin' && argv.includes('-p')) ? attrs[source] : undefined
    if (argv.includes('--preserve=all') || argv.includes('-p')) modes[dest] = modes[source]
  } else {
    if (source === dest) return { exitCode: 0 }
    if (dirs.includes(dest)) return { exitCode: 1 }
    delete links[dest]; delete files[dest]
    if (source in links) { links[dest] = links[source]; delete links[source] } else { files[dest] = files[source]; delete files[source] }
    attrs[dest] = attrs[source]; delete attrs[source]; modes[dest] = modes[source]; delete modes[source]
  }
  return { exitCode: 0 }
}

function ioFix4_510(opts: any): any {
  ioFix3_510(opts)
  const setup = opts.setup
  opts.dirs = opts.dirs || []
  opts.setup = (m: any, files: any, proc: any, after: any) => {
    setup(m, files, proc, after)
    const stat = m.$.fs.stat
    m.$.fs.stat = async (p: string, init: any) => {
      if (opts.dirs.includes(p)) return { kind: 'dir', size: 0, mtimeMs: 42, isLink: false, ...(init?.resolve ? { realPath: p } : {}) }
      const result = await stat(p, init)
      if (result.kind === 'dir' && !opts.dirs.includes(p) && p !== '/' && p !== '/fix5' && !Object.keys(files).some(t => t.startsWith(p.replace(/\/$/, '') + '/'))) throw new Error('ENOENT ' + p)
      return result
    }
  }
  return opts
}
for (const order of ['file-first', 'link-first']) test('#510 FIX4 G10 overlap-' + order, async () => {
  const p = '/fix5/r/report.md', l = '/fix5/alias/report.md', external = TRIG5 + ' B'
  const o = ioFix4_510({ cfg: CANCEL510(), dirs: ['/fix5/alias'], files: { [p]: 'ORIGINAL' }, links: { [l]: '../r/report.md' }, post: { [p]: TRIG5 + ' A' } }), setup = o.setup
  o.setup = (m: any, f: any, proc: any, after: any) => {
    setup(m, f, proc, after)
    const read = m.$.fs.read; let changed = false
    m.$.fs.read = async (t: string, init: any) => { const result = await read(t, init); if (after() && t === l && init?.as === 'bytes' && !changed) { changed = true; f[p] = external }; return result }
  }
  const paths = order === 'file-first' ? [p, l] : [l, p]
  const r = await form510('fix4-g10-' + order, paths.map(t => 'cat src > ' + t).join('; '), o)
  expect(r.files[p], 'G10 external bytes ' + order).toBe(external)
  expect(warnings3_510(r), 'G10 conflict warning ' + order).toContain('form-rollback-skipped-changed')
})
for (const mode of ['mv-linkdir', 'ln-linkdir', 'mv-dir']) test('#510 FIX4 G11 ' + mode, async () => {
  const p = '/fix5/r/report.md', a = '/fix5/r/original.md', d = '/fix5/foreign'
  const link = mode.startsWith('ln')
  const o = ioFix4_510({ cfg: CANCEL510(), files: { [link ? a : p]: 'ORIGINAL' }, dirs: [d], links: link ? { [p]: 'original.md' } : {}, post: { [link ? a : p]: TRIG5 } }), setup = o.setup
  o.setup = (m: any, f: any, proc: any, after: any) => {
    setup(m, f, proc, after)
    const run = m.$.process.run
    m.$.process.run = async (v: string[]) => {
      if ((v[0] === '/bin/mv' || v[0] === '/bin/ln') && v.at(-1) === p) {
        delete f[p]
        if (mode === 'mv-dir') o.dirs.push(p); else o.io.links[p] = d
        if (!v.includes('-T') && !v.includes('-h')) {
          proc.push(v.slice()); const dst = d + '/' + v.at(-2)!.split('/').at(-1)
          if (v[0] === '/bin/mv') { f[dst] = f[v.at(-2)!]; delete f[v.at(-2)!] } else o.io.links[dst] = v.at(-2)!
          return { exitCode: 0 }
        }
        if (mode === 'mv-dir') { proc.push(v.slice()); return { exitCode: 1 } }
      }
      return run(v)
    }
  }
  const r = await form510('fix4-g11-' + mode, 'cat src > ' + p, o)
  expect(Object.keys(r.files).filter(t => t.startsWith(d + '/')), 'G11 foreign directory untouched ' + mode).toEqual([])
  expect(Object.keys(r.files).filter(t => t.includes('.form-restore.')), 'G11 no restore temp ' + mode).toEqual([])
  if (mode === 'mv-dir') expect(r.out.deny, 'G11 directory failure named').toContain('rollback failed')
  else if (link) expect(o.io.links[p], 'G11 restored link').toBe('original.md')
  else expect(r.files[p], 'G11 restored regular bytes').toBe('ORIGINAL')
})
for (const kind of ['file', 'link']) test('#510 FIX4 G11 post-check-' + kind, async () => {
  const p = '/fix5/r/report.md', a = '/fix5/r/original.md', isLink = kind === 'link'
  const o = ioFix4_510({ cfg: CANCEL510(), files: { [isLink ? a : p]: 'ORIGINAL' }, links: isLink ? { [p]: 'original.md' } : {}, post: { [isLink ? a : p]: TRIG5 } }), setup = o.setup
  o.setup = (m: any, f: any, proc: any, after: any) => {
    setup(m, f, proc, after); const run = m.$.process.run
    m.$.process.run = async (v: string[]) => {
      const result = await run(v)
      if (result.exitCode === 0 && v.at(-1) === p && v[0] === (isLink ? '/bin/ln' : '/bin/mv')) { if (isLink) o.io.links[p] = 'other.md'; else f[p] = 'EXTERNAL' }
      return result
    }
  }
  const r = await form510('fix4-check-' + kind, 'cat src > ' + p, o)
  expect(r.out.deny, 'G11 postcheck reason ' + kind).toContain('destination changed during restore')
  expect(r.rows.some((x: any) => x.level === 'error'), 'G11 postcheck journal ' + kind).toBe(true)
})
for (const retarget of [false, true]) test('#510 FIX4 G12 missing-parent-' + retarget, async () => {
  const p = '/fix5/newdir/report.md', external = '/fix5/foreign/report.md'
  const o = ioFix4_510({ cfg: CANCEL510(), files: { '/fix5/src': 'src', [external]: 'FOREIGN' } }), setup = o.setup
  o.onNext = (f: any) => { o.dirs.push('/fix5/newdir'); f[p] = TRIG5 }
  o.setup = (m: any, f: any, proc: any, after: any) => {
    setup(m, f, proc, after)
    const stat = m.$.fs.stat, write = m.$.fs.write; let changed = false
    m.$.fs.write = async (t: string, data: any) => { const result = await write(t, data); if (retarget && after() && t.includes('/form/records/')) changed = true; return result }
    m.$.fs.stat = async (t: string, init: any) => { const s = await stat(t, init); return changed && t === '/fix5/newdir' ? { ...s, isLink: true, realPath: '/fix5/foreign' } : s }
  }
  const r = await form510('fix4-missing-' + retarget, 'mkdir -p newdir; cat src > newdir/report.md', o)
  expect(r.ran, 'G12 command runs ' + retarget).toBe(1)
  expect(o.dirs.includes('/fix5/newdir'), 'G12 directory remains ' + retarget).toBe(true)
  expect(r.files[external], 'G12 foreign bytes ' + retarget).toBe('FOREIGN')
  if (retarget) expect(warnings3_510(r), 'G12 retarget warning').toContain('form-rollback-skipped-retargeted')
  else expect(r.files[p], 'G12 new file removed').toBe(undefined)
})
test('#510 FIX4 G13 temp-parent', async () => {
  const a = '/fix5/a/report.md', b = '/fix5/b/report.md', prefix = { dir: 'a' }
  const o = ioFix3_510({ cfg: CANCEL510(), prefix, files: { [a]: 'ORIGINAL', [b]: 'FOREIGN' }, post: { [a]: TRIG5 } }), setup = o.setup
  o.setup = (m: any, f: any, proc: any, after: any) => { setup(m, f, proc, after); const run = m.$.process.run; m.$.process.run = async (v: string[]) => { const result = await run(v); if (v[0] === '/bin/cp' && v.at(-1)?.includes('.form-restore.')) prefix.dir = 'b'; return result } }
  const r = await form510('fix4-temp', 'cat src > /fix5/d/report.md', o)
  expect(Object.keys(r.files).filter(t => t.includes('.form-restore.')), 'G13 temp cleaned physical parent').toEqual([])
  expect(r.files[b], 'G13 foreign unchanged').toBe('FOREIGN')
})
test('#510 FIX4 G14 new-file-warning', async () => {
  const p = '/fix5/r/report.md'
  const r = await form510('fix4-new-warning', 'cat src > ' + p, ioFix4_510({ cfg: CANCEL510(), dirs: ['/fix5/r'], post: { [p]: TRIG5 } }))
  expect(r.ran, 'G14 command runs').toBe(1)
  expect(r.files[p], 'G14 new file removed').toBe(undefined)
  expect(warnings3_510(r), 'G14 no unrestored warning').not.toContain('form-rollback-unrestored')
})
for (const arg of ['-mbytes', '-Mstrict', '-Ilib', '-F:', '-x', '-Cexample', '-0e', '-de', '-De', '-le']) test('#510 FIX4 G15 perl-' + arg, async () => {
  const s = '/fix5/script/report.md', p = '/fix5/r/report.md'
  const r = await form510('fix4-perl-' + arg, 'perl -pi ' + arg + ' script/report.md r/report.md', ioFix4_510({ cfg: CANCEL510(), files: { [s]: 'script', [p]: 'old' } }))
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === s), 'G15 script not candidate ' + arg).toBe(false)
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === p), 'G15 data candidate ' + arg).toBe(true)
})
for (const arg of ['-lpi', '-0pi', '-pli', '-0777pi', '-l0pi', '-0x1Fpi', '-dpi']) test('#510 FIX6 perl typed ' + arg, async () => {
  const s = '/fix5/script/report.md', p = '/fix5/r/report.md'
  const r = await form510('fix6-perl-' + arg, 'perl ' + arg + ' script/report.md r/report.md', ioFix4_510({ cfg: CANCEL510(), files: { [s]: 'script', [p]: 'old' } }))
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === s), 'FIX6 typed script not candidate ' + arg).toBe(false)
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === p), 'FIX6 typed data candidate ' + arg).toBe(true)
})
for (const arg of ['-00pi', '-pie', '-l7pi', '-Mstrict -pi', '-0x1F -pi']) test('#510 FIX7 perl must-flag ' + arg, async () => {
  const s = '/fix5/script/report.md', p = '/fix5/r/report.md'
  const r = await form510('fix7-perl-' + arg, 'perl ' + arg + ' script/report.md r/report.md', ioFix4_510({ cfg: CANCEL510(), files: { [s]: 'script', [p]: 'old' } }))
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === s), 'FIX7 must-flag script not candidate ' + arg).toBe(false)
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === p), 'FIX7 must-flag data candidate ' + arg).toBe(true)
})
for (const arg of ['-0xi', '-0xpi']) test('#510 FIX8 perl hex-empty ' + arg, async () => {
  const s = '/fix5/script/report.md', p = '/fix5/r/report.md'
  const r = await form510('fix8-perl-' + arg, 'perl ' + arg + ' script/report.md r/report.md', ioFix4_510({ cfg: CANCEL510(), files: { [s]: 'script', [p]: 'old' } }))
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === s), 'FIX8 hex-empty script not candidate ' + arg).toBe(false)
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === p), 'FIX8 hex-empty data candidate ' + arg).toBe(true)
})
for (const arg of ['-i.e -n', '-i.f -n']) test('#510 FIX8 sed in-place suffix ' + arg, async () => {
  const s = '/fix5/script/report.md', p = '/fix5/r/report.md'
  const r = await form510('fix8-sed-' + arg, 'sed ' + arg + ' script/report.md r/report.md', ioFix4_510({ cfg: CANCEL510(), files: { [s]: 'script', [p]: 'old' } }))
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === s), 'FIX8 sed suffix script not candidate ' + arg).toBe(false)
  expect(r.proc.some(v => v[0] === '/bin/cp' && v.at(-2) === p), 'FIX8 sed suffix data candidate ' + arg).toBe(true)
})
for (const arg of ['-Ci', '-Di', '-ei', '-Ei', '-Fi', '-Ii', '-mi', '-Mi', '-xi', '-d:pi']) test('#510 FIX6 perl value ' + arg, async () => {
  const s = '/fix5/script/report.md', p = '/fix5/r/report.md'
  const r = await form510('fix6-perlv-' + arg, 'perl ' + arg + ' script/report.md r/report.md', ioFix4_510({ cfg: CANCEL510(), files: { [s]: 'script', [p]: 'old' } }))
  expect(r.proc.some(v => v[0] === '/bin/cp' && (v.at(-2) === s || v.at(-2) === p)), 'FIX6 value no candidate ' + arg).toBe(false)
})
for (const platform of ['Linux', 'Darwin']) test('#510 FIX4 G16 argv-' + platform, async () => {
  const p = '/fix5/r/report.md'
  const r = await form510('fix4-hash-' + platform, 'cat src > ' + p, ioFix3_510({ cfg: CANCEL510(), platform, files: { [p]: 'old' }, sizes: { [p]: 5 * 1024 * 1024 }, post: { [p]: TRIG5 } }))
  const expected = platform === 'Linux' ? ['/usr/bin/sha256sum', '--', p] : ['/usr/bin/shasum', '-a', '256', '--', p]
  const hashes = r.proc.filter(v => /\/(sha256sum|shasum)$/.test(v[0]))
  expect(hashes.length >= 2, 'G16 judgement and comparison hash ' + platform).toBe(true)
  for (const argv of hashes) expect(argv, 'G16 exact argv ' + platform).toEqual(expected)
})
for (const size of [8, 30 * 1024 * 1024]) test('#510 FIX4 G18 per-target-' + size, async () => {
  const b = '/fix5/brief.md', p = '/fix5/r/report.md'
  const cfg = formGit10().replace('brief_path = "^zzz-brief-path"', () => 'brief_path = "brief[.]md$"') + '\n[probe.form.act]\nF="log_only"\nA1="log_only"\nA2="log_only"\nA3="log_only"\nC1="cancel"\n'
  const r = await form510('fix4-classes-' + size, 'cat src > ' + b + '; cat src > ' + p, ioFix4_510({ cfg, files: { [b]: 'brief', [p]: 'old' }, sizes: { [b]: size, [p]: 4 * 1024 * 1024 }, post: { [p]: TRIG5 } }))
  expect(r.ran, 'G18 runs without brief budget ' + size).toBe(1)
  expect(r.proc.filter(v => v[0] === '/bin/cp' && v.at(-1)?.includes('/form-backup/')).map(v => v.at(-2)), 'G18 only report copied ' + size).toEqual([p])
})
for (const branch of ['file', 'link', 'parent']) test('#510 FIX4 G19 ' + branch, async () => {
  const p = '/fix5/r/report.md', a = '/fix5/a/original.md', linked = branch !== 'file'
  const o = ioFix4_510({ cfg: CANCEL510(), files: { [linked ? a : p]: 'ORIGINAL' }, links: linked ? { [p]: a } : {}, dirs: ['/fix5/r'], post: { [linked ? a : p]: TRIG5 } }), setup = o.setup
  o.setup = (m: any, f: any, proc: any, after: any) => {
    setup(m, f, proc, after); const run = m.$.process.run, stat = m.$.fs.stat; let changed = false
    m.$.process.run = async (v: string[]) => { const result = await run(v); if ((branch === 'file' && v[0] === '/bin/cp' && v.at(-1)?.includes('.form-restore.')) || (linked && v[0] === '/bin/mv' && v.at(-1) === a)) { changed = true; if (branch !== 'parent') { delete f[p]; delete o.io.links[p]; o.dirs.push(p) } }; return result }
    m.$.fs.stat = async (t: string, init: any) => { const s = await stat(t, init); return changed && branch === 'parent' && t === '/fix5/r' && init?.resolve ? { ...s, realPath: '/fix5/foreign' } : s }
  }
  const r = await form510('fix4-branch-' + branch, 'cat src > ' + p, o)
  const code = branch === 'parent' ? 'form-rollback-skipped-retargeted' : 'form-rollback-skipped-nonfile'
  expect(warnings3_510(r), 'G19 branch warning ' + branch).toContain(code)
  if (branch !== 'parent') expect(o.dirs.includes(p), 'G19 directory intact ' + branch).toBe(true)
})

// G17-HOST-DECODE-BEGIN
const HOST_DECODE_510 = {
  "hostVersion": "2.1.285",
  "imageSha256": "33dad1ec615a2e08cc78b494f05c110e49916de2c79d78ec8799ebf46b233d29",
  "cases": [
    { "name": "bom", "bytesHex": "efbbbf41", "codePoints": [65279, 65] },
    { "name": "inv", "bytesHex": "41e228a1", "codePoints": [65, 65533, 40, 65533] },
    { "name": "over", "bytesHex": "41c0af", "codePoints": [65, 65533, 65533] },
    { "name": "sur", "bytesHex": "41eda080", "codePoints": [65, 65533, 65533, 65533] },
    { "name": "max", "bytesHex": "41f4908080", "codePoints": [65, 65533, 65533, 65533, 65533] },
    { "name": "four", "bytesHex": "41f09f9880", "codePoints": [65, 128512] },
    { "name": "trunc", "bytesHex": "41e282", "codePoints": [65, 65533] }
  ]
}
// G17-HOST-DECODE-END
for (const sample of HOST_DECODE_510.cases) test('#510 G17 host-decode-' + sample.name, async () => {
  const p = '/fix5/r/report.md', expected = String.fromCodePoint(...sample.codePoints)
  const raw = Array.from(sample.bytesHex.matchAll(/../g), x => parseInt(x[0], 16))
  const prefix = Array.from(TRIG5).map(c => c.charCodeAt(0))
  const o = ioFix3_510({ files: { [p]: 'old' }, post: { [p]: TRIG5 + expected } }), setup = o.setup
  o.setup = (m: any, f: any, proc: any, after: any) => {
    setup(m, f, proc, after)
    const read = m.$.fs.read, stat = m.$.fs.stat
    m.$.fs.read = (t: string, init: any) => after() && t === p && init?.as === 'bytes' ? { base64: rawBase64_510(prefix.concat(raw)) } : read(t, init)
    m.$.fs.stat = async (t: string, init: any) => { const s = await stat(t, init); return after() && t === p ? { ...s, size: prefix.length + raw.length } : s }
  }
  const r = await form510('g17-' + sample.name, 'cat src > r/report.md', o)
  const judged = r.records.flatMap((x: any) => x.refuse || []).find((x: any) => x.c === 'C1')?.q
  expect(typeof judged, 'G17 C1 record ' + sample.name).toBe('string')
  expect(Array.from(judged.slice(TRIG5.length) as string).map(c => c.codePointAt(0)), 'G17 host codepoints ' + sample.name).toEqual(sample.codePoints)
})

// --- #509: лестница без потолка, терминальная ступень исчерпанной клетки -------
//
// CONSTRAINT: зубы #509 гоняют РЕАЛЬНЫЕ обработчики agent.spawn/turn.step
// (hook393) на мире mod$393; часы и имена моделей уникальны на зуб: метки
// остывания и накопитель моделей исполнителя -- состояние процесса.
// failoverTerminal читается через namespace-импорт: именованный импорт
// отсутствующего экспорта ронял бы весь файл вместо одного зуба.

const refuse509: any = () => (async function* () { return { usage: null, stopReason: null } })()
const ok509 = (tag: string): any => () => (async function* () {
  return { usage: { out: 1 }, stopReason: "end_turn", text: "OK-" + tag }
})()

function next509(script: { [model: string]: any }): any {
  const seen: string[] = []
  const next: any = (req: any) => {
    const model = String(req && req.model)
    seen.push(model)
    const act = script[model]
    if (!act) throw new Error("next509: нет сценария для " + model)
    return act()
  }
  next.seen = seen
  return next
}

function world509(tag: string, now: number, probes: string = "[failover]\nenabled = true\n", extraFiles: Record<string, string> = {}, extraEnv: Record<string, string> = {}): any {
  const dir = "/probes-509" + tag
  return mod$393({
    files: Object.assign({ [dir + "/probes.toml"]: probes }, extraFiles),
    env: Object.assign({ CLAUDE_PROBES_DIR: dir }, extraEnv),
    now,
  })
}

async function step509(m: any, aid: string, original: string, next: any): Promise<any> {
  return await drainStream(hook393(subs393(), "turn.step")(m.$, {
    agentId: aid, turnId: "t-" + aid, index: 0, model: original, messageCount: 1,
  }, next))
}

function attempts509(m: any, aid: string): any[] {
  return shards393(m.writes, "/failover/journal.jsonl.shard.").filter(r => r.agentId === aid && r.attempt !== undefined)
}

function effortAll509(models: string[]): { [k: string]: string } {
  const out: { [k: string]: string } = {}
  for (const x of models) out[x] = "max"
  return out
}

test("#509 (а): пять отказавших ступеней -- шесть попыток и терминал последним", async () => {
  await drainFold393()
  failoverBindReset()
  const m = world509("a", 509_100_000)
  const ladder = ["r509a-1", "r509a-2", "r509a-3", "r509a-4", "r509a-5"]
  failoverBindSet("ag-509a", { ladder, terminal: "t509a", rungEffort: effortAll509(ladder.concat(["t509a"])), subagentType: "t", class: "", sticky: null })
  const script: any = { "in509a": refuse509, "t509a": refuse509 }
  for (const r of ladder) script[r] = refuse509
  const next = next509(script)
  const out = await step509(m, "ag-509a", "in509a", next)
  const plan = ["in509a"].concat(ladder, ["t509a"])
  expect(next.seen, "вся лестница без потолка, терминал последним").toEqual(plan)
  expect(isCarrierRefusal(out.value)).toBe(true)
  const recs = attempts509(m, "ag-509a")
  expect(recs.map(r => r.modelRequested)).toEqual(plan)
  for (let i = 0; i < 6; i++) expect(recs[i].terminal, "попытка " + i + " не терминал").toBe(undefined)
  const last = recs[6]
  expect(last.terminal).toBe(true)
  expect(last.reason).toBe("cell-exhausted")
  expect(last.rungsTried).toEqual(plan.slice(0, 6))
  expect(last.outcome, "отказ терминала -- обычная запись отказа").toBe("empty")
  failoverBindReset()
})

test("#509 (б): клетка без лестницы при непустом допуске -- план [входящая, терминал]", async () => {
  await drainFold393()
  failoverBindReset()
  const table = "/tbl-509b/routing-table.toml"
  const m = world509("b", 509_200_000,
    '[failover]\nenabled = true\nterminal = {model = "claude-t509b", effort = "high"}\n',
    { [table]: '[classes.c509b]\nallowed = ["x509b-1", "x509b-2", "in509b"]\n' },
    { CATALYST_ROUTING_TABLE: table })
  const res = await hook393(subs393(), "agent.spawn")(m.$, {
    subagentType: "any-agent", prompt: "[dispatch-class:c509b] x", model: "in509b",
  }, async () => ({ agentId: "ag-509b" }))
  expect(res.agentId).toBe("ag-509b")
  const bind = failoverBindGet("ag-509b")
  expect(bind && bind.ladder).toStrictEqual([])
  expect(bind && bind.source).toBe("none")
  expect(bind && bind.terminal).toBe("claude-t509b")
  const empty = shards393(m.writes, "/failover/journal.jsonl.shard.").filter(r => String(r.rec).indexOf("empty-ladder-") === 0)
  expect(empty.length).toBe(1)
  expect(empty[0].terminal, "журнал пустой лестницы несёт терминал").toBe("claude-t509b")
  const next = next509({ "in509b": refuse509, "claude-t509b": ok509("509b") })
  const out = await step509(m, "ag-509b", "in509b", next)
  expect(next.seen, "ни одной модели допуска клетки").toEqual(["in509b", "claude-t509b"])
  expect(out.value && out.value.text).toBe("OK-509b")
  failoverBindReset()
})

test("#509 (в): успех терминала не ставит липкость", async () => {
  await drainFold393()
  failoverBindReset()
  const m = world509("c", 509_300_000)
  failoverBindSet("ag-509c", { ladder: ["r509c"], terminal: "t509c", rungEffort: effortAll509(["r509c", "t509c"]), subagentType: "t", class: "", sticky: null })
  const next = next509({ "in509c": refuse509, "r509c": refuse509, "t509c": ok509("509c") })
  const out = await step509(m, "ag-509c", "in509c", next)
  expect(next.seen).toEqual(["in509c", "r509c", "t509c"])
  expect(out.value && out.value.text).toBe("OK-509c")
  expect(failoverBindGet("ag-509c").sticky, "bind.sticky не изменён").toBe(null)
  const recs = attempts509(m, "ag-509c")
  expect(recs.length).toBe(3)
  expect(recs[2].terminal).toBe(true)
  expect(recs[2].outcome).toBe("ok")
  failoverBindReset()
})

test("#509 (г): остывающая ступень перед терминалом, остывающий терминал всё равно последний (#509-FIX1 C1)", async () => {
  await drainFold393()
  failoverBindReset()
  const now = 509_400_000
  const m = world509("g", now)
  noteRungCarrierRefusal("r509g-cold", now - 5000)
  failoverBindSet("ag-509g", { ladder: ["r509g-cold", "r509g-live"], terminal: "t509g", rungEffort: effortAll509(["r509g-cold", "r509g-live", "t509g"]), subagentType: "t", class: "", sticky: null })
  const next = next509({ "in509g": refuse509, "r509g-cold": refuse509, "r509g-live": refuse509, "t509g": refuse509 })
  await step509(m, "ag-509g", "in509g", next)
  expect(next.seen, "живая ступень, затем остывающая, терминал последним").toEqual(["in509g", "r509g-live", "r509g-cold", "t509g"])
  noteRungCarrierRefusal("r509g2-cold", now - 5000)
  noteRungCarrierRefusal("t509g2", now - 4000)
  failoverBindSet("ag-509g2", { ladder: ["r509g2-cold", "r509g2-live"], terminal: "t509g2", rungEffort: effortAll509(["r509g2-cold", "r509g2-live", "t509g2"]), subagentType: "t", class: "", sticky: null })
  const next2 = next509({ "in509g2": refuse509, "r509g2-cold": refuse509, "r509g2-live": refuse509, "t509g2": refuse509 })
  await step509(m, "ag-509g2", "in509g2", next2)
  expect(next2.seen, "остывающий терминал -- в хвосте среди остывающих").toEqual(["in509g2", "r509g2-live", "r509g2-cold", "t509g2"])
  failoverBindReset()
})

test("#509 (д): проверяющий с исполнителем на терминальной модели -- терминала в плане нет", async () => {
  await drainFold393()
  failoverBindReset()
  sessionExecutorsReset()
  sessionExecutorModelAdd("t509d")
  const m = world509("d", 509_500_000)
  failoverBindSet("ag-509d", { ladder: ["r509d"], terminal: "t509d", rungEffort: effortAll509(["r509d", "t509d"]), subagentType: "t", class: "crit-mech", sticky: null })
  const next = next509({ "in509d": refuse509, "r509d": refuse509, "t509d": ok509("509d") })
  const out = await step509(m, "ag-509d", "in509d", next)
  expect(next.seen).toEqual(["in509d", "r509d"])
  expect(isCarrierRefusal(out.value)).toBe(true)
  const recs = attempts509(m, "ag-509d")
  expect(recs.length).toBe(2)
  for (const r of recs) expect(r.terminalFiltered, "отметка фильтра терминала").toBe(true)
  sessionExecutorsReset()
  failoverBindReset()
})

test("#509 (е): ключа нет / пуст / список / объект без model -- terminal-absent, план без терминала", async () => {
  const cases: Array<[string, string, string]> = [
    ["e1", "[failover]\nenabled = true\n", "ключ terminal не объявлен"],
    ["e2", '[failover]\nenabled = true\nterminal = ""\n', "ключ terminal пуст"],
    ["e3", '[failover]\nenabled = true\nterminal = ["t509e3"]\n', "форма terminal негодна"],
    ["e4", '[failover]\nenabled = true\nterminal = {effort = "high"}\n', "форма terminal негодна"],
  ]
  let k = 0
  for (const [tag, probes, reason] of cases) {
    await drainFold393()
    failoverBindReset()
    // CONSTRAINT (#509-FIX1 G): terminal-absent -- один раз на процесс на причину.
    R514.failoverSaidReset()
    const m = world509(tag, 509_600_000 + (k++) * 100_000, probes)
    const aid = "ag-509" + tag
    await hook393(subs393(), "agent.spawn")(m.$, {
      subagentType: "any-agent", prompt: "[dispatch-class:c509e] x", model: "in509" + tag,
    }, async () => ({ agentId: aid }))
    const bind = failoverBindGet(aid)
    expect({ tag, terminal: bind && bind.terminal }).toEqual({ tag, terminal: "" })
    const absent = shards393(m.writes, "/failover/journal.jsonl.shard.").filter(r => String(r.rec) === "terminal-absent-" + aid)
    expect({ tag, n: absent.length }).toEqual({ tag, n: 1 })
    expect({ tag, reason: absent[0].reason, agentId: absent[0].agentId, subagentType: absent[0].subagentType, class: absent[0].class })
      .toEqual({ tag, reason, agentId: aid, subagentType: "any-agent", class: "c509e" })
    const next = next509({ ["in509" + tag]: refuse509 })
    await step509(m, aid, "in509" + tag, next)
    expect({ tag, seen: next.seen }).toEqual({ tag, seen: ["in509" + tag] })
  }
  failoverBindReset()
})

test("#509 (ж): агент объявлен на терминальной модели -- она первой, терминал второй раз не добавляется (#509-FIX3 H1)", async () => {
  await drainFold393()
  failoverBindReset()
  const m = world509("j", 510_100_000)
  failoverBindSet("ag-509j", { ladder: ["r509j"], terminal: "t509j", rungEffort: effortAll509(["r509j", "t509j"]), subagentType: "t", class: "", sticky: null })
  const next = next509({ "t509j": refuse509, "r509j": refuse509 })
  await step509(m, "ag-509j", "t509j", next)
  expect(next.seen, "объявленная первой, терминал в проходе один раз").toEqual(["t509j", "r509j"])
  const recs = attempts509(m, "ag-509j")
  expect(recs.length).toBe(2)
  expect(recs[0].modelRequested).toBe("t509j")
  expect(recs[0].terminal, "первая попытка объявленной -- не переход (D-8a)").toBe(undefined)
  expect(recs[0].reason).toBe(undefined)
  expect(recs[1].modelRequested).toBe("r509j")
  expect(recs[1].terminal).toBe(undefined)
  rungCooldownReset()
  failoverBindReset()
})

test("#509 (з): эффорт терминала из формы ключа -- в rungEffort привязки", async () => {
  const ft = (registerModule393 as any).failoverTerminal
  expect(typeof ft, "failoverTerminal экспортирована").toBe("function")
  expect(ft({ terminal: { model: "claude-t509z", effort: "high" } })).toEqual({ model: "claude-t509z", effort: "high", effortBad: "", absent: "" })
  expect(ft({ terminal: "claude-t509z" })).toEqual({ model: "claude-t509z", effort: "", effortBad: "", absent: "" })
  expect(ft({ terminal: { model: "claude-t509z", effort: "bogus" } })).toEqual({ model: "claude-t509z", effort: "", effortBad: "bogus", absent: "" })
  await drainFold393()
  failoverBindReset()
  const m = world509("z", 510_200_000,
    '[failover]\nenabled = true\nterminal = {model = "claude-t509z", effort = "high"}\n\n[failover.class.c509z]\nmodels = [{model = "r509z", effort = "max"}]\n')
  await hook393(subs393(), "agent.spawn")(m.$, {
    subagentType: "any-agent", prompt: "[dispatch-class:c509z] x", model: "in509z",
  }, async () => ({ agentId: "ag-509z" }))
  const bind = failoverBindGet("ag-509z")
  expect(bind && bind.terminal).toBe("claude-t509z")
  expect(bind && bind.rungEffort).toEqual({ "r509z": "max", "claude-t509z": "high" })
  expect(shards393(m.writes, "/failover/journal.jsonl.shard.").filter(r => String(r.rec).indexOf("terminal-absent-") === 0).length).toBe(0)
  failoverBindReset()
})

test("#509 (и): проверяющий с пустой лестницей и терминалом -- без ложного ladderFullTaken", async () => {
  await drainFold393()
  failoverBindReset()
  sessionExecutorsReset()
  const m = world509("i", 510_300_000)
  failoverBindSet("ag-509i", { ladder: [], terminal: "t509i", rungEffort: effortAll509(["t509i"]), subagentType: "t", class: "crit-mech", sticky: null })
  const next = next509({ "in509i": refuse509, "t509i": ok509("509i") })
  await step509(m, "ag-509i", "in509i", next)
  expect(next.seen).toEqual(["in509i", "t509i"])
  const recs = attempts509(m, "ag-509i")
  expect(recs.length).toBe(2)
  for (const r of recs) expect(r.ladderFullTaken, "ступеней не было -- фильтровать нечего").toBe(undefined)
  sessionExecutorsReset()
  failoverBindReset()
})

test("#509 (к): терминал на попытке 0 (объявленная мертва) не сворачивается в агрегат", async () => {
  await drainFold393()
  failoverBindReset()
  const now = 510_400_000
  const m = world509("k", now)
  R514.noteModelRefusal("in509k", now - 1000, "permanent-model", 0, "carrier-refusal", "Credit balance is too low")
  failoverBindSet("ag-509k", { ladder: [], terminal: "t509k", rungEffort: effortAll509(["t509k"]), subagentType: "t", class: "", sticky: null })
  const next = next509({ "t509k": ok509("509k") })
  const out = await step509(m, "ag-509k", "in509k", next)
  expect(next.seen, "объявленная пропущена мёртвой, терминал -- попытка 0").toEqual(["t509k"])
  expect(out.value && out.value.text).toBe("OK-509k")
  const recs = attempts509(m, "ag-509k")
  expect(recs.length, "улика терминала пишется записью, не свёрткой").toBe(1)
  expect(recs[0].attempt).toBe(0)
  expect(recs[0].terminal).toBe(true)
  expect(recs[0].outcome).toBe("ok")
  rungCooldownReset()
  failoverBindReset()
})

test("#509 (л): отказ эффорта на терминале несёт улику исчерпанной клетки", async () => {
  await drainFold393()
  failoverBindReset()
  const m = world509("l", 510_500_000)
  failoverBindSet("ag-509l", { ladder: ["r509l"], terminal: "t509l", rungEffort: { "r509l": "max" }, subagentType: "t", class: "", sticky: null })
  const next = next509({ "in509l": refuse509, "r509l": refuse509 })
  await step509(m, "ag-509l", "in509l", next)
  expect(next.seen, "терминал без эффорта отказан до вызова").toEqual(["in509l", "r509l"])
  const refused = attempts509(m, "ag-509l").filter(r => r.outcome === "rung-effort-refused")
  expect(refused.length).toBe(1)
  expect(refused[0].modelRequested).toBe("t509l")
  expect(refused[0].terminal).toBe(true)
  expect(refused[0].terminalReason).toBe("cell-exhausted")
  expect(refused[0].rungsTried).toEqual(["in509l", "r509l"])
  expect(refused[0].reason).toBe("пин эффорта клетки не объявлен")
  failoverBindReset()
})

test("#509 (м): терминал, пустой после trim, -- отсутствует, как у прибора", async () => {
  const ft = (registerModule393 as any).failoverTerminal
  expect(ft({ terminal: "  " })).toEqual({ model: "", effort: "", effortBad: "", absent: "ключ terminal пуст" })
  expect(ft({ terminal: { model: " \t ", effort: "high" } })).toEqual({ model: "", effort: "", effortBad: "", absent: "форма terminal негодна" })
  await drainFold393()
  failoverBindReset()
  const m = world509("m", 510_600_000, '[failover]\nenabled = true\nterminal = "   "\n')
  await hook393(subs393(), "agent.spawn")(m.$, {
    subagentType: "any-agent", prompt: "[dispatch-class:c509m] x", model: "in509m",
  }, async () => ({ agentId: "ag-509m" }))
  expect(failoverBindGet("ag-509m").terminal).toBe("")
  const absent = shards393(m.writes, "/failover/journal.jsonl.shard.").filter(r => String(r.rec) === "terminal-absent-ag-509m")
  expect(absent.length).toBe(1)
  expect(absent[0].reason).toBe("ключ terminal пуст")
  const next = next509({ "in509m": refuse509 })
  await step509(m, "ag-509m", "in509m", next)
  expect(next.seen, "пробельный терминал в план не попадает").toEqual(["in509m"])
  failoverBindReset()
})

test("#509 (н): проверяющий, привязка без ladder, с терминалом -- шаг не падает", async () => {
  await drainFold393()
  failoverBindReset()
  sessionExecutorsReset()
  const m = world509("n", 510_700_000)
  failoverBindSet("ag-509n", { terminal: "t509n", rungEffort: effortAll509(["t509n"]), subagentType: "t", class: "crit-mech", sticky: null })
  const next = next509({ "in509n": refuse509, "t509n": ok509("509n") })
  const out = await step509(m, "ag-509n", "in509n", next)
  expect(next.seen).toEqual(["in509n", "t509n"])
  expect(out.value && out.value.text).toBe("OK-509n")
  for (const r of attempts509(m, "ag-509n")) expect(r.ladderFullTaken).toBe(undefined)
  sessionExecutorsReset()
  failoverBindReset()
})

// --- #509-FIX1 + #514: допуск, терминал последним, ожидание вместо смерти ------
//
// CONSTRAINT: новые экспорты читаются через namespace-импорт: на дереве до
// волны их нет, и именованный импорт ронял бы весь файл вместо одного зуба.
// Часы движет ТОЛЬКО подставной $.process.run (N с на `/bin/sleep N`); реальных пауз
// нет. Однократные записи журнала -- состояние процесса, поэтому каждый зуб
// начинает со сброса (failoverSaidReset) и уникальных имён моделей.
const R514: any = registerModule393 as any

function reset514(): void {
  if (typeof R514.failoverSaidReset === "function") R514.failoverSaidReset()
  failoverBindReset()
  sessionExecutorsReset()
}

// CONSTRAINT (#514 FIX3 M1): шов сессии стенда -- ИСТОРИЯ сообщений, растущая
// как у хоста: отказ носителя дописывает свою assistant-строку, бросок без
// строки (throwSilent) и отказ без строки (silent) не дописывают ничего;
// history -- строки, стоявшие в сессии до шага. procResult заменяет исход
// куска паузы (код выхода и сдвиг часов) для зубов двери паузы.
// CONSTRAINT (#509-FIX4): window -- окно хоста (новейшие N записей, контракт
// session.messages 4096); reply(n) -- ответ n-го чтения вместо истории
// ({deny}, не список), undefined -- история.
// CONSTRAINT (#509-FIX6 А1): doorCost(door, n) -- цена n-го вызова двери
// записи (fs.write), чтения истории (session.messages) или тоста (ui.toast) в
// мс часов стенда; номер -- по порядку вызова, часы сдвигаются по выходу из
// двери, и по возврату, и по броску (#509-FIX7 А-Р3). Без doorCost двери
// часов не двигают.
// CONSTRAINT (#509-FIX7 А-Р1): procTimeout -- дверь сна держит init.timeoutMs
// по контракту хоста: сон дольше предела двигает часы на предел и бросает.
// afterFire -- clock.after стенда срабатывает сам, когда цена двери doorCost
// переходит его срок: часы встают на срок, колбэк зовётся, и дверь часов
// дальше не двигает -- её остаток идёт параллельно.
function host514(tag: string, now: number, o: {
  probes?: string
  files?: Record<string, string>
  env?: Record<string, string>
  envRefuses?: string[]
  sleepHook?: (n: number, now: number) => void
  noProc?: boolean
  history?: string[]
  procResult?: (n: number) => { exitCode: number; advanceMs: number }
  onMessages?: (n: number) => void
  window?: number
  reply?: (n: number) => any
  doorCost?: (door: "write" | "messages" | "toast", n: number) => number
  procTimeout?: boolean
  afterFire?: boolean
} = {}): any {
  const dir = "/probes-514" + tag
  const state: any = { history: [] as any[], sleeps: [] as number[], procCalls: [] as any[], messagesThrow: false, writeThrow: false, messageArgs: [] as any[], fired: [] as number[] }
  for (const t of o.history || []) state.history.push({ role: "user", text: "q" }, { role: "assistant", text: t })
  const m = mod$393({
    files: Object.assign({ [dir + "/probes.toml"]: o.probes ?? "[failover]\nenabled = true\n" }, o.files || {}),
    env: Object.assign({ CLAUDE_PROBES_DIR: dir }, o.env || {}),
    envRefuses: o.envRefuses,
    now,
    proc: o.noProc ? undefined : async (argv: string[], init: any, setNow: (n: number) => void, getNow: () => number) => {
      state.procCalls.push({ argv, init })
      state.sleeps.push(getNow())
      let adv = 0
      let code = 0
      if (o.procResult) {
        const r = o.procResult(state.sleeps.length)
        adv = r.advanceMs
        code = r.exitCode
      } else {
        const secs = Array.isArray(argv) && argv[0] === "/bin/sleep" ? Number(argv[1]) : NaN
        adv = Number.isFinite(secs) ? secs * 1000 : 0
      }
      const lim = init && typeof init.timeoutMs === "number" ? init.timeoutMs : Infinity
      if (o.procTimeout && adv > lim) {
        setNow(getNow() + lim)
        if (o.sleepHook) o.sleepHook(state.sleeps.length, getNow())
        throw new Error("process.run: timed out after " + String(lim) + " ms")
      }
      setNow(getNow() + adv)
      if (o.sleepHook) o.sleepHook(state.sleeps.length, getNow())
      return { exitCode: code, stdout: "", stderr: "" }
    },
    messages: (arg: any) => {
      state.messageArgs.push(arg)
      if (o.onMessages) o.onMessages(state.messageArgs.length)
      if (state.messagesThrow) throw new Error("session.messages: scripted refusal")
      if (o.reply) {
        const r = o.reply(state.messageArgs.length)
        if (r !== undefined) return r
      }
      return o.window ? state.history.slice(-o.window) : state.history.slice()
    },
  })
  state.m = m
  const timers: Array<{ due: number; cb: any; off: boolean }> = []
  state.timers = timers
  if (o.afterFire) {
    const after0 = m.$.clock.after
    m.$.clock.after = (ms: number, cb: any) => {
      const h0 = after0(ms, cb)
      const t = { due: m.getNow() + ms, cb, off: false }
      timers.push(t)
      return { cancel: () => { t.off = true; h0.cancel() } }
    }
  }
  const spend = (c: number): void => {
    if (!(c > 0)) return
    const end = m.getNow() + c
    let first: any = null
    for (const t of timers) if (!t.off && t.due <= end && (first === null || t.due < first.due)) first = t
    if (first === null) { m.setNow(end); return }
    first.off = true
    m.setNow(Math.max(m.getNow(), first.due))
    state.fired.push(first.due)
    first.cb()
  }
  if (o.doorCost) {
    const cost = o.doorCost
    const write0 = m.$.fs.write
    const messages0 = m.$.session.messages
    const toast0 = m.$.ui.toast
    const n = { write: 0, messages: 0, toast: 0 }
    m.$.fs.write = async (p: string, text: string) => {
      const c = cost("write", ++n.write)
      try {
        if (state.writeThrow) throw new Error("fs.write: scripted refusal")
        return await write0(p, text)
      } finally { spend(c) }
    }
    m.$.session.messages = async (arg: any) => {
      const c = cost("messages", ++n.messages)
      try { return await messages0(arg) } finally { spend(c) }
    }
    m.$.ui.toast = async (text: string) => {
      const c = cost("toast", ++n.toast)
      try { return await toast0(text) } finally { spend(c) }
    }
  }
  return state
}

// act(k, now): null -- успех; { usageModel: X } -- успех, usage.model = X;
// строка -- отказ носителя с этим текстом в сессии; { throw: text } -- бросок
// next со строкой в сессии; { throwSilent: text } -- бросок без строки;
// { silent: true } -- отказ носителя без строки.
function next514(h: any, script: { [model: string]: (k: number, now: number) => any }): any {
  const seen: string[] = []
  const reqs: any[] = []
  const count: { [m: string]: number } = {}
  const next: any = (req: any) => {
    const model = String(req && req.model)
    seen.push(model)
    reqs.push(req)
    const act = script[model]
    if (!act) throw new Error("next514: нет сценария для " + model)
    const k = count[model] = (count[model] ?? -1) + 1
    return (async function* () {
      const t = await h.m.$.clock.now()
      const r = act(k, t)
      if (r === null) return { usage: { out: 1 }, stopReason: "end_turn", text: "OK-" + model }
      if (r && typeof r === "object" && typeof r.usageModel === "string") return { usage: { out: 1, model: r.usageModel }, stopReason: "end_turn", text: "OK-" + model }
      if (r && typeof r === "object" && r.throwSilent) throw new Error(r.throwSilent)
      if (r && typeof r === "object" && r.silent) return { usage: null, stopReason: null }
      if (r && typeof r === "object" && r.throw) { h.history.push({ role: "assistant", text: r.throw }); throw new Error(r.throw) }
      h.history.push({ role: "assistant", text: String(r) })
      return { usage: null, stopReason: null }
    })()
  }
  next.seen = seen
  next.reqs = reqs
  next.signal = { aborted: false }
  next.budget = { ms: 10000, remainingMs: Infinity }
  return next
}

async function step514(h: any, aid: string, original: string, next: any, extra: any = {}): Promise<any> {
  return await drainStream(hook393(subs393(), "turn.step")(h.m.$, Object.assign({
    agentId: aid, turnId: "t-" + aid, index: 0, model: original, messageCount: 1,
  }, extra), next))
}

async function spawn514(h: any, aid: string, cls: string, model: string, subagentType = "any-agent"): Promise<any> {
  return await hook393(subs393(), "agent.spawn")(h.m.$, {
    subagentType, prompt: "[dispatch-class:" + cls + "] x", model,
  }, async () => ({ agentId: aid }))
}

function journal514(h: any): any[] {
  return shards393(h.m.writes, "/failover/journal.jsonl.shard.")
}

function attempts514(h: any, aid: string): any[] {
  return journal514(h).filter(r => r.agentId === aid && r.attempt !== undefined)
}

function waits514(h: any, aid: string, kind: string): any[] {
  return journal514(h).filter(r => r.agentId === aid && r.outcome === kind)
}

const refuseAll514 = (text: string) => (_k: number, _t: number) => text
const TABLE514 = "/tbl-514/routing-table.toml"

test("#514 H2 / FIX3 M2: хвост «· resets» лимитной строки хоста -- каждый даёт свой readyAt", () => {
  const cr = R514.classifyRefusal
  expect(typeof cr, "classifyRefusal экспортирована").toBe("function")
  const now = Date.parse("2026-09-25T20:10:39Z")
  const cases: Array<[string, string, number]> = [
    ["You've hit your session limit · resets 2:30am (Europe/Volgograd)", "temporary-known", Date.parse("2026-09-25T23:30:00Z")],
    ["You've hit your session limit · resets 9:10pm (Europe/Volgograd)", "temporary-known", Date.parse("2026-09-26T18:10:00Z")],
    ["You've hit your session limit · resets 11pm (Europe/Moscow) · progress saved", "temporary-known", Date.parse("2026-09-25T20:00:00Z") + 86400000],
    ["You've hit your weekly limit · resets Sep 30, 3pm (Europe/Moscow)", "temporary-known", Date.parse("2026-09-30T12:00:00Z")],
    ["You've hit your weekly limit · resets Wed, Sep 30, 3:15pm (Europe/Moscow)", "temporary-known", Date.parse("2026-09-30T12:15:00Z")],
    ["You're out of usage credits · resets 23:45 (UTC)", "temporary-known", Date.parse("2026-09-25T23:45:00Z")],
    ["You've hit your Opus limit · resets Jan 2, 2027, 9am (America/New_York)", "temporary-known", Date.parse("2027-01-02T14:00:00Z")],
    ["You've hit your weekly limit · resets Jan 5, 3pm (UTC)", "temporary-known", Date.parse("2027-01-05T15:00:00Z")],
  ]
  for (const [line, cls, at] of cases) {
    const got = cr(line, now)
    expect({ line, cls: got.class, at: got.readyAt }).toEqual({ line, cls, at })
  }
})

test("#514 H2: нечитаемый, прошедший, отрицательный и безпоясный срок -- срок неизвестен", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-09-25T20:10:39Z")
  for (const line of [
    "API Error: 429 Too Many Requests",
    "API Error: 429 quota held until 2020-01-01T00:00:00Z",
    "API Error: 429 rate limit, reset in -5 minutes",
    "API Error: 429 limit will reset at 2026-09-17 08:24:51",
    "API Error: 429 rate limit, reset in 0s",
    "You've hit your session limit · resets 2:30am (Nowhere/Atlantis)",
    "You've hit your weekly limit · resets Feb 30, 3pm (UTC)",
    "You've hit your weekly limit · resets Jan 2, 2025, 9am (UTC)",
    "",
  ]) {
    const got = cr(line, now)
    expect({ line, cls: got.class, at: got.readyAt }).toEqual({ line, cls: "temporary-unknown", at: 0 })
  }
})

// CONSTRAINT (#514 FIX3 M2): строки -- ДОСЛОВНЫЕ тексты хоста 2.1.282
// (AN-509-HOST-REPORT.md Q2) с заполненными подстановками; по строке на
// каждую строку таблицы брифа и на каждый из 12 префиксов qDr.
const QDR514 = [
  "You've hit your", "You've reached your", "You're out of usage credits",
  "Your org is out of usage · add funds to continue", "Your org is out of usage · contact your admin",
  "Your seat type doesn't include usage credits", "Your seat type doesn't include usage",
  "Your usage allocation has been disabled by your admin", "Your group's usage limit is set to $0",
  "Fable 5 requires usage credits", "You're out of extra usage", "Your seat type doesn't include extra usage",
]

test("#514 FIX3 M2: время «resets» в пределах минуты позади -- срок неизвестен, а не через сутки", () => {
  const cr = R514.classifyRefusal
  const at = Date.parse("2026-09-25T20:00:30Z")
  const got = cr("You've hit your session limit · resets 11pm (Europe/Moscow)", at)
  expect({ cls: got.class, at: got.readyAt }).toEqual({ cls: "temporary-unknown", at: 0 })
  const later = cr("You've hit your session limit · resets 11pm (Europe/Moscow)", Date.parse("2026-09-25T20:01:00Z"))
  expect({ cls: later.class, at: later.readyAt }).toEqual({ cls: "temporary-known", at: Date.parse("2026-09-26T20:00:00Z") })
})

test("#514 H1 / FIX3 M2: классы отказа по таблице хоста 2.1.282 -- по строке на каждую строку таблицы", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-09-25T20:10:39Z")
  const cases: Array<[string, string]> = [
    ["Prompt is too long", "request"],
    ["Prompt is too long · this conversation is a single exchange and cannot be compacted", "request"],
    ["Request too large (max 32MB). Double press esc to go back and try with a smaller file.", "request"],
    ["API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment. If it persists, check https://status.claude.com.", "temporary-unknown"],
    ["API Error: 500 Internal server error. This is a server-side issue, usually temporary — try again in a moment. If it persists, check https://status.claude.com.", "temporary-unknown"],
    ["API Error: Request rejected (429) · rate limited", "temporary-unknown"],
    ["API Error: Server is temporarily limiting requests (not your usage limit) · this may be a temporary capacity issue.", "temporary-unknown"],
    ["Request timed out", "temporary-unknown"],
    ["You've hit your session limit", "temporary-unknown"],
    ["You've hit your session limit · resets soon", "temporary-unknown"],
    ["You've hit your session limit · resets 2:30am (Nowhere/Atlantis)", "temporary-unknown"],
    ["Not logged in · Please run /login", "permanent-model"],
    ["Authentication required · Sign in again to continue", "permanent-model"],
    ["Please run /login · API Error: 401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\"}}", "permanent-model"],
    ["Failed to authenticate. API Error: 401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\"}}", "permanent-model"],
    ["OAuth token revoked · Please run /login", "permanent-model"],
    ["Login expired · Please run /login", "permanent-model"],
    ["Authentication error · The gateway could not authenticate with its upstream provider — contact your gateway administrator", "permanent-model"],
    ["Credit balance is too low", "permanent-model"],
    ["Claude Opus is not available with the Claude Pro plan. If you have updated your subscription plan recently, run /logout and /login for the plan to take effect.", "permanent-model"],
  ]
  for (const pre of QDR514) cases.push([pre + " · resets 2:30am (Europe/Volgograd)", "temporary-known"], [pre, "temporary-unknown"])
  for (const [line, cls] of cases) expect({ line, cls: cr(line, now).class }).toEqual({ line, cls })
  const pick = R514.refusalLineOf
  expect(typeof pick).toBe("function")
  expect(pick("\n  Prompt is too long\nхвост")).toBe("Prompt is too long")
  expect(pick("")).toBe("")
})

test("#514 H3: backoff неизвестного срока 30/60/120/240/240 с, модель -- час, успех снимает", () => {
  const note = R514.noteModelRefusal
  expect(typeof note).toBe("function")
  const marks = new Map<string, any>()
  const untils: number[] = []
  for (let i = 0; i < 5; i++) untils.push(note("m514b", 1000 * i, "temporary-unknown", 0, "carrier-refusal", "t", marks).until - 1000 * i)
  expect(untils).toEqual([30000, 60000, 120000, 240000, 240000])
  const p = note("m514p", 5000, "permanent-model", 0, "carrier-refusal", "t", marks)
  expect(p.until).toBe(5000 + 3600000)
  expect(p.class).toBe("permanent-model")
  const k = note("m514k", 5000, "temporary-known", 99000, "carrier-refusal", "t", marks)
  expect(k.until).toBe(99000)
  expect(isModelCooling("m514k", 98999, marks)).toBe(true)
  expect(isModelCooling("m514k", 99000, marks)).toBe(false)
  R514.noteModelSuccess("m514b", marks)
  expect(marks.has("m514b")).toBe(false)
  expect(note("m514b", 9000, "temporary-unknown", 0, "carrier-refusal", "t", marks).until).toBe(9000 + 30000)
})

test("#514 J5(а): все отказывают со сроком «resets» через 2 мин -- ожидание до readyAt, перепроба, успех", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 10, 0, 0)
  const h = host514("a", T0)
  failoverBindSet("ag-514a", { ladder: ["r514a"], terminal: "claude-t514a", rungEffort: { "r514a": "max" }, subagentType: "t514", class: "", sticky: null })
  const text = "You've hit your session limit · resets 10:02am (UTC)"
  const next = next514(h, {
    "in514a": refuseAll514(text),
    "r514a": (_k, t) => (t >= T0 + 120000 ? null : text),
    "claude-t514a": refuseAll514(text),
  })
  const out = await step514(h, "ag-514a", "in514a", next)
  expect(out.value && out.value.text, "агент жив: ответ ступени после ожидания").toBe("OK-r514a")
  expect(next.seen.slice(0, 3), "первый проход целиком").toEqual(["in514a", "r514a", "claude-t514a"])
  expect(next.seen.slice(3), "после срока -- полный проход от объявленной").toEqual(["in514a", "r514a"])
  const begin = waits514(h, "ag-514a", "wait-begin")
  expect(begin.length).toBe(1)
  expect(begin[0].refusalClass).toBe("temporary-known")
  expect(begin[0].wakeAt).toBe(new Date(T0 + 120000).toISOString())
  expect(waits514(h, "ag-514a", "wait-probe").map(r => r.kind)).toEqual(["wake"])
  expect(h.sleeps.length, "ожидание кусками по 4 с").toBe(30)
  for (const c of h.procCalls) expect(c).toEqual({ argv: ["/bin/sleep", "4.000"], init: { timeoutMs: 9000 } })
  expect(h.m.toasts.length, "один тост на эпизод").toBe(1)
  expect(h.m.toasts[0]).toContain("агент t514 ждёт сброса лимита")
  const recs = attempts514(h, "ag-514a")
  expect(recs[0].refusalClass).toBe("temporary-known")
  expect(recs[0].refusalText).toBe(text)
  failoverBindReset()
})

test("#514 J5(б): permanent-model пропускается во втором шаге, skipped-dead один раз", async () => {
  reset514()
  const T0 = 514_200_000
  const h = host514("b", T0)
  failoverBindSet("ag-514b", { ladder: ["dead514b"], terminal: "claude-t514b", rungEffort: { "dead514b": "max" }, subagentType: "t", class: "", sticky: null })
  const next = next514(h, {
    "in514b": refuseAll514("API Error: 429 rate limit"),
    "dead514b": refuseAll514("Credit balance is too low"),
    "claude-t514b": () => null,
  })
  await step514(h, "ag-514b", "in514b", next)
  expect(next.seen).toEqual(["in514b", "dead514b", "claude-t514b"])
  const next2 = next514(h, {
    "in514b": refuseAll514("API Error: 429 rate limit"),
    "claude-t514b": () => null,
  })
  await step514(h, "ag-514b", "in514b", next2, { index: 1 })
  expect(next2.seen, "мёртвая пропущена, остывающая объявленная отложена").toEqual(["in514b", "claude-t514b"])
  const next3 = next514(h, { "in514b": refuseAll514("API Error: 429 rate limit"), "claude-t514b": () => null })
  await step514(h, "ag-514b", "in514b", next3, { index: 2 })
  const dead = journal514(h).filter(r => r.outcome === "skipped-dead")
  expect(dead.length, "один раз на (процесс, модель, метка)").toBe(1)
  expect(dead[0].model).toBe("dead514b")
  const term = attempts514(h, "ag-514b").filter(r => r.terminal && r.index === 1)
  expect(term.length).toBe(1)
  expect(term[0].rungsSkippedDead).toEqual(["dead514b"])
  failoverBindReset()
})

test("#514 J5(в): успех модели снимает её метку", async () => {
  reset514()
  const T0 = 514_300_000
  const h = host514("c", T0)
  failoverBindSet("ag-514c", { ladder: [], terminal: "claude-t514c", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in514c": (k) => (k === 0 ? "API Error: 429 rate limit" : null), "claude-t514c": () => null })
  await step514(h, "ag-514c", "in514c", next)
  expect(isModelCooling("in514c", T0 + 1)).toBe(true)
  h.m.setNow(T0 + 31000)
  await step514(h, "ag-514c", "in514c", next, { index: 1 })
  expect(isModelCooling("in514c", T0 + 31000)).toBe(false)
  const snap = cooldownSnapshot(T0 + 31000).filter(r => r.model === "in514c")
  expect(snap).toEqual([])
  const again = R514.noteModelRefusal("in514c", T0 + 32000, "temporary-unknown", 0, "carrier-refusal", "")
  expect(again.until - (T0 + 32000), "счёт подряд идущих отказов сброшен успехом").toBe(30000)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 J5(г): после истечения метки объявленная модель первой при живой липкой", async () => {
  reset514()
  const T0 = 514_400_000
  const h = host514("g", T0)
  failoverBindSet("ag-514g", { ladder: ["r514g"], terminal: "claude-t514g", rungEffort: { "r514g": "max" }, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in514g": (k) => (k === 0 ? "API Error: 429 rate limit" : null), "r514g": () => null, "claude-t514g": () => null })
  await step514(h, "ag-514g", "in514g", next)
  expect(failoverBindGet("ag-514g").sticky).toBe("r514g")
  h.m.setNow(T0 + 31000)
  const next2 = next514(h, { "in514g": () => null, "r514g": () => null, "claude-t514g": () => null })
  await step514(h, "ag-514g", "in514g", next2, { index: 1 })
  expect(next2.seen, "объявленная первой, не липкая").toEqual(["in514g"])
  const next3 = next514(h, { "in514g": refuseAll514("API Error: 429 rate limit"), "r514g": () => null, "claude-t514g": () => null })
  await step514(h, "ag-514g", "in514g", next3, { index: 2 })
  expect(next3.seen, "липкая второй").toEqual(["in514g", "r514g"])
  rungCooldownReset()
  failoverBindReset()
})

test("#514 J5(д): прерывание во время ожидания -- wait-aborted, без броска", async () => {
  reset514()
  const T0 = 514_500_000
  let next: any = null
  const h = host514("d", T0, { sleepHook: (n) => { if (n === 3) next.signal.aborted = true } })
  failoverBindSet("ag-514d", { ladder: [], terminal: "claude-t514d", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  next = next514(h, { "in514d": refuseAll514("API Error: 429 rate limit"), "claude-t514d": refuseAll514("API Error: 429 rate limit") })
  const out = await step514(h, "ag-514d", "in514d", next)
  expect(isCarrierRefusal(out.value), "возвращён последний ответ").toBe(true)
  expect(h.sleeps.length).toBe(3)
  const ab = waits514(h, "ag-514d", "wait-aborted")
  expect(ab.length).toBe(1)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 J5(е): бюджет хука ниже 1500 мс -- wait-budget-exhausted", async () => {
  reset514()
  const T0 = 514_600_000
  const h = host514("e", T0)
  failoverBindSet("ag-514e", { ladder: [], terminal: "claude-t514e", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in514e": refuseAll514("API Error: 429 rate limit"), "claude-t514e": refuseAll514("API Error: 429 rate limit") })
  next.budget = { ms: 10000, remainingMs: 1499 }
  const out = await step514(h, "ag-514e", "in514e", next)
  expect(isCarrierRefusal(out.value)).toBe(true)
  expect(h.sleeps.length).toBe(0)
  const ex = waits514(h, "ag-514e", "wait-budget-exhausted")
  expect(ex.length).toBe(1)
  expect(ex[0].reason).toBe("бюджет хука хоста")
  rungCooldownReset()
  failoverBindReset()
})

test("#514 J5(ж): класс request -- без ожидания", async () => {
  reset514()
  const T0 = 514_700_000
  const h = host514("j", T0)
  failoverBindSet("ag-514j", { ladder: [], terminal: "claude-t514j", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const txt = "Prompt is too long"
  const next = next514(h, { "in514j": refuseAll514(txt), "claude-t514j": refuseAll514(txt) })
  const out = await step514(h, "ag-514j", "in514j", next)
  expect(isCarrierRefusal(out.value)).toBe(true)
  expect(next.seen).toEqual(["in514j", "claude-t514j"])
  expect(h.sleeps.length).toBe(0)
  expect(waits514(h, "ag-514j", "wait-begin").length).toBe(0)
  expect(attempts514(h, "ag-514j").map(r => r.refusalClass)).toEqual(["request", "request"])
  rungCooldownReset()
  failoverBindReset()
})

test("#514 J5(з): сердцебиение -- перепроба не реже 240 с по часам", async () => {
  reset514()
  const T0 = 514_800_000
  const h = host514("z", T0)
  failoverBindSet("ag-514z", { ladder: ["r514z"], terminal: "claude-t514z", rungEffort: { "r514z": "max" }, subagentType: "t", class: "", sticky: null })
  const txt = "You've hit your session limit · resets 12am (UTC)"
  const next = next514(h, {
    "in514z": (_k, t) => (t >= T0 + 700000 ? null : txt),
    "r514z": refuseAll514(txt),
    "claude-t514z": refuseAll514(txt),
  })
  const out = await step514(h, "ag-514z", "in514z", next)
  expect(out.value && out.value.text).toBe("OK-in514z")
  const probes = waits514(h, "ag-514z", "wait-probe")
  expect(probes.length).toBeGreaterThan(1)
  let prev = Date.parse(waits514(h, "ag-514z", "wait-begin")[0].t)
  for (const p of probes) {
    expect(p.kind).toBe("heartbeat")
    const t = Date.parse(p.t)
    expect(t - prev).toBeLessThanOrEqual(240000)
    prev = t
  }
  rungCooldownReset()
  failoverBindReset()
})

test("#514 J5(и): нечитаемый срок -- temporary-unknown с backoff в метке", async () => {
  reset514()
  const T0 = 514_900_000
  const h = host514("i", T0, { noProc: true })
  failoverBindSet("ag-514i", { ladder: [], terminal: "claude-t514i", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in514i": refuseAll514("API Error: 429 Too Many Requests"), "claude-t514i": () => null })
  await step514(h, "ag-514i", "in514i", next)
  const rec = attempts514(h, "ag-514i")[0]
  expect(rec.refusalClass).toBe("temporary-unknown")
  expect(isModelCooling("in514i", T0 + 29999)).toBe(true)
  expect(isModelCooling("in514i", T0 + 30000)).toBe(false)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 J5(к): отказ session.messages -- temporary-unknown и noteLost", async () => {
  reset514()
  const T0 = 515_000_000
  const h = host514("k", T0, { noProc: true })
  h.messagesThrow = true
  failoverBindSet("ag-514k", { ladder: [], terminal: "claude-t514k", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in514k": refuseAll514("API Error: 400 unknown provider for model in514k"), "claude-t514k": () => null })
  await step514(h, "ag-514k", "in514k", next)
  expect(h.messageArgs[0]).toEqual({ agentId: "ag-514k" })
  const rec = attempts514(h, "ag-514k")[0]
  expect(rec.refusalClass).toBe("temporary-unknown")
  expect(rec.lost && rec.lost["failover-refusal-messages"] && rec.lost["failover-refusal-messages"].n).toBe(1)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 H8: бросок без прерывания -- не пробрасывается, ожидание без двери названо", async () => {
  reset514()
  const T0 = 515_100_000
  const h = host514("t", T0, { noProc: true })
  failoverBindSet("ag-514t", { ladder: [], terminal: "claude-t514t", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in514t": () => ({ throw: "boom" }), "claude-t514t": () => ({ throw: "boom2" }) })
  let threw: any = null
  try { await step514(h, "ag-514t", "in514t", next) } catch (x) { threw = x }
  expect(threw, "исчерпанный проход не бросает").toBe(null)
  expect(next.seen).toEqual(["in514t", "claude-t514t"])
  expect(attempts514(h, "ag-514t").map(r => r.refusalClass)).toEqual(["temporary-unknown", "temporary-unknown"])
  expect(waits514(h, "ag-514t", "wait-unavailable").length).toBe(1)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 H8: бросок при прерванном сигнале -- lastRes без броска и без ожидания", async () => {
  reset514()
  const T0 = 515_200_000
  const h = host514("u", T0)
  failoverBindSet("ag-514u", { ladder: [], terminal: "claude-t514u", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  let next: any = null
  next = next514(h, { "in514u": () => { next.signal.aborted = true; return { throw: "aborted" } }, "claude-t514u": () => null })
  let threw: any = null
  let out: any = null
  try { out = await step514(h, "ag-514u", "in514u", next) } catch (x) { threw = x }
  expect(threw).toBe(null)
  expect(out.value).toBe(null)
  expect(next.seen).toEqual(["in514u"])
  expect(h.sleeps.length).toBe(0)
  rungCooldownReset()
  failoverBindReset()
})

// CONSTRAINT (#514 FIX2 Д3): метка отказа не переживает проход -- стенд
// сбрасывает метки на первом чтении next.budget после нового вызова модели
// (budgetLeft читает его раз за тик цикла ожидания). Своего предела вызовов
// у зубов ожидания нет: под мутацией, снявшей паузу, process.run не зовётся
// вовсе, и прогон держит конечным предел модели стенда (stand-cap-514.ts).

function unmarked514(next: any, after: (calls: number) => boolean = () => true): void {
  let resetAt = -1
  Object.defineProperty(next, "budget", {
    get: () => {
      if (next.seen.length !== resetAt) {
        resetAt = next.seen.length
        if (after(resetAt)) rungCooldownReset()
      }
      return { ms: 10000, remainingMs: Infinity }
    },
  })
}

test("#514 FIX2 Д3(а): метка не переживает проход -- кусок паузы между любыми двумя вызовами, выход по пределу стенда wait-unavailable", async () => {
  reset514()
  const T0 = 516_600_000
  const h = host514("pa", T0)
  failoverBindSet("ag-514pa", { ladder: ["m514pa"], terminal: "", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  // Метка первого вызова (минута = 15 кусков) живёт, дальше метки
  // сбрасываются: предел двери паузы наступает раньше предела модели стенда.
  const sleepsAtCall: number[] = []
  const next = next514(h, {
    "m514pa": (k) => {
      sleepsAtCall.push(h.sleeps.length)
      return k === 0 ? "You've hit your session limit · resets 11:31pm (UTC)" : "API Error: Request rejected (429) · rate limited"
    },
  })
  unmarked514(next, (calls) => calls > 1)
  const out = await step514(h, "ag-514pa", "m514pa", next)
  expect(isCarrierRefusal(out.value), "возвращён последний ответ").toBe(true)
  const calls = next.seen.length
  expect(h.sleeps.length >= calls - 1, "кусков паузы " + String(h.sleeps.length) + " при вызовах " + String(calls)).toBe(true)
  expect(sleepsAtCall[1] - sleepsAtCall[0], "метка минута -- 15 кусков").toBe(15)
  const gaps: string[] = []
  for (let i = 2; i < sleepsAtCall.length; i++) {
    const d = sleepsAtCall[i] - sleepsAtCall[i - 1]
    if (d !== 1) gaps.push("вызов " + String(i) + ": кусков " + String(d))
  }
  expect(gaps, "без метки -- ровно один кусок между соседними вызовами").toEqual([])
  expect(h.sleeps.length, "успешных кусков -- предел стенда").toBe(2000)
  expect(calls, "вызов после каждого куска, начиная с пятнадцатого").toBe(1987)
  const un = waits514(h, "ag-514pa", "wait-unavailable")
  expect(un.length).toBe(1)
  expect(String(un[0].reason)).toContain("stand: process.run call cap 2000")
  expect(waits514(h, "ag-514pa", "wait-aborted").length, "выход не по пределу вызовов зуба").toBe(0)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX2: прерывание во время обязательной паузы отпускает шаг -- wait-aborted, второго вызова нет", async () => {
  for (const mode of ["return", "throw"]) {
    reset514()
    const T0 = mode === "return" ? 516_700_000 : 516_800_000
    let next: any = null
    const h = host514("pb" + mode, T0, {
      sleepHook: (n) => {
        if (n !== 1) return
        next.signal.aborted = true
        if (mode === "throw") throw new Error("sleep: killed by abort")
      },
    })
    const aid = "ag-514pb" + mode
    const model = "m514pb" + mode
    failoverBindSet(aid, { ladder: [model], terminal: "", rungEffort: {}, subagentType: "t", class: "", sticky: null })
    next = next514(h, { [model]: refuseAll514("API Error: 429 rate limit") })
    unmarked514(next)
    let threw: any = null
    let out: any = null
    try { out = await step514(h, aid, model, next) } catch (x) { threw = x }
    expect({ mode, threw }).toEqual({ mode, threw: null })
    expect(isCarrierRefusal(out.value), mode + ": возвращён последний ответ").toBe(true)
    expect({ mode, calls: next.seen.length, sleeps: h.sleeps.length }).toEqual({ mode, calls: 1, sleeps: 1 })
    expect({ mode, aborted: waits514(h, aid, "wait-aborted").length, unavailable: waits514(h, aid, "wait-unavailable").length }).toEqual({ mode, aborted: 1, unavailable: 0 })
    rungCooldownReset()
    failoverBindReset()
  }
})

test("#514 FIX2: после перепробы сердцебиения метка снята -- кусок паузы до вызова пробуждения", async () => {
  reset514()
  const T0 = 516_900_000
  const h = host514("pc", T0)
  failoverBindSet("ag-514pc", { ladder: ["m514pc"], terminal: "", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const sleepsAtCall: number[] = []
  const next = next514(h, {
    "m514pc": (k) => {
      sleepsAtCall.push(h.sleeps.length)
      return k >= 2 ? null : "You've hit your session limit · resets 12:35am (UTC)"
    },
  })
  unmarked514(next, (calls) => calls === 2)
  const out = await step514(h, "ag-514pc", "m514pc", next)
  expect(out.value && out.value.text, "пробуждение после паузы -- успех").toBe("OK-m514pc")
  expect(waits514(h, "ag-514pc", "wait-probe").map(r => r.kind)).toEqual(["heartbeat", "wake"])
  expect(sleepsAtCall, "сердцебиение на 240 с, пробуждение -- через один кусок").toEqual([0, 60, 61])
  rungCooldownReset()
  failoverBindReset()
})

// CONSTRAINT (#514 FIX2b): страж зуба предела модели -- не предел сценария:
// цикл зуба сам не останавливается, страж держит конечным прогон под
// мутацией, снявшей предел стенда.
const WATCHDOG514 = 5000

test("#514 FIX2b: предел вызовов модели стенда -- цикл без паузы и без своего предела падает броском стенда", async () => {
  reset514()
  const h = host514("mc", 517_000_000, { noProc: true })
  failoverBindSet("ag-514mc", { ladder: [], terminal: "claude-t514mc", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "m514mc": () => null, "claude-t514mc": () => null })
  const step = hook393(subs393(), "turn.step")
  let err: any = null
  let steps = 0
  try {
    for (; steps < WATCHDOG514; steps++) {
      await drainStream(step(h.m.$, { agentId: "ag-514mc", turnId: "t-514mc", index: steps, model: "m514mc", messageCount: 1 }, next))
    }
  } catch (x) { err = x }
  expect(String(err && err.message), "цикл прерван броском стенда").toBe("stand: model call cap 2000")
  expect({ steps, calls: next.seen.length }).toEqual({ steps: 2000, calls: 2000 })
  failoverBindReset()
})

test("#514 FIX2b H1 / FIX3 M2: префикс таблицы решает по началу строки, не по вхождению", () => {
  const cr = R514.classifyRefusal
  const cases: Array<[string, string]> = [
    ["Please run /login · API Error: 429 Request rejected (429) · rate limited", "permanent-model"],
    ["API Error: 400 Prompt is too long", "request"],
    ["API Error: 409 Prompt is too long", "temporary-unknown"],
    ["API Error: 402 Credit balance is too low", "quota"],
    ["  Prompt is too long", "request"],
  ]
  for (const [line, cls] of cases) expect({ line, cls: cr(line, 1_000_000).class }).toEqual({ line, cls })
})

test("#514 FIX2b H2: ISO без пояса в будущем -- срок неизвестен", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-09-25T20:10:39Z")
  for (const line of [
    "API Error: 429 quota held until 2026-09-28T04:00:00",
    "API Error: 429 limit reset at 2026-09-28 04:00:00",
  ]) {
    const got = cr(line, now)
    expect({ line, cls: got.class, at: got.readyAt }).toEqual({ line, cls: "temporary-unknown", at: 0 })
  }
})

test("#514 FIX2b H1: текст отказа в улике попытки урезан до REFUSAL_TEXT_MAX", async () => {
  reset514()
  const h = host514("tc", 517_100_000, { noProc: true })
  failoverBindSet("ag-514tc", { ladder: [], terminal: "claude-t514tc", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const line = "Prompt is too long · the request is ~" + "x".repeat(400)
  const next = next514(h, { "in514tc": refuseAll514(line), "claude-t514tc": refuseAll514(line) })
  await step514(h, "ag-514tc", "in514tc", next)
  const recs = attempts514(h, "ag-514tc")
  expect(recs.length).toBe(2)
  for (const r of recs) expect({ len: String(r.refusalText).length, head: r.refusalText === line.slice(0, R514.REFUSAL_TEXT_MAX) }).toEqual({ len: R514.REFUSAL_TEXT_MAX, head: true })
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX2b H3: skipped-dead один раз и через два прохода пробуждения одного шага", async () => {
  reset514()
  const T0 = 517_200_000
  const h = host514("sk", T0)
  failoverBindSet("ag-514sk", { ladder: ["dead514sk"], terminal: "claude-t514sk", rungEffort: { "dead514sk": "max" }, subagentType: "t", class: "", sticky: null })
  const soon = "API Error: 503 auth_unavailable; soonest recovery in 8s"
  const next = next514(h, {
    "in514sk": (k) => (k >= 2 ? null : soon),
    "dead514sk": refuseAll514("Credit balance is too low"),
    "claude-t514sk": refuseAll514(soon),
  })
  const out = await step514(h, "ag-514sk", "in514sk", next)
  expect(out.value && out.value.text).toBe("OK-in514sk")
  expect(next.seen, "два прохода пробуждения без мёртвой").toEqual(["in514sk", "dead514sk", "claude-t514sk", "in514sk", "claude-t514sk", "in514sk"])
  expect(waits514(h, "ag-514sk", "wait-probe").map(r => r.kind)).toEqual(["wake", "wake"])
  const dead = journal514(h).filter(r => r.outcome === "skipped-dead")
  expect(dead.length, "один раз на (процесс, модель, метка), не на попытку").toBe(1)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX2b H5: все модели прохода permanent-model -- wait-begin несёт permanentOnly", async () => {
  reset514()
  const T0 = 517_300_000
  let next: any = null
  const h = host514("pp", T0, { sleepHook: (n) => { if (n === 2) next.signal.aborted = true } })
  failoverBindSet("ag-514pp", { ladder: [], terminal: "claude-t514pp", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  next = next514(h, {
    "in514pp": refuseAll514("Credit balance is too low"),
    "claude-t514pp": refuseAll514("Not logged in · Please run /login"),
  })
  await step514(h, "ag-514pp", "in514pp", next)
  const begin = waits514(h, "ag-514pp", "wait-begin")
  expect(begin.length).toBe(1)
  expect({ permanentOnly: begin[0].permanentOnly, wakeAt: begin[0].wakeAt }).toEqual({ permanentOnly: true, wakeAt: new Date(T0 + 3600000).toISOString() })
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX2b s1: проектный слой перекрывает терминал глобального", async () => {
  const m = mod$393({
    files: {
      "/hh-s1-514/.claude/probes/probes.toml": '[failover]\nenabled = true\nterminal = "claude-g514s1"\n',
      "/work-s1-514/.claude/probes/probes.toml": '[failover]\nterminal = "claude-p514s1"\n',
    },
    now: 517_400_000,
  })
  const world = await loadWorld(m.$, { PROBES_DIR: "", ROUTING_TABLE: "", CONFIG_DIR: "", HOME: "/hh-s1-514", PWD: "/work-s1-514" }, "/work-s1-514")
  expect(world.failover.terminal).toBe("claude-p514s1")
  const m2 = mod$393({
    files: {
      "/hh-s1b-514/.claude/probes/probes.toml": '[failover]\nenabled = true\nterminal = "claude-g514s1"\n',
      "/work-s1b-514/.claude/probes/probes.toml": '[failover]\nenabled = true\n',
    },
    now: 517_410_000,
  })
  const world2 = await loadWorld(m2.$, { PROBES_DIR: "", ROUTING_TABLE: "", CONFIG_DIR: "", HOME: "/hh-s1b-514", PWD: "/work-s1b-514" }, "/work-s1b-514")
  expect(world2.failover.terminal, "без ключа в проекте -- глобальный").toBe("claude-g514s1")
})

test("#509-FIX2b s3 (D-3a): одноимённая ступень лестницы сохраняет свой эффорт против эффорта терминала", async () => {
  reset514()
  const h = host514("s3", 517_500_000, {
    probes: '[failover]\nenabled = true\nterminal = {model = "claude-s3514", effort = "max"}\n\n[failover.class.c514s3]\nmodels = [{model = "claude-s3514", effort = "high"}]\n',
    noProc: true,
  })
  await spawn514(h, "ag-514s3", "c514s3", "in514s3")
  expect(failoverBindGet("ag-514s3").rungEffort["claude-s3514"]).toBe("high")
  const h2 = host514("s3b", 517_510_000, {
    probes: '[failover]\nenabled = true\nterminal = {model = "claude-s3b514", effort = "max"}\n',
    noProc: true,
  })
  await spawn514(h2, "ag-514s3b", "c514s3b", "in514s3b")
  expect(failoverBindGet("ag-514s3b").rungEffort["claude-s3b514"], "без одноимённой ступени -- эффорт терминала").toBe("max")
  failoverBindReset()
})

test("#509-FIX1 A1: мир несёт слитый допуск (база + машинный слой)", async () => {
  const m = mod$393({
    files: {
      [TABLE514]: '[classes.c514w]\nallowed = ["a1", "a2"]\n[classes.c514v]\nallowed = ["v1", "v2"]\n',
      "/home514w/.claude/catalyst/routing-override.toml": '[classes.c514w]\nallowed = ["a2", "a3"]\n',
    },
    now: 515_300_000,
  })
  const world = await loadWorld(m.$, { PROBES_DIR: "/probes-514w", HOME: "/home514w", ROUTING_TABLE: TABLE514 }, "")
  expect(world.allowedByClass, "поле мира живо").toEqual({ c514w: ["a2", "a3"], c514v: ["v1", "v2"] })
})

test("#509-FIX1 A2: ступень вне допуска не вызывается, rung-not-admitted один раз на процесс", async () => {
  reset514()
  const T0 = 515_400_000
  const h = host514("n", T0, {
    probes: '[failover]\nenabled = true\nterminal = "claude-opus-5-5"\n\n[failover.class.c514n]\nmodels = [{model = "Grok-X514", effort = "max"}, {model = "bad514", effort = "max"}, {model = "x3514", effort = "max"}]\n',
    files: { [TABLE514]: '[classes.c514n]\nallowed = ["grok-x514", "x3514", "in514n"]\n' },
    env: { CATALYST_ROUTING_TABLE: TABLE514 },
  })
  await spawn514(h, "ag-514n", "c514n", "in514n")
  await spawn514(h, "ag-514n2", "c514n", "in514n")
  expect(failoverBindGet("ag-514n").ladder).toEqual(["Grok-X514", "x3514"])
  const na = journal514(h).filter(r => r.outcome === "rung-not-admitted")
  expect(na.length).toBe(1)
  expect({ class: na[0].class, model: na[0].model }).toEqual({ class: "c514n", model: "bad514" })
  const next = next514(h, { "in514n": refuseAll514("API Error: 429 x"), "Grok-X514": refuseAll514("API Error: 429 x"), "x3514": refuseAll514("API Error: 429 x"), "claude-opus-5-5": () => null })
  await step514(h, "ag-514n", "in514n", next)
  expect(next.seen).toEqual(["in514n", "Grok-X514", "x3514", "claude-opus-5-5"])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX1 A3: допуск недоступен -- проход = объявленная + терминал, admission-unavailable один раз", async () => {
  reset514()
  const T0 = 515_500_000
  const h = host514("q", T0, {
    probes: '[failover]\nenabled = true\nterminal = "claude-opus-5-5"\n\n[failover.class.c514q]\nmodels = [{model = "r514q", effort = "max"}]\n',
    noProc: true,
  })
  await spawn514(h, "ag-514q", "c514q", "in514q")
  await spawn514(h, "ag-514q2", "c514q", "in514q")
  expect(failoverBindGet("ag-514q").ladder).toEqual([])
  expect(journal514(h).filter(r => r.outcome === "admission-unavailable").length).toBe(1)
  const next = next514(h, { "in514q": refuseAll514("API Error: 429 x"), "claude-opus-5-5": () => null })
  await step514(h, "ag-514q", "in514q", next)
  expect(next.seen).toEqual(["in514q", "claude-opus-5-5"])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX1 J4: производственная форма -- голый terminal вызван, поле effort удалено", async () => {
  reset514()
  const T0 = 515_600_000
  const h = host514("p", T0, {
    probes: '[failover]\nenabled = true\nterminal = "claude-opus-5-5"\n\n[failover.class.c514p]\nmodels = [{model = "r514p", effort = "max"}]\n',
    files: { [TABLE514]: '[classes.c514p]\nallowed = ["r514p"]\n' },
    env: { CATALYST_ROUTING_TABLE: TABLE514 },
    noProc: true,
  })
  await spawn514(h, "ag-514p", "c514p", "in514p")
  const next = next514(h, { "in514p": refuseAll514("API Error: 429 x"), "r514p": refuseAll514("API Error: 429 x"), "claude-opus-5-5": () => null })
  const out = await step514(h, "ag-514p", "in514p", next, { effort: "max" })
  expect(next.seen).toEqual(["in514p", "r514p", "claude-opus-5-5"])
  expect(out.value && out.value.text).toBe("OK-claude-opus-5-5")
  const req = next.reqs[2]
  expect(req.model).toBe("claude-opus-5-5")
  expect(Object.prototype.hasOwnProperty.call(req, "effort"), "запрос терминала без поля effort").toBe(false)
  expect(next.reqs[1].effort).toBe("max")
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX1 B2: негодный эффорт Anthropic-терминала -- отказ с названной причиной", async () => {
  reset514()
  const T0 = 515_700_000
  const h = host514("x", T0, {
    probes: '[failover]\nenabled = true\nterminal = {model = "claude-opus-5-5", effort = "bogus"}\n',
    noProc: true,
  })
  await spawn514(h, "ag-514x", "c514x", "in514x")
  const next = next514(h, { "in514x": refuseAll514("Prompt is too long") })
  await step514(h, "ag-514x", "in514x", next)
  expect(next.seen).toEqual(["in514x"])
  const refused = attempts514(h, "ag-514x").filter(r => r.outcome === "rung-effort-refused")
  expect(refused.length).toBe(1)
  expect(refused[0].reason).toBe("эффорт негоден: bogus")
  expect(refused[0]["effortBad_claude-opus-5-5"]).toBe("bogus")
  failoverBindReset()
})

test("#509-FIX1 C2 / FIX3 H1: терминал, совпавший со ступенью, -- только последним; объявленная на терминале -- первой и один раз", async () => {
  reset514()
  const T0 = 515_800_000
  const h = host514("c2", T0, { noProc: true })
  failoverBindSet("ag-514c2", { ladder: ["claude-t514c2", "r514c2"], terminal: "claude-t514c2", rungEffort: { "r514c2": "max" }, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in514c2": refuseAll514("Prompt is too long"), "r514c2": refuseAll514("Prompt is too long"), "claude-t514c2": refuseAll514("Prompt is too long") })
  await step514(h, "ag-514c2", "in514c2", next)
  expect(next.seen).toEqual(["in514c2", "r514c2", "claude-t514c2"])
  const recs = attempts514(h, "ag-514c2")
  expect(recs.map(r => r.terminal)).toEqual([undefined, undefined, true])
  failoverBindSet("ag-514c3", { ladder: ["r514c3"], terminal: "claude-t514c3", rungEffort: { "r514c3": "max" }, subagentType: "t", class: "", sticky: null })
  const next2 = next514(h, { "r514c3": refuseAll514("Prompt is too long"), "claude-t514c3": refuseAll514("Prompt is too long") })
  await step514(h, "ag-514c3", "claude-t514c3", next2)
  expect(next2.seen, "объявленная на терминале -- первой, второй раз не добавлена").toEqual(["claude-t514c3", "r514c3"])
  const recs2 = attempts514(h, "ag-514c3")
  expect(recs2.map(r => r.terminal)).toEqual([undefined, undefined])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX1 D: проверяющий -- терминал модели исполнителя снят и при пустой базе", async () => {
  reset514()
  sessionExecutorModelAdd("claude-t514dd")
  const T0 = 515_900_000
  const h = host514("dd", T0, { noProc: true })
  failoverBindSet("ag-514dd", { ladder: [], terminal: "claude-t514dd", rungEffort: {}, subagentType: "t", class: "crit-mech", sticky: null })
  const next = next514(h, { "": () => null, "claude-t514dd": () => null })
  await step514(h, "ag-514dd", "", next)
  expect(next.seen, "терминал исполнителя не вызван").toEqual([""])
  sessionExecutorsReset()
  failoverBindReset()
})

test("#509-FIX1 E1/E2 / FIX3 AR-4: терминал сравнивается нормализованным, в запрос уходит как написан; алиасы отвергнуты", async () => {
  const ft = R514.failoverTerminal
  expect(ft({ terminal: " Claude-Opus-5-5[1m] " })).toEqual({ model: " Claude-Opus-5-5[1m] ", effort: "", effortBad: "", absent: "" })
  for (const a of ["opus", " Fable ", "sonnet", "HAIKU"]) {
    expect({ a, got: ft({ terminal: a }) }).toEqual({ a, got: { model: "", effort: "", effortBad: "", absent: "terminal-alias-refused" } })
  }
  reset514()
  const h = host514("e1", 516_000_000, { probes: '[failover]\nenabled = true\nterminal = " Claude-Opus-5-5[1m] "\n', noProc: true })
  await spawn514(h, "ag-514e1", "c514e1", "in514e1")
  expect(failoverBindGet("ag-514e1").terminal).toBe(" Claude-Opus-5-5[1m] ")
  const next = next514(h, { "in514e1": refuseAll514("Prompt is too long"), " Claude-Opus-5-5[1m] ": () => null })
  await step514(h, "ag-514e1", "in514e1", next)
  expect(next.reqs[1].model, "в запрос уходит строка канона как написана").toBe(" Claude-Opus-5-5[1m] ")
  const h2 = host514("e2", 516_100_000, { probes: '[failover]\nenabled = true\nterminal = "opus"\n', noProc: true })
  await spawn514(h2, "ag-514e2", "c514e2", "in514e2")
  expect(failoverBindGet("ag-514e2").terminal).toBe("")
  const ab = journal514(h2).filter(r => String(r.rec).indexOf("terminal-absent-") === 0)
  expect(ab.length).toBe(1)
  expect(ab[0].reason).toBe("terminal-alias-refused")
  failoverBindReset()
})

test("#509-FIX1 E3: паритет разбора терминала -- одна таблица, вердикт мода", async () => {
  const rows: any[] = TERMINAL_PARITY_509
  expect(Array.isArray(rows) && rows.length >= 10).toBe(true)
  const ft = R514.failoverTerminal
  for (const row of rows) {
    const fo = row.absent ? {} : { terminal: row.raw }
    const got = ft(fo)
    const verdict = got.absent || got.effortBad ? "red" : "green"
    expect({ raw: row.raw, verdict }).toEqual({ raw: row.raw, verdict: row.verdict })
  }
})

test("#509-FIX1 G: terminal-absent один раз на процесс; при ключе -- ноль", async () => {
  reset514()
  const h = host514("g1", 516_200_000, { noProc: true })
  for (const aid of ["ag-514g1a", "ag-514g1b", "ag-514g1c"]) await spawn514(h, aid, "c514g", "in514g")
  expect(journal514(h).filter(r => String(r.rec).indexOf("terminal-absent-") === 0).length).toBe(1)
  reset514()
  const h2 = host514("g2", 516_300_000, { probes: '[failover]\nenabled = true\nterminal = "claude-opus-5-5"\n', noProc: true })
  for (const aid of ["ag-514g2a", "ag-514g2b"]) await spawn514(h2, aid, "c514g", "in514g")
  expect(journal514(h2).filter(r => String(r.rec).indexOf("terminal-absent-") === 0).length).toBe(0)
  failoverBindReset()
})

test("#509-FIX1 I: rungsTried -- только вызванные; отказанные по эффорту отдельным списком", async () => {
  reset514()
  const h = host514("ii", 516_400_000, { noProc: true })
  failoverBindSet("ag-514ii", { ladder: ["bare514ii", "r514ii"], terminal: "claude-t514ii", rungEffort: { "r514ii": "max" }, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in514ii": refuseAll514("Prompt is too long"), "r514ii": refuseAll514("Prompt is too long"), "claude-t514ii": refuseAll514("Prompt is too long") })
  await step514(h, "ag-514ii", "in514ii", next)
  expect(next.seen).toEqual(["in514ii", "r514ii", "claude-t514ii"])
  const term = attempts514(h, "ag-514ii").filter(r => r.terminal)
  expect(term.length).toBe(1)
  expect(term[0].rungsTried).toEqual(["in514ii", "r514ii"])
  expect(term[0].rungsEffortRefused).toEqual(["bare514ii"])
  expect(term[0].rungsSkippedDead).toEqual([])
  rungCooldownReset()
  failoverBindReset()
})

async function d2run514(tag: string, table: string): Promise<{ bind: any; seen: string[] }> {
  reset514()
  const h = host514(tag, 516_500_000, {
    probes: '[failover]\nenabled = true\nterminal = "claude-opus-5-5"\n',
    files: { [TABLE514]: table },
    env: { CATALYST_ROUTING_TABLE: TABLE514 },
    noProc: true,
  })
  await spawn514(h, "ag-514" + tag, "c514d2", "in514d2")
  const bind = failoverBindGet("ag-514" + tag)
  const next = next514(h, { "in514d2": refuseAll514("Prompt is too long"), "claude-opus-5-5": () => null })
  await step514(h, "ag-514" + tag, "in514d2", next)
  rungCooldownReset()
  failoverBindReset()
  return { bind, seen: next.seen }
}

test("#509 D-2 (J3): клетка без лестницы при непустом допуске -- через spawn и step план [входящая, терминал]", async () => {
  const r = await d2run514("d2a", '[classes.c514d2]\nallowed = ["x1", "x2", "in514d2"]\n')
  expect({ ladder: r.bind.ladder, source: r.bind.source }).toEqual({ ladder: [], source: "none" })
  expect(r.seen).toEqual(["in514d2", "claude-opus-5-5"])
})

test("#509 D-2 (J3): единственная допущенная -- входящая, ступеней нет", async () => {
  const r = await d2run514("d2b", '[classes.c514d2]\nallowed = ["in514d2"]\n')
  expect({ ladder: r.bind.ladder, source: r.bind.source }).toEqual({ ladder: [], source: "none" })
  expect(r.seen).toEqual(["in514d2", "claude-opus-5-5"])
})

test("#509 D-2 (J3): пустой допуск -- ступеней нет, терминал последним", async () => {
  const r = await d2run514("d2c", '[classes.c514d2]\nallowed = []\n')
  expect({ ladder: r.bind.ladder, source: r.bind.source }).toEqual({ ladder: [], source: "none" })
  expect(r.seen).toEqual(["in514d2", "claude-opus-5-5"])
})

test("#509 D-2 (J3): допуск не порождает эффорт -- rungEffort привязки пуст", async () => {
  const r = await d2run514("d2d", '[classes.c514d2]\nallowed = ["m1", "m2", "m3"]\n')
  expect({ rungEffort: r.bind.rungEffort, rungsDropped: r.bind.rungsDropped }).toEqual({ rungEffort: {}, rungsDropped: 0 })
  expect(r.seen).toEqual(["in514d2", "claude-opus-5-5"])
})

// --- #509/#514 FIX3: объявленная первой, свежая строка отказа, таблица хоста ---
//
// CONSTRAINT: часы зубов FIX3 выровнены по минуте UTC: хвост «· resets»
// хоста несёт время с точностью до минуты.

const RL429 = "API Error: Request rejected (429) · rate limited"

function rungs3(prefix: string, n: number): string[] {
  const out: string[] = []
  for (let i = 1; i <= n; i++) out.push(prefix + "-" + String(i))
  return out
}

function canon3(cls: string, ladder: string[], terminal: string): string {
  return '[failover]\nenabled = true\nterminal = "' + terminal + '"\n\n[failover.class.' + cls + ']\nmodels = [' +
    ladder.map(m => '{model = "' + m + '", effort = "max"}').join(", ") + "]\n"
}

test("#509-FIX3 H1 (а): спавн на claude-opus-5-5[1m], шесть ступеней, терминал claude-opus-5-5 -- первый вызов на объявленную как написана", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 11, 0, 0)
  const ladder = rungs3("r3h1a", 6)
  const h = host514("3h1a", T0, {
    probes: canon3("c3h1a", ladder, "claude-opus-5-5"),
    files: { [TABLE514]: '[classes.c3h1a]\nallowed = ["' + ladder.join('", "') + '"]\n' },
    env: { CATALYST_ROUTING_TABLE: TABLE514 },
    noProc: true,
  })
  await spawn514(h, "ag-3h1a", "c3h1a", "claude-opus-5-5[1m]")
  expect(failoverBindGet("ag-3h1a").ladder).toEqual(ladder)
  const script: any = { "claude-opus-5-5[1m]": () => null, "claude-opus-5-5": () => null }
  for (const r of ladder) script[r] = () => null
  const next = next514(h, script)
  const out = await step514(h, "ag-3h1a", "claude-opus-5-5[1m]", next)
  expect(next.seen, "первый и единственный вызов -- объявленная").toEqual(["claude-opus-5-5[1m]"])
  expect(next.reqs[0].model, "строка объявления без правки").toBe("claude-opus-5-5[1m]")
  expect(out.value && out.value.text).toBe("OK-claude-opus-5-5[1m]")
  expect(journal514(h).filter(r => r.terminal === true || r.reason === "cell-exhausted").length, "метки перехода нет").toBe(0)
  failoverBindReset()
})

test("#509-FIX3 H1 (б): объявленная на терминале отказывает временно -- ступени по порядку, терминал второй раз не вызван", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 11, 10, 0)
  const ladder = rungs3("r3h1b", 6)
  const h = host514("3h1b", T0, {
    probes: canon3("c3h1b", ladder, "claude-opus-5-5"),
    files: { [TABLE514]: '[classes.c3h1b]\nallowed = ["' + ladder.join('", "') + '"]\n' },
    env: { CATALYST_ROUTING_TABLE: TABLE514 },
    noProc: true,
  })
  await spawn514(h, "ag-3h1b", "c3h1b", "claude-opus-5-5[1m]")
  const script: any = { "claude-opus-5-5[1m]": refuseAll514("You've hit your session limit · resets 3pm (UTC)"), "claude-opus-5-5": refuseAll514(RL429) }
  for (const r of ladder) script[r] = refuseAll514(RL429)
  const next = next514(h, script)
  await step514(h, "ag-3h1b", "claude-opus-5-5[1m]", next)
  expect(next.seen, "объявленная, затем шесть ступеней; терминала второй раз нет").toEqual(["claude-opus-5-5[1m]"].concat(ladder))
  const recs = attempts514(h, "ag-3h1b")
  expect(recs.map(r => r.modelRequested)).toEqual(["claude-opus-5-5[1m]"].concat(ladder))
  expect(recs.map(r => r.terminal), "ни одна попытка прохода не несёт метку терминала").toEqual(recs.map(() => undefined))
  expect(recs[0].laddered, "первая попытка -- не переход").toBe(false)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX3 H1 (в): объявленная не терминал -- объявленная, липкая, ступени, терминал последним", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 11, 20, 0)
  const h = host514("3h1c", T0, { noProc: true })
  failoverBindSet("ag-3h1c", { ladder: ["r3h1c-1", "r3h1c-2", "r3h1c-3"], terminal: "claude-t3h1c", rungEffort: effortAll509(["r3h1c-1", "r3h1c-2", "r3h1c-3"]), subagentType: "t", class: "", sticky: "r3h1c-2" })
  const next = next514(h, { "in3h1c": refuseAll514(RL429), "r3h1c-1": refuseAll514(RL429), "r3h1c-2": refuseAll514(RL429), "r3h1c-3": refuseAll514(RL429), "claude-t3h1c": refuseAll514(RL429) })
  await step514(h, "ag-3h1c", "in3h1c", next)
  expect(next.seen).toEqual(["in3h1c", "r3h1c-2", "r3h1c-1", "r3h1c-3", "claude-t3h1c"])
  expect(attempts514(h, "ag-3h1c").map(r => r.terminal)).toEqual([undefined, undefined, undefined, undefined, true])
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 M1 (а): старая строка 402 в истории, бросок без новой строки -- не permanent-model, метки нет, бросок виден", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 11, 30, 0)
  const h = host514("3m1a", T0, { history: ["API Error: 402 All credentials for model grok-4.7 are parked"] })
  failoverBindSet("ag-3m1a", { ladder: [], terminal: "claude-t3m1a", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in3m1a": () => ({ throwSilent: "lower hook: boom" }), "claude-t3m1a": () => null })
  let threw: any = null
  try { await step514(h, "ag-3m1a", "in3m1a", next) } catch (x) { threw = x }
  expect(String(threw && threw.message), "бросок нижнего хука виден вызывающему").toBe("lower hook: boom")
  const recs = attempts514(h, "ag-3m1a")
  expect(recs.length).toBe(1)
  expect(recs[0].refusalClass, "без свежей строки -- hook-error, не класс старой строки").toBe("hook-error")
  expect(isModelCooling("in3m1a", T0 + 1), "метки на модель нет").toBe(false)
  expect(journal514(h).filter(r => r.agentId === "ag-3m1a" && String(r.outcome).indexOf("wait-") === 0).length).toBe(0)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 M1 (б): старая строка 402 в истории, отказ без новой строки -- temporary-unknown", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 11, 40, 0)
  const h = host514("3m1b", T0, { noProc: true, history: ["API Error: 402 All credentials for model grok-4.7 are parked"] })
  failoverBindSet("ag-3m1b", { ladder: [], terminal: "claude-t3m1b", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in3m1b": () => ({ silent: true }), "claude-t3m1b": () => null })
  await step514(h, "ag-3m1b", "in3m1b", next)
  const recs = attempts514(h, "ag-3m1b")
  expect({ cls: recs[0].refusalClass, text: recs[0].refusalText }).toEqual({ cls: "temporary-unknown", text: "" })
  expect(cooldownSnapshot(T0 + 1).filter(r => r.model === "in3m1b").map(r => r.class)).toEqual(["temporary-unknown"])
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 M1 (в): отказ чтения session.messages -- temporary-unknown, запись refusal-unread с текстом ошибки, один тост на эпизод", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 11, 50, 0)
  const h = host514("3m1c", T0, { noProc: true })
  h.messagesThrow = true
  failoverBindSet("ag-3m1c", { ladder: [], terminal: "claude-t3m1c", rungEffort: {}, subagentType: "t3m1c", class: "", sticky: null })
  const next = next514(h, { "in3m1c": refuseAll514(RL429), "claude-t3m1c": refuseAll514(RL429) })
  let threw: any = null
  try { await step514(h, "ag-3m1c", "in3m1c", next) } catch (x) { threw = x }
  expect(threw, "агента не отпускаем броском").toBe(null)
  expect(attempts514(h, "ag-3m1c").map(r => r.refusalClass)).toEqual(["temporary-unknown", "temporary-unknown"])
  const un = journal514(h).filter(r => r.agentId === "ag-3m1c" && r.outcome === "refusal-unread")
  expect(un.length, "запись на каждую непрочитанную попытку").toBe(2)
  for (const r of un) expect(String(r.reason)).toContain("session.messages: scripted refusal")
  expect(h.m.toasts.filter((t: string) => t.indexOf("t3m1c") >= 0 && t.indexOf("session.messages") >= 0).length, "один тост на эпизод").toBe(1)
  expect(waits514(h, "ag-3m1c", "wait-unavailable").length, "шаг ждёт, а не отпускает").toBe(1)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 M2: свежая строка хоста «Prompt is too long» -- класс request, без ожидания", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 12, 0, 0)
  const h = host514("3m2", T0)
  failoverBindSet("ag-3m2", { ladder: [], terminal: "claude-t3m2", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in3m2": refuseAll514("Prompt is too long"), "claude-t3m2": refuseAll514("Prompt is too long") })
  await step514(h, "ag-3m2", "in3m2", next)
  expect(attempts514(h, "ag-3m2").map(r => r.refusalClass)).toEqual(["request", "request"])
  expect(h.sleeps.length).toBe(0)
  expect(journal514(h).filter(r => r.agentId === "ag-3m2" && String(r.outcome).indexOf("wait-") === 0).map(r => r.outcome), "выход без цикла ожидания").toEqual([])
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 M3: ступени 429, терминал «Prompt is too long» -- ожидание, не выход", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 12, 10, 0)
  let next: any = null
  const h = host514("3m3", T0, { sleepHook: (n) => { if (n === 3) next.signal.aborted = true } })
  failoverBindSet("ag-3m3", { ladder: ["r3m3"], terminal: "claude-t3m3", rungEffort: { "r3m3": "max" }, subagentType: "t", class: "", sticky: null })
  next = next514(h, { "in3m3": refuseAll514(RL429), "r3m3": refuseAll514(RL429), "claude-t3m3": refuseAll514("Prompt is too long") })
  await step514(h, "ag-3m3", "in3m3", next)
  expect(attempts514(h, "ag-3m3").map(r => r.refusalClass)).toEqual(["temporary-unknown", "temporary-unknown", "request"])
  expect(waits514(h, "ag-3m3", "wait-begin").length, "класс последней модели выход не решает").toBe(1)
  expect(waits514(h, "ag-3m3", "wait-aborted").length).toBe(1)
  expect(waits514(h, "ag-3m3", "wait-begin")[0].wakeModel, "request-модель в цель пробуждения не идёт").not.toBe("claude-t3m3")
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 M4: исполнитель на claude-opus-5-5[1m] -- терминал claude-opus-5-5 снят у проверяющего", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 12, 20, 0)
  const h = host514("3m4", T0, { noProc: true })
  await spawn514(h, "ag-3m4x", "exec-0p", "claude-opus-5-5[1m]")
  failoverBindSet("ag-3m4", { ladder: [], terminal: "claude-opus-5-5", rungEffort: {}, subagentType: "t", class: "crit-mech", sticky: null })
  const next = next514(h, { "in3m4": refuseAll514(RL429), "claude-opus-5-5": () => null })
  await step514(h, "ag-3m4", "in3m4", next)
  expect(next.seen, "терминал модели исполнителя не вызван").toEqual(["in3m4"])
  expect(attempts514(h, "ag-3m4")[0].terminalFiltered).toBe(true)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 M5: у всех моделей живые метки temporary-known на час -- за 600 с стенда не меньше двух вызовов next", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 10, 0, 0) + 7 * 86400000
  let next: any = null
  const h = host514("3m5", T0, { sleepHook: (n) => { if (n === 160) next.signal.aborted = true } })
  failoverBindSet("ag-3m5", { ladder: ["r3m5"], terminal: "claude-t3m5", rungEffort: { "r3m5": "max" }, subagentType: "t", class: "", sticky: null })
  const txt = "You've hit your session limit · resets 11am (UTC)"
  const at: number[] = []
  const rec = (_k: number, t: number) => { at.push(t); return txt }
  next = next514(h, { "in3m5": rec, "r3m5": rec, "claude-t3m5": rec })
  await step514(h, "ag-3m5", "in3m5", next)
  expect(at.slice(0, 3), "первый проход").toEqual([T0, T0, T0])
  const later = at.slice(3).filter(t => t > T0 && t <= T0 + 600000)
  expect(later.length, "сердцебиение сбрасывает сторож 600 с").toBeGreaterThanOrEqual(2)
  let prev = T0
  for (const t of at.slice(3)) { expect(t - prev, "промежуток между вызовами next").toBeLessThanOrEqual(245000); prev = t }
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 AR-3: пробуждение пропускает терминал с живой меткой temporary-known -- запись skipped-known-until", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 10, 0, 0) + 8 * 86400000
  let next: any = null
  const h = host514("3ar3", T0, { sleepHook: (n) => { if (n === 10) next.signal.aborted = true } })
  failoverBindSet("ag-3ar3", { ladder: ["r3ar3"], terminal: "claude-t3ar3", rungEffort: { "r3ar3": "max" }, subagentType: "t", class: "", sticky: null })
  next = next514(h, { "in3ar3": refuseAll514(RL429), "r3ar3": refuseAll514(RL429), "claude-t3ar3": refuseAll514("You've hit your session limit · resets 11am (UTC)") })
  await step514(h, "ag-3ar3", "in3ar3", next)
  expect(waits514(h, "ag-3ar3", "wait-probe").map(r => r.kind)).toEqual(["wake"])
  expect(next.seen, "на пробуждении терминал не вызван").toEqual(["in3ar3", "r3ar3", "claude-t3ar3", "in3ar3", "r3ar3"])
  const sk = journal514(h).filter(r => r.agentId === "ag-3ar3" && r.outcome === "skipped-known-until")
  expect(sk.length).toBe(1)
  expect({ model: sk[0].model, until: sk[0].until }).toEqual({ model: "claude-t3ar3", until: new Date(T0 + 3600000).toISOString() })
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 L2: сердцебиение тем же классом permanent-model метку не продлевает -- через час стенда полный проход", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 10, 0, 0) + 9 * 86400000
  const h = host514("3l2", T0)
  failoverBindSet("ag-3l2", { ladder: [], terminal: "claude-t3l2", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, {
    "in3l2": (_k, t) => (t >= T0 + 3600000 ? null : "Credit balance is too low"),
    "claude-t3l2": refuseAll514("Not logged in · Please run /login"),
  })
  const out = await step514(h, "ag-3l2", "in3l2", next)
  expect(out.value && out.value.text).toBe("OK-in3l2")
  const kinds = waits514(h, "ag-3l2", "wait-probe").map(r => r.kind)
  expect(kinds[kinds.length - 1], "метка истекла -- пробуждение полным проходом").toBe("wake")
  expect(kinds.filter(k => k === "heartbeat").length, "сердцебиение не реже 240 с до истечения метки").toBeGreaterThanOrEqual(14)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 AR-5: нижний хук бросает детерминированно, в сессии ничего не добавлено -- бросок виден, ожидания нет", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 12, 30, 0)
  const h = host514("3ar5", T0)
  failoverBindSet("ag-3ar5", { ladder: ["r3ar5"], terminal: "claude-t3ar5", rungEffort: { "r3ar5": "max" }, subagentType: "t", class: "", sticky: null })
  const boom = () => ({ throwSilent: "lower hook: deterministic" })
  const next = next514(h, { "in3ar5": boom, "r3ar5": boom, "claude-t3ar5": boom })
  let threw: any = null
  let out: any = null
  try { out = await step514(h, "ag-3ar5", "in3ar5", next) } catch (x) { threw = x }
  expect(String(threw && threw.message), "бросок не превращён в пустой ответ").toBe("lower hook: deterministic")
  expect(out).toBe(null)
  expect(next.seen).toEqual(["in3ar5"])
  expect(h.procCalls, "FIX4 AR-c / FIX5 Р3: одна пауза повторного чтения куском, кусков ожидания нет").toEqual([{ argv: ["/bin/sleep", "4.000"], init: { timeoutMs: 9000 } }])
  expect(attempts514(h, "ag-3ar5")[0].reread, "повторное чтение названо в записи попытки").toBe(true)
  expect(journal514(h).filter(r => r.agentId === "ag-3ar5" && String(r.outcome).indexOf("wait-") === 0).length).toBe(0)
  expect(isModelCooling("in3ar5", T0 + 1)).toBe(false)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 L4: кусок паузы засчитывается только настоящим -- код 1 и мгновенный код 0 дают wait-unavailable без второго вызова", async () => {
  for (const [mode, res] of [["code1", { exitCode: 1, advanceMs: 4000 }], ["instant", { exitCode: 0, advanceMs: 0 }]] as Array<[string, any]>) {
    reset514()
    const T0 = Date.UTC(2026, 8, 26, 12, 40, 0) + (mode === "code1" ? 0 : 60000)
    const h = host514("3l4" + mode, T0, { procResult: () => res })
    const aid = "ag-3l4" + mode
    failoverBindSet(aid, { ladder: [], terminal: "claude-t3l4" + mode, rungEffort: {}, subagentType: "t", class: "", sticky: null })
    const next = next514(h, { ["in3l4" + mode]: refuseAll514(RL429), ["claude-t3l4" + mode]: refuseAll514(RL429) })
    await step514(h, aid, "in3l4" + mode, next)
    expect({ mode, calls: next.seen.length, chunks: h.procCalls.length }).toEqual({ mode, calls: 2, chunks: 1 })
    const un = waits514(h, aid, "wait-unavailable")
    expect({ mode, n: un.length }).toEqual({ mode, n: 1 })
    expect(String(un[0].reason), mode).toContain("код " + String(res.exitCode))
    expect(String(un[0].reason), mode).toContain("прошло " + String(res.advanceMs) + " мс")
    rungCooldownReset()
    failoverBindReset()
  }
})

test("#514 FIX3 L5: прерывание во время первого куска -- wait-aborted раньше begin(), журнала и тоста", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 12, 50, 0)
  let next: any = null
  const h = host514("3l5", T0, { sleepHook: (n) => { if (n === 1) next.signal.aborted = true } })
  failoverBindSet("ag-3l5", { ladder: [], terminal: "claude-t3l5", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  next = next514(h, { "in3l5": refuseAll514(RL429), "claude-t3l5": refuseAll514(RL429) })
  await step514(h, "ag-3l5", "in3l5", next)
  expect(waits514(h, "ag-3l5", "wait-aborted").length).toBe(1)
  expect(waits514(h, "ag-3l5", "wait-begin").length, "begin() после проверки прерывания").toBe(0)
  expect(h.m.toasts.length, "тоста нет").toBe(0)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 L5: прерывание между последней попыткой прохода и циклом ожидания -- wait-aborted до первого куска", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 12, 55, 0)
  let next: any = null
  const h = host514("3l5b", T0, { onMessages: (n) => { if (n === 2) next.signal.aborted = true } })
  failoverBindSet("ag-3l5b", { ladder: [], terminal: "claude-t3l5b", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  next = next514(h, { "claude-t3l5b": refuseAll514(RL429) })
  await step514(h, "ag-3l5b", "claude-t3l5b", next)
  expect(next.seen).toEqual(["claude-t3l5b"])
  expect(waits514(h, "ag-3l5b", "wait-aborted").length).toBe(1)
  expect(h.procCalls.length, "кусок паузы не начат").toBe(0)
  rungCooldownReset()
  failoverBindReset()
})

test("#514 FIX3 L1: три прохода -- rungsTried терминальной записи = модели одного прохода, запись несёт номер прохода", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 13, 0, 0)
  let next: any = null
  const h = host514("3l1", T0, { sleepHook: (n) => { if (n === 24) next.signal.aborted = true } })
  failoverBindSet("ag-3l1", { ladder: ["r3l1"], terminal: "claude-t3l1", rungEffort: { "r3l1": "max" }, subagentType: "t", class: "", sticky: null })
  next = next514(h, { "in3l1": refuseAll514(RL429), "r3l1": refuseAll514(RL429), "claude-t3l1": refuseAll514(RL429) })
  await step514(h, "ag-3l1", "in3l1", next)
  expect(waits514(h, "ag-3l1", "wait-probe").map(r => r.kind)).toEqual(["wake", "wake"])
  const term = attempts514(h, "ag-3l1").filter(r => r.terminal)
  expect(term.map(r => r.pass), "номер прохода").toEqual([1, 2, 3])
  for (const r of term) expect({ pass: r.pass, tried: r.rungsTried, eff: r.rungsEffortRefused, dead: r.rungsSkippedDead }).toEqual({ pass: r.pass, tried: ["in3l1", "r3l1"], eff: [], dead: [] })
  for (const r of attempts514(h, "ag-3l1")) expect(typeof r.pass, "каждая запись попытки несёт проход").toBe("number")
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX3 AR-4: терминал канона с [1m] уходит на провод как написан; нормализация -- только для сравнений", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 26, 13, 10, 0)
  const h = host514("3ar4", T0, { probes: '[failover]\nenabled = true\nterminal = "claude-opus-5-5[1m]"\n', noProc: true })
  await spawn514(h, "ag-3ar4", "c3ar4", "in3ar4")
  expect(failoverBindGet("ag-3ar4").terminal).toBe("claude-opus-5-5[1m]")
  const next = next514(h, { "in3ar4": refuseAll514(RL429), "claude-opus-5-5[1m]": () => null })
  await step514(h, "ag-3ar4", "in3ar4", next)
  expect(next.reqs[1].model, "суффикс не снят").toBe("claude-opus-5-5[1m]")
  expect(R514.normModelId(" Claude-Opus-5-5[2M] "), "[2m] снимается для сравнения").toBe("claude-opus-5-5")
  failoverBindSet("ag-3ar4b", { ladder: [], terminal: "claude-opus-5-5", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next2 = next514(h, { "Claude-Opus-5-5[2m]": refuseAll514(RL429), "claude-opus-5-5": () => null })
  await step514(h, "ag-3ar4b", "Claude-Opus-5-5[2m]", next2)
  expect(next2.seen, "объявленная совпала с терминалом при сравнении").toEqual(["Claude-Opus-5-5[2m]"])
  expect(isModelCooling("claude-opus-5-5", T0 + 1), "метка -- по нормализованному id").toBe(true)
  rungCooldownReset()
  failoverBindReset()
})

// --- #509/#514 FIX4: окно истории, {deny}, порядок классификации броска, ------
// выход без ожидания по полному плану, сердцебиение от сторожа хоста, время
// сброса по всем наступлениям, хвостовая объявленная-терминал.

function hist4(tag: string, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push("old answer " + tag + " " + String(i))
  return out
}

const LIMIT11 = "You've hit your session limit · resets 11am (UTC)"

test("#509-FIX4 F1 (а): история у предела окна 4096 -- свежая строка отказа видна, класс по ней", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 9, 0, 0)
  const h = host514("4f1a", T0, { noProc: true, window: 4096, history: hist4("4f1a", 2048) })
  failoverBindSet("ag-4f1a", { ladder: [], terminal: "claude-t4f1a", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in4f1a": refuseAll514("Prompt is too long"), "claude-t4f1a": refuseAll514("Prompt is too long") })
  await step514(h, "ag-4f1a", "in4f1a", next)
  expect(h.history.length, "окно сдвинуто: история длиннее окна").toBe(4098)
  expect(attempts514(h, "ag-4f1a").map(r => r.refusalClass), "строка за пределом прежнего окна прочитана свежей").toEqual(["request", "request"])
  expect(journal514(h).filter(r => r.agentId === "ag-4f1a" && (String(r.outcome).indexOf("wait-") === 0 || r.outcome === "refusal-unread")).length).toBe(0)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F1 (б): выравнивание окна -- наименьший сдвиг; сдвига нет -- unread window-unaligned", async () => {
  const fh = R514.freshHistory
  expect(typeof fh, "freshHistory экспортирована").toBe("function")
  const W = R514.SESSION_MESSAGES_WINDOW
  expect(W).toBe(4096)
  const row = (i: number) => ({ role: i % 2 ? "assistant" : "user", text: "r" + String(i) })
  const win = (from: number) => { const out: any[] = []; for (let i = from; i < from + W; i++) out.push(row(i)); return out }
  expect(fh(win(0), win(2)).rows, "сдвиг 2 -- две свежие").toEqual([row(W), row(W + 1)])
  expect(fh(win(0), win(0)).rows, "окно не сдвинулось -- свежих нет").toEqual([])
  expect(fh(win(0), win(W + 5)), "перекрытия нет").toEqual({ rows: null, why: "window-unaligned" })
  expect(fh([row(0), row(1)], [row(0), row(1), row(2)]).rows, "ниже окна -- по длине").toEqual([row(2)])
  expect(fh([row(0), row(1)], [row(0)])).toEqual({ rows: null, why: "history-shrank" })
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 9, 10, 0)
  let h: any = null
  h = host514("4f1b", T0, {
    noProc: true, window: 4096, history: hist4("4f1b", 2047).concat(["Prompt is too long"]),
    onMessages: (n) => {
      if (n !== 2) return
      const rows: any[] = []
      for (const t of hist4("4f1b-new", 2048)) rows.push({ role: "user", text: "q2" }, { role: "assistant", text: t })
      h.history.splice(0, h.history.length, ...rows)
    },
  })
  failoverBindSet("ag-4f1b", { ladder: [], terminal: "claude-t4f1b", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in4f1b": () => ({ silent: true }), "claude-t4f1b": () => null })
  await step514(h, "ag-4f1b", "in4f1b", next)
  const rec = attempts514(h, "ag-4f1b")[0]
  expect(rec.refusalClass, "старая строка окна свежей не прочитана").toBe("temporary-unknown")
  const un = journal514(h).filter(r => r.agentId === "ag-4f1b" && r.outcome === "refusal-unread")
  expect(un.map(r => r.reason)).toEqual(["window-unaligned"])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F2 (а): {deny} и не список на чтении «до» -- unread, старые строки свежими не читаются", async () => {
  const modes: Array<[string, any]> = [["deny", { deny: "no conversation for ag-4f2a-deny" }], ["null", null]]
  for (const [mode, val] of modes) {
    reset514()
    const T0 = Date.UTC(2026, 8, 27, 9, 20, 0) + (mode === "deny" ? 0 : 60000)
    const aid = "ag-4f2a-" + mode
    const h = host514("4f2a" + mode, T0, { noProc: true, history: ["Prompt is too long"], reply: (n) => (n === 1 ? val : undefined) })
    failoverBindSet(aid, { ladder: [], terminal: "claude-t4f2a" + mode, rungEffort: {}, subagentType: "t", class: "", sticky: null })
    const next = next514(h, { ["in4f2a" + mode]: () => ({ silent: true }), ["claude-t4f2a" + mode]: () => null })
    const out = await step514(h, aid, "in4f2a" + mode, next)
    expect({ mode, text: out.value && out.value.text }).toEqual({ mode, text: "OK-claude-t4f2a" + mode })
    expect({ mode, cls: attempts514(h, aid)[0].refusalClass }, "не request старой строки").toEqual({ mode, cls: "temporary-unknown" })
    const un = journal514(h).filter(r => r.agentId === aid && r.outcome === "refusal-unread")
    expect({ mode, n: un.length }).toEqual({ mode, n: 1 })
    expect({ mode, reason: String(un[0].reason) }).toEqual({ mode, reason: mode === "deny" ? "session.messages deny: no conversation for ag-4f2a-deny" : "session.messages: ответ не список и не {deny}" })
    rungCooldownReset()
    failoverBindReset()
  }
})

test("#509-FIX4 F2 (б): {deny} на чтении «после» броска -- не hook-error, unread с текстом отказа хоста", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 9, 30, 0)
  const h = host514("4f2b", T0, { reply: (n) => (n >= 2 ? { deny: "agent ag-4f2b finished, no saved transcript" } : undefined) })
  failoverBindSet("ag-4f2b", { ladder: [], terminal: "claude-t4f2b", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in4f2b": () => ({ throwSilent: "lower hook: boom" }), "claude-t4f2b": () => null })
  let threw: any = null
  let out: any = null
  try { out = await step514(h, "ag-4f2b", "in4f2b", next) } catch (x) { threw = x }
  expect(threw, "бросок не проброшен как ошибка хука").toBe(null)
  expect(out.value && out.value.text).toBe("OK-claude-t4f2b")
  const rec = attempts514(h, "ag-4f2b")[0]
  expect({ cls: rec.refusalClass, reread: rec.reread }).toEqual({ cls: "temporary-unknown", reread: true })
  const un = journal514(h).filter(r => r.agentId === "ag-4f2b" && r.outcome === "refusal-unread")
  expect(un.map(r => r.reason)).toEqual(["session.messages deny: agent ag-4f2b finished, no saved transcript"])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 AR-c шаг 2: бросок без свежей строки, известное начало в тексте ошибки -- класс по нему, без паузы", async () => {
  const cases: Array<[string, string, string]> = [
    ["4c2k", LIMIT11, "temporary-known"],
    ["4c2u", "API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment.", "temporary-unknown"],
    ["4c2t", "Request timed out", "temporary-unknown"],
    ["4c2r", "Prompt is too long", "request"],
  ]
  for (const [tag, text, cls] of cases) {
    reset514()
    const T0 = Date.UTC(2026, 8, 27, 9, 40, 0)
    const h = host514(tag, T0, { noProc: true })
    const aid = "ag-" + tag
    failoverBindSet(aid, { ladder: [], terminal: "claude-t" + tag, rungEffort: {}, subagentType: "t", class: "", sticky: null })
    const next = next514(h, { ["in" + tag]: () => ({ throwSilent: text }), ["claude-t" + tag]: () => null })
    let threw: any = null
    try { await step514(h, aid, "in" + tag, next) } catch (x) { threw = x }
    const rec = attempts514(h, aid)[0]
    expect({ tag, threw: threw && String(threw.message), cls: rec.refusalClass, text: rec.refusalText, reread: rec.reread })
      .toEqual({ tag, threw: null, cls, text, reread: undefined })
    rungCooldownReset()
    failoverBindReset()
  }
})

test("#509-FIX4 AR-c шаг 3: запись отказа видна только после паузы -- одна пауза куском, повторное чтение решает класс", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 9, 50, 0)
  let h: any = null
  h = host514("4c3", T0, { sleepHook: (n) => { if (n === 1) h.history.push({ role: "assistant", text: LIMIT11 }) } })
  failoverBindSet("ag-4c3", { ladder: [], terminal: "claude-t4c3", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in4c3": () => ({ throwSilent: "turn.step: stream ended" }), "claude-t4c3": () => null })
  let threw: any = null
  let out: any = null
  try { out = await step514(h, "ag-4c3", "in4c3", next) } catch (x) { threw = x }
  expect(threw).toBe(null)
  expect(out.value && out.value.text).toBe("OK-claude-t4c3")
  expect(h.procCalls).toEqual([{ argv: ["/bin/sleep", "4.000"], init: { timeoutMs: 9000 } }])
  const rec = attempts514(h, "ag-4c3")[0]
  expect({ cls: rec.refusalClass, reread: rec.reread, readyAt: rec.readyAt }).toEqual({ cls: "temporary-known", reread: true, readyAt: new Date(Date.UTC(2026, 8, 27, 11, 0, 0)).toISOString() })
  expect(h.messageArgs.length, "чтения: до, после, повторное; у терминала -- до").toBe(4)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 AR-c: прерывание во время паузы повторного чтения -- wait-aborted, без броска и без второго вызова", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 10, 0, 0)
  let next: any = null
  const h = host514("4c3a", T0, { sleepHook: (n) => { if (n === 1) next.signal.aborted = true } })
  failoverBindSet("ag-4c3a", { ladder: [], terminal: "claude-t4c3a", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  next = next514(h, { "in4c3a": () => ({ throwSilent: "turn.step: stream ended" }), "claude-t4c3a": () => null })
  let threw: any = null
  try { await step514(h, "ag-4c3a", "in4c3a", next) } catch (x) { threw = x }
  expect(threw).toBe(null)
  expect(next.seen).toEqual(["in4c3a"])
  expect(waits514(h, "ag-4c3a", "wait-aborted").length).toBe(1)
  const rec = attempts514(h, "ag-4c3a")[0]
  expect({ aborted: rec.aborted, cls: rec.refusalClass }).toEqual({ aborted: true, cls: undefined })
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F-5: строка отказа -- первая с известным началом по свежим сообщениям от новейшего", async () => {
  const pick = R514.refusalLineOfMessages
  expect(typeof pick, "refusalLineOfMessages экспортирована").toBe("function")
  const lim = "You've hit your session limit · resets 9pm (Europe/Volgograd)"
  expect(pick(["Partial answer…\n" + lim])).toEqual({ line: lim, known: true })
  expect(pick(["API Error: 500 x", "Partial\n  Prompt is too long  "]), "новейшее первым").toEqual({ line: "Prompt is too long", known: true })
  expect(pick(["You've hit your session limit", "just text\nmore"]), "в новейшем нет -- старшее").toEqual({ line: "You've hit your session limit", known: true })
  expect(pick(["first\nsecond", "\n  newest line\nx"]), "нет известной -- первая непустая новейшего").toEqual({ line: "newest line", known: false })
  expect(pick([])).toEqual({ line: "", known: false })
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 10, 10, 0)
  const h = host514("4f5", T0, { noProc: true })
  failoverBindSet("ag-4f5", { ladder: [], terminal: "claude-t4f5", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in4f5": refuseAll514("Partial answer…\n" + lim), "claude-t4f5": () => null })
  await step514(h, "ag-4f5", "in4f5", next)
  const rec = attempts514(h, "ag-4f5")[0]
  expect({ cls: rec.refusalClass, text: rec.refusalText }).toEqual({ cls: "temporary-known", text: lim })
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F3: ступень даёт request, терминал с живой меткой temporary-known пропущен пробуждением -- выхода нет, ожидание до терминала", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 10, 0, 0)
  const h = host514("4f3", T0)
  failoverBindSet("ag-4f3", { ladder: ["a4f3"], terminal: "claude-t4f3", rungEffort: { "a4f3": "max" }, subagentType: "t", class: "", sticky: null })
  const next = next514(h, {
    "in4f3": (k) => (k === 0 ? RL429 : "Prompt is too long"),
    "a4f3": refuseAll514("Prompt is too long"),
    "claude-t4f3": (_k, t) => (t >= T0 + 600000 ? null : "You've hit your session limit · resets 10:10am (UTC)"),
  })
  const out = await step514(h, "ag-4f3", "in4f3", next)
  expect(out.value && out.value.text, "ожидание дошло до терминала").toBe("OK-claude-t4f3")
  expect(next.seen.slice(0, 5), "пробуждение без терминала").toEqual(["in4f3", "a4f3", "claude-t4f3", "in4f3", "a4f3"])
  const sk = journal514(h).filter(r => r.agentId === "ag-4f3" && r.outcome === "skipped-known-until")
  expect(sk.length >= 1 && sk[0].model === "claude-t4f3", "терминал пропущен проходом пробуждения").toBe(true)
  expect(waits514(h, "ag-4f3", "wait-probe")[0].kind).toBe("wake")
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F3: все дали request, но у модели плана живая метка иного класса -- решение за циклом ожидания", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 10, 30, 0)
  const h = host514("4f3m", T0, { noProc: true })
  failoverBindSet("ag-4f3m", { ladder: [], terminal: "claude-t4f3m", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  R514.noteModelRefusal("claude-t4f3m", T0 - 1000, "temporary-unknown", 0, "carrier-refusal", RL429)
  const next = next514(h, { "in4f3m": refuseAll514("Prompt is too long"), "claude-t4f3m": refuseAll514("Prompt is too long") })
  await step514(h, "ag-4f3m", "in4f3m", next)
  expect(next.seen).toEqual(["in4f3m", "claude-t4f3m"])
  expect(attempts514(h, "ag-4f3m").map(r => r.refusalClass)).toEqual(["request", "request"])
  expect(waits514(h, "ag-4f3m", "wait-no-target").length, "выход без ожидания не взят, цикл назвал выход").toBe(1)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F3: модель без request, чья метка истекла к концу прохода, -- не request, ожидание и пробуждение", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 9, 59, 30)
  let h: any = null
  h = host514("4f3x", T0)
  failoverBindSet("ag-4f3x", { ladder: [], terminal: "claude-t4f3x", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, {
    "in4f3x": (k) => (k === 0 ? "You've hit your session limit · resets 10am (UTC)" : null),
    "claude-t4f3x": (_k, t) => { h.m.setNow(t + 60000); return "Prompt is too long" },
  })
  const out = await step514(h, "ag-4f3x", "in4f3x", next)
  const recs = attempts514(h, "ag-4f3x")
  expect(recs.slice(0, 2).map(r => r.refusalClass)).toEqual(["temporary-known", "request"])
  expect(out.value && out.value.text, "метка in4f3x истекла, но request она не давала -- выхода без ожидания нет").toBe("OK-in4f3x")
  expect(next.seen).toEqual(["in4f3x", "claude-t4f3x", "in4f3x"])
  expect(waits514(h, "ag-4f3x", "wait-probe").map(r => r.kind)).toEqual(["wake"])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F4 (а): CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS=120000 -- сердцебиение 105 с, промежуток между началами вызовов меньше S", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 10, 0, 0) + 10 * 86400000
  let next: any = null
  const h = host514("4f4a", T0, { env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "120000" }, sleepHook: (n) => { if (n === 150) next.signal.aborted = true } })
  failoverBindSet("ag-4f4a", { ladder: ["r4f4a"], terminal: "claude-t4f4a", rungEffort: { "r4f4a": "max" }, subagentType: "t", class: "", sticky: null })
  const at: number[] = []
  const rec = (_k: number, t: number) => { at.push(t); return LIMIT11 }
  next = next514(h, { "in4f4a": rec, "r4f4a": rec, "claude-t4f4a": rec })
  await step514(h, "ag-4f4a", "in4f4a", next)
  const later = at.slice(3)
  expect(later.length, "за 600 с стенда -- сердцебиения каждые 105 с").toBeGreaterThanOrEqual(5)
  let prev = T0
  const gaps: number[] = []
  for (const t of later) { gaps.push(t - prev); prev = t }
  expect(gaps.filter(g => g > 105000 + 4000 || g >= 120000), "промежутки " + gaps.join(",")).toEqual([])
  // FIX7 А-Р1: сон у D укорочен до D − now − G/2 (18000 − 15000 = 3000 мс).
  expect(h.procCalls.filter((c: any) => c.argv[1] !== "4.000" && c.argv[1] !== "3.000").length, "кусок 4 с или остаток до D − G/2 -- три знака").toBe(0)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F4 (б): S=1500 ниже пола -- одна запись stall-below-floor, сердцебиение 1000 мс, кусок 0.5 с", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 10, 0, 0) + 11 * 86400000
  let next: any = null
  const h = host514("4f4b", T0, { env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "1500" }, sleepHook: (n) => { if (n === 12) next.signal.aborted = true } })
  failoverBindSet("ag-4f4b", { ladder: [], terminal: "claude-t4f4b", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const at: number[] = []
  const rec = (_k: number, t: number) => { at.push(t); return LIMIT11 }
  next = next514(h, { "in4f4b": rec, "claude-t4f4b": rec })
  await step514(h, "ag-4f4b", "in4f4b", next)
  const fl = waits514(h, "ag-4f4b", "stall-below-floor")
  expect(fl.map(r => r.stallMs), "одна запись на шаг со значением S").toEqual([1500])
  expect(h.procCalls.map((c: any) => c.argv[1]).filter((a: string) => a !== "0.500")).toEqual([])
  const later = at.slice(2)
  expect(later.length).toBeGreaterThanOrEqual(4)
  let prev = T0
  for (const t of later) { expect(t - prev, "сердцебиение 1000 мс + кусок 500 мс").toBeLessThanOrEqual(1500); prev = t }
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F4 (в): разбор S, формула сердцебиения и куска", () => {
  const pace = R514.waitPaceOf
  expect(typeof pace, "waitPaceOf экспортирована").toBe("function")
  const poison = { toString() { throw new Error("poison") } }
  const cases: Array<[string, any, number, number, boolean]> = [
    ["undefined", undefined, 240000, 4000, false], ["null", null, 240000, 4000, false], ["пусто", "", 240000, 4000, false],
    ["abc", "abc", 240000, 4000, false], ["0", "0", 240000, 4000, false], ["-5", "-5", 240000, 4000, false],
    ["12.5", "12.5", 240000, 4000, false], ["Infinity", "Infinity", 240000, 4000, false], ["poison", poison, 240000, 4000, false],
    ["600000", "600000", 240000, 4000, false], ["255000", "255000", 240000, 4000, false], ["120000", "120000", 105000, 4000, false],
    ["30001", "30001", 15001, 4000, false], ["30000", "30000", 15000, 4000, false], ["10000", "10000", 5000, 2500, false],
    ["2000", "2000", 1000, 500, false], ["1999", "1999", 1000, 500, true], ["1", "1", 1000, 500, true],
  ]
  for (const [name, raw, hb, chunk, below] of cases) {
    const got = pace(raw)
    expect({ name, hb: got.heartbeat, chunk: got.chunk, below: got.belowFloor }).toEqual({ name, hb, chunk, below })
  }
  expect(pace("1500").stall).toBe(1500)
})

test("#509-FIX4 F4 (г): отказ чтения переменной сторожа -- noteLost failover-stall-env, сердцебиение по умолчанию", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 10, 40, 0)
  const h = host514("4f4g", T0, { noProc: true, envRefuses: ["CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS"] })
  failoverBindSet("ag-4f4g", { ladder: [], terminal: "claude-t4f4g", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in4f4g": refuseAll514(RL429), "claude-t4f4g": refuseAll514(RL429) })
  await step514(h, "ag-4f4g", "in4f4g", next)
  const lost = journal514(h).filter(r => r.agentId === "ag-4f4g" && r.lost && r.lost["failover-stall-env"])
  expect(lost.length, "отказ чтения назван").toBe(1)
  expect(String(lost[0].lost["failover-stall-env"].last)).toContain("CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS")
  expect(waits514(h, "ag-4f4g", "stall-below-floor").length).toBe(0)
  rungCooldownReset()
  failoverBindReset()
  // FIX5 Р8: сердцебиение по умолчанию -- по наблюдаемому моменту пробы.
  reset514()
  const T1 = Date.UTC(2026, 8, 27, 10, 50, 0) + 14 * 86400000
  let next2: any = null
  const h2 = host514("4f4g2", T1, { envRefuses: ["CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS"], sleepHook: (n) => { if (n === 61) next2.signal.aborted = true } })
  failoverBindSet("ag-4f4g2", { ladder: [], terminal: "claude-t4f4g2", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const at: number[] = []
  const rec = (_k: number, t: number) => { at.push(t); return LIMIT11 }
  next2 = next514(h2, { "in4f4g2": rec, "claude-t4f4g2": rec })
  await step514(h2, "ag-4f4g2", "in4f4g2", next2)
  expect(at.map(t => t - T1), "первый проход, затем проба через 240000 мс").toEqual([0, 0, 240000])
  expect(waits514(h2, "ag-4f4g2", "wait-probe").map(r => r.kind)).toEqual(["heartbeat"])
  expect(h2.procCalls.map((c: any) => c.argv[1]).filter((a: string) => a !== "4.000"), "кусок по умолчанию").toEqual([])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F4 (д): S=10000 -- кусок 2.5 с, кусок засчитан от трёх четвертей (1875 мс)", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 10, 0, 0) + 13 * 86400000
  let next: any = null
  const h = host514("4f4d", T0, {
    env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "10000" },
    procResult: () => ({ exitCode: 0, advanceMs: 2000 }),
    sleepHook: (n) => { if (n === 6) next.signal.aborted = true },
  })
  failoverBindSet("ag-4f4d", { ladder: [], terminal: "claude-t4f4d", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  next = next514(h, { "in4f4d": refuseAll514(LIMIT11), "claude-t4f4d": refuseAll514(LIMIT11) })
  await step514(h, "ag-4f4d", "in4f4d", next)
  expect(waits514(h, "ag-4f4d", "wait-unavailable").length, "кусок 2000 мс при пороге 1875 мс -- настоящий").toBe(0)
  expect(waits514(h, "ag-4f4d", "wait-aborted").length).toBe(1)
  // FIX7 А-Р1: третий сон каждого витка -- min(C, D − now − G/2) = 3500 − 1250.
  expect(h.procCalls.map((c: any) => c.argv[1])).toEqual(["2.500", "2.500", "2.250", "2.500", "2.500", "2.250"])
  expect(waits514(h, "ag-4f4d", "wait-probe").map(r => r.kind), "сердцебиение после 6000 мс при пороге 5000 мс").toEqual(["heartbeat"])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F6: попытка длится 10 с -- промежуток между НАЧАЛАМИ вызовов next не больше heartbeat + кусок", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 10, 0, 0) + 12 * 86400000
  let next: any = null
  let h: any = null
  h = host514("4f6", T0, { sleepHook: (n) => { if (n === 200) next.signal.aborted = true } })
  failoverBindSet("ag-4f6", { ladder: ["r4f6"], terminal: "claude-t4f6", rungEffort: { "r4f6": "max" }, subagentType: "t", class: "", sticky: null })
  const starts: number[] = []
  const slow = (_k: number, t: number) => { starts.push(t); h.m.setNow(t + 10000); return LIMIT11 }
  next = next514(h, { "in4f6": slow, "r4f6": slow, "claude-t4f6": slow })
  await step514(h, "ag-4f6", "in4f6", next)
  expect(starts.slice(0, 3), "первый проход -- попытки по 10 с").toEqual([T0, T0 + 10000, T0 + 20000])
  expect(starts.length, "сердцебиения были").toBeGreaterThanOrEqual(5)
  const gaps: number[] = []
  for (let i = 3; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1])
  expect(gaps.filter(g => g > 240000 + 4000), "промежутки " + gaps.join(",")).toEqual([])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX4 F5: все наступления стенного времени в зоне -- ближайшее; пропуск весны сдвигает вперёд", () => {
  const ra = R514.resetsAtOf
  const cases: Array<[string, string, string]> = [
    ["2026-11-01T06:10:00Z", "You've hit your session limit · resets 1:30am (America/New_York)", "2026-11-01T06:30:00Z"],
    ["2026-03-08T06:00:00Z", "You've hit your session limit · resets 2:30am (America/New_York)", "2026-03-08T07:30:00Z"],
    ["2026-03-08T06:00:00Z", "You've hit your weekly limit · resets Mar 8, 2:30am (America/New_York)", "2026-03-08T07:30:00Z"],
    ["2026-09-25T20:10:39Z", "You've hit your session limit · resets 12am (Asia/Kolkata)", "2026-09-26T18:30:00Z"],
    ["2026-09-25T20:10:39Z", "You've hit your session limit · resets 12pm (Asia/Kolkata)", "2026-09-26T06:30:00Z"],
    ["2026-12-31T12:00:00Z", "You've hit your weekly limit · resets Jan 5, 9am (Europe/Moscow)", "2027-01-05T06:00:00Z"],
  ]
  for (const [at, line, want] of cases) expect({ line, at: ra(line, Date.parse(at)).at }).toEqual({ line, at: Date.parse(want) })
  expect(ra("You've hit your weekly limit · resets Sep 31, 2028, 2:30am (Australia/Sydney)", Date.parse("2026-09-25T20:10:39Z")).at,
    "несуществующая дата рядом с переходом -- не пропуск, срок неизвестен").toBe(0)
})

test("#509-FIX4 F-3 / FIX4-(а): «Request too large for the API» -- request; «<Name> requires usage credits» -- лимитный класс", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-09-25T15:10:39Z")
  const cases: Array<[string, string, number]> = [
    ["Request too large for the API's 32 MB request limit: …", "request", 0],
    ["Opus 5.5 requires usage credits · resets 9pm (Europe/Moscow)", "temporary-known", Date.parse("2026-09-25T18:00:00Z")],
    ["Opus 5.5 requires usage credits", "temporary-unknown", 0],
  ]
  for (const [line, cls, at] of cases) {
    const got = cr(line, now)
    expect({ line, cls: got.class, at: got.readyAt }).toEqual({ line, cls, at })
  }
  expect(R514.refusalKnown("Opus 5.5 requires usage credits. Turn them on to continue."), "имя непусто -- известное начало").toBe(true)
  expect(R514.refusalKnown(" requires usage credits"), "пустое имя -- не форма билдера").toBe(false)
})

test("#509-FIX4 AR-5: остывшая объявленная = терминал в хвосте после ступеней -- терминальная запись, липкость не ставится", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 11, 0, 0)
  const h = host514("4ar5", T0, { noProc: true })
  failoverBindSet("ag-4ar5", { ladder: ["r4ar5-1", "r4ar5-2"], terminal: "claude-opus-5-5", rungEffort: effortAll509(["r4ar5-1", "r4ar5-2"]), subagentType: "t", class: "", sticky: null })
  R514.noteModelRefusal("claude-opus-5-5", T0 - 1000, "temporary-unknown", 0, "carrier-refusal", RL429)
  const next = next514(h, { "claude-opus-5-5": () => null, "r4ar5-1": refuseAll514(RL429), "r4ar5-2": refuseAll514(RL429) })
  const out = await step514(h, "ag-4ar5", "claude-opus-5-5", next)
  expect(out.value && out.value.text).toBe("OK-claude-opus-5-5")
  expect(next.seen).toEqual(["r4ar5-1", "r4ar5-2", "claude-opus-5-5"])
  const recs = attempts514(h, "ag-4ar5")
  const tail = recs[recs.length - 1]
  expect({ model: tail.modelRequested, terminal: tail.terminal, reason: tail.reason, tried: tail.rungsTried })
    .toEqual({ model: "claude-opus-5-5", terminal: true, reason: "cell-exhausted", tried: ["r4ar5-1", "r4ar5-2"] })
  expect(failoverBindGet("ag-4ar5").sticky, "успех хвостовой попытки липкость не ставит").toBe(null)
  const marks = new Map<string, any>()
  const plan = R514.failoverStepPlan
  expect(plan("claude-opus-5-5", null, ["r1", "r2"], "claude-opus-5-5", T0, marks).termAt, "D-8a: на первой позиции -- не переход").toBe(-1)
  R514.noteModelRefusal("claude-opus-5-5", T0 - 1000, "temporary-unknown", 0, "carrier-refusal", RL429, marks)
  const cooled = plan("claude-opus-5-5", null, ["r1", "r2"], "claude-opus-5-5", T0, marks)
  expect({ plan: cooled.plan, termAt: cooled.termAt }).toEqual({ plan: ["r1", "r2", "claude-opus-5-5"], termAt: 2 })
  rungCooldownReset()
  failoverBindReset()
})

// --- #509/#514 FIX5: permanent не держит выход, неоднозначное окно -- unread,
// пауза перечитывания проверяется, обёртка ошибки хоста решает раньше форм,
// сердцебиение терминала -- терминальная дисциплина.
//
// CONSTRAINT: шов стенда FIX5 -- прежний host514; строки с toolUses/toolResults
// кладутся прямо в h.history (сессия отдаёт объекты как есть), изменение
// записи между чтениями -- правкой того же объекта в сценарии попытки.

const NOLOGIN = "Not logged in · Please run /login"

test("#509-FIX5 Р1 (а): план [D(request), R(request), P(живая permanent с прошлого шага)] -- выход без ожидания", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 28, 9, 0, 0)
  let next: any = null
  const h = host514("5p1a", T0, { sleepHook: (n) => { if (n === 1) next.signal.aborted = true } })
  failoverBindSet("ag-5p1a", { ladder: ["r5p1a", "p5p1a"], terminal: "", rungEffort: effortAll509(["r5p1a", "p5p1a"]), subagentType: "t", class: "", sticky: null })
  R514.noteModelRefusal("p5p1a", T0 - 1000, "permanent-model", 0, "carrier-refusal", NOLOGIN)
  next = next514(h, { "in5p1a": refuseAll514("Prompt is too long"), "r5p1a": refuseAll514("Prompt is too long"), "p5p1a": refuseAll514(NOLOGIN) })
  await step514(h, "ag-5p1a", "in5p1a", next)
  expect(next.seen, "permanent-модель не вызвана").toEqual(["in5p1a", "r5p1a"])
  expect(attempts514(h, "ag-5p1a").map(r => r.refusalClass)).toEqual(["request", "request"])
  expect(journal514(h).filter(r => r.agentId === "ag-5p1a" && r.outcome === "skipped-dead").map(r => r.model)).toEqual(["p5p1a"])
  expect(journal514(h).filter(r => r.agentId === "ag-5p1a" && String(r.outcome).indexOf("wait-") === 0).map(r => r.outcome), "wait-begin не пишется, цикла ожидания нет").toEqual([])
  expect(h.procCalls.length, "кусок паузы не начат").toBe(0)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX5 Р1 (б): [P(permanent), Q(permanent)] без request -- ожидание permanentOnly, как прежде", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 28, 9, 10, 0)
  let next: any = null
  const h = host514("5p1b", T0, { sleepHook: (n) => { if (n === 2) next.signal.aborted = true } })
  failoverBindSet("ag-5p1b", { ladder: [], terminal: "claude-q5p1b", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  R514.noteModelRefusal("p5p1b", T0 - 1000, "permanent-model", 0, "carrier-refusal", NOLOGIN)
  next = next514(h, { "p5p1b": refuseAll514(NOLOGIN), "claude-q5p1b": refuseAll514(NOLOGIN) })
  await step514(h, "ag-5p1b", "p5p1b", next)
  expect(next.seen).toEqual(["claude-q5p1b"])
  expect(attempts514(h, "ag-5p1b").map(r => r.refusalClass)).toEqual(["permanent-model"])
  const wb = waits514(h, "ag-5p1b", "wait-begin")
  expect(wb.map(r => r.permanentOnly), "все permanent и ни одного request -- ожидание").toEqual([true])
  expect(waits514(h, "ag-5p1b", "wait-aborted").length).toBe(1)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX5 Р2 (а): у предела окна содержимое периодично, добавлена ещё такая строка -- window-ambiguous, temporary-unknown, не hook-error", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 28, 9, 20, 0)
  let h: any = null
  h = host514("5p2a", T0, { window: 4096 })
  for (let i = 0; i < 4096; i++) h.history.push({ role: "assistant", text: LIMIT11 })
  failoverBindSet("ag-5p2a", { ladder: [], terminal: "claude-t5p2a", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, {
    "in5p2a": () => { h.history.push({ role: "assistant", text: LIMIT11 }); return { throwSilent: "turn.step: stream ended" } },
    "claude-t5p2a": () => null,
  })
  let threw: any = null
  let out: any = null
  try { out = await step514(h, "ag-5p2a", "in5p2a", next) } catch (x) { threw = x }
  expect(threw && String(threw.message), "агент жив: бросок не проброшен").toBe(null)
  expect(out.value && out.value.text).toBe("OK-claude-t5p2a")
  expect(attempts514(h, "ag-5p2a")[0].refusalClass, "неоднозначное выравнивание -- не hook-error").toBe("temporary-unknown")
  const un = journal514(h).filter(r => r.agentId === "ag-5p2a" && r.outcome === "refusal-unread")
  expect(un.map(r => r.reason)).toEqual(["window-ambiguous"])
  const fh = R514.freshHistory
  const same = (n: number) => { const o: any[] = []; for (let i = 0; i < n; i++) o.push({ role: "assistant", text: "x" }); return o }
  expect(fh(same(4096), same(4096)), "больше одного перекрытия -- unread").toEqual({ rows: null, why: "window-ambiguous" })
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX5 Р2 (б): у предела окна одинаковые по role+text строки с разными tool_use_id -- одно перекрытие, свежая строка найдена", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 28, 10, 0, 0)
  let h: any = null
  h = host514("5p2b", T0, { window: 4096 })
  const tu = (i: number) => ({ role: "assistant", text: "", toolUses: [{ tool_use_id: "tu5p2b-" + String(i), tool: "Read", input: {} }] })
  for (let i = 0; i < 2048; i++) h.history.push(tu(i), { role: "assistant", text: LIMIT11 })
  failoverBindSet("ag-5p2b", { ladder: [], terminal: "claude-t5p2b", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, {
    "in5p2b": () => { h.history.push(tu(2048)); return LIMIT11 },
    "claude-t5p2b": () => null,
  })
  await step514(h, "ag-5p2b", "in5p2b", next)
  const rec = attempts514(h, "ag-5p2b")[0]
  expect({ cls: rec.refusalClass, text: rec.refusalText, readyAt: rec.readyAt }, "свежая строка отказа прочитана")
    .toEqual({ cls: "temporary-known", text: LIMIT11, readyAt: new Date(Date.UTC(2026, 8, 28, 11, 0, 0)).toISOString() })
  expect(journal514(h).filter(r => r.agentId === "ag-5p2b" && r.outcome === "refusal-unread").length).toBe(0)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX5 Р2 (в): у записи между чтениями появились result/text tool-записей -- выравнивание не ломается", async () => {
  const fh = R514.freshHistory
  const W = R514.SESSION_MESSAGES_WINDOW
  const call = (i: number) => ({ role: "assistant", text: "call " + String(i), toolUses: [{ tool_use_id: "tu5p2c-" + String(i), tool: "Bash", input: { command: "true" } }] })
  const res = (i: number) => ({ role: "user", text: "", toolResults: [{ tool_use_id: "tu5p2c-" + String(i), text: "", isError: false }] })
  const before: any[] = []
  for (let i = 0; i < W / 2; i++) before.push(call(i), res(i))
  const lim = { role: "assistant", text: LIMIT11 }
  const after = before.slice(2)
  const lastCall = after[after.length - 2]
  const lastRes = after[after.length - 1]
  after[after.length - 2] = Object.assign({}, lastCall, { toolUses: [Object.assign({}, lastCall.toolUses[0], { text: "done", result: { stdout: "ok" }, isError: false })] })
  after[after.length - 1] = Object.assign({}, lastRes, { toolResults: [Object.assign({}, lastRes.toolResults[0], { text: "ok", result: { stdout: "ok" }, isError: false })] })
  after.push({ role: "assistant", text: "", toolUses: [{ tool_use_id: "tu5p2c-new", tool: "Read", input: {} }] }, lim)
  expect(fh(before, after), "result/text/isError tool-записей в ключ не входят").toEqual({ rows: [after[after.length - 2], lim], why: "" })
  reset514()
  const T0 = Date.UTC(2026, 8, 28, 10, 0, 0)
  let h: any = null
  h = host514("5p2c", T0, { window: 4096 })
  for (const r of before) h.history.push(JSON.parse(JSON.stringify(r)))
  failoverBindSet("ag-5p2c", { ladder: [], terminal: "claude-t5p2c", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, {
    "in5p2c": () => {
      const last = h.history[h.history.length - 2]
      last.toolUses[0].text = "done"
      last.toolUses[0].result = { stdout: "ok" }
      h.history[h.history.length - 1].toolResults[0].result = { stdout: "ok" }
      return LIMIT11
    },
    "claude-t5p2c": () => null,
  })
  await step514(h, "ag-5p2c", "in5p2c", next)
  expect(attempts514(h, "ag-5p2c")[0].refusalClass).toBe("temporary-known")
  expect(journal514(h).filter(r => r.agentId === "ag-5p2c" && r.outcome === "refusal-unread").length).toBe(0)
  rungCooldownReset()
  failoverBindReset()
})

function pauseFail5(tag: string, T0: number, procResult: (n: number) => { exitCode: number; advanceMs: number }): any {
  reset514()
  const h = host514(tag, T0, { procResult })
  failoverBindSet("ag-" + tag, { ladder: [], terminal: "claude-t" + tag, rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { ["in" + tag]: () => ({ throwSilent: "turn.step: stream ended" }), ["claude-t" + tag]: () => null })
  return { h, next }
}

async function pauseFailCheck5(tag: string, h: any, next: any): Promise<any> {
  const aid = "ag-" + tag
  let threw: any = null
  let out: any = null
  try { out = await step514(h, aid, "in" + tag, next) } catch (x) { threw = x }
  expect({ tag, threw: threw && String(threw.message) }, "несостоявшаяся пауза -- не hook-error").toEqual({ tag, threw: null })
  expect(out.value && out.value.text).toBe("OK-claude-t" + tag)
  const recs = attempts514(h, aid)
  expect({ tag, cls: recs.map(r => r.refusalClass) }).toEqual({ tag, cls: ["temporary-unknown", undefined] })
  const un = journal514(h).filter(r => r.agentId === aid && r.outcome === "refusal-unread")
  expect({ tag, reasons: un.map(r => r.reason) }).toEqual({ tag, reasons: ["reread-pause-failed"] })
  expect({ tag, reads: h.messageArgs.length }, "повторного чтения нет: до и после у первой попытки, до у терминала").toEqual({ tag, reads: 3 })
  rungCooldownReset()
  failoverBindReset()
  return recs
}

test("#509-FIX5 Р3 (а): пауза перечитывания вернула код 1 -- reread-pause-failed, temporary-unknown, не hook-error", async () => {
  const { h, next } = pauseFail5("5p3a", Date.UTC(2026, 8, 28, 10, 10, 0), () => ({ exitCode: 1, advanceMs: 4000 }))
  await pauseFailCheck5("5p3a", h, next)
})

test("#509-FIX5 Р3 (б): бросок двери паузы перечитывания -- reread-pause-failed, temporary-unknown, не hook-error, бросок учтён", async () => {
  const { h, next } = pauseFail5("5p3b", Date.UTC(2026, 8, 28, 10, 20, 0), () => { throw new Error("process.run: scripted door refusal") })
  const recs = await pauseFailCheck5("5p3b", h, next)
  expect(String(recs[0].lost && recs[0].lost["failover-reread-pause"] && recs[0].lost["failover-reread-pause"].last)).toContain("scripted door refusal")
  // FIX6 А4: при нечитаемом снимке «до» бросок двери паузы -- одна улика, текст броска.
  const u = pauseFail5("5p3bu", Date.UTC(2026, 8, 28, 10, 25, 0), () => { throw new Error("process.run: scripted door refusal") })
  u.h.messagesThrow = true
  await step514(u.h, "ag-5p3bu", "in5p3bu", u.next)
  const ur = attempts514(u.h, "ag-5p3bu")[0]
  const lp = ur.lost && ur.lost["failover-reread-pause"]
  expect({ cls: ur.refusalClass, n: lp && lp.n, door: String(lp && lp.last).indexOf("scripted door refusal") >= 0 }, "бросок двери -- одна улика с его текстом").toEqual({ cls: "temporary-unknown", n: 1, door: true })
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX5 Р3 (в): короткий кусок паузы перечитывания (0 мс по часам мода) -- reread-pause-failed, temporary-unknown, не hook-error", async () => {
  const { h, next } = pauseFail5("5p3c", Date.UTC(2026, 8, 28, 10, 30, 0), () => ({ exitCode: 0, advanceMs: 0 }))
  await pauseFailCheck5("5p3c", h, next)
})

test("#509-FIX5 Р3 (г): argv и timeoutMs паузы перечитывания и куска ожидания по S (FIX7 А-Р1: предел не дальше D)", async () => {
  const cases: Array<[string, string | undefined, string, number]> = [
    ["unset", undefined, "4.000", 9000], ["2000", "2000", "0.500", 1500], ["30000", "30000", "4.000", 9000],
    ["30001", "30001", "4.000", 9000], ["245000", "245000", "4.000", 9000], ["255000", "255000", "4.000", 9000],
  ]
  let day = 0
  for (const [name, S, arg, T] of cases) {
    reset514()
    const T0 = Date.UTC(2026, 8, 28, 10, 0, 0) + (++day) * 86400000
    const tag = "5p3g" + name
    let next: any = null
    let h: any = null
    h = host514(tag, T0, {
      env: S === undefined ? {} : { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: S },
      sleepHook: (n) => {
        if (n === 1) h.history.push({ role: "assistant", text: LIMIT11 })
        if (n === 2) next.signal.aborted = true
      },
    })
    failoverBindSet("ag-" + tag, { ladder: [], terminal: "claude-t" + tag, rungEffort: {}, subagentType: "t", class: "", sticky: null })
    next = next514(h, { ["in" + tag]: () => ({ throwSilent: "turn.step: stream ended" }), ["claude-t" + tag]: refuseAll514(LIMIT11) })
    await step514(h, "ag-" + tag, "in" + tag, next)
    const want = { argv: ["/bin/sleep", arg], init: { timeoutMs: T } }
    expect({ name, calls: h.procCalls }, "пауза перечитывания, затем кусок ожидания").toEqual({ name, calls: [want, want] })
    expect({ name, cls: attempts514(h, "ag-" + tag)[0].refusalClass }).toEqual({ name, cls: "temporary-known" })
    rungCooldownReset()
    failoverBindReset()
  }
})

test("#509-FIX5 Р3 (д) / FIX6 А2: pauseTimeout -- min(15000, 2·chunk + 1000) при любом S, заданном и нет", () => {
  const pace = R514.waitPaceOf
  const cases: Array<[string, any, number]> = [
    ["1", "1", 2000], ["1999", "1999", 2000], ["2000", "2000", 2000], ["10000", "10000", 6000], ["30000", "30000", 9000], ["30001", "30001", 9000],
    ["245000", "245000", 9000], ["255000", "255000", 9000], ["10^9", "1000000000", 9000], ["не задано", undefined, 9000], ["abc", "abc", 9000],
  ]
  for (const [name, raw, T] of cases) expect({ name, T: pace(raw).pauseTimeout }).toEqual({ name, T })
  expect(R514.PAUSE_TIMEOUT_MAX_MS).toBe(15000)
})

test("#509-FIX5 Р4: обёртка API Error / Request timed out решает раньше credits-формы", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-09-25T15:10:39Z")
  const cases: Array<[string, string, number]> = [
    ["API Error: 402 Fable 5 requires usage credits", "quota", 0],
    ["API Error: 402 Fable 5 requires usage credits · resets 9pm (Europe/Moscow)", "quota", 0],
    ["Fable 5 requires usage credits", "temporary-unknown", 0],
    ["Fable 5 requires usage credits · resets 9pm (Europe/Moscow)", "temporary-known", Date.parse("2026-09-25T18:00:00Z")],
    ["Error: Opus 5.5 requires usage credits · resets 9pm (Europe/Moscow)", "temporary-unknown", 0],
    ["Request timed out · Fable 5 requires usage credits · resets 9pm (Europe/Moscow)", "temporary-unknown", 0],
  ]
  for (const [line, cls, at] of cases) {
    const got = cr(line, now)
    expect({ line, cls: got.class, at: got.readyAt }).toEqual({ line, cls, at })
  }
  expect(R514.refusalKnown("API Error: 402 Fable 5 requires usage credits")).toBe(true)
  expect(R514.refusalKnown("Fable 5 requires usage credits")).toBe(true)
  expect(R514.refusalKnown("Error: Opus 5.5 requires usage credits"), "имя с двоеточием -- не форма билдера").toBe(false)
})

test("#509-FIX5 Р5: сердцебиение объявленной = терминал -- терминальная дисциплина, липкость не ставится", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 28, 10, 0, 0)
  const h = host514("5p5", T0)
  failoverBindSet("ag-5p5", { ladder: ["r5p5"], terminal: "claude-t5p5", rungEffort: { "r5p5": "max" }, subagentType: "t", class: "", sticky: null })
  R514.noteModelRefusal("claude-t5p5", T0 - 1000, "temporary-known", T0 + 3600000, "carrier-refusal", LIMIT11)
  const next = next514(h, {
    "claude-t5p5": (_k, t) => (t >= T0 + 240000 ? null : LIMIT11),
    "r5p5": refuseAll514("You've hit your session limit · resets 1pm (UTC)"),
  })
  const out = await step514(h, "ag-5p5", "claude-t5p5", next)
  expect(out.value && out.value.text).toBe("OK-claude-t5p5")
  expect(waits514(h, "ag-5p5", "wait-probe").map(r => r.kind), "успех пришёл на сердцебиении до wakeAt").toEqual(["heartbeat"])
  const recs = attempts514(h, "ag-5p5")
  const last = recs[recs.length - 1]
  expect({ model: last.modelRequested, outcome: last.outcome, terminal: last.terminal, reason: last.reason })
    .toEqual({ model: "claude-t5p5", outcome: "ok", terminal: true, reason: "cell-exhausted" })
  expect(failoverBindGet("ag-5p5").sticky, "терминальная проба липкость не ставит").toBe(null)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX5 Р7: снимок «до» нечитаем, прерывание во время паузы перечитывания -- ни refusal-unread, ни тоста «не прочитан»", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 28, 10, 40, 0)
  let next: any = null
  const h = host514("5p7", T0, { sleepHook: (n) => { if (n === 1) next.signal.aborted = true } })
  h.messagesThrow = true
  failoverBindSet("ag-5p7", { ladder: [], terminal: "claude-t5p7", rungEffort: {}, subagentType: "t5p7", class: "", sticky: null })
  next = next514(h, { "in5p7": () => ({ throwSilent: "turn.step: stream ended" }), "claude-t5p7": () => null })
  let threw: any = null
  try { await step514(h, "ag-5p7", "in5p7", next) } catch (x) { threw = x }
  expect(threw).toBe(null)
  expect(next.seen).toEqual(["in5p7"])
  expect(waits514(h, "ag-5p7", "wait-aborted").length).toBe(1)
  expect(journal514(h).filter(r => r.agentId === "ag-5p7" && r.outcome === "refusal-unread").length, "прерванная попытка не объявлена непрочитанной").toBe(0)
  expect(h.m.toasts.filter((t: string) => t.indexOf("не прочитан") >= 0), "тоста нет").toEqual([])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX5 Р10: noteLost failover-refusal-messages -- не больше одного раза на попытку", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 28, 10, 50, 0)
  const h = host514("5p10", T0)
  h.messagesThrow = true
  failoverBindSet("ag-5p10", { ladder: [], terminal: "claude-t5p10", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in5p10": () => ({ throwSilent: "turn.step: stream ended" }), "claude-t5p10": () => null })
  const site = "failover-refusal-messages"
  const pre = (R514.lostWritesSnapshot()[site] || { n: 0 }).n
  await step514(h, "ag-5p10", "in5p10", next)
  expect({ reread: attempts514(h, "ag-5p10")[0].reread, pauses: h.procCalls.length }, "шаг 3 пройден: пауза была, чтения при нечитаемом снимке нет (FIX5b)").toEqual({ reread: false, pauses: 1 })
  let n = (R514.lostWritesSnapshot()[site] || { n: 0 }).n - pre
  for (const r of journal514(h)) if (r.lost && r.lost[site]) n += r.lost[site].n
  expect(n, "одна непрочитанная попытка -- одна улика").toBe(1)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX5b (а): пауза перечитывания вернула код 1 -- повторного чтения не было, в записи reread: false", async () => {
  const { h, next } = pauseFail5("5bA", Date.UTC(2026, 8, 29, 9, 0, 0), () => ({ exitCode: 1, advanceMs: 4000 }))
  await step514(h, "ag-5bA", "in5bA", next)
  const rec = attempts514(h, "ag-5bA")[0]
  expect({ cls: rec.refusalClass, reread: rec.reread }).toEqual({ cls: "temporary-unknown", reread: false })
  expect(h.messageArgs.length, "чтения: до и после у первой попытки, до у терминала").toBe(3)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX5b (б): нечитаемый снимок «до» и пауза с кодом 1 -- причина refusal-unread = ошибка чтения снимка, пауза -- в noteLost", async () => {
  const { h, next } = pauseFail5("5bB", Date.UTC(2026, 8, 29, 9, 10, 0), () => ({ exitCode: 1, advanceMs: 4000 }))
  h.messagesThrow = true
  await step514(h, "ag-5bB", "in5bB", next)
  const rec = attempts514(h, "ag-5bB")[0]
  expect({ cls: rec.refusalClass, reread: rec.reread }).toEqual({ cls: "temporary-unknown", reread: false })
  const un = journal514(h).filter(r => r.agentId === "ag-5bB" && r.outcome === "refusal-unread")
  expect(un.map(r => r.reason), "причина -- чтение снимка, не reread-pause-failed").toEqual(["session.messages: scripted refusal"])
  const lp = rec.lost && rec.lost["failover-reread-pause"]
  expect(String(lp && lp.last), "несостоявшаяся пауза названа в noteLost").toContain("код 1")
  rungCooldownReset()
  failoverBindReset()
})

// --- #509-FIX6: темп ожидания по сроку, предел двери сна, таблица отказов 2.1.283 ---
// CONSTRAINT: шов часов -- host514 doorCost; сдвиг часов внутри попытки -- setNow
// из сценария next514 (длительность вызова).

const NORESP6 = "No response requested."

// CONSTRAINT (#509-FIX7 А-Р4): два витка, у каждого своя держащая ветка. Виток
// 1: пауза перечитывания 800 мс засчитана, чтение после неё 300 мс -- на входе
// в ожидание наступило сердцебиение, D ещё не близко: вызов без куска держит
// только передача паузы. Виток 2: чтение после отказа 1300 мс, паузы нет --
// остаток до D не больше G/2, вызов держит только ветка срока.
test("#509-FIX6 А1-срок: S=2000, пауза перечитывания 800 мс, два витка -- каждый next не позже D; сердцебиение, затем срок", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 1, 9, 0, 0)
  const h = host514("6srok", T0, {
    env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "2000" },
    reply: (n) => (n === 2 || n === 3 ? { deny: "scripted" } : undefined),
    procResult: (n) => ({ exitCode: 0, advanceMs: n === 1 ? 800 : 500 }),
    doorCost: (door, n) => (door === "write" ? 3 : door === "messages" && n === 3 ? 300 : door === "messages" && n === 5 ? 1300 : 0),
  })
  failoverBindSet("ag-6srok", { ladder: [], terminal: "claude-t6srok", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const starts: number[] = []
  const next = next514(h, {
    "claude-t6srok": (k, t) => {
      starts.push(t)
      if (k === 0) return { throwSilent: "turn.step: stream ended" }
      if (k === 1) return NORESP6
      return null
    },
  })
  const out = await step514(h, "ag-6srok", "claude-t6srok", next)
  const gaps: number[] = []
  for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1])
  expect({ gaps, inTime: gaps.length === 2 && gaps.every(g => g >= 0 && g <= 2000 - 500) }, "каждый следующий next не позже callEndAt + S − G").toEqual({ gaps, inTime: true })
  expect(out.value && out.value.text).toBe("OK-claude-t6srok")
  const rec0 = attempts514(h, "ag-6srok")[0]
  expect({ cls: rec0.refusalClass, reread: rec0.reread }, "пауза засчитана, повторное чтение {deny}").toEqual({ cls: "temporary-unknown", reread: true })
  expect(waits514(h, "ag-6srok", "wait-probe").map(r => r.kind), "виток 1 -- сердцебиение, виток 2 -- срок").toEqual(["heartbeat", "deadline"])
  expect(waits514(h, "ag-6srok", "stall-margin-exceeded"), "перебега нет").toEqual([])
  expect(h.procCalls.length, "кусок один -- пауза перечитывания").toBe(1)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX6 А1-пауза: засчитанная пауза перечитывания и наступивший heartbeat -- проба без ещё одного куска", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 1, 9, 10, 0)
  let h: any = null
  h = host514("6pause", T0, {
    env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "30000" },
    reply: (n) => (n >= 2 ? { deny: "scripted" } : undefined),
  })
  failoverBindSet("ag-6pause", { ladder: [], terminal: "claude-t6pause", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const starts: number[] = []
  const next = next514(h, {
    "claude-t6pause": (k, t) => {
      starts.push(t)
      if (k === 0) { h.m.setNow(t + 12000); return { throwSilent: "turn.step: stream ended" } }
      return null
    },
  })
  const out = await step514(h, "ag-6pause", "claude-t6pause", next)
  expect(h.procCalls.map((c: any) => c.argv[1]), "кусок только паузы перечитывания").toEqual(["4.000"])
  expect(out.value && out.value.text).toBe("OK-claude-t6pause")
  expect(waits514(h, "ag-6pause", "wait-probe").map(r => r.kind)).toEqual(["heartbeat"])
  expect(starts.map(t => t - T0), "вызов 12 с, пауза 4 с, проба сразу").toEqual([0, 16000])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX6 А1-запись: дверь сна ответила через S -- ровно одна запись stall-margin-exceeded, gapMs ≥ S", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 1, 9, 20, 0)
  const h = host514("6rec", T0, {
    env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "2000" },
    procResult: (n) => ({ exitCode: 0, advanceMs: n === 1 ? 2000 : 500 }),
  })
  failoverBindSet("ag-6rec", { ladder: [], terminal: "claude-t6rec", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "claude-t6rec": (k) => (k < 2 ? NORESP6 : null) })
  const out = await step514(h, "ag-6rec", "claude-t6rec", next)
  expect(out.value && out.value.text).toBe("OK-claude-t6rec")
  expect(next.seen.length, "три вызова: проход и две пробы").toBe(3)
  const recs = waits514(h, "ag-6rec", "stall-margin-exceeded")
  expect(recs.map(r => ({ atLeastS: r.gapMs >= 2000, stallMs: r.stallMs, marginMs: r.marginMs })), "одна запись на перебег").toEqual([{ atLeastS: true, stallMs: 2000, marginMs: 500 }])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX6 А1-kind: проба по сроку -- kind deadline, проба heartbeat -- heartbeat", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 1, 9, 30, 0)
  const h = host514("6kind", T0, {
    env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "2000" },
    doorCost: (door, n) => (door === "messages" && n === 2 ? 1300 : 0),
  })
  failoverBindSet("ag-6kind",{ ladder: [], terminal: "claude-t6kind", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "claude-t6kind": (k) => (k < 2 ? NORESP6 : null) })
  const out = await step514(h, "ag-6kind", "claude-t6kind", next)
  expect(waits514(h, "ag-6kind", "wait-probe").map(r => r.kind), "срок наступил без паузы -- deadline; затем heartbeat").toEqual(["deadline", "heartbeat"])
  expect(out.value && out.value.text).toBe("OK-claude-t6kind")
  expect(waits514(h, "ag-6kind", "stall-margin-exceeded")).toEqual([])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX6 А1-пол: S=1000 ниже пола -- ветки срока нет, между вызовами есть кусок сна", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 1, 9, 40, 0)
  const h = host514("6floor", T0, { env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "1000" } })
  failoverBindSet("ag-6floor", { ladder: [], terminal: "claude-t6floor", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const sleepsAt: number[] = []
  const next = next514(h, { "claude-t6floor": (k) => { sleepsAt.push(h.procCalls.length); return k < 3 ? NORESP6 : null } })
  const out = await step514(h, "ag-6floor", "claude-t6floor", next)
  expect(out.value && out.value.text).toBe("OK-claude-t6floor")
  const hot: number[] = []
  for (let i = 1; i < sleepsAt.length; i++) if (sleepsAt[i] <= sleepsAt[i - 1]) hot.push(i)
  expect({ calls: sleepsAt.length, hot }, "вызова без куска между ними нет").toEqual({ calls: 4, hot: [] })
  expect(waits514(h, "ag-6floor", "stall-below-floor").map(r => r.stallMs)).toEqual([1000])
  expect(waits514(h, "ag-6floor", "wait-probe").map(r => r.kind).filter((k: string) => k === "deadline")).toEqual([])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX6 А1: waitPaceOf -- stallEff = S или 600000, margin = min(30000, max(500, floor(stallEff / 4)))", () => {
  const pace = R514.waitPaceOf
  expect(R514.STALL_HOST_DEFAULT_MS).toBe(600000)
  const cases: Array<[string, any, number, number]> = [
    ["не задано", undefined, 600000, 30000], ["abc", "abc", 600000, 30000], ["0", "0", 600000, 30000], ["12.5", "12.5", 600000, 30000],
    ["1", "1", 1, 500], ["1999", "1999", 1999, 500], ["2000", "2000", 2000, 500], ["2001", "2001", 2001, 500],
    ["3000", "3000", 3000, 750], ["30000", "30000", 30000, 7500], ["120000", "120000", 120000, 30000], ["600000", "600000", 600000, 30000],
  ]
  for (const [name, raw, stallEff, margin] of cases) {
    const p = pace(raw)
    expect({ name, stallEff: p.stallEff, margin: p.margin }).toEqual({ name, stallEff, margin })
  }
})

// CONSTRAINT (#509-FIX6b): ветка срока без паузы не зовёт next подряд (#514
// FIX2) только пока выше пола S_eff - G >= 2C; держат пол, chunk и margin
// вместе -- смена любой формулы обязана пройти этот зуб.
test("#509-FIX6b: выше пола S_eff − G ≥ 2·chunk, belowFloor = (S годна и S < 2000)", () => {
  const pace = R514.waitPaceOf
  const ss: Array<number | undefined> = []
  for (let s = 1; s <= 3000; s++) ss.push(s)
  for (const s of [3001, 16000, 29999, 30000, 30001, 45000, 120000, 255000, 600000, 10000000]) ss.push(s)
  ss.push(undefined)
  const bad: string[] = []
  for (const s of ss) {
    const p = pace(s === undefined ? undefined : String(s))
    const ok = s !== undefined
    const name = s === undefined ? "S не задана" : "S=" + String(s)
    if (p.belowFloor !== (ok && (s as number) < 2000)) bad.push(name + ": belowFloor=" + String(p.belowFloor))
    if (!p.belowFloor && !(p.stallEff - p.margin >= 2 * p.chunk)) bad.push(name + ": stallEff " + String(p.stallEff) + " - margin " + String(p.margin) + " < 2 * chunk " + String(p.chunk))
  }
  expect(bad, "нарушения по S").toEqual([])
})

test("#509-FIX6 А2 / FIX7 А-Р1: pauseTimeout = min(15000, 2·chunk + 1000) на S = 2000, 3000, 30000, не задано; обе двери получают min(T, D − now) в timeoutMs", async () => {
  const pace = R514.waitPaceOf
  const cases: Array<[string, string | undefined, string, number, number]> = [
    ["2000", "2000", "0.500", 2000, 1500], ["3000", "3000", "0.750", 2500, 2250], ["30000", "30000", "4.000", 9000, 9000], ["unset", undefined, "4.000", 9000, 9000],
  ]
  let day = 0
  for (const [name, S, arg, T, lim] of cases) {
    const p = pace(S)
    expect({ name, T: p.pauseTimeout, formula: Math.min(15000, 2 * p.chunk + 1000), lim: Math.min(p.pauseTimeout, p.stallEff - p.margin) }).toEqual({ name, T, formula: T, lim })
    reset514()
    const T0 = Date.UTC(2026, 9, 2, 9, 0, 0) + (++day) * 86400000
    const tag = "6a2" + name
    let next: any = null
    let h: any = null
    h = host514(tag, T0, {
      env: S === undefined ? {} : { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: S },
      sleepHook: (n) => {
        if (n === 1) h.history.push({ role: "assistant", text: LIMIT11 })
        if (n === 2) next.signal.aborted = true
      },
    })
    failoverBindSet("ag-" + tag, { ladder: [], terminal: "claude-t" + tag, rungEffort: {}, subagentType: "t", class: "", sticky: null })
    next = next514(h, { ["in" + tag]: () => ({ throwSilent: "turn.step: stream ended" }), ["claude-t" + tag]: refuseAll514(LIMIT11) })
    await step514(h, "ag-" + tag, "in" + tag, next)
    const want = { argv: ["/bin/sleep", arg], init: { timeoutMs: lim } }
    expect({ name, calls: h.procCalls }, "пауза перечитывания, затем кусок ожидания").toEqual({ name, calls: [want, want] })
    rungCooldownReset()
    failoverBindReset()
  }
})

// CONSTRAINT: дом литералов -- G/SCOUT-HOST-REFUSAL-TEXTS-283.md (2.1.283,
// функция yUn, разделы 2 и 3); переход версии сверяет каждую строку.
test("#509-FIX6 А3: таблица отказов хоста 2.1.283 -- каждый литерал в своём классе", () => {
  const cr = R514.classifyRefusal
  const known = R514.refusalKnown
  const now = Date.parse("2026-10-01T09:00:00Z")
  const TAIL = " · resets 11am (UTC)"
  const at11 = Date.parse("2026-10-01T11:00:00Z")
  const request = [
    "Image was too large. Try resizing the image or using a different approach.",
    "Image was too large. Double press esc to go back and try again with a smaller image.",
    "PDF too large (max 100 pages, 32 MB). Try reading the file a different way (e.g., extract text with pdftotext).",
    "PDF too large (max 100 pages, 32 MB). Double press esc to go back and try again, or use pdftotext to convert to text first.",
    "PDF is password protected. Try using a CLI tool to extract or convert the PDF.",
    "PDF is password protected. Please double press esc to edit your message and try again.",
    "The PDF file was not valid. Try converting it to text first (e.g., pdftotext).",
    "The PDF file was not valid. Double press esc to go back and try again with a different file.",
    "An image in the conversation exceeds the dimension limit for many-image requests (2000px). Run /compact to remove old images from context, or start a new session.",
    "An image in the conversation exceeds the dimension limit for many-image requests (2000px). Start a new session with fewer images.",
    "Auto mode is unavailable for your plan",
    "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh.",
  ]
  const permanent = [
    "Failed to authenticate: OAuth session expired and could not be refreshed",
    "Your account does not have access to Claude. Please login again or contact your administrator.",
    "Invalid API key · Fix external API key",
    "Invalid auth token · Fix external auth token · 401 token rejected",
    "Invalid ANTHROPIC_CUSTOM_HEADERS · Fix the environment variable · header rejected",
    "Invalid request header from the environment · Fix the environment variable · header rejected",
    "Your ANTHROPIC_API_KEY belongs to a disabled organization · Unset the environment variable to use your subscription instead",
    "Your ANTHROPIC_API_KEY belongs to a disabled organization · Update or unset the environment variable",
    "Your apiKeyHelper script is failing · This usually means you need to re-authenticate with your provider · Run /status to see the script's error output",
    "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access",
    "Your organization has disabled API key authentication · Unset ANTHROPIC_API_KEY to use your claude.ai account instead",
    "Your organization has disabled API key authentication · Unset ANTHROPIC_API_KEY and run /login to sign in with your claude.ai account",
    "Your organization has disabled API key authentication · Unset the apiKeyHelper setting and run /login to sign in with your claude.ai account",
    "Your organization has disabled API key authentication · Sign in again with your claude.ai account",
    "Your organization has disabled API key authentication · Run /login to sign in with your claude.ai account",
    "Anthropic profile login expired · Re-authenticate your Anthropic profile",
    "Your account is on hold and can't use Claude Code. View details or appeal: https://claude.ai/account-hold",
    "This service is disabled for your org",
    "AWS credentials expired or invalid · run `aws sso login` and retry · API Error: 403 security token expired",
    "AWS authentication failed · credentials are managed by this environment — retry, or contact your administrator · API Error: 403 denied",
    "Google Cloud credentials expired or invalid · run `gcloud auth application-default login` and retry · API Error: 401 expired",
    "Google Cloud authentication failed · refresh your Google Cloud credentials (application default sign-in, or the key file in GOOGLE_APPLICATION_CREDENTIALS) and retry · API Error: 401 denied",
    "Microsoft Foundry authentication failed · credentials are managed by this environment — retry, or contact your administrator · if credentials are current, check access to the Foundry resource · API Error: 401 denied",
    "Gateway refused the request · signing in again won't change this — check with your gateway administrator · API Error: 403 denied",
    "There's an issue with the selected model (claude-opus-5-5[1m]). It may not exist or you may not have access to it. Run /model to pick a different model.",
    "CLAUDE_CODE_NO_MODEL_FALLBACK is set: model substitution is disabled · unset it to allow the swap",
    "The model claude-opus-5-5[1m] is not available on your Bedrock deployment. Try /model to switch to claude-sonnet-5, or ask your admin to enable this model.",
    "The model Opus 5.5 is not available on your Vertex AI deployment. Try switching to Sonnet 5, or ask your admin to enable this model.",
    "The server routed this response to a model that is not in your organization’s availableModels allowlist; the response was discarded.",
  ]
  const limit = [
    "Fable limit reached · continuing on Opus 5.5 uses usage credits, and the prompt to confirm went unanswered — nothing was sent · answer it where this session is running, or /model to change",
    "Fable limit reached · continuing on Opus 5.5 uses usage credits, and the prompt to confirm was closed from Remote Control without a choice — nothing was sent · it asks again on your next message, or /model to change",
    "Opus 5.5 now uses usage credits · the prompt to confirm went unanswered — nothing was sent · answer it where this session is running, or /model to change",
    "Opus 5.5 now uses usage credits · the prompt to confirm was closed from Remote Control without a choice — nothing was sent · it asks again on your next message, or /model to change",
  ]
  const unknown = [
    "Opus is experiencing high load. Switch to Sonnet.",
    "Opus is experiencing high load, please use /model to switch to Sonnet",
    "Fable is experiencing high load. Switch to Sonnet.",
    "Fable is experiencing high load, please use /model to switch to Sonnet",
    "No response requested.",
    "Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh. This is usually transient; retry in a minute, and if it persists close other Claude Code processes or sign in again",
    "Could not refresh your login because another Claude Code process is refreshing it (or exited mid-refresh) · Try again in a minute; if it keeps happening, close other Claude Code windows or sign in again with /login",
    "Opus 5.5 is currently unavailable.",
  ]
  const got: any[] = []
  const want: any[] = []
  for (const l of request) { got.push({ l, c: cr(l, now).class }); want.push({ l, c: "request" }) }
  for (const l of permanent) { got.push({ l, c: cr(l, now).class }); want.push({ l, c: "permanent-model" }) }
  for (const l of limit) {
    const k = cr(l + TAIL, now)
    got.push({ l, known: known(l), c: k.class, at: k.readyAt })
    want.push({ l, known: true, c: "temporary-known", at: at11 })
  }
  for (const l of unknown) {
    got.push({ l, c: cr(l, now).class, cTail: cr(l + TAIL, now).class })
    want.push({ l, c: "temporary-unknown", cTail: "temporary-unknown" })
  }
  // Ряды, которые новые регулярки ловить не должны: имя с двоеточием; обёртка API Error.
  // CONSTRAINT (#509-FIX7 Р14): PROVIDER_GONE_RX решает раньше обёртки API Error --
  // «model <имя> is not available» под обёрткой -- permanent-model.
  const miss = [
    ["Error: Opus 5.5 now uses usage credits · the prompt to confirm went unanswered — nothing was sent", false, "temporary-unknown"],
    ["API Error: Opus 5.5 now uses usage credits · the prompt to confirm went unanswered — nothing was sent", true, "temporary-unknown"],
    ["API Error: The model claude-opus-5-5[1m] is not available on your Bedrock deployment. Try switching to Sonnet 5, or ask your admin to enable this model.", true, "permanent-model"],
  ] as Array<[string, boolean, string]>
  for (const [l, k, c] of miss) {
    got.push({ l, known: known(l), c: cr(l + TAIL, now).class })
    want.push({ l, known: k, c })
  }
  expect(got).toEqual(want)
})

test("#509-FIX6 А3: префиксы таблиц не перекрывают чужой класс, каждый решает свой", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-01T09:00:00Z")
  const groups: Array<[string, string[]]> = [
    ["other", R514.REFUSAL_OTHER_PREFIXES], ["request", R514.REFUSAL_REQUEST_PREFIXES],
    ["permanent", R514.REFUSAL_PERMANENT_PREFIXES], ["limit", R514.REFUSAL_LIMIT_PREFIXES],
  ]
  const cross: string[] = []
  for (const [ga, as] of groups) for (const [gb, bs] of groups) {
    if (ga === gb) continue
    for (const a of as) for (const b of bs) if (a.indexOf(b) === 0) cross.push(ga + ":" + a + " <- " + gb + ":" + b)
  }
  expect(cross, "начало префикса одного класса -- префикс другого").toEqual([])
  const wantOf: { [g: string]: string } = { other: "temporary-unknown", request: "request", permanent: "permanent-model", limit: "temporary-known" }
  const bad: string[] = []
  for (const [g, ps] of groups) for (const p of ps) {
    const c = cr(p + " · resets 11am (UTC)", now).class
    if (c !== wantOf[g]) bad.push(g + ":" + p + " -> " + c)
  }
  expect(bad).toEqual([])
})

// --- #509-FIX7: дверь срока D, классы отказов, носитель вердикта, веер судьи ---

test("#509-FIX7 А-Р1 сон: S=2000, дверь сна стоит 1999 мс -- предел двери min(T, D − now), следующий next не позже D", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 9, 0, 0)
  const h = host514("7r1s", T0, {
    env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "2000" },
    procResult: () => ({ exitCode: 0, advanceMs: 1999 }),
    procTimeout: true,
  })
  failoverBindSet("ag-7r1s", { ladder: [], terminal: "claude-t7r1s", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const starts: number[] = []
  const next = next514(h, { "claude-t7r1s": (k, t) => { starts.push(t); return k === 0 ? NORESP6 : null } })
  const out = await step514(h, "ag-7r1s", "claude-t7r1s", next)
  expect(out.value && out.value.text).toBe("OK-claude-t7r1s")
  const gap = starts.length > 1 ? starts[1] - starts[0] : -1
  expect({ gap, inTime: gap >= 0 && gap <= 2000 - 500 }, "следующий next не позже D = callEndAt + S − G").toEqual({ gap, inTime: true })
  expect(h.procCalls.map((c: any) => c.init.timeoutMs), "предел двери сна -- остаток до D").toEqual([1500])
  expect(waits514(h, "ag-7r1s", "wait-unavailable"), "сон, оборванный сроком D, -- не отказ двери").toEqual([])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX7 А-Р1 чтение: S=2000, снимок истории перед next стоит 1100 мс -- next не позже D без свежего снимка, строка history-past-deadline", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 9, 10, 0)
  const h = host514("7r1h", T0, {
    env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "2000" },
    doorCost: (door, n) => (door === "messages" && n === 3 ? 1100 : 0),
    afterFire: true,
  })
  failoverBindSet("ag-7r1h", { ladder: [], terminal: "claude-t7r1h", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const starts: number[] = []
  const next = next514(h, { "claude-t7r1h": (k, t) => { starts.push(t); return k === 0 ? NORESP6 : null } })
  const out = await step514(h, "ag-7r1h", "claude-t7r1h", next)
  expect(out.value && out.value.text).toBe("OK-claude-t7r1h")
  const gap = starts.length > 1 ? starts[1] - starts[0] : -1
  expect({ gap, inTime: gap >= 0 && gap <= 2000 - 500 }, "чтение, не успевшее к D, вызова не держит").toEqual({ gap, inTime: true })
  expect(waits514(h, "ag-7r1h", "history-past-deadline").map(r => r.forAttempt), "проигрыш гонки назван строкой").toEqual([1])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX7 А-Р2: снимок истории перед next стоит 1100 мс -- stall-margin-exceeded меряется после него, gapMs ≥ S", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 9, 20, 0)
  const h = host514("7r2", T0, {
    env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "2000" },
    doorCost: (door, n) => (door === "messages" && n === 3 ? 1100 : 0),
  })
  failoverBindSet("ag-7r2", { ladder: [], terminal: "claude-t7r2", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const starts: number[] = []
  const next = next514(h, { "claude-t7r2": (k, t) => { starts.push(t); return k === 0 ? NORESP6 : null } })
  const out = await step514(h, "ag-7r2", "claude-t7r2", next)
  expect(out.value && out.value.text).toBe("OK-claude-t7r2")
  const recs = waits514(h, "ag-7r2", "stall-margin-exceeded")
  expect(recs.map(r => ({ gapMs: r.gapMs, stallMs: r.stallMs })), "перебег в чтении перед next виден").toEqual([{ gapMs: starts[1] - starts[0], stallMs: 2000 }])
  expect(starts[1] - starts[0] >= 2000).toBe(true)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX7 А-Р3: стенд doorCost -- бросок двери двигает часы и номер вызова", async () => {
  const T0 = Date.UTC(2026, 9, 3, 9, 30, 0)
  const h = host514("7r3", T0, { doorCost: (door, n) => (door === "messages" ? n * 100 : door === "write" ? n * 10 : 0) })
  h.messagesThrow = true
  let thrown = 0
  for (let i = 0; i < 2; i++) { try { await h.m.$.session.messages({ agentId: "a" }) } catch (x) { thrown++ } }
  h.messagesThrow = false
  await h.m.$.session.messages({ agentId: "a" })
  expect({ thrown, spent: h.m.getNow() - T0 }, "100 + 200 + 300: бросок стоит времени и номера").toEqual({ thrown: 2, spent: 600 })
  h.writeThrow = true
  try { await h.m.$.fs.write("/w7r3", "a") } catch (x) { thrown++ }
  h.writeThrow = false
  await h.m.$.fs.write("/w7r3", "b")
  expect({ thrown, spent: h.m.getNow() - T0 }, "запись: 10 + 20").toEqual({ thrown: 3, spent: 630 })
})

test("#509-FIX7 А-Р5: GBn и HBn -- permanent по общему префиксу «Login expired · »", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  const rows = [
    "Login expired · Run /login to sign in again, or re-authenticate your Anthropic profile",
    "Login expired · Please run /login",
  ]
  expect(rows.map(l => ({ l, c: cr(l, now).class }))).toEqual(rows.map(l => ({ l, c: "permanent-model" })))
  expect(R514.REFUSAL_PERMANENT_PREFIXES, "общий префикс в таблице").toContain("Login expired · ")
  expect(R514.REFUSAL_PERMANENT_PREFIXES.indexOf("Login expired · Please run /login"), "полная форма избыточна").toBe(-1)
})

test("#509-FIX7 А-Р6: Hdt -- temporary-unknown раньше префиксов permanent; gateway-строка PJt -- permanent", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  const got = [
    "Authentication error · This may be a temporary network issue, please try again",
    "Authentication error · The gateway could not authenticate with its upstream provider — contact your gateway administrator",
  ].map(l => cr(l, now).class)
  expect(got).toEqual(["temporary-unknown", "permanent-model"])
  expect(R514.refusalKnown("Authentication error · This may be a temporary network issue, please try again"), "строка таблицы хоста").toBe(true)
})

test("#509-FIX7 А-Р7: allowlist-маршрутизация организации (110688729) -- permanent", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  const l = "The server routed this response to a model that is not in your organization’s availableModels allowlist; the response was discarded."
  expect({ c: cr(l, now).class, known: R514.refusalKnown(l) }).toEqual({ c: "permanent-model", known: true })
})

test("#509-FIX7 А-Р8: S=1000 ниже пола, 10 проб -- ни одной записи stall-margin-exceeded, одна stall-below-floor", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 9, 40, 0)
  const h = host514("7r8", T0, { env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "1000" } })
  failoverBindSet("ag-7r8", { ladder: [], terminal: "claude-t7r8", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "claude-t7r8": (k) => (k < 10 ? NORESP6 : null) })
  const out = await step514(h, "ag-7r8", "claude-t7r8", next)
  expect(out.value && out.value.text).toBe("OK-claude-t7r8")
  expect(next.seen.length, "проход и десять проб").toBe(11)
  expect(waits514(h, "ag-7r8", "stall-margin-exceeded")).toEqual([])
  expect(waits514(h, "ag-7r8", "stall-below-floor").map(r => r.stallMs)).toEqual([1000])
  rungCooldownReset()
  failoverBindReset()
})

// CONSTRAINT: у каждой регулярки классов отказа -- ряд, который она ловит, и
// ряд, который не ловит; ряд «не ловит» стоит рядом с формой, которую
// ослабленная регулярка приняла бы.
test("#509-FIX7 А-Р9: каждая регулярка -- ловит свой ряд и не ловит соседний", () => {
  const rows: Array<[string, RegExp, string, string]> = [
    ["MODEL_UNAVAILABLE", R514.REFUSAL_MODEL_UNAVAILABLE_RX, "The model claude-opus-5-5[1m] is not available on your Bedrock deployment.", "Note: The model claude-opus-5-5 is not available on your plan until tomorrow."],
    ["CREDITS", R514.REFUSAL_CREDITS_RX, "Opus 5.5 requires usage credits.", "Note: this plan requires usage credits"],
    ["CREDITS_NOW", R514.REFUSAL_CREDITS_NOW_RX, "Opus 5.5 now uses usage credits · the prompt to confirm went unanswered", "Error: Opus 5.5 now uses usage credits · the prompt to confirm went unanswered"],
    ["PROVIDER_GONE", R514.PROVIDER_GONE_RX, "API Error: 400 {\"error\":\"unknown provider grok-4.6\"}", "The provider field in config.toml is optional; the default provider is used."],
    ["QUOTA", R514.QUOTA_RX, "402 Payment Required", "Wrote the report to /tmp/p402x/out.md"],
    ["QUOTA 402 API Error", R514.QUOTA_RX, "API Error: 402 {\"error\":\"Grok Build usage balance exhausted\"}", "error at line 402"],
    ["QUOTA 402 lead", R514.QUOTA_RX, "402 All credentials for model grok-4.7 are parked: the upstream refused to bill them", "/data/402/file"],
    ["QUOTA 402 status json", R514.QUOTA_RX, "{\"status\": 402, \"message\":\"x\"}", "retried 402 times"],
    ["QUOTA 402 status=", R514.QUOTA_RX, "upstream answered status=402", "see issue #402"],
    ["QUOTA 402 HTTP", R514.QUOTA_RX, "HTTP 402 from upstream", "port 4020 closed at line 402"],
    ["QUOTA_WINDOW", R514.QUOTA_WINDOW_RX, "[1308][Usage limit reached for 5 hour. Your limit will reset at 2026-09-28 05:35:51]", "Usage limit reached for today"],
  ]
  const got: any[] = []
  const want: any[] = []
  for (const [name, rx, hit, miss] of rows) {
    got.push({ name, isRx: rx instanceof RegExp, hit: rx instanceof RegExp && rx.test(hit), miss: rx instanceof RegExp && rx.test(miss) })
    want.push({ name, isRx: true, hit: true, miss: false })
  }
  expect(got).toEqual(want)
})

test("#509-FIX7 А-Р10: литерал Fable в форме 283 «<имя> requires usage credits.»", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  expect(R514.REFUSAL_LIMIT_PREFIXES, "байт в байт из переписи 283").toContain("Fable 5 requires usage credits.")
  expect(R514.REFUSAL_LIMIT_PREFIXES.indexOf("Fable 5 requires usage credits"), "прежняя форма без точки снята").toBe(-1)
  const rows: Array<[string, string, number]> = [
    ["Fable 5 requires usage credits.", "temporary-unknown", 0],
    ["Fable 5 requires usage credits. · resets 11am (UTC)", "temporary-known", Date.parse("2026-10-03T11:00:00Z")],
    ["Opus 5.5 requires usage credits. · resets 11am (UTC)", "temporary-known", Date.parse("2026-10-03T11:00:00Z")],
  ]
  for (const [l, c, at] of rows) {
    const g = cr(l, now)
    expect({ l, known: R514.refusalKnown(l), c: g.class, at: g.readyAt }).toEqual({ l, known: true, c, at })
  }
})

test("#509-FIX7 Р11: запись попытки несёт modelServed (usage.model или null) и declared", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 10, 0, 0)
  const h = host514("7r11", T0, { noProc: true })
  failoverBindSet("ag-7r11", { ladder: ["r7r11"], terminal: "", rungEffort: { r7r11: "high" }, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in7r11": refuseAll514(NORESP6), "r7r11": () => ({ usageModel: "served-x7r11" }) })
  const out = await step514(h, "ag-7r11", "in7r11", next)
  expect(out.value && out.value.text).toBe("OK-r7r11")
  const recs = attempts514(h, "ag-7r11")
  expect(recs.map(r => ({ m: r.modelRequested, served: r.modelServed, declared: r.declared }))).toEqual([
    { m: "in7r11", served: null, declared: "in7r11" },
    { m: "r7r11", served: "served-x7r11", declared: "in7r11" },
  ])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX7 Р12: лестничный успех -- одна подсказка главному лупу на (агент, ступень)", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 10, 10, 0)
  const h = host514("7r12", T0, { noProc: true })
  failoverBindSet("ag-7r12", { ladder: ["r7r12a", "r7r12b"], terminal: "", rungEffort: { r7r12a: "high", r7r12b: "high" }, subagentType: "t12", class: "", sticky: null })
  const next = next514(h, { "in7r12": refuseAll514(NORESP6), "r7r12a": (k) => (k < 2 ? null : NORESP6), "r7r12b": () => null })
  const text = (m: string) => "агент ag-7r12 (t12): шаг агента обслужила " + m + " (объявлена in7r12)"
  await step514(h, "ag-7r12", "in7r12", next, { index: 0 })
  expect(p5Q(""), "первая подмена -- одна запись").toEqual([text("r7r12a")])
  await step514(h, "ag-7r12", "in7r12", next, { index: 1 })
  expect(p5Q(""), "та же ступень -- второй записи нет").toEqual([text("r7r12a")])
  await step514(h, "ag-7r12", "in7r12", next, { index: 2 })
  expect(p5Q(""), "другая ступень того же агента -- вторая запись").toEqual([text("r7r12a"), text("r7r12b")])
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX7 Р13: критики A и B одной сессии -- модель, обслуживающая B, из ступеней A вычтена", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 10, 20, 0)
  const h = host514("7r13", T0, { noProc: true })
  await spawn514(h, "ag-7r13b", "crit-mech", "gpt-6-sol-t7r13")
  failoverBindSet("ag-7r13a", { ladder: ["gpt-6-sol-t7r13", "qwen-t7r13"], terminal: "", rungEffort: { "gpt-6-sol-t7r13": "high", "qwen-t7r13": "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  const next = next514(h, { "grok-4.7-t7r13": refuseAll514(NORESP6), "gpt-6-sol-t7r13": () => null, "qwen-t7r13": () => null })
  const out = await step514(h, "ag-7r13a", "grok-4.7-t7r13", next)
  expect(next.seen, "у A отказал grok-4.7 -- gpt-6-sol B пропущен, идёт следующая ступень").toEqual(["grok-4.7-t7r13", "qwen-t7r13"])
  expect(out.value && out.value.text).toBe("OK-qwen-t7r13")
  expect(attempts514(h, "ag-7r13a").map(r => r.rungsFilteredReviewer)).toEqual([1, 1])
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX7 Р14: мёртвый провайдер -- permanent-model, квота -- quota с остыванием 60 мин, соседний API Error: 500 -- temporary-unknown", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 {\"error\":\"unknown provider grok-4.6\"}", "permanent-model"],
    ["API Error: 404 model not found: grok-4.6", "permanent-model"],
    ["402 Payment Required", "quota"],
    ["API Error: 429 credential_quota exhausted for this key", "quota"],
    ["API Error: 500 Internal server error", "temporary-unknown"],
    ["The provider field in config.toml is optional; the default provider is used.", "temporary-unknown"],
    ["Wrote the report to /tmp/p402x/out.md", "temporary-unknown"],
    ["error at line 402", "temporary-unknown"],
    ["API Error: 402 {\"error\":\"Grok Build usage balance exhausted\"}", "quota"],
  ]
  expect(rows.map(([l]) => ({ l, c: cr(l, now).class }))).toEqual(rows.map(([l, c]) => ({ l, c })))
  expect(R514.QUOTA_COOLDOWN_MS).toBe(60 * 60 * 1000)
  const marks = new Map<string, any>()
  const mk = R514.noteModelRefusal("q-t7r14", now, "quota", 0, "carrier-refusal", "402 Payment Required", marks)
  expect({ cls: mk && mk.class, left: mk && mk.until - now }, "метка квоты -- час").toEqual({ cls: "quota", left: 3600000 })
})

// CONSTRAINT (#509-FIX7 ADD1): тела отказов -- из лога прокси CliProxyAPI
// (handlers_routing.go:168-170) и формы z.ai 1308, как их видит харнес.
const PROXY_MNF7 = "API Error: 400 {\"error\":{\"type\":\"invalid_request_error\",\"code\":\"model_not_found\",\"param\":\"model\",\"message\":\"x\"}}"
const ZAI1308_7 = "API Error: 429 {\"error\":{\"type\":\"rate_limit_error\",\"code\":\"1308\",\"message\":\"[1308][Usage limit reached for 5 hour. Your limit will reset at 2026-09-28 05:35:51]\"}}"
const ZAI1308_CODE7 = "API Error: 429 {\"error\":{\"type\":\"rate_limit_error\",\"code\":\"1308\",\"message\":\"x\"}}"
const ZAI1308_TEXT7 = "[1308][Usage limit reached for 5 hour. Your limit will reset at 2026-09-28 05:35:51]"

test("#509-FIX7 Р14a: error.code model_not_found -- permanent-model и там, где регэксп молчит; неразборный JSON -- не отказ классификации", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  expect(R514.PROVIDER_GONE_RX.test(PROXY_MNF7), "сообщение \"x\" регэксп не ловит").toBe(false)
  const rows: Array<[string, string]> = [
    [PROXY_MNF7, "permanent-model"],
    ["{\"error\":{\"code\":\"model_not_found\",\"message\":\"x\"}}", "permanent-model"],
    ["API Error: 400 {\"error\":{\"code\":\"model_not_found\"", "temporary-unknown"],
    ["API Error: 400 {\"error\":{\"type\":\"invalid_request_error\",\"code\":\"other\",\"message\":\"x\"}}", "temporary-unknown"],
    ["API Error: 400 {\"error\":{\"message\":\"unknown provider for model grok-4.6\"}}", "permanent-model"],
  ]
  expect(rows.map(([l]) => ({ l, c: cr(l, now).class }))).toEqual(rows.map(([l, c]) => ({ l, c })))
})

test("#509-FIX7 Р14b (а): z.ai 1308 на ступени не-Anthropic -- quota, переход дальше; код 1308 и окно по тексту -- каждый признак сам", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 11, 0, 0)
  const h = host514("7r14ba", T0, { noProc: true })
  failoverBindSet("ag-7r14ba", { ladder: ["qwen-t7r14ba"], terminal: "", rungEffort: { "qwen-t7r14ba": "high" }, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "glm-5.3-t7r14ba": refuseAll514(ZAI1308_7), "qwen-t7r14ba": () => null })
  const out = await step514(h, "ag-7r14ba", "glm-5.3-t7r14ba", next)
  expect(next.seen, "квота glm -- переход на следующую ступень").toEqual(["glm-5.3-t7r14ba", "qwen-t7r14ba"])
  expect(out.value && out.value.text).toBe("OK-qwen-t7r14ba")
  expect(attempts514(h, "ag-7r14ba").map(r => r.refusalClass)).toEqual(["quota", undefined])
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  expect([ZAI1308_CODE7, ZAI1308_TEXT7].map(l => cr(l, now, "glm-5.3").class), "код 1308 без текста окна; текст окна без JSON").toEqual(["quota", "quota"])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX7 Р14b (б): то же тело 1308 на Anthropic-модели -- класс прежний, не quota; QUOTA_RX тело 1308 не ловит", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 11, 10, 0)
  const h = host514("7r14bb", T0, { noProc: true })
  failoverBindSet("ag-7r14bb", { ladder: ["qwen-t7r14bb"], terminal: "", rungEffort: { "qwen-t7r14bb": "high" }, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "claude-opus-5-5-t7r14bb": refuseAll514(ZAI1308_7), "qwen-t7r14bb": () => null })
  await step514(h, "ag-7r14bb", "claude-opus-5-5-t7r14bb", next)
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  const before = cr(ZAI1308_7, now).class
  expect(before, "прежний класс тела -- не quota").not.toBe("quota")
  expect(attempts514(h, "ag-7r14bb").map(r => r.refusalClass)[0], "класс лимита Claude не тронут").toBe(before)
  expect([ZAI1308_7, ZAI1308_CODE7, ZAI1308_TEXT7].map(l => cr(l, now, "claude-opus-5-5").class)).toEqual([ZAI1308_7, ZAI1308_CODE7, ZAI1308_TEXT7].map(l => cr(l, now).class))
  expect(R514.QUOTA_RX.test(ZAI1308_7), "QUOTA_RX не решает 1308 раньше фильтра модели").toBe(false)
  rungCooldownReset()
  failoverBindReset()
})

// --- #509-FIX7 Р16: лента диспатчей судье -------------------------------------
function judge7(tag: string, msgs: any[]): any {
  const home = "/probes-7r16" + tag
  const m = mod$393({
    files: judgeFiles393(home),
    env: { CLAUDE_PROBES_DIR: home, PWD: "/work-7r16" + tag, CLAUDE_JUDGE: "enforce", CLAUDE_JUDGE_CARRIER: "mod" },
    now: 97_700_000,
    answers: ["OK: 7r16" + tag],
    messages: () => msgs,
  })
  const calls: any[] = []
  const c0 = m.$.model.complete
  m.$.model.complete = async (arg: any) => { calls.push(arg); return c0(arg) }
  return { m, calls }
}

function dispatches7(prompt: string): any[] {
  const head = "=== DISPATCHES ===\n"
  const i = prompt.indexOf(head)
  if (i < 0) return []
  const body = prompt.slice(i + head.length).split("\n\n=== ")[0]
  return body.split("\n").filter(l => l.trim()).map(l => JSON.parse(l))
}

function agentUse7(id: string, type: string, model: string, description: string): any {
  return { tool_use_id: id, tool: "Agent", input: { subagent_type: type, model, description, prompt: "p " + id } }
}

test("#509-FIX7 Р16 (а): три Agent в одной строке -- у судьи два now без self и один now + self; DISPATCH несёт self", async () => {
  await clear393()
  const msgs = [
    { role: "user", text: "go", toolUses: [] },
    { role: "assistant", text: "", toolUses: [agentUse7("tu-7a1", "crit-a", "m-a", "первый"), agentUse7("tu-7a2", "crit-b", "m-b", "второй"), agentUse7("tu-7a3", "crit-c", "m-c", "третий")] },
  ]
  const { m, calls } = judge7("a", msgs)
  await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p tu-7a2", subagent_type: "crit-b", model: "m-b", tool_use_id: "tu-7a2" }, async (e: any) => e)
  await settle393()
  expect(calls.length).toBe(1)
  const prompt = String(calls[0].prompt)
  expect(dispatches7(prompt)).toEqual([
    { tool: "Agent", subagent_type: "crit-a", model: "m-a", description: "первый", now: true },
    { tool: "Agent", subagent_type: "crit-b", model: "m-b", description: "второй", now: true, self: true },
    { tool: "Agent", subagent_type: "crit-c", model: "m-c", description: "третий", now: true },
  ])
  const di = prompt.indexOf("=== DISPATCH ===\n")
  const dispatch = JSON.parse(prompt.slice(di + "=== DISPATCH ===\n".length).split("\n")[0])
  expect(dispatch.self, "объект DISPATCH -- сам предмет консультации").toBe(true)
})

test("#509-FIX7 Р16 (б): прошлая строка -- записи без now; не больше 20 прошлых", async () => {
  await clear393()
  const msgs: any[] = []
  for (let i = 0; i < 22; i++) {
    msgs.push({ role: "user", text: "q" + i, toolUses: [] })
    msgs.push({ role: "assistant", text: "", toolUses: [agentUse7("tu-7b-old" + i, "scout", "m-old", "старый " + i)] })
  }
  msgs.push({ role: "assistant", text: "", toolUses: [agentUse7("tu-7b-cur", "crit-x", "m-x", "текущий")] })
  const { m, calls } = judge7("b", msgs)
  await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p tu-7b-cur", subagent_type: "crit-x", model: "m-x", tool_use_id: "tu-7b-cur" }, async (e: any) => e)
  await settle393()
  const d = dispatches7(String(calls[0].prompt))
  const past = d.filter((x: any) => !x.now)
  expect({ past: past.length, first: past[0] && past[0].description, pastNow: past.filter((x: any) => x.self).length }).toEqual({ past: 20, first: "старый 2", pastNow: 0 })
  expect(d.filter((x: any) => x.now)).toEqual([{ tool: "Agent", subagent_type: "crit-x", model: "m-x", description: "текущий", now: true, self: true }])
})

test("#509-FIX7 Р16 (в): строки текущего вызова нет -- ноль now и одна запись fan-self-absent", async () => {
  await clear393()
  const msgs = [
    { role: "user", text: "go", toolUses: [] },
    { role: "assistant", text: "", toolUses: [agentUse7("tu-7c-old", "scout", "m-old", "старый")] },
  ]
  const { m, calls } = judge7("c", msgs)
  await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p tu-7c-cur", subagent_type: "crit-x", model: "m-x", tool_use_id: "tu-7c-cur" }, async (e: any) => e)
  await settle393()
  const d = dispatches7(String(calls[0].prompt))
  expect(d).toEqual([{ tool: "Agent", subagent_type: "scout", model: "m-old", description: "старый" }])
  const absent = shards393(m.writes, "/judge/journal.jsonl.shard.").filter((r: any) => r.outcome === "fan-self-absent")
  expect(absent.map((r: any) => r.tool_use_id)).toEqual(["tu-7c-cur"])
})

// --- #509-FIX7b ---------------------------------------------------------------
test("#509-FIX7b AR8: next бросил тело отказа без префикса и без строки сессии -- ступень дальше с классом тела", async () => {
  // throw -- бросок next телом без строки сессии; line -- отказ со строкой
  // сессии, где тело 1308 стоит второй строкой (выбор строки знает модель ступени).
  const cases: Array<[string, string, string, string, "throw" | "line"]> = [
    ["b8a", "grok-4.6-t7b8a", "{\"error\":{\"type\":\"invalid_request_error\",\"code\":\"model_not_found\",\"param\":\"model\",\"message\":\"x\"}}", "permanent-model", "throw"],
    ["b8b", "glm-5.3-t7b8b", "{\"error\":{\"type\":\"rate_limit_error\",\"code\":\"1308\",\"message\":\"[1308][Usage limit reached for 5 hour. Your limit will reset at 2026-09-28 05:35:51]\"}}", "quota", "throw"],
    ["b8c", "grok-4.7-t7b8c", "402 All credentials for model grok-4.7 are parked: the upstream refused to bill them", "quota", "throw"],
    ["b8d", "glm-5.3-t7b8d", "Working on it.\n[1308][Usage limit reached for 5 hour. Your limit will reset at 2026-09-28 05:35:51]", "quota", "line"],
  ]
  const got: any[] = []
  const want: any[] = []
  for (const [tag, orig, body, cls, mode] of cases) {
    reset514()
    const h = host514("7" + tag, Date.UTC(2026, 9, 3, 12, 0, 0))
    const aid = "ag-7" + tag
    const rung = "qwen-t7" + tag
    failoverBindSet(aid, { ladder: [rung], terminal: "", rungEffort: { [rung]: "high" }, subagentType: "t", class: "", sticky: null })
    const next = next514(h, { [orig]: mode === "throw" ? () => ({ throwSilent: body }) : refuseAll514(body), [rung]: () => null })
    let out: any = null
    let threw = ""
    try { out = await step514(h, aid, orig, next) } catch (x: any) { threw = String((x && x.message) || x) }
    const known = mode === "throw" ? R514.refusalKnown(body, orig) : R514.refusalLineOfMessages([body], orig).known
    got.push({ tag, known, seen: next.seen, cls: attempts514(h, aid).map(r => r.refusalClass)[0], text: out && out.value && out.value.text, threw })
    want.push({ tag, known: true, seen: [orig, rung], cls, text: "OK-" + rung, threw: "" })
    rungCooldownReset()
    failoverBindReset()
  }
  const pick = R514.refusalLineOfMessages
  const z = "[1308][Usage limit reached for 5 hour. Your limit will reset at 2026-09-28 05:35:51]"
  got.push({ tag: "messages", glm: pick(["Working on it.\n" + z], "glm-5.3"), opus: pick(["Working on it.\n" + z], "claude-opus-5-5") })
  want.push({ tag: "messages", glm: { line: z, known: true }, opus: { line: "Working on it.", known: false } })
  expect(got).toEqual(want)
})

test("#509-FIX7b AR11: у вызова нет tool_use_id (таймер, classic, tool.call без id) -- DISPATCHES без now/self, записи fan-self-absent нет", async () => {
  const T0 = 902_700_000
  const hist = [
    { role: "user", text: "go", toolUses: [] },
    { role: "assistant", text: "", toolUses: [agentUse7("tu-7b11-old", "scout", "m-old", "старый")] },
  ]
  const pastOnly = [{ tool: "Agent", subagent_type: "scout", model: "m-old", description: "старый" }]
  // CONSTRAINT: дедуп fan-self-absent -- на процесс; без сброса ключ "" прежнего
  // зуба глушил бы запись, и мутант снятой проверки жил бы; сброс -- перед каждым.
  const rs = (): void => { if (typeof R514.fanSelfAbsentReset === "function") R514.fanSelfAbsentReset() }
  const tk = p5$("7b11t", T0, '[probe.ticker]\nevery_min = 1\nshow = ["dispatches"]\n', { answers: ["OK: t"], messages: () => hist })
  await saStart(tk)
  rs()
  await saTickAt(tk, T0 + SA_MIN)
  const cl = p5$("7b11c", T0, '[probe.stopper]\non = ["Stop"]\nshow = ["dispatches"]\n', { answers: ["OK: c"], messages: () => hist })
  await saStart(cl)
  rs()
  await p5Classic(cl, "Stop", {}, T0 + SA_MIN)
  await clear393()
  rs()
  const { m, calls } = judge7("b11", hist)
  await hook393(subs393(), "tool.call")(m.$, { tool: "Agent", prompt: "p none", subagent_type: "crit-x", model: "m-x" }, async (e: any) => e)
  await settle393()
  const seen = (c: any[], w: any[], probe: string): any => ({
    calls: c.length,
    d: c.length ? dispatches7(String(c[0].prompt)) : null,
    absent: shards393(w, "/" + probe + "/journal.jsonl.shard.").filter((r: any) => r.outcome === "fan-self-absent").length,
  })
  expect({
    timer: seen(tk.calls, tk.m.writes, "ticker"),
    classic: seen(cl.calls, cl.m.writes, "stopper"),
    toolCall: seen(calls, m.writes, "judge"),
  }).toEqual({
    timer: { calls: 1, d: pastOnly, absent: 0 },
    classic: { calls: 1, d: pastOnly, absent: 0 },
    toolCall: { calls: 1, d: pastOnly, absent: 0 },
  })
})

// --- #509-FIX8 -------------------------------------------------------------------
// CONSTRAINT (#509-FIX8 Р1): тела -- многострочный JSON, как его печатает
// прокси (error.code своей строкой): ни одна строка по отдельности класса не
// решает, решает тело целиком.
const MNF_ML8 = "{\n  \"error\": {\n    \"type\": \"invalid_request_error\",\n    \"code\": \"model_not_found\",\n    \"param\": \"model\",\n    \"message\": \"x\"\n  }\n}"
const ZAI_ML8 = "{\n  \"error\": {\n    \"type\": \"rate_limit_error\",\n    \"code\": \"1308\",\n    \"message\": \"x\"\n  }\n}"

test("#509-FIX8 Р1: многострочное тело отказа -- класс тела (брошенное и строкой истории), следующая ступень в том же шаге", async () => {
  const cases: Array<[string, string, string, string, "throw" | "line"]> = [
    ["r1a", "grok-4.6-t8r1a", MNF_ML8, "permanent-model", "throw"],
    ["r1b", "glm-5.3-t8r1b", ZAI_ML8, "quota", "throw"],
    ["r1c", "grok-4.6-t8r1c", MNF_ML8, "permanent-model", "line"],
    ["r1d", "glm-5.3-t8r1d", ZAI_ML8, "quota", "line"],
  ]
  const got: any[] = []
  const want: any[] = []
  for (const [tag, orig, body, cls, mode] of cases) {
    reset514()
    const h = host514("8" + tag, Date.UTC(2026, 9, 3, 12, 20, 0))
    const aid = "ag-8" + tag
    const rung = "qwen-t8" + tag
    failoverBindSet(aid, { ladder: [rung], terminal: "", rungEffort: { [rung]: "high" }, subagentType: "t", class: "", sticky: null })
    const next = next514(h, { [orig]: mode === "throw" ? () => ({ throwSilent: body }) : refuseAll514(body), [rung]: () => null })
    let out: any = null
    let threw = ""
    try { out = await step514(h, aid, orig, next) } catch (x: any) { threw = String((x && x.message) || x) }
    const a0 = attempts514(h, aid)[0] || {}
    got.push({ tag, seen: next.seen, cls: a0.refusalClass, text: a0.refusalText, value: out && out.value && out.value.text, threw })
    want.push({ tag, seen: [orig, rung], cls, text: body.replace(/\s+/g, " ").trim(), value: "OK-" + rung, threw: "" })
    rungCooldownReset()
    failoverBindReset()
  }
  const pick = R514.refusalLineOfMessages
  got.push({
    tag: "order",
    lineFirst: pick(["API Error: 500 upstream\n" + MNF_ML8], "grok-4.6"),
    older: pick([MNF_ML8, "Working on it.\nstill"], "grok-4.6"),
    noBody: pick(["Working on it.\nstill"], "grok-4.6"),
  })
  want.push({
    tag: "order",
    lineFirst: { line: "API Error: 500 upstream", known: true },
    older: { line: MNF_ML8.replace(/\s+/g, " ").trim(), known: true },
    noBody: { line: "Working on it.", known: false },
  })
  expect(got).toEqual(want)
})

test("#509-FIX8 Р2: 402 в начале строки -- статус только перед пробелом или концом строки; 402/…, 402., 402- -- не квота", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  const miss = [new Error("402/report.json: file not found").message, "402.", "402-retry", "402/"]
  const hit = ["402 Payment Required", "402", "  402 All credentials for model grok-4.7 are parked", "402\tupstream"]
  const got = miss.concat(hit).map(l => ({ l, rx: R514.QUOTA_RX.test(l), c: cr(l, now, "grok-4.7").class }))
  const want = miss.map(l => ({ l, rx: false, c: "temporary-unknown" })).concat(hit.map(l => ({ l, rx: true, c: "quota" })))
  expect(got).toEqual(want)
  expect(R514.refusalKnown(miss[0], "grok-4.7"), "не статус -- и не известная строка").toBe(false)
})

test("#509-FIX8 Р3: липкая проверяющего A -- модель, обслуживающая проверяющего B, -- снята; следующей идёт свободная ступень", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 12, 40, 0)
  const h = host514("8r3", T0, { noProc: true })
  await spawn514(h, "ag-8r3b", "crit-mech", "qwen-t8r3")
  const bindA = { ladder: ["qwen-t8r3", "free-t8r3"], terminal: "", rungEffort: { "qwen-t8r3": "high", "free-t8r3": "high" }, subagentType: "t", class: "crit-mech", sticky: "qwen-t8r3" }
  failoverBindSet("ag-8r3a", Object.assign({}, bindA))
  const next = next514(h, { "grok-4.7-t8r3": refuseAll514(NORESP6), "qwen-t8r3": () => null, "free-t8r3": () => null })
  const out = await step514(h, "ag-8r3a", "grok-4.7-t8r3", next)
  expect(next.seen, "объявленная отказала -- липкая qwen (её держит B) пропущена планом, идёт свободная").toEqual(["grok-4.7-t8r3", "free-t8r3"])
  expect(out.value && out.value.text).toBe("OK-free-t8r3")
  expect(attempts514(h, "ag-8r3a").map(r => r.stickyDroppedReviewer), "снятие названо в каждой записи попытки").toEqual([true, true])
  expect(waits514(h, "ag-8r3a", "reviewer-taken"), "липкая снята планом шага, а не пропуском попытки").toEqual([])
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

// CONSTRAINT (#509-FIX8 Р4): next, чей вызов модели ждёт ворот зуба: шаги двух
// проверяющих перекрываются в порядке, который задаёт зуб. seen -- модели в
// порядке вызова next; entered -- модель встала на воротах.
function gated8(h: any, script: { [model: string]: (k: number, now: number) => any }, holds: string[]): any {
  const base = next514(h, script)
  const seen: string[] = []
  const gates: { [m: string]: { open: () => void; p: Promise<void> } } = {}
  const entered: string[] = []
  for (const m of holds) {
    let open: () => void = () => {}
    const p = new Promise<void>((r) => { open = r })
    gates[m] = { open, p }
  }
  const next: any = (req: any) => {
    const m = String(req && req.model)
    seen.push(m)
    const g = gates[m]
    if (!g || entered.indexOf(m) >= 0) return base(req)
    entered.push(m)
    return (async function* () { await g.p; return yield* base(req) })()
  }
  next.seen = seen
  next.entered = entered
  next.open = (m: string) => gates[m].open()
  next.signal = base.signal
  next.budget = base.budget
  return next
}

test("#509-FIX8 Р4 (а): резерв синхронно с выбором -- второй проверяющий не идёт на модель, взятую первым до его успеха, пока впереди есть свободная; свободных нет -- идёт на неё", async () => {
  const run = async (tag: string, ladderB: string[]): Promise<any> => {
    await clear393()
    reset514()
    const h = host514("8r4" + tag, Date.UTC(2026, 9, 3, 13, 0, 0), { noProc: true })
    const free = "free-t8r4" + tag
    const other = "other-t8r4" + tag
    const declA = "decla-t8r4" + tag
    const declB = "declb-t8r4" + tag
    await spawn514(h, "ag-8r4a" + tag, "crit-mech", declA)
    await spawn514(h, "ag-8r4b" + tag, "crit-mech", declB)
    failoverBindSet("ag-8r4a" + tag, { ladder: [free], terminal: "", rungEffort: { [free]: "high" }, subagentType: "t", class: "crit-mech", sticky: null })
    const effB: any = {}
    for (const m of ladderB) effB[m.replace("#", tag)] = "high"
    failoverBindSet("ag-8r4b" + tag, { ladder: ladderB.map(m => m.replace("#", tag)), terminal: "", rungEffort: effB, subagentType: "t", class: "crit-mech", sticky: null })
    const nextA = gated8(h, { [declA]: refuseAll514(NORESP6), [free]: () => null }, [free])
    const nextB = gated8(h, { [declB]: refuseAll514(NORESP6), [free]: () => null, [other]: () => null }, [declB])
    const pB = step514(h, "ag-8r4b" + tag, declB, nextB)
    await settle393()
    const pA = step514(h, "ag-8r4a" + tag, declA, nextA)
    await settle393()
    const midA = nextA.entered.slice()
    nextB.open(declB)
    const outB = await pB
    await settle393()
    nextA.open(free)
    const outA = await pA
    const res = {
      midA,
      seenA: nextA.seen, seenB: nextB.seen,
      outA: outA.value && outA.value.text, outB: outB.value && outB.value.text,
      taken: waits514(h, "ag-8r4b" + tag, "reviewer-taken").map(r => r.modelRequested),
    }
    await clear393()
    rungCooldownReset()
    failoverBindReset()
    return res
  }
  const withFree = await run("f", ["free-t8r4#", "other-t8r4#"])
  expect(withFree, "A держит free (вызов не окончен) -- B пропускает её и идёт на other").toEqual({
    midA: ["free-t8r4f"],
    seenA: ["decla-t8r4f", "free-t8r4f"], seenB: ["declb-t8r4f", "other-t8r4f"],
    outA: "OK-free-t8r4f", outB: "OK-other-t8r4f",
    taken: ["free-t8r4f"],
  })
  const noFree = await run("n", ["free-t8r4#"])
  expect(noFree, "свободных нет -- B идёт на занятую и не умирает").toEqual({
    midA: ["free-t8r4n"],
    seenA: ["decla-t8r4n", "free-t8r4n"], seenB: ["declb-t8r4n", "free-t8r4n"],
    outA: "OK-free-t8r4n", outB: "OK-free-t8r4n",
    taken: [],
  })
})

test("#509-FIX8 Р4 (б): отказ попытки возвращает прежнюю запись реестра -- третий проверяющий видит модель свободной", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 13, 20, 0)
  const h = host514("8r4b", T0, { noProc: true })
  await spawn514(h, "ag-8r4ba", "crit-mech", "decla-t8r4b")
  await spawn514(h, "ag-8r4bc", "crit-mech", "declc-t8r4b")
  failoverBindSet("ag-8r4ba", { ladder: ["free-t8r4b"], terminal: "", rungEffort: { "free-t8r4b": "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  const nextA = gated8(h, { "decla-t8r4b": refuseAll514(NORESP6), "free-t8r4b": refuseAll514(NORESP6) }, ["free-t8r4b"])
  nextA.budget = { ms: 10000, remainingMs: 1000 }
  const pA = step514(h, "ag-8r4ba", "decla-t8r4b", nextA)
  await settle393()
  const during = R514.sessionReviewersServedByOthers("ag-8r4bc", T0)
  nextA.open("free-t8r4b")
  await pA
  await settle393()
  const after = R514.sessionReviewersServedByOthers("ag-8r4bc", T0)
  expect({ enteredA: nextA.entered, seenA: nextA.seen, during, after }, "резерв виден во время вызова, после отказа запись A -- снова объявленная").toEqual({
    enteredA: ["free-t8r4b"], seenA: ["decla-t8r4b", "free-t8r4b"], during: ["free-t8r4b"], after: ["decla-t8r4b"],
  })
  // CONSTRAINT: метка остывания free от отказа A откладывала бы её в хвост
  // плана C; зуб меряет реестр проверяющих, не остывание.
  rungCooldownReset()
  failoverBindSet("ag-8r4bc", { ladder: ["free-t8r4b", "other-t8r4b"], terminal: "", rungEffort: { "free-t8r4b": "high", "other-t8r4b": "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  const nextC = next514(h, { "declc-t8r4b": refuseAll514(NORESP6), "free-t8r4b": () => null, "other-t8r4b": () => null })
  const outC = await step514(h, "ag-8r4bc", "declc-t8r4b", nextC)
  expect({ seen: nextC.seen, out: outC.value && outC.value.text }, "free свободна -- C идёт на неё").toEqual({ seen: ["declc-t8r4b", "free-t8r4b"], out: "OK-free-t8r4b" })
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

// CONSTRAINT (#509-FIX8b): шаг проверяющего бросается потребителем `.return()`
// на первом куске ступени rung; объявленная decl отказывает раньше. Реестр
// меряется глазами другого проверяющего (sessionReviewersServedByOthers).
async function abandon8b(tag: string, spawned: boolean, chunk: any): Promise<any> {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 13, 40, 0)
  const h = host514("8b" + tag, T0, { noProc: true })
  const aid = "ag-8b" + tag
  const decl = "decl-t8b" + tag
  const rung = "rung-t8b" + tag
  if (spawned) await spawn514(h, aid, "crit-mech", decl)
  failoverBindSet(aid, { ladder: [rung], terminal: "", rungEffort: { [rung]: "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  const base = next514(h, { [decl]: refuseAll514(NORESP6) })
  const next: any = (req: any) => {
    const m = String(req && req.model)
    if (m !== rung) return base(req)
    base.seen.push(m)
    return (async function* () { yield chunk; await new Promise<void>(() => {}) })()
  }
  next.seen = base.seen
  next.signal = base.signal
  next.budget = base.budget
  const view = async (): Promise<string[]> => R514.sessionReviewersServedByOthers("ag-8b-other", await h.m.$.clock.now())
  const before = await view()
  const g = hook393(subs393(), "turn.step")(h.m.$, { agentId: aid, turnId: "t-" + aid, index: 0, model: decl, messageCount: 1 }, next)
  const first = await g.next()
  const during = await view()
  const ret = await g.return(undefined)
  await settle393()
  const after = await view()
  const out = { seen: next.seen.slice(), first: first.value, retDone: ret.done, before, during, after }
  await clear393()
  rungCooldownReset()
  failoverBindReset()
  return out
}

test("#509-FIX8b (а): генератор шага проверяющего брошен до первого куска с содержимым -- резерв снят: прежняя запись реестра, без прежней -- записи нет", async () => {
  const svc = { kind: "progress" }
  const withPrev = await abandon8b("p", true, svc)
  expect(withPrev, "прежняя запись -- объявленная со спавна").toEqual({
    seen: ["decl-t8bp", "rung-t8bp"], first: svc, retDone: true,
    before: ["decl-t8bp"], during: ["rung-t8bp"], after: ["decl-t8bp"],
  })
  const noPrev = await abandon8b("n", false, svc)
  expect(noPrev, "прежней записи не было -- записи нет").toEqual({
    seen: ["decl-t8bn", "rung-t8bn"], first: svc, retDone: true,
    before: [], during: ["rung-t8bn"], after: [],
  })
})

test("#509-FIX8b (б): генератор шага проверяющего брошен после куска с содержимым -- ступень состоялась, резерв на месте", async () => {
  const part = { kind: "text", index: 0, text: "part-8b" }
  const got = await abandon8b("c", true, part)
  expect(got).toEqual({
    seen: ["decl-t8bc", "rung-t8bc"], first: part, retDone: true,
    before: ["decl-t8bc"], during: ["rung-t8bc"], after: ["rung-t8bc"],
  })
})

// CONSTRAINT (#509-FIX8 Р6): потеря места видна полем `lost` записей журнала
// этого стенда или ещё не слитым lostWrites модуля.
function lost8(writes: { path: string; text: string }[]): Record<string, { n: number; last: string }> {
  const out: Record<string, { n: number; last: string }> = {}
  const add = (lost: any): void => {
    for (const k of Object.keys(lost || {})) {
      out[k] = out[k] ? { n: out[k].n + Number(lost[k].n), last: String(lost[k].last) } : { n: Number(lost[k].n), last: String(lost[k].last) }
    }
  }
  for (const w of writes) {
    let r: any = null
    try { r = JSON.parse(String(w.text)) } catch (x) { r = null }
    if (r && typeof r === "object" && r.lost) add(r.lost)
  }
  add(registerModule393.lostWritesSnapshot())
  return out
}

test("#509-FIX8 Р6: чтение истории проиграло сроку D, потом бросило -- noteLost failover-history-late с причиной", async () => {
  await drainFold393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 13, 40, 0)
  let hh: any = null
  const h = host514("8r6", T0, {
    env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "2000" },
    doorCost: (door, n) => (door === "messages" && n === 3 ? 1100 : 0),
    afterFire: true,
    onMessages: (n) => { hh.messagesThrow = n === 3 },
  })
  hh = h
  failoverBindSet("ag-8r6", { ladder: [], terminal: "claude-t8r6", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "claude-t8r6": (k) => (k === 0 ? NORESP6 : null) })
  const out = await step514(h, "ag-8r6", "claude-t8r6", next)
  await settle393()
  expect(out.value && out.value.text).toBe("OK-claude-t8r6")
  expect(waits514(h, "ag-8r6", "history-past-deadline").map(r => r.forAttempt), "чтение проиграло сроку").toEqual([1])
  const lost = lost8(h.m.writes)["failover-history-late"]
  expect(lost && lost.last, "поздний отказ чтения назван сайтом и причиной").toBe("session.messages: scripted refusal")
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX8 Р13: мёртвый провайдер и статус 402 в одной строке -- permanent-model: PROVIDER_GONE решает раньше QUOTA", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  const l = "API Error: 402 model x is not available on this server"
  expect({ gone: R514.PROVIDER_GONE_RX.test(l), quota: R514.QUOTA_RX.test(l), c: cr(l, now, "grok-4.7").class }).toEqual({ gone: true, quota: true, c: "permanent-model" })
})

// --- #509-FIX8c ------------------------------------------------------------------
// CONSTRAINT (#509-FIX8c Р1): строка message каждого тела по отдельности решает
// другой класс, чем error.code: класс по коду доказывает, что тело решает раньше строк.
const MNFQ8C = "{\n  \"error\": {\n    \"code\": \"model_not_found\",\n    \"message\": \"quota exhausted\"\n  }\n}"
const ZUP8C = "{\n  \"error\": {\n    \"code\": \"1308\",\n    \"message\": \"unknown provider\"\n  }\n}"

test("#509-FIX8c Р1 (а): сообщение целиком JSON -- класс по error.code раньше строки message; бросок next этим текстом -- тот же класс, следующая ступень", async () => {
  const pick = R514.refusalLineOfMessages
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-03T09:00:00Z")
  const cases: Array<[string, string, string, string]> = [
    ["c1a", "grok-4.6-t8c1a", MNFQ8C, "permanent-model"],
    ["c1b", "glm-5.3-t8c1b", ZUP8C, "quota"],
  ]
  const got: any[] = []
  const want: any[] = []
  for (const [tag, orig, body, cls] of cases) {
    const flat = body.replace(/\s+/g, " ").trim()
    const p = pick([body], orig)
    got.push({ tag, pick: p, cls: cr(p.line, now, orig).class })
    want.push({ tag, pick: { line: flat, known: true }, cls })
    reset514()
    const h = host514("8" + tag, Date.UTC(2026, 9, 3, 14, 0, 0))
    const aid = "ag-8" + tag
    const rung = "qwen-t8" + tag
    failoverBindSet(aid, { ladder: [rung], terminal: "", rungEffort: { [rung]: "high" }, subagentType: "t", class: "", sticky: null })
    const next = next514(h, { [orig]: () => ({ throwSilent: body }), [rung]: () => null })
    let out: any = null
    let threw = ""
    try { out = await step514(h, aid, orig, next) } catch (x: any) { threw = String((x && x.message) || x) }
    const a0 = attempts514(h, aid)[0] || {}
    got.push({ tag: tag + "-throw", seen: next.seen, cls: a0.refusalClass, text: a0.refusalText, value: out && out.value && out.value.text, threw })
    want.push({ tag: tag + "-throw", seen: [orig, rung], cls, text: flat, value: "OK-" + rung, threw: "" })
    rungCooldownReset()
    failoverBindReset()
  }
  expect(got).toEqual(want)
})

test("#509-FIX8c Р1 (б): JSON внутри прозы класса тела не получает -- known:false", () => {
  const swe2 = "Ответ от шлюза:\n{\n  \"error\": { \"code\": \"model_not_found\" }\n}"
  expect(R514.refusalLineOfMessages([swe2], "grok-4.6")).toEqual({ line: "Ответ от шлюза:", known: false })
})

test("#509-FIX8c Р2: чтение истории проиграло сроку D, потом отклонено значением null -- noteLost failover-history-late называет отказ без значения", async () => {
  await drainFold393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 14, 20, 0)
  const h = host514("8cr2", T0, {
    env: { CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "2000" },
    doorCost: (door, n) => (door === "messages" && n === 3 ? 1100 : 0),
    afterFire: true,
    onMessages: (n) => { if (n === 3) throw null },
  })
  failoverBindSet("ag-8cr2", { ladder: [], terminal: "claude-t8cr2", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "claude-t8cr2": (k) => (k === 0 ? NORESP6 : null) })
  const out = await step514(h, "ag-8cr2", "claude-t8cr2", next)
  await settle393()
  expect(out.value && out.value.text).toBe("OK-claude-t8cr2")
  expect(waits514(h, "ag-8cr2", "history-past-deadline").map(r => r.forAttempt), "чтение проиграло сроку").toEqual([1])
  const lost = lost8(h.m.writes)["failover-history-late"]
  expect(lost && lost.last, "поздний отказ без значения назван").toBe("(отказ без значения: null)")
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX8c Р3: поток ступени проверяющего завис до первого куска, потребитель отменил next.signal -- резерв снят без ожидания .next()", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 14, 40, 0)
  const h = host514("8cr3", T0, { noProc: true })
  const aid = "ag-8cr3"
  const decl = "decl-t8cr3"
  const rung = "rung-t8cr3"
  await spawn514(h, aid, "crit-mech", decl)
  failoverBindSet(aid, { ladder: [rung], terminal: "", rungEffort: { [rung]: "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  const base = next514(h, { [decl]: refuseAll514(NORESP6) })
  const ac = new AbortController()
  const next: any = (req: any) => {
    const m = String(req && req.model)
    if (m !== rung) return base(req)
    base.seen.push(m)
    return (async function* () { await new Promise<void>(() => {}) })()
  }
  next.seen = base.seen
  next.signal = ac.signal
  next.budget = base.budget
  const view = async (): Promise<string[]> => R514.sessionReviewersServedByOthers("ag-8cr3-other", await h.m.$.clock.now())
  const before = await view()
  const g = hook393(subs393(), "turn.step")(h.m.$, { agentId: aid, turnId: "t-" + aid, index: 0, model: decl, messageCount: 1 }, next)
  void g.next()
  for (let i = 0; i < 40 && next.seen.length < 2; i++) await settle393()
  await settle393()
  const during = await view()
  ac.abort()
  const after = await view()
  expect({ seen: next.seen.slice(), before, during, after }, "поток висит -- .next() не вернётся; резерв снимает отмена сигнала").toEqual({
    seen: [decl, rung], before: [decl], during: [rung], after: [decl],
  })
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX8c Р4: два резерва одного агента с той же моделью и тем же t -- restore первого не трогает запись второго", () => {
  sessionExecutorsReset()
  const T = Date.UTC(2026, 9, 3, 15, 0, 0)
  R514.sessionReviewerServedSet("ag-8cr4", "m-t8cr4", T)
  const first = R514.sessionReviewerServedGet("ag-8cr4")
  R514.sessionReviewerServedSet("ag-8cr4", "m-t8cr4", T)
  const second = R514.sessionReviewerServedGet("ag-8cr4")
  R514.sessionReviewerServedRestore("ag-8cr4", first, [])
  expect({ cur: R514.sessionReviewerServedGet("ag-8cr4"), view: R514.sessionReviewersServedByOthers("ag-8cr4-other", T) }).toEqual({ cur: second, view: ["m-t8cr4"] })
  sessionExecutorsReset()
})

test("#509-FIX8c Р7: реестр полон (64), резервы нового проверяющего без прежней записи отказали -- все 64 прежние записи на месте", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 15, 20, 0)
  const h = host514("8cr7", T0, { noProc: true })
  for (let k = 0; k < R514.SESSION_REVIEWER_SERVED_CAP; k++) R514.sessionReviewerServedSet("ag-8cr7-" + k, "m" + k + "-t8cr7", T0 - 1000)
  const before = R514.sessionReviewersServedByOthers("ag-8cr7-view", T0).slice().sort()
  failoverBindSet("ag-8cr7", { ladder: ["rung-t8cr7"], terminal: "", rungEffort: { "rung-t8cr7": "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  const next = next514(h, { "decl-t8cr7": refuseAll514(NORESP6), "rung-t8cr7": refuseAll514(NORESP6) })
  next.budget = { ms: 10000, remainingMs: 1000 }
  await step514(h, "ag-8cr7", "decl-t8cr7", next)
  const after = R514.sessionReviewersServedByOthers("ag-8cr7-view", T0).slice().sort()
  expect({ seen: next.seen, n: before.length, after }, "каждый резерв вытеснял старейшую чужую запись; отказ возвращает её").toEqual({
    seen: ["decl-t8cr7", "rung-t8cr7"], n: 64, after: before,
  })
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

// CONSTRAINT (#509-FIX8c Р6, #509-FIX8d Р1): B занимает X между выбором цели и
// пробой (запись wait-probe на X): занятую заранее X wakeTarget проверяющего не
// выбирает, и проба X не наступила бы. Запись реестра -- та, что делает спавн B
// с объявленной X; успешный шаг B на X снял бы метку X (noteModelSuccess), и A
// ушёл бы в проход пробуждения. Отказ X и Y -- quota (метка 60 мин): метка
// temporary-unknown истекает раньше сердцебиения 240 с.
test("#509-FIX8c Р6: проверяющий A ждёт на ступени X, проверяющий B занял X, сердцебиение A -- reviewer-taken, A идёт на следующую свободную ступень", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 12, 0, 0)
  const X = "x-t8cr6"
  const Y = "y-t8cr6"
  const declA = "decla-t8cr6"
  const h = host514("8cr6", T0)
  const w0 = h.m.$.fs.write
  let armed = false
  h.m.$.fs.write = async (p: string, text: string) => {
    const s = String(text)
    if (!armed && s.indexOf('"outcome":"wait-probe"') >= 0 && s.indexOf('"model":"' + X + '"') >= 0) {
      armed = true
      R514.sessionReviewerServedSet("ag-8cr6b", X, await h.m.$.clock.now())
    }
    return await w0(p, text)
  }
  failoverBindSet("ag-8cr6a", { ladder: [X, Y], terminal: "", rungEffort: { [X]: "high", [Y]: "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  const next = next514(h, {
    [declA]: refuseAll514(LIMIT11),
    [X]: (k) => (k === 0 ? "402 Payment Required" : null),
    [Y]: (k) => (k === 0 ? "402 Payment Required" : null),
  })
  const out = await step514(h, "ag-8cr6a", declA, next)
  expect({
    seen: next.seen,
    out: out.value && out.value.text,
    probes: waits514(h, "ag-8cr6a", "wait-probe").map(r => r.kind + ":" + r.model),
    taken: waits514(h, "ag-8cr6a", "reviewer-taken").map(r => r.modelRequested),
  }).toEqual({ seen: [declA, X, Y, Y], out: "OK-" + Y, probes: ["heartbeat:" + X], taken: [X] })
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

// --- #509-FIX8d ------------------------------------------------------------------
// CONSTRAINT (#509-FIX8d Р1): X уходит из плана по известному сбросу (12:20)
// только в проходе пробуждения (skipKnown): объявленная сперва отказывает
// коротко (30 с) и будит проход, затем квотой (60 мин) -- тогда ближайшая цель
// ожидания -- X вне плана. Окно зуба -- 10 мин, X за него не остывает.
async function outOfPlan8d(tag: string, take: "spawn" | "race"): Promise<any> {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 12, 0, 0)
  const X = "x-t8d" + tag
  const declA = "decla-t8d" + tag
  const aid = "ag-8d" + tag + "a"
  const bid = "ag-8d" + tag + "b"
  let hh: any = null
  let nx: any = null
  let spawnB: any = null
  const h = host514("8d" + tag, T0, {
    sleepHook: (n, now) => {
      if (take === "spawn" && n === 1) spawnB = spawn514(hh, bid, "crit-mech", X)
      if (now >= T0 + 600000) nx.signal.aborted = true
    },
  })
  hh = h
  if (take === "race") {
    const w0 = h.m.$.fs.write
    let armed = false
    h.m.$.fs.write = async (p: string, text: string) => {
      const s = String(text)
      if (!armed && s.indexOf('"outcome":"wait-probe"') >= 0 && s.indexOf('"model":"' + X + '"') >= 0) {
        armed = true
        R514.sessionReviewerServedSet(bid, X, await h.m.$.clock.now())
      }
      return await w0(p, text)
    }
  }
  failoverBindSet(aid, { ladder: [X], terminal: "", rungEffort: { [X]: "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  nx = next514(h, {
    [declA]: (k) => (k === 0 ? NORESP6 : "402 Payment Required"),
    [X]: (k) => (k === 0 ? "You've hit your session limit · resets 12:20pm (UTC)" : null),
  })
  const out = await step514(h, aid, declA, nx)
  if (spawnB) await spawnB
  const res = {
    xCalls: nx.seen.filter((m: string) => m === X).length,
    calls: nx.seen.length,
    served: out && out.value && out.value.text,
    skippedKnown: waits514(h, aid, "skipped-known-until").map(r => r.model),
    probesOnX: waits514(h, aid, "wait-probe").filter(r => r.model === X).map(r => r.kind),
    taken: waits514(h, aid, "reviewer-taken").map(r => r.modelRequested),
    aborted: waits514(h, aid, "wait-aborted").length,
  }
  await clear393()
  rungCooldownReset()
  failoverBindReset()
  return res
}

test("#509-FIX8d Р1 (а): единственная цель вне плана -- X с меткой сброса, X держит другой проверяющий -- wakeTarget X не выбирает, шаг на X не обслужен", async () => {
  const got = await outOfPlan8d("a", "spawn")
  expect({ xCalls: got.xCalls, served: got.served, skippedKnown: got.skippedKnown.slice(0, 1), probesOnX: got.probesOnX, taken: got.taken, aborted: got.aborted },
    "X вне плана (skipped-known-until), занята B -- цель ожидания не X, проб на X нет").toEqual({
    xCalls: 1, served: undefined, skippedKnown: ["x-t8da"], probesOnX: [], taken: [], aborted: 1,
  })
})

test("#509-FIX8d Р1 (б): X заняли между выбором цели и пробой -- reviewer-taken, шаг на X не обслужен; дальше без X и без горячего цикла", async () => {
  const got = await outOfPlan8d("b", "race")
  expect({ xCalls: got.xCalls, served: got.served, skippedKnown: got.skippedKnown.slice(0, 1), probesOnX: got.probesOnX, taken: got.taken, aborted: got.aborted },
    "проба X по сердцебиению -- X занята к моменту пробы").toEqual({
    xCalls: 1, served: undefined, skippedKnown: ["x-t8db"], probesOnX: ["heartbeat"], taken: ["x-t8db"], aborted: 1,
  })
  expect(got.calls, "вызовов модели за окно 10 мин -- не больше 6: первый проход (2), пробуждение, продолжение плана после reviewer-taken, два сердцебиения").toBeLessThanOrEqual(6)
})

// CONSTRAINT (#509-FIX8e): объявленная отказывает дефектом запроса (stepRequest)
// и из кандидатов цели выходит; единственный кандидат -- терминал, который держит
// другой проверяющий. Терминал свободен (AR-1 FIX8d): вычитание его дало бы
// wait-no-target вместо ожидания.
test("#509-FIX8e: единственный кандидат цели ожидания -- терминал, его держит другой проверяющий -- цель терминал, wait-no-target нет, сердцебиение обслужено терминалом", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 16, 0, 0)
  const h = host514("8e", T0)
  const aid = "ag-8ea"
  const declA = "decla-t8e"
  const term = "claude-t8e"
  await spawn514(h, "ag-8eb", "crit-mech", term)
  failoverBindSet(aid, { ladder: [], terminal: term, rungEffort: {}, subagentType: "t", class: "crit-mech", sticky: null })
  const held = R514.sessionReviewersServedByOthers(aid, T0)
  const next = next514(h, {
    [declA]: refuseAll514("Prompt is too long"),
    [term]: (k) => (k === 0 ? "402 Payment Required" : null),
  })
  const out = await step514(h, aid, declA, next)
  expect({
    held: held.indexOf(term) >= 0,
    seen: next.seen,
    out: out && out.value && out.value.text,
    noTarget: waits514(h, aid, "wait-no-target").length,
    probes: waits514(h, aid, "wait-probe").map(r => r.kind + ":" + r.model),
    taken: waits514(h, aid, "reviewer-taken").length,
  }, "терминал, занятый B, остаётся целью ожидания A").toEqual({
    held: true, seen: [declA, term, term], out: "OK-" + term, noTarget: 0, probes: ["heartbeat:" + term], taken: 0,
  })
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

// --- #509-FIX8f ------------------------------------------------------------------
// CONSTRAINT (#509-FIX8f Р1): P -- запись агента до резервов; резервы A и B
// одного агента на одной модели в один момент, restore -- в порядке order.
function chain8f(tag: string, order: "ab" | "ba"): any {
  sessionExecutorsReset()
  const T = Date.UTC(2026, 9, 3, 16, 0, 0)
  const aid = "ag-8f" + tag
  R514.sessionReviewerServedSet(aid, "p-t8f" + tag, T - 1000)
  const P = R514.sessionReviewerServedGet(aid)
  const evA = R514.sessionReviewerServedSet(aid, "x-t8f" + tag, T, { reserve: true })
  const A = R514.sessionReviewerServedGet(aid)
  const evB = R514.sessionReviewerServedSet(aid, "x-t8f" + tag, T, { reserve: true })
  const B = R514.sessionReviewerServedGet(aid)
  if (order === "ab") {
    R514.sessionReviewerServedRestore(aid, A, evA)
    R514.sessionReviewerServedRestore(aid, B, evB)
  } else {
    R514.sessionReviewerServedRestore(aid, B, evB)
    R514.sessionReviewerServedRestore(aid, A, evA)
  }
  const cur = R514.sessionReviewerServedGet(aid)
  const out = { isP: cur === P, model: cur && cur.model, view: R514.sessionReviewersServedByOthers(aid + "-other", T) }
  sessionExecutorsReset()
  return out
}

test("#509-FIX8f Р1 (а): P, резерв A, резерв B, restore A, restore B -- запись агента P", () => {
  expect(chain8f("a", "ab")).toEqual({ isP: true, model: "p-t8fa", view: ["p-t8fa"] })
})

test("#509-FIX8f Р1 (б): P, резерв A, резерв B, restore B, restore A -- запись агента P", () => {
  expect(chain8f("b", "ba")).toEqual({ isP: true, model: "p-t8fb", view: ["p-t8fb"] })
})

test("#509-FIX8f Р1 (в): P, резерв A, успех A, резерв B, restore B -- запись агента -- успех A", () => {
  sessionExecutorsReset()
  const T = Date.UTC(2026, 9, 3, 16, 10, 0)
  const aid = "ag-8fc"
  R514.sessionReviewerServedSet(aid, "p-t8fc", T - 1000)
  R514.sessionReviewerServedSet(aid, "x-t8fc", T, { reserve: true })
  R514.sessionReviewerServedSet(aid, "x-t8fc", T + 500)
  const S = R514.sessionReviewerServedGet(aid)
  const evB = R514.sessionReviewerServedSet(aid, "y-t8fc", T + 1000, { reserve: true })
  const B = R514.sessionReviewerServedGet(aid)
  R514.sessionReviewerServedRestore(aid, B, evB)
  const cur = R514.sessionReviewerServedGet(aid)
  expect({ isS: cur === S, model: cur && cur.model, t: cur && cur.t }).toEqual({ isS: true, model: "x-t8fc", t: T + 500 })
  sessionExecutorsReset()
})

// CONSTRAINT (#509-FIX8f Р1 (г)): поток abandon8b, но запись читается до
// clear393 -- /clear сбрасывает реестр.
test("#509-FIX8f Р1 (г): ступень проверяющего выдала содержимое, резерв остался -- связь резерва с прежней записью снята", async () => {
  await clear393()
  reset514()
  const h = host514("8fg", Date.UTC(2026, 9, 3, 16, 30, 0), { noProc: true })
  const aid = "ag-8fg"
  const decl = "decl-t8fg"
  const rung = "rung-t8fg"
  await spawn514(h, aid, "crit-mech", decl)
  failoverBindSet(aid, { ladder: [rung], terminal: "", rungEffort: { [rung]: "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  const base = next514(h, { [decl]: refuseAll514(NORESP6) })
  const part = { kind: "text", index: 0, text: "part-8fg" }
  const next: any = (req: any) => {
    const m = String(req && req.model)
    if (m !== rung) return base(req)
    base.seen.push(m)
    return (async function* () { yield part; await new Promise<void>(() => {}) })()
  }
  next.seen = base.seen
  next.signal = base.signal
  next.budget = base.budget
  const g = hook393(subs393(), "turn.step")(h.m.$, { agentId: aid, turnId: "t-" + aid, index: 0, model: decl, messageCount: 1 }, next)
  const first = await g.next()
  const during = R514.sessionReviewerServedGet(aid)
  const linkedDuring = !!(during && during.prevRec)
  await g.return(undefined)
  await settle393()
  const rec = R514.sessionReviewerServedGet(aid)
  const got = { seen: next.seen.slice(), first: first.value, linkedDuring, same: rec === during, model: rec && rec.model, linked: !!(rec && rec.prevRec) }
  await clear393()
  rungCooldownReset()
  failoverBindReset()
  expect(got).toEqual({ seen: [decl, rung], first: part, linkedDuring: true, same: true, model: rung, linked: false })
})

test("#509-FIX8f Р1 (е): ступень проверяющего успешна -- связь её резерва с прежней записью снята, в реестре новая запись успеха", async () => {
  await clear393()
  reset514()
  const h = host514("8fe", Date.UTC(2026, 9, 3, 16, 35, 0), { noProc: true })
  const aid = "ag-8fe"
  const decl = "decl-t8fe"
  const rung = "rung-t8fe"
  await spawn514(h, aid, "crit-mech", decl)
  failoverBindSet(aid, { ladder: [rung], terminal: "", rungEffort: { [rung]: "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  const base = next514(h, { [decl]: refuseAll514(NORESP6) })
  let during: any = null
  let linkedDuring = false
  const next: any = (req: any) => {
    const m = String(req && req.model)
    if (m !== rung) return base(req)
    base.seen.push(m)
    return (async function* () {
      during = R514.sessionReviewerServedGet(aid)
      linkedDuring = !!(during && during.prevRec)
      return { usage: { out: 1 }, stopReason: "end_turn", text: "OK-" + rung }
    })()
  }
  next.seen = base.seen
  next.signal = base.signal
  next.budget = base.budget
  const out = await step514(h, aid, decl, next)
  const rec = R514.sessionReviewerServedGet(aid)
  const got = { seen: next.seen.slice(), out: out && out.value && out.value.text, linkedDuring, reserveLinked: !!(during && during.prevRec), fresh: !!rec && rec !== during, model: rec && rec.model, linked: !!(rec && rec.prevRec) }
  await clear393()
  rungCooldownReset()
  failoverBindReset()
  expect(got).toEqual({ seen: [decl, rung], out: "OK-" + rung, linkedDuring: true, reserveLinked: false, fresh: true, model: rung, linked: false })
})

test("#509-FIX8f Р1 (д): вытесненная запись -- отменённый резерв другого агента -- возврат ставит его прежнюю запись, не отменённый резерв", () => {
  sessionExecutorsReset()
  const T0 = Date.UTC(2026, 9, 3, 16, 20, 0)
  const x = "ag-8fdx"
  R514.sessionReviewerServedSet(x, "px-t8fd", T0 - 100000)
  const PX = R514.sessionReviewerServedGet(x)
  for (let k = 1; k < R514.SESSION_REVIEWER_SERVED_CAP; k++) R514.sessionReviewerServedSet("ag-8fd-" + k, "m" + k + "-t8fd", T0 - 50000 + k)
  const evX = R514.sessionReviewerServedSet(x, "rx-t8fd", T0 - 90000, { reserve: true })
  const RX = R514.sessionReviewerServedGet(x)
  const evA = R514.sessionReviewerServedSet("ag-8fda", "a-t8fd", T0, { reserve: true })
  const RA = R514.sessionReviewerServedGet("ag-8fda")
  R514.sessionReviewerServedRestore(x, RX, evX)
  R514.sessionReviewerServedRestore("ag-8fda", RA, evA)
  const cur = R514.sessionReviewerServedGet(x)
  expect({ evX: evX.length, evA: evA.map((e: any) => e[0]), isPX: cur === PX, model: cur && cur.model, a: R514.sessionReviewerServedGet("ag-8fda") === undefined }).toEqual({
    evX: 0, evA: [x], isPX: true, model: "px-t8fd", a: true,
  })
  sessionExecutorsReset()
})

test("#509-FIX8f Р2 (а): сообщение -- JSON-документ без класса тела -- его строки не проверяются: {\"samples\":[402]} -- known:false", () => {
  expect(R514.refusalLineOfMessages(["{\"samples\":[\n402\n]}"], "grok-4.7-t8f2").known).toBe(false)
})

test("#509-FIX8f Р2 (б): многострочный JSON-массив с объектом ошибки model_not_found -- permanent-model", () => {
  const body = "[{\n \"error\": { \"code\": \"model_not_found\" }\n}]"
  const p = R514.refusalLineOfMessages([body], "grok-4.7-t8f2")
  const c = R514.classifyRefusal(p.line, Date.parse("2026-10-03T09:00:00Z"), "grok-4.7-t8f2").class
  expect({ known: p.known, c }).toEqual({ known: true, c: "permanent-model" })
})

test("#509-FIX8f Р2 (в): однострочный JSON-массив с объектом ошибки model_not_found -- permanent-model", () => {
  const body = "[{\"error\":{\"code\":\"model_not_found\"}}]"
  const p = R514.refusalLineOfMessages([body], "grok-4.7-t8f2")
  const c = R514.classifyRefusal(p.line, Date.parse("2026-10-03T09:00:00Z"), "grok-4.7-t8f2").class
  expect({ known: p.known, c }).toEqual({ known: true, c: "permanent-model" })
})

test("#509-FIX8f Р5 (а): реестр R1…R64 по возрастанию t, резерв нового A без прежней записи, restore -- постановка C вытесняет R1, а не R2", () => {
  sessionExecutorsReset()
  const T0 = Date.UTC(2026, 9, 3, 16, 40, 0)
  const cap = R514.SESSION_REVIEWER_SERVED_CAP
  for (let k = 1; k <= cap; k++) R514.sessionReviewerServedSet("ag-8f5a-" + k, "m" + k + "-t8f5a", T0 - (cap + 1 - k) * 1000)
  const evA = R514.sessionReviewerServedSet("ag-8f5a-a", "a-t8f5a", T0, { reserve: true })
  const A = R514.sessionReviewerServedGet("ag-8f5a-a")
  R514.sessionReviewerServedRestore("ag-8f5a-a", A, evA)
  const evC = R514.sessionReviewerServedSet("ag-8f5a-c", "c-t8f5a", T0 + 1000)
  expect({
    evA: evA.map((e: any) => e[0]), evC: evC.map((e: any) => e[0]),
    r1: R514.sessionReviewerServedGet("ag-8f5a-1") !== undefined, r2: R514.sessionReviewerServedGet("ag-8f5a-2") !== undefined,
    a: R514.sessionReviewerServedGet("ag-8f5a-a") !== undefined,
  }).toEqual({ evA: ["ag-8f5a-1"], evC: ["ag-8f5a-1"], r1: false, r2: true, a: false })
  sessionExecutorsReset()
})

test("#509-FIX8f Р5 (б): restore при чужом seq возвращает запись, вытесненную этим резервом", () => {
  sessionExecutorsReset()
  const T0 = Date.UTC(2026, 9, 3, 17, 0, 0)
  const cap = R514.SESSION_REVIEWER_SERVED_CAP
  for (let k = 1; k < cap; k++) R514.sessionReviewerServedSet("ag-8f5b-" + k, "m" + k + "-t8f5b", T0 - (cap - k) * 1000)
  const evB = R514.sessionReviewerServedSet("ag-8f5b-b", "b-t8f5b", T0, { reserve: true })
  const B = R514.sessionReviewerServedGet("ag-8f5b-b")
  const evA = R514.sessionReviewerServedSet("ag-8f5b-a", "a-t8f5b", T0, { reserve: true })
  const A = R514.sessionReviewerServedGet("ag-8f5b-a")
  R514.sessionReviewerServedSet("ag-8f5b-a", "a2-t8f5b", T0, { reserve: true })
  const A2 = R514.sessionReviewerServedGet("ag-8f5b-a")
  R514.sessionReviewerServedRestore("ag-8f5b-b", B, evB)
  R514.sessionReviewerServedRestore("ag-8f5b-a", A, evA)
  expect({
    evB: evB.length, evA: evA.map((e: any) => e[0]),
    r1: R514.sessionReviewerServedGet("ag-8f5b-1") !== undefined, isA2: R514.sessionReviewerServedGet("ag-8f5b-a") === A2,
    n: R514.sessionReviewersServedByOthers("ag-8f5b-view", T0).length,
  }).toEqual({ evB: 0, evA: ["ag-8f5b-1"], r1: true, isA2: true, n: cap })
  sessionExecutorsReset()
})

test("#509-FIX8g: полный реестр, резерв A вытесняет R1, сброс реестра новой сессией, restore A -- реестр новой сессии пуст, R1 не вернулась", () => {
  sessionExecutorsReset()
  const T0 = Date.UTC(2026, 9, 3, 17, 20, 0)
  const cap = R514.SESSION_REVIEWER_SERVED_CAP
  for (let k = 1; k <= cap; k++) R514.sessionReviewerServedSet("ag-8g-" + k, "m" + k + "-t8g", T0 - (cap + 1 - k) * 1000)
  const evA = R514.sessionReviewerServedSet("ag-8g-a", "a-t8g", T0, { reserve: true })
  const A = R514.sessionReviewerServedGet("ag-8g-a")
  sessionExecutorsReset()
  R514.sessionReviewerServedRestore("ag-8g-a", A, evA)
  expect({
    evA: evA.map((e: any) => e[0]), cancelled: !!(A && A.cancelled),
    r1: R514.sessionReviewerServedGet("ag-8g-1") !== undefined,
    view: R514.sessionReviewersServedByOthers("ag-8g-view", T0),
  }).toEqual({ evA: ["ag-8g-1"], cancelled: true, r1: false, view: [] })
  sessionExecutorsReset()
})

// --- #509-FIX8h ------------------------------------------------------------------
test("#509-FIX8h Р2 (а): шаги проверяющего и исполнителя начаты до сброса реестров, успех после -- реестр проверяющих и модели исполнителей новой сессии пусты", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 17, 40, 0)
  const h = host514("8h2a", T0, { noProc: true })
  let open: () => void = () => {}
  const gate = new Promise<void>(r => { open = r })
  const seen: string[] = []
  const mk = (model: string): any => {
    const next: any = (req: any) => {
      const m = String(req && req.model)
      seen.push(m)
      return (async function* () {
        await gate
        return { usage: { out: 1 }, stopReason: "end_turn", text: "OK-" + m }
      })()
    }
    next.signal = { aborted: false }
    next.budget = { ms: 10000, remainingMs: Infinity }
    return next
  }
  failoverBindSet("ag-8h2ar", { ladder: ["rung-t8h2ar"], terminal: "", rungEffort: { "rung-t8h2ar": "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  failoverBindSet("ag-8h2ae", { ladder: ["rung-t8h2ae"], terminal: "", rungEffort: { "rung-t8h2ae": "high" }, subagentType: "t", class: "exec-0n", sticky: null })
  const pr = step514(h, "ag-8h2ar", "decl-t8h2ar", mk("decl-t8h2ar"))
  const pe = step514(h, "ag-8h2ae", "decl-t8h2ae", mk("decl-t8h2ae"))
  for (let i = 0; i < 40 && seen.length < 2; i++) await settle393()
  const heldBefore = R514.sessionReviewerServedGet("ag-8h2ar") !== undefined
  sessionExecutorsReset()
  open()
  const outR = await pr
  const outE = await pe
  const got = {
    seen: seen.slice().sort(), heldBefore,
    outR: outR && outR.value && outR.value.text, outE: outE && outE.value && outE.value.text,
    reviewer: R514.sessionReviewerServedGet("ag-8h2ar") === undefined,
    view: R514.sessionReviewersServedByOthers("ag-8h2a-view", T0 + 60000),
    executor: sessionExecutorHas("decl-t8h2ae"),
  }
  await clear393()
  rungCooldownReset()
  failoverBindReset()
  expect(got).toEqual({
    seen: ["decl-t8h2ae", "decl-t8h2ar"], heldBefore: true,
    outR: "OK-decl-t8h2ar", outE: "OK-decl-t8h2ae", reviewer: true, view: [], executor: false,
  })
})

test("#509-FIX8h Р2 (б): спавны проверяющего и исполнителя, next разрешается после сброса реестров -- реестр проверяющих и модели исполнителей новой сессии пусты", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 3, 17, 50, 0)
  const h = host514("8h2b", T0, { noProc: true })
  let open: () => void = () => {}
  const gate = new Promise<void>(r => { open = r })
  let called = 0
  const spawnGated = (aid: string, cls: string, model: string): Promise<any> => hook393(subs393(), "agent.spawn")(h.m.$, {
    subagentType: "any-agent", prompt: "[dispatch-class:" + cls + "] x", model,
  }, async () => { called++; await gate; return { agentId: aid } })
  const pr = spawnGated("ag-8h2br", "crit-mech", "decl-t8h2br")
  const pe = spawnGated("ag-8h2be", "exec-0n", "decl-t8h2be")
  for (let i = 0; i < 40 && called < 2; i++) await settle393()
  sessionExecutorsReset()
  open()
  const outR = await pr
  const outE = await pe
  const got = {
    called, idR: outR && outR.agentId, idE: outE && outE.agentId,
    reviewer: R514.sessionReviewerServedGet("ag-8h2br") === undefined,
    view: R514.sessionReviewersServedByOthers("ag-8h2b-view", T0 + 60000),
    executor: sessionExecutorHas("decl-t8h2be"),
  }
  await clear393()
  rungCooldownReset()
  failoverBindReset()
  expect(got).toEqual({ called: 2, idR: "ag-8h2br", idE: "ag-8h2be", reviewer: true, view: [], executor: false })
})

test("#509-FIX8h Р4: 64 записи с t 1000…1063, резерв нового агента с t 0 -- резерв в реестре, вытеснена запись t 1000, restore её возвращает", () => {
  sessionExecutorsReset()
  const cap = R514.SESSION_REVIEWER_SERVED_CAP
  for (let k = 0; k < cap; k++) R514.sessionReviewerServedSet("ag-8h4-" + (1000 + k), "m" + k + "-t8h4", 1000 + k)
  const ev = R514.sessionReviewerServedSet("ag-8h4-a", "a-t8h4", 0, { reserve: true })
  const A = R514.sessionReviewerServedGet("ag-8h4-a")
  const inReg = A !== undefined && A.t === 0 && A.model === "a-t8h4" && R514.sessionReviewerServedGet("ag-8h4-a") === A
  const evicted = ev.map((e: any) => e[0])
  let back = false
  if (A) {
    R514.sessionReviewerServedRestore("ag-8h4-a", A, ev)
    back = R514.sessionReviewerServedGet("ag-8h4-1000") !== undefined
  }
  expect({ inReg, evicted, back, a: R514.sessionReviewerServedGet("ag-8h4-a") === undefined }).toEqual({
    inReg: true, evicted: ["ag-8h4-1000"], back: true, a: true,
  })
  sessionExecutorsReset()
})

test("#509-FIX8h Р5: JSON-массив с BOM в начале -- permanent-model", () => {
  const body = "﻿[{\"error\":{\"code\":\"model_not_found\"}}]"
  const p = R514.refusalLineOfMessages([body], "grok-4.7-t8h5")
  const c = R514.classifyRefusal(p.line, Date.parse("2026-10-03T09:00:00Z"), "grok-4.7-t8h5").class
  expect({ known: p.known, c }).toEqual({ known: true, c: "permanent-model" })
})

// --- stale-agents: idle-watch говорит сессии о висящих агентах; счёт флота ----
// CONSTRAINT: новые имена мода берутся через namespace-импорт: на дереве до
// волны их нет, и именованный импорт ронял бы весь файл вместо поимённых красных.
const SA: any = registerModule393 as any
const SA_MIN = 60_000
const SA_KINDS_OBSERVABLE = 'live_kinds = ["local_agent", "in_process_teammate"]\n'
const SA_TOOL = "mcp__catalyst-probes__fleet_status"

function sa$(tag: string, now: number, o: {
  cfg?: string
  idle?: string
  list?: () => any
  submitThrows?: boolean
  submitHang?: boolean
  submitDefer?: boolean
  env?: Record<string, string>
  files?: Record<string, string>
  extraNames?: string[]
  fsListThrows?: () => boolean
  onFsList?: () => Promise<void>
  onList?: () => Promise<void>
  fsWriteFail?: (p: string) => boolean
  proc?: boolean
  sidFails?: boolean
  fail?: Fail393
  statErr?: string[]
  procFn?: (argv: string[], init: any, setNow: (n: number) => void, getNow: () => number) => Promise<any>
  messages?: (arg: any) => any
  answers?: any[]
} = {}): any {
  const home = "/probes-sa-" + tag
  const sid = "sid-sa-" + tag
  const files: Record<string, string> = Object.assign({ [home + "/probes.toml"]: "[probe.idle-watch]\n" + (o.cfg ?? "") }, o.files || {})
  const st: any = { home, sid, cwd: "/work-sa-" + tag, fleetDir: home + "/idle-watch/fleet", files, agents: [] as any[], submits: [] as any[], listCalls: 0, fsListCalls: 0, tools: [] as any[], commands: [] as any[], cancels: 0, procArgv: [] as string[][], clockReads: 0 }
  st.env = Object.assign({ CLAUDE_PROBES_DIR: home, PWD: st.cwd, CLAUDE_IDLE: o.idle ?? "1" }, o.env || {})
  const m = mod$393({
    files,
    env: st.env,
    now,
    sid,
    fail: o.fail,
    proc: o.procFn ? o.procFn : o.proc ? async (argv: string[]) => { st.procArgv.push(argv.slice()); return { exitCode: 0, stdout: "", stderr: "" } } : undefined,
    messages: o.messages,
    answers: o.answers,
  })
  st.m = m
  const clockNow0 = m.$.clock.now
  m.$.clock.now = async () => { st.clockReads++; return clockNow0() }
  if (o.sidFails) m.$.session.id = async () => { throw new Error("session.id: scripted refusal") }
  m.$.fs.stat = async (p: string) => {
    if ((o.statErr || []).indexOf(String(p)) >= 0) throw new Error("EACCES: scripted stat refusal " + String(p))
    if (files[String(p)] === undefined) { const x: any = new Error("ENOENT: no such file " + String(p)); x.code = "ENOENT"; throw x }
    return { kind: "file", size: files[String(p)].length, mtimeMs: 0, isLink: false }
  }
  const write0 = m.$.fs.write
  m.$.fs.write = async (p: string, text: string) => {
    if (o.fsWriteFail && o.fsWriteFail(String(p))) throw new Error("fs.write: scripted refusal " + String(p))
    await write0(p, text)
    files[String(p)] = String(text)
  }
  m.$.fs.list = async (dir: string) => {
    st.fsListCalls++
    if (o.onFsList) await o.onFsList()
    if (o.fsListThrows && o.fsListThrows()) throw new Error("fs.list: scripted refusal")
    const pre = String(dir) + "/"
    const out: any[] = []
    for (const p of Object.keys(files)) {
      if (p.indexOf(pre) === 0 && p.slice(pre.length).indexOf("/") < 0) out.push({ name: p.slice(pre.length), kind: "file", size: files[p].length, isLink: false })
    }
    for (const n of o.extraNames || []) out.push({ name: n, kind: "file", size: 1, isLink: false })
    return out
  }
  m.$.agent.list = async () => {
    st.listCalls++
    if (o.onList) await o.onList()
    return o.list ? o.list() : st.agents
  }
  st.submitDefers = [] as Array<{ resolve: (v: any) => void; reject: (x: any) => void }>
  m.$.prompt = { submit: async (arg: any) => {
    st.submits.push(arg)
    if (o.submitDefer) return new Promise((resolve, reject) => { st.submitDefers.push({ resolve, reject }) })
    if (o.submitHang) return new Promise(() => {})
    if (o.submitThrows) throw new Error("prompt.submit: scripted refusal")
    return { text: String(arg && arg.text) }
  } }
  m.$.tool = { register: async (spec: any) => { st.tools.push(spec) } }
  m.$.command = { register: async (spec: any) => { st.commands.push(spec) } }
  const every0 = m.$.clock.every
  m.$.clock.every = (ms: number, cb: any) => {
    const h = every0(ms, cb)
    return { cancel: () => { st.cancels++; return h.cancel() } }
  }
  return st
}

function saStartEv(st: any, extra: any = {}): any {
  return Object.assign({ cwd: st.cwd, surface: "terminal", isInteractive: true }, extra)
}

async function saStart(st: any, extra: any = {}): Promise<void> {
  await clear393()
  st.cb = st.m.everyCbs.length
  await hook393(subs393(), "session.start")(st.m.$, saStartEv(st, extra), async () => ({}))
  st.tick = st.m.everyCbs[st.cb]
}

function saHead(thr: number): string {
  return "[catalyst-probes idle-watch] В этой сессии висят незакрытые агенты (без шагов модели и без новых вызовов инструментов ≥ " + thr + " мин):"
}

async function saTickAt(st: any, t: number): Promise<void> {
  st.m.setNow(t)
  if (typeof st.tick !== "function") throw new Error("таймер висящих агентов не взведён session.start")
  await st.tick()
  await settle393()
}

function saRun(id: string, extra: any = {}): any {
  return Object.assign({ id, description: "desc " + id, type: "general-purpose", status: "running" }, extra)
}

function saSnap(): any {
  return typeof SA.staleAgentsSnapshot === "function" ? SA.staleAgentsSnapshot() : {}
}

function saJournal(st: any): any[] {
  return shards393(st.m.writes, "/idle-watch/journal.jsonl.shard.").filter(r => r.kind === "STALE_AGENTS")
}

function saFleetRec(st: any): any {
  const t = st.files[st.fleetDir + "/" + st.sid + ".json"]
  return t === undefined ? undefined : JSON.parse(t)
}

test("stale-agents T1: running, активность 31 мин назад -- ровно один submit со всеми висящими, тост, строка флота", async () => {
  const T0 = 600_000_000
  const st = sa$("t1", T0)
  st.agents = [saRun("ag-sa1"), saRun("ag-sa1b", { type: "Explore" })]
  await saStart(st)
  await saTickAt(st, T0)
  expect(st.submits.length, "первый тик заводит записи и молчит").toBe(0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length, "ровно один submit на тик").toBe(1)
  const text = String(st.submits[0].text)
  expect(text).toContain(saHead(30))
  expect(text).toContain("- ag-sa1 «desc ag-sa1» (general-purpose): без активности 31 мин, живёт 31 мин")
  expect(text).toContain("- ag-sa1b «desc ag-sa1b» (Explore): без активности 31 мин, живёт 31 мин")
  expect(text).toContain("TaskStop ag-sa1")
  expect(text).toContain("TaskStop ag-sa1b")
  expect(text).toContain("Если отчёта нет — проверь его вывод и сними его фоновые процессы и циклы ожидания. Не держи законченных агентов открытыми.")
  expect(text).toContain("Флот сейчас: агентов 2, сессий 1 (в этой 2); без счёта 0, нечитаемых 0.")
  expect(st.m.toasts.filter((x: string) => x.indexOf("idle-watch: незакрытых агентов 2: ag-sa1, ag-sa1b") === 0).length, "тост короткой строкой").toBe(1)
})

test("stale-agents T2: 29 мин без активности -- submit нет", async () => {
  const T0 = 610_000_000
  const st = sa$("t2", T0)
  st.agents = [saRun("ag-sa2")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 29 * SA_MIN)
  expect(st.submits.length, "29 мин -- submit нет").toBe(0)
  expect(saSnap()["ag-sa2"] && saSnap()["ag-sa2"].lastAt, "запись заведена первым тиком").toBe(T0)
})

test("stale-agents T3: completed / failed / killed -- в тексте нет, записи удалены", async () => {
  const T0 = 620_000_000
  const st = sa$("t3", T0)
  st.agents = [saRun("ag-sa3-live"), saRun("ag-sa3-c"), saRun("ag-sa3-f"), saRun("ag-sa3-k")]
  await saStart(st)
  await saTickAt(st, T0)
  expect(Object.keys(saSnap()).filter(k => k.indexOf("ag-sa3-") === 0).sort()).toEqual(["ag-sa3-c", "ag-sa3-f", "ag-sa3-k", "ag-sa3-live"])
  st.agents = [saRun("ag-sa3-live"), saRun("ag-sa3-c", { status: "completed" }), saRun("ag-sa3-f", { status: "failed" }), saRun("ag-sa3-k", { status: "killed" })]
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length).toBe(1)
  const text = String(st.submits[0].text)
  expect(text).toContain("ag-sa3-live")
  expect(text).not.toContain("ag-sa3-c")
  expect(text).not.toContain("ag-sa3-f")
  expect(text).not.toContain("ag-sa3-k")
  expect(Object.keys(saSnap()).filter(k => k.indexOf("ag-sa3-") === 0)).toEqual(["ag-sa3-live"])
})

test("stale-agents T4: второй тик внутри cooldown молчит, после cooldown -- снова", async () => {
  const T0 = 630_000_000
  const st = sa$("t4", T0)
  st.agents = [saRun("ag-sa4")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length).toBe(1)
  await saTickAt(st, T0 + 32 * SA_MIN)
  await saTickAt(st, T0 + 60 * SA_MIN)
  expect(st.submits.length, "внутри cooldown 30 мин повтора нет").toBe(1)
  await saTickAt(st, T0 + 61 * SA_MIN)
  expect(st.submits.length, "после cooldown -- повтор").toBe(2)
  expect(String(st.submits[1].text)).toContain("без активности 61 мин")
})

test("stale-agents T5: agent.list бросает / не массив -- submit нет, место потери названо", async () => {
  const T0 = 640_000_000
  let mode = "ok"
  // CONSTRAINT (#531): оценка idle-watch на тике пишет свою строку журнала и
  // уносит в неё счёт потерь; зуб меряет место потери тика висящих агентов,
  // поэтому оценка отодвинута за окно зуба.
  const st = sa$("t5", T0, { cfg: "live_recheck_ms = 3600000\n", list: () => {
    if (mode === "throw") throw new Error("agent.list: scripted refusal t5")
    if (mode === "shape") return { not: "array" }
    return [saRun("ag-sa5")]
  } })
  await saStart(st)
  await saTickAt(st, T0)
  const l0 = lostN393("stale-agents-list")
  const s0 = lostN393("stale-agents-list-shape")
  mode = "throw"
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(lostN393("stale-agents-list") - l0, "бросок назван stale-agents-list").toBe(1)
  mode = "shape"
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(lostN393("stale-agents-list-shape") - s0, "не-массив назван stale-agents-list-shape").toBe(1)
  expect(st.submits.length).toBe(0)
})

test("stale-agents T6: idle-watch off -- submit нет, agent.list не вызван", async () => {
  const T0 = 650_000_000
  const st = sa$("t6", T0, { idle: "0" })
  st.agents = [saRun("ag-sa6")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.listCalls).toBe(0)
  expect(st.submits.length).toBe(0)
})

test("stale-agents T6b: тик при idle-watch не armed очищает учёт активности и отметки сигнала", async () => {
  const T0 = 655_000_000
  const st = sa$("t6b", T0, { cfg: "cooldown_min = 60\n" })
  st.agents = [saRun("ag-sa6b")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length).toBe(1)
  st.env.CLAUDE_IDLE = "0"
  await hook393(subs393(), "tool.call")(st.m.$, { agentId: "ag-sa6b-x", tool: "Read", tool_use_id: "tu-sa6b" }, async () => ({ result: "r" }))
  const l0 = st.listCalls
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(Object.keys(saSnap()), "учёт активности очищен").toEqual([])
  expect(st.listCalls - l0, "и больше ничего: agent.list не вызван").toBe(0)
  st.env.CLAUDE_IDLE = "1"
  await saTickAt(st, T0 + 33 * SA_MIN)
  expect(saSnap()["ag-sa6b"].nudgedAt, "отметка агента очищена").toBeNull()
  await saTickAt(st, T0 + 63 * SA_MIN)
  expect(st.submits.length, "отметка сигнала очищена: cooldown 60 от +31 не держит").toBe(2)
})

test("stale-agents T7: вызов инструмента агента -- в хуке только touched без часов, время ставит тик; хвост «ждёт инструмент ≥ K мин»", async () => {
  const T0 = 660_000_000
  const st = sa$("t7", T0)
  st.agents = [saRun("ag-sa7")]
  await saStart(st)
  await saTickAt(st, T0)
  const rel: any = {}
  const nextOf = (k: string) => (e: any) => new Promise((r) => { rel[k] = () => r({ result: "done-" + k }) })
  st.m.setNow(T0 + 5 * SA_MIN)
  const c0 = st.clockReads
  const callA = hook393(subs393(), "tool.call")(st.m.$, { agentId: "ag-sa7", tool: "Bash", tool_use_id: "tu-sa7a", command: "sleep 9999" }, nextOf("a"))
  await settle393()
  expect(st.clockReads - c0, "учёт вызова агента часов хоста не читает").toBe(0)
  expect(saSnap()["ag-sa7"].touched, "вход вызова ставит touched").toBe(true)
  expect(saSnap()["ag-sa7"].lastAt, "время ставит не хук").toBe(T0)
  await saTickAt(st, T0 + 6 * SA_MIN)
  expect(saSnap()["ag-sa7"].lastAt, "тик переносит touched в lastAt").toBe(T0 + 6 * SA_MIN)
  expect(saSnap()["ag-sa7"].touched, "и снимает touched").toBe(false)
  st.m.setNow(T0 + 10 * SA_MIN)
  const callB = hook393(subs393(), "tool.call")(st.m.$, { agentId: "ag-sa7", tool: "Read", tool_use_id: "tu-sa7b", file_path: "/x" }, nextOf("b"))
  await settle393()
  expect(typeof rel.a === "function" && typeof rel.b === "function", "next вызван у обоих").toBe(true)
  await saTickAt(st, T0 + 11 * SA_MIN)
  await saTickAt(st, T0 + 41 * SA_MIN + 30_000)
  expect(st.submits.length).toBe(1)
  expect(String(st.submits[0].text)).toContain("- ag-sa7 «desc ag-sa7» (general-purpose): без активности 30 мин, живёт 41 мин; ждёт инструмент Bash ≥ 35 мин")
  const rec = saJournal(st)
  expect(rec.length).toBe(1)
  expect(rec[0].agents).toEqual([{ id: "ag-sa7", type: "general-purpose", idleMin: 30, ageMin: 41, inFlightTool: "Bash" }])
  expect(saSnap()["ag-sa7"].inFlight, "вызовы в полёте").toBe(2)
  st.m.setNow(T0 + 46 * SA_MIN)
  const c1 = st.clockReads
  rel.a()
  expect(await callA).toEqual({ result: "done-a" })
  expect(st.clockReads - c1, "завершение вызова часов хоста не читает").toBe(0)
  expect(saSnap()["ag-sa7"].touched, "завершение вызова ставит touched").toBe(true)
  expect(saSnap()["ag-sa7"].lastAt, "до тика lastAt прежний").toBe(T0 + 11 * SA_MIN)
  expect(saSnap()["ag-sa7"].inFlight, "завершённый вызов снят с полёта").toBe(1)
  await saTickAt(st, T0 + 47 * SA_MIN)
  expect(saSnap()["ag-sa7"].lastAt, "завершение учтено тиком").toBe(T0 + 47 * SA_MIN)
  rel.b()
  expect(await callB).toEqual({ result: "done-b" })
  expect(saSnap()["ag-sa7"].inFlight).toBe(0)
})

test("stale-agents T8: агент впервые увиден тиком -- в этом тике не назван; назван через thr от firstSeen", async () => {
  const T0 = 670_000_000
  const st = sa$("t8", T0)
  st.agents = [saRun("ag-sa8")]
  await saStart(st)
  await saTickAt(st, T0)
  expect(st.submits.length).toBe(0)
  expect(saSnap()["ag-sa8"].firstSeen).toBe(T0)
  await saTickAt(st, T0 + 30 * SA_MIN - 1)
  expect(st.submits.length).toBe(0)
  await saTickAt(st, T0 + 30 * SA_MIN)
  expect(st.submits.length, "ровно thr от firstSeen -- назван").toBe(1)
  expect(String(st.submits[0].text)).toContain("ag-sa8")
})

test("stale-agents T9: submit бросает -- noteLost, отдельная запись STALE_AGENTS_SUBMIT_ERR, внутри cooldown повтора нет", async () => {
  const T0 = 680_000_000
  const st = sa$("t9", T0, { submitThrows: true })
  st.agents = [saRun("ag-sa9")]
  await saStart(st)
  await saTickAt(st, T0)
  const l0 = lostN393("stale-agents-submit")
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length).toBe(1)
  const recs = saJournal(st)
  expect(recs.length).toBe(1)
  expect(recs[0].submitErr, "запись тика не ждёт submit").toBeUndefined()
  expect(recs[0].agents).toEqual([{ id: "ag-sa9", type: "general-purpose", idleMin: 31, ageMin: 31 }])
  const errs = shards393(st.m.writes, "/idle-watch/journal.jsonl.shard.").filter(r => r.kind === "STALE_AGENTS_SUBMIT_ERR")
  expect(errs.length).toBe(1)
  expect(String(errs[0].err)).toContain("prompt.submit: scripted refusal")
  expect(typeof errs[0].t).toBe("string")
  const shardPaths = st.m.writes.map((w: any) => String(w.path)).filter((p: string) => p.indexOf("/idle-watch/journal.jsonl.shard.") >= 0)
  expect(new Set(shardPaths).size, "записи тика и отказа submit -- разные шарды").toBe(shardPaths.length)
  // CONSTRAINT: запись журнала уносит lostWrites полем lost; какая из двух записей унесёт потерю submit, решает порядок микрозадач.
  let lostN = lostN393("stale-agents-submit") - l0
  for (const r of recs.concat(errs)) if (r.lost && r.lost["stale-agents-submit"]) lostN += r.lost["stale-agents-submit"].n
  expect(lostN, "потеря submit названа ровно один раз").toBe(1)
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(st.submits.length, "бросок submit не даёт шторма повторов").toBe(1)
})

test("stale-agents T9b: submit, который не резолвится, не блокирует тик и следующий тик", async () => {
  const T0 = 685_000_000
  const st = sa$("t9b", T0, { submitHang: true, cfg: "cooldown_min = 1\n" })
  st.agents = [saRun("ag-sa9b")]
  await saStart(st)
  await saTickAt(st, T0)
  const run = async (t: number): Promise<boolean> => {
    st.m.setNow(t)
    let done = false
    st.tick().then(() => { done = true })
    for (let i = 0; i < 20000 && !done; i++) await Promise.resolve()
    return done
  }
  expect(await run(T0 + 31 * SA_MIN), "тик с висящим submit завершился").toBe(true)
  expect(st.submits.length).toBe(1)
  expect(saJournal(st).length, "запись тика написана, не дожидаясь submit").toBe(1)
  expect(await run(T0 + 32 * SA_MIN), "следующий тик завершился").toBe(true)
  expect(st.submits.length, "сигнал в полёте -- следующий тик после cooldown второго не шлёт (#531 FIX1b)").toBe(1)
})

test("stale-agents T10: turn.step агента на 20-й минуте -- touched без часов; тик на 21-й ставит время; на 50-й не назван, на 51-й назван", async () => {
  const T0 = 690_000_000
  const st = sa$("t10", T0)
  st.agents = [saRun("ag-sa10")]
  await saStart(st)
  await saTickAt(st, T0)
  st.m.setNow(T0 + 20 * SA_MIN)
  const okNext: any = () => (async function* () { return { usage: { out: 1 }, stopReason: "end_turn", text: "ok" } })()
  const c0 = st.clockReads
  await drainStream(hook393(subs393(), "turn.step")(st.m.$, { agentId: "ag-sa10", turnId: "t-sa10", index: 0, model: "m-sa10", messageCount: 1 }, okNext))
  expect(st.clockReads - c0, "учёт шага агента часов хоста не читает").toBe(0)
  expect(saSnap()["ag-sa10"].touched, "шаг ставит touched").toBe(true)
  await saTickAt(st, T0 + 21 * SA_MIN)
  expect(saSnap()["ag-sa10"].lastAt).toBe(T0 + 21 * SA_MIN)
  await saTickAt(st, T0 + 50 * SA_MIN)
  expect(st.submits.length).toBe(0)
  await saTickAt(st, T0 + 51 * SA_MIN)
  expect(st.submits.length, "30 мин от тика, увидевшего шаг, -- назван").toBe(1)
})

test("stale-agents T11: агент пропал из list -- запись удалена", async () => {
  const T0 = 700_000_000
  const st = sa$("t11", T0)
  st.agents = [saRun("ag-sa11")]
  await saStart(st)
  await saTickAt(st, T0)
  expect(saSnap()["ag-sa11"] !== undefined).toBe(true)
  st.agents = []
  await saTickAt(st, T0 + SA_MIN)
  expect(saSnap()["ag-sa11"]).toBeUndefined()
})

test("stale-agents T12: stale_agent_min = 5 из cfg соблюдается", async () => {
  const T0 = 710_000_000
  const st = sa$("t12", T0, { cfg: "stale_agent_min = 5\ncooldown_min = 2\n" })
  st.agents = [saRun("ag-sa12")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 4 * SA_MIN)
  expect(st.submits.length).toBe(0)
  await saTickAt(st, T0 + 5 * SA_MIN)
  expect(st.submits.length).toBe(1)
  expect(String(st.submits[0].text)).toContain(saHead(5))
  await saTickAt(st, T0 + 6 * SA_MIN)
  expect(st.submits.length, "cooldown_min = 2 из cfg держит").toBe(1)
  await saTickAt(st, T0 + 7 * SA_MIN)
  expect(st.submits.length, "cooldown_min = 2 из cfg истёк").toBe(2)
})

test("stale-agents T13: события главного лупа (agentId пуст) записей не создают", async () => {
  const T0 = 720_000_000
  const st = sa$("t13", T0, { idle: "0" })
  await saStart(st)
  const before = Object.keys(saSnap()).sort()
  await hook393(subs393(), "tool.call")(st.m.$, { tool: "Read", tool_use_id: "tu-sa13", file_path: "/x" }, async (e: any) => ({ result: "r" }))
  await hook393(subs393(), "tool.call")(st.m.$, { agentId: "", tool: "Read", tool_use_id: "tu-sa13b", file_path: "/x" }, async (e: any) => ({ result: "r" }))
  const okNext: any = () => (async function* () { return { usage: { out: 1 }, stopReason: "end_turn", text: "ok" } })()
  await drainStream(hook393(subs393(), "turn.step")(st.m.$, { turnId: "t-sa13", index: 0, model: "m-sa13", messageCount: 1 }, okNext))
  await drainStream(hook393(subs393(), "turn.step")(st.m.$, { agentId: "", turnId: "t-sa13b", index: 0, model: "m-sa13", messageCount: 1 }, okNext))
  await settle393()
  expect(Object.keys(saSnap()).sort()).toEqual(before)
  await hook393(subs393(), "tool.call")(st.m.$, { agentId: "ag-sa13", tool: "Read", tool_use_id: "tu-sa13c", file_path: "/x" }, async (e: any) => ({ result: "r" }))
  expect(Object.keys(saSnap()).filter(k => before.indexOf(k) < 0), "контроль: событие агента запись заводит").toEqual(["ag-sa13"])
})

test("stale-agents T14: два session.start -- живой таймер один, прежний отменён и инертен", async () => {
  const T0 = 730_000_000
  const st = sa$("t14", T0)
  st.agents = [saRun("ag-sa14")]
  await saStart(st)
  const firstTick = st.tick
  const c0 = st.cancels
  const idx = st.m.everyCbs.length
  await hook393(subs393(), "session.start")(st.m.$, saStartEv(st), async () => ({}))
  expect(st.m.everyCbs.length, "второй старт взвёл новый таймер").toBe(idx + 1)
  expect(st.cancels - c0, "прежняя ручка отменена").toBe(1)
  st.m.setNow(T0)
  await firstTick()
  await settle393()
  expect(st.listCalls, "колбэк прежнего поколения инертен").toBe(0)
  st.tick = st.m.everyCbs[idx]
  await saTickAt(st, T0 + SA_MIN)
  expect(st.listCalls, "живой таймер работает").toBe(1)
})

test("stale-agents T14b: отказ вооружения и ручка без cancel -- таймера нет, пустышки нет; ленивое вооружение не чаще раза в период после отказа; исправный таймер не перевзводится", async () => {
  const T0 = 735_000_000
  const st = sa$("t14b", T0, { idle: "0" })
  await clear393()
  st.m.$.clock.every = () => { throw new Error("clock.every: scripted refusal t14b") }
  const a0 = lostN393("stale-agents-timer-arm")
  await hook393(subs393(), "session.start")(st.m.$, saStartEv(st), async () => ({}))
  expect(lostN393("stale-agents-timer-arm") - a0, "отказ вооружения назван").toBe(1)
  let armed = 0
  st.m.$.clock.every = (ms: number, cb: any) => { if (ms === SA.STALE_AGENTS_PERIOD_MS) armed++; return {} }
  const h0 = lostN393("stale-agents-timer-handle")
  let seq = 0
  const call = async (t: number) => {
    st.m.setNow(t)
    await hook393(subs393(), "tool.call")(st.m.$, { tool: "Read", tool_use_id: "tu-sa14b-" + String(++seq), file_path: "/x" }, async (e: any) => ({ result: "r" }))
  }
  await call(T0 + 30_000)
  expect(armed, "внутри периода после отказа -- не вооружает").toBe(0)
  await call(T0 + 60_000)
  expect(armed, "через период после отказа -- вооружает").toBe(1)
  expect(lostN393("stale-agents-timer-handle") - h0, "ручка без cancel названа").toBe(1)
  await call(T0 + 61_000)
  expect(armed, "ручка без cancel -- отказ: повтор не раньше периода").toBe(1)
  await call(T0 + 120_000)
  expect(armed, "ручка без cancel не держится пустышкой: через период -- снова").toBe(2)
  st.m.$.clock.every = (ms: number, cb: any) => { if (ms === SA.STALE_AGENTS_PERIOD_MS) armed++; return { cancel() {} } }
  await call(T0 + 180_000)
  expect(armed, "исправная ручка").toBe(3)
  await call(T0 + 181_000)
  expect(armed, "вооружённый таймер не перевзводится").toBe(3)
  expect(SA.STALE_AGENTS_PERIOD_MS).toBe(60000)
})

test("stale-agents T14c: перевооружение таймера (новое поколение) во время agent.list или сбора флота снимает сигнал тика", async () => {
  const T0 = 737_000_000
  let onFs: any = null
  let onAg: any = null
  const fire = async (k: string) => {
    const f = k === "fs" ? onFs : onAg
    if (k === "fs") onFs = null
    else onAg = null
    if (f) await f()
  }
  const st = sa$("t14c", T0, { onFsList: () => fire("fs"), onList: () => fire("ag") })
  st.agents = [saRun("ag-sa14c")]
  await saStart(st)
  await saTickAt(st, T0)
  const t0rec = saFleetRec(st)
  const restart = async () => {
    const idx = st.m.everyCbs.length
    await hook393(subs393(), "session.start")(st.m.$, saStartEv(st), async () => ({}))
    st.nextTick = st.m.everyCbs[idx]
  }
  onAg = restart
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(onAg, "перевооружение прошло через дверь agent.list").toBeNull()
  expect(st.submits.length, "тик, сменивший поколение на agent.list, не сигналит").toBe(0)
  expect(saFleetRec(st), "и не публикует флот").toEqual(t0rec)
  st.tick = st.nextTick
  onFs = restart
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(onFs, "перевооружение прошло через дверь fs.list").toBeNull()
  expect(st.submits.length, "тик, сменивший поколение на сборе флота, не сигналит").toBe(0)
})

test("stale-agents T15: отказ учёта не ломает tool.call и turn.step", async () => {
  const T0 = 740_000_000
  const st = sa$("t15", T0, { idle: "0" })
  await saStart(st)
  const l0 = lostN393("stale-agents-track")
  let nextArg: any = null
  const poison = { toString() { throw new Error("poison agentId t15") } }
  const out = await hook393(subs393(), "tool.call")(st.m.$, { agentId: poison, tool: "Read", tool_use_id: "tu-sa15" }, async (e: any) => { nextArg = e; return { result: "r15" } })
  expect(out).toEqual({ result: "r15" })
  expect(nextArg !== null, "next(e) вызван").toBe(true)
  expect(lostN393("stale-agents-track") - l0, "отказ учёта tool.call назван").toBe(1)
  let n = 0
  const once = { toString() { if (n++ === 0) throw new Error("poison once t15"); return "ag-sa15" } }
  const okNext: any = () => (async function* () { return { usage: { out: 1 }, stopReason: "end_turn", text: "ok15" } })()
  const res = await drainStream(hook393(subs393(), "turn.step")(st.m.$, { agentId: once, turnId: "t-sa15", index: 0, model: "m-sa15", messageCount: 1 }, okNext))
  expect(res.value && res.value.text).toBe("ok15")
  expect(lostN393("stale-agents-track") - l0, "отказ учёта turn.step назван").toBe(2)
})

test("stale-agents T16: тик пишет запись флота со своими running и без description", async () => {
  const T0 = 750_000_000
  const st = sa$("t16", T0)
  st.agents = [saRun("ag-sa16a"), saRun("ag-sa16b", { type: "Explore" }), saRun("ag-sa16c", { status: "completed" })]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 3 * SA_MIN)
  const rec = saFleetRec(st)
  expect(rec).toEqual({
    v: 1, sid: st.sid, cwd: st.cwd, t: T0 + 3 * SA_MIN, running: 2,
    agents: [{ id: "ag-sa16a", type: "general-purpose", idleMin: 3 }, { id: "ag-sa16b", type: "Explore", idleMin: 3 }],
  })
  expect(st.files[st.fleetDir + "/" + st.sid + ".json"]).not.toContain("desc ")
})

test("stale-agents T16b: отказ записи флота назван fleet-publish, тик продолжается до сигнала", async () => {
  const T0 = 755_000_000
  // CONSTRAINT: live_kinds без remote_agent -- строка live_kinds_unobservable
  // (одна на сессию) иначе уносила бы потерю полем lost раньше записи тика.
  const st = sa$("t16b", T0, { fsWriteFail: (p) => p.indexOf("/idle-watch/fleet/") >= 0, cfg: SA_KINDS_OBSERVABLE })
  st.agents = [saRun("ag-sa16x")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(saFleetRec(st), "записи флота нет").toBeUndefined()
  expect(st.submits.length, "тик дошёл до сигнала").toBe(1)
  const recs = saJournal(st)
  expect(recs.length).toBe(1)
  expect(recs[0].lost && recs[0].lost["fleet-publish"] && recs[0].lost["fleet-publish"].n >= 2, "отказ записи флота назван").toBe(true)
})

test("stale-agents T17: отказ agent.list -- запись running: null; сбор считает её в unknown, не в agents", async () => {
  const T0 = 760_000_000
  const st = sa$("t17", T0, { list: () => { throw new Error("agent.list: scripted refusal t17") } })
  await saStart(st)
  await saTickAt(st, T0)
  const rec = saFleetRec(st)
  expect(rec && rec.running).toBeNull()
  expect(rec && rec.t).toBe(T0)
  const c = await SA.fleetCensus(st.m.$, { globalHome: st.home })
  expect(c.unknown).toBe(1)
  expect(c.agents).toBe(0)
  expect(c.sessions).toBe(1)
  expect(c.mine).toBeNull()
})

function saFleetFiles(dir: string, T: number): Record<string, string> {
  return {
    [dir + "/aaaa1111.json"]: JSON.stringify({ v: 1, sid: "aaaa1111-x", cwd: "/w/a", t: T - 10_000, running: 2, agents: [{ id: "a1", type: "t", idleMin: 4 }, { id: "a2", type: "t", idleMin: 9 }] }),
    [dir + "/bbbb2222.json"]: JSON.stringify({ v: 1, sid: "bbbb2222-y", cwd: "/w/b", t: T - 20_000, running: 3, agents: [] }),
    [dir + "/cccc3333.json"]: JSON.stringify({ v: 1, sid: "cccc3333-z", cwd: "/w/c", t: T - 200_000, running: 7, agents: [] }),
    [dir + "/dddd4444.json"]: JSON.stringify({ v: 1, sid: "dddd4444-q", cwd: "/w/d", t: T - 5_000, running: 0, agents: [], ended: true }),
  }
}

test("stale-agents T18: две свежие (2 и 3) + старая + ended -- agents 5, sessions 2", async () => {
  const T0 = 770_000_000
  const dir = "/probes-sa-t18/idle-watch/fleet"
  const st = sa$("t18", T0, { files: saFleetFiles(dir, T0) })
  await clear393()
  const c = await SA.fleetCensus(st.m.$, { globalHome: st.home })
  expect(c.agents).toBe(5)
  expect(c.sessions).toBe(2)
  expect(c.unknown).toBe(0)
  expect(c.unreadable).toBe(0)
})

test("stale-agents T19: нечитаемые файлы (не JSON; t не число) -- unreadable 2, остальные посчитаны", async () => {
  const T0 = 780_000_000
  const dir = "/probes-sa-t19/idle-watch/fleet"
  const files = saFleetFiles(dir, T0)
  files[dir + "/eeee5555.json"] = "{not json"
  files[dir + "/ffff6666.json"] = JSON.stringify({ v: 1, t: "late", running: 4 })
  files[dir + "/zzzz9999.txt"] = JSON.stringify({ v: 1, sid: "zzzz9999", cwd: "/w/z", t: T0 - 1000, running: 9, agents: [] })
  const st = sa$("t19", T0, { files })
  await clear393()
  const c = await SA.fleetCensus(st.m.$, { globalHome: st.home })
  expect(c.unreadable).toBe(2)
  expect(c.agents).toBe(5)
  expect(c.sessions).toBe(2)
})

test("stale-agents T20: прополка -- старше 24 ч удаляется rm -f, свежая нет, имя с / или .. -- пропуск; внутри часа не зовётся", async () => {
  const T0 = 800_000_000
  const dir = "/probes-sa-t20/idle-watch/fleet"
  const old = JSON.stringify({ v: 1, sid: "old", cwd: "/w/o", t: T0 - 25 * 3600_000, running: 1, agents: [] })
  const files: Record<string, string> = {
    [dir + "/old1.json"]: old,
    [dir + "/fresh1.json"]: JSON.stringify({ v: 1, sid: "fresh", cwd: "/w/f", t: T0 - 1000, running: 1, agents: [] }),
    [dir + "/a/b.json"]: old,
    [dir + "/..old.json"]: old,
    ["/probes-sa-t20/idle-watch/x.json"]: old,
  }
  const st = sa$("t20", T0, { files, proc: true, extraNames: ["a/b.json", "../x.json"] })
  await clear393()
  const c = await SA.fleetCensus(st.m.$, { globalHome: st.home })
  expect(st.procArgv).toEqual([["/bin/rm", "-f", dir + "/old1.json"]])
  expect(c.sessions).toBe(1)
  st.m.setNow(T0 + 3600_000 - 1)
  await SA.fleetCensus(st.m.$, { globalHome: st.home })
  expect(st.procArgv.length, "второй раз внутри часа -- не зовётся").toBe(1)
  st.m.setNow(T0 + 3600_000)
  await SA.fleetCensus(st.m.$, { globalHome: st.home })
  expect(st.procArgv.length, "через час -- снова").toBe(2)
})

test("stale-agents T21: fleet_status отвечает числами сбора; при отказе list -- текст отказа, не 0; /catalyst-fleet -- тот же текст", async () => {
  const T0 = 810_000_000
  const dir = "/probes-sa-t21/idle-watch/fleet"
  let listFails = false
  const files = saFleetFiles(dir, T0)
  files[dir + "/sid-sa-t21.json"] = JSON.stringify({ v: 1, sid: "sid-sa-t21", cwd: "/work-sa-t21", t: T0 - 1000, running: 1, agents: [{ id: "m1", type: "t", idleMin: 12 }] })
  files[dir + "/gggg7777.json"] = JSON.stringify({ v: 1, sid: "gggg7777-u", cwd: "/w/g", t: T0 - 1000, running: null, agents: [] })
  const st = sa$("t21", T0, {
    files, fsListThrows: () => listFails,
    cfg: "[probe.judge]\nmodels = [\"m1\"]\n",
    env: { CLAUDE_JUDGE: "1", CLAUDE_JUDGE_CARRIER: "patch-t21" },
  })
  await saStart(st)
  expect(st.tools).toEqual([{ name: "fleet_status", description: "Сколько субагентов сейчас запущено во всех сессиях Claude Code на этой машине и в этой сессии", inputSchema: { type: "object", properties: {} } }])
  expect(st.commands.filter((c: any) => c.name === "catalyst-fleet").length).toBe(1)
  const subs = subs393()
  expect(subs.filter(s => s.ev === "tool.call").length, "у плагина ровно одна подписка tool.call").toBe(1)
  const cmd = subs.filter(s => s.ev === "command.run" && s.matcher && Array.isArray(s.matcher.command) && s.matcher.command.indexOf("catalyst-fleet") >= 0)
  expect(cmd.length).toBe(1)
  const call = hook393(subs, "tool.call")
  let nextN = 0
  const nextNo = async () => { nextN++; return { result: "НЕ ДОЛЖЕН" } }
  const l0 = st.listCalls
  const out = await call(st.m.$, { tool: SA_TOOL, tool_use_id: "tu-sa21" }, nextNo)
  const text = String(out && out.result)
  const aout = await call(st.m.$, { agentId: "ag-sa21", tool: SA_TOOL, tool_use_id: "tu-sa21a" }, nextNo)
  expect(String(aout && aout.result), "вызов из агента обслужен той же веткой").toBe(text)
  expect(nextN, "next не зовётся").toBe(0)
  expect(st.listCalls - l0, "ветка флота первой: путь проб не пройден").toBe(0)
  const judged = await call(st.m.$, { tool: "Agent", prompt: "[dispatch-class:exec-0p] t21", subagent_type: "x", tool_use_id: "tu-sa21j" }, async (e: any) => ({ result: "ran" }))
  expect(String(judged && judged.deny), "Agent-вызов проходит путь судьи в том же дереве").toContain("patch-t21")
  expect(text.split("\n")[0]).toBe("Флот: агентов 6, сессий 4 (в этой 1); без счёта 1, нечитаемых 0")
  expect(text).toContain("sid-sa-t | /work-sa-t21 | 1 | 12")
  expect(text).toContain("aaaa1111 | /w/a | 2 | 9")
  expect(text).toContain("gggg7777 | /w/g | ? | 0")
  const cout = await cmd[0].fn(st.m.$, { command: "catalyst-fleet", args: "" }, async () => ({ text: "НЕ ДОЛЖЕН" }))
  expect(cout).toEqual({ text })
  listFails = true
  const bad = await call(st.m.$, { tool: SA_TOOL, tool_use_id: "tu-sa21b" }, nextNo)
  const btext = String(bad && bad.result)
  expect(btext).toContain("Флот: счёт недоступен (")
  expect(btext).toContain("fs.list: scripted refusal")
  expect(btext).not.toContain("Флот: 0")
})

test("stale-agents T21b: сбор флота отказал -- сообщение о висящих несёт строку отказа, не ноль", async () => {
  const T0 = 815_000_000
  const st = sa$("t21b", T0, { fsListThrows: () => true })
  st.agents = [saRun("ag-sa21b")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length).toBe(1)
  const text = String(st.submits[0].text)
  expect(text.split("\n").pop(), "причина отказа сбора без двойного префикса").toBe("Флот: счёт недоступен (fs.list: scripted refusal).")
  expect(text).not.toContain("Флот сейчас: 0")
})

test("stale-agents T22: session.end пишет ended: true", async () => {
  const T0 = 820_000_000
  const st = sa$("t22", T0)
  await saStart(st)
  const r = await hook393(subs393(), "session.end")(st.m.$, { reason: "other", sessionId: "sid-sa-t22-end", resume: {} }, async (e: any) => ({ sessionId: "sid-sa-t22-end" }))
  expect(r).toEqual({ sessionId: "sid-sa-t22-end" })
  const t = st.files[st.fleetDir + "/sid-sa-t22-end.json"]
  expect(t !== undefined, "запись конца сессии под её id").toBe(true)
  const rec = JSON.parse(String(t))
  expect(rec.ended).toBe(true)
  expect(rec.running).toBe(0)
  expect(rec.t).toBe(T0)
  expect(rec.sid).toBe("sid-sa-t22-end")
})

test("stale-agents T23: idle-watch off -- не публикует и не собирает", async () => {
  const T0 = 830_000_000
  const st = sa$("t23", T0, { idle: "0" })
  st.agents = [saRun("ag-sa23")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  await hook393(subs393(), "session.end")(st.m.$, { reason: "other", sessionId: st.sid, resume: {} }, async (e: any) => ({ sessionId: st.sid }))
  const out = await hook393(subs393(), "tool.call")(st.m.$, { tool: SA_TOOL, tool_use_id: "tu-sa23" }, async () => ({ result: "НЕ ДОЛЖЕН" }))
  expect(String(out && out.result)).toContain("Флот: счёт недоступен (idle-watch не вооружён: off)")
  expect(Object.keys(st.files).filter(p => p.indexOf(st.fleetDir + "/") === 0)).toEqual([])
  expect(st.fsListCalls).toBe(0)
})

function saGate(): { set: (f: any) => void; fire: () => Promise<void>; pending: () => boolean } {
  let f: any = null
  return {
    set: (g: any) => { f = g },
    fire: async () => { const g = f; f = null; if (g) await g() },
    pending: () => f !== null,
  }
}

test("stale-agents T24: /clear во время agent.list или сбора флота -- ни записи флота, ни сигнала прежней сессии; newSession чистит учёт, отметки и окно", async () => {
  const T0 = 840_000_000
  const ag = saGate()
  const fs = saGate()
  const st = sa$("t24", T0, { cfg: "cooldown_min = 60\n", onList: () => ag.fire(), onFsList: () => fs.fire() })
  st.agents = [saRun("ag-sa24")]
  await saStart(st)
  await saTickAt(st, T0)
  const t0rec = saFleetRec(st)
  ag.set(() => clear393())
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(ag.pending(), "/clear прошёл через дверь agent.list").toBe(false)
  expect(st.submits.length, "/clear на agent.list -- сигнала нет").toBe(0)
  expect(saFleetRec(st), "/clear на agent.list -- записи флота прежней сессии нет").toEqual(t0rec)
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(saSnap()["ag-sa24"].firstSeen, "учёт после /clear -- заново").toBe(T0 + 32 * SA_MIN)
  fs.set(() => clear393())
  await saTickAt(st, T0 + 62 * SA_MIN)
  expect(fs.pending(), "/clear прошёл через дверь fs.list").toBe(false)
  expect(st.submits.length, "/clear на сборе флота -- сигнала нет").toBe(0)
  await saTickAt(st, T0 + 63 * SA_MIN)
  await saTickAt(st, T0 + 93 * SA_MIN)
  expect(st.submits.length).toBe(1)
  expect(saSnap()["ag-sa24"].nudgedAt).toBe(T0 + 93 * SA_MIN)
  await clear393()
  expect(Object.keys(saSnap()).filter(k => k === "ag-sa24"), "/clear очистил учёт активности").toEqual([])
  await saTickAt(st, T0 + 94 * SA_MIN)
  expect(saSnap()["ag-sa24"].nudgedAt, "/clear очистил отметку агента").toBeNull()
  await saTickAt(st, T0 + 124 * SA_MIN)
  expect(st.submits.length, "/clear очистил окно сигнала: cooldown 60 от +93 не держит").toBe(2)
  const j = saJournal(st)
  expect(j[j.length - 1].agents[0].prevNudgedAt, "отметка прежней сессии не едет в журнал").toBeUndefined()
})

test("stale-agents T25: сигнал только при isInteractive === true; false -- журнал delivered not-interactive; session.start не наблюдался -- interactive-unknown; флот в любом режиме", async () => {
  const modes: Array<[string, any]> = [["true", { isInteractive: true }], ["false", { isInteractive: false, surface: null }], ["unknown", { isInteractive: true }]]
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i][0]
    const T0 = 850_000_000 + i * 50 * SA_MIN
    const st = sa$("t25" + mode, T0)
    st.agents = [saRun("ag-sa25" + mode)]
    await saStart(st, modes[i][1])
    if (mode === "unknown") SA.staleInteractiveReset()
    await saTickAt(st, T0)
    await saTickAt(st, T0 + 31 * SA_MIN)
    const rec = saFleetRec(st)
    expect(rec && rec.t, mode + ": запись флота в любом режиме").toBe(T0 + 31 * SA_MIN)
    const j = saJournal(st)
    expect(j.length, mode + ": запись журнала").toBe(1)
    expect(j[0].agents.map((a: any) => a.id), mode).toEqual(["ag-sa25" + mode])
    const toasts = st.m.toasts.filter((x: string) => x.indexOf("idle-watch: незакрытых агентов") === 0).length
    if (mode === "true") {
      expect(st.submits.length, "interactive: submit").toBe(1)
      expect(toasts, "interactive: тост").toBe(1)
      expect(j[0].delivered, "interactive: поля delivered нет").toBeUndefined()
    } else {
      expect(st.submits.length, mode + ": submit нет").toBe(0)
      expect(toasts, mode + ": тоста нет").toBe(0)
      expect(j[0].delivered).toBe(mode === "false" ? "not-interactive" : "interactive-unknown")
    }
    const out = await hook393(subs393(), "tool.call")(st.m.$, { tool: SA_TOOL, tool_use_id: "tu-sa25" + mode }, async () => ({ result: "НЕ ДОЛЖЕН" }))
    expect(String(out && out.result).split("\n")[0], mode + ": fleet_status в любом режиме").toBe("Флот: агентов 1, сессий 1 (в этой 1); без счёта 0, нечитаемых 0")
  }
})

test("stale-agents T26: две сессии без sid -- ни одной записи флота, сентинел-файл не сессия, mine неизвестно", async () => {
  const T0 = 860_000_000
  const dir = "/probes-sa-t26/idle-watch/fleet"
  const files: Record<string, string> = {
    [dir + "/sid-unavailable.json"]: JSON.stringify({ v: 1, sid: "sid-unavailable", cwd: "/w/old", t: T0 - 1000, running: 3, agents: [] }),
    [dir + "/hhhh8888.json"]: JSON.stringify({ v: 1, sid: "hhhh8888-a", cwd: "/w/h", t: T0 - 1000, running: 2, agents: [] }),
  }
  // CONSTRAINT: live_kinds без remote_agent -- строка live_kinds_unobservable
  // иначе сливала бы снапшот потерь до замера.
  const st = sa$("t26", T0, { files, sidFails: true, cfg: SA_KINDS_OBSERVABLE })
  st.agents = [saRun("ag-sa26a"), saRun("ag-sa26b")]
  await saStart(st)
  const l0 = lostN393("fleet-sid-unavailable")
  await saTickAt(st, T0)
  expect(lostN393("fleet-sid-unavailable") - l0, "первая сессия: отказ sid назван").toBe(1)
  const st2 = sa$("t26", T0, { files: st.files, sidFails: true, cfg: SA_KINDS_OBSERVABLE })
  st2.agents = [saRun("ag-sa26c"), saRun("ag-sa26d"), saRun("ag-sa26e")]
  await saStart(st2)
  const l1 = lostN393("fleet-sid-unavailable")
  await saTickAt(st2, T0)
  expect(lostN393("fleet-sid-unavailable") - l1, "вторая сессия: отказ sid назван").toBe(1)
  const own = st.m.writes.concat(st2.m.writes).filter((w: any) => String(w.path).indexOf("/idle-watch/fleet/") >= 0)
  expect(own.map((w: any) => w.path), "ни одна сессия без sid не пишет запись флота").toEqual([])
  const c = await SA.fleetCensus(st2.m.$, { globalHome: st2.home })
  expect(c.sessions, "сентинел-файл не сессия").toBe(1)
  expect(c.agents).toBe(2)
  expect(c.unreadable, "сентинел-файл -- нечитаемый").toBe(1)
  expect(c.mine, "своя запись неизвестна").toBeNull()
})

test("stale-agents T27b: поток шага без кусков 31 мин -- агент назван; учёт шага часов хоста не читает", async () => {
  const T0 = 875_000_000
  const st = sa$("t27b", T0)
  st.agents = [saRun("ag-sa27b")]
  await saStart(st)
  await saTickAt(st, T0)
  st.m.setNow(T0 + 1 * SA_MIN)
  const src = { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) } } }
  const c0 = st.clockReads
  void drainStream(hook393(subs393(), "turn.step")(st.m.$, { agentId: "ag-sa27b", turnId: "t-27b", index: 0, model: "m-27b", messageCount: 1 }, () => src))
  await settle393()
  expect(st.clockReads - c0, "вход шага часов хоста не читает").toBe(0)
  await saTickAt(st, T0 + 2 * SA_MIN)
  expect(saSnap()["ag-sa27b"].lastAt, "вход шага -- активность, время тика").toBe(T0 + 2 * SA_MIN)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length, "29 мин без кусков -- рано").toBe(0)
  await saTickAt(st, T0 + 33 * SA_MIN)
  expect(st.submits.length, "31 мин без кусков -- назван").toBe(1)
  expect(String(st.submits[0].text)).toContain("- ag-sa27b «desc ag-sa27b» (general-purpose): без активности 31 мин")
})

function saChan(): { src: any; push: (c: any) => void; end: (v: any) => void } {
  const waiters: Array<(r: any) => void> = []
  const buf: any[] = []
  const put = (r: any) => { const w = waiters.shift(); if (w) w(r); else buf.push(r) }
  const it = { next: () => (buf.length ? Promise.resolve(buf.shift()) : new Promise((res) => { waiters.push(res) })) }
  return { src: { [Symbol.asyncIterator]: () => it }, push: (c: any) => put({ done: false, value: c }), end: (v: any) => put({ done: true, value: v }) }
}

// CONSTRAINT: шаг открыт на 1-й минуте, кусок каждые 10 мин до 60-й, тик каждую минуту; поток кончается после тика 60-й минуты.
async function saChunkRun(st: any, T0: number, start: (next: any) => any, result: any): Promise<{ out: any; clockOnChunks: number; calls: number }> {
  const ch = saChan()
  let calls = 0
  st.m.setNow(T0 + SA_MIN)
  const drained = drainStream(start(() => { calls++; return ch.src }))
  await settle393()
  let clockOnChunks = 0
  for (let k = 2; k <= 60; k++) {
    if (k % 10 === 0) {
      st.m.setNow(T0 + k * SA_MIN)
      const c0 = st.clockReads
      ch.push({ kind: "text", text: "c" + k })
      await settle393()
      clockOnChunks += st.clockReads - c0
    }
    await saTickAt(st, T0 + k * SA_MIN)
  }
  ch.end(result)
  const out = await drained
  return { out, clockOnChunks, calls }
}

function saStepEv(aid: string, model: string, k: string = "0"): any {
  return { agentId: aid, turnId: "t-" + aid + "-" + k, index: 0, model, messageCount: 1 }
}

function saAttempts(st: any, aid: string): any[] {
  return shards393(st.m.writes, "/failover/journal.jsonl.shard.").filter((r: any) => r.agentId === aid && r.attempt !== undefined)
}

test("stale-agents T27a: поток шага с кусками каждые 10 мин 60 мин -- агент не назван; кусок часов не читает; значение шага доходит; конец потока -- не кусок", async () => {
  const T0 = 872_000_000
  const st = sa$("t27a", T0)
  st.agents = [saRun("ag-sa27a")]
  await saStart(st)
  await saTickAt(st, T0)
  const R = { usage: { out: 1 }, stopReason: "end_turn", text: "R27a" }
  const run = await saChunkRun(st, T0, (next) => hook393(subs393(), "turn.step")(st.m.$, saStepEv("ag-sa27a", "m-27a"), next), R)
  expect(st.submits.length, "куски каждые 10 мин -- агент жив").toBe(0)
  expect(run.clockOnChunks, "кусок часов хоста не читает").toBe(0)
  expect(run.out.chunks.length).toBe(6)
  expect(run.out.value, "значение шага доходит").toBe(R)
  await saTickAt(st, T0 + 89 * SA_MIN)
  expect(st.submits.length, "конец потока пометки не ставит").toBe(0)
  await saTickAt(st, T0 + 90 * SA_MIN)
  expect(st.submits.length).toBe(1)
  expect(String(st.submits[0].text)).toContain("- ag-sa27a «desc ag-sa27a» (general-purpose): без активности 30 мин")
})

test("stale-agents T27c: лестница -- куски попытки держат агента живым и считаются (emitted); попытка без кусков дольше порога -- агент назван", async () => {
  const T0 = 873_000_000
  const st = sa$("t27c", T0)
  st.agents = [saRun("ag-sa27c")]
  await saStart(st)
  failoverBindSet("ag-sa27c", { ladder: ["r-27c"], rungEffort: { "r-27c": "max" }, subagentType: "t", class: "", sticky: null })
  await saTickAt(st, T0)
  const R = { usage: { out: 1 }, stopReason: "end_turn", text: "R27c" }
  const run = await saChunkRun(st, T0, (next) => hook393(subs393(), "turn.step")(st.m.$, saStepEv("ag-sa27c", "m-27c"), next), R)
  expect(st.submits.length, "куски попытки -- агент жив").toBe(0)
  expect(run.out.value).toBe(R)
  const at = saAttempts(st, "ag-sa27c")
  expect(at.length, "шаг шёл попыткой лестницы").toBe(1)
  expect({ outcome: at[0].outcome, emitted: at[0].emitted, emittedContent: at[0].emittedContent }, "счёт кусков работает вместе с пометкой").toEqual({ outcome: "ok", emitted: 6, emittedContent: 6 })
  const src = { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) } } }
  st.m.setNow(T0 + 61 * SA_MIN)
  void drainStream(hook393(subs393(), "turn.step")(st.m.$, saStepEv("ag-sa27c", "m-27c", "1"), () => src))
  await settle393()
  await saTickAt(st, T0 + 61 * SA_MIN)
  await saTickAt(st, T0 + 90 * SA_MIN)
  expect(st.submits.length, "29 мин без кусков -- рано").toBe(0)
  await saTickAt(st, T0 + 91 * SA_MIN)
  expect(st.submits.length, "30 мин без кусков -- назван").toBe(1)
  expect(String(st.submits[0].text)).toContain("- ag-sa27c «desc ag-sa27c» (general-purpose): без активности 30 мин")
  failoverBindReset()
})

test("stale-agents T27d: лестница выключена в мире; пустой план проверяющего -- поток мимо попыток, куски держат агента живым", async () => {
  const T0 = 874_000_000
  const st = sa$("t27d", T0, { files: { "/probes-sa-t27d/probes.toml": "[probe.idle-watch]\n[failover]\nenabled = false\n" } })
  st.agents = [saRun("ag-sa27d")]
  await saStart(st)
  failoverBindSet("ag-sa27d", { ladder: ["r-27d"], rungEffort: { "r-27d": "max" }, subagentType: "t", class: "", sticky: null })
  await saTickAt(st, T0)
  const R = { usage: { out: 1 }, stopReason: "end_turn", text: "R27d" }
  const run = await saChunkRun(st, T0, (next) => hook393(subs393(), "turn.step")(st.m.$, saStepEv("ag-sa27d", "m-27d"), next), R)
  expect(st.submits.length, "лестница выключена: куски -- агент жив").toBe(0)
  expect(run.out.value).toBe(R)
  expect(saAttempts(st, "ag-sa27d").length, "выключенная лестница попыток не пишет").toBe(0)
  const st2 = sa$("t27d2", T0)
  st2.agents = [saRun("ag-sa27d2")]
  await saStart(st2)
  failoverBindSet("ag-sa27d2", { ladder: [], terminal: "t-27d2", rungEffort: {}, subagentType: "t", class: "crit-mech", sticky: null })
  sessionExecutorModelAdd("t-27d2")
  await saTickAt(st2, T0)
  const run2 = await saChunkRun(st2, T0, (next) => hook393(subs393(), "turn.step")(st2.m.$, saStepEv("ag-sa27d2", ""), next), R)
  expect(st2.submits.length, "пустой план: куски -- агент жив").toBe(0)
  expect(run2.out.value).toBe(R)
  expect(run2.calls).toBe(1)
  expect(saAttempts(st2, "ag-sa27d2").length, "пустой план попыток не пишет").toBe(0)
  sessionExecutorsReset()
  failoverBindReset()
})

test("stale-agents T27e: обработчик отказа turn.step -- куски потока ставят пометку агента; отказ чтения agentId назван, поток идёт", async () => {
  const T0 = 876_000_000
  const st = sa$("t27e", T0)
  st.agents = [saRun("ag-sa27e")]
  await saStart(st)
  await saTickAt(st, T0)
  const caught = catchOfRegister()
  const R = { usage: { out: 1 }, stopReason: "end_turn", text: "R27e" }
  const run = await saChunkRun(st, T0, (next) => caught["turn.step"](Dollar, saStepEv("ag-sa27e", "m-27e"), next), R)
  expect(st.submits.length, "куски дороги отказа -- агент жив").toBe(0)
  expect(run.out.value).toBe(R)
  const l0 = lostN393("stale-agents-track")
  const bad = { get agentId() { throw new Error("poison agentId t27e") } }
  const out = await drainStream(caught["turn.step"](Dollar, bad, () => (async function* () { yield "c1"; return "V27e" })()))
  expect(out, "отказ чтения agentId поток не ломает").toEqual({ chunks: ["c1"], value: "V27e" })
  expect(lostN393("stale-agents-track") - l0, "отказ чтения agentId назван").toBe(1)
  const outE = await drainStream(caught["turn.step"](Dollar, { agentId: "" }, () => (async function* () { yield "c1"; return "V27e0" })()))
  expect(outE.value).toBe("V27e0")
  expect(saSnap()[""], "пустой agentId -- не агент").toBeUndefined()
})

test("stale-agents T27f: пометка кусков сохраняет yield* -- значение, бросок потока, return()/throw() потребителя доходят до потока, finally потока при обрыве", async () => {
  const T0 = 877_000_000
  const st = sa$("t27f", T0)
  await saStart(st)
  const step = hook393(subs393(), "turn.step")
  let fin = 0
  const g1 = step(st.m.$, saStepEv("ag-sa27f", "m-27f", "ret"), () => (async function* () { try { yield "c1"; yield "c2"; return "NEVER" } finally { fin++ } })())
  expect((await g1.next()).value).toBe("c1")
  expect(await g1.return("STOP"), "return() потребителя").toEqual({ done: true, value: "STOP" })
  expect(fin, "finally потока сработал при обрыве").toBe(1)
  let caughtX: any = null
  const g2 = step(st.m.$, saStepEv("ag-sa27f", "m-27f", "thr"), () => (async function* () { try { yield "c1"; return "NEVER" } catch (x) { caughtX = x; return "RECOVERED" } })())
  expect((await g2.next()).value).toBe("c1")
  const boom = new Error("boom t27f")
  expect(await g2.throw(boom), "throw() потребителя доходит до потока").toEqual({ done: true, value: "RECOVERED" })
  expect(caughtX).toBe(boom)
  const inner = new Error("inner t27f")
  let got: any = null
  try { await drainStream(step(st.m.$, saStepEv("ag-sa27f", "m-27f", "in"), () => (async function* () { yield "c1"; throw inner })())) } catch (x) { got = x }
  expect(got, "бросок потока доходит до потребителя").toBe(inner)
  const out = await drainStream(step(st.m.$, saStepEv("ag-sa27f", "m-27f", "val"), () => (async function* () { yield "c1"; return "V27f" })()))
  expect(out).toEqual({ chunks: ["c1"], value: "V27f" })
  let nextReads = 0
  let k = 0
  const itN: any = {}
  Object.defineProperty(itN, "next", { get() { nextReads++; return async () => (k++ < 2 ? { done: false, value: "n" + k } : { done: true, value: "VN" }) } })
  const outN = await drainStream(step(st.m.$, saStepEv("ag-sa27f", "m-27f", "nx"), () => ({ [Symbol.asyncIterator]: () => itN })))
  expect(outN).toEqual({ chunks: ["n1", "n2"], value: "VN" })
  expect(nextReads, "свойство next потока читается один раз").toBe(1)
})

test("stale-agents T28: строка флота в сообщении -- все поля; та же форма в fleet_status", async () => {
  const T0 = 880_000_000
  const dir = "/probes-sa-t28/idle-watch/fleet"
  const files: Record<string, string> = {
    [dir + "/iiii9999.json"]: JSON.stringify({ v: 1, sid: "iiii9999-u", cwd: "/w/i", t: T0 + 31 * SA_MIN - 1000, running: null, agents: [] }),
    [dir + "/jjjj0000.json"]: "{bad",
  }
  const st = sa$("t28", T0, { files })
  st.agents = [saRun("ag-sa28")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length).toBe(1)
  expect(String(st.submits[0].text).split("\n").pop()).toBe("Флот сейчас: агентов 1, сессий 2 (в этой 1); без счёта 1, нечитаемых 1.")
  const out = await hook393(subs393(), "tool.call")(st.m.$, { tool: SA_TOOL, tool_use_id: "tu-sa28" }, async () => ({ result: "НЕ ДОЛЖЕН" }))
  expect(String(out && out.result).split("\n")[0]).toBe("Флот: агентов 1, сессий 2 (в этой 1); без счёта 1, нечитаемых 1")
})

test("stale-agents T29: незакрытый -- любой статус, кроме completed / failed / killed; статус ≠ running выводится; флот считает так же", async () => {
  const T0 = 890_000_000
  const st = sa$("t29", T0)
  st.agents = [saRun("ag-sa29p", { status: "pending" }), saRun("ag-sa29w", { status: "weird" }), saRun("ag-sa29r"), saRun("ag-sa29c", { status: "completed" }), saRun("ag-sa29f", { status: "failed" }), saRun("ag-sa29k", { status: "killed" })]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length).toBe(1)
  const text = String(st.submits[0].text)
  expect(text).toContain("- ag-sa29p «desc ag-sa29p» (general-purpose, статус pending): без активности 31 мин")
  expect(text).toContain("- ag-sa29w «desc ag-sa29w» (general-purpose, статус weird): без активности 31 мин")
  expect(text).toContain("- ag-sa29r «desc ag-sa29r» (general-purpose): без активности 31 мин")
  expect(text).not.toContain("ag-sa29c")
  expect(text).not.toContain("ag-sa29f")
  expect(text).not.toContain("ag-sa29k")
  const rec = saFleetRec(st)
  expect(rec.running, "флот считает незакрытых").toBe(3)
  expect(rec.agents.map((a: any) => a.id).sort()).toEqual(["ag-sa29p", "ag-sa29r", "ag-sa29w"])
})

test("stale-agents T30: tool.call агента читает ровно tool, agentId, tool_use_id и один раз `agentId in`", async () => {
  const T0 = 900_000_000
  const st = sa$("t30", T0, { idle: "0" })
  await saStart(st)
  const probe = (raw: any) => {
    const seen = { gets: [] as string[], has: 0 }
    const ev = new Proxy(raw, {
      get(t: any, k: any, r: any) { seen.gets.push(String(k)); return Reflect.get(t, k, r) },
      has(t: any, k: any) { if (k === "agentId") seen.has++; return Reflect.has(t, k) },
    })
    return { ev, seen }
  }
  const a = probe({ agentId: "ag-sa30", tool: "Read", tool_use_id: "tu-sa30", file_path: "/x", extra: 1 })
  const out = await hook393(subs393(), "tool.call")(st.m.$, a.ev, async () => ({ result: "r30" }))
  expect(out).toEqual({ result: "r30" })
  expect(a.seen.has, "`agentId in` -- один раз").toBe(1)
  expect(a.seen.gets.slice().sort(), "агентский путь читает три ключа по разу").toEqual(["agentId", "tool", "tool_use_id"])
  const f = probe({ agentId: "ag-sa30", tool: SA_TOOL, tool_use_id: "tu-sa30f", extra: 1 })
  const fout = await hook393(subs393(), "tool.call")(st.m.$, f.ev, async () => ({ result: "НЕ ДОЛЖЕН" }))
  expect(String(fout && fout.result)).toContain("Флот: ")
  expect(f.seen.has).toBe(1)
  expect(f.seen.gets.slice().sort(), "ветка флота агента -- по прочитанному tool").toEqual(["agentId", "tool", "tool_use_id"])
  const l0 = lostN393("stale-agents-track")
  const bad = new Proxy({ agentId: "ag-sa30b", tool: "Read", tool_use_id: "tu-sa30b" }, {
    get(t: any, k: any, r: any) { if (k === "tool") throw new Error("poison getter t30"); return Reflect.get(t, k, r) },
  })
  let called = false
  const bout = await hook393(subs393(), "tool.call")(st.m.$, bad, async () => { called = true; return { result: "r30b" } })
  expect(bout, "отказ чтения ключа не ломает вызов").toEqual({ result: "r30b" })
  expect(called).toBe(true)
  expect(lostN393("stale-agents-track") - l0, "отказ чтения ключа назван").toBe(1)
})

test("stale-agents T31: новый висящий агент каждую минуту 30 минут подряд -- один submit за окно; следующее окно перечисляет всех", async () => {
  const T0 = 910_000_000
  const st = sa$("t31", T0)
  await saStart(st)
  for (let k = 0; k < 30; k++) {
    st.agents.push(saRun("ag-sa31-" + k))
    await saTickAt(st, T0 + k * SA_MIN)
  }
  for (let m = 30; m < 60; m++) await saTickAt(st, T0 + m * SA_MIN)
  expect(st.submits.length, "окно cooldown_min -- один submit").toBe(1)
  expect(String(st.submits[0].text)).toContain("- ag-sa31-0 «")
  expect(String(st.submits[0].text)).not.toContain("- ag-sa31-1 «")
  await saTickAt(st, T0 + 60 * SA_MIN)
  expect(st.submits.length, "следующее окно -- снова").toBe(2)
  const text = String(st.submits[1].text)
  for (let k = 0; k < 30; k++) expect(text, "окно перечисляет всех висящих: " + k).toContain("- ag-sa31-" + k + " «")
  const j = saJournal(st)
  expect(j.length).toBe(2)
  const a0 = j[1].agents.filter((a: any) => a.id === "ag-sa31-0")[0]
  const a1 = j[1].agents.filter((a: any) => a.id === "ag-sa31-1")[0]
  expect(a0.prevNudgedAt, "отметка агента -- в журнале").toBe(new Date(T0 + 30 * SA_MIN).toISOString())
  expect(a1.prevNudgedAt).toBeUndefined()
})

test("stale-agents T32: перед submit -- агент с touched или терминальный за время await тика выбрасывается; пусто -- submit нет и окно не занято", async () => {
  const T0 = 920_000_000
  const gate = saGate()
  const st = sa$("t32", T0, { onFsList: () => gate.fire() })
  st.agents = [saRun("ag-sa32a"), saRun("ag-sa32b"), saRun("ag-sa32c")]
  await saStart(st)
  await saTickAt(st, T0)
  gate.set(async () => {
    await hook393(subs393(), "tool.call")(st.m.$, { agentId: "ag-sa32a", tool: "Read", tool_use_id: "tu-sa32a" }, async () => ({ result: "r" }))
    st.agents = [saRun("ag-sa32a"), saRun("ag-sa32b", { status: "completed" }), saRun("ag-sa32c")]
  })
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(gate.pending()).toBe(false)
  expect(st.submits.length).toBe(1)
  const text = String(st.submits[0].text)
  expect(text).toContain("- ag-sa32c «")
  expect(text, "touched за время await -- выброшен").not.toContain("ag-sa32a")
  expect(text, "терминальный за время await -- выброшен").not.toContain("ag-sa32b")
  const gate2 = saGate()
  const st2 = sa$("t32b", T0, { onFsList: () => gate2.fire() })
  st2.agents = [saRun("ag-sa32d")]
  await saStart(st2)
  await saTickAt(st2, T0)
  st2.agents = [saRun("ag-sa32d"), saRun("ag-sa32e")]
  await saTickAt(st2, T0 + 2 * SA_MIN)
  gate2.set(async () => { st2.agents = [saRun("ag-sa32d", { status: "killed" }), saRun("ag-sa32e")] })
  await saTickAt(st2, T0 + 31 * SA_MIN)
  expect(gate2.pending()).toBe(false)
  expect(st2.submits.length, "все выброшены -- submit нет").toBe(0)
  await saTickAt(st2, T0 + 32 * SA_MIN)
  expect(st2.submits.length, "окно не занято пустым тиком").toBe(1)
  expect(String(st2.submits[0].text)).toContain("- ag-sa32e «")
  let failRe = ""
  const gate3 = saGate()
  const st3: any = sa$("t32c", T0, { cfg: "cooldown_min = 1\n", onFsList: () => gate3.fire(), list: () => {
    if (failRe === "throw") { failRe = ""; throw new Error("agent.list: scripted recheck refusal t32") }
    if (failRe === "shape") { failRe = ""; return { not: "array" } }
    return st3.agents
  } })
  st3.agents = [saRun("ag-sa32f")]
  await saStart(st3)
  await saTickAt(st3, T0)
  gate3.set(async () => { failRe = "throw" })
  await saTickAt(st3, T0 + 31 * SA_MIN)
  expect(st3.submits.length, "отказ повторного list -- сигнал не гаснет").toBe(1)
  const j3 = saJournal(st3)
  expect(j3[0].lost && j3[0].lost["stale-agents-recheck"] && j3[0].lost["stale-agents-recheck"].n, "отказ повторного list назван").toBe(1)
  gate3.set(async () => { failRe = "shape" })
  await saTickAt(st3, T0 + 32 * SA_MIN)
  expect(st3.submits.length, "не-массив повторного list -- сигнал не гаснет").toBe(2)
  const j3b = saJournal(st3)
  expect(j3b[1].lost && j3b[1].lost["stale-agents-recheck-shape"] && j3b[1].lost["stale-agents-recheck-shape"].n, "не-массив повторного list назван").toBe(1)
})

test("stale-agents T33: файл, пропавший между list и чтением, -- vanished, не нечитаемый; catch session.end различает мир и публикацию", async () => {
  const T0 = 930_000_000
  const dir = "/probes-sa-t33/idle-watch/fleet"
  const files: Record<string, string> = {
    [dir + "/kkkk1111.json"]: JSON.stringify({ v: 1, sid: "kkkk1111-a", cwd: "/w/k", t: T0 - 1000, running: 1, agents: [] }),
    [dir + "/llll2222.json"]: JSON.stringify({ v: 1, sid: "llll2222-a", cwd: "/w/l", t: T0 - 1000, running: 1, agents: [] }),
  }
  const st = sa$("t33", T0, { files, extraNames: ["gone3333.json", "mmmm4444.json"], statErr: [dir + "/mmmm4444.json"], fail: { fsReadErr: [dir + "/llll2222.json"] } })
  await clear393()
  const c = await SA.fleetCensus(st.m.$, { globalHome: st.home })
  expect(c.vanished, "пропавший файл -- vanished").toBe(1)
  expect(c.unreadable, "отказ чтения живого файла и отказ stat не ENOENT -- нечитаемые").toBe(2)
  expect(c.sessions).toBe(1)
  await saStart(st)
  const out = await hook393(subs393(), "tool.call")(st.m.$, { tool: SA_TOOL, tool_use_id: "tu-sa33" }, async () => ({ result: "НЕ ДОЛЖЕН" }))
  expect(String(out && out.result).split("\n")[0], "vanished в тексте не выводится").toBe("Флот: агентов 1, сессий 1 (в этой ?); без счёта 0, нечитаемых 2")
  const w0 = lostN393("fleet-end-world")
  const p0 = lostN393("fleet-end-publish")
  const mW = mod$393({ env: { PWD: "/work-sa-t33-w", HOME: "/hh-sa-t33" }, now: T0, fail: { envPoison: ["HOME"] } })
  const rW = await hook393(subs393(), "session.end")(mW.$, { reason: "other", sessionId: "sid-sa-t33-w", resume: {} }, async () => ({ sessionId: "sid-sa-t33-w" }))
  expect(rW).toEqual({ sessionId: "sid-sa-t33-w" })
  expect(lostN393("fleet-end-world") - w0, "отказ мира назван fleet-end-world").toBe(1)
  expect(lostN393("fleet-end-publish") - p0).toBe(0)
  const stP = sa$("t33p", T0, { fsWriteFail: (p) => p.indexOf("/idle-watch/fleet/") >= 0 })
  await saStart(stP)
  const p1 = lostN393("fleet-end-publish")
  const w1 = lostN393("fleet-end-world")
  await hook393(subs393(), "session.end")(stP.m.$, { reason: "other", sessionId: "sid-sa-t33-p", resume: {} }, async () => ({ sessionId: "sid-sa-t33-p" }))
  expect(lostN393("fleet-end-publish") - p1, "отказ публикации назван fleet-end-publish").toBe(1)
  expect(lostN393("fleet-end-world") - w1).toBe(0)
})

test("stale-agents T34: запись журнала несёт поле перепроверки -- ok, отказ повторного list с текстом, не-массив", async () => {
  const T0 = 940_000_000
  let failRe = ""
  const gate = saGate()
  const st: any = sa$("t34", T0, { cfg: "cooldown_min = 1\n", onFsList: () => gate.fire(), list: () => {
    if (failRe === "throw") { failRe = ""; throw new Error("agent.list: scripted recheck refusal t34") }
    if (failRe === "shape") { failRe = ""; return { not: "array" } }
    return st.agents
  } })
  st.agents = [saRun("ag-sa34")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  gate.set(async () => { failRe = "throw" })
  await saTickAt(st, T0 + 32 * SA_MIN)
  gate.set(async () => { failRe = "shape" })
  await saTickAt(st, T0 + 33 * SA_MIN)
  expect(st.submits.length).toBe(3)
  expect(saJournal(st).map((r: any) => r.recheck)).toEqual(["ok", "failed: agent.list: scripted recheck refusal t34", "not-array: object"])
})

test("stale-agents T35a: агент ждёт на лестнице 45 мин засчитанными паузами -- не назван; ответ после срока доходит", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 23, 0, 0)
  const h: any = { history: [] as any[] }
  let pauses = 0
  let lastMin = -1
  const st: any = sa$("t35a", T0, { messages: () => h.history.slice(), procFn: async (argv: string[], _init: any, setNow: (n: number) => void, getNow: () => number) => {
    pauses++
    setNow(getNow() + Number(argv[1]) * 1000)
    const min = Math.floor((getNow() - T0) / SA_MIN)
    if (min !== lastMin) { lastMin = min; await st.tick() }
    return { exitCode: 0, stdout: "", stderr: "" }
  } })
  h.m = st.m
  st.agents = [saRun("ag-sa35a")]
  await saStart(st)
  failoverBindSet("ag-sa35a", { ladder: ["r-35a"], rungEffort: { "r-35a": "max" }, subagentType: "t35", class: "", sticky: null })
  await saTickAt(st, T0)
  const text = "You've hit your session limit · resets 11:45pm (UTC)"
  const next = next514(h, {
    "m-35a": (_k: number, t: number) => (t >= T0 + 45 * SA_MIN ? null : text),
    "r-35a": (_k: number, t: number) => (t >= T0 + 45 * SA_MIN ? null : text),
  })
  const out = await drainStream(hook393(subs393(), "turn.step")(st.m.$, saStepEv("ag-sa35a", "m-35a"), next))
  await settle393()
  expect(out.value && out.value.text, "ответ после срока").toBe("OK-m-35a")
  expect(waits514(h, "ag-sa35a", "wait-begin").length, "агент ждал на лестнице").toBe(1)
  expect(pauses, "ожидание шло засчитанными паузами").toBeGreaterThan(600)
  expect(st.submits.length, "ждущий на лестнице -- жив, не назван").toBe(0)
  failoverBindReset()
})

test("stale-agents T35b: досрочное пробуждение паузы лестницы (не засчитано) пометки не ставит", async () => {
  reset514()
  const T0 = Date.UTC(2026, 8, 27, 20, 0, 0)
  const h: any = { history: [] as any[] }
  let n = 0
  const st: any = sa$("t35b", T0, { messages: () => h.history.slice(), procFn: async (_argv: string[], _init: any, setNow: (n: number) => void, getNow: () => number) => {
    n++
    await st.tick()
    setNow(getNow() + 1000)
    return { exitCode: 0, stdout: "", stderr: "" }
  } })
  h.m = st.m
  st.agents = [saRun("ag-sa35b")]
  await saStart(st)
  failoverBindSet("ag-sa35b", { ladder: ["r-35b"], rungEffort: { "r-35b": "max" }, subagentType: "t35", class: "", sticky: null })
  await saTickAt(st, T0)
  const text = "You've hit your session limit · resets 9:45pm (UTC)"
  const next = next514(h, { "m-35b": refuseAll514(text), "r-35b": refuseAll514(text) })
  st.m.setNow(T0 + SA_MIN)
  await drainStream(hook393(subs393(), "turn.step")(st.m.$, saStepEv("ag-sa35b", "m-35b"), next))
  await settle393()
  expect(n, "одна пауза").toBe(1)
  const un = waits514(h, "ag-sa35b", "wait-unavailable")
  expect(un.length).toBe(1)
  expect(un[0].elapsedMs, "пауза не засчитана: досрочное пробуждение").toBe(1000)
  expect(saSnap()["ag-sa35b"].lastAt, "тик внутри паузы -- время тика").toBe(T0 + SA_MIN)
  await saTickAt(st, T0 + 2 * SA_MIN)
  expect(saSnap()["ag-sa35b"].lastAt, "незасчитанная пауза активностью не стала").toBe(T0 + SA_MIN)
  await saTickAt(st, T0 + 30 * SA_MIN)
  expect(st.submits.length).toBe(0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length, "30 мин от шага -- назван").toBe(1)
  failoverBindReset()
})

// --- #531: триггеры проб (on / every_min), idle-watch по README, доставка nudge ---
const P5_IDLE = 'act = "nudge"\nwindow_min = 30\nthreshold = 1\ncooldown_min = 30\nlive_threshold = 1\n'

function p5$(tag: string, now: number, toml: string, o: any = {}): any {
  const home = "/probes-sa-p531-" + tag
  const st = sa$("p531-" + tag, now, Object.assign({ idle: "0" }, o, { files: Object.assign({ [home + "/probes.toml"]: toml }, o.files || {}) }))
  st.calls = [] as any[]
  const c0 = st.m.$.model.complete
  st.m.$.model.complete = async (arg: any) => { st.calls.push(arg); return c0(arg) }
  return st
}

function p5J(st: any, probe: string): any[] {
  return shards393(st.m.writes, "/" + probe + "/journal.jsonl.shard.")
}

function p5Out(st: any, probe: string, oc: string): any[] {
  return p5J(st, probe).filter((r: any) => r.outcome === oc)
}

async function p5Call(st: any, ev: any, res: any = { result: "r" }, t?: number): Promise<any> {
  if (t !== undefined) st.m.setNow(t)
  const r = await hook393(subs393(), "tool.call")(st.m.$, ev, async (_e: any) => (typeof res === "function" ? res() : res))
  await settle393()
  return r
}

async function p5Classic(st: any, name: string, ev: any, t?: number): Promise<any> {
  if (t !== undefined) st.m.setNow(t)
  const r = await hook393(subs393(), "classic." + name)(st.m.$, Object.assign({ hook_event_name: name, session_id: st.sid }, ev), async (_e: any) => ({ ok: name }))
  await settle393()
  return r
}

function p5Q(key: string): string[] {
  const s = SA.probeQueueSnapshot()
  return (s[key] || []).map((i: any) => i.text)
}

test("p531 T1: on = [\"Stop\"] -- classic.Stop консультирует, чужое событие нет; ctx несёт event и плоские поля; show event кладёт вход", async () => {
  const T0 = 900_000_000
  const st = p5$("t1", T0, '[probe.stopper]\non = ["Stop"]\nshow = ["event"]\n\n[probe.stopper.when]\nfield = "stop_hook_active"\nequals = "true"\n', { answers: ["OK: fine"] })
  await saStart(st)
  await p5Classic(st, "Stop", { stop_hook_active: false }, T0 + SA_MIN)
  expect(st.calls.length, "предикат по плоскому полю ложен -- консультации нет").toBe(0)
  await p5Classic(st, "SubagentStop", { stop_hook_active: true, agent_id: "ag-p1" }, T0 + 2 * SA_MIN)
  expect(st.calls.length, "SubagentStop пробой не слушается").toBe(0)
  const r = await p5Classic(st, "Stop", { stop_hook_active: true, marker_p1: "M-P1" }, T0 + 3 * SA_MIN)
  expect(r, "next(e) отдан как есть").toEqual({ ok: "Stop" })
  expect(st.calls.length, "classic.Stop с истинным предикатом -- одна консультация").toBe(1)
  const prompt = String(st.calls[0].prompt)
  expect(prompt).toContain("=== EVENT ===")
  expect(prompt).toContain("\"marker_p1\":\"M-P1\"")
  expect(p5Out(st, "stopper", "ok").length).toBe(1)
})

test("p531 T1b: ctx события -- event и agent_id видны предикату", async () => {
  const T0 = 900_100_000
  const st = p5$("t1b", T0, '[probe.evt]\nsubagents = true\non = ["SubagentStop", "Stop"]\n\n[probe.evt.when]\nall = [{ field = "event", equals = "SubagentStop" }, { field = "agent_id", equals = "ag-p1b" }]\n', { answers: ["OK: fine"] })
  await saStart(st)
  await p5Classic(st, "Stop", {}, T0 + SA_MIN)
  await p5Classic(st, "SubagentStop", { agent_id: "ag-other" }, T0 + 2 * SA_MIN)
  expect(st.calls.length).toBe(0)
  await p5Classic(st, "SubagentStop", { agent_id: "ag-p1b" }, T0 + 3 * SA_MIN)
  expect(st.calls.length, "event и agent_id дошли до предиката").toBe(1)
})

test("p531 T2: PostToolUse -- проба после next(e), результат виден через show tool", async () => {
  const T0 = 900_200_000
  const st = p5$("t2", T0, '[probe.post]\non = ["PostToolUse"]\nshow = ["tool"]\n', { answers: ["OK: fine"] })
  await saStart(st)
  const order: string[] = []
  const c1 = st.m.$.model.complete
  st.m.$.model.complete = async (arg: any) => { order.push("model"); return c1(arg) }
  const r = await p5Call(st, { tool: "Read", tool_use_id: "tu-p2" }, () => { order.push("next"); return { result: "RESULT-P2" } }, T0 + SA_MIN)
  expect(r).toEqual({ result: "RESULT-P2" })
  expect(order, "консультация после next(e)").toEqual(["next", "model"])
  expect(String(st.calls[0].prompt)).toContain("RESULT-P2")
})

test("p531 T2b: PreToolUse-проба без when консультирует на своём событии", async () => {
  const T0 = 900_250_000
  const st = p5$("t2b", T0, '[probe.pre]\non = ["PreToolUse"]\n', { answers: ["OK: fine"] })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p2b" }, { result: "r" }, T0 + SA_MIN)
  expect(st.calls.length).toBe(1)
  expect(p5Out(st, "pre", "ok").length).toBe(1)
})

test("p531 T3: неизвестное имя и MessageDisplay -- on_bad по строке на загрузку, валидное имя работает", async () => {
  const T0 = 900_300_000
  const st = p5$("t3", T0, '[probe.mixed]\non = ["Stopp", "Stop", "MessageDisplay"]\n', { answers: ["OK: fine"] })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p3a" }, { result: "r" }, T0 + SA_MIN)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p3b" }, { result: "r" }, T0 + 2 * SA_MIN)
  const bad = p5Out(st, "mixed", "on_bad").map((r: any) => r.by).sort()
  expect(bad, "по одной строке на имя").toEqual(["MessageDisplay:per-delta", "Stopp"])
  expect(st.calls.length, "PreToolUse не в on -- tool.call не консультирует").toBe(0)
  await p5Classic(st, "Stop", {}, T0 + 3 * SA_MIN)
  expect(st.calls.length, "валидное Stop работает").toBe(1)
})

test("p531 T3b: пользовательская проба без on и every_min -- skip_degraded no-trigger, консультаций нет", async () => {
  const T0 = 900_400_000
  const st = p5$("t3b", T0, '[probe.bare]\nact = "log_only"\n\n[probe.bare.when]\nfield = "tool"\nequals = "Read"\n', { answers: ["OK: fine", "OK: fine"] })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p3c" }, { result: "r" }, T0 + SA_MIN)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p3d" }, { result: "r" }, T0 + 2 * SA_MIN)
  await saTickAt(st, T0 + 3 * SA_MIN)
  expect(st.calls.length).toBe(0)
  const sd = p5Out(st, "bare", "skip_degraded")
  expect(sd.length, "одна строка на загрузку").toBe(1)
  expect(sd[0].by).toBe("no-trigger")
})

test("p531 T3c: cancel-проба на имени кроме PreToolUse -- on_bad cancel-needs-PreToolUse, PreToolUse остаётся", async () => {
  const T0 = 900_450_000
  const st = p5$("t3c", T0, '[probe.canc]\nact = "cancel"\non = ["Stop", "PreToolUse"]\nevery_min = 1\n\n[probe.canc.when]\nfield = "tool"\nequals = "Nope"\n')
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p3e" }, { result: "r" }, T0 + SA_MIN)
  const bad = p5Out(st, "canc", "on_bad").map((r: any) => r.by).sort()
  expect(bad).toEqual(["Stop:cancel-needs-PreToolUse", "every_min:cancel-needs-PreToolUse"])
  await p5Classic(st, "Stop", {}, T0 + 2 * SA_MIN)
  await saTickAt(st, T0 + 3 * SA_MIN)
  expect(st.calls.length).toBe(0)
})

test("p531 T4: every_min -- оценка на тике не чаще раза в N мин, ctx event = timer", async () => {
  const T0 = 900_500_000
  const st = p5$("t4", T0, '[probe.ticker]\nevery_min = 2\n\n[probe.ticker.when]\nfield = "event"\nequals = "timer"\n', { answers: ["OK: a", "OK: b", "OK: c"] })
  await saStart(st)
  await saTickAt(st, T0 + SA_MIN)
  expect(st.calls.length, "1 мин < every_min").toBe(0)
  await saTickAt(st, T0 + 2 * SA_MIN)
  expect(st.calls.length, "2 мин -- первая оценка").toBe(1)
  await saTickAt(st, T0 + 3 * SA_MIN)
  expect(st.calls.length, "через минуту -- нет").toBe(1)
  await saTickAt(st, T0 + 4 * SA_MIN)
  expect(st.calls.length, "ещё через две -- вторая").toBe(2)
  const lines = p5Out(st, "ticker", "ok")
  expect(lines.length).toBe(2)
  expect(String(lines[0].rec)).toContain("mod-timer-")
})

test("p531 T4b: смена эпохи во время тика -- консультации нет", async () => {
  const T0 = 900_600_000
  let clearing = false
  const st = p5$("t4b", T0, '[probe.ticker]\nevery_min = 1\n', {
    answers: ["OK: a"],
    onList: async () => { if (clearing) { clearing = false; await clear393() } },
  })
  await saStart(st)
  clearing = true
  await saTickAt(st, T0 + SA_MIN)
  expect(clearing, "смена эпохи случилась внутри тика").toBe(false)
  expect(st.calls.length, "консультация прежней эпохи не пошла").toBe(0)
})

test("p531 T5a: idle live-work -- живая работа live_kinds блокирует, чужой вид и терминальный статус нет", async () => {
  const T0 = 901_000_000
  const st = p5$("t5a", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go"] })
  st.agents = [saRun("ag-p5a")]
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p5a" }, { result: "r" }, T0 + 31 * SA_MIN)
  expect(st.calls.length).toBe(0)
  const f = p5Out(st, "idle-watch", "filtered")
  expect(f.map((r: any) => r.by)).toEqual(["live-work:1"])
  const st2 = p5$("t5a2", T0, "[probe.idle-watch]\n" + P5_IDLE + 'live_kinds = ["in_process_teammate"]\n', { idle: "1", answers: ["NUDGE: go"] })
  st2.agents = [saRun("ag-p5a2"), saRun("ag-p5a3", { type: "teammate", status: "completed" })]
  await saStart(st2)
  await p5Call(st2, { tool: "Read", tool_use_id: "tu-p5a2" }, { result: "r" }, T0 + 31 * SA_MIN)
  expect(st2.calls.length, "local_agent вне live_kinds, teammate терминален -- живой работы нет").toBe(1)
})

test("p531 T5b: idle window-count -- запуск Agent главного лупа в окне блокирует", async () => {
  const T0 = 901_100_000
  const st = p5$("t5b", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go"] })
  await saStart(st)
  await p5Call(st, { tool: "Agent", tool_use_id: "tu-p5b1", subagent_type: "x", prompt: "p" }, { result: "r" }, T0 + SA_MIN)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p5b2" }, { result: "r" }, T0 + 30 * SA_MIN + 30_000)
  expect(st.calls.length).toBe(0)
  expect(p5Out(st, "idle-watch", "filtered").map((r: any) => r.by)).toEqual(["window-count:1"])
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p5b3" }, { result: "r" }, T0 + 31 * SA_MIN + 1)
  expect(st.calls.length, "запуск вышел из окна -- консультация").toBe(1)
})

test("p531 T5c: idle window-not-filled -- сессия моложе window_min", async () => {
  const T0 = 901_200_000
  const st = p5$("t5c", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go"] })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p5c1" }, { result: "r" }, T0 + 10 * SA_MIN)
  expect(st.calls.length).toBe(0)
  expect(p5Out(st, "idle-watch", "filtered").map((r: any) => r.by)).toEqual(["window-not-filled"])
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p5c2" }, { result: "r" }, T0 + 30 * SA_MIN)
  expect(st.calls.length, "ровно window_min -- окно заполнено").toBe(1)
})

test("p531 T5d: idle cooldown -- вторая оценка внутри cooldown_min фильтруется", async () => {
  const T0 = 901_300_000
  const st = p5$("t5d", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go", "NUDGE: again"] })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p5d1" }, { result: "r" }, T0 + 31 * SA_MIN)
  expect(st.calls.length, "все четыре условия проходят -- консультация").toBe(1)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p5d2" }, { result: "r" }, T0 + 40 * SA_MIN)
  expect(st.calls.length).toBe(1)
  expect(p5Out(st, "idle-watch", "filtered").map((r: any) => r.by)).toEqual(["cooldown"])
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p5d3" }, { result: "r" }, T0 + 61 * SA_MIN)
  expect(st.calls.length, "cooldown истёк").toBe(2)
})

test("p531 T5e: idle на таймере -- оценка каждые live_recheck_ms, консультация без вызова инструмента", async () => {
  const T0 = 901_400_000
  const st = p5$("t5e", T0, "[probe.idle-watch]\n" + P5_IDLE.replace("cooldown_min = 30", "cooldown_min = 0") + "live_recheck_ms = 180000\nstale_agent_min = 1000\n", { idle: "1", answers: ["NUDGE: timer-go"] })
  st.agents = [saRun("ag-p5e")]
  await saStart(st)
  for (let k = 31; k <= 34; k++) await saTickAt(st, T0 + k * SA_MIN)
  expect(p5Out(st, "idle-watch", "filtered").map((r: any) => r.by), "оценки на +31 и +34").toEqual(["live-work:1", "live-work:1"])
  st.agents = []
  await saTickAt(st, T0 + 37 * SA_MIN)
  expect(st.calls.length, "флот пуст -- таймер консультирует главный луп").toBe(1)
  expect(p5Q(""), "в очередь главного лупа").toEqual(["[idle-watch] timer-go"])
})

test("p531 T6: доставка (а) -- очередь главного лупа уходит полем context ближайшего вызова, свой context сохранён, тост -- полем", async () => {
  const T0 = 901_500_000
  const st = p5$("t6", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go"] })
  await saStart(st)
  const r1 = await p5Call(st, { tool: "Read", tool_use_id: "tu-p6a" }, { result: "r1" }, T0 + 31 * SA_MIN)
  expect(r1.context, "консультация фоновая -- этот вызов без текста").toBe(undefined)
  expect(p5Q("")).toEqual(["[idle-watch] go"])
  const consult = p5J(st, "idle-watch").filter((r: any) => String(r.verdict || "").indexOf("NUDGE") === 0)
  expect(consult.length).toBe(1)
  expect(consult[0].toast, "тост -- полем toast").toBe(true)
  expect(consult[0].outcome, "тост не метит nudge_delivered").not.toBe("nudge_delivered")
  expect(st.m.toasts.length).toBe(1)
  const r2 = await p5Call(st, { tool: "Read", tool_use_id: "tu-p6b" }, { result: "r2", context: ["own"] }, T0 + 32 * SA_MIN)
  expect(r2).toEqual({ result: "r2", context: ["own", "[idle-watch] go"] })
  const d = p5Out(st, "idle-watch", "nudge_delivered")
  expect(d.length).toBe(1)
  expect(d[0].channel).toBe("context")
  expect(d[0].agent).toBe("main")
  const r3 = await p5Call(st, { tool: "Read", tool_use_id: "tu-p6c" }, { result: "r3" }, T0 + 33 * SA_MIN)
  expect(r3, "текст снят -- дубля нет").toEqual({ result: "r3" })
})

test("p531 T7: доставка (б) -- на тике текст старше 60 с уходит submit, дубля в context нет", async () => {
  const T0 = 901_600_000
  const st = p5$("t7", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go"] })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p7a" }, { result: "r" }, T0 + 31 * SA_MIN)
  await saTickAt(st, T0 + 31 * SA_MIN + 30_000)
  expect(st.submits.length, "30 с -- рано").toBe(0)
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(st.submits).toEqual([{ text: "[idle-watch] go" }])
  const d = p5Out(st, "idle-watch", "nudge_delivered")
  expect(d.map((r: any) => r.channel)).toEqual(["submit"])
  expect(p5Q("")).toEqual([])
  const r = await p5Call(st, { tool: "Read", tool_use_id: "tu-p7b" }, { result: "r" }, T0 + 33 * SA_MIN)
  expect(r).toEqual({ result: "r" })
  await saTickAt(st, T0 + 34 * SA_MIN)
  expect(st.submits.length).toBe(1)
})

test("p531 T8: не-интерактив и неизвестный режим -- nudge_undelivered раз на запись, текст остаётся для (а)", async () => {
  const T0 = 901_700_000
  const st = p5$("t8", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go"] })
  await saStart(st, { isInteractive: false })
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p8a" }, { result: "r" }, T0 + 31 * SA_MIN)
  await saTickAt(st, T0 + 32 * SA_MIN)
  await saTickAt(st, T0 + 33 * SA_MIN)
  expect(st.submits.length).toBe(0)
  const u = p5Out(st, "idle-watch", "nudge_undelivered")
  expect(u.map((r: any) => r.by), "одна строка на запись").toEqual(["not-interactive"])
  SA.staleInteractiveReset()
  await saTickAt(st, T0 + 34 * SA_MIN)
  expect(p5Out(st, "idle-watch", "nudge_undelivered").map((r: any) => r.by)).toEqual(["not-interactive", "interactive-unknown"])
  const r = await p5Call(st, { tool: "Read", tool_use_id: "tu-p8b" }, { result: "r" }, T0 + 35 * SA_MIN)
  expect(r.context).toEqual(["[idle-watch] go"])
})

test("p531 T9: deny -- очередь не доставляется и ждёт следующего вызова", async () => {
  const T0 = 901_800_000
  const st = p5$("t9", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go"] })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p9a" }, { result: "r" }, T0 + 31 * SA_MIN)
  const d = await p5Call(st, { tool: "Read", tool_use_id: "tu-p9b" }, { deny: "downstream" }, T0 + 32 * SA_MIN)
  expect(d).toEqual({ deny: "downstream" })
  expect(p5Q("")).toEqual(["[idle-watch] go"])
  const r = await p5Call(st, { tool: "Read", tool_use_id: "tu-p9c" }, { result: "r" }, T0 + 33 * SA_MIN)
  expect(r.context).toEqual(["[idle-watch] go"])
})

test("p531 T10: очередь агента -- его tool.call получает context; ушедший агент -- agent-gone и очередь снята", async () => {
  const T0 = 901_900_000
  const toml = '[probe.sub]\nsubagents = true\non = ["SubagentStop"]\nact = "nudge"\n'
  const st = p5$("t10", T0, toml, { answers: ["BLOCK: wrap up", "BLOCK: gone"] })
  st.agents = [saRun("ag-p10a"), saRun("ag-p10b")]
  await saStart(st)
  await p5Classic(st, "SubagentStop", { agent_id: "ag-p10a" }, T0 + SA_MIN)
  expect(p5Q("ag-p10a")).toEqual(["[sub] wrap up"])
  const r = await p5Call(st, { agentId: "ag-p10a", tool: "Read", tool_use_id: "tu-p10a" }, { result: "r" }, T0 + 2 * SA_MIN)
  expect(r).toEqual({ result: "r", context: ["[sub] wrap up"] })
  expect(p5Out(st, "sub", "nudge_delivered").map((x: any) => x.agent)).toEqual(["ag-p10a"])
  await p5Classic(st, "SubagentStop", { agent_id: "ag-p10b" }, T0 + 3 * SA_MIN)
  expect(p5Q("ag-p10b")).toEqual(["[sub] gone"])
  st.agents = [saRun("ag-p10a"), saRun("ag-p10b", { status: "completed" })]
  await saTickAt(st, T0 + 4 * SA_MIN)
  const u = p5Out(st, "sub", "nudge_undelivered")
  expect(u.map((x: any) => x.by), "терминальный статус -- ушёл на ближайшем тике").toEqual(["agent-gone"])
  expect(SA.probeQueueSnapshot()["ag-p10b"], "очередь снята").toBe(undefined)
})

test("p531 T11: вытеснение -- не больше 5 на агента, старейшая запись nudge_dropped", async () => {
  const T0 = 902_000_000
  const st = p5$("t11", T0, '[probe.note]\non = ["Notification"]\nact = "nudge"\n', { answers: ["BLOCK: n1", "BLOCK: n2", "BLOCK: n3", "BLOCK: n4", "BLOCK: n5", "BLOCK: n6"] })
  await saStart(st)
  for (let k = 1; k <= 6; k++) await p5Classic(st, "Notification", { message: "m" + k }, T0 + k * 1000)
  expect(SA.NUDGE_QUEUE_MAX).toBe(5)
  expect(p5Q("")).toEqual(["[note] n2", "[note] n3", "[note] n4", "[note] n5", "[note] n6"])
  const dr = p5Out(st, "note", "nudge_dropped")
  expect(dr.length).toBe(1)
  expect(dr[0].text).toBe("[note] n1")
})

test("p531 T12: частота filtered -- одна строка на (проба, класс by) за cooldown_min", async () => {
  const T0 = 902_100_000
  const st = p5$("t12", T0, "[probe.idle-watch]\n" + P5_IDLE.replace("window_min = 30", "window_min = 60"), { idle: "1" })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p12a" }, { result: "r" }, T0 + SA_MIN)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p12b" }, { result: "r" }, T0 + 2 * SA_MIN)
  expect(p5Out(st, "idle-watch", "filtered").length, "внутри окна -- одна").toBe(1)
  await p5Call(st, { tool: "Agent", tool_use_id: "tu-p12c", subagent_type: "x", prompt: "p" }, { result: "r" }, T0 + 3 * SA_MIN)
  expect(p5Out(st, "idle-watch", "filtered").map((r: any) => r.by), "другой класс by -- своя строка").toEqual(["window-not-filled", "window-count:1"])
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p12d" }, { result: "r" }, T0 + 32 * SA_MIN)
  expect(p5Out(st, "idle-watch", "filtered").length, "класс window-count сказан 29 мин назад -- молчит").toBe(2)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-p12e" }, { result: "r" }, T0 + 34 * SA_MIN)
  expect(p5Out(st, "idle-watch", "filtered").map((r: any) => r.by), "cooldown_min прошёл -- вторая строка класса").toEqual(["window-not-filled", "window-count:1", "window-count:1"])
})

test("p531 T13: быстрый путь classic -- без слушателя next(e) синхронно, $ не тронут; подписки = константа без трёх", async () => {
  const T0 = 902_200_000
  const st = p5$("t13", T0, '[probe.other]\non = ["Stop"]\n')
  await saStart(st)
  const subs = subs393()
  const reg = subs.filter(s => String(s.ev).indexOf("classic.") === 0).map(s => String(s.ev).slice(8)).sort()
  const all: string[] = Array.from(SA.CLASSIC_EVENTS as string[])
  expect(all.length).toBe(33)
  expect(reg).toEqual(all.filter(n => n !== "PreToolUse" && n !== "PostToolUse" && n !== "MessageDisplay").sort())
  const trap = new Proxy({}, { get(_t: any, k: any) { throw new Error("$ touched: " + String(k)) } })
  const sentinel = { sentinel: true }
  const out = hook393(subs, "classic.SubagentStop")(trap, { hook_event_name: "SubagentStop" }, (_e: any) => sentinel)
  expect(out, "синхронно, без await").toBe(sentinel)
})

test("p531 T14a: main-only проба на событии агента -- filtered not-main, консультации нет", async () => {
  const T0 = 902_300_000
  const st = p5$("t14a", T0, '[probe.mainonly]\non = ["SubagentStop", "Stop"]\n', { answers: ["OK: fine"] })
  await saStart(st)
  await p5Classic(st, "SubagentStop", { agent_id: "ag-p14" }, T0 + SA_MIN)
  expect(st.calls.length).toBe(0)
  expect(p5Out(st, "mainonly", "filtered").map((r: any) => r.by)).toEqual(["not-main"])
})

test("p531 T14b: main-only проба на tool.call агента -- счёт без часов, строка not-main на тике", async () => {
  const T0 = 902_400_000
  const st = p5$("t14b", T0, '[probe.mainpre]\non = ["PreToolUse"]\n\n[probe.mainpre.when]\nfield = "tool"\nequals = "Nope"\n')
  await saStart(st)
  const c0 = st.clockReads
  await p5Call(st, { agentId: "ag-p14b", tool: "Read", tool_use_id: "tu-p14b" }, { result: "r" }, T0 + SA_MIN)
  expect(st.clockReads - c0, "путь агента часов не читает").toBe(0)
  expect(p5Out(st, "mainpre", "filtered").length).toBe(0)
  await saTickAt(st, T0 + 2 * SA_MIN)
  const f = p5Out(st, "mainpre", "filtered")
  expect(f.map((r: any) => r.by)).toEqual(["not-main"])
  expect(f[0].n).toBe(1)
})

test("p531 T15: проба subagents = true на tool.call агента консультирует с agent_id", async () => {
  const T0 = 902_500_000
  const st = p5$("t15", T0, '[probe.subtool]\nsubagents = true\non = ["PreToolUse"]\n\n[probe.subtool.when]\nfield = "agent_id"\nequals = "ag-p15"\n', { answers: ["OK: fine"] })
  st.agents = [saRun("ag-p15")]
  await saStart(st)
  const r = await p5Call(st, { agentId: "ag-p15", tool: "Read", tool_use_id: "tu-p15" }, { result: "r" }, T0 + SA_MIN)
  expect(r).toEqual({ result: "r" })
  expect(st.calls.length).toBe(1)
  expect(saSnap()["ag-p15"], "учёт активности агента сохранён").toBeDefined()
})

// --- #531 FIX1: окно кэпа, cooldown всех проб, remote_agent, индекс до сборки, предел очередей, срок submit ---
function p5Ok(n: number, v: string = "OK: fine"): string[] {
  return Array.from({ length: n }, () => v)
}

function p5By(st: any, probe: string): string[] {
  return p5Out(st, probe, "filtered").map((r: any) => String(r.by))
}

test("p531 F1 T16a: кэп -- девятая консультация внутри часа -- filtered consult-cap на обоих путях, кэп общий", async () => {
  const T0 = 903_000_000
  const st = p5$("f16a", T0, '[probe.capa]\non = ["PreToolUse"]\n\n[probe.capb]\non = ["Notification"]\n', { answers: p5Ok(9) })
  await saStart(st)
  for (let k = 1; k <= 8; k++) await p5Call(st, { tool: "Read", tool_use_id: "tu-f16a-" + k }, { result: "r" }, T0 + k * SA_MIN)
  expect(st.calls.length, "восемь консультаций").toBe(8)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f16a-9" }, { result: "r" }, T0 + 9 * SA_MIN)
  expect(st.calls.length, "девятая внутри часа -- нет").toBe(8)
  expect(p5By(st, "capa")).toEqual(["consult-cap"])
  await p5Classic(st, "Notification", { message: "m" }, T0 + 10 * SA_MIN)
  expect(st.calls.length, "кэп общий -- classic-путь тоже упирается").toBe(8)
  expect(p5By(st, "capb")).toEqual(["consult-cap"])
})

test("p531 F1 T16b: окно кэпа скользит -- отметки старше 60 мин выходят, консультация снова идёт", async () => {
  const T0 = 903_100_000
  const st = p5$("f16b", T0, '[probe.capa]\non = ["PreToolUse"]\n\n[probe.capb]\non = ["Notification"]\n', { answers: p5Ok(10) })
  await saStart(st)
  for (let k = 1; k <= 8; k++) await p5Call(st, { tool: "Read", tool_use_id: "tu-f16b-" + k }, { result: "r" }, T0 + k * SA_MIN)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f16b-9" }, { result: "r" }, T0 + 61 * SA_MIN - 1)
  expect(st.calls.length, "первая отметка ещё в окне").toBe(8)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f16b-10" }, { result: "r" }, T0 + 61 * SA_MIN)
  expect(st.calls.length, "первая отметка вышла -- консультация").toBe(9)
  await p5Classic(st, "Notification", { message: "m" }, T0 + 62 * SA_MIN)
  expect(st.calls.length, "вторая вышла -- classic-путь консультирует").toBe(10)
})

test("p531 F1 T16c: idle-watch на таймере -- 20 консультаций раз в 30 мин за 10 часов, все прошли", async () => {
  const T0 = 903_200_000
  const st = p5$("f16c", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: p5Ok(20, "SILENT: quiet") })
  await saStart(st)
  for (let k = 1; k <= 20; k++) await saTickAt(st, T0 + k * 30 * SA_MIN)
  expect(st.calls.length, "пожизненной немоты нет").toBe(20)
  expect(p5By(st, "idle-watch").filter((b) => b === "consult-cap")).toEqual([])
})

test("p531 F1 T16d: число в сторе кэпа (прежняя форма) -- отметки времени чтения, выходят через 60 мин", async () => {
  const T0 = 903_300_000
  const st = p5$("f16d", T0, '[probe.capa]\non = ["PreToolUse"]\n', { answers: p5Ok(1) })
  await saStart(st)
  st.m.store.set("catalyst-probes:sesscap:" + st.sid, 8)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f16d-1" }, { result: "r" }, T0 + SA_MIN)
  expect(st.calls.length, "восемь прежних консультаций -- окно полно").toBe(0)
  expect(p5By(st, "capa")).toEqual(["consult-cap"])
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f16d-2" }, { result: "r" }, T0 + 61 * SA_MIN)
  expect(st.calls.length, "час от чтения -- окно свободно").toBe(1)
})

test("p531 F1 T17a: cooldown_min таблицы -- пользовательская проба на PreToolUse фильтруется cooldown", async () => {
  const T0 = 903_400_000
  const st = p5$("f17a", T0, '[probe.cool]\non = ["PreToolUse"]\ncooldown_min = 10\n', { answers: p5Ok(2) })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f17a-1" }, { result: "r" }, T0 + SA_MIN)
  expect(st.calls.length).toBe(1)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f17a-2" }, { result: "r" }, T0 + 5 * SA_MIN)
  expect(st.calls.length, "внутри cooldown_min").toBe(1)
  expect(p5By(st, "cool")).toEqual(["cooldown"])
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f17a-3" }, { result: "r" }, T0 + 11 * SA_MIN)
  expect(st.calls.length, "cooldown_min прошёл").toBe(2)
})

test("p531 F1 T17b: cooldown_min из [defaults] -- classic-путь фильтруется; 0 в таблице выключает", async () => {
  const T0 = 903_500_000
  const st = p5$("f17b", T0, '[defaults]\ncooldown_min = 10\n\n[probe.dcool]\non = ["Notification"]\n\n[probe.zcool]\non = ["Stop"]\ncooldown_min = 0\n', { answers: p5Ok(4) })
  await saStart(st)
  await p5Classic(st, "Notification", { message: "a" }, T0 + SA_MIN)
  expect(st.calls.length).toBe(1)
  await p5Classic(st, "Notification", { message: "b" }, T0 + 5 * SA_MIN)
  expect(st.calls.length, "cooldown из [defaults]").toBe(1)
  expect(p5By(st, "dcool")).toEqual(["cooldown"])
  await p5Classic(st, "Stop", {}, T0 + 6 * SA_MIN)
  await p5Classic(st, "Stop", {}, T0 + 7 * SA_MIN)
  expect(st.calls.length, "cooldown_min = 0 -- без паузы").toBe(3)
})

test("p531 F1 T3d: cancel-проба с every_min -- every_min снят отметкой cancel-needs-PreToolUse, таймер не оценивает", async () => {
  const T0 = 903_600_000
  const st = p5$("f3d", T0, '[probe.cev]\nact = "cancel"\non = ["PreToolUse"]\nevery_min = 1\n\n[probe.cev.when]\nfield = "tool"\nequals = "Nope"\n')
  await saStart(st)
  const w = await worldFor(st.m.$)
  const p = w.world.probes.find((x: any) => x && x.id === "cev")
  expect(p.everyMs, "таймера у cancel-пробы нет").toBe(0)
  expect(p.on).toEqual(["PreToolUse"])
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f3d" }, { result: "r" }, T0 + SA_MIN)
  expect(p5Out(st, "cev", "on_bad").map((r: any) => r.by)).toEqual(["every_min:cancel-needs-PreToolUse"])
  await saTickAt(st, T0 + 2 * SA_MIN)
  await saTickAt(st, T0 + 3 * SA_MIN)
  expect(st.calls.length).toBe(0)
})

test("p531 F1 T18: live_kinds с remote_agent -- строка live_kinds_unobservable раз на сессию, вид не считается", async () => {
  const T0 = 903_700_000
  const unobs = (s: any) => p5Out(s, "idle-watch", "skip_degraded").filter((r: any) => r.by === "live_kinds_unobservable:remote_agent")
  const st = p5$("f18", T0, "[probe.idle-watch]\n" + P5_IDLE + 'live_kinds = ["local_agent", "remote_agent"]\n', { idle: "1" })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f18a" }, { result: "r" }, T0 + SA_MIN)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f18b" }, { result: "r" }, T0 + 2 * SA_MIN)
  expect(unobs(st).length, "одна строка на сессию").toBe(1)
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f18c" }, { result: "r" }, T0 + 3 * SA_MIN)
  expect(unobs(st).length, "новая сессия -- своя строка").toBe(2)
  const st2 = p5$("f18b", T0, "[probe.idle-watch]\n" + P5_IDLE + 'live_kinds = ["local_agent"]\n', { idle: "1" })
  await saStart(st2)
  await p5Call(st2, { tool: "Read", tool_use_id: "tu-f18d" }, { result: "r" }, T0 + SA_MIN)
  expect(unobs(st2).length, "remote_agent не объявлен -- строки нет").toBe(0)
  const st3 = p5$("f18c", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1" })
  await saStart(st3)
  await p5Call(st3, { tool: "Read", tool_use_id: "tu-f18e" }, { result: "r" }, T0 + SA_MIN)
  expect(unobs(st3).length, "умолчание live_kinds несёт remote_agent").toBe(1)
})

test("p531 F1 T19a: индекс не построен -- classic.SessionStart раньше session.start идёт медленным путём, консультация прошла", async () => {
  const T0 = 903_800_000
  const st = p5$("f19a", T0, '[probe.starter]\non = ["SessionStart"]\n', { answers: p5Ok(2) })
  await clear393()
  expect(typeof SA.probeIndexReset, "дверь сброса индекса").toBe("function")
  SA.probeIndexReset()
  const r = await p5Classic(st, "SessionStart", { source: "startup" }, T0 + 1000)
  expect(r).toEqual({ ok: "SessionStart" })
  expect(st.calls.length, "первое событие не потеряно").toBe(1)
  SA.probeIndexReset()
  await p5Classic(st, "SessionStart", { source: "resume" }, T0 + 2000)
  expect(st.calls.length, "мир из мемо -- индекс достроен из него").toBe(2)
  const trap = new Proxy({}, { get(_t: any, k: any) { throw new Error("$ touched: " + String(k)) } })
  const sentinel = { sentinel: true }
  const out = hook393(subs393(), "classic.SubagentStop")(trap, { hook_event_name: "SubagentStop" }, (_e: any) => sentinel)
  expect(out, "индекс построен -- быстрый путь вернулся").toBe(sentinel)
})

test("p531 F1 T19b: индекс не построен -- tool.call агента идёт медленным путём, проба subagents = true консультирует", async () => {
  const T0 = 903_900_000
  const st = p5$("f19b", T0, '[probe.subpre]\nsubagents = true\non = ["PreToolUse"]\n', { answers: p5Ok(1) })
  st.agents = [saRun("ag-f19b")]
  await clear393()
  expect(typeof SA.probeIndexReset).toBe("function")
  SA.probeIndexReset()
  const r = await p5Call(st, { agentId: "ag-f19b", tool: "Read", tool_use_id: "tu-f19b" }, { result: "r" }, T0 + 1000)
  expect(r).toEqual({ result: "r" })
  expect(st.calls.length).toBe(1)
})

test("p531 F1 T20a: предел очередей агентов -- не больше 64, вытесняется самая старая с nudge_dropped queue-cap", async () => {
  const T0 = 904_000_000
  const st = p5$("f20a", T0, '[probe.sub]\nsubagents = true\non = ["SubagentStop"]\nact = "nudge"\n', { answers: p5Ok(65, "BLOCK: w") })
  await saStart(st)
  for (let k = 0; k <= 64; k++) await p5Classic(st, "SubagentStop", { agent_id: "ag-f20-" + k }, T0 + (k + 1) * 8 * SA_MIN)
  expect(SA.NUDGE_AGENT_QUEUES_MAX).toBe(64)
  const snap = SA.probeQueueSnapshot()
  const keys = Object.keys(snap).filter((k) => k)
  expect(keys.length).toBe(64)
  expect(snap["ag-f20-0"], "самая старая снята").toBe(undefined)
  expect(snap["ag-f20-64"].map((i: any) => i.text)).toEqual(["[sub] w"])
  const dr = p5Out(st, "sub", "nudge_dropped")
  expect(dr.map((r: any) => [r.by, r.agent])).toEqual([["queue-cap", "ag-f20-0"]])
})

test("p531 F1 T20b: агент вне agent.list меньше 10 мин -- очередь жива; 10 мин подряд -- agent-gone", async () => {
  const T0 = 904_100_000
  const st = p5$("f20b", T0, '[probe.sub]\nsubagents = true\non = ["SubagentStop"]\nact = "nudge"\n', { answers: p5Ok(1, "BLOCK: w") })
  st.agents = [saRun("ag-f20b")]
  await saStart(st)
  await p5Classic(st, "SubagentStop", { agent_id: "ag-f20b" }, T0 + SA_MIN)
  st.agents = []
  await saTickAt(st, T0 + 2 * SA_MIN)
  await saTickAt(st, T0 + 11 * SA_MIN)
  expect(p5Out(st, "sub", "nudge_undelivered").length, "9 мин вне списка -- не ушёл").toBe(0)
  st.agents = [saRun("ag-f20b")]
  await saTickAt(st, T0 + 12 * SA_MIN)
  st.agents = []
  await saTickAt(st, T0 + 13 * SA_MIN)
  await saTickAt(st, T0 + 23 * SA_MIN - 1)
  expect(p5Out(st, "sub", "nudge_undelivered").length, "появление сбросило отсчёт").toBe(0)
  expect(p5Q("ag-f20b")).toEqual(["[sub] w"])
  await saTickAt(st, T0 + 23 * SA_MIN)
  expect(p5Out(st, "sub", "nudge_undelivered").map((r: any) => r.by)).toEqual(["agent-gone"])
  expect(SA.probeQueueSnapshot()["ag-f20b"]).toBe(undefined)
})

function p5After(st: any): any[] {
  return st.m.afterCbs.filter((a: any) => a.ms === 60_000 && !a.cancelled)
}

test("p531 F1b T21a: submit в полёте -- за 3 тика ровно один submit, context текст не несёт, submit-timeout одной строкой", async () => {
  const T0 = 904_200_000
  const st = p5$("f21a", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go"], submitDefer: true })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f21a1" }, { result: "r" }, T0 + 31 * SA_MIN)
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(st.submits.length).toBe(1)
  const h = p5After(st)
  expect(h.length, "submit ограничен сроком 60 с").toBe(1)
  h[0].cb()
  await settle393()
  expect(p5Out(st, "idle-watch", "nudge_undelivered").map((r: any) => r.by)).toEqual(["submit-timeout"])
  for (let k = 33; k <= 35; k++) await saTickAt(st, T0 + k * SA_MIN)
  expect(st.submits.length, "запись в полёте -- повторного submit нет").toBe(1)
  const r = await p5Call(st, { tool: "Read", tool_use_id: "tu-f21a2" }, { result: "r" }, T0 + 36 * SA_MIN)
  expect(r, "канал (а) запись в полёте не отдаёт").toEqual({ result: "r" })
  expect(p5Q(""), "запись в полёте занимает место в очереди").toEqual(["[idle-watch] go"])
  expect(p5Out(st, "idle-watch", "nudge_undelivered").length, "submit-timeout -- одна строка на запись").toBe(1)
  expect(p5Out(st, "idle-watch", "nudge_delivered").length).toBe(0)
})

test("p531 F1b T21b: поздний успех submit -- одна строка nudge_delivered, текст больше нигде не всплывает", async () => {
  const T0 = 904_300_000
  const st = p5$("f21b", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go"], submitDefer: true })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f21b1" }, { result: "r" }, T0 + 31 * SA_MIN)
  await saTickAt(st, T0 + 32 * SA_MIN)
  const h = p5After(st)
  expect(h.length).toBe(1)
  h[0].cb()
  await settle393()
  await saTickAt(st, T0 + 33 * SA_MIN)
  st.submitDefers[0].resolve({})
  await settle393()
  expect(p5Q(""), "поздний успех -- запись снята").toEqual([])
  expect(p5Out(st, "idle-watch", "nudge_delivered").map((r: any) => [r.channel, r.late])).toEqual([["submit", true]])
  for (let k = 34; k <= 35; k++) await saTickAt(st, T0 + k * SA_MIN)
  expect(st.submits.length, "повтора нет").toBe(1)
  const r = await p5Call(st, { tool: "Read", tool_use_id: "tu-f21b2" }, { result: "r" }, T0 + 36 * SA_MIN)
  expect(r, "канал (а) дубля не несёт").toEqual({ result: "r" })
  expect(p5Out(st, "idle-watch", "nudge_delivered").length).toBe(1)
})

test("p531 F1b T21c: поздний отказ submit -- запись снята с полёта, следующий tool.call отдаёт её через context ровно один раз", async () => {
  const T0 = 904_320_000
  const st = p5$("f21c", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", answers: ["NUDGE: go"], submitDefer: true })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f21c1" }, { result: "r" }, T0 + 31 * SA_MIN)
  await saTickAt(st, T0 + 32 * SA_MIN)
  const h = p5After(st)
  expect(h.length).toBe(1)
  h[0].cb()
  await settle393()
  st.submitDefers[0].reject(new Error("prompt.submit: late refusal"))
  await settle393()
  expect(p5Out(st, "idle-watch", "nudge_undelivered").map((r: any) => r.by)).toEqual(["submit-timeout", "submit-failed"])
  const r1 = await p5Call(st, { tool: "Read", tool_use_id: "tu-f21c2" }, { result: "r" }, T0 + 32 * SA_MIN + 30_000)
  expect(r1.context, "поздний отказ -- текст ушёл через context").toEqual(["[idle-watch] go"])
  const r2 = await p5Call(st, { tool: "Read", tool_use_id: "tu-f21c3" }, { result: "r" }, T0 + 32 * SA_MIN + 40_000)
  expect(r2, "ровно один раз").toEqual({ result: "r" })
  await saTickAt(st, T0 + 34 * SA_MIN)
  expect(st.submits.length, "канал (б) дубля не шлёт").toBe(1)
  expect(p5Out(st, "idle-watch", "nudge_delivered").map((r: any) => r.channel)).toEqual(["context"])
})

test("p531 F1b T21d: отказ submit -- запись возвращается в голову очереди, запись в полёте остаётся и каналом (а) не отдаётся", async () => {
  const T0 = 904_350_000
  const st = p5$("f21d", T0, '[probe.note]\non = ["Notification"]\nact = "nudge"\n', { answers: ["BLOCK: a", "BLOCK: b"], submitDefer: true })
  await saStart(st)
  await p5Classic(st, "Notification", { message: "a" }, T0 + 1000)
  await saTickAt(st, T0 + 2 * SA_MIN)
  expect(st.submits.map((s: any) => s.text)).toEqual(["[note] a"])
  await p5Classic(st, "Notification", { message: "b" }, T0 + 3 * SA_MIN)
  await saTickAt(st, T0 + 5 * SA_MIN)
  expect(st.submits.map((s: any) => s.text), "a в полёте -- уходит только b").toEqual(["[note] a", "[note] b"])
  st.submitDefers[1].reject(new Error("prompt.submit: scripted refusal"))
  await settle393()
  expect(p5Q(""), "отказ b -- в голову, a в полёте на месте").toEqual(["[note] b", "[note] a"])
  const r = await p5Call(st, { tool: "Read", tool_use_id: "tu-f21d" }, { result: "r" }, T0 + 5 * SA_MIN + 1000)
  expect(r.context, "канал (а) отдаёт только запись не в полёте").toEqual(["[note] b"])
  expect(p5Q("")).toEqual(["[note] a"])
})

test("p531 F1b T22a: сигнал #530 в полёте -- за 3 тика после cooldown один submit, TIMEOUT одной строкой", async () => {
  const T0 = 904_400_000
  const st = sa$("f22a", T0, { submitDefer: true, cfg: "cooldown_min = 1\n" })
  st.agents = [saRun("ag-f22a")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length).toBe(1)
  const h = p5After(st)
  expect(h.length, "submit ограничен сроком 60 с").toBe(1)
  h[0].cb()
  await settle393()
  for (let k = 32; k <= 34; k++) await saTickAt(st, T0 + k * SA_MIN)
  expect(st.submits.length, "сигнал в полёте -- второго нет").toBe(1)
  const to = shards393(st.m.writes, "/idle-watch/journal.jsonl.shard.").filter((r: any) => r.kind === "STALE_AGENTS_SUBMIT_TIMEOUT")
  expect(to.length).toBe(1)
})

test("p531 F1b T22c: поздний отказ сигнала #530 -- повтор на следующем тике", async () => {
  const T0 = 904_550_000
  const st = sa$("f22c", T0, { submitDefer: true })
  st.agents = [saRun("ag-f22c")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  const h = p5After(st)
  expect(h.length).toBe(1)
  h[0].cb()
  await settle393()
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(st.submits.length, "в полёте -- повтора нет").toBe(1)
  st.submitDefers[0].reject(new Error("prompt.submit: late refusal"))
  await settle393()
  await saTickAt(st, T0 + 33 * SA_MIN)
  expect(st.submits.length, "поздний отказ -- повтор на следующем тике").toBe(2)
})

test("p531 F1 T22b: срок submit #530 -- поздний ответ после истечения возвращает окно, повтора нет", async () => {
  const T0 = 904_500_000
  const st = sa$("f22b", T0, { submitDefer: true })
  st.agents = [saRun("ag-f22b")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  const h = p5After(st)
  expect(h.length).toBe(1)
  h[0].cb()
  await settle393()
  st.submitDefers[0].resolve({})
  await settle393()
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(st.submits.length, "поздний ответ -- повтора нет").toBe(1)
  await saTickAt(st, T0 + 62 * SA_MIN)
  expect(st.submits.length, "окно cooldown_min от сигнала истекло -- следующий сигнал").toBe(2)
})

test("p531 F1 T23: idle-watch -- every_min перекрывает live_recheck_ms", async () => {
  const T0 = 904_600_000
  const st = p5$("f23", T0, "[probe.idle-watch]\n" + P5_IDLE.replace("cooldown_min = 30", "cooldown_min = 0") + "every_min = 5\nlive_recheck_ms = 60000\nstale_agent_min = 1000\n", { idle: "1", answers: ["NUDGE: every-go"] })
  st.agents = [saRun("ag-f23")]
  await saStart(st)
  for (let k = 31; k <= 35; k++) await saTickAt(st, T0 + k * SA_MIN)
  expect(p5By(st, "idle-watch"), "оценка на +31, минутный live_recheck_ms не действует").toEqual(["live-work:1"])
  await saTickAt(st, T0 + 36 * SA_MIN)
  expect(p5By(st, "idle-watch"), "через every_min -- вторая оценка").toEqual(["live-work:1", "live-work:1"])
  st.agents = []
  for (let k = 37; k <= 40; k++) await saTickAt(st, T0 + k * SA_MIN)
  expect(st.calls.length, "до every_min от прошлой оценки -- нет").toBe(0)
  await saTickAt(st, T0 + 41 * SA_MIN)
  expect(st.calls.length, "every_min прошёл -- таймер консультирует").toBe(1)
})

test("p531 F1b T24: пять записей в полёте + новая -- queue-cap без вытеснения летящей; иначе вытесняется старейшая не в полёте", async () => {
  const T0 = 904_700_000
  const st = p5$("f24", T0, '[probe.note]\non = ["Notification"]\nact = "nudge"\n', { answers: ["BLOCK: n1", "BLOCK: n2", "BLOCK: n3", "BLOCK: n4", "BLOCK: n5", "BLOCK: n6", "BLOCK: n7"], submitDefer: true })
  await saStart(st)
  for (let k = 1; k <= 4; k++) await p5Classic(st, "Notification", { message: "m" + k }, T0 + k * 1000)
  await saTickAt(st, T0 + 2 * SA_MIN)
  expect(st.submits.length, "четыре записи в полёте").toBe(4)
  await p5Classic(st, "Notification", { message: "m5" }, T0 + 3 * SA_MIN)
  await p5Classic(st, "Notification", { message: "m6" }, T0 + 3 * SA_MIN + 1000)
  expect(p5Q(""), "вытеснена старейшая не в полёте").toEqual(["[note] n1", "[note] n2", "[note] n3", "[note] n4", "[note] n6"])
  expect(p5Out(st, "note", "nudge_dropped").map((r: any) => [r.by, r.text])).toEqual([["queue-max", "[note] n5"]])
  await saTickAt(st, T0 + 5 * SA_MIN)
  expect(st.submits.length, "пятая в полёте").toBe(5)
  await p5Classic(st, "Notification", { message: "m7" }, T0 + 6 * SA_MIN)
  expect(p5Q(""), "все пять в полёте -- новая не встала").toEqual(["[note] n1", "[note] n2", "[note] n3", "[note] n4", "[note] n6"])
  expect(p5Out(st, "note", "nudge_dropped").map((r: any) => [r.by, r.text])).toEqual([["queue-max", "[note] n5"], ["queue-cap", "[note] n7"]])
})

test("p531 F1b T25: терминальный агент -- agent-gone на ближайшем тике; отсутствующий в списке ждёт 10 мин", async () => {
  const T0 = 904_800_000
  const st = p5$("f25", T0, '[probe.sub]\nsubagents = true\non = ["SubagentStop"]\nact = "nudge"\n', { answers: ["BLOCK: t", "BLOCK: a"] })
  st.agents = [saRun("ag-f25t"), saRun("ag-f25a")]
  await saStart(st)
  await p5Classic(st, "SubagentStop", { agent_id: "ag-f25t" }, T0 + SA_MIN)
  await p5Classic(st, "SubagentStop", { agent_id: "ag-f25a" }, T0 + SA_MIN + 1000)
  st.agents = [saRun("ag-f25t", { status: "completed" })]
  await saTickAt(st, T0 + 2 * SA_MIN)
  expect(p5Out(st, "sub", "nudge_undelivered").map((r: any) => [r.by, r.agent]), "терминальный -- сразу, отсутствующий -- ещё нет").toEqual([["agent-gone", "ag-f25t"]])
  expect(p5Q("ag-f25t")).toEqual([])
  expect(p5Q("ag-f25a")).toEqual(["[sub] a"])
  await saTickAt(st, T0 + 12 * SA_MIN)
  expect(p5Out(st, "sub", "nudge_undelivered").map((r: any) => r.agent)).toEqual(["ag-f25t", "ag-f25a"])
})

// --- #530 + #531 FIX2: drop, эпоха после next, поздняя перепроверка cooldown, память, частота строк ---
const P5_NOTE = '[probe.note]\non = ["Notification"]\nact = "nudge"\n'

// CONSTRAINT: /clear зовётся с $ зуба: строки, которые сброс эпохи пишет в
// журнал, ложатся в записи этого стенда (clear393 держит свой стенд).
async function p5Clear(st: any): Promise<void> {
  const cl = subs393().filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)
  await cl[0].fn(st.m.$, { command: "clear", args: "" }, async (e: any) => e)
  await settle393()
}

function p5Stale(st: any, kind: string): any[] {
  return shards393(st.m.writes, "/idle-watch/journal.jsonl.shard.").filter((r: any) => r.kind === kind)
}

test("p531 F2 T26a: submit разрешился { drop } в срок -- запись снята, nudge_undelivered by drop с reason, повтора нет", async () => {
  const T0 = 905_000_000
  const st = p5$("f26a", T0, P5_NOTE, { answers: ["BLOCK: a"], submitDefer: true })
  await saStart(st)
  await p5Classic(st, "Notification", { message: "a" }, T0 + 1000)
  await saTickAt(st, T0 + 2 * SA_MIN)
  expect(st.submits.length).toBe(1)
  st.submitDefers[0].resolve({ drop: "hook refused f26a" })
  await settle393()
  expect(p5Out(st, "note", "nudge_delivered"), "drop -- не доставка").toEqual([])
  expect(p5Out(st, "note", "nudge_undelivered").map((r: any) => [r.by, r.reason, r.late === true])).toEqual([["drop", "hook refused f26a", false]])
  expect(p5Q(""), "drop -- запись снята").toEqual([])
  await saTickAt(st, T0 + 4 * SA_MIN)
  expect(st.submits.length, "отказ хука -- решение, повтора нет").toBe(1)
})

test("p531 F2 T26b: поздний { drop } после submit-timeout -- та же строка с late, запись снята", async () => {
  const T0 = 905_100_000
  const st = p5$("f26b", T0, P5_NOTE, { answers: ["BLOCK: a"], submitDefer: true })
  await saStart(st)
  await p5Classic(st, "Notification", { message: "a" }, T0 + 1000)
  await saTickAt(st, T0 + 2 * SA_MIN)
  const h = p5After(st)
  expect(h.length).toBe(1)
  h[0].cb()
  await settle393()
  st.submitDefers[0].resolve({ drop: "late f26b" })
  await settle393()
  expect(p5Out(st, "note", "nudge_delivered"), "поздний drop -- не доставка").toEqual([])
  expect(p5Out(st, "note", "nudge_undelivered").map((r: any) => [r.by, r.reason, r.late === true])).toEqual([["submit-timeout", undefined, false], ["drop", "late f26b", true]])
  expect(p5Q("")).toEqual([])
  await saTickAt(st, T0 + 4 * SA_MIN)
  expect(st.submits.length).toBe(1)
})

test("p531 F2 T26c: сигнал #530 разрешился { drop } в срок -- строка отказа с reason, полёт снят, окно -- как у отказа", async () => {
  const T0 = 905_200_000
  const st = sa$("f26c", T0, { submitDefer: true })
  st.agents = [saRun("ag-f26c")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length).toBe(1)
  st.submitDefers[0].resolve({ drop: "hook refused f26c" })
  await settle393()
  expect(p5Stale(st, "STALE_AGENTS_SUBMIT_ERR").map((r: any) => [r.by, r.reason, r.late === true])).toEqual([["drop", "hook refused f26c", false]])
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(st.submits.length, "внутри cooldown повтора нет").toBe(1)
  await saTickAt(st, T0 + 62 * SA_MIN)
  expect(st.submits.length, "полёт снят -- после cooldown сигнал снова").toBe(2)
})

test("p531 F2 T26d: поздний { drop } сигнала #530 -- строка отказа late с reason, окно открыто, повтор на следующем тике", async () => {
  const T0 = 905_300_000
  const st = sa$("f26d", T0, { submitDefer: true })
  st.agents = [saRun("ag-f26d")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  const h = p5After(st)
  expect(h.length).toBe(1)
  h[0].cb()
  await settle393()
  st.submitDefers[0].resolve({ drop: "late f26d" })
  await settle393()
  expect(p5Stale(st, "STALE_AGENTS_SUBMIT_ERR").map((r: any) => [r.by, r.reason, r.late === true])).toEqual([["drop", "late f26d", true]])
  await saTickAt(st, T0 + 32 * SA_MIN)
  expect(st.submits.length, "поздний drop -- повтор на следующем тике").toBe(2)
})

test("p531 F2 T27a: инструмент A висит на next, /clear, подсказка B -- завершение A очередь B не трогает", async () => {
  const T0 = 905_400_000
  const st = p5$("f27a", T0, P5_NOTE, { answers: ["BLOCK: a", "BLOCK: b"] })
  await saStart(st)
  await p5Classic(st, "Notification", { message: "a" }, T0 + 1000)
  expect(p5Q("")).toEqual(["[note] a"])
  let rel: any = null
  st.m.setNow(T0 + 2000)
  const call = hook393(subs393(), "tool.call")(st.m.$, { tool: "Read", tool_use_id: "tu-f27a" }, () => new Promise((r) => { rel = r }))
  await settle393()
  expect(typeof rel, "вызов A дошёл до next").toBe("function")
  await p5Clear(st)
  await p5Classic(st, "Notification", { message: "b" }, T0 + 3000)
  expect(p5Q("")).toEqual(["[note] b"])
  rel({ result: "r-a" })
  const res = await call
  await settle393()
  expect(res, "результат A без текста B").toEqual({ result: "r-a" })
  expect(p5Q(""), "очередь B цела").toEqual(["[note] b"])
  expect(p5Out(st, "note", "nudge_delivered").filter((r: any) => r.channel === "context")).toEqual([])
})

test("p531 F2 T27b: tool.call агента быстрым путём висит на next, /clear, подсказка агенту в B -- завершение очередь B не трогает", async () => {
  const T0 = 905_500_000
  const st = p5$("f27b", T0, '[probe.sub]\nsubagents = true\non = ["SubagentStop"]\nact = "nudge"\n', { answers: ["BLOCK: w"] })
  st.agents = [saRun("ag-f27b")]
  await saStart(st)
  let rel: any = null
  st.m.setNow(T0 + 1000)
  const call = hook393(subs393(), "tool.call")(st.m.$, { agentId: "ag-f27b", tool: "Read", tool_use_id: "tu-f27b" }, () => new Promise((r) => { rel = r }))
  await settle393()
  expect(typeof rel, "вызов агента дошёл до next").toBe("function")
  await p5Clear(st)
  await p5Classic(st, "SubagentStop", { agent_id: "ag-f27b" }, T0 + 2000)
  expect(p5Q("ag-f27b")).toEqual(["[sub] w"])
  rel({ result: "r-ag" })
  const res = await call
  await settle393()
  expect(res, "результат прежней эпохи без текста B").toEqual({ result: "r-ag" })
  expect(p5Q("ag-f27b"), "очередь агента в B цела").toEqual(["[sub] w"])
  expect(p5Out(st, "sub", "nudge_delivered")).toEqual([])
})

test("p531 F2 T28a: два classic.Notification одновременно прошли раннюю проверку cooldown -- консультация одна, вторая filtered cooldown", async () => {
  const T0 = 905_600_000
  const st = p5$("f28a", T0, '[probe.cool]\non = ["Notification"]\ncooldown_min = 10\n', { answers: p5Ok(2) })
  await saStart(st)
  const g0 = st.m.$.store.get
  const held: Array<() => void> = []
  let hold = true
  st.m.$.store.get = async (k: string) => {
    if (hold && String(k).indexOf("catalyst-probes:sesscap:") === 0) await new Promise<void>((r) => { held.push(r) })
    return g0(k)
  }
  st.m.setNow(T0 + SA_MIN)
  const ev = { hook_event_name: "Notification", session_id: st.sid, message: "m" }
  const h = hook393(subs393(), "classic.Notification")
  const a = h(st.m.$, ev, async () => ({ ok: "a" }))
  const b = h(st.m.$, ev, async () => ({ ok: "b" }))
  for (let i = 0; i < 50 && held.length < 2; i++) await settle393()
  expect(held.length, "обе оценки прошли раннюю проверку").toBe(2)
  hold = false
  for (const r of held) r()
  await a
  await b
  await settle393()
  expect(st.calls.length, "консультация одна").toBe(1)
  expect(p5By(st, "cool")).toEqual(["cooldown"])
})

test("p531 F2 T28b: таймер idle-watch и tool.call пересеклись после ранней проверки -- консультация одна", async () => {
  const T0 = 905_700_000
  const st = p5$("f28b", T0, "[probe.idle-watch]\n" + P5_IDLE + "live_recheck_ms = 60000\nstale_agent_min = 1000\n", { idle: "1", answers: ["NUDGE: t", "NUDGE: c"] })
  await saStart(st)
  const g0 = st.m.$.store.get
  const held: Array<() => void> = []
  let hold = true
  st.m.$.store.get = async (k: string) => {
    if (hold && String(k).indexOf("catalyst-probes:sesscap:") === 0) await new Promise<void>((r) => { held.push(r) })
    return g0(k)
  }
  st.m.setNow(T0 + 31 * SA_MIN)
  const tk = st.tick()
  for (let i = 0; i < 50 && held.length < 1; i++) await settle393()
  expect(held.length, "таймер прошёл idleGate и ждёт чтения кэпа").toBe(1)
  hold = false
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f28b" }, { result: "r" })
  expect(st.calls.length, "tool.call консультировал").toBe(1)
  for (const r of held) r()
  await tk
  await settle393()
  expect(st.calls.length, "таймер второй консультации не дал").toBe(1)
  expect(p5By(st, "idle-watch")).toEqual(["cooldown"])
})

test("p531 F2 T29: сигнал #530 в полёте, тик при выключенной пробе, включение -- второго submit нет", async () => {
  const T0 = 905_800_000
  const st = sa$("f29", T0, { submitDefer: true, cfg: "cooldown_min = 1\n" })
  st.agents = [saRun("ag-f29")]
  await saStart(st)
  await saTickAt(st, T0)
  await saTickAt(st, T0 + 31 * SA_MIN)
  expect(st.submits.length).toBe(1)
  st.env.CLAUDE_IDLE = "0"
  await saTickAt(st, T0 + 32 * SA_MIN)
  st.env.CLAUDE_IDLE = "1"
  await saTickAt(st, T0 + 33 * SA_MIN)
  await saTickAt(st, T0 + 64 * SA_MIN)
  expect(st.submits.length, "сигнал в полёте -- второго нет").toBe(1)
  st.submitDefers[0].resolve({})
  await settle393()
  await saTickAt(st, T0 + 65 * SA_MIN)
  expect(st.submits.length, "ответ снял полёт -- следующий сигнал").toBe(2)
})

test("p531 F2 T30: /clear -- каждая снятая запись очереди пишет nudge_dropped session-reset, запись в полёте с fly", async () => {
  const T0 = 905_900_000
  const st = p5$("f30", T0, P5_NOTE, { answers: ["BLOCK: a", "BLOCK: b"], submitDefer: true })
  await saStart(st)
  await p5Classic(st, "Notification", { message: "a" }, T0 + 1000)
  await saTickAt(st, T0 + 2 * SA_MIN)
  await p5Classic(st, "Notification", { message: "b" }, T0 + 3 * SA_MIN)
  expect(SA.probeQueueSnapshot()[""].map((i: any) => [i.text, i.fly])).toEqual([["[note] a", true], ["[note] b", false]])
  await p5Clear(st)
  const dr = p5Out(st, "note", "nudge_dropped")
  expect(dr.map((r: any) => [r.by, r.text, r.fly === true, r.agent, r.sid])).toEqual([
    ["session-reset", "[note] a", true, "main", st.sid],
    ["session-reset", "[note] b", false, "main", st.sid],
  ])
  expect(SA.probeQueueSnapshot()[""]).toBe(undefined)
})

test("p531 F2 T31: число в сторе кэпа -- при первом чтении в стор пишется массив; перезагрузка через 61 мин консультирует", async () => {
  const T0 = 906_000_000
  const st = p5$("f31", T0, '[probe.capa]\non = ["PreToolUse"]\n', { answers: p5Ok(1) })
  await saStart(st)
  const key = "catalyst-probes:sesscap:" + st.sid
  st.m.store.set(key, 8)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f31-1" }, { result: "r" }, T0 + SA_MIN)
  expect(st.calls.length, "восемь прежних консультаций -- окно полно").toBe(0)
  expect(st.m.store.get(key), "число переведено в массив и записано сразу").toEqual(new Array(8).fill(T0 + SA_MIN))
  expect(typeof SA.probeCapStateReset, "дверь перезагрузки состояния кэпа").toBe("function")
  SA.probeCapStateReset()
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f31-2" }, { result: "r" }, T0 + 30 * SA_MIN)
  expect(st.calls.length, "перезагрузка внутри часа -- окно полно по массиву").toBe(0)
  SA.probeCapStateReset()
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f31-3" }, { result: "r" }, T0 + 62 * SA_MIN)
  expect(st.calls.length, "перезагрузка через 61 мин от чтения -- консультация").toBe(1)
})

test("p531 F2 T32: threshold = 300, 300 запусков в окне -- window-count:300, консультации нет", async () => {
  const T0 = 906_100_000
  const st = p5$("f32", T0, '[probe.idle-watch]\nact = "nudge"\nwindow_min = 30\nthreshold = 300\ncooldown_min = 30\nlive_threshold = 1\n', { idle: "1", answers: ["NUDGE: go"] })
  await saStart(st)
  const h = hook393(subs393(), "tool.call")
  for (let k = 0; k < 300; k++) {
    st.m.setNow(T0 + 20 * SA_MIN + k * 1000)
    await h(st.m.$, { tool: "Agent", tool_use_id: "tu-f32-" + k, subagent_type: "x", prompt: "p" }, async () => ({ result: "r" }))
  }
  await settle393()
  expect(st.calls.length).toBe(0)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f32-r" }, { result: "r" }, T0 + 30 * SA_MIN + 1000)
  expect(st.calls.length, "300 запусков в окне -- условие launches < threshold ложно").toBe(0)
  expect(p5By(st, "idle-watch")).toEqual(["window-not-filled", "window-count:300"])
})

test("p531 F2 T33: newSession сбрасывает индекс -- первое classic.SessionStart новой эпохи с новой пробой консультирует", async () => {
  const T0 = 906_200_000
  const st = p5$("f33", T0, '[probe.stopper]\non = ["Stop"]\n', { answers: p5Ok(1) })
  await saStart(st)
  const trap = new Proxy({}, { get(_t: any, k: any) { throw new Error("$ touched: " + String(k)) } })
  const sentinel = { sentinel: true }
  const out = hook393(subs393(), "classic.SessionStart")(trap, { hook_event_name: "SessionStart" }, (_e: any) => sentinel)
  expect(out, "индекс эпохи A без SessionStart -- быстрый путь").toBe(sentinel)
  st.files[st.home + "/probes.toml"] = '[probe.starter]\non = ["SessionStart"]\n'
  await p5Clear(st)
  const r = await p5Classic(st, "SessionStart", { source: "clear" }, T0 + 2000)
  expect(r).toEqual({ ok: "SessionStart" })
  expect(st.calls.length, "первое событие новой эпохи идёт медленным путём").toBe(1)
})

test("p531 F2 T34: filtered live-work:1, затем live-work:2 внутри cooldown -- одна строка класса", async () => {
  const T0 = 906_300_000
  const st = p5$("f34", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1" })
  st.agents = [saRun("ag-f34a")]
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f34a" }, { result: "r" }, T0 + 31 * SA_MIN)
  st.agents = [saRun("ag-f34a"), saRun("ag-f34b")]
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f34b" }, { result: "r" }, T0 + 35 * SA_MIN)
  expect(p5By(st, "idle-watch"), "класс by без числа -- одна строка").toEqual(["live-work:1"])
})

test("p531 F2 T35a: постоянный отказ agent.list, 10 тиков по 60 с, cooldown_min = 30 -- одна строка when_bad", async () => {
  const T0 = 906_400_000
  const st = p5$("f35a", T0, "[probe.idle-watch]\n" + P5_IDLE + "stale_agent_min = 1000\n", { idle: "1", list: () => { throw new Error("agent.list: scripted refusal f35a") } })
  await saStart(st)
  for (let k = 31; k <= 40; k++) await saTickAt(st, T0 + k * SA_MIN)
  expect(p5Out(st, "idle-watch", "when_bad").length).toBe(1)
})

test("p531 F2 T35b: cooldown_min = 0, пять оценок за 10 с -- одна строка filtered и одна when_bad", async () => {
  const T0 = 906_500_000
  const toml = '[probe.wf]\non = ["Notification"]\ncooldown_min = 0\n\n[probe.wf.when]\nfield = "message"\nequals = "never"\n\n' +
    '[probe.wb]\non = ["Notification"]\ncooldown_min = 0\n\n[probe.wb.when]\nfield = "live_works"\nequals = "1"\n'
  const st = p5$("f35b", T0, toml, { list: () => { throw new Error("agent.list: scripted refusal f35b") } })
  await saStart(st)
  for (let k = 0; k < 5; k++) await p5Classic(st, "Notification", { message: "m" + k }, T0 + SA_MIN + k * 2000)
  expect(p5Out(st, "wf", "filtered").map((r: any) => r.by)).toEqual(["when-false"])
  expect(p5Out(st, "wb", "when_bad").length).toBe(1)
})

test("p531 F2 T35c: when_bad на tool.call -- внутри cooldown_min одна строка", async () => {
  const T0 = 906_600_000
  const st = p5$("f35c", T0, "[probe.idle-watch]\n" + P5_IDLE + "live_recheck_ms = 3600000\nstale_agent_min = 1000\n", { idle: "1", list: () => { throw new Error("agent.list: scripted refusal f35c") } })
  await saStart(st)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f35c-1" }, { result: "r" }, T0 + 31 * SA_MIN)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f35c-2" }, { result: "r" }, T0 + 33 * SA_MIN)
  expect(p5Out(st, "idle-watch", "when_bad").length).toBe(1)
})

test("p531 F2 T36: submit-failed несёт late для позднего отказа, в срок -- без late", async () => {
  const T0 = 906_700_000
  const st = p5$("f36", T0, P5_NOTE, { answers: ["BLOCK: a", "BLOCK: b"], submitDefer: true })
  await saStart(st)
  await p5Classic(st, "Notification", { message: "a" }, T0 + 1000)
  await p5Classic(st, "Notification", { message: "b" }, T0 + 1500)
  await saTickAt(st, T0 + 2 * SA_MIN)
  expect(st.submits.map((s: any) => s.text)).toEqual(["[note] a", "[note] b"])
  const h = p5After(st)
  expect(h.length).toBe(2)
  h[0].cb()
  await settle393()
  st.submitDefers[0].reject(new Error("prompt.submit: late refusal f36"))
  st.submitDefers[1].reject(new Error("prompt.submit: refusal f36"))
  await settle393()
  const f = p5Out(st, "note", "nudge_undelivered").filter((r: any) => r.by === "submit-failed")
  expect(f.map((r: any) => [r.text, r.late === true]).sort()).toEqual([["[note] a", true], ["[note] b", false]])
})

test("p531 F2 T37: submit всегда бросает -- после третьего отказа запись снята одной строкой с числом попыток", async () => {
  const T0 = 906_800_000
  const st = p5$("f37", T0, P5_NOTE, { answers: ["BLOCK: a"], submitThrows: true })
  await saStart(st)
  await p5Classic(st, "Notification", { message: "a" }, T0 + 1000)
  for (let k = 2; k <= 4; k++) await saTickAt(st, T0 + k * SA_MIN)
  expect(st.submits.length).toBe(3)
  expect(p5Q(""), "три отказа подряд -- запись снята").toEqual([])
  const gone = p5Out(st, "note", "nudge_undelivered").filter((r: any) => r.attempts !== undefined)
  expect(gone.map((r: any) => [r.by, r.attempts])).toEqual([["submit-failed", 3]])
  await saTickAt(st, T0 + 5 * SA_MIN)
  expect(st.submits.length, "четвёртого submit нет").toBe(3)
})

test("p531 F2 T38a: зеркало кэпа -- смена эпохи снимает ключи прошлой эпохи", async () => {
  const T0 = 906_900_000
  const stA = p5$("f38a1", T0, '[probe.capa]\non = ["PreToolUse"]\n', { answers: p5Ok(1) })
  await saStart(stA)
  await p5Call(stA, { tool: "Read", tool_use_id: "tu-f38a-1" }, { result: "r" }, T0 + SA_MIN)
  const stB = p5$("f38a2", T0, '[probe.capa]\non = ["PreToolUse"]\n', { answers: p5Ok(1) })
  await saStart(stB)
  await p5Call(stB, { tool: "Read", tool_use_id: "tu-f38a-2" }, { result: "r" }, T0 + 2 * SA_MIN)
  expect(stA.calls.length + stB.calls.length).toBe(2)
  await p5Clear(stB)
  expect(typeof SA.probeCapSids, "дверь ключей зеркала кэпа").toBe("function")
  expect(SA.probeCapSids(), "очередь записей дренирована -- ключей прошлой эпохи нет").toEqual([])
})

test("p531 F2 T38b: отказ agent.list -- запись без пометки активности дольше 2× порога снимается", async () => {
  const T0 = 907_000_000
  let mode = "ok"
  const st = sa$("f38b", T0, { cfg: "stale_agent_min = 30\nlive_recheck_ms = 3600000\n", list: () => {
    if (mode === "throw") throw new Error("agent.list: scripted refusal f38b")
    return [saRun("ag-f38b")]
  } })
  await saStart(st)
  await saTickAt(st, T0)
  expect(saSnap()["ag-f38b"]).toBeDefined()
  mode = "throw"
  await saTickAt(st, T0 + 60 * SA_MIN)
  expect(saSnap()["ag-f38b"], "ровно 2× порога -- жива").toBeDefined()
  await saTickAt(st, T0 + 61 * SA_MIN)
  expect(saSnap()["ag-f38b"], "дольше 2× порога без пометки -- снята").toBe(undefined)
})

test("p531 F2 T38c: учёт висящих агентов -- не больше 256 записей, вытесняется самая старая", async () => {
  const T0 = 907_100_000
  const st = sa$("f38c", T0, { idle: "0" })
  await saStart(st)
  const h = hook393(subs393(), "tool.call")
  st.m.setNow(T0 + SA_MIN)
  for (let k = 0; k <= 256; k++) await h(st.m.$, { agentId: "ag-f38c-" + k, tool: "Read", tool_use_id: "tu-f38c-" + k }, async () => ({ result: "r" }))
  const snap = saSnap()
  expect(Object.keys(snap).length).toBe(256)
  expect(snap["ag-f38c-0"], "самая старая вытеснена").toBe(undefined)
  expect(snap["ag-f38c-256"]).toBeDefined()
})

test("p531 F2 T39: две записи кэпа, стор завершает их в обратном порядке -- в сторе обе отметки", async () => {
  const T0 = 907_200_000
  const st = p5$("f39", T0, '[probe.capw]\non = ["PreToolUse"]\n', { answers: p5Ok(2) })
  await saStart(st)
  const key = "catalyst-probes:sesscap:" + st.sid
  const s0 = st.m.$.store.set
  const gate: Array<() => void> = []
  let first = true
  st.m.$.store.set = async (k: string, v: any) => {
    if (String(k) === key && first) {
      first = false
      await new Promise<void>((r) => { gate.push(r) })
    }
    return s0(k, v)
  }
  const h = hook393(subs393(), "tool.call")
  st.m.setNow(T0 + SA_MIN)
  const c1 = h(st.m.$, { tool: "Read", tool_use_id: "tu-f39-1" }, async () => ({ result: "r" }))
  await settle393()
  st.m.setNow(T0 + 2 * SA_MIN)
  const c2 = h(st.m.$, { tool: "Read", tool_use_id: "tu-f39-2" }, async () => ({ result: "r" }))
  await settle393()
  expect(gate.length, "первая запись кэпа ждёт стор").toBe(1)
  gate[0]()
  await c1
  await c2
  await settle393()
  expect(st.m.store.get(key), "итог стора -- обе отметки").toEqual([T0 + SA_MIN, T0 + 2 * SA_MIN])
})

// CONSTRAINT: запись массива кэпа отказана -- в сторе остаётся число; только
// так второе чтение числа в процессе достижимо после записи сразу (Р6).
test("p531 F2 T40: запись кэпа отказана, число осталось в сторе -- второе чтение не датирует его заново", async () => {
  const T0 = 907_300_000
  const pre = "catalyst-probes:sesscap:"
  const st = p5$("f40", T0, '[probe.capl]\non = ["PreToolUse"]\n', { answers: p5Ok(1), fail: { storeSet: (k: string) => k.indexOf(pre) === 0 } })
  await saStart(st)
  const key = pre + st.sid
  st.m.store.set(key, 8)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f40-1" }, { result: "r" }, T0 + SA_MIN)
  expect(st.calls.length, "восемь прежних консультаций -- окно полно").toBe(0)
  expect(st.m.store.get(key), "запись отказана -- в сторе число").toBe(8)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f40-2" }, { result: "r" }, T0 + 62 * SA_MIN)
  expect(st.calls.length, "число прочитано второй раз -- отметки первого чтения вышли, консультация").toBe(1)
})

// CONSTRAINT (#335): отказ носителя живёт после триггера; cooldown -- часть
// триггера (fire = false). Позиционный контроль -- тот же вызов после cooldown.
test("p531 F2 T41: idle-watch с чужим носителем внутри cooldown -- вызов не гасится; после cooldown гасится", async () => {
  const T0 = 907_400_000
  const st = p5$("f41", T0, "[probe.idle-watch]\n" + P5_IDLE, { idle: "1", env: { CLAUDE_IDLE_CARRIER: "patch-f41" } })
  await saStart(st)
  st.m.store.set("catalyst-probes:last:idle-watch:" + st.cwd, T0 + 20 * SA_MIN)
  const refused = (): any[] => shards393(st.m.writes, "/failover/journal.jsonl.shard.").filter((r: any) => r.rec === "carrier-foreign-refused" && r.value === "patch-f41")
  const r1 = await p5Call(st, { tool: "Read", tool_use_id: "tu-f41-1" }, { result: "r" }, T0 + 31 * SA_MIN)
  expect(r1, "внутри cooldown -- вызов проходит").toEqual({ result: "r" })
  expect(refused().length).toBe(0)
  const r2 = await p5Call(st, { tool: "Read", tool_use_id: "tu-f41-2" }, { result: "r" }, T0 + 51 * SA_MIN)
  expect(String(r2 && r2.deny), "cooldown прошёл -- отказ носителя").toContain("CLAUDE_IDLE_CARRIER")
  expect(refused().length).toBe(1)
})

test("p531 F2 T42: пользовательская проба при нечитаемом CLAUDE_PROBES внутри cooldown -- вызов не гасится; после cooldown гасится", async () => {
  const T0 = 907_500_000
  const st = p5$("f42", T0, '[probe.coolu]\non = ["PreToolUse"]\ncooldown_min = 10\n')
  const g0 = st.m.$.env.get
  st.m.$.env.get = async (k: string) => {
    if (k === "CLAUDE_PROBES") throw new Error("env.get: scripted read refusal for " + k)
    return g0(k)
  }
  await saStart(st)
  st.m.store.set("catalyst-probes:last:coolu:" + st.cwd, T0 + SA_MIN)
  const refused = (): any[] => shards393(st.m.writes, "/failover/journal.jsonl.shard.").filter((r: any) => r.rec === "carrier-env-unreadable-refused" && r.probe === "coolu")
  const r1 = await p5Call(st, { tool: "Read", tool_use_id: "tu-f42-1" }, { result: "r" }, T0 + 5 * SA_MIN)
  expect(r1, "внутри cooldown -- вызов проходит").toEqual({ result: "r" })
  expect(refused().length).toBe(0)
  const r2 = await p5Call(st, { tool: "Read", tool_use_id: "tu-f42-2" }, { result: "r" }, T0 + 12 * SA_MIN)
  expect(String(r2 && r2.deny), "cooldown прошёл -- отказ нечитаемой ручки").toContain("CLAUDE_PROBES")
  expect(refused().length).toBe(1)
})

// --- #530 + #531 FIX2b: ранний cooldown без стора кэпа, память кэпа прошлой эпохи, индекс эпохи ---
function p5CapReads(st: any): { n: number } {
  const c = { n: 0 }
  const g0 = st.m.$.store.get
  st.m.$.store.get = async (k: string) => {
    if (String(k).indexOf("catalyst-probes:sesscap:") === 0) c.n++
    return g0(k)
  }
  return c
}

function p5CapGate(st: any, key: string): Array<() => void> {
  const s0 = st.m.$.store.set
  const gate: Array<() => void> = []
  let first = true
  st.m.$.store.set = async (k: string, v: any) => {
    if (String(k) === key && first) {
      first = false
      await new Promise<void>((r) => { gate.push(r) })
    }
    return s0(k, v)
  }
  return gate
}

test("p531 F2b T43: classic-путь внутри cooldown -- стор кэпа не читается", async () => {
  const T0 = 907_600_000
  const st = p5$("f43", T0, '[probe.cev43]\non = ["Notification"]\ncooldown_min = 10\n', { answers: p5Ok(1) })
  await saStart(st)
  const reads = p5CapReads(st)
  await p5Classic(st, "Notification", { message: "a" }, T0 + SA_MIN)
  expect(st.calls.length).toBe(1)
  const r1 = reads.n
  expect(r1, "консультация читает стор кэпа").toBeGreaterThan(0)
  await p5Classic(st, "Notification", { message: "b" }, T0 + 5 * SA_MIN)
  expect(st.calls.length).toBe(1)
  expect(p5By(st, "cev43")).toEqual(["cooldown"])
  expect(reads.n, "ранний cooldown -- стор кэпа не тронут").toBe(r1)
})

test("p531 F2b T44: смена эпохи -- отметка прежнего числа кэпа старого sid снята", async () => {
  const T0 = 907_700_000
  const st = p5$("f44", T0, '[probe.capl44]\non = ["PreToolUse"]\n', { answers: p5Ok(1) })
  await saStart(st)
  st.m.store.set("catalyst-probes:sesscap:" + st.sid, 3)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f44-1" }, { result: "r" }, T0 + SA_MIN)
  expect(typeof SA.probeCapLegacySids, "дверь отметок прежнего числа").toBe("function")
  expect(SA.probeCapLegacySids()).toContain(st.sid)
  expect(SA.probeCapSids()).toContain(st.sid)
  st.m.$.session.id = async () => "sid-f44-new"
  await p5Clear(st)
  expect(SA.probeCapSids(), "ключ зеркала старого sid снят").not.toContain(st.sid)
  expect(SA.probeCapLegacySids(), "отметка прежнего числа старого sid снята").not.toContain(st.sid)
})

test("p531 F2b T45: запись кэпа в очереди, смена эпохи, очередь дренируется -- в сторе итог старого sid, в памяти его нет", async () => {
  const T0 = 907_800_000
  const st = p5$("f45", T0, '[probe.capw45]\non = ["PreToolUse"]\n', { answers: p5Ok(2) })
  await saStart(st)
  const key = "catalyst-probes:sesscap:" + st.sid
  const gate = p5CapGate(st, key)
  const h = hook393(subs393(), "tool.call")
  st.m.setNow(T0 + SA_MIN)
  const c1 = h(st.m.$, { tool: "Read", tool_use_id: "tu-f45-1" }, async () => ({ result: "r" }))
  await settle393()
  st.m.setNow(T0 + 2 * SA_MIN)
  const c2 = h(st.m.$, { tool: "Read", tool_use_id: "tu-f45-2" }, async () => ({ result: "r" }))
  await settle393()
  expect(gate.length, "первая запись кэпа ждёт стор, вторая в очереди").toBe(1)
  st.m.$.session.id = async () => "sid-f45-new"
  await p5Clear(st)
  gate[0]()
  await c1
  await c2
  await settle393()
  expect(st.m.store.get(key), "запись из очереди дошла до стора").toEqual([T0 + SA_MIN, T0 + 2 * SA_MIN])
  expect(SA.probeCapSids(), "после дренажа ключа старого sid нет").not.toContain(st.sid)
})

test("p531 F2b T46: /resume того же sid, новая эпоха взяла кэп до дренажа -- её ключ и запись остаются", async () => {
  const T0 = 907_900_000
  const st = p5$("f46", T0, '[probe.capw46]\non = ["PreToolUse"]\n', { answers: p5Ok(2) })
  await saStart(st)
  const key = "catalyst-probes:sesscap:" + st.sid
  const gate = p5CapGate(st, key)
  const h = hook393(subs393(), "tool.call")
  st.m.setNow(T0 + SA_MIN)
  const c1 = h(st.m.$, { tool: "Read", tool_use_id: "tu-f46-1" }, async () => ({ result: "r" }))
  await settle393()
  expect(gate.length).toBe(1)
  await p5Clear(st)
  st.m.setNow(T0 + 2 * SA_MIN)
  const c2 = h(st.m.$, { tool: "Read", tool_use_id: "tu-f46-2" }, async () => ({ result: "r" }))
  await settle393()
  expect(st.calls.length, "новая эпоха консультирует").toBe(2)
  gate[0]()
  await c1
  await c2
  await settle393()
  expect(st.m.store.get(key), "запись новой эпохи дошла до стора").toEqual([T0 + SA_MIN, T0 + 2 * SA_MIN])
  expect(SA.probeCapSids(), "ключ, тронутый новой эпохой, остаётся").toContain(st.sid)
})

test("p531 F2b T47: /clear, проба стала subagents = true -- вызов агента до сборки мира не считается not-main", async () => {
  const T0 = 908_000_000
  const st = p5$("f47", T0, '[probe.mp47]\non = ["PreToolUse"]\n\n[probe.mp47.when]\nfield = "tool"\nequals = "Nope"\n')
  await saStart(st)
  st.files[st.home + "/probes.toml"] = '[probe.mp47]\nsubagents = true\non = ["PreToolUse"]\n\n[probe.mp47.when]\nfield = "tool"\nequals = "Nope"\n'
  await p5Clear(st)
  await p5Call(st, { agentId: "ag-f47", tool: "Read", tool_use_id: "tu-f47" }, { result: "r" }, T0 + SA_MIN)
  await saTickAt(st, T0 + 2 * SA_MIN)
  expect(p5By(st, "mp47").filter((b) => b === "not-main"), "список main-only прошлой эпохи не считает").toEqual([])
})

// --- #509-FIX7 Р17/Р18: остатки #531 FIX2b ----------------------------------------
test("p531 F7 T48: новая эпоха, первый вызов агента до сборки индекса -- одна строка not-main; тот же tool_use_id быстрым путём второй не даёт", async () => {
  const T0 = 908_100_000
  const st = p5$("f48", T0, '[probe.mp48]\non = ["PreToolUse"]\n\n[probe.mp48.when]\nfield = "tool"\nequals = "Nope"\n')
  await saStart(st)
  await p5Clear(st)
  await p5Call(st, { agentId: "ag-f48", tool: "Read", tool_use_id: "tu-f48" }, { result: "r" }, T0 + SA_MIN)
  await saTickAt(st, T0 + 2 * SA_MIN)
  const nm = (): any[] => p5Out(st, "mp48", "filtered").filter((r: any) => r.by === "not-main")
  expect(nm().map((r: any) => r.n), "медленный путь новой эпохи считает not-main").toEqual([1])
  await p5Call(st, { agentId: "ag-f48", tool: "Read", tool_use_id: "tu-f48" }, { result: "r" }, T0 + 3 * SA_MIN)
  await saTickAt(st, T0 + 40 * SA_MIN)
  expect(nm().map((r: any) => r.n), "тот же вызов быстрым путём -- второй строки нет").toEqual([1])
})

test("p531 F7 T49: отказ записи кэпа старого sid, смена эпохи, /resume того же sid -- прежнее число не датируется заново, отметки на месте", async () => {
  const T0 = 908_200_000
  const pre = "catalyst-probes:sesscap:"
  const st = p5$("f49", T0, '[probe.capu49]\non = ["PreToolUse"]\n', { answers: p5Ok(1), fail: { storeSet: (k: string) => k.indexOf(pre) === 0 } })
  await saStart(st)
  const key = pre + st.sid
  st.m.store.set(key, 8)
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f49-1" }, { result: "r" }, T0 + SA_MIN)
  expect(st.calls.length, "восемь прежних консультаций -- окно полно").toBe(0)
  const rs = subs393().filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("resume") >= 0)
  expect(rs.length).toBe(1)
  await rs[0].fn(st.m.$, { command: "resume", args: "" }, async (e: any) => e)
  await settle393()
  expect({ mirror: SA.probeCapSids().indexOf(st.sid) >= 0, legacy: SA.probeCapLegacySids().indexOf(st.sid) >= 0 }, "неприземлённый ключ прополка не снимает").toEqual({ mirror: true, legacy: true })
  await p5Call(st, { tool: "Read", tool_use_id: "tu-f49-2" }, { result: "r" }, T0 + 62 * SA_MIN)
  expect(st.calls.length, "отметки первого чтения вышли из окна -- консультация; число заново не датировано").toBe(1)
})

test("p531 FIX8 Р5: загрузка мира эпохи A висит, /clear, загрузка A завершилась -- SessionStart эпохи B строит мир B и консультирует", async () => {
  const T0 = 908_300_000
  const st = p5$("f8r5", T0, '[probe.stopper]\non = ["Stop"]\n', { answers: p5Ok(1) })
  await clear393()
  const path = st.home + "/probes.toml"
  const read0 = st.m.$.fs.read
  let hold = true
  let blocked = false
  let open: () => void = () => {}
  const gate = new Promise<void>((r) => { open = r })
  st.m.$.fs.read = async (p: string) => {
    const v = await read0(p)
    if (hold && String(p) === path) { hold = false; blocked = true; await gate }
    return v
  }
  const hA = hook393(subs393(), "classic.Stop")(st.m.$, { hook_event_name: "Stop", session_id: st.sid }, async () => ({ ok: "Stop" }))
  await settle393()
  expect(blocked, "загрузка мира эпохи A встала на чтении probes.toml").toBe(true)
  st.files[path] = '[probe.starter]\non = ["SessionStart"]\n'
  await p5Clear(st)
  open()
  await hA
  await settle393()
  const r = await p5Classic(st, "SessionStart", { source: "clear" }, T0 + 2000)
  expect(r).toEqual({ ok: "SessionStart" })
  expect(st.calls.length, "мир эпохи B загружен, слушатель SessionStart конфигурации B сработал").toBe(1)
})

test("p531 FIX8 Р8: submit разрешился { drop: \"\" } -- не доставка, nudge_undelivered by drop с причиной «(пустая причина)»", async () => {
  const T0 = 908_400_000
  const st = p5$("f8r8", T0, P5_NOTE, { answers: ["BLOCK: a"], submitDefer: true })
  await saStart(st)
  await p5Classic(st, "Notification", { message: "a" }, T0 + 1000)
  await saTickAt(st, T0 + 2 * SA_MIN)
  expect(st.submits.length).toBe(1)
  st.submitDefers[0].resolve({ drop: "" })
  await settle393()
  expect(p5Out(st, "note", "nudge_delivered"), "пустой drop -- текст не вошёл").toEqual([])
  expect(p5Out(st, "note", "nudge_undelivered").map((r: any) => [r.by, r.reason])).toEqual([["drop", "(пустая причина)"]])
  expect(p5Q(""), "drop -- запись снята").toEqual([])
})

test("p531 FIX8 Р9: 65 sid подряд с отказом записи кэпа -- неприземлённых 64, старейший вытеснен строкой session-cap-unlanded-evicted", async () => {
  const T0 = 908_500_000
  const pre = "catalyst-probes:sesscap:"
  const N = 65
  const st = p5$("f8r9", T0, '[probe.capu8]\non = ["PreToolUse"]\n', { answers: p5Ok(N), fail: { storeSet: (k: string) => k.indexOf(pre) === 0 } })
  SA.probeCapStateReset()
  await saStart(st)
  expect(typeof SA.probeCapUnlandedSids, "дверь неприземлённых ключей").toBe("function")
  for (let i = 0; i < N; i++) {
    st.m.$.session.id = async () => "sid-f8r9-" + i
    await p5Clear(st)
    await p5Call(st, { tool: "Read", tool_use_id: "tu-f8r9-" + i }, { result: "r" }, T0 + (i + 1) * 1000)
  }
  await settle393()
  expect(st.calls.length, "каждый sid консультировал и отметил кэп").toBe(N)
  const un = SA.probeCapUnlandedSids()
  expect({ n: un.length, first: un[0], last: un[un.length - 1], evicted: un.indexOf("sid-f8r9-0") }).toEqual({ n: 64, first: "sid-f8r9-1", last: "sid-f8r9-64", evicted: -1 })
  expect(SA.probeCapSids().indexOf("sid-f8r9-0"), "зеркало вытесненного, не тронутое после смены эпохи, снято").toBe(-1)
  const lost = lost8(st.m.writes)["session-cap-unlanded-evicted"]
  expect(lost && { n: lost.n, last: lost.last }, "вытеснение названо").toEqual({ n: 1, last: "sid-f8r9-0" })
  SA.probeCapStateReset()
})

// --- #509-FIX9: терминал под известным сроком, квота прокси, статус обёртки,
// фактическая модель шага, реестр проверяющих при завершении агента ------------
// CONSTRAINT: имена мода -- через namespace-импорт R514/SA: красная фаза на
// дереве до волны обязана показывать отказ каждого зуба отдельной строкой.
const FIX9_PROXY_QUOTA = "API Error: 503 auth_unavailable: no auth available (providers=codex, model=gpt-6-astra; last upstream error: quota); 2 credentials parked: spent allowance; soonest recovery in 1h2m3s"

function fix9Mark(text: string, model: string, T: number): any {
  const c = R514.classifyRefusal(text, T, model)
  const mk = R514.noteModelRefusal(model, T, c.class, c.readyAt, "carrier-refusal", text, new Map())
  return { cls: c.class, ms: mk ? mk.until - T : null }
}

async function fix9Tick(h: any, T: number, list: () => Promise<any[]>): Promise<void> {
  h.m.setNow(T)
  h.m.$.agent.list = list
  // CONSTRAINT: тик не должен отправлять submit-канал: режим сессии --
  // неизвестен (session.start не было), шов лишь фиксирует попытки.
  R514.staleInteractiveReset()
  h.submits = h.submits || []
  if (!h.m.$.prompt) h.m.$.prompt = { submit: async (arg: any) => { h.submits.push(arg); return { text: String(arg && arg.text) } } }
  const n = h.m.everyCbs.length
  R514.armStaleAgentsTimer(h.m.$, T)
  expect(h.m.everyCbs.length, "тик взведён").toBe(n + 1)
  await h.m.everyCbs[n]()
  await settle393()
}

test("#509-FIX9 R3: строка прокси «last upstream error: quota); … spent allowance; soonest recovery in 1h2m3s» -- quota, срок 3723 с", () => {
  expect(fix9Mark(FIX9_PROXY_QUOTA, "gpt-6-astra", Date.parse("2026-10-04T09:00:00Z"))).toEqual({ cls: "quota", ms: 3723000 })
})

test("#509-FIX9 R3: каждый признак прокси по отдельности -- quota; без «soonest recovery in» -- срок 60 мин", () => {
  const T = Date.parse("2026-10-04T09:05:00Z")
  expect(fix9Mark("API Error: 503 auth_unavailable (model=gpt-6-astra; last upstream error: quota)", "gpt-6-astra", T)).toEqual({ cls: "quota", ms: 3600000 })
  expect(fix9Mark("API Error: 503 auth_unavailable: 2 credentials parked: spent allowance", "gpt-6-astra", T)).toEqual({ cls: "quota", ms: 3600000 })
})

test("#509-FIX9 R3: credential_quota по-прежнему quota; срок из «soonest recovery in» и у неё", () => {
  const T = Date.parse("2026-10-04T09:10:00Z")
  expect(fix9Mark("API Error: 429 credential_quota exhausted for this key", "gpt-6-astra", T)).toEqual({ cls: "quota", ms: 3600000 })
  expect(fix9Mark("API Error: 429 credential_quota exhausted; soonest recovery in 2m0s", "gpt-6-astra", T)).toEqual({ cls: "quota", ms: 120000 })
})

test("#509-FIX9 R3: разбор срока -- любая подпоследовательность частей и нули; без частей -- 60 мин", () => {
  const T = Date.parse("2026-10-04T09:15:00Z")
  const rows: Array<[string, number]> = [
    ["soonest recovery in 0h5m0s", 300000],
    ["soonest recovery in 2m0s", 120000],
    ["soonest recovery in 45s", 45000],
    ["soonest recovery in 2h", 7200000],
    ["soonest recovery in 2h3s", 7203000],
    ["soonest recovery in 1h2m3s.", 3723000],
    ["soonest recovery in soon", 3600000],
    ["soonest recovery in", 3600000],
  ]
  for (const [tail, ms] of rows) {
    expect({ tail, got: fix9Mark("API Error: 503 last upstream error: quota); " + tail, "gpt-6-astra", T) }).toEqual({ tail, got: { cls: "quota", ms } })
  }
})

test("#509-FIX9 R3: шаг -- срок квоты из полной строки отказа (длиннее REFUSAL_TEXT_MAX) доходит до цели ожидания", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 4, 9, 20, 0)
  const h = host514("9r3", T0, { noProc: true })
  const parked: string[] = []
  for (let i = 0; i < 12; i++) parked.push("codex-account-" + i + ": spent allowance")
  const line = "API Error: 503 auth_unavailable: no auth available (providers=codex, model=in9r3; last upstream error: quota); credentials parked: " + parked.join(", ") + "; soonest recovery in 1h2m3s"
  expect(line.length, "форма срока лежит за REFUSAL_TEXT_MAX").toBeGreaterThan(R514.REFUSAL_TEXT_MAX + 20)
  failoverBindSet("ag-9r3", { ladder: [], terminal: "claude-t9r3", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in9r3": refuseAll514(line), "claude-t9r3": refuseAll514(FIX9_PROXY_QUOTA.replace("1h2m3s", "2h")) })
  await step514(h, "ag-9r3", "in9r3", next)
  expect(next.seen).toEqual(["in9r3", "claude-t9r3"])
  expect(attempts514(h, "ag-9r3").map(r => r.refusalClass)).toEqual(["quota", "quota"])
  const w = waits514(h, "ag-9r3", "wait-unavailable")
  expect(w.map(r => ({ wakeAt: r.wakeAt, wakeModel: r.wakeModel }))).toEqual([{ wakeAt: new Date(T0 + 3723000).toISOString(), wakeModel: "in9r3" }])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX9 R4: статус обёртки API Error решает класс -- request, permanent-model, прежние 402 / unknown provider / model_not_found, прочий 4xx", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-04T09:30:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"prompt is too long: 250000 tokens > 200000 maximum\"}}", "request"],
    ["API Error: 413 request body Too Long for upstream", "request"],
    ["API Error: 401 {\"error\":{\"message\":\"invalid x-api-key\"}}", "permanent-model"],
    ["API Error: 403 {\"error\":{\"type\":\"permission_error\",\"message\":\"content policy\"}}", "permanent-model"],
    ["API Error: 404 {\"error\":{\"message\":\"route not found\"}}", "permanent-model"],
    ["API Error: 402 Payment Required", "quota"],
    ["API Error: 400 {\"error\":\"unknown provider grok-4.6\"}", "permanent-model"],
    ["API Error: 400 {\"error\":{\"code\":\"model_not_found\",\"message\":\"x\"}}", "permanent-model"],
    ["API Error: 409 Conflict", "temporary-unknown"],
  ]
  for (const [line, cls] of rows) expect({ line, cls: cr(line, now, "gpt-6-astra").class }).toEqual({ line, cls })
})

test("#509-FIX9 R4 / #509-FIX10 F3: в обёртке 400 решает предмет размера, 413 -- статус; «too long» без предмета ни при каком статусе", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-04T09:35:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 Bad Request: invalid tool schema", "temporary-unknown"],
    ["API Error: 413 Request Entity Too Large", "request"],
    ["API Error: 500 upstream took too long", "temporary-unknown"],
    ["API Error: 429 queue too long", "temporary-unknown"],
    ["API Error: 4000 too long", "temporary-unknown"],
    ["Request timed out: too long", "temporary-unknown"],
  ]
  for (const [line, cls] of rows) expect({ line, cls: cr(line, now, "gpt-6-astra").class }).toEqual({ line, cls })
})

async function fix9Term(tag: string, cls: string): Promise<any> {
  reset514()
  const T0 = Date.UTC(2026, 9, 4, 10, 0, 0)
  let next: any = null
  const h = host514("9r2" + tag, T0, { sleepHook: (n) => { if (n === 1) next.signal.aborted = true } })
  const aid = "ag-9r2" + tag
  const inM = "in9r2" + tag
  const rM = "r9r2" + tag
  const tM = "claude-t9r2" + tag
  failoverBindSet(aid, { ladder: [rM], terminal: tM, rungEffort: { [rM]: "max" }, subagentType: "t", class: "", sticky: null })
  R514.noteModelRefusal(tM, T0, cls, cls === "temporary-known" ? T0 + 3600000 : 0, "carrier-refusal", "pre-" + cls)
  const script = { [inM]: refuseAll514(RL429), [rM]: refuseAll514(RL429), [tM]: () => null }
  next = next514(h, script)
  const out1 = await step514(h, aid, inM, next)
  const first = {
    seen: next.seen.slice(),
    served: out1 && out1.value && out1.value.text,
    skipped: waits514(h, aid, "skipped-known-until").map(r => ({ model: r.model, pass: r.pass })),
  }
  h.m.setNow(T0 + 3600000 + 1000)
  const next2 = next514(h, script)
  const out2 = await step514(h, aid, inM, next2, { index: 1 })
  const after = { seen: next2.seen.slice(), served: out2 && out2.value && out2.value.text }
  rungCooldownReset()
  failoverBindReset()
  return { first, after, inM, rM, tM }
}

test("#509-FIX9 R2: клетка исчерпана, у терминала метка temporary-known на час -- первый проход терминал не зовёт, после срока зовёт", async () => {
  const g = await fix9Term("k", "temporary-known")
  expect(g.first, "первый проход: терминал пропущен и назван").toEqual({ seen: [g.inM, g.rM], served: undefined, skipped: [{ model: g.tM, pass: 1 }] })
  expect(g.after, "срок терминала истёк -- вызов есть").toEqual({ seen: [g.inM, g.rM, g.tM], served: "OK-" + g.tM })
})

test("#509-FIX9 R2: у терминала метка quota со сроком в будущем -- первый проход терминал не зовёт, после срока зовёт", async () => {
  const g = await fix9Term("q", "quota")
  expect(g.first).toEqual({ seen: [g.inM, g.rM], served: undefined, skipped: [{ model: g.tM, pass: 1 }] })
  expect(g.after).toEqual({ seen: [g.inM, g.rM, g.tM], served: "OK-" + g.tM })
})

test("#509-FIX9 R2: метка temporary-unknown на терминале -- первый проход его зовёт, как прежде", async () => {
  const g = await fix9Term("u", "temporary-unknown")
  expect(g.first).toEqual({ seen: [g.inM, g.rM, g.tM], served: "OK-" + g.tM, skipped: [] })
})

test("#509-FIX9 R5: агент завершён, шаги обслужили две модели -- одна запись served-summary {model, steps}; итоговой подсказки нет", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 4, 11, 0, 0)
  const h = host514("9r5", T0, { noProc: true })
  const aid = "ag-9r5"
  failoverBindSet(aid, { ladder: ["r9r5"], terminal: "", rungEffort: { r9r5: "high" }, subagentType: "t9r5", class: "", sticky: null })
  const next = next514(h, { "in9r5": (k) => (k === 0 ? NORESP6 : null), "r9r5": () => null })
  await step514(h, aid, "in9r5", next, { index: 0 })
  h.m.setNow(T0 + 60000)
  await step514(h, aid, "in9r5", next, { index: 1 })
  expect(next.seen, "шаг 0 -- ступень, шаг 1 -- объявленная").toEqual(["in9r5", "r9r5", "in9r5"])
  const q0 = p5Q("")
  expect(q0, "подсказка шага").toEqual(["агент ag-9r5 (t9r5): шаг агента обслужила r9r5 (объявлена in9r5)"])
  await fix9Tick(h, T0 + 120000, async () => [{ id: aid, status: "running", type: "t9r5" }])
  expect(waits514(h, aid, "served-summary"), "агент жив -- итога нет").toEqual([])
  await fix9Tick(h, T0 + 180000, async () => [{ id: aid, status: "completed", type: "t9r5" }])
  await fix9Tick(h, T0 + 240000, async () => [{ id: aid, status: "completed", type: "t9r5" }])
  const sums = waits514(h, aid, "served-summary")
  expect(sums.map(r => ({ declared: r.declared, served: r.served, subagentType: r.subagentType })), "одна запись на завершение").toEqual([
    { declared: "in9r5", served: [{ model: "r9r5", steps: 1 }, { model: "in9r5", steps: 1 }], subagentType: "t9r5" },
  ])
  expect(p5Q(""), "итог в разговор не идёт").toEqual(q0)
  expect(h.submits, "итог не уходит и submit-каналом").toEqual([])
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX9 R5: все шаги на объявленной модели -- записи served-summary нет", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 4, 11, 30, 0)
  const h = host514("9r5b", T0, { noProc: true })
  const aid = "ag-9r5b"
  failoverBindSet(aid, { ladder: ["r9r5b"], terminal: "", rungEffort: { r9r5b: "high" }, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "in9r5b": () => null, "r9r5b": () => null })
  await step514(h, aid, "in9r5b", next, { index: 0 })
  await step514(h, aid, "in9r5b", next, { index: 1 })
  expect(next.seen).toEqual(["in9r5b", "in9r5b"])
  await fix9Tick(h, T0 + 60000, async () => [{ id: aid, status: "completed", type: "t" }])
  expect(waits514(h, aid, "served-summary")).toEqual([])
  expect(p5Q("")).toEqual([])
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX9 R7: проверяющий B завершён -- его запись снята до 2 ч, ступени второго критика снова видят его модель", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 4, 12, 0, 0)
  const h = host514("9r7", T0, { noProc: true })
  await spawn514(h, "ag-9r7b", "crit-mech", "gpt-6-sol-t9r7")
  const b0 = R514.sessionReviewerServedGet("ag-9r7b")
  expect(b0 && b0.model, "B занял модель на спавне").toBe("gpt-6-sol-t9r7")
  await fix9Tick(h, T0 + 60000, async () => [{ id: "ag-9r7b", status: "completed", type: "t" }])
  expect(R514.sessionReviewerServedGet("ag-9r7b"), "запись снята задолго до REVIEWER_LIVE_MS").toBe(undefined)
  failoverBindSet("ag-9r7a", { ladder: ["gpt-6-sol-t9r7", "qwen-t9r7"], terminal: "", rungEffort: { "gpt-6-sol-t9r7": "high", "qwen-t9r7": "high" }, subagentType: "t", class: "crit-mech", sticky: null })
  const next = next514(h, { "grok-4.7-t9r7": refuseAll514(NORESP6), "gpt-6-sol-t9r7": () => null, "qwen-t9r7": () => null })
  const out = await step514(h, "ag-9r7a", "grok-4.7-t9r7", next)
  expect(next.seen, "фильтр пары модели B больше не видит").toEqual(["grok-4.7-t9r7", "gpt-6-sol-t9r7"])
  expect(out.value && out.value.text).toBe("OK-gpt-6-sol-t9r7")
  expect(attempts514(h, "ag-9r7a").map(r => r.rungsFilteredReviewer)).toEqual([0, 0])
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX9 R7: запись, поставленная после запроса списка, не снимается; живой и отсутствующий в списке -- не снимаются", async () => {
  await clear393()
  reset514()
  const T0 = Date.UTC(2026, 9, 4, 12, 30, 0)
  const h = host514("9r7r", T0, { noProc: true })
  R514.sessionReviewerServedSet("ag-9r7c", "m-old-9r7", T0)
  R514.sessionReviewerServedSet("ag-9r7d", "m-d-9r7", T0)
  R514.sessionReviewerServedSet("ag-9r7e", "m-e-9r7", T0)
  await fix9Tick(h, T0 + 60000, async () => {
    R514.sessionReviewerServedSet("ag-9r7c", "m-new-9r7", T0 + 60000)
    return [{ id: "ag-9r7c", status: "completed", type: "t" }, { id: "ag-9r7d", status: "running", type: "t" }]
  })
  const c = R514.sessionReviewerServedGet("ag-9r7c")
  const d = R514.sessionReviewerServedGet("ag-9r7d")
  const e = R514.sessionReviewerServedGet("ag-9r7e")
  expect({ c: c && c.model, d: d && d.model, e: e && e.model }).toEqual({ c: "m-new-9r7", d: "m-d-9r7", e: "m-e-9r7" })
  await clear393()
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX9 R7: idle-watch вооружён, список берёт тик висящих агентов -- запись завершённого проверяющего снята тем же тиком", async () => {
  const T0 = 909_000_000
  const st = sa$("9r7s", T0)
  await saStart(st)
  R514.sessionReviewerServedSet("ag-9r7s", "m-9r7s", T0)
  st.agents = [saRun("ag-9r7s", { status: "completed" })]
  const calls0 = st.listCalls
  await saTickAt(st, T0 + SA_MIN)
  expect(R514.sessionReviewerServedGet("ag-9r7s")).toBe(undefined)
  expect(st.listCalls - calls0, "один запрос списка на тик").toBe(1)
  await clear393()
})

// --- #509-FIX10: терминал при объявленной = терминал, размерный «too long»,
// пробелы в сроке квоты ---------------------------------------------------------
// CONSTRAINT: имена мода -- через namespace-импорт R514: красная фаза на
// дереве FIX9 обязана показывать отказ каждого зуба отдельной строкой.

async function fix10TermDecl(tag: string, cls: string): Promise<any> {
  reset514()
  const T0 = Date.UTC(2026, 9, 5, 10, 0, 0)
  let next: any = null
  const h = host514("10f1" + tag, T0, { sleepHook: (n) => { if (n === 1) next.signal.aborted = true } })
  const aid = "ag-10f1" + tag
  const tM = "claude-t10f1" + tag
  const rM = "r10f1" + tag
  failoverBindSet(aid, { ladder: [rM], terminal: tM, rungEffort: { [rM]: "max" }, subagentType: "t", class: "", sticky: null })
  R514.noteModelRefusal(tM, T0, cls, cls === "temporary-known" ? T0 + 3600000 : 0, "carrier-refusal", "pre-" + cls)
  const script: any = { [rM]: refuseAll514(RL429), [tM]: (_k: number, t: number) => (t >= T0 + 3600000 + 1000 ? null : RL429) }
  next = next514(h, script)
  const out1 = await step514(h, aid, tM, next)
  const first = {
    seen: next.seen.slice(),
    served: out1 && out1.value && out1.value.text,
    skipped: waits514(h, aid, "skipped-known-until").map(r => ({ model: r.model, pass: r.pass })),
  }
  h.m.setNow(T0 + 3600000 + 1000)
  const next2 = next514(h, script)
  const out2 = await step514(h, aid, tM, next2, { index: 1 })
  const after = { seen: next2.seen.slice(), served: out2 && out2.value && out2.value.text }
  rungCooldownReset()
  failoverBindReset()
  return { first, after, rM, tM }
}

test("#509-FIX10 F1: объявленная = терминал, живая метка quota -- вызова нет ни в какой позиции, skippedKnown несёт терминал; после срока -- вызов", async () => {
  const g = await fix10TermDecl("q", "quota")
  expect(g.first, "первый проход: терминал снят и назван").toEqual({ seen: [g.rM], served: undefined, skipped: [{ model: g.tM, pass: 1 }] })
  expect(g.after, "срок истёк -- терминал вернулся в план").toEqual({ seen: [g.tM], served: "OK-" + g.tM })
})

test("#509-FIX10 F1: объявленная = терминал, живая метка temporary-known на первом проходе без skipKnown -- вызова нет, после срока есть", async () => {
  const g = await fix10TermDecl("k", "temporary-known")
  expect(g.first, "первый проход: терминал снят и назван").toEqual({ seen: [g.rM], served: undefined, skipped: [{ model: g.tM, pass: 1 }] })
  expect(g.after, "срок истёк -- терминал вернулся в план").toEqual({ seen: [g.tM], served: "OK-" + g.tM })
})

test("#509-FIX11 B2: объявленная = терминал без ступеней, живая метка quota -- план опустел от метки, но шаг ждёт срока: пробы живости зовут next, wake зовёт после срока, прямого вызова до срока нет", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 6, 10, 0, 0)
  const tM = "claude-t11e"
  const aid = "ag-11e"
  const h = host514("11e", T0)
  failoverBindSet(aid, { ladder: [], terminal: tM, rungEffort: {}, subagentType: "t", class: "", sticky: null })
  R514.noteModelRefusal(tM, T0, "quota", T0 + 600000, "carrier-refusal", "pre-quota")
  const at: number[] = []
  const next = next514(h, {
    [tM]: (_k: number, t: number) => { at.push(t); return t >= T0 + 600000 ? null : "API Error: 503 auth_unavailable (model=claude-t11e; last upstream error: quota); soonest recovery in 10m" },
  })
  const out = await step514(h, aid, tM, next)
  const kinds = waits514(h, aid, "wait-probe").map(r => r.kind)
  expect(out.value && out.value.text, "шаг завершён после срока, не прямым вызовом в отказ").toBe("OK-" + tM)
  expect(kinds[kinds.length - 1], "срок наступил -- пробуждение полным проходом").toBe("wake")
  expect(kinds.filter(k => k === "heartbeat").length, "heartbeat-вызовы next не подавлены").toBeGreaterThanOrEqual(2)
  expect(at.filter(t => t > T0 && t < T0 + 600000 - 1000).length, "до срока -- только пробы живости").toBeGreaterThanOrEqual(2)
  expect(at[at.length - 1] - T0, "завершающий вызов -- после срока метки").toBeGreaterThanOrEqual(600000)
  expect(waits514(h, aid, "skipped-known-until").map(r => ({ model: r.model, pass: r.pass })), "снятие метки названо").toEqual([{ model: tM, pass: 1 }])
  expect(waits514(h, aid, "wait-unavailable"), "дверь сна не отказывала").toEqual([])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX11 B2: то же ожидание, прерванное на первом сне, -- модель не вызвана ни разу: прямого обхода метки нет", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 6, 10, 30, 0)
  const tM = "claude-t11eb"
  const aid = "ag-11eb"
  let next: any = null
  const h = host514("11eb", T0, { sleepHook: (n: number) => { if (n === 1) next.signal.aborted = true } })
  failoverBindSet(aid, { ladder: [], terminal: tM, rungEffort: {}, subagentType: "t", class: "", sticky: null })
  R514.noteModelRefusal(tM, T0, "quota", T0 + 600000, "carrier-refusal", "pre-quota")
  next = next514(h, { [tM]: refuseAll514(RL429) })
  await step514(h, aid, tM, next)
  expect(next.seen, "до срока модель не зовётся -- прямого вызова нет").toEqual([])
  expect(attempts514(h, aid), "попыток лестницы нет").toEqual([])
  expect(waits514(h, aid, "wait-aborted").length, "выход назван прерыванием ожидания").toBe(1)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX11 B2: действительно пустой план без меток -- прямой вызов сохранён", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 6, 11, 0, 0)
  const h = host514("11ec", T0, { noProc: true })
  failoverBindSet("ag-11ec", { ladder: [], terminal: "", rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const next = next514(h, { "": refuseAll514(RL429) })
  await step514(h, "ag-11ec", "", next)
  expect(next.seen, "пустой план -- шаг без перехвата лестницы, прямой вызов").toEqual([""])
  expect(attempts514(h, "ag-11ec"), "попыток лестницы нет ни в какой позиции").toEqual([])
  expect(waits514(h, "ag-11ec", "skipped-known-until"), "снимать нечего").toEqual([])
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX10 F3: «too long» решает только с предметом размера запроса; 413 -- request по статусу", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-05T11:30:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 processing took too long; retry later", "temporary-unknown"],
    ["API Error: 400 prompt is too long: 210000 tokens > 200000 maximum", "request"],
    ["API Error: 413 Request Entity Too Large", "request"],
    ["API Error: 400 context length exceeded", "request"],
    ["API Error: 409 Conflict", "temporary-unknown"],
  ]
  for (const [line, cls] of rows) expect({ line, cls: cr(line, now, "gpt-6-astra").class }).toEqual({ line, cls })
})

test("#509-FIX10 F4: срок «soonest recovery in» -- части могут разделяться пробелами", () => {
  const T = Date.parse("2026-10-05T11:45:00Z")
  const rows: Array<[string, number]> = [
    ["1h 2m", 3720000],
    ["1h2m3s", 3723000],
    ["45m", 2700000],
    ["2h", 7200000],
    ["1h 2m 3s", 3723000],
  ]
  for (const [tail, ms] of rows) {
    expect({ tail, got: fix9Mark("API Error: 503 auth_unavailable (model=gpt-6-astra; last upstream error: quota); soonest recovery in " + tail, "gpt-6-astra", T) }).toEqual({ tail, got: { cls: "quota", ms } })
  }
})

// --- #509-FIX10 F2 (пересмотр): смена класса внутри пары temporary-known/quota
// на пробе сердцебиения не двигает срок живой метки ----------------------------
// CONSTRAINT: ряд идёт фактическим путём turn.step → attemptOne → markRefusal,
// функция метки не мокается. Первоначальный отказ даёт живую метку до
// T0+1800000 (10:30); каждая проба сердцебиения отказывает строкой ДРУГОГО
// класса пары с более поздним сроком (11:00 / +30 м от отказа) -- без запрета
// переписывания срока смена класса двигала бы срок метки за первоначальную
// границу, и первый вызов после неё ушёл бы на пробу сердцебиения (следующий
// такт 240 с), а не на полный проход по сроку. Сердцебиение при этом продолжает
// звать next каждые 240 с (подавление вызова запрещено: отказ исходного F2).

async function fix10F2Row(tag: string, firstLine: string, beatLine: string): Promise<any> {
  reset514()
  const T0 = Date.UTC(2026, 9, 8, 10, 0, 0)
  const inM = "in10f2" + tag
  const tM = "claude-t10f2" + tag
  const aid = "ag-10f2" + tag
  const h = host514("10f2" + tag, T0)
  failoverBindSet(aid, { ladder: [], terminal: tM, rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const at: number[] = []
  const next = next514(h, {
    [inM]: (k: number, t: number) => { at.push(t); return k === 0 ? firstLine : (t >= T0 + 1800000 ? null : beatLine) },
    [tM]: refuseAll514("Not logged in · Please run /login"),
  })
  const out = await step514(h, aid, inM, next)
  const kinds = waits514(h, aid, "wait-probe").map(r => r.kind)
  const clsRow = attempts514(h, aid).filter(r => r.modelRequested === inM && r.refusalClass).map(r => r.refusalClass)
  rungCooldownReset()
  failoverBindReset()
  return { out, at, kinds, clsRow, inM, T0 }
}

test("#509-FIX10 F2: отказ сердцебиения quota не двигает срок живой метки temporary-known -- полный проход в первоначальный срок", async () => {
  const g = await fix10F2Row("a",
    "You've hit your session limit · resets 10:30am (UTC)",
    "API Error: 503 auth_unavailable (model=gpt-6-astra; last upstream error: quota); soonest recovery in 30m")
  expect(g.out.value && g.out.value.text).toBe("OK-" + g.inM)
  expect(g.clsRow.slice(0, 2), "переход класса на пробе").toEqual(["temporary-known", "quota"])
  expect(g.kinds[g.kinds.length - 1], "метка истекла в первоначальный срок -- пробуждение полным проходом").toBe("wake")
  expect(g.kinds.filter(k => k === "heartbeat").length, "сердцебиение не реже 240 с -- вызовы next сохранены").toBeGreaterThanOrEqual(7)
  expect(g.at[g.at.length - 1] - g.T0, "полный проход зовёт модель по первоначальному сроку").toBeLessThan(1800000 + 10000)
  expect(g.at.filter(t => t > g.T0 + 1800000 + 10000).length, "продлённый срок оставил бы вызовы за первоначальной границей").toBe(0)
})

test("#509-FIX10 F2: отказ сердцебиения temporary-known не двигает срок живой метки quota -- полный проход в первоначальный срок", async () => {
  const g = await fix10F2Row("b",
    "API Error: 503 auth_unavailable (model=gpt-6-astra; last upstream error: quota); soonest recovery in 30m",
    "You've hit your session limit · resets 11am (UTC)")
  expect(g.out.value && g.out.value.text).toBe("OK-" + g.inM)
  expect(g.clsRow.slice(0, 2), "переход класса на пробе").toEqual(["quota", "temporary-known"])
  expect(g.kinds[g.kinds.length - 1], "метка истекла в первоначальный срок -- пробуждение полным проходом").toBe("wake")
  expect(g.kinds.filter(k => k === "heartbeat").length, "сердцебиение не реже 240 с -- вызовы next сохранены").toBeGreaterThanOrEqual(7)
  expect(g.at[g.at.length - 1] - g.T0, "полный проход зовёт модель по первоначальному сроку").toBeLessThan(1800000 + 10000)
  expect(g.at.filter(t => t > g.T0 + 1800000 + 10000).length, "продлённый срок оставил бы вызовы за первоначальной границей").toBe(0)
})

// --- #509-FIX11: quota в wake-проходе, сокращение срока пары, классы отказа ----
// CONSTRAINT: ряды идут фактическим путём turn.step → attemptOne → markRefusal /
// failoverStepPlan; часы движет только подставной /bin/sleep стенда.

test("#509-FIX11 B1: wake-проход снимает живую quota-метку ступени -- Q не вызывается до её срока, после срока вызывается; первичный проход никого не пропускает", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 9, 10, 0, 0)
  const inM = "in11w"
  const bM = "r11wb"
  const qM = "r11wq"
  const tM = "claude-t11w"
  const aid = "ag-11w"
  const h = host514("11w", T0)
  failoverBindSet(aid, { ladder: [bM, qM], terminal: tM, rungEffort: { [bM]: "high", [qM]: "high" }, subagentType: "t", class: "", sticky: null })
  R514.noteModelRefusal(qM, T0, "quota", T0 + 3600000, "carrier-refusal", "pre-quota")
  const atQ: number[] = []
  const next = next514(h, {
    [inM]: (k: number, _t: number) => (k === 0 ? "You've hit your session limit · resets 10:30am (UTC)" : RL429),
    [bM]: (_k: number, t: number) => (t >= T0 + 600000 ? RL429 : "You've hit your session limit · resets 10:10am (UTC)"),
    [qM]: (k: number, t: number) => {
      atQ.push(t)
      return k === 0 || t < T0 + 3600000
        ? "API Error: 503 auth_unavailable (model=r11wq; last upstream error: quota); soonest recovery in 1h"
        : null
    },
    [tM]: refuseAll514("Not logged in · Please run /login"),
  })
  const out = await step514(h, aid, inM, next)
  expect(out.value && out.value.text, "шаг завершён вызовом Q после её срока").toBe("OK-" + qM)
  expect(next.seen.slice(0, 4), "первичный проход: объявленная, обе ступени и терминал -- никого не пропустили").toEqual([inM, bM, qM, tM])
  expect(atQ.length, "Q вызвана ровно дважды: первичный проход и срок").toBe(2)
  expect(atQ[0] - T0, "не-пропуск Q на первичном проходе").toBeLessThan(60000)
  expect(atQ[1] - T0, "второй вызов Q -- после срока квоты").toBeGreaterThanOrEqual(3600000)
  const skippedQ = waits514(h, aid, "skipped-known-until").filter(r => r.model === qM)
  expect(skippedQ.length, "wake-проходы снимают живую quota-метку в skippedKnown").toBeGreaterThan(0)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX11 B3: проба с более ранним достоверным recovery сокращает срок живой метки пары -- полный проход по сокращённому сроку, heartbeat продолжает звать next", async () => {
  reset514()
  const T0 = Date.UTC(2026, 9, 9, 10, 0, 0)
  const inM = "in11s"
  const tM = "claude-t11s"
  const aid = "ag-11s"
  const h = host514("11s", T0)
  failoverBindSet(aid, { ladder: [], terminal: tM, rungEffort: {}, subagentType: "t", class: "", sticky: null })
  const at: number[] = []
  const next = next514(h, {
    [inM]: (k: number, t: number) => {
      at.push(t)
      return k === 0
        ? "You've hit your session limit · resets 11am (UTC)"
        : (t >= T0 + 540000 ? null : "API Error: 503 auth_unavailable (model=in11s; last upstream error: quota); soonest recovery in 5m")
    },
    [tM]: refuseAll514("Not logged in · Please run /login"),
  })
  const out = await step514(h, aid, inM, next)
  const kinds = waits514(h, aid, "wait-probe").map(r => r.kind)
  const clsRow = attempts514(h, aid).filter(r => r.modelRequested === inM && r.refusalClass).map(r => r.refusalClass)
  expect(out.value && out.value.text).toBe("OK-" + inM)
  expect(clsRow.slice(0, 2), "переход класса на пробе").toEqual(["temporary-known", "quota"])
  expect(kinds[kinds.length - 1], "сокращённый срок наступил -- пробуждение полным проходом").toBe("wake")
  expect(kinds.filter(k => k === "heartbeat").length, "сердцебиение продолжает звать next").toBeGreaterThanOrEqual(1)
  expect(at[at.length - 1] - T0, "вызов по сокращённому сроку (~T0+540000), не по первоначальному часу").toBeLessThan(600000)
  rungCooldownReset()
  failoverBindReset()
})

test("#509-FIX11 B4: «took» между предметом и «too long» -- длительность, не размер; «token limit exceeded»/«input length exceeded» -- предмет размера", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-06T12:00:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 request took too long", "temporary-unknown"],
    ["API Error: 400 query took too long", "temporary-unknown"],
    ["API Error: 400 message took too long", "temporary-unknown"],
    ["API Error: 400 input took too long", "temporary-unknown"],
    ["API Error: 400 body took too long", "temporary-unknown"],
    ["API Error: 400 payload took too long", "temporary-unknown"],
    ["API Error: 400 history took too long", "temporary-unknown"],
    ["API Error: 400 processing took too long; retry later", "temporary-unknown"],
    ["API Error: 400 prompt is too long: 210000 tokens > 200000 maximum", "request"],
    ["API Error: 400 context length exceeded", "request"],
    ["API Error: 400 token limit exceeded", "request"],
    ["API Error: 400 input length exceeded", "request"],
    ["API Error: 400 too many tokens", "request"],
  ]
  for (const [line, cls] of rows) expect({ line, cls: cr(line, now, "gpt-6-astra").class }).toEqual({ line, cls })
})

test("#509-FIX12 T1: временные формы глагола и «processing deadline» у 400 -- длительность, не размер; прежний контроль «prompt is too long» остаётся размером", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-07T10:15:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 request is taking too long", "temporary-unknown"],
    ["API Error: 400 query has taken too long", "temporary-unknown"],
    ["API Error: 400 message takes too long", "temporary-unknown"],
    ["API Error: 400 input will take too long", "temporary-unknown"],
    ["API Error: 400 request exceeds the input processing deadline", "temporary-unknown"],
    ["API Error: 400 prompt is too long", "request"],
  ]
  for (const [line, cls] of rows) expect({ line, cls: cr(line, now, "gpt-6-astra").class }).toEqual({ line, cls })
})

test("#509-FIX12 T2: явные размерные формы у 400 -- request; 409 -- не размер, 413 -- статус", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-07T10:30:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 Request Entity Too Large", "request"],
    ["API Error: 400 context_length_exceeded", "request"],
    ["API Error: 400 input_length_exceeded", "request"],
    ["API Error: 400 tokens limit exceeded", "request"],
    ["API Error: 400 context limit exceeded", "request"],
    ["API Error: 400 maximum request size exceeded", "request"],
    ["API Error: 400 request exceeded the maximum input tokens", "request"],
    ["API Error: 400 payload size exceeded", "request"],
    ["API Error: 409 Conflict", "temporary-unknown"],
    ["API Error: 413 Request Entity Too Large", "request"],
  ]
  for (const [line, cls] of rows) expect({ line, cls: cr(line, now, "gpt-6-astra").class }).toEqual({ line, cls })
})

test("#509-FIX13 N1: временные/частотные формы у 400 -- длительность или лимит плана, не размер: temporary-unknown", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-08T09:20:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 request has been running too long", "temporary-unknown"],
    ["API Error: 400 request failed! Response was too long to arrive", "temporary-unknown"],
    ["API Error: 400 The deadline for this request is too long", "temporary-unknown"],
    ["API Error: 400 request is taking the payload too long", "temporary-unknown"],
    ["API Error: 400 request timed  out too long", "temporary-unknown"],
    ["API Error: 400 request timed-out too long", "temporary-unknown"],
    ["API Error: 400 request timeout too long", "temporary-unknown"],
    ["API Error: 400 request_limit_exceeded", "temporary-unknown"],
    ["API Error: 400 request limit exceeded", "temporary-unknown"],
    ["API Error: 400 token limit for your plan", "temporary-unknown"],
    ["API Error: 400 request is taking too long; payload was slow to arrive", "temporary-unknown"],
  ]
  for (const [line, cls] of rows) expect({ line, cls: cr(line, now, "gpt-6-astra").class }).toEqual({ line, cls })
})

test("#509-FIX13 P1: явные размерные формы у 400 -- request", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-08T09:40:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 image is too large", "request"],
    ["API Error: 400 pdf was too large", "request"],
    ["API Error: 400 maximum_request_size_exceeded", "request"],
    ["API Error: 400 exceeding the maximum input tokens", "request"],
    ["API Error: 400 prompt is too long", "request"],
    ["API Error: 400 request was too long", "request"],
    ["API Error: 400 too many tokens", "request"],
    ["API Error: 400 request is too long; please shorten it", "request"],
    ["API Error: 400 request timed out! prompt is too long", "request"],
    ["API Error: 400 context_length_exceeded", "request"],
    ["API Error: 400 Request Entity Too Large", "request"],
  ]
  for (const [line, cls] of rows) expect({ line, cls: cr(line, now, "gpt-6-astra").class }).toEqual({ line, cls })
})

test("#509-FIX14 N2: плановый, частотный и отрицающий 400 -- temporary-unknown, лестницу не прекращать", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T09:10:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 exceeding the request limit for your plan", "temporary-unknown"],
    ["API Error: 400 exceeded the maximum request limit of 60 requests per minute", "temporary-unknown"],
    ["API Error: 400 tokens limit exceeded for the current minute", "temporary-unknown"],
    ["API Error: 400 request timed out. This was not a too many tokens error.", "temporary-unknown"],
    ["API Error: 400 request timed out. It was not a request_size_limit_exceeded error.", "temporary-unknown"],
    ["API Error: 400 too many tokens per minute", "temporary-unknown"],
    ["API Error: 400 request has run too long", "temporary-unknown"],
    ["API Error: 400 request was too long to arrive", "temporary-unknown"],
    ["API Error: 400 request limit exceeded", "temporary-unknown"],
  ]
  for (const [line, cls] of rows) expect({ line, cls: cr(line, now, "gpt-6-astra").class }).toEqual({ line, cls })
})

test("#509-FIX14 P2: подлинный размер у 400 остаётся request: size_limit, чужое отрицание, императив после фразы", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T09:30:00Z")
  const rows: Array<[string, string]> = [
    ["API Error: 400 request_size_limit_exceeded", "request"],
    ["API Error: 400 request size limit exceeded", "request"],
    ["API Error: 400 prompt is too long, please run compaction", "request"],
    ["API Error: 400 too many tokens; this is not a timeout", "request"],
    ["API Error: 400 request timed out! prompt is too long", "request"],
    ["API Error: 400 tokens limit exceeded", "request"],
    ["API Error: 400 exceeding the maximum input tokens", "request"],
    ["API Error: 400 image is too large", "request"],
    ["API Error: 400 context_length_exceeded", "request"],
  ]
  for (const [line, cls] of rows) expect({ line, cls: cr(line, now, "gpt-6-astra").class }).toEqual({ line, cls })
})

test("#509-FIX15 N3: плановая/частотная пара, локальное отрицание и длительность у 400 -- temporary-unknown, лестницу не прекращать", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T10:10:00Z")
  const lines = [
    "API Error: 400 Exceeding the Request Limit",
    "API Error: 400 EXCEEDED THE REQUEST LIMIT",
    "API Error: 400 exceeding the request Limit",
    "API Error: 400 request_size_limit_exceeded was not the cause",
    "API Error: 400 request_size_limit_exceeded wasn't the cause",
    "API Error: 400 too many tokens is not the error",
    "API Error: 400 this wasn't a too many tokens error",
    "API Error: 400 It isn't a request_size_limit_exceeded error",
    "API Error: 400 request was not too long",
    "API Error: 400 request is too long to run",
    "API Error: 400 tokens limit exceeded per month",
    "API Error: 400 too many tokens per week",
    "API Error: 400 too many tokens, 60 requests per minute",
  ]
  // CONSTRAINT (#509-FIX15): класс фактического отказа собирается для ВСЕХ строк
  // до первого сравнения -- провал ранней строки не прячет остальные.
  const rows = lines.map((line) => ({ line, expected: "temporary-unknown", actual: cr(line, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX15 P3: подлинный размер у 400 остаётся request: локальное отрицание, чужая причина через запятую/but, «<subject> tokens exceeded»", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T10:30:00Z")
  const lines = [
    "API Error: 400 this was not a timeout but the prompt is too long",
    "API Error: 400 not a timeout, prompt is too long",
    "API Error: 400 please run compaction, the prompt is too long",
    "API Error: 400 without compaction the prompt is too long",
    "API Error: 400 not a timeout, request_size_limit_exceeded",
    "API Error: 400 not a timeout but request_size_limit_exceeded",
    "API Error: 400 not only too many tokens",
    "API Error: 400 input_tokens_exceeded",
    "API Error: 400 context tokens exceeded",
    "API Error: 400 prompt tokens exceeded",
    "API Error: 400 request_tokens_exceeded",
    "API Error: 400 request timed out; input_tokens_exceeded",
    "API Error: 400 prompt is too long, please run compaction",
  ]
  const rows = lines.map((line) => ({ line, expected: "request", actual: cr(line, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX16 N4: отрицание с because of, длительность субъекта и частота второй причины у 400 -- temporary-unknown, лестницу не прекращать", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T11:10:00Z")
  const tails = [
    "this is not because of a request_size_limit_exceeded error",
    "this isn't because of too many tokens",
    "not because of the input_tokens_exceeded error",
    "request has run the prompt too long",
    "request has run the payload too long",
    "request is too long to run",
    "too many tokens per minute, prompt tokens exceeded per hour",
    "too many tokens, 60 requests per minute",
  ]
  // CONSTRAINT (#509-FIX16): класс фактического отказа собирается для ВСЕХ строк
  // до первого сравнения -- провал ранней строки не прячет остальные.
  const rows = tails.map((tail) => ({ tail, expected: "temporary-unknown", actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX16 P4: самостоятельный размер рядом с чужой частотой/временем/отрицанием у 400 остаётся request", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T11:30:00Z")
  const tails = [
    "too many tokens per minute, prompt tokens exceeded",
    "too many tokens per minute but prompt tokens exceeded",
    "too many tokens per minute and prompt tokens exceeded",
    "prompt tokens exceeded, too many tokens per minute",
    "not a timeout and the prompt is too long",
    "request timed out and prompt is too long",
    "without a timeout the prompt is too long",
    "this was not a timeout: the prompt is too long",
    "no timeout and prompt is too long",
    "the prompt to run is too long",
    "prompt is too long to run compaction",
    "request has run the payload too long, prompt is too long",
  ]
  const rows = tails.map((tail) => ({ tail, expected: "request", actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX17 N5: частота при первой причине, субъектная длительность с already у 400 -- temporary-unknown, лестницу не прекращать", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T12:10:00Z")
  const tails = [
    "too many tokens, 60 requests per minute but not because of prompt tokens exceeded",
    "too many tokens, 60 requests per minute and not because of prompt tokens exceeded",
    "too many tokens, 60 requests per minute: not because of prompt tokens exceeded",
    "too many tokens, 60 requests per minute however prompt tokens exceeded was not the cause",
    "too many tokens, 60 requests per minute but prompt tokens exceeded per hour",
    "too many tokens, 60 requests per minute, took too long",
    "too many tokens, 60 requests per minute, too long",
    "too many tokens, 60 requests per minute, request was too long to arrive",
    "too many tokens, 60 requests per minute, request took too long",
    "request has already run the payload too long",
    "too many tokens, took too long, 60 requests per minute",
  ]
  // CONSTRAINT (#509-FIX17): класс фактического отказа собирается для ВСЕХ
  // хвостов до первого сравнения -- провал ранней строки не прячет остальные.
  const rows = tails.map((tail) => ({ tail, expected: "temporary-unknown", actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX17 P5: размер не подавляется поздним временем/длительностью или отрицаённой чужой причиной у 400", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T12:30:00Z")
  const tails = [
    "request timed out: the prompt is too long",
    "too many tokens per minute: prompt tokens exceeded",
    "prompt is too long because the input is run-length encoded",
    "prompt is too long the payload has run",
    "request has run dry so the prompt is too long",
    "not because of a request timeout the prompt is too long",
    "didn't time out the prompt is too long",
    "prompt is too long the request timed out",
    "request has run the payload too long, prompt is too long",
  ]
  const rows = tails.map((tail) => ({ tail, expected: "request", actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX18 N6: временной/длительный свободный кандидат запятой не отрывает частоту, отрицание глагола длительности и положительный timed у 400 -- temporary-unknown, лестницу не прекращать", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T13:10:00Z")
  const tails = [
    "too many tokens, request took too long, 60 requests per minute",
    "too many tokens, the request was too long to arrive, 60 requests per minute",
    "too many tokens, request has run the payload too long, 60 requests per minute",
    "the prompt didn't take too long",
    "the request did not take too long",
    "not because of a failure the request timed out the prompt is too long",
  ]
  // CONSTRAINT (#509-FIX18): класс фактического отказа собирается для ВСЕХ
  // хвостов до первого сравнения -- провал ранней строки не прячет остальные.
  const rows = tails.map((tail) => ({ tail, expected: "temporary-unknown", actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX18 P6: степенное «so», позиционный AUX_RUN, дефис run-length и 1-3 слова до timeout не гасят настоящий размер у 400", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T13:30:00Z")
  const tails = [
    "the prompt is so verbose it is too long",
    "the payload is so large it is too long",
    "the input is run-length encoded the prompt is too long",
    "request has run the payload too long the prompt is too long",
    "not because of a maximum request timeout the prompt is too long",
    "request has run dry so the prompt is too long",
    "didn't time out the prompt is too long",
  ]
  const rows = tails.map((tail) => ({ tail, expected: "request", actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX19 N7: отрицённая длительность (take/run с отрицанием и предметом) и её кандидат у запятой не доказывают размер у 400 -- temporary-unknown, лестницу не прекращать", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T14:10:00Z")
  const tails = [
    "too many tokens, the prompt didn't take too long, 60 requests per minute",
    "too many tokens, the request did not take too long, 60 requests per minute",
    "didn't take the prompt too long",
    "did not take the request too long",
    "the prompt never took too long",
    "the prompt was not taking too long",
    "the prompt isn't taking too long",
    "the request didn't run the payload too long",
    "the request has not run the payload too long",
    "the request had not run the payload too long",
    "the request isn't run the payload too long",
    "the prompt is never taking too long",
    "the prompt wasn't taking too long",
  ]
  // CONSTRAINT (#509-FIX19): класс фактического отказа собирается для ВСЕХ
  // хвостов до первого сравнения -- провал ранней строки не прячет остальные.
  const rows = tails.map((tail) => ({ tail, expected: "temporary-unknown", actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX19 P7: «so now/so the overall» -- новая клауза предмета, цифровое и дефисное слово в отрицании timeout и последующий положительный размер не гасятся у 400", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T14:30:00Z")
  const tails = [
    "request timed out so now the prompt is too long",
    "request timed out so the overall prompt is too long",
    "not because of a 3 second timeout the prompt is too long",
    "not because of a client-side timeout the prompt is too long",
    "the prompt didn't take too long the payload is too long",
    "request has run the payload too long the prompt is too long",
    "the prompt is so verbose it is too long",
    "didn't time out the prompt is too long",
  ]
  const rows = tails.map((tail) => ({ tail, expected: "request", actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX20 N8: голый предмет у отрицённой длительности, модальные/be-отрицания и отрицённая сильная причина запятой не доказывают размер у 400 -- temporary-unknown, лестницу не прекращать", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T15:10:00Z")
  const tails = [
    "didn't take prompt too long",
    "did not take request too long",
    "didn't run payload too long",
    "too many tokens, didn't take prompt too long, 60 requests per minute",
    "too many tokens, didn't run payload too long, 60 requests per minute",
    "the request would not take too long",
    "the prompt will not take too long",
    "the prompt should not take too long",
    "the prompt must not take too long",
    "the request won't run the payload too long",
    "the request couldn't run the payload too long",
    "the request cannot run the payload too long",
    "the prompt not taking too long",
    "the request not run the payload too long",
    "the request didn't take its prompt too long",
    "the prompt should not be too long",
    "the prompt will not be too long",
    "the prompt won't be too long",
    "the prompt cannot be too long",
    "too many tokens, not because of a request_size_limit_exceeded error, 60 requests per minute",
  ]
  // CONSTRAINT (#509-FIX20): класс фактического отказа собирается для ВСЕХ
  // хвостов до первого сравнения -- провал ранней строки не прячет остальные.
  const rows = tails.map((tail) => ({ tail, expected: "temporary-unknown", actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX20 P8: положительный размер переживает соседнее отрицание длительности/be, а временной маркер не немится чужим отрицанием у 400", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T15:30:00Z")
  // CONSTRAINT (#509-FIX20): ожидание задано В КАЖДОЙ строке -- смешанный
  // блок, одна неправильная строка не прячет другие.
  const rows: Array<[string, string]> = [
    ["the prompt didn't take too long the payload is too long", "request"],
    ["the prompt should not be too long but the payload is too long", "request"],
    ["request_size_limit_exceeded", "request"],
    ["the payload is too long", "request"],
    ["didn't run-length too long", "request"],
    ["the request has not run the request timed out the prompt is too long", "temporary-unknown"],
    ["the request didn't run the payload timeout the prompt is too long", "temporary-unknown"],
    ["the prompt wasn't taking the request timed out the prompt is too long", "temporary-unknown"],
  ]
  const got = rows.map(([tail, expected]) => ({ tail, expected, actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(got.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX21 N9: сжатые модальные отрицания be/take/run, самостоятельный временной маркер после отрицённого take и порядок прилагательное→артикль у 400 -- temporary-unknown, лестницу не прекращать", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T16:10:00Z")
  // CONSTRAINT (#509-FIX21): строки не содержат отдельного положительного
  // размера -- его отсутствие обязательное условие класса этой группы.
  const tails = [
    "the prompt wouldn't be too long",
    "the prompt shouldn't be too long",
    "the prompt mustn't be too long",
    "the request wouldn't take prompt too long",
    "the prompt shouldn't run the payload too long",
    "the request mustn't take the context too long",
    "the prompt didn't take timeout the prompt is too long",
    "the prompt didn't take timed out the prompt is too long",
    "the prompt didn't take deadline the prompt is too long",
    "the request did not take deadline the prompt is too long",
    "the request didn't take the entire payload too long",
    "the request didn't take entire the payload too long",
  ]
  // CONSTRAINT (#509-FIX21): класс фактического отказа собирается для ВСЕХ
  // хвостов до первого сравнения -- провал ранней строки не прячет остальные.
  const rows = tails.map((tail) => ({ tail, expected: "temporary-unknown", actual: cr("API Error: 400 " + tail, now, "gpt-6-astra").class }))
  expect(rows.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX21 P9: двойное отрицание be, самостоятельная следующая причина и статусный приоритет 413/quota/401/403/404 у отрицённых форм -- размер остаётся request", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T16:30:00Z")
  // CONSTRAINT (#509-FIX21): ожидание задано В КАЖДОЙ строке -- смешанный блок
  // с временными противоконтролями, одна неправильная строка не прячет другие.
  const rows: Array<[string, string]> = [
    ["API Error: 400 the prompt can't not be too long", "request"],
    ["API Error: 400 the request cannot not be too long", "request"],
    ["API Error: 400 the prompt can't not take too long", "temporary-unknown"],
    ["API Error: 400 the prompt shouldn't be too long but the payload is too long", "request"],
    ["API Error: 400 the prompt didn't take timeout, the payload is too long", "request"],
    ["API Error: 400 the request didn't take entire the payload too long, the payload is too long", "request"],
    ["API Error: 413 the prompt wouldn't be too long", "request"],
    ["API Error: 401 the prompt wouldn't be too long", "permanent-model"],
    ["API Error: 403 the prompt wouldn't be too long", "permanent-model"],
    ["API Error: 404 the prompt wouldn't be too long", "permanent-model"],
    ["API Error: 402 the prompt wouldn't be too long", "quota"],
  ]
  const got = rows.map(([line, expected]) => ({ line, expected, actual: cr(line, now, "gpt-6-astra").class }))
  expect(got.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX22 P10: развёрнутые и сжатые двойные отрицания be -- request; одиночная отрицённая be и временная take-форма -- temporary-unknown", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T17:10:00Z")
  // CONSTRAINT (#509-FIX22): ожидание задано В КАЖДОЙ строке -- смешанный блок
  // с одиночной развёрнутой, сжатыми двойными, положительной и отрицённой
  // соседней причиной после but, временной take-формой и статусным 413;
  // одна неправильная строка не прячет другие.
  const rows: Array<[string, string]> = [
    ["API Error: 400 the prompt will not not be too long", "request"],
    ["API Error: 400 the request would not not be too long", "request"],
    ["API Error: 400 the prompt should not not be too long", "request"],
    ["API Error: 400 the request must not not be too long", "request"],
    ["API Error: 400 the prompt can not not be too long", "request"],
    ["API Error: 400 the request could not not be too long", "request"],
    ["API Error: 400 the prompt would not be too long", "temporary-unknown"],
    ["API Error: 400 the prompt can't not be too long", "request"],
    ["API Error: 400 the request cannot not be too long", "request"],
    ["API Error: 400 the prompt would not not be too long but the payload is too long", "request"],
    ["API Error: 400 the prompt would not not be too long but the payload would not be too long", "request"],
    ["API Error: 400 the prompt can't not take too long", "temporary-unknown"],
    ["API Error: 413 the request would not not be too long", "request"],
    ["API Error: 413 the request would not be too long", "request"],
  ]
  const got = rows.map(([line, expected]) => ({ line, expected, actual: cr(line, now, "gpt-6-astra").class }))
  expect(got.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX22 P11: отрицание be не переносится на следующий размерный кандидат", () => {
  const cr = R514.classifyRefusal
  const now = Date.parse("2026-10-09T17:10:00Z")
  // CONSTRAINT (#509-FIX22 P11): обе строки — одиночное «would not be» и
  // следующий размер в той же части, без разделителя. Ожидание request
  // задано в каждой строке: отрицание не переносится на второй кандидат.
  // Это не отрицённый сосед за but.
  const rows: Array<[string, string]> = [
    ["API Error: 400 the prompt would not be too long the payload is too long", "request"],
    ["API Error: 400 the prompt would not be too long since the payload is too long", "request"],
  ]
  const got = rows.map(([line, expected]) => ({ line, expected, actual: cr(line, now, "gpt-6-astra").class }))
  expect(got.filter((r) => r.expected !== r.actual)).toEqual([])
})

test("#509-FIX11 B5: срок «soonest recovery in» -- числовой unit после разобранной части ломает порядок h/m/s: укороченного ложного срока нет", () => {
  const q = R514.quotaRecoveryMsOf
  expect(typeof q, "quotaRecoveryMsOf экспортирована").toBe("function")
  const rows: Array<[string, number]> = [
    ["soonest recovery in 2m 1h", -1],
    ["soonest recovery in 45s 1m", -1],
    ["soonest recovery in 1h2m3s", 3723000],
    ["soonest recovery in 1h 2m 3s", 3723000],
    ["soonest recovery in 30m", 1800000],
    ["soonest recovery in 1h2m3s.", 3723000],
    ["soonest recovery in 2m0s", 120000],
  ]
  for (const [tail, ms] of rows) {
    expect({ tail, got: q("API Error: 503 auth_unavailable (model=x; last upstream error: quota); " + tail) }).toEqual({ tail, got: ms })
  }
})
