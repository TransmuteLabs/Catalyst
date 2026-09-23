import { test, expect } from "claude-code/testing"
import { register, RULE_TEXT, __reset, __dedupSize } from "../hooks/register.ts"

// CONSTRAINT: модуль не экспортирует обработчики — единственный путь позвать
// их с подставным $ — исполнить register с фейковым `on` и перехватить.
function capture(): {
  step: any
  complete: any
  taskstop: any
  taskstopMatcher: any
  context: any
  sessionStart: any
} {
  const got: any = {}
  register(((event: string, a: any, b?: any) => {
    if (event === "tool.call") {
      got.taskstopMatcher = a
      got.taskstop = b
    } else if (event === "turn.step") got.step = a
    else if (event === "turn.complete") got.complete = a
    else if (event === "prompt.context") got.context = a
    else if (event === "session.start") got.sessionStart = a
  }) as any)
  return got
}

const hooks = capture()

function make$(o?: {
  toastThrows?: boolean
  now?: (tick: number) => number | undefined
  clockReject?: boolean
}) {
  const toast: any[] = []
  const status: any[] = []
  const log: any[] = []
  const storeSets: any[] = []
  let storeLog: any[] = []
  let tick = 0
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
        return key === "log" ? storeLog : undefined
      },
      async set(key: string, value: any) {
        storeSets.push([key, value])
        if (key === "log") storeLog = value
      },
    },
    clock: {
      async now() {
        tick += 1
        if (o?.clockReject) throw new Error("clock-boom")
        if (fixedNow !== undefined) return fixedNow
        return o?.now ? o.now(tick) : 1_700_000_000_000
      },
    },
  }
  return {
    $,
    toast,
    status,
    log,
    storeSets,
    store: () => storeLog,
    setNow(ms: number) {
      fixedNow = ms
    },
  }
}

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
  const recs = env.store()
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
  expect(env.storeSets.length, "end_turn does not write the store").toBe(0)
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
  const rec = env.store()[0]
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
  expect(env.storeSets.length, "an answer does not write the store").toBe(0)
})

test("T6 TaskStop inside the window names the task", async () => {
  __reset()
  expect(hooks.taskstopMatcher, "TaskStop is the matched tool").toEqual({ tool: "TaskStop" })
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "opus-test", turnId: "turn-6", index: 0 })
  const before = env.status.length
  const sentinel = { message: "stopped", task_id: "bg-7", task_type: "bash" }
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
  const sentinel = { message: "stopped", task_id: "bg-1", task_type: "bash" }
  const out = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "use-7", task_id: "bg-1" },
    async () => sentinel,
  )
  expect(out, "next's result is the same object").toBe(sentinel)
  expect(env.toast.length, "no alert without a prior stop").toBe(0)
  expect(env.status.length, "no status without a prior stop").toBe(0)
  expect(env.log.length, "no log without a prior stop").toBe(0)
  expect(env.storeSets.length, "no store write without a prior stop").toBe(0)
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
  const log = env.store()
  expect(log, "store keeps the last 100").toHaveLength(100)
  expect(log[0].turnId, "the oldest kept record is the second by time").toBe("turn-1")
  expect(log[0].t, "the oldest kept record carries the second timestamp").toBe(start + 2000)
  expect(log[99].turnId, "the newest record is the 101st stop").toBe("turn-100")
})

test("T12 log line omits absent turn/step instead of printing undefined", async () => {
  __reset()
  const env = make$()
  await hooks.complete(env.$, { reason: "refusal", turnId: "turn-12", refusal: { category: "cyber", explanation: "x" } }, async () => ({ ok: 1 }))
  await hooks.taskstop(env.$, { tool: "TaskStop", task_id: "bg-12" }, async () => ({ ok: 2 }))
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
  const sentIn = { result: { ok: true } }
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
  const sentEdge = { result: { ok: true } }
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

test("T17 dedup does not merge a gap, another turn, or a clock step back", async () => {
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
  const gap = make$()
  gap.setNow(t0)
  await runStep(gap, spec.chunks, spec.result, { model: "m", turnId: "same", index: 0 })
  gap.setNow(t0 + 60_001)
  await hooks.complete(gap.$, completeOf("same"), async () => ({ text: "c" }))
  expect(gap.status[gap.status.length - 1], "60001ms gap counts again").toContain(
    "обрывов фильтром за сессию: 2",
  )

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
  expect(back.status[back.status.length - 1], "a clock step backward counts").toContain(
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

  const ok = { result: { task_id: "bg-19", message: "stopped" } }
  const outOk = await hooks.taskstop(
    env.$,
    { tool: "TaskStop", tool_use_id: "use-ok", task_id: "bg-19", agentId: "sub-9" },
    async () => ok,
  )
  expect(outOk, "success result is returned").toBe(ok)
  expect(taskToasts().length, "a successful stop toasts once").toBe(1)
  expect(taskToasts()[0][0], "toast names the task").toContain("bg-19")
  expect(taskToasts()[0][0], "toast names the agent").toContain("остановил агент sub-9")
  const recs = env.store().filter((r: any) => r.via === "taskstop")
  expect(recs.length, "one taskstop record").toBe(1)
  expect(recs[0].agentId, "store record keeps the agent").toBe("sub-9")
})

test("T20 parallel stops keep both store records", async () => {
  __reset()
  let reads = 0
  let settled = false
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = () => {
      if (settled) return
      settled = true
      resolve()
    }
    setTimeout(release, 50)
  })
  const env = make$()
  const origGet = env.$.store.get.bind(env.$.store)
  env.$.store.get = async (key: string) => {
    if (key !== "log") return origGet(key)
    const snapshot = await origGet(key)
    reads += 1
    if (reads >= 2) release()
    else await gate
    return snapshot
  }
  const spec = refusalChunks()
  await Promise.all([
    runStep(env, spec.chunks, spec.result, { model: "m1", turnId: "p-1", index: 0 }),
    runStep(env, spec.chunks, spec.result, { model: "m2", turnId: "p-2", index: 1 }),
  ])
  expect(env.store().length, "both parallel records are kept").toBe(2)
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
  const sent = { result: { ok: true } }
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

test("T27 dedup map drops turn ids older than the window", async () => {
  __reset()
  const start = 8_000_000_000_000
  const env = make$({ now: (tick: number) => start + (tick - 1) * 60_001 })
  const spec = refusalChunks()
  for (let i = 0; i < 1000; i++) {
    await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "t-" + i, index: i })
  }
  expect(__dedupSize(), "stale turn ids are dropped").toBeLessThanOrEqual(1)
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

test("T29 session.start resets the session count and returns next", async () => {
  __reset()
  const env = make$()
  const spec = refusalChunks()
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "s1", index: 0 })
  expect(env.status[env.status.length - 1], "the first stop counts as one").toContain(
    "обрывов фильтром за сессию: 1",
  )
  const sentinel = { started: true }
  const out = await hooks.sessionStart(env.$, {}, async () => sentinel)
  expect(out, "session.start returns next's result").toBe(sentinel)
  await runStep(env, spec.chunks, spec.result, { model: "m", turnId: "s2", index: 1 })
  expect(env.status[env.status.length - 1], "the count starts over").toContain(
    "обрывов фильтром за сессию: 1",
  )
})
