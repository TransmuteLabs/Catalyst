import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { world, start, command, PANE_MOUNT, walk, textOf, STORE_DRAFT, STORE_OPEN, STORE_UNDO, STORE_SAVING, SESSION_ID, OPTION_ROWS, isOpen, openFlags, undoStack, draftOf as draftIn, draftKeys, flagKeys, v3Key, v3Keys, NS_DRAFT, NS_OPEN, NS_SAVING, NS_UNDO, EXT_WRITER } from './world'
import type { Node, World } from './world'

// #521 FIX2 teeth (Р13–Р27). CONSTRAINT (ANALYSIS-521-swe2 traps 1-2): a kit
// pane is drawn by the kit's own plugin instance — its state is read through
// the drawn tree and the world's records only; the stand teeth drive the
// imported module and read it back through its own seams.

type Pane = {
  drawn: () => Promise<unknown>
  find: (q: Record<string, unknown>) => Promise<unknown>
  findAll: (q: Record<string, unknown>) => Promise<unknown>
  press: (t: { key: string }) => Promise<unknown>
  input: (t: { key: string; text: string }) => Promise<unknown>
  select: (t: { key: string; value: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}
type Ctx = { $: any; w: World; pane: Pane }

const SURFACES4 = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const DAY = 86400000

const keyOf = (n: Node): string => String(n.key ?? (n.props as Record<string, unknown> | undefined)?.['key'] ?? '')
const propOf = (n: Node, name: string): unknown => (n as Record<string, unknown>)[name] ?? (n.props as Record<string, unknown> | undefined)?.[name]
const drain = async (): Promise<void> => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const settle = async (w: World): Promise<void> => { await w.clock.settle(); await drain() }
const draftKey = (session: string): string => STORE_DRAFT + ':' + session
// the newest draft of the session, every form (#551 §3.7)
const draftOf = (w: World, session = SESSION_ID): any => draftIn(w.persisted, session)
const nodesOf = async (pane: Pane): Promise<Node[]> => walk((await pane.drawn()) as Node)
const textsOf = (nodes: Node[]): string[] => nodes.filter((n) => n.type === 'Text').map(textOf)
const buttonKeys = (nodes: Node[]): string[] => nodes.filter((n) => n.type === 'Button').map(keyOf)
const lineIds = (d: any): string[][] => (d?.lines ?? []).map((l: { id: string }[]) => l.map((s) => s.id))
const hasText = async (c: Ctx, part: string): Promise<boolean> => textsOf(await nodesOf(c.pane)).some((t) => t.includes(part))

const press = async (c: Ctx, key: string): Promise<void> => {
  await c.pane.press({ key })
  await settle(c.w)
}

const openPanel = async ($: any, on: any, over: Record<string, (...args: any[]) => unknown> = {}, store: Record<string, unknown> = {}, mount: Record<string, unknown> = {}): Promise<Ctx> => {
  const w = world(on, over, store)
  await start($)
  await settle(w)
  if (!isOpen(w.persisted, SESSION_ID)) {
    await command($)
    await settle(w)
  }
  const pane = (await $.ui.mount({ ...PANE_MOUNT, props: { ...PANE_MOUNT.props, bodyColumns: 140 }, ...mount })) as Pane
  await settle(w)
  return { $, w, pane }
}

const body = (ids: string[][]): Record<string, unknown> => ({
  lines: ids.map((l) => l.map((id) => ({ id, body: '{' + id + '.text}' }))), axes: {}, elements: {}, focus: null, tab: 'layout', query: '', fam: 'model', page: 0, targetLine: 0, themeName: '',
})

// a stand `$` over one map, the kit store's semantics (get/set/delete/keys)
const standOf = (persisted: Map<string, unknown>, over: Record<string, unknown> = {}): any => ({
  store: {
    get: async (k: string) => persisted.get(k),
    set: async (k: string, v: unknown) => { persisted.set(k, JSON.parse(JSON.stringify(v))) },
    delete: async (k: string) => { persisted.delete(k) },
    keys: async () => [...persisted.keys()],
  },
  session: { id: async () => 'A' },
  plugin: { name: 'catalyst-statusline', root: '/stand' },
  ui: { log: async () => undefined, invalidate: () => undefined },
  ...over,
})

// the stand the gather and the source timers run against
const gatherStand = (over: { root?: () => Promise<string>; id?: () => Promise<string>; reads?: string[] } = {}): any => ({
  clock: { now: async () => 5000, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  ui: { log: async () => undefined, invalidate: () => undefined, status: () => undefined, toast: () => undefined },
  store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
  session: {
    id: over.id ?? (async () => 'A'),
    cwd: async () => '/work/demo/sub',
    root: over.root ?? (async () => '/work/demo'),
    usage: async () => ({ context: { tokens: 1, window: 2 }, rateLimits: [], cost: { usd: 0 } }),
    model: async () => 'm',
    turns: async () => 0,
    messages: async () => [],
  },
  env: { get: async (name: string) => (name === 'HOME' ? '' : '') },
  fs: { read: async (path: string) => { over.reads?.push(path); return '# x\n' } },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  config: { list: async () => [], set: async () => undefined },
  plugin: { name: 'catalyst-statusline', root: '/stand' },
})

const rootRefused = async (): Promise<string> => { throw new Error('root refused by the test') }

// ---------- Р13: the draft belongs to its session ----------

test('#521 FIX2 Р13: a draft closed in session A stays under A; the open in B starts from B\'s own key; back in A it continues', async ($, on) => {
  let session = 'A'
  const c = await openPanel($, on, { 'session.id': () => ({ value: session }) })
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  await press(c, 'close')
  expect(draftOf(c.w, 'A')?.axes?.numTokens).toBe('raw')
  session = 'B'
  await command($)
  await settle(c.w)
  expect(draftOf(c.w, 'B')?.session).toBe('B')
  expect(draftOf(c.w, 'B')?.axes?.numTokens).not.toBe('raw')
  expect(draftOf(c.w, 'A')?.axes?.numTokens).toBe('raw')
  expect(await hasText(c, 'продолжен несохранённый черновик')).toBe(false)
  await press(c, 'close')
  session = 'A'
  await command($)
  await settle(c.w)
  expect(draftOf(c.w, 'A')?.axes?.numTokens).toBe('raw')
  expect(await hasText(c, 'продолжен несохранённый черновик (изменено полей: 1)')).toBe(true)
})

test('#521 FIX2 Р13: restoreAfterReload reads the draft under the session STORE_OPEN names', async () => {
  SL.__resetState()
  try {
    // #551 D5: a flag without an age never restores — the error goes toward «closed»
    const ageless = new Map<string, unknown>([[STORE_OPEN, { session: 'A', token: 't1' }], [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
    await SL.restoreAfterReload(standOf(ageless), {} as never)
    expect(SL.__stateSnapshot()['pickerOpen']).toBe(false)
    SL.__resetState()
    // the stand has no clock: the process clock stamps the flag
    const persisted = new Map<string, unknown>([
      [STORE_OPEN, { session: 'A', token: 't1', at: Date.now() }],
      [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }],
      [draftKey('B'), { session: 'B', t: 1, ...body([['ver']]) }],
    ])
    await SL.restoreAfterReload(standOf(persisted), {} as never)
    const snap = SL.__stateSnapshot()
    expect(snap['pickerOpen']).toBe(true)
    expect(lineIds(snap['draft'])).toEqual([['ctx']])
  } finally {
    SL.__resetState()
  }
})

// #551 D8: the previous version's slot is read only — the restore copies it
// into this version's draft of the session it names, the slot stays
test('#521 FIX2 Р13: the old single draft slot is copied once to this version\'s draft of the session it names and stays; another session\'s slot stays', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>([[STORE_OPEN, { session: 'A', at: Date.now() }], [STORE_DRAFT, { session: 'A', ...body([['ctx']]) }]])
    await SL.restoreAfterReload(standOf(persisted), {} as never)
    expect(lineIds(SL.__stateSnapshot()['draft'])).toEqual([['ctx']])
    expect(persisted.has(STORE_DRAFT)).toBe(true)
    expect(v3Keys(persisted, NS_DRAFT, 'A').length).toBe(1)
    expect(lineIds(draftIn(persisted, 'A'))).toEqual([['ctx']])
    SL.__resetState()
    const other = new Map<string, unknown>([[STORE_OPEN, { session: 'A', at: Date.now() }], [STORE_DRAFT, { session: 'Z', ...body([['ver']]) }]])
    await SL.restoreAfterReload(standOf(other), {} as never)
    expect(SL.__stateSnapshot()['draft']).toBeNull()
    expect(other.has(STORE_DRAFT)).toBe(true)
    expect(draftKeys(other, 'A')).toEqual([])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX2 Р13: the open prunes draft keys older than seven days and keeps the younger ones', async ($, on) => {
  const T0 = Date.now()
  const w = world(on, {}, {
    [draftKey('old')]: { session: 'old', t: T0 - 8 * DAY, ...body([['ver']]) },
    [draftKey('recent')]: { session: 'recent', t: T0 - DAY, ...body([['ver']]) },
  })
  await w.clock.set(T0)
  await start($)
  await settle(w)
  await command($)
  await settle(w)
  expect(isOpen(w.persisted, SESSION_ID)).toBe(true)
  expect(w.persisted.has(draftKey('old'))).toBe(false)
  expect(w.persisted.has(draftKey('recent'))).toBe(true)
  expect(draftKeys(w.persisted, SESSION_ID).length > 0).toBe(true)
})

test('#521 FIX2 Р13: a refused prune is recorded as picker-draft-prune and the panel opens', async () => {
  SL.__resetState()
  const handlers: Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>> = {}
  const on = (event: string, ...rest: unknown[]): void => { handlers[event] = rest[rest.length - 1] as never }
  try {
    SL.register(on as never, {} as never)
    const base = gatherStand()
    const persisted = new Map<string, unknown>()
    const store = { ...standOf(persisted).store, keys: async () => { throw new Error('keys refused by the test') } }
    const $ = { ...base, store, ui: { ...base.ui, open: async () => undefined }, session: { ...base.session, surfaces: async () => ['terminal'] } }
    await handlers['command.run']!($ as never, { command: 'statusline-mod', args: '' } as never, async (v: unknown) => v)
    await drain()
    expect(SL.__stateSnapshot()['pickerOpen']).toBe(true)
    expect(SL.__diag().filter((d) => d.key === 'picker-draft-prune').map((d) => d.kind + ' ' + d.text.includes('keys refused by the test'))).toEqual(['info true'])
  } finally {
    SL.__resetState()
  }
})

// ---------- Р14: the undo record and the save mark share one saveId ----------

const MARK = { saveId: 's2', fields: ['template', 'numUsd'], values: { template: 'x||y', numUsd: 'short' } }

test('#521 FIX2 Р14: an interrupted save leaves an older undo record whole — another saveId or none', async () => {
  SL.__resetState()
  try {
    for (const older of [{ saveId: 's1', fields: ['template'], prev: { template: '' }, written: { template: 'a' } }, { fields: ['template'], prev: { template: '' }, written: { template: 'a' } }]) {
      SL.__resetState()
      const persisted = new Map<string, unknown>([[STORE_SAVING, MARK], [STORE_UNDO, [older]]])
      await SL.restoreAfterReload(standOf(persisted), {} as never)
      // #521 FIX4 Ф3: the bare array is laid out by saveId; a record without one gets a synthetic id
      const left = undoStack(persisted)
      expect(left.map((r) => ({ fields: r.fields, prev: r.prev, written: r.written }))).toEqual([{ fields: older.fields, prev: older.prev, written: older.written }])
      if (older.saveId !== undefined) expect(left[0]!.saveId).toBe(older.saveId)
    }
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX2 Р14: the interrupted save\'s own record is cut to the landed fields and keeps its saveId', async () => {
  SL.__resetState()
  try {
    const own = { saveId: 's2', fields: ['template', 'numUsd'], prev: { template: '', numUsd: 'exact' }, written: { template: 'x||y', numUsd: 'short' } }
    const persisted = new Map<string, unknown>([[STORE_SAVING, MARK], [STORE_UNDO, [own]]])
    await SL.restoreAfterReload(standOf(persisted), { numUsd: 'short' } as never)
    expect(undoStack(persisted).map((r) => ({ saveId: r.saveId, fields: r.fields, prev: r.prev, written: r.written }))).toEqual([{ saveId: 's2', fields: ['numUsd'], prev: { numUsd: 'exact' }, written: { numUsd: 'short' } }])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX2 Р14: a save writes one saveId into its mark and into its undo record', async () => {
  SL.__resetState()
  try {
    const sets: Array<{ key: string; value: any }> = []
    const persisted = new Map<string, unknown>()
    const store = {
      get: async (k: string) => persisted.get(k),
      set: async (k: string, v: unknown) => { const copy = JSON.parse(JSON.stringify(v)); sets.push({ key: k, value: copy }); persisted.set(k, copy) },
      delete: async (k: string) => { persisted.delete(k) },
      keys: async () => [...persisted.keys()],
    }
    const engine = {
      config: { list: async () => OPTION_ROWS.map((r) => ({ ...r })), set: async (e: { value: unknown }) => ({ value: e.value }) },
      ui: { log: async () => undefined, invalidate: () => undefined },
      clock: { after: () => ({ cancel() {} }) },
    }
    const pressOn = async (tab: string, key: string): Promise<void> => {
      const node = walk(SL.__renderPicker({}, tab, 120, undefined, store, engine) as Node).find((n) => n.type === 'Button' && keyOf(n) === key)
      expect(node).toBeDefined()
      ;(node!.props!['onPress'] as () => void)()
      for (let i = 0; i < 8; i++) await drain()
    }
    await pressOn('numbers', 'num:numTokens:raw')
    await pressOn('numbers', 'save')
    // #551 §3.8: the mark and every revision of the record are publications,
    // each under a key of its own; the saveId they carry ties them
    const markSet = sets.find((s) => s.key.startsWith(NS_SAVING + ':'))
    const mark = markSet?.value
    expect(sets.some((s) => s.key.startsWith(STORE_SAVING) || s.key.startsWith(STORE_UNDO))).toBe(false)
    const undoSets = sets.filter((s) => s.key.startsWith(NS_UNDO + ':'))
    expect(new Set(undoSets.map((s) => s.key)).size).toBe(undoSets.length)
    const undoWrites = undoSets.map((s) => s.value)
    expect(typeof mark?.saveId).toBe('string')
    expect(undoWrites.length).toBe(2)
    expect(undoWrites.map((u: { saveId?: unknown }) => u.saveId)).toEqual([mark.saveId, mark.saveId])
  } finally {
    SL.__resetState()
  }
})

// ---------- Р15: a partly refused undo keeps what it could not revert ----------

test('#521 FIX2 Р15: a partly refused undo takes off only the reverted fields, names the rest and can be pressed again', async ($, on) => {
  let refuse = false
  const c = await openPanel($, on, {
    'config.set': (_$: any, e: any) => (refuse && String(e.key).endsWith('.numTokens') ? { deny: 'locked' } : { value: e.value }),
  })
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  await press(c, 'num:numUsd:short')
  await press(c, 'save')
  const saved = undoStack(c.w.persisted).slice(-1)[0]!
  expect([...saved.fields].sort()).toEqual(['numTokens', 'numUsd', 'template'])
  refuse = true
  await press(c, 'undo')
  const texts = textsOf(await nodesOf(c.pane))
  expect(texts.some((t) => t.includes('НЕ записано numTokens: locked') && t.includes('можно повторить'))).toBe(true)
  const left = undoStack(c.w.persisted)
  expect(left.length).toBe(1)
  expect(left[0]!.fields).toEqual(['numTokens'])
  expect(left[0]!.saveId).toBe(saved.saveId)
  refuse = false
  await press(c, 'undo')
  expect(textsOf(await nodesOf(c.pane)).some((t) => t === 'отменено')).toBe(true)
  expect(undoStack(c.w.persisted)).toEqual([])
})

// ---------- Р16: the panel on every surface ----------

for (const surface of SURFACES4) {
  test('#521 FIX2 Р16: ' + surface + ' — the live pane draws the panel; ' + (surface === 'mobile' ? 'pills and /config lines stand for Select and Input' : 'Select and Input stand'), async ($, on) => {
    const c = await openPanel($, on, {}, {}, { surface })
    let nodes = await nodesOf(c.pane)
    expect(textsOf(nodes).some((t) => t.includes('Open /statusline-mod in the terminal'))).toBe(false)
    expect(buttonKeys(nodes)).toContain('tab:view')
    await press(c, 'tab:view')
    nodes = await nodesOf(c.pane)
    if (surface !== 'mobile') {
      expect(nodes.filter((n) => n.type === 'Select').map(keyOf)).toContain('ax:palette')
      await press(c, 'tab:elements')
      expect((await nodesOf(c.pane)).filter((n) => n.type === 'Input').map(keyOf)).toContain('filter')
      return
    }
    expect(nodes.filter((n) => n.type === 'Select')).toEqual([])
    await press(c, 'ax:palette:mono')
    expect(draftOf(c.w)?.axes?.palette).toBe('mono')
    await press(c, 'tab:elements')
    nodes = await nodesOf(c.pane)
    expect(nodes.filter((n) => n.type === 'Input')).toEqual([])
    // CONSTRAINT (#521 FIX3 AR-2): the search is not a setting — no /config row
    expect(textsOf(nodes)).toContain('поиск здесь недоступен')
    await press(c, 'tab:layout')
    await press(c, 'seg:ctx')
    await press(c, 'edit')
    nodes = await nodesOf(c.pane)
    expect(nodes.filter((n) => n.type === 'Input')).toEqual([])
    expect(textsOf(nodes).filter((t) => t === 'ввод текста здесь недоступен — поле: /config catalyst-statusline.elements').length).toBeGreaterThanOrEqual(2)
    await press(c, 'tab:themes')
    nodes = await nodesOf(c.pane)
    expect(nodes.filter((n) => n.type === 'Input')).toEqual([])
    // #521 FIX4 Ф5: no /config row carries a theme name
    expect(textsOf(nodes)).toContain('имя темы меняется на терминале или десктопе')
  })
}

// ---------- Р17: the theme buttons carry the focus preview ----------

const focusEvent = (element: string): Record<string, unknown> => ({ component: 'Pane', requestId: 'statusline', plugin: 'catalyst-statusline', element, origin: { kind: 'person' } })
const previewTexts = async (pane: Pane): Promise<string[]> => {
  const root = walk((await pane.drawn()) as Node)
  const preview = ((root[0]?.children ?? []) as Node[])[0]
  return walk(preview).filter((n) => n.type === 'Text').map(textOf)
}

for (const surface of SURFACES4) {
  test('#521 FIX2 Р17: ' + surface + ' — «Темы» draws a button per theme; a focus on one previews it and leaves the draft', async ($, on) => {
    const c = await openPanel($, on, {}, {}, { surface })
    await press(c, 'tab:themes')
    const nodes = await nodesOf(c.pane)
    expect(nodes.filter((n) => n.type === 'Select').map(keyOf)).not.toContain('theme')
    const themes = buttonKeys(nodes).filter((k) => k.startsWith('theme:'))
    expect(themes.length).toBeGreaterThanOrEqual(14)
    expect(themes).toContain('theme:claude-code')
    expect(await previewTexts(c.pane)).toContain(' │ ')
    const axes = JSON.stringify(draftOf(c.w)?.axes)
    await c.$.ui.focus(focusEvent('theme:claude-code') as any)
    await settle(c.w)
    const focused = await previewTexts(c.pane)
    expect(focused).not.toContain(' │ ')
    expect(focused).toContain('|')
    expect(JSON.stringify(draftOf(c.w)?.axes)).toBe(axes)
  })
}

// ---------- Р18: the stand's { deny } is a refusal ----------

// CONSTRAINT: the test's `$` has no config noun — the next config.list is the
// one the undo reads for its behind-the-picker check
test('#521 FIX2 Р18: a { deny } answer of config.set leaves the /config row as it was — the undo that reads it next goes through', async ($, on) => {
  let deny = false
  const c = await openPanel($, on, { 'config.set': (_$: any, e: any) => (deny && String(e.key).endsWith('.numTokens') ? { deny: 'locked' } : { value: e.value }) })
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  await press(c, 'save')
  deny = true
  await press(c, 'undo')
  expect(textsOf(await nodesOf(c.pane)).some((t) => t.includes('НЕ записано numTokens: locked'))).toBe(true)
  deny = false
  await press(c, 'undo')
  const texts = textsOf(await nodesOf(c.pane))
  expect(texts.some((t) => t.includes('поле меняли в обход'))).toBe(false)
  expect(texts.some((t) => t === 'отменено')).toBe(true)
})

// ---------- Р19: a refused redraw is recorded and retried once ----------

test('#521 FIX2 Р19: a redraw refused once is recorded and retried after 250 ms', async () => {
  SL.__resetState()
  try {
    let calls = 0
    const armed: Array<{ ms: number; fn: () => void }> = []
    const $ = standOf(new Map(), {
      ui: { log: async () => undefined, invalidate: () => { calls++; if (calls === 1) throw new Error('redraw refused by the test') } },
      clock: { after: (ms: number, fn: () => void) => { armed.push({ ms, fn }); return { cancel() {} } } },
    })
    await SL.closeKeepDraft($)
    expect(calls).toBe(1)
    expect(armed.map((a) => a.ms)).toEqual([250])
    expect(SL.__diag().filter((d) => d.key === 'picker-invalidate').map((d) => d.kind + ' ' + d.text.includes('redraw refused by the test'))).toEqual(['warn true'])
    armed[0]!.fn()
    expect(calls).toBe(2)
    expect(armed.length).toBe(1)
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX2 Р19: a redraw that refuses every time is tried exactly twice', async () => {
  SL.__resetState()
  try {
    let calls = 0
    const armed: Array<() => void> = []
    const $ = standOf(new Map(), {
      ui: { log: async () => undefined, invalidate: () => { calls++; throw new Error('redraw refused by the test') } },
      clock: { after: (_ms: number, fn: () => void) => { armed.push(fn); return { cancel() {} } } },
    })
    await SL.closeKeepDraft($)
    for (let i = 0; i < armed.length && i < 5; i++) armed[i]!()
    expect(calls).toBe(2)
    expect(armed.length).toBe(1)
    expect(SL.__diag().some((d) => d.key === 'picker-invalidate')).toBe(true)
  } finally {
    SL.__resetState()
  }
})

// ---------- Р20: a refused session root is said aloud ----------

const ROOT_TEXT = 'корень сессии неизвестен: Error: root refused by the test; читается от cwd'

test('#521 FIX2 Р20: the gather — a refused root is recorded once per session, the cwd stands in', async () => {
  SL.__resetState()
  try {
    let id = 'A'
    const $ = gatherStand({ root: rootRefused, id: async () => id })
    const records = (): string[] => SL.__diag().filter((d) => d.key === 'session-root').map((d) => d.kind + ' ' + d.text)
    SL.__render({})
    await SL.__refresh($)
    await drain()
    expect(records()).toEqual(['warn ' + ROOT_TEXT])
    await SL.__refresh($)
    await drain()
    expect(records().length).toBe(1)
    id = 'B'
    await SL.__refresh($)
    await drain()
    await SL.__refresh($)
    await drain()
    expect(records()).toEqual(['warn ' + ROOT_TEXT, 'warn ' + ROOT_TEXT])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX2 Р20: the project file source — a refused root is recorded and CLAUDE.md is read from the cwd', async () => {
  SL.__resetState()
  const runs: Array<() => void> = []
  SL.__setArmEvery((_ms: number, fn: () => void) => { runs.push(fn); return { cancel() {} } })
  try {
    const reads: string[] = []
    const $ = gatherStand({ root: rootRefused, reads })
    SL.__render({ template: 'cfg' })
    await SL.__syncSourceTimers($)
    await drain()
    for (const fn of runs.slice()) fn()
    for (let i = 0; i < 4; i++) await drain()
    expect(reads).toContain('/work/demo/sub/CLAUDE.md')
    expect(SL.__diag().filter((d) => d.key === 'session-root').map((d) => d.kind + ' ' + d.text)).toEqual(['warn ' + ROOT_TEXT])
  } finally {
    SL.__setArmEvery(null)
    SL.__resetState()
  }
})

// ---------- Р21: the press census from a clean draft ----------

const START_FOCUS = JSON.stringify({ line: 0, seg: 0 })
const contentOf = (d: any): string => JSON.stringify({ lines: d?.lines, axes: d?.axes, elements: d?.elements })
type Seen = { draft: string; open: boolean; closed: number; texts: Set<string> }
const observe = async (c: Ctx): Promise<Seen> => ({
  // CONSTRAINT (#521 FIX2 Р13): the stored record carries a write stamp `t` that
  // every persist renews — a press is judged by the draft, not by its stamp
  draft: JSON.stringify(draftOf(c.w) == null ? null : { ...draftOf(c.w), t: undefined }),
  open: isOpen(c.w.persisted, SESSION_ID),
  closed: c.w.closed.length,
  texts: new Set(textsOf(await nodesOf(c.pane))),
})
const hadEffect = (a: Seen, b: Seen): boolean =>
  a.draft !== b.draft || a.open !== b.open || b.closed > a.closed || [...b.texts].some((t) => t.trim() !== '' && !a.texts.has(t))
const liveKey = (keys: string[], key: string): string | undefined => {
  if (keys.includes(key)) return key
  if (!key.includes('#move')) return undefined
  const stem = key.slice(0, key.indexOf('#move'))
  return keys.find((k) => k === stem || k.startsWith(stem + '#move'))
}
const enter = async (c: Ctx, target: string): Promise<void> => {
  if (target === 'element') {
    await press(c, 'tab:layout')
    await press(c, 'edit')
    return
  }
  await press(c, target === 'layout' ? 'tab:view' : 'tab:layout')
  await press(c, 'tab:' + target)
}
const toCleanStart = async (c: Ctx, target: string, start: string): Promise<boolean> => {
  if (!isOpen(c.w.persisted, SESSION_ID)) {
    await command(c.$)
    await settle(c.w)
  }
  for (let i = 0; i < 12 && (draftOf(c.w)?.undo ?? []).length > 0; i++) await press(c, 'undo-step')
  let d = draftOf(c.w)
  if (d.fam !== 'model' || (d.page ?? 0) !== 0 || (d.query ?? '') !== '' || d.targetLine !== 0) {
    await press(c, 'tab:layout')
    await press(c, 'line:0:add')
    if ((draftOf(c.w).query ?? '') !== '') await c.pane.input({ key: 'filter', text: '' })
    await press(c, 'fam:all')
    await press(c, 'fam:model')
  }
  d = draftOf(c.w)
  if (JSON.stringify(d.focus) !== START_FOCUS) {
    await press(c, 'tab:layout')
    const seg = buttonKeys(await nodesOf(c.pane)).find((k) => k === 'seg:model' || k.startsWith('seg:model#move'))
    if (seg) await press(c, seg)
  }
  await enter(c, target)
  d = draftOf(c.w)
  return contentOf(d) === start && (d.undo ?? []).length === 0 && JSON.stringify(d.focus) === START_FOCUS && d.tab === target && isOpen(c.w.persisted, SESSION_ID)
}

for (const target of ['layout', 'elements', 'element', 'view', 'themes', 'numbers']) {
  test('#521 FIX2 Р21: every button of «' + target + '» has a visible result from a clean draft with an empty step stack', { timeoutMs: 120000 }, async ($, on) => {
    const c = await openPanel($, on)
    await press(c, 'tab:layout')
    await press(c, 'seg:model')
    const start = contentOf(draftOf(c.w))
    expect((draftOf(c.w)?.undo ?? []).length).toBe(0)
    await enter(c, target)
    const keys = buttonKeys(await nodesOf(c.pane))
    expect(keys).not.toContain('discard')
    const dead: string[] = []
    const unreachedStart: string[] = []
    let pressed = 0
    for (const key of keys) {
      if (!(await toCleanStart(c, target, start))) unreachedStart.push(key)
      const live = liveKey(buttonKeys(await nodesOf(c.pane)), key)
      if (!live) {
        unreachedStart.push('absent ' + key)
        continue
      }
      const before = await observe(c)
      await press(c, live)
      pressed++
      if (!hadEffect(before, await observe(c))) dead.push(target + ' ' + key)
    }
    expect(pressed).toBeGreaterThan(0)
    expect({ dead, unreachedStart }).toEqual({ dead: [], unreachedStart: [] })
  })
}

// ---------- Р22: the mouse hint belongs to the terminal outside fullscreen ----------

for (const surface of SURFACES4) {
  test('#521 FIX2 Р22: ' + surface + ' outside fullscreen — the mouse hint ' + (surface === 'terminal' ? 'stands' : 'is absent'), async ($, on) => {
    const c = await openPanel($, on, {}, {}, { surface, viewport: { columns: 140, rows: 40, isFullscreen: false } })
    const hint = textsOf(await nodesOf(c.pane)).find((t) => t.includes('Esc — закрыть (черновик сохранится)'))
    expect(hint).toBeDefined()
    if (surface === 'terminal') expect(hint).toContain('мышь вне полноэкранного режима не работает')
    else expect(hint).not.toContain('мышь')
  })
}

// ---------- Р23: each axis Select offers the axis's own choices in order ----------

test('#521 FIX2 Р23: every axis Select on the terminal offers the axis choices in their order', async ($, on) => {
  const c = await openPanel($, on)
  await press(c, 'tab:view')
  const selects = ((await c.pane.findAll({ type: 'Select' })) as Node[]).filter((n) => keyOf(n).startsWith('ax:'))
  SL.__resetState()
  const pills = buttonKeys(walk(SL.__renderPicker({}, 'view', 120) as Node)).filter((k) => k.startsWith('ax:'))
  SL.__resetState()
  expect(selects.length).toBeGreaterThan(0)
  for (const sel of selects) {
    const axis = keyOf(sel).slice('ax:'.length)
    const expected = pills.filter((k) => k.startsWith('ax:' + axis + ':')).map((k) => k.slice(('ax:' + axis + ':').length))
    const got = ((propOf(sel, 'options') ?? []) as { value: string }[]).map((o) => o.value)
    expect({ axis, count: expected.length > 1 }).toEqual({ axis, count: true })
    expect({ axis, got }).toEqual({ axis, got: expected })
  }
})

// ---------- Р25: the counter names changed fields ----------

test('#521 FIX2 Р25: the state line and the continued-draft notice count changed fields', async ($, on) => {
  const c = await openPanel($, on)
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  await press(c, 'num:numTokens:grouped')
  expect(textsOf(await nodesOf(c.pane)).find((t) => t.includes('цель: строка 1'))).toBe('Числа · цель: строка 1 · черновик: изменено полей: 1 не сохранено')
  await press(c, 'num:numUsd:short')
  expect(textsOf(await nodesOf(c.pane)).find((t) => t.includes('цель: строка 1'))).toBe('Числа · цель: строка 1 · черновик: изменено полей: 2 не сохранено')
  await press(c, 'close')
  await command($)
  await settle(c.w)
  expect(await hasText(c, 'продолжен несохранённый черновик (изменено полей: 2)')).toBe(true)
})

// ---------- Р26: «Отменить все правки» is a step «↶ Шаг назад» takes back ----------

test('#521 FIX2 Р26: discard says the step takes it back, and undo-step returns the edits', async ($, on) => {
  const c = await openPanel($, on)
  const saved = contentOf(draftOf(c.w))
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  await press(c, 'num:numUsd:short')
  const edited = contentOf(draftOf(c.w))
  await press(c, 'discard')
  expect(contentOf(draftOf(c.w))).toBe(saved)
  expect(textsOf(await nodesOf(c.pane))).toContain('правки отброшены — «↶ Шаг назад» вернёт их')
  await press(c, 'undo-step')
  expect(contentOf(draftOf(c.w))).toBe(edited)
})

// ---------- Р27: the close removes only its own open flag ----------

test('#521 FIX2 Р27: the open flag carries a token; the close removes the flag of its own open', async ($, on) => {
  const c = await openPanel($, on)
  // #551 §3.2: one publication per open, carrying its openId
  const flags = openFlags(c.w.persisted)
  expect(flags.length).toBe(1)
  const open = flags[0]!
  expect(open.session).toBe(SESSION_ID)
  expect(typeof open.openId).toBe('string')
  expect(flagKeys(c.w.persisted, SESSION_ID).every((k) => k.startsWith(NS_OPEN + '.'))).toBe(true)
  await press(c, 'close')
  expect(isOpen(c.w.persisted, SESSION_ID)).toBe(false)
})

test('#521 FIX2 Р27: an open that lands between the close and its removal keeps its flag', async () => {
  SL.__resetState()
  try {
    // #551 D2: another environment's open lands under a key of its own; the
    // close deletes only the keys of its own open (the stand has no clock: the
    // process clock stamps the flags)
    const persisted = new Map<string, unknown>([[STORE_OPEN, { session: 'A', token: 't-old', at: Date.now() }], [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
    const $ = standOf(persisted)
    await SL.restoreAfterReload($, {} as never)
    expect(SL.__stateSnapshot()['pickerOpen']).toBe(true)
    const set = $.store.set
    $.store.set = async (k: string, v: unknown) => {
      await set(k, v)
      if (k.startsWith(NS_DRAFT)) persisted.set(v3Key(NS_OPEN, 'A', EXT_WRITER, 1), { openId: 'ext-new', session: 'A', e: 0, n: 1, at: Date.now() })
    }
    await SL.closeKeepDraft($)
    expect(openFlags(persisted).map((f) => f.openId)).toEqual(['ext-new'])
    SL.__resetState()
    const own = new Map<string, unknown>([[STORE_OPEN, { session: 'A', token: 't-old', at: Date.now() }], [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
    const $own = standOf(own)
    await SL.restoreAfterReload($own, {} as never)
    await SL.closeKeepDraft($own)
    // #551 D8: the previous version's flag is read only — it stays, and the close mark keeps it closed
    expect(own.has(STORE_OPEN)).toBe(true)
    expect(openFlags(own)).toEqual([])
    SL.__resetState()
    await SL.restoreAfterReload(standOf(own), {} as never)
    expect(SL.__stateSnapshot()['pickerOpen']).toBe(false)
  } finally {
    SL.__resetState()
  }
})
