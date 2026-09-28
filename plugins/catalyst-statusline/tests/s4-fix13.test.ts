import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data/index'
import { cloneState } from '../hooks/data/cloneState'
import { boundText } from '../hooks/data/snapshotText'
import act, * as ACT from '../hooks/data/activity'
import * as REPO from '../hooks/data/repo'
import type { Input, Source } from '../hooks/data/types'
import { walk } from './world'

// S4-FIX13 teeth (brief Т1–Т6). The stand is the one of s4-fix12.test.ts: the
// teeth run against the imported module instance; `t` is the mod's process
// clock (the now seam).
// CONSTRAINT: dotenvOf and yamlListItems are reached through the module
// namespace so this file still loads on a tree where they are not exported.

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

// ---------- Т1: the drop counters read the clone (sol 1) ----------

test('S4F13 Т1: a base state whose tools getter throws resets once and the next input adds no record', async () => {
  SL.__resetState()
  try {
    await start()
    const st: Record<string, unknown> = { ...(FAMILIES[0]!.init() as Record<string, unknown>) }
    // enumerable: the clone walks it and throws, so the tooth pins the order
    // of the counter read against the clone, not the key census of Т6
    Object.defineProperty(st, 'tools', { get() { throw new Error('poisoned') }, enumerable: true, configurable: true })
    SL.__setFamState(FAMILIES[0]!, st)
    eventInput('agent.spawn', { agentId: 's4f13-one' }, 1)
    expect(diags('family-state-reset').length).toBe(1)
    const feeds = diags('family-feed').length
    eventInput('agent.spawn', { agentId: 's4f13-two' }, 2)
    expect(diags('family-state-reset').length).toBe(1)
    expect(diags('family-feed').length).toBe(feeds)
    let threw = false
    let tools: unknown
    try { tools = famLive(FAMILIES[0]).tools } catch { threw = true }
    expect(threw).toBe(false)
    expect(tools !== null && typeof tools === 'object').toBe(true)
  } finally { SL.__resetState() }
})

// ---------- Т2: a snapshot with a hole, a throwing restore (sol 2) ----------

test('S4F13 Т2a: a stored snapshot with a hole in agents.map is one shape fault and no reread', async () => {
  SL.__resetState()
  try {
    const snap = SNAP(50, 42_000_000_000)
    snap['agents'] = { map: new Array(1), done: [] }
    // CONSTRAINT: learnRead's JSON copy (statusline.ts learnRead) turns the
    // hole into null before applySnapshot; a value JSON cannot carry keeps the
    // read on the raw snapshot, so the hole reaches the validator
    snap['extra'] = 1n
    const persisted = new Map<string, unknown>([['sess:A', snap]])
    const { $ } = await start(persisted)
    const shape = diags('session-snapshot-shape')
    expect(shape.length).toBe(1)
    // the validator refuses the hole; a shape record carrying a throw text
    // would be the restore catch of Т2b standing in for it
    expect(shape[0]!.text.endsWith('no accumulated figures restored')).toBe(true)
    expect(diags('session-snapshot-read').length).toBe(0)
    $.t += 16000
    await gather($)
    expect(diags('session-snapshot-shape').length).toBe(1)
    expect(diags('session-snapshot-read').length).toBe(0)
  } finally { SL.__resetState() }
})

test('S4F13 Т2b: a stored snapshot whose tools getter throws is a shape fault that names the throw', async () => {
  SL.__resetState()
  try {
    const snap = SNAP(50, 42_000_000_000)
    Object.defineProperty(snap, 'tools', { get() { throw new Error('s4f13 tools poison') }, enumerable: true, configurable: true })
    const persisted = new Map<string, unknown>([['sess:A', snap]])
    await start(persisted)
    const shape = diags('session-snapshot-shape')
    expect(shape.length).toBe(1)
    expect(shape[0]!.text.includes('s4f13 tools poison')).toBe(true)
    expect(diags('session-snapshot-read').length).toBe(0)
  } finally { SL.__resetState() }
})

// ---------- Т3: tables named by input read own keys only (swe2 F1) ----------

test('S4F13 Т3a: a theme named by a prototype key is unknown and resolves to hud', () => {
  SL.__resetState()
  try {
    for (const name of ['__proto__', 'constructor']) {
      const r = SL.resolveView({ theme: name }, {})
      expect([name, r.themeName, r.unknown]).toEqual([name, 'hud', true])
    }
  } finally { SL.__resetState() }
})

test('S4F13 Т3b: a theme saved under the name "__proto__" is an own key of the themes table and of the stored value', async () => {
  SL.__resetState()
  try {
    // #521 FIX5 Ч4: a theme lives under its own key `statusline.themes.v1:<id>`
    // as `{name, …axes, t}`; the themes table is built from those records
    const data = new Map<string, unknown>()
    const store = {
      get: async (k: string) => data.get(k),
      set: async (k: string, v: unknown) => { data.set(k, JSON.parse(JSON.stringify(v))) },
      delete: async (k: string) => { data.delete(k) },
      keys: async () => [...data.keys()],
    }
    const raw = { template: 'dur||x=constant' }
    const nodes = walk(SL.__renderPicker(raw, 'themes', 120, undefined, store))
    const byKey = (key: string) => nodes.find((n) => n.props?.['key'] === key)
    ;(byKey('theme-name')!.props!['onInput'] as (v: string) => void)('__proto__')
    await drain()
    ;(byKey('theme-save')!.props!['onPress'] as () => void)()
    await drain()
    const keys = [...data.keys()].filter((k) => k.startsWith('statusline.themes.v1:'))
    expect(keys.length).toBe(1)
    expect((data.get(keys[0]!) as { name?: unknown }).name).toBe('__proto__')
    const themes = SL.__stateSnapshot()['userThemes'] as Record<string, unknown>
    expect(Object.getPrototypeOf(themes)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(themes, '__proto__')).toBe(true)
    expect(Object.keys(JSON.parse(JSON.stringify(themes)))).toContain('__proto__')
  } finally { SL.__resetState() }
})

test('S4F13 Т3c: a .env line "__proto__=x" is an own key with its value', () => {
  const dotenvOf = (REPO as unknown as { dotenvOf: (s: unknown) => Record<string, string> }).dotenvOf
  const out = dotenvOf({ files: { '.env': { ok: true, at: 0, v: 'A=1\n__proto__=x' } } })
  expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toBe('x')
  expect(out['A']).toBe('1')
})

test('S4F13 Т3d: a YAML list item keeps a non-head field "constructor" and a head field "__proto__" as own keys', () => {
  const yamlListItems = (ACT as unknown as { yamlListItems: (text: string, key: string) => Record<string, string>[] | null }).yamlListItems
  const items = yamlListItems('findings:\n  - __proto__: z\n    constructor: y\n    status: open\n', 'findings')!
  expect(items.length).toBe(1)
  const item = items[0]!
  expect(Object.getPrototypeOf(item)).toBe(Object.prototype)
  expect(Object.getOwnPropertyDescriptor(item, 'constructor')?.value).toBe('y')
  expect(Object.getOwnPropertyDescriptor(item, '__proto__')?.value).toBe('z')
  expect(item['status']).toBe('open')
})

test('S4F13 Т3e: a frontmatter line "constructor: y" and "__proto__: x" reach the fields as own keys', () => {
  let s: any = act.init()
  const doc = { kind: 'file', path: 'PRODUCT.md', everyMs: 30000, relativeTo: 'project' } as Source
  s = act.reduce(s, { source: doc, ok: true, data: '---\n__proto__: x\nconstructor: y\nstatus: draft\n---\nbody', now: 1 } as Input)
  const slot = (s.project as { path: string; fm: Record<string, string> }[]).find((p) => p.path === 'PRODUCT.md')!
  expect(Object.getOwnPropertyDescriptor(slot.fm, 'constructor')?.value).toBe('y')
  expect(Object.getOwnPropertyDescriptor(slot.fm, '__proto__')?.value).toBe('x')
  expect(Object.getPrototypeOf(slot.fm)).toBe(Object.prototype)
  expect(slot.fm['status']).toBe('draft')
})

// ---------- Т4: the merge episode is keyed by the object path too ----------

test('S4F13 Т4: one image merged in two sibling objects gives two records naming both paths', async () => {
  SL.__resetState()
  try {
    const k1 = 'k'.repeat(220)
    const img = boundText(k1)
    const seed = { ...SNAP(50, 42_000_000_000), origin: '', extra: { a: { [k1]: 1, [img]: 2 }, b: { [k1]: 1, [img]: 2 } } }
    const persisted = new Map<string, unknown>([['sess:A', seed]])
    await start(persisted)
    const recs = diags('session-snapshot-key-merge')
    expect(recs.length).toBe(2)
    expect(recs.filter((d) => d.text.includes('object ' + JSON.stringify('extra') + '/' + JSON.stringify('a') + ' has')).length).toBe(1)
    expect(recs.filter((d) => d.text.includes('object ' + JSON.stringify('extra') + '/' + JSON.stringify('b') + ' has')).length).toBe(1)
  } finally { SL.__resetState() }
})

// ---------- Т5: the cap text carries no count (swe2 F3) ----------

test('S4F13 Т5: 70 spawns give one activity-agents-cap record whose text carries no number but 64', async () => {
  SL.__resetState()
  try {
    await start()
    for (let i = 0; i < 70; i++) eventInput('agent.spawn', { tool_use_id: 'a' + i }, i + 1)
    const recs = diags('activity-agents-cap')
    expect(recs.length).toBe(1)
    expect(/\d/.test(recs[0]!.text.replace(/64/g, ''))).toBe(false)
  } finally { SL.__resetState() }
})

// ---------- Т6: cloneState refuses what Object.entries cannot see (swe2 Q2c) ----------

test('S4F13 Т6: cloneState refuses a symbol key and a non-enumerable key with a TypeError', () => {
  const sym: Record<PropertyKey, unknown> = { [Symbol('s')]: 1 }
  const hidden: Record<string, unknown> = { a: 1 }
  Object.defineProperty(hidden, 'b', { value: 2, enumerable: false })
  for (const v of [sym, hidden]) {
    let err: unknown
    try { cloneState(v) } catch (e) { err = e }
    expect(err instanceof TypeError).toBe(true)
  }
})
