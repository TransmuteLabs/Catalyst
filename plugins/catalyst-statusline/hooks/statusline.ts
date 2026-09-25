import type { EngineInterface, On, PluginOptions } from 'claude-code'
import type { Collector, ElementDef, Input, NumberFormat, Row, Source, Value, Variant } from './data/types'
import { FAMILIES } from './data/index'
import { agentScopeOf } from './data/base'
import { PALETTES, THEMES, THEME_AXES, type Pal } from './themes'
import { buildPicker, type PickerActions, type PickerModel, type PickerTable } from './picker'

export { displayName, shortModel } from './data/base'

// catalyst-statusline 0.5.0: the core (DESIGN Р1–Р10). The entry file holds
// every `$` and every `on` (the host resolver laws bind `$` to the entry,
// #363); the data families, the themes and the picker are pure imports.
//
// CONSTRAINT (SPEC §13.3): the render path reads precomputed family state
// only — no subprocess, no file read, no network. Sources run on events and
// timers, and a cmd/file/clock source runs only while one of its elements
// stands in the SAVED layout (SPEC §11.2).
// CONSTRAINT: the core holds ONE subscription per event and fans the inputs
// out to every family that declared the event.

const COMMAND = 'statusline-mod'
const PANE_ID = 'statusline'
const LINE_SPLIT = ' ;; '
const SEG_SPLIT = '||'
const STORE_OPEN = 'statusline.open.v1'
const STORE_DRAFT = 'statusline.draft.v1'
const STORE_SAVING = 'statusline.saving.v1'
const STORE_UNDO = 'statusline.undo.v1'
const STORE_LASTGOOD = 'statusline.lastgood.v1'
const STORE_THEMES = 'statusline.themes.v1'
const SEGMENT_KEY = 'seg:'
const UNDO_CAP = 30
const WIDTH_FALLBACK = 80

// ---------- registry over the families (variants route to their author) ----------

export type Registry = {
  byId: Map<string, { def: ElementDef; owner: Collector<unknown> }>
  families: Collector<unknown>[]
  // element id -> variant id -> the family that contributes it (types.ts
  // variantsFor: value() for such a variant goes to the author, never the owner)
  variantOwner: Map<string, Map<string, Collector<unknown>>>
  duplicateIds: string[]
}

export function buildRegistry(families: Collector<unknown>[]): Registry {
  const byId = new Map<string, { def: ElementDef; owner: Collector<unknown> }>()
  const variantOwner = new Map<string, Map<string, Collector<unknown>>>()
  const duplicateIds: string[] = []
  for (const fam of families) {
    for (const def of fam.elements) {
      if (byId.has(def.id)) {
        // a duplicate id would answer value() twice and evict as twins: loud,
        // the first registration stands
        duplicateIds.push(def.id)
        continue
      }
      byId.set(def.id, { def, owner: fam })
    }
    for (const vf of fam.variantsFor ?? []) {
      const entry = byId.get(vf.element)
      if (!entry) continue
      let map = variantOwner.get(vf.element)
      if (!map) {
        map = new Map()
        variantOwner.set(vf.element, map)
      }
      for (const v of vf.variants) if (!map.has(v.id)) map.set(v.id, fam)
    }
  }
  return { byId, families, variantOwner, duplicateIds }
}

export function resolveVariantOwner(reg: Registry, elementId: string, variantId: string): Collector<unknown> | undefined {
  return reg.variantOwner.get(elementId)?.get(variantId)
}

const REG: Registry = buildRegistry(FAMILIES)
export const REGISTRY: readonly ElementDef[] = [...REG.byId.values()].map((e) => e.def)
export const REGISTRY_IDS: readonly string[] = REGISTRY.map((d) => d.id)

// ---------- view axes ----------

const AXIS_OPTIONS: Record<string, readonly string[]> = {
  shape: ['plain', 'lean', 'pill', 'powerline', 'classic'],
  caps: ['none', 'round', 'arrow', 'unicode-round'],
  glyphs: ['none', 'ascii', 'unicode', 'emoji', 'nerd'],
  fill: ['none', 'segment', 'band', 'inverse'],
  bar: ['blocks', 'parallelogram', 'ascii', 'shade', 'baseline', 'low-blocks', 'pie'],
  barWidth: ['adaptive'],
  palette: Object.keys(PALETTES),
  border: ['none', 'single', 'double', 'round'],
  overflow: ['evict', 'wrap'],
  align: ['left', 'split', 'right', 'center'],
}
const PINNED_AXES: Record<string, string> = { placement: 'above', details: 'hover' }
const PINNED_OPTIONS: Record<string, readonly string[]> = {
  placement: ['above', 'hint'],
  details: ['off', 'hover'],
}
const ALL_AXES = ['placement', 'details', ...THEME_AXES]

const BAR_PAIRS: Record<string, [string, string]> = {
  blocks: ['█', '░'],
  parallelogram: ['▰', '▱'],
  ascii: ['#', '-'],
  shade: ['▓', '░'],
  baseline: ['█', '▁'],
  'low-blocks': ['▇', '▁'],
  pie: ['◔', '○'],
}
// per-element bar pairs of DESIGN Р4: pill samples, the pair literal is the id
const BAR_PAIR_CHOICES: { id: string; sample: string }[] = [
  { id: '█░', sample: '█░' },
  { id: '▰▱', sample: '▰▱' },
  { id: '⣿⣀', sample: '⣿⣀' },
  { id: '●○', sample: '●○' },
  { id: '■□', sample: '■□' },
  { id: '▮▯', sample: '▮▯' },
  { id: '━─', sample: '━─' },
]

const CAP_PAIRS: Record<string, [string, string]> = {
  round: ['\u{E0B6}', '\u{E0B4}'],
  arrow: ['\u{E0B0}', '\u{E0B2}'],
  'unicode-round': ['◖', '◗'],
}

// the text axes take a free value; the tab offers named samples (Р5)
const AXIS_TEXT_CHOICES: Record<string, readonly string[]> = {
  thresholds: ['50,75', '70,90', '75,90', '80,95'],
  face: ['', 'label=dim', 'label=bold;value=', 'value=bold'],
  separator: [' │ ', ' | ', ' · ', ',', ''],
}

const COLOR_NAMES = new Set(['red', 'green', 'yellow', 'magenta', 'white', 'dim', 'blue', 'cyan', 'black', 'gray', 'grey'])

// ---------- number formats (Р7: six independent fields, the family never formats) ----------

export const NUM_FIELDS: { field: string; choices: readonly string[]; label: string }[] = [
  { field: 'numTokens', choices: ['compact', 'raw', 'compact1', 'grouped'], label: 'токены' },
  { field: 'numPercent', choices: ['int', 'dec1', 'ratio'], label: 'проценты' },
  { field: 'numUsd', choices: ['exact', 'short', 'whole'], label: 'деньги' },
  { field: 'numDuration', choices: ['hm', 'dh', 'clock'], label: 'время' },
  { field: 'numBytes', choices: ['gb', 'gib', 'mb'], label: 'байты' },
  { field: 'numRate', choices: ['tok', 'plain'], label: 'скорость' },
]

function groupThousands(n: number): string {
  const sign = n < 0 ? '-' : ''
  const digits = Math.round(Math.abs(n)).toString()
  const out: string[] = []
  for (let i = digits.length; i > 0; i -= 3) out.unshift(digits.slice(Math.max(0, i - 3), i))
  return sign + out.join(' ')
}

function compactTokens(n: number, decimals: number): string {
  const abs = Math.abs(n)
  // .0 is dropped only for the 0-decimal form; compact1 must keep 231.0K
  const trim = (text: string): string => (decimals === 0 ? text.replace(/\.0$/, '') : text)
  if (abs >= 1_000_000) return trim((n / 1_000_000).toFixed(decimals)) + 'M'
  if (abs >= 1_000) return trim((n / 1_000).toFixed(decimals)) + 'K'
  return String(n)
}

export function buildNf(raw: Record<string, string>): NumberFormat {
  const tokens = raw['numTokens'] ?? 'compact'
  const percent = raw['numPercent'] ?? 'int'
  const usd = raw['numUsd'] ?? 'exact'
  const duration = raw['numDuration'] ?? 'hm'
  const bytes = raw['numBytes'] ?? 'gb'
  const rate = raw['numRate'] ?? 'tok'
  return {
    tokens(n: number) {
      if (!Number.isFinite(n)) return String(n)
      if (tokens === 'raw') return String(n)
      if (tokens === 'grouped') return groupThousands(n)
      if (tokens === 'compact1') return compactTokens(n, 1)
      return compactTokens(n, 0)
    },
    percent(r: number) {
      if (!Number.isFinite(r)) return String(r)
      if (percent === 'ratio') return (Math.round(r * 100) / 100).toFixed(2)
      if (percent === 'dec1') return (Math.round(r * 1000) / 10).toFixed(1) + '%'
      return String(Math.round(r * 100)) + '%'
    },
    usd(n: number) {
      if (!Number.isFinite(n)) return String(n)
      if (usd === 'whole') return '$' + String(Math.round(n))
      if (usd === 'short') {
        const abs = Math.abs(n)
        if (abs >= 1000) return '$' + compactTokens(n, 1)
        return '$' + n.toFixed(2)
      }
      // a nonzero value never reads as $0.00 (SPEC §14.5.4)
      const fixed = '$' + n.toFixed(2)
      if (fixed === '$0.00' && n !== 0) return '$' + String(n)
      return fixed
    },
    duration(ms: number) {
      const s = Math.max(0, Math.floor(ms / 1000))
      if (duration === 'clock') {
        const h = Math.floor(s / 3600)
        const m = Math.floor((s % 3600) / 60)
        return h + ':' + String(m).padStart(2, '0')
      }
      if (duration === 'dh') {
        const d = Math.floor(s / 86400)
        const h = Math.floor((s % 86400) / 3600)
        if (d > 0) return d + 'd ' + h + 'h'
        return dhUnder(s)
      }
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm'
      if (m > 0) return m + 'm'
      return s + 's'
    },
    bytes(n: number) {
      if (!Number.isFinite(n) || n <= 0) return String(n)
      if (bytes === 'gib') {
        const gib = n / 1024 ** 3
        if (gib >= 1) return gib.toFixed(1).replace(/\.0$/, '') + ' GiB'
        return (n / 1024 ** 2).toFixed(1).replace(/\.0$/, '') + ' MiB'
      }
      if (bytes === 'mb') {
        if (n >= 1_000_000) return String(Math.round(n / 1_000_000)) + ' MB'
        if (n >= 1_000) return String(Math.round(n / 1_000)) + ' KB'
        return String(Math.round(n)) + ' B'
      }
      if (n >= 1e9) {
        const gb = n / 1e9
        return (gb >= 10 ? String(Math.round(gb)) : gb.toFixed(1).replace(/\.0$/, '')) + ' GB'
      }
      if (n >= 1e6) return String(Math.round(n / 1e6)) + ' MB'
      if (n >= 1e3) return String(Math.round(n / 1e3)) + ' KB'
      return String(Math.round(n)) + ' B'
    },
    count(n: number) {
      return String(n)
    },
    rate(perSec: number, unit: string) {
      const n = Math.round(perSec * 10) / 10
      return rate === 'plain' ? n + '/s' : n + ' ' + unit + '/s'
    },
  }
}

function dhUnder(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm'
  if (m > 0) return m + 'm'
  return s + 's'
}

// ---------- per-element settings (Р4, the `elements` field of /config) ----------

export type ElemSettings = Record<string, string>

// keys: v variant · c color · ic icon · lb label mode · lt label text ·
// bp bar pair · bw bar width · bs bar show · plus o:<option key> for the
// element's own data options
const SETTING_KEYS = ['v', 'c', 'ic', 'lb', 'lt', 'bp', 'bw', 'bs']

export function parseElements(raw: string): Record<string, ElemSettings> {
  const out: Record<string, ElemSettings> = {}
  if (!raw) return out
  for (const part of raw.split(';')) {
    if (part.trim() === '') continue
    const m = /^([a-z0-9_-]+):(.+)$/.exec(part)
    if (!m || !REGISTRY_IDS.includes(m[1]!)) {
      // one bad entry is dropped aloud, the rest apply (SPEC §14.10)
      if (part.trim() !== '') failDiag('warn', 'elements-bad-' + part.trim().slice(0, 24), "elements: entry '" + part.trim() + "' dropped")
      continue
    }
    const settings: ElemSettings = {}
    for (const kv of m[2]!.split(',')) {
      const km = /^(o:[a-z0-9_-]+|[a-z0-9_-]+)=([^,;=]*)$/.exec(kv)
      if (!km) continue
      settings[km[1]!] = km[2]!
    }
    out[m[1]!] = settings
  }
  return out
}

// The canonical form is sorted, so serialize(parse(x)) === serialize(parse(serialize(parse(x))))
// and the round-trip through /config is stable.
export function serializeElements(elements: Record<string, ElemSettings>): string {
  const parts: string[] = []
  for (const id of Object.keys(elements).sort()) {
    const settings = elements[id]!
    const kvs: string[] = []
    for (const key of [...SETTING_KEYS, ...Object.keys(settings).filter((k) => k.startsWith('o:'))].sort()) {
      const v = settings[key]
      if (v !== undefined && v !== '') kvs.push(key + '=' + v)
    }
    if (kvs.length > 0) parts.push(id + ':' + kvs.join(','))
  }
  return parts.join(';')
}

export function elementsRoundTrip(elements: Record<string, ElemSettings>): Record<string, ElemSettings> {
  return parseElements(serializeElements(elements))
}

function settingOf(elements: Record<string, ElemSettings>, id: string, key: string): string | undefined {
  return elements[id]?.[key]
}

function optionsOf(def: ElementDef, elements: Record<string, ElemSettings>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const o of def.options ?? []) {
    const raw = settingOf(elements, def.id, 'o:' + o.key)
    if (o.kind === 'toggle') out[o.key] = raw !== undefined ? raw === 'on' : o.default
    else if (o.kind === 'int') out[o.key] = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : o.default
    else out[o.key] = raw !== undefined ? raw : o.default
  }
  return out
}

// ---------- view resolution ----------

type View = {
  shape: string
  caps: string
  glyphs: string
  fill: string
  barPair: [string, string]
  barWidthMode: string
  barWidthCells: number
  paletteName: string
  pal: Pal
  thresholds: [number, number]
  face: Record<string, string>
  border: string
  overflow: string
  align: string
  separator: string
  placement: string
  details: string
}

function parseThresholds(raw: string): [number, number] {
  const m = /^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/.exec(raw)
  if (!m) return [50, 75]
  return [Number(m[1]), Number(m[2])]
}

function parseFace(raw: string): Record<string, string> {
  const out: Record<string, string> = { label: '', value: '', alert: '' }
  for (const part of raw.split(';')) {
    const m = /^\s*(label|value|alert)\s*=\s*(bold|italic|underline|strikethrough|inverse|dim|blink|hover)?\s*$/.exec(part)
    if (m) out[m[1]!] = m[2] ?? ''
  }
  return out
}

function parseBarPair(raw: string, glyphs: string): [string, string] | null {
  if (raw === 'theme' || raw === '') return null
  if (BAR_PAIRS[raw]) {
    const pair = BAR_PAIRS[raw]!
    return glyphs === 'ascii' && !isAsciiPair(pair) ? BAR_PAIRS['ascii']! : pair
  }
  const chars = [...raw]
  if (chars.length === 2) return glyphs === 'ascii' && !isAsciiPair(chars as [string, string]) ? BAR_PAIRS['ascii']! : (chars as [string, string])
  failDiag('warn', 'bar-pair', "bar: '" + raw + "' is not a named pair or a two-glyph literal; the theme's pair applies")
  return null
}

function isAsciiPair(pair: [string, string]): boolean {
  return pair.every((c) => c.length === 1 && c.charCodeAt(0) < 128)
}

export function resolveView(raw: Record<string, string>, userThemes: Record<string, Record<string, string>>, diagnose = true): { view: View; themeName: string; unknown: boolean } {
  const themeName = raw['theme'] && (THEMES[raw['theme']] || userThemes[raw['theme']]) ? raw['theme'] : 'hud'
  // CONSTRAINT (S1-FIX4 П.1): the unknown-theme condition is a RESULT the
  // caller decides on; the diagnosis below is written only when not suppressed.
  const unknown = !!(raw['theme'] && raw['theme'] !== 'hud' && !THEMES[raw['theme']] && !userThemes[raw['theme']])
  // CONSTRAINT (S1-FIX6 П.4): with the stored themes unread an unknown name is
  // not the user's breakage — themes-read already names the cause.
  if (unknown && diagnose && !S.themesFailed) {
    // SPEC §14.5.2: an unknown theme name is a diagnosis and the last good config
    failDiag('warn', 'theme-unknown', "theme: unknown name '" + raw['theme'] + "'; the default theme applies")
  }
  const userDef = userThemes[themeName]
  const builtin = THEMES[themeName]
  // a saved user theme stores every axis RESOLVED, palette included
  const theme: Record<string, string> = builtin ? { ...builtin.axes } : { ...(userDef ?? THEMES['hud']!.axes) }
  const pick = (axis: string, fallback: string): string => {
    const v = raw[axis]
    if (v === undefined || v === '') return fallback
    if (v === 'theme') return theme[axis] ?? fallback
    const opts = AXIS_OPTIONS[axis]
    if (opts && !opts.includes(v)) {
      failDiag('warn', 'axis-value-' + axis, "axis " + axis + ": unknown value '" + v + "'; the theme's value applies")
      return theme[axis] ?? fallback
    }
    return v
  }
  const glyphs = pick('glyphs', 'none')
  const barRaw = pick('bar', 'blocks')
  const barPair = parseBarPair(barRaw, glyphs) ?? parseBarPair(theme['bar'] ?? 'blocks', glyphs) ?? BAR_PAIRS['blocks']!
  const barWidthRaw = raw['barWidth'] && raw['barWidth'] !== '' && raw['barWidth'] !== 'theme' ? raw['barWidth'] : theme['barWidth'] ?? 'adaptive'
  const widthNum = /^\d+$/.test(barWidthRaw) ? Number(barWidthRaw) : NaN
  const paletteName = pick('palette', 'hud')
  // Degradation is part of the options contract (§14.5.1): PUA caps need Nerd,
  // ASCII keeps no caps at all.
  let caps = pick('caps', 'none')
  if (glyphs === 'ascii') caps = 'none'
  else if (caps === 'round' || caps === 'arrow') {
    if (glyphs !== 'nerd') caps = 'none'
  }
  const separator = raw['separator'] !== undefined && raw['separator'] !== '' ? raw['separator'] : theme['separator'] ?? ' │ '
  const view: View = {
    shape: pick('shape', 'plain'),
    caps,
    glyphs,
    fill: pick('fill', 'none'),
    barPair,
    barWidthMode: Number.isFinite(widthNum) && widthNum > 0 ? 'cells' : 'adaptive',
    barWidthCells: Number.isFinite(widthNum) && widthNum > 0 ? widthNum : 10,
    paletteName,
    pal: PALETTES[paletteName] ?? PALETTES['semantic']!,
    thresholds: parseThresholds(pick('thresholds', '50,75')),
    face: parseFace(pick('face', '')),
    border: pick('border', 'none'),
    overflow: pick('overflow', 'evict'),
    align: pick('align', 'left'),
    separator: glyphs === 'ascii' ? asciiOnly(separator) : separator,
    placement: raw['placement'] === 'hint' ? 'hint' : 'above',
    details: raw['details'] === 'off' ? 'off' : 'hover',
  }
  return { view, themeName, unknown }
}

function asciiOnly(s: string): string {
  // the ASCII rule touches decorations, never the data values (§14.5.1)
  let out = ''
  for (const ch of s) out += ch.length === 1 && ch.charCodeAt(0) < 128 ? ch : '?'
  return out.replace(/\?+/g, (run) => (run.length > 1 ? '-' : '|'))
}

// ---------- layout presets (Р2: the HUD default plus four) ----------

type Seg = { id: string; body: string }

function lineOf(ids: string[]): Seg[] {
  return ids.map((id) => ({ id, body: '{' + id + '.text}' }))
}

export function presetLines(name: string): Seg[][] {
  if (name === 'one') return [lineOf(['git-branch', 'model', 'ctx', 'five-hour-limit', 'weekly-limit', 'session', 'cost'])]
  if (name === 'two')
    return [lineOf(['model', 'git-branch', 'ver', 'dur', 'cost']), lineOf(['ctx', 'five-hour-limit', 'weekly-limit'])]
  if (name === 'powerline') return [lineOf(['model', 'git-branch', 'github', 'ctx', 'sum', 'cost', 'session'])]
  if (name === 'minimum') return [lineOf(['model', 'ctx'])]
  // the default: the claude-hud layout of DESIGN Р2
  return hudLines()
}

function hudLines(): Seg[][] {
  return [
    lineOf(['model', 'git-branch', 'ver', 'dur', 'cost']),
    lineOf(['ctx']),
    lineOf(['ram']),
    lineOf(['cfg']),
    lineOf(['tools']),
    lineOf(['ag']),
    lineOf(['todo']),
    lineOf(['tokens-total']),
  ]
}

export const LAYOUT_PRESETS: { id: string; label: string }[] = [
  { id: 'hud', label: 'HUD' },
  { id: 'one', label: 'Одна строка' },
  { id: 'two', label: 'Две строки' },
  { id: 'powerline', label: 'Powerline' },
  { id: 'minimum', label: 'Минимум' },
]

// ---------- template engine (SPEC §13.2, §14.3 — kept from 0.4.0) ----------

const now = (): number => (globalThis as any).performance?.now?.() ?? Date.now()

// Feeds and refusal deadlines share one stamp. A refused $.clock.now keeps the
// previous stamp so a deadline is not moved by the refusal itself.
let clockMs = 0
async function readClock($: EngineInterface): Promise<number> {
  const g = S.gen
  try {
    const t = await $.clock.now()
    if (typeof t === 'number' && Number.isFinite(t)) {
      clockMs = t
      // the clock flags belong to the state that asked; a newer state reads its own (SPEC §13.4)
      if (!live(g)) return clockMs
      // clockFailed is a picture input: only the transitions dirty it, a steady
      // read must not block the clock-tick skip (FIX2c п.3)
      if (S.clockFailed) markPicture()
      S.clockFailed = false
      return clockMs
    }
  } catch (x) {
    if (!live(g)) return clockMs
    failDiag('warn', 'clock-now', 'clock.now refused: ' + safeText(x))
    if (!S.clockFailed) markPicture()
    S.clockFailed = true
  }
  return clockMs
}

// message, name and String() each in their own try: a throwing toString must not escape.
function safeText(x: unknown): string {
  let msg = ''
  let name = ''
  let full = ''
  let threw = false
  try {
    const m = (x as { message?: unknown }).message
    msg = typeof m === 'string' ? m : ''
  } catch {
    threw = true
    msg = ''
  }
  try {
    const n = (x as { name?: unknown }).name
    name = typeof n === 'string' ? n : ''
  } catch {
    threw = true
    name = ''
  }
  try {
    full = String(x)
  } catch {
    threw = true
    full = ''
  }
  const objecty = full.startsWith('[object')
  if (name !== '' && name !== 'Error' && full !== '' && !objecty && (msg === '' || full.includes(msg))) return full
  if (msg !== '') return name !== '' ? name + ': ' + msg : msg
  if (name !== '') return name
  if (msg !== '' || full !== '') return msg || full
  return threw ? 'unprintable error' : '(empty error)'
}

const errorText = (error: unknown): string => safeText(error)
const pluginName = (name: string) => name.split('@')[0]

type VarState = 'ok' | 'pending' | 'stale' | 'absent'
type Var = { v: string; st: VarState }
type Diag = { at: number; kind: string; key: string; text: string }

function splitRuns(s: string, first: string, second: string): string[] {
  // CONSTRAINT: the cut runs BEFORE unescaping and never cuts an escaped pair
  const out: string[] = []
  let cur = ''
  let i = 0
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length) {
      cur += s[i]! + s[i + 1]!
      i += 2
      continue
    }
    if (s[i] === first && s[i + 1] === second) {
      out.push(cur)
      cur = ''
      i += 2
      continue
    }
    cur += s[i]!
    i++
  }
  out.push(cur)
  return out
}

function splitLines(raw: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      cur += raw[i]! + raw[i + 1]!
      i += 2
      continue
    }
    if (raw.startsWith(LINE_SPLIT, i)) {
      out.push(cur)
      cur = ''
      i += LINE_SPLIT.length
      continue
    }
    cur += raw[i]!
    i++
  }
  out.push(cur)
  return out
}

function parseSegment(chunk: string, used: Set<string>, n: number): Seg {
  const m = /^([a-z0-9_-]+)=([\s\S]*)$/.exec(chunk)
  let id = m ? m[1]! : 's' + n
  let body = m ? m[2]! : chunk
  if (!m && REGISTRY_IDS.includes(chunk)) {
    // serializeTemplate writes the body '{id.text}' as the bare id; parse is
    // its inverse, else a preset round-trips into synthetic ids (§14.8-20)
    id = chunk
    body = '{' + chunk + '.text}'
  }
  if (used.has(id)) {
    const uniq = id + '#' + n
    failDiag('warn', 'tpl-dup-id-' + id, "template: duplicate segment id '" + id + "' renamed to '" + uniq + "'")
    id = uniq
  }
  used.add(id)
  return { id, body }
}

export function parseTemplate(raw: string): Seg[][] {
  const lines: Seg[][] = []
  const used = new Set<string>()
  for (const lineChunk of splitLines(raw)) {
    const segs: Seg[] = []
    let n = 0
    for (const chunk of splitRuns(lineChunk, '|', '|')) {
      if (chunk.trim() === '') continue
      n++
      segs.push(parseSegment(chunk, used, n))
    }
    if (segs.length === 0) {
      // an empty layout line is a hole, not a choice: dropped aloud (§14.3)
      failDiag('warn', 'tpl-empty-line', 'template: an empty layout line was dropped')
      continue
    }
    lines.push(segs)
  }
  return lines
}

export function serializeTemplate(lines: Seg[][]): string {
  return lines
    .map((line) => line.map((seg) => (seg.body === '{' + seg.id + '.text}' ? seg.id : seg.id + '=' + seg.body)).join(SEG_SPLIT))
    .join(LINE_SPLIT)
}

export function templateRoundTrip(lines: Seg[][]): Seg[][] {
  return parseTemplate(serializeTemplate(lines))
}

function sameSegs(a: Seg[], b: Seg[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i]!.id && s.body === b[i]!.body)
}

export function sameLayout(a: Seg[][], b: Seg[][]): boolean {
  return a.length === b.length && a.every((l, i) => sameSegs(l, b[i]!))
}

function renderSeg(body: string, vars: Record<string, Var>): { text: string; stale: boolean } | null {
  // CONSTRAINT (SPEC §13.2 rule 2): a segment is an ATOM. One absent variable
  // removes it whole; '…' and '~' never remove it.
  let out = ''
  let anyStale = false
  let i = 0
  while (i < body.length) {
    const c = body[i]!
    if (c === '\\' && (body[i + 1] === '|' || body[i + 1] === '\\' || body[i + 1] === ';')) {
      out += body[i + 1]!
      i += 2
      continue
    }
    if (c === '{' && body[i + 1] === '{') {
      out += '{'
      i += 2
      continue
    }
    if (c === '}' && body[i + 1] === '}') {
      out += '}'
      i += 2
      continue
    }
    if (c === '{') {
      const close = body.indexOf('}', i + 1)
      if (close < 0) {
        out += c
        i++
        continue
      }
      const name = body.slice(i + 1, close)
      const v = vars[name]
      if (!v) {
        // a typo is visible in the bar and in the diagnostics (§13.6-6)
        failDiag('warn', 'tpl-unknown-' + name, "template: unknown variable '" + name + "'")
        out += '{?' + name + '}'
        i = close + 1
        continue
      }
      if (v.st === 'absent') return null
      if (v.st === 'stale') anyStale = true
      out += v.v
      i = close + 1
      continue
    }
    out += c
    i++
  }
  return { text: out, stale: anyStale }
}

function evictionOrder(declared: string[], present: string[]): string[] {
  // unnamed segments evict AFTER the named ones, else they would never evict
  const inPresent = new Set(present)
  const named = declared.filter((id) => inPresent.has(id))
  const seen = new Set(named)
  const rest = present.filter((id) => !seen.has(id))
  return [...named, ...rest]
}

// CONSTRAINT: skips the same escapes as renderSeg (\\|, \\\\, \\;, {{, }}).
// A scan that did not skip doubled braces would read `{{x.y}}` as the name x.y.
function varNamesOf(body: string): string[] {
  const names: string[] = []
  let i = 0
  while (i < body.length) {
    const c = body[i]!
    if (c === '\\' && (body[i + 1] === '|' || body[i + 1] === '\\' || body[i + 1] === ';')) {
      i += 2
      continue
    }
    if (c === '{' && body[i + 1] === '{') {
      i += 2
      continue
    }
    if (c === '}' && body[i + 1] === '}') {
      i += 2
      continue
    }
    if (c === '{') {
      const close = body.indexOf('}', i + 1)
      if (close < 0) {
        i++
        continue
      }
      names.push(body.slice(i + 1, close))
      i = close + 1
      continue
    }
    i++
  }
  return names
}

// The card names the element the segment body reads, not the segment id:
// a template may name the segment `x` while the body is `{ctx.text}`.
export function elementIdOf(seg: Seg): string {
  for (const name of varNamesOf(seg.body)) {
    const dot = name.indexOf('.')
    if (dot > 0) return name.slice(0, dot)
  }
  return seg.id.split('#')[0]!
}

// Per-line eviction (SPEC §14.3): each line narrows the common order to its
// own segments; the last survivor stays — overflow beats truncation.
function renderLine(line: Seg[], vars: Record<string, Var>, width: number, sep: string, evict: string[], overflow: string): { id: string; elementId: string; text: string; stale: boolean }[] {
  const parts: { id: string; elementId: string; text: string; stale: boolean }[] = []
  for (const seg of line) {
    const r = renderSeg(seg.body, vars)
    if (r) parts.push({ id: seg.id, elementId: elementIdOf(seg), text: r.text, stale: r.stale })
  }
  if (overflow === 'wrap') return parts
  const kept = new Set(parts.map((p) => p.id))
  const assemble = (): string => parts.filter((p) => kept.has(p.id)).map((p) => p.text).join(sep)
  const order = evictionOrder(evict, parts.map((p) => p.id))
  const lastSurvivor = order.length > 0 ? order[order.length - 1]! : ''
  for (const id of order) {
    if (assemble().length <= width) break
    if (id === lastSurvivor) break
    if (kept.has(id)) kept.delete(id)
  }
  return parts.filter((p) => kept.has(p.id))
}

// ---------- state ----------

const CAP = { diag: 64 }
const EVICT_ORDER_BASE = ['static', 'ram', 'spd', 'dur', 'cfg', 'style', 'name', 'path', 'directory', 'branch', 'git', 'git-branch', 'github', 'rl', 'five-hour-limit', 'weekly-limit', 'session', 'sum', 'brk', 'cost', 'todo', 'tokens-total', 'ag', 'tools', 'ver', 'ctx', 'route', 'model']

type Tpl = { lines: Seg[][]; sep: string; evict: string[] }
type Cfg = { tpl: Tpl; view: View; themeName: string; rawOptions: Record<string, string>; elements: Record<string, ElemSettings>; userThemes: Record<string, Record<string, string>>; nf: NumberFormat }

type Draft = {
  lines: Seg[][]
  axes: Record<string, string>
  elements: Record<string, ElemSettings>
  focus: { line: number; seg: number } | null
  tab: string
  query: string
  fam: string
  targetLine: number
  themeName: string
}

type TimerRun = { key: string; every: number; lastTick: number; cancel: () => void }

type State = {
  famStates: Map<Collector<unknown>, unknown>
  cfg: Cfg
  diag: Diag[]
  diagLogged: number
  // CONSTRAINT (S1-FIX4 П.6): records evicted from diag while unshipped;
  // flushDiag ships the count as ONE overflow line and zeroes it.
  diagDropped: number
  diagOnce: Set<string>
  drawnKey: string | undefined
  refreshesBegun: number
  refreshShown: number
  surveyDiag: boolean
  interactive: boolean
  started: boolean
  restored: boolean
  statusCleared: boolean
  messagesDone: boolean
  pickerOpen: boolean | undefined
  pickerSession: string
  draft: Draft | null
  follows: number
  moves: number
  actions: Promise<unknown>
  saving: { fields: string[]; values: Record<string, string> } | null
  saveResult: string
  themeNote: string
  lastMaxRows: number
  userThemes: Record<string, Record<string, string>>
  reloadOptions: Record<string, string>
  // CONSTRAINT (S1-FIX4 П.2): the host's raw truth as applyDecided last saw
  // it, plus the stored lastGood that decision used; the picker's save
  // re-decides from these, never from the applied build.
  hostRaw: Record<string, string>
  lastGood: Record<string, string> | undefined
  // CONSTRAINT (S1-FIX4 П.5): the sync chain is state, not a module binding —
  // __resetState must start a fresh one (F6b reads it through __stateSnapshot).
  syncChain: Promise<void>
  // CONSTRAINT (S1-FIX5 П.1, S1-FIX6 П.3): the one restore of this state;
  // every picker action, the picker's open, its close and reset wait on it —
  // an action inside the restore window would decide from a state restore
  // overwrites. Restore assigns pickerOpen and the draft together, after its
  // last await: no render sees the pane open without its stored draft.
  restoring: Promise<void>
  // CONSTRAINT (S1-FIX6 П.1): the state's generation, from a module counter
  // that only grows. Every async operation captures it at its start and,
  // after each await, writes neither S nor the store when it has changed —
  // a wipe (register, __resetState) inside an operation would otherwise land
  // the old operation's writes in the new state (lastGood {__raw:{}}).
  gen: number
  // CONSTRAINT (S1-FIX5 П.2): the stored user themes could not be read — an
  // unknown theme name is then not the user's breakage, lastGood is not
  // re-stored and the theme save refuses (it would overwrite every saved theme).
  themesFailed: boolean
  timers: Map<string, TimerRun>
  timerRefused: Map<string, number>
  clockFailed: boolean
  pictureDirty: boolean
  pictureBucket: string
  home: string
  transcriptPath: string
}

// CONSTRAINT (S1-FIX3 F6): the declaration-time value of the WHOLE state —
// the module init and the stand's __resetState share this one factory.
function freshState(): State {
  return {
    famStates: new Map(),
    cfg: { tpl: { lines: [], sep: ' │ ', evict: EVICT_ORDER_BASE.slice() }, view: {} as View, themeName: 'hud', rawOptions: {}, elements: {}, userThemes: {}, nf: buildNf({}) },
    diag: [],
    diagLogged: 0,
    diagDropped: 0,
    diagOnce: new Set(),
    drawnKey: undefined,
    refreshesBegun: 0,
    refreshShown: 0,
    surveyDiag: false,
    interactive: false,
    started: false,
    restored: false,
    statusCleared: false,
    messagesDone: false,
    pickerOpen: undefined,
    pickerSession: '',
    draft: null,
    follows: 0,
    moves: 0,
    actions: Promise.resolve(),
    saving: null,
    saveResult: '',
    themeNote: '',
    lastMaxRows: 8,
    userThemes: {},
    reloadOptions: {},
    hostRaw: {},
    lastGood: undefined,
    syncChain: Promise.resolve(),
    restoring: Promise.resolve(),
    gen: 0,
    themesFailed: false,
    timers: new Map(),
    timerRefused: new Map(),
    clockFailed: false,
    pictureDirty: true,
    pictureBucket: '',
    home: '',
    transcriptPath: '',
  }
}

const S: State = freshState()

let generation = 0

// every wipe of S goes through here: the new state gets a generation no
// operation begun before the wipe holds
function wipeState(): void {
  for (const timer of S.timers.values()) {
    try { timer.cancel() } catch { /* a refused cancel must not keep a stale timer armed */ }
  }
  Object.assign(S, freshState())
  S.gen = ++generation
}

function live(g: number): boolean {
  return S.gen === g
}

// an operation that outlived its state is dropped aloud (SPEC §13.4)
function staleDrop(what: string): void {
  failDiag('warn', 'stale-' + what, what + ': begun before the state was reset; dropped, the new state decides for itself')
}

// CONSTRAINT (BRIEF-v0.5-S1-FIX2c п.3): the only write site of pictureDirty.
// Direct assignment stands in freshState() (the initial state and __resetState
// share it) alone.
function markPicture(): void {
  S.pictureDirty = true
}

// The diag buffer is module-level: family-less pure helpers (parse, resolve)
// record into it without a `$` in reach; flushDiag ships it to the debug log.
// CONSTRAINT (S1-FIX3 F-diag): the band does not draw S.diag; an element that
// starts drawing it must make it a picture input.
function failDiag(kind: string, key: string, text: string): void {
  if (kind !== 'fail' && S.diagOnce.has(key)) return
  if (kind !== 'fail') S.diagOnce.add(key)
  S.diag.push({ at: now(), kind, key, text })
  if (S.diag.length > CAP.diag) {
    S.diag.shift()
    // the evicted record may already be shipped; the flush pointer must not
    // walk past the unshipped tail (S1-FIX3 F8)
    if (S.diagLogged > 0) S.diagLogged--
    else S.diagDropped++
  }
}

function infoDiag(key: string, text: string): void {
  failDiag('info', key, text)
}

async function quiet(fn: () => Promise<void>): Promise<void> {
  // SPEC §10.4: a failure leaves the previous value standing
  try {
    await fn()
  } catch {
    /* collector failures surface via diag + staleness */
  }
}

function invalidate($: EngineInterface): void {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    /* redraw is best effort */
  }
}

function flushDiag($: EngineInterface): void {
  // CONSTRAINT (S1-FIX4 П.6): a log that throws must NOT zero the counter —
  // otherwise the dropped records would be forgotten silently.
  if (S.diagDropped > 0) {
    try {
      $.ui.log('[statusline] fail: diag overflow dropped ' + S.diagDropped + ' unsent record(s)', { to: 'debug' })
    } catch {
      return
    }
    S.diagDropped = 0
  }
  while (S.diagLogged < S.diag.length) {
    const d = S.diag[S.diagLogged]!
    // CONSTRAINT (S1-FIX5 П.8): the pointer moves only past a shipped record —
    // a refused log leaves it for the next flush.
    try {
      $.ui.log('[statusline] ' + d.kind + ': ' + d.text, { to: 'debug' })
    } catch {
      return
    }
    S.diagLogged++
  }
}

function famState(fam: Collector<unknown>): unknown {
  let st = S.famStates.get(fam)
  if (st === undefined) {
    st = fam.init()
    S.famStates.set(fam, st)
  }
  return st
}

function capDroppedOf(state: unknown): number {
  if (!state || typeof state !== 'object') return 0
  const tools = (state as { tools?: { capDropped?: unknown } }).tools
  return tools && typeof tools.capDropped === 'number' ? tools.capDropped : 0
}

function feed(fam: Collector<unknown>, input: Input): void {
  // CONSTRAINT (FIX2c п.3): a family input that arrives WITHOUT its own
  // redraw('other') must dirty the picture. cmd/file/transcript feeds are
  // followed by the timer run's 'other' redraw; clock feeds are covered by
  // the bucket, because clockBucket samples every placed element of a
  // clock-bearing family through entryIds (S1-FIX3 F1); env/event/session
  // feeds reach no redraw until the next tick.
  const k = input.source.kind
  if (k !== 'clock' && k !== 'cmd' && k !== 'file' && k !== 'transcript') markPicture()
  const before = capDroppedOf(S.famStates.get(fam))
  const next = fam.reduce(famState(fam), input)
  S.famStates.set(fam, next)
  const after = capDroppedOf(next)
  if (after > before) failDiag('warn', 'tools-cap', 'active tools over cap, dropped ' + String(after))
}

// ---------- values and composition ----------

function variantOf(def: ElementDef, elements: Record<string, ElemSettings>): string {
  return settingOf(elements, def.id, 'v') ?? def.variants[0]!.id
}

export function valueOf(id: string, variant: string | undefined, elements: Record<string, ElemSettings>, nf: NumberFormat): { def: ElementDef; value: Value } | null {
  const entry = REG.byId.get(id)
  if (!entry) return null
  const def = entry.def
  const v = variant ?? variantOf(def, elements)
  const owner = resolveVariantOwner(REG, id, v) ?? entry.owner
  const value = owner.value(famState(entry.owner), id, { variant: v, options: optionsOf(def, elements), nf })
  return { def, value }
}

// The HUD-faithful default labels (DESIGN Р2): 'Context', 'Approx RAM',
// 'Cost', 'CC v', 'Tokens'; the rest draw their label from their own value.
const DEFAULT_LABEL: Record<string, string> = {
  ctx: 'Context', ram: 'Approx RAM', cost: 'Cost', dur: 'up', ver: 'CC', 'tokens-total': 'Tokens', style: 'style', brk: 'bd', sum: '', model: '', git: '', 'git-branch': '', directory: '', branch: '', github: '', 'five-hour-limit': '', 'weekly-limit': '', session: '', todo: '', ag: '', tools: '', path: '', static: '', spd: '', rl: '', cfg: '', name: '', route: '',
}

const GLYPHS: Record<string, Record<string, string>> = {
  dur: { ascii: 'T', unicode: '⏱', emoji: '⏱', nerd: '\u{F017}' },
}

const ROW_ICON: Record<string, string> = { ok: '✓', run: '◐', fail: '✗', todo: '▸', info: 'ℹ' }

function iconOf(id: string, elements: Record<string, ElemSettings>, glyphs: string): string {
  const table = GLYPHS[id]
  if (!table) return ''
  const set = settingOf(elements, id, 'ic') ?? (table['unicode'] !== undefined ? 'unicode' : 'none')
  if (set === 'none') return ''
  const g = glyphs === 'ascii' ? table['ascii'] : table[set === 'none' ? 'unicode' : set] ?? table['unicode']
  return g ?? ''
}

function barCellsOf(view: View, elements: Record<string, ElemSettings>, id: string): number {
  const w = settingOf(elements, id, 'bw')
  if (w === 'auto' || w === undefined) return view.barWidthMode === 'cells' ? view.barWidthCells : view.separator.length > 2 ? 4 : 10
  const n = Number(w)
  return Number.isFinite(n) && n > 0 ? n : 10
}

function barPairOf(view: View, elements: Record<string, ElemSettings>, id: string): [string, string] {
  const p = settingOf(elements, id, 'bp')
  if (p && [...p].length === 2) {
    const pair = [...p] as [string, string]
    if (view.glyphs === 'ascii' && !isAsciiPair(pair)) return BAR_PAIRS['ascii']!
    return pair
  }
  return view.barPair
}

function barGlyphs(ratio: number, view: View, elements: Record<string, ElemSettings>, id: string): string {
  const cells = barCellsOf(view, elements, id)
  const pair = barPairOf(view, elements, id)
  const fill = Math.max(0, Math.min(cells, Math.round(ratio * cells)))
  return pair[0]!.repeat(fill) + pair[1]!.repeat(cells - fill)
}

type Composed = { text: string; stale: boolean; pending: boolean; ratio?: number }

function composeElement(id: string, v: Value, elements: Record<string, ElemSettings>, view: View, nf: NumberFormat): Composed | null {
  const entry = REG.byId.get(id)
  if (!entry) return null
  const def = entry.def
  if (v.state === 'nosource') return null
  const labelMode = settingOf(elements, id, 'lb') ?? (DEFAULT_LABEL[id] !== undefined && DEFAULT_LABEL[id] !== '' ? 'on' : 'off')
  const label = labelMode === 'off' ? '' : labelMode === 'text' ? settingOf(elements, id, 'lt') ?? '' : DEFAULT_LABEL[id] ?? ''
  const icon = iconOf(id, elements, view.glyphs)
  const prefix = [label, icon].filter(Boolean).join(' ')
  if (v.state === 'pending') return { text: prefix + '…', stale: false, pending: true }
  const markStale = (text: string): Composed => ({ text: text + '~', stale: true, pending: false })
  const meterText = (text: string, ratio: number | undefined): string => {
    const join = (parts: string[]): string => ((prefix ? prefix + ' ' : '') + parts.filter(Boolean).join(' ')).trim()
    if (ratio === undefined) return join([text])
    const show = settingOf(elements, id, 'bs') ?? 'all'
    if (show === 'percent') return join([nf.percent(ratio)])
    const parts: string[] = []
    if (show === 'bar' || show === 'all') parts.push(barGlyphs(ratio, view, elements, id))
    if (show === 'value' || show === 'all') parts.push(text)
    // a percent-variant element already carries the percent as its value
    if (show === 'all' && text !== nf.percent(ratio)) parts.push(nf.percent(ratio))
    return join(parts)
  }
  if (v.state === 'ok') return { text: def.kind === 'meter' ? meterText(v.text, v.ratio) : ((prefix ? prefix + ' ' : '') + v.text).trim(), stale: false, pending: false, ratio: v.ratio }
  if (v.state === 'stale') return markStale(def.kind === 'meter' ? meterText(v.last.text, v.last.ratio) : ((prefix ? prefix + ' ' : '') + v.last.text).trim())
  return { text: ((prefix ? prefix + ' ' : '') + v.text).trim(), stale: false, pending: false, ratio: v.state === 'ok' ? v.ratio : undefined }
}

// The variable dictionary the template engine reads: one entry per element.
function buildVars(elements: Record<string, ElemSettings>, view: View, nf: NumberFormat): Record<string, Var> {
  const vars: Record<string, Var> = {}
  for (const id of REGISTRY_IDS) {
    const got = valueOf(id, undefined, elements, nf)
    if (!got) {
      vars[id + '.text'] = { v: '', st: 'absent' }
      continue
    }
    const comp = composeElement(id, got.value, elements, view, nf)
    if (comp === null) vars[id + '.text'] = { v: '', st: 'absent' }
    else if (comp.pending) vars[id + '.text'] = { v: comp.text, st: 'pending' }
    else vars[id + '.text'] = { v: comp.text, st: comp.stale ? 'stale' : 'ok' }
  }
  return vars
}

function detailOf(id: string, elements: Record<string, ElemSettings>, nf: NumberFormat): string {
  const got = valueOf(id, undefined, elements, nf)
  if (!got) return id + ' (unknown element)'
  const v = got.value
  const parts: string[] = [id]
  if (v.state === 'ok') {
    parts.push('text=' + v.text)
    if (v.num !== undefined) parts.push('num=' + String(v.num))
    if (v.unit !== undefined) parts.push('unit=' + v.unit)
    if (v.ratio !== undefined) parts.push('ratio=' + nf.percent(v.ratio))
    if (id === 'git-branch') {
      const rm = /^(.*)\(([^()]*)\)$/.exec(v.text)
      if (rm && rm[1]) {
        parts.push('repo=' + rm[1])
        parts.push('ref=' + rm[2])
      }
    }
  } else if (v.state === 'pending') parts.push('(no data yet)')
  else if (v.state === 'stale') parts.push('УСТАРЕЛО~ ' + v.last.text + ' (' + v.reason + ')')
  else parts.push('(no source: ' + v.reason + ')')
  return parts.join(' ')
}

// list rows: each list element draws its rows as its own lines (Р2)
function listRowsOf(id: string, elements: Record<string, ElemSettings>, nf: NumberFormat): { id: string; elementId: string; text: string; stale: boolean }[] {
  const got = valueOf(id, undefined, elements, nf)
  if (!got || got.value.state !== 'ok' || !got.value.rows) return []
  const max = typeof optionsOf(got.def, elements)['maxRows'] === 'number' ? (optionsOf(got.def, elements)['maxRows'] as number) : 3
  const out: { id: string; elementId: string; text: string; stale: boolean }[] = []
  got.value.rows.slice(0, max).forEach((r: Row, i: number) => {
    const icon = r.icon ? ROW_ICON[r.icon] ?? '' : ''
    const text = (icon ? icon + ' ' : '') + r.label + (r.detail ? ': ' + r.detail : '') + (r.right ? ' (' + r.right + ')' : '')
    out.push({ id: id + '#' + i, elementId: id, text, stale: false })
  })
  return out
}

type DrawSeg = { id: string; elementId: string; text: string; stale: boolean }

function drawLines(vars: Record<string, Var>, tpl: Tpl, view: View, elements: Record<string, ElemSettings>, width: number, maxRows: number, nf: NumberFormat): DrawSeg[][] {
  const out: DrawSeg[][] = []
  let dropped = 0
  for (const line of tpl.lines) {
    if (out.length >= maxRows) {
      dropped++
      continue
    }
    const inline: Seg[] = []
    const lists: string[] = []
    for (const seg of line) {
      const entry = REG.byId.get(seg.id)
      if (entry && entry.def.kind === 'list') lists.push(seg.id)
      else inline.push(seg)
    }
    if (inline.length > 0) {
      const drawn = renderLine(inline, vars, width, tpl.sep, tpl.evict, view.overflow)
      if (drawn.length > 0) {
        if (out.length >= maxRows) dropped++
        else out.push(drawn)
      }
    }
    for (const listId of lists) {
      const rows = listRowsOf(listId, elements, nf)
      if (rows.length === 0) {
        const seg: Seg = { id: listId, body: '{' + listId + '.text}' }
        const drawn = renderLine([seg], vars, width, tpl.sep, tpl.evict, view.overflow)
        if (drawn.length > 0) {
          if (out.length >= maxRows) dropped++
          else out.push(drawn)
        }
        continue
      }
      for (const row of rows) {
        if (out.length >= maxRows) {
          dropped++
          break
        }
        out.push([{ id: row.id, elementId: listId, text: row.text, stale: false }])
      }
    }
  }
  if (dropped > 0) failDiag('fail', 'lines-over-limit', 'template: ' + dropped + ' line(s) beyond maxRows=' + maxRows + ' not drawn')
  return out
}

// ---------- bar tree (one builder for the band and the preview, §14.6.5) ----------

type Table = { Box: (props: Record<string, unknown>) => unknown; Text: (props: Record<string, unknown>) => unknown }

function faceProps(role: 'label' | 'value' | 'alert', face: Record<string, string>): Record<string, unknown> {
  const style = face[role] ?? ''
  const props: Record<string, unknown> = {}
  if (style === 'bold') props['bold'] = true
  else if (style === 'italic') props['italic'] = true
  else if (style === 'underline') props['underline'] = true
  else if (style === 'strikethrough') props['strikethrough'] = true
  else if (style === 'inverse') props['inverse'] = true
  else if (style === 'dim') props['dimColor'] = true
  // blink and hover need support the terminal band has not measured: plain
  // text with a visible state, never a lost value (§14.5.1 face degradation)
  return props
}

const THRESHOLD_IDS = new Set(['ctx', 'five-hour-limit', 'weekly-limit', 'rl', 'ram'])
const SLOT_OF: Record<string, keyof Pal> = {
  model: 'model', path: 'path', directory: 'path', 'git-branch': 'path', branch: 'branch', git: 'branch',
  github: 'github', cost: 'cost', session: 'session', ag: 'agents', tools: 'tools',
}

function colorOf(id: string, view: View): string | undefined {
  const slot = SLOT_OF[id]
  return slot ? view.pal[slot] : undefined
}

function thresholdColor(ratio: number, view: View): string | undefined {
  const pct = ratio * 100
  return pct >= view.thresholds[1] ? view.pal.high : pct >= view.thresholds[0] ? view.pal.mid : view.pal.ok
}

// Percent-bearing elements paint by their own scale unless the element's own
// colour says otherwise; the scale is the data (SPEC §14.10).
function segColor(id: string, seg: DrawSeg, ratio: number | undefined, elements: Record<string, ElemSettings>, view: View): string | undefined {
  const own = settingOf(elements, id, 'c')
  if (own === 'threshold') return ratio !== undefined ? thresholdColor(ratio, view) : colorOf(id, view)
  if (own && (own.startsWith('#') || COLOR_NAMES.has(own))) return own
  if (ratio !== undefined && THRESHOLD_IDS.has(id)) return thresholdColor(ratio, view)
  return colorOf(id, view)
}

function ratioOf(id: string, elements: Record<string, ElemSettings>, nf: NumberFormat): number | undefined {
  const got = valueOf(id, undefined, elements, nf)
  if (got && got.value.state === 'ok') return got.value.ratio
  if (got && got.value.state === 'stale') return got.value.last.ratio
  return undefined
}

function segmentText(seg: DrawSeg, view: View, table: Table, details: boolean, color: string | undefined): unknown {
  const props: Record<string, unknown> = { children: [seg.text], wrap: 'truncate' }
  if (details) props['hover'] = { scope: 'sl-' + seg.id.split('#')[0]!, bold: true, underline: true }
  const mono = view.paletteName === 'mono'
  if (color && !mono) props['color'] = color
  if (mono || seg.stale) props['dimColor'] = true
  if (view.fill === 'inverse') props['inverse'] = true
  if (view.fill === 'segment' && color && !mono) props['backgroundColor'] = color
  Object.assign(props, faceProps('value', view.face))
  return table.Text(props)
}

function capPair(view: View): [string, string] | null {
  const pair = CAP_PAIRS[view.caps]
  if (!pair) return null
  if (view.glyphs === 'ascii') return null
  if ((view.caps === 'round' || view.caps === 'arrow') && view.glyphs !== 'nerd') return null
  return pair
}

function joinText(view: View, table: Table, isLast: boolean): unknown {
  if (isLast) return null
  if (view.shape === 'lean') return table.Text({ children: [' '], wrap: 'truncate' })
  if (view.shape === 'pill' || view.shape === 'powerline') {
    const pair = capPair(view)
    if (view.shape === 'powerline') return table.Text({ children: [pair ? pair[0] : ' '], color: view.pal.sep, wrap: 'truncate' })
    return table.Text({ children: [view.separator || ' '], color: view.pal.sep, dimColor: view.paletteName === 'mono' || !view.pal.sep, wrap: 'truncate' })
  }
  return table.Text({ children: [view.separator], color: view.pal.sep, dimColor: view.paletteName === 'mono' || !view.pal.sep, wrap: 'truncate' })
}

function wrapSegment(seg: DrawSeg, color: string | undefined, view: View, table: Table, details: boolean): unknown {
  const inner = segmentText(seg, view, table, details, color)
  if (view.shape === 'plain' || view.shape === 'lean') return inner
  const pair = capPair(view)
  const children: unknown[] = []
  if (view.shape === 'pill') children.push(table.Text({ children: [' '], wrap: 'truncate' }))
  if (pair) children.push(table.Text({ children: [pair[0]], color: view.pal.sep, wrap: 'truncate' }))
  children.push(inner)
  if (pair) children.push(table.Text({ children: [pair[1]], color: view.pal.sep, wrap: 'truncate' }))
  if (view.shape === 'pill') children.push(table.Text({ children: [' '], wrap: 'truncate' }))
  const boxProps: Record<string, unknown> = { key: 'segbox:' + seg.id, flexDirection: 'row', flexShrink: 0, children }
  const wantsBg = view.shape === 'powerline' || (view.shape === 'pill' && (view.fill === 'segment' || view.fill === 'band')) || ((view.fill === 'segment' || view.fill === 'band') && view.shape === 'classic')
  if (wantsBg && color && view.paletteName !== 'mono') boxProps['backgroundColor'] = color
  return table.Box(boxProps)
}

export function buildBarTree(lines: DrawSeg[][], view: View, width: number, table: Table, details: boolean, detailOfId: (id: string) => string, elements: Record<string, ElemSettings>, nf: NumberFormat): unknown {
  const rows: unknown[] = []
  lines.forEach((line, li) => {
    const segs: unknown[] = []
    line.forEach((seg, i) => {
      if (i > 0) {
        const join = joinText(view, table, false)
        if (join !== null) segs.push(join)
      }
      const color = segColor(seg.id.split('#')[0]!, seg, ratioOf(seg.id.split('#')[0]!, elements, nf), elements, view)
      segs.push(wrapSegment(seg, color, view, table, details))
    })
    const rowProps: Record<string, unknown> = { flexDirection: 'row', flexShrink: 0, children: segs }
    if (view.fill === 'band') rowProps['backgroundColor'] = view.pal.path
    if (view.align === 'right') rowProps['justifyContent'] = 'flex-end'
    else if (view.align === 'center') rowProps['justifyContent'] = 'center'
    else if (view.align === 'split' && line.length > 1) rowProps['justifyContent'] = 'space-between'
    rows.push(table.Box(rowProps))
    if (details) {
      for (const seg of line) {
        rows.push(
          table.Box({
            position: 'absolute',
            top: -1 - li,
            left: 0,
            display: 'none',
            hover: { scope: 'sl-' + seg.id.split('#')[0]!, display: 'flex' },
            children: [table.Text({ children: [' ' + detailOfId(seg.elementId || seg.id.split('#')[0]!) + ' '], wrap: 'truncate' })],
          }),
        )
      }
    }
  })
  const barProps: Record<string, unknown> = { flexDirection: 'column', children: rows }
  if (view.border === 'single' || view.border === 'double' || view.border === 'round') {
    barProps['borderStyle'] = view.border
    if (view.glyphs === 'ascii') barProps['borderStyle'] = 'single'
  }
  return table.Box(barProps)
}

// ---------- options parse + reload restore (SPEC §14.7) ----------

const OPTION_FIELDS = [...ALL_AXES, 'template', 'separator', 'evictOrder', 'elements', 'theme', ...NUM_FIELDS.map((f) => f.field)]

function rawOptionsOf(options: PluginOptions): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of OPTION_FIELDS) {
    const v = (options as Record<string, unknown>)[f]
    if (typeof v === 'string') out[f] = v
    else if (typeof v === 'number') out[f] = String(v)
  }
  return out
}

// CONSTRAINT (S1-FIX4 П.1): `broken` is THIS build's own result — the reload
// decision never re-reads the diagnosis buffer. provisional suppresses only
// theme-unknown: the stored themes are not loaded at register.
// CONSTRAINT (S1-FIX5 П.4): template-fallback is written at the FIRST build
// that sees the broken text (a session where restore never runs still names
// it, SPEC §13.4) and once per template text within the state.
function applyOptions(raw: Record<string, string>, opts?: { provisional?: boolean }): { broken: boolean } {
  const provisional = opts?.provisional === true
  const tplRaw = raw['template'] ?? ''
  let lines = tplRaw.trim() ? parseTemplate(tplRaw) : []
  const tplBroken = tplRaw.trim() !== '' && lines.length === 0
  const onceKey = 'template-fallback\u0000' + tplRaw
  if (tplBroken && !S.diagOnce.has(onceKey)) {
    S.diagOnce.add(onceKey)
    // a broken config is replaced aloud, never silently (SPEC §13.4)
    // CONSTRAINT (S1-FIX6 AR-3): the text names the breakage, not the build —
    // the build that stands is named by lastgood-applied / lastgood-broken.
    failDiag('fail', 'template-fallback', 'template parsed to zero lines; the default template applies unless the last good configuration does (lastgood-applied)')
  }
  if (lines.length === 0) lines = presetLines('hud')
  const sep = raw['separator'] && raw['separator'] !== '' ? raw['separator'] : undefined
  const evict = raw['evictOrder'] && raw['evictOrder'].trim() !== '' ? raw['evictOrder'].split(',').map((x) => x.trim()).filter(Boolean) : EVICT_ORDER_BASE.slice()
  const { view, themeName, unknown } = resolveView(raw, S.userThemes, !provisional && !S.themesFailed)
  const elements = parseElements(raw['elements'] ?? '')
  S.cfg = { tpl: { lines, sep: sep ?? view.separator, evict }, view, themeName, rawOptions: raw, elements, userThemes: S.userThemes, nf: buildNf(raw) }
  markPicture() // options/layout/elements/theme are picture inputs with no redraw of their own (FIX2b п.2а)
  return { broken: tplBroken || (unknown && !S.themesFailed) }
}

// CONSTRAINT (S1-FIX4 П.2): the ONLY home of the reload decision — restore and
// the picker's theme save decide through here, identically. A broken config
// with no lastGood is never stored: it must not become the next session's
// "good" (step 5 of the same brief item).
// Every caller checks live(g) with no await between the check and the call;
// g guards the writes after this function's own await.
async function applyDecided($: EngineInterface, raw: Record<string, string>, lastGood: Record<string, string> | undefined, g: number): Promise<void> {
  S.hostRaw = raw
  S.lastGood = lastGood
  const { broken } = applyOptions(raw)
  if (broken && lastGood) {
    const fallback = applyOptions(lastGood)
    if (fallback.broken) {
      // CONSTRAINT (S1-FIX5 П.3): the stored lastGood is broken as well — the
      // band stands on its build with the defaults where it breaks; saying
      // "the last good configuration applies" there would be false.
      failDiag('fail', 'lastgood-broken', 'broken config, and the stored last good configuration is broken too; the defaults apply where it breaks')
    } else {
      failDiag('fail', 'lastgood-applied', 'broken config: the last good configuration applies')
    }
    S.cfg.rawOptions = raw
    return
  }
  if (!broken && !S.themesFailed) {
    try {
      await $.store.set(STORE_LASTGOOD, { __raw: raw })
    } catch (err) {
      // CONSTRAINT (S1-FIX6 П.6): the next session falls back to the older
      // lastGood — said aloud, never silently (SPEC §13.4)
      if (live(g)) failDiag('fail', 'lastgood-write', 'the last good configuration could not be stored: ' + errorText(err) + '; a later broken config falls back to the one stored before')
    }
    if (live(g)) S.lastGood = raw
  }
}

// CONSTRAINT (S1-FIX6 П.2): the one reader of the stored themes — restore and
// the retry in the picker's open and theme save read through here, so a
// transient refusal is cleared by the next successful read.
async function readThemes($: EngineInterface, g: number): Promise<'ok' | 'failed' | 'stale'> {
  try {
    const themes = await $.store.get(STORE_THEMES)
    if (!live(g)) return 'stale'
    S.userThemes = themes && typeof themes === 'object' ? (themes as Record<string, Record<string, string>>) : {}
    S.themesFailed = false
    return 'ok'
  } catch (err) {
    if (!live(g)) return 'stale'
    S.themesFailed = true
    failDiag('fail', 'themes-read', 'user themes could not be read: ' + errorText(err) + '; saved theme names fall back to the default theme, and neither the last good configuration nor a theme is stored')
    return 'failed'
  }
}

export async function restoreAfterReload($: EngineInterface, options: PluginOptions): Promise<void> {
  const g = S.gen
  const raw = rawOptionsOf(options)
  let lastGood: Record<string, string> | undefined
  try {
    const stored = await $.store.get(STORE_LASTGOOD)
    if (stored && typeof stored === 'object') lastGood = (stored as { __raw?: Record<string, string> }).__raw
  } catch {
    /* no last good yet */
  }
  if (!live(g)) return staleDrop('restore')
  // CONSTRAINT (S1-FIX3 F3): the stored themes must stand in S.userThemes
  // BEFORE the first applyOptions — a saved user theme is a valid `theme`
  // value on the first build, not a theme-unknown breakage.
  if ((await readThemes($, g)) === 'stale') return staleDrop('restore')
  await applyDecided($, raw, lastGood, g)
  if (!live(g)) return staleDrop('restore')
  try {
    const mark = await $.store.get(STORE_SAVING)
    if (!live(g)) return staleDrop('restore')
    if (mark && typeof mark === 'object') {
      const fields = ((mark as { fields?: string[] }).fields ?? []) as string[]
      const values = ((mark as { values?: Record<string, string> }).values ?? {}) as Record<string, string>
      const unwritten = fields.filter((f) => (raw[f] ?? '') !== (values[f] ?? ''))
      if (unwritten.length === 0) {
        await $.store.delete(STORE_SAVING)
        if (!live(g)) return staleDrop('restore')
        S.saving = null
        S.saveResult = 'сохранено'
      } else {
        S.saving = { fields, values }
        S.saveResult = 'не записано: ' + unwritten.join(', ')
        failDiag('fail', 'save-unwritten', 'save in flight: fields not written: ' + unwritten.join(', '))
      }
    }
  } catch {
    /* mark check is best effort */
  }
  if (!live(g)) return staleDrop('restore')
  let session = ''
  let isOpen = false
  let draft: Draft | null = null
  try {
    const open = await $.store.get(STORE_OPEN)
    if (!live(g)) return staleDrop('restore')
    session = await $.session.id()
    if (!live(g)) return staleDrop('restore')
    isOpen = !!open && typeof open === 'object' && (open as { session?: unknown }).session === session
    if (isOpen) {
      const stored = await $.store.get(STORE_DRAFT)
      if (stored && typeof stored === 'object' && (stored as { session?: unknown }).session === session) draft = draftFrom(stored as Record<string, unknown>)
    }
  } catch {
    isOpen = false
    draft = null
  }
  if (!live(g)) return staleDrop('restore')
  S.pickerSession = session
  S.pickerOpen = isOpen
  if (draft) S.draft = draft
}

// $.session.surfaces never rejects (d.ts:2459-2471); a host or stand without
// the method throws at the call (the resolver law forbids reading $ as a
// value, so no typeof) and answers "no surface", the text path
async function drawsOnSurface($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).length > 0
  } catch {
    return false
  }
}

function draftFrom(d: Record<string, unknown>): Draft | null {
  const lines = Array.isArray(d['lines']) ? (d['lines'] as Seg[][]) : null
  if (!lines) return null
  const axes = d['axes'] && typeof d['axes'] === 'object' ? { ...(d['axes'] as Record<string, string>) } : {}
  const elements = d['elements'] && typeof d['elements'] === 'object' ? { ...(d['elements'] as Record<string, ElemSettings>) } : {}
  return {
    lines,
    axes,
    elements,
    focus: (d['focus'] as { line: number; seg: number } | null) ?? null,
    tab: typeof d['tab'] === 'string' ? d['tab'] : 'layout',
    query: typeof d['query'] === 'string' ? d['query'] : '',
    fam: typeof d['fam'] === 'string' ? d['fam'] : 'all',
    targetLine: typeof d['targetLine'] === 'number' ? (d['targetLine'] as number) : 0,
    themeName: typeof d['themeName'] === 'string' ? d['themeName'] : '',
  }
}

// CONSTRAINT (#363 L1/L2): $ travels only into functions declared at the top
// of this file; the timer bootstrap is one of them.
function ensureStarted($: EngineInterface, defer = false): void {
  if (S.started) return
  S.started = true // the ONLY place timers are created; render never restarts them
  const g = S.gen
  const create = (): void => {
    void quiet(async () => {
      if (!live(g)) return staleDrop('start')
      await runEnvSources($, REG.families, g)
      if (!live(g)) return staleDrop('start')
      await syncSourceTimers($)
      if (!live(g)) return staleDrop('start')
      await refreshQuietly($)
    })
  }
  if (defer) {
    // CONSTRAINT: the module environment declares no timer global — the
    // defer rides a microtask, which lands after the frame's return
    void Promise.resolve().then(create)
  } else {
    create()
  }
}

function ensureRestore($: EngineInterface): void {
  if (S.restored) return
  S.restored = true
  clearStatus($)
  S.restoring = restoreAfterReload($, S.reloadOptions as PluginOptions).catch((err) => {
    failDiag('fail', 'restore', 'reload restore failed: ' + errorText(err))
  })
}

// Р1: the mod never pins a status of its own, and it clears the line at every
// load, session start and session end — the yellow pinned line does not
// survive an upgrade from a build that set one.
function clearStatus($: EngineInterface): void {
  if (S.statusCleared) return
  S.statusCleared = true
  try {
    $.ui.status(undefined)
  } catch {
    /* the noun may be absent on a surface; the clear is defensive */
  }
}

// ---------- source engine (events, session reads, cmd/file/clock timers) ----------

function savedIds(): Set<string> {
  const ids = new Set<string>()
  for (const line of S.cfg.tpl.lines) for (const seg of line) {
    ids.add(seg.id.split('#')[0]!)
    for (const name of varNamesOf(seg.body)) {
      const dot = name.indexOf('.')
      if (dot > 0) ids.add(name.slice(0, dot))
    }
  }
  return ids
}

// CONSTRAINT (T15): registry source objects are module-level constants, so the
// canonical key of a repeated object is computed once. dispatch() probes every
// family on every tick; recomputing canon+stringify there was the per-tick cost.
const sourceKeyMemo = new WeakMap<object, string>()

function sourceKey(source: Source): string {
  const memo = sourceKeyMemo.get(source as unknown as object)
  if (memo !== undefined) return memo
  const key = canonicalSource(source)
  sourceKeyMemo.set(source as unknown as object, key)
  return key
}

function canonicalSource(source: Source): string {
  // canonical form: the key order of the declaration and of the runtime input
  // must not decide whether a source is recognized
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canon((v as Record<string, unknown>)[k])
      return out
    }
    return v
  }
  return JSON.stringify(canon(source))
}

// CONSTRAINT (S1-FIX3 F1): a clock tick stamps the time of the WHOLE family,
// so any of its elements may read time — the clock entry's own list is not
// the list of time-dependent elements. Other source kinds stay as declared.
function entryIds(fam: Collector<unknown>, entry: { source: Source; elements: string[] }): string[] {
  if (entry.source.kind !== 'clock') return entry.elements
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of entry.elements) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  for (const def of fam.elements) {
    if (seen.has(def.id)) continue
    seen.add(def.id)
    out.push(def.id)
  }
  return out
}

async function runFile($: EngineInterface, src: Extract<Source, { kind: 'file' }>, g: number): Promise<Input | null> {
  const t = await readClock($)
  if (!live(g)) { staleDrop('file source'); return null }
  let path = src.path
  if (!src.path.startsWith('/')) {
    let base = ''
    if (src.relativeTo === 'home') base = S.home
    else {
      try {
        base = await ($.session as unknown as { root: () => Promise<string> }).root()
      } catch {
        /* fall back to the cwd */
      }
      if (!live(g)) { staleDrop('file source'); return null }
      if (!base) {
        try {
          base = await $.session.cwd()
        } catch {
          base = ''
        }
        if (!live(g)) { staleDrop('file source'); return null }
      }
    }
    path = (base ? base.replace(/\/+$/, '') + '/' : '') + src.path
  }
  try {
    const data = await $.fs.read(path)
    return { source: src, ok: true, data, now: t }
  } catch (err) {
    return { source: src, ok: false, error: errorText(err), now: t }
  }
}

async function runCmd($: EngineInterface, src: Extract<Source, { kind: 'cmd' }>, g: number): Promise<Input | null> {
  const t = await readClock($)
  if (!live(g)) { staleDrop('cmd source'); return null }
  try {
    const r = await $.process.run(src.argv as string[])
    return { source: src, ok: true, data: { code: (r as { exitCode?: number }).exitCode, stdout: String((r as { stdout?: string }).stdout ?? ''), stderr: String((r as { stderr?: string }).stderr ?? '') }, now: t }
  } catch (err) {
    return { source: src, ok: false, error: errorText(err), now: t }
  }
}

function dispatch(input: Input): void {
  for (const fam of REG.families) {
    let declared = false
    for (const entry of fam.sources) {
      if (sourceKey(entry.source) !== sourceKey(input.source)) continue
      declared = true
      break
    }
    if (declared) feed(fam, input)
  }
}

async function runEnvSources($: EngineInterface, families: Collector<unknown>[] = REG.families, g: number = S.gen): Promise<void> {
  // CONSTRAINT: one env.get per name per pass. A second family that declared
  // the same name receives this result, including a refusal — it is not read again.
  const seen = new Map<string, string | undefined>()
  for (const fam of families) {
    for (const entry of fam.sources) {
      if (entry.source.kind !== 'env') continue
      const data: Record<string, string | undefined> = {}
      for (const name of entry.source.names) {
        if (!live(g)) return staleDrop('env sources')
        if (seen.has(name)) {
          data[name] = seen.get(name)
          continue
        }
        // CONSTRAINT (host law): $.env.get takes a LITERAL name at the call
        // site; every name a family declares has its own literal branch here —
        // a name without one is loud in the else, never silently unread
        if (name === 'HOME') {
          try {
            data[name] = await $.env.get('HOME')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'CLAUDE_CODE_EXECPATH') {
          try {
            data[name] = await $.env.get('CLAUDE_CODE_EXECPATH')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'HEADSIGN_OBSERVER') {
          try {
            data[name] = await $.env.get('HEADSIGN_OBSERVER')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'CLAUDE_INSTANCE_N') {
          try {
            data[name] = await $.env.get('CLAUDE_INSTANCE_N')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'CLAUDE_CONFIG_DIR') {
          try {
            data[name] = await $.env.get('CLAUDE_CONFIG_DIR')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'PWD') {
          try {
            data[name] = await $.env.get('PWD')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'KITTY_WINDOW_ID') {
          try {
            data[name] = await $.env.get('KITTY_WINDOW_ID')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'ITERM_SESSION_ID') {
          try {
            data[name] = await $.env.get('ITERM_SESSION_ID')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'TERM_PROGRAM') {
          try {
            data[name] = await $.env.get('TERM_PROGRAM')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'DEADLINE_TIME') {
          try {
            data[name] = await $.env.get('DEADLINE_TIME')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'NEON_DATABASE') {
          try {
            data[name] = await $.env.get('NEON_DATABASE')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'NEON_ENDPOINT') {
          try {
            data[name] = await $.env.get('NEON_ENDPOINT')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'NEON_PROJECT_ID') {
          try {
            data[name] = await $.env.get('NEON_PROJECT_ID')
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else if (name === 'NEON_API_KEY') {
          // CONSTRAINT: the key VALUE never crosses into a family; only the marker
          try {
            const v = await $.env.get('NEON_API_KEY')
            data[name] = typeof v === 'string' && v !== '' ? 'set' : undefined
          } catch (err) {
            failDiag('warn', 'env-read-' + name, name + ': env.get refused: ' + errorText(err))
            data[name] = undefined
          }
        } else {
          failDiag('warn', 'env-literal-' + name, name + ': no core literal; the value is not read')
          data[name] = undefined
        }
        seen.set(name, data[name])
      }
      if (!live(g)) return staleDrop('env sources')
      if (typeof data['HOME'] === 'string' && data['HOME'] && !S.home) {
        S.home = data['HOME']
        // home files were skipped while HOME was empty; read them now, not after everyMs
        await syncSourceTimers($)
        if (!live(g)) return staleDrop('env sources')
      }
      const at = await readClock($)
      if (!live(g)) return staleDrop('env sources')
      feed(fam, { source: entry.source, ok: true, data, now: at })
    }
  }
}

// CONSTRAINT: the stand rejects a second on('clock.every'). Tests refuse an
// arm only through this seam. $ may enter only a top-level function
// declaration, so the overridable slot does not take $ itself.
let armOverride: ((ms: number, fn: () => void) => unknown) | null = null
function armEvery(ms: number, fn: () => void, $: EngineInterface): unknown {
  if (armOverride) return armOverride(ms, fn)
  return $.clock.every(ms, fn)
}

async function runTranscript($: EngineInterface, src: Extract<Source, { kind: 'transcript' }>, g: number): Promise<Input | null> {
  // no path yet: no input at all — the element stays pending, the run is not marked
  const path = S.transcriptPath
  if (path === '') return null
  const t = await readClock($)
  if (!live(g)) { staleDrop('transcript source'); return null }
  try {
    const data = await $.fs.read(path)
    return { source: src, ok: true, data, now: t }
  } catch (err) {
    return { source: src, ok: false, error: errorText(err), now: t }
  }
}

async function syncBody($: EngineInterface, g: number): Promise<void> {
  if (!live(g)) return staleDrop('timer sync')
  const at = await readClock($)
  if (!live(g)) return staleDrop('timer sync')
  const ids = savedIds()
  const active = new Map<string, { source: Source; fam: Collector<unknown>; every: number }>()
  for (const fam of REG.families) {
    for (const entry of fam.sources) {
      const src = entry.source
      if (src.kind !== 'cmd' && src.kind !== 'file' && src.kind !== 'clock' && src.kind !== 'transcript') continue
      if (!entryIds(fam, entry).some((id) => ids.has(id))) continue
      active.set(sourceKey(src), { source: src, fam, every: src.kind === 'clock' ? src.everyMs : (src as { everyMs: number }).everyMs })
    }
  }
  for (const key of [...S.timers.keys()]) {
    if (!active.has(key)) {
      const timer = S.timers.get(key)!
      try { timer.cancel() } catch { /* a source leaving the layout must not throw */ }
      S.timers.delete(key)
      S.timerRefused.delete(key)
    }
  }
  for (const key of [...S.timerRefused.keys()]) {
    if (!active.has(key)) S.timerRefused.delete(key)
  }
  for (const [key, entry] of active) {
    if (S.timers.has(key)) continue
    const due = S.timerRefused.get(key)
    if (!S.clockFailed && due !== undefined && due > at) continue
    // No HOME yet: do not read and do not take a timer slot, or the next pass
    // would see the source as already scheduled until everyMs elapses.
    if (entry.source.kind === 'file' && entry.source.relativeTo === 'home' && !S.home) continue
    // No transcript path yet: same shape — the classic handler re-syncs the
    // moment the host publishes one, so the first read lands at once.
    if (entry.source.kind === 'transcript' && S.transcriptPath === '') continue
    const slot: TimerRun = { key, every: entry.every, lastTick: at, cancel: () => undefined }
    const run = (): void => {
      void quiet(async () => {
        if (!live(g)) return staleDrop('timer tick')
        const t = await readClock($)
        if (!live(g)) return staleDrop('timer tick')
        const held = S.timers.get(key)
        if (held) held.lastTick = t
        else slot.lastTick = t
        const input = entry.source.kind === 'cmd' ? await runCmd($, entry.source as Extract<Source, { kind: 'cmd' }>, g) : entry.source.kind === 'file' ? await runFile($, entry.source as Extract<Source, { kind: 'file' }>, g) : entry.source.kind === 'transcript' ? await runTranscript($, entry.source as Extract<Source, { kind: 'transcript' }>, g) : { source: entry.source, ok: true, data: undefined, now: t }
        if (input === null) return
        if (!live(g)) return staleDrop('timer tick')
        dispatch(input)
        await redraw($, entry.source.kind === 'clock' ? 'clock' : 'other')
      })
    }
    run()
    if (entry.every <= 0) {
      S.timerRefused.delete(key)
      S.timers.set(key, slot)
      continue
    }
    let handle: unknown
    try {
      handle = armEvery(entry.every, run, $)
    } catch (x) {
      failDiag('fail', 'timer-' + key.slice(0, 40), 'clock.every(' + entry.every + ') refused: ' + safeText(x).slice(0, 120))
      S.timerRefused.set(key, at + entry.every)
      continue
    }
    slot.cancel = () => {
      try { (handle as { cancel?: () => void })?.cancel?.() } catch { /* best effort */ }
    }
    S.timerRefused.delete(key)
    S.timers.set(key, slot)
  }
}

function syncSourceTimers($: EngineInterface): Promise<void> {
  // CONSTRAINT: the generation is the caller's, taken at the queueing — a job
  // queued behind another would otherwise start as the newer state's own
  const g = S.gen
  const job = S.syncChain.then(() => syncBody($, g))
  S.syncChain = job.then(() => undefined, () => undefined)
  return job
}

// The refresh cycle: session reads with tickets, ordered against redraws — a
// read older than the one on screen is dropped (SPEC §14.12).
async function refresh($: EngineInterface): Promise<void> {
  const g = S.gen
  await readClock($)
  if (!live(g)) return staleDrop('refresh')
  let rearm = S.clockFailed
  for (const [key, timer] of [...S.timers.entries()]) {
    if (timer.every > 0 && clockMs - timer.lastTick > 2 * timer.every + 1000) {
      try { timer.cancel() } catch { /* a dead interval must not throw */ }
      S.timers.delete(key)
      failDiag('warn', 'timer-dead-' + key.slice(0, 40), 'timer dead every=' + String(timer.every) + ' age=' + String(clockMs - timer.lastTick))
      rearm = true
    }
  }
  if (!rearm) {
    for (const due of S.timerRefused.values()) if (due <= clockMs) rearm = true
  }
  if (rearm) await syncSourceTimers($)
  if (!live(g)) return staleDrop('refresh')
  flushDiag($)
  const ticket = ++S.refreshesBegun
  const t = clockMs
  // CONSTRAINT (ADJUDICATION-v0.5-data-usage AR1): an identical source runs
  // ONCE per cycle; the input goes to every family declaring it. Without this
  // the second family declaring session:messages is never fed (messagesDone
  // already spent) and session:usage/info are read once per family.
  const readSession = new Set<string>()
  for (const fam of REG.families) {
    for (const entry of fam.sources) {
      const src = entry.source
      if (src.kind !== 'session') continue
      if (readSession.has(sourceKey(src))) continue
      readSession.add(sourceKey(src))
      if (src.call === 'messages' && S.messagesDone) continue
      let input: Input
      try {
        if (src.call === 'usage') {
          const usage = await $.session.usage({ breakdown: 'summary' })
          input = { source: src, ok: true, data: usage, now: t }
        } else if (src.call === 'model') {
          input = { source: src, ok: true, data: await $.session.model(), now: t }
        } else if (src.call === 'info') {
          const cwd = await $.session.cwd()
          if (!live(g)) return staleDrop('refresh')
          let root = cwd
          try {
            root = await ($.session as unknown as { root: () => Promise<string> }).root()
          } catch {
            /* root falls back to cwd */
          }
          if (!live(g)) return staleDrop('refresh')
          const id = await $.session.id()
          if (!live(g)) return staleDrop('refresh')
          const turns = await $.session.turns()
          input = {
            source: src,
            ok: true,
            data: { cwd, root, id, turns, transcriptPath: S.transcriptPath === '' ? undefined : S.transcriptPath },
            now: t,
          }
        } else {
          input = { source: src, ok: true, data: await $.session.messages(), now: t }
        }
      } catch (err) {
        input = { source: src, ok: false, error: errorText(err), now: t }
      }
      // a stale ticket would outrank the new state's refreshes (SPEC §14.12)
      if (!live(g)) return staleDrop('refresh')
      if (src.call === 'messages') S.messagesDone = true
      dispatch(input)
    }
  }
  if (ticket < S.refreshShown) return
  S.refreshShown = ticket
  await redraw($, 'other')
}

function clockBucket(): string {
  const placed = savedIds()
  let out = ''
  for (const fam of REG.families) {
    for (const entry of fam.sources) {
      if (entry.source.kind !== 'clock') continue
      for (const id of entryIds(fam, entry)) {
        if (!placed.has(id)) continue
        const got = valueOf(id, undefined, S.cfg.elements, S.cfg.nf)
        out += id + ':' + (got ? JSON.stringify(got.value) : '') + '\n'
      }
    }
  }
  return out
}

// drawnKeyOf() calls made from redraw — the seam __pictureBuilds() reads.
let pictureBuilds = 0

async function redraw($: EngineInterface, origin: 'clock' | 'other'): Promise<void> {
  flushDiag($)
  // CONSTRAINT (BRIEF-v0.5-S1-FIX2c п.1-2): only a clock tick may skip a
  // frame; any other input builds the picture. T15's cost is this rebuild on
  // every 1000 ms tick (measured: the reads are unchanged).
  const bucket = clockBucket()
  if (origin === 'clock' && !S.pictureDirty && bucket === S.pictureBucket && S.drawnKey !== undefined) return
  S.pictureDirty = false
  S.pictureBucket = bucket
  // each redraw asked for costs a frame; a refresh that finds the bar as it
  // was asks for none (measured live, SPEC §14.12)
  pictureBuilds++
  const key = drawnKeyOf()
  if (key !== undefined && key === S.drawnKey) return
  S.drawnKey = key
  invalidate($)
}

function drawnKeyOf(): string | undefined {
  const lines = drawLines(buildVars(S.cfg.elements, S.cfg.view, S.cfg.nf), S.cfg.tpl, S.cfg.view, S.cfg.elements, WIDTH_FALLBACK, 99, S.cfg.nf)
  return JSON.stringify(lines)
}

function refreshQuietly($: EngineInterface): Promise<void> {
  return refresh($).catch((err) => {
    failDiag('fail', 'refresh', 'refresh failed: ' + errorText(err))
  })
}

// CONSTRAINT: `g` is the generation of the render that drew the pressed
// control — a press on a tree drawn by an older state acts on nothing and the
// pane is redrawn by the state now current (SPEC §13.4)
function act($: EngineInterface, g: number, operation: () => Promise<unknown>): void {
  // picker presses run one after another; a failure becomes a notice, never a
  // lost picker (SPEC §14.12)
  S.actions = S.actions.then(() => S.restoring).then(() => {
    if (!live(g)) {
      staleDrop('picker action')
      invalidate($)
      return undefined
    }
    return operation()
  }).catch((error) => {
    if (live(g)) S.saveResult = errorText(error)
    try {
      $.ui.toast('[statusline] ' + errorText(error))
    } catch {
      /* toast is best effort */
    }
  })
}

// ---------- picker ----------

function freshDraft(): Draft {
  return {
    lines: S.cfg.tpl.lines.map((line) => line.map((seg) => ({ ...seg }))),
    axes: { ...S.cfg.rawOptions },
    elements: JSON.parse(JSON.stringify(S.cfg.elements)) as Record<string, ElemSettings>,
    focus: null,
    tab: 'layout',
    query: '',
    fam: 'all',
    targetLine: 0,
    themeName: '',
  }
}

async function openPicker($: EngineInterface): Promise<boolean> {
  const g = S.gen
  const dropOpen = (): boolean => {
    staleDrop('picker open')
    return false
  }
  // restore decides pickerOpen and the draft from storage; opening inside its
  // window would be overwritten by it (S1-FIX5 П.1)
  await S.restoring
  if (!live(g)) return dropOpen()
  if (S.themesFailed) {
    // 'stale' falls to the live check below, which drops it aloud
    if ((await readThemes($, g)) === 'ok') await applyDecided($, S.hostRaw, S.lastGood, g)
    if (!live(g)) return dropOpen()
  }
  S.pickerOpen = true
  const session = await $.session.id()
  if (!live(g)) return dropOpen()
  S.pickerSession = session
  if (!S.draft) S.draft = freshDraft()
  S.saveResult = ''
  await $.store.set(STORE_OPEN, { session: S.pickerSession })
  if (!live(g)) return dropOpen()
  await persistDraft($)
  if (!live(g)) return dropOpen()
  await $.ui.open({ id: PANE_ID, title: 'Статус-строка', focus: true, closeOnEscape: true, holdToasts: true, rows: 30 })
  if (!live(g)) return dropOpen()
  invalidate($)
  return true
}

async function settledRestore(): Promise<void> {
  let seen: Promise<void>
  do {
    seen = S.restoring
    await seen
  } while (seen !== S.restoring)
}

async function persistDraft($: EngineInterface): Promise<void> {
  if (!S.draft) return
  try {
    await $.store.set(STORE_DRAFT, { session: S.pickerSession, ...S.draft })
  } catch {
    /* best effort */
  }
}

// Esc and the engine's close keep the draft in $.store: it is restored when
// the picker opens again (Р5); Отмена is the discard.
export async function closeKeepDraft($: EngineInterface): Promise<void> {
  // CONSTRAINT (S1-FIX6 П.3): the close is the host's fact about the pane —
  // it lands on the state as the LATEST restore left it, never inside a
  // restore that would reopen the pane after it
  await settledRestore()
  S.pickerOpen = false
  try {
    await persistDraft($)
    await $.store.delete(STORE_OPEN)
  } catch {
    /* best effort */
  }
  invalidate($)
}

async function discardDraft($: EngineInterface): Promise<void> {
  S.pickerOpen = false
  S.draft = null
  try {
    await $.store.delete(STORE_DRAFT)
    await $.store.delete(STORE_OPEN)
  } catch {
    /* best effort */
  }
  invalidate($)
}

async function closePicker($: EngineInterface): Promise<void> {
  await discardDraft($)
  try {
    await $.ui.close({ id: PANE_ID })
  } catch {
    /* close is best effort */
  }
}

type MoveDir = 'left' | 'right' | 'up' | 'down' | 'out'

function moveFocus(dir: MoveDir): void {
  if (!S.draft) return
  const d = S.draft
  if (dir === 'out') {
    if (!d.focus) return
    d.lines[d.focus.line]?.splice(d.focus.seg, 1)
    d.focus = null
    return
  }
  if (!d.focus) {
    if (d.lines.length > 0 && d.lines[0]!.length > 0) d.focus = { line: 0, seg: 0 }
    return
  }
  const li = d.focus.line
  const si = d.focus.seg
  const line = d.lines[li]!
  if (dir === 'left' && si > 0) d.focus = { line: li, seg: si - 1 }
  else if (dir === 'right' && si < line.length - 1) d.focus = { line: li, seg: si + 1 }
  else if (dir === 'up' && li > 0 && d.lines[li - 1]!) d.focus = { line: li - 1, seg: Math.min(si, d.lines[li - 1]!.length) }
  else if (dir === 'down' && li < d.lines.length - 1 && d.lines[li + 1]!) d.focus = { line: li + 1, seg: Math.min(si, d.lines[li + 1]!.length) }
}

function movePill(dir: MoveDir): void {
  if (!S.draft || !S.draft.focus) {
    moveFocus(dir)
    return
  }
  const d = S.draft
  const li = d.focus.line
  const si = d.focus.seg
  const line = d.lines[li]!
  const seg = line[si]
  if (!seg) return
  if (dir === 'left' && si > 0) {
    line.splice(si, 1)
    line.splice(si - 1, 0, seg)
    d.focus = { line: li, seg: si - 1 }
  } else if (dir === 'right' && si < line.length - 1) {
    line.splice(si, 1)
    line.splice(si + 1, 0, seg)
    d.focus = { line: li, seg: si + 1 }
  } else if (dir === 'up' && li > 0) {
    line.splice(si, 1)
    const target = d.lines[li - 1]!
    target.push(seg)
    d.focus = { line: li - 1, seg: target.length - 1 }
  } else if (dir === 'down' && li < d.lines.length - 1) {
    line.splice(si, 1)
    const target = d.lines[li + 1]!
    target.push(seg)
    d.focus = { line: li + 1, seg: target.length - 1 }
  }
}

function draftSerialize(draft: Draft): string {
  return serializeTemplate(draft.lines)
}

function saveBlockReason(draft: Draft): string | null {
  const text = draftSerialize(draft)
  const back = parseTemplate(text)
  if (!sameLayout(back, draft.lines)) return 'литерал с зарезервированным токеном ( ;; или ||) — сохранить нельзя'
  if (back.length === 0) return 'раскладка пуста'
  return null
}

function draftFields(draft: Draft): Record<string, string> {
  const next: Record<string, string> = { ...draft.axes }
  next['template'] = draftSerialize(draft)
  next['elements'] = serializeElements(draft.elements)
  return next
}

function draftDirty(draft: Draft): boolean {
  const next = draftFields(draft)
  for (const f of new Set([...Object.keys(next), ...Object.keys(S.cfg.rawOptions)])) {
    if ((next[f] ?? '') !== (S.cfg.rawOptions[f] ?? '')) return true
  }
  return false
}

// the save/undo/reset notice: written only while the state is the one the
// operation began in (S1-FIX6 П.1); the text is returned either way
function sayFor($: EngineInterface, g: number): (text: string) => string {
  return (text) => {
    if (live(g)) {
      S.saveResult = text
      invalidate($)
    }
    return text
  }
}

async function saveDraft($: EngineInterface): Promise<void> {
  if (!S.draft) return
  // CONSTRAINT (S1-FIX6 П.1): the writes of the sequence continue past a
  // reload by design (SPEC §14.7, the in-flight mark); only its writes to S
  // stop once the state is not its own, and its base is captured up front.
  const g = S.gen
  const base = S.cfg.rawOptions
  const say = sayFor($, g)
  const reason = saveBlockReason(S.draft)
  if (reason) {
    say('не сохранено: ' + reason)
    return
  }
  const draft = S.draft
  const next = draftFields(draft)
  const changed: Record<string, string> = {}
  for (const f of Object.keys(next)) {
    if ((next[f] ?? '') !== (base[f] ?? '')) changed[f] = next[f] ?? ''
  }
  const fields = Object.keys(changed)
  if (fields.length === 0) {
    say('нет изменений')
    return
  }
  // key each row from the actual /config rows — never a constructed write key
  const mine = pluginName($.plugin.name)
  let rows: { key: string; isLocked: boolean; provider: { plugin: string } }[]
  try {
    rows = (await $.config.list()) as typeof rows
  } catch (err) {
    say('строки /config недоступны: ' + errorText(err))
    return
  }
  const denied: string[] = []
  const written: string[] = []
  // the in-flight mark goes in BEFORE the first write: the reload it causes
  // must not cut the sequence short (SPEC §14.7)
  try {
    await $.store.set(STORE_SAVING, { fields, values: changed })
    if (live(g)) S.saving = { fields, values: changed }
  } catch {
    /* best effort */
  }
  const stack = (await $.store.get(STORE_UNDO)) as { fields: string[]; prev: Record<string, string>; written: Record<string, string> }[] | undefined
  const undo = Array.isArray(stack) ? stack : []
  const prevValues: Record<string, string> = {}
  const writtenValues: Record<string, string> = {}
  for (const f of fields) {
    prevValues[f] = base[f] ?? ''
    writtenValues[f] = changed[f] ?? ''
  }
  undo.push({ fields, prev: prevValues, written: writtenValues })
  while (undo.length > UNDO_CAP) undo.shift()
  try {
    await $.store.set(STORE_UNDO, undo)
  } catch {
    /* best effort */
  }
  for (const field of fields) {
    const row = rows.find((r) => r.provider.plugin !== 'engine' && pluginName(r.provider.plugin) === mine && r.key.endsWith('.' + field))
    if (!row) {
      denied.push(field + ' (нет строки /config)')
      continue
    }
    if (row.isLocked) {
      denied.push(field + ' (isLocked)')
      continue
    }
    try {
      const result = await $.config.set({ key: row.key, value: changed[field] ?? '' })
      if (result && typeof result === 'object' && 'deny' in result && (result as { deny?: unknown }).deny !== undefined) {
        denied.push(field + ': ' + String((result as { deny: unknown }).deny))
      } else {
        written.push(field)
      }
    } catch (err) {
      denied.push(field + ': ' + errorText(err))
    }
  }
  const parts: string[] = []
  if (written.length > 0) parts.push('записано: ' + written.join(', '))
  if (denied.length > 0) parts.push('НЕ записано: ' + denied.join(', '))
  say(parts.join(' · '))
}

async function undoSave($: EngineInterface): Promise<void> {
  const g = S.gen
  const base = S.cfg.rawOptions
  const say = sayFor($, g)
  const stack = (await $.store.get(STORE_UNDO)) as { fields: string[]; prev: Record<string, string>; written: Record<string, string> }[] | undefined
  if (!Array.isArray(stack) || stack.length === 0) {
    say('нечего отменять')
    return
  }
  const entry = stack[stack.length - 1]!
  const mine = pluginName($.plugin.name)
  let rows: { key: string; value: unknown; provider: { plugin: string } }[]
  try {
    rows = (await $.config.list()) as typeof rows
  } catch (err) {
    say('строки /config недоступны: ' + errorText(err))
    return
  }
  const stale: string[] = []
  for (const f of entry.fields) {
    const row = rows.find((r) => r.provider.plugin !== 'engine' && pluginName(r.provider.plugin) === mine && r.key.endsWith('.' + f))
    const current = row ? String(row.value ?? '') : (base[f] ?? '')
    if (current !== (entry.written[f] ?? '')) stale.push(f)
  }
  if (stale.length > 0) {
    say('не отменено, поле меняли в обход: ' + stale.join(', '))
    return
  }
  const denied: string[] = []
  for (const f of entry.fields) {
    const row = rows.find((r) => r.provider.plugin !== 'engine' && pluginName(r.provider.plugin) === mine && r.key.endsWith('.' + f))
    if (!row) {
      denied.push(f + ' (нет строки /config)')
      continue
    }
    try {
      const result = await $.config.set({ key: row.key, value: entry.prev[f] ?? '' })
      if (result && typeof result === 'object' && 'deny' in result && (result as { deny?: unknown }).deny !== undefined) denied.push(f + ': ' + String((result as { deny: unknown }).deny))
    } catch (err) {
      denied.push(f + ': ' + errorText(err))
    }
  }
  stack.pop()
  try {
    await $.store.set(STORE_UNDO, stack)
  } catch {
    /* best effort */
  }
  say(denied.length > 0 ? 'отмена: НЕ записано ' + denied.join(', ') : 'отменено')
}

// «Сбросить к теме»: the draft's view axes return to the theme's own values
function resetToTheme(): void {
  if (!S.draft) return
  const name = S.draft.axes['theme'] ?? 'hud'
  const def = THEMES[name]?.axes ?? S.userThemes[name]
  if (!def) {
    S.saveResult = 'нет темы «' + name + '»'
    return
  }
  for (const axis of THEME_AXES) S.draft.axes[axis] = 'theme'
}

async function saveUserTheme($: EngineInterface, name: string): Promise<void> {
  if (!name) {
    S.themeNote = 'имя темы пустое'
    return
  }
  const g = S.gen
  if (S.themesFailed) {
    // CONSTRAINT (S1-FIX6 П.2): a transient refusal is retried here; only a
    // refusal that stands refuses the save (it would overwrite every theme)
    const read = await readThemes($, g)
    if (read === 'stale') return staleDrop('theme save')
    if (read === 'failed') {
      S.themeNote = 'тема не сохранена: сохранённые темы не прочитаны, запись затёрла бы их'
      return
    }
  }
  const { view } = resolveView(S.draft ? S.draft.axes : S.cfg.rawOptions, S.userThemes)
  const snap: Record<string, string> = {
    shape: view.shape, caps: view.caps, glyphs: view.glyphs, fill: view.fill,
    barWidth: view.barWidthMode === 'cells' ? String(view.barWidthCells) : 'adaptive',
    palette: view.paletteName, thresholds: view.thresholds.join(','),
    face: (['label', 'value', 'alert'] as const).filter((r) => view.face[r]).map((r) => r + '=' + view.face[r]).join(';'),
    border: view.border, overflow: view.overflow, separator: view.separator, align: view.align,
  }
  if (S.draft && S.draft.axes['bar'] && S.draft.axes['bar'] !== 'theme' && S.draft.axes['bar'] !== '') snap['bar'] = S.draft.axes['bar']!
  S.userThemes[name] = snap
  // CONSTRAINT (S1-FIX4 П.3): the band never shows a theme that is not in
  // storage — store first; the decision after is restore's own (applyDecided).
  const themes = S.userThemes
  try {
    await $.store.set(STORE_THEMES, themes)
  } catch (err) {
    if (!live(g)) return staleDrop('theme save')
    delete S.userThemes[name]
    S.themeNote = 'тема не сохранена: ' + errorText(err)
    return
  }
  if (!live(g)) {
    // the theme is in storage; the new state may have read the themes before
    // it landed — it re-reads them once its own restore has settled
    staleDrop('theme save')
    await rereadThemesAfterRestore($)
    return
  }
  await applyDecided($, S.hostRaw, S.lastGood, g)
  if (!live(g)) return staleDrop('theme save')
  S.themeNote = 'тема «' + name + '» сохранена'
  invalidate($)
}

async function rereadThemesAfterRestore($: EngineInterface): Promise<void> {
  const g = S.gen
  if (!S.restored) return // this state's restore has not begun: it reads the themes itself
  await settledRestore()
  if (!live(g)) return staleDrop('themes reread')
  if ((await readThemes($, g)) === 'ok') await applyDecided($, S.hostRaw, S.lastGood, g)
  if (live(g)) invalidate($)
}

function keepFocus($: EngineInterface, requestId: string): void {
  S.moves++
  invalidate($)
  try {
    const d = S.draft
    if (!d || !d.focus) return
    const seg = d.lines[d.focus.line]?.[d.focus.seg]
    if (!seg) return
    void $.ui.focus({ requestId, key: SEGMENT_KEY + seg.id + '#move' + S.moves })
  } catch {
    /* the kit has no implementation for a plugin's own focus move */
  }
}

// The picker model the pure builder renders; every action closes over `$`.
function pickerModel($: EngineInterface, e: { requestId?: string }, treeTable: Table): { model: PickerModel; actions: PickerActions } {
  const g = S.gen
  const d = S.draft!
  const view = resolveView(d.axes, S.userThemes).view
  const nf = buildNf(d.axes)
  const focusId = d.focus ? d.lines[d.focus.line]?.[d.focus.seg]?.id : undefined
  const families = [...new Set(REGISTRY.map((def) => def.family))]
  const placedIds = new Set(d.lines.flat().map((s) => s.id))
  const elements = REGISTRY.filter((def) => {
    if (d.fam !== 'all' && def.family !== d.fam) return false
    const q = d.query.toLowerCase()
    return q === '' || def.id.includes(q) || def.label.toLowerCase().includes(q) || def.about.toLowerCase().includes(q)
  }).map((def) => {
    const live = valueOf(def.id, undefined, d.elements, nf)
    const sample = live && live.value.state === 'ok' ? (live.value.rows ? def.sample : live.value.text) : def.sample
    return {
      id: def.id,
      label: def.label,
      family: def.family,
      placed: placedIds.has(def.id),
      unavailable: def.outcome === 'N',
      reason: def.outcome === 'N' ? def.reason ?? 'недоступно' : '',
      about: def.about,
      sample: sample.slice(0, 40),
    }
  })
  const lines = d.lines.map((line, li) =>
    line.map((seg, si) => {
      const comp = composeElement(seg.id.split('#')[0]!, rawValue(seg.id.split('#')[0]!, d.elements, nf), d.elements, view, nf)?.text ?? ''
      return { id: seg.id, label: seg.id, focused: !!(d.focus && d.focus.line === li && d.focus.seg === si), sample: comp }
    }),
  )
  const def = focusId ? REG.byId.get(focusId.split('#')[0]!)?.def : undefined
  const settings = d.elements[focusId?.split('#')[0]!] ?? {}
  const element = def
    ? {
        id: def.id,
        label: def.label,
        about: def.about,
        variant: settings['v'] ?? def.variants[0]!.id,
        variants: def.variants.map((v: Variant) => {
          const live = valueOf(def.id, v.id, d.elements, nf)
          const sample = live && live.value.state === 'ok' ? live.value.text : def.sample
          return { id: v.id, label: v.label, sample: sample.slice(0, 30) }
        }),
        options: (def.options ?? []).map((o) => {
          const value = String(optionsOf(def, d.elements)[o.key] ?? '')
          return { key: o.key, label: o.label, kind: o.kind, value, choices: o.kind === 'choice' ? o.choices : undefined }
        }),
        color: settings['c'] ?? '',
        swatches: ['#d77757', '#4eba65', '#4782c8', '#af87ff', '#ffc107', '#ff6b80', 'green', 'yellow', 'red', 'cyan', 'magenta'],
        canThreshold: def.kind === 'meter',
        icon: settings['ic'] ?? 'unicode',
        labelMode: settings['lb'] ?? (DEFAULT_LABEL[def.id] ? 'on' : 'off'),
        labelText: settings['lt'] ?? '',
        hasGlyph: GLYPHS[def.id] !== undefined,
        barPair: settings['bp'] ?? view.barPair.join(''),
        barPairs: BAR_PAIR_CHOICES,
        barWidth: settings['bw'] ?? 'auto',
        barShow: settings['bs'] ?? 'all',
        maxRows: typeof optionsOf(def, d.elements)['maxRows'] === 'number' ? (optionsOf(def, d.elements)['maxRows'] as number) : 3,
        order: String(optionsOf(def, d.elements)['order'] ?? ''),
        orders: def.kind === 'list' ? (def.options ?? []).find((o) => o.key === 'order' && o.kind === 'choice')?.choices ?? [] : [],
        isMeter: def.kind === 'meter',
        isList: def.kind === 'list',
      }
    : null
  const axes = THEME_AXES.map((axis) => ({
    name: axis,
    label: axis,
    value: d.axes[axis] && d.axes[axis] !== '' ? d.axes[axis]! : 'theme',
    choices: [{ id: 'theme', label: '(как в теме)', sample: '' }, ...(AXIS_TEXT_CHOICES[axis] ?? AXIS_OPTIONS[axis] ?? []).map((v) => ({ id: v, label: axisSample(axis, v) !== '' && axis !== 'palette' && axis !== 'glyphs' && axis !== 'fill' && axis !== 'border' && axis !== 'overflow' && axis !== 'barWidth' ? v + ' ' + axisSample(axis, v) : v, sample: axisSample(axis, v) }))],
  }))
  const numbers = NUM_FIELDS.map((f) => ({
    field: f.field,
    label: f.label,
    value: d.axes[f.field] ?? f.choices[0]!,
    choices: f.choices.map((c) => ({ id: c, sample: numSample(f.field, c, d.elements, nf) })),
  }))
  const themes = [...Object.keys(THEMES), ...Object.keys(S.userThemes)].map((name) => {
    const themeView = resolveView({ ...d.axes, theme: name }, S.userThemes).view
    const vars = buildVars(d.elements, themeView, buildNf(d.axes))
    const rows = drawLines(vars, { lines: d.lines, sep: themeView.separator, evict: S.cfg.tpl.evict }, themeView, d.elements, 120, 3, buildNf(d.axes))
    return { name, tree: buildBarTree(rows, themeView, 120, treeTable, false, () => '', d.elements, buildNf(d.axes)) }
  })
  const model: PickerModel = {
    tab: d.tab,
    lines,
    focus: d.focus,
    targetLine: d.targetLine,
    moves: S.moves,
    elements,
    families,
    familyFilter: d.fam,
    query: d.query,
    element,
    axes,
    themes,
    themeName: d.themeName,
    numbers,
    presets: LAYOUT_PRESETS,
    maxRows: S.lastMaxRows,
    notice: S.saveResult,
    saving: S.saving ? S.saving.fields.join(', ') : '',
    dirty: draftDirty(d),
    canUndo: true,
  }
  const persist = (): Promise<void> => persistDraft($).then(() => invalidate($))
  const actions: PickerActions = {
    setTab: (tab) => act($, g, async () => { d.tab = tab; await persist() }),
    focusSeg: (line, seg) => act($, g, async () => { d.focus = { line, seg }; await persist() }),
    move: (dir) => act($, g, async () => { movePill(dir); await persistDraft($); keepFocus($, e.requestId ?? PANE_ID) }),
    editSeg: () => act($, g, async () => { d.tab = 'element'; await persist() }),
    addLine: () => act($, g, async () => { if (d.lines.length < S.lastMaxRows) d.lines.push([]); await persist() }),
    delLine: (line) => act($, g, async () => { if (d.lines[line] && d.lines[line]!.length === 0) d.lines.splice(line, 1); await persist() }),
    addInto: (line) => act($, g, async () => { d.targetLine = line; d.tab = 'elements'; await persist() }),
    preset: (id) => act($, g, async () => { d.lines = presetLines(id).map((l) => l.map((s) => ({ ...s }))); d.focus = null; await persist() }),
    setQuery: (text) => act($, g, async () => { d.query = text; await persist() }),
    setFam: (fam) => act($, g, async () => { d.fam = fam; await persist() }),
    toggleElement: (id) =>
      act($, g, async () => {
        const li = Math.max(0, Math.min(d.targetLine, d.lines.length - 1))
        for (let i = 0; i < d.lines.length; i++) {
          const idx = d.lines[i]!.findIndex((s) => s.id.split('#')[0]! === id)
          if (idx >= 0) {
            d.lines[i]!.splice(idx, 1)
            await persist()
            return
          }
        }
        d.lines[li]!.push({ id, body: '{' + id + '.text}' })
        d.focus = { line: li, seg: d.lines[li]!.length - 1 }
        await persist()
      }),
    setVariant: (id) => act($, g, async () => { if (focusId) { setElem(d, focusId.split('#')[0]!, 'v', id) } await persist() }),
    setOption: (key, value) => act($, g, async () => { if (focusId) { setElem(d, focusId.split('#')[0]!, 'o:' + key, value) } await persist() }),
    nudgeOption: (key, delta) =>
      act($, g, async () => {
        if (!focusId) return
        const def2 = REG.byId.get(focusId.split('#')[0]!)!.def
        const o = (def2.options ?? []).find((x) => x.key === key)
        if (!o || o.kind !== 'int') return
        const cur = Number(optionsOf(def2, d.elements)[key] ?? o.default) + delta * (o.step ?? 1)
        setElem(d, def2.id, 'o:' + key, String(Math.max(o.min, Math.min(o.max, cur))))
        await persist()
      }),
    setColor: (value) => act($, g, async () => { if (focusId) { setElem(d, focusId.split('#')[0]!, 'c', value) } await persist() }),
    setCustomColor: (text) => act($, g, async () => { if (focusId && /^#[0-9a-fA-F]{6}$/.test(text)) { setElem(d, focusId.split('#')[0]!, 'c', text.toLowerCase()) } await persist() }),
    setIcon: (set) => act($, g, async () => { if (focusId) { setElem(d, focusId.split('#')[0]!, 'ic', set) } await persist() }),
    setLabelMode: (mode) => act($, g, async () => { if (focusId) { setElem(d, focusId.split('#')[0]!, 'lb', mode) } await persist() }),
    setLabelText: (text) => act($, g, async () => { if (focusId) { setElem(d, focusId.split('#')[0]!, 'lt', text) } await persist() }),
    setBarPair: (pair) => act($, g, async () => { if (focusId) { setElem(d, focusId.split('#')[0]!, 'bp', pair) } await persist() }),
    setBarWidth: (width) => act($, g, async () => { if (focusId) { setElem(d, focusId.split('#')[0]!, 'bw', width) } await persist() }),
    setBarShow: (show) => act($, g, async () => { if (focusId) { setElem(d, focusId.split('#')[0]!, 'bs', show) } await persist() }),
    setOrder: (order) => act($, g, async () => { if (focusId) { setElem(d, focusId.split('#')[0]!, 'o:order', order) } await persist() }),
    setAxis: (axis, value) => act($, g, async () => { d.axes[axis] = value; await persist() }),
    applyTheme: (name) => act($, g, async () => { d.axes['theme'] = name; for (const axis of THEME_AXES) d.axes[axis] = 'theme'; await persist() }),
    setThemeName: (text) => act($, g, async () => { d.themeName = text; await persist() }),
    saveTheme: () => act($, g, () => saveUserTheme($, d.themeName)),
    setNumber: (field, value) => act($, g, async () => { d.axes[field] = value; await persist() }),
    save: () => act($, g, () => saveDraft($)),
    cancel: () => act($, g, () => closePicker($)),
    undo: () => act($, g, () => undoSave($)),
    resetToTheme: () => act($, g, async () => { resetToTheme(); await persist() }),
  }
  return { model, actions }
}

function setElem(d: Draft, id: string, key: string, value: string): void {
  const cur = d.elements[id] ?? {}
  if (value === '') delete cur[key]
  else cur[key] = value
  if (Object.keys(cur).length === 0) delete d.elements[id]
  else d.elements[id] = cur
}

function rawValue(id: string, elements: Record<string, ElemSettings>, nf: NumberFormat): Value {
  const got = valueOf(id, undefined, elements, nf)
  return got ? got.value : { state: 'nosource' as const, reason: 'unknown element' }
}

function axisSample(axis: string, value: string): string {
  if (axis === 'caps') return value === 'unicode-round' ? '◖◗' : value === 'none' ? '' : value
  if (axis === 'bar') return (BAR_PAIRS[value] ?? ['', '']).join('')
  if (axis === 'shape') return value === 'pill' ? '( x )' : value === 'powerline' ? 'x\u{E0B0}' : value === 'classic' ? '[x]' : value
  if (axis === 'align') return value === 'split' ? 'x        x' : value === 'right' ? '        x' : value === 'center' ? '    x    ' : 'x'
  return ''
}

function numSample(field: string, choice: string, elements: Record<string, ElemSettings>, nf: NumberFormat): string {
  const raw: Record<string, string> = { [field]: choice }
  const f = buildNf(raw)
  if (field === 'numTokens') return f.tokens(231045)
  if (field === 'numPercent') return f.percent(0.482)
  if (field === 'numUsd') return f.usd(6434.27)
  if (field === 'numDuration') return f.duration(1655 * 3600000 + 47 * 60000)
  if (field === 'numBytes') return f.bytes(11 * 1000 ** 3)
  return f.rate(25, 'tok')
}

// ---------- registration ----------

export function register(on: On, options: PluginOptions): void {
  // reset the whole in-memory state: a reload wipes it (SPEC §14.7)
  // CONSTRAINT (S1-FIX5 П.5): the wipe is freshState() whole — a field
  // missing from a hand-written list would carry the previous session over.
  // Module bindings (pictureBuilds, clockMs, armOverride) are stand seams and
  // stay; the timers of the previous state are cancelled first.
  wipeState()
  S.reloadOptions = rawOptionsOf(options)
  // CONSTRAINT (S1-FIX4 П.1): themes are not loaded yet at register — restore owns the theme diagnosis.
  applyOptions(rawOptionsOf(options), { provisional: true })
  if (REG.duplicateIds.length > 0) {
    failDiag('fail', 'registry-duplicate-id', 'registry: duplicate element id(s) ' + REG.duplicateIds.join(', ') + '; the first registration stands')
  }

  // The host resolves subscriptions STATICALLY: one subscription per event,
  // the filter and the fan-out decided inside (DESIGN Р3, #363).
  const subFail = (event: string, x: unknown): void => {
    failDiag('fail', 'sub-' + event, "subscription '" + event + "' refused: " + String(x).slice(0, 120))
  }

  const dispatchEvent = (event: string, data: unknown, at: number): void => {
    for (const fam of REG.families) {
      for (const entry of fam.sources) {
        if (entry.source.kind === 'event' && entry.source.event === event) {
          feed(fam, { source: entry.source, ok: true, data, now: at })
          break
        }
      }
    }
  }

  let anonCalls = 0
  // a user's command whose state was reset under it says so; it is not redone
  const RELOADED = { text: 'The status line module reloaded while /' + COMMAND + ' ran; run it again.' }

  try {
    on('session.start', async ($, e, next) => {
      const g = S.gen
      ensureRestore($)
      const at = await readClock($)
      const fresh = live(g)
      if (fresh) {
        ensureStarted($)
        S.interactive = e.isInteractive === true
        clearStatus($)
        S.statusCleared = false
        dispatchEvent('session.start', e, at)
      } else {
        staleDrop('session start')
      }
      const started = await next(e)
      // CONSTRAINT: the command is the session's, not the state's — a reload
      // does not repeat session.start, so a start begun before it still
      // registers the command, and a refusal is recorded whichever state is current
      try {
        await $.command.register({ name: COMMAND, description: 'The status line panel: layout, elements, view axes, themes, number formats.', argumentHint: '[reset]' })
      } catch (err) {
        failDiag('fail', 'command-register', String(err))
      }
      if (!live(g)) {
        if (fresh) staleDrop('session start')
        return started
      }
      await refresh($)
      return started
    })
  } catch (x) {
    subFail('session.start', x)
  }

  try {
    on('session.end', async ($, e, next) => {
      const g = S.gen
      clearStatus($)
      const at = await readClock($)
      if (live(g)) dispatchEvent('session.end', e, at)
      else staleDrop('session end')
      return next(e)
    })
  } catch (x) {
    subFail('session.end', x)
  }

  try {
    on('turn.start', async ($, e, next) => {
      const g = S.gen
      const at = await readClock($)
      if (live(g)) dispatchEvent('turn.start', e, at)
      else staleDrop('turn start')
      return next(e)
    })
  } catch (x) {
    subFail('turn.start', x)
  }

  try {
    on('turn.step', async function* ($, e, next) {
      const g = S.gen
      const at = await readClock($)
      if (!live(g)) {
        staleDrop('turn step')
        return yield* next(e)
      }
      dispatchEvent('turn.step', e, at)
      const refreshed = refreshQuietly($)
      const result = yield* next(e)
      await refreshed
      if (!live(g)) {
        staleDrop('turn step')
        return result
      }
      await refreshQuietly($)
      return result
    })
  } catch (x) {
    subFail('turn.step', x)
  }

  try {
    on('turn.complete', async ($, e, next) => {
      const g = S.gen
      const done = await next(e)
      if (!live(g)) {
        staleDrop('turn complete')
        return done
      }
      const at = await readClock($)
      if (!live(g)) {
        staleDrop('turn complete')
        return done
      }
      // the event carries the usage; the chain's result carries the answer text
      dispatchEvent('turn.complete', typeof done === 'object' && done !== null ? { ...e, ...(done as object) } : e, at)
      await refresh($)
      return done
    })
  } catch (x) {
    subFail('turn.complete', x)
  }

  try {
    on('tool.call', async ($, e, next) => {
      const id = typeof e.tool_use_id === 'string' && e.tool_use_id !== '' ? e.tool_use_id : ''
      const callKey = id !== '' ? 't:' + id : 'n:' + String(++anonCalls)
      const agentScope = agentScopeOf(e.agentId)
      const g = S.gen
      let dropped = false
      const drop = (): void => {
        if (!dropped) {
          dropped = true
          staleDrop('tool call')
        }
      }
      // the clock is read only while the state is live: after a reload the
      // generation law allows no engine call but the chain's own next
      const feedLive = async (data: unknown): Promise<void> => {
        if (!live(g)) return drop()
        const at = await readClock($)
        if (live(g)) dispatchEvent('tool.call', data, at)
        else drop()
      }
      await feedLive({ ...e, callKey, agentScope })
      let r: Awaited<ReturnType<typeof next>> | undefined
      try {
        r = await next(e)
      } catch (err) {
        await feedLive({ isError: true, callKey, callTool: e.tool })
        throw err
      }
      const base = r && typeof r === 'object' ? (r as object) : {}
      await feedLive({ ...base, callKey, callTool: e.tool })
      return r!
    })
  } catch (x) {
    subFail('tool.call', x)
  }

  try {
    on('agent.spawn', async ($, e, next) => {
      const g = S.gen
      let r: Awaited<ReturnType<typeof next>> | undefined
      try {
        r = await next(e)
      } catch (err) {
        if (live(g)) failDiag('fail', 'agent-spawn', 'agent.spawn chain threw: ' + String(err).slice(0, 80))
        else staleDrop('agent spawn')
        throw err
      }
      if (!live(g)) {
        staleDrop('agent spawn')
        return r!
      }
      const at = await readClock($)
      if (live(g)) dispatchEvent('agent.spawn', r && typeof r === 'object' ? { ...e, ...(r as object) } : e, at)
      else staleDrop('agent spawn')
      return r!
    })
  } catch (x) {
    subFail('agent.spawn', x)
  }

  try {
    on('config.set', async ($, e, next) => {
      const g = S.gen
      const at = await readClock($)
      const fresh = live(g)
      if (fresh) dispatchEvent('config.set', e, at)
      else staleDrop('config set')
      const result = await next(e)
      if (live(g)) await refreshQuietly($)
      else if (fresh) staleDrop('config set')
      return result
    })
  } catch (x) {
    subFail('config.set', x)
  }

  // The transcript path arrives only in the classic envelope (d.ts:623-625).
  // CONSTRAINT: the classic chain is never ours to own — every path returns
  // next(e), the user's settings hooks included (d.ts:982-996); UserPromptSubmit
  // is watched too because a module reload does not repeat SessionStart.
  try {
    on('classic.SessionStart', async ($, e, next) => {
      try {
        const p = (e as { transcript_path?: unknown }).transcript_path
        if (typeof p === 'string' && p !== '' && p !== S.transcriptPath) {
          S.transcriptPath = p
          if (S.started) await syncSourceTimers($)
        }
      } finally {
        return next(e)
      }
    })
  } catch (x) {
    subFail('classic.SessionStart', x)
  }

  try {
    on('classic.UserPromptSubmit', async ($, e, next) => {
      try {
        const p = (e as { transcript_path?: unknown }).transcript_path
        if (typeof p === 'string' && p !== '' && p !== S.transcriptPath) {
          S.transcriptPath = p
          if (S.started) await syncSourceTimers($)
        }
      } finally {
        return next(e)
      }
    })
  } catch (x) {
    subFail('classic.UserPromptSubmit', x)
  }

  try {
    on('command.run', async ($, e, next) => {
      const command = String(e.command ?? '')
      const g = S.gen
      if (command !== COMMAND) {
        const result = await next(e)
        if (command === 'model' || command === 'compact' || command === 'clear') {
          if (live(g)) await refreshQuietly($)
          else staleDrop('command refresh')
        }
        return result
      }
      ensureRestore($)
      const arg = (e.args ?? '').trim()
      if (arg === 'reset') {
        await settledRestore()
        return { text: 'Status line reset to defaults. ' + (await resetAll($)) }
      }
      // CONSTRAINT (S1-FIX6 П.8): a module reload does not repeat
      // session.start, so the wiped flag alone would turn every session
      // after a save into a text-only one; the host's surfaces answer it
      if (!S.interactive) {
        const draws = await drawsOnSurface($)
        if (!live(g)) {
          staleDrop('picker open')
          return RELOADED
        }
        S.interactive = draws
      }
      if (!S.interactive) {
        // a surface without the pane gets text and the /config path (SPEC §14.6)
        return { text: 'Status line is configured through /config (fields catalyst-statusline.*) or /statusline-mod in an interactive terminal or desktop session.' }
      }
      return (await openPicker($)) ? {} : RELOADED
    })
  } catch (x) {
    subFail('command.run', x)
  }

  try {
    on('config.describe', async ($, e, next) => {
      const result = await next(e)
      const mine = pluginName($.plugin.name)
      if ((e.provider.plugin ?? '') !== '' && pluginName(e.provider.plugin) === mine) {
        const field = e.key.includes('.') ? e.key.slice(e.key.lastIndexOf('.') + 1) : e.key
        const titles: Record<string, string> = {
          template: 'раскладка', separator: 'разделитель', evictOrder: 'порядок вытеснения', theme: 'тема',
          placement: 'место', details: 'карточки деталей', shape: 'форма сегмента', caps: 'кэпы', glyphs: 'глифы',
          fill: 'заливка', bar: 'полоса заполнения', barWidth: 'ширина полосы', palette: 'палитра', thresholds: 'пороги',
          face: 'начертание', border: 'рамка', overflow: 'узкое окно', align: 'выравнивание',
          elements: 'настройки элементов', numTokens: 'формат: токены', numPercent: 'формат: проценты', numUsd: 'формат: деньги',
          numDuration: 'формат: время', numBytes: 'формат: байты', numRate: 'формат: скорость',
        }
        return { ...result, label: 'Статус-строка: ' + (titles[field] ?? field) }
      }
      return result
    })
  } catch (x) {
    subFail('config.describe', x)
  }

  try {
    on('ui.close', async ($, e, next) => {
      if ((e as { id?: string }).id === PANE_ID) await closeKeepDraft($)
      return next(e)
    })
  } catch (x) {
    subFail('ui.close', x)
  }

  try {
    on('ui.render', async ($, e, next) => {
      const g = S.gen
      const component = String((e as { component?: string }).component ?? '')
      if (component === 'AbovePrompt') {
        ensureStarted($, true)
        ensureRestore($)
        S.lastMaxRows = typeof e.props.maxRows === 'number' && e.props.maxRows > 0 ? e.props.maxRows : S.lastMaxRows
        const view = S.cfg.view
        if (view.placement !== 'above') return next(e)
        if (e.props.hasSurvey === true) {
          // one diagnostic record per survey, never a redraw fight (SPEC §14.12)
          if (!S.surveyDiag) {
            S.surveyDiag = true
            infoDiag('survey-yield', 'AbovePrompt yielded to a survey; the band is not drawn')
          }
          return next(e)
        }
        S.surveyDiag = false
        const width = typeof e.props.bodyColumns === 'number' && e.props.bodyColumns > 0 ? e.props.bodyColumns : WIDTH_FALLBACK
        const maxRows = typeof e.props.maxRows === 'number' && e.props.maxRows > 0 ? e.props.maxRows : 8
        const vars = buildVars(S.cfg.elements, view, S.cfg.nf)
        const lines = drawLines(vars, S.cfg.tpl, view, S.cfg.elements, width, maxRows, S.cfg.nf)
        if (lines.length === 0) return next(e)
        const table = (await $.ui.resolve(e)) as unknown as Table
        if (!live(g)) {
          staleDrop('render')
          return next(e)
        }
        const detail = (id: string): string => detailOf(id, S.cfg.elements, S.cfg.nf)
        return buildBarTree(lines, view, width, table, view.details === 'hover', detail, S.cfg.elements, S.cfg.nf) as Awaited<ReturnType<typeof next>>
      }
      if (component === 'PromptHint') {
        ensureStarted($, true)
        ensureRestore($)
        const view = S.cfg.view
        // Р1: PromptHint is not rewritten while the placement is above
        if (view.placement !== 'hint') return next(e)
        const width = typeof (e as { viewport?: { columns?: number } }).viewport?.columns === 'number' ? (e as { viewport: { columns: number } }).viewport.columns : WIDTH_FALLBACK
        const vars = buildVars(S.cfg.elements, view, S.cfg.nf)
        const all = drawLines(vars, S.cfg.tpl, view, S.cfg.elements, width, 1, S.cfg.nf)
        if (S.cfg.tpl.lines.length > 1) failDiag('fail', 'hint-lines', 'placement=hint: ' + (S.cfg.tpl.lines.length - 1) + ' line(s) beyond the first not drawn (З9)')
        if (all.length === 0) return next(e)
        const table = (await $.ui.resolve(e)) as unknown as Table
        if (!live(g)) {
          staleDrop('render')
          return next(e)
        }
        const detail = (id: string): string => detailOf(id, S.cfg.elements, S.cfg.nf)
        const bar = buildBarTree(all, view, width, table, view.details === 'hover', detail, S.cfg.elements, S.cfg.nf) as { children?: unknown[] }
        const children: unknown[] = [bar]
        const hint = typeof e.props.hint === 'string' ? e.props.hint.trim() : ''
        if (hint) children.push(table.Box({ flexShrink: 1, children: [table.Text({ children: ['  ' + hint], dimColor: true, wrap: 'truncate' })] }))
        return table.Box({ flexDirection: 'row', children }) as Awaited<ReturnType<typeof next>>
      }
      if (component === 'Pane') {
        if ((e as { requestId?: string }).requestId !== PANE_ID) return next(e)
        ensureRestore($)
        if (S.pickerOpen !== true) return next(e)
        const surface = (e as { surface?: string }).surface
        const table = (await $.ui.resolve(e)) as unknown as PickerTable
        if (!live(g)) {
          staleDrop('render')
          return next(e)
        }
        const bodyColumns = typeof e.props.bodyColumns === 'number' && e.props.bodyColumns > 0 ? e.props.bodyColumns : 80
        if (surface !== 'terminal' && surface !== 'desktop') {
          return table.Box({
            flexDirection: 'column',
            children: [
              table.Text({ children: ['Open /statusline-mod in the terminal or the desktop to use the panel. Edit the fields through /config (catalyst-statusline.*) on this surface.'] }),
              table.Button({ key: 'close', label: 'Close', onPress: () => act($, g, () => closePicker($)) }),
            ],
          }) as Awaited<ReturnType<typeof next>>
        }
        if (!S.draft) S.draft = freshDraft()
        const { model, actions } = pickerModel($, e as { requestId?: string }, table as unknown as Table)
        // the preview is the same render as the band (§14.6.5): the draft's
        // own view, layout and element settings feed the same builder
        const draftView = resolveView(S.draft.axes, S.userThemes).view
        const draftNf = buildNf(S.draft.axes)
        const vars = buildVars(S.draft.elements, draftView, draftNf)
        const blockReason = saveBlockReason(S.draft)
        const previewLines = blockReason ? [] : drawLines(vars, { lines: S.draft.lines, sep: draftView.separator, evict: S.cfg.tpl.evict }, draftView, S.draft.elements, bodyColumns, S.lastMaxRows, draftNf)
        const preview = buildBarTree(previewLines, draftView, bodyColumns, table as unknown as Table, draftView.details === 'hover', (id) => detailOf(id, S.draft!.elements, draftNf), S.draft.elements, draftNf)
        if (blockReason) {
          return table.Box({
            flexDirection: 'column',
            children: [
              table.Text({ key: 'preview-failed', children: ['Превью отказано: ' + blockReason], wrap: 'truncate' }),
              buildPicker(model, table, actions, table.Box({ flexDirection: 'column', children: [preview] })),
            ],
          }) as Awaited<ReturnType<typeof next>>
        }
        return buildPicker(model, table, actions, preview) as Awaited<ReturnType<typeof next>>
      }
      return next(e)
    })
  } catch (x) {
    subFail('ui.render', x)
  }
}

async function resetAll($: EngineInterface): Promise<string> {
  // /statusline-mod reset: every field back to its default through $.config.set
  const g = S.gen
  const base = S.cfg.rawOptions
  const say = sayFor($, g)
  const mine = pluginName($.plugin.name)
  let rows: { key: string; value: unknown; provider: { plugin: string } }[]
  try {
    rows = (await $.config.list()) as typeof rows
  } catch (err) {
    return say('строки /config недоступны: ' + errorText(err))
  }
  const defaults: Record<string, string> = { theme: 'hud', placement: 'above', details: 'hover' }
  for (const axis of THEME_AXES) defaults[axis] = axis === 'separator' || axis === 'thresholds' || axis === 'face' ? '' : 'theme'
  for (const f of NUM_FIELDS) defaults[f.field] = f.choices[0]!
  defaults['template'] = ''
  defaults['separator'] = ''
  defaults['evictOrder'] = ''
  defaults['elements'] = ''
  const denied: string[] = []
  for (const field of Object.keys(defaults)) {
    if ((base[field] ?? '') === defaults[field]) continue
    const row = rows.find((r) => r.provider.plugin !== 'engine' && pluginName(r.provider.plugin) === mine && r.key.endsWith('.' + field))
    if (!row) continue
    try {
      await $.config.set({ key: row.key, value: defaults[field] ?? '' })
    } catch (err) {
      denied.push(field + ': ' + errorText(err))
    }
  }
  return say(denied.length > 0 ? 'reset: НЕ записано ' + denied.join(', ') : 'сброшено к дефолтам')
}

// ---------- stand surface (the tests and the snapshots read these) ----------

const STAND_TABLE: Table = {
  Box: (props) => ({ type: 'Box', props, children: props['children'] }),
  Text: (props) => ({ type: 'Text', props, children: props['children'] }),
}

// The §11.2 gate as a pure function: which cmd/file/clock sources the core
// must run for a saved layout (the timer sync consumes exactly this set).
export function __savedIds(): string[] {
  return [...savedIds()]
}

export function __resetState(): void {
  wipeState()
  pictureBuilds = 0
  clockMs = 0
  armOverride = null
}

export function __setArmEvery(fn: ((ms: number, run: () => void) => unknown) | null): void {
  armOverride = fn
}

// FIX2c п.4: rebuilds demanded through redraw, zeroed by __resetState.
export function __pictureBuilds(): number {
  return pictureBuilds
}

// Stand seams for the S1-FIX3 teeth: the clock-coverage rule by registry
// position (famIndex is the data/index.ts FAMILIES order), the state copy, and
// the same canonical key with and without the WeakMap memo.
export function __entryIds(famIndex: number, entryIndex: number): string[] {
  const fam = REG.families[famIndex]!
  return entryIds(fam, fam.sources[entryIndex]!)
}

export function __stateSnapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(S as unknown as Record<string, unknown>)) {
    // CONSTRAINT (S1-FIX4 П.5): promise fields go out by REFERENCE — F6b
    // decides __resetState on promise identity, which JSON copying erases.
    // Map and Set entries go out as LIVE references to their values: a caller
    // that mutates them mutates S (S1-FIX5 П.9).
    out[k] = v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v.values()] : v instanceof Promise ? v : JSON.parse(JSON.stringify(v ?? null) as string)
  }
  return out
}

export function __sourceKeyFresh(source: Source): string {
  return canonicalSource(source)
}

export function __sourceKeyMemoized(source: Source): string {
  return sourceKey(source)
}

// The band reads user themes only through the S.cfg snapshot, so the seam
// mirrors the restore path (restoreAfterReload replaces S.userThemes; the next
// applyOptions moves it into the band) instead of marking by hand.
export function __pictureThemes(themes: Record<string, Record<string, string>>): void {
  S.userThemes = themes
  applyOptions(S.cfg.rawOptions)
}

export function __pictureReadClock($: EngineInterface): Promise<number> {
  return readClock($)
}

// Product timerRefused writes all sit in syncBody, whose every real caller is
// followed by a redraw('other') (immediate run() or the refresh tail); the seam
// stands for an out-of-band refusal-state change, which has no such redraw.
export function __pictureTimerRefused(key: string, dueMs: number | undefined): void {
  if (dueMs === undefined) S.timerRefused.delete(key)
  else S.timerRefused.set(key, dueMs)
  markPicture()
}

export function __syncSourceTimers($: EngineInterface): Promise<void> {
  return syncSourceTimers($)
}

export function __toolsCapDropped(): number {
  let n = 0
  for (const st of S.famStates.values()) n = Math.max(n, capDroppedOf(st))
  return n
}

export function __runEnvSources($: EngineInterface, families?: Collector<unknown>[]): Promise<void> {
  return runEnvSources($, families ?? REG.families)
}

export function __refresh($: EngineInterface): Promise<void> {
  return refresh($)
}

export function __timerRefusedSize(): number {
  return S.timerRefused.size
}

export function __activeSources(ids: string[]): string[] {
  const set = new Set(ids)
  const out: string[] = []
  for (const fam of REG.families) {
    for (const entry of fam.sources) {
      const src = entry.source
      if (src.kind !== 'cmd' && src.kind !== 'file' && src.kind !== 'clock' && src.kind !== 'transcript') continue
      if (!entryIds(fam, entry).some((id) => set.has(id))) continue
      out.push(sourceKey(src))
    }
  }
  return out
}

export function __feed(input: Input): void {
  dispatch(input)
}

export function __render(raw: Record<string, string>, width = 140, maxRows = 8): unknown {
  S.hostRaw = raw // the stand holds the same host truth as the live path (S1-FIX4 П.2)
  applyOptions(raw)
  const view = S.cfg.view
  const vars = buildVars(S.cfg.elements, view, S.cfg.nf)
  const lines = drawLines(vars, S.cfg.tpl, view, S.cfg.elements, width, maxRows, S.cfg.nf)
  const detail = (id: string): string => detailOf(id, S.cfg.elements, S.cfg.nf)
  return buildBarTree(lines, view, width, STAND_TABLE, view.details === 'hover', detail, S.cfg.elements, S.cfg.nf)
}

// The picker's own tree through the same stand: snapshots render it to text.
export function __renderPicker(raw: Record<string, string>, tab: string, width = 120, focusId?: string, store?: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void>; delete: (key: string) => Promise<void> }, engine?: Record<string, unknown>): unknown {
  S.hostRaw = raw // the stand holds the same host truth as the live path (S1-FIX4 П.2)
  applyOptions(raw)
  const table: PickerTable = {
    Box: (props) => ({ type: 'Box', props, children: props['children'] }),
    Text: (props) => ({ type: 'Text', props, children: props['children'] }),
    Button: (props) => ({ type: 'Button', props, children: props['label'] !== undefined ? [String(props['label'])] : undefined }),
    Input: (props) => ({ type: 'Input', props, children: [(props['value'] as string) ?? ''] }),
  }
  if (!S.draft) S.draft = freshDraft()
  S.draft.tab = tab
  if (focusId !== undefined) {
    S.draft.focus = null
    outer: for (let li = 0; li < S.draft.lines.length; li++) {
      for (let si = 0; si < S.draft.lines[li]!.length; si++) {
        if (S.draft.lines[li]![si]!.id.split('#')[0] === focusId) {
          S.draft.focus = { line: li, seg: si }
          break outer
        }
      }
    }
  }
  const { model, actions } = pickerModel({ plugin: { name: 'catalyst-statusline', root: '/stand' }, ui: { log: async () => undefined }, store: store ?? { get: async () => undefined, set: async () => undefined, delete: async () => undefined }, session: { id: async () => 'stand' }, ...(engine ?? {}) } as unknown as EngineInterface, { requestId: PANE_ID }, STAND_TABLE)
  const view = resolveView(S.draft.axes, S.userThemes).view
  const nf = buildNf(S.draft.axes)
  const vars = buildVars(S.draft.elements, view, nf)
  const lines = drawLines(vars, { lines: S.draft.lines, sep: view.separator, evict: S.cfg.tpl.evict }, view, S.draft.elements, width, S.lastMaxRows, nf)
  const preview = buildBarTree(lines, view, width, table as unknown as Table, false, () => '', S.draft.elements, nf)
  return buildPicker(model, table, actions, preview)
}

export function __diag(): Diag[] {
  return S.diag
}

export function __state(): { view: View; tpl: Tpl; themeName: string; rawOptions: Record<string, string>; elements: Record<string, ElemSettings>; maxRows: number; registryErrors: string[] } {
  return { view: S.cfg.view, tpl: S.cfg.tpl, themeName: S.cfg.themeName, rawOptions: S.cfg.rawOptions, elements: S.cfg.elements, maxRows: S.lastMaxRows, registryErrors: REG.duplicateIds.slice() }
}

export function __themes(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const [name, def] of Object.entries(THEMES)) out[name] = { ...def.axes }
  return out
}
