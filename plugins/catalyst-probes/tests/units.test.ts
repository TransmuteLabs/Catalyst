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
  isCarrierRefusal, FAILOVER_MAX_NEXT, FAILOVER_BIND_CAP, chunkCarriesContent,
  failoverBindSet, failoverBindGet, failoverBindReset,
  FAILOVER_FOLD_PERIOD_MS, FOLD_ARM_RETRY_MS, failoverAttemptIsBoring, armFailoverFoldTimer,
  failoverFoldCount, failoverFoldNote, failoverFoldFlush, failoverFoldReset, failoverFoldWriteErr, failoverFoldSplitLost, failoverFoldResetLost,
  failoverFoldObserve, failoverWouldSetSticky,
  sessionExecutorHas, sessionExecutorModelAdd, sessionExecutorsReset,
  cooldownSnapshot, ladderCommandText, clipLadderArg,
  isModelCooling, noteRungCarrierRefusal, deferCoolingAttemptModels, rungCooldownReset,
  LADDER_COMMAND, LADDER_COMMAND_DESCRIPTION, LADDER_COMMAND_ARG_HINT,
  LADDER_COMMAND_ARG_MAX, register,
  COACHING, COACHING_SPLICE_SHA256,
} from "../hooks/register.ts"
// CONSTRAINT (#393-A2): lostWrites -- состояние МОДУЛЯ, а раннер держит один
// процесс на файл; снапшот читается через namespace-импорт, потому что на коде
// ДО волны экспорта lostWritesSnapshot нет и именованный импорт ронял бы весь
// файл -- красная фаза обязана показывать отказ КАЖДОГО зуба отдельной строкой.
import * as registerModule393 from "../hooks/register.ts"

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
  expect(MOD_VERSION).toBe("0.1.48")
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

test("failoverLadderBind: клетка без лестницы берёт allowed без входящей, порядок табличный", () => {
  const allowed = { "1a": ["glm-5.3-flash", "glm-5.3", "grok-4.6"] }
  const info = failoverLadderBind({}, "any-agent", "1a", allowed, "glm-5.3-flash")
  expect(info.ladder).toStrictEqual(["glm-5.3", "grok-4.6"])
  expect(info.source).toBe("allowed")
})

test("failoverLadderBind: явная поклеточная лестница выигрывает у allowed", () => {
  const fo = parseToml(FAILOVER_TOML).failover
  const allowed = { "exec-0p": ["x1", "x2", "x3"] }
  const info = failoverLadderBind(fo, "other-agent", "exec-0p", allowed, "c1")
  expect(info.ladder).toStrictEqual(["c1", "c2"])
  expect(info.source).toBe("class")
})

test("failoverLadderBind: единственная allowed -- входящая, уровень пуст", () => {
  const allowed = { "1d": ["glm-5.3"] }
  const info = failoverLadderBind({}, "any-agent", "1d", allowed, "glm-5.3")
  expect(info.ladder).toStrictEqual([])
  expect(info.source).toBe("none")
})

test("failoverLadderBind: пустой allowed -- уровень пуст", () => {
  const allowed = { adjudication: [] as string[] }
  const info = failoverLadderBind({}, "any-agent", "adjudication", allowed, "glm-5.3")
  expect(info.ladder).toStrictEqual([])
  expect(info.source).toBe("none")
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

test("failoverLadderBind: ступени allowed несут пустой rungEffort", () => {
  const allowed = { "1a": ["m1", "m2", "m3"] }
  const info = failoverLadderBind({}, "any-agent", "1a", allowed, "m1")
  expect(info.ladder).toStrictEqual(["m2", "m3"])
  expect(info.source).toBe("allowed")
  expect(info.rungEffort).toEqual({})
  expect(info.rungsDropped).toBe(0)
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

test("loadWorld: живой файл таблицы доезжает до ступеней bind", async () => {
  const table = "/tbl-live/routing-table.toml"
  const probes = "/probes-live/probes.toml"
  const files: Record<string, string> = {
    [probes]: "[failover]\nenabled = true\n",
    [table]: "[classes.1a]\nallowed = [\"glm-5.3-flash\", \"glm-5.3\", \"grok-4.6\"]\n",
  }
  const { $ } = fsEnv$(files, {
    CLAUDE_PROBES_DIR: "/probes-live",
    CATALYST_ROUTING_TABLE: table,
  }, 94_000_000)
  const world = await loadWorld($, {
    PROBES_DIR: "/probes-live", ROUTING_TABLE: table, CONFIG_DIR: "", HOME: "", PWD: "/work",
  }, "/work")
  const info = failoverLadderBind(world.failover, "any-agent", "1a", world.allowedByClass, "glm-5.3-flash")
  expect(info.ladder).toStrictEqual(["glm-5.3", "grok-4.6"])
  expect(info.source).toBe("allowed")
  expect(world.allowedSrc).toBe("env")
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
  'git_msg = "zzz-git-msg"',
  'git_push = "zzz-git-push"',
  'git_push_ok = "zzz-git-push-ok"',
  'git_force = "zzz-git-force"',
  'trailer_a = "zzz-trailer-a"',
  'trailer_b = "zzz-trailer-b"',
  'write_redirect = "zzz-write-redirect"',
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
    "/probes-335-i1/probes.toml": "[probe.idle-watch]\nact = \"log_only\"\n",
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
    "/probes-335-i2/probes.toml": "[probe.idle-watch]\nact = \"log_only\"\n",
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
      "[probe.idle-watch]\nenabled = false\n[probe.dead-rule]\nkind = \"consult\"\n" +
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
    "/probes-335-c8/probes.toml": "[probe.idle-watch]\n",
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
  const info = failoverLadderBind(fo, "glm-executor", "exec-0p", { "exec-0p": ["x1", "x2"] }, "a1")
  expect(info.ladder).toStrictEqual(["a1", "a2"])
  expect(info.source).toBe("agent")
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
  expect(failoverWouldSetSticky(true, ok, false, "m")).toBe(false)
  expect(failoverWouldSetSticky(false, empty, false, "m")).toBe(false)
  expect(failoverWouldSetSticky(false, ok, false, "m")).toBe(true)
  sessionExecutorModelAdd("glm-5.3")
  expect(sessionExecutorHas("glm-5.3")).toBe(true)
  expect(failoverWouldSetSticky(false, ok, true, "glm-5.3")).toBe(false)
  expect(failoverWouldSetSticky(false, ok, true, "grok-4.6")).toBe(true)
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
  const $: any = {
    store: { set: async () => {} },
    command: { register: async (spec: any) => { specs.push(spec) } },
  }
  await started[0].fn($, { cwd: "/probe" }, async (x: any) => "NEXT-" + String(x && x.cwd))
  expect(specs.length).toBe(1)
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

test("#313 T3: бросок метки НЕ ставит -- различение #239 цело", async () => {
  failoverBindReset()
  const next = fan313Stream({
    "f313-t3-throw": fan313Throw,
    "f313-t3-ok": () => fan313Ok("t3"),
  })
  const out = await fan313Run("f313-t3", "f313-t3-throw", ["f313-t3-ok"], next)
  expect(out.value && out.value.text).toBe("OK-t3")
  expect(isModelCooling("f313-t3-throw", FAN313_NOW + 1)).toBe(false)
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
  expect(isModelCooling("f313-t7-own", FAN313_NOW + 1), "метка пережила шаг").toBe(true)
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
  expect(others.length, "остальные восемь регистраций -- не стрим").toBe(8)
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
  storeGet?: (key: string) => boolean
  storeSet?: (key: string) => boolean
  storeDelete?: (key: string) => boolean
  storeKeys?: () => boolean
  agentList?: () => boolean
  everyCancel?: boolean
}

function mod$393(o: {
  files?: Record<string, string>
  env?: Record<string, string>
  now?: number
  sid?: string
  stored?: Record<string, unknown>
  answers?: any[]
  envRefuses?: string[]
  fail?: Fail393
}) {
  let now = o.now ?? 97_600_000
  const sid = o.sid ?? "sid-units"
  const writes: { path: string; text: string }[] = []
  const storeSets: { key: string; value: any }[] = []
  const storeDeletes: string[] = []
  const everyCbs: any[] = []
  const store = new Map<string, any>(Object.entries(o.stored || {}))
  const $: any = {
    clock: {
      now: async () => now,
      every: (_ms: number, cb: any) => {
        everyCbs.push(cb)
        return {
          cancel: () => { if (o.fail && o.fail.everyCancel) throw new Error("clock.every: scripted cancel refusal") },
        }
      },
    },
    env: {
      get: async (k: string) => {
        if ((o.envRefuses || []).indexOf(k) >= 0) throw new Error("env.get: scripted read refusal for " + k)
        return (o.env || {})[k] ?? ""
      },
    },
    fs: {
      read: async (p: string) => {
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
    session: { id: async () => sid, messages: async () => [] },
    agent: {
      list: async () => {
        if (o.fail && o.fail.agentList && o.fail.agentList()) throw new Error("agent.list: scripted refusal")
        return []
      },
    },
    model: {
      complete: async (arg: any) => {
        const a = (o.answers || []).shift()
        if (a === undefined) throw new Error("model.complete: no answer scripted for " + String(arg && arg.model))
        return a
      },
    },
    command: { register: async () => {} },
    ui: { toast: async () => {} },
  }
  return { $, writes, storeSets, storeDeletes, store, everyCbs, setNow: (n: number) => { now = n } }
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

async function clear393(): Promise<void> {
  const subs = subs393()
  const cl = subs.filter(s =>
    s.ev === "command.run" && Array.isArray(s.matcher && s.matcher.command) &&
    s.matcher.command.indexOf("clear") >= 0)
  expect(cl.length).toBe(1)
  const m = mod$393({})
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
    files: { "/probes-a2-3006/probes.toml": '[probe.dead3006]\nkind = "consult"\n[probe.dead3006.when]\nfield = "tool"\nmatches = "Age(nt"\n' },
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
  const lines = shards393(m.writes, "/failover/journal.jsonl.shard.")
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
        '[probe.idle-watch]\nact = "log_only"\n[probe.live393]\nkind = "consult"\n[probe.live393.when]\nfield = "live_works"\ncount_below = 1\n',
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
        '[probe.c393cap]\nkind = "consult"\nact = "nudge"\n[probe.c393cap.when]\nfield = "tool_name"\nequals = "Read"\n',
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
    files: { "/probes-a2-cd/probes.toml": '[probe.idle-watch]\nact = "nudge"\n' },
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
        '[probe.f5sum]\nkind = "consult"\nact = "nudge"\n[probe.f5sum.when]\nfield = "tool_name"\nequals = "Read"\n',
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
})
