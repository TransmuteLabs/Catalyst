import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { world, start, command, PANE_MOUNT, walk, textOf, STORE_DRAFT, STORE_OPEN, STORE_UNDO, SESSION_ID, OPTION_ROWS, openFlags, isOpen, undoStack, saveMarks, themeRecords } from './world'
import type { Node, World } from './world'

// #521 FIX4 teeth (Ф1–Ф10). CONSTRAINT (ANALYSIS-521-swe2 traps 1-2): a kit
// pane is drawn by the kit's own plugin instance — it is read through the
// drawn tree and the world's records only; the stand teeth drive the imported
// module. CONSTRAINT (s521-fix1 tooth 11): the kit skips a store hook that
// throws, so every refused store write is stood up in this realm.

type Pane = {
  drawn: () => Promise<unknown>
  press: (t: { key: string }) => Promise<unknown>
}
type Ctx = { $: any; w: World; pane: Pane }

const DAY = 86400000
const keyOf = (n: Node): string => String(n.key ?? (n.props as Record<string, unknown> | undefined)?.['key'] ?? '')
const drain = async (): Promise<void> => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const drainLong = async (): Promise<void> => { for (let i = 0; i < 12; i++) await drain() }
const settle = async (w: World): Promise<void> => { await w.clock.settle(); await drain() }
const draftKey = (session: string): string => STORE_DRAFT + ':' + session
const draftOf = (w: World, session = SESSION_ID): any => w.persisted.get(draftKey(session))
const nodesOf = async (pane: Pane): Promise<Node[]> => walk((await pane.drawn()) as Node)
const textsOf = (nodes: Node[]): string[] => nodes.filter((n) => n.type === 'Text').map(textOf)
const buttonKeys = (nodes: Node[]): string[] => nodes.filter((n) => n.type === 'Button').map(keyOf)
const hasText = async (c: Ctx, part: string): Promise<boolean> => textsOf(await nodesOf(c.pane)).some((t) => t.includes(part))
const barText = (template: string): string => textsOf(walk(SL.__render({ template, details: 'off' }) as Node)).join('')
const snap = (): Record<string, any> => SL.__stateSnapshot() as Record<string, any>

const press = async (c: Ctx, key: string): Promise<void> => {
  await c.pane.press({ key })
  await settle(c.w)
}

const openPanel = async ($: any, on: any, over: Record<string, (...args: any[]) => unknown> = {}, store: Record<string, unknown> = {}, mount: Record<string, unknown> = {}): Promise<Ctx> => {
  const w = world(on, over, store)
  await start($)
  await settle(w)
  await command($)
  await settle(w)
  const pane = (await $.ui.mount({ ...PANE_MOUNT, props: { ...PANE_MOUNT.props, bodyColumns: 140 }, ...mount })) as Pane
  await settle(w)
  return { $, w, pane }
}

const body = (ids: string[][]): Record<string, unknown> => ({
  lines: ids.map((l) => l.map((id) => ({ id, body: '{' + id + '.text}' }))), axes: {}, elements: {}, focus: null, tab: 'layout', query: '', fam: 'model', page: 0, targetLine: 0, themeName: '',
})

type StoreStand = {
  get: (k: string) => Promise<unknown>
  set: (k: string, v: unknown) => Promise<void>
  delete: (k: string) => Promise<void>
  keys: () => Promise<string[]>
}

// the kit store's semantics over one map; `refuse` names the keys whose write throws
const storeOf = (persisted: Map<string, unknown>, refuse: (k: string) => boolean = () => false): StoreStand => ({
  get: async (k) => persisted.get(k),
  set: async (k, v) => {
    if (refuse(k)) throw new Error('write of ' + k.split(':')[0] + ' refused by the test')
    persisted.set(k, JSON.parse(JSON.stringify(v)))
  },
  delete: async (k) => { persisted.delete(k) },
  keys: async () => [...persisted.keys()],
})

// the stand the gather, the restore and the picker run against
const gatherStand = (over: { root?: () => Promise<string>; id?: () => Promise<string>; store?: StoreStand } = {}): any => ({
  clock: { now: async () => 5000, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  ui: { log: async () => undefined, invalidate: () => undefined, status: () => undefined, toast: () => undefined, open: async () => undefined },
  store: over.store ?? storeOf(new Map()),
  session: {
    id: over.id ?? (async () => 'A'),
    cwd: async () => '/work/demo/sub',
    root: over.root ?? (async () => '/work/demo'),
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

// /config rows that answer what was last written to them
const configOf = (values: Map<string, unknown>, set?: (e: { key: string; value: unknown }) => Promise<unknown>) => ({
  list: async () => OPTION_ROWS.map((r) => (values.has(r.key) ? { ...r, value: values.get(r.key) } : { ...r })),
  set: async (e: { key: string; value: unknown }) => {
    const answer = set ? await set(e) : undefined
    if (answer && typeof answer === 'object' && 'deny' in answer) return answer
    values.set(e.key, e.value)
    return { value: e.value }
  },
})

const engineOf = (config: ReturnType<typeof configOf>, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  config,
  ui: { log: async () => undefined, invalidate: () => undefined },
  clock: { after: () => ({ cancel() {} }) },
  ...extra,
})

const pressIn = async (store: StoreStand, engine: Record<string, unknown>, tab: string, key: string): Promise<void> => {
  const node = walk(SL.__renderPicker({}, tab, 120, undefined, store, engine) as Node).find((n) => n.type === 'Button' && keyOf(n) === key)
  expect({ key, drawn: node !== undefined }).toEqual({ key, drawn: true })
  ;(node!.props!['onPress'] as () => void)()
  await drainLong()
}

const ROW = (field: string): string => 'catalyst-statusline.' + field

// ---------- Ф1: the open panel holds the current session's draft ----------

const REBOUND = 'сессия сменилась — черновик прежней сессии сохранён'

test('#521 FIX4 Ф1: a session change under the open panel rebinds it — A keeps its draft under A, Save in B writes none of A\'s edits', async ($, on) => {
  let session = 'A'
  const c = await openPanel($, on, { 'session.id': () => ({ value: session }) })
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  const before = c.w.writes.length
  session = 'B'
  await start($)
  await settle(c.w)
  expect(await hasText(c, REBOUND)).toBe(true)
  expect(draftOf(c.w, 'A')?.axes?.numTokens).toBe('raw')
  expect(draftOf(c.w, 'B')?.session).toBe('B')
  expect(isOpen(c.w.persisted, 'B')).toBe(true)
  expect(isOpen(c.w.persisted, 'A')).toBe(false)
  await press(c, 'save')
  expect(c.w.writes.slice(before).filter((x) => x.key.endsWith('.numTokens'))).toEqual([])
})

test('#521 FIX4 Ф1: Save pressed after the session changed and before a refresh saw it writes nothing of A and rebinds the panel', async ($, on) => {
  let session = 'A'
  const c = await openPanel($, on, { 'session.id': () => ({ value: session }) })
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  const before = c.w.writes.length
  session = 'B'
  await press(c, 'save')
  expect(c.w.writes.slice(before)).toEqual([])
  expect(draftOf(c.w, 'A')?.axes?.numTokens).toBe('raw')
  expect(await hasText(c, REBOUND)).toBe(true)
})

// ---------- Ф2: one open flag per token ----------

test('#521 FIX4 Ф2: an open that lands between any two awaits of the close keeps its flag; the close takes only its own', async () => {
  let exercised = 0
  for (let at = 0; at < 16; at++) {
    SL.__resetState()
    try {
      const persisted = new Map<string, unknown>([[STORE_OPEN + ':t-old', { session: 'A', token: 't-old', t: 1 }], [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
      const base = storeOf(persisted)
      const $ = gatherStand({ store: base })
      await SL.restoreAfterReload($, {} as never)
      expect(snap()['pickerOpen']).toBe(true)
      let calls = 0
      let landed = false
      const before = (): void => {
        if (calls++ === at) {
          landed = true
          persisted.set(STORE_OPEN + ':t-new', { session: 'A', token: 't-new', t: 2 })
        }
      }
      $.store = {
        get: async (k: string) => { before(); return base.get(k) },
        set: async (k: string, v: unknown) => { before(); return base.set(k, v) },
        delete: async (k: string) => { before(); return base.delete(k) },
        keys: async () => { before(); return base.keys() },
      }
      await SL.closeKeepDraft($)
      if (!landed) break
      exercised++
      expect({ at, flags: openFlags(persisted).map((f) => f.token) }).toEqual({ at, flags: ['t-new'] })
    } finally {
      SL.__resetState()
    }
  }
  expect(exercised).toBeGreaterThan(1)
})

test('#521 FIX4 Ф2: the bare open flag of the old form is read by the restore and moved to its token key', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>([[STORE_OPEN, { session: 'A', token: 't1' }], [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
    await SL.restoreAfterReload(gatherStand({ store: storeOf(persisted) }), {} as never)
    expect(snap()['pickerOpen']).toBe(true)
    expect(persisted.has(STORE_OPEN)).toBe(false)
    // #521 FIX5 Ч1, FIX6 Р1: the moved flag's token is «legacy-» + its session
    expect(openFlags(persisted).map((f) => ({ session: f.session, token: f.token, t: typeof f.t }))).toEqual([{ session: 'A', token: 'legacy-A', t: 'number' }])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX4 Ф2: a refused write of the open flag is recorded as picker-open-flag and the panel opens', async () => {
  SL.__resetState()
  const handlers: Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>> = {}
  const on = (event: string, ...rest: unknown[]): void => { handlers[event] = rest[rest.length - 1] as never }
  try {
    SL.register(on as never, {} as never)
    const $ = gatherStand({ store: storeOf(new Map(), (k) => k.startsWith(STORE_OPEN)) })
    await handlers['command.run']!($ as never, { command: 'statusline-mod', args: '' } as never, async (v: unknown) => v)
    await drainLong()
    expect(snap()['pickerOpen']).toBe(true)
    expect(SL.__diag().filter((d) => d.key === 'picker-open-flag').map((d) => d.kind + ' ' + d.text.includes('refused by the test'))).toEqual(['warn true'])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX4 Ф2: the open prunes open flags older than seven days and keeps the younger ones', async ($, on) => {
  const T0 = Date.now()
  const w = world(on, {}, {
    [STORE_OPEN + ':old']: { session: 'other', token: 'old', t: T0 - 8 * DAY },
    [STORE_OPEN + ':young']: { session: 'other', token: 'young', t: T0 - DAY },
  })
  await w.clock.set(T0)
  await start($)
  await settle(w)
  await command($)
  await settle(w)
  expect(w.persisted.has(STORE_OPEN + ':old')).toBe(false)
  expect(w.persisted.has(STORE_OPEN + ':young')).toBe(true)
  expect(isOpen(w.persisted, SESSION_ID)).toBe(true)
})

// ---------- Ф3: the undo record and the save mark live one per saveId ----------

test('#521 FIX4 Ф3: save 1 in flight, reload, save 2 whole, save 1\'s tail — both records stand and «Откатить сохранение» takes save 2', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const store = storeOf(persisted)
    const values = new Map<string, unknown>()
    let release: (() => void) | null = null
    let parkNext = false
    const engine = engineOf(configOf(values, async () => {
      if (!parkNext) return undefined
      parkNext = false
      await new Promise<void>((r) => { release = r })
      return undefined
    }))
    await pressIn(store, engine, 'numbers', 'num:numTokens:raw')
    parkNext = true
    await pressIn(store, engine, 'numbers', 'save')
    expect(release).not.toBeNull()
    const first = saveMarks(persisted)
    expect(first.length).toBe(1)
    const id1 = first[0]!.saveId
    SL.__resetState()
    await pressIn(store, engine, 'numbers', 'num:numUsd:short')
    await pressIn(store, engine, 'numbers', 'save')
    ;(release as unknown as () => void)()
    await drainLong()
    const stack = undoStack(persisted)
    expect(stack.length).toBe(2)
    expect(stack[0]!.saveId).toBe(id1)
    expect(stack[1]!.fields).toContain('numUsd')
    await pressIn(store, engine, 'numbers', 'undo')
    expect(undoStack(persisted).map((r) => r.saveId)).toEqual([id1])
    expect(values.get(ROW('numUsd'))).toBe(stack[1]!.prev['numUsd'])
    expect(values.get(ROW('numTokens'))).toBe('raw')
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX4 Ф3: the bare undo array of the old form is laid out by saveId once, in its order, and the bare key goes', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>([[STORE_UNDO, [
      { fields: ['numUsd'], prev: { numUsd: 'exact' }, written: { numUsd: 'short' } },
      { saveId: 's2', fields: ['numTokens'], prev: { numTokens: 'compact' }, written: { numTokens: 'raw' } },
    ]]])
    const store = storeOf(persisted)
    const values = new Map<string, unknown>([[ROW('numUsd'), 'short'], [ROW('numTokens'), 'raw']])
    await pressIn(store, engineOf(configOf(values)), 'numbers', 'undo')
    expect(persisted.has(STORE_UNDO)).toBe(false)
    expect(values.get(ROW('numTokens'))).toBe('compact')
    expect(values.get(ROW('numUsd'))).toBe('short')
    const left = undoStack(persisted)
    expect(left.length).toBe(1)
    expect(left[0]!.fields).toEqual(['numUsd'])
    expect(typeof left[0]!.saveId).toBe('string')
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX4 Ф3: UNDO_CAP stands by deleting the oldest record keys', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    for (let i = 1; i <= 30; i++) {
      const id = 'k' + String(i).padStart(2, '0')
      persisted.set(STORE_UNDO + ':' + id, { saveId: id, t: i, fields: ['numRate'], prev: { numRate: 'tok' }, written: { numRate: 'plain' } })
    }
    const store = storeOf(persisted)
    const engine = engineOf(configOf(new Map()))
    await pressIn(store, engine, 'numbers', 'num:numUsd:short')
    await pressIn(store, engine, 'numbers', 'save')
    const stack = undoStack(persisted)
    expect(stack.length).toBe(30)
    expect(stack.some((r) => r.saveId === 'k01')).toBe(false)
    expect(stack[stack.length - 1]!.fields).toContain('numUsd')
  } finally {
    SL.__resetState()
  }
})

// ---------- Ф4: the undo is idempotent per field ----------

test('#521 FIX4 Ф4: a partial undo whose stack write is refused is finished by the repeat — the reverted field counts as done', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    let refuseStack = false
    let deny = false
    const store = storeOf(persisted, (k) => refuseStack && k.startsWith(STORE_UNDO))
    const values = new Map<string, unknown>()
    const engine = engineOf(configOf(values, async (e) => (deny && e.key.endsWith('.numTokens') ? { deny: 'locked' } : undefined)))
    await pressIn(store, engine, 'numbers', 'num:numTokens:raw')
    await pressIn(store, engine, 'numbers', 'num:numUsd:short')
    await pressIn(store, engine, 'numbers', 'save')
    const saved = undoStack(persisted)[0]!
    deny = true
    refuseStack = true
    await pressIn(store, engine, 'numbers', 'undo')
    expect(String(snap()['saveResult'])).toContain('НЕ записано numTokens: locked')
    expect(values.get(ROW('numUsd'))).toBe(saved.prev['numUsd'])
    deny = false
    refuseStack = false
    await pressIn(store, engine, 'numbers', 'undo')
    expect(snap()['saveResult']).toBe('отменено')
    expect(values.get(ROW('numTokens'))).toBe(saved.prev['numTokens'])
    expect(undoStack(persisted)).toEqual([])
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX4 Ф4: an undo cut short by a reload is finished by the repeat, without «меняли в обход»', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const store = storeOf(persisted)
    const values = new Map<string, unknown>()
    let hangAfter = -1
    let calls = 0
    const engine = engineOf(configOf(values, async () => {
      if (hangAfter >= 0 && calls++ >= hangAfter) await new Promise<void>(() => undefined)
      return undefined
    }))
    await pressIn(store, engine, 'numbers', 'num:numTokens:raw')
    await pressIn(store, engine, 'numbers', 'num:numUsd:short')
    await pressIn(store, engine, 'numbers', 'save')
    const saved = undoStack(persisted)[0]!
    expect(saved.fields.length).toBeGreaterThan(1)
    hangAfter = 1
    await pressIn(store, engine, 'numbers', 'undo')
    expect(values.get(ROW(saved.fields[0]!))).toBe(saved.prev[saved.fields[0]!])
    SL.__resetState()
    hangAfter = -1
    await pressIn(store, engine, 'numbers', 'undo')
    expect(snap()['saveResult']).toBe('отменено')
    for (const f of saved.fields) expect({ f, v: values.get(ROW(f)) }).toEqual({ f, v: saved.prev[f] })
    expect(undoStack(persisted)).toEqual([])
  } finally {
    SL.__resetState()
  }
})

// ---------- Ф5: a theme can be saved where there is no Input ----------

test('#521 FIX4 Ф5: on mobile «Сохранить текущий вид как тему» saves «моя тема 1», names it, and the themes list carries it', async ($, on) => {
  const c = await openPanel($, on, {}, {}, { surface: 'mobile' })
  await press(c, 'tab:themes')
  let texts = textsOf(await nodesOf(c.pane))
  expect(texts).toContain('имя темы меняется на терминале или десктопе')
  expect(texts.some((t) => t.includes('/config catalyst-statusline.theme'))).toBe(false)
  await press(c, 'theme-save')
  const nodes = await nodesOf(c.pane)
  texts = textsOf(nodes)
  expect(texts.some((t) => t.includes('«моя тема 1»') && t.includes('сохранена'))).toBe(true)
  expect(buttonKeys(nodes)).toContain('theme:моя тема 1')
  // #521 FIX5 Ч4: one store key per theme
  expect(themeRecords(c.w.persisted).map((r) => r.name)).toContain('моя тема 1')
})

// ---------- Ф6: a draft not written at the session switch is not lost ----------

test('#521 FIX4 Ф6: a draft whose write was refused at the A→B switch stays in memory and lands once the store takes it', async () => {
  SL.__resetState()
  try {
    let session = 'A'
    let refuse = false
    const persisted = new Map<string, unknown>([[STORE_OPEN + ':t1', { session: 'A', token: 't1', t: 1 }], [draftKey('A'), { session: 'A', t: 1, ...body([['ctx']]) }]])
    const store = storeOf(persisted, (k) => refuse && k === draftKey('A'))
    const $ = gatherStand({ id: async () => session, store })
    await SL.restoreAfterReload($, {} as never)
    SL.__render({})
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('A')
    refuse = true
    await pressIn(store, $, 'numbers', 'num:numTokens:raw')
    session = 'B'
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('B')
    expect(SL.__diag().some((d) => d.key === 'picker-draft-store')).toBe(true)
    refuse = false
    session = 'A'
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('A')
    expect((persisted.get(draftKey('A')) as any)?.axes?.numTokens).toBe('raw')
    expect(snap()['draft']?.axes?.numTokens).toBe('raw')
  } finally {
    SL.__resetState()
  }
})

// ---------- Ф7: the (cwd?) mark belongs to the CLAUDE.md part only ----------

const SETTINGS_SRC = { kind: 'file', path: '.claude/settings.json', everyMs: 30000, relativeTo: 'home' } as const
const MD_SRC = { kind: 'file', path: 'CLAUDE.md', everyMs: 30000, relativeTo: 'project' } as const
const HOOKS2 = JSON.stringify({ hooks: { PreToolUse: [{}], PostToolUse: [{}] } })

test('#521 FIX4 Ф7: hooks alone under a degraded read draw «2 hooks» with no mark', async () => {
  SL.__resetState()
  try {
    SL.__render({ template: 'cfg', details: 'off' })
    SL.__feed({ source: SETTINGS_SRC as any, ok: true, data: HOOKS2, now: 5000 })
    SL.__feed({ source: MD_SRC as any, ok: true, data: '', now: 5000, degraded: true })
    const text = barText('cfg')
    expect(text).toContain('2 hooks')
    expect(text).not.toContain('(cwd?)')
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX4 Ф7: CLAUDE.md and hooks under a degraded read mark only the CLAUDE.md part', async () => {
  SL.__resetState()
  try {
    SL.__render({ template: 'cfg', details: 'off' })
    SL.__feed({ source: SETTINGS_SRC as any, ok: true, data: HOOKS2, now: 5000 })
    SL.__feed({ source: MD_SRC as any, ok: true, data: '# x\n', now: 5000, degraded: true })
    const text = barText('cfg')
    expect(text).toContain('1 CLAUDE.md (cwd?)')
    expect(text).toContain('2 hooks')
    expect(text).not.toContain('2 hooks (cwd?)')
  } finally {
    SL.__resetState()
  }
})

// ---------- Ф8: the first refusal of a new session is said at its first gather ----------

test('#521 FIX4 Ф8: one refresh after the id changed records the new session\'s refused root', async () => {
  SL.__resetState()
  try {
    let id = 'A'
    const $ = gatherStand({ root: async () => { throw new Error('root refused by the test') }, id: async () => id })
    const records = (): number => SL.__diag().filter((d) => d.key === 'session-root').length
    SL.__render({})
    await SL.__refresh($)
    await drain()
    expect(records()).toBe(1)
    id = 'B'
    await SL.__refresh($)
    await drain()
    expect(records()).toBe(2)
  } finally {
    SL.__resetState()
  }
})

// ---------- Ф9: the bare draft slot is pruned too ----------

test('#521 FIX4 Ф9: a bare draft slot without a stamp is stamped at the first prune and starts to age', async ($, on) => {
  const T0 = Date.now()
  const w = world(on, {}, { [STORE_DRAFT]: { session: 'other', ...body([['ver']]) } })
  await w.clock.set(T0)
  await start($)
  await settle(w)
  await command($)
  await settle(w)
  const slot = w.persisted.get(STORE_DRAFT) as { session?: string; t?: unknown } | undefined
  expect(slot?.session).toBe('other')
  expect(typeof slot?.t).toBe('number')
})

test('#521 FIX4 Ф9: a bare draft slot stamped older than seven days is pruned', async ($, on) => {
  const T0 = Date.now()
  const w = world(on, {}, { [STORE_DRAFT]: { session: 'other', t: T0 - 8 * DAY, ...body([['ver']]) } })
  await w.clock.set(T0)
  await start($)
  await settle(w)
  await command($)
  await settle(w)
  expect(w.persisted.has(STORE_DRAFT)).toBe(false)
})

// ---------- Ф10: a refused slot move is a transfer refusal, not a read refusal ----------

test('#521 FIX4 Ф10: a refused write of the slot move is picker-draft-transfer; the panel opens with the slot\'s draft and the move lands at the next write', async () => {
  SL.__resetState()
  try {
    let refuse = true
    const persisted = new Map<string, unknown>([[STORE_OPEN + ':t1', { session: 'A', token: 't1', t: 1 }], [STORE_DRAFT, { session: 'A', ...body([['ctx']]) }]])
    const $ = gatherStand({ store: storeOf(persisted, (k) => refuse && k === draftKey('A')) })
    await SL.restoreAfterReload($, {} as never)
    expect(snap()['pickerOpen']).toBe(true)
    expect(snap()['draft']?.lines?.map((l: { id: string }[]) => l.map((s) => s.id))).toEqual([['ctx']])
    const keys = SL.__diag().map((d) => d.key)
    expect(keys).toContain('picker-draft-transfer')
    expect(keys).not.toContain('picker-restore-read')
    expect(keys).not.toContain('picker-draft-read')
    refuse = false
    await SL.closeKeepDraft($)
    expect(persisted.has(draftKey('A'))).toBe(true)
    expect(persisted.has(STORE_DRAFT)).toBe(false)
  } finally {
    SL.__resetState()
  }
})
