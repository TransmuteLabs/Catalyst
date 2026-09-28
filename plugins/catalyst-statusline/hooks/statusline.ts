import type { EngineInterface, On, PluginOptions } from 'claude-code'
import type { Collector, ElementDef, Input, NumberFormat, Row, SessionInfo, Source, Value, Variant } from './data/types'
import { FAMILIES } from './data/index'
import { boundText, NORM, SESS_ID_PATHS, snapshotText } from './data/snapshotText'
import { cloneState } from './data/cloneState'
import { own, setOwn } from './data/own'
import { agentScopeOf, applySnapshot, replaySnapshot, snapshotOf } from './data/base'
import type { BaseState } from './data/base'
import { PALETTES, THEMES, THEME_AXES, type Pal } from './themes'
import { buildPicker, changedWord, type PickerActions, type PickerModel, type PickerTable } from './picker'

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
// CONSTRAINT (#521 FIX6 Р9): every move of a bare key below reads it, then deletes it with no compare ($.store has none) — a write of the previous version to that bare key in between is lost; running alongside the previous version is not supported (NOTES.md)
// CONSTRAINT (#521 FIX4 Ф2): one open flag per open, STORE_OPEN + ':' + its
// token, `{session, token, t}`; «open in session X» = some flag names X. A
// close deletes only its own key. The bare key is the pre-FIX4 flag, moved to
// its token key by a restore of the session it names (#521 FIX5 Ч1)
const STORE_OPEN = 'statusline.open.v1'
// CONSTRAINT (#521 FIX8b Р1): a close marks the panel's SESSION,
// STORE_OPEN_CLOSED + ':' + session, `{t}` — the close's instant — before its
// flags are deleted. A flag write begun in an earlier state or environment
// may land after the delete, under a token the closing state never knew; a
// flag of session S is open only while its `t` is past S's mark — the restore
// deletes the others and keeps the mark. Every flag write is stamped past
// the latest close this environment knows (flagStamp, lastCloseT), and a
// close is stamped past the latest one before it. The mark ages out with the
// flags (DRAFT_KEEP_MS). Not a prefix of STORE_OPEN + ':' — a mark is never read as a flag
const STORE_OPEN_CLOSED = 'statusline.open-closed.v1'
// CONSTRAINT (#521 FIX2 Р13): a draft lives under STORE_DRAFT + ':' + its
// session; the bare key is the pre-FIX2 single slot, read once for transfer
const STORE_DRAFT = 'statusline.draft.v1'
const DRAFT_KEEP_MS = 7 * 24 * 3600 * 1000
// CONSTRAINT (#521 FIX5 Ч3): the open panel's flag and draft are re-stamped at
// least this often — well inside DRAFT_KEEP_MS, so another process's prune
// never reaches a live panel
const KEEP_ALIVE_MS = 24 * 3600 * 1000
// CONSTRAINT (#521 FIX5 Ч1, FIX6 Р1): the moved bare flag's token is this
// prefix + the session it names — a second mover of the same session writes
// the same key, a mover of another session its own
const LEGACY_TOKEN = 'legacy-'
// AR6: one key per session, `sess:<id>` — a snapshot of another session is
// never read. CONSTRAINT (FIX6 Р4): the plugin store is one 4 MiB file shared
// by every process and session of the user (d.ts:2909-2940); a landed write of
// the current session's key prunes the `sess:` keys to the SESS_KEEP newest by
// (seq, origin), never the current key nor a key this process still writes
const STORE_SESS = 'sess:'
// CONSTRAINT (#521 FIX4 Ф3): the save mark and the undo record live one per
// save, `<base>:<saveId>` with its own stamp `t`; a save writes and deletes only
// its own keys, and no array is held across an await. The bare keys are the
// pre-FIX4 single mark and undo array, laid out by saveId once
const STORE_SAVING = 'statusline.saving.v1'
const STORE_UNDO = 'statusline.undo.v1'
const STORE_LASTGOOD = 'statusline.lastgood.v1'
const STORE_THEMES = 'statusline.themes.v1'
const SEGMENT_KEY = 'seg:'
const UNDO_CAP = 30
// the stamp of a save mark moved out of the bare key (#521 FIX6b Б5, FIX8
// Р2). CONSTRAINT: moved records are stamped below zero and every stamp this
// version writes is above it (stampMs() ≥ 0), whatever the clock reads — a
// moved undo record gets its position minus the bare array's length (−N…−1,
// source order), the moved mark −0.5: newer than all of them, older than any
// record of this version
const MOVED_MARK_T = -0.5
// the draft's own undo stack (#521 Р6), stored with the draft
const DRAFT_UNDO_CAP = 50
const WIDTH_FALLBACK = 80
// CONSTRAINT (FIX5 Р3/Р4): the session write queue is module-level, not in S,
// but a host reload is a new environment whose maps start empty (d.ts:2946-2947:
// a hot reload cancels the pending waits with the old environment) —
// a flight of the old environment is out of reach, its late landing is seen
// only by the read-back of the key (Д3). What this code bounds is wipeState
// (register, __resetState): it clears the maps and raises the generation; a
// flight of an older generation moves no accounting, and its late landing
// below a newer known value is followed by that value again (Д2).
// CONSTRAINT (FIX5 Р1, FIX6 Р5): every value of a `sess:<id>` key carries
// `seq`, taken when the state is captured, and `origin`, the id of the module
// instance that captured it; values are ordered by (seq, origin), a value
// without origin has origin "". A value not above the key's last LANDED one is
// never written, restore takes the newest of store and queue.
type SessValue = Record<string, unknown> & { seq: number }
type Ord = { seq: number; origin: string; n?: number }
// CONSTRAINT (FIX9 Ж2, FIX10 Ж10): successive own snapshots that share a capped
// seq and origin are ordered by the local counter n. n is serialized into every
// snapshot (stampSnapshot) and ordOf reads it back from the value: a read-back
// of the key's own newest body ties with LANDED (no endless re-put), while a
// stale late landing sits below it and the read-back re-queues the newest body.
let seqN = 0
function stampSnapshot(value: Record<string, unknown>): SessValue {
  return { ...value, seq: nextSeq(), origin, n: seqN, norm: NORM }
}
const FAREWELL = new Map<string, SessValue>()
type WriteOwner =
  | { kind: 'session'; recovery: Recovery; g: number }
  | { kind: 'farewell'; g: number }
// `$` may not be put in an object (the resolver law): the item carries the
// enqueuing call's own `$` as closures over it (Р3); null = none of a live
// generation, the gather that runs it lends its own (FIX6b AR4)
type StoreIO = {
  put: (key: string, value: unknown) => Promise<void>
  arm: (fn: () => void) => { cancel: () => void }
  get: (key: string) => Promise<unknown>
  keys: () => Promise<string[]>
  del: (key: string) => Promise<void>
}
// `atEnd`: the item was started by session.end and that hook still waits for
// it (Р6); `settle` releases that wait. `sent`: the host really took the
// store.set call — the end record speaks only of such items (FIX7 Р1)
type WriteItem = {
  value: SessValue
  ord: Ord
  owner: WriteOwner
  io: StoreIO | null
  atEnd: boolean
  sent: boolean
  settle: () => void
}
// `at`: now() at the flight's start, for the gather-start sweep (Д5, FIX6 Р2)
type Flight = { item: WriteItem; hung: boolean; at: number }
// a key has a slot exactly while a flight of it runs; `next` is the newest
// value requested meanwhile
type SessSlot = { flight: Flight | null; next: WriteItem | null }
const SESS_Q = new Map<string, SessSlot>()
// CONSTRAINT (FIX6b Р1′): the count of store.set calls of a key the host has
// not settled, of every generation of this environment — a wipe leaves it,
// only the stand's reset starts it over (the epoch turns away a settle from
// before); a count, not the flights: a put the host never settles holds no
// value here. A key has at most SESS_FLIGHTS of them: the first hung write
// frees the key, the second does not — newer values wait in the slot until
// one settles, then the next gather writes the newest
const INFLIGHT = new Map<string, number>()
const SESS_FLIGHTS = 2
let inflightEpoch = 0
// CONSTRAINT (FIX6 Р3): the last value this process saw land, or read back at
// a restore — data only; a re-put goes out through the `$` of the flight that
// settled or of the gather that read back. A key leaves when it has no slot,
// no farewell, no unsettled store.set and is not the current session's; at most
// SESS_KEEP keys stay, the lowest (seq, origin) goes first.
type Landed = Ord & { value: SessValue }
const LANDED = new Map<string, Landed>()
const STORE_HANG_MS = 15000
const SESS_KEEP = 32
// CONSTRAINT (FIX8 Ф7): the record knows the store.set promise did not
// settle — whether the value reached the store it cannot say (a value that
// landed may hang in its promise), so it never claims the value unstored
const END_TAIL = '; the value may not be stored'
// seq = clock ms × 1000, or the previous seq + 1 when that is not above it
// (equal milliseconds, a clock gone back, a refused clock after a reload)
const SEQ_PER_MS = 1000
const SEQ_CAP = 2 ** 52
let seqLast = 0
const newOrigin = (): string => {
  try {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // CONSTRAINT (#521 Р11): runs at module load, before S exists — no record
    // is possible; the fallback is a valid origin, it only names this writer
    return __fallbackOrigin()
  }
}
// CONSTRAINT (FIX7 Р11): the fallback is a fixed 16 hex chars — a short draw
// must never read as the origin "" of values written before FIX5 Р5
export function __fallbackOrigin(): string {
  let out = ''
  while (out.length < 16) out += Math.random().toString(16).slice(2)
  return out.slice(0, 16)
}
let origin = newOrigin()

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
      setOwn(settings, km[1]!, km[2]!)
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
  const e = own(elements, id)
  return e ? own(e, key) : undefined
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
  if (own(BAR_PAIRS, raw)) {
    const pair = own(BAR_PAIRS, raw)!
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
  const themeName = raw['theme'] && (own(THEMES, raw['theme']) || own(userThemes, raw['theme'])) ? raw['theme'] : 'hud'
  // CONSTRAINT (S1-FIX4 П.1): the unknown-theme condition is a RESULT the
  // caller decides on; the diagnosis below is written only when not suppressed.
  const unknown = !!(raw['theme'] && raw['theme'] !== 'hud' && !own(THEMES, raw['theme']) && !own(userThemes, raw['theme']))
  // CONSTRAINT (S1-FIX6 П.4): with the stored themes unread an unknown name is
  // not the user's breakage — themes-read already names the cause.
  if (unknown && diagnose && !S.themesFailed) {
    // SPEC §14.5.2: an unknown theme name is a diagnosis and the last good config
    failDiag('warn', 'theme-unknown', "theme: unknown name '" + raw['theme'] + "'; the default theme applies")
  }
  const userDef = own(userThemes, themeName)
  const builtin = own(THEMES, themeName)
  // a saved user theme stores every axis RESOLVED, palette included
  const theme: Record<string, string> = builtin ? { ...builtin.axes } : { ...(userDef ?? THEMES['hud']!.axes) }
  const pick = (axis: string, fallback: string): string => {
    const v = raw[axis]
    if (v === undefined || v === '') return fallback
    if (v === 'theme') return theme[axis] ?? fallback
    const opts = own(AXIS_OPTIONS, axis)
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
    pal: own(PALETTES, paletteName) ?? PALETTES['semantic']!,
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

// the stand's seam; in the host nowOverride stays null
let nowOverride: (() => number) | null = null
const now = (): number => (nowOverride !== null ? nowOverride() : ((globalThis as any).performance?.now?.() ?? Date.now()))

// Feeds and refusal deadlines share one stamp. A refused $.clock.now keeps the
// previous stamp so a deadline is not moved by the refusal itself.
let clockMs = 0

// the wall stamp of the stores' records: the last clock read, the process
// clock before the first one (the base nextSeq uses)
function stampMs(): number {
  return clockMs > 0 ? Math.floor(clockMs) : Date.now()
}

// CONSTRAINT (#521 FIX2 Р14/Р27): a save's saveId and an open's token — the
// stamp and a module counter, unique within this environment. CONSTRAINT
// (#521 FIX4 Ф3): the counter is zero-padded — the undo records of one stamp
// order by the saveId string
let stampN = 0
function stampId(): string {
  return String(stampMs()) + '-' + String(++stampN).padStart(8, '0')
}

// the order of the undo records and the save marks: by stamp, then by saveId
function byStamp(a: { t: number; saveId: string }, b: { t: number; saveId: string }): number {
  if (a.t !== b.t) return a.t - b.t
  return a.saveId < b.saveId ? -1 : a.saveId > b.saveId ? 1 : 0
}

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
  // CONSTRAINT (#521 Р11): the three catches below are the answer's own —
  // a refusal reads as 'unprintable error' in the record of the caller
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
      const v = own(vars, name)
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

type DraftSnap = { lines: Seg[][]; axes: Record<string, string>; elements: Record<string, ElemSettings> }

type Draft = {
  lines: Seg[][]
  axes: Record<string, string>
  elements: Record<string, ElemSettings>
  focus: { line: number; seg: number } | null
  tab: string
  query: string
  fam: string
  page: number
  targetLine: number
  themeName: string
  // the tab «Элемент» was entered from: its «← Назад» returns there
  from: string
  // content snapshots before each draft edit, the newest last
  undo: DraftSnap[]
}

type TimerRun = { key: string; every: number; lastTick: number; cancel: () => void }

type Recovery = {
  session: string
  status: 'pending' | 'complete' | 'lost'
  buffer: Input[]
  reading: Promise<void> | null
  writePending: boolean
  // the item whose refusal or hang set writePending (null: a state change did)
  retryFor: WriteItem | null
}

function freshRecovery(session = ''): Recovery {
  return { session, status: 'pending', buffer: [], reading: null, writePending: false, retryFor: null }
}

const ACCUMULATOR_IDS = new Set(['sum', 'tokens-total', 'tools', 'ag'])
const ACCUMULATOR_EVENTS = new Set(['session.start', 'turn.start', 'turn.complete', 'tool.call', 'agent.spawn'])

type State = {
  recoveryEnabled: boolean
  recovery: Recovery
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
  // CONSTRAINT (F7/Р4): ONE ticket for every session source of the state — a
  // newer gather's answer may not be outranked by an older one on any source:
  // an older source answer cannot land over a session a younger gather set
  sessionTicketSeen: number
  surveyDiag: boolean
  interactive: boolean
  started: boolean
  restored: boolean
  statusCleared: boolean
  messagesDone: boolean
  pickerOpen: boolean | undefined
  pickerSession: string
  // the token of the STORE_OPEN record this state wrote or restored (#521 FIX2 Р27)
  openToken: string
  // CONSTRAINT (#521 FIX5 Ч8): every token this state wrote or adopted whose
  // key was not yet deleted — the close deletes them all
  ownTokens: Set<string>
  // the token whose flag write landed; only it is re-stamped (#521 FIX5 Ч3)
  flagToken: string
  // the re-stamp timer of the open panel (#521 FIX5 Ч3)
  keepAlive: { cancel: () => void } | null
  // CONSTRAINT (#521 FIX6b Б1): raised by every close; an open that sees it
  // change across one of its awaits yields to that close
  closes: number
  // CONSTRAINT (#521 FIX5 Ч6): set while openPicker decides the draft — a pane
  // render then creates none
  opening: boolean
  draft: Draft | null
  // CONSTRAINT (#521 FIX4 Ф6, FIX5 Ч9): a draft whose write was refused stays
  // here, by session, with the stamp of that write, until a later write lands
  // it; a stored draft of the session stamped later supersedes it
  pendingDrafts: Map<string, { draft: Draft; t: number }>
  // the session whose old single slot was read but not yet moved (#521 FIX4 Ф10)
  slotMovePending: string
  // CONSTRAINT (#521 FIX4b AR1, FIX5 Ч6): raised by setDraft whenever the
  // draft or its session changes; a picker tree carries the value it was
  // drawn under and acts only while it still stands
  draftEpoch: number
  // the element key the keyboard last focused in our pane (ui.focus); the
  // picker draws the card row / the theme preview from it
  focusKey: string
  // Д3 п.1: the width reference of every element/variant stub — the value-part
  // length of its last ok text; wiped with the state (def.sample serves again)
  stubWidth: Map<string, number>
  // the effort seed (ADJUDICATION-S2 #8/#9): one successful $.config.list()
  // per state; a refused read nulls the memo and the next refresh retries
  effortSeeded: boolean
  effortSeed: Promise<void> | null
  follows: number
  moves: number
  actions: Promise<unknown>
  saving: { fields: string[]; values: Record<string, string> } | null
  saveResult: string
  themeNote: string
  lastMaxRows: number
  // CONSTRAINT (#521 Р4): lastMaxRows is a ceiling only once a band render
  // measured it; before that + строка has none
  bandMeasured: boolean
  // entries of the saved-writes undo stack as last read or written
  undoDepth: number
  // CONSTRAINT (#521 FIX5 Ч4): keyed by the name the list shows — a stored
  // name shared by several themes is told apart by « (2)», « (3)» in stamp
  // order
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
  // Д3: the process clock (now()) at the last read-back of the session key; null = none yet
  sessVerifyAt: number | null
  // CONSTRAINT (S4-FIX16d Г2, S4-FIX16e Е3): grows in feed's session-change branch, its first binding there included; restoreSession binds without growth — the key is empty before it, no read is in flight
  sessEpoch: number
  // a read-back of the key in flight, since now() (FIX6 Р8)
  verifyPending: Map<string, number>
  // diagnostic episodes open, `<diag key>|<store key>` (FIX6 Р1)
  episodes: Set<string>
  // now() of the last prune of the `sess:` keys (FIX6 Р4)
  pruneAt: number | null
}

// CONSTRAINT (S1-FIX3 F6): the declaration-time value of the WHOLE state —
// the module init and the stand's __resetState share this one factory.
function freshState(): State {
  return {
    recoveryEnabled: false,
    recovery: freshRecovery(),
    famStates: new Map(),
    cfg: { tpl: { lines: [], sep: ' │ ', evict: EVICT_ORDER_BASE.slice() }, view: {} as View, themeName: 'hud', rawOptions: {}, elements: {}, userThemes: {}, nf: buildNf({}) },
    diag: [],
    diagLogged: 0,
    diagDropped: 0,
    diagOnce: new Set(),
    drawnKey: undefined,
    refreshesBegun: 0,
    refreshShown: 0,
    sessionTicketSeen: 0,
    surveyDiag: false,
    interactive: false,
    started: false,
    restored: false,
    statusCleared: false,
    messagesDone: false,
    pickerOpen: undefined,
    pickerSession: '',
    openToken: '',
    ownTokens: new Set(),
    flagToken: '',
    keepAlive: null,
    closes: 0,
    opening: false,
    draft: null,
    pendingDrafts: new Map(),
    slotMovePending: '',
    draftEpoch: 0,
    focusKey: '',
    stubWidth: new Map(),
    effortSeeded: false,
    effortSeed: null,
    follows: 0,
    moves: 0,
    actions: Promise.resolve(),
    saving: null,
    saveResult: '',
    themeNote: '',
    lastMaxRows: 8,
    bandMeasured: false,
    undoDepth: 0,
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
    sessVerifyAt: null,
    sessEpoch: 0,
    verifyPending: new Map(),
    episodes: new Set(),
    pruneAt: null,
  }
}

const S: State = freshState()

let generation = 0
// the latest close instant this environment knows — its own closes and the
// close marks its restores read (#521 FIX8b Р1, FIX8c); a wipe leaves it, as
// it leaves the generation counter
let lastCloseT = 0

// every wipe of S goes through here: the new state gets a generation no
// operation begun before the wipe holds
function wipeState(): void {
  for (const timer of S.timers.values()) {
    // CONSTRAINT (#521 Р11): a slot's cancel records its own refusal
    // (timer-cancel-refused, syncBody); S is replaced on the next line
    try { timer.cancel() } catch { /* a refused cancel must not keep a stale timer armed */ }
  }
  // its ticks also stop themselves once their state is gone (#521 FIX5 Ч3)
  let cancelRefused: { err: unknown } | null = null
  try {
    S.keepAlive?.cancel()
  } catch (err) {
    cancelRefused = { err }
  }
  Object.assign(S, freshState())
  S.gen = ++generation
  // CONSTRAINT (#521 FIX6 Р6): the refusal is recorded in the new state — the
  // old one is gone
  if (cancelRefused) failDiag('info', 'picker-keepalive-cancel', keepAliveCancelText(cancelRefused.err))
  FAREWELL.clear()
  SESS_Q.clear()
  LANDED.clear()
}

function live(g: number): boolean {
  return S.gen === g
}

// an operation that outlived its state, or a gather a newer one outran, is
// dropped aloud (SPEC §13.4) — each cause under its own key and text
function staleDrop(what: string, cause: 'reset' | 'newer' = 'reset'): void {
  if (cause === 'newer') failDiag('warn', 'stale-' + what + '-newer', what + ': outrun by a newer gather; dropped, the newer gather\'s answers stand')
  else failDiag('warn', 'stale-' + what, what + ': begun before the state was reset; dropped, the new state decides for itself')
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
// `once` is the dedup key of a non-fail record: the record's own key by default
function failDiag(kind: string, key: string, text: string, once: string = key): void {
  if (kind !== 'fail' && S.diagOnce.has(once)) return
  if (kind !== 'fail') S.diagOnce.add(once)
  pushDiag(kind, key, text)
}

// CONSTRAINT (FIX6 Р1): one record per episode of a store key — the episode
// begins at its first record and ends where the key's own success ends it
// (endEpisode), for every kind, `fail` included
function episodeDiag(kind: string, key: string, storeKey: string, text: string): void {
  const id = key + '|' + storeKey
  if (S.episodes.has(id)) return
  S.episodes.add(id)
  pushDiag(kind, key, text)
}

function endEpisode(storeKey: string, keys: string[]): void {
  for (const key of keys) S.episodes.delete(key + '|' + storeKey)
}

function pushDiag(kind: string, key: string, text: string): void {
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

async function quiet(label: string, fn: () => Promise<void>): Promise<void> {
  // SPEC §10.4: a failure leaves the previous value standing
  const g = S.gen
  try {
    await fn()
  } catch (err) {
    // the bodies record their own refusals; a throw that escapes one is named here
    if (live(g)) failDiag('fail', 'unhandled-' + label, 'background run ' + label + ' threw: ' + errorText(err))
  }
}

// CONSTRAINT (#521 FIX2 Р19): a refused redraw is recorded and tried once more
// after 250 ms; a second refusal is recorded only. `g` is the caller's state:
// a stale path redraws through here by design (act), and neither its record
// nor its retry may land in the state now current (S1-FIX6 П.1)
function invalidate($: EngineInterface, g: number = S.gen): void {
  try {
    $.ui.invalidate('ui.render')
    return
  } catch (err) {
    if (!live(g)) return
    let retry = 'one retry in 250 ms'
    try {
      $.clock.after(250, () => {
        if (!live(g)) return
        try {
          $.ui.invalidate('ui.render')
        } catch (again) {
          if (live(g)) failDiag('warn', 'picker-invalidate', 'ui.invalidate refused again: ' + errorText(again) + '; the pane redraws at the next event')
        }
      })
    } catch (armErr) {
      retry = 'the retry could not be armed: ' + errorText(armErr) + '; the pane redraws at the next event'
    }
    failDiag('warn', 'picker-invalidate', 'ui.invalidate refused: ' + errorText(err) + '; ' + retry)
  }
}

function flushDiag($: EngineInterface): void {
  // CONSTRAINT (S1-FIX4 П.6): a log that throws must NOT zero the counter —
  // otherwise the dropped records would be forgotten silently.
  if (S.diagDropped > 0) {
    try {
      $.ui.log('[statusline] fail: diag overflow dropped ' + S.diagDropped + ' unsent record(s)', { to: 'debug' })
    } catch {
      // CONSTRAINT (#521 Р11): the log is the diagnostics' own channel — the
      // count stays and ships at the next flush
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
      // CONSTRAINT (#521 Р11): the log is the diagnostics' own channel — the
      // record stays queued for the next flush
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

// CONSTRAINT (S4-FIX12 Н3): the activity family's own drop counter, same
// shape as capDroppedOf — a state without the field (any other family) reads 0
function agentsDroppedOf(state: unknown): number {
  if (!state || typeof state !== 'object') return 0
  const n = (state as { agentsDropped?: unknown }).agentsDropped
  return typeof n === 'number' ? n : 0
}

// CONSTRAINT (S4-FIX11 Н2): the diagnostic name of a family must not itself
// be a throw site — `fam.family` is read from a registry element that may be
// corrupt (critic swe2 F2: a getter that raises, or a null entry). The total
// answer is '<unnamed>'.
const safeFamily = (fam: Collector<unknown>): string => {
  try {
    return String(fam.family)
  } catch {
    // CONSTRAINT (#521 Р11): '<unnamed>' in the caller's record is the refusal's form
    return '<unnamed>'
  }
}

// CONSTRAINT (S4-FIX16 Г1, S4-FIX16b Б2): a reset erases the figures, not the session identity, at both reset sites
function initFor(fam: Collector<unknown>, session: unknown): unknown {
  const fresh = fam.init()
  if (fresh && typeof fresh === 'object' && Object.prototype.hasOwnProperty.call(fresh, 'session') && typeof session === 'string' && session !== '') (fresh as { session: unknown }).session = session
  return fresh
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
  // CONSTRAINT (S4-FIX11 Н3, S4-FIX12 Н2 п.4): the reduce gets a CLONE of
  // the stored state — a feed that throws midway (a data getter that raises,
  // critic sol №2) leaves S.famStates at the untouched original; the clone is
  // installed only where the reduce returned. The clone also breaks the
  // in-place mutation the reducers do on their input state (activity, usage).
  // A state that cannot be cloned cannot be reduced safely either, and the
  // pre-FIX12 form froze the family on EVERY later input — so a clone refusal
  // resets the family to init() and the current input reduces onto the fresh
  // state, with the reset diagnosed aloud. The `fail` kind is not
  // deduplicated: the record is written on every refused input, bounded by
  // CAP.diag (S4-FIX13 Т7, swe2 F4).
  let prior: unknown
  try {
    prior = cloneState(famState(fam))
  } catch (err) {
    let bound: string | undefined
    let session = 'unknown'
    if (fam === FAMILIES[0]) {
      // CONSTRAINT (S4-FIX16d Г4): a getter of the refused state may lie without throwing; the binding comes from the pair its writers keep (FIX5 X10)
      if (typeof S.recovery.session === 'string' && S.recovery.session !== '') session = bound = S.recovery.session
      else {
        // CONSTRAINT (S4-FIX15 В3): the raw state is read only for the name in
        // the text; a refused read gives `unknown`
        try {
          const s = (famState(fam) as { session?: unknown }).session
          if (typeof s === 'string' && s !== '') session = s
        } catch { /* CONSTRAINT (#521 Р11): a text-only read — `unknown` in the record shows it */ }
      }
    }
    let fresh: unknown
    let freshPrior: unknown
    try {
      fresh = initFor(fam, bound)
      freshPrior = cloneState(fresh)
    } catch (e) {
      failDiag('fail', 'family-init-failed', 'family ' + safeFamily(fam) + ': could not build a fresh state (init, session rebind or clone) to replace a state that failed: ' + errorText(e))
      throw err
    }
    // CONSTRAINT (S4-FIX16c В1): the reset record is written only once the reset has happened
    if (fam === FAMILIES[0]) failDiag('fail', 'family-state-reset', 'family ' + safeFamily(fam) + ': its state could not be cloned and was reset to init; the accumulated figures of session ' + session + ' are lost: ' + errorText(err))
    else failDiag('fail', 'family-state-reset', 'family ' + safeFamily(fam) + ': its state could not be cloned and was reset to init: ' + errorText(err))
    S.famStates.set(fam, fresh)
    prior = freshPrior
  }
  // CONSTRAINT (Р1): the farewell is taken from the clone BEFORE the reduce —
  // the reduce switches the id and resets the old session's accumulators; a
  // read of the raw state threw on a poisoned getter ahead of the reset
  // branch; the write itself runs where a `$` is in reach (flushFarewell:
  // gather start, session.end)
  if (fam === FAMILIES[0] && input.source.kind === 'session' && input.source.call === 'info' && input.ok) {
    const id = (input.data as { id?: unknown } | null | undefined)?.['id']
    if (typeof id === 'string' && id !== '') {
      const prev = prior as BaseState
      // INVARIANT (FIX5 X10): base.session !== '' ⇒ S.recovery.session ===
      // base.session — its writers keep the pair together (statusline.ts
      // :1145-1149, :2970-2976, :3010, wipeState). The recovery
      // test is a bound, not a live branch.
      if (prev.session !== '' && id !== prev.session && S.recovery.status === 'complete' && S.recovery.session === prev.session) {
        // CONSTRAINT (S4-FIX15 В1): the farewell is a by-product of the switch
        // and does not hold it
        try {
          const fw = snapshotOf(prev)
          // CONSTRAINT (FIX7 Р12): a value the JSON round-trip cannot carry is
          // diagnosed and skipped — the input's dispatch must not be held by it
          if (fw !== null) {
            try {
              FAREWELL.set(fw.session, stampSnapshot(JSON.parse(JSON.stringify(fw.value))))
            } catch (err) {
              failDiag('fail', 'session-snapshot-copy', 'the session snapshot of ' + fw.session + ' could not be copied for the store: ' + errorText(err))
            }
          }
        } catch (err) {
          failDiag('fail', 'session-farewell-lost', 'session ' + (typeof prev.session === 'string' ? prev.session : 'unknown') + ': the farewell snapshot could not be taken; the accumulated figures of that session are not recorded: ' + errorText(err))
        }
      }
    }
  }
  // CONSTRAINT (S4-FIX13 Т1, sol 1): the drop counters are read from the
  // clone — a read of the raw state before the clone threw on a poisoned
  // getter ahead of the reset branch, and the family repeated the refusal on
  // every input
  let before = capDroppedOf(prior)
  let beforeAgents = agentsDroppedOf(prior)
  // CONSTRAINT (S4-FIX15 В2): an input that throws on a fresh state too does
  // not erase the accumulated state; a state the reduce throws on, while the
  // fresh one reduces, is reset aloud
  let next: unknown
  try {
    next = fam.reduce(prior, input)
  } catch (err) {
    let freshNext: unknown
    let freshPrior: unknown
    try {
      const fresh = initFor(fam, prior && typeof prior === 'object' && Object.prototype.hasOwnProperty.call(prior, 'session') && typeof (prior as { session?: unknown }).session === 'string' ? (prior as { session: string }).session : undefined)
      freshNext = cloneState(fresh)
      freshPrior = cloneState(fresh)
    } catch (e) {
      failDiag('fail', 'family-init-failed', 'family ' + safeFamily(fam) + ': could not build a fresh state (init, session rebind or clone) to replace a state that failed: ' + errorText(e))
      throw err
    }
    try {
      next = fam.reduce(freshNext, input)
    } catch {
      // CONSTRAINT (#521 Р11): the original failure goes on to the caller's record
      throw err
    }
    failDiag('fail', 'family-state-reset', 'family ' + safeFamily(fam) + ': its state could not be reduced and was reset to init: ' + errorText(err))
    before = capDroppedOf(freshPrior)
    beforeAgents = agentsDroppedOf(freshPrior)
  }
  if (fam === FAMILIES[0]) {
    const base = next as BaseState
    if (base.session !== '' && base.session !== S.recovery.session) {
      S.sessEpoch++
      if (S.recovery.session !== '') {
        S.recovery = freshRecovery(base.session)
        S.diagOnce.delete('dur-clock')
        // CONSTRAINT (S4-FIX15 В5, S4-FIX16 Г3, S4-FIX16b Б1): a session
        // change frees the session's own records — the key-merge episodes and
        // cap, tools-cap, activity-agents-cap, session-snapshot-stale,
        // session-verify-stale|* and the array-cap episodes (session-root is
        // deduplicated per session id, #521 FIX4 Ф8); the write and
        // verify episodes (EPISODE_WRITE, session-snapshot-verify) and the
        // global prune / seq-cap episodes end by themselves and stay
        for (const id of [...S.episodes]) if (id.startsWith('session-snapshot-key-merge|')) S.episodes.delete(id)
        S.diagOnce.delete('session-snapshot-key-merge-cap')
        S.diagOnce.delete('tools-cap')
        S.diagOnce.delete('activity-agents-cap')
        S.diagOnce.delete('session-snapshot-stale')
        for (const k of [...S.diagOnce]) if (k.startsWith('session-verify-stale|')) S.diagOnce.delete(k)
        for (const id of [...S.episodes]) if (id.startsWith('session-snapshot-array-cap|')) S.episodes.delete(id)
      } else S.recovery.session = base.session
    }
    const recovery = S.recovery
    if (input.source.kind === 'event' && ACCUMULATOR_EVENTS.has(input.source.event) && recovery.status === 'pending') {
      if (recovery.buffer.length === 256) {
        recovery.status = 'lost'
        recovery.buffer = []
        failDiag('fail', 'session-snapshot-lost', 'session ' + recovery.session + ': recovery exceeded 256 live inputs; accumulated figures stay unknown until the session changes')
      } else {
        const data = input.data && typeof input.data === 'object' ? input.data as Record<string, unknown> : {}
        const usage = data['usage']
        recovery.buffer.push({ ...input, data: { ...data, ...(usage && typeof usage === 'object' ? { usage: { ...usage } } : {}) } })
      }
    }
  }
  S.famStates.set(fam, next)
  // CONSTRAINT (S4-FIX13 Т5, swe2 F3): a `warn` is deduplicated at its first
  // record, so a count in the text would be the count of the first overflow
  const after = capDroppedOf(next)
  if (after > before) failDiag('warn', 'tools-cap', 'active tools over cap 256; new calls are not tracked until a tracked call finishes')
  const afterAgents = agentsDroppedOf(next)
  if (afterAgents > beforeAgents) failDiag('warn', 'activity-agents-cap', 'activity agents over cap 64; finished agents are dropped first, then the oldest')
}

// ---------- values and composition ----------

function variantOf(def: ElementDef, elements: Record<string, ElemSettings>): string {
  return settingOf(elements, def.id, 'v') ?? def.variants[0]!.id
}

export function valueOf(id: string, variant: string | undefined, elements: Record<string, ElemSettings>, nf: NumberFormat): { def: ElementDef; value: Value } | null {
  const entry = REG.byId.get(id)
  if (!entry) return null
  const def = entry.def
  if (S.recoveryEnabled && S.recovery.status !== 'complete' && ACCUMULATOR_IDS.has(id)) return { def, value: { state: 'pending' } }
  if (id === 'dur') {
    const base = famState(FAMILIES[0]!) as BaseState
    const basis = base.durStartedAt >= 0 ? base.durStartedAt : base.durBase
    if (basis >= 0 && base.now < basis && !base.durLastGood) failDiag('warn', 'dur-clock', 'clock before session start')
  }
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
  const table = own(GLYPHS, id)
  if (!table) return ''
  const set = settingOf(elements, id, 'ic') ?? (table['unicode'] !== undefined ? 'unicode' : 'none')
  if (set === 'none') return ''
  const g = glyphs === 'ascii' ? table['ascii'] : own(table, set === 'none' ? 'unicode' : set) ?? table['unicode']
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

function composeElement(id: string, v: Value, elements: Record<string, ElemSettings>, view: View, nf: NumberFormat, rememberWidth = false): Composed | null {
  const entry = REG.byId.get(id)
  if (!entry) return null
  const def = entry.def
  if (v.state === 'nosource') return null
  const labelMode = settingOf(elements, id, 'lb') ?? (own(DEFAULT_LABEL, id) !== undefined && own(DEFAULT_LABEL, id) !== '' ? 'on' : 'off')
  const label = labelMode === 'off' ? '' : labelMode === 'text' ? settingOf(elements, id, 'lt') ?? '' : own(DEFAULT_LABEL, id) ?? ''
  const icon = iconOf(id, elements, view.glyphs)
  const prefix = [label, icon].filter(Boolean).join(' ')
  const stubKey = id + '#' + variantOf(def, elements)
  if (v.state === 'pending') {
    // §12.3: ЕЩЁ НЕТ holds the width of this element/variant's own last ЕСТЬ
    // value (def.sample before the first one), measured with the same plain
    // string length the line fit uses (assemble().length) — the band's own
    // width does not jump while the source has not answered
    const ref = S.stubWidth.get(stubKey) ?? def.sample.length
    return { text: (prefix ? prefix + ' ' : '') + '…' + ' '.repeat(Math.max(0, ref - 1)), stale: false, pending: true }
  }
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
  if (v.state === 'ok') {
    const text = def.kind === 'meter' ? meterText(v.text, v.ratio) : ((prefix ? prefix + ' ' : '') + v.text).trim()
    // the stub's width reference is the VALUE part of the ok text (the prefix
    // stays as is in the stub and may change by its own settings)
    if (rememberWidth) S.stubWidth.set(stubKey, Math.max(0, text.length - (prefix ? prefix.length + 1 : 0)))
    return { text, stale: false, pending: false, ratio: v.ratio }
  }
  if (v.state === 'stale') return markStale(def.kind === 'meter' ? meterText(v.last.text, v.last.ratio) : ((prefix ? prefix + ' ' : '') + v.last.text).trim())
  return { text: ((prefix ? prefix + ' ' : '') + v.text).trim(), stale: false, pending: false, ratio: v.state === 'ok' ? v.ratio : undefined }
}

// The variable dictionary the template engine reads: one entry per element.
function buildVars(elements: Record<string, ElemSettings>, view: View, nf: NumberFormat, rememberWidth = false): Record<string, Var> {
  const vars: Record<string, Var> = {}
  for (const id of REGISTRY_IDS) {
    const got = valueOf(id, undefined, elements, nf)
    if (!got) {
      vars[id + '.text'] = { v: '', st: 'absent' }
      continue
    }
    const comp = composeElement(id, got.value, elements, view, nf, rememberWidth)
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
    const icon = r.icon ? own(ROW_ICON, r.icon) ?? '' : ''
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
  const slot = own(SLOT_OF, id)
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
  const pair = own(CAP_PAIRS, view.caps)
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
// On success: the themes as listed, oldest first (#521 FIX5 Ч4)
async function readThemes($: EngineInterface, g: number): Promise<ShownTheme[] | 'failed' | 'stale'> {
  try {
    const records = await readThemeRecords($, g)
    if (records === null) return 'stale'
    const list = shownThemes(records)
    const themes: Record<string, Record<string, string>> = {}
    for (const { shown, record } of list) setOwn(themes, shown, record.axes)
    S.userThemes = themes
    S.themesFailed = false
    return list
  } catch (err) {
    if (!live(g)) return 'stale'
    S.themesFailed = true
    failDiag('fail', 'themes-read', 'user themes could not be read: ' + errorText(err) + '; saved theme names fall back to the default theme, and neither the last good configuration nor a theme is stored')
    return 'failed'
  }
}

function themeKeyOf(id: string): string {
  return STORE_THEMES + ':' + id
}

type ThemeRecord = { id: string; name: string; t: number; axes: Record<string, string> }

function themeAxesOf(x: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(x)) {
    if (k !== 'name' && k !== 't' && typeof v === 'string') setOwn(out, k, v)
  }
  return out
}

// The stored user themes, oldest first (#521 FIX5 Ч4). The pre-FIX5 bare map
// is moved first, one key per theme under `legacy-<name>-<content hash>`
// (#521 FIX6 Р4), stamp 0. null: stale.
async function readThemeRecords($: EngineInterface, g: number): Promise<ThemeRecord[] | null> {
  const bare = await $.store.get(STORE_THEMES)
  if (!live(g)) return null
  if (bare !== undefined) {
    if (bare && typeof bare === 'object' && !Array.isArray(bare)) {
      for (const [name, def] of Object.entries(bare as Record<string, unknown>)) {
        if (!def || typeof def !== 'object' || Array.isArray(def)) continue
        const key = themeKeyOf(legacyIdOf(name, def))
        // CONSTRAINT: a theme already moved is not moved again — a save under
        // its name may have rewritten the key since
        const moved = await $.store.get(key)
        if (!live(g)) return null
        if (moved !== undefined) continue
        await $.store.set(key, { name, ...themeAxesOf(def as Record<string, unknown>), t: 0 })
        if (!live(g)) return null
      }
    }
    try {
      await $.store.delete(STORE_THEMES)
    } catch (err) {
      if (live(g)) failDiag('warn', 'themes-move', 'the old themes map could not be removed after its move: ' + errorText(err) + '; the next read moves only the themes not moved yet')
    }
    if (!live(g)) return null
  }
  const keyed = await readKeyed($, g, STORE_THEMES)
  if (keyed === null) return null
  return keyed
    .map(({ saveId, value }) => ({ id: saveId, name: typeof value['name'] === 'string' ? (value['name'] as string) : saveId, t: typeof value['t'] === 'number' ? (value['t'] as number) : 0, axes: themeAxesOf(value) }))
    .sort((a, b) => byStamp({ t: a.t, saveId: a.id }, { t: b.t, saveId: b.id }))
}

type ShownTheme = { shown: string; record: ThemeRecord }

// The name each theme is listed under: its stored name, else — when an older
// theme or a built-in holds it — the first free «<name> (N)», N from 2
function shownThemes(records: ThemeRecord[]): ShownTheme[] {
  const stored = new Set(records.map((r) => r.name))
  const used = new Set(Object.keys(THEMES))
  const out: ShownTheme[] = []
  for (const record of records) {
    let shown = record.name
    if (used.has(shown)) {
      for (let n = 2; ; n++) {
        const candidate = record.name + ' (' + String(n) + ')'
        if (!used.has(candidate) && !stored.has(candidate)) {
          shown = candidate
          break
        }
      }
    }
    used.add(shown)
    out.push({ shown, record })
  }
  return out
}

export async function restoreAfterReload($: EngineInterface, options: PluginOptions): Promise<void> {
  S.recoveryEnabled = true
  const g = S.gen
  const raw = rawOptionsOf(options)
  let lastGood: Record<string, string> | undefined
  try {
    const stored = await $.store.get(STORE_LASTGOOD)
    if (stored && typeof stored === 'object') lastGood = (stored as { __raw?: Record<string, string> }).__raw
  } catch (err) {
    if (live(g)) failDiag('info', 'lastgood-read', 'the last good configuration could not be read: ' + errorText(err) + '; the options apply as given')
  }
  if (!live(g)) return staleDrop('restore')
  // CONSTRAINT (S1-FIX3 F3): the stored themes must stand in S.userThemes
  // BEFORE the first applyOptions — a saved user theme is a valid `theme`
  // value on the first build, not a theme-unknown breakage.
  if ((await readThemes($, g)) === 'stale') return staleDrop('restore')
  await applyDecided($, raw, lastGood, g)
  if (!live(g)) return staleDrop('restore')
  try {
    const marks = await readMarks($, g)
    if (!live(g) || marks === null) return staleDrop('restore')
    const newest = marks[marks.length - 1]
    if (newest) {
      const records = await readUndo($, g)
      if (!live(g) || records === null) return staleDrop('restore')
      // CONSTRAINT (#521 FIX4 Ф3): only the newest save is judged, and only
      // while no later save has left its record — a superseded mark is the one
      // the pre-FIX4 single slot lost to the later save, and goes unreported
      const superseded = records.some((r) => r.saveId !== newest.saveId && byStamp(r, newest) > 0)
      for (const m of marks) {
        if (m === newest && !superseded) continue
        await $.store.delete(markKeyOf(m.saveId))
        if (!live(g)) return staleDrop('restore')
        // CONSTRAINT (#521 FIX6b Б5): moved marks share one stamp, so which of
        // them is the newest is not known — dropping one is said aloud
        if (m !== newest && m.t === MOVED_MARK_T && newest.t === MOVED_MARK_T) failDiag('info', 'save-mark-moved-dropped', 'a save mark moved from the previous version (' + m.saveId + ') is dropped: only one moved mark (' + newest.saveId + ') is judged, and their order is not known', 'save-mark-moved-dropped:' + m.saveId)
      }
      if (!superseded) {
        const { fields, values } = newest
        const unwritten = fields.filter((f) => (raw[f] ?? '') !== (values[f] ?? ''))
        await trimUndoRecord($, g, newest.saveId, fields.filter((f) => (raw[f] ?? '') === (values[f] ?? '')))
        if (!live(g)) return staleDrop('restore')
        if (unwritten.length === 0) {
          await $.store.delete(markKeyOf(newest.saveId))
          if (!live(g)) return staleDrop('restore')
          S.saving = null
          S.saveResult = 'сохранено'
        } else {
          S.saving = { fields, values }
          S.saveResult = 'не записано: ' + unwritten.join(', ')
          failDiag('fail', 'save-unwritten', 'save in flight: fields not written: ' + unwritten.join(', '))
        }
      }
    }
  } catch (err) {
    if (live(g)) failDiag('warn', 'save-mark-read', 'the in-flight save mark could not be read or cleared: ' + errorText(err) + '; an unfinished save is not reported')
  }
  if (!live(g)) return staleDrop('restore')
  let session = ''
  let isOpen = false
  let token = ''
  let draft: Draft | null = null
  try {
    // CONSTRAINT (#521 FIX4 Ф2): a refused flag read keeps the panel closed
    // and still lets the session id through — the snapshot recovery below
    // needs it. CONSTRAINT (#521 FIX5 Ч1): the id comes first — the bare flag
    // is moved by its own session only
    session = await $.session.id()
    if (!live(g)) return staleDrop('restore')
    const flags = await readOpenFlags($, g, session)
    if (!live(g) || flags === null) return staleDrop('restore')
    // «open in this session» = some flag names it; the newest one is adopted
    const mine = flags.filter((f) => f.session === session).sort((a, b) => byStamp({ t: a.t, saveId: a.token }, { t: b.t, saveId: b.token }))
    isOpen = mine.length > 0
    if (isOpen) {
      token = mine[mine.length - 1]!.token
      // CONSTRAINT (#521 FIX8b Р1): one open flag of a session stands, the
      // newest — a late write of an older token of this session goes here
      for (const old of mine.slice(0, -1)) {
        try {
          await $.store.delete(openKeyOf(old.token))
        } catch (err) {
          if (live(g)) failDiag('info', 'picker-open-flag-old', 'an older open flag of this session could not be cleared: ' + errorText(err) + '; it ages out of the store in ' + String(DRAFT_KEEP_MS / 86400000) + ' days')
        }
        if (!live(g)) return staleDrop('restore')
      }
      // the key of the session the open record names (#521 FIX2 Р13)
      draft = await readStoredDraft($, session, g)
    }
  } catch (err) {
    isOpen = false
    draft = null
    if (live(g)) failDiag('warn', 'picker-restore-read', 'the picker open flag or its draft could not be read: ' + errorText(err) + '; the picker stays closed')
  }
  if (!live(g)) return staleDrop('restore')
  await restoreSession($, session)
  if (!live(g)) return staleDrop('restore')
  // CONSTRAINT (#521 FIX5 Ч7): an opener that set the panel up meanwhile
  // decided from newer facts — its panel, session, token and draft stand
  if (S.opening || S.pickerOpen === true) return
  S.pickerOpen = isOpen
  S.openToken = isOpen ? token : ''
  if (isOpen) {
    S.ownTokens.add(token)
    S.flagToken = token
  }
  if (draft) setDraft(draft, session)
  else if (session !== S.pickerSession) setDraft(null, session)
  // CONSTRAINT (#521 FIX5 Ч3): a panel the reload reopens is open as much as
  // one the command opened — its flag and draft are re-stamped by the same timer
  if (isOpen) armKeepAlive($, g)
}

// CONSTRAINT (#521 FIX5 Ч6): the one writer of the draft outside the stand —
// the draft, the session it belongs to and the epoch the picker trees carry
// change together; within one S.gen the epoch grows whenever the pair changes
// (a wipe starts a new generation, and the epoch there starts over)
function setDraft(draft: Draft | null, session: string): void {
  if (S.draft === draft && S.pickerSession === session) return
  S.draft = draft
  S.pickerSession = session
  S.draftEpoch++
}

// $.session.surfaces never rejects (d.ts:2459-2471); a host or stand without
// the method throws at the call (the resolver law forbids reading $ as a
// value, so no typeof) and answers "no surface", the text path
async function drawsOnSurface($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).length > 0
  } catch {
    // CONSTRAINT (#521 Р11): the refusal is the answer — the text path names /config to the person
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
    fam: typeof d['fam'] === 'string' ? d['fam'] : 'model',
    page: typeof d['page'] === 'number' && d['page'] >= 0 ? Math.floor(d['page'] as number) : 0,
    targetLine: typeof d['targetLine'] === 'number' ? (d['targetLine'] as number) : 0,
    themeName: typeof d['themeName'] === 'string' ? d['themeName'] : '',
    from: d['from'] === 'elements' ? 'elements' : 'layout',
    undo: Array.isArray(d['undo']) ? (d['undo'] as unknown[]).filter(isSnap).slice(-DRAFT_UNDO_CAP) : [],
  }
}

function isSnap(x: unknown): x is DraftSnap {
  if (!x || typeof x !== 'object') return false
  const s = x as Record<string, unknown>
  return Array.isArray(s['lines']) && !!s['axes'] && typeof s['axes'] === 'object' && !!s['elements'] && typeof s['elements'] === 'object'
}

// CONSTRAINT (#363 L1/L2): $ travels only into functions declared at the top
// of this file; the timer bootstrap is one of them.
function ensureStarted($: EngineInterface, defer = false): void {
  if (S.started) return
  S.started = true // the ONLY place timers are created; render never restarts them
  const g = S.gen
  const create = (): void => {
    void quiet('start', async () => {
      if (!live(g)) return staleDrop('start')
      await runEnvSources($, REG.families, g)
      if (!live(g)) return staleDrop('start')
      await syncSourceTimers($)
      if (!live(g)) return staleDrop('start')
      await refreshQuietly($)
      // the effort read rides the start path's own gather (refresh runs the
      // config source); it is fired, not awaited — a hung config.list must
      // not park the start chain's tail (ADJUDICATION-S2 #8/#9). CONSTRAINT
      // (S1-FIX6 П.1): the fire itself needs the guard — past a reload the
      // old chain must not read the NEW state's seed flags
      if (!live(g)) return staleDrop('start')
      void seedEffort($).catch((err) => {
        if (live(g)) failDiag('warn', 'effort-seed', 'the effort level could not be read from /config: ' + errorText(err) + '; the next refresh retries')
      })
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
  const g = S.gen
  S.restoring = restoreAfterReload($, S.reloadOptions as PluginOptions)
    .then(() => {
      // CONSTRAINT (#521 FIX3 AR-3): a pane drawn before the restore landed
      // shows the pre-restore state — the open panel is drawn again, through
      // the press path's redraw and its refusal record (Р19)
      if (live(g) && S.pickerOpen === true) invalidate($, g)
    })
    .catch((err) => {
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
  } catch (err) {
    // the noun may be absent on a surface; the clear is defensive
    failDiag('info', 'status-clear', 'ui.status clear refused: ' + errorText(err))
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
  return canonicalJson(source)
}

function canonicalJson(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) setOwn(out, k, canon((v as Record<string, unknown>)[k]))
      return out
    }
    return v
  }
  return JSON.stringify(canon(value))
}

// CONSTRAINT (#521 FIX6 Р4, FIX6b Б2): the id of a record moved out of a bare
// key is fixed by its content — a repeated move of the same content lands on
// the same key, changed content on a new one; the hash is 64-bit FNV-1a
function legacyIdOf(tag: string, value: unknown): string {
  return 'legacy-' + tag + '-' + fnv64hex(canonicalJson(value))
}

// FNV-1a 64 over UTF-16 code units; the mask keeps the product in 64 bits
function fnv64hex(text: string): string {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i++) hash = ((hash ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n) & 0xffffffffffffffffn
  return hash.toString(16).padStart(16, '0')
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

// CONSTRAINT (#521 FIX2 Р20, FIX4 Ф8): a refused session root is said once per
// session — the dedup key carries the session id the refusal was read under,
// so a new session's first refusal is said at its first read; the cwd stands in
function rootRefused(err: unknown, session: string): void {
  failDiag('warn', 'session-root', 'корень сессии неизвестен: ' + errorText(err) + '; читается от cwd', 'session-root:' + session)
}

// the session id for a record's key; '' where the host refuses it
async function sessionIdOrEmpty($: EngineInterface): Promise<string> {
  try {
    return await $.session.id()
  } catch {
    // CONSTRAINT (#521 FIX4 Ф8): the id only names the record — its refusal is
    // said by the gather's own session source
    return ''
  }
}

async function runFile($: EngineInterface, src: Extract<Source, { kind: 'file' }>, g: number): Promise<Input | null> {
  const t = await readClock($)
  if (!live(g)) { staleDrop('file source'); return null }
  let path = src.path
  let degraded = false
  if (!src.path.startsWith('/')) {
    let base = ''
    if (src.relativeTo === 'home') base = S.home
    else {
      let rootErr: unknown
      try {
        base = await ($.session as unknown as { root: () => Promise<string> }).root()
      } catch (err) {
        degraded = true
        rootErr = err
      }
      if (!live(g)) { staleDrop('file source'); return null }
      if (degraded) {
        const session = await sessionIdOrEmpty($)
        if (!live(g)) { staleDrop('file source'); return null }
        rootRefused(rootErr, session)
      }
      if (!base) {
        try {
          base = await $.session.cwd()
        } catch {
          // CONSTRAINT (#521 Р11): the path is read as given; a miss shows as the source's own failed read
          base = ''
        }
        if (!live(g)) { staleDrop('file source'); return null }
      }
    }
    path = (base ? base.replace(/\/+$/, '') + '/' : '') + src.path
  }
  let out: Input
  try {
    const data = await $.fs.read(path)
    out = { source: src, ok: true, data, now: t }
  } catch (err) {
    out = { source: src, ok: false, error: errorText(err), now: t }
  }
  // CONSTRAINT (#521 FIX3 AR-1): a read made from the cwd because the root was
  // refused carries `degraded` — the element that shows it marks its text
  if (degraded) out.degraded = true
  return out
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
  // CONSTRAINT (S4-FIX11 Н4): the same law as Ж11 at the event fan-out — one
  // family's refusing feed must not starve the later families of this source.
  // CONSTRAINT (S4-FIX12 Н6, critic swe2 F2): the INPUT source is read ONCE,
  // before the loop — a source whose key or kind throws would otherwise raise
  // inside every family's catch, and the catch of Н4 is not a throw site;
  // the answer there is one dispatch-source record and the input is dropped.
  // The sources of a corrupt REGISTRY element stay read inside the family's
  // own try.
  let srcKey: string
  let srcKind: string
  try {
    srcKey = sourceKey(input.source)
    srcKind = String(input.source.kind)
  } catch (err) {
    failDiag('fail', 'dispatch-source', 'dispatch: the input source has no key: ' + errorText(err))
    return
  }
  for (const [i, fam] of REG.families.entries()) {
    try {
      // CONSTRAINT (S4-FIX12 Н7, critic swe2 F3): the index separates families
      // whose names collapse (a corrupt entry reads '<unnamed>' for all of
      // them) — one record per broken family, not one per episode name
      const epKey = srcKey + ':' + String(i) + ':' + safeFamily(fam)
      let declared = false
      for (const entry of fam.sources) {
        if (sourceKey(entry.source) !== srcKey) continue
        declared = true
        break
      }
      if (declared) feed(fam, input)
      endEpisode(epKey, ['family-feed'])
    } catch (err) {
      episodeDiag('fail', 'family-feed', srcKey + ':' + String(i) + ':' + safeFamily(fam), 'family ' + safeFamily(fam) + ': the ' + srcKind + ' feed threw: ' + errorText(err))
    }
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
      // CONSTRAINT (#521 Р11): a slot's cancel records its own refusal (timer-cancel-refused)
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
      void quiet('timer-tick', async () => {
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
      try {
        (handle as { cancel?: () => void })?.cancel?.()
      } catch (err) {
        failDiag('info', 'timer-cancel-refused', 'clock.every cancel refused for ' + key.slice(0, 60) + ': ' + errorText(err) + '; its ticks run on and drop aloud once stale')
      }
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
      // CONSTRAINT (#521 Р11): a slot's cancel records its own refusal (timer-cancel-refused)
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
  sweepHung()
  releaseParked($)
  pruneLanded()
  flushDiag($)
  // CONSTRAINT (FIX5 Р2): a farewell taken by an earlier gather (or returned
  // by a refused or hung write) gets one attempt per gather, here, before
  // this gather's own reads — the flush points are listed at flushFarewell
  flushFarewell($)
  verifyStore($)
  const ticket = ++S.refreshesBegun
  const t = clockMs
  // CONSTRAINT (ADJUDICATION-v0.5-data-usage AR1): an identical source runs
  // ONCE per cycle; the input goes to every family declaring it. Without this
  // the second family declaring session:messages is never fed (messagesDone
  // already spent) and session:usage/info are read once per family.
  // CONSTRAINT (F2): session:info is read FIRST among the session sources —
  // the id change of this gather lands before any other read, so the usage
  // answer of the SAME gather already speaks for the new id.
  const readSession = new Set<string>()
  const sessionSources: Extract<Source, { kind: 'session' }>[] = []
  for (const fam of REG.families) {
    for (const entry of fam.sources) {
      const src = entry.source
      if (src.kind !== 'session') continue
      if (readSession.has(sourceKey(src))) continue
      readSession.add(sourceKey(src))
      sessionSources.push(src)
    }
  }
  const infoSources = sessionSources.filter((s) => s.call === 'info')
  for (const src of [...infoSources, ...sessionSources.filter((s) => s.call !== 'info')]) {
    if (src.call === 'messages' && S.messagesDone) continue
    if (src.call === 'config') {
      // the effort seed's own declared source: the start path seeds it once;
      // reaching it here is the promised retry of a refused read. CONSTRAINT
      // (the S1-FIX6 П.1 sweep law): the gather must not await it — an await
      // point here would cross a reload without the loop's own live guard,
      // and a hung config.list would park every refresh behind it
      void seedEffort($).catch((err) => {
        if (live(g)) failDiag('warn', 'effort-seed', 'the effort level could not be read from /config: ' + errorText(err) + '; the next refresh retries')
      })
      continue
    }
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
        let rootDegraded = false
        let rootErr: unknown
        try {
          root = await ($.session as unknown as { root: () => Promise<string> }).root()
        } catch (err) {
          // CONSTRAINT (#521 FIX3b): the cwd stands in as a plain path; the flag
          // beside it carries the mark, which only the drawing adds
          root = cwd
          rootDegraded = true
          rootErr = err
        }
        if (!live(g)) return staleDrop('refresh')
        let id: string
        try {
          id = await $.session.id()
        } catch (err) {
          // the refused root is said even when the id is refused too
          if (rootDegraded && live(g)) rootRefused(rootErr, '')
          throw err
        }
        if (!live(g)) return staleDrop('refresh')
        if (rootDegraded) rootRefused(rootErr, id)
        const turns = await $.session.turns()
        const info: SessionInfo = { cwd, root, id, turns, transcriptPath: S.transcriptPath === '' ? undefined : S.transcriptPath }
        if (rootDegraded) info.rootDegraded = true
        input = { source: src, ok: true, data: info, now: t }
      } else {
        input = { source: src, ok: true, data: await $.session.messages(), now: t }
      }
    } catch (err) {
      input = { source: src, ok: false, error: errorText(err), now: t }
    }
    // a stale ticket would outrank the new state's refreshes (SPEC §14.12)
    if (!live(g)) return staleDrop('refresh')
    // CONSTRAINT (F7/Р4): one ticket for all session sources — an answer of an
    // older gather is dropped on ANY source, its dispatch would roll the state
    // back past the newer gather's own session
    if (ticket < S.sessionTicketSeen) return staleDrop('refresh', 'newer')
    S.sessionTicketSeen = ticket
    if (src.call === 'messages') S.messagesDone = true
    dispatch(input)
  }
  const base = famState(FAMILIES[0]!) as BaseState
  if (S.pickerOpen === true && S.pickerSession !== '' && base.session !== '' && base.session !== S.pickerSession) {
    const to = base.session
    act($, g, () => rebindPicker($, g, to))
  }
  if (S.recoveryEnabled) {
    await restoreSession($, base.session)
    if (!live(g)) return staleDrop('refresh')
    if (S.recovery.writePending) writeSession($)
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
  const lines = drawLines(buildVars(S.cfg.elements, S.cfg.view, S.cfg.nf, true), S.cfg.tpl, S.cfg.view, S.cfg.elements, WIDTH_FALLBACK, 99, S.cfg.nf)
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
      invalidate($, g)
      return undefined
    }
    return operation()
  }).catch((error) => {
    if (live(g)) {
      S.saveResult = errorText(error)
      invalidate($)
    }
    try {
      $.ui.toast('[statusline] ' + errorText(error))
    } catch (err) {
      if (live(g)) failDiag('warn', 'picker-toast', 'ui.toast refused for a failed picker action: ' + errorText(err) + '; the notice line carries the failure')
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
    // the registry's first family, not «Все» (ADJUDICATION-S4 Д2 п.6): the
    // wall of every element is the complaint itself; «Все» stays a manual pick
    fam: 'model',
    page: 0,
    targetLine: 0,
    themeName: '',
    from: 'layout',
    undo: [],
  }
}

// true: the panel is open, or a close that landed meanwhile had the last word;
// false: the state went stale; a string: the answer to the command
async function openPicker($: EngineInterface): Promise<boolean | string> {
  const g = S.gen
  const dropOpen = (): boolean => {
    staleDrop('picker open')
    return false
  }
  // CONSTRAINT (#521 FIX6b Б1): a close that lands during this open wins —
  // after every await the open checks it and stops: no flag, no timer, no ui.open
  const closes = S.closes
  const closedSince = (): boolean => S.closes !== closes
  // restore decides pickerOpen and the draft from storage; opening inside its
  // window would be overwritten by it (S1-FIX5 П.1). CONSTRAINT (#521 FIX5
  // Ч7): the open starts this state's one restore itself when no render has,
  // and waits for it to settle
  ensureRestore($)
  await settledRestore()
  if (!live(g)) return dropOpen()
  if (closedSince()) return true
  if (S.themesFailed) {
    // 'stale' falls to the live check below, which drops it aloud
    if (Array.isArray(await readThemes($, g))) await applyDecided($, S.hostRaw, S.lastGood, g)
    if (!live(g)) return dropOpen()
    if (closedSince()) return true
  }
  // CONSTRAINT (#521 FIX5 Ч6): the draft this open may keep is the one it
  // finds here; one that appears during its awaits is not its own
  const had = S.draft
  const hadSession = S.pickerSession
  let continued = false
  S.opening = true
  try {
    S.pickerOpen = true
    const session = await $.session.id()
    if (!live(g)) return dropOpen()
    if (closedSince()) return true
    // #521 FIX2 Р13: a draft in memory of another session goes to that
    // session's key before this session reads its own
    let switched = false
    if (had !== null && hadSession !== '' && hadSession !== session) {
      switched = true
      await writeDraft($, hadSession, had)
      if (!live(g)) return dropOpen()
      if (closedSince()) return true
      setDraft(null, session)
    }
    await flushPendingDrafts($, g)
    if (!live(g)) return dropOpen()
    if (closedSince()) return true
    let draft = !switched && S.draft === had ? had : null
    // an Esc-kept draft outlives a reload in the store alone (#521 Р6)
    if (!draft) {
      try {
        draft = await readStoredDraft($, session, g)
        if (!live(g)) return dropOpen()
      } catch (err) {
        if (!live(g)) return dropOpen()
        failDiag('warn', 'picker-draft-read', 'the kept picker draft could not be read: ' + errorText(err) + '; the panel opens on the saved state')
      }
      if (closedSince()) return true
    }
    continued = draft !== null
    setDraft(draft ?? freshDraft(), session)
  } finally {
    if (live(g)) {
      S.opening = false
      invalidate($, g)
    }
  }
  try {
    const records = await readUndo($, g)
    if (!live(g) || records === null) return dropOpen()
    S.undoDepth = records.length
  } catch (err) {
    if (!live(g)) return dropOpen()
    failDiag('info', 'undo-stack-read', 'the saved-writes undo stack could not be read: ' + errorText(err))
  }
  if (closedSince()) return true
  const pending = continued && S.draft ? draftChanges(S.draft) : 0
  S.saveResult = pending > 0 ? 'продолжен несохранённый черновик (' + changedWord(pending) + ')' : ''
  const token = stampId()
  const previous = S.openToken
  S.openToken = token
  // the flag this open wrote goes when a close landed after its write
  const yieldFlag = async (): Promise<boolean> => {
    await clearFlag($, g, token)
    return true
  }
  await writeOpenFlag($, g, S.pickerSession, token, previous)
  if (!live(g)) return dropOpen()
  if (closedSince()) return yieldFlag()
  await persistDraft($)
  if (!live(g)) return dropOpen()
  if (closedSince()) return yieldFlag()
  await pruneDrafts($, g)
  if (!live(g)) return dropOpen()
  if (closedSince()) return yieldFlag()
  armKeepAlive($, g)
  try {
    await $.ui.open({ id: PANE_ID, title: 'Статус-строка', focus: true, closeOnEscape: true, holdToasts: true, rows: 30 })
  } catch (err) {
    if (!live(g)) return dropOpen()
    failDiag('warn', 'picker-open', 'ui.open refused: ' + errorText(err) + '; the panel is not open')
    // CONSTRAINT (#521 FIX6 Р3): a refused open is undone the way Esc closes
    // the panel — its flags and timer go, the draft is kept
    await closeKeepDraft($)
    return 'Панель статус-строки не открылась: ' + errorText(err)
  }
  if (!live(g)) return dropOpen()
  // a close during ui.open has already taken the flags and the timer
  if (closedSince()) return true
  invalidate($)
  return true
}

function draftKeyOf(session: string): string {
  return STORE_DRAFT + ':' + session
}

// The stored draft of `session`: its own key, else the pre-FIX2 single slot
// when that slot names the same session — moved to the key and removed
// (#521 FIX2 Р13). null: none, or the state went stale meanwhile (the caller
// checks live).
async function readStoredDraft($: EngineInterface, session: string, g: number): Promise<Draft | null> {
  // a draft whose write was refused is newer than its stored copy (#521 FIX4
  // Ф6) unless another process stored a later one since (#521 FIX5 Ч9)
  const kept = S.pendingDrafts.get(session)
  if (kept) {
    let stands: boolean | null
    try {
      stands = await pendingStands($, g, session, kept)
    } catch (err) {
      if (!live(g)) return null
      failDiag('info', 'picker-draft-pending-check', 'the stored draft of session ' + session + ' could not be read against the kept one: ' + errorText(err) + '; the kept draft stands', 'picker-draft-pending-check:' + session)
      return kept.draft
    }
    if (stands === null) return null
    if (stands) return kept.draft
  }
  const stored = await $.store.get(draftKeyOf(session))
  if (!live(g)) return null
  if (stored !== undefined) {
    return stored && typeof stored === 'object' && (stored as { session?: unknown }).session === session ? draftFrom(stored as Record<string, unknown>) : null
  }
  const slot = await $.store.get(STORE_DRAFT)
  if (!live(g)) return null
  if (!slot || typeof slot !== 'object' || (slot as { session?: unknown }).session !== session) return null
  const draft = draftFrom(slot as Record<string, unknown>)
  if (!draft) return null
  // CONSTRAINT (#521 FIX4 Ф10): the read landed — a refused move is its own
  // refusal, the panel opens with the slot's draft, and the next write of
  // this session's key finishes the move
  try {
    await $.store.set(draftKeyOf(session), { session, t: stampMs(), ...draft })
    if (!live(g)) return null
    await $.store.delete(STORE_DRAFT)
  } catch (err) {
    if (!live(g)) return null
    S.slotMovePending = session
    failDiag('warn', 'picker-draft-transfer', 'the kept picker draft could not be moved to its session key: ' + errorText(err) + '; the panel opens with it and the next draft write moves it')
  }
  return draft
}

// Draft keys, open flags and sessions' close marks (#521 FIX8b Р1) whose stamp is older
// than DRAFT_KEEP_MS leave the store at an open (#521 FIX2 Р13, FIX4 Ф2); a key without a numeric stamp
// stays. CONSTRAINT (#521 FIX4 Ф9, FIX5 Ч1): the bare slot and a bare open
// flag its session did not move are stamped at their first pass and age from
// there. CONSTRAINT (#521 FIX5 Ч3): the flags and the draft of the session
// whose panel is open in this state are never pruned here
async function pruneDrafts($: EngineInterface, g: number): Promise<void> {
  try {
    const keys = await $.store.keys()
    if (!live(g)) return
    const now = stampMs()
    const cut = now - DRAFT_KEEP_MS
    for (const key of Array.isArray(keys) ? keys : []) {
      if (typeof key !== 'string') continue
      const slot = key === STORE_DRAFT || key === STORE_OPEN
      if (!slot && !key.startsWith(STORE_DRAFT + ':') && !key.startsWith(STORE_OPEN + ':') && !key.startsWith(STORE_OPEN_CLOSED + ':')) continue
      const value = await $.store.get(key)
      if (!live(g)) return
      if (S.pickerOpen === true && S.pickerSession !== '' && value && typeof value === 'object' && (value as { session?: unknown }).session === S.pickerSession) continue
      const t = value && typeof value === 'object' ? (value as { t?: unknown }).t : undefined
      if (slot && value && typeof value === 'object' && typeof t !== 'number') {
        await $.store.set(key, { ...(value as Record<string, unknown>), t: now })
        if (!live(g)) return
        continue
      }
      if (typeof t !== 'number' || t >= cut) continue
      await $.store.delete(key)
      if (!live(g)) return
    }
  } catch (err) {
    if (live(g)) failDiag('info', 'picker-draft-prune', 'old picker drafts could not be pruned: ' + errorText(err) + '; they stay until the next open')
  }
}

function openKeyOf(token: string): string {
  return STORE_OPEN + ':' + token
}

function closeMarkKeyOf(session: string): string {
  return STORE_OPEN_CLOSED + ':' + session
}

// CONSTRAINT (#521 FIX8b Р1): the stamp of every open-flag write, taken
// before its await — past this environment's latest close, so an open in the
// close's millisecond is not read as closed
function flagStamp(): number {
  return Math.max(stampMs(), lastCloseT + 1)
}

type OpenFlag = { session: string; token: string; t: number }

// CONSTRAINT (#521 FIX8d Р2): an open flag stamped further than DRAFT_KEEP_MS
// past this environment's clock, and a close mark stamped at or past that
// boundary (futureMark), is damage — deleted at the read and never counted,
// its delete refused or not. A clock behind the writer's by DRAFT_KEEP_MS or
// more reads a fresh mark as damage (NOTES.md)
function futureStamp(t: number): boolean {
  return t > stampMs() + DRAFT_KEEP_MS
}

// CONSTRAINT (#521 FIX8e): an open is stamped lastCloseT + 1, so only a mark strictly before the boundary may seed — a mark on it would stamp the open past the boundary and its flag would be deleted as damage
function futureMark(t: number): boolean {
  return t >= stampMs() + DRAFT_KEEP_MS
}

// false: the state went stale meanwhile
async function dropFutureStamp($: EngineInterface, g: number, key: string): Promise<boolean> {
  const why = 'штамп дальше ' + String(DRAFT_KEEP_MS / 86400000) + ' дней в будущем'
  try {
    await $.store.delete(key)
    if (live(g)) failDiag('info', 'picker-future-stamp', key + ': ' + why + ' — запись удалена', 'picker-future-stamp:' + key)
  } catch (err) {
    if (live(g)) failDiag('info', 'picker-future-stamp', key + ': ' + why + ' — запись не учитывается, удалить её не удалось: ' + errorText(err), 'picker-future-stamp:' + key)
  }
  return live(g)
}

// The open flags, the pre-FIX4 bare flag moved to its token key first
// (#521 FIX4 Ф2). CONSTRAINT (#521 FIX5 Ч1): only the session the bare flag
// names moves it, under LEGACY_TOKEN + that session; another session's bare flag stays and
// ages out through the prune. null: the state went stale meanwhile.
async function readOpenFlags($: EngineInterface, g: number, session: string): Promise<OpenFlag[] | null> {
  // CONSTRAINT (#521 FIX8c, FIX8d Р1): the stored close marks seed lastCloseT
  // before any flag write below, the bare move included — a new environment's
  // flags are stamped past every mark, even with its clock behind them
  const seedKeys = await $.store.keys()
  if (!live(g)) return null
  for (const key of Array.isArray(seedKeys) ? seedKeys : []) {
    if (typeof key !== 'string' || !key.startsWith(STORE_OPEN_CLOSED + ':')) continue
    const value = await $.store.get(key)
    if (!live(g)) return null
    const t = value && typeof value === 'object' ? (value as { t?: unknown }).t : undefined
    if (typeof t !== 'number') continue
    if (futureMark(t)) {
      if (!(await dropFutureStamp($, g, key))) return null
      continue
    }
    lastCloseT = Math.max(lastCloseT, t)
  }
  const bare = await $.store.get(STORE_OPEN)
  if (!live(g)) return null
  if (bare !== undefined) {
    const owner = bare && typeof bare === 'object' ? (bare as { session?: unknown }).session : undefined
    if (typeof owner !== 'string') {
      await $.store.delete(STORE_OPEN)
      if (!live(g)) return null
    } else if (owner === session) {
      const token = LEGACY_TOKEN + owner
      await $.store.set(openKeyOf(token), { session: owner, token, t: flagStamp() })
      if (!live(g)) return null
      await $.store.delete(STORE_OPEN)
      if (!live(g)) return null
    }
  }
  const keys = await $.store.keys()
  if (!live(g)) return null
  const list = Array.isArray(keys) ? keys : []
  const marks = new Map<string, number>()
  for (const key of list) {
    if (typeof key !== 'string' || !key.startsWith(STORE_OPEN_CLOSED + ':')) continue
    const value = await $.store.get(key)
    if (!live(g)) return null
    const t = value && typeof value === 'object' ? (value as { t?: unknown }).t : undefined
    if (typeof t === 'number' && !futureMark(t)) marks.set(key.slice(STORE_OPEN_CLOSED.length + 1), t)
  }
  const flags: OpenFlag[] = []
  for (const key of list) {
    if (typeof key !== 'string' || !key.startsWith(STORE_OPEN + ':')) continue
    const value = await $.store.get(key)
    if (!live(g)) return null
    const session = value && typeof value === 'object' ? (value as { session?: unknown }).session : undefined
    if (typeof session !== 'string') continue
    const token = key.slice(STORE_OPEN.length + 1)
    const stamp = (value as { t?: unknown }).t
    if (typeof stamp === 'number' && futureStamp(stamp)) {
      if (!(await dropFutureStamp($, g, key))) return null
      continue
    }
    const t = typeof stamp === 'number' ? stamp : 0
    // CONSTRAINT (#521 FIX8b Р1): a flag stamped at or before its session's
    // close mark is closed — it is deleted and the mark stays, a late write
    // may still be on its way
    const mark = marks.get(session)
    const open = mark === undefined || t > mark
    if (!open) {
      try {
        await $.store.delete(key)
      } catch (err) {
        if (live(g)) failDiag('info', 'picker-closed-flag', 'the flag of a closed picker panel could not be removed: ' + errorText(err) + '; the panel stays closed and the flag ages out of the store', 'picker-closed-flag:' + token)
      }
      if (!live(g)) return null
      continue
    }
    flags.push({ session, token, t })
  }
  return flags
}

// This open's flag goes in under its own token; the flags of this state's
// earlier opens are its own and go — whether or not the new one landed
// (#521 FIX5 Ч8), so a refused write leaves no older flag of this state
async function writeOpenFlag($: EngineInterface, g: number, session: string, token: string, previous: string): Promise<void> {
  S.ownTokens.add(token)
  let refused: unknown
  let landed = true
  try {
    await $.store.set(openKeyOf(token), { session, token, t: flagStamp() })
  } catch (err) {
    landed = false
    refused = err
  }
  if (!live(g)) return
  if (landed && flagOutlived(g, token)) {
    await clearFlag($, g, token)
    return
  }
  if (landed) S.flagToken = token
  let left = false
  let clearErr: unknown
  for (const old of [...S.ownTokens]) {
    if (old === token) continue
    try {
      await $.store.delete(openKeyOf(old))
      if (!live(g)) return
      S.ownTokens.delete(old)
    } catch (err) {
      if (!live(g)) return
      left = true
      clearErr = err
    }
  }
  if (!landed) {
    failDiag('warn', 'picker-open-flag', 'the picker open flag could not be stored: ' + errorText(refused) + (left ? '; перезагрузка может открыть панель прежней сессии; флаг устареет за 7 дней' : '; перезагрузка не откроет панель'))
    return
  }
  if (left && previous !== '') failDiag('info', 'picker-open-flag-old', 'the flag of the previous open could not be cleared: ' + errorText(clearErr) + '; it ages out of the store')
}

const REBOUND = 'сессия сменилась — черновик прежней сессии сохранён'
const STALE_TREE = 'панель обновлена под текущую сессию — повторите действие'

// CONSTRAINT (#521 FIX4 Ф1): the open panel holds the current session's
// draft — a changed id stores the old draft under the old session, takes the
// new session's own (or a fresh one) and moves the open flag to it
async function rebindPicker($: EngineInterface, g: number, to: string): Promise<void> {
  if (S.pickerOpen !== true || S.pickerSession === '' || S.pickerSession === to) return
  const from = S.pickerSession
  const kept = S.draft ? await writeDraft($, from, S.draft) : true
  if (!live(g)) return staleDrop('picker rebind')
  let next: Draft | null = null
  try {
    next = await readStoredDraft($, to, g)
  } catch (err) {
    if (live(g)) failDiag('warn', 'picker-draft-read', 'the kept picker draft could not be read: ' + errorText(err) + '; the panel continues on the saved state')
  }
  if (!live(g)) return staleDrop('picker rebind')
  // a close or another rebind landed meanwhile: the panel is theirs
  if (S.pickerOpen !== true || S.pickerSession !== from) return
  setDraft(next ?? freshDraft(), to)
  S.focusKey = ''
  const token = stampId()
  const previous = S.openToken
  S.openToken = token
  await writeOpenFlag($, g, to, token, previous)
  if (!live(g)) return staleDrop('picker rebind')
  await persistDraft($)
  if (!live(g)) return staleDrop('picker rebind')
  S.saveResult = kept ? REBOUND : 'сессия сменилась — черновик прежней сессии не записан в хранилище, он держится в памяти до следующей записи'
  invalidate($)
}

async function settledRestore(): Promise<void> {
  let seen: Promise<void>
  do {
    seen = S.restoring
    await seen
  } while (seen !== S.restoring)
}

// CONSTRAINT (#521 FIX5 Ч3): a draft write of the open panel stamps its open
// flag as well — both age from the panel's last write
async function persistDraft($: EngineInterface): Promise<void> {
  if (!S.draft) return
  await writeDraft($, S.pickerSession, S.draft)
  await stampOpenFlag($)
}

// the open flag re-written with a new stamp; only a flag whose write landed,
// while the panel is open
async function stampOpenFlag($: EngineInterface): Promise<void> {
  const g = S.gen
  const token = S.openToken
  if (S.pickerOpen !== true || token === '' || S.flagToken !== token) return
  try {
    await $.store.set(openKeyOf(token), { session: S.pickerSession, token, t: flagStamp() })
  } catch (err) {
    if (live(g)) failDiag('info', 'picker-open-stamp', 'the open flag could not be re-stamped: ' + errorText(err) + '; it keeps its older stamp and another session\'s open may prune it after ' + String(DRAFT_KEEP_MS / 86400000) + ' days')
    return
  }
  if (flagOutlived(g, token)) await clearFlag($, g, token)
}

// CONSTRAINT (#521 FIX6 Р2): a flag write that lands after the close, or after
// a newer token took over, is deleted again — $.store does not promise that a
// set begun before a delete lands before it
function flagOutlived(g: number, token: string): boolean {
  return live(g) && (S.pickerOpen !== true || S.openToken !== token)
}

// CONSTRAINT (#521 FIX5 Ч3): one timer per open panel re-stamps its flag and
// draft; armed at an open, cancelled at the close and at a wipe, and a tick of
// another state cancels itself
function armKeepAlive($: EngineInterface, g: number): void {
  stopKeepAlive(g)
  let handle: unknown
  const cancel = (): void => {
    (handle as { cancel?: () => void } | undefined)?.cancel?.()
  }
  const tick = (): void => {
    void quiet('picker-keepalive', async () => {
      if (!live(g)) {
        try {
          cancel()
        } catch {
          // CONSTRAINT: this tick's state is gone — its refusal has no state to be recorded in
        }
        return
      }
      if (S.pickerOpen !== true) return
      await readClock($)
      if (!live(g) || S.pickerOpen !== true) return
      await persistDraft($)
    })
  }
  try {
    handle = $.clock.every(KEEP_ALIVE_MS, tick)
  } catch (err) {
    failDiag('warn', 'picker-keepalive', 'the open panel\'s re-stamp timer was refused: ' + errorText(err) + '; the flag and draft are re-stamped at each draft write only')
    return
  }
  S.keepAlive = { cancel }
}

function keepAliveCancelText(err: unknown): string {
  return 'the open panel\'s re-stamp timer could not be cancelled: ' + errorText(err) + '; its ticks stop themselves once the panel is closed or the state is gone'
}

function stopKeepAlive(g: number): void {
  const timer = S.keepAlive
  S.keepAlive = null
  try {
    timer?.cancel()
  } catch (err) {
    if (live(g)) failDiag('info', 'picker-keepalive-cancel', keepAliveCancelText(err))
  }
}

// CONSTRAINT (#521 FIX4 Ф6): a refused draft write keeps the draft in
// S.pendingDrafts under its session; every later write and every open writes
// the kept ones first. true: this draft landed
async function writeDraft($: EngineInterface, session: string, draft: Draft): Promise<boolean> {
  const g = S.gen
  await flushPendingDrafts($, g, session)
  if (!live(g)) return false
  return storeDraft($, g, session, draft)
}

async function storeDraft($: EngineInterface, g: number, session: string, draft: Draft): Promise<boolean> {
  const t = stampMs()
  try {
    await $.store.set(draftKeyOf(session), { session, t, ...draft })
  } catch (err) {
    if (!live(g)) return false
    S.pendingDrafts.set(session, { draft, t })
    failDiag('warn', 'picker-draft-store', 'the picker draft' + (session !== '' ? ' of session ' + session : '') + ' could not be stored: ' + errorText(err) + '; it is kept in memory and stored at the next draft write or open — a reload loses the unsaved edits', 'picker-draft-store:' + session)
    return false
  }
  if (!live(g)) return true
  if (S.pendingDrafts.get(session)?.draft === draft) S.pendingDrafts.delete(session)
  if (S.slotMovePending === session) {
    try {
      // CONSTRAINT (#521 FIX5 Ч10): the bare slot goes only while it still
      // names this session — an older build may have written another's since
      const slot = await $.store.get(STORE_DRAFT)
      if (!live(g)) return true
      if (slot && typeof slot === 'object' && (slot as { session?: unknown }).session === session) {
        await $.store.delete(STORE_DRAFT)
        if (!live(g)) return true
      }
      if (S.slotMovePending === session) S.slotMovePending = ''
    } catch (err) {
      if (live(g)) failDiag('warn', 'picker-draft-transfer', 'the moved picker draft slot could not be removed: ' + errorText(err) + '; the next draft write removes it')
    }
  }
  return true
}

// CONSTRAINT (#521 FIX5 Ч9): a kept draft is stored only while the stored
// draft of its session is not stamped later; a later one supersedes it and
// the kept one is dropped aloud. null: stale
async function pendingStands($: EngineInterface, g: number, session: string, kept: { draft: Draft; t: number }): Promise<boolean | null> {
  const stored = await $.store.get(draftKeyOf(session))
  if (!live(g)) return null
  const t = stored && typeof stored === 'object' ? (stored as { t?: unknown }).t : undefined
  if (typeof t !== 'number' || t <= kept.t) return true
  if (S.pendingDrafts.get(session) === kept) S.pendingDrafts.delete(session)
  failDiag('warn', 'picker-draft-superseded', 'the kept picker draft of session ' + session + ' is dropped: the store holds a later draft of that session, which stands', 'picker-draft-superseded:' + session)
  return false
}

async function flushPendingDrafts($: EngineInterface, g: number, skip = ''): Promise<void> {
  for (const [session, kept] of [...S.pendingDrafts.entries()]) {
    if (session === skip) continue
    let stands: boolean | null
    try {
      stands = await pendingStands($, g, session, kept)
    } catch (err) {
      if (!live(g)) return
      failDiag('info', 'picker-draft-pending-check', 'the stored draft of session ' + session + ' could not be read against the kept one: ' + errorText(err) + '; the kept draft stays in memory', 'picker-draft-pending-check:' + session)
      continue
    }
    if (stands === null) return
    if (!stands) continue
    await storeDraft($, g, session, kept.draft)
    if (!live(g)) return
  }
}

// Esc, the engine's close and «Закрыть» keep the draft in $.store: it is
// restored when the picker opens again (Р5, #521 Р6); nothing closes it away.
export async function closeKeepDraft($: EngineInterface): Promise<void> {
  // CONSTRAINT (S1-FIX6 П.3): the close is the host's fact about the pane —
  // it lands on the state as the LATEST restore left it, never inside a
  // restore that would reopen the pane after it
  await settledRestore()
  const g = S.gen
  // CONSTRAINT (#521 FIX2 Р27, FIX4 Ф2, FIX5 Ч8): the close deletes the keys
  // of this state's own tokens, as they stand now, and reads nothing first —
  // an open that landed meanwhile has its own key
  const tokens = [...S.ownTokens]
  const session = S.pickerSession
  S.pickerOpen = false
  S.closes++
  // CONSTRAINT (#521 FIX8b Р1, FIX8c): the close's instant is taken before any
  // await — a flag stamped after this line is stamped past it (flagStamp), and
  // it is past the latest close, so it is not below a flag stamped lastCloseT + 1
  // while the clock stood still
  const closedAt = Math.max(stampMs(), lastCloseT + 1)
  lastCloseT = Math.max(lastCloseT, closedAt)
  S.focusKey = ''
  stopKeepAlive(g)
  if (session !== '') await markClosed($, g, session, closedAt)
  await persistDraft($)
  for (const token of tokens) await clearFlag($, g, token)
  invalidate($, g)
}

// CONSTRAINT (#521 FIX8b Р1): only the close marks a session — a flag deleted
// because a newer token of an open panel took over, or yielded to a close
// that has already marked, is deleted without a mark: a mark closes every
// flag of the session stamped before it, the open panel's own included. The
// mark goes in before the close deletes its flags; its refusal is said and
// the flags are deleted all the same
async function markClosed($: EngineInterface, g: number, session: string, t: number): Promise<void> {
  try {
    await $.store.set(closeMarkKeyOf(session), { t })
  } catch (err) {
    if (live(g)) failDiag('warn', 'picker-close-store', 'the closed mark of the picker open flag could not be stored: ' + errorText(err) + '; закрытая панель может открыться при перезагрузке, если запись флага была в пути', 'picker-close-store:closed-mark')
  }
}

async function clearFlag($: EngineInterface, g: number, token: string): Promise<void> {
  try {
    await $.store.delete(openKeyOf(token))
    if (live(g)) S.ownTokens.delete(token)
  } catch (err) {
    if (live(g)) failDiag('warn', 'picker-close-store', 'the picker open flag could not be cleared: ' + errorText(err) + '; the next reload reopens the panel')
  }
}

// «Закрыть»: the pane closes as Esc closes it, the draft kept
async function closePane($: EngineInterface): Promise<void> {
  const g = S.gen
  await closeKeepDraft($)
  try {
    await $.ui.close({ id: PANE_ID })
  } catch (err) {
    if (live(g)) failDiag('info', 'picker-close', 'ui.close refused: ' + errorText(err) + '; the pane stays drawn until the person closes it')
  }
}

type MoveDir = 'left' | 'right' | 'up' | 'down' | 'out'

// no pill focused: an arrow focuses the first pill of the layout
function moveFocus(): string {
  const d = S.draft!
  const li = d.lines.findIndex((line) => line.length > 0)
  if (li < 0) return 'в раскладке нет элементов'
  d.focus = { line: li, seg: 0 }
  return ''
}

// Moves or removes the focused pill; the answer is the notice ('' when the
// draft itself shows the result).
function movePill(dir: MoveDir): string {
  const d = S.draft!
  if (!d.focus) return dir === 'out' ? 'выберите элемент в строке' : moveFocus()
  const li = d.focus.line
  const si = d.focus.seg
  const line = d.lines[li]
  const seg = line?.[si]
  if (!line || !seg) {
    d.focus = null
    return 'выбранного элемента больше нет — выберите элемент в строке'
  }
  if (dir === 'out') {
    line.splice(si, 1)
    d.focus = si < line.length ? { line: li, seg: si } : si > 0 ? { line: li, seg: si - 1 } : null
    return seg.id + ' убран из строки ' + (li + 1)
  }
  if (dir === 'left') {
    if (si === 0) return seg.id + ' уже первый в строке'
    line.splice(si, 1)
    line.splice(si - 1, 0, seg)
    d.focus = { line: li, seg: si - 1 }
    return ''
  }
  if (dir === 'right') {
    if (si >= line.length - 1) return seg.id + ' уже последний в строке'
    line.splice(si, 1)
    line.splice(si + 1, 0, seg)
    d.focus = { line: li, seg: si + 1 }
    return ''
  }
  if (dir === 'up') {
    if (li === 0) return 'выше строки 1 некуда'
    line.splice(si, 1)
    const target = d.lines[li - 1]!
    target.push(seg)
    d.focus = { line: li - 1, seg: target.length - 1 }
    return ''
  }
  if (li >= d.lines.length - 1) return 'ниже последней строки некуда'
  line.splice(si, 1)
  const target = d.lines[li + 1]!
  target.push(seg)
  d.focus = { line: li + 1, seg: target.length - 1 }
  return ''
}

function draftSerialize(draft: Draft): string {
  return serializeTemplate(draft.lines)
}

function saveBlockReason(draft: Draft): string | null {
  // CONSTRAINT (#521 FIX1b): empty lines are named before the round trip —
  // the template drops them, which would read as a reserved-token literal
  const empty = draft.lines.flatMap((line, i) => (line.length === 0 ? [i + 1] : []))
  if (empty.length > 0) {
    const what = empty.length === 1 ? 'строка ' + empty[0] + ' пуста' : 'строки ' + empty.join(', ') + ' пусты'
    return what + ' — добавьте элемент (+ элемент)' + (draft.lines.length > 1 ? ' или удалите строку (✕ строка)' : '')
  }
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

// The fields of the draft that differ from the saved state (#521 Р7).
// CONSTRAINT: the saved layout and element settings are the ones in force —
// a '' template stands for the default lines, so a fresh draft counts none.
function draftChanges(draft: Draft): number {
  const next = draftFields(draft)
  const saved: Record<string, string> = { ...S.cfg.rawOptions, template: serializeTemplate(S.cfg.tpl.lines), elements: serializeElements(S.cfg.elements) }
  let n = 0
  for (const f of new Set([...Object.keys(next), ...Object.keys(S.cfg.rawOptions)])) {
    if ((next[f] ?? '') !== (saved[f] ?? '')) n++
  }
  return n
}

function snapOf(d: Draft): DraftSnap {
  return JSON.parse(JSON.stringify({ lines: d.lines, axes: d.axes, elements: d.elements })) as DraftSnap
}

function sameSnap(a: DraftSnap, b: DraftSnap): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// the focus and the target line stay inside the lines after a content change
function clampNav(d: Draft): void {
  if (d.focus && !d.lines[d.focus.line]?.[d.focus.seg]) d.focus = null
  d.targetLine = Math.max(0, Math.min(d.targetLine, d.lines.length - 1))
}

function restoreSnap(d: Draft, snap: DraftSnap): void {
  d.lines = snap.lines
  d.axes = snap.axes
  d.elements = snap.elements
  clampNav(d)
}

type UndoRecord = { saveId: string; t: number; fields: string[]; prev: Record<string, string>; written: Record<string, string> }
type SaveMark = { saveId: string; t: number; fields: string[]; values: Record<string, string> }

function undoKeyOf(saveId: string): string {
  return STORE_UNDO + ':' + saveId
}

function markKeyOf(saveId: string): string {
  return STORE_SAVING + ':' + saveId
}

function stringsOf(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []
}

function valuesOf(x: unknown): Record<string, string> {
  return x && typeof x === 'object' && !Array.isArray(x) ? { ...(x as Record<string, string>) } : {}
}

// the keyed values under `<base>:`, each with its saveId from the key
async function readKeyed($: EngineInterface, g: number, base: string): Promise<{ saveId: string; value: Record<string, unknown> }[] | null> {
  const keys = await $.store.keys()
  if (!live(g)) return null
  const out: { saveId: string; value: Record<string, unknown> }[] = []
  for (const key of Array.isArray(keys) ? keys : []) {
    if (typeof key !== 'string' || !key.startsWith(base + ':')) continue
    const value = await $.store.get(key)
    if (!live(g)) return null
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push({ saveId: key.slice(base.length + 1), value: value as Record<string, unknown> })
  }
  return out
}

// The undo records oldest first (#521 FIX4 Ф3). The pre-FIX4 bare array is
// laid out once, in its order: a record without a saveId gets
// `legacy-undo-<content hash>-<k>`, k its occurrence among the records of
// equal content, and its stamp is its position minus the array's length
// (−N…−1, below zero: older than any record this version stamps, whatever
// the clock reads — #521 FIX8 Р2). CONSTRAINT (#521 FIX5 Ч2, FIX6 Р4, FIX6b Б4/Б5): the id is fixed by
// the record — a move cut short repeats onto the same keys, a record already
// moved is not written again, and equal records stay apart. null: stale.
async function readUndo($: EngineInterface, g: number): Promise<UndoRecord[] | null> {
  const bare = await $.store.get(STORE_UNDO)
  if (!live(g)) return null
  if (bare !== undefined) {
    const list = Array.isArray(bare) ? (bare as unknown[]) : []
    const seen = new Map<string, number>()
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      if (!e || typeof e !== 'object') continue
      const r = e as { saveId?: unknown; fields?: unknown; prev?: unknown; written?: unknown }
      let saveId: string
      if (typeof r.saveId === 'string' && r.saveId !== '') {
        saveId = r.saveId
      } else {
        const base = legacyIdOf('undo', e)
        const k = (seen.get(base) ?? 0) + 1
        seen.set(base, k)
        saveId = base + '-' + String(k)
      }
      const moved = await $.store.get(undoKeyOf(saveId))
      if (!live(g)) return null
      if (moved !== undefined) continue
      await $.store.set(undoKeyOf(saveId), { saveId, t: i - list.length, fields: stringsOf(r.fields), prev: valuesOf(r.prev), written: valuesOf(r.written) })
      if (!live(g)) return null
    }
    await $.store.delete(STORE_UNDO)
    if (!live(g)) return null
  }
  const keyed = await readKeyed($, g, STORE_UNDO)
  if (keyed === null) return null
  return keyed
    .map(({ saveId, value }) => ({ saveId, t: typeof value['t'] === 'number' ? (value['t'] as number) : 0, fields: stringsOf(value['fields']), prev: valuesOf(value['prev']), written: valuesOf(value['written']) }))
    .sort(byStamp)
}

// The save marks oldest first; the pre-FIX4 bare mark is moved to its key
// once. CONSTRAINT (#521 FIX8 Р2): the bare mark's stamp is MOVED_MARK_T,
// −0.5 — newer than every record of the bare array it was written with (their
// stamps are −N…−1 whatever its length), older than any record this version
// stamps (stampMs() ≥ 0) whatever the clock reads; without a saveId its id is
// `legacy-mark-<content hash>` (#521 FIX5 Ч2, FIX6 Р4), and a mark already
// moved is not written again. null: stale.
async function readMarks($: EngineInterface, g: number): Promise<SaveMark[] | null> {
  const bare = await $.store.get(STORE_SAVING)
  if (!live(g)) return null
  if (bare !== undefined) {
    if (bare && typeof bare === 'object' && !Array.isArray(bare)) {
      const m = bare as { saveId?: unknown; fields?: unknown; values?: unknown }
      const saveId = typeof m.saveId === 'string' && m.saveId !== '' ? m.saveId : legacyIdOf('mark', bare)
      const moved = await $.store.get(markKeyOf(saveId))
      if (!live(g)) return null
      if (moved === undefined) {
        await $.store.set(markKeyOf(saveId), { saveId, t: MOVED_MARK_T, fields: stringsOf(m.fields), values: valuesOf(m.values) })
        if (!live(g)) return null
      }
    }
    await $.store.delete(STORE_SAVING)
    if (!live(g)) return null
  }
  const keyed = await readKeyed($, g, STORE_SAVING)
  if (keyed === null) return null
  return keyed
    .map(({ saveId, value }) => ({ saveId, t: typeof value['t'] === 'number' ? (value['t'] as number) : 0, fields: stringsOf(value['fields']), values: valuesOf(value['values']) }))
    .sort(byStamp)
}

// CONSTRAINT (#521 Р10, FIX2 Р14, FIX4 Ф3): the undo record of a save names
// only the fields that landed; the mark trims its own saveId's record only
async function trimUndoRecord($: EngineInterface, g: number, saveId: string, landed: string[]): Promise<void> {
  const key = undoKeyOf(saveId)
  const got = await $.store.get(key)
  if (!live(g) || !got || typeof got !== 'object') return
  const record = got as { t?: unknown; fields?: unknown; prev?: unknown; written?: unknown }
  const fields = stringsOf(record.fields)
  const keep = fields.filter((f) => landed.includes(f))
  if (keep.length === fields.length) return
  try {
    if (keep.length === 0) await $.store.delete(key)
    else await $.store.set(key, { saveId, t: record.t, fields: keep, prev: pickFields(valuesOf(record.prev), keep), written: pickFields(valuesOf(record.written), keep) })
  } catch (err) {
    if (live(g)) failDiag('warn', 'undo-stack-write', 'the undo stack could not be stored: ' + errorText(err) + '; «Откатить сохранение» may revert a field that was not written')
  }
}

// CONSTRAINT (#521 FIX4 Ф3): UNDO_CAP stands by deleting the oldest record
// keys, never `own`; the depth is the count left. false: the stack could not
// be read (#521 FIX4b AR3 — the save says its undo is unavailable)
async function capUndo($: EngineInterface, g: number, own: string): Promise<boolean> {
  let records: UndoRecord[] | null
  try {
    records = await readUndo($, g)
  } catch (err) {
    if (live(g)) failDiag('warn', 'save-undo-unreadable', 'the undo stack could not be read after a save: ' + errorText(err) + '; «Откатить сохранение» cannot reach this save')
    return false
  }
  if (records === null) return true
  try {
    let left = records.length
    for (const r of records) {
      if (left <= UNDO_CAP) break
      if (r.saveId === own) continue
      await $.store.delete(undoKeyOf(r.saveId))
      left--
    }
    if (live(g)) S.undoDepth = left
  } catch (err) {
    if (live(g)) failDiag('warn', 'undo-stack-cap', 'the undo stack could not be cut to ' + String(UNDO_CAP) + ': ' + errorText(err) + '; the next save cuts it')
  }
  return true
}

function pickFields(values: Record<string, string> | undefined, fields: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields) out[f] = values?.[f] ?? ''
  return out
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
  const say = sayFor($, g)
  // CONSTRAINT (#521 FIX4 Ф1): a draft is saved only against its own
  // session's configuration — a changed id rebinds the panel and saves nothing
  if (S.pickerOpen === true && S.pickerSession !== '') {
    let session: string
    try {
      session = await $.session.id()
    } catch (err) {
      say('не сохранено: сессия не прочитана: ' + errorText(err))
      return
    }
    if (!live(g)) return staleDrop('save')
    if (session !== S.pickerSession) {
      await rebindPicker($, g, session)
      return
    }
    if (!S.draft) return
  }
  const base = S.cfg.rawOptions
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
  const saveId = stampId()
  const t = stampMs()
  // the in-flight mark goes in BEFORE the first write: the reload it causes
  // must not cut the sequence short (SPEC §14.7)
  try {
    await $.store.set(markKeyOf(saveId), { saveId, t, fields, values: changed })
    if (live(g)) S.saving = { fields, values: changed }
  } catch (err) {
    if (live(g)) failDiag('warn', 'save-mark-write', 'the in-flight save mark could not be stored: ' + errorText(err) + '; a reload inside this save cannot name what it missed')
  }
  const prevValues: Record<string, string> = {}
  const writtenValues: Record<string, string> = {}
  for (const f of fields) {
    prevValues[f] = base[f] ?? ''
    writtenValues[f] = changed[f] ?? ''
  }
  // CONSTRAINT (#521 FIX4 Ф3): this save writes and deletes its own record key only
  const storeUndo = async (kept: string[]): Promise<void> => {
    try {
      if (kept.length === 0) await $.store.delete(undoKeyOf(saveId))
      else await $.store.set(undoKeyOf(saveId), { saveId, t, fields: kept, prev: pickFields(prevValues, kept), written: pickFields(writtenValues, kept) })
    } catch (err) {
      if (live(g)) failDiag('warn', 'undo-stack-write', 'the undo stack could not be stored: ' + errorText(err) + '; «Откатить сохранение» may revert a field that was not written')
    }
  }
  await storeUndo(fields)
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
  // #521 Р10: the record keeps the fields that landed, none at all when nothing did
  await storeUndo(written)
  const undoReadable = await capUndo($, g, saveId)
  try {
    await $.store.delete(markKeyOf(saveId))
  } catch (err) {
    if (live(g)) failDiag('warn', 'save-mark-clear', 'the in-flight save mark could not be cleared: ' + errorText(err) + '; the next reload reports this save again')
  }
  if (live(g)) S.saving = null
  const parts: string[] = []
  if (written.length > 0) parts.push('записано: ' + written.join(', '))
  if (denied.length > 0) parts.push('НЕ записано: ' + denied.join(', '))
  // CONSTRAINT (#521 FIX4b AR3): a save whose undo stack could not be read
  // goes on, and its notice says the undo of it is unavailable
  if (!undoReadable && written.length > 0) {
    say((denied.length === 0 ? 'сохранено' : parts.join(' · ')) + '; откат этого сохранения недоступен — хранилище отказало в чтении стека')
    return
  }
  say(parts.join(' · '))
}

async function undoSave($: EngineInterface): Promise<void> {
  const g = S.gen
  const base = S.cfg.rawOptions
  const say = sayFor($, g)
  const records = await readUndo($, g)
  if (records === null) return staleDrop('undo')
  if (records.length === 0) {
    S.undoDepth = 0
    say('нечего откатывать: сохранений нет')
    return
  }
  const entry = records[records.length - 1]!
  const mine = pluginName($.plugin.name)
  let rows: { key: string; value: unknown; provider: { plugin: string } }[]
  try {
    rows = (await $.config.list()) as typeof rows
  } catch (err) {
    say('строки /config недоступны: ' + errorText(err))
    return
  }
  // CONSTRAINT (#521 FIX4 Ф4): a field already at its prev value is reverted
  // and counts as done; «меняли в обход» is a field at neither value, and one
  // such field keeps the whole record
  const stale: string[] = []
  const done: string[] = []
  const todo: string[] = []
  for (const f of entry.fields) {
    const row = rows.find((r) => r.provider.plugin !== 'engine' && pluginName(r.provider.plugin) === mine && r.key.endsWith('.' + f))
    const current = row ? String(row.value ?? '') : (base[f] ?? '')
    if (current === (entry.prev[f] ?? '')) done.push(f)
    else if (current === (entry.written[f] ?? '')) todo.push(f)
    else stale.push(f)
  }
  if (stale.length > 0) {
    say('не отменено, поле меняли в обход: ' + stale.join(', '))
    return
  }
  const denied: string[] = []
  const reverted: string[] = [...done]
  for (const f of todo) {
    const row = rows.find((r) => r.provider.plugin !== 'engine' && pluginName(r.provider.plugin) === mine && r.key.endsWith('.' + f))
    if (!row) {
      denied.push(f + ' (нет строки /config)')
      continue
    }
    try {
      const result = await $.config.set({ key: row.key, value: entry.prev[f] ?? '' })
      if (result && typeof result === 'object' && 'deny' in result && (result as { deny?: unknown }).deny !== undefined) denied.push(f + ': ' + String((result as { deny: unknown }).deny))
      else reverted.push(f)
    } catch (err) {
      denied.push(f + ': ' + errorText(err))
    }
  }
  // #521 FIX2 Р15: the record keeps the fields whose revert did not land, so
  // the undo can be pressed again; a full revert takes the record off
  const left = entry.fields.filter((f) => !reverted.includes(f))
  if (reverted.length > 0 || left.length === 0) {
    // CONSTRAINT (#521 FIX4 Ф4): a refused write leaves the record whole; the
    // repeat counts the reverted fields as done and reaches the rest
    try {
      if (left.length === 0) await $.store.delete(undoKeyOf(entry.saveId))
      else await $.store.set(undoKeyOf(entry.saveId), { saveId: entry.saveId, t: entry.t, fields: left, prev: pickFields(entry.prev, left), written: pickFields(entry.written, left) })
      if (live(g)) S.undoDepth = records.length - (left.length === 0 ? 1 : 0)
    } catch (err) {
      if (live(g)) failDiag('warn', 'undo-stack-write', 'the undo stack could not be stored: ' + errorText(err) + '; a repeated «Откатить сохранение» finds the reverted fields done')
    }
  }
  say(denied.length > 0 ? 'отмена: НЕ записано ' + denied.join(', ') + ' — откат этих полей можно повторить («Откатить сохранение»)' : 'отменено')
}

// «Сбросить к теме»: the draft's view axes return to the theme's own values;
// the answer is the notice ('' when the draft shows the result)
function resetToTheme(d: Draft): string {
  const name = d.axes['theme'] ?? 'hud'
  const def = own(THEMES, name)?.axes ?? own(S.userThemes, name)
  if (!def) return 'нет темы «' + name + '»'
  if (THEME_AXES.every((axis) => d.axes[axis] === 'theme')) return 'вид уже как в теме «' + name + '»'
  for (const axis of THEME_AXES) d.axes[axis] = 'theme'
  return ''
}

// the first «моя тема N» that names no built-in and no listed theme (#521
// FIX4 Ф5); `list` is the store as read right before the write (FIX5 Ч4)
function freeThemeName(list: ShownTheme[]): string {
  const taken = new Set(list.flatMap((t) => [t.shown, t.record.name]))
  for (let n = 1; ; n++) {
    const name = 'моя тема ' + String(n)
    if (!own(THEMES, name) && !taken.has(name)) return name
  }
}

// typed: the name the person typed; null: the first free «моя тема N». The
// answer is the notice ('' when the state went stale meanwhile).
async function saveUserTheme($: EngineInterface, typed: string | null): Promise<string> {
  const g = S.gen
  const note = (text: string): string => {
    if (live(g)) S.themeNote = text
    return text
  }
  const drop = (): string => {
    staleDrop('theme save')
    return ''
  }
  if (typed !== null && !typed) return note('имя темы пустое')
  const { view } = resolveView(S.draft ? S.draft.axes : S.cfg.rawOptions, S.userThemes)
  const snap: Record<string, string> = {
    shape: view.shape, caps: view.caps, glyphs: view.glyphs, fill: view.fill,
    barWidth: view.barWidthMode === 'cells' ? String(view.barWidthCells) : 'adaptive',
    palette: view.paletteName, thresholds: view.thresholds.join(','),
    face: (['label', 'value', 'alert'] as const).filter((r) => view.face[r]).map((r) => r + '=' + view.face[r]).join(';'),
    border: view.border, overflow: view.overflow, separator: view.separator, align: view.align,
  }
  if (S.draft && S.draft.axes['bar'] && S.draft.axes['bar'] !== 'theme' && S.draft.axes['bar'] !== '') snap['bar'] = S.draft.axes['bar']!
  // CONSTRAINT (#521 FIX5 Ч4, S1-FIX6 П.2): the name and the key come from
  // the store as it stands right before the write — this read is also the
  // retry of an earlier refused one; a refusal that stands refuses the save
  const before = await readThemes($, g)
  if (before === 'stale') return drop()
  if (before === 'failed') return note('тема не сохранена: сохранённые темы не прочитаны — без них не выбрать имя и ключ темы')
  const name = typed ?? freeThemeName(before)
  // CONSTRAINT (#521 FIX6 Р5): the user's theme stored under this name is
  // rewritten in place — the newest when several share it (the list is oldest
  // first) — whatever name the list shows it under; any other name is a new key
  const id = before.filter((t) => t.record.name === name).pop()?.record.id ?? stampId()
  // CONSTRAINT (S1-FIX4 П.3): the band never shows a theme that is not in
  // storage — store first; the decision after is restore's own (applyDecided).
  try {
    await $.store.set(themeKeyOf(id), { name, ...snap, t: stampMs() })
  } catch (err) {
    if (!live(g)) return drop()
    return note('тема не сохранена: ' + errorText(err))
  }
  if (!live(g)) {
    // the theme is in storage; the new state may have read the themes before
    // it landed — it re-reads them once its own restore has settled
    staleDrop('theme save')
    await rereadThemesAfterRestore($)
    return ''
  }
  const after = await readThemes($, g)
  if (after === 'stale') return drop()
  let shown = name
  if (after === 'failed') {
    setOwn(S.userThemes, name, snap)
  } else {
    shown = after.find((t) => t.record.id === id)?.shown ?? name
  }
  await applyDecided($, S.hostRaw, S.lastGood, g)
  if (!live(g)) return drop()
  const text = note('тема «' + shown + '» сохранена')
  invalidate($)
  return text
}

async function rereadThemesAfterRestore($: EngineInterface): Promise<void> {
  const g = S.gen
  if (!S.restored) return // this state's restore has not begun: it reads the themes itself
  await settledRestore()
  if (!live(g)) return staleDrop('themes reread')
  if (Array.isArray(await readThemes($, g))) await applyDecided($, S.hostRaw, S.lastGood, g)
  if (live(g)) invalidate($)
}

function keepFocus($: EngineInterface, requestId: string, g: number): void {
  S.moves++
  invalidate($)
  const d = S.draft
  const seg = d && d.focus ? d.lines[d.focus.line]?.[d.focus.seg] : undefined
  // no focused pill after the move: the ring has nothing to follow
  if (!seg) return
  const refused = (err: unknown): void => {
    if (live(g)) failDiag('info', 'focus-move', 'the focus could not follow the moved pill: ' + errorText(err) + '; the ring stays where the host left it')
  }
  // the kit has no implementation for a plugin's own focus move: the call rejects
  try {
    Promise.resolve($.ui.focus({ requestId, key: SEGMENT_KEY + seg.id + '#move' + S.moves })).catch(refused)
  } catch (err) {
    refused(err)
  }
}

// The «Элементы» paging (ADJUDICATION-S4 Д2 п.1): the whole registry under the
// filter, twelve per page; the actions recompute from the live draft so a
// press queued behind another always sees the current filter.
const PAGE_SIZE = 12

function filteredRegistry(d: Draft): ElementDef[] {
  const q = d.query.toLowerCase()
  return REGISTRY.filter((def) => {
    if (d.fam !== 'all' && def.family !== d.fam) return false
    return q === '' || def.id.includes(q) || def.label.toLowerCase().includes(q) || def.about.toLowerCase().includes(q)
  })
}

function pagesOf(defs: readonly ElementDef[]): number {
  return Math.max(1, Math.ceil(defs.length / PAGE_SIZE))
}

// The picker model the pure builder renders; every action closes over `$`.
function pickerModel($: EngineInterface, e: { requestId?: string }, treeTable: Table, surface: { name: string; selects: boolean; inputs: boolean; isFullscreen: boolean }): { model: PickerModel; actions: PickerActions } {
  const g = S.gen
  const d = S.draft!
  const epoch = S.draftEpoch
  const resolved = resolveView(d.axes, S.userThemes)
  const view = resolved.view
  const nf = buildNf(d.axes)
  const focusId = d.focus ? d.lines[d.focus.line]?.[d.focus.seg]?.id : undefined
  const families = [...new Set(REGISTRY.map((def) => def.family))]
  const placedLines = new Map<string, number[]>()
  d.lines.forEach((line, li) => {
    for (const s of line) {
      const id = s.id.split('#')[0]!
      const at = placedLines.get(id) ?? []
      if (!at.includes(li + 1)) at.push(li + 1)
      placedLines.set(id, at)
    }
  })
  // available first, the registry's own order inside each group (Д2 п.5);
  // Array#sort is stable, the pages run over the merged list
  const ordered = filteredRegistry(d).slice().sort((a, b) => Number(a.outcome === 'N') - Number(b.outcome === 'N'))
  const pages = pagesOf(ordered)
  const page = Math.min(Math.max(0, d.page), pages - 1)
  const elements = ordered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map((def) => {
    const live = valueOf(def.id, undefined, d.elements, nf)
    const sample = live && live.value.state === 'ok' ? (live.value.rows ? def.sample : live.value.text) : def.sample
    return {
      id: def.id,
      label: def.label,
      family: def.family,
      placed: placedLines.has(def.id),
      lines: placedLines.get(def.id) ?? [],
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
  const settings = own(d.elements, focusId?.split('#')[0]!) ?? {}
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
        labelMode: settings['lb'] ?? (own(DEFAULT_LABEL, def.id) ? 'on' : 'off'),
        labelText: settings['lt'] ?? '',
        hasGlyph: own(GLYPHS, def.id) !== undefined,
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
  const axisValue = (axis: string): string => (d.axes[axis] && d.axes[axis] !== '' ? d.axes[axis]! : 'theme')
  const axes = THEME_AXES.map((axis) => ({
    name: axis,
    label: axis,
    value: axisValue(axis),
    choices: [{ id: 'theme', label: '(как в теме)', sample: '' }, ...(own(AXIS_TEXT_CHOICES, axis) ?? own(AXIS_OPTIONS, axis) ?? []).map((v) => ({ id: v, label: axisSample(axis, v) !== '' && axis !== 'palette' && axis !== 'glyphs' && axis !== 'fill' && axis !== 'border' && axis !== 'overflow' && axis !== 'barWidth' ? v + ' ' + axisSample(axis, v) : v, sample: axisSample(axis, v) }))],
  }))
  const numberValue = (field: string): string => d.axes[field] ?? NUM_FIELDS.find((f) => f.field === field)?.choices[0] ?? ''
  const numbers = NUM_FIELDS.map((f) => ({
    field: f.field,
    label: f.label,
    value: numberValue(f.field),
    choices: f.choices.map((c) => ({ id: c, sample: numSample(f.field, c, d.elements, nf) })),
  }))
  const themes = [...Object.keys(THEMES), ...Object.keys(S.userThemes)].map((name) => {
    const themeView = resolveView({ ...d.axes, theme: name }, S.userThemes).view
    const vars = buildVars(d.elements, themeView, buildNf(d.axes))
    const rows = drawLines(vars, { lines: d.lines, sep: themeView.separator, evict: S.cfg.tpl.evict }, themeView, d.elements, 120, 3, buildNf(d.axes))
    return { name, tree: buildBarTree(rows, themeView, 120, treeTable, false, () => '', d.elements, buildNf(d.axes)) }
  })
  const changes = draftChanges(d)
  const model: PickerModel = {
    tab: d.tab,
    lines,
    focus: d.focus,
    focusId: focusId ?? '',
    targetLine: Math.max(0, Math.min(d.targetLine, d.lines.length - 1)),
    moves: S.moves,
    elements,
    families,
    familyFilter: d.fam,
    query: d.query,
    page,
    pages,
    total: ordered.length,
    focusKey: S.focusKey,
    element,
    axes,
    themes,
    themeName: d.themeName,
    themeNote: S.themeNote,
    numbers,
    presets: LAYOUT_PRESETS,
    maxRows: S.bandMeasured ? S.lastMaxRows : 0,
    notice: S.saveResult,
    saving: S.saving ? S.saving.fields.join(', ') : '',
    dirty: changes > 0,
    changes,
    selects: surface.selects,
    inputs: surface.inputs,
    surface: surface.name,
    isFullscreen: surface.isFullscreen,
  }
  const persist = (): Promise<void> => persistDraft($).then(() => invalidate($, g))
  const note = (text: string): void => {
    if (text !== '') S.saveResult = text
  }
  // CONSTRAINT (#521 Р1): every press shows a result — the draft, the tab, a
  // close, or a notice that says why nothing changed; the notice names the
  // last press only
  const press = (op: () => Promise<void>): void =>
    act($, g, async () => {
      if (S.draftEpoch !== epoch) {
        // CONSTRAINT (#521 FIX4b AR1): the tree was drawn for another draft —
        // no draft changes; the pane is redrawn and the person repeats
        S.saveResult = STALE_TREE
        invalidate($, g)
        return
      }
      S.saveResult = ''
      S.themeNote = ''
      await op()
    })
  // an edit of the draft's content: its prior content goes on the draft's undo stack
  const edit = (fn: () => string): Promise<void> => {
    const before = snapOf(d)
    note(fn())
    if (!sameSnap(before, snapOf(d))) {
      d.undo.push(before)
      while (d.undo.length > DRAFT_UNDO_CAP) d.undo.shift()
    }
    return persist()
  }
  const nav = (fn: () => string): Promise<void> => {
    note(fn())
    return persist()
  }
  const elemEdit = (key: string, value: string): Promise<void> =>
    edit(() => {
      if (!focusId) return 'выберите элемент в строке: настройки относятся к выбранной пилюле'
      const id = focusId.split('#')[0]!
      const before = JSON.stringify(own(d.elements, id) ?? {})
      setElem(d, id, key, value)
      return JSON.stringify(own(d.elements, id) ?? {}) === before ? 'уже выбрано' : ''
    })
  const actions: PickerActions = {
    setTab: (tab) =>
      press(() =>
        nav(() => {
          if (d.tab === tab) return 'эта вкладка уже открыта'
          if (tab === 'element' && (d.tab === 'layout' || d.tab === 'elements')) d.from = d.tab
          d.tab = tab
          S.focusKey = ''
          return ''
        }),
      ),
    back: () =>
      press(() =>
        nav(() => {
          if (d.tab !== 'element') return 'назад некуда: это не вкладка «Элемент»'
          d.tab = d.from === 'elements' ? 'elements' : 'layout'
          S.focusKey = ''
          return ''
        }),
      ),
    focusSeg: (line, seg) =>
      press(() =>
        nav(() => {
          const s = d.lines[line]?.[seg]
          if (!s) return 'этой пилюли больше нет'
          if (d.focus && d.focus.line === line && d.focus.seg === seg) return s.id + ' уже выбран: ⚙ — настроить, ✕ — убрать'
          d.focus = { line, seg }
          return ''
        }),
      ),
    move: (dir) =>
      press(async () => {
        await edit(() => movePill(dir))
        keepFocus($, e.requestId ?? PANE_ID, g)
      }),
    editSeg: () =>
      press(() =>
        nav(() => {
          d.from = 'layout'
          d.tab = 'element'
          S.focusKey = ''
          return focusId ? '' : 'выберите элемент в строке: вкладка «Элемент» настраивает выбранную пилюлю'
        }),
      ),
    addLine: () =>
      press(() => {
        if (S.bandMeasured && d.lines.length >= S.lastMaxRows) return nav(() => 'полоса вмещает ' + S.lastMaxRows + ' строк')
        return edit(() => {
          d.lines.push([])
          return 'добавлена строка ' + d.lines.length
        })
      }),
    delLine: (line) =>
      press(() => {
        if (!d.lines[line]) return nav(() => 'этой строки больше нет')
        if (d.lines.length <= 1) return nav(() => 'последнюю строку удалить нельзя')
        return edit(() => {
          const ids = d.lines.splice(line, 1)[0]!.map((s) => s.id)
          if (d.targetLine >= line) d.targetLine--
          if (d.focus) d.focus = d.focus.line === line ? null : d.focus.line > line ? { line: d.focus.line - 1, seg: d.focus.seg } : d.focus
          clampNav(d)
          return 'строка ' + (line + 1) + ' удалена' + (ids.length > 0 ? '; в доступные: ' + ids.join(', ') : '')
        })
      }),
    addInto: (line) =>
      press(() =>
        nav(() => {
          d.targetLine = line
          d.tab = 'elements'
          return ''
        }),
      ),
    moveTarget: (delta) =>
      press(() =>
        nav(() => {
          if (d.lines.length === 0) return 'строк нет: элемент создаст строку 1'
          const cur = Math.max(0, Math.min(d.targetLine, d.lines.length - 1))
          const next = cur + delta
          if (next < 0) return 'цель уже строка 1'
          if (next > d.lines.length - 1) return 'цель уже последняя строка (' + d.lines.length + ')'
          d.targetLine = next
          return ''
        }),
      ),
    preset: (id) =>
      press(() =>
        edit(() => {
          const next = presetLines(id)
          if (sameLayout(d.lines, next)) return 'раскладка уже «' + (LAYOUT_PRESETS.find((p) => p.id === id)?.label ?? id) + '»'
          d.lines = next.map((l) => l.map((s) => ({ ...s })))
          d.focus = null
          clampNav(d)
          return ''
        }),
      ),
    setQuery: (text) => press(() => nav(() => { d.query = text; d.page = 0; return '' })),
    setFam: (fam) =>
      press(() =>
        nav(() => {
          if (d.fam === fam) return 'этот фильтр уже выбран'
          d.fam = fam
          d.page = 0
          return ''
        }),
      ),
    setPage: (delta) =>
      press(() =>
        nav(() => {
          const n = pagesOf(filteredRegistry(d))
          if (n <= 1) return 'все элементы на одной странице'
          d.page = (((Math.min(d.page, n - 1) + delta) % n) + n) % n
          return ''
        }),
      ),
    toggleElement: (id) =>
      press(() =>
        edit(() => {
          const focused = d.focus ? d.lines[d.focus.line]?.[d.focus.seg] : undefined
          const where: number[] = []
          d.lines.forEach((line, i) => {
            if (line.some((s) => s.id.split('#')[0]! === id)) where.push(i)
          })
          if (where.length > 0) {
            // CONSTRAINT (#521 Р5): an element stands once in the layout; every
            // copy a stored draft carries leaves with it
            for (const i of where) d.lines[i] = d.lines[i]!.filter((s) => s.id.split('#')[0]! !== id)
            d.focus = null
            if (focused) {
              d.lines.forEach((line, li) => {
                const si = line.indexOf(focused)
                if (si >= 0) d.focus = { line: li, seg: si }
              })
            }
            const at = where.map((i) => i + 1)
            return id + (at.length === 1 ? ' убран из строки ' + at[0] : ' убран из строк ' + at.join(', '))
          }
          if (d.lines.length === 0) d.lines.push([])
          const li = Math.max(0, Math.min(d.targetLine, d.lines.length - 1))
          d.lines[li]!.push({ id, body: '{' + id + '.text}' })
          d.focus = { line: li, seg: d.lines[li]!.length - 1 }
          return id + ' → строка ' + (li + 1)
        }),
      ),
    setVariant: (id) => press(() => elemEdit('v', id)),
    setOption: (key, value) => press(() => elemEdit('o:' + key, value)),
    nudgeOption: (key, delta) =>
      press(() =>
        edit(() => {
          if (!focusId) return 'выберите элемент в строке: настройки относятся к выбранной пилюле'
          const def2 = REG.byId.get(focusId.split('#')[0]!)!.def
          const o = (def2.options ?? []).find((x) => x.key === key)
          if (!o || o.kind !== 'int') return 'у элемента нет числа «' + key + '»'
          const cur = Number(optionsOf(def2, d.elements)[key] ?? o.default) + delta * (o.step ?? 1)
          const before = JSON.stringify(own(d.elements, def2.id) ?? {})
          setElem(d, def2.id, 'o:' + key, String(Math.max(o.min, Math.min(o.max, cur))))
          return JSON.stringify(own(d.elements, def2.id) ?? {}) === before ? 'предел: от ' + o.min + ' до ' + o.max : ''
        }),
      ),
    setColor: (value) => press(() => elemEdit('c', value)),
    setCustomColor: (text) => press(() => (/^#[0-9a-fA-F]{6}$/.test(text) ? elemEdit('c', text.toLowerCase()) : nav(() => 'цвет не принят: нужен #rrggbb'))),
    setIcon: (set) => press(() => elemEdit('ic', set)),
    setLabelMode: (mode) => press(() => elemEdit('lb', mode)),
    setLabelText: (text) => press(() => elemEdit('lt', text)),
    setBarPair: (pair) => press(() => elemEdit('bp', pair)),
    setBarWidth: (width) => press(() => elemEdit('bw', width)),
    setBarShow: (show) => press(() => elemEdit('bs', show)),
    setOrder: (order) => press(() => elemEdit('o:order', order)),
    setAxis: (axis, value) =>
      press(() =>
        edit(() => {
          if (axisValue(axis) === value) return 'уже выбрано'
          d.axes[axis] = value
          return ''
        }),
      ),
    applyTheme: (name) =>
      press(() =>
        edit(() => {
          if (d.axes['theme'] === name && THEME_AXES.every((axis) => d.axes[axis] === 'theme')) return 'тема «' + name + '» уже применена'
          d.axes['theme'] = name
          for (const axis of THEME_AXES) d.axes[axis] = 'theme'
          return ''
        }),
      ),
    setThemeName: (text) => press(() => nav(() => { d.themeName = text; return '' })),
    saveTheme: () =>
      press(async () => {
        await saveUserTheme($, surface.inputs ? d.themeName : null)
        if (live(g)) invalidate($)
      }),
    setNumber: (field, value) =>
      press(() =>
        edit(() => {
          if (numberValue(field) === value) return 'уже выбрано'
          d.axes[field] = value
          return ''
        }),
      ),
    save: () => press(() => saveDraft($)),
    undoStep: () =>
      press(() => {
        const snap = d.undo.pop()
        if (!snap) return nav(() => 'нечего отменять в черновике')
        return nav(() => {
          restoreSnap(d, snap)
          return 'шаг назад: последняя правка черновика снята'
        })
      }),
    discard: () =>
      press(() => {
        const n = draftChanges(d)
        if (n === 0) return nav(() => 'несохранённых правок нет')
        // #521 FIX2 Р26: an undoable step — its prior content goes on the step stack
        return edit(() => {
          restoreSnap(d, snapOf(freshDraft()))
          return 'правки отброшены — «↶ Шаг назад» вернёт их'
        })
      }),
    close: () => press(() => closePane($)),
    undo: () => press(() => undoSave($)),
    resetToTheme: () => press(() => edit(() => resetToTheme(d))),
  }
  return { model, actions }
}

function setElem(d: Draft, id: string, key: string, value: string): void {
  const cur: ElemSettings = { ...(own(d.elements, id) ?? {}) }
  if (value === '') {
    if (Object.prototype.hasOwnProperty.call(cur, key)) delete cur[key]
  } else setOwn(cur, key, value)
  if (Object.keys(cur).length === 0) {
    if (Object.prototype.hasOwnProperty.call(d.elements, id)) delete d.elements[id]
  } else setOwn(d.elements, id, cur)
}

function rawValue(id: string, elements: Record<string, ElemSettings>, nf: NumberFormat): Value {
  const got = valueOf(id, undefined, elements, nf)
  return got ? got.value : { state: 'nosource' as const, reason: 'unknown element' }
}

function axisSample(axis: string, value: string): string {
  if (axis === 'caps') return value === 'unicode-round' ? '◖◗' : value === 'none' ? '' : value
  if (axis === 'bar') return (own(BAR_PAIRS, value) ?? ['', '']).join('')
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

// A read owns one recovery object and one session id. Neither a new session
// nor a new module generation may receive its result or clear its read slot.
function restoreSession($: EngineInterface, session: string): Promise<void> {
  if (!session) return Promise.resolve()
  const base = famState(FAMILIES[0]!) as BaseState
  if (base.session !== '' && base.session !== session) {
    failDiag('info', 'session-snapshot-stale', 'snapshot for ' + session + ' discarded; current session is ' + base.session)
    return Promise.resolve()
  }
  const recovery = S.recovery
  if (recovery.session === '') recovery.session = session
  if (base.session === '') S.famStates.set(FAMILIES[0]!, { ...base, session })
  if (recovery.status !== 'pending') return Promise.resolve()
  if (recovery.reading) return recovery.reading
  const g = S.gen
  const read = (async () => {
    try {
      const raw = await $.store.get(STORE_SESS + session)
      if (!live(g)) return staleDrop('session snapshot read')
      await readClock($)
      if (!live(g)) return staleDrop('session snapshot read')
      // CONSTRAINT (S4-FIX16 Г4): a stale read does not call learnRead — its
      // boundSess would take the episodes of the new session
      const early = famState(FAMILIES[0]!) as BaseState
      if (S.recovery !== recovery || (early.session !== '' && early.session !== session)) {
        failDiag('info', 'session-snapshot-stale', 'snapshot for ' + session + ' discarded; current session is ' + early.session)
        return
      }
      // CONSTRAINT (S4-FIX14 У3): the ordering reads of the stored value are
      // part of its parse — a throw there is a shape fault and ends recovery,
      // not a read fault to retry
      let stored: SessValue | undefined
      let snap: SessValue | undefined
      try {
        stored = learnRead(STORE_SESS + session, ordOf(raw), raw as SessValue)
        // Р1.4: the store may lag behind a value of this key still queued
        const pending = newestPending(session)
        snap = pending !== null && cmp(ordOf(pending), ordOf(stored)) > 0 ? pending : stored
      } catch (err) {
        if (S.recovery !== recovery) return
        recovery.status = 'lost'
        recovery.buffer = []
        failDiag('fail', 'session-snapshot-shape', 'session ' + session + ': malformed snapshot; no accumulated figures restored: ' + errorText(err))
        markPicture()
        invalidate($)
        return
      }
      const current = famState(FAMILIES[0]!) as BaseState
      if (S.recovery !== recovery || (current.session !== '' && current.session !== session)) {
        failDiag('info', 'session-snapshot-stale', 'snapshot for ' + session + ' discarded; current session is ' + current.session)
        return
      }
      if (recovery.status === 'lost') return
      if (snap !== undefined && snap !== null) {
        // Р6: the live turns seen after the last info read are the restored
        // session's own window — replay attributes them, not the next id
        const sinceInfo = Math.max(0, current.mainTurns - current.mainTurnsAtInfo)
        // CONSTRAINT (S4-FIX13 Т2, sol 2): a throw of the snapshot parse is a
        // shape fault and ends recovery; rereading it on every gather is not
        // recovery
        let shapeErr = ''
        let restored: BaseState
        try { restored = applySnapshot(current, snap) } catch (err) { restored = current; shapeErr = errorText(err) }
        if (restored === current) {
          // ADJ-3: a malformed snapshot ends recovery HERE — the figures stay
          // unknown until the session changes (the overflow law of AR6-2);
          // rereading and re-diagnosing it on every gather is not recovery
          recovery.status = 'lost'
          recovery.buffer = []
          failDiag('fail', 'session-snapshot-shape', 'session ' + session + ': malformed snapshot; no accumulated figures restored' + (shapeErr === '' ? '' : ': ' + shapeErr))
          markPicture()
          invalidate($)
          return
        }
        S.famStates.set(FAMILIES[0]!, replaySnapshot(restored, recovery.buffer, sinceInfo))
      }
      recovery.buffer = []
      recovery.status = 'complete'
      markPicture()
      invalidate($)
    } catch (err) {
      if (live(g) && S.recovery === recovery) failDiag('fail', 'session-snapshot-read', 'the session snapshot could not be read: ' + errorText(err) + '; accumulated figures stay pending; the next gather retries')
    } finally {
      recovery.reading = null
    }
  })()
  recovery.reading = read
  return read
}

// ---------- the session write queue (Р1–Р3) ----------

function nextSeq(): number {
  seqN++
  const base = Math.floor(clockMs) * SEQ_PER_MS
  // CONSTRAINT (FIX8 Ф2): seqOf maps a seq at SEQ_CAP to ZERO and the fences
  // drop a ZERO-ord value as stale — the step leg never crosses the cap
  seqLast = base > seqLast && base < SEQ_CAP ? base : Math.min(seqLast + 1, SEQ_CAP - 1)
  if (seqLast === SEQ_CAP - 1) episodeDiag('warn', 'session-snapshot-seq-cap', STORE_SESS, 'session seq reached its cap; local write order continues by the snapshot\'s own n')
  else endEpisode(STORE_SESS, ['session-snapshot-seq-cap'])
  return seqLast
}

function seqOf(value: unknown): number {
  const seq = value !== null && typeof value === 'object' ? (value as { seq?: unknown }).seq : undefined
  return typeof seq === 'number' && Number.isSafeInteger(seq) && seq > 0 && seq < SEQ_CAP ? seq : 0
}

const ZERO: Ord = { seq: 0, origin: '' }

// a value without a valid seq is ZERO whatever its origin: the fences never
// let it through
function ordOf(value: unknown): Ord {
  const seq = seqOf(value)
  const o = value !== null && typeof value === 'object' ? (value as { origin?: unknown }).origin : undefined
  const n = value !== null && typeof value === 'object' ? (value as { n?: unknown }).n : undefined
  // CONSTRAINT (S4-FIX11 Н6, swe2 F7): n is validated like seq — a stored body
  // echoing this origin with n NaN or 1e308 must not wedge the cmp leg (a
  // non-finite winner fences every later own write of the key). Anything that
  // is not a non-negative safe integer orders as zero, as a missing n does.
  return seq === 0 ? ZERO : { seq, origin: typeof o === 'string' ? o : '', n: typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0 }
}

function cmp(a: Ord, b: Ord): number {
  if (a.seq !== b.seq) return a.seq < b.seq ? -1 : 1
  if (a.origin === b.origin && a.origin === origin) return (a.n ?? 0) - (b.n ?? 0)
  return a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0
}

function ioOf($: EngineInterface): StoreIO {
  return {
    put: (k, v) => $.store.set(k, v),
    arm: (fn) => $.clock.after(STORE_HANG_MS, fn),
    get: (k) => $.store.get(k),
    keys: () => $.store.keys(),
    del: (k) => $.store.delete(k),
  }
}

function currentKey(): string {
  const session = (famState(FAMILIES[0]!) as BaseState).session
  return session === '' ? '' : STORE_SESS + session
}

const EPISODE_WRITE = ['session-snapshot-write', 'session-snapshot-hung', 'session-snapshot-end', 'session-snapshot-blocked', 'stale-write', 'session-snapshot-clock']
const KEY_MERGE_EPISODES = 64

// CONSTRAINT (FIX7 Р6, FIX8 Ф4): the store is one 4 MiB JSON shared by every
// session of the user (d.ts:2909-2940); every string of the stored record is
// bounded — values and object keys alike, at any depth — whatever its
// source: a live capture or a value read back from a store of 0.5.0, whose
// rows (seenTurns ids, agent ids, tool names, AgentRec.turn/status, legacy
// extra fields) were never bounded at capture
// Schema arrays keep their own caps; unknown legacy arrays have a separate
// bound, including arrays nested inside legacy objects or array elements.
const SESS_ARRAY_PATHS = new Set(['"seenTurns"', '"agents"/"map"', '"agents"/"map"/[]', '"agents"/"done"', '"tools"/"byName"', '"tools"/"byName"/[]', '"tools"/"done"'])
const boundJson = (v: unknown, key: string, path: string, marked: boolean, at: string): unknown => {
  // CONSTRAINT (S4-FIX11 Н1): a marked snapshot's ID strings are canonical up
  // to the size bound — an id past 200 in a marked value is foreign or
  // corrupt and takes the capture image (FIX8 Ф4 stays unbroken); the legacy
  // pass canonicalizes at the ID paths outright
  if (typeof v === 'string') return SESS_ID_PATHS.has(path) ? (marked ? (v.length <= 200 ? v : snapshotText(v)) : snapshotText(v)) : boundText(v)
  if (Array.isArray(v)) {
    let rows = v
    if (!SESS_ARRAY_PATHS.has(path) && v.length > 64) {
      rows = v.slice(0, 64)
      episodeDiag('warn', 'session-snapshot-array-cap', key, 'store.set ' + key + ': legacy array ' + path + ' limited to 64 elements')
    }
    return rows.map((entry, i) => boundJson(entry, key, path + '/[]', marked, at + '/[' + i + ']'))
  }
  if (v !== null && typeof v === 'object') {
    // CONSTRAINT (S4-FIX11 Н5): two distinct keys can bound to one image (a
    // stored id and the image of its raw); the merge keeps the FIRST
    // Object.entries position and is diagnosed once per episode per key.
    // CONSTRAINT (S4-FIX12 Н8, S4-FIX13 Т4, S4-FIX14 У6): the episode is the
    // triple (store key, object location with array indices, key image) — a
    // second, different pair in the same store record, or the same image
    // merged at another object location, is its own episode; the text names the key image, the dropped later key and
    // the object location (with array indices).
    // The kind stays out of EPISODE_WRITE: nothing here ends it but a reset.
    const entries: [string, unknown][] = []
    const emitted = new Set<string>()
    for (const [k, val] of Object.entries(v)) {
      const bk = boundText(k)
      if (emitted.has(bk)) {
        const epId = JSON.stringify([key, at, bk])
        // CONSTRAINT (S4-FIX14 У7): key-merge episodes never end but by a
        // reset, so their ids are capped; past the cap a merge still drops the
        // later value, without its own record. The cap holds within a session:
        // a session change frees it (S4-FIX15 В5)
        if (!S.episodes.has('session-snapshot-key-merge|' + epId) && [...S.episodes].filter((id) => id.startsWith('session-snapshot-key-merge|')).length >= KEY_MERGE_EPISODES) {
          failDiag('warn', 'session-snapshot-key-merge-cap', 'store.set: 64 key-merge records are open in this session; further merges drop the later value without a record')
          continue
        }
        episodeDiag('warn', 'session-snapshot-key-merge', epId, 'store.set ' + key + ': object ' + at + ' has two keys bounded to ' + JSON.stringify(bk) + '; the later value of ' + JSON.stringify(k.length > 80 ? k.slice(0, 80) + '…' : k) + ' is dropped')
        continue
      }
      emitted.add(bk)
      entries.push([bk, boundJson(val, key, path === '' ? JSON.stringify(k) : path + '/' + JSON.stringify(k), marked, at === '' ? JSON.stringify(k) : at + '/' + JSON.stringify(k))])
    }
    return Object.fromEntries(entries)
  }
  return v
}
function boundSess(value: SessValue, key: string): SessValue {
  // CONSTRAINT (FIX10 Ж9, S4-FIX11 Н1): the NORM marker says the SESS_ID_PATHS
  // strings are canonical. The pass is canonical in BOTH modes (legacy
  // encodes at the ID paths, marked is trusted up to the size bound), so the
  // result is marked ALWAYS: an unmarked copy parked in LANDED would be
  // re-encoded a second time by requeueNewest into an image that matches no
  // capture id (double-count after the next reload).
  const bounded = boundJson(value, key, '', value.norm === NORM, '') as SessValue
  return { ...bounded, norm: NORM }
}

// CONSTRAINT (FIX7 Р4): a key at its flight limit says so once per episode —
// how many of its store.set calls are unsettled and that its newest value is
// parked; the episode ends where the key's other write episodes end
function blockedDiag(key: string): void {
  episodeDiag('fail', 'session-snapshot-blocked', key, 'store.set ' + key + ': ' + String(INFLIGHT.get(key) ?? 0) + ' writes not settled; the newest value is parked')
}

// Р1.2: what landed — a write that settled, or the value read back
function learn(key: string, ord: Ord, value: SessValue): void {
  if (ord.seq > 0 && cmp(ord, LANDED.get(key) ?? ZERO) > 0) LANDED.set(key, { seq: ord.seq, origin: ord.origin, n: ord.n, value })
  if (ord.seq > seqLast) seqLast = ord.seq
  pruneLanded()
}

// CONSTRAINT (FIX8 Ф2): a seq read from the store that runs past this
// process's clock by more than a day is not learned — learn would drag
// seqLast toward the SEQ_CAP boundary and silence every later write of every
// key of this environment. The value counts as older than any of this
// module's own writes instead: the fences compare only what learn admitted,
// so the next own write puts over it
const CLOCK_AHEAD_SEQ = 24 * 60 * 60 * 1000 * SEQ_PER_MS
// boundJson only accepts JSON-copied values because it cannot traverse cycles.
function learnRead(key: string, ord: Ord, value: SessValue): SessValue {
  let bounded = value
  try {
    bounded = boundSess(JSON.parse(JSON.stringify(value)) as SessValue, key)
  } catch {
    /* CONSTRAINT (#521 Р11): downstream copy boundaries own the diagnostic for non-JSON snapshots */
  }
  const base = (clockMs > 0 ? Math.floor(clockMs) : Date.now()) * SEQ_PER_MS
  const beyond = ord.seq - (base + CLOCK_AHEAD_SEQ)
  if (beyond > 0) {
    episodeDiag('warn', 'session-snapshot-clock', key, 'store.set ' + key + ': the stored seq ' + String(ord.seq) + ' runs ' + String(beyond) + ' beyond the clock window; it is not learned and is overwritten by this module\'s next write')
    return bounded
  }
  learn(key, ord, bounded)
  return bounded
}

function pruneLanded(): void {
  const current = currentKey()
  for (const key of [...LANDED.keys()]) {
    if (key !== current && !SESS_Q.has(key) && !INFLIGHT.has(key) && !FAREWELL.has(key.slice(STORE_SESS.length))) LANDED.delete(key)
  }
  while (LANDED.size > SESS_KEEP) {
    let low: [string, Landed] | null = null
    // CONSTRAINT (FIX7 Р10): the cap evicts no key with an unsettled
    // store.set — its late landing would otherwise fence against ZERO and
    // count as landed. Slot and farewell keys stay evictable here on
    // purpose: their waiting values live in SESS_Q / FAREWELL, not in
    // LANDED, and re-land through their own paths — protecting their LANDED
    // entries would let a key with no live writer hold a seat forever and
    // wedge the SESS_KEEP cap (S4F6 Р3)
    for (const entry of LANDED) {
      if (entry[0] !== current && !INFLIGHT.has(entry[0]) && (low === null || cmp(entry[1], low[1]) < 0)) low = entry
    }
    if (low === null) return
    LANDED.delete(low[0])
  }
}

// the newest (seq, origin) of the key among what landed and what still waits;
// `except` is left out, its value included where FAREWELL holds it
function newestKnown(session: string, except: WriteItem | null): Ord {
  const key = STORE_SESS + session
  const slot = SESS_Q.get(key)
  let best: Ord = LANDED.get(key) ?? ZERO
  for (const item of [slot?.flight?.item ?? null, slot?.next ?? null]) {
    if (item !== null && item !== except && cmp(item.ord, best) > 0) best = item.ord
  }
  const fw = FAREWELL.get(session)
  if (fw !== undefined && fw !== except?.value && cmp(ordOf(fw), best) > 0) best = ordOf(fw)
  return best
}

function newestPending(session: string): SessValue | null {
  const key = STORE_SESS + session
  const slot = SESS_Q.get(key)
  let best: SessValue | null = FAREWELL.get(session) ?? null
  for (const item of [slot?.flight?.item ?? null, slot?.next ?? null]) {
    if (item !== null && (best === null || cmp(item.ord, ordOf(best)) > 0)) best = item.value
  }
  return best
}

// CONSTRAINT (FIX7 Р5): the drop is per key and per episode, like the write
// records — two keys discarding are two records; the episode ends where the
// key's other write episodes end
function staleWrite(session: string, ord: Ord): void {
  episodeDiag('debug', 'stale-write', STORE_SESS + session, 'the session snapshot of ' + session + ' (seq ' + String(ord.seq) + ') is not written: a newer value of the key landed or waits')
}

// CONSTRAINT (Д1, FIX6 Р7): a refused write and a hung one leave their value
// to the same retry — the dirty bit of the current session's recovery for its
// own write and for a farewell of that session once its recovery is complete
// (the restored state took the farewell from the queue, Р1.4); otherwise the
// farewell back into FAREWELL while it is the newest value of its key (Р1.3).
// The tail names the retry; null = a switched-away session's write, nobody
// retries it.
function retryLater(session: string, item: WriteItem): string | null {
  const owner = item.owner
  if (owner.kind === 'session') {
    if (S.recovery !== owner.recovery) return null
    owner.recovery.writePending = true
    owner.recovery.retryFor = item
    return '; the next gather retries'
  }
  if (cmp(item.ord, newestKnown(session, item)) <= 0) return '; a newer value of the key supersedes it'
  const recovery = S.recovery
  if (recovery.session === session && recovery.status === 'complete' && currentKey() === STORE_SESS + session) {
    recovery.writePending = true
    recovery.retryFor = item
    return '; the next gather retries'
  }
  FAREWELL.set(session, item.value)
  return '; the next gather retries it once'
}

function onWriteFail(session: string, item: WriteItem, err: unknown): void {
  const tail = retryLater(session, item)
  if (tail === null) return
  const what = item.owner.kind === 'session' ? 'the session snapshot' : 'the session snapshot of ' + session
  episodeDiag('fail', 'session-snapshot-write', STORE_SESS + session, what + ' could not be stored: ' + errorText(err) + (item.atEnd ? END_TAIL : tail))
}

// the wait of session.end on one write it started (Р6)
type Pending = { key: string; item: WriteItem; done: Promise<void>; settled: boolean }

function sessWrite($: EngineInterface, session: string, value: SessValue, owner: WriteOwner, atEnd = false): Pending {
  let release: () => void = () => undefined
  const done = new Promise<void>((resolve) => {
    release = resolve
  })
  let copy: SessValue
  try {
    copy = boundSess(JSON.parse(JSON.stringify(value)) as SessValue, STORE_SESS + session)
  } catch (err) {
    // CONSTRAINT (FIX7 Р12): a value the JSON round-trip cannot carry is
    // diagnosed and dropped — session.end's next(e) is never held by it
    failDiag('fail', 'session-snapshot-copy', 'the session snapshot of ' + session + ' could not be copied for the store: ' + errorText(err))
    const dead: WriteItem = { value, ord: ordOf(value), owner, io: null, atEnd, sent: false, settle: () => undefined }
    return { key: STORE_SESS + session, item: dead, done: Promise.resolve(), settled: true }
  }
  let settled = false
  const item: WriteItem = {
    value: copy,
    ord: ordOf(copy),
    owner,
    io: ioOf($),
    atEnd,
    sent: false,
    settle: () => {
      if (settled) return
      settled = true
      pending.settled = true
      release()
    },
  }
  const pending: Pending = { key: STORE_SESS + session, item, done, settled: false }
  sessEnqueue(session, item)
  return pending
}

function sessEnqueue(session: string, item: WriteItem): void {
  const key = STORE_SESS + session
  if (cmp(item.ord, newestKnown(session, null)) <= 0) {
    staleWrite(session, item.ord)
    return item.settle()
  }
  const slot = SESS_Q.get(key)
  if (slot !== undefined) {
    // CONSTRAINT (FIX4 Р2): one write per key in flight; a newer request
    // REPLACES the pending one — the newest value wins, and the replaced
    // request settles with it
    const replaced = slot.next
    if (replaced !== null) {
      const own = item.settle
      item.settle = () => {
        replaced.settle()
        own()
      }
    }
    slot.next = item
    // CONSTRAINT (FIX7 Р1): a value that waits at a key whose flight is
    // free, under the limit and with an io of its own, runs now —
    // session.end has no gather after it to release it
    if (slot.flight === null && item.io !== null && (INFLIGHT.get(key) ?? 0) < SESS_FLIGHTS) {
      slot.next = null
      return sessRun(session, key, slot, item, item.io)
    }
    if ((INFLIGHT.get(key) ?? 0) >= SESS_FLIGHTS) blockedDiag(key)
    return
  }
  const fresh: SessSlot = { flight: null, next: null }
  SESS_Q.set(key, fresh)
  if (item.io === null) fresh.next = item
  else if ((INFLIGHT.get(key) ?? 0) >= SESS_FLIGHTS) {
    fresh.next = item
    blockedDiag(key)
  }
  else sessRun(session, key, fresh, item, item.io)
}

// the gather start runs a value that waits in a slot with nothing in flight,
// once the key is under SESS_FLIGHTS, through the item's `$` or this gather's
function releaseParked($: EngineInterface): void {
  for (const [key, slot] of [...SESS_Q]) {
    const item = slot.next
    if (slot.flight !== null || item === null || (INFLIGHT.get(key) ?? 0) >= SESS_FLIGHTS) continue
    slot.next = null
    const io = item.io ?? ioOf($)
    item.io = io
    sessRun(key.slice(STORE_SESS.length), key, slot, item, io)
  }
}

// CONSTRAINT (FIX5 Р3): the watchdog is armed here, at the start of every
// flight, through the enqueuing call's own `$`
function sessRun(session: string, key: string, slot: SessSlot, item: WriteItem, io: StoreIO): void {
  if (cmp(item.ord, LANDED.get(key) ?? ZERO) <= 0) {
    staleWrite(session, item.ord)
    item.settle()
    return advance(key, slot)
  }
  const flight: Flight = { item, hung: false, at: now() }
  slot.flight = flight
  let timer: { cancel: () => void } | null = null
  try {
    timer = io.arm(() => onHung(key, slot, flight))
  } catch (err) {
    failDiag('warn', 'session-snapshot-watchdog-' + key.slice(0, 40), 'the store.set watchdog could not be armed: ' + safeText(err) + '; a hung write of ' + key + ' is left to the gather-start sweep')
  }
  const epoch = inflightEpoch
  INFLIGHT.set(key, (INFLIGHT.get(key) ?? 0) + 1)
  void quiet('snapshot-write', async () => {
    let failure: { err: unknown } | null = null
    item.sent = true
    try {
      await io.put(key, item.value)
    } catch (err) {
      failure = { err }
    }
    try {
      try {
        timer?.cancel()
      } catch {
        /* CONSTRAINT (#521 Р11): a refused cancel leaves a watchdog that finds its flight settled */
      }
      try {
        if (!live(item.owner.g)) {
          staleDrop('session snapshot')
          if (failure === null) landedLate(session, key, item, null)
          return
        }
        if (flight.hung) return settledLate(session, key, item, failure, io)
        if (failure !== null) onWriteFail(session, item, failure.err)
        else landedNow(key, item, io)
        advance(key, slot)
      } finally {
        item.settle()
      }
    } finally {
      // CONSTRAINT (FIX7 Р1): the flight is counted until its settling is
      // whole — a requeue the settling itself starts must still see this
      // flight in the count, or the freed slot starts one write too many.
      // The last reference of an idle key dies here, its LANDED entry with
      // it — never for a wiped generation (currentKey would reach into the
      // new state's families)
      if (epoch === inflightEpoch) {
        const k = INFLIGHT.get(key) ?? 0
        if (k > 1) INFLIGHT.set(key, k - 1)
        else {
          INFLIGHT.delete(key)
          if (live(item.owner.g)) pruneLanded()
        }
        // CONSTRAINT (FIX8 Ф1): the decrement itself frees a seat, and no
        // gather follows a settle — advance saw this flight still counted and
        // parked the key's newest; below the limit it runs now, through this
        // flight's io when the value has none of its own (a dead generation
        // lends nothing, FIX7 AR4)
        if (live(item.owner.g) && (INFLIGHT.get(key) ?? 0) < SESS_FLIGHTS) {
          const slot = SESS_Q.get(key)
          const queued = slot?.next ?? null
          if (slot !== undefined && slot.flight === null && queued !== null) {
            if (queued.io === null) queued.io = io
            if (queued.io !== null) {
              slot.next = null
              sessRun(key.slice(STORE_SESS.length), key, slot, queued, queued.io)
            }
          }
        }
      }
    }
  })
}

function landedNow(key: string, item: WriteItem, io: StoreIO): void {
  learn(key, item.ord, item.value)
  endEpisode(key, EPISODE_WRITE)
  if (currentKey() === key) pruneStore(io)
}

// CONSTRAINT (FIX6 Р1): a flight past the watchdog settles into the key's
// accounting — a refusal is an ordinary retry while its value is the newest
// known, a landing goes through landedLate
function settledLate(session: string, key: string, item: WriteItem, failure: { err: unknown } | null, io: StoreIO): void {
  if (failure === null) return landedLate(session, key, item, io)
  if (cmp(item.ord, newestKnown(session, item)) > 0) onWriteFail(session, item, failure.err)
}

// CONSTRAINT (Д2, FIX6 Р1/Р3): a settle past the watchdog, or of a wiped
// generation, has put its value over the key. Below a newer known value, that
// value goes out again under a fresh seq through the settled flight's own `$`
// — the fence would turn away its old one. The newest value of this
// generation counts as landed: the retry it left is taken back.
// CONSTRAINT (FIX6b AR4): `own` null = a flight of a wiped generation; its
// `$` is not called again (a reload is a new environment, d.ts:2946-2947, and
// a wipe here leaves that `$` to the generation that is gone) — the newest
// value waits in the slot for the next gather of the live generation
function landedLate(session: string, key: string, item: WriteItem, own: StoreIO | null): void {
  if (cmp(item.ord, newestKnown(session, item)) < 0) return requeueNewest(session, key, own)
  if (own === null) return
  learn(key, item.ord, item.value)
  const recovery = S.recovery
  if (recovery.retryFor === item) {
    recovery.writePending = false
    recovery.retryFor = null
  }
  if (FAREWELL.get(session) === item.value) FAREWELL.delete(session)
  endEpisode(key, EPISODE_WRITE)
  if (currentKey() === key) pruneStore(own)
}

// the newest known value of the key (landed, in flight, queued) goes into the
// queue again under a fresh seq, through `io` (null: the next gather's);
// CONSTRAINT (Д4): a newer farewell still waiting is left to its flush point
function requeueNewest(session: string, key: string, io: StoreIO | null): void {
  const slot = SESS_Q.get(key)
  const landed = LANDED.get(key)
  let best: { ord: Ord; value: SessValue } | null = landed !== undefined ? { ord: landed, value: landed.value } : null
  for (const item of [slot?.flight?.item ?? null, slot?.next ?? null]) {
    if (item !== null && (best === null || cmp(item.ord, best.ord) > 0)) best = item
  }
  const fw = FAREWELL.get(session)
  if (best === null || (fw !== undefined && cmp(ordOf(fw), best.ord) > 0)) return
  // CONSTRAINT (FIX7b): the callers' quiet must not swallow this copy — a
  // value the JSON round-trip cannot carry (a 0.5.0 store value learned into
  // LANDED at a restore) is diagnosed aloud, the requeue ends, the gather
  // goes on
  let copy: SessValue
  try {
    // CONSTRAINT (FIX8 Ф3): the requeue goes straight to sessEnqueue — this
    // copy is the one boundSess sessWrite never sees; it is bounded here or
    // the bypass undoes the store's row limit (a 0.5.0 value in LANDED)
    copy = boundSess(JSON.parse(JSON.stringify(best.value)) as SessValue, key)
  } catch (err) {
    failDiag('fail', 'session-snapshot-copy', 'the session snapshot of ' + session + ' could not be copied for the store: ' + errorText(err))
    return
  }
  const value = stampSnapshot(copy)
  sessEnqueue(session, { value, ord: ordOf(value), owner: { kind: 'farewell', g: S.gen }, io, atEnd: false, sent: false, settle: () => undefined })
}

function onHung(key: string, slot: SessSlot, flight: Flight): void {
  if (!live(flight.item.owner.g) || slot.flight !== flight) return
  flight.hung = true
  const tail = retryLater(key.slice(STORE_SESS.length), flight.item)
  // CONSTRAINT (FIX7 Р4): the retry promise holds only while the key is
  // under its flight limit; at the limit the parked newest value is the
  // blocked record's to explain
  const promise = flight.item.atEnd ? END_TAIL : (INFLIGHT.get(key) ?? 0) >= SESS_FLIGHTS || tail === null ? '' : tail
  episodeDiag('fail', 'session-snapshot-hung', key, 'store.set ' + key + ' висит > 15 с' + promise)
  advance(key, slot)
}

// CONSTRAINT (Д5, FIX6 Р2): the host may drop a clock.after without a word
// (d.ts:2974-2977) — a flight older than STORE_HANG_MS by now() goes through
// onHung at the gather start; onHung turns away a flight the timer already
// took, so the two report it once. now() is process-relative; the mod clock
// is a data stamp, never a boundary of this queue
function sweepHung(): void {
  const t = now()
  for (const [key, slot] of [...SESS_Q]) {
    const flight = slot.flight
    if (flight !== null && !flight.hung && t - flight.at > STORE_HANG_MS) onHung(key, slot, flight)
  }
}

// CONSTRAINT (S4-FIX16d Г3): one once-key per store key and outcome — two stale read-backs of one session never share a record
const staleVerifyKey = (key: string, outcome: 'read' | 'refused'): string => 'session-verify-stale|' + key + '|' + outcome

// CONSTRAINT (S4-FIX16e Е2): stale outcomes settling after the session-change sweep pile up until the next change — bounded by CAP.diag
function staleVerifyDiag(key: string, outcome: 'read' | 'refused', text: string): void {
  const once = staleVerifyKey(key, outcome)
  if (!S.diagOnce.has(once)) {
    const held = [...S.diagOnce].filter((k) => k.startsWith('session-verify-stale|'))
    if (held.length >= CAP.diag) S.diagOnce.delete(held[0]!)
  }
  failDiag('info', once, text)
}

// CONSTRAINT (Д3, FIX6 Р2/Р3/Р8): a late landing of another environment or of
// a wiped generation is outside these maps — at most once per STORE_HANG_MS of
// now() the current session's key is read back against its landed value,
// through this gather's `$`; one read-back of a key at a time, one hanging
// past STORE_HANG_MS is reported once per episode
function verifyStore($: EngineInterface): void {
  const key = currentKey()
  if (key === '') return
  const landed = LANDED.get(key)
  if (landed === undefined) return
  const t = now()
  const pendingAt = S.verifyPending.get(key)
  if (pendingAt !== undefined) {
    if (t - pendingAt > STORE_HANG_MS) episodeDiag('warn', 'session-snapshot-verify', key, 'store.get ' + key + ' висит > 15 с; the key is not read back until it settles')
    return
  }
  const at = S.sessVerifyAt
  if (at !== null && t - at < STORE_HANG_MS) return
  S.sessVerifyAt = t
  S.verifyPending.set(key, t)
  const g = S.gen
  // CONSTRAINT (S4-FIX16d Г2): A→B→A gives back the same key; the old read of A must not learn in the new stay in A
  const epoch = S.sessEpoch
  const session = key.slice(STORE_SESS.length)
  const since: Ord = { seq: landed.seq, origin: landed.origin, n: landed.n }
  const io = ioOf($)
  void quiet('snapshot-verify', async () => {
    let stored: unknown
    try {
      stored = await io.get(key)
    } catch (err) {
      if (!live(g)) return
      if (S.verifyPending.get(key) === t) S.verifyPending.delete(key)
      if (currentKey() !== key || S.sessEpoch !== epoch) {
        endEpisode(key, ['session-snapshot-verify'])
        staleVerifyDiag(key, 'refused', 'read-back of ' + key + ' failed after the session changed; current key is ' + currentKey() + ': ' + errorText(err))
        return
      }
      episodeDiag('warn', 'session-snapshot-verify', key, 'the session snapshot of ' + session + ' could not be read back: ' + errorText(err) + '; not re-put in this gather, a gather past 15 s reads it again')
      return
    }
    if (!live(g)) return staleDrop('session snapshot read-back')
    await readClock($)
    if (!live(g)) return staleDrop('session snapshot read-back')
    if (S.verifyPending.get(key) === t) S.verifyPending.delete(key)
    endEpisode(key, ['session-snapshot-verify'])
    // CONSTRAINT (S4-FIX16b Б1, S4-FIX16c В2, S4-FIX16d Г1): a stale read-back does not call learnRead, else its boundSess takes episodes of the new session; a read-back refused after the switch opens no verify episode of the old key, nothing would end it; an episode its hang opened before the switch ends on both outcomes
    if (currentKey() !== key || S.sessEpoch !== epoch) {
      staleVerifyDiag(key, 'read', 'read-back of ' + key + ' discarded after the session changed; current key is ' + currentKey())
      return
    }
    const ord = ordOf(stored)
    // CONSTRAINT (FIX7 Р7): the read-back learns what landed — a foreign
    // origin ahead of this module raises the fence (seqLast; the next write
    // of the key stays above it, no ping-pong of two clocks). A value below
    // the fence is re-put only when it is this module's own (a regression)
    // or its seq ties (the (seq, origin) order decides) — a foreign value of
    // a lower seq is the store's last writer and stands
    learnRead(key, ord, stored as SessValue)
    if ((ord.seq === 0 || ord.origin === since.origin || ord.seq === since.seq) && cmp(ord, since) < 0) requeueNewest(session, key, io)
  })
}

// CONSTRAINT (FIX6 Р4): after a landed write of the current session's key, at
// most once per STORE_HANG_MS of now(); the current key and a key with a slot,
// a farewell or an unsettled store.set here are never deleted; a refusal is one warn
// per episode, a clean pass ends the episode
function pruneStore(io: StoreIO): void {
  const t = now()
  if (S.pruneAt !== null && t - S.pruneAt < STORE_HANG_MS) return
  S.pruneAt = t
  const g = S.gen
  const refused = (call: string, err: unknown): void => {
    if (live(g)) episodeDiag('warn', 'session-snapshot-prune', STORE_SESS, 'the sess: keys could not be pruned: ' + call + ' refused: ' + errorText(err) + '; a landed write past 15 s tries again')
  }
  // CONSTRAINT (FIX6b AR5): the store has no compare-and-delete — a key another
  // process writes between the read and the delete goes; it is a live
  // session's only if its seq (clock ms × 1000) is among the oldest, and that
  // session's next write puts it back
  // INFLIGHT protects a low-ord foreign overwrite while this environment's
  // newer write is unsettled. SESS_Q independently protects an io-null park:
  // a dead generation's late put can requeue the new generation's landed
  // farewell after that key stopped being current, with no INFLIGHT or
  // FAREWELL left. No live io is available until another hook supplies it.
  const kept = (key: string): boolean => key === currentKey() || SESS_Q.has(key) || INFLIGHT.has(key) || FAREWELL.has(key.slice(STORE_SESS.length))
  void quiet('snapshot-prune', async () => {
    let keys: unknown
    try {
      keys = await io.keys()
    } catch (err) {
      return refused('store.keys', err)
    }
    if (!live(g)) return staleDrop('session snapshot prune')
    const sess = (Array.isArray(keys) ? keys : []).filter((k): k is string => typeof k === 'string' && k.startsWith(STORE_SESS))
    const excess = sess.length - SESS_KEEP
    if (excess > 0) {
      let aged: { key: string; ord: Ord }[]
      try {
        aged = await Promise.all(sess.filter((k) => !kept(k)).map(async (key) => ({ key, ord: ordOf(await io.get(key)) })))
      } catch (err) {
        return refused('store.get', err)
      }
      if (!live(g)) return staleDrop('session snapshot prune')
      const drop = aged.filter((a) => !kept(a.key)).sort((a, b) => cmp(a.ord, b.ord)).slice(0, excess)
      const results = await Promise.allSettled(drop.map(async (a) => io.del(a.key)))
      if (!live(g)) return staleDrop('session snapshot prune')
      const refusal = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (refusal !== undefined) return refused('store.delete', refusal.reason)
    }
    endEpisode(STORE_SESS, ['session-snapshot-prune'])
  })
}

function advance(key: string, slot: SessSlot): void {
  // CONSTRAINT (FIX7 Р1): the value waiting behind the flight that just
  // ended starts through that flight's io when it has none of its own — a
  // dead generation lends nothing (AR4: its $ is never called again)
  const done = slot.flight
  slot.flight = null
  const queued = slot.next
  if (queued !== null) {
    if (queued.io === null && done !== null && done.item.io !== null && live(done.item.owner.g)) queued.io = done.item.io
    if (queued.io !== null && (INFLIGHT.get(key) ?? 0) < SESS_FLIGHTS) {
      slot.next = null
      return sessRun(key.slice(STORE_SESS.length), key, slot, queued, queued.io)
    }
    if ((INFLIGHT.get(key) ?? 0) >= SESS_FLIGHTS) blockedDiag(key)
    return
  }
  SESS_Q.delete(key)
  pruneLanded()
}

// CONSTRAINT (FIX5 Р2, Д4): the farewell flush points are exactly two — the
// gather start (refresh) and session.end, after its own snapshot; one attempt
// per key at each
function flushFarewell($: EngineInterface, atEnd = false): Pending[] {
  const out: Pending[] = []
  // over a copy: a synchronous refusal returns its farewell into the map
  for (const [session, value] of [...FAREWELL]) {
    FAREWELL.delete(session)
    out.push(sessWrite($, session, value, { kind: 'farewell', g: S.gen }, atEnd))
  }
  return out
}

// The process sleep and callback timer may both remain unsettled. The
// hook-owned clock.sleep spends the hook's budget and observes next.signal
// (d.ts:2958-2970); either its resolve or rejection ends the wait. Refusal of
// the process sleep alone must not cut short a write still inside the bound.
// Only sent writes get the end record; a parked value has the blocked record.
async function endWait($: EngineInterface, g: number, writes: (Pending | null)[], options: Parameters<EngineInterface['clock']['sleep']>[1]): Promise<void> {
  const open = writes.filter((w): w is Pending => w !== null && !w.settled)
  if (open.length === 0) return
  let sleepRefused = false
  const never = new Promise<void>(() => {})
  let bound: Promise<void>
  try {
    bound = Promise.resolve($.process.run(['/bin/sleep', '3'], { timeoutMs: 5000 })).then(
      (r) => {
        if ((r as { exitCode?: unknown } | null)?.exitCode === 0) return
        sleepRefused = true
        return never
      },
      () => { sleepRefused = true; return never },
    )
  } catch {
    // CONSTRAINT (#521 Р11): sleepRefused goes into the session-snapshot-end text
    sleepRefused = true
    bound = never
  }
  let timerDone!: () => void
  const timerBound = new Promise<void>((resolve) => { timerDone = resolve })
  let timer: { cancel: () => void } | null = null
  try {
    timer = $.clock.after(3000, () => timerDone())
  } catch {
    /* CONSTRAINT (#521 Р11): the two sleep legs still bound the wait */
  }
  let hookBound: Promise<void>
  try {
    hookBound = Promise.resolve($.clock.sleep(3000, options)).then(() => undefined, () => undefined)
  } catch {
    // CONSTRAINT (#521 Р11): the race ends at once; every unsettled write is named by session-snapshot-end below
    hookBound = Promise.resolve()
  }
  await Promise.race([Promise.all(open.map((w) => w.done)), bound, timerBound, hookBound])
  try {
    timer?.cancel()
  } catch {
    /* CONSTRAINT (#521 Р11): a refused cancel only leaves a resolve that is already idempotent */
  }
  for (const w of open) w.item.atEnd = false
  if (!live(g)) return
  for (const w of open) {
    if (w.settled || !w.item.sent) continue
    episodeDiag('fail', 'session-snapshot-end', w.key, 'store.set ' + w.key + ' did not settle before the session ended' + (sleepRefused ? '; the sleep bound did not run' + END_TAIL : END_TAIL))
  }
}

// Writes wait for recovery; a refused write retains the dirty bit for gather.
function snapshotSession($: EngineInterface, atEnd = false): Pending | null {
  S.recovery.writePending = true
  S.recovery.retryFor = null
  return writeSession($, atEnd)
}

function writeSession($: EngineInterface, atEnd = false): Pending | null {
  const recovery = S.recovery
  if (recovery.status !== 'complete') return null
  const snap = snapshotOf(famState(FAMILIES[0]!) as BaseState)
  if (!snap) return null
  recovery.writePending = false
  recovery.retryFor = null
  return sessWrite($, snap.session, stampSnapshot(snap.value), { kind: 'session', recovery, g: S.gen }, atEnd)
}

// The effort seed (ADJUDICATION-S2 #8/#9): one successful $.config.list() read
// per state, from the start path — never from a render; the /config row set
// does not grow an effort key later. A refused read nulls the memo: the next
// refresh (the gather) retries it, and a level a turn.step brought meanwhile
// is the family's own — the seed feeds it only while it is undefined.
const EFFORT_SOURCE: Source = { kind: 'session', call: 'config' }

function seedEffort($: EngineInterface): Promise<void> {
  if (S.effortSeeded) return Promise.resolve()
  if (S.effortSeed !== null) return S.effortSeed
  const g = S.gen
  const read = (async (): Promise<void> => {
    const rows = (await $.config.list()) as { key: string; value: unknown }[]
    if (!live(g)) return staleDrop('effort seed')
    // the input's stamp is the clock's epoch ms, the measure every family
    // input carries — now() is process-relative, for the diagnostics and the
    // write-queue boundaries (FIX6 Р2)
    const at = await readClock($)
    if (!live(g)) return staleDrop('effort seed')
    S.effortSeeded = true
    dispatch({ source: EFFORT_SOURCE, ok: true, data: rows, now: at })
  })()
  const seed = read.catch((err) => {
    if (live(g) && S.effortSeed === seed) S.effortSeed = null
    throw err
  })
  S.effortSeed = seed
  return seed
}

// ---------- registration ----------

export function register(on: On, options: PluginOptions): void {
  // reset the whole in-memory state: a reload wipes it (SPEC §14.7)
  // CONSTRAINT (S1-FIX5 П.5): the wipe is freshState() whole — a field
  // missing from a hand-written list would carry the previous session over.
  // Module bindings (pictureBuilds, clockMs, armOverride) are stand seams and
  // stay; the timers of the previous state are cancelled first.
  wipeState()
  S.recoveryEnabled = true
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
    for (const [i, fam] of REG.families.entries()) {
      try {
        // CONSTRAINT (S4-FIX11 Н2): the WHOLE iteration body stands inside
        // the family's own try — the name read included (swe2 F2: a registry
        // element whose `family` getter throws, or a null entry, must cost
        // one diagnosed family, never the event chain that follows)
        // CONSTRAINT (S4-FIX12 Н7, critic swe2 F3): the index separates
        // families whose names collapse to '<unnamed>' — one record per
        // broken family, not one per collapsed name
        const epKey = event + ':' + String(i) + ':' + safeFamily(fam)
        for (const entry of fam.sources) {
          if (entry.source.kind === 'event' && entry.source.event === event) {
            feed(fam, { source: entry.source, ok: true, data, now: at })
            break
          }
        }
        endEpisode(epKey, ['family-feed'])
      } catch (err) {
        // CONSTRAINT (S4-FIX10 Ж11): one family's refusing feed must not starve
        // the later families of this event — every feed stands alone; the record
        // is one per episode of `event + ':' + index + ':' + family`
        episodeDiag('fail', 'family-feed', event + ':' + String(i) + ':' + safeFamily(fam), 'family ' + safeFamily(fam) + ': the ' + event + ' feed threw: ' + errorText(err))
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
      if (live(g)) {
        dispatchEvent('session.end', e, at)
        const writes = [snapshotSession($, true), ...flushFarewell($, true)]
        // CONSTRAINT (FIX7 Р1): the end itself releases what waits at a free
        // key — there is no gather after it; an io-less wait gets this
        // call's own $
        releaseParked($)
        await endWait($, g, writes, { signal: next.signal })
        // CONSTRAINT (FIX7 Р3): the records the end made ship now — neither a
        // redraw nor a gather follows it
        flushDiag($)
      } else staleDrop('session end')
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
      snapshotSession($)
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
      if (live(g)) {
        dispatchEvent('agent.spawn', r && typeof r === 'object' ? { ...e, ...(r as object) } : e, at)
        snapshotSession($)
      } else staleDrop('agent spawn')
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
      const opened = await openPicker($)
      return opened === true ? {} : opened === false ? RELOADED : { text: opened }
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
    on('ui.focus', async ($, e, next) => {
      const g = S.gen
      const r = await next(e)
      if (!live(g)) {
        staleDrop('ui focus')
        return r
      }
      const ee = e as { requestId?: unknown; plugin?: unknown; element?: unknown }
      // A denied move leaves the ring unchanged; a host target in our pane
      // clears our key. Marketplace suffixes do not change plugin identity.
      if (
        !(r as { deny?: unknown } | undefined)?.deny &&
        ee.requestId === PANE_ID
      ) {
        S.focusKey = typeof ee.plugin === 'string' && pluginName(ee.plugin) === pluginName($.plugin.name) && typeof ee.element === 'string' ? ee.element : ''
        invalidate($)
      }
      return r
    })
  } catch (x) {
    subFail('ui.focus', x)
  }

  try {
    on('ui.render', async ($, e, next) => {
      const g = S.gen
      const component = String((e as { component?: string }).component ?? '')
      if (component === 'AbovePrompt') {
        ensureStarted($, true)
        ensureRestore($)
        if (typeof e.props.maxRows === 'number' && e.props.maxRows > 0) {
          S.lastMaxRows = e.props.maxRows
          S.bandMeasured = true
        }
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
        const vars = buildVars(S.cfg.elements, view, S.cfg.nf, true)
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
        const vars = buildVars(S.cfg.elements, view, S.cfg.nf, true)
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
        // CONSTRAINT (#521 FIX5 Ч6): the open decides the draft; until then the
        // pane creates none and draws no control — the open redraws it after
        if (S.opening) {
          return table.Box({ flexDirection: 'column', children: [table.Text({ key: 'opening', children: ['открывается…'], wrap: 'truncate' })] }) as Awaited<ReturnType<typeof next>>
        }
        if (!S.draft) setDraft(freshDraft(), S.pickerSession)
        if (!S.draft) return next(e)
        // #521 Р9, FIX2 Р16: every surface draws the panel; the axes pick through
        // the surface's own Select and the text fields are Inputs where its table
        // has them — mobile has neither (d.ts Elements), whatever a completed table holds
        const mobile = surface === 'mobile'
        const selects = !mobile && typeof (table as { Select?: unknown }).Select === 'function'
        const inputs = !mobile && typeof (table as { Input?: unknown }).Input === 'function'
        const isFullscreen = (e as { viewport?: { isFullscreen?: unknown } }).viewport?.isFullscreen === true
        const { model, actions } = pickerModel($, e as { requestId?: string }, table as unknown as Table, { name: String(surface ?? ''), selects, inputs, isFullscreen })
        // the preview is the same render as the band (§14.6.5): the draft's
        // own view, layout and element settings feed the same builder. While
        // the keyboard focuses a theme card the preview overlays THAT theme's
        // axes (SPEC §14.6 п.4, ui.focus) — the draft itself never changes; a
        // name no longer drawn falls back to the draft, silently: unknown-name
        // diagnostics are the band's, not a focus artefact's
        const focusedTheme = S.draft.tab === 'themes' && S.focusKey.startsWith('theme:') ? S.focusKey.slice('theme:'.length) : ''
        const draftView = focusedTheme !== '' && ([...Object.keys(THEMES), ...Object.keys(S.userThemes)].includes(focusedTheme))
          ? resolveView({ ...S.draft.axes, theme: focusedTheme }, S.userThemes).view
          : resolveView(S.draft.axes, S.userThemes).view
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
  lastCloseT = 0
  seqLast = 0
  seqN = 0
  armOverride = null
  nowOverride = null
  origin = newOrigin()
  INFLIGHT.clear()
  inflightEpoch++
}

export function __sessQueue(): { farewell: string[]; queued: string[]; landed: [string, number][] } {
  return { farewell: [...FAREWELL.keys()], queued: [...SESS_Q.keys()], landed: [...LANDED].map(([k, l]) => [k, l.seq]) }
}

export function __setNow(fn: (() => number) | null): void {
  nowOverride = fn
}

export function __setOrigin(id: string): void {
  origin = id
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

// CONSTRAINT (#521 FIX5 Ч4): the theme save outside the press chain — two
// calls at once stand for two processes saving against one store; the answer
// is each call's own notice
export function __saveTheme($: EngineInterface, typed: string | null): Promise<string> {
  return saveUserTheme($, typed)
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

// CONSTRAINT (S4-FIX12, the Р12 law): the state-SET seam exists for teeth
// that must plant a state no input path can produce — since Н2 п.3 a cyclic
// `turn` cannot reach the live state through restore, and the Р12 guarantee
// (an un-copyable snapshot never holds session.end's next) still needs its
// carrier. Product code never calls it.
export function __setFamState(fam: Collector<unknown>, st: unknown): void {
  S.famStates.set(fam, st)
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
  const vars = buildVars(S.cfg.elements, view, S.cfg.nf, true)
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
  // CONSTRAINT (#521 FIX5 Ч6): the stand draws the picker outside any open —
  // its draft is set directly, without the session and epoch setDraft keeps
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
  const { model, actions } = pickerModel({ plugin: { name: 'catalyst-statusline', root: '/stand' }, ui: { log: async () => undefined }, store: store ?? { get: async () => undefined, set: async () => undefined, delete: async () => undefined }, session: { id: async () => 'stand' }, ...(engine ?? {}) } as unknown as EngineInterface, { requestId: PANE_ID }, STAND_TABLE, { name: 'terminal', selects: typeof table.Select === 'function', inputs: typeof table.Input === 'function', isFullscreen: false })
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

// the background-run guard as the timers and the snapshot flights use it
export function __quiet(label: string, fn: () => Promise<void>): Promise<void> {
  return quiet(label, fn)
}

export function __episodes(): string[] {
  return [...S.episodes]
}

export function __iconOf(id: string, elements: Record<string, ElemSettings>, glyphs: string): string {
  return iconOf(id, elements, glyphs)
}

export function __state(): { view: View; tpl: Tpl; themeName: string; rawOptions: Record<string, string>; elements: Record<string, ElemSettings>; maxRows: number; registryErrors: string[] } {
  return { view: S.cfg.view, tpl: S.cfg.tpl, themeName: S.cfg.themeName, rawOptions: S.cfg.rawOptions, elements: S.cfg.elements, maxRows: S.lastMaxRows, registryErrors: REG.duplicateIds.slice() }
}

export function __themes(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const [name, def] of Object.entries(THEMES)) out[name] = { ...def.axes }
  return out
}
