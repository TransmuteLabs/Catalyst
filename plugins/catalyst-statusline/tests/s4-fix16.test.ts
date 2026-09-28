import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data/index'
import { boundText } from '../hooks/data/snapshotText'
import { walk, rowText } from './world'
import type { Node } from './world'
import type { Source } from '../hooks/data/types'

// S4-FIX16 teeth (brief Г1–Г5). The stand is the one of s4-fix15.test.ts: the
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

const k1 = 'k'.repeat(220)
const img = boundText(k1)
const sites = (n: number): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < n; i++) out['p' + i] = { [k1]: 1, [img]: 2 }
  return out
}
const at = (d: unknown): number => (d as { at: number }).at
const recsSince = (key: string, t: number): { at: number; text: string }[] => SL.__diag().filter((d) => d.key === key && at(d) > t).map((d) => ({ at: at(d), text: d.text }))

// ---------- Г1: the reset keeps the session identity (sol 1) ----------

test('S4F16 Г1: a family reset on a state the reduce throws on keeps session A and its snapshot', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    sessionInfo('A', 1)
    expect(famLive(FAMILIES[0]).session).toBe('A')
    SL.__setFamState(FAMILIES[0]!, { ...famLive(FAMILIES[0]), tools: null })
    eventInput('tool.call', { callKey: 'c1', tool: 'Read', input: {} }, 2)
    expect(diags('family-state-reset').filter((d) => d.text.includes('could not be reduced')).length).toBe(1)
    const live = famLive(FAMILIES[0])
    expect(live.session).toBe('A')
    expect(live.tools.active.has('c1')).toBe(true)
    await h['session.end']($, {}, async () => ({}))
    await drain()
    const snap = persisted.get('sess:A') as { tools?: { sawAny?: unknown } } | undefined
    expect(snap !== undefined && snap !== null).toBe(true)
    // the snapshot shape carries no active calls (base.ts snapshotOf); c1's trace in it is sawAny
    expect(snap!.tools!.sawAny).toBe(true)
  } finally { SL.__resetState() }
})

// ---------- Г2: a refused init() on the retry keeps the input's error (swe2 5) ----------

test('S4F16 Г2: reduce and init() both throwing give one family-feed with the input error and one family-init-failed', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    await start()
    const stub = {
      family: 's4f16-noinit',
      elements: [],
      sources: [{ source: { kind: 'event', event: 'turn.start' }, elements: [] }],
      init: () => { throw new Error('s4f16 init fault') },
      reduce: () => { throw new Error('s4f16 input fault') },
    }
    FAMILIES.push(stub as never)
    SL.__setFamState(stub as never, { mark: 1 })
    eventInput('turn.start', {}, 1)
    const feeds = diags('family-feed').filter((d) => d.text.startsWith('family s4f16-noinit:'))
    expect(feeds.length).toBe(1)
    expect(feeds[0]!.text.includes('s4f16 input fault')).toBe(true)
    const inits = diags('family-init-failed')
    expect(inits.length).toBe(1)
    expect(inits[0]!.text.includes('s4f16 init fault')).toBe(true)
    expect(famLive(stub)).toEqual({ mark: 1 })
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

// ---------- Г3: session diagnostics and episodes follow the session (sol 2, swe2 2) ----------

test('S4F16 Г3a: the tools-cap record is written again in a new session', async () => {
  SL.__resetState()
  try {
    const { $ } = await start()
    for (let i = 0; i < 257; i++) eventInput('tool.call', { callKey: 'a' + i, tool: 'Read', input: {} }, i + 1)
    expect(diags('tools-cap').length).toBe(1)
    const tSwitch = $.t
    $.t += 1000
    sessionInfo('B', 1000)
    for (let i = 0; i < 257; i++) eventInput('tool.call', { callKey: 'b' + i, tool: 'Read', input: {} }, 1001 + i)
    expect(recsSince('tools-cap', tSwitch).length).toBe(1)
  } finally { SL.__resetState() }
})

test('S4F16 Г3b: the activity-agents-cap record is written again in a new session', async () => {
  SL.__resetState()
  try {
    const { $ } = await start()
    for (let i = 0; i < 70; i++) eventInput('agent.spawn', { tool_use_id: 'a' + i }, i + 1)
    expect(diags('activity-agents-cap').length).toBe(1)
    const tSwitch = $.t
    $.t += 1000
    sessionInfo('B', 1000)
    for (let i = 0; i < 70; i++) eventInput('agent.spawn', { tool_use_id: 'b' + i }, 1001 + i)
    expect(recsSince('activity-agents-cap', tSwitch).length).toBe(1)
  } finally { SL.__resetState() }
})

test('S4F16 Г3c: a second stale read in a new session writes its record', async () => {
  SL.__resetState()
  try {
    const { $ } = await start()
    $.session.id = async () => 'Z'
    await SL.restoreAfterReload($, {} as never)
    await drain()
    expect(diags('session-snapshot-stale').length).toBe(1)
    const tSwitch = $.t
    $.t += 1000
    sessionInfo('B', 1000)
    $.session.id = async () => 'Y'
    await SL.restoreAfterReload($, {} as never)
    await drain()
    const recs = recsSince('session-snapshot-stale', tSwitch)
    expect(recs.length).toBe(1)
    expect(recs[0]!.text).toBe('snapshot for Y discarded; current session is B')
  } finally { SL.__resetState() }
})

test('S4F16 Г3d: the array-cap episode of the old session ends at the session change', async () => {
  SL.__resetState()
  try {
    await start(new Map<string, unknown>([['sess:A', { ...SNAP(50, 42_000_000_000), origin: '', extra: { arr: new Array(70).fill(1) } }]]))
    expect(SL.__episodes().includes('session-snapshot-array-cap|sess:A')).toBe(true)
    sessionInfo('B', 1000)
    expect(SL.__episodes().includes('session-snapshot-array-cap|sess:A')).toBe(false)
  } finally { SL.__resetState() }
})

// ---------- Г4: a late read of the old session leaves the shared state alone (sol 3) ----------

test('S4F16 Г4: a late read of sess:A after the switch to B takes no merge episodes of B', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>([['sess:B', { ...SNAP(10, 42_000_000_000), origin: '', extra: sites(1) }]])
    handlers()
    const $ = fullStand(persisted, 'A')
    let release: (v: unknown) => void = () => undefined
    const gate = new Promise<unknown>((resolve) => { release = resolve })
    const get = $.store.get
    $.store.get = async (k: string) => (k === 'sess:A' ? gate : get(k))
    const restored = SL.restoreAfterReload($, {} as never)
    await drain()
    expect(famLive(FAMILIES[0]).session).toBe('A')
    sessionInfo('B', 1000)
    expect(famLive(FAMILIES[0]).session).toBe('B')
    release({ ...SNAP(50, 42_000_000_000), origin: '', extra: sites(64) })
    await restored
    await drain()
    expect(SL.__episodes().filter((id) => id.includes(JSON.stringify('sess:A'))).length).toBe(0)
    $.session.id = async () => 'B'
    $.t += 16000
    await gather($)
    expect(diags('session-snapshot-key-merge').filter((d) => d.text.includes('store.set sess:B:')).length).toBe(1)
  } finally { SL.__resetState() }
})

// ---------- Г5: template and setting keys are own keys only (sol 4, swe2 1) ----------

test('S4F16 Г5: a template variable named "toString" is unknown', () => {
  SL.__resetState()
  try {
    const text = rowText(walk(SL.__render({ template: 'x={toString}' }) as Node))
    expect(text.includes('{?toString}')).toBe(true)
    expect(diags('tpl-unknown-toString').map((d) => d.text)).toEqual(["template: unknown variable 'toString'"])
  } finally { SL.__resetState() }
})
