import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import type { Source } from '../hooks/data/types'
import { EXT_WRITER, NS_SESS, isSessKey, sessKeys, sessValue, v3Key } from './world'

// S4-FIX8. CONSTRAINT (measured, the header of s4-fix7.test.ts): the kit loads
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
const start = async (persisted = new Map<string, unknown>(), id = 'A'): Promise<{ h: Record<string, any>; $: any; persisted: Map<string, unknown> }> => {
  const h = handlers()
  const $ = fullStand(persisted, id)
  await SL.restoreAfterReload($, {} as never)
  await drain()
  return { h, $, persisted }
}
// CONSTRAINT (#551 D2, D8): the prune deletes publications of this version
// only — a `sess:<id>` key of the previous version younger than MARK_KEEP stays
// (s551-protocol T14); the seeds are another environment's publications
const extSess = (persisted: Map<string, unknown>, id: string, seq: number, value: Record<string, unknown>): void => {
  persisted.set(v3Key(NS_SESS, id, EXT_WRITER, seq), { ...value, session: id })
}
let extSeq = 0
const seedKeys = (persisted: Map<string, unknown>, n: number): void => {
  for (let i = 0; i < n; i++) extSess(persisted, 'K' + i, ++extSeq, SNAP(i, (1000 + i) * 1000))
}
// a snapshot of the logical key `sess:<id>` is in the store, either form
const has = (persisted: Map<string, unknown>, k: string): boolean => sessKeys(persisted, k.slice('sess:'.length)).length > 0
const evicted = (persisted: Map<string, unknown>, gone: string[], next: string): boolean => gone.every((k) => !has(persisted, k)) && has(persisted, next)
// fires the 3 s end bound the mod's own clock holds (FIX8 Ф9); watchdogs
// spliced out with it are the stand's, the test does not need them
const fireEndBound = (stand: { timers: Timer[] }): number => {
  let fired = 0
  for (const t of stand.timers.splice(0)) {
    if (t.cancelled || t.ms !== 3000) continue
    fired++
    t.fn()
  }
  return fired
}

// ---------------------------------------------------------------- Ф1

test('S4F8 Ф1: a settle that frees a limit seat runs the key\'s parked newest, no gather follows', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gates = [deferred<void>(), deferred<void>()]
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) {
        const i = n++
        if (i === 0) await new Promise<void>(() => {}) // the first flight never answers
        if (i === 1) await gates[1]!.promise
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
    // the second flight settles while the key is at its limit: the freed seat
    // itself runs the parked newest — there is no later gather to release it
    gates[1]!.resolve()
    await drain()
    await drain()
    expect({ n, stored: total(persisted, 'sess:A') }).toEqual({ n: 3, stored: 150 })
  } finally { SL.__resetState() }
})

test('S4F8 Ф1 end: the value the end parked at the limit is run by the freeing settle', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gates = [deferred<void>(), deferred<void>()]
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) {
        const i = n++
        if (i === 0) await new Promise<void>(() => {})
        if (i === 1) await gates[1]!.promise
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
    await end(h, $)
    gates[1]!.resolve()
    await drain()
    await drain()
    expect({ n, stored: total(persisted, 'sess:A') }).toEqual({ n: 3, stored: 150 })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Ф2

test('S4F8 Ф2 learn: a stored seq beyond the clock window is not learned, own writes rank above it, one clock record', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    persisted.set('sess:A', { ...SNAP(555, SEQ_CAP - 1), origin: 'zz' })
    const { h, $ } = await start(persisted)
    const clock = diags('session-snapshot-clock')
    expect({ clock: clock.length, key: clock[0]?.text.includes('sess:A'), beyond: clock[0]?.text.includes('beyond') }).toEqual({ clock: 1, key: true, beyond: true })
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect({ stored: total(persisted, 'sess:A'), clock: diags('session-snapshot-clock').length, stale: diags('stale-write').length }).toEqual({ stored: 655, clock: 1, stale: 0 })
  } finally { SL.__resetState() }
})

test('S4F8 Ф2 cap: a seqLast at the SEQ_CAP edge still writes, never ZERO', async () => {
  SL.__resetState()
  try {
    seam.__setOrigin?.('aa')
    const persisted = new Map<string, unknown>()
    persisted.set('sess:A', { ...SNAP(555, SEQ_CAP - 1), origin: '' })
    const h = handlers()
    const $ = fullStand(persisted)
    // The seq window uses epoch time, independent of the uptime seam.
    $.t = 61000
    $.wall = 4_503_599_627_000
    await SL.restoreAfterReload($, {} as never)
    await drain()
    expect(diags('session-snapshot-clock').length).toBe(0)
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const stored = sessValue(persisted, 'A') as { sum: { total: number }; seq: number }
    expect({ stored: stored.sum.total, seqAtEdge: stored.seq, stale: diags('stale-write').length }).toEqual({ stored: 655, seqAtEdge: SEQ_CAP - 1, stale: 0 })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Ф3

test('S4F8 Ф3: the requeue path bounds the rows it re-puts', async () => {
  SL.__resetState()
  try {
    // #551 §3.10: this environment's own publication gone at the read-back makes
    // the gather re-put the landed value — the only path that bypasses
    // sessWrite; the landed value is a 0.5.0 one a reload's restore learned
    // above the publication, and another process's prune takes the publication
    const persisted = new Map<string, unknown>()
    const { h, $ } = await start(persisted)
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const own = sessKeys(persisted, 'A')
    const snap = SNAP(50, 42_000_000_000)
    snap['agents'] = { map: [['old', { name: 'x'.repeat(40_000), desc: 'd', model: 'm', status: 'running', at: 1, doneAt: 0 }]], done: [] }
    persisted.set('sess:A', { ...snap, origin: '' })
    handlers()
    const $2 = fullStand(persisted)
    await SL.restoreAfterReload($2, {} as never)
    await drain()
    for (const k of own) persisted.delete(k)
    $2.t += 16000
    await gather($2)
    expect(own.length).toBe(1)
    const stored = sessValue(persisted, 'A') as { agents: { map: [string, { name: string }][] }; sum: { total: number } }
    expect({ name: stored.agents.map[0]![1]!.name.length, stored: stored.sum.total, size: JSON.stringify(stored).length < 4 * 1024 * 1024 }).toEqual({ name: 200, stored: 50, size: true })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Ф4

test('S4F8 Ф4: every row of the stored record is bounded, seenTurns ids of a live capture', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    for (let i = 0; i < 300; i++) eventInput('turn.complete', tokens('t'.repeat(17_000) + ':' + String(i), 1), 60000)
    eventInput('turn.complete', tokens('z', 100), 60000)
    await end(h, $)
    const stored = sessValue(persisted, 'A') as { seenTurns: string[] }
    expect({ turns: stored.seenTurns.length, bounded: stored.seenTurns.every((id) => id.length <= 200), size: JSON.stringify(stored).length < 4 * 1024 * 1024 }).toEqual({ turns: 256, bounded: true, size: true })
  } finally { SL.__resetState() }
})

test('S4F8 Ф4 model: the model row of an agent record is bounded', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    await h['agent.spawn']($, { subagentType: 'nm', description: 'd', model: 'm'.repeat(30_000) }, async () => ({ agentId: 'ag1' }))
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const stored = sessValue(persisted, 'A') as { agents: { map: [string, { model: string }][] } }
    expect(stored.agents.map[0]![1]!.model.length).toBeLessThanOrEqual(200)
  } finally { SL.__resetState() }
})

test('S4F8 Ф4 desc: the desc row of a 0.5.0 store value is bounded at the re-write', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    // desc is bounded at capture (base.ts:361) — the unbounded source is a
    // 0.5.0 store value read back and written again by this module
    const snap = SNAP(50, 42_000_000_000)
    snap['agents'] = { map: [['old', { name: 'n', desc: 'x'.repeat(30_000), model: 'm', status: 'running', at: 1, doneAt: 0 }]], done: [] }
    persisted.set('sess:A', { ...snap, origin: '' })
    const { h, $ } = await start(persisted)
    eventInput('turn.complete', tokens('a1', 5), 60000)
    await end(h, $)
    const stored = sessValue(persisted, 'A') as { agents: { map: [string, { desc: string }][] } }
    expect(stored.agents.map[0]![1]!.desc.length).toBeLessThanOrEqual(200)
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Ф5

test('S4F8 Ф5 MC1: a foreign low-ord overwrite does not delete a key whose newest write hangs', async () => {
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
    // the farewell of K0 landed through the end; the key keeps only its
    // unsettled store.set — another process overwrites the store value low
    $.t += 16000
    extSess(persisted, 'K0', ++extSeq, SNAP(9, 1))
    for (let i = 0; i < 12; i++) extSess(persisted, 'J' + i, ++extSeq, SNAP(i, (5000 + i) * 1000))
    eventInput('turn.complete', tokens('a2', 1), 60000)
    await end(h, $)
    expect({ kept: has(persisted, 'sess:K0'), pruned: evicted(persisted, Array.from({ length: 12 }, (_, i) => 'sess:K' + (i + 10)), 'sess:K22') }).toEqual({ kept: true, pruned: true })
  } finally { SL.__resetState() }
})

test('S4F8 Ф5 MC2: a key whose waiting value survived a late refusal is never pruned', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    seedKeys(persisted, 40)
    const { h, $ } = await start(persisted, 'K0')
    const gates = [deferred<void>(), deferred<void>()]
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'K0')) {
        const i = n++
        if (i === 0) { await gates[0]!.promise; throw new Error('late refusal') }
        if (i === 1) await gates[1]!.promise
        if (i >= 2) await new Promise<void>(() => {})
      }
      persisted.set(k, clone(v))
    }
    await h['turn.complete']($, tokens('k1', 100), async () => ({}))
    await drain()
    $.t += 16000
    eventInput('turn.complete', tokens('k2', 20), 60000)
    await gather($)
    await h['turn.complete']($, tokens('k3', 30), async () => ({}))
    await drain()
    $.session.id = async () => 'A'
    await gather($)
    $.t += 16000
    await gather($)
    gates[1]!.resolve()
    await drain()
    gates[0]!.resolve()
    await drain()
    $.t += 16000
    eventInput('turn.complete', tokens('a1', 5), 60000)
    await end(h, $)
    expect({ kept: has(persisted, 'sess:K0'), pruned: evicted(persisted, Array.from({ length: 9 }, (_, i) => 'sess:K' + (i + 1)), 'sess:K10') }).toEqual({ kept: true, pruned: true })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Ф6

test('S4F8 Ф6: an agent.spawn snapshot is written with no gather and no session.end after it', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gates = [deferred<void>(), deferred<void>()]
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) {
        const i = n++
        if (i === 0) await new Promise<void>(() => {})
        if (i === 1) await gates[1]!.promise
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
    gates[1]!.resolve()
    await drain()
    await drain()
    // agent.spawn writes its snapshot and returns — its handler has no tail
    // refresh; the value must land on the enqueue paths alone
    await h['agent.spawn']($, { subagentType: 'nm', description: 'd', model: 'm' }, async () => ({ agentId: 'ag9' }))
    await drain()
    await drain()
    const stored = sessValue(persisted, 'A') as { agents: { map: [string, { name: string }][] }; sum: { total: number } }
    expect({ agent: stored.agents.map.some(([id]) => id === 'ag9'), stored: stored.sum.total }).toEqual({ agent: true, stored: 150 })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Ф7

test('S4F8 Ф7: the end record never claims the value unstored, only that store.set did not settle', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    // the value reaches the store; the promise never settles — the record may
    // not say the value was not stored
    $.store.set = async (k: string, v: unknown) => {
      persisted.set(k, clone(v))
      if (isSessKey(k, 'A')) await new Promise<void>(() => {})
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const d = diags('session-snapshot-end')
    expect({ count: d.length, text: d[0]?.text, stored: total(persisted, 'sess:A') }).toEqual({
      count: 1,
      text: 'store.set sess:A did not settle before the session ended; the value may not be stored',
      stored: 100,
    })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Ф8

test('S4F8 Ф8: a value displaced by a later end is not settled early, the earlier end waits it in full', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    $.store.set = async (k: string) => {
      if (isSessKey(k, 'A')) await new Promise<void>(() => {})
    }
    await h['turn.complete']($, tokens('a1', 100), async () => ({}))
    await drain()
    $.t += 16000
    eventInput('turn.complete', tokens('b1', 20), 60000)
    await gather($)
    const sleep = deferred<void>()
    $.process.run = async () => { await sleep.promise; return { exitCode: 0, stdout: '', stderr: '' } }
    let e1 = false
    void h['session.end']($, {}, async () => ({})).then(() => { e1 = true })
    await drain()
    expect(e1).toBe(false)
    let e2 = false
    void h['session.end']($, {}, async () => ({})).then(() => { e2 = true })
    await drain()
    // the second end's snapshot displaces the first end's parked value; the
    // first end must keep waiting it — a settle at displacement would end it
    expect(e1).toBe(false)
    sleep.resolve()
    await drain()
    await drain()
    expect({ e1, e2 }).toEqual({ e1: true, e2: true })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Ф9

test('S4F8 Ф9 timer: endWait is bounded by the mod clock too, an eternal process.run does not hold the end', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    $.store.set = async (k: string) => {
      if (isSessKey(k, 'A')) await new Promise<void>(() => {})
    }
    $.process.run = async () => { await new Promise<void>(() => {}) }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    let ended = false
    void h['session.end']($, {}, async () => ({})).then(() => { ended = true })
    await drain()
    expect(ended).toBe(false)
    const fired = fireEndBound($)
    await drain()
    await drain()
    const d = diags('session-snapshot-end')
    expect({ fired, ended, records: d.length }).toEqual({ fired: 1, ended: true, records: 1 })
  } finally { SL.__resetState() }
})
