// Behavior teeth for plugins/catalyst-probes on the official harness
// (`claude plugin test`): each of the mod's six subscribed events is driven
// through the engine's `$`, and the assertions check both what the handler
// answered and which `$` calls it made (fs.write paths, store, model.complete).
//
// CONSTRAINT: the mod memoises its world for 5000 ms of clock time (worldFor),
// and the runner keeps one process per file, so every world-reading test here
// starts its clock 6000 ms past the previous one — otherwise a test would read
// the world its neighbour loaded.
import { describe, expect, mock, test } from "claude-code/testing"
import type { Args, On } from "claude-code"

// CONSTRAINT: версия берётся импортом, а не литералом: дом версии — register.ts
// и .claude-plugin/plugin.json, их сверяет tests/scripts/test-mod-units.sh.
import { MOD_VERSION, verdictKey } from "../hooks/register.ts"

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
  answers: string[] = [],
  opts: WiredOpts = {},
): Kept {
  // The harness refuses a second on("clock.now"), so an outage tooth takes
  // over the clock entirely: the mod reads $.clock.now() and nothing else.
  if (opts.clockBreak) {
    on("clock.now", () => (opts.clockBreak && opts.clockBreak()
      ? { deny: "clock.now: scripted outage" }
      : { value: now }))
  } else {
    mock.clock(on, { now })
  }
  mock.env(on, { CLAUDE_PROBES_DIR: HOME, PWD: "/work", ...env })
  const store = storeOf(on, stored)

  const kept: Kept = { writes: [], reads: [], completes: [], toasts: [], store }

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
    const record = kept.writes.find(w => /\/judge\/records\/mod-[\w.-]+\.json$/.test(w.path))
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
    const record = kept.writes.find(w => /\/judge\/records\/mod-[\w.-]+\.json$/.test(w.path))
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
    const record = kept.writes.find(w => /\/judge\/records\/mod-[\w.-]+\.json$/.test(w.path))
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

    const records = kept.writes
      .filter(w => /\/judge\/records\/mod-[\w.-]+\.json$/.test(w.path))
      .map(w => JSON.parse(String(w.text)))
    expect(records).toHaveLength(2)
    expect(records[0].clockBad, "the outage is seen in the first session").toBe(true)
    expect(records[1].clockBad, "the flag died with the session").toBeUndefined()
  })
})
