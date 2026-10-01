import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import * as SL from '../hooks/statusline'

const seam = SL as unknown as { __cmpRead: (a: unknown, b: unknown) => number }

// The world beneath the plugin: the nouns the bar reads plus what the command
// and the panel touch. The 0.5 core runs read-only commands (git, version,
// vm_stat) and file reads (settings.json, CLAUDE.md) through the same noun
// events; the mocks answer those. Nothing beneath the plugins answers
// ui.render or prompt.submit; the answers here stand in for the engine's own
// drawing and the prompt.

export const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
export const VIEWPORT = { columns: 140, rows: 40, isFullscreen: true }
export const MOUNT = { plugin: 'catalyst-statusline', surface: 'terminal' as const, component: 'PromptHint' as const, props: HINT, requestId: 'PromptHint', viewport: VIEWPORT }
export const BAND_ID = 'above-prompt'
export const BAND = { hasSurvey: false, isWorking: false, maxRows: 29, bodyColumns: 140, scroll: { offset: 0, bodyRows: 29 }, view: {} }
export const BAND_MOUNT = { plugin: 'catalyst-statusline', surface: 'terminal' as const, component: 'AbovePrompt' as const, props: BAND, requestId: BAND_ID }
export const PANE_ID = 'statusline'
export const PANE = { title: 'Статус-строка', isFocused: true, bodyColumns: 120, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
export const PANE_MOUNT = { plugin: 'catalyst-statusline', surface: 'terminal' as const, component: 'Pane' as const, props: PANE, requestId: PANE_ID }

export const STORE_OPEN = 'statusline.open.v1'
export const STORE_OPEN_CLOSED = 'statusline.open-closed.v1'
export const STORE_OPEN_CLOSED_V2 = 'statusline.open-closed.v2'
export const STORE_EPOCH = 'statusline.epoch.v1'
export const STORE_DRAFT = 'statusline.draft.v1'
export const STORE_SAVING = 'statusline.saving.v1'
export const STORE_UNDO = 'statusline.undo.v1'
export const STORE_LASTGOOD = 'statusline.lastgood.v1'
export const STORE_THEMES = 'statusline.themes.v1'

// #551 the publications of this version: `<ns>[.<fnv64(session)>]:<writerId>:<seq16>`
export const NS_OPEN = 'statusline.open.v3'
export const NS_MARK = 'statusline.open-closed.v3'
export const NS_EPOCH = 'statusline.epoch.v3'
export const NS_DRAFT = 'statusline.draft.v3'
export const NS_SAVING = 'statusline.saving.v3'
export const NS_UNDO = 'statusline.undo.v3'
export const NS_SESS = 'statusline.sess.v3'
// a writer that is not the module under test
export const EXT_WRITER = '00000000-0000-4000-8000-00000000e551'
export const fnv64 = (text: string): string => {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i++) hash = ((hash ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n) & 0xffffffffffffffffn
  return hash.toString(16).padStart(16, '0')
}
export const pad16 = (n: number): string => String(n).padStart(16, '0')
export const v3Key = (ns: string, session: string | undefined, writer: string, seq: number): string =>
  ns + (session !== undefined ? '.' + fnv64(session) : '') + ':' + writer + ':' + pad16(seq)
// every publication of `ns`; with `session`, only that session's digest segment
export const v3Keys = (persisted: Map<string, unknown>, ns: string, session?: string): string[] =>
  [...persisted.keys()].filter((k) => (session !== undefined ? k.startsWith(ns + '.' + fnv64(session) + ':') : k.startsWith(ns + ':') || k.startsWith(ns + '.')))
const canonJson = (value: unknown): string => {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canon((v as Record<string, unknown>)[k])
      return out
    }
    return v
  }
  return JSON.stringify(canon(value))
}
const legacyId = (tag: string, value: unknown): string => 'legacy-' + tag + '-' + fnv64(canonJson(value))

// CONSTRAINT (#521 FIX4 Ф2/Ф3, #551 §4): the helpers read the previous
// version's keys and this version's publications together, a publication's
// session from its value — an assert on them sees what the module wrote
type Store = Map<string, unknown>
const keyed = (persisted: Store, base: string): string[] => [...persisted.keys()].filter((k) => k.startsWith(base + ':'))
type FlagValue = { session?: string; token?: string; openId?: string; t?: number; e?: number; n?: number; at?: number }
export const openFlags = (persisted: Store): FlagValue[] =>
  [...keyed(persisted, STORE_OPEN), ...v3Keys(persisted, NS_OPEN)].map((k) => persisted.get(k) as FlagValue)
// the keys of the flags of `session`, both forms
export const flagKeys = (persisted: Store, session?: string): string[] =>
  [...keyed(persisted, STORE_OPEN), ...v3Keys(persisted, NS_OPEN)].filter((k) => session === undefined || (persisted.get(k) as FlagValue | undefined)?.session === session)
// CONSTRAINT (#521 FIX8b Р1, #551 FIX9 Р3): a close mark of the 0.5.1 form
// lives under `<STORE_OPEN_CLOSED>:<session>` as `{t}`, one of FIX9 under
// `<STORE_OPEN_CLOSED_V2>:<session>:<e>:<n>` and one of #551 under NS_MARK, both
// `{session, e, n, at}`; the session of every mark, sorted — a session twice has two marks
export const closedMarks = (persisted: Store): string[] =>
  [
    ...keyed(persisted, STORE_OPEN_CLOSED).map((k) => k.slice(STORE_OPEN_CLOSED.length + 1)),
    ...keyed(persisted, STORE_OPEN_CLOSED_V2).map((k) => String((persisted.get(k) as { session?: unknown } | undefined)?.session)),
    ...v3Keys(persisted, NS_MARK).map((k) => String((persisted.get(k) as { session?: unknown } | undefined)?.session)),
  ].sort()
// the keys of the marks of `session`, every form
export const markKeys = (persisted: Store, session: string): string[] =>
  [
    ...keyed(persisted, STORE_OPEN_CLOSED).filter((k) => k === STORE_OPEN_CLOSED + ':' + session),
    ...[...keyed(persisted, STORE_OPEN_CLOSED_V2), ...v3Keys(persisted, NS_MARK)].filter((k) => (persisted.get(k) as { session?: unknown } | undefined)?.session === session),
  ]
// the epochs every epoch record holds, both forms, ascending
export const epochs = (persisted: Store): unknown[] =>
  [...(persisted.has(STORE_EPOCH) ? [STORE_EPOCH] : []), ...v3Keys(persisted, NS_EPOCH)]
    .map((k) => (persisted.get(k) as { e?: unknown } | undefined)?.e)
    .sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : 1))
// the newest draft of `session`: by t, then this version over the keyed form over the bare slot, then by key
export const draftOf = (persisted: Store, session: string): Record<string, unknown> | undefined => {
  const cands: Array<{ t: number; rank: number; key: string; value: Record<string, unknown> }> = []
  for (const k of v3Keys(persisted, NS_DRAFT, session)) {
    const v = persisted.get(k) as Record<string, unknown> | undefined
    if (v && v['session'] === session) cands.push({ t: typeof v['t'] === 'number' ? (v['t'] as number) : -Infinity, rank: 2, key: k, value: v })
  }
  const kv = persisted.get(STORE_DRAFT + ':' + session) as Record<string, unknown> | undefined
  if (kv && typeof kv === 'object' && kv['session'] === session) cands.push({ t: typeof kv['t'] === 'number' ? (kv['t'] as number) : -Infinity, rank: 1, key: STORE_DRAFT + ':' + session, value: kv })
  const slot = persisted.get(STORE_DRAFT) as Record<string, unknown> | undefined
  if (slot && typeof slot === 'object' && slot['session'] === session) cands.push({ t: typeof slot['t'] === 'number' ? (slot['t'] as number) : -Infinity, rank: 0, key: STORE_DRAFT, value: slot })
  cands.sort((a, b) => (a.t !== b.t ? (a.t < b.t ? -1 : 1) : a.rank !== b.rank ? a.rank - b.rank : a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return cands[cands.length - 1]?.value
}
// the draft keys of `session`, every form
export const draftKeys = (persisted: Store, session: string): string[] =>
  [...v3Keys(persisted, NS_DRAFT, session), ...(persisted.has(STORE_DRAFT + ':' + session) ? [STORE_DRAFT + ':' + session] : [])]
// CONSTRAINT (#551 AR-2): the clock window and read order belong to the module, not a test-side clock model.
export const sessValue = (persisted: Store, session: string): Record<string, any> | undefined => {
  let best: Record<string, any> | undefined
  const keys = [...v3Keys(persisted, NS_SESS, session).filter((k) => (persisted.get(k) as { session?: unknown } | undefined)?.session === session), ...(persisted.has('sess:' + session) ? ['sess:' + session] : [])]
  for (const k of keys) {
    const v = persisted.get(k) as Record<string, any>
    if (best === undefined || seam.__cmpRead(v, best) > 0) best = v
  }
  return best
}
// the snapshot keys of `session`, both forms
export const sessKeys = (persisted: Store, session: string): string[] =>
  [...v3Keys(persisted, NS_SESS, session), ...(persisted.has('sess:' + session) ? ['sess:' + session] : [])]
// another process's hand on the snapshots of `session`: every key of them
// gone, and a value put back under the previous version's key — the only
// regression a publication of this version can meet (#551 §3.10)
export const dropSess = (persisted: Store, session: string): void => {
  for (const k of sessKeys(persisted, session)) persisted.delete(k)
}
export const regressSess = (persisted: Store, session: string, value: unknown): void => {
  dropSess(persisted, session)
  persisted.set('sess:' + session, value)
}
// true: `k` is a snapshot key of `session`, either form
export const isSessKey = (k: string, session?: string): boolean =>
  session === undefined ? k.startsWith('sess:') || k.startsWith(NS_SESS + '.') : k === 'sess:' + session || k.startsWith(NS_SESS + '.' + fnv64(session) + ':')
// CONSTRAINT (#551 FIX9c Р2): another process acts between the calls of a
// restore — `before` runs ahead of every call of the stand store and may change
// the map under it
type StoreCalls = {
  get: (k: string) => Promise<unknown>
  set: (k: string, v: unknown) => Promise<void>
  delete: (k: string) => Promise<void>
  keys: () => Promise<string[]>
}
export const interleaved = <T extends StoreCalls>(store: T, before: (call: 'get' | 'set' | 'delete' | 'keys', key: string) => void): T => ({
  ...store,
  get: async (k: string) => {
    before('get', k)
    return store.get(k)
  },
  set: async (k: string, v: unknown) => {
    before('set', k)
    return store.set(k, v)
  },
  delete: async (k: string) => {
    before('delete', k)
    return store.delete(k)
  },
  keys: async () => {
    before('keys', '')
    return store.keys()
  },
})
export const isOpen = (persisted: Store, session?: string): boolean => openFlags(persisted).some((f) => session === undefined || f?.session === session)
export type UndoRecord = { saveId?: string; t?: number; fields: string[]; prev: Record<string, string>; written: Record<string, string> }
// CONSTRAINT (#551 §3.8): the undo records as the module reads them — per
// saveId the revision with the greatest (at, key) stands, one with `src` is a
// tombstone and hides the saveId; a revision hides the keyed and bare records
// of the previous version with its saveId, a keyed one the bare one
export const undoStack = (persisted: Store): UndoRecord[] => {
  const revs = new Map<string, { at: number; key: string; value: Record<string, unknown> }>()
  for (const k of v3Keys(persisted, NS_UNDO)) {
    const v = persisted.get(k) as Record<string, unknown> | undefined
    if (!v || typeof v['saveId'] !== 'string') continue
    const at = typeof v['at'] === 'number' ? (v['at'] as number) : -Infinity
    const cur = revs.get(v['saveId'] as string)
    if (!cur || at > cur.at || (at === cur.at && k > cur.key)) revs.set(v['saveId'] as string, { at, key: k, value: v })
  }
  const out: UndoRecord[] = []
  for (const { value } of revs.values()) if (typeof value['src'] !== 'string') out.push(value as unknown as UndoRecord)
  const keyedIds = new Set<string>()
  for (const k of keyed(persisted, STORE_UNDO)) {
    const id = k.slice(STORE_UNDO.length + 1)
    keyedIds.add(id)
    if (!revs.has(id)) out.push(persisted.get(k) as UndoRecord)
  }
  const bare = persisted.get(STORE_UNDO)
  if (Array.isArray(bare)) {
    const seen = new Map<string, number>()
    bare.forEach((e, i) => {
      if (!e || typeof e !== 'object') return
      const r = e as Record<string, unknown>
      let saveId: string
      if (typeof r['saveId'] === 'string' && r['saveId'] !== '') saveId = r['saveId'] as string
      else {
        const base = legacyId('undo', e)
        const k = (seen.get(base) ?? 0) + 1
        seen.set(base, k)
        saveId = base + '-' + String(k)
      }
      if (revs.has(saveId) || keyedIds.has(saveId)) return
      out.push({ saveId, t: i - bare.length, fields: Array.isArray(r['fields']) ? (r['fields'] as string[]) : [], prev: (r['prev'] ?? {}) as Record<string, string>, written: (r['written'] ?? {}) as Record<string, string> })
    })
  }
  return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0) || (String(a.saveId ?? '') < String(b.saveId ?? '') ? -1 : String(a.saveId ?? '') > String(b.saveId ?? '') ? 1 : 0))
}
// CONSTRAINT (Q9, R2-7): readMarks owns schema and object validity through
// __saveMarkReadable; only valid done records with the full source triple hide legacy marks.
export const saveMarks = (persisted: Store): Array<{ saveId?: string; t?: number; fields?: string[]; values?: Record<string, string> }> => {
  const out: Array<{ saveId?: string; t?: number; fields?: string[]; values?: Record<string, string> }> = []
  const done = new Map<string, Array<{ saveId: unknown; t: unknown }>>()
  const hidden = (key: string, saveId: string, t: number): boolean =>
    (done.get(key) ?? []).some((d) => d.saveId === saveId && d.t === t)
  for (const k of v3Keys(persisted, NS_SAVING)) {
    const v = persisted.get(k)
    if (!SL.__saveMarkReadable(k, v)) continue
    if (v['done'] === true) done.set(v['src'] as string, [...(done.get(v['src'] as string) ?? []), { saveId: v['srcSaveId'], t: v['srcT'] }])
    else out.push(v as { saveId?: string })
  }
  const keyedIds = new Set<string>()
  for (const k of keyed(persisted, STORE_SAVING)) {
    const v = persisted.get(k)
    if (!SL.__saveMarkReadable(k, v)) continue
    const saveId = k.slice(STORE_SAVING.length + 1)
    keyedIds.add(saveId)
    if (!hidden(k, saveId, typeof v['t'] === 'number' ? v['t'] : 0)) out.push(v as { saveId?: string })
  }
  const bare = persisted.get(STORE_SAVING)
  if (SL.__saveMarkReadable(STORE_SAVING, bare)) {
    const m = bare as Record<string, unknown>
    const saveId = typeof m['saveId'] === 'string' && m['saveId'] !== '' ? (m['saveId'] as string) : legacyId('mark', bare)
    const srcT = typeof m['t'] === 'number' ? m['t'] : -0.5
    if (!hidden(STORE_SAVING, saveId, srcT) && !keyedIds.has(saveId)) out.push({ saveId, t: -0.5, fields: m['fields'] as string[], values: m['values'] as Record<string, string> })
  }
  return out
}
// CONSTRAINT (#521 FIX5 Ч4): a user theme lives under `<STORE_THEMES>:<id>` as `{name, …axes, t}`
export const themeRecords = (persisted: Store): Array<{ id: string; name?: string; t?: number } & Record<string, unknown>> =>
  keyed(persisted, STORE_THEMES).map((k) => ({ ...(persisted.get(k) as Record<string, unknown>), id: k.slice(STORE_THEMES.length + 1) }))

export const USAGE = {
  context: { tokens: 83000, window: 1000000, percent: 8 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 25, resetsAt: '2026-09-21T20:00:00Z' },
    { kind: 'seven_day', percentUsed: 61.5 },
  ],
  cost: { usd: 1.2345 },
}
export const REPO = { root: '/work/demo', remote: 'git@github.com:konsta95/demo.git', internal: false, name: 'demo' }
export const SESSION_ID = '4e1f0c9a-7b2d-4c58-9a36-d1e8f5b2c703'
// /home is rejected by the host fs check as a network location before hooks run.
export const HOME = '/work/tester'
const SETTINGS = JSON.stringify({ hooks: { PreToolUse: [{}], PostToolUse: [{}] }, outputStyle: 'default' })
const VM_STAT = [
  'Mach Virtual Memory Statistics: (page size of 4096 bytes)',
  'Pages active:                         2000000.',
  'Pages wired down:                     1000000.',
].join('\n')

export const OPTION_ROWS = [
  { key: 'catalyst-statusline.template', label: 'Template', kind: 'text', value: '', provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.separator', label: 'Separator', kind: 'text', value: '', provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.evictOrder', label: 'Evict', kind: 'text', value: '', provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.elements', label: 'Elements', kind: 'text', value: '', provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.theme', label: 'Theme', kind: 'choice', value: 'hud', options: ['hud'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.placement', label: 'Placement', kind: 'choice', value: 'above', options: ['above', 'hint'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.details', label: 'Details', kind: 'choice', value: 'hover', options: ['off', 'hover'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.shape', label: 'Shape', kind: 'choice', value: 'theme', options: ['theme', 'plain', 'lean', 'pill', 'powerline', 'classic'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.caps', label: 'Caps', kind: 'choice', value: 'theme', options: ['theme', 'none', 'round', 'arrow', 'unicode-round'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.glyphs', label: 'Glyphs', kind: 'choice', value: 'theme', options: ['theme', 'none', 'ascii', 'unicode', 'emoji', 'nerd'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.fill', label: 'Fill', kind: 'choice', value: 'theme', options: ['theme', 'none', 'segment', 'band', 'inverse'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.bar', label: 'Bar', kind: 'choice', value: 'theme', options: ['theme', 'blocks', 'parallelogram', 'ascii', 'shade', 'baseline', 'low-blocks', 'pie'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.barWidth', label: 'Bar width', kind: 'choice', value: 'theme', options: ['theme', 'adaptive'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.palette', label: 'Palette', kind: 'choice', value: 'theme', options: ['theme', 'semantic', 'mono', 'codex', 'claude-code'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.thresholds', label: 'Thresholds', kind: 'text', value: 'theme', provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.face', label: 'Face', kind: 'text', value: 'theme', provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.border', label: 'Border', kind: 'choice', value: 'theme', options: ['theme', 'none', 'single', 'double', 'round'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.align', label: 'Align', kind: 'choice', value: 'theme', options: ['theme', 'left', 'split', 'right', 'center'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.overflow', label: 'Overflow', kind: 'choice', value: 'theme', options: ['theme', 'evict', 'wrap'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.numTokens', label: 'Num tokens', kind: 'choice', value: 'compact', options: ['compact', 'raw', 'compact1', 'grouped'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.numPercent', label: 'Num percent', kind: 'choice', value: 'int', options: ['int', 'dec1', 'ratio'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.numUsd', label: 'Num usd', kind: 'choice', value: 'exact', options: ['exact', 'short', 'whole'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.numDuration', label: 'Num duration', kind: 'choice', value: 'hm', options: ['hm', 'dh', 'clock'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.numBytes', label: 'Num bytes', kind: 'choice', value: 'gb', options: ['gb', 'gib', 'mb'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.numRate', label: 'Num rate', kind: 'choice', value: 'tok', options: ['tok', 'plain'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
  { key: 'catalyst-statusline.model_label', label: 'Model label', kind: 'choice', value: 'raw', options: ['raw', 'display'], provider: { plugin: 'catalyst-statusline', tier: 'user' }, isLocked: false },
]

export type Mocks = Record<string, (...args: any[]) => unknown>

export type World = {
  clock: ReturnType<typeof mock.clock>
  persisted: Map<string, unknown>
  opened: unknown[]
  closed: unknown[]
  toasts: string[]
  writes: Array<{ key: string; value: unknown }>
  registered: string[]
  logs: string[]
  reads: string[]
  cmds: string[]
  statuses: Array<string | undefined>
}

export function world(on: On, over: Mocks = {}, store: Record<string, unknown> = {}): World {
  const clock = mock.clock(on)
  const persisted = new Map<string, unknown>(Object.entries(store))
  on('store.*', async ($, e, next) => {
    const result = await next(e)
    if (next.is('store.set', e)) persisted.set(e.key, JSON.parse(JSON.stringify(e.value)))
    if (next.is('store.delete', e)) persisted.delete(e.key)
    return result
  })
  mock.store(on, store)
  // CONSTRAINT (#521 Р12): /config rows answer what the world last wrote to
  // them, as the host's rows do — a static list makes every undo read as a
  // field changed behind the picker. A refused or denied write records nothing.
  // The kit takes one hook per event in this module: the record wraps the
  // config.set mock that stands (the world's own or a test's override).
  const configValues = new Map<string, unknown>()
  const opened: unknown[] = []
  const closed: unknown[] = []
  const toasts: string[] = []
  const writes: Array<{ key: string; value: unknown }> = []
  const registered: string[] = []
  const logs: string[] = []
  const reads: string[] = []
  const cmds: string[] = []
  const statuses: Array<string | undefined> = []
  const mocks: Mocks = {
    'session.cwd': () => ({ value: '/work/demo/src' }),
    'session.root': () => ({ value: '/work/demo' }),
    'session.repo': () => ({ value: REPO }),
    'session.model': () => ({ value: 'Fable 5.1' }),
    'session.id': () => ({ value: SESSION_ID }),
    'session.usage': () => ({ value: USAGE }),
    'session.turns': () => ({ value: 0 }),
    'session.messages': () => ({ value: [] }),
    'agent.list': () => ({ value: [] }),
    'tool.list': () => ({ value: [] }),
    'command.list': () => ({ value: [] }),
    'settings.read': () => ({ value: {} }),
    'env.get': (_$: any, e: any) => {
      if (e.name === 'HOME') return { value: HOME }
      if (e.name === 'CLAUDE_CODE_EXECPATH') return { value: '/fake/bin/2.1.280/claude' }
      return { value: undefined }
    },
    'session.start': (_$: any, e: any) => ({ cwd: e.cwd }),
    'turn.step': async function* (_$: any, e: any) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    },
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    'fs.read': (_$: any, e: any) => {
      reads.push(e.path)
      if (e.path === '/work/demo/CLAUDE.md') return { value: '# demo\n' }
      if (e.path === HOME + '/.claude/settings.json') return { value: SETTINGS }
      // absent files answer empty: a thrown mock would read as a failed hook
      // on the frame that happens to be drawing (measured in this wave)
      return { value: '' }
    },
    'fs.list': () => {
      throw new Error('ENOENT')
    },
    'fs.ancestors': () => {
      throw new Error('unsupported')
    },
    'process.run': (_$: any, e: any) => {
      const argv = (e.argv ?? []) as string[]
      const joined = argv.join(' ')
      cmds.push(joined)
      if (joined === 'git rev-parse --abbrev-ref HEAD') return { value: { code: 0, stdout: 'feature/hover\n', stderr: '' } }
      if (joined === 'git config --get remote.origin.url') return { value: { code: 0, stdout: 'git@github.com:konsta95/demo.git\n', stderr: '' } }
      if (joined === 'vm_stat' || joined === '/usr/bin/vm_stat') return { value: { code: 0, stdout: VM_STAT, stderr: '' } }
      if (joined === 'sysctl -n hw.memsize') return { value: { code: 0, stdout: '25769803776\n', stderr: '' } }
      if (joined === 'claude --version') return { value: { code: 0, stdout: '2.1.280 (tweakcc)\n', stderr: '' } }
      throw new Error('no process in the kit: ' + joined)
    },
    'config.list': () => ({ value: OPTION_ROWS.map((row) => (configValues.has(row.key) ? { ...row, value: configValues.get(row.key) } : { ...row })) }),
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
    'ui.status': (_$: any, e: any) => {
      statuses.push(e.text)
      return { value: undefined }
    },
    'ui.log': (_$: any, e: any) => {
      logs.push(String(e.text ?? e.line ?? ''))
      return { value: undefined }
    },
    'ui.focus': () => ({}),
    'ui.render': (_$: any, e: any) => ({ type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: ['ENGINE ' + e.component] }] }),
    'prompt.submit': (_$: any, e: any) => ({ text: e.text, origin: e.origin }),
    ...over,
  }
  const setMock = mocks['config.set']!
  // CONSTRAINT (#521 FIX2 Р18): an answer that carries a `deny` field, at the
  // top or under `value`, is a refusal whatever its value
  const denies = (x: unknown): boolean => !!x && typeof x === 'object' && 'deny' in x
  mocks['config.set'] = async (...args: any[]) => {
    const result = (await setMock(...args)) as { value?: unknown } | undefined
    const e = args[1] as { key: string; value: unknown }
    if (!denies(result) && !denies(result?.value)) configValues.set(e.key, e.value)
    return result
  }
  for (const [event, fn] of Object.entries(mocks)) on(event as any, fn as any)
  return { clock, persisted, opened, closed, toasts, writes, registered, logs, reads, cmds, statuses }
}

export const start = ($: any, isInteractive = true, surface: string | null = 'terminal') =>
  $.session.start({ surface, isInteractive, cwd: '/work/demo/src' })
export const command = ($: any, args = '') =>
  $.command.run({ command: 'statusline-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

export type Node = { type?: string; key?: string; label?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

export function walk(node: unknown, out: Node[] = []): Node[] {
  if (!node || typeof node !== 'object') return out
  const n = node as Node
  out.push(n)
  for (const child of n.children || []) walk(child, out)
  return out
}

export function textOf(node: Node): string {
  const kids = node.children || []
  if (kids.length > 0) {
    const fromKids = kids.map((c) => (typeof c === 'string' ? c : textOf(c as Node))).join('')
    if (fromKids !== '') return fromKids
  }
  const shown = (node as { text?: unknown }).text
  if (typeof shown === 'string' && shown !== '') return shown
  if (typeof node.label === 'string') return node.label
  const propLabel = node.props && typeof node.props['label'] === 'string' ? String(node.props['label']) : ''
  return propLabel
}

// The bar's Text pieces in drawing order: the ones that name a hover scope.
export function barText(nodes: Node[]): string {
  return nodes.filter((n) => n.type === 'Text' && typeof n.hover?.scope === 'string').map(textOf).join('')
}

// Without hover cards (details=off) the scope marker is gone: every Text of
// the first line row, in drawing order.
export function rowText(nodes: Node[]): string {
  return nodes.filter((n) => n.type === 'Text').map(textOf).join('')
}

export const SURFACES = ['terminal', 'desktop'] as const
