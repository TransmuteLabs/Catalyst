import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { walk, textOf, STORE_DRAFT, STORE_OPEN, STORE_UNDO, STORE_SAVING, STORE_THEMES, openFlags, themeRecords } from './world'
import type { Node } from './world'

// #521 FIX5 teeth (Ч1–Ч4, Ч6–Ч11). CONSTRAINT (s521-fix1 tooth 11): the kit
// skips a store hook that throws, so every refused or held store call is stood
// up in this realm and the module is driven directly. A second process is a
// second state: SL.__resetState() between them, the store map shared.

const DAY = 86400000
const PANE = 'statusline'
const keyOf = (n: Node): string => String(n.key ?? (n.props as Record<string, unknown> | undefined)?.['key'] ?? '')
const drain = async (): Promise<void> => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const drainLong = async (): Promise<void> => { for (let i = 0; i < 12; i++) await drain() }
const draftKey = (session: string): string => STORE_DRAFT + ':' + session
const snap = (): Record<string, any> => SL.__stateSnapshot() as Record<string, any>
const textsOf = (nodes: Node[]): string[] => nodes.filter((n) => n.type === 'Text').map(textOf)
const buttonKeys = (nodes: Node[]): string[] => nodes.filter((n) => n.type === 'Button').map(keyOf)
const keysWith = (persisted: Map<string, unknown>, base: string): string[] => [...persisted.keys()].filter((k) => k.startsWith(base + ':'))

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
  refuseSet?: (k: string) => boolean
  refuseGet?: (k: string) => boolean
  refuseDelete?: (k: string) => boolean
  holdSet?: (k: string) => Promise<void> | undefined
  holdGet?: (k: string) => Promise<void> | undefined
  getAs?: (k: string) => { value: unknown } | undefined
}

// the kit store's semantics over one map; the options refuse, hold or answer
// named keys the way another process or a refusing host would
const storeOf = (persisted: Map<string, unknown>, o: StoreOpts = {}): StoreStand => ({
  get: async (k) => {
    const held = o.holdGet?.(k)
    if (held) await held
    if (o.refuseGet?.(k)) throw new Error('read of ' + k + ' refused by the test')
    const as = o.getAs?.(k)
    if (as) return as.value
    return persisted.get(k)
  },
  set: async (k, v) => {
    const copy = JSON.parse(JSON.stringify(v))
    const held = o.holdSet?.(k)
    if (held) await held
    if (o.refuseSet?.(k)) throw new Error('write of ' + k + ' refused by the test')
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

const TABLE = {
  Box: (props: Record<string, unknown>) => ({ type: 'Box', props, children: props['children'] }),
  Text: (props: Record<string, unknown>) => ({ type: 'Text', props, children: props['children'] }),
  Button: (props: Record<string, unknown>) => ({ type: 'Button', props, children: props['label'] !== undefined ? [String(props['label'])] : undefined }),
  Input: (props: Record<string, unknown>) => ({ type: 'Input', props, children: [(props['value'] as string) ?? ''] }),
}

const standOf = (id: () => Promise<string>, store: StoreStand, clock: Clock = { now: 5000, arms: [] }, redraw: () => void = () => undefined): any => ({
  clock: {
    now: async () => clock.now,
    every: (ms: number, fn: () => void) => {
      const arm: Arm = { ms, fn, cancelled: false }
      clock.arms.push(arm)
      return { cancel() { arm.cancelled = true } }
    },
    after: () => ({ cancel() {} }),
  },
  ui: { log: async () => undefined, invalidate: redraw, status: () => undefined, toast: () => undefined, open: async () => undefined, close: async () => undefined, resolve: async () => TABLE },
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
const paneRender = async (h: Handlers, $: unknown): Promise<Node[]> =>
  walk((await h['ui.render']!($ as never, { component: 'Pane', requestId: PANE, surface: 'terminal', props: { bodyColumns: 120 } } as never, async () => ({ type: 'next' }))) as Node)
const treeOf = (tab: string, store: StoreStand, $: any): Node[] => walk(SL.__renderPicker({}, tab, 120, undefined, store, $) as Node)
const nodeOf = (nodes: Node[], key: string): Node => {
  const node = nodes.find((n) => keyOf(n) === key)
  expect({ key, drawn: node !== undefined }).toEqual({ key, drawn: true })
  return node!
}
const pressOn = async (nodes: Node[], key: string): Promise<void> => {
  ;(nodeOf(nodes, key).props!['onPress'] as () => void)()
  await drainLong()
}

const STALE_TREE = 'панель обновлена под текущую сессию — повторите действие'

// ---------- Ч1: the bare open flag is moved by its own session only ----------

test('#521 FIX5 Ч1: a foreign session leaves the bare open flag alone; the owner moves it to «legacy-<session>», closes, and a late foreign pass brings nothing back', async () => {
  const bare = { session: 'A', token: 't1' }
  const persisted = new Map<string, unknown>([[STORE_OPEN, bare], [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
  try {
    boot()
    await SL.restoreAfterReload(standOf(async () => 'B', storeOf(persisted)), {} as never)
    expect(keysWith(persisted, STORE_OPEN)).toEqual([])
    expect(persisted.get(STORE_OPEN)).toEqual(bare)
    expect(snap()['pickerOpen']).toBe(false)
    boot()
    const $A = standOf(async () => 'A', storeOf(persisted))
    await SL.restoreAfterReload($A, {} as never)
    expect(snap()['pickerOpen']).toBe(true)
    expect(persisted.has(STORE_OPEN)).toBe(false)
    expect(openFlags(persisted).map((f) => ({ session: f.session, token: f.token }))).toEqual([{ session: 'A', token: 'legacy-A' }])
    await SL.closeKeepDraft($A)
    expect(openFlags(persisted)).toEqual([])
    // B's read of the bare flag landed before A's move: its pass writes nothing
    boot()
    await SL.restoreAfterReload(standOf(async () => 'B', storeOf(persisted, { getAs: (k) => (k === STORE_OPEN ? { value: bare } : undefined) })), {} as never)
    expect(openFlags(persisted)).toEqual([])
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(snap()['pickerOpen']).toBe(false)
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч1: a foreign bare open flag ages out through the prune of an open', async () => {
  const T0 = Date.now()
  const persisted = new Map<string, unknown>([[STORE_OPEN, { session: 'other', token: 'old', t: T0 - 8 * DAY }]])
  try {
    const h = boot()
    const clock: Clock = { now: T0, arms: [] }
    const $ = standOf(async () => 'A', storeOf(persisted), clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect(snap()['pickerOpen']).toBe(true)
    expect(persisted.has(STORE_OPEN)).toBe(false)
    expect(openFlags(persisted).filter((f) => f.session === 'other')).toEqual([])
  } finally {
    SL.__resetState()
  }
})

// ---------- Ч2: the bare undo array and mark move under fixed ids ----------

test('#521 FIX5 Ч2: a move of the bare undo array and mark whose bare delete is refused repeats onto the same keys', async () => {
  const persisted = new Map<string, unknown>([
    [STORE_UNDO, [{ fields: ['numUsd'], prev: { numUsd: 'exact' }, written: { numUsd: 'short' } }]],
    [STORE_SAVING, { fields: ['numUsd'], values: { numUsd: 'short' } }],
  ])
  const store = storeOf(persisted, { refuseDelete: (k) => k === STORE_UNDO || k === STORE_SAVING })
  try {
    let first: { undo: string[]; marks: string[] } | null = null
    for (let pass = 1; pass <= 2; pass++) {
      const h = boot()
      await command(h, standOf(async () => 'A', store))
      await drainLong()
      const keys = { undo: keysWith(persisted, STORE_UNDO), marks: keysWith(persisted, STORE_SAVING) }
      // #521 FIX6 Р4, FIX6b: the id of a moved record is `legacy-<kind>-<64-bit content hash>`, an undo record's with its occurrence
      expect({ pass, undo: keys.undo.map((k) => /:legacy-undo-[0-9a-f]{16}-1$/.test(k)), marks: keys.marks.map((k) => /:legacy-mark-[0-9a-f]{16}$/.test(k)) }).toEqual({ pass, undo: [true], marks: [true] })
      if (first === null) first = keys
      expect({ pass, keys }).toEqual({ pass, keys: first })
    }
  } finally {
    SL.__resetState()
  }
})

// ---------- Ч3: a live open panel is not pruned ----------

const openAt = async (T0: number, persisted: Map<string, unknown>, clock: Clock, session = 'A'): Promise<any> => {
  const h = boot()
  const store = storeOf(persisted)
  const $ = standOf(async () => session, store, clock)
  await SL.__pictureReadClock($)
  await command(h, $)
  await drainLong()
  expect(snap()['pickerOpen']).toBe(true)
  return { h, $, store }
}

test('#521 FIX5 Ч3: a panel open eight days is re-stamped by its timer; another session\'s open prunes neither its flag nor its draft', async () => {
  const T0 = Date.now()
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: T0, ...body([['ctx']], { numTokens: 'raw' }) }]])
  const clock: Clock = { now: T0, arms: [] }
  try {
    await openAt(T0, persisted, clock)
    const armed = clock.arms.filter((a) => !a.cancelled)
    expect(armed.length).toBe(1)
    expect(armed[0]!.ms).toBeLessThanOrEqual(DAY)
    for (let day = 1; day <= 8; day++) {
      clock.now = T0 + day * DAY
      armed[0]!.fn()
      await drainLong()
    }
    const flagA = openFlags(persisted).filter((f) => f.session === 'A')
    expect(flagA.length).toBe(1)
    const clockB: Clock = { now: T0 + 8 * DAY, arms: [] }
    await openAt(T0 + 8 * DAY, persisted, clockB, 'B')
    expect(openFlags(persisted).filter((f) => f.session === 'A').map((f) => f.token)).toEqual([flagA[0]!.token])
    expect((persisted.get(draftKey('A')) as any)?.axes?.numTokens).toBe('raw')
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч3: a draft write of the open panel re-stamps its open flag too', async () => {
  const T0 = Date.now()
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: T0, ...body([['ctx']]) }]])
  const clock: Clock = { now: T0, arms: [] }
  try {
    const { $, store } = await openAt(T0, persisted, clock)
    clock.now = T0 + 8 * DAY
    await SL.__pictureReadClock($)
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
    expect(openFlags(persisted).filter((f) => f.session === 'A').map((f) => f.t)).toEqual([T0 + 8 * DAY])
    await openAt(T0 + 8 * DAY, persisted, { now: T0 + 8 * DAY, arms: [] }, 'B')
    expect(openFlags(persisted).filter((f) => f.session === 'A').length).toBe(1)
    expect((persisted.get(draftKey('A')) as any)?.axes?.numUsd).toBe('short')
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч3: the re-stamp timer is cancelled at the close and at a new state', async () => {
  const T0 = Date.now()
  try {
    const clock: Clock = { now: T0, arms: [] }
    const { $ } = await openAt(T0, new Map(), clock)
    expect(clock.arms.map((a) => a.cancelled)).toEqual([false])
    await SL.closeKeepDraft($)
    expect(clock.arms.map((a) => a.cancelled)).toEqual([true])
    const clock2: Clock = { now: T0, arms: [] }
    await openAt(T0, new Map(), clock2)
    expect(clock2.arms.map((a) => a.cancelled)).toEqual([false])
    SL.__resetState()
    expect(clock2.arms.map((a) => a.cancelled)).toEqual([true])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч3: a panel the reload reopens is re-stamped by its timer too; another session\'s open eight days on prunes neither its flag nor its draft', async () => {
  const T0 = Date.now()
  const persisted = new Map<string, unknown>([
    [STORE_OPEN + ':t1', { session: 'A', token: 't1', t: T0 }],
    [draftKey('A'), { session: 'A', t: T0, ...body([['ctx']], { numTokens: 'raw' }) }],
  ])
  const clock: Clock = { now: T0, arms: [] }
  try {
    boot()
    const $ = standOf(async () => 'A', storeOf(persisted), clock)
    await SL.__pictureReadClock($)
    await SL.restoreAfterReload($, {} as never)
    expect(snap()['pickerOpen']).toBe(true)
    const armed = clock.arms.filter((a) => !a.cancelled)
    expect(armed.length).toBe(1)
    for (let day = 1; day <= 8; day++) {
      clock.now = T0 + day * DAY
      armed[0]!.fn()
      await drainLong()
    }
    await openAt(T0 + 8 * DAY, persisted, { now: T0 + 8 * DAY, arms: [] }, 'B')
    expect(openFlags(persisted).filter((f) => f.session === 'A').map((f) => f.token)).toEqual(['t1'])
    expect((persisted.get(draftKey('A')) as any)?.axes?.numTokens).toBe('raw')
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч3: the prune of an open keeps the stored draft of the session whose panel it opens, even when that draft is old and its re-write is refused', async () => {
  const T0 = Date.now()
  const old = { session: 'A', t: T0 - 8 * DAY, ...body([['ctx']], { numTokens: 'raw' }) }
  const persisted = new Map<string, unknown>([[draftKey('A'), old]])
  const clock: Clock = { now: T0, arms: [] }
  try {
    const h = boot()
    const $ = standOf(async () => 'A', storeOf(persisted, { refuseSet: (k) => k === draftKey('A') }), clock)
    await SL.__pictureReadClock($)
    await command(h, $)
    await drainLong()
    expect(snap()['pickerOpen']).toBe(true)
    expect(persisted.get(draftKey('A'))).toEqual(old)
  } finally {
    SL.__resetState()
  }
})

// ---------- Ч4: one store key per theme ----------

test('#521 FIX5 Ч4: the bare theme map moves to one key per theme under legacy ids and the bare key goes', async () => {
  const persisted = new Map<string, unknown>([[STORE_THEMES, { u1: { palette: 'mono' } }]])
  try {
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(persisted.has(STORE_THEMES)).toBe(false)
    // #521 FIX6 Р4, FIX6b: the id of a moved theme is `legacy-<name>-<64-bit content hash>`
    expect(themeRecords(persisted).map((r) => ({ id: /^legacy-u1-[0-9a-f]{16}$/.test(r.id), name: r.name, palette: r['palette'] }))).toEqual([{ id: true, name: 'u1', palette: 'mono' }])
    expect(Object.keys(snap()['userThemes'] as Record<string, unknown>)).toEqual(['u1'])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч4: two processes saving the same name at once both keep their theme; the list tells them apart', async () => {
  const persisted = new Map<string, unknown>()
  let held: Gate | null = null
  const store = storeOf(persisted, {
    holdSet: (k) => {
      if (!k.startsWith(STORE_THEMES) || held !== null) return undefined
      held = gate()
      return held.p
    },
  })
  try {
    const saveAs = async (name: string): Promise<void> => {
      const $ = standOf(async () => 'A', store)
      ;(nodeOf(treeOf('themes', store, $), 'theme-name').props!['onInput'] as (v: string) => void)(name)
      await drainLong()
      await pressOn(treeOf('themes', store, $), 'theme-save')
    }
    SL.__resetState()
    await saveAs('x')
    expect(held).not.toBeNull()
    SL.__resetState()
    await saveAs('x')
    expect(snap()['themeNote']).toBe('тема «x» сохранена')
    ;(held as unknown as Gate).open()
    await drainLong()
    expect(themeRecords(persisted).map((r) => r.name)).toEqual(['x', 'x'])
    boot()
    const $C = standOf(async () => 'A', storeOf(persisted))
    await SL.restoreAfterReload($C, {} as never)
    const keys = buttonKeys(treeOf('themes', storeOf(persisted), $C))
    expect(keys).toContain('theme:x')
    expect(keys).toContain('theme:x (2)')
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч4: two saves racing on the free name each name their own theme, and the list draws both apart', async () => {
  const persisted = new Map<string, unknown>()
  const store = storeOf(persisted)
  try {
    boot()
    const $ = standOf(async () => 'A', store)
    const notes = await Promise.all([SL.__saveTheme($, null), SL.__saveTheme($, null)])
    expect(themeRecords(persisted).map((r) => r.name)).toEqual(['моя тема 1', 'моя тема 1'])
    expect(notes).toEqual(['тема «моя тема 1» сохранена', 'тема «моя тема 1 (2)» сохранена'])
    const keys = buttonKeys(treeOf('themes', store, $))
    expect(keys).toContain('theme:моя тема 1')
    expect(keys).toContain('theme:моя тема 1 (2)')
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч4: the free name is taken from the store as it stands at the save, not from the themes read before', async () => {
  const persisted = new Map<string, unknown>()
  const store = storeOf(persisted)
  try {
    boot()
    const $ = standOf(async () => 'A', store)
    await SL.restoreAfterReload($, {} as never)
    persisted.set(STORE_THEMES + ':elsewhere', { name: 'моя тема 1', palette: 'mono', t: 1 })
    expect(await SL.__saveTheme($, null)).toBe('тема «моя тема 2» сохранена')
    expect(themeRecords(persisted).map((r) => r.name).sort()).toEqual(['моя тема 1', 'моя тема 2'])
  } finally {
    SL.__resetState()
  }
})

// ---------- Ч6: the draft, its session and its epoch change in one place ----------

test('#521 FIX5 Ч6: a pane drawn while /statusline-mod opens says «открывается…» and the stored draft of the session is not replaced', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']], { numTokens: 'raw' }) }]])
  let idHold: Gate | null = null
  try {
    const h = boot()
    const $ = standOf(async () => { if (idHold) await idHold.p; return 'A' }, storeOf(persisted))
    await paneRender(h, $)
    await drainLong()
    idHold = gate()
    const opening = command(h, $)
    await drainLong()
    const drawn = await paneRender(h, $)
    expect(textsOf(drawn)).toContain('открывается…')
    ;(idHold as Gate).open()
    idHold = null
    await opening
    await drainLong()
    expect((persisted.get(draftKey('A')) as any)?.axes?.numTokens).toBe('raw')
    expect(snap()['draft']?.axes?.numTokens).toBe('raw')
    expect(snap()['pickerOpen']).toBe(true)
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч6: a press on a tree drawn while /statusline-mod opened changes no draft and says so', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']], { numTokens: 'raw' }) }]])
  let idHold: Gate | null = null
  try {
    const h = boot()
    const store = storeOf(persisted)
    const $ = standOf(async () => { if (idHold) await idHold.p; return 'A' }, store)
    await paneRender(h, $)
    await drainLong()
    idHold = gate()
    const opening = command(h, $)
    await drainLong()
    const stale = treeOf('numbers', store, $)
    ;(idHold as Gate).open()
    idHold = null
    await opening
    await drainLong()
    const storedA = JSON.stringify(persisted.get(draftKey('A')))
    const live = JSON.stringify(snap()['draft'])
    await pressOn(stale, 'num:numUsd:short')
    expect(snap()['saveResult']).toBe(STALE_TREE)
    expect(JSON.stringify(persisted.get(draftKey('A')))).toBe(storedA)
    expect(JSON.stringify(snap()['draft'])).toBe(live)
    expect(snap()['draft']?.axes?.numTokens).toBe('raw')
  } finally {
    SL.__resetState()
  }
})

// ---------- Ч7: a restore landing inside an open yields to the opener ----------

test('#521 FIX5 Ч7: a restore inside the open, with the session changed A→B, leaves the panel open and B\'s stored draft as it was', async () => {
  const storedB = { session: 'B', t: 1, ...body([['ver']], { numTokens: 'compact' }) }
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']], { numTokens: 'raw' }) }], [draftKey('B'), storedB]])
  let session = 'A'
  let undoHold: Gate | null = null
  try {
    const h = boot()
    const $ = standOf(async () => session, storeOf(persisted, { holdGet: (k) => (k === STORE_UNDO && undoHold ? undoHold.p : undefined) }))
    undoHold = gate()
    const opening = command(h, $)
    await drainLong()
    expect(snap()['draft']?.axes?.numTokens).toBe('raw')
    session = 'B'
    await SL.restoreAfterReload($, {} as never)
    ;(undoHold as Gate).open()
    undoHold = null
    await opening
    await drainLong()
    expect(persisted.get(draftKey('B'))).toEqual(storedB)
    expect(snap()['pickerOpen']).toBe(true)
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч7: a restore that finds the session changed and no draft of it keeps no draft of the old session in memory and raises the epoch', async () => {
  const persisted = new Map<string, unknown>([[draftKey('A'), { session: 'A', t: 1, ...body([['ctx']], { numTokens: 'raw' }) }]])
  let session = 'A'
  try {
    const h = boot()
    const $ = standOf(async () => session, storeOf(persisted))
    await command(h, $)
    await drainLong()
    await SL.closeKeepDraft($)
    expect({ numTokens: snap()['draft']?.axes?.numTokens, session: snap()['pickerSession'] }).toEqual({ numTokens: 'raw', session: 'A' })
    const epoch = snap()['draftEpoch'] as number
    session = 'B'
    await SL.restoreAfterReload($, {} as never)
    expect({ draft: snap()['draft'], session: snap()['pickerSession'], raised: (snap()['draftEpoch'] as number) > epoch }).toEqual({ draft: null, session: 'B', raised: true })
  } finally {
    SL.__resetState()
  }
})

// ---------- Ч8: a refused flag write leaves no flag of this state behind ----------

const openInA = async (session: { id: string }, persisted: Map<string, unknown>, store: StoreStand): Promise<any> => {
  persisted.set(STORE_OPEN + ':t1', { session: 'A', token: 't1', t: 1 })
  persisted.set(draftKey('A'), { session: 'A', t: 1, ...body([['ctx']], { numTokens: 'raw' }) })
  const $ = standOf(async () => session.id, store)
  await SL.restoreAfterReload($, {} as never)
  SL.__render({})
  await SL.__refresh($)
  await drainLong()
  expect(snap()['pickerSession']).toBe('A')
  return $
}

test('#521 FIX5 Ч8: open T1, a rebind whose T2 write is refused, a close — the reload in A does not open the panel', async () => {
  const persisted = new Map<string, unknown>()
  let refuse = false
  const store = storeOf(persisted, { refuseSet: (k) => refuse && k.startsWith(STORE_OPEN + ':') })
  try {
    SL.__resetState()
    const session = { id: 'A' }
    const $ = await openInA(session, persisted, store)
    refuse = true
    session.id = 'B'
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('B')
    expect(SL.__diag().filter((d) => d.key === 'picker-open-flag').map((d) => d.text.endsWith('перезагрузка не откроет панель'))).toEqual([true])
    refuse = false
    await SL.closeKeepDraft($)
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(snap()['pickerOpen']).toBe(false)
    expect(openFlags(persisted)).toEqual([])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч8: a refused flag write whose old-flag delete is refused too says the reload may open the old session\'s panel', async () => {
  const persisted = new Map<string, unknown>()
  let refuse = false
  const store = storeOf(persisted, { refuseSet: (k) => refuse && k.startsWith(STORE_OPEN + ':'), refuseDelete: (k) => refuse && k.startsWith(STORE_OPEN + ':') })
  try {
    SL.__resetState()
    const session = { id: 'A' }
    const $ = await openInA(session, persisted, store)
    refuse = true
    session.id = 'B'
    await SL.__refresh($)
    await drainLong()
    expect(SL.__diag().filter((d) => d.key === 'picker-open-flag').map((d) => d.text.endsWith('перезагрузка может открыть панель прежней сессии; флаг устареет за 7 дней'))).toEqual([true])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX5 Ч8: the close deletes the flags of every token of this state — the T1 left by a refused delete goes at the close, and the reload in A does not open the panel', async () => {
  const persisted = new Map<string, unknown>()
  let refuse = false
  const store = storeOf(persisted, { refuseSet: (k) => refuse && k.startsWith(STORE_OPEN + ':'), refuseDelete: (k) => refuse && k.startsWith(STORE_OPEN + ':') })
  try {
    SL.__resetState()
    const session = { id: 'A' }
    const $ = await openInA(session, persisted, store)
    refuse = true
    session.id = 'B'
    await SL.__refresh($)
    await drainLong()
    expect(openFlags(persisted).map((f) => f.token)).toEqual(['t1'])
    refuse = false
    await SL.closeKeepDraft($)
    expect(openFlags(persisted)).toEqual([])
    boot()
    await SL.restoreAfterReload(standOf(async () => 'A', storeOf(persisted)), {} as never)
    expect(snap()['pickerOpen']).toBe(false)
  } finally {
    SL.__resetState()
  }
})

// ---------- Ч9: a pending draft does not overwrite a newer stored one ----------

test('#521 FIX5 Ч9: a pending draft older than the stored draft of its session is dropped aloud, the stored one stays', async () => {
  const persisted = new Map<string, unknown>()
  let refuse = false
  const store = storeOf(persisted, { refuseSet: (k) => refuse && k === draftKey('A') })
  try {
    SL.__resetState()
    const session = { id: 'A' }
    const $ = await openInA(session, persisted, store)
    refuse = true
    session.id = 'B'
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('B')
    refuse = false
    const newer = { session: 'A', t: 9000, ...body([['ver']]) }
    persisted.set(draftKey('A'), newer)
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
    expect(persisted.get(draftKey('A'))).toEqual(newer)
    expect(SL.__diag().some((d) => d.key === 'picker-draft-superseded')).toBe(true)
    expect(snap()['pendingDrafts']).toEqual([])
  } finally {
    SL.__resetState()
  }
})

// ---------- Ч10: the bare slot is removed only when it is the writer's ----------

test('#521 FIX5 Ч10: the unfinished slot move removes the bare slot only when it still names the writing session', async () => {
  const persisted = new Map<string, unknown>([[STORE_OPEN + ':t1', { session: 'A', token: 't1', t: 1 }], [STORE_DRAFT, { session: 'A', ...body([['ctx']]) }]])
  let refuse = true
  const store = storeOf(persisted, { refuseDelete: (k) => refuse && k === STORE_DRAFT })
  try {
    SL.__resetState()
    const $ = standOf(async () => 'A', store)
    await SL.restoreAfterReload($, {} as never)
    expect(snap()['slotMovePending']).toBe('A')
    const foreign = { session: 'C', t: 7, ...body([['ver']]) }
    persisted.set(STORE_DRAFT, foreign)
    refuse = false
    await pressOn(treeOf('numbers', store, $), 'num:numUsd:short')
    expect(persisted.get(STORE_DRAFT)).toEqual(foreign)
    expect((persisted.get(draftKey('A')) as any)?.axes?.numUsd).toBe('short')
  } finally {
    SL.__resetState()
  }
})

// ---------- Ч11: the (cwd?) mark rides the project CLAUDE.md guess ----------

test('#521 FIX5 Ч11: a home CLAUDE.md with the project one read empty under a degraded read draws «1 CLAUDE.md (cwd?)»', async () => {
  SL.__resetState()
  try {
    SL.__render({ template: 'cfg', details: 'off' })
    SL.__feed({ source: { kind: 'file', path: '.claude/CLAUDE.md', everyMs: 30000, relativeTo: 'home' } as any, ok: true, data: '# home\n', now: 5000 })
    SL.__feed({ source: { kind: 'file', path: 'CLAUDE.md', everyMs: 30000, relativeTo: 'project' } as any, ok: true, data: '', now: 5000, degraded: true })
    expect(textsOf(walk(SL.__render({ template: 'cfg', details: 'off' }) as Node)).join('')).toContain('1 CLAUDE.md (cwd?)')
  } finally {
    SL.__resetState()
  }
})
