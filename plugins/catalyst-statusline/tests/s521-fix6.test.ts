import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { STORE_DRAFT, STORE_OPEN, STORE_OPEN_CLOSED, STORE_OPEN_CLOSED_V2, STORE_EPOCH, STORE_UNDO, STORE_SAVING, STORE_THEMES, openFlags, closedMarks, themeRecords, undoStack, saveMarks, interleaved, epochs, markKeys as marksOf, draftOf as draftIn, v3Key, v3Keys, NS_OPEN, NS_MARK, NS_EPOCH, NS_DRAFT, NS_UNDO, NS_SAVING, EXT_WRITER } from './world'

// #521 FIX6 teeth (Р1–Р6). CONSTRAINT (s521-fix1 tooth 11): the kit skips a
// store hook that throws, so every refused or held store call is stood up in
// this realm and the module is driven directly. A second process is a second
// state: SL.__resetState() between them, the store map shared.

const DAY = 86400000
const drain = async (): Promise<void> => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const drainLong = async (): Promise<void> => { for (let i = 0; i < 12; i++) await drain() }
const draftKey = (session: string): string => STORE_DRAFT + ':' + session
const snap = (): Record<string, any> => SL.__stateSnapshot() as Record<string, any>
// a flag's open: this version's openId, the previous version's token
const idOf = (f: { openId?: string; token?: string }): string | undefined => f.openId ?? f.token
// CONSTRAINT (#551 §3 ticket): until a state's first clock read its stamps are
// the wall's (stampMs), and the restore's epoch record is its first ticket —
// the stand clock is read first, so the stamps of the state are the stand's
const restoreIn = async ($: any): Promise<void> => {
  await SL.__pictureReadClock($)
  await SL.restoreAfterReload($, {} as never)
}

const body = (ids: string[][], axes: Record<string, string> = {}): Record<string, unknown> => ({
  lines: ids.map((l) => l.map((id) => ({ id, body: '{' + id + '.text}' }))), axes, elements: {}, focus: null, tab: 'layout', query: '', fam: 'model', page: 0, targetLine: 0, themeName: '',
})

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
  holdSet?: (k: string) => Promise<void> | undefined
}

// the kit store's semantics over one map; the options refuse or hold named
// keys the way another process or a refusing host would
const storeOf = (persisted: Map<string, unknown>, o: StoreOpts = {}): StoreStand => ({
  get: async (k) => persisted.get(k),
  set: async (k, v) => {
    const copy = JSON.parse(JSON.stringify(v))
    if (o.refuseSet?.(k)) throw new Error('write of ' + k + ' refused by the test')
    const held = o.holdSet?.(k)
    if (held) await held
    persisted.set(k, copy)
  },
  delete: async (k) => {
    if (o.refuseDelete?.(k)) throw new Error('delete of ' + k + ' refused by the test')
    persisted.delete(k)
  },
  keys: async () => [...persisted.keys()],
})

type Arm = { ms: number; fn: () => void; cancelled: boolean }
type Clock = { now: number; arms: Arm[] }

const standOf = (id: () => Promise<string>, store: StoreStand, clock: Clock = { now: 5000, arms: [] }): any => ({
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
  config: { list: async () => [], set: async () => undefined },
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

// ---------- Р1: the moved bare flag is keyed by its session ----------

test('#521 FIX6 Р1: two sessions each adopt their own bare open flag, which stays; A\'s re-stamp and A\'s close leave B\'s flag as it was, and the reload in B reopens B\'s panel', async () => {
  const T0 = Date.now()
  const persisted = new Map<string, unknown>([
    [STORE_OPEN, { session: 'A', token: 'tA', t: T0 }],
    [draftKey('A'), { session: 'A', t: T0, ...body([['ctx']]) }],
    [draftKey('B'), { session: 'B', t: T0, ...body([['ver']]) }],
  ])
  const flagsOf = (session: string): string => JSON.stringify(openFlags(persisted).filter((f) => f.session === session))
  try {
    boot()
    await restoreIn(standOf(async () => 'A', storeOf(persisted), { now: T0, arms: [] }))
    expect(snap()['pickerOpen']).toBe(true)
    // #551 D8: the previous version's record is read only
    expect(persisted.get(STORE_OPEN)).toEqual({ session: 'A', token: 'tA', t: T0 })
    // an instance of the previous version leaves B's bare flag after A's adoption
    persisted.set(STORE_OPEN, { session: 'B', token: 'tB', t: T0 })
    boot()
    await restoreIn(standOf(async () => 'B', storeOf(persisted), { now: T0, arms: [] }))
    expect(snap()['pickerOpen']).toBe(true)
    const flagB = flagsOf('B')
    expect(openFlags(persisted).filter((f) => f.session === 'B').length).toBe(1)
    boot()
    const clock: Clock = { now: T0 + DAY, arms: [] }
    const $A = standOf(async () => 'A', storeOf(persisted), clock)
    await SL.__pictureReadClock($A)
    await SL.restoreAfterReload($A, {} as never)
    expect(snap()['pickerOpen']).toBe(true)
    expect(liveArms(clock).length).toBe(1)
    liveArms(clock)[0]!.fn()
    await drainLong()
    expect(openFlags(persisted).filter((f) => f.session === 'A').map((f) => f.at)).toEqual([T0 + DAY])
    expect(flagsOf('B')).toBe(flagB)
    await SL.closeKeepDraft($A)
    expect(flagsOf('A')).toBe('[]')
    expect(flagsOf('B')).toBe(flagB)
    boot()
    await restoreIn(standOf(async () => 'B', storeOf(persisted), { now: T0 + DAY, arms: [] }))
    expect(snap()['pickerOpen']).toBe(true)
  } finally {
    SL.__resetState()
  }
})

// ---------- Р2: a flag write that lands after the close is undone ----------

const heldFlagStore = (persisted: Map<string, unknown>): { store: StoreStand; arm: () => void; held: () => Gate | null } => {
  let armed = false
  let held: Gate | null = null
  const store = storeOf(persisted, {
    holdSet: (k) => {
      if (!armed || !k.startsWith(NS_OPEN)) return undefined
      armed = false
      held = gate()
      return held.p
    },
  })
  return { store, arm: () => { armed = true }, held: () => held }
}

test('#521 FIX6 Р2: a timer re-stamp whose flag write lands after the close does not bring the flag back — the reload does not open the panel', async () => {
  const T0 = Date.now()
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: T0, ...body([['ctx']]) }]])
  const { store, arm, held } = heldFlagStore(persisted)
  const clock: Clock = { now: T0, arms: [] }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect(snap()['pickerOpen']).toBe(true)
    expect(liveArms(clock).length).toBe(1)
    arm()
    clock.now = T0 + DAY
    liveArms(clock)[0]!.fn()
    await drainLong()
    expect(held()).not.toBeNull()
    await SL.closeKeepDraft($)
    expect(openFlags(persisted)).toEqual([])
    held()!.open()
    await drainLong()
    expect(openFlags(persisted)).toEqual([])
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(snap()['pickerOpen']).toBe(false)
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX6 Р2: an open whose flag write lands after the close leaves no open flag — the reload does not open the panel', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  const { store, arm, held } = heldFlagStore(persisted)
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store)
    arm()
    const opening = command(h, $)
    await drainLong()
    expect(held()).not.toBeNull()
    await SL.closeKeepDraft($)
    held()!.open()
    await opening
    await drainLong()
    expect(openFlags(persisted)).toEqual([])
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(snap()['pickerOpen']).toBe(false)
  } finally {
    SL.__resetState()
  }
})

// ---------- Р3: a refused ui.open undoes the open ----------

// CONSTRAINT (FIX6b Б1): an open yields to a close on its own, so the re-check
// inside the flag write is the rebind's only guard — this tooth pins it there
test('#521 FIX6 Р2: a rebind whose flag write lands after the close leaves no open flag — the reload in B does not open the panel', async () => {
  const persisted = new Map<string, unknown>([
    // open T1 is another environment's publication of this version, adopted by the restore
    [v3Key(NS_OPEN, 'A', EXT_WRITER, 1), { session: 'A', openId: 't1', e: 0, n: 1, at: 1 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  const { store, arm, held } = heldFlagStore(persisted)
  const session = { id: 'A' }
  try {
    SL.__resetState()
    const $ = standOf(async () => session.id, store)
    await SL.restoreAfterReload($, {} as never)
    SL.__render({})
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('A')
    arm()
    session.id = 'B'
    const refreshing = SL.__refresh($)
    await drainLong()
    expect(held()).not.toBeNull()
    const closing = SL.closeKeepDraft($)
    await drainLong()
    held()!.open()
    await closing
    await refreshing
    await drainLong()
    expect(openFlags(persisted)).toEqual([])
    boot()
    await SL.restoreAfterReload(standOf(async () => 'B', storeOf(persisted)), {} as never)
    expect(snap()['pickerOpen']).toBe(false)
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX6 Р3: a refused ui.open leaves no open flag, no timer, the panel closed, the draft kept and one diagnostic', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']], { numTokens: 'raw' }) }]])
  const clock: Clock = { now: 5000, arms: [] }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), clock)
    $.ui.open = async () => { throw new Error('open refused by the test') }
    await command(h, $)
    await drainLong()
    expect(openFlags(persisted)).toEqual([])
    expect(liveArms(clock).length).toBe(0)
    expect(snap()['pickerOpen']).toBe(false)
    expect((persisted.get(draftKey('A')) as any)?.axes?.numTokens).toBe('raw')
    expect(SL.__diag().filter((d) => d.key === 'picker-open').map((d) => ({ kind: d.kind, tail: d.text.endsWith('; the panel is not open') }))).toEqual([{ kind: 'warn', tail: true }])
  } finally {
    SL.__resetState()
  }
})

// ---------- Р4: moved records are keyed by their content ----------

test('#521 FIX6 Р4 (а): a bare theme map changed after a move whose bare delete was refused moves again — the moved theme and the changed one both stay', async () => {
  const persisted = new Map<string, unknown>([[STORE_THEMES, { u: { palette: 'mono' } }]])
  const store = storeOf(persisted, { refuseDelete: (k) => k === STORE_THEMES })
  try {
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', store), {} as never)
    expect(themeRecords(persisted).map((r) => r['palette'])).toEqual(['mono'])
    persisted.set(STORE_THEMES, { u: { palette: 'neon' } })
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', store), {} as never)
    expect(themeRecords(persisted).map((r) => r.name + ':' + String(r['palette'])).sort()).toEqual(['u:mono', 'u:neon'])
    expect(Object.keys(snap()['userThemes'] as Record<string, unknown>).sort()).toEqual(['u', 'u (2)'])
  } finally {
    SL.__resetState()
  }
})

const UNDO_A = { fields: ['numUsd'], prev: { numUsd: 'exact' }, written: { numUsd: 'short' } }
const UNDO_B = { fields: ['numTokens'], prev: { numTokens: 'raw' }, written: { numTokens: 'compact' } }
const UNDO_C = { fields: ['numPercent'], prev: { numPercent: 'int' }, written: { numPercent: 'one' } }

test('#521 FIX6 Р4 (б): a bare undo array is read only — changed by the previous version, it is read as it stands, and no copy of it is written', async () => {
  const persisted = new Map<string, unknown>([[STORE_UNDO, [UNDO_A]]])
  const store = storeOf(persisted, { refuseDelete: (k) => k === STORE_UNDO })
  try {
    await command(boot(), standOf(async () => 'A', store))
    await drainLong()
    expect(undoStack(persisted).map((r) => r.written)).toEqual([UNDO_A.written])
    persisted.set(STORE_UNDO, [UNDO_B])
    await command(boot(), standOf(async () => 'A', store))
    await drainLong()
    // #551 D8: nothing of the earlier array was copied — the records are the array's
    expect({ records: undoStack(persisted).map((r) => r.written), copies: v3Keys(persisted, NS_UNDO) }).toEqual({ records: [UNDO_B.written], copies: [] })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX6 Р4 (в): a repeated read of unchanged content writes it nowhere — the theme saved over its moved key stays as it is, and a bare undo record keeps its id, read in place, one record each', async () => {
  const persisted = new Map<string, unknown>([[STORE_THEMES, { u: { palette: 'mono' } }], [STORE_UNDO, [UNDO_A, UNDO_B]]])
  const store = storeOf(persisted, { refuseDelete: (k) => k === STORE_THEMES || k === STORE_UNDO })
  // a bare record's stamp is its position in the array (#521 FIX8 Р2) — its id and content are what stays
  const recordsOf = (field: string): string[] => undoStack(persisted).filter((r) => r.fields.includes(field)).map((r) => JSON.stringify({ ...r, t: undefined }))
  try {
    const $ = standOf(async () => 'A', store)
    await command(boot(), $)
    await drainLong()
    expect(await SL.__saveTheme($, 'u')).toBe('тема «u» сохранена')
    const savedU = JSON.stringify(themeRecords(persisted).filter((r) => r.name === 'u'))
    expect(themeRecords(persisted).filter((r) => r.name === 'u').map((r) => r['palette'])).not.toEqual(['mono'])
    const movedB = recordsOf('numTokens')
    expect(movedB.length).toBe(1)
    // the previous version dropped A at its cap and pushed C: B keeps its content, not its index
    persisted.set(STORE_UNDO, [UNDO_B, UNDO_C])
    await command(boot(), standOf(async () => 'A', store))
    await drainLong()
    expect(JSON.stringify(themeRecords(persisted).filter((r) => r.name === 'u'))).toBe(savedU)
    expect(recordsOf('numTokens')).toEqual(movedB)
    expect(recordsOf('numPercent').length).toBe(1)
    expect(v3Keys(persisted, NS_UNDO)).toEqual([])
  } finally {
    SL.__resetState()
  }
})

// ---------- Р5: a save under a shadowed name updates the user's own theme ----------

test('#521 FIX6 Р5: a user theme «hud» listed as «hud (2)» saved under «hud» twice stays one user record «hud», updated', async () => {
  const persisted = new Map<string, unknown>([[STORE_THEMES + ':u1', { name: 'hud', palette: 'mono', t: 1 }]])
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted))
    await SL.restoreAfterReload($, {} as never)
    expect(Object.keys(snap()['userThemes'] as Record<string, unknown>)).toEqual(['hud (2)'])
    await SL.__saveTheme($, 'hud')
    await SL.__saveTheme($, 'hud')
    const mine = themeRecords(persisted).filter((r) => r.name === 'hud')
    expect(mine.map((r) => r.id)).toEqual(['u1'])
    expect(mine[0]!.t).not.toBe(1)
  } finally {
    SL.__resetState()
  }
})

// ---------- Р6: a refused timer cancel at a state reset is diagnosed ----------

test('#521 FIX6 Р6: a re-stamp timer whose cancel is refused at a state reset leaves one diagnostic in the new state', async () => {
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(new Map()))
    $.clock.every = () => ({ cancel() { throw new Error('cancel refused by the test') } })
    await command(h, $)
    await drainLong()
    expect(snap()['pickerOpen']).toBe(true)
    SL.__resetState()
    expect(SL.__diag().filter((d) => d.key === 'picker-keepalive-cancel').map((d) => d.kind)).toEqual(['info'])
  } finally {
    SL.__resetState()
  }
})

// ---------- FIX6b Б1: a close that lands during the open wins ----------

test('#521 FIX6b Б1: a close that lands at any await of /statusline-mod leaves no re-stamp timer, no open flag and no ui.open after it', async () => {
  let exercised = 0
  try {
    for (let k = 1; k <= 200; k++) {
      const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']], { numTokens: 'raw' }) }]])
      // the k-th host call of the command is held until the close has been issued
      const hold: { counting: boolean; calls: number; gate: Gate | null } = { counting: false, calls: 0, gate: null }
      const at = async (): Promise<void> => {
        if (!hold.counting) return
        hold.calls++
        if (hold.calls !== k) return
        hold.gate = gate()
        await hold.gate.p
      }
      const inner = storeOf(persisted)
      const store: StoreStand = {
        get: async (key) => { await at(); return inner.get(key) },
        set: async (key, v) => { await at(); return inner.set(key, v) },
        delete: async (key) => { await at(); return inner.delete(key) },
        keys: async () => { await at(); return inner.keys() },
      }
      const clock: Clock = { now: 5000, arms: [] }
      const $ = standOf(async () => { await at(); return 'A' }, store, clock)
      // each ui.open call records whether the panel was still open when it came
      const opens: boolean[] = []
      $.ui.open = async () => { opens.push(snap()['pickerOpen'] === true); await at() }
      const h = boot()
      hold.counting = true
      const opening = command(h, $)
      await drainLong()
      if (hold.gate === null) {
        await opening
        break
      }
      exercised++
      hold.counting = false
      const closing = SL.closeKeepDraft($)
      await drainLong()
      ;(hold.gate as Gate).open()
      await closing
      await opening
      await drainLong()
      expect({ k, timers: clock.arms.filter((a) => a.ms === DAY && !a.cancelled).length, flags: openFlags(persisted).length, open: snap()['pickerOpen'], opensAfterClose: opens.filter((was) => !was).length })
        .toEqual({ k, timers: 0, flags: 0, open: false, opensAfterClose: 0 })
    }
  } finally {
    SL.__resetState()
  }
  expect(exercised).toBeGreaterThan(5)
})

// ---------- FIX6b Б2: the content id is a 64-bit FNV-1a ----------

// the reference FNV-1a 64 over UTF-16 code units, checked on the published vectors
const fnv64 = (text: string): string => {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i++) hash = ((hash ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n) & 0xffffffffffffffffn
  return hash.toString(16).padStart(16, '0')
}

test('#521 FIX6b Б2: the id of a moved theme is legacy-<name>-<64-bit FNV-1a of its canonical JSON>', async () => {
  expect([fnv64(''), fnv64('a'), fnv64('foobar')]).toEqual(['cbf29ce484222325', 'af63dc4c8601ec8c', '85944171f73967e8'])
  const persisted = new Map<string, unknown>([[STORE_THEMES, { u: { palette: 'mono', caps: 'none' } }]])
  try {
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(themeRecords(persisted).map((r) => r.id)).toEqual(['legacy-u-' + fnv64('{"caps":"none","palette":"mono"}')])
  } finally {
    SL.__resetState()
  }
})

// ---------- FIX6b Б3: a refused ui.open answers the command with its reason ----------

test('#521 FIX6b Б3: a refused ui.open answers /statusline-mod with «Панель статус-строки не открылась: <reason>»', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted))
    $.ui.open = async () => { throw new Error('open refused by the test') }
    const answer = (await command(h, $)) as Record<string, unknown>
    const text = String(answer?.['text'] ?? '')
    expect({ keys: Object.keys(answer ?? {}), head: text.startsWith('Панель статус-строки не открылась: '), reason: text.includes('open refused by the test') }).toEqual({ keys: ['text'], head: true, reason: true })
  } finally {
    SL.__resetState()
  }
})

// ---------- FIX6b Б4: equal undo records stay apart ----------

test('#521 FIX6b Б4: two equal records of the bare undo array move as two records, and a repeated move keeps two', async () => {
  const persisted = new Map<string, unknown>([[STORE_UNDO, [UNDO_A, UNDO_A]]])
  const store = storeOf(persisted, { refuseDelete: (k) => k === STORE_UNDO })
  try {
    for (let pass = 1; pass <= 2; pass++) {
      await command(boot(), standOf(async () => 'A', store))
      await drainLong()
      expect({ pass, records: undoStack(persisted).length }).toEqual({ pass, records: 2 })
    }
  } finally {
    SL.__resetState()
  }
})

// ---------- FIX6b Б5: moved records keep the order of their source ----------

// CONSTRAINT (#521 FIX8 Р2): a moved record's stamp is its position minus the
// bare array's length — below zero, in source order
test('#521 FIX6b Б5: the moved undo records keep the order of the bare array, stamped below zero in source order', async () => {
  const persisted = new Map<string, unknown>([[STORE_UNDO, [UNDO_A, UNDO_B, UNDO_C]]])
  try {
    await command(boot(), standOf(async () => 'A', storeOf(persisted)))
    await drainLong()
    expect(undoStack(persisted).map((r) => ({ t: r.t, field: r.fields[0] }))).toEqual([{ t: -3, field: 'numUsd' }, { t: -2, field: 'numTokens' }, { t: -1, field: 'numPercent' }])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX6b Б5: a restore that drops one of two moved save marks says so once', async () => {
  // the previous version's move of its bare mark (stamp MOVED_MARK_T), and a
  // bare mark it wrote into the bare key its refused delete left
  const movedId = 'legacy-mark-0000000000000001'
  const persisted = new Map<string, unknown>([
    [STORE_SAVING + ':' + movedId, { saveId: movedId, t: -0.5, fields: ['numUsd'], values: { numUsd: 'short' } }],
    [STORE_SAVING, { fields: ['numTokens'], values: { numTokens: 'compact' } }],
  ])
  try {
    expect(saveMarks(persisted).length).toBe(2)
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(saveMarks(persisted).length).toBe(1)
    expect(SL.__diag().filter((d) => d.key === 'save-mark-moved-dropped').map((d) => d.kind)).toEqual(['info'])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX6b Б5: a moved save mark stays newer than every record of a full moved undo array — the unfinished save is reported', async () => {
  // 30 = UNDO_CAP, the length the previous version held its bare array to
  const full = Array.from({ length: 30 }, (_, i) => ({ fields: ['numUsd'], prev: { numUsd: 'exact' }, written: { numUsd: 'v' + String(i) } }))
  const persisted = new Map<string, unknown>([[STORE_UNDO, full], [STORE_SAVING, { fields: ['numUsd'], values: { numUsd: 'short' } }]])
  try {
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(undoStack(persisted).length).toBe(30)
    expect(snap()['saveResult']).toBe('не записано: numUsd')
  } finally {
    SL.__resetState()
  }
})

// ---------- FIX7 Р1: the moved mark's stamp does not hang on the bare array's length ----------

test('#521 FIX7 Р1: a moved save mark stays newer than a moved bare undo array of any length — the unfinished save is reported once and the mark stays', async () => {
  // 30 = UNDO_CAP; 31 and 40 are bare arrays longer than this version's cap
  // (another build's cap, a hand-edited store)
  for (const length of [0, 30, 31, 40]) {
    const bare = Array.from({ length }, (_, i) => ({ fields: ['numUsd'], prev: { numUsd: 'exact' }, written: { numUsd: 'v' + String(i) } }))
    const persisted = new Map<string, unknown>([[STORE_UNDO, bare], [STORE_SAVING, { fields: ['numUsd'], values: { numUsd: 'short' } }]])
    try {
      boot()
      await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
      expect({ length, records: undoStack(persisted).length, saveResult: snap()['saveResult'], unwritten: SL.__diag().filter((d) => d.key === 'save-unwritten').length, marks: saveMarks(persisted).length })
        .toEqual({ length, records: length, saveResult: 'не записано: numUsd', unwritten: 1, marks: 1 })
    } finally {
      SL.__resetState()
    }
  }
})

// ---------- FIX7 Р3: the open repeats a flag delete the close's refusal left ----------

test('#521 FIX7 Р3: a close that lands during the open\'s await after its flag write, whose own flag delete is refused, leaves the flag under its mark — the open deletes nothing after the close, the refusal is said once, and the reload deletes the flag as closed', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  // after the open's flag write lands, the next store call — the open's own —
  // is held; the first flag delete after `refuse` is armed is refused
  const hold: { landed: boolean; gate: Gate | null; refuse: boolean } = { landed: false, gate: null, refuse: false }
  const inner = storeOf(persisted, {
    refuseDelete: (k) => {
      if (!hold.refuse || !k.startsWith(NS_OPEN)) return false
      hold.refuse = false
      return true
    },
  })
  const at = async (): Promise<void> => {
    if (!hold.landed || hold.gate !== null) return
    hold.gate = gate()
    await hold.gate.p
  }
  const store: StoreStand = {
    get: async (k) => { await at(); return inner.get(k) },
    set: async (k, v) => {
      await at()
      await inner.set(k, v)
      if (k.startsWith(NS_OPEN)) hold.landed = true
    },
    delete: async (k) => { await at(); return inner.delete(k) },
    keys: async () => { await at(); return inner.keys() },
  }
  const refusals = (): number => SL.__diag().filter((d) => d.key === 'picker-close-store').length
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store)
    const opening = command(h, $)
    await drainLong()
    expect({ held: hold.gate !== null, flags: openFlags(persisted).length }).toEqual({ held: true, flags: 1 })
    hold.refuse = true
    await SL.closeKeepDraft($)
    expect({ flags: openFlags(persisted).length, refusals: refusals() }).toEqual({ flags: 1, refusals: 1 })
    hold.gate!.open()
    await opening
    await drainLong()
    // #551 §3.2 step 4, §3.6: after the close the open publishes and deletes nothing; its mark closes the flag it left
    expect({ flags: openFlags(persisted).length, open: snap()['pickerOpen'], refusals: refusals(), closed: closedMarks(persisted) }).toEqual({ flags: 1, open: false, refusals: 1, closed: ['A'] })
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted) }).toEqual({ open: false, flags: [] })
  } finally {
    SL.__resetState()
  }
})

// ---------- FIX8/FIX8b Р1: a session's close mark outlives a late flag write ----------

// CONSTRAINT (#521 FIX8 Р1, FIX8b Р1): boot() is the host's reload — a new
// state; a flag write begun in the old state lands after it, where no
// generation check of the new state reaches. A flag of session S stamped at
// or before S's close mark is closed
test('#521 FIX8 Р1 (а): a re-stamp whose flag write lands after a reload, the restore that reopened the panel and its close — the next reload keeps the panel closed, no flag, the session\'s close mark kept', async () => {
  const T0 = Date.now()
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: T0, ...body([['ctx']]) }]])
  const { store, arm, held } = heldFlagStore(persisted)
  const clock: Clock = { now: T0, arms: [] }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect(snap()['pickerOpen']).toBe(true)
    const token = String(idOf(openFlags(persisted)[0] ?? {}))
    arm()
    clock.now = T0 + DAY
    liveArms(clock)[0]!.fn()
    await drainLong()
    expect(held()).not.toBeNull()
    boot()
    // the new state's clock reads the instant the held write was stamped: the
    // close mark equals its stamp
    const $2 = standOf(async () => 'A', storeOf(persisted), { now: T0 + DAY, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId }).toEqual({ open: true, token })
    await SL.closeKeepDraft($2)
    expect(openFlags(persisted)).toEqual([])
    held()!.open()
    await drainLong()
    // the late write has landed: a publication of the open the close ended
    expect(openFlags(persisted).map(idOf)).toEqual([token])
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted), closed: closedMarks(persisted) }).toEqual({ open: false, flags: [], closed: ['A'] })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8 Р1 (б): an open whose flag write lands after its close and a reload — the next restore keeps the panel closed, no flag, the session\'s close mark kept', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  const { store, arm, held } = heldFlagStore(persisted)
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store)
    await SL.__pictureReadClock($)
    arm()
    const opening = command(h, $)
    await drainLong()
    expect(held()).not.toBeNull()
    const token = String(snap()['open']?.openId)
    await SL.closeKeepDraft($)
    expect(openFlags(persisted)).toEqual([])
    boot()
    held()!.open()
    await opening
    await drainLong()
    // the late write has landed after the reload: no check of the old state ran
    expect(openFlags(persisted).map(idOf)).toEqual([token])
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted), closed: closedMarks(persisted) }).toEqual({ open: false, flags: [], closed: ['A'] })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8 Р1 (в): a refused close-mark write at the close is said once, and the flag still goes', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  const store = storeOf(persisted, { refuseSet: (k) => k.startsWith(NS_MARK) })
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store)
    await command(h, $)
    await drainLong()
    expect(openFlags(persisted).length).toBe(1)
    await SL.closeKeepDraft($)
    const said = SL.__diag().filter((d) => d.key === 'picker-close-store')
    expect({ flags: openFlags(persisted), closed: closedMarks(persisted), said: said.length, kind: said[0]?.kind, reason: said[0]?.text.includes('refused by the test'), tail: said[0]?.text.includes('закрытая панель может открыться при перезагрузке, если запись флага была в пути') })
      .toEqual({ flags: [], closed: [], said: 1, kind: 'warn', reason: true, tail: true })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8 Р1 (г): a session\'s close mark older than 7 days leaves the store at the prune of an open, a fresh one stays', async () => {
  const T0 = Date.now()
  const persisted = new Map<string, unknown>([
    [draftKey('A'), { session: 'A', t: T0, ...body([['ctx']]) }],
    [STORE_OPEN_CLOSED + ':old', { t: T0 - 8 * DAY }],
    [STORE_OPEN_CLOSED + ':fresh', { t: T0 - DAY }],
  ])
  const clock: Clock = { now: T0, arms: [] }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect({ open: snap()['pickerOpen'], closed: closedMarks(persisted) }).toEqual({ open: true, closed: ['fresh'] })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8b Р1 (д): a re-open whose flag write lands after a reload, the restore that reopened the older token and its close — the next reload keeps the panel closed', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  const { store, arm, held } = heldFlagStore(persisted)
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    const t1 = String(snap()['open']?.openId)
    arm()
    // a second /statusline-mod while the panel is open: a new token, t2
    const reopening = command(h, $)
    await drainLong()
    const t2 = String(snap()['open']?.openId)
    expect({ held: held() !== null, fresh: t2 !== t1, flags: openFlags(persisted).map(idOf) }).toEqual({ held: true, fresh: true, flags: [t1] })
    boot()
    const $2 = standOf(async () => 'A', storeOf(persisted))
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId }).toEqual({ open: true, token: t1 })
    await SL.closeKeepDraft($2)
    held()!.open()
    await reopening
    await drainLong()
    // t2 landed: a token the closing state never knew
    expect(openFlags(persisted).map(idOf)).toEqual([t2])
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted), closed: closedMarks(persisted) }).toEqual({ open: false, flags: [], closed: ['A'] })
  } finally {
    SL.__resetState()
  }
})

// CONSTRAINT (#551 FIX9 Р5): a bare flag is epoch 0 — a new write of the
// previous version cannot be told from a move's remnant, so it opens the panel
// only in a session with no close mark
test('#521 FIX8b Р1 (е): a bare flag this version adopted and closed, then a bare flag the previous version wrote after the close — the bare flag is epoch 0, below the close mark, and the panel stays closed', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN, { session: 'A', token: 'tA', t: 5000 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    const moved = String(snap()['open']?.openId)
    expect({ open: snap()['pickerOpen'], legacy: moved === 'v1:legacy-A' }).toEqual({ open: true, legacy: true })
    await SL.closeKeepDraft($)
    expect(openFlags(persisted)).toEqual([])
    // the previous version opens the panel in A after the close
    persisted.set(STORE_OPEN, { session: 'A', token: 'tA2', t: 5500 })
    boot()
    const $2 = standOf(async () => 'A', storeOf(persisted), { now: 6000, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    // #551 D8: the previous version's record is read only — closed, it stays
    expect({ open: snap()['pickerOpen'], bare: persisted.has(STORE_OPEN), flags: openFlags(persisted), closed: closedMarks(persisted) }).toEqual({ open: false, bare: true, flags: [], closed: ['A'] })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8b Р1 (ж): two open flags of one session — the restore opens by the newest; once its copy landed the older publication goes, the previous version\'s record stays', async () => {
  const persisted = new Map<string, unknown>([
    [v3Key(NS_OPEN, 'A', EXT_WRITER, 1), { session: 'A', openId: 'tOld', e: 0, n: 1000, at: 1000 }],
    [STORE_OPEN + ':tNew', { session: 'A', token: 'tNew', t: 2000 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    // #551 D4, D8: the copy keeps the source's openId; only this version's sources go
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId, flags: openFlags(persisted).map(idOf) }).toEqual({ open: true, token: 'v1:tNew', flags: ['tNew', 'v1:tNew'] })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8b Р1 (з): with the stand clock fixed at 5000 a re-open in the millisecond of the close is stamped past the close mark — the reload opens the panel', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  const clock: Clock = { now: 5000, arms: [] }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    await SL.closeKeepDraft($)
    expect(openFlags(persisted)).toEqual([])
    await command(h, $)
    await drainLong()
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length }).toEqual({ open: true, flags: 1 })
    boot()
    const $2 = standOf(async () => 'A', storeOf(persisted), clock)
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length }).toEqual({ open: true, flags: 1 })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8b Р1 (и): the close mark of session A leaves the older flag of session B open', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN_CLOSED + ':A', { t: 9000 }],
    [STORE_OPEN + ':tB', { session: 'B', token: 'tB', t: 5000 }],
    [draftKey('B'), { session: 'B', t: 1, ...body([['ctx']]) }],
  ])
  try {
    boot()
    await SL.restoreAfterReload(standOf(async () => 'B', storeOf(persisted)), {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId, flags: openFlags(persisted).map(idOf), closed: closedMarks(persisted) }).toEqual({ open: true, token: 'v1:tB', flags: ['tB', 'v1:tB'], closed: ['A'] })
  } finally {
    SL.__resetState()
  }
})

// ---------- FIX8c Р1: the close is stamped past every flag, the flags past every mark ----------

test('#521 FIX8c Р1 (H): with the clock frozen, close → re-open → close → the re-open\'s late write lands after a reload — the next restore keeps the panel closed', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  const { store, arm, held } = heldFlagStore(persisted)
  const clock: Clock = { now: 5000, arms: [] }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    await SL.closeKeepDraft($)
    arm()
    // the re-open takes its counter after the first close's: its order is past that mark
    const reopening = command(h, $)
    await drainLong()
    expect(held()).not.toBeNull()
    const t2 = String(snap()['open']?.openId)
    await SL.closeKeepDraft($)
    boot()
    held()!.open()
    await reopening
    await drainLong()
    expect(openFlags(persisted).map(idOf)).toEqual([t2])
    const $2 = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted) }).toEqual({ open: false, flags: [] })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8c Р1 (K): a superseded token\'s late re-stamp, deleted by the re-check, leaves the re-opened panel open across a reload — only the close marks the session', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  const { store, arm, held } = heldFlagStore(persisted)
  const clock: Clock = { now: 5000, arms: [] }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    const t1 = String(snap()['open']?.openId)
    arm()
    liveArms(clock)[0]!.fn()
    await drainLong()
    expect(held()).not.toBeNull()
    await command(h, $)
    await drainLong()
    const t2 = String(snap()['open']?.openId)
    expect({ fresh: t2 !== t1, flags: openFlags(persisted).map(idOf) }).toEqual({ fresh: true, flags: [t2] })
    held()!.open()
    await drainLong()
    expect({ flags: openFlags(persisted).map(idOf), closed: closedMarks(persisted) }).toEqual({ flags: [t2], closed: [] })
    boot()
    const $2 = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId }).toEqual({ open: true, token: t2 })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8c Р1 (L): a new environment whose clock reads below a stored close mark stamps its open past the mark — the reload opens the panel', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN_CLOSED + ':A', { t: 5000 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 4000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    await command(h, $)
    await drainLong()
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length }).toEqual({ open: true, flags: 1 })
    boot()
    const $2 = standOf(async () => 'A', storeOf(persisted), { now: 4000, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length }).toEqual({ open: true, flags: 1 })
  } finally {
    SL.__resetState()
  }
})

// ---------- FIX8d: a moved bare flag is epoch 0, below any close mark; a record is damage only by the form of its order ----------

test('#521 FIX8d Р1 (M): a fresh bare flag read in a new environment of a session with a close mark stays closed, and stays whether the clock reads below the mark or past it', async () => {
  for (const now of [4000, 6000]) {
    const persisted = new Map<string, unknown>([
      [STORE_OPEN_CLOSED + ':A', { t: 5000 }],
      [STORE_OPEN, { session: 'A', token: 'tA', t: now }],
      [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
    ])
    try {
      boot()
      const $ = standOf(async () => 'A', storeOf(persisted), { now, arms: [] })
      await SL.__pictureReadClock($)
      await SL.restoreAfterReload($, {} as never)
      expect({ now, open: snap()['pickerOpen'], flags: openFlags(persisted), bare: persisted.has(STORE_OPEN) }).toEqual({ now, open: false, flags: [], bare: true })
    } finally {
      SL.__resetState()
    }
  }
})

// CONSTRAINT (#551 FIX9 Р1): the order is (e, n) — no stamp is judged against
// the clock; a record is damage only when its e or n is not a non-negative
// safe integer, said once per key as picker-order-damage:<key>
const KEEP = 7 * DAY
const futureSaid = (): Array<{ kind: string; text: string }> => SL.__diag().filter((d) => d.key === 'picker-order-damage')

test('#521 FIX8d Р2 (1): a close mark of the 0.5.1 form stamped 7 days and 1 ms past the stand clock is an ordinary mark — kept, nothing said, and the open after it opens the panel on the reload', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN_CLOSED + ':A', { t: 5000 + KEEP + 1 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    await command(h, $)
    await drainLong()
    expect({ open: snap()['pickerOpen'], closed: closedMarks(persisted), flags: openFlags(persisted).length, said: futureSaid().length })
      .toEqual({ open: true, closed: ['A'], flags: 1, said: 0 })
    boot()
    const $2 = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], closed: closedMarks(persisted), flags: openFlags(persisted).length, said: futureSaid().length })
      .toEqual({ open: true, closed: ['A'], flags: 1, said: 0 })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8d Р2 (2): an open flag of the 0.5.1 form stamped 7 days and 1 ms past the stand clock is from the future — kept, nothing said, the panel does not open by it (#551 D5)', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN + ':tF', { session: 'A', token: 'tF', t: 5000 + KEEP + 1 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId, flags: openFlags(persisted).map(idOf), said: futureSaid().length })
      .toEqual({ open: false, token: undefined, flags: ['tF'], said: 0 })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8d Р2 (4): a damaged close mark of the previous version (n = 1.5) is said once with its reason, not counted and stays — the flag below it stays open, restore after restore', async () => {
  const markKey = STORE_OPEN_CLOSED_V2 + ':A:1:x'
  const persisted = new Map<string, unknown>([
    [markKey, { session: 'A', e: 1, n: 1.5, at: 5000 }],
    [STORE_OPEN + ':tA', { session: 'A', token: 'tA', e: 1, n: 0, at: 5000 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  // #551 D7, D8: a damaged record of the previous version is never deleted — no delete of it is tried
  let markDeletes = 0
  const refusing = (): StoreStand => storeOf(persisted, { refuseDelete: (k) => (k === markKey ? (markDeletes++, true) : false) })
  try {
    for (let pass = 1; pass <= 2; pass++) {
      boot()
      const $ = standOf(async () => 'A', refusing(), { now: 5000, arms: [] })
      await SL.__pictureReadClock($)
      await SL.restoreAfterReload($, {} as never)
      const said = futureSaid()
      expect({ pass, open: snap()['pickerOpen'], token: snap()['open']?.openId, kept: persisted.has(markKey), said: said.length, kind: said[0]?.kind, key: said[0]?.text.includes(markKey), why: said[0]?.text.includes('n = 1.5'), far: said[0]?.text.includes('дальше'), stays: said[0]?.text.includes('запись не учитывается и остаётся'), markDeletes })
        .toEqual({ pass, open: true, token: 'v1:tA', kept: true, said: 1, kind: 'info', key: true, why: true, far: false, stays: true, markDeletes: 0 })
    }
  } finally {
    SL.__resetState()
  }
})

// ---------- FIX8 Р2: the order of moved records does not hang on the clock ----------

test('#521 FIX8 Р2: with the stand clock at 5000 a save mark of this version stays newer than a moved bare mark — the keyed one is judged and stays', async () => {
  const saveId = '5000-00000001'
  const persisted = new Map<string, unknown>([
    [STORE_SAVING, { fields: ['numUsd'], values: { numUsd: 'short' } }],
    [STORE_SAVING + ':' + saveId, { saveId, t: 5000, fields: ['numTokens'], values: { numTokens: 'compact' } }],
  ])
  const clock: Clock = { now: 5000, arms: [] }
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted), clock)
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    expect({ saveResult: snap()['saveResult'], marks: saveMarks(persisted).map((m) => m.saveId) }).toEqual({ saveResult: 'не записано: numTokens', marks: [saveId] })
  } finally {
    SL.__resetState()
  }
})

// ---------- #551 FIX9: the order of opens and closes is (epoch, counter), not the clock ----------

const draftA = (): [string, unknown] => [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]
// the prefix of both close-mark forms: the 0.5.1 one and this version's
const ANY_MARK = 'statusline.open-closed.'
const markKeys = (persisted: Map<string, unknown>): string[] => [...persisted.keys()].filter((k) => k.startsWith(ANY_MARK)).sort()

// the next close-mark write and the next flag write are each held once, when armed
const twoHolds = (persisted: Map<string, unknown>): { store: StoreStand; holdMark: () => void; holdFlag: () => void; mark: () => Gate | null; flag: () => Gate | null } => {
  const h = { mark: false, flag: false, markGate: null as Gate | null, flagGate: null as Gate | null }
  const store = storeOf(persisted, {
    holdSet: (k) => {
      if (h.mark && k.startsWith(ANY_MARK)) {
        h.mark = false
        h.markGate = gate()
        return h.markGate.p
      }
      if (h.flag && k.startsWith(NS_OPEN)) {
        h.flag = false
        h.flagGate = gate()
        return h.flagGate.p
      }
      return undefined
    },
  })
  return { store, holdMark: () => { h.mark = true }, holdFlag: () => { h.flag = true }, mark: () => h.markGate, flag: () => h.flagGate }
}

const reload = async (persisted: Map<string, unknown>, now = 5000, session = 'A'): Promise<void> => {
  boot()
  const $ = standOf(async () => session, storeOf(persisted), { now, arms: [] })
  await SL.__pictureReadClock($)
  await SL.restoreAfterReload($, {} as never)
}

test('#551 FIX9 F1: a close mark another environment writes between the two passes of a restore is below this environment\'s open — the open made after it opens the panel on the next reload', async () => {
  const markKey = STORE_OPEN_CLOSED + ':A'
  const persisted = new Map<string, unknown>([[markKey, { t: 5000 }], draftA()])
  const inner = storeOf(persisted)
  let sawMark = false
  let injected = false
  const store: StoreStand = {
    ...inner,
    get: async (k) => {
      if (k === markKey) sawMark = true
      return inner.get(k)
    },
    keys: async () => {
      if (sawMark && !injected) {
        injected = true
        persisted.set(markKey, { t: 6000 })
      }
      return inner.keys()
    },
  }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, { now: 4000, arms: [] })
    await SL.__pictureReadClock($)
    // the command's own restore reads the store, then writes the flag (gpt6 F1)
    await command(h, $)
    await drainLong()
    expect({ injected, open: snap()['pickerOpen'], flags: openFlags(persisted).length }).toEqual({ injected: true, open: true, flags: 1 })
    await reload(persisted, 4000)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length }).toEqual({ open: true, flags: 1 })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9 F2: a late re-stamp of an earlier environment whose clock ran ahead lands after this environment, its clock behind, closed the panel — the close is past it, the reload keeps the panel closed', async () => {
  const persisted = new Map<string, unknown>([draftA()])
  const { store, arm, held } = heldFlagStore(persisted)
  const clock: Clock = { now: 9000, arms: [] }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect(snap()['pickerOpen']).toBe(true)
    arm()
    liveArms(clock)[0]!.fn()
    await drainLong()
    expect(held()).not.toBeNull()
    await reload(persisted, 5000)
    expect(snap()['pickerOpen']).toBe(true)
    await SL.closeKeepDraft(standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] }))
    expect(openFlags(persisted)).toEqual([])
    held()!.open()
    await drainLong()
    expect(openFlags(persisted).length).toBe(1)
    await reload(persisted, 5000)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted), closed: closedMarks(persisted) }).toEqual({ open: false, flags: [], closed: ['A'] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9 F3: with the clock frozen, two closes whose mark writes land in reverse order and a re-open between them whose flag lands after a reload — every close keeps its own mark, the later one closes the flag', async () => {
  const persisted = new Map<string, unknown>([draftA()])
  const { store, holdMark, holdFlag, mark, flag } = twoHolds(persisted)
  const clock: Clock = { now: 5000, arms: [] }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    holdMark()
    const first = SL.closeKeepDraft($)
    await drainLong()
    expect(mark()).not.toBeNull()
    holdFlag()
    const reopening = command(h, $)
    await drainLong()
    expect(flag()).not.toBeNull()
    await SL.closeKeepDraft($)
    mark()!.open()
    await first
    await drainLong()
    boot()
    flag()!.open()
    await reopening
    await drainLong()
    expect(openFlags(persisted).length).toBe(1)
    await reload(persisted, 5000)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted), closed: closedMarks(persisted) }).toEqual({ open: false, flags: [], closed: ['A'] })
  } finally {
    SL.__resetState()
  }
})

// CONSTRAINT (gpt6 F4): the start is the close mark one ms before 7 days past
// the clock — the edge the removed «future» rule cut at
for (const [label, back] of [['the clock frozen', 5000], ['the clock stepped back', 1000]] as const) {
  test('#551 FIX9 F4: from a close mark 1 ms before 7 days past the clock, two cycles close → open with ' + label + ' — the reload opens the panel and nothing is dropped as damage', async () => {
    const persisted = new Map<string, unknown>([[STORE_OPEN_CLOSED + ':A', { t: 5000 + KEEP - 1 }], draftA()])
    const clock: Clock = { now: 5000, arms: [] }
    try {
      const h = boot()
      const $ = standOf(async () => 'A', storeOf(persisted), clock)
      await SL.__pictureReadClock($)
      await SL.restoreAfterReload($, {} as never)
      await command(h, $)
      await drainLong()
      await SL.closeKeepDraft($)
      await command(h, $)
      await drainLong()
      clock.now = back
      await SL.__pictureReadClock($)
      await SL.closeKeepDraft($)
      await command(h, $)
      await drainLong()
      expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length }).toEqual({ open: true, flags: 1 })
      await reload(persisted, back)
      // #551 D8: the 0.5.1 mark below this environment's one stays; one mark of this version
      expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length, closed: closedMarks(persisted), v3: v3Keys(persisted, NS_MARK).length, v1: persisted.has(STORE_OPEN_CLOSED + ':A'), said: futureSaid().length }).toEqual({ open: true, flags: 1, closed: ['A', 'A'], v3: 1, v1: true, said: 0 })
    } finally {
      SL.__resetState()
    }
  })
}

test('#551 FIX9 F5: a bare flag adopted as epoch 0 stays, then an open and a close — the next restore reads the same bare flag below the close, copies it nowhere, and the panel stays closed', async () => {
  const persisted = new Map<string, unknown>([[STORE_OPEN, { session: 'A', t: 5000 }], draftA()])
  const copies: Array<Record<string, unknown>> = []
  const recording = (o: StoreOpts): StoreStand => {
    const s = storeOf(persisted, o)
    return {
      ...s,
      set: async (k, v) => {
        if (k.startsWith(NS_OPEN) && (v as { openId?: unknown }).openId === 'v1:legacy-A') copies.push(JSON.parse(JSON.stringify(v)))
        return s.set(k, v)
      },
    }
  }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', recording({}), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    // the command's own restore adopts the bare flag; #551 D8: the bare flag stays
    await command(h, $)
    await drainLong()
    await SL.closeKeepDraft($)
    expect({ bare: persisted.has(STORE_OPEN), legacy: persisted.has(STORE_OPEN + ':legacy-A'), closed: closedMarks(persisted) }).toEqual({ bare: true, legacy: false, closed: ['A'] })
    boot()
    const $2 = standOf(async () => 'A', recording({}), { now: 4000, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted), bare: persisted.has(STORE_OPEN), copies: copies.map((m) => ({ session: m['session'], openId: m['openId'], e: m['e'], n: m['n'] })) })
      .toEqual({ open: false, flags: [], bare: true, copies: [{ session: 'A', openId: 'v1:legacy-A', e: 0, n: 0 }] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9 damage: a flag with e = -1, a close mark with n = 1.5 and one with e = 2**53, all of the previous version, stay at the restore, each said once with its reason, and counted nowhere — not in the rule, not in the epoch', async () => {
  const V2 = STORE_OPEN_CLOSED_V2
  const persisted = new Map<string, unknown>([
    [STORE_OPEN + ':tA', { session: 'A', token: 'tA', e: -1, n: 5, at: 1 }],
    [STORE_OPEN + ':tB', { session: 'B', token: 'tB', e: 1, n: 0, at: 1 }],
    [V2 + ':B:1:x', { session: 'B', e: 1, n: 1.5, at: 1 }],
    [STORE_OPEN + ':tC', { session: 'C', token: 'tC', e: 1, n: 1, at: 1 }],
    [V2 + ':C:big:0', { session: 'C', e: 2 ** 53, n: 0, at: 1 }],
    [draftKey('B'), { session: 'B', t: 1, ...body([['ctx']]) }],
  ])
  try {
    await reload(persisted, 5000, 'B')
    const said = futureSaid()
    const named = (key: string, why: string): boolean => said.filter((d) => d.text.includes(key) && d.text.includes(why)).length === 1
    expect({
      open: snap()['pickerOpen'],
      token: snap()['open']?.openId,
      flags: openFlags(persisted).map(idOf).sort(),
      marks: markKeys(persisted),
      said: said.length,
      reasons: [named(STORE_OPEN + ':tA', 'e = -1'), named(V2 + ':B:1:x', 'n = 1.5'), named(V2 + ':C:big:0', 'e = ' + String(2 ** 53))],
      far: said.some((d) => d.text.includes('дальше')),
      epoch: epochs(persisted),
    }).toEqual({ open: true, token: 'v1:tB', flags: ['tA', 'tB', 'tC', 'v1:tB'], marks: [V2 + ':B:1:x', V2 + ':C:big:0'], said: 3, reasons: [true, true, true], far: false, epoch: [2] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9 v1: flags and close marks of the 0.5.1 form are read as epoch 0 and ordered by t between themselves — a flag at its mark\'s t is closed; a flag of epoch 1 is open against a v1 mark', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN_CLOSED + ':A', { t: 7000 }],
    [STORE_OPEN + ':tA', { session: 'A', token: 'tA', t: 6000 }],
    [STORE_OPEN_CLOSED + ':B', { t: 7000 }],
    [STORE_OPEN + ':tB', { session: 'B', token: 'tB', t: 8000 }],
    [STORE_OPEN_CLOSED + ':C', { t: 9_000_000_000 }],
    [STORE_OPEN + ':tC', { session: 'C', token: 'tC', e: 1, n: 0, at: 1 }],
    [STORE_OPEN_CLOSED + ':D', { t: 7000 }],
    [STORE_OPEN + ':tD', { session: 'D', token: 'tD', t: 7000 }],
    [draftKey('C'), { session: 'C', t: 1, ...body([['ctx']]) }],
  ])
  try {
    await reload(persisted, 5000, 'C')
    // #551 D8: the previous version's records are read only — closed ones stay
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId, flags: openFlags(persisted).map(idOf).sort(), closed: closedMarks(persisted) })
      .toEqual({ open: true, token: 'v1:tC', flags: ['tA', 'tB', 'tC', 'tD', 'v1:tC'], closed: ['A', 'B', 'C', 'D'] })
    const opens: Record<string, unknown> = {}
    for (const session of ['A', 'B', 'D']) {
      await reload(persisted, 5000, session)
      opens[session] = snap()['pickerOpen']
    }
    expect(opens).toEqual({ A: false, B: true, D: false })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9 Р3: the restore deletes every close mark of this version below its session\'s greatest one of any form, the previous version\'s stay; a refused delete is said once and the rule stands', async () => {
  const V2 = STORE_OPEN_CLOSED_V2
  const low = v3Key(NS_MARK, 'A', EXT_WRITER, 1)
  const refused = v3Key(NS_MARK, 'A', EXT_WRITER, 2)
  const persisted = new Map<string, unknown>([
    [STORE_OPEN_CLOSED + ':A', { t: 50 }],
    [V2 + ':A:1:0', { session: 'A', e: 1, n: 0, at: 1 }],
    [low, { session: 'A', e: 1, n: 1, at: 1 }],
    [refused, { session: 'A', e: 1, n: 3, at: 1 }],
    [V2 + ':A:2:0', { session: 'A', e: 2, n: 0, at: 1 }],
    [STORE_OPEN + ':tA', { session: 'A', token: 'tA', e: 1, n: 9, at: 1 }],
    draftA(),
  ])
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted, { refuseDelete: (k) => k === refused }), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    const said = SL.__diag().filter((d) => d.key === 'picker-close-mark-old')
    // #551 D8: the previous version's marks and its closed flag stay
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).map(idOf), marks: markKeys(persisted), said: said.length, reason: said[0]?.text.includes('refused by the test') })
      .toEqual({ open: false, flags: ['tA'], marks: [STORE_OPEN_CLOSED + ':A', V2 + ':A:1:0', V2 + ':A:2:0', refused].sort(), said: 1, reason: true })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9 Р3: a close mark of this version older than 7 days by its at leaves the store at the prune of an open, a fresh one stays', async () => {
  const T0 = Date.now()
  const V2 = STORE_OPEN_CLOSED_V2
  const persisted = new Map<string, unknown>([
    [draftKey('A'), { session: 'A', t: T0, ...body([['ctx']]) }],
    [V2 + ':old:1:0', { session: 'old', e: 1, n: 0, at: T0 - 8 * DAY }],
    [V2 + ':fresh:1:0', { session: 'fresh', e: 1, n: 0, at: T0 - DAY }],
  ])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: T0, arms: [] })
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect({ open: snap()['pickerOpen'], marks: markKeys(persisted) }).toEqual({ open: true, marks: [V2 + ':fresh:1:0'] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9 Р1 epoch: the first restore takes E = the greatest epoch of the epoch key, the flags and the marks it read, plus 1, and stores it before the first flag write — the open is written at E', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_EPOCH, { e: 4 }],
    [STORE_OPEN + ':tX', { session: 'X', token: 'tX', e: 6, n: 2, at: 1 }],
    [STORE_OPEN_CLOSED_V2 + ':Y:5:0', { session: 'Y', e: 5, n: 0, at: 1 }],
    draftA(),
  ])
  const inner = storeOf(persisted)
  const sets: string[] = []
  const epochs: unknown[] = []
  const store: StoreStand = {
    ...inner,
    set: async (k, v) => {
      sets.push(k)
      if (k.startsWith(NS_EPOCH)) epochs.push((v as { e?: unknown }).e)
      return inner.set(k, v)
    },
  }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    const mine = openFlags(persisted).filter((f) => f.session === 'A')
    const epochAt = sets.findIndex((k) => k.startsWith(NS_EPOCH))
    const flagAt = sets.findIndex((k) => k.startsWith(NS_OPEN))
    // CONSTRAINT (#551 FIX9c Р1): a later pass raises the epoch past what it
    // reads — the first stored epoch is the bootstrap's own
    expect({ epochs, before: epochAt >= 0 && epochAt < flagAt, e: mine.map((f) => f.e) }).toEqual({ epochs: [7], before: true, e: [7] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9 Р8: a close whose mark write lands after a new generation of the same environment deletes no flag after it — the mark closes the flag, and the reload keeps the panel closed', async () => {
  const persisted = new Map<string, unknown>([draftA()])
  const { store, holdMark, mark } = twoHolds(persisted)
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    const token = String(snap()['open']?.openId)
    holdMark()
    const closing = SL.closeKeepDraft($)
    await drainLong()
    expect(mark()).not.toBeNull()
    // a new generation of the same environment: the order epoch and counter stay
    SL.register((() => undefined) as never, {} as never)
    mark()!.open()
    await closing
    await drainLong()
    expect({ flags: openFlags(persisted).map(idOf), closed: closedMarks(persisted) }).toEqual({ flags: [token], closed: ['A'] })
    await reload(persisted)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted) }).toEqual({ open: false, flags: [] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9 Р9: the refusal texts say what the store keeps — a flag the close could not delete under a landed mark, or with no mark, and the flags the prune at an open owns', async () => {
  const OWNED = 'перестаёт открывать панель через 3 суток после последней записи и удаляется при открытии панели, кроме записей сессии, чья панель сейчас открыта'
  const texts = (key: string): string[] => SL.__diag().filter((d) => d.key === key).map((d) => d.text)
  try {
    // the close's mark landed, the flag delete refused
    {
      const persisted = new Map<string, unknown>([draftA()])
      let refuse = false
      const h = boot()
      const $ = standOf(async () => 'A', storeOf(persisted, { refuseDelete: (k) => refuse && k.startsWith(NS_OPEN) }))
      await command(h, $)
      await drainLong()
      refuse = true
      await SL.closeKeepDraft($)
      expect(texts('picker-close-store').map((t) => t.endsWith('; отметка закрывает его — перезагрузка панель не откроет; флаг удаляется перезагрузкой, если удаление пройдёт'))).toEqual([true])
    }
    // the mark refused as well
    {
      const persisted = new Map<string, unknown>([draftA()])
      let refuse = false
      const h = boot()
      const $ = standOf(async () => 'A', storeOf(persisted, { refuseDelete: (k) => refuse && k.startsWith(NS_OPEN), refuseSet: (k) => refuse && k.startsWith(ANY_MARK) }))
      await command(h, $)
      await drainLong()
      refuse = true
      await SL.closeKeepDraft($)
      expect(texts('picker-close-store').filter((t) => t.startsWith('the picker open flag could not be cleared')).map((t) => t.endsWith('; перезагрузка может открыть панель'))).toEqual([true])
    }
    // a closed flag the restore could not delete
    {
      const closed = v3Key(NS_OPEN, 'A', EXT_WRITER, 1)
      const persisted = new Map<string, unknown>([[STORE_OPEN_CLOSED + ':A', { t: 7000 }], [closed, { session: 'A', openId: 'tA', e: 0, n: 6000, at: 1 }], draftA()])
      boot()
      await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted, { refuseDelete: (k) => k === closed })), {} as never)
      expect(texts('picker-closed-flag').map((t) => t.endsWith(OWNED))).toEqual([true])
    }
    // an older flag of the session the restore could not delete
    {
      const older = v3Key(NS_OPEN, 'A', EXT_WRITER, 1)
      const persisted = new Map<string, unknown>([[older, { session: 'A', openId: 'tOld', e: 0, n: 1000, at: 1 }], [v3Key(NS_OPEN, 'A', EXT_WRITER, 2), { session: 'A', openId: 'tNew', e: 0, n: 2000, at: 1 }], draftA()])
      boot()
      await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted, { refuseDelete: (k) => k === older })), {} as never)
      expect(texts('picker-open-flag-old').map((t) => t.endsWith(OWNED))).toEqual([true])
    }
    // the previous open's flag a re-open could not delete
    {
      const persisted = new Map<string, unknown>([draftA()])
      let refuse = false
      const h = boot()
      const $ = standOf(async () => 'A', storeOf(persisted, { refuseDelete: (k) => refuse && k.startsWith(NS_OPEN) }))
      await command(h, $)
      await drainLong()
      refuse = true
      await command(h, $)
      await drainLong()
      // the retired open's publication, and the re-open's own earlier one its re-stamp at the draft write could not delete (#551 D2)
      expect(texts('picker-open-flag-old').map((t) => [t.slice(0, t.indexOf(' could not')), t.endsWith(OWNED)]).sort()).toEqual([['an older open flag of this session', true], ['the flag of the previous open', true]])
    }
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9b AR4: a flag of the session before a rebind that the close could not delete is not under the close\'s mark — its refusal says the reload may open the panel, and the reload in that session does', async () => {
  const persisted = new Map<string, unknown>()
  // open T1 is another environment's publication, adopted by the restore; the flags of A left are the adoption's copy
  const t1 = v3Key(NS_OPEN, 'A', EXT_WRITER, 1)
  const ofA = (k: string): boolean => k.startsWith(NS_OPEN + '.' + fnv64('A') + ':')
  let refuse = false
  const store = storeOf(persisted, { refuseDelete: (k) => refuse && ofA(k) })
  const session = { id: 'A' }
  try {
    SL.__resetState()
    persisted.set(t1, { session: 'A', openId: 't1', e: 0, n: 1, at: 1 })
    persisted.set(draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) })
    const $ = standOf(async () => session.id, store)
    await restoreIn($)
    expect(persisted.has(t1)).toBe(false)
    SL.__render({})
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('A')
    refuse = true
    session.id = 'B'
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('B')
    await SL.closeKeepDraft($)
    const cleared = SL.__diag().filter((d) => d.key === 'picker-close-store' && d.text.startsWith('the picker open flag could not be cleared')).map((d) => d.text)
    expect({ kept: v3Keys(persisted, NS_OPEN, 'A').length, closed: closedMarks(persisted), said: cleared.map((t) => t.endsWith('; перезагрузка может открыть панель')) }).toEqual({ kept: 1, closed: ['B'], said: [true] })
    await reload(persisted, 5000, 'A')
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId }).toEqual({ open: true, token: 't1' })
  } finally {
    SL.__resetState()
  }
})

// ---------- #551 FIX9c: the epoch past every record read; a write at an epoch after its key landed ----------

const V2K = STORE_OPEN_CLOSED_V2
// a new generation of the same environment: register without the module reset —
// the order epoch, the counter and the epoch write in flight stay
const regen = (): Handlers => {
  const handlers: Handlers = {}
  const on = (event: string, ...rest: unknown[]): void => { handlers[event] = rest[rest.length - 1] as never }
  SL.register(on as never, {} as never)
  return handlers
}
const saidOf = (key: string): Array<{ kind: string; text: string }> => SL.__diag().filter((d) => d.key === key)
// the greatest epoch of this version's epoch records; undefined — none
const epochOf = (persisted: Map<string, unknown>): number | undefined => {
  const es = v3Keys(persisted, NS_EPOCH).map((k) => (persisted.get(k) as { e?: unknown } | undefined)?.e).filter((e): e is number => typeof e === 'number')
  return es.length > 0 ? Math.max(...es) : undefined
}

test('#551 FIX9c Р1: a close mark of a later epoch another environment writes between the two passes of a restore raises this environment\'s epoch past it — the open made after it opens the panel on the next reload', async () => {
  const markKey = V2K + ':A:3:2'
  const persisted = new Map<string, unknown>([[STORE_EPOCH, { e: 1, at: 1 }], draftA()])
  const race = { armed: false, done: false }
  const store = interleaved(storeOf(persisted), (call, key) => {
    if (call === 'get' && key === STORE_EPOCH) race.armed = true
    if (call === 'keys' && race.armed && !race.done) {
      race.done = true
      persisted.set(markKey, { session: 'A', e: 3, n: 2, at: 5000 })
    }
  })
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    // the command's own restore takes E = 2, then its second pass reads (3, 2) (gpt6 F1)
    await command(h, $)
    await drainLong()
    expect({ raced: race.done, open: snap()['pickerOpen'], e: openFlags(persisted).map((f) => f.e) }).toEqual({ raced: true, open: true, e: [4] })
    await reload(persisted)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length, marks: markKeys(persisted) }).toEqual({ open: true, flags: 1, marks: [markKey] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9c Р2: a close mark the restore listed is gone when it reads it — another restore deleted it below a greater mark written meanwhile; the restore lists the keys again and the flag the lost mark closed stays closed', async () => {
  // publications of this version by other environments: the ones a restore deletes
  const m1 = v3Key(NS_MARK, 'A', EXT_WRITER, 1)
  const m2 = v3Key(NS_MARK, 'A', EXT_WRITER, 2)
  const m3 = v3Key(NS_MARK, 'A', EXT_WRITER, 3)
  const persisted = new Map<string, unknown>([
    [m1, { session: 'A', e: 1, n: 1, at: 5000 }],
    [m2, { session: 'A', e: 1, n: 3, at: 5000 }],
    [v3Key(NS_OPEN, 'A', EXT_WRITER, 4), { session: 'A', openId: 'tf', e: 1, n: 2, at: 5000 }],
    draftA(),
  ])
  // the first read of m2 is the epoch pass's; before the second, the restore
  // pass's, m3 lands and another restore deletes m2 below it (gpt6 F2)
  const race = { reads: 0, done: false }
  const store = interleaved(storeOf(persisted), (call, key) => {
    if (call !== 'get' || key !== m2 || ++race.reads !== 2) return
    race.done = true
    persisted.set(m3, { session: 'A', e: 3, n: 0, at: 5000 })
    persisted.delete(m2)
  })
  try {
    boot()
    const $ = standOf(async () => 'A', store, { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    expect({ raced: race.done, open: snap()['pickerOpen'], flags: openFlags(persisted), marks: markKeys(persisted) }).toEqual({ raced: true, open: false, flags: [], marks: [m3] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9c Р3: a close whose mark is refused and whose draft write lands after a new generation of the same environment took the open flag over — the old close stamps nothing and deletes nothing; the flag stays and the new generation\'s panel is open', async () => {
  const persisted = new Map<string, unknown>([draftA()])
  const hold = { refuseMark: false, draft: false, gate: null as Gate | null }
  const store = storeOf(persisted, {
    refuseSet: (k) => hold.refuseMark && k.startsWith(ANY_MARK),
    holdSet: (k) => {
      if (!hold.draft || !k.startsWith(NS_DRAFT + '.' + fnv64('A') + ':')) return undefined
      hold.draft = false
      hold.gate = gate()
      return hold.gate.p
    },
  })
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    const token = String(snap()['open']?.openId)
    hold.refuseMark = true
    hold.draft = true
    const closing = SL.closeKeepDraft($)
    await drainLong()
    expect(hold.gate).not.toBeNull()
    regen()
    await SL.restoreAfterReload($, {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId }).toEqual({ open: true, token })
    hold.gate!.open()
    await closing
    await drainLong()
    expect({ flags: openFlags(persisted).map(idOf), open: snap()['pickerOpen'], token: snap()['open']?.openId }).toEqual({ flags: [token], open: true, token })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9c Р4: an epoch key of the previous version at Number.MAX_SAFE_INTEGER is damage — said, counted nowhere and left in place; the open takes a valid epoch, and the next reload keeps the panel open', async () => {
  const persisted = new Map<string, unknown>([[STORE_EPOCH, { e: Number.MAX_SAFE_INTEGER, at: 1 }], draftA()])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    const said = futureSaid().filter((d) => d.text.includes(STORE_EPOCH))
    // #551 D7, D8: the previous version's epoch key is read only
    expect({ open: snap()['pickerOpen'], e: openFlags(persisted).map((f) => f.e), epoch: epochOf(persisted), kept: (persisted.get(STORE_EPOCH) as { e?: unknown })?.e, said: said.length }).toEqual({ open: true, e: [1], epoch: 1, kept: Number.MAX_SAFE_INTEGER, said: 1 })
    await reload(persisted)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length }).toEqual({ open: true, flags: 1 })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9c Р5: five cycles open → close in one state leave no retired open behind', async () => {
  const persisted = new Map<string, unknown>([draftA()])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted))
    for (let i = 0; i < 5; i++) {
      await command(h, $)
      await drainLong()
      await SL.closeKeepDraft($)
    }
    // #551 §3.6: an open whose publications are all deleted leaves S.retired
    expect({ retired: (snap()['retired'] as unknown[]).length, state: snap()['open']?.state }).toEqual({ retired: 0, state: 'closed' })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9c Р7: a close mark of the 0.5.1 form of the session whose panel is open, older than 7 days, stays at the prune of the open — its session is its key\'s; another session\'s goes', async () => {
  const T0 = Date.now()
  const markKey = STORE_OPEN_CLOSED + ':A'
  const persisted = new Map<string, unknown>([
    [draftKey('A'), { session: 'A', t: T0, ...body([['ctx']]) }],
    [markKey, { t: T0 - 8 * DAY }],
    [STORE_OPEN_CLOSED + ':old', { t: T0 - 8 * DAY }],
  ])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: T0, arms: [] })
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect({ open: snap()['pickerOpen'], marks: markKeys(persisted) }).toEqual({ open: true, marks: [markKey] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9c Р10: five closes of one session in one environment with no restore between them leave one close mark of this version', async () => {
  const persisted = new Map<string, unknown>([draftA()])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted))
    for (let i = 0; i < 5; i++) {
      await command(h, $)
      await drainLong()
      await SL.closeKeepDraft($)
    }
    expect({ marks: v3Keys(persisted, NS_MARK).length, flags: openFlags(persisted) }).toEqual({ marks: 1, flags: [] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9c Р11: the epoch key refused — the open\'s flag write is refused with «эпоха не записана», said once; the store back, the next open stores the epoch, then its flag, and the reload opens the panel', async () => {
  const persisted = new Map<string, unknown>([draftA()])
  const down = { on: true }
  // every epoch key write this environment tries, refused or not (#551 FIX9f Р6)
  const epochWrites: unknown[] = []
  const inner = storeOf(persisted, { refuseSet: (k) => down.on && k.startsWith(NS_EPOCH) })
  const store: StoreStand = {
    ...inner,
    set: async (k, v) => {
      if (k.startsWith(NS_EPOCH)) epochWrites.push((v as { e?: unknown }).e)
      return inner.set(k, v)
    },
  }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    const said = saidOf('picker-epoch-store')
    const flagSaid = saidOf('picker-open-flag')
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length, stored: v3Keys(persisted, NS_EPOCH).length > 0, said: said.length, kind: said[0]?.kind, text: said[0]?.text.startsWith('эпоха не записана: '), reason: said[0]?.text.includes('refused by the test'), flag: flagSaid.some((d) => d.text.includes('эпоха не записана: ')) })
      .toEqual({ open: true, flags: 0, stored: false, said: 1, kind: 'warn', text: true, reason: true, flag: true })
    down.on = false
    await command(h, $)
    await drainLong()
    // the bootstrap took epoch 1 though its key write was refused: the refused
    // repeat and the one that landed are at 1, and no bootstrap took another
    expect({ epoch: epochOf(persisted), e: openFlags(persisted).map((f) => f.e), tried: [...epochWrites] }).toEqual({ epoch: 1, e: [1], tried: [1, 1, 1] })
    await reload(persisted)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length }).toEqual({ open: true, flags: 1 })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9c Р11: a new generation of the same environment whose restore meets the first restore\'s epoch write in flight waits for it — no flag while it is held, and the flag lands after the epoch key', async () => {
  const persisted = new Map<string, unknown>([draftA()])
  const landed: string[] = []
  const hold = { armed: true, gate: null as Gate | null }
  const inner = storeOf(persisted, {
    holdSet: (k) => {
      if (!hold.armed || !k.startsWith(NS_EPOCH)) return undefined
      hold.armed = false
      hold.gate = gate()
      return hold.gate.p
    },
  })
  const store: StoreStand = { ...inner, set: async (k, v) => { await inner.set(k, v); landed.push(k) } }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store)
    const first = command(h, $)
    await drainLong()
    expect(hold.gate).not.toBeNull()
    const h2 = regen()
    const second = command(h2, $)
    await drainLong()
    const during = openFlags(persisted).length
    hold.gate!.open()
    await first
    await second
    await drainLong()
    const epochAt = landed.findIndex((k) => k.startsWith(NS_EPOCH))
    const flagAt = landed.findIndex((k) => k.startsWith(NS_OPEN))
    expect({ during, before: epochAt >= 0 && epochAt < flagAt, e: openFlags(persisted).map((f) => f.e), open: snap()['pickerOpen'] }).toEqual({ during: 0, before: true, e: [1], open: true })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9c Р12: a damaged epoch key of the previous version (e = "x") is said once as damage and stays; it counts as absent — the epoch is past the records alone', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_EPOCH, { e: 'x', at: 1 }],
    [STORE_OPEN + ':tB', { session: 'B', token: 'tB', e: 2, n: 0, at: 5000 }],
    draftA(),
  ])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    const said = futureSaid().filter((d) => d.text.includes(STORE_EPOCH))
    expect({ said: said.length, why: said[0]?.text.includes('e = "x"'), kept: persisted.has(STORE_EPOCH), epoch: epochOf(persisted), e: openFlags(persisted).filter((f) => f.session === 'A').map((f) => f.e) })
      .toEqual({ said: 1, why: true, kept: true, epoch: 3, e: [3] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9c Р13: a close mark of the FIX9 form is its key\'s — a value naming another session or order, or holding one of e and n, is damage: said, counted nowhere, and it stays (#551 D8)', async () => {
  const other = V2K + ':A:5:0'
  const half = V2K + ':A:1:0'
  const persisted = new Map<string, unknown>([
    [other, { session: 'B', e: 9, n: 0, at: 5000 }],
    [half, { session: 'A', n: 0, at: 5000 }],
    [STORE_OPEN + ':tB', { session: 'B', token: 'tB', e: 1, n: 0, at: 5000 }],
    [draftKey('B'), { session: 'B', t: 1, ...body([['ctx']]) }],
  ])
  try {
    await reload(persisted, 5000, 'B')
    const said = futureSaid()
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId, marks: markKeys(persisted), said: said.map((d) => [other, half].findIndex((k) => d.text.includes(k))).sort() })
      .toEqual({ open: true, token: 'v1:tB', marks: [half, other], said: [0, 1] })
  } finally {
    SL.__resetState()
  }
})

// ---------- #551 FIX9d: a spent order refuses the writes, it damages nothing ----------

const MAX1 = Number.MAX_SAFE_INTEGER - 1

test('#551 FIX9d AR1: an epoch key at Number.MAX_SAFE_INTEGER - 1 is valid and no epoch is past it — the open and the close are refused as «порядок исчерпан», said once; the key and the records stay, and no panel opens falsely', async () => {
  const markC = V2K + ':C:' + String(MAX1) + ':0'
  const persisted = new Map<string, unknown>([
    [STORE_EPOCH, { e: MAX1, at: 1 }],
    [STORE_OPEN + ':tB', { session: 'B', token: 'tB', e: MAX1, n: 0, at: 5000 }],
    [markC, { session: 'C', e: MAX1, n: 0, at: 5000 }],
    [draftKey('B'), { session: 'B', t: 1, ...body([['ctx']]) }],
    draftA(),
  ])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    await SL.closeKeepDraft($)
    const spent = SL.__diag().filter((d) => d.text.includes('порядок исчерпан'))
    expect({
      flagsA: openFlags(persisted).filter((f) => f.session === 'A').length,
      marks: markKeys(persisted),
      epoch: persisted.get(STORE_EPOCH),
      tB: persisted.get(STORE_OPEN + ':tB'),
      said: spent.filter((d) => d.key === 'picker-order-spent').length,
      flag: spent.some((d) => d.key === 'picker-open-flag'),
      mark: spent.some((d) => d.key === 'picker-close-store'),
      damage: futureSaid().length,
    }).toEqual({
      flagsA: 0,
      marks: [markC],
      epoch: { e: MAX1, at: 1 },
      tB: { session: 'B', token: 'tB', e: MAX1, n: 0, at: 5000 },
      said: 1,
      flag: true,
      mark: true,
      damage: 0,
    })
    await reload(persisted)
    expect(snap()['pickerOpen']).toBe(false)
    await reload(persisted, 5000, 'B')
    expect({ open: snap()['pickerOpen'], token: snap()['open']?.openId }).toEqual({ open: true, token: 'v1:tB' })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9d AR5: the write counter at Number.MAX_SAFE_INTEGER — the open\'s flag write is refused as «порядок исчерпан», said once, and no flag is written', async () => {
  const persisted = new Map<string, unknown>([draftA()])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    SL.__setOrderN(Number.MAX_SAFE_INTEGER)
    await command(h, $)
    await drainLong()
    expect({
      flags: openFlags(persisted).length,
      said: saidOf('picker-order-spent').length,
      flag: saidOf('picker-open-flag').some((d) => d.text.includes('порядок исчерпан')),
    }).toEqual({ flags: 0, said: 1, flag: true })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9e Р1 at the limit: an environment with epoch 1 reads, on the restore pass, a close mark another environment wrote at Number.MAX_SAFE_INTEGER - 1 — no epoch is raised to the limit; the open and the close are refused as «порядок исчерпан», said once, and the mark stays, not dropped as damage', async () => {
  const markC = V2K + ':C:' + String(MAX1) + ':0'
  const valueC = { session: 'C', e: MAX1, n: 0, at: 5000 }
  const persisted = new Map<string, unknown>([draftA()])
  // the bootstrap stores epoch 1; before the restore pass lists the keys, C's mark lands
  const race = { armed: false, done: false }
  const store = interleaved(storeOf(persisted), (call, key) => {
    if (call === 'set' && key.startsWith(NS_EPOCH)) race.armed = true
    if (call === 'keys' && race.armed && !race.done) {
      race.done = true
      persisted.set(markC, valueC)
    }
  })
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    await SL.closeKeepDraft($)
    const spent = SL.__diag().filter((d) => d.text.includes('порядок исчерпан'))
    expect({
      raced: race.done,
      epoch: epochOf(persisted),
      flagsA: openFlags(persisted).filter((f) => f.session === 'A').length,
      marks: markKeys(persisted),
      c: persisted.get(markC),
      said: spent.filter((d) => d.key === 'picker-order-spent').length,
      flag: spent.some((d) => d.key === 'picker-open-flag'),
      mark: spent.some((d) => d.key === 'picker-close-store'),
      damage: futureSaid().length,
    }).toEqual({ raced: true, epoch: 1, flagsA: 0, marks: [markC], c: valueC, said: 1, flag: true, mark: true, damage: 0 })
    await reload(persisted)
    expect({ open: snap()['pickerOpen'], marks: markKeys(persisted), c: persisted.get(markC), damage: futureSaid().length }).toEqual({ open: false, marks: [markC], c: valueC, damage: 0 })
  } finally {
    SL.__resetState()
  }
})

// ---------- #551 FIX9f: a listed flag gone at its read; the epoch key never goes down; a stale state's writes ----------

test('#551 FIX9f Р1: an open flag the restore listed is gone when it reads it — another restore deleted it under a close mark written meanwhile; the restore lists the keys again, and the other flag of the session is closed by that mark and deleted', async () => {
  // publications of this version by other environments: the ones a restore deletes
  const f1 = v3Key(NS_OPEN, 'A', EXT_WRITER, 1)
  const f2 = v3Key(NS_OPEN, 'A', EXT_WRITER, 2)
  const m = v3Key(NS_MARK, 'A', EXT_WRITER, 3)
  const persisted = new Map<string, unknown>([
    [v3Key(NS_EPOCH, undefined, EXT_WRITER, 4), { e: 1, at: 1 }],
    [f1, { session: 'A', openId: 'f1', e: 1, n: 1, at: 5000 }],
    [f2, { session: 'A', openId: 'f2', e: 1, n: 2, at: 5000 }],
    draftA(),
  ])
  // the first read of f2 is the epoch pass's; before the second, the restore
  // pass's, a close of session A marks past both flags and another restore
  // deletes f2 under that mark (swe2 F1)
  const race = { reads: 0, done: false }
  const store = interleaved(storeOf(persisted), (call, key) => {
    if (call !== 'get' || key !== f2 || ++race.reads !== 2) return
    race.done = true
    persisted.set(m, { session: 'A', e: 3, n: 0, at: 5000 })
    persisted.delete(f2)
  })
  try {
    boot()
    const $ = standOf(async () => 'A', store, { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    expect({ raced: race.done, open: snap()['pickerOpen'], flags: openFlags(persisted), marks: markKeys(persisted) }).toEqual({ raced: true, open: false, flags: [], marks: [m] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9f Р2: two restores of one generation bootstrap at once, the second past a flag written between their reads — its greater epoch key write goes first, the lesser one waits for it and writes nothing; the stored key is the greater', async () => {
  const flagB = STORE_OPEN + ':tB'
  const persisted = new Map<string, unknown>([[STORE_EPOCH, { e: 1, at: 1 }], draftA()])
  const inner = storeOf(persisted)
  const epochSets: Array<{ e: unknown; gate: Gate }> = []
  const hold = { get: null as Gate | null }
  const store: StoreStand = {
    ...inner,
    // the first restore's read of the epoch key waits; meanwhile another
    // environment writes a flag at epoch 5, which only the second restore lists
    get: async (k) => {
      if (k === STORE_EPOCH && hold.get === null) {
        hold.get = gate()
        persisted.set(flagB, { session: 'B', token: 'tB', e: 5, n: 0, at: 5000 })
        await hold.get.p
      }
      return inner.get(k)
    },
    // every epoch key write waits until the stand lets it through
    set: async (k, v) => {
      if (k.startsWith(NS_EPOCH)) {
        const held = gate()
        epochSets.push({ e: (v as { e?: unknown }).e, gate: held })
        await held.p
      }
      return inner.set(k, v)
    },
  }
  try {
    boot()
    const $ = standOf(async () => 'A', store, { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    const first = SL.restoreAfterReload($, {} as never)
    await drainLong()
    expect(hold.get).not.toBeNull()
    const second = SL.restoreAfterReload($, {} as never)
    await drainLong()
    const issued = epochSets.map((s) => s.e)
    hold.get!.open()
    await drainLong()
    // the greater write lands first; a write held behind it lands after it
    for (const s of epochSets.filter((s) => s.e === 6)) s.gate.open()
    await drainLong()
    for (let i = 0; i < 3; i++) {
      for (const s of epochSets) s.gate.open()
      await drainLong()
    }
    await first
    await second
    expect({ issued, writes: epochSets.map((s) => s.e), stored: epochOf(persisted) }).toEqual({ issued: [6], writes: [6], stored: 6 })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9f Р3: a draft write of a stale state, which the stand makes only after a new generation took over, writes nothing — the draft the new generation stored stands', async () => {
  const persisted = new Map<string, unknown>([draftA()])
  const fresh = { session: 'A', t: 2, ...body([['ctx', 'ver']]) }
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    const g = Number(snap()['gen'])
    regen()
    persisted.set(draftKey('A'), fresh)
    const wrote = await SL.__writeDraft($, g, 'A', body([['ver']]))
    expect({ stale: g !== Number(snap()['gen']), wrote, stored: persisted.get(draftKey('A')) }).toEqual({ stale: true, wrote: false, stored: fresh })
  } finally {
    SL.__resetState()
  }
})

// CONSTRAINT (#551 §3.5): a re-stamp takes no order — the publication of A in
// flight during the rebind is the one held; it carries A's session and openId
// from its ticket, and its landing deletes its own key
test('#551 FIX9f Р4: a re-stamp in flight while a rebind moves the panel from A to B writes its flag with session A and A\'s open — it lands as outlived and deletes itself, and no flag of B carries A\'s open', async () => {
  const t1 = STORE_OPEN + ':t1'
  const persisted = new Map<string, unknown>([
    [t1, { session: 'A', token: 't1', e: 1, n: 0, at: 5000 }],
    draftA(),
  ])
  const stamps: Array<[unknown, unknown]> = []
  const hold = { armed: false, gate: null as Gate | null }
  const inner = storeOf(persisted, {
    holdSet: (k) => {
      if (!hold.armed || !k.startsWith(NS_OPEN)) return undefined
      hold.armed = false
      hold.gate = gate()
      return hold.gate.p
    },
  })
  const store: StoreStand = {
    ...inner,
    set: async (k, v) => {
      if (k.startsWith(NS_OPEN) && (v as { openId?: unknown }).openId === 'v1:t1') stamps.push([(v as { session?: unknown }).session, (v as { openId?: unknown }).openId])
      return inner.set(k, v)
    },
  }
  const session = { id: 'A' }
  const clock: Clock = { now: 5000, arms: [] }
  try {
    SL.__resetState()
    const $ = standOf(async () => session.id, store, clock)
    await restoreIn($)
    SL.__render({})
    await SL.__refresh($)
    await drainLong()
    expect({ session: snap()['pickerSession'], token: snap()['open']?.openId }).toEqual({ session: 'A', token: 'v1:t1' })
    hold.armed = true
    clock.arms.find((a) => !a.cancelled && a.ms === DAY)!.fn()
    await drainLong()
    expect(hold.gate).not.toBeNull()
    session.id = 'B'
    const refreshing = SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('B')
    hold.gate!.open()
    await refreshing
    await drainLong()
    await drainLong()
    // the adoption's copy and the held re-stamp, both of A; #551 D8: the previous version's flag stays
    expect({ stamps, ofA: v3Keys(persisted, NS_OPEN, 'A'), t1: persisted.has(t1), b: openFlags(persisted).filter((f) => f.session === 'B').map((f) => f.openId === 'v1:t1') })
      .toEqual({ stamps: [['A', 'v1:t1'], ['A', 'v1:t1']], ofA: [], t1: true, b: [false] })
  } finally {
    SL.__resetState()
  }
})

test('#551 FIX9f Р5: a close mark of a later epoch another environment writes after the restore\'s listing is read by the prune of the open — the epoch rises past it, and the close after it marks the session past it', async () => {
  const mC = V2K + ':C:5:0'
  const persisted = new Map<string, unknown>([draftA()])
  // the first listing after the open's flag landed is the prune's
  const race = { done: false }
  const store = interleaved(storeOf(persisted), (call) => {
    if (call !== 'keys' || race.done || openFlags(persisted).length === 0) return
    race.done = true
    persisted.set(mC, { session: 'C', e: 5, n: 0, at: 5000 })
  })
  try {
    const h = boot()
    const $ = standOf(async () => 'A', store, { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    await SL.closeKeepDraft($)
    expect({ raced: race.done, epoch: epochOf(persisted), marks: v3Keys(persisted, NS_MARK, 'A').map((k) => (persisted.get(k) as { e?: unknown }).e) })
      .toEqual({ raced: true, epoch: 6, marks: [6] })
  } finally {
    SL.__resetState()
  }
})
