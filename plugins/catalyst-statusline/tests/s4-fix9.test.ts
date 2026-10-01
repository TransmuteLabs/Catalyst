import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data/index'
import { __snapshotLongHashes } from '../hooks/data/snapshotText'
import type { Source } from '../hooks/data/types'
import { EXT_WRITER, NS_SESS, isSessKey, sessKeys, sessValue, v3Key } from './world'

// S4-FIX9. CONSTRAINT (measured, the header of s4-fix7.test.ts): the kit loads
// the folder plugin once; the teeth run against the imported module instance.
// CONSTRAINT: the stands below drive only the session write queue; `t` is the
// mod's process clock (the now seam), watchdogs and the end bound are held
// until the test fires them.

const seam = SL as unknown as {
  __setNow?: (fn: (() => number) | null) => void
  __setOrigin?: (origin: string) => void
  __sessQueue: () => { farewell: string[]; queued: string[]; landed?: [string, number][] }
}
const drain = async (): Promise<void> => {
  for (let i = 0; i < 240; i++) await Promise.resolve()
}
const eventInput = (event: string, data: unknown, now = 0): void => SL.__feed({ source: { kind: 'event', event } as Source, ok: true, data, now })
const tokens = (turnId: string, n: number) => ({ turnId, usage: { input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
const clone = (v: unknown): any => JSON.parse(JSON.stringify(v))
// the newest snapshot of the session of the logical key `sess:<id>`, both forms (#551 §3.10)
const total = (m: Map<string, unknown>, k: string): number | undefined => (sessValue(m, k.slice('sess:'.length)) as { sum?: { total: number } } | undefined)?.sum?.total
const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const SNAP = (sum: number, seq: number): Record<string, unknown> => ({
  sum: { total: sum, in: sum, out: 0, cache: 0 },
  seenTurns: [],
  tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, byName: [], done: [] },
  agents: { map: [], done: [] },
  started: true, resumed: false, resumedDecided: true, mainTurns: 0,
  seq,
})
const SEQ_CAP = 2 ** 52
const EPOCH = 1_780_000_000_000
const HOUR = 3_600_000

const clockStart = async (seq: number, wall = EPOCH) => {
  const persisted = new Map<string, unknown>([['sess:A', { ...SNAP(50, seq), origin: 'zz' }]])
  const h = handlers()
  const $ = fullStand(persisted)
  $.wall = wall
  await SL.restoreAfterReload($, {} as never)
  await drain()
  return { h, $, persisted }
}

test('S4F9 Ж1 restore: epoch seq ten minutes ahead is learned despite small uptime', async () => {
  SL.__resetState()
  try {
    const seq = (EPOCH + 600_000) * 1000
    const { h, $, persisted } = await clockStart(seq)
    expect(diags('session-snapshot-clock').length).toBe(0)
    expect(seam.__sessQueue().landed?.find(([k]) => isSessKey(k, 'A'))?.[1]).toBe(seq)
    eventInput('turn.complete', tokens('one', 1))
    await end(h, $)
    expect((sessValue(persisted, 'A') as any).seq).toBeGreaterThan(seq)
  } finally { SL.__resetState() }
})

test('S4F9 Ж1 verify: read-back uses refreshed epoch clock, not uptime', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await clockStart(EPOCH * 1000)
    eventInput('turn.complete', tokens('one', 1))
    await end(h, $)
    const seq = (EPOCH + 600_000) * 1000
    // another process publishes under a key of its own (#551 §3.10)
    persisted.set(v3Key(NS_SESS, 'A', EXT_WRITER, 1), { ...SNAP(77, seq), origin: 'zz', session: 'A' })
    $.t += 16000
    await gather($)
    expect(diags('session-snapshot-clock').length).toBe(0)
    expect(seam.__sessQueue().landed?.find(([k]) => isSessKey(k, 'A'))?.[1]).toBe(seq)
  } finally { SL.__resetState() }
})

test('S4F9 Ж1 outside: epoch seq 25 hours ahead is refused with one diagnostic', async () => {
  SL.__resetState()
  try {
    const seq = (EPOCH + 25 * HOUR) * 1000
    const { h, $, persisted } = await clockStart(seq)
    expect(seam.__sessQueue().landed?.length).toBe(0)
    expect(diags('session-snapshot-clock').length).toBe(1)
    eventInput('turn.complete', tokens('one', 1))
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(51)
    expect((sessValue(persisted, 'A') as any).seq < seq).toBe(true)
  } finally { SL.__resetState() }
})

test('S4F9 Ж2/Ж10: three own writes at SEQ_CAP all land with the local n persisted', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await clockStart(SEQ_CAP - 1, Math.floor((SEQ_CAP - 1) / 1000))
    SL.__setOrigin('zzz')
    const seen: number[] = []
    const put = $.store.set
    $.store.set = async (k: string, v: any) => {
      if (isSessKey(k, 'A')) {
        seen.push(v.sum.total)
        expect(Object.prototype.hasOwnProperty.call(v, 'n')).toBe(true)
      }
      await put(k, v)
    }
    for (let i = 1; i <= 3; i++) {
      eventInput('turn.complete', tokens('turn' + i, i))
      await end(h, $)
    }
    expect(seen).toEqual([51, 53, 56])
    expect(total(persisted, 'sess:A')).toBe(56)
    expect(diags('session-snapshot-seq-cap').length).toBe(1)
  } finally { SL.__resetState() }
})

test('S4F9 Ж3 turns: common-prefix ids remain distinct and replay deduplicates after restore', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const a = 'x'.repeat(220) + 'A'
    const b = 'x'.repeat(220) + 'B'
    eventInput('turn.complete', tokens(a, 10))
    eventInput('turn.complete', tokens(b, 20))
    await end(h, $)
    const stored = sessValue(persisted, 'A') as any
    expect(new Set(stored.seenTurns).size).toBe(2)
    expect(stored.seenTurns.every((s: string) => s.length === 200 && /#[0-9a-f]{8}$/.test(s))).toBe(true)
    const second = await start(persisted)
    eventInput('turn.complete', tokens(a, 10))
    await end(second.h, second.$)
    expect(total(persisted, 'sess:A')).toBe(30)
  } finally { SL.__resetState() }
})

test('S4F9 Ж3 agents: common-prefix ids restore as two agents', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    for (const suffix of ['A', 'B']) {
      await h['agent.spawn']($, { subagentType: suffix }, async () => ({ agentId: 'x'.repeat(220) + suffix }))
      await drain()
    }
    const second = await start(persisted)
    await end(second.h, second.$)
    expect((sessValue(persisted, 'A') as any).agents.map.length).toBe(2)
  } finally { SL.__resetState() }
})

test('S4F9 Ж3 legacy: unknown arrays are capped and object keys retain hash suffixes', async () => {
  SL.__resetState()
  try {
    // #551 §3.10: the re-put runs when this environment's own publication is
    // gone at the read-back — one landed before a reload whose restore then
    // learns the legacy value above it, and another process's prune takes it
    const seed = { ...SNAP(50, 42_000_000_000), origin: '', 'agents.map': Array(100).fill('legacy'), 'tools.byName': { '*': Array(100).fill('legacy') }, extra: { ['x'.repeat(220) + 'A']: Array(100).fill('a'), ['x'.repeat(220) + 'B']: Array(100).fill('b') } }
    const persisted = new Map<string, unknown>()
    const first = await start(persisted)
    eventInput('turn.complete', tokens('a1', 1))
    await end(first.h, first.$)
    const own = sessKeys(persisted, 'A')
    expect(own.length).toBe(1)
    persisted.set('sess:A', seed)
    const { $ } = await start(persisted)
    for (const k of own) persisted.delete(k)
    $.t += 16000
    await gather($)
    const extra = (sessValue(persisted, 'A') as any).extra
    expect(Object.keys(extra).length).toBe(2)
    expect(Object.values(extra).map((x: any) => x.length)).toEqual([64, 64])
    expect((sessValue(persisted, 'A') as any)['tools.byName']['*'].length).toBe(64)
    expect((sessValue(persisted, 'A') as any)['agents.map'].length).toBe(64)
    expect(SL.__diag().filter((d) => d.text.includes('64') && d.text.includes('sess:A')).length).toBe(1)
  } finally { SL.__resetState() }
})

const deadGenerationPark = async (switchAway: boolean) => {
  const persisted = new Map<string, unknown>()
  const old = await start(persisted)
  const gate = deferred<void>()
  old.$.store.set = async (k: string, v: unknown) => {
    if (isSessKey(k, 'A')) await gate.promise
    persisted.set(k, clone(v))
  }
  eventInput('turn.complete', tokens('old', 10))
  await end(old.h, old.$)
  persisted.set('sess:A', { ...SNAP(80, 100_000_000), origin: 'zz' })
  const fresh = await start(persisted)
  if (switchAway) {
    fresh.$.session.id = async () => 'B'
    await gather(fresh.$)
    await end(fresh.h, fresh.$)
  } else {
    eventInput('turn.complete', tokens('new', 1))
    await end(fresh.h, fresh.$)
  }
  gate.resolve()
  await drain()
  // #551 §3.10: the dead generation's late landing is a publication of its
  // own — it covers nothing and parks nothing (no requeue on that branch)
  expect(seam.__sessQueue().queued).toEqual([])
  expect(seam.__sessQueue().farewell).toEqual([])
  return fresh
}

// #551 §3.10, D8: with no park the non-current session is evicted like any
// other — its publications go, its previous-version key younger than MARK_KEEP stays
test('S4F9 Ж4 MC2: dead-generation settle leaves no slot — the non-current session is pruned by its order, its previous-version key stays', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await deadGenerationPark(true)
    // CONSTRAINT (#551 D2, D8): the prune deletes publications of this version
    // only (s551-protocol T14) — the seeds are another environment's publications
    for (let i = 0; i < 40; i++) persisted.set(v3Key(NS_SESS, 'K' + i, EXT_WRITER, i + 1), { ...SNAP(i, 200_000_000 + i), session: 'K' + i })
    $.t += 16000
    await h['agent.spawn']($, { subagentType: 'worker' }, async () => ({ agentId: 'ag' }))
    await drain()
    const sessions = new Set([...persisted.keys()].filter((key) => isSessKey(key)).map((key) => (key.startsWith('sess:') ? key.slice(5) : String((persisted.get(key) as { session?: unknown }).session))))
    expect({ aV3: sessKeys(persisted, 'A').filter((k) => k !== 'sess:A').length, aV1: persisted.has('sess:A'), sessions: sessions.size, queued: seam.__sessQueue().queued }).toEqual({ aV3: 0, aV1: true, sessions: 33, queued: [] })
  } finally { SL.__resetState() }
})

test('S4F9 Ж5 H1a: after a dead-generation settle agent.spawn writes the current session without gather or end', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await deadGenerationPark(false)
    await h['agent.spawn']($, { subagentType: 'worker' }, async () => ({ agentId: 'new-agent' }))
    await drain()
    expect((sessValue(persisted, 'A') as any).agents.map.some(([id]: [string, unknown]) => id === 'new-agent')).toBe(true)
    expect(seam.__sessQueue().queued).toEqual([])
  } finally { SL.__resetState() }
})

test('S4F9 Ж6 sleep: hook-owned sleep releases end when both other bounds never fire', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    const sleep = deferred<void>()
    let observed: unknown
    $.clock.sleep = (ms: number, options: unknown) => { observed = [ms, options]; return sleep.promise }
    $.clock.after = () => ({ cancel() {} })
    $.process.run = () => new Promise<void>(() => {})
    $.store.set = () => new Promise<void>(() => {})
    const next: any = async () => { called = true; return {} }
    next.signal = new AbortController().signal
    let called = false
    const pending = h['session.end']($, {}, next)
    await drain()
    expect(called).toBe(false)
    sleep.resolve()
    await drain()
    expect(called).toBe(true)
    expect(observed).toEqual([3000, { signal: next.signal }])
    await pending
  } finally { SL.__resetState() }
})

test('S4F9 Ж6 refused: failed process sleep does not beat a write landing before clock bound', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const write = deferred<void>()
    $.clock.sleep = () => new Promise<void>(() => {})
    $.process.run = async () => { throw new Error('sleep absent') }
    $.store.set = async (k: string, v: unknown) => { await write.promise; persisted.set(k, clone(v)) }
    eventInput('turn.complete', tokens('one', 10))
    let called = false
    const pending = h['session.end']($, {}, async () => { called = true; return {} })
    await drain()
    expect(called).toBe(false)
    $.t += 2000
    write.resolve()
    await drain()
    $.t += 1000
    for (const timer of $.timers as Timer[]) if (timer.ms === 3000 && !timer.cancelled) timer.fn()
    await pending
    expect(called).toBe(true)
    expect(total(persisted, 'sess:A')).toBe(10)
    expect(diags('session-snapshot-end').length).toBe(0)
  } finally { SL.__resetState() }
})

test('S4F9 Ж7/Ж11: a throwing family diagnoses once via family-feed and session.end next runs once', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    const { h, $ } = await start()
    FAMILIES.push({ family: 'stand-throw', elements: [], sources: [{ source: { kind: 'event', event: 'session.end' }, elements: [] }], init: () => ({}), reduce: () => { throw new Error('family failure') } } as any)
    let nextCount = 0
    await h['session.end']($, {}, async () => { nextCount++; return {} })
    expect(nextCount).toBe(1)
    expect(diags('family-feed').length).toBe(1)
    expect(diags('session-end-event').length).toBe(0)
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

test('S4F9 perf capture: 64 long agent names hash once each and never again on writes', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const before = __snapshotLongHashes()
    const name = 'x'.repeat(100_000)
    for (let i = 0; i < 64; i++) {
      await h['agent.spawn']($, { subagentType: name }, async () => ({ agentId: 'ag' + i }))
      await drain()
      expect(__snapshotLongHashes() - before).toBe(i + 1)
    }
    for (let i = 0; i < 3; i++) {
      eventInput('turn.complete', tokens('write' + i, 1))
      await end(h, $)
      expect(__snapshotLongHashes() - before).toBe(64)
    }
    expect((sessValue(persisted, 'A') as any).agents.map.length).toBe(64)
  } finally { SL.__resetState() }
})

test('S4F9 perf capture fields: model and description normalize at spawn and model at completion', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const before = __snapshotLongHashes()
    const long = 'x'.repeat(100_000)
    eventInput('agent.spawn', { agentId: 'ag', subagentType: 'worker', description: long, model: long })
    expect(__snapshotLongHashes() - before).toBe(2)
    eventInput('turn.complete', { agentId: 'ag', turnId: 'one', usage: { ...tokens('one', 1).usage, model: long } })
    expect(__snapshotLongHashes() - before).toBe(3)
    await end(h, $)
    expect(__snapshotLongHashes() - before).toBe(3)
    const rec = (sessValue(persisted, 'A') as any).agents.map[0][1]
    expect([rec.model, rec.desc].every((s: string) => s.length === 200 && /#[0-9a-f]{8}$/.test(s))).toBe(true)
  } finally { SL.__resetState() }
})

test('S4F9 perf restore: a legacy long agent name hashes once before memory and not on three writes', async () => {
  SL.__resetState()
  try {
    const seed = { ...SNAP(50, 42_000_000_000), agents: { map: [['old', { name: 'x'.repeat(100_000), model: 'm', desc: 'd', status: 'running', at: 1, doneAt: 0 }]], done: [] } }
    const persisted = new Map<string, unknown>([['sess:A', seed]])
    const before = __snapshotLongHashes()
    const { h, $ } = await start(persisted)
    expect(__snapshotLongHashes() - before).toBe(1)
    for (let i = 0; i < 3; i++) {
      eventInput('turn.complete', tokens('write' + i, 1))
      await end(h, $)
      expect(__snapshotLongHashes() - before).toBe(1)
    }
    expect(total(persisted, 'sess:A')).toBe(53)
    expect((sessValue(persisted, 'A') as any).agents.map[0][1].name.length).toBe(200)
  } finally { SL.__resetState() }
})

type Timer = { ms: number; fn: () => void; cancelled: boolean }

const fullStand = (persisted = new Map<string, unknown>(), id = 'A'): any => {
  const stand: any = {
    t: 61000,
    wall: undefined as number | undefined,
    timers: [] as Timer[],
    store: {
      get: async (k: string) => persisted.get(k),
      set: async (k: string, v: unknown) => { persisted.set(k, clone(v)) },
      delete: async (k: string) => { persisted.delete(k) },
      keys: async () => [...persisted.keys()],
    },
    session: { id: async () => id, turns: async () => 0, cwd: async () => '/work/demo', root: async () => '/work/demo', model: async () => 'live-model', usage: async () => ({}), messages: async () => [] },
    config: { list: async () => [] },
    env: { get: async () => '' },
    fs: { read: async () => '' },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
    plugin: { name: 'catalyst-statusline', root: '/stand' },
    ui: { log: async () => undefined, status: () => undefined, invalidate: () => undefined },
  }
  stand.clock = {
    now: async () => stand.wall ?? stand.t,
    every: () => ({ cancel() {} }),
    after: (ms: number, fn: () => void) => {
      const t: Timer = { ms, fn, cancelled: false }
      stand.timers.push(t)
      return { cancel() { t.cancelled = true } }
    },
  }
  seam.__setNow?.(() => stand.t)
  return stand
}
const handlers = (): Record<string, any> => {
  const h: Record<string, any> = {}
  SL.register(((event: string, fn: unknown) => { h[event] = fn }) as never, {} as never)
  return h
}
const end = async (h: Record<string, any>, $: unknown): Promise<void> => {
  await h['session.end']($, {}, async () => ({}))
  await drain()
}
const gather = async ($: unknown): Promise<void> => {
  await SL.__refresh($ as never)
  await drain()
}
const diags = (key: string): { kind: string; text: string }[] => SL.__diag().filter((d) => d.key === key).map((d) => ({ kind: d.kind, text: d.text }))
const start = async (persisted = new Map<string, unknown>(), id = 'A'): Promise<{ h: Record<string, any>; $: any; persisted: Map<string, unknown> }> => {
  const h = handlers()
  const $ = fullStand(persisted, id)
  await SL.restoreAfterReload($, {} as never)
  await drain()
  return { h, $, persisted }
}
const seedKeys = (persisted: Map<string, unknown>, n: number): void => {
  for (let i = 0; i < n; i++) persisted.set('sess:K' + i, SNAP(i, (1000 + i) * 1000))
}
const evicted = (persisted: Map<string, unknown>, gone: string[], next: string): boolean => gone.every((k) => !persisted.has(k)) && persisted.has(next)
