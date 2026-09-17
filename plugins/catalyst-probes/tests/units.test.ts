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
  MOD_VERSION, RUNG_COOLDOWN_MS, noteRungTimeout, rungsAfterCooldown,
  failoverLadder, nextFailoverModel, failoverAttemptModels,
  isCarrierRefusal, FAILOVER_MAX_NEXT, FAILOVER_BIND_CAP,
  failoverBindSet, failoverBindGet, failoverBindReset,
  FAILOVER_FOLD_PERIOD_MS, failoverAttemptIsBoring,
  failoverFoldCount, failoverFoldNote, failoverFoldFlush, failoverFoldReset,
  failoverFoldObserve, failoverWouldSetSticky,
  sessionExecutorHas, sessionExecutorModelAdd, sessionExecutorsReset,
  cooldownSnapshot, ladderCommandText, clipLadderArg,
  LADDER_COMMAND, LADDER_COMMAND_DESCRIPTION, LADDER_COMMAND_ARG_HINT,
  LADDER_COMMAND_ARG_MAX, register,
  COACHING, COACHING_SPLICE_SHA256,
} from "../hooks/register.ts"

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
  const marks = new Map<string, number>([["cold", 0]])
  expect(rungsAfterCooldown(ladder, 1, marks).ladder).toEqual([ladder[1]])
  expect(rungsAfterCooldown(ladder, RUNG_COOLDOWN_MS, marks).ladder).toEqual([ladder[1]])
  expect(ladder.length).toBe(2)
})

test("rung-cooldown: просроченная метка возвращает ступень", () => {
  const ladder = [{ model: "expired" }, { model: "ready" }]
  const marks = new Map<string, number>([["expired", 10]])
  expect(rungsAfterCooldown(ladder, 10 + RUNG_COOLDOWN_MS + 1, marks).ladder).toEqual(ladder)
  expect(rungsAfterCooldown(ladder, 10, new Map()).ladder).toEqual(ladder)
})

test("rung-cooldown: все метки не вырождают лестницу", () => {
  const ladder = [{ model: "a", max_tokens: 17 }, { model: "b", effort: "max" }]
  const marks = new Map<string, number>([["a", 100], ["b", 100]])
  expect(rungsAfterCooldown(ladder, 101, marks).ladder).toEqual(ladder)
  expect(rungsAfterCooldown([ladder[0]], 101, marks).ladder).toEqual([ladder[0]])
  expect(rungsAfterCooldown([], 101, marks).ladder).toEqual([])
})

test("rung-cooldown: метка только на rung-deadline", () => {
  const marks = new Map<string, number>()
  expect(noteRungTimeout("deadline", "Error: rung-deadline deadline 240000ms", 10, marks)).toBe(true)
  expect(marks.get("deadline")).toBe(10)
  expect(noteRungTimeout("deadline", "Error: rung-deadline deadline 240000ms", 20, marks)).toBe(true)
  expect(marks.get("deadline")).toBe(20)
  for (const errText of ["", "carrier refusal", "BLOCK: retry", "cancelled"]) {
    expect(noteRungTimeout("other", errText, 30, marks)).toBe(false)
    expect(marks.has("other")).toBe(false)
  }
  expect(noteRungTimeout("deadline", "carrier refusal", 30, marks)).toBe(false)
  expect(marks.get("deadline")).toBe(20)
})

test("rung-cooldown: улика называет только фактические пропуски и возраст", () => {
  const ladder = [{ model: "cold" }, { model: "ready" }]
  const marks = new Map<string, number>([["cold", 100]])
  expect(rungsAfterCooldown(ladder, 123, marks).evidence).toEqual({
    rungCooldownSkipped: ["cold"], rungCooldownAgeMs_cold: 23,
  })
  expect(rungsAfterCooldown(ladder, 123, new Map()).evidence).toEqual({})
  expect(rungsAfterCooldown([ladder[0]], 123, marks).evidence).toEqual({})
  expect(rungsAfterCooldown(ladder, 100 + RUNG_COOLDOWN_MS + 1, marks).evidence).toEqual({})
})

test("rung-cooldown: урезанный бюджет считается таймаутом без метки", () => {
  const marks = new Map<string, number>()
  const error = "Error: rung-deadline model 10ms"
  expect(noteRungTimeout("model", error, 10, marks, true)).toBe(true)
  expect(marks.has("model")).toBe(false)
  expect(noteRungTimeout("model", error, 20, marks, false)).toBe(true)
  expect(marks.get("model")).toBe(20)
  expect(noteRungTimeout("model", error, 30, marks, true)).toBe(true)
  expect(marks.get("model")).toBe(20)
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
  expect(MOD_VERSION).toBe("0.1.33")
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
  failoverFoldReset()
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

test("failoverWouldSetSticky: бросок, отказ носителя, совпадение проверяющего -- false", () => {
  sessionExecutorsReset()
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
})

// --- #178w3: слэш-команда catalyst-ladder ---------------------------------------
// CONSTRAINT: хостовая половина двери $.command.register в харнесе ЗАМОКАНА
// (волна 1 #178: «no implementation for command.register» на всех валидных
// спеках), поэтому зубы пинят НАШУ сторону -- подачу, обрезку и проводку, --
// а не ответ хоста.

test("ladder-cmd: snapshot возвращает остывающие с убывающим остатком; истёкшая не возвращается", () => {
  const marks = new Map<string, number>([["glm-5.3", 1000], ["grok-4.6", 2000]])
  const a = cooldownSnapshot(61000, marks)
  expect(a).toStrictEqual([
    { model: "glm-5.3", leftMs: RUNG_COOLDOWN_MS - 60000 },
    { model: "grok-4.6", leftMs: RUNG_COOLDOWN_MS - 59000 },
  ])
  const b = cooldownSnapshot(62000, marks)
  expect(b[0].leftMs).toBeLessThan(a[0].leftMs)
  // граница окна ровно: ещё остывает (тот же предикат, что у фильтра лестницы)
  expect(cooldownSnapshot(1000 + RUNG_COOLDOWN_MS, new Map([["edge", 1000]])))
    .toStrictEqual([{ model: "edge", leftMs: 0 }])
  expect(cooldownSnapshot(1001 + RUNG_COOLDOWN_MS, new Map([["old", 1000]])))
    .toStrictEqual([])
})

test("ladder-cmd: ПУСТО не НОЛЬ -- без остывающих текст говорит об этом явно", () => {
  const empty = new Map<string, number>()
  expect(cooldownSnapshot(12345, empty)).toStrictEqual([])
  const text0 = ladderCommandText(12345, "", empty)
  expect(text0).toContain("остывающих ступеней нет")
  // положительный контроль: тот же вызов с непустой картой несёт модель
  const marks = new Map<string, number>([["glm-5.3", 100]])
  const text1 = ladderCommandText(12345, "", marks)
  expect(text1).toContain("glm-5.3")
  expect(text1.indexOf("остывающих ступеней нет")).toBe(-1)
})

test("ladder-cmd: текст несёт версию мода и окно остывания", () => {
  const marks = new Map<string, number>([["glm-5.3", 0]])
  const text = ladderCommandText(1, "", marks)
  expect(text).toContain(MOD_VERSION)
  expect(text).toContain((RUNG_COOLDOWN_MS / 60000) + " мин")
})

test("ladder-cmd: фильтр-подстрока оставляет совпавшие; пусто после фильтра -- явная строка", () => {
  const marks = new Map<string, number>([["glm-5.3", 0], ["grok-4.6", 0]])
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
  const subs: Array<{ ev: string; matcher: any; fn: any }> = []
  register((...a: any[]) => {
    if (a.length >= 3) subs.push({ ev: a[0], matcher: a[1], fn: a[2] })
    else subs.push({ ev: a[0], matcher: null, fn: a[1] })
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
})
