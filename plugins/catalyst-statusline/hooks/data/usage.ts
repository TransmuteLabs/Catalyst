// T-ctx family: context, tokens, cost, limits (BRIEF-v0.5-data, DESIGN P3/P7).
// CONSTRAINT (types.ts): pure module — no `$`, no `on`, no I/O, no Date.now();
// sources are declared here, the core runs them and feeds reduce.
// CONSTRAINT (P7): numbers are formatted only through args.nf, never locally.
import type { Collector, ElementDef, FormatArgs, Input, Ok, Row, Source, Value, Variant } from './types'

// Catalogue constants the reference formulas carry (CATALOGUE-elements-43).
const CTX_200K = 200000 // E002/E003: the fixed denominator of the transcript formulas
const OVERHEAD_45000 = 45000 // E109/E110: the system-overhead addend
const EMA_ALPHA = 1 / 5 // E182
const TREND_CELLS = 10 // E415: TREND_TURNS of the reference
const CAP_SAMPLES = 32
// E442: the reference taxonomy (high/medium/low) mapped onto consecutive runs.
const LOOP_ACTIVE = 3
const LOOP_EMERGING = 2

// E443 rate card, snapshot 2026-09-14, ported verbatim from costclaw-live
// hooks/index.tsx:45-66 (CC-Mods/claude-harness @ 3815f70). USD per 1M tokens.
// cache_write_1h is dropped: TurnUsage is the four-field shape, which the
// reference values at the five-minute rate (its legacy branch).
const PRICES_PER_MTOK: Record<string, { input: number; output: number; cache_write: number; cache_read: number }> = {
  'claude-fable-5-1': { input: 10, output: 50, cache_write: 12.5, cache_read: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cache_write: 12.5, cache_read: 1 },
  'claude-mythos-5-1': { input: 10, output: 50, cache_write: 12.5, cache_read: 0.25 },
  'claude-mythos-5': { input: 10, output: 50, cache_write: 12.5, cache_read: 1 },
  'claude-opus-5': { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cache_write: 2.5, cache_read: 0.2 },
  'claude-opus-4-7': { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  'claude-opus-4-7[1m]': { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  'claude-opus-4-1': { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  'claude-opus-4': { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'claude-sonnet-4': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
  'claude-haiku-3-5': { input: 0.8, output: 4, cache_write: 1, cache_read: 0.08 },
}
const FALLBACK_PRICE = { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 }

function canonicalModel(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '')
}
function priceOf(model: string, u: Sum4): number {
  const p = PRICES_PER_MTOK[model] ?? PRICES_PER_MTOK[canonicalModel(model)] ?? FALLBACK_PRICE
  return (u.input * p.input + u.output * p.output + u.write * p.cache_write + u.read * p.cache_read) / 1e6
}

// Outcomes 'N' (SPEC 14.4): the reason strings are verbatim from the table.
const N_REASONS: Record<string, string> = {
  'u-ctx-reserve': 'remaining_percentage payload с буфером97000 не приравнен нативному context.percent',
  'u-exceeds-200k': 'exceeds_200k_tokens не опубликован в измеренном mod-API; не выводить иной предикат вместо поля',
  'u-prompt-cache': 'prompt_cache recache/miss и вход цены холодного захода не опубликованы в измеренном usage мода',
  'u-rate-derived': 'на текущем шлюзе rateLimits пуст; spend/reset и производные наклона не заменяются нулём, §12.5',
  'u-budget-guard': 'пределы/режим/вычисленное состояние budget-guard не являются настройками статус-мода; источник не объявлен',
  'u-thinking-mode': 'thinking/fast не имеют установленного типизированного источника; fast согласован с §14.10',
  'u-ctx-anatomy': 'производитель anatomy/source-разбивки cctop не прочитан; досъём',
  'u-usage-dedup': 'словарь cctop не заменяет производителя: band/footer, usage-дедуп, cost-ledger, weights, rates и phase нуждаются в досъёме формул; не подставлять соседние C',
  'u-cost-ledger': 'словарь cctop не заменяет производителя: band/footer, usage-дедуп, cost-ledger, weights, rates и phase нуждаются в досъёме формул; не подставлять соседние C',
  'u-burn-rate': 'словарь cctop не заменяет производителя: band/footer, usage-дедуп, cost-ledger, weights, rates и phase нуждаются в досъёме формул; не подставлять соседние C',
  'u-rate-model': 'словарь cctop не заменяет производителя: band/footer, usage-дедуп, cost-ledger, weights, rates и phase нуждаются в досъёме формул; не подставлять соседние C',
  'u-phase-stats': 'словарь cctop не заменяет производителя: band/footer, usage-дедуп, cost-ledger, weights, rates и phase нуждаются в досъёме формул; не подставлять соседние C',
  'u-ctx-band': 'словарь cctop не заменяет производителя: band/footer, usage-дедуп, cost-ledger, weights, rates и phase нуждаются в досъёме формул; не подставлять соседние C',
  'u-costclaw-score': 'входы rubric/repeated-read оценки costclaw требуют собственного состояния; их наличие в нашем снимке не установлено',
}

type Sum4 = { input: number; output: number; read: number; write: number }
type UsageRead = {
  at: number
  tokens?: number
  window: number
  percent?: number
  usd?: number
  threshold?: number
  rawMax?: number
  totalTokens?: number
  categories?: { name: string; tokens: number }[]
}
type TurnRec = { at: number; agentId?: string; reason?: string; usage?: Sum4 }

type State = {
  usage: UsageRead[]
  ctxSamples: { at: number; tokens: number }[]
  turnCost?: { at: number; usd: number }
  lastTurn?: TurnRec
  windowOut: number | null
  stepTotals: Sum4 | null
  priceUsd: number
  priceSeen: boolean
  gitDir?: string
  gitCommon?: string
  porcel?: { staged: number; unstaged: number }
  handoff?: { goal?: string; now?: string }
  transcriptPath?: string
  transcriptSeen: boolean
  transcriptSummary?: string
  transcriptUsage?: Sum4
  transcriptRegexLeft?: number
  verCur?: string
  verLatest?: string
  toolRun: { tool: string; runs: number } | null
  errors: Record<string, { at: number; text: string; exit: boolean }>
}

const K_USAGE = 'session:usage'
const K_INFO = 'session:info'
const K_TURN_DONE = 'event:turn.complete'
const K_TURN_STEP = 'event:turn.step'
const K_TOOL = 'event:tool.call'
const K_GIT_DIR = 'cmd:git rev-parse --git-dir'
const K_GIT_COMMON = 'cmd:git rev-parse --git-common-dir'
const K_PORCELAIN = 'cmd:git status --porcelain'
const HANDOFF_CMD = 'cat "$(ls -t thoughts/shared/handoffs/*.yaml thoughts/shared/handoffs/*.yml .catalyst/handoffs/*.yaml .catalyst/handoffs/*.yml 2>/dev/null | head -n 1)"'
const K_HANDOFF = 'cmd:sh -c ' + HANDOFF_CMD
// the core's own transcript source; the path arrives from the host, never env
const K_TRANSCRIPT = 'transcript'
// byte-identical argv to base.ts ver: one run feeds both families
const K_VER = 'cmd:claude --version'
const K_LATEST = 'cmd:curl -fsS --max-time 2 https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest'

function srcKey(s: Source): string {
  switch (s.kind) {
    case 'session': return 'session:' + s.call
    case 'event': return 'event:' + s.event
    case 'cmd': return 'cmd:' + s.argv.join(' ')
    case 'env': return 'env:' + s.names.join(',')
    case 'file': return 'file:' + s.path
    case 'transcript': return 'transcript'
    case 'clock': return 'clock'
  }
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function usage4(u: unknown): Sum4 | undefined {
  const o = u as Record<string, unknown> | null | undefined
  if (!o || typeof o !== 'object') return undefined
  const input = num(o.input_tokens)
  const output = num(o.output_tokens)
  const read = num(o.cache_read_input_tokens)
  const write = num(o.cache_creation_input_tokens)
  if (input === undefined || output === undefined || read === undefined || write === undefined) return undefined
  return { input, output, read, write }
}

const REGEX_LEFT = /Context left until auto-compact:\s*(\d+)%/
const REGEX_LOW = /Context low \((\d+)% remaining\)/

function readTranscript(s: State, stdout: string): void {
  let usage: Sum4 | undefined
  let summary: string | undefined
  let left: number | undefined
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const ml = REGEX_LEFT.exec(line)
    if (ml) left = 100 - Number(ml[1])
    const mo = REGEX_LOW.exec(line)
    if (mo) left = 100 - Number(mo[1])
    let o: unknown
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const rec = o as Record<string, unknown>
    if (rec.type === 'summary' && typeof rec.summary === 'string') summary = rec.summary
    const u = usage4((rec.message as Record<string, unknown> | undefined)?.usage)
    if (u) usage = u
  }
  s.transcriptSeen = true
  if (summary !== undefined) s.transcriptSummary = summary.replace(/\s+/g, ' ').trim()
  if (usage !== undefined) s.transcriptUsage = usage
  if (left !== undefined) s.transcriptRegexLeft = left
}

function readHandoff(s: State, stdout: string): void {
  const field = (re: RegExp): string | undefined => {
    const m = re.exec(stdout)
    return m ? m[1].trim() : undefined
  }
  s.handoff = {
    goal: field(/^goal:\s*(.+)$/m) ?? field(/^topic:\s*(.+)$/m) ?? field(/^#\s+(.+)$/m),
    now: field(/^now:\s*(.+)$/m),
  }
}

function reduceUsage(s: State, data: unknown, now: number): void {
  const d = data as { context?: Record<string, unknown>; cost?: { usd?: unknown } } | null
  const c = d && typeof d === 'object' ? d.context : undefined
  const bd = (c && typeof c.breakdown === 'object' ? c.breakdown : undefined) as Record<string, unknown> | undefined
  const read: UsageRead = {
    at: now,
    tokens: num(c?.tokens),
    window: num(c?.window) ?? 0,
    percent: num(c?.percent),
    usd: num(d?.cost?.usd),
    threshold: num(bd?.autoCompactThreshold),
    rawMax: num(bd?.rawMaxTokens),
    totalTokens: num(bd?.totalTokens),
    categories: Array.isArray(bd?.categories)
      ? (bd.categories as { name?: unknown; tokens?: unknown }[])
          .filter((r) => typeof r?.name === 'string' && num(r?.tokens) !== undefined)
          .map((r) => ({ name: String(r.name), tokens: num(r.tokens) as number }))
      : undefined,
  }
  if (read.window <= 0) return // a windowless read carries no context figure
  const prev = s.usage[s.usage.length - 1]
  if (read.usd !== undefined && prev && prev.usd !== undefined) s.turnCost = { at: now, usd: read.usd - prev.usd }
  s.usage.push(read)
  while (s.usage.length > CAP_SAMPLES) s.usage.shift()
  if (read.tokens !== undefined) {
    s.ctxSamples.push({ at: now, tokens: read.tokens })
    while (s.ctxSamples.length > CAP_SAMPLES) s.ctxSamples.shift()
  }
}

function ctxDiffs(s: State): number[] {
  const out: number[] = []
  for (let i = 1; i < s.ctxSamples.length; i++) out.push(s.ctxSamples[i].tokens - s.ctxSamples[i - 1].tokens)
  return out
}

// The freshest word of a source: an ok:false Input or a cmd that exited
// non-zero. Data from earlier reads stays; the error turns the value stale.
type ErrWord = { at: number; text: string; exit: boolean } | undefined
function errOf(s: State, keys: string[]): ErrWord {
  let freshest: ErrWord
  for (const k of keys) {
    const e = s.errors[k]
    if (e && (!freshest || e.at > freshest.at)) freshest = e
  }
  return freshest
}

// Wraps the computed value with the pending/nosource/stale semantics of SPEC
// 12: never zero, never a silent hole. `have` says data from a good read is on
// hand (stale material), `fresh` says the current compute is drawable.
function answer(s: State, keys: string[], have: boolean, fresh: () => Value): Value {
  const err = errOf(s, keys)
  if (!err) return fresh()
  if (have) {
    const last = fresh() as Ok
    if (last.state === 'ok') return { state: 'stale', last, reason: err.text }
    return last
  }
  if (err.exit) return { state: 'nosource', reason: err.text }
  return { state: 'pending' }
}

const ok = (text: string, at: number, extra: Partial<Ok> = {}): Ok => ({ state: 'ok', text, at, ...extra })

function el(id: string, family: ElementDef['family'], label: string, about: string, kind: ElementDef['kind'], variants: Variant[], catalogue: string[], sample: string): ElementDef {
  return { id, family, label, about, kind, variants, outcome: 'C', catalogue, sample }
}
function nel(id: string, family: ElementDef['family'], label: string, about: string, variants: Variant[]): ElementDef {
  // CONSTRAINT (P3): a catalogue line lives in exactly one place — the variant's
  // own list; the element list stays empty so no line is counted twice.
  return { id, family, label, about, kind: 'text', variants, outcome: 'N', reason: N_REASONS[id], catalogue: [], sample: '⊘ ' + label }
}
const v = (id: string, label: string, catalogue: string[]): Variant => ({ id, label, catalogue })

const ELEMENTS: ElementDef[] = [
  el('u-worktree-mark', 'git', 'worktree', 'the workderee marker: git-dir differs from the git common dir (E001)', 'text', [v('mark', 'glyph', ['E001'])], [], '⑂'),
  el('u-turn-in', 'tokens', 'turn in', 'input tokens of the last main turn, off its turn.complete usage (E150)', 'text', [v('in', 'tokens', ['E150'])], [], '46k in'),
  el('u-turn-out', 'tokens', 'turn out', 'output tokens of the last main turn (E151)', 'text', [v('out', 'tokens', ['E151'])], [], '5k out'),
  el('u-turn-cache', 'tokens', 'turn cache', 'cache tokens of the last turn: the read and the write side (E153/E154)', 'text', [v('read', 'cache read', ['E153']), v('write', 'cache write', ['E154'])], [], 'cache r 150k'),
  el('u-turn-cache-hit', 'tokens', 'turn cache hit', 'cache_read over input+read+write of the last turn (E152)', 'meter', [v('turn', 'of the turn', ['E152'])], [], 'cache 76%'),
  el('u-cache-hit-session', 'tokens', 'session cache hit', 'cacheRead over input+creation+read summed over turn.step usage (E441)', 'meter', [v('session', 'of the session', ['E441'])], [], 'cache health 69%'),
  el('u-turn-cost', 'cost', 'last turn cost', 'the difference of two consecutive session-usage cost reads (E149)', 'text', [v('diff', 'usd', ['E149'])], [], 'last turn $0.2394'),
  el('u-turn-death', 'session', 'turn death', 'why the last turn ended: an API error or a refusal (E412)', 'text', [v('reason', 'reason', ['E412'])], [], 'Last turn ended in an API error'),
  el('u-turn-subagent', 'agents', 'subagent turn', 'the flag that the last turn ran in an agent loop, not the main one (E155)', 'text', [v('flag', 'flag', ['E155'])], [], '*'),
  el('u-ctx-growth', 'context', 'context growth', 'how fast the window fills: the last delta, the average and the EMA a=1/5 (E158/E159/E182)', 'text', [v('last', 'last turn', ['E158']), v('average', 'average', ['E159']), v('ema', 'EMA 1/5', ['E182'])], [], '+45k last turn'),
  el('u-turns-to-compact', 'context', 'turns to compact', 'turns left before the compaction threshold: by average, by EMA, by the compactAt threshold (E160/E183/E414)', 'text', [v('average', 'average', ['E160']), v('ema', 'EMA', ['E183']), v('compact', 'compactAt', ['E414'])], [], '7 turns to compact'),
  el('u-tokens-to-compact', 'context', 'tokens to compact', 'autoCompactThreshold minus the used tokens (E413)', 'text', [v('tokens', 'tokens', ['E413'])], [], '222k tokens to compaction'),
  el('u-compact-threshold', 'context', 'compact threshold', 'the token count auto-compaction runs at, and its nature (E161/E162)', 'text', [v('tokens', 'tokens', ['E161']), v('nature', 'nature', ['E162'])], [], '367000'),
  el('u-ctx-categories', 'context', 'context categories', 'the window broken into the engine categories, name/tokens/percent (E163)', 'list', [v('rows', 'rows', ['E163'])], [], 'System prompt 5762 2%'),
  el('u-ctx-trend', 'context', 'context trend', 'the last ten context readings as a sparkline (E415)', 'text', [v('spark', 'sparkline', ['E415'])], [], '▁▂▄▆█'),
  el('u-git-staged', 'git', 'staged count', 'porcelain rows with a non-space X column; ?? rows are not staged (E111)', 'text', [v('x', 'count', ['E111'])], [], 'staged 2'),
  el('u-git-unstaged', 'git', 'unstaged count', 'porcelain rows with a non-space Y column; ?? rows are not unstaged (E112)', 'text', [v('y', 'count', ['E112'])], [], 'unstaged 2'),
  el('u-handoff', 'session', 'handoff', 'the goal and the now field of the freshest handoff file (E113/E114)', 'text', [v('goal', 'goal', ['E113']), v('now', 'now', ['E114'])], [], 'goal: ship the audit'),
  el('u-session-summary', 'session', 'session summary', 'the last summary record of the session transcript (E123)', 'text', [v('summary', 'summary', ['E123'])], [], 'Second line'),
  el('u-transcript-path', 'session', 'transcript path', 'the session transcript path as published to the plugin (E124)', 'text', [v('path', 'path', ['E124'])], [], '/t/x.jsonl'),
  el('u-newer-version', 'system', 'newer version', 'the arrow when the published latest version is component-wise newer (E119)', 'text', [v('mark', 'mark', ['E119'])], [], '↑2.1.281'),
  el('u-win-out', 'tokens', 'window out', 'output tokens of the main window, summed over its turns (E122)', 'text', [v('out', 'tokens', ['E122'])], [], '8k out this window'),
  el('u-tool-loop', 'tools', 'tool loop', 'the tool-repeat status of the current run of same-tool calls (E442)', 'text', [v('loop', 'status', ['E442'])], [], 'tool loop none'),
  nel('u-ctx-reserve', 'context', 'context reserve', 'the percent left minus a 97000-token reserve (E094)', [v('reserve', 'percent', ['E094'])]),
  nel('u-exceeds-200k', 'context', 'exceeds 200k', 'the exceeds_200k_tokens flag (E125)', [v('flag', 'flag', ['E125'])]),
  nel('u-prompt-cache', 'context', 'prompt cache', 'recache tokens, the cold-entry price and the last miss cause (E135/E136/E137)', [v('recache', 'tokens', ['E135']), v('cold-cost', 'usd', ['E136']), v('last-miss', 'cause', ['E137'])]),
  nel('u-rate-derived', 'limits', 'rate derived', 'the gateway spend limit and its slope derivatives (E144–E148)', [v('spend', 'percent', ['E144']), v('burn', 'percent/h', ['E145']), v('eta', 'eta', ['E146']), v('resets-first', 'which first', ['E147']), v('resets-at', 'clock', ['E148'])]),
  nel('u-budget-guard', 'limits', 'budget guard', 'the budget-guard limits and its computed states (E164–E169)', [v('cost-limit', 'usd', ['E164']), v('cost-share', 'percent', ['E165']), v('five-hour', 'percent', ['E166']), v('seven-day', 'percent', ['E167']), v('over', 'flag', ['E168']), v('warn', 'toast', ['E169'])]),
  nel('u-thinking-mode', 'context', 'thinking mode', 'the thinking flag and the fast mode (E173/E174)', [v('thinking', 'flag', ['E173']), v('fast', 'flag', ['E174'])]),
  nel('u-ctx-anatomy', 'context', 'context anatomy', 'the first-call context split by kinds (E176–E181)', [v('prefix', 'context_prefix', ['E176']), v('sources', 'context_sources', ['E177']), v('source-tokens', 'source_tokens', ['E178']), v('file-tokens', 'file_tokens', ['E179']), v('reference', 'context_reference', ['E180']), v('anatomy', 'context_anatomy', ['E181'])]),
  nel('u-usage-dedup', 'tokens', 'usage dedup', 'transcript usage counters deduped by message id (E186–E196)', [v('cache-read', 'tokens', ['E186']), v('cache-write', 'tokens', ['E187']), v('fresh-input', 'tokens', ['E188']), v('output', 'tokens', ['E189']), v('thinking', 'tokens', ['E190']), v('hit-ratio', 'percent', ['E191']), v('ttl', 'seconds', ['E192']), v('warm', 'flag', ['E193']), v('expires-in', 'seconds', ['E194']), v('recache', 'tokens', ['E195']), v('misses', 'count', ['E196'])]),
  nel('u-cost-ledger', 'cost', 'cost ledger', 'the cctop cost ledger family (E197–E203)', [v('cost', 'usd', ['E197']), v('combined', 'usd', ['E198']), v('by-model', 'per model', ['E199']), v('per-call', 'usd', ['E200']), v('per-turn', 'usd', ['E201']), v('agents', 'usd', ['E202']), v('team', 'usd', ['E203'])]),
  nel('u-burn-rate', 'cost', 'burn rate', 'usd per hour and input tokens per second over a sliding 15 minutes (E206/E207)', [v('usd', 'usd/h', ['E206']), v('input', 'tokens/s', ['E207'])]),
  nel('u-rate-model', 'limits', 'rate model', 'the limit weights, behaviour flags, 429s, other sessions and the MKN eta (E204/E205/E208–E210)', [v('weights', 'weights', ['E204']), v('flags', 'flags', ['E205']), v('r429', 'count', ['E208']), v('other-sessions', 'count', ['E209']), v('eta', 'eta', ['E210'])]),
  nel('u-phase-stats', 'session', 'phase stats', 'the transcript phase classifier counters (E211–E219)', [v('api-calls', 'count', ['E211']), v('api-time', 'time', ['E212']), v('retry-time', 'time', ['E213']), v('phase', 'phase', ['E214']), v('last-check', 'clock', ['E215']), v('waiting', 'count', ['E216']), v('steers', 'count', ['E217']), v('interrupts', 'count', ['E218']), v('hook-by-command', 'count', ['E219'])]),
  nel('u-ctx-band', 'context', 'context band', 'the effective window with the 13k/20k reserve and the CC footer texts (E184/E185)', [v('reserve', 'tokens', ['E184']), v('footer', 'text', ['E185'])]),
  nel('u-costclaw-score', 'cost', 'costclaw score', 'the efficiency rubric and the repeated-read figures (E438–E440)', [v('efficiency', 'score', ['E438']), v('repeats', 'count', ['E439']), v('repeat-tokens', 'tokens', ['E440'])]),
]

const SPARK = '▁▂▃▄▅▆▇█'

function valueCtx(s: State, variant: string, nf: FormatArgs['nf']): Value {
  const last = s.usage[s.usage.length - 1]
  const tUsage = s.transcriptUsage
  switch (variant) {
    case 'u-t200k':
    case 'u-regex-left': {
      const draw = (): Value => {
        if (variant === 'u-t200k') {
          if (!tUsage) return { state: 'pending' }
          const used = tUsage.input + tUsage.read + tUsage.write
          const ratio = Math.max(0, Math.min(1, used / CTX_200K))
          return ok(`${nf.tokens(used)}/${nf.tokens(CTX_200K)} ${nf.percent(ratio)}`, s.usage[s.usage.length - 1]?.at ?? 0, { num: used, unit: 'tokens', ratio })
        }
        if (s.transcriptRegexLeft === undefined) return { state: 'pending' }
        const ratio = Math.max(0, Math.min(1, s.transcriptRegexLeft / 100))
        return ok(nf.percent(ratio), s.usage[s.usage.length - 1]?.at ?? 0, { ratio })
      }
      // no path yet: the source has not answered; pending, never a zero figure
      if (s.transcriptPath === undefined) return { state: 'pending' }
      return answer(s, [K_TRANSCRIPT], s.transcriptSeen, draw)
    }
    default: {
      const draw = (): Value => {
        if (!last || last.tokens === undefined) return { state: 'pending' }
        const used = last.tokens
        const window = last.window
        switch (variant) {
          case 'u-overhead': {
            const withOh = Math.max(0, Math.min(window, used + OVERHEAD_45000))
            const ratio = withOh / window
            return ok(`${nf.tokens(withOh)}/${nf.tokens(window)} ${nf.percent(ratio)}`, last.at, { num: withOh, unit: 'tokens', ratio })
          }
          case 'u-overhead-pct': {
            const ratio = Math.max(0, Math.min(window, used + OVERHEAD_45000)) / window
            return ok(nf.percent(ratio), last.at, { ratio })
          }
          case 'u-sum-pct':
          case 'u-used-window':
            return ok(nf.percent(used / window), last.at, { ratio: used / window })
          case 'u-sum-tokens':
          case 'u-win-in':
            return ok(nf.tokens(used), last.at, { num: used, unit: 'tokens' })
          case 'u-native-pct':
            if (last.percent === undefined) return { state: 'pending' }
            return ok(nf.percent(last.percent / 100), last.at, { ratio: last.percent / 100 })
          default:
            return { state: 'pending' }
        }
      }
      return answer(s, [K_USAGE], s.usage.length > 0, draw)
    }
  }
}

const usage: Collector<State> = {
  family: 'context',
  elements: ELEMENTS,
  sources: [
    { source: { kind: 'session', call: 'usage' }, elements: ['ctx', 'cost', 'u-turn-cost', 'u-ctx-growth', 'u-turns-to-compact', 'u-tokens-to-compact', 'u-compact-threshold', 'u-ctx-categories', 'u-ctx-trend'] },
    { source: { kind: 'event', event: 'turn.complete' }, elements: ['u-turn-in', 'u-turn-out', 'u-turn-cache', 'u-turn-cache-hit', 'u-turn-death', 'u-turn-subagent', 'u-ctx-growth', 'u-turns-to-compact', 'u-ctx-trend', 'u-win-out'] },
    { source: { kind: 'event', event: 'turn.step' }, elements: ['cost', 'u-cache-hit-session'] },
    { source: { kind: 'event', event: 'tool.call' }, elements: ['u-tool-loop'] },
    { source: { kind: 'cmd', argv: ['git', 'rev-parse', '--git-dir'], everyMs: 5000, cwd: 'project' }, elements: ['u-worktree-mark'] },
    { source: { kind: 'cmd', argv: ['git', 'rev-parse', '--git-common-dir'], everyMs: 5000, cwd: 'project' }, elements: ['u-worktree-mark'] },
    { source: { kind: 'cmd', argv: ['git', 'status', '--porcelain'], everyMs: 5000, cwd: 'project' }, elements: ['u-git-staged', 'u-git-unstaged'] },
    { source: { kind: 'cmd', argv: ['sh', '-c', HANDOFF_CMD], everyMs: 30000, cwd: 'project' }, elements: ['u-handoff'] },
    { source: { kind: 'transcript', everyMs: 60000 }, elements: ['ctx', 'u-session-summary'] },
    { source: { kind: 'session', call: 'info' }, elements: ['ctx', 'u-transcript-path', 'u-session-summary'] },
    { source: { kind: 'cmd', argv: ['claude', '--version'], everyMs: 0 }, elements: ['u-newer-version'] },
    { source: { kind: 'cmd', argv: ['curl', '-fsS', '--max-time', '2', 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest'], everyMs: 21600000 }, elements: ['u-newer-version'] },
  ],
  variantsFor: [
    {
      element: 'ctx',
      variants: [
        v('u-native-pct', 'session percent (host formula unread, probe З8)', ['E156']),
        v('u-used-window', 'fallback round(used/window)', ['E157']),
        v('u-overhead', 'used + 45000 overhead', ['E109']),
        v('u-overhead-pct', 'overhead percent', ['E110']),
        v('u-sum-pct', 'input+creation+read over window', ['E118']),
        v('u-sum-tokens', 'input+creation+read', ['E120']),
        v('u-win-in', 'the window input-tokens field', ['E121']),
        v('u-t200k', 'transcript usage over the 200000 constant', ['E002']),
        v('u-regex-left', 'regex "context left until auto-compact"', ['E003']),
      ],
    },
    { element: 'cost', variants: [v('u-price-map', 'turn.step usage priced by the 2026-09-14 rate card', ['E443'])] },
  ],
  init(): State {
    return {
      usage: [], ctxSamples: [], windowOut: null, stepTotals: null, priceUsd: 0, priceSeen: false,
      transcriptSeen: false, toolRun: null, errors: {},
    }
  },
  reduce(st: State, input: Input): State {
    const s = st
    const key = srcKey(input.source)
    if (!input.ok) {
      s.errors[key] = { at: input.now, text: input.error || 'source failed', exit: false }
      return s
    }
    delete s.errors[key]
    const data = input.data
    switch (key) {
      case K_USAGE:
        reduceUsage(s, data, input.now)
        break
      case K_TURN_DONE: {
        const e = data as { agentId?: string; reason?: string; usage?: unknown } | null
        const u = usage4(e?.usage)
        const rec: TurnRec = { at: input.now, agentId: e?.agentId, reason: e?.reason, usage: u }
        s.lastTurn = rec
        if (!e?.agentId && u) s.windowOut = (s.windowOut ?? 0) + u.output
        break
      }
      case K_TURN_STEP: {
        const e = data as { usage?: unknown } | null
        const u = usage4(e?.usage)
        if (u) {
          const t = s.stepTotals ?? { input: 0, output: 0, read: 0, write: 0 }
          s.stepTotals = { input: t.input + u.input, output: t.output + u.output, read: t.read + u.read, write: t.write + u.write }
          const model = (e?.usage as { model?: unknown } | undefined)?.model
          if (typeof model === 'string' && model) s.priceUsd += priceOf(model, u)
          s.priceSeen = true
        }
        break
      }
      case K_TOOL: {
        const tool = String((data as { tool?: unknown } | null)?.tool ?? '')
        if (tool) s.toolRun = s.toolRun && s.toolRun.tool === tool ? { tool, runs: s.toolRun.runs + 1 } : { tool, runs: 1 }
        break
      }
      case K_GIT_DIR:
      case K_GIT_COMMON: {
        const out = (data as { code?: unknown; stdout?: unknown; stderr?: unknown })
        if (typeof out.code === 'number' && out.code !== 0) {
          s.errors[key] = { at: input.now, text: String(out.stderr || '').split('\n')[0] || `git exited ${out.code}`, exit: true }
          break
        }
        if (key === K_GIT_DIR) s.gitDir = String(out.stdout ?? '')
        else s.gitCommon = String(out.stdout ?? '')
        break
      }
      case K_PORCELAIN: {
        const out = (data as { code?: unknown; stdout?: unknown; stderr?: unknown })
        if (typeof out.code === 'number' && out.code !== 0) {
          s.errors[key] = { at: input.now, text: String(out.stderr || '').split('\n')[0] || `git exited ${out.code}`, exit: true }
          break
        }
        let staged = 0
        let unstaged = 0
        for (const line of String(out.stdout ?? '').split('\n')) {
          if (line.length < 4) continue
          const xy = line.slice(0, 2)
          if (xy[0] === '?' || xy[1] === '?') continue // untracked rows belong to neither column (E081 is another track)
          if (xy[0] !== ' ') staged++
          if (xy[1] !== ' ') unstaged++
        }
        s.porcel = { staged, unstaged }
        break
      }
      case K_HANDOFF: {
        const out = (data as { code?: unknown; stdout?: unknown; stderr?: unknown })
        if (typeof out.code === 'number' && out.code !== 0) {
          s.errors[key] = { at: input.now, text: String(out.stderr || '').split('\n')[0] || `handoff read exited ${out.code}`, exit: true }
          break
        }
        readHandoff(s, String(out.stdout ?? ''))
        break
      }
      case K_TRANSCRIPT: {
        // a transcript input carries the file's text itself, not a cmd envelope
        readTranscript(s, typeof data === 'string' ? data : '')
        break
      }
      case K_INFO: {
        const i = (data ?? {}) as { transcriptPath?: unknown }
        s.transcriptPath = typeof i.transcriptPath === 'string' && i.transcriptPath ? i.transcriptPath : undefined
        break
      }
      case K_VER: {
        const out = (data as { code?: unknown; stdout?: unknown; stderr?: unknown })
        if (typeof out.code === 'number' && out.code !== 0) {
          s.errors[key] = { at: input.now, text: String(out.stderr || '').split('\n')[0] || `claude --version exited ${out.code}`, exit: true }
          break
        }
        const word = String(out.stdout ?? '').trim().split(/\s+/)[0]
        if (word) s.verCur = word
        break
      }
      case K_LATEST: {
        const out = (data as { code?: unknown; stdout?: unknown; stderr?: unknown })
        if (typeof out.code === 'number' && out.code !== 0) {
          s.errors[key] = { at: input.now, text: String(out.stderr || '').split('\n')[0] || `curl exited ${out.code}`, exit: true }
          break
        }
        const word = String(out.stdout ?? '').trim().split(/\s+/)[0]
        if (word) s.verLatest = word
        break
      }
      default:
        break
    }
    return s
  },
  value(s: State, elementId: string, args: FormatArgs): Value {
    if (N_REASONS[elementId]) return { state: 'nosource', reason: N_REASONS[elementId] }
    const nf = args.nf
    const last = s.usage[s.usage.length - 1]
    switch (elementId) {
      case 'ctx':
        return valueCtx(s, args.variant, nf)
      case 'cost': {
        // the base element owns the native cost.usd field; this family only
        // computes the u-price-map variant from turn.step usage
        if (args.variant !== 'u-price-map') return { state: 'pending' }
        const draw = (): Value => (s.priceSeen ? ok(nf.usd(s.priceUsd), 0, { num: s.priceUsd, unit: 'usd' }) : { state: 'pending' })
        return answer(s, [K_TURN_STEP], s.priceSeen, draw)
      }
      case 'u-turn-in':
      case 'u-turn-out': {
        const side = elementId === 'u-turn-in' ? 'input' : 'output'
        const draw = (): Value => {
          const u = s.lastTurn?.usage
          if (!u) return { state: 'pending' }
          const n = side === 'input' ? u.input : u.output
          return ok(`${nf.tokens(n)} ${side === 'input' ? 'in' : 'out'}`, s.lastTurn?.at ?? 0, { num: n, unit: 'tokens' })
        }
        return answer(s, [K_TURN_DONE], s.lastTurn !== undefined, draw)
      }
      case 'u-turn-cache': {
        const draw = (): Value => {
          const u = s.lastTurn?.usage
          if (!u) return { state: 'pending' }
          const read = args.variant === 'write' ? u.write : u.read
          return ok(`cache ${args.variant === 'write' ? 'w' : 'r'} ${nf.tokens(read)}`, s.lastTurn?.at ?? 0, { num: read, unit: 'tokens' })
        }
        return answer(s, [K_TURN_DONE], s.lastTurn !== undefined, draw)
      }
      case 'u-turn-cache-hit': {
        const draw = (): Value => {
          const u = s.lastTurn?.usage
          if (!u) return { state: 'pending' }
          const denom = u.input + u.read + u.write
          if (denom <= 0) return { state: 'pending' }
          const ratio = u.read / denom
          return ok(`cache ${nf.percent(ratio)}`, s.lastTurn?.at ?? 0, { num: u.read, unit: 'tokens', ratio })
        }
        return answer(s, [K_TURN_DONE], s.lastTurn !== undefined, draw)
      }
      case 'u-cache-hit-session': {
        const draw = (): Value => {
          const t = s.stepTotals
          if (!t) return { state: 'pending' }
          const denom = t.input + t.write + t.read
          if (denom <= 0) return { state: 'pending' }
          const ratio = t.read / denom
          return ok(`cache health ${nf.percent(ratio)}`, 0, { num: t.read, unit: 'tokens', ratio })
        }
        return answer(s, [K_TURN_STEP], s.stepTotals !== null, draw)
      }
      case 'u-turn-cost': {
        const draw = (): Value => {
          const c = s.turnCost
          if (!c) return { state: 'pending' }
          return ok(`last turn ${nf.usd(c.usd)}`, c.at, { num: c.usd, unit: 'usd' })
        }
        return answer(s, [K_USAGE], s.turnCost !== undefined, draw)
      }
      case 'u-turn-death': {
        const draw = (): Value => {
          const r = s.lastTurn?.reason
          const text = r === 'error' ? 'Last turn ended in an API error' : r === 'refusal' ? 'Last turn ended in a refusal' : ''
          return ok(text, s.lastTurn?.at ?? 0)
        }
        return answer(s, [K_TURN_DONE], s.lastTurn !== undefined, draw)
      }
      case 'u-turn-subagent': {
        const draw = (): Value => ok(s.lastTurn?.agentId !== undefined ? '*' : '', s.lastTurn?.at ?? 0)
        return answer(s, [K_TURN_DONE], s.lastTurn !== undefined, draw)
      }
      case 'u-ctx-growth': {
        const draw = (): Value => {
          const diffs = ctxDiffs(s)
          if (!diffs.length) return { state: 'pending' }
          if (args.variant === 'last') {
            const d = diffs[diffs.length - 1]
            return ok(`+${nf.tokens(d)} last turn`, s.ctxSamples[s.ctxSamples.length - 1].at, { num: d, unit: 'tokens' })
          }
          if (args.variant === 'average') {
            const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length
            return ok(`+${nf.tokens(Math.round(avg))} average over ${diffs.length} turns`, s.ctxSamples[s.ctxSamples.length - 1].at, { num: Math.round(avg), unit: 'tokens' })
          }
          let ema = diffs[0]
          for (let i = 1; i < diffs.length; i++) ema += (diffs[i] - ema) * EMA_ALPHA
          return ok(`ema +${nf.tokens(Math.round(ema))}`, s.ctxSamples[s.ctxSamples.length - 1].at, { num: Math.round(ema), unit: 'tokens' })
        }
        return answer(s, [K_USAGE], s.ctxSamples.length > 1, draw)
      }
      case 'u-turns-to-compact': {
        const draw = (): Value => {
          const thr = last?.threshold
          const used = last?.tokens
          if (thr === undefined || used === undefined) return { state: 'pending' }
          const diffs = ctxDiffs(s)
          if (!diffs.length) return { state: 'pending' }
          let rate: number
          if (args.variant === 'ema') {
            let ema = diffs[0]
            for (let i = 1; i < diffs.length; i++) ema += (diffs[i] - ema) * EMA_ALPHA
            rate = ema
          } else {
            rate = diffs.reduce((a, b) => a + b, 0) / diffs.length // 'average' and the compactAt source share the average slope
          }
          if (rate <= 0) return { state: 'pending' }
          const left = thr - used
          if (left <= 0) return ok('compact next turn', last.at, { num: 0, unit: 'count' })
          const turns = Math.floor(left / rate)
          if (turns > 99) return ok('99+ turns to compact', last.at, { num: 99, unit: 'count' })
          return ok(`${turns} turns to compact`, last.at, { num: turns, unit: 'count' })
        }
        return answer(s, [K_USAGE], s.usage.length > 0, draw)
      }
      case 'u-tokens-to-compact': {
        const draw = (): Value => {
          const thr = last?.threshold
          const used = last?.tokens
          if (thr === undefined || used === undefined) return { state: 'pending' }
          const n = Math.max(0, thr - used)
          return ok(`${nf.tokens(n)} tokens to compaction`, last.at, { num: n, unit: 'tokens' })
        }
        return answer(s, [K_USAGE], s.usage.length > 0, draw)
      }
      case 'u-compact-threshold': {
        const draw = (): Value => {
          if (!last || (last.threshold === undefined && last.rawMax === undefined)) return { state: 'pending' }
          if (args.variant === 'nature') {
            return ok(last.threshold !== undefined ? 'where auto-compaction runs' : 'window itself', last.at)
          }
          const n = last.threshold ?? (last.rawMax as number)
          return ok(nf.tokens(n), last.at, { num: n, unit: 'tokens' })
        }
        return answer(s, [K_USAGE], s.usage.length > 0, draw)
      }
      case 'u-ctx-categories': {
        const draw = (): Value => {
          const cats = last?.categories
          const total = last?.totalTokens
          if (!cats || cats.length === 0 || total === undefined) return { state: 'pending' }
          const rows: Row[] = cats.map((c) => ({ label: c.name, right: `${nf.tokens(c.tokens)} ${nf.percent(c.tokens / total)}` }))
          return ok(`${rows.length} categories`, last.at, { rows })
        }
        return answer(s, [K_USAGE], s.usage.length > 0, draw)
      }
      case 'u-ctx-trend': {
        const draw = (): Value => {
          const xs = s.ctxSamples.slice(-TREND_CELLS)
          if (xs.length < 2) return { state: 'pending' }
          const min = Math.min(...xs.map((x) => x.tokens))
          const max = Math.max(...xs.map((x) => x.tokens))
          const cells = xs.map((x) => SPARK[max > min ? Math.round((SPARK.length - 1) * ((x.tokens - min) / (max - min))) : (SPARK.length - 1) >> 1])
          return ok(cells.join(''), xs[xs.length - 1].at)
        }
        return answer(s, [K_USAGE], s.ctxSamples.length > 1, draw)
      }
      case 'u-git-staged':
      case 'u-git-unstaged': {
        const draw = (): Value => {
          const p = s.porcel
          if (!p) return { state: 'pending' }
          const n = elementId === 'u-git-staged' ? p.staged : p.unstaged
          return ok(`${elementId === 'u-git-staged' ? 'staged' : 'unstaged'} ${nf.count(n)}`, 0, { num: n, unit: 'count' })
        }
        return answer(s, [K_PORCELAIN], s.porcel !== undefined, draw)
      }
      case 'u-handoff': {
        const draw = (): Value => {
          const h = s.handoff
          if (!h) return { state: 'pending' }
          if (args.variant === 'now') {
            if (h.now === undefined) return { state: 'pending' }
            return ok(`now: ${h.now}`, 0)
          }
          if (h.goal === undefined) return { state: 'pending' }
          return ok(`goal: ${h.goal}`, 0)
        }
        return answer(s, [K_HANDOFF], s.handoff !== undefined, draw)
      }
      case 'u-session-summary': {
        if (s.transcriptPath === undefined) return { state: 'pending' }
        const draw = (): Value => (s.transcriptSummary !== undefined ? ok(s.transcriptSummary, 0) : ok('', 0))
        return answer(s, [K_TRANSCRIPT, K_INFO], s.transcriptSeen, draw)
      }
      case 'u-transcript-path': {
        if (s.transcriptPath === undefined) return { state: 'nosource', reason: 'transcript path not yet received from the host' }
        return ok(s.transcriptPath, 0)
      }
      case 'u-newer-version': {
        // latest-side failures decide the state (ADJUDICATION-v0.5-data-usage AR1)
        const errL = s.errors[K_LATEST]
        if (errL && !errL.exit) return { state: 'nosource', reason: 'curl unavailable: ' + errL.text }
        const cur = s.verCur
        const latest = s.verLatest
        const newer = (): boolean => {
          const parts = (x: string) => x.split('.').map((p) => Number(p))
          const a = parts(cur!)
          const b = parts(latest!)
          for (let i = 0; i < Math.max(a.length, b.length); i++) {
            const d = (b[i] ?? 0) - (a[i] ?? 0)
            if (d !== 0) return d > 0
          }
          return false
        }
        if (errL) {
          if (cur === undefined || latest === undefined) return { state: 'nosource', reason: errL.text }
          return { state: 'stale', last: ok(newer() ? `↑${latest}` : '', 0), reason: errL.text }
        }
        if (cur === undefined || latest === undefined) {
          const errC = s.errors[K_VER]
          if (errC && errC.exit) return { state: 'nosource', reason: errC.text }
          return { state: 'pending' }
        }
        return ok(newer() ? `↑${latest}` : '', 0)
      }
      case 'u-win-out': {
        const draw = (): Value => {
          const n = s.windowOut
          if (n === null) return { state: 'pending' }
          return ok(`${nf.tokens(n)} out this window`, s.lastTurn?.at ?? 0, { num: n, unit: 'tokens' })
        }
        return answer(s, [K_TURN_DONE], s.windowOut !== null, draw)
      }
      case 'u-tool-loop': {
        const draw = (): Value => {
          const runs = s.toolRun?.runs ?? 0
          const word = runs >= LOOP_ACTIVE ? 'active' : runs === LOOP_EMERGING ? 'emerging' : 'none'
          return ok(`tool loop ${word}`, 0)
        }
        return answer(s, [K_TOOL], s.toolRun !== null, draw)
      }
      case 'u-worktree-mark': {
        const draw = (): Value => {
          if (s.gitDir === undefined || s.gitCommon === undefined) return { state: 'pending' }
          return ok(s.gitDir.trim() !== s.gitCommon.trim() ? '⑂' : '', 0)
        }
        return answer(s, [K_GIT_DIR, K_GIT_COMMON], s.gitDir !== undefined && s.gitCommon !== undefined, draw)
      }
      default:
        return { state: 'pending' }
    }
  },
}

export default usage
