import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data/index'
import { boundText } from '../hooks/data/snapshotText'
import { walk, rowText, isSessKey, sessValue } from './world'
import type { Node } from './world'
import type { Source } from '../hooks/data/types'

// S4-FIX16b teeth (brief Б1–Б6). The stand is the one of s4-fix16.test.ts: the
// teeth run against the imported module instance; `t` is the mod's process
// clock (the now seam).
// CONSTRAINT: the helpers and seams of this wave are reached through module
// namespaces so this file still loads on a tree where they are not exported.

const drain = async (): Promise<void> => {
  for (let i = 0; i < 240; i++) await Promise.resolve()
}
const eventInput = (event: string, data: unknown, now = 0): void => SL.__feed({ source: { kind: 'event', event } as Source, ok: true, data, now })
const clone = (v: unknown): any => JSON.parse(JSON.stringify(v))
const tokens = (turnId: string, n: number) => ({ turnId, usage: { input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
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
const end = async (h: Record<string, any>, $: unknown): Promise<void> => {
  await h['session.end']($, {}, async () => ({}))
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
const landed = (key: string): boolean => SL.__sessQueue().landed.some(([k]) => k === key)
// the stale read-back records are keyed `session-verify-stale|<store key>|<read|refused>`
const STALE = 'session-verify-stale|'
const staleSince = (t: number): { at: number; key: string; text: string }[] => SL.__diag().filter((d) => d.key.startsWith(STALE) && at(d) > t).map((d) => ({ at: at(d), key: d.key, text: d.text }))

// the next store.get of a snapshot of the logical `key` (either form, #551
// §3.10) waits for the returned release; later reads pass through
const hangNextGet = ($: any, key: string): { release: (v: unknown) => void; refuse: (err: unknown) => void; hits: () => number } => {
  let release: (v: unknown) => void = () => undefined
  let refuse: (err: unknown) => void = () => undefined
  const gate = new Promise<unknown>((resolve, reject) => { release = resolve; refuse = reject })
  let hits = 0
  const get = $.store.get
  $.store.get = async (k: string) => {
    if (isSessKey(k, key.slice('sess:'.length))) {
      hits++
      if (hits === 1) return gate
    }
    return get(k)
  }
  return { release: (v: unknown) => release(v), refuse: (err: unknown) => refuse(err), hits: () => hits }
}

// ---------- Б1: a late verify read-back of the old key leaves the shared state alone (swe2 AR-1) ----------

// session A: a write of sess:A lands, the gather's read-back of sess:A hangs,
// the session switches to B, then the read answers with a value whose bound
// pass would open 64 key-merge episodes of sess:A
const lateVerifyOfA = async (): Promise<{ h: Record<string, any>; $: any; persisted: Map<string, unknown>; tSwitch: number; atSwitch: Set<string> }> => {
  const { h, $, persisted } = await start()
  eventInput('turn.complete', tokens('a1', 100), 60000)
  await end(h, $)
  expect(landed('sess:A')).toBe(true)
  const hang = hangNextGet($, 'sess:A')
  $.t += 16000
  await gather($)
  expect(hang.hits()).toBe(1)
  const tSwitch = $.t
  $.t += 1000
  sessionInfo('B', 1000)
  expect(famLive(FAMILIES[0]).session).toBe('B')
  const atSwitch = new Set(SL.__episodes())
  hang.release({ ...SNAP(50, 42_000_000_000), origin: '', extra: sites(64) })
  await drain()
  await drain()
  return { h, $, persisted, tSwitch, atSwitch }
}

test('S4F16b Б1: a verify read-back of sess:A answering after the switch to B is discarded and opens no sess:A episodes', async () => {
  SL.__resetState()
  try {
    const { tSwitch, atSwitch } = await lateVerifyOfA()
    // both halves in one expectation: 64 merge records of a learnRead evict the
    // stale record from the 64-record diag buffer, and a first failing half
    // would hide the second
    const records = staleSince(tSwitch).map((r) => ({ key: r.key, text: r.text }))
    const newEpisodesOfA = SL.__episodes().filter((id) => id.includes('sess:A') && !atSwitch.has(id)).length
    expect({ records, newEpisodesOfA }).toEqual({ records: [{ key: 'session-verify-stale|sess:A|read', text: 'read-back of sess:A discarded after the session changed; current key is sess:B' }], newEpisodesOfA: 0 })
  } finally { SL.__resetState() }
})

test('S4F16b Б1b: a second stale read-back in the next session writes its own record', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await lateVerifyOfA()
    expect(staleSince(-1).map((r) => r.key)).toEqual(['session-verify-stale|sess:A|read'])
    $.session.id = async () => 'B'
    $.t += 16000
    await gather($)
    eventInput('turn.complete', tokens('b1', 10), 90000)
    await end(h, $)
    expect(landed('sess:B')).toBe(true)
    const hang = hangNextGet($, 'sess:B')
    $.t += 16000
    await gather($)
    expect(hang.hits()).toBe(1)
    const tSwitch2 = $.t
    $.t += 1000
    sessionInfo('C', 2000)
    expect(famLive(FAMILIES[0]).session).toBe('C')
    hang.release({ ...SNAP(10, 42_000_000_000), origin: '' })
    await drain()
    await drain()
    const recs = staleSince(tSwitch2)
    expect(recs.length).toBe(1)
    expect(recs[0]!.at > tSwitch2).toBe(true)
    expect(recs[0]!.key).toBe('session-verify-stale|sess:B|read')
    expect(recs[0]!.text).toBe('read-back of sess:B discarded after the session changed; current key is sess:C')
    // the same key and outcome again in a later session: the session change frees the once-key
    $.session.id = async () => 'A'
    sessionInfo('A', 3000)
    expect(famLive(FAMILIES[0]).session).toBe('A')
    $.t += 16000
    await gather($)
    eventInput('turn.complete', tokens('a2', 10), 120000)
    await end(h, $)
    expect(landed('sess:A')).toBe(true)
    const hang3 = hangNextGet($, 'sess:A')
    $.t += 16000
    await gather($)
    expect(hang3.hits()).toBe(1)
    const tSwitch3 = $.t
    $.t += 1000
    sessionInfo('D', 4000)
    expect(famLive(FAMILIES[0]).session).toBe('D')
    hang3.release({ ...SNAP(10, 42_000_000_000), origin: '' })
    await drain()
    await drain()
    expect(staleSince(tSwitch3).map((r) => ({ key: r.key, text: r.text }))).toEqual([{ key: 'session-verify-stale|sess:A|read', text: 'read-back of sess:A discarded after the session changed; current key is sess:D' }])
  } finally { SL.__resetState() }
})

// ---------- Б2: the clone-refusal reset keeps the session (swe2 AR-2) ----------

test('S4F16b Б2: a clone refusal of the base family resets it with session A kept, and session.end writes its snapshot', async () => {
  SL.__resetState()
  try {
    const { h, $, persisted } = await start()
    sessionInfo('A', 1)
    const st: Record<string, unknown> = { ...famLive(FAMILIES[0]) }
    expect(st['session']).toBe('A')
    // enumerable: the clone walks it and throws, as in S4F15 В4
    Object.defineProperty(st, 'tools', { get() { throw new Error('poisoned') }, enumerable: true, configurable: true })
    SL.__setFamState(FAMILIES[0]!, st)
    eventInput('tool.call', { callKey: 'c1', tool: 'Read', input: {} }, 2)
    expect(diags('family-state-reset').filter((d) => d.text.includes('accumulated figures of session A are lost')).length).toBe(1)
    expect(famLive(FAMILIES[0]).session).toBe('A')
    await h['session.end']($, {}, async () => ({}))
    await drain()
    const snap = sessValue(persisted, 'A')
    expect(snap !== undefined && snap !== null).toBe(true)
  } finally { SL.__resetState() }
})

// ---------- Б3: a refused init() on the clone-refusal reset keeps the clone error ----------

test('S4F16b Б3: a clone refusal with init() throwing gives one family-init-failed, one family-feed with the clone error, and the state stays', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    await start()
    const stub = {
      family: 's4f16b-noclone',
      elements: [],
      sources: [{ source: { kind: 'event', event: 'turn.start' }, elements: [] }],
      init: () => { throw new Error('s4f16b init fault') },
      reduce: (s: unknown) => s,
    }
    FAMILIES.push(stub as never)
    const orig: Record<string, unknown> = { mark: 1 }
    Object.defineProperty(orig, 'poison', { get() { throw new Error('s4f16b clone fault') }, enumerable: true, configurable: true })
    SL.__setFamState(stub as never, orig)
    eventInput('turn.start', {}, 1)
    const inits = diags('family-init-failed')
    expect(inits.length).toBe(1)
    expect(inits[0]!.text.includes('s4f16b init fault')).toBe(true)
    const feeds = diags('family-feed').filter((d) => d.text.startsWith('family s4f16b-noclone:'))
    expect(feeds.length).toBe(1)
    expect(feeds[0]!.text.includes('s4f16b clone fault')).toBe(true)
    // identity as a boolean: the matcher would read the poisoned getter of the received value
    expect(famLive(stub) === orig).toBe(true)
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

// ---------- Б4: the second clone of the fresh state is inside the retry's try (sol gap 1) ----------

test('S4F16b Б4: a fresh state whose second clone throws gives one family-feed with the input error and one family-init-failed', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    await start()
    let reads = 0
    const stub = {
      family: 's4f16b-secondclone',
      elements: [],
      sources: [{ source: { kind: 'event', event: 'turn.start' }, elements: [] }],
      init: () => ({
        get x() {
          reads++
          if (reads >= 2) throw new Error('s4f16b second clone fault')
          return 1
        },
      }),
      reduce: (s: { mark?: unknown }) => {
        if (s.mark === 1) throw new Error('s4f16b input fault')
        return s
      },
    }
    FAMILIES.push(stub as never)
    const orig = { mark: 1 }
    SL.__setFamState(stub as never, orig)
    eventInput('turn.start', {}, 1)
    const feeds = diags('family-feed').filter((d) => d.text.startsWith('family s4f16b-secondclone:'))
    expect(feeds.length).toBe(1)
    expect(feeds[0]!.text.includes('s4f16b input fault')).toBe(true)
    const inits = diags('family-init-failed')
    expect(inits.length).toBe(1)
    expect(inits[0]!.text.includes('s4f16b second clone fault')).toBe(true)
    expect(reads).toBe(2)
    expect(famLive(stub)).toBe(orig)
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

// ---------- Б5: the session sweep keeps the write, verify and global episodes (sol gap 2) ----------

test('S4F16b Б5: a session change frees the key-merge and array-cap episodes and keeps write, verify, prune and seq-cap', async () => {
  SL.__resetState()
  try {
    // every episode is opened by its own path; the stand's intrinsics are
    // read-only, so ids cannot be planted in the set
    // restore of a legacy sess:A at the seq cap: array-cap and key-merge of sess:A
    const SEQ_CAP = 2 ** 52
    const persisted = new Map<string, unknown>([['sess:A', { ...SNAP(50, SEQ_CAP - 1), origin: 'zz', extra: { arr: new Array(70).fill(1), ...sites(1) } }]])
    const h = handlers()
    const $ = fullStand(persisted)
    $.wall = Math.floor((SEQ_CAP - 1) / 1000)
    await SL.restoreAfterReload($, {} as never)
    await drain()
    expect(famLive(FAMILIES[0]).session).toBe('A')
    // at the stored seq the origin decides; this module's writes rank above 'zz'
    SL.__setOrigin('zzz')
    // a write that lands at the cap opens seq-cap; its prune meets a refused store.keys
    $.store.keys = async () => { throw new Error('keys refused') }
    $.t += 16000
    eventInput('turn.complete', tokens('a1', 1))
    await end(h, $)
    expect((sessValue(persisted, 'A') as { sum: { total: number } }).sum.total).toBe(51)
    // the gather's read-back of the landed key is refused
    const get = $.store.get
    $.store.get = async (k: string) => {
      if (isSessKey(k, 'A')) throw new Error('get refused')
      return get(k)
    }
    $.t += 16000
    await gather($)
    // the next write of sess:A is refused
    const put = $.store.set
    $.store.set = async (k: string, v: unknown) => {
      if (isSessKey(k, 'A')) throw new Error('set refused')
      return put(k, v)
    }
    eventInput('turn.complete', tokens('a2', 1))
    await end(h, $)
    const kept = [
      'session-snapshot-write|sess:A',
      'session-snapshot-verify|sess:A',
      'session-snapshot-prune|sess:',
      'session-snapshot-seq-cap|sess:',
    ]
    const ofA = (ids: string[]): string[] => ids.filter((id) => (id.startsWith('session-snapshot-key-merge|') || id.startsWith('session-snapshot-array-cap|')) && id.includes('sess:A'))
    const atSwitch = SL.__episodes()
    expect(kept.filter((id) => atSwitch.includes(id))).toEqual(kept)
    const freed = ofA(atSwitch)
    expect(freed.includes('session-snapshot-array-cap|sess:A')).toBe(true)
    expect(freed.some((id) => id.startsWith('session-snapshot-key-merge|'))).toBe(true)
    sessionInfo('B', 1000)
    expect(famLive(FAMILIES[0]).session).toBe('B')
    const now = SL.__episodes()
    expect(kept.filter((id) => now.includes(id))).toEqual(kept)
    expect(ofA(now)).toEqual([])
  } finally { SL.__resetState() }
})

// ---------- Б6: prototype names in the template are unknown variables (sol gap 3) ----------

test('S4F16b Б6: template variables "__proto__" and "hasOwnProperty" are unknown', () => {
  SL.__resetState()
  try {
    const proto = rowText(walk(SL.__render({ template: 'x={__proto__}' }) as Node))
    expect(proto.includes('{?__proto__}')).toBe(true)
    expect(diags('tpl-unknown-__proto__').map((d) => d.text)).toEqual(["template: unknown variable '__proto__'"])
    const own = rowText(walk(SL.__render({ template: 'y={hasOwnProperty}' }) as Node))
    expect(own.includes('{?hasOwnProperty}')).toBe(true)
    expect(diags('tpl-unknown-hasOwnProperty').map((d) => d.text)).toEqual(["template: unknown variable 'hasOwnProperty'"])
  } finally { SL.__resetState() }
})

// ---------- В1: the reset record is written only for a reset that happened (FIX16b AR-2) ----------

test('S4F16c В1a: a clone refusal with init() throwing writes no family-state-reset', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    await start()
    const stub = {
      family: 's4f16c-noinit',
      elements: [],
      sources: [{ source: { kind: 'event', event: 'turn.start' }, elements: [] }],
      init: () => { throw new Error('s4f16c init fault') },
      reduce: (s: unknown) => s,
    }
    FAMILIES.push(stub as never)
    const orig: Record<string, unknown> = { mark: 1 }
    Object.defineProperty(orig, 'poison', { get() { throw new Error('s4f16c clone fault') }, enumerable: true, configurable: true })
    SL.__setFamState(stub as never, orig)
    eventInput('turn.start', {}, 1)
    expect(diags('family-init-failed').length).toBe(1)
    expect(diags('family-state-reset').length).toBe(0)
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

test('S4F16c В1b: a clone refusal of the base family with init() intact writes exactly one family-state-reset', async () => {
  SL.__resetState()
  try {
    await start()
    sessionInfo('A', 1)
    const st: Record<string, unknown> = { ...famLive(FAMILIES[0]) }
    Object.defineProperty(st, 'tools', { get() { throw new Error('poisoned') }, enumerable: true, configurable: true })
    SL.__setFamState(FAMILIES[0]!, st)
    eventInput('tool.call', { callKey: 'c1', tool: 'Read', input: {} }, 2)
    const recs = diags('family-state-reset')
    expect(recs.length).toBe(1)
    expect(recs[0]!.text.includes('accumulated figures of session A are lost')).toBe(true)
  } finally { SL.__resetState() }
})

// ---------- В2: a refused read-back after the switch opens no episode of the old key (FIX16b AR-3) ----------

test('S4F16c В2: a verify read-back of sess:A refused after the switch to B is recorded as stale and opens no verify episode', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(landed('sess:A')).toBe(true)
    const hang = hangNextGet($, 'sess:A')
    $.t += 16000
    await gather($)
    expect(hang.hits()).toBe(1)
    const tSwitch = $.t
    $.t += 1000
    sessionInfo('B', 1000)
    expect(famLive(FAMILIES[0]).session).toBe('B')
    hang.refuse(new Error('s4f16c get refused'))
    await drain()
    await drain()
    const recs = staleSince(tSwitch)
    expect(recs.length).toBe(1)
    expect(recs[0]!.key).toBe('session-verify-stale|sess:A|refused')
    expect(recs[0]!.text.includes('failed after the session changed')).toBe(true)
    expect(recs[0]!.text.includes('s4f16c get refused')).toBe(true)
    expect(SL.__episodes().includes('session-snapshot-verify|sess:A')).toBe(false)
  } finally { SL.__resetState() }
})

// ---------- Д1: a refused stale read-back ends the verify episode its hang opened (sol 1) ----------

test('S4F16d Д1: a verify episode of sess:A opened by a hang before the switch to B ends when the read is refused after it', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(landed('sess:A')).toBe(true)
    const hang = hangNextGet($, 'sess:A')
    $.t += 16000
    await gather($)
    expect(hang.hits()).toBe(1)
    $.t += 16000
    await gather($)
    expect(SL.__episodes().includes('session-snapshot-verify|sess:A')).toBe(true)
    $.t += 1000
    sessionInfo('B', 1000)
    expect(famLive(FAMILIES[0]).session).toBe('B')
    expect(SL.__episodes().includes('session-snapshot-verify|sess:A')).toBe(true)
    hang.refuse(new Error('s4f16d get refused'))
    await drain()
    await drain()
    expect(SL.__episodes().includes('session-snapshot-verify|sess:A')).toBe(false)
  } finally { SL.__resetState() }
})

// ---------- Д2: staleness follows the session epoch, not key equality (sol 3) ----------

test('S4F16d Д2: a verify read-back of sess:A begun before A→B→A is discarded in the second stay in A and opens no sess:A episodes', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(landed('sess:A')).toBe(true)
    const hang = hangNextGet($, 'sess:A')
    $.t += 16000
    await gather($)
    expect(hang.hits()).toBe(1)
    const tSwitch = $.t
    $.t += 1000
    sessionInfo('B', 1000)
    expect(famLive(FAMILIES[0]).session).toBe('B')
    sessionInfo('A', 2000)
    expect(famLive(FAMILIES[0]).session).toBe('A')
    const atReturn = new Set(SL.__episodes())
    hang.release({ ...SNAP(50, 42_000_000_000), origin: '', extra: sites(64) })
    await drain()
    await drain()
    // both halves in one expectation, as in Б1
    const records = staleSince(tSwitch).map((r) => r.key)
    const newEpisodesOfA = SL.__episodes().filter((id) => id.includes('sess:A') && !atReturn.has(id)).length
    expect({ records, newEpisodesOfA }).toEqual({ records: ['session-verify-stale|sess:A|read'], newEpisodesOfA: 0 })
    expect(staleSince(tSwitch).map((r) => r.text.includes('discarded after the session changed'))).toEqual([true])
  } finally { SL.__resetState() }
})

// ---------- Д3: every outcome of a stale read-back writes its own record (sol 2, swe2 low) ----------

test('S4F16d Д3: in session B a stale read of sess:X answering and a stale read of sess:A refused write two records', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start(new Map<string, unknown>(), 'X')
    eventInput('turn.complete', tokens('x1', 100), 60000)
    await end(h, $)
    expect(landed('sess:X')).toBe(true)
    const hangX = hangNextGet($, 'sess:X')
    $.t += 16000
    await gather($)
    expect(hangX.hits()).toBe(1)
    const tSwitch = $.t
    $.t += 1000
    $.session.id = async () => 'A'
    sessionInfo('A', 1000)
    expect(famLive(FAMILIES[0]).session).toBe('A')
    $.t += 16000
    await gather($)
    eventInput('turn.complete', tokens('a1', 10), 90000)
    await end(h, $)
    expect(landed('sess:A')).toBe(true)
    const hangA = hangNextGet($, 'sess:A')
    $.t += 16000
    await gather($)
    expect(hangA.hits()).toBe(1)
    $.t += 1000
    sessionInfo('B', 2000)
    expect(famLive(FAMILIES[0]).session).toBe('B')
    hangX.release({ ...SNAP(10, 42_000_000_000), origin: '' })
    await drain()
    await drain()
    hangA.refuse(new Error('s4f16d get refused'))
    await drain()
    await drain()
    expect(staleSince(tSwitch).map((r) => r.key)).toEqual(['session-verify-stale|sess:X|read', 'session-verify-stale|sess:A|refused'])
  } finally { SL.__resetState() }
})

// ---------- Д4: the rebind session comes from S.recovery, not from the refused state (swe2 AR-2) ----------

test('S4F16d Д4: a clone refusal of the base family whose session getter answers ZZZ rebinds to the recovery session A', async () => {
  SL.__resetState()
  try {
    await start()
    sessionInfo('A', 1)
    expect((SL.__stateSnapshot()['recovery'] as { session: string }).session).toBe('A')
    const st: Record<string, unknown> = { ...famLive(FAMILIES[0]) }
    Object.defineProperty(st, 'session', { get() { return 'ZZZ' }, enumerable: true, configurable: true })
    Object.defineProperty(st, 'tools', { get() { throw new Error('poisoned') }, enumerable: true, configurable: true })
    SL.__setFamState(FAMILIES[0]!, st)
    eventInput('tool.call', { callKey: 'c1', tool: 'Read', input: {} }, 2)
    expect(famLive(FAMILIES[0]).session).toBe('A')
    const recs = diags('family-state-reset')
    expect(recs.length).toBe(1)
    expect(recs[0]!.text.includes('of session A are lost')).toBe(true)
  } finally { SL.__resetState() }
})

// ---------- Д5: a fresh state whose clone throws is no reset (sol 4) ----------

test('S4F16d Д5: an init() state whose clone throws writes no family-state-reset, one family-init-failed, and the state stays', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    await start()
    const stub = {
      family: 's4f16d-freshclone',
      elements: [],
      sources: [{ source: { kind: 'event', event: 'turn.start' }, elements: [] }],
      init: () => ({ get y(): number { throw new Error('s4f16d fresh clone fault') } }),
      reduce: (s: unknown) => s,
    }
    FAMILIES.push(stub as never)
    const orig: Record<string, unknown> = { mark: 1 }
    Object.defineProperty(orig, 'poison', { get() { throw new Error('s4f16d clone fault') }, enumerable: true, configurable: true })
    SL.__setFamState(stub as never, orig)
    eventInput('turn.start', {}, 1)
    expect(diags('family-state-reset').length).toBe(0)
    const inits = diags('family-init-failed')
    expect(inits.length).toBe(1)
    expect(inits[0]!.text.includes('s4f16d fresh clone fault')).toBe(true)
    // identity as a boolean: the matcher would read the poisoned getter of the received value
    expect(famLive(stub) === orig).toBe(true)
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

// ---------- Д6: both family-init-failed records carry one text (sol 5) ----------

const INIT_FAILED = (family: string): string => 'family ' + family + ': could not build a fresh state (init, session rebind or clone) to replace a state that failed: '

test('S4F16d Д6: the clone-refusal branch and the retry branch write family-init-failed with the one lead-in', async () => {
  SL.__resetState()
  const count = FAMILIES.length
  try {
    await start()
    const cloneBranch = {
      family: 's4f16d-clonebranch',
      elements: [],
      sources: [{ source: { kind: 'event', event: 'turn.start' }, elements: [] }],
      init: () => { throw new Error('s4f16d clone-branch init fault') },
      reduce: (s: unknown) => s,
    }
    const retryBranch = {
      family: 's4f16d-retrybranch',
      elements: [],
      sources: [{ source: { kind: 'event', event: 'turn.start' }, elements: [] }],
      init: () => { throw new Error('s4f16d retry-branch init fault') },
      reduce: () => { throw new Error('s4f16d retry-branch input fault') },
    }
    FAMILIES.push(cloneBranch as never, retryBranch as never)
    const orig: Record<string, unknown> = { mark: 1 }
    Object.defineProperty(orig, 'poison', { get() { throw new Error('s4f16d clone fault') }, enumerable: true, configurable: true })
    SL.__setFamState(cloneBranch as never, orig)
    SL.__setFamState(retryBranch as never, { mark: 1 })
    eventInput('turn.start', {}, 1)
    const lead = (family: string): string[] => diags('family-init-failed').filter((d) => d.text.startsWith('family ' + family + ':')).map((d) => d.text.slice(0, INIT_FAILED(family).length))
    expect({ clone: lead('s4f16d-clonebranch'), retry: lead('s4f16d-retrybranch') }).toEqual({ clone: [INIT_FAILED('s4f16d-clonebranch')], retry: [INIT_FAILED('s4f16d-retrybranch')] })
  } finally { FAMILIES.splice(count); SL.__resetState() }
})

// ---------- Д7: a refused read-back begun before A→B→A is stale by the epoch (sol 2, swe2 Н1) ----------

test('S4F16e Д7: a verify read-back of sess:A begun before A→B→A and refused in the second stay in A is recorded as stale and opens no verify episode', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start()
    eventInput('turn.complete', tokens('a1', 100), 60000)
    await end(h, $)
    expect(landed('sess:A')).toBe(true)
    const hang = hangNextGet($, 'sess:A')
    $.t += 16000
    await gather($)
    expect(hang.hits()).toBe(1)
    const tSwitch = $.t
    $.t += 1000
    sessionInfo('B', 1000)
    expect(famLive(FAMILIES[0]).session).toBe('B')
    sessionInfo('A', 2000)
    expect(famLive(FAMILIES[0]).session).toBe('A')
    hang.refuse(new Error('s4f16e get refused'))
    await drain()
    await drain()
    const records = staleSince(tSwitch).map((r) => ({ key: r.key, failedAfterSwitch: r.text.includes('failed after the session changed') }))
    const verifyOpen = SL.__episodes().includes('session-snapshot-verify|sess:A')
    expect({ records, verifyOpen }).toEqual({ records: [{ key: 'session-verify-stale|sess:A|refused', failedAfterSwitch: true }], verifyOpen: false })
  } finally { SL.__resetState() }
})

// ---------- Д8: the stale once-keys settling after the sweep are bounded (sol 1) ----------

test('S4F16e Д8: 100 stale read-backs of 100 sessions settling in the last session keep at most 64 once-keys, the newest among them', async () => {
  SL.__resetState()
  try {
    const { h, $ } = await start(new Map<string, unknown>(), 'S0')
    const hangs: { release: (v: unknown) => void; hits: () => number }[] = []
    for (let i = 0; i < 100; i++) {
      const id = 'S' + i
      if (i > 0) {
        $.session.id = async () => id
        sessionInfo(id, 1000 + i)
        expect(famLive(FAMILIES[0]).session).toBe(id)
        $.t += 16000
        await gather($)
      }
      eventInput('turn.complete', tokens('t' + i, 10), 60000 + i)
      await end(h, $)
      expect(landed('sess:' + id)).toBe(true)
      const hang = hangNextGet($, 'sess:' + id)
      $.t += 16000
      await gather($)
      expect(hang.hits()).toBe(1)
      hangs.push(hang)
    }
    $.session.id = async () => 'Z'
    sessionInfo('Z', 5000)
    expect(famLive(FAMILIES[0]).session).toBe('Z')
    for (const hang of hangs) {
      hang.release({ ...SNAP(10, 42_000_000_000), origin: '' })
      await drain()
    }
    await drain()
    const held = (SL.__stateSnapshot()['diagOnce'] as string[]).filter((k) => k.startsWith(STALE))
    expect({ overCap: Math.max(0, held.length - 64), newest: held.includes('session-verify-stale|sess:S99|read') }).toEqual({ overCap: 0, newest: true })
  } finally { SL.__resetState() }
})
