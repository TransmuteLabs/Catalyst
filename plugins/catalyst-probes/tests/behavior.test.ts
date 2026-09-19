// Behavior teeth for plugins/catalyst-probes on the official harness
// (`claude plugin test`): each of the mod's nine subscribed events is driven
// through the engine's `$`, and the assertions check both what the handler
// answered and which `$` calls it made (fs.write paths, store, model.complete).
//
// CONSTRAINT: the mod memoises its world for 5000 ms of clock time (worldFor),
// and the runner keeps one process per file, so every world-reading test here
// starts its clock 6000 ms past the previous one — otherwise a test would read
// the world its neighbour loaded.
import { describe, expect, mock, test } from "claude-code/testing"
import type { MockClock } from "claude-code/testing"
import type { Args, On } from "claude-code"

// CONSTRAINT: версия берётся импортом, а не литералом: дом версии — register.ts
// и .claude-plugin/plugin.json, их сверяет tests/scripts/test-mod-units.sh.
import { MOD_VERSION, FAILOVER_FOLD_PERIOD_MS, failoverBindSet, failoverFoldReset, register, sessionExecutorsReset, verdictKey } from "../hooks/register.ts"

const HOME = "/probes-home"
const SID = "sid-behavior-1"
const CWD_KEY = "catalyst-probes:cwd"

// CONSTRAINT: the test's `$` carries only the engine's own nouns (EventCalls);
// op nouns like store exist on the MOD's `$` alone, so the store is answered
// by hand here — which is also what makes every set and delete observable.
type StoreView = {
  keys: () => string[]
  sets: { key: string; value: unknown }[]
  deletes: string[]
}

function storeOf(on: On, entries: Record<string, unknown>): StoreView {
  const store = new Map<string, unknown>(Object.entries(entries))
  const view: StoreView = { keys: () => [...store.keys()], sets: [], deletes: [] }

  on("store.get", (_$, e) => ({ value: store.get(e.key) }))
  on("store.set", (_$, e) => {
    store.set(e.key, e.value)
    view.sets.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  on("store.delete", (_$, e) => {
    store.delete(e.key)
    view.deletes.push(e.key)
    return { value: undefined }
  })
  on("store.keys", () => ({ value: [...store.keys()] }))

  return view
}

type Kept = {
  writes: Args<"fs.write">[]
  reads: string[]
  completes: Args<"model.complete">[]
  toasts: string[]
  store: StoreView
  // CONSTRAINT: часы стенда движутся ТОЛЬКО рукой теста, и ожидание ступени
  // держится, пока тест их не двинет. Зубу про предел ступени нужен этот рычаг;
  // ветка clockBreak часов не заводит вовсе, поэтому поле пустует.
  clock: MockClock | null
}

// CONSTRAINT: улика пишется ДВАЖДЫ -- предварительно, до лестницы (поле
// `inflight`), и начисто после вердикта. На реальной ФС второй write
// ПЕРЕЗАПИСЫВАЕТ файл, здесь же копятся события, поэтому предметом проверки
// служит ПОСЛЕДНЯЯ запись пути: первая описывает суд, который ещё идёт.
// Предварительная запись существует затем, чтобы зависший суд оставлял след --
// до неё вис не был виден ничем (инцидент 2026-09-16: час ожидания, ноль
// записей в своём окне).
const RECORD_RE = /\/judge\/records\/mod-[\w.-]+\.json$/

function lastRecord(kept: Kept): Args<"fs.write"> | undefined {
  const all = kept.writes.filter(w => RECORD_RE.test(w.path))
  return all.length ? all[all.length - 1] : undefined
}

// Последняя запись КАЖДОГО пути: столько улик, сколько судов, независимо от
// числа промежуточных записей.
function finalRecords(kept: Kept): any[] {
  const byPath = new Map<string, any>()
  for (const w of kept.writes) {
    if (RECORD_RE.test(w.path)) byPath.set(w.path, JSON.parse(String(w.text)))
  }
  return Array.from(byPath.values())
}

// Wires everything the mod touches beneath it: the clock, the env, the store
// and a scripted fs whose every read is seen. A path not in `files` answers
// ENOENT; a model.complete beyond `answers` refuses, so a surprise consult is
// loud rather than green.
// The per-test knobs a session-boundary tooth needs: a sid the test turns
// over mid-file, a clock outage the test heals, and a hook that runs strictly
// inside the model call the consult is parked on.
type WiredOpts = {
  sidOf?: () => string
  clockBreak?: () => boolean
  onComplete?: () => Promise<void> | void
}

function wired(
  on: On,
  now: number,
  env: Record<string, string>,
  files: Record<string, string>,
  stored: Record<string, unknown> = {},
  // CONSTRAINT: ответ ступени -- не только строка. Образ с шагом detail:true
  // отдаёт конверт {text, stopReason, usage}, и ровно в нём живёт причина
  // обрыва: зуб на потолок токенов недостижим типом string.
  answers: (string | Record<string, unknown>)[] = [],
  opts: WiredOpts = {},
): Kept {
  // The harness refuses a second on("clock.now"), so an outage tooth takes
  // over the clock entirely: the mod reads $.clock.now() and nothing else.
  failoverFoldReset()
  let clock: MockClock | null = null
  if (opts.clockBreak) {
    on("clock.now", () => (opts.clockBreak && opts.clockBreak()
      ? { deny: "clock.now: scripted outage" }
      : { value: now }))
  } else {
    clock = mock.clock(on, { now })
  }
  mock.env(on, { CLAUDE_PROBES_DIR: HOME, PWD: "/work", ...env })
  const store = storeOf(on, stored)

  const kept: Kept = { writes: [], reads: [], completes: [], toasts: [], store, clock }

  on("fs.read", (_$, e) => {
    kept.reads.push(e.path)
    const text = files[e.path]
    if (text === undefined) throw new Error("ENOENT: no such file " + e.path)
    return { value: text }
  })

  on("fs.write", (_$, e) => {
    kept.writes.push(e)
    return { value: undefined }
  })

  on("model.complete", async (_$, e) => {
    kept.completes.push(e)
    if (opts.onComplete) await opts.onComplete()
    const answer = answers.shift()
    if (answer === undefined) {
      throw new Error("model.complete: no answer scripted for " + e.model)
    }
    return { value: answer }
  })

  on("session.id", () => ({ value: opts.sidOf ? opts.sidOf() : SID }))
  on("session.messages", () => ({ value: [] }))
  on("agent.list", () => ({ value: [] }))
  on("ui.toast", (_$, e) => {
    kept.toasts.push(e.text)
    return { value: undefined }
  })

  return kept
}

describe("session.start", () => {
  test("keeps the cwd and leaves the verdict store alone — the sweep rides the first consult", async ($, on) => {
    const kept = wired(on, 1_000_000, {}, {}, {
      "v:judge:stale": { kind: "BLOCK", t: 800_000, rest: "past the default ttl" },
      "v:judge:no-t": { kind: "BLOCK", rest: "pre-boundary form" },
      "v:judge:fresh": { kind: "BLOCK", t: 999_000, rest: "young" },
      "v:other:x": { kind: "BLOCK", t: 800_000, rest: "not ours" },
    })
    on("session.start", (_$, e) => ({ cwd: e.cwd }))

    const started = await $.session.start({
      cwd: "/work",
      surface: "terminal",
      isInteractive: true,
    })

    expect(started).toEqual({ cwd: "/work" })
    expect(
      kept.store.sets.find(s => s.key === CWD_KEY)?.value,
      "the cwd the session started in is kept for later worlds",
    ).toBe("/work")

    expect(kept.store.deletes, "the start no longer sweeps the verdict store").toEqual([])
    const keys = kept.store.keys()
    expect(keys, "past ttl and formless keys are still in place at the start").toContain("v:judge:stale")
    expect(keys).toContain("v:judge:no-t")
    expect(keys, "a live verdict stays untouched").toContain("v:judge:fresh")
    expect(keys, "a foreign key is never touched").toContain("v:other:x")
    expect(
      kept.writes.find(w =>
        w.path.startsWith(HOME + "/judge/journal.jsonl.shard.") &&
        w.text.includes('"outcome":"store_sweep"'),
      ),
      "no sweep note is written at the start",
    ).toBeUndefined()
  })
})

describe("tool.call", () => {
  test("an armed judge consults the first rung and cancels the dispatch on BLOCK", async ($, on) => {
    const kept = wired(
      on,
      1_000_000,
      { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" },
      {
        [HOME + "/probes.toml"]: '[probe.judge]\nmodels = ["m1", "m2"]\n',
        [HOME + "/judge/prompt.md"]: "JUDGE PROMPT",
      },
      {},
      ["BLOCK: no subject"],
    )
    on("tool.call", () => ({ result: "ran anyway" }))

    const prompt = "[dispatch-class:exec-0p] make tea"
    const res = await $.tool.call({
      tool: "Agent",
      description: "brew",
      prompt,
      subagent_type: "scout",
    })

    expect(res).toEqual({
      deny:
        "Subagent dispatch cancelled by the dispatch judge (this is NOT the " +
        "routing-table.toml gate). Reason: no subject",
    })

    // the ladder stopped at the first rung that answered with a verdict
    expect(kept.completes).toHaveLength(1)
    expect(kept.completes[0]).toMatchObject({ model: "m1", detail: true })
    expect(kept.completes[0].prompt).toContain("=== DISPATCH ===")
    expect(kept.completes[0].prompt).toContain(prompt)

    // the verdict was cached for the repeat storm, under the session's key
    const memo = kept.store.sets.find(
      s => s.key === verdictKey("judge", SID, "Agent", "scout", prompt),
    )
    expect(memo?.value).toMatchObject({ kind: "BLOCK", rest: "no subject", used: "m1" })

    // the consult left its record and its journal line (the sweep's shard
    // line now comes first in the same journal, so match by outcome)
    const record = lastRecord(kept)
    expect(record?.text).toContain('"kind":"BLOCK"')
    expect(record?.text).toContain('"carrier":"mod"')
    expect(record?.text).toContain('"mod":"' + MOD_VERSION + '"')
    const journal = kept.writes.find(w =>
      w.path.startsWith(HOME + "/judge/journal.jsonl.shard.") &&
      w.text.includes('"outcome":"block"'),
    )
    expect(journal?.text).toContain('"outcome":"block"')
  })
})

// Инцидент 2026-09-16: диспатч не стартовал ЧАС при живом прокси и рабочих
// ступенях. Переход по лестнице делался только через catch, а вызов, который
// не вернулся и не бросил, не давал ни того, ни другого.
describe("dispatch judge: a rung that never answers", () => {
  const TOML = '[probe.judge]\nmodels = ["m1", "m2"]\ntimeout_ms = 5000\n'
  const FILES = {
    [HOME + "/probes.toml"]: TOML,
    [HOME + "/judge/prompt.md"]: "JUDGE PROMPT",
  }
  const DISPATCH = "[dispatch-class:exec-0p] make tea"
  const callIt = ($: any) => $.tool.call({
    tool: "Agent",
    description: "brew",
    prompt: DISPATCH,
    subagent_type: "scout",
  })
  // Висящая ступень -- промис, который не разрешится ничем. Предел наступает
  // не по реальному времени, а рукой теста: часы стенда держат ожидание, пока
  // тест их не двинет, поэтому зуб не тратит ни секунды простоя.
  const neverAnswers = () => new Promise<void>(() => {})
  const RUNG_TMO = 5000

  test("a silent rung does not stop the ladder: the next rung's verdict stands", async ($, on) => {
    let call = 0
    const kept = wired(
      on, 1_006_000, { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" }, FILES, {},
      ["OK: closed brief"],
      { onComplete: async () => { call++; if (call === 1) await neverAnswers() } },
    )
    on("tool.call", () => ({ result: "ran" }))

    const running = callIt($)
    await kept.clock!.settle()
    await kept.clock!.advance(RUNG_TMO)
    const res = await running

    expect(res, "the dispatch runs on the second rung's OK").toEqual({ result: "ran" })
    const rec = JSON.parse(String(lastRecord(kept)?.text))
    expect(rec.kind, "the verdict came from the rung that answered").toBe("OK")
    expect(rec.used, "the ladder moved on").toBe("m2")
    expect(
      rec.rungTimeouts,
      "the silent rung is counted as a timeout, not as a provider refusal",
    ).toBe(1)
  })

  test("no rung answers in time: the dispatch is LET THROUGH, not cancelled", async ($, on) => {
    const kept = wired(
      on, 1_018_000, { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" }, FILES, {}, [],
      { onComplete: () => neverAnswers() },
    )
    on("tool.call", () => ({ result: "ran" }))

    const running = callIt($)
    await kept.clock!.settle()
    // по пределу на каждую из двух ступеней: общий предел равен их сумме, и
    // вторая ступень обязана стартовать -- лестница не имеет права встать на
    // первом молчании.
    await kept.clock!.advance(RUNG_TMO)
    await kept.clock!.advance(RUNG_TMO)
    const res = await running

    expect(res, "a judge that cannot speak must not forbid").toEqual({ result: "ran" })
    const rec = JSON.parse(String(lastRecord(kept)?.text))
    expect(rec.kind, "silence by time has its own name").toBe("TIMEOUT")
    expect(rec.rungTimeouts, "every rung was waited out").toBe(2)
    expect(
      kept.store.sets.filter(s => s.key.indexOf("v:judge:") === 0),
      "a timeout is a state of the channel and is never cached",
    ).toEqual([])
    // Журнал -- второй дом исхода, и сводки флота читают ИМЕННО его: молчание
    // по времени обязано числиться пропуском, иначе агрегат покажет запреты,
    // которых судья не выносил.
    // в том же журнале первой идёт строка свипа хранилища -- она тоже помечена
    // probe:judge, поэтому отбор идёт по полю вердикта, а не по имени пробы.
    const line = kept.writes.find(w =>
      w.path.startsWith(HOME + "/judge/journal.jsonl") &&
      w.text.includes('"verdict":'),
    )
    expect(String(line?.text || ""), "the journal calls it a skip").toContain('"outcome":"skip"')
    expect(String(line?.text || ""), "and names the reason").toContain("TIMEOUT")
  })

  test("rungs that answer without a verdict still cancel: NONE is not TIMEOUT", async ($, on) => {
    const kept = wired(
      on, 1_034_000, { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" }, FILES, {},
      ["ответ мимо формата", "и этот мимо"],
    )
    on("tool.call", () => ({ result: "ran" }))

    const res = await callIt($)

    // У молчания по времени и у ответа без вердикта РАЗНЫЕ исходы: первое
    // пропускает, второе по-прежнему запрещает своей формулировкой.
    expect(
      String((res as any)?.deny || ""),
      "answering without a verdict keeps the old refusal",
    ).toContain("no verdict on any rung")
    const rec = JSON.parse(String(lastRecord(kept)?.text))
    expect(rec.kind).toBe("NONE")
    expect(rec.rungTimeouts, "nothing timed out here").toBeUndefined()
  })

  test("the evidence exists BEFORE the ladder: a consult in flight leaves a record", async ($, on) => {
    const kept = wired(on, 1_040_000, { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" }, FILES, {}, ["OK: fine"])
    on("tool.call", () => ({ result: "ran" }))

    await callIt($)

    const all = kept.writes.filter(w => RECORD_RE.test(w.path))
    expect(all.length, "the record is written twice: in flight, then final").toBe(2)
    expect(
      JSON.parse(String(all[0].text)).inflight,
      "a hung consult is visible from outside while it hangs",
    ).toBe(true)
    expect(JSON.parse(String(all[0].text)).ladder).toEqual(["m1", "m2"])
    expect(
      JSON.parse(String(all[all.length - 1].text)).inflight,
      "the final record is not marked in flight",
    ).toBeUndefined()
  })

  test("total_timeout_ms ends the trial: the next rung is never started", async ($, on) => {
    const kept = wired(
      on, 1_046_000, { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" },
      {
        [HOME + "/probes.toml"]:
          '[probe.judge]\nmodels = ["m1", "m2"]\ntimeout_ms = 5000\ntotal_timeout_ms = 5000\n',
        [HOME + "/judge/prompt.md"]: "JUDGE PROMPT",
      },
      {}, [], { onComplete: () => neverAnswers() },
    )
    on("tool.call", () => ({ result: "ran" }))

    const running = callIt($)
    await kept.clock!.settle()
    await kept.clock!.advance(RUNG_TMO)
    const res = await running

    expect(res, "an exhausted trial lets the dispatch through").toEqual({ result: "ran" })
    expect(
      kept.completes.map(c => c.model),
      "the ladder is cut at the trial's deadline, not walked to the end",
    ).toEqual(["m1"])
    const rec = JSON.parse(String(lastRecord(kept)?.text))
    expect(rec.deadlineHit, "the trial's own deadline is named in the evidence").toBe(true)
    expect(rec.kind).toBe("TIMEOUT")
  })

  test("no clock beneath the guard: the rung still counts, and the blindness is declared", async ($, on) => {
    // Часы поверхности могут быть недоступны -- тогда сторожа времени нет. Это
    // НЕ повод потерять ответившую ступень: отказ прибора объявляется полем
    // улики, а вердикт ступени принимается (ПУСТО != НОЛЬ).
    const kept = wired(
      on, 1_052_000, { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" }, FILES, {},
      ["BLOCK: no subject"], { clockBreak: () => false },
    )
    on("tool.call", () => ({ result: "ran" }))

    const res = await callIt($)

    expect(
      String((res as any)?.deny || ""),
      "the rung answered and its verdict stands",
    ).toContain("cancelled by the dispatch judge")
    const rec = JSON.parse(String(lastRecord(kept)?.text))
    expect(rec.kind).toBe("BLOCK")
    expect(rec.deadlineBlind, "the missing guard is on the record").toBe(true)
    expect(rec.rungTimeouts, "a blind guard is not a timeout").toBeUndefined()
  })

  test("the last rung is cut to what the trial has left, not given a fresh budget", async ($, on) => {
    const kept = wired(
      on, 1_058_000, { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" },
      {
        [HOME + "/probes.toml"]:
          '[probe.judge]\nmodels = ["m1", "m2"]\ntimeout_ms = 5000\ntotal_timeout_ms = 7000\n',
        [HOME + "/judge/prompt.md"]: "JUDGE PROMPT",
      },
      {}, [], { onComplete: () => neverAnswers() },
    )
    on("tool.call", () => ({ result: "ran" }))

    const running = callIt($)
    await kept.clock!.settle()
    await kept.clock!.advance(RUNG_TMO)
    await kept.clock!.advance(2000)
    const res = await running

    expect(res).toEqual({ result: "ran" })
    expect(kept.completes.map(c => c.model), "both rungs were tried").toEqual(["m1", "m2"])
    // остаток суда после первой ступени -- 2000 мс, и ровно столько просят
    // у образа и держит собственный сторож.
    expect(kept.completes[1].timeoutMs, "the image is asked for the remainder").toBe(2000)
    const rec = JSON.parse(String(lastRecord(kept)?.text))
    expect(String(rec.err_m2 || ""), "the guard fired on the remainder").toContain("2000ms")
    expect(rec.rungTimeouts).toBe(2)
  })

  // Тот же класс, что молчание по времени, но по другой причине: ступень
  // заговорила и была остановлена ПОТОЛКОМ токенов. Вердикта в тексте нет не
  // потому, что судья его не вынес, а потому что ему не дали договорить.
  test("a rung cut off by the token ceiling lets the dispatch through, apart from NONE", async ($, on) => {
    const cut = (t: string) => ({ text: t, stopReason: "max_tokens", usage: { output_tokens: 512 } })
    const kept = wired(
      on, 1_064_000, { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" }, FILES, {},
      [cut("разбор диспатча, оборванный на полуслове"), cut("и второй такой же")],
    )
    on("tool.call", () => ({ result: "ran" }))

    const res = await callIt($)

    expect(res, "a judge cut off mid-sentence must not forbid").toEqual({ result: "ran" })
    const rec = JSON.parse(String(lastRecord(kept)?.text))
    expect(rec.kind, "the ceiling carries its own name, apart from TIMEOUT and NONE").toBe("TRUNCATED")
    expect(rec.rungTruncated, "both rungs were cut").toBe(2)
    expect(rec.rungTimeouts, "nothing timed out here").toBeUndefined()
    expect(rec.stop_m2, "the reason came from the image, not from a guess").toBe("max_tokens")
    expect(
      kept.store.sets.filter(s => s.key.indexOf("v:judge:") === 0),
      "a budget failure is a state of the ceiling and is never cached",
    ).toEqual([])
    const line = kept.writes.find(w =>
      w.path.startsWith(HOME + "/judge/journal.jsonl") &&
      w.text.includes('"verdict":'),
    )
    expect(String(line?.text || ""), "the journal calls it a skip").toContain('"outcome":"skip"')
    expect(String(line?.text || ""), "and names the reason").toContain("TRUNCATED")
  })
})

describe("tool.describe", () => {
  test("a [prompt.<id>] table appends its text to one tool's description", async ($, on) => {
    const kept = wired(on, 7_000_000, {}, {
      [HOME + "/probes.toml"]:
        '[prompt.tool-note]\ntool = "Read"\ntext = "TOOL APPENDED RULE"\n',
    })
    on("tool.describe", (_$, e) => ({ description: e.description }))

    const r = await $.tool.describe({
      tool: "Read",
      description: "Reads a file.",
      provider: { plugin: "engine", tier: "core" },
    })

    expect(r.description).toBe("Reads a file.\n\nTOOL APPENDED RULE")
    expect(kept.writes.map(w => w.path)).toContain(
      HOME + "/prompts/records/applied-tool-note.json",
    )
  })
})

describe("command.describe", () => {
  test("a [prompt.<id>] table replaces a description, named with or without the slash", async ($, on) => {
    const kept = wired(on, 13_000_000, {}, {
      [HOME + "/probes.toml"]:
        '[prompt.cmd-note]\ncommand = "deploy"\ntext = "CMD REPLACED TEXT"\nmode = "replace"\n',
    })
    on("command.describe", (_$, e) => ({
      description: e.description,
      isHidden: e.isHidden,
      argumentHint: e.argumentHint,
    }))

    const plain = await $.command.describe({
      command: "deploy",
      description: "old text",
      argumentHint: "app",
      isHidden: false,
      immediate: false,
      provider: { plugin: "engine", tier: "core" },
    })
    expect(plain.description).toBe("CMD REPLACED TEXT")

    const slashed = await $.command.describe({
      command: "/deploy",
      description: "old text",
      argumentHint: "app",
      isHidden: false,
      immediate: false,
      provider: { plugin: "engine", tier: "core" },
    })
    expect(slashed.description, "the slash is stripped before matching").toBe(
      "CMD REPLACED TEXT",
    )

    expect(kept.writes.map(w => w.path)).toContain(
      HOME + "/prompts/records/applied-cmd-note.json",
    )
  })
})

describe("prompt.section", () => {
  test("the built-in dispatch rule appends to communication:L when the judge rides the mod", async ($, on) => {
    const kept = wired(
      on,
      19_000_000,
      { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "1" },
      {},
    )
    on("prompt.section", (_$, e) => ({ text: e.text }))

    const r = await $.prompt.section({ name: "communication:L", text: "base section" })

    expect(r.text).toStartWith("base section\n\n")
    expect(r.text).toContain("A subagent dispatch may be reviewed before it runs.")
    expect(kept.writes.map(w => w.path)).toContain(
      HOME + "/prompts/records/applied-dispatch-rule.json",
    )
  })

  test("the same section rides untouched when the judge is not on the mod", async ($, on) => {
    const kept = wired(on, 25_000_000, { CLAUDE_JUDGE: "1" }, {})
    on("prompt.section", (_$, e) => ({ text: e.text }))

    const r = await $.prompt.section({ name: "communication:L", text: "base section" })

    expect(r.text).toBe("base section")
    expect(kept.writes).toEqual([])
  })
})

// /clear and /resume keep the PROCESS, so every piece of module state that
// survives them answers the new session from the old one's memory. These
// teeth drive the boundary through the engine's own $, the way the person
// types the command.
describe("session boundary", () => {
  test("/clear breaks the verdict cache key: the next consult files under the NEW sid", async ($, on) => {
    let sid = "w201-a"
    const kept = wired(
      on,
      31_000_000,
      { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" },
      {
        [HOME + "/probes.toml"]: '[probe.judge]\nmodels = ["m1"]\n',
        [HOME + "/judge/prompt.md"]: "JUDGE PROMPT",
      },
      {},
      ["BLOCK: first world", "BLOCK: second world"],
      { sidOf: () => sid },
    )
    on("command.run", { command: "clear" }, () => ({ text: "cleared" }))
    on("tool.call", () => ({ result: "ran anyway" }))

    const prompt = "[dispatch-class:exec-0p] one prompt, two sessions"
    const first = await $.tool.call({
      tool: "Agent",
      description: "brew",
      prompt,
      subagent_type: "scout",
    })
    expect(first.deny, "the first consult denies in the first session").toContain("first world")

    sid = "w201-b"
    const cleared = await $.command.run({ command: "clear", args: "" })
    expect(cleared).toEqual({ text: "cleared" })

    const second = await $.tool.call({
      tool: "Agent",
      description: "brew",
      prompt,
      subagent_type: "scout",
    })
    expect(second.deny, "the stale sid must not serve the old verdict").toContain("second world")
    expect(kept.completes, "the new session consults the model again").toHaveLength(2)
    expect(
      kept.store.sets.some(s => s.key === verdictKey("judge", "w201-b", "Agent", "scout", prompt)),
      "the second verdict is filed under the NEW session's key",
    ).toBe(true)
  })

  test("the world is re-read after /clear even inside the memo window", async ($, on) => {
    const files: Record<string, string> = {
      [HOME + "/probes.toml"]: '[prompt.tool-note]\ntool = "Read"\ntext = "OLD WORLD TEXT"\n',
    }
    wired(on, 31_000_000, {}, files)
    on("command.run", { command: "clear" }, () => ({ text: "cleared" }))
    on("tool.describe", (_$, e) => ({ description: e.description }))

    const first = await $.tool.describe({
      tool: "Read",
      description: "Reads a file.",
      provider: { plugin: "engine", tier: "core" },
    })
    expect(first.description).toBe("Reads a file.\n\nOLD WORLD TEXT")

    files[HOME + "/probes.toml"] = '[prompt.tool-note]\ntool = "Read"\ntext = "NEW WORLD TEXT"\n'
    await $.command.run({ command: "clear", args: "" })

    const second = await $.tool.describe({
      tool: "Read",
      description: "Reads a file.",
      provider: { plugin: "engine", tier: "core" },
    })
    expect(second.description, "the new session reads the new config").toBe(
      "Reads a file.\n\nNEW WORLD TEXT",
    )
    expect(second.description).not.toContain("OLD WORLD TEXT")
  })

  test("a model answer that lands after /clear is not applied: staleEpoch, no deny, no cache", async ($, on) => {
    let clearedInFlight = false
    const kept = wired(
      on,
      37_000_000,
      { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" },
      {
        [HOME + "/probes.toml"]: '[probe.judge]\nmodels = ["m1"]\n',
        [HOME + "/judge/prompt.md"]: "JUDGE PROMPT",
      },
      {},
      ["BLOCK: too late"],
      {
        onComplete: async () => {
          // The session turns over strictly inside the model call: the
          // consult is parked on this very await when /clear runs.
          await $.command.run({ command: "clear", args: "" })
          clearedInFlight = true
        },
      },
    )
    on("command.run", { command: "clear" }, () => ({ text: "cleared" }))
    on("tool.call", () => ({ result: "ran anyway" }))

    const res = await $.tool.call({
      tool: "Agent",
      description: "brew",
      prompt: "[dispatch-class:exec-0p] stale run",
      subagent_type: "scout",
    })

    expect(clearedInFlight, "the clear really ran under the consult").toBe(true)
    expect(res, "a stale verdict never cancels the dispatch").toEqual({ result: "ran anyway" })
    expect(
      kept.store.sets.filter(s => s.key.indexOf("v:judge:") === 0),
      "a stale verdict is never cached",
    ).toEqual([])
    const record = lastRecord(kept)
    expect(
      record && JSON.parse(String(record.text)).staleEpoch,
      "the evidence names the stale epoch instead of dropping the rung silently",
    ).toBe(true)
  })

  test("the verdict sweep rides the first judge consult, not the session start", async ($, on) => {
    const kept = wired(
      on,
      43_000_000,
      { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" },
      {
        [HOME + "/probes.toml"]: '[probe.judge]\nmodels = ["m1"]\n',
        [HOME + "/judge/prompt.md"]: "JUDGE PROMPT",
      },
      {
        "v:judge:stale": { kind: "BLOCK", t: 41_800_000, rest: "past the default ttl" },
        "v:judge:no-t": { kind: "BLOCK", rest: "pre-boundary form" },
        "v:judge:fresh": { kind: "BLOCK", t: 42_900_000, rest: "young" },
        "v:other:x": { kind: "BLOCK", t: 41_800_000, rest: "not ours" },
      },
      ["OK: clean"],
    )
    on("command.run", { command: "clear" }, () => ({ text: "cleared" }))
    on("tool.call", () => ({ result: "ran anyway" }))

    // A session boundary first: the sweep must not depend on module state
    // left behind by the teeth that ran before this one.
    await $.command.run({ command: "clear", args: "" })

    const res = await $.tool.call({
      tool: "Agent",
      description: "brew",
      prompt: "[dispatch-class:exec-0p] sweep rider",
      subagent_type: "scout",
    })
    expect(res).toEqual({ result: "ran anyway" })

    const sweep = kept.writes.find(w =>
      w.path.startsWith(HOME + "/judge/journal.jsonl.shard.") &&
      w.text.includes('"outcome":"store_sweep"'),
    )
    expect(sweep?.text, "the first consult swept the store").toContain('"removed":2')
    expect(sweep?.text).toContain('"scanned":3')

    const keys = kept.store.keys()
    expect(keys, "past ttl and formless keys are gone").not.toContain("v:judge:stale")
    expect(keys).not.toContain("v:judge:no-t")
    expect(keys, "a live verdict stays").toContain("v:judge:fresh")
    expect(keys, "a foreign key is never touched").toContain("v:other:x")
    expect(kept.store.deletes).toEqual(["v:judge:stale", "v:judge:no-t"])
  })

  // CONSTRAINT: the turnover lands on a rung that FAILS, not on one that answers.
  // A mark taken afresh per rung would already be the new one by the time the
  // next rung runs, so its verdict would be applied — while the cache key was
  // computed from the OLD sid at the top of tool.call. The mark is therefore
  // taken once per consult; this tooth is what holds that.
  test("a session that turns over while a rung FAILS still voids the next rung's verdict", async ($, on) => {
    let calls = 0
    let clearedInFlight = false
    const kept = wired(
      on,
      55_000_000,
      { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" },
      {
        [HOME + "/probes.toml"]: '[probe.judge]\nmodels = ["m1", "m2"]\n',
        [HOME + "/judge/prompt.md"]: "JUDGE PROMPT",
      },
      {},
      ["BLOCK: second rung"],
      {
        onComplete: async () => {
          calls++
          if (calls > 1) return
          await $.command.run({ command: "clear", args: "" })
          clearedInFlight = true
          throw new Error("rung m1 refused after the session turned over")
        },
      },
    )
    on("command.run", { command: "clear" }, () => ({ text: "cleared" }))
    on("tool.call", () => ({ result: "ran anyway" }))

    const res = await $.tool.call({
      tool: "Agent",
      description: "brew",
      prompt: "[dispatch-class:exec-0p] two rungs, first one dies",
      subagent_type: "scout",
    })

    expect(clearedInFlight, "the clear really ran under the failing rung").toBe(true)
    expect(kept.completes, "the second rung really was asked").toHaveLength(2)
    expect(res, "the second rung's verdict belongs to the old world").toEqual({
      result: "ran anyway",
    })
    expect(
      kept.store.sets.filter(s => s.key.indexOf("v:judge:") === 0),
      "nothing is filed under the stale sid's key",
    ).toEqual([])
    const record = lastRecord(kept)
    expect(
      record && JSON.parse(String(record.text)).staleEpoch,
      "the evidence names the stale epoch",
    ).toBe(true)
  })

  test("a broken clock does not stain the next session's evidence after /clear", async ($, on) => {
    let clockDown = true
    const kept = wired(
      on,
      49_000_000,
      { CLAUDE_JUDGE_CARRIER: "mod", CLAUDE_JUDGE: "enforce" },
      {
        [HOME + "/probes.toml"]: '[probe.judge]\nmodels = ["m1"]\n',
        [HOME + "/judge/prompt.md"]: "JUDGE PROMPT",
      },
      {},
      ["OK: fine one", "OK: fine two"],
      { clockBreak: () => clockDown },
    )
    on("command.run", { command: "clear" }, () => ({ text: "cleared" }))
    on("tool.call", () => ({ result: "ran anyway" }))

    await $.tool.call({
      tool: "Agent",
      description: "brew",
      prompt: "[dispatch-class:exec-0p] clock watch one",
      subagent_type: "scout",
    })

    clockDown = false
    await $.command.run({ command: "clear", args: "" })

    await $.tool.call({
      tool: "Agent",
      description: "brew",
      prompt: "[dispatch-class:exec-0p] clock watch two",
      subagent_type: "scout",
    })

    const records = finalRecords(kept)
    expect(records).toHaveLength(2)
    expect(records[0].clockBad, "the outage is seen in the first session").toBe(true)
    expect(records[1].clockBad, "the flag died with the session").toBeUndefined()
  })
})

async function settleStep(g: any): Promise<any> {
  if (g == null) return g
  if (typeof g.next !== "function") {
    if (typeof g.then === "function") return await g
    return g
  }
  let n = await g.next()
  while (!n.done) n = await g.next()
  return n.value
}

// CONSTRAINT: дрен с уликой кусков: settleStep теряет всё, что ступень выдала
// до финала, а зубам на «выдачу до отказа/броска» нужен именно кусок, дошедший
// до вызывающего. Бросок несёт ФЛАГ, а не истинность значения.
async function drainStep(g: any): Promise<{ threw: boolean; error: any; value: any; chunks: any[] }> {
  const out = { threw: false, error: undefined as any, value: undefined as any, chunks: [] as any[] }
  if (g == null) { out.value = g; return out }
  if (typeof g.next !== "function") {
    out.value = typeof g.then === "function" ? await g : g
    return out
  }
  for (;;) {
    let n: any
    try { n = await g.next() } catch (x) { out.threw = true; out.error = x; return out }
    if (n.done) { out.value = n.value; return out }
    out.chunks.push(n.value)
  }
}

function failoverToml(): string {
  return [
    "[failover]",
    "enabled = true",
    "",
    "[failover.default]",
    'models = ["glm-5.3", "grok-4.6"]',
    "",
    "[failover.agent.glm-executor]",
    'models = ["glm-5.3", "grok-4.6"]',
    "",
  ].join("\n")
}

describe("failover: agent.spawn + turn.step", () => {
  test("empty first model yields the second result and two protocol lines", async ($, on) => {
    const kept = wired(
      on,
      70_000_000,
      {},
      { [HOME + "/probes.toml"]: failoverToml() },
    )
    const seen: string[] = []
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "busy-model"),
      agentId: "ag-fail-1",
    }))
    on("turn.step", async function* (_$, e) {
      seen.push(String(e.model))
      if (e.model === "busy-model") {
        return {
          turnId: e.turnId, index: e.index, answer: "", toolUses: [],
          stopReason: null, usage: null,
        }
      }
      return {
        turnId: e.turnId, index: e.index, answer: "from-second", toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: e.model },
      }
    })

    const spawned = await $.agent.spawn({
      tool_use_id: "tu-spawn-1",
      prompt: "[dispatch-class:exec-0p] do the work",
      description: "work",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(spawned.agentId).toBe("ag-fail-1")

    const res = await settleStep($.turn.step({
      turnId: "turn-fail-1",
      index: 0,
      model: "busy-model",
      messageCount: 1,
      agentId: spawned.agentId,
    }))

    expect(res && res.answer, "the hook returned the SECOND result").toBe("from-second")
    expect(seen, "first next was the incoming model, second a ladder rung").toEqual([
      "busy-model",
      "glm-5.3",
    ])

    const lines = kept.writes
      .filter(w => String(w.path).indexOf(HOME + "/failover/journal.jsonl.shard.") === 0)
      .map(w => JSON.parse(String(w.text)))
    expect(lines, "protocol has two records").toHaveLength(2)
    expect(lines[0].modelRequested).toBe("busy-model")
    expect(lines[1].modelRequested).toBe("glm-5.3")
    expect(lines[0].modelRequested).not.toBe(lines[1].modelRequested)
    expect(lines[0].outcome).toBe("empty")
    expect(lines[1].outcome).toBe("ok")
  })

  // CONSTRAINT: выключатель пинится только при ЖИВОЙ привязке: при enabled=false
  // agent.spawn привязку не заводит вовсе, и turn.step выходит раньше проверки
  // (register.ts:1982) -- наивный зуб был бы вакуумным. Поэтому probes.toml
  // подменяется МЕЖДУ spawn и step (fs.read берёт files на каждый вызов), а
  // часы уводятся за окно мемо мира (5000 мс, register.ts:909-916): иначе шаг
  // прочёл бы мир, который загрузил spawn, и лестница поехала бы по-честному.
  test("enabled=false mid-flight: one next, the original model, zero journal lines", async ($, on) => {
    const onToml = failoverToml()
    const offToml = failoverToml().replace("enabled = true", "enabled = false")
    const files: Record<string, string> = {}
    files[HOME + "/probes.toml"] = onToml
    const kept = wired(on, 80_000_000, {}, files)
    const seen: string[] = []
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "busy-model"),
      agentId: "ag-fail-off",
    }))
    on("turn.step", async function* (_$, e) {
      seen.push(String(e.model))
      return {
        turnId: e.turnId, index: e.index, answer: "from-original", toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: e.model },
      }
    })

    const spawned = await $.agent.spawn({
      tool_use_id: "tu-spawn-off",
      prompt: "[dispatch-class:exec-0p] switch watch",
      description: "switch watch",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(spawned.agentId).toBe("ag-fail-off")

    files[HOME + "/probes.toml"] = offToml
    await kept.clock!.advance(6000)

    const res = await settleStep($.turn.step({
      turnId: "turn-fail-off",
      index: 0,
      model: "busy-model",
      messageCount: 1,
      agentId: spawned.agentId,
    }))

    expect(res && res.answer, "выключенный мод отвечает результатом самой ступени").toBe("from-original")
    expect(seen, "ровно один next, и с ИСХОДНОЙ моделью").toEqual(["busy-model"])
    const lines = kept.writes
      .filter(w => String(w.path).indexOf(HOME + "/failover/journal.jsonl.shard.") === 0)
      .map(w => JSON.parse(String(w.text)))
    expect(lines, "ноль записей журнала: именно ноль, а не «нет второй»").toHaveLength(0)
  })

  // CONSTRAINT: липкость видна только ПОРЯДКОМ моделей в next: ответ второго
  // шага одинаков в обеих ветках (ступень в конце концов отвечает), поэтому
  // предмет -- с чего второй шаг начал, а не чем кончил.
  test("a successful rung is sticky: the next step of the SAME agent starts from it", async ($, on) => {
    const kept = wired(
      on,
      90_000_000,
      {},
      { [HOME + "/probes.toml"]: failoverToml() },
    )
    const seen: string[] = []
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "busy-model"),
      agentId: "ag-fail-sticky",
    }))
    on("turn.step", async function* (_$, e) {
      seen.push(String(e.model))
      if (e.model === "busy-model") {
        return {
          turnId: e.turnId, index: e.index, answer: "", toolUses: [],
          stopReason: null, usage: null,
        }
      }
      return {
        turnId: e.turnId, index: e.index, answer: "from-" + e.model, toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: e.model },
      }
    })

    const spawned = await $.agent.spawn({
      tool_use_id: "tu-spawn-sticky",
      prompt: "[dispatch-class:exec-0p] sticky watch",
      description: "sticky watch",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(spawned.agentId).toBe("ag-fail-sticky")

    const first = await settleStep($.turn.step({
      turnId: "turn-sticky-1",
      index: 0,
      model: "busy-model",
      messageCount: 1,
      agentId: spawned.agentId,
    }))
    expect(first && first.answer, "первый шаг отвечает удачная ступень").toBe("from-glm-5.3")

    const second = await settleStep($.turn.step({
      turnId: "turn-sticky-2",
      index: 0,
      model: "busy-model",
      messageCount: 1,
      agentId: spawned.agentId,
    }))
    expect(second && second.answer, "второй шаг тоже отвечает ступень").toBe("from-glm-5.3")
    expect(seen, "второй шаг начался с УДАЧНОЙ модели, а не с исходной").toEqual([
      "busy-model",
      "glm-5.3",
      "glm-5.3",
    ])
  })

  // CONSTRAINT: ложный бросок носителя до этой ступени НЕ ДОЕЗЖАЕТ ни одной
  // дорогой, доступной зубу на поведении -- обе границы ИЗМЕРЕНЫ 2026-09-16:
  //  (1) харнес гасит бросок тестового хука и подставляет свой объект
  //      (`HooksError: no implementation for turn.step`), поэтому ложное
  //      значение через `$.turn.step` не приходит никогда;
  //  (2) хост выдаёт op-существительные ($.fs/$.env/$.clock) ТОЛЬКО модулю,
  //      чей статический разбор их называет: ступени, поднятой из модуля и
  //      вызванной ОТСЮДА, отказано («its hooks module does not call it»), и
  //      журнала у неё нет.
  // Поэтому предметом служит то, что наблюдаемо без обеих: сама ступень с
  // `next`, бросающим ЛОЖЬ. Маршрут движка до хука пинят соседние зубы блока.
  // НЕ ИЗМЕРЕНО: метка `outcome` в журнале при ЛОЖНОМ броске -- она живёт за
  // границей (2) и делит флаг с решением ниже, которое зуб держит.
  test("ложный бросок носителя — бросок, а не успех", async () => {
    const steps: Record<string, any> = {}
    register((ev: string, ...rest: any[]) => {
      steps[ev] = rest[rest.length - 1]
      return { catch: () => {} }
    })
    const ladder = ["glm-5.3", "grok-4.6"]

    // Носитель бросает ЛОЖНОЕ значение: по истинности оно неотличимо от
    // «не бросали», и ступень объявила бы отказ успехом.
    const seen: string[] = []
    const oneFalsy = (req: any) => (async function* () {
      seen.push(String(req.model))
      if (req.model === "busy-model") throw 0
      return {
        turnId: req.turnId, index: req.index, answer: "from-second", toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: req.model },
      }
    })()

    failoverBindSet("ag-unit-falsy", {
      ladder, subagentType: "glm-executor", class: "exec-0p", sticky: null,
    })
    const res = await settleStep(steps["turn.step"]({}, {
      turnId: "turn-unit-falsy", index: 0, model: "busy-model",
      messageCount: 1, agentId: "ag-unit-falsy",
    }, oneFalsy))

    expect(res && res.answer, "ложный бросок увёл на следующую ступень").toBe("from-second")
    expect(seen, "обе ступени пройдены").toEqual(["busy-model", "glm-5.3"])

    // Бросок ПОСЛЕДНЕЙ ступени уезжает вызывающему нетронутым: съеденное
    // исключение неотличимо от пустого ответа.
    const seenAll: string[] = []
    const allFalsy = (req: any) => (async function* () {
      seenAll.push(String(req.model))
      throw 0
      // eslint-disable-next-line no-unreachable
      yield 0
    })()

    failoverBindSet("ag-unit-falsy-all", {
      ladder, subagentType: "glm-executor", class: "exec-0p", sticky: null,
    })
    let caught: any = "НЕ БРОСИЛО"
    let returned: any = "НЕ ВЕРНУЛО"
    try {
      returned = await settleStep(steps["turn.step"]({}, {
        turnId: "turn-unit-falsy-all", index: 0, model: "busy-model",
        messageCount: 1, agentId: "ag-unit-falsy-all",
      }, allFalsy))
    } catch (x) { caught = x }

    expect(seenAll, "пройдены все ступени лестницы").toEqual(["busy-model", "glm-5.3", "grok-4.6"])
    expect(caught, "ложный бросок последней ступени уезжает вызывающему").toBe(0)
    expect(returned, "проглоченный бросок не подменяется пустым возвратом").toBe("НЕ ВЕРНУЛО")
  })

  // CONSTRAINT: кусок обязан пройти СКВОЗЬ движок до делегации мода (граница
  // харнеса, которую пинит этот зуб): движок пропускает выдачу тестового хука
  // ТОЛЬКО в протокольной форме -- kind из (text, thinking, tool, input, stop,
  // engine), text-кусок обязан нести { index, text }; бесформенный кусок
  // заставляет движок СКИНУТЬ хук целиком («test's turn.step hook was
  // skipped», измерено 2026-09-16). Если движок буферизует выдачу и с годным
  // куском, мод видит ноль выданных кусков, лестница склеивает ступени и зуб
  // краснеет -- молча позеленеть он не может.
  test("rung emitted a chunk then refused: empty first result out, second rung NOT called", async ($, on) => {
    const kept = wired(
      on,
      100_000_000,
      {},
      { [HOME + "/probes.toml"]: failoverToml() },
    )
    const seen: string[] = []
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "busy-model"),
      agentId: "ag-fail-emit-ref",
    }))
    on("turn.step", async function* (_$, e) {
      seen.push(String(e.model))
      if (e.model === "busy-model") {
        yield { kind: "text", index: 0, text: "partial-emit-ref" }
        return {
          turnId: e.turnId, index: e.index, answer: "", toolUses: [],
          stopReason: null, usage: null,
        }
      }
      return {
        turnId: e.turnId, index: e.index, answer: "from-second", toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: e.model },
      }
    })

    const spawned = await $.agent.spawn({
      tool_use_id: "tu-spawn-emit-ref",
      prompt: "[dispatch-class:exec-0p] emit then refuse",
      description: "emit then refuse",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(spawned.agentId).toBe("ag-fail-emit-ref")

    const out = await drainStep($.turn.step({
      turnId: "turn-fail-emit-ref",
      index: 0,
      model: "busy-model",
      messageCount: 1,
      agentId: spawned.agentId,
    }))

    expect(out.chunks.length, "кусок первой ступени дошёл до вызывающего").toBe(1)
    expect(out.chunks[0] && out.chunks[0].text, "дошёл именно её кусок").toBe("partial-emit-ref")
    expect(seen, "перехода с выдавшей ступени нет: вторая НЕ звалась").toEqual(["busy-model"])
    expect(out.threw).toBe(false)
    expect(out.value && out.value.answer, "наружу ушёл ПУСТОЙ результат первой ступени").toBe("")
    expect(out.value && out.value.usage).toBe(null)

    const lines = kept.writes
      .filter(w => String(w.path).indexOf(HOME + "/failover/journal.jsonl.shard.") === 0)
      .map(w => JSON.parse(String(w.text)))
    expect(lines, "ровно одна попытка").toHaveLength(1)
    expect(lines[0].modelRequested).toBe("busy-model")
    expect(lines[0].outcome, "отказ после выдачи -- отдельное состояние, не empty").toBe("empty_after_emit")
    expect(lines[0].emitted).toBe(1)
  })

  // CONSTRAINT: прямой вызов хука мода, не $.turn.step: движок гасит бросок
  // тестового хука и подставляет свой объект (измерено -- соседний зуб про
  // ложный бросок), и бросок после выдачи иначе не доехал бы до лестницы как
  // бросок. Ступень НЕ последняя: старое поведение гасило бы бросок и звало
  // следующую.
  test("rung emitted a chunk then threw: the throw goes out, second rung NOT called", async () => {
    const steps: Record<string, any> = {}
    register((ev: string, ...rest: any[]) => {
      steps[ev] = rest[rest.length - 1]
      return { catch: () => {} }
    })
    const ladder = ["glm-5.3", "grok-4.6"]

    const seen: string[] = []
    const emitThenThrow = (req: any) => (async function* () {
      seen.push(String(req.model))
      if (req.model === "busy-model") {
        yield { delta: "partial-emit-throw" }
        throw new Error("emit-then-throw")
      }
      return {
        turnId: req.turnId, index: req.index, answer: "from-second", toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: req.model },
      }
    })()

    failoverBindSet("ag-unit-emit-throw", {
      ladder, subagentType: "glm-executor", class: "exec-0p", sticky: null,
    })
    const out = await drainStep(steps["turn.step"]({}, {
      turnId: "turn-unit-emit-throw", index: 0, model: "busy-model",
      messageCount: 1, agentId: "ag-unit-emit-throw",
    }, emitThenThrow))

    expect(out.chunks, "кусок дошёл до вызывающего ДО броска").toEqual([{ delta: "partial-emit-throw" }])
    expect(out.threw, "бросок уехал наружу немедленно").toBe(true)
    expect(String(out.error && out.error.message), "уехал именно бросок ступени").toBe("emit-then-throw")
    expect(seen, "ступень не последняя, но уже выдала: следующая НЕ звалась").toEqual(["busy-model"])
  })

  // CONSTRAINT: стережёт от чрезмерного лечения: запрет перехода обязан
  // касаться ТОЛЬКО выдавшей ступени -- молчащая отказывает как раньше.
  test("silent refusal: ladder still moves to the second rung", async () => {
    const steps: Record<string, any> = {}
    register((ev: string, ...rest: any[]) => {
      steps[ev] = rest[rest.length - 1]
      return { catch: () => {} }
    })
    const ladder = ["glm-5.3", "grok-4.6"]

    const seen: string[] = []
    const silentRefusal = (req: any) => (async function* () {
      seen.push(String(req.model))
      if (req.model === "busy-model") {
        return {
          turnId: req.turnId, index: req.index, answer: "", toolUses: [],
          stopReason: null, usage: null,
        }
      }
      return {
        turnId: req.turnId, index: req.index, answer: "from-second", toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: req.model },
      }
    })()

    failoverBindSet("ag-unit-silent-refusal", {
      ladder, subagentType: "glm-executor", class: "exec-0p", sticky: null,
    })
    const out = await drainStep(steps["turn.step"]({}, {
      turnId: "turn-unit-silent-refusal", index: 0, model: "busy-model",
      messageCount: 1, agentId: "ag-unit-silent-refusal",
    }, silentRefusal))

    expect(out.chunks, "первая ступень молчала").toEqual([])
    expect(out.threw).toBe(false)
    expect(seen, "переход с молчащей ступени законен").toEqual(["busy-model", "glm-5.3"])
    expect(out.value && out.value.answer, "ответ второй ступени вернулся").toBe("from-second")
  })
})

// CONSTRAINT (#226): зубы этого блока читают УЛИКУ, поэтому идут ДВИЖКОВЫМ
// маршрутом ($.agent.spawn + $.turn.step): прямому вызову хука мода op-существительные
// отказаны («its hooks module does not call it» -- измерено 2026-09-16), журнала
// у него нет. Модульное состояние (накопитель моделей исполнителей) переживает
// тесты файла, поэтому каждый зуб начинает с sessionExecutorsReset().
describe("failover: проверяющий не уезжает на модель исполнителя (#226)", () => {
  function failover226Toml(critModels: string): string {
    return [
      "[failover]",
      "enabled = true",
      "",
      "[failover.class.exec-0p]",
      'models = ["glm-5.3", "grok-4.6"]',
      "",
      "[failover.class.crit-mech]",
      "models = " + critModels,
      "",
      "[failover.class.scout-enum]",
      'models = ["glm-5.3", "grok-4.6"]',
      "",
    ].join("\n")
  }

  function failoverLines(kept: Kept): any[] {
    return kept.writes
      .filter(w => String(w.path).indexOf(HOME + "/failover/journal.jsonl.shard.") === 0)
      .map(w => JSON.parse(String(w.text)))
  }

  // Шаблон ступени: busy-model отказывает носителем (usage null, stopReason
  // null), любая другая модель отвечает. Совпадение с накопителем
  // определяется ПО МОДЕЛИ, поэтому остальные отвечают успешно всегда --
  // увод на модель исполнителя опасен именно когда она работает.
  function refusingFirst(seen: string[]) {
    return async function* (_$: unknown, e: any) {
      seen.push(String(e.model))
      if (e.model === "busy-model") {
        return {
          turnId: e.turnId, index: e.index, answer: "", toolUses: [],
          stopReason: null, usage: null,
        }
      }
      return {
        turnId: e.turnId, index: e.index, answer: "from-" + e.model, toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: e.model },
      }
    }
  }

  test("#226 зуб 1: отказ носителя уводит проверяющего НЕ на модель исполнителя", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 110_000_000, {}, {
      [HOME + "/probes.toml"]: failover226Toml('["glm-5.3", "grok-4.6"]'),
    })
    const seen: string[] = []
    on("agent.spawn", (_$, e) => {
      const exec = String(e.prompt).indexOf("[dispatch-class:exec-0p]") >= 0
      return exec
        ? { model: "glm-5.3", agentId: "ag-226-exec-1" }
        : { model: "busy-model", agentId: "ag-226-crit-1" }
    })
    on("turn.step", refusingFirst(seen))

    const exec = await $.agent.spawn({
      tool_use_id: "tu-226-exec-1",
      prompt: "[dispatch-class:exec-0p] исполнитель отработал на glm-5.3",
      description: "exec",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "glm-5.3",
    })
    expect(exec.agentId).toBe("ag-226-exec-1")

    const crit = await $.agent.spawn({
      tool_use_id: "tu-226-crit-1",
      prompt: "[dispatch-class:crit-mech] проверить работу исполнителя",
      description: "crit",
      subagentType: "gpt6-critic",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(crit.agentId).toBe("ag-226-crit-1")

    const res = await settleStep($.turn.step({
      turnId: "turn-226-1", index: 0, model: "busy-model", messageCount: 1,
      agentId: crit.agentId,
    }))

    expect(res && res.answer, "шаг ушёл на другую модель, не на модель исполнителя").toBe("from-grok-4.6")
    expect(seen, "glm-5.3 вычеркнута из плана проверяющего").toEqual(["busy-model", "grok-4.6"])

    const lines = failoverLines(kept)
    expect(lines, "две попытки: исходная и ступень").toHaveLength(2)
    expect(lines[1].class).toBe("crit-mech")
    expect(lines[1].modelRequested).toBe("grok-4.6")
    expect(lines[1].rungsFiltered, "в улике: одна ступень отфильтрована").toBe(1)
  })

  test("#226 зуб 2: лестница только из модели исполнителя — переход есть, отметка «нечем фильтровать»", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 120_000_000, {}, {
      [HOME + "/probes.toml"]: failover226Toml('["glm-5.3"]'),
    })
    const seen: string[] = []
    on("agent.spawn", (_$, e) => {
      const exec = String(e.prompt).indexOf("[dispatch-class:exec-0p]") >= 0
      return exec
        ? { model: "glm-5.3", agentId: "ag-226-exec-2" }
        : { model: "busy-model", agentId: "ag-226-crit-2" }
    })
    on("turn.step", refusingFirst(seen))

    const exec = await $.agent.spawn({
      tool_use_id: "tu-226-exec-2",
      prompt: "[dispatch-class:exec-0p] исполнитель отработал на glm-5.3",
      description: "exec",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "glm-5.3",
    })
    expect(exec.agentId).toBe("ag-226-exec-2")

    const crit = await $.agent.spawn({
      tool_use_id: "tu-226-crit-2",
      prompt: "[dispatch-class:crit-mech] проверить работу исполнителя",
      description: "crit",
      subagentType: "gpt6-critic",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(crit.agentId).toBe("ag-226-crit-2")

    const res = await settleStep($.turn.step({
      turnId: "turn-226-2", index: 0, model: "busy-model", messageCount: 1,
      agentId: crit.agentId,
    }))

    expect(res && res.answer, "работа не встала: переход на модель исполнителя состоялся").toBe("from-glm-5.3")
    expect(seen).toEqual(["busy-model", "glm-5.3"])

    const lines = failoverLines(kept)
    expect(lines).toHaveLength(2)
    expect(lines[1].modelRequested).toBe("glm-5.3")
    expect(lines[1].rungsFiltered).toBe(1)
    expect(lines[1].ladderFullTaken, "в улике: отфильтровать было нечем, взята полная лестница").toBe(true)
  })

  test("#226 зуб 3: модель старта уже в накопителе — не переписывается, отметка в улике", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 130_000_000, {}, {
      [HOME + "/probes.toml"]: failover226Toml('["grok-4.6", "qwen3.8-flash"]'),
    })
    const seen: string[] = []
    on("agent.spawn", (_$, e) => {
      const exec = String(e.prompt).indexOf("[dispatch-class:exec-0p]") >= 0
      return exec
        ? { model: "glm-5.3", agentId: "ag-226-exec-3" }
        : { model: "glm-5.3", agentId: "ag-226-crit-3" }
    })
    on("turn.step", refusingFirst(seen))

    const exec = await $.agent.spawn({
      tool_use_id: "tu-226-exec-3",
      prompt: "[dispatch-class:exec-0p] исполнитель отработал на glm-5.3",
      description: "exec",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "glm-5.3",
    })
    expect(exec.agentId).toBe("ag-226-exec-3")

    const crit = await $.agent.spawn({
      tool_use_id: "tu-226-crit-3",
      prompt: "[dispatch-class:crit-mech] проверить работу исполнителя",
      description: "crit",
      subagentType: "gpt6-critic",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "glm-5.3",
    })
    expect(crit.agentId).toBe("ag-226-crit-3")

    const res = await settleStep($.turn.step({
      turnId: "turn-226-3", index: 0, model: "glm-5.3", messageCount: 1,
      agentId: crit.agentId,
    }))

    expect(res && res.answer, "шаг отработал назначенной моделью").toBe("from-glm-5.3")
    expect(seen, "модель шага модом НЕ изменена").toEqual(["glm-5.3"])

    const lines = failoverLines(kept)
    expect(lines).toHaveLength(1)
    expect(lines[0].modelRequested).toBe("glm-5.3")
    expect(lines[0].laddered).toBe(false)
    expect(lines[0].startMatch, "в улике: совпадение на старте").toBe(true)
    expect(lines[0].rungsFiltered).toBe(0)
  })

  test("#226 зуб 4: класс вне обоих перечней (scout-enum) правилом не задет", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 140_000_000, {}, {
      [HOME + "/probes.toml"]: failover226Toml('["glm-5.3", "grok-4.6"]'),
    })
    const seen: string[] = []
    on("agent.spawn", (_$, e) => {
      const exec = String(e.prompt).indexOf("[dispatch-class:exec-0p]") >= 0
      return exec
        ? { model: "glm-5.3", agentId: "ag-226-exec-4" }
        : { model: "busy-model", agentId: "ag-226-scout-4" }
    })
    on("turn.step", refusingFirst(seen))

    const exec = await $.agent.spawn({
      tool_use_id: "tu-226-exec-4",
      prompt: "[dispatch-class:exec-0p] исполнитель отработал на glm-5.3",
      description: "exec",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "glm-5.3",
    })
    expect(exec.agentId).toBe("ag-226-exec-4")

    const scout = await $.agent.spawn({
      tool_use_id: "tu-226-scout-4",
      prompt: "[dispatch-class:scout-enum] перечислить находки",
      description: "scout",
      subagentType: "grok-scout",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(scout.agentId).toBe("ag-226-scout-4")

    const res = await settleStep($.turn.step({
      turnId: "turn-226-4", index: 0, model: "busy-model", messageCount: 1,
      agentId: scout.agentId,
    }))

    expect(res && res.answer, "работа скаута не встала").toBe("from-glm-5.3")
    expect(seen, "лестница постороннего класса НЕ фильтруется: следующая ступень -- glm-5.3").toEqual(["busy-model", "glm-5.3"])

    const lines = failoverLines(kept)
    expect(lines).toHaveLength(2)
    expect(lines[1].modelRequested).toBe("glm-5.3")
    expect(lines[1].rungsFiltered, "полей фильтрации у постороннего класса нет").toBe(undefined)
    expect(lines[1].ladderFullTaken).toBe(undefined)
    expect(lines[1].startMatch).toBe(undefined)
  })

  test("#226 зуб 5: /clear очищает накопитель — прежние модели исполнителей не влияют", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 150_000_000, {}, {
      [HOME + "/probes.toml"]: failover226Toml('["glm-5.3", "grok-4.6"]'),
    })
    const seen: string[] = []
    on("agent.spawn", (_$, e) => {
      const exec = String(e.prompt).indexOf("[dispatch-class:exec-0p]") >= 0
      return exec
        ? { model: "glm-5.3", agentId: "ag-226-exec-5" }
        : { model: "busy-model", agentId: "ag-226-crit-5" }
    })
    on("turn.step", refusingFirst(seen))
    on("command.run", { command: "clear" }, () => ({ text: "cleared" }))

    const exec = await $.agent.spawn({
      tool_use_id: "tu-226-exec-5",
      prompt: "[dispatch-class:exec-0p] исполнитель отработал на glm-5.3",
      description: "exec",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "glm-5.3",
    })
    expect(exec.agentId).toBe("ag-226-exec-5")

    const crit = await $.agent.spawn({
      tool_use_id: "tu-226-crit-5",
      prompt: "[dispatch-class:crit-mech] проверить работу исполнителя",
      description: "crit",
      subagentType: "gpt6-critic",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(crit.agentId).toBe("ag-226-crit-5")

    const first = await settleStep($.turn.step({
      turnId: "turn-226-5a", index: 0, model: "busy-model", messageCount: 1,
      agentId: crit.agentId,
    }))
    expect(first && first.answer, "до /clear совпадение вычеркнуто из лестницы").toBe("from-grok-4.6")
    expect(seen).toEqual(["busy-model", "grok-4.6"])

    const cleared = await $.command.run({ command: "clear", args: "" })
    expect(cleared).toEqual({ text: "cleared" })

    // /clear сносит и привязки: проверяющего надо перезавести.
    const critAgain = await $.agent.spawn({
      tool_use_id: "tu-226-crit-5b",
      prompt: "[dispatch-class:crit-mech] проверить работу исполнителя заново",
      description: "crit",
      subagentType: "gpt6-critic",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(critAgain.agentId).toBe("ag-226-crit-5")

    const second = await settleStep($.turn.step({
      turnId: "turn-226-5b", index: 0, model: "busy-model", messageCount: 1,
      agentId: critAgain.agentId,
    }))
    expect(second && second.answer, "после /clear накопитель пуст: годна и glm-5.3").toBe("from-glm-5.3")
    expect(seen, "полная история обеих шагов").toEqual(["busy-model", "grok-4.6", "busy-model", "glm-5.3"])

    const lines = failoverLines(kept)
    expect(lines).toHaveLength(4)
    expect(lines[1].rungsFiltered, "до /clear одна ступень отфильтрована").toBe(1)
    expect(lines[3].rungsFiltered, "после /clear фильтровать нечем").toBe(0)
    expect(lines[3].modelRequested).toBe("glm-5.3")
  })

  test("#226 зуб 6: липкость не ставится на ступень-совпадение", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 160_000_000, {}, {
      [HOME + "/probes.toml"]: failover226Toml('["glm-5.3"]'),
    })
    const seen: string[] = []
    on("agent.spawn", (_$, e) => {
      const exec = String(e.prompt).indexOf("[dispatch-class:exec-0p]") >= 0
      return exec
        ? { model: "glm-5.3", agentId: "ag-226-exec-6" }
        : { model: "busy-model", agentId: "ag-226-crit-6" }
    })
    on("turn.step", refusingFirst(seen))

    const exec = await $.agent.spawn({
      tool_use_id: "tu-226-exec-6",
      prompt: "[dispatch-class:exec-0p] исполнитель отработал на glm-5.3",
      description: "exec",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "glm-5.3",
    })
    expect(exec.agentId).toBe("ag-226-exec-6")

    const crit = await $.agent.spawn({
      tool_use_id: "tu-226-crit-6",
      prompt: "[dispatch-class:crit-mech] проверить работу исполнителя",
      description: "crit",
      subagentType: "gpt6-critic",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(crit.agentId).toBe("ag-226-crit-6")

    const first = await settleStep($.turn.step({
      turnId: "turn-226-6a", index: 0, model: "busy-model", messageCount: 1,
      agentId: crit.agentId,
    }))
    expect(first && first.answer, "первый шаг дошёл до совпадения откатом на полную лестницу").toBe("from-glm-5.3")

    const second = await settleStep($.turn.step({
      turnId: "turn-226-6b", index: 0, model: "busy-model", messageCount: 1,
      agentId: crit.agentId,
    }))
    expect(second && second.answer).toBe("from-glm-5.3")
    expect(seen, "второй шаг начинается с ИСХОДНОЙ модели, а не с прилипшего совпадения").toEqual([
      "busy-model", "glm-5.3", "busy-model", "glm-5.3",
    ])
  })

  test("#226 зуб 7: липкая ступень снимается, когда модель ПОЗЖЕ стала моделью исполнителя", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 170_000_000, {}, {
      [HOME + "/probes.toml"]: failover226Toml('["grok-4.6", "qwen3.8-flash"]'),
    })
    const seen: string[] = []
    on("agent.spawn", (_$, e) => {
      const exec = String(e.prompt).indexOf("[dispatch-class:exec-0p]") >= 0
      return exec
        ? { model: "grok-4.6", agentId: "ag-226-exec-7" }
        : { model: "busy-model", agentId: "ag-226-crit-7" }
    })
    on("turn.step", refusingFirst(seen))

    const crit = await $.agent.spawn({
      tool_use_id: "tu-226-crit-7",
      prompt: "[dispatch-class:crit-mech] проверить работу исполнителя",
      description: "crit",
      subagentType: "gpt6-critic",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "busy-model",
    })
    expect(crit.agentId).toBe("ag-226-crit-7")

    const first = await settleStep($.turn.step({
      turnId: "turn-226-7a", index: 0, model: "busy-model", messageCount: 1,
      agentId: crit.agentId,
    }))
    expect(first && first.answer, "накопитель пуст: липкость легально встала на grok-4.6").toBe("from-grok-4.6")

    const exec = await $.agent.spawn({
      tool_use_id: "tu-226-exec-7",
      prompt: "[dispatch-class:exec-0p] исполнитель отработал на grok-4.6",
      description: "exec",
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "grok-4.6",
    })
    expect(exec.agentId).toBe("ag-226-exec-7")

    seen.length = 0
    const second = await settleStep($.turn.step({
      turnId: "turn-226-7b", index: 0, model: "busy-model", messageCount: 1,
      agentId: crit.agentId,
    }))
    expect(second && second.answer, "липкость снята: шаг ушёл на оставшуюся ступень, не на модель исполнителя").toBe("from-qwen3.8-flash")
    expect(seen, "grok-4.6 не звалась ни первой, ни вовсе").toEqual(["busy-model", "qwen3.8-flash"])

    const lines = failoverLines(kept)
    const last = lines[lines.length - 1]
    expect(last && last.stickyDropped, "в улике: липкость снята на использовании").toBe(true)
    expect(last && last.modelRequested).toBe("qwen3.8-flash")
  })
})

// CONSTRAINT (#223): улику эффорта читают только зубы движкового маршрута
// ($.agent.spawn + $.turn.step + wired). Прямому вызову хука мир недоступен
// (измеренная граница харнеса: op-существительные отказаны).
describe("failover: объявленный эффорт ступени (#223)", () => {
  function effortToml(modelsLine: string): string {
    return [
      "[failover]",
      "enabled = true",
      "",
      "[failover.default]",
      "models = " + modelsLine,
      "",
    ].join("\n")
  }

  function failoverLines(kept: Kept): any[] {
    return kept.writes
      .filter(w => String(w.path).indexOf(HOME + "/failover/journal.jsonl.shard.") === 0)
      .map(w => JSON.parse(String(w.text)))
  }

  function spawnSpec(agentId: string, prompt: string, model: string) {
    return {
      tool_use_id: "tu-" + agentId,
      prompt,
      description: agentId,
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model,
    }
  }

  test("#223 зуб 1: эффорт доехал на реальном переходе", async ($, on) => {
    const kept = wired(on, 180_000_000, {}, {
      [HOME + "/probes.toml"]: effortToml('[{ model = "glm-5.3", effort = "high" }]'),
    })
    const seen: string[] = []
    const seenEffort: unknown[] = []
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "busy-model"),
      agentId: "ag-223-1",
    }))
    on("turn.step", async function* (_$, e) {
      seen.push(String(e.model))
      seenEffort.push(e.effort)
      if (e.model === "busy-model") {
        return {
          turnId: e.turnId, index: e.index, answer: "", toolUses: [],
          stopReason: null, usage: null,
        }
      }
      return {
        turnId: e.turnId, index: e.index, answer: "from-" + e.model, toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: e.model },
      }
    })

    const spawned = await $.agent.spawn(spawnSpec(
      "ag-223-1",
      "[dispatch-class:exec-0p] effort arrived",
      "busy-model",
    ))
    expect(spawned.agentId).toBe("ag-223-1")

    const res = await settleStep($.turn.step({
      turnId: "turn-223-1", index: 0, model: "busy-model",
      messageCount: 1, agentId: spawned.agentId,
    }))
    expect(res && res.answer, "ответ ступени после отказа носителя").toBe("from-glm-5.3")
    expect(seen, "переход на объявленную ступень").toEqual(["busy-model", "glm-5.3"])
    expect(seenEffort[1], "хук ступени ВИДИТ effort===high в событии").toBe("high")

    const lines = failoverLines(kept)
    const rung = lines.filter(l => l.modelRequested === "glm-5.3")[0]
    expect(rung && rung.rungEffortRequested, "улика несёт запрошенный эффорт").toBe("high")
  })

  test("#223 зуб 2: без объявления поле effort не трогаем", async ($, on) => {
    const kept = wired(on, 190_000_000, {}, {
      [HOME + "/probes.toml"]: effortToml('["glm-5.3", "grok-4.6"]'),
    })
    const seen: string[] = []
    const seenEffort: unknown[] = []
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "busy-model"),
      agentId: "ag-223-2",
    }))
    on("turn.step", async function* (_$, e) {
      seen.push(String(e.model))
      seenEffort.push(e.effort)
      if (e.model === "busy-model") {
        return {
          turnId: e.turnId, index: e.index, answer: "", toolUses: [],
          stopReason: null, usage: null,
        }
      }
      return {
        turnId: e.turnId, index: e.index, answer: "from-" + e.model, toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: e.model },
      }
    })

    const spawned = await $.agent.spawn(spawnSpec(
      "ag-223-2",
      "[dispatch-class:exec-0p] no declared effort",
      "busy-model",
    ))
    expect(spawned.agentId).toBe("ag-223-2")

    const res = await settleStep($.turn.step({
      turnId: "turn-223-2", index: 0, model: "busy-model",
      messageCount: 1, agentId: spawned.agentId, effort: "medium",
    }))
    expect(res && res.answer).toBe("from-glm-5.3")
    expect(seen).toEqual(["busy-model", "glm-5.3"])
    expect(seenEffort[0], "посланный эффорт на попытке 0").toBe("medium")
    expect(seenEffort[1], "на переходе поле effort идентично посланному").toBe("medium")

    const lines = failoverLines(kept)
    const rung = lines.filter(l => l.modelRequested === "glm-5.3")[0]
    expect(rung && rung.rungEffortRequested, "без объявления запрошенного эффорта в улике нет").toBe(undefined)
  })

  test("#223 зуб 3: попытка 0 не переписывается", async ($, on) => {
    wired(on, 200_000_000, {}, {
      [HOME + "/probes.toml"]: effortToml('[{ model = "busy-model", effort = "max" }, { model = "glm-5.3", effort = "high" }]'),
    })
    const seen: string[] = []
    const seenEffort: unknown[] = []
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "busy-model"),
      agentId: "ag-223-3",
    }))
    on("turn.step", async function* (_$, e) {
      seen.push(String(e.model))
      seenEffort.push(e.effort)
      if (e.model === "busy-model") {
        return {
          turnId: e.turnId, index: e.index, answer: "", toolUses: [],
          stopReason: null, usage: null,
        }
      }
      return {
        turnId: e.turnId, index: e.index, answer: "from-" + e.model, toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: e.model },
      }
    })

    const spawned = await $.agent.spawn(spawnSpec(
      "ag-223-3",
      "[dispatch-class:exec-0p] attempt 0 keeps host effort",
      "busy-model",
    ))
    expect(spawned.agentId).toBe("ag-223-3")

    const res = await settleStep($.turn.step({
      turnId: "turn-223-3", index: 0, model: "busy-model",
      messageCount: 1, agentId: spawned.agentId, effort: "low",
    }))
    expect(res && res.answer).toBe("from-glm-5.3")
    expect(seen).toEqual(["busy-model", "glm-5.3"])
    expect(seenEffort[0], "попытка 0 идёт исходным эффортом события, не реестра").toBe("low")
    expect(seenEffort[1], "на реальном переходе объявленный эффорт доезжает").toBe("high")
  })

  test("#223 зуб 4: негодное значение — ступень зовётся, эффорт не применён", async ($, on) => {
    const kept = wired(on, 210_000_000, {}, {
      [HOME + "/probes.toml"]: effortToml('[{ model = "glm-5.3", effort = "High" }]'),
    })
    const seen: string[] = []
    const seenEffort: unknown[] = []
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "busy-model"),
      agentId: "ag-223-4",
    }))
    on("turn.step", async function* (_$, e) {
      seen.push(String(e.model))
      seenEffort.push(e.effort)
      if (e.model === "busy-model") {
        return {
          turnId: e.turnId, index: e.index, answer: "", toolUses: [],
          stopReason: null, usage: null,
        }
      }
      return {
        turnId: e.turnId, index: e.index, answer: "from-" + e.model, toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: e.model },
      }
    })

    const spawned = await $.agent.spawn(spawnSpec(
      "ag-223-4",
      "[dispatch-class:exec-0p] invalid effort value",
      "busy-model",
    ))
    expect(spawned.agentId).toBe("ag-223-4")

    const res = await settleStep($.turn.step({
      turnId: "turn-223-4", index: 0, model: "busy-model",
      messageCount: 1, agentId: spawned.agentId, effort: "low",
    }))
    expect(res && res.answer, "ступень с негодным эффортом всё равно зовётся").toBe("from-glm-5.3")
    expect(seen).toEqual(["busy-model", "glm-5.3"])
    expect(seenEffort[1], "негодное значение не применено").toBe("low")

    const lines = failoverLines(kept)
    const rung = lines.filter(l => l.modelRequested === "glm-5.3")[0]
    expect(rung && rung["effortBad_glm-5.3"],
      "в улике поле эффорт негоден с именем модели").toBe("High")
    expect(rung && rung.rungEffortRequested, "негодное не выдаётся за запрошенное").toBe(undefined)
  })

  test("#223 зуб 5: неразобранный элемент (объект без model, пустая строка) отбрасывается СО СЧЁТЧИКОМ", async ($, on) => {
    const kept = wired(on, 220_000_000, {}, {
      [HOME + "/probes.toml"]: effortToml('[{ effort = "high" }, "", "glm-5.3"]'),
    })
    const seen: string[] = []
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "busy-model"),
      agentId: "ag-223-5",
    }))
    on("turn.step", async function* (_$, e) {
      seen.push(String(e.model))
      if (e.model === "busy-model") {
        return {
          turnId: e.turnId, index: e.index, answer: "", toolUses: [],
          stopReason: null, usage: null,
        }
      }
      return {
        turnId: e.turnId, index: e.index, answer: "from-" + e.model, toolUses: [],
        stopReason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2, model: e.model },
      }
    })

    const spawned = await $.agent.spawn(spawnSpec(
      "ag-223-5",
      "[dispatch-class:exec-0p] object without model dropped",
      "busy-model",
    ))
    expect(spawned.agentId).toBe("ag-223-5")

    const res = await settleStep($.turn.step({
      turnId: "turn-223-5", index: 0, model: "busy-model",
      messageCount: 1, agentId: spawned.agentId,
    }))
    expect(res && res.answer, "лестница работает из оставшихся").toBe("from-glm-5.3")
    expect(seen).toEqual(["busy-model", "glm-5.3"])

    const lines = failoverLines(kept)
    expect(lines.length, "есть улика перехода").toBeGreaterThan(0)
    // Счётчик берёт ЛЮБОЙ неразобранный элемент: объект без model И пустую
    // строку. Считать только объекты значило бы оставить тот же молчаливый
    // пропуск для прочих опечаток реестра.
    expect(lines[0].rungsDropped, "в улике счётчик отброшенных").toBe(2)
  })
})

// CONSTRAINT (#227-A): зубы свёртки идут движковым маршрутом ($.turn.step +
// wired), потому что прямому вызову хука op-существительные отказаны.
// Таймерные зубы двигают mock.clock — `claude plugin test` для clock.every
// моковая среда (измерено #175: «no implementation for clock.every»); живое
// поведение every уже снято отдельной пробой и здесь не переоткрывается.
describe("failover: свёртка скучных улик (#227-A)", () => {
  function foldToml(): string {
    return [
      "[failover]",
      "enabled = true",
      "",
      "[failover.default]",
      'models = ["glm-5.3", "grok-4.6"]',
      "",
    ].join("\n")
  }

  function foldShards(kept: Kept): Args<"fs.write">[] {
    return kept.writes.filter(w =>
      String(w.path).indexOf(HOME + "/failover/journal.jsonl.shard.") === 0)
  }

  function foldLines(kept: Kept): any[] {
    return foldShards(kept).map(w => JSON.parse(String(w.text)))
  }

  function spawnSpec(agentId: string) {
    return {
      tool_use_id: "tu-" + agentId,
      prompt: "[dispatch-class:exec-0p] fold boring",
      description: agentId,
      subagentType: "glm-executor",
      provider: { plugin: "engine", tier: "core" },
      parentModel: "claude-sonnet-5",
      permissionMode: "default",
      background: false,
      fork: false,
      model: "glm-5.3",
    }
  }

  function okBody(e: any) {
    return {
      turnId: e.turnId, index: e.index, answer: "from-" + e.model, toolUses: [],
      stopReason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 2, model: e.model },
    }
  }

  function emptyBody(e: any) {
    return {
      turnId: e.turnId, index: e.index, answer: "", toolUses: [],
      stopReason: null, usage: null,
    }
  }

  test("#227-A зуб 1: скучный шаг файла не создаёт", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 230_000_000, {}, { [HOME + "/probes.toml"]: foldToml() })
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "glm-5.3"),
      agentId: "ag-227a-1",
    }))
    on("turn.step", async function* (_$, e) { return okBody(e) })
    const spawned = await $.agent.spawn(spawnSpec("ag-227a-1"))
    expect(spawned.agentId).toBe("ag-227a-1")
    await settleStep($.turn.step({
      turnId: "turn-227a-1a", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    const afterSticky = foldShards(kept).length
    const res = await settleStep($.turn.step({
      turnId: "turn-227a-1b", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    expect(res && res.answer).toBe("from-glm-5.3")
    expect(foldShards(kept).length, "скучный ok без лестницы файла не создаёт").toBe(afterSticky)
  })

  test("#227-A зуб 2: полная улика сбрасывает агрегат ПЕРЕД собой", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 231_000_000, {}, { [HOME + "/probes.toml"]: foldToml() })
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "glm-5.3"),
      agentId: "ag-227a-2",
    }))
    let n = 0
    on("turn.step", async function* (_$, e) {
      n++
      if (n <= 3) return okBody(e)
      if (e.model === "glm-5.3") return emptyBody(e)
      return okBody(e)
    })
    const spawned = await $.agent.spawn(spawnSpec("ag-227a-2"))
    await settleStep($.turn.step({
      turnId: "turn-227a-2a", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    const afterSticky = foldShards(kept).length
    await settleStep($.turn.step({
      turnId: "turn-227a-2b", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    await settleStep($.turn.step({
      turnId: "turn-227a-2c", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    expect(foldShards(kept).length, "два скучных шага файлов не создали").toBe(afterSticky)

    await settleStep($.turn.step({
      turnId: "turn-227a-2d", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    const lines = foldLines(kept)
    const rest = lines.slice(afterSticky)
    expect(rest.length, "агрегат + отказ + переход").toBe(3)
    expect(rest[0].fold, "первая запись каталога после скучных — агрегат").toBe(true)
    expect(rest[0].n, "агрегат унёс оба скучных шага").toBe(2)
    expect(rest[1].outcome).toBe("empty")
    expect(rest[2].outcome).toBe("ok")
    expect(rest[2].laddered).toBe(true)
  })

  test("#227-A зуб 3: тик мок-часов пишет один агрегатный шард с верным n", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 232_000_000, {}, { [HOME + "/probes.toml"]: foldToml() })
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "glm-5.3"),
      agentId: "ag-227a-3",
    }))
    on("turn.step", async function* (_$, e) { return okBody(e) })
    const spawned = await $.agent.spawn(spawnSpec("ag-227a-3"))
    await settleStep($.turn.step({
      turnId: "turn-227a-3a", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    const afterSticky = foldShards(kept).length
    await settleStep($.turn.step({
      turnId: "turn-227a-3b", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    await settleStep($.turn.step({
      turnId: "turn-227a-3c", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    expect(foldShards(kept).length).toBe(afterSticky)
    await kept.clock!.advance(FAILOVER_FOLD_PERIOD_MS)
    const rest = foldLines(kept).slice(afterSticky)
    expect(rest, "один агрегатный шард").toHaveLength(1)
    expect(rest[0].fold, "агрегат отличим полем fold").toBe(true)
    expect(rest[0].n).toBe(2)
    expect(rest[0].sticky, "агрегат называет липкую ступень").toBe("glm-5.3")
  })

  test("#227-A зуб 4: тик при нулевом счётчике файла не создаёт", async ($, on) => {
    sessionExecutorsReset()
    const kept = wired(on, 233_000_000, {}, { [HOME + "/probes.toml"]: foldToml() })
    on("agent.spawn", (_$, e) => ({
      model: String((e && e.model) || "glm-5.3"),
      agentId: "ag-227a-4",
    }))
    on("turn.step", async function* (_$, e) { return okBody(e) })
    const spawned = await $.agent.spawn(spawnSpec("ag-227a-4"))
    await settleStep($.turn.step({
      turnId: "turn-227a-4a", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    await settleStep($.turn.step({
      turnId: "turn-227a-4b", index: 0, model: "glm-5.3",
      messageCount: 1, agentId: spawned.agentId,
    }))
    await kept.clock!.advance(FAILOVER_FOLD_PERIOD_MS)
    const lines = foldLines(kept)
    const folds = lines.filter((l: any) => l.fold === true)
    expect(folds, "первый тик унёс накопленное").toHaveLength(1)
    expect(folds[0].n).toBe(1)
    const afterFirst = foldShards(kept).length
    await kept.clock!.advance(FAILOVER_FOLD_PERIOD_MS)
    expect(foldShards(kept).length, "второй тик при нуле не пишет").toBe(afterFirst)
  })
})
