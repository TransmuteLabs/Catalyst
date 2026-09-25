// The /statusline-mod panel (DESIGN Р5). CONSTRAINT: this module is pure —
// no `$`, no `on`, no I/O; every behaviour arrives as a callback the core
// closes over its own `$`. The tree it returns is the whole pane body.
// CONSTRAINT: the preview and the band are one render (SPEC §14.6.5): the
// preview tree is built by the core's own bar builder and passed in whole.

export type PickerTable = {
  Box: (props: Record<string, unknown>) => unknown
  Text: (props: Record<string, unknown>) => unknown
  Button: (props: Record<string, unknown>) => unknown
  Input: (props: Record<string, unknown>) => unknown
}

export type PillState = 'sel' | 'off' | 'dim'

export type AxisView = { name: string; label: string; value: string; choices: { id: string; label: string; sample: string }[] }
export type NumberView = { field: string; label: string; value: string; choices: { id: string; sample: string }[] }
export type ElementView = {
  id: string
  label: string
  family: string
  placed: boolean
  unavailable: boolean
  reason: string
  about: string
  sample: string
}

export type SegmentView = { id: string; label: string; focused: boolean; sample: string }

export type PickerModel = {
  tab: string
  lines: SegmentView[][]
  focus: { line: number; seg: number } | null
  targetLine: number
  moves: number
  elements: ElementView[]
  families: string[]
  familyFilter: string
  query: string
  element: {
    id: string
    label: string
    about: string
    variant: string
    variants: { id: string; label: string; sample: string }[]
    options: { key: string; label: string; kind: string; value: string; choices?: { id: string; label: string }[]; min?: number; max?: number }[]
    color: string
    swatches: string[]
    canThreshold: boolean
    icon: string
    labelMode: string
    labelText: string
    hasGlyph: boolean
    barPair: string
    barPairs: { id: string; sample: string }[]
    barWidth: string
    barShow: string
    maxRows: number
    order: string
    orders: { id: string; label: string }[]
    isMeter: boolean
    isList: boolean
  } | null
  axes: AxisView[]
  themes: { name: string; tree: unknown }[]
  themeName: string
  numbers: NumberView[]
  presets: { id: string; label: string }[]
  maxRows: number
  notice: string
  saving: string
  dirty: boolean
  canUndo: boolean
}

export type PickerActions = {
  setTab(tab: string): void
  focusSeg(line: number, seg: number): void
  move(dir: 'left' | 'right' | 'up' | 'down' | 'out'): void
  editSeg(): void
  addLine(): void
  delLine(line: number): void
  addInto(line: number): void
  preset(id: string): void
  setQuery(text: string): void
  setFam(fam: string): void
  toggleElement(id: string): void
  setVariant(id: string): void
  setOption(key: string, value: string): void
  nudgeOption(key: string, delta: number): void
  setColor(value: string): void
  setCustomColor(text: string): void
  setIcon(set: string): void
  setLabelMode(mode: string): void
  setLabelText(text: string): void
  setBarPair(pair: string): void
  setBarWidth(width: string): void
  setBarShow(show: string): void
  setOrder(order: string): void
  setAxis(axis: string, value: string): void
  applyTheme(name: string): void
  setThemeName(text: string): void
  saveTheme(): void
  setNumber(field: string, value: string): void
  save(): void
  cancel(): void
  undo(): void
  resetToTheme(): void
}

const TABS: { id: string; label: string }[] = [
  { id: 'layout', label: 'Раскладка' },
  { id: 'elements', label: 'Элементы' },
  { id: 'element', label: 'Элемент' },
  { id: 'view', label: 'Вид' },
  { id: 'themes', label: 'Темы' },
  { id: 'numbers', label: 'Числа' },
]

// A pill is a keyed Box with a background and a plain Button inside
// (DESIGN Р5, BoxProps.backgroundColor d.ts:735). Selected: accent fill and
// a bold label; unselected: no fill, dim; unavailable: dim with ⊘ and a
// hover card that names the reason.
function pill(t: PickerTable, key: string, label: string, state: PillState, onPress: () => void, opts: { hotkey?: string; bg?: string } = {}): unknown {
  // CONSTRAINT (d.ts ButtonProps): a Button carries no bold/color of its own;
  // selection is the wrapping Box's fill, dimness is Button dimColor
  const btn: Record<string, unknown> = { key, label, plain: true, onPress }
  if (opts.hotkey) btn['hotkey'] = opts.hotkey
  if (state === 'dim') btn['dimColor'] = true
  const box: Record<string, unknown> = { key: 'box:' + key, flexDirection: 'row', flexShrink: 0, paddingX: 1, children: [t.Button(btn)] }
  if (state === 'sel') box['backgroundColor'] = opts.bg ?? 'cyan'
  return t.Box(box)
}

function row(t: PickerTable, key: string, children: unknown[]): unknown {
  return t.Box({ key, flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, children })
}

function label(t: PickerTable, text: string, key?: string): unknown {
  const props: Record<string, unknown> = { children: [text], dimColor: true, wrap: 'truncate' }
  if (key) props['key'] = key
  return t.Text(props)
}

function card(t: PickerTable, scope: string, text: string): unknown {
  // the bar's hover-card shape: out of the flow, one row up (SPEC §14.6)
  return t.Box({
    position: 'absolute',
    top: -1,
    left: 0,
    display: 'none',
    hover: { scope, display: 'flex' },
    children: [t.Text({ children: [' ' + text + ' '], wrap: 'truncate' })],
  })
}

export function buildPicker(m: PickerModel, t: PickerTable, a: PickerActions, preview: unknown): unknown {
  const body: unknown[] = []
  if (m.tab === 'layout') body.push(...layoutTab(m, t, a))
  else if (m.tab === 'elements') body.push(...elementsTab(m, t, a))
  else if (m.tab === 'element') body.push(...elementTab(m, t, a))
  else if (m.tab === 'view') body.push(...viewTab(m, t, a))
  else if (m.tab === 'themes') body.push(...themesTab(m, t, a))
  else if (m.tab === 'numbers') body.push(...numbersTab(m, t, a))

  const bottom: unknown[] = [
    t.Button({ key: 'save', label: 'Сохранить', onPress: a.save }),
    t.Button({ key: 'cancel', label: 'Отмена', onPress: a.cancel }),
    t.Button({ key: 'undo', label: 'Шаг назад', onPress: a.undo }),
    t.Button({ key: 'reset', label: 'Сбросить к теме', onPress: a.resetToTheme }),
  ]
  if (m.dirty) bottom.push(label(t, 'есть несохранённое', 'dirty'))
  if (m.notice) body.push(t.Text({ key: 'notice', children: [m.notice], wrap: 'truncate' }))
  if (m.saving) body.push(label(t, 'сохранение в полёте: ' + m.saving, 'saving'))

  return t.Box({
    flexDirection: 'column',
    children: [
      preview,
      row(
        t,
        'tabs',
        TABS.map((tab, i) => pill(t, 'tab:' + tab.id, i + 1 + ' ' + tab.label, m.tab === tab.id ? 'sel' : 'off', () => a.setTab(tab.id), { hotkey: String(i + 1) })),
      ),
      t.Box({ key: 'body', flexDirection: 'column', children: body }),
      row(t, 'actions', bottom),
    ],
  })
}

function layoutTab(m: PickerModel, t: PickerTable, a: PickerActions): unknown[] {
  const rows: unknown[] = []
  m.lines.forEach((line, li) => {
    const pills: unknown[] = line.map((seg, si) =>
      pill(t, segKey(seg.id, seg.focused, m), (seg.focused ? '· ' : '') + seg.label + (seg.sample ? ' ' + seg.sample.slice(0, 18) : ''), seg.focused ? 'sel' : 'off', () => a.focusSeg(li, si)),
    )
    pills.push(t.Button({ key: 'line:' + li + ':add', label: '+ элемент', plain: true, onPress: () => a.addInto(li) }))
    pills.push(t.Button({ key: 'line:' + li + ':del', label: '✕ строка', plain: true, onPress: () => a.delLine(li) }))
    rows.push(row(t, 'line:' + li, [label(t, 'Строка ' + (li + 1), 'linelabel:' + li), ...pills]))
  })
  const moves: [string, string, string, 'left' | 'right' | 'up' | 'down' | 'out'][] = [
    ['mv:left', '◀', 'h', 'left'],
    ['mv:right', '▶', 'l', 'right'],
    ['mv:up', '▲', 'k', 'up'],
    ['mv:down', '▼', 'j', 'down'],
    ['mv:out', '✕', 'x', 'out'],
  ]
  rows.push(
    row(
      t,
      'moves',
      moves.map(([key, glyph, hotkey, dir]) => t.Button({ key, label: glyph, hotkey, plain: true, onPress: () => a.move(dir) })),
    ),
    row(t, 'editseg', [t.Button({ key: 'edit', label: '⚙ Элемент (e)', hotkey: 'e', plain: true, onPress: a.editSeg })]),
  )
  const tail: unknown[] = [t.Button({ key: 'line:add', label: '+ строка (max ' + m.maxRows + ')', plain: true, onPress: a.addLine })]
  for (const p of m.presets) tail.push(pill(t, 'preset:' + p.id, p.label, 'off', () => a.preset(p.id)))
  rows.push(row(t, 'presets', tail))
  return rows
}

// The focused pill is drawn under a key no drawing had yet after a move: the
// engine waits for that key and the focus keeps its place (measured, 2.1.280)
function segKey(id: string, focused: boolean, m: PickerModel): string {
  return 'seg:' + id + (focused ? '#move' + m.moves : '')
}

function elementsTab(m: PickerModel, t: PickerTable, a: PickerActions): unknown[] {
  const rows: unknown[] = []
  rows.push(t.Input({ key: 'filter', label: 'Поиск', placeholder: 'имя элемента', autoFocus: true, value: m.query, onInput: a.setQuery, onSubmit: a.setQuery }))
  const fams = ['all', ...m.families]
  rows.push(row(t, 'fams', fams.map((f) => pill(t, 'fam:' + f, f === 'all' ? 'Все' : famLabel(f), m.familyFilter === f ? 'sel' : 'off', () => a.setFam(f)))))
  const pills: unknown[] = []
  const cards: unknown[] = []
  for (const e of m.elements) {
    const inner = e.unavailable
      ? t.Text({ key: 'el:' + e.id, children: ['⊘ ' + e.label], dimColor: true, hover: { scope: 'slp-' + e.id, bold: true, underline: true }, wrap: 'truncate' })
      : t.Button({ key: 'el:' + e.id, label: (e.placed ? '✓ ' : '') + e.label, plain: true, hover: { scope: 'slp-' + e.id, bold: true }, onPress: () => a.toggleElement(e.id) })
    pills.push(
      t.Box({
        key: 'box:el:' + e.id,
        flexDirection: 'row',
        flexShrink: 0,
        paddingX: 1,
        backgroundColor: e.placed ? 'blue' : undefined,
        children: [inner],
      }),
    )
    if (e.unavailable) cards.push(card(t, 'slp-' + e.id, e.label + ': ' + e.reason))
  }
  rows.push(row(t, 'elements', pills))
  rows.push(...cards)
  return rows
}

const FAM_LABEL: Record<string, string> = {
  model: 'Модель', context: 'Контекст', tokens: 'Токены', cost: 'Деньги', limits: 'Лимиты', session: 'Сессия',
  agents: 'Агенты', tools: 'Инструменты', git: 'Git', project: 'Проект', files: 'Файлы', system: 'Система',
  github: 'GitHub', ci: 'CI', deploy: 'Деплой', workflow: 'Workflow', decor: 'Декор',
}

function famLabel(f: string): string {
  return FAM_LABEL[f] ?? f
}

function elementTab(m: PickerModel, t: PickerTable, a: PickerActions): unknown[] {
  const e = m.element
  if (!e) return [label(t, 'Элемент не выбран — выбери пилюлю в «Раскладка» или добавь в «Элементы»', 'noelem')]
  const rows: unknown[] = []
  rows.push(t.Text({ key: 'eltitle', children: [e.label + ' — ' + e.about], wrap: 'truncate' }))
  rows.push(label(t, 'Вариант', 'h:variant'))
  rows.push(row(t, 'variants', e.variants.map((v) => pill(t, 'var:' + v.id, v.label + (v.sample ? ' · ' + v.sample.slice(0, 24) : ''), e.variant === v.id ? 'sel' : 'off', () => a.setVariant(v.id)))))
  for (const o of e.options) {
    if (o.kind === 'choice') {
      rows.push(label(t, o.label, 'h:' + o.key))
      rows.push(row(t, 'opt:' + o.key, (o.choices ?? []).map((c) => pill(t, 'opt:' + o.key + ':' + c.id, c.label, o.value === c.id ? 'sel' : 'off', () => a.setOption(o.key, c.id)))))
    } else if (o.kind === 'toggle') {
      rows.push(row(t, 'opt:' + o.key, [pill(t, 'opt:' + o.key + ':' + o.value, o.label + ': ' + (o.value === 'on' ? 'вкл' : 'выкл'), 'sel', () => a.setOption(o.key, o.value === 'on' ? 'off' : 'on'))]))
    } else if (o.kind === 'int') {
      rows.push(
        row(t, 'opt:' + o.key, [
          t.Button({ key: 'opt:' + o.key + ':-', label: '−', plain: true, onPress: () => a.nudgeOption(o.key, -1) }),
          t.Text({ key: 'opt:' + o.key + ':v', children: [o.label + ' ' + o.value] }),
          t.Button({ key: 'opt:' + o.key + ':+', label: '+', plain: true, onPress: () => a.nudgeOption(o.key, 1) }),
        ]),
      )
    } else {
      rows.push(t.Input({ key: 'optin:' + o.key, label: o.label, value: o.value, onInput: (v: string) => a.setOption(o.key, v), onSubmit: (v: string) => a.setOption(o.key, v) }))
    }
  }
  rows.push(label(t, 'Цвет', 'h:color'))
  const colorPills: unknown[] = [pill(t, 'col:theme', 'по теме', e.color === '' ? 'sel' : 'off', () => a.setColor(''))]
  if (e.canThreshold) colorPills.push(pill(t, 'col:threshold', 'по порогу', e.color === 'threshold' ? 'sel' : 'off', () => a.setColor('threshold')))
  for (const sw of e.swatches) colorPills.push(pill(t, 'col:' + sw, '██', e.color === sw ? 'sel' : 'off', () => a.setColor(sw), { bg: sw }))
  colorPills.push(t.Input({ key: 'colin', label: '#rrggbb', placeholder: 'свой цвет', onInput: a.setCustomColor, onSubmit: a.setCustomColor }))
  rows.push(row(t, 'colors', colorPills))
  rows.push(label(t, 'Иконка', 'h:icon'))
  const iconSets = e.hasGlyph ? ['none', 'ascii', 'unicode', 'emoji', 'nerd'] : []
  if (iconSets.length > 0) rows.push(row(t, 'icons', iconSets.map((s) => pill(t, 'icon:' + s, s, e.icon === s ? 'sel' : 'off', () => a.setIcon(s)))))
  else rows.push(label(t, 'у этого элемента нет собственного глифа — значки несут его строки', 'noicons'))
  rows.push(label(t, 'Подпись', 'h:label'))
  rows.push(
    row(t, 'labels', [
      pill(t, 'label:on', 'вкл', e.labelMode === 'on' ? 'sel' : 'off', () => a.setLabelMode('on')),
      pill(t, 'label:off', 'выкл', e.labelMode === 'off' ? 'sel' : 'off', () => a.setLabelMode('off')),
      pill(t, 'label:text', 'свой текст', e.labelMode === 'text' ? 'sel' : 'off', () => a.setLabelMode('text')),
    ]),
  )
  rows.push(t.Input({ key: 'ltext', label: 'текст подписи', placeholder: 'Context, Approx RAM…', value: e.labelText, onInput: a.setLabelText, onSubmit: a.setLabelText }))
  if (e.isMeter) {
    rows.push(label(t, 'Вид бара', 'h:bar'))
    rows.push(row(t, 'barpairs', e.barPairs.map((p) => pill(t, 'bp:' + p.id, p.sample, e.barPair === p.id ? 'sel' : 'off', () => a.setBarPair(p.id)))))
    rows.push(
      row(t, 'barwidths', ['5', '10', '16', '20', 'auto'].map((w) => pill(t, 'bw:' + w, w, e.barWidth === w ? 'sel' : 'off', () => a.setBarWidth(w)))),
    )
    rows.push(
      row(t, 'barshows', [
        pill(t, 'show:bar', 'бар', e.barShow === 'bar' ? 'sel' : 'off', () => a.setBarShow('bar')),
        pill(t, 'show:value', 'значение', e.barShow === 'value' ? 'sel' : 'off', () => a.setBarShow('value')),
        pill(t, 'show:percent', 'процент', e.barShow === 'percent' ? 'sel' : 'off', () => a.setBarShow('percent')),
        pill(t, 'show:all', 'всё', e.barShow === 'all' ? 'sel' : 'off', () => a.setBarShow('all')),
      ]),
    )
  }
  if (e.isList) {
    rows.push(
      row(t, 'listopts', [
        t.Button({ key: 'mr:-', label: '−', plain: true, onPress: () => a.nudgeOption('maxRows', -1) }),
        t.Text({ key: 'mr:v', children: ['максимум строк ' + String(e.maxRows)] }),
        t.Button({ key: 'mr:+', label: '+', plain: true, onPress: () => a.nudgeOption('maxRows', 1) }),
        ...e.orders.map((o) => pill(t, 'od:' + o.id, o.label, e.order === o.id ? 'sel' : 'off', () => a.setOrder(o.id))),
      ]),
    )
  }
  return rows
}

function viewTab(m: PickerModel, t: PickerTable, a: PickerActions): unknown[] {
  const rows: unknown[] = []
  for (const axis of m.axes) {
    const pills = axis.choices.map((c) => pill(t, 'ax:' + axis.name + ':' + c.id, c.label + (c.sample && c.label !== c.sample ? ' ' + c.sample : ''), axis.value === c.id ? 'sel' : 'off', () => a.setAxis(axis.name, c.id)))
    rows.push(row(t, 'axis:' + axis.name, [label(t, axisLabel(axis.name), 'axl:' + axis.name), ...pills]))
  }
  return rows
}

const AXIS_LABEL: Record<string, string> = {
  shape: 'форма сегмента', caps: 'кэпы', separator: 'разделители', glyphs: 'глифы', fill: 'заливка',
  bar: 'бар', palette: 'палитра', thresholds: 'пороги', face: 'начертание подписей', border: 'рамка',
  align: 'выравнивание', overflow: 'поведение в узком окне', barWidth: 'ширина бара',
}

function axisLabel(name: string): string {
  return AXIS_LABEL[name] ?? name
}

function themesTab(m: PickerModel, t: PickerTable, a: PickerActions): unknown[] {
  const rows: unknown[] = []
  for (const th of m.themes) {
    rows.push(
      t.Box({ key: 'themecard:' + th.name, flexDirection: 'column', borderStyle: 'round', children: [
        t.Button({ key: 'theme:' + th.name, label: th.name, plain: true, onPress: () => a.applyTheme(th.name) }),
        th.tree,
      ] }),
    )
  }
  rows.push(t.Input({ key: 'theme-name', label: 'Имя темы', placeholder: 'имя для «Сохранить как тему»', value: m.themeName, onInput: a.setThemeName, onSubmit: a.setThemeName }))
  rows.push(t.Button({ key: 'theme-save', label: 'Сохранить текущий вид как тему', plain: true, onPress: a.saveTheme }))
  return rows
}

function numbersTab(m: PickerModel, t: PickerTable, a: PickerActions): unknown[] {
  const rows: unknown[] = []
  for (const n of m.numbers) {
    rows.push(row(t, 'num:' + n.field, [label(t, n.label, 'numl:' + n.field), ...n.choices.map((c) => pill(t, 'num:' + n.field + ':' + c.id, c.sample, n.value === c.id ? 'sel' : 'off', () => a.setNumber(n.field, c.id)))]))
  }
  return rows
}

