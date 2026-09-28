import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { STORE_DRAFT, STORE_OPEN, STORE_OPEN_CLOSED, STORE_UNDO, STORE_SAVING, STORE_THEMES, openFlags, closedMarks, themeRecords, undoStack, saveMarks } from './world'

// #521 FIX6 teeth (Р1–Р6). CONSTRAINT (s521-fix1 tooth 11): the kit skips a
// store hook that throws, so every refused or held store call is stood up in
// this realm and the module is driven directly. A second process is a second
// state: SL.__resetState() between them, the store map shared.

const DAY = 86400000
const drain = async (): Promise<void> => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const drainLong = async (): Promise<void> => { for (let i = 0; i < 12; i++) await drain() }
const draftKey = (session: string): string => STORE_DRAFT + ':' + session
const snap = (): Record<string, any> => SL.__stateSnapshot() as Record<string, any>

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

test('#521 FIX6 Р1: two sessions each move their own bare open flag; A\'s re-stamp and A\'s close leave B\'s flag as it was, and the reload in B reopens B\'s panel', async () => {
  const T0 = Date.now()
  const persisted = new Map<string, unknown>([
    [STORE_OPEN, { session: 'A', token: 'tA' }],
    [draftKey('A'), { session: 'A', t: T0, ...body([['ctx']]) }],
    [draftKey('B'), { session: 'B', t: T0, ...body([['ver']]) }],
  ])
  const flagsOf = (session: string): string => JSON.stringify(openFlags(persisted).filter((f) => f.session === session))
  try {
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(snap()['pickerOpen']).toBe(true)
    // an instance of the previous version leaves B's bare flag after A's move
    persisted.set(STORE_OPEN, { session: 'B', token: 'tB' })
    boot()
    await SL.restoreAfterReload(standOf(async () => 'B', storeOf(persisted)), {} as never)
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
    expect(openFlags(persisted).filter((f) => f.session === 'A').map((f) => f.t)).toEqual([T0 + DAY])
    expect(flagsOf('B')).toBe(flagB)
    await SL.closeKeepDraft($A)
    expect(flagsOf('A')).toBe('[]')
    expect(flagsOf('B')).toBe(flagB)
    boot()
    await SL.restoreAfterReload(standOf(async () => 'B', storeOf(persisted)), {} as never)
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
      if (!armed || !k.startsWith(STORE_OPEN + ':')) return undefined
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
    [STORE_OPEN + ':t1', { session: 'A', token: 't1', t: 1 }],
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

test('#521 FIX6 Р4 (б): a bare undo array changed after a move whose bare delete was refused moves again — the moved record and the changed one both stay', async () => {
  const persisted = new Map<string, unknown>([[STORE_UNDO, [UNDO_A]]])
  const store = storeOf(persisted, { refuseDelete: (k) => k === STORE_UNDO })
  try {
    await command(boot(), standOf(async () => 'A', store))
    await drainLong()
    expect(undoStack(persisted).map((r) => r.written)).toEqual([UNDO_A.written])
    persisted.set(STORE_UNDO, [UNDO_B])
    await command(boot(), standOf(async () => 'A', store))
    await drainLong()
    expect(undoStack(persisted).map((r) => JSON.stringify(r.written)).sort()).toEqual([JSON.stringify(UNDO_A.written), JSON.stringify(UNDO_B.written)].sort())
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX6 Р4 (в): a repeated move of unchanged content writes it again nowhere — the theme saved over its moved key and a moved undo record stay as they are, one record each', async () => {
  const persisted = new Map<string, unknown>([[STORE_THEMES, { u: { palette: 'mono' } }], [STORE_UNDO, [UNDO_A, UNDO_B]]])
  const store = storeOf(persisted, { refuseDelete: (k) => k === STORE_THEMES || k === STORE_UNDO })
  const recordsOf = (field: string): string[] => undoStack(persisted).filter((r) => r.fields.includes(field)).map((r) => JSON.stringify(r))
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
  const persisted = new Map<string, unknown>([[STORE_SAVING, { fields: ['numUsd'], values: { numUsd: 'short' } }]])
  let refuse = true
  const store = storeOf(persisted, { refuseDelete: (k) => refuse && k === STORE_SAVING })
  try {
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', store), {} as never)
    expect(saveMarks(persisted).length).toBe(1)
    // the previous version wrote another mark into the bare key the refused delete left
    persisted.set(STORE_SAVING, { fields: ['numTokens'], values: { numTokens: 'compact' } })
    refuse = false
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', store), {} as never)
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

test('#521 FIX7 Р3: a close that lands during the open\'s await after its flag write, whose own flag delete is refused, leaves no open flag — the open deletes it, and the refusal is said once', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  // after the open's flag write lands, the next store call — the open's own —
  // is held; the first flag delete after `refuse` is armed is refused
  const hold: { landed: boolean; gate: Gate | null; refuse: boolean } = { landed: false, gate: null, refuse: false }
  const inner = storeOf(persisted, {
    refuseDelete: (k) => {
      if (!hold.refuse || !k.startsWith(STORE_OPEN + ':')) return false
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
      if (k.startsWith(STORE_OPEN + ':')) hold.landed = true
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
    expect({ flags: openFlags(persisted), open: snap()['pickerOpen'], refusals: refusals() }).toEqual({ flags: [], open: false, refusals: 1 })
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(snap()['pickerOpen']).toBe(false)
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
    const token = String(openFlags(persisted)[0]?.token)
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
    expect({ open: snap()['pickerOpen'], token: snap()['openToken'] }).toEqual({ open: true, token })
    await SL.closeKeepDraft($2)
    expect(openFlags(persisted)).toEqual([])
    held()!.open()
    await drainLong()
    // the late write has landed: the key the close deleted is back
    expect(openFlags(persisted).map((f) => f.token)).toEqual([token])
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
    const token = String(snap()['openToken'])
    await SL.closeKeepDraft($)
    expect(openFlags(persisted)).toEqual([])
    boot()
    held()!.open()
    await opening
    await drainLong()
    // the late write has landed after the reload: no check of the old state ran
    expect(openFlags(persisted).map((f) => f.token)).toEqual([token])
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted), closed: closedMarks(persisted) }).toEqual({ open: false, flags: [], closed: ['A'] })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8 Р1 (в): a refused close-mark write at the close is said once, and the flag still goes', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  const store = storeOf(persisted, { refuseSet: (k) => k.startsWith(STORE_OPEN_CLOSED + ':') })
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
    const t1 = String(snap()['openToken'])
    arm()
    // a second /statusline-mod while the panel is open: a new token, t2
    const reopening = command(h, $)
    await drainLong()
    const t2 = String(snap()['openToken'])
    expect({ held: held() !== null, fresh: t2 !== t1, flags: openFlags(persisted).map((f) => f.token) }).toEqual({ held: true, fresh: true, flags: [t1] })
    boot()
    const $2 = standOf(async () => 'A', storeOf(persisted))
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['openToken'] }).toEqual({ open: true, token: t1 })
    await SL.closeKeepDraft($2)
    held()!.open()
    await reopening
    await drainLong()
    // t2 landed: a token the closing state never knew
    expect(openFlags(persisted).map((f) => f.token)).toEqual([t2])
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted), closed: closedMarks(persisted) }).toEqual({ open: false, flags: [], closed: ['A'] })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8b Р1 (е): a moved bare flag this version closed, then a bare flag the previous version wrote after the close — the move is stamped newer than the close mark and the panel opens', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN, { session: 'A', token: 'tA' }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    const moved = String(snap()['openToken'])
    expect({ open: snap()['pickerOpen'], legacy: moved.startsWith('legacy-') }).toEqual({ open: true, legacy: true })
    await SL.closeKeepDraft($)
    expect(openFlags(persisted)).toEqual([])
    // the previous version opens the panel in A after the close
    persisted.set(STORE_OPEN, { session: 'A', token: 'tA2' })
    boot()
    const $2 = standOf(async () => 'A', storeOf(persisted), { now: 6000, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['openToken'], flags: openFlags(persisted).map((f) => ({ token: f.token, t: f.t })), closed: closedMarks(persisted) }).toEqual({ open: true, token: moved, flags: [{ token: moved, t: 6000 }], closed: ['A'] })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8b Р1 (ж): two open flags of one session — the restore opens by the newest and deletes the older', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN + ':tOld', { session: 'A', token: 'tOld', t: 1000 }],
    [STORE_OPEN + ':tNew', { session: 'A', token: 'tNew', t: 2000 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['openToken'], flags: openFlags(persisted).map((f) => f.token) }).toEqual({ open: true, token: 'tNew', flags: ['tNew'] })
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
    expect({ open: snap()['pickerOpen'], token: snap()['openToken'], flags: openFlags(persisted).map((f) => f.token), closed: closedMarks(persisted) }).toEqual({ open: true, token: 'tB', flags: ['tB'], closed: ['A'] })
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
    // the re-open is stamped past the first close: lastCloseT + 1
    const reopening = command(h, $)
    await drainLong()
    expect(held()).not.toBeNull()
    const t2 = String(snap()['openToken'])
    await SL.closeKeepDraft($)
    boot()
    held()!.open()
    await reopening
    await drainLong()
    expect(openFlags(persisted).map((f) => f.token)).toEqual([t2])
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
    const t1 = String(snap()['openToken'])
    arm()
    liveArms(clock)[0]!.fn()
    await drainLong()
    expect(held()).not.toBeNull()
    await command(h, $)
    await drainLong()
    const t2 = String(snap()['openToken'])
    expect({ fresh: t2 !== t1, flags: openFlags(persisted).map((f) => f.token) }).toEqual({ fresh: true, flags: [t2] })
    held()!.open()
    await drainLong()
    expect({ flags: openFlags(persisted).map((f) => f.token), closed: closedMarks(persisted) }).toEqual({ flags: [t2], closed: [] })
    boot()
    const $2 = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['openToken'] }).toEqual({ open: true, token: t2 })
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

// ---------- FIX8d: the marks seed lastCloseT before the move; a stamp from the future is damage ----------

test('#521 FIX8d Р1 (M): a bare flag moved in a new environment whose clock reads below the stored close mark opens the panel, as it does with the clock ahead', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN_CLOSED + ':A', { t: 5000 }],
    [STORE_OPEN, { session: 'A', token: 'tA' }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 4000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).length }).toEqual({ open: true, flags: 1 })
  } finally {
    SL.__resetState()
  }
})

// CONSTRAINT (#521 FIX8d Р2): the stand clock reads 5000; a record stamped
// past 5000 + 7 days is damage, one stamped at 5000 + 7 days is not
const KEEP = 7 * DAY
const futureSaid = (): Array<{ kind: string; text: string }> => SL.__diag().filter((d) => d.key === 'picker-future-stamp')

test('#521 FIX8d Р2 (1): a close mark stamped 7 days and 1 ms past the stand clock is deleted at the restore and said once — it does not seed lastCloseT, the open is stamped 5000', async () => {
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
    const said = futureSaid()
    expect({ open: snap()['pickerOpen'], closed: closedMarks(persisted), flags: openFlags(persisted).map((f) => f.t), said: said.length, kind: said[0]?.kind, key: said[0]?.text.includes(STORE_OPEN_CLOSED + ':A'), why: said[0]?.text.includes('штамп дальше 7 дней в будущем') })
      .toEqual({ open: true, closed: [], flags: [5000], said: 1, kind: 'info', key: true, why: true })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8d Р2 (2): an open flag stamped 7 days and 1 ms past the stand clock is deleted at the restore and said once — the panel does not open by it', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN + ':tF', { session: 'A', token: 'tF', t: 5000 + KEEP + 1 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    const said = futureSaid()
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted), said: said.length, kind: said[0]?.kind, key: said[0]?.text.includes(STORE_OPEN + ':tF'), why: said[0]?.text.includes('штамп дальше 7 дней в будущем') })
      .toEqual({ open: false, flags: [], said: 1, kind: 'info', key: true, why: true })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8d Р2 (3): an open flag stamped exactly 7 days past the stand clock is not damage — it stays, the panel opens by it, nothing is said', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN + ':tE', { session: 'A', token: 'tE', t: 5000 + KEEP }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    expect({ open: snap()['pickerOpen'], token: snap()['openToken'], flags: openFlags(persisted).map((f) => f.t), said: futureSaid().length })
      .toEqual({ open: true, token: 'tE', flags: [5000 + KEEP], said: 0 })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8e (а): a close mark stamped exactly 7 days past the stand clock is deleted at the restore and said once — it does not seed lastCloseT, the open is stamped 5000', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN_CLOSED + ':A', { t: 5000 + KEEP }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    await command(h, $)
    await drainLong()
    const said = futureSaid()
    expect({ open: snap()['pickerOpen'], closed: closedMarks(persisted), flags: openFlags(persisted).map((f) => f.t), said: said.length, kind: said[0]?.kind, key: said[0]?.text.includes(STORE_OPEN_CLOSED + ':A'), why: said[0]?.text.includes('штамп дальше 7 дней в будущем') })
      .toEqual({ open: true, closed: [], flags: [5000], said: 1, kind: 'info', key: true, why: true })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8e (б): a close mark 1 ms before the boundary seeds lastCloseT — the open is stamped on the boundary, and the next read at the same clock keeps the flag and opens the panel', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_OPEN_CLOSED + ':A', { t: 5000 + KEEP - 1 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    await command(h, $)
    await drainLong()
    expect({ closed: closedMarks(persisted), flags: openFlags(persisted).map((f) => f.t), said: futureSaid().length })
      .toEqual({ closed: ['A'], flags: [5000 + KEEP], said: 0 })
    boot()
    const $2 = standOf(async () => 'A', storeOf(persisted), { now: 5000, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).map((f) => f.t), said: futureSaid().length })
      .toEqual({ open: true, flags: [5000 + KEEP], said: 0 })
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX8d Р2 (4): a close mark from the future whose delete is refused is said once with the reason and still not counted — the open is stamped 5000 and the reload opens the panel', async () => {
  const markKey = STORE_OPEN_CLOSED + ':A'
  const persisted = new Map<string, unknown>([
    [markKey, { t: 5000 + KEEP + 1 }],
    [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
  ])
  const refusing = (): StoreStand => storeOf(persisted, { refuseDelete: (k) => k === markKey })
  try {
    const h = boot()
    const $ = standOf(async () => 'A', refusing(), { now: 5000, arms: [] })
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    await command(h, $)
    await drainLong()
    const said = futureSaid()
    expect({ closed: closedMarks(persisted), flags: openFlags(persisted).map((f) => f.t), said: said.length, kind: said[0]?.kind, key: said[0]?.text.includes(markKey), why: said[0]?.text.includes('штамп дальше 7 дней в будущем'), reason: said[0]?.text.includes('refused by the test') })
      .toEqual({ closed: ['A'], flags: [5000], said: 1, kind: 'info', key: true, why: true, reason: true })
    boot()
    const $2 = standOf(async () => 'A', refusing(), { now: 5000, arms: [] })
    await SL.__pictureReadClock($2)
    await SL.restoreAfterReload($2, {} as never)
    expect({ open: snap()['pickerOpen'], flags: openFlags(persisted).map((f) => f.t) }).toEqual({ open: true, flags: [5000] })
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
