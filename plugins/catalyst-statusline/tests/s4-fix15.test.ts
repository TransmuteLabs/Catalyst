import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data/index'
import { boundText } from '../hooks/data/snapshotText'
import * as EXT from '../hooks/data/external'
import type { Source } from '../hooks/data/types'

// S4-FIX15 teeth (brief В1–В9). The stand is the one of s4-fix14.test.ts: the
// teeth run against the imported module instance; `t` is the mod's process
// clock (the now seam).
// CONSTRAINT: the helpers and seams of this wave are reached through module
// namespaces so this file still loads on a tree where they are not exported.

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

const sessionInfo = (id: string, now: number): void => SL.__feed({ source: { kind: 'session', call: 'info' } as Source, ok: true, data: { id }, now })

// ---------- В1: the farewell does not hold the switch (sol 2, swe2 F1) ----------

test('S4F15 В1: a farewell snapshot that throws is recorded and the session still switches', async () => {
  SL.__resetState()
  try {
    await start(new Map<string, unknown>([['sess:A', SNAP(50, 42_000_000_000)]]))
    // cloneable, and snapshotOf throws on it
    const st = { ...famLive(FAMILIES[0]), tools: null }
    expect(st['session']).toBe('A')
    SL.__setFamState(FAMILIES[0]!, st)
    const feeds = diags('family-feed').length
    sessionInfo('B', 1)
    const lost = diags('session-farewell-lost')
    expect(lost.length).toBe(1)
    expect(lost[0]!.text.includes('session A')).toBe(true)
    expect(diags('family-feed').length).toBe(feeds)
    expect(famLive(FAMILIES[0]).session).toBe('B')
  } finally { SL.__resetState() }
})

// ---------- В2: a state the reduce throws on is reset aloud (sol 2, swe2 F1) ----------

test('S4F15 В2: an input the state cannot reduce resets the family and is counted on the fresh state', async () => {
  SL.__resetState()
  try {
    await start()
    sessionInfo('A', 1)
    expect(famLive(FAMILIES[0]).session).toBe('A')
    SL.__setFamState(FAMILIES[0]!, { ...famLive(FAMILIES[0]), tools: null })
    const feeds = diags('family-feed').length
    eventInput('tool.call', { callKey: 'c1', tool: 'Read', input: {} }, 2)
    expect(diags('family-state-reset').filter((d) => d.text.includes('could not be reduced')).length).toBe(1)
    expect(diags('family-feed').length).toBe(feeds)
    const tools = famLive(FAMILIES[0]).tools
    expect(tools !== null && typeof tools === 'object').toBe(true)
  } finally { SL.__resetState() }
})

// ---------- В3: an input that throws on a fresh state too is the input's fault ----------

test('S4F15 В3: an input that throws on a fresh state too keeps the accumulated state', async () => {
  SL.__resetState()
  try {
    await start(new Map<string, unknown>([['sess:A', SNAP(50, 42_000_000_000)]]))
    const before = famLive(FAMILIES[0])
    const feeds = diags('family-feed').length
    const resets = diags('family-state-reset').length
    SL.__feed({ source: { kind: 'event', event: 'tool.call' } as Source, ok: true, data: new Proxy({}, { get() { throw new Error('poison') } }), now: 2 })
    // the four families declaring tool.call each throw on this input
    const added = diags('family-feed').slice(feeds)
    expect(added.map((d) => d.text.slice(0, d.text.indexOf(':')))).toEqual(['family model', 'family context', 'family agents', 'family github'])
    expect(added.every((d) => d.text.includes('poison'))).toBe(true)
    expect(diags('family-state-reset').length).toBe(resets)
    expect(famLive(FAMILIES[0]).session).toBe('A')
    expect(famLive(FAMILIES[0]).sum).toEqual(before.sum)
  } finally { SL.__resetState() }
})

// ---------- В4: a clone refusal of the base family names the lost session (swe2 AR1) ----------

test('S4F15 В4: a clone refusal of the base family names the session whose figures are lost', async () => {
  SL.__resetState()
  try {
    await start(new Map<string, unknown>([['sess:A', SNAP(50, 42_000_000_000)]]))
    const st: Record<string, unknown> = { ...famLive(FAMILIES[0]) }
    expect(st['session']).toBe('A')
    // enumerable: the clone walks it and throws, as in S4F14 У1
    Object.defineProperty(st, 'tools', { get() { throw new Error('poisoned') }, enumerable: true, configurable: true })
    SL.__setFamState(FAMILIES[0]!, st)
    sessionInfo('B', 1)
    const recs = diags('family-state-reset')
    expect(recs.filter((d) => d.text.includes('accumulated figures of session A are lost')).length).toBe(1)
  } finally { SL.__resetState() }
})

// ---------- В5: the last-stop wording reads own keys only (sol 1, swe2 F2) ----------

test('S4F15 В5: prototype keys in the last-stop wording read as their fallbacks', () => {
  const lastStopWording = (EXT as unknown as { lastStopWording: (d: string, c?: string) => unknown }).lastStopWording
  expect(lastStopWording('unheld', 'constructor')).toBe('not held — Claude Code had already resumed the turn (stop_hook_active)')
  expect(lastStopWording('toString')).toBe('toString')
})

// ---------- В6: a frontmatter key "__proto__" is an own field (swe2 F3) ----------

test('S4F15 В6: a frontmatter key "__proto__" is an own field', () => {
  const frontmatterOf = (EXT as unknown as { frontmatterOf: (text: string) => Record<string, string> }).frontmatterOf
  const r = frontmatterOf('---\n__proto__: x\nstatus: ok\n---\n')
  expect(Object.prototype.hasOwnProperty.call(r, '__proto__')).toBe(true)
  expect(Object.getOwnPropertyDescriptor(r, '__proto__')?.value).toBe('x')
  expect(r['status']).toBe('ok')
})

// ---------- В7: the canonical source key keeps an own "__proto__" (swe2 F5) ----------

test('S4F15 В7: two sources differing only in an own "__proto__" key have different keys', () => {
  const k1 = SL.__sourceKeyFresh(JSON.parse('{"kind":"cmd","argv":["a"],"__proto__":{"x":1}}'))
  const k2 = SL.__sourceKeyFresh(JSON.parse('{"kind":"cmd","argv":["a"],"__proto__":{"x":2}}'))
  const k0 = SL.__sourceKeyFresh(JSON.parse('{"kind":"cmd","argv":["a"]}'))
  expect(k1 === k2).toBe(false)
  expect(k1 === k0).toBe(false)
})

// ---------- В8: the key-merge cap is per session (sol AR У7, swe2 F4) ----------

test('S4F15 В8: the key-merge cap is per session', async () => {
  SL.__resetState()
  try {
    const k1 = 'k'.repeat(220)
    const img = boundText(k1)
    const site = (): Record<string, unknown> => ({ [k1]: 1, [img]: 2 })
    const sites = (n: number): Record<string, unknown> => {
      const out: Record<string, unknown> = {}
      for (let i = 0; i < n; i++) out['p' + i] = site()
      return out
    }
    const persisted = new Map<string, unknown>([
      ['sess:A', { ...SNAP(50, 42_000_000_000), origin: '', extra: sites(70) }],
      ['sess:B', { ...SNAP(10, 42_000_000_000), origin: '', extra: sites(1) }],
    ])
    const { $ } = await start(persisted)
    const merges = (): string[] => SL.__episodes().filter((id) => id.startsWith('session-snapshot-key-merge|'))
    const ofA = (): string[] => merges().filter((id) => id.includes(JSON.stringify('sess:A')))
    // the diag buffer holds 64 records (CAP.diag): records are told apart by
    // their text and time, not by their position in the buffer
    const capsSince = (at: number): { at: number; text: string }[] => SL.__diag().filter((d) => d.key === 'session-snapshot-key-merge-cap' && (d as unknown as { at: number }).at > at).map((d) => ({ at: (d as unknown as { at: number }).at, text: d.text }))
    expect(ofA().length).toBe(64)
    const capsA = capsSince(-1).length
    expect(capsA).toBe(1)
    const tSwitch = $.t
    $.session.id = async () => 'B'
    $.t += 16000
    await gather($)
    expect(famLive(FAMILIES[0]).session).toBe('B')
    expect(diags('session-snapshot-key-merge').filter((d) => d.text.includes('store.set sess:B:')).length).toBe(1)
    expect(ofA().length).toBe(0)
    // the read-back of the current key meets 65 merge sites of B (p0 already open)
    persisted.set('sess:B', { ...SNAP(10, 42_000_000_001), origin: '', extra: sites(65) })
    $.t += 16000
    await gather($)
    expect(merges().filter((id) => id.includes(JSON.stringify('sess:B'))).length).toBe(64)
    const capsB = capsSince(tSwitch)
    expect(capsA + capsB.length).toBe(2)
    expect(capsB[0]!.text).toBe('store.set: 64 key-merge records are open in this session; further merges drop the later value without a record')
  } finally { SL.__resetState() }
})

