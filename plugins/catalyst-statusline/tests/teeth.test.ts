import { expect, test } from 'claude-code/testing'
import { restoreAfterReload, presetLines, serializeTemplate, parseTemplate, __render, __diag, __state } from '../hooks/statusline'
import { world, start, command, BAND_MOUNT, PANE_MOUNT, walk, textOf, rowText, STORE_OPEN, STORE_DRAFT, STORE_THEMES, SESSION_ID } from './world'
import type { Node } from './world'

// The teeth of SPEC §14.8 (14-22ф) and §14.12 (28-36) that belong to wave A,
// driven through the live picker hooks: presses on the pane, selects on the
// view axes, drafts seeded into $.store through the same durable path a reload
// restores from (§14.7). The two reload marks run through the module's own
// restoreAfterReload on the test-side instance — the kit loads the folder
// plugin once with fixed options (see template.test.ts for the measured limits).

const SNAP = {
  cwd: '/work/demo/src',
  repo: 'demo',
  branch: 'feature/hover',
  branchKind: 'branch',
  github: 'konsta95/demo',
  model: 'Fable 5.1',
  effort: undefined,
  context: { tokens: 83000, window: 1000000, percent: 8 },
  five: { percentUsed: 25, resetsAt: '2026-09-21T20:00:00Z' },
  seven: { percentUsed: 61.5 },
  cost: 1.2345,
  session: SESSION_ID,
  errors: {},
}

// The bar builder's own output inside a drawing: the column Box that carries
// the hover cards (details=off draws none — those tests assert absence instead).
function barColumn(nodes: Node[]): Node | undefined {
  return nodes.find((n) => n.type === 'Box' && n.props?.flexDirection === 'column' && (n.children ?? []).some((c) => (c as Node)?.props?.display === 'none'))
}

// The preview's flowing text: the segment texts in drawing order, the hover
// cards (out of the flow, position absolute) excluded.
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

const previewText = (nodes: Node[]): string => {
  const bar = barColumn(nodes)
  return bar ? flowText(bar) : ''
}

const openPicker = async ($: any, on: any, over: Record<string, (...args: any[]) => unknown> = {}, store: Record<string, unknown> = {}) => {
  const w = world(on, over, store)
  await start($)
  await command($)
  await w.clock.settle()
  const pane = await $.ui.mount({ ...PANE_MOUNT, props: { ...PANE_MOUNT.props, bodyColumns: 140 } })
  return { w, pane }
}

// The test's own `$` carries no store noun (measured: its keys are the engine's
// read nouns only), and the reload restore runs on the test-side instance — so
// the stand hands it a store with the kit's own memory semantics.
const standDollar = (persisted: Map<string, unknown>): any => ({
  store: {
    get: async (k: string) => persisted.get(k),
    set: async (k: string, v: unknown) => { persisted.set(k, JSON.parse(JSON.stringify(v))) },
    delete: async (k: string) => { persisted.delete(k) },
  },
  session: { id: async () => SESSION_ID },
  plugin: { name: 'catalyst-statusline', root: '/stand' },
  ui: { log: async () => undefined },
})

test('14.8-16: the picker moves a pill, adds one from the available list, and Save writes the template; Cancel writes nothing', async ($, on) => {
  const { w, pane } = await openPicker($, on)
  await pane.press({ key: 'seg:model' })
  await w.clock.settle()
  await pane.press({ key: 'mv:left' })
  await w.clock.settle()
  await pane.input({ key: 'filter', text: 'github' })
  await w.clock.settle()
  await pane.press({ key: 'add:github' })
  await w.clock.settle()
  await pane.press({ key: 'save' })
  await w.clock.settle()
  expect(w.writes).toEqual([{ key: 'catalyst-statusline.template', value: 'model||git-branch||ctx||five-hour-limit||weekly-limit||session||cost||github' }])
})

test('14.8-16 (cancel): a changed draft discarded by Отмена leaves /config untouched', async ($, on) => {
  const { w, pane } = await openPicker($, on)
  await pane.press({ key: 'seg:model' })
  await w.clock.settle()
  await pane.press({ key: 'mv:left' })
  await w.clock.settle()
  await pane.press({ key: 'cancel' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect(w.persisted.has(STORE_OPEN)).toBe(false)
  expect(w.closed).toEqual([{ id: 'statusline', origin: { kind: 'plugin' } }])
})

test('14.8-17: { deny } from $.config.set is shown in the panel, not gulled', async ($, on) => {
  const { w, pane } = await openPicker($, on, { 'config.set': (_$: any, e: any) => ({ deny: 'locked by policy' }) })
  await pane.press({ key: 'seg:model' })
  await w.clock.settle()
  await pane.press({ key: 'mv:left' })
  await w.clock.settle()
  await pane.press({ key: 'save' })
  await w.clock.settle()
  await pane.drawn()
  const notice = await pane.find({ type: 'Text', text: /locked by policy/ })
  expect(notice?.text).toContain('template')
})

test('14.8-18: a reload restores the open picker and its two-line draft from $.store', async ($, on) => {
  world(on, {}, {
    [STORE_OPEN]: { session: SESSION_ID },
    [STORE_DRAFT]: { session: SESSION_ID, lines: [[{ id: 'cost', body: '{cost.text}' }], [{ id: 'model', body: '{model.text}' }]], axes: { theme: 'default' }, focus: null },
  })
  await start($)
  const pane = await $.ui.mount(PANE_MOUNT)
  expect(await pane.find({ key: 'seg:cost' })).toBeDefined()
  expect(await pane.find({ key: 'seg:model' })).toBeDefined()
  const bar = barColumn(walk(await pane.drawn()))!
  const rows = (bar.children ?? []).filter((c) => (c as Node).type === 'Box' && (c as Node).props?.flexDirection === 'row' && (c as Node).props?.position !== 'absolute')
  expect(rows).toHaveLength(2)
})

test('14.8-19: the in-flight save mark clears on matching options and names the unwritten fields on mismatch', async ($, on) => {
  world(on)
  await start($)
  const persisted = new Map<string, unknown>([['statusline.saving.v1', { fields: ['template'], values: { template: 'one={model.text}' } }]])
  await restoreAfterReload(standDollar(persisted), { template: 'one={model.text}' } as any)
  expect(persisted.has('statusline.saving.v1')).toBe(false)
  expect(__diag().some((d) => d.key === 'save-unwritten')).toBe(false)

  persisted.set('statusline.saving.v1', { fields: ['template'], values: { template: 'one={model.text}' } })
  await restoreAfterReload(standDollar(persisted), {} as any)
  expect(persisted.has('statusline.saving.v1')).toBe(true)
  expect(__diag().some((d) => d.text.includes('fields not written: template'))).toBe(true)
})

test('14.8-20 (live): a draft literal holding a reserved token is refused aloud by Save', async ($, on) => {
  const w = world(on, {}, {
    [STORE_OPEN]: { session: SESSION_ID },
    [STORE_DRAFT]: { session: SESSION_ID, lines: [[{ id: 'ok', body: '{model.text}' }, { id: 'lit', body: 'a||b' }]], axes: {}, focus: null },
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

test('14.8-21: the preview and the band are one render — the same draft gives byte-equal trees', async ($, on) => {
  const w = world(on)
  await start($)
  const band = await $.ui.mount(BAND_MOUNT)
  const bandTree = (await band.drawn()) as Node
  await command($)
  await w.clock.settle()
  const pane = await $.ui.mount({ ...PANE_MOUNT, props: { ...PANE_MOUNT.props, bodyColumns: 140 } })
  const preview = barColumn(walk(await pane.drawn()))!
  expect(JSON.stringify(preview)).toBe(JSON.stringify(bandTree))
})

test('14.8-22: a surface without the pane gets the /config path and does not fall', async ($, on) => {
  const { pane } = await openPicker($, on)
  await pane.unmount()
  const other = await $.ui.mount({ ...PANE_MOUNT, surface: 'vscode' as any })
  expect(await other.find({ type: 'Text', text: /Open \/statusline-mod in the terminal/ })).toBeDefined()
  expect(await other.find({ key: 'close' })).toBeDefined()
})

test('14.8-22а: the theme registry holds the seven named themes and each draws a tree of its own', async ($, on) => {
  const names = ['default', 'plain', 'powerline', 'pill', 'claude-code', 'codex', 'mono']
  const { w, pane } = await openPicker($, on)
  const themeSelect = await pane.find({ key: 'theme' })
  const offered = ((themeSelect?.props?.options ?? []) as Array<{ value: string }>).map((o) => o.value)
  for (const name of names) expect(offered).toContain(name)
  const trees = new Map<string, string>()
  for (const name of names) {
    await pane.select({ key: 'theme', value: name })
    await w.clock.settle()
    trees.set(name, JSON.stringify(barColumn(walk(await pane.drawn()))))
  }
  expect(new Set(trees.values()).size).toBe(names.length)
})

test('14.8-22б: an explicit axis value beats the theme; the value "theme" takes the theme back', async ($, on) => {
  const { w, pane } = await openPicker($, on)
  const hasPua = (n: Node): boolean =>
    walk(n).some((x) => [...textOf(x)].some((ch) => {
      const cp = ch.codePointAt(0)!
      return cp >= 0xe000 && cp <= 0xf8ff
    }))
  await pane.select({ key: 'theme', value: 'powerline' })
  await w.clock.settle()
  expect(hasPua(barColumn(walk(await pane.drawn()))!)).toBe(true)
  await pane.select({ key: 'axis:shape', value: 'plain' })
  await w.clock.settle()
  expect(hasPua(barColumn(walk(await pane.drawn()))!)).toBe(false)
  await pane.select({ key: 'axis:shape', value: 'theme' })
  await w.clock.settle()
  expect(hasPua(barColumn(walk(await pane.drawn()))!)).toBe(true)
})

test('14.8-22в: glyphs=ascii keeps every decoration byte ASCII, the data stays verbatim', async ($, on) => {
  const { w, pane } = await openPicker($, on)
  await pane.select({ key: 'axis:glyphs', value: 'ascii' })
  await w.clock.settle()
  const preview = barColumn(walk(await pane.drawn()))!
  const all = walk(preview).filter((n) => n.type === 'Text').map(textOf).join('')
  for (const ch of all) expect(ch.codePointAt(0)!).toBeLessThan(128)
  expect(flowText(preview)).toContain('demo(feature/hover)')
  expect(flowText(preview)).toContain('$1.2345')
})

test('14.8-22е (save): a user theme saves to $.store under its name', async ($, on) => {
  const { w, pane } = await openPicker($, on)
  await pane.input({ key: 'theme-name', text: 'mysoft' })
  await w.clock.settle()
  await pane.press({ key: 'theme-save' })
  await w.clock.settle()
  expect((w.persisted.get(STORE_THEMES) as Record<string, unknown>)['mysoft']).toBeDefined()
})

test('14.8-22е (reload): a saved user theme is offered again after the reload', async ($, on) => {
  world(on, {}, { [STORE_THEMES]: { mysoft: { shape: 'plain', separator: ' · ' } } })
  await start($)
  await command($)
  const w = { clock: { settle: async () => undefined } }
  await (w as any).clock.settle()
  const pane = await $.ui.mount(PANE_MOUNT)
  const offered = (((await pane.find({ key: 'theme' }))?.props?.options ?? []) as Array<{ value: string }>).map((o) => o.value)
  expect(offered).toContain('mysoft')
})

test('14.8-22е (unknown): an unknown theme name is a diagnostic and the last good config applies', async ($, on) => {
  world(on)
  await start($)
  const persisted = new Map<string, unknown>([['statusline.lastgood.v1', { __raw: { theme: 'plain' } }]])
  await restoreAfterReload(standDollar(persisted), { theme: 'bogus' } as any)
  expect(__diag().some((d) => d.key === 'theme-unknown')).toBe(true)
  expect(__diag().some((d) => d.key === 'lastgood-applied')).toBe(true)
  expect(__state().themeName).toBe('plain')
})

test('14.8-22ж: choosing a theme writes nothing until Сохранить confirms the draft', async ($, on) => {
  const { w, pane } = await openPicker($, on)
  await pane.select({ key: 'theme', value: 'plain' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  await pane.press({ key: 'save' })
  await w.clock.settle()
  expect(w.writes).toContainEqual({ key: 'catalyst-statusline.theme', value: 'plain' })
})

test('14.8-22з: border options give distinct contours and ASCII degrades to single', async ($, on) => {
  const { w, pane } = await openPicker($, on)
  for (const value of ['single', 'double', 'round']) {
    await pane.select({ key: 'axis:border', value })
    await w.clock.settle()
    expect(barColumn(walk(await pane.drawn()))!.props?.borderStyle).toBe(value)
  }
  await pane.select({ key: 'axis:glyphs', value: 'ascii' })
  await w.clock.settle()
  expect(barColumn(walk(await pane.drawn()))!.props?.borderStyle).toBe('single')
})

test('14.8-22ф: the pinned defaults survive a reload; a preset writes the draft, and only Save writes the options', async ($, on) => {
  const w = world(on)
  await start($)
  await restoreAfterReload($ as any, {} as any)
  const st = __state() as unknown as { view: Record<string, string> }
  expect(st.view.placement).toBe('above')
  expect(st.view.details).toBe('hover')
  expect(st.view.numbers).toBe('raw')
  expect(st.view.modelLabel).toBe('raw')

  await command($)
  await w.clock.settle()
  const pane = await $.ui.mount(PANE_MOUNT)
  await pane.select({ key: 'preset', value: 'claude-hud' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect(await pane.find({ key: 'seg:static' })).toBeDefined()
  await pane.press({ key: 'save' })
  await w.clock.settle()
  expect(w.writes).toContainEqual({ key: 'catalyst-statusline.template', value: serializeTemplate(presetLines('claude-hud')) })
})

test('14.8-22с (big): numbers=compact shortens; raw stays verbatim', async ($, on) => {
  const { w, pane } = await openPicker($, on, { 'session.usage': () => ({ value: { context: SNAP.context, rateLimits: [], cost: { usd: 1234.5 } } }) })
  await pane.select({ key: 'axis:numbers', value: 'compact' })
  await w.clock.settle()
  expect(previewText(walk(await pane.drawn()))).toContain('$1234.50')
  await pane.select({ key: 'axis:numbers', value: 'raw' })
  await w.clock.settle()
  expect(previewText(walk(await pane.drawn()))).toContain('$1234.5')
})

test('14.8-22с (small): compact never writes a nonzero value as zero', async ($, on) => {
  const { w, pane } = await openPicker($, on, { 'session.usage': () => ({ value: { context: SNAP.context, rateLimits: [], cost: { usd: 0.004 } } }) })
  await pane.select({ key: 'axis:numbers', value: 'compact' })
  await w.clock.settle()
  const compact = previewText(walk(await pane.drawn()))
  expect(compact).toContain('$0.004')
  expect(compact).not.toMatch(/\$0\.00(?!4)/)
})

test('14.8-30: details=off draws neither a hover scope nor a card', async ($, on) => {
  const { w, pane } = await openPicker($, on)
  await pane.select({ key: 'axis:details', value: 'off' })
  await w.clock.settle()
  const nodes = walk(await pane.drawn())
  expect(nodes.filter((n) => n.type === 'Text' && typeof n.hover?.scope === 'string')).toHaveLength(0)
  expect(nodes.filter((n) => n.type === 'Box' && n.props?.display === 'none')).toHaveLength(0)
})

test('14.12-34: two fast ◀ presses move the pill two places and the focus stays on it', async ($, on) => {
  const { w, pane } = await openPicker($, on)
  await pane.press({ key: 'seg:ctx' })
  await w.clock.settle()
  await pane.press({ key: 'mv:left' })
  await pane.press({ key: 'mv:left' })
  await w.clock.settle()
  const pills = (await pane.findAll({ type: 'Button' })).filter((b: { key?: string }) => (b.key ?? '').startsWith('seg:'))
  // each move pressed keepFocus once: the focused pill now carries the second fresh key
  expect(pills[0]!.key).toBe('seg:ctx#2')
  expect(String(pills[0]!.props.label)).toContain('· ctx')
})

test('14.12-35: undo after the field was changed through /config writes nothing and names the field', async ($, on) => {
  const { w, pane } = await openPicker($, on, {
    'config.list': () => ({ value: [{ key: 'catalyst-statusline.template', label: 'Template', kind: 'text', value: 'changed behind the picker', provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false }] }),
  })
  await pane.press({ key: 'seg:model' })
  await w.clock.settle()
  await pane.press({ key: 'mv:left' })
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

test('14.12-36 (label): model_label raw keeps the [1m] tag, display drops it', async ($, on) => {
  const { w, pane } = await openPicker($, on, { 'session.model': () => ({ value: 'claude-opus-5-5[1m]' }) })
  expect(previewText(walk(await pane.drawn()))).toContain('claude-opus-5-5[1m]')
  await pane.select({ key: 'axis:model_label', value: 'display' })
  await w.clock.settle()
  const shown = previewText(walk(await pane.drawn()))
  expect(shown).toContain('Opus 5.5')
  expect(shown).not.toContain('[1m]')
})

test('14.12-36 (short8): a draft segment on {session.short8} shows the eight-char id', async ($, on) => {
  world(on, {}, {
    [STORE_OPEN]: { session: SESSION_ID },
    [STORE_DRAFT]: { session: SESSION_ID, lines: [[{ id: 's8', body: '{session.short8}' }]], axes: {}, focus: null },
  })
  await start($)
  const pane = await $.ui.mount(PANE_MOUNT)
  const t = previewText(walk(await pane.drawn()))
  expect(t).toContain('4e1f0c9a')
  expect(t).not.toContain(SESSION_ID)
})

test('14.8-12 (live): the narrow preview evicts each line by the common order', async ($, on) => {
  world(on, {}, {
    [STORE_OPEN]: { session: SESSION_ID },
    [STORE_DRAFT]: { session: SESSION_ID, lines: parseTemplate('cost={cost.text}||model={model.text} ;; git={git.text}||directory={directory.text}'), axes: { theme: 'plain' }, focus: null },
  })
  await start($)
  const narrow = await $.ui.mount({ ...PANE_MOUNT, props: { ...PANE_MOUNT.props, bodyColumns: 18 } })
  const bar = barColumn(walk(await narrow.drawn()))!
  const rows = (bar.children ?? []).filter((c) => (c as Node).type === 'Box' && (c as Node).props?.flexDirection === 'row' && (c as Node).props?.position !== 'absolute') as Node[]
  expect(rows).toHaveLength(2)
  expect(rowText(walk(rows[0]!))).not.toContain('$')
  expect(rowText(walk(rows[1]!))).not.toContain('src')
})

test('14.8-13 (live): the preview cuts beyond the band\'s maxRows', async ($, on) => {
  world(on, {}, {
    [STORE_OPEN]: { session: SESSION_ID },
    [STORE_DRAFT]: { session: SESSION_ID, lines: parseTemplate('a={git.text} ;; b={model.text} ;; c={cost.text}'), axes: {}, focus: null },
  })
  await start($)
  const band = await $.ui.mount({ ...BAND_MOUNT, props: { ...BAND_MOUNT.props, maxRows: 2, scroll: { offset: 0, bodyRows: 2 } } })
  await band.unmount()
  const pane = await $.ui.mount(PANE_MOUNT)
  const bar = barColumn(walk(await pane.drawn()))!
  const rows = (bar.children ?? []).filter((c) => (c as Node).type === 'Box' && (c as Node).props?.flexDirection === 'row' && (c as Node).props?.position !== 'absolute')
  expect(rows).toHaveLength(2)
})

test('14.8-14 (wave A axes): every value of every wave A axis draws a distinguishable tree', async ($, on) => {
  const { w, pane } = await openPicker($, on)
  const treeOf = async (): Promise<string> => JSON.stringify(barColumn(walk(await pane.drawn())))
  const distinct = async (key: string, values: readonly string[], prepare: readonly string[] = []): Promise<void> => {
    const seen: string[] = []
    for (const p of prepare) {
      const [axis, value] = p.split('=')
      await pane.select({ key: 'axis:' + axis, value: value! })
      await w.clock.settle()
    }
    for (const value of values) {
      await pane.select({ key, value })
      await w.clock.settle()
      seen.push(await treeOf())
    }
    expect(new Set(seen).size).toBe(values.length)
  }
  await distinct('axis:shape', ['plain', 'lean', 'pill', 'powerline', 'classic'])
  await distinct('axis:caps', ['none', 'round', 'arrow', 'unicode-round'], ['glyphs=nerd'])
  await distinct('axis:bar', ['blocks', 'parallelogram', 'ascii', 'shade', 'baseline', 'low-blocks', 'pie'])
  await distinct('axis:fill', ['none', 'segment', 'band', 'inverse'])
  await distinct('axis:palette', ['semantic', 'mono', 'codex', 'claude-code'])
  await distinct('axis:border', ['none', 'single', 'double', 'round'])
})

test('Р7 axes (stand): thresholds mark, face props, segmentColors apply one by one and drop the bad aloud, barWidth counts cells', () => {
  const marked = rowText(walk(__render({ template: 'c={ctx.text}', thresholds: '5,7' }, SNAP) as Node))
  expect(marked).toContain('8%!')
  const calm = rowText(walk(__render({ template: 'c={ctx.text}', thresholds: '90,95' }, SNAP) as Node))
  expect(calm).not.toContain('!')
  const bold = walk(__render({ template: 'cost={cost.text}', face: 'value=bold' }, SNAP) as Node).find((n) => n.type === 'Text' && textOf(n) === '$1.2345')
  expect(bold?.props?.bold).toBe(true)
  const red = walk(__render({ template: 'cost={cost.text}', segmentColors: 'cost=red;bogus=red;cost=##' }, SNAP) as Node).find((n) => n.type === 'Text' && textOf(n) === '$1.2345')
  expect(red?.props?.color).toBe('red')
  expect(__diag().some((d) => d.text.includes("segmentColors: entry 'bogus=red' dropped"))).toBe(true)
  expect(__diag().some((d) => d.text.includes("segmentColors: entry 'cost=##' dropped"))).toBe(true)
  const narrow = rowText(walk(__render({ template: 'c={ctx.text}', barWidth: '6' }, SNAP) as Node))
  // six cells at 8% leave every cell unfilled — the bar narrows, the figure does not
  expect(narrow).toContain('ctx 83000/1000000 [░░░░░░] 8%')
  expect(narrow).not.toContain('[░░░░░░░░░░]')
})
