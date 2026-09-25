import type { Collector, ElementDef, FormatArgs, Input, Ok, Row, Value } from './types'

// Base family: the 27 elements of 0.4.0 plus the HUD elements of DESIGN Р2/Р8
// under their reserved ids. CONSTRAINT (types.ts): this module is pure — no `$`,
// no `on`, no I/O, no Date.now; time arrives in Input.now and formatting rides
// args.nf exclusively (a family never formats a number itself).
// CONSTRAINT: a source failure after a good read keeps the last figures and
// carries the reason (SPEC §10.4) — the age label is the 'stale' state itself.

type Ctx = { tokens?: number; window: number; percent?: number }
type LimitWin = { percentUsed: number; resetsAt?: string }

type GitRef = { branch: string; kind: 'branch' | 'detached'; at: number }

type ToolsState = {
  sawAny: boolean
  sawTurnComplete: boolean
  doneTotal: number
  errTotal: number
  active: Map<string, { name: string; target: string; agentScope: string }>
  byName: Map<string, number>
  capDropped: number
  done: { name: string; isError: boolean }[]
}

type AgentsState = {
  map: Map<string, { name: string; desc: string; model: string; status: string; at: number; doneAt: number }>
  done: string[]
}

type UsageState = {
  at: number
  context?: Ctx
  five?: LimitWin
  seven?: LimitWin
  cost?: number
  rl: { kind: string; percentUsed: number; resetsAt?: string }[]
  breakdown?: { input: number | null; cw: number | null; cr: number | null }
}

export type BaseState = {
  started: boolean
  interactive: boolean
  cwd: string
  root: string
  git: GitRef | null
  gitFail: string
  github: string | null
  model: string
  effort: string | number | undefined
  servedModel: string
  session: string
  resumed: boolean
  priorTurns: number
  durBase: number
  lastSessionId: string
  usage: UsageState | null
  usageFail: string
  ctxCarried: boolean
  // an interrupted turn answers the window with no count; only then the old
  // figure stands (measured live, SPEC §14.12-7) — a finished turn drops it
  abortCarry: boolean
  sum: { total: number; in: number; out: number; cache: number } | null
  speed: number | null
  ver: { text: string; installed: string } | null
  ram: { usedBytes: number; totalBytes: number; at: number; method: string } | null
  cfgFiles: { mdProject: number; mdHome: number; at: number } | null
  settings: { hk: number; style: string; at: number } | null
  settingsFail: string
  tools: ToolsState
  agents: AgentsState
  todo: { synced: boolean; done: number; total: number; current: string }
  seenTurns: string[]
  now: number
}

const CAP = { agents: 64, doneAgents: 8, doneQueue: 8, toolNames: 64, activeTools: 256, seenTurns: 256 }
const TODO_TOOLS = ['TodoWrite']

// Absent agentId is the main loop. The string 'main' is a child scope, not that.
export function agentScopeOf(agentId: unknown): string {
  return agentId == null ? 'm' : 'a:' + String(agentId)
}

function initTools(): ToolsState {
  return { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, active: new Map(), byName: new Map(), capDropped: 0, done: [] }
}

function initAgents(): AgentsState {
  return { map: new Map(), done: [] }
}

const ok = (text: string, extra: Partial<Ok> = {}): Ok => ({ state: 'ok', text, at: 0, ...extra })
const pend = (): Value => ({ state: 'pending' })
const stale = (last: Ok, reason: string): Value => ({ state: 'stale', last, reason })

function baseName(dir: string): string {
  const m = /([^/]+)\/?$/.exec(dir)
  return m ? m[1]! : dir
}

// The classic payload carries model.display_name; the mods API gives the id.
// claude-opus-5-5[1m] reads Opus 5.5 (owner, 2026-09-22): a context tag is not
// part of the name; a non-claude id is shown as it came.
export function displayName(id: string): string {
  const m = /^claude-([a-z]+)((?:-\d{1,3})*)(?:-\d{8})?(?:\[[0-9a-z]+\])?$/.exec(id)
  if (!m) return id
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1)
  const version = m[2]!.split('-').filter(Boolean).join('.')
  return version ? family + ' ' + version : family
}

export function shortModel(name: string): string {
  return name.startsWith('claude-') ? name.slice('claude-'.length) : name
}

function githubOf(remote: string): string | null {
  const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remote)
  return m ? m[1]! : null
}

function shortTarget(input: unknown): string {
  const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  for (const key of ['command', 'file_path', 'pattern', 'path', 'url', 'query']) {
    const v = i[key]
    if (typeof v === 'string' && v) return v.length > 24 ? v.slice(0, 21) + '…' : v
  }
  return ''
}

function applyTodos(src: unknown, s: BaseState): void {
  const o = src as { todos?: unknown[]; input?: { todos?: unknown[] } }
  const todos = (o && Array.isArray(o.todos) ? o.todos : null) ?? (o && o.input && Array.isArray(o.input.todos) ? o.input.todos : null)
  if (!todos) return
  let done = 0
  let current = ''
  for (const t of todos) {
    const status = String((t && (t as { status?: string }).status) || '')
    if (status === 'completed') done++
    if (!current && status === 'in_progress') current = String((t && (t as { content?: string }).content) || '').slice(0, 40)
  }
  s.todo = { synced: true, done, total: todos.length, current }
}

function readUsageInto(s: BaseState, usage: unknown, now: number): void {
  const u = usage && typeof usage === 'object' ? (usage as Record<string, unknown>) : null
  if (!u) {
    if (s.usage) s.usageFail = 'usage read returned nothing'
    return
  }
  const next: UsageState = { at: now, rl: [] }
  const c = u['context'] as Ctx | undefined
  if (c && typeof c === 'object' && Number.isFinite(c.window) && c.window > 0) {
    // an interrupted turn answers the window with no count: the old figure
    // stands, marked carried (measured live on 2.1.280, SPEC §14.12-7)
    const prior = s.usage?.context
    if (c.tokens === undefined && prior?.tokens !== undefined && s.abortCarry) {
      next.context = { ...c, tokens: prior.tokens, percent: prior.percent }
      s.ctxCarried = true
    } else {
      next.context = c
      if (c.tokens !== undefined) s.ctxCarried = false
    }
  } else if (s.usage?.context) {
    next.context = s.usage.context
    s.ctxCarried = true
  }
  const rls = Array.isArray(u['rateLimits']) ? (u['rateLimits'] as Record<string, unknown>[]) : []
  for (const w of rls) {
    if (!w || typeof w !== 'object') continue
    const kind = String(w['kind'] ?? '')
    const pct = Number(w['percentUsed'])
    if (!kind || !Number.isFinite(pct)) continue
    const win = { kind, percentUsed: pct, resetsAt: typeof w['resetsAt'] === 'string' ? w['resetsAt'] : undefined }
    if (kind === 'five_hour') next.five = win
    if (kind === 'seven_day') next.seven = win
    next.rl.push(win)
  }
  if (next.five === undefined && s.usage?.five) next.five = s.usage.five
  if (next.seven === undefined && s.usage?.seven) next.seven = s.usage.seven
  const cost = u['cost'] as { usd?: number } | undefined
  const usd = cost && typeof cost.usd === 'number' ? cost.usd : undefined
  next.cost = usd !== undefined ? usd : s.usage?.cost
  const b = c && typeof c === 'object' ? (c as { breakdown?: Record<string, unknown> }).breakdown : undefined
  if (b && typeof b === 'object') {
    const pick = (names: string[]): number | null => {
      for (const n of names) {
        const v = b[n]
        if (typeof v === 'number' && Number.isFinite(v)) return v
      }
      return null
    }
    const input = pick(['input_tokens', 'input', 'uncached_tokens'])
    const cw = pick(['cache_creation_input_tokens', 'cache_write', 'cache_creation'])
    const cr = pick(['cache_read_input_tokens', 'cache_read'])
    if (input !== null || cw !== null || cr !== null) next.breakdown = { input, cw, cr }
  }
  if (next.breakdown === undefined && s.usage?.breakdown) next.breakdown = s.usage.breakdown
  s.usage = next
  s.usageFail = ''
  s.abortCarry = false
}

function reduceEvent(s: BaseState, event: string, data: unknown, now: number): void {
  const e = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  if (event === 'session.start') {
    s.started = true
    s.interactive = e['isInteractive'] === true
    if (typeof e['cwd'] === 'string' && e['cwd']) s.cwd = e['cwd']
    const sid = typeof e['sessionId'] === 'string' ? e['sessionId'] : ''
    if (sid !== '' && sid !== s.lastSessionId) {
      s.durBase = now
      s.lastSessionId = sid
      s.tools.active.clear()
    } else if (s.durBase < 0) {
      s.durBase = now
    }
    return
  }
  if (event === 'turn.start') {
    if (s.durBase < 0) s.durBase = now
    return
  }
  if (event === 'turn.step') {
    if (e['agentId'] !== undefined) return
    const model = e['model']
    if (typeof model === 'string' && model) s.model = model
    const effort = e['effort']
    if (effort !== undefined && effort !== s.effort) s.effort = effort as string | number
    if (s.durBase < 0) s.durBase = now
    return
  }
  if (event === 'session.end') {
    s.tools.active.clear()
    return
  }
  if (event === 'turn.complete') {
    const scope = agentScopeOf(e['agentId'])
    for (const [key, rec] of s.tools.active) {
      if (rec.agentScope === scope) s.tools.active.delete(key)
    }
    if (s.durBase < 0) s.durBase = now
    s.tools.sawTurnComplete = true
    if (e['isAborted'] === true) s.abortCarry = true
    const key = (e['agentId'] ? String(e['agentId']) : 'main') + ':' + String(e['turnId'] ?? '')
    if (key === 'main:' || s.seenTurns.includes(key)) return
    s.seenTurns.push(key)
    while (s.seenTurns.length > CAP.seenTurns) s.seenTurns.shift()
    const uu = e['usage'] && typeof e['usage'] === 'object' ? (e['usage'] as Record<string, unknown>) : null
    if (!uu) return
    const f = [uu['input_tokens'], uu['output_tokens'], uu['cache_read_input_tokens'], uu['cache_creation_input_tokens']]
    // a missing operand does not participate as zero (SPEC §3.2)
    if (f.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const nums = f as number[]
      const total = nums.reduce((a, b) => a + b, 0)
      const prev = s.sum
      s.sum = {
        total: (prev?.total ?? 0) + total,
        in: (prev?.in ?? 0) + nums[0]!,
        out: (prev?.out ?? 0) + nums[1]!,
        cache: (prev?.cache ?? 0) + nums[2]! + nums[3]!,
      }
    }
    if (!e['agentId']) {
      if (typeof uu['model'] === 'string' && uu['model']) s.servedModel = uu['model'] as string
      const out = uu['output_tokens']
      const ms = e['durationMs']
      if (typeof out === 'number' && out > 0 && typeof ms === 'number' && ms > 0) s.speed = Math.round((out / (ms / 1000)) * 10) / 10
    } else {
      const a = s.agents.map.get(String(e['agentId']))
      if (a) {
        a.status = 'completed'
        a.doneAt = now
        if (typeof uu['model'] === 'string' && uu['model']) a.model = uu['model'] as string
        s.agents.done.push(String(e['agentId']))
        while (s.agents.done.length > CAP.doneAgents) s.agents.done.shift()
      }
    }
    return
  }
  if (event === 'tool.call') {
    // entry carries .tool; a result does not. Completion is callKey, never stack order.
    const callKey = typeof e['callKey'] === 'string' ? e['callKey'] : ''
    const name = typeof e['tool'] === 'string' ? e['tool'] : ''
    if (name) {
      s.tools.sawAny = true
      const target = shortTarget(e['input'])
      const agentScope = typeof e['agentScope'] === 'string' && e['agentScope'] !== '' ? e['agentScope'] : agentScopeOf(e['agentId'])
      if (callKey && (s.tools.active.has(callKey) || s.tools.active.size < CAP.activeTools)) {
        s.tools.active.set(callKey, { name, target, agentScope })
      } else if (callKey) {
        s.tools.capDropped++
      }
      if (TODO_TOOLS.includes(name)) applyTodos(e['todos'] !== undefined ? e['todos'] : e['input'], s)
      return
    }
    const isError = e['isError'] === true
    let finishedName = typeof e['callTool'] === 'string' && e['callTool'] !== '' ? e['callTool'] : ''
    if (callKey && s.tools.active.has(callKey)) {
      const rec = s.tools.active.get(callKey)!
      s.tools.active.delete(callKey)
      if (!finishedName) finishedName = rec.name
    }
    if (!finishedName) finishedName = '?'
    s.tools.doneTotal++
    if (finishedName !== '?' && (s.tools.byName.size < CAP.toolNames || s.tools.byName.has(finishedName))) {
      s.tools.byName.set(finishedName, (s.tools.byName.get(finishedName) ?? 0) + 1)
    }
    if (isError) s.tools.errTotal++
    else if (finishedName !== '?') {
      s.tools.done.push({ name: finishedName, isError: false })
      while (s.tools.done.length > CAP.doneQueue) s.tools.done.shift()
    }
    return
  }
  if (event === 'agent.spawn') {
    const agentId = typeof e['agentId'] === 'string' ? e['agentId'] : ''
    if (!agentId || s.agents.map.has(agentId)) return
    s.agents.map.set(agentId, {
      name: String(e['subagentType'] || e['name'] || ''),
      desc: String(e['description'] || ''),
      model: String(e['model'] || ''),
      status: 'running',
      at: now,
      doneAt: 0,
    })
    while (s.agents.map.size > CAP.agents) s.agents.map.delete(s.agents.map.keys().next().value as string)
    return
  }
  if (event === 'config.set') {
    if (typeof e['key'] === 'string' && e['key'].includes('effort') && (typeof e['value'] === 'string' || typeof e['value'] === 'number')) {
      s.effort = e['value'] as string | number
    }
    return
  }
}

function cmdText(data: unknown): string {
  const d = data as { stdout?: unknown } | undefined
  return typeof d?.stdout === 'string' ? d.stdout : ''
}

function reduceCmd(s: BaseState, argv: readonly string[], okFlag: boolean, data: unknown, error: string | undefined, now: number): void {
  const joined = argv.join(' ')
  if (joined === 'git rev-parse --abbrev-ref HEAD') {
    if (okFlag) {
      const t = cmdText(data).trim()
      if (t) {
        s.git = { branch: t === 'HEAD' ? cmdText(data).trim().slice(0, 7) : t, kind: t === 'HEAD' ? 'detached' : 'branch', at: now }
        s.gitFail = ''
        return
      }
      s.gitFail = 'git rev-parse answered nothing'
    } else {
      const msg = (error ?? '').toLowerCase()
      s.gitFail = msg.includes('not a git repository') || msg.includes('fatal: not a git') ? 'outside a git repository' : 'git rev-parse failed'
      if (s.gitFail === 'outside a git repository') s.git = null
    }
    return
  }
  if (joined === 'git config --get remote.origin.url') {
    if (okFlag) s.github = githubOf(cmdText(data).trim())
    return
  }
  if (joined === 'vm_stat' || joined === '/usr/bin/vm_stat') {
    const txt = cmdText(data)
    const ps = /page size of (\d+) bytes/.exec(txt)
    const active = /Pages active:\s+(\d+)/.exec(txt)
    const wired = /Pages wired down:\s+(\d+)/.exec(txt)
    if (okFlag && ps && active && wired) {
      const used = (Number(active[1]) + Number(wired[1])) * Number(ps[1])
      if (s.ram) s.ram = { ...s.ram, usedBytes: used, at: now, method: 'macos:active+wired' }
      else s.ram = { usedBytes: used, totalBytes: 0, at: now, method: 'macos:active+wired' }
    }
    return
  }
  if (joined === 'sysctl -n hw.memsize') {
    const total = Number(cmdText(data).trim())
    if (okFlag && Number.isFinite(total) && total > 0) {
      if (s.ram) s.ram = { ...s.ram, totalBytes: total, at: now }
      else s.ram = { usedBytes: 0, totalBytes: total, at: now, method: 'macos:sysctl' }
    }
    return
  }
  if (joined === 'claude --version') {
    if (okFlag) {
      const t = cmdText(data).trim().split(/\s+/)[0] ?? ''
      if (/^\d+\.\d+\.\d+/.test(t)) s.ver = s.ver ? { ...s.ver, text: t } : { text: t, installed: '' }
    }
    return
  }
}

function reduceFile(s: BaseState, path: string, okFlag: boolean, data: unknown, now: number, error?: string): void {
  if (path === '/proc/meminfo') {
    if (!okFlag || typeof data !== 'string') return
    const total = /^MemTotal:\s+(\d+)\s*kB/m.exec(data)
    const avail = /^MemAvailable:\s+(\d+)\s*kB/m.exec(data)
    if (total && avail) {
      const t = Number(total[1]) * 1024
      if (Number.isFinite(t) && t > 0) s.ram = { usedBytes: t - Number(avail[1]) * 1024, totalBytes: t, at: now, method: 'linux:memavailable' }
    }
    return
  }
  if (path === '.claude/settings.json') {
    if (!okFlag) {
      s.settingsFail = 'settings.json: ' + (typeof error === 'string' ? error : 'non-text error')
      return
    }
    if (typeof data !== 'string') {
      if (data !== undefined && data !== null) s.settingsFail = 'settings.json: not text'
      return
    }
    try {
      const parsed = JSON.parse(data) as { hooks?: Record<string, unknown[]>; outputStyle?: string; output_style?: string }
      let hk = 0
      // hooks are counted as COMMANDS, not event keys (SPEC §4.4)
      if (parsed.hooks && typeof parsed.hooks === 'object') for (const k of Object.keys(parsed.hooks)) {
        const arr = parsed.hooks[k]
        if (Array.isArray(arr)) hk += arr.length
      }
      const style = parsed.outputStyle ?? parsed.output_style
      s.settings = { hk, style: typeof style === 'string' && style ? style : 'default', at: now }
      s.settingsFail = ''
    } catch (err) {
      // A file that does not parse is a failed element, not a silent empty count.
      s.settingsFail = 'settings.json: ' + (err instanceof Error ? err.message : String(err))
    }
    return
  }
  if (path === 'CLAUDE.md' || path === '.claude/CLAUDE.md') {
    // the count is order-independent: each known path carries its own flag
    const has = okFlag && typeof data === 'string' && data.trim() !== '' ? 1 : 0
    const prev = s.cfgFiles ?? { mdProject: 0, mdHome: 0, at: now }
    if (path === 'CLAUDE.md') s.cfgFiles = { ...prev, mdProject: has, at: now }
    else s.cfgFiles = { ...prev, mdHome: has, at: now }
    return
  }
}

const el = (def: ElementDef): ElementDef => def

const ELEMENTS: ElementDef[] = [
  el({
    id: 'model', family: 'model', label: 'model', about: 'the main-loop model with its effort level and the served-model switch',
    kind: 'text', variants: [{ id: 'raw', label: 'raw id' }, { id: 'display', label: 'display name' }, { id: 'short', label: 'short badge' }],
    outcome: 'C', catalogue: ['model'], sample: 'Opus 5.5',
  }),
  el({
    id: 'route', family: 'model', label: 'route', about: 'the provider/route label — the source is not measured yet, the obligation stays visible',
    kind: 'text', variants: [{ id: 'label', label: 'label' }], outcome: 'N', reason: 'route label source OPEN (spec В5)', catalogue: ['route'], sample: 'via …',
  }),
  el({
    id: 'ctx', family: 'context', label: 'context', about: 'the context window fill: used tokens of the window with the fill ratio',
    kind: 'meter', variants: [{ id: 'used', label: 'used/window' }, { id: 'percent', label: 'percent' }, { id: 'remaining', label: 'remaining' }],
    outcome: 'C', catalogue: ['ctx'], sample: '231k/1.0M',
  }),
  el({
    id: 'brk', family: 'context', label: 'breakdown', about: 'token breakdown: input, cache write, cache read',
    kind: 'text', variants: [{ id: 'inline', label: 'in/cw/cr' }, { id: 'sum', label: 'sum only' }],
    outcome: 'C', catalogue: ['brk'], sample: 'in 42.1M cw 1.2M cr 18677.3M',
  }),
  el({
    id: 'sum', family: 'tokens', label: 'sum tokens', about: 'the sum of the turn tokens the session has used',
    kind: 'text', variants: [{ id: 'total', label: 'total' }], outcome: 'C', catalogue: ['sum'], sample: 'Σ 18822.7M',
  }),
  el({
    id: 'tokens-total', family: 'tokens', label: 'tokens total', about: 'session tokens itemized: total with in, out and cache shares',
    kind: 'text', variants: [{ id: 'itemized', label: 'in/out/cache' }, { id: 'total', label: 'total only' }],
    outcome: 'C', catalogue: ['tokens-total'], sample: 'Tokens 18822.7M (in: 42.1M, out: 103.2M, cache: 18677.3M)',
  }),
  el({
    id: 'spd', family: 'tokens', label: 'speed', about: 'the output speed of the last main-loop response',
    kind: 'text', variants: [{ id: 'last', label: 'last response' }], outcome: 'C', catalogue: ['spd'], sample: '25 tok/s',
  }),
  el({
    id: 'dur', family: 'session', label: 'duration', about: 'the time since the first observed activity of the session',
    kind: 'text', variants: [{ id: 'since-start', label: 'since start' }], outcome: 'C', catalogue: ['dur'], sample: '1655h 47m',
  }),
  el({
    id: 'cfg', family: 'files', label: 'config counts', about: 'instruction files and hook commands counted from the known config paths',
    kind: 'text', variants: [{ id: 'counts', label: 'counts' }], outcome: 'C', catalogue: ['cfg'], sample: '1 CLAUDE.md │ 9 hooks',
  }),
  el({
    id: 'style', family: 'files', label: 'style', about: 'the output style of the session settings',
    kind: 'text', variants: [{ id: 'name', label: 'name' }], outcome: 'C', catalogue: ['style'], sample: 'default',
  }),
  el({
    id: 'ver', family: 'system', label: 'version', about: 'the executing host version with the restart hint when the installed one differs',
    kind: 'text', variants: [{ id: 'plain', label: 'plain' }, { id: 'restart', label: 'with restart hint' }],
    outcome: 'C', catalogue: ['ver'], sample: 'CC v2.1.280',
  }),
  el({
    id: 'name', family: 'session', label: 'session name', about: 'the session name — the source is not measured yet, the obligation stays visible',
    kind: 'text', variants: [{ id: 'label', label: 'label' }], outcome: 'N', reason: 'session name source OPEN (spec row 7)', catalogue: ['name'], sample: 'nm …',
  }),
  el({
    id: 'rl', family: 'limits', label: 'rate limits', about: 'the rate-limit windows the usage reports, all of them in one line',
    kind: 'text', variants: [{ id: 'all', label: 'all windows' }, { id: 'five', label: '5h only' }, { id: 'seven', label: '7d only' }],
    outcome: 'C', catalogue: ['rl'], sample: '5h 25% 7d 61.5%',
  }),
  el({
    id: 'cost', family: 'cost', label: 'cost', about: 'the session cost in dollars',
    kind: 'text', variants: [{ id: 'usd', label: 'usd' }], outcome: 'C', catalogue: ['cost'], sample: '$6434.27',
  }),
  el({
    id: 'git', family: 'git', label: 'git', about: 'the branch (or the detached sha) in parentheses',
    kind: 'text', variants: [{ id: 'ref', label: '(branch)' }, { id: 'bare', label: 'branch alone' }],
    outcome: 'C', catalogue: ['git'], sample: '(main)',
  }),
  el({
    id: 'git-branch', family: 'git', label: 'repo(branch)', about: 'repo(branch), or the directory name outside a repository',
    kind: 'text', variants: [{ id: 'repo-ref', label: 'repo(branch)' }, { id: 'ref-only', label: 'branch only' }],
    outcome: 'C', catalogue: ['git-branch'], sample: 'Agents/claudeapp git:(main)',
  }),
  el({
    id: 'directory', family: 'project', label: 'directory', about: 'the name of the current directory',
    kind: 'text', variants: [{ id: 'name', label: 'name' }], outcome: 'C', catalogue: ['directory'], sample: 'src',
  }),
  el({
    id: 'branch', family: 'git', label: 'branch', about: 'the branch alone',
    kind: 'text', variants: [{ id: 'name', label: 'name' }], outcome: 'C', catalogue: ['branch'], sample: 'main',
  }),
  el({
    id: 'github', family: 'github', label: 'github', about: 'owner/name from the GitHub remote',
    kind: 'text', variants: [{ id: 'slug', label: 'owner/name' }], outcome: 'C', catalogue: ['github'], sample: 'konsta95/demo',
  }),
  el({
    id: 'five-hour-limit', family: 'limits', label: '5h', about: 'the five-hour rate-limit window with its reset',
    kind: 'text', variants: [{ id: 'pct', label: 'percent' }, { id: 'resets', label: 'with reset' }],
    outcome: 'C', catalogue: ['five-hour-limit'], sample: '5h 25%',
  }),
  el({
    id: 'weekly-limit', family: 'limits', label: '7d', about: 'the seven-day rate-limit window with its reset',
    kind: 'text', variants: [{ id: 'pct', label: 'percent' }, { id: 'resets', label: 'with reset' }],
    outcome: 'C', catalogue: ['weekly-limit'], sample: '7d 61.5%',
  }),
  el({
    id: 'session', family: 'session', label: 'session', about: 'the session id, short8 or full',
    kind: 'text', variants: [{ id: 'short8', label: 'short8' }, { id: 'full', label: 'full' }],
    outcome: 'C', catalogue: ['session'], sample: '4e1f0c9a',
  }),
  el({
    id: 'todo', family: 'session', label: 'todo', about: 'the current todo item with the progress',
    kind: 'text', variants: [{ id: 'current', label: 'current item' }, { id: 'progress', label: 'done/total' }],
    outcome: 'C', catalogue: ['todo'], sample: '▸ ЗОНТИЧНАЯ. Довести аудит… (317/494)',
  }),
  el({
    id: 'ag', family: 'agents', label: 'agents', about: 'agent loops, one row per agent: name, description, elapsed',
    kind: 'list', variants: [{ id: 'lines', label: 'row per agent' }, { id: 'counts', label: 'counts only' }],
    options: [
      { key: 'maxRows', label: 'максимум строк', kind: 'int', min: 1, max: 8, default: 3 },
      { key: 'order', label: 'порядок', kind: 'choice', choices: [{ id: 'running-first', label: 'сначала идущие' }, { id: 'newest-first', label: 'сначала новые' }], default: 'running-first' },
    ],
    outcome: 'C', catalogue: ['ag'], sample: '✓ swe2-critic: A2-FIX8 delta critic swe2 (50s)',
  }),
  el({
    id: 'tools', family: 'tools', label: 'tools', about: 'tool calls: the running ones with their target, then the counters by name',
    kind: 'list', variants: [{ id: 'lines', label: 'строками' }, { id: 'counts', label: 'счётчиком' }],
    options: [
      { key: 'maxRows', label: 'максимум строк', kind: 'int', min: 1, max: 8, default: 3 },
      { key: 'order', label: 'порядок', kind: 'choice', choices: [{ id: 'running-first', label: 'сначала идущие' }, { id: 'counters-first', label: 'сначала счётчики' }], default: 'running-first' },
    ],
    outcome: 'C', catalogue: ['tools'], sample: '◐ Bash: …/SI…  ✓ Bash ×18',
  }),
  el({
    id: 'ram', family: 'system', label: 'ram', about: 'the machine memory used of the total, an approximate figure',
    kind: 'meter', variants: [{ id: 'used-total', label: 'used/total' }, { id: 'percent', label: 'percent' }, { id: 'used', label: 'used only' }],
    outcome: 'C', catalogue: ['ram'], sample: '11 GB / 24 GB (48%)',
  }),
  el({
    id: 'path', family: 'project', label: 'path', about: 'the last two components of the working directory',
    kind: 'text', variants: [{ id: 'short', label: 'last two' }], outcome: 'C', catalogue: ['path'], sample: 'Agents/claudeapp',
  }),
  el({
    id: 'static', family: 'decor', label: 'static line', about: 'a fixed line of text from the element settings',
    kind: 'text', variants: [{ id: 'text', label: 'текст' }],
    options: [{ key: 'text', label: 'текст строки', kind: 'text', default: '' }],
    outcome: 'C', catalogue: ['static'], sample: 'зонт_mode',
  }),
]

const ALL_IDS = ELEMENTS.map((e) => e.id)

const GIT_IDS = ['git', 'branch', 'git-branch']
const USAGE_IDS = ['ctx', 'brk', 'rl', 'five-hour-limit', 'weekly-limit', 'cost']

const SOURCES: { source: import('./types').Source; elements: string[] }[] = [
  { source: { kind: 'event', event: 'session.start' }, elements: ALL_IDS },
  { source: { kind: 'event', event: 'turn.start' }, elements: ['dur'] },
  { source: { kind: 'event', event: 'turn.step' }, elements: ['model', 'dur'] },
  { source: { kind: 'event', event: 'turn.complete' }, elements: ['model', 'sum', 'tokens-total', 'spd', 'ag', 'dur'] },
  { source: { kind: 'event', event: 'tool.call' }, elements: ['tools', 'todo'] },
  { source: { kind: 'event', event: 'session.end' }, elements: ['tools'] },
  { source: { kind: 'event', event: 'agent.spawn' }, elements: ['ag'] },
  { source: { kind: 'event', event: 'config.set' }, elements: ['model'] },
  { source: { kind: 'session', call: 'usage' }, elements: USAGE_IDS },
  { source: { kind: 'session', call: 'model' }, elements: ['model'] },
  { source: { kind: 'session', call: 'info' }, elements: ['git-branch', 'directory', 'path', 'session', 'github'] },
  { source: { kind: 'session', call: 'messages' }, elements: ['todo'] },
  { source: { kind: 'cmd', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], everyMs: 8000, cwd: 'project' }, elements: GIT_IDS },
  { source: { kind: 'cmd', argv: ['git', 'config', '--get', 'remote.origin.url'], everyMs: 60000, cwd: 'project' }, elements: ['github'] },
  { source: { kind: 'cmd', argv: ['/usr/bin/vm_stat'], everyMs: 15000 }, elements: ['ram'] },
  { source: { kind: 'cmd', argv: ['sysctl', '-n', 'hw.memsize'], everyMs: 60000 }, elements: ['ram'] },
  { source: { kind: 'cmd', argv: ['claude', '--version'], everyMs: 0 }, elements: ['ver'] },
  { source: { kind: 'file', path: '/proc/meminfo', everyMs: 15000 }, elements: ['ram'] },
  { source: { kind: 'file', path: '.claude/settings.json', everyMs: 30000, relativeTo: 'home' }, elements: ['cfg', 'style'] },
  { source: { kind: 'file', path: 'CLAUDE.md', everyMs: 30000, relativeTo: 'project' }, elements: ['cfg'] },
  { source: { kind: 'file', path: '.claude/CLAUDE.md', everyMs: 30000, relativeTo: 'home' }, elements: ['cfg'] },
  { source: { kind: 'env', names: ['CLAUDE_CODE_EXECPATH', 'HOME'] }, elements: ['ver', 'cfg', 'style'] },
  { source: { kind: 'clock', everyMs: 1000 }, elements: ['dur', 'ag'] },
]

function ctxValue(s: BaseState, args: FormatArgs): Value {
  const u = s.usage
  if (!u || !u.context) return pend()
  const c = u.context
  const nf = args.nf
  const known = c.tokens !== undefined
  const make = (): Ok => {
    if (args.variant === 'percent') return ok(nf.percent(known ? (c.tokens as number) / c.window : 0), { ratio: known ? (c.tokens as number) / c.window : 0 })
    if (args.variant === 'remaining') {
      const rem = known ? c.window - (c.tokens as number) : undefined
      return rem === undefined ? ok('…', { ratio: 0 }) : ok(nf.tokens(rem), { ratio: rem / c.window })
    }
    return ok((known ? nf.tokens(c.tokens as number) : '…') + '/' + nf.tokens(c.window), { ratio: known ? (c.tokens as number) / c.window : 0, num: known ? c.tokens : undefined, unit: 'tokens' })
  }
  if (!known && !s.ctxCarried) {
    // a fresh window with no count yet: a stub of the same width, never a
    // zero — and no ratio, so no zero bar or zero percent is drawn either
    if (args.variant === 'percent') return ok('…%')
    if (args.variant === 'remaining') return ok('…')
    return ok('…/' + nf.tokens(c.window), { unit: 'tokens' })
  }
  if (s.usageFail) return stale(make(), s.usageFail)
  if (s.ctxCarried) return stale(make(), 'the count of the last answer before the interrupted turn')
  return make()
}

function usageStale<T>(s: BaseState, make: () => Ok): Value {
  if (s.usageFail) return stale(make(), s.usageFail)
  return make()
}

function limitsValue(s: BaseState, id: string, label: string, args: FormatArgs): Value {
  const win = id === 'five-hour-limit' ? s.usage?.five : s.usage?.seven
  if (!win || !Number.isFinite(win.percentUsed)) return pend()
  const make = (): Ok => {
    const pct = args.nf.percent(win.percentUsed / 100)
    const text = label + ' ' + pct + (args.variant === 'resets' && win.resetsAt ? ' → ' + win.resetsAt : '')
    return ok(text, { ratio: win.percentUsed / 100 })
  }
  return usageStale(s, make)
}

function toolsRows(s: BaseState, args: FormatArgs): Row[] {
  const max = typeof args.options['maxRows'] === 'number' ? (args.options['maxRows'] as number) : 3
  const countersFirst = args.options['order'] === 'counters-first'
  const rows: Row[] = []
  const running: Row[] = []
  for (const a of s.tools.active.values()) running.push({ icon: 'run', label: a.name, detail: a.target })
  const counter: Row[] = []
  for (const [name, n] of s.tools.byName) counter.push({ icon: 'ok', label: name + ' ×' + String(n) })
  const errRow: Row[] = s.tools.errTotal > 0 ? [{ icon: 'fail', label: 'errors ×' + String(s.tools.errTotal) }] : []
  rows.push(...(countersFirst ? [...counter, ...running] : [...running, ...counter]), ...errRow)
  return rows.slice(0, max)
}

function agRows(s: BaseState, args: FormatArgs, now: number): Row[] {
  const max = typeof args.options['maxRows'] === 'number' ? (args.options['maxRows'] as number) : 3
  const newestFirst = args.options['order'] === 'newest-first'
  const agents = [...s.agents.map.values()].sort((a, b) => (newestFirst ? b.at - a.at : a.at - b.at))
  const rows: Row[] = []
  for (const a of agents) {
    const running = a.status === 'running'
    const secs = running ? Math.max(0, Math.round((now - a.at) / 1000)) : Math.max(0, Math.round((a.doneAt - a.at) / 1000))
    rows.push({
      icon: running ? 'run' : 'ok',
      label: a.name || 'agent',
      detail: a.desc,
      right: secs + 's',
    })
  }
  if (rows.length === 0 && s.agents.map.size === 0) return []
  return rows.slice(0, max)
}

function elValue(s: BaseState, id: string, args: FormatArgs): Value {
  const nf = args.nf
  switch (id) {
    case 'model': {
      if (!s.model) return pend()
      const raw = s.model
      const text = args.variant === 'display' ? displayName(raw) : args.variant === 'short' ? shortModel(raw) : raw
      const served = s.servedModel && shortModel(s.servedModel) !== shortModel(raw) ? shortModel(s.servedModel) : ''
      const hasEffort = (typeof s.effort === 'string' && s.effort) || (typeof s.effort === 'number' && Number.isFinite(s.effort))
      // fast mode has no typed source in the measured API (DATA §6): a named
      // no-source, never a guess — the element never claims a fast flag
      return ok(text + (hasEffort ? ' ' + String(s.effort) : '') + (served ? '→' + served : ''))
    }
    case 'route':
      return { state: 'nosource', reason: 'route label source OPEN (spec В5)' }
    case 'ctx':
      return ctxValue(s, args)
    case 'brk': {
      const b = s.usage?.breakdown
      if (!b || (b.input === null && b.cw === null && b.cr === null)) return pend()
      const make = (): Ok =>
        args.variant === 'sum'
          ? ok('Σ ' + nf.tokens((b.input ?? 0) + (b.cw ?? 0) + (b.cr ?? 0)))
          : ok('in ' + (b.input === null ? '…' : nf.tokens(b.input)) + ' cw ' + (b.cw === null ? '…' : nf.tokens(b.cw)) + ' cr ' + (b.cr === null ? '…' : nf.tokens(b.cr)))
      return usageStale(s, make)
    }
    case 'sum': {
      if (!s.sum) return pend()
      const partial = s.resumed ? '*' : ''
      return ok('Σ ' + nf.tokens(s.sum.total) + partial)
    }
    case 'tokens-total': {
      if (!s.sum) return pend()
      const partial = s.resumed ? '*' : ''
      if (args.variant === 'total') return ok(nf.tokens(s.sum.total) + partial)
      return ok(nf.tokens(s.sum.total) + partial + ' (in: ' + nf.tokens(s.sum.in) + ', out: ' + nf.tokens(s.sum.out) + ', cache: ' + nf.tokens(s.sum.cache) + ')')
    }
    case 'spd':
      return s.speed === null ? pend() : ok(nf.rate(s.speed, 'tok'))
    case 'dur': {
      if (s.durBase < 0) return pend()
      const partial = s.resumed ? '?' : ''
      return ok(nf.duration(s.now - s.durBase) + partial)
    }
    case 'cfg': {
      const parts: string[] = []
      if (s.cfgFiles && s.cfgFiles.mdProject + s.cfgFiles.mdHome > 0) parts.push(String(s.cfgFiles.mdProject + s.cfgFiles.mdHome) + ' CLAUDE.md')
      if (s.settings) parts.push(String(s.settings.hk) + ' hooks')
      if (s.settingsFail) {
        if (parts.length === 0) return { state: 'nosource', reason: s.settingsFail }
        return stale(ok(parts.join(' │ ')), s.settingsFail)
      }
      if (parts.length === 0) return pend()
      return ok(parts.join(' │ '))
    }
    case 'style':
      if (s.settingsFail) return s.settings ? stale(ok(s.settings.style), s.settingsFail) : { state: 'nosource', reason: s.settingsFail }
      return s.settings ? ok(s.settings.style) : pend()
    case 'ver': {
      if (!s.ver) return pend()
      let text = 'v' + s.ver.text
      if (args.variant === 'restart' && s.ver.installed && s.ver.installed !== s.ver.text) text += '→' + s.ver.installed + ' restart'
      return ok(text)
    }
    case 'name':
      return { state: 'nosource', reason: 'session name source OPEN (spec row 7)' }
    case 'rl': {
      const rl = s.usage?.rl ?? []
      if (rl.length === 0) return pend()
      const wins = args.variant === 'five' ? rl.filter((w) => w.kind === 'five_hour') : args.variant === 'seven' ? rl.filter((w) => w.kind === 'seven_day') : rl
      if (wins.length === 0) return pend()
      const make = (): Ok => ok('rl ' + wins.map((w) => shortWin(w.kind) + ' ' + nf.percent(w.percentUsed / 100)).join(','))
      return usageStale(s, make)
    }
    case 'cost': {
      const usd = s.usage?.cost
      if (usd === undefined) return pend()
      const make = (): Ok => ok(nf.usd(usd), { num: usd, unit: 'usd' })
      return usageStale(s, make)
    }
    case 'git': {
      if (s.gitFail === 'outside a git repository') return { state: 'nosource', reason: 'outside a git repository' }
      const base = s.root || s.cwd ? baseName(s.root || s.cwd) : ''
      if (!s.git) return s.gitFail ? stale(ok(args.variant === 'bare' ? '?' : base + '(?)'), s.gitFail) : pend()
      const text = args.variant === 'bare' ? s.git.branch : base + '(' + s.git.branch + ')'
      return ok(text)
    }
    case 'git-branch': {
      const base = s.root || s.cwd ? baseName(s.root || s.cwd) : ''
      if (!s.git) {
        if (s.gitFail === 'outside a git repository') return base ? ok(base) : { state: 'nosource', reason: 'outside a git repository' }
        return pend()
      }
      return ok(args.variant === 'ref-only' ? s.git.branch : base + '(' + s.git.branch + ')')
    }
    case 'directory':
      return s.cwd ? ok(baseName(s.cwd)) : pend()
    case 'branch': {
      if (s.gitFail === 'outside a git repository') return { state: 'nosource', reason: 'outside a git repository' }
      if (!s.git) return pend()
      return ok(s.git.branch)
    }
    case 'github':
      return s.github ? ok(s.github) : { state: 'nosource', reason: 'no github remote on this repository' }
    case 'five-hour-limit':
      return limitsValue(s, 'five-hour-limit', '5h', args)
    case 'weekly-limit':
      return limitsValue(s, 'weekly-limit', '7d', args)
    case 'session':
      return s.session ? ok(args.variant === 'full' ? s.session : s.session.slice(0, 8)) : pend()
    case 'todo': {
      if (!s.todo.synced) return pend()
      if (args.variant === 'progress') return ok('todo ' + String(s.todo.done) + '/' + String(s.todo.total))
      return ok((s.todo.current || 'todo') + ' (' + String(s.todo.done) + '/' + String(s.todo.total) + ')')
    }
    case 'ag': {
      if (args.variant === 'counts') {
        if (s.agents.map.size === 0) return pend()
        let running = 0
        for (const a of s.agents.map.values()) if (a.status === 'running') running++
        const done = s.agents.done.length
        let text = 'ag ' + running + 'r'
        if (done > 0) text += ' ' + done + '✓'
        return ok(text)
      }
      const rows = agRows(s, args, s.now)
      if (rows.length === 0) return pend()
      return ok(rows.map((r) => rowText(r)).join(' │ '), { rows })
    }
    case 'tools': {
      if (args.variant === 'counts') {
        if (!s.tools.sawAny && !s.tools.sawTurnComplete) return pend()
        let text = 'tools ✓' + String(s.tools.doneTotal)
        if (s.tools.errTotal > 0) text += ' e' + String(s.tools.errTotal)
        return ok(text)
      }
      if (!s.tools.sawAny && !s.tools.sawTurnComplete && s.tools.active.size === 0) return pend()
      const rows = toolsRows(s, args)
      if (rows.length === 0) return s.tools.doneTotal > 0 || s.tools.errTotal > 0 ? ok('✓ ' + String(s.tools.doneTotal)) : pend()
      return ok(rows.map((r) => rowText(r)).join(' │ '), { rows })
    }
    case 'ram': {
      if (!s.ram || !s.ram.totalBytes || !s.ram.usedBytes) return pend()
      const ratio = s.ram.usedBytes / s.ram.totalBytes
      // the percent is the renderer's business (meter show=all appends it);
      // the family's own text stays the bare figure
      const make = (): Ok => {
        if (args.variant === 'percent') return ok(nf.percent(ratio), { ratio })
        if (args.variant === 'used') return ok(nf.bytes(s.ram!.usedBytes), { ratio, num: s.ram!.usedBytes, unit: 'bytes' })
        return ok(nf.bytes(s.ram.usedBytes) + ' / ' + nf.bytes(s.ram.totalBytes), { ratio, num: s.ram.usedBytes, unit: 'bytes' })
      }
      return make()
    }
    case 'path': {
      if (!s.cwd) return pend()
      const segs = s.cwd.split('/').filter(Boolean)
      return ok(segs.slice(-2).join('/') || s.cwd)
    }
    case 'static': {
      const text = typeof args.options['text'] === 'string' ? args.options['text'] : ''
      if (!text) return { state: 'nosource', reason: 'the static line text is empty (Элемент → текст строки)' }
      return ok(text)
    }
    default:
      return { state: 'nosource', reason: 'unknown element ' + id }
  }
}

function shortWin(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  return kind
}

const ROW_ICON: Record<Row['icon'] & string, string> = { ok: '✓', run: '◐', fail: '✗', todo: '▸', info: 'ℹ' }

export function rowText(r: Row): string {
  const icon = ROW_ICON[r.icon ?? 'info'] ?? ''
  return (icon ? icon + ' ' : '') + r.label + (r.detail ? ': ' + r.detail : '') + (r.right ? ' (' + r.right + ')' : '')
}

const collector: Collector<BaseState> = {
  // base owns elements across many families; the collector's own family names
  // the registry it registers (elements carry their real family)
  family: 'model',
  elements: ELEMENTS,
  sources: SOURCES,
  init(): BaseState {
    return {
      started: false,
      interactive: false,
      cwd: '',
      root: '',
      git: null,
      gitFail: '',
      github: null,
      model: '',
      effort: undefined,
      servedModel: '',
      session: '',
      resumed: false,
      priorTurns: 0,
      durBase: -1,
      lastSessionId: '',
      usage: null,
      usageFail: '',
      ctxCarried: false,
      abortCarry: false,
      sum: null,
      speed: null,
      ver: null,
      ram: null,
      cfgFiles: null,
      settings: null,
      settingsFail: '',
      tools: initTools(),
      agents: initAgents(),
      todo: { synced: false, done: 0, total: 0, current: '' },
      seenTurns: [],
      now: 0,
    }
  },
  reduce(state: BaseState, input: Input): BaseState {
    const s: BaseState = {
      ...state,
      tools: { ...state.tools, active: new Map(state.tools.active), byName: new Map(state.tools.byName), done: [...state.tools.done] },
      agents: { map: new Map(state.agents.map), done: [...state.agents.done] },
      now: input.now,
    }
    const src = input.source
    if (src.kind === 'event') {
      reduceEvent(s, src.event, input.ok ? input.data : undefined, input.now)
      return s
    }
    if (src.kind === 'session') {
      if (!input.ok) {
        if (src.call === 'usage') s.usageFail = input.error ?? 'usage read failed'
        return s
      }
      if (src.call === 'usage') {
        readUsageInto(s, input.data, input.now)
        return s
      }
      if (src.call === 'model') {
        const m = input.data
        if (typeof m === 'string' && m) s.model = m
        return s
      }
      if (src.call === 'info') {
        const i = (input.data ?? {}) as { cwd?: string; root?: string; id?: string; turns?: number }
        if (typeof i.cwd === 'string' && i.cwd) s.cwd = i.cwd
        if (typeof i.root === 'string' && i.root) s.root = i.root
        if (typeof i.id === 'string' && i.id) s.session = i.id
        if (typeof i.turns === 'number' && i.turns > 0) {
          s.resumed = true
          s.priorTurns = i.turns
        }
        return s
      }
      if (src.call === 'messages') {
        const msgs = Array.isArray(input.data) ? (input.data as Record<string, unknown>[]) : []
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          const uses = m && Array.isArray(m['toolUses']) ? (m['toolUses'] as Record<string, unknown>[]) : []
          for (let j = uses.length - 1; j >= 0; j--) {
            if (TODO_TOOLS.includes(String(uses[j]!['tool']))) {
              applyTodos(uses[j]!, s)
              return s
            }
          }
        }
        return s
      }
      return s
    }
    if (src.kind === 'cmd') {
      reduceCmd(s, src.argv, input.ok, input.data, input.error, input.now)
      return s
    }
    if (src.kind === 'file') {
      reduceFile(s, src.path, input.ok, input.data, input.now, input.error)
      return s
    }
    if (src.kind === 'env') {
      const env = (input.data ?? {}) as Record<string, string | undefined>
      // the executing image's own version file sits beside CLAUDE_CODE_EXECPATH
      const exec = env['CLAUDE_CODE_EXECPATH']
      if (s.ver && typeof exec === 'string' && exec) {
        const m = /(\d+\.\d+\.\d+)/.exec(exec.slice(exec.lastIndexOf('/') + 1))
        if (m && !s.ver.installed) s.ver = { ...s.ver, installed: m[1]! }
      }
      return s
    }
    return s
  },
  value(state: BaseState, elementId: string, args: FormatArgs): Value {
    const def = ELEMENTS.find((e) => e.id === elementId)
    if (!def) return { state: 'nosource', reason: 'unknown element ' + elementId }
    if (def.outcome === 'N') return { state: 'nosource', reason: def.reason ?? 'unavailable' }
    return elValue(state, elementId, args)
  },
}

export default collector
