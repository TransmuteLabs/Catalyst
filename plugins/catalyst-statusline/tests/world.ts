import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

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
export const STORE_DRAFT = 'statusline.draft.v1'
export const STORE_SAVING = 'statusline.saving.v1'
export const STORE_UNDO = 'statusline.undo.v1'
export const STORE_LASTGOOD = 'statusline.lastgood.v1'
export const STORE_THEMES = 'statusline.themes.v1'

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
    'config.list': () => ({ value: OPTION_ROWS.map((row) => ({ ...row })) }),
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
