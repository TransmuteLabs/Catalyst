import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { walk, STORE_DRAFT, STORE_OPEN, OPTION_ROWS, draftOf as draftIn, fnv64, v3Keys, NS_DRAFT, NS_UNDO } from './world'
import type { Node } from './world'

// #521 FIX4b teeth (AR1–AR3 of FIX4). CONSTRAINT (s521-fix1 tooth 11): the kit
// skips a store hook that throws, so every refused store write or read is stood
// up in this realm and the module is driven directly.

const keyOf = (n: Node): string => String(n.key ?? (n.props as Record<string, unknown> | undefined)?.['key'] ?? '')
const drain = async (): Promise<void> => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const drainLong = async (): Promise<void> => { for (let i = 0; i < 12; i++) await drain() }
const draftKey = (session: string): string => STORE_DRAFT + ':' + session
const snap = (): Record<string, any> => SL.__stateSnapshot() as Record<string, any>
const unstamped = (x: unknown): string => JSON.stringify(x == null ? null : { ...(x as Record<string, unknown>), t: undefined })

const body = (ids: string[][], axes: Record<string, string> = {}): Record<string, unknown> => ({
  lines: ids.map((l) => l.map((id) => ({ id, body: '{' + id + '.text}' }))), axes, elements: {}, focus: null, tab: 'layout', query: '', fam: 'model', page: 0, targetLine: 0, themeName: '',
})

type StoreStand = {
  get: (k: string) => Promise<unknown>
  set: (k: string, v: unknown) => Promise<void>
  delete: (k: string) => Promise<void>
  keys: () => Promise<string[]>
}

// the kit store's semantics over one map; `refuseSet`/`refuseGet` name the keys that throw
const storeOf = (persisted: Map<string, unknown>, refuseSet: (k: string) => boolean = () => false, refuseGet: (k: string) => boolean = () => false): StoreStand => ({
  get: async (k) => {
    if (refuseGet(k)) throw new Error('read of ' + k + ' refused by the test')
    return persisted.get(k)
  },
  set: async (k, v) => {
    if (refuseSet(k)) throw new Error('write of ' + k.split(':')[0] + ' refused by the test')
    persisted.set(k, JSON.parse(JSON.stringify(v)))
  },
  delete: async (k) => { persisted.delete(k) },
  keys: async () => [...persisted.keys()],
})

const gatherStand = (id: () => Promise<string>, store: StoreStand, redraw: () => void = () => undefined): any => ({
  clock: { now: async () => 5000, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  ui: { log: async () => undefined, invalidate: redraw, status: () => undefined, toast: () => undefined, open: async () => undefined },
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

// the panel open in A from its stored draft, the first gather seen
const openInA = async (session: { id: string }, persisted: Map<string, unknown>, store: StoreStand, redraw?: () => void): Promise<any> => {
  persisted.set(STORE_OPEN + ':t1', { session: 'A', token: 't1', t: 1 })
  persisted.set(draftKey('A'), { session: 'A', t: 1, ...body([['ctx']], { numTokens: 'raw' }) })
  const $ = gatherStand(async () => session.id, store, redraw)
  await SL.restoreAfterReload($, {} as never)
  SL.__render({})
  await SL.__refresh($)
  await drainLong()
  expect(snap()['pickerSession']).toBe('A')
  return $
}

const treeOf = (tab: string, store: StoreStand, $: any): Node[] => walk(SL.__renderPicker({}, tab, 120, undefined, store, $) as Node)
const nodeOf = (nodes: Node[], key: string): Node => {
  const node = nodes.find((n) => keyOf(n) === key)
  expect({ key, drawn: node !== undefined }).toEqual({ key, drawn: true })
  return node!
}

// ---------- AR1: a tree drawn for another draft acts on nothing ----------

const STALE_TREE = 'панель обновлена под текущую сессию — повторите действие'

test('#521 FIX4b AR1: a press, an input and a choice on the tree drawn before the rebind change no draft, redraw and say so', async () => {
  SL.__resetState()
  try {
    const session = { id: 'A' }
    let redraws = 0
    const persisted = new Map<string, unknown>()
    const store = storeOf(persisted)
    const $ = await openInA(session, persisted, store, () => { redraws++ })
    const numbers = treeOf('numbers', store, $)
    const themes = treeOf('themes', store, $)
    const view = treeOf('view', store, $)
    const press = nodeOf(numbers, 'num:numUsd:short').props!['onPress'] as () => void
    const input = nodeOf(themes, 'theme-name').props!['onInput'] as (v: string) => void
    // the stand table has no Select: the axis choice is drawn as its pill, the same setAxis path
    const choice = nodeOf(view, 'ax:palette:mono').props!['onPress'] as () => void
    session.id = 'B'
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('B')
    for (const [what, act] of [['press', () => press()], ['input', () => input('stale')], ['choice', () => choice()]] as Array<[string, () => void]>) {
      // a press on the current tree first: the notice before each stale act is another one
      ;(nodeOf(treeOf('numbers', store, $), 'tab:numbers').props!['onPress'] as () => void)()
      await drainLong()
      expect({ what, notice: snap()['saveResult'] }).not.toEqual({ what, notice: STALE_TREE })
      const storedA = unstamped(draftIn(persisted, 'A'))
      const storedB = unstamped(draftIn(persisted, 'B'))
      const liveB = JSON.stringify(snap()['draft'])
      const before = redraws
      act()
      await drainLong()
      expect({ what, a: unstamped(draftIn(persisted, 'A')), b: unstamped(draftIn(persisted, 'B')), live: JSON.stringify(snap()['draft']) }).toEqual({ what, a: storedA, b: storedB, live: liveB })
      expect({ what, notice: snap()['saveResult'] }).toEqual({ what, notice: STALE_TREE })
      expect({ what, redrawn: redraws > before }).toEqual({ what, redrawn: true })
    }
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX4b AR1: a press on the tree drawn after the rebind acts on the current draft', async () => {
  SL.__resetState()
  try {
    const session = { id: 'A' }
    const persisted = new Map<string, unknown>()
    const store = storeOf(persisted)
    const $ = await openInA(session, persisted, store)
    session.id = 'B'
    await SL.__refresh($)
    await drainLong()
    ;(nodeOf(treeOf('numbers', store, $), 'num:numUsd:short').props!['onPress'] as () => void)()
    await drainLong()
    expect(snap()['draft']?.axes?.numUsd).toBe('short')
    expect((draftIn(persisted, 'B') as any)?.axes?.numUsd).toBe('short')
    expect(snap()['saveResult']).not.toBe(STALE_TREE)
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX4b AR1: a press on the tree drawn before /statusline-mod reopened the panel in another session changes no draft and says so', async () => {
  SL.__resetState()
  const handlers: Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>> = {}
  const on = (event: string, ...rest: unknown[]): void => { handlers[event] = rest[rest.length - 1] as never }
  try {
    SL.register(on as never, {} as never)
    const session = { id: 'A' }
    let redraws = 0
    const persisted = new Map<string, unknown>()
    const store = storeOf(persisted)
    persisted.set(STORE_OPEN + ':t1', { session: 'A', token: 't1', t: 1 })
    persisted.set(draftKey('A'), { session: 'A', t: 1, ...body([['ctx']], { numTokens: 'raw' }) })
    const $ = gatherStand(async () => session.id, store, () => { redraws++ })
    const command = async (): Promise<void> => {
      await handlers['command.run']!($ as never, { command: 'statusline-mod', args: '' } as never, async (v: unknown) => v)
      await drainLong()
    }
    // the state's one restore runs inside the first command
    await command()
    expect(snap()['pickerSession']).toBe('A')
    const press = nodeOf(treeOf('numbers', store, $), 'num:numUsd:short').props!['onPress'] as () => void
    session.id = 'B'
    await command()
    expect(snap()['pickerSession']).toBe('B')
    // the command's own open took B's draft, not a gather's rebind
    expect(snap()['saveResult']).not.toBe('сессия сменилась — черновик прежней сессии сохранён')
    expect(snap()['draft']?.axes?.numTokens).toBeUndefined()
    const storedA = unstamped(draftIn(persisted, 'A'))
    const storedB = unstamped(draftIn(persisted, 'B'))
    const liveB = JSON.stringify(snap()['draft'])
    const before = redraws
    press()
    await drainLong()
    expect({ a: unstamped(draftIn(persisted, 'A')), b: unstamped(draftIn(persisted, 'B')), live: JSON.stringify(snap()['draft']) }).toEqual({ a: storedA, b: storedB, live: liveB })
    expect(snap()['saveResult']).toBe(STALE_TREE)
    expect(redraws).toBeGreaterThan(before)
  } finally {
    SL.__resetState()
  }
})

// ---------- AR2: the rebind notice says whether the old draft was stored ----------

test('#521 FIX4b AR2: the rebind whose old-draft write lands says «сохранён»', async () => {
  SL.__resetState()
  try {
    const session = { id: 'A' }
    const persisted = new Map<string, unknown>()
    const store = storeOf(persisted)
    const $ = await openInA(session, persisted, store)
    session.id = 'B'
    await SL.__refresh($)
    await drainLong()
    expect(snap()['saveResult']).toBe('сессия сменилась — черновик прежней сессии сохранён')
  } finally {
    SL.__resetState()
  }
})

test('#521 FIX4b AR2: the rebind whose old-draft write is refused says the draft is held in memory', async () => {
  SL.__resetState()
  try {
    const session = { id: 'A' }
    let refuse = false
    const persisted = new Map<string, unknown>()
    const store = storeOf(persisted, (k) => refuse && k.startsWith(NS_DRAFT + '.' + fnv64('A') + ':'))
    const $ = await openInA(session, persisted, store)
    refuse = true
    session.id = 'B'
    await SL.__refresh($)
    await drainLong()
    expect(snap()['pickerSession']).toBe('B')
    expect(snap()['saveResult']).toBe('сессия сменилась — черновик прежней сессии не записан в хранилище, он держится в памяти до следующей записи')
  } finally {
    SL.__resetState()
  }
})

// ---------- AR3: a save whose undo-stack read is refused says so ----------

test('#521 FIX4b AR3: a save whose undo-stack read is refused goes on and says its undo is unavailable, with a record', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const store = storeOf(persisted, () => false, (k) => k.startsWith(NS_UNDO))
    const values = new Map<string, unknown>()
    const engine = {
      config: {
        list: async () => OPTION_ROWS.map((r) => (values.has(r.key) ? { ...r, value: values.get(r.key) } : { ...r })),
        set: async (e: { key: string; value: unknown }) => { values.set(e.key, e.value); return { value: e.value } },
      },
      ui: { log: async () => undefined, invalidate: () => undefined },
      clock: { after: () => ({ cancel() {} }) },
    }
    const pressOn = async (key: string): Promise<void> => {
      ;(nodeOf(treeOf('numbers', store, engine), key).props!['onPress'] as () => void)()
      await drainLong()
    }
    await pressOn('num:numUsd:short')
    await pressOn('save')
    expect(values.get('catalyst-statusline.numUsd')).toBe('short')
    expect(snap()['saveResult']).toBe('сохранено; откат этого сохранения недоступен — хранилище отказало в чтении стека')
    expect(SL.__diag().filter((d) => d.key === 'save-undo-unreadable').map((d) => d.kind + ' ' + d.text.includes('refused by the test'))).toEqual(['warn true'])
    // #521 FIX5 Ч5: the record of this save is in the store
    const records = v3Keys(persisted, NS_UNDO)
    expect(records.length).toBe(1)
    const record = persisted.get(records[0]!) as { fields?: string[]; written?: Record<string, string> }
    expect({ numUsd: record.fields?.includes('numUsd'), written: record.written?.['numUsd'] }).toEqual({ numUsd: true, written: 'short' })
  } finally {
    SL.__resetState()
  }
})
