import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { world, start, command, PANE_MOUNT, walk, textOf, STORE_DRAFT, STORE_OPEN, SESSION_ID } from './world'
import type { Node, World } from './world'

// #521 FIX3 teeth (ADJUDICATION of FIX2: AR-1, AR-2, AR-3). CONSTRAINT
// (ANALYSIS-521-swe2 traps 1-2): a kit pane is drawn by the kit's own plugin
// instance — it is read through the drawn tree; the stand teeth drive the
// imported module and read it back through its own seams.

type Pane = {
  drawn: () => Promise<unknown>
  find: (q: Record<string, unknown>) => Promise<unknown>
  press: (t: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const drain = async (): Promise<void> => { for (let i = 0; i < 60; i++) await Promise.resolve() }
const settle = async (w: World): Promise<void> => { await w.clock.settle(); await drain() }
const textsOf = (nodes: Node[]): string[] => nodes.filter((n) => n.type === 'Text').map(textOf)
const nodesOf = async (pane: Pane): Promise<Node[]> => walk((await pane.drawn()) as Node)
const barText = (template: string): string => textsOf(walk(SL.__render({ template, details: 'off' }) as Node)).join('')

// the stand the gather and the source timers run against
const gatherStand = (root: () => Promise<string>): any => ({
  clock: { now: async () => 5000, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  ui: { log: async () => undefined, invalidate: () => undefined, status: () => undefined, toast: () => undefined },
  store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
  session: {
    id: async () => 'A',
    cwd: async () => '/work/demo/sub',
    root,
    usage: async () => ({ context: { tokens: 1, window: 2 }, rateLimits: [], cost: { usd: 0 } }),
    model: async () => 'm',
    turns: async () => 0,
    messages: async () => [],
  },
  env: { get: async () => '' },
  fs: { read: async () => '# x\n' },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  config: { list: async () => [], set: async () => undefined },
  plugin: { name: 'catalyst-statusline', root: '/stand' },
})

const rootKnown = async (): Promise<string> => '/work/demo'
const rootRefused = async (): Promise<string> => { throw new Error('root refused by the test') }

// ---------- AR-1: a refused root is visible on the elements it feeds ----------

// the base family's state as the module holds it (a live reference)
const baseState = (): any => ((SL.__stateSnapshot().famStates ?? []) as [unknown, any][]).map(([, st]) => st).find((st) => st && typeof st === 'object' && 'cfgFiles' in st && 'root' in st)

type Seen = { text: string; reads: string[]; state: any }

const cfgWith = async (root: () => Promise<string>): Promise<Seen> => {
  SL.__resetState()
  const runs: Array<() => void> = []
  SL.__setArmEvery((_ms: number, fn: () => void) => { runs.push(fn); return { cancel() {} } })
  try {
    const reads: string[] = []
    const $ = { ...gatherStand(root), fs: { read: async (path: string) => { reads.push(path); return '# x\n' } } }
    SL.__render({ template: 'cfg', details: 'off' })
    await SL.__syncSourceTimers($)
    await drain()
    for (const fn of runs.slice()) fn()
    for (let i = 0; i < 4; i++) await drain()
    return { text: barText('cfg'), reads, state: JSON.parse(JSON.stringify(baseState() ?? null)) }
  } finally {
    SL.__setArmEvery(null)
    SL.__resetState()
  }
}

test('#521 FIX3 AR-1: the project CLAUDE.md read from the cwd after a refused root marks the cfg text (cwd?); a known root does not', async () => {
  const known = await cfgWith(rootKnown)
  expect(known.text).toContain('1 CLAUDE.md')
  expect(known.text).not.toContain('(cwd?)')
  expect(known.state?.cfgFiles?.mdProjectFromCwd).toBe(false)
  const guessed = await cfgWith(rootRefused)
  expect(guessed.reads).toContain('/work/demo/sub/CLAUDE.md')
  expect(guessed.state?.cfgFiles?.mdProjectFromCwd).toBe(true)
  expect(guessed.text).toContain('1 CLAUDE.md (cwd?)')
})

const GIT_SOURCE = { kind: 'cmd', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], everyMs: 8000, cwd: 'project' } as const

const gitWith = async (root: () => Promise<string>): Promise<Omit<Seen, 'reads'> & { git: string }> => {
  SL.__resetState()
  try {
    const $ = gatherStand(root)
    SL.__render({ template: 'git-branch', details: 'off' })
    await SL.__refresh($)
    await drain()
    SL.__feed({ source: GIT_SOURCE as any, ok: true, data: { code: 0, stdout: 'main\n', stderr: '' }, now: 5000 })
    const state = JSON.parse(JSON.stringify(baseState() ?? null))
    return { text: barText('git-branch'), git: barText('git'), state }
  } finally {
    SL.__resetState()
  }
}

test('#521 FIX3 AR-1: the gather keeps the cwd as the plain root beside rootDegraded; git and git-branch draw it with (cwd?); a known root does not', async () => {
  const known = await gitWith(rootKnown)
  expect(known.state?.root).toBe('/work/demo')
  expect(known.state?.rootDegraded).toBe(false)
  expect(known.text).toContain('demo(main)')
  expect(known.git).toContain('demo(main)')
  expect(known.text + known.git).not.toContain('(cwd?)')
  const guessed = await gitWith(rootRefused)
  expect(guessed.state?.root).toBe('/work/demo/sub')
  expect(guessed.state?.rootDegraded).toBe(true)
  expect(guessed.text).toContain('sub (cwd?)(main)')
  expect(guessed.git).toContain('sub (cwd?)(main)')
})

// ---------- AR-2: the search field is not a setting ----------

test('#521 FIX3 AR-2: on mobile the search field says it is unavailable and names no /config row', async ($, on) => {
  const w = world(on)
  await start($)
  await settle(w)
  await command($)
  await settle(w)
  const pane = (await $.ui.mount({ ...PANE_MOUNT, surface: 'mobile' as any, props: { ...PANE_MOUNT.props, bodyColumns: 140 } })) as Pane
  await settle(w)
  await pane.press({ key: 'tab:elements' })
  await settle(w)
  const texts = textsOf(await nodesOf(pane))
  expect(texts).toContain('поиск здесь недоступен')
  expect(texts.some((t) => t.includes('/config catalyst-statusline.template'))).toBe(false)
  expect((await nodesOf(pane)).filter((n) => n.type === 'Input')).toEqual([])
})

// ---------- AR-3: the restore redraws the open panel ----------

test('#521 FIX3 AR-3: a pane mounted before the reload restore ends draws the restored draft once the restore lands, with no clock settle', async ($, on) => {
  world(on, {}, {
    [STORE_OPEN]: { session: SESSION_ID, at: Date.now() },
    [STORE_DRAFT]: { session: SESSION_ID, lines: [[{ id: 'cost', body: '{cost.text}' }]], axes: { theme: 'hud' }, elements: {}, focus: null, tab: 'layout', query: '', fam: 'all', targetLine: 0, themeName: '' },
  })
  await start($)
  const pane = (await $.ui.mount(PANE_MOUNT)) as Pane
  expect(await pane.find({ key: 'seg:cost' })).toBeDefined()
})
