import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data'
import type { Source } from '../hooks/data/types'
import { isSessKey, sessValue } from './world'

// S4-FIX5 (BRIEF-S4-FIX5 Р1–Р9): the per-key write order `seq`, one farewell
// attempt per gather, the hung-write watchdog, the queue wipe, the two stale
// causes, the immutable agent record, and a tooth for each FIX4 mutation
// X1–X11 but X10, whose branch no reachable state enters.
// CONSTRAINT (measured, the header of template.test.ts): the kit loads the
// folder plugin once; the teeth run against the imported module instance.

const drain = async (): Promise<void> => {
  for (let i = 0; i < 240; i++) await Promise.resolve()
}
const eventInput = (event: string, data: unknown, now = 0): void => SL.__feed({ source: { kind: 'event', event } as Source, ok: true, data, now })
const infoInput = (id: string, turns = 0): void => SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id, turns }, now: 0 })
const tokens = (turnId: string, n: number) => ({ turnId, usage: { input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
const value = (id: string, variant?: string): any => SL.valueOf(id, variant, {}, SL.buildNf({ numTokens: 'raw' }))!.value
const famBase = (): any => ((SL.__stateSnapshot()['famStates'] as Array<[unknown, any]>).find(([fam]) => fam === FAMILIES[0])![1])
const clone = (v: unknown): any => JSON.parse(JSON.stringify(v))
// the newest snapshot of the session of the logical key `sess:<id>`, both forms (#551 §3.10)
const total = (m: Map<string, unknown>, k: string): number | undefined => (sessValue(m, k.slice('sess:'.length)) as { sum?: { total: number } } | undefined)?.sum?.total

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

type Timer = { ms: number; fn: () => void; cancelled: boolean }

const fullStand = (persisted = new Map<string, unknown>(), id = 'A'): any => {
  const timers: Timer[] = []
  return {
    timers,
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
    clock: {
      now: async () => 61000,
      every: () => ({ cancel() {} }),
      after: (ms: number, fn: () => void) => {
        const t: Timer = { ms, fn, cancelled: false }
        timers.push(t)
        return { cancel() { t.cancelled = true } }
      },
    },
    plugin: { name: 'catalyst-statusline', root: '/stand' },
    ui: { log: async () => undefined, status: () => undefined, invalidate: () => undefined },
  }
}

// fires every uncancelled 15000-ms timer of the stand once: write watchdogs and clock-read boundaries share STORE_HANG_MS (statusline.ts:165)
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

const SNAP = (sum: number, seq?: number): Record<string, unknown> => ({
  sum: { total: sum, in: sum, out: 0, cache: 0 },
  seenTurns: [],
  tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, byName: [], done: [] },
  agents: { map: [], done: [] },
  started: true, resumed: false, resumedDecided: true, mainTurns: 0,
  ...(seq === undefined ? {} : { seq }),
})

// ---------------------------------------------------------------- Р1

test('S4F5 P1 (Р1): a refused farewell never lands over a newer write of the same key; restore sees it', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    let refuseA = false
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && refuseA) throw new Error('store down')
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    $.session.id = async () => 'B'
    refuseA = true
    await SL.__refresh($)
    await drain()
    $.session.id = async () => 'A'
    await SL.__refresh($)
    await drain()
    const liveAfterRestore = famBase().sum?.total
    refuseA = false
    eventInput('turn.complete', tokens('a3', 7), 62000)
    await end(h, $)
    const afterNewer = total(persisted, 'sess:A')
    await SL.__refresh($)
    await drain()
    expect({ liveAfterRestore, afterNewer, afterG3: total(persisted, 'sess:A'), live: famBase().sum?.total }).toEqual({ liveAfterRestore: 150, afterNewer: 157, afterG3: 157, live: 157 })
    expect(SL.__diag().some((d) => d.key === 'stale-write' && d.kind === 'debug')).toBe(true)
  } finally { SL.__resetState() }
})

test('S4F5 P2 (Р1): without any refusal, restore of a resumed session sees its slow farewell in flight', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate = deferred<void>()
    let hold = false
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && hold) { hold = false; await gate.promise }
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    $.session.id = async () => 'B'
    hold = true
    await SL.__refresh($)
    await drain()
    $.session.id = async () => 'A'
    await SL.__refresh($)
    await drain()
    const liveAfterRestore = famBase().sum?.total
    eventInput('turn.complete', tokens('a3', 7), 62000)
    await end(h, $)
    gate.resolve()
    await drain()
    await drain()
    expect({ liveAfterRestore, stored: total(persisted, 'sess:A'), live: famBase().sum?.total }).toEqual({ liveAfterRestore: 150, stored: 157, live: 157 })
  } finally { SL.__resetState() }
})

test('S4F5 Р1 seq: every stored value carries its seq, strictly growing on the key', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const seqs: unknown[] = []
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) seqs.push((v as { seq?: unknown }).seq)
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 10), 60500)
    await end(h, $)
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    await SL.__refresh($)
    await drain()
    // two session writes, then the farewell
    expect(seqs.length).toBe(3)
    expect(seqs.every((s) => typeof s === 'number' && s > 0)).toBe(true)
    expect((seqs[1] as number) > (seqs[0] as number) && (seqs[2] as number) > (seqs[1] as number)).toBe(true)
  } finally { SL.__resetState() }
})

test('S4F5 Р1 equal milliseconds: writes captured within one clock reading all land, in order', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const log: number[] = []
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) log.push((v as { sum: { total: number } }).sum.total)
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 10), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a3', 1), 60000)
    await end(h, $)
    expect(log).toEqual([100, 110, 111])
    expect(total(persisted, 'sess:A')).toBe(111)
  } finally { SL.__resetState() }
})

test('S4F5 Р1 clock gone back: the seq read back at restore keeps the next write above it', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    // stored by an earlier process whose clock read 99 s; this one reads 61 s
    const persisted = new Map<string, unknown>([['sess:A', SNAP(500, 99000 * 1000)]])
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    expect(famBase().sum?.total).toBe(500)
    eventInput('turn.complete', tokens('a1', 7), 61000)
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(507)
    expect(((sessValue(persisted, 'A') as { seq: number }).seq) > 99000 * 1000).toBe(true)
    expect(SL.__diag().some((d) => d.key === 'stale-write')).toBe(false)
  } finally { SL.__resetState() }
})

test('S4F5 Р1 queue order: an old farewell flushed behind newer queued writes does not replace them', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    let refuse = false
    let park: { promise: Promise<void> } | null = null
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && refuse) throw new Error('store down')
      if (isSessKey(k, 'A') && park !== null) { const p = park; park = null; await p.promise }
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    refuse = true
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    $.session.id = async () => 'A'
    await SL.__refresh($)
    await drain()
    expect(famBase().sum?.total).toBe(150)
    refuse = false
    const gate = deferred<void>()
    park = gate
    eventInput('turn.complete', tokens('a3', 7), 62000)
    await end(h, $)
    eventInput('turn.complete', tokens('a4', 3), 62500)
    await end(h, $)
    // the returned farewell A(150) is flushed while A(157) flies and A(160) waits
    await SL.__refresh($)
    await drain()
    gate.resolve()
    await drain()
    await drain()
    expect(total(persisted, 'sess:A')).toBe(160)
  } finally { SL.__resetState() }
})

test('S4F5 Р1 another writer: a queued value older than the one read back at restore is not written', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    // the next write of A lands at once and is acknowledged late
    const gate = deferred<void>()
    let lateAck = true
    $.store.set = async (k: string, v: unknown) => {
      persisted.set(k, clone(v))
      if (isSessKey(k, 'A') && lateAck) { lateAck = false; await gate.promise }
    }
    eventInput('turn.complete', tokens('a2', 10), 60500)
    await end(h, $)
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    persisted.set('sess:A', SNAP(900, 1_000_000_000))
    $.session.id = async () => 'A'
    await SL.__refresh($)
    await drain()
    expect(famBase().sum?.total).toBe(900)
    gate.resolve()
    await drain()
    await drain()
    expect(total(persisted, 'sess:A')).toBe(900)
  } finally { SL.__resetState() }
})

test('S4F5 Р1 another writer: a refused farewell of the current session older than the value read back stays out of FAREWELL; the store keeps the value read back', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    const gate = deferred<void>()
    let park = true
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && park) { park = false; await gate.promise; throw new Error('store down') }
      persisted.set(k, clone(v))
    }
    await SL.__refresh($)
    await drain()
    persisted.set('sess:A', SNAP(900, 80_000_000_000))
    $.session.id = async () => 'A'
    await SL.__refresh($)
    await drain()
    expect(famBase().sum?.total).toBe(900)
    gate.resolve()
    await drain()
    expect(SL.__sessQueue().farewell.includes('A')).toBe(false)
    await SL.__refresh($)
    await drain()
    expect(total(persisted, 'sess:A')).toBe(900)
  } finally { SL.__resetState() }
})

test('S4F5 Р1 restore sees a value queued behind a flight of its key', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate = deferred<void>()
    let park = false
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && park) { park = false; await gate.promise }
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    park = true
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    $.session.id = async () => 'A'
    await SL.__refresh($)
    await drain()
    expect(famBase().sum?.total).toBe(150)
    gate.resolve()
    await drain()
    await drain()
    expect(total(persisted, 'sess:A')).toBe(150)
  } finally { SL.__resetState() }
})

test('S4F5 Р1 an absurd clock does not stall the order', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    $.clock.now = async () => 9_100_000_000_000
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 10), 60000)
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(110)
  } finally { SL.__resetState() }
})

test('S4F5 Р1 an absurd stored seq does not stall the order', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>([['sess:A', SNAP(500, Number.MAX_SAFE_INTEGER)]])
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 7), 61000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 1), 61000)
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(508)
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р2

test('S4F5 P4 (Р2): a refused farewell is tried once per gather, at its start, with one fail record per episode', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    let attempts = 0
    let refuse = false
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && refuse) { attempts++; throw new Error('store down') }
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    refuse = true
    $.session.id = async () => 'B'
    const failsOf = (): number => SL.__diag().filter((d) => d.key === 'session-snapshot-write').length
    const d0 = failsOf()
    await SL.__refresh($)
    await drain()
    // the switching gather takes the farewell; the next gather's start writes it
    const inCapturingGather = attempts
    const perGather: number[] = []
    for (let i = 0; i < 10; i++) {
      const before = attempts
      await SL.__refresh($)
      await drain()
      perGather.push(attempts - before)
    }
    expect({ inCapturingGather, perGather, failRecords: failsOf() - d0 }).toEqual({ inCapturingGather: 0, perGather: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], failRecords: 1 })
    expect(SL.__diag().filter((d) => d.key === 'session-snapshot-write').every((d) => d.text.includes('of A') && d.text.includes('the next gather retries it once'))).toBe(true)
  } finally { SL.__resetState() }
})

test('S4F5 P5 (Р2): six waiting farewells cost six attempts in a gather, one per key', async () => {
  SL.__resetState()
  try {
    handlers()
    const $ = fullStand(new Map())
    let attempts = 0
    let refuse = false
    const perKey = new Map<string, number>()
    // per logical key `sess:<id>`: a publication carries its session (#551 §3.10)
    $.store.set = async (k: string, v?: unknown) => {
      if (refuse && isSessKey(k)) {
        attempts++
        const lk = 'sess:' + String((v as { session?: unknown } | undefined)?.session)
        perKey.set(lk, (perKey.get(lk) ?? 0) + 1)
        throw new Error('down')
      }
    }
    $.store.get = async () => undefined
    await SL.restoreAfterReload($, {} as never)
    await drain()
    refuse = true
    for (let i = 0; i < 6; i++) {
      const id = 'S' + i
      $.session.id = async () => id
      await SL.__refresh($)
      await drain()
      eventInput('turn.complete', tokens('t' + i, 1), 60000 + i)
    }
    const before = attempts
    perKey.clear()
    await SL.__refresh($)
    await drain()
    expect({ attempts: attempts - before, keys: [...perKey.entries()].sort() }).toEqual({
      attempts: 6,
      keys: [['sess:A', 1], ['sess:S0', 1], ['sess:S1', 1], ['sess:S2', 1], ['sess:S3', 1], ['sess:S4', 1]],
    })
  } finally { SL.__resetState() }
})

test('S4F5 Р2 a synchronous refusal of the store costs one attempt per gather', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    let attempts = 0
    let refuse = false
    $.store.set = (k: string, v: unknown): Promise<void> => {
      if (isSessKey(k, 'A') && refuse) {
        attempts++
        // bounds a loop that would retry forever: the 51st attempt is taken
        if (attempts > 50) return Promise.resolve()
        throw new Error('sync refusal')
      }
      persisted.set(k, clone(v))
      return Promise.resolve()
    }
    refuse = true
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    const before = attempts
    await SL.__refresh($)
    await drain()
    expect(attempts - before).toBe(1)
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р3

test('S4F5 P3 (Р3): a hung store.set is reported after 15 s and frees the key for the newest value', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    let calls = 0
    const hungValues: number[] = []
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) { calls++; hungValues.push((v as { sum: { total: number } }).sum.total); await new Promise<void>(() => {}) }
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    for (let i = 0; i < 5; i++) {
      eventInput('turn.complete', tokens('h' + i, 10), 60000 + i)
      await end(h, $)
      await SL.__refresh($)
      await drain()
    }
    expect(calls).toBe(1)
    expect(SL.__diag().some((d) => d.key === 'session-snapshot-hung')).toBe(false)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    const hung = SL.__diag().filter((d) => d.key === 'session-snapshot-hung')
    expect(hung.map((d) => [d.kind, d.text])).toEqual([['fail', 'store.set sess:A висит > 15 с; the next gather retries']])
    expect({ calls, hungValues }).toEqual({ calls: 2, hungValues: [10, 50] })
  } finally { SL.__resetState() }
})

test('S4F5 P3b (Р3): after a state wipe a new store receives the session although the old flight still hangs', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const $ = fullStand(new Map())
    $.store.set = async (k: string) => {
      if (isSessKey(k, 'A')) await new Promise<void>(() => {})
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('h0', 10), 60000)
    await end(h, $)
    SL.__resetState()
    const h2 = handlers()
    const persisted2 = new Map<string, unknown>()
    const $2 = fullStand(persisted2)
    await SL.restoreAfterReload($2, {} as never)
    await drain()
    eventInput('turn.complete', tokens('n1', 3), 70000)
    await end(h2, $2)
    await SL.__refresh($2)
    await drain()
    expect(total(persisted2, 'sess:A')).toBe(3)
    // the old flight's watchdog fires into the new state: nothing to report there
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    expect(SL.__diag().some((d) => d.key === 'session-snapshot-hung')).toBe(false)
  } finally { SL.__resetState() }
})

test('S4F5 Р3 own $: a write queued behind a flight goes out through its own call, not the flight', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const p1 = new Map<string, unknown>()
    const p2 = new Map<string, unknown>()
    const $1 = fullStand(p1)
    const $2 = fullStand(p2)
    const gate = deferred<void>()
    let first = true
    $1.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && first) { first = false; await gate.promise }
      p1.set(k, clone(v))
    }
    await SL.restoreAfterReload($1, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $1)
    eventInput('turn.complete', tokens('a2', 20), 61000)
    await end(h, $2)
    gate.resolve()
    await drain()
    await drain()
    expect({ first: total(p1, 'sess:A'), second: total(p2, 'sess:A') }).toEqual({ first: 100, second: 120 })
  } finally { SL.__resetState() }
})

test('S4F5 Р3 a settled write cancels its watchdog; one that fires after the settle changes nothing', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    let nowCalls = 0
    const readNow = $.clock.now
    $.clock.now = () => { nowCalls++; return readNow() }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    let storeCalls = 0
    const phaseStore = $.store
    $.store = {
      ...phaseStore,
      keys: () => { storeCalls++; return phaseStore.keys() },
      get: (key: string) => { storeCalls++; return phaseStore.get(key) },
      delete: (key: string) => { storeCalls++; return phaseStore.delete(key) },
    }
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect($.timers.every((t: Timer) => t.cancelled === true)).toBe(true)
    expect($.timers.filter((t: Timer) => t.ms === 3000).length).toBe(1)
    expect($.timers.filter((t: Timer) => t.ms === 15000).length).toBe(nowCalls + 1 + storeCalls)
    expect(storeCalls).toBeGreaterThanOrEqual(1)
    // a host that refuses the cancel: the watchdog fires after its write settled
    $.clock.after = (ms: number, fn: () => void) => {
      $.timers.push({ ms, fn, cancelled: false })
      return { cancel() { throw new Error('cancel refused') } }
    }
    const readsBefore = nowCalls
    eventInput('turn.complete', tokens('a2', 10), 60500)
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(110)
    // the write watchdog plus one uncancelled clock-read boundary per read of this phase
    expect(fireWatchdogs($)).toBe(1 + (nowCalls - readsBefore))
    await drain()
    expect(SL.__diag().some((d) => d.key === 'session-snapshot-hung')).toBe(false)
    eventInput('turn.complete', tokens('a3', 1), 61000)
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(111)
  } finally { SL.__resetState() }
})

test('S4F5 Р3 a hung flight that settles late changes nothing — the order after it holds', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate1 = deferred<void>()
    const gate2 = deferred<void>()
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) {
        n++
        if (n === 1) await gate1.promise
        else if (n === 2) await gate2.promise
      }
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    eventInput('turn.complete', tokens('a2', 10), 60500)
    await end(h, $)
    eventInput('turn.complete', tokens('a3', 1), 61000)
    await end(h, $)
    gate1.resolve()
    await drain()
    // a write after the late settle still queues behind the running flight
    eventInput('turn.complete', tokens('a4', 5), 61500)
    await end(h, $)
    gate2.resolve()
    await drain()
    await drain()
    expect(total(persisted, 'sess:A')).toBe(116)
  } finally { SL.__resetState() }
})

test('S4F5 Р3 a watchdog the host refuses to arm is reported; the write still lands', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    $.clock.after = () => { throw new Error('after refused') }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(100)
    const d = SL.__diag().filter((x) => x.key === 'session-snapshot-watchdog-sess:A')
    expect(d.map((x) => x.kind)).toEqual(['warn'])
    expect(d[0]!.text).toContain('after refused')
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р4

test('S4F5 Р4: __resetState clears the farewell queue — a farewell left by one test is not written by the next', async () => {
  SL.__resetState()
  try {
    // the Z7 residue: a completed recovery of A, then an id switch with no gather
    const $ = fullStand()
    const gate = deferred<unknown>()
    $.store.get = async (key: string) => { if (key === 'sess:A') return gate.promise }
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    infoInput('A', 1)
    gate.resolve(SNAP(40))
    await restoring
    await drain()
    infoInput('B', 5)
    SL.__resetState()
    const writes: string[] = []
    const $2 = fullStand(new Map(), 'C')
    $2.store.set = async (k: string) => { writes.push(k) }
    await SL.restoreAfterReload($2, {} as never)
    await drain()
    await SL.__refresh($2)
    await drain()
    expect(writes.filter((k) => isSessKey(k))).toEqual([])
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р6

test('S4F5 Р6 newer: a gather outrun by a newer one says so, not that the state was reset', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    let usageReads = 0
    const ugate = deferred<void>()
    $.session.usage = async () => {
      usageReads++
      if (usageReads === 1) await ugate.promise
      return {}
    }
    const g1 = SL.__refresh($)
    await drain()
    const g2 = SL.__refresh($)
    await drain()
    ugate.resolve()
    await g1
    await g2
    await drain()
    const drops = SL.__diag().filter((d) => d.key.startsWith('stale-refresh'))
    expect(drops.map((d) => d.key)).toEqual(['stale-refresh-newer'])
    expect(drops[0]!.text).toBe('refresh: outrun by a newer gather; dropped, the newer gather\'s answers stand')
  } finally { SL.__resetState() }
})

test('S4F5 Р6 reset: a gather that straddles a state reset says the state was reset', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    await SL.restoreAfterReload($, {} as never)
    await drain()
    const cgate = deferred<void>()
    $.session.cwd = async () => { await cgate.promise; return '/work/demo' }
    const g1 = SL.__refresh($)
    await drain()
    SL.__resetState()
    cgate.resolve()
    await g1
    await drain()
    const drops = SL.__diag().filter((d) => d.key.startsWith('stale-refresh'))
    expect(drops.map((d) => [d.key, d.text])).toEqual([['stale-refresh', 'refresh: begun before the state was reset; dropped, the new state decides for itself']])
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р7

test('S4F5 Р7: a hung gather is replaced by the next event gather; its late answer draws nothing', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    let invalidates = 0
    $.ui.invalidate = () => { invalidates++ }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    const mgate = deferred<void>()
    let modelReads = 0
    $.session.model = async () => {
      if (++modelReads === 1) { await mgate.promise; return 'old-model' }
      return 'new-model'
    }
    const g1 = SL.__refresh($)
    await drain()
    const beforeG2 = invalidates
    await SL.__refresh($)
    await drain()
    const shown = SL.__stateSnapshot()['refreshShown']
    const drawn = invalidates
    expect(value('model').text).toContain('new-model')
    expect({ shown, drewG2: drawn > beforeG2 }).toEqual({ shown: 2, drewG2: true })
    mgate.resolve()
    await g1
    await drain()
    expect({ model: value('model').text.includes('new-model'), shown: SL.__stateSnapshot()['refreshShown'], invalidates }).toEqual({ model: true, shown, invalidates: drawn })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р8

test('S4F5 Р8: reduce replaces a changed agent record, the previous state keeps its own', () => {
  SL.__resetState()
  try {
    infoInput('A')
    eventInput('agent.spawn', { agentId: 'a', subagentType: 'reader' }, 1000)
    const before = famBase()
    const rec = before.agents.map.get('a')
    eventInput('turn.complete', { agentId: 'a', turnId: 't1', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm2' } }, 5000)
    expect({ status: rec.status, doneAt: rec.doneAt, turn: rec.turn, model: rec.model }).toEqual({ status: 'running', doneAt: 0, turn: undefined, model: '' })
    expect(before.agents.map.get('a')).toBe(rec)
    const now = famBase().agents.map.get('a')
    expect({ status: now.status, doneAt: now.doneAt, turn: now.turn, model: now.model }).toEqual({ status: 'completed', doneAt: 5000, turn: 't1', model: 'm2' })
  } finally { SL.__resetState() }
})

test('S4F5 Р8 model: a repeated completion past the seenTurns cap updates the model on a new record', () => {
  SL.__resetState()
  try {
    infoInput('A')
    eventInput('agent.spawn', { agentId: 'a', subagentType: 'reader' }, 1000)
    eventInput('turn.complete', { agentId: 'a', turnId: 't1' }, 5000)
    // the cap (256) evicts the agent's seenTurns key
    for (let i = 0; i < 256; i++) eventInput('turn.complete', { turnId: 'm' + i }, 6000 + i)
    const before = famBase()
    const rec = before.agents.map.get('a')
    eventInput('turn.complete', { agentId: 'a', turnId: 't1', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm3' } }, 9000)
    expect({ model: rec.model, doneAt: rec.doneAt }).toEqual({ model: '', doneAt: 5000 })
    expect({ model: famBase().agents.map.get('a').model, doneAt: famBase().agents.map.get('a').doneAt }).toEqual({ model: 'm3', doneAt: 5000 })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р5: X1–X11

test('S4F5 X1: a refused farewell goes back and lands at a later gather once the store recovers', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    let refuse = false
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && refuse) throw new Error('store down')
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    refuse = true
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    await SL.__refresh($)
    await drain()
    expect(total(persisted, 'sess:A')).toBe(100)
    refuse = false
    await SL.__refresh($)
    await drain()
    expect(total(persisted, 'sess:A')).toBe(150)
  } finally { SL.__resetState() }
})

test('S4F5 X3: no farewell is taken while the old session is still recovering — its stored figures stand', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>([['sess:A', SNAP(500)]])
    const $ = fullStand(persisted)
    const gate = deferred<unknown>()
    $.store.get = async (key: string) => { if (key === 'sess:A') return gate.promise; return persisted.get(key) }
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 7), 60000)
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    gate.resolve(SNAP(500))
    await restoring
    await drain()
    await SL.__refresh($)
    await drain()
    expect(total(persisted, 'sess:A')).toBe(500)
  } finally { SL.__resetState() }
})

test('S4F5 X4: a refused farewell of the current session with a newer write queued stays out of FAREWELL; the store keeps the newest value', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate = deferred<void>()
    let park = false
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && park) { park = false; await gate.promise; throw new Error('store down') }
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    park = true
    $.session.id = async () => 'A'
    await SL.__refresh($)
    await drain()
    eventInput('turn.complete', tokens('a3', 7), 62000)
    await end(h, $)
    gate.resolve()
    await drain()
    await drain()
    expect(total(persisted, 'sess:A')).toBe(157)
    expect(SL.__sessQueue().farewell.includes('A')).toBe(false)
    await SL.__refresh($)
    await drain()
    expect(total(persisted, 'sess:A')).toBe(157)
  } finally { SL.__resetState() }
})

test('S4F5 X5: a refused farewell does not replace a newer farewell of the same session', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate = deferred<void>()
    let park = false
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && park) { park = false; await gate.promise; throw new Error('store down') }
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    // back to A: the start flush parks A(150); restore reads it from the flight
    park = true
    $.session.id = async () => 'A'
    await SL.__refresh($)
    await drain()
    eventInput('turn.complete', tokens('a3', 7), 62000)
    // away again: a newer farewell A(157) is taken while A(150) still hangs
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    gate.resolve()
    await drain()
    await drain()
    await SL.__refresh($)
    await drain()
    expect(total(persisted, 'sess:A')).toBe(157)
  } finally { SL.__resetState() }
})

test('S4F5 X6: the queued value is a copy — a later change of the live state does not reach it', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate = deferred<void>()
    let first = true
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && first) { first = false; await gate.promise }
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('agent.spawn', { agentId: 'a', subagentType: 'reader' }, 1000)
    await end(h, $)
    famBase().agents.map.get('a').status = 'changed-after-enqueue'
    gate.resolve()
    await drain()
    const stored = sessValue(persisted, 'A') as { agents: { map: [string, { status: string }][] } }
    expect(stored.agents.map[0]![1].status).toBe('running')
  } finally { SL.__resetState() }
})

test('S4F5 X7: a write that completes after a state reset is dropped aloud', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const $ = fullStand(new Map())
    const gate = deferred<void>()
    $.store.set = async (k: string) => { if (isSessKey(k, 'A')) await gate.promise }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    SL.__resetState()
    const persisted2 = new Map<string, unknown>()
    const $2 = fullStand(persisted2)
    const gate2 = deferred<void>()
    let first2 = true
    $2.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && first2) { first2 = false; await gate2.promise }
      persisted2.set(k, clone(v))
    }
    await SL.restoreAfterReload($2, {} as never)
    await drain()
    eventInput('turn.complete', tokens('n1', 5), 70000)
    await end(h, $2)
    gate.resolve()
    await drain()
    expect(SL.__diag().filter((d) => d.key === 'stale-session snapshot').map((d) => d.text)).toEqual(['session snapshot: begun before the state was reset; dropped, the new state decides for itself'])
    // the new state's queue is its own: the old completion does not free its key
    eventInput('turn.complete', tokens('n2', 3), 70500)
    await end(h, $2)
    gate2.resolve()
    await drain()
    await drain()
    expect(total(persisted2, 'sess:A')).toBe(8)
  } finally { SL.__resetState() }
})

test('S4F5 X8: a refused write of a session already switched away from is not the new session\'s failure', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate = deferred<void>()
    let park = true
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && park) { park = false; await gate.promise; throw new Error('store down') }
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    gate.resolve()
    await drain()
    expect(SL.__diag().filter((d) => d.key === 'session-snapshot-write')).toEqual([])
    expect((SL.__stateSnapshot()['recovery'] as { writePending: boolean }).writePending).toBe(false)
    // the farewell taken at the switch carries A's figures instead
    await SL.__refresh($)
    await drain()
    expect(total(persisted, 'sess:A')).toBe(100)
  } finally { SL.__resetState() }
})

test('S4F5 X11: an idle key holds no slot — a later write of it runs at once', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(100)
    expect(SL.__sessQueue().queued).toEqual([])
    eventInput('turn.complete', tokens('a2', 10), 61000)
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(110)
    expect(SL.__sessQueue().queued).toEqual([])
  } finally { SL.__resetState() }
})
