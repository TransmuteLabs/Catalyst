import { test, expect } from "claude-code/testing"
import { register, RULE_TEXT, formatAlert, __reset, __dedupSize, __dedupAgents, __observed, __bounded, __setWall } from "../hooks/register.ts"
import * as reg from "../hooks/register.ts"

const stopOut = (id: string) => ({ message: "stopped", task_id: id, task_type: "local_bash" })

// CONSTRAINT: модуль не экспортирует обработчики — единственный путь позвать
// их с подставным $ — исполнить register с фейковым `on` и перехватить.
function capture(): {
  step: any
  complete: any
  taskstop: any
  taskstopMatcher: any
  context: any
  sessionEnd: any
} {
  const got: any = {}
  register(((event: string, a: any, b?: any) => {
    if (event === "tool.call") {
      got.taskstopMatcher = a
      got.taskstop = b
    } else if (event === "turn.step") got.step = a
    else if (event === "turn.complete") got.complete = a
    else if (event === "prompt.context") got.context = a
    else if (event === "session.end") got.sessionEnd = a
  }) as any)
  return got
}

const hooks = capture()

function make$(o?: {
  toastThrows?: boolean
  now?: (tick: number) => any
  clockReject?: boolean
  sleep?: (ms: number, options?: any) => Promise<void>
  storeGet?: (key: string) => Promise<any>
  storeSet?: (key: string, value: any) => Promise<void>
  storeDelete?: (key: string) => Promise<void>
  storeKeys?: () => Promise<string[]>
}) {
  const toast: any[] = []
  const status: any[] = []
  const log: any[] = []
  const storeSets: any[] = []
  const storeDeletes: string[] = []
  const sleepCalls: number[] = []
  const sleepOptions: any[] = []
  const storeMap = new Map<string, any>()
  let tick = 0
  let clockCalls = 0
  let fixedNow: number | undefined
  const $ = {
    ui: {
      toast(text: string, options?: any) {
        if (o?.toastThrows) throw new Error("toast-boom")
        toast.push([text, options])
      },
      status(text?: string) {
        status.push(text)
      },
      log(text: string, options?: any) {
        log.push([text, options])
      },
    },
    store: {
      async get(key: string) {
        if (o?.storeGet) return o.storeGet(key)
        return storeMap.has(key) ? storeMap.get(key) : undefined
      },
      async set(key: string, value: any) {
        if (o?.storeSet) await o.storeSet(key, value)
        storeMap.set(key, value)
        storeSets.push([key, value])
      },
      async delete(key: string) {
        if (o?.storeDelete) await o.storeDelete(key)
        storeDeletes.push(key)
        storeMap.delete(key)
      },
      async keys() {
        if (o?.storeKeys) return o.storeKeys()
        return [...storeMap.keys()]
      },
    },
    clock: {
      async now() {
        tick += 1
        clockCalls += 1
        if (o?.clockReject) throw new Error("clock-boom")
        if (fixedNow !== undefined) return fixedNow
        return o?.now ? o.now(tick) : 1_700_000_000_000
      },
      sleep(ms: number, options?: any) {
        // CONSTRAINT: штатный sleep не разрешается никогда — предел ожидания store не срабатывает.
        sleepCalls.push(ms)
        sleepOptions.push(options)
        return o?.sleep ? o.sleep(ms, options) : new Promise<void>(() => {})
      },
    },
  }
  return {
    $,
    toast,
    status,
    log,
    storeSets,
    storeDeletes,
    sleepCalls,
    sleepOptions,
    journal() {
      const out: any[] = []
      for (const [k, v] of storeMap) {
        if (k.startsWith("log:")) out.push(v)
      }
      return out
    },
    logSetCount() {
      let n = 0
      for (const row of storeSets) {
        if (typeof row[0] === "string" && row[0].startsWith("log:")) n += 1
      }
      return n
    },
    setNow(ms: number) {
      fixedNow = ms
    },
    clockCalls: () => clockCalls,
  }
}

async function until(cond: () => boolean, ticks = 1000): Promise<boolean> {
  for (let i = 0; i < ticks && !cond(); i++) await Promise.resolve()
  return cond()
}

function fakeSignal(o?: { removeThrows?: boolean }) {
  const listeners: Array<{ f: () => void; once: boolean }> = []
  const signal: any = {
    aborted: false,
    reason: undefined,
    addEventListener(type: string, f: () => void, opt?: any) {
      if (type === "abort") listeners.push({ f, once: opt?.once === true })
    },
    removeEventListener(type: string, f: () => void) {
      if (o?.removeThrows) throw new Error("remove-boom")
      const i = listeners.findIndex((l) => l.f === f)
      if (type === "abort" && i >= 0) listeners.splice(i, 1)
    },
  }
  return {
    signal,
    listenerCount: () => listeners.length,
    abort() {
      if (signal.aborted) return
      signal.aborted = true
      const reason = new Error("aborted")
      reason.name = "AbortError"
      signal.reason = reason
      for (const l of listeners.slice()) {
        if (l.once) listeners.splice(listeners.indexOf(l), 1)
        l.f()
      }
    },
  }
}

function withSignal<F extends (...args: any[]) => any>(f: F, signal: any): F {
  return Object.assign(f, { signal })
}

const hungClock = () => new Promise<number>(() => {})

async function* chunksOf(chunks: readonly any[], result: any): AsyncGenerator<any, any, any> {
  for (const c of chunks) yield c
  return result
}

async function collect(gen: AsyncGenerator<any, any, any>): Promise<{ chunks: any[]; result: any }> {
  const chunks: any[] = []
  let step = await gen.next()
  while (!step.done) {
    chunks.push(step.value)
    step = await gen.next()
  }
  return { chunks, result: step.value }
}

function refusalChunks() {
  const bash = { kind: "tool", index: 0, id: "tool-bash", name: "Bash" }
  const edit = { kind: "tool", index: 1, id: "tool-edit", name: "Edit" }
  const stop = { kind: "stop", stopReason: "refusal", usage: null }
  const result = { turnId: "t-refusal", index: 0, answer: "", toolUses: [], stopReason: "refusal", usage: null }
  return { chunks: [bash, edit, stop], result }
}

function endTurnChunks() {
  const text = { kind: "text", index: 0, text: "done" }
  const stop = { kind: "stop", stopReason: "end_turn", usage: null }
  const result = { turnId: "t-end", index: 0, answer: "done", toolUses: [], stopReason: "end_turn", usage: null }
  return { chunks: [text, stop], result }
}

async function runStep(env: ReturnType<typeof make$>, chunks: readonly any[], result: any, e: any) {
  return collect(hooks.step(env.$, e, () => chunksOf(chunks, result)))
}

test("T1 step refusal: toast, status, log, store", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  const out = await runStep(env, spec.chunks, spec.result, {
    model: "opus-test",
    turnId: "turn-1",
    index: 4,
    agentId: "agent-7",
  })
  expect(out.chunks.length, "three chunks yielded").toBe(3)
  expect(env.toast.length, "toast is delivered once").toBe(1)
  expect(env.toast[0][0], "toast names the filter stop").toContain("оборван фильтром")
  expect(env.toast[0][0], "toast names the tools that did not run").toContain("Bash, Edit")
  expect(env.toast[0][0], "toast names the model").toContain("opus-test")
  expect(env.toast[0][0], "toast names the agent when present").toContain("агент agent-7")
  expect(env.toast[0][1], "toast stays 20s").toEqual({ timeoutMs: 20000 })
  expect(env.status.length, "status is set").toBe(1)
  expect(env.status[0], "status counts the stop").toContain("обрывов фильтром за сессию: 1")
  expect(env.log.some((row: any) => String(row[0]).includes("turn")), "log names the turn").toBe(true)
  expect(env.log.some((row: any) => String(row[0]).includes("step 4")), "log names the step").toBe(true)
  const recs = env.journal()
  expect(recs.length, "store received one record").toBe(1)
  expect(recs[0].tools, "store record lists the tool names").toEqual(["Bash", "Edit"])
  expect(recs[0].via, "store record is a step stop").toBe("step")
  expect(recs[0].model, "store record names the model").toBe("opus-test")
  expect(recs[0].turnId, "store record names the turn").toBe("turn-1")
  expect(Object.prototype.hasOwnProperty.call(recs[0], "taskId"), "undefined fields are omitted").toBe(false)
})

test("T2 end_turn: no alert", async () => {
  __reset()
  const env = make$()
  const spec = endTurnChunks()
  await runStep(env, spec.chunks, spec.result, { model: "opus-test", turnId: "turn-2", index: 0 })
  expect(env.toast.length, "end_turn does not toast").toBe(0)
  expect(env.status.length, "end_turn does not set status").toBe(0)
  expect(env.log.length, "end_turn does not log").toBe(0)
  expect(env.logSetCount(), "end_turn does not write the store").toBe(0)
})

test("T3 chunks and result are the same objects", async () => {
  __reset()
  const env = make$()
  const refused = refusalChunks()
  const out1 = await runStep(env, refused.chunks, refused.result, {
    model: "opus-test",
    turnId: "turn-3a",
    index: 0,
  })
  expect(out1.chunks.length, "T1 shape yields every chunk").toBe(refused.chunks.length)
  for (let i = 0; i < refused.chunks.length; i++) {
    expect(out1.chunks[i], "T1 chunk " + i + " is the same object").toBe(refused.chunks[i])
  }
  expect(out1.result, "T1 result is the same object").toBe(refused.result)

  const ended = endTurnChunks()
  const out2 = await runStep(env, ended.chunks, ended.result, {
    model: "opus-test",
    turnId: "turn-3b",
    index: 1,
  })
  expect(out2.chunks.length, "T2 shape yields every chunk").toBe(ended.chunks.length)
  for (let i = 0; i < ended.chunks.length; i++) {
    expect(out2.chunks[i], "T2 chunk " + i + " is the same object").toBe(ended.chunks[i])
  }
  expect(out2.result, "T2 result is the same object").toBe(ended.result)
})

test("T4 turn.complete refusal names the category", async () => {
  __reset()
  const env = make$()
  const sentinel = { text: "shown", usage: undefined }
  const explanation = "e".repeat(250)
  const out = await hooks.complete(
    env.$,
    {
      reason: "refusal",
      turnId: "turn-4",
      agentId: "agent-4",
      refusal: { category: "cyber", explanation },
      answer: "",
      durationMs: 10,
      isAborted: false,
    },
    async () => sentinel,
  )
  expect(out, "next's result is returned unchanged").toBe(sentinel)
  expect(env.toast.length, "complete toasts once").toBe(1)
  expect(env.toast[0][0], "toast names the category").toContain("категория cyber")
  expect(env.toast[0][0], "toast names the agent").toContain("агент agent-4")
  const rec = env.journal()[0]
  expect(rec.category, "store keeps the category").toBe("cyber")
  expect(rec.explanation, "explanation is capped at 200").toBe("e".repeat(200))
})

test("T5 turn.complete answer: no alert", async () => {
  __reset()
  const env = make$()
  const sentinel = { text: "answer" }
  const out = await hooks.complete(
    env.$,
    { reason: "answer", turnId: "turn-5", answer: "answer", durationMs: 1, isAborted: false },
    async () => sentinel,
  )
  expect(out, "next's result is returned").toBe(sentinel)
  expect(env.toast.length, "an answer does not toast").toBe(0)
  expect(env.status.length, "an answer does not set status").toBe(0)
  expect(env.log.length, "an answer does not log").toBe(0)
  expect(env.logSetCount(), "an answer does not write the store").toBe(0)
})

test("T6 TaskStop inside the window names the task", async () => {
  __reset()
  expect(hooks.taskstopMatcher, "TaskStop is the matched tool").toEqual({ tool: "TaskStop" })
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "opus-test", turnId: "turn-6", index: 0 })
  const before = env.status.length
  const sentinel = { ref: 1, result: stopOut("bg-7"), text: "stopped" }
  const out = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "use-6", task_id: "bg-7" },
    async () => sentinel,
  )
  expect(out, "next's result is the same object").toBe(sentinel)
  expect(
    env.toast.some((row: any) => String(row[0]).includes("bg-7")),
    "toast names the stopped task",
  ).toBe(true)
  expect(env.status.length, "TaskStop does not change status").toBe(before)
})

test("T7 TaskStop outside the window: no alert", async () => {
  __reset()
  const env = make$()
  const sentinel = { result: stopOut("bg-1") }
  const out = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "use-7", task_id: "bg-1" },
    async () => sentinel,
  )
  expect(out, "next's result is the same object").toBe(sentinel)
  expect(env.toast.length, "no alert without a prior stop").toBe(0)
  expect(env.status.length, "no status without a prior stop").toBe(0)
  expect(env.log.length, "no log without a prior stop").toBe(0)
  expect(env.logSetCount(), "no store write without a prior stop").toBe(0)
})

test("T8 prompt.context adds one refusalHandling block", async () => {
  __reset()
  const env = make$()
  const core = [
    { name: "claudeMd", text: "md" },
    { name: "currentDate", text: "date" },
  ]
  const first = await hooks.context(env.$, { blocks: core }, async (e: any) => ({ blocks: e.blocks }))
  expect(core.length, "the input block list is not mutated").toBe(2)
  expect(first.blocks.map((b: any) => b.name), "the rule block is last").toEqual([
    "claudeMd",
    "currentDate",
    "refusalHandling",
  ])
  expect(first.blocks[2].text, "the rule block carries RULE_TEXT").toBe(RULE_TEXT)
  expect(first.blocks[0], "claudeMd is the same object").toBe(core[0])
  expect(
    first.blocks.filter((b: any) => b.name === "refusalHandling").length,
    "exactly one rule block",
  ).toBe(1)

  const carried = [
    { name: "claudeMd", text: "md" },
    { name: "refusalHandling", text: "stale" },
    { name: "currentDate", text: "date" },
  ]
  const second = await hooks.context(env.$, { blocks: carried }, async (e: any) => ({
    blocks: e.blocks.slice(),
  }))
  const named = second.blocks.filter((b: any) => b.name === "refusalHandling")
  expect(named.length, "an input that already has the block still yields one").toBe(1)
  expect(named[0].text, "the existing block's text is replaced").toBe(RULE_TEXT)
  expect(second.blocks.map((b: any) => b.name), "the existing block keeps its place").toEqual([
    "claudeMd",
    "refusalHandling",
    "currentDate",
  ])
})

test("T9 toast failure does not drop the step", async () => {
  __reset()
  const env = make$({ toastThrows: true })
  const spec = refusalChunks()
  const out = await runStep(env, spec.chunks, spec.result, {
    model: "opus-test",
    turnId: "turn-9",
    index: 2,
  })
  expect(out.chunks.length, "every chunk is still yielded").toBe(spec.chunks.length)
  for (let i = 0; i < spec.chunks.length; i++) {
    expect(out.chunks[i], "chunk " + i + " is the same object").toBe(spec.chunks[i])
  }
  expect(out.result, "the result is still returned").toBe(spec.result)
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал toast не сработал")),
    "the toast channel failure is logged",
  ).toBe(true)
  expect(env.status.length, "status is still delivered").toBe(1)
  expect(env.log.length > 1, "the transcript line is still delivered").toBe(true)
})

test("T10 count: two stops, and step+complete within 60s", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m-a", turnId: "turn-a", index: 0 })
  await runStep(env, spec.chunks, spec.result, { model: "m-b", turnId: "turn-b", index: 1 })
  expect(env.status[env.status.length - 1], "two stops count as two").toContain(
    "обрывов фильтром за сессию: 2",
  )

  __reset()
  const env2 = make$()
  await runStep(env2, spec.chunks, spec.result, { model: "m-c", turnId: "turn-same", index: 0 })
  const sentinel = { text: "complete" }
  const out = await hooks.complete(
    env2.$,
    {
      reason: "refusal",
      turnId: "turn-same",
      refusal: { category: null, explanation: null },
      answer: "",
      durationMs: 1,
      isAborted: false,
    },
    async () => sentinel,
  )
  expect(out, "complete returns next's result").toBe(sentinel)
  expect(env2.toast.length, "step and complete each toast").toBe(2)
  expect(env2.status[env2.status.length - 1], "complete inside 60s does not recount").toContain(
    "обрывов фильтром за сессию: 1",
  )
})

test("T11 store keeps the last 100", async () => {
  __reset()
  const start = 5_000_000_000_000
  const env = make$({ now: (tick: number) => start + tick * 1000 })
  const spec = refusalChunks()
  for (let i = 0; i < 101; i++) {
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "turn-" + i, index: i })
  }
  const log = env.journal()
  expect(log, "store keeps the last 100").toHaveLength(100)
  expect(log[0].turnId, "the oldest kept record is the second by time").toBe("turn-1")
  expect(log[0].t, "the oldest kept record carries the second timestamp").toBe(start + 2000)
  expect(log[99].turnId, "the newest record is the 101st stop").toBe("turn-100")
})

test("T12 log line omits absent turn/step instead of printing undefined", async () => {
  __reset()
  const env = make$()
  await hooks.complete(env.$, { reason: "refusal", turnId: "turn-12", refusal: { category: "cyber", explanation: "x" } }, async () => ({ ok: 1 }))
  await hooks.taskstop(env.$, { tool: "TaskStop", task_id: "bg-12" }, async () => ({ ref: 1, result: stopOut("bg-12"), text: "stopped" }))
  const lines = env.log.filter((row: any) => row[1] === undefined).map((row: any) => String(row[0]))
  expect(lines.length, "complete and taskstop both log").toBe(2)
  expect(lines.some((l: string) => l.includes("undefined")), "no undefined in transcript log").toBe(false)
  expect(lines[0], "complete log keeps its turn").toContain("[turn turn-12]")
  expect(lines[1].includes("["), "taskstop log carries no empty bracket").toBe(false)
})

test("T13 early close from above closes the stream beneath", async () => {
  __reset()
  const env = make$()
  let closed = false
  async function* beneath(): AsyncGenerator<any, any, any> {
    try {
      yield { kind: "text", index: 0, text: "a" }
      yield { kind: "text", index: 0, text: "b" }
      return { stopReason: "end_turn" }
    } finally {
      closed = true
    }
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "turn-13", index: 0 }, () => beneath())
  const first = await gen.next()
  expect(first.done, "first chunk arrives").toBe(false)
  await gen.return(undefined)
  expect(closed, "beneath stream closed on early return").toBe(true)
  expect(env.toast.length, "no alert on cancelled step").toBe(0)
})

test("T14 a refusal stop chunk alerts even when the result is end_turn", async () => {
  __reset()
  const env = make$()
  const stop = { kind: "stop", stopReason: "refusal", usage: null }
  const result = {
    turnId: "t14",
    index: 0,
    answer: "",
    toolUses: [],
    stopReason: "end_turn",
    usage: null,
  }
  await runStep(env, [stop], result, { model: "m", turnId: "t14", index: 0 })
  expect(env.toast.length, "exactly one toast").toBe(1)
})

test("T15 a refusal result alerts when no stop chunk arrived", async () => {
  __reset()
  const env = make$()
  const text = { kind: "text", index: 0, text: "partial" }
  const result = {
    turnId: "t15",
    index: 0,
    answer: "",
    toolUses: [],
    stopReason: "refusal",
    usage: null,
  }
  await runStep(env, [text], result, { model: "m", turnId: "t15", index: 0 })
  expect(env.toast.length, "exactly one toast").toBe(1)
})

test("T16 window closes at exactly 1800000ms", async () => {
  const t0 = 1_700_000_000_000
  const spec = refusalChunks()
  const stepEvent = { model: "m", turnId: "w", index: 0 }

  __reset()
  const inside = make$()
  inside.setNow(t0)
  await runStep(inside, spec.chunks, spec.result, stepEvent)
  inside.setNow(t0 + 1_799_999)
  const sentIn = { ref: 1, result: stopOut("bg-in"), text: "stopped" }
  const outIn = await hooks.taskstop(
    inside.$,
    { tool: "TaskStop", tool_use_id: "use-in", task_id: "bg-in" },
    async () => sentIn,
  )
  expect(outIn, "inside window returns next").toBe(sentIn)
  expect(
    inside.toast.some((row: any) => String(row[0]).includes("bg-in")),
    "toast inside the open window",
  ).toBe(true)

  __reset()
  const edge = make$()
  edge.setNow(t0)
  await runStep(edge, spec.chunks, spec.result, stepEvent)
  edge.setNow(t0 + 1_800_000)
  const sentEdge = { ref: 1, result: stopOut("bg-edge"), text: "stopped" }
  const outEdge = await hooks.taskstop(
    edge.$,
    { tool: "TaskStop", tool_use_id: "use-edge", task_id: "bg-edge" },
    async () => sentEdge,
  )
  expect(outEdge, "edge returns next").toBe(sentEdge)
  expect(
    edge.toast.some((row: any) => String(row[0]).includes("bg-edge")),
    "no task toast at the closed edge",
  ).toBe(false)
})

test("T17 dedup counts another turn and a step without refusal between, not a clock step back", async () => {
  const t0 = 1_700_000_000_000
  const spec = refusalChunks()
  const completeOf = (turnId: string) => ({
    reason: "refusal",
    turnId,
    refusal: { category: null, explanation: null },
    answer: "",
    durationMs: 1,
    isAborted: false,
  })

  __reset()
  const other = make$()
  other.setNow(t0)
  await runStep(other, spec.chunks, spec.result, { model: "m", turnId: "turn-a", index: 0 })
  other.setNow(t0 + 1_000)
  await hooks.complete(other.$, completeOf("turn-b"), async () => ({ text: "c" }))
  expect(other.status[other.status.length - 1], "a different turnId counts").toContain(
    "обрывов фильтром за сессию: 2",
  )

  __reset()
  const back = make$()
  back.setNow(t0)
  await runStep(back, spec.chunks, spec.result, { model: "m", turnId: "back", index: 0 })
  back.setNow(t0 - 1)
  await hooks.complete(back.$, completeOf("back"), async () => ({ text: "c" }))
  expect(back.status[back.status.length - 1], "a clock step backward does not recount").toContain(
    "обрывов фильтром за сессию: 1",
  )

  __reset()
  const gap = make$()
  gap.setNow(t0)
  await runStep(gap, spec.chunks, spec.result, { model: "m", turnId: "gap", index: 0 })
  const ended = endTurnChunks()
  await runStep(gap, ended.chunks, ended.result, { model: "m", turnId: "gap", index: 1 })
  await hooks.complete(gap.$, completeOf("gap"), async () => ({ text: "c" }))
  expect(gap.status[gap.status.length - 1], "a step without refusal re-arms the turn's count").toContain(
    "обрывов фильтром за сессию: 2",
  )
})

test("T18 rule text is an independent oracle", async () => {
  __reset()
  expect(RULE_TEXT, "opens with the first-line duty").toContain("первой строкой следующего ответа")
  expect(RULE_TEXT, "forbids stopping background work").toContain(
    "не останавливай фоновые задачи и агентов",
  )
  expect(RULE_TEXT, "leaves the decision to the user").toContain("принимает пользователь")
  const env = make$()
  const out = await hooks.context(env.$, { blocks: [] }, async () => ({ blocks: [] }))
  const block = out.blocks.find((b: any) => b.name === "refusalHandling")
  expect(typeof block?.text, "the block has text").toBe("string")
  expect(block.text.length > 300, "the block text is longer than 300").toBe(true)
})

test("T19 TaskStop alerts only after a successful stop and names the agent", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t19", index: 0 })
  const taskToasts = () =>
    env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))

  const denied = { deny: "x" }
  const outDeny = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "use-d", task_id: "bg-deny", agentId: "sub-9" },
    async () => denied,
  )
  expect(outDeny, "deny result is returned").toBe(denied)
  expect(taskToasts().length, "a denied stop does not toast").toBe(0)

  const errored = { isError: true, result: "no", text: "no" }
  const outErr = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "use-e", task_id: "bg-err", agentId: "sub-9" },
    async () => errored,
  )
  expect(outErr, "isError result is returned").toBe(errored)
  expect(taskToasts().length, "an errored stop does not toast").toBe(0)

  const ok = { result: stopOut("bg-19") }
  const outOk = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "use-ok", task_id: "bg-19", agentId: "sub-9" },
    async () => ok,
  )
  expect(outOk, "success result is returned").toBe(ok)
  expect(taskToasts().length, "a successful stop toasts once").toBe(1)
  expect(taskToasts()[0][0], "toast names the task").toContain("bg-19")
  expect(taskToasts()[0][0], "toast names the agent").toContain("остановил агент sub-9")
  const recs = env.journal().filter((r: any) => r.via === "taskstop")
  expect(recs.length, "one taskstop record").toBe(1)
  expect(recs[0].agentId, "store record keeps the agent").toBe("sub-9")
})

test("T20 parallel stops keep both store records", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await Promise.all([
    runStep(env, spec.chunks, spec.result, { model: "m1", turnId: "p-1", index: 0 }),
    runStep(env, spec.chunks, spec.result, { model: "m2", turnId: "p-2", index: 1 }),
  ])
  expect(env.journal().length, "both parallel records are kept").toBe(2)
})

test("T21 a throwing clock still delivers the toast and a real time", async () => {
  __reset()
  const env = make$({ clockReject: true })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t21", index: 0 })
  expect(env.toast.length, "toast is delivered").toBe(1)
  expect(env.status.length, "status is delivered").toBe(1)
  expect(env.status[0], "status time is HH:MM").toMatch(/\d\d:\d\d/)
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал clock не сработал")),
    "clock failure is on the debug line",
  ).toBe(true)
})

test("T22 a non-numeric clock opens the window from Date.now", async () => {
  __reset()
  let calls = 0
  const env = make$({
    now: () => {
      calls += 1
      return calls === 1 ? undefined : Date.now()
    },
  })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t22", index: 0 })
  expect(String(env.status[0]), "status has no NaN").not.toContain("NaN")
  const sent = { ref: 1, result: stopOut("bg-22"), text: "stopped" }
  await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "use-22", task_id: "bg-22" },
    async () => sent,
  )
  expect(
    env.toast.some((row: any) => String(row[0]).includes("bg-22")),
    "TaskStop in the same moment toasts",
  ).toBe(true)
})

test("T23 a later next() failure keeps the same error and still alerts", async () => {
  __reset()
  const env = make$()
  const cut = new Error("cut")
  let i = 0
  const chunks = [{ kind: "stop", stopReason: "refusal", usage: null }]
  const it = {
    async next() {
      if (i < chunks.length) {
        const value = chunks[i]
        i += 1
        return { done: false, value }
      }
      throw cut
    },
    async return(v: any) {
      return { done: true, value: v }
    },
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return it
    },
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t23", index: 0 }, () => stream)
  const first = await gen.next()
  expect(first.done, "the stop chunk is yielded").toBe(false)
  let thrown: unknown
  try {
    await gen.next()
  } catch (e) {
    thrown = e
  }
  expect(thrown, "the same error object propagates").toBe(cut)
  expect(env.toast.length, "the recognized stop still alerts").toBe(1)
})

test("T24 return from above after a refusal stop alerts and closes", async () => {
  __reset()
  const env = make$()
  let closed = false
  async function* beneath(): AsyncGenerator<any, any, any> {
    try {
      yield { kind: "stop", stopReason: "refusal", usage: null }
      yield { kind: "text", index: 0, text: "later" }
      return { stopReason: "end_turn" }
    } finally {
      closed = true
    }
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t24", index: 1 }, () => beneath())
  const first = await gen.next()
  expect(first.done, "the stop chunk arrives").toBe(false)
  expect(first.value.kind, "the chunk is the stop").toBe("stop")
  await gen.return(undefined)
  expect(closed, "the stream beneath closed").toBe(true)
  expect(env.toast.length, "the recognized stop still alerts").toBe(1)
})

test("T25 throw from above reaches the generator beneath", async () => {
  __reset()
  const env = make$()
  async function* beneath(): AsyncGenerator<any, any, any> {
    try {
      yield { kind: "text", index: 0, text: "before" }
    } catch {
      yield { kind: "text", index: 0, text: "recovered" }
    }
    return { stopReason: "end_turn" }
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t25", index: 0 }, () => beneath())
  const first = await gen.next()
  expect(first.value.text, "the first chunk is yielded").toBe("before")
  const second = await gen.throw(new Error("boom"))
  expect(second.done, "the recovered chunk is not a completion").toBe(false)
  expect(second.value.text, "the recovered chunk arrives above").toBe("recovered")
})

test("T26 a throwing iterator next does not call return", async () => {
  __reset()
  const env = make$()
  const broke = new Error("broke")
  let returns = 0
  const it = {
    async next() {
      throw broke
    },
    async return() {
      returns += 1
      throw new Error("close")
    },
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return it
    },
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t26", index: 0 }, () => stream)
  let thrown: unknown
  try {
    await gen.next()
  } catch (e) {
    thrown = e
  }
  expect(thrown, "the next() error is the one above").toBe(broke)
  expect(returns, "return() was not called").toBe(0)
})

test("T27 a turn's dedup entry ends with its complete", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  for (let i = 0; i < 1000; i++) {
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t-" + i, index: i })
    await hooks.complete(env.$, { reason: "end_turn", turnId: "t-" + i }, async () => ({ ended: true }))
  }
  expect(__dedupSize(), "every turn's entry ends with its complete").toBe(0)
})

test("T28 status carries the model and the local HH:MM; toast failure logs debug", async () => {
  __reset()
  const fixed = 1_700_000_000_000
  const d = new Date(fixed)
  const stamp =
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
  const env = make$({ now: () => fixed })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "opus-t28", turnId: "t28", index: 3 })
  expect(env.status[0], "status names the model").toContain("opus-t28")
  expect(env.status[0], "status names the local time").toContain(stamp)

  __reset()
  const env2 = make$({ now: () => fixed, toastThrows: true })
  await runStep(env2, spec.chunks, spec.result, { model: "opus-t28", turnId: "t28b", index: 4 })
  const debug = env2.log.filter((row: any) => row[1] != null && row[1].to === "debug")
  expect(debug.length > 0, "a debug line is emitted").toBe(true)
  expect(debug[0][1], "debug line options").toEqual({ to: "debug" })
})

test("T29 session.end resets the session count and returns next", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "s1", index: 0 })
  expect(env.status[env.status.length - 1], "the first stop counts as one").toContain(
    "обрывов фильтром за сессию: 1",
  )
  const sentinel = { ended: true }
  const out = await hooks.sessionEnd(
    env.$,
    { reason: "clear", sessionId: "s1", resume: { id: "s1" } },
    async () => sentinel,
  )
  expect(out, "session.end returns next's result").toBe(sentinel)
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "s2", index: 1 })
  expect(env.status[env.status.length - 1], "the count starts over").toContain(
    "обрывов фильтром за сессию: 1",
  )
})

test("T30 a result without a done field is still a chunk", async () => {
  __reset()
  const env = make$()
  const stop = { kind: "stop", stopReason: "refusal", usage: null }
  const finalResult = { turnId: "t30", stopReason: "end_turn" }
  const results = [{ value: stop }, { done: true, value: finalResult }]
  let i = 0
  const it = {
    async next() {
      return results[i++]
    },
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return it
    },
  }
  const out = await collect(hooks.step(env.$, { model: "m", turnId: "t30", index: 0 }, () => stream))
  expect(out.chunks.length, "the done-less chunk is yielded above").toBe(1)
  expect(out.chunks[0], "the chunk is the same object").toBe(stop)
  expect(out.result, "the final value is returned").toBe(finalResult)
  expect(env.toast.length, "the done-less stop chunk still alerts").toBe(1)
})

test("T31 the observer reads done exactly once per result", async () => {
  __reset()
  const env = make$()
  const chunk = { kind: "text", index: 0, text: "once" }
  let doneReads = 0
  const tricky = {
    get done() {
      doneReads += 1
      return doneReads === 1 ? false : true
    },
    value: chunk,
  }
  const results: any[] = [tricky, { done: true, value: { stopReason: "end_turn" } }]
  let i = 0
  const it = {
    async next() {
      return results[i++] ?? { done: true, value: undefined }
    },
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return it
    },
  }
  const out = await collect(hooks.step(env.$, { model: "m", turnId: "t31", index: 0 }, () => stream))
  expect(out.chunks.length, "the chunk is yielded above").toBe(1)
  expect(out.chunks[0], "the chunk is the same object").toBe(chunk)
  expect(doneReads, "done is read exactly once on the result").toBe(1)
})

test("T32 the observer keeps the next function it entered with", async () => {
  __reset()
  const env = make$()
  const first = { kind: "text", index: 0, text: "first" }
  const second = { kind: "text", index: 1, text: "second" }
  const it: any = {
    next: async (_v?: any) => {
      it.calls += 1
      if (it.calls === 1) {
        // CONSTRAINT: подмена обязана завершать поток — иначе мутация n4 уводит collect в бесконечный сбор.
        it.next = async () => ({ done: true, value: { stopReason: "end_turn" } })
        return { done: false, value: first }
      }
      if (it.calls === 2) return { done: false, value: second }
      return { done: true, value: { stopReason: "end_turn" } }
    },
    calls: 0,
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return it
    },
  }
  const out = await collect(hooks.step(env.$, { model: "m", turnId: "t32", index: 0 }, () => stream))
  expect(out.chunks.length, "two chunks arrive").toBe(2)
  expect(out.chunks[0], "the first chunk is the same object").toBe(first)
  expect(out.chunks[1], "the second chunk comes from the original next").toBe(second)
})

test("T33 a refusal returned by the lower return() still alerts", async () => {
  __reset()
  const env = make$()
  let closed = false
  async function* beneath(): AsyncGenerator<any, any, any> {
    try {
      yield { kind: "text", index: 0, text: "partial" }
    } finally {
      closed = true
      return { stopReason: "refusal" }
    }
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t33", index: 0 }, () => beneath())
  const first = await gen.next()
  expect(first.done, "the text chunk arrives").toBe(false)
  await gen.return(undefined)
  expect(closed, "the lower finally ran").toBe(true)
  expect(env.toast.length, "the refusal from the lower return alerts").toBe(1)
})

test("T34 a stuck write does not hold the caller past the limit and drops nothing", async () => {
  __reset()
  let release!: () => void
  let released = false
  const barrier = new Promise<void>((res) => {
    release = () => {
      if (released) return
      released = true
      res()
    }
  })
  let setCalls = 0
  const env = make$({
    sleep: () => Promise.resolve(),
    storeSet: async () => {
      setCalls += 1
      if (setCalls === 1) await barrier
    },
  })
  const spec = refusalChunks()
  let firstDone = false
  const first = runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t34a", index: 0 }).then(
    () => {
      firstDone = true
    },
  )
  try {
    expect(await until(() => setCalls >= 1), "the first record reaches its store write").toBe(true)
    expect(await until(() => firstDone), "the caller returns at the wait limit").toBe(true)
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t34b", index: 1 })
    expect(
      env.journal().some((r: any) => r.turnId === "t34b"),
      "the second record is written while the first waits",
    ).toBe(true)
    release()
    await first
    expect(await until(() => env.journal().length >= 2), "both records are in the journal").toBe(true)
    const ids = env.journal().map((r: any) => r.turnId)
    expect(ids.includes("t34a") && ids.includes("t34b"), "neither record is dropped").toBe(true)
    expect(
      env.log.some((row: any) => String(row[0]).includes("запись дольше 5000 мс")),
      "the over-limit write is reported",
    ).toBe(true)
    expect(env.sleepCalls.includes(5000), "the limit slept 5000 ms").toBe(true)
  } finally {
    release()
  }
})
test("T35 a write in flight across session.end is not lost", async () => {
  __reset()
  let release!: () => void
  let released = false
  const barrier = new Promise<void>((res) => {
    release = () => {
      if (released) return
      released = true
      res()
    }
  })
  let setCalls = 0
  const env = make$({
    storeSet: async () => {
      setCalls += 1
      if (setCalls === 1) await barrier
    },
  })
  const spec = refusalChunks()
  const pending = runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t35a", index: 0 })
  try {
    expect(await until(() => setCalls >= 1), "record A is waiting on its store write").toBe(true)
    const sentinel = { ended: true }
    const out = await hooks.sessionEnd(
      env.$,
      { reason: "clear", sessionId: "s1", resume: { id: "s1" } },
      async () => sentinel,
    )
    expect(out, "session.end returns next's result").toBe(sentinel)
    const pendingB = runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t35b", index: 1 })
    // CONSTRAINT: барьер держится, пока B не в журнале — иначе потеря A не отличима от того, что B ещё не записана.
    expect(
      await until(() => env.journal().some((r: any) => r.turnId === "t35b")),
      "record B is written while A waits",
    ).toBe(true)
    release()
    await pending
    await pendingB
    expect(await until(() => env.journal().length >= 2), "both records are in the journal").toBe(true)
    const ids = env.journal().map((r: any) => r.turnId).sort()
    expect(ids, "neither record is lost across session.end").toEqual(["t35a", "t35b"])
  } finally {
    release()
  }
})
test("T36 a clock step back keeps the dedup entry for the later turn", async () => {
  __reset()
  const t0 = 1_700_000_000_000
  const spec = refusalChunks()
  const env = make$()
  env.setNow(t0)
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "A", index: 0 })
  env.setNow(t0 - 1)
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "B", index: 1 })
  env.setNow(t0 + 1)
  const out = await hooks.complete(
    env.$,
    {
      reason: "refusal",
      turnId: "A",
      refusal: { category: null, explanation: null },
      answer: "",
      durationMs: 1,
      isAborted: false,
    },
    async () => ({ text: "c" }),
  )
  expect(out, "complete returns next's result").toEqual({ text: "c" })
  expect(
    env.status[env.status.length - 1],
    "complete within 60s of its step does not recount",
  ).toContain("обрывов фильтром за сессию: 2")
})

test("T37 a value sent to next() from above reaches the lower next", async () => {
  __reset()
  const env = make$()
  let sentDown: unknown = "unset"
  async function* beneath(): AsyncGenerator<any, any, any> {
    const got = yield { kind: "text", index: 0, text: "first" }
    sentDown = got
    return { stopReason: "end_turn" }
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t37", index: 0 }, () => beneath())
  const first = await gen.next()
  expect(first.done, "the first chunk arrives").toBe(false)
  const second = await gen.next("payload-37")
  expect(second.done, "the generator finishes").toBe(true)
  expect(sentDown, "the sent value reached the lower yield").toBe("payload-37")
})

test("T38 a failing store.set does not drop the next record", async () => {
  __reset()
  let setCalls = 0
  const env = make$({
    storeSet: async () => {
      setCalls += 1
      if (setCalls === 1) throw new Error("set-boom")
    },
  })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t38a", index: 0 })
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t38b", index: 1 })
  const journal = env.journal()
  expect(journal.length, "exactly one record reaches the journal").toBe(1)
  expect(journal[0].turnId, "the surviving record is the second").toBe("t38b")
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал store не сработал")),
    "the store channel failure is on the debug line",
  ).toBe(true)
})
test("T39 session.end closes the TaskStop window", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t39", index: 0 })
  const ended = { done: true }
  const outEnd = await hooks.sessionEnd(
    env.$,
    { reason: "clear", sessionId: "s1", resume: { id: "s1" } },
    async () => ended,
  )
  expect(outEnd, "session.end returns next's result").toBe(ended)
  const sentinel = { ref: 1, result: stopOut("bg-39"), text: "stopped" }
  const out = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "use-39", task_id: "bg-39" },
    async () => sentinel,
  )
  expect(out, "next's result is the same object").toBe(sentinel)
  expect(
    env.toast.some((row: any) => String(row[0]).includes("остановлена фоновая")),
    "no task toast after the session ended",
  ).toBe(false)
})

test("T40 the dedup map is not capped by key count", async () => {
  __reset()
  const fixed = 1_700_000_000_000
  const env = make$({ now: () => fixed })
  const spec = refusalChunks()
  for (let i = 0; i < 2000; i++) {
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t40-" + i, index: 0 })
  }
  expect(__dedupSize(), "same-time turn ids are all kept").toBe(2000)
})
test("T41 a denied TaskStop with no window reads no clock", async () => {
  __reset()
  const env = make$()
  const denied = { deny: "x" }
  const out = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "use-41", task_id: "bg-41" },
    async () => denied,
  )
  expect(out, "the deny result is returned").toBe(denied)
  expect(env.clockCalls(), "the clock is not read").toBe(0)
})

test("T42 a non-number clock value never becomes the record time", async () => {
  __reset()
  const raw = [null, "", "1700000000000"]
  const env = make$({ now: () => raw.shift() })
  const spec = refusalChunks()
  for (let i = 0; i < 3; i++) {
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t42-" + i, index: i })
  }
  const recs = env.journal()
  expect(recs.length, "three records are kept").toBe(3)
  for (const rec of recs) {
    expect(rec.t, "the time is not Number(null)").not.toBe(0)
    expect(rec.t, "the time is not the numeric string").not.toBe(1700000000000)
  }
  const clockFailures = env.log.filter((row: any) =>
    String(row[0]).includes("канал clock не сработал"),
  )
  expect(clockFailures.length, "each bad value is reported").toBe(3)
})

test("T43 only the contract form of a TaskStop result counts as a stop", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t43", index: 0 })
  const taskToasts = () =>
    env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))
  const stringErr = { isError: "true", result: "no", text: "no" }
  const outString = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u1", task_id: "bg-43a" },
    async () => stringErr,
  )
  expect(outString, "the string isError result is returned").toBe(stringErr)
  expect(taskToasts().length, "a string isError result does not toast").toBe(0)
  const empty: any = {}
  const outEmpty = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u2", task_id: "bg-43b" },
    async () => empty,
  )
  expect(outEmpty, "the empty result is returned").toBe(empty)
  expect(taskToasts().length, "an empty result does not toast").toBe(0)
  const arrayForm = { result: [] }
  await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u4", task_id: "bg-43d" },
    async () => arrayForm,
  )
  expect(taskToasts().length, "an array result does not toast").toBe(0)
  const emptyObjectForm = { result: {} }
  await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u5", task_id: "bg-43e" },
    async () => emptyObjectForm,
  )
  expect(taskToasts().length, "an empty object result does not toast").toBe(0)
  const noTaskTypeForm = { result: { message: "stopped", task_id: "bg-43f" } }
  await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u6", task_id: "bg-43f" },
    async () => noTaskTypeForm,
  )
  expect(taskToasts().length, "a result without task_type does not toast").toBe(0)
  const ok = { ref: 1, result: stopOut("bg-43c"), text: "stopped" }
  const outOk = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u3", task_id: "bg-43c" },
    async () => ok,
  )
  expect(outOk, "the contract result is returned").toBe(ok)
  expect(taskToasts().length, "only the contract form toasts").toBe(1)
  expect(taskToasts()[0][0], "the toast names the contract-form task").toContain("bg-43c")
})

test("T44 a late set does not erase the record written while it waited", async () => {
  __reset()
  let release!: () => void
  let released = false
  const barrier = new Promise<void>((res) => {
    release = () => {
      if (released) return
      released = true
      res()
    }
  })
  let setCalls = 0
  const env = make$({
    storeSet: async () => {
      setCalls += 1
      if (setCalls === 1) await barrier
    },
  })
  const spec = refusalChunks()
  const pendingA = runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t44a", index: 0 })
  const pendingB = runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t44b", index: 1 })
  try {
    expect(await until(() => setCalls >= 1), "the first record reaches its store write").toBe(true)
    expect(
      await until(() => env.journal().some((r: any) => r.turnId === "t44b")),
      "the second record is written while the first write waits",
    ).toBe(true)
    release()
    await Promise.all([pendingA, pendingB])
    const ids = env.journal().map((r: any) => r.turnId)
    expect(ids.includes("t44a") && ids.includes("t44b"), "neither record is lost").toBe(true)
    expect(env.journal().length, "both records stay in the journal").toBe(2)
  } finally {
    release()
  }
})

test("T45 a rejected sleep releases the caller at once and the write finishes in the background", async () => {
  __reset()
  let release!: () => void
  let released = false
  const barrier = new Promise<void>((res) => {
    release = () => {
      if (released) return
      released = true
      res()
    }
  })
  let setCalls = 0
  const env = make$({
    sleep: () => Promise.reject(new Error("sleep-boom")),
    storeSet: async () => {
      setCalls += 1
      if (setCalls === 1) await barrier
    },
  })
  const spec = refusalChunks()
  let firstDone = false
  const first = runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t45a", index: 0 }).then(
    () => {
      firstDone = true
    },
  )
  const second = runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t45b", index: 1 })
  try {
    expect(await until(() => setCalls >= 1), "the first record reaches its store write").toBe(true)
    expect(await until(() => firstDone), "the caller is released at once").toBe(true)
    expect(
      env.log.some((row: any) => String(row[0]).includes("канал clock не сработал")),
      "the clock channel failure is reported",
    ).toBe(true)
    expect(
      env.log.some((row: any) => String(row[0]).includes("запись дольше")),
      "no over-limit line after a clock failure",
    ).toBe(false)
    release()
    await first
    await second
    expect(await until(() => env.journal().length >= 2), "both records are in the journal").toBe(true)
    expect(
      env.journal().map((r: any) => r.turnId).sort(),
      "both records are the two turns",
    ).toEqual(["t45a", "t45b"])
  } finally {
    release()
  }
})

test("T46 each caller times out from its own start", async () => {
  __reset()
  const releases: Array<() => void> = []
  let releaseSets!: () => void
  let setsReleased = false
  const setBarrier = new Promise<void>((res) => {
    releaseSets = () => {
      if (setsReleased) return
      setsReleased = true
      res()
    }
  })
  const env = make$({
    sleep: () =>
      new Promise<void>((res) => {
        releases.push(res)
      }),
    storeSet: () => setBarrier,
  })
  const spec = refusalChunks()
  let aDone = false
  let bDone = false
  const a = runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t46a", index: 0 }).then(() => {
    aDone = true
  })
  const b = runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t46b", index: 1 }).then(() => {
    bDone = true
  })
  try {
    expect(await until(() => releases.length >= 2), "each caller starts its own wait").toBe(true)
    expect(aDone, "A is still waiting on its own sleep").toBe(false)
    expect(bDone, "B is still waiting on its own sleep").toBe(false)
    releases[1]()
    expect(await until(() => bDone), "B finishes when its own sleep resolves").toBe(true)
    expect(aDone, "A does not finish on B's sleep").toBe(false)
    releases[0]()
    expect(await until(() => aDone), "A finishes when its own sleep resolves").toBe(true)
    await Promise.all([a, b])
  } finally {
    for (const res of releases) res()
    releaseSets()
  }
})

test("T47 the journal keeps the newest 100 keys", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  for (let i = 0; i < 105; i++) {
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t47-" + i, index: i })
  }
  const journal = env.journal()
  expect(journal.length, "the journal keeps 100 records").toBe(100)
  expect(journal[0].turnId, "the oldest kept record is the sixth").toBe("t47-5")
  expect(journal[99].turnId, "the newest record is the 105th").toBe("t47-104")
  const logSets = env.storeSets.filter((row: any) => String(row[0]).startsWith("log:"))
  const firstFive = logSets.slice(0, 5).map((row: any) => row[0])
  expect(env.storeDeletes.slice(0, 5), "delete was called on the first five keys").toEqual(firstFive)
})

test("T48 a legacy log array is left untouched and new records use their own keys", async () => {
  __reset()
  const env = make$()
  const old = [
    { t: 1, via: "step", turnId: "old-1" },
    { t: 2, via: "step", turnId: "old-2" },
    { t: 3, via: "step", turnId: "old-3" },
  ]
  await env.$.store.set("log", old)
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t48-new", index: 0 })
  expect(env.journal().map((r: any) => r.turnId), "only the new record enters the journal").toEqual([
    "t48-new",
  ])
  expect(await env.$.store.get("log"), "the legacy array is left untouched").toEqual(old)
  expect(env.storeDeletes.includes("log"), "the legacy key is never deleted").toBe(false)
  expect(
    env.storeSets.filter((row: any) => row[0] === "log").length,
    "only the fixture writes the log key",
  ).toBe(1)
})

test("T49 a missing throw closes through return and the close value is not read", async () => {
  __reset()
  const env = make$()
  let n = 0
  const it = {
    async next() {
      n += 1
      if (n === 1) return { done: false, value: { kind: "text", index: 0, text: "x" } }
      return { done: true, value: { stopReason: "end_turn" } }
    },
    return() {
      return {
        done: true,
        get value() {
          throw new Error("value-read")
        },
      }
    },
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return it
    },
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t49", index: 0 }, () => stream)
  const first = await gen.next()
  expect(first.done, "a chunk is yielded before the throw").toBe(false)
  let thrown: unknown
  try {
    await gen.throw(new Error("up"))
  } catch (e) {
    thrown = e
  }
  expect(thrown, "the host raises TypeError").toBeInstanceOf(TypeError)
  expect((thrown as Error).message, "the close value was not read").not.toBe("value-read")
  expect(env.toast.length, "no toast").toBe(0)
})

test("T50 a missing throw does not alert on the close result", async () => {
  __reset()
  const env = make$()
  let n = 0
  const it = {
    async next() {
      n += 1
      if (n === 1) return { done: false, value: { kind: "text", index: 0, text: "x" } }
      return { done: true, value: { stopReason: "end_turn" } }
    },
    return() {
      return { done: true, value: { stopReason: "refusal" } }
    },
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return it
    },
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t50", index: 0 }, () => stream)
  const first = await gen.next()
  expect(first.done, "a chunk is yielded before the throw").toBe(false)
  let thrown: unknown
  try {
    await gen.throw(new Error("up"))
  } catch (e) {
    thrown = e
  }
  expect(thrown, "the host still raises TypeError").toBeInstanceOf(TypeError)
  expect(env.toast.length, "the close result was not read").toBe(0)
})

test("T51 dedup has no key cap and a complete drops only its own key", async () => {
  __reset()
  const t0 = 1_700_000_000_000
  const spec = refusalChunks()
  const env = make$()
  env.setNow(t0)
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "A", index: 0 })
  for (let i = 1; i < 1001; i++) {
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t51-" + i, index: 0 })
  }
  env.setNow(t0 + 3)
  await hooks.complete(
    env.$,
    {
      reason: "refusal",
      turnId: "A",
      refusal: { category: null, explanation: null },
      answer: "",
      durationMs: 1,
      isAborted: false,
    },
    async () => ({ text: "c" }),
  )
  expect(env.status[env.status.length - 1], "the first turn is still inside the window").toContain(
    "обрывов фильтром за сессию: 1001",
  )
  expect(__dedupSize(), "only the completed turn's key is dropped").toBe(1000)
})

test("T52 the observer reads value exactly once per result", async () => {
  __reset()
  const env = make$()
  const chunk = { kind: "text", index: 0, text: "once" }
  let valueReads = 0
  const tricky = {
    done: false,
    get value() {
      valueReads += 1
      return chunk
    },
  }
  const results: any[] = [tricky, { done: true, value: { stopReason: "end_turn" } }]
  let i = 0
  const it = {
    async next() {
      return results[i++] ?? { done: true, value: undefined }
    },
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return it
    },
  }
  const out = await collect(hooks.step(env.$, { model: "m", turnId: "t52", index: 0 }, () => stream))
  expect(out.chunks.length, "the chunk is yielded above").toBe(1)
  expect(out.chunks[0], "the chunk is the same object").toBe(chunk)
  expect(valueReads, "value is read exactly once on the result").toBe(1)
})

test("T53 TaskStop with a non-boolean isError does not toast", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t53", index: 0 })
  const weird = { isError: 1, result: "x" }
  const out = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u53", task_id: "bg-53" },
    async () => weird,
  )
  expect(out, "the result is returned").toBe(weird)
  expect(
    env.toast.some((row: any) => String(row[0]).includes("остановлена фоновая")),
    "a non-boolean isError is not a successful stop",
  ).toBe(false)
})

test("T54 NaN and Infinity clocks do not become the record time", async () => {
  __reset()
  const spec = refusalChunks()
  const nanEnv = make$({ now: () => NaN })
  await runStep(nanEnv, spec.chunks, spec.result, { model: "m", turnId: "t54-nan", index: 0 })
  expect(Number.isFinite(nanEnv.journal()[0].t), "the NaN run stores a finite time").toBe(true)
  expect(
    nanEnv.log.some((row: any) => String(row[0]).includes("не число")),
    "NaN is reported on the clock channel",
  ).toBe(true)
  __reset()
  const infEnv = make$({ now: () => Infinity })
  await runStep(infEnv, spec.chunks, spec.result, { model: "m", turnId: "t54-inf", index: 0 })
  expect(Number.isFinite(infEnv.journal()[0].t), "the Infinity run stores a finite time").toBe(true)
  expect(
    infEnv.log.some((row: any) => String(row[0]).includes("не число")),
    "Infinity is reported on the clock channel",
  ).toBe(true)
})

test("T55 TaskStop with result undefined does not toast", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t55", index: 0 })
  const missing = { result: undefined }
  const out = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u55", task_id: "bg-55" },
    async () => missing,
  )
  expect(out, "the result is returned").toBe(missing)
  expect(
    env.toast.some((row: any) => String(row[0]).includes("остановлена фоновая")),
    "result undefined is not a successful stop",
  ).toBe(false)
})

test("T56 a missing return is not invoked when throw is missing", async () => {
  __reset()
  const inner = {
    async next() {
      return { done: true, value: undefined }
    },
  }
  const o = __observed(inner, () => {}, () => {})
  expect(o.throw, "a missing throw is undefined").toBeUndefined()
  expect(o.return, "a missing return stays undefined").toBeUndefined()

  const env = make$()
  let n = 0
  const stepInner = {
    async next() {
      n += 1
      if (n === 1) return { done: false, value: { kind: "text", index: 0, text: "x" } }
      return { done: true, value: { stopReason: "end_turn" } }
    },
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return stepInner
    },
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t56", index: 0 }, () => stream)
  const first = await gen.next()
  expect(first.done, "a chunk is yielded before the throw").toBe(false)
  const err = new Error("up")
  let thrown: unknown
  try {
    await gen.throw(err)
  } catch (e) {
    thrown = e
  }
  expect(thrown, "the host raises TypeError").toBeInstanceOf(TypeError)
  expect(thrown, "the caller's error is not the one that comes out").not.toBe(err)
})

test("T57 the legacy log is outside the 100-record cap", async () => {
  __reset()
  const env = make$()
  const old = [
    { t: 1, via: "step", turnId: "old-1" },
    { t: 2, via: "step", turnId: "old-2" },
    { t: 3, via: "step", turnId: "old-3" },
  ]
  await env.$.store.set("log", old)
  const spec = refusalChunks()
  for (let i = 0; i < 105; i++) {
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t57-" + i, index: i })
  }
  expect(env.journal().length, "the journal keeps 100 records").toBe(100)
  expect(await env.$.store.get("log"), "the legacy array is outside the cap").toEqual(old)
  expect(env.storeDeletes.includes("log"), "the legacy key is never deleted").toBe(false)
})

test("T58 a close without throw calls the lower return with no arguments", async () => {
  __reset()
  const env = make$()
  const lens: number[] = []
  let n = 0
  const inner = {
    async next() {
      n += 1
      if (n === 1) return { done: false, value: { kind: "text", index: 0, text: "x" } }
      return { done: true, value: { stopReason: "end_turn" } }
    },
    return(...args: any[]) {
      lens.push(args.length)
      return { done: true, value: undefined }
    },
  }
  const stream = {
    [Symbol.asyncIterator]() {
      return inner
    },
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t58", index: 0 }, () => stream)
  const first = await gen.next()
  expect(first.done, "a chunk is yielded before the throw").toBe(false)
  const err = new Error("up")
  let thrown: unknown
  try {
    await gen.throw(err)
  } catch (e) {
    thrown = e
  }
  expect(lens, "the lower return sees no arguments").toEqual([0])
  expect(thrown, "the host raises TypeError").toBeInstanceOf(TypeError)
  expect(thrown, "the caller's error is not the one that comes out").not.toBe(err)
})

test("T59 a non-callable lower return is handed to the host as is", async () => {
  __reset()
  const inner: any = {
    async next() {
      return { done: true, value: undefined }
    },
    return: 42,
  }
  const o = __observed(inner, () => {}, () => {})
  expect(o.throw, "a missing throw is undefined").toBeUndefined()
  expect(o.return, "a non-callable return is handed to the host as is").toBe(42)
})

test("T60 TaskStop with a null or string result does not toast", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t60", index: 0 })
  const nullResult = { result: null }
  const outNull = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u60a", task_id: "bg-60a" },
    async () => nullResult,
  )
  expect(outNull, "the null result is returned").toBe(nullResult)
  const stringResult = { isError: false, result: "stopped" }
  const outString = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u60b", task_id: "bg-60b" },
    async () => stringResult,
  )
  expect(outString, "the string result is returned").toBe(stringResult)
  expect(
    env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая")).length,
    "a null or string result does not toast",
  ).toBe(0)
})

test("T61 TaskStop with a truthy non-false isError and a full result does not toast", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t61", index: 0 })
  const taskToasts = () =>
    env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))
  const ids = ["bg-61a", "bg-61b", "bg-61c"]
  const truthy: any[] = [true, "true", 1]
  for (let i = 0; i < ids.length; i++) {
    const bad = { isError: truthy[i], result: stopOut(ids[i]) }
    const out = await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u61-" + ids[i], task_id: ids[i] },
      async () => bad,
    )
    expect(out, "the truthy isError result is returned").toBe(bad)
  }
  expect(taskToasts().length, "a truthy non-false isError does not toast").toBe(0)
  const fine = { isError: false, result: stopOut("bg-61d") }
  const outFine = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u61d", task_id: "bg-61d" },
    async () => fine,
  )
  expect(outFine, "the false-isError result is returned").toBe(fine)
  expect(taskToasts().length, "isError false with a full result toasts").toBe(1)
  expect(taskToasts()[0][0], "the toast names the task").toContain("bg-61d")
})

test("T62 the close path calls a lower return whose own apply is shadowed", async () => {
  let closed = 0
  function close(this: any) {
    closed += 1
    return { done: true, value: undefined }
  }
  Object.defineProperty(close, "apply", { value: undefined })
  const inner: any = { async next() { return { done: true, value: undefined } }, return: close }
  const o = __observed(inner, () => {}, () => {})
  expect(o.throw, "a missing throw is undefined").toBeUndefined()
  const r = o.return
  expect(typeof r, "the wrapped return is a function").toBe("function")
  await r()
  expect(closed, "the lower return ran").toBe(1)
})

test("T63 next and throw reach lower methods whose own call is shadowed", async () => {
  const seen: any[] = []
  function nx(this: any, v: any) {
    seen.push(["next", this === inner, v])
    return { done: false, value: 1 }
  }
  function th(this: any, x: any) {
    seen.push(["throw", this === inner, x])
    return { done: true, value: 2 }
  }
  Object.defineProperty(nx, "call", { value: undefined })
  Object.defineProperty(th, "call", { value: undefined })
  const inner: any = { next: nx, throw: th }
  const o = __observed(inner, () => {}, () => {})
  await o.next("a")
  await o.throw("b")
  expect(seen, "both lower methods ran with the inner receiver").toEqual([
    ["next", true, "a"],
    ["throw", true, "b"],
  ])
})

test("T64 a throwing return getter still clears the close flag", async () => {
  let reads = 0
  const inner: any = { async next() { return { done: true, value: undefined } } }
  Object.defineProperty(inner, "return", {
    get() {
      reads += 1
      if (reads === 1) throw new Error("once")
      return async (v: any) => ({ done: true, value: v })
    },
  })
  let doneWith: any = "unset"
  const o = __observed(inner, () => {}, (v) => { doneWith = v })
  expect(o.throw, "a missing throw is undefined").toBeUndefined()
  let message = ""
  try {
    o.return
  } catch (e) {
    message = (e as Error).message
  }
  expect(message, "the first return read throws").toBe("once")
  await o.return("z")
  expect(doneWith, "the second return read goes through the normal branch").toBe("z")
})

test("T65 a refusal stop chunk alerts before the stream beneath finishes", async () => {
  __reset()
  const env = make$()
  let open: () => void = () => {}
  const latch = new Promise<void>((resolve) => {
    open = resolve
  })
  async function* lower() {
    yield { kind: "stop", stopReason: "refusal", usage: null }
    await latch
    return { stopReason: "refusal" }
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t65", index: 0 }, () => lower())
  const first = await gen.next()
  expect(first.done, "the stop chunk is yielded").toBe(false)
  const second = gen.next()
  expect(
    await until(() => env.toast.length === 1),
    "the toast lands while the stream beneath still waits",
  ).toBe(true)
  expect(env.toast.length, "exactly one toast before the stream beneath finishes").toBe(1)
  open()
  const done = await second
  expect(done.done, "the step result arrives").toBe(true)
  expect(env.toast.length, "no second toast after the stream beneath finishes").toBe(1)
})

test("T66 command must be absent or a string", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t66", index: 0 })
  const taskToasts = () =>
    env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))
  const bad = { result: { ...stopOut("bg-66a"), command: 123 } }
  const outBad = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u66a", task_id: "bg-66a" },
    async () => bad,
  )
  expect(outBad, "the non-string command result is returned").toBe(bad)
  expect(taskToasts().length, "a non-string command does not toast").toBe(0)
  const nul = { result: { ...stopOut("bg-66c"), command: null } }
  const outNul = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u66c", task_id: "bg-66c" },
    async () => nul,
  )
  expect(outNul, "the null command result is returned").toBe(nul)
  expect(taskToasts().length, "a null command does not toast").toBe(0)
  const good = { result: { ...stopOut("bg-66b"), command: "sleep 9" } }
  const outGood = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u66b", task_id: "bg-66b" },
    async () => good,
  )
  expect(outGood, "the string command result is returned").toBe(good)
  expect(taskToasts().length, "a string command toasts once").toBe(1)
  expect(taskToasts()[0][0], "the toast names the task").toContain("bg-66b")
})

test("T67 each required string field is checked on its own", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t67", index: 0 })
  const taskToasts = () =>
    env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))
  const noMessage = { result: { task_id: "bg-67a", task_type: "local_bash" } }
  const outNoMessage = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u67a", task_id: "bg-67a" },
    async () => noMessage,
  )
  expect(outNoMessage, "the record without message is returned").toBe(noMessage)
  const noTaskId = { result: { message: "stopped", task_type: "local_bash" } }
  const outNoTaskId = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u67b", task_id: "bg-67b" },
    async () => noTaskId,
  )
  expect(outNoTaskId, "the record without task_id is returned").toBe(noTaskId)
  const arr = { result: Object.assign([], stopOut("bg-67c")) }
  const outArr = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u67c", task_id: "bg-67c" },
    async () => arr,
  )
  expect(outArr, "the array with own string fields is returned").toBe(arr)
  expect(taskToasts().length, "a missing field or an array does not toast").toBe(0)
  const fine = { result: stopOut("bg-67d") }
  const outFine = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u67d", task_id: "bg-67d" },
    async () => fine,
  )
  expect(outFine, "the full record is returned").toBe(fine)
  expect(taskToasts().length, "the full record toasts").toBe(1)
})

test("T68 isError other than absent or false blocks a full record", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t68", index: 0 })
  const taskToasts = () =>
    env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))
  const ids = ["bg-68a", "bg-68b", "bg-68c"]
  const values: any[] = [0, null, ""]
  for (let i = 0; i < ids.length; i++) {
    const rec = { isError: values[i], result: stopOut(ids[i]) }
    const out = await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u68-" + ids[i], task_id: ids[i] },
      async () => rec,
    )
    expect(out, "the result is returned").toBe(rec)
  }
  expect(taskToasts().length, "0, null and empty-string isError do not toast").toBe(0)
  const fine = { isError: false, result: stopOut("bg-68d") }
  const outFine = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u68d", task_id: "bg-68d" },
    async () => fine,
  )
  expect(outFine, "the false-isError result is returned").toBe(fine)
  expect(taskToasts().length, "isError false with a full record toasts").toBe(1)
})

test("T69 next and throw reach lower methods whose own apply is shadowed", async () => {
  const seen: any[] = []
  function nx(this: any, v: any) {
    seen.push(["next", this === inner, v])
    return { done: false, value: 1 }
  }
  function th(this: any, x: any) {
    seen.push(["throw", this === inner, x])
    return { done: true, value: 2 }
  }
  Object.defineProperty(nx, "apply", { value: undefined })
  Object.defineProperty(th, "apply", { value: undefined })
  const inner: any = { next: nx, throw: th }
  const o = __observed(inner, () => {}, () => {})
  await o.next("a")
  await o.throw("b")
  expect(seen, "both lower methods ran with the inner receiver").toEqual([
    ["next", true, "a"],
    ["throw", true, "b"],
  ])
})

test("T70 the close path calls a lower return whose own call is shadowed", async () => {
  let closed = 0
  function close(this: any) {
    closed += 1
    return { done: true, value: undefined }
  }
  Object.defineProperty(close, "call", { value: undefined })
  const inner: any = { async next() { return { done: true, value: undefined } }, return: close }
  const o = __observed(inner, () => {}, () => {})
  expect(o.throw, "a missing throw is undefined").toBeUndefined()
  const r = o.return
  expect(typeof r, "the wrapped return is a function").toBe("function")
  await r()
  expect(closed, "the lower return ran").toBe(1)
})

test("T71 two refusal stop chunks in one stream alert once", async () => {
  __reset()
  const env = make$()
  const stop = { kind: "stop", stopReason: "refusal", usage: null }
  const result = { stopReason: "refusal" }
  const out = await runStep(env, [stop, { ...stop }], result, { model: "m", turnId: "t71", index: 0 })
  expect(out.chunks.length, "both stop chunks are yielded").toBe(2)
  expect(env.toast.length, "two refusal stop chunks alert once").toBe(1)
})

test("T72 a stop with no following next shows the toast and the log line at once", async () => {
  __reset()
  const env = make$({ now: hungClock })
  const s = fakeSignal()
  async function* lower() {
    yield { kind: "stop", stopReason: "refusal", usage: null }
    return { stopReason: "refusal" }
  }
  const gen = hooks.step(env.$, { model: "m", turnId: "t72", index: 0 }, withSignal(() => lower(), s.signal))
  const first = await gen.next()
  expect(first.done, "the stop chunk is yielded").toBe(false)
  expect(env.toast.length, "the toast is out before any clock read").toBe(1)
  expect(
    env.log.some(
      (row: any) =>
        String(row[0]).includes("Ответ оборван фильтром") && String(row[0]).includes("turn t72"),
    ),
    "the transcript line is out before any clock read",
  ).toBe(true)
  expect(env.status.length, "the status still waits for the clock").toBe(0)
  s.abort()
  let closed = false
  const closing = gen.return(undefined).then((v: any) => {
    closed = true
    return v
  })
  expect(await until(() => closed), "the step closes once the dispatch aborts").toBe(true)
  await closing
  expect(env.status.length, "the status lands after the abort").toBe(1)
  expect(String(env.status[0]), "the status time is a real HH:MM").toMatch(/\d\d:\d\d/)
})

test("T73 a hung clock holds the step only until next.signal aborts, and the window opens from Date.now", async () => {
  __reset()
  const env = make$({ now: hungClock })
  const s = fakeSignal()
  const spec = refusalChunks()
  const taskToasts = () => env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))
  let settled = false
  const p = collect(
    hooks.step(env.$, { model: "m", turnId: "t73", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), s.signal)),
  ).then((v) => {
    settled = true
    return v
  })
  expect(await until(() => env.toast.length === 1), "the toast precedes the clock").toBe(true)
  expect(settled, "the step is held while the dispatch lives").toBe(false)
  s.abort()
  expect(await until(() => settled), "the abort releases the step").toBe(true)
  expect((await p).chunks.length, "every chunk is still yielded").toBe(3)
  expect(env.status.length, "the status is set from Date.now").toBe(1)
  const t = fakeSignal()
  t.abort()
  const out = { result: stopOut("bg-73") }
  let tsDone = false
  const ts = hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u73", task_id: "bg-73" },
    withSignal(async () => out, t.signal),
  ).then((v: any) => {
    tsDone = true
    return v
  })
  expect(await until(() => tsDone), "the already-aborted stop returns").toBe(true)
  expect(await ts, "the stop result is returned").toBe(out)
  expect(taskToasts().length, "the window opened from Date.now holds").toBe(1)
  expect(String(taskToasts()[0][0]), "the toast names the task").toContain("bg-73")
})

test("T74 a TaskStop while the window is being opened alerts", async () => {
  __reset()
  const env = make$({ now: hungClock })
  const s = fakeSignal()
  const spec = refusalChunks()
  const taskToasts = () => env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))
  let stepDone = false
  const p = collect(
    hooks.step(env.$, { model: "m", turnId: "t74", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), s.signal)),
  ).then((v) => {
    stepDone = true
    return v
  })
  expect(await until(() => env.toast.length === 1), "the step alert has fired").toBe(true)
  const t = fakeSignal()
  const out = { result: stopOut("bg-74") }
  let tsDone = false
  const ts = hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u74", task_id: "bg-74" },
    withSignal(async () => out, t.signal),
  ).then((v: any) => {
    tsDone = true
    return v
  })
  expect(await until(() => taskToasts().length === 1), "the stop toasts while the window is opening").toBe(true)
  expect(String(taskToasts()[0][0]), "the toast names the task").toContain("bg-74")
  t.abort()
  expect(await until(() => tsDone), "the stop returns after its dispatch aborts").toBe(true)
  expect(await ts, "the stop result is returned").toBe(out)
  s.abort()
  expect(await until(() => stepDone), "the step finishes after its dispatch aborts").toBe(true)
  await p
})

test("T75 the opening mark is released once the window is set", async () => {
  __reset()
  const env = make$()
  env.setNow(1_000_000)
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t75", index: 0 })
  env.setNow(1_000_000 + 1_800_000)
  const taskToasts = () => env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))
  const out = { result: stopOut("bg-75") }
  const r = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u75", task_id: "bg-75" },
    async () => out,
  )
  expect(r, "the stop result is returned").toBe(out)
  expect(taskToasts().length, "past the window the opening mark is gone").toBe(0)
})

test("T76 an alert that outlives session.end neither keeps the window nor counts in the new session", async () => {
  __reset()
  const env = make$({ now: hungClock })
  const s = fakeSignal()
  const spec = refusalChunks()
  const taskToasts = () => env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))
  let stepDone = false
  const p = collect(
    hooks.step(env.$, { model: "m", turnId: "t76", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), s.signal)),
  ).then((v) => {
    stepDone = true
    return v
  })
  expect(await until(() => env.toast.length === 1), "the step alert has fired").toBe(true)
  await hooks.sessionEnd(env.$, { reason: "clear", sessionId: "s1", resume: { id: "s1" } }, async () => ({
    ended: true,
  }))
  const t1 = fakeSignal()
  t1.abort()
  const out1 = { result: stopOut("bg-76a") }
  let ts1Done = false
  const ts1 = hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u76a", task_id: "bg-76a" },
    withSignal(async () => out1, t1.signal),
  ).then((v: any) => {
    ts1Done = true
    return v
  })
  expect(await until(() => ts1Done), "the first stop returns").toBe(true)
  expect(await ts1, "the first stop result is returned").toBe(out1)
  expect(taskToasts().length, "session.end closed the opening window").toBe(0)
  s.abort()
  expect(await until(() => stepDone), "the step finishes after its dispatch aborts").toBe(true)
  await p
  expect(env.status.length, "the stale alert sets no status in the new session").toBe(0)
  expect(
    await until(() => env.journal().some((r: any) => r.turnId === "t76")),
    "the stale alert still writes its journal record",
  ).toBe(true)
  const t2 = fakeSignal()
  t2.abort()
  const out2 = { result: stopOut("bg-76b") }
  let ts2Done = false
  const ts2 = hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u76b", task_id: "bg-76b" },
    withSignal(async () => out2, t2.signal),
  ).then((v: any) => {
    ts2Done = true
    return v
  })
  expect(await until(() => ts2Done), "the second stop returns").toBe(true)
  expect(await ts2, "the second stop result is returned").toBe(out2)
  expect(taskToasts().length, "the stale alert kept no window for the new session").toBe(0)
})

test("T77 turn.complete waits for the clock only while the dispatch lives", async () => {
  __reset()
  const env = make$({ now: hungClock })
  const s = fakeSignal()
  const sentinel = { text: "shown" }
  let settled = false
  const p = hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t77", refusal: { category: "cyber", explanation: "x" } },
    withSignal(async () => sentinel, s.signal),
  ).then((v: any) => {
    settled = true
    return v
  })
  expect(await until(() => env.toast.length === 1), "the toast precedes the clock").toBe(true)
  expect(settled, "complete is held while the dispatch lives").toBe(false)
  s.abort()
  expect(await until(() => settled), "the abort releases complete").toBe(true)
  expect(await p, "next's result is returned unchanged").toBe(sentinel)
})

test("T78 an abort during a stuck write releases the caller and names the cause, not the clock", async () => {
  __reset()
  let setCalls = 0
  const env = make$({
    storeSet: () => {
      setCalls += 1
      return new Promise<void>(() => {})
    },
    sleep: (_ms: number, opt?: any) =>
      new Promise<void>((_res, rej) => {
        opt?.signal?.addEventListener("abort", () => rej(opt.signal.reason))
      }),
  })
  const s = fakeSignal()
  const spec = refusalChunks()
  let settled = false
  const p = collect(
    hooks.step(env.$, { model: "m", turnId: "t78", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), s.signal)),
  ).then((v) => {
    settled = true
    return v
  })
  expect(await until(() => setCalls >= 1), "the write has started").toBe(true)
  expect(settled, "the step is held by the write race").toBe(false)
  s.abort()
  expect(await until(() => settled), "the abort releases the step").toBe(true)
  await p
  expect(
    env.log.some((row: any) => String(row[0]).includes("ожидание записи снято отменой диспатча")),
    "the debug line names the dispatch abort",
  ).toBe(true)
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал clock не сработал")),
    "the clock is not blamed for the abort",
  ).toBe(false)
  expect(
    env.log.some((row: any) => String(row[0]).includes("запись дольше")),
    "the write is not called late",
  ).toBe(false)
  expect(env.sleepOptions[0]?.signal, "sleep receives the dispatch signal").toBe(s.signal)
})

test("T79 an abort releases a stuck write even when sleep ignores the signal", async () => {
  __reset()
  let setCalls = 0
  const env = make$({
    storeSet: () => {
      setCalls += 1
      return new Promise<void>(() => {})
    },
  })
  const s = fakeSignal()
  const spec = refusalChunks()
  let settled = false
  const p = collect(
    hooks.step(env.$, { model: "m", turnId: "t79", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), s.signal)),
  ).then((v) => {
    settled = true
    return v
  })
  expect(await until(() => setCalls >= 1), "the write has started").toBe(true)
  expect(settled, "the step is held by the write race").toBe(false)
  s.abort()
  expect(await until(() => settled), "the abort releases the step").toBe(true)
  await p
  expect(
    env.log.some((row: any) => String(row[0]).includes("ожидание записи снято отменой диспатча")),
    "the bounded race releases the caller without sleep",
  ).toBe(true)
})

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const taskToastsOf = (env: ReturnType<typeof make$>) =>
  env.toast.filter((row: any) => String(row[0]).includes("остановлена фоновая"))

test("T80 a TaskStop that entered before the refusal does not alert on the later window", async () => {
  __reset()
  const env = make$({ now: () => Date.now() })
  const d = deferred<any>()
  const out = { result: stopOut("bg-80a") }
  const ts = hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u80a", task_id: "bg-80a" }, () => d.promise)
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t80", index: 0 })
  d.resolve(out)
  expect(await ts, "the stop result is returned").toBe(out)
  expect(taskToastsOf(env).length, "a stop begun before the refusal is outside its window").toBe(0)
  const out2 = { result: stopOut("bg-80b") }
  await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u80b", task_id: "bg-80b" }, async () => out2)
  expect(taskToastsOf(env).length, "a stop begun after the refusal is inside").toBe(1)
})

test("T81 a TaskStop that entered with no window reads no clock, and a window opened meanwhile does not count", async () => {
  __reset()
  const env = make$({ now: () => Date.now() })
  const d = deferred<any>()
  const out = { result: stopOut("bg-81") }
  const before = env.clockCalls()
  const ts = hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u81", task_id: "bg-81" }, () => d.promise)
  expect(env.clockCalls(), "a stop that entered with no window reads no clock").toBe(before)
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t81", index: 0 })
  const mid = env.clockCalls()
  d.resolve(out)
  expect(await ts, "the stop result is returned").toBe(out)
  expect(env.clockCalls(), "nor after its core answers").toBe(mid)
  expect(taskToastsOf(env).length, "the window opened after the stop entered does not count").toBe(0)
})


test("T82 a TaskStop that outlives session.end does not alert on the new session's window", async () => {
  __reset()
  const env = make$({ now: () => Date.now() })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t82a", index: 0 })
  const d = deferred<any>()
  const out = { result: stopOut("bg-82") }
  const ts = hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u82", task_id: "bg-82" }, () => d.promise)
  await hooks.sessionEnd(env.$, { reason: "clear", sessionId: "s82", resume: { id: "s82" } }, async () => ({ ended: true }))
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t82b", index: 0 })
  d.resolve(out)
  expect(await ts, "the stop result is returned").toBe(out)
  expect(taskToastsOf(env).length, "a stop of the ended session does not alert").toBe(0)
})


test("T83 a turn.complete whose next returns after session.end toasts but keeps nothing", async () => {
  __reset()
  const env = make$()
  const d = deferred<any>()
  const sentinel = { text: "shown" }
  const p = hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t83", refusal: { category: "cyber", explanation: "x" } },
    () => d.promise,
  )
  await hooks.sessionEnd(env.$, { reason: "clear", sessionId: "s83", resume: { id: "s83" } }, async () => ({ ended: true }))
  d.resolve(sentinel)
  expect(await p, "next's result is returned unchanged").toBe(sentinel)
  expect(env.toast.length, "the refusal still toasts").toBe(1)
  expect(env.status.length, "the ended session's refusal sets no status").toBe(0)
  const out = { result: stopOut("bg-83") }
  await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u83", task_id: "bg-83" }, async () => out)
  expect(taskToastsOf(env).length, "the ended session's refusal opens no window").toBe(0)
})

test("T84 a step entered before session.end neither opens a mark nor sets status in the new session", async () => {
  __reset()
  const env = make$({ now: hungClock })
  const s = fakeSignal()
  const gate = deferred<void>()
  async function* lower() {
    await gate.promise
    yield { kind: "stop", stopReason: "refusal", usage: null }
    return { stopReason: "refusal" }
  }
  let stepDone = false
  const p = collect(hooks.step(env.$, { model: "m", turnId: "t84", index: 0 }, withSignal(() => lower(), s.signal))).then(
    (v) => {
      stepDone = true
      return v
    },
  )
  await hooks.sessionEnd(env.$, { reason: "clear", sessionId: "s84", resume: { id: "s84" } }, async () => ({ ended: true }))
  gate.resolve()
  expect(await until(() => env.toast.length === 1), "the stop still toasts").toBe(true)
  const t = fakeSignal()
  t.abort()
  const out = { result: stopOut("bg-84") }
  const r = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u84", task_id: "bg-84" },
    withSignal(async () => out, t.signal),
  )
  expect(r, "the stop result is returned").toBe(out)
  expect(taskToastsOf(env).length, "the ended session's step opens no mark in the new one").toBe(0)
  s.abort()
  expect(await until(() => stepDone), "the step finishes after its dispatch aborts").toBe(true)
  await p
  expect(env.status.length, "the ended session's step sets no status").toBe(0)
})

test("T85 releasing one opening mark leaves another alert's mark in place", async () => {
  __reset()
  const env = make$({
    now: (tick: number) => (tick === 1 ? new Promise<number>(() => {}) : tick === 2 ? 1_000 : 10_000_000),
  })
  const sa = fakeSignal()
  const spec = refusalChunks()
  let aDone = false
  const a = collect(
    hooks.step(env.$, { model: "m", turnId: "t85a", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), sa.signal)),
  ).then((v) => {
    aDone = true
    return v
  })
  expect(await until(() => env.toast.length === 1), "the hung alert has fired").toBe(true)
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t85b", index: 1 })
  const out = { result: stopOut("bg-85") }
  await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u85", task_id: "bg-85" }, async () => out)
  expect(taskToastsOf(env).length, "the hung alert's mark still holds after the other alert released its own").toBe(1)
  sa.abort()
  expect(await until(() => aDone), "the hung step finishes after its dispatch aborts").toBe(true)
  await a
})

test("T86 an opening mark expires after the window by wall time", async () => {
  __reset()
  let wallNow = 5_000_000
  __setWall(() => wallNow)
  try {
    const env = make$({ now: (tick: number) => (tick === 1 ? new Promise<number>(() => {}) : 1) })
    const spec = refusalChunks()
    void collect(hooks.step(env.$, { model: "m", turnId: "t86", index: 0 }, () => chunksOf(spec.chunks, spec.result)))
    expect(await until(() => env.toast.length === 1), "the hung alert has fired").toBe(true)
    wallNow = 5_000_000 + 1_799_999
    const out1 = { result: stopOut("bg-86a") }
    await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u86a", task_id: "bg-86a" }, async () => out1)
    expect(taskToastsOf(env).length, "the mark holds inside the window").toBe(1)
    wallNow = 5_000_000 + 1_800_000
    const out2 = { result: stopOut("bg-86b") }
    await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u86b", task_id: "bg-86b" }, async () => out2)
    expect(taskToastsOf(env).length, "the mark is gone at the window's edge").toBe(1)
  } finally {
    __setWall(null)
  }
})

test("T87 an already-aborted wait still subscribes to the awaited promise", async () => {
  const s = fakeSignal()
  s.abort()
  let attached = 0
  const p: any = {
    then() {
      attached += 1
    },
  }
  const v = await __bounded(p, s.signal, () => "aborted")
  expect(v, "the aborted value wins").toBe("aborted")
  expect(attached, "the awaited promise got its handlers").toBe(1)
})

test("T88 a throwing onAbort rejects the wait on both abort paths", async () => {
  const boom1 = new Error("abort-boom-1")
  const s1 = fakeSignal()
  s1.abort()
  let got1: any = null
  let settled1 = false
  void __bounded(new Promise<number>(() => {}), s1.signal, () => {
    throw boom1
  }).then(
    () => {
      settled1 = true
    },
    (x: any) => {
      got1 = x
      settled1 = true
    },
  )
  expect(await until(() => settled1), "the already-aborted path settles").toBe(true)
  expect(got1, "the already-aborted path rejects with the throw").toBe(boom1)
  const boom2 = new Error("abort-boom-2")
  const s2 = fakeSignal()
  let got2: any = null
  let settled = false
  const q = __bounded(new Promise<number>(() => {}), s2.signal, () => {
    throw boom2
  }).then(
    () => {
      settled = true
    },
    (x: any) => {
      got2 = x
      settled = true
    },
  )
  s2.abort()
  expect(await until(() => settled), "the listener path settles").toBe(true)
  await q
  expect(got2, "the listener path rejects with the throw").toBe(boom2)
})

test("T89 a wait settled by its promise removes its abort listener", async () => {
  const s = fakeSignal()
  const v = await __bounded(Promise.resolve(7), s.signal, () => 0)
  expect(v, "the promise value is returned").toBe(7)
  expect(s.listenerCount(), "no abort listener is left").toBe(0)
})

test("T90 a later abort after the promise settled calls nothing, and the listener is once", async () => {
  const s = fakeSignal({ removeThrows: true })
  let calls = 0
  const v = await __bounded(Promise.resolve(7), s.signal, () => {
    calls += 1
    return 0
  })
  expect(v, "the promise value is returned").toBe(7)
  expect(s.listenerCount(), "a throwing remove leaves the listener").toBe(1)
  s.abort()
  expect(calls, "an abort after the promise settled does not call onAbort").toBe(0)
  expect(s.listenerCount(), "the listener is registered once").toBe(0)
})

test("T91 under an aborted signal a foreign sleep failure is still a clock failure", async () => {
  __reset()
  const env = make$({
    storeSet: () => new Promise<void>(() => {}),
    sleep: () => Promise.reject(new Error("sleep-other")),
  })
  const s = fakeSignal()
  s.abort()
  const spec = refusalChunks()
  await collect(
    hooks.step(env.$, { model: "m", turnId: "t91", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), s.signal)),
  )
  expect(
    await until(() => env.log.some((row: any) => String(row[0]).includes("канал clock не сработал"))),
    "a sleep failure that is not the abort reaches the clock channel",
  ).toBe(true)
})

test("T92 an abort line never claims the write goes on in the background", async () => {
  __reset()
  const env = make$()
  const s = fakeSignal()
  s.abort()
  const spec = refusalChunks()
  await collect(
    hooks.step(env.$, { model: "m", turnId: "t92", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), s.signal)),
  )
  expect(
    env.log.some((row: any) => String(row[0]).includes("ожидание записи снято отменой диспатча; запись не подтверждена")),
    "the abort line says the write is unconfirmed",
  ).toBe(true)
  expect(
    env.log.some((row: any) => String(row[0]).includes("запись продолжается в фоне")),
    "no line claims the write goes on",
  ).toBe(false)
})

test("T93 a sleep failure without an abort names the unconfirmed write", async () => {
  __reset()
  const env = make$({
    storeSet: () => new Promise<void>(() => {}),
    sleep: () => Promise.reject(new Error("sleep-boom")),
  })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t93", index: 0 })
  expect(
    env.log.some((row: any) => String(row[0]).includes("ожидание записи снято отказом часов; запись не подтверждена")),
    "the released wait names the clock and the unconfirmed write",
  ).toBe(true)
})

test("T94 a TaskStop whose next returns after session.end reads no clock after it and does not toast", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t94", index: 0 })
  const d = deferred<any>()
  const out = { result: stopOut("bg-94") }
  const ts = hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u94", task_id: "bg-94" }, () => d.promise)
  await hooks.sessionEnd(env.$, { reason: "clear", sessionId: "s94", resume: { id: "s94" } }, async () => ({ ended: true }))
  const reads = env.clockCalls()
  d.resolve(out)
  expect(await ts, "the stop result is returned").toBe(out)
  expect(taskToastsOf(env).length, "a stop of the ended session does not toast").toBe(0)
  expect(env.clockCalls(), "the stop reads no clock after the session ended").toBe(reads)
})

test("T95 a TaskStop entered inside an open window does not alert when session.end lands during its clock read", async () => {
  __reset()
  let held: ((v: number) => void) | null = null
  const env = make$({
    now: (tick: number) => (tick === 2 ? new Promise<number>((r) => { held = r }) : 5_000_000),
  })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t95", index: 0 })
  const out = { result: stopOut("bg-95") }
  const ts = hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u95", task_id: "bg-95" }, async () => out)
  expect(await until(() => held != null), "the stop is waiting on its clock read").toBe(true)
  await hooks.sessionEnd(env.$, { reason: "clear", sessionId: "s95", resume: { id: "s95" } }, async () => ({ ended: true }))
  held!(5_000_000)
  expect(await ts, "the stop result is returned").toBe(out)
  expect(taskToastsOf(env).length, "the session ended while the stop read its clock").toBe(0)
})

test("T96 the same stop alerts when the session does not end during its clock read", async () => {
  __reset()
  let held: ((v: number) => void) | null = null
  const env = make$({
    now: (tick: number) => (tick === 2 ? new Promise<number>((r) => { held = r }) : 5_000_000),
  })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t96", index: 0 })
  const out = { result: stopOut("bg-96") }
  const ts = hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u96", task_id: "bg-96" }, async () => out)
  expect(await until(() => held != null), "the stop is waiting on its clock read").toBe(true)
  held!(5_000_000)
  expect(await ts, "the stop result is returned").toBe(out)
  expect(taskToastsOf(env).length, "without session.end the stop inside the window toasts").toBe(1)
})

test("T97 a TaskStop that entered inside the window alerts even when its next returns past the window's edge", async () => {
  __reset()
  let cur = 5_000_000
  const env = make$({ now: () => cur })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t97", index: 0 })
  cur = 5_000_000 + 1_799_999
  const out = { result: stopOut("bg-97") }
  const ts = hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u97", task_id: "bg-97" }, async () => {
    cur = 5_000_000 + 1_800_000
    return out
  })
  expect(await ts, "the stop result is returned").toBe(out)
  expect(taskToastsOf(env).length, "the stop entered inside the window").toBe(1)
})

test("T98 a TaskStop whose entry clock read hangs and aborts is judged by its entry wall time, not a later one", async () => {
  __reset()
  let wallNow = 9_000_000
  __setWall(() => wallNow)
  try {
    const env = make$({ now: (tick: number) => (tick === 2 ? new Promise<number>(() => {}) : 5_000_000) })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t98", index: 0 })
    const t = fakeSignal()
    const out = { result: stopOut("bg-98") }
    let tsDone = false
    const ts = hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u98", task_id: "bg-98" },
      withSignal(async () => {
        wallNow = 5_000_000
        return out
      }, t.signal),
    ).then((v: any) => {
      tsDone = true
      return v
    })
    expect(await until(() => env.clockCalls() >= 2), "the stop waits on its entry clock read").toBe(true)
    t.abort()
    expect(await until(() => tsDone), "the abort releases the stop").toBe(true)
    expect(await ts, "the stop result is returned").toBe(out)
    expect(taskToastsOf(env).length, "the entry wall time is outside the window").toBe(0)
  } finally {
    __setWall(null)
  }
})

test("T99 a throwing wall at a TaskStop's entry does not take the call's result", async () => {
  __reset()
  try {
    const env = make$({ now: () => 5_000_000 })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t99", index: 0 })
    __setWall(() => {
      throw new Error("wall-boom")
    })
    let calls = 0
    const out = { result: stopOut("bg-99") }
    const r = await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u99", task_id: "bg-99" }, async () => {
      calls += 1
      return out
    })
    expect(r, "the stop result is returned").toBe(out)
    expect(calls, "the core ran exactly once").toBe(1)
    expect(
      env.log.some((row: any) => String(row[0]).includes("канал clock не сработал")),
      "the wall failure reaches the clock channel",
    ).toBe(true)
  } finally {
    __setWall(null)
  }
})

test("T100 a wall step backwards inside the window keeps the opening mark", async () => {
  __reset()
  let wallNow = 5_000_000
  __setWall(() => wallNow)
  try {
    const env = make$({ now: (tick: number) => (tick === 1 ? new Promise<number>(() => {}) : 1) })
    const spec = refusalChunks()
    void collect(hooks.step(env.$, { model: "m", turnId: "t100", index: 0 }, () => chunksOf(spec.chunks, spec.result)))
    expect(await until(() => env.toast.length === 1), "the hung alert has fired").toBe(true)
    wallNow = 5_000_000 - 1_799_999
    const out = { result: stopOut("bg-100") }
    await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u100", task_id: "bg-100" }, async () => out)
    expect(taskToastsOf(env).length, "a step back of less than the window keeps the mark").toBe(1)
  } finally {
    __setWall(null)
  }
})

test("T101 an already-aborted wait hands the awaited promise a rejection handler", async () => {
  const s = fakeSignal()
  s.abort()
  let onRejected: any = "unset"
  const p: any = {
    then(_f: any, r: any) {
      onRejected = r
    },
  }
  const v = await __bounded(p, s.signal, () => "aborted")
  expect(v, "the aborted value wins").toBe("aborted")
  expect(typeof onRejected, "a late rejection of the awaited promise has a handler").toBe("function")
  expect(() => onRejected(new Error("late")), "the late rejection is absorbed").not.toThrow()
})

test("T102 a rejected promise with a throwing onAbort removes the abort listener", async () => {
  const s = fakeSignal()
  const boom = new Error("abort-boom-102")
  let got: any = null
  await __bounded(Promise.reject(new Error("p-102")), s.signal, () => {
    throw boom
  }).catch((x: any) => {
    got = x
  })
  expect(got, "the wait rejects with the throw").toBe(boom)
  expect(s.listenerCount(), "no abort listener is left after the rejected path").toBe(0)
})

test("T103 under an aborted signal a sleep refused with a fresh AbortError stays off the clock channel", async () => {
  __reset()
  const env = make$({
    storeSet: () => new Promise<void>(() => {}),
    sleep: () => {
      const x = new Error("fresh")
      x.name = "AbortError"
      return Promise.reject(x)
    },
  })
  const s = fakeSignal()
  s.abort()
  const spec = refusalChunks()
  await collect(
    hooks.step(env.$, { model: "m", turnId: "t103", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), s.signal)),
  )
  expect(
    await until(() => env.log.some((row: any) => String(row[0]).includes("ожидание записи снято отменой диспатча"))),
    "the release names the cancelled dispatch",
  ).toBe(true)
  expect(await until(() => env.sleepCalls.length >= 1), "the sleep was asked").toBe(true)
  for (let i = 0; i < 50; i++) await Promise.resolve()
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал clock не сработал")),
    "a fresh AbortError under the aborted signal is not a clock failure",
  ).toBe(false)
})

test("T104 an aborted signal that bounded cannot subscribe to still names the cancelled dispatch", async () => {
  __reset()
  const reason = new Error("gone")
  const sig: any = { aborted: true, reason }
  const env = make$({
    storeSet: () => new Promise<void>(() => {}),
    sleep: () => Promise.reject(reason),
  })
  const spec = refusalChunks()
  await collect(
    hooks.step(env.$, { model: "m", turnId: "t104", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), sig)),
  )
  expect(
    await until(() => env.log.some((row: any) => String(row[0]).includes("ожидание записи снято отменой диспатча"))),
    "the release names the cancelled dispatch",
  ).toBe(true)
  expect(
    env.log.some((row: any) => String(row[0]).includes("отказом часов")),
    "the release does not blame the clock",
  ).toBe(false)
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал clock не сработал")),
    "the abort reason is not a clock failure",
  ).toBe(false)
})

test("T106 a non-numeric wall at a TaskStop's entry keeps the opening marks and counts as inside", async () => {
  __reset()
  let wallNow = 1_000_000
  __setWall(() => wallNow)
  try {
    const env = make$({ now: hungClock })
    const spec = refusalChunks()
    const sa = fakeSignal()
    let aDone = false
    const a = collect(
      hooks.step(env.$, { model: "m", turnId: "t106", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), sa.signal)),
    ).then((v) => {
      aDone = true
      return v
    })
    expect(await until(() => env.toast.length === 1), "the alert has fired").toBe(true)
    wallNow = Number.NaN
    const t1 = fakeSignal()
    const out1 = { result: stopOut("bg-106a") }
    let d1 = false
    const ts1 = hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u106a", task_id: "bg-106a" },
      withSignal(async () => out1, t1.signal),
    ).then((v: any) => {
      d1 = true
      return v
    })
    expect(await until(() => taskToastsOf(env).length === 1), "a stop with a non-numeric wall counts as inside").toBe(true)
    t1.abort()
    expect(await until(() => d1), "the abort releases the first stop").toBe(true)
    expect(await ts1, "the first stop result is returned").toBe(out1)
    wallNow = 1_000_000
    const t2 = fakeSignal()
    const out2 = { result: stopOut("bg-106b") }
    let d2 = false
    const ts2 = hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u106b", task_id: "bg-106b" },
      withSignal(async () => out2, t2.signal),
    ).then((v: any) => {
      d2 = true
      return v
    })
    expect(await until(() => taskToastsOf(env).length === 2), "the mark survived the non-numeric wall").toBe(true)
    t2.abort()
    expect(await until(() => d2), "the abort releases the second stop").toBe(true)
    expect(await ts2, "the second stop result is returned").toBe(out2)
    sa.abort()
    expect(await until(() => aDone), "the alert's step finishes after its dispatch aborts").toBe(true)
    await a
  } finally {
    __setWall(null)
  }
})

test("T107 a throwing wall at a TaskStop's entry still honours the opening mark", async () => {
  __reset()
  let wallThrows = false
  __setWall(() => {
    if (wallThrows) throw new Error("wall-boom")
    return 1_000_000
  })
  try {
    const env = make$({ now: hungClock })
    const spec = refusalChunks()
    const sa = fakeSignal()
    let aDone = false
    const a = collect(
      hooks.step(env.$, { model: "m", turnId: "t107", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), sa.signal)),
    ).then((v) => {
      aDone = true
      return v
    })
    expect(await until(() => env.toast.length === 1), "the alert has fired").toBe(true)
    wallThrows = true
    const t = fakeSignal()
    const out = { result: stopOut("bg-107") }
    let tsDone = false
    const ts = hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u107", task_id: "bg-107" },
      withSignal(async () => out, t.signal),
    ).then((v: any) => {
      tsDone = true
      return v
    })
    expect(await until(() => taskToastsOf(env).length === 1), "the open mark decides without a wall time").toBe(true)
    wallThrows = false
    t.abort()
    expect(await until(() => tsDone), "the abort releases the stop").toBe(true)
    expect(await ts, "the stop result is returned").toBe(out)
    expect(
      env.log.some((row: any) => String(row[0]).includes("канал clock не сработал")),
      "the wall failure reaches the clock channel",
    ).toBe(true)
    sa.abort()
    expect(await until(() => aDone), "the alert's step finishes after its dispatch aborts").toBe(true)
    await a
  } finally {
    __setWall(null)
  }
})

test("T108 a TaskStop whose entry wall time is inside the window alerts even when the clock would answer past the edge", async () => {
  __reset()
  __setWall(() => 6_799_999)
  try {
    const env = make$({ now: (tick: number) => (tick === 1 ? 5_000_000 : 6_800_001) })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t108", index: 0 })
    const out = { result: stopOut("bg-108") }
    const r = await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u108", task_id: "bg-108" }, async () => out)
    expect(r, "the stop result is returned").toBe(out)
    expect(taskToastsOf(env).length, "the entry wall time is inside the window").toBe(1)
  } finally {
    __setWall(null)
  }
})

test("T109 a TaskStop with neither a wall nor a clock time at its entry counts as inside the window", async () => {
  __reset()
  try {
    const env = make$({
      now: (tick: number) => {
        if (tick === 2) throw new Error("clock-boom")
        return 5_000_000
      },
    })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t109", index: 0 })
    __setWall(() => {
      throw new Error("wall-boom")
    })
    const out = { result: stopOut("bg-109") }
    const r = await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u109", task_id: "bg-109" }, async () => out)
    expect(r, "the stop result is returned").toBe(out)
    expect(taskToastsOf(env).length, "an unknown entry time counts as inside").toBe(1)
  } finally {
    __setWall(null)
  }
})

test("T110 a TaskStop whose entry wall time is inside the window reads no clock", async () => {
  __reset()
  __setWall(() => 5_000_001)
  try {
    const env = make$({ now: () => 5_000_000 })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t110", index: 0 })
    const before = env.clockCalls()
    const out = { result: stopOut("bg-110") }
    let reads = -1
    const r = await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u110", task_id: "bg-110" }, async () => {
      reads = env.clockCalls()
      return out
    })
    expect(r, "the stop result is returned").toBe(out)
    expect(reads, "no clock read is issued at the entry").toBe(before)
    expect(taskToastsOf(env).length, "the stop alerts").toBe(1)
    expect(env.clockCalls(), "the only clock read is the log record's").toBe(before + 1)
  } finally {
    __setWall(null)
  }
})

test("T111 a TaskStop with a negative wall time and no window gives no toast and reads no clock", async () => {
  __reset()
  __setWall(() => -1)
  try {
    const env = make$({ now: () => -1 })
    const before = env.clockCalls()
    const out = { result: stopOut("bg-111") }
    const r = await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u111", task_id: "bg-111" }, async () => out)
    expect(r, "the stop result is returned").toBe(out)
    expect(taskToastsOf(env).length, "no window, no toast").toBe(0)
    expect(env.clockCalls(), "no window, no clock read").toBe(before)
  } finally {
    __setWall(null)
  }
})

test("T112 an alert that learns no time opens a window of unknown end, and a stop inside it reads no clock", async () => {
  __reset()
  let wallThrows = false
  __setWall(() => {
    if (wallThrows) throw new Error("wall-boom")
    return 1_000_000
  })
  try {
    const env = make$({ now: hungClock })
    const spec = refusalChunks()
    const sa = fakeSignal()
    let aDone = false
    const a = collect(
      hooks.step(env.$, { model: "m", turnId: "t112", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), sa.signal)),
    ).then((v) => {
      aDone = true
      return v
    })
    expect(await until(() => env.toast.length === 1), "the alert has fired").toBe(true)
    wallThrows = true
    sa.abort()
    expect(await until(() => aDone), "the alert's step finishes").toBe(true)
    wallThrows = false
    await a
    const before = env.clockCalls()
    const t = fakeSignal()
    const out = { result: stopOut("bg-112") }
    let tsDone = false
    const ts = hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u112", task_id: "bg-112" },
      withSignal(async () => out, t.signal),
    ).then((v: any) => {
      tsDone = true
      return v
    })
    expect(await until(() => taskToastsOf(env).length === 1), "a window of unknown end counts as inside").toBe(true)
    expect(env.clockCalls(), "the only clock read is the stop's own log record's").toBe(before + 1)
    t.abort()
    expect(await until(() => tsDone), "the abort releases the stop").toBe(true)
    expect(await ts, "the stop result is returned").toBe(out)
  } finally {
    __setWall(null)
  }
})

test("T113 a window that ends at time zero still holds a stop inside it", async () => {
  __reset()
  __setWall(() => -1_800_000)
  try {
    const env = make$({ now: () => -1_800_000 })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t113", index: 0 })
    const out = { result: stopOut("bg-113") }
    const r = await hooks.taskstop(env.$, { tool: "TaskStop", tool_use_id: "u113", task_id: "bg-113" }, async () => out)
    expect(r, "the stop result is returned").toBe(out)
    expect(taskToastsOf(env).length, "a window ending at zero is a window").toBe(1)
  } finally {
    __setWall(null)
  }
})

test("T114 an opening mark set at an unknown time is not swept by a known one", async () => {
  __reset()
  let wallNow = Number.NaN
  __setWall(() => wallNow)
  try {
    const env = make$({ now: hungClock })
    const spec = refusalChunks()
    const sa = fakeSignal()
    let aDone = false
    const a = collect(
      hooks.step(env.$, { model: "m", turnId: "t114", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), sa.signal)),
    ).then((v) => {
      aDone = true
      return v
    })
    expect(await until(() => env.toast.length === 1), "the alert has fired").toBe(true)
    wallNow = 1_000_000
    const t = fakeSignal()
    const out = { result: stopOut("bg-114") }
    let tsDone = false
    const ts = hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u114", task_id: "bg-114" },
      withSignal(async () => out, t.signal),
    ).then((v: any) => {
      tsDone = true
      return v
    })
    expect(await until(() => taskToastsOf(env).length === 1), "the mark of unknown age holds").toBe(true)
    t.abort()
    expect(await until(() => tsDone), "the abort releases the stop").toBe(true)
    expect(await ts, "the stop result is returned").toBe(out)
    sa.abort()
    expect(await until(() => aDone), "the alert's step finishes after its dispatch aborts").toBe(true)
    await a
  } finally {
    __setWall(null)
  }
})

test("T115 a wall step backwards of more than the window keeps the opening mark", async () => {
  __reset()
  let wallNow = 5_000_000
  __setWall(() => wallNow)
  try {
    const env = make$({ now: hungClock })
    const spec = refusalChunks()
    const sa = fakeSignal()
    let aDone = false
    const a = collect(
      hooks.step(env.$, { model: "m", turnId: "t115", index: 0 }, withSignal(() => chunksOf(spec.chunks, spec.result), sa.signal)),
    ).then((v) => {
      aDone = true
      return v
    })
    expect(await until(() => env.toast.length === 1), "the alert has fired").toBe(true)
    wallNow = -1
    const t = fakeSignal()
    const out = { result: stopOut("bg-115") }
    let tsDone = false
    const ts = hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u115", task_id: "bg-115" },
      withSignal(async () => out, t.signal),
    ).then((v: any) => {
      tsDone = true
      return v
    })
    expect(await until(() => taskToastsOf(env).length === 1), "a step back keeps the mark").toBe(true)
    t.abort()
    expect(await until(() => tsDone), "the abort releases the stop").toBe(true)
    expect(await ts, "the stop result is returned").toBe(out)
    sa.abort()
    expect(await until(() => aDone), "the alert's step finishes after its dispatch aborts").toBe(true)
    await a
  } finally {
    __setWall(null)
  }
})

test("T116 a throwing wall when the mark is set does not take the stop's toast", async () => {
  __reset()
  __setWall(() => {
    throw new Error("wall-boom")
  })
  try {
    const env = make$({ now: () => 5_000_000 })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t116", index: 0 })
    expect(env.toast.length, "the refusal toast is shown").toBe(1)
    expect(
      env.log.some((row: any) => String(row[0]).includes("канал clock не сработал")),
      "the wall failure reaches the clock channel",
    ).toBe(true)
  } finally {
    __setWall(null)
  }
})

test("T117 a refusal whose time is unknown puts no NaN in the status", async () => {
  __reset()
  __setWall(() => Number.NaN)
  try {
    const env = make$({ clockReject: true })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t117", index: 0 })
    expect(env.status.length, "status is set").toBe(1)
    expect(String(env.status[0]), "the unknown time is shown as --:--").toContain("последний --:--")
    expect(String(env.status[0]), "status has no NaN").not.toContain("NaN")
  } finally {
    __setWall(null)
  }
})

test("T118 a refusal whose time is unknown still dedups its turn's complete", async () => {
  __reset()
  __setWall(() => Number.NaN)
  try {
    const env = make$({ clockReject: true })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t118", index: 0 })
    expect(__dedupSize(), "unknown time still marks the turn").toBe(1)
    await hooks.complete(
      env.$,
      { reason: "refusal", turnId: "t118", refusal: { category: "c", explanation: "x" } },
      async () => ({ text: "c" }),
    )
    expect(String(env.status[env.status.length - 1]), "the turn counts once").toContain(
      "за сессию: 1",
    )
  } finally {
    __setWall(null)
  }
})

test("T119 an older refusal whose clock answers later does not move the window or the status back", async () => {
  __reset()
  __setWall(() => 1_000)
  try {
    const dA = deferred<number>()
    const dB = deferred<number>()
    const env = make$({
      now: (tick: number) => (tick === 1 ? dA.promise : tick === 2 ? dB.promise : 5_000_000),
    })
    const specA = refusalChunks()
    let aDone = false
    const a = runStep(env, specA.chunks, specA.result, { model: "mA", turnId: "tA", index: 0 }).then(
      (v) => {
        aDone = true
        return v
      },
    )
    expect(await until(() => env.toast.length === 1), "the first refusal toasts").toBe(true)
    const specB = refusalChunks()
    let bDone = false
    const b = runStep(env, specB.chunks, specB.result, { model: "mB", turnId: "tB", index: 0 }).then(
      (v) => {
        bDone = true
        return v
      },
    )
    expect(await until(() => env.toast.length === 2), "the second refusal toasts").toBe(true)
    dB.resolve(10_000_000)
    expect(await until(() => bDone), "step B ends first").toBe(true)
    await b
    dA.resolve(2_000_000)
    expect(await until(() => aDone), "step A ends after B").toBe(true)
    await a
    const hhmmOf = (n: number) =>
      String(new Date(n).getHours()).padStart(2, "0") + ":" + String(new Date(n).getMinutes()).padStart(2, "0")
    const last = String(env.status[env.status.length - 1])
    expect(last, "the count is two").toContain("за сессию: 2")
    expect(last, "the last time stays the newer refusal's").toContain("последний " + hhmmOf(10_000_000))
    expect(last, "the last model stays the newer refusal's").toContain(" mB")
    __setWall(() => 10_500_000)
    const out = { result: stopOut("bg-119") }
    const r = await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u119", task_id: "bg-119" },
      async () => out,
    )
    expect(r, "the stop result is returned").toBe(out)
    expect(taskToastsOf(env).length, "the newer refusal's window holds the stop").toBe(1)
  } finally {
    __setWall(null)
  }
})

test("T120 an older step of a turn whose clock answers later does not break the turn's dedup", async () => {
  __reset()
  const dA = deferred<number>()
  const dB = deferred<number>()
  const env = make$({
    now: (tick: number) => (tick === 1 ? dA.promise : tick === 2 ? dB.promise : 10_030_000),
  })
  const specA = refusalChunks()
  let aDone = false
  const a = runStep(env, specA.chunks, specA.result, { model: "m", turnId: "t120", index: 0 }).then(
    (v) => {
      aDone = true
      return v
    },
  )
  expect(await until(() => env.toast.length === 1), "the first step toasts").toBe(true)
  const specB = refusalChunks()
  let bDone = false
  const b = runStep(env, specB.chunks, specB.result, { model: "m", turnId: "t120", index: 1 }).then(
    (v) => {
      bDone = true
      return v
    },
  )
  expect(await until(() => env.toast.length === 2), "the second step toasts").toBe(true)
  dB.resolve(10_000_000)
  expect(await until(() => bDone), "step B ends first").toBe(true)
  await b
  dA.resolve(2_000_000)
  expect(await until(() => aDone), "step A ends after B").toBe(true)
  await a
  await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t120", refusal: { category: "c", explanation: "x" } },
    async () => ({ ended: true }),
  )
  expect(String(env.status[env.status.length - 1]), "the turn counts once").toContain("за сессию: 2")
})

test("T121 a refusal explanation that is not a string still announces the turn", async () => {
  __reset()
  const sentinel = { done: true }
  const env = make$()
  const r = await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t121", refusal: { category: 7, explanation: 5 } },
    async () => sentinel,
  )
  expect(r, "the next result is returned").toBe(sentinel)
  expect(env.toast.length, "one toast").toBe(1)
  expect(String(env.toast[0][0]), "the category is stringified").toContain("категория 7")
  expect(env.journal()[0].explanation, "the explanation is stringified").toBe("5")
})

test("T122 event fields that are not strings still give the toast text", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, {
    model: Symbol("m"),
    agentId: {
      toString() {
        throw new Error("x")
      },
    },
    turnId: "t122",
    index: 0,
  })
  expect(env.toast.length, "one toast").toBe(1)
  expect(String(env.toast[0][0]), "the model is stringified").toContain("Symbol(m)")
  expect(String(env.toast[0][0]), "an unreadable agent is a question mark").toContain("агент ?")
  expect(String(env.status[env.status.length - 1]), "the status model is stringified").toContain(" Symbol(m)")
})

test("T123 a signal whose listener cannot be read does not lose the refusal's accounting", async () => {
  __reset()
  const sig: any = { aborted: false }
  Object.defineProperty(sig, "addEventListener", { get() { throw new Error("getter-boom") } })
  const env = make$()
  const spec = refusalChunks()
  await collect(
    hooks.step(
      env.$,
      { model: "m", turnId: "t123", index: 0 },
      withSignal(() => chunksOf(spec.chunks, spec.result), sig),
    ),
  )
  expect(env.status.length, "the status is set").toBe(1)
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал alert не сработал")),
    "no alert channel failure",
  ).toBe(false)
})

test("T124 a throw after the opening mark is set still removes the mark", async () => {
  __reset()
  __setWall(() => Number.NaN)
  ;(reg as any).__setFault(() => {
    throw new Error("fault")
  })
  try {
    const env = make$()
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t124", index: 0 })
    expect(
      env.log.some((row: any) => String(row[0]).includes("канал alert не сработал")),
      "the fault reaches the alert channel",
    ).toBe(true)
    ;(reg as any).__setFault(null)
    const out = { result: stopOut("bg-124") }
    const r = await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u124", task_id: "bg-124" },
      async () => out,
    )
    expect(r, "the stop result is returned").toBe(out)
    expect(taskToastsOf(env).length, "the mark was removed").toBe(0)
  } finally {
    ;(reg as any).__setFault(null)
    __setWall(null)
  }
})

test("T125 local time that is not a finite number is reported on the clock channel", async () => {
  __reset()
  __setWall(() => "x" as any)
  try {
    const env = make$()
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t125", index: 0 })
    expect(
      env.log.some(
        (row: any) =>
          String(row[0]).includes("канал clock не сработал") &&
          String(row[0]).includes("местное время не число"),
      ),
      "the non-number wall is named on the clock channel",
    ).toBe(true)
  } finally {
    __setWall(null)
  }
})

test("T126 a newer refusal with an earlier time does not close the window on an older one", async () => {
  __reset()
  __setWall(() => 10_000_000)
  try {
    const dA = deferred<number>()
    const dB = deferred<number>()
    const env = make$({
      now: (tick: number) => (tick === 1 ? dA.promise : tick === 2 ? dB.promise : 10_000_000),
    })
    const specA = refusalChunks()
    let aDone = false
    const a = runStep(env, specA.chunks, specA.result, { model: "mA", turnId: "tA", index: 0 }).then(
      (v) => {
        aDone = true
        return v
      },
    )
    expect(await until(() => env.toast.length === 1), "the older refusal toasts").toBe(true)
    const specB = refusalChunks()
    let bDone = false
    const b = runStep(env, specB.chunks, specB.result, { model: "mB", turnId: "tB", index: 0 }).then(
      (v) => {
        bDone = true
        return v
      },
    )
    expect(await until(() => env.toast.length === 2), "the newer refusal toasts").toBe(true)
    dB.resolve(2_000_000)
    expect(await until(() => bDone), "the newer step ends first").toBe(true)
    await b
    dA.resolve(10_000_000)
    expect(await until(() => aDone), "the older step ends after it").toBe(true)
    await a
    const hhmmOf = (n: number) =>
      String(new Date(n).getHours()).padStart(2, "0") + ":" + String(new Date(n).getMinutes()).padStart(2, "0")
    const last = String(env.status[env.status.length - 1])
    expect(last, "the count is two").toContain("за сессию: 2")
    expect(last, "the last time is the older refusal's later answer").toContain(
      "последний " + hhmmOf(10_000_000),
    )
    expect(last, "the last model is the older refusal's").toContain(" mA")
    __setWall(() => 10_500_000)
    const out = { result: stopOut("bg-126") }
    const r = await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u126", task_id: "bg-126" },
      async () => out,
    )
    expect(r, "the stop result is returned").toBe(out)
    expect(taskToastsOf(env).length, "the older refusal's window holds the stop").toBe(1)
  } finally {
    __setWall(null)
  }
})

test("T127 an unknown-time refusal keeps the window open until a later one knows its time", async () => {
  __reset()
  __setWall(() => Number.NaN)
  try {
    const env = make$({ clockReject: true })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "u1", index: 0 })
    __setWall(() => 9e12)
    const out1 = { result: stopOut("bg-127a") }
    const r1 = await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u127a", task_id: "bg-127a" },
      async () => out1,
    )
    expect(r1, "the stop result is returned").toBe(out1)
    expect(taskToastsOf(env).length, "the unknown end counts as inside").toBe(1)
  } finally {
    __setWall(null)
  }

  __reset()
  __setWall(() => Number.NaN)
  try {
    const env = make$({
      now: (tick: number) =>
        tick === 1 ? Promise.reject(new Error("clock-boom")) : tick === 2 ? 1_000 : 9e12,
    })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "u1", index: 0 })
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "k2", index: 0 })
    __setWall(() => 9e12)
    const out2 = { result: stopOut("bg-127b") }
    const r2 = await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u127b", task_id: "bg-127b" },
      async () => out2,
    )
    expect(r2, "the stop result is returned").toBe(out2)
    expect(taskToastsOf(env).length, "the later known-time refusal ends the window").toBe(0)
  } finally {
    __setWall(null)
  }
})

test("T128 a complete deduped against its step keeps the step's model in the status", async () => {
  __reset()
  const t0 = 1_700_000_000_000
  const env = make$()
  env.setNow(t0)
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "mX", turnId: "t128", index: 0 })
  env.setNow(t0 + 1000)
  await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t128", refusal: { category: "c", explanation: "x" } },
    async () => ({ text: "c" }),
  )
  const last = String(env.status[env.status.length - 1])
  expect(last, "the turn counts once").toContain("за сессию: 1")
  expect(last, "the step's model stays").toContain(" mX")
})

test("T129 a step without refusal between re-arms the turn's complete count", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t129", index: 0 })
  const ended = endTurnChunks()
  await runStep(env, ended.chunks, ended.result, { model: "m", turnId: "t129", index: 1 })
  await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t129", refusal: { category: "c", explanation: "x" } },
    async () => ({ text: "c" }),
  )
  expect(
    String(env.status[env.status.length - 1]),
    "the complete counts after a clean step",
  ).toContain("за сессию: 2")
})

test("T130 a complete of any reason drops its turn's dedup entry", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t130", index: 0 })
  expect(__dedupSize(), "the step marks its turn").toBe(1)
  await hooks.complete(env.$, { reason: "end_turn", turnId: "t130" }, async () => ({ ended: true }))
  expect(__dedupSize(), "a complete of any reason drops the entry").toBe(0)
})

test("T131 the same turn id under another agent is another turn", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", agentId: "X", turnId: "t", index: 0 })
  await hooks.complete(
    env.$,
    { reason: "refusal", agentId: "Y", turnId: "t", refusal: { category: "c", explanation: "x" } },
    async () => ({ text: "c" }),
  )
  expect(String(env.status[env.status.length - 1]), "another agent's turn counts").toContain(
    "за сессию: 2",
  )
})

test("T132 a turn's steps answering the clock out of order still dedup its complete", async () => {
  __reset()
  const answers = [3_600_000, 0, 0]
  const env = make$({ now: (tick: number) => answers[tick - 1] })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t132", index: 0 })
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t132", index: 1 })
  await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t132", refusal: { category: "c", explanation: "x" } },
    async () => ({ text: "c" }),
  )
  expect(
    String(env.status[env.status.length - 1]),
    "the turn counts its two steps together",
  ).toContain("за сессию: 2")
})

test("T133 tool names that are not strings still give the toast text", () => {
  __reset()
  const text = formatAlert({ via: "step", model: "m", tools: [Symbol("tool")] })
  expect(text, "the symbol tool is named").toContain("Symbol(tool)")
})

test("T134 journal fields are stored as text", async () => {
  __reset()
  const env = make$()
  const tool = { kind: "tool", index: 0, id: "tool-bash", name: "Bash" }
  const stop = { kind: "stop", stopReason: "refusal", usage: null }
  const result = {
    turnId: "t134",
    index: 0,
    answer: "",
    toolUses: [],
    stopReason: "refusal",
    usage: null,
  }
  await runStep(env, [tool, stop], result, {
    model: Symbol("m"),
    agentId: {
      toString() {
        throw new Error("x")
      },
    },
    turnId: "t134",
    index: 0,
  })
  const rec = env.journal()[0]
  expect(rec.model, "the model is stringified").toBe("Symbol(m)")
  expect(rec.agentId, "an unreadable agent is a question mark").toBe("?")
  expect(rec.turnId, "the turn id is kept").toBe("t134")
  expect(rec.step, "a numeric step is kept as a number").toBe(0)
  expect(rec.tools, "the tool names are strings").toEqual(["Bash"])
})

test("T135 a throwing refusal getter does not lose the turn's toast or result", async () => {
  __reset()
  const env = make$()
  const sentinel = { text: "shown" }
  const refusal: any = { category: "c" }
  Object.defineProperty(refusal, "explanation", {
    get() {
      throw new Error("expl-boom")
    },
  })
  const out = await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t135", refusal },
    async () => sentinel,
  )
  expect(out, "next's result is returned").toBe(sentinel)
  expect(env.toast.length, "the refusal still toasts").toBe(1)
  expect(
    env.log.some(
      (row: any) =>
        String(row[0]).includes("канал event не сработал") && String(row[0]).includes("explanation"),
    ),
    "the throwing field is named on the event channel",
  ).toBe(true)
})

test("T136 a throwing signal getter does not lose the step's accounting", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  const next = () => chunksOf(spec.chunks, spec.result)
  Object.defineProperty(next, "signal", {
    get() {
      throw new Error("sig-boom")
    },
  })
  await collect(hooks.step(env.$, { model: "m", turnId: "t136", index: 0 }, next as any))
  expect(env.status.length, "the status is set").toBe(1)
  expect(
    env.log.some(
      (row: any) => String(row[0]).includes("канал event") && String(row[0]).includes("signal"),
    ),
    "the signal read is named on the event channel",
  ).toBe(true)
})

test("T137 a TaskStop result with a throwing field is returned as is", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t137", index: 0 })
  const out: any = { result: stopOut("bg-137") }
  Object.defineProperty(out, "isError", {
    get() {
      throw new Error("isError-boom")
    },
  })
  const r = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "u137", task_id: "bg-137" },
    async () => out,
  )
  expect(r, "the result is returned as is").toBe(out)
  expect(taskToastsOf(env).length, "a throwing result field is not a success").toBe(0)
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал result")),
    "the result channel names the failure",
  ).toBe(true)
})

test("T138 a chunk with a throwing field passes through unchanged", async () => {
  __reset()
  const env = make$()
  const tricky: any = { stopReason: "end_turn" }
  Object.defineProperty(tricky, "kind", {
    get() {
      throw new Error("kind-boom")
    },
  })
  const stop = { kind: "stop", stopReason: "refusal", usage: null }
  const result = { stopReason: "refusal" }
  const out = await runStep(env, [tricky, stop], result, { model: "m", turnId: "t138", index: 0 })
  expect(out.chunks.length, "both chunks are yielded").toBe(2)
  expect(out.chunks[0], "the tricky chunk is the same object").toBe(tricky)
  expect(out.chunks[1], "the stop chunk is the same object").toBe(stop)
  expect(env.toast.length, "the later refusal still toasts").toBe(1)
  expect(
    env.log.some(
      (row: any) => String(row[0]).includes("канал event") && String(row[0]).includes("kind"),
    ),
    "the chunk field is named on the event channel",
  ).toBe(true)
})

test("T139 a context result with a throwing blocks field is returned as is", async () => {
  __reset()
  const env = make$()
  const out: any = {}
  Object.defineProperty(out, "blocks", {
    get() {
      throw new Error("blocks-boom")
    },
  })
  const r = await hooks.context(env.$, { blocks: [] }, async () => out)
  expect(r, "the context result is returned as is").toBe(out)
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал context")),
    "the context channel names the failure",
  ).toBe(true)
})

test("T140 the signal listener read twice does not break the bounded wait", async () => {
  let reads = 0
  const sig: any = { aborted: false }
  Object.defineProperty(sig, "addEventListener", {
    get() {
      reads += 1
      if (reads === 1) return () => {}
      throw new Error("listener-boom")
    },
  })
  const v = await __bounded(Promise.resolve(42), sig, () => 7)
  expect(v, "the promise value wins").toBe(42)
})

test("T141 an infinite local time is reported on the clock channel", async () => {
  __reset()
  __setWall(() => Infinity)
  try {
    const env = make$()
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t141", index: 0 })
    expect(
      env.log.some(
        (row: any) =>
          String(row[0]).includes("канал clock не сработал") && String(row[0]).includes("Infinity"),
      ),
      "Infinity is named on the clock channel",
    ).toBe(true)
  } finally {
    __setWall(null)
  }
})

test("T142 a turn id whose text throws still gives the transcript line", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, {
    model: "m",
    turnId: {
      toString() {
        throw new Error("t")
      },
    },
    index: 0,
  })
  expect(
    env.log.some((row: any) => String(row[0]).includes("[turn ?, step 0]")),
    "the transcript line names the unreadable turn",
  ).toBe(true)
})

test("T143 reset clears the fault seam", async () => {
  __reset()
  ;(reg as any).__setFault(() => {
    throw new Error("f")
  })
  __reset()
  try {
    const env = make$()
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t143", index: 0 })
    expect(env.toast.length, "the toast lands").toBe(1)
    expect(env.status.length, "the status lands").toBe(1)
  } finally {
    ;(reg as any).__setFault(null)
  }
})

test("T144 the fault seam does not fire without an opening mark", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t144", index: 0 })
  ;(reg as any).__setFault(() => {
    throw new Error("f")
  })
  try {
    const out = { result: stopOut("bg-144") }
    const r = await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u144", task_id: "bg-144" },
      async () => out,
    )
    expect(r, "the stop result is returned").toBe(out)
    expect(taskToastsOf(env).length, "the taskstop toast lands").toBe(1)
  } finally {
    ;(reg as any).__setFault(null)
  }
})

test("T145 a broken wall and a failing clock name the local time once", async () => {
  __reset()
  __setWall(() => Infinity)
  try {
    const env = make$({ clockReject: true })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t145", index: 0 })
    const clockLines = env.log.filter((row: any) =>
      String(row[0]).includes("канал clock не сработал"),
    )
    expect(clockLines.length, "exactly two clock lines").toBe(2)
    expect(
      clockLines.filter((r: any) => String(r[0]).includes("Infinity")).length,
      "one names Infinity",
    ).toBe(1)
    expect(
      clockLines.filter((r: any) => String(r[0]).includes("clock-boom")).length,
      "one names the clock failure",
    ).toBe(1)
  } finally {
    __setWall(null)
  }
})

test("T146 a complete deduped before its step's clock answers still shows the stop in the count", async () => {
  __reset()
  const d = deferred<number>()
  const env = make$({ now: (tick: number) => (tick === 1 ? d.promise : 5_000) })
  const spec = refusalChunks()
  let stepDone = false
  const s = runStep(env, spec.chunks, spec.result, {
    model: "m146",
    turnId: "t146",
    agentId: "a146",
    index: 0,
  }).then(() => {
    stepDone = true
  })
  expect(await until(() => env.toast.length === 1), "the step's stop toasts").toBe(true)
  await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t146", agentId: "a146", refusal: { category: "c", explanation: "x" } },
    async () => ({ text: "c" }),
  )
  expect(String(env.status[env.status.length - 1]), "the deduped complete shows the step's stop").toContain(
    "за сессию: 1",
  )
  expect(stepDone, "the step still waits for its clock").toBe(false)
  d.resolve(4_000)
  await s
  expect(String(env.status[env.status.length - 1]), "the step's answer keeps the count at one").toContain(
    "за сессию: 1",
  )
})

test("T147 a refusal at time zero or before is a known time and closes its window", async () => {
  __reset()
  __setWall(() => 0)
  try {
    const env = make$({ now: () => 0 })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m147", turnId: "t147a", index: 0 })
    const hhmmOf = (n: number) =>
      String(new Date(n).getHours()).padStart(2, "0") + ":" + String(new Date(n).getMinutes()).padStart(2, "0")
    const last = String(env.status[env.status.length - 1])
    expect(last, "the zero time is a known time").toContain("последний " + hhmmOf(0))
    expect(last, "the zero time is not unknown").not.toContain("--:--")
    __setWall(() => 1_799_999)
    await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u147a", task_id: "bg-147a" },
      async () => ({ result: stopOut("bg-147a") }),
    )
    expect(taskToastsOf(env).length, "inside the window").toBe(1)
    __setWall(() => 1_800_000)
    env.setNow(1_800_000)
    await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u147b", task_id: "bg-147b" },
      async () => ({ result: stopOut("bg-147b") }),
    )
    expect(taskToastsOf(env).length, "the window of a zero time ends at 30 minutes").toBe(1)
  } finally {
    __setWall(null)
  }

  __reset()
  __setWall(() => -5_000)
  try {
    const env = make$({ now: () => -5_000 })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m147", turnId: "t147b", index: 0 })
    __setWall(() => 1_794_999)
    await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u147c", task_id: "bg-147c" },
      async () => ({ result: stopOut("bg-147c") }),
    )
    expect(taskToastsOf(env).length, "inside the negative-time window").toBe(1)
    __setWall(() => 1_795_000)
    env.setNow(1_795_000)
    await hooks.taskstop(
      env.$,
      { tool: "TaskStop", tool_use_id: "u147d", task_id: "bg-147d" },
      async () => ({ result: stopOut("bg-147d") }),
    )
    expect(taskToastsOf(env).length, "the window of a negative time ends at 30 minutes").toBe(1)
  } finally {
    __setWall(null)
  }
})

test("T148 a step that throws keeps its turn's dedup entry", async () => {
  __reset()
  const env = make$({ now: () => 5_000 })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m148", turnId: "t148", agentId: "a148", index: 0 })
  expect(__dedupSize()).toBe(1)
  async function* boom() {
    yield { kind: "text", index: 0, text: "x" }
    throw new Error("step-boom")
  }
  const threw = await collect(
    hooks.step(env.$, { model: "m148", turnId: "t148", agentId: "a148", index: 1 }, () => boom()),
  ).then(
    () => false,
    () => true,
  )
  expect(threw, "the step threw").toBe(true)
  expect(__dedupSize(), "a thrown step does not drop the turn's entry").toBe(1)
  await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t148", agentId: "a148", refusal: { category: "c", explanation: "x" } },
    async () => ({}),
  )
  expect(String(env.status[env.status.length - 1]), "the turn counts once").toContain("за сессию: 1")
  expect(__dedupSize()).toBe(0)
})

test("T149 with the clock and the local time both failing the record time is null", async () => {
  __reset()
  __setWall(() => Number.NaN)
  try {
    const env = make$({ clockReject: true })
    const spec = refusalChunks()
    await runStep(env, spec.chunks, spec.result, { model: "m149", turnId: "t149", index: 0 })
    expect(env.journal().length).toBe(1)
    expect(env.journal()[0].t, "an unknown time is stored as null").toBe(null)
  } finally {
    __setWall(null)
  }
})

test("T150 a step without turnId leaves no dedup entry and its complete counts", async () => {
  __reset()
  const env = make$({ now: () => 5_000 })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m150", agentId: "a150", index: 0 })
  expect(__dedupSize()).toBe(0)
  await hooks.complete(
    env.$,
    { reason: "refusal", agentId: "a150", refusal: { category: "c", explanation: "x" } },
    async () => ({}),
  )
  expect(String(env.status[env.status.length - 1]), "the complete counts on its own").toContain("за сессию: 2")
})

test("T151 a non-finite step index is stored as text", async () => {
  __reset()
  const env = make$({ now: () => 5_000 })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m151", turnId: "t151", index: Number.NaN })
  expect(env.journal()[0].step, "NaN is stored as text").toBe("NaN")
})

test("T152 a turn's end drops its agent from the dedup map when no turns are left", async () => {
  __reset()
  const env = make$({ now: () => 5_000 })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m152", turnId: "t152", agentId: "a152", index: 0 })
  expect(__dedupAgents()).toBe(1)
  await hooks.complete(env.$, { reason: "end_turn", turnId: "t152", agentId: "a152" }, async () => ({}))
  expect(__dedupSize()).toBe(0)
  expect(__dedupAgents(), "an empty set is not kept").toBe(0)
})

test("T153 an unreadable reason keeps the turn's dedup entry", async () => {
  __reset()
  const env = make$({ now: () => 5_000 })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m153", turnId: "t153", agentId: "a153", index: 0 })
  const e: any = { turnId: "t153", agentId: "a153" }
  Object.defineProperty(e, "reason", {
    get() {
      throw new Error("reason-boom")
    },
  })
  await hooks.complete(env.$, e, async () => ({}))
  expect(__dedupSize(), "an unreadable reason does not drop the entry").toBe(1)
  expect(env.toast.length).toBe(1)
  expect(
    env.log.some(
      (row: any) =>
        String(row[0]).includes("канал event не сработал") && String(row[0]).includes("reason"),
    ),
    "the unreadable reason is named on the event channel",
  ).toBe(true)
  await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t153", agentId: "a153", refusal: { category: "c", explanation: "x" } },
    async () => ({}),
  )
  expect(String(env.status[env.status.length - 1]), "the turn counts once").toContain("за сессию: 1")
  expect(__dedupSize()).toBe(0)
})

test("T154 an unreadable abort flag is named in the write-wait line", async () => {
  __reset()
  const sig: any = { addEventListener() {}, removeEventListener() {} }
  Object.defineProperty(sig, "aborted", {
    get() {
      throw new Error("aborted-boom")
    },
  })
  const env = make$({
    now: () => 5_000,
    sleep: async () => {
      throw new Error("sleep-boom")
    },
    storeSet: () => new Promise<void>(() => {}),
  })
  const spec = refusalChunks()
  const next: any = () => chunksOf(spec.chunks, spec.result)
  next.signal = sig
  await collect(hooks.step(env.$, { model: "m154", turnId: "t154", index: 0 }, next))
  expect(
    env.log.some(
      (row: any) =>
        String(row[0]).includes("канал clock не сработал") && String(row[0]).includes("sleep-boom"),
    ),
    "the sleep failure is named on the clock channel",
  ).toBe(true)
  expect(
    env.log.some((row: any) =>
      String(row[0]).includes(
        "ожидание записи снято отменой или отказом часов (сигнал нечитаем); запись не подтверждена",
      ),
    ),
    "the unreadable abort flag is named in the write-wait line",
  ).toBe(true)
})

test("T155 an unreadable agentId on a turn's end keeps the main turn's entry", async () => {
  __reset()
  const env = make$({ now: () => 5_000 })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m155", turnId: "t155", index: 0 })
  expect(__dedupSize()).toBe(1)
  const e: any = { reason: "end_turn", turnId: "t155" }
  Object.defineProperty(e, "agentId", {
    get() {
      throw new Error("agentId-boom")
    },
  })
  await hooks.complete(env.$, e, async () => ({}))
  expect(__dedupSize(), "an unreadable agentId on the end does not drop the entry").toBe(1)
  await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t155", refusal: { category: "c", explanation: "x" } },
    async () => ({}),
  )
  expect(String(env.status[env.status.length - 1]), "the turn counts once").toContain("за сессию: 1")
  expect(__dedupSize()).toBe(0)
})

test("T156 a returned step with an unreadable agentId keeps the main turn's entry", async () => {
  __reset()
  const env = make$({ now: () => 5_000 })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m156", turnId: "t156", index: 0 })
  expect(__dedupSize()).toBe(1)
  const ok = endTurnChunks()
  const e: any = { model: "m156", turnId: "t156", index: 1 }
  Object.defineProperty(e, "agentId", {
    get() {
      throw new Error("agentId-boom")
    },
  })
  await collect(hooks.step(env.$, e, () => chunksOf(ok.chunks, ok.result)))
  expect(__dedupSize(), "a returned step with an unreadable agentId does not drop the entry").toBe(1)
  await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t156", refusal: { category: "c", explanation: "x" } },
    async () => ({}),
  )
  expect(String(env.status[env.status.length - 1]), "the turn counts once").toContain("за сессию: 1")
})

test("T157 a refusal step with an unreadable agentId sets no entry and its complete counts apart", async () => {
  __reset()
  const env = make$({ now: () => 5_000 })
  const spec = refusalChunks()
  const e: any = { model: "m157", turnId: "t157", index: 0 }
  Object.defineProperty(e, "agentId", {
    get() {
      throw new Error("agentId-boom")
    },
  })
  await collect(hooks.step(env.$, e, () => chunksOf(spec.chunks, spec.result)))
  expect(__dedupSize(), "no entry from an unreadable key").toBe(0)
  expect(String(env.status[env.status.length - 1])).toContain("за сессию: 1")
  await hooks.complete(
    env.$,
    { reason: "refusal", turnId: "t157", refusal: { category: "c", explanation: "x" } },
    async () => ({}),
  )
  expect(String(env.status[env.status.length - 1]), "an undeduplicable refusal counts apart").toContain("за сессию: 2")
})

test("T158 a refusal end with an unreadable agentId counts apart and keeps the entry", async () => {
  __reset()
  const env = make$({ now: () => 5_000 })
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m158", turnId: "t158", index: 0 })
  expect(__dedupSize()).toBe(1)
  const e: any = { reason: "refusal", turnId: "t158", refusal: { category: "c", explanation: "x" } }
  Object.defineProperty(e, "agentId", {
    get() {
      throw new Error("agentId-boom")
    },
  })
  await hooks.complete(env.$, e, async () => ({}))
  expect(String(env.status[env.status.length - 1]), "an unreadable key does not deduplicate").toContain("за сессию: 2")
  expect(__dedupSize(), "the entry is not taken").toBe(1)
})

test("T159 an aborted signal with an unreadable reason keeps AbortError off the clock channel", async () => {
  __reset()
  const sig: any = { aborted: true, addEventListener() {}, removeEventListener() {} }
  Object.defineProperty(sig, "reason", {
    get() {
      throw new Error("reason-boom")
    },
  })
  const env = make$({
    now: () => 5_000,
    sleep: async () => {
      const err = new Error("abort-x")
      ;(err as any).name = "AbortError"
      throw err
    },
    storeSet: () => new Promise<void>(() => {}),
  })
  const spec = refusalChunks()
  const next: any = () => chunksOf(spec.chunks, spec.result)
  next.signal = sig
  await collect(hooks.step(env.$, { model: "m159", turnId: "t159", index: 0 }, next))
  await new Promise((r) => setTimeout(r, 0))
  expect(
    env.log.some((row: any) =>
      String(row[0]).includes("ожидание записи снято отменой диспатча; запись не подтверждена"),
    ),
    "the cancel path ran",
  ).toBe(true)
  expect(
    env.log.some(
      (row: any) => String(row[0]).includes("канал clock не сработал") && String(row[0]).includes("abort-x"),
    ),
    "AbortError of the cancel stays silent",
  ).toBe(false)
})

test("T160 an aborted signal with an unreadable reason and an undefined rejection is a clock failure", async () => {
  __reset()
  const sig: any = { aborted: true, addEventListener() {}, removeEventListener() {} }
  Object.defineProperty(sig, "reason", {
    get() {
      throw new Error("reason-boom")
    },
  })
  const env = make$({
    now: () => 5_000,
    sleep: async () => {
      throw undefined
    },
    storeSet: () => new Promise<void>(() => {}),
  })
  const spec = refusalChunks()
  const next: any = () => chunksOf(spec.chunks, spec.result)
  next.signal = sig
  await collect(hooks.step(env.$, { model: "m160", turnId: "t160", index: 0 }, next))
  await new Promise((r) => setTimeout(r, 0))
  expect(
    env.log.some((row: any) =>
      String(row[0]).includes("ожидание записи снято отменой диспатча; запись не подтверждена"),
    ),
    "the cancel path ran",
  ).toBe(true)
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал clock не сработал")),
    "an undefined rejection with an unreadable reason is a clock failure",
  ).toBe(true)
})

test("T161 a throwing name getter on a non-reason rejection is a clock failure", async () => {
  __reset()
  const sig: any = { aborted: true, reason: new Error("the-reason"), addEventListener() {}, removeEventListener() {} }
  const env = make$({
    now: () => 5_000,
    sleep: async () => {
      const o: any = {}
      Object.defineProperty(o, "name", { get() { throw new Error("name-boom") } })
      throw o
    },
    storeSet: () => new Promise<void>(() => {}),
  })
  const spec = refusalChunks()
  const next: any = () => chunksOf(spec.chunks, spec.result)
  next.signal = sig
  await collect(hooks.step(env.$, { model: "m161", turnId: "t161", index: 0 }, next))
  await new Promise((r) => setTimeout(r, 0))
  expect(
    env.log.some((row: any) =>
      String(row[0]).includes("ожидание записи снято отменой диспатча; запись не подтверждена"),
    ),
    "the cancel path ran",
  ).toBe(true)
  expect(
    env.log.some((row: any) => String(row[0]).includes("канал clock не сработал")),
    "a throwing name getter does not hide a clock failure",
  ).toBe(true)
})
