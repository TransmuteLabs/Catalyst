import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const VIEWPORT = { columns: 140, rows: 40, isFullscreen: true }
const MOUNT = { plugin: 'catalyst-statusline', surface: 'terminal' as const, component: 'PromptHint' as const, props: HINT, requestId: 'PromptHint', viewport: VIEWPORT }
const BAND_ID = 'above-prompt'
const BAND = { hasSurvey: false, isWorking: false, maxRows: 29, bodyColumns: 140, scroll: { offset: 0, bodyRows: 29 }, view: {} }
const BAND_MOUNT = { plugin: 'catalyst-statusline', surface: 'terminal' as const, component: 'AbovePrompt' as const, props: BAND, requestId: BAND_ID }
const PREFS = 'statusline.prefs.v1'
const PICKER = 'statusline.picker.v1'
const DEFAULTS = ['git-branch', 'model', 'context', 'five-hour-limit', 'weekly-limit', 'session', 'cost']

const USAGE = {
  context: { tokens: 83000, window: 1000000, percent: 8 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 25, resetsAt: '2026-09-21T20:00:00Z' },
    { kind: 'seven_day', percentUsed: 61.5 },
  ],
  cost: { usd: 1.2345 },
}
const REPO = { root: '/work/demo', remote: 'git@github.com:konsta95/demo.git', internal: false, name: 'demo' }
const SESSION_ID = '4e1f0c9a-7b2d-4c58-9a36-d1e8f5b2c703'
const OPTION_ROWS = [
  { key: 'statusline.scheme', label: 'Scheme', kind: 'choice', value: 'claude-code', options: ['claude-code', 'codex', 'mono'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'statusline.details', label: 'Details', kind: 'boolean', value: true, provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'statusline.pin_status', label: 'Pin', kind: 'boolean', value: false, provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
]

type Mocks = Record<string, (...args: any[]) => unknown>

// The kit refuses a second on("<event>") for the same event, so a test that wants a
// different answer passes it as an override instead of registering twice. The world
// is the nouns the bar reads plus what the command and the picker touch: the store, the
// /config rows, the focus ring's moves and the command registration. Nothing beneath
// the plugins answers ui.render or prompt.submit in the kit; the two answers here stand
// in for the engine's own drawing and for the prompt entering. A ui.render answer is
// the tree itself, not { value }.
function world(on: On, over: Mocks = {}, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on)
  const persisted = new Map<string, unknown>(Object.entries(store))
  on('store.*', async ($, e, next) => {
    const result = await next(e)
    if (next.is('store.set', e)) persisted.set(e.key, JSON.parse(JSON.stringify(e.value)))
    if (next.is('store.delete', e)) persisted.delete(e.key)
    return result
  })
  mock.store(on, store)
  const opened: unknown[] = []
  const closed: unknown[] = []
  const toasts: string[] = []
  const writes: Array<{ key: string; value: unknown }> = []
  const registered: string[] = []
  const mocks: Mocks = {
    'session.cwd': () => ({ value: '/work/demo/src' }),
    'session.repo': () => ({ value: REPO }),
    'session.model': () => ({ value: 'Fable 5.1' }),
    'session.id': () => ({ value: SESSION_ID }),
    'session.usage': () => ({ value: USAGE }),
    'session.start': (_$: any, e: any) => ({ cwd: e.cwd }),
    'fs.read': (_$: any, e: any) => {
      // /work/demo/src has no .git; the walk must reach /work/demo/.git/HEAD.
      if (e.path === '/work/demo/.git/HEAD') return { value: 'ref: refs/heads/feature/hover\n' }
      throw new Error('ENOENT: ' + e.path)
    },
    'config.list': () => ({ value: OPTION_ROWS.map((row) => ({ ...row })) }),
    'config.set': (_$: any, e: any) => {
      writes.push({ key: e.key, value: e.value })
      return { value: e.value }
    },
    'command.register': (_$: any, e: any) => {
      registered.push(e.name)
      return { value: { command: e.name } }
    },
    'ui.open': (_$: any, e: any) => {
      opened.push(e)
      return { value: undefined }
    },
    'ui.close': (_$: any, e: any) => {
      closed.push(e)
      return { value: undefined }
    },
    'ui.toast': (_$: any, e: any) => {
      toasts.push(e.text)
      return { value: undefined }
    },
    'ui.focus': () => ({}),
    'ui.render': (_$: any, e: any) => ({ type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: ['ENGINE ' + e.component] }] }),
    'prompt.submit': (_$: any, e: any) => ({ text: e.text, origin: e.origin }),
    ...over,
  }
  for (const [event, fn] of Object.entries(mocks)) on(event as any, fn as any)
  return { clock, persisted, opened, closed, toasts, writes, registered }
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/demo/src' })
const command = ($: Engine, args = '', isFullscreen = true) =>
  $.command.run({ command: 'statusline-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen, columns: 140 } })
// The person moving the band's focus ring onto an element, as Tab, an arrow or a click does.
const personFocus = ($: Engine, element: string) =>
  $.ui.focus({ component: 'AbovePrompt', requestId: BAND_ID, plugin: 'catalyst-statusline', element, origin: { kind: 'person' } })

type Node = { type?: string; key?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

function walk(node: unknown, out: Node[] = []): Node[] {
  if (!node || typeof node !== 'object') return out
  const n = node as Node
  out.push(n)
  for (const child of n.children || []) walk(child, out)
  return out
}

function textOf(node: Node): string {
  return (node.children || []).map((c) => (typeof c === 'string' ? c : textOf(c as Node))).join('')
}

// The bar's Text pieces in drawing order: the ones that name a hover scope.
function barText(nodes: Node[]): string {
  return nodes.filter((n) => n.type === 'Text' && typeof n.hover?.scope === 'string').map(textOf).join('')
}

test('the hint line draws the default segments from the session nouns', async ($, on) => {
  world(on)

  const ui = await $.ui.mount(MOUNT)

  expect(await ui.find({ type: 'Text', text: 'demo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '(feature/hover)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fable5.1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '83K/1M' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '62%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: SESSION_ID })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$1.23' })).toBeDefined()
  expect(barText(walk(await ui.drawn()))).toBe('demo(feature/hover)Fable5.183K/1M5h 25%7d 62%' + SESSION_ID + '$1.23')
})

test('every segment names a hover scope that reveals its own card over the row above the bar', async ($, on) => {
  world(on)

  const ui = await $.ui.mount(MOUNT)
  const tree = (await ui.drawn()) as Node
  const nodes = walk(tree)

  const scopesOnText = new Set(nodes.filter((n) => n.type === 'Text' && typeof n.hover?.scope === 'string').map((n) => n.hover!.scope as string))
  const cards = nodes.filter((n) => n.type === 'Box' && n.props?.display === 'none')

  expect([...scopesOnText].sort()).toEqual(['sl-context', 'sl-cost', 'sl-five-hour-limit', 'sl-git-branch', 'sl-model', 'sl-session', 'sl-weekly-limit'])
  expect(cards).toHaveLength(7)
  expect(tree.props?.flexDirection).toBe('row')
  // Each card is placed against the root row, one row up, from the bar's first column:
  // out of the flow, so revealing it gives no sibling less room and moves no row.
  for (const card of cards) {
    expect(tree.children).toContain(card)
    expect(card.props).toMatchObject({ position: 'absolute', top: -1, left: 0 })
    expect(card.hover).toMatchObject({ display: 'flex' })
    expect(scopesOnText.has(card.hover!.scope as string)).toBe(true)
  }
  // What stays in the flow is the bar and the engine hint, nothing a hover can widen.
  const inFlow = (tree.children as Node[]).filter((c) => c.props?.position !== 'absolute')
  expect(inFlow).toHaveLength(2)
  expect(inFlow.some((c) => walk(c).some((n) => n.props?.display === 'none'))).toBe(false)
  expect(textOf(cards.find((b) => b.hover!.scope === 'sl-git-branch')!)).toContain('github konsta95/demo')
  expect(textOf(tree)).not.toContain('<<sl:')
})

test('the engine hint follows the bar, dim, at rest and while working', async ($, on) => {
  world(on)

  const rest = await $.ui.mount(MOUNT)
  expect((await rest.find({ type: 'Text', text: /\? for shortcuts/ }))?.props).toMatchObject({ dimColor: true })
  const drawn = walk(await rest.drawn())
  expect(textOf(drawn[0]).indexOf('$1.23')).toBeLessThan(textOf(drawn[0]).indexOf('? for shortcuts'))

  const working = await $.ui.mount({ ...MOUNT, props: { ...HINT, isWorking: true, hint: 'esc to interrupt' }, requestId: 'working' })
  expect(await working.find({ type: 'Text', text: /esc to interrupt/ })).toBeDefined()
  expect(await working.find({ type: 'Text', text: '83K/1M' })).toBeDefined()
})

test('the stored order is honoured and unknown ids are dropped', async ($, on) => {
  world(on, {}, { [PREFS]: { ids: ['cost', 'github', 'bogus', 'directory', 'cost'] } })

  const ui = await $.ui.mount(MOUNT)
  const nodes = walk(await ui.drawn())

  expect(barText(nodes)).toBe('$1.23konsta95/demosrc')
  expect(nodes.filter((n) => n.type === 'Box' && n.props?.display === 'none').map((n) => n.hover!.scope)).toEqual(['sl-cost', 'sl-github', 'sl-directory'])
})

test('with every segment off the hook passes the hint line through', async ($, on) => {
  world(on, {}, { [PREFS]: { ids: [] } })

  const ui = await $.ui.mount(MOUNT)

  expect(await ui.find({ type: 'Text', text: 'ENGINE PromptHint' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: '83K/1M' })).toHaveLength(0)
})

test('a failing noun marks its segments and the rest still draw', async ($, on) => {
  world(on, {
    'session.usage': () => {
      throw new Error('usage exploded')
    },
    'fs.read': (_$: any, e: any) => {
      throw new Error('ENOENT: ' + e.path)
    },
  })

  const ui = await $.ui.mount(MOUNT)

  expect(await ui.find({ type: 'Text', text: 'src' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'context!' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'five-hour-limit!' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fable5.1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: SESSION_ID })).toBeDefined()
})

test('a model id from the engine draws as its display name and keeps the id in the detail', async ($, on) => {
  world(on, { 'session.model': () => ({ value: 'claude-fable-5-1' }) })

  const ui = await $.ui.mount(MOUNT)
  const nodes = walk(await ui.drawn())

  const barPieces = nodes.filter((n) => n.type === 'Text' && n.hover?.scope === 'sl-model').map(textOf)
  expect(barPieces).toContain('Fable5.1')
  expect(barPieces.some((t) => t.includes('claude-'))).toBe(false)
  expect(textOf(nodes.find((n) => n.type === 'Box' && n.hover?.scope === 'sl-model')!)).toContain('model claude-fable-5-1')
})

test('displayName maps claude ids the way the classic payload names them', async () => {
  const { displayName } = await import('../hooks/statusline')
  expect(displayName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(displayName('claude-opus-5')).toBe('Opus 5')
  expect(displayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(displayName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(displayName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(displayName('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  expect(displayName('Fable 5.1')).toBe('Fable 5.1')
  expect(displayName('haiku')).toBe('haiku')
})

test('before the first response the context draws 0 of the window, as the classic line does', async ($, on) => {
  world(on, { 'session.usage': () => ({ value: { ...USAGE, context: { window: 1000000 } } }) })

  const ui = await $.ui.mount(MOUNT)

  expect(await ui.find({ type: 'Text', text: '0/1M' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: 'context!' })).toHaveLength(0)
})

test('an effort row among the config rows seeds the level before any turn.step', async ($, on) => {
  world(on, {
    'config.list': () => ({
      value: [{ key: 'effortLevel', label: 'Effort', kind: 'choice', value: 'xhigh', options: ['low', 'medium', 'high', 'xhigh', 'max'], provider: { plugin: 'engine', tier: 'user' }, isLocked: false }],
    }),
  })

  const ui = await $.ui.mount(MOUNT)
  const nodes = walk(await ui.drawn())

  expect(await ui.find({ type: 'Text', text: 'xhigh' })).toBeDefined()
  expect(textOf(nodes.find((n) => n.type === 'Box' && n.hover?.scope === 'sl-model')!)).toContain('effort xhigh')
})

test('the first gathers of a session share one read of the config rows', async ($, on) => {
  let reads = 0
  world(on, {
    'config.list': () => {
      reads += 1
      return { value: OPTION_ROWS.map((row) => ({ ...row })) }
    },
  })

  await Promise.all([start($), $.ui.mount(MOUNT)])

  expect(reads).toBe(1)
})

test('session.start registers /statusline-mod and the bare command opens the picker in the band above the prompt', async ($, on) => {
  const w = world(on)

  await start($)
  expect(w.registered).toEqual(['statusline-mod'])
  const before = await $.ui.mount(BAND_MOUNT)
  expect(await before.find({ key: 'segment:model' })).toBeUndefined()
  await before.unmount()

  const result = await command($)
  expect(result.text).toBeUndefined()
  expect(w.opened).toEqual([])
  expect(w.persisted.get(PICKER)).toEqual({ session: SESSION_ID })
  const band = await $.ui.mount(BAND_MOUNT)
  expect(await band.find({ key: 'segment:model' })).toBeDefined()
})

test('show answers with the current line; reset restores the defaults; other args give the usage', async ($, on) => {
  const w = world(on, {}, { [PREFS]: { ids: ['cost', 'model'] } })
  await start($)

  const shown = await command($, 'show')
  expect(shown.text).toContain('Status line: cost, model')
  expect(shown.text).toContain('Not shown: git-branch')

  const reset = await command($, 'reset')
  expect(reset.text).toContain('reset to')
  expect(w.persisted.get(PREFS)).toEqual({ ids: DEFAULTS })

  const usage = await command($, 'nonsense')
  expect(usage.text).toContain('Usage: /statusline-mod')
  expect(w.persisted.has(PICKER)).toBe(false)
})

test('a non-interactive session gets the summary instead of the picker', async ($, on) => {
  const w = world(on)
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work/demo/src' })

  const result = await command($)
  expect(result.text).toContain('Status line: ' + DEFAULTS.join(', '))
  expect(w.persisted.has(PICKER)).toBe(false)
})

test('the picker lists the chosen segments first under the digits 1 to 0, then the rest, and draws no Select', async ($, on) => {
  world(on, {}, { [PREFS]: { ids: ['cost', 'model'] } })
  await start($)
  await command($)
  const band = await $.ui.mount(BAND_MOUNT)
  const buttons = await band.findAll({ type: 'Button' })
  const rows = buttons.filter((b) => (b.key ?? '').startsWith('segment:'))

  expect(rows.map((b) => b.key)).toEqual(['segment:cost', 'segment:model', 'segment:git-branch', 'segment:directory', 'segment:branch', 'segment:github', 'segment:context', 'segment:five-hour-limit', 'segment:weekly-limit', 'segment:session'])
  expect(rows.map((b) => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
  expect(rows[0].props.label).toBe('[✔] cost')
  expect(rows[2].props.label).toBe('[ ] git branch')
  expect(buttons.filter((b) => !(b.key ?? '').startsWith('segment:')).map((b) => [b.key, b.props.hotkey])).toEqual([
    ['scheme', 's'],
    ['details', 'h'],
    ['pin', 'p'],
    ['up', 'u'],
    ['down', 'd'],
    ['reset', 'r'],
    ['close', 'q'],
  ])
  expect(await band.findAll({ type: 'Select' })).toEqual([])
  expect(await band.find({ type: 'Text', text: /the session cost in dollars/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '$1.23' })).toBeDefined()
})

test('a press toggles a segment and the line under the prompt follows', async ($, on) => {
  const w = world(on)
  await start($)
  await command($)
  const band = await $.ui.mount(BAND_MOUNT)

  await band.press({ key: 'segment:cost' })
  await w.clock.settle()
  expect(w.persisted.get(PREFS)).toEqual({ ids: DEFAULTS.filter((id) => id !== 'cost') })

  await band.press({ key: 'segment:github' })
  await w.clock.settle()
  const line = await $.ui.mount(MOUNT)
  expect(barText(walk(await line.drawn()))).toBe('demo(feature/hover)Fable5.183K/1M5h 25%7d 62%' + SESSION_ID + 'konsta95/demo')
  expect(w.toasts).toEqual([])
})

test('u and d move the segment that last held the focus ring', async ($, on) => {
  const w = world(on)
  await start($)
  await command($)
  const band = await $.ui.mount(BAND_MOUNT)

  await personFocus($, 'segment:context')
  await band.press({ key: 'up' })
  await w.clock.settle()
  expect((w.persisted.get(PREFS) as { ids: string[] }).ids.slice(0, 3)).toEqual(['git-branch', 'context', 'model'])

  await band.press({ key: 'down' })
  await band.press({ key: 'down' })
  await w.clock.settle()
  expect((w.persisted.get(PREFS) as { ids: string[] }).ids.slice(0, 4)).toEqual(['git-branch', 'model', 'five-hour-limit', 'context'])
  expect(w.toasts).toEqual([])
})

test('u and d with no segment in focus, or on a segment that is off, leave the order alone and say why', async ($, on) => {
  const w = world(on)
  await start($)
  await command($)
  const band = await $.ui.mount(BAND_MOUNT)

  await band.press({ key: 'up' })
  await w.clock.settle()
  expect(w.persisted.has(PREFS)).toBe(false)
  expect(w.toasts).toEqual(['put the focus on a segment first (ctrl+x tab, then the arrows)'])

  await personFocus($, 'segment:github')
  await band.press({ key: 'down' })
  await w.clock.settle()
  expect(w.persisted.has(PREFS)).toBe(false)
  expect(w.toasts[1]).toBe('github is off; turn it on to place it')
})

// The ring keeps its place in the band rather than its element, and the engine lands a
// plugin's $.ui.focus on the element as drawn before the redraw a press asked for
// (2.1.280), so the row the ring was on is drawn under a key no drawing had yet, for the
// ring to be moved onto once the redraw brings it. The ring landing there is checked
// live: a plugin's own $.ui.focus has no implementation in the kit (2.1.280: it throws,
// and the test's on('ui.focus') never sees it), and that failed move must cost nothing.
test('a press that reorders the rows draws the row the ring was on under a key no drawing had yet', async ($, on) => {
  const w = world(on)
  await start($)
  await command($)
  const band = await $.ui.mount(BAND_MOUNT)
  const keys = async () => (await band.findAll({ type: 'Button' })).map((b) => b.key ?? '')
  const fresh = async (before: string[]) => (await keys()).filter((key) => !before.includes(key))

  await personFocus($, 'segment:context')
  let before = await keys()
  await band.press({ key: 'up' })
  const moved = await fresh(before)
  expect(moved).toHaveLength(1)
  expect(moved[0]).toStartWith('segment:context#')

  before = await keys()
  await band.press({ key: 'segment:model' })
  const kept = await fresh(before)
  expect(kept).toHaveLength(1)
  expect(kept[0]).toStartWith('segment:context#')

  before = await keys()
  await band.press({ key: 'reset' })
  const reset = await fresh(before)
  expect(reset).toHaveLength(1)
  expect(reset[0]).toStartWith('segment:context#')

  await band.press({ key: reset[0] })
  expect((w.persisted.get(PREFS) as { ids: string[] }).ids).toEqual(DEFAULTS.filter((id) => id !== 'context'))
  expect(w.toasts).toEqual([])
})

test('with the ring on Move up the rows keep their keys, so pressing it again moves the same segment', async ($, on) => {
  const w = world(on)
  await start($)
  await command($)
  const band = await $.ui.mount(BAND_MOUNT)

  await personFocus($, 'segment:session')
  await personFocus($, 'up')
  await band.press({ key: 'up' })
  await band.press({ key: 'up' })
  expect((w.persisted.get(PREFS) as { ids: string[] }).ids).toEqual(['git-branch', 'model', 'context', 'session', 'five-hour-limit', 'weekly-limit', 'cost'])
  expect((await band.findAll({ type: 'Button' })).map((b) => b.key ?? '').filter((key) => key.includes('#'))).toEqual([])
  expect(w.toasts).toEqual([])
})

test('the options write this plugin’s own /config rows, reset restores the defaults, and close takes the picker down', async ($, on) => {
  const w = world(on)
  await start($)
  await command($)
  const band = await $.ui.mount(BAND_MOUNT)

  await band.press({ key: 'scheme' })
  await band.press({ key: 'details' })
  await band.press({ key: 'pin' })
  await w.clock.settle()
  expect(w.writes).toEqual([
    { key: 'statusline.scheme', value: 'mono' },
    { key: 'statusline.details', value: false },
    { key: 'statusline.pin_status', value: true },
  ])

  await band.press({ key: 'reset' })
  await w.clock.settle()
  expect(w.persisted.get(PREFS)).toEqual({ ids: DEFAULTS })

  await band.press({ key: 'close' })
  await w.clock.settle()
  expect(w.persisted.has(PICKER)).toBe(false)
  expect(await band.find({ key: 'segment:model' })).toBeUndefined()
  expect(w.toasts).toEqual([])
})

test('an option with no /config row is refused with a toast, not a throw', async ($, on) => {
  const w = world(on, { 'config.list': () => ({ value: [] }) })
  await start($)
  await command($)
  const band = await $.ui.mount(BAND_MOUNT)

  await band.press({ key: 'details' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('no /config row for details')
})

test('the picker stays open through a module reload for the session that opened it', async ($, on) => {
  world(on, {}, { [PICKER]: { session: SESSION_ID } })
  await start($)
  const band = await $.ui.mount(BAND_MOUNT)
  expect(await band.find({ key: 'segment:model' })).toBeDefined()
})

test('a picker another session opened is not drawn', async ($, on) => {
  world(on, {}, { [PICKER]: { session: 'b7c3a1d2-0e4f-4a6b-8c9d-1f2e3a4b5c6d' } })
  await start($)
  const band = await $.ui.mount(BAND_MOUNT)
  expect(await band.find({ key: 'segment:model' })).toBeUndefined()
})

test('the picker yields the band to a survey', async ($, on) => {
  world(on)
  await start($)
  await command($)
  const band = await $.ui.mount({ ...BAND_MOUNT, props: { ...BAND, hasSurvey: true } })
  expect(await band.find({ key: 'segment:model' })).toBeUndefined()
})

test('a prompt the person sends closes the picker; a prompt a plugin submits leaves it open', async ($, on) => {
  const w = world(on)
  await start($)
  await command($)

  await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } })
  expect(w.persisted.get(PICKER)).toEqual({ session: SESSION_ID })

  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect(w.persisted.has(PICKER)).toBe(false)
  const band = await $.ui.mount(BAND_MOUNT)
  expect(await band.find({ key: 'segment:model' })).toBeUndefined()
})

// At 100 cells the ten segments take two grid rows, the options two and the footer two.
test('a band too short for a row per segment draws them as a grid without descriptions, and the footer while it fits', async ($, on) => {
  world(on)
  await start($)
  await command($)
  const band = await $.ui.mount({ ...BAND_MOUNT, props: { ...BAND, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 } } })
  const rows = (await band.findAll({ type: 'Button' })).filter((b) => (b.key ?? '').startsWith('segment:'))
  expect(rows.map((b) => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
  expect(await band.find({ type: 'Text', text: /the session cost in dollars/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /ctrl\+x tab/ })).toBeDefined()

  const shorter = await $.ui.mount({ ...BAND_MOUNT, requestId: 'shorter', props: { ...BAND, maxRows: 7, bodyColumns: 100, scroll: { offset: 0, bodyRows: 7 } } })
  expect((await shorter.findAll({ type: 'Button' })).filter((b) => (b.key ?? '').startsWith('segment:'))).toHaveLength(10)
  expect(await shorter.find({ type: 'Text', text: /ctrl\+x tab/ })).toBeUndefined()

  const tall = await $.ui.mount({ ...BAND_MOUNT, requestId: 'tall', props: { ...BAND, maxRows: 16, bodyColumns: 100, scroll: { offset: 0, bodyRows: 16 } } })
  expect(await tall.find({ type: 'Text', text: /the session cost in dollars/ })).toBeDefined()
})

test('a draw of the band that begins while an earlier one is still reading waits for it to finish', async ($, on) => {
  let slow = false
  let idCalls = 0
  const w = world(
    on,
    {
      'session.id': async () => {
        idCalls++
        if (slow) await w.clock.sleep(100)
        return { value: SESSION_ID }
      },
    },
    { [PICKER]: { session: SESSION_ID } },
  )
  await start($)
  slow = true
  const before = idCalls
  const finished: string[] = []

  const first = $.ui.mount(BAND_MOUNT).then((ui) => (finished.push('first'), ui))
  await w.clock.settle()
  const second = $.ui.mount({ ...BAND_MOUNT, requestId: 'second' }).then((ui) => (finished.push('second'), ui))
  await w.clock.settle()
  expect(idCalls - before).toBe(1)
  expect(finished).toEqual([])

  await w.clock.advance(100)
  await Promise.all([first, second])
  expect(finished).toEqual(['first', 'second'])
  expect(await (await second).find({ key: 'segment:model' })).toBeDefined()
})

const STEP = { turnId: 'turn-1', index: 0, messageCount: 1 }
const STEP_RESULT = { turnId: 'turn-1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
// Beneath the plugin, a model request that answers at once with an empty response.
const ANSWER = {
  'turn.step': async function* () {
    return { ...STEP_RESULT }
  },
}
const modelCommand = ($: Engine) =>
  $.command.run({ command: 'model', args: 'opus', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

// Reads a model request through to its end, the way the engine consumes the stream.
async function step($: Engine, input: Record<string, unknown>) {
  const stream = $.turn.step({ ...STEP, ...input } as any)
  for await (const _chunk of stream) {
    // the chunks are the model's, nothing here reads them
  }
  return stream.result
}

test('a model switch shows from the first main-loop request, before the turn completes', async ($, on) => {
  let model = 'claude-fable-5-1'
  world(on, { ...ANSWER, 'session.model': () => ({ value: model }) })
  await start($)
  expect(barText(walk(await (await $.ui.mount(MOUNT)).drawn()))).toContain('Fable5.1')

  model = 'claude-opus-5-5[1m]'
  await step($, { model: 'claude-opus-5-5', effort: 'max' })

  const during = barText(walk(await (await $.ui.mount({ ...MOUNT, requestId: 'during-turn' })).drawn()))
  expect(during).toContain('Opus5.5 max')
  expect(during).not.toContain('Fable')
})

test('a subagent request leaves the model and effort on the bar alone', async ($, on) => {
  world(on, ANSWER)
  await start($)

  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await step($, { model: 'claude-haiku-4-5-20251001', effort: 'low', agentId: 'agent-1' })

  const bar = barText(walk(await (await $.ui.mount(MOUNT)).drawn()))
  expect(bar).toContain('Fable5.1 max')
  expect(bar).not.toContain('low')
  expect(bar).not.toContain('Haiku')
})

test('/model redraws the bar with the new model once the command has run', async ($, on) => {
  let model = 'claude-fable-5-1'
  world(on, {
    'session.model': () => ({ value: model }),
    'command.run': (_$: any, e: any) => {
      if (e.command === 'model') model = 'claude-opus-5-5[1m]'
      return { text: 'Set model to Opus 5.5 (1M context)' }
    },
  })
  await start($)

  const result = await modelCommand($)

  expect(result.text).toBe('Set model to Opus 5.5 (1M context)')
  expect(barText(walk(await (await $.ui.mount(MOUNT)).drawn()))).toContain('Opus5.5')
})

test('a change to the model row of /config redraws the bar once it is written', async ($, on) => {
  let model = 'claude-fable-5-1'
  world(on, {
    'session.model': () => ({ value: model }),
    'config.set': (_$: any, e: any) => {
      if (e.key === 'model') model = String(e.value)
      return { value: e.value }
    },
  })
  await start($)

  await $.config.set({ key: 'model', value: 'claude-opus-5-5[1m]', previous: 'claude-fable-5-1', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })

  expect(barText(walk(await (await $.ui.mount(MOUNT)).drawn()))).toContain('Opus5.5')
})

test('a refresh that finishes after a newer one does not put the older model back', async ($, on) => {
  let model = 'claude-fable-5-1'
  let reads = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let markHeld!: () => void
  const heldStarted = new Promise<void>((resolve) => (markHeld = resolve))
  world(on, {
    ...ANSWER,
    // The second read of the model is the step's: it sees the old model and is held
    // until the refresh after /model has drawn the new one.
    'session.model': async () => {
      reads += 1
      const seen = model
      if (reads === 2) {
        markHeld()
        await held
      }
      return { value: seen }
    },
    'command.run': (_$: any, e: any) => {
      if (e.command === 'model') model = 'claude-opus-5-5[1m]'
      return { text: 'Set model to Opus 5.5 (1M context)' }
    },
  })
  await start($)

  const stepDone = step($, { model: 'claude-fable-5-1', effort: 'max' })
  await heldStarted
  await modelCommand($)
  release()
  await stepDone

  expect(reads).toBe(3)
  const bar = barText(walk(await (await $.ui.mount(MOUNT)).drawn()))
  expect(bar).toContain('Opus5.5')
  expect(bar).not.toContain('Fable')
})

// A core command typed at the prompt, the way the engine raises it.
const core = ($: Engine, name: string) =>
  $.command.run({ command: name, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

test('the context follows each main-loop response while its tools run, before the turn completes', async ($, on) => {
  let context: Record<string, number> = { tokens: 12000, window: 200000 }
  let stepping = false
  let readAtRequest!: () => void
  const requestRead = new Promise<void>((resolve) => (readAtRequest = resolve))
  world(on, {
    'session.usage': () => {
      if (stepping) readAtRequest()
      return { value: { ...USAGE, context } }
    },
    // Beneath the plugin, a model request whose response is answered over 37K tokens.
    // The engine sends the request before the response reports that figure, so a read
    // as the request goes out still sees the figure of the response before it.
    'turn.step': async function* () {
      await requestRead
      context = { tokens: 37000, window: 200000 }
      return { ...STEP_RESULT }
    },
  })
  await start($)
  expect(barText(walk(await (await $.ui.mount(MOUNT)).drawn()))).toContain('12K/200K')

  stepping = true
  await step($, { model: 'claude-fable-5-1', effort: 'max' })

  // The request has returned and the turn has not completed: the response's tools run now.
  const whileToolsRun = barText(walk(await (await $.ui.mount({ ...MOUNT, requestId: 'tools-running' })).drawn()))
  expect(whileToolsRun).toContain('37K/200K')
})

// Every redraw the plugin asks for is a frame in which 2.1.280 draws its own hint row
// stacked over the bar (measured live), so a refresh that finds the bar as it was asks
// for none, and one that changes it still asks.
test('a refresh that leaves the bar as it was asks for no redraw; one that changes it asks once', async ($, on) => {
  let context: Record<string, number> = { tokens: 12000, window: 200000 }
  const redraws: string[] = []
  const w = world(on, {
    ...ANSWER,
    'session.usage': () => ({ value: { ...USAGE, context } }),
    'ui.invalidate': (_$: any, e: any, next: any) => {
      redraws.push(e.event)
      return next(e)
    },
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await w.clock.settle()
  expect(barText(walk(await line.drawn()))).toContain('Fable5.1 max')
  redraws.length = 0

  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await w.clock.settle()
  expect(redraws).toEqual([])
  expect(barText(walk(await line.drawn()))).toContain('12K/200K')

  context = { tokens: 37000, window: 200000 }
  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await w.clock.settle()
  expect(redraws).toEqual(['ui.render'])
  expect(barText(walk(await line.drawn()))).toContain('37K/200K')
})

// After a turn is interrupted, 2.1.280 answers the context with no count, which its
// typings keep for a fresh or just-compacted window, while its classic status line
// payload keeps the figure (both measured live).
test('an interrupted turn keeps the context figure on the bar; a finished turn shows what the engine reports', async ($, on) => {
  let context: Record<string, number> = { tokens: 37000, window: 200000 }
  const w = world(on, {
    ...ANSWER,
    'session.usage': () => ({ value: { ...USAGE, context } }),
    'turn.complete': (_$: any, e: any) => ({ text: e.answer }),
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await w.clock.settle()
  expect(barText(walk(await line.drawn()))).toContain('37K/200K')

  context = { window: 200000 }
  await $.turn.complete({ answer: '', durationMs: 5000, isAborted: true, turnId: 'turn-1', reason: 'aborted' } as any)
  await w.clock.settle()
  expect(barText(walk(await line.drawn()))).toContain('37K/200K')

  await $.turn.complete({ answer: 'done', durationMs: 5000, isAborted: false, turnId: 'turn-2', reason: 'answer' } as any)
  await w.clock.settle()
  expect(barText(walk(await line.drawn()))).toContain('0/200K')
})

test('/clear redraws the bar with the new session and its empty context once the command has run', async ($, on) => {
  const NEW_ID = 'b7c3a1d2-0e4f-4a6b-8c9d-1f2e3a4b5c6d'
  let id = SESSION_ID
  let usage: Record<string, unknown> = USAGE
  world(on, {
    'session.id': () => ({ value: id }),
    'session.usage': () => ({ value: usage }),
    // Beneath the plugin, the core /clear: the process goes on under a new session id
    // whose context no response has measured yet.
    'command.run': (_$: any, e: any) => {
      if (e.command === 'clear') {
        id = NEW_ID
        usage = { ...USAGE, context: { window: 1000000 }, cost: { usd: 0 } }
      }
      return { text: '' }
    },
  })
  await start($)
  expect(barText(walk(await (await $.ui.mount(MOUNT)).drawn()))).toContain('83K/1M')

  await core($, 'clear')

  const after = await $.ui.mount({ ...MOUNT, requestId: 'after-clear' })
  const bar = barText(walk(await after.drawn()))
  expect(await after.find({ type: 'Text', text: '0/1M' })).toBeDefined()
  expect(bar).toContain(NEW_ID)
  expect(bar).not.toContain(SESSION_ID)
})

// Measured on 2.1.280: after /compact the context keeps the figure of the last response
// (the compaction's own request is not one), and the cost has grown by that request.
test('/compact redraws the bar with the cost the compaction added once it has run', async ($, on) => {
  let usage: Record<string, unknown> = { ...USAGE, context: { tokens: 42000, window: 200000 }, cost: { usd: 0.09 } }
  world(on, {
    'session.usage': () => ({ value: usage }),
    'command.run': (_$: any, e: any) => {
      if (e.command === 'compact') usage = { ...usage, cost: { usd: 0.1 } }
      return { text: 'Compacted' }
    },
  })
  await start($)
  expect(barText(walk(await (await $.ui.mount(MOUNT)).drawn()))).toContain('$0.09')

  await core($, 'compact')

  const bar = barText(walk(await (await $.ui.mount({ ...MOUNT, requestId: 'after-compact' })).drawn()))
  expect(bar).toContain('42K/200K')
  expect(bar).toContain('$0.10')
})

test('a usage read that works once the response has arrived clears the mark a failed read left', async ($, on) => {
  let failing = false
  let stepping = false
  let readAtRequest!: () => void
  const requestRead = new Promise<void>((resolve) => (readAtRequest = resolve))
  world(on, {
    'session.usage': () => {
      if (stepping) readAtRequest()
      if (failing) throw new Error('usage unavailable')
      return { value: USAGE }
    },
    // The read as the request goes out fails; by the time the response has arrived
    // the usage reads again.
    'turn.step': async function* () {
      await requestRead
      failing = false
      return { ...STEP_RESULT }
    },
  })
  await start($)
  failing = true
  stepping = true

  await step($, { model: 'claude-fable-5-1', effort: 'max' })

  const ui = await $.ui.mount({ ...MOUNT, requestId: 'after-recovery' })
  expect(await ui.find({ type: 'Text', text: 'context!' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '83K/1M' })).toBeDefined()
})

test('a usage read that returns after a newer refresh has drawn does not put its older figures back', async ($, on) => {
  let context: Record<string, number> = { tokens: 12000, window: 200000 }
  let model = 'claude-fable-5-1'
  let stepping = false
  let reads = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let markHeld!: () => void
  const heldStarted = new Promise<void>((resolve) => (markHeld = resolve))
  world(on, {
    'session.model': () => ({ value: model }),
    // The step's second read is the one once its response has arrived: it sees 37K and
    // is held until the refresh after a /config write has drawn newer figures.
    'session.usage': async () => {
      const seen = context
      if (stepping && ++reads === 2) {
        markHeld()
        await held
      }
      return { value: { ...USAGE, context: seen } }
    },
    'turn.step': async function* () {
      context = { tokens: 37000, window: 200000 }
      return { ...STEP_RESULT }
    },
    // Whatever moved the figures while the read was out, the refresh after the write
    // began later and reads them.
    'config.set': (_$: any, e: any) => {
      if (e.key === 'model') {
        model = String(e.value)
        context = { tokens: 52000, window: 200000 }
      }
      return { value: e.value }
    },
  })
  await start($)
  stepping = true

  const stepDone = step($, { model: 'claude-fable-5-1', effort: 'max' })
  await heldStarted
  await $.config.set({ key: 'model', value: 'claude-opus-5-5[1m]', previous: 'claude-fable-5-1', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  release()
  await stepDone

  const bar = barText(walk(await (await $.ui.mount({ ...MOUNT, requestId: 'after-both' })).drawn()))
  expect(bar).toContain('52K/200K')
  expect(bar).toContain('Opus5.5')
})

const PANE = { title: 'Bad hover', isFocused: true, bodyColumns: 120, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} }

const BAD_HOVER = {
  name: 'bad-hover',
  register(on: any) {
    on('ui.render', { component: 'Pane' }, async ($: any, e: any) => {
      const { Box, Text } = await $.ui.resolve(e)

      return Box({ children: [Text({ children: 'no scope, no keyed Box', hover: { bold: true } })] })
    })
  },
}

test('control: a Text hover with no scope under no keyed Box is refused', { plugins: [BAD_HOVER] }, async ($) => {
  await expect($.ui.mount({ plugin: 'bad-hover', surface: 'terminal', component: 'Pane', props: { ...PANE, title: 'Bad hover' }, requestId: 'bad-hover' })).rejects.toThrow(
    /hover has no Box with a key around it/,
  )
})
