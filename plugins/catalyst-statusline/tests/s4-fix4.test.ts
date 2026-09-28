import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data'
import type { Source } from '../hooks/data/types'

// S4-FIX4 (ADJUDICATION-S4-FIX3 Р1–Р7): the farewell queue, the one session
// write queue, the gather-wide ticket, idempotent agent completion and the
// replay-attributed mainTurnsAtInfo. CONSTRAINT (measured, the header of
// template.test.ts): the kit loads the folder plugin once; the teeth run
// against the imported module instance.

const drain = async (): Promise<void> => {
  for (let i = 0; i < 240; i++) await Promise.resolve()
}

const eventInput = (event: string, data: unknown, now = 0): void => SL.__feed({ source: { kind: 'event', event } as Source, ok: true, data, now })
const infoInput = (id: string, turns = 0): void => SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id, turns }, now: 0 })
const tokens = (turnId: string, n: number) => ({ turnId, usage: { input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
const value = (id: string, variant?: string): any => SL.valueOf(id, variant, {}, SL.buildNf({ numTokens: 'raw' }))!.value
const famBase = (): any => ((SL.__stateSnapshot()['famStates'] as Array<[unknown, any]>).find(([fam]) => fam === FAMILIES[0])![1])
const clone = (v: unknown): any => JSON.parse(JSON.stringify(v))

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const fullStand = (persisted = new Map<string, unknown>(), id = 'A'): any => ({
  store: {
    get: async (k: string) => persisted.get(k),
    set: async (k: string, v: unknown) => { persisted.set(k, clone(v)) },
    delete: async (k: string) => { persisted.delete(k) },
  },
  session: { id: async () => id, turns: async () => 0, cwd: async () => '/work/demo', root: async () => '/work/demo', model: async () => 'live-model', usage: async () => ({}), messages: async () => [] },
  config: { list: async () => [] },
  env: { get: async () => '' },
  fs: { read: async () => '' },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  clock: { now: async () => 61000, every: () => ({ cancel() {} }) },
  plugin: { name: 'catalyst-statusline', root: '/stand' },
  ui: { log: async () => undefined, status: () => undefined, invalidate: () => undefined },
})

const handlers = (): Record<string, any> => {
  const h: Record<string, any> = {}
  SL.register(((event: string, fn: unknown) => { h[event] = fn }) as never, {} as never)
  return h
}

test('S4F4 Z1: the farewell carries the turns that landed mid-gather, not the gather-start figures', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const writesA: number[] = []
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A') writesA.push((v as { sum: { total: number } | null }).sum?.total ?? -1)
      persisted.set(k, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await h['session.end']($, {}, async () => ({}))
    await drain()
    expect((persisted.get('sess:A') as { sum: { total: number } }).sum.total).toBe(100)
    const gate = deferred<void>()
    let first = true
    $.session.id = async () => {
      if (first) { first = false; await gate.promise }
      return 'B'
    }
    const gather = SL.__refresh($)
    await drain()
    // the mid-gather turn of the OLD session, stored by its own session.end
    eventInput('turn.complete', tokens('a2', 50), 61000)
    await h['session.end']($, {}, async () => ({}))
    await drain()
    expect((persisted.get('sess:A') as { sum: { total: number } }).sum.total).toBe(150)
    const beforeSwitch = writesA.length
    gate.resolve()
    await gather
    await drain()
    // FIX5 Р2: the switching gather only takes the farewell; the next gather's
    // start writes it, and it carries the mid-gather turn: it must not roll
    // the stored 150 back to the gather's start
    expect(writesA.length).toBe(beforeSwitch)
    await SL.__refresh($)
    await drain()
    expect(writesA.length).toBe(beforeSwitch + 1)
    expect(writesA[writesA.length - 1]).toBe(150)
    expect((persisted.get('sess:A') as { sum: { total: number } }).sum.total).toBe(150)
  } finally { SL.__resetState() }
})

test('S4F4 Z2a: a gather outrun after its switching dispatch still leaves the old session stored', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    $.session.id = async () => 'B'
    let usageReads = 0
    const ugate = deferred<void>()
    $.session.usage = async () => {
      usageReads++
      if (usageReads === 1) await ugate.promise
      return {}
    }
    const g1 = SL.__refresh($)
    await drain()
    expect(famBase().session).toBe('B')
    const g2 = SL.__refresh($)
    await drain()
    ugate.resolve()
    await g1
    await g2
    await drain()
    expect(SL.__diag().some((d) => d.key === 'stale-refresh-newer')).toBe(true)
    const stored = persisted.get('sess:A') as { sum: { total: number } } | undefined
    expect(stored).toBeDefined()
    expect(stored!.sum.total).toBe(100)
  } finally { SL.__resetState() }
})

test('S4F4 Z2b: a gather outrun before its switching dispatch leaves the farewell to the next gather start', async () => {
  // the newer gather begun BEFORE the switching dispatch: its own gather-start
  // flush has nothing yet; FIX5 Р2 — the farewell waits for the next gather
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    $.session.id = async () => 'B'
    let usageReads = 0
    const ugate = deferred<void>()
    $.session.usage = async () => {
      usageReads++
      if (usageReads === 1) await ugate.promise
      return {}
    }
    const g1 = SL.__refresh($)
    const g2 = SL.__refresh($)
    await drain()
    expect(famBase().session).toBe('B')
    ugate.resolve()
    await g1
    await g2
    await drain()
    expect(SL.__diag().some((d) => d.key === 'stale-refresh-newer')).toBe(true)
    expect(persisted.get('sess:A')).toBeUndefined()
    await SL.__refresh($)
    await drain()
    const stored = persisted.get('sess:A') as { sum: { total: number } } | undefined
    expect(stored).toBeDefined()
    expect(stored!.sum.total).toBe(100)
  } finally { SL.__resetState() }
})

test('S4F4 Z3: a farewell queued behind a hung write lands after it, not under it', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate = deferred<unknown>()
    let writes = 0
    $.store.set = async (key: string, v: unknown) => {
      if (key === 'sess:A' && ++writes === 1) await gate.promise
      persisted.set(key, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await h['session.end']($, {}, async () => ({}))
    await drain()
    eventInput('turn.complete', tokens('a2', 20), 61000)
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    // FIX5 Р2: the next gather's start queues the farewell behind the hung write
    const gather = SL.__refresh($)
    await drain()
    gate.resolve()
    await gather
    await drain()
    await drain()
    expect((persisted.get('sess:A') as { sum: { total: number } }).sum.total).toBe(120)
  } finally { SL.__resetState() }
})

test('S4F4 Z4: a write requested while the hung one later refuses is still written, no new gather', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    const gate = deferred<unknown>()
    let writes = 0
    $.store.set = async (key: string, v: unknown) => {
      if (key === 'sess:A' && ++writes === 1) {
        await gate.promise
        throw new Error('store down')
      }
      persisted.set(key, clone(v))
    }
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await h['session.end']($, {}, async () => ({}))
    await drain()
    eventInput('turn.complete', tokens('a2', 20), 61000)
    await h['session.end']($, {}, async () => ({}))
    await drain()
    gate.reject(new Error('store down'))
    await drain()
    await drain()
    expect((persisted.get('sess:A') as { sum: { total: number } }).sum.total).toBe(120)
    expect(writes).toBe(2)
  } finally { SL.__resetState() }
})

test('S4F4 Z5: an old gather usage answer cannot seed the new session duration', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    let idReads = 0
    $.session.id = async () => (++idReads === 1 ? 'A' : 'B')
    let usageReads = 0
    const usageA = deferred<unknown>()
    const usageB = deferred<unknown>()
    $.session.usage = async () => {
      usageReads++
      if (usageReads === 1) return usageA.promise
      await usageB.promise
      throw new Error('usage refused')
    }
    const g1 = SL.__refresh($)
    await drain()
    const g2 = SL.__refresh($)
    await drain()
    usageA.resolve({ startedAt: 1000 })
    await g1
    await drain()
    usageB.resolve(undefined)
    await g2
    await drain()
    expect(value('dur')).toEqual({ state: 'pending' })
    expect(SL.__diag().some((d) => d.key === 'stale-refresh-newer')).toBe(true)
  } finally { SL.__resetState() }
})

test('S4F4 Z6: an agent completion repeated after the seenTurns cap changes nothing; a new turn updates in place', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    const gate = deferred<unknown>()
    $.store.get = async (key: string) => { if (key === 'sess:A') return gate.promise }
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    infoInput('A')
    eventInput('turn.complete', { agentId: 'a', turnId: 't' }, 60000)
    const snap = {
      sum: null, seenTurns: [],
      tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, byName: [], done: [] },
      agents: { map: [['a', { name: 'reader', desc: 'd', model: 'm', status: 'completed', at: 0, doneAt: 5000, turn: 't' }]], done: ['a'] },
      started: true, resumed: false, resumedDecided: true, mainTurns: 0,
    }
    gate.resolve(snap)
    await restoring
    await drain()
    expect(famBase().agents.done).toEqual(['a'])
    expect(famBase().agents.map.get('a').doneAt).toBe(5000)
    eventInput('turn.complete', { agentId: 'a', turnId: 't2' }, 70000)
    expect(famBase().agents.done).toEqual(['a'])
    expect(famBase().agents.map.get('a').doneAt).toBe(70000)
    expect(famBase().agents.map.get('a').turn).toBe('t2')
  } finally { SL.__resetState() }
})

test('S4F4 Z7: replayed recovery-window turns belong to the restored session, not the next one', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    const gate = deferred<unknown>()
    $.store.get = async (key: string) => { if (key === 'sess:A') return gate.promise }
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    // two recovery-window turns (buffered AND applied live while pending):
    // one before the info read of the still-pending session anchors the
    // baseline, exactly one AFTER it (sinceInfo = 1)
    eventInput('turn.start', { turnId: 'win1' }, 1000)
    infoInput('A', 1)
    eventInput('turn.start', { turnId: 'live-1' }, 2000)
    const snap = {
      sum: null, seenTurns: [],
      tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, byName: [], done: [] },
      agents: { map: [], done: [] },
      started: true, resumed: false, resumedDecided: false, mainTurns: 0,
    }
    gate.resolve(snap)
    await restoring
    await drain()
    // the snapshot's 0 turns plus the two buffered turns
    expect(famBase().mainTurns).toBe(2)
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id: 'B', turns: 5 }, now: 60000 })
    // only the one live post-info turn belongs to B
    expect(famBase().mainTurns).toBe(1)
    expect(famBase().priorTurns).toBe(4)
  } finally { SL.__resetState() }
})

test('S4F4 Z8: the F3 baseline moves with every info read that carries the id', () => {
  SL.__resetState()
  try {
    infoInput('A')
    eventInput('turn.start', { turnId: 'one' })
    eventInput('turn.start', { turnId: 'two' })
    infoInput('A', 2)
    eventInput('turn.start', { turnId: 'three' })
    eventInput('turn.start', { turnId: 'four' })
    eventInput('turn.start', { turnId: 'five' })
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id: 'B', turns: 5 }, now: 60000 })
    expect(famBase().mainTurns).toBe(3)
    expect(famBase().priorTurns).toBe(2)
  } finally { SL.__resetState() }
})

test('S4F4 Z9: an info read without an id does not move the F3 baseline', () => {
  SL.__resetState()
  try {
    infoInput('A')
    eventInput('turn.start', { turnId: 'one' })
    eventInput('turn.start', { turnId: 'two' })
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { turns: 2 }, now: 1000 })
    eventInput('turn.start', { turnId: 'three' })
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id: 'B', turns: 5 }, now: 60000 })
    expect(famBase().mainTurns).toBe(3)
    expect(famBase().priorTurns).toBe(2)
  } finally { SL.__resetState() }
})

test('S4F4 Z10: the real gather reads info before usage, the changed id keeps the new duration basis', async () => {
  SL.__resetState()
  try {
    const $ = fullStand(new Map(), 'A')
    await SL.restoreAfterReload($, {} as never)
    await drain()
    $.session.id = async () => 'B'
    $.session.usage = async () => ({ startedAt: 1000 })
    await SL.__refresh($)
    const v = value('dur')
    expect(v.state).toBe('ok')
    expect(v.text).toBe('1m')
  } finally { SL.__resetState() }
})

test('S4F4 Z11: the post-replay trim keeps the newest key and drops the snapshot oldest', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    const gate = deferred<unknown>()
    $.store.get = async (key: string) => { if (key === 'sess:A') return gate.promise }
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    infoInput('A')
    eventInput('turn.complete', tokens('new', 20), 60000)
    const snap = {
      sum: null, seenTurns: Array.from({ length: 256 }, (_, i) => 'main:k' + i),
      tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, byName: [], done: [] },
      agents: { map: [], done: [] },
      started: true, resumed: false, resumedDecided: true, mainTurns: 0,
    }
    gate.resolve(snap)
    await restoring
    await drain()
    const seen = famBase().seenTurns as string[]
    expect(seen).toHaveLength(256)
    expect(seen.includes('main:new')).toBe(true)
    expect(seen.includes('main:k0')).toBe(false)
    expect(value('sum').text).toBe('Σ 20')
  } finally { SL.__resetState() }
})

test('S4F4 Z12: after a reload the first gather delivers its reads, the ticket counter starts anew', async () => {
  SL.__resetState()
  try {
    const $ = fullStand(new Map(), 'A')
    await SL.restoreAfterReload($, {} as never)
    await drain()
    await SL.__refresh($)
    await SL.__refresh($)
    await SL.__refresh($)
    expect(famBase().session).toBe('A')
    SL.__resetState()
    const $2 = fullStand(new Map(), 'A')
    await SL.__refresh($2)
    await drain()
    expect(famBase().session).toBe('A')
    expect(value('model').text).toContain('live-model')
  } finally { SL.__resetState() }
})
