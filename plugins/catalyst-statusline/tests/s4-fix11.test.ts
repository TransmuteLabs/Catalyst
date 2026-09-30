import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data/index'
import { SESS_ID_PATHS, snapshotText } from '../hooks/data/snapshotText'
import { cloneState } from '../hooks/data/cloneState'
import { snapshotOf } from '../hooks/data/base'
import type { Source } from '../hooks/data/types'
import { EXT_WRITER, NS_SESS, sessKeys, sessValue, v3Key } from './world'

// S4-FIX11. CONSTRAINT (measured, the header of s4-fix7.test.ts): the kit loads
// the folder plugin once; the teeth run against the imported module instance.
// CONSTRAINT: the stands drive only the session write queue and the family
// dispatch; `t` is the mod's process clock (the now seam).

const drain = async (): Promise<void> => {
  for (let i = 0; i < 240; i++) await Promise.resolve()
}
const eventInput = (event: string, data: unknown, now = 0): void => SL.__feed({ source: { kind: 'event', event } as Source, ok: true, data, now })
const tokens = (turnId: string, n: number) => ({ turnId, usage: { input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
const clone = (v: unknown): any => JSON.parse(JSON.stringify(v))
// the newest snapshot of the session of the logical key `sess:<id>`, both forms (#551 §3.10)
const total = (m: Map<string, unknown>, k: string): number | undefined => (sessValue(m, k.slice('sess:'.length)) as { sum?: { total: number } } | undefined)?.sum?.total
const SNAP = (sum: number, seq: number): Record<string, unknown> => ({
  sum: { total: sum, in: sum, out: 0, cache: 0 },
  seenTurns: [],
  tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, byName: [], done: [] },
  agents: { map: [], done: [] },
  started: true, resumed: false, resumedDecided: true, mainTurns: 0,
  seq,
})
const REC = { name: 'n', desc: 'd', model: 'm', status: 'running', at: 1, doneAt: 0 }
const EPOCH = 1_780_000_000_000
const L250 = 'q'.repeat(250)

// the live family state object as S.famStates holds it (__stateSnapshot
// copies the Map to entry arrays whose values are live references)
const famLive = (fam: unknown): any => ((SL.__stateSnapshot()['famStates'] as Array<[unknown, any]>).find(([f]) => f === fam)![1])

const deepEqualTree = (a: any, b: any): boolean => {
  if (Object.is(a, b)) return true
  if (a instanceof Set && b instanceof Set) {
    const x = [...a]
    const y = [...b]
    return x.length === y.length && x.every((v, i) => deepEqualTree(v, y[i]))
  }
  if (a instanceof Map && b instanceof Map) {
    const x = [...a.entries()]
    const y = [...b.entries()]
    return x.length === y.length && x.every(([k, v], i) => { const p = y[i]; return p !== undefined && deepEqualTree(k, p[0]) && deepEqualTree(v, p[1]) })
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqualTree(v, b[i]))
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqualTree(a[k], b[k]))
  }
  return false
}

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
  ;(SL as unknown as { __setNow: (fn: (() => number) | null) => void }).__setNow(() => stand.t)
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
// #551 §3.10: the read-back re-puts only when this environment's own
// publication is gone — one lands, a reload restores the previous-version
// `seed` above it, and another process's prune takes the publication
const reloadOver = async (seed: Record<string, unknown>): Promise<{ $: any; persisted: Map<string, unknown> }> => {
  const persisted = new Map<string, unknown>()
  const first = await start(persisted)
  eventInput('turn.complete', tokens('w0', 1))
  await end(first.h, first.$)
  const own = sessKeys(persisted, 'A')
  expect(own.length).toBe(1)
  persisted.set('sess:A', seed)
  const { $ } = await start(persisted)
  for (const k of own) persisted.delete(k)
  return { $, persisted }
}

// ---------- Н1: the boundSess result is always marked ----------

test('S4F11 Н1: a legacy requeue keeps the capture image and one agent survives a reload', async () => {
  SL.__resetState()
  try {
    const raw = 'x'.repeat(220)
    const image = snapshotText(raw)
    const seed = {
      ...SNAP(50, 42_000_000_000),
      origin: '',
      seenTurns: [raw],
      agents: { map: [[raw, { ...REC }]], done: [raw] },
    }
    // the own publication gone at the read-back forces the requeue of the
    // newest known value (the learned legacy copy)
    const { $, persisted } = await reloadOver(seed)
    $.t += 16000
    await gather($)
    const v = sessValue(persisted, 'A') as any
    expect(v.norm).toBe(1)
    expect(v.agents.map[0][0]).toBe(image)
    expect(v.agents.done[0]).toBe(image)
    expect(v.seenTurns[0]).toBe(image)
    expect(total(persisted, 'sess:A')).toBe(50)
    // reload: the stored image is canonical — the raw id spawns the SAME agent
    SL.__resetState()
    await start(persisted)
    eventInput('agent.spawn', { agentId: raw, subagentType: 'again' })
    expect(famLive(FAMILIES[0]).agents.map.size).toBe(1)
  } finally { SL.__resetState() }
})

test('S4F11 Н1: a marked snapshot with an over-long id is bounded to the capture image', async () => {
  SL.__resetState()
  try {
    const raw = 'y'.repeat(250)
    const image = snapshotText(raw)
    const seed = {
      ...SNAP(50, 42_000_000_000),
      origin: '',
      norm: 1,
      seenTurns: [raw],
      agents: { map: [[raw, { ...REC }]], done: [raw] },
    }
    const persisted = new Map<string, unknown>([['sess:A', seed]])
    const { h, $ } = await start(persisted)
    // restore trusts the marker up to the size bound: an id past it is the
    // store-limit violation (FIX8 Ф4) and must take the capture image
    expect(famLive(FAMILIES[0]).agents.map.has(image)).toBe(true)
    await end(h, $)
    const v = sessValue(persisted, 'A') as any
    expect(v.agents.map[0][0]).toBe(image)
    expect(v.agents.map[0][0].length).toBe(200)
    expect(v.seenTurns[0]).toBe(image)
    expect(v.agents.done[0]).toBe(image)
  } finally { SL.__resetState() }
})

// ---------- Н2: dispatchEvent is total ----------

type StubFamily = { family: string; elements: []; sources: { source: { kind: 'event'; event: string }; elements: [] }[]; init: () => object; reduce: (s: unknown, i: any) => unknown }
const stubFamily = (name: string, events: string[], onFeed: (event: string) => void): StubFamily => ({
  family: name,
  elements: [],
  sources: events.map((event) => ({ source: { kind: 'event', event }, elements: [] })),
  init: () => ({}),
  reduce: (s: unknown, i: { source: { event?: string } }) => { onFeed(String(i.source.event)); return s },
})

test('S4F11 Н2: a registry element whose family name throws is one diagnosed family, not a dead chain', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    const { h, $ } = await start()
    const seen: string[] = []
    const corrupt: any = { elements: [], init: () => ({}), reduce: (s: unknown) => s }
    Object.defineProperty(corrupt, 'family', { get() { throw new Error('corrupt registry entry') } })
    FAMILIES.push(corrupt as never)
    FAMILIES.push(stubFamily('s4f11-spy', ['session.end'], (ev) => { seen.push(ev) }) as never)
    let nextCount = 0
    await h['session.end']($, {}, async () => { nextCount++; return {} })
    await drain()
    expect(seen).toEqual(['session.end'])
    expect(nextCount).toBe(1)
    const recs = diags('family-feed')
    expect(recs.length).toBe(1)
    expect(recs.some((d) => d.text.includes('<unnamed>') && d.text.includes('session.end'))).toBe(true)
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

// ---------- Н3: the refusing family's state is atomic ----------

test('S4F11 Н3: a turn.start whose text read throws leaves the activity family untouched', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    const poisoned = { get text() { throw new Error('s4f11 poisoned text') } }
    await h['turn.start']($, poisoned as never, async () => ({}))
    await drain()
    // the poisoned text getter can break more than the one family (external
    // reads the same field); the pin is the record of the turnNum-bearing
    // family (activity is registered as 'agents'), the red carrier is the
    // untouched state below
    expect(diags('family-feed').some((d) => d.text.includes('family agents'))).toBe(true)
    expect(famLive(FAMILIES[2]).turnNum).toBe(0)
    expect(famLive(FAMILIES[2]).busy).toBe(false)
    await h['turn.start']($, { text: 'plain' } as never, async () => ({}))
    await drain()
    expect(famLive(FAMILIES[2]).turnNum).toBe(1)
  } finally { SL.__resetState() }
})

test('S4F11 Н3: every family state clones without a throw and the reduce stores a clone', async () => {
  SL.__resetState()
  try {
    const { $ } = await start()
    await gather($)
    // init() and the state after typical inputs are cloneable for every
    // family, the clone equal to the original (Set/Map entrywise)
    for (const fam of FAMILIES) {
      const st = famLive(fam)
      const c = cloneState(st)
      expect(deepEqualTree(c, st)).toBe(true)
      const ini = (fam as { init: () => unknown }).init()
      expect(deepEqualTree(cloneState(ini), ini)).toBe(true)
    }
    // feed reduces a CLONE: the object the store held before the feed stays
    // untouched while the stored state moves on it
    eventInput('turn.start', { text: 'warm' })
    const pre = famLive(FAMILIES[2])
    eventInput('turn.start', { text: 'x' })
    const post = famLive(FAMILIES[2])
    expect(post === pre).toBe(false)
    expect(pre.turnNum).toBe(1)
    expect(post.turnNum).toBe(2)
    eventInput('turn.complete', tokens('warm', 1))
    const preU = famLive(FAMILIES[1])
    eventInput('turn.complete', tokens('next', 2))
    const postU = famLive(FAMILIES[1])
    expect(postU === preU).toBe(false)
  } finally { SL.__resetState() }
})

// ---------- Н4: isolation in dispatch() ----------

const clockFeed = (name: string, onFeed: (kind: string) => void): any => ({
  family: name,
  elements: [],
  sources: [{ source: { kind: 'clock', everyMs: 777000 } as Source, elements: [] }],
  init: () => ({}),
  reduce: (s: unknown, i: { source: { kind?: string } }) => { onFeed(String(i.source.kind)); return s },
})

test('S4F11 Н4: a throwing family on a clock source does not starve the later families', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    await start()
    const seen: string[] = []
    FAMILIES.push(clockFeed('s4f11-boom', () => { throw new Error('feed of s4f11-boom failed') }) as never)
    FAMILIES.push(clockFeed('s4f11-spy-clock', (k) => { seen.push(k) }) as never)
    let threw = false
    try {
      SL.__feed({ source: { kind: 'clock', everyMs: 777000 } as Source, ok: true, data: undefined, now: 1 })
    } catch { threw = true }
    expect(threw).toBe(false)
    expect(seen).toEqual(['clock'])
    const recs = diags('family-feed')
    expect(recs.length).toBe(1)
    expect(recs.some((d) => d.text.includes('s4f11-boom') && d.text.includes('clock'))).toBe(true)
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

// ---------- Н5: the key merge after boundText is visible ----------

test('S4F11 Н5: two legacy keys bounded to one image merge on the first entry with a warning', async () => {
  SL.__resetState()
  try {
    const long = 'k'.repeat(220)
    const image = snapshotText(long)
    const seed = { ...SNAP(50, 42_000_000_000), origin: '', extra: { [image]: 'A', [long]: 'B' } }
    const { $, persisted } = await reloadOver(seed)
    $.t += 16000
    await gather($)
    const v = sessValue(persisted, 'A') as any
    expect(Object.keys(v.extra).length).toBe(1)
    expect(v.extra[image]).toBe('A')
    const recs = diags('session-snapshot-key-merge')
    expect(recs.length).toBe(1)
    expect(recs.some((d) => d.kind === 'warn' && d.text.includes('bounded to ' + JSON.stringify(image)))).toBe(true)
  } finally { SL.__resetState() }
})

// ---------- Н6: ordOf validates n ----------

// the seeds of these phases sit at the epoch clock: $.wall is pinned to EPOCH
// before the first readClock, or the FIX8 Ф2 clock-window guard would refuse
// to learn the seq (same requirement as clockStart in s4-fix10.test.ts)
const startWall = async (persisted: Map<string, unknown>, wall: number): Promise<{ h: Record<string, any>; $: any; persisted: Map<string, unknown> }> => {
  const h = handlers()
  const $ = fullStand(persisted)
  $.wall = wall
  await SL.restoreAfterReload($, {} as never)
  await drain()
  return { h, $, persisted }
}

const nPhase = async (plantedN: number, sum: number): Promise<{ persisted: Map<string, unknown>; $: any; restored: unknown }> => {
  SL.__setOrigin('zzz')
  const S = EPOCH * 1000
  const seed = { ...SNAP(50, S), origin: 'zzz', n: 1, norm: 1 }
  const persisted = new Map<string, unknown>([['sess:A', seed]])
  const { $ } = await startWall(persisted, EPOCH)
  // a body echoing this origin at the same seq, under a key of its own (#551 §3.10)
  persisted.set(v3Key(NS_SESS, 'A', EXT_WRITER, 1), { ...SNAP(sum, S), origin: 'zzz', n: plantedN, norm: 1, session: 'A' })
  $.t += 16000
  await gather($)
  // the next restore orders both by the module's own (seq, origin, n)
  SL.__resetState()
  SL.__setOrigin('zzz')
  await startWall(persisted, EPOCH)
  return { persisted, $, restored: famLive(FAMILIES[0]).sum?.total }
}

test('S4F11 Н6: a body with n NaN is ordered as zero and the own landed n wins', async () => {
  SL.__resetState()
  try {
    const { persisted, restored } = await nPhase(NaN, 51)
    expect({ stored: total(persisted, 'sess:A'), restored }).toEqual({ stored: 50, restored: 50 })
  } finally { SL.__resetState() }
})

test('S4F11 Н6: a body with n 1e308 is ordered as zero and cannot fence the key', async () => {
  SL.__resetState()
  try {
    const { persisted, restored } = await nPhase(1e308, 53)
    expect({ stored: total(persisted, 'sess:A'), restored }).toEqual({ stored: 50, restored: 50 })
    const v = sessValue(persisted, 'A') as any
    expect(Number.isSafeInteger(v.n) && v.n >= 1).toBe(true)
  } finally { SL.__resetState() }
})

// ---------- Н7: the family-feed episode closure is pinned ----------

test('S4F11 Н7: throw, clean pass, throw on the same family records twice (the episode closed)', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    const { h, $ } = await start()
    // CONSTRAINT (S4-FIX15 В2, S4-FIX16 swe2 3): feed reduces a throwing input
    // a second time on init(), so the stub throws by a mark in the input, not
    // by a call count; `calls` counts every reduce call and `perInput` the
    // calls of each input — a throwing input is the direct call plus the retry
    const perInput = new Map<unknown, number>()
    let calls = 0
    FAMILIES.push({
      family: 's4f11-flaky',
      elements: [],
      sources: [{ source: { kind: 'event', event: 'turn.start' }, elements: [] }],
      init: () => ({}),
      reduce: (s: unknown, i: { data?: { throwMe?: unknown } }) => {
        calls++
        perInput.set(i, (perInput.get(i) ?? 0) + 1)
        if (i.data?.throwMe === true) throw new Error('feed of s4f11-flaky failed')
        return s
      },
    } as never)
    const next = async () => ({})
    await h['turn.start']($, { throwMe: true }, next as never)
    await h['turn.start']($, {}, next as never)
    await h['turn.start']($, { throwMe: true }, next as never)
    await drain()
    expect(calls).toBe(5)
    expect([...perInput.values()]).toEqual([2, 1, 2])
    expect(diags('family-feed').length).toBe(2)
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

// ---------- Н8: the one table has a capture carrier for every path ----------

test('S4F11 Н8: every SESS_ID_PATHS entry has a capture driver that normalizes a 250-char value', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    const image = snapshotText(L250)
    await h['agent.spawn']($, { subagentType: L250, description: L250, model: L250 }, async () => ({ agentId: L250 }))
    await h['turn.complete']($, tokens(L250, 3), async () => ({}))
    await h['turn.complete']($, { agentId: L250, turnId: L250 }, async () => ({}))
    await h['tool.call']($, { tool: L250, tool_use_id: 'u1' }, async () => ({}))
    const base = famLive(FAMILIES[0])
    expect(base.agents.map.has(image)).toBe(true)
    // S4F12 Н5 (sol 5): the table reads the SNAPSHOT, not the live state —
    // a capture carrier lost inside snapshotOf must cost this tooth its green
    const snap = snapshotOf(base)!.value
    // per table path: the raw string the capture site feeds to snapshotText
    // and a reader of the snapshot at that exact path
    const recEntry = snap.agents.map.find(([k]: [string, unknown]) => k === image)
    expect(recEntry !== undefined).toBe(true)
    const rec = recEntry![1] as { name: string; desc: string; model: string; turn: string }
    const table: Record<string, { raw: string; read: () => unknown }> = {
      '"seenTurns"/[]': { raw: 'main:' + L250, read: () => snap.seenTurns[0] },
      '"agents"/"map"/[]/[]': { raw: L250, read: () => snap.agents.map.find(([k]: [string, unknown]) => k === image)?.[0] },
      '"agents"/"map"/[]/[]/"name"': { raw: L250, read: () => rec.name },
      '"agents"/"map"/[]/[]/"desc"': { raw: L250, read: () => rec.desc },
      '"agents"/"map"/[]/[]/"model"': { raw: L250, read: () => rec.model },
      '"agents"/"map"/[]/[]/"turn"': { raw: L250, read: () => rec.turn },
      '"agents"/"done"/[]': { raw: L250, read: () => snap.agents.done.find((d: string) => d === image) },
      '"tools"/"byName"/[]/[]': { raw: L250, read: () => snap.tools.byName.find(([k]: [string, number]) => k === image)?.[0] },
      '"tools"/"done"/[]/"name"': { raw: L250, read: () => snap.tools.done.find((d: { name: string }) => d.name === image)?.name },
    }
    for (const path of SESS_ID_PATHS) {
      const c = table[path]
      if (c === undefined) throw new Error('the table has no capture driver for ' + path)
      expect(String(c.read())).toBe(snapshotText(c.raw))
      expect(String(c.read()).length).toBe(200)
    }
    expect(Object.keys(table).sort()).toEqual([...SESS_ID_PATHS].sort())
  } finally { SL.__resetState() }
})

// ---------- FIX11b: cloneState keeps the graph — cycles and shared links ----------

test('S4F11b К1: cloneState maps a cycle — the clone points to itself and is not the original', () => {
  const orig: Record<string, unknown> = { name: 'n', at: 1 }
  orig['turn'] = orig
  const c = cloneState(orig)
  expect(c['turn'] === c).toBe(true)
  expect(c !== orig).toBe(true)
})

test('S4F11b К2: one object reached by three paths clones to one shared node', () => {
  const r: Record<string, unknown> = { x: 1 }
  const s: Record<string, unknown> = { a: r, b: [r], m: new Map([['k', r]]) }
  const c = cloneState(s)
  const ca = c['a'] as Record<string, unknown>
  const cb = c['b'] as Record<string, unknown>[]
  const cm = c['m'] as Map<string, Record<string, unknown>>
  expect(ca === cb[0]).toBe(true)
  expect(ca === cm.get('k')).toBe(true)
  expect(ca !== r).toBe(true)
})

test('S4F11b К3: a restored cyclic agent record feeds no family-feed freeze (Р12 shape)', async () => {
  SL.__resetState()
  try {
    const cyc: Record<string, unknown> = { ...REC }
    cyc['turn'] = cyc
    const snap = SNAP(50, 42_000_000_000)
    snap['agents'] = { map: [['ag', cyc]], done: [] }
    const persisted = new Map<string, unknown>([['sess:A', snap]])
    const { h, $ } = await start(persisted)
    eventInput('turn.start', { text: 'plain' })
    expect(diags('family-feed').length).toBe(0)
    // S4F12 Н4 (sol 3, sol 4): restoration itself holds — the cycle is
    // dropped at applySnapshot, the agent survives, the snapshot and the
    // session.end record serialize
    const base = famLive(FAMILIES[0])
    expect(base.agents.map.has('ag')).toBe(true)
    const r = base.agents.map.get('ag')
    expect('turn' in r).toBe(false)
    expect(r.name).toBe(REC.name)
    const snapOut = snapshotOf(base)
    expect(snapOut !== null).toBe(true)
    expect(JSON.stringify(snapOut!.value).includes('"ag"')).toBe(true)
    let endCalled = false
    await h['session.end']($, {}, async () => { endCalled = true; return {} })
    await drain()
    expect(endCalled).toBe(true)
    const v = sessValue(persisted, 'A')
    expect(JSON.stringify(v).includes('"ag"')).toBe(true)
  } finally { SL.__resetState() }
})
