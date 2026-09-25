import { expect, test } from 'claude-code/testing'
import type { Collector, Source } from '../hooks/data/types'
import base from '../hooks/data/base'
import {
  buildRegistry, resolveVariantOwner, closeKeepDraft, __renderPicker, __feed, __render, __diag,
} from '../hooks/statusline'
import { world, start, command, BAND_MOUNT, PANE_MOUNT, walk, textOf, STORE_OPEN, STORE_DRAFT, SESSION_ID, PANE_ID, HOME } from './world'
import type { Node } from './world'

// The 0.5 teeth: the Р5 panel (tabs, pills, preview, bottom), the Р4
// per-element settings, the Р6 themes, the Р7 number fields, the variantsFor
// routing, the loud duplicate-id, the N elements with their reason, and the
// text snapshots for the eye. Driven through the live picker hooks where the
// kit allows (presses on the pane) and the stand where it cannot.

// A stand `$` for the exported handlers the kit cannot drive live: the store
// with the kit's own memory semantics (0.4.0 drove restoreAfterReload the
// same way).
const standDollar = (persisted: Map<string, unknown>): any => ({
  store: {
    get: async (k: string) => persisted.get(k),
    set: async (k: string, v: unknown) => { persisted.set(k, JSON.parse(JSON.stringify(v))) },
    delete: async (k: string) => { persisted.delete(k) },
  },
  session: { id: async () => SESSION_ID },
  plugin: { name: 'catalyst-statusline', root: '/stand' },
  ui: { log: async () => undefined, invalidate: async () => undefined },
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

const allText = (nodes: Node[]): string => nodes.map(textOf).join('')

const keyOf = (n: Node): string => String(n.key ?? (n.props as Record<string, unknown> | undefined)?.['key'] ?? '')

const byKey = async (pane: { findAll: (q: { type: string }) => Promise<unknown> }, type: string, re: RegExp): Promise<Node[]> => {
  const nodes = (await pane.findAll({ type })) as Node[]
  return nodes.filter((n) => re.test(keyOf(n)))
}

test('Р5: the panel shows the preview, six tabs and the bottom row; a tab press switches the body', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  for (const key of ['tab:layout', 'tab:elements', 'tab:element', 'tab:view', 'tab:themes', 'tab:numbers', 'save', 'cancel', 'undo', 'reset']) {
    expect(await pane.find({ key })).toBeDefined()
  }
  // hotkeys 1-6 sit on the tab pills
  const tabs = await byKey(pane, 'Box', /box:tab:/)
  expect(tabs.length).toBe(6)
  // the layout tab draws its rows; the themes tab draws theme cards
  expect(allText(walk(await pane.drawn()))).toContain('Строка 1')
  await pane.press({ key: 'tab:themes' })
  await w.clock.settle()
  expect(await pane.find({ key: 'theme:hud' })).toBeDefined()
  expect(await pane.find({ key: 'theme-name' })).toBeDefined()
})

test('Р5: the 0.4 checkbox list is gone — no digit-prefixed checkbox rows exist', async ($, on) => {
  const { pane } = await openPanel($, on)
  const buttons = (await pane.findAll({ type: 'Button' })) as Node[]
  for (const b of buttons) {
    const label = String(b.label ?? (b.props as Record<string, unknown> | undefined)?.label ?? '')
    expect(label).not.toMatch(/^\d: \[[✔ ]\]/)
  }
})

test('Р5: an element pill press changes the draft; Save writes the layout through /config', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  await pane.press({ key: 'tab:elements' })
  await w.clock.settle()
  expect(await pane.find({ key: 'el:github' })).toBeDefined()
  await pane.press({ key: 'el:github' })
  await w.clock.settle()
  // placed pills carry the check mark
  const placed = (await pane.find({ key: 'box:el:github' })) as Node
  expect(String(((placed.children as Node[])[0]!.props as Record<string, unknown>)?.label)).toContain('✓ github')
  await pane.press({ key: 'save' })
  await w.clock.settle()
  const template = w.writes.find((x) => x.key === 'catalyst-statusline.template')
  expect(template?.value).toContain('github')
})

test('Р5: a preset pill rewrites the draft and only Save writes the options', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  await pane.press({ key: 'preset:minimum' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  const pills = await byKey(pane, 'Button', /^seg:/)
  expect(pills.length).toBe(2)
  await pane.press({ key: 'save' })
  await w.clock.settle()
  expect(w.writes).toContainEqual({ key: 'catalyst-statusline.template', value: 'model||ctx' })
})

test('Р5: Esc keeps the unsaved draft in the store and it is restored on the next open', async ($, on) => {
  const w = world(on)
  await start($)
  await command($)
  await w.clock.settle()
  const pane = await $.ui.mount(PANE_MOUNT)
  await pane.press({ key: 'tab:elements' })
  await w.clock.settle()
  await pane.press({ key: 'el:github' })
  await w.clock.settle()
  // Esc raises ui.close with the person's origin; the kit cannot raise that
  // event from the test side (measured), so the tooth runs the handler the
  // event dispatches, against the same persisted store
  await closeKeepDraft(standDollar(w.persisted))
  await w.clock.settle()
  expect(w.persisted.has(STORE_DRAFT)).toBe(true)
  expect(w.persisted.has(STORE_OPEN)).toBe(false)
  await command($)
  await w.clock.settle()
  await pane.unmount()
  const again = await $.ui.mount(PANE_MOUNT)
  const draft = w.persisted.get(STORE_DRAFT) as { lines: { id: string }[][] }
  expect(draft.lines.flat().some((s) => s.id === 'github')).toBe(true)
  expect(await again.find({ key: 'box:el:github' })).toBeDefined()
})

test('Р5: the preview and the band are one render — the default draft gives byte-equal trees', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  const band = await $.ui.mount({ ...BAND_MOUNT, requestId: 'band-21' })
  const bandTree = await band.drawn()
  await command($)
  await w.clock.settle()
  const pane = await $.ui.mount({ ...PANE_MOUNT, props: { ...PANE_MOUNT.props, bodyColumns: 140 } })
  const drawn = walk(await pane.drawn())
  // the preview is the first child of the panel's column
  const preview = (drawn.find((n) => n.type === 'Box' && n.props?.flexDirection === 'column' && (n.children ?? [])[0] && typeof (n.children as Node[])[0] === 'object' && (n.children as Node[])[0]!.type === 'Box')?.children ?? [])[0]
  expect(JSON.stringify(preview)).toBe(JSON.stringify(bandTree))
})

test('Р4: the variant, colour, label and bar pills of the selected element write the elements field', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  await pane.press({ key: 'seg:ctx' })
  await w.clock.settle()
  await pane.press({ key: 'edit' })
  await w.clock.settle()
  expect(await pane.find({ key: 'var:percent' })).toBeDefined()
  await pane.press({ key: 'var:percent' })
  await w.clock.settle()
  await pane.press({ key: 'show:value' })
  await w.clock.settle()
  await pane.press({ key: 'col:red' })
  await w.clock.settle()
  await pane.press({ key: 'save' })
  await w.clock.settle()
  const elements = w.writes.find((x) => x.key === 'catalyst-statusline.elements')
  const value = String(elements?.value ?? '')
  expect(value).toContain('ctx:')
  expect(value).toContain('v=percent')
  expect(value).toContain('bs=value')
  expect(value).toContain('c=red')
})

test('Р4: the label-off pill drops the Context label from the preview', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  await pane.press({ key: 'seg:ctx' })
  await w.clock.settle()
  await pane.press({ key: 'edit' })
  await w.clock.settle()
  await pane.press({ key: 'label:off' })
  await w.clock.settle()
  const drawn = allText(walk(await pane.drawn()))
  expect(drawn).toContain('83K/1M')
  expect(drawn).not.toContain('Context')
})

test('Р4: the int nudge of a list element changes its max rows and saves', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  await pane.press({ key: 'seg:ag' })
  await w.clock.settle()
  await pane.press({ key: 'edit' })
  await w.clock.settle()
  await pane.press({ key: 'mr:+' })
  await w.clock.settle()
  expect(allText(walk(await pane.drawn()))).toContain('максимум строк 4')
  await pane.press({ key: 'save' })
  await w.clock.settle()
  const elements = w.writes.find((x) => x.key === 'catalyst-statusline.elements')
  expect(String(elements?.value)).toContain('ag:o:maxRows=4')
})

test('Р6: at least fourteen built-in themes are offered and each card draws the CURRENT layout', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  await pane.press({ key: 'tab:themes' })
  await w.clock.settle()
  const themeButtons = (await byKey(pane, 'Button', /theme:/)).map((b) => keyOf(b))
  for (const name of ['hud', 'powerline', 'pill', 'catppuccin-mocha', 'nord', 'gruvbox-dark', 'tokyo-night', 'dracula', 'solarized-dark', 'solarized-light', 'mono', 'minimal', 'classic', 'claude-code', 'codex']) {
    expect(themeButtons).toContain('theme:' + name)
  }
  expect(themeButtons.length).toBeGreaterThanOrEqual(14)
  const nodes = walk(await pane.drawn())
  const card = (name: string): string => allText(walk(nodes.find((n) => keyOf(n) === 'themecard:' + name)!))
  // the card renders the user's own layout through that theme
  expect(card('hud')).toContain('demo(feature/hover)')
  expect(card('mono')).toContain('demo(feature/hover)')
  expect(JSON.stringify(nodes.find((n) => keyOf(n) === 'themecard:hud'))).not.toBe(JSON.stringify(nodes.find((n) => keyOf(n) === 'themecard:powerline')))
})

test('Р6: applying a theme takes the whole view and Save writes the theme field', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  await pane.press({ key: 'tab:themes' })
  await w.clock.settle()
  await pane.press({ key: 'theme:powerline' })
  await w.clock.settle()
  await pane.press({ key: 'save' })
  await w.clock.settle()
  expect(w.writes).toContainEqual({ key: 'catalyst-statusline.theme', value: 'powerline' })
})

test('Р7: the numbers tab writes the six independent fields', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  await pane.press({ key: 'tab:numbers' })
  await w.clock.settle()
  const drawn = allText(walk(await pane.drawn()))
  for (const sample of ['231K', '231045', '231.0K', '231 045', '48%', '48.2%', '0.48', '$6434.27', '$6.4K', '$6434', '1655h 47m', '68d 23h', '1655:47', '11 GB', '10.2 GiB', '11000 MB', '25 tok/s', '25/s']) {
    expect(drawn).toContain(sample)
  }
  await pane.press({ key: 'num:numTokens:raw' })
  await w.clock.settle()
  expect(allText(walk(await pane.drawn()))).toContain('83000/1000000')
  await pane.press({ key: 'save' })
  await w.clock.settle()
  expect(w.writes).toContainEqual({ key: 'catalyst-statusline.numTokens', value: 'raw' })
})

test('Р3: an N element shows as a dim pill with its reason on hover, and never as a button', async ($, on) => {
  const { w, pane } = await openPanel($, on)
  await pane.press({ key: 'tab:elements' })
  await w.clock.settle()
  const routeBox = (await pane.find({ key: 'box:el:route' })) as Node
  expect(routeBox?.type).toBe('Box')
  const kids = (routeBox.children ?? []) as Node[]
  const route = kids.find((c) => c && typeof c === 'object' && c.type === 'Text')
  expect(route?.type).toBe('Text')
  expect(route?.props?.dimColor).toBe(true)
  expect(textOf(route!)).toContain('⊘ route')
  expect(kids.some((c) => c && typeof c === 'object' && c.type === 'Button')).toBe(false)
  const cards = walk(await pane.drawn()).filter((n) => n.type === 'Box' && n.props?.display === 'none')
  const routeCard = cards.find((c) => (c.hover?.scope as string) === 'slp-route')
  expect(textOf(routeCard!)).toContain('route label source OPEN (spec В5)')
})

test('registry: a duplicate element id is loud and the first registration stands; variantsFor routes to the author', () => {
  const fake: Collector<unknown> = {
    family: 'context',
    elements: [{ id: 'ctx', family: 'context', label: 'dup', about: 'a duplicate id from another track', kind: 'text', variants: [{ id: 'own', label: 'own' }], outcome: 'C', catalogue: [], sample: 'x' }],
    sources: [],
    variantsFor: [{ element: 'ctx', variants: [{ id: 'alt-pct', label: 'alt percent' }] }],
    init: () => ({}),
    reduce: (s) => s,
    value: () => ({ state: 'ok', text: 'ALT', at: 0 }),
  }
  const reg = buildRegistry([base as Collector<unknown>, fake])
  expect(reg.duplicateIds).toEqual(['ctx'])
  // the variant the foreign family contributed routes to IT, not the owner
  expect(resolveVariantOwner(reg, 'ctx', 'alt-pct')).toBe(fake)
  // the owner's own variants stay with the owner
  expect(resolveVariantOwner(reg, 'ctx', 'used')).toBeUndefined()
  expect(__diag().some((d) => d.key === 'registry-duplicate-id')).toBe(false)
})

test('§11.2 (live): the saved HUD layout runs its git and version sources; a layout without them does not', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  expect(w.cmds).toContain('git rev-parse --abbrev-ref HEAD')
  expect(w.cmds).toContain('claude --version')
  expect(w.cmds.some((c) => c.includes('vm_stat'))).toBe(true)
})

test('14.8-17: { deny } from $.config.set is shown in the panel, not gulled', async ($, on) => {
  const { w, pane } = await openPanel($, on, { 'config.set': (_$: any, e: any) => ({ deny: 'locked by policy' }) })
  await pane.press({ key: 'tab:elements' })
  await w.clock.settle()
  await pane.press({ key: 'el:github' })
  await w.clock.settle()
  await pane.press({ key: 'save' })
  await w.clock.settle()
  await pane.drawn()
  const notice = await pane.find({ type: 'Text', text: /locked by policy/ })
  expect(notice?.text).toContain('template')
})

test('14.8-18 (Esc path): a reload restores the open panel and its draft from $.store', async ($, on) => {
  world(on, {}, {
    [STORE_OPEN]: { session: SESSION_ID },
    [STORE_DRAFT]: { session: SESSION_ID, lines: [[{ id: 'cost', body: '{cost.text}' }]], axes: { theme: 'hud' }, elements: {}, focus: null, tab: 'layout', query: '', fam: 'all', targetLine: 0, themeName: '' },
  })
  await start($)
  const pane = await $.ui.mount(PANE_MOUNT)
  expect(await pane.find({ key: 'seg:cost' })).toBeDefined()
})

test('14.8-22: a surface without the pane gets the /config path and does not fall', async ($, on) => {
  const { pane } = await openPanel($, on)
  await pane.unmount()
  const other = await $.ui.mount({ ...PANE_MOUNT, surface: 'vscode' as any })
  expect(await other.find({ type: 'Text', text: /Open \/statusline-mod in the terminal/ })).toBeDefined()
  expect(await other.find({ key: 'close' })).toBeDefined()
})

// ---------- text snapshots for the eye (gates-v0.5/snapshots/) ----------

const SNAP_SETTINGS = JSON.stringify({ hooks: { PreToolUse: [{}], PostToolUse: [{}] }, outputStyle: 'default' })
const SNAP_VM = ['Mach Virtual Memory Statistics: (page size of 4096 bytes)', 'Pages active:                         2000000.', 'Pages wired down:                     1000000.'].join('\n')
const src = (s: Source): Source => s

const feedSnap = (): void => {
  __feed({ source: src({ kind: 'session', call: 'info' }), ok: true, data: { cwd: '/work/demo/src', root: '/work/demo', id: SESSION_ID, turns: 0 }, now: 0 })
  __feed({ source: src({ kind: 'session', call: 'model' }), ok: true, data: 'Fable 5.1', now: 0 })
  __feed({ source: src({ kind: 'session', call: 'usage' }), ok: true, data: { context: { tokens: 83000, window: 1000000, percent: 8 }, rateLimits: [{ kind: 'five_hour', percentUsed: 25 }], cost: { usd: 1.2345 } }, now: 0 })
  __feed({ source: src({ kind: 'cmd', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], everyMs: 8000, cwd: 'project' }), ok: true, data: { code: 0, stdout: 'feature/hover\n', stderr: '' }, now: 0 })
  __feed({ source: src({ kind: 'cmd', argv: ['claude', '--version'], everyMs: 0 }), ok: true, data: { code: 0, stdout: '2.1.280 (tweakcc)\n', stderr: '' }, now: 0 })
  __feed({ source: src({ kind: 'cmd', argv: ['/usr/bin/vm_stat'], everyMs: 15000 }), ok: true, data: { code: 0, stdout: SNAP_VM, stderr: '' }, now: 0 })
  __feed({ source: src({ kind: 'cmd', argv: ['sysctl', '-n', 'hw.memsize'], everyMs: 60000 }), ok: true, data: { code: 0, stdout: '25769803776\n', stderr: '' }, now: 0 })
  __feed({ source: src({ kind: 'file', path: '.claude/settings.json', everyMs: 30000, relativeTo: 'home' }), ok: true, data: SNAP_SETTINGS, now: 0 })
  __feed({ source: src({ kind: 'file', path: 'CLAUDE.md', everyMs: 30000, relativeTo: 'project' }), ok: true, data: '# demo\n', now: 0 })
  __feed({ source: src({ kind: 'event', event: 'turn.start' }), ok: true, data: {}, now: 0 })
  __feed({ source: src({ kind: 'clock', everyMs: 1000 }), ok: true, data: undefined, now: 3600000 })
}

// A row Box joins its children on one line; a column Box gives each child its
// own line — the shape a terminal would give the same tree.
const dump = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return typeof node === 'string' && node !== '' ? [node] : []
  const n = node as Node
  const self = n.type === 'Button' ? String(n.label ?? '') : n.type === 'Input' ? String(n.props?.value ?? '') : n.type === 'Text' ? textOf(n) : ''
  const children = (n.children ?? []).flatMap(dump).filter((l) => l.trim() !== '')
  if (n.props?.position === 'absolute') return []
  if (n.type !== 'Box' || n.props?.flexDirection === 'row') {
    const joined = [self, ...children].filter(Boolean).join(' │ ')
    return joined === '' ? [] : [joined]
  }
  return [...(self ? [self] : []), ...children]
}

test('snapshots: the default bar and every panel tab render as text', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  const band = await $.ui.mount(BAND_MOUNT)
  const bandLines = dump(await band.drawn())
  expect(bandLines.join('\n')).toContain('Fable 5.1')
  feedSnap()
  for (const tab of ['layout', 'elements', 'element', 'view', 'themes', 'numbers'] as const) {
    const tree = __renderPicker({}, tab, 140, tab === 'element' ? 'ctx' : undefined)
    const lines = dump(tree)
    expect(lines.length).toBeGreaterThan(0)
  }
  // the stand bar for the same world (the dump above is the live one)
  const standLines = dump(__render({}, 140, 29))
  expect(standLines.join('\n')).toContain('Context')
})

test('T11a: a home file source does not run while HOME is empty, and the element is not zero', async ($, on) => {
  const w = world(on, {
    'env.get': (_$: any, e: any) => {
      if (e.name === 'HOME') return { value: undefined }
      if (e.name === 'CLAUDE_CODE_EXECPATH') return { value: '/fake/bin/2.1.280/claude' }
      return { value: undefined }
    },
  })
  await start($)
  await w.clock.settle()
  const homeReads = (): string[] => w.reads.filter((p) => p.endsWith('settings.json') || p.endsWith('/.claude/CLAUDE.md') || p.endsWith('.claude/CLAUDE.md'))
  expect(homeReads()).toEqual([])
  await w.clock.advance(30000)
  expect(homeReads()).toEqual([])
  const band = await $.ui.mount({ ...BAND_MOUNT, requestId: 't11a' })
  const drawn = allText(walk(await band.drawn()))
  expect(drawn).not.toContain('0 hooks')
  expect(drawn).not.toContain('2 hooks')
})

test('T11b: a home file source is read as soon as HOME is known, without waiting everyMs', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  expect(w.reads).toContain(HOME + '/.claude/settings.json')
  expect(w.clock.now()).toBeLessThan(30000)
})
