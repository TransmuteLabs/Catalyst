import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data/index'
import { snapshotText } from '../hooks/data/snapshotText'
import { cloneState } from '../hooks/data/cloneState'
import type { Collector, Input, Source } from '../hooks/data/types'

// S4-FIX12 teeth (brief Н1–Н8). The stand is the same as in s4-fix11.test.ts
// (CONSTRAINT, measured, the header of s4-fix7.test.ts): the kit loads the
// folder plugin once and the teeth run against the imported module instance.
// CONSTRAINT: this file only drives the session write queue and the family
// dispatch; `t` is the mod's process clock (the now seam).

const drain = async (): Promise<void> => {
  for (let i = 0; i < 240; i++) await Promise.resolve()
}
const eventInput = (event: string, data: unknown, now = 0): void => SL.__feed({ source: { kind: 'event', event } as Source, ok: true, data, now })
const clone = (v: unknown): any => JSON.parse(JSON.stringify(v))
const SNAP = (sum: number, seq: number): Record<string, unknown> => ({
  sum: { total: sum, in: sum, out: 0, cache: 0 },
  seenTurns: [],
  tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, byName: [], done: [] },
  agents: { map: [], done: [] },
  started: true, resumed: false, resumedDecided: true, mainTurns: 0,
  seq,
})
const REC = { name: 'n', desc: 'd', model: 'm', status: 'running', at: 1, doneAt: 0 }

// the live family state object as S.famStates holds it (__stateSnapshot
// copies the Map to entry arrays whose values are live references)
const famLive = (fam: unknown): any => ((SL.__stateSnapshot()['famStates'] as Array<[unknown, any]>).find(([f]) => f === fam)![1])

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

type StubFamily = { family: string; elements: []; sources: { source: { kind: 'event'; event: string }; elements: [] }[]; init: () => object; reduce: (s: unknown, i: any) => unknown }
const stubFamily = (name: string, events: string[], onFeed: (event: string) => void): StubFamily => ({
  family: name,
  elements: [],
  sources: events.map((event) => ({ source: { kind: 'event', event }, elements: [] })),
  init: () => ({}),
  reduce: (s: unknown, i: { source: { event?: string } }) => { onFeed(String(i.source.event)); return s },
})

// ---------- Н1: __proto__ as an own key (sol 1) ----------

test('S4F12 Н1: cloneState copies an own "__proto__" key instead of re-prototyping the clone', () => {
  const src = JSON.parse('{"__proto__":{"x":1},"a":2}')
  const c = cloneState(src) as Record<string, unknown>
  expect(Object.getPrototypeOf(c)).toBe(Object.prototype)
  expect(Object.keys(c)).toEqual(['__proto__', 'a'])
  expect((c as { x?: unknown })['x']).toBeUndefined()
  expect(JSON.stringify(c)).toBe(JSON.stringify(src))
})

// ---------- Н2: no verbatim node freezes the family; a clone refusal resets ----------

test('S4F12 Н2: usage.context normalizes to window/tokens/percent and the next input is not frozen', async () => {
  SL.__resetState()
  try {
    await start()
    // the same usage-read path as the readUsageInto teeth (s2-lost.test.ts:23)
    SL.__feed({ source: { kind: 'session', call: 'usage' } as Source, ok: true, data: { context: { window: 1000, tokens: 10, percent: 1, extra: new Map() }, rateLimits: [] }, now: 0 })
    const ctx = famLive(FAMILIES[0]).usage.context
    expect(Object.keys(ctx).sort()).toEqual(['percent', 'tokens', 'window'])
    eventInput('turn.start', { text: 'plain' }, 1)
    expect(diags('family-feed').length).toBe(0)
    expect(diags('family-state-reset').length).toBe(0)
  } finally { SL.__resetState() }
})

test('S4F12 Н2: an env read stores only its string values', async () => {
  SL.__resetState()
  try {
    await start()
    const envSource = (FAMILIES[3] as Collector<unknown>).sources.find((en) => en.source.kind === 'env')!.source
    SL.__feed({ source: envSource, ok: true, data: { A: 'x', B: 5, C: { d: 1 } }, now: 0 })
    expect(famLive(FAMILIES[3]).env.v).toEqual({ A: 'x' })
    expect(diags('family-feed').length).toBe(0)
    expect(diags('family-state-reset').length).toBe(0)
  } finally { SL.__resetState() }
})

test('S4F12 Н2: restore of an agent record keeps only the AgentRec fields', async () => {
  SL.__resetState()
  try {
    const rec: Record<string, unknown> = { ...REC, turn: new Map([['t', 1]]), extra: 1 }
    const snap = SNAP(50, 42_000_000_000)
    snap['agents'] = { map: [['ag', rec]], done: [] }
    const persisted = new Map<string, unknown>([['sess:A', snap]])
    await start(persisted)
    const r = famLive(FAMILIES[0]).agents.map.get('ag')
    expect(r !== undefined).toBe(true)
    expect(Object.keys(r).sort()).toEqual(['at', 'desc', 'doneAt', 'model', 'name', 'status'])
    expect([r.name, r.desc, r.model, r.status, r.at, r.doneAt]).toEqual([REC.name, REC.desc, REC.model, REC.status, REC.at, REC.doneAt])
    expect(diags('family-feed').length).toBe(0)
    expect(diags('family-state-reset').length).toBe(0)
  } finally { SL.__resetState() }
})

test('S4F12 Н2: an uncloneable family state resets to init once and later inputs reduce onto it', async () => {
  SL.__resetState()
  try {
    await start()
    class Poison {}
    // the state exists only after the family's first input (famState is lazy);
    // the warm input stands before the poisoning, its effect is washed out by
    // the reset
    eventInput('turn.start', { text: 'warm' }, 5)
    // the set seam of the teeth above is __stateSnapshot's live entry
    // reference (S1-FIX4 П.5): the stored state is poisoned in place
    famLive(FAMILIES[2]).poison = new Poison()
    eventInput('turn.start', { text: 'one' }, 10)
    eventInput('turn.start', { text: 'two' }, 20)
    const resets = diags('family-state-reset')
    expect(resets.length).toBe(1)
    expect(resets[0]!.text.includes('family agents')).toBe(true)
    expect(diags('family-feed').length).toBe(0)
    // the state after both entries is init() reduced through those entries
    // (the reset entry itself reduces onto the fresh state, brief Н2 п.4)
    const act = FAMILIES[2] as Collector<unknown>
    const i1: Input = { source: { kind: 'event', event: 'turn.start' } as Source, ok: true, data: { text: 'one' }, now: 10 }
    const i2: Input = { source: { kind: 'event', event: 'turn.start' } as Source, ok: true, data: { text: 'two' }, now: 20 }
    let exp: unknown = act.init()
    exp = act.reduce(cloneState(exp), i1)
    exp = act.reduce(cloneState(exp), i2)
    expect(JSON.stringify(famLive(FAMILIES[2]))).toBe(JSON.stringify(exp))
  } finally { SL.__resetState() }
})

// ---------- Н3: the activity family caps its agents (sol 2, swe2 AR(f)) ----------

test('S4F12 Н3: 70 spawns without completion cap the family at the 64 newest agents', async () => {
  SL.__resetState()
  try {
    await start()
    for (let i = 0; i < 70; i++) eventInput('agent.spawn', { tool_use_id: 'a' + i }, i + 1)
    const st = famLive(FAMILIES[2]) as { agents: Map<string, unknown>; agentsDropped: number }
    expect(st.agents.size).toBe(64)
    expect(st.agents.has('t:a69')).toBe(true)
    expect(st.agents.has('t:a6')).toBe(true)
    expect(st.agents.has('t:a0')).toBe(false)
    expect(st.agentsDropped).toBe(6)
    const recs = diags('activity-agents-cap')
    expect(recs.length).toBe(1)
    expect(recs[0]!.text.includes('over cap 64')).toBe(true)
  } finally { SL.__resetState() }
})

test('S4F12 Н3: the cap drops a completed agent before the oldest living one', async () => {
  SL.__resetState()
  try {
    await start()
    for (let i = 0; i < 64; i++) eventInput('agent.spawn', { tool_use_id: 'a' + i }, i + 1)
    // the oldest living agent is t:a0; t:a1 completes and is the only
    // completed one — the sixth-fifth spawn must cost t:a1, never t:a0
    eventInput('turn.complete', { agentId: 't:a1', text: 'done' }, 65)
    eventInput('agent.spawn', { tool_use_id: 'a64' }, 66)
    const st = famLive(FAMILIES[2]) as { agents: Map<string, unknown> }
    expect(st.agents.size).toBe(64)
    expect(st.agents.has('t:a1')).toBe(false)
    expect(st.agents.has('t:a0')).toBe(true)
    expect(st.agents.has('t:a64')).toBe(true)
  } finally { SL.__resetState() }
})

// ---------- Н6: dispatch() reads the input source once, before the loop ----------

test('S4F12 Н6: an input source whose kind getter throws is diagnosed once, the next input reaches its families', async () => {
  SL.__resetState()
  try {
    await start()
    const poison: Record<string, unknown> = { event: 'turn.start' }
    Object.defineProperty(poison, 'kind', { get() { throw new Error('s4f12 poison kind') }, enumerable: true, configurable: true })
    let threw = false
    try {
      SL.__feed({ source: poison as unknown as Source, ok: true, data: { text: 'x' }, now: 0 })
    } catch { threw = true }
    expect(threw).toBe(false)
    expect(diags('dispatch-source').length).toBe(1)
    expect(diags('family-feed').length).toBe(0)
    eventInput('agent.spawn', { agentId: 's4f12-after' }, 1)
    expect(famLive(FAMILIES[0]).agents.map.has('s4f12-after')).toBe(true)
  } finally { SL.__resetState() }
})

// ---------- Н7: the episode key distinguishes same-named families ----------

test('S4F12 Н7: two corrupt nameless families on one event are two records, the healthy family is fed', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    const { h, $ } = await start()
    const seen: string[] = []
    const corrupt = (): any => {
      const entry: any = { elements: [], init: () => ({}), reduce: (s: unknown) => s }
      Object.defineProperty(entry, 'family', { get() { throw new Error('s4f12 corrupt registry entry') } })
      return entry
    }
    FAMILIES.push(corrupt() as never)
    FAMILIES.push(corrupt() as never)
    FAMILIES.push(stubFamily('s4f12-spy', ['session.end'], (ev) => { seen.push(ev) }) as never)
    await h['session.end']($, {}, async () => ({}))
    await drain()
    expect(diags('family-feed').length).toBe(2)
    expect(seen).toEqual(['session.end'])
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

// ---------- Н8: one merge record per merged key, the text names both keys ----------

test('S4F12 Н8: two merge pairs in one value give two records, a repeat of the same record adds none', async () => {
  SL.__resetState()
  try {
    const long1 = 'k'.repeat(220)
    const long2 = 'm'.repeat(220)
    const image1 = snapshotText(long1)
    const image2 = snapshotText(long2)
    const seed = { ...SNAP(50, 42_000_000_000), origin: '', extra: { [image1]: 'A', [long1]: 'B', [image2]: 'C', [long2]: 'D' } }
    const persisted = new Map<string, unknown>([['sess:A', seed]])
    const { $ } = await start(persisted)
    const recs = diags('session-snapshot-key-merge')
    expect(recs.length).toBe(2)
    expect(recs.every((d) => d.kind === 'warn')).toBe(true)
    expect(recs.filter((d) => d.text.includes('bounded to ' + JSON.stringify(image1)) && d.text.includes('the later value of ' + JSON.stringify(long1.slice(0, 80) + '…'))).length).toBe(1)
    expect(recs.filter((d) => d.text.includes('bounded to ' + JSON.stringify(image2)) && d.text.includes('the later value of ' + JSON.stringify(long2.slice(0, 80) + '…'))).length).toBe(1)
    // a repeat of the same store record re-bounds the same two pairs: the
    // episodes stand and no new record is made
    persisted.set('sess:A', clone(seed))
    $.t += 16000
    await gather($)
    expect(diags('session-snapshot-key-merge').length).toBe(2)
  } finally { SL.__resetState() }
})
