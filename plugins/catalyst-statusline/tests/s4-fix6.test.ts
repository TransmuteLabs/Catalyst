import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import type { Source } from '../hooks/data/types'

// CONSTRAINT (measured, the header of template.test.ts): the kit loads the
// folder plugin once; the teeth run against the imported module instance.

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
const total = (m: Map<string, unknown>, k: string): number | undefined => (m.get(k) as { sum?: { total: number } } | undefined)?.sum?.total
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

// `t` is the mod's process clock (the now seam); `$.clock.now` reads `wall`
// while it is set, `t` otherwise; watchdogs are held until the test fires them
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
const fireWatchdogs = (stand: { timers: Timer[] }): number => {
  let fired = 0
  for (const t of stand.timers.splice(0)) {
    if (t.cancelled || t.ms !== 15000) continue
    fired++
    t.fn()
  }
  return fired
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

// ---------------------------------------------------------------- Р1

test('S4F6 Р1 episode write: refusals of one key give one record until a write of it lands', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    let refuse = true
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A' && refuse) throw new Error('store down')
      persisted.set(k, clone(v))
    }
    const counts: number[] = []
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    counts.push(diags('session-snapshot-write').length)
    await gather($)
    counts.push(diags('session-snapshot-write').length)
    await gather($)
    counts.push(diags('session-snapshot-write').length)
    refuse = false
    await gather($)
    counts.push(diags('session-snapshot-write').length)
    expect(total(persisted, 'sess:A')).toBe(100)
    refuse = true
    eventInput('turn.complete', tokens('a2', 1), 60500)
    await end(h, $)
    counts.push(diags('session-snapshot-write').length)
    expect(counts).toEqual([1, 1, 1, 1, 2])
  } finally { SL.__resetState() }
})

test('S4F6 Р1 episode hung: hangs of one key give one record until a write of it lands', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    let slow = deferred<void>()
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A') await slow.promise
      persisted.set(k, clone(v))
    }
    const counts: number[] = []
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    counts.push(diags('session-snapshot-hung').length)
    await gather($)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    counts.push(diags('session-snapshot-hung').length)
    slow.resolve()
    await drain()
    expect(total(persisted, 'sess:A')).toBe(100)
    slow = deferred<void>()
    eventInput('turn.complete', tokens('a2', 1), 60500)
    await end(h, $)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    counts.push(diags('session-snapshot-hung').length)
    expect(counts).toEqual([1, 1, 2])
  } finally { SL.__resetState() }
})

test('S4F6 Р1 (б): a hung write of the newest value that lands late counts as landed, with no repeat', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gate = deferred<void>()
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A' && ++n === 1) await gate.promise
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    gate.resolve()
    await drain()
    const seq = (persisted.get('sess:A') as { seq: number }).seq
    await gather($)
    await gather($)
    expect({ n, landed: seam.__sessQueue().landed, farewell: seam.__sessQueue().farewell }).toEqual({ n: 1, landed: [['sess:A', seq]], farewell: [] })
  } finally { SL.__resetState() }
})

test('S4F6 Р1 late refusal: a hung write refused late is an ordinary retry with its own record', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gate = deferred<void>()
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A' && ++n === 1) {
        await gate.promise
        throw new Error('store down')
      }
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    gate.resolve()
    await drain()
    const texts = diags('session-snapshot-write').map((d) => d.text)
    await gather($)
    expect({ texts, n, stored: total(persisted, 'sess:A') }).toEqual({ texts: ['the session snapshot could not be stored: Error: store down; the next gather retries'], n: 2, stored: 100 })
  } finally { SL.__resetState() }
})

test('S4F6 Р1′ (а): a store slower than the watchdog holds at most two unsettled writes of a key, with one hung record', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    let n = 0
    $.store.set = async (k: string) => {
      if (k === 'sess:A') {
        n++
        await new Promise<void>(() => {})
      }
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    for (let i = 0; i < 10; i++) {
      $.t += 16000
      eventInput('turn.complete', tokens('b' + i, 1), 60000)
      await gather($)
    }
    expect({ n, hung: diags('session-snapshot-hung').length }).toEqual({ n: 2, hung: 1 })
  } finally { SL.__resetState() }
})

test('S4F6 Р1′ (б) (FIX8 Ф1): once one of the two unsettled writes settles, the newest value is written once, by the settle itself', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gates = [deferred<void>(), deferred<void>()]
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A') {
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
    // FIX8 Ф1: the settle that frees the seat runs the parked newest itself;
    // the gathers after it find nothing left to write
    const settled = n
    await gather($)
    const after = n
    await gather($)
    expect({ before, settled, after, again: n, stored: total(persisted, 'sess:A') }).toEqual({ before: 2, settled: 3, after: 3, again: 3, stored: 130 })
  } finally { SL.__resetState() }
})

test('S4F6 Р1′ (в): a value queued behind the second unsettled write waits when that write hangs too', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    let n = 0
    $.store.set = async (k: string) => {
      if (k === 'sess:A') {
        n++
        await new Promise<void>(() => {})
      }
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    await gather($)
    eventInput('turn.complete', tokens('a2', 5), 60000)
    await end(h, $)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    expect({ n, queued: seam.__sessQueue().queued }).toEqual({ n: 2, queued: ['sess:A'] })
  } finally { SL.__resetState() }
})

test('S4F6 AR4: a late landing of a wiped generation calls nothing through its $; the next gather of the live one writes the newest value', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const h = handlers()
    const $ = fullStand(persisted)
    const gate = deferred<void>()
    let wiped = false
    let oldCalls = 0
    const count = (): void => { if (wiped) oldCalls++ }
    let first = true
    $.store.set = async (k: string, v: unknown) => {
      count()
      if (k === 'sess:A' && first) {
        first = false
        await gate.promise
      }
      persisted.set(k, clone(v))
    }
    const get = $.store.get
    $.store.get = async (k: string) => { count(); return get(k) }
    const keys = $.store.keys
    $.store.keys = async () => { count(); return keys() }
    const after = $.clock.after
    $.clock.after = (ms: number, fn: () => void) => { count(); return after(ms, fn) }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    wiped = true
    const h2 = handlers()
    const $2 = fullStand(persisted)
    await SL.restoreAfterReload($2, {} as never)
    await drain()
    eventInput('turn.complete', tokens('n1', 5), 70000)
    await end(h2, $2)
    await gather($2)
    gate.resolve()
    await drain()
    await drain()
    const afterLanding = total(persisted, 'sess:A')
    await gather($2)
    expect({ oldCalls, afterLanding, stored: total(persisted, 'sess:A') }).toEqual({ oldCalls: 0, afterLanding: 100, stored: 5 })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р2

test('S4F6 Р2 (а): a refused clock.now and a watchdog the host never fires — the sweep runs on the process clock, one record, the key free', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    $.clock.now = async () => { throw new Error('clock refused') }
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A' && ++n === 1) await new Promise<void>(() => {})
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    await gather($)
    expect(diags('session-snapshot-hung').length).toBe(0)
    $.t += 16000
    await gather($)
    expect({ hung: diags('session-snapshot-hung').length, queued: seam.__sessQueue().queued, stored: total(persisted, 'sess:A') }).toEqual({ hung: 1, queued: [], stored: 100 })
  } finally { SL.__resetState() }
})

test('S4F6 Р2 (б) sweep: $.clock.now going back each gather does not hold the sweep — the process clock decides', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    $.wall = 61000
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A' && ++n === 1) await new Promise<void>(() => {})
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const counts: number[] = []
    for (const step of [0, 10000, 6000]) {
      $.t += step
      $.wall -= 1000
      await gather($)
      counts.push(diags('session-snapshot-hung').length)
    }
    expect(counts).toEqual([0, 0, 1])
  } finally { SL.__resetState() }
})

test('S4F6 Р2 (б) window: $.clock.now going back each gather does not move the read-back window — the process clock decides', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    $.wall = 61000
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    let reads = 0
    const get = $.store.get
    $.store.get = async (k: string) => { if (k === 'sess:A') reads++; return get(k) }
    const counts: number[] = []
    for (const step of [0, 10000, 6000]) {
      $.t += step
      $.wall -= 1000
      await gather($)
      counts.push(reads)
    }
    expect(counts).toEqual([1, 1, 2])
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р3

test('S4F6 X4 away: a refused farewell of a session switched away from, superseded by a newer farewell queued behind it, is dropped', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gate = deferred<void>()
    let park = false
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A' && park) {
        park = false
        await gate.promise
        throw new Error('store down')
      }
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    $.session.id = async () => 'B'
    await gather($)
    park = true
    $.session.id = async () => 'A'
    await gather($)
    eventInput('turn.complete', tokens('a3', 7), 62000)
    $.session.id = async () => 'B'
    await gather($)
    await gather($)
    expect(seam.__sessQueue().queued).toEqual(['sess:A'])
    gate.resolve()
    await drain()
    await drain()
    expect({ stored: total(persisted, 'sess:A'), farewell: seam.__sessQueue().farewell }).toEqual({ stored: 157, farewell: [] })
  } finally { SL.__resetState() }
})

test('S4F6 Р3 re-put: a late landing below the newest value re-puts it through the settled flight\'s own call', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const { h, $ } = await start(persisted)
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const $2 = fullStand(persisted)
    const gate = deferred<void>()
    let n2 = 0
    $2.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A' && ++n2 === 1) await gate.promise
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a2', 10), 60500)
    await end(h, $2)
    expect(fireWatchdogs($2)).toBe(1)
    await drain()
    const $3 = fullStand(persisted)
    let n3 = 0
    $3.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A') n3++
      persisted.set(k, clone(v))
    }
    await gather($3)
    expect(n3).toBe(1)
    gate.resolve()
    await drain()
    await drain()
    expect({ n2, n3, stored: total(persisted, 'sess:A') }).toEqual({ n2: 2, n3: 1, stored: 110 })
  } finally { SL.__resetState() }
})

test('S4F6 Р3 idle: a key with no slot, no farewell and not the current session leaves LANDED', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(landedKeys()).toEqual(['sess:A'])
    $.session.id = async () => 'B'
    await gather($)
    await gather($)
    expect({ farewell: seam.__sessQueue().farewell, queued: seam.__sessQueue().queued, landed: landedKeys().includes('sess:A') }).toEqual({ farewell: [], queued: [], landed: false })
  } finally { SL.__resetState() }
})

test('S4F6 Р3 hung: a key with a hung flight stays in LANDED — its late landing below the newest value is followed by it', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gate = deferred<void>()
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A' && ++n === 1) await gate.promise
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    eventInput('turn.complete', tokens('a2', 50), 60500)
    $.session.id = async () => 'B'
    await gather($)
    await gather($)
    expect({ n, stored: total(persisted, 'sess:A'), landed: landedKeys().includes('sess:A') }).toEqual({ n: 2, stored: 150, landed: true })
    gate.resolve()
    await drain()
    await drain()
    expect({ n, stored: total(persisted, 'sess:A') }).toEqual({ n: 3, stored: 150 })
  } finally { SL.__resetState() }
})

test('S4F6 Р3 cap: LANDED holds at most 32 keys, the smallest seq goes first', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    for (let i = 0; i < 34; i++) persisted.set('sess:S' + i, SNAP(i, (1000 + i) * 1000))
    const { $ } = await start(persisted, 'S0')
    $.store.set = async (k: string, v: unknown) => {
      if (k.startsWith('sess:')) throw new Error('store down')
      persisted.set(k, clone(v))
    }
    for (let i = 1; i < 34; i++) {
      const id = 'S' + i
      $.session.id = async () => id
      await gather($)
    }
    const landed = landedKeys()
    expect({ size: landed.length, lost: ['sess:S0', 'sess:S1'].filter((k) => landed.includes(k)), current: landed.includes('sess:S33') }).toEqual({ size: 32, lost: [], current: true })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р4

test('S4F6 Р4 (а): a landed write of the current session prunes the store to 32 sess keys, the oldest by seq, never the current', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    for (let i = 0; i < 40; i++) persisted.set('sess:K' + i, SNAP(i, (1000 + i) * 1000))
    persisted.set('other', 1)
    const { h, $ } = await start(persisted)
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    await drain()
    const sess = [...persisted.keys()].filter((k) => k.startsWith('sess:'))
    const gone = Array.from({ length: 40 }, (_, i) => 'sess:K' + i).filter((k) => !persisted.has(k))
    expect({ size: sess.length, current: persisted.has('sess:A'), gone, other: persisted.get('other') }).toEqual({
      size: 32, current: true, gone: Array.from({ length: 9 }, (_, i) => 'sess:K' + i), other: 1,
    })
  } finally { SL.__resetState() }
})

test('S4F6 Р4 (а) current: the current key is never pruned, the oldest by seq included', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    for (let i = 0; i < 40; i++) persisted.set('sess:K' + i, SNAP(i, (100000 + i) * 1000))
    const { h, $ } = await start(persisted)
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    await drain()
    const gone = Array.from({ length: 40 }, (_, i) => 'sess:K' + i).filter((k) => !persisted.has(k))
    expect({ current: total(persisted, 'sess:A'), gone }).toEqual({ current: 100, gone: Array.from({ length: 9 }, (_, i) => 'sess:K' + i) })
  } finally { SL.__resetState() }
})

test('S4F6 Р4 (б): a refused delete of the prune is one warn per episode', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    for (let i = 0; i < 40; i++) persisted.set('sess:K' + i, SNAP(i, (1000 + i) * 1000))
    const { h, $ } = await start(persisted)
    $.store.delete = async () => { throw new Error('delete refused') }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    await drain()
    $.t += 16000
    eventInput('turn.complete', tokens('a2', 1), 60500)
    await end(h, $)
    await drain()
    const d = diags('session-snapshot-prune')
    expect(d.map((x) => x.kind)).toEqual(['warn'])
    expect(d[0]!.text).toContain('delete refused')
  } finally { SL.__resetState() }
})

test('S4F6 Р4 (в): an agent description is stored at most 200 characters long', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    await h['agent.spawn']($, { description: 'd'.repeat(1000) }, async () => ({ agentId: 'ag1' }))
    await drain()
    const map = (persisted.get('sess:A') as { agents: { map: [string, { desc: string }][] } }).agents.map
    expect(map.map(([id, r]) => [id, r.desc.length <= 200])).toEqual([['ag1', true]])
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р5

test('S4F6 Р5: an equal seq of another origin is ordered the same way in both processes', async () => {
  const winners: string[] = []
  for (const [us, them] of [['a', 'b'], ['b', 'a']] as const) {
    SL.__resetState()
    try {
      seam.__setOrigin?.(us)
      const { h, $, persisted } = await start()
      eventInput('turn.complete', tokens('a1', 100), 60000)
      await end(h, $)
      const mine = persisted.get('sess:A') as Record<string, unknown>
      persisted.set('sess:A', { ...clone(mine), origin: them, sum: { total: 7, in: 7, out: 0, cache: 0 } })
      await gather($)
      await drain()
      winners.push(String((persisted.get('sess:A') as { origin?: unknown }).origin))
    } finally { SL.__resetState() }
  }
  expect(winners).toEqual(['b', 'b'])
})

// ---------------------------------------------------------------- Р6

test('S4F6 Р6 (а): session.end returns after its write lands, within the sleep bound', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const gate = deferred<void>()
    const runs: unknown[] = []
    const sleep = deferred<unknown>()
    $.process.run = async (argv: unknown, init: unknown) => { runs.push([argv, init]); return sleep.promise }
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A') await gate.promise
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    let ended = false
    void h['session.end']($, {}, async () => ({})).then(() => { ended = true })
    await drain()
    expect(ended).toBe(false)
    gate.resolve()
    await drain()
    expect({ ended, stored: total(persisted, 'sess:A'), runs }).toEqual({ ended: true, stored: 100, runs: [[['/bin/sleep', '3'], { timeoutMs: 5000 }]] })
    sleep.resolve({ exitCode: 0, stdout: '', stderr: '' })
  } finally { SL.__resetState() }
})

test('S4F6 Р6 (б): a hung write holds session.end only until the sleep, with the ended-session tail', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    const sleep = deferred<unknown>()
    $.process.run = async () => sleep.promise
    $.store.set = async (k: string) => { if (k === 'sess:A') await new Promise<void>(() => {}) }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    let ended = false
    void h['session.end']($, {}, async () => ({})).then(() => { ended = true })
    await drain()
    expect(ended).toBe(false)
    sleep.resolve({ exitCode: 0, stdout: '', stderr: '' })
    await drain()
    const d = SL.__diag().filter((x) => x.key.startsWith('session-snapshot-') && x.text.includes('sess:A'))
    expect({ ended, tails: d.map((x) => x.text.endsWith('; the value may not be stored')) }).toEqual({ ended: true, tails: [true] })
  } finally { SL.__resetState() }
})

test('S4F6 Р6 (в): a write refused while session.end waits carries the ended-session tail', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    const sleep = deferred<unknown>()
    $.process.run = async () => sleep.promise
    $.store.set = async (k: string) => { if (k === 'sess:A') throw new Error('store down') }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    let ended = false
    void h['session.end']($, {}, async () => ({})).then(() => { ended = true })
    await drain()
    const d = diags('session-snapshot-write')
    expect({ ended, texts: d.map((x) => x.text) }).toEqual({ ended: true, texts: ['the session snapshot could not be stored: Error: store down; the value may not be stored'] })
    sleep.resolve({ exitCode: 0, stdout: '', stderr: '' })
  } finally { SL.__resetState() }
})

test('S4F6 Р6 (г): after a refused process.run the clock bound releases session.end', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    $.process.run = async () => { throw new Error('run refused') }
    $.store.set = async (k: string) => { if (k === 'sess:A') await new Promise<void>(() => {}) }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    let ended = false
    void h['session.end']($, {}, async () => ({})).then(() => { ended = true })
    await drain()
    expect(ended).toBe(false)
    $.t += 3000
    for (const timer of $.timers as Timer[]) if (timer.ms === 3000 && !timer.cancelled) timer.fn()
    await drain()
    expect(ended).toBe(true)
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р7

test('S4F6 Р7: a hung farewell of the current session is retried as the session\'s own write, not through FAREWELL', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    $.session.id = async () => 'B'
    await gather($)
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A' && ++n === 1) await new Promise<void>(() => {})
      persisted.set(k, clone(v))
    }
    $.session.id = async () => 'A'
    await gather($)
    expect(n).toBe(1)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    const afterHang = seam.__sessQueue().farewell.includes('A')
    await gather($)
    await gather($)
    expect({ afterHang, n, stored: total(persisted, 'sess:A'), farewell: seam.__sessQueue().farewell.includes('A') }).toEqual({ afterHang: false, n: 2, stored: 150, farewell: false })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р8

test('S4F6 Р8: one read-back of a key at a time; one hanging past 15 s is one warn', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    let reads = 0
    $.store.get = async (k: string) => { if (k === 'sess:A') { reads++; await new Promise<void>(() => {}) } return undefined }
    const counts: number[] = []
    for (const step of [0, 16000, 16000]) {
      $.t += step
      await gather($)
      counts.push(reads)
    }
    const d = diags('session-snapshot-verify')
    expect({ counts, kinds: d.map((x) => x.kind), hanging: d.every((x) => x.text.includes('store.get sess:A')) }).toEqual({ counts: [1, 1, 1], kinds: ['warn'], hanging: true })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р9

test('S4F6 Р9: a watchdog refused for two keys is two records, one per key', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    $.clock.after = () => { throw new Error('after refused') }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    $.session.id = async () => 'B'
    await gather($)
    eventInput('turn.complete', tokens('b1', 5), 60500)
    await end(h, $)
    const d = SL.__diag().filter((x) => x.key.startsWith('session-snapshot-watchdog'))
    expect(d.map((x) => x.key).sort()).toEqual(['session-snapshot-watchdog-sess:A', 'session-snapshot-watchdog-sess:B'])
  } finally { SL.__resetState() }
})
