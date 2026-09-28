import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data/index'
import { boundText } from '../hooks/data/snapshotText'
import * as USAGE from '../hooks/data/usage'
import * as EXT from '../hooks/data/external'
import * as BASE from '../hooks/data/base'
import * as REPO from '../hooks/data/repo'
import type { Source } from '../hooks/data/types'

// S4-FIX14 teeth (brief У1–У7). The stand is the one of s4-fix13.test.ts: the
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

// ---------- У1: the farewell is taken from the clone (sol 1, swe2 F1) ----------

test('S4F14 У1: session info to a new id over a poisoned base state resets the family and switches the id', async () => {
  SL.__resetState()
  try {
    await start(new Map<string, unknown>([['sess:A', SNAP(50, 42_000_000_000)]]))
    const st: Record<string, unknown> = { ...famLive(FAMILIES[0]) }
    expect(st['session']).toBe('A')
    // enumerable: the clone walks it and throws, as in S4F13 Т1
    Object.defineProperty(st, 'tools', { get() { throw new Error('poisoned') }, enumerable: true, configurable: true })
    SL.__setFamState(FAMILIES[0]!, st)
    const feeds = diags('family-feed').length
    SL.__feed({ source: { kind: 'session', call: 'info' } as Source, ok: true, data: { id: 'B' }, now: 1 })
    expect(diags('family-feed').length).toBe(feeds)
    expect(diags('family-state-reset').length).toBe(1)
    expect(famLive(FAMILIES[0]).session).toBe('B')
  } finally { SL.__resetState() }
})

// ---------- У2: the tools-cap text says what the cap does (sol 2, swe2 F2) ----------

test('S4F14 У2: the 257th distinct tool call is not tracked and the cap record says so', async () => {
  SL.__resetState()
  try {
    await start()
    for (let i = 0; i < 257; i++) eventInput('tool.call', { callKey: 'c' + i, tool: 'Read', input: {} }, i + 1)
    expect(SL.__toolsCapDropped()).toBe(1)
    const recs = diags('tools-cap')
    expect(recs.length).toBe(1)
    expect(recs[0]!.text).toBe('active tools over cap 256; new calls are not tracked until a tracked call finishes')
    const active = famLive(FAMILIES[0]).tools.active
    expect(active.has('c0')).toBe(true)
    expect(active.has('c256')).toBe(false)
  } finally { SL.__resetState() }
})

// ---------- У3: the ordering reads are part of the parse (swe2 F3) ----------

test('S4F14 У3: a stored snapshot whose seq getter throws is one shape fault and no reread', async () => {
  SL.__resetState()
  try {
    const snap = SNAP(50, 42_000_000_000)
    Object.defineProperty(snap, 'seq', { get() { throw new Error('s4f14 seq poison') }, enumerable: true, configurable: true })
    const { $ } = await start(new Map<string, unknown>([['sess:A', snap]]))
    const shape = diags('session-snapshot-shape')
    expect(shape.length).toBe(1)
    expect(shape[0]!.text.includes('s4f14 seq poison')).toBe(true)
    expect(diags('session-snapshot-read').length).toBe(0)
    $.t += 16000
    await gather($)
    expect(diags('session-snapshot-shape').length).toBe(1)
    expect(diags('session-snapshot-read').length).toBe(0)
  } finally { SL.__resetState() }
})

// ---------- У4: tables named by input read own keys only (sol 3–4, swe2 F4) ----------

test('S4F14 У4а: an icon set named "constructor" falls back to the unicode glyph', () => {
  SL.__resetState()
  try {
    expect(SL.__iconOf('dur', SL.parseElements('dur:ic=constructor'), 'unicode')).toBe(SL.__iconOf('dur', {}, 'unicode'))
  } finally { SL.__resetState() }
})

test('S4F14 У4б: a model named "constructor" or "__proto__" is priced at the fallback', () => {
  for (const model of ['constructor', '__proto__']) {
    expect([model, USAGE.priceOf(model, { input: 1e6, output: 0, write: 0, read: 0 })]).toEqual([model, 3])
  }
})

test('S4F14 У4в: a config dir named "constructor" or "__proto__" is no instance', () => {
  expect(REPO.instanceOfDir('/x/constructor')).toBe(undefined)
  expect(REPO.instanceOfDir('/x/__proto__')).toBe(undefined)
})

test('S4F14 У4г: a vercel state named "constructor" keeps its own text and the neutral dot', () => {
  expect(EXT.vercelLabel('constructor')).toBe('constructor')
  expect(EXT.vercelDot('constructor')).toBe('·')
  expect(EXT.vercelLabel('READY')).toBe('Ready')
})

test('S4F14 У4д: a review decision named by a prototype key reads as no review', () => {
  expect(EXT.reviewPhrase('constructor')).toBe('no review')
  expect(EXT.reviewWord('toString')).toBe('review')
  expect(EXT.reviewPhrase('APPROVED')).toBe('approved')
})

test('S4F14 У4е: a row icon named "constructor" draws no icon', () => {
  expect(BASE.rowText({ icon: 'constructor', label: 'x' } as never)).toBe('x')
})

test('S4F14 У4ж: an element setting named "__proto__" is an own key with its value', () => {
  SL.__resetState()
  try {
    const s = SL.parseElements('dur:__proto__=z')['dur']!
    expect(Object.getOwnPropertyDescriptor(s, '__proto__')?.value).toBe('z')
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype)
  } finally { SL.__resetState() }
})

// ---------- У6: the episode names the array index (swe2 F6) ----------

test('S4F14 У6: one image merged in two elements of one array gives two records naming both indices', async () => {
  SL.__resetState()
  try {
    const k1 = 'k'.repeat(220)
    const img = boundText(k1)
    const seed = { ...SNAP(50, 42_000_000_000), origin: '', extra: { arr: [{ [k1]: 1, [img]: 2 }, { [k1]: 1, [img]: 2 }] } }
    await start(new Map<string, unknown>([['sess:A', seed]]))
    const recs = diags('session-snapshot-key-merge')
    expect(recs.length).toBe(2)
    expect(recs.filter((d) => d.text.includes('object ' + JSON.stringify('extra') + '/' + JSON.stringify('arr') + '/[0] has')).length).toBe(1)
    expect(recs.filter((d) => d.text.includes('object ' + JSON.stringify('extra') + '/' + JSON.stringify('arr') + '/[1] has')).length).toBe(1)
  } finally { SL.__resetState() }
})

// ---------- У7: key-merge episodes are capped (sol 5, swe2 F7) ----------

test('S4F14 У7: 70 merge sites open 64 key-merge episodes and one cap record', async () => {
  SL.__resetState()
  try {
    const k1 = 'k'.repeat(220)
    const img = boundText(k1)
    const extra: Record<string, unknown> = {}
    for (let i = 0; i < 70; i++) extra['p' + i] = { [k1]: 1, [img]: 2 }
    const seed = { ...SNAP(50, 42_000_000_000), origin: '', extra }
    await start(new Map<string, unknown>([['sess:A', seed]]))
    expect(SL.__episodes().filter((id) => id.startsWith('session-snapshot-key-merge|')).length).toBe(64)
    expect(diags('session-snapshot-key-merge-cap').length).toBe(1)
  } finally { SL.__resetState() }
})
