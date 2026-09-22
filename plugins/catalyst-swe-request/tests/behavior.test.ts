// Behavior teeth for plugins/catalyst-swe-request on the official harness
// (`claude plugin test`).
import { test, expect } from "claude-code/testing"
import { register, RULE } from "../hooks/register.ts"
import { applyRule } from "./applier-replica.ts"

const NAMED_PREFIX = "catalyst-swe-request: requestText unavailable:"
const CODING_AGENT = "You are a coding agent."
const MODELS_LINE = "- The most recent Claude models are Claude 5 and Claude 4.5."
const EMOJI_IN = "For clear communication with the user the assistant MUST avoid using emojis."
const EMOJI_OUT = "For clear communication with the user, avoid using emojis."
const READ_IN = "Reads a file from the local filesystem. You can access any file directly by using this tool."
const READ_OUT = "Reads a file from the local filesystem."

// CONSTRAINT: модуль экспортирует register и RULE, но не сам обработчик —
// единственный путь позвать обработчик с подставным $ (зубы «путь обращения»
// и «проброс отказа») — исполнить register с фейковым `on` и перехватить его.
function handlerOf(): any {
  let handler: any = null
  register(((event: string, h: any) => {
    if (event === "session.start") handler = h
  }) as any)
  return handler
}

// CONSTRAINT: op ищется ПРЕДИКАТОМ ПО СОДЕРЖАНИЮ, не индексом: порядок между
// тремя якорными вариантами контрактом не определён (DOOR-DESIGN.md:78-79).
function only(pred: (op: any) => boolean, what: string): any {
  const hit = (RULE.ops as any[]).filter(pred)
  expect(hit.length, "the predicate selects exactly one op: " + what).toBe(1)
  return hit[0]
}

function runOps(ops: any[], body: any): any {
  return applyRule({ model: RULE.model, ops }, body)
}

function sys(ops: any[], text: string): string {
  return runOps(ops, { model: "devin/swe-2", system: text }).system
}

const ANCHORED = [
  {
    what: "long SDK variant",
    phrase: "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.",
    pred: (op: any) =>
      op.to === CODING_AGENT && typeof op.pattern === "string" &&
      op.pattern.includes("running within the Claude Agent SDK"),
  },
  {
    what: "short CLI variant",
    phrase: "You are Claude Code, Anthropic's official CLI for Claude.",
    pred: (op: any) =>
      op.to === CODING_AGENT && typeof op.pattern === "string" &&
      op.pattern.includes("official CLI for Claude") && !op.pattern.includes("Claude Agent SDK"),
  },
  {
    what: "agent-on-SDK variant",
    phrase: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
    pred: (op: any) =>
      op.to === CODING_AGENT && typeof op.pattern === "string" &&
      op.pattern.includes("built on Anthropic's Claude Agent SDK"),
  },
]

test("ноуна нет ⇒ именованная строка и бросок", async ($: any, on: any) => {
  let logged = ""
  // CONSTRAINT: возврат { value: undefined } — единственная форма, которую
  // хост не считает пропуском хука; undefined или {} глотают событие.
  // CONSTRAINT: событие ui.log несёт текст в поле text (замерено на живом
  // харнесе: {"text": ..., "to": "transcript"}).
  on("ui.log", (_$: any, e: any) => {
    logged += String(e?.text ?? e)
    return { value: undefined }
  })
  // CONSTRAINT: без собственного дна session.start хост отвечает
  // «no implementation for session.start» — ноун событие, а не процедура.
  on("session.start", ($$: any, e: any, _next: any) => ({ cwd: e.cwd }))
  // CONSTRAINT: брошенное из session.start НЕ реджектит вызов и НЕ рвёт
  // цепочку (замер живого харнеса: движок помечает хук skipped и едет дальше
  // к дну) — из теста бросок наблюдаем только именованной строкой в ui.log;
  // она появляется в catch и несёт причину отказа.
  await $.session.start({ cwd: "/swe-request-home", surface: null, isInteractive: false })
  expect(logged, "the named line reaches the ui.log interception").toContain(NAMED_PREFIX)
})

test("отказ ноуна пробрасывается, next не зовётся; на успехе next зовётся", async () => {
  const handler = handlerOf()
  let logged = ""
  let nextCalled = 0
  const failing$: any = {
    requestText: { register: async () => { throw new Error("boom") } },
    ui: { log: (s: any) => { logged += String(s) } },
  }
  let rejected: any = null
  try {
    await handler(failing$, {}, async () => { nextCalled++ })
  } catch (x: any) {
    rejected = x
  }
  expect(rejected !== null, "the handler call rejects").toBe(true)
  expect(String(rejected?.message ?? rejected), "the original cause is rethrown").toContain("boom")
  expect(nextCalled, "next is not called after a refusal").toBe(0)
  expect(logged, "the named line carries the cause").toContain(NAMED_PREFIX)

  // CONSTRAINT: успешная ветка — единственное наблюдаемое место `return next(e)`;
  // без него цепочка хуков обрывается молча и зуб выше этого не видит.
  let passed = 0
  const ok$: any = { requestText: { register: async () => undefined }, ui: { log: () => {} } }
  const out = await handler(ok$, { cwd: "/x" }, async (e: any) => { passed++; return { seen: e } })
  expect(passed, "next is called once on the success path").toBe(1)
  expect(out?.seen?.cwd, "the handler returns what next returned").toBe("/x")
})

test("путь обращения к ноуну — ровно requestText.register", async () => {
  const handler = handlerOf()
  const seen: string[] = []
  const probe$: any = new Proxy({}, {
    get(_t: any, noun: any) {
      if (typeof noun === "symbol") return undefined
      return new Proxy({}, {
        get(_t2: any, op: any) {
          if (typeof op === "symbol") return undefined
          return (..._args: any[]) => {
            seen.push(String(noun) + "." + String(op))
            return Promise.resolve()
          }
        },
      })
    },
  })
  await handler(probe$, {}, async () => undefined)
  expect(seen.length, "exactly one noun operation is called").toBe(1)
  expect(seen[0], "the full access path").toBe("requestText.register")
})

// CONSTRAINT: проверки формы живут ОДНОЙ функцией: их применяют и к литералу
// RULE, и к объекту, фактически ушедшему в `$.requestText.register` — две
// копии проверок разошлись бы молча.
function expectRuleShape(rule: any, where: string): void {
  expect(rule?.model, where + ": the policy targets devin/swe-2").toBe("devin/swe-2")
  expect((rule?.ops as any[])?.length, where + ": six policy operations").toBe(6)
  for (const op of rule.ops as any[]) {
    const hasFind = Object.prototype.hasOwnProperty.call(op, "find")
    const hasPattern = Object.prototype.hasOwnProperty.call(op, "pattern")
    expect(hasFind !== hasPattern, where + ": exactly one of find/pattern: " + JSON.stringify(op)).toBe(true)
    // CONSTRAINT: присутствующий ключ обязан быть НЕПУСТОЙ строкой — пустая
    // строка оставляет op синтаксически валидной, но политически мёртвой
    // (пустой `pattern` совпадает везде, пустой `find` не режет текст).
    const key = hasPattern ? "pattern" : "find"
    expect(typeof op[key] === "string" && op[key].length > 0,
      where + ": the present key is a non-empty string: " + JSON.stringify(op)).toBe(true)
    expect(typeof op.to, where + ": to is a string: " + JSON.stringify(op)).toBe("string")
    if (hasPattern) {
      new RegExp(op.pattern, op.flags)
      expect(typeof op.flags, where + ": a pattern-op carries its flags").toBe("string")
    } else {
      expect(op.flags === undefined, where + ": flags appear only on pattern-ops").toBe(true)
    }
  }
}

test("форма правила", async () => {
  expectRuleShape(RULE, "the RULE literal")
})

for (const a of ANCHORED) {
  test("якорное правило: " + a.what, async () => {
    const op = only(a.pred, a.what)
    expect(sys([op], "Head line.\n" + a.phrase + "\nTail line."), "a whole line inside a multiline text is rewritten")
      .toBe("Head line.\n" + CODING_AGENT + "\nTail line.")
    const see = "see: " + a.phrase
    expect(sys([op], see), "the same phrase with a prefix on its line stays untouched").toBe(see)
    // CONSTRAINT: `$` при флаге m совпадает и ПЕРЕД CR — CRLF обязан пережить
    // замену; возврат `\r?` в якорь съедает CR (DOOR-DESIGN.md §3.4).
    expect(sys([op], "Head line.\r\n" + a.phrase + "\r\nTail line."), "CRLF survives the rewrite")
      .toBe("Head line.\r\n" + CODING_AGENT + "\r\nTail line.")
  })
}

test("правило строки моделей: строка удаляется в четырёх формах", async () => {
  const op = only(
    (o: any) => typeof o.pattern === "string" && o.pattern.includes("The most recent Claude models are"),
    "models line",
  )
  expect(sys([op], "Head.\n" + MODELS_LINE + "\nTail."), "LF, in the middle").toBe("Head.\nTail.")
  expect(sys([op], "Head.\r\n" + MODELS_LINE + "\r\nTail."), "CRLF, in the middle").toBe("Head.\r\nTail.")
  expect(sys([op], MODELS_LINE + "\nTail."), "the first line of the text").toBe("Tail.")
  expect(sys([op], "Head.\n" + MODELS_LINE), "the last line without a terminator").toBe("Head.")
})

test("эмодзи-правило: вхождение заменено, соседний текст цел", async () => {
  const op = only((o: any) => typeof o.find === "string" && o.tool === undefined, "emoji literal")
  expect(sys([op], "Before. " + EMOJI_IN + " After."), "the literal is replaced in place")
    .toBe("Before. " + EMOJI_OUT + " After.")
})

test("Read-правило: только инструмент с именем Read", async () => {
  const op = only((o: any) => o.tool === "Read", "Read tool description")
  const other = { name: "Write", description: "Head. " + READ_IN + " Tail." }
  const body = runOps([op], {
    model: "devin/swe-2",
    tools: [{ name: "Read", description: "Head. " + READ_IN + " Tail." }, other],
  })
  expect(body.tools[0].description, "the Read description is shortened")
    .toBe("Head. " + READ_OUT + " Tail.")
  expect(body.tools[1].description, "a tool with another name is untouched")
    .toBe("Head. " + READ_IN + " Tail.")
  expect(body.tools[1] === other, "an unchanged element is returned as the same object").toBe(true)
})

const COMBINED_IN = [
  "Intro.",
  ANCHORED[2].phrase,
  ANCHORED[1].phrase,
  ANCHORED[0].phrase,
  MODELS_LINE,
  EMOJI_IN,
  "Outro.",
].join("\n")
const COMBINED_OUT = ["Intro.", CODING_AGENT, CODING_AGENT, CODING_AGENT, EMOJI_OUT, "Outro."].join("\n")

test("всё правило целиком: строковый system, массив блоков, чужая модель", async () => {
  expect(applyRule(RULE, { model: "devin/swe-2", system: COMBINED_IN }).system, "string system").toBe(COMBINED_OUT)

  const blocks = [{ type: "text", text: COMBINED_IN }, { type: "text", text: "untouched block" }]
  const body = applyRule(RULE, {
    model: "devin/swe-2",
    system: blocks,
    tools: [{ name: "Read", description: READ_IN }],
  })
  expect(body.system[0].text, "a changed block carries the rewritten text").toBe(COMBINED_OUT)
  expect(body.system[0] !== blocks[0], "a changed block is a new object").toBe(true)
  expect(body.system[1] === blocks[1], "an unchanged block is the same object").toBe(true)
  expect(body.tools[0].description, "the Read description is shortened").toBe(READ_OUT)

  // CONSTRAINT: правило применяется только к своей модели — совпадение по
  // префиксу имени с границей (?![\w.-]), иначе тело возвращается как есть.
  const foreign = { model: "claude-opus-5", system: COMBINED_IN }
  expect(applyRule(RULE, foreign).system, "a foreign model is left untouched").toBe(COMBINED_IN)
})

test("порядок трёх якорных вариантов свободен", async () => {
  const ops = RULE.ops as any[]
  const anchored = ANCHORED.map((a) => only(a.pred, a.what))
  const rest = ops.filter((op) => !anchored.includes(op))
  const permuted = [anchored[2], anchored[1], anchored[0], ...rest]
  expect(permuted.length, "the permutation keeps every op").toBe(ops.length)
  expect(sys(permuted, COMBINED_IN), "a permutation of the three anchored ops changes nothing")
    .toBe(COMBINED_OUT)
})

// CONSTRAINT: канонизация RULE — JSON.stringify объекта { model, ops }, где
// каждая op сначала выписана JSON-строкой с ключами в ФИКСИРОВАННОМ порядке
// ["tool","pattern","find","flags","to"] (отсутствующие ключи опускаются), а
// массив этих строк ОТСОРТИРОВАН: порядок op контрактом не определён
// (DOOR-DESIGN.md:78-79), поэтому пин обязан быть слеп к перестановке и зряч
// к тексту.
// CONSTRAINT: шесть строк политики — ДАННЫЕ, на которых замерен переход
// 403 → 200 у devin/swe-2; менять пин можно только вместе с новым A/B-замером.
const POLICY_SHA256 = "38c802b0d26fa141d94dbc601730ff07c2e617c139d03fc1e37530b090660df6"
const CANON_KEY_ORDER = ["tool", "pattern", "find", "flags", "to"]

test("неизменяемость входных структур: без нужных op ничего не пересоздаётся", async () => {
  const anchored = ANCHORED.map((a) => only(a.pred, a.what))
  const readOp = only((o: any) => o.tool === "Read", "Read tool description")

  const tools = [{ name: "Read", description: READ_IN }]
  const out1 = applyRule({ model: RULE.model, ops: anchored }, { model: "devin/swe-2", system: "Intro.", tools })
  expect(out1.tools === tools, "a rule without tool-ops keeps the very same tools array").toBe(true)

  const foreignTool = { name: "Write", description: READ_IN }
  const out2 = applyRule({ model: RULE.model, ops: [readOp] }, { model: "devin/swe-2", tools: [foreignTool] })
  expect(out2.tools[0] === foreignTool, "a tool the op does not match stays the same object").toBe(true)

  const sysBlocks = [{ type: "text", text: COMBINED_IN }]
  const out4 = applyRule({ model: RULE.model, ops: [readOp] }, {
    model: "devin/swe-2",
    system: sysBlocks,
    tools: [{ name: "Read", description: READ_IN }],
  })
  expect(out4.system === sysBlocks, "a rule without system-ops keeps the very same system array").toBe(true)

  const blocks = [{ type: "text", text: COMBINED_IN }, { type: "text", text: "untouched block" }]
  const out3 = applyRule(RULE, {
    model: "devin/swe-2",
    system: blocks,
    tools: [{ name: "Read", description: READ_IN }],
  })
  expect(out3.system[1] === blocks[1], "an unchanged block stays the same object").toBe(true)
  expect(out3.system[0] !== blocks[0], "a changed block is a new object").toBe(true)
})

test("тождество контейнера: без единого изменения массивы остаются ТЕМИ ЖЕ", async () => {
  // CONSTRAINT: положительный контроль присутствия ВХОДОВ — обе ветки дома
  // ОБЯЗАНЫ быть пройдены (op системные и инструментальные в правиле есть,
  // модель своя), иначе зуб зелен по причине «ветка не исполнялась».
  const hasSysOp = (RULE.ops as any[]).some((o: any) => o.tool === undefined)
  const hasToolOp = (RULE.ops as any[]).some((o: any) => o.tool !== undefined)
  expect(hasSysOp && hasToolOp, "the rule carries both system-ops and tool-ops").toBe(true)

  const blocks = [{ type: "text", text: "nothing here matches" }, { type: "text", text: "nor here" }]
  const tools = [{ name: "Read", description: "an unknown Read description" }, { name: "Write", description: "untouched" }]
  const body = { model: "devin/swe-2", system: blocks, tools }
  const out = applyRule(RULE, body)
  expect(out.system === blocks, "no block changed ⇒ the very same system array").toBe(true)
  expect(out.tools === tools, "no description changed ⇒ the very same tools array").toBe(true)
  expect(out.system[0] === blocks[0], "an unchanged block is the same object").toBe(true)
  expect(out.tools[0] === tools[0], "an unchanged tool is the same object").toBe(true)
})

test("бросок самого логгера не подменяет причину отказа", async () => {
  const handler = handlerOf()
  let logCalls = 0
  const broken$: any = {
    requestText: { register: async () => { throw new Error("boom") } },
    ui: { log: () => { logCalls++; throw new Error("logger is down") } },
  }
  let rejected: any = null
  try {
    await handler(broken$, {}, async () => undefined)
  } catch (x: any) {
    rejected = x
  }
  // положительный контроль: логгер действительно был позван, иначе зуб вакуумен
  expect(logCalls, "the logger was actually called").toBe(1)
  expect(String(rejected?.message ?? rejected), "the ORIGINAL cause reaches the caller").toContain("boom")
})

async function policyDigest(rule: any): Promise<string> {
  const ops = (rule.ops as any[]).map((op) => {
    const o: any = {}
    for (const k of CANON_KEY_ORDER) if (Object.prototype.hasOwnProperty.call(op, k)) o[k] = op[k]
    return JSON.stringify(o)
  }).sort()
  const canon = JSON.stringify({ model: rule.model, ops })
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

test("пин паритета текста политики", async () => {
  expect(await policyDigest(RULE), "the policy text is the one the 403 → 200 A/B was measured on").toBe(POLICY_SHA256)
})

test("зарегистрирован ФАКТИЧЕСКИЙ аргумент вызова register, не литерал RULE", async () => {
  const handler = handlerOf()
  const sent: any[] = []
  const spy$: any = {
    requestText: { register: async (rule: any) => { sent.push(rule) } },
    ui: { log: () => {} },
  }
  await handler(spy$, {}, async () => undefined)
  // CONSTRAINT: положительный контроль — без состоявшегося вызова проверки
  // ниже вакуумны.
  expect(sent.length, "register received exactly one argument list").toBe(1)
  expectRuleShape(sent[0], "the argument actually passed to register")
  expect(await policyDigest(sent[0]), "the SENT policy is the pinned text, not just the literal").toBe(POLICY_SHA256)
})

test("два вхождения в ОДНОМ теле: заменены оба (флаг g у шаблонных правил)", async () => {
  for (const a of ANCHORED) {
    const op = only(a.pred, a.what)
    expect(sys([op], ["Head.", a.phrase, "Mid.", a.phrase, "Tail."].join("\n")),
      "both occurrences are rewritten: " + a.what)
      .toBe(["Head.", CODING_AGENT, "Mid.", CODING_AGENT, "Tail."].join("\n"))
  }
  const modelsOp = only(
    (o: any) => typeof o.pattern === "string" && o.pattern.includes("The most recent Claude models are"),
    "models line",
  )
  expect(sys([modelsOp], ["Head.", MODELS_LINE, "Mid.", MODELS_LINE, "Tail."].join("\n")),
    "both model lines are removed").toBe(["Head.", "Mid.", "Tail."].join("\n"))
  // CONSTRAINT: литеральная op режет текст split/join — все вхождения по
  // построению; зуб держит и её, чтобы правило «оба вхождения» не зависело от
  // того, каким видом op записана строка.
  const emojiOp = only((o: any) => typeof o.find === "string" && o.tool === undefined, "emoji literal")
  expect(sys([emojiOp], EMOJI_IN + " / " + EMOJI_IN), "both literal occurrences are replaced")
    .toBe(EMOJI_OUT + " / " + EMOJI_OUT)
})

test("чужая модель: возвращается ТОТ ЖЕ объект тела", async () => {
  const tools = [{ name: "Read", description: READ_IN }]
  const foreign = { model: "claude-opus-5", system: COMBINED_IN, tools }
  const out = applyRule(RULE, foreign)
  expect(out === foreign, "a foreign model gets the very same body object back").toBe(true)
  expect(out.tools === tools, "and the very same tools array").toBe(true)
  expect(out.tools[0].description, "with the description untouched").toBe(READ_IN)
})

test("строка ui.log несёт ПРИЧИНУ отказа, а не только факт вызова", async () => {
  const handler = handlerOf()
  const lineFor = async (cause: string): Promise<string> => {
    let logged = ""
    const failing$: any = {
      requestText: { register: async () => { throw new Error(cause) } },
      ui: { log: (s: any) => { logged += String(s) } },
    }
    try { await handler(failing$, {}, async () => undefined) } catch {}
    return logged
  }
  const first = await lineFor("the noun is absent on this build")
  expect(first, "the line names the plugin").toContain(NAMED_PREFIX)
  expect(first, "the line carries the cause text").toContain("the noun is absent on this build")
  // CONSTRAINT: постоянная строка прошла бы проверку выше, если бы причина
  // случайно совпала с константой — две РАЗНЫЕ причины обязаны дать две
  // разные строки.
  const second = await lineFor("the rule table is frozen")
  expect(second, "the second line carries its own cause").toContain("the rule table is frozen")
  expect(second !== first, "two different causes give two different lines").toBe(true)
})
