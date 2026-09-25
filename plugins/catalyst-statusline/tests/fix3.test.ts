import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data'
import { walk, STORE_THEMES, STORE_LASTGOOD, STORE_OPEN, STORE_DRAFT, STORE_SAVING, STORE_UNDO } from './world'

// Teeth for BRIEF-v0.5-S1-FIX3 (F3, F6, F7, F8, F-memo). Like picture.test.ts,
// these run against the imported module instance; the kit's loaded copy is not
// touched (fix2.test.ts header states the same split).

const drain = async (): Promise<void> => {
  for (let i = 0; i < 120; i++) await Promise.resolve()
}

const CAP_DIAG = 64 // CAP.diag in statusline.ts — the diag buffer depth

const storeOf = (entries: Record<string, unknown>) => ({
  get: async (k: string): Promise<unknown> => entries[k],
  set: async (): Promise<void> => undefined,
  delete: async (): Promise<void> => undefined,
})

const fullStand = () => ({
  clock: { now: async () => 5000, every: () => ({ cancel() {} }) },
  ui: { log: async () => undefined, invalidate: () => undefined, status: () => undefined, toast: () => undefined },
  store: storeOf({}),
  session: {
    id: async () => 'f6',
    cwd: async () => '/work/demo',
    root: async () => '/work/demo',
    usage: async () => ({ context: { tokens: 1, window: 2 }, rateLimits: [], cost: { usd: 0 } }),
    model: async () => 'm',
    turns: async () => 0,
    messages: async () => [],
  },
  env: { get: async (name: string) => (name === 'HOME' ? '/work/tester' : '') },
  fs: { read: async () => '' },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  config: { list: async () => [], set: async () => undefined },
})

// F3a: restore loads the stored themes BEFORE the first applyOptions, so a
// saved user theme is a valid `theme` value on the very first build.
test('F3a: a stored user theme reaches the band before its first build', async () => {
  SL.__resetState()
  const $ = {
    store: storeOf({ [STORE_THEMES]: { u1: { palette: 'mono' } } }),
    session: { id: async () => 'f3a' },
    ui: { log: async () => undefined, status: () => undefined },
  }
  try {
    await SL.restoreAfterReload($ as never, { template: 'dur||x=constant', theme: 'u1', palette: 'theme' } as never)
    expect(SL.__diag().some((d) => d.key === 'theme-unknown')).toBe(false)
    expect(SL.__state().themeName).toBe('u1')
    expect(SL.__state().view.paletteName).toBe('mono')
  } finally {
    SL.__resetState()
  }
})

// F3b: saveUserTheme reapplies the last raw options, so the theme saved under
// its own name takes effect in the next build without waiting for /config.
test('F3b: saving a theme in the picker reapplies the live options', async () => {
  SL.__resetState()
  try {
    SL.__pictureThemes({ u1: { palette: 'mono' } })
    SL.__render({ template: 'dur||x=constant', theme: 'u1', palette: 'theme' })
    expect(SL.__state().view.paletteName).toBe('mono')
    const nodes = walk(SL.__renderPicker({ template: 'dur||x=constant', theme: 'u1', palette: 'theme' }, 'view'))
    const byKey = (key: string) => nodes.find((n) => n.props?.['key'] === key)
    const axis = byKey('ax:palette:codex')
    expect(axis).toBeDefined()
    ;(axis!.props!['onPress'] as () => void)()
    const themeNodes = walk(SL.__renderPicker({ template: 'dur||x=constant', theme: 'u1', palette: 'theme' }, 'themes'))
    const tByKey = (key: string) => themeNodes.find((n) => n.props?.['key'] === key)
    const nameInput = tByKey('theme-name')
    expect(nameInput).toBeDefined()
    ;(nameInput!.props!['onInput'] as (v: string) => void)('u1')
    const save = tByKey('theme-save')
    expect(save).toBeDefined()
    ;(save!.props!['onPress'] as () => void)()
    await drain()
    expect(SL.__state().view.paletteName).toBe('codex')
  } finally {
    SL.__resetState()
  }
})

// F6: __resetState goes through freshState(), so NO field survives dirty —
// every dirtied field returns to its declaration-time value.
test('F6: __resetState returns the whole state to freshState values', async () => {
  SL.__resetState()
  const classicHandlers: Array<(eng: unknown, e: unknown, next: unknown) => Promise<unknown>> = []
  const on = (event: string, ...rest: unknown[]): void => {
    if (event === 'classic.SessionStart') classicHandlers.push(rest[rest.length - 1] as (typeof classicHandlers)[number])
  }
  try {
    // register is the only public writer of transcriptPath (its classic
    // handler); options carry a template so applyOptions dirties the picture.
    SL.register(on as never, { template: 'dur||x=constant' } as never)
    const stand = fullStand()
    await classicHandlers[0]!(stand, { transcript_path: '/t/f6.jsonl' }, async (e: unknown) => e)
    expect(SL.__stateSnapshot()['transcriptPath']).toBe('/t/f6.jsonl')
    await SL.__refresh(stand as never)
    await SL.__runEnvSources(stand as never)
    SL.__pictureThemes({ u9: { palette: 'mono' } })
    // CONSTRAINT (S1-FIX4 П.2): __render is the writer of the host truth now.
    SL.__render({ template: 'x={dur.text}' })
    const dirty = SL.__stateSnapshot()
    expect(dirty['userThemes']).not.toEqual({})
    expect(dirty['messagesDone']).toBe(true)
    expect(dirty['home']).toBe('/work/tester')
    expect(dirty['hostRaw']).not.toEqual({})
    SL.__resetState()
    const snap = SL.__stateSnapshot()
    expect(snap['userThemes']).toEqual({})
    expect(snap['messagesDone']).toBe(false)
    expect(snap['transcriptPath']).toBe('')
    expect(snap['home']).toBe('')
    expect(snap['hostRaw']).toEqual({})
  } finally {
    SL.__resetState()
  }
})

// F7: the refused-arm text is bounded by slice(0, 120) after the prefix.
test('F7: an arm-refusal diagnostic stays bounded', async () => {
  SL.__resetState()
  SL.__render({ template: 'dur||x=constant', numDuration: 'clock', details: 'off' })
  SL.__setArmEvery(() => {
    throw new Error('E'.repeat(500))
  })
  try {
    await SL.__syncSourceTimers({
      clock: { now: async () => 5000 },
      ui: { log: () => undefined, invalidate: () => undefined },
    } as never)
    const refused = SL.__diag().filter((d) => d.key.startsWith('timer-'))
    expect(refused.length).toBeGreaterThan(0)
    for (const d of refused) {
      expect(d.text.startsWith('clock.every(')).toBe(true)
      expect(d.text.length).toBeLessThanOrEqual(28 + 120)
    }
  } finally {
    SL.__resetState()
  }
})

// F8: shift() at the cap must pull diagLogged back with it, or the flush
// pointer walks past unshipped records and they never reach the debug log.
test('F8: overflowing the diag buffer drops shipped records, never unshipped ones', async () => {
  SL.__resetState()
  const logs: string[] = []
  const $ = {
    clock: { now: async () => 70000 },
    ui: { log: (t: string) => { logs.push(t) }, invalidate: () => undefined },
  }
  const clockRuns: Array<() => void> = []
  SL.__setArmEvery((ms: number, fn: () => void) => {
    if (ms === 1000) clockRuns.push(fn)
    return { cancel() {} }
  })
  try {
    // '||' parses to zero lines: applyOptions diagnoses it (failDiag) and the
    // hud preset applies. The first call also records the one-per-life
    // 'tpl-empty-line' warn — two records to ship before the overflow.
    SL.__render({ template: '||' })
    await SL.__syncSourceTimers($ as never)
    await drain()
    expect(logs.length).toBe(2)
    expect(clockRuns.length).toBeGreaterThan(0)
    // CAP_DIAG + 5 more without a flush: the two shipped records evict
    // silently, the five unshipped ones leave a trace (S1-FIX4 П.6) and the
    // remaining CAP_DIAG must ALL be delivered.
    // one template-fallback per template TEXT (S1-FIX5 П.4): each filler differs
    // by trailing blanks, so each render adds exactly one fail record
    for (let i = 0; i < CAP_DIAG + 5; i++) SL.__render({ template: '||' + ' '.repeat(i + 1) })
    for (const fn of clockRuns) fn()
    await drain()
    expect(logs.filter((t) => t.includes('dropped 5 unsent')).length).toBe(1)
    expect(logs.length).toBe(3 + CAP_DIAG)
    // a repeated flush sends nothing
    for (const fn of clockRuns) fn()
    await drain()
    expect(logs.length).toBe(3 + CAP_DIAG)
  } finally {
    SL.__resetState()
  }
})

// ---------- S1-FIX4 teeth (БРИФ-v0.5-S1-FIX4 П.1–П.3, П.5–П.7) ----------

type PickerStore = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

const recStore = (entries: Record<string, unknown>) => {
  const writes: Array<{ key: string; value: unknown }> = []
  return {
    get: async (k: string): Promise<unknown> => entries[k],
    set: async (k: string, v: unknown): Promise<void> => { writes.push({ key: k, value: v }) },
    delete: async (k: string): Promise<void> => { writes.push({ key: k, value: undefined }) },
    writes,
  }
}

// the last good record the stands below store: a valid hud config
const HUD_GOOD = { __raw: { template: 'dur||x=constant', theme: 'hud', palette: 'theme', placement: 'above', details: 'off' } }

const optStand = (store: PickerStore) => ({
  clock: { now: async () => 5000, every: () => ({ cancel() {} }) },
  ui: { log: async () => undefined, invalidate: () => undefined, status: () => undefined, toast: () => undefined },
  store,
  session: {
    id: async () => 'f4',
    cwd: async () => '/work/demo',
    root: async () => '/work/demo',
    usage: async () => ({ context: { tokens: 1, window: 2 }, rateLimits: [], cost: { usd: 0 } }),
    model: async () => 'm',
    turns: async () => 0,
    messages: async () => [],
  },
  env: { get: async (name: string) => (name === 'HOME' ? '/work/tester' : '') },
  fs: { read: async () => '' },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  config: { list: async () => [], set: async () => undefined },
  command: { register: async () => undefined },
  plugin: { name: 'catalyst-statusline', root: '/stand' },
})

const startHandlers = (): { on: (event: string, ...rest: unknown[]) => void; handlers: Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>> } => {
  const handlers: Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>> = {}
  const on = (event: string, ...rest: unknown[]): void => {
    handlers[event] = rest[rest.length - 1] as never
  }
  return { on, handlers }
}

// F3c (П.1, PROBE-A of CRITIC-v0.5-S1-FIX3-DISPATCH): the register build is
// provisional — a persisted user theme is neither a theme-unknown diagnosis
// nor a rollback reason; restore decides from its own build result.
test('F3c: register+session.start with a persisted user theme builds it without any breakage diagnosis', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const OPTS = { template: 'dur||x=constant', theme: 'u1', palette: 'theme', placement: 'above', details: 'off' }
  const store = recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: { u1: { palette: 'codex' } } })
  const $ = optStand(store)
  try {
    SL.register(on as never, OPTS as never)
    await handlers['session.start']!($ as never, { isInteractive: true } as never, async (e: unknown) => e)
    await drain()
    const state = SL.__state()
    expect(state.themeName).toBe('u1')
    expect(state.view.paletteName).toBe('codex')
    expect(state.rawOptions['theme']).toBe('u1')
    const keys = SL.__diag().map((d) => d.key)
    expect(keys.filter((k) => k === 'theme-unknown').length).toBe(0)
    expect(keys.filter((k) => k === 'lastgood-applied').length).toBe(0)
    // П.2: restore decides through applyDecided — the host truth and the used
    // lastGood are set there, not by a side effect of applyOptions.
    const snap = SL.__stateSnapshot()
    expect((snap['hostRaw'] as Record<string, string>)['theme']).toBe('u1')
    expect((snap['lastGood'] as Record<string, string>)['theme']).toBe('u1')
  } finally {
    SL.__resetState()
  }
})

// F3d (П.1+П.2): an unknown host theme with a stored lastGood rolls back; the
// host truth keeps the unknown name and the diagnosis pair is exact.
test('F3d: an unknown host theme rolls back to last good while rawOptions keeps it', async () => {
  SL.__resetState()
  const store = recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: { u1: { palette: 'codex' } } })
  const $ = optStand(store)
  try {
    await SL.restoreAfterReload($ as never, { template: 'dur||x=constant', theme: 'u2', palette: 'theme' } as never)
    expect(SL.__state().themeName).toBe('hud')
    const keys = SL.__diag().map((d) => d.key)
    expect(keys.filter((k) => k === 'lastgood-applied').length).toBe(1)
    expect(keys.filter((k) => k === 'theme-unknown').length).toBeGreaterThan(0)
    expect(SL.__state().rawOptions['theme']).toBe('u2')
  } finally {
    SL.__resetState()
  }
})

const pickerSaveTheme = (raw: Record<string, string>, name: string, store: PickerStore): Promise<void> => {
  const nodes = walk(SL.__renderPicker(raw, 'view', 120, undefined, store))
  const axis = nodes.find((n) => n.props?.['key'] === 'ax:palette:codex')
  expect(axis).toBeDefined()
  ;(axis!.props!['onPress'] as () => void)()
  const themeNodes = walk(SL.__renderPicker(raw, 'themes', 120, undefined, store))
  ;(themeNodes.find((n) => n.props?.['key'] === 'theme-name')!.props!['onInput'] as (v: string) => void)(name)
  ;(themeNodes.find((n) => n.props?.['key'] === 'theme-save')!.props!['onPress'] as () => void)()
  return drain()
}

// F3e (П.2+П.3): after the F3d rollback, saving the host's own theme name in
// the picker re-decides through applyDecided — the theme becomes valid and the
// host truth is stored as the new last good.
test('F3e: saving the host theme after a rollback re-decides and stores it as last good', async () => {
  SL.__resetState()
  const store = recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: { u1: { palette: 'codex' } } })
  const $ = optStand(store)
  const OPTS = { template: 'dur||x=constant', theme: 'u2', palette: 'theme', placement: 'above', details: 'off' }
  try {
    await SL.restoreAfterReload($ as never, OPTS as never)
    expect(SL.__state().themeName).toBe('hud')
    await pickerSaveTheme(OPTS, 'u2', store)
    expect(SL.__state().themeName).toBe('u2')
    expect(SL.__state().rawOptions['theme']).toBe('u2')
    const lastGoodWrite = store.writes!.find((w) => w.key === STORE_LASTGOOD)
    expect(lastGoodWrite).toBeDefined()
    expect((lastGoodWrite!.value as { __raw?: Record<string, string> }).__raw?.['theme']).toBe('u2')
  } finally {
    SL.__resetState()
  }
})

// F3f (П.2): after a template rollback, saving a FOREIGN theme re-decides from
// the host truth — the broken host template stays raw and the band stays on
// the last-good build (a bare applyOptions of the host raw would draw the default).
test('F3f: saving a foreign theme after a template rollback keeps the host template raw', async () => {
  SL.__resetState()
  const store = recStore({ [STORE_LASTGOOD]: HUD_GOOD })
  const $ = optStand(store)
  const OPTS = { template: '||', placement: 'above', details: 'off' }
  try {
    await SL.restoreAfterReload($ as never, OPTS as never)
    const tplBefore = SL.__state().tpl
    const themeNameBefore = SL.__state().themeName
    await pickerSaveTheme(OPTS, 'u9', store)
    expect(SL.__state().rawOptions['template']).toBe('||')
    expect(SL.__state().themeName).toBe(themeNameBefore)
    expect(SL.__state().tpl).toEqual(tplBefore)
  } finally {
    SL.__resetState()
  }
})

// F3g (П.2 step 5): a broken first config with no lastGood is never stored —
// the broken config must not become the last good one.
test('F3g: a broken config without lastGood is not stored as last good', async () => {
  SL.__resetState()
  const store = recStore({})
  const $ = optStand(store)
  try {
    await SL.restoreAfterReload($ as never, { template: '||', placement: 'above', details: 'off' } as never)
    expect(SL.__state().rawOptions['template']).toBe('||')
    expect(store.writes!.find((w) => w.key === STORE_LASTGOOD)).toBeUndefined()
  } finally {
    SL.__resetState()
  }
})

// F3h (П.3): a storage failure on save rolls the theme back unseen — the band
// never shows a theme that is not in storage.
test('F3h: a failing theme storage keeps the band on the previous theme', async () => {
  SL.__resetState()
  const store = recStore({})
  store.set = async (k: string): Promise<void> => {
    if (k === STORE_THEMES) throw new Error('read-only storage')
  }
  const $ = optStand(store)
  const OPTS = { template: 'dur||x=constant', theme: 'u9', placement: 'above', details: 'off' }
  try {
    SL.__render(OPTS)
    await pickerSaveTheme(OPTS, 'u9', store)
    expect(SL.__state().themeName).toBe('hud')
    expect(SL.__state().view.paletteName).not.toBe('codex')
    const userThemes = SL.__stateSnapshot()['userThemes'] as Record<string, unknown>
    expect(userThemes['u9']).toBe(undefined)
    expect(String(SL.__stateSnapshot()['themeNote']).startsWith('тема не сохранена')).toBe(true)
  } finally {
    SL.__resetState()
  }
})

// F6b (П.5): syncChain is state — a reset must start a fresh chain object.
test('F6b: __resetState starts a fresh sync chain', async () => {
  SL.__resetState()
  const $ = optStand(recStore({}))
  SL.__setArmEvery(() => ({ cancel() {} }))
  SL.__render({ template: 'dur||x=constant' })
  try {
    await SL.__syncSourceTimers($ as never)
    await drain()
    const before = SL.__stateSnapshot()['syncChain']
    expect(before).not.toBe(undefined)
    SL.__resetState()
    const after = SL.__stateSnapshot()['syncChain']
    // CONSTRAINT (S1-FIX4 П.5): the snapshot hands promise fields by reference
    // — the reset decision is on promise IDENTITY, not content.
    expect(after).not.toBe(before)
  } finally {
    SL.__resetState()
  }
})

// F8b (П.6): eviction of unshipped records is counted and shipped as ONE line.
test('F8b: overflowing the diag buffer while nothing is shipped reports the drop once', async () => {
  SL.__resetState()
  const logs: string[] = []
  const base = fullStand()
  const $ = {
    ...base,
    ui: { log: (t: string) => { logs.push(t) }, invalidate: () => undefined, status: () => undefined, toast: () => undefined },
  }
  try {
    // first __render of '||' records two entries (tpl-empty-line + template-
    // fallback, the F8 ground); every later one records exactly one fail.
    SL.__render({ template: '||' })
    // one template-fallback per template TEXT (S1-FIX5 П.4): each filler differs
    // by trailing blanks, so each render adds exactly one fail record
    for (let i = 0; i < CAP_DIAG + 1; i++) SL.__render({ template: '||' + ' '.repeat(i + 1) })
    expect(SL.__diag().length).toBe(CAP_DIAG)
    await SL.__refresh($ as never)
    const dropped = logs.filter((t) => t.includes('dropped 3 unsent'))
    expect(dropped.length).toBe(1)
    expect(dropped[0]!.startsWith('[statusline] fail: diag overflow dropped 3 unsent record(s)')).toBe(true)
    // then the whole surviving buffer ships: CAP records, nothing lost twice
    expect(logs.length).toBe(1 + CAP_DIAG)
  } finally {
    SL.__resetState()
  }
})

// F-dedup (П.7): a session source declared by several families is read ONCE
// per refresh and fed to every declaring family. The base feed shows in element
// values (the BRIEF form). For the other usage/info families the placed value is
// nosource-before-feed or needs events (activity a-compact needs turn.step,
// external x-wf-stage-cost needs project docs, repo r-instance is env-driven),
// so their feed is pinned on the state field the family reduce writes:
// usage.ts:212 usage[], activity.ts:573-574 usageStartedAt, repo.ts:459
// sessionInfo, external.ts:1212 sessionCost (ADJUDICATION REQUEST: the brief's
// "значение её элемента не pending" premise fails at these sites).
test('F-dedup: session sources shared across families are read once, fed to all', async () => {
  SL.__resetState()
  let usageReads = 0
  let cwdReads = 0
  const stand = fullStand()
  stand.session = {
    ...stand.session,
    usage: async () => { usageReads++; return { startedAt: 4242, context: { tokens: 145000, window: 200000, percent: 72.5 }, rateLimits: [], cost: { usd: 4.1 } } },
    cwd: async () => { cwdReads++; return '/work/demo' },
  }
  // one placed element per family declaring session:usage (base.ts:597,
  // activity.ts:1282, external.ts:1110, usage.ts:365) and per family declaring
  // session:info (base.ts:599, usage.ts:374, repo.ts:80 declared / :442 fed).
  SL.__render({ template: 'x={ctx.text}||c={cost.text}||b={brk.text}||a={a-compact.text}||w={x-wf-stage-cost.text}||g={u-ctx-growth.text}||d={directory.text}||t={u-transcript-path.text}||r={r-instance.text}' })
  const notPending = (id: string): boolean => SL.valueOf(id, undefined, {}, SL.buildNf({}))!.value.state !== 'pending'
  // FAMILIES order of data/index.ts:11-15: base, usage, activity, repo, external.
  const famStateOf = (i: number): Record<string, unknown> => {
    const pair = (SL.__stateSnapshot()['famStates'] as Array<[unknown, unknown]>).find((p) => p[0] === FAMILIES[i])
    return (pair ? pair[1] : {}) as Record<string, unknown>
  }
  try {
    expect(notPending('ctx')).toBe(false)
    expect(notPending('directory')).toBe(false)
    await SL.__refresh(stand as never)
    await drain()
    expect(usageReads).toBe(1)
    expect(cwdReads).toBe(1)
    expect(notPending('ctx')).toBe(true)
    expect(notPending('cost')).toBe(true)
    expect(notPending('directory')).toBe(true)
    expect((famStateOf(1)['usage'] as unknown[]).length).toBe(1)
    expect(famStateOf(2)['usageStartedAt']).toBe(4242)
    expect(famStateOf(3)['sessionInfo']).toBeDefined()
    expect((famStateOf(4)['sessionCost'] as { usd?: number } | null)?.usd).toBe(4.1)
  } finally {
    SL.__resetState()
  }
})

// F-memo: sourceKey's WeakMap must serve exactly the fresh canonical key.
test('F-memo: the memoized source key equals the fresh canonical key for every declared source', () => {
  SL.__resetState()
  for (const fam of FAMILIES) {
    for (const entry of fam.sources) {
      // first call may fill the memo, the second reads it back
      expect(SL.__sourceKeyMemoized(entry.source)).toBe(SL.__sourceKeyFresh(entry.source))
      expect(SL.__sourceKeyMemoized(entry.source)).toBe(SL.__sourceKeyFresh(entry.source))
    }
  }
})

// ---------- S1-FIX5 teeth (BRIEF-v0.5-S1-FIX5 T1–T12) ----------

// gated store: every get blocks until release() — the restore window T1–T3 probe
const gatedStore = (entries: Record<string, unknown>) => {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const writes: Array<{ key: string; value: unknown }> = []
  return {
    get: async (k: string): Promise<unknown> => { await gate; return entries[k] },
    set: async (k: string, v: unknown): Promise<void> => { writes.push({ key: k, value: v }) },
    delete: async (k: string): Promise<void> => { writes.push({ key: k, value: undefined }) },
    writes,
    release: () => release(),
  }
}

// the T1–T3 stand: optStand plus ui.open — openPicker reaches it after the restore wait
const interactiveStand = (store: PickerStore) => ({
  ...optStand(store),
  ui: { ...optStand(store).ui, open: async () => undefined },
})

// the T4/T5 store: the themes read refuses, everything else answers like recStore
const refusingThemesStore = () => {
  const writes: Array<{ key: string; value: unknown }> = []
  return {
    get: async (k: string): Promise<unknown> => {
      if (k === STORE_THEMES) throw new Error('io-themes')
      if (k === STORE_LASTGOOD) return HUD_GOOD
      return undefined
    },
    set: async (k: string, v: unknown): Promise<void> => { writes.push({ key: k, value: v }) },
    delete: async (k: string): Promise<void> => { writes.push({ key: k, value: undefined }) },
    writes,
  }
}

// T1 (П.1): a picker theme save queues behind the reload restore — no theme write before it ends
test('S1-FIX5 T1: the picker theme save waits for the restore', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const store = gatedStore({ [STORE_LASTGOOD]: HUD_GOOD })
  const $ = interactiveStand(store)
  try {
    SL.register(on as never, { template: '||', theme: 'hud', palette: 'theme', placement: 'above', details: 'off' } as never)
    const started = handlers['session.start']!($ as never, { isInteractive: true } as never, async (e: unknown) => e)
    await drain()
    await pickerSaveTheme({ template: '||', theme: 'hud', palette: 'theme' }, 'u9', store)
    expect(store.writes.filter((w) => w.key === STORE_THEMES).length).toBe(0)
    store.release()
    await started
    await drain()
    expect(store.writes.filter((w) => w.key === STORE_THEMES).length).toBe(1)
    expect(store.writes.filter((w) => w.key === STORE_LASTGOOD && JSON.stringify((w.value as { __raw?: unknown })?.__raw) === '{}').length).toBe(0)
  } finally {
    SL.__resetState()
  }
})

// T2 (П.1): the picker opens only after the reload restore decided from storage
test('S1-FIX5 T2: the picker opens only after the restore', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const store = gatedStore({ [STORE_LASTGOOD]: HUD_GOOD })
  const $ = interactiveStand(store)
  try {
    SL.register(on as never, { template: 'dur||x=constant', theme: 'hud', palette: 'theme', placement: 'above', details: 'off' } as never)
    const started = handlers['session.start']!($ as never, { isInteractive: true } as never, async (e: unknown) => e)
    await drain()
    const opened = handlers['command.run']!($ as never, { command: 'statusline-mod', args: '' } as never, async (e: unknown) => e)
    await drain()
    expect(SL.__stateSnapshot()['pickerOpen']).not.toBe(true)
    store.release()
    await started
    await opened
    await drain()
    expect(SL.__stateSnapshot()['pickerOpen']).toBe(true)
  } finally {
    SL.__resetState()
  }
})

// T3 (П.1): /statusline-mod reset acts only after the reload restore ended
test('S1-FIX5 T3: reset runs only after the restore', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const store = gatedStore({ [STORE_LASTGOOD]: HUD_GOOD })
  const sets: Array<{ key: string; value: unknown }> = []
  const mine = (field: string) => ({ key: 'catalyst-statusline.' + field, value: '', provider: { plugin: 'catalyst-statusline' } })
  const $ = { ...interactiveStand(store), config: { list: async () => [mine('template'), mine('details')], set: async (x: { key: string; value: unknown }) => { sets.push(x) } } }
  try {
    SL.register(on as never, { template: 'dur||x=constant', theme: 'hud', palette: 'theme', placement: 'above', details: 'off' } as never)
    const started = handlers['session.start']!($ as never, { isInteractive: true } as never, async (e: unknown) => e)
    await drain()
    const reset = handlers['command.run']!($ as never, { command: 'statusline-mod', args: 'reset' } as never, async (e: unknown) => e)
    await drain()
    expect(sets.length).toBe(0)
    store.release()
    await started
    await reset
    await drain()
    expect(sets.some((s) => s.key === 'catalyst-statusline.template' && s.value === '')).toBe(true)
  } finally {
    SL.__resetState()
  }
})

// T4 (П.2): a refused themes read names itself once and suppresses the unknown-theme decision
test('S1-FIX5 T4: a refused themes read is diagnosed and silently degrades', async () => {
  SL.__resetState()
  const store = refusingThemesStore()
  try {
    await SL.restoreAfterReload(optStand(store) as never, { template: 'dur||x=constant', theme: 'u1', palette: 'theme' } as never)
    const diag = SL.__diag()
    const read = diag.filter((d) => d.key === 'themes-read')
    expect(read.length).toBe(1)
    expect(read[0]!.text.includes('io-themes')).toBe(true)
    expect(diag.filter((d) => d.key === 'theme-unknown').length).toBe(0)
    expect(diag.filter((d) => d.key === 'lastgood-applied').length).toBe(0)
    expect(diag.filter((d) => d.key === 'lastgood-broken').length).toBe(0)
    expect(store.writes.filter((w) => w.key === STORE_LASTGOOD).length).toBe(0)
    expect(SL.__state().rawOptions['theme']).toBe('u1')
    expect(SL.__stateSnapshot()['themesFailed']).toBe(true)
  } finally {
    SL.__resetState()
  }
})

// T5 (П.2): a theme save must not overwrite stored themes that were never read
test('S1-FIX5 T5: a theme save refuses to overwrite unread stored themes', async () => {
  SL.__resetState()
  const store = refusingThemesStore()
  try {
    await SL.restoreAfterReload(optStand(store) as never, { template: 'dur||x=constant', theme: 'u1', palette: 'theme' } as never)
    await pickerSaveTheme({ template: 'dur||x=constant', theme: 'u1', palette: 'theme' }, 'u5', store)
    expect(store.writes.filter((w) => w.key === STORE_THEMES).length).toBe(0)
    expect(String(SL.__stateSnapshot()['themeNote']).startsWith('тема не сохранена: сохранённые темы не прочитаны')).toBe(true)
  } finally {
    SL.__resetState()
  }
})

// T6 (П.2): a later successful themes read clears the failed flag and the theme builds
test('S1-FIX5 T6: a successful themes read clears the failed flag', async () => {
  SL.__resetState()
  const store = refusingThemesStore()
  const OPTS = { template: 'dur||x=constant', theme: 'u1', palette: 'theme' }
  try {
    await SL.restoreAfterReload(optStand(store) as never, OPTS as never)
    await SL.restoreAfterReload(optStand(recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: { u1: { palette: 'codex' } } })) as never, OPTS as never)
    expect(SL.__stateSnapshot()['themesFailed']).toBe(false)
    expect(SL.__state().themeName).toBe('u1')
  } finally {
    SL.__resetState()
  }
})

// T7 (П.3): a broken stored lastGood says lastgood-broken and is never re-stored
test('S1-FIX5 T7: a broken lastGood diagnoses lastgood-broken', async () => {
  SL.__resetState()
  const store = recStore({ [STORE_LASTGOOD]: { __raw: { template: 'dur||x=constant', theme: 'gone', palette: 'theme' } }, [STORE_THEMES]: {} })
  try {
    await SL.restoreAfterReload(optStand(store) as never, { template: '||' } as never)
    const diag = SL.__diag()
    expect(diag.filter((d) => d.key === 'lastgood-broken').length).toBe(1)
    expect(diag.filter((d) => d.key === 'lastgood-applied').length).toBe(0)
    expect(store.writes.filter((w) => w.key === STORE_LASTGOOD).length).toBe(0)
  } finally {
    SL.__resetState()
  }
})

// T8 (П.4): template-fallback fires on the provisional register build, once per template text
test('S1-FIX5 T8: template-fallback diagnoses on register, once per template text', async () => {
  SL.__resetState()
  const { on } = startHandlers()
  try {
    SL.register(on as never, { template: '||' } as never)
    const cf = (): number => SL.__diag().filter((d) => d.key === 'template-fallback').length
    expect(cf()).toBe(1)
    SL.__render({ template: '||' })
    SL.__render({ template: '||' })
    expect(cf()).toBe(1)
    SL.__render({ template: '|| ' })
    expect(cf()).toBe(2)
    SL.register(on as never, { template: '||', theme: 'zz' } as never)
    expect(SL.__diag().filter((d) => d.key === 'theme-unknown').length).toBe(0)
  } finally {
    SL.__resetState()
  }
})

// T9 (П.5): register cancels the armed timers and wipes the whole state through freshState
test('S1-FIX5 T9: register cancels the timers and wipes the state whole', async () => {
  SL.__resetState()
  const { on } = startHandlers()
  let cancelled = 0
  try {
    SL.__setArmEvery(() => ({ cancel() { cancelled++ } }))
    SL.register(on as never, { template: 'dur||x=constant', numDuration: 'clock', details: 'off' } as never)
    const stand = fullStand()
    await SL.__syncSourceTimers(stand as never)
    const armed = (SL.__stateSnapshot()['timers'] as unknown[]).length
    expect(armed).toBeGreaterThan(0)
    await SL.restoreAfterReload(optStand(recStore({ [STORE_LASTGOOD]: HUD_GOOD })) as never, { template: 'dur||x=constant', numDuration: 'clock', details: 'off' } as never)
    const before = SL.__stateSnapshot()
    expect(before['hostRaw']).not.toEqual({})
    expect(before['lastGood']).not.toBeNull()
    SL.register(on as never, { template: 'dur||x=constant', numDuration: 'clock', details: 'off' } as never)
    const after = SL.__stateSnapshot()
    expect(cancelled).toBe(armed)
    expect(after['hostRaw']).toEqual({})
    expect(after['lastGood']).toBeNull()
    expect(after['syncChain']).not.toBe(before['syncChain'])
    expect((after['timers'] as unknown[]).length).toBe(0)
  } finally {
    SL.__resetState()
    SL.__setArmEvery(null)
  }
})

// T10 (П.6): the session:info source declared by usage reaches its transcript-path element
test('S1-FIX5 T10: session info feeds the usage transcript-path element', async () => {
  SL.__resetState()
  try {
    SL.__render({ template: 't={u-transcript-path.text}' })
    expect(SL.valueOf('u-transcript-path', undefined, {}, SL.buildNf({}))!.value.state).not.toBe('ok')
    SL.__feed({ source: { kind: 'session', call: 'info' }, ok: true, data: { cwd: '/w', root: '/w', id: 'i', turns: 0, transcriptPath: '/t/x.jsonl' }, now: 1 } as never)
    expect(SL.valueOf('u-transcript-path', undefined, {}, SL.buildNf({}))!.value.state).toBe('ok')
  } finally {
    SL.__resetState()
  }
})

// T11 (П.7): the picker stand stores the host truth it was rendered with
test('S1-FIX5 T11: the picker stand records the host truth', async () => {
  SL.__resetState()
  try {
    SL.__renderPicker({ template: 'dur||x=constant', theme: 'hud', palette: 'theme' }, 'view')
    expect((SL.__stateSnapshot()['hostRaw'] as Record<string, string>)['template']).toBe('dur||x=constant')
  } finally {
    SL.__resetState()
  }
})

// T12 (П.8): a refused debug log keeps the unshipped record for the next flush
test('S1-FIX5 T12: a refused debug log does not lose the record', async () => {
  SL.__resetState()
  const logs: string[] = []
  let failed = false
  const $ = {
    clock: { now: async () => 70000 },
    ui: { log: (t: string) => { if (!failed) { failed = true; throw new Error('log-refused') } logs.push(t) }, invalidate: () => undefined },
  }
  const clockRuns: Array<() => void> = []
  SL.__setArmEvery((ms: number, fn: () => void) => { if (ms === 1000) clockRuns.push(fn); return { cancel() {} } })
  try {
    SL.__render({ template: '||' })
    await SL.__syncSourceTimers($ as never)
    await drain()
    for (const fn of clockRuns) fn()
    await drain()
    expect(logs.filter((t) => t.includes('template parsed to zero lines')).length).toBe(1)
    expect(logs.filter((t) => t.includes('template: an empty layout line was dropped')).length).toBe(1)
  } finally {
    SL.__resetState()
    SL.__setArmEvery(null)
  }
})

// ---------- S1-FIX6 teeth (BRIEF-v0.5-S1-FIX6 U1–U13) ----------
// Every tooth wipes the state with register() while an operation begun
// before it is parked on an await, then releases it: the old operation must
// leave the new state (and what it stores) alone.

const gateOf = () => {
  let open!: () => void
  const p = new Promise<void>((r) => { open = r })
  return { p, open }
}

const OPT_HUD = { template: 'dur||x=constant', theme: 'hud', palette: 'theme', placement: 'above', details: 'off' }

type Rec = { key: string; value: unknown }

// a store that parks the FIRST read of `parkKey` until open(); later reads of it answer `later`
const parkingStore = (entries: Record<string, unknown>, parkKey: string, later?: unknown) => {
  const park = gateOf()
  let reads = 0
  const writes: Rec[] = []
  return {
    get: async (k: string): Promise<unknown> => {
      if (k === parkKey) {
        reads++
        if (reads === 1) { await park.p; return entries[k] }
        return later === undefined ? entries[k] : later
      }
      return entries[k]
    },
    set: async (k: string, v: unknown): Promise<void> => { writes.push({ key: k, value: JSON.parse(JSON.stringify(v ?? null)) }) },
    delete: async (k: string): Promise<void> => { writes.push({ key: k, value: undefined }) },
    writes,
    open: () => park.open(),
    reads: () => reads,
  }
}

// the chain beneath the hook: through the stand's `chain` noun where it has one,
// so the generation sweep parks `next(e)` itself as one of its await points
const nextOf = ($: unknown) => (v: unknown): Promise<unknown> => {
  const chain = ($ as { chain?: { next: (x: unknown) => Promise<unknown> } }).chain
  return chain ? chain.next(v) : Promise.resolve(v)
}
const chained = <T extends object>(e: T): T & { chain: { next: (v: unknown) => Promise<unknown> } } => ({ ...e, chain: { next: async (v: unknown) => v } })

const startOn = (handlers: Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>>, $: unknown): Promise<unknown> =>
  handlers['session.start']!($ as never, { isInteractive: true } as never, nextOf($))

const commandOn = (handlers: Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>>, $: unknown, args: string): Promise<unknown> =>
  handlers['command.run']!($ as never, { command: 'statusline-mod', args } as never, nextOf($))

// U1 (П.1, qwen F1): a restore parked on the themes read before register neither
// rebuilds the new state nor stores its own themes or lastGood
test('S1-FIX6 U1: a stale restore at the themes read leaves the new state alone', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const OPT_A = { ...OPT_HUD, separator: '|A|' }
  const OPT_B = { ...OPT_HUD, separator: '|B|' }
  const store = parkingStore({ [STORE_LASTGOOD]: { __raw: OPT_A }, [STORE_THEMES]: { u9: { palette: 'codex' } } }, STORE_THEMES, {})
  const $ = optStand(store)
  try {
    SL.register(on as never, OPT_A as never)
    const started1 = startOn(handlers, $)
    await drain()
    expect(store.reads()).toBe(1)
    SL.register(on as never, OPT_B as never)
    await startOn(handlers, $)
    await drain()
    expect(SL.__state().rawOptions['separator']).toBe('|B|')
    const before = store.writes.length
    store.open()
    await started1
    await drain()
    expect(SL.__state().rawOptions['separator']).toBe('|B|')
    expect(Object.keys(SL.__stateSnapshot()['userThemes'] as Record<string, unknown>).includes('u9')).toBe(false)
    expect(store.writes.slice(before).filter((w) => w.key === STORE_LASTGOOD).length).toBe(0)
  } finally {
    SL.__resetState()
  }
})

// U2 (П.1): a restore parked on the draft read before register does not open the
// new state's picker nor hand it the old draft
test('S1-FIX6 U2: a stale restore at the draft read leaves pickerOpen and the draft alone', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const stored = { session: 'f4', lines: [[]], axes: { palette: 'semantic' }, elements: {}, focus: null, tab: 'view', query: '', fam: 'all', targetLine: 0, themeName: '' }
  const store = parkingStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {}, [STORE_OPEN]: { session: 'f4' }, [STORE_DRAFT]: stored }, STORE_DRAFT, null)
  const $ = optStand(store)
  try {
    SL.register(on as never, OPT_HUD as never)
    const started = startOn(handlers, $)
    await drain()
    expect(store.reads()).toBe(1)
    SL.register(on as never, OPT_HUD as never)
    store.open()
    await started
    await drain()
    const snap = SL.__stateSnapshot()
    expect(snap['pickerOpen']).not.toBe(true)
    expect(snap['draft']).toBeNull()
  } finally {
    SL.__resetState()
  }
})

// U3 (П.1): a restore parked on the in-flight save mark before register does not
// report the old save into the new state
test('S1-FIX6 U3: a stale restore at the save mark writes no save notice into the new state', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const mark = { fields: ['template'], values: { template: 'other||x=constant' } }
  const store = parkingStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {}, [STORE_SAVING]: mark }, STORE_SAVING, null)
  const $ = optStand(store)
  try {
    SL.register(on as never, OPT_HUD as never)
    const started = startOn(handlers, $)
    await drain()
    expect(store.reads()).toBe(1)
    SL.register(on as never, OPT_HUD as never)
    store.open()
    await started
    await drain()
    const snap = SL.__stateSnapshot()
    expect(snap['saving']).toBeNull()
    expect(SL.__diag().filter((d) => d.key === 'save-unwritten').length).toBe(0)
  } finally {
    SL.__resetState()
  }
})

// U4 (П.1, opus H1): a theme save whose store write lands after register neither
// stores the empty host config as lastGood nor rebuilds the new state
test('S1-FIX6 U4: a theme save across register is dropped with its own diagnosis', async () => {
  SL.__resetState()
  const { on } = startHandlers()
  const park = gateOf()
  let parked = false
  const writes: Rec[] = []
  const store = {
    get: async (k: string): Promise<unknown> => (k === STORE_LASTGOOD ? HUD_GOOD : k === STORE_THEMES ? { u1: { palette: 'codex' } } : undefined),
    set: async (k: string, v: unknown): Promise<void> => {
      if (k === STORE_THEMES && !parked) { parked = true; await park.p }
      writes.push({ key: k, value: JSON.parse(JSON.stringify(v ?? null)) })
    },
    delete: async (k: string): Promise<void> => { writes.push({ key: k, value: undefined }) },
  }
  try {
    SL.register(on as never, OPT_HUD as never)
    await SL.restoreAfterReload(optStand(store) as never, OPT_HUD as never)
    writes.length = 0
    await pickerSaveTheme(OPT_HUD, 'u2', store)
    expect(parked).toBe(true)
    SL.register(on as never, OPT_HUD as never)
    park.open()
    await drain()
    await drain()
    expect(writes.filter((w) => w.key === STORE_LASTGOOD).length).toBe(0)
    expect(SL.__diag().filter((d) => d.key === 'stale-theme save').length).toBe(1)
    expect(SL.__stateSnapshot()['themeNote']).toBe('')
  } finally {
    SL.__resetState()
  }
})

// U5 (П.1): a picker press queued before register is dropped, never run in the new state
test('S1-FIX6 U5: a picker action queued before register is dropped', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const store = gatedStore({ [STORE_LASTGOOD]: HUD_GOOD })
  const $ = interactiveStand(store)
  try {
    SL.register(on as never, OPT_HUD as never)
    const started = startOn(handlers, $)
    await drain()
    await pickerSaveTheme(OPT_HUD, 'u5', store)
    SL.register(on as never, OPT_HUD as never)
    store.release()
    await started
    await drain()
    await drain()
    expect(store.writes.filter((w) => w.key === STORE_THEMES).length).toBe(0)
    expect(SL.__diag().filter((d) => d.key === 'stale-picker action').length).toBeGreaterThan(0)
  } finally {
    SL.__resetState()
  }
})

// U6 (П.3, opus H3): restore sets pickerOpen and the draft together after its last
// await — the pane gate never sees an open picker without its stored draft
test('S1-FIX6 U6: restore assigns pickerOpen only together with the stored draft', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const stored = { session: 'f4', lines: [[]], axes: { palette: 'semantic' }, elements: {}, focus: null, tab: 'view', query: '', fam: 'all', targetLine: 0, themeName: '' }
  const store = parkingStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {}, [STORE_OPEN]: { session: 'f4' }, [STORE_DRAFT]: stored }, STORE_DRAFT)
  const $ = optStand(store)
  try {
    SL.register(on as never, OPT_HUD as never)
    const started = startOn(handlers, $)
    await drain()
    expect(store.reads()).toBe(1)
    expect(SL.__stateSnapshot()['pickerOpen']).not.toBe(true)
    store.open()
    await started
    await drain()
    const snap = SL.__stateSnapshot()
    expect(snap['pickerOpen']).toBe(true)
    expect((snap['draft'] as { axes: Record<string, string> }).axes['palette']).toBe('semantic')
  } finally {
    SL.__resetState()
  }
})

// U7 (П.3, qwen F2): a pane close inside the restore window lands after the
// restore — the closed pane stays closed and its open mark is removed
test('S1-FIX6 U7: a close inside the restore window stays closed', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const idGate = gateOf()
  const entries: Record<string, unknown> = {
    [STORE_LASTGOOD]: HUD_GOOD,
    [STORE_THEMES]: {},
    [STORE_OPEN]: { session: 'f4' },
    [STORE_DRAFT]: { session: 'f4', lines: [[]], axes: {}, elements: {}, focus: null, tab: 'layout', query: '', fam: 'all', targetLine: 0, themeName: '' },
  }
  const store = {
    get: async (k: string): Promise<unknown> => entries[k],
    set: async (k: string, v: unknown): Promise<void> => { entries[k] = v },
    delete: async (k: string): Promise<void> => { delete entries[k] },
  }
  const base = optStand(store)
  const $ = { ...base, session: { ...base.session, id: async () => { await idGate.p; return 'f4' } } }
  try {
    SL.register(on as never, OPT_HUD as never)
    const started = startOn(handlers, $)
    await drain()
    const closing = handlers['ui.close']!($ as never, { id: 'statusline' } as never, async (e: unknown) => e)
    await drain()
    idGate.open()
    await closing
    await started
    await drain()
    expect(SL.__stateSnapshot()['pickerOpen']).toBe(false)
    expect(STORE_OPEN in entries).toBe(false)
  } finally {
    SL.__resetState()
  }
})

// U8 (П.3): /statusline-mod reset waits for the LATEST restore, also one begun
// by a register that landed while it waited
test('S1-FIX6 U8: reset across register waits for the newest restore', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const storeA = gatedStore({ [STORE_LASTGOOD]: HUD_GOOD })
  const storeB = gatedStore({ [STORE_LASTGOOD]: HUD_GOOD })
  const sets: Rec[] = []
  const mine = (field: string) => ({ key: 'catalyst-statusline.' + field, value: '', provider: { plugin: 'catalyst-statusline' } })
  const $A = { ...interactiveStand(storeA), config: { list: async () => [mine('template'), mine('details')], set: async (x: Rec) => { sets.push(x) } } }
  const $B = interactiveStand(storeB)
  try {
    SL.register(on as never, OPT_HUD as never)
    const startedA = startOn(handlers, $A)
    await drain()
    const reset = commandOn(handlers, $A, 'reset')
    await drain()
    SL.register(on as never, OPT_HUD as never)
    const startedB = startOn(handlers, $B)
    await drain()
    storeA.release()
    await startedA
    await drain()
    expect(sets.length).toBe(0)
    storeB.release()
    await startedB
    await reset
    await drain()
    expect(sets.some((s) => s.key === 'catalyst-statusline.template' && s.value === '')).toBe(true)
  } finally {
    SL.__resetState()
  }
})

// U9 (П.2, opus H2 / qwen F3): on the product path a refused themes read is
// retried by the theme save — the theme and the last good config are stored
test('S1-FIX6 U9: the theme save retries a refused themes read and stores both', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  let themeReads = 0
  const writes: Rec[] = []
  const store = {
    get: async (k: string): Promise<unknown> => {
      if (k === STORE_THEMES) { themeReads++; if (themeReads === 1) throw new Error('io-once'); return { u1: { palette: 'codex' } } }
      return k === STORE_LASTGOOD ? HUD_GOOD : undefined
    },
    set: async (k: string, v: unknown): Promise<void> => { writes.push({ key: k, value: JSON.parse(JSON.stringify(v ?? null)) }) },
    delete: async (k: string): Promise<void> => { writes.push({ key: k, value: undefined }) },
  }
  try {
    SL.register(on as never, OPT_HUD as never)
    await startOn(handlers, optStand(store))
    await drain()
    expect(SL.__stateSnapshot()['themesFailed']).toBe(true)
    writes.length = 0
    await pickerSaveTheme(OPT_HUD, 'u7', store)
    const themes = writes.filter((w) => w.key === STORE_THEMES)
    expect(themes.length).toBe(1)
    expect(Object.keys(themes[0]!.value as object).sort()).toEqual(['u1', 'u7'])
    expect(writes.filter((w) => w.key === STORE_LASTGOOD).length).toBeGreaterThan(0)
    expect(SL.__stateSnapshot()['themesFailed']).toBe(false)
    expect(SL.__stateSnapshot()['themeNote']).toBe('тема «u7» сохранена')
  } finally {
    SL.__resetState()
  }
})

// U10 (П.2): opening the picker retries a refused themes read and re-decides the band
test('S1-FIX6 U10: the picker open retries a refused themes read', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  let themeReads = 0
  const writes: Rec[] = []
  const store = {
    get: async (k: string): Promise<unknown> => {
      if (k === STORE_THEMES) { themeReads++; if (themeReads === 1) throw new Error('io-once'); return { u1: { palette: 'codex' } } }
      return k === STORE_LASTGOOD ? HUD_GOOD : undefined
    },
    set: async (k: string, v: unknown): Promise<void> => { writes.push({ key: k, value: JSON.parse(JSON.stringify(v ?? null)) }) },
    delete: async (k: string): Promise<void> => { writes.push({ key: k, value: undefined }) },
  }
  const $ = interactiveStand(store)
  const OPTS = { ...OPT_HUD, theme: 'u1' }
  try {
    SL.register(on as never, OPTS as never)
    await startOn(handlers, $)
    await drain()
    expect(SL.__stateSnapshot()['themesFailed']).toBe(true)
    await commandOn(handlers, $, '')
    await drain()
    expect(SL.__stateSnapshot()['themesFailed']).toBe(false)
    expect(SL.__state().themeName).toBe('u1')
    expect(SL.__state().view.paletteName).toBe('codex')
    expect(SL.__stateSnapshot()['pickerOpen']).toBe(true)
    expect(writes.filter((w) => w.key === STORE_LASTGOOD).length).toBeGreaterThan(0)
  } finally {
    SL.__resetState()
  }
})

// U11 (П.4, opus H4): under a refused themes read the picker does not blame the
// user's theme name as unknown
test('S1-FIX6 U11: the picker writes no theme-unknown while the themes read failed', async () => {
  SL.__resetState()
  const store = refusingThemesStore()
  const U = { template: 'dur||x=constant', theme: 'u1', palette: 'theme' }
  try {
    await SL.restoreAfterReload(optStand(store) as never, U as never)
    SL.__renderPicker(U, 'view')
    expect(SL.__diag().filter((d) => d.key === 'theme-unknown').length).toBe(0)
  } finally {
    SL.__resetState()
  }
})

// U12 (П.6, qwen F5): a refused lastGood write is said aloud; one that lands
// after register says nothing in the new state and sets no lastGood there
test('S1-FIX6 U12: the lastGood write refusal is diagnosed only in its own state', async () => {
  SL.__resetState()
  const { on } = startHandlers()
  const refusing = {
    get: async (k: string): Promise<unknown> => (k === STORE_THEMES ? {} : undefined),
    set: async (k: string): Promise<void> => { if (k === STORE_LASTGOOD) throw new Error('io-lg') },
    delete: async (): Promise<void> => undefined,
  }
  try {
    SL.register(on as never, OPT_HUD as never)
    await SL.restoreAfterReload(optStand(refusing) as never, OPT_HUD as never)
    const lg = SL.__diag().filter((d) => d.key === 'lastgood-write')
    expect(lg.length).toBe(1)
    expect(lg[0]!.text.includes('io-lg')).toBe(true)

    SL.register(on as never, OPT_HUD as never)
    const park = gateOf()
    const late = {
      get: async (k: string): Promise<unknown> => (k === STORE_THEMES ? {} : undefined),
      set: async (k: string): Promise<void> => { if (k === STORE_LASTGOOD) { await park.p; throw new Error('io-late') } },
      delete: async (): Promise<void> => undefined,
    }
    const restoring = SL.restoreAfterReload(optStand(late) as never, OPT_HUD as never)
    await drain()
    SL.register(on as never, OPT_HUD as never)
    park.open()
    await restoring
    await drain()
    expect(SL.__diag().filter((d) => d.key === 'lastgood-write').length).toBe(0)
    expect(SL.__stateSnapshot()['lastGood']).toBeNull()
  } finally {
    SL.__resetState()
  }
})

// U13 (П.8): after a module reload (no session.start) /statusline-mod asks the host's
// surfaces: a drawn surface opens the pane, none (or a host without the method) answers text
test('S1-FIX6 U13: the command after a reload decides the pane from the surfaces', async () => {
  const { on, handlers } = startHandlers()
  const run = async (surfaces: (() => Promise<string[]>) | undefined): Promise<{ r: Record<string, unknown>; open: unknown }> => {
    SL.__resetState()
    SL.register(on as never, OPT_HUD as never)
    const base = interactiveStand(recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {} }))
    const $ = surfaces ? { ...base, session: { ...base.session, surfaces } } : base
    const r = (await commandOn(handlers, $, '')) as Record<string, unknown>
    await drain()
    return { r, open: SL.__stateSnapshot()['pickerOpen'] }
  }
  try {
    const drawn = await run(async () => ['terminal'])
    expect(drawn.r['text']).toBeUndefined()
    expect(drawn.open).toBe(true)
    const none = await run(async () => [])
    expect(String(none.r['text'])).toContain('/config')
    expect(none.open).not.toBe(true)
    const absent = await run(undefined)
    expect(String(absent.r['text'])).toContain('/config')
    expect(absent.open).not.toBe(true)
  } finally {
    SL.__resetState()
  }
})

// U14 (П.1): a reset whose /config rows arrive after register writes no notice
// into the new state
test('S1-FIX6 U14: a reset across register writes no notice into the new state', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const rows = gateOf()
  const store = recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {} })
  const $ = { ...interactiveStand(store), config: { list: async () => { await rows.p; return [] }, set: async () => undefined } }
  try {
    SL.register(on as never, OPT_HUD as never)
    await startOn(handlers, $)
    await drain()
    const reset = commandOn(handlers, $, 'reset')
    await drain()
    SL.register(on as never, OPT_HUD as never)
    rows.open()
    const answer = (await reset) as { text: string }
    await drain()
    expect(answer.text.startsWith('Status line reset to defaults.')).toBe(true)
    expect(SL.__stateSnapshot()['saveResult']).toBe('')
  } finally {
    SL.__resetState()
  }
})

// U15 (П.1): a picker open parked on the session id before register neither
// hands the new state a draft nor stores an open mark
test('S1-FIX6 U15: a picker open across register is dropped', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const idGate = gateOf()
  // only the id read of the picker open parks; the startup reads answer at once
  let armed = false
  let parked = 0
  const store = recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {} })
  const base = interactiveStand(store)
  const $ = { ...base, session: { ...base.session, id: async () => { if (armed && parked++ === 0) await idGate.p; return 'f4' } } }
  try {
    SL.register(on as never, OPT_HUD as never)
    await startOn(handlers, $)
    await drain()
    armed = true
    const opening = commandOn(handlers, $, '')
    await drain()
    expect(parked).toBe(1)
    SL.register(on as never, OPT_HUD as never)
    const before = store.writes.length
    idGate.open()
    await opening
    await drain()
    expect(SL.__stateSnapshot()['draft']).toBeNull()
    expect(store.writes.slice(before).filter((w) => w.key === STORE_OPEN).length).toBe(0)
    expect(SL.__diag().filter((d) => d.key === 'stale-picker open').length).toBe(1)
  } finally {
    SL.__resetState()
  }
})

// U16 (П.1): a refresh parked on the clock before register starts no refresh ticket in the new state
test('S1-FIX6 U16: a refresh across register is dropped', async () => {
  SL.__resetState()
  const { on } = startHandlers()
  const clock = gateOf()
  const stand = { ...fullStand(), clock: { now: async () => { await clock.p; return 5000 }, every: () => ({ cancel() {} }) } }
  try {
    SL.register(on as never, OPT_HUD as never)
    const refreshing = SL.__refresh(stand as never)
    await drain()
    SL.register(on as never, OPT_HUD as never)
    clock.open()
    await refreshing
    await drain()
    expect(SL.__stateSnapshot()['refreshesBegun']).toBe(0)
  } finally {
    SL.__resetState()
  }
})

// U17 (П.1, AR-6): a timer sync parked on the clock before register arms no timer
// with the old engine in the new state
test('S1-FIX6 U17: a timer sync across register arms nothing', async () => {
  SL.__resetState()
  const { on } = startHandlers()
  const clock = gateOf()
  let armed = 0
  const OPTS = { template: 'dur||x=constant', numDuration: 'clock', details: 'off' }
  const stand = { ...fullStand(), clock: { now: async () => { await clock.p; return 5000 }, every: () => ({ cancel() {} }) } }
  try {
    SL.__setArmEvery(() => { armed++; return { cancel() {} } })
    SL.register(on as never, OPTS as never)
    const syncing = SL.__syncSourceTimers(stand as never)
    await drain()
    SL.register(on as never, OPTS as never)
    clock.open()
    await syncing
    await drain()
    expect(armed).toBe(0)
    expect((SL.__stateSnapshot()['timers'] as unknown[]).length).toBe(0)
  } finally {
    SL.__resetState()
    SL.__setArmEvery(null)
  }
})

// U18 (П.1): an env pass parked before register neither sets HOME nor feeds a
// family in the new state — parked on the HOME read, then on the clock read
test('S1-FIX6 U18: an env pass across register leaves HOME and the families alone', async () => {
  const { on } = startHandlers()
  const pass = async (parkOn: 'home' | 'clock'): Promise<Record<string, unknown>> => {
    SL.__resetState()
    const park = gateOf()
    let parked = false
    const hold = async (): Promise<void> => { if (!parked) { parked = true; await park.p } }
    const base = fullStand()
    const stand = {
      ...base,
      env: { get: async (name: string) => { if (parkOn === 'home' && name === 'HOME') await hold(); return name === 'HOME' ? '/work/tester' : '' } },
      clock: { now: async () => { if (parkOn === 'clock') await hold(); return 5000 }, every: () => ({ cancel() {} }) },
    }
    SL.register(on as never, OPT_HUD as never)
    const running = SL.__runEnvSources(stand as never)
    await drain()
    expect(parked).toBe(true)
    SL.register(on as never, OPT_HUD as never)
    park.open()
    await running
    await drain()
    return SL.__stateSnapshot()
  }
  try {
    const home = await pass('home')
    expect(home['home']).toBe('')
    const fed = await pass('clock')
    expect((fed['famStates'] as unknown[]).length).toBe(0)
  } finally {
    SL.__resetState()
  }
})

// U20 (П.1): a theme save whose retried themes read is parked across register
// neither stores the new state's themes nor lands the theme in the new state
test('S1-FIX6 U20: a theme save parked on its themes read across register is dropped', async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const park = gateOf()
  let themeReads = 0
  const writes: Rec[] = []
  const store = {
    get: async (k: string): Promise<unknown> => {
      if (k === STORE_THEMES) {
        themeReads++
        if (themeReads === 1) throw new Error('io-once')
        if (themeReads === 2) await park.p
        return { u1: { palette: 'codex' } }
      }
      return k === STORE_LASTGOOD ? HUD_GOOD : undefined
    },
    set: async (k: string, v: unknown): Promise<void> => { writes.push({ key: k, value: JSON.parse(JSON.stringify(v ?? null)) }) },
    delete: async (k: string): Promise<void> => { writes.push({ key: k, value: undefined }) },
  }
  try {
    SL.register(on as never, OPT_HUD as never)
    await startOn(handlers, optStand(store))
    await drain()
    expect(SL.__stateSnapshot()['themesFailed']).toBe(true)
    writes.length = 0
    await pickerSaveTheme(OPT_HUD, 'u7', store)
    await drain()
    expect(themeReads).toBe(2)
    SL.register(on as never, OPT_HUD as never)
    park.open()
    await drain()
    await drain()
    expect(writes.filter((w) => w.key === STORE_THEMES).length).toBe(0)
    expect(SL.__diag().filter((d) => d.key === 'stale-theme save').length).toBe(1)
    expect(Object.keys(SL.__stateSnapshot()['userThemes'] as Record<string, unknown>).includes('u7')).toBe(false)
  } finally {
    SL.__resetState()
  }
})

// ---------- S1-FIX6 U21: the generation sweep ----------
// Every await point of every operation that can straddle a reload, one at a
// time: the k-th async engine call is parked, register runs, the call is
// released. The new state must come out as register left it (diagnostics
// aside, and those only 'stale-*'); operations that must not write past a
// reload write nothing. A guard removed anywhere on the path turns this red.

type Engine = Record<string, unknown>
const WRITE_CALLS = ['store.set', 'store.delete', 'config.set', 'ui.open', 'ui.close']
// Past a reload only the chain's own continuation and the session-scoped
// command registration may still run: `next` belongs to the host's chain, and
// command.register re-binds the command for the session, not for the state.
const LATE_OK = ['chain.next', 'command.register']

const sweepEngine = (base: Engine) => {
  const gate = gateOf()
  let armedAt = 0
  let n = 0
  let parked = false
  let marked = false
  const late: string[] = []
  const wrap = (noun: string, obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value !== 'function') { out[key] = value; continue }
      const name = noun + '.' + key
      out[key] = (...args: unknown[]): unknown => {
        if (marked) late.push(name)
        const r = (value as (...a: unknown[]) => unknown).apply(obj, args)
        if (!(r instanceof Promise) || armedAt === 0) return r
        n++
        if (n !== armedAt) return r
        parked = true
        return r.then(async (v) => { await gate.p; return v }, async (err) => { await gate.p; throw err })
      }
    }
    return out
  }
  const engine: Engine = {}
  for (const [noun, value] of Object.entries(base)) {
    engine[noun] = value && typeof value === 'object' ? wrap(noun, value as Record<string, unknown>) : value
  }
  return {
    engine,
    arm: (k: number) => { armedAt = k; n = 0 },
    parked: () => parked,
    mark: () => { marked = true },
    open: () => gate.open(),
    lateWrites: () => late.filter((c) => WRITE_CALLS.includes(c)),
    lateCalls: () => late.slice(),
  }
}

const memStore = (entries: Record<string, unknown>) => {
  const data: Record<string, unknown> = JSON.parse(JSON.stringify(entries))
  return {
    get: async (k: string): Promise<unknown> => data[k],
    set: async (k: string, v: unknown): Promise<void> => { data[k] = JSON.parse(JSON.stringify(v ?? null)) },
    delete: async (k: string): Promise<void> => { delete data[k] },
  }
}

const DIAG_FIELDS = ['diag', 'diagLogged', 'diagDropped', 'diagOnce']
const frozenState = (): Record<string, string> => {
  const snap = SL.__stateSnapshot()
  for (const f of DIAG_FIELDS) delete snap[f]
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(snap)) {
    out[key] = JSON.stringify(value, (_k, x) =>
      typeof x === 'function' ? '<fn>' : x instanceof Promise ? '<promise>' : x instanceof Map ? [...x.entries()] : x instanceof Set ? [...x.values()] : x) ?? 'undefined'
  }
  return out
}
// the fields whose frozen form differs, each with both forms cut to a short line
const changedFields = (before: Record<string, string>, after: Record<string, string>): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => before[key] !== after[key])
    .map((key) => key + ': ' + String(before[key]).slice(0, 80) + ' -> ' + String(after[key]).slice(0, 80))

type SweepCase = {
  name: string
  // builds the stand from a fresh store; the sweep wraps what it returns
  stand: (store: ReturnType<typeof memStore>) => Engine
  entries: Record<string, unknown>
  setup: (handlers: Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>>, $: Engine) => Promise<void>
  op: (handlers: Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>>, $: Engine) => Promise<unknown>
  writesPastReload: boolean
  // the op's own answer against the drops it recorded, where the answer is part of the contract
  check?: (result: unknown, newDiagKeys: string[]) => void
}

const THEMES_ONCE_REFUSED = (store: ReturnType<typeof memStore>) => {
  let reads = 0
  return {
    ...store,
    get: async (k: string): Promise<unknown> => {
      if (k === STORE_THEMES && ++reads === 1) throw new Error('io-once')
      return store.get(k)
    },
  }
}

const mineRow = (field: string) => ({ key: 'catalyst-statusline.' + field, value: '', provider: { plugin: 'catalyst-statusline' } })
const withConfig = (e: Engine): Engine => ({ ...e, config: { list: async () => [mineRow('template'), mineRow('details')], set: async () => undefined } })
const surfaced = (e: Engine): Engine => ({ ...e, session: { ...(e['session'] as object), surfaces: async () => ['terminal'] } })
// the press runs against the whole stand engine, so every engine call the pressed action makes is swept
const pressOn = (engine: Engine, tab: string, key: string): void => {
  const nodes = walk(SL.__renderPicker(OPT_HUD, tab, 120, undefined, engine['store'] as never, engine))
  const node = nodes.find((x) => x.props?.['key'] === key)
  expect(node).toBeDefined()
  ;(node!.props!['onPress'] as () => void)()
}

// /config rows that answer what was last written to them, as the host's rows do
const withRows = (e: Engine, fields: string[]): Engine => {
  const values: Record<string, unknown> = {}
  return {
    ...e,
    config: {
      list: async () => fields.map((f) => ({ ...mineRow(f), value: values[f] ?? '' })),
      set: async (x: { key: string; value: unknown }) => { values[x.key.slice(x.key.lastIndexOf('.') + 1)] = x.value },
    },
  }
}
const TABLE = {
  Box: (props: Record<string, unknown>) => ({ type: 'Box', props, children: props['children'] }),
  Text: (props: Record<string, unknown>) => ({ type: 'Text', props, children: props['children'] }),
  Button: (props: Record<string, unknown>) => ({ type: 'Button', props, children: props['label'] !== undefined ? [String(props['label'])] : undefined }),
  Input: (props: Record<string, unknown>) => ({ type: 'Input', props, children: [(props['value'] as string) ?? ''] }),
}
// the stand a real session gives: the pane opens and closes, trees resolve
const sweepStand = (store: unknown): Engine => {
  const base = surfaced(optStand(store as never) as unknown as Engine)
  return chained({ ...base, ui: { ...(base['ui'] as object), open: async () => undefined, close: async () => undefined, focus: () => undefined, resolve: async () => TABLE } })
}
type Handlers = Record<string, (eng: unknown, e: unknown, next: unknown) => Promise<unknown>>
const startDrained = async (handlers: Handlers, $: Engine): Promise<void> => { await startOn(handlers, $); await drain() }
const RELOADED_TEXT = 'The status line module reloaded while /statusline-mod ran; run it again.'
const answersReload = (result: unknown, keys: string[]): void => {
  expect({ keys, result }).toEqual({ keys, result: keys.includes('stale-picker open') ? { text: RELOADED_TEXT } : {} })
}

const PICKER_ENTRIES = { [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: { u1: { palette: 'codex' } } }
const RESTORE_ENTRIES = {
  ...PICKER_ENTRIES,
  [STORE_OPEN]: { session: 'f4' },
  [STORE_DRAFT]: { session: 'f4', lines: [], axes: { palette: 'semantic' }, elements: {} },
  [STORE_SAVING]: { fields: ['template'], values: { template: 'x' } },
}

const SWEEP: SweepCase[] = [
  {
    name: 'session start (restore + sources)',
    stand: (store) => chained(surfaced(optStand(store as never) as unknown as Engine)),
    entries: RESTORE_ENTRIES,
    setup: async () => undefined,
    op: (handlers, $) => startOn(handlers, $),
    writesPastReload: false,
  },
  {
    name: 'session start with the themes read refused once',
    stand: (store) => chained(surfaced(optStand(THEMES_ONCE_REFUSED(store) as never) as unknown as Engine)),
    entries: RESTORE_ENTRIES,
    setup: async () => undefined,
    op: (handlers, $) => startOn(handlers, $),
    writesPastReload: false,
  },
  {
    name: 'picker open',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => commandOn(handlers, $, ''),
    writesPastReload: false,
    check: answersReload,
  },
  {
    name: 'picker open after a refused themes read',
    stand: (store) => sweepStand(THEMES_ONCE_REFUSED(store)),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => commandOn(handlers, $, ''),
    writesPastReload: false,
    check: answersReload,
  },
  {
    name: 'picker open on a state that saw no session start',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: async () => undefined,
    op: (handlers, $) => commandOn(handlers, $, ''),
    writesPastReload: false,
    check: answersReload,
  },
  {
    name: 'theme save',
    stand: (store) => ({ store }),
    entries: PICKER_ENTRIES,
    setup: async (_h, $) => { await SL.restoreAfterReload(optStand($['store'] as never) as never, OPT_HUD as never); pressOn($, 'view', 'ax:palette:codex'); await drain() },
    op: async (_h, $) => {
      const nodes = walk(SL.__renderPicker(OPT_HUD, 'themes', 120, undefined, $['store'] as never))
      ;(nodes.find((x) => x.props?.['key'] === 'theme-name')!.props!['onInput'] as (v: string) => void)('u7')
      ;(nodes.find((x) => x.props?.['key'] === 'theme-save')!.props!['onPress'] as () => void)()
    },
    writesPastReload: false,
  },
  {
    name: 'theme save after a refused themes read',
    stand: (store) => ({ store: THEMES_ONCE_REFUSED(store) }),
    entries: PICKER_ENTRIES,
    setup: async (_h, $) => { await SL.restoreAfterReload(optStand($['store'] as never) as never, OPT_HUD as never); pressOn($, 'view', 'ax:palette:codex'); await drain() },
    op: async (_h, $) => {
      const nodes = walk(SL.__renderPicker(OPT_HUD, 'themes', 120, undefined, $['store'] as never))
      ;(nodes.find((x) => x.props?.['key'] === 'theme-name')!.props!['onInput'] as (v: string) => void)('u7')
      ;(nodes.find((x) => x.props?.['key'] === 'theme-save')!.props!['onPress'] as () => void)()
    },
    writesPastReload: false,
  },
  {
    name: 'draft save',
    stand: (store) => withRows({ store }, ['template', 'details', 'palette']),
    entries: PICKER_ENTRIES,
    setup: async (_h, $) => { await SL.restoreAfterReload(optStand($['store'] as never) as never, OPT_HUD as never); pressOn($, 'view', 'ax:palette:codex'); await drain() },
    op: async (_h, $) => { pressOn($, 'view', 'save') },
    writesPastReload: true,
  },
  {
    name: 'undo',
    stand: (store) => withRows({ store }, ['template', 'details', 'palette']),
    entries: PICKER_ENTRIES,
    setup: async (_h, $) => { await SL.restoreAfterReload(optStand($['store'] as never) as never, OPT_HUD as never); pressOn($, 'view', 'ax:palette:codex'); await drain(); pressOn($, 'view', 'save'); await drain() },
    op: async (_h, $) => { pressOn($, 'view', 'undo') },
    writesPastReload: true,
  },
  {
    name: 'session end',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => handlers['session.end']!($, {}, nextOf($)),
    writesPastReload: false,
  },
  {
    name: 'turn start',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => handlers['turn.start']!($, {}, nextOf($)),
    writesPastReload: false,
  },
  {
    name: 'turn step',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: async (handlers, $) => {
      const step = handlers['turn.step'] as unknown as (eng: unknown, e: unknown, next: unknown) => AsyncGenerator<unknown, unknown>
      const it = step($, {}, async function* () { return { stop: 'end' } })
      for (;;) if ((await it.next()).done) return
    },
    writesPastReload: false,
  },
  {
    name: 'turn complete',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => handlers['turn.complete']!($, { usage: { input: 1 } }, () => nextOf($)({ text: 'ok' })),
    writesPastReload: false,
  },
  {
    name: 'tool call',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => handlers['tool.call']!($, { tool: 'Bash', tool_use_id: 'u1' }, () => nextOf($)({ ok: true })),
    writesPastReload: false,
  },
  {
    name: 'tool call whose chain throws',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => handlers['tool.call']!($, { tool: 'Bash', tool_use_id: 'u2' }, async () => { await nextOf($)(null); throw new Error('chain') }),
    writesPastReload: false,
  },
  {
    name: 'agent spawn',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => handlers['agent.spawn']!($, { subagentType: 'w' }, () => nextOf($)({ id: 'a1' })),
    writesPastReload: false,
  },
  {
    name: 'config set',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => handlers['config.set']!($, { key: 'k', value: 1 }, () => nextOf($)({})),
    writesPastReload: false,
  },
  {
    name: 'transcript path from a submitted prompt',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => handlers['classic.UserPromptSubmit']!($, { transcript_path: '/work/t2.jsonl' }, nextOf($)),
    writesPastReload: false,
  },
  {
    // a second sync queued behind a parked one belongs to the state that queued it
    name: 'transcript path twice, the second sync queued behind the first',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => Promise.all([
      handlers['classic.UserPromptSubmit']!($, { transcript_path: '/work/t2.jsonl' }, nextOf($)),
      handlers['classic.UserPromptSubmit']!($, { transcript_path: '/work/t3.jsonl' }, nextOf($)),
    ]),
    writesPastReload: false,
  },
  {
    name: 'model command refresh',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => handlers['command.run']!($, { command: 'model', args: '' }, nextOf($)),
    writesPastReload: false,
  },
  {
    name: 'band render',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: async () => undefined,
    op: (handlers, $) => handlers['ui.render']!($, { component: 'AbovePrompt', surface: 'terminal', requestId: 'band', props: { maxRows: 3, bodyColumns: 80, hasSurvey: false } }, () => nextOf($)(undefined)),
    writesPastReload: false,
  },
  {
    name: 'pane render',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: async (handlers, $) => { await startDrained(handlers, $); await commandOn(handlers, $, ''); await drain() },
    op: (handlers, $) => handlers['ui.render']!($, { component: 'Pane', surface: 'terminal', requestId: 'statusline', props: { bodyColumns: 100 } }, () => nextOf($)(undefined)),
    writesPastReload: false,
  },
  {
    // the close is the host's fact about the pane: it lands on whichever state is current (S1-FIX6 П.3)
    name: 'pane close',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: async (handlers, $) => { await startDrained(handlers, $); await commandOn(handlers, $, ''); await drain() },
    op: (handlers, $) => handlers['ui.close']!($, { id: 'statusline' }, nextOf($)),
    writesPastReload: true,
  },
  {
    name: 'reset command',
    stand: (store) => withConfig(optStand(store as never) as unknown as Engine),
    entries: PICKER_ENTRIES,
    setup: async (handlers, $) => { await startOn(handlers, $); await drain() },
    op: (handlers, $) => commandOn(handlers, $, 'reset'),
    writesPastReload: true,
  },
]

for (const c of SWEEP) {
  test('S1-FIX6 U21 sweep: ' + c.name + ' — every await point across register leaves the new state alone', { timeoutMs: 60000 }, async () => {
    let points = 0
    try {
      for (let k = 1; k <= 400; k++) {
        SL.__resetState()
        const { on, handlers } = startHandlers()
        const sw = sweepEngine(c.stand(memStore(c.entries)))
        SL.register(on as never, OPT_HUD as never)
        await c.setup(handlers, sw.engine)
        sw.arm(k)
        const running = c.op(handlers, sw.engine).catch(() => undefined)
        await drain()
        if (!sw.parked()) {
          await running
          break
        }
        points++
        SL.register(on as never, OPT_HUD as never)
        const before = frozenState()
        const diagBefore = SL.__diag().length
        sw.mark()
        sw.open()
        const result = await running
        await drain()
        await drain()
        await drain()
        const keys = SL.__diag().slice(diagBefore).map((d) => d.key)
        expect({ k, changed: changedFields(before, frozenState()) }).toEqual({ k, changed: [] })
        expect({ k, diag: keys.filter((key) => !key.startsWith('stale-')) }).toEqual({ k, diag: [] })
        if (c.check) c.check(result, keys)
        if (!c.writesPastReload) expect({ k, writes: sw.lateWrites() }).toEqual({ k, writes: [] })
        if (!c.writesPastReload) expect({ k, late: sw.lateCalls().filter((name) => !LATE_OK.includes(name)) }).toEqual({ k, late: [] })
      }
      expect(points).toBeGreaterThan(0)
      console.log('[U21] ' + c.name + ': await points swept = ' + points)
    } finally {
      SL.__resetState()
    }
  })
}

// ---------- S1-FIX7 U23: the second generation sweep ----------
// Refusals of the parked engine call where the first sweep never refused it —
// the stale catch/else paths of the guards, the hint-placement render, and
// the source-tick paths (runCmd/runFile/runTranscript became sweepable only
// after the S1-FIX7b guards in H — without them the UNMUTATED code made a
// late $.process.run / $.fs.read across the register and every full k-sweep
// of a tick was red on the original).
// Same law as U21: past the reload the old operation writes nothing, says
// nothing but 'stale-*', and makes no engine call beyond the chain's own
// continuation (LATE_OK).

const THEMES_SET_REFUSED = (store: ReturnType<typeof memStore>) => ({
  ...store,
  set: async (k: string, v: unknown): Promise<void> => {
    if (k === STORE_THEMES) throw new Error('io-refused')
    return store.set(k, v)
  },
})

const UNDO_REFUSED = (store: ReturnType<typeof memStore>) => ({
  ...store,
  get: async (k: string): Promise<unknown> => {
    if (k === STORE_UNDO) throw new Error('io-undo')
    return store.get(k)
  },
})

// captured host-timer callbacks (the __setArmEvery seam) for the U30 phases
const tickRuns: Array<() => void> = []

const SWEEP7: SweepCase[] = [
  {
    // H:1493-1496: a save mark that matches the host config takes the clean
    // branch; past the register the stale restore must write no save notice
    name: 'S1-FIX7 session start with a completed save mark',
    stand: (store) => chained(surfaced(optStand(store as never) as unknown as Engine)),
    entries: { ...RESTORE_ENTRIES, [STORE_SAVING]: { fields: ['template'], values: { template: OPT_HUD.template } } },
    setup: async () => undefined,
    op: (handlers, $) => startOn(handlers, $),
    writesPastReload: false,
  },
  {
    // H:2490-2492: the themes write refuses AFTER the register — the stale
    // save must not delete a theme or write a notice into the new state
    name: 'S1-FIX7 theme save whose themes write refuses across register',
    stand: (store) => ({ store: THEMES_SET_REFUSED(store) }),
    entries: PICKER_ENTRIES,
    setup: async (_h, $) => { await SL.restoreAfterReload(optStand($['store'] as never) as never, OPT_HUD as never); pressOn($, 'view', 'ax:palette:codex'); await drain() },
    op: async (_h, $) => {
      const nodes = walk(SL.__renderPicker(OPT_HUD, 'themes', 120, undefined, $['store'] as never))
      ;(nodes.find((x) => x.props?.['key'] === 'theme-name')!.props!['onInput'] as (v: string) => void)('u7')
      ;(nodes.find((x) => x.props?.['key'] === 'theme-save')!.props!['onPress'] as () => void)()
    },
    writesPastReload: false,
  },
  {
    // H:2401: the undo read is not wrapped — its refusal reaches the act
    // catch (H:2106), which must stay silent in the new state
    name: 'S1-FIX7 undo whose read refuses across register',
    stand: (store) => withRows({ store: UNDO_REFUSED(store) }, ['template', 'details', 'palette']),
    entries: PICKER_ENTRIES,
    setup: async (_h, $) => { await SL.restoreAfterReload(optStand($['store'] as never) as never, OPT_HUD as never); pressOn($, 'view', 'ax:palette:codex'); await drain(); pressOn($, 'view', 'save'); await drain() },
    op: async (_h, $) => { pressOn($, 'view', 'undo') },
    writesPastReload: false,
  },
  {
    // H:3103: a stale hint render must hand the event to the chain (next),
    // never return a tree built from the old state's values
    name: 'S1-FIX7 prompt hint render',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: async (handlers, $) => { await startDrained(handlers, $); SL.__render({ ...OPT_HUD, placement: 'hint' } as never) },
    op: (handlers, $) => handlers['ui.render']!($, { component: 'PromptHint', surface: 'terminal', requestId: 'hint', viewport: { columns: 120 }, props: { hint: 'x' } }, () => nextOf($)(undefined)),
    writesPastReload: false,
    check: (result) => { expect(result).toBeUndefined() },
  },
  {
    // H:2918-2921: a rejected chain arriving after the register is a stale
    // drop, never a fail diagnosis in the new state
    name: 'S1-FIX7 agent spawn whose chain throws',
    stand: (store) => sweepStand(store),
    entries: PICKER_ENTRIES,
    setup: startDrained,
    op: (handlers, $) => handlers['agent.spawn']!($, { subagentType: 'w' }, async () => { await nextOf($)({ id: 'a1' }); throw new Error('chain') }),
    writesPastReload: false,
  },
  {
    // the sysctl cmd tick (armed at 60000): runCmd's guard H:1702-1703 must
    // stop the tick before $.process.run across a reload
    name: 'S1-FIX7 cmd source tick across register',
    stand: (store) => chained(surfaced(optStand(store as never) as unknown as Engine)),
    entries: PICKER_ENTRIES,
    setup: async (_h, $) => {
      tickRuns.length = 0
      SL.__setArmEvery((ms: number, fn: () => void) => { if (ms === 60000) tickRuns.push(fn); return { cancel() {} } })
      SL.__render({ template: 'x={ram.text}' } as never)
      await SL.__syncSourceTimers($ as never)
      await drain()
      await drain()
    },
    op: async (_h, $) => {
      await SL.__refresh($ as never)
      for (const fn of tickRuns) fn()
    },
    writesPastReload: false,
  },
  {
    // the project-file tick (prd.json, armed at 10000; session.root answers
    // empty so session.cwd is the real base): runFile's guards
    // H:1669-1670/1680-1681/1687-1688 must stop the root-cwd-read chain
    name: 'S1-FIX7 project file source tick across register',
    stand: (store) => {
      const e = chained(surfaced(optStand(store as never) as unknown as Engine)) as Engine
      const s = e['session'] as Record<string, unknown>
      return { ...e, session: { ...s, root: async () => '', cwd: async () => '/work/demo' } }
    },
    entries: PICKER_ENTRIES,
    setup: async (_h, $) => {
      tickRuns.length = 0
      SL.__setArmEvery((ms: number, fn: () => void) => { if (ms === 10000) tickRuns.push(fn); return { cancel() {} } })
      SL.__render({ template: 'p={x-prd.text}' } as never)
      await SL.__syncSourceTimers($ as never)
      await drain()
      await drain()
    },
    op: async (_h, $) => {
      await SL.__refresh($ as never)
      for (const fn of tickRuns) fn()
    },
    writesPastReload: false,
  },
  {
    // the transcript tick (ctx, armed at 60000, path published by a submitted
    // prompt): runTranscript's guard H:1874-1875 must stop it before $.fs.read
    name: 'S1-FIX7 transcript source tick across register',
    stand: (store) => chained(surfaced(optStand(store as never) as unknown as Engine)),
    entries: PICKER_ENTRIES,
    setup: async (handlers, $) => {
      tickRuns.length = 0
      SL.__setArmEvery((ms: number, fn: () => void) => { if (ms === 60000) tickRuns.push(fn); return { cancel() {} } })
      await startDrained(handlers, $)
      SL.__render({ template: 'c={ctx.text}' } as never)
      await handlers['classic.UserPromptSubmit']!($, { transcript_path: '/work/t7b.jsonl' }, nextOf($))
      await drain()
      await drain()
    },
    op: async (_h, $) => {
      await SL.__refresh($ as never)
      for (const fn of tickRuns) fn()
    },
    writesPastReload: false,
  },
]

for (const c of SWEEP7) {
  test(c.name + ' — every await point across register leaves the new state alone', { timeoutMs: 15000 }, async () => {
    let points = 0
    try {
      for (let k = 1; k <= 400; k++) {
        SL.__resetState()
        const { on, handlers } = startHandlers()
        const sw = sweepEngine(c.stand(memStore(c.entries)))
        SL.register(on as never, OPT_HUD as never)
        await c.setup(handlers, sw.engine)
        sw.arm(k)
        const running = c.op(handlers, sw.engine).catch(() => undefined)
        await drain()
        if (!sw.parked()) {
          await running
          break
        }
        points++
        SL.register(on as never, OPT_HUD as never)
        const before = frozenState()
        const diagBefore = SL.__diag().length
        sw.mark()
        sw.open()
        const result = await running
        await drain()
        await drain()
        await drain()
        const keys = SL.__diag().slice(diagBefore).map((d) => d.key)
        expect({ k, changed: changedFields(before, frozenState()) }).toEqual({ k, changed: [] })
        expect({ k, diag: keys.filter((key) => !key.startsWith('stale-')) }).toEqual({ k, diag: [] })
        if (c.check) c.check(result, keys)
        if (!c.writesPastReload) expect({ k, writes: sw.lateWrites() }).toEqual({ k, writes: [] })
        if (!c.writesPastReload) expect({ k, late: sw.lateCalls().filter((name) => !LATE_OK.includes(name)) }).toEqual({ k, late: [] })
      }
      expect(points).toBeGreaterThan(0)
      console.log('[S1-FIX7] ' + c.name + ': await points swept = ' + points)
    } finally {
      SL.__resetState()
      SL.__setArmEvery(null)
    }
  })
}

// ---------- S1-FIX7 manual teeth (windows a single-park sweep cannot form) ----------
// These scenarios need a SECOND register or new-state activity between the
// park and the release; the U21/U23 loop puts exactly one register between
// them (T sweep body), so each runs the state machine by hand.

test('S1-FIX7 U24: a theme-save reread across the second register is dropped aloud and redraws nothing', { timeoutMs: 15000 }, async () => {
  const phase = async (mode: 'restore' | 'themes'): Promise<void> => {
    SL.__resetState()
    const { on, handlers } = startHandlers()
    const gateSet = gateOf()
    const gateWait = gateOf()
    let setParked = false
    let armWait = false
    let themesReads = 0
    let invalidations = 0
    const store = {
      get: async (k: string): Promise<unknown> => {
        if (k === STORE_THEMES) {
          themesReads++
          if (mode === 'themes' && themesReads === 3) await gateWait.p
          return undefined
        }
        if (k === STORE_LASTGOOD) {
          if (armWait) await gateWait.p
          return HUD_GOOD
        }
        return undefined
      },
      set: async (k: string, _v: unknown): Promise<void> => {
        if (k === STORE_THEMES && !setParked) { setParked = true; await gateSet.p }
      },
      delete: async (): Promise<void> => undefined,
    }
    const base = optStand(store)
    const $ = { ...base, ui: { ...base.ui, invalidate: () => { invalidations++ } } }
    try {
      SL.register(on as never, OPT_HUD as never)
      await startOn(handlers, $ as never)
      await drain()
      const viewNodes = walk(SL.__renderPicker(OPT_HUD, 'view', 120, undefined, store as never, $ as never))
      ;(viewNodes.find((x) => x.props?.['key'] === 'ax:palette:codex')!.props!['onPress'] as () => void)()
      await drain()
      const themeNodes = walk(SL.__renderPicker(OPT_HUD, 'themes', 120, undefined, store as never, $ as never))
      ;(themeNodes.find((x) => x.props?.['key'] === 'theme-name')!.props!['onInput'] as (v: string) => void)('u2')
      ;(themeNodes.find((x) => x.props?.['key'] === 'theme-save')!.props!['onPress'] as () => void)()
      await drain()
      expect(setParked).toBe(true)
      SL.register(on as never, OPT_HUD as never)
      armWait = mode === 'restore'
      await startOn(handlers, $ as never)
      await drain()
      gateSet.open()
      await drain()
      await drain()
      if (mode === 'restore') expect({ mode, themesReads }).toEqual({ mode, themesReads: 1 })
      if (mode === 'themes') expect({ mode, themesReads }).toEqual({ mode, themesReads: 3 })
      const diagBefore = SL.__diag().length
      const invBefore = invalidations
      SL.register(on as never, OPT_HUD as never)
      gateWait.open()
      await drain()
      await drain()
      await drain()
      const keys = SL.__diag().slice(diagBefore).map((d) => d.key)
      expect({ mode, staleDiag: keys.filter((key) => !key.startsWith('stale-')) }).toEqual({ mode, staleDiag: [] })
      if (mode === 'restore') {
        // H:2514: the reread woken after the second register says its own name
        expect({ mode, reread: keys.filter((key) => key === 'stale-themes reread').length }).toEqual({ mode, reread: 1 })
      }
      // H:2516: the dead reread must not redraw the live state
      expect({ mode, invalidate: invalidations - invBefore }).toEqual({ mode, invalidate: 0 })
    } finally {
      SL.__resetState()
    }
  }
  await phase('restore')
  await phase('themes')
})

test('S1-FIX7 U25: a stale clock resolve cannot clear the failed clock of the new state', { timeoutMs: 15000 }, async () => {
  SL.__resetState()
  const { on } = startHandlers()
  const gate = gateOf()
  const OPTS = { ...OPT_HUD, numDuration: 'clock' }
  let first = true
  const $ = { ...optStand(recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {} })), clock: { now: async (): Promise<number> => { if (first) { first = false; await gate.p } return 5000 }, every: () => ({ cancel() {} }) } }
  const poison = { ...optStand(recStore({})), clock: { now: async (): Promise<number> => { throw new Error('no-clock') }, every: () => ({ cancel() {} }) } }
  try {
    SL.register(on as never, OPTS as never)
    const refreshing = SL.__refresh($ as never)
    await drain()
    SL.register(on as never, OPTS as never)
    await SL.__refresh(poison as never)
    await drain()
    await drain()
    const before = frozenState()
    const diagBefore = SL.__diag().length
    expect(SL.__stateSnapshot()['clockFailed']).toBe(true)
    gate.open()
    await refreshing
    await drain()
    await drain()
    await drain()
    // H:498: the resolve path of a dead read returns the stamp untouched — it
    // must not clear the new state's clock failure nor dirty its picture
    expect({ changed: changedFields(before, frozenState()) }).toEqual({ changed: [] })
    expect({ diag: SL.__diag().slice(diagBefore).map((d) => d.key).filter((key) => !key.startsWith('stale-')) }).toEqual({ diag: [] })
  } finally {
    SL.__resetState()
  }
})

test('S1-FIX7 U26: a stale refused clock read says nothing and poisons nothing', { timeoutMs: 15000 }, async () => {
  SL.__resetState()
  const { on } = startHandlers()
  const gate = gateOf()
  let first = true
  const $ = { ...optStand(recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {} })), clock: { now: async (): Promise<number> => { if (first) { first = false; await gate.p; throw new Error('late-refused') } return 5000 }, every: () => ({ cancel() {} }) } }
  try {
    SL.register(on as never, OPT_HUD as never)
    const refreshing = SL.__refresh($ as never)
    await drain()
    SL.register(on as never, OPT_HUD as never)
    const before = frozenState()
    const diagBefore = SL.__diag().length
    gate.open()
    await refreshing
    await drain()
    await drain()
    await drain()
    // H:506: the catch of a dead read stays silent — no 'clock-now' record,
    // no clockFailed, no picture dirt in the new state
    expect({ changed: changedFields(before, frozenState()) }).toEqual({ changed: [] })
    expect({ diag: SL.__diag().slice(diagBefore).map((d) => d.key).filter((key) => !key.startsWith('stale-')) }).toEqual({ diag: [] })
  } finally {
    SL.__resetState()
  }
})

test('S1-FIX7 U27: a stale refresh cannot reap the live timer of the new state', { timeoutMs: 15000 }, async () => {
  SL.__resetState()
  const { on } = startHandlers()
  const gate = gateOf()
  const OPTS = { ...OPT_HUD, numDuration: 'clock', details: 'off' }
  let clockCalls = 0
  const $ = { ...optStand(recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {} })), clock: { now: async (): Promise<number> => { clockCalls++; if (clockCalls === 1) { await gate.p; return 9000 } return 5000 }, every: () => ({ cancel() {} }) } }
  try {
    SL.__setArmEvery(() => ({ cancel() {} }))
    SL.register(on as never, OPTS as never)
    const refreshing = SL.__refresh($ as never)
    await drain()
    SL.register(on as never, OPTS as never)
    // the new state arms its own clock timer at lastTick 5000; the stale read
    // resolves 9000, which makes it look dead — but the stale refresh must not
    // decide that (H:1971)
    await SL.__syncSourceTimers($ as never)
    await drain()
    await drain()
    const before = frozenState()
    const diagBefore = SL.__diag().length
    expect((SL.__stateSnapshot()['timers'] as unknown[]).length).toBeGreaterThan(0)
    gate.open()
    await refreshing
    await drain()
    await drain()
    await drain()
    expect({ changed: changedFields(before, frozenState()) }).toEqual({ changed: [] })
    expect({ diag: SL.__diag().slice(diagBefore).map((d) => d.key).filter((key) => !key.startsWith('stale-')) }).toEqual({ diag: [] })
  } finally {
    SL.__resetState()
    SL.__setArmEvery(null)
  }
})

test('S1-FIX7 U28: a refresh that went stale inside the rearm sync ships nothing and takes no ticket', { timeoutMs: 15000 }, async () => {
  SL.__resetState()
  const { on } = startHandlers()
  const gate = gateOf()
  const OPTS = { ...OPT_HUD, numDuration: 'clock', details: 'off' }
  const logs: string[] = []
  let clockCalls = 0
  const base = optStand(recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {} }))
  const $ = {
    ...base,
    ui: { ...base.ui, log: (t: string): void => { logs.push(t) } },
    clock: { now: async (): Promise<number> => { clockCalls++; if (clockCalls === 4) { await gate.p; return 7000 } if (clockCalls === 3) return 7000; return 5000 }, every: () => ({ cancel() {} }) },
  }
  try {
    SL.__setArmEvery(() => { throw new Error('arm-refused') })
    SL.register(on as never, OPTS as never)
    await SL.__syncSourceTimers($ as never)
    await drain()
    // gen1 carries a refused arm due 6000; the refresh reads 7000 -> rearm,
    // and its queued sync parks until after the second register (H:1984/1985)
    const refreshing = SL.__refresh($ as never)
    await drain()
    SL.register(on as never, OPTS as never)
    const before = frozenState()
    const diagBefore = SL.__diag().length
    const logsBefore = logs.length
    gate.open()
    await refreshing
    await drain()
    await drain()
    await drain()
    expect({ changed: changedFields(before, frozenState()) }).toEqual({ changed: [] })
    expect({ diag: SL.__diag().slice(diagBefore).map((d) => d.key).filter((key) => !key.startsWith('stale-')) }).toEqual({ diag: [] })
    expect({ logs: logs.length - logsBefore }).toEqual({ logs: 0 })
  } finally {
    SL.__resetState()
    SL.__setArmEvery(null)
  }
})

test('S1-FIX7 U29: a picker open stale at the draft persist writes no draft into the new state', { timeoutMs: 15000 }, async () => {
  SL.__resetState()
  const { on, handlers } = startHandlers()
  const gate = gateOf()
  const stored = { session: 'f4', lines: [[]], axes: { palette: 'semantic' }, elements: {}, focus: null, tab: 'view', query: '', fam: 'all', targetLine: 0, themeName: '' }
  const entries: Record<string, unknown> = { [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {}, [STORE_OPEN]: { session: 'f4' }, [STORE_DRAFT]: stored }
  const writes: Array<{ key: string; value: unknown }> = []
  let armSet = true
  const store = {
    get: async (k: string): Promise<unknown> => entries[k],
    set: async (k: string, v: unknown): Promise<void> => {
      writes.push({ key: k, value: JSON.parse(JSON.stringify(v ?? null)) })
      if (k === STORE_OPEN && armSet) { armSet = false; await gate.p }
    },
    delete: async (k: string): Promise<void> => { delete entries[k] },
  }
  const $ = interactiveStand(store)
  try {
    SL.register(on as never, OPT_HUD as never)
    await startOn(handlers, $ as never)
    await drain()
    // gen1 restores the picker WITH a draft, then opens across the register
    const opening1 = commandOn(handlers, $ as never, '')
    await drain()
    expect(armSet).toBe(false)
    SL.register(on as never, OPT_HUD as never)
    // the new state opens its own picker: freshDraft + its persist
    await commandOn(handlers, $ as never, '')
    await drain()
    const writesBefore = writes.length
    gate.open()
    await opening1
    await drain()
    await drain()
    await drain()
    // H:2153: a draft written after the persist belongs to the dead open
    expect({ draftWrites: writes.slice(writesBefore).filter((w) => w.key === STORE_DRAFT).length }).toEqual({ draftWrites: 0 })
  } finally {
    SL.__resetState()
  }
})

// The tick guards H:1922/1924/1930 parked at each of their own awaits: every
// phase holds ONE late await across the register and counts the engine calls
// the continuation makes after it — the tick must stop at its guard.
test('S1-FIX7 U30: the captured source tick stops at each of its three guards', { timeoutMs: 15000 }, async () => {
  const phase = async (parkOn: 'entry' | 'clock' | 'source'): Promise<void> => {
    SL.__resetState()
    tickRuns.length = 0
    const { on } = startHandlers()
    const OPTS = { template: 'x={ram.text}' }
    const gate = gateOf()
    let mode: 'none' | 'clock' | 'source' = 'none'
    let parked = false
    let afterReg = false
    let lateClock = 0
    let lateRun = 0
    let lateInvalidate = 0
    const base = optStand(recStore({ [STORE_LASTGOOD]: HUD_GOOD, [STORE_THEMES]: {} }))
    const $ = {
      ...base,
      ui: { ...base.ui, invalidate: () => { if (afterReg) lateInvalidate++ } },
      clock: { now: async (): Promise<number> => { if (afterReg) lateClock++; if (mode === 'clock' && !parked) { parked = true; await gate.p } return 5000 }, every: () => ({ cancel() {} }) },
      process: { run: async (): Promise<unknown> => { if (afterReg) lateRun++; if (mode === 'source' && !parked) { parked = true; await gate.p } return { exitCode: 0, stdout: '', stderr: '' } } },
    }
    try {
      // the sysctl cmd source is the only 'ram' source armed at 60000 — its
      // tick reaches runCmd's $.process.run; other arms of this layout do not
      SL.__setArmEvery((ms: number, fn: () => void) => { if (ms === 60000) tickRuns.push(fn); return { cancel() {} } })
      SL.register(on as never, OPTS as never)
      await SL.__syncSourceTimers($ as never)
      await drain()
      await drain()
      expect(tickRuns.length).toBe(1)
      const fn = tickRuns[0]!
      let before = frozenState()
      let diagBefore = 0
      if (parkOn === 'entry') {
        SL.register(on as never, OPTS as never)
        before = frozenState()
        diagBefore = SL.__diag().length
        afterReg = true
        fn()
      } else {
        mode = parkOn
        fn()
        await drain()
        expect({ parkOn, parked }).toEqual({ parkOn, parked: true })
        SL.register(on as never, OPTS as never)
        before = frozenState()
        diagBefore = SL.__diag().length
        afterReg = true
        gate.open()
      }
      await drain()
      await drain()
      await drain()
      expect({ parkOn, changed: changedFields(before, frozenState()) }).toEqual({ parkOn, changed: [] })
      expect({ parkOn, lateClock }).toEqual({ parkOn, lateClock: 0 })
      expect({ parkOn, lateRun }).toEqual({ parkOn, lateRun: 0 })
      expect({ parkOn, lateInvalidate }).toEqual({ parkOn, lateInvalidate: 0 })
      expect({ parkOn, diag: SL.__diag().slice(diagBefore).map((d) => d.key).filter((key) => !key.startsWith('stale-')) }).toEqual({ parkOn, diag: [] })
    } finally {
      SL.__resetState()
      SL.__setArmEvery(null)
      tickRuns.length = 0
    }
  }
  await phase('entry')
  await phase('clock')
  await phase('source')
})

// U22 (S1-FIX6): a control drawn by an older state is pressed after register —
// the press acts on nothing, is dropped aloud, and the pane is redrawn
test('S1-FIX6 U22: a press on a picker tree drawn before register acts on nothing and redraws', async () => {
  SL.__resetState()
  const { on } = startHandlers()
  const store = memStore(PICKER_ENTRIES)
  const writes: string[] = []
  let invalidations = 0
  const eng: Engine = {
    store: { get: store.get, set: async (k: string, v: unknown) => { writes.push(k); return store.set(k, v) }, delete: async (k: string) => { writes.push('delete ' + k); return store.delete(k) } },
    ui: { log: async () => undefined, invalidate: () => { invalidations++ } },
  }
  try {
    SL.register(on as never, OPT_HUD as never)
    await SL.restoreAfterReload(optStand(eng['store'] as never) as never, OPT_HUD as never)
    const nodes = walk(SL.__renderPicker(OPT_HUD, 'view', 120, undefined, eng['store'] as never, eng))
    const press = nodes.find((x) => x.props?.['key'] === 'ax:palette:codex')
    expect(press).toBeDefined()
    SL.register(on as never, OPT_HUD as never)
    const before = frozenState()
    const diagBefore = SL.__diag().length
    writes.length = 0
    invalidations = 0
    ;(press!.props!['onPress'] as () => void)()
    await drain()
    await drain()
    expect(changedFields(before, frozenState())).toEqual([])
    expect(SL.__diag().slice(diagBefore).map((d) => d.key)).toEqual(['stale-picker action'])
    expect(writes).toEqual([])
    expect(invalidations).toBe(1)
  } finally {
    SL.__resetState()
  }
})
