import { expect, test } from 'claude-code/testing'
import usage from '../hooks/data/usage'
import type { FormatArgs, Input, Source, Value } from '../hooks/data/types'

// The teeth of the usage family (T-ctx: context, tokens, cost, limits): every
// element's pending/ok/stale/nosource arc and every variant's formula checked
// against numbers derived from the fed inputs, never from the output. The
// collector is pure, so the world here is just Input records fed to reduce.

type St = ReturnType<typeof usage.init>

const nf = {
  tokens: (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)),
  usd: (n: number) => `$${n.toFixed(4)}`,
  percent: (r: number) => `${Math.round(r * 100)}%`,
  duration: (ms: number) => `${Math.round(ms / 1000)}s`,
  bytes: (n: number) => `${n}B`,
  count: (n: number) => String(n),
  rate: (v: number, u: string) => `${v}/${u}`,
}

// kit's expect has no toBeCloseTo: assert nearness, failing with both numbers
const near = (a: number, b: number, eps: number) => {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`near failed: ${a} vs ${b} (eps ${eps})`)
}

const F = (variant = '', options: Record<string, unknown> = {}): FormatArgs => ({ variant, options, nf })
const I = (source: Source, data: unknown, now = 1000): Input => ({ source, ok: true, data, now })
const E = (source: Source, error: string, now = 2000): Input => ({ source, ok: false, error, now })
const feed = (s: St, ...ins: Input[]): St => ins.reduce((st, i) => usage.reduce(st, i) as St, s)
const val = (s: St, elementId: string, args: FormatArgs): Value => usage.value(s, elementId, args)

// The sources the family declares, spelled exactly as the module ships them.
const SRC_USAGE: Source = { kind: 'session', call: 'usage' }
const SRC_TURN_DONE: Source = { kind: 'event', event: 'turn.complete' }
const SRC_TURN_STEP: Source = { kind: 'event', event: 'turn.step' }
const SRC_TOOL: Source = { kind: 'event', event: 'tool.call' }
const SRC_GIT_DIR: Source = { kind: 'cmd', argv: ['git', 'rev-parse', '--git-dir'], everyMs: 5000, cwd: 'project' }
const SRC_GIT_COMMON: Source = { kind: 'cmd', argv: ['git', 'rev-parse', '--git-common-dir'], everyMs: 5000, cwd: 'project' }
const SRC_PORCELAIN: Source = { kind: 'cmd', argv: ['git', 'status', '--porcelain'], everyMs: 5000, cwd: 'project' }
const HANDOFF_CMD = 'cat "$(ls -t thoughts/shared/handoffs/*.yaml thoughts/shared/handoffs/*.yml .catalyst/handoffs/*.yaml .catalyst/handoffs/*.yml 2>/dev/null | head -n 1)"'
const SRC_HANDOFF: Source = { kind: 'cmd', argv: ['sh', '-c', HANDOFF_CMD], everyMs: 30000, cwd: 'project' }
// S1b: the transcript is the core's own source kind; the path rides session info
const SRC_TRANSCRIPT: Source = { kind: 'transcript', everyMs: 60000 }
const SRC_INFO: Source = { kind: 'session', call: 'info' }
// S1b: E119 reads the same claude --version run as the base ver element
const SRC_VER: Source = { kind: 'cmd', argv: ['claude', '--version'], everyMs: 0 }
const SRC_LATEST: Source = { kind: 'cmd', argv: ['curl', '-fsS', '--max-time', '2', 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest'], everyMs: 21600000 }

const USE1 = { startedAt: 0, context: { tokens: 145000, window: 200000, percent: 72.5 }, rateLimits: [], cost: { usd: 4.1 } }
const USE2 = { startedAt: 0, context: { tokens: 83000, window: 1000000 }, rateLimits: [], cost: { usd: 1 } }

const TURN1 = {
  turnId: 't1', answer: '', durationMs: 5000, isAborted: false, reason: 'answer',
  usage: { input_tokens: 46000, output_tokens: 5000, cache_read_input_tokens: 150000, cache_creation_input_tokens: 1000, model: 'claude-opus-5' },
}

const stepUsage = (model: string, input: number, output: number, read: number, write: number) => ({
  turnId: 't9', index: 1, answer: '', toolUses: [], stopReason: 'end_turn',
  usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write, model },
})

test('ctx +45000 and window variants compute from the same usage read; pending before it', () => {
  const s0 = usage.init() as St
  expect(val(s0, 'ctx', F('u-overhead'))).toEqual({ state: 'pending' })
  const s = feed(s0, I(SRC_USAGE, USE1))
  const v = val(s, 'ctx', F('u-overhead')) as { state: string; num: number; ratio: number; text: string }
  expect(v.state).toBe('ok')
  expect(v.num).toBe(190000) // 145000 + 45000
  near(v.ratio, 190000 / 200000, 1e-9)
  expect(v.text).toContain('190k/200k')
  expect(v.text).toContain('95%')
  expect((val(s, 'ctx', F('u-overhead-pct')) as { text: string }).text).toBe('95%')
  expect((val(s, 'ctx', F('u-sum-pct')) as { text: string }).text).toBe('73%') // round(145000/200000*100)
  expect((val(s, 'ctx', F('u-sum-tokens')) as { num: number }).num).toBe(145000)
  expect((val(s, 'ctx', F('u-win-in')) as { num: number }).num).toBe(145000)
  expect((val(s, 'ctx', F('u-native-pct')) as { text: string }).text).toBe('73%') // the read said 72.5
})

test('ctx fallback variant rounds used over window when the native percent is absent', () => {
  const s = feed(usage.init() as St, I(SRC_USAGE, USE2))
  expect((val(s, 'ctx', F('u-used-window')) as { text: string }).text).toBe('8%') // 83000/1000000
  expect(val(s, 'ctx', F('u-native-pct'))).toEqual({ state: 'pending' }) // no percent field came
})

test('ctx transcript variants: the /200000 denominator and the regex-remaining formula', () => {
  const tr = [
    '{"type":"assistant","message":{"usage":{"input_tokens":1000,"output_tokens":40,"cache_read_input_tokens":2000,"cache_creation_input_tokens":500}}}',
    '{"type":"user","message":{"content":"hi"}}',
    '{"type":"assistant","message":{"usage":{"input_tokens":3000,"output_tokens":60,"cache_read_input_tokens":4000,"cache_creation_input_tokens":3000}}}',
    '{"type":"user","message":{"content":"Context left until auto-compact: 25%"}}',
  ].join('\n')
  const s = feed(usage.init() as St, I(SRC_INFO, { cwd: '/w', root: '/w', id: 's', turns: 0, transcriptPath: '/t/x.jsonl' }), I(SRC_TRANSCRIPT, tr))
  const v = val(s, 'ctx', F('u-t200k')) as { num: number; ratio: number }
  expect(v.num).toBe(10000) // 3000+4000+3000 of the LAST usage record
  near(v.ratio, 10000 / 200000, 1e-9)
  expect((val(s, 'ctx', F('u-regex-left')) as { text: string }).text).toBe('75%') // 100 - 25
})

test('Y2: without a transcript path the transcript formulas and the summary stay pending, never zero', () => {
  const s0 = usage.init() as St
  expect(val(s0, 'ctx', F('u-t200k'))).toEqual({ state: 'pending' })
  expect(val(s0, 'ctx', F('u-regex-left'))).toEqual({ state: 'pending' })
  expect(val(s0, 'u-session-summary', F())).toEqual({ state: 'pending' })
  const p = val(s0, 'u-transcript-path', F()) as { state: string; reason: string }
  expect(p.state).toBe('nosource')
  expect(p.reason).toBe('transcript path not yet received from the host')
})

test('ctx transcript variants stay pending while the host has not published a path', () => {
  const s = feed(usage.init() as St, I(SRC_INFO, { cwd: '/w', root: '/w', id: 's', turns: 0 }))
  const v = val(s, 'ctx', F('u-t200k')) as { state: string }
  expect(v.state).toBe('pending')
})

test('cost u-price-map prices turn.step usage by the dated rate card, model by model', () => {
  const s = feed(usage.init() as St,
    I(SRC_TURN_STEP, stepUsage('claude-opus-5', 1000, 2000, 4000, 5000)),
    I(SRC_TURN_STEP, stepUsage('claude-sonnet-5', 1750, 0, 0, 0)))
  const v = val(s, 'cost', F('u-price-map')) as { num: number; unit: string }
  near(v.num, (1000 * 5 + 2000 * 25 + 5000 * 6.25 + 4000 * 0.5 + 1750 * 2) / 1e6, 1e-12)
  expect(v.unit).toBe('usd')
  expect(val(usage.init() as St, 'cost', F('u-price-map'))).toEqual({ state: 'pending' })
})

test('turn tokens: pending before the turn, both sides and the cache columns after, stale keeps the last value', () => {
  const s0 = usage.init() as St
  expect(val(s0, 'u-turn-in', F())).toEqual({ state: 'pending' })
  const s = feed(s0, I(SRC_TURN_DONE, TURN1))
  expect((val(s, 'u-turn-in', F()) as { num: number; text: string }).text).toBe('46k in')
  expect((val(s, 'u-turn-out', F()) as { text: string }).text).toBe('5k out')
  expect((val(s, 'u-turn-cache', F('read')) as { num: number }).num).toBe(150000)
  expect((val(s, 'u-turn-cache', F('write')) as { num: number }).num).toBe(1000)
  const hit = val(s, 'u-turn-cache-hit', F()) as { ratio: number; text: string }
  near(hit.ratio, 150000 / 197000, 1e-9) // 197000 = 46000+150000+1000
  expect(hit.text).toContain('76%')
  const st = val(feed(s, E(SRC_TURN_DONE, 'subscription gone')), 'u-turn-in', F()) as { state: string; last: { num: number }; reason: string }
  expect(st.state).toBe('stale')
  expect(st.last.num).toBe(46000)
  expect(st.reason).toContain('subscription gone')
})

test('a source failure before any success stays pending, never zero and never stale', () => {
  const s = feed(usage.init() as St, E(SRC_TURN_DONE, 'boom'))
  expect(val(s, 'u-turn-in', F())).toEqual({ state: 'pending' })
})

test('turn death reason and the subagent flag', () => {
  const s1 = feed(usage.init() as St, I(SRC_TURN_DONE, { ...TURN1, reason: 'error', usage: undefined }))
  expect((val(s1, 'u-turn-death', F()) as { text: string }).text).toBe('Last turn ended in an API error')
  const s2 = feed(s1, I(SRC_TURN_DONE, { ...TURN1, reason: 'refusal', usage: undefined }))
  expect((val(s2, 'u-turn-death', F()) as { text: string }).text).toBe('Last turn ended in a refusal')
  expect((val(s2, 'u-turn-subagent', F()) as { text: string }).text).toBe('')
  const s3 = feed(s2, I(SRC_TURN_DONE, { ...TURN1, agentId: 'ag1' }))
  expect((val(s3, 'u-turn-subagent', F()) as { text: string }).text).toBe('*')
})

test('session cache hit-rate sums over turn.step readings (E441)', () => {
  const s = feed(usage.init() as St,
    I(SRC_TURN_STEP, stepUsage('claude-opus-5', 1000, 100, 3000, 1000)),
    I(SRC_TURN_STEP, stepUsage('claude-opus-5', 2000, 50, 6000, 0)))
  const v = val(s, 'u-cache-hit-session', F()) as { ratio: number }
  near(v.ratio, 9000 / 13000, 1e-9) // read 9000 of in 3000 + write 1000 + read 9000
})

test('u-turn-cost: the difference of two consecutive usage reads; one read is still pending', () => {
  const s1 = feed(usage.init() as St, I(SRC_USAGE, { ...USE1, cost: { usd: 4.1 } }))
  expect(val(s1, 'u-turn-cost', F())).toEqual({ state: 'pending' })
  const s2 = feed(s1, I(SRC_USAGE, { ...USE1, cost: { usd: 4.3394 } }))
  const v = val(s2, 'u-turn-cost', F()) as { num: number }
  near(v.num, 0.2394, 1e-9)
})

test('u-ctx-growth: last delta, average over the deltas, EMA alpha=1/5', () => {
  const s = feed(usage.init() as St,
    I(SRC_USAGE, { ...USE2, context: { tokens: 100000, window: 1000000 } }, 1000),
    I(SRC_USAGE, { ...USE2, context: { tokens: 145000, window: 1000000 } }, 2000),
    I(SRC_USAGE, { ...USE2, context: { tokens: 160000, window: 1000000 } }, 3000))
  expect((val(s, 'u-ctx-growth', F('last')) as { num: number }).num).toBe(15000) // 160000 - 145000
  const avg = val(s, 'u-ctx-growth', F('average')) as { num: number; text: string }
  expect(avg.num).toBe(30000) // (45000+15000)/2
  expect(avg.text).toContain('over 2 turns')
  expect((val(s, 'u-ctx-growth', F('ema')) as { num: number }).num).toBe(39000) // 45000 + (15000-45000)/5
})

test('u-turns-to-compact: average, ema, compactAt source, the 99+ cap and the next-turn case', () => {
  const mk = (threshold: number | undefined, tokens: number, window = 200000) => ({
    startedAt: 0, rateLimits: [], cost: { usd: 1 },
    context: {
      tokens, window,
      breakdown: threshold === undefined ? undefined : { autoCompactThreshold: threshold, rawMaxTokens: 400000, totalTokens: tokens, categories: [] },
    },
  })
  const s = feed(usage.init() as St,
    I(SRC_USAGE, mk(367000, 100000), 1000),
    I(SRC_USAGE, mk(367000, 130000), 2000),
    I(SRC_USAGE, mk(367000, 145000), 3000))
  expect((val(s, 'u-turns-to-compact', F('average')) as { num: number }).num).toBe(9) // floor(222000/22500)
  expect((val(s, 'u-turns-to-compact', F('ema')) as { num: number }).num).toBe(8) // floor(222000/27000)
  expect((val(s, 'u-turns-to-compact', F('compact')) as { num: number }).num).toBe(9)
  const cap = feed(usage.init() as St,
    I(SRC_USAGE, mk(367000, 1000), 1000),
    I(SRC_USAGE, mk(367000, 1002), 2000))
  expect((val(cap, 'u-turns-to-compact', F('average')) as { text: string }).text).toBe('99+ turns to compact')
  const next = feed(usage.init() as St,
    I(SRC_USAGE, mk(367000, 366000, 400000), 1000),
    I(SRC_USAGE, mk(367000, 367000, 400000), 2000))
  expect((val(next, 'u-turns-to-compact', F('average')) as { text: string }).text).toBe('compact next turn')
})

test('u-tokens-to-compact: threshold minus used (E413)', () => {
  const s = feed(usage.init() as St, I(SRC_USAGE, {
    startedAt: 0, rateLimits: [], cost: { usd: 1 },
    context: { tokens: 145000, window: 200000, breakdown: { autoCompactThreshold: 367000, rawMaxTokens: 400000, totalTokens: 145000, categories: [] } },
  }))
  const v = val(s, 'u-tokens-to-compact', F()) as { num: number; text: string }
  expect(v.num).toBe(222000)
  expect(v.text).toContain('222k tokens to compaction')
})

test('u-compact-threshold: figure and nature; without auto-compact the raw window and "window itself"', () => {
  const withT = feed(usage.init() as St, I(SRC_USAGE, {
    startedAt: 0, rateLimits: [], cost: { usd: 1 },
    context: { tokens: 145000, window: 200000, breakdown: { autoCompactThreshold: 367000, rawMaxTokens: 400000, totalTokens: 145000, categories: [] } },
  }))
  expect((val(withT, 'u-compact-threshold', F('tokens')) as { num: number }).num).toBe(367000)
  expect((val(withT, 'u-compact-threshold', F('nature')) as { text: string }).text).toBe('where auto-compaction runs')
  const withoutT = feed(usage.init() as St, I(SRC_USAGE, {
    startedAt: 0, rateLimits: [], cost: { usd: 1 },
    context: { tokens: 145000, window: 200000, breakdown: { rawMaxTokens: 400000, totalTokens: 145000, categories: [] } },
  }))
  expect((val(withoutT, 'u-compact-threshold', F('tokens')) as { num: number }).num).toBe(400000)
  expect((val(withoutT, 'u-compact-threshold', F('nature')) as { text: string }).text).toBe('window itself')
})

test('u-ctx-categories: rows carry label, tokens and percent of the breakdown total', () => {
  const s = feed(usage.init() as St, I(SRC_USAGE, {
    startedAt: 0, rateLimits: [], cost: { usd: 1 },
    context: {
      tokens: 330413, window: 400000,
      breakdown: {
        totalTokens: 350000, rawMaxTokens: 400000,
        categories: [
          { name: 'System prompt', tokens: 5762, color: 'promptBorder', isDeferred: false, kind: 'used' },
          { name: 'Free space', tokens: 324651, color: 'inactive', isDeferred: false, kind: 'free' },
        ],
      },
    },
  }))
  const v = val(s, 'u-ctx-categories', F()) as { rows: { label: string; right: string }[] }
  expect(v.rows.length).toBe(2)
  expect(v.rows[0].label).toBe('System prompt')
  expect(v.rows[0].right).toContain('6k') // nf.tokens(5762) with the test's rounding nf
  expect(v.rows[0].right).toContain('2%') // 5762/350000
})

test('u-ctx-trend: a 10-cell sparkline normalised min..max', () => {
  let s = usage.init() as St
  for (let i = 1; i <= 10; i++) s = feed(s, I(SRC_USAGE, { ...USE2, context: { tokens: i * 10000, window: 1000000 } }, i * 100))
  const v = val(s, 'u-ctx-trend', F()) as { text: string }
  expect(v.text.length).toBe(10)
  expect(v.text[0]).toBe('▁')
  expect(v.text[9]).toBe('█')
})

test('worktree mark: equal dirs draw nothing, a worktree draws the glyph, dead git names the source', () => {
  const s0 = usage.init() as St
  const dead = val(s0, 'u-worktree-mark', F()) as { state: string }
  expect(dead.state).toBe('pending')
  const deadAfter = val(feed(s0,
    I(SRC_GIT_DIR, { code: 128, stdout: '', stderr: 'fatal: not a git repository\n' }),
    I(SRC_GIT_COMMON, { code: 128, stdout: '', stderr: 'fatal: not a git repository\n' })), 'u-worktree-mark', F()) as { state: string; reason: string }
  expect(deadAfter.state).toBe('nosource')
  expect(deadAfter.reason).toContain('not a git repository')
  const plain = feed(s0, I(SRC_GIT_DIR, { code: 0, stdout: '.git\n', stderr: '' }), I(SRC_GIT_COMMON, { code: 0, stdout: '.git\n', stderr: '' }))
  expect((val(plain, 'u-worktree-mark', F()) as { text: string }).text).toBe('')
  const wt = feed(s0, I(SRC_GIT_DIR, { code: 0, stdout: '/r/.git/worktrees/w1\n', stderr: '' }), I(SRC_GIT_COMMON, { code: 0, stdout: '/r/.git\n', stderr: '' }))
  expect((val(wt, 'u-worktree-mark', F()) as { text: string }).text).toBe('⑂')
})

test('porcelain counts: X and Y columns count, ?? rows belong to neither; a later failure goes stale', () => {
  const s = feed(usage.init() as St, I(SRC_PORCELAIN, { code: 0, stdout: 'M  a.ts\n M b.ts\n?? c.ts\nDD d.ts\n', stderr: '' }))
  expect((val(s, 'u-git-staged', F()) as { num: number }).num).toBe(2) // 'M ', 'DD'
  expect((val(s, 'u-git-unstaged', F()) as { num: number }).num).toBe(2) // ' M', 'DD'
  const st = val(feed(s, E(SRC_PORCELAIN, 'git crashed')), 'u-git-staged', F()) as { state: string; last: { num: number } }
  expect(st.state).toBe('stale')
  expect(st.last.num).toBe(2)
})

test('handoff: goal and now fields of the freshest file', () => {
  const s = feed(usage.init() as St, I(SRC_HANDOFF, { code: 0, stdout: 'goal: ship the audit\nnow: reading gates\n', stderr: '' }))
  expect((val(s, 'u-handoff', F('goal')) as { text: string }).text).toBe('goal: ship the audit')
  expect((val(s, 'u-handoff', F('now')) as { text: string }).text).toBe('now: reading gates')
  const none = val(usage.init() as St, 'u-handoff', F('goal')) as { state: string }
  expect(none.state).toBe('pending')
})

test('transcript path from session info and the last summary record', () => {
  const s = feed(usage.init() as St,
    I(SRC_INFO, { cwd: '/w', root: '/w', id: 's', turns: 0, transcriptPath: '/t/x.jsonl' }),
    I(SRC_TRANSCRIPT, '{"type":"summary","summary":"First"}\n{"type":"assistant","message":{}}\n{"type":"summary","summary":"Second\\nline"}\n'))
  expect((val(s, 'u-transcript-path', F()) as { text: string }).text).toBe('/t/x.jsonl')
  expect((val(s, 'u-session-summary', F()) as { text: string }).text).toBe('Second line')
  const noPath = val(usage.init() as St, 'u-transcript-path', F()) as { state: string; reason: string }
  expect(noPath.state).toBe('nosource')
  expect(noPath.reason).toContain('transcript path')
})

test('Y4: E119 newer version — latest and current from cmd runs; component-wise compare', () => {
  const cur = (v: string) => I(SRC_VER, { code: 0, stdout: v + ' (tweakcc)\n', stderr: '' })
  const latest = (v: string) => I(SRC_LATEST, { code: 0, stdout: v + '\n', stderr: '' })
  const arrow = (s: St): string => {
    const v = val(s, 'u-newer-version', F()) as { state: string; text: string }
    expect(v.state).toBe('ok')
    return v.text
  }
  expect(arrow(feed(usage.init() as St, cur('2.1.281'), latest('2.1.282')))).toBe('↑2.1.282')
  expect(arrow(feed(usage.init() as St, cur('2.1.281'), latest('2.1.281')))).toBe('')
  expect(arrow(feed(usage.init() as St, cur('2.1.283'), latest('2.1.282')))).toBe('')
  expect(arrow(feed(usage.init() as St, cur('2.1.9'), latest('2.1.10')))).toBe('↑2.1.10')
  // a refused curl launch: nosource naming curl, never a guess
  const refused = val(feed(usage.init() as St, cur('2.1.281'), E(SRC_LATEST, 'spawn curl ENOENT')), 'u-newer-version', F()) as { state: string; reason: string }
  expect(refused.state).toBe('nosource')
  expect(refused.reason).toBe('curl unavailable: spawn curl ENOENT')
  // a non-zero curl exit with no earlier value: nosource with the stderr text
  const fresh = val(feed(usage.init() as St, cur('2.1.281'), I(SRC_LATEST, { code: 22, stdout: '', stderr: 'the requested URL returned error: 404\n' })), 'u-newer-version', F()) as { state: string; reason: string }
  expect(fresh.state).toBe('nosource')
  expect(fresh.reason).toContain('404')
  // the same exit after a good read keeps the last pair as stale
  const st = val(feed(feed(usage.init() as St, cur('2.1.281'), latest('2.1.282')), I(SRC_LATEST, { code: 22, stdout: '', stderr: 'net down\n' })), 'u-newer-version', F()) as { state: string; last: { text: string }; reason: string }
  expect(st.state).toBe('stale')
  expect(st.last.text).toBe('↑2.1.282')
  expect(st.reason).toContain('net down')
  // both sources declared but unanswered: pending, never a zero-marked pair
  expect(val(usage.init() as St, 'u-newer-version', F())).toEqual({ state: 'pending' })
})

test('u-win-out: main turns only, summed since the first read', () => {
  const s = feed(usage.init() as St,
    I(SRC_TURN_DONE, TURN1),
    I(SRC_TURN_DONE, { ...TURN1, turnId: 't2', usage: { ...TURN1.usage, output_tokens: 3000 } }),
    I(SRC_TURN_DONE, { ...TURN1, turnId: 't3', agentId: 'ag1', usage: { ...TURN1.usage, output_tokens: 777 } }))
  expect((val(s, 'u-win-out', F()) as { num: number }).num).toBe(8000)
})

test('u-tool-loop: three same-tool runs in a row is active, two emerging, another tool resets', () => {
  const call = (tool: string) => I(SRC_TOOL, { tool, tool_use_id: 'x' })
  const three = feed(usage.init() as St, call('Bash'), call('Bash'), call('Bash'))
  expect((val(three, 'u-tool-loop', F()) as { text: string }).text).toBe('tool loop active')
  const two = feed(usage.init() as St, call('Bash'), call('Bash'))
  expect((val(two, 'u-tool-loop', F()) as { text: string }).text).toBe('tool loop emerging')
  const reset = feed(two, call('Read'))
  expect((val(reset, 'u-tool-loop', F()) as { text: string }).text).toBe('tool loop none')
})

test('every unavailable element answers nosource with its table reason', () => {
  const cases: [string, string][] = [
    ['u-ctx-reserve', 'remaining_percentage'],
    ['u-exceeds-200k', 'exceeds_200k_tokens'],
    ['u-prompt-cache', 'prompt_cache'],
    ['u-rate-derived', 'rateLimits пуст'],
    ['u-budget-guard', 'budget-guard'],
    ['u-thinking-mode', 'thinking/fast'],
    ['u-ctx-anatomy', 'anatomy/source-разбивки'],
    ['u-usage-dedup', 'досъёме формул'],
    ['u-cost-ledger', 'досъёме формул'],
    ['u-burn-rate', 'досъёме формул'],
    ['u-rate-model', 'досъёме формул'],
    ['u-phase-stats', 'досъёме формул'],
    ['u-ctx-band', 'досъёме формул'],
    ['u-costclaw-score', 'costclaw'],
  ]
  const s = usage.init() as St
  for (const [id, needle] of cases) {
    const v = val(s, id, F()) as { state: string; reason: string }
    expect(v.state).toBe('nosource')
    expect(v.reason).toContain(needle)
  }
})

test('registry: unique u- ids, no base collisions, every catalogue line placed exactly once', () => {
  const BASE = ['model', 'route', 'ctx', 'brk', 'sum', 'spd', 'dur', 'cfg', 'style', 'ver', 'name', 'rl', 'cost', 'git', 'git-branch', 'directory', 'branch', 'github', 'five-hour-limit', 'weekly-limit', 'session', 'todo', 'ag', 'tools', 'ram', 'path', 'static', 'tokens-total']
  const ids = usage.elements.map((e) => e.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of ids) {
    expect(id.startsWith('u-')).toBe(true)
    expect(BASE).not.toContain(id)
  }
  const placed: string[] = []
  const take = (lines: string[] | undefined) => { for (const l of lines ?? []) placed.push(l) }
  for (const e of usage.elements) { take(e.catalogue); for (const v of e.variants) take(v.catalogue) }
  for (const vf of usage.variantsFor ?? []) for (const v of vf.variants) take(v.catalogue)
  const dup = placed.filter((l, i) => placed.indexOf(l) !== i)
  expect(dup).toEqual([])
  expect(placed.length).toBe(103)
})

test('unavailable elements declare their variants with catalogue lines', () => {
  const n = usage.elements.filter((e) => e.outcome === 'N')
  expect(n.length).toBe(14)
  for (const e of n) {
    expect(e.reason).toBeTruthy()
    expect(e.variants.length).toBeGreaterThan(0)
    for (const v of e.variants) expect((v.catalogue ?? []).length).toBeGreaterThan(0)
  }
})

test('ctx and cost variants are contributed to the base elements under u- ids', () => {
  const ctx = (usage.variantsFor ?? []).find((v) => v.element === 'ctx')
  const cost = (usage.variantsFor ?? []).find((v) => v.element === 'cost')
  expect((ctx?.variants ?? []).map((v) => v.id).sort()).toEqual(['u-native-pct', 'u-overhead', 'u-overhead-pct', 'u-regex-left', 'u-sum-pct', 'u-sum-tokens', 'u-t200k', 'u-used-window', 'u-win-in'])
  expect((cost?.variants ?? []).map((v) => v.id)).toEqual(['u-price-map'])
})
