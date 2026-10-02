import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data'
import type { Source } from '../hooks/data/types'
import { world, start, command, BAND_MOUNT, PANE_MOUNT, walk, textOf, barText, SESSION_ID, isSessKey, sessKeys, sessValue } from './world'
import type { Node } from './world'

// S4: the four user-reported defects (ADJUDICATION-S4-USER-DEFECTS.md Д1–Д4
// plus AR6). CONSTRAINT (measured, the header of template.test.ts): the kit
// loads the folder plugin once with fixed options, so every option-dependent
// drawing runs through the imported module instance.
// CONSTRAINT: S is module state — every test that leaves a dirtied cfg must
// reset in the end (the fix3.test.ts try/finally rule).

const src = (s: Source): Source => s

const keyOf = (n: Node): string => String(n.key ?? (n.props as Record<string, unknown> | undefined)?.['key'] ?? '')

const drain = async (): Promise<void> => {
  for (let i = 0; i < 240; i++) await Promise.resolve()
}

// The picker's own `$` for the module-instance renders (the standDollar of
// s2-lost.test.ts; the session id is overridable for the snapshot teeth).
const standDollar = (persisted: Map<string, unknown>, sessionId = SESSION_ID): any => ({
  store: {
    get: async (k: string) => persisted.get(k),
    set: async (k: string, v: unknown) => { persisted.set(k, JSON.parse(JSON.stringify(v))) },
    delete: async (k: string) => { persisted.delete(k) },
    // the host store lists its keys (#521 FIX4 Ф2/Ф3 read the keyed records)
    keys: async () => [...persisted.keys()],
  },
  session: { id: async () => sessionId },
  plugin: { name: 'catalyst-statusline', root: '/stand' },
  ui: { log: async () => undefined, status: () => undefined, invalidate: () => undefined },
})

const openPanel = async ($: any, on: any, over: Record<string, (...args: any[]) => unknown> = {}, store: Record<string, unknown> = {}) => {
  const w = world(on, over, store)
  await start($)
  await w.clock.settle()
  await command($)
  await w.clock.settle()
  const pane = await $.ui.mount({ ...PANE_MOUNT, props: { ...PANE_MOUNT.props, bodyColumns: 140 } })
  return { w, pane }
}

const STEP = { turnId: 'turn-1', index: 0, messageCount: 1 }

const eventInput = (event: string, data: unknown, now = 0): void => SL.__feed({ source: { kind: 'event', event } as Source, ok: true, data, now })
const infoInput = (id: string, turns = 0): void => SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id, turns }, now: 0 })
const tokens = (turnId: string, n: number) => ({ turnId, usage: { input_tokens: n, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
const value = (id: string, variant?: string): any => SL.valueOf(id, variant, {}, SL.buildNf({ numTokens: 'raw' }))!.value

const fullStand = (persisted = new Map<string, unknown>(), id = 'A'): any => ({
  ...standDollar(persisted, id),
  clock: { now: async () => 61000, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  session: { id: async () => id, turns: async () => 0, cwd: async () => '/work/demo', root: async () => '/work/demo', model: async () => 'live-model', usage: async () => ({}), messages: async () => [] },
  config: { list: async () => [] },
  env: { get: async () => '' },
  fs: { read: async () => '' },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
})

const snapshot = (): any => ({
  sum: { total: 100, in: 100, out: 0, cache: 0 }, seenTurns: ['main:stored'],
  tools: { sawAny: true, sawTurnComplete: true, doneTotal: 2, errTotal: 0, byName: [['Read', 2]], done: [] },
  agents: { map: [], done: [] }, started: true, resumed: false, resumedDecided: true, mainTurns: 1,
})

const handlers = (raw: Record<string, string> = {}): Record<string, any> => {
  const h: Record<string, any> = {}
  SL.register(((event: string, fn: unknown) => { h[event] = fn }) as never, raw as never)
  return h
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('S4 R1: own live main turns never mark the session resumed; reload without snapshot does', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    await SL.restoreAfterReload($, {} as never)
    eventInput('session.start', { isInteractive: true })
    eventInput('turn.start', { turnId: 'own' })
    eventInput('turn.complete', tokens('own', 20), 60000)
    infoInput('A', 1)
    expect(value('sum').text).toBe('Σ 20')
    expect(value('ag', 'counts').text).toBe('ag 0')
    expect(value('dur').text).not.toContain('?')
    infoInput('A', 9)
    expect(value('sum').text).toBe('Σ 20')
    SL.__resetState()
    await SL.restoreAfterReload($, {} as never)
    infoInput('A', 3)
    eventInput('turn.complete', tokens('new', 10))
    expect(value('sum').text).toBe('Σ 10*')
  } finally { SL.__resetState() }
})

async function step($: Engine, input: Record<string, unknown>) {
  const stream = $.turn.step({ ...STEP, ...input } as any)
  for await (const _chunk of stream) {
    // the chunks are the model's, nothing here reads them
  }
  return stream.result
}

// A button of a module-instance picker render, pressed (S2 #40's pattern).
const pressIn = (tree: Node[], key: string): void => {
  const node = tree.find((n) => n.type === 'Button' && keyOf(n) === key)
  if (!node) throw new Error('no button ' + key)
  ;(node.props!['onPress'] as () => void)()
}

const pickerTree = (raw: Record<string, string>, tab: string, width = 140): Node[] => walk(SL.__renderPicker(raw, tab, width) as Node)

// The elements grid: the children of the wrapping row, element ids in order.
const gridIds = (tree: Node[]): { kids: Node[]; ids: string[] } => {
  const grid = tree.find((n) => keyOf(n) === 'elements')
  const kids = ((grid?.children ?? []) as Node[]).filter((k) => k && typeof k === 'object')
  const ids: string[] = []
  for (const kid of kids) {
    const k = keyOf(kid)
    if (k.startsWith('box:el:')) ids.push(k.slice('box:el:'.length))
  }
  return { kids, ids }
}

const focusEvent = (element: string): Record<string, unknown> => ({
  component: 'Pane',
  requestId: 'statusline',
  plugin: 'catalyst-statusline',
  element,
  origin: { kind: 'person' },
})

// The focused element's card row. CONSTRAINT: the kit's pane Text carries no
// key — the row is found by its text; the hover card of the same element is
// the same string PADDED WITH SPACES (' ' + text + ' '), so the exact-prefix
// match tells them apart.
const focusRowOf = (tree: Node[], id: string): Node | undefined => {
  const def = SL.REGISTRY.find((d) => d.id === id)!
  const head = def.outcome === 'N' ? def.label + ': ' : def.label + ' — '
  return tree.find((n) => n.type === 'Text' && textOf(n).startsWith(head))
}

test('S4 T1: no picker Button label carries its own hotkey as a prefix (Д1)', () => {
  SL.__resetState()
  try {
    const offenders: string[] = []
    for (const tab of ['layout', 'elements', 'element', 'view', 'themes', 'numbers']) {
      const tree = pickerTree({}, tab)
      for (const [id, label] of [['layout', 'Раскладка'], ['elements', 'Элементы'], ['element', 'Элемент'], ['view', 'Вид'], ['themes', 'Темы'], ['numbers', 'Числа']]) {
        expect(tree.find((n) => n.type === 'Button' && keyOf(n) === 'tab:' + id)!.props?.label).toBe(label)
      }
      if (tab === 'layout') expect(tree.find((n) => n.type === 'Button' && keyOf(n) === 'edit')!.props?.label).toBe('⚙ Элемент')
      const buttons = tree.filter((n) => n.type === 'Button')
      expect(buttons.length).toBeGreaterThan(0)
      for (const b of buttons) {
        const hotkey = b.props?.['hotkey']
        const label = b.props?.['label']
        if (typeof hotkey !== 'string' || hotkey === '' || typeof label !== 'string') continue
        if (label.startsWith(hotkey + ' ') || label.startsWith(hotkey + ':')) offenders.push(tab + ':' + keyOf(b) + ':' + label)
      }
    }
    expect(offenders).toEqual([])
  } finally {
    SL.__resetState()
  }
})

test('S4 T2: Elements pages twelve at a time, circularly; the model family is the default filter (Д2)', async () => {
  SL.__resetState()
  try {
    // the default filter is the registry's first family (model), not «Все»
    const def = pickerTree({}, 'elements')
    expect(def.find((n) => keyOf(n) === 'box:fam:model')!.props?.backgroundColor).toBe('cyan')
    expect(def.find((n) => n.type === 'Button' && keyOf(n) === 'page:next')).toBeUndefined()

    pressIn(def, 'fam:all')
    await drain()
    const total = SL.REGISTRY.length
    expect(total).toBeGreaterThan(24)
    const pages = Math.ceil(total / 12)
    const pageOf = (): { ids: string[]; count: string } => {
      const tree = pickerTree({}, 'elements')
      return {
        ids: tree.filter((n) => keyOf(n).startsWith('el:')).map((n) => keyOf(n).slice('el:'.length)),
        count: textOf(tree.find((n) => keyOf(n) === 'elcount')!),
      }
    }
    const first = pageOf()
    expect(first.ids).toHaveLength(12)
    expect(new Set(first.ids).size).toBe(12)
    expect(first.count).toBe(total + ' элементов · страница 1 из ' + pages)
    const tree = pickerTree({}, 'elements')
    expect(tree.find((n) => n.type === 'Button' && keyOf(n) === 'page:prev')).toBeDefined()
    expect(tree.find((n) => n.type === 'Button' && keyOf(n) === 'page:next')).toBeDefined()

    pressIn(tree, 'page:next')
    await drain()
    const second = pageOf()
    expect(second.ids).toHaveLength(12)
    expect(second.ids).not.toEqual(first.ids)

    // walk to the last page, then the ring returns to the first
    for (let i = 2; i < pages; i++) {
      pressIn(pickerTree({}, 'elements'), 'page:next')
      await drain()
    }
    expect(pageOf().count).toBe(total + ' элементов · страница ' + pages + ' из ' + pages)
    pressIn(pickerTree({}, 'elements'), 'page:next')
    await drain()
    const back = pageOf()
    expect(back.count).toBe(total + ' элементов · страница 1 из ' + pages)
    expect(back.ids).toEqual(first.ids)
  } finally {
    SL.__resetState()
  }
})

test('S4 T3: unavailable elements come after the available ones, headed by the marker (Д2)', async () => {
  SL.__resetState()
  try {
    pressIn(pickerTree({}, 'elements'), 'fam:session')
    await drain()
    const source = SL.REGISTRY.filter((d) => d.family === 'session')
    expect(source.findIndex((d) => d.id === 'name')).toBeLessThan(source.findIndex((d) => d.id === 'session'))
    const ids: string[] = []
    let sawHead = false
    for (let page = 0; page < Math.ceil(source.length / 12); page++) {
      const tree = pickerTree({}, 'elements')
      const grid = gridIds(tree)
      ids.push(...grid.ids)
      const head = grid.kids.findIndex((k) => keyOf(k) === 'unavail-head')
      if (head >= 0) {
        sawHead = true
        expect(textOf(grid.kids[head]!)).toBe('недоступны на этом маршруте')
        for (const kid of grid.kids) {
          const key = keyOf(kid)
          if (!key.startsWith('box:el:')) continue
          const unavailable = SL.REGISTRY.find((d) => d.id === key.slice('box:el:'.length))!.outcome === 'N'
          expect(grid.kids.indexOf(kid) < head).toBe(!unavailable)
        }
      }
      if (page + 1 < Math.ceil(source.length / 12)) { pressIn(tree, 'page:next'); await drain() }
    }
    expect(sawHead).toBe(true)
    expect(ids.indexOf('session')).toBeLessThan(ids.indexOf('name'))
  } finally {
    SL.__resetState()
  }
})

test('S4 T4: an available element carries a hover card with its about and a sample (Д2)', () => {
  SL.__resetState()
  try {
    const tree = pickerTree({}, 'elements')
    const cardScope = (n: Node): unknown => (n.props as { hover?: { scope?: unknown } } | undefined)?.hover?.scope
    const cards = tree.filter((n) => n.type === 'Box' && n.props?.display === 'none' && typeof cardScope(n) === 'string')
    const model = cards.find((n) => cardScope(n) === 'slp-model')
    expect(model).toBeDefined()
    const text = textOf(model!)
    expect(text).toContain(SL.REGISTRY.find((d) => d.id === 'model')!.about)
    expect(text).toContain('образец: Opus 5.5')
  } finally {
    SL.__resetState()
  }
})

test('S4 T5: a ui.focus on an element pill draws its card row under the grid (Д2)', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  await pane.press({ key: 'tab:elements' })
  await w.clock.settle()
  let tree = walk((await pane.drawn()) as Node)
  expect(focusRowOf(tree, 'model')).toBeUndefined()
  await $.ui.focus(focusEvent('el:model') as any)
  await w.clock.settle()
  tree = walk((await pane.drawn()) as Node)
  const row = focusRowOf(tree, 'model')
  expect(row).toBeDefined()
  expect(textOf(row!)).toContain('образец:')
})

test('S4 T5b: a denied ui.focus changes nothing; an accepted one still draws (Д2)', async ($, on) => {
  const { w, pane } = await openPanel($, on, {
    'ui.focus': (_$: any, e: any) => (e.element === 'el:model' ? { deny: 'test' } : {}),
  })
  await pane.press({ key: 'tab:elements' })
  await w.clock.settle()
  await $.ui.focus(focusEvent('el:model') as any)
  await w.clock.settle()
  let tree = walk((await pane.drawn()) as Node)
  expect(focusRowOf(tree, 'model')).toBeUndefined()
  await $.ui.focus(focusEvent('el:route') as any)
  await w.clock.settle()
  tree = walk((await pane.drawn()) as Node)
  const row = focusRowOf(tree, 'route')
  expect(row).toBeDefined()
  expect(textOf(row!)).toContain('route label source OPEN')
})

test('S4 T6: focusing a theme card draws the preview with that theme; the focus leaving restores the draft (Д2)', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  // CONSTRAINT: the pane is drawn by the kit's own plugin instance; the draft
  // is observed through what the preview draws, not through the imported one
  const previewJoins = async (): Promise<string[]> => {
    const root = walk((await pane.drawn()) as Node)
    const preview = ((root[0]?.children ?? []) as Node[])[0]
    return walk(preview).filter((n) => n.type === 'Text').map(textOf)
  }
  expect(await previewJoins()).toContain(' │ ')
  await pane.press({ key: 'tab:themes' })
  await w.clock.settle()
  await $.ui.focus(focusEvent('theme:claude-code') as any)
  await w.clock.settle()
  const joins = await previewJoins()
  expect(joins).not.toContain(' │ ')
  expect(joins).toContain('|')
  // the focus leaving draws the draft's own view again: the draft never became the theme
  await $.ui.focus(focusEvent('tab:themes') as any)
  await w.clock.settle()
  expect(await previewJoins()).toContain(' │ ')
})

test('S4 T7: a pending stub holds the width of the last ok value, def.sample before the first one (Д3)', () => {
  SL.__resetState()
  try {
    const RAW = { template: 'rl' }
    // CONSTRAINT: a stand tree keeps the hover scope inside props — the flow
    // text (absolute cards excluded) carries the segment's own text alone
    const stub = (): string => {
      const nodes = walk(SL.__render(RAW) as Node)
      return nodes.filter((n) => n.type === 'Text' && typeof (n.props as { hover?: { scope?: unknown } } | undefined)?.hover?.scope === 'string').map(textOf).join('')
    }
    const sample = SL.REGISTRY.find((d) => d.id === 'rl')!.sample
    expect(stub()).toBe('…' + ' '.repeat(sample.length - 1))
    SL.__feed({ source: src({ kind: 'session', call: 'usage' }), ok: true, data: { rateLimits: [{ kind: 'five_hour', percentUsed: 25 }] }, now: 0 })
    const okText = stub()
    expect(okText).toBe('rl 5h 25%')
    // a usage answer with no windows pend()s again: the stub keeps the ok width
    SL.__feed({ source: src({ kind: 'session', call: 'usage' }), ok: true, data: {}, now: 1 })
    expect(stub()).toBe('…' + ' '.repeat(okText.length - 1))
  } finally {
    SL.__resetState()
  }
})

test('S4 T8: ag and tools answer a known zero only when the session was observed from its start (Д3)', () => {
  SL.__resetState()
  try {
    const nf = SL.buildNf({})
    const text = (id: string, variant: string): Record<string, unknown> => SL.valueOf(id, variant, {}, nf)!.value as Record<string, unknown>
    // no session.start in this state: pending, never a zero
    expect(text('ag', 'counts')).toEqual({ state: 'pending' })
    expect(text('tools', 'counts')).toEqual({ state: 'pending' })
    SL.__feed({ source: src({ kind: 'event', event: 'session.start' }), ok: true, data: { isInteractive: true, cwd: '/work/demo/src' }, now: 0 })
    expect(text('ag', 'counts')).toEqual({ state: 'ok', text: 'ag 0', at: 0 })
    expect(text('tools', 'counts')).toEqual({ state: 'ok', text: 'tools ✓0', at: 0 })
    expect(text('ag', 'lines')).toEqual({ state: 'ok', text: 'ag 0', at: 0 })
    expect(text('tools', 'lines')).toEqual({ state: 'ok', text: '✓ 0', at: 0 })
    // a reload saw no session.start: pending again until the host speaks
    SL.__resetState()
    expect(text('ag', 'counts')).toEqual({ state: 'pending' })
    expect(text('tools', 'counts')).toEqual({ state: 'pending' })
  } finally {
    SL.__resetState()
  }
})

test('S4 T9: the effort level is seeded from /config before the first turn, one read per start (Д3)', async ($, on) => {
  let calls = 0
  const w = world(on, {
    'config.list': () => {
      calls++
      return { value: [{ key: 'effort', label: 'Effort', kind: 'choice', value: 'high', provider: { plugin: 'engine', tier: 'core' }, isLocked: false }] }
    },
  })
  await start($)
  await w.clock.settle()
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 's4e1' })).drawn()))).toContain('high')
  await step($, { model: 'claude-fable-5-1' })
  await w.clock.settle()
  await step($, { model: 'claude-fable-5-1' })
  await w.clock.settle()
  expect(calls).toBe(1)
})

test('S4 T9b: a refused effort read is diagnosed and retried, and never overwrites a turn.step level (Д3)', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    let calls = 0
    const logs: string[] = []
    $.config.list = async () => {
      if (++calls === 1) throw new Error('config down')
      return [{ key: 'effort', value: 'high' }]
    }
    $.ui.log = async (text: unknown) => { logs.push(String(text)) }
    await SL.__refresh($)
    await drain()
    expect(calls).toBe(1)
    expect(SL.__diag().some((d) => d.key === 'effort-seed')).toBe(true)
    expect(value('model').text).not.toContain('high')
    // the diagnosis is DELIVERED (ui.log), not only buffered (T9b, S4-FIX2 AR4)
    expect(logs.some((l) => l.includes('effort level could not be read'))).toBe(true)
    // the visible band holds no seed the refused read never brought (T9b)
    const band = walk(SL.__render({ template: 'model', details: 'off' }) as Node).filter((n) => n.type === 'Text').map(textOf).join('')
    expect(band).not.toContain('high')
    eventInput('turn.step', { model: 'live-model', effort: 'max' })
    await SL.__refresh($)
    await drain()
    expect(calls).toBe(2)
    expect(value('model').text).toContain('max')
    expect(value('model').text).not.toContain('high')
  } finally { SL.__resetState() }
})

test('S4 T10: dur stands on usage.startedAt without the ? mark; a clock before the start is stale, never zero (Д4)', () => {
  SL.__resetState()
  try {
    const nf = SL.buildNf({})
    const usage = (startedAt: number | undefined, now: number): void => {
      SL.__feed({ source: src({ kind: 'session', call: 'usage' }), ok: true, data: startedAt === undefined ? {} : { startedAt }, now })
    }
    usage(1000, 61_000)
    const v = SL.valueOf('dur', undefined, {}, nf)!.value as Record<string, unknown>
    expect(v['state']).toBe('ok')
    expect(v['text']).toBe(nf.duration(60_000))
    expect(String(v['text'])).not.toContain('?')
    usage(1000, 500)
    const neg = SL.valueOf('dur', undefined, {}, nf)!.value as { state: string; reason?: string; last?: { text: string } }
    expect(neg['state']).toBe('stale')
    expect(neg.reason).toBe('clock before session start')
    expect(neg.last!.text).toBe('1m')
    SL.__resetState()
    usage(1000, 500)
    expect(value('dur')).toEqual({ state: 'pending' })
    expect(SL.__diag().filter((d) => d.key === 'dur-clock')).toHaveLength(1)
    value('dur')
    expect(SL.__diag().filter((d) => d.key === 'dur-clock')).toHaveLength(1)
    infoInput('A')
    infoInput('B')
    expect(value('dur')).toEqual({ state: 'pending' })
  } finally {
    SL.__resetState()
  }
})

test('S4 T11: a reload under the same session id restores sum and the counters; another id does not (AR6)', async ($, on) => {
  const w = world(on, {
    'turn.complete': (_$: any, e: any) => ({ text: e.answer ?? '' }),
    'tool.call': () => ({ result: 'ok', isError: false }),
    'agent.spawn': () => ({ agentId: 'saved-agent', model: 'm' }),
  })
  await start($)
  await w.clock.settle()
  await $.tool.call({ tool: 'Read', tool_use_id: 'saved-read', input: {} } as any)
  await $.agent.spawn({ subagentType: 'reader', description: 'saved work' } as any)
  await $.turn.complete({ answer: 'ok', durationMs: 4000, isAborted: false, turnId: 's4t11', reason: 'answer', usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as any)
  await w.clock.settle()
  await drain()
  expect(sessKeys(w.persisted, SESSION_ID).length > 0).toBe(true)
  const nf = SL.buildNf({})
  SL.__resetState()
  await SL.restoreAfterReload(standDollar(w.persisted), {} as never)
  const sum = SL.valueOf('sum', undefined, {}, nf)!.value as Record<string, unknown>
  expect(sum['state']).toBe('ok')
  expect(sum['text']).toBe('Σ ' + nf.tokens(3000))
  expect(value('tools', 'counts').text).toBe('tools ✓1')
  expect(value('tools', 'lines').text).toContain('Read ×1')
  expect(value('ag', 'lines').text).toContain('saved work')
  eventInput('turn.complete', tokens('s4t11', 3000))
  expect(value('sum').text).toBe('Σ 3000')
  // a different session id: the snapshot stays unread, the accumulators pending
  SL.__resetState()
  await SL.restoreAfterReload(standDollar(w.persisted, '11111111-2222-3333-4444-555555555555'), {} as never)
  const other = SL.valueOf('sum', undefined, {}, nf)!.value as Record<string, unknown>
  expect(other['state']).toBe('pending')
})

test('S4 T11b: delayed snapshot replays live turns, tools and agents and invalidates', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    const gate = deferred<unknown>()
    let reading = false
    let invalidates = 0
    $.ui.invalidate = () => { invalidates++ }
    $.store.get = async (key: string) => { if (key === 'sess:A') { reading = true; return gate.promise } }
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    expect(reading).toBe(true)
    infoInput('A')
    eventInput('turn.complete', tokens('window', 20))
    eventInput('agent.spawn', { agentId: 'window-agent', description: 'window work' })
    eventInput('tool.call', { tool: 'Read', callKey: 'window-read' })
    eventInput('tool.call', { callTool: 'Read', callKey: 'window-read' })
    eventInput('turn.step', { model: 'latest-model', effort: 'max' })
    const before = invalidates
    gate.resolve(snapshot())
    await restoring
    expect(value('sum').text).toBe('Σ 120')
    expect(value('ag', 'lines').text).toContain('window work')
    expect(value('tools', 'counts').text).toBe('tools ✓3')
    expect(value('model').text).toBe('latest-model max')
    expect(invalidates).toBeGreaterThan(before)
    eventInput('turn.complete', tokens('stored', 100))
    expect(value('sum').text).toBe('Σ 120')
  } finally { SL.__resetState() }
})

test('S4 T11c: a late snapshot A is discarded after info switches to B', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    const gate = deferred<unknown>()
    const reads: string[] = []
    $.store.get = async (key: string) => { reads.push(key); if (key === 'sess:A') return gate.promise }
    infoInput('A')
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    infoInput('B')
    $.session.id = async () => 'B'
    eventInput('turn.complete', tokens('B-live', 20))
    gate.resolve(snapshot())
    await restoring
    expect(SL.__diag().some((d) => d.key === 'session-snapshot-stale')).toBe(true)
    await SL.__refresh($)
    expect(reads).toContain('sess:B')
    expect(value('sum').text).toBe('Σ 20')
  } finally { SL.__resetState() }
})

test('S4 T11d: refused snapshot keeps accumulators pending and forbids writes until gather retry', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const $ = fullStand()
    let reads = 0
    const retry = deferred<unknown>()
    const writes: string[] = []
    $.store.get = async (key: string) => {
      if (key !== 'sess:A') return undefined
      if (++reads === 1) throw new Error('snapshot down')
      return retry.promise
    }
    $.store.set = async (key: string) => { writes.push(key) }
    infoInput('A')
    await SL.restoreAfterReload($, {} as never)
    const turn = h['turn.complete']($, tokens('window', 50), async () => ({}))
    await drain()
    expect(reads).toBe(2)
    for (const id of ['sum', 'tokens-total', 'tools', 'ag']) expect(value(id).state).toBe('pending')
    expect(writes.filter((k) => isSessKey(k))).toEqual([])
    retry.resolve(snapshot())
    await turn
    await drain()
    expect(value('sum').text).toBe('Σ 150')
    expect(value('tools', 'counts').text).toBe('tools ✓2')
  } finally { SL.__resetState() }
})

test('S4 T11e: snapshot restores both tools visibility flags and both forms', async () => {
  SL.__resetState()
  try {
    for (const sawAny of [false, true]) {
      SL.__resetState()
      const snap = snapshot()
      snap.started = false
      snap.tools.sawAny = sawAny
      snap.tools.sawTurnComplete = !sawAny
      await SL.restoreAfterReload(fullStand(new Map([['sess:A', snap]])), {} as never)
      expect(value('tools', 'counts').text).toBe('tools ✓2')
      expect(value('tools', 'lines').text).toContain('Read ×2')
    }
  } finally { SL.__resetState() }
})

test('S4 T11f: malformed AgentRec rejects the whole snapshot with shape diagnosis', async () => {
  SL.__resetState()
  try {
    const snap = snapshot()
    snap.agents.map = [['bad', { name: 'reader', desc: 17, model: 'm', status: 'running', at: 0, doneAt: 0 }]]
    await SL.restoreAfterReload(fullStand(new Map([['sess:A', snap]])), {} as never)
    expect(value('sum').state).toBe('pending')
    expect(SL.__diag().some((d) => d.key === 'session-snapshot-shape' && d.kind === 'fail')).toBe(true)
  } finally { SL.__resetState() }
})

test('S4 T11g: recovery overflow stays unknown until session switch; snapshot write retries in gather', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const $ = fullStand()
    let reads = 0
    $.store.get = async (key: string) => { if (key === 'sess:A') { reads++; throw new Error('down') } }
    infoInput('A')
    await SL.restoreAfterReload($, {} as never)
    for (let i = 0; i < 257; i++) eventInput('agent.spawn', { agentId: 'overflow-' + i })
    expect(SL.__diag().some((d) => d.key === 'session-snapshot-lost')).toBe(true)
    await SL.__refresh($)
    expect(reads).toBe(1)
    expect(value('ag').state).toBe('pending')
    $.session.id = async () => 'B'
    await SL.__refresh($)
    let attempts = 0
    $.store.set = async (key: string) => { if (isSessKey(key, 'B') && ++attempts === 1) throw new Error('write down') }
    await h['agent.spawn']($, { description: 'new' }, async () => ({ agentId: 'B-agent' }))
    await drain()
    expect(attempts).toBe(1)
    await SL.__refresh($)
    await drain()
    expect(attempts).toBe(2)
    expect(value('ag').text).toContain('new')
  } finally { SL.__resetState() }
})

test('S4 T9c: rejection of generation A cannot clear generation B effort promise', async () => {
  SL.__resetState()
  const a = deferred<any[]>()
  const b = deferred<any[]>()
  try {
    const $ = fullStand()
    $.config.list = () => a.promise
    await SL.__refresh($)
    SL.__resetState()
    let calls = 0
    $.config.list = () => { calls++; return b.promise }
    await SL.__refresh($)
    a.reject(new Error('old generation'))
    await drain()
    await SL.__refresh($)
    expect(calls).toBe(1)
    b.resolve([{ key: 'effort', value: 'high' }])
    await drain()
    expect(value('model').text).toContain('high')
  } finally { b.resolve([]); SL.__resetState() }
})

test('S4 T5c: accepted host focus clears theme preview; tab change clears focus', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  const joins = async () => walk(((walk(await pane.drawn())[0]?.children ?? []) as Node[])[0]).filter((n) => n.type === 'Text').map(textOf)
  await pane.press({ key: 'tab:themes' })
  await w.clock.settle()
  await $.ui.focus(focusEvent('theme:claude-code') as any)
  await w.clock.settle()
  expect(await joins()).toContain('|')
  await $.ui.focus({ component: 'Pane', requestId: 'statusline', origin: { kind: 'person' } } as any)
  await w.clock.settle()
  expect(await joins()).toContain(' │ ')
  await $.ui.focus(focusEvent('theme:claude-code') as any)
  await pane.press({ key: 'tab:layout' })
  await pane.press({ key: 'tab:themes' })
  await w.clock.settle()
  expect(await joins()).toContain(' │ ')
})

test('S4 T7b: draft decimal percent previews do not widen the live pending stub', async () => {
  SL.__resetState()
  try {
    const raw = { template: 'rl||model', separator: ' ', evictOrder: 'model,rl', details: 'off' }
    SL.__feed({ source: { kind: 'session', call: 'model' }, ok: true, data: 'm', now: 0 })
    SL.__feed({ source: { kind: 'session', call: 'usage' }, ok: true, data: { rateLimits: [{ kind: 'five_hour', percentUsed: 25 }] }, now: 0 })
    SL.__render(raw, 11)
    pressIn(pickerTree(raw, 'numbers'), 'num:numPercent:dec1')
    await drain()
    pickerTree(raw, 'themes')
    SL.__feed({ source: { kind: 'session', call: 'usage' }, ok: true, data: {}, now: 1 })
    const tree = walk(SL.__render(raw, 11) as Node)
    expect(tree.filter((n) => n.type === 'Text').map(textOf)).toContain('m')
  } finally { SL.__resetState() }
})

test('S4 T2b: next from a stored page equal to pages wraps from the clamped last page', async () => {
  SL.__resetState()
  try {
    const pages = Math.ceil(SL.REGISTRY.length / 12)
    const store = new Map<string, unknown>([
      // #551 D5: a flag restores only with an age inside FLAG_TTL (the stand clock reads 61000)
      ['statusline.open.v1', { session: 'A', at: 61000 }],
      ['statusline.draft.v1', { session: 'A', lines: [[{ id: 'model', body: '{model.text}' }]], axes: {}, elements: {}, tab: 'elements', fam: 'all', page: pages }],
    ])
    await SL.restoreAfterReload(fullStand(store), {} as never)
    const tree = pickerTree({}, 'elements')
    expect(textOf(tree.find((n) => keyOf(n) === 'elcount')!)).toContain('страница ' + pages + ' из ' + pages)
    pressIn(tree, 'page:next')
    await drain()
    expect(textOf(pickerTree({}, 'elements').find((n) => keyOf(n) === 'elcount')!)).toContain('страница 1 из ' + pages)
  } finally { SL.__resetState() }
})


test('S4 T5d: the registered pane close handler clears the focus key', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const $ = fullStand()
    await SL.restoreAfterReload($, {} as never)
    await h['ui.focus']($, focusEvent('theme:claude-code'), async () => ({}))
    expect(SL.__stateSnapshot()['focusKey']).toBe('theme:claude-code')
    await h['ui.close']($, { id: 'statusline' }, async (e: unknown) => e)
    expect(SL.__stateSnapshot()['focusKey']).toBe('')
  } finally { SL.__resetState() }
})

test('S4 T10b: same-gather usage after changed session info keeps the new duration basis', () => {
  SL.__resetState()
  try {
    // CONSTRAINT (ADJUDICATION-S4-FIX2 F2): the gather reads session:info
    // FIRST among the session sources, so the order here is the gather's own —
    // the id change lands before the usage read of the same gather
    infoInput('A')
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id: 'B', turns: 0 }, now: 61000 })
    SL.__feed({ source: { kind: 'session', call: 'usage' }, ok: true, data: { startedAt: 1000 }, now: 61000 })
    expect(value('dur').text).toBe('1m')
  } finally { SL.__resetState() }
})

test('S4 T10c: older usage is discarded at changed info, retaining the latest live start', () => {
  SL.__resetState()
  try {
    infoInput('A')
    SL.__feed({ source: { kind: 'session', call: 'usage' }, ok: true, data: { startedAt: 1000 }, now: 1000 })
    eventInput('session.start', {}, 2000)
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id: 'B', turns: 0 }, now: 61000 })
    expect(value('dur').text).toBe('59s')
  } finally { SL.__resetState() }
})

// ---------- S4-FIX3 (ADJUDICATION-S4-FIX2): F1-F7, ADJ-1, ADJ-3, qwen F-1..F-3 ----------

const famBase = (): any => ((SL.__stateSnapshot()['famStates'] as Array<[unknown, any]>).find(([fam]) => fam === FAMILIES[0])![1])

test('S4 F1: replay dedups against the FULL union of snapshot and replay keys, trimming after the cycle', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    const gate = deferred<unknown>()
    $.store.get = async (key: string) => { if (key === 'sess:A') return gate.promise }
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    infoInput('A')
    eventInput('turn.complete', tokens('new', 20), 60000)
    // a replay of the snapshot's own oldest turn: the cap (256) must not evict
    // its key mid-cycle and count the turn a second time
    eventInput('turn.complete', tokens('old', 1), 60000)
    const snap = snapshot()
    snap.sum = { total: 100, in: 100, out: 0, cache: 0 }
    snap.seenTurns = Array.from({ length: 256 }, (_, i) => (i === 0 ? 'main:old' : 'main:t' + i))
    gate.resolve(snap)
    await restoring
    expect(value('sum').text).toBe('Σ 120')
    expect(famBase().seenTurns).toHaveLength(256)
  } finally { SL.__resetState() }
})

test('S4 F2: an id change without a new session.start drops the old duration basis; a live start is the basis', () => {
  SL.__resetState()
  try {
    eventInput('session.start', {}, 1000)
    infoInput('A')
    SL.__feed({ source: { kind: 'session', call: 'usage' }, ok: true, data: { startedAt: 5000 }, now: 61000 })
    expect(value('dur').text).toBe('56s')
    // /clear changes the id and raises NO session.start: the old session's
    // figures are not the new session's basis, a refused usage leaves pending
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id: 'B', turns: 0 }, now: 61000 })
    SL.__feed({ source: { kind: 'session', call: 'usage' }, ok: false, error: 'refused', now: 61000 })
    expect(value('dur')).toEqual({ state: 'pending' })

    SL.__resetState()
    eventInput('session.start', {}, 1000)
    infoInput('A')
    SL.__feed({ source: { kind: 'session', call: 'usage' }, ok: true, data: { startedAt: 5000 }, now: 61000 })
    // the new session's own live start, seen before the id change: it IS the basis
    eventInput('session.start', {}, 59000)
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id: 'B', turns: 0 }, now: 61000 })
    expect(value('dur').text).toBe('2s')
  } finally { SL.__resetState() }
})

test('S4 F3: turns seen after the last info read belong to the new session', () => {
  SL.__resetState()
  try {
    infoInput('A', 0)
    eventInput('turn.start', { turnId: 'first-of-B' })
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id: 'B', turns: 1 }, now: 60000 })
    eventInput('turn.complete', tokens('second', 20), 60000)
    expect(value('sum').text).toBe('Σ 20')
    expect(value('sum').text).not.toContain('*')
  } finally { SL.__resetState() }
})

test('S4 F4: a write held while more turns land is redone with the current state when it finishes', async () => {
  SL.__resetState()
  try {
    const h = handlers()
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    $.store.get = async () => undefined
    infoInput('A')
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('t1', 100), 60000)
    const gate = deferred<void>()
    let writes = 0
    $.store.set = async (key: string, value: unknown) => {
      writes++
      if (writes === 1) await gate.promise
      persisted.set(key, JSON.parse(JSON.stringify(value)))
    }
    await h['session.end']($, {}, async () => ({}))
    await drain()
    eventInput('turn.complete', tokens('t2', 20), 61000)
    await h['session.end']($, {}, async () => ({}))
    await drain()
    gate.resolve()
    await drain()
    await drain()
    expect(writes).toBe(2)
    expect((sessValue(persisted, 'A') as { sum: { total: number } }).sum.total).toBe(120)
  } finally { SL.__resetState() }
})

test('S4 ADJ-1: an id change stores the completed old session its own last turn', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const $ = fullStand(persisted)
    $.store.get = async () => undefined
    await SL.restoreAfterReload($, {} as never)
    await drain()
    eventInput('turn.complete', tokens('last-of-A', 100), 60000)
    $.session.id = async () => 'B'
    await SL.__refresh($)
    await drain()
    // FIX5 Р2: the switching gather takes the farewell, the next one writes it
    expect(sessValue(persisted, 'A')).toBeUndefined()
    await SL.__refresh($)
    await drain()
    await drain()
    const stored = sessValue(persisted, 'A') as { sum: { total: number } } | undefined
    expect(stored).toBeDefined()
    expect(stored!.sum.total).toBe(100)
  } finally { SL.__resetState() }
})

test('S4 F5: an agent finishing without usage is completed, live and in replay', async () => {
  SL.__resetState()
  try {
    eventInput('agent.spawn', { agentId: 'f5-live', description: 'broken live work' }, 0)
    eventInput('turn.complete', { agentId: 'f5-live', turnId: 't1', reason: 'error' }, 5000)
    expect(value('ag', 'counts').text).toBe('ag 0r 1✓')
    expect(value('ag', 'lines').text).not.toContain('◐')

    SL.__resetState()
    const $ = fullStand()
    const gate = deferred<unknown>()
    $.store.get = async (key: string) => { if (key === 'sess:A') return gate.promise }
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    infoInput('A')
    eventInput('agent.spawn', { agentId: 'f5-replay', description: 'broken replay work' }, 1000)
    eventInput('turn.complete', { agentId: 'f5-replay', turnId: 't1', reason: 'error' }, 5000)
    gate.resolve(snapshot())
    await restoring
    expect(value('ag', 'counts').text).toBe('ag 0r 1✓')
    expect(value('ag', 'lines').text).not.toContain('◐')
  } finally { SL.__resetState() }
})

test('S4 F7: an old gather finishing after a newer one is dropped, the state does not roll back', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    const gate = deferred<void>()
    let holdFirst = true
    $.session.id = async () => {
      if (holdFirst) {
        holdFirst = false
        await gate.promise
      }
      return 'A'
    }
    const first = SL.__refresh($)
    await drain()
    $.session.id = async () => 'B'
    await SL.__refresh($)
    expect(value('session', 'full').text).toBe('B')
    gate.resolve()
    await first
    await drain()
    expect(value('session', 'full').text).toBe('B')
    expect(SL.__diag().some((d) => d.key === 'stale-refresh-newer')).toBe(true)
  } finally { SL.__resetState() }
})

test('S4 ADJ-3: a malformed snapshot ends recovery once; verify does not re-diagnose it', async () => {
  SL.__resetState()
  try {
    const snap = snapshot()
    snap.agents.map = [['bad', { name: 'reader', desc: 17, model: 'm', status: 'running', at: 0, doneAt: 0 }]]
    const $ = fullStand(new Map([['sess:A', snap]]))
    let reads = 0
    $.store.get = async (key: string) => {
      if (key === 'sess:A') {
        reads++
        return snap
      }
      return undefined
    }
    infoInput('A')
    await SL.restoreAfterReload($, {} as never)
    expect(SL.__diag().filter((d) => d.key === 'session-snapshot-shape')).toHaveLength(1)
    await SL.__refresh($)
    await drain()
    expect(reads).toBe(2)
    expect(SL.__sessQueue().landed).toEqual([])
    expect(famBase().sum).toBeNull()
    expect(value('ag', 'counts').state).toBe('pending')
    expect(SL.__diag().filter((d) => d.key === 'session-snapshot-shape')).toHaveLength(1)
  } finally { SL.__resetState() }
})

test('S4 qwen F-1: dur-clock warns once per session, again after the id change', () => {
  SL.__resetState()
  try {
    eventInput('session.start', {}, 60000)
    infoInput('A')
    SL.__feed({ source: { kind: 'session', call: 'usage' }, ok: true, data: { startedAt: 60000 }, now: 500 })
    expect(value('dur')).toEqual({ state: 'pending' })
    expect(SL.__diag().filter((d) => d.key === 'dur-clock')).toHaveLength(1)
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { id: 'B', turns: 0 }, now: 500 })
    SL.__feed({ source: { kind: 'session', call: 'usage' }, ok: true, data: { startedAt: 60000 }, now: 500 })
    expect(value('dur')).toEqual({ state: 'pending' })
    expect(SL.__diag().filter((d) => d.key === 'dur-clock')).toHaveLength(2)
  } finally { SL.__resetState() }
})

test('S4 qwen F-2/F-3: turn.start and session.start buffered in the recovery window reach the restored state', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    const gate = deferred<unknown>()
    $.store.get = async (key: string) => { if (key === 'sess:A') return gate.promise }
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    infoInput('A')
    eventInput('turn.start', { turnId: 'window-turn' }, 3000)
    eventInput('session.start', { isInteractive: true }, 4000)
    const snap = snapshot()
    snap.started = false
    gate.resolve(snap)
    await restoring
    // the replayed turn.start is the new session's own turn (F3's mainTurnsAtInfo)
    expect(famBase().mainTurns).toBe(2)
    expect(famBase().started).toBe(true)
    expect(value('tools', 'counts').text).toBe('tools ✓2')
  } finally { SL.__resetState() }
})

test('S4 b256: exactly 256 buffered inputs recover, the sum is exact', async () => {
  SL.__resetState()
  try {
    const $ = fullStand()
    const gate = deferred<unknown>()
    $.store.get = async (key: string) => { if (key === 'sess:A') return gate.promise }
    const restoring = SL.restoreAfterReload($, {} as never)
    await drain()
    infoInput('A')
    for (let i = 0; i < 255; i++) eventInput('agent.spawn', { agentId: 'b256-' + i })
    eventInput('turn.complete', tokens('b256-main', 20), 60000)
    gate.resolve(snapshot())
    await restoring
    expect(SL.__diag().some((d) => d.key === 'session-snapshot-lost')).toBe(false)
    expect(value('sum').text).toBe('Σ 120')
  } finally { SL.__resetState() }
})
