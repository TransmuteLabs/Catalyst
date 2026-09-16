// Behavior teeth for plugins/catalyst-probes on the official harness
// (`claude plugin test`): each of the mod's five subscribed events is driven
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
function wired(
  on: On,
  now: number,
  env: Record<string, string>,
  files: Record<string, string>,
  stored: Record<string, unknown> = {},
  answers: string[] = [],
): Kept {
  mock.clock(on, { now })
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

  on("model.complete", (_$, e) => {
    kept.completes.push(e)
    const answer = answers.shift()
    if (answer === undefined) {
      throw new Error("model.complete: no answer scripted for " + e.model)
    }
    return { value: answer }
  })

  on("session.id", () => ({ value: SID }))
  on("session.messages", () => ({ value: [] }))
  on("agent.list", () => ({ value: [] }))
  on("ui.toast", (_$, e) => {
    kept.toasts.push(e.text)
    return { value: undefined }
  })

  return kept
}

describe("session.start", () => {
  test("sweeps the judge's stale verdict keys only, and notes the cwd", async ($, on) => {
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

    const keys = kept.store.keys()
    expect(keys, "past ttl and formless keys are gone").not.toContain("v:judge:stale")
    expect(keys).not.toContain("v:judge:no-t")
    expect(keys, "a live verdict stays").toContain("v:judge:fresh")
    expect(keys, "a foreign key is never touched").toContain("v:other:x")
    expect(kept.store.deletes).toEqual(["v:judge:stale", "v:judge:no-t"])

    const sweep = kept.writes.find(w =>
      w.path.startsWith(HOME + "/judge/journal.jsonl.shard."),
    )
    expect(sweep?.text).toContain('"outcome":"store_sweep"')
    expect(sweep?.text).toContain('"removed":2')
    expect(sweep?.text).toContain('"scanned":3')
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

    // the consult left its record and its journal line
    const record = kept.writes.find(w => /\/judge\/records\/mod-[\w.-]+\.json$/.test(w.path))
    expect(record?.text).toContain('"kind":"BLOCK"')
    expect(record?.text).toContain('"carrier":"mod"')
    expect(record?.text).toContain('"mod":"' + MOD_VERSION + '"')
    const journal = kept.writes.find(w =>
      w.path.startsWith(HOME + "/judge/journal.jsonl.shard."),
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
