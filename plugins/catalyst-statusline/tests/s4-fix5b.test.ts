import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data'
import type { Source } from '../hooks/data/types'
import { dropSess, isSessKey, regressSess, sessValue } from './world'

// S4-FIX5b/5c (BRIEF-S4-FIX5b Д1–Д5, FIX5c): a hang as a refusal for the
// retry, the re-put of the newest value after a late landing, the read-back of
// the key, the session.end farewell flush, the gather-start sweep, the wipe of
// the landed record.
// CONSTRAINT (measured, the header of template.test.ts): the kit loads the
// folder plugin once; the teeth run against the imported module instance.

const drain = async (): Promise<void> => {
  for (let i = 0; i < 240; i++) await Promise.resolve()
}
const eventInput = (event: string, data: unknown, now = 0): void => SL.__feed({ source: { kind: 'event', event } as Source, ok: true, data, now })
const tokens = (turnId: string, n: number) => ({ turnId, usage: { input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
const clone = (v: unknown): any => JSON.parse(JSON.stringify(v))
// the newest snapshot of the session of the logical key `sess:<id>`, both forms (#551 §3.10)
const total = (m: Map<string, unknown>, k: string): number | undefined => (sessValue(m, k.slice('sess:'.length)) as { sum?: { total: number } } | undefined)?.sum?.total
const famBase = (): any => ((SL.__stateSnapshot()['famStates'] as Array<[unknown, any]>).find(([fam]) => fam === FAMILIES[0])![1])

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

type Timer = { ms: number; fn: () => void; cancelled: boolean }

// `stand.t` is both `$.clock.now` and the mod's process clock (the now seam);
// its watchdogs are held, fired only by the test
const fullStand = (persisted = new Map<string, unknown>(), id = 'A'): any => {
  const stand: any = {
    t: 61000,
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
    now: async () => stand.t,
    every: () => ({ cancel() {} }),
    after: (ms: number, fn: () => void) => {
      const t: Timer = { ms, fn, cancelled: false }
      stand.timers.push(t)
      return { cancel() { t.cancelled = true } }
    },
  }
  ;(SL as unknown as { __setNow?: (fn: () => number) => void }).__setNow?.(() => stand.t)
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

const hungDiag = (): string[] => SL.__diag().filter((d) => d.key === 'session-snapshot-hung').map((d) => d.text)

// ---------------------------------------------------------------- Д1

test('S4F5b Д1 session: a hung session write is retried by the next gather', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && ++n === 1) await new Promise<void>(() => {})
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    expect(total(persisted, 'sess:A')).toBeUndefined()
    await gather($)
    expect({ n, stored: total(persisted, 'sess:A'), hung: hungDiag() }).toEqual({ n: 2, stored: 100, hung: ['store.set sess:A висит > 15 с; the next gather retries'] })
  } finally { SL.__resetState() }
})

test('S4F5b Д1 farewell: a hung farewell is written once by the next gather', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    $.session.id = async () => 'B'
    await gather($)
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && ++n === 1) await new Promise<void>(() => {})
      persisted.set(k, clone(v))
    }
    await gather($)
    expect(n).toBe(1)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    await gather($)
    await gather($)
    expect({ n, stored: total(persisted, 'sess:A'), hung: hungDiag() }).toEqual({ n: 2, stored: 150, hung: ['store.set sess:A висит > 15 с; the next gather retries it once'] })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Д2

// #551 §3.10: the late landing is a publication of its own below the newer one — it deletes itself, the newest stands
test('S4F5b Д2: a hung write landing late below a newer one deletes itself and the newest value stands', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate = deferred<void>()
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && ++n === 1) await gate.promise
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
    expect(total(persisted, 'sess:A')).toBe(110)
    gate.resolve()
    await drain()
    await drain()
    expect(total(persisted, 'sess:A')).toBe(110)
  } finally { SL.__resetState() }
})

test('S4F5b Д2 generation: a flight of the wiped state landing late over the new state\'s value is followed by it at the next gather of the new state', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate = deferred<void>()
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && ++n === 1) await gate.promise
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const h2 = handlers()
    const $2 = fullStand(persisted)
    await SL.restoreAfterReload($2, {} as never)
    await drain()
    eventInput('turn.complete', tokens('n1', 5), 70000)
    await end(h2, $2)
    expect(total(persisted, 'sess:A')).toBe(5)
    gate.resolve()
    await drain()
    await drain()
    await gather($2)
    expect(total(persisted, 'sess:A')).toBe(5)
  } finally { SL.__resetState() }
})

// a newer value waiting in FAREWELL goes out at a farewell flush point (Д4)
test('S4F5b Д2 farewell: a late landing below a waiting farewell leaves it to the next gather, one write', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const gate = deferred<void>()
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && ++n === 1) await gate.promise
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a2', 50), 60500)
    await end(h, $)
    expect(fireWatchdogs($)).toBe(1)
    await drain()
    eventInput('turn.complete', tokens('a3', 7), 61000)
    $.session.id = async () => 'B'
    await gather($)
    expect(SL.__sessQueue().farewell).toEqual(['A'])
    gate.resolve()
    await drain()
    await drain()
    expect({ n, stored: total(persisted, 'sess:A'), farewell: SL.__sessQueue().farewell }).toEqual({ n: 1, stored: 150, farewell: ['A'] })
    await gather($)
    expect({ n, stored: total(persisted, 'sess:A'), farewell: SL.__sessQueue().farewell }).toEqual({ n: 2, stored: 157, farewell: [] })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Д3

// the read-back re-puts the newest known value: the landed one would replace
// a newer one waiting behind the flight
test('S4F5b Д3 newest: a read-back below the landed value puts back the newest known value, not the landed one over a waiting newer one', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const old = clone(sessValue(persisted, 'A'))
    eventInput('turn.complete', tokens('a2', 10), 60500)
    await end(h, $)
    const gate = deferred<void>()
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && ++n === 1) await gate.promise
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('a3', 5), 61000)
    await end(h, $)
    eventInput('turn.complete', tokens('a4', 1), 61000)
    await end(h, $)
    regressSess(persisted, 'A', old)
    await gather($)
    gate.resolve()
    await drain()
    await drain()
    expect({ n, stored: total(persisted, 'sess:A') }).toEqual({ n: 2, stored: 116 })
  } finally { SL.__resetState() }
})

test('S4F5b Д3 (а): a store value regressed from outside is put back by a gather after the window', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    const old = clone(sessValue(persisted, 'A'))
    eventInput('turn.complete', tokens('a2', 10), 60500)
    await end(h, $)
    await gather($)
    regressSess(persisted, 'A', old)
    await gather($)
    expect(total(persisted, 'sess:A')).toBe(100)
    $.t += 16000
    await gather($)
    expect(total(persisted, 'sess:A')).toBe(110)
    // an absent value is put back the same way
    dropSess(persisted, 'A')
    $.t += 16000
    await gather($)
    expect(total(persisted, 'sess:A')).toBe(110)
  } finally { SL.__resetState() }
})

test('S4F5b Д3 (б): within the window the store is not read back', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    let reads = 0
    $.store.get = async (k: string) => { if (isSessKey(k, 'A')) reads++; return persisted.get(k) }
    const counts: number[] = []
    await gather($)
    counts.push(reads)
    await gather($)
    counts.push(reads)
    $.t += 10000
    await gather($)
    counts.push(reads)
    $.t += 6000
    await gather($)
    counts.push(reads)
    expect(counts).toEqual([1, 1, 1, 2])
  } finally { SL.__resetState() }
})

test('S4F5b Д3 (в): a refused read-back is diagnosed once and not retried in the gather', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    let reads = 0
    $.store.get = async (k: string) => { if (isSessKey(k, 'A')) { reads++; throw new Error('store read down') } return persisted.get(k) }
    await gather($)
    $.t += 16000
    await gather($)
    const d = SL.__diag().filter((x) => x.key === 'session-snapshot-verify')
    expect({ reads, kinds: d.map((x) => x.kind) }).toEqual({ reads: 2, kinds: ['warn'] })
    expect(d[0]!.text).toContain('store read down')
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Д4

test('S4F5b Д4: a waiting farewell is written at session.end, not left for a gather', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    eventInput('turn.complete', tokens('a2', 50), 60500)
    $.session.id = async () => 'B'
    await gather($)
    expect(total(persisted, 'sess:A')).toBe(100)
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(150)
    expect(SL.__sessQueue().farewell).toEqual([])
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Р1 at the gather start
// the newer writes come from a hook that snapshots without a flush
// (agent.spawn with no agent id changes no figure): the farewell meets them at
// the gather start, not at session.end where its own flight fences it

const spawn = async (h: Record<string, any>, $: unknown): Promise<void> => {
  await h['agent.spawn']($, {}, async () => ({}))
  await drain()
}

test('S4F5b Р1 queue order via a non-flushing writer: an old farewell flushed behind newer queued writes does not replace them', async () => {
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
    await gather($)
    $.session.id = async () => 'A'
    await gather($)
    expect({ live: famBase().sum?.total, farewell: [...SL.__sessQueue().farewell].sort() }).toEqual({ live: 150, farewell: ['A', 'B'] })
    refuse = false
    const gate = deferred<void>()
    park = gate
    eventInput('turn.complete', tokens('a3', 7), 62000)
    await spawn(h, $)
    eventInput('turn.complete', tokens('a4', 3), 62500)
    await spawn(h, $)
    // the returned farewell A(150) is flushed while A(157) flies and A(160) waits
    await gather($)
    gate.resolve()
    await drain()
    await drain()
    expect(total(persisted, 'sess:A')).toBe(160)
  } finally { SL.__resetState() }
})

test('S4F5b P1 via a non-flushing writer: a refused farewell never lands over a newer write of its key that landed', async () => {
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
    await gather($)
    $.session.id = async () => 'A'
    await gather($)
    expect({ live: famBase().sum?.total, farewell: [...SL.__sessQueue().farewell].sort() }).toEqual({ live: 150, farewell: ['A', 'B'] })
    refuseA = false
    eventInput('turn.complete', tokens('a3', 7), 62000)
    await spawn(h, $)
    const afterNewer = total(persisted, 'sess:A')
    await gather($)
    expect({ afterNewer, afterGather: total(persisted, 'sess:A'), live: famBase().sum?.total }).toEqual({ afterNewer: 157, afterGather: 157, live: 157 })
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- Д5

test('S4F5b Д5: a watchdog the host never fires is stood in for by the gather-start sweep, once', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    let n = 0
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A') && ++n === 1) await new Promise<void>(() => {})
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    await gather($)
    expect(hungDiag()).toEqual([])
    $.t += 16000
    await gather($)
    expect(hungDiag().length).toBe(1)
    expect({ n, stored: total(persisted, 'sess:A') }).toEqual({ n: 2, stored: 100 })
    // the held timer firing late, and a later gather, report nothing more
    fireWatchdogs($)
    $.t += 16000
    await gather($)
    expect(hungDiag().length).toBe(1)
    expect(SL.__sessQueue().queued).toEqual([])
    expect(famBase().sum?.total).toBe(100)
  } finally { SL.__resetState() }
})

// ---------------------------------------------------------------- FIX5c

test('S4F5c R4b: a wipe forgets the landed record — the new generation neither reads back nor re-puts the old generation\'s value', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    // a key no other test lands
    const $ = fullStand(persisted, 'R4B')
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(total(persisted, 'sess:R4B')).toBe(100)
    dropSess(persisted, 'R4B')
    const h2 = handlers()
    const $2 = fullStand(persisted, 'R4B')
    await SL.restoreAfterReload($2, {} as never)
    await drain()
    let reads = 0
    // CONSTRAINT (AR-2c): T39 counts prune reads; R4b counts landed read-back.
    $2.store.get = async (k: string) => { if (isSessKey(k, 'R4B') && !SL.__inPrune()) reads++; return persisted.get(k) }
    await gather($2)
    expect({ oldLandedReadBack: reads, oldLandedReput: total(persisted, 'sess:R4B') }).toEqual({ oldLandedReadBack: 0, oldLandedReput: undefined })
    eventInput('turn.complete', tokens('n1', 5), 70000)
    await end(h2, $2)
    $2.t += 16000
    await gather($2)
    expect({ newLandedReadBack: reads, stored: total(persisted, 'sess:R4B') }).toEqual({ newLandedReadBack: 1, stored: 5 })
  } finally { SL.__resetState() }
})
