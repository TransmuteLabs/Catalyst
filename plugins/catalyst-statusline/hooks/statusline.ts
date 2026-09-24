import type { EngineInterface, On, PluginOptions } from 'claude-code'

// catalyst-statusline 0.4.0: the merged status mod (wave A, BRIEF-impl-v0.3-waveA).
// Structural base is the ClaudeCodeMods statusline mod (MIT, konsta95): the PromptHint
// and AbovePrompt hooks, hover cards, rebuilds on session.start / turn.step /
// turn.complete / model, compact, clear, read tickets against stale answers,
// invalidate only on change. On top: the data registry, the {ns.field} template
// with ;; lines and || segments, and per-line eviction of 0.2.0.
//
// CONSTRAINT (SPEC §13.3): the render path reads precomputed state only — no
// subprocess, no file read, no breakdown, no network. Everything expensive runs
// on events and timers. The variable dictionary is CLOSED: a name that would
// need an expensive source does not exist, so no template can open one.
// CONSTRAINT (#363, host resolver laws): `$` is only ever spelled `$.noun.method(...)`
// at a call site, and `$` travels only into functions declared at the top of
// this file; `on` is always on("<event>", hook).
// CONSTRAINT: single module file — the host's multi-module import shape is
// unmeasured; every probe ran single-file modules.

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

// ---------- palettes (DATA-ClaudeCodeStatusline §2; ClaudeCodeMods SL:34-61) ----------

type Pal = {
  path?: string
  branch?: string
  github?: string
  label?: string
  model?: string
  session?: string
  cost?: string
  sep?: string
  ok?: string
  mid?: string
  high?: string
  fresh?: string
  fast?: string
}

// Raw colours (a theme key is also accepted). Slot tables copied verbatim from
// the reference: codex/claude-code are the ClaudeCodeStatusline scheme tables.
const PALETTES: Record<string, Pal> = {
  semantic: { ok: 'green', mid: 'yellow', high: 'red' },
  mono: {},
  codex: {
    path: 'green',
    branch: 'magenta',
    github: 'magenta',
    label: 'magenta',
    model: '#d77757',
    session: 'white',
    cost: 'green',
    ok: 'green',
    mid: 'yellow',
    high: 'red',
    fresh: 'green',
    fast: 'dim',
  },
  'claude-code': {
    path: '#4782c8',
    branch: '#af87ff',
    github: '#b1b9f9',
    label: '#b1b9f9',
    model: '#d77757',
    session: '#999999',
    cost: '#4eba65',
    sep: '#505050',
    ok: '#4eba65',
    mid: '#ffc107',
    high: '#ff6b80',
    fresh: '#4eba65',
    fast: '#ff6a00',
  },
}

const COLOR_NAMES = new Set(['red', 'green', 'yellow', 'magenta', 'white', 'dim', 'blue', 'cyan', 'black', 'gray', 'grey'])

// ---------- view axes (SPEC §14.5.1, wave A subset only) ----------

const THEMES: Record<string, Record<string, string>> = {
  default: { shape: 'plain', caps: 'none', glyphs: 'none', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'claude-code', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: '|' },
  plain: { shape: 'plain', caps: 'none', glyphs: 'none', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'mono', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: ' │ ' },
  powerline: { shape: 'powerline', caps: 'arrow', glyphs: 'nerd', fill: 'segment', bar: 'blocks', barWidth: 'adaptive', palette: 'codex', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: '' },
  pill: { shape: 'pill', caps: 'round', glyphs: 'nerd', fill: 'segment', bar: 'blocks', barWidth: 'adaptive', palette: 'codex', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: '' },
  'claude-code': { shape: 'classic', caps: 'none', glyphs: 'none', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'claude-code', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: '|' },
  codex: { shape: 'classic', caps: 'none', glyphs: 'none', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'codex', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: '|' },
  mono: { shape: 'lean', caps: 'none', glyphs: 'none', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'mono', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: ' ' },
}

// The closed option sets of the wave A axes; the picker and the parse share them.
const AXIS_OPTIONS: Record<string, readonly string[]> = {
  shape: ['plain', 'lean', 'pill', 'powerline', 'classic'],
  caps: ['none', 'round', 'arrow', 'unicode-round'],
  glyphs: ['none', 'ascii', 'unicode', 'emoji', 'nerd'],
  fill: ['none', 'segment', 'band', 'inverse'],
  bar: ['blocks', 'parallelogram', 'ascii', 'shade', 'baseline', 'low-blocks', 'pie'],
  barWidth: ['adaptive'],
  palette: ['semantic', 'mono', 'codex', 'claude-code'],
  border: ['none', 'single', 'double', 'round'],
  overflow: ['evict', 'wrap'],
}
// Axes whose default is pinned by the spec, not taken from the theme (§14.5.1).
const PINNED_AXES: Record<string, string> = { placement: 'above', details: 'hover', numbers: 'raw', model_label: 'raw' }
const PINNED_OPTIONS: Record<string, readonly string[]> = {
  placement: ['above', 'hint'],
  details: ['off', 'hover'],
  numbers: ['raw', 'compact'],
  model_label: ['raw', 'display'],
}
// Axes that resolve through the theme and accept the value 'theme'.
const THEME_AXES = ['shape', 'caps', 'glyphs', 'fill', 'bar', 'barWidth', 'palette', 'thresholds', 'face', 'border', 'overflow', 'separator']
const ALL_AXES = ['placement', 'details', 'numbers', 'model_label', ...THEME_AXES]

const BAR_PAIRS: Record<string, [string, string]> = {
  blocks: ['█', '░'],
  parallelogram: ['▰', '▱'],
  ascii: ['#', '-'],
  shade: ['▓', '░'],
  baseline: ['█', '▁'],
  'low-blocks': ['▇', '▁'],
  pie: ['◔', '○'],
}

const CAP_PAIRS: Record<string, [string, string]> = {
  round: ['\u{E0B6}', '\u{E0B4}'],
  arrow: ['\u{E0B0}', '\u{E0B2}'],
  'unicode-round': ['◖', '◗'],
}

// ---------- segment registry (self-describing: the picker builds from it, §14.10) ----------

type RegEntry = {
  id: string
  label: string
  about: string
  // Threshold-scaled segments carry their colour by scale; the picker offers
  // them no colour of their own (SPEC §14.10, DATA JS:336,341).
  colorable: boolean
  slot?: keyof Pal
  // 'open' — the source is not yet measured, the stub stays visible (SPEC §12.3)
  state?: 'open'
  reason?: string
}

export const REGISTRY: readonly RegEntry[] = [
  { id: 'model', label: 'model', about: 'the model name with its effort level, the model that answered, and the fast flag', colorable: true, slot: 'model' },
  { id: 'route', label: 'route', about: 'the provider/route label — the source is not measured yet, the obligation stays visible', colorable: true, state: 'open', reason: 'route label source OPEN (spec В5)' },
  { id: 'ctx', label: 'context', about: 'context tokens used of the window, with the fill bar and the percentage', colorable: false },
  { id: 'brk', label: 'breakdown', about: 'token breakdown: input, cache write, cache read', colorable: true },
  { id: 'sum', label: 'Σ tokens', about: 'the sum of the turn tokens the session has used', colorable: true },
  { id: 'spd', label: 'speed', about: 'the output speed of the last main-loop response', colorable: true },
  { id: 'dur', label: 'duration', about: 'the time since the first observed activity', colorable: true },
  { id: 'cfg', label: 'config', about: 'instruction files, rules, MCP servers, commands and hooks counters', colorable: true },
  { id: 'style', label: 'style', about: 'the output style', colorable: true },
  { id: 'ver', label: 'version', about: 'the executing host version with the restart hint', colorable: false },
  { id: 'name', label: 'session name', about: 'the session name — the source is not measured yet, the obligation stays visible', colorable: true, state: 'open', reason: 'session name source OPEN (spec row 7)' },
  { id: 'rl', label: 'rate limits', about: 'the rate-limit windows the usage reports', colorable: false },
  { id: 'cost', label: 'cost', about: 'the session cost in dollars', colorable: true, slot: 'cost' },
  { id: 'git', label: 'git', about: 'the branch (tag, detached sha) from the nearest .git/HEAD, worktrees followed', colorable: true, slot: 'branch' },
  { id: 'git-branch', label: 'git branch', about: 'repo(branch), or the directory name outside a repository', colorable: true, slot: 'path' },
  { id: 'directory', label: 'directory', about: 'the name of the current directory', colorable: true, slot: 'path' },
  { id: 'branch', label: 'branch', about: 'the branch alone', colorable: true, slot: 'branch' },
  { id: 'github', label: 'github', about: 'owner/name from the GitHub remote', colorable: true, slot: 'github' },
  { id: 'five-hour-limit', label: '5h', about: 'the five-hour rate-limit window', colorable: false },
  { id: 'weekly-limit', label: '7d', about: 'the seven-day rate-limit window', colorable: false },
  { id: 'session', label: 'session', about: 'the session id, full or short8', colorable: true, slot: 'session' },
  { id: 'todo', label: 'todo', about: 'the todo progress of the session', colorable: true },
  { id: 'ag', label: 'agents', about: 'agent loops: running, completed, the last model', colorable: true },
  { id: 'tools', label: 'tools', about: 'tool calls: in flight, done, failed', colorable: true },
  { id: 'ram', label: 'ram', about: 'the machine memory used of the total', colorable: true },
  { id: 'path', label: 'path', about: 'the last two components of the working directory', colorable: true, slot: 'path' },
  { id: 'static', label: 'static line', about: 'the static line from the plugin config.json', colorable: true },
]

export const REGISTRY_IDS: readonly string[] = REGISTRY.map((r) => r.id)

// Eviction order, first dropped -> last kept (SPEC §7/§13.5). The segments of
// base A sit beside their kin; the last survivor is never evicted.
const EVICT_ORDER = ['static', 'ram', 'spd', 'dur', 'cfg', 'style', 'name', 'path', 'directory', 'branch', 'git', 'git-branch', 'github', 'rl', 'five-hour-limit', 'weekly-limit', 'session', 'sum', 'brk', 'cost', 'todo', 'ag', 'tools', 'ver', 'ctx', 'route', 'model']
const WIDTH_FALLBACK = 80

// State boundary (SPEC §4.2): declared caps, never grown.
const CAP = {
  toolNames: 64,
  activeTools: 256,
  doneQueue: 8,
  agents: 64,
  doneAgents: 8,
  diag: 64,
  seenTurns: 256,
}
const STALE = { git: 45000, ram: 15000, brk: 90000, cfg: 180000 }

const TODO_TOOLS = ['TodoWrite']

const now = (): number => (globalThis as any).performance?.now?.() ?? Date.now()
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const pluginName = (name: string) => name.split('@')[0]

// ---------- state ----------

type VarState = 'ok' | 'pending' | 'stale' | 'absent'
type Var = { v: string; st: VarState }
type Diag = { at: number; kind: string; key: string; text: string }

type Snap = {
  cwd: string
  repo: string | null
  branch: string | null
  branchKind: string
  github: string | null
  model: string
  effort: string | number | undefined
  context?: { tokens?: number; window: number; percent?: number }
  five?: { percentUsed: number; resetsAt?: string }
  seven?: { percentUsed: number; resetsAt?: string }
  cost?: number
  session: string
  errors: Record<string, string>
}

// The usage figures a model response moves; errors holds the reason for each
// segment when the read failed.
type UsageRead = Pick<Snap, 'context' | 'five' | 'seven' | 'cost' | 'errors'>
const USAGE_IDS = ['ctx', 'five-hour-limit', 'weekly-limit', 'cost']

type Extra = {
  home: string
  servedModel: string
  priorTurns: number
  resumed: boolean
  durBase: number
  sumTokens: number | null
  speed: number | null
  ver: { ok: boolean; text: string; installed: string; errCount: number }
  ram: { usedBytes: number; totalBytes: number; method: string; at: number; hadGood: boolean; errCount: number }
  brk: { at: number; input: number | null; cw: number | null; cr: number | null; unrecognized: boolean }
  cfg: { state: 'pending' | 'ok' | 'failed'; md: number; ru: number; mcp: number; cmd: number; hk: number; at: number; mdSig: string }
  style: { state: 'pending' | 'ok' | 'failed'; text: string }
  staticLine: string
  todo: { synced: boolean; done: number; total: number; current: string }
  tools: {
    sawAny: boolean
    sawTurnComplete: boolean
    doneTotal: number
    errTotal: number
    active: Map<string, string>
    byName: Map<string, number>
    done: { name: string; isError: boolean }[]
  }
  agents: {
    polled: boolean
    map: Map<string, { desc: string; model: string; status: string; at: number }>
    done: string[]
  }
  seenTurns: string[]
  ctxStale: boolean
}

type Seg = { id: string; body: string }
type Tpl = { lines: Seg[][]; sep: string; evict: string[] }

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
  separator: string
  numbers: string
  modelLabel: string
  placement: string
  details: string
  segColors: Record<string, string>
}

type Cfg = { tpl: Tpl; view: View; themeName: string; rawOptions: Record<string, string>; userThemes: Record<string, Record<string, string>> }

// The module's whole mutable state; register() re-initializes it (a reload wipes
// everything in memory, SPEC §14.7 — the durable parts live in $.store).
type State = {
  snap: Snap | null
  extra: Extra
  effort: string | number | undefined
  effortSeed: Promise<void> | null
  interactive: boolean
  started: boolean
  cfg: Cfg
  diag: Diag[]
  diagLogged: number
  diagOnce: Set<string>
  drawnKey: string | undefined
  refreshesBegun: number
  refreshShown: number
  surveyDiag: boolean
  pickerOpen: boolean | undefined
  pickerSession: string
  draft: { lines: Seg[][]; axes: Record<string, string>; focus: { line: number; seg: number } | null } | null
  draftQuery: string
  followed: { id: string; n: number } | undefined
  follows: number
  actions: Promise<unknown>
  saving: { fields: string[]; values: Record<string, string> } | null
  saveResult: string
  themeNote: string
  themeNameInput: string
  lastMaxRows: number
  userThemes: Record<string, Record<string, string>>
  restored: boolean
  reloadOptions: Record<string, string>
}

function freshExtra(): Extra {
  return {
    home: '',
    servedModel: '',
    priorTurns: -1,
    resumed: false,
    durBase: -1,
    sumTokens: null,
    speed: null,
    ver: { ok: false, text: '', installed: '', errCount: 0 },
    ram: { usedBytes: 0, totalBytes: 0, method: '', at: -1, hadGood: false, errCount: 0 },
    brk: { at: -1, input: null, cw: null, cr: null, unrecognized: false },
    cfg: { state: 'pending', md: -1, ru: -1, mcp: -1, cmd: -1, hk: -1, at: 0, mdSig: '' },
    style: { state: 'pending', text: '' },
    staticLine: '',
    todo: { synced: false, done: 0, total: 0, current: '' },
    tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, active: new Map(), byName: new Map(), done: [] },
    agents: { polled: false, map: new Map(), done: [] },
    seenTurns: [],
    ctxStale: false,
  }
}

const S: State = {
  snap: null,
  extra: freshExtra(),
  effort: undefined,
  effortSeed: null,
  interactive: false,
  started: false,
  cfg: { tpl: { lines: [], sep: ' │ ', evict: EVICT_ORDER.slice() }, view: {} as View, themeName: 'default', rawOptions: {}, userThemes: {} },
  diag: [],
  diagLogged: 0,
  diagOnce: new Set(),
  drawnKey: undefined,
  refreshesBegun: 0,
  refreshShown: 0,
  surveyDiag: false,
  pickerOpen: undefined,
  pickerSession: '',
  draft: null,
  draftQuery: '',
  followed: undefined,
  follows: 0,
  actions: Promise.resolve(),
  saving: null,
  saveResult: '',
  themeNote: '',
  themeNameInput: '',
  lastMaxRows: 8,
  userThemes: {},
  restored: false,
  reloadOptions: {},
}

function diag(kind: 'nosource' | 'open' | 'info' | 'fail', key: string, text: string): void {
  // one-time observability for НЕТ ИСТОЧНИКА / OPEN / fallback classes (SPEC §12.4);
  // failures repeat, the rest fire once
  if (kind !== 'fail') {
    if (S.diagOnce.has(key)) return
    S.diagOnce.add(key)
  }
  S.diag.push({ at: now(), kind, key, text })
  if (S.diag.length > CAP.diag) S.diag.shift()
}

// The debug line leaves on the next hook frame that carries a live $ (the pure
// diag path has none); CONSTRAINT (#363 L1/L2): $ arrives only as a plain-name
// parameter of this top-level function and is spelled only $.noun.method(...).
function flushDiag($: EngineInterface): void {
  while (S.diagLogged < S.diag.length) {
    const d = S.diag[S.diagLogged]!
    S.diagLogged++
    try {
      $.ui.log('[statusline] ' + d.kind + ': ' + d.text, { to: 'debug' })
    } catch {
      /* logging is best effort */
      return
    }
  }
}

async function quiet(fn: () => Promise<void>): Promise<void> {
  // SPEC §10.4: a failure leaves the previous value standing; it never drops the band
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

// ---------- pure helpers ----------

// The classic payload carries model.display_name; the mods API gives only the id.
// The name is derived from the id: claude-fable-5-1 -> Fable 5.1,
// claude-haiku-4-5-20251001 -> Haiku 4.5. A context tag is not part of the
// name: claude-opus-5-5[1m] reads Opus 5.5 (owner, 2026-09-22). A value that is
// not a claude-* id is shown as it came.
export function displayName(id: string): string {
  const m = /^claude-([a-z]+)((?:-\d{1,3})*)(?:-\d{8})?(?:\[[0-9a-z]+\])?$/.exec(id)
  if (!m) return id
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1)
  const version = m[2]!.split('-').filter(Boolean).join('.')
  return version ? family + ' ' + version : family
}

export function shortModel(name: string): string {
  // live config C:12,30 selects the short badge; the transform drops the vendor prefix
  return name.startsWith('claude-') ? name.slice('claude-'.length) : name
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return Math.round(n / 1_000) + 'K'
  return String(n)
}

// SPEC §14.5.4: compact never writes a nonzero value as zero, and every cut
// carries its mark; the raw recording equals the source's own figure.
function compactNum(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (abs >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

function compactCost(usd: number): string {
  const fixed = (Math.round(usd * 100) / 100).toFixed(2)
  // $0.004 compacted to $0.00 would be a lie (§14.5.4): keep the source's own figure
  if (Number(fixed) === 0 && usd !== 0) return '$' + String(usd)
  return '$' + fixed
}

function baseName(dir: string): string {
  const m = /([^/]+)\/?$/.exec(dir)
  return m ? m[1]! : dir
}

function dirName(dir: string): string {
  const parent = dir.replace(/\/[^/]*\/?$/, '')
  return parent === '' ? '/' : parent
}

function resolvePath(base: string, rel: string): string {
  if (rel.startsWith('/')) return rel
  const out: string[] = []
  for (const part of (base + '/' + rel).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

function githubOf(remote: string | null | undefined): string | null {
  if (!remote) return null
  // the same pattern the reference used (JS:199-230): owner/name off the GitHub remote
  const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remote)
  return m ? m[1]! : null
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return h + 'h' + String(m).padStart(2, '0') + 'm'
  if (m > 0) return m + 'm'
  return s + 's'
}

function staleMark(at: number, limit: number): string {
  return at >= 0 && now() - at > limit ? '~' : ''
}

function isStale(at: number, limit: number): boolean {
  return staleMark(at, limit) === '~'
}

function ok(v: string): Var {
  return { v, st: 'ok' }
}
function pend(): Var {
  return { v: '…', st: 'pending' }
}
function gone(): Var {
  return { v: '', st: 'absent' }
}
function aged(v: string, stale: boolean): Var {
  return { v, st: stale ? 'stale' : 'ok' }
}

// ---------- template (SPEC §13.2, §14.3) ----------

function splitRuns(s: string, first: string, second: string): string[] {
  // CONSTRAINT: the cut runs BEFORE unescaping and never cuts an escaped pair,
  // so a literal pipe in a segment body cannot split the segment
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

function parseSegment(chunk: string, used: Set<string>, n: number): Seg {
  const m = /^([a-z0-9_-]+)=([\s\S]*)$/.exec(chunk)
  let id = m ? m[1]! : 's' + n
  let body = m ? m[2]! : chunk
  if (!m && REGISTRY_IDS.includes(chunk)) {
    // serializeTemplate writes the body '{id.text}' as the bare id; parse is its
    // inverse, else a preset round-trips into synthetic ids (SPEC §14.8 tooth 20).
    // An unknown bare word stays a literal body — plain-text segments keep their text.
    id = chunk
    body = '{' + chunk + '.text}'
  }
  if (used.has(id)) {
    // a duplicate id would evict together with its twin, which nobody asked for
    const uniq = id + '#' + n
    diag('info', 'tpl-dup-id-' + id, "template: duplicate segment id '" + id + "' renamed to '" + uniq + "'")
    id = uniq
  }
  used.add(id)
  return { id, body }
}

// Lines split by ' ;; ', segments by '||'. A template with no ' ;; ' is exactly
// one line, so 0.2.0 settings read without migration (SPEC §14.3).
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
      // an empty layout line is a hole, not a choice: dropped aloud (SPEC §14.3, tooth 20)
      diag('fail', 'tpl-empty-line', 'template: an empty layout line was dropped')
      continue
    }
    lines.push(segs)
  }
  return lines
}

function splitLines(raw: string): string[] {
  // ' ;; ' with the escape rule; the scanner token is the four-character run
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

// Serialization writes bodies RAW: a body holding '||' or ' ;; ' round-trips to
// a different layout, which the picker's save gate refuses aloud (SPEC §14.8
// tooth 20) — the picker never stores such a literal silently.
export function serializeTemplate(lines: Seg[][]): string {
  return lines
    .map((line) =>
      line
        .map((seg) => (seg.body === '{' + seg.id + '.text}' ? seg.id : seg.id + '=' + seg.body))
        .join(SEG_SPLIT),
    )
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
  // removes it whole; '…' and '~' never remove it. No filters exist in the
  // syntax: `{cost.usd|round:2}` is an unknown NAME in full, shown aloud.
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
        // SPEC §13.6 tooth 6: a typo is visible in the bar and in the diagnostics
        diag('info', 'tpl-unknown-' + name, "template: unknown variable '" + name + "'")
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

// Per-line eviction (SPEC §14.3): each line narrows the common order to its own
// segments; the last survivor stays — overflow beats truncation.
function renderLine(line: Seg[], vars: Record<string, Var>, width: number, sep: string, evict: string[], overflow: string): { id: string; text: string; stale: boolean }[] {
  const parts: { id: string; text: string; stale: boolean }[] = []
  for (const seg of line) {
    const r = renderSeg(seg.body, vars)
    if (r) parts.push({ id: seg.id, text: r.text, stale: r.stale })
  }
  if (overflow === 'wrap') return parts
  const kept = new Set(parts.map((p) => p.id))
  const dropped: string[] = []
  const assemble = (): string => parts.filter((p) => kept.has(p.id)).map((p) => p.text).join(sep)
  const order = evictionOrder(evict, parts.map((p) => p.id))
  const lastSurvivor = order.length > 0 ? order[order.length - 1]! : ''
  for (const id of order) {
    if (assemble().length <= width) break
    if (id === lastSurvivor) break
    if (kept.has(id)) {
      dropped.push(id)
      kept.delete(id)
    }
  }
  return parts.filter((p) => kept.has(p.id))
}

// ---------- view resolution ----------

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

function parseSegColors(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  // a bad entry is dropped ONE BY ONE and aloud, the rest apply (SPEC §14.10)
  for (const part of raw.split(';')) {
    if (part.trim() === '') continue
    const m = /^\s*([a-z0-9_-]+)\s*=\s*(#[0-9a-fA-F]{6}|[a-z]+)\s*$/.exec(part)
    if (!m || !REGISTRY_IDS.includes(m[1]!) || !(m[2]!.startsWith('#') || COLOR_NAMES.has(m[2]!))) {
      diag('fail', 'segcolors-bad-' + part.trim().slice(0, 24), "segmentColors: entry '" + part.trim() + "' dropped")
      continue
    }
    out[m[1]!] = m[2]!
  }
  return out
}

function parseBarPair(raw: string, glyphs: string): [string, string] | null {
  if (raw === 'theme' || raw === '') return null
  if (BAR_PAIRS[raw]) {
    const pair = BAR_PAIRS[raw]!
    return glyphs === 'ascii' ? (isAsciiPair(pair) ? pair : BAR_PAIRS['ascii']!) : pair
  }
  // a pair-literal of exactly two glyphs survives; ASCII keeps it only if it is ASCII
  const chars = [...raw]
  if (chars.length === 2) return chars as [string, string]
  diag('fail', 'bar-pair', "bar: '" + raw + "' is not a named pair or a two-glyph literal; the theme's pair applies")
  return null
}

function isAsciiPair(pair: [string, string]): boolean {
  return pair.every((c) => c.length === 1 && c.charCodeAt(0) < 128)
}

function resolveView(raw: Record<string, string>, userThemes: Record<string, Record<string, string>>): { view: View; themeName: string } {
  const themeName = raw['theme'] && (THEMES[raw['theme']] || userThemes[raw['theme']]) ? raw['theme'] : 'default'
  if (raw['theme'] && raw['theme'] !== 'default' && !THEMES[raw['theme']] && !userThemes[raw['theme']]) {
    // SPEC §14.5.2: an unknown theme name is a diagnosis and the last good config,
    // never a silent default
    diag('fail', 'theme-unknown', "theme: unknown name '" + raw['theme'] + "'; the default theme applies")
  }
  const theme = { ...(THEMES[themeName] ?? userThemes[themeName] ?? THEMES['default']!) }
  const pick = (axis: string, fallback: string): string => {
    const v = raw[axis]
    if (v === undefined || v === '') return fallback
    if (v === 'theme') return theme[axis] ?? fallback
    const opts = AXIS_OPTIONS[axis]
    if (opts && !opts.includes(v)) {
      diag('fail', 'axis-value-' + axis, "axis " + axis + ": unknown value '" + v + "'; the theme's value applies")
      return theme[axis] ?? fallback
    }
    return v
  }
  const glyphs = pick('glyphs', 'none')
  const barRaw = pick('bar', 'blocks')
  const barPair = parseBarPair(barRaw, glyphs) ?? parseBarPair(theme['bar'] ?? 'blocks', glyphs) ?? BAR_PAIRS['blocks']!
  const barWidthRaw = raw['barWidth'] && raw['barWidth'] !== '' && raw['barWidth'] !== 'theme' ? raw['barWidth'] : theme['barWidth'] ?? 'adaptive'
  const widthNum = /^\d+$/.test(barWidthRaw) ? Number(barWidthRaw) : NaN
  const paletteName = pick('palette', 'claude-code')
  const separator = raw['separator'] !== undefined && raw['separator'] !== '' ? raw['separator'] : theme['separator'] ?? ' │ '
  // Degradation is part of the options contract, not an implementation choice
  // (§14.5.1): PUA caps need Nerd, ASCII keeps no caps at all.
  let caps = pick('caps', 'none')
  if (glyphs === 'ascii') caps = 'none'
  else if (caps === 'round' || caps === 'arrow') {
    if (glyphs !== 'nerd') caps = 'none'
  }
  const shape = pick('shape', 'plain')
  const view: View = {
    shape,
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
    separator: glyphs === 'ascii' ? asciiOnly(separator) : separator,
    numbers: raw['numbers'] === 'compact' ? 'compact' : 'raw',
    modelLabel: raw['model_label'] === 'display' ? 'display' : 'raw',
    placement: raw['placement'] === 'hint' ? 'hint' : 'above',
    details: raw['details'] === 'off' ? 'off' : 'hover',
    segColors: parseSegColors(raw['segmentColors'] ?? ''),
  }
  return { view, themeName }
}

function asciiOnly(s: string): string {
  // the ASCII rule touches decorations, never the data values (§14.5.1)
  let out = ''
  for (const ch of s) out += ch.length === 1 && ch.charCodeAt(0) < 128 ? ch : '?'
  return out.replace(/\?+/g, (run) => (run.length > 1 ? '-' : '|'))
}

// ---------- variable elements (render reads state only, SPEC §13.3) ----------

function elModel(s: Snap, x: Extra, view: View): { text: string; vars: Record<string, Var> } {
  const raw = s.model || '?'
  const display = displayName(raw)
  const short = shortModel(raw)
  const label = view.modelLabel === 'display' ? display : raw
  const served = x.servedModel && shortModel(x.servedModel) !== short ? shortModel(x.servedModel) : ''
  const effort = s.effort
  const hasEffort = (typeof effort === 'string' && effort) || (typeof effort === 'number' && Number.isFinite(effort))
  const effortText = hasEffort ? String(effort) : ''
  const text = label + (effortText ? ' ' + effortText : '') + (served ? '→' + served : '')
  return {
    text,
    vars: {
      'model.raw': ok(raw),
      'model.display': ok(display),
      'model.short': ok(short),
      'model.label': ok(label),
      'model.served': served ? ok(served) : gone(),
      'model.effort': hasEffort ? ok(effortText) : pend(),
      // fast mode has no typed source in the measured API (DATA §6): a named
      // no-source, never a guess and never silently gone
      'model.fast': { v: '', st: 'absent' },
    },
  }
}

function elCtx(u: UsageRead, x: Extra, view: View): { text: string; vars: Record<string, Var> } {
  const c = u && typeof u === 'object' ? u.context : null
  if (!c || typeof c !== 'object' || !Number.isFinite(c.window) || c.window <= 0) {
    return {
      text: 'ctx …',
      vars: { 'ctx.tokens': pend(), 'ctx.window': pend(), 'ctx.percent': pend(), 'ctx.bar': pend(), 'ctx.mark': ok(''), 'ctx.stale': ok('') },
    }
  }
  const hasTokens = Number.isFinite(c.tokens as number)
  const used = hasTokens ? (c.tokens as number) : 0
  let pct = c.percent
  const knowPct = Number.isFinite(pct as number) || hasTokens
  if (!Number.isFinite(pct as number)) pct = hasTokens ? (used / c.window) * 100 : undefined
  const p = knowPct ? Math.max(0, Math.min(100, Math.round(pct as number))) : 0
  const num = (n: number): string => (view.numbers === 'compact' ? fmtTokens(n) : String(n))
  const staleStar = x.ctxStale && hasTokens ? '*' : ''
  // §12.3: an unknown figure is a stub of the same width, never a zero — the
  // fresh window with no count yet reads '…', the old figure after an
  // interrupted turn keeps its '*' (§14.12 answer 7)
  const fill = knowPct ? barFill(p, view) : 0
  const mark = knowPct ? ((pct as number) >= view.thresholds[1] ? '!!' : (pct as number) >= view.thresholds[0] ? '!' : '') : ''
  const bar = '[' + view.barPair[0].repeat(fill) + view.barPair[1].repeat(barCells(view) - fill) + ']'
  const text = 'ctx ' + (hasTokens ? num(used) : '…') + '/' + num(c.window) + ' ' + bar + ' ' + (knowPct ? String(pct as number) : '…') + '%' + mark + staleStar
  return {
    text,
    vars: {
      'ctx.tokens': hasTokens ? aged(num(used), x.ctxStale) : pend(),
      'ctx.window': ok(num(c.window)),
      'ctx.percent': knowPct ? aged(String(pct as number), x.ctxStale) : pend(),
      'ctx.bar': { v: bar, st: knowPct && x.ctxStale ? 'stale' : 'ok' },
      'ctx.mark': ok(mark),
      // УСТАРЕЛО (§14.12 answer 7): the old figure with a star that survives
      // without colour; the next answer with a count removes it
      'ctx.stale': ok(staleStar),
    },
  }
}

function barCells(view: View): number {
  if (view.barWidthMode === 'cells') return view.barWidthCells
  return view.separator.length > 2 ? 4 : 10
}

function barFill(percent: number, view: View): number {
  return Math.max(0, Math.min(barCells(view), Math.round((percent / 100) * barCells(view))))
}

function limitEl(id: string, label: string, win: { percentUsed: number; resetsAt?: string } | undefined): { text: string; vars: Record<string, Var> } | null {
  if (!win || !Number.isFinite(win.percentUsed)) return null
  const p = win.percentUsed
  const text = label + ' ' + String(p) + '%'
  return { text, vars: { [id + '.percent']: ok(String(p)), [id + '.resets']: win.resetsAt ? ok(win.resetsAt) : gone() } }
}

function elVer(x: Extra): { text: string; vars: Record<string, Var> } {
  if (!x.ver.ok || !x.ver.text) return { text: 'v…', vars: { 'ver.num': pend(), 'ver.restart': pend() } }
  // {ver.restart} (SPEC §14.10): three cases — equal, differ, installed not read
  let restart: Var = gone()
  if (x.ver.installed === '') restart = pend()
  else if (x.ver.installed !== x.ver.text) restart = ok(x.ver.text + '→' + x.ver.installed + ' restart')
  return { text: 'v' + x.ver.text, vars: { 'ver.num': ok(x.ver.text), 'ver.restart': restart } }
}

function elRl(u: UsageRead): { text: string; vars: Record<string, Var> } | null {
  const rls = u && typeof u === 'object' ? (u as { rateLimits?: unknown }).rateLimits : undefined
  if (!Array.isArray(rls)) return null
  const parts: string[] = []
  for (const r of rls) {
    if (!r || typeof r !== 'object') continue
    const rec = r as { kind?: unknown; percentUsed?: unknown }
    parts.push(String(rec.kind) + ' ' + String(rec.percentUsed) + '%')
  }
  if (parts.length === 0) return null
  const list = parts.join(',')
  return { text: 'rl ' + list, vars: { 'rl.list': ok(list) } }
}

function elCost(u: UsageRead, view: View): { text: string; vars: Record<string, Var> } {
  // readUsage flattens the ledger to its number; absent only where the host
  // keeps no ledger at all
  const usd = u && typeof u === 'object' && typeof u.cost === 'number' ? u.cost : undefined
  if (usd === undefined) return { text: '$…', vars: { 'cost.usd': pend() } }
  // the source's own figure, verbatim; zero is a value, not an absence (§13.3)
  const text = view.numbers === 'compact' ? compactCost(usd) : '$' + String(usd)
  return { text, vars: { 'cost.usd': ok(String(usd)) } }
}

function elSession(s: Snap): { text: string; vars: Record<string, Var> } {
  if (!s.session) return { text: 'sid …', vars: { 'session.full': pend(), 'session.short8': pend() } }
  const short8 = s.session.slice(0, 8)
  return { text: s.session, vars: { 'session.full': ok(s.session), 'session.short8': ok(short8) } }
}

// Builds every element's variables from state — the render path's only input
// beside the template and the view (SPEC §13.3: the dictionary is closed).
export function buildVars(s: Snap | null, x: Extra, view: View): Record<string, Var> {
  const vars: Record<string, Var> = {}
  const snap: Snap = s ?? {
    cwd: '',
    repo: null,
    branch: null,
    branchKind: '',
    github: null,
    model: '',
    effort: undefined,
    session: '',
    errors: {},
  }
  const put = (id: string, built: { text: string; vars: Record<string, Var> } | null): void => {
    if (built) {
      vars[id + '.text'] = ok(built.text)
      for (const k of Object.keys(built.vars)) vars[k] = built.vars[k]!
    } else {
      vars[id + '.text'] = gone()
    }
  }
  const failed = (id: string): boolean => snap.errors[id] !== undefined

  // model
  if (failed('model')) vars['model.text'] = pend()
  else put('model', elModel(snap, x, view))
  vars['model.fast.reason'] = gone()
  // route — OPEN, the stub stays visible
  diag('open', 'route-open', 'route label source OPEN (spec В5): stub shown')
  put('route', { text: 'via …', vars: { 'route.label': pend() } })
  // ctx / limits / cost
  const usageRead: UsageRead = { context: snap.context, five: snap.five, seven: snap.seven, cost: snap.cost, errors: snap.errors }
  put('ctx', failed('ctx') ? null : elCtx(usageRead, x, view))
  const brk = x.brk
  if (brk.input === null && brk.cw === null && brk.cr === null) {
    put('brk', { text: 'bd …', vars: { 'brk.input': pend(), 'brk.cw': pend(), 'brk.cr': pend() } })
  } else {
    const st = isStale(brk.at, STALE.brk)
    const num = (v: number | null): Var => (v === null ? pend() : aged(String(v), st))
    put('brk', { text: 'bd in=' + (brk.input ?? '…') + ' cw=' + (brk.cw ?? '…') + ' cr=' + (brk.cr ?? '…'), vars: { 'brk.input': num(brk.input), 'brk.cw': num(brk.cw), 'brk.cr': num(brk.cr) } })
  }
  if (x.sumTokens === null) put('sum', { text: 'Σ …', vars: { 'sum.tokens': pend(), 'sum.partial': ok('') } })
  else {
    const partial = x.resumed ? '*' : ''
    put('sum', { text: 'Σ ' + (view.numbers === 'compact' ? compactNum(x.sumTokens) : String(x.sumTokens)) + partial, vars: { 'sum.tokens': ok(String(x.sumTokens)), 'sum.partial': ok(partial) } })
  }
  if (x.speed === null) put('spd', { text: '… tok/s', vars: { 'spd.tps': pend() } })
  else put('spd', { text: String(x.speed) + ' tok/s', vars: { 'spd.tps': ok(String(x.speed)) } })
  if (x.durBase < 0) put('dur', { text: 'up …', vars: { 'dur.up': pend(), 'dur.partial': ok('') } })
  else {
    const partial = x.resumed ? '?' : ''
    const up = fmtDur(now() - x.durBase)
    put('dur', { text: 'up ' + up + partial, vars: { 'dur.up': ok(up), 'dur.partial': ok(partial) } })
  }
  const c = x.cfg
  if (c.state !== 'ok') {
    put('cfg', { text: 'cfg ?', vars: { 'cfg.md': pend(), 'cfg.ru': pend(), 'cfg.mcp': pend(), 'cfg.cmd': pend(), 'cfg.hk': pend() } })
  } else {
    const st = isStale(c.at, STALE.cfg)
    const agedNum = (v: number): Var => aged(String(v), st)
    put('cfg', { text: 'cfg md' + c.md + ' ru' + c.ru + ' mcp' + c.mcp + ' cmd' + c.cmd + ' hk' + c.hk, vars: { 'cfg.md': agedNum(c.md), 'cfg.ru': agedNum(c.ru), 'cfg.mcp': agedNum(c.mcp), 'cfg.cmd': agedNum(c.cmd), 'cfg.hk': agedNum(c.hk) } })
  }
  if (x.style.state !== 'ok' || !x.style.text) put('style', { text: 'style …', vars: { 'style.name': pend() } })
  else put('style', { text: 'style ' + x.style.text, vars: { 'style.name': ok(x.style.text) } })
  put('ver', elVer(x))
  diag('open', 'name-open', 'session name source OPEN (spec row 7): stub shown')
  put('name', { text: 'nm …', vars: { 'name.label': pend() } })
  put('rl', failed('rl') ? null : elRl(usageRead))
  put('cost', failed('cost') ? null : elCost(usageRead, view))
  // git family — the fs walk of the reference (worktrees followed, 12 levels);
  // the walk is event-driven, its figure is as fresh as the last refresh
  const inRepo = snap.branch !== null
  if (inRepo) {
    const refVar = ok(snap.branch!)
    put('git', { text: '(' + snap.branch! + ')', vars: { 'git.repo': snap.repo ? ok(snap.repo) : gone(), 'git.ref': refVar, 'git.kind': ok(snap.branchKind || 'branch') } })
    put('branch', { text: snap.branch!, vars: { 'branch.text': refVar } })
    put('git-branch', {
      text: (snap.repo || '') + '(' + snap.branch! + ')',
      vars: { 'git-branch.repo': snap.repo ? ok(snap.repo) : gone(), 'git-branch.ref': refVar },
    })
  } else {
    for (const id of ['git', 'branch', 'git-branch']) vars[id + '.text'] = gone()
    if (snap.cwd) put('git-branch', { text: baseName(snap.cwd), vars: { 'git-branch.repo': gone(), 'git-branch.ref': gone() } })
    else vars['git-branch.text'] = gone()
  }
  vars['directory.text'] = snap.cwd ? ok(baseName(snap.cwd)) : pend()
  if (failed('github') || !snap.github) vars['github.text'] = gone()
  else put('github', { text: snap.github, vars: { 'github.slug': ok(snap.github) } })
  if (snap.five) put('five-hour-limit', limitEl('five-hour-limit', '5h', snap.five))
  else vars['five-hour-limit.text'] = gone()
  if (snap.seven) put('weekly-limit', limitEl('weekly-limit', '7d', snap.seven))
  else vars['weekly-limit.text'] = gone()
  put('session', failed('session') ? null : elSession(snap))
  const t = x.todo
  if (!t.synced) put('todo', { text: 'todo …', vars: { 'todo.done': pend(), 'todo.total': pend(), 'todo.current': pend() } })
  else
    put('todo', {
      text: 'todo ' + t.done + '/' + t.total + (t.current ? ' ' + t.current : ''),
      vars: { 'todo.done': ok(String(t.done)), 'todo.total': ok(String(t.total)), 'todo.current': t.current ? ok(t.current) : gone() },
    })
  let running = 0
  let lastModel = ''
  for (const a of x.agents.map.values()) {
    if (a.status === 'running') running++
    if (a.model) lastModel = a.model
  }
  if (x.agents.map.size === 0 && !x.agents.polled) {
    put('ag', { text: 'ag …', vars: { 'ag.running': pend(), 'ag.done': pend(), 'ag.model': pend() } })
  } else {
    const done = x.agents.done.length
    const model = lastModel ? shortModel(lastModel) : ''
    let text = 'ag ' + running + 'r'
    if (done > 0) text += ' ' + done + '✓'
    if (model) text += ' m=' + model
    put('ag', { text, vars: { 'ag.running': ok(String(running)), 'ag.done': done > 0 ? ok(String(done)) : gone(), 'ag.model': model ? ok(model) : gone() } })
  }
  const tl = x.tools
  const perName = new Map<string, number>()
  for (const name of tl.active.values()) perName.set(name, (perName.get(name) ?? 0) + 1)
  const names = [...perName.keys()]
  const err = tl.errTotal > 0 ? ok(String(tl.errTotal)) : gone()
  if (names.length > 0) {
    const shown = names.slice(0, 3).map((n) => n + '×' + String(perName.get(n)))
    let active = shown.join(' ')
    if (names.length > 3) active += ' +' + String(names.length - 3)
    let text = 'tools ' + active
    if (tl.errTotal > 0) text += ' e' + String(tl.errTotal)
    put('tools', { text, vars: { 'tools.active': ok(active), 'tools.doneTotal': gone(), 'tools.err': err } })
  } else if (tl.sawAny || tl.sawTurnComplete) {
    let text = 'tools ✓' + String(tl.doneTotal)
    if (tl.errTotal > 0) text += ' e' + String(tl.errTotal)
    put('tools', { text, vars: { 'tools.active': gone(), 'tools.doneTotal': ok(String(tl.doneTotal)), 'tools.err': err } })
  } else {
    put('tools', { text: 'tools …', vars: { 'tools.active': pend(), 'tools.doneTotal': pend(), 'tools.err': gone() } })
  }
  const r = x.ram
  if (!r.hadGood || !r.totalBytes) {
    put('ram', { text: 'ram …', vars: { 'ram.used': pend(), 'ram.total': pend() } })
  } else {
    const used = String(Math.round(r.usedBytes / 1048576))
    const total = String(Math.round(r.totalBytes / 1048576))
    const st = isStale(r.at, STALE.ram)
    put('ram', { text: 'ram ' + used + '/' + total + 'M', vars: { 'ram.used': aged(used, st), 'ram.total': aged(total, st) } })
  }
  if (!snap.cwd) put('path', { text: '…', vars: { 'path.short': pend() } })
  else {
    const segs = snap.cwd.split('/').filter(Boolean)
    const last = segs.slice(-2).join('/') || snap.cwd
    put('path', { text: last, vars: { 'path.short': ok(last) } })
  }
  if (!x.staticLine) vars['static.text'] = gone()
  else vars['static.text'] = ok(x.staticLine)
  // the default bodies reference <id>.text for every registry id; missing ones absent
  for (const id of REGISTRY_IDS) if (!(id + '.text' in vars)) vars[id + '.text'] = gone()
  return vars
}

function detailOf(id: string, vars: Record<string, Var>): string {
  // the card carries the full record of the value the segment shows shorter
  const parts: string[] = [id]
  for (const name of Object.keys(vars)) {
    if (!name.startsWith(id + '.')) continue
    const v = vars[name]!
    parts.push(name.slice(id.length + 1) + '=' + (v.st === 'absent' ? '(no source)' : v.st === 'pending' ? '(no data yet)' : v.v))
  }
  return parts.join(' ')
}

// ---------- gather (base A: session nouns on events, never in the render frame) ----------

// Effort is not on $.session; it rides turn.step. Until then the /config rows
// are the only place a level could be read; gathers share one read per session.
function seedEffort($: EngineInterface): Promise<void> {
  if (S.effort !== undefined) return Promise.resolve()
  if (!S.effortSeed) {
    S.effortSeed = readEffortRow($).catch((err) => {
      S.effortSeed = null
      throw err
    })
  }
  return S.effortSeed
}

async function readEffortRow($: EngineInterface): Promise<void> {
  const rows = await $.config.list()
  const row = rows.find((r) => /effort/i.test(r.key) && (typeof r.value === 'string' || typeof r.value === 'number'))
  if (row && S.effort === undefined) S.effort = row.value as string | number
}

// The reference's gitInfo: walk up at most 12 levels, read .git/HEAD, follow a
// worktree's .git file (gitdir: ...) to the real HEAD. $.fs.read rejects on a
// missing path, which is the walk's "keep going" signal.
async function gitInfo($: EngineInterface, startDir: string): Promise<{ repo: string; branch: string; kind: string } | null> {
  let dir = startDir
  for (let i = 0; i < 12 && dir; i++) {
    const gitPath = dir + '/.git'
    let head: string | null = null
    try {
      head = await $.fs.read(gitPath + '/HEAD')
    } catch {
      head = null
    }
    if (head === null) {
      try {
        const file = await $.fs.read(gitPath)
        const m = /gitdir:\s*(.+)/.exec(file)
        if (m) head = await $.fs.read(resolvePath(dir, m[1]!.trim()) + '/HEAD')
      } catch {
        head = null
      }
    }
    if (head !== null) {
      const t = head.trim()
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(t)
      return { repo: baseName(dir), branch: ref ? ref[1]! : t.slice(0, 7), kind: ref ? 'branch' : 'detached' }
    }
    const parent = dirName(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

async function readUsage($: EngineInterface): Promise<UsageRead> {
  const read: UsageRead = { context: undefined, five: undefined, seven: undefined, cost: undefined, errors: {} }
  try {
    const usage = await $.session.usage()
    read.context = usage.context
    const rls = (usage as { rateLimits?: Array<{ kind?: string }> }).rateLimits || []
    for (const win of rls) {
      if (win.kind === 'five_hour') read.five = win as Snap['five']
      if (win.kind === 'seven_day') read.seven = win as Snap['seven']
    }
    const cost = (usage as { cost?: { usd?: number } }).cost
    diag('info', 'cost-dbg', 'raw usage keys=' + Object.keys(usage || {}).join(',') + ' cost=' + JSON.stringify(cost))
    read.cost = cost && typeof cost.usd === 'number' ? cost.usd : undefined
  } catch (err) {
    for (const id of USAGE_IDS) read.errors[id] = String(err)
  }
  return read
}

// §10.4: a failed source leaves the last good snapshot standing — a transient
// read failure never drops the band's figures; with nothing previous to stand
// on the error keeps its course and the segment reads ЕЩЁ НЕТ/absent.
function carryLastGood(read: UsageRead): UsageRead {
  const carry: Record<string, keyof UsageRead> = { ctx: 'context', 'five-hour-limit': 'five', 'weekly-limit': 'seven', cost: 'cost' }
  for (const id of Object.keys(read.errors)) {
    const field = carry[id]
    if (field && (read as Record<string, unknown>)[field] === undefined && S.snap && S.snap[field] !== undefined) {
      ;(read as Record<string, unknown>)[field] = S.snap[field]
      delete read.errors[id]
    }
  }
  return read
}

async function gatherNouns($: EngineInterface): Promise<Snap> {
  const errors: Record<string, string> = {}
  try {
    await seedEffort($)
  } catch (err) {
    diag('fail', 'effort-seed', 'effort config read failed: ' + errorText(err))
  }
  const s: Snap = { cwd: '', repo: null, branch: null, branchKind: '', github: null, model: '?', effort: S.effort, session: '', errors }
  try {
    s.cwd = await $.session.cwd()
  } catch (err) {
    for (const id of ['git-branch', 'directory', 'path']) errors[id] = String(err)
  }
  if (s.cwd) {
    try {
      const git = await gitInfo($, s.cwd)
      if (git) {
        s.repo = git.repo
        s.branch = git.branch
        s.branchKind = git.kind
      }
    } catch (err) {
      for (const id of ['git', 'branch', 'git-branch']) errors[id] = String(err)
    }
  }
  try {
    const repo = await $.session.repo()
    s.github = githubOf(repo ? (repo as { remote?: string }).remote : null)
  } catch (err) {
    errors['github'] = String(err)
  }
  try {
    s.model = (await $.session.model()) || '?'
  } catch (err) {
    errors['model'] = String(err)
  }
  const read = carryLastGood(await readUsage($))
  const { errors: usageErrors, ...figures } = read
  Object.assign(s, figures)
  Object.assign(errors, usageErrors)
  try {
    s.session = await $.session.id()
  } catch (err) {
    errors['session'] = String(err)
  }
  return s
}

// ---------- background collectors (0.2.0: timers/events only, never render) ----------

async function collectRam($: EngineInterface): Promise<void> {
  const x = S.extra
  try {
    try {
      const vm = await $.process.run(['/usr/bin/vm_stat'])
      const txt = String((vm as { stdout?: string }).stdout || '')
      const ps = /page size of (\d+) bytes/.exec(txt)
      const pagesActive = /Pages active:\s+(\d+)/.exec(txt)
      const wired = /Pages wired down:\s+(\d+)/.exec(txt)
      if ((vm as { exitCode?: number }).exitCode === 0 && ps && pagesActive && wired) {
        const tot = await $.process.run(['sysctl', '-n', 'hw.memsize'])
        const total = Number(String((tot as { stdout?: string }).stdout || '').trim())
        const used = (Number(pagesActive[1]) + Number(wired[1])) * Number(ps[1])
        if ((tot as { exitCode?: number }).exitCode === 0 && Number.isFinite(total) && total > 0) {
          x.ram = { usedBytes: used, totalBytes: total, method: 'macos:active+wired', at: now(), hadGood: true, errCount: x.ram.errCount }
          return
        }
      }
    } catch {
      /* fall through to the Linux source */
    }
    const mi = await $.fs.read('/proc/meminfo')
    const total = /^MemTotal:\s+(\d+)\s*kB/m.exec(mi)
    const avail = /^MemAvailable:\s+(\d+)\s*kB/m.exec(mi)
    if (total && avail) {
      const t = Number(total[1]) * 1024
      const a = Number(avail[1]) * 1024
      if (Number.isFinite(t) && t > 0) {
        x.ram = { usedBytes: t - a, totalBytes: t, method: 'linux:memavailable', at: now(), hadGood: true, errCount: x.ram.errCount }
      }
    }
  } catch {
    x.ram.errCount++
  }
}

// CONSTRAINT (measured 2026-09-20): CLAUDE_CODE_VERSION is NOT the executing
// host's version — it lags. Order: the executing image's directory -> the image
// itself -> PATH. Installed (for {ver.restart}) is read beside the image.
async function collectVersion($: EngineInterface): Promise<void> {
  const x = S.extra
  if (x.ver.ok) return
  let execPath = ''
  try {
    const ep = await $.env.get('CLAUDE_CODE_EXECPATH')
    execPath = typeof ep === 'string' ? ep.trim() : ''
  } catch {
    /* env handle absent */
  }
  const base = execPath ? execPath.slice(execPath.lastIndexOf('/') + 1) : ''
  if (/^\d+\.\d+\.\d+/.test(base)) {
    x.ver.ok = true
    x.ver.text = base
    void readInstalled($, execPath)
    return
  }
  try {
    const argv = execPath ? [execPath, '--version'] : ['claude', '--version']
    const r = await $.process.run(argv)
    const t = (r as { exitCode?: number }).exitCode === 0 ? String((r as { stdout?: string }).stdout || '').trim().split(/\s+/)[0] : ''
    if (t) {
      x.ver.ok = true
      x.ver.text = t
      void readInstalled($, execPath)
      invalidate($)
    } else x.ver.errCount++
  } catch {
    x.ver.errCount++
  }
}

async function readInstalled($: EngineInterface, execPath: string): Promise<void> {
  // {ver.restart} needs the installed version beside the executing image; a
  // failed read keeps the third case (pending), never a guess
  try {
    const dir = execPath.slice(0, execPath.lastIndexOf('/')) || '.'
    const raw = await $.fs.read(dir + '/package.json')
    const parsed = JSON.parse(String(raw)) as { version?: unknown }
    if (parsed && typeof parsed.version === 'string') S.extra.ver.installed = parsed.version
  } catch {
    /* stays unread: ver.restart reads '…' */
  }
}

async function collectBreakdown($: EngineInterface): Promise<void> {
  const x = S.extra
  try {
    // the summary form estimates locally and sends no requests
    const u = await $.session.usage({ breakdown: 'summary' })
    const b = u && (u as { context?: { breakdown?: Record<string, unknown> } }).context ? ((u as { context: { breakdown?: Record<string, unknown> } }).context.breakdown as Record<string, unknown>) : undefined
    const pick = (names: string[]): number | null => {
      for (const n of names) {
        const v = b ? b[n] : undefined
        if (typeof v === 'number' && Number.isFinite(v)) return v
      }
      return null
    }
    const input = pick(['input_tokens', 'input', 'uncached_tokens'])
    const cw = pick(['cache_creation_input_tokens', 'cache_write', 'cache_creation', 'cache_writes'])
    const cr = pick(['cache_read_input_tokens', 'cache_read', 'cache_reads'])
    if (input === null && cw === null && cr === null) {
      if (!x.brk.unrecognized) {
        x.brk.unrecognized = true
        diag('open', 'brk-shape', "usage({breakdown:'summary'}) shape unrecognized — fields OPEN (spec §3.3 row 4)")
      }
      return
    }
    x.brk = { at: now(), input, cw, cr, unrecognized: false }
    invalidate($)
  } catch {
    /* stays ЕЩЁ НЕТ */
  }
}

async function collectConfig($: EngineInterface): Promise<void> {
  const x = S.extra
  try {
    let md = -1
    let sig = ''
    try {
      const found = await $.fs.ancestors({ names: ['CLAUDE.md'] })
      md = 0
      for (const f of found) {
        md++
        sig += (f as { dir?: string }).dir + '/' + (f as { name?: string }).name + ';'
      }
    } catch {
      md = -1
    }
    let ru = -1
    try {
      ru = 0
      for (const dir of [(x.home || '') + '/.claude/rules', x.home + '/.claude/rules']) {
        if (!dir.startsWith('/')) continue
        const entries = await $.fs.list(dir)
        ru += entries.filter((e) => e && (e as { kind?: string }).kind !== 'dir').length
      }
    } catch {
      ru = -1
    }
    let mcp = -1
    try {
      const tools = await $.tool.list()
      const servers = new Set<string>()
      for (const t of tools) {
        const n = String((t as { name?: string }).name || '')
        if (n.startsWith('mcp__')) servers.add(n.split('__')[1] ?? '')
      }
      mcp = servers.size
    } catch {
      mcp = -1
    }
    let cmd = -1
    try {
      const cmds = await $.command.list()
      cmd = cmds.filter((c) => c && (c as { source?: string }).source !== 'builtin').length
    } catch {
      cmd = -1
    }
    let hk = -1
    let styleState: 'ok' | 'failed' = 'ok'
    let styleText = ''
    try {
      const st = await $.settings.read()
      const hooks = (st as { hooks?: Record<string, unknown[]> }).hooks
      hk = 0
      // hooks are counted as COMMANDS, not event keys (SPEC §4.4)
      if (hooks && typeof hooks === 'object') {
        for (const k of Object.keys(hooks)) {
          const arr = hooks[k]
          if (Array.isArray(arr)) hk += arr.length
        }
      }
      const raw = (st as { outputStyle?: string; output_style?: string }).outputStyle ?? (st as { output_style?: string }).output_style
      styleText = typeof raw === 'string' && raw ? raw : 'default'
    } catch {
      hk = -1
      styleState = 'failed'
    }
    if (md < 0 || ru < 0 || mcp < 0 || cmd < 0 || hk < 0) {
      x.cfg.state = 'failed'
      if (md >= 0) x.cfg.md = md
      if (ru >= 0) x.cfg.ru = ru
      if (mcp >= 0) x.cfg.mcp = mcp
      if (cmd >= 0) x.cfg.cmd = cmd
      if (hk >= 0) x.cfg.hk = hk
    } else if (x.cfg.mdSig !== sig || x.cfg.state !== 'ok') {
      x.cfg = { state: 'ok', md, ru, mcp, cmd, hk, at: now(), mdSig: sig }
      invalidate($)
    } else {
      x.cfg.at = now()
    }
    x.style = { state: styleState, text: styleText }
  } catch {
    x.cfg.state = 'failed'
  }
}

async function collectStatic($: EngineInterface): Promise<void> {
  try {
    const raw = await $.fs.read($.plugin.root + '/config.json')
    const parsed = JSON.parse(String(raw)) as { staticLine?: unknown }
    S.extra.staticLine = parsed && typeof parsed.staticLine === 'string' ? parsed.staticLine.trim() : ''
  } catch {
    S.extra.staticLine = ''
  }
}

async function collectEnv($: EngineInterface): Promise<void> {
  try {
    const h = await $.env.get('HOME')
    if (typeof h === 'string' && h) S.extra.home = h
  } catch {
    /* degraded counters only */
  }
}

async function resumeProbe($: EngineInterface): Promise<void> {
  try {
    const t = await $.session.turns()
    if (typeof t === 'number' && t > 0) {
      // prompts that predate this module's observation: Σ and duration are partial
      S.extra.resumed = true
      S.extra.priorTurns = t
      diag('open', 'resume-basis', 'session resumed with ' + t + ' prior prompt(s): Σ and duration bases are partial')
    }
  } catch {
    /* bases stay marked, not guessed */
  }
  try {
    const msgs = await $.session.messages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i] as { toolUses?: Array<{ tool?: string; input?: unknown }> }
      const uses = m && Array.isArray(m.toolUses) ? m.toolUses : []
      for (let j = uses.length - 1; j >= 0; j--) {
        if (TODO_TOOLS.includes(String(uses[j]!.tool))) {
          applyTodos(uses[j]!)
          return
        }
      }
    }
  } catch {
    /* snapshot stays ЕЩЁ НЕТ until a live TodoWrite */
  }
}

async function collectAgentsList($: EngineInterface): Promise<void> {
  try {
    const list = await $.agent.list()
    S.extra.agents.polled = true
    for (const a of list) {
      if (!a || typeof a.id !== 'string') continue
      const prev = S.extra.agents.map.get(a.id)
      S.extra.agents.map.set(a.id, {
        desc: String(a.description || (prev ? prev.desc : '') || a.type || ''),
        model: prev ? prev.model : '',
        status: String(a.status || (prev ? prev.status : 'running')),
        at: prev ? prev.at : now(),
      })
    }
    pruneAgents()
  } catch {
    /* list is a refresh, not a basis */
  }
}

function pruneAgents(): void {
  while (S.extra.agents.map.size > CAP.agents) {
    const first = S.extra.agents.map.keys().next().value
    if (first === undefined) break
    S.extra.agents.map.delete(first)
  }
  while (S.extra.agents.done.length > CAP.doneAgents) S.extra.agents.done.shift()
}

function applyTodos(src: unknown): void {
  const s = src as { todos?: unknown[]; input?: { todos?: unknown[] } }
  const todos = (s && Array.isArray(s.todos) ? s.todos : null) ?? (s && s.input && Array.isArray(s.input.todos) ? s.input.todos : null)
  if (!todos) return
  let done = 0
  let current = ''
  for (const t of todos) {
    const status = String((t && (t as { status?: string }).status) || '')
    if (status === 'completed') done++
    if (!current && status === 'in_progress') current = String((t && (t as { content?: string }).content) || '').slice(0, 20)
  }
  S.extra.todo = { synced: true, done, total: todos.length, current }
}

async function fastTick($: EngineInterface): Promise<void> {
  await collectRam($)
  await collectVersion($)
}

async function slowTick($: EngineInterface): Promise<void> {
  await collectBreakdown($)
  await collectConfig($)
  await collectStatic($)
  await collectAgentsList($)
}

function ensureStarted($: EngineInterface, defer = false): void {
  if (S.started) return
  S.started = true // the ONLY place timers are created; render never restarts them
  const create = (): void => {
    try {
      $.clock.every(5000, () => {
        void quiet(() => fastTick($))
      })
    } catch (x) {
      diag('fail', 'timer-fast', 'clock.every(5s) refused: ' + String(x).slice(0, 120))
    }
    try {
      $.clock.every(30000, () => {
        void quiet(() => slowTick($))
      })
    } catch (x) {
      diag('fail', 'timer-slow', 'clock.every(30s) refused: ' + String(x).slice(0, 120))
    }
    launch($)
  }
  if (defer) {
    // CONSTRAINT: the module environment declares no timer global — the defer
    // rides a microtask, which lands after the frame's synchronous return
    void Promise.resolve().then(create)
  } else {
    create()
  }
}

function launch($: EngineInterface): void {
  void quiet(() => collectEnv($))
  void quiet(() => slowTick($))
  void quiet(() => resumeProbe($))
}

// ---------- refresh machinery (base A: tickets, change-only invalidation) ----------

async function refresh($: EngineInterface, src: string, keepContext = false): Promise<void> {
  flushDiag($)
  const ticket = ++S.refreshesBegun
  const fresh = await gatherNouns($)
  // a read older than the one on screen is dropped (SPEC §14.12, presses order)
  if (ticket < S.refreshShown) return
  S.refreshShown = ticket
  fresh.effort = S.effort
  const kept = S.snap?.context
  // After an interrupted turn 2.1.280 answers the context with no count; the
  // classic payload keeps the figure (measured live). The old figure stays,
  // marked УСТАРЕЛО with '*'; the next answer with a count removes the mark.
  if (keepContext && fresh.context && fresh.context.tokens === undefined && kept?.tokens !== undefined) {
    fresh.context = { ...fresh.context, tokens: kept.tokens, percent: kept.percent }
    S.extra.ctxStale = true
  } else if (fresh.context && fresh.context.tokens !== undefined) {
    S.extra.ctxStale = false
  }
  S.snap = fresh
  await redraw($)
}

async function refreshUsage($: EngineInterface, src: string): Promise<void> {
  if (!S.snap) return refresh($, src)
  const ticket = ++S.refreshesBegun
  const read = carryLastGood(await readUsage($))
  if (ticket < S.refreshShown || !S.snap) return
  S.refreshShown = ticket
  const errors = { ...S.snap.errors }
  for (const id of USAGE_IDS) delete errors[id]
  S.snap = { ...S.snap, ...read, errors: { ...errors, ...read.errors } }
  if (read.context && read.context.tokens !== undefined) S.extra.ctxStale = false
  await redraw($)
}

async function redraw($: EngineInterface): Promise<void> {
  flushDiag($)
  // each redraw asked for costs a frame; a refresh that finds the bar as it was
  // asks for none (measured live, SPEC §14.12)
  const key = drawnKeyOf()
  if (key !== undefined && key === S.drawnKey) return
  S.drawnKey = key
  invalidate($)
}

function drawnKeyOf(): string | undefined {
  if (!S.snap) return undefined
  const vars = buildVars(S.snap, S.extra, S.cfg.view)
  const lines = S.cfg.tpl.lines.map((line) => renderLine(line, vars, WIDTH_FALLBACK, S.cfg.tpl.sep, S.cfg.tpl.evict, S.cfg.view.overflow))
  return JSON.stringify(lines)
}

function refreshQuietly($: EngineInterface, src: string, usageOnly = false): Promise<void> {
  return (usageOnly ? refreshUsage($, src) : refresh($, src)).catch((err) => {
    diag('fail', 'refresh', src + ': ' + errorText(err))
  })
}

// Picker presses run one after another; a failure becomes a notice, never a
// lost picker (SPEC §14.12).
function act($: EngineInterface, operation: () => Promise<unknown>): void {
  S.actions = S.actions.then(operation).catch((error) => {
    S.saveResult = errorText(error)
    try {
      $.ui.toast('[statusline] ' + errorText(error))
    } catch {
      /* toast is best effort */
    }
  })
}

// ---------- bar tree (one builder for the bar and the preview, SPEC §14.6.5) ----------

type Table = { Box: (props: Record<string, unknown>) => unknown; Text: (props: Record<string, unknown>) => unknown }

type DrawSeg = { id: string; text: string; stale: boolean }

function faceProps(role: 'label' | 'value' | 'alert', face: Record<string, string>): Record<string, unknown> {
  const style = face[role] ?? ''
  const props: Record<string, unknown> = {}
  if (style === 'bold') props['bold'] = true
  else if (style === 'italic') props['italic'] = true
  else if (style === 'underline') props['underline'] = true
  else if (style === 'strikethrough') props['strikethrough'] = true
  else if (style === 'inverse') props['inverse'] = true
  else if (style === 'dim') props['dimColor'] = true
  // blink and hover need support the terminal band has not measured: plain text
  // with a visible state, never a lost value (§14.5.1 face degradation)
  return props
}

function colorOf(id: string, view: View): string | undefined {
  if (view.segColors[id]) return view.segColors[id]
  const entry = REGISTRY.find((r) => r.id === id)
  if (!entry || !entry.slot) return undefined
  return view.pal[entry.slot]
}

function thresholdColor(pct: number, view: View): string | undefined {
  return pct >= view.thresholds[1] ? view.pal.high : pct >= view.thresholds[0] ? view.pal.mid : view.pal.ok
}

// Percent-bearing segments paint by their own scale; the scale is the data, so
// segmentColors never overrides it (SPEC §14.10).
function segColor(id: string, text: string, view: View): string | undefined {
  const pctMatch = /(\d+(?:\.\d+)?)%\s*\*?$/.exec(text)
  if (pctMatch && (id === 'ctx' || id === 'five-hour-limit' || id === 'weekly-limit' || id === 'rl')) {
    return thresholdColor(Number(pctMatch[1]), view)
  }
  if (id === 'ctx' || id === 'five-hour-limit' || id === 'weekly-limit' || id === 'rl' || id === 'ver') return view.pal.fresh
  return colorOf(id, view)
}

function segmentText(seg: DrawSeg, view: View, table: Table, details: boolean): unknown {
  const props: Record<string, unknown> = { children: [seg.text], wrap: 'truncate' }
  // the hover scope names the card; details=off draws neither (SPEC §14.8 tooth 30)
  if (details) props['hover'] = { scope: 'sl-' + seg.id, bold: true, underline: true }
  const color = segColor(seg.id, seg.text, view)
  const mono = view.paletteName === 'mono'
  if (color && !mono) props['color'] = color
  if (mono || seg.stale) props['dimColor'] = true
  if (view.fill === 'inverse') props['inverse'] = true
  if (view.fill === 'segment' && color && !mono) props['backgroundColor'] = color
  if (seg.text.endsWith('*')) props['dimColor'] = true
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

function wrapSegment(seg: DrawSeg, view: View, table: Table, details: boolean): unknown {
  const inner = segmentText(seg, view, table, details)
  if (view.shape === 'plain' || view.shape === 'lean') return inner
  const pair = capPair(view)
  const children: unknown[] = []
  // pill pads the capsule; classic keeps the box bare — the two shapes stay
  // distinguishable by props alone (SPEC §14.8 tooth 14)
  if (view.shape === 'pill') children.push(table.Text({ children: [' '], wrap: 'truncate' }))
  if (pair) children.push(table.Text({ children: [pair[0]], color: view.pal.sep, wrap: 'truncate' }))
  children.push(inner)
  if (pair) children.push(table.Text({ children: [pair[1]], color: view.pal.sep, wrap: 'truncate' }))
  if (view.shape === 'pill') children.push(table.Text({ children: [' '], wrap: 'truncate' }))
  const boxProps: Record<string, unknown> = { key: 'segbox:' + seg.id, flexDirection: 'row', flexShrink: 0, children }
  const wantsBg = view.shape === 'powerline' || (view.shape === 'pill' && (view.fill === 'segment' || view.fill === 'band')) || ((view.fill === 'segment' || view.fill === 'band') && view.shape === 'classic')
  if (wantsBg) {
    const color = segColor(seg.id, seg.text, view)
    if (color && view.paletteName !== 'mono') boxProps['backgroundColor'] = color
  }
  return table.Box(boxProps)
}

// One builder for the band, the hint line and the picker preview: they cannot
// diverge (SPEC §14.6.5, tooth 21).
export function buildBarTree(lines: DrawSeg[][], view: View, width: number, table: Table, details: boolean, detailOfId: (id: string) => string): unknown {
  const rows: unknown[] = []
  lines.forEach((line, li) => {
    const segs: unknown[] = []
    line.forEach((seg, i) => {
      const join = joinText(view, table, i === line.length - 1)
      if (join !== null) segs.push(join)
      segs.push(wrapSegment(seg, view, table, details))
    })
    const rowProps: Record<string, unknown> = { flexDirection: 'row', flexShrink: 0, children: segs }
    if (view.fill === 'band') rowProps['backgroundColor'] = view.pal.path
    rows.push(table.Box(rowProps))
    if (details) {
      for (const seg of line) {
        rows.push(
          table.Box({
            position: 'absolute',
            top: -1 - li,
            left: 0,
            display: 'none',
            hover: { scope: 'sl-' + seg.id, display: 'flex' },
            children: [table.Text({ children: [' ' + detailOfId(seg.id) + ' '], wrap: 'truncate' })],
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

// Renders the template lines against the vars: per-line eviction, the maxRows
// cut with diagnostics, empty lines never drawn (SPEC §14.3).
function drawLines(vars: Record<string, Var>, tpl: Tpl, view: View, width: number, maxRows: number): DrawSeg[][] {
  const out: DrawSeg[][] = []
  let dropped = 0
  for (const line of tpl.lines) {
    if (out.length >= maxRows) {
      dropped++
      continue
    }
    const drawn = renderLine(line, vars, width, tpl.sep, tpl.evict, view.overflow)
    if (drawn.length > 0) out.push(drawn)
  }
  if (dropped > 0) diag('fail', 'lines-over-limit', 'template: ' + dropped + ' line(s) beyond maxRows=' + maxRows + ' not drawn')
  return out
}

// ---------- options parse + reload restore (SPEC §14.7) ----------

function rawOptionsOf(options: PluginOptions): Record<string, string> {
  const out: Record<string, string> = {}
  const fields = [...ALL_AXES, 'template', 'separator', 'evictOrder', 'segmentColors', 'theme']
  for (const f of fields) {
    const v = (options as Record<string, unknown>)[f]
    if (typeof v === 'string') out[f] = v
    else if (typeof v === 'number') out[f] = String(v)
  }
  return out
}

function defaultTemplateLines(): Seg[][] {
  // the mod's default: the ClaudeCodeMods default set over the merged registry
  return [['git-branch', 'model', 'ctx', 'five-hour-limit', 'weekly-limit', 'session', 'cost'].map((id) => ({ id, body: '{' + id + '.text}' }))]
}

export function presetLines(name: string): Seg[][] {
  if (name === 'claude-hud') {
    // 0.2.0's default band: every element, draw order reversed eviction
    const order = [...EVICT_ORDER].reverse()
    return [order.map((id) => ({ id, body: '{' + id + '.text}' }))]
  }
  if (name === 'ClaudeCodeStatusline') {
    return [['git-branch', 'model', 'ctx', 'five-hour-limit', 'weekly-limit', 'session', 'cost'].map((id) => ({ id, body: '{' + id + '.text}' }))]
  }
  return defaultTemplateLines()
}

// The parse one reload runs: broken pieces fall back aloud, the last good
// config applies (SPEC §14.7, Р9).
function applyOptions(raw: Record<string, string>): void {
  const tplRaw = raw['template'] ?? ''
  let lines = tplRaw.trim() ? parseTemplate(tplRaw) : []
  if (tplRaw.trim() !== '' && lines.length === 0) {
    // a broken config is replaced aloud, never silently (SPEC §13.4, tooth 7)
    diag('fail', 'template-fallback', 'template parsed to zero lines; the default template applies')
  }
  if (lines.length === 0) lines = defaultTemplateLines()
  const sep = raw['separator'] && raw['separator'] !== '' ? raw['separator'] : undefined
  const evict = raw['evictOrder'] && raw['evictOrder'].trim() !== '' ? raw['evictOrder'].split(',').map((x) => x.trim()).filter(Boolean) : EVICT_ORDER.slice()
  const { view, themeName } = resolveView(raw, S.userThemes)
  S.cfg = { tpl: { lines, sep: sep ?? view.separator, evict }, view, themeName, rawOptions: raw, userThemes: S.userThemes }
}

// What register runs on every load: parse the options, then restore the
// durable picker state and check the in-flight save mark against the options
// (SPEC §14.7). Exported for the reload tests: the kit loads a plugin once.
export async function restoreAfterReload($: EngineInterface, options: PluginOptions): Promise<void> {
  const raw = rawOptionsOf(options)
  let lastGood: Record<string, string> | undefined
  try {
    const stored = await $.store.get(STORE_LASTGOOD)
    if (stored && typeof stored === 'object') lastGood = (stored as { __raw?: Record<string, string> }).__raw
  } catch {
    /* no last good yet */
  }
  applyOptions(raw)
  const broke = S.diag.some((d) => d.key === 'template-fallback' || d.key === 'theme-unknown')
  if (broke && lastGood) {
    // the last successfully parsed config applies, and the fact is named
    applyOptions(lastGood)
    diag('fail', 'lastgood-applied', 'broken config: the last good configuration applies')
    S.cfg.rawOptions = raw
  } else {
    try {
      await $.store.set(STORE_LASTGOOD, { __raw: raw })
    } catch {
      /* store best effort */
    }
  }
  // in-flight save mark: matched fields clear it, unmatched ones are named
  try {
    const mark = await $.store.get(STORE_SAVING)
    if (mark && typeof mark === 'object') {
      const fields = ((mark as { fields?: string[] }).fields ?? []) as string[]
      const values = ((mark as { values?: Record<string, string> }).values ?? {}) as Record<string, string>
      const unwritten = fields.filter((f) => (raw[f] ?? '') !== (values[f] ?? ''))
      if (unwritten.length === 0) {
        await $.store.delete(STORE_SAVING)
        S.saving = null
        S.saveResult = 'сохранено'
      } else {
        S.saving = { fields, values }
        S.saveResult = 'не записано: ' + unwritten.join(', ')
        diag('fail', 'save-unwritten', 'save in flight: fields not written: ' + unwritten.join(', '))
      }
    }
  } catch {
    /* mark check is best effort */
  }
  // the open flag and the draft live under the session id (SPEC §14.7)
  try {
    const open = await $.store.get(STORE_OPEN)
    const session = await $.session.id()
    S.pickerSession = session
    S.pickerOpen = !!open && typeof open === 'object' && (open as { session?: unknown }).session === session
    if (S.pickerOpen) {
      const draft = await $.store.get(STORE_DRAFT)
      if (draft && typeof draft === 'object' && (draft as { session?: unknown }).session === session) {
        const d = draft as { lines?: unknown; axes?: unknown; focus?: unknown }
        const lines = Array.isArray(d.lines) ? (d.lines as Seg[][]) : null
        const axes = d.axes && typeof d.axes === 'object' ? (d.axes as Record<string, string>) : null
        if (lines && axes) S.draft = { lines, axes, focus: (d.focus as { line: number; seg: number } | null) ?? null }
      }
    }
  } catch {
    S.pickerOpen = false
  }
  try {
    const themes = await $.store.get(STORE_THEMES)
    if (themes && typeof themes === 'object') S.userThemes = themes as Record<string, Record<string, string>>
  } catch {
    /* user themes are optional */
  }
}

// The reload restore runs once per module environment, on the first event that
// carries a reachable store; declared at the top of the file for the host's
// `$` scanner (law L2).
function ensureRestore($: EngineInterface): void {
  if (S.restored) return
  S.restored = true
  void restoreAfterReload($, S.reloadOptions as PluginOptions).catch((err) => {
    diag('fail', 'restore', 'reload restore failed: ' + errorText(err))
  })
}

// ---------- picker (SPEC §14.6) ----------

function freshDraft(): { lines: Seg[][]; axes: Record<string, string>; focus: { line: number; seg: number } | null } {
  return {
    lines: S.cfg.tpl.lines.map((line) => line.map((seg) => ({ ...seg }))),
    axes: { ...S.cfg.rawOptions },
    focus: null,
  }
}

async function openPicker($: EngineInterface): Promise<void> {
  S.pickerOpen = true
  S.pickerSession = await $.session.id()
  if (!S.draft) S.draft = freshDraft()
  S.saveResult = ''
  await $.store.set(STORE_OPEN, { session: S.pickerSession })
  await $.store.set(STORE_DRAFT, { session: S.pickerSession, lines: S.draft.lines, axes: S.draft.axes, focus: S.draft.focus })
  await $.ui.open({ id: PANE_ID, title: 'Status line', focus: true, closeOnEscape: true, rows: 24 })
  invalidate($)
}

async function discardDraft($: EngineInterface): Promise<void> {
  S.pickerOpen = false
  S.draft = null
  S.draftQuery = ''
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

async function persistDraft($: EngineInterface): Promise<void> {
  if (!S.draft) return
  try {
    await $.store.set(STORE_DRAFT, { session: S.pickerSession, lines: S.draft.lines, axes: S.draft.axes, focus: S.draft.focus })
  } catch {
    /* best effort */
  }
}

function focusSegId(): string | undefined {
  if (!S.draft || !S.draft.focus) return undefined
  const line = S.draft.lines[S.draft.focus.line]
  const seg = line ? line[S.draft.focus.seg] : undefined
  return seg?.id
}

function segmentKey(id: string): string {
  return SEGMENT_KEY + id + (S.followed?.id === id ? '#' + S.followed.n : '')
}

// After a press has reordered the rows, the focused pill is drawn under a key
// no drawing had yet, which the engine waits for; the plugin's focus move lands
// there (measured on 2.1.280 — the ring keeps its place in the band).
async function keepFocus($: EngineInterface, requestId: string): Promise<void> {
  const id = focusSegId()
  if (id === undefined) return
  S.followed = { id, n: ++S.follows }
  invalidate($)
  try {
    await $.ui.focus({ requestId, key: segmentKey(id) })
  } catch {
    /* the kit has no implementation for a plugin's own focus move */
  }
}

type MoveDir = 'left' | 'right' | 'up' | 'down' | 'out'

function moveFocus(dir: MoveDir): void {
  if (!S.draft) return
  const d = S.draft
  if (dir === 'out') {
    if (!d.focus) return
    const line = d.lines[d.focus.line]
    if (line) line.splice(d.focus.seg, 1)
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

// ▲/▼ move the PILL into the neighbouring line; ◀/▶ reorder inside its line.
function movePill(dir: MoveDir): void {
  if (!S.draft || !S.draft.focus) {
    moveFocus(dir)
    return
  }
  const d = S.draft
  const focus = d.focus!
  const li = focus.line
  const si = focus.seg
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

function addSegment(id: string): void {
  if (!S.draft) return
  const d = S.draft
  const li = d.focus ? d.focus.line : d.lines.length - 1
  const line = d.lines[Math.max(0, Math.min(li, d.lines.length - 1))]!
  line.push({ id, body: '{' + id + '.text}' })
  d.focus = { line: Math.max(0, Math.min(li, d.lines.length - 1)), seg: line.length - 1 }
}

function addLine(): string | null {
  if (!S.draft) return null
  if (S.draft.lines.length >= S.lastMaxRows) return 'предел строк: ' + S.lastMaxRows + ' (maxRows этого окна)'
  S.draft.lines.push([])
  return null
}

function delLine(li: number): void {
  if (!S.draft) return
  const line = S.draft.lines[li]
  if (line && line.length === 0) S.draft.lines.splice(li, 1)
}

function draftSerialize(draft: { lines: Seg[][] }): string {
  return serializeTemplate(draft.lines)
}

// The save gate: the preview must render and the serialized template must
// round-trip to the same layout — a literal holding a reserved token would
// re-parse into a different layout, and the picker refuses it aloud (§14.8 20/25).
function saveBlockReason(draft: { lines: Seg[][] }): string | null {
  const text = draftSerialize(draft)
  const back = parseTemplate(text)
  if (!sameLayout(back, draft.lines)) return 'литерал с зарезервированным токеном ( ;; или ||) — сохранить нельзя'
  if (back.length === 0) return 'раскладка пуста'
  return null
}

async function saveDraft($: EngineInterface): Promise<void> {
  if (!S.draft) return
  const reason = saveBlockReason(S.draft)
  if (reason) {
    S.saveResult = 'не сохранено: ' + reason
    invalidate($)
    return
  }
  const draft = S.draft
  const next: Record<string, string> = { ...draft.axes }
  next['template'] = draftSerialize(draft)
  const changed: Record<string, string> = {}
  for (const f of Object.keys(next)) {
    if ((next[f] ?? '') !== (S.cfg.rawOptions[f] ?? '')) changed[f] = next[f] ?? ''
  }
  const fields = Object.keys(changed)
  if (fields.length === 0) {
    S.saveResult = 'нет изменений'
    invalidate($)
    return
  }
  // key each row from the actual /config rows — never a constructed write key
  const mine = pluginName($.plugin.name)
  let rows: { key: string; isLocked: boolean; provider: { plugin: string } }[]
  try {
    rows = (await $.config.list()) as typeof rows
  } catch (err) {
    S.saveResult = 'строки /config недоступны: ' + errorText(err)
    invalidate($)
    return
  }
  const denied: string[] = []
  const written: string[] = []
  const prevValues: Record<string, string> = {}
  const writtenValues: Record<string, string> = {}
  // the in-flight mark goes in BEFORE the first write: the reload it causes must
  // not cut the sequence short (SPEC §14.7)
  try {
    await $.store.set(STORE_SAVING, { fields, values: changed })
    S.saving = { fields, values: changed }
  } catch {
    /* best effort */
  }
  // the undo record: the previous values of the changed fields, from the options
  const stack = (await $.store.get(STORE_UNDO)) as { fields: string[]; prev: Record<string, string>; written: Record<string, string> }[] | undefined
  const undo = Array.isArray(stack) ? stack : []
  for (const f of fields) {
    prevValues[f] = S.cfg.rawOptions[f] ?? ''
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
        // {deny} is shown in the panel, never gulled (SPEC §14.8 tooth 17)
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
  S.saveResult = parts.join(' · ')
  // the panel's notice is part of the picker's own state: a redraw is owed
  invalidate($)
}

async function undoSave($: EngineInterface): Promise<void> {
  const stack = (await $.store.get(STORE_UNDO)) as { fields: string[]; prev: Record<string, string>; written: Record<string, string> }[] | undefined
  if (!Array.isArray(stack) || stack.length === 0) {
    S.saveResult = 'нечего отменять'
    invalidate($)
    return
  }
  const entry = stack[stack.length - 1]!
  // the undo first checks the current value: a field changed through /config in
  // the meantime is named and nothing is written (MS:175-188)
  const mine = pluginName($.plugin.name)
  let rows: { key: string; value: unknown; provider: { plugin: string } }[]
  try {
    rows = (await $.config.list()) as typeof rows
  } catch (err) {
    S.saveResult = 'строки /config недоступны: ' + errorText(err)
    invalidate($)
    return
  }
  const stale: string[] = []
  for (const f of entry.fields) {
    const row = rows.find((r) => r.provider.plugin !== 'engine' && pluginName(r.provider.plugin) === mine && r.key.endsWith('.' + f))
    const current = row ? String(row.value ?? '') : (S.cfg.rawOptions[f] ?? '')
    if (current !== (entry.written[f] ?? '')) stale.push(f)
  }
  if (stale.length > 0) {
    S.saveResult = 'не отменено, поле меняли в обход: ' + stale.join(', ')
    invalidate($)
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
  S.saveResult = denied.length > 0 ? 'отмена: НЕ записано ' + denied.join(', ') : 'отменено'
  invalidate($)
}

async function resetAll($: EngineInterface): Promise<void> {
  // /statusline-mod reset: every field back to its default through $.config.set
  const mine = pluginName($.plugin.name)
  let rows: { key: string; value: unknown; provider: { plugin: string } }[]
  try {
    rows = (await $.config.list()) as typeof rows
  } catch (err) {
    S.saveResult = 'строки /config недоступны: ' + errorText(err)
    invalidate($)
    return
  }
  const defaults: Record<string, string> = { theme: 'default', placement: 'above', details: 'hover', numbers: 'raw', model_label: 'raw' }
  for (const axis of THEME_AXES) defaults[axis] = axis === 'separator' || axis === 'thresholds' || axis === 'face' ? '' : 'theme'
  defaults['template'] = ''
  defaults['separator'] = ''
  defaults['evictOrder'] = ''
  defaults['segmentColors'] = ''
  const denied: string[] = []
  for (const field of Object.keys(defaults)) {
    if ((S.cfg.rawOptions[field] ?? '') === defaults[field]) continue
    const row = rows.find((r) => r.provider.plugin !== 'engine' && pluginName(r.provider.plugin) === mine && r.key.endsWith('.' + field))
    if (!row) continue
    try {
      await $.config.set({ key: row.key, value: defaults[field] ?? '' })
    } catch (err) {
      denied.push(field + ': ' + errorText(err))
    }
  }
  S.saveResult = denied.length > 0 ? 'reset: НЕ записано ' + denied.join(', ') : 'сброшено к дефолтам'
  invalidate($)
}

async function saveUserTheme($: EngineInterface, name: string): Promise<void> {
  if (!name) {
    S.themeNote = 'имя темы пустое'
    return
  }
  const snap: Record<string, string> = {}
  for (const axis of THEME_AXES) snap[axis] = S.draft ? (S.draft.axes[axis] ?? 'theme') : S.cfg.rawOptions[axis] ?? 'theme'
  S.userThemes[name] = snap
  try {
    await $.store.set(STORE_THEMES, S.userThemes)
    S.themeNote = 'тема «' + name + '» сохранена'
    invalidate($)
  } catch (err) {
    delete S.userThemes[name]
    S.themeNote = 'тема не сохранена: ' + errorText(err)
  }
}

async function deleteUserTheme($: EngineInterface, name: string): Promise<void> {
  if (!S.userThemes[name]) {
    S.themeNote = 'нет темы «' + name + '»'
    return
  }
  delete S.userThemes[name]
  try {
    await $.store.set(STORE_THEMES, S.userThemes)
    S.themeNote = 'тема «' + name + '» удалена'
    invalidate($)
  } catch {
    /* best effort */
  }
}

// A streaming hook: the refresh starts as the request goes out and the usage
// read runs once the response has arrived — the same inline generator form the
// base A mod ships, proven live on 2.1.280. CONSTRAINT: the acceptance
// instrument's parser does not see a function* parameter as a declaration (its
// own header says a parameter is a decl, not a read); `claude plugin validate`
// is the authoritative scanner here and this form is what it accepts.

// ---------- registration ----------

export function register(on: On, options: PluginOptions): void {
  // reset the whole in-memory state: a reload wipes it (SPEC §14.7)
  S.snap = null
  S.extra = freshExtra()
  S.effort = undefined
  S.effortSeed = null
  S.interactive = false
  S.started = false
  S.diag = []
  S.diagLogged = 0
  S.diagOnce = new Set()
  S.drawnKey = undefined
  S.refreshesBegun = 0
  S.refreshShown = 0
  S.surveyDiag = false
  S.pickerOpen = undefined
  S.pickerSession = ''
  S.draft = null
  S.draftQuery = ''
  S.followed = undefined
  S.follows = 0
  S.actions = Promise.resolve()
  S.saving = null
  S.saveResult = ''
  S.themeNote = ''
  S.themeNameInput = ''
  S.lastMaxRows = 8
  S.userThemes = {}
  S.restored = false
  S.reloadOptions = rawOptionsOf(options)
  applyOptions(rawOptionsOf(options))

  // The host resolves subscriptions STATICALLY: the event name must be a string
  // literal at the on(...) call site. Every subscription is spelled out
  // separately and cannot be folded back (#363).
  const subFail = (event: string, x: unknown): void => {
    diag('fail', 'sub-' + event, "subscription '" + event + "' refused: " + String(x).slice(0, 120))
  }

  try {
    on('session.start', async ($, e, next) => {
      ensureRestore($)
      ensureStarted($)
      S.interactive = e.isInteractive === true
      const started = await next(e)
      try {
        await $.command.register({ name: COMMAND, description: 'Pick the status line segments, their order, the theme and the view axes.', argumentHint: '[reset]' })
      } catch (err) {
        diag('fail', 'command-register', String(err))
      }
      await refresh($, 'session.start')
      return started
    })
  } catch (x) {
    subFail('session.start', x)
  }

  try {
    on('turn.start', async ($, e, next) => {
      if (S.extra.durBase < 0) S.extra.durBase = now()
      return next(e)
    })
  } catch (x) {
    subFail('turn.start', x)
  }

  try {
    on('turn.complete', async ($, e, next) => {
      ensureRestore($)
      if (S.extra.durBase < 0) S.extra.durBase = now()
      const x = S.extra
      x.tools.sawTurnComplete = true
      const key = (e && e.agentId ? String(e.agentId) : 'main') + ':' + String(e && e.turnId ? e.turnId : '')
      if (key !== 'main:' && !x.seenTurns.includes(key)) {
        x.seenTurns.push(key)
        while (x.seenTurns.length > CAP.seenTurns) x.seenTurns.shift()
        const uu = e && e.usage && typeof e.usage === 'object' ? (e.usage as Record<string, unknown>) : null
        if (uu) {
          const fields = [uu['input_tokens'], uu['output_tokens'], uu['cache_read_input_tokens'], uu['cache_creation_input_tokens']]
          // a missing operand does not participate as zero (SPEC §3.2/F14)
          if (fields.every((v) => typeof v === 'number' && Number.isFinite(v))) {
            x.sumTokens = (x.sumTokens ?? 0) + (fields as number[]).reduce((a, b) => a + b, 0)
          } else {
            diag('fail', 'sum-field', 'turn.complete usage field missing/non-number; turn excluded from Σ')
          }
          if (!e.agentId) {
            if (typeof uu['model'] === 'string' && uu['model']) x.servedModel = uu['model'] as string
            const out = uu['output_tokens']
            const ms = (e as { durationMs?: number }).durationMs
            if (typeof out === 'number' && typeof ms === 'number' && (out as number) > 0 && ms > 0) {
              x.speed = Math.round(((out as number) / (ms / 1000)) * 10) / 10
            }
          } else {
            const a = x.agents.map.get(String(e.agentId))
            if (a) {
              a.status = 'completed'
              if (typeof uu['model'] === 'string' && uu['model']) a.model = uu['model'] as string
              x.agents.done.push(String(e.agentId))
              while (x.agents.done.length > CAP.doneAgents) x.agents.done.shift()
            }
          }
        }
      }
      const done = await next(e)
      await refresh($, 'turn.complete', e.isAborted === true)
      return done
    })
  } catch (x) {
    subFail('turn.complete', x)
  }

  try {
    on('turn.step', async function* ($, e, next) {
      if (e.agentId !== undefined) return yield* next(e)
      if (e.effort !== undefined && e.effort !== S.effort) {
        S.effort = e.effort
        if (S.snap) S.snap.effort = S.effort
      }
      const refreshed = refreshQuietly($, 'turn.step')
      const result = yield* next(e)
      await refreshed
      await refreshQuietly($, 'turn.step.end', true)
      return result
    })
  } catch (x) {
    subFail('turn.step', x)
  }

  try {
    on('tool.call', async ($, e, next) => {
      const x = S.extra
      const id = e && typeof (e as { tool_use_id?: string }).tool_use_id === 'string' ? (e as { tool_use_id: string }).tool_use_id : ''
      const name = e && typeof (e as { tool?: string }).tool === 'string' ? (e as { tool: string }).tool : '?'
      x.tools.sawAny = true
      if (id && x.tools.active.size < CAP.activeTools) x.tools.active.set(id, name)
      if (x.tools.byName.size < CAP.toolNames || x.tools.byName.has(name)) {
        x.tools.byName.set(name, (x.tools.byName.get(name) ?? 0) + 1)
      }
      if (TODO_TOOLS.includes(name)) applyTodos((e as { todos?: unknown }).todos ? e : (e as { input?: unknown }).input)
      let r: Awaited<ReturnType<typeof next>> | undefined
      try {
        r = await next(e)
      } catch (err) {
        if (id) x.tools.active.delete(id)
        x.tools.errTotal++
        throw err
      }
      if (id) x.tools.active.delete(id)
      x.tools.doneTotal++
      if (r && typeof r === 'object' && (r as { isError?: unknown }).isError === true) {
        x.tools.errTotal++
      } else {
        x.tools.done.push({ name, isError: false })
        while (x.tools.done.length > CAP.doneQueue) x.tools.done.shift()
      }
      return r!
    })
  } catch (x) {
    subFail('tool.call', x)
  }

  try {
    on('agent.spawn', async ($, e, next) => {
      let r: Awaited<ReturnType<typeof next>> | undefined
      try {
        r = await next(e)
      } catch (err) {
        diag('fail', 'agent-spawn', 'agent.spawn chain threw: ' + String(err).slice(0, 80))
        throw err
      }
      const agentId = r && typeof (r as { agentId?: unknown }).agentId === 'string' ? (r as { agentId: string }).agentId : ''
      if (agentId && !S.extra.agents.map.has(agentId)) {
        S.extra.agents.map.set(agentId, {
          desc: String((e as { description?: string; name?: string; subagentType?: string }).description || (e as { name?: string }).name || (e as { subagentType?: string }).subagentType || ''),
          model: String((r as { model?: string }).model || (e as { model?: string }).model || ''),
          status: 'running',
          at: now(),
        })
        pruneAgents()
      }
      return r!
    })
  } catch (x) {
    subFail('agent.spawn', x)
  }

  // The bar follows /model, /compact and /clear once the change has been made,
  // and the model row of /config once it is written (base A).
  for (const command of ['model', 'compact', 'clear']) {
    try {
      on('command.run', { command }, async ($, e, next) => {
        const result = await next(e)
        await refreshQuietly($, 'command.run:' + command)
        return result
      })
    } catch (x) {
      subFail('command.run:' + command, x)
    }
  }

  try {
    on('config.set', { key: 'model' }, async ($, e, next) => {
      const result = await next(e)
      await refreshQuietly($, 'config.set')
      return result
    })
  } catch (x) {
    subFail('config.set', x)
  }

  // Human labels for the /config rows (MS:251).
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
          face: 'начертание', border: 'рамка', overflow: 'узкое окно', numbers: 'формат чисел', model_label: 'имя модели',
          segmentColors: 'цвет по сегменту',
        }
        return { ...result, label: 'Статус-строка: ' + (titles[field] ?? field) }
      }
      return result
    })
  } catch (x) {
    subFail('config.describe', x)
  }

  try {
    on('command.run', { command: COMMAND }, async ($, e) => {
      ensureRestore($)
      const arg = (e.args ?? '').trim()
      if (arg === 'reset') {
        await resetAll($)
        return { text: 'Status line reset to defaults. ' + S.saveResult }
      }
      if (!S.interactive) {
        // a surface without the pane gets text and the /config path (SPEC §14.6)
        return { text: 'Status line is configured through /config (fields catalyst-statusline.*) or /statusline-mod in an interactive terminal or desktop session.' }
      }
      await openPicker($)
      return {}
    })
  } catch (x) {
    subFail('command.run:' + COMMAND, x)
  }

  try {
    on('ui.close', { id: PANE_ID }, async ($, _e, next) => {
      // Esc and the engine's close discard the draft; the bar keeps what it had
      await discardDraft($)
      return next(_e)
    })
  } catch (x) {
    subFail('ui.close', x)
  }

  // The band above the prompt: placement=above (default), yields to a survey.
  try {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      ensureStarted($, true)
      ensureRestore($)
      S.lastMaxRows = typeof e.props.maxRows === 'number' && e.props.maxRows > 0 ? e.props.maxRows : S.lastMaxRows
      const view = S.cfg.view
      if (view.placement !== 'above') return next(e)
      if (e.props.hasSurvey === true) {
        // one diagnostic record per survey, never a redraw fight (SPEC §14.12)
        if (!S.surveyDiag) {
          S.surveyDiag = true
          diag('info', 'survey-yield', 'AbovePrompt yielded to a survey; the band is not drawn')
        }
        return next(e)
      }
      S.surveyDiag = false
      const width = typeof e.props.bodyColumns === 'number' && e.props.bodyColumns > 0 ? e.props.bodyColumns : WIDTH_FALLBACK
      const maxRows = typeof e.props.maxRows === 'number' && e.props.maxRows > 0 ? e.props.maxRows : 8
      const vars = buildVars(S.snap, S.extra, view)
      const lines = drawLines(vars, S.cfg.tpl, view, width, maxRows)
      if (lines.length === 0) return next(e)
      const table = (await $.ui.resolve(e)) as unknown as Table
      const detail = (id: string): string => detailOf(id, vars)
      return buildBarTree(lines, view, width, table, view.details === 'hover', detail) as Awaited<ReturnType<typeof next>>
    })
  } catch (x) {
    subFail('ui.render:AbovePrompt', x)
  }

  // The hint line under the prompt: placement=hint — the bar row, then the
  // engine's own hint dim after it, verbatim (base A, SPEC §14.12).
  try {
    on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
      ensureStarted($, true)
      ensureRestore($)
      const view = S.cfg.view
      if (view.placement !== 'hint') return next(e)
      const width = typeof (e as { viewport?: { columns?: number } }).viewport?.columns === 'number' ? (e as { viewport: { columns: number } }).viewport.columns : WIDTH_FALLBACK
      const vars = buildVars(S.snap, S.extra, view)
      // З9 is open: PromptHint takes one line until measured — the first line
      // draws, the rest go to the diagnostics aloud
      const all = drawLines(vars, S.cfg.tpl, view, width, 1)
      if (S.cfg.tpl.lines.length > 1) diag('fail', 'hint-lines', 'placement=hint: ' + (S.cfg.tpl.lines.length - 1) + ' line(s) beyond the first not drawn (З9)')
      if (all.length === 0) return next(e)
      const table = (await $.ui.resolve(e)) as unknown as Table
      const detail = (id: string): string => detailOf(id, vars)
      const bar = buildBarTree(all, view, width, table, view.details === 'hover', detail) as { props?: Record<string, unknown>; children?: unknown[] }
      const children: unknown[] = [bar]
      const hint = typeof e.props.hint === 'string' ? e.props.hint.trim() : ''
      if (hint) children.push(table.Box({ flexShrink: 1, children: [table.Text({ children: ['  ' + hint], dimColor: true, wrap: 'truncate' })] }))
      return table.Box({ flexDirection: 'row', children }) as Awaited<ReturnType<typeof next>>
    })
  } catch (x) {
    subFail('ui.render:PromptHint', x)
  }

  // The picker pane: pills by lines, the available list, the view tab, the
  // preview and the save/cancel/default/undo buttons (SPEC §14.6).
  try {
    on('ui.render', { component: 'Pane' }, async ($, e, next) => {
      if ((e as { requestId?: string }).requestId !== PANE_ID) return next(e)
      ensureRestore($)
      if (S.pickerOpen !== true) return next(e)
      const surface = (e as { surface?: string }).surface
      const table = (await $.ui.resolve(e)) as unknown as Table & { Button: (props: Record<string, unknown>) => unknown; Select: (props: Record<string, unknown>) => unknown; Input: (props: Record<string, unknown>) => unknown }
      const bodyColumns = typeof e.props.bodyColumns === 'number' && e.props.bodyColumns > 0 ? e.props.bodyColumns : 80
      if (surface !== 'terminal' && surface !== 'desktop') {
        return table.Box({
          flexDirection: 'column',
          children: [
            table.Text({ children: ['Open /statusline-mod in the terminal or the desktop to use the picker. Edit the fields through /config (catalyst-statusline.*) on this surface.'] }),
            table.Button({ key: 'close', label: 'Close', onPress: () => act($, () => closePicker($)) }),
          ],
        }) as Awaited<ReturnType<typeof next>>
      }
      if (!S.draft) S.draft = freshDraft()
      const draft = S.draft
      const view = resolveView(draft.axes, S.userThemes).view
      const rows: unknown[] = []

      // Вид: theme + axes
      const themeNames = [...Object.keys(THEMES), ...Object.keys(S.userThemes)]
      rows.push(
        table.Select({
          key: 'theme',
          label: 'Тема',
          value: draft.axes['theme'] ?? 'default',
          options: themeNames.map((n) => ({ value: n, label: n })),
          onSelect: (value: string) => {
            act($, async () => {
              draft.axes['theme'] = value
              await persistDraft($)
              invalidate($)
            })
          },
        }),
      )
      // Pinned axes take no 'theme' value: their options are the spec's own (§14.5.1)
      for (const axis of ['placement', 'details', 'numbers', 'model_label']) {
        const opts = PINNED_OPTIONS[axis] ?? []
        rows.push(
          table.Select({
            key: 'axis:' + axis,
            label: axis,
            value: draft.axes[axis] ?? PINNED_AXES[axis]!,
            options: opts.map((v) => ({ value: v, label: v })),
            onSelect: (value: string) => {
              act($, async () => {
                draft.axes[axis] = value
                await persistDraft($)
                invalidate($)
              })
            },
          }),
        )
      }
      for (const axis of ['shape', 'caps', 'glyphs', 'fill', 'bar', 'barWidth', 'palette', 'border', 'overflow']) {
        const opts = AXIS_OPTIONS[axis] ?? []
        rows.push(
          table.Select({
            key: 'axis:' + axis,
            label: axis,
            value: draft.axes[axis] ?? 'theme',
            options: [{ value: 'theme', label: '(как в теме)' }, ...opts.map((v) => ({ value: v, label: v }))],
            onSelect: (value: string) => {
              act($, async () => {
                draft.axes[axis] = value
                await persistDraft($)
                invalidate($)
              })
            },
          }),
        )
      }
      rows.push(
        table.Input({
          key: 'theme-name',
          label: 'Имя темы',
          placeholder: 'имя для «Сохранить как тему»',
          value: S.themeNameInput,
          onInput: (value: string) => {
            S.themeNameInput = value
          },
          onSubmit: (value: string) => {
            S.themeNameInput = value
          },
        }),
        table.Button({ key: 'theme-save', label: 'Сохранить как тему', onPress: () => act($, () => saveUserTheme($, S.themeNameInput)) }),
        table.Button({ key: 'theme-delete', label: 'Удалить тему', onPress: () => act($, () => deleteUserTheme($, draft.axes['theme'] ?? '')) }),
      )
      if (S.themeNote) rows.push(table.Text({ key: 'theme-note', children: [S.themeNote], dimColor: true, wrap: 'truncate' }))

      // Раскладка: a row of pills per line
      const vars = buildVars(S.snap, S.extra, view)
      draft.lines.forEach((line, li) => {
        const pills: unknown[] = line.map((seg, si) => {
          const focused = draft.focus && draft.focus.line === li && draft.focus.seg === si
          const sample = renderSeg(seg.body, vars)
          return table.Button({
            key: segmentKey(seg.id),
            label: (focused ? '· ' : '') + seg.id + (sample ? ' ' + sample.text.slice(0, 18) : ''),
            plain: true,
            onPress: () => {
              act($, async () => {
                draft.focus = { line: li, seg: si }
                await persistDraft($)
                invalidate($)
              })
            },
          })
        })
        pills.push(table.Button({ key: 'line:' + li + ':del', label: '✕ строка', plain: true, onPress: () => act($, async () => { delLine(li); await persistDraft($); invalidate($) }) }))
        rows.push(table.Box({ key: 'line:' + li, flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, children: pills }))
      })
      rows.push(
        table.Button({
          key: 'line:add',
          label: '+ строка (max ' + S.lastMaxRows + ')',
          plain: true,
          onPress: () => {
            act($, async () => {
              const refused = addLine()
              if (refused) S.saveResult = refused
              await persistDraft($)
              invalidate($)
            })
          },
        }),
      )

      // Действия над выбранной пилюлей
      const moves: [string, string, string, MoveDir][] = [
        ['mv:left', '◀', 'h', 'left'],
        ['mv:right', '▶', 'l', 'right'],
        ['mv:up', '▲', 'k', 'up'],
        ['mv:down', '▼', 'j', 'down'],
        ['mv:out', '✕', 'x', 'out'],
      ]
      rows.push(
        table.Box({
          key: 'moves',
          flexDirection: 'row',
          columnGap: 1,
          children: moves.map(([key, glyph, hotkey, dir]) =>
            table.Button({
              key,
              label: glyph,
              hotkey,
              plain: true,
              onPress: () => {
                act($, async () => {
                  movePill(dir)
                  await persistDraft($)
                  await keepFocus($, (e as { requestId?: string }).requestId ?? PANE_ID)
                })
              },
            }),
          ),
        }),
      )

      // Цвет выбранной пилюли — если ей можно
      const focusEntry = focusSegId() ? REGISTRY.find((r) => r.id === focusSegId()) : undefined
      if (focusEntry) {
        if (focusEntry.colorable) {
          const opts = ['red', 'green', 'yellow', 'magenta', 'white', 'blue', 'cyan']
          rows.push(
            table.Select({
              key: 'seg-color',
              label: 'цвет ' + focusEntry.id,
              value: view.segColors[focusEntry.id] ?? '',
              options: [{ value: '', label: '(по палитре)' }, ...opts.map((c) => ({ value: c, label: c }))],
              onSelect: (value: string) => {
                act($, async () => {
                  const parts = Object.entries({ ...view.segColors, ...(value ? { [focusEntry.id]: value } : { [focusEntry.id]: '' }) }).filter(([, v]) => v !== '').map(([id, v]) => id + '=' + v)
                  draft.axes['segmentColors'] = parts.join(';')
                  await persistDraft($)
                  invalidate($)
                })
              },
            }),
          )
        } else {
          // threshold scale: no colour is offered and the panel says why (tooth 24)
          rows.push(table.Text({ key: 'seg-color', children: ['цвет ' + focusEntry.id + ': не предлагается — цвет несёт пороговая шкала'], dimColor: true, wrap: 'truncate' }))
        }
      }

      // Доступные: every registry segment, unavailable ones with their state
      const placed = new Set(draft.lines.flat().map((seg) => seg.id))
      const q = S.draftQuery.toLowerCase()
      const available = REGISTRY.filter((r) => !placed.has(r.id) && (q === '' || r.id.includes(q) || r.label.toLowerCase().includes(q) || r.about.toLowerCase().includes(q)))
      const availChildren: unknown[] = []
      for (const entry of available.slice(0, 12)) {
        if (entry.state === 'open') {
          availChildren.push(table.Text({ key: 'unavailable:' + entry.id, children: [entry.label + ' — ' + (entry.reason ?? 'недоступно')], dimColor: true, wrap: 'truncate' }))
        } else {
          availChildren.push(
            table.Button({
              key: 'add:' + entry.id,
              label: entry.label,
              plain: true,
              onPress: () => {
                act($, async () => {
                  addSegment(entry.id)
                  await persistDraft($)
                  await keepFocus($, (e as { requestId?: string }).requestId ?? PANE_ID)
                })
              },
            }),
          )
        }
      }
      rows.push(
        table.Input({
          key: 'filter',
          label: 'Доступные',
          placeholder: 'фильтр по имени',
          value: S.draftQuery,
          onInput: (value: string) => {
            S.draftQuery = value
            invalidate($)
          },
          onSubmit: (value: string) => {
            S.draftQuery = value
            invalidate($)
          },
        }),
        table.Box({ key: 'available', flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, children: availChildren }),
      )

      // Пресеты раскладки: пишут черновик, не опции (SPEC §14.12)
      rows.push(
        table.Select({
          key: 'preset',
          label: 'Пресет',
          value: '',
          options: [
            { value: 'default', label: 'дефолт мода' },
            { value: 'ClaudeCodeStatusline', label: 'ClaudeCodeStatusline' },
            { value: 'claude-hud', label: 'claude-hud' },
          ],
          onSelect: (value: string) => {
            act($, async () => {
              draft.lines = presetLines(value).map((line) => line.map((seg) => ({ ...seg })))
              draft.focus = null
              await persistDraft($)
              invalidate($)
            })
          },
        }),
      )

      // Превью: ТЕМ ЖЕ рендером, что и полоса — те же параметры, то же дерево;
      // отказ превью держит Сохранить (SPEC §14.10, §14.8 teeth 21/25)
      const blockReason = saveBlockReason(draft)
      if (blockReason) {
        rows.push(table.Text({ key: 'preview-failed', children: ['Превью отказано: ' + blockReason], wrap: 'truncate' }))
      } else {
        const previewLines = drawLines(vars, { lines: draft.lines, sep: view.separator, evict: S.cfg.tpl.evict }, view, bodyColumns, S.lastMaxRows)
        const detail = (id: string): string => detailOf(id, vars)
        rows.push(buildBarTree(previewLines, view, bodyColumns, table, view.details === 'hover', detail))
      }

      if (S.saveResult) rows.push(table.Text({ key: 'notice', children: [S.saveResult], wrap: 'truncate' }))
      if (S.saving) rows.push(table.Text({ key: 'saving', children: ['сохранение в полёте: ' + S.saving.fields.join(', ')], dimColor: true, wrap: 'truncate' }))

      rows.push(
        table.Box({
          key: 'actions',
          flexDirection: 'row',
          columnGap: 1,
          children: [
            table.Button({ key: 'save', label: 'Сохранить', onPress: () => act($, () => saveDraft($)) }),
            table.Button({ key: 'cancel', label: 'Отмена', onPress: () => act($, () => closePicker($)) }),
            table.Button({ key: 'defaults', label: 'По умолчанию', onPress: () => act($, async () => { S.draft = freshDraftDefaults(); await persistDraft($); invalidate($) }) }),
            table.Button({ key: 'undo', label: 'Отменить', onPress: () => act($, () => undoSave($)) }),
          ],
        }),
      )
      return table.Box({ flexDirection: 'column', children: rows }) as Awaited<ReturnType<typeof next>>
    })
  } catch (x) {
    subFail('ui.render:Pane', x)
  }
}

function freshDraftDefaults(): { lines: Seg[][]; axes: Record<string, string>; focus: { line: number; seg: number } | null } {
  const axes: Record<string, string> = {}
  for (const axis of ALL_AXES) axes[axis] = axis in PINNED_AXES ? (PINNED_AXES[axis] ?? '') : axis === 'separator' || axis === 'thresholds' || axis === 'face' ? '' : 'theme'
  axes['theme'] = 'default'
  axes['template'] = ''
  axes['evictOrder'] = ''
  axes['segmentColors'] = ''
  return { lines: defaultTemplateLines(), axes, focus: null }
}

// ---------- stand surface (the report's mutation runs read these) ----------

// The minimal node table the stand renders with: the same {type, props, children}
// shape the surface's own table answers, so tree walkers see one form.
const STAND_TABLE: Table = {
  Box: (props) => ({ type: 'Box', props, children: props['children'] }),
  Text: (props) => ({ type: 'Text', props, children: props['children'] }),
}

// The settings path as one call: the same applyOptions register() runs, then
// the same vars, lines and tree the render hooks build. CONSTRAINT: the kit
// loads the folder plugin once with its manifest defaults, and an inline
// plugin carries neither options nor closures (the kit's Plugin type), so
// option-dependent drawing runs through this stand, not a second mount.
export function __render(raw: Record<string, string>, snap: Snap | null, width = 140, maxRows = 8): unknown {
  applyOptions(raw)
  const view = S.cfg.view
  const vars = buildVars(snap, S.extra, view)
  const lines = drawLines(vars, S.cfg.tpl, view, width, maxRows)
  const detail = (id: string): string => detailOf(id, vars)
  return buildBarTree(lines, view, width, STAND_TABLE, view.details === 'hover', detail)
}

export function __diag(): Diag[] {
  return S.diag
}

export function __state(): { view: View; tpl: Tpl; themeName: string; rawOptions: Record<string, string>; maxRows: number } {
  return { view: S.cfg.view, tpl: S.cfg.tpl, themeName: S.cfg.themeName, rawOptions: S.cfg.rawOptions, maxRows: S.lastMaxRows }
}
