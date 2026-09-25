import { expect, test } from 'claude-code/testing'
import act from '../hooks/data/activity'
import type { FormatArgs, Input, Source } from '../hooks/data/types'

// The activity family (T-act): agents, tools, session/turn events, runtime
// counters and the sdlc-workflow artifacts. Pure collector tests: every number
// in an expected string is derived from the fixture through the local nf, never
// copied from a previous run's output.

const nf = {
  tokens: (n: number) => String(n),
  usd: (n: number) => '$' + String(n),
  percent: (r: number) => String(Math.round(r * 1000) / 10) + '%',
  duration: (ms: number) =>
    ms < 60000 ? String(Math.round(ms / 1000)) + 's' : String(Math.floor(ms / 60000)) + 'm ' + String(Math.round((ms % 60000) / 1000)) + 's',
  bytes: (n: number) => String(n),
  count: (n: number) => String(n),
  rate: (n: number, u: string) => String(n) + '/' + u,
}

type S = ReturnType<typeof act.init>
const args = (variant = '', options: Record<string, unknown> = {}): FormatArgs => ({ variant, options, nf })
const feed = (s: S, source: Source, data: unknown, now: number, ok = true): S => act.reduce(s, { source, ok, data, now } as Input)
const val = (s: S, elementId: string, a: FormatArgs = args()) => act.value(s, elementId, a)
const text = (s: S, elementId: string, a: FormatArgs = args()): string => {
  const v = val(s, elementId, a)
  expect(v.state).toBe('ok')
  return (v as { text: string }).text
}

const E = {
  sessionStart: { kind: 'event', event: 'session.start' },
  turnStart: { kind: 'event', event: 'turn.start' },
  turnStep: { kind: 'event', event: 'turn.step' },
  turnComplete: { kind: 'event', event: 'turn.complete' },
  toolCall: { kind: 'event', event: 'tool.call' },
  agentSpawn: { kind: 'event', event: 'agent.spawn' },
  configSet: { kind: 'event', event: 'config.set' },
  messages: { kind: 'session', call: 'messages' },
  usage: { kind: 'session', call: 'usage' },
  clock: { kind: 'clock', everyMs: 1000 },
} as const

const ps = { kind: 'cmd', argv: ['ps', '-Axo', '%cpu=,rss=,command='], everyMs: 5000 }
const wfIndex = { kind: 'cmd', argv: ['find', '.ai/workflows', '-maxdepth', '2', '-name', '00-index.md', '-print', '-exec', 'cat', '{}', ';'], everyMs: 10000, cwd: 'project' } as const
const wfDriver = { kind: 'cmd', argv: ['find', '.ai/workflows', '-maxdepth', '2', '-name', '.driver-journal.jsonl', '-print', '-exec', 'cat', '{}', ';'], everyMs: 10000, cwd: 'project' } as const
const wfCost = { kind: 'cmd', argv: ['find', '.ai/workflows', '-maxdepth', '2', '-name', 'cost.jsonl', '-print', '-exec', 'cat', '{}', ';'], everyMs: 30000, cwd: 'project' } as const
const wfReview = { kind: 'cmd', argv: ['find', '.ai/workflows', '-maxdepth', '2', '(', '-name', '07-review*.yaml', '-o', '-name', '07-review*.md', ')', '-print', '-exec', 'cat', '{}', ';'], everyMs: 30000, cwd: 'project' } as const
const shipPlan = { kind: 'file', path: '.ai/ship-plan-audit.md', everyMs: 30000, relativeTo: 'project' } as const
const projectDoc = (p: string) => ({ kind: 'file', path: p, everyMs: 30000, relativeTo: 'project' }) as const

const spawn1 = { tool_use_id: 'tu1', prompt: 'criticise the delta', description: 'delta critic', subagentType: 'glm-executor', model: 'glm-5.3', parentModel: 'fable', background: true, fork: false }
const spawn2 = { tool_use_id: 'tu2', prompt: 'p2', description: 'second look', subagentType: 'Explore', parentModel: 'fable', background: false, fork: false }
const msg = (role: 'user' | 'assistant', textValue: string, toolUses: unknown[] = []): unknown => ({ role, text: textValue, toolUses })
const agentUse = (over: Record<string, unknown>): unknown => ({ tool_use_id: 'tu1', tool: 'Agent', input: {}, ...over })

// ---------------------------------------------------------------- registry shape

test('act/registry: every E line of the T-act range lands exactly once and ids are a- prefixed', async () => {
  const ids = new Set<string>()
  const placed: string[] = []
  for (const el of act.elements) {
    expect(ids.has(el.id)).toBe(false)
    ids.add(el.id)
    expect(el.id.startsWith('a-')).toBe(true)
    expect(el.label.length > 0).toBe(true)
    expect(el.about.length > 0).toBe(true)
    expect(el.sample.length > 0).toBe(true)
    expect(el.variants.length > 0).toBe(true)
    placed.push(...el.catalogue)
    for (const v of el.variants) placed.push(...(v.catalogue ?? []))
  }
  for (const group of act.variantsFor ?? []) for (const v of group.variants) placed.push(...(v.catalogue ?? []))
  const dupes = placed.filter((c, i) => placed.indexOf(c) !== i)
  expect(dupes).toEqual([])
  const range: string[] = []
  const push = (a: number, b: number): void => { for (let n = a; n <= b; n += 1) range.push('E' + String(n).padStart(3, '0')) }
  push(130, 132); push(138, 139); push(170, 172); range.push('E175'); push(230, 263); range.push('E307'); push(370, 372); push(418, 419); push(448, 453); push(538, 579)
  expect([...placed].sort()).toEqual([...range].sort())
})

test('act/registry: every element is fed by a declared source and N elements carry the table reason', async () => {
  const fed = new Set<string>()
  for (const src of act.sources) for (const el of src.elements) fed.add(el)
  for (const el of act.elements) if (el.outcome === 'C') expect(fed.has(el.id)).toBe(true)
  const ns = act.elements.filter((el) => el.outcome === 'N')
  expect(ns.length).toBe(13)
  for (const el of ns) expect(el.reason ?? '').not.toBe('')
})

test('act/pending: no element shows a value or zero before its first input', async () => {
  const s = act.init()
  for (const el of act.elements) {
    const v = val(s, el.id)
    expect(v.state === 'pending' || v.state === 'nosource').toBe(true)
    if (v.state === 'pending') expect(JSON.stringify(v)).toBe('{"state":"pending"}')
  }
  const flow = val(s, 'ag', args('flow'))
  expect(flow.state).toBe('pending')
})

// ---------------------------------------------------------------- agents

test('act/agents: a spawn, its activity and the transcript binding become one row', async () => {
  let s = act.init()
  s = feed(s, E.agentSpawn, spawn1, 1_000_000)
  s = feed(s, E.toolCall, { tool: 'Bash', tool_use_id: 'x1', agentId: 'ag1', command: 'ls' }, 1_010_000)
  s = feed(s, E.turnStep, { turnId: 't1', index: 0, model: 'glm-5.3-x', messageCount: 3, agentId: 'ag1' }, 1_011_000)
  s = feed(s, E.messages, [msg('assistant', 'a', [agentUse({ agentId: 'ag1', text: 'done', durationMs: 50_000 })])], 1_050_000)
  s = feed(s, E.clock, undefined, 1_050_000)
  const v = val(s, 'a-agents', args('rows', { maxRows: 5, detail: 'full' }))
  expect(v.state).toBe('ok')
  const rows = (v as { rows?: { label: string; right?: string; detail?: string }[] }).rows ?? []
  expect(rows.length).toBe(1)
  const row = rows[0]!
  expect(row.label).toContain('glm-executor')
  expect(row.label).toContain('delta critic')
  expect(row.right).toContain(nf.duration(50_000))
  expect(row.right).toContain('×' + nf.count(1))
  expect(row.detail).toContain('glm-5.3-x')
  expect(row.detail).toContain('background')
})

test('act/agents: an unknown agentId stays unlisted until a binding names it', async () => {
  let s = act.init()
  s = feed(s, E.toolCall, { tool: 'Bash', tool_use_id: 'y1', agentId: 'ghost' }, 5_000)
  s = feed(s, E.clock, undefined, 65_000)
  const flow = text(s, 'ag', args('flow'))
  expect(flow).toBe('Agent flow · ' + nf.count(1) + ' agents · ' + nf.count(1) + ' running · ' + nf.count(0) + ' waiting · ' + nf.count(1) + ' unlisted')
  const v = val(s, 'a-agents')
  const rows = (v as { rows?: { detail?: string }[] }).rows ?? []
  expect(rows.length).toBe(1)
  expect(rows[0]!.detail === undefined || rows[0]!.detail.includes('unlisted')).toBe(true)
})

test('act/agents: failed agents come from the isError of the Agent tool use', async () => {
  let s = act.init()
  s = feed(s, E.agentSpawn, spawn1, 1_000)
  s = feed(s, E.messages, [msg('assistant', 'a', [agentUse({ agentId: 'ag9', text: 'boom', isError: true })])], 2_000)
  expect(text(s, 'ag', args('router'))).toBe(nf.count(0) + ' running · ' + nf.count(0) + ' completed · ' + nf.count(1) + ' failed')
})

test('act/agents: the flow and router variants count the same registry two ways', async () => {
  let s = act.init()
  s = feed(s, E.agentSpawn, spawn1, 1_000)
  s = feed(s, E.agentSpawn, spawn2, 2_000)
  s = feed(s, E.messages, [msg('assistant', 'a', [agentUse({ agentId: 'ag1', text: 'done', durationMs: 5_000 }), { tool_use_id: 'tu2', tool: 'Agent', input: {}, agentId: 'ag2' }])], 3_000)
  s = feed(s, E.toolCall, { tool: 'AskUserQuestion', tool_use_id: 'q1', agentId: 'ag2' }, 4_000)
  s = feed(s, E.clock, undefined, 4_500)
  expect(text(s, 'ag', args('flow'))).toBe('Agent flow · 2 agents · 1 running · 1 waiting · 0 unlisted')
  expect(text(s, 'ag', args('router'))).toBe('1 running · 1 completed · 0 failed')
})

test('act/agents: a tool over 30s is slow, silence over 120s is quiet', async () => {
  let s = act.init()
  s = feed(s, E.agentSpawn, spawn1, 0)
  s = feed(s, E.toolCall, { tool: 'Bash', tool_use_id: 'z1', agentId: 'ag1' }, 1_000)
  s = feed(s, E.clock, undefined, 32_000)
  let v = val(s, 'a-agents')
  expect(((v as { rows?: { detail?: string }[] }).rows ?? [])[0]!.detail).toContain('slow')
  let s2 = act.init()
  s2 = feed(s2, E.agentSpawn, spawn1, 0)
  s2 = feed(s2, E.clock, undefined, 121_000)
  v = val(s2, 'a-agents')
  expect(((v as { rows?: { detail?: string }[] }).rows ?? [])[0]!.detail).toContain('quiet')
})

test('act/agents: per-agent tokens arrive with the input-shaped turn.complete and stay formatted by nf', async () => {
  let s = act.init()
  s = feed(s, E.agentSpawn, spawn1, 1_000)
  s = feed(s, E.turnComplete, { text: 'ok', reason: 'answer', turnId: 't1', agentId: 'ag1', usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, model: 'glm-5.3' } }, 9_000)
  const v = val(s, 'a-agents', args('rows', { detail: 'full' }))
  const detail = ((v as { rows?: { detail?: string }[] }).rows ?? [])[0]!.detail ?? ''
  expect(detail).toContain('in ' + nf.tokens(120))
  expect(detail).toContain('out ' + nf.tokens(30))
  expect(detail).toContain('cache ' + nf.tokens(10) + '/' + nf.tokens(5))
})

test('act/waiting: the count names the agents, the who variant names the tools', async () => {
  let s = act.init()
  s = feed(s, E.agentSpawn, spawn1, 1_000)
  s = feed(s, E.toolCall, { tool: 'AskUserQuestion', tool_use_id: 'q1', agentId: 'ag1' }, 2_000)
  expect(text(s, 'a-waiting', args('count'))).toBe('1 agents waiting for approval')
  expect(text(s, 'a-waiting', args('who'))).toBe('waiting for approval: AskUserQuestion')
  s = feed(s, E.messages, [msg('assistant', 'a', [agentUse({ agentId: 'ag1', text: 'answered' })])], 3_000)
  expect(text(s, 'a-waiting', args('count'))).toBe('none waiting')
})

// ---------------------------------------------------------------- session and turn

test('act/session-status: idle, busy, WAITING follow the observed events', async () => {
  let s = act.init()
  s = feed(s, E.sessionStart, { cwd: '/w', surface: 'terminal', isInteractive: true }, 1_000)
  expect(text(s, 'a-session-status', args('dict'))).toBe('idle')
  expect(text(s, 'a-session-status', args('root'))).toBe('idle')
  s = feed(s, E.turnStart, { text: 'hi', turnId: 't1' }, 2_000)
  expect(text(s, 'a-session-status', args('dict'))).toBe('busy')
  s = feed(s, E.toolCall, { tool: 'AskUserQuestion', tool_use_id: 'q9' }, 3_000)
  expect(text(s, 'a-session-status', args('dict'))).toBe('WAITING')
  s = feed(s, E.turnComplete, { text: 'ok' }, 4_000)
  expect(text(s, 'a-session-status', args('dict'))).toBe('idle')
})

test('act/turn-num: own marks and the user-message count are two variants of one quantity', async () => {
  let s = act.init()
  s = feed(s, E.turnStart, { text: 'one', turnId: 't1' }, 1_000)
  s = feed(s, E.turnStart, { text: 'two', turnId: 't2' }, 2_000)
  expect(text(s, 'a-turn-num', args('count'))).toBe('turn 2')
  s = feed(s, E.messages, [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c'), msg('assistant', 'd'), msg('user', 'e')], 3_000)
  expect(text(s, 'a-turn-num', args('messages'))).toBe('turn 3')
})

test('act/turn-time: live while the turn runs, frozen at its end', async () => {
  let s = act.init()
  s = feed(s, E.turnStart, { text: 'hi', turnId: 't1' }, 10_000)
  s = feed(s, E.clock, undefined, 72_000)
  expect(text(s, 'a-turn-time')).toBe(nf.duration(62_000))
  s = feed(s, E.turnComplete, { text: 'ok' }, 95_000)
  expect(text(s, 'a-turn-time')).toBe(nf.duration(85_000))
})

test('act/compact: a message-count collapse with the same startedAt is a compact, /clear is not', async () => {
  let s = act.init()
  s = feed(s, E.usage, { startedAt: 100, context: {}, rateLimits: [] }, 1_000)
  s = feed(s, E.turnStep, { turnId: 't1', index: 0, model: 'm', messageCount: 12 }, 2_000)
  s = feed(s, E.turnStep, { turnId: 't1', index: 1, model: 'm', messageCount: 5 }, 3_000)
  s = feed(s, E.turnStep, { turnId: 't1', index: 2, model: 'm', messageCount: 20 }, 4_000)
  s = feed(s, E.clock, undefined, 123_000)
  expect(text(s, 'a-compact')).toBe('1 compacts · last ' + nf.duration(120_000) + ' ago')
  s = feed(s, E.usage, { startedAt: 900, context: {}, rateLimits: [] }, 124_000)
  s = feed(s, E.turnStep, { turnId: 't2', index: 0, model: 'm', messageCount: 9 }, 125_000)
  s = feed(s, E.clock, undefined, 183_000)
  expect(text(s, 'a-compact')).toBe('1 compacts · last ' + nf.duration(180_000) + ' ago')
})

test('act/questions: every AskUserQuestion call counts, the floor variant carries the producer suffix', async () => {
  let s = act.init()
  s = feed(s, E.toolCall, { tool: 'AskUserQuestion', tool_use_id: 'q1' }, 1_000)
  s = feed(s, E.toolCall, { tool: 'AskUserQuestion', tool_use_id: 'q2', agentId: 'ag1' }, 2_000)
  s = feed(s, E.toolCall, { tool: 'Bash', tool_use_id: 'b1' }, 3_000)
  expect(text(s, 'a-questions', args('count'))).toBe('2 questions')
  expect(text(s, 'a-questions', args('floor'))).toBe('(question 2, floor 20)')
})

test('act/shell-blocks: fences of the answer are read, never run', async () => {
  let s = act.init()
  const answer = 'do this:\n\n```bash\nls -la\npwd\n```\n\nand\n\n```python\nprint(1)\n```\n\ndone'
  s = feed(s, E.turnComplete, { text: answer }, 1_000)
  expect(text(s, 'a-shell-blocks', args('count'))).toBe('1 shell blocks')
  expect(text(s, 'a-shell-blocks', args('last'))).toBe('ls -la')
})

test('act/tools-time: exact agent envelopes plus bounded main spans, marked with a tilde', async () => {
  let s = act.init()
  s = feed(s, E.toolCall, { tool: 'Read', tool_use_id: 'r1', file_path: '/w/a' }, 0)
  s = feed(s, E.toolCall, { tool: 'Write', tool_use_id: 'w1', file_path: '/w/b' }, 3_000)
  s = feed(s, E.turnComplete, { text: 'ok' }, 5_000)
  s = feed(s, E.messages, [msg('assistant', 'a', [agentUse({ agentId: 'ag1', text: 'done', durationMs: 5_000 })])], 6_000)
  const readSpan = 3_000 - 0
  const writeSpan = 5_000 - 3_000
  expect(text(s, 'a-tools-time')).toBe('~' + nf.duration(readSpan + writeSpan + 5_000) + ' in tools')
})

test('act/tools-chars: the characters the tools returned, summed from the transcript snapshot', async () => {
  let s = act.init()
  s = feed(s, E.messages, [msg('assistant', 'a', [agentUse({ agentId: 'ag1', text: 'abcdef' }), { tool_use_id: 'r1', tool: 'Read', input: {}, text: 'xy' }])], 1_000)
  expect(text(s, 'a-tools-chars')).toBe(nf.count(6 + 2) + ' chars from tools')
})

// ---------------------------------------------------------------- system

test('act/cpu: the claude processes sum their percent, other processes do not', async () => {
  let s = act.init()
  const out = '  5.5  123456 /usr/local/bin/node /Users/m/.local/bin/claude\n 12.0    999 /opt/homebrew/bin/claude --help\n  3.0    100 grep claude foo\n'
  s = feed(s, ps, { code: 0, stdout: out, stderr: '' }, 1_000)
  const cpu = 5.5 + 12.0
  const v = val(s, 'a-cpu')
  expect(v.state).toBe('ok')
  expect((v as { text: string }).text).toBe(nf.percent(cpu / 100) + ' cpu')
  expect((v as { num?: number }).num).toBe(cpu)
  expect((v as { ratio?: number }).ratio).toBe(cpu / 100)
})

test('act/cpu: a first failure is nosource, a later failure keeps the last value as stale', async () => {
  let s = act.init()
  s = feed(s, ps, { code: 1, stdout: '', stderr: 'ps: illegal option' }, 1_000, false)
  const v1 = val(s, 'a-cpu')
  expect(v1.state).toBe('nosource')
  expect((v1 as { reason: string }).reason).toContain('ps')
  s = feed(s, ps, { code: 0, stdout: '  4.0  1 node /x/claude\n', stderr: '' }, 2_000)
  s = feed(s, ps, { code: 1, stdout: '', stderr: 'ps: gone' }, 3_000, false)
  const v2 = val(s, 'a-cpu')
  expect(v2.state).toBe('stale')
  expect((v2 as { last: { text: string } }).last.text).toBe(nf.percent(0.04) + ' cpu')
  expect((v2 as { reason: string }).reason).toContain('ps: gone')
})

test('Y6: non-numeric ps output reads stale with the reason, never as 0 cpu', async () => {
  let s = act.init()
  s = feed(s, ps, { code: 0, stdout: '  4.0  1 node /x/claude\n', stderr: '' }, 1_000)
  s = feed(s, ps, { code: 0, stdout: 'cpu rss command\nnot a number row\n', stderr: '' }, 2_000)
  const v = val(s, 'a-cpu')
  expect(v.state).toBe('stale')
  expect((v as { last: { text: string } }).last.text).toBe(nf.percent(0.04) + ' cpu')
  expect((v as { reason: string }).reason).toBe('ps output not numeric')
  const first = val(feed(act.init(), ps, { code: 0, stdout: 'words only\n', stderr: '' }, 1_000), 'a-cpu') as { state: string; reason: string }
  expect(first.state).toBe('nosource')
  expect(first.reason).toBe('ps output not numeric')
})

test('act/events: the xray composite and its four single variants', async () => {
  let s = act.init()
  s = feed(s, E.sessionStart, { cwd: '/w' }, 1_000)
  s = feed(s, E.agentSpawn, spawn1, 2_000)
  s = feed(s, E.agentSpawn, spawn2, 3_000)
  s = feed(s, E.toolCall, { tool: 'Bash', tool_use_id: 'b1' }, 4_000)
  s = feed(s, E.clock, undefined, 5_000)
  s = feed(s, E.messages, [msg('assistant', 'a', [{ tool_use_id: 'u1', tool: 'Bash', input: {}, text: 'x', isError: true }, { tool_use_id: 'u2', tool: 'Read', input: {}, text: 'y', isError: true }])], 6_000)
  const line = 'events=' + nf.count(4) + ' errors=' + nf.count(2) + ' subagents=' + nf.count(2) + ' unknown=' + nf.count(0)
  expect(text(s, 'a-events', args('xray'))).toBe(line)
  expect(text(s, 'a-events', args('events'))).toBe(nf.count(4) + ' events')
  expect(text(s, 'a-events', args('errors'))).toBe(nf.count(2) + ' errors')
  expect(text(s, 'a-events', args('subagents'))).toBe(nf.count(2) + ' subagents')
  expect(text(s, 'a-events', args('unknown'))).toBe(nf.count(0) + ' unknown events')
})

test('act/events: an event name outside the declared seven counts as unknown', async () => {
  let s = act.init()
  s = feed(s, { kind: 'event', event: 'mystery.tick' as 'config.set' }, { any: 1 }, 1_000)
  expect(text(s, 'a-events', args('unknown'))).toBe(nf.count(1) + ' unknown events')
})

test('act/event-ring: the last events with their ages, capped by maxRows', async () => {
  let s = act.init()
  s = feed(s, E.sessionStart, { cwd: '/w' }, 1_000)
  s = feed(s, E.turnStart, { text: 'hi', turnId: 't1' }, 61_000)
  s = feed(s, E.clock, undefined, 65_000)
  const v = val(s, 'a-event-ring', args('rows', { maxRows: 5 }))
  const rows = (v as { rows?: { label: string; right?: string }[] }).rows ?? []
  expect(rows.length).toBe(2)
  expect(rows[1]!.label).toBe('turn.start')
  expect(rows[1]!.right).toBe(nf.duration(4_000) + ' ago')
  s = feed(s, E.clock, undefined, 66_000)
  expect(((val(s, 'a-event-ring', args('rows', { maxRows: 1 })) as { rows?: unknown[] }).rows ?? []).length).toBe(1)
})

// ---------------------------------------------------------------- sdlc workflows

const WF_OUT =
  '.ai/workflows/sl-05/00-index.md\n' +
  '---\n' +
  'title: Status mod\n' +
  'status: active\n' +
  'type: index\n' +
  'current-stage: verify\n' +
  'selected-slice: s2\n' +
  'next-invocation: /wf verify sl-05 s2\n' +
  'branch: feat/sl-05\n' +
  'blockers: 2\n' +
  'updated-at: 2026-09-24T15:00:00.000Z\n' +
  '---\n' +
  'the workflow body\n' +
  '.ai/workflows/audit-x/00-index.md\n' +
  '---\n' +
  'title: Audit X\n' +
  'status: blocked\n' +
  'type: index\n' +
  'current-stage: review\n' +
  'branch: feat/sl-05\n' +
  'blocked: true\n' +
  'updated-at: 2026-09-24T16:00:00.000Z\n' +
  '---\n' +
  'second body\n'

const T0 = Date.parse('2026-09-24T16:10:00.000Z')

test('act/wf-count: workflows are counted and the header variant stamps the snapshot', async () => {
  let s = act.init()
  s = feed(s, wfIndex, { code: 0, stdout: WF_OUT, stderr: '' }, T0)
  expect(text(s, 'a-wf-count', args('count'))).toBe('2 workflows')
  expect(text(s, 'a-wf-count', args('header'))).toBe('2 workflows · generated 2026-09-24 16:10')
})

test('act/wf-groups: sections bucket the statuses, tiles carry blockers, terminal sets are the producer ones', async () => {
  let s = act.init()
  const out =
    '.ai/workflows/a/00-index.md\n---\nstatus: shipped\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n' +
    '.ai/workflows/b/00-index.md\n---\nstatus: closed\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n' +
    '.ai/workflows/c/00-index.md\n---\nstatus: active\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n' +
    '.ai/workflows/q/00-index.md\n---\ntype: workflow-index\nstatus: ready\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n' +
    '.ai/workflows/d/00-index.md\n---\nstatus: blocked\nblocker-count: 3\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n'
  s = feed(s, wfIndex, { code: 0, stdout: out, stderr: '' }, T0)
  const v = val(s, 'a-wf-groups', args('sections'))
  const rows = (v as { rows?: { label: string; right?: string }[] }).rows ?? []
  const byLabel = new Map(rows.map((r) => [r.label, r.right ?? '']))
  expect(byLabel.get('Active')).toBe(nf.count(2))
  expect(byLabel.get('Recently shipped')).toBe(nf.count(1))
  expect(byLabel.get('Closed')).toBe(nf.count(1))
  expect(byLabel.get('Quick')).toBe(nf.count(1))
  const tiles = val(s, 'a-wf-groups', args('tiles'))
  const tileRows = (tiles as { rows?: { label: string; right?: string }[] }).rows ?? []
  expect(tileRows.map((r) => r.label + '=' + (r.right ?? '')).join(';')).toBe('Active=' + nf.count(2) + ';Blockers=' + nf.count(3))
})

test('act/wf-rows: title, stage, health and age come from the frontmatter', async () => {
  let s = act.init()
  s = feed(s, wfIndex, { code: 0, stdout: WF_OUT, stderr: '' }, T0)
  const v = val(s, 'a-wf-rows', args('ledger'))
  const rows = (v as { rows?: { label: string; detail?: string; right?: string }[] }).rows ?? []
  expect(rows.length).toBe(2)
  expect(rows[0]!.label).toBe('Audit X')
  expect(rows[0]!.right).toContain('review')
  expect(rows[0]!.right).toContain('● blocked')
  const age = T0 - Date.parse('2026-09-24T16:00:00.000Z')
  expect(rows[0]!.right).toContain(nf.duration(age) + ' ago')
  expect(rows[1]!.right).toContain('◉ active')
})

test('act/wf-project: the five fixed project-context slots, present ones only', async () => {
  let s = act.init()
  s = feed(s, projectDoc('PRODUCT.md'), '---\ntitle: Product context\nstatus: draft\n---\nbody', T0)
  s = feed(s, projectDoc('DESIGN.md'), '', T0, false)
  const v = val(s, 'a-wf-project')
  expect(v.state).toBe('ok')
  const rows = (v as { rows?: { label: string; right?: string }[] }).rows ?? []
  expect(rows.length).toBe(1)
  expect(rows[0]!.label).toBe('PRODUCT.md')
  expect(rows[0]!.right).toBe('project-context · draft')
})

test('act/wf-project: with no project doc at all the element says nosource', async () => {
  let s = act.init()
  for (const p of ['PRODUCT.md', 'DESIGN.md', '.ai/ship-plan.md', '.ai/observability.md', '.ai/observability-build.md']) s = feed(s, projectDoc(p), 'not found: ' + p, T0, false)
  const v = val(s, 'a-wf-project')
  expect(v.state).toBe('nosource')
  expect((v as { reason: string }).reason.length > 0).toBe(true)
})

test('act/wf-branches: shared branches group and the readiness chip uses the producer rule', async () => {
  let s = act.init()
  s = feed(s, wfIndex, { code: 0, stdout: WF_OUT, stderr: '' }, T0)
  let rows = ((val(s, 'a-wf-branches', args('groups')) as { rows?: { label: string; right?: string; detail?: string }[] }).rows ?? [])
  expect(rows.length).toBe(1)
  expect(rows[0]!.label).toBe('⎇ feat/sl-05')
  expect(rows[0]!.right).toBe('1 blocked')
  expect(rows[0]!.detail).toBe(nf.count(2) + ' slugs')
  const ready =
    '.ai/workflows/r1/00-index.md\n---\nstatus: active\ncurrent-stage: handoff\nbranch: bf\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n' +
    '.ai/workflows/r2/00-index.md\n---\nstatus: active\ncurrent-stage: ship\nbranch: bf\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n' +
    '.ai/workflows/r3/00-index.md\n---\nstatus: active\ncurrent-stage: plan\nbranch: bf\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n'
  let s2 = act.init()
  s2 = feed(s2, wfIndex, { code: 0, stdout: ready, stderr: '' }, T0)
  rows = ((val(s2, 'a-wf-branches', args('groups')) as { rows?: { right?: string }[] }).rows ?? [])
  expect(rows[0]!.right).toBe('2/3 ready')
})

test('act/wf-stages: the swimlane counts the ten stages and the annotation variants', async () => {
  let s = act.init()
  s = feed(s, wfIndex, { code: 0, stdout: WF_OUT, stderr: '' }, T0)
  const v = val(s, 'a-wf-stages', args('swim'))
  const rows = (v as { rows?: { label: string; detail?: string; right?: string }[] }).rows ?? []
  expect(rows[0]!.label).toBe('audit-x')
  expect(rows[0]!.right).toBe(nf.count(7) + '/' + nf.count(10))
  expect(rows[0]!.detail).toBe('●●●●●●◐○○○')
  const blockers = ((val(s, 'a-wf-stages', args('blockers')) as { rows?: { label: string; right?: string }[] }).rows ?? [])
  expect(blockers.map((r) => r.label + ' ' + (r.right ?? '')).join(';')).toBe('audit-x ' + nf.count(1) + ' blocker;sl-05 ' + nf.count(2) + ' blockers')
  const revOut =
    '.ai/workflows/r/00-index.md\n---\nstatus: active\ncurrent-stage: plan\nrevision-count: 4\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n'
  let s2 = act.init()
  s2 = feed(s2, wfIndex, { code: 0, stdout: revOut, stderr: '' }, T0)
  expect(((val(s2, 'a-wf-stages', args('rev')) as { rows?: { right?: string }[] }).rows ?? [])[0]!.right).toBe('rev 4')
})

test('act/wf-stages: a shipped workflow is fully traversed', async () => {
  let s = act.init()
  const out = '.ai/workflows/done/00-index.md\n---\nstatus: shipped\ncurrent-stage: intake\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n'
  s = feed(s, wfIndex, { code: 0, stdout: out, stderr: '' }, T0)
  const rows = ((val(s, 'a-wf-stages', args('swim')) as { rows?: { right?: string; detail?: string }[] }).rows ?? [])
  expect(rows[0]!.right).toBe(nf.count(10) + '/' + nf.count(10))
  expect(rows[0]!.detail).toBe('●●●●●●●●●●')
})

const DRIVER_OUT =
  '.ai/workflows/sl-05/.driver-journal.jsonl\n' +
  '{"at":"2026-09-24T10:00:00.000Z","run":"r-9","event":"stage-start","stage":"verify","slice":"s2","agent":"glm"}\n' +
  '{"at":"2026-09-24T10:20:00.000Z","run":"r-9","event":"beat"}\n' +
  '{"at":"2026-09-24T10:21:00.000Z","run":"r-9","event":"agent-end","agent":"glm"}\n'

test('act/driver: the line names run, place, agent, elapsed and the last beat', async () => {
  let s = act.init()
  const now = Date.parse('2026-09-24T10:25:00.000Z')
  s = feed(s, wfDriver, { code: 0, stdout: DRIVER_OUT, stderr: '' }, now)
  const elapsed = now - Date.parse('2026-09-24T10:00:00.000Z')
  const silence = now - Date.parse('2026-09-24T10:21:00.000Z')
  expect(text(s, 'a-driver', args('line'))).toBe('wf · run r-9 · verify s2 · agent glm · ' + nf.duration(elapsed) + ' · last beat ' + nf.duration(silence) + ' ago')
  expect(text(s, 'a-driver', args('dead'))).toBe('alive · last beat ' + nf.duration(silence) + ' ago')
})

test('act/driver: silence past the run own longest gap with the 20m floor presumes dead', async () => {
  let s = act.init()
  const now = Date.parse('2026-09-24T10:50:00.000Z')
  s = feed(s, wfDriver, { code: 0, stdout: DRIVER_OUT, stderr: '' }, now)
  const silence = now - Date.parse('2026-09-24T10:21:00.000Z')
  expect(text(s, 'a-driver', args('dead'))).toBe('presumed dead · silent ' + nf.duration(silence) + ' · last: verify s2')
})

test('act/stage-check: a /wf turn that wrote nothing else names the missing artifact', async () => {
  let s = act.init()
  s = feed(s, E.turnStart, { text: '/wf implement sl-05 s2', turnId: 't9' }, 1_000)
  s = feed(s, E.toolCall, { tool: 'Write', tool_use_id: 'w1', file_path: '/w/.ai/workflows/sl-05/05-implement-other.md' }, 2_000)
  s = feed(s, E.turnComplete, { text: 'done', reason: 'answer' }, 3_000)
  s = feed(s, E.clock, undefined, 63_000)
  const v = val(s, 'a-stage-check')
  const rows = (v as { rows?: { label: string; right?: string }[] }).rows ?? []
  expect(rows.length).toBe(1)
  expect(rows[0]!.label).toBe('wf: implement ended without 05-implement-s2.md')
  expect(rows[0]!.right).toBe(nf.duration(60_000) + ' ago')
})

test('act/stage-check: the matching write lands the stage and adds no row', async () => {
  let s = act.init()
  s = feed(s, E.turnStart, { text: '/wf shape sl-05', turnId: 't9' }, 1_000)
  s = feed(s, E.toolCall, { tool: 'Write', tool_use_id: 'w1', file_path: '/w/.ai/workflows/sl-05/02-shape.md' }, 2_000)
  s = feed(s, E.turnComplete, { text: 'done', reason: 'answer' }, 3_000)
  const rows = ((val(s, 'a-stage-check') as { rows?: unknown[] }).rows ?? [])
  expect(rows.length).toBe(0)
})

test('act/next-step: the newest-updated live workflow offers its next invocation', async () => {
  let s = act.init()
  s = feed(s, wfIndex, { code: 0, stdout: WF_OUT, stderr: '' }, T0)
  expect(text(s, 'a-next-step')).toBe('/wf verify sl-05 s2')
})

const REVIEW_OUT =
  '.ai/workflows/sl-05/07-review.yaml\n' +
  'findings:\n' +
  '  - id: f1\n    status: open\n' +
  '  - id: f2\n    status: deferred\n' +
  '  - id: f3\n    status: closed\n' +
  '  - id: f4\n'

test('act/findings: open counts open, deferred, could-not-fix and absent; the slice ledger is chosen by the rule', async () => {
  let s = act.init()
  s = feed(s, wfIndex, { code: 0, stdout: WF_OUT, stderr: '' }, T0)
  s = feed(s, wfReview, { code: 0, stdout: REVIEW_OUT, stderr: '' }, T0)
  expect(text(s, 'a-findings', args('active'))).toBe('sl-05 open findings ' + nf.count(3))
  const sliceOut =
    '.ai/workflows/sl-05/07-review-s9.yaml\n' + 'findings:\n' + '  - id: g1\n    status: open\n' + '  - id: g2\n    status: could-not-fix\n'
  let s2 = act.init()
  s2 = feed(s2, wfIndex, { code: 0, stdout: '.ai/workflows/sl-05/00-index.md\n---\nstatus: active\nselected-slice: s9\nupdated-at: 2026-09-24T10:00:00.000Z\n---\nx\n', stderr: '' }, T0)
  s2 = feed(s2, wfReview, { code: 0, stdout: sliceOut, stderr: '' }, T0)
  expect(text(s2, 'a-findings', args('active'))).toBe('sl-05 open findings ' + nf.count(2))
})

test('act/findings: without a findings list the unchecked markdown rows count', async () => {
  let s = act.init()
  s = feed(s, wfIndex, { code: 0, stdout: WF_OUT, stderr: '' }, T0)
  s = feed(s, wfReview, { code: 0, stdout: '.ai/workflows/sl-05/07-review.md\n# review\n- [ ] fix me\n- [x] done\n- [ ] and me\n', stderr: '' }, T0)
  expect(text(s, 'a-findings', args('active'))).toBe('sl-05 open findings ' + nf.count(2))
})

test('act/ship-blockers: open BLOCKER and HIGH rows of the audit count', async () => {
  let s = act.init()
  const audit = '---\nfindings:\n  - severity: BLOCKER\n    status: open\n  - severity: HIGH\n    status: open\n  - severity: HIGH\n    status: resolved\n  - severity: LOW\n    status: open\n---\nbody'
  s = feed(s, shipPlan, audit, T0)
  expect(text(s, 'a-ship-blockers')).toBe('ship-plan blockers ' + nf.count(2))
})

const COST_OUT =
  '.ai/workflows/sl-05/cost.jsonl\n' +
  '{"slug":"sl-05","key":"implement","turn":3,"main":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":10,"cache_creation_input_tokens":5},"subagents":[{"input_tokens":20,"output_tokens":10}],"external":[]}\n' +
  '{"slug":"sl-05","key":"verify","turn":1,"main":{"input_tokens":30,"output_tokens":20},"subagents":[],"external":[{"fields":"codex","input_tokens":7,"output_tokens":3,"cached_input_tokens":2,"cache_write_input_tokens":1}]}\n'

test('act/wf-cost: turns, sub-agents and external invocations aggregate per slug with a total', async () => {
  let s = act.init()
  s = feed(s, wfCost, { code: 0, stdout: COST_OUT, stderr: '' }, T0)
  const v = val(s, 'a-wf-cost', args('table'))
  const rows = (v as { rows?: { label: string; right?: string }[] }).rows ?? []
  expect(rows.map((r) => r.label + '=' + (r.right ?? '')).join(';')).toBe(
    'sl-05=' + nf.count(2) + ' turns · ' + nf.count(1) + ' sub-agents · ' + nf.count(1) + ' external' + ';total=' + nf.count(2) + ' turns · ' + nf.count(1) + ' sub-agents · ' + nf.count(1) + ' external',
  )
  const tokens = ((val(s, 'a-wf-cost', args('tokens')) as { rows?: { right?: string }[] }).rows ?? [])
  expect(tokens[0]!.right).toBe('in ' + nf.tokens(150) + ' · out ' + nf.tokens(80))
  const ext = ((val(s, 'a-wf-cost', args('external')) as { rows?: { right?: string }[] }).rows ?? [])
  expect(ext[0]!.right).toBe('external in ' + nf.tokens(7 + 2 + 1) + ' / out ' + nf.tokens(3) + ' (' + nf.count(1) + ')')
})

// ---------------------------------------------------------------- outcome N

test('act/n-outcome: every N element answers nosource with its verbatim table reason', async () => {
  const s = act.init()
  const want: Record<string, string> = {
    'a-agent-ctx': 'полный производитель agent usage/contextWindowSize в цензе не установлен',
    'a-mood': 'mood.txt создаёт внешний Stop-рецепт; такой источник в статус-моде не объявлен',
    'a-agent-journal-time': 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии',
    'a-agent-journal-tokens': 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии',
    'a-agent-journal-state': 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии',
    'a-run-topology': 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии',
    'a-run-tokens': 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии',
    'a-run-tools': 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии',
    'a-run-models': 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии',
    'a-agent-io': 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии',
    'a-runs': 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии',
    'a-nested-wf': 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии',
    'a-xray-filter': 'private filter xray не настройка статус-мода',
  }
  for (const el of act.elements) {
    if (el.outcome !== 'N') continue
    const v = val(s, el.id)
    expect(v.state).toBe('nosource')
    expect((v as { reason: string }).reason).toBe(want[el.id])
  }
})

// ---------------------------------------------------------------- source failures

test('act/nosource: a project without .ai/workflows answers nosource, not zero workflows', async () => {
  let s = act.init()
  const miss = { code: 1, stdout: '', stderr: 'find: .ai/workflows: No such file or directory' }
  s = feed(s, wfIndex, miss, T0, false)
  s = feed(s, wfDriver, miss, T0, false)
  s = feed(s, wfCost, miss, T0, false)
  s = feed(s, wfReview, miss, T0, false)
  for (const id of ['a-wf-count', 'a-wf-rows', 'a-driver', 'a-wf-cost', 'a-findings']) {
    const v = val(s, id)
    expect(v.state).toBe('nosource')
    expect((v as { reason: string }).reason).toContain('.ai/workflows')
  }
})

test('act/stale: a workflow snapshot that fails after a good one keeps the last figures', async () => {
  let s = act.init()
  s = feed(s, wfIndex, { code: 0, stdout: WF_OUT, stderr: '' }, T0)
  s = feed(s, wfIndex, { code: 1, stdout: '', stderr: 'find: illegal' }, T0 + 5_000, false)
  const v = val(s, 'a-wf-count', args('count'))
  expect(v.state).toBe('stale')
  expect((v as { last: { text: string } }).last.text).toBe('2 workflows')
  expect((v as { reason: string }).reason).toContain('find: illegal')
})
