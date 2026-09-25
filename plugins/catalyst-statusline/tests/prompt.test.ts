import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { world, start, command, MOUNT, BAND_MOUNT, PANE_MOUNT, walk, textOf, barText, STORE_OPEN, SESSION_ID, SURFACES } from './world'
import type { Node } from './world'

// The live band over the 0.5 core: the HUD default layout, hover cards, the
// age marks of carried figures, the Р1 status clearing, and the panel's
// command surface. The kit loads the folder plugin once with the manifest
// defaults; option-dependent drawing lives in template.test.ts (measured
// limit, REPORT-impl-v0.4-waveA).

function rowOf(nodes: Node[]): string {
  return nodes.filter((n) => n.type === 'Text').map(textOf).join('')
}

test('the band above the prompt draws the HUD default layout from the session nouns', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND_MOUNT, surface, requestId: surface + '-default' })
    const nodes = walk(await ui.drawn())
    const all = rowOf(nodes)
    for (const piece of ['Fable 5.1', 'demo(feature/hover)', 'CC v2.1.280', 'Cost $1.23', 'Context ░░░░ 83K/1M 8%', 'Approx RAM ██░░ 12 GB / 26 GB 48%', '1 CLAUDE.md │ 2 hooks']) {
      expect(all).toContain(piece)
    }
  }
})

test('every drawn segment names a hover scope that reveals its own card over the row above the bar', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  const ui = await $.ui.mount(BAND_MOUNT)
  const tree = (await ui.drawn()) as Node
  const nodes = walk(tree)

  const scopes = new Set(nodes.filter((n) => n.type === 'Text' && typeof n.hover?.scope === 'string').map((n) => n.hover!.scope as string))
  const cards = nodes.filter((n) => n.type === 'Box' && n.props?.display === 'none')

  // line 1: model, git-branch, ver, dur, cost; then ctx, ram, cfg, tools, ag, todo, tokens-total
  expect([...scopes].sort()).toEqual(['sl-ag', 'sl-cfg', 'sl-cost', 'sl-ctx', 'sl-dur', 'sl-git-branch', 'sl-model', 'sl-ram', 'sl-todo', 'sl-tokens-total', 'sl-tools', 'sl-ver'])
  expect(cards).toHaveLength(12)
  expect(tree.props?.flexDirection).toBe('column')
  for (const card of cards) {
    expect(tree.children).toContain(card)
    expect(card.props).toMatchObject({ position: 'absolute', left: 0 })
    expect(card.hover).toMatchObject({ display: 'flex' })
    expect(scopes.has(card.hover!.scope as string)).toBe(true)
  }
  const inFlow = (tree.children as Node[]).filter((c) => c.props?.position !== 'absolute')
  expect(inFlow).toHaveLength(8)
  expect(textOf(cards.find((b) => b.hover!.scope === 'sl-git-branch')!)).toContain('repo=demo')
})

test('the hint line passes through untouched while the placement is above (Р1)', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Text', text: 'ENGINE PromptHint' })).toBeDefined()
  expect(barText(walk(await ui.drawn()))).toBe('')
})

test('Р1: session.start clears the plugin status line and the mod never pins one', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  // the clear call is defensive: the mod itself sets no status, and a line
  // left by an older build does not survive the load
  expect(w.statuses).toContain(undefined)
  expect(w.statuses.every((t) => t === undefined)).toBe(true)
  await $.session.end({ reason: 'exit', sessionId: SESSION_ID } as any)
  expect(w.statuses.filter((t) => t === undefined).length).toBeGreaterThanOrEqual(2)
})

test('a failing usage read leaves the figures standing with the age mark, and the rest still draw', async ($, on) => {
  let failing = false
  const w = world(on, {
    'command.run': (_$: any, _e: any) => ({ text: '' }),
    'session.usage': () => {
      if (failing) throw new Error('usage exploded')
      return { value: { context: { tokens: 12000, window: 200000 }, rateLimits: [], cost: { usd: 0.09 } } }
    },
  })
  await start($)
  await w.clock.settle()
  const first = await $.ui.mount({ ...BAND_MOUNT, requestId: 'good' })
  expect(rowOf(walk(await first.drawn()))).toContain('Context ░░░░ 12K/200K 6%')

  failing = true
  await core($, 'model')
  await w.clock.settle()
  const second = await $.ui.mount({ ...BAND_MOUNT, requestId: 'failing' })
  const kept = rowOf(walk(await second.drawn()))
  // §10.4: the last good figures stand with the age mark — no zero, no lost segment
  expect(kept).toContain('12K/200K')
  expect(kept).toContain('~')
  expect(kept).toContain('$0.09')

  failing = false
  await core($, 'model')
  await w.clock.settle()
  const third = await $.ui.mount({ ...BAND_MOUNT, requestId: 'recovered' })
  expect(rowOf(walk(await third.drawn()))).not.toContain('~')
})

test('an interrupted turn keeps the context figure with the age mark; a finished turn shows what the engine reports', async ($, on) => {
  let context: Record<string, number> = { tokens: 37000, window: 200000 }
  const w = world(on, {
    'session.usage': () => ({ value: { context, rateLimits: [], cost: { usd: 0.02 } } }),
    'turn.complete': (_$: any, e: any) => ({ text: e.answer }),
  })
  await start($)
  await w.clock.settle()
  const band = await $.ui.mount({ ...BAND_MOUNT, requestId: 'aborted-band' })
  expect(barText(walk(await band.drawn()))).toContain('37K/200K')

  context = { window: 200000 }
  await $.turn.complete({ answer: '', durationMs: 5000, isAborted: true, turnId: 'turn-1', reason: 'aborted' } as any)
  await w.clock.settle()
  const stale = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'stale-band' })).drawn()))
  expect(stale).toContain('37K/200K')
  expect(stale).toContain('~')

  context = { window: 200000 }
  await $.turn.complete({ answer: 'done', durationMs: 5000, isAborted: false, turnId: 'turn-2', reason: 'answer' } as any)
  await w.clock.settle()
  const fresh = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'fresh-band' })).drawn()))
  expect(fresh).toContain('…/200K')
  expect(fresh).not.toContain('37K/200K')
})

test('a model switch shows from the first main-loop request, before the turn completes', async ($, on) => {
  let model = 'claude-fable-5-1'
  const w = world(on, {
    'session.model': () => ({ value: model }),
    'turn.step': async function* (_$: any, e: any) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    },
  })
  await start($)
  await w.clock.settle()
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'm1' })).drawn()))).toContain('claude-fable-5-1')

  model = 'claude-opus-5-5[1m]'
  await step($, { model: 'claude-opus-5-5', effort: 'max' })
  await w.clock.settle()

  const during = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'during-turn' })).drawn()))
  expect(during).toContain('claude-opus-5-5[1m] max')
  expect(during).not.toContain('fable-5-1')
})

test('a subagent request leaves the model and effort on the bar alone', async ($, on) => {
  const w = world(on, {
    'turn.step': async function* (_$: any, e: any) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    },
  })
  await start($)
  await w.clock.settle()
  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await step($, { model: 'claude-haiku-4-5-20251001', effort: 'low', agentId: 'agent-1' })
  await w.clock.settle()

  const bar = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'sub' })).drawn()))
  expect(bar).toContain('Fable 5.1 max')
  expect(bar).not.toContain('low')
  expect(bar).not.toContain('haiku')
})

test('/model redraws the bar with the new model once the command has run', async ($, on) => {
  let model = 'claude-fable-5-1'
  const w = world(on, {
    'session.model': () => ({ value: model }),
    'command.run': (_$: any, e: any) => {
      if (e.command === 'model') model = 'claude-opus-5-5[1m]'
      return { text: 'Set model to Opus 5.5 (1M context)' }
    },
  })
  await start($)
  await w.clock.settle()
  const result = await core($, 'model')
  expect(result.text).toBe('Set model to Opus 5.5 (1M context)')
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'after-model' })).drawn()))).toContain('claude-opus-5-5[1m]')
})

test('/clear redraws the bar with the new session and its empty context once the command has run', async ($, on) => {
  const NEW_ID = 'b7c3a1d2-0e4f-4a6b-8c9d-1f2e3a4b5c6d'
  let id = SESSION_ID
  let usage: Record<string, unknown> = { context: { tokens: 83000, window: 1000000 }, rateLimits: [], cost: { usd: 1.2345 } }
  const w = world(on, {
    'session.id': () => ({ value: id }),
    'session.usage': () => ({ value: usage }),
    'command.run': (_$: any, e: any) => {
      if (e.command === 'clear') {
        id = NEW_ID
        usage = { context: { window: 1000000 }, cost: { usd: 0 } }
      }
      return { text: '' }
    },
  })
  await start($)
  await w.clock.settle()
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'cl1' })).drawn()))).toContain('83K/1M')

  await core($, 'clear')
  await w.clock.settle()
  const after = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'after-clear' })).drawn()))
  expect(after).toContain('…/1M')
  expect(after).not.toContain('83K/1M')
})

test('/compact redraws the bar with the cost the compaction added once it has run', async ($, on) => {
  let usage: Record<string, unknown> = { context: { tokens: 42000, window: 200000 }, rateLimits: [], cost: { usd: 0.09 } }
  const w = world(on, {
    'session.usage': () => ({ value: usage }),
    'command.run': (_$: any, e: any) => {
      if (e.command === 'compact') usage = { ...usage, cost: { usd: 0.1 } }
      return { text: 'Compacted' }
    },
  })
  await start($)
  await w.clock.settle()
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'cp1' })).drawn()))).toContain('$0.09')

  await core($, 'compact')
  await w.clock.settle()
  const bar = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'after-compact' })).drawn()))
  expect(bar).toContain('42K/200K')
  expect(bar).toContain('$0.10')
})

test('session.start registers /statusline-mod and the bare command opens the panel pane', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['statusline-mod'])
  const before = await $.ui.mount(PANE_MOUNT)
  expect(await before.find({ key: 'save' })).toBeUndefined()
  await before.unmount()

  const result = await command($)
  expect(result.text).toBeUndefined()
  expect(w.opened).toEqual([{ id: 'statusline', title: 'Статус-строка', focus: true, closeOnEscape: true, holdToasts: true, rows: 30 }])
  expect(w.persisted.get(STORE_OPEN)).toEqual({ session: SESSION_ID })
  const pane = await $.ui.mount(PANE_MOUNT)
  expect(await pane.find({ key: 'save' })).toBeDefined()
})

test('/statusline-mod reset writes the defaults through /config and answers with text', async ($, on) => {
  const w = world(on)
  await start($)
  const reset = await command($, 'reset')
  expect(reset.text).toContain('reset to defaults')
  expect(w.opened).toEqual([])
})

test('a non-interactive session gets the /config path instead of the panel', async ($, on) => {
  const w = world(on)
  await start($, false, null)
  const result = await command($)
  expect(result.text).toContain('/config (fields catalyst-statusline.*)')
  expect(result.text).toContain('/statusline-mod')
  expect(w.opened).toEqual([])
  expect(w.persisted.has(STORE_OPEN)).toBe(false)
})

test('a panel another session opened is not drawn', async ($, on) => {
  world(on, {}, { 'statusline.open.v1': { session: 'b7c3a1d2-0e4f-4a6b-8c9d-1f2e3a4b5c6d' } })
  await start($)
  const pane = await $.ui.mount(PANE_MOUNT)
  expect(await pane.find({ key: 'save' })).toBeUndefined()
})

test('the band yields to a survey', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  await command($)
  const band = await $.ui.mount({ ...BAND_MOUNT, props: { ...BAND_MOUNT.props, hasSurvey: true } })
  const nodes = walk(await band.drawn())
  expect(rowOf(nodes)).toContain('ENGINE AbovePrompt')
  expect(nodes.filter((n) => n.type === 'Text' && typeof n.hover?.scope === 'string')).toHaveLength(0)
})

test('the band narrows by the common eviction order and the last survivor stays', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  const narrow = await $.ui.mount({ ...BAND_MOUNT, props: { ...BAND_MOUNT.props, bodyColumns: 10, scroll: { offset: 0, bodyRows: 29 } }, requestId: 'narrow-band' })
  const t = rowOf(walk(await narrow.drawn()))
  expect(t).toContain('Fable 5.1')
  expect(t).not.toContain('$')
  expect(t).not.toContain('demo(feature/hover)')
})

const STEP = { turnId: 'turn-1', index: 0, messageCount: 1 }

async function step($: Engine, input: Record<string, unknown>) {
  const stream = $.turn.step({ ...STEP, ...input } as any)
  for await (const _chunk of stream) {
    // the chunks are the model's, nothing here reads them
  }
  return stream.result
}

// A core command typed at the prompt, the way the engine raises it.
const core = ($: Engine, name: string) =>
  $.command.run({ command: name, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

const BAD_PANE = { title: 'Bad hover', isFocused: true, bodyColumns: 120, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} }

const BAD_HOVER = {
  name: 'bad-hover',
  register(on: any) {
    on('ui.render', { component: 'Pane' }, async ($: any, e: any) => {
      const { Box, Text } = await $.ui.resolve(e)
      return Box({ children: [Text({ children: 'no scope, no keyed Box', hover: { bold: true } })] })
    })
  },
}

test('control: a Text hover with no scope under no keyed Box is refused', { plugins: [BAD_HOVER] }, async ($) => {
  await expect($.ui.mount({ plugin: 'bad-hover', surface: 'terminal', component: 'Pane', props: { ...BAD_PANE, title: 'Bad hover' }, requestId: 'bad-hover' })).rejects.toThrow(
    /hover has no Box with a key around it/,
  )
})

const bandText = async ($: Engine, requestId: string): Promise<string> => {
  const band = await $.ui.mount({ ...BAND_MOUNT, requestId })
  return rowOf(walk(await band.drawn()))
}

const session = ($: Engine, sessionId: string) =>
  $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/demo/src', sessionId } as any)

// CONSTRAINT: the body advances 7 260 fake seconds of the 1 Hz ticker — 1.9–4.2 s of wall time on the mac (S1-FIX5 logs); the 5 s default failed under parallel load
test('T15: session duration runs from session.start when no turn has been seen', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  expect(w.clock.now()).toBe(0)
  await session($, 'sess-a')
  await w.clock.settle()
  await w.clock.advance(3_600_000)
  const first = await bandText($, 't15-a')
  expect(first).not.toContain('⏱…')
  expect(first).toContain('up ⏱ 1h 00m')
  await session($, 'sess-a')
  await w.clock.settle()
  await w.clock.advance(3_600_000)
  const second = await bandText($, 't15-b')
  expect(second).toContain('up ⏱ 2h 00m')
  await session($, 'sess-b')
  await w.clock.settle()
  await w.clock.advance(60_000)
  const third = await bandText($, 't15-c')
  expect(third).toContain('up ⏱ 1m')
  expect(third).not.toContain('2h')
  expect(third).not.toContain('1h')
})

test('Z1: overlapping tool calls finish by call key, not by stack order', async ($, on) => {
  const gates = new Map<string, () => void>()
  const hold = (key: string) => new Promise<void>((resolve) => { gates.set(key, resolve) })
  const w = world(on, {
    'tool.call': async (_$: any, e: any) => {
      const id = typeof e.tool_use_id === 'string' && e.tool_use_id !== '' ? String(e.tool_use_id) : String(e.tool)
      await hold(id)
      return { result: 'ok' }
    },
  })
  const release = (id: string): void => {
    const fn = gates.get(id)
    if (!fn) throw new Error('no gate for ' + id + ' have ' + [...gates.keys()].join(','))
    fn()
  }
  await start($)
  await w.clock.settle()
  // the first inserted call finishes first, while the later two are still in flight
  const bash = $.tool.call({ tool: 'Bash', tool_use_id: 'b', input: { command: 'ls' } } as any)
  const read = $.tool.call({ tool: 'Read', tool_use_id: 'a', input: { file_path: 'a.ts' } } as any)
  const edit = $.tool.call({ tool: 'Edit', tool_use_id: 'e', input: { file_path: 'b.ts' } } as any)
  await w.clock.settle()
  release('b')
  await bash
  await w.clock.settle()
  const mid = await bandText($, 'z1')
  expect(mid).toContain('◐ Read')
  expect(mid).toContain('◐ Edit')
  expect(mid).not.toMatch(/◐ Bash/)
  expect(mid).toContain('Bash ×1')
  expect(mid).not.toContain('Read ×')
  expect(mid).not.toContain('Edit ×')
  release('a')
  release('e')
  await read
  await edit
})

test('Z2: a tool call with no tool_use_id still completes and clears its row', async ($, on) => {
  const gates = new Map<string, () => void>()
  const hold = (key: string) => new Promise<void>((resolve) => { gates.set(key, resolve) })
  const w = world(on, {
    'tool.call': async (_$: any, e: any) => {
      const id = typeof e.tool_use_id === 'string' && e.tool_use_id !== '' ? String(e.tool_use_id) : String(e.tool)
      await hold(id)
      return { result: 'ok' }
    },
  })
  const release = (id: string): void => {
    const fn = gates.get(id)
    if (!fn) throw new Error('no gate for ' + id + ' have ' + [...gates.keys()].join(','))
    fn()
  }
  await start($)
  await w.clock.settle()
  const read = $.tool.call({ tool: 'Read', tool_use_id: '', input: { file_path: 'a.ts' } } as any)
  const bash = $.tool.call({ tool: 'Bash', tool_use_id: '', input: { command: 'ls' } } as any)
  await w.clock.settle()
  const mid = await bandText($, 'z2-mid')
  expect(mid).toContain('◐ Read')
  expect(mid).toContain('◐ Bash')
  release('Read')
  await read
  await w.clock.settle()
  const done = await bandText($, 'z2-done')
  expect(done).not.toMatch(/◐ Read/)
  expect(done).toContain('◐ Bash')
  expect(done).toContain('Read ×1')
  expect(done).not.toContain('Bash ×')
  release('Bash')
  await bash
})

test('Z3: an aborted turn drops the running tool row and does not count it', async ($, on) => {
  let release: () => void = () => undefined
  const wait = new Promise<void>((resolve) => { release = resolve })
  const w = world(on, {
    'tool.call': async () => {
      await wait
      return { result: 'ok' }
    },
    'turn.complete': (_$: any, e: any) => ({ text: e.answer ?? '' }),
  })
  await start($)
  await w.clock.settle()
  const pending = $.tool.call({ tool: 'Bash', tool_use_id: 'b', input: { command: 'ls' } } as any)
  await w.clock.settle()
  expect(await bandText($, 'z3-run')).toContain('◐ Bash')
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 'z3-turn', reason: 'aborted' } as any)
  await w.clock.settle()
  const after = await bandText($, 'z3-abort')
  expect(after).not.toMatch(/◐ Bash/)
  expect(after).not.toContain('Bash ×')
  release()
  await pending
})
