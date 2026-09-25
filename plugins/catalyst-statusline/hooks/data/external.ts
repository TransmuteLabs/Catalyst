// external.ts — the external-services family: GitHub (slug, PRs, checks,
// runs, issues), CI lights, Vercel deploys, wt worktrees, prd.json stories,
// headsign and sdlc-workflow artifacts. Pure by the types.ts contract: no $,
// no on, no I/O; the core runs the declared sources and feeds reduce/value.
// CONSTRAINT: every catalogue row of this track (E071–E077, E140–E143,
// E281–E296, E312–E334, E338–E345, E427–E437, E485–E497, E499–E533) lands in
// exactly one element or variant catalogue; the mapping lives in
// REPORT-v0.5-data-external.md and nothing may be dropped silently.
// CONSTRAINT: key and token values never reach state, text or samples.
// CONSTRAINT: headsign's driver/agent ids and last_drive session id exist in
// state.json but must never be rendered (ADR-0013/0027 of the reference).

import type { Collector, ElementDef, FormatArgs, Input, Ok, Row, Value, Variant } from './types'

// ---------------------------------------------------------------------------
// pure reference ports (formulas verbatim from the carriers named in the
// catalogue; transport substitutions are listed in the report)

const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/

type WfCommand = { key: string; slug: string | null; slice: string | null }
const WF_KEYS = [
  'intake', 'shape', 'slice', 'plan', 'implement', 'verify', 'review', 'handoff', 'ship', 'retro',
  'design', 'probe', 'simplify', 'auto', 'yolo', 'task', 'status', 'recap', 'close', 'ship-plan', 'docs', 'observability',
]
// CONSTRAINT: the key list is pinned to agent-skills 9e27520 catalog.ts; a newer installed plugin may drift (report concern).
const WF_CATALOG: readonly { key: string; description: string }[] = [
  { key: 'intake', description: 'Start, extend, adopt, or maintain workflow scope.' },
  { key: 'shape', description: 'Shape product intent and acceptance criteria.' },
  { key: 'slice', description: 'Decompose shaped scope into deliverable slices.' },
  { key: 'plan', description: 'Plan one or more workflow slices.' },
  { key: 'implement', description: 'Implement an approved slice plan.' },
  { key: 'verify', description: 'Verify implementation and acceptance evidence.' },
  { key: 'review', description: 'Review a workflow or an ad-hoc scope.' },
  { key: 'handoff', description: 'Prepare a pull-request handoff.' },
  { key: 'ship', description: 'Execute an approved ship plan.' },
  { key: 'retro', description: 'Record workflow lessons and outcomes.' },
  { key: 'design', description: 'Route a design operation.' },
  { key: 'probe', description: 'Collect runtime evidence without source mutation.' },
  { key: 'simplify', description: 'Review a bounded scope for simplification.' },
  { key: 'auto', description: 'Drive stages until the pre-handoff boundary.' },
  { key: 'yolo', description: 'Run policy-governed autonomy with an external grant.' },
  { key: 'task', description: 'Run the minimal non-code lifecycle.' },
  { key: 'status', description: 'Inspect workflow state and next actions.' },
  { key: 'recap', description: 'Explain recorded workflow context.' },
  { key: 'close', description: 'Close a workflow or slice.' },
  { key: 'ship-plan', description: 'Route release-pipeline configuration.' },
  { key: 'docs', description: 'Route documentation operations.' },
  { key: 'observability', description: 'Route observability operations.' },
]
const WF_READ_ONLY_KEYS: ReadonlySet<string> = new Set(['status', 'recap'])
const WF_VERBS: Record<string, string> = {
  shape: 'Shaping', slice: 'Slicing', plan: 'Planning', implement: 'Implementing', verify: 'Verifying',
  review: 'Reviewing', handoff: 'Handing off', ship: 'Shipping', retro: 'Reflecting', design: 'Designing',
  probe: 'Probing', simplify: 'Simplifying', auto: 'Driving', yolo: 'Driving', task: 'Working',
  status: 'Inspecting', recap: 'Recapping', close: 'Closing', docs: 'Documenting', observability: 'Instrumenting',
}

/** The `/wf <key> [slug] [slice]` a prompt starts with (active.ts:70); null for any other text. */
export function wfCommandOf(text: string): WfCommand | null {
  const match = /^\s*\/(?:sdlc-workflow:)?wf(?:-([a-z-]+))?(?:\s+([\s\S]*))?$/u.exec(text)
  if (match === null) return null
  const tokens = (match[2] ?? '').trim().split(/\s+/u).filter(t => t !== '')
  let key = match[1] ?? null
  if (key === null) key = tokens.shift() ?? null
  if (key === null || !WF_KEYS.includes(key)) return null
  return { key, slug: tokens[0] ?? null, slice: tokens[1] ?? null }
}

// gh-ci-status workflow-run.ts: statuses, person events, phase labels
type GhRun = {
  databaseId: number
  status: string
  conclusion: string | null
  event: string
  workflowName: string
  headBranch: string
  displayTitle: string
  createdAt: string
  startedAt: string
  updatedAt: string
  url: string
}
const PERSON_EVENTS: ReadonlySet<string> = new Set([
  'push', 'pull_request', 'pull_request_target', 'workflow_dispatch', 'merge_group', 'release', 'workflow_run',
])
const RUN_LABELS: Record<string, string> = {
  running: 'Running', queued: 'Queued', success: 'Success', failure: 'Failed',
  timed_out: 'Timed out', startup_failure: 'Failed', cancelled: 'Cancelled',
}
const inFlightRun = (run: GhRun): boolean => run.status !== 'completed'

export function runPhase(run: GhRun): { dot: string; label: string; kind: 'ok' | 'run' | 'fail' | 'info' } {
  if (run.status === 'in_progress') return { dot: '◐', label: RUN_LABELS.running!, kind: 'run' }
  if (inFlightRun(run)) return { dot: '○', label: RUN_LABELS.queued!, kind: 'run' }
  switch (run.conclusion) {
    case 'success': return { dot: '●', label: RUN_LABELS.success!, kind: 'ok' }
    case 'failure': case 'startup_failure': return { dot: '✗', label: RUN_LABELS[run.conclusion]!, kind: 'fail' }
    case 'timed_out': return { dot: '✗', label: RUN_LABELS.timed_out!, kind: 'fail' }
    case 'cancelled': return { dot: '⊘', label: RUN_LABELS.cancelled!, kind: 'fail' }
    default: return { dot: '·', label: run.conclusion ?? 'Done', kind: 'info' }
  }
}

// gh-ci-status trigger-commands.ts: shell lines that probably start a workflow run
const WF_TRIGGERS =
  /(^|[^\w./-])(git(\s+-\S+(\s+\S+)?)*\s+(subtree\s+)?push(\s|$)|gh\s+pr\s+merge(\s|$)|gh\s+workflow\s+run(\s|$)|gh\s+run\s+rerun(\s|$))/
const WF_DRY_RUN = /push\b.*(--dry-run|\s-n\b)/

export function triggersWorkflow(command: string): boolean {
  return command
    .replace(/'[^']*'|"[^"]*"/g, '')
    .split(/&&|\||;/)
    .some(segment => WF_TRIGGERS.test(segment) && !WF_DRY_RUN.test(segment))
}

// vercel-deploy-status queue.ts: states, shapes, the deploy-triggering line
type VercelState = 'QUEUED' | 'BUILDING' | 'INITIALIZING' | 'READY' | 'ERROR' | 'CANCELED'
type Deployment = {
  url: string
  name: string
  state: VercelState
  target: string | null
  createdAt: number
  ready?: number
  meta?: { githubCommitRef?: string; githubCommitMessage?: string }
}
const IN_FLIGHT: ReadonlySet<string> = new Set(['QUEUED', 'BUILDING', 'INITIALIZING'])
const DEPLOYS = /(^|[^\w./-])(git(\s+-\S+(\s+\S+)?)*\s+push(\s|$)|gh\s+pr\s+merge(\s|$)|vercel\s+(deploy|--prod)(\s|$))/
const DEPLOY_DRY_RUN = /--dry-run/

export function isDeployCommand(command: string): boolean {
  return DEPLOYS.test(command) && !DEPLOY_DRY_RUN.test(command)
}
const V_LABEL: Record<VercelState, string> = {
  QUEUED: 'Queued', BUILDING: 'Building', INITIALIZING: 'Initializing', READY: 'Ready', ERROR: 'Error', CANCELED: 'Canceled',
}
const V_DOT: Record<VercelState, string> = {
  QUEUED: '○', BUILDING: '◐', INITIALIZING: '◑', READY: '●', ERROR: '✗', CANCELED: '⊘',
}

/** `vercel ls --format json` prefixes chatter before the JSON; the parse starts at the first brace. */
export function parseVercelList(stdout: string): Deployment[] {
  const start = stdout.indexOf('{')
  if (start < 0) throw new Error('no JSON in vercel ls output')
  const body = JSON.parse(stdout.slice(start)) as { deployments?: Deployment[] }
  return (body.deployments ?? []).slice().sort((a, b) => b.createdAt - a.createdAt)
}
const deployTargetOf = (d: Deployment): string => (d.target === 'production' ? 'Production' : 'Preview')

// promote-lights required.ts + classify.ts: required contexts and the light colours
export function parseProtection(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as { required_status_checks?: { contexts?: string[] } }
    return parsed.required_status_checks?.contexts ?? []
  } catch { return [] }
}
export function parseRulesets(body: string): string[] {
  try {
    const parsed: unknown = JSON.parse(body)
    const rules = Array.isArray(parsed)
      ? (parsed as { parameters?: { required_status_checks?: Array<{ context?: string }> } }[])
      : []
    const contexts: string[] = []
    for (const rule of rules) {
      for (const check of rule.parameters?.required_status_checks ?? []) {
        if (check.context) contexts.push(check.context)
      }
    }
    return contexts
  } catch { return [] }
}
export function computeRequiredUnion(protectionBody: string, rulesetsBody: string): string[] {
  return Array.from(new Set([...parseProtection(protectionBody), ...parseRulesets(rulesetsBody)])).sort()
}
type LightColor = 'green' | 'yellow' | 'red' | 'cancelled'
const LIGHT_SEVERITY: Record<LightColor, number> = { green: 0, yellow: 1, cancelled: 2, red: 3 }

// cc-pr-tracker toCheck: one rollup node to a bucket
type RollupNode = {
  __typename?: string
  name?: string
  context?: string
  status?: string | null
  state?: string | null
  conclusion?: string | null
  detailsUrl?: string
  targetUrl?: string
}
type Bucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'
const BUCKET_ICON: Record<Bucket, Row['icon']> = { pass: 'ok', fail: 'fail', pending: 'run', skipping: 'todo', cancel: 'fail' }

export function toCheck(c: RollupNode): { name: string; bucket: Bucket; link: string } {
  const name = (c.__typename === 'StatusContext' ? c.context : c.name) ?? c.name ?? c.context ?? ''
  const link = c.detailsUrl ?? c.targetUrl ?? ''
  if (c.__typename === 'StatusContext') {
    const bucket: Bucket = c.state === 'SUCCESS' ? 'pass' : c.state === 'PENDING' || c.state === 'EXPECTED' ? 'pending' : 'fail'
    return { name, bucket, link }
  }
  const bucket: Bucket = c.status !== undefined && c.status !== null && c.status !== 'COMPLETED'
    ? 'pending'
    : c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' ? 'pass'
    : c.conclusion === 'SKIPPED' ? 'skipping'
    : c.conclusion === 'CANCELLED' ? 'cancel'
    : c.conclusion === 'FAILURE' || c.conclusion === 'TIMED_OUT' || c.conclusion === 'ACTION_REQUIRED' || c.conclusion === 'ERROR' ? 'fail'
    : 'pending'
  return { name, bucket, link }
}

/** promote-lights classify.ts matchAndClassify: worst colour wins per required context, missing is red. */
export function matchAndClassify(requiredContexts: string[], checks: Array<{ name: string; bucket: Bucket }>): Array<{ name: string; color: LightColor }> {
  const colorOf = (bucket: Bucket): LightColor =>
    bucket === 'pass' ? 'green' : bucket === 'pending' || bucket === 'skipping' ? 'yellow' : 'red'
  return requiredContexts.map(ctx => {
    const matching = checks.filter(c => c.name === ctx)
    if (matching.length === 0) return { name: ctx, color: 'red' as const }
    let worst: LightColor = 'green'
    for (const c of matching) {
      const color = colorOf(c.bucket)
      if (LIGHT_SEVERITY[color] > LIGHT_SEVERITY[worst]) worst = color
    }
    return { name: ctx, color: worst }
  })
}
const LIGHT_ICON: Record<LightColor, Row['icon']> = { green: 'ok', yellow: 'run', red: 'fail', cancelled: 'info' }

// BenjaminG prs.tsx: the review words and the checks verdict
// E429's row words (prs.tsx): short labels for the list rows
const REVIEW_WORD: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'review' }
// E284's row words (cc-pr-tracker register.tsx): the full phrases
const REVIEW_PHRASE: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review required' }
function checksVerdict(checks: RollupNode[]): { icon: Row['icon']; word: string } {
  const verdicts = checks.map(c => String(c.conclusion ?? c.state ?? c.status ?? ''))
  if (verdicts.some(v => /FAILURE|TIMED_OUT|CANCELLED|ACTION_REQUIRED|ERROR/.test(v))) return { icon: 'fail', word: 'failing' }
  if (verdicts.some(v => /PENDING|IN_PROGRESS|QUEUED|WAITING|EXPECTED/.test(v))) return { icon: 'run', word: 'running' }
  return verdicts.length === 0 ? { icon: 'todo', word: 'no checks' } : { icon: 'ok', word: 'passing' }
}

// pull-request-pane: closing keyword references in a PR body
const CLOSE_KEYWORD_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*#(\d+)/gi
function closingNumbersOf(body: string): number[] {
  return [...body.matchAll(CLOSE_KEYWORD_RE)].map(match => Number(match[1]))
}

// claude-auto-dev sprint-status.mjs: the prd.json buckets
const PRD_DONE = true
const PRD_PENDING = null
const PRD_FAILED = false
const PRD_DEFERRED = 'deferred'
const PRD_NEEDS_SETUP = 'needs-setup'
type PrdCounts = { done: number; pending: number; failed: number; deferred: number; needsSetup: number; unrecognised: number; total: number }

export function prdSummarise(raw: unknown): PrdCounts {
  const counts: PrdCounts = { done: 0, pending: 0, failed: 0, deferred: 0, needsSetup: 0, unrecognised: 0, total: 0 }
  const prd = raw as { sprints?: unknown[]; stories?: Record<string, unknown> } | null
  if (prd === null || typeof prd !== 'object') return counts
  let merged: Record<string, unknown> = {}
  let sawNested = false
  for (const sprint of Array.isArray(prd.sprints) ? prd.sprints : []) {
    const stories = (sprint as { stories?: Record<string, unknown> } | null)?.stories
    if (stories === null || typeof stories !== 'object') continue
    sawNested = true
    merged = { ...merged, ...stories }
  }
  if (!sawNested && prd.stories && typeof prd.stories === 'object') merged = prd.stories
  const all = Object.values(merged)
  for (const story of all) {
    const p = (story as { passes?: unknown } | null)?.passes
    counts.total += 1
    if (p === PRD_DONE) counts.done += 1
    else if (p === PRD_PENDING || p === undefined) counts.pending += 1
    else if (p === PRD_FAILED) counts.failed += 1
    else if (p === PRD_DEFERRED) counts.deferred += 1
    else if (p === PRD_NEEDS_SETUP) counts.needsSetup += 1
    else counts.unrecognised += 1
  }
  return counts
}

// sdlc-workflow workflows.ts/active.ts: frontmatter, roster, stages, ledger
type WfEntry = {
  slug: string
  status: string
  terminal: boolean
  currentStage: string | null
  selectedSlice: string | null
  nextInvocation: string | null
  roster: Array<{ slug: string; status: string; complexity: string | null; stage: 'defined' | 'planned' | 'implemented' | 'verified' }>
  ledgerTokens: number | null
}
const TERMINAL_WORKFLOW_STATUSES: ReadonlySet<string> = new Set(['complete', 'completed', 'closed', 'abandoned', 'cancelled'])

function frontmatterOf(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)
  if (match === null) return fields
  for (const line of (match[1] ?? '').split(/\r?\n/u)) {
    const f = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line)
    if (f === null) continue
    const value = f[2] ?? ''.trim()
    const quoted = /^"(.*)"$|^'(.*)'$/u.exec(value.trim())
    fields[f[1] as string] = quoted ? (quoted[1] ?? quoted[2] ?? '').trim() : value.trim()
  }
  return fields
}
function rosterOf(text: string): Array<{ slug: string; status: string; complexity: string | null }> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)
  if (match === null) return []
  const lines = (match[1] ?? '').split(/\r?\n/u)
  const start = lines.findIndex(line => /^slices:\s*$/u.test(line))
  if (start < 0) return []
  const roster: Array<{ slug: string; status: string; complexity: string | null }> = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (/^\S/u.test(line)) break
    const item = /^\s*-\s+slug:\s*(.*)$/u.exec(line)
    if (item !== null) {
      roster.push({ slug: item[1] ?? '', status: 'defined', complexity: null })
      continue
    }
    const field = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line)
    const current = roster[roster.length - 1]
    if (field === null || current === undefined) continue
    if (field[1] === 'status') current.status = (field[2] ?? '').trim()
    if (field[1] === 'complexity') current.complexity = (field[2] ?? '').trim()
  }
  return roster.filter(entry => entry.slug !== '')
}
function stageOf(slice: string, names: ReadonlySet<string>): WfEntry['roster'][number]['stage'] {
  if (names.has(`06-verify-${slice}.md`)) return 'verified'
  if (names.has(`05-implement-${slice}.md`)) return 'implemented'
  if (names.has(`04-plan-${slice}.md`)) return 'planned'
  return 'defined'
}
function tokensOfUsage(usage: unknown): number {
  if (usage === null || typeof usage !== 'object') return 0
  const u = usage as Record<string, unknown>
  const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0)
  return (
    int(u.input_tokens) + int(u.output_tokens) + int(u.cache_read_input_tokens) + int(u.cached_input_tokens) +
    int(u.cache_creation_input_tokens) + int(u.cache_write_input_tokens) + int(u.reasoning_output_tokens)
  )
}
/** active.ts ledgerTokensOf: every cost.jsonl row's main and subagent tokens summed. */
export function ledgerTokensOf(text: string): number {
  let total = 0
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === '') continue
    let row: unknown
    try { row = JSON.parse(line) } catch { continue }
    if (row === null || typeof row !== 'object') continue
    const record = row as { main?: unknown; subagents?: unknown }
    total += tokensOfUsage(record.main)
    if (Array.isArray(record.subagents)) for (const sub of record.subagents) total += tokensOfUsage(sub)
  }
  return total
}
/** Split the `==> path`-headed awk stream into per-file texts. */
export function splitByHeader(text: string): Array<{ path: string; body: string }> {
  const out: Array<{ path: string; body: string }> = []
  for (const line of text.split(/\r?\n/u)) {
    const head = /^==> (.+)$/.exec(line)
    if (head !== null) out.push({ path: head[1] ?? '', body: '' })
    else if (out.length > 0) {
      const last = out[out.length - 1] as { path: string; body: string }
      last.body += `${line}\n`
    }
  }
  return out
}

// headsign render.ts: the stop wordings, verbatim
const LAST_STOP_WORDING: Record<'nudged' | 'paused' | 'stalled', string> = {
  nudged: 'held, and pointed back to headsign next',
  paused: 'paused by a note',
  stalled: 'not held — the nudge cap is spent',
}
const UNHELD_WORDING: Record<string, string> = {
  stop_hook_active: 'not held — Claude Code had already resumed the turn (stop_hook_active)',
  CLAUDE_PROJECT_DIR: 'not held — the session was not standing in the run\'s tree (CLAUDE_PROJECT_DIR)',
}
function lastStopWording(disposition: string, cause?: string): string {
  if (disposition === 'unheld') return UNHELD_WORDING[cause ?? 'stop_hook_active'] ?? UNHELD_WORDING.stop_hook_active!
  return LAST_STOP_WORDING[disposition as 'nudged' | 'paused' | 'stalled'] ?? disposition
}

// ---------------------------------------------------------------------------
// state

type Cell<T> =
  | { ok: true; data: T; at: number }
  | { ok: false; error: string; at: number; lastGood?: { data: T; at: number } }

type Ans<T> =
  | { t: 'ok'; data: T; at: number }
  | { t: 'pending' }
  | { t: 'nosource'; reason: string }
  | { t: 'stale'; data: T; at: number; reason: string }

function ans<T>(cell: Cell<T> | undefined): Ans<T> {
  if (cell === undefined) return { t: 'pending' }
  if (cell.ok) return { t: 'ok', data: cell.data, at: cell.at }
  if (cell.lastGood !== undefined) return { t: 'stale', data: cell.lastGood.data, at: cell.lastGood.at, reason: cell.error }
  return { t: 'nosource', reason: cell.error }
}

type GhPrRow = {
  number: number
  title: string
  state: string
  isDraft: boolean
  mergeable?: string
  mergeStateStatus?: string
  reviewDecision?: string
  headRefOid?: string
  headRefName?: string
  baseRefName?: string
  isCrossRepository?: boolean
  body?: string
  url?: string
  statusCheckRollup?: RollupNode[]
}
type HsState = {
  workflow?: string
  status?: string
  phase?: string
  attempts?: Record<string, number>
  last_failure?: { phase?: string; check?: string; run?: string; exit_code?: number | string; output_tail?: string; elapsed_seconds?: number; timeout_seconds?: number } | null
  end_reason?: string | null
  driver_agent?: string | null
  phase_entered_at?: string | null
  last_stop?: { disposition?: string; at?: string; cause?: string; note?: string } | null
  last_drive?: { session?: string; at?: string } | null
  graph_change_reported?: string | null
  accepted_graph_changes?: number
}

// A cell is undefined until the source has answered at least once: undefined
// reads as pending, a failure with no last good read as nosource (types.ts).
type State = {
  lastNow: number
  repoSlug: Cell<string> | undefined
  runs: Cell<GhRun[]> | undefined
  prs: Cell<GhPrRow[]> | undefined
  prStatus: Cell<{ currentBranch: GhPrRow[]; createdBy: GhPrRow[] }> | undefined
  issues: Cell<Array<{ number: number; title: string; state: string; body?: string; url?: string }>> | undefined
  protect: Cell<string[]> | undefined
  rules: Cell<string[]> | undefined
  vercel: Cell<Deployment[]> | undefined
  vercelProject: Cell<string> | undefined
  wt: Cell<Array<{ branch: string; path: string; is_current: boolean }>> | undefined
  hsFile: Cell<HsState> | undefined
  hsCli: Cell<string> | undefined
  prd: Cell<unknown> | undefined
  wfNames: Cell<Array<{ slug: string; files: Set<string> }>> | undefined
  wfRead: Cell<WfEntry[]> | undefined
  observer: Cell<boolean> | undefined
  sessionCost: { usd: number; at: number } | null
  pasted: { owner: string; repo: string; number: number; at: number } | null
  wfBracket: { turnId: string; command: WfCommand; costAtStart: number | null; at: number } | null
  lastWf: { command: WfCommand; at: number } | null
  lastStageUsd: number | null
  ciWake: { at: number } | null
  deployWake: { at: number } | null
  prToast: { text: string; at: number } | null
  ciToast: { text: string; at: number } | null
  deployToast: { text: string; at: number } | null
  prevTracked: { merge: string; buckets: Map<string, string> } | null
  prevRuns: Map<number, string> | null
  prevVercel: Map<string, string> | null
}

// ---------------------------------------------------------------------------
// element definitions

const v = (id: string, label: string, catalogue?: string[]): Variant => ({ id, label, ...(catalogue === undefined ? {} : { catalogue }) })
const row = (icon: Row['icon'], label: string, right?: string, detail?: string): Row =>
  ({ icon, label, ...(right === undefined ? {} : { right }), ...(detail === undefined ? {} : { detail }) })

function def(d: Omit<ElementDef, 'outcome'> & { outcome?: 'C' | 'N' }): ElementDef {
  return { outcome: 'C', ...d }
}

const ELEMENTS: ElementDef[] = [
  // ---- tracked PR (a GitHub PR URL pasted into the prompt; cc-pr-tracker) ----
  def({
    id: 'x-pr-id', family: 'github', label: 'tracked PR', kind: 'text',
    about: 'the repo#number label of the PR whose URL the prompt carried',
    variants: [v('label', 'label', ['E281'])], catalogue: [],
    sample: 'sezaakgun/cc-pr-tracker#12',
  }),
  def({
    id: 'x-pr-state', family: 'github', label: 'PR state', kind: 'text',
    about: 'open/draft/merged/closed of the tracked PR',
    variants: [v('word', 'word', ['E282'])], catalogue: [],
    sample: 'open draft',
  }),
  def({
    id: 'x-pr-merge', family: 'github', label: 'merge state', kind: 'text',
    about: 'mergeStateStatus: the tracked PR (word) or the promote PR (quiet at CLEAN)',
    variants: [v('word', 'tracked', ['E283']), v('quiet', 'promote, quiet at clean', ['E143'])], catalogue: [],
    sample: 'BEHIND',
  }),
  def({
    id: 'x-pr-review', family: 'github', label: 'review decision', kind: 'text',
    about: 'the tracked PR review decision as a word',
    variants: [v('word', 'word', ['E284'])], catalogue: [],
    sample: 'approved',
  }),
  def({
    id: 'x-pr-title', family: 'github', label: 'PR title', kind: 'text',
    about: 'the title of the tracked PR',
    variants: [v('title', 'title', ['E290'])], catalogue: [],
    sample: 'fix: band keeps stale lights',
  }),
  def({
    id: 'x-pr-toast', family: 'github', label: 'PR change toast', kind: 'text',
    about: 'the last check-bucket or merge-state change between two polls of the tracked PR',
    variants: [v('change', 'change', ['E291'])], catalogue: [],
    sample: 'label check: pending → fail',
  }),
  def({
    id: 'x-pr-refresh', family: 'github', label: 'PR poll freshness', kind: 'text',
    about: 'when the tracked-PR poll last answered, and its last failure',
    variants: [v('time', 'updated', ['E296']), v('error', 'error', ['E289'])], catalogue: [],
    sample: 'updated 14:32',
  }),
  def({
    id: 'x-pr-optional', family: 'github', label: 'optional checks', kind: 'text',
    about: 'counts over the tracked PR checks that no required context names',
    variants: [v('failed', 'failed', ['E288']), v('total', 'total', ['E295'])], catalogue: [],
    sample: '+2 optional failed',
  }),
  def({
    id: 'x-pr-checks-rows', family: 'github', label: 'PR checks', kind: 'list',
    about: 'one row per check of the tracked PR: status, name, link',
    variants: [v('rows', 'rows')], catalogue: ['E292', 'E293', 'E294'],
    sample: '✓ build · ✗ test',
  }),
  def({
    id: 'x-branch-pr', family: 'github', label: 'branch PR', kind: 'text',
    about: 'the PR number of the branch a CI run ran on, matched by headRefName',
    variants: [v('number', 'number', ['E317'])], catalogue: [],
    options: [{ key: 'run', label: 'which run of the list (1 = newest)', kind: 'int', min: 1, max: 15, default: 1 }],
    sample: '#1687',
  }),
  // ---- CI (promote-lights + gh-ci-status) ----
  def({
    id: 'x-pr-lights', family: 'ci', label: 'required lights', kind: 'list',
    about: 'one light per required context of the open promote PR, worst colour wins',
    variants: [v('lights', 'lights', ['E140'])], catalogue: [],
    sample: '🟢 build · 🔴 test',
  }),
  def({
    id: 'x-pr-counts', family: 'ci', label: 'check counters', kind: 'text',
    about: 'the promote pin line, or one bucket count of the tracked PR required checks',
    variants: [v('pin', 'promote pin', ['E141']), v('pass', 'pass', ['E285']), v('fail', 'fail', ['E286']), v('pending', 'pending', ['E287'])], catalogue: [],
    sample: 'promote #12, 9 green, 1 yellow, BEHIND',
  }),
  def({
    id: 'x-promote-sha', family: 'ci', label: 'promote head', kind: 'text',
    about: 'the first 7 chars of the promote PR headRefOid',
    variants: [v('sha', 'sha7', ['E142'])], catalogue: [],
    sample: '9fb543b',
  }),
  def({
    id: 'x-ci-runs', family: 'ci', label: 'CI runs', kind: 'list',
    about: 'the gh run list as rows, person events only by default',
    variants: [v('rows', 'rows', ['E313']), v('more', 'hidden count', ['E322'])], catalogue: [],
    options: [
      { key: 'maxRows', label: 'rows shown', kind: 'int', min: 1, max: 15, default: 5 },
      { key: 'events', label: 'events', kind: 'choice', choices: [{ id: 'human', label: 'human' }, { id: 'all', label: 'all' }], default: 'human' },
    ],
    sample: '◐ Running · CI',
  }),
  def({
    id: 'x-ci-phase', family: 'ci', label: 'run phase', kind: 'text',
    about: 'the phase word of one CI run',
    variants: [v('phase', 'phase', ['E314'])], catalogue: [],
    options: [{ key: 'run', label: 'which run of the list (1 = newest)', kind: 'int', min: 1, max: 15, default: 1 }],
    sample: '◐ Running',
  }),
  def({
    id: 'x-ci-counts', family: 'ci', label: 'run counts', kind: 'text',
    about: 'running/finished counts over the person-event run list',
    variants: [v('running', 'running', ['E315']), v('finished', 'finished', ['E316'])], catalogue: [],
    sample: '2 running',
  }),
  def({
    id: 'x-ci-workflow', family: 'ci', label: 'workflow name', kind: 'text',
    about: 'the workflowName of one CI run, vercel fallback',
    variants: [v('name', 'name', ['E318'])], catalogue: [],
    options: [
      { key: 'run', label: 'which run of the list (1 = newest)', kind: 'int', min: 1, max: 15, default: 1 },
      { key: 'max', label: 'cut to N chars (0 = full)', kind: 'int', min: 0, max: 60, default: 20 },
    ],
    sample: 'CI',
  }),
  def({
    id: 'x-ci-title', family: 'ci', label: 'run title', kind: 'text',
    about: 'the displayTitle of one CI run, the #N repeat cut away',
    variants: [v('title', 'title', ['E319'])], catalogue: [],
    options: [{ key: 'run', label: 'which run of the list (1 = newest)', kind: 'int', min: 1, max: 15, default: 1 }],
    sample: 'w1687: declare deps',
  }),
  def({
    id: 'x-ci-duration', family: 'ci', label: 'run duration', kind: 'text',
    about: 'ended−started of one CI run, now−started while in flight',
    variants: [v('duration', 'duration', ['E320'])], catalogue: [],
    options: [{ key: 'run', label: 'which run of the list (1 = newest)', kind: 'int', min: 1, max: 15, default: 1 }],
    sample: '3m09s',
  }),
  def({
    id: 'x-ci-wait', family: 'ci', label: 'run wait', kind: 'text',
    about: 'elapsed since a workflow-triggering shell line, until a new run appears',
    variants: [v('wait', 'wait', ['E321'])], catalogue: [],
    sample: 'waiting for a run · 12s',
  }),
  def({
    id: 'x-ci-toast', family: 'ci', label: 'run toast', kind: 'text',
    about: 'the last CI run start or finish between two polls',
    variants: [v('toast', 'toast', ['E323'])], catalogue: [],
    sample: 'CI started (#1687)',
  }),
  // ---- Vercel deploys ----
  def({
    id: 'x-vercel', family: 'deploy', label: 'vercel state', kind: 'text',
    about: 'the newest deployment state: any, production or preview',
    variants: [v('state', 'any', ['E071']), v('prod', 'production', ['E076']), v('preview', 'preview', ['E077'])], catalogue: [],
    sample: '● Ready',
  }),
  def({
    id: 'x-vercel-url', family: 'deploy', label: 'vercel url', kind: 'text',
    about: 'the url of the newest deployment, cut to a length on option',
    variants: [v('url', 'url', ['E072'])], catalogue: [],
    options: [{ key: 'max', label: 'cut to N chars (0 = full)', kind: 'int', min: 0, max: 80, default: 0 }],
    sample: 'demo-abc.vercel.app',
  }),
  def({
    id: 'x-vercel-age', family: 'deploy', label: 'deploy age', kind: 'text',
    about: 'how long ago the newest deployment was created (finished: since ready)',
    variants: [v('age', 'age', ['E073'])], catalogue: [],
    sample: '4m ago',
  }),
  def({
    id: 'x-vercel-counts', family: 'deploy', label: 'deploy counts', kind: 'text',
    about: 'state counts over the recent deployments window',
    variants: [v('errors', 'errors', ['E074']), v('building', 'building', ['E075']), v('queued', 'queued', ['E326']), v('finished', 'finished', ['E327'])], catalogue: [],
    options: [{ key: 'recent', label: 'how many newest deployments count', kind: 'int', min: 1, max: 20, default: 5 }],
    sample: '1 building',
  }),
  def({
    id: 'x-vercel-project', family: 'deploy', label: 'vercel project', kind: 'text',
    about: 'the projectName of .vercel/project.json, vercel fallback',
    variants: [v('name', 'name', ['E324'])], catalogue: [],
    sample: 'demo',
  }),
  def({
    id: 'x-deploy-queue', family: 'deploy', label: 'deploy queue', kind: 'list',
    about: 'the vercel ls rows, newest first',
    variants: [v('rows', 'rows', ['E325']), v('more', 'hidden count', ['E333'])], catalogue: [],
    options: [{ key: 'maxRows', label: 'rows shown', kind: 'int', min: 1, max: 20, default: 5 }],
    sample: '◐ Building · demo-x2.vercel.app',
  }),
  def({
    id: 'x-deploy-ref', family: 'deploy', label: 'deploy ref', kind: 'text',
    about: 'the git ref the newest deployment was built from',
    variants: [v('ref', 'ref', ['E329'])], catalogue: [],
    sample: 'main',
  }),
  def({
    id: 'x-deploy-subject', family: 'deploy', label: 'deploy subject', kind: 'text',
    about: 'the commit subject of the newest deployment',
    variants: [v('subject', 'subject', ['E330'])], catalogue: [],
    options: [{ key: 'max', label: 'cut to N chars', kind: 'int', min: 10, max: 120, default: 72 }],
    sample: 'w: keep the queue honest',
  }),
  def({
    id: 'x-deploy-time', family: 'deploy', label: 'deploy time', kind: 'text',
    about: 'ready−created of the newest deploy, now−created while in flight',
    variants: [v('duration', 'duration', ['E331'])], catalogue: [],
    sample: '1m 20s',
  }),
  def({
    id: 'x-deploy-target', family: 'deploy', label: 'deploy target', kind: 'text',
    about: 'production or preview of the newest deployment',
    variants: [v('target', 'target', ['E328'])], catalogue: [],
    sample: 'Production',
  }),
  def({
    id: 'x-deploy-wait', family: 'deploy', label: 'deploy wait', kind: 'text',
    about: 'elapsed since a deploy-triggering shell line, until a new deployment appears',
    variants: [v('wait', 'wait', ['E332'])], catalogue: [],
    sample: 'waiting for a deploy · 8s',
  }),
  def({
    id: 'x-deploy-toast', family: 'deploy', label: 'deploy toast', kind: 'text',
    about: 'the last deployment start or finish between two polls',
    variants: [v('toast', 'toast', ['E334'])], catalogue: [],
    sample: 'demo: deploy started (Production)',
  }),
  // ---- wt worktrees ----
  def({
    id: 'x-wt-list', family: 'git', label: 'worktrees', kind: 'list',
    about: 'the wt list rows of the repository',
    variants: [v('rows', 'rows', ['E432'])], catalogue: [],
    sample: 'main · feat/x',
  }),
  def({
    id: 'x-wt-current', family: 'git', label: 'current worktree', kind: 'text',
    about: 'the branch of the worktree wt marks is_current',
    variants: [v('branch', 'branch', ['E433'])], catalogue: [],
    sample: 'main',
  }),
  def({
    id: 'x-wt-count', family: 'git', label: 'worktree count', kind: 'text',
    about: 'how many worktrees wt lists',
    variants: [v('count', 'count', ['E437'])], catalogue: [],
    sample: '3',
  }),
  def({
    id: 'x-wt-diff', family: 'git', label: 'wt diff lines', kind: 'text',
    about: 'added/deleted/untracked of wt working_tree JSON — listed, unavailable',
    variants: [v('added', 'added', ['E434']), v('deleted', 'deleted', ['E435']), v('untracked', 'untracked', ['E436'])], catalogue: [],
    outcome: 'N', reason: 'производитель wt working_tree.diff/untracked не прочитан; не приравнивать numstat/cost',
    sample: '⊘',
  }),
  // ---- prd.json stories ----
  def({
    id: 'x-prd', family: 'project', label: 'prd stories', kind: 'text',
    about: 'one bucket count of the prd.json stories',
    variants: [
      v('pending', 'pending', ['E338']), v('failed', 'failed', ['E339']), v('needs-setup', 'needs-setup', ['E340']),
      v('deferred', 'deferred', ['E341']), v('unrecognised', 'unrecognised', ['E342']), v('done', 'done D/T', ['E343']), v('total', 'total', ['E344']),
    ], catalogue: [],
    sample: '2 pending',
  }),
  def({
    id: 'x-prd-missing', family: 'project', label: 'prd presence', kind: 'text',
    about: 'whether prd.json exists at all — its absence is the datum',
    variants: [v('missing', 'missing', ['E345'])], catalogue: [],
    sample: 'no prd.json',
  }),
  // ---- my open PRs (BenjaminG /prs) ----
  def({
    id: 'x-my-prs', family: 'github', label: 'my PRs', kind: 'list',
    about: 'the open PRs authored by me: checks verdict, number+title, review state',
    variants: [v('rows', 'rows')], catalogue: ['E427', 'E428', 'E429'],
    sample: '✓ #5 fix band · approved',
  }),
  def({
    id: 'x-my-pr-count', family: 'github', label: 'my PR count', kind: 'text',
    about: 'how many open PRs I authored',
    variants: [v('count', 'count', ['E430'])], catalogue: [],
    sample: '2',
  }),
  def({
    id: 'x-pr-dash', family: 'github', label: 'pr-dash view', kind: 'text',
    about: 'the detailed pr-dash.py snapshot — listed, unavailable',
    variants: [v('detailed', 'detailed', ['E431'])], catalogue: [],
    outcome: 'N', reason: 'генератор pr-dash.py status не прочитан; досъём',
    sample: '⊘',
  }),
  // ---- the branch's PR/issue card (pull-request-pane) ----
  def({
    id: 'x-branch-item', family: 'github', label: 'branch item', kind: 'list',
    about: 'the current branch PR and its closing-referenced issues: id, kind, state, title, body',
    variants: [v('card', 'card')], catalogue: ['E485', 'E486', 'E487', 'E488', 'E489'],
    options: [{ key: 'bodyMax', label: 'body cut to N chars', kind: 'int', min: 0, max: 400, default: 80 }],
    sample: '#12 PR OPEN · fix band',
  }),
  def({
    id: 'x-branch-checks', family: 'github', label: 'branch checks', kind: 'text',
    about: 'the statusCheckRollup of the branch PR: the word or one bucket count',
    variants: [
      v('word', 'word', ['E490']), v('passed', 'passed', ['E491']), v('failed', 'failed', ['E492']),
      v('pending', 'pending', ['E493']), v('skipped', 'skipped', ['E494']),
    ], catalogue: [],
    sample: 'passing',
  }),
  def({
    id: 'x-branch-review', family: 'github', label: 'branch review', kind: 'text',
    about: 'the reviewDecision of the branch PR',
    variants: [v('word', 'word', ['E495'])], catalogue: [],
    sample: 'approved',
  }),
  def({
    id: 'x-branch-mergeable', family: 'github', label: 'branch mergeable', kind: 'text',
    about: 'the mergeable field of the branch PR',
    variants: [v('word', 'word', ['E496'])], catalogue: [],
    sample: 'mergeable',
  }),
  def({
    id: 'x-branch-check-rows', family: 'github', label: 'branch check rows', kind: 'list',
    about: 'one row per check of the branch PR rollup',
    variants: [v('rows', 'rows', ['E497'])], catalogue: [],
    sample: '✓ build',
  }),
  // ---- headsign run ----
  def({
    id: 'x-hs-state', family: 'workflow', label: 'headsign state', kind: 'text',
    about: 'RUNNING/COMPLETE/ESCALATED/ABORTED of .headsign/state.json',
    variants: [v('state', 'state', ['E499'])], catalogue: [],
    sample: 'RUNNING',
  }),
  def({
    id: 'x-hs-phase', family: 'workflow', label: 'headsign phase', kind: 'text',
    about: 'the current phase of the headsign run',
    variants: [v('phase', 'phase', ['E500'])], catalogue: [],
    sample: 'review',
  }),
  def({
    id: 'x-hs-attempt', family: 'workflow', label: 'phase attempt', kind: 'text',
    about: 'attempt N, N/M or N/? of the current phase',
    variants: [v('attempt', 'attempt', ['E501'])], catalogue: [],
    sample: '2/3',
  }),
  def({
    id: 'x-hs-workflow', family: 'workflow', label: 'headsign workflow', kind: 'text',
    about: 'the workflow name of the headsign run',
    variants: [v('name', 'name', ['E502'])], catalogue: [],
    sample: 'workflow: default',
  }),
  def({
    id: 'x-hs-failure', family: 'workflow', label: 'phase failure', kind: 'list',
    about: 'the last failure of the current phase: check, command, exit, duration, tail',
    variants: [v('rows', 'rows', ['E503'])], catalogue: [],
    options: [{ key: 'tailMax', label: 'output tail cut to N chars', kind: 'int', min: 0, max: 1000, default: 200 }],
    sample: 'lint · exit 1',
  }),
  def({
    id: 'x-hs-driver', family: 'workflow', label: 'driver claim', kind: 'text',
    about: 'whether a delegated agent claims the run — the id itself never renders',
    variants: [v('claim', 'claim', ['E504'])], catalogue: [],
    sample: 'driver: delegated agent',
  }),
  def({
    id: 'x-hs-stop', family: 'workflow', label: 'last stop', kind: 'text',
    about: 'the recorded disposition of the last stop, with its timestamp',
    variants: [v('stop', 'stop', ['E505'])], catalogue: [],
    sample: 'last stop: paused by a note — at 2026-09-24T10:00:00+03:00',
  }),
  def({
    id: 'x-hs-note', family: 'workflow', label: 'pause note', kind: 'text',
    about: 'the note recorded with a paused stop',
    variants: [v('note', 'note', ['E506'])], catalogue: [],
    sample: 'note: waiting for the reviewer',
  }),
  def({
    id: 'x-hs-moved', family: 'workflow', label: 'last moved', kind: 'text',
    about: 'when the run was last acted on — the session id never renders',
    variants: [v('time', 'time', ['E507'])], catalogue: [],
    sample: 'last moved: 2026-09-24T10:00:00+03:00',
  }),
  def({
    id: 'x-hs-entered', family: 'workflow', label: 'phase entered', kind: 'text',
    about: 'when the run last entered the phase it stands on',
    variants: [v('time', 'time', ['E508'])], catalogue: [],
    sample: 'entered: 2026-09-24T09:40:00+03:00',
  }),
  def({
    id: 'x-hs-graph-accepted', family: 'workflow', label: 'graph accepted', kind: 'text',
    about: 'how many workflow-rule changes this run took on board',
    variants: [v('count', 'count', ['E509'])], catalogue: [],
    sample: 'graph: 2 accepted changes',
  }),
  def({
    id: 'x-hs-graph-reported', family: 'workflow', label: 'graph reported', kind: 'text',
    about: 'whether a workflow-rule change is reported and not yet accepted',
    variants: [v('flag', 'flag', ['E510'])], catalogue: [],
    sample: 'graph: changed since accepted',
  }),
  def({
    id: 'x-hs-graph-file', family: 'workflow', label: 'graph file', kind: 'text',
    about: 'the unreported disagreement between the workflow file and the record',
    variants: [v('state', 'state', ['E511'])], catalogue: [],
    sample: 'changed',
  }),
  def({
    id: 'x-hs-observer', family: 'workflow', label: 'observer flag', kind: 'text',
    about: 'whether HEADSIGN_OBSERVER is set in this environment',
    variants: [v('flag', 'flag', ['E512'])], catalogue: [],
    sample: 'observer: not set',
  }),
  def({
    id: 'x-hs-description', family: 'workflow', label: 'phase text', kind: 'text',
    about: 'the current phase instruction block, as headsign status prints it',
    variants: [v('block', 'block', ['E513'])], catalogue: [],
    sample: '--- phase: review ---',
  }),
  def({
    id: 'x-hs-neighbourhood', family: 'workflow', label: 'phase map', kind: 'text',
    about: 'the vertical from/pass/fail scheme of the current phase',
    variants: [v('map', 'map', ['E514'])], catalogue: [],
    sample: 'implement → review → close',
  }),
  def({
    id: 'x-hs-optimization', family: 'workflow', label: 'optimization', kind: 'text',
    about: 'assessed/unassessed of the run optimization assessment, with its path',
    variants: [v('state', 'state', ['E515'])], catalogue: [],
    sample: 'optimization: unassessed — .headsign/optimization/x/assessment.md',
  }),
  def({
    id: 'x-hs-end-reason', family: 'workflow', label: 'end reason', kind: 'text',
    about: 'why a terminal run ended; none while it runs',
    variants: [v('reason', 'reason', ['E516'])], catalogue: [],
    sample: 'reason: accepted',
  }),
  // ---- sdlc-workflow ----
  def({
    id: 'x-wf-keys', family: 'workflow', label: 'wf keys', kind: 'list',
    about: 'the /wf command keys with their one-line descriptions',
    variants: [v('keys', 'keys', ['E517'])], catalogue: [],
    sample: 'plan · Plan one or more workflow slices.',
  }),
  def({
    id: 'x-wf-index', family: 'workflow', label: 'wf index', kind: 'list',
    about: 'one workflow 00-index card: slug, status, stage, slice, next; or how many others exist',
    variants: [v('card', 'card', ['E518', 'E519', 'E520', 'E521', 'E522']), v('more', 'other workflows', ['E529'])], catalogue: [],
    options: [{ key: 'pick', label: 'which workflow by slug sort (1 = first)', kind: 'int', min: 1, max: 30, default: 1 }],
    sample: 'demo · active · implement · s1 · next: handoff',
  }),
  def({
    id: 'x-wf-slices', family: 'workflow', label: 'wf slices', kind: 'list',
    about: 'the roster rows of one workflow with their reached stage, or the N of M progress',
    variants: [v('rows', 'rows', ['E523', 'E524', 'E525', 'E526']), v('progress', 'progress', ['E527', 'E528'])], catalogue: [],
    options: [{ key: 'pick', label: 'which workflow by slug sort (1 = first)', kind: 'int', min: 1, max: 30, default: 1 }],
    sample: 's1 · complete · verified',
  }),
  def({
    id: 'x-wf-stage-cost', family: 'workflow', label: 'stage cost', kind: 'text',
    about: 'max(0, costNow−costAtStart) of the last non-read-only /wf turn',
    variants: [v('usd', 'usd', ['E530'])], catalogue: [],
    sample: '$0.25 this stage',
  }),
  def({
    id: 'x-wf-ledger', family: 'workflow', label: 'wf ledger', kind: 'text',
    about: 'the cost.jsonl token sum of one workflow, main and subagents alike',
    variants: [v('tokens', 'tokens', ['E531'])], catalogue: [],
    options: [{ key: 'pick', label: 'which workflow by slug sort (1 = first)', kind: 'int', min: 1, max: 30, default: 1 }],
    sample: '4.7k tokens',
  }),
  def({
    id: 'x-wf-mode', family: 'workflow', label: 'wf mode', kind: 'text',
    about: 'wf:<stage> of the active workflow, for the footer mode label',
    variants: [v('mode', 'mode', ['E532'])], catalogue: [],
    options: [{ key: 'pick', label: 'which workflow by slug sort (1 = first)', kind: 'int', min: 1, max: 30, default: 1 }],
    sample: 'wf:implement',
  }),
  def({
    id: 'x-wf-spinner', family: 'workflow', label: 'wf spinner', kind: 'text',
    about: 'the verb+target of the /wf command whose turn is running',
    variants: [v('word', 'word', ['E533'])], catalogue: [],
    sample: 'Planning demo',
  }),
]

// ---------------------------------------------------------------------------
// reduce plumbing

const GH_MS = 60_000
const GH_RUN_FIELDS = 'databaseId,status,conclusion,event,workflowName,headBranch,displayTitle,createdAt,startedAt,updatedAt,url'
const GH_PR_FIELDS = 'number,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefOid,headRefName,baseRefName,isCrossRepository,body,url,statusCheckRollup'

function firstLine(text: string): string {
  return text.split(/\r?\n/u, 1)[0] ?? ''
}
function cut(text: string, max: number): string {
  const one = text.split('\n')[0]!.trim()
  return max > 0 && one.length > max ? `${one.slice(0, max - 1)}…` : one
}

function fail<T>(cell: Cell<T> | undefined, error: string, at: number): Cell<T> {
  const lastGood = cell !== undefined && cell.ok ? { data: cell.data, at: cell.at } : cell !== undefined && !cell.ok ? cell.lastGood : undefined
  return { ok: false, error: firstLine(error) || 'source failed', at, lastGood }
}

function cmdPayload(input: Input): { code: number; stdout: string; stderr: string } | { error: string } {
  if (!input.ok) return { error: input.error ?? 'cmd failed' }
  const d = input.data as { code?: number; stdout?: string; stderr?: string } | undefined
  if (d === undefined || typeof d !== 'object') return { error: 'cmd gave no payload' }
  const code = d.code ?? 0
  const stdout = typeof d.stdout === 'string' ? d.stdout : ''
  const stderr = typeof d.stderr === 'string' ? d.stderr : ''
  if (code !== 0) return { error: firstLine(stderr || stdout) || `exit ${code}` }
  return { code, stdout, stderr }
}

function parseJsonOr<T>(text: string, what: string): { data: T } | { error: string } {
  try {
    return { data: JSON.parse(text) as T }
  } catch (err) {
    return { error: `${what}: unparseable (${err instanceof Error ? err.message : String(err)})` }
  }
}

function promotePrOf(prs: GhPrRow[]): GhPrRow | null {
  return prs.find(pr => pr.state === 'OPEN' && pr.baseRefName === 'main') ?? null
}
function prTransition(s: State, prs: GhPrRow[], at: number): void {
  if (s.pasted === null) return
  const pr = prs.find(p => p.number === s.pasted!.number)
  if (pr === undefined) return
  const checks = (pr.statusCheckRollup ?? []).map(toCheck)
  const merge = pr.mergeStateStatus ?? 'UNKNOWN'
  const buckets = new Map(checks.map(c => [c.name, c.bucket] as const))
  const prev = s.prevTracked
  if (prev !== null) {
    const out: string[] = []
    for (const c of checks) {
      const was = prev.buckets.get(c.name)
      if (was !== undefined && was !== c.bucket) out.push(`${c.name}: ${was} → ${c.bucket}`)
    }
    if (prev.merge !== merge && prev.merge !== 'UNKNOWN' && merge !== 'UNKNOWN') out.unshift(`merge: ${prev.merge.toLowerCase()} → ${merge.toLowerCase()}`)
    if (out.length > 0) s.prToast = { text: out.join('; '), at }
  }
  s.prevTracked = { merge, buckets }
}

function runTransition(s: State, runs: GhRun[], at: number): void {
  const now = new Map(runs.map(r => [r.databaseId, r.status] as const))
  const prev = s.prevRuns
  if (prev !== null) {
    for (const r of runs) {
      const was = prev.get(r.databaseId)
      if (was === undefined) { s.ciToast = { text: `${r.workflowName} started (#${r.databaseId})`, at }; continue }
      if (was !== 'completed' && r.status === 'completed') {
        const ms = Date.parse(r.updatedAt) - Date.parse(r.startedAt)
        s.ciToast = { text: `${r.workflowName} ${runPhase(r).label.toLowerCase()} (#${r.databaseId}) after ${Math.max(0, ms)}ms`, at }
      }
    }
  }
  s.prevRuns = now
}

function deployTransition(s: State, deps: Deployment[], at: number): void {
  const nowMap = new Map(deps.map(d => [d.url, d.state] as const))
  const prev = s.prevVercel
  if (prev !== null) {
    for (const d of deps) {
      const was = prev.get(d.url)
      if (was === undefined) { s.deployToast = { text: `${d.name}: deploy started (${deployTargetOf(d)})`, at }; continue }
      if (IN_FLIGHT.has(was) && !IN_FLIGHT.has(d.state)) {
        const ms = (d.ready ?? d.createdAt) - d.createdAt
        s.deployToast = { text: `${d.name}: ${V_LABEL[d.state]} after ${Math.max(0, ms)}ms`, at }
      }
    }
  }
  s.prevVercel = nowMap
}

function parseWfRead(text: string): WfEntry[] {
  const bySlug = new Map<string, { index?: string; roster?: string; ledger?: string }>()
  for (const file of splitByHeader(text)) {
    const slug = file.path.split('/').at(-2) ?? ''
    if (slug === '') continue
    const slot = bySlug.get(slug) ?? {}
    if (file.path.endsWith('00-index.md')) slot.index = file.body
    if (file.path.endsWith('03-slice.md')) slot.roster = file.body
    if (file.path.endsWith('cost.jsonl')) slot.ledger = file.body
    bySlug.set(slug, slot)
  }
  const out: WfEntry[] = []
  for (const [slug, slot] of bySlug) {
    if (slot.index === undefined) continue
    const fields = frontmatterOf(slot.index)
    const status = (fields.status ?? '').trim()
    if (status === '') continue
    out.push({
      slug,
      status,
      terminal: TERMINAL_WORKFLOW_STATUSES.has(status),
      currentStage: fields['current-stage']?.trim() || null,
      selectedSlice: fields['selected-slice']?.trim() || null,
      nextInvocation: fields['next-invocation']?.trim() || null,
      roster: slot.roster === undefined ? [] : rosterOf(slot.roster).map(entry => ({ ...entry, stage: 'defined' as const })),
      ledgerTokens: slot.ledger === undefined ? null : ledgerTokensOf(slot.ledger),
    })
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug))
}

function parseWfNames(stdout: string): Array<{ slug: string; files: Set<string> }> {
  const bySlug = new Map<string, Set<string>>()
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const parts = trimmed.split('/')
    const file = parts.at(-1) ?? ''
    const slug = parts.at(-2) ?? ''
    if (slug === '' || file === '') continue
    const set = bySlug.get(slug) ?? new Set<string>()
    set.add(file)
    bySlug.set(slug, set)
  }
  return Array.from(bySlug, ([slug, files]) => ({ slug, files })).sort((a, b) => a.slug.localeCompare(b.slug))
}

// ---------------------------------------------------------------------------
// the collector

const collector: Collector<State> = {
  family: 'github',
  elements: ELEMENTS,
  variantsFor: [{ element: 'github', variants: [v('x-gh-slug', 'gh repo view', ['E312'])] }],
  sources: [
    { source: { kind: 'event', event: 'turn.start' }, elements: ['x-pr-id', 'x-wf-stage-cost', 'x-wf-spinner'] },
    { source: { kind: 'event', event: 'turn.complete' }, elements: ['x-wf-stage-cost', 'x-wf-spinner'] },
    { source: { kind: 'event', event: 'tool.call' }, elements: ['x-ci-wait', 'x-deploy-wait'] },
    { source: { kind: 'session', call: 'usage' }, elements: ['x-wf-stage-cost'] },
    { source: { kind: 'clock', everyMs: 1000 }, elements: ['x-vercel-age', 'x-ci-duration', 'x-deploy-time', 'x-ci-wait', 'x-deploy-wait'] },
    { source: { kind: 'cmd', argv: ['gh', 'repo', 'view', '--json', 'nameWithOwner'], everyMs: GH_MS, cwd: 'project' }, elements: ['github'] },
    { source: { kind: 'cmd', argv: ['gh', 'run', 'list', '--limit', '15', '--json', GH_RUN_FIELDS], everyMs: GH_MS, cwd: 'project' }, elements: ['x-ci-runs', 'x-ci-phase', 'x-ci-counts', 'x-ci-workflow', 'x-ci-title', 'x-ci-duration', 'x-ci-wait', 'x-ci-toast', 'x-branch-pr'] },
    { source: { kind: 'cmd', argv: ['gh', 'pr', 'list', '--state', 'all', '--limit', '100', '--json', GH_PR_FIELDS], everyMs: GH_MS, cwd: 'project' }, elements: ['x-pr-id', 'x-pr-state', 'x-pr-merge', 'x-pr-review', 'x-pr-title', 'x-pr-toast', 'x-pr-refresh', 'x-pr-optional', 'x-pr-checks-rows', 'x-pr-lights', 'x-pr-counts', 'x-promote-sha', 'x-branch-pr'] },
    { source: { kind: 'cmd', argv: ['gh', 'pr', 'status', '--json', GH_PR_FIELDS], everyMs: GH_MS, cwd: 'project' }, elements: ['x-my-prs', 'x-my-pr-count', 'x-branch-item', 'x-branch-checks', 'x-branch-review', 'x-branch-mergeable', 'x-branch-check-rows'] },
    { source: { kind: 'cmd', argv: ['gh', 'issue', 'list', '--state', 'all', '--limit', '50', '--json', 'number,title,state,body,url'], everyMs: GH_MS, cwd: 'project' }, elements: ['x-branch-item'] },
    { source: { kind: 'cmd', argv: ['gh', 'api', 'repos/{owner}/{repo}/branches/main/protection'], everyMs: GH_MS, cwd: 'project' }, elements: ['x-pr-lights', 'x-pr-counts', 'x-pr-optional'] },
    { source: { kind: 'cmd', argv: ['gh', 'api', 'repos/{owner}/{repo}/rules/branches/main'], everyMs: GH_MS, cwd: 'project' }, elements: ['x-pr-lights', 'x-pr-counts', 'x-pr-optional'] },
    { source: { kind: 'cmd', argv: ['vercel', 'ls', '--format', 'json', '--non-interactive'], everyMs: GH_MS, cwd: 'project' }, elements: ['x-vercel', 'x-vercel-url', 'x-vercel-age', 'x-vercel-counts', 'x-deploy-queue', 'x-deploy-ref', 'x-deploy-subject', 'x-deploy-time', 'x-deploy-target', 'x-deploy-wait', 'x-deploy-toast'] },
    { source: { kind: 'cmd', argv: ['wt', 'list', '--format', 'json', '--config-set', 'list.json-schema=1'], everyMs: 10_000, cwd: 'project' }, elements: ['x-wt-list', 'x-wt-current', 'x-wt-count'] },
    { source: { kind: 'cmd', argv: ['headsign', 'status'], everyMs: 10_000, cwd: 'project' }, elements: ['x-hs-attempt', 'x-hs-graph-file', 'x-hs-description', 'x-hs-neighbourhood', 'x-hs-optimization'] },
    { source: { kind: 'file', path: '.headsign/state.json', everyMs: 5000, relativeTo: 'project' }, elements: ['x-hs-state', 'x-hs-phase', 'x-hs-workflow', 'x-hs-failure', 'x-hs-driver', 'x-hs-stop', 'x-hs-note', 'x-hs-moved', 'x-hs-entered', 'x-hs-graph-accepted', 'x-hs-graph-reported', 'x-hs-end-reason', 'x-hs-attempt'] },
    { source: { kind: 'env', names: ['HEADSIGN_OBSERVER'] }, elements: ['x-hs-observer'] },
    { source: { kind: 'file', path: 'prd.json', everyMs: 10_000, relativeTo: 'project' }, elements: ['x-prd', 'x-prd-missing'] },
    { source: { kind: 'file', path: '.vercel/project.json', everyMs: GH_MS, relativeTo: 'project' }, elements: ['x-vercel-project'] },
    { source: { kind: 'cmd', argv: ['find', '.ai/workflows', '-maxdepth', '2', '-type', 'f'], everyMs: GH_MS, cwd: 'project' }, elements: ['x-wf-index', 'x-wf-slices', 'x-wf-mode'] },
    { source: { kind: 'cmd', argv: ['find', '.ai/workflows', '-maxdepth', '2', '-type', 'f', '(', '-name', '00-index.md', '-o', '-name', '03-slice.md', '-o', '-name', 'cost.jsonl', ')', '-exec', 'awk', 'FNR==1 {print "==> " FILENAME} {print}', '{}', '+'], everyMs: GH_MS, cwd: 'project' }, elements: ['x-wf-index', 'x-wf-slices', 'x-wf-mode', 'x-wf-ledger'] },
  ],

  init(): State {
    return {
      lastNow: 0,
      repoSlug: undefined,
      runs: undefined,
      prs: undefined,
      prStatus: undefined,
      issues: undefined,
      protect: undefined,
      rules: undefined,
      vercel: undefined,
      vercelProject: undefined,
      wt: undefined,
      hsFile: undefined,
      hsCli: undefined,
      prd: undefined,
      wfNames: undefined,
      wfRead: undefined,
      observer: undefined,
      sessionCost: null,
      pasted: null,
      wfBracket: null,
      lastWf: null,
      lastStageUsd: null,
      ciWake: null,
      deployWake: null,
      prToast: null,
      ciToast: null,
      deployToast: null,
      prevTracked: null,
      prevRuns: null,
      prevVercel: null,
    }
  },

  reduce(state: State, input: Input): State {
    const s: State = { ...state, prevTracked: state.prevTracked, prevRuns: state.prevRuns, prevVercel: state.prevVercel }
    const at = input.now
    s.lastNow = at
    const src = input.source

    if (src.kind === 'clock') return s

    if (src.kind === 'event' && src.event === 'turn.start') {
      const text = typeof (input.data as { text?: string } | undefined)?.text === 'string'
        ? (input.data as { text: string }).text
        : ''
      if (input.ok) {
        const url = PR_URL.exec(text)
        if (url !== null) s.pasted = { owner: url[1]!, repo: url[2]!, number: Number(url[3]), at }
        const command = wfCommandOf(text)
        if (command !== null) {
          s.wfBracket = { turnId: '', command, costAtStart: s.sessionCost?.usd ?? null, at }
        }
      }
      return s
    }
    if (src.kind === 'event' && src.event === 'turn.complete') {
      if (s.wfBracket !== null) {
        const bracket = s.wfBracket
        s.lastWf = { command: bracket.command, at }
        if (!WF_READ_ONLY_KEYS.has(bracket.command.key)) {
          const costNow = s.sessionCost?.usd ?? null
          if (costNow !== null && bracket.costAtStart !== null) s.lastStageUsd = Math.max(0, costNow - bracket.costAtStart)
        }
        s.wfBracket = null
      }
      return s
    }
    if (src.kind === 'event' && src.event === 'tool.call') {
      if (input.ok) {
        const e = input.data as { tool?: string; command?: unknown } | undefined
        if (e?.tool === 'Bash' && typeof e.command === 'string') {
          if (triggersWorkflow(e.command)) s.ciWake = { at }
          if (isDeployCommand(e.command)) s.deployWake = { at }
        }
      }
      return s
    }
    if (src.kind === 'session' && src.call === 'usage') {
      if (input.ok) {
        const cost = (input.data as { cost?: { usd?: number } } | undefined)?.cost
        if (cost !== undefined && typeof cost.usd === 'number') s.sessionCost = { usd: cost.usd, at }
      }
      return s
    }
    if (src.kind === 'env') {
      const data = (input.ok ? input.data : undefined) as Record<string, string | undefined> | undefined
      s.observer = { ok: true, data: Boolean(data?.HEADSIGN_OBSERVER), at }
      return s
    }
    if (src.kind === 'file') {
      const text = input.ok && typeof input.data === 'string' ? input.data : null
      if (src.path === '.headsign/state.json') {
        if (text === null) { s.hsFile = fail(state.hsFile, input.error ?? 'read failed', at); return s }
        const parsed = parseJsonOr<HsState>(text, 'state.json')
        if ('data' in parsed) s.hsFile = { ok: true, data: parsed.data, at }; else s.hsFile = fail(state.hsFile, parsed.error, at)
        return s
      }
      if (src.path === 'prd.json') {
        if (text === null) { s.prd = fail(state.prd, input.error ?? 'read failed', at); return s }
        const parsed = parseJsonOr<unknown>(text, 'prd.json')
        if ('data' in parsed) s.prd = { ok: true, data: parsed.data, at }; else s.prd = fail(state.prd, parsed.error, at)
        return s
      }
      if (src.path === '.vercel/project.json') {
        if (text === null) { s.vercelProject = fail(state.vercelProject, input.error ?? 'read failed', at); return s }
        const parsed = parseJsonOr<{ projectName?: string }>(text, 'project.json')
        if ('data' in parsed) s.vercelProject = { ok: true, data: parsed.data.projectName || 'vercel', at }; else s.vercelProject = fail(state.vercelProject, parsed.error, at)
        return s
      }
      return s
    }
    if (src.kind === 'cmd') {
      const payload = cmdPayload(input)
      const a = src.argv
      if (a[0] === 'gh' && a[1] === 'repo' && a[2] === 'view') {
        if ('error' in payload) { s.repoSlug = fail(state.repoSlug, payload.error, at); return s }
        const parsed = parseJsonOr<{ nameWithOwner?: string }>(payload.stdout, 'gh repo view')
        if ('data' in parsed) {
          const name = (parsed.data.nameWithOwner ?? '').trim()
          if (name === '') s.repoSlug = fail(state.repoSlug, 'no GitHub remote', at)
          else s.repoSlug = { ok: true, data: name, at }
        } else s.repoSlug = fail(state.repoSlug, parsed.error, at)
        return s
      }
      if (a[0] === 'gh' && a[1] === 'run' && a[2] === 'list') {
        if ('error' in payload) { s.runs = fail(state.runs, payload.error, at); return s }
        const parsed = parseJsonOr<GhRun[]>(payload.stdout, 'gh run list')
        if ('data' in parsed) {
          s.runs = { ok: true, data: parsed.data, at }
          runTransition(s, parsed.data, at)
        } else s.runs = fail(state.runs, parsed.error, at)
        return s
      }
      if (a[0] === 'gh' && a[1] === 'pr' && a[2] === 'list') {
        if ('error' in payload) { s.prs = fail(state.prs, payload.error, at); return s }
        const parsed = parseJsonOr<GhPrRow[]>(payload.stdout, 'gh pr list')
        if ('data' in parsed) {
          s.prs = { ok: true, data: parsed.data, at }
          prTransition(s, parsed.data, at)
        } else s.prs = fail(state.prs, parsed.error, at)
        return s
      }
      if (a[0] === 'gh' && a[1] === 'pr' && a[2] === 'status') {
        if ('error' in payload) { s.prStatus = fail(state.prStatus, payload.error, at); return s }
        const parsed = parseJsonOr<{ currentBranch?: GhPrRow[]; createdBy?: GhPrRow[] }>(payload.stdout, 'gh pr status')
        if ('data' in parsed) s.prStatus = { ok: true, data: { currentBranch: parsed.data.currentBranch ?? [], createdBy: parsed.data.createdBy ?? [] }, at }
        else s.prStatus = fail(state.prStatus, parsed.error, at)
        return s
      }
      if (a[0] === 'gh' && a[1] === 'issue' && a[2] === 'list') {
        if ('error' in payload) { s.issues = fail(state.issues, payload.error, at); return s }
        const parsed = parseJsonOr<Array<{ number: number; title: string; state: string; body?: string; url?: string }>>(payload.stdout, 'gh issue list')
        if ('data' in parsed) s.issues = { ok: true, data: parsed.data, at }; else s.issues = fail(state.issues, parsed.error, at)
        return s
      }
      if (a[0] === 'gh' && a[1] === 'api') {
        const route = a[2] ?? ''
        if (route.endsWith('/branches/main/protection')) {
          if ('error' in payload) { s.protect = fail(state.protect, payload.error, at); return s }
          s.protect = { ok: true, data: parseProtection(payload.stdout), at }
          return s
        }
        if (route.endsWith('/rules/branches/main')) {
          if ('error' in payload) { s.rules = fail(state.rules, payload.error, at); return s }
          s.rules = { ok: true, data: parseRulesets(payload.stdout), at }
          return s
        }
        return s
      }
      if (a[0] === 'vercel') {
        if ('error' in payload) { s.vercel = fail(state.vercel, payload.error, at); return s }
        try {
          const deps = parseVercelList(payload.stdout)
          s.vercel = { ok: true, data: deps, at }
          deployTransition(s, deps, at)
        } catch (err) {
          s.vercel = fail(state.vercel, err instanceof Error ? err.message : String(err), at)
        }
        return s
      }
      if (a[0] === 'wt') {
        if ('error' in payload) { s.wt = fail(state.wt, payload.error, at); return s }
        const parsed = parseJsonOr<Array<{ branch: string; path: string; is_current: boolean }>>(payload.stdout, 'wt list')
        if ('data' in parsed) s.wt = { ok: true, data: parsed.data, at }; else s.wt = fail(state.wt, parsed.error, at)
        return s
      }
      if (a[0] === 'headsign') {
        if ('error' in payload) { s.hsCli = fail(state.hsCli, payload.error, at); return s }
        s.hsCli = { ok: true, data: payload.stdout, at }
        return s
      }
      if (a[0] === 'find') {
        const readsIndex = a.includes('00-index.md')
        if ('error' in payload) {
          if (readsIndex) s.wfRead = fail(state.wfRead, payload.error, at)
          else s.wfNames = fail(state.wfNames, payload.error, at)
          return s
        }
        if (readsIndex) s.wfRead = { ok: true, data: parseWfRead(payload.stdout), at }
        else s.wfNames = { ok: true, data: parseWfNames(payload.stdout), at }
        return s
      }
      return s
    }
    return s
  },

  value(s: State, elementId: string, args: FormatArgs): Value {
    return valueOf(s, elementId, args)
  },
}

// ---------------------------------------------------------------------------
// value

const ok = (text: string, at: number, extra?: Partial<Ok>): Ok => ({ state: 'ok', text, at, ...(extra ?? {}) })

function pickInt(args: FormatArgs, key: string, fallback: number): number {
  const raw = args.options[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw)
  return fallback
}
function hhmm(at: number): string {
  return new Date(at).toISOString().slice(11, 16)
}

/** One workflow by the pick option; the roster stages join the names listing here. */
function wfEntryOf(s: State, args: FormatArgs): Ans<WfEntry | null> {
  const read = ans(s.wfRead)
  if (read.t === 'pending') return read
  if (read.t === 'nosource') return read
  const pick = Math.max(1, pickInt(args, 'pick', 1))
  const entry = read.data[pick - 1] ?? null
  if (entry === null) return { t: 'nosource', reason: 'no workflow with a status under .ai/workflows' }
  const names = ans(s.wfNames)
  let joined = entry
  if (names.t === 'ok') {
    const files = names.data.find(n => n.slug === entry.slug)?.files
    if (files !== undefined) {
      joined = { ...entry, roster: entry.roster.map(sl => ({ ...sl, stage: stageOf(sl.slug, files) })) }
    }
  }
  if (read.t === 'stale') return { t: 'stale', data: joined, at: read.at, reason: read.reason }
  return { t: 'ok', data: joined, at: read.at }
}

function trackedNeeded(s: State): Value | { pr: GhPrRow; at: number } | { stale: { pr: GhPrRow; at: number }; reason: string } {
  if (s.pasted === null) return { state: 'nosource', reason: 'no PR URL seen in the prompt yet' }
  const a = ans(s.prs)
  if (a.t === 'pending') return { state: 'pending' }
  if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
  const pr = a.data.find(p => p.number === s.pasted!.number)
  if (pr === undefined) return { state: 'nosource', reason: `PR #${s.pasted.number} is not in this repository's list` }
  if (a.t === 'ok') return { pr, at: a.at }
  return { stale: { pr, at: a.at }, reason: a.reason }
}

/** null = both protection sources have not answered yet (pending); a Value = a named failure. */
function requiredContexts(s: State): string[] | Value | null {
  const p = ans(s.protect)
  const r = ans(s.rules)
  if (p.t === 'pending' || r.t === 'pending') return null
  if (p.t === 'nosource' || r.t === 'nosource') {
    const reasons = [p.t === 'nosource' ? p.reason : '', r.t === 'nosource' ? r.reason : ''].filter(x => x !== '')
    return { state: 'nosource', reason: `branch protection unreadable: ${reasons.join('; ')}` }
  }
  return Array.from(new Set([...p.data, ...r.data])).sort()
}

function valueOf(s: State, elementId: string, args: FormatArgs): Value {
  const now = s.lastNow
  const nf = args.nf

  if (elementId === 'github' && args.variant === 'x-gh-slug') {
    const a = ans(s.repoSlug)
    if (a.t === 'pending') return { state: 'pending' }
    if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
    const text = a.data
    if (a.t === 'ok') return ok(text, a.at)
    return { state: 'stale', last: ok(text, a.at), reason: a.reason }
  }

  switch (elementId) {
    case 'x-pr-id': {
      if (s.pasted === null) return { state: 'nosource', reason: 'no PR URL seen in the prompt yet' }
      return ok(`${s.pasted.owner}/${s.pasted.repo}#${s.pasted.number}`, s.pasted.at)
    }
    case 'x-pr-state': {
      const t = trackedNeeded(s)
      if ('state' in t) return t
      const word = (pr: GhPrRow): string => {
        const state = (pr.state ?? '').toLowerCase()
        if (state === 'open' && pr.isDraft) return 'open draft'
        return state || 'unknown'
      }
      if ('pr' in t) return ok(word(t.pr), t.at)
      return { state: 'stale', last: ok(word(t.stale.pr), t.stale.at), reason: t.reason }
    }
    case 'x-pr-merge': {
      if (args.variant === 'quiet') {
        const a = ans(s.prs)
        if (a.t === 'pending') return { state: 'pending' }
        if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
        const pr = promotePrOf(a.data)
        if (pr === null) return { state: 'nosource', reason: 'no open PR based on main' }
        const word = pr.mergeStateStatus ?? 'UNKNOWN'
        const text = word === 'CLEAN' ? 'clean' : word
        if (a.t === 'ok') return ok(text, a.at)
        return { state: 'stale', last: ok(text, a.at), reason: a.reason }
      }
      const t = trackedNeeded(s)
      if ('state' in t) return t
      const word = (pr: GhPrRow): string => pr.mergeStateStatus ?? 'UNKNOWN'
      if ('pr' in t) return ok(word(t.pr), t.at)
      return { state: 'stale', last: ok(word(t.stale.pr), t.stale.at), reason: t.reason }
    }
    case 'x-pr-review': {
      // E284 is the reviewDecision word alone; the draft form belongs to E429's row
      const t = trackedNeeded(s)
      if ('state' in t) return t
      const word = (pr: GhPrRow): string => REVIEW_PHRASE[pr.reviewDecision ?? ''] ?? 'no review'
      if ('pr' in t) return ok(word(t.pr), t.at)
      return { state: 'stale', last: ok(word(t.stale.pr), t.stale.at), reason: t.reason }
    }
    case 'x-pr-title': {
      const t = trackedNeeded(s)
      if ('state' in t) return t
      if ('pr' in t) return ok(t.pr.title, t.at)
      return { state: 'stale', last: ok(t.stale.pr.title, t.stale.at), reason: t.reason }
    }
    case 'x-pr-toast': {
      if (s.prToast === null) return { state: 'nosource', reason: 'no tracked-PR change between polls yet' }
      return ok(`${s.prToast.text} · ${nf.duration(Math.max(0, now - s.prToast.at))} ago`, s.prToast.at)
    }
    case 'x-pr-refresh': {
      if (args.variant === 'error') {
        const a = ans(s.prs)
        if (a.t === 'pending') return { state: 'pending' }
        if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
        if (a.t === 'stale') return ok(`refresh failed: ${a.reason}`, s.lastNow)
        return ok('no error', a.at)
      }
      const a = ans(s.prs)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      return ok(`updated ${hhmm(a.at)}`, a.at)
    }
    case 'x-pr-optional': {
      const t = trackedNeeded(s)
      if ('state' in t) return t
      const required = requiredContexts(s)
      if (required !== null && !Array.isArray(required)) return required
      if (required === null) return { state: 'pending' }
      const count = (pr: GhPrRow): number => {
        const others = (pr.statusCheckRollup ?? []).map(toCheck).filter(c => !required.includes(c.name))
        return args.variant === 'total' ? others.length : others.filter(c => c.bucket === 'fail').length
      }
      const pr = 'pr' in t ? t.pr : t.stale.pr
      const at = 'pr' in t ? t.at : t.stale.at
      const n = count(pr)
      const text = args.variant === 'total' ? nf.count(n) : `+${nf.count(n)} optional failed`
      if ('pr' in t) return ok(text, at, { num: n, unit: 'count' })
      return { state: 'stale', last: ok(text, at, { num: n, unit: 'count' }), reason: t.reason }
    }
    case 'x-pr-checks-rows': {
      const t = trackedNeeded(s)
      if ('state' in t) return t
      const pr = 'pr' in t ? t.pr : t.stale.pr
      const at = 'pr' in t ? t.at : t.stale.at
      const checks = (pr.statusCheckRollup ?? []).map(toCheck)
      const rows = checks.map(c => row(BUCKET_ICON[c.bucket], c.name === '' ? '(unnamed)' : c.name, c.bucket, c.link === '' ? undefined : c.link))
      const value = ok(`${checks.length} checks`, at, { rows })
      if ('pr' in t) return value
      return { state: 'stale', last: value, reason: t.reason }
    }
    case 'x-branch-pr': {
      const a = ans(s.runs)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const run = a.data[Math.max(0, pickInt(args, 'run', 1) - 1)]
      if (run === undefined) return { state: 'nosource', reason: 'no such run in the list' }
      const p = ans(s.prs)
      const prOf = (): string => {
        if (p.t === 'ok') {
          const byBranch = new Map(p.data.toReversed().filter(pr => pr.isCrossRepository !== true).map(pr => [pr.headRefName ?? '', pr.number] as const))
          const n = byBranch.get(run.headBranch)
          if (n !== undefined) return `#${n}`
        }
        const m = /^refs\/pull\/(\d+)\//.exec(run.headBranch)
        return m === null ? 'no PR for this branch' : `#${m[1]}`
      }
      const text = prOf()
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-pr-lights': {
      const a = ans(s.prs)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const pr = promotePrOf(a.data)
      if (pr === null) return { state: 'nosource', reason: 'no open PR based on main' }
      const required = requiredContexts(s)
      if (required !== null && !Array.isArray(required)) return required
      if (required === null) return { state: 'pending' }
      const checks = (pr.statusCheckRollup ?? []).map(toCheck)
      const lights = matchAndClassify(required, checks)
      const rows = lights.map(l => row(LIGHT_ICON[l.color], l.name, l.color, l.color === 'red' ? 'not run or failed' : undefined))
      const value = ok(`${lights.length} required`, a.at, { rows })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-pr-counts': {
      if (args.variant === 'pin') {
        const a = ans(s.prs)
        if (a.t === 'pending') return { state: 'pending' }
        if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
        const pr = promotePrOf(a.data)
        if (pr === null) return { state: 'nosource', reason: 'no open PR based on main' }
        const required = requiredContexts(s)
        if (required !== null && !Array.isArray(required)) return required
        if (required === null) return { state: 'pending' }
        const checks = (pr.statusCheckRollup ?? []).map(toCheck)
        const lights = matchAndClassify(required, checks)
        const counts = {
          green: lights.filter(l => l.color === 'green').length,
          yellow: lights.filter(l => l.color === 'yellow').length,
          red: lights.filter(l => l.color === 'red').length,
          cancelled: lights.filter(l => l.color === 'cancelled').length,
        }
        const parts = [`promote #${pr.number}`]
        if (counts.green > 0) parts.push(`${nf.count(counts.green)} green`)
        if (counts.yellow > 0) parts.push(`${nf.count(counts.yellow)} yellow`)
        if (counts.red > 0) parts.push(`${nf.count(counts.red)} red`)
        if (counts.cancelled > 0) parts.push(`${nf.count(counts.cancelled)} cancelled`)
        const merge = pr.mergeStateStatus ?? ''
        if (merge !== '' && merge !== 'CLEAN') parts.push(merge)
        const text = parts.join(', ')
        if (a.t === 'ok') return ok(text, a.at)
        return { state: 'stale', last: ok(text, a.at), reason: a.reason }
      }
      const t = trackedNeeded(s)
      if ('state' in t) return t
      const required = requiredContexts(s)
      if (required !== null && !Array.isArray(required)) return required
      if (required === null) return { state: 'pending' }
      const bucketOf: string = args.variant
      const count = (pr: GhPrRow): number =>
        (pr.statusCheckRollup ?? []).map(toCheck)
          .filter(c => required.includes(c.name) && c.bucket === bucketOf)
          .length
      const pr = 'pr' in t ? t.pr : t.stale.pr
      const at = 'pr' in t ? t.at : t.stale.at
      const n = count(pr)
      const value = ok(nf.count(n), at, { num: n, unit: 'count' })
      if ('pr' in t) return value
      return { state: 'stale', last: value, reason: t.reason }
    }
    case 'x-promote-sha': {
      const a = ans(s.prs)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const pr = promotePrOf(a.data)
      if (pr === null) return { state: 'nosource', reason: 'no open PR based on main' }
      const sha = (pr.headRefOid ?? '').slice(0, 7)
      const text = sha === '' ? 'no head sha' : sha
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-ci-runs': {
      const a = ans(s.runs)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const events = typeof args.options.events === 'string' ? args.options.events : 'human'
      const list = a.data.filter(r => events === 'all' || PERSON_EVENTS.has(r.event))
      const maxRows = pickInt(args, 'maxRows', 5)
      if (args.variant === 'more') {
        const n = Math.max(0, list.length - maxRows)
        const value = ok(`${nf.count(n)} more`, a.at, { num: n, unit: 'count' })
        return a.t === 'ok' ? value : { state: 'stale', last: value, reason: a.reason }
      }
      const shown = list.slice(0, maxRows)
      const rows = shown.map(r => {
        const phase = runPhase(r)
        return row(phase.kind, `${r.workflowName} #${r.databaseId}`, `${phase.dot} ${phase.label}`, cut(r.displayTitle, 60))
      })
      const value = ok(`${nf.count(shown.length)} runs`, a.at, { rows })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-ci-phase': {
      const a = ans(s.runs)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const run = a.data[Math.max(0, pickInt(args, 'run', 1) - 1)]
      if (run === undefined) return { state: 'nosource', reason: 'no such run in the list' }
      const phase = runPhase(run)
      const text = `${phase.dot} ${phase.label}`
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-ci-counts': {
      const a = ans(s.runs)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const list = a.data.filter(r => PERSON_EVENTS.has(r.event))
      const n = args.variant === 'running' ? list.filter(inFlightRun).length : list.filter(r => !inFlightRun(r)).length
      const value = ok(nf.count(n), a.at, { num: n, unit: 'count' })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-ci-workflow': {
      const a = ans(s.runs)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const run = a.data[Math.max(0, pickInt(args, 'run', 1) - 1)]
      if (run === undefined) return { state: 'nosource', reason: 'no such run in the list' }
      const max = pickInt(args, 'max', 20)
      const text = cut(run.workflowName || 'workflow', max)
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-ci-title': {
      const a = ans(s.runs)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const run = a.data[Math.max(0, pickInt(args, 'run', 1) - 1)]
      if (run === undefined) return { state: 'nosource', reason: 'no such run in the list' }
      const m = /^refs\/pull\/(\d+)\//.exec(run.headBranch)
      const pr = m === null ? null : m[1]
      let title = run.displayTitle
      if (pr !== null) title = title.replace(new RegExp(`\\s*\\(#${pr}\\)`), '').replace(new RegExp(`#${pr}`), '').trim()
      if (a.t === 'ok') return ok(title, a.at)
      return { state: 'stale', last: ok(title, a.at), reason: a.reason }
    }
    case 'x-ci-duration': {
      const a = ans(s.runs)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const run = a.data[Math.max(0, pickInt(args, 'run', 1) - 1)]
      if (run === undefined) return { state: 'nosource', reason: 'no such run in the list' }
      const ms = inFlightRun(run) ? Math.max(0, now - Date.parse(run.startedAt)) : Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.startedAt))
      const value = ok(nf.duration(ms), a.at, { num: ms, unit: 'ms' })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-ci-wait': {
      if (s.ciWake === null) return { state: 'nosource', reason: 'no workflow-triggering command seen yet' }
      const arrived = s.runs !== undefined && s.runs.ok ? s.runs.data.find(r => Date.parse(r.createdAt) > s.ciWake!.at) : undefined
      if (arrived !== undefined) return ok(`run arrived (#${arrived.databaseId})`, s.ciWake.at)
      return ok(`waiting for a run · ${nf.duration(Math.max(0, now - s.ciWake.at))}`, s.ciWake.at)
    }
    case 'x-ci-toast': {
      if (s.ciToast === null) return { state: 'nosource', reason: 'no run transition between polls yet' }
      return ok(s.ciToast.text, s.ciToast.at)
    }
    case 'x-vercel': {
      const a = ans(s.vercel)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const pick = args.variant === 'prod' ? (d: Deployment) => d.target === 'production' : args.variant === 'preview' ? (d: Deployment) => d.target !== 'production' : () => true
      const d = a.data.find(pick)
      if (d === undefined) return { state: 'nosource', reason: args.variant === 'state' ? 'no deployments' : `no ${args.variant} deployment` }
      const text = `${V_DOT[d.state]} ${V_LABEL[d.state]}`
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-vercel-url': {
      const a = ans(s.vercel)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const d = a.data[0]
      if (d === undefined) return { state: 'nosource', reason: 'no deployments' }
      const max = pickInt(args, 'max', 0)
      const text = max > 0 && d.url.length > max ? `${d.url.slice(0, max - 1)}…` : d.url
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-vercel-age': {
      const a = ans(s.vercel)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const d = a.data[0]
      if (d === undefined) return { state: 'nosource', reason: 'no deployments' }
      const anchor = IN_FLIGHT.has(d.state) ? d.createdAt : d.ready ?? d.createdAt
      const ms = Math.max(0, now - anchor)
      const value = ok(`${nf.duration(ms)} ago`, a.at, { num: ms, unit: 'ms' })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-vercel-counts': {
      const a = ans(s.vercel)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const recent = a.data.slice(0, Math.max(1, pickInt(args, 'recent', 5)))
      const n =
        args.variant === 'errors' ? recent.filter(d => d.state === 'ERROR').length :
        args.variant === 'building' ? recent.filter(d => d.state === 'BUILDING' || d.state === 'INITIALIZING').length :
        args.variant === 'queued' ? recent.filter(d => d.state === 'QUEUED').length :
        recent.filter(d => !IN_FLIGHT.has(d.state)).length
      const value = ok(nf.count(n), a.at, { num: n, unit: 'count' })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-vercel-project': {
      const a = ans(s.vercelProject)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .vercel/project.json: ${a.reason}` }
      if (a.t === 'ok') return ok(a.data, a.at)
      return { state: 'stale', last: ok(a.data, a.at), reason: a.reason }
    }
    case 'x-deploy-queue': {
      const a = ans(s.vercel)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const maxRows = pickInt(args, 'maxRows', 5)
      if (args.variant === 'more') {
        const n = Math.max(0, a.data.length - maxRows)
        const value = ok(`${nf.count(n)} more`, a.at, { num: n, unit: 'count' })
        return a.t === 'ok' ? value : { state: 'stale', last: value, reason: a.reason }
      }
      const rows = a.data.slice(0, maxRows).map(d =>
        row(IN_FLIGHT.has(d.state) ? 'run' : d.state === 'READY' ? 'ok' : 'fail', d.url, `${V_DOT[d.state]} ${V_LABEL[d.state]}`, `${deployTargetOf(d)}${d.meta?.githubCommitRef !== undefined ? ` · ${d.meta.githubCommitRef}` : ''}`))
      const value = ok(`${nf.count(a.data.length)} deploys`, a.at, { rows })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-deploy-ref': {
      const a = ans(s.vercel)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const d = a.data[0]
      if (d === undefined) return { state: 'nosource', reason: 'no deployments' }
      const ref = d.meta?.githubCommitRef
      if (ref === undefined) return { state: 'nosource', reason: 'the newest deployment carries no commit ref' }
      if (a.t === 'ok') return ok(ref, a.at)
      return { state: 'stale', last: ok(ref, a.at), reason: a.reason }
    }
    case 'x-deploy-subject': {
      const a = ans(s.vercel)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const d = a.data[0]
      if (d === undefined) return { state: 'nosource', reason: 'no deployments' }
      const message = d.meta?.githubCommitMessage
      if (message === undefined) return { state: 'nosource', reason: 'the newest deployment carries no commit message' }
      const text = cut(message, pickInt(args, 'max', 72))
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-deploy-time': {
      const a = ans(s.vercel)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const d = a.data[0]
      if (d === undefined) return { state: 'nosource', reason: 'no deployments' }
      const ms = IN_FLIGHT.has(d.state) ? Math.max(0, now - d.createdAt) : Math.max(0, (d.ready ?? d.createdAt) - d.createdAt)
      const value = ok(nf.duration(ms), a.at, { num: ms, unit: 'ms' })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-deploy-target': {
      const a = ans(s.vercel)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const d = a.data[0]
      if (d === undefined) return { state: 'nosource', reason: 'no deployments' }
      const text = deployTargetOf(d)
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-deploy-wait': {
      if (s.deployWake === null) return { state: 'nosource', reason: 'no deploy-triggering command seen yet' }
      const arrived = s.vercel !== undefined && s.vercel.ok ? s.vercel.data.some(d => d.createdAt > s.deployWake!.at) : false
      if (arrived) return ok('deploy arrived', s.deployWake.at)
      return ok(`waiting for a deploy · ${nf.duration(Math.max(0, now - s.deployWake.at))}`, s.deployWake.at)
    }
    case 'x-deploy-toast': {
      if (s.deployToast === null) return { state: 'nosource', reason: 'no deployment transition between polls yet' }
      return ok(s.deployToast.text, s.deployToast.at)
    }
    case 'x-wt-list': {
      const a = ans(s.wt)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const rows = a.data.map(w => row(w.is_current ? 'info' : 'todo', w.branch, w.is_current ? 'current' : undefined, w.path))
      const value = ok(`${nf.count(a.data.length)} worktrees`, a.at, { rows })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-wt-current': {
      const a = ans(s.wt)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const current = a.data.find(w => w.is_current)
      if (current === undefined) return { state: 'nosource', reason: 'no current worktree in the wt list' }
      if (a.t === 'ok') return ok(current.branch, a.at)
      return { state: 'stale', last: ok(current.branch, a.at), reason: a.reason }
    }
    case 'x-wt-count': {
      const a = ans(s.wt)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const value = ok(nf.count(a.data.length), a.at, { num: a.data.length, unit: 'count' })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-wt-diff':
      return { state: 'nosource', reason: 'производитель wt working_tree.diff/untracked не прочитан; не приравнивать numstat/cost' }
    case 'x-prd': {
      const a = ans(s.prd)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no prd.json: ${a.reason}` }
      const counts = prdSummarise(a.data)
      const n =
        args.variant === 'pending' ? counts.pending :
        args.variant === 'failed' ? counts.failed :
        args.variant === 'needs-setup' ? counts.needsSetup :
        args.variant === 'deferred' ? counts.deferred :
        args.variant === 'unrecognised' ? counts.unrecognised :
        args.variant === 'total' ? counts.total : counts.done
      const text = args.variant === 'done' ? `${nf.count(counts.done)}/${nf.count(counts.total)} done` : `${nf.count(n)} ${args.variant}`
      const value = ok(text, a.at, { num: n, unit: 'count' })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-prd-missing': {
      const a = ans(s.prd)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return ok('no prd.json', s.lastNow)
      const counts = prdSummarise(a.data)
      const text = counts.total === 0 ? 'prd: no stories found' : `prd.json present · ${nf.count(counts.total)} stories`
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-my-prs': {
      const a = ans(s.prStatus)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const rows = a.data.createdBy.map(pr => {
        const verdict = checksVerdict(pr.statusCheckRollup ?? [])
        const review = pr.isDraft ? 'draft' : REVIEW_WORD[pr.reviewDecision ?? ''] ?? 'review'
        return row(verdict.icon, `#${pr.number} ${pr.title}`, review, pr.url)
      })
      const value = ok(`${nf.count(a.data.createdBy.length)} open PRs by me`, a.at, { rows })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-my-pr-count': {
      const a = ans(s.prStatus)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const value = ok(nf.count(a.data.createdBy.length), a.at, { num: a.data.createdBy.length, unit: 'count' })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-pr-dash':
      return { state: 'nosource', reason: 'генератор pr-dash.py status не прочитан; досъём' }
    case 'x-branch-item': {
      const a = ans(s.prStatus)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const pr = a.data.currentBranch[0]
      if (pr === undefined) return { state: 'nosource', reason: 'no PR on the current branch' }
      const bodyMax = pickInt(args, 'bodyMax', 80)
      const body = bodyMax === 0 ? '' : cut(pr.body ?? '', bodyMax)
      const rows = [
        row(pr.state === 'OPEN' && pr.isDraft ? 'todo' : pr.state === 'OPEN' ? 'run' : 'ok', `#${pr.number} PR ${(pr.state ?? '').toLowerCase()}`, undefined, pr.url),
        row('info', pr.title),
        ...(body === '' ? [] : [row('info', body)]),
      ]
      const closeRefs = closingNumbersOf(pr.body ?? '')
      const issues = ans(s.issues)
      if (issues.t === 'ok') {
        for (const n of closeRefs) {
          const issue = issues.data.find(i => i.number === n)
          if (issue !== undefined) rows.push(row(issue.state === 'OPEN' ? 'todo' : 'ok', `#${issue.number} ISSUE ${(issue.state ?? '').toLowerCase()}`, undefined, issue.url))
        }
      }
      const value = ok(`#${pr.number} PR ${(pr.state ?? '').toLowerCase()}`, a.at, { rows })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-branch-checks': {
      const a = ans(s.prStatus)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const pr = a.data.currentBranch[0]
      if (pr === undefined) return { state: 'nosource', reason: 'no PR on the current branch' }
      const checks = (pr.statusCheckRollup ?? []).map(toCheck)
      const text = (): string => {
        if (args.variant === 'word') return checksVerdict(pr.statusCheckRollup ?? []).word
        const bucket: Bucket = args.variant === 'passed' ? 'pass' : args.variant === 'failed' ? 'fail' : args.variant === 'pending' ? 'pending' : 'skipping'
        return nf.count(checks.filter(c => c.bucket === bucket).length)
      }
      const value = ok(text(), a.at)
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-branch-review': {
      // E495 is the reviewDecision word of the branch PR; the draft form is E429's row
      const a = ans(s.prStatus)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const pr = a.data.currentBranch[0]
      if (pr === undefined) return { state: 'nosource', reason: 'no PR on the current branch' }
      const text = REVIEW_PHRASE[pr.reviewDecision ?? ''] ?? 'no review'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-branch-mergeable': {
      const a = ans(s.prStatus)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const pr = a.data.currentBranch[0]
      if (pr === undefined) return { state: 'nosource', reason: 'no PR on the current branch' }
      const raw = pr.mergeable ?? 'UNKNOWN'
      const text = raw === 'MERGEABLE' ? 'mergeable' : raw === 'CONFLICTING' ? 'conflicting' : raw === 'UNKNOWN' ? 'unknown' : raw.toLowerCase()
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-branch-check-rows': {
      const a = ans(s.prStatus)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const pr = a.data.currentBranch[0]
      if (pr === undefined) return { state: 'nosource', reason: 'no PR on the current branch' }
      const checks = (pr.statusCheckRollup ?? []).map(toCheck)
      const rows = checks.map(c => row(BUCKET_ICON[c.bucket], c.name === '' ? '(unnamed)' : c.name, c.bucket, c.link === '' ? undefined : c.link))
      const value = ok(`${checks.length} checks`, a.at, { rows })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-hs-state': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      const text = (a.data.status ?? 'unknown').toUpperCase()
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-phase': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      const text = a.data.phase ?? 'unknown'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-attempt': {
      const cli = ans(s.hsCli)
      const file = ans(s.hsFile)
      if (file.t === 'pending' && cli.t === 'pending') return { state: 'pending' }
      if (file.t === 'nosource' && cli.t === 'nosource') return { state: 'nosource', reason: `no headsign run: ${file.reason}` }
      const m = cli.t === 'ok' ? /\(attempt (\d+)(?:\/(\d+|\?))?\)/.exec(cli.data) : null
      const n = m !== null ? Number(m[1]) : file.t === 'ok' || file.t === 'stale' ? (file.data.attempts?.[file.data.phase ?? ''] ?? 0) : 0
      const max = m?.[2]
      const text = max === undefined ? `${n}/?` : `${n}/${max}`
      const at = cli.t === 'ok' || cli.t === 'stale' ? cli.at : file.t === 'ok' || file.t === 'stale' ? file.at : 0
      if (cli.t === 'ok' || file.t === 'ok') return ok(text, at)
      return { state: 'stale', last: ok(text, at), reason: cli.t === 'stale' ? cli.reason : file.t === 'stale' ? file.reason : 'headsign status unreadable' }
    }
    case 'x-hs-workflow': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      const text = `workflow: ${a.data.workflow ?? 'unknown'}`
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-failure': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      const f = a.data.last_failure
      if (f === null || f === undefined || f.phase !== a.data.phase) {
        const value = ok('none in this phase', a.at)
        return a.t === 'ok' ? value : { state: 'stale', last: value, reason: a.reason }
      }
      const tailMax = pickInt(args, 'tailMax', 200)
      const exitText = f.exit_code === 'timeout' ? `timeout ${f.timeout_seconds ?? ''}s`.trim() : `exit ${f.exit_code ?? '?'}`
      const rows = [
        row('fail', f.check ?? 'unknown check', exitText, f.run ?? undefined),
        ...(f.elapsed_seconds === undefined ? [] : [row('info', `${nf.duration(f.elapsed_seconds * 1000)}`)]),
        ...(tailMax === 0 ? [] : [row('info', cut(f.output_tail ?? '', tailMax))]),
      ]
      const value = ok(f.check ?? 'failure', a.at, { rows })
      if (a.t === 'ok') return value
      return { state: 'stale', last: value, reason: a.reason }
    }
    case 'x-hs-driver': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      // CONSTRAINT: the agent id is never rendered (ADR-0013); presence only
      const text = typeof a.data.driver_agent === 'string' && a.data.driver_agent.length > 0 ? 'driver: delegated agent' : 'driver: none recorded'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-stop': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      const stop = a.data.last_stop
      const text = stop !== null && stop !== undefined && typeof stop.disposition === 'string'
        ? `last stop: ${lastStopWording(stop.disposition, stop.cause)} — at ${stop.at ?? '?'}`
        : 'last stop: none recorded'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-note': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      const stop = a.data.last_stop
      const text = stop?.disposition === 'paused' && typeof stop.note === 'string' && stop.note !== '' ? `note: ${stop.note}` : 'no pause note'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-moved': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      // CONSTRAINT: last_drive.session exists in the record and is never rendered (ADR-0027)
      const text = a.data.last_drive?.at !== undefined ? `last moved: ${a.data.last_drive.at}` : 'last moved: not recorded'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-entered': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      const text = typeof a.data.phase_entered_at === 'string' ? `entered: ${a.data.phase_entered_at}` : 'entered: not recorded'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-graph-accepted': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      const n = typeof a.data.accepted_graph_changes === 'number' ? a.data.accepted_graph_changes : 0
      const text = n > 0 ? `graph: ${nf.count(n)} accepted ${n === 1 ? 'change' : 'changes'}` : 'graph: no accepted changes'
      if (a.t === 'ok') return ok(text, a.at, { num: n, unit: 'count' })
      return { state: 'stale', last: ok(text, a.at, { num: n, unit: 'count' }), reason: a.reason }
    }
    case 'x-hs-graph-reported': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      const text = a.data.graph_change_reported != null ? 'graph: changed since accepted' : 'graph: no standing change'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-graph-file': {
      const a = ans(s.hsCli)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `headsign status unavailable: ${a.reason}` }
      const text = a.data.includes('graph: the file no longer matches') ? 'changed'
        : a.data.includes('graph: the file matches') ? 'restored'
        : 'agrees with the record'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-observer': {
      const a = ans(s.observer)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: a.reason }
      const text = a.data ? 'observer: HEADSIGN_OBSERVER is set' : 'observer: not set'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-description': {
      const a = ans(s.hsCli)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `headsign status unavailable: ${a.reason}` }
      const at = a.data.indexOf('--- phase: ')
      const text = at >= 0 ? a.data.slice(at).trim() : 'no phase description'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-neighbourhood': {
      const a = ans(s.hsCli)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `headsign status unavailable: ${a.reason}` }
      const lines = a.data.split(/\r?\n/u)
      const workflowAt = lines.findIndex(l => l.startsWith('workflow: '))
      const end = workflowAt > 0 ? workflowAt : lines.length
      const picture = lines.slice(1, end).join('\n').trim()
      const text = picture === '' ? 'no phase map' : picture
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-optimization': {
      const a = ans(s.hsCli)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `headsign status unavailable: ${a.reason}` }
      const line = a.data.split(/\r?\n/u).find(l => l.startsWith('optimization: '))
      const text = line ?? 'no optimization prompt'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-hs-end-reason': {
      const a = ans(s.hsFile)
      if (a.t === 'pending') return { state: 'pending' }
      if (a.t === 'nosource') return { state: 'nosource', reason: `no .headsign/state.json: ${a.reason}` }
      const text = typeof a.data.end_reason === 'string' && a.data.end_reason.length > 0 ? `reason: ${a.data.end_reason}` : 'none yet (running)'
      if (a.t === 'ok') return ok(text, a.at)
      return { state: 'stale', last: ok(text, a.at), reason: a.reason }
    }
    case 'x-wf-keys': {
      const rows = WF_CATALOG.map(e => row('info', e.key, undefined, e.description))
      return ok(`${WF_CATALOG.length} keys`, s.lastNow, { rows })
    }
    case 'x-wf-index': {
      const entry = wfEntryOf(s, args)
      if (entry.t === 'pending') return { state: 'pending' }
      if (entry.t === 'nosource') return { state: 'nosource', reason: entry.reason }
      const e = entry.data
      if (e === null) return { state: 'nosource', reason: 'no workflow with a status under .ai/workflows' }
      const total = s.wfRead !== undefined && s.wfRead.ok ? s.wfRead.data.length : 1
      if (args.variant === 'more') {
        const n = Math.max(0, total - 1)
        const value = ok(`${nf.count(n)} more`, entry.at, { num: n, unit: 'count' })
        return entry.t === 'ok' ? value : { state: 'stale', last: value, reason: entry.reason }
      }
      const rows = [
        row('info', e.slug, 'slug'),
        row(e.terminal ? 'ok' : 'run', e.status, 'status'),
        row('info', e.currentStage ?? '—', 'current-stage'),
        row('info', e.selectedSlice ?? '—', 'selected-slice'),
        row('info', e.nextInvocation ?? '—', 'next-invocation'),
      ]
      const value = ok(`wf ${e.slug} · ${e.status}`, entry.at, { rows })
      if (entry.t === 'ok') return value
      return { state: 'stale', last: value, reason: entry.reason }
    }
    case 'x-wf-slices': {
      const entry = wfEntryOf(s, args)
      if (entry.t === 'pending') return { state: 'pending' }
      if (entry.t === 'nosource') return { state: 'nosource', reason: entry.reason }
      const e = entry.data
      if (e === null) return { state: 'nosource', reason: 'no workflow with a status under .ai/workflows' }
      if (args.variant === 'progress') {
        const complete = e.roster.filter(sl => sl.status === 'complete' || sl.status === 'completed').length
        const value = ok(`(${nf.count(complete)} of ${nf.count(e.roster.length)} complete)`, entry.at, { num: complete, unit: 'count' })
        return entry.t === 'ok' ? value : { state: 'stale', last: value, reason: entry.reason }
      }
      const iconOf = (stage: string): Row['icon'] => stage === 'verified' ? 'ok' : stage === 'implemented' ? 'run' : stage === 'planned' ? 'todo' : 'info'
      const rows = e.roster.map(sl => row(iconOf(sl.stage), sl.slug, `${sl.status}${sl.complexity !== null ? ` · ${sl.complexity}` : ''}`, sl.stage))
      const value = ok(`${nf.count(e.roster.length)} slices`, entry.at, { rows })
      if (entry.t === 'ok') return value
      return { state: 'stale', last: value, reason: entry.reason }
    }
    case 'x-wf-stage-cost': {
      if (s.lastStageUsd === null) return { state: 'nosource', reason: 'no /wf stage turn has completed yet' }
      return ok(`${nf.usd(s.lastStageUsd)} this stage`, s.lastNow, { num: s.lastStageUsd, unit: 'usd' })
    }
    case 'x-wf-ledger': {
      const entry = wfEntryOf(s, args)
      if (entry.t === 'pending') return { state: 'pending' }
      if (entry.t === 'nosource') return { state: 'nosource', reason: entry.reason }
      const e = entry.data
      if (e === null) return { state: 'nosource', reason: 'no workflow with a status under .ai/workflows' }
      if (e.ledgerTokens === null) return { state: 'nosource', reason: `no cost.jsonl under .ai/workflows/${e.slug}` }
      const value = ok(`${nf.tokens(e.ledgerTokens)} tokens workflow`, entry.at, { num: e.ledgerTokens, unit: 'tokens' })
      if (entry.t === 'ok') return value
      return { state: 'stale', last: value, reason: entry.reason }
    }
    case 'x-wf-mode': {
      const entry = wfEntryOf(s, args)
      if (entry.t === 'pending') return { state: 'pending' }
      if (entry.t === 'nosource') return { state: 'nosource', reason: entry.reason }
      const e = entry.data
      if (e === null) return { state: 'nosource', reason: 'no workflow with a status under .ai/workflows' }
      const text = e.terminal || e.currentStage === null ? 'no stage' : `wf:${e.currentStage}`
      if (entry.t === 'ok') return ok(text, entry.at)
      return { state: 'stale', last: ok(text, entry.at), reason: entry.reason }
    }
    case 'x-wf-spinner': {
      if (s.wfBracket !== null) {
        const verb = WF_VERBS[s.wfBracket.command.key] ?? null
        if (verb === null) return ok('working', s.wfBracket.at)
        const target = s.wfBracket.command.slice ?? s.wfBracket.command.slug
        return ok(target === null ? verb : `${verb} ${target}`, s.wfBracket.at)
      }
      if (s.lastWf === null) return { state: 'nosource', reason: 'no /wf command seen yet' }
      return ok('idle', s.lastWf.at)
    }
    default:
      return { state: 'pending' }
  }
}

export default collector
