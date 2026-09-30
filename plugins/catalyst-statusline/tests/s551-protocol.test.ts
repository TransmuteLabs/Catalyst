import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data'
import type { Source } from '../hooks/data/types'
import {
  STORE_DRAFT, STORE_OPEN, STORE_OPEN_CLOSED, STORE_OPEN_CLOSED_V2, STORE_EPOCH, STORE_UNDO, STORE_SAVING, STORE_THEMES, STORE_LASTGOOD,
  NS_OPEN, NS_MARK, NS_EPOCH, NS_DRAFT, NS_SAVING, NS_UNDO, NS_SESS, EXT_WRITER, OPTION_ROWS,
  v3Key, v3Keys, flagKeys, markKeys, epochs, draftOf, sessValue, sessKeys, undoStack, saveMarks, themeRecords, interleaved, walk, textOf,
} from './world'
import type { Node } from './world'

declare const console: { log(value: string): void }

// #551 PROTOCOL teeth T1–T20 (SPEC-551 §5.1). CONSTRAINT (s521-fix1 tooth
// 11): the kit skips a store hook that throws, so every refused or held store
// call is stood up in this realm and the module is driven directly; a second
// process is a second state (SL.__resetState(), the store map shared).
// CONSTRAINT (§5.1): a publication a tooth writes for another writer is of the
// version under test — under the key it read when that key is of the previous
// form, under a key of its own when it is a publication of this version.

const V3 = typeof (SL as unknown as Record<string, unknown>)['__writerIdOf'] === 'function'
const writerOf = (): string | null => (V3 ? ((SL as unknown as Record<string, () => string | null>)['__writerIdOf']!)() : null)

const DAY = 86400000
const HOUR = 3600000
const FLAG_TTL = 3 * DAY
const CLOCK_SKEW = 5 * 60 * 1000
const drain = async (): Promise<void> => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const drainLong = async (): Promise<void> => { for (let i = 0; i < 12; i++) await drain() }
const snap = (): Record<string, any> => SL.__stateSnapshot() as Record<string, any>
const keyOf = (n: Node): string => String(n.key ?? (n.props as Record<string, unknown> | undefined)?.['key'] ?? '')

const body = (ids: string[][], axes: Record<string, string> = {}): Record<string, unknown> => ({
  lines: ids.map((l) => l.map((id) => ({ id, body: '{' + id + '.text}' }))), axes, elements: {}, focus: null, tab: 'layout', query: '', fam: 'model', page: 0, targetLine: 0, themeName: '',
})

// the keys a writer of the version under test uses
const flagKeyFor = (session: string, id: string, seq: number): string => (V3 ? v3Key(NS_OPEN, session, EXT_WRITER, seq) : STORE_OPEN + ':' + id)
const flagValue = (session: string, id: string, e: number, n: number, at: number): Record<string, unknown> => (V3 ? { session, openId: id, e, n, at } : { session, token: id, e, n, at })
const markKeyFor = (session: string, e: number, n: number, seq: number): string => (V3 ? v3Key(NS_MARK, session, EXT_WRITER, seq) : STORE_OPEN_CLOSED_V2 + ':' + session + ':' + String(e) + ':' + String(n))
const draftKeyFor = (session: string, seq: number): string => (V3 ? v3Key(NS_DRAFT, session, EXT_WRITER, seq) : STORE_DRAFT + ':' + session)
const epochKeyFor = (seq: number): string => (V3 ? v3Key(NS_EPOCH, undefined, EXT_WRITER, seq) : STORE_EPOCH)
const sessKeyFor = (session: string, seq: number): string => (V3 ? v3Key(NS_SESS, session, EXT_WRITER, seq) : 'sess:' + session)
const valueOf = (persisted: Map<string, unknown>, key: string): Record<string, any> => persisted.get(key) as Record<string, any>

type Gate = { p: Promise<void>; open: () => void }
const gate = (): Gate => {
  let open: () => void = () => undefined
  const p = new Promise<void>((r) => { open = r })
  return { p, open }
}

type StoreStand = {
  get: (k: string) => Promise<unknown>
  set: (k: string, v: unknown) => Promise<void>
  delete: (k: string) => Promise<void>
  keys: () => Promise<string[]>
}
type StoreOpts = {
  refuseDelete?: (k: string) => boolean
  refuseSet?: (k: string) => boolean
  holdSet?: (k: string, v: unknown) => Promise<void> | undefined
  onSet?: (k: string, v: unknown) => void
  maxKey?: number
}

// the kit store's semantics over one map; the options refuse, hold or count
// named keys the way another process or a refusing host would
const storeOf = (persisted: Map<string, unknown>, o: StoreOpts = {}): StoreStand => ({
  get: async (k) => {
    if (o.maxKey !== undefined && k.length > o.maxKey) throw new Error('key longer than ' + String(o.maxKey) + ': ' + String(k.length))
    return persisted.get(k)
  },
  set: async (k, v) => {
    if (o.maxKey !== undefined && k.length > o.maxKey) throw new Error('key longer than ' + String(o.maxKey) + ': ' + String(k.length))
    const copy = JSON.parse(JSON.stringify(v))
    if (o.refuseSet?.(k)) throw new Error('write of ' + k + ' refused by the test')
    const held = o.holdSet?.(k, copy)
    if (held) await held
    persisted.set(k, copy)
    o.onSet?.(k, copy)
  },
  delete: async (k) => {
    if (o.refuseDelete?.(k)) throw new Error('delete of ' + k + ' refused by the test')
    persisted.delete(k)
  },
  keys: async () => [...persisted.keys()],
})

type Arm = { ms: number; fn: () => void; cancelled: boolean }
type Clock = { now: number; arms: Arm[] }

const configOf = (values: Map<string, unknown>) => ({
  list: async () => OPTION_ROWS.map((r) => (values.has(r.key) ? { ...r, value: values.get(r.key) } : { ...r })),
  set: async (e: { key: string; value: unknown }) => {
    values.set(e.key, e.value)
    return { value: e.value }
  },
})

const standOf = (id: () => Promise<string>, store: StoreStand, clock: Clock = { now: 5000, arms: [] }, config: unknown = { list: async () => [], set: async () => undefined }): any => ({
  clock: {
    now: async () => clock.now,
    every: (ms: number, fn: () => void) => {
      const arm: Arm = { ms, fn, cancelled: false }
      clock.arms.push(arm)
      return { cancel() { arm.cancelled = true } }
    },
    after: () => ({ cancel() {} }),
  },
  ui: { log: async () => undefined, invalidate: () => undefined, status: () => undefined, toast: () => undefined, open: async () => undefined, close: async () => undefined },
  store,
  session: {
    id,
    cwd: async () => '/work/demo/sub',
    root: async () => '/work/demo',
    usage: async () => ({ context: { tokens: 1, window: 2 }, rateLimits: [], cost: { usd: 0 } }),
    model: async () => 'm',
    turns: async () => 0,
    messages: async () => [],
    surfaces: async () => ['terminal'],
  },
  env: { get: async () => '' },
  fs: { read: async () => '# x\n' },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  config,
  plugin: { name: 'catalyst-statusline', root: '/stand' },
})

type Handlers = Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>>
// a fresh process: a new state with the handlers registered on it
const boot = (): Handlers => {
  SL.__resetState()
  const handlers: Handlers = {}
  const on = (event: string, ...rest: unknown[]): void => { handlers[event] = rest[rest.length - 1] as never }
  SL.register(on as never, {} as never)
  return handlers
}
const command = (h: Handlers, $: unknown): Promise<unknown> => h['command.run']!($ as never, { command: 'statusline-mod', args: '' } as never, async (v: unknown) => v)
const liveArms = (clock: Clock): Arm[] => clock.arms.filter((a) => !a.cancelled)
const treeOf = (tab: string, store: StoreStand, $: any): Node[] => walk(SL.__renderPicker({}, tab, 120, undefined, store, $) as Node)
const pressOn = async (nodes: Node[], key: string): Promise<void> => {
  const node = nodes.find((n) => keyOf(n) === key)
  expect({ key, drawn: node !== undefined }).toEqual({ key, drawn: true })
  ;(node!.props!['onPress'] as () => void)()
  await drainLong()
}
const diagOf = (key: string): string[] => SL.__diag().filter((d) => d.key === key).map((d) => d.text)
const ROW = (field: string): string => 'catalyst-statusline.' + field
const openIn = async (session: string, persisted: Map<string, unknown>, clock: Clock, o: StoreOpts = {}, config?: unknown): Promise<{ h: Handlers; $: any; store: StoreStand }> => {
  const h = boot()
  const store = storeOf(persisted, o)
  const $ = standOf(async () => session, store, clock, config)
  await SL.__pictureReadClock($)
  await command(h, $)
  await drainLong()
  expect(snap()['pickerOpen']).toBe(true)
  return { h, $, store }
}
const restoreIn = async (session: string, store: StoreStand, clock: Clock = { now: 5000, arms: [] }): Promise<any> => {
  boot()
  const $ = standOf(async () => session, store, clock)
  await SL.__pictureReadClock($)
  await SL.restoreAfterReload($, {} as never)
  await drainLong()
  return $
}

// ---------- T1: measurement A ----------

test('#551 T1 (D1, D2): a publication of the same open that lands between the restore\'s read of its closed flag and the delete stays, and the next restore opens the panel', async () => {
  const persisted = new Map<string, unknown>()
  const oldKey = flagKeyFor('A', 'f', 1)
  persisted.set(oldKey, flagValue('A', 'f', 1, 1, 5000))
  persisted.set(markKeyFor('A', 3, 0, 1), { session: 'A', e: 3, n: 0, at: 5000 })
  const newKey = V3 ? flagKeyFor('A', 'f', 2) : oldKey
  const newer = flagValue('A', 'f', 5, 0, 5000)
  let injected = false
  const store = interleaved(storeOf(persisted), (call, key) => {
    if (call === 'delete' && key === oldKey && !injected) {
      injected = true
      persisted.set(newKey, newer)
    }
  })
  try {
    await restoreIn('A', store)
    expect({ injected, firstOpen: snap()['pickerOpen'] }).toEqual({ injected: true, firstOpen: false })
    expect(persisted.get(newKey)).toEqual(newer)
    await restoreIn('A', storeOf(persisted))
    expect(snap()['pickerOpen']).toBe(true)
  } finally {
    SL.__resetState()
  }
})

// ---------- T2: measurement B, both arms ----------

test('#551 T2 (D5): a flag in flight across the age collection of its close mark lands late — the restore keeps the panel closed and deletes the flag, whether the mark was collected or kept', async () => {
  const markAt = 1728000000
  const flagAt = 1727999999
  const pruneAt = 2332800001
  for (const keepMark of [false, true]) {
    const persisted = new Map<string, unknown>()
    const markKey = markKeyFor('A', 2, 1, 1)
    const flagKey = flagKeyFor('A', 'late-A', 2)
    const flight = gate()
    const io = storeOf(persisted, {
      holdSet: (key) => (key === flagKey ? flight.p : undefined),
      refuseDelete: (key) => keepMark && key === markKey,
    })
    try {
      const lateWrite = io.set(flagKey, flagValue('A', 'late-A', 2, 0, flagAt))
      await io.set(markKey, { session: 'A', e: 2, n: 1, at: markAt })
      const hB = boot()
      const $B = standOf(async () => 'B', io, { now: pruneAt, arms: [] })
      await SL.__pictureReadClock($B)
      await command(hB, $B)
      await drainLong()
      expect({ keepMark, markPresent: persisted.has(markKey) }).toEqual({ keepMark, markPresent: keepMark })
      flight.open()
      await lateWrite
      expect(persisted.has(flagKey)).toBe(true)
      await restoreIn('A', io, { now: pruneAt, arms: [] })
      expect({ keepMark, panelA: snap()['pickerOpen'], flagPresent: persisted.has(flagKey) }).toEqual({ keepMark, panelA: false, flagPresent: false })
    } finally {
      flight.open()
      SL.__resetState()
    }
  }
})

// ---------- T3: every protocol key is set once ----------

test('#551 T3 (D2): open, two edits, a tick, a rebind, a close, a reopen, a save, an undo and a theme save set no key twice but the last good configuration and the keyed themes', async () => {
  const persisted = new Map<string, unknown>()
  const sets = new Map<string, number>()
  const values = new Map<string, unknown>()
  const clock: Clock = { now: 10 * DAY, arms: [] }
  const session = { id: 'A' }
  try {
    const h = boot()
    const store = storeOf(persisted, { onSet: (k) => sets.set(k, (sets.get(k) ?? 0) + 1) })
    const $ = standOf(async () => session.id, store, clock, configOf(values))
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect(snap()['pickerOpen']).toBe(true)
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
    await pressOn(treeOf('numbers', store, $), 'num:numTokens:raw')
    clock.now += HOUR
    liveArms(clock)[0]!.fn()
    await drainLong()
    session.id = 'B'
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('B')
    await SL.closeKeepDraft($)
    await drainLong()
    await command(h, $)
    await drainLong()
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
    await pressOn(treeOf('numbers', store, $), 'save')
    await pressOn(treeOf('numbers', store, $), 'undo')
    await SL.__saveTheme($, 'моя')
    await drainLong()
    const twice = [...sets].filter(([k, n]) => n > 1 && k !== STORE_LASTGOOD && !k.startsWith(STORE_THEMES + ':'))
    expect(twice).toEqual([])
    const count = (p: (k: string) => boolean): number => [...sets.keys()].filter(p).length
    expect({
      flags: count((k) => k.startsWith(STORE_OPEN) || k.startsWith(NS_OPEN)) >= 3,
      drafts: count((k) => k.startsWith(STORE_DRAFT) || k.startsWith(NS_DRAFT)) >= 3,
      marks: count((k) => k.startsWith(STORE_OPEN_CLOSED) || k.startsWith(NS_MARK)) >= 1,
      undo: count((k) => k.startsWith(STORE_UNDO) || k.startsWith(NS_UNDO)) >= 1,
      saving: count((k) => k.startsWith(STORE_SAVING) || k.startsWith(NS_SAVING)) >= 1,
    }).toEqual({ flags: true, drafts: true, marks: true, undo: true, saving: true })
  } finally {
    SL.__resetState()
  }
})

// ---------- T4: two environments, one clock ----------

test('#551 T4 (D3, #560): two environments with the same clock take different flag keys and different saveIds, each under its own writer id', async () => {
  const persisted = new Map<string, unknown>()
  const values = new Map<string, unknown>()
  const ids: Array<{ writer: string | null; flag: string; saveId: string }> = []
  try {
    for (let env = 0; env < 2; env++) {
      const clock: Clock = { now: 5000, arms: [] }
      const before = new Set(flagKeys(persisted, 'A'))
      const { $, store } = await openIn('A', persisted, clock, {}, configOf(values))
      const flag = flagKeys(persisted, 'A').filter((k) => !before.has(k))
      expect(flag.length).toBe(1)
      await pressOn(treeOf('numbers', store, $), env === 0 ? 'num:numUsd:short' : 'num:numUsd:exact')
      const had = new Set(undoStack(persisted).map((r) => r.saveId))
      await pressOn(treeOf('numbers', store, $), 'save')
      const fresh = undoStack(persisted).map((r) => String(r.saveId)).filter((id) => !had.has(id))
      expect(fresh.length).toBe(1)
      ids.push({ writer: writerOf(), flag: flag[0]!, saveId: fresh[0]! })
      await SL.closeKeepDraft($)
    }
    expect(ids[0]!.flag).not.toBe(ids[1]!.flag)
    expect(ids[0]!.saveId).not.toBe(ids[1]!.saveId)
    expect(ids.map((i) => typeof i.writer === 'string' && i.writer !== '' && i.saveId.startsWith(i.writer + ':'))).toEqual([true, true])
    expect(ids[0]!.writer).not.toBe(ids[1]!.writer)
  } finally {
    SL.__resetState()
  }
})

// ---------- T5: no writer id, no publication ----------

test('#551 T5 (D3): without crypto.randomUUID, or with one that answers another form, no key of the protocol is written and store-writer-id is said once', async () => {
  // CONSTRAINT (probe logs-551-protocol/probes/crypto-realm): the module reads
  // the crypto of this realm; its own randomUUID is not configurable, the
  // global binding is
  const g = globalThis as unknown as Record<string, unknown>
  const real = g['crypto'] as { getRandomValues: (a: Uint8Array) => Uint8Array }
  for (const arm of ['absent', 'form'] as const) {
    const persisted = new Map<string, unknown>()
    const written: string[] = []
    const fake = { getRandomValues: (a: Uint8Array) => real.getRandomValues(a), randomUUID: arm === 'absent' ? undefined : () => 'not-a-uuid' }
    Object.defineProperty(g, 'crypto', { value: fake, configurable: true, writable: true })
    try {
      const clock: Clock = { now: 5000, arms: [] }
      const h = boot()
      const store = storeOf(persisted, { onSet: (k) => written.push(k) })
      const $ = standOf(async () => 'A', store, clock)
      await SL.__pictureReadClock($)
      await command(h, $)
      await drainLong()
      expect(snap()['open']).toBeNull()
      expect(diagOf('store-writer-id')).toHaveLength(1)
      await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
      await SL.closeKeepDraft($)
      await drainLong()
      const protocol = written.filter((k) => k !== STORE_LASTGOOD && !k.startsWith(STORE_THEMES + ':'))
      expect({ arm, protocol }).toEqual({ arm, protocol: [] })
      expect({ arm, said: diagOf('store-writer-id').length }).toEqual({ arm, said: 1 })
    } finally {
      Object.defineProperty(g, 'crypto', { value: real, configurable: true, writable: true })
      SL.__resetState()
    }
  }
})

// ---------- T6: adoption publishes its own copy ----------

test('#551 T6 (D4): the restore of a new environment publishes a copy of the flag it adopts before any tick — a new key, the same openId and order; the source goes after it landed and is never its own', async () => {
  const persisted = new Map<string, unknown>()
  try {
    const clock: Clock = { now: 5000, arms: [] }
    await openIn('A', persisted, clock)
    const source = flagKeys(persisted, 'A')
    expect(source.length).toBe(1)
    const src = valueOf(persisted, source[0]!)
    const flagSets: string[] = []
    const store = storeOf(persisted, { onSet: (k) => { if (k.startsWith(STORE_OPEN) || k.startsWith(NS_OPEN)) flagSets.push(k) } })
    await restoreIn('A', store, { now: 5000, arms: [] })
    expect(snap()['pickerOpen']).toBe(true)
    expect(flagSets.length).toBe(1)
    const copy = valueOf(persisted, flagSets[0]!)
    expect({ key: flagSets[0] !== source[0], openId: copy['openId'] === src['openId'] && typeof copy['openId'] === 'string', e: copy['e'], n: copy['n'] }).toEqual({ key: true, openId: true, e: src['e'], n: src['n'] })
    expect(persisted.has(source[0]!)).toBe(false)
    expect(snap()['open']?.confirmed).toEqual([flagSets[0]])
  } finally {
    SL.__resetState()
  }
})

// ---------- T7, T8: a re-publication keeps its order ----------

test('#551 T7 (D4): a re-publication at a draft write keeps the open\'s (e, n) under a new key, and its predecessor goes', async () => {
  const persisted = new Map<string, unknown>()
  try {
    const { $, store } = await openIn('A', persisted, { now: 5000, arms: [] })
    const [k1] = flagKeys(persisted, 'A')
    const v1 = valueOf(persisted, k1!)
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
    const now = flagKeys(persisted, 'A')
    expect(now.length).toBe(1)
    expect({ key: now[0] !== k1, e: valueOf(persisted, now[0]!)['e'], n: valueOf(persisted, now[0]!)['n'] }).toEqual({ key: true, e: v1['e'], n: v1['n'] })
  } finally {
    SL.__resetState()
  }
})

test('#551 T8 (D4): a refused re-publication leaves the one before as it was; the next one takes a new key and the same order', async () => {
  const persisted = new Map<string, unknown>()
  let refuse = false
  try {
    const { $, store } = await openIn('A', persisted, { now: 5000, arms: [] }, { refuseSet: (k) => refuse && (k.startsWith(STORE_OPEN) || k.startsWith(NS_OPEN)) })
    const [k1] = flagKeys(persisted, 'A')
    const v1 = JSON.stringify(persisted.get(k1!))
    refuse = true
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
    expect({ keys: flagKeys(persisted, 'A'), value: JSON.stringify(persisted.get(k1!)) }).toEqual({ keys: [k1!], value: v1 })
    expect(diagOf('picker-open-stamp').length).toBe(1)
    refuse = false
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:exact')
    const now = flagKeys(persisted, 'A')
    expect(now.length).toBe(1)
    const v = valueOf(persisted, now[0]!)
    expect({ key: now[0] !== k1, e: v['e'], n: v['n'] }).toEqual({ key: true, e: JSON.parse(v1)['e'], n: JSON.parse(v1)['n'] })
  } finally {
    SL.__resetState()
  }
})

// ---------- T9: the keepalive reads the marks ----------

test('#551 T9 (D5): a close mark of another environment past the open makes the next tick withdraw it — no flag write, its own flag goes, said once', async () => {
  const persisted = new Map<string, unknown>()
  const flagSets: string[] = []
  try {
    const clock: Clock = { now: 5000, arms: [] }
    await openIn('A', persisted, clock, { onSet: (k) => { if (k.startsWith(STORE_OPEN) || k.startsWith(NS_OPEN)) flagSets.push(k) } })
    const own = flagKeys(persisted, 'A')
    expect(own.length).toBe(1)
    persisted.set(markKeyFor('A', 99, 0, 1), { session: 'A', e: 99, n: 0, at: 5000 })
    flagSets.length = 0
    clock.now += HOUR
    liveArms(clock)[0]!.fn()
    await drainLong()
    expect({ sets: flagSets, own: own.filter((k) => persisted.has(k)) }).toEqual({ sets: [], own: [] })
    expect(diagOf('picker-open-withdrawn').length).toBe(1)
  } finally {
    SL.__resetState()
  }
})

// ---------- T10: freshness ----------

test('#551 T10 (D5): a flag restores while −CLOCK_SKEW ≤ now − at < FLAG_TTL — one at the edge outside is not restored and is deleted, at the restore and at the prune of an open', async () => {
  const NOW = 10 * DAY
  const arms: Array<[number, boolean]> = [
    [NOW - (FLAG_TTL - 1), true],
    [NOW - FLAG_TTL, false],
    [NOW + CLOCK_SKEW, true],
    [NOW + CLOCK_SKEW + 1, false],
  ]
  try {
    for (const [at, restores] of arms) {
      const persisted = new Map<string, unknown>()
      const key = flagKeyFor('A', 'f', 1)
      persisted.set(key, flagValue('A', 'f', 1, 0, at))
      await restoreIn('A', storeOf(persisted), { now: NOW, arms: [] })
      expect({ at: at - NOW, open: snap()['pickerOpen'] }).toEqual({ at: at - NOW, open: restores })
      if (!restores) expect({ at: at - NOW, kept: persisted.has(key) }).toEqual({ at: at - NOW, kept: false })
    }
    // the prune of an open in B: the restore there ran while both flags of A were fresh
    const persisted = new Map<string, unknown>()
    const stale = flagKeyFor('A', 'stale', 1)
    const fresh = flagKeyFor('A', 'fresh', 2)
    persisted.set(stale, flagValue('A', 'stale', 1, 0, NOW - FLAG_TTL))
    persisted.set(fresh, flagValue('A', 'fresh', 1, 1, NOW - FLAG_TTL + 1))
    const clock: Clock = { now: NOW - FLAG_TTL + 2, arms: [] }
    const { h, $ } = await openIn('B', persisted, clock)
    expect({ stale: persisted.has(stale), fresh: persisted.has(fresh) }).toEqual({ stale: true, fresh: true })
    await SL.closeKeepDraft($)
    clock.now = NOW
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect({ stale: persisted.has(stale), fresh: persisted.has(fresh) }).toEqual({ stale: false, fresh: true })
  } finally {
    SL.__resetState()
  }
})

// ---------- T11: the explicit open reads its session's marks ----------

test('#551 T11 (D4, D6): an open after a close mark another environment wrote past this environment\'s epoch is ordered past it — the reload opens the panel', async () => {
  const persisted = new Map<string, unknown>()
  try {
    const clock: Clock = { now: 5000, arms: [] }
    const { h, $ } = await openIn('A', persisted, clock)
    await SL.closeKeepDraft($)
    await drainLong()
    persisted.set(markKeyFor('A', 50, 0, 7), { session: 'A', e: 50, n: 0, at: 5000 })
    await command(h, $)
    await drainLong()
    expect(snap()['pickerOpen']).toBe(true)
    await restoreIn('A', storeOf(persisted), { now: 5000, arms: [] })
    expect(snap()['pickerOpen']).toBe(true)
  } finally {
    SL.__resetState()
  }
})

// ---------- T12: the epoch records ----------

test('#551 T12 (D6): the bootstrap publishes its epoch under a key of its own; the lower records go by their keys and the greatest stays; a valid epoch written between the read and the delete of a damaged one stays', async () => {
  try {
    const persisted = new Map<string, unknown>()
    if (V3) {
      persisted.set(epochKeyFor(1), { e: 2, at: 5000 })
      persisted.set(epochKeyFor(2), { e: 5, at: 5000 })
    } else {
      persisted.set(STORE_EPOCH, { e: 5, at: 5000 })
    }
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    await drainLong()
    expect(epochs(persisted)).toEqual([6])
    // the prune of this environment's open: below the greatest by exact key, the greatest of every writer stays
    persisted.set(epochKeyFor(3), { e: 1, at: 5000 })
    persisted.set(epochKeyFor(4), { e: 6, at: 5000 })
    await command(h, $)
    await drainLong()
    expect(epochs(persisted)).toEqual([6, 6])
    // the damaged record and the valid one that lands under the other writer's next key
    const p2 = new Map<string, unknown>()
    const damaged = epochKeyFor(1)
    p2.set(damaged, { e: 'x', at: 5000 })
    const valid = V3 ? epochKeyFor(2) : damaged
    let injected = false
    const store = interleaved(storeOf(p2), (call, key) => {
      if (call === 'delete' && key === damaged && !injected) {
        injected = true
        p2.set(valid, { e: 7, at: 5000 })
      }
    })
    await restoreIn('A', store)
    expect({ injected, valid: p2.get(valid) }).toEqual({ injected: true, valid: { e: 7, at: 5000 } })
  } finally {
    SL.__resetState()
  }
})

// ---------- T13: damage ----------

test('#551 T13 (D7, #561): a damaged record of this version, however young, is deleted at its read and said once; a damaged close mark of the previous form (n = 1.5) stays and is not counted', async () => {
  const persisted = new Map<string, unknown>()
  const damaged = v3Key(NS_OPEN, 'A', EXT_WRITER, 1)
  const v2 = STORE_OPEN_CLOSED_V2 + ':A:1:1.5'
  persisted.set(damaged, { session: 'A', openId: 'd', e: -1, n: 0, at: 5000 })
  persisted.set(v2, { session: 'A', e: 1, n: 1.5, at: 5000 })
  persisted.set(v3Key(NS_OPEN, 'A', EXT_WRITER, 2), { session: 'A', openId: 'ok', e: 1, n: 0, at: 5000 })
  try {
    await restoreIn('A', storeOf(persisted))
    expect({ damaged: persisted.has(damaged), v2: persisted.has(v2), open: snap()['pickerOpen'] }).toEqual({ damaged: false, v2: true, open: true })
    expect(diagOf('store-damage').filter((t) => t.startsWith(damaged)).length).toBe(1)
  } finally {
    SL.__resetState()
  }
})

// ---------- T14: the previous version's records are read only ----------

test('#551 T14 (D8): with records of the previous version in the store a full cycle sets none of their keys and deletes only those older than MARK_KEEP by their own age', async () => {
  const NOW = 20 * DAY
  const seeds: Array<[string, unknown, boolean]> = [
    [STORE_OPEN + ':old', { session: 'C', token: 'old', e: 0, n: 0, at: NOW - 8 * DAY }, false],
    [STORE_OPEN + ':young', { session: 'D', token: 'young', e: 0, n: 0, at: NOW - 5 * DAY }, true],
    [STORE_OPEN, { session: 'Z', token: 'tz' }, true],
    [STORE_OPEN_CLOSED + ':C', { t: NOW - 8 * DAY }, false],
    [STORE_OPEN_CLOSED_V2 + ':D:0:9', { session: 'D', e: 0, n: 9, at: NOW - 5 * DAY }, true],
    [STORE_EPOCH, { e: 3, at: NOW - 30 * DAY }, true],
    [STORE_DRAFT + ':C', { session: 'C', t: NOW - 8 * DAY, ...body([['ctx']]) }, false],
    [STORE_DRAFT + ':D', { session: 'D', t: NOW - 5 * DAY, ...body([['ctx']]) }, true],
    [STORE_DRAFT, { session: 'Z', ...body([['ver']]) }, true],
    [STORE_UNDO, [{ saveId: 'u1', fields: ['numUsd'], prev: { numUsd: 'exact' }, written: { numUsd: 'short' } }], true],
    [STORE_SAVING, { saveId: 'm1', fields: ['numUsd'], values: { numUsd: 'short' } }, true],
    [STORE_THEMES, { u1: { palette: 'mono' } }, true],
  ]
  const persisted = new Map<string, unknown>(seeds.map(([k, v]) => [k, v]))
  const written: string[] = []
  try {
    const clock: Clock = { now: NOW, arms: [] }
    const { h, $, store } = await openIn('A', persisted, clock, { onSet: (k) => written.push(k) })
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
    await SL.closeKeepDraft($)
    await command(h, $)
    await drainLong()
    await SL.closeKeepDraft($)
    await drainLong()
    const seeded = new Set(seeds.map(([k]) => k))
    expect(written.filter((k) => seeded.has(k) || k.startsWith('sess:'))).toEqual([])
    expect(seeds.map(([k, , kept]) => [k, persisted.has(k)])).toEqual(seeds.map(([k, , kept]) => [k, kept]))
  } finally {
    SL.__resetState()
  }
})

// ---------- T15: a draft published between the prune's read and its delete ----------

test('#551 T15 (D2): a draft another environment publishes between the prune\'s read of an old draft of its session and the delete stays', async () => {
  const NOW = 20 * DAY
  const persisted = new Map<string, unknown>()
  const old = draftKeyFor('C', 1)
  persisted.set(old, { session: 'C', t: NOW - 8 * DAY, ...body([['ctx']]) })
  const fresh = V3 ? draftKeyFor('C', 2) : old
  let injected = false
  const clock: Clock = { now: NOW, arms: [] }
  try {
    const h = boot()
    const store = interleaved(storeOf(persisted), (call, key) => {
      if (call === 'delete' && key === old && !injected) {
        injected = true
        persisted.set(fresh, { session: 'C', t: NOW, ...body([['ver']]) })
      }
    })
    const $ = standOf(async () => 'A', store, clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect({ injected, lines: (draftOf(persisted, 'C')?.['lines'] as Array<Array<{ id: string }>> | undefined)?.[0]?.[0]?.id }).toEqual({ injected: true, lines: 'ver' })
  } finally {
    SL.__resetState()
  }
})

// ---------- T16: a snapshot published between pruneStore's read and its delete ----------

const SNAP = (sum: number, seq: number, session: string): Record<string, unknown> => ({
  sum: { total: sum, in: sum, out: 0, cache: 0 },
  seenTurns: [],
  tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, byName: [], done: [] },
  agents: { map: [], done: [] },
  started: true, resumed: false, resumedDecided: true, mainTurns: 0,
  seq, origin: 'ffffffffffffffff', n: 0, session,
})
const eventInput = (event: string, data: unknown, now = 0): void => SL.__feed({ source: { kind: 'event', event } as Source, ok: true, data, now })
const tokens = (turnId: string, n: number) => ({ turnId, usage: { input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
void FAMILIES

test('#551 T16 (D2): a snapshot another environment publishes between the read and the delete of the session prune stays', async () => {
  const persisted = new Map<string, unknown>()
  for (let i = 0; i < 33; i++) persisted.set(sessKeyFor('S' + String(i), 1), SNAP(i, 1000 + i, 'S' + String(i)))
  const victim = sessKeyFor('S0', 1)
  const newer = V3 ? sessKeyFor('S0', 2) : victim
  let injected = false
  try {
    const h = boot()
    const store = interleaved(storeOf(persisted), (call, key) => {
      if (call === 'delete' && key === victim && !injected) {
        injected = true
        persisted.set(newer, SNAP(777, 10 ** 12, 'S0'))
      }
    })
    const $ = standOf(async () => 'A', store, { now: 61000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    await drainLong()
    eventInput('turn.complete', tokens('t1', 5), 61000)
    await h['session.end']!($ as never, {} as never, async () => ({}))
    await drainLong()
    expect(sessValue(persisted, 'A')?.['sum']?.total).toBe(5)
    expect({ injected, s0: sessValue(persisted, 'S0')?.['sum']?.total }).toEqual({ injected: true, s0: 777 })
  } finally {
    SL.__resetState()
  }
})

// ---------- T17: an undo revision published between the read and the delete ----------

test('#551 T17 (D2): a revision of a save that goes on past a reload, landing between the read and the delete of the restore\'s trim or of an undo, stays under its own key', async () => {
  const saveKey = (seq: number): string => (V3 ? v3Key(NS_SAVING, undefined, EXT_WRITER, seq) : STORE_SAVING + ':S1')
  const undoKey = (id: string, seq: number): string => (V3 ? v3Key(NS_UNDO, undefined, EXT_WRITER, seq) : STORE_UNDO + ':' + id)
  const rev = (id: string, fields: string[], at: number): Record<string, unknown> => ({ saveId: id, t: 100, at, fields, prev: Object.fromEntries(fields.map((f) => [f, f === 'numTokens' ? 'compact' : 'exact'])), written: Object.fromEntries(fields.map((f) => [f, f === 'numTokens' ? 'raw' : 'short'])) })
  try {
    // the restore's trim of save S1: numTokens landed, numUsd did not
    const persisted = new Map<string, unknown>()
    persisted.set(saveKey(1), { saveId: 'S1', t: 100, fields: ['numTokens', 'numUsd'], values: { numTokens: 'raw', numUsd: 'short' } })
    const read = undoKey('S1', 2)
    persisted.set(read, rev('S1', ['numTokens', 'numUsd'], 100))
    const tail = V3 ? undoKey('S1', 3) : read
    const tailValue = rev('S1', ['numTokens'], 101)
    let injected = false
    const store = interleaved(storeOf(persisted), (call, key) => {
      if ((call === 'delete' || call === 'set') && key === read && !injected) {
        injected = true
        persisted.set(tail, tailValue)
      }
    })
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', store), { numTokens: 'raw' } as never)
    await drainLong()
    expect({ injected, tail: persisted.get(tail) }).toEqual({ injected: true, tail: tailValue })
    // the undo of save S2: a full revert deletes the revisions it read
    const p2 = new Map<string, unknown>()
    const read2 = undoKey('S2', 1)
    p2.set(read2, rev('S2', ['numUsd'], 200))
    const tail2 = V3 ? undoKey('S2', 2) : read2
    const tail2Value = rev('S2', ['numUsd'], 201)
    let injected2 = false
    const store2 = interleaved(storeOf(p2), (call, key) => {
      if ((call === 'delete' || call === 'set') && key === read2 && !injected2) {
        injected2 = true
        p2.set(tail2, tail2Value)
      }
    })
    const values = new Map<string, unknown>([[ROW('numUsd'), 'short']])
    boot()
    const $ = standOf(async () => 'A', store2, { now: 5000, arms: [] }, configOf(values))
    await pressOn(treeOf('numbers', store2, $), 'undo')
    expect({ reverted: values.get(ROW('numUsd')), injected2, tail: p2.get(tail2) }).toEqual({ reverted: 'exact', injected2: true, tail: tail2Value })
  } finally {
    SL.__resetState()
  }
})

// ---------- T18: every key within 256 ----------

test('#551 T18 (D9): with a session id of 300 characters and a theme name of 230 every key written is within 256 — the draft, the close mark, the snapshot and the theme are stored', async () => {
  const S = 's'.repeat(300)
  const NAME = 'n'.repeat(230)
  const LEGACY = 'l'.repeat(230)
  const persisted = new Map<string, unknown>([[STORE_THEMES, { [LEGACY]: { palette: 'mono' } }]])
  const written: string[] = []
  try {
    const clock: Clock = { now: 61000, arms: [] }
    const { h, $, store } = await openIn(S, persisted, clock, { maxKey: 256, onSet: (k) => written.push(k) })
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
    eventInput('turn.complete', tokens('t1', 5), 61000)
    await h['session.end']!($ as never, {} as never, async () => ({}))
    await drainLong()
    await SL.__saveTheme($, NAME)
    await SL.closeKeepDraft($)
    await drainLong()
    expect(written.filter((k) => k.length > 256)).toEqual([])
    expect({
      draft: draftOf(persisted, S) !== undefined,
      mark: markKeys(persisted, S).length > 0,
      snapshot: sessKeys(persisted, S).length > 0,
      theme: themeRecords(persisted).some((t) => t.name === NAME),
      legacy: themeRecords(persisted).some((t) => t.name === LEGACY),
      themesRead: diagOf('themes-read').length,
    }).toEqual({ draft: true, mark: true, snapshot: true, theme: true, legacy: true, themesRead: 0 })
  } finally {
    SL.__resetState()
  }
})

// ---------- T19: a close mark that lands late is published again ----------

test('#551 T19 (D5): a close mark whose write resolves past its stamp + CLOCK_SKEW is published again with its order and a fresh at — the earlier goes after the later landed; refused, the first stays and is said once; no shift, one write', async () => {
  for (const arm of ['a', 'b', 'c', 'd'] as const) {
    const persisted = new Map<string, unknown>()
    const markSets: Array<{ key: string; e: unknown; n: unknown; at: unknown; resolvedAt: number }> = []
    const clock: Clock = { now: 5000, arms: [] }
    let $ref: any = null
    let armed = false
    let shifts = arm === 'a' || arm === 'b' ? 1 : arm === 'd' ? 2 : 0
    const isMark = (k: string): boolean => k.startsWith(STORE_OPEN_CLOSED) || k.startsWith(STORE_OPEN_CLOSED_V2) || k.startsWith(NS_MARK)
    try {
      const store = storeOf(persisted, {
        refuseSet: (k) => arm === 'b' && armed && isMark(k) && markSets.length === 1,
        holdSet: (k) => {
          if (!armed || !isMark(k) || shifts === 0) return undefined
          shifts--
          clock.now += CLOCK_SKEW + 1
          return SL.__pictureReadClock($ref).then(() => undefined)
        },
        onSet: (k, v) => {
          if (armed && isMark(k)) markSets.push({ key: k, e: (v as any).e, n: (v as any).n, at: (v as any).at, resolvedAt: clock.now })
        },
      })
      const h = boot()
      const $ = standOf(async () => 'A', store, clock)
      $ref = $
      await SL.__pictureReadClock($)
      await command(h, $)
      await drainLong()
      armed = true
      await SL.closeKeepDraft($)
      await drainLong()
      const left = markKeys(persisted, 'A')
      if (arm === 'c') {
        expect({ arm, sets: markSets.length, left: left.length }).toEqual({ arm, sets: 1, left: 1 })
      } else if (arm === 'a') {
        expect({ arm, sets: markSets.length, sameOrder: markSets[0]?.e === markSets[1]?.e && markSets[0]?.n === markSets[1]?.n, fresh: (markSets[1]?.at as number) >= markSets[0]!.resolvedAt, left }).toEqual({ arm, sets: 2, sameOrder: true, fresh: true, left: [markSets[1]?.key] })
      } else if (arm === 'b') {
        expect({ arm, sets: markSets.length, left, said: diagOf('picker-close-mark-late').length }).toEqual({ arm, sets: 1, left: [markSets[0]?.key], said: 1 })
      } else {
        expect({ arm, sets: markSets.length, sameOrder: new Set(markSets.map((m) => String(m.e) + ':' + String(m.n))).size, left }).toEqual({ arm, sets: 3, sameOrder: 1, left: [markSets[2]?.key] })
      }
    } finally {
      SL.__resetState()
    }
  }
})

// ---------- T20: a mark is held while it closes a restorable flag ----------

test('#551 T20 (D5, D8): the prune of an open in B keeps an old close mark of A while the same listing holds a restorable flag of A it closes, unless a greater mark of A is listed; restore A keeps the panel closed', async () => {
  const NOW = 30 * DAY
  const OLD = NOW - 8 * DAY
  type Arm = { name: string; seeds: Array<[string, unknown]>; mark: string; kept: boolean; lower?: string }
  const flagV1 = (e: number, n: number, at: number): [string, unknown] => [STORE_OPEN + ':t', { session: 'A', token: 't', e, n, at }]
  const armsOf: Arm[] = [
    { name: 'a', seeds: [flagV1(1, 0, NOW - HOUR), [STORE_OPEN_CLOSED_V2 + ':A:1:0', { session: 'A', e: 1, n: 0, at: OLD }]], mark: STORE_OPEN_CLOSED_V2 + ':A:1:0', kept: true },
    { name: 'b', seeds: [flagV1(0, 1, NOW - HOUR), [STORE_OPEN_CLOSED + ':A', { t: OLD }]], mark: STORE_OPEN_CLOSED + ':A', kept: true },
    { name: 'c', seeds: [flagV1(1, 0, NOW - HOUR), [v3Key(NS_MARK, 'A', EXT_WRITER, 1), { session: 'A', e: 1, n: 0, at: OLD }]], mark: v3Key(NS_MARK, 'A', EXT_WRITER, 1), kept: true },
    { name: 'd', seeds: [[STORE_OPEN_CLOSED_V2 + ':A:1:0', { session: 'A', e: 1, n: 0, at: OLD }]], mark: STORE_OPEN_CLOSED_V2 + ':A:1:0', kept: false },
    { name: 'e', seeds: [flagV1(1, 0, NOW - FLAG_TTL), [STORE_OPEN_CLOSED_V2 + ':A:1:0', { session: 'A', e: 1, n: 0, at: OLD }]], mark: STORE_OPEN_CLOSED_V2 + ':A:1:0', kept: false },
    { name: 'f', seeds: [flagV1(2, 0, NOW - HOUR), [STORE_OPEN_CLOSED_V2 + ':A:1:0', { session: 'A', e: 1, n: 0, at: OLD }]], mark: STORE_OPEN_CLOSED_V2 + ':A:1:0', kept: false },
    { name: 'g', seeds: [flagV1(1, 0, NOW - HOUR), [STORE_OPEN_CLOSED_V2 + ':A:1:0', { session: 'A', e: 1, n: 0, at: OLD }], [STORE_OPEN_CLOSED_V2 + ':A:2:0', { session: 'A', e: 2, n: 0, at: OLD }]], mark: STORE_OPEN_CLOSED_V2 + ':A:2:0', kept: true, lower: STORE_OPEN_CLOSED_V2 + ':A:1:0' },
  ]
  try {
    for (const arm of armsOf) {
      const persisted = new Map<string, unknown>(arm.seeds)
      await openIn('B', persisted, { now: NOW, arms: [] })
      const after = { arm: arm.name, mark: persisted.has(arm.mark), lower: arm.lower === undefined ? null : persisted.has(arm.lower) }
      expect(after).toEqual({ arm: arm.name, mark: arm.kept, lower: arm.lower === undefined ? null : false })
      if (arm.kept) {
        await restoreIn('A', storeOf(persisted), { now: NOW, arms: [] })
        expect({ arm: arm.name, panelA: snap()['pickerOpen'] }).toEqual({ arm: arm.name, panelA: false })
      }
    }
  } finally {
    SL.__resetState()
  }
})

test('#551 T21 (AR-6): a generation switch while verify awaits listing or a foreign read permits no subsequent get', async () => {
  for (const boundary of ['keys', 'get'] as const) {
    const persisted = new Map<string, unknown>()
    const held = gate()
    let reached = false
    const reads: string[] = []
    try {
      boot()
      const store = storeOf(persisted)
      const $ = standOf(async () => 'A', store)
      await SL.restoreAfterReload($, {} as never)
      const first = v3Key(NS_SESS, 'A', EXT_WRITER, 1)
      const second = v3Key(NS_SESS, 'A', EXT_WRITER, 2)
      persisted.set(first, SNAP(11, 6000000, 'A'))
      persisted.set(second, SNAP(22, 6000001, 'A'))
      persisted.set('sess:A', SNAP(33, 6000002, 'A'))
      const keys = store.keys
      const get = store.get
      store.keys = async () => {
        const listed = await keys()
        if (boundary === 'keys') { reached = true; await held.p }
        return listed
      }
      store.get = async (key) => {
        reads.push(key)
        const value = await get(key)
        if (boundary === 'get' && key === first) { reached = true; await held.p }
        return value
      }
      const refreshing = SL.__refresh($)
      await drainLong()
      expect({ boundary, reached, reads }).toEqual({ boundary, reached: true, reads: boundary === 'keys' ? [] : [first] })
      boot()
      held.open()
      await refreshing
      await drainLong()
      expect({ boundary, reads, learned: SL.__sessQueue().landed }).toEqual({ boundary, reads: boundary === 'keys' ? [] : [first], learned: [] })
    } finally {
      held.open()
      SL.__resetState()
    }
  }
})

test('#551 T22 (AR-8): retiring an adopted v1 source and closing the replacement leaves one physical mark', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN, { session: 'A', t: 5000 }],
    [STORE_DRAFT + ':A', { session: 'A', t: 5000, ...body([['model']]) }],
  ])
  const writes: Array<{ key: string; order: string }> = []
  try {
    const h = boot()
    const store = storeOf(persisted, { onSet: (key, value) => {
      if (key.startsWith(NS_MARK)) writes.push({ key, order: String((value as any).e) + ':' + String((value as any).n) })
    } })
    const $ = standOf(async () => 'A', store)
    await command(h, $)
    await drainLong()
    expect(writes).toHaveLength(1)
    expect(writes[0]!.order).toBe('0:0')
    expect(markKeys(persisted, 'A')).toEqual([writes[0]!.key])
    await SL.closeKeepDraft($)
    await drainLong()
    expect(writes).toHaveLength(2)
    expect(markKeys(persisted, 'A')).toEqual([writes[1]!.key])
    expect(persisted.has(STORE_OPEN)).toBe(true)
    await restoreIn('A', store)
    expect(snap()['pickerOpen']).toBe(false)
  } finally { SL.__resetState() }
})

test('#551 T23 (AR-10): verify neither learns nor removes a malformed bare v1 snapshot and does not diagnose its shape', async () => {
  const persisted = new Map<string, unknown>()
  try {
    boot()
    const store = storeOf(persisted)
    const $ = standOf(async () => 'A', store)
    await SL.restoreAfterReload($, {} as never)
    const malformed = SNAP(999, 6000000, 'A')
    malformed['agents'] = { map: [['bad', { name: 'reader', desc: 17, model: 'm', status: 'running', at: 0, doneAt: 0 }]], done: [] }
    persisted.set('sess:A', malformed)
    let reads = 0
    const get = store.get
    store.get = async (key) => { if (key === 'sess:A') reads++; return get(key) }
    await SL.__refresh($)
    await drainLong()
    expect(reads).toBe(1)
    expect(SL.__sessQueue().landed).toEqual([])
    expect(persisted.get('sess:A')).toBe(malformed)
    expect(diagOf('session-snapshot-shape')).toEqual([])
    const base = (snap()['famStates'] as Array<[unknown, any]>).find(([family]) => family === FAMILIES[0])![1]
    expect(base.sum).toBeNull()
  } finally { SL.__resetState() }
})

test('#551 T24 (AR-11): restore rejects a malformed positive v1 order and verify can learn a later valid lower order', async () => {
  const malformed = SNAP(999, 6000000, 'A')
  malformed['agents'] = { map: [['bad', { name: 'reader', desc: 17, model: 'm', status: 'running', at: 0, doneAt: 0 }]], done: [] }
  const persisted = new Map<string, unknown>([['sess:A', malformed]])
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted))
    await SL.restoreAfterReload($, {} as never)
    expect(SL.__sessQueue().landed).toEqual([])
    expect(diagOf('session-snapshot-shape')).toHaveLength(1)
    expect(persisted.get('sess:A')).toBe(malformed)
    persisted.set('sess:A', SNAP(55, 5500000, 'A'))
    await SL.__refresh($)
    await drainLong()
    expect(SL.__sessQueue().landed).toEqual([['sess:A', 5500000]])
    expect(diagOf('session-snapshot-shape')).toHaveLength(1)
  } finally { SL.__resetState() }
})

test('#551 T25 (AR-6 stale-close): a refused adoption copy leaves its source intact when the old close resumes', async () => {
  const persisted = new Map<string, unknown>()
  const held = gate()
  let closingPhase = false
  let adoptionPhase = false
  let reached = false
  let refusedCopies = 0
  try {
    const { $, store } = await openIn('A', persisted, { now: 5000, arms: [] }, {
      refuseSet: (key) => {
        if (adoptionPhase && key.startsWith(NS_OPEN)) { refusedCopies++; return true }
        return closingPhase && key.startsWith(NS_MARK)
      },
      holdSet: (key) => {
        if (closingPhase && !reached && key.startsWith(NS_DRAFT)) { reached = true; return held.p }
        return undefined
      },
    })
    const source = flagKeys(persisted, 'A')[0]!
    const sourceValue = persisted.get(source)
    closingPhase = true
    const closing = SL.closeKeepDraft($)
    await drainLong()
    expect(reached).toBe(true)
    SL.register((() => undefined) as never, {} as never)
    adoptionPhase = true
    await SL.restoreAfterReload($, {} as never)
    expect(refusedCopies).toBe(1)
    expect(snap()['pickerOpen']).toBe(true)
    expect(persisted.get(source)).toBe(sourceValue)
    held.open()
    await closing
    await drainLong()
    expect(persisted.get(source)).toBe(sourceValue)
    expect(flagKeys(persisted, 'A')).toEqual([source])
    expect(snap()['pickerOpen']).toBe(true)
    void store
  } finally { held.open(); SL.__resetState() }
})

test('#551 T26 (AR-6 digest): an open whose value session differs from its key digest is deleted as damage', async () => {
  const key = v3Key(NS_OPEN, 'A', EXT_WRITER, 1)
  const persisted = new Map<string, unknown>([[key, { session: 'B', openId: 'foreign', e: 1, n: 0, at: 5000 }]])
  try {
    await restoreIn('A', storeOf(persisted))
    expect(persisted.has(key)).toBe(false)
    expect(diagOf('store-damage').filter((text) => text.includes(key) && text.includes('дайджестом'))).toHaveLength(1)
    expect(snap()['pickerOpen']).toBe(false)
  } finally { SL.__resetState() }
})

test('#551 T27 (AR-6 counter): a reopen with refused mark reads still takes an order after its own close', async () => {
  const persisted = new Map<string, unknown>()
  try {
    const { h, $, store } = await openIn('A', persisted, { now: 5000, arms: [] })
    await SL.closeKeepDraft($)
    const mark = valueOf(persisted, markKeys(persisted, 'A')[0]!)
    const get = store.get
    let refusals = 0
    store.get = async (key) => {
      if (key.startsWith(NS_MARK)) { refusals++; throw new Error('mark read refused') }
      return get(key)
    }
    await command(h, $)
    await drainLong()
    expect(refusals).toBeGreaterThan(0)
    expect(diagOf('picker-open-marks-read')).toHaveLength(1)
    const flags = flagKeys(persisted, 'A')
    expect(flags).toHaveLength(1)
    const flag = valueOf(persisted, flags[0]!)
    expect(flag.e > mark.e || (flag.e === mark.e && flag.n > mark.n)).toBe(true)
    store.get = get
    await restoreIn('A', store)
    expect(snap()['pickerOpen']).toBe(true)
  } finally { SL.__resetState() }
})

test('#551 T28 (AR-6 draft): reading two v3 drafts deletes only the older exact key', async () => {
  const older = v3Key(NS_DRAFT, 'A', EXT_WRITER, 1)
  const newest = v3Key(NS_DRAFT, 'A', EXT_WRITER, 2)
  const latest = { session: 'A', t: 2000, ...body([['ver']]) }
  const persisted = new Map<string, unknown>([
    [v3Key(NS_OPEN, 'A', EXT_WRITER, 3), { session: 'A', openId: 'foreign', e: 1, n: 0, at: 5000 }],
    [older, { session: 'A', t: 1000, ...body([['model']]) }],
    [newest, latest],
  ])
  try {
    await restoreIn('A', storeOf(persisted))
    expect({ older: persisted.has(older), newest: persisted.get(newest) }).toEqual({ older: false, newest: latest })
    expect(snap()['draft'].lines[0][0].id).toBe('ver')
  } finally { SL.__resetState() }
})

test('#551 T29 (AR-6 save-restore): restoring two save marks deletes the superseded mark and retains the unfinished newest', async () => {
  const older = v3Key(NS_SAVING, undefined, EXT_WRITER, 1)
  const newest = v3Key(NS_SAVING, undefined, EXT_WRITER, 2)
  const latest = { saveId: 'newest', t: 2000, fields: ['numTokens'], values: { numTokens: 'raw' } }
  const persisted = new Map<string, unknown>([
    [older, { saveId: 'older', t: 1000, fields: ['numUsd'], values: { numUsd: 'short' } }],
    [newest, latest],
  ])
  try {
    await restoreIn('A', storeOf(persisted))
    expect({ older: persisted.has(older), newest: persisted.get(newest) }).toEqual({ older: false, newest: latest })
    expect(snap()['saving']).toEqual({ fields: ['numTokens'], values: { numTokens: 'raw' } })
    expect(diagOf('save-unwritten')).toHaveLength(1)
  } finally { SL.__resetState() }
})

test('#551 T30 (AR-6 save-end): a completed save removes its own physical save mark', async () => {
  const persisted = new Map<string, unknown>()
  const values = new Map<string, unknown>()
  const marks: string[] = []
  try {
    const { $, store } = await openIn('A', persisted, { now: 5000, arms: [] }, {
      onSet: (key) => { if (key.startsWith(NS_SAVING)) marks.push(key) },
    }, configOf(values))
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
    await pressOn(treeOf('numbers', store, $), 'save')
    expect(values.get(ROW('numUsd'))).toBe('short')
    expect(marks).toHaveLength(1)
    expect(persisted.has(marks[0]!)).toBe(false)
    expect(v3Keys(persisted, NS_SAVING)).toEqual([])
  } finally { SL.__resetState() }
})

test('#551 T31 (AR-6 source-GC): listed legacy sources keep their matching done record and undo tombstone', async () => {
  const markSource = STORE_SAVING + ':legacy-mark'
  const undoSource = STORE_UNDO + ':legacy-undo'
  const done = v3Key(NS_SAVING, undefined, EXT_WRITER, 1)
  const tomb = v3Key(NS_UNDO, undefined, EXT_WRITER, 2)
  const persisted = new Map<string, unknown>([
    [markSource, { t: 100, fields: ['numUsd'], values: { numUsd: 'short' } }],
    [done, { src: markSource, done: true, t: 5000, srcSaveId: 'legacy-mark', srcT: 100 }],
    [undoSource, { t: 100, fields: ['numUsd'], prev: { numUsd: 'exact' }, written: { numUsd: 'short' } }],
    [tomb, { saveId: 'legacy-undo', t: 100, at: 5000, src: undoSource, fields: [], prev: {}, written: {} }],
    [v3Key(NS_SAVING, undefined, EXT_WRITER, 3), { saveId: 'active', t: 2000, fields: ['numTokens'], values: { numTokens: 'raw' } }],
  ])
  try {
    const before = new Map(persisted)
    await restoreIn('A', storeOf(persisted))
    expect({ done: persisted.get(done), tomb: persisted.get(tomb) }).toEqual({ done: before.get(done), tomb: before.get(tomb) })
    expect(persisted.get(markSource)).toBe(before.get(markSource))
    expect(persisted.get(undoSource)).toBe(before.get(undoSource))
    expect(diagOf('store-damage')).toEqual([])
    expect(snap()['saving']).toEqual({ fields: ['numTokens'], values: { numTokens: 'raw' } })
  } finally { SL.__resetState() }
})

test('#551 T32 (AR-1): listed foreign clocks raise the next write with and without an own publication', async () => {
  for (const own of [false, true]) {
    const persisted = new Map<string, unknown>()
    try {
      const h = boot()
      const $ = standOf(async () => 'A', storeOf(persisted))
      await SL.restoreAfterReload($, {} as never)
      if (own) {
        eventInput('turn.complete', tokens('before', 2), 5000)
        await h['session.end']!($, {}, async () => ({}))
        await drainLong()
      }
      expect(sessKeys(persisted, 'A').length > 0).toBe(own)
      const foreignSeq = (5000 + 10 * 60000) * 1000
      persisted.set(v3Key(NS_SESS, 'A', EXT_WRITER, 1), SNAP(900, foreignSeq, 'A'))
      SL.__setNow(() => 20000)
      await SL.__refresh($)
      await drainLong()
      expect(SL.__sessQueue().landed).toEqual([['sess:A', foreignSeq]])
      expect(diagOf('session-snapshot-clock')).toEqual([])
      eventInput('turn.complete', tokens('after', 3), 5000)
      await h['session.end']!($, {}, async () => ({}))
      await drainLong()
      const latest = sessValue(persisted, 'A')!
      expect(latest['seq']).toBeGreaterThan(foreignSeq)
      expect(latest['sum'].total).toBe(own ? 5 : 3)
    } finally { SL.__resetState() }
  }
})

test('#551 T33 (AR-2): outside-window v3 and v1 lose to the own snapshot in verify and restore; prune takes only v3', async () => {
  const persisted = new Map<string, unknown>()
  const outside = v3Key(NS_SESS, 'A', EXT_WRITER, 1)
  const seq = (5000 + 25 * HOUR) * 1000
  const futureV1 = SNAP(999, seq + 1, 'A')
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted))
    await SL.restoreAfterReload($, {} as never)
    eventInput('turn.complete', tokens('own', 5), 5000)
    await h['session.end']!($, {}, async () => ({}))
    await drainLong()
    const ownSeq = sessValue(persisted, 'A')!['seq']
    persisted.set(outside, SNAP(888, seq, 'A'))
    persisted.set('sess:A', futureV1)
    SL.__setNow(() => 20000)
    await SL.__refresh($)
    await drainLong()
    expect(SL.__sessQueue().landed).toEqual([['sess:A', ownSeq]])
    expect(diagOf('session-snapshot-clock')).toHaveLength(1)
    await restoreIn('A', storeOf(persisted))
    const base = (snap()['famStates'] as Array<[unknown, any]>).find(([family]) => family === FAMILIES[0])![1]
    expect(base.sum.total).toBe(5)
    expect(SL.__sessQueue().landed).toEqual([['sess:A', ownSeq]])
    const hB = boot()
    const $B = standOf(async () => 'B', storeOf(persisted))
    await SL.restoreAfterReload($B, {} as never)
    eventInput('turn.complete', tokens('pruner', 1), 5000)
    await hB['session.end']!($B, {}, async () => ({}))
    await drainLong()
    expect(sessKeys(persisted, 'B')).toHaveLength(1)
    expect(persisted.has(outside)).toBe(false)
    expect(persisted.get('sess:A')).toBe(futureV1)
    expect(v3Keys(persisted, NS_SESS, 'A')).toHaveLength(1)
  } finally { SL.__resetState() }
})

test('#551 T34 (AR-3): a bootstrap before any explicit clock read stamps a restorable flag with the lagging engine clock', async () => {
  const persisted = new Map<string, unknown>()
  const clock: Clock = { now: 5000, arms: [] }
  try {
    expect(Date.now() - clock.now).toBeGreaterThan(CLOCK_SKEW)
    const h = boot()
    const store = storeOf(persisted)
    const $ = standOf(async () => 'A', store, clock)
    await command(h, $)
    await drainLong()
    const flags = flagKeys(persisted, 'A')
    expect(flags).toHaveLength(1)
    expect(valueOf(persisted, flags[0]!).at).toBe(clock.now)
    const epochKeys = v3Keys(persisted, NS_EPOCH)
    expect(epochKeys).toHaveLength(1)
    expect(valueOf(persisted, epochKeys[0]!).at).toBe(clock.now)
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', store, clock), {} as never)
    await drainLong()
    expect(snap()['pickerOpen']).toBe(true)
  } finally { SL.__resetState() }
})

test('#551 T35 (AR-4): a later bare save mark with a changed saveId or timestamp is visible and its obsolete done record is collected', async () => {
  for (const changed of ['saveId', 't'] as const) {
    const first = { saveId: 'first', t: 100, fields: ['numTokens'], values: { numTokens: 'raw' } }
    const persisted = new Map<string, unknown>([[STORE_SAVING, first]])
    try {
      boot()
      const $ = standOf(async () => 'A', storeOf(persisted))
      await SL.restoreAfterReload($, { numTokens: 'raw' } as never)
      const doneKeys = v3Keys(persisted, NS_SAVING)
      expect(doneKeys).toHaveLength(1)
      const done = doneKeys[0]!
      expect(persisted.get(done)).toEqual({ src: STORE_SAVING, done: true, t: valueOf(persisted, done).t, srcSaveId: 'first', srcT: 100 })
      boot()
      await SL.restoreAfterReload($, {} as never)
      expect(persisted.has(done)).toBe(true)
      expect(snap()['saving']).toBeNull()
      const later = { ...first, [changed]: changed === 'saveId' ? 'later' : 101 }
      persisted.set(STORE_SAVING, later)
      boot()
      await SL.restoreAfterReload($, {} as never)
      expect(snap()['saving']).toEqual({ fields: ['numTokens'], values: { numTokens: 'raw' } })
      expect(persisted.has(done)).toBe(false)
      expect(persisted.get(STORE_SAVING)).toBe(later)
      expect(diagOf('save-unwritten')).toHaveLength(1)
    } finally { SL.__resetState() }
  }
})

test('#551 T36 (AR-5): rebind closes each retained v1 source at its own order without closing a later foreign opening', async () => {
  for (const bare of [false, true]) for (const foreign of [false, true]) {
    const sourceKey = bare ? STORE_OPEN : STORE_OPEN + ':legacy'
    const order = bare ? { e: 0, n: 0 } : { e: 1, n: 7 }
    const source = bare ? { session: 'A', t: 5000 } : { session: 'A', token: 'legacy', ...order, at: 5000 }
    const persisted = new Map<string, unknown>([
      [sourceKey, source],
      [STORE_DRAFT + ':A', { session: 'A', t: 5000, ...body([['model']]) }],
    ])
    let session = 'A'
    try {
      boot()
      const store = storeOf(persisted)
      const $ = standOf(async () => session, store)
      await SL.restoreAfterReload($, {} as never)
      expect(snap()['pickerOpen']).toBe(true)
      if (foreign) persisted.set(v3Key(NS_OPEN, 'A', EXT_WRITER, 1), { session: 'A', openId: 'later-foreign', e: order.e, n: order.n + 1, at: 5000 })
      session = 'B'
      await SL.__refresh($)
      await drainLong()
      expect(snap()['pickerSession']).toBe('B')
      const marks = markKeys(persisted, 'A')
      expect(marks).toHaveLength(1)
      expect({ e: valueOf(persisted, marks[0]!).e, n: valueOf(persisted, marks[0]!).n }).toEqual(order)
      expect(persisted.get(sourceKey)).toBe(source)
      await restoreIn('A', store)
      expect({ bare, foreign, open: snap()['pickerOpen'] }).toEqual({ bare, foreign, open: foreign })
      if (foreign) expect(snap()['open'].openId).toBe('later-foreign')
    } finally { SL.__resetState() }
  }
})

test('#551 T37 (AR-2b clock): prune retains a future v3 before the first successful flags clock read and deletes it on the next pass', async () => {
  const persisted = new Map<string, unknown>()
  const outside = v3Key(NS_SESS, 'B', EXT_WRITER, 1)
  const clock = { now: Date.now(), arms: [] as Arm[] }
  persisted.set(outside, SNAP(888, (clock.now + 2 * DAY) * 1000, 'B'))
  let outsideReads = 0
  let clockReads = 0
  const store = storeOf(persisted)
  const get = store.get
  store.get = async (key) => {
    if (key === outside) outsideReads++
    return get(key)
  }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, clock)
    $.clock.now = async () => { clockReads++; throw new Error('flags clock not yet available') }
    await SL.restoreAfterReload($, {} as never)
    outsideReads = 0
    eventInput('turn.complete', tokens('before-clock', 5), clock.now)
    await h['session.end']!($, {}, async () => ({}))
    await drainLong()
    expect(clockReads > 0).toBe(true)
    expect(snap()['clockFailed']).toBe(true)
    expect(sessKeys(persisted, 'A')).toHaveLength(1)
    expect(outsideReads).toBe(1)
    expect(persisted.has(outside)).toBe(true)
    $.clock.now = async () => clock.now
    await SL.__pictureReadClock($)
    SL.__setNow(() => 20000)
    eventInput('turn.complete', tokens('after-clock', 3), clock.now)
    await h['session.end']!($, {}, async () => ({}))
    await drainLong()
    expect(outsideReads).toBe(2)
    expect(persisted.has(outside)).toBe(false)
    expect(sessKeys(persisted, 'A')).toHaveLength(1)
  } finally { SL.__resetState() }
})

test('#551 T38 (AR-2b kept): prune deletes the future v3 in the current protected group and retains its own in-window publication', async () => {
  const persisted = new Map<string, unknown>()
  const outside = v3Key(NS_SESS, 'A', EXT_WRITER, 1)
  const deletes: string[] = []
  const store = storeOf(persisted)
  const del = store.delete
  store.delete = async (key) => { deletes.push(key); await del(key) }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store)
    await SL.restoreAfterReload($, {} as never)
    persisted.set(outside, SNAP(888, (5000 + 25 * HOUR) * 1000, 'A'))
    eventInput('turn.complete', tokens('protected-own', 5), 5000)
    await h['session.end']!($, {}, async () => ({}))
    await drainLong()
    expect(deletes).toEqual([outside])
    expect(persisted.has(outside)).toBe(false)
    expect(sessKeys(persisted, 'A')).toHaveLength(1)
    expect(sessValue(persisted, 'A')!['sum']).toEqual({ total: 5, in: 5, out: 0, cache: 0 })
    expect(Number(sessValue(persisted, 'A')!['seq']) <= (5000 + DAY) * 1000).toBe(true)
  } finally { SL.__resetState() }
})

test('#551 T39 (AR-2b read-once): the over-capacity pass reads every v3 key exactly once and deletes each selected key once', async () => {
  const persisted = new Map<string, unknown>()
  const reads = new Map<string, number>()
  const deletes = new Map<string, number>()
  const store = storeOf(persisted)
  const get = store.get
  const del = store.delete
  store.get = async (key) => {
    if (key.startsWith(NS_SESS + '.')) reads.set(key, (reads.get(key) ?? 0) + 1)
    return get(key)
  }
  store.delete = async (key) => { deletes.set(key, (deletes.get(key) ?? 0) + 1); await del(key) }
  const normals = Array.from({ length: 33 }, (_, i) => v3Key(NS_SESS, 'B' + i, EXT_WRITER, 1))
  const outside = v3Key(NS_SESS, 'B0', EXT_WRITER, 2)
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store)
    await SL.restoreAfterReload($, {} as never)
    for (const [i, key] of normals.entries()) persisted.set(key, SNAP(i, i + 1, 'B' + i))
    persisted.set(outside, SNAP(888, (5000 + 25 * HOUR) * 1000, 'B0'))
    reads.clear()
    eventInput('turn.complete', tokens('capacity-own', 5), 5000)
    await h['session.end']!($, {}, async () => ({}))
    await drainLong()
    const own = sessKeys(persisted, 'A')
    expect(own).toHaveLength(1)
    expect(reads.size).toBe(35)
    for (const key of [...normals, outside, ...own]) expect({ key, reads: reads.get(key) }).toEqual({ key, reads: 1 })
    expect(persisted.has(outside)).toBe(false)
    expect(deletes.get(outside)).toBe(1)
    expect(persisted.has(normals[0]!)).toBe(false)
    expect(persisted.has(normals[1]!)).toBe(false)
    expect(persisted.has(normals[2]!)).toBe(true)
    expect(v3Keys(persisted, NS_SESS)).toHaveLength(32)
    for (const [key, count] of deletes) expect({ key, count }).toEqual({ key, count: 1 })
  } finally { SL.__resetState() }
})

test('#551 T40 (Q1): late marks reread the engine clock themselves; a refused reread stops with one named diagnosis', async () => {
  for (const refused of [false, true]) {
    const persisted = new Map<string, unknown>()
    const clock: Clock = { now: 5000, arms: [] }
    const sets: Array<{ key: string; e: unknown; n: unknown; at: number }> = []
    let armed = false
    try {
      const { $ } = await openIn('A', persisted, clock, {
        holdSet: (key) => {
          if (armed && key.startsWith(NS_MARK) && sets.length === 0) {
            clock.now += CLOCK_SKEW + 1
            return Promise.resolve()
          }
          return undefined
        },
        onSet: (key, v) => { if (armed && key.startsWith(NS_MARK)) sets.push({ key, e: (v as any).e, n: (v as any).n, at: (v as any).at }) },
      })
      const read = $.clock.now
      $.clock.now = async () => {
        if (refused && sets.length > 0) throw new Error('Q1 post-set clock refused')
        return read()
      }
      armed = true
      await SL.closeKeepDraft($)
      const left = markKeys(persisted, 'A')
      console.log('FIX2_LATE_CLOCK=' + JSON.stringify({ refused, sets: sets.length, fresh: sets[sets.length - 1]!.at === clock.now, left }))
      expect({ refused, sets: sets.length, left }).toEqual({ refused, sets: refused ? 1 : 2, left: [sets[sets.length - 1]!.key] })
      if (refused) {
        const said = diagOf('picker-close-mark-clock')
        expect(said).toHaveLength(1)
        expect(said[0]!.includes('A') && said[0]!.includes('Q1 post-set clock refused') && said[0]!.includes("refused('clock.now')")).toBe(true)
      } else {
        expect(sets[1]!.at).toBe(clock.now)
        expect({ e: sets[1]!.e, n: sets[1]!.n }).toEqual({ e: sets[0]!.e, n: sets[0]!.n })
        expect(persisted.has(sets[0]!.key)).toBe(false)
      }
    } finally { SL.__resetState() }
  }
})

test('#551 T41 (Q2): a delayed earlier clock reply in the same generation cannot replace the later applied clock or delete fresh B', async () => {
  const persisted = new Map<string, unknown>(), h = boot(), held = gate()
  const old = standOf(async () => 'A', storeOf(persisted))
  old.clock.now = async () => { await held.p; return 5000 }
  const pending = SL.__pictureReadClock(old)
  const clock: Clock = { now: 3 * DAY, arms: [] }
  let applied = 0
  const store = storeOf(persisted, { holdSet: (key) => {
    if (key.startsWith(NS_SESS)) { held.open(); return pending.then((ms) => { applied = ms }) }
    return undefined
  } })
  try {
    const $ = standOf(async () => 'A', store, clock)
    await SL.restoreAfterReload($, {} as never)
    const fresh = v3Key(NS_SESS, 'B', EXT_WRITER, 1)
    persisted.set(fresh, SNAP(1, clock.now * 1000, 'B'))
    eventInput('turn.complete', tokens('same-generation', 5), clock.now)
    await h['session.end']!($, {}, async () => ({})); await drainLong()
    console.log('FIX2_SAMEGEN_CLOCK=' + JSON.stringify({ applied, fresh: persisted.has(fresh) }))
    expect(applied).toBe(clock.now)
    expect(persisted.has(fresh)).toBe(true)
  } finally { held.open(); SL.__resetState() }
})

test('#551 T42 (Q3a): a refused pass clock allows damage cleanup only, preserves pruneAt and diagnoses once per generation', async () => {
  const persisted = new Map<string, unknown>(), h = boot(), store = storeOf(persisted)
  const foreign = Array.from({ length: 33 }, (_, i) => v3Key(NS_SESS, 'Q3a-' + i, EXT_WRITER, 1))
  const damaged = v3Key(NS_SESS, 'damage', EXT_WRITER, 1)
  const deleted: string[] = []
  const del = store.delete
  store.delete = async (key) => { deleted.push(key); await del(key) }
  try {
    const $ = standOf(async () => 'A', store)
    await SL.restoreAfterReload($, {} as never)
    foreign.forEach((key, i) => persisted.set(key, SNAP(i, (5000 + 25 * HOUR) * 1000, 'Q3a-' + i)))
    persisted.set(damaged, { session: 'damage', seq: 0 })
    $.clock.now = async () => { throw new Error('Q3a pass clock refused') }
    const before = snap()['pruneAt']
    for (let i = 0; i < 2; i++) {
      eventInput('turn.complete', tokens('refused-pass-' + i, 1), 5000)
      await h['session.end']!($, {}, async () => ({})); await drainLong()
      expect({ i, foreign: foreign.filter((key) => !persisted.has(key)), damaged: persisted.has(damaged), pruneAt: snap()['pruneAt'] }).toEqual({ i, foreign: [], damaged: false, pruneAt: before })
    }
    expect(deleted.filter((key) => foreign.includes(key) || key === damaged)).toEqual([damaged])
    expect(diagOf('store-damage').filter((text) => text.startsWith(damaged))).toHaveLength(1)
    expect(diagOf('prune-clock-unavailable')).toHaveLength(1)
  } finally { SL.__resetState() }
})

test('#551 T43 (Q3b): clock catchup during the pass does not change its outside-window verdict', async () => {
  const persisted = new Map<string, unknown>(), h = boot(), store = storeOf(persisted)
  const clock: Clock = { now: 5000, arms: [] }
  const outside = v3Key(NS_SESS, 'B', EXT_WRITER, 1)
  let caughtUp = false
  try {
    const $ = standOf(async () => 'A', store, clock)
    await SL.restoreAfterReload($, {} as never)
    persisted.set(outside, SNAP(888, (5000 + 25 * HOUR) * 1000, 'B'))
    const get = store.get
    store.get = async (key) => {
      const value = await get(key)
      if (key === outside) { clock.now += 2 * HOUR; await SL.__pictureReadClock($); caughtUp = true }
      return value
    }
    eventInput('turn.complete', tokens('catchup', 5), 5000)
    await h['session.end']!($, {}, async () => ({})); await drainLong()
    console.log('FIX2_CATCHUP=' + JSON.stringify({ caughtUp, old: persisted.has(outside), clock: clock.now }))
    expect({ caughtUp, present: persisted.has(outside) }).toEqual({ caughtUp: true, present: false })
  } finally { SL.__resetState() }
})

test('#551 T44 (Q3c): before any successful clock read, capacity never uses wall time to delete future groups', async () => {
  const persisted = new Map<string, unknown>(), h = boot(), store = storeOf(persisted)
  const clock: Clock = { now: Date.now(), arms: [] }
  const foreign = Array.from({ length: 33 }, (_, i) => v3Key(NS_SESS, 'Q3c-' + i, EXT_WRITER, 1))
  const deleted: string[] = []
  const del = store.delete
  store.delete = async (key) => { deleted.push(key); await del(key) }
  try {
    const $ = standOf(async () => 'A', store, clock)
    $.clock.now = async () => { throw new Error('Q3c no clock') }
    await SL.restoreAfterReload($, {} as never)
    foreign.forEach((key, i) => persisted.set(key, SNAP(i, (clock.now + 2 * DAY) * 1000, 'Q3c-' + i)))
    eventInput('turn.complete', tokens('no-clock-capacity', 5), clock.now)
    await h['session.end']!($, {}, async () => ({})); await drainLong()
    expect(deleted).toEqual([])
    expect(foreign.every((key) => persisted.has(key))).toBe(true)
  } finally { SL.__resetState() }
})

test('#551 T45 (Q4): damaged seq-zero v3 pre-read is removed by its exact key and diagnosed once with one read', async () => {
  const persisted = new Map<string, unknown>(), h = boot(), store = storeOf(persisted)
  const damaged = v3Key(NS_SESS, 'B', EXT_WRITER, 1)
  let reads = 0
  try {
    const $ = standOf(async () => 'A', store)
    await SL.restoreAfterReload($, {} as never)
    persisted.set(damaged, { session: 'B', seq: 0 })
    const get = store.get
    store.get = async (key) => { if (key === damaged) reads++; return get(key) }
    eventInput('turn.complete', tokens('damage-pre-read', 5), 5000)
    await h['session.end']!($, {}, async () => ({})); await drainLong()
    console.log('FIX2_DAMAGE=' + JSON.stringify({ reads, present: persisted.has(damaged), said: diagOf('store-damage').length }))
    expect({ reads, present: persisted.has(damaged), said: diagOf('store-damage').length }).toEqual({ reads: 1, present: false, said: 1 })
  } finally { SL.__resetState() }
})

test('#551 T46 (Q5): epoch wait prevents a second bootstrap while the first publication is held', async () => {
  const persisted = new Map<string, unknown>(), hold = gate()
  let entered = false
  const store = storeOf(persisted, { holdSet: (key) => {
    if (key.startsWith(NS_EPOCH) && !entered) { entered = true; return hold.p }
    return undefined
  } })
  try {
    boot(); const $ = standOf(async () => 'A', store)
    const first = SL.restoreAfterReload($, {} as never)
    await drainLong(); expect(entered).toBe(true)
    persisted.set(v3Key(NS_EPOCH, undefined, EXT_WRITER, 1), { e: 99, at: 5000 })
    SL.register((() => undefined) as never, {} as never)
    const second = SL.restoreAfterReload($, {} as never)
    await drainLong(); hold.open(); await first; await second; await drainLong()
    const values = v3Keys(persisted, NS_EPOCH).map((key) => valueOf(persisted, key).e).sort((a, b) => a - b)
    console.log('FIX2_EPOCH=' + JSON.stringify(values))
    expect(values).toEqual([1, 99])
  } finally { hold.open(); SL.__resetState() }
})

test('#551 T47 (Q6): a close stale after the no-draft await invalidates no dead-generation UI with empty retired', async () => {
  boot()
  try {
    const $ = standOf(async () => '', storeOf(new Map()))
    let invalidates = 0
    $.ui.invalidate = () => { invalidates++ }
    const closing = SL.closeKeepDraft($)
    await Promise.resolve(); await Promise.resolve()
    SL.register((() => undefined) as never, {} as never)
    await closing
    console.log('FIX2_EMPTY_CLOSE=' + JSON.stringify({ invalidates }))
    expect(invalidates).toBe(0)
  } finally { SL.__resetState() }
})

test('#551 T48 (Q9): saveMarks hides a legacy mark only by matching source key, saveId and source timestamp', async () => {
  for (const bare of [false, true]) for (const changed of ['saveId', 't', 'match'] as const) {
    const source = bare ? STORE_SAVING : STORE_SAVING + ':m1'
    const value = { saveId: 'm1', t: 5, fields: ['numTokens'], values: { numTokens: 'raw' } }
    const done = v3Key(NS_SAVING, undefined, EXT_WRITER, 1)
    const persisted = new Map<string, unknown>([
      [source, value],
      [done, { src: source, done: true, t: 9, srcSaveId: changed === 'saveId' ? 'other' : 'm1', srcT: changed === 't' ? 0 : 5 }],
    ])
    try {
      boot()
      expect({ bare, changed, marks: saveMarks(persisted).length }).toEqual({ bare, changed, marks: changed === 'match' ? 0 : 1 })
      await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
      expect(snap()['saving'] !== null).toBe(changed !== 'match')
    } finally { SL.__resetState() }
  }
})

test('#551 T49 (R2-7): done t minus one leaves the legacy mark visible in helper and module', async () => {
  for (const bare of [false, true]) {
    const source = bare ? STORE_SAVING : STORE_SAVING + ':m1'
    const persisted = new Map<string, unknown>([
      [source, { saveId: 'm1', t: 5, fields: ['numTokens'], values: { numTokens: 'raw' } }],
      [v3Key(NS_SAVING, undefined, EXT_WRITER, 1), { src: source, done: true, t: -1, srcSaveId: 'm1', srcT: 5 }],
    ])
    try {
      boot()
      const helper = saveMarks(persisted).length
      await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
      const module = snap()['saving'] !== null
      console.log('R2_7_MINUS_ONE=' + JSON.stringify({ bare, helper, module }))
      expect({ bare, helper, module }).toEqual({ bare, helper: 1, module: true })
    } finally { SL.__resetState() }
  }
})

test('#551 T50 (R2-7): done without t leaves the legacy mark visible in helper and module', async () => {
  for (const bare of [false, true]) {
    const source = bare ? STORE_SAVING : STORE_SAVING + ':m1'
    const persisted = new Map<string, unknown>([
      [source, { saveId: 'm1', t: 5, fields: ['numTokens'], values: { numTokens: 'raw' } }],
      [v3Key(NS_SAVING, undefined, EXT_WRITER, 1), { src: source, done: true, srcSaveId: 'm1', srcT: 5 }],
    ])
    try {
      boot()
      const helper = saveMarks(persisted).length
      await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
      const module = snap()['saving'] !== null
      console.log('R2_7_MISSING_T=' + JSON.stringify({ bare, helper, module }))
      expect({ bare, helper, module }).toEqual({ bare, helper: 1, module: true })
    } finally { SL.__resetState() }
  }
})

test('#551 T51 (R2-7): a keyed truthy nonobject is not a helper or module mark', async () => {
  const persisted = new Map<string, unknown>([[STORE_SAVING + ':m1', 'not an object']])
  try {
    boot()
    const helper = saveMarks(persisted).length
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    const module = snap()['saving'] !== null
    console.log('R2_7_KEYED_NONOBJECT=' + JSON.stringify({ helper, module }))
    expect({ helper, module }).toEqual({ helper: 0, module: false })
  } finally { SL.__resetState() }
})

const deadlineStand = ($: any, clock: Clock): void => {
  $.clock.after = (ms: number, fn: () => void) => {
    const arm: Arm = { ms, fn, cancelled: false }
    clock.arms.push(arm)
    return { cancel() { arm.cancelled = true } }
  }
}
const fireDeadlines = (clock: Clock): void => {
  clock.now += 15000
  for (const arm of clock.arms.filter((a) => !a.cancelled && a.ms === 15000)) arm.fn()
}
const publishTrigger = async (h: Handlers, $: any, id: string, at = 5000): Promise<void> => {
  eventInput('turn.complete', tokens(id, 5), at)
  await h['session.end']!($, {}, async () => ({}))
  await drainLong()
}

test('#551 T52 (R2-1): held prune clock admits one real pass, one read per foreign key and no duplicate deletes', async () => {
  const persisted = new Map<string, unknown>(), held = gate(), h = boot()
  const clock: Clock = { now: 5000, arms: [] }
  let wantsClock = false, pending = 0
  const store = storeOf(persisted, { onSet: key => { if (key.startsWith(NS_SESS)) wantsClock = true } })
  const $ = standOf(async () => 'A', store, clock)
  const foreign = Array.from({ length: 3 }, (_, i) => v3Key(NS_SESS, 'overlap-' + i, EXT_WRITER, 1))
  const reads = new Map<string, number>(), deletes = new Map<string, number>()
  try {
    await SL.restoreAfterReload($, {} as never)
    foreign.forEach((key, i) => persisted.set(key, SNAP(i + 1, (5000 + 25 * HOUR) * 1000, 'overlap-' + i)))
    const get = store.get, del = store.delete
    store.get = async key => { if (foreign.includes(key)) reads.set(key, (reads.get(key) ?? 0) + 1); return get(key) }
    store.delete = async key => { if (foreign.includes(key)) deletes.set(key, (deletes.get(key) ?? 0) + 1); await del(key) }
    $.clock.now = async () => { if (wantsClock) { wantsClock = false; pending++; await held.p }; return 5000 }
    await publishTrigger(h, $, 'overlap-1')
    await publishTrigger(h, $, 'overlap-2')
    held.open(); await drainLong()
    const result = { pending, reads: foreign.map(k => reads.get(k) ?? 0), deletes: foreign.map(k => deletes.get(k) ?? 0) }
    console.log('SOL_R2_CONCURRENT_PRUNE_REAL=' + JSON.stringify(result))
    console.log('CRIT_OVERLAP=' + JSON.stringify({ ...result, dupes: [...deletes.values()].filter(n => n > 1) }))
    expect(result).toEqual({ pending: 1, reads: [1, 1, 1], deletes: [1, 1, 1] })
  } finally { held.open(); await drainLong(); SL.__resetState() }
})

test('#551 T53 (R2-2): zero and negative pass clocks retain valid foreign records and diagnose once', async () => {
  for (const answer of [0, -1]) {
    const persisted = new Map<string, unknown>(), h = boot(), store = storeOf(persisted)
    const $ = standOf(async () => 'A', store)
    const foreign = v3Key(NS_SESS, 'zero', EXT_WRITER, 1)
    try {
      await SL.restoreAfterReload($, {} as never)
      persisted.set(foreign, SNAP(1, (5000 + 25 * HOUR) * 1000, 'zero'))
      let passClock = false
      const set = store.set
      store.set = async (key, value) => { await set(key, value); if (key.startsWith(NS_SESS)) passClock = true }
      $.clock.now = async () => { if (passClock) { passClock = false; return answer }; return 5000 }
      await publishTrigger(h, $, 'zero-' + answer)
      const result = { answer, present: persisted.has(foreign), named: diagOf('prune-clock-unavailable').length, general: diagOf('clock-now').length }
      console.log('CRIT_ZERO=' + JSON.stringify(result))
      expect(result).toEqual({ answer, present: true, named: 1, general: 0 })
    } finally { SL.__resetState() }
  }
})

test('#551 T54 (R2-3 close): clock deadline completes direct close and reaches the Close button UI; late reply has no effect', async () => {
  for (const button of [false, true]) {
    const persisted = new Map<string, unknown>(), held = gate()
    const clock: Clock = { now: 5000, arms: [] }
    let closing: Promise<void> | undefined
    try {
      const { $, store } = await openIn('A', persisted, clock)
      deadlineStand($, clock)
      let entered = false, settled = false, uiCloses = 0
      $.clock.now = async () => { entered = true; await held.p; return 9 * DAY }
      $.ui.close = async () => { uiCloses++; settled = true }
      if (button) await pressOn(treeOf('layout', store, $), 'close')
      else closing = SL.closeKeepDraft($).then(() => { settled = true })
      await drainLong(); fireDeadlines(clock); await drainLong()
      const result = { button, entered, settled, marks: markKeys(persisted, 'A').length, flags: flagKeys(persisted, 'A').length, uiCloses, named: diagOf('picker-close-mark-clock').length, general: diagOf('clock-now').length }
      console.log('SOL_R2_HELD_CLOCK=' + JSON.stringify(result))
      expect(result).toEqual({ button, entered: true, settled: true, marks: 1, flags: 0, uiCloses: button ? 1 : 0, named: 1, general: 0 })
      expect(diagOf('picker-close-mark-clock')[0]!.includes('15')).toBe(true)
      const before = SL.__diag()
      held.open(); await closing; await drainLong()
      expect(SL.__diag()).toEqual(before)
      expect(markKeys(persisted, 'A')).toHaveLength(1)
      expect(liveArms(clock).filter(a => a.ms === 15000)).toHaveLength(0)
    } finally { held.open(); await closing; await drainLong(); SL.__resetState() }
  }
})

test('#551 T55 (R2-3 prune): hung clock releases the pass and the next trigger can prune after cadence', async () => {
  const persisted = new Map<string, unknown>(), held = gate(), h = boot(), store = storeOf(persisted)
  const clock: Clock = { now: 5000, arms: [] }, $ = standOf(async () => 'A', store, clock)
  const foreign = v3Key(NS_SESS, 'hung-prune', EXT_WRITER, 1)
  let wantsClock = false, entered = 0
  try {
    await SL.restoreAfterReload($, {} as never)
    persisted.set(foreign, SNAP(1, (5000 + 25 * HOUR) * 1000, 'hung-prune'))
    deadlineStand($, clock)
    const set = store.set
    store.set = async (key, value) => { await set(key, value); if (key.startsWith(NS_SESS)) wantsClock = true }
    $.clock.now = async () => { if (wantsClock) { wantsClock = false; entered++; await held.p }; return clock.now }
    await publishTrigger(h, $, 'hung-prune-1')
    fireDeadlines(clock); await drainLong()
    expect({ entered, present: persisted.has(foreign), said: diagOf('prune-clock-unavailable').length }).toEqual({ entered: 1, present: true, said: 1 })
    $.clock.now = async () => clock.now
    clock.now += 15001
    await publishTrigger(h, $, 'hung-prune-2', clock.now)
    expect(persisted.has(foreign)).toBe(false)
    console.log('FIX3_PRUNE_RELEASE=' + JSON.stringify({ present: persisted.has(foreign), inFlight: snap()['pruneInFlight'] }))
    expect(snap()['pruneInFlight']).toBe(false)
  } finally { held.open(); await drainLong(); SL.__resetState() }
})

test('#551 T56 (R2-4): both late failure after new success and late success after new failure preserve the newest clock state', async () => {
  for (const oldFails of [true, false]) {
    boot()
    const held = gate(), old = standOf(async () => 'A', storeOf(new Map()))
    old.clock.now = async () => { await held.p; if (oldFails) throw new Error('old failure'); return 5000 }
    const pending = SL.__pictureReadClock(old)
    try {
      const newer = standOf(async () => 'A', storeOf(new Map()), { now: 9000, arms: [] })
      if (!oldFails) newer.clock.now = async () => { throw new Error('new failure') }
      await SL.__pictureReadClock(newer)
      held.open(); const applied = await pending
      expect({ oldFails, failed: snap()['clockFailed'], applied }).toEqual({ oldFails, failed: !oldFails, applied: oldFails ? 9000 : 0 })
      expect(diagOf('clock-now')).toHaveLength(1)
    } finally { held.open(); await pending; SL.__resetState() }
  }
})

test('#551 T57 (R2-5): refused mark and prune rereads each emit exactly one named diagnosis, no general clock-now', async () => {
  for (const mark of [true, false]) {
    const persisted = new Map<string, unknown>(), clock: Clock = { now: 5000, arms: [] }
    try {
      const { h, $, store } = await openIn('A', persisted, clock)
      let passClock = false
      const set = store.set
      store.set = async (key, value) => { await set(key, value); if (key.startsWith(NS_SESS)) passClock = true }
      $.clock.now = async () => { if (mark || passClock) { passClock = false; throw new Error('single clock refusal') }; return clock.now }
      if (mark) await SL.closeKeepDraft($)
      else await publishTrigger(h, $, 'single-prune')
      const key = mark ? 'picker-close-mark-clock' : 'prune-clock-unavailable'
      expect({ mark, named: diagOf(key).length, general: diagOf('clock-now').length }).toEqual({ mark, named: 1, general: 0 })
    } finally { SL.__resetState() }
  }
})

test('#551 T58 (R2-6): clock refusals of A and B close marks each receive their own diagnosis', async () => {
  const persisted = new Map<string, unknown>(), clock: Clock = { now: 5000, arms: [] }
  let session = 'A'
  try {
    const { h, $ } = await openIn('A', persisted, clock)
    $.session.id = async () => session
    $.clock.now = async () => { throw new Error('per mark refusal') }
    await SL.closeKeepDraft($)
    session = 'B'
    await command(h, $); await drainLong()
    await SL.closeKeepDraft($)
    const marks = [...markKeys(persisted, 'A'), ...markKeys(persisted, 'B')]
    const said = diagOf('picker-close-mark-clock')
    expect({ marks: marks.length, diagnoses: said.length }).toEqual({ marks: 2, diagnoses: 2 })
    for (const key of marks) expect(said.filter(text => text.includes(key))).toHaveLength(1)
  } finally { SL.__resetState() }
})

test('#551 T59 (R2-3 after refusal): an unavailable clock deadline refuses immediately without awaiting now', async () => {
  const persisted = new Map<string, unknown>(), held = gate(), clock: Clock = { now: 5000, arms: [] }
  let closing: Promise<void> | undefined
  try {
    const { $ } = await openIn('A', persisted, clock)
    $.clock.now = async () => { await held.p; return clock.now }
    $.clock.after = () => { throw new Error('clock.after refused by stand') }
    let settled = false
    closing = SL.closeKeepDraft($).then(() => { settled = true })
    await drainLong()
    expect({ settled, flags: flagKeys(persisted, 'A').length, marks: markKeys(persisted, 'A').length }).toEqual({ settled: true, flags: 0, marks: 1 })
    expect(diagOf('picker-close-mark-clock')).toHaveLength(1)
    expect(diagOf('picker-close-mark-clock')[0]!.includes('clock.after refused by stand')).toBe(true)
  } finally { held.open(); await closing; SL.__resetState() }
})

void textOf
void flagKeyFor
void v3Keys
