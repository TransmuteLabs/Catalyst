import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data/index'
import { snapshotText } from '../hooks/data/snapshotText'
import type { Source } from '../hooks/data/types'

// S4-FIX10. CONSTRAINT (measured, the header of s4-fix7.test.ts): the kit loads
// the folder plugin once; the teeth run against the imported module instance.
// CONSTRAINT: the stands drive only the session write queue and the family
// dispatch; `t` is the mod's process clock (the now seam), watchdogs and the
// end bound are held until the test fires them.

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
const REC = { name: 'n', desc: 'd', model: 'm', status: 'running', at: 1, doneAt: 0 }
const SEQ_CAP = 2 ** 52
const EPOCH = 1_780_000_000_000

const clockStart = async (seq: number, wall = EPOCH) => {
  const persisted = new Map<string, unknown>([['sess:A', { ...SNAP(50, seq), origin: 'zz' }]])
  const h = handlers()
  const $ = fullStand(persisted)
  $.wall = wall
  await SL.restoreAfterReload($, {} as never)
  await drain()
  return { h, $, persisted }
}

// ---------- Ж9: snapshotText is injective, snapshots carry the marker ----------

test('S4F10 Ж9: an id and its snapshot image spawn two agents', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const long = 'x'.repeat(220)
    const image = snapshotText(long)
    await h['agent.spawn']($, { subagentType: 'first' }, async () => ({ agentId: long }))
    await drain()
    await h['agent.spawn']($, { subagentType: 'second' }, async () => ({ agentId: image }))
    await drain()
    await end(h, $)
    const v = persisted.get('sess:A') as any
    expect(v.agents.map.length).toBe(2)
  } finally { SL.__resetState() }
})

test('S4F10 Ж9: a turn key and its snapshot image count as two turns', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    const long = 'x'.repeat(220)
    const shortTurn = snapshotText('main:' + long).slice(5)
    eventInput('turn.complete', tokens(long, 10))
    eventInput('turn.complete', tokens(shortTurn, 20))
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(30)
  } finally { SL.__resetState() }
})

test('S4F10 Ж9: restore of a marked snapshot leaves its ids untouched and writes the marker', async () => {
  SL.__resetState()
  try {
    const id = 'y'.repeat(195)
    const seed = {
      ...SNAP(50, 42_000_000_000),
      origin: '',
      norm: 1,
      seenTurns: [id],
      agents: { map: [[id, { ...REC }]], done: [id] },
      tools: { sawAny: true, sawTurnComplete: false, doneTotal: 1, errTotal: 0, byName: [[id, 1]], done: [{ name: id, isError: false }] },
    }
    const persisted = new Map<string, unknown>([['sess:A', seed]])
    const { h, $ } = await start(persisted)
    eventInput('turn.complete', tokens('w1', 1))
    await end(h, $)
    const v = persisted.get('sess:A') as any
    expect(v.norm).toBe(1)
    expect(v.seenTurns[0]).toBe(id)
    expect(v.agents.map[0][0]).toBe(id)
    expect(v.agents.done[0]).toBe(id)
    expect(v.tools.byName[0][0]).toBe(id)
    expect(v.tools.done[0].name).toBe(id)
  } finally { SL.__resetState() }
})

test('S4F10 Ж9: restore of a legacy snapshot normalizes long ids as capture does', async () => {
  SL.__resetState()
  try {
    const raw = 'x'.repeat(220) + 'A'
    const seed = {
      ...SNAP(50, 42_000_000_000),
      origin: '',
      seenTurns: [raw],
      agents: { map: [[raw, { ...REC }]], done: [raw] },
    }
    const persisted = new Map<string, unknown>([['sess:A', seed]])
    const { h, $ } = await start(persisted)
    eventInput('turn.complete', tokens('w1', 1))
    await end(h, $)
    const v = persisted.get('sess:A') as any
    expect(v.norm).toBe(1)
    expect(v.seenTurns[0]).toBe(snapshotText(raw))
    expect(v.agents.map[0][0]).toBe(snapshotText(raw))
    expect(v.seenTurns[0].length).toBe(200)
  } finally { SL.__resetState() }
})

// ---------- Ж10: the local write order survives the store round trip ----------

test('S4F10 Ж10: a stale late landing at SEQ_CAP is healed by the read-back', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await clockStart(SEQ_CAP - 1, Math.floor((SEQ_CAP - 1) / 1000))
    SL.__setOrigin('zzz')
    const gate = deferred<void>()
    let hang = true
    $.store.set = async (k: string, v: unknown) => {
      if (k !== 'sess:A') { persisted.set(k, clone(v)); return }
      if (hang) {
        // the stale body reaches the store late and its promise never settles
        hang = false
        await gate.promise
        persisted.set(k, clone(v))
        return new Promise<void>(() => {})
      }
      persisted.set(k, clone(v))
    }
    eventInput('turn.complete', tokens('t1', 1))
    await end(h, $)
    $.t += 16000
    await gather($)
    eventInput('turn.complete', tokens('t2', 2))
    await end(h, $)
    expect(total(persisted, 'sess:A')).toBe(53)
    gate.resolve()
    await drain()
    expect(total(persisted, 'sess:A')).toBe(51)
    $.t += 16000
    await gather($)
    const v = persisted.get('sess:A') as any
    expect(v.sum.total >= 53).toBe(true)
    expect(v.n >= 3).toBe(true)
  } finally { SL.__resetState() }
})

test('S4F10 Ж10: the read-back of the own newest record ties and the key is written once', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await clockStart(EPOCH * 1000)
    SL.__setOrigin('zzz')
    let puts = 0
    const put = $.store.set
    $.store.set = async (k: string, v: unknown) => {
      if (k === 'sess:A') puts++
      await put(k, v)
    }
    eventInput('turn.complete', tokens('one', 1))
    await end(h, $)
    expect(puts).toBe(1)
    $.t += 16000
    await gather($)
    $.t += 16000
    await gather($)
    expect(puts).toBe(1)
    const v = persisted.get('sess:A') as any
    expect(v.n >= 1).toBe(true)
    expect(v.norm).toBe(1)
  } finally { SL.__resetState() }
})

// ---------- Ж11: family isolation at event dispatch ----------

type StubFamily = { family: string; elements: []; sources: { source: { kind: 'event'; event: string }; elements: [] }[]; init: () => object; reduce: (s: unknown, i: any) => unknown }
const stubFamily = (name: string, events: string[], onFeed: (event: string) => void): StubFamily => ({
  family: name,
  elements: [],
  sources: events.map((event) => ({ source: { kind: 'event', event }, elements: [] })),
  init: () => ({}),
  reduce: (s: unknown, i: { source: { event?: string } }) => { onFeed(String(i.source.event)); return s },
})
const thrower = (name: string, events: string[]): StubFamily => stubFamily(name, events, () => { throw new Error('feed of ' + name + ' failed') })

test('S4F10 Ж11: a throwing family does not starve later families of session.end', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    const { h, $ } = await start()
    const seen: string[] = []
    FAMILIES.push(thrower('s4f10-boom-1', ['session.end', 'turn.start']) as never)
    FAMILIES.push(thrower('s4f10-boom-2', ['session.end', 'turn.start']) as never)
    FAMILIES.push(stubFamily('s4f10-spy', ['session.end', 'turn.start'], (ev) => { seen.push(ev) }) as never)
    let nextCount = 0
    await h['session.end']($, {}, async () => { nextCount++; return {} })
    await drain()
    expect(seen).toEqual(['session.end'])
    expect(diags('family-feed').length).toBe(2)
    const texts = diags('family-feed').map((d) => d.text)
    expect(texts.filter((t) => t.includes('s4f10-boom-1') && t.includes('session.end')).length).toBe(1)
    expect(texts.filter((t) => t.includes('s4f10-boom-2') && t.includes('session.end')).length).toBe(1)
    expect(diags('session-end-event').length).toBe(0)
    expect(nextCount).toBe(1)
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

test('S4F10 Ж11: two throwing families on turn.start diagnose once per episode and later families are fed', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    const { h, $ } = await start()
    const seen: string[] = []
    FAMILIES.push(thrower('s4f10-boom-1', ['session.end', 'turn.start']) as never)
    FAMILIES.push(thrower('s4f10-boom-2', ['session.end', 'turn.start']) as never)
    FAMILIES.push(stubFamily('s4f10-spy', ['session.end', 'turn.start'], (ev) => { seen.push(ev) }) as never)
    let nextCount = 0
    const next = async () => { nextCount++; return {} }
    await h['turn.start']($, {}, next as never)
    await h['turn.start']($, {}, next as never)
    await drain()
    expect(seen).toEqual(['turn.start', 'turn.start'])
    expect(diags('family-feed').length).toBe(2)
    expect(nextCount).toBe(2)
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

// ---------- Ж10b: the idempotent size bound for non-id strings ----------

test('S4F10 Ж10b: non-id strings of a marked snapshot are bounded idempotently across restore and re-put', async () => {
  SL.__resetState()
  try {
    const a = 'w'.repeat(191) + '#' + '01234567'
    const b = 'z'.repeat(300)
    const seed = { ...SNAP(50, 42_000_000_000), origin: '', norm: 1, extra: { a, b } }
    const persisted = new Map<string, unknown>([['sess:A', seed]])
    SL.__setOrigin('zzz')
    const { $ } = await start(persisted)
    // cycle 1: a late stale body at the learned origin forces the re-put
    persisted.set('sess:A', { ...SNAP(1, 41_999_995_000), origin: '', norm: 1, extra: { a, b } })
    $.t += 16000
    await gather($)
    const k1 = clone(persisted.get('sess:A'))
    expect(k1.extra.a).toBe(a)
    expect(typeof k1.extra.b === 'string' && k1.extra.b.length === 200 && /#[0-9a-f]{8}$/.test(k1.extra.b)).toBe(true)
    // cycle 2: one more late stale body below the landed one — the strings must not drift
    persisted.set('sess:A', { ...k1, seq: k1.seq - 1 })
    $.t += 16000
    await gather($)
    const k2 = clone(persisted.get('sess:A'))
    expect(k2.extra.a).toBe(k1.extra.a)
    expect(k2.extra.b).toBe(k1.extra.b)
  } finally { SL.__resetState() }
})

test('S4F10 Ж10b: a 200-length object key of a marked snapshot survives the read-back cycle unchanged', async () => {
  SL.__resetState()
  try {
    const key = 'k'.repeat(191) + '#' + 'abcd1234'
    const seed = { ...SNAP(50, 42_000_000_000), origin: '', norm: 1, deep: { [key]: 1 } }
    const persisted = new Map<string, unknown>([['sess:A', seed]])
    SL.__setOrigin('zzz')
    const { $ } = await start(persisted)
    persisted.set('sess:A', { ...SNAP(1, 41_999_995_000), origin: '', norm: 1, deep: { [key]: 1 } })
    $.t += 16000
    await gather($)
    const k1 = persisted.get('sess:A') as any
    expect(Object.keys(clone(k1.deep))).toEqual([key])
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
