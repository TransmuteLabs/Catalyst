// The activity family (T-act): agents, tools, session/turn events, runtime
// counters, and the sdlc-workflow artifacts under .ai/workflows.
// CONSTRAINT: pure module — no `$`, no `on`, no I/O, no Date.now(); time arrives
// as Input.now. The cmd sources are read-only; the find/cat reads reach the
// per-slug artifact files that the fixed-path `file` source cannot address.
// CONSTRAINT: turn.complete data is the hook's result ({ text, usage }) per the
// data brief; the input fields (agentId, reason, usage) are read when present,
// so the elements stay truthful under either feed.

import type { Collector, ElementDef, FormatArgs, Input, Ok, Row, Source, Value } from './types'

const SLOW_TOOL_MS = 30_000
const QUIET_MS = 120_000
const DEAD_FLOOR_MS = 20 * 60_000
const QUESTION_FLOOR = 20
const RING_CAP = 8
const RECENT_CAP = 8
const ASK = 'AskUserQuestion'
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit'])
const STAGES = ['intake', 'shape', 'slice', 'plan', 'implement', 'verify', 'review', 'handoff', 'ship', 'retro'] as const
const TERMINAL_COMPLETE = new Set(['complete', 'completed', 'shipped', 'done'])
const TERMINAL_CLOSED = new Set(['closed', 'abandoned', 'cancelled'])
const READY_STAGES = new Set(['handoff', 'ship', 'retro'])
const OPEN_FINDING_STATUSES = new Set(['open', 'deferred', 'could-not-fix'])
const DECLARED_EVENTS = new Set(['session.start', 'turn.start', 'turn.step', 'turn.complete', 'tool.call', 'agent.spawn', 'config.set'])
const SHELL_FENCE = /^(?:ba|z|fi)?sh$|^shell$|^console$|^$/
// The producer's synthetic types for the five fixed project-context slots
// (agent-skills render-sunflower project candidates).
const PROJECT_SLOTS = [
  { path: 'PRODUCT.md', type: 'project-context' },
  { path: 'DESIGN.md', type: 'project-context' },
  { path: '.ai/ship-plan.md', type: 'ship-plan' },
  { path: '.ai/observability.md', type: 'observability-plan' },
  { path: '.ai/observability-build.md', type: 'observability-build' },
] as const

type ToolMark = { tool: string; start: number; end?: number }

type AgentRec = {
  agentId?: string
  spawnId?: string
  listed: boolean
  type: string
  name?: string
  desc: string
  prompt?: string
  model?: string
  mode: 'foreground' | 'background' | 'fork'
  status: 'running' | 'completed' | 'failed' | 'unknown'
  firstAt: number
  firstExact: boolean
  endedAt?: number
  exactMs?: number
  toolCalls: number
  marks: ToolMark[]
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  lastEventAt: number
}

type RingEntry = { event: string; note: string; at: number }
type WfDoc = { slug: string; fm: Record<string, string> }
type Beat = { at: number; run: string; event: string; agent: string | null; stage: string | null; slice: string | null }
type CostRow = { turn: unknown; main: unknown; subagents: unknown; external: unknown }
type ReviewFile = { slug: string; name: string; text: string }
type MissEntry = { key: string; artifact: string; at: number }
type Snap = { seen: boolean; ok: boolean; good: boolean; at?: number; error?: string }

type State = {
  now: number
  events: number
  unknownNames: Set<string>
  errorResults: number
  turnErrors: number
  ring: RingEntry[]
  agents: Map<string, AgentRec>
  mainTool?: ToolMark
  mainBoundedMs: number
  agentExactMs: number
  chars: number
  userMessages: number
  messagesSeen: boolean
  eventsSeen: boolean
  busy: boolean
  turnStartAt?: number
  turnNum: number
  lastTurnMs?: number
  questions: number
  answerText?: string
  compacts: number
  compactLastAt?: number
  usageStartedAt?: number
  maxCount?: number
  maxCountAt?: number
  pendingWf?: { key: string; slice: string | null; wrote: Set<string> }
  misses: MissEntry[]
  ps: Snap
  psCpu?: number
  wf: Snap
  wfDocs: WfDoc[]
  driver: Snap
  driverDocs: { slug: string; beats: Beat[] }[]
  cost: Snap
  costDocs: { slug: string; rows: CostRow[] }[]
  review: Snap
  reviewDocs: ReviewFile[]
  shipPlan: Snap
  shipPlanText?: string
  project: { path: string; type: string; fm: Record<string, string>; snap: Snap }[]
}

const N_REASON_FLOWPANE = 'producer journal flowpane не прочитан; токены/elapsed/topology не подменяются данными иной сессии'

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const cut = (s: string, len: number): string => (s.length > len ? s.slice(0, len - 1) + '…' : s)
const lower = (v: string | undefined): string => (v ?? '').trim().toLowerCase()

function frontmatterOf(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (m === null) return fields
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const f = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (f === null) continue
    const raw = (f[2] ?? '').trim()
    const q = /^"(.*)"$|^'(.*)'$/.exec(raw)
    fields[f[1] as string] = q === null ? raw : (q[1] ?? q[2] ?? '').trim()
  }
  return fields
}

// Items of one top-level YAML list: `- field: value` heads with same-indent fields.
function yamlListItems(text: string, key: string): Record<string, string>[] | null {
  const head = new RegExp(`^${key}:\\s*$`, 'm').exec(text)
  if (head === null) return null
  const lines = text.slice((head.index ?? 0) + (head[0] ?? '').length).split(/\r?\n/)
  const items: Record<string, string>[] = []
  let item: Record<string, string> | null = null
  let itemIndent = -1
  let fieldIndent = -1
  for (const line of lines) {
    if (item === null && line.trim() === '') continue
    if (item !== null && /^\S/.test(line)) break
    const indent = line.length - line.trimStart().length
    const dash = /^\s*-\s*(.*)$/.exec(line)
    if (dash !== null && (itemIndent === -1 || indent === itemIndent)) {
      itemIndent = indent
      item = {}
      items.push(item)
      const field = /^([\w-]+):\s*(.*)$/.exec(dash[1] ?? '')
      if (field !== null) {
        fieldIndent = indent + 2
        item[field[1] as string] = (field[2] ?? '').trim()
      }
      continue
    }
    if (dash !== null || item === null || indent <= itemIndent) continue
    if (fieldIndent === -1) fieldIndent = indent
    if (indent !== fieldIndent) continue
    const field = /^([\w-]+):\s*(.*)$/.exec(line.trimStart())
    if (field !== null) {
      const k = field[1] as string
      if (!(k in item)) item[k] = (field[2] ?? '').trim()
    }
  }
  return items
}

function openFindingsOf(text: string): number {
  const items = yamlListItems(text, 'findings')
  if (items !== null) return items.filter((it) => OPEN_FINDING_STATUSES.has(lower(it['status']) || 'open')).length
  return (text.match(/^\s*[-*]\s+\[ \]\s/gm) ?? []).length
}

function shipPlanBlockersOf(text: string): number {
  const items = yamlListItems(text, 'findings') ?? []
  return items.filter((it) => (lower(it['status']) || 'open') === 'open' && /^(?:BLOCKER|HIGH)$/i.test(it['severity'] ?? '')).length
}

// The review ledger a workflow reads: the sweep sibling, else the selected
// slice's, else the last by name; yaml preferred over md.
function reviewLedgerOf(files: ReviewFile[], selectedSlice: string | null): ReviewFile | null {
  const ledgers = files.filter((f) => /^07-review.*\.(?:md|yaml)$/.test(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1))
  for (const ext of ['yaml', 'md'] as const) {
    const own = ledgers.filter((f) => f.name.endsWith('.' + ext))
    if (own.length === 0) continue
    const sweep = own.find((f) => f.name === `07-review.${ext}`) ?? (selectedSlice === null ? undefined : own.find((f) => f.name === `07-review-${selectedSlice}.${ext}`))
    return sweep ?? own[own.length - 1] ?? null
  }
  return null
}

function beatsOf(text: string): Beat[] {
  const beats: Beat[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row === null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const at = typeof r['at'] === 'string' ? Date.parse(r['at']) : num(r['at'], NaN)
    if (!Number.isFinite(at)) continue
    beats.push({ at, run: str(r['run']) ?? '', event: str(r['event']) ?? '', agent: str(r['agent']) ?? null, stage: str(r['stage']) ?? null, slice: str(r['slice']) ?? null })
  }
  return beats
}

function usageColumns(u: unknown): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  if (u === null || typeof u !== 'object') return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const r = u as Record<string, unknown>
  const codex = r['fields'] === 'codex' || 'cached_input_tokens' in r
  const floor0 = (v: unknown): number => Math.max(0, Math.floor(num(v)))
  return {
    input: floor0(r['input_tokens']),
    output: floor0(r['output_tokens']),
    cacheRead: floor0(codex ? r['cached_input_tokens'] : r['cache_read_input_tokens']),
    cacheWrite: floor0(codex ? r['cache_write_input_tokens'] : r['cache_creation_input_tokens']),
  }
}

type CostAgg = { turns: number; subagents: number; external: number; input: number; output: number; cacheRead: number; cacheWrite: number; externalInput: number; externalOutput: number }

const emptyAgg = (): CostAgg => ({ turns: 0, subagents: 0, external: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, externalInput: 0, externalOutput: 0 })

function aggregateCost(rows: CostRow[]): CostAgg {
  const agg = emptyAgg()
  for (const r of rows) {
    if (r.turn !== undefined && r.turn !== null) agg.turns += 1
    const main = usageColumns(r.main)
    agg.input += main.input
    agg.output += main.output
    agg.cacheRead += main.cacheRead
    agg.cacheWrite += main.cacheWrite
    for (const s of Array.isArray(r.subagents) ? r.subagents : []) {
      agg.subagents += 1
      const c = usageColumns(s)
      agg.input += c.input
      agg.output += c.output
      agg.cacheRead += c.cacheRead
      agg.cacheWrite += c.cacheWrite
    }
    for (const x of Array.isArray(r.external) ? r.external : []) {
      const c = usageColumns(x)
      agg.external += 1
      agg.externalInput += c.input + c.cacheRead + c.cacheWrite
      agg.externalOutput += c.output
    }
  }
  return agg
}

// The output of `find <dir> (-name <pat>) -print -exec cat {} ;`: a path line
// opens a document, the lines after it are that document's body.
function docsOfFind(stdout: string, filePattern: RegExp): { slug: string; name: string; body: string }[] {
  const docs: { slug: string; name: string; body: string }[] = []
  let cur: { slug: string; name: string; body: string } | null = null
  for (const line of stdout.split('\n')) {
    const p = /^\.ai\/workflows\/([a-z0-9][a-z0-9-]*)\/([^/\s]+)$/.exec(line)
    if (p !== null && filePattern.test(p[2] ?? '')) {
      cur = { slug: p[1] ?? '', name: p[2] ?? '', body: '' }
      docs.push(cur)
      continue
    }
    if (cur !== null) cur.body += line + '\n'
  }
  return docs
}

function shellBlocksOf(text: string): string[][] {
  const blocks: string[][] = []
  const re = /```([^\n`]*)\n([\s\S]*?)```/g
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (!SHELL_FENCE.test((m[1] ?? '').trim())) continue
    const lines = (m[2] ?? '').split('\n').filter((l) => l.trim() !== '')
    if (lines.length > 0) blocks.push(lines)
  }
  return blocks
}

// The artifact a /wf stage command must land (agent-skills expectedArtifactOf):
// shape/slice/handoff/ship/retro land one file, the slice stages the
// slice-suffixed one.
function expectedArtifactOf(key: string, slice: string | null): string | null {
  const withSlice = (stem: string): string | null => (slice === null || slice === 'all' ? null : `${stem}-${slice}.md`)
  switch (key) {
    case 'shape':
      return '02-shape.md'
    case 'slice':
      return '03-slice.md'
    case 'plan':
      return withSlice('04-plan')
    case 'implement':
      return withSlice('05-implement')
    case 'verify':
      return withSlice('06-verify')
    case 'handoff':
      return '08-handoff.md'
    case 'ship':
      return '09-ship.md'
    case 'retro':
      return '10-retro.md'
    default:
      return null
  }
}

function parseWfCommand(textValue: string): { key: string; slice: string | null } | null {
  const m = /^\/wf[?+-]?\s+(\S+)(?:\s+\S+)?(?:\s+(\S+))?/.exec(textValue.trim())
  if (m === null) return null
  const slice = m[2] ?? null
  return { key: m[1] ?? '', slice: slice === '' ? null : slice }
}

const currentOf = (marks: ToolMark[]): ToolMark | undefined => {
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const mark = marks[i]
    if (mark !== undefined && mark.end === undefined) return mark
  }
  return undefined
}

function ensureAgent(s: State, key: string, at: number, listed: boolean): AgentRec {
  let rec = s.agents.get(key)
  if (rec === undefined) {
    rec = {
      agentId: key.startsWith('t:') ? undefined : key,
      spawnId: key.startsWith('t:') ? key.slice(2) : undefined,
      listed,
      type: '?',
      desc: '',
      mode: 'foreground',
      status: listed ? 'running' : 'unknown',
      firstAt: at,
      firstExact: listed,
      toolCalls: 0,
      marks: [],
      lastEventAt: at,
    }
    s.agents.set(key, rec)
  }
  return rec
}

function closeRunning(marks: ToolMark[], at: number): void {
  const cur = currentOf(marks)
  if (cur !== undefined) cur.end = at
}

// CONSTRAINT: a config.set value is never printed or kept.
function noteOf(source: Source, data: unknown): string {
  if (data === null || typeof data !== 'object') return ''
  const e = data as Record<string, unknown>
  if (source.kind !== 'event') return ''
  switch (source.event) {
    case 'config.set':
      return 'key ' + String(e['key'] ?? '')
    case 'tool.call':
      return String(e['tool'] ?? '') + (e['agentId'] !== undefined ? ' agent' : '')
    case 'agent.spawn':
      return String(e['subagentType'] ?? '')
    case 'turn.step':
      return '#' + String(e['index'] ?? '') + (e['agentId'] !== undefined ? ' agent' : '')
    case 'turn.start':
      return 'turn'
    case 'turn.complete':
      return 'answer'
    case 'session.start':
      return 'start'
    default:
      return ''
  }
}

// ---------------------------------------------------------------- state

const freshSnap = (): Snap => ({ seen: false, ok: false, good: false })

function init(): State {
  return {
    now: 0,
    events: 0,
    unknownNames: new Set(),
    errorResults: 0,
    turnErrors: 0,
    ring: [],
    agents: new Map(),
    mainBoundedMs: 0,
    agentExactMs: 0,
    chars: 0,
    userMessages: 0,
    messagesSeen: false,
    eventsSeen: false,
    busy: false,
    turnNum: 0,
    questions: 0,
    compacts: 0,
    misses: [],
    ps: freshSnap(),
    wf: freshSnap(),
    wfDocs: [],
    driver: freshSnap(),
    driverDocs: [],
    cost: freshSnap(),
    costDocs: [],
    review: freshSnap(),
    reviewDocs: [],
    shipPlan: freshSnap(),
    project: PROJECT_SLOTS.map((slot) => ({ path: slot.path, type: slot.type, fm: {}, snap: freshSnap() })),
  }
}

function reduce(s: State, input: Input): State {
  s.now = input.now
  const src = input.source
  if (src.kind === 'event') {
    s.events += 1
    s.eventsSeen = true
    if (!DECLARED_EVENTS.has(src.event)) s.unknownNames.add(src.event)
    s.ring.push({ event: src.event, note: noteOf(src, input.data), at: input.now })
    while (s.ring.length > RING_CAP) s.ring.shift()
    onEvent(s, src.event, input)
    return s
  }
  if (src.kind === 'session') {
    onSession(s, src.call, input)
    return s
  }
  if (src.kind === 'cmd') {
    onCmd(s, src, input)
    return s
  }
  if (src.kind === 'file') {
    onFile(s, src, input)
    return s
  }
  return s
}

function onEvent(s: State, event: string, input: Input): void {
  const e = (input.data ?? {}) as Record<string, unknown>
  const agentId = str(e['agentId'])
  if (event === 'agent.spawn') {
    const key = 't:' + String(e['tool_use_id'] ?? '')
    if (s.agents.has(key)) return
    const rec = ensureAgent(s, key, input.now, true)
    rec.type = str(e['subagentType']) ?? '?'
    rec.name = str(e['name'])
    rec.desc = str(e['description']) ?? str(e['name']) ?? ''
    rec.prompt = str(e['prompt'])
    rec.model = str(e['model']) ?? str(e['parentModel'])
    rec.mode = e['fork'] === true ? 'fork' : e['background'] === true ? 'background' : 'foreground'
    rec.lastEventAt = input.now
    return
  }
  if (event === 'tool.call') {
    const tool = str(e['tool']) ?? '?'
    if (tool === ASK) s.questions += 1
    if (agentId !== undefined) {
      const rec = s.agents.get(agentId) ?? ensureAgent(s, agentId, input.now, false)
      closeRunning(rec.marks, input.now)
      rec.marks.push({ tool, start: input.now })
      while (rec.marks.length > RECENT_CAP) rec.marks.shift()
      rec.toolCalls += 1
      rec.lastEventAt = input.now
    } else {
      if (s.mainTool !== undefined && s.mainTool.end === undefined) {
        s.mainTool.end = input.now
        s.mainBoundedMs += input.now - s.mainTool.start
      }
      s.mainTool = { tool, start: input.now }
    }
    if (WRITE_TOOLS.has(tool) && s.pendingWf !== undefined) {
      const p = str(e['file_path']) ?? str(e['notebook_path'])
      if (p !== undefined) s.pendingWf.wrote.add(p.split('/').pop() ?? p)
    }
    return
  }
  if (event === 'turn.step') {
    if (agentId !== undefined) {
      const rec = s.agents.get(agentId) ?? ensureAgent(s, agentId, input.now, false)
      const model = str(e['model'])
      if (model !== undefined) rec.model = model
      rec.lastEventAt = input.now
      return
    }
    const mc = num(e['messageCount'], -1)
    if (mc < 0) return
    if (s.usageStartedAt !== s.maxCountAt) {
      // a new session epoch (/clear, resume) resets the baseline silently
      s.maxCount = mc
      s.maxCountAt = s.usageStartedAt
    } else if (mc < (s.maxCount ?? 0)) {
      s.compacts += 1
      s.compactLastAt = input.now
      s.maxCount = mc
    } else {
      s.maxCount = mc
    }
    return
  }
  if (event === 'turn.start') {
    s.busy = true
    s.turnNum += 1
    s.turnStartAt = input.now
    if (s.mainTool !== undefined && s.mainTool.end === undefined) {
      s.mainTool.end = input.now
      s.mainBoundedMs += input.now - s.mainTool.start
    }
    const cmd = parseWfCommand(str(e['text']) ?? '')
    s.pendingWf = cmd !== null && expectedArtifactOf(cmd.key, cmd.slice) !== null ? { key: cmd.key, slice: cmd.slice, wrote: new Set() } : undefined
    return
  }
  if (event === 'turn.complete') {
    s.busy = false
    if (s.turnStartAt !== undefined) {
      s.lastTurnMs = input.now - s.turnStartAt
      s.turnStartAt = undefined
    }
    if (s.mainTool !== undefined && s.mainTool.end === undefined) {
      s.mainTool.end = input.now
      s.mainBoundedMs += input.now - s.mainTool.start
    }
    s.mainTool = undefined
    const textValue = str(e['text'])
    if (textValue !== undefined) s.answerText = textValue
    if (str(e['reason']) === 'error') s.turnErrors += 1
    if (agentId !== undefined) {
      const rec = s.agents.get(agentId) ?? ensureAgent(s, agentId, input.now, false)
      closeRunning(rec.marks, input.now)
      const usage = e['usage']
      if (usage !== null && typeof usage === 'object') {
        const u = usage as Record<string, unknown>
        const t = rec.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        t.input += num(u['input_tokens'])
        t.output += num(u['output_tokens'])
        t.cacheRead += num(u['cache_read_input_tokens'])
        t.cacheWrite += num(u['cache_creation_input_tokens'])
        rec.tokens = t
        const model = str(u['model'])
        if (model !== undefined) rec.model = model
      }
      rec.status = str(e['reason']) === 'error' ? 'failed' : 'completed'
      rec.endedAt = input.now
      rec.lastEventAt = input.now
    }
    if (s.pendingWf !== undefined) {
      const reason = str(e['reason'])
      const interrupted = reason !== undefined && reason !== 'answer'
      if (!interrupted) {
        const expected = expectedArtifactOf(s.pendingWf.key, s.pendingWf.slice)
        if (expected !== null && ![...s.pendingWf.wrote].some((b) => b.toLowerCase() === expected.toLowerCase())) {
          s.misses.push({ key: s.pendingWf.key, artifact: expected, at: input.now })
          while (s.misses.length > RING_CAP) s.misses.shift()
        }
      }
      s.pendingWf = undefined
    }
    return
  }
  if (event === 'session.start') {
    s.busy = false
    return
  }
}

function onSession(s: State, call: string, input: Input): void {
  if (!input.ok) return
  if (call === 'usage') {
    const startedAt = num((input.data as Record<string, unknown> | undefined)?.['startedAt'], NaN)
    if (Number.isFinite(startedAt)) s.usageStartedAt = startedAt
    return
  }
  if (call === 'messages') {
    s.messagesSeen = true
    const list = Array.isArray(input.data) ? (input.data as Record<string, unknown>[]) : []
    let chars = 0
    let errors = 0
    let users = 0
    let agentExact = 0
    for (const m of list) {
      if (m['role'] === 'user') users += 1
      for (const u of Array.isArray(m['toolUses']) ? (m['toolUses'] as Record<string, unknown>[]) : []) {
        const t = str(u['text'])
        if (t !== undefined) chars += t.length
        if (u['isError'] === true) errors += 1
        if (u['tool'] !== 'Agent') continue
        const spawnId = str(u['tool_use_id'])
        const agentId = str(u['agentId'])
        const durationMs = num(u['durationMs'], NaN)
        if (Number.isFinite(durationMs)) agentExact += durationMs
        if (spawnId === undefined || agentId === undefined) continue
        const spawned = s.agents.get('t:' + spawnId)
        if (spawned !== undefined) {
          const ghost = s.agents.get(agentId)
          if (ghost !== undefined && ghost !== spawned) {
            spawned.toolCalls += ghost.toolCalls
            spawned.marks = ghost.marks.length > 0 ? ghost.marks : spawned.marks
            spawned.lastEventAt = Math.max(spawned.lastEventAt, ghost.lastEventAt)
            if (ghost.model !== undefined) spawned.model = ghost.model
            s.agents.delete(agentId)
          }
          s.agents.delete('t:' + spawnId)
          spawned.agentId = agentId
          spawned.listed = true
          if (spawned.status === 'unknown') spawned.status = 'running'
          s.agents.set(agentId, spawned)
        }
        const rec = s.agents.get(agentId)
        if (rec !== undefined && t !== undefined) {
          closeRunning(rec.marks, input.now)
          rec.status = u['isError'] === true ? 'failed' : 'completed'
          if (Number.isFinite(durationMs)) rec.exactMs = durationMs
          rec.endedAt = input.now
          rec.lastEventAt = input.now
        }
      }
    }
    s.chars = chars
    s.errorResults = errors
    s.userMessages = users
    s.agentExactMs = agentExact
  }
}

function feedCmd(s: State, snap: Snap, input: Input, keep: (stdout: string) => void, label: string, missingReason: string): void {
  void s
  const d = (input.data ?? {}) as { code?: number; stdout?: string; stderr?: string }
  const stderr = str(d.stderr) ?? ''
  const code = num(d.code)
  snap.seen = true
  snap.at = input.now
  if (input.ok && code === 0) {
    snap.ok = true
    snap.good = true
    snap.error = undefined
    keep(str(d.stdout) ?? '')
    return
  }
  snap.ok = false
  snap.error = /No such file or directory/.test(stderr) ? missingReason : `${label} failed: ${stderr !== '' ? stderr : 'exit ' + String(code)}`
}

function onCmd(s: State, src: Source, input: Input): void {
  if (src.kind !== 'cmd') return
  const argv = src.argv.join(' ')
  if (argv.startsWith('ps ')) {
    feedCmd(s, s.ps, input, (stdout) => {
      let cpu = 0
      let numeric = false
      for (const line of stdout.split('\n')) {
        const m = /^\s*([0-9.]+)\s+\d+(?:\.\d+)?\s+(.*)$/.exec(line)
        if (m === null) continue
        numeric = true
        const parts = (m[2] ?? '').trim().split(/\s+/)
        const first = parts[0] ?? ''
        const base = first.split('/').pop() ?? first
        const isClaude = base === 'claude' || ((base === 'node' || base === 'bun') && parts.some((p) => (p.split('/').pop() ?? p) === 'claude'))
        if (isClaude) cpu += Number(m[1] ?? 0)
      }
      if (!numeric) {
        // CONSTRAINT: words where numbers belong are a failed read, never 0% cpu
        s.ps.ok = false
        s.ps.error = 'ps output not numeric'
        s.ps.good = s.psCpu !== undefined
        return
      }
      s.psCpu = Number.isFinite(cpu) ? cpu : 0
    }, 'ps', 'ps unavailable')
    return
  }
  if (argv.includes('00-index.md')) {
    feedCmd(s, s.wf, input, (stdout) => {
      s.wfDocs = docsOfFind(stdout, /^00-index\.md$/).map((d) => ({ slug: d.slug, fm: frontmatterOf(d.body) }))
    }, 'find workflows', 'no .ai/workflows in this project')
    return
  }
  if (argv.includes('.driver-journal.jsonl')) {
    feedCmd(s, s.driver, input, (stdout) => {
      s.driverDocs = docsOfFind(stdout, /^\.driver-journal\.jsonl$/).map((d) => ({ slug: d.slug, beats: beatsOf(d.body) }))
    }, 'find driver journal', 'no .ai/workflows in this project')
    return
  }
  if (argv.includes('cost.jsonl')) {
    feedCmd(s, s.cost, input, (stdout) => {
      s.costDocs = docsOfFind(stdout, /^cost\.jsonl$/).map((d) => {
        const rows: CostRow[] = []
        for (const line of d.body.split(/\r?\n/)) {
          if (line.trim() === '') continue
          try {
            const row = JSON.parse(line) as Record<string, unknown>
            if (row !== null && typeof row === 'object') rows.push({ turn: row['turn'], main: row['main'], subagents: row['subagents'], external: row['external'] })
          } catch {
            continue
          }
        }
        return { slug: d.slug, rows }
      })
    }, 'find cost ledger', 'no .ai/workflows in this project')
    return
  }
  if (argv.includes('07-review')) {
    feedCmd(s, s.review, input, (stdout) => {
      s.reviewDocs = docsOfFind(stdout, /^07-review.*\.(?:md|yaml)$/).map((d) => ({ slug: d.slug, name: d.name, text: d.body }))
    }, 'find review ledger', 'no .ai/workflows in this project')
  }
}

function onFile(s: State, src: Source, input: Input): void {
  if (src.kind !== 'file') return
  if (src.path === '.ai/ship-plan-audit.md') {
    s.shipPlan.seen = true
    s.shipPlan.at = input.now
    if (input.ok) {
      s.shipPlan.ok = true
      s.shipPlan.good = true
      s.shipPlan.error = undefined
      s.shipPlanText = str(input.data) ?? ''
    } else {
      s.shipPlan.ok = false
      s.shipPlan.error = 'file not present: ' + src.path
      s.shipPlanText = undefined
    }
    return
  }
  const slot = s.project.find((p) => p.path === src.path)
  if (slot === undefined) return
  slot.snap.seen = true
  slot.snap.at = input.now
  if (input.ok) {
    slot.snap.ok = true
    slot.snap.good = true
    slot.snap.error = undefined
    slot.fm = frontmatterOf(str(input.data) ?? '')
  } else {
    slot.snap.ok = false
    slot.snap.error = 'file not present: ' + src.path
  }
}

// ---------------------------------------------------------------- value helpers

function wrap(snap: Snap, build: () => Ok): Value {
  if (!snap.seen) return { state: 'pending' }
  if (snap.ok) return build()
  if (snap.good) return { state: 'stale', last: build(), reason: snap.error ?? 'source failed' }
  return { state: 'nosource', reason: snap.error ?? 'unavailable' }
}

function wrapEvents(s: State, build: () => Ok): Value {
  if (!s.eventsSeen) return { state: 'pending' }
  return build()
}

const ok = (textValue: string, extra?: Partial<Ok>): Ok => ({ state: 'ok', text: textValue, at: 0, ...extra })

function optInt(a: FormatArgs, key: string, dflt: number): number {
  const v = a.options[key]
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt
}

const agentWaiting = (rec: AgentRec): boolean => currentOf(rec.marks)?.tool === ASK

function agentsList(s: State): AgentRec[] {
  return [...s.agents.values()].sort((x, y) => y.lastEventAt - x.lastEventAt)
}

function elapsedOf(rec: AgentRec, now: number, nf: FormatArgs['nf']): string {
  const tild = rec.firstExact ? '' : '~'
  if (rec.exactMs !== undefined) return nf.duration(rec.exactMs)
  if (rec.endedAt !== undefined) return tild + nf.duration(Math.max(0, rec.endedAt - rec.firstAt))
  return tild + nf.duration(Math.max(0, now - rec.firstAt))
}

function agentRow(rec: AgentRec, s: State, a: FormatArgs): Row {
  const nf = a.nf
  const label = `${rec.type}${rec.name !== undefined ? ' ' + rec.name : ''} "${cut(rec.desc, 30)}"`
  const icon: Row['icon'] = rec.status === 'failed' ? 'fail' : rec.status === 'completed' ? 'ok' : agentWaiting(rec) ? 'todo' : rec.status === 'unknown' ? 'info' : 'run'
  const right = `${elapsedOf(rec, s.now, nf)} ×${nf.count(rec.toolCalls)}`
  const parts: string[] = []
  const cur = currentOf(rec.marks)
  if (cur !== undefined) {
    parts.push(`${cur.tool} ${nf.duration(Math.max(0, s.now - cur.start))}`)
    if (s.now - cur.start > SLOW_TOOL_MS) parts.push('slow')
  }
  if (agentWaiting(rec)) parts.push('waiting for approval')
  if (rec.status === 'running' && cur === undefined && s.now - rec.lastEventAt > QUIET_MS) parts.push('quiet ' + nf.duration(Math.max(0, s.now - rec.lastEventAt)))
  if (!rec.listed) parts.push('unlisted')
  if (rec.tokens !== undefined) parts.push(`in ${nf.tokens(rec.tokens.input)} out ${nf.tokens(rec.tokens.output)}`)
  if (a.options['detail'] === 'full') {
    const extra: string[] = [`${rec.model ?? '?'} · ${rec.mode}`]
    if (rec.prompt !== undefined && rec.prompt !== '') extra.push('prompt ' + cut(rec.prompt, 40))
    const recent = rec.marks.slice(-3).map((m) => `${m.tool} ${nf.duration(Math.max(0, (m.end ?? s.now) - m.start))}`)
    if (recent.length > 0) extra.push(recent.join(', '))
    if (rec.tokens !== undefined) extra.push(`cache ${nf.tokens(rec.tokens.cacheRead)}/${nf.tokens(rec.tokens.cacheWrite)}`)
    extra.push(`last ${nf.duration(Math.max(0, s.now - rec.lastEventAt))} ago`)
    extra.push(`id ${rec.agentId ?? rec.spawnId ?? '?'}`)
    parts.unshift(...extra)
  }
  const detail = parts.join(' · ')
  return detail === '' ? { icon, label, right } : { icon, label, detail, right }
}

function waitingLoops(s: State): string[] {
  const tools: string[] = []
  if (s.mainTool !== undefined && s.mainTool.end === undefined && s.mainTool.tool === ASK) tools.push(s.mainTool.tool)
  for (const rec of s.agents.values()) if (agentWaiting(rec)) tools.push(currentOf(rec.marks)?.tool ?? ASK)
  return tools
}

const statusOfWf = (fm: Record<string, string>): string => lower(fm['status'])
const isPipeline = (doc: WfDoc): boolean => doc.fm['type'] !== 'workflow-index'
const isShipped = (doc: WfDoc): boolean => TERMINAL_COMPLETE.has(statusOfWf(doc.fm))
const isClosedWf = (doc: WfDoc): boolean => TERMINAL_CLOSED.has(statusOfWf(doc.fm))
const isActiveWf = (doc: WfDoc): boolean => !isShipped(doc) && !isClosedWf(doc)
const updatedOf = (doc: WfDoc): number => {
  const t = Date.parse(doc.fm['updated-at'] ?? '')
  return Number.isFinite(t) ? t : 0
}
const byNewest = (x: WfDoc, y: WfDoc): number => updatedOf(y) - updatedOf(x)
const blockerCountOf = (fm: Record<string, string>): number => {
  const v = Number(fm['blockers'] ?? fm['blocker-count'] ?? (statusOfWf(fm) === 'blocked' || fm['blocked'] === 'true' ? 1 : 0))
  return Number.isFinite(v) ? v : 0
}

function healthOf(fm: Record<string, string>): { glyph: string; label: string } {
  const status = statusOfWf(fm)
  const blocked = status === 'blocked' || fm['blocked'] === 'true'
  if (blocked) return { glyph: '●', label: 'blocked' }
  if (TERMINAL_COMPLETE.has(status)) return { glyph: '◉', label: 'shipped' }
  if (TERMINAL_CLOSED.has(status)) return { glyph: '◎', label: status }
  if (['paused', 'on-hold', 'waiting'].includes(status)) return { glyph: '◐', label: status }
  return { glyph: '◉', label: status === '' ? 'active' : status }
}

function readinessOf(members: WfDoc[]): string {
  let ready = 0
  let blocked = 0
  for (const doc of members) {
    const st = statusOfWf(doc.fm)
    if (st === 'blocked' || doc.fm['blocked'] === 'true') {
      blocked += 1
      continue
    }
    if (READY_STAGES.has(doc.fm['current-stage'] ?? '') || TERMINAL_COMPLETE.has(st)) ready += 1
  }
  if (blocked > 0) return `${blocked} blocked`
  if (ready === members.length) return 'all ready — batch ship'
  if (ready > 0) return `${ready}/${members.length} ready`
  return 'in progress'
}

function stageIndexOf(doc: WfDoc, shipped: boolean): number {
  if (shipped) return STAGES.length - 1
  const idx = STAGES.indexOf((doc.fm['current-stage'] ?? 'intake') as (typeof STAGES)[number])
  return idx < 0 ? 0 : idx
}

function dotsOf(idx: number, shipped: boolean): string {
  if (shipped) return '●'.repeat(STAGES.length)
  let out = ''
  for (let i = 0; i < STAGES.length; i += 1) out += i < idx ? '●' : i === idx ? '◐' : '○'
  return out
}

function newestDriver(s: State): { beats: Beat[] } | null {
  let best: { beats: Beat[] } | null = null
  for (const doc of s.driverDocs) {
    if (doc.beats.length === 0) continue
    if (best === null || (doc.beats[doc.beats.length - 1]?.at ?? 0) > (best.beats[best.beats.length - 1]?.at ?? 0)) best = doc
  }
  return best
}

function driverStatus(s: State, nf: FormatArgs['nf']): { alive: boolean; line: string; deadText: string; aliveText: string } | null {
  const doc = newestDriver(s)
  if (doc === null) return null
  const beats = doc.beats
  const last = beats[beats.length - 1]!
  const run = beats.filter((b) => b.run === last.run)
  const first = run[0] ?? last
  let longestGap = 0
  for (let i = 1; i < run.length; i += 1) longestGap = Math.max(longestGap, (run[i]?.at ?? 0) - (run[i - 1]?.at ?? 0))
  const silence = Math.max(0, s.now - last.at)
  const placed = [...run].reverse().find((b) => b.stage !== null) ?? last
  const where = [placed.stage, placed.slice].filter((v): v is string => v !== null && v !== '').join(' ')
  const parts = ['wf', 'run ' + last.run]
  if (where !== '') parts.push(where)
  if (last.agent !== null && last.agent !== '') parts.push('agent ' + last.agent)
  parts.push(nf.duration(Math.max(0, s.now - first.at)))
  parts.push('last beat ' + nf.duration(silence) + ' ago')
  const alive = silence <= Math.max(longestGap, DEAD_FLOOR_MS)
  return {
    alive,
    line: parts.join(' · '),
    deadText: `presumed dead · silent ${nf.duration(silence)} · last: ${where !== '' ? where : last.event}`,
    aliveText: `alive · last beat ${nf.duration(silence)} ago`,
  }
}

function reviewCountFor(s: State, slug: string): number | null {
  const files = s.reviewDocs.filter((f) => f.slug === slug)
  if (files.length === 0) return null
  const doc = s.wfDocs.find((d) => d.slug === slug)
  const raw = doc !== undefined ? doc.fm['selected-slice'] : undefined
  const ledger = reviewLedgerOf(files, raw !== undefined && raw !== '' ? raw : null)
  if (ledger === null) return null
  return openFindingsOf(ledger.text)
}

// ---------------------------------------------------------------- elements

const N_ELS: ElementDef[] = [
  { id: 'a-agent-ctx', family: 'agents', label: 'agent context', about: 'the context fill percent of one agent loop', kind: 'meter', variants: [{ id: 'usage', label: 'payload usage' }], outcome: 'N', reason: 'полный производитель agent usage/contextWindowSize в цензе не установлен', catalogue: ['E131'], sample: '◐ 23%' },
  { id: 'a-mood', family: 'session', label: 'mood', about: 'the assistant mood face from an external stop recipe', kind: 'text', variants: [{ id: 'face', label: 'face' }], outcome: 'N', reason: 'mood.txt создаёт внешний Stop-рецепт; такой источник в статус-моде не объявлен', catalogue: ['E139'], sample: '愉快 („ᵕᴗᵕ„)' },
  { id: 'a-agent-journal-time', family: 'agents', label: 'journal agent time', about: 'an agent run elapsed from the workflow journal', kind: 'text', variants: [{ id: 'elapsed', label: 'elapsed' }], outcome: 'N', reason: N_REASON_FLOWPANE, catalogue: ['E254'], sample: '1m 23s' },
  { id: 'a-agent-journal-tokens', family: 'agents', label: 'journal agent tokens', about: 'an agent run tokens from the workflow journal', kind: 'text', variants: [{ id: 'tokens', label: 'tokens' }], outcome: 'N', reason: N_REASON_FLOWPANE, catalogue: ['E255'], sample: '820 tok' },
  { id: 'a-agent-journal-state', family: 'agents', label: 'journal agent state', about: 'done/running/failed/cut-off states of a journal run', kind: 'text', variants: [{ id: 'states', label: 'states' }], outcome: 'N', reason: N_REASON_FLOWPANE, catalogue: ['E256'], sample: '✔ 1 ✔ 2 ✖ 3' },
  { id: 'a-run-topology', family: 'workflow', label: 'run topology', about: 'the workflow run graph: phase columns, fan-out, loops, early stop', kind: 'text', variants: [{ id: 'graph', label: 'graph' }], outcome: 'N', reason: N_REASON_FLOWPANE, catalogue: ['E257'], sample: 'phases with barriers' },
  { id: 'a-run-tokens', family: 'workflow', label: 'run tokens', about: 'the tokens a workflow run spent, from the journal', kind: 'text', variants: [{ id: 'tokens', label: 'tokens' }], outcome: 'N', reason: N_REASON_FLOWPANE, catalogue: ['E258'], sample: '4.1k tok' },
  { id: 'a-run-tools', family: 'workflow', label: 'run tool calls', about: 'the tool calls of a workflow run, from the journal', kind: 'text', variants: [{ id: 'count', label: 'count' }], outcome: 'N', reason: N_REASON_FLOWPANE, catalogue: ['E259'], sample: '37 calls' },
  { id: 'a-run-models', family: 'workflow', label: 'run models', about: 'the models a workflow run used, from the journal', kind: 'text', variants: [{ id: 'models', label: 'models' }], outcome: 'N', reason: N_REASON_FLOWPANE, catalogue: ['E260'], sample: 'glm-5.3 · grok-4.7' },
  { id: 'a-agent-io', family: 'agents', label: 'agent tool io', about: 'the tool input and result of a journal agent, on demand', kind: 'text', variants: [{ id: 'tabs', label: 'tabs' }], outcome: 'N', reason: N_REASON_FLOWPANE, catalogue: ['E261'], sample: 'input / result tabs' },
  { id: 'a-runs', family: 'workflow', label: 'other runs', about: 'the other runs of this session grouped by state', kind: 'text', variants: [{ id: 'list', label: 'list' }], outcome: 'N', reason: N_REASON_FLOWPANE, catalogue: ['E262'], sample: '2 done · 1 running' },
  { id: 'a-nested-wf', family: 'workflow', label: 'nested workflow', about: 'a nested workflow run as its own node', kind: 'text', variants: [{ id: 'node', label: 'node' }], outcome: 'N', reason: N_REASON_FLOWPANE, catalogue: ['E263'], sample: '▸ 23 agents' },
  { id: 'a-xray-filter', family: 'system', label: 'xray filter', about: 'the runtime x-ray filter switch', kind: 'text', variants: [{ id: 'value', label: 'value' }], outcome: 'N', reason: 'private filter xray не настройка статус-мода', catalogue: ['E452'], sample: 'filter=tools' },
]

const ELEMENTS: ElementDef[] = [
  {
    id: 'a-agents',
    family: 'agents',
    label: 'agents',
    about: 'one row per known agent: type, name, task, life, current tool and tokens',
    kind: 'list',
    variants: [
      { id: 'rows', label: 'rows' },
      { id: 'full', label: 'full rows', catalogue: ['E247', 'E248', 'E249'] },
    ],
    options: [
      { key: 'maxRows', label: 'max rows', kind: 'int', min: 1, max: 10, step: 1, default: 5 },
      { key: 'detail', label: 'detail', kind: 'choice', choices: [{ id: 'compact', label: 'compact' }, { id: 'full', label: 'full' }], default: 'compact' },
    ],
    outcome: 'C',
    catalogue: ['E130', 'E132', 'E234', 'E236', 'E237', 'E238', 'E239', 'E240', 'E241', 'E242', 'E243', 'E244', 'E245', 'E246', 'E250', 'E251'],
    sample: '◐ glm-executor "delta critic" 1m23s · Bash 12s ×5',
  },
  {
    id: 'a-waiting',
    family: 'agents',
    label: 'waiting',
    about: 'the loops that wait on the person right now',
    kind: 'text',
    variants: [
      { id: 'count', label: 'count', catalogue: ['E252'] },
      { id: 'who', label: 'who', catalogue: ['E235'] },
    ],
    outcome: 'C',
    catalogue: [],
    sample: '1 agents waiting for approval',
  },
  {
    id: 'a-session-status',
    family: 'session',
    label: 'session status',
    about: 'the main loop right now: busy, idle or waiting on the person',
    kind: 'text',
    variants: [
      { id: 'dict', label: 'dict', catalogue: ['E170'] },
      { id: 'root', label: 'root', catalogue: ['E253'] },
    ],
    outcome: 'C',
    catalogue: [],
    sample: 'WAITING',
  },
  {
    id: 'a-turn-num',
    family: 'session',
    label: 'turn',
    about: 'which turn the session is on',
    kind: 'text',
    variants: [
      { id: 'count', label: 'own marks', catalogue: ['E171'] },
      { id: 'messages', label: 'user messages' },
    ],
    outcome: 'C',
    catalogue: [],
    sample: 'turn 14',
  },
  {
    id: 'a-turn-time',
    family: 'session',
    label: 'turn time',
    about: 'how long the current (or last) turn has run',
    kind: 'text',
    variants: [{ id: 'live', label: 'live' }],
    outcome: 'C',
    catalogue: ['E172'],
    sample: '2m 05s',
  },
  {
    id: 'a-compact',
    family: 'session',
    label: 'compacts',
    about: 'compactions seen as a message-count collapse while the session stayed itself',
    kind: 'text',
    variants: [{ id: 'count', label: 'count' }],
    outcome: 'C',
    catalogue: ['E138'],
    sample: '2 compacts · last 4m ago',
  },
  {
    id: 'a-questions',
    family: 'session',
    label: 'questions',
    about: 'how many AskUserQuestion calls the session has made',
    kind: 'text',
    variants: [
      { id: 'count', label: 'count', catalogue: ['E538'] },
      { id: 'floor', label: 'floor' },
    ],
    outcome: 'C',
    catalogue: [],
    sample: 'question 3, floor 20',
  },
  {
    id: 'a-shell-blocks',
    family: 'session',
    label: 'shell blocks',
    about: 'the shell command fences of the last answer, read and never run',
    kind: 'text',
    variants: [
      { id: 'count', label: 'count', catalogue: ['E307'] },
      { id: 'last', label: 'last' },
    ],
    outcome: 'C',
    catalogue: [],
    sample: 'ls -la …',
  },
  {
    id: 'a-tools-time',
    family: 'tools',
    label: 'time in tools',
    about: 'the wall time tool calls have taken: exact agent envelopes plus bounded main spans',
    kind: 'text',
    variants: [{ id: 'total', label: 'total' }],
    outcome: 'C',
    catalogue: ['E418'],
    sample: '~3h 12m in tools',
  },
  {
    id: 'a-tools-chars',
    family: 'tools',
    label: 'chars from tools',
    about: 'the characters tool results have returned, summed over the transcript snapshot',
    kind: 'text',
    variants: [{ id: 'total', label: 'total' }],
    outcome: 'C',
    catalogue: ['E419'],
    sample: '410k chars from tools',
  },
  {
    id: 'a-cpu',
    family: 'system',
    label: 'process cpu',
    about: 'the percent CPU of the claude processes of this machine',
    kind: 'meter',
    variants: [{ id: 'sum', label: 'sum' }],
    outcome: 'C',
    catalogue: ['E175'],
    sample: '17.5% cpu',
  },
  {
    id: 'a-events',
    family: 'system',
    label: 'events',
    about: 'the observed event stream: totals, errors, subagents, unknown names',
    kind: 'text',
    variants: [
      { id: 'xray', label: 'xray' },
      { id: 'events', label: 'events', catalogue: ['E448'] },
      { id: 'errors', label: 'errors', catalogue: ['E449'] },
      { id: 'subagents', label: 'subagents', catalogue: ['E450'] },
      { id: 'unknown', label: 'unknown', catalogue: ['E451'] },
    ],
    outcome: 'C',
    catalogue: [],
    sample: 'events=214 errors=3 subagents=7 unknown=0',
  },
  {
    id: 'a-event-ring',
    family: 'system',
    label: 'event ring',
    about: 'the last observed events with their ages',
    kind: 'list',
    variants: [{ id: 'rows', label: 'rows' }],
    options: [{ key: 'maxRows', label: 'max rows', kind: 'int', min: 1, max: 8, step: 1, default: 5 }],
    outcome: 'C',
    catalogue: ['E453'],
    sample: 'tool.call Bash · 4s ago',
  },
  {
    id: 'a-wf-count',
    family: 'workflow',
    label: 'workflows',
    about: 'how many sdlc workflows live under .ai/workflows and when the snapshot was taken',
    kind: 'text',
    variants: [
      { id: 'count', label: 'count', catalogue: ['E550'] },
      { id: 'header', label: 'header', catalogue: ['E551'] },
    ],
    outcome: 'C',
    catalogue: [],
    sample: '12 workflows · generated 2026-09-24 18:04',
  },
  {
    id: 'a-wf-groups',
    family: 'workflow',
    label: 'workflow groups',
    about: 'the dashboard buckets: active, recently shipped, closed, quick, and the blocker tiles',
    kind: 'list',
    variants: [
      { id: 'sections', label: 'sections', catalogue: ['E552', 'E553', 'E554', 'E555'] },
      { id: 'tiles', label: 'tiles', catalogue: ['E556', 'E557'] },
    ],
    outcome: 'C',
    catalogue: [],
    sample: 'Active 4 · Blockers 2',
  },
  {
    id: 'a-wf-rows',
    family: 'workflow',
    label: 'workflow rows',
    about: 'one ledger row per workflow: title, slug, description, stage, health, age',
    kind: 'list',
    variants: [
      { id: 'ledger', label: 'ledger' },
      { id: 'brief', label: 'brief' },
    ],
    options: [{ key: 'maxRows', label: 'max rows', kind: 'int', min: 1, max: 20, step: 1, default: 8 }],
    outcome: 'C',
    catalogue: ['E558', 'E559', 'E560', 'E561', 'E562', 'E563'],
    sample: 'Status mod · verify · ◉ active · 10m ago',
  },
  {
    id: 'a-wf-project',
    family: 'workflow',
    label: 'project context',
    about: 'the fixed project-context documents with their type and status',
    kind: 'list',
    variants: [{ id: 'rows', label: 'rows' }],
    outcome: 'C',
    catalogue: ['E564', 'E565', 'E566', 'E567'],
    sample: 'PRODUCT.md · project-context · draft',
  },
  {
    id: 'a-wf-branches',
    family: 'workflow',
    label: 'branch groups',
    about: 'active workflows that share a git branch, with the batch-readiness chip',
    kind: 'list',
    variants: [{ id: 'groups', label: 'groups' }],
    outcome: 'C',
    catalogue: ['E568', 'E569'],
    sample: '⎇ feat/sl-05 · 3 slugs · 2/3 ready',
  },
  {
    id: 'a-wf-stages',
    family: 'workflow',
    label: 'stage progress',
    about: 'the ten-stage swimlane per workflow, its blockers and its revision',
    kind: 'list',
    variants: [
      { id: 'swim', label: 'swimlane', catalogue: ['E570'] },
      { id: 'blockers', label: 'blockers', catalogue: ['E571'] },
      { id: 'rev', label: 'revision', catalogue: ['E572'] },
    ],
    options: [{ key: 'maxRows', label: 'max rows', kind: 'int', min: 1, max: 20, step: 1, default: 8 }],
    outcome: 'C',
    catalogue: [],
    sample: 'sl-05 ●●●●●◐○○○○ 6/10',
  },
  {
    id: 'a-driver',
    family: 'workflow',
    label: 'driver',
    about: 'the newest driver run: place, agent, elapsed, last beat, and whether it is presumed dead',
    kind: 'text',
    variants: [
      { id: 'line', label: 'line', catalogue: ['E541', 'E542', 'E543', 'E544', 'E545', 'E546'] },
      { id: 'dead', label: 'dead', catalogue: ['E547'] },
    ],
    outcome: 'C',
    catalogue: [],
    sample: 'wf · run r-9 · verify s2 · agent glm · 41m · last beat 2m ago',
  },
  {
    id: 'a-stage-check',
    family: 'workflow',
    label: 'stage check',
    about: 'the /wf turns that ended without writing the artifact their stage owes',
    kind: 'list',
    variants: [{ id: 'misses', label: 'misses' }],
    outcome: 'C',
    catalogue: ['E548'],
    sample: 'wf: implement ended without 05-implement-s2.md',
  },
  {
    id: 'a-next-step',
    family: 'workflow',
    label: 'next step',
    about: 'the next invocation of the newest-updated live workflow',
    kind: 'text',
    variants: [{ id: 'next', label: 'next' }],
    outcome: 'C',
    catalogue: ['E549'],
    sample: '/wf verify sl-05 s2',
  },
  {
    id: 'a-findings',
    family: 'workflow',
    label: 'open findings',
    about: 'the open findings of a workflow review ledger: open, deferred, could-not-fix, absent',
    kind: 'text',
    variants: [
      { id: 'active', label: 'active workflow', catalogue: ['E539'] },
      { id: 'each', label: 'each workflow' },
    ],
    outcome: 'C',
    catalogue: [],
    sample: 'sl-05 open findings 3',
  },
  {
    id: 'a-ship-blockers',
    family: 'workflow',
    label: 'ship-plan blockers',
    about: 'the open BLOCKER and HIGH rows of .ai/ship-plan-audit.md',
    kind: 'text',
    variants: [{ id: 'count', label: 'count' }],
    outcome: 'C',
    catalogue: ['E540'],
    sample: 'ship-plan blockers 2',
  },
  {
    id: 'a-wf-cost',
    family: 'workflow',
    label: 'workflow cost',
    about: 'the per-slug ledger of cost.jsonl: turns, sub-agents, external calls, token columns',
    kind: 'list',
    variants: [
      { id: 'table', label: 'table', catalogue: ['E573', 'E574', 'E575'] },
      { id: 'tokens', label: 'tokens', catalogue: ['E576', 'E577'] },
      { id: 'external', label: 'external', catalogue: ['E578', 'E579'] },
    ],
    options: [{ key: 'maxRows', label: 'max rows', kind: 'int', min: 1, max: 20, step: 1, default: 10 }],
    outcome: 'C',
    catalogue: [],
    sample: 'sl-05 · 14 turns · 6 sub-agents · 2 external',
  },
  ...N_ELS,
]

const PS: Source = { kind: 'cmd', argv: ['ps', '-Axo', '%cpu=,rss=,command='], everyMs: 5000 }
const FIND_INDEX: Source = { kind: 'cmd', argv: ['find', '.ai/workflows', '-maxdepth', '2', '-name', '00-index.md', '-print', '-exec', 'cat', '{}', ';'], everyMs: 10000, cwd: 'project' }
const FIND_DRIVER: Source = { kind: 'cmd', argv: ['find', '.ai/workflows', '-maxdepth', '2', '-name', '.driver-journal.jsonl', '-print', '-exec', 'cat', '{}', ';'], everyMs: 10000, cwd: 'project' }
const FIND_COST: Source = { kind: 'cmd', argv: ['find', '.ai/workflows', '-maxdepth', '2', '-name', 'cost.jsonl', '-print', '-exec', 'cat', '{}', ';'], everyMs: 30000, cwd: 'project' }
const FIND_REVIEW: Source = { kind: 'cmd', argv: ['find', '.ai/workflows', '-maxdepth', '2', '(', '-name', '07-review*.yaml', '-o', '-name', '07-review*.md', ')', '-print', '-exec', 'cat', '{}', ';'], everyMs: 30000, cwd: 'project' }
const AG_EVENTS = ['a-agents', 'a-waiting', 'a-events', 'a-event-ring', 'ag']

const SOURCES: { source: Source; elements: string[] }[] = [
  { source: { kind: 'event', event: 'session.start' }, elements: ['a-session-status', 'a-events', 'a-event-ring'] },
  { source: { kind: 'event', event: 'turn.start' }, elements: ['a-session-status', 'a-turn-num', 'a-turn-time', 'a-stage-check', 'a-events', 'a-event-ring'] },
  { source: { kind: 'event', event: 'turn.step' }, elements: ['a-compact', 'a-agents', 'a-events', 'a-event-ring'] },
  { source: { kind: 'event', event: 'turn.complete' }, elements: ['a-session-status', 'a-turn-time', 'a-shell-blocks', 'a-agents', 'a-stage-check', 'a-tools-time', 'a-events', 'a-event-ring'] },
  { source: { kind: 'event', event: 'tool.call' }, elements: [...AG_EVENTS, 'a-questions', 'a-tools-time', 'a-stage-check'] },
  { source: { kind: 'event', event: 'agent.spawn' }, elements: [...AG_EVENTS] },
  { source: { kind: 'event', event: 'config.set' }, elements: ['a-events', 'a-event-ring'] },
  { source: { kind: 'session', call: 'messages' }, elements: ['a-agents', 'ag', 'a-turn-num', 'a-tools-chars', 'a-tools-time', 'a-events'] },
  { source: { kind: 'session', call: 'usage' }, elements: ['a-compact'] },
  { source: PS, elements: ['a-cpu'] },
  { source: FIND_INDEX, elements: ['a-wf-count', 'a-wf-groups', 'a-wf-rows', 'a-wf-branches', 'a-wf-stages', 'a-next-step', 'a-findings'] },
  { source: FIND_DRIVER, elements: ['a-driver'] },
  { source: FIND_COST, elements: ['a-wf-cost'] },
  { source: FIND_REVIEW, elements: ['a-findings'] },
  { source: { kind: 'file', path: '.ai/ship-plan-audit.md', everyMs: 30000, relativeTo: 'project' }, elements: ['a-ship-blockers'] },
  ...PROJECT_SLOTS.map((slot): { source: Source; elements: string[] } => ({ source: { kind: 'file', path: slot.path, everyMs: 30000, relativeTo: 'project' }, elements: ['a-wf-project'] })),
  { source: { kind: 'clock', everyMs: 1000 }, elements: ['a-agents', 'ag', 'a-waiting', 'a-turn-time', 'a-driver', 'a-event-ring', 'a-tools-time', 'a-stage-check', 'a-compact'] },
]

// ---------------------------------------------------------------- value

function value(s: State, elementId: string, a: FormatArgs): Value {
  const nf = a.nf
  const known = s.agents.size
  const running = [...s.agents.values()].filter((r) => r.status === 'running' || r.status === 'unknown').length
  const completed = [...s.agents.values()].filter((r) => r.status === 'completed').length
  const failed = [...s.agents.values()].filter((r) => r.status === 'failed').length
  const unlisted = [...s.agents.values()].filter((r) => !r.listed).length
  const waitingTools = waitingLoops(s)

  if (elementId === 'ag') {
    if (!s.eventsSeen) return { state: 'pending' }
    if (a.variant === 'flow') return ok(`Agent flow · ${nf.count(known)} agents · ${nf.count(running)} running · ${nf.count(waitingTools.length)} waiting · ${nf.count(unlisted)} unlisted`, { at: s.now })
    if (a.variant === 'router') return ok(`${nf.count(running)} running · ${nf.count(completed)} completed · ${nf.count(failed)} failed`, { at: s.now })
    return { state: 'pending' }
  }
  if (elementId === 'a-agents') {
    return wrapEvents(s, () => {
      const rows = agentsList(s).slice(0, optInt(a, 'maxRows', 5)).map((rec) => agentRow(rec, s, a))
      return ok(rows.length === 0 ? 'no agents' : 'agents ' + nf.count(known), { rows, num: known, unit: 'count', at: s.now })
    })
  }
  if (elementId === 'a-waiting') {
    return wrapEvents(s, () => {
      if (a.variant === 'who') return ok(waitingTools.length === 0 ? 'nobody waiting' : 'waiting for approval: ' + waitingTools.join(', '), { at: s.now })
      return ok(waitingTools.length === 0 ? 'none waiting' : `${nf.count(waitingTools.length)} agents waiting for approval`, { num: waitingTools.length, unit: 'count', at: s.now })
    })
  }
  if (elementId === 'a-session-status') {
    return wrapEvents(s, () => {
      if (a.variant === 'root') return ok(s.busy ? 'busy' : 'idle', { at: s.now })
      return ok(waitingTools.length > 0 ? 'WAITING' : s.busy ? 'busy' : 'idle', { at: s.now })
    })
  }
  if (elementId === 'a-turn-num') {
    return wrapEvents(s, () => {
      const count = a.variant === 'messages' ? s.userMessages : s.turnNum
      return ok('turn ' + nf.count(count), { num: count, unit: 'count', at: s.now })
    })
  }
  if (elementId === 'a-turn-time') {
    const live = s.turnStartAt !== undefined ? s.now - s.turnStartAt : s.lastTurnMs
    if (live === undefined) return { state: 'pending' }
    return ok(nf.duration(Math.max(0, live)), { num: live, unit: 'ms', at: s.now })
  }
  if (elementId === 'a-compact') {
    if (s.maxCount === undefined) return { state: 'pending' }
    if (s.compacts === 0) return ok('no compact seen', { num: 0, unit: 'count', at: s.now })
    const age = s.compactLastAt !== undefined ? s.now - s.compactLastAt : 0
    return ok(`${nf.count(s.compacts)} compacts · last ${nf.duration(Math.max(0, age))} ago`, { num: s.compacts, unit: 'count', at: s.now })
  }
  if (elementId === 'a-questions') {
    if (s.questions === 0 && !s.eventsSeen) return { state: 'pending' }
    if (a.variant === 'floor') return ok(s.questions === 0 ? 'no questions yet' : `(question ${nf.count(s.questions)}, floor ${QUESTION_FLOOR})`, { num: s.questions, unit: 'count', at: s.now })
    return ok(`${nf.count(s.questions)} questions`, { num: s.questions, unit: 'count', at: s.now })
  }
  if (elementId === 'a-shell-blocks') {
    if (s.answerText === undefined) return { state: 'pending' }
    const blocks = shellBlocksOf(s.answerText)
    if (a.variant === 'last') return ok(blocks.length === 0 ? 'no shell block' : cut(blocks[blocks.length - 1]![0] ?? '', 24), { num: blocks.length, unit: 'count', at: s.now })
    return ok(`${nf.count(blocks.length)} shell blocks`, { num: blocks.length, unit: 'count', at: s.now })
  }
  if (elementId === 'a-tools-time') {
    if (!s.eventsSeen) return { state: 'pending' }
    const runningMs = s.mainTool !== undefined && s.mainTool.end === undefined ? Math.max(0, s.now - s.mainTool.start) : 0
    const total = s.mainBoundedMs + s.agentExactMs + runningMs
    const bounded = s.mainBoundedMs > 0 || runningMs > 0
    return ok((bounded ? '~' : '') + nf.duration(total) + ' in tools', { num: total, unit: 'ms', at: s.now })
  }
  if (elementId === 'a-tools-chars') {
    if (!s.messagesSeen) return { state: 'pending' }
    return ok(`${nf.count(s.chars)} chars from tools`, { num: s.chars, unit: 'count', at: s.now })
  }
  if (elementId === 'a-cpu') {
    return wrap(s.ps, () => {
      const cpu = s.psCpu ?? 0
      return ok(nf.percent(cpu / 100) + ' cpu', { num: cpu, unit: 'percent', ratio: cpu / 100, at: s.ps.at ?? s.now })
    })
  }
  if (elementId === 'a-events') {
    return wrapEvents(s, () => {
      const errors = s.errorResults + s.turnErrors
      if (a.variant === 'events') return ok(`${nf.count(s.events)} events`, { num: s.events, unit: 'count', at: s.now })
      if (a.variant === 'errors') return ok(`${nf.count(errors)} errors`, { num: errors, unit: 'count', at: s.now })
      if (a.variant === 'subagents') return ok(`${nf.count(known)} subagents`, { num: known, unit: 'count', at: s.now })
      if (a.variant === 'unknown') return ok(`${nf.count(s.unknownNames.size)} unknown events`, { num: s.unknownNames.size, unit: 'count', at: s.now })
      return ok(`events=${nf.count(s.events)} errors=${nf.count(errors)} subagents=${nf.count(known)} unknown=${nf.count(s.unknownNames.size)}`, { at: s.now })
    })
  }
  if (elementId === 'a-event-ring') {
    return wrapEvents(s, () => {
      const rows: Row[] = s.ring.slice(-optInt(a, 'maxRows', 5)).map((entry) => ({ icon: 'info' as const, label: entry.event, detail: entry.note === '' ? undefined : entry.note, right: nf.duration(Math.max(0, s.now - entry.at)) + ' ago' }))
      return ok('ring ' + nf.count(s.ring.length), { rows, num: s.ring.length, unit: 'count', at: s.now })
    })
  }
  if (elementId === 'a-wf-count') {
    return wrap(s.wf, () => {
      const count = s.wfDocs.length
      if (a.variant === 'header') {
        const at = s.wf.at ?? s.now
        return ok(`${nf.count(count)} workflows · generated ${new Date(at).toISOString().slice(0, 16).replace('T', ' ')}`, { num: count, unit: 'count', at })
      }
      return ok(`${nf.count(count)} workflows`, { num: count, unit: 'count', at: s.wf.at ?? s.now })
    })
  }
  if (elementId === 'a-wf-groups') {
    return wrap(s.wf, () => {
      const pipeline = s.wfDocs.filter(isPipeline)
      if (a.variant === 'tiles') {
        const active = pipeline.filter(isActiveWf)
        const blockers = active.reduce((acc, doc) => acc + blockerCountOf(doc.fm), 0)
        const rows: Row[] = [
          { icon: 'run', label: 'Active', right: nf.count(active.length) },
          { icon: blockers > 0 ? 'fail' : 'ok', label: 'Blockers', right: nf.count(blockers) },
        ]
        return ok('Active ' + nf.count(active.length) + ' · Blockers ' + nf.count(blockers), { rows, at: s.wf.at ?? s.now })
      }
      const sections: [string, WfDoc[]][] = [
        ['Active', pipeline.filter(isActiveWf)],
        ['Recently shipped', pipeline.filter(isShipped)],
        ['Closed', pipeline.filter(isClosedWf)],
        ['Quick', s.wfDocs.filter((d) => !isPipeline(d))],
      ]
      const rows: Row[] = sections.filter(([, docs]) => docs.length > 0).map(([label, docs]) => ({ icon: label === 'Active' ? ('run' as const) : ('ok' as const), label, right: nf.count(docs.length) }))
      return ok(rows.map((r) => r.label + ' ' + (r.right ?? '')).join(' · '), { rows, at: s.wf.at ?? s.now })
    })
  }
  if (elementId === 'a-wf-rows') {
    return wrap(s.wf, () => {
      const docs = [...s.wfDocs].sort(byNewest)
      const rows: Row[] = docs.slice(0, optInt(a, 'maxRows', 8)).map((doc) => {
        const stage = doc.fm['current-stage'] ?? 'intake'
        const health = healthOf(doc.fm)
        const updated = Date.parse(doc.fm['updated-at'] ?? '')
        const age = Number.isFinite(updated) ? nf.duration(Math.max(0, (s.wf.at ?? s.now) - updated)) + ' ago' : ''
        const right = [stage, `${health.glyph} ${health.label}`, age].filter((p) => p !== '').join(' · ')
        const icon = health.label === 'blocked' ? ('fail' as const) : ('ok' as const)
        if (a.variant === 'brief') return { icon, label: doc.slug, right }
        return { icon, label: doc.fm['title'] ?? doc.slug, detail: doc.fm['description'] !== undefined ? cut(doc.fm['description'], 40) : undefined, right }
      })
      return ok('workflows ' + nf.count(docs.length), { rows, num: docs.length, unit: 'count', at: s.wf.at ?? s.now })
    })
  }
  if (elementId === 'a-wf-project') {
    const present = s.project.filter((p) => p.snap.ok)
    if (present.length === 0) {
      if (!s.project.some((p) => p.snap.seen)) return { state: 'pending' }
      return { state: 'nosource', reason: 'no project-context documents (PRODUCT.md, DESIGN.md, .ai/ship-plan.md, .ai/observability*.md)' }
    }
    const rows: Row[] = present.map((p) => ({ icon: 'info' as const, label: p.path, right: `${p.type} · ${p.fm['status'] ?? ''}` }))
    return ok('project context ' + nf.count(present.length), { rows, num: present.length, unit: 'count', at: Math.max(...present.map((p) => p.snap.at ?? 0)) })
  }
  if (elementId === 'a-wf-branches') {
    return wrap(s.wf, () => {
      const active = s.wfDocs.filter((d) => isPipeline(d) && isActiveWf(d)).sort(byNewest)
      const byBranch = new Map<string, WfDoc[]>()
      for (const doc of active) {
        const b = (doc.fm['branch'] ?? '').trim()
        if (b === '') continue
        const list = byBranch.get(b) ?? []
        list.push(doc)
        byBranch.set(b, list)
      }
      const rows: Row[] = []
      const done = new Set<string>()
      for (const doc of active) {
        const b = (doc.fm['branch'] ?? '').trim()
        if (b === '' || done.has(doc.slug)) continue
        const members = byBranch.get(b) ?? []
        if (members.length < 2) continue
        for (const m of members) done.add(m.slug)
        rows.push({ icon: 'info' as const, label: '⎇ ' + b, detail: nf.count(members.length) + ' slugs', right: readinessOf(members) })
      }
      return ok('branches ' + nf.count(rows.length), { rows, num: rows.length, unit: 'count', at: s.wf.at ?? s.now })
    })
  }
  if (elementId === 'a-wf-stages') {
    return wrap(s.wf, () => {
      const max = optInt(a, 'maxRows', 8)
      const pipeline = s.wfDocs.filter(isPipeline)
      const ordered = [...pipeline.filter(isActiveWf).sort(byNewest), ...pipeline.filter(isShipped).sort(byNewest)]
      if (a.variant === 'blockers') {
        const rows: Row[] = ordered
          .filter((doc) => isActiveWf(doc) && blockerCountOf(doc.fm) > 0)
          .slice(0, max)
          .map((doc) => {
            const b = blockerCountOf(doc.fm)
            return { icon: 'fail' as const, label: doc.slug, right: `${nf.count(b)} blocker${b === 1 ? '' : 's'}` }
          })
        return ok('blockers ' + nf.count(rows.length), { rows, at: s.wf.at ?? s.now })
      }
      if (a.variant === 'rev') {
        const rows: Row[] = ordered
          .filter((doc) => (doc.fm['revision-count'] ?? doc.fm['rev'] ?? '') !== '')
          .slice(0, max)
          .map((doc) => ({ icon: 'info' as const, label: doc.slug, right: 'rev ' + (doc.fm['revision-count'] ?? doc.fm['rev'] ?? '') }))
        return ok('revisions ' + nf.count(rows.length), { rows, at: s.wf.at ?? s.now })
      }
      const rows: Row[] = ordered.slice(0, max).map((doc) => {
        const shipped = isShipped(doc)
        const idx = stageIndexOf(doc, shipped)
        return {
          icon: shipped ? ('ok' as const) : blockerCountOf(doc.fm) > 0 ? ('fail' as const) : ('run' as const),
          label: doc.slug,
          detail: dotsOf(idx, shipped),
          right: `${nf.count(idx + 1)}/${nf.count(STAGES.length)}`,
        }
      })
      return ok('stages ' + nf.count(rows.length), { rows, at: s.wf.at ?? s.now })
    })
  }
  if (elementId === 'a-driver') {
    return wrap(s.driver, () => {
      const st = driverStatus(s, nf)
      if (st === null) return ok('no driver journal', { at: s.driver.at ?? s.now })
      if (a.variant === 'dead') return ok(st.alive ? st.aliveText : st.deadText, { at: s.driver.at ?? s.now })
      return ok(st.line, { at: s.driver.at ?? s.now })
    })
  }
  if (elementId === 'a-stage-check') {
    if (!s.eventsSeen) return { state: 'pending' }
    const rows: Row[] = s.misses.map((miss) => ({ icon: 'fail' as const, label: `wf: ${miss.key} ended without ${miss.artifact}`, right: nf.duration(Math.max(0, s.now - miss.at)) + ' ago' }))
    return ok(rows.length === 0 ? 'all stages landed' : `${nf.count(rows.length)} misses`, { rows, num: rows.length, unit: 'count', at: s.now })
  }
  if (elementId === 'a-next-step') {
    return wrap(s.wf, () => {
      const live = s.wfDocs.filter((d) => isPipeline(d) && isActiveWf(d) && (d.fm['next-invocation'] ?? '') !== '').sort(byNewest)
      const doc = live[0]
      return ok(doc === undefined ? 'no next step' : (doc.fm['next-invocation'] ?? ''), { at: s.wf.at ?? s.now })
    })
  }
  if (elementId === 'a-findings') {
    return wrap(s.review, () => {
      const activeCounts: { slug: string; count: number }[] = []
      const allCounts: { slug: string; count: number }[] = []
      for (const doc of [...s.wfDocs].sort(byNewest)) {
        const c = reviewCountFor(s, doc.slug)
        if (c === null) continue
        allCounts.push({ slug: doc.slug, count: c })
        if (isPipeline(doc) && isActiveWf(doc)) activeCounts.push({ slug: doc.slug, count: c })
      }
      if (a.variant === 'each') {
        const rows: Row[] = allCounts.map((c) => ({ icon: c.count > 0 ? ('fail' as const) : ('ok' as const), label: `${c.slug} open findings ${nf.count(c.count)}` }))
        return ok('findings ' + nf.count(allCounts.length), { rows, at: s.review.at ?? s.now })
      }
      const first = activeCounts[0] ?? allCounts[0]
      if (first === undefined) return ok('no review ledger', { at: s.review.at ?? s.now })
      return ok(`${first.slug} open findings ${nf.count(first.count)}`, { num: first.count, unit: 'count', at: s.review.at ?? s.now })
    })
  }
  if (elementId === 'a-ship-blockers') {
    return wrap(s.shipPlan, () => ok('ship-plan blockers ' + nf.count(s.shipPlanText !== undefined ? shipPlanBlockersOf(s.shipPlanText) : 0), { num: s.shipPlanText !== undefined ? shipPlanBlockersOf(s.shipPlanText) : 0, unit: 'count', at: s.shipPlan.at ?? s.now }))
  }
  if (elementId === 'a-wf-cost') {
    return wrap(s.cost, () => {
      const max = optInt(a, 'maxRows', 10)
      const docs = s.costDocs.filter((d) => d.rows.length > 0).sort((x, y) => (x.slug < y.slug ? -1 : 1)).slice(0, max)
      const total = emptyAgg()
      for (const doc of s.costDocs) {
        const agg = aggregateCost(doc.rows)
        total.turns += agg.turns
        total.subagents += agg.subagents
        total.external += agg.external
        total.input += agg.input
        total.output += agg.output
        total.cacheRead += agg.cacheRead
        total.cacheWrite += agg.cacheWrite
        total.externalInput += agg.externalInput
        total.externalOutput += agg.externalOutput
      }
      if (a.variant === 'tokens') {
        const rows: Row[] = docs.map((doc) => ({ icon: 'info' as const, label: doc.slug, right: `in ${nf.tokens(aggregateCost(doc.rows).input)} · out ${nf.tokens(aggregateCost(doc.rows).output)}` }))
        rows.push({ icon: 'ok' as const, label: 'total', right: `in ${nf.tokens(total.input)} · out ${nf.tokens(total.output)}` })
        return ok('tokens ' + nf.count(docs.length), { rows, at: s.cost.at ?? s.now })
      }
      if (a.variant === 'external') {
        const rows: Row[] = docs.map((doc) => {
          const agg = aggregateCost(doc.rows)
          return { icon: 'info' as const, label: doc.slug, right: `external in ${nf.tokens(agg.externalInput)} / out ${nf.tokens(agg.externalOutput)} (${nf.count(agg.external)})` }
        })
        rows.push({ icon: 'ok' as const, label: 'total', right: `external in ${nf.tokens(total.externalInput)} / out ${nf.tokens(total.externalOutput)} (${nf.count(total.external)})` })
        return ok('external ' + nf.count(docs.length), { rows, at: s.cost.at ?? s.now })
      }
      const rows: Row[] = docs.map((doc) => {
        const agg = aggregateCost(doc.rows)
        return { icon: 'info' as const, label: doc.slug, right: `${nf.count(agg.turns)} turns · ${nf.count(agg.subagents)} sub-agents · ${nf.count(agg.external)} external` }
      })
      rows.push({ icon: 'ok' as const, label: 'total', right: `${nf.count(total.turns)} turns · ${nf.count(total.subagents)} sub-agents · ${nf.count(total.external)} external` })
      return ok('cost ' + nf.count(docs.length), { rows, at: s.cost.at ?? s.now })
    })
  }
  const el = ELEMENTS.find((e) => e.id === elementId)
  if (el !== undefined && el.outcome === 'N') return { state: 'nosource', reason: el.reason ?? 'unavailable' }
  return { state: 'pending' }
}

const collector: Collector<State> = {
  family: 'agents',
  elements: ELEMENTS,
  sources: SOURCES,
  variantsFor: [
    {
      element: 'ag',
      variants: [
        { id: 'flow', label: 'agent flow', catalogue: ['E230', 'E231', 'E232', 'E233'] },
        { id: 'router', label: 'router counts', catalogue: ['E370', 'E371', 'E372'] },
      ],
    },
  ],
  init,
  reduce,
  value,
}

export default collector
