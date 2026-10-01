import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { world, start, command, PANE_MOUNT, BAND_MOUNT, BAND, walk, textOf, STORE_DRAFT, STORE_OPEN, SESSION_ID, SURFACES, isOpen, undoStack, draftOf as draftIn, NS_DRAFT } from './world'
import type { Node, World } from './world'

// #521 FIX1 teeth. CONSTRAINT (ANALYSIS-521-swe2 traps 1-2): the pane is drawn
// by the kit's own plugin instance — after presses the state is read only
// through the drawn tree and the world's records (store, config writes,
// closes), never through the imported module; a Text node keeps no key, so a
// notice is found by its text.

type Pane = {
  drawn: () => Promise<unknown>
  find: (q: Record<string, unknown>) => Promise<unknown>
  findAll: (q: Record<string, unknown>) => Promise<unknown>
  press: (t: { key: string }) => Promise<unknown>
  input: (t: { key: string; text: string }) => Promise<unknown>
  select: (t: { key: string; value: string }) => Promise<unknown>
}
type Ctx = { $: any; w: World; pane: Pane }

const keyOf = (n: Node): string => String(n.key ?? (n.props as Record<string, unknown> | undefined)?.['key'] ?? '')
const propOf = (n: Node, name: string): unknown => (n as Record<string, unknown>)[name] ?? (n.props as Record<string, unknown> | undefined)?.[name]
const drain = async (): Promise<void> => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const settle = async (w: World): Promise<void> => { await w.clock.settle(); await drain() }
// #521 FIX2 Р13: the draft lives under its session's key
// the newest draft of the session, every form (#551 §3.7)
const draftOf = (w: World): any => draftIn(w.persisted, SESSION_ID)
const nodesOf = async (pane: Pane): Promise<Node[]> => walk((await pane.drawn()) as Node)
const textsOf = (nodes: Node[]): string[] => nodes.filter((n) => n.type === 'Text').map(textOf)
const buttonKeys = (nodes: Node[]): string[] => nodes.filter((n) => n.type === 'Button').map(keyOf)
const lineIds = (d: any): string[][] => (d?.lines ?? []).map((l: { id: string }[]) => l.map((s) => s.id))

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

// a stored draft the restore opens with (the S2 #26 shape)
const storedDraft = (lines: string[][], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  [STORE_OPEN]: { session: SESSION_ID },
  [STORE_DRAFT]: { session: SESSION_ID, lines: lines.map((l) => l.map((id) => ({ id, body: '{' + id + '.text}' }))), axes: {}, elements: {}, focus: null, tab: 'layout', query: '', fam: 'model', page: 0, targetLine: 0, themeName: '', ...extra },
})

// ---------- tooth 1 (Р1): the press census ----------

const START_FOCUS = JSON.stringify({ line: 0, seg: 0 })
const contentOf = (d: any): string => JSON.stringify({ lines: d?.lines, axes: d?.axes, elements: d?.elements })

// what a press may visibly change: the draft, the open flag, a close, a text
// that was not drawn before it (the notice among them)
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

// the focused pill's key carries the move counter: a key drawn earlier is found again by its stem
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
  // a tab change of its own clears the last notice before the measured press
  await press(c, target === 'layout' ? 'tab:view' : 'tab:layout')
  await press(c, 'tab:' + target)
}

const toStart = async (c: Ctx, target: string, start: string): Promise<boolean> => {
  if (!isOpen(c.w.persisted, SESSION_ID)) {
    await command(c.$)
    await settle(c.w)
  }
  if (contentOf(draftOf(c.w)) !== start) {
    if (await c.pane.find({ key: 'discard' })) await press(c, 'discard')
    await press(c, 'tab:numbers')
    await press(c, 'num:numTokens:raw')
  }
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
  return contentOf(d) === start && JSON.stringify(d.focus) === START_FOCUS && d.tab === target && isOpen(c.w.persisted, SESSION_ID)
}

const census = async (c: Ctx, target: string): Promise<{ dead: string[]; unreachedStart: string[]; pressed: number }> => {
  // the start: the picker open on HUD, the first pill of line 1 focused, one edit unsaved
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  await press(c, 'tab:layout')
  await press(c, 'seg:model')
  const start = contentOf(draftOf(c.w))
  await enter(c, target)
  const keys = buttonKeys(await nodesOf(c.pane))
  const dead: string[] = []
  const unreachedStart: string[] = []
  let pressed = 0
  for (const key of keys) {
    if (!(await toStart(c, target, start))) unreachedStart.push(key)
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
  return { dead, unreachedStart, pressed }
}

for (const target of ['layout', 'elements', 'element', 'view', 'themes', 'numbers']) {
  test('#521 tooth 1 (Р1): every button of «' + target + '» has a visible result from the start state', { timeoutMs: 120000 }, async ($, on) => {
    const c = await openPanel($, on)
    const r = await census(c, target)
    expect(r.pressed).toBeGreaterThan(0)
    expect({ dead: r.dead, unreachedStart: r.unreachedStart }).toEqual({ dead: [], unreachedStart: [] })
  })
}

// ---------- tooth 2 (Р2): ✕ removes the focused pill ----------

test('#521 tooth 2 (Р2): ✕ takes the focused pill out of its line, the focus goes to the neighbour, Save writes the line without it', async ($, on) => {
  const c = await openPanel($, on)
  await press(c, 'seg:ver')
  expect(JSON.stringify(draftOf(c.w).focus)).toBe(JSON.stringify({ line: 0, seg: 2 }))
  await press(c, 'mv:out')
  expect(lineIds(draftOf(c.w))[0]).toEqual(['model', 'git-branch', 'dur', 'cost'])
  expect(JSON.stringify(draftOf(c.w).focus)).toBe(JSON.stringify({ line: 0, seg: 2 }))
  expect(textsOf(await nodesOf(c.pane)).some((t) => t.includes('ver убран из строки 1'))).toBe(true)
  // the last pill of a line: the focus falls back to the left neighbour
  await press(c, 'seg:cost')
  await press(c, 'mv:out')
  expect(lineIds(draftOf(c.w))[0]).toEqual(['model', 'git-branch', 'dur'])
  expect(JSON.stringify(draftOf(c.w).focus)).toBe(JSON.stringify({ line: 0, seg: 2 }))
  await press(c, 'save')
  const template = String(c.w.writes.find((x) => x.key === 'catalyst-statusline.template')?.value ?? '')
  const first = template.split(' ;; ')[0] ?? ''
  expect(first).toBe('model||git-branch||dur')
})

// ---------- tooth 3 (Р3): line delete ----------

test('#521 tooth 3 (Р3): ✕ строка deletes a line with elements and names them; the only line has no button and says why', async ($, on) => {
  const c = await openPanel($, on)
  const n0 = lineIds(draftOf(c.w)).length
  await press(c, 'line:0:del')
  const lines = lineIds(draftOf(c.w))
  expect(lines.length).toBe(n0 - 1)
  expect(lines.flat()).not.toContain('model')
  expect(textsOf(await nodesOf(c.pane)).some((t) => t.includes('строка 1 удалена; в доступные: model, git-branch, ver, dur, cost'))).toBe(true)
  await press(c, 'preset:minimum')
  const nodes = await nodesOf(c.pane)
  expect(lineIds(draftOf(c.w)).length).toBe(1)
  expect(buttonKeys(nodes)).not.toContain('line:0:del')
  expect(textsOf(nodes).some((t) => t.includes('последнюю строку удалить нельзя'))).toBe(true)
})

// ---------- tooth 4 (Р4): + строка ----------

test('#521 tooth 4 (Р4): before the band is measured + строка adds a ninth line; at the measured limit it says so and adds nothing', async ($, on) => {
  const c = await openPanel($, on)
  expect(lineIds(draftOf(c.w)).length).toBe(8)
  await press(c, 'line:add')
  expect(lineIds(draftOf(c.w)).length).toBe(9)
  await press(c, 'line:8:del')
  expect(lineIds(draftOf(c.w)).length).toBe(8)
  const band = await c.$.ui.mount({ ...BAND_MOUNT, props: { ...BAND, maxRows: 8 }, requestId: 'band-521' })
  await settle(c.w)
  await press(c, 'line:add')
  expect(lineIds(draftOf(c.w)).length).toBe(8)
  expect(textsOf(await nodesOf(c.pane)).some((t) => t.includes('полоса вмещает 8 строк'))).toBe(true)
  await band.unmount()
})

// ---------- tooth 5 (Р5): the target line and el:* ----------

test('#521 tooth 5 (Р5): the target line is drawn, a placed pill names its line, a placed element leaves every line it stands in', async ($, on) => {
  const c = await openPanel($, on, {}, storedDraft([['model', 'ctx'], ['ver'], ['model']]))
  await press(c, 'line:1:add')
  let nodes = await nodesOf(c.pane)
  expect(textsOf(nodes).some((t) => t.includes('Добавляется в строку 2'))).toBe(true)
  const placed = nodes.find((n) => n.type === 'Button' && keyOf(n) === 'el:model')
  expect(textOf(placed!)).toContain('✓ model · стр.1, 3')
  await press(c, 'target:next')
  nodes = await nodesOf(c.pane)
  expect(textsOf(nodes).some((t) => t.includes('Добавляется в строку 3'))).toBe(true)
  await press(c, 'el:model')
  expect(lineIds(draftOf(c.w))).toEqual([['ctx'], ['ver'], []])
  expect(textsOf(await nodesOf(c.pane)).some((t) => t.includes('model убран из строк 1, 3'))).toBe(true)
  // an unplaced element goes to the end of the target line
  await press(c, 'el:model')
  expect(lineIds(draftOf(c.w))).toEqual([['ctx'], ['ver'], ['model']])
  expect(textsOf(await nodesOf(c.pane)).some((t) => t.includes('model → строка 3'))).toBe(true)
})

test('#521 tooth 5 (Р5): el:* on an empty layout makes line 1', async ($, on) => {
  const c = await openPanel($, on, {}, storedDraft([]))
  await press(c, 'tab:elements')
  await press(c, 'el:model')
  expect(lineIds(draftOf(c.w))).toEqual([['model']])
  expect(textsOf(await nodesOf(c.pane)).some((t) => t.includes('model → строка 1'))).toBe(true)
})

// ---------- tooth 6 (Р6): five actions, five names ----------

test('#521 tooth 6 (Р6): undo-step at level 2 takes back the last draft edit only; back returns to the source tab', async ($, on) => {
  const c = await openPanel($, on)
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  await press(c, 'tab:layout')
  await press(c, 'seg:ctx')
  await press(c, 'edit')
  await press(c, 'var:percent')
  expect(draftOf(c.w).elements?.ctx?.v).toBe('percent')
  await press(c, 'undo-step')
  const d = draftOf(c.w)
  expect(d.elements?.ctx?.v).toBeUndefined()
  expect(d.axes.numTokens).toBe('raw')
  expect(d.tab).toBe('element')
  await press(c, 'back')
  expect(draftOf(c.w).tab).toBe('layout')
  expect(draftOf(c.w).axes.numTokens).toBe('raw')
  // from «Элементы»: the element tab's back returns there
  await press(c, 'tab:elements')
  await press(c, 'tab:element')
  await press(c, 'back')
  expect(draftOf(c.w).tab).toBe('elements')
  expect(draftOf(c.w).axes.numTokens).toBe('raw')
})

test('#521 tooth 6 (Р6): discard returns the draft to the saved state and keeps the panel; close keeps the draft; a reopen says so', async ($, on) => {
  const c = await openPanel($, on)
  const saved = contentOf(draftOf(c.w))
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  await press(c, 'num:numUsd:short')
  await press(c, 'discard')
  expect(contentOf(draftOf(c.w))).toBe(saved)
  expect(c.w.closed).toHaveLength(0)
  expect(isOpen(c.w.persisted, SESSION_ID)).toBe(true)
  // #521 FIX2 Р26/Р25: the discard notice names the step back; the counter counts fields
  expect(textsOf(await nodesOf(c.pane)).some((t) => t.includes('правки отброшены — «↶ Шаг назад» вернёт их'))).toBe(true)
  await press(c, 'num:numTokens:raw')
  await press(c, 'close')
  expect(c.w.closed).toHaveLength(1)
  expect(isOpen(c.w.persisted, SESSION_ID)).toBe(false)
  expect(draftOf(c.w).axes.numTokens).toBe('raw')
  await command($)
  await settle(c.w)
  expect(textsOf(await nodesOf(c.pane)).some((t) => t.includes('продолжен несохранённый черновик (изменено полей: 1)'))).toBe(true)
})

test('#521 tooth 6 (Р6): the draft undo stack survives restoreAfterReload', async () => {
  SL.__resetState()
  try {
    const persisted = new Map<string, unknown>()
    const one = [[{ id: 'model', body: '{model.text}' }]]
    // #551 D5: a flag restores only with an age inside FLAG_TTL (no clock on this stand: the process clock)
    persisted.set(STORE_OPEN, { session: 'A', at: Date.now() })
    persisted.set(STORE_DRAFT, { session: 'A', lines: [...one, [{ id: 'ctx', body: '{ctx.text}' }]], axes: {}, elements: {}, focus: null, tab: 'layout', query: '', fam: 'model', page: 0, targetLine: 0, themeName: '', undo: [{ lines: one, axes: {}, elements: {} }] })
    const $ = {
      store: {
        get: async (k: string) => persisted.get(k),
        set: async (k: string, v: unknown) => { persisted.set(k, JSON.parse(JSON.stringify(v))) },
        delete: async (k: string) => { persisted.delete(k) },
        keys: async () => [...persisted.keys()],
      },
      session: { id: async () => 'A' },
      plugin: { name: 'catalyst-statusline', root: '/stand' },
      ui: { log: async () => undefined, invalidate: () => undefined },
    }
    await SL.restoreAfterReload($ as never, {} as never)
    const nodes = walk(SL.__renderPicker({}, 'layout', 120, undefined, $.store, $) as Node)
    const node = nodes.find((n) => n.type === 'Button' && keyOf(n) === 'undo-step')
    expect(node).toBeDefined()
    ;(node!.props!['onPress'] as () => void)()
    for (let i = 0; i < 6; i++) await drain()
    // #551 D8: the old single slot is read only — it stays; the step went out as this version's draft of A
    expect(persisted.has(STORE_DRAFT)).toBe(true)
    expect(lineIds(draftIn(persisted, 'A'))).toEqual([['model']])
  } finally {
    SL.__resetState()
  }
})

// ---------- tooth 7 (Р7): the state line and the key hint ----------

for (const surface of SURFACES) {
  for (const isFullscreen of [true, false]) {
    test('#521 tooth 7 (Р7): ' + surface + ' fullscreen=' + String(isFullscreen) + ' — every tab draws the state line and the key hint', async ($, on) => {
      const c = await openPanel($, on, {}, {}, { surface, viewport: { columns: 140, rows: 40, isFullscreen } })
      const paths: Record<string, string> = { layout: 'Раскладка', elements: 'Элементы', element: 'Элемент › не выбран', view: 'Вид', themes: 'Темы', numbers: 'Числа' }
      for (const tab of Object.keys(paths)) {
        await press(c, 'tab:' + tab)
        const texts = textsOf(await nodesOf(c.pane))
        const state = texts.find((t) => t.includes('цель: строка 1'))
        expect({ tab, state }).toEqual({ tab, state: paths[tab] + ' · цель: строка 1 · сохранено' })
        const hint = texts.find((t) => t.includes('Esc — закрыть (черновик сохранится)'))
        expect(hint).toBeDefined()
        if (isFullscreen) expect(hint).toContain('клик — нажать')
        // #521 FIX2 Р22: the mouse hint is the terminal's alone
        else if (surface === 'terminal') expect(hint).toContain('мышь вне полноэкранного режима не работает')
        else expect(hint).not.toContain('мышь')
      }
      await press(c, 'tab:layout')
      await press(c, 'seg:ctx')
      await press(c, 'edit')
      await press(c, 'var:percent')
      const state = textsOf(await nodesOf(c.pane)).find((t) => t.includes('цель: строка 1'))
      expect(state).toBe('Элемент › ctx · цель: строка 1 · черновик: изменено полей: 1 не сохранено')
    })
  }
}

// ---------- tooth 8 (Р8): the keyboard reaches the panel ----------

test('#521 tooth 8 (Р8): the search field takes no autoFocus, a body pill does; the bottom hotkeys stand and never collide', async ($, on) => {
  const c = await openPanel($, on)
  const autoFocused = (nodes: Node[]): string[] => nodes.filter((n) => propOf(n, 'autoFocus') === true).map(keyOf)
  await press(c, 'tab:elements')
  let nodes = await nodesOf(c.pane)
  const filter = nodes.find((n) => n.type === 'Input' && keyOf(n) === 'filter')
  expect(filter).toBeDefined()
  expect(propOf(filter!, 'autoFocus')).toBeUndefined()
  expect(autoFocused(nodes)).toEqual(['fam:all'])
  await press(c, 'tab:layout')
  nodes = await nodesOf(c.pane)
  expect(autoFocused(nodes)).toEqual(['seg:model'])
  const hotkeys = (ns: Node[]): Record<string, string> => Object.fromEntries(ns.filter((n) => n.type === 'Button' && typeof propOf(n, 'hotkey') === 'string').map((n) => [keyOf(n), String(propOf(n, 'hotkey'))]))
  const check = (hk: Record<string, string>, level2: boolean): void => {
    expect({ save: hk['save'], step: hk['undo-step'], close: hk['close'], back: hk['back'] }).toEqual({ save: 's', step: 'z', close: 'q', back: level2 ? 'b' : undefined })
    const all = Object.values(hk)
    expect(new Set(all).size).toBe(all.length)
  }
  check(hotkeys(nodes), false)
  await press(c, 'seg:ctx')
  await press(c, 'edit')
  check(hotkeys(await nodesOf(c.pane)), true)
})

// ---------- tooth 9 (Р9): native Select where the surface has one ----------

// #521 FIX2 Р17: «Темы» stays buttons on every surface — the pick is a press
test('#521 tooth 9 (Р9): on the terminal «Вид» is one Select per axis and «Темы» theme buttons; a pick edits the draft', async ($, on) => {
  const c = await openPanel($, on)
  await press(c, 'tab:view')
  const selects = ((await c.pane.findAll({ type: 'Select' })) as Node[]).map(keyOf)
  expect(selects).toEqual(['ax:shape', 'ax:caps', 'ax:glyphs', 'ax:fill', 'ax:bar', 'ax:barWidth', 'ax:palette', 'ax:thresholds', 'ax:face', 'ax:border', 'ax:overflow', 'ax:separator', 'ax:align'])
  expect(buttonKeys(await nodesOf(c.pane)).filter((k) => k.startsWith('ax:'))).toEqual([])
  await c.pane.select({ key: 'ax:palette', value: 'mono' })
  await settle(c.w)
  expect(draftOf(c.w).axes.palette).toBe('mono')
  await press(c, 'tab:themes')
  expect(((await c.pane.findAll({ type: 'Select' })) as Node[]).map(keyOf)).toEqual([])
  expect(buttonKeys(await nodesOf(c.pane))).toContain('theme:powerline')
  await press(c, 'theme:powerline')
  expect(draftOf(c.w).axes.theme).toBe('powerline')
  expect(draftOf(c.w).axes.palette).toBe('theme')
})

test('#521 tooth 9 (Р9): a table without Select keeps the pills', () => {
  SL.__resetState()
  try {
    const view = walk(SL.__renderPicker({}, 'view', 120) as Node)
    expect(view.some((n) => n.type === 'Select')).toBe(false)
    expect(buttonKeys(view)).toContain('ax:palette:codex')
    const themes = walk(SL.__renderPicker({}, 'themes', 120) as Node)
    expect(buttonKeys(themes)).toContain('theme:powerline')
  } finally {
    SL.__resetState()
  }
})

// ---------- tooth 10 (Р10): the save ends; the undo record holds what was written ----------

test('#521 tooth 10 (Р10): a save without a reload leaves no in-flight banner', async ($, on) => {
  const c = await openPanel($, on)
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  await press(c, 'save')
  expect(c.w.writes).toContainEqual({ key: 'catalyst-statusline.numTokens', value: 'raw' })
  expect(textsOf(await nodesOf(c.pane)).some((t) => t.includes('сохранение в полёте'))).toBe(false)
})

test('#521 tooth 10 (Р10): a partly refused save keeps only the written fields for undo, and undo reverts them', async ($, on) => {
  const accepted: Array<{ key: string; value: unknown }> = []
  const c = await openPanel($, on, {
    'config.set': (_$: any, e: any) => {
      if (String(e.key).endsWith('.numTokens')) throw new Error('refused by the test')
      accepted.push({ key: e.key, value: e.value })
      return { value: e.value }
    },
  })
  await press(c, 'tab:numbers')
  await press(c, 'num:numTokens:raw')
  await press(c, 'num:numUsd:short')
  await press(c, 'save')
  // the stand's options hold template '' (the default layout): Save writes the layout explicitly beside the edits
  const wrote = Object.fromEntries(accepted.map((x) => [x.key.slice(x.key.lastIndexOf('.') + 1), x.value]))
  expect(Object.keys(wrote).sort()).toEqual(['numUsd', 'template'])
  const stack = undoStack(c.w.persisted)
  const top = stack[stack.length - 1]!
  expect({ fields: [...top.fields].sort(), prev: Object.keys(top.prev).sort(), written: top.written }).toEqual({ fields: ['numUsd', 'template'], prev: ['numUsd', 'template'], written: wrote })
  const n = accepted.length
  await press(c, 'undo')
  expect(Object.fromEntries(accepted.slice(n).map((x) => [x.key.slice(x.key.lastIndexOf('.') + 1), x.value]))).toEqual({ numUsd: top.prev['numUsd'], template: top.prev['template'] })
  expect(textsOf(await nodesOf(c.pane)).some((t) => t === 'отменено')).toBe(true)
})

// ---------- tooth 11 (Р11): the translated catch classes ----------

test('#521 tooth 11 (Р11, picker store writes): a refused draft write is recorded', async () => {
  SL.__resetState()
  try {
    // CONSTRAINT: the kit skips a store hook that throws — a refused write is
    // stood up in this realm, where the press and the record both live
    const $ = {
      store: {
        get: async () => undefined,
        set: async (k: string) => { if (k.startsWith(STORE_DRAFT) || k.startsWith(NS_DRAFT)) throw new Error('draft write refused by the test') },
        delete: async () => undefined,
      },
      session: { id: async () => 'A' },
      plugin: { name: 'catalyst-statusline', root: '/stand' },
      ui: { log: async () => undefined, invalidate: () => undefined },
    }
    const nodes = walk(SL.__renderPicker({}, 'numbers', 120, undefined, $.store, $) as Node)
    const node = nodes.find((n) => n.type === 'Button' && keyOf(n) === 'num:numTokens:raw')
    ;(node!.props!['onPress'] as () => void)()
    for (let i = 0; i < 6; i++) await drain()
    expect(SL.__diag().filter((d) => d.key === 'picker-draft-store').map((d) => d.text)).toEqual(['the picker draft could not be stored: Error: draft write refused by the test; it is kept in memory and stored at the next draft write or open — a reload loses the unsaved edits'])
  } finally {
    SL.__resetState()
  }
})

test('#521 tooth 11 (Р11, reads with a fallback): a refused read of the open flag is recorded by the restore', async () => {
  SL.__resetState()
  try {
    const $ = {
      store: {
        get: async (k: string) => { if (k === STORE_OPEN) throw new Error('open read refused by the test'); return undefined },
        set: async () => undefined,
        delete: async () => undefined,
        keys: async () => [],
      },
      session: { id: async () => 'A' },
      plugin: { name: 'catalyst-statusline', root: '/stand' },
      ui: { log: async () => undefined, invalidate: () => undefined },
    }
    await SL.restoreAfterReload($ as never, {} as never)
    expect(SL.__diag().filter((d) => d.key === 'picker-restore-read').map((d) => d.text)).toEqual(['the picker open flag or its draft could not be read: Error: open read refused by the test; the picker stays closed'])
  } finally {
    SL.__resetState()
  }
})

test('#521 tooth 11 (Р11, timer cancels): a refused cancel of a source timer is recorded', async () => {
  SL.__resetState()
  try {
    SL.__setArmEvery(() => ({ cancel() { throw new Error('cancel refused by the test') } }))
    const $ = {
      store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined },
      session: { id: async () => 'A', cwd: async () => '/work/demo', root: async () => '/work/demo' },
      plugin: { name: 'catalyst-statusline', root: '/stand' },
      ui: { log: async () => undefined, invalidate: () => undefined, status: () => undefined },
      clock: { now: async () => 1000, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
      env: { get: async () => '' },
      fs: { read: async () => '' },
      process: { run: async () => ({ exitCode: 0, stdout: 'main\n', stderr: '' }) },
    }
    SL.__render({ template: 'git-branch' })
    await SL.__syncSourceTimers($ as never)
    for (let i = 0; i < 6; i++) await drain()
    SL.__render({ template: 'model' })
    await SL.__syncSourceTimers($ as never)
    for (let i = 0; i < 6; i++) await drain()
    expect(SL.__diag().some((d) => d.key === 'timer-cancel-refused' && d.text.includes('cancel refused by the test'))).toBe(true)
  } finally {
    SL.__setArmEvery(null)
    SL.__resetState()
  }
})

test('#521 tooth 11 (Р11, background runs): a throw that escapes a background run is recorded under its name', async () => {
  SL.__resetState()
  try {
    await SL.__quiet('probe', async () => { throw new Error('escaped by the test') })
    expect(SL.__diag().filter((d) => d.key === 'unhandled-probe').map((d) => d.text)).toEqual(['background run probe threw: Error: escaped by the test'])
  } finally {
    SL.__resetState()
  }
})

// ---------- FIX1b: a Save refused by empty lines names every one of them ----------

const noticeTexts = async (c: Ctx): Promise<string[]> => textsOf(await nodesOf(c.pane)).filter((t) => t.startsWith('не сохранено:'))

test('#521 FIX1b: two empty lines of three — the refused Save names both and says how to fix it', async ($, on) => {
  const c = await openPanel($, on, {}, storedDraft([['model'], [], []]))
  await press(c, 'save')
  expect(await noticeTexts(c)).toEqual(['не сохранено: строки 2, 3 пусты — добавьте элемент (+ элемент) или удалите строку (✕ строка)'])
  expect(c.w.writes).toEqual([])
})

test('#521 FIX1b: one empty line of two — the refused Save names it', async ($, on) => {
  const c = await openPanel($, on, {}, storedDraft([[], ['model']]))
  await press(c, 'save')
  expect(await noticeTexts(c)).toEqual(['не сохранено: строка 1 пуста — добавьте элемент (+ элемент) или удалите строку (✕ строка)'])
  expect(c.w.writes).toEqual([])
})

test('#521 FIX1b: the only line empty — the refused Save offers only to add an element', async ($, on) => {
  const c = await openPanel($, on, {}, storedDraft([[]]))
  await press(c, 'save')
  expect(await noticeTexts(c)).toEqual(['не сохранено: строка 1 пуста — добавьте элемент (+ элемент)'])
  expect(c.w.writes).toEqual([])
})
