import { expect, test } from 'claude-code/testing'
import type { Input, Source } from '../hooks/data/types'
import {
  parseTemplate, serializeTemplate, templateRoundTrip, sameLayout, presetLines, REGISTRY_IDS,
  __render, __feed, __diag, __activeSources, __savedIds, __resetState, __setArmEvery, __syncSourceTimers, __refresh, __timerRefusedSize, elementIdOf, parseElements, serializeElements, buildNf, valueOf, resolveView,
} from '../hooks/statusline'
import { world, start, BAND_MOUNT, walk, rowText, SURFACES } from './world'
import type { Node } from './world'

// The teeth of SPEC §13.6 (1-9) and §14.3 (10-13, 20) over the 0.5 element
// model. Two levers, both real code paths of the module:
// - the stand (__feed + __render): the same reduce the core's dispatch runs,
//   then the same applyOptions, vars, lines and tree the render hooks build.
//   CONSTRAINT (measured, REPORT-impl-v0.4-waveA): the kit loads the folder
//   plugin once with fixed options and one registrar cannot register the same
//   event twice — option-dependent drawing runs through the stand;
// - a live mount for what the folder plugin's own defaults already exercise.

const SESSION_ID = '4e1f0c9a-7b2d-4c58-9a36-d1e8f5b2c703'
const SETTINGS = JSON.stringify({ hooks: { PreToolUse: [{}], PostToolUse: [{}] }, outputStyle: 'default' })
const VM_STAT = ['Mach Virtual Memory Statistics: (page size of 4096 bytes)', 'Pages active:                         2000000.', 'Pages wired down:                     1000000.'].join('\n')

const src = (s: Source): Source => s

const feedStand = (): void => {
  __feed({ source: src({ kind: 'session', call: 'info' }), ok: true, data: { cwd: '/work/demo/src', root: '/work/demo', id: SESSION_ID, turns: 0 }, now: 0 })
  __feed({ source: src({ kind: 'session', call: 'model' }), ok: true, data: 'Fable 5.1', now: 0 })
  __feed({ source: src({ kind: 'session', call: 'messages' }), ok: true, data: [], now: 0 })
  __feed({ source: src({ kind: 'session', call: 'usage' }), ok: true, data: { context: { tokens: 83000, window: 1000000, percent: 8 }, rateLimits: [{ kind: 'five_hour', percentUsed: 25, resetsAt: '2026-09-21T20:00:00Z' }, { kind: 'seven_day', percentUsed: 61.5 }], cost: { usd: 1.2345 } }, now: 0 })
  __feed({ source: src({ kind: 'cmd', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], everyMs: 8000, cwd: 'project' }), ok: true, data: { code: 0, stdout: 'feature/hover\n', stderr: '' }, now: 0 })
  __feed({ source: src({ kind: 'cmd', argv: ['claude', '--version'], everyMs: 0 }), ok: true, data: { code: 0, stdout: '2.1.280 (tweakcc)\n', stderr: '' }, now: 0 })
  __feed({ source: src({ kind: 'cmd', argv: ['/usr/bin/vm_stat'], everyMs: 15000 }), ok: true, data: { code: 0, stdout: VM_STAT, stderr: '' }, now: 0 })
  __feed({ source: src({ kind: 'cmd', argv: ['sysctl', '-n', 'hw.memsize'], everyMs: 60000 }), ok: true, data: { code: 0, stdout: '25769803776\n', stderr: '' }, now: 0 })
  __feed({ source: src({ kind: 'file', path: '.claude/settings.json', everyMs: 30000, relativeTo: 'home' }), ok: true, data: SETTINGS, now: 0 })
  __feed({ source: src({ kind: 'file', path: 'CLAUDE.md', everyMs: 30000, relativeTo: 'project' }), ok: true, data: '# demo\n', now: 0 })
  __feed({ source: src({ kind: 'file', path: '.claude/CLAUDE.md', everyMs: 30000, relativeTo: 'home' }), ok: false, error: 'ENOENT', now: 0 })
  __feed({ source: src({ kind: 'env', names: ['CLAUDE_CODE_EXECPATH', 'HOME'] }), ok: true, data: { HOME: '/home/tester', CLAUDE_CODE_EXECPATH: '/fake/bin/2.1.280/claude' }, now: 0 })
  __feed({ source: src({ kind: 'event', event: 'turn.start' }), ok: true, data: {}, now: 0 })
  __feed({ source: src({ kind: 'clock', everyMs: 1000 }), ok: true, data: undefined, now: 3600000 })
}

// The stand's family state is fed ONCE at module load; tests add targeted
// inputs (a failing read, a tool call) on top of it, the way the live core
// accumulates them between events.
feedStand()

const render = (raw: Record<string, string>, width = 140, maxRows = 8): Node => __render(raw, width, maxRows) as Node

const lineRows = (tree: unknown): Node[] => {
  const bar = walk(tree).find((n) => n.type === 'Box' && n.props?.flexDirection === 'column')
  return (bar?.children ?? []).filter((c) => {
    const n = c as Node
    return n?.type === 'Box' && n.props?.flexDirection === 'row' && n.props?.position !== 'absolute'
  }) as Node[]
}

const text = (raw: Record<string, string>, width = 140, maxRows = 8): string => rowText(walk(render(raw, width, maxRows)))

test('13.6-1: a template from settings really changes what the bar draws', async ($, on) => {
  const custom = text({ template: 'git={git.text}||cost={cost.text}' })
  expect(custom).toContain('demo(feature/hover)')
  expect(custom).toContain('$1.23')
  expect(custom).not.toContain('Fable 5.1')
  expect(custom).not.toContain('5h')
  // the same world through the live folder plugin: the default bar really is a
  // different drawing than the custom template's
  world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND_MOUNT, surface, requestId: surface + '-1' })
    const live = rowText(walk(await ui.drawn()))
    expect(live).toContain('Fable 5.1')
    expect(live).not.toBe(custom)
  }
})

test('13.6-2: a missing source removes the segment together with its separator', () => {
  // github has no remote feed in this stand, so its element is absent
  const t = text({ template: 'model={model.text}||github={github.text}||cost={cost.text}', theme: 'plain' })
  expect(t).toContain('Fable 5.1')
  expect(t).toContain('$1.23')
  expect(t.startsWith('│')).toBe(false)
  expect(t.endsWith('│')).toBe(false)
  expect(t).not.toContain('││')
})

test('13.6-3: a segment with two variables disappears whole when one is absent', () => {
  // in-flow rows only: the hover card repeats the element's text (decision 14)
  const rows = lineRows(render({ template: 'combo={model.text} {github.text}||ok={model.text}' }))
  const shown = rows.map((r) => rowText(walk(r))).join('\n')
  expect(shown.match(/Fable 5\.1/g)).toHaveLength(1)
})

test('13.6-4: pending dots do not remove a segment (tools has seen no call)', () => {
  expect(text({ template: 't={tools.text}' })).toContain('…')
})

test('13.6-5: empty settings give the working HUD default bar', async ($, on) => {
  const stand = text({})
  for (const piece of ['Fable 5.1', 'demo(feature/hover)', 'CC v2.1.280', 'up ⏱ 1h 00m', 'Cost $1.23', 'Context ░░░░ 83K/1M 8%', 'Approx RAM ██░░ 12 GB / 26 GB 48%', '1 CLAUDE.md │ 2 hooks']) expect(stand).toContain(piece)
  world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND_MOUNT, surface, requestId: surface + '-5' })
    expect(rowText(walk(await ui.drawn()))).toContain('Context ░░░░ 83K/1M 8%')
  }
})

test('13.6-6: an unknown variable name is visible in the bar and in the diagnostics', () => {
  expect(text({ template: 'a={bogus.x}' })).toContain('{?bogus.x}')
  expect(__diag().some((d) => d.text.includes("unknown variable 'bogus.x'"))).toBe(true)
})

test('13.6-7: a broken config is replaced aloud, not silently', () => {
  const t = text({ template: ' ;; ' })
  expect(t).toContain('demo(feature/hover)')
  expect(__diag().some((d) => d.text.includes('template parsed to zero lines'))).toBe(true)
})

test('13.6-8: the render frame reads nothing, and no template can open an expensive source', async ($, on) => {
  expect(text({ template: 'x={cost.usd|round:2}||y={ram.used}' })).toContain('{?cost.usd|round:2}')
  const w = world(on)
  await start($)
  await w.clock.settle()
  const before = w.reads.length
  const beforeCmds = w.cmds.length
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND_MOUNT, surface, requestId: surface + '-8' })
    expect(rowText(walk(await ui.drawn()))).toContain('Fable 5.1')
  }
  expect(w.reads.length).toBe(before)
  expect(w.cmds.length).toBe(beforeCmds)
})

test('13.6-9/Р7: the number fields decide the figure — raw stays verbatim, compact shortens, grouped groups', () => {
  expect(text({ template: 'c={cost.text}||x={ctx.text}', numTokens: 'raw' })).toContain('$1.23')
  expect(text({ template: 'x={ctx.text}', numTokens: 'raw' })).toContain('Context ░░░░ 83000/1000000 8%')
  expect(text({ template: 'x={ctx.text}', numTokens: 'grouped' })).toContain('83 000/1 000 000')
})

test('14.8-10: a template with the line token gives N lines; without it exactly one', () => {
  const rows = lineRows(render({ template: 'a={git.text} ;; b={model.text} ;; c={cost.text}' }))
  expect(rows).toHaveLength(3)
  expect(rowText(walk(rows[0]!))).toContain('demo(feature/hover)')
  expect(rowText(walk(rows[2]!))).toContain('$1.23')
})

test('14.8-10/0.2.0: a template without the line token reads as one line', () => {
  expect(parseTemplate('model={model.text}||ctx={ctx.text}')).toHaveLength(1)
  expect(parseTemplate('plain text segment')).toHaveLength(1)
  expect(parseTemplate('a={git.text}||b={cost.text}')[0]).toHaveLength(2)
  // the bare-id shorthand a preset serializes into parses back to the same body
  expect(parseTemplate('git-branch||model')[0]![0]).toEqual({ id: 'git-branch', body: '{git-branch.text}' })
  expect(parseTemplate('hello')[0]![0]).toEqual({ id: 's1', body: 'hello' })
})

test('Р2: a list element expands to its own rows, one per agent or tool', () => {
  __feed({ source: src({ kind: 'event', event: 'tool.call' }), ok: true, data: { tool: 'Bash', tool_use_id: 't1', callKey: 't1', agentScope: 'main', input: { command: 'ls /work' } }, now: 3600000 })
  __feed({ source: src({ kind: 'event', event: 'agent.spawn' }), ok: true, data: { agentId: 'a1', subagentType: 'swe2-critic', description: 'delta critic' }, now: 3600000 })
  const rows = lineRows(render({ template: 'one={model.text} ;; tools={tools.text} ;; ag={ag.text}' }))
  expect(rows).toHaveLength(3)
  expect(rowText(walk(rows[1]!))).toContain('◐ Bash: ls /work')
  expect(rowText(walk(rows[2]!))).toContain('swe2-critic')
})

test('14.8-11: a line with no surviving segment is not drawn; no empty rows', () => {
  const rows = lineRows(render({ template: 'gone={github.text}||ok={model.text} ;; gone2={github.text}' }))
  expect(rows).toHaveLength(1)
  expect(rowText(walk(rows[0]!)).trim()).not.toBe('')
})

test('14.8-12: eviction is per line — narrowing hits each line by the common order', () => {
  const rows = lineRows(render({ template: 'cost={cost.text}||model={model.text} ;; git={git.text}||directory={directory.text}', theme: 'plain' }, 18))
  expect(rows).toHaveLength(2)
  const first = rowText(walk(rows[0]!))
  const second = rowText(walk(rows[1]!))
  expect(first).toContain('Fable 5.1')
  expect(first).not.toContain('$')
  expect(second).toContain('demo(feature/hover)')
  expect(second).not.toContain('src')
})

test('14.8-13: beyond maxRows the extra lines are not drawn and the diagnostics say so', () => {
  const rows = lineRows(render({ template: 'a={git.text} ;; b={model.text} ;; c={cost.text}' }, 140, 2))
  expect(rows).toHaveLength(2)
  expect(__diag().some((d) => d.text.includes('beyond maxRows=2'))).toBe(true)
})

test('14.8-20: an empty layout line from /config is dropped with a diagnostic, not a hole', () => {
  const rows = lineRows(render({ template: 'a={model.text} ;;  ;; b={cost.text}' }))
  expect(rows).toHaveLength(2)
  expect(__diag().some((d) => d.text.includes('empty layout line'))).toBe(true)
})

test('14.8-20: the serialized draft round-trips through parse (registry bodies carry no reserved token)', () => {
  for (const preset of ['hud', 'one', 'two', 'powerline', 'minimum']) {
    const lines = presetLines(preset)
    expect(sameLayout(templateRoundTrip(lines), lines)).toBe(true)
  }
  const dupId = parseTemplate('git={git.text}||git={git.text}')
  expect(dupId[0]).toHaveLength(2)
  expect(dupId[0]![1]!.id).not.toBe('git')
  expect(serializeTemplate(dupId)).toContain('git#2=')
})

test('the registry describes itself: every element id is unique and every preset id is known', () => {
  expect(new Set(REGISTRY_IDS).size).toBe(REGISTRY_IDS.length)
  for (const preset of ['hud', 'one', 'two', 'powerline', 'minimum']) {
    for (const line of presetLines(preset)) for (const seg of line) expect(REGISTRY_IDS).toContain(seg.id)
  }
})

test('Р4: the elements field round-trips circularly and a bad entry is dropped aloud', () => {
  const elements = { ctx: { v: 'percent', c: 'red', 'o:x': '1' }, model: { lb: 'off' } }
  const round = parseElements(serializeElements(elements))
  expect(serializeElements(round)).toBe(serializeElements(elements))
  expect(round['ctx']!['v']).toBe('percent')
  const bad = parseElements('ctx:v=percent;bogus-entry;nope:x=1')
  expect(Object.keys(bad)).toEqual(['ctx'])
  expect(__diag().some((d) => d.text.includes("elements: entry 'bogus-entry' dropped"))).toBe(true)
  expect(__diag().some((d) => d.text.includes("elements: entry 'nope:x=1' dropped"))).toBe(true)
})

test('Р4 (draw): the element settings change the drawing — variant, label off, bar show', () => {
  // bs is the show axis; v=percent with bs=all still draws the bar and the percent
  expect(text({ template: 'x={ctx.text}', elements: 'ctx:bs=percent' })).toContain('Context 8%')
  expect(text({ template: 'x={ctx.text}', elements: 'ctx:v=percent' })).toContain('░')
  expect(text({ template: 'x={ctx.text}', elements: 'ctx:v=percent' })).toContain('8%')
  // F7: the percent variant is the ratio alone, not the used/total pair
  expect(text({ template: 'x={ctx.text}', elements: 'ctx:v=percent' })).not.toContain('83K/1M')
  expect(text({ template: 'x={ctx.text}', elements: 'ctx:lb=off' })).not.toContain('Context')
  expect(text({ template: 'x={ctx.text}', elements: 'ctx:bs=value' })).not.toContain('░')
  expect(text({ template: 'x={ctx.text}', elements: 'ctx:bw=10' })).toContain('█░░░░░░░░░')
  // F6: 83000/1000000 = 0.083; Math.round(0.083 * 25) = 2 filled, 23 empty
  expect(text({ template: 'x={ctx.text}', elements: 'ctx:bw=25,bp=●○' })).toContain('●●' + '○'.repeat(23))
})

test('Р7: the six number fields sample exactly as the Числа tab lists them', () => {
  const nf = buildNf({})
  expect(nf.tokens(231045)).toBe('231K')
  expect(buildNf({ numTokens: 'raw' }).tokens(231045)).toBe('231045')
  expect(buildNf({ numTokens: 'compact1' }).tokens(231045)).toBe('231.0K')
  expect(buildNf({ numTokens: 'grouped' }).tokens(231045)).toBe('231 045')
  expect(nf.percent(0.48)).toBe('48%')
  expect(buildNf({ numPercent: 'dec1' }).percent(0.482)).toBe('48.2%')
  expect(buildNf({ numPercent: 'ratio' }).percent(0.48)).toBe('0.48')
  expect(nf.usd(6434.27)).toBe('$6434.27')
  expect(buildNf({ numUsd: 'short' }).usd(6434.27)).toBe('$6.4K')
  expect(buildNf({ numUsd: 'short' }).usd(1000)).toBe('$1.0K')
  expect(buildNf({ numUsd: 'whole' }).usd(6434.27)).toBe('$6434')
  // a nonzero value never reads as $0.00 (SPEC §14.5.4)
  expect(buildNf({ numUsd: 'exact' }).usd(0.004)).toBe('$0.004')
  expect(nf.duration(1655 * 3600000 + 47 * 60000)).toBe('1655h 47m')
  expect(nf.duration(60000)).toBe('1m')
  expect(buildNf({ numDuration: 'dh' }).duration(69 * 86400000 + 23 * 3600000)).toBe('69d 23h')
  expect(buildNf({ numDuration: 'clock' }).duration(1655 * 3600000 + 47 * 60000)).toBe('1655:47')
  expect(nf.bytes(11 * 1000 ** 3)).toBe('11 GB')
  expect(buildNf({ numBytes: 'gib' }).bytes(11 * 1000 ** 3)).toBe('10.2 GiB')
  expect(buildNf({ numBytes: 'mb' }).bytes(11 * 1000 ** 3)).toBe('11000 MB')
  expect(nf.rate(25, 'tok')).toBe('25 tok/s')
  expect(buildNf({ numRate: 'plain' }).rate(25, 'tok')).toBe('25/s')
})

test('§10.4: a failed read after a good one keeps the figure with the age mark and the reason', () => {
  expect(text({ template: 'x={ctx.text}' })).toContain('Context ░░░░ 83K/1M 8%')
  __feed({ source: src({ kind: 'session', call: 'usage' }), ok: false, error: 'usage exploded', now: 3600000 })
  const stale = text({ template: 'x={ctx.text}' })
  expect(stale).toContain('83K/1M')
  expect(stale).toContain('~')
})

test('§11.2: a cmd/file/clock source is run only while its element is placed in the saved layout', () => {
  const gitKey = JSON.stringify({ argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd: 'project', everyMs: 8000, kind: 'cmd' })
  const all = __activeSources(['model', 'git-branch', 'ver', 'ram', 'ctx', 'dur'])
  expect(all).toContain(gitKey)
  const withoutGit = __activeSources(['model', 'ctx'])
  expect(withoutGit).not.toContain(gitKey)
  expect(withoutGit.some((k) => k.includes('vm_stat'))).toBe(false)
  expect(withoutGit.some((k) => k.includes('--version'))).toBe(false)
})

test('T3: a tool counter stays at 0 while the call is running and ticks when it finishes', () => {
  const labels = (): string[] => {
    const got = valueOf('tools', undefined, { tools: { 'o:maxRows': '8' } }, buildNf({}))
    if (!got || got.value.state !== 'ok') return []
    return (got.value.rows ?? []).map((r) => (r.icon ?? '') + ':' + r.label)
  }
  __feed({ source: src({ kind: 'event', event: 'tool.call' }), ok: true, data: { tool: 'Read', tool_use_id: 'rd1', callKey: 'rd1', agentScope: 'main', input: { file_path: 'a.ts' } }, now: 3600000 })
  const mid = labels()
  expect(mid).toContain('run:Read')
  expect(mid.some((l) => l.includes('Read ×'))).toBe(false)
  __feed({ source: src({ kind: 'event', event: 'tool.call' }), ok: true, data: { isError: false, callKey: 'rd1', callTool: 'Read' }, now: 3600001 })
  const done = labels()
  expect(done).toContain('ok:Read ×1')
  expect(done).not.toContain('run:Read')
})

const settingsFile = (over: { ok: boolean; data?: unknown; error?: string; now: number }) =>
  __feed({ source: src({ kind: 'file', path: '.claude/settings.json', everyMs: 30000, relativeTo: 'home' }), ok: over.ok, data: over.data, error: over.error, now: over.now })

test('T11c: broken settings JSON fails the element with a reason instead of an empty value', () => {
  __resetState()
  const style = () => valueOf('style', undefined, {}, buildNf({}))!.value
  settingsFile({ ok: true, data: JSON.stringify({ outputStyle: 'explanatory', hooks: {} }), now: 1 })
  const good = style()
  expect(good.state).toBe('ok')
  if (good.state === 'ok') expect(good.text).toBe('explanatory')
  settingsFile({ ok: false, error: 'EIO', now: 2 })
  const io = style()
  expect(io.state).toBe('stale')
  if (io.state === 'stale') {
    expect(io.last.text).toBe('explanatory')
    expect(io.reason).toContain('EIO')
  }
  settingsFile({ ok: true, data: '{', now: 3 })
  const kept = style()
  expect(kept.state).toBe('stale')
  if (kept.state === 'stale') {
    expect(kept.last.text).toBe('explanatory')
    expect(kept.reason.length).toBeGreaterThan(0)
  }
  __resetState()
  settingsFile({ ok: true, data: '{', now: 3 })
  const fresh = style()
  expect(fresh.state).toBe('nosource')
  if (fresh.state === 'nosource') expect(fresh.reason.length).toBeGreaterThan(0)
  __resetState()
  settingsFile({ ok: false, error: 'EACCES', now: 4 })
  const denied = style()
  expect(denied.state === 'nosource' || denied.state === 'stale').toBe(true)
  if (denied.state === 'nosource' || denied.state === 'stale') expect(denied.reason).toContain('EACCES')
  __resetState()
  feedStand()
})

test('Z5: elementIdOf keeps the escaped brace, and a dotted body arms that element source', () => {
  expect(elementIdOf({ id: 'x', body: '{{x.y}} {ctx.text}' })).toBe('ctx')
  // The timer gate is __activeSources(savedIds); git is the loaded cmd that gate starts.
  __render({ template: 'x={git.text}' })
  expect(__activeSources(__savedIds()).some((k) => k.includes('rev-parse'))).toBe(true)
  __render({ template: 'x={ctx.text}' })
  expect(__savedIds()).toContain('ctx')
  expect(elementIdOf({ id: 'x', body: 'x={git.text} {style.text}' })).toBe('git')
  __render({ template: 'x={git.text} {style.text}' })
  const both = __activeSources(__savedIds())
  expect(both.some((k) => k.includes('rev-parse'))).toBe(true)
  expect(both.some((k) => k.includes('settings.json'))).toBe(true)
})

test('T13: the seven diagnostic keys are recorded as warn', () => {
  const cases: { raw: Record<string, string>; key: RegExp; user?: Record<string, Record<string, string>> }[] = [
    { raw: { elements: 'zzz-not-real:v=1' }, key: /^elements-bad-/ },
    { raw: { theme: 'mine', bar: 'theme' }, key: /^bar-pair$/, user: { mine: { bar: 'xyz' } } },
    { raw: { theme: 'not-a-theme' }, key: /^theme-unknown$/ },
    { raw: { shape: 'not-a-shape' }, key: /^axis-value-/ },
    { raw: { template: 'git={git.text}||git={git.text}' }, key: /^tpl-dup-id-/ },
    { raw: { template: 'a={model.text} ;;  ;; b={cost.text}' }, key: /^tpl-empty-line$/ },
    { raw: { template: 'a={bogus.x}' }, key: /^tpl-unknown-/ },
  ]
  for (const c of cases) {
    if (c.user) resolveView(c.raw, c.user)
    else __render(c.raw)
    const hit = __diag().find((d) => c.key.test(d.key) && d.kind === 'warn' && typeof d.text === 'string' && d.text.length > 0)
    if (!hit) throw new Error('missing ' + String(c.key) + ' among ' + __diag().map((d) => d.kind + ':' + d.key).join(','))
  }
})

const drain = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

// A stand $ for the timer seam: the kit rejects a second clock.every, so the
// refusal is injected through __setArmEvery, and this clock only moves when the
// test moves it.
const timerStand = (): { $: any; gitReads: () => number; nowMs: { n: number } } => {
  const cmds: string[] = []
  const nowMs = { n: 0 }
  const $ = {
    clock: {
      now: async () => nowMs.n,
      every: () => {
        throw new Error('direct clock.every')
      },
    },
    process: {
      run: async (argv: string[]) => {
        cmds.push(argv.join(' '))
        return { exitCode: 0, stdout: 'feature/hover\n', stderr: '' }
      },
    },
    fs: { read: async () => '' },
    env: { get: async () => '' },
    session: {
      usage: async () => ({ context: { tokens: 1, window: 1 }, rateLimits: [], cost: { usd: 0 } }),
      model: async () => 'm',
      cwd: async () => '/work/demo',
      root: async () => '/work/demo',
      id: async () => 's',
      turns: async () => 0,
      messages: async () => [],
    },
    ui: { log: async () => undefined, invalidate: () => undefined, status: () => undefined },
  }
  return { $, gitReads: () => cmds.filter((c) => c.includes('rev-parse')).length, nowMs }
}

test('Z4: a refused source arm waits out everyMs, then refresh arms it again', async () => {
  __resetState()
  __render({ template: 'x={git.text}' })
  const stand = timerStand()
  let arms = 0
  let everyMs = 0
  // CONSTRAINT (S1-FIX4 П.4, ADJUDICATION-v0.5-S1-FIX3 Н3): the refusal and
  // the count speak only about the git 8000 ms timer; the family clock
  // (S1-FIX3 F1) may arm in any order alongside it.
  __setArmEvery((ms) => {
    if (ms !== 8000) return { cancel() {} }
    arms++
    everyMs = ms
    if (arms === 1) throw new Error('refused once')
    return { cancel() {} }
  })
  try {
    await __syncSourceTimers(stand.$)
    await drain()
    const diag = __diag().filter((d) => d.kind === 'fail' && d.key.startsWith('timer-') && d.text.length > 0)
    expect(diag.length).toBeGreaterThan(0)
    const reads = stand.gitReads()
    expect(reads).toBeGreaterThan(0)
    const armsAfterRefuse = arms
    await __syncSourceTimers(stand.$)
    await drain()
    expect(stand.gitReads()).toBe(reads)
    expect(arms).toBe(armsAfterRefuse)
    stand.nowMs.n += everyMs
    await __refresh(stand.$)
    await drain()
    expect(arms).toBeGreaterThan(armsAfterRefuse)
    expect(stand.gitReads()).toBeGreaterThan(reads)
    expect(__timerRefusedSize()).toBe(0)
    const armed = arms
    await __refresh(stand.$)
    await drain()
    expect(arms).toBe(armed)
  } finally {
    __resetState()
  }
})

test('Z4d: a refused arm whose error text throws is still diagnosed', async () => {
  __resetState()
  __render({ template: 'x={git.text}' })
  const stand = timerStand()
  const poison = { toString() { throw new Error('poison') } }
  __setArmEvery(() => { throw poison })
  try {
    let blew = false
    try {
      await __syncSourceTimers(stand.$)
    } catch {
      blew = true
    }
    expect(blew).toBe(false)
    expect(__diag().some((d) => d.kind === 'fail' && d.key.startsWith('timer-') && d.text.includes('unprintable error'))).toBe(true)
    __resetState()
    __render({ template: 'x={git.text}' })
    __setArmEvery(() => { throw '' })
    await __syncSourceTimers(stand.$)
    expect(__diag().some((d) => d.kind === 'fail' && d.key.startsWith('timer-') && d.text.includes('(empty error)'))).toBe(true)
  } finally {
    __resetState()
  }
})
