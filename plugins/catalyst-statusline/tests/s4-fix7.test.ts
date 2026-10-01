import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data/index'
import type { Source } from '../hooks/data/types'
import { EXT_WRITER, NS_SESS, isSessKey, sessKeys, sessValue, v3Key } from './world'

// S4-FIX7. CONSTRAINT (measured, the header of template.test.ts): the kit
// loads the folder plugin once; the teeth run against the imported module
// instance. CONSTRAINT: the stands below drive only the session write queue;
// `t` is the mod's process clock (the now seam), watchdogs are held until
// the test fires them.

const seam = SL as unknown as {
  __setNow?: (fn: (() => number) | null) => void
  __setOrigin?: (origin: string) => void
  __sessQueue: () => { farewell: string[]; queued: string[]; landed?: [string, number][] }
  __fallbackOrigin?: () => string
}
const drain = async (): Promise<void> => {
  for (let i = 0; i < 240; i++) await Promise.resolve()
}
const eventInput = (event: string, data: unknown, now = 0): void => SL.__feed({ source: { kind: 'event', event } as Source, ok: true, data, now })
const infoInput = (id: string): void => SL.__feed({ source: { kind: 'session', call: 'info' } as Source, ok: true, data: { id, turns: 0, cwd: '/work/demo', root: '/work/demo' }, now: 0 })
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
    sleep: () => new Promise<void>(() => {}),
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
const landedKeys = (): string[] => (seam.__sessQueue().landed ?? []).map(([k]) => k).sort()
const start = async (persisted = new Map<string, unknown>(), id = 'A'): Promise<{ h: Record<string, any>; $: any; persisted: Map<string, unknown> }> => {
  const h = handlers()
  const $ = fullStand(persisted, id)
  await SL.restoreAfterReload($, {} as never)
  await drain()
  return { h, $, persisted }
}
// CONSTRAINT (#551 D2, D8): the prune deletes publications of this version
// only — a `sess:<id>` key of the previous version younger than MARK_KEEP stays
// (s551-protocol T14); the seeds are another environment's publications, one
// per session, a reseed of a round of its own
let seedRound = 0
const seedKeys = (persisted: Map<string, unknown>, n: number): void => {
  seedRound++
  for (let i = 0; i < n; i++) persisted.set(v3Key(NS_SESS, 'K' + i, EXT_WRITER, seedRound * 1000 + i + 1), { ...SNAP(i, (1000 + i) * 1000), session: 'K' + i })
}
// a snapshot of the logical key `sess:<id>` is in the store, either form
const has = (persisted: Map<string, unknown>, k: string): boolean => sessKeys(persisted, k.slice('sess:'.length)).length > 0
// the evicted set of one prune: `gone` are the lowest keys the prune may take,
// `next` is the first key it must leave (K0's own ord can rise above the seeded
// ones when its farewell lands, shifting the window)
const evicted = (persisted: Map<string, unknown>, gone: string[], next: string): boolean => gone.every((k) => !has(persisted, k)) && has(persisted, next)

// ---------------------------------------------------------------- Р1

test('S4F7 Р1: a value waiting at a freed key is written by session.end itself', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gates = [deferred<void>(), deferred<void>()]
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) {
        const i = n++
        if (i < 2) await gates[i]!.promise
      }
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    for (const add of [10, 20]) {
      $.t += 16000
      eventInput('turn.complete', tokens('b' + add, add), 60000)
      await gather($)
    }
    const before = n
    gates[0]!.resolve()
    await drain()
    // FIX8 Ф1: the settle that frees the seat runs the parked newest itself,
    // so it counts as settled here, before the end's own write
    const settled = n
    eventInput('turn.complete', tokens('d', 7), 60000)
    await end(h, $)
    // the one end record is the first end's own: its store.set was made and
    // never settled; the second end's write settles inside it — no record
    const endDiag = diags('session-snapshot-end').map((d) => d.text)
    expect({ before, settled, afterEnd: n, stored: total(persisted, 'sess:A'), endDiag }).toEqual({ before: 2, settled: 3, afterEnd: 4, stored: 137, endDiag: ['store.set sess:A did not settle before the session ended; the value may not be stored'] })
  } finally { SL.__resetState() }
})

test('S4F7 Р1 parked: session.end writes the newest value parked behind a freed flight, with no false end record', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gates = [deferred<void>(), deferred<void>()]
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) {
        const i = n++
        if (i < 2) await gates[i]!.promise
      }
      persisted.set(k, clone(v))
    }
    await h['turn.complete']($, tokens('a1', 100), async () => ({}))
    await drain()
    $.t += 16000
    eventInput('turn.complete', tokens('b1', 20), 60000)
    await gather($)
    $.t += 16000
    eventInput('turn.complete', tokens('c1', 30), 60000)
    await gather($)
    expect({ n, queued: seam.__sessQueue().queued }).toEqual({ n: 2, queued: ['sess:A'] })
    gates[0]!.resolve()
    await drain()
    await end(h, $)
    const atEnd = total(persisted, 'sess:A')
    const endRecords = diags('session-snapshot-end').length
    gates[1]!.resolve()
    await drain()
    await drain()
    expect({ atEnd, endRecords, afterFree: total(persisted, 'sess:A') }).toEqual({ atEnd: 150, endRecords: 0, afterFree: 150 })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р2

test('S4F7 Р2 nonzero sleep: a non-zero sleep exit still reports the unsettled end write', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    $.process.run = async () => ({ exitCode: 1, stdout: '', stderr: '' })
    $.store.set = async (k: string) => { if (isSessKey(k, 'A')) await new Promise<void>(() => {}) }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    let ended = false
    void h['session.end']($, {}, async () => ({})).then(() => { ended = true })
    await drain()
    expect(ended).toBe(false)
    $.t += 3000
    for (const timer of $.timers as Timer[]) if (timer.ms === 3000 && !timer.cancelled) timer.fn()
    await drain()
    const d = diags('session-snapshot-end')
    expect({ ended, count: d.length, ran: d.every((x) => x.text.includes('the sleep bound did not run')), tail: d.every((x) => x.text.endsWith('; the value may not be stored')) }).toEqual({ ended: true, count: 1, ran: true, tail: true })
  } finally { SL.__resetState() }
})

test('S4F7 Р2 refused sleep: a rejected process.run still reports the unsettled end write', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    $.process.run = async () => { throw new Error('cannot start') }
    $.store.set = async (k: string) => { if (isSessKey(k, 'A')) await new Promise<void>(() => {}) }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    const pending = h['session.end']($, {}, async () => ({}))
    await drain()
    $.t += 3000
    for (const timer of $.timers as Timer[]) if (timer.ms === 3000 && !timer.cancelled) timer.fn()
    await pending
    const d = diags('session-snapshot-end')
    expect({ count: d.length, ran: d.every((x) => x.text.includes('the sleep bound did not run')), tail: d.every((x) => x.text.endsWith('; the value may not be stored')) }).toEqual({ count: 1, ran: true, tail: true })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р3

test('S4F7 Р1 release: session.end releases a value parked at another freed key', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const { h, $ } = await start(persisted, 'B')
    const gates = [deferred<void>(), deferred<void>()]
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'B')) {
        const i = n++
        if (i < 2) await gates[i]!.promise
      }
      persisted.set(k, clone(v))
    }
    await h['turn.complete']($, tokens('b1', 100), async () => ({}))
    await drain()
    $.t += 16000
    eventInput('turn.complete', tokens('b2', 20), 60000)
    await gather($)
    $.t += 16000
    eventInput('turn.complete', tokens('b3', 30), 60000)
    await gather($)
    expect({ n, queued: seam.__sessQueue().queued }).toEqual({ n: 2, queued: ['sess:B'] })
    $.session.id = async () => 'A'
    await gather($)
    $.t += 16000
    await gather($)
    // the farewell of B is spent into the slot while the key is still at its
    // limit — the end has no write of B left to carry the value out
    expect({ n, queued: seam.__sessQueue().queued, farewell: seam.__sessQueue().farewell }).toEqual({ n: 2, queued: ['sess:B'], farewell: [] })
    gates[0]!.resolve()
    await drain()
    eventInput('turn.complete', tokens('a1', 5), 60000)
    await end(h, $)
    expect({ n, stored: total(persisted, 'sess:B') }).toEqual({ n: 3, stored: 150 })
  } finally { SL.__resetState() }
})

test('S4F7 Р1 enqueue: a turn handler writes the newest value after a live flight frees its slot', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gates = [deferred<void>(), deferred<void>()]
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) {
        const i = n++
        if (i < 2) await gates[i]!.promise
      }
      persisted.set(k, clone(v))
    }
    await h['turn.complete']($, tokens('a1', 100), async () => ({}))
    await drain()
    $.t += 16000
    eventInput('turn.complete', tokens('b1', 20), 60000)
    await gather($)
    $.t += 16000
    eventInput('turn.complete', tokens('b2', 30), 60000)
    await gather($)
    expect({ n, queued: seam.__sessQueue().queued }).toEqual({ n: 2, queued: ['sess:A'] })
    // A live flight frees this slot; this input does not isolate enqueue's
    // immediate start for an io-null park left by a dead generation.
    const clockNow = $.clock.now
    let freed = false
    $.clock.now = async (...args: unknown[]) => {
      if (!freed) {
        freed = true
        gates[0]!.resolve()
        await drain()
      }
      return (clockNow as (...a: unknown[]) => Promise<number>)(...args)
    }
    await h['turn.complete']($, tokens('b3', 5), async () => ({}))
    await drain()
    expect({ n, stored: total(persisted, 'sess:A') }).toEqual({ n: 4, stored: 155 })
    gates[1]!.resolve()
    await drain()
    expect(total(persisted, 'sess:A')).toBe(155)
  } finally { SL.__resetState() }
})

test('S4F7 Р3: a record made inside session.end ships to ui.log before any later gather', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    const logged: string[] = []
    $.ui.log = async (s: string) => { logged.push(s) }
    $.store.set = async (k: string) => { if (isSessKey(k, 'A')) throw new Error('store down') }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const inMemory = diags('session-snapshot-write').map((d) => d.text)
    expect({ inMemory: inMemory.length, shipped: logged.filter((s) => s.includes('the value may not be stored')).length }).toEqual({ inMemory: 1, shipped: 1 })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р4

test('S4F7 Р4: a key at the flight limit reports its parked newest once per episode', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    let n = 0
    $.store.set = async (k: string) => {
      if (isSessKey(k, 'A')) { n++; await new Promise<void>(() => {}) }
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    for (let i = 0; i < 6; i++) {
      $.t += 16000
      eventInput('turn.complete', tokens('b' + i, 1), 60000)
      await gather($)
    }
    const all = (): string[] => SL.__diag().filter((d) => d.key.startsWith('session-snapshot')).map((d) => d.key + ' :: ' + d.text)
    const first = all()
    $.t += 16000
    eventInput('turn.complete', tokens('c1', 1), 60000)
    await gather($)
    $.t += 16000
    eventInput('turn.complete', tokens('c2', 1), 60000)
    await gather($)
    expect({ n, first, after: all() }).toEqual({
      n: 2,
      first: [
        'session-snapshot-end :: store.set sess:A did not settle before the session ended; the value may not be stored',
        'session-snapshot-hung :: store.set sess:A висит > 15 с; the next gather retries',
        'session-snapshot-blocked :: store.set sess:A: 2 writes not settled; the newest value is parked',
      ],
      after: first,
    })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р5

test('S4F7 Р5: two discarded values of two keys are two records', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    // the farewells of A and C are refused back into FAREWELL while their
    // keys' landed values are still low
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') || isSessKey(k, 'C')) throw new Error('store down')
      persisted.set(k, clone(v))
    }
    $.session.id = async () => 'C'
    await gather($)
    $.session.id = async () => 'A'
    await gather($)
    expect(seam.__sessQueue().farewell.sort()).toEqual(['A', 'C'])
    // another writer puts a newer value of each key into the store
    persisted.set('sess:A', SNAP(900, 80_000_000_000))
    persisted.set('sess:C', SNAP(700, 80_000_500_000))
    $.session.id = async () => 'C'
    await gather($)
    $.session.id = async () => 'A'
    await gather($)
    await gather($)
    const texts = diags('stale-write').map((d) => d.text)
    expect(texts.length).toBe(2)
    expect(texts.some((t) => t.includes('snapshot of C '))).toBe(true)
    expect(texts.some((t) => t.includes('snapshot of A '))).toBe(true)
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р6

test('S4F7 Р6: the store write bounds every agent record string, a live capture and a 0.5.0 value alike', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const long = 'x'.repeat(100_000)
    const { h, $ } = await start(persisted)
    for (let i = 0; i < 64; i++) {
      await h['agent.spawn']($, { subagentType: long, description: 'd', model: 'm' }, async () => ({ agentId: 'ag' + i }))
      await drain()
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const storedA = sessValue(persisted, 'A') as { agents: { map: [string, { name: string }][] } }
    expect({ bounded: storedA.agents.map.every(([, r]) => r.name.length <= 200), size: JSON.stringify(storedA).length < 4 * 1024 * 1024, count: storedA.agents.map.length }).toEqual({ bounded: true, size: true, count: 64 })

    const snap = SNAP(50, 42_000_000_000)
    snap['agents'] = { map: [['old', { name: long, desc: 'd', model: 'm', status: 'running', at: 1, doneAt: 0 }]], done: [] }
    persisted.set('sess:B', snap)
    const h2 = handlers()
    const $2 = fullStand(persisted, 'B')
    await SL.restoreAfterReload($2, {} as never)
    await drain()
    await gather($2)
    await h2['turn.complete']($2, tokens('b1', 5), async () => ({}))
    await drain()
    await end(h2, $2)
    const storedB = sessValue(persisted, 'B') as { agents: { map: [string, { name: string }][] } }
    expect({ bounded: storedB.agents.map.every(([, r]) => r.name.length <= 200), size: JSON.stringify(storedB).length < 4 * 1024 * 1024 }).toEqual({ bounded: true, size: true })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р7

// #551 §3.10: another process publishes under a key of its own — nothing of
// this module's is written over, the read-back reads this module's own
// publication and puts nothing; both stay, the newest by (seq, origin) is read
test('S4F7 Р7 foreign: a foreign publication below this module\'s seq draws no write at the read-back; both stay', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const mine = sessValue(persisted, 'A') as Record<string, unknown> & { seq: number }
    const theirs = v3Key(NS_SESS, 'A', EXT_WRITER, 1)
    persisted.set(theirs, { ...clone(mine), seq: mine.seq - 10000 * 1000, origin: 'zz', sum: { total: 555, in: 555, out: 0, cache: 0 } })
    let writes = 0
    const set = $.store.set
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) writes++
      return set(k, v)
    }
    $.t += 16000
    await gather($)
    await drain()
    expect({ writes, theirs: persisted.has(theirs), stored: total(persisted, 'sess:A') }).toEqual({ writes: 0, theirs: true, stored: 100 })
  } finally { SL.__resetState() }
})

test('S4F7 Р7 catch-up: a read-back of a foreign clock ahead raises the next write above it', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const mine = sessValue(persisted, 'A') as Record<string, unknown> & { seq: number }
    const ahead = mine.seq + 30_000_000
    // another process publishes under a key of its own (#551 §3.10)
    const theirs = v3Key(NS_SESS, 'A', EXT_WRITER, 1)
    persisted.set(theirs, { ...clone(mine), seq: ahead, origin: 'zz', sum: { total: 777, in: 777, out: 0, cache: 0 } })
    $.t += 16000
    await gather($)
    await drain()
    eventInput('turn.complete', tokens('a2', 5), 60000)
    await end(h, $)
    const next = sessValue(new Map([...persisted].filter(([k]) => k !== theirs)), 'A') as { seq: number }
    expect(next.seq).toBeGreaterThan(ahead)
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р8

test('S4F7 Р8 MB: two landed writes inside one window prune once', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    seedKeys(persisted, 40)
    const { h, $ } = await start(persisted)
    let keysCalls = 0
    const keys = $.store.keys
    $.store.keys = async () => { keysCalls++; return keys() }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    await drain()
    eventInput('turn.complete', tokens('a2', 1), 60500)
    await end(h, $)
    await drain()
    expect({ keysCalls, pruned: evicted(persisted, Array.from({ length: 9 }, (_, i) => 'sess:K' + i), 'sess:K9') }).toEqual({ keysCalls: 1, pruned: true })
  } finally { SL.__resetState() }
})

test('S4F7 Р8 recent farewell: pruning removes older seeded snapshots and retains the fresh farewell', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    seedKeys(persisted, 40)
    const { h, $ } = await start(persisted, 'K0')
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'K0') && n++ === 0) await new Promise<void>(() => {})
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('k1', 100), 60000)
    await end(h, $)
    $.session.id = async () => 'A'
    $.t += 16000
    await gather($)
    eventInput('turn.complete', tokens('a1', 5), 60000)
    await end(h, $)
    await drain()
    expect({ kept: has(persisted, 'sess:K0'), pruned: evicted(persisted, Array.from({ length: 9 }, (_, i) => 'sess:K' + (i + 1)), 'sess:K10') }).toEqual({ kept: true, pruned: true })
  } finally { SL.__resetState() }
})

test('S4F7 Р8 MC2: a key with a waiting value is never pruned', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    seedKeys(persisted, 40)
    const { h, $ } = await start(persisted, 'K0')
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'K0')) await new Promise<void>(() => {})
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('k1', 100), 60000)
    await end(h, $)
    $.t += 16000
    await gather($)
    eventInput('turn.complete', tokens('k2', 1), 60000)
    await end(h, $)
    $.t += 16000
    eventInput('turn.complete', tokens('k3', 1), 60000)
    await gather($)
    expect(seam.__sessQueue().queued).toEqual(['sess:K0'])
    $.session.id = async () => 'A'
    await gather($)
    eventInput('turn.complete', tokens('a1', 5), 60000)
    await end(h, $)
    await drain()
    expect({ kept: has(persisted, 'sess:K0'), pruned: evicted(persisted, Array.from({ length: 9 }, (_, i) => 'sess:K' + (i + 1)), 'sess:K10') }).toEqual({ kept: true, pruned: true })
  } finally { SL.__resetState() }
})

test('S4F7 Р8 MC3: a key held in FAREWELL is never pruned', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    seedKeys(persisted, 40)
    const { h, $ } = await start(persisted, 'K0')
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'K0')) throw new Error('store down')
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('k1', 100), 60000)
    await end(h, $)
    $.session.id = async () => 'A'
    await gather($)
    await drain()
    expect(seam.__sessQueue().farewell).toEqual(['K0'])
    eventInput('turn.complete', tokens('a1', 5), 60000)
    await end(h, $)
    await drain()
    expect({ kept: has(persisted, 'sess:K0'), pruned: evicted(persisted, Array.from({ length: 9 }, (_, i) => 'sess:K' + (i + 1)), 'sess:K10') }).toEqual({ kept: true, pruned: true })
  } finally { SL.__resetState() }
})

test('S4F7 Р8 ME: a key kept only after the prune\'s reads is not deleted', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    seedKeys(persisted, 40)
    const { h, $ } = await start(persisted)
    const gate = deferred<void>()
    let parked = false
    const get = $.store.get
    $.store.get = async (k: string) => {
      if (isSessKey(k, 'K0') && !parked) { parked = true; await gate.promise }
      return get(k)
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    await drain()
    expect(parked).toBe(true)
    infoInput('K0')
    gate.resolve()
    await drain()
    await drain()
    expect({ kept: has(persisted, 'sess:K0'), pruned: evicted(persisted, Array.from({ length: 9 }, (_, i) => 'sess:K' + (i + 1)), 'sess:K10') }).toEqual({ kept: true, pruned: true })
  } finally { SL.__resetState() }
})

test('S4F7 Р8 MJ: a clean prune ends the episode — a later refusal warns again', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    seedKeys(persisted, 40)
    const { h, $ } = await start(persisted)
    let refuse = false
    $.store.delete = async (k: string) => {
      if (refuse) throw new Error('delete refused')
      persisted.delete(k)
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    await drain()
    seedKeys(persisted, 40)
    refuse = true
    $.t += 16000
    eventInput('turn.complete', tokens('a2', 1), 60500)
    await end(h, $)
    await drain()
    const first = diags('session-snapshot-prune').length
    seedKeys(persisted, 40)
    refuse = false
    $.t += 16000
    eventInput('turn.complete', tokens('a3', 1), 60500)
    await end(h, $)
    await drain()
    const middle = diags('session-snapshot-prune').length
    seedKeys(persisted, 40)
    refuse = true
    $.t += 16000
    eventInput('turn.complete', tokens('a4', 1), 60500)
    await end(h, $)
    await drain()
    expect({ first, middle, second: diags('session-snapshot-prune').length }).toEqual({ first: 1, middle: 1, second: 2 })
  } finally { SL.__resetState() }
})

test('S4F7 Р8 MK: a clean read-back ends the episode — a later hanging read warns again', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const gate = deferred<unknown>()
    let calls = 0
    const get = $.store.get
    $.store.get = async (k: string) => {
      if (isSessKey(k, 'A')) {
        calls++
        if (calls === 1) await gate.promise
        if (calls === 3) await new Promise<void>(() => {})
      }
      return get(k)
    }
    $.t += 16000
    await gather($)
    $.t += 16000
    await gather($)
    const first = diags('session-snapshot-verify').length
    gate.resolve(clone(sessValue(persisted, 'A')))
    await drain()
    await drain()
    const middle = diags('session-snapshot-verify').length
    $.t += 16000
    await gather($)
    $.t += 16000
    await gather($)
    $.t += 16000
    await gather($)
    $.t += 16000
    await gather($)
    expect({ first, middle, second: diags('session-snapshot-verify').length }).toEqual({ first: 1, middle: 1, second: 2 })
  } finally { SL.__resetState() }
})

test('S4F7 Р8 ML: a promise settling after a reset does not lower the new count', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const h = handlers()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    const gate = deferred<void>()
    $.store.set = async (k: string) => {
      if (isSessKey(k, 'A')) await gate.promise
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    SL.__resetState()
    const h2 = handlers()
    const $2 = fullStand(persisted)
    await SL.restoreAfterReload($2, {} as never)
    await drain()
    let n = 0
    $2.store.set = async (k: string) => {
      if (isSessKey(k, 'A')) { n++; await new Promise<void>(() => {}) }
    }
    eventInput('turn.complete', tokens('n1', 5), 70000)
    await end(h2, $2)
    $2.t += 16000
    await gather($2)
    eventInput('turn.complete', tokens('n2', 1), 70000)
    await end(h2, $2)
    expect(n).toBe(2)
    gate.resolve()
    await drain()
    await drain()
    $2.t += 16000
    await gather($2)
    expect({ n, queued: seam.__sessQueue().queued }).toEqual({ n: 2, queued: ['sess:A'] })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р10

test('S4F7 Р10: the LANDED cap never evicts a key with an unsettled store.set', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    for (let i = 0; i < 34; i++) persisted.set('sess:S' + i, SNAP(i, (1000 + i) * 1000))
    const { h, $ } = await start(persisted, 'S0')
    $.store.set = async (k: string) => {
      if (isSessKey(k, 'S1')) await new Promise<void>(() => {})
      throw new Error('store down')
    }
    for (let i = 1; i < 34; i++) {
      $.session.id = async () => 'S' + i
      await gather($)
      if (i === 1) {
        eventInput('turn.complete', tokens('s1', 1), 60000)
        await end(h, $)
      }
    }
    const landed = landedKeys()
    expect({ size: landed.length, hung: landed.includes('sess:S1') }).toEqual({ size: 32, hung: true })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р11

test('S4F7 Р11: the fallback origin is sixteen hex characters, never empty', async () => {
  SL.__resetState()
  try {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const origin = seam.__fallbackOrigin!()
      expect(origin).toMatch(/^[0-9a-f]{16}$/)
      seen.add(origin)
    }
    expect(seen.size).toBeGreaterThan(1)
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р12

test('S4F7 Р12: a snapshot the store copy cannot carry does not hold session.end\'s next', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const snap = SNAP(50, 42_000_000_000)
    persisted.set('sess:A', snap)
    const { h, $ } = await start(persisted)
    // CONSTRAINT (S4-FIX12): restore cannot carry a cyclic `turn` into the
    // live state any more (applySnapshot drops a non-string turn — the law
    // S4F11b К3 pins), so the un-copyable snapshot reaches the live state
    // only through __setFamState, the set seam that exists for this carrier
    const live = ((SL.__stateSnapshot()['famStates'] as Array<[unknown, any]>).find(([f]) => f === FAMILIES[0])![1])
    const cyclic: Record<string, unknown> = { name: 'n', desc: 'd', model: 'm', status: 'running', at: 1, doneAt: 0 }
    cyclic['turn'] = cyclic
    const map = new Map(live.agents.map as Map<string, unknown>)
    map.set('ag', cyclic)
    ;(SL as unknown as { __setFamState: (fam: unknown, st: unknown) => void }).__setFamState(FAMILIES[0], { ...live, agents: { map, done: [...live.agents.done as string[]] } })
    let nextCalled = false
    await h['session.end']($, {}, async () => { nextCalled = true; return {} })
    await drain()
    const d = diags('session-snapshot-copy')
    expect({ nextCalled, count: d.length, text: d[0]?.text.includes('could not be copied') }).toEqual({ nextCalled: true, count: 1, text: true })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- S4-FIX7b

test('S4F7b Р1: an unserializable 0.5.0 value in LANDED is diagnosed at the requeue, the gather continues', async () => {
  SL.__resetState()
  try {
    // #551 §3.10: the requeue runs when this environment's own publication is
    // gone at the read-back — one landed before a reload whose restore then
    // learns the 0.5.0 value above it, and another process's prune takes it
    const persisted = new Map<string, unknown>()
    const { h, $ } = await start(persisted)
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const own = sessKeys(persisted, 'A')
    const cyc: Record<string, unknown> = { name: 'n', desc: 'd', model: 'm', status: 'running', at: 1, doneAt: 0 }
    cyc['turn'] = cyc
    const seed = SNAP(50, 42_000_000_000)
    seed['origin'] = ''
    seed['agents'] = { map: [['ag', cyc]], done: [] }
    persisted.set('sess:A', seed)
    handlers()
    const $2 = fullStand(persisted)
    await SL.restoreAfterReload($2, {} as never)
    await drain()
    for (const k of own) persisted.delete(k)
    $2.t += 16000
    await gather($2)
    const d = diags('session-snapshot-copy')
    expect({ own: own.length, count: d.length, text: d[0]?.text.includes('could not be copied') }).toEqual({ own: 1, count: 1, text: true })
    await gather($2)
    expect({ count: diags('session-snapshot-copy').length, stored: total(persisted, 'sess:A'), queued: seam.__sessQueue().queued }).toEqual({ count: 1, stored: 50, queued: [] })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р9

test('S4F7 Р9: a value displaced at session.end is reported, never silent', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    let n = 0
    $.store.set = async (k: string) => {
      if (isSessKey(k, 'A')) { n++; await new Promise<void>(() => {}) }
    }
    await h['turn.complete']($, tokens('a1', 100), async () => ({}))
    await drain()
    $.t += 16000
    eventInput('turn.complete', tokens('b1', 20), 60000)
    await gather($)
    $.t += 16000
    eventInput('turn.complete', tokens('c1', 30), 60000)
    await gather($)
    expect({ n, queued: seam.__sessQueue().queued }).toEqual({ n: 2, queued: ['sess:A'] })
    await end(h, $)
    const blocked = diags('session-snapshot-blocked')
    const endRecords = diags('session-snapshot-end').map((d) => d.text)
    expect({ blocked: blocked.length, names: blocked[0]?.text.includes('sess:A'), endRecords }).toEqual({ blocked: 1, names: true, endRecords: [] })
  } finally { SL.__resetState() }
})
