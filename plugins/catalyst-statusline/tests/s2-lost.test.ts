import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import type { Source } from '../hooks/data/types'
import { world, start, command, BAND_MOUNT, PANE_MOUNT, walk, textOf, barText, SESSION_ID, STORE_OPEN, STORE_DRAFT, STORE_SAVING, saveMarks } from './world'
import type { Node } from './world'

// S2: the fifteen teeth of the 0.4 tree (ef5bafc) whose census class is NONE
// (S2-LOST-TEETH-CENSUS.md #6,15,16,17,20,21,25,26,30,35,39,40,41,43,46),
// rewritten against the live 0.5 stand. CONSTRAINT (measured, the header of
// template.test.ts): the kit loads the folder plugin once with fixed options,
// so every option-dependent drawing runs through the imported module instance
// (fix3.test.ts header: the kit's loaded copy is not touched).

const src = (s: Source): Source => s

// The stand's world data — the same figures census rows 1/49 quote for the
// live compact rendering (83K/1M, $1.23 at the default numUsd=exact).
function feedStand(): void {
  SL.__feed({ source: src({ kind: 'session', call: 'info' }), ok: true, data: { cwd: '/work/demo/src', root: '/work/demo', id: SESSION_ID, turns: 0 }, now: 0 })
  SL.__feed({ source: src({ kind: 'session', call: 'model' }), ok: true, data: 'Fable 5.1', now: 0 })
  SL.__feed({ source: src({ kind: 'session', call: 'messages' }), ok: true, data: [], now: 0 })
  SL.__feed({ source: src({ kind: 'session', call: 'usage' }), ok: true, data: { context: { tokens: 83000, window: 1000000, percent: 8 }, rateLimits: [{ kind: 'five_hour', percentUsed: 25, resetsAt: '2026-09-21T20:00:00Z' }, { kind: 'seven_day', percentUsed: 61.5 }], cost: { usd: 1.2345 } }, now: 0 })
  SL.__feed({ source: src({ kind: 'cmd', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], everyMs: 8000, cwd: 'project' }), ok: true, data: { code: 0, stdout: 'feature/hover\n', stderr: '' }, now: 0 })
  SL.__feed({ source: src({ kind: 'cmd', argv: ['claude', '--version'], everyMs: 0 }), ok: true, data: { code: 0, stdout: '2.1.280 (tweakcc)\n', stderr: '' }, now: 0 })
}

// Each stand render starts from a clean state, feeds the world, and draws:
// CONSTRAINT: S is module state — every test that leaves a dirtied cfg must
// reset in the end (the fix3.test.ts try/finally rule).
function renderStand(raw: Record<string, string>, width = 140, maxRows = 8): Node {
  SL.__resetState()
  feedStand()
  return SL.__render(raw, width, maxRows) as Node
}

// The bar builder's own column Box carrying the hover cards (the 0.4.0 teeth
// helper, ef5bafc tests/teeth.test.ts:31-33 — cards exist while details=hover).
function barColumn(nodes: Node[]): Node | undefined {
  return nodes.find((n) => n.type === 'Box' && n.props?.flexDirection === 'column' && (n.children ?? []).some((c) => (c as Node)?.props?.display === 'none'))
}

// The flowing text: segment texts in order, the absolute cards excluded
// (the 0.4.0 helper, ef5bafc tests/teeth.test.ts:37-46).
function flowText(root: Node): string {
  const out: string[] = []
  const visit = (n: Node, inFlow: boolean): void => {
    const flow = inFlow && n.props?.position !== 'absolute'
    if (n.type === 'Text' && flow) out.push(textOf(n))
    for (const c of n.children ?? []) if (c && typeof c === 'object') visit(c as Node, flow)
  }
  visit(root, true)
  return out.join('')
}

// The picker's own `$` for the handlers the kit cannot drive live (the
// standDollar of the 0.4.0 tree, ef5bafc tests/teeth.test.ts:65-74).
const standDollar = (persisted: Map<string, unknown>): any => ({
  store: {
    get: async (k: string) => persisted.get(k),
    set: async (k: string, v: unknown) => { persisted.set(k, JSON.parse(JSON.stringify(v))) },
    delete: async (k: string) => { persisted.delete(k) },
    keys: async () => [...persisted.keys()],
  },
  session: { id: async () => SESSION_ID },
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

async function step($: Engine, input: Record<string, unknown>) {
  const stream = $.turn.step({ ...STEP, ...input } as any)
  for await (const _chunk of stream) {
    // the chunks are the model's, nothing here reads them
  }
  return stream.result
}

const modelCommand = ($: Engine) =>
  $.command.run({ command: 'model', args: 'opus', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

const keyOf = (n: Node): string => String(n.key ?? (n.props as Record<string, unknown> | undefined)?.['key'] ?? '')

const drain = async (): Promise<void> => {
  for (let i = 0; i < 240; i++) await Promise.resolve()
}

test('S2 #6: displayName maps claude ids the way the classic payload names them', () => {
  expect(SL.displayName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(SL.displayName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(SL.displayName('haiku')).toBe('haiku')
})

test('S2 #15: a change to the model row of /config redraws the bar once it is written', async ($, on) => {
  let model = 'claude-fable-5-1'
  const w = world(on, {
    'session.model': () => ({ value: model }),
    'config.set': (_$: any, e: any) => {
      if (e.key === 'model') model = String(e.value)
      return { value: e.value }
    },
  })
  await start($)
  await w.clock.settle()
  await $.config.set({ key: 'model', value: 'claude-opus-5-5[1m]', previous: 'claude-fable-5-1', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  await w.clock.settle()
  const bar = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'after-cfg' })).drawn()))
  expect(bar).toContain('claude-opus-5-5[1m]')
})

test('S2 #16: a refresh that finishes after a newer one does not put the older model back', async ($, on) => {
  let model = 'claude-fable-5-1'
  let armed = false
  let heldOnce = false
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let markHeld!: () => void
  const heldStarted = new Promise<void>((resolve) => (markHeld = resolve))
  // CONSTRAINT (S4-FIX3 F7): the read of the NEXT gather is held off — the
  // assert below must see the state the old gather left, not a newer gather's
  // own rewrite of it.
  let afterRelease = false
  let releaseNext!: () => void
  const nextRead = new Promise<void>((resolve) => (releaseNext = resolve))
  // CONSTRAINT: the hold is armed on the first model read after the step is
  // raised (the read of the step's request-time refresh), not on a literal
  // read index — the live gather's read count is not the 0.4 one.
  const w = world(on, {
    'session.model': async () => {
      const seen = model
      if (armed && !heldOnce) {
        heldOnce = true
        markHeld()
        await held
      } else if (afterRelease) {
        await nextRead
      }
      return { value: seen }
    },
    'command.run': (_$: any, e: any) => {
      if (e.command === 'model') model = 'claude-opus-5-5[1m]'
      return { text: 'Set model to Opus 5.5 (1M context)' }
    },
  })
  await start($)
  await w.clock.settle()
  armed = true
  const stepDone = step($, { model: 'claude-fable-5-1', effort: 'max' })
  await heldStarted
  await modelCommand($)
  release()
  afterRelease = true
  await drain()
  // the state the OLD gather left: the newer refresh's model stands, the old
  // ticket's fable must not have landed (this is the moment F7 guards)
  const bar = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'ticket' })).drawn()))
  expect(bar).toContain('claude-opus-5-5[1m]')
  expect(bar).not.toContain('fable-5-1')
  releaseNext()
  await stepDone
})

test('S2 #17: the context follows each main-loop response while its tools run, before the turn completes', async ($, on) => {
  let context: Record<string, number> = { tokens: 12000, window: 200000 }
  let stepping = false
  let readAtRequest!: () => void
  const requestRead = new Promise<void>((resolve) => (readAtRequest = resolve))
  const w = world(on, {
    'session.usage': () => {
      if (stepping) readAtRequest()
      return { value: { context, rateLimits: [], cost: { usd: 0.01 } } }
    },
    // Beneath the plugin, a model request whose response is answered over 37K tokens:
    // the engine sends the request before the response reports the figure, so the
    // read taken as the request goes out still sees the figure of the response before it.
    'turn.step': async function* () {
      await requestRead
      context = { tokens: 37000, window: 200000 }
      return { turnId: 'turn-1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    },
  })
  await start($)
  await w.clock.settle()
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'c1' })).drawn()))).toContain('12K/200K')
  stepping = true
  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  // The request has returned and the turn has not completed: the response's tools run now.
  const whileToolsRun = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'tools-running' })).drawn()))
  expect(whileToolsRun).toContain('37K/200K')
})

test('S2 #20: a usage read that returns after a newer refresh has drawn does not put its older figures back', async ($, on) => {
  let context: Record<string, number> = { tokens: 12000, window: 200000 }
  let model = 'claude-fable-5-1'
  let armed = false
  let heldOnce = false
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let markHeld!: () => void
  const heldStarted = new Promise<void>((resolve) => (markHeld = resolve))
  // CONSTRAINT (S4-FIX3 F7): as in #16, the next gather's own read is held off
  // — the assert sees exactly what the old gather's late dispatch left.
  let afterRelease = false
  let releaseNext!: () => void
  const nextRead = new Promise<void>((resolve) => (releaseNext = resolve))
  const w = world(on, {
    'session.model': () => ({ value: model }),
    'session.usage': async () => {
      const seen = context
      if (armed && !heldOnce) {
        heldOnce = true
        markHeld()
        await held
      } else if (afterRelease) {
        await nextRead
      }
      return { value: { context: seen, rateLimits: [], cost: { usd: 0.01 } } }
    },
    'turn.step': async function* () {
      context = { tokens: 37000, window: 200000 }
      return { turnId: 'turn-1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    },
    'config.set': (_$: any, e: any) => {
      if (e.key === 'model') {
        model = String(e.value)
        context = { tokens: 52000, window: 200000 }
      }
      return { value: e.value }
    },
  })
  await start($)
  await w.clock.settle()
  armed = true
  const stepDone = step($, { model: 'claude-fable-5-1', effort: 'max' })
  await heldStarted
  await $.config.set({ key: 'model', value: 'claude-opus-5-5[1m]', previous: 'claude-fable-5-1', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  release()
  afterRelease = true
  await drain()
  // the old usage read's 12K must not have landed over the newer 52K
  const bar = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'after-both' })).drawn()))
  expect(bar).toContain('52K/200K')
  expect(bar).toContain('claude-opus-5-5[1m]')
  releaseNext()
  await stepDone
})

test('S2 #21: a field with no /config row is refused in the panel, not a throw', async ($, on) => {
  const { w, pane } = await openPanel($, on, { 'config.list': () => ({ value: [] }) })
  await pane.press({ key: 'tab:elements' })
  await w.clock.settle()
  // CONSTRAINT (ADJUDICATION-S4 Д2 п.6): the default filter is the registry's
  // first family; github sits on its own family's page
  await pane.press({ key: 'fam:github' })
  await w.clock.settle()
  await pane.press({ key: 'el:github' })
  await w.clock.settle()
  await pane.press({ key: 'save' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  await pane.drawn()
  const notice = await pane.find({ type: 'Text', text: /нет строки \/config/ })
  expect(notice?.text).toContain('template')
})

test('S2 #25: the in-flight save mark clears on matching options and names the unwritten fields on mismatch', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>([[STORE_SAVING, { fields: ['template'], values: { template: 'one={model.text}' } }]])
    await SL.restoreAfterReload(standDollar(persisted), { template: 'one={model.text}' } as never)
    // #521 FIX4 Ф3: the bare mark moves to its key; a judged-clean mark leaves no key
    expect(persisted.has(STORE_SAVING)).toBe(false)
    expect(saveMarks(persisted)).toEqual([])
    expect(SL.__diag().some((d) => d.key === 'save-unwritten')).toBe(false)

    persisted.set(STORE_SAVING, { fields: ['template'], values: { template: 'one={model.text}' } })
    await SL.restoreAfterReload(standDollar(persisted), {} as never)
    expect(persisted.has(STORE_SAVING)).toBe(false)
    expect(saveMarks(persisted).map((m) => m.fields)).toEqual([['template']])
    expect(SL.__diag().some((d) => d.text.includes('fields not written: template'))).toBe(true)
  } finally {
    SL.__resetState()
  }
})

test('S2 #26: a draft literal holding a reserved token is refused aloud by Save', async ($, on) => {
  const w = world(on, {}, {
    [STORE_OPEN]: { session: SESSION_ID },
    [STORE_DRAFT]: { session: SESSION_ID, lines: [[{ id: 'ok', body: '{model.text}' }, { id: 'lit', body: 'a||b' }]], axes: {}, elements: {}, focus: null, tab: 'layout', query: '', fam: 'all', targetLine: 0, themeName: '' },
  })
  await start($)
  const pane = await $.ui.mount(PANE_MOUNT)
  await pane.press({ key: 'save' })
  await w.clock.settle()
  await pane.drawn()
  const notice = await pane.find({ type: 'Text', text: /литерал с зарезервированным токеном/ })
  expect(notice).toBeDefined()
  expect(w.writes).toEqual([])
})

test('S2 #30: glyphs=ascii keeps every decoration byte ASCII, the data stays verbatim', () => {
  try {
    const preview = renderStand({ glyphs: 'ascii', numTokens: 'raw', template: 'git-branch||model||ctx||five-hour-limit||weekly-limit||session||cost' })
    const all = walk(preview).filter((n) => n.type === 'Text').map(textOf).join('')
    for (const ch of all) expect(ch.codePointAt(0)!).toBeLessThan(128)
    expect(flowText(preview)).toContain('demo(feature/hover)')
    // the live numUsd field has no raw branch (hooks/statusline.ts:187-199):
    // 1.2345 stands as $1.23, the 0.4 verbatim $1.2345 has no live form
    expect(flowText(preview)).toContain('$1.23')
  } finally {
    SL.__resetState()
  }
})

test('S2 #35: border options give distinct contours and ASCII degrades to single', () => {
  try {
    for (const value of ['single', 'double', 'round']) {
      const bar = barColumn(walk(renderStand({ border: value })))
      expect(bar!.props?.borderStyle).toBe(value)
    }
    const ascii = barColumn(walk(renderStand({ border: 'round', glyphs: 'ascii' })))
    expect(ascii!.props?.borderStyle).toBe('single')
  } finally {
    SL.__resetState()
  }
})

test('S2 #39: details=off draws neither a hover scope nor a card', () => {
  try {
    // CONSTRAINT (S4-FIX3 F8): the stand node carries the hover scope in
    // props — reading a bare n.hover never sees one and the assert is vacuous
    const nodes = walk(renderStand({ details: 'off' }))
    expect(nodes.filter((n) => n.type === 'Text' && typeof (n.props as { hover?: { scope?: unknown } } | undefined)?.hover?.scope === 'string')).toHaveLength(0)
    expect(nodes.filter((n) => n.type === 'Box' && n.props?.display === 'none')).toHaveLength(0)
  } finally {
    SL.__resetState()
  }
})

test('S2 #40: two fast ◀ presses move the pill two places and the focus stays on it', async () => {
  SL.__resetState()
  try {
    const RAW = { template: 'git-branch||model||ctx||five-hour-limit||weekly-limit||session||cost' }
    feedStand()
    const tree = walk(SL.__renderPicker(RAW, 'layout', 140) as Node)
    const press = (key: string): void => {
      const node = tree.find((n) => n.type === 'Button' && keyOf(n) === key)
      if (!node) throw new Error('no button ' + key)
      ;(node.props!['onPress'] as () => void)()
    }
    press('seg:ctx')
    await drain()
    press('mv:left')
    press('mv:left')
    await drain()
    // each move pressed keepFocus once: the focused pill now carries the second fresh key
    const pills = walk(SL.__renderPicker(RAW, 'layout', 140) as Node).filter((n) => n.type === 'Button' && keyOf(n).startsWith('seg:'))
    expect(keyOf(pills[0]!)).toBe('seg:ctx#move2')
    expect(String(pills[0]!.props?.label)).toContain('· ctx')
  } finally {
    SL.__resetState()
  }
})

test('S2 #41: undo after the field was changed through /config writes nothing and names the field', async ($, on) => {
  const { w, pane } = await openPanel($, on, {
    'config.list': () => ({ value: [{ key: 'catalyst-statusline.template', label: 'Template', kind: 'text', value: 'changed behind the picker', provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false }] }),
  })
  await pane.press({ key: 'tab:elements' })
  await w.clock.settle()
  // CONSTRAINT (ADJUDICATION-S4 Д2 п.6): the default filter is the registry's
  // first family; github sits on its own family's page
  await pane.press({ key: 'fam:github' })
  await w.clock.settle()
  await pane.press({ key: 'el:github' })
  await w.clock.settle()
  await pane.press({ key: 'save' })
  await w.clock.settle()
  expect(w.writes).toHaveLength(1)
  await pane.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.writes).toHaveLength(1)
  await pane.drawn()
  const notice = await pane.find({ type: 'Text', text: /не отменено/ })
  expect(notice?.text).toContain('template')
})

test('S2 #43: a draft segment on {session.short8} shows the eight-char id', () => {
  try {
    // CONSTRAINT: the live vars dictionary registers only `{id.text}`
    // (hooks/statusline.ts:1132-1146); the 0.4 body `{session.short8}` lives
    // on as the session element's first variant (hooks/data/base.ts:540).
    const preview = renderStand({ template: 's8={session.text}' })
    const t = flowText(preview)
    expect(t).toContain('4e1f0c9a')
    expect(t).not.toContain(SESSION_ID)
  } finally {
    SL.__resetState()
  }
})

test('S2 #46: every value of every wave A axis draws a distinguishable tree', () => {
  try {
    const distinct = (axis: string, values: readonly string[], prepare: Record<string, string> = {}): void => {
      const seen = values.map((value) => JSON.stringify(renderStand({ ...prepare, [axis]: value })))
      expect(new Set(seen).size).toBe(values.length)
    }
    distinct('shape', ['plain', 'lean', 'pill', 'powerline', 'classic'])
    // the live default theme is shape=plain (hooks/themes.ts:97), where caps
    // draw no glyph at all: the caps run takes the pill shape that does
    distinct('caps', ['none', 'round', 'arrow', 'unicode-round'], { glyphs: 'nerd', shape: 'pill' })
    // CONSTRAINT: the adaptive bar is 4 cells with the HUD separator, and at
    // the 8% figure nothing is filled — pairs sharing the empty glyph would
    // coincide. The bar run takes barWidth=10, the cell count the 0.4 default
    // world drew, so every named pair paints its fill glyph.
    distinct('bar', ['blocks', 'parallelogram', 'ascii', 'shade', 'baseline', 'low-blocks', 'pie'], { barWidth: '10' })
    distinct('fill', ['none', 'segment', 'band', 'inverse'])
    distinct('palette', ['semantic', 'mono', 'codex', 'claude-code'])
    distinct('border', ['none', 'single', 'double', 'round'])
  } finally {
    SL.__resetState()
  }
})
