import { expect, test } from 'claude-code/testing'
import external from '../hooks/data/external'
import type { FormatArgs, Input, NumberFormat, Source, Value } from '../hooks/data/types'

// The teeth of the T-ext family: every element holds the pending/ok/stale-or-
// nosource discipline, every variant computes its own formula on a fixture
// whose numbers are derived from the input, and the 117 catalogue rows of the
// track (E071–E077, E140–E143, E281–E296, E312–E334, E338–E345, E427–E437,
// E485–E497, E499–E533) land exactly once in an element or variant catalogue.
// CONSTRAINT: fixtures copy the carrier shapes verbatim (wt json-schema 1,
// vercel ls deployments, gh run list fields, headsign state.json, headsign
// status stdout, sdlc 00-index/03-slice/cost.jsonl, prd.json stories).

const NOW = 1_700_000_000_000
const iso = (ms: number): string => new Date(ms).toISOString()

const nf: NumberFormat = {
  tokens: (n: number): string => `${n}t`,
  usd: (n: number): string => `$${n}`,
  percent: (r: number): string => `${r}p`,
  duration: (ms: number): string => `${ms}ms`,
  bytes: (n: number): string => `${n}b`,
  count: (n: number): string => `${n}`,
  rate: (perSec: number, unit: string): string => `${perSec}/${unit}`,
}
const args = (variant: string, options: Record<string, unknown> = {}): FormatArgs => ({ variant, options, nf })

function feed(inputs: readonly Input[]): unknown {
  let s = external.init()
  for (const i of inputs) s = external.reduce(s, i)
  return s
}
const cmd = (argv: readonly string[], stdout: string, now = NOW): Input =>
  ({ source: { kind: 'cmd', argv, everyMs: 60_000, cwd: 'project' }, ok: true, data: { code: 0, stdout, stderr: '' }, now }) as unknown as Input
const cmdFail = (argv: readonly string[], error: string, now = NOW): Input =>
  ({ source: { kind: 'cmd', argv, everyMs: 60_000, cwd: 'project' }, ok: false, error, now }) as unknown as Input
const file = (path: string, data: string, now = NOW): Input =>
  ({ source: { kind: 'file', path, everyMs: 10_000, relativeTo: 'project' }, ok: true, data, now }) as unknown as Input
const fileFail = (path: string, error: string, now = NOW): Input =>
  ({ source: { kind: 'file', path, everyMs: 10_000, relativeTo: 'project' }, ok: false, error, now }) as unknown as Input
const event = (name: 'turn.start' | 'turn.complete' | 'tool.call', data: unknown, now = NOW): Input =>
  ({ source: { kind: 'event', event: name }, ok: true, data, now }) as unknown as Input
const usage = (usd: number, now = NOW): Input =>
  ({ source: { kind: 'session', call: 'usage' }, ok: true, data: { cost: { usd } }, now }) as unknown as Input
const env = (value: string | undefined, now = NOW): Input =>
  ({ source: { kind: 'env', names: ['HEADSIGN_OBSERVER'] }, ok: true, data: { HEADSIGN_OBSERVER: value }, now }) as unknown as Input
const clock = (now: number): Input => ({ source: { kind: 'clock', everyMs: 1000 }, ok: true, now }) as unknown as Input

const val = (s: unknown, elementId: string, a: FormatArgs): Value => external.value(s as never, elementId, a)
const text = (s: unknown, elementId: string, a: FormatArgs): string => {
  const v = val(s, elementId, a)
  if (v === undefined) throw new Error(`${elementId}: undefined value`)
  if (v.state !== 'ok') throw new Error(`${elementId}: ${JSON.stringify(v)}`)
  return v.text
}

const isOk = (v: Value): v is Extract<Value, { state: 'ok' }> => v !== undefined && v.state === 'ok'

// ---- fixtures (carrier shapes) ----

const RUNS = [
  { databaseId: 1688, status: 'in_progress', conclusion: null, event: 'push', workflowName: 'CI', headBranch: 'feat/x', displayTitle: 'w1688: keep the band (#1688)', createdAt: iso(NOW - 95_000), startedAt: iso(NOW - 90_000), updatedAt: iso(NOW - 90_000), url: 'https://github.com/o/r/actions/runs/1688' },
  { databaseId: 1687, status: 'completed', conclusion: 'success', event: 'push', workflowName: 'CI', headBranch: 'feat/x', displayTitle: 'w1687: declare deps', createdAt: iso(NOW - 600_000), startedAt: iso(NOW - 590_000), updatedAt: iso(NOW - 540_000), url: 'https://github.com/o/r/actions/runs/1687' },
  { databaseId: 100, status: 'completed', conclusion: 'success', event: 'schedule', workflowName: 'Nightly', headBranch: 'main', displayTitle: 'nightly', createdAt: iso(NOW - 86_400_000), startedAt: iso(NOW - 86_400_000), updatedAt: iso(NOW - 86_000_000), url: 'https://github.com/o/r/actions/runs/100' },
]
const RUNS_STDOUT = JSON.stringify(RUNS)

const PRS = [
  {
    number: 12, title: 'fix: band keeps stale lights', state: 'OPEN', isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND',
    reviewDecision: 'CHANGES_REQUESTED', headRefOid: '9fb543b0123456789abcdef0123456789abcdef01', headRefName: 'feat/x', baseRefName: 'main',
    isCrossRepository: false, body: 'Closes #34', url: 'https://github.com/o/r/pull/12',
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', name: 'lint', status: 'QUEUED', conclusion: null },
      { __typename: 'CheckRun', name: 'opt-scan', status: 'COMPLETED', conclusion: 'FAILURE' },
    ],
  },
  { number: 9, title: 'docs: readme', state: 'MERGED', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', headRefOid: 'abc4567', headRefName: 'main', baseRefName: 'main', isCrossRepository: false, body: '', url: 'https://github.com/o/r/pull/9', statusCheckRollup: [] },
]
const PRS_STDOUT = JSON.stringify(PRS)
const PRS_POLL2 = JSON.stringify([
  { ...PRS[0]!, statusCheckRollup: [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'lint', status: 'QUEUED', conclusion: null },
    { __typename: 'CheckRun', name: 'opt-scan', status: 'COMPLETED', conclusion: 'FAILURE' },
  ] },
  PRS[1]!,
])

const PR_STATUS_STDOUT = JSON.stringify({
  currentBranch: [PRS[0]],
  createdBy: [
    { number: 5, title: 't5', state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED', statusCheckRollup: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }], url: 'https://github.com/o/r/pull/5' },
    { number: 7, title: 't7', state: 'OPEN', isDraft: true, reviewDecision: '', statusCheckRollup: [], url: 'https://github.com/o/r/pull/7' },
  ],
  needsReview: [],
})

const ISSUES_STDOUT = JSON.stringify([{ number: 34, title: 'the band bug', state: 'CLOSED', body: '', url: 'https://github.com/o/r/issues/34' }])
const PROTECT_STDOUT = JSON.stringify({ required_status_checks: { contexts: ['build', 'test'] } })
const RULES_STDOUT = JSON.stringify([{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint' }] } }])

const DEPLOYMENTS = [
  { url: 'demo-abc.vercel.app', name: 'demo', state: 'READY', target: 'production', createdAt: NOW - 300_000, ready: NOW - 240_000, meta: { githubCommitRef: 'main', githubCommitMessage: 'w: keep the queue honest\n\nlong body' } },
  { url: 'demo-x2.vercel.app', name: 'demo', state: 'BUILDING', target: null, createdAt: NOW - 60_000, meta: { githubCommitRef: 'feat/x', githubCommitMessage: 'w2: second' } },
  { url: 'demo-old.vercel.app', name: 'demo', state: 'ERROR', target: null, createdAt: NOW - 900_000, ready: NOW - 880_000 },
]
const VERCEL_STDOUT = `Vercel CLI 42.0\n${JSON.stringify({ deployments: DEPLOYMENTS })}`
const VERCEL_POLL2 = `Vercel CLI 42.0\n${JSON.stringify({ deployments: [
  DEPLOYMENTS[0]!,
  { ...DEPLOYMENTS[1]!, state: 'READY', ready: NOW - 30_000 },
  DEPLOYMENTS[2]!,
] })}`

const WT_STDOUT = JSON.stringify([
  { branch: 'main', path: '/w/r', is_current: true, working_tree: { staged: false, modified: false, untracked: false, diff: { added: 0, deleted: 0 } } },
  { branch: 'feat/x', path: '/w/r/.wt/x', is_current: false, working_tree: { staged: true, modified: true, untracked: true, diff: { added: 12, deleted: 3 } } },
])

const HS_FILE = JSON.stringify({
  workflow: 'default', workflow_path: '/w/wf.yaml', status: 'running', phase: 'review',
  attempts: { implement: 2, review: 1 }, total_iterations: 4,
  last_failure: { phase: 'review', check: 'lint', run: 'npm run lint', exit_code: 1, output_tail: 'error: semicolon', elapsed_seconds: 3, repeats: 1 },
  end_reason: null, stop_nudges: 1, driver_agent: 'agent-7', phase_entered_at: '2026-09-24T09:40:00+03:00', phase_entered_from: 'implement',
  last_stop: { disposition: 'paused', at: '2026-09-24T10:00:00+03:00', note: 'waiting for the reviewer' },
  last_drive: { session: 'SESS-ID', at: '2026-09-24T10:05:00+03:00' },
  graph_fingerprint: {}, graph_change_reported: 'abc', accepted_graph_changes: 2,
  optimization: { id: 'opt-1', stop_requested: false, friction_noticed: false },
})

const HS_CLI = [
  'RUNNING review (attempt 1/3)', '',
  '  implement', '      │', '  ╔═══════╗', '  ║ review ║', '  ╚═══════╝', '      ├─ pass ─▶ close', '      └─ fail ─▶ review   (1 attempt left)', '',
  'workflow: default', 'driver: no delegated-agent claim is recorded',
  'last stop: paused by a note — at 2026-09-24T10:00:00+03:00', 'note: waiting for the reviewer',
  'last moved: 2026-09-24T10:05:00+03:00 — turn ends from any other session pass without a nudge',
  'entered: 2026-09-24T09:40:00+03:00 — when this run last entered the phase above',
  "graph: 2 accepted changes to the workflow's rules during this run",
  'graph: changed since this run accepted it — restore the file, or `headsign next --accept-graph-change` to accept',
  'graph: the file no longer matches the rules this run pinned — `headsign next` will report it before it runs the gate',
  'observer: HEADSIGN_OBSERVER is set here — turn ends from this environment are never held',
  'optimization: unassessed — .headsign/optimization/opt-1/assessment.md', '',
  '--- phase: review ---', 'Run the checks.', '',
].join('\n')

const PRD = JSON.stringify({
  stories: { a: { passes: null }, b: { passes: true }, c: { passes: false }, d: { passes: 'deferred' }, e: { passes: 'needs-setup' }, f: { passes: 'weird' } },
})

const WF_NAMES_STDOUT = [
  '.ai/workflows/demo/00-index.md', '.ai/workflows/demo/03-slice.md', '.ai/workflows/demo/04-plan-s1.md',
  '.ai/workflows/demo/06-verify-s1.md', '.ai/workflows/demo/cost.jsonl', '.ai/workflows/other/00-index.md',
].join('\n')
const WF_READ_STDOUT = [
  '==> .ai/workflows/demo/00-index.md', '---', 'status: active', 'current-stage: implement', 'selected-slice: s1', 'next-invocation: handoff', '---', '',
  '==> .ai/workflows/demo/03-slice.md', '---', 'slices:', '  - slug: s1', '    status: complete', '    complexity: m', '  - slug: s2', '    status: in-progress', '---', '',
  '==> .ai/workflows/demo/cost.jsonl',
  JSON.stringify({ main: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000 } }),
  JSON.stringify({ main: { input_tokens: 0 }, subagents: [{ input_tokens: 500 }] }),
  '==> .ai/workflows/other/00-index.md', '---', 'status: complete', '---', '',
].join('\n')

const GH_REPO = ['gh', 'repo', 'view', '--json', 'nameWithOwner'] as const
const GH_RUNS_ARGV = ['gh', 'run', 'list', '--limit', '15', '--json', 'databaseId,status,conclusion,event,workflowName,headBranch,displayTitle,createdAt,startedAt,updatedAt,url'] as const
const GH_PRS_ARGV = ['gh', 'pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefOid,headRefName,baseRefName,isCrossRepository,body,url,statusCheckRollup'] as const
const GH_STATUS_ARGV = ['gh', 'pr', 'status', '--json', 'number,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefOid,headRefName,baseRefName,isCrossRepository,body,url,statusCheckRollup'] as const
const GH_ISSUES_ARGV = ['gh', 'issue', 'list', '--state', 'all', '--limit', '50', '--json', 'number,title,state,body,url'] as const
const GH_PROTECT_ARGV = ['gh', 'api', 'repos/{owner}/{repo}/branches/main/protection'] as const
const GH_RULES_ARGV = ['gh', 'api', 'repos/{owner}/{repo}/rules/branches/main'] as const
const VERCEL_ARGV = ['vercel', 'ls', '--format', 'json', '--non-interactive'] as const
const WT_ARGV = ['wt', 'list', '--format', 'json', '--config-set', 'list.json-schema=1'] as const
const HS_ARGV = ['headsign', 'status'] as const
const FIND_NAMES_ARGV = ['find', '.ai/workflows', '-maxdepth', '2', '-type', 'f'] as const
const FIND_READ_ARGV = ['find', '.ai/workflows', '-maxdepth', '2', '-type', 'f', '(', '-name', '00-index.md', '-o', '-name', '03-slice.md', '-o', '-name', 'cost.jsonl', ')', '-exec', 'awk', 'FNR==1 {print "==> " FILENAME} {print}', '{}', '+'] as const

// the full fed state used by the ok-path block
function fullState(): unknown {
  return feed([
    clock(NOW),
    event('turn.start', { text: 'check https://github.com/o/r/pull/12 please', turnId: 't1' }),
    usage(1.2),
    event('turn.start', { text: '/wf plan demo s1', turnId: 't2' }),
    cmd(GH_REPO, '{"nameWithOwner":"o/r"}'),
    cmd(GH_RUNS_ARGV, RUNS_STDOUT),
    cmd(GH_PRS_ARGV, PRS_STDOUT, NOW + 1_000),
    cmd(GH_STATUS_ARGV, PR_STATUS_STDOUT),
    cmd(GH_ISSUES_ARGV, ISSUES_STDOUT),
    cmd(GH_PROTECT_ARGV, PROTECT_STDOUT),
    cmd(GH_RULES_ARGV, RULES_STDOUT),
    cmd(VERCEL_ARGV, VERCEL_STDOUT),
    cmd(WT_ARGV, WT_STDOUT),
    cmd(HS_ARGV, HS_CLI),
    cmd(FIND_NAMES_ARGV, WF_NAMES_STDOUT),
    cmd(FIND_READ_ARGV, WF_READ_STDOUT),
    file('.headsign/state.json', HS_FILE),
    file('prd.json', PRD),
    file('.vercel/project.json', '{"projectName":"demo"}'),
    env('1'),
    event('tool.call', { tool: 'Bash', command: 'git push origin main' }, NOW),
  ])
}

// ---------------------------------------------------------------------------
// 1. completeness: every catalogue row of the range lands exactly once

test('catalogue rows land exactly once across elements and variantsFor', () => {
  const rows: string[] = []
  const ids = new Set<string>()
  for (const e of external.elements) {
    expect(new Set(e.variants.map(v => v.id)).size, e.id).toBe(e.variants.length)
    for (const v of e.variants) rows.push(...(v.catalogue ?? []))
    rows.push(...e.catalogue)
    expect(ids.has(e.id), `duplicate element id ${e.id}`).toBe(false)
    ids.add(e.id)
  }
  for (const group of external.variantsFor ?? []) {
    for (const v of group.variants) rows.push(...(v.catalogue ?? []))
  }
  const expected: string[] = []
  const range = (a: number, b: number): void => { for (let i = a; i <= b; i += 1) expected.push(`E${String(i).padStart(3, '0')}`) }
  range(71, 77); range(140, 143); range(281, 296); range(312, 334); range(338, 345); range(427, 437); range(485, 497); range(499, 533)
  expect(rows.length).toBe(expected.length)
  expect(new Set(rows).size).toBe(rows.length)
  expect([...new Set(rows)].sort()).toEqual([...new Set(expected)].sort())
})

test('base ids are not redeclared and new ids carry the x- prefix', () => {
  const reserved = new Set(['model', 'route', 'ctx', 'brk', 'sum', 'spd', 'dur', 'cfg', 'style', 'ver', 'name', 'rl', 'cost', 'git', 'git-branch', 'directory', 'branch', 'github', 'five-hour-limit', 'weekly-limit', 'session', 'todo', 'ag', 'tools', 'ram', 'path', 'static', 'tokens-total'])
  for (const e of external.elements) {
    expect(reserved.has(e.id), e.id).toBe(false)
    expect(e.id.startsWith('x-'), e.id).toBe(true)
  }
})

// ---------------------------------------------------------------------------
// 2. pending before any input; the no-source elements answer at once

test('every sourced element is pending before its first input', () => {
  const s = external.init()
  const atOnce = new Set(['x-pr-dash', 'x-wt-diff', 'x-wf-keys', 'x-pr-id', 'x-wf-spinner', 'x-ci-wait', 'x-deploy-wait', 'x-wf-stage-cost', 'x-pr-toast', 'x-ci-toast', 'x-deploy-toast', 'x-pr-state', 'x-pr-merge', 'x-pr-review', 'x-pr-title', 'x-pr-optional', 'x-pr-checks-rows'])
  for (const e of external.elements) {
    const v = val(s, e.id, args(e.variants[0]!.id))
    if (atOnce.has(e.id)) {
      expect(v === undefined || v.state === 'ok' || v.state === 'nosource', `${e.id} answers at once`).toBe(true)
    } else {
      expect(v, e.id).toEqual({ state: 'pending' })
    }
  }
  expect(val(s, 'github', args('x-gh-slug'))).toEqual({ state: 'pending' })
})

// ---------------------------------------------------------------------------
// 3. ok paths with numbers derived from the fixtures

test('github variant x-gh-slug: the gh repo view nameWithOwner', () => {
  expect(text(fullState(), 'github', args('x-gh-slug'))).toBe('o/r')
})

test('tracked PR block: label, state, merge, review, title, checks rows', () => {
  const s = fullState()
  expect(text(s, 'x-pr-id', args('label'))).toBe('o/r#12')
  expect(text(s, 'x-pr-state', args('word'))).toBe('open draft')
  expect(text(s, 'x-pr-merge', args('word'))).toBe('BEHIND')
  expect(text(s, 'x-pr-merge', args('quiet'))).toBe('BEHIND')
  expect(text(s, 'x-pr-review', args('word'))).toBe('changes requested')
  expect(text(s, 'x-pr-title', args('title'))).toBe('fix: band keeps stale lights')
  const checks = val(s, 'x-pr-checks-rows', args('rows'))
  expect(isOk(checks) && checks.rows?.length).toBe(4)
})

test('required split: lights, counters and optional checks derive from protection+rules+rollup', () => {
  const s = fullState()
  // required union = [build, lint, test]; rollup: build pass, test fail, lint pending, opt-scan fail
  const lights = val(s, 'x-pr-lights', args('lights'))
  expect(isOk(lights) && JSON.stringify(lights.rows?.map(r => [r.label, r.icon]))).toBe(JSON.stringify([['build', 'ok'], ['lint', 'run'], ['test', 'fail']]))
  expect(text(s, 'x-pr-counts', args('pin'))).toBe('promote #12, 1 green, 1 yellow, 1 red, BEHIND')
  expect(text(s, 'x-pr-counts', args('pass'))).toBe('1')
  expect(text(s, 'x-pr-counts', args('fail'))).toBe('1')
  expect(text(s, 'x-pr-counts', args('pending'))).toBe('1')
  expect(text(s, 'x-pr-optional', args('failed'))).toBe('+1 optional failed')
  expect(text(s, 'x-pr-optional', args('total'))).toBe('1')
  expect(text(s, 'x-promote-sha', args('sha'))).toBe('9fb543b')
})

test('CI runs: rows, phase, counts, workflow, title, duration, branch PR', () => {
  const s = fullState()
  const runs = val(s, 'x-ci-runs', args('rows'))
  expect(isOk(runs) && runs.rows?.length).toBe(2) // schedule filtered out under human events
  expect(isOk(runs) && runs.rows?.[0]?.right).toBe('◐ Running')
  expect(text(s, 'x-ci-phase', args('phase'))).toBe('◐ Running')
  expect(text(s, 'x-ci-counts', args('running'))).toBe('1')
  expect(text(s, 'x-ci-counts', args('finished'))).toBe('1')
  expect(text(s, 'x-ci-workflow', args('name'))).toBe('CI')
  expect(text(s, 'x-ci-title', args('title'))).toBe('w1688: keep the band (#1688)')
  expect(text(s, 'x-ci-duration', args('duration'))).toBe(nf.duration(90_000)) // NOW − startedAt(NOW−90s)
  expect(text(s, 'x-branch-pr', args('number'))).toBe('#12')
  const all = feed([cmd(GH_RUNS_ARGV, RUNS_STDOUT)])
  expect(text(all, 'x-ci-runs', args('rows', { events: 'all' }))).toBe('3 runs')
  expect(text(all, 'x-ci-runs', args('more', { maxRows: 1 }))).toBe('1 more')
})

test('vercel block: state variants, url, age, counts, project, queue, ref, subject, time, target', () => {
  const s = fullState()
  expect(text(s, 'x-vercel', args('state'))).toBe('◐ Building')
  expect(text(s, 'x-vercel', args('prod'))).toBe('● Ready')
  expect(text(s, 'x-vercel', args('preview'))).toBe('◐ Building')
  expect(text(s, 'x-vercel-url', args('url'))).toBe('demo-x2.vercel.app')
  expect(text(s, 'x-vercel-url', args('url', { max: 6 }))).toBe('demo-…')
  expect(text(s, 'x-vercel-age', args('age'))).toBe(`${nf.duration(60_000)} ago`) // in flight: NOW − createdAt(NOW−60s)
  expect(text(s, 'x-vercel-counts', args('errors'))).toBe('1')
  expect(text(s, 'x-vercel-counts', args('building'))).toBe('1')
  expect(text(s, 'x-vercel-counts', args('queued'))).toBe('0')
  expect(text(s, 'x-vercel-counts', args('finished'))).toBe('2')
  expect(text(s, 'x-vercel-project', args('name'))).toBe('demo')
  expect(text(s, 'x-deploy-queue', args('more', { maxRows: 2 }))).toBe('1 more')
  expect(text(s, 'x-deploy-ref', args('ref'))).toBe('feat/x')
  expect(text(s, 'x-deploy-subject', args('subject'))).toBe('w2: second')
  expect(text(s, 'x-deploy-time', args('duration'))).toBe(nf.duration(60_000)) // in flight since createdAt
  expect(text(s, 'x-deploy-target', args('target'))).toBe('Preview')
})

test('vercel finished age anchors at ready, not createdAt', () => {
  const ready = `Vercel CLI 42.0\n${JSON.stringify({ deployments: [{ url: 'demo-r.vercel.app', name: 'demo', state: 'READY', target: 'production', createdAt: NOW - 300_000, ready: NOW - 240_000 }] })}`
  const s = feed([clock(NOW), cmd(VERCEL_ARGV, ready)])
  // ready = NOW−240s, createdAt = NOW−300s: the age must count from ready
  expect(text(s, 'x-vercel-age', args('age'))).toBe(`${nf.duration(240_000)} ago`)
  expect(text(s, 'x-deploy-time', args('duration'))).toBe(nf.duration(60_000))
})

test('wt block: rows, current branch, count; the N elements name their reason', () => {
  const s = fullState()
  const rows = val(s, 'x-wt-list', args('rows'))
  expect(isOk(rows) && rows.rows?.length).toBe(2)
  expect(text(s, 'x-wt-current', args('branch'))).toBe('main')
  expect(text(s, 'x-wt-count', args('count'))).toBe('2')
  expect(val(s, 'x-wt-diff', args('added'))).toEqual({ state: 'nosource', reason: 'производитель wt working_tree.diff/untracked не прочитан; не приравнивать numstat/cost' })
  expect(val(s, 'x-pr-dash', args('detailed'))).toEqual({ state: 'nosource', reason: 'генератор pr-dash.py status не прочитан; досъём' })
})

test('prd buckets: each variant counts its own bucket from stories[].passes', () => {
  const s = fullState()
  expect(text(s, 'x-prd', args('pending'))).toBe('1 pending')
  expect(text(s, 'x-prd', args('failed'))).toBe('1 failed')
  expect(text(s, 'x-prd', args('needs-setup'))).toBe('1 needs-setup')
  expect(text(s, 'x-prd', args('deferred'))).toBe('1 deferred')
  expect(text(s, 'x-prd', args('unrecognised'))).toBe('1 unrecognised')
  expect(text(s, 'x-prd', args('done'))).toBe('1/6 done')
  expect(text(s, 'x-prd', args('total'))).toBe('6 total')
  expect(text(s, 'x-prd-missing', args('missing'))).toBe('prd.json present · 6 stories')
})

test('my PRs and the branch item card', () => {
  const s = fullState()
  const mine = val(s, 'x-my-prs', args('rows'))
  expect(isOk(mine) && mine.rows?.[0]?.label).toBe('#5 t5')
  expect(isOk(mine) && mine.rows?.[0]?.right).toBe('approved')
  expect(isOk(mine) && mine.rows?.[1]?.right).toBe('draft')
  expect(text(s, 'x-my-pr-count', args('count'))).toBe('2')
  const card = val(s, 'x-branch-item', args('card'))
  expect(isOk(card) && card.rows?.[0]?.label).toBe('#12 PR open')
  expect(isOk(card) && card.rows?.map(r => r.label)).toContain('#34 ISSUE closed') // Closes #34 in the body
  expect(text(s, 'x-branch-checks', args('word'))).toBe('failing')
  expect(text(s, 'x-branch-checks', args('passed'))).toBe('1')
  expect(text(s, 'x-branch-checks', args('failed'))).toBe('2')
  expect(text(s, 'x-branch-checks', args('pending'))).toBe('1')
  expect(text(s, 'x-branch-checks', args('skipped'))).toBe('0')
  expect(text(s, 'x-branch-review', args('word'))).toBe('changes requested')
  expect(text(s, 'x-branch-mergeable', args('word'))).toBe('mergeable')
  const checkRows = val(s, 'x-branch-check-rows', args('rows'))
  expect(isOk(checkRows) && checkRows.rows?.length).toBe(4)
})

test('headsign file block: fields, tolerances, and the never-rendered ids', () => {
  const s = fullState()
  expect(text(s, 'x-hs-state', args('state'))).toBe('RUNNING')
  expect(text(s, 'x-hs-phase', args('phase'))).toBe('review')
  expect(text(s, 'x-hs-workflow', args('name'))).toBe('workflow: default')
  expect(text(s, 'x-hs-attempt', args('attempt'))).toBe('1/3')
  const failure = val(s, 'x-hs-failure', args('rows'))
  expect(isOk(failure) && failure.rows?.[0]?.label).toBe('lint')
  expect(isOk(failure) && failure.rows?.[0]?.right).toBe('exit 1')
  // CONSTRAINT: agent and session ids never render (ADR-0013/0027)
  const driver = text(s, 'x-hs-driver', args('claim'))
  expect(driver).toBe('driver: delegated agent')
  expect(driver.includes('agent-7')).toBe(false)
  const moved = text(s, 'x-hs-moved', args('time'))
  expect(moved).toBe('last moved: 2026-09-24T10:05:00+03:00')
  expect(moved.includes('SESS-ID')).toBe(false)
  expect(text(s, 'x-hs-stop', args('stop'))).toBe('last stop: paused by a note — at 2026-09-24T10:00:00+03:00')
  expect(text(s, 'x-hs-note', args('note'))).toBe('note: waiting for the reviewer')
  expect(text(s, 'x-hs-entered', args('time'))).toBe('entered: 2026-09-24T09:40:00+03:00')
  expect(text(s, 'x-hs-graph-accepted', args('count'))).toBe('graph: 2 accepted changes')
  expect(text(s, 'x-hs-graph-reported', args('flag'))).toBe('graph: changed since accepted')
  expect(text(s, 'x-hs-end-reason', args('reason'))).toBe('none yet (running)')
  expect(text(s, 'x-hs-observer', args('flag'))).toBe('observer: HEADSIGN_OBSERVER is set')
})

test('headsign cli block: attempt, graph file state, description, map, optimization', () => {
  const s = fullState()
  expect(text(s, 'x-hs-graph-file', args('state'))).toBe('changed')
  expect(text(s, 'x-hs-description', args('block'))).toBe('--- phase: review ---\nRun the checks.')
  const map = text(s, 'x-hs-neighbourhood', args('map'))
  expect(map.includes('║ review ║')).toBe(true)
  expect(map.includes('pass ─▶ close')).toBe(true)
  expect(map.includes('workflow:')).toBe(false)
  expect(text(s, 'x-hs-optimization', args('state'))).toBe('optimization: unassessed — .headsign/optimization/opt-1/assessment.md')
})

test('headsign attempt falls back to N/? when the CLI is absent but state.json answers', () => {
  const s = feed([file('.headsign/state.json', HS_FILE)])
  expect(text(s, 'x-hs-attempt', args('attempt'))).toBe('1/?')
})

test('sdlc block: index card, slice stages, progress, ledger, mode, keys', () => {
  const s = fullState()
  const card = val(s, 'x-wf-index', args('card'))
  expect(isOk(card) && card.rows?.map(r => `${r.label}|${r.right ?? ''}`)).toEqual(['demo|slug', 'active|status', 'implement|current-stage', 's1|selected-slice', 'handoff|next-invocation'])
  expect(text(s, 'x-wf-index', args('more'))).toBe('1 more')
  const slices = val(s, 'x-wf-slices', args('rows'))
  expect(isOk(slices) && slices.rows?.map(r => `${r.label}|${r.detail}`)).toEqual(['s1|verified', 's2|defined'])
  expect(text(s, 'x-wf-slices', args('progress'))).toBe('(1 of 2 complete)')
  // ledger: 1000+200+3000 main + 500 subagent = 4700
  expect(text(s, 'x-wf-ledger', args('tokens'))).toBe(`${nf.tokens(4700)} tokens workflow`)
  expect(text(s, 'x-wf-mode', args('mode'))).toBe('wf:implement')
  const keys = val(s, 'x-wf-keys', args('keys'))
  expect(isOk(keys) && keys.rows?.length).toBe(22)
  // the /wf turn is still running in fullState: no completed stage, named reason
  expect(val(s, 'x-wf-stage-cost', args('usd'))).toEqual({ state: 'nosource', reason: 'no /wf stage turn has completed yet' })
})

test('wf stage cost and spinner follow the turn bracket', () => {
  const s = feed([
    clock(NOW),
    usage(1.2),
    event('turn.start', { text: '/wf plan demo s1', turnId: 't2' }),
  ])
  expect(text(s, 'x-wf-spinner', args('word'))).toBe('Planning s1')
  const done = feed([
    clock(NOW),
    usage(1.2),
    event('turn.start', { text: '/wf plan demo s1', turnId: 't2' }),
    usage(1.45),
    event('turn.complete', { reason: 'answer', turnId: 't2' }, NOW + 30_000),
  ])
  expect(text(done, 'x-wf-stage-cost', args('usd'))).toBe(`${nf.usd(1.45 - 1.2)} this stage`)
  expect(text(done, 'x-wf-spinner', args('word'))).toBe('idle')
})

test('ci and deploy waits arm on the trigger lines and hold the elapsed', () => {
  const s = feed([
    clock(NOW + 2_000),
    event('tool.call', { tool: 'Bash', command: 'git push origin main' }, NOW),
  ])
  expect(text(s, 'x-ci-wait', args('wait'))).toBe(`waiting for a run · ${nf.duration(0)}`)
  expect(text(s, 'x-deploy-wait', args('wait'))).toBe(`waiting for a deploy · ${nf.duration(0)}`)
  const quiet = feed([clock(NOW), event('tool.call', { tool: 'Bash', command: 'echo "git push"' }, NOW)])
  expect(val(quiet, 'x-ci-wait', args('wait'))).toEqual({ state: 'nosource', reason: 'no workflow-triggering command seen yet' })
  const arrived = feed([
    clock(NOW + 10_000),
    event('tool.call', { tool: 'Bash', command: 'git push origin main' }, NOW),
    cmd(GH_RUNS_ARGV, RUNS_STDOUT, NOW + 10_000), // run 1688 createdAt = NOW−95s < wake: no newer run
  ])
  expect(text(arrived, 'x-ci-wait', args('wait'))).toBe(`waiting for a run · ${nf.duration(10_000)}`)
})

test('toasts: poll transitions name the change', () => {
  const pr = feed([
    event('turn.start', { text: 'see https://github.com/o/r/pull/12' }, NOW),
    cmd(GH_PRS_ARGV, PRS_STDOUT, NOW),
    cmd(GH_PRS_ARGV, PRS_POLL2, NOW + 60_000),
  ])
  expect(text(pr, 'x-pr-toast', args('change'))).toBe(`test: fail → pass · ${nf.duration(0)} ago`)
  const ci = feed([
    cmd(GH_RUNS_ARGV, JSON.stringify([RUNS[1]!, RUNS[2]!]), NOW),
    cmd(GH_RUNS_ARGV, RUNS_STDOUT, NOW + 60_000),
  ])
  expect(text(ci, 'x-ci-toast', args('toast'))).toBe('CI started (#1688)')
  const dep = feed([
    cmd(VERCEL_ARGV, VERCEL_STDOUT, NOW),
    cmd(VERCEL_ARGV, VERCEL_POLL2, NOW + 60_000),
  ])
  expect(text(dep, 'x-deploy-toast', args('toast'))).toBe(`demo: Ready after ${30000}ms`)
})

test('x-pr-refresh: updated time then the failure form', () => {
  const a = feed([cmd(GH_PRS_ARGV, PRS_STDOUT, NOW)])
  expect(text(a, 'x-pr-refresh', args('time'))).toBe(`updated ${new Date(NOW).toISOString().slice(11, 16)}`)
  const b = feed([cmd(GH_PRS_ARGV, PRS_STDOUT, NOW), cmdFail(GH_PRS_ARGV, 'gh: auth expired', NOW + 60_000)])
  expect(text(b, 'x-pr-refresh', args('error'))).toBe('refresh failed: gh: auth expired')
})

// ---------------------------------------------------------------------------
// 4. nosource on a first failure, stale keeps the last value

test('first failure reads as nosource with the named reason', () => {
  const s = feed([cmdFail(GH_PRS_ARGV, 'gh: not found'), cmdFail(VERCEL_ARGV, 'vercel: no token'), fileFail('.headsign/state.json', 'ENOENT'), fileFail('prd.json', 'ENOENT')])
  expect(val(s, 'x-pr-refresh', args('time'))).toEqual({ state: 'nosource', reason: 'gh: not found' })
  expect(val(s, 'x-vercel', args('state'))).toEqual({ state: 'nosource', reason: 'vercel: no token' })
  expect(val(s, 'x-hs-state', args('state'))).toEqual({ state: 'nosource', reason: 'no .headsign/state.json: ENOENT' })
  expect(val(s, 'x-prd', args('pending'))).toEqual({ state: 'nosource', reason: 'no prd.json: ENOENT' })
  expect(val(s, 'x-prd-missing', args('missing'))).toEqual({ state: 'ok', text: 'no prd.json', at: NOW })
})

test('stale keeps the last good value with the failure reason', () => {
  const s = feed([
    cmd(GH_PRS_ARGV, PRS_STDOUT, NOW), cmdFail(GH_PRS_ARGV, 'gh: rate limited', NOW + 60_000),
    cmd(VERCEL_ARGV, VERCEL_STDOUT, NOW), cmdFail(VERCEL_ARGV, 'vercel: gone', NOW + 60_000),
    cmd(WT_ARGV, WT_STDOUT, NOW), cmdFail(WT_ARGV, 'wt exited 1', NOW + 60_000),
    file('.headsign/state.json', HS_FILE, NOW), fileFail('.headsign/state.json', 'EACCES', NOW + 5_000),
    cmd(HS_ARGV, HS_CLI, NOW), cmdFail(HS_ARGV, 'headsign: command not found', NOW + 10_000),
    cmd(GH_RUNS_ARGV, RUNS_STDOUT, NOW), cmdFail(GH_RUNS_ARGV, 'gh: rate limited', NOW + 60_000),
    cmd(GH_STATUS_ARGV, PR_STATUS_STDOUT, NOW), cmdFail(GH_STATUS_ARGV, 'gh: down', NOW + 60_000),
    cmd(GH_REPO, '{"nameWithOwner":"o/r"}', NOW), cmdFail(GH_REPO, 'gh: none', NOW + 60_000),
    cmd(FIND_READ_ARGV, WF_READ_STDOUT, NOW), cmdFail(FIND_READ_ARGV, 'find: no .ai', NOW + 60_000),
    file('prd.json', PRD, NOW), fileFail('prd.json', 'EACCES', NOW + 10_000),
  ])
  const stale = val(s, 'x-vercel', args('state'))
  expect(stale).toEqual({ state: 'stale', last: { state: 'ok', text: '◐ Building', at: NOW }, reason: 'vercel: gone' })
  expect(val(s, 'x-wt-current', args('branch'))).toEqual({ state: 'stale', last: { state: 'ok', text: 'main', at: NOW }, reason: 'wt exited 1' })
  expect(val(s, 'x-hs-state', args('state'))).toEqual({ state: 'stale', last: { state: 'ok', text: 'RUNNING', at: NOW }, reason: 'EACCES' })
  expect(val(s, 'x-hs-graph-file', args('state'))).toEqual({ state: 'stale', last: { state: 'ok', text: 'changed', at: NOW }, reason: 'headsign: command not found' })
  expect(val(s, 'x-ci-phase', args('phase'))).toEqual({ state: 'stale', last: { state: 'ok', text: '◐ Running', at: NOW }, reason: 'gh: rate limited' })
  expect(val(s, 'x-branch-review', args('word'))).toEqual({ state: 'stale', last: { state: 'ok', text: 'changes requested', at: NOW }, reason: 'gh: down' })
  expect(val(s, 'github', args('x-gh-slug'))).toEqual({ state: 'stale', last: { state: 'ok', text: 'o/r', at: NOW }, reason: 'gh: none' })
  expect(val(s, 'x-wf-mode', args('mode'))).toEqual({ state: 'stale', last: { state: 'ok', text: 'wf:implement', at: NOW }, reason: 'find: no .ai' })
  expect(val(s, 'x-prd', args('pending'))).toEqual({ state: 'stale', last: { state: 'ok', text: '1 pending', at: NOW, num: 1, unit: 'count' }, reason: 'EACCES' })
})

test('tracked PR of another repository names itself instead of guessing', () => {
  const s = feed([
    event('turn.start', { text: 'look at https://github.com/other/repo/pull/5' }, NOW),
    cmd(GH_PRS_ARGV, PRS_STDOUT, NOW),
  ])
  expect(val(s, 'x-pr-state', args('word'))).toEqual({ state: 'nosource', reason: "PR #5 is not in this repository's list" })
})

test('promote elements with no open main-based PR name the reason', () => {
  const s = feed([cmd(GH_PRS_ARGV, JSON.stringify([{ ...PRS[1]!, state: 'OPEN', baseRefName: 'dev' }]), NOW), cmd(GH_PROTECT_ARGV, PROTECT_STDOUT), cmd(GH_RULES_ARGV, RULES_STDOUT)])
  expect(val(s, 'x-pr-lights', args('lights'))).toEqual({ state: 'nosource', reason: 'no open PR based on main' })
  expect(val(s, 'x-pr-merge', args('quiet'))).toEqual({ state: 'nosource', reason: 'no open PR based on main' })
})

test('merge quiet variant hides a CLEAN merge state', () => {
  const clean = { ...PRS[1]!, state: 'OPEN' }
  const s = feed([
    event('turn.start', { text: 'x https://github.com/o/r/pull/9' }, NOW),
    cmd(GH_PRS_ARGV, JSON.stringify([clean]), NOW),
  ])
  expect(text(s, 'x-pr-merge', args('quiet'))).toBe('clean')
})

test('wf elements without .ai/workflows name the reason', () => {
  const s = feed([cmdFail(FIND_READ_ARGV, 'find: .ai/workflows: No such file or directory')])
  expect(val(s, 'x-wf-mode', args('mode'))).toEqual({ state: 'nosource', reason: 'find: .ai/workflows: No such file or directory' })
})
