import { test, expect } from "claude-code/testing"
import { register, RULE_TEXT } from "../hooks/register.ts"
import * as reg from "../hooks/register.ts"

const PIN = "4db6139512a61d07f935e0c3b95b6b97f61ab98ed96b2037c40ec9bc27b8b65f"
const VERSION = "2.1.285"
const HOME = "/fixture-home"
const DIR = HOME + "/.local/share/catalyst-cc/passports/"
const IMAGE = HOME + "/.local/share/claude/versions/" + VERSION

function capture() {
  const hooks: Record<string, any> = {}
  const registrations: string[] = []
  register((event: string, a: any, b?: any) => {
    registrations.push(event)
    hooks[event] = b ?? a
  })
  return { hooks, registrations }
}

function passport(overrides: any = {}) {
  return {
    version: VERSION, platform: "linux", size: 42, mtime_ms: 123,
    step26: { applied: true, rule_sha256: PIN }, ...overrides,
  }
}

function missing() {
  return Object.assign(new Error("ENOENT: missing fixture"), { code: "ENOENT" })
}

function fixture(o: any = {}) {
  const captured = capture()
  const logs: Array<[string, any]> = []
  const calls = { version: 0, list: [] as string[], read: [] as string[], stat: [] as string[], settings: 0, latchAtLog: null as boolean | null }
  let inStart = false
  const $: any = {
    env: { async get(name: string) { return name === "HOME" ? (o.home ?? HOME) : o.unset ? undefined : o.env === undefined ? "on" : o.env } },
    session: { async version() { calls.version++; return { version: o.version ?? VERSION } } },
    fs: {
      async list(path: string) {
        calls.list.push(path)
        if (o.listError) throw o.listError
        return (o.names ?? [VERSION + "-linux.json"]).map((name: string) => ({ name, kind: "file", size: 1 }))
      },
      async read(path: string) {
        calls.read.push(path)
        if (o.readError) throw o.readError
        return o.raw ?? JSON.stringify(o.passport ?? passport())
      },
      async stat(path: string) {
        calls.stat.push(path)
        if (o.statError) throw o.statError
        return { kind: "file", size: 42, mtimeMs: 123, ...o.stat }
      },
    },
    settings: {
      async read() {
        calls.settings++
        expect(inStart, "seat-probe-shape: read is awaited inside session.start").toBe(true)
        if (o.readSettings) return o.readSettings($, captured.hooks)
        if (o.rejectProbe) throw new Error("probe-rejected")
        if (!o.seated && captured.hooks["settings.read"]) {
          let synchronous = false
          const next: any = () => {
            synchronous = true
            return { value: {} }
          }
          next.origin = { plugin: "catalyst-refusal-watch", tier: "user" }
          const result = captured.hooks["settings.read"]($, {}, next)
          expect(synchronous, "seat-probe-shape: observer forwards synchronously").toBe(true)
          await result
        }
        return {}
      },
    },
    ui: {
      log(text: string, options?: any) {
        logs.push([text, options])
        if ((o.logThrows || o.logRejects) && !options && text.includes("user tier")) {
          calls.latchAtLog = (reg as any).__snapshot569().diagnosed.some((key: string) => key.split(":")[0] === "D4")
        }
        if (o.logThrows && !options) throw new Error("log-failed")
        if (o.logRejects && !options) return Promise.reject(new Error("log-rejected"))
      },
    },
  }
  return {
    ...captured, $, calls, logs,
    async start(onNext?: () => void) {
      expect(typeof captured.hooks["session.start"], "seat-probe-shape: separate session.start registration exists").toBe("function")
      inStart = true
      try {
        const sentinel = { started: true }
        const out = await captured.hooks["session.start"]($, { cwd: "/fixture", surface: "terminal", isInteractive: false }, () => { onNext?.(); return sentinel })
        expect(out, "seat-probe-shape: start result is transparent").toBe(sentinel)
      } finally { inStart = false }
    },
    async context(blocks: any[] = []) {
      return captured.hooks["prompt.context"]($, {}, async () => ({ blocks }))
    },
    async end(reason = "clear") {
      const sentinel = { sessionId: "new-session" }
      const out = await captured.hooks["session.end"]($, { reason, sessionId: "old-session", resume: false }, () => sentinel)
      expect(out, "module-clear-retains: session.end forwards unchanged").toBe(sentinel)
    },
  }
}

const rules = (out: any) => out.blocks.filter((b: any) => b?.text === RULE_TEXT)
const named = (out: any) => out.blocks.filter((b: any) => b?.name === "refusalHandling")
const lines = (f: any, text: string) => f.logs.filter(([s]: any) => s.includes(text))

for (const env of ["", "0", "false", "no", "off", " OFF ", null]) {
  test("env-off-569 " + String(env), async () => {
    const f = fixture({ env })
    expect(rules(await f.context()).length, "env-off-569: disabled switch must not insert RULE_TEXT").toBe(0)
  })
}
for (const env of ["1", "true", "yes", "on", " On "]) {
  test("env-on-569 " + env, async () => {
    const f = fixture({ env })
    expect(rules(await f.context()).length, "env-on-569: explicit on inserts RULE_TEXT").toBe(1)
  })
}
test("env-unset-569", async () => {
  const f = fixture({ unset: true })
  expect(rules(await f.context()).length, "env-unset-569: absent switch must not insert RULE_TEXT").toBe(0)
})
test("env-unknown-569", async () => {
  const f = fixture({ env: "unexpected" })
  expect(rules(await f.context()).length, "env-unknown-569: unknown switch must not insert").toBe(0)
  expect(lines(f, "CLAUDE_REFUSAL_WATCH").length, "env-unknown-569: named diagnostic").toBe(1)
})

test("passport-reader valid and cached", async () => {
  const f = fixture()
  await f.start()
  expect(rules(await f.context()).length, "passport-reader: valid passport suppresses fallback").toBe(0)
  await f.context()
  await f.start()
  expect(f.calls.version, "passport-reader: version read once per environment").toBe(1)
  expect(f.calls.list, "passport-reader: expanded HOME directory read once").toEqual([DIR])
  expect(f.calls.read, "passport-reader: selected namespace file read once").toEqual([DIR + VERSION + "-linux.json"])
  expect(f.calls.stat, "passport-reader: only canonical file is checked").toEqual([IMAGE])
  expect(f.calls.settings, "passport-reader: probe once per environment").toBe(1)
})
for (const [label, value] of [
  ["unapplied", passport({ step26: { applied: false, rule_sha256: PIN } })],
  ["hash", passport({ step26: { applied: true, rule_sha256: "bad" } })],
  ["version", passport({ version: "2.1.284" })],
] as const) {
  test("passport-reader " + label, async () => {
    const f = fixture({ passport: value })
    await f.start()
    expect(rules(await f.context()).length, "passport-reader: " + label + " must not suppress fallback").toBe(1)
    if (label === "version") expect(lines(f, "passport-read").length, "passport-reader: version mismatch is diagnosed").toBe(1)
  })
}
for (const [label, stat] of [["size", { size: 43, mtimeMs: 123 }], ["mtime", { size: 42, mtimeMs: 125 }]] as const) {
  test("passport-stale " + label, async () => {
    const f = fixture({ stat, seated: true })
    await f.start()
    expect(rules(await f.context()).length, "passport-stale: " + label + " mismatch delivers fallback").toBe(1)
    await f.end(); await f.context(); await f.start()
    expect(lines(f, "passport-stale " + JSON.stringify(VERSION)).length, "passport-stale: diagnostic once through clear").toBe(1)
    expect((reg as any).__snapshot569().diagnosed.some((key: string) => key.split(":")[0] === "passport-stale"), "passport-stale: once latch is retained through clear").toBe(true)
  })
}
test("passport-canonical-missing R8", async () => {
  const f = fixture({ statError: missing() })
  await f.start()
  expect(rules(await f.context()).length, "passport-canonical-missing: fallback is delivered").toBe(1)
  await f.end(); await f.start()
  expect(lines(f, "passport-stale " + JSON.stringify(VERSION)).length, "passport-canonical-missing: one stale diagnostic").toBe(1)
  expect(f.calls.stat, "passport-canonical-missing: never substitutes another file").toEqual([IMAGE])
})
for (const [label, options] of [
  ["malformed", { raw: "{" }], ["unreadable", { readError: new Error("read-denied") }],
  ["stat-denied", { statError: new Error("stat-denied") }], ["list-denied", { listError: new Error("list-denied") }],
] as const) {
  test("passport-read-error " + label, async () => {
    const f = fixture(options); await f.start()
    expect(rules(await f.context()).length, "passport-read-error: fallback on " + label).toBe(1)
    expect(lines(f, "passport-read").length, "passport-read-error: named diagnostic on " + label).toBe(1)
  })
}
test("passport-ambiguous R9", async () => {
  const f = fixture({ names: [VERSION + "-linux.json", VERSION + "-darwin.json"] })
  await f.start(); await f.end(); await f.start()
  expect(rules(await f.context()).length, "passport-ambiguous: never chooses first passport").toBe(1)
  expect(lines(f, "passport-ambiguous " + JSON.stringify(VERSION)).length, "passport-ambiguous: one diagnostic per environment").toBe(1)
  expect(f.calls.read.length, "passport-ambiguous: no arbitrary read").toBe(0)
})
test("passport-platform-mismatch R9", async () => {
  const f = fixture({ passport: passport({ platform: "darwin" }) }); await f.start()
  expect(rules(await f.context()).length, "passport-platform-mismatch: fallback is delivered").toBe(1)
  expect(lines(f, "passport-read").length, "passport-platform-mismatch: parse diagnostic").toBe(1)
})
test("passport-directory-missing R9", async () => {
  const f = fixture({ listError: missing() }); await f.start()
  expect(rules(await f.context()).length, "passport-directory-missing: fallback is delivered").toBe(1)
  expect(lines(f, "passport-").length, "passport-directory-missing: absence is not a read failure").toBe(0)
})
test("passport-name-exact R9", async () => {
  for (const name of ["2x1x285-linux.json", VERSION + "-.json", VERSION + "-LINUX.json", VERSION + "-linux.json.bak", "prefix-" + VERSION + "-linux.json"]) {
    const f = fixture({ names: [name] })
    await f.start()
    expect(rules(await f.context()).length, "passport-name-exact: no fuzzy namespace match").toBe(1)
    expect(f.calls.read.length, "passport-name-exact: no wrong file read").toBe(0)
  }
})

test("refusal-idempotent full literal in another block", async () => {
  const f = fixture()
  const other = { name: "other", text: "prefix\n" + RULE_TEXT + "\nsuffix" }
  const out = await f.context([other])
  expect(out.blocks, "refusal-idempotent: full literal in any block suppresses insertion").toEqual([other])
  expect(out.blocks[0], "refusal-idempotent: existing object is preserved").toBe(other)
})
test("refusal-idempotent stale and duplicates", async () => {
  const f = fixture()
  const other = { name: "other", text: "unchanged" }
  const out = await f.context([{ name: "refusalHandling", text: RULE_TEXT.slice(0, -1) }, other, { name: "refusalHandling", text: "old" }])
  expect(named(out)[0]?.text, "refusal-idempotent: stale text is not canonical").toBe(RULE_TEXT)
  expect(named(out).length, "refusal-idempotent: duplicate own names are removed").toBe(1)
  expect(out.blocks[1], "refusal-idempotent: unrelated block is preserved").toBe(other)
})
test("refusal-idempotent canonical duplicate after stale", async () => {
  const f = fixture()
  const before = { name: "before", text: "keep-before" }
  const between = { name: "between", text: "keep-between" }
  const canonical = { name: "refusalHandling", text: "prefix " + RULE_TEXT, metadata: "canonical" }
  const out = await f.context([before, { name: "refusalHandling", text: "stale" }, between, canonical])
  expect(out.blocks[1], "refusal-idempotent: first canonical occupies first named position").toBe(canonical)
  expect(named(out).length, "refusal-idempotent: duplicate cleanup still leaves one own block").toBe(1)
  expect(out.blocks[2], "refusal-idempotent: unrelated order stays unchanged").toBe(between)
  expect(out.blocks[0], "refusal-idempotent: unrelated prefix stays unchanged").toBe(before)
  expect(out.blocks[1].text.indexOf(RULE_TEXT) >= 0, "refusal-idempotent: cleanup must not remove the only full RULE_TEXT").toBe(true)
})
test("refusal-idempotent exact own block retains metadata", async () => {
  const f = fixture()
  const block = { name: "refusalHandling", text: RULE_TEXT, metadata: "keep" }
  const other = { name: "other", text: "keep" }
  const out = await f.context([other, block, { name: "refusalHandling", text: "old" }])
  expect(named(out).length, "refusal-idempotent: exact block still cleans duplicates").toBe(1)
  expect(named(out)[0], "refusal-idempotent: no replacement of exact block").toBe(block)
  expect(out.blocks[1], "refusal-idempotent: full-before-stale retains first named position").toBe(block)
  expect(out.blocks[0], "refusal-idempotent: unrelated prefix remains").toBe(other)
})

test("seat-probe-shape separate registrations", async () => {
  const f = fixture({ names: [] })
  expect(f.registrations.filter((s) => s === "session.start").length, "seat-probe-shape: one start registration").toBe(1)
  expect(f.registrations.filter((s) => s === "settings.read").length, "seat-probe-shape: one separate observer").toBe(1)
  await f.start()
  expect(f.calls.settings, "seat-probe-shape: explicit probe call").toBe(1)
  expect(lines(f, "user tier").length, "seat-probe-shape: own observer confirms unseated").toBe(0)
})
test("seat-probe-shape ignores foreign origin", async () => {
  const f = fixture({ names: [], readSettings: async ($: any, h: any) => {
    const next: any = () => ({ value: {} })
    next.origin = { plugin: "foreign-plugin", tier: "user" }
    await h["settings.read"]($, {}, next)
    return {}
  } })
  await f.start()
  expect(lines(f, "user tier").length, "seat-probe-shape: foreign read cannot mask seating").toBe(1)
})
test("seat-probe-shape ignores outside window", async () => {
  const f = fixture({ seated: true, names: [] })
  expect(typeof f.hooks["settings.read"], "seat-probe-shape: observer exists").toBe("function")
  const next: any = () => ({ value: {} }); next.origin = { plugin: "catalyst-refusal-watch", tier: "user" }
  await f.start()
  const before = (reg as any).__snapshot569()
  await f.hooks["settings.read"](f.$, {}, next)
  expect((reg as any).__snapshot569(), "seat-probe-shape: outside-window after start cannot change state").toEqual(before)
  expect(lines(f, "user tier").length, "seat-probe-shape: out-of-window read cannot mask seating").toBe(1)
})
test("seat-probe-causality rejected read", async () => {
  const f = fixture({ rejectProbe: true, names: [] }); await f.start()
  expect(lines(f, "доставка не подтверждена наблюдением").length, "seat-probe-causality: refusal is unconfirmed").toBe(1)
  expect(lines(f, "user tier").length, "seat-probe-causality: rejection does not prove seating").toBe(0)
})
test("seat-probe-causality pending read", async () => {
  let finish!: () => void
  const f = fixture({ names: [], readSettings: () => new Promise<void>((resolve) => { finish = resolve }) })
  expect(typeof f.hooks["session.start"], "seat-probe-causality: separate start exists before pending call").toBe("function")
  const start = f.start()
  for (let i = 0; i < 100 && !finish; i++) await Promise.resolve()
  expect(typeof finish, "seat-probe-causality: read reached before pending assertion").toBe("function")
  expect(lines(f, "user tier").length, "seat-probe-causality: pending read is not seating").toBe(0)
  finish(); await start
  expect(lines(f, "user tier").length, "seat-probe-causality: settled unseen read proves seating").toBe(1)
})
test("delivery-observation-569 covered", async () => {
  const f = fixture({ seated: true }); await f.start()
  const d4 = lines(f, "user tier")
  expect(d4.length, "delivery-observation-569: one aggregate").toBe(1)
  expect(d4[0][0], "delivery-observation-569: covered rule is named").toContain("системный носитель подтверждён для RULE_TEXT")
  expect(d4[0][0], "delivery-observation-569: covered rule is not called lost").toContain("не доставлены нет")
})
test("delivery-observation-569 uncovered", async () => {
  const f = fixture({ seated: true, names: [] }); await f.start()
  expect(lines(f, "user tier").length, "delivery-observation-569: seating is named").toBe(1)
  expect(lines(f, "user tier")[0][0], "delivery-observation-569: context requirement is named").toContain("не доставлены RULE_TEXT (prompt.context)")
})
for (const mode of ["logThrows", "logRejects"]) {
  test("delivery-observation-569 " + mode, async () => {
    const f = fixture({ seated: true, names: [], [mode]: true })
    await f.start(); await f.end(); await f.start()
    expect(f.calls.latchAtLog, "delivery-observation-569: latch is set before channel invocation").toBe(true)
    expect(lines(f, "user tier").length, "delivery-observation-569: latch precedes logging failure").toBe(1)
    expect(lines(f, "канал").length > 0, "delivery-observation-569: channel failure is reported separately").toBe(true)
  })
}
test("module-state-retains R7a", async () => {
  const f = fixture({ seated: true }); await f.start()
  expect(typeof (reg as any).__snapshot569, "module-state-retains: environment snapshot seam exists").toBe("function")
  const before = (reg as any).__snapshot569()
  expect(before.seatProbeResult, "module-state-retains: probe verdict is seated").toBe("seated")
  expect(before.diagnosed.some((key: string) => key.split(":")[0] === "D4"), "module-state-retains: D4 latch precedes logging").toBe(true)
  await f.end("clear")
  expect((reg as any).__snapshot569(), "module-state-retains: clear retains passport/verdict/generation/latches").toEqual(before)
  await f.end("resume")
  expect((reg as any).__snapshot569(), "module-state-retains: resume retains environment state").toEqual(before)
})
test("module-clear-retains R7a", async () => {
  const f = fixture({ seated: true }); await f.start()
  await f.end("clear"); await f.start(); await f.end("resume"); await f.start()
  expect(f.calls.settings, "module-clear-retains: no reprobe on clear/resume").toBe(1)
  expect(f.calls.read.length, "module-clear-retains: passport is retained").toBe(1)
  expect(lines(f, "user tier").length, "module-clear-retains: aggregate latch is retained").toBe(1)
  expect(rules(await f.context()).length, "module-clear-retains: cached skip is retained").toBe(0)
})
test("module-reload-reprobes R7b", async () => {
  const old = fixture({ seated: true }); await old.start()
  const generation = (reg as any).__snapshot569().generation
  const fresh = fixture({ seated: true, names: [] }); await fresh.start()
  expect((reg as any).__snapshot569().generation > generation, "module-reload-reprobes: fresh register advances generation").toBe(true)
  expect(fresh.calls.settings, "module-reload-reprobes: new environment probes").toBe(1)
  expect(fresh.calls.version, "module-reload-reprobes: new environment reads passport").toBe(1)
  expect(lines(fresh, "user tier").length, "module-reload-reprobes: new environment owns latch").toBe(1)
  expect(rules(await fresh.context()).length, "module-reload-reprobes: old passport is not retained").toBe(1)
})
test("module-old-await R7c", async () => {
  let finish!: () => void
  const old = fixture({ seated: true, readSettings: () => new Promise<void>((resolve) => { finish = resolve }) })
  expect(typeof old.hooks["session.start"], "module-old-await: separate start exists before pending call").toBe("function")
  const pending = old.start()
  for (let i = 0; i < 100 && !finish; i++) await Promise.resolve()
  expect(typeof finish, "module-old-await: old probe is pending").toBe("function")
  const fresh = fixture({ names: [] }); await fresh.start()
  finish(); await pending
  expect(lines(old, "user tier").length, "module-old-await: stale generation cannot diagnose").toBe(0)
  expect(lines(fresh, "user tier").length, "module-old-await: old await cannot seat fresh environment").toBe(0)
  expect(rules(await fresh.context()).length, "module-old-await: old passport cannot suppress fresh fallback").toBe(1)
})

// CONSTRAINT: prepend fixtures are self-contained; only the six measured append doors are seated.
const seated = {
  name: "sec-default-569", tier: "prepend" as const,
  register(on: any) {
    on("classic.*", ($: any, e: any, next: any) => next.to(e, "append"))
    on("prompt.section", ($: any, e: any, next: any) => next.to(e, "append"))
    on("prompt.context", ($: any, e: any, next: any) => next.to(e, "append"))
    on("skill.prompt", ($: any, e: any, next: any) => next.to(e, "append"))
    on("attribution.text", ($: any, e: any, next: any) => next.to(e, "append"))
    on("settings.read", ($: any, e: any, next: any) => next.to(e, "append"))
  },
}
const sentinel = {
  name: "sentinel-569", tier: "user" as const,
  register(on: any) {
    on("settings.read", ($: any, e: any, next: any) => {
      if (next.origin.plugin === "catalyst-refusal-watch") $.ui.log("sentinel-569 own-read")
      return next(e)
    })
  },
}
for (const seat of [false, true]) {
  test("seated-native-chain-569 " + (seat ? "seated" : "unseated"), { plugins: seat ? [seated, sentinel] : [sentinel] }, async ($: any, on: any) => {
    const logs: string[] = []
    let bottom = 0
    let native = 0
    on("env.get", (_$: any, e: any) => ({ value: e.name === "HOME" ? HOME : "on" }))
    on("session.version", () => ({ value: { version: VERSION } }))
    on("fs.list", () => ({ value: [] }))
    on("settings.read", (_$: any, _e: any, next: any) => {
      if (next.origin.plugin === "catalyst-refusal-watch") bottom++
      return { value: {} }
    })
    on("ui.log", (_$: any, e: any) => { logs.push(e.text); return { value: undefined } })
    on("session.start", (_$: any, e: any) => ({ cwd: e.cwd }))
    on("turn.complete", () => { native++; return { text: "native-ok" } })
    on("prompt.context", () => ({ blocks: [] }))
    await $.session.start({ cwd: "/fixture", surface: "terminal", isInteractive: false })
    expect(bottom, "seated-native-chain-569: real nested settings.read reaches bottom").toBe(1)
    expect(logs.filter((s) => s.includes("sentinel-569 own-read")).length, "seated-native-chain-569: user sentinel tier delivery").toBe(seat ? 0 : 1)
    expect(logs.filter((s) => s.includes("user tier")).length, "seated-native-chain-569: one seated diagnostic, no unseated diagnostic").toBe(seat ? 1 : 0)
    const result = await $.turn.complete({ reason: "answer", answer: "native-ok", durationMs: 1, isAborted: false, turnId: "host-569" })
    expect(native, "seated-native-chain-569: native observer is not seated away").toBe(1)
    expect(result.text, "seated-native-chain-569: native result is transparent").toBe("native-ok")
    const context = await $.prompt.context({ blocks: [] })
    expect(rules(context).length, "seated-native-chain-569: context delivery matches seating").toBe(seat ? 0 : 1)
  })
}

test("fixture-loader-285", async ($: any, on: any) => {
  on("env.get", () => ({ value: "on" }))
  on("prompt.context", () => ({ blocks: [] }))
  const out = await $.prompt.context({ blocks: [] })
  expect(rules(out).length, "fixture-loader-285: module resolved from hooks/ and loaded through official host").toBe(1)
})

for (const code of ["EACCES", undefined]) {
  test("errno-path-569 " + (code ?? "message"), async () => {
    const error = Object.assign(new Error("$.fs.list(/fixture/ENOENT/passports/) failed: EACCES"), code ? { code } : {})
    const f = fixture({ home: "/fixture/ENOENT", listError: error })
    await f.start()
    expect(rules(await f.context()).length, "errno-path-569: fallback remains available").toBe(1)
    expect(lines(f, "passport-read").length, "errno-path-569: EACCES is not path ENOENT").toBe(1)
  })
}
for (const version of ["..", ".", "a/b", "\u0001", "\u0000", "\u007f"]) {
  test("version-segment-569 " + JSON.stringify(version), async () => {
    const f = fixture({ version, names: [version + "-linux.json"], passport: passport({ version }) })
    await f.start()
    expect(lines(f, "passport-read").length, "version-segment-569: invalid version is diagnosed").toBe(1)
    expect(f.calls.list.length, "version-segment-569: invalid segment is rejected before paths").toBe(0)
    expect(rules(await f.context()).length, "version-segment-569: invalid version keeps fallback").toBe(1)
  })
}
for (const delta of [0.4, 1, -1, 1.01]) {
  test("mtime-tolerance-569 " + delta, async () => {
    const f = fixture({ stat: { mtimeMs: 123 + delta } }); await f.start()
    expect(rules(await f.context()).length, "mtime-tolerance-569: one millisecond boundary").toBe(Math.abs(delta) <= 1 ? 0 : 1)
  })
}
for (const kind of ["other", "dir"]) {
  test("canonical-kind-569 " + kind, async () => {
    const f = fixture({ stat: { kind } }); await f.start()
    expect(rules(await f.context()).length, "canonical-kind-569: non-file keeps fallback").toBe(1)
    expect(lines(f, "passport-stale").length, "canonical-kind-569: non-file is stale").toBe(1)
  })
}
test("stale-own-external-canon-569", async () => {
  const f = fixture()
  const other = { name: "other", text: RULE_TEXT }
  const out = await f.context([{ name: "refusalHandling", text: "stale" }, other])
  expect(out.blocks, "stale-own-external-canon-569: stale own removed").toEqual([other])
  expect(out.blocks[0], "stale-own-external-canon-569: external canon identity").toBe(other)
})
test("stale-own-passport-569", async () => {
  const f = fixture(); await f.start()
  expect((await f.context([{ name: "refusalHandling", text: "stale" }])).blocks, "stale-own-passport-569: covered stale own removed").toEqual([])
})
test("env-off-transparent-569", async () => {
  const f = fixture({ env: "off" })
  const blocks = [{ name: "refusalHandling", text: "stale" }, { name: "refusalHandling", text: "other stale" }]
  const out = await f.context(blocks)
  expect(out.blocks, "env-off-transparent-569: off keeps original array").toBe(blocks)
  expect(out.blocks[0], "env-off-transparent-569: off keeps stale own").toBe(blocks[0])
})
test("diagnostic-causes-569", async () => {
  const f = fixture()
  let code = "EACCES"
  f.$.env.get = async () => { throw Object.assign(new Error("env failed: " + code), { code }) }
  await f.context(); code = "EIO"; await f.context(); await f.context()
  expect(lines(f, "отказ чтения").length, "diagnostic-causes-569: distinct reasons twice, repeated reason once").toBe(2)
})
test("env-raw-diagnostic-569", async () => {
  const f = fixture({ env: " On!" }); await f.context()
  expect(lines(f, "CLAUDE_REFUSAL_WATCH")[0][0], "env-raw-diagnostic-569: diagnostic preserves raw spelling").toContain('" On!"')
})
for (const [name, seat, initial] of [
  ["dynamic-d4-569", true, "off"],
  ["dynamic-d4-unseated-569", false, "off"],
  ["dynamic-d4-start-on-569", true, "on"],
] as const) {
  test(name, { plugins: seat ? [seated, sentinel] : [sentinel] }, async ($: any, on: any) => {
    const logs: string[] = []
    let env: string = initial
    let bottom = 0
    let turns = 0
    on("env.get", (_$: any, e: any) => ({ value: e.name === "HOME" ? HOME : env }))
    on("session.version", () => ({ value: { version: VERSION } }))
    on("fs.list", () => ({ value: [] }))
    on("settings.read", () => { bottom++; return { value: {} } })
    on("ui.log", (_$: any, e: any) => { logs.push(e.text); return { value: undefined } })
    on("session.start", (_$: any, e: any) => ({ cwd: e.cwd }))
    on("turn.start", (_$: any, e: any) => { turns++; return e })
    await $.session.start({ cwd: "/fixture", surface: "terminal", isInteractive: false })
    expect(bottom, "dynamic-d4-569: real nested probe completed").toBe(1)
    expect(logs.filter((s) => s.includes("user tier")).length, "dynamic-d4-569: initial latch matches switch").toBe(seat && initial === "on" ? 1 : 0)
    for (env of ["off", "on", "off", "on"]) await $.turn.start({ turnId: name })
    expect(turns, "dynamic-d4-569: each native turn reaches bottom").toBe(4)
    expect(logs.filter((s) => s.includes("user tier")).length, "dynamic-d4-569: enabling cached seated emits once").toBe(seat ? 1 : 0)
  })
}

for (const [label, record, stat] of [
  ["string-mtime", { mtime_ms: "123" }, { mtimeMs: 123 }],
  ["null-mtime", { mtime_ms: null }, { mtimeMs: 0 }],
  ["boolean-mtime", { mtime_ms: true }, { mtimeMs: 1 }],
  ["string-size", { size: "10" }, { size: 10 }],
  ["fraction-size", { size: 10.5 }, { size: 10.5 }],
  ["string-stat-mtime", {}, { mtimeMs: "123" }],
  ["infinite-stat-mtime", {}, { mtimeMs: Infinity }],
] as const) {
  test("passport-numeric-569 " + label, async () => {
    const f = fixture({ passport: passport(record), stat }); await f.start()
    expect((reg as any).__snapshot569().passportCovered, "passport-numeric-569: malformed numeric fields never cover").toBe(false)
    expect(lines(f, "passport-stale").length, "passport-numeric-569: malformed numeric fields are stale").toBe(1)
  })
}

test("diagnostic-class-bound-569", async () => {
  const f = fixture()
  for (let i = 0; i < 100; i++) {
    f.$.env.get = async () => { throw Object.assign(new Error("env failed"), { code: "E" + i }) }
    await f.context()
  }
  expect(lines(f, "отказ чтения").length <= 9, "diagnostic-class-bound-569: at most eight classes plus other").toBe(true)
  const keys = (reg as any).__snapshot569().diagnosed.filter((key: string) => key.startsWith("env:"))
  expect(keys.length <= 9, "diagnostic-class-bound-569: bounded latch entries").toBe(true)
  expect(keys.includes("env:other"), "diagnostic-class-bound-569: excess classes share other").toBe(true)
})
for (const source of ["code", "message"]) {
  test("diagnostic-long-class-569 " + source, async () => {
    const f = fixture()
    const token = "E" + "A".repeat(1000)
    f.$.env.get = async () => { throw Object.assign(new Error("env failed: " + token), source === "code" ? { code: token } : {}) }
    await f.context()
    expect((reg as any).__snapshot569().diagnosed, "diagnostic-long-class-569: long token maps to error").toEqual(["env:error"])
  })
}
for (const [label, raw] of [["emoji", "a".repeat(78) + "😀"], ["escape", "a".repeat(76) + "\u0001"], ["truncated", "a".repeat(79) + "😀tail"]] as const) {
  test("raw-codepoints-569 " + label, async () => {
    const f = fixture({ env: raw }); await f.context()
    const quoted = lines(f, "CLAUDE_REFUSAL_WATCH")[0][0].split("CLAUDE_REFUSAL_WATCH=")[1]
    const clipped = Array.from(raw).slice(0, 80).join("")
    expect(quoted, "raw-codepoints-569: serialize complete clipped codepoints").toBe(JSON.stringify(clipped) + (Array.from(raw).length > 80 ? "…" : ""))
    expect(JSON.parse(quoted.endsWith("…") ? quoted.slice(0, -1) : quoted), "raw-codepoints-569: quoted part parses intact").toBe(clipped)
  })
}
for (const kind of ["read", "stale", "ambiguous"]) {
  test("version-log-bound-569 " + kind, async () => {
    const version = "v".repeat(10240)
    const f = fixture({ version, names: kind === "ambiguous" ? [version + "-linux.json", version + "-darwin.json"] : [version + "-linux.json"], passport: passport({ version }), ...(kind === "read" ? { readError: new Error("denied") } : { stat: { size: 43 } }) })
    await f.start()
    const diagnostic = lines(f, "passport-" + kind)
    expect(diagnostic.length, "version-log-bound-569: named diagnostic").toBe(1)
    expect(Array.from(diagnostic[0][0]).length <= 200, "version-log-bound-569: version log bounded to 200").toBe(true)
  })
}
test("version-c1-569", async () => {
  const f = fixture({ version: "v\u0085" }); await f.start()
  expect(lines(f, "passport-read").length, "version-c1-569: C1 version diagnosed").toBe(1)
  expect(f.calls.list.length + f.calls.read.length + f.calls.stat.length, "version-c1-569: no filesystem call").toBe(0)
})

for (const site of ["debug", "env", "passport-read", "D4", "channel"]) {
  test("error-raw-569 " + site, async () => {
    const message = "\n\u007f\u0085  " + "a".repeat(195)
    const error = new Error(message)
    const f = fixture(site === "passport-read" ? { readError: error } : { names: [], seated: true })
    let prefix = ""
    if (site === "debug") {
      const log = f.$.ui.log
      f.$.ui.log = (text: string, options?: any) => {
        if (!options) throw error
        return log(text, options)
      }
      prefix = "не сработал: "
    } else if (site === "env") {
      f.$.env.get = async (name: string) => {
        if (name === "HOME") return HOME
        throw error
      }
      prefix = "отказ чтения CLAUDE_REFUSAL_WATCH: "
    } else if (site === "passport-read") {
      prefix = "passport-read " + JSON.stringify(VERSION) + ": "
    } else if (site === "D4") {
      f.$.settings.read = async () => { throw error }
      prefix = "доставка не подтверждена наблюдением: "
    } else {
      prefix = "канал event не сработал: reason: "
    }
    if (site === "channel") await f.hooks["turn.complete"](f.$, { get reason() { throw error } }, async () => ({}))
    else await f.start()
    const diagnostic = f.logs.filter(([text]) => text.includes(prefix))
    expect(diagnostic.length, "error-raw-569: one diagnostic for " + site).toBe(1)
    const text = diagnostic[0][0]
    expect(/[\n\r\x7f-\x9f]/.test(text) || text.includes(String.fromCharCode(0x2028)) || text.includes(String.fromCharCode(0x2029)), "error-raw-569: controls escaped at " + site).toBe(false)
    const raw = text.slice(text.indexOf(prefix) + prefix.length)
    expect(raw.endsWith("…"), "error-raw-569: long error clipped at " + site).toBe(true)
    const decoded = JSON.parse(raw.slice(0, -1))
    expect(Array.from(decoded).length, "error-raw-569: eighty codepoints at " + site).toBe(80)
    expect(decoded, "error-raw-569: quoted part preserves clipped error at " + site).toBe(Array.from(message).slice(0, 80).join(""))
    for (const escape of ["\\u007f", "\\u0085", "\\u2028", "\\u2029"]) {
      expect(raw, "error-raw-569: lowercase escape at " + site).toContain(escape)
    }
  })
}

test("raw-del-c1-separators-569", async () => {
  const raw = "\u007f\u0080\u0085\u009f  "
  const f = fixture({ env: raw }); await f.context()
  const quoted = lines(f, "CLAUDE_REFUSAL_WATCH")[0][0].split("CLAUDE_REFUSAL_WATCH=")[1]
  expect(quoted, "raw-del-c1-separators-569: lowercase escapes in raw values").toBe('"\\u007f\\u0080\\u0085\\u009f\\u2028\\u2029"')
  expect(JSON.parse(quoted), "raw-del-c1-separators-569: escapes preserve original points").toBe(raw)
})

test("raw-cf-569", async () => {
  const raw = "\u202e\u200b\ufeff\u2066\u{E0041}"
  const f = fixture({ env: raw }); await f.context()
  const quoted = lines(f, "CLAUDE_REFUSAL_WATCH")[0][0].split("CLAUDE_REFUSAL_WATCH=")[1]
  expect(quoted, "raw-cf-569: format characters escaped with round-trip").toBe('"\\u202e\\u200b\\ufeff\\u2066\\udb40\\udc41"')
  expect(JSON.parse(quoted), "raw-cf-569: escapes restore the original points").toBe(raw)
})

for (const kind of ["getter", "revoked", "prototype"]) {
  test("unreadable-569 env " + kind, async () => {
    let boom: any
    if (kind === "getter") {
      boom = new Error("getter-carrier")
      Object.defineProperty(boom, "message", { get() { throw new Error("getter-boom") } })
    } else if (kind === "revoked") {
      const pair = Proxy.revocable({}, {})
      pair.revoke()
      boom = pair.proxy
    } else {
      boom = new Proxy({}, { getPrototypeOf() { throw new Error("prototype-boom") } })
    }
    const f = fixture({ names: [] })
    f.$.env.get = async (name: string) => {
      if (name === "HOME") return HOME
      throw boom
    }
    let nextCalls = 0
    let threw: unknown = null
    try {
      await f.start(() => { nextCalls++ })
    } catch (x) {
      threw = x
    }
    expect(threw, "unreadable-569: unreadable exception named").toBe(null)
    expect(nextCalls, "unreadable-569: next exactly once").toBe(1)
    const diagnostic = lines(f, "отказ чтения CLAUDE_REFUSAL_WATCH")
    expect(diagnostic.length, "unreadable-569: unreadable exception named").toBe(1)
    expect(diagnostic[0][0], "unreadable-569: unreadable exception named").toContain("<unreadable exception>")
  })
}

for (const size of [-1, 2 ** 53]) {
  test("passport-size-range-569 " + size, async () => {
    const f = fixture({ passport: passport({ size }), stat: { size } }); await f.start()
    expect((reg as any).__snapshot569().passportCovered, "passport-size-range-569: invalid size never covers").toBe(false)
    expect(lines(f, "passport-stale").length, "passport-size-range-569: invalid size is stale once").toBe(1)
    expect(rules(await f.context()).length, "passport-size-range-569: invalid size keeps fallback").toBe(1)
  })
}

test("turn-next-host-569 env-throw", { plugins: [seated, sentinel] }, async ($: any, on: any) => {
  let turns = 0
  let inTurn = false
  let envCalls = 0
  let envThrew = false
  on("env.get", (_$: any, e: any) => {
    if (inTurn) { envCalls++; envThrew = true; throw new Error("turn-env-denied") }
    return { value: e.name === "HOME" ? HOME : "off" }
  })
  on("session.version", () => ({ value: { version: VERSION } }))
  on("fs.list", () => ({ value: [] }))
  on("settings.read", () => ({ value: {} }))
  on("ui.log", () => ({ value: undefined }))
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd }))
  on("turn.start", (_$: any, e: any) => { turns++; return e })
  await $.session.start({ cwd: "/fixture", surface: "terminal", isInteractive: false })
  inTurn = true
  await $.turn.start({ turnId: "turn-next-env-throw" })
  expect(turns, "turn-next-host-569: lower turn runs exactly once at env-throw").toBe(1)
  expect(envCalls, "turn-next-host-569: env branch reached").toBe(1)
  expect(envThrew, "turn-next-host-569: env throw occurred").toBe(true)
})

for (const mode of ["stale-before", "stale-await"]) {
  test("turn-next-function-569 " + mode, async () => {
    const { hooks } = capture()
    const generation = (reg as any).__snapshot569().generation
    let envCalls = 0
    let nextCalls = 0
    const event = { turnId: mode }
    const result = { lower: mode }
    const $ = { env: { async get() {
      envCalls++
      register(() => {})
      return "on"
    } } }
    if (mode === "stale-before") register(() => {})
    const out = await hooks["turn.start"]($, event, (forwarded: any) => {
      nextCalls++
      expect(forwarded, "turn-next-function-569: original event at " + mode).toBe(event)
      return result
    })
    expect((reg as any).__snapshot569().generation > generation, "turn-next-function-569: handler generation is stale at " + mode).toBe(true)
    expect(envCalls, "turn-next-function-569: intended env branch at " + mode).toBe(mode === "stale-before" ? 0 : 1)
    expect(nextCalls, "turn-next-function-569: next once at " + mode).toBe(1)
    expect(out, "turn-next-function-569: lower result returned at " + mode).toBe(result)
  })
}

test("own-error-text-569", async () => {
  const f = fixture()
  const own = "ожидание записи снято отменой или отказом часов (сигнал нечитаем); запись не подтверждена"
  expect(Array.from(own).length > 80, "own-error-text-569: own fixture exceeds eighty points").toBe(true)
  const signal: any = { addEventListener() {}, removeEventListener() {}, get aborted() { throw new Error("unreadable-signal") } }
  f.$.ui.toast = () => {}
  f.$.ui.status = () => {}
  f.$.clock = { async now() { return 5000 }, async sleep() { throw new Error("sleep-denied") } }
  f.$.store = { set() { return new Promise<void>(() => {}) }, async keys() { return [] }, async delete() {} }
  const next: any = async () => ({})
  next.signal = signal
  await f.hooks["turn.complete"](f.$, { reason: "refusal", turnId: "own-error-569" }, next)
  const prefix = "catalyst-refusal-watch: канал store не сработал: "
  expect(f.logs.some(([text]) => text === prefix + own), "own-error-text-569: complete own message reaches store log").toBe(true)

  const foreign = "\n" + String.fromCharCode(0x7f, 0x85, 0x2028, 0x2029) + "x".repeat(195)
  f.$.store.set = async () => { throw new Error(foreign) }
  f.$.clock.sleep = () => new Promise<void>(() => {})
  next.signal = undefined
  await f.hooks["turn.complete"](f.$, { reason: "refusal", turnId: "foreign-error-569" }, next)
  const row = f.logs.filter(([text]) => text.startsWith(prefix) && text !== prefix + own)
  expect(row.length, "own-error-text-569: one foreign error in the same store channel").toBe(1)
  const quoted = row[0][0].slice(prefix.length)
  expect(quoted.endsWith("…"), "own-error-text-569: foreign message clipped").toBe(true)
  expect(/[\n\r\x7f-\x9f]/.test(quoted) || quoted.includes(String.fromCharCode(0x2028)) || quoted.includes(String.fromCharCode(0x2029)), "own-error-text-569: foreign controls escaped").toBe(false)
  expect(JSON.parse(quoted.slice(0, -1)), "own-error-text-569: foreign clipped points preserved").toBe(Array.from(foreign).slice(0, 80).join(""))
})
