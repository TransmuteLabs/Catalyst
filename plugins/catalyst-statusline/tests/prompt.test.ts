import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { displayName } from '../hooks/statusline'
import { world, start, command, MOUNT, BAND_MOUNT, PANE_MOUNT, walk, textOf, barText, STORE_OPEN, SESSION_ID, SURFACES } from './world'
import type { Node } from './world'

// The base A mod's test kit (MIT, konsta95/ClaudeCodeMods) adapted to the wave A
// module: the band above the prompt is the default placement, the picker is a
// Pane under /statusline-mod, the model label is raw by default and the figures
// are verbatim. The tests removed with the base A picker in AbovePrompt
// (SPEC §14.12 «Не переносится») are listed by name in the wave report.

const ctxText = (n: number, w: number) => 'ctx ' + n + '/' + w

test('the band above the prompt draws the default segments from the session nouns', async ($, on) => {
  world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND_MOUNT, surface, requestId: surface + '-default' })
    const nodes = walk(await ui.drawn())
    for (const piece of ['demo(feature/hover)', 'Fable 5.1', ctxText(83000, 1000000), '5h 25%', '7d 61.5%', SESSION_ID, '$1.2345']) {
      expect(rowOf(nodes)).toContain(piece)
    }
  }
})

function rowOf(nodes: Node[]): string {
  return nodes.filter((n) => n.type === 'Text').map(textOf).join('')
}

test('every segment names a hover scope that reveals its own card over the row above the bar', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount(BAND_MOUNT)
  const tree = (await ui.drawn()) as Node
  const nodes = walk(tree)

  const scopesOnText = new Set(nodes.filter((n) => n.type === 'Text' && typeof n.hover?.scope === 'string').map((n) => n.hover!.scope as string))
  const cards = nodes.filter((n) => n.type === 'Box' && n.props?.display === 'none')

  expect([...scopesOnText].sort()).toEqual(['sl-cost', 'sl-ctx', 'sl-five-hour-limit', 'sl-git-branch', 'sl-model', 'sl-session', 'sl-weekly-limit'])
  expect(cards).toHaveLength(7)
  expect(tree.props?.flexDirection).toBe('column')
  // Each card is placed out of the flow against the bar's first column, one row
  // up: revealing it gives no sibling less room and moves no row.
  for (const card of cards) {
    expect(tree.children).toContain(card)
    expect(card.props).toMatchObject({ position: 'absolute', top: -1, left: 0 })
    expect(card.hover).toMatchObject({ display: 'flex' })
    expect(scopesOnText.has(card.hover!.scope as string)).toBe(true)
  }
  const inFlow = (tree.children as Node[]).filter((c) => c.props?.position !== 'absolute')
  expect(inFlow).toHaveLength(1)
  expect(inFlow.some((c) => walk(c).some((n) => n.props?.display === 'none'))).toBe(false)
  expect(textOf(cards.find((b) => b.hover!.scope === 'sl-git-branch')!)).toContain('repo=demo')
  expect(textOf(cards.find((b) => b.hover!.scope === 'sl-git-branch')!)).toContain('ref=feature/hover')
  expect(rowOf(nodes)).not.toContain('<<sl:')
})

test('the hint line passes through untouched while the placement is above', async ($, on) => {
  world(on)
  await start($)
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Text', text: 'ENGINE PromptHint' })).toBeDefined()
  expect(barText(walk(await ui.drawn()))).toBe('')
})

test('a failing usage read leaves the previous figures standing and the rest still draw', async ($, on) => {
  let failing = false
  let context: Record<string, number> = { tokens: 12000, window: 200000 }
  world(on, {
    'command.run': (_$: any, _e: any) => ({ text: '' }),
    'session.usage': () => {
      if (failing) throw new Error('usage exploded')
      return { value: { context, rateLimits: [], cost: { usd: 0.09 } } }
    },
  })
  await start($)
  const first = await $.ui.mount({ ...BAND_MOUNT, requestId: 'good' })
  expect(rowOf(walk(await first.drawn()))).toContain(ctxText(12000, 200000))

  failing = true
  await core($, 'model')
  const second = await $.ui.mount({ ...BAND_MOUNT, requestId: 'failing' })
  const kept = rowOf(walk(await second.drawn()))
  // §10.4: the last good snapshot stands through the failed read — no zero, no lost segment
  expect(kept).toContain(ctxText(12000, 200000))
  expect(kept).toContain('$0.09')

  failing = false
  context = { tokens: 15000, window: 200000 }
  await core($, 'model')
  const third = await $.ui.mount({ ...BAND_MOUNT, requestId: 'recovered' })
  expect(rowOf(walk(await third.drawn()))).toContain(ctxText(15000, 200000))
})

test('a model id from the engine draws raw by default and the detail keeps the display name', async ($, on) => {
  world(on, { 'session.model': () => ({ value: 'claude-fable-5-1' }) })
  await start($)
  const ui = await $.ui.mount(BAND_MOUNT)
  const nodes = walk(await ui.drawn())

  const barPieces = nodes.filter((n) => n.type === 'Text' && n.hover?.scope === 'sl-model').map(textOf)
  expect(barPieces).toContain('claude-fable-5-1')
  expect(textOf(nodes.find((n) => n.type === 'Box' && n.hover?.scope === 'sl-model')!)).toContain('display=Fable 5.1')
})

test('displayName maps claude ids the way the classic payload names them', async () => {
  expect(displayName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(displayName('claude-opus-5')).toBe('Opus 5')
  expect(displayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(displayName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(displayName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(displayName('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  expect(displayName('Fable 5.1')).toBe('Fable 5.1')
  expect(displayName('haiku')).toBe('haiku')
})

test('before the first response the unknown context reads a stub, never a zero', async ($, on) => {
  world(on, { 'session.usage': () => ({ value: { context: { window: 1000000 }, cost: { usd: 0 } } }) })
  await start($)
  const ui = await $.ui.mount(BAND_MOUNT)
  const nodes = walk(await ui.drawn())
  // §12.3: «ещё нет» — заглушка той же ширины; ноль вместо неизвестного — ложь
  expect(rowOf(nodes)).toContain('ctx …/1000000')
  expect(rowOf(nodes)).not.toContain('ctx 0/1000000')
  expect(textOf(nodes.find((n) => n.type === 'Box' && n.hover?.scope === 'sl-ctx')!)).toContain('tokens=(no data yet)')
})

test('an effort row among the config rows seeds the level before any turn.step', async ($, on) => {
  world(on, {
    'config.list': () => ({
      value: [{ key: 'effortLevel', label: 'Effort', kind: 'choice', value: 'xhigh', options: ['low', 'medium', 'high', 'xhigh', 'max'], provider: { plugin: 'engine', tier: 'user' }, isLocked: false }],
    }),
  })
  await start($)
  const ui = await $.ui.mount(BAND_MOUNT)
  const nodes = walk(await ui.drawn())
  expect(await ui.find({ type: 'Text', text: 'Fable 5.1 xhigh' })).toBeDefined()
  expect(textOf(nodes.find((n) => n.type === 'Box' && n.hover?.scope === 'sl-model')!)).toContain('effort=xhigh')
})

test('the first gathers of a session share one read of the config rows', async ($, on) => {
  let reads = 0
  const w = world(on, {
    'config.list': () => {
      reads += 1
      return { value: [{ key: 'effortLevel', label: 'Effort', kind: 'choice', value: 'high', options: ['low', 'high'], provider: { plugin: 'engine', tier: 'user' }, isLocked: false }] }
    },
  })
  await Promise.all([start($), $.ui.mount(BAND_MOUNT)])
  await w.clock.settle()
  expect(reads).toBe(1)
})

test('session.start registers /statusline-mod and the bare command opens the picker pane', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['statusline-mod'])
  const before = await $.ui.mount(PANE_MOUNT)
  expect(await before.find({ key: 'save' })).toBeUndefined()
  await before.unmount()

  const result = await command($)
  expect(result.text).toBeUndefined()
  expect(w.opened).toEqual([{ id: 'statusline', title: 'Status line', focus: true, closeOnEscape: true, rows: 24 }])
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

test('a non-interactive session gets the /config path instead of the picker', async ($, on) => {
  const w = world(on)
  await start($, false, null)
  const result = await command($)
  expect(result.text).toContain('/config (fields catalyst-statusline.*)')
  expect(result.text).toContain('/statusline-mod')
  expect(w.opened).toEqual([])
  expect(w.persisted.has(STORE_OPEN)).toBe(false)
})

test('the picker stays open through a module reload for the session that opened it', async ($, on) => {
  world(on, {}, { 'statusline.open.v1': { session: SESSION_ID }, 'statusline.draft.v1': { session: SESSION_ID, lines: [[{ id: 'cost', body: '{cost.text}' }]], axes: { theme: 'default' }, focus: null } })
  await start($)
  const pane = await $.ui.mount(PANE_MOUNT)
  expect(await pane.find({ key: 'seg:cost' })).toBeDefined()
})

test('a picker another session opened is not drawn', async ($, on) => {
  world(on, {}, { 'statusline.open.v1': { session: 'b7c3a1d2-0e4f-4a6b-8c9d-1f2e3a4b5c6d' } })
  await start($)
  const pane = await $.ui.mount(PANE_MOUNT)
  expect(await pane.find({ key: 'save' })).toBeUndefined()
})

test('the picker yields the band to a survey', async ($, on) => {
  world(on)
  await start($)
  await command($)
  const band = await $.ui.mount({ ...BAND_MOUNT, props: { ...BAND_MOUNT.props, hasSurvey: true } })
  const nodes = walk(await band.drawn())
  expect(rowOf(nodes)).toContain('ENGINE AbovePrompt')
  expect(nodes.filter((n) => n.type === 'Text' && typeof n.hover?.scope === 'string')).toHaveLength(0)
})

test('the band narrows by the common eviction order and the last survivor stays', async ($, on) => {
  world(on)
  await start($)
  const narrow = await $.ui.mount({ ...BAND_MOUNT, props: { ...BAND_MOUNT.props, bodyColumns: 10, scroll: { offset: 0, bodyRows: 29 } }, requestId: 'narrow-band' })
  const t = rowOf(walk(await narrow.drawn()))
  expect(t).toContain('Fable 5.1')
  expect(t).not.toContain('$')
  expect(t).not.toContain('(feature/hover)')
})

const STEP = { turnId: 'turn-1', index: 0, messageCount: 1 }
const STEP_RESULT = { turnId: 'turn-1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
// Beneath the plugin, a model request that answers at once with an empty response.
const ANSWER = {
  'turn.step': async function* () {
    return { ...STEP_RESULT }
  },
}
const modelCommand = ($: Engine) =>
  $.command.run({ command: 'model', args: 'opus', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

// Reads a model request through to its end, the way the engine consumes the stream.
async function step($: Engine, input: Record<string, unknown>) {
  const stream = $.turn.step({ ...STEP, ...input } as any)
  for await (const _chunk of stream) {
    // the chunks are the model's, nothing here reads them
  }
  return stream.result
}

test('a model switch shows from the first main-loop request, before the turn completes', async ($, on) => {
  let model = 'claude-fable-5-1'
  world(on, { ...ANSWER, 'session.model': () => ({ value: model }) })
  await start($)
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'm1' })).drawn()))).toContain('claude-fable-5-1')

  model = 'claude-opus-5-5[1m]'
  await step($, { model: 'claude-opus-5-5', effort: 'max' })

  const during = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'during-turn' })).drawn()))
  expect(during).toContain('claude-opus-5-5[1m] max')
  expect(during).not.toContain('fable-5-1')
})

test('a subagent request leaves the model and effort on the bar alone', async ($, on) => {
  world(on, ANSWER)
  await start($)

  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await step($, { model: 'claude-haiku-4-5-20251001', effort: 'low', agentId: 'agent-1' })

  const bar = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'sub' })).drawn()))
  expect(bar).toContain('Fable 5.1 max')
  expect(bar).not.toContain('low')
  expect(bar).not.toContain('haiku')
})

test('/model redraws the bar with the new model once the command has run', async ($, on) => {
  let model = 'claude-fable-5-1'
  world(on, {
    'session.model': () => ({ value: model }),
    'command.run': (_$: any, e: any) => {
      if (e.command === 'model') model = 'claude-opus-5-5[1m]'
      return { text: 'Set model to Opus 5.5 (1M context)' }
    },
  })
  await start($)

  const result = await modelCommand($)

  expect(result.text).toBe('Set model to Opus 5.5 (1M context)')
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'after-model' })).drawn()))).toContain('claude-opus-5-5[1m]')
})

test('a change to the model row of /config redraws the bar once it is written', async ($, on) => {
  let model = 'claude-fable-5-1'
  world(on, {
    'session.model': () => ({ value: model }),
    'config.set': (_$: any, e: any) => {
      if (e.key === 'model') model = String(e.value)
      return { value: e.value }
    },
  })
  await start($)

  await $.config.set({ key: 'model', value: 'claude-opus-5-5[1m]', previous: 'claude-fable-5-1', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })

  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'after-cfg' })).drawn()))).toContain('claude-opus-5-5[1m]')
})

test('a refresh that finishes after a newer one does not put the older model back', async ($, on) => {
  let model = 'claude-fable-5-1'
  let reads = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let markHeld!: () => void
  const heldStarted = new Promise<void>((resolve) => (markHeld = resolve))
  world(on, {
    ...ANSWER,
    // The second read of the model is the step's: it sees the old model and is held
    // until the refresh after /model has drawn the new one.
    'session.model': async () => {
      reads += 1
      const seen = model
      if (reads === 2) {
        markHeld()
        await held
      }
      return { value: seen }
    },
    'command.run': (_$: any, e: any) => {
      if (e.command === 'model') model = 'claude-opus-5-5[1m]'
      return { text: 'Set model to Opus 5.5 (1M context)' }
    },
  })
  await start($)

  const stepDone = step($, { model: 'claude-fable-5-1', effort: 'max' })
  await heldStarted
  await modelCommand($)
  release()
  await stepDone

  const bar = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'ticket' })).drawn()))
  expect(bar).toContain('claude-opus-5-5[1m]')
  expect(bar).not.toContain('fable-5-1')
})

// A core command typed at the prompt, the way the engine raises it.
const core = ($: Engine, name: string) =>
  $.command.run({ command: name, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

test('the context follows each main-loop response while its tools run, before the turn completes', async ($, on) => {
  let context: Record<string, number> = { tokens: 12000, window: 200000 }
  let stepping = false
  let readAtRequest!: () => void
  const requestRead = new Promise<void>((resolve) => (readAtRequest = resolve))
  world(on, {
    'session.usage': () => {
      if (stepping) readAtRequest()
      return { value: { context, rateLimits: [], cost: { usd: 0.01 } } }
    },
    // Beneath the plugin, a model request whose response is answered over 37K tokens.
    // The engine sends the request before the response reports that figure, so a read
    // as the request goes out still sees the figure of the response before it.
    'turn.step': async function* () {
      await requestRead
      context = { tokens: 37000, window: 200000 }
      return { ...STEP_RESULT }
    },
  })
  await start($)
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'c1' })).drawn()))).toContain(ctxText(12000, 200000))

  stepping = true
  await step($, { model: 'claude-fable-5-1', effort: 'max' })

  // The request has returned and the turn has not completed: the response's tools run now.
  const whileToolsRun = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'tools-running' })).drawn()))
  expect(whileToolsRun).toContain(ctxText(37000, 200000))
})

// Every redraw the plugin asks for is a frame in which 2.1.280 draws its own hint row
// stacked over the bar (measured live), so a refresh that finds the bar as it was asks
// for none, and one that changes it still asks.
test('a refresh that leaves the bar as it was asks for no redraw; one that changes it asks once', async ($, on) => {
  let context: Record<string, number> = { tokens: 12000, window: 200000 }
  const redraws: string[] = []
  const w = world(on, {
    ...ANSWER,
    'session.usage': () => ({ value: { context, rateLimits: [], cost: { usd: 0.01 } } }),
    'ui.invalidate': (_$: any, e: any, next: any) => {
      redraws.push(e.event)
      return next(e)
    },
  })
  await start($)
  const band = await $.ui.mount({ ...BAND_MOUNT, requestId: 'inv-band' })
  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await w.clock.settle()
  expect(barText(walk(await band.drawn()))).toContain('Fable 5.1 max')
  redraws.length = 0

  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await w.clock.settle()
  expect(redraws).toEqual([])
  expect(barText(walk(await band.drawn()))).toContain(ctxText(12000, 200000))

  context = { tokens: 37000, window: 200000 }
  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await w.clock.settle()
  expect(redraws).toEqual(['ui.render'])
  expect(barText(walk(await band.drawn()))).toContain(ctxText(37000, 200000))
})

// After a turn is interrupted, 2.1.280 answers the context with no count, which its
// typings keep for a fresh or just-compacted window, while its classic status line
// payload keeps the figure (both measured live).
test('an interrupted turn keeps the context figure with a star; a finished turn shows what the engine reports', async ($, on) => {
  let context: Record<string, number> = { tokens: 37000, window: 200000 }
  const w = world(on, {
    ...ANSWER,
    'session.usage': () => ({ value: { context, rateLimits: [], cost: { usd: 0.02 } } }),
    'turn.complete': (_$: any, e: any) => ({ text: e.answer }),
  })
  await start($)
  const band = await $.ui.mount({ ...BAND_MOUNT, requestId: 'aborted-band' })
  await step($, { model: 'claude-fable-5-1', effort: 'max' })
  await w.clock.settle()
  expect(barText(walk(await band.drawn()))).toContain(ctxText(37000, 200000))

  context = { window: 200000 }
  await $.turn.complete({ answer: '', durationMs: 5000, isAborted: true, turnId: 'turn-1', reason: 'aborted' } as any)
  await w.clock.settle()
  const stale = barText(walk(await band.drawn()))
  expect(stale).toContain(ctxText(37000, 200000))
  expect(stale).toContain('*')

  context = { window: 200000 }
  await $.turn.complete({ answer: 'done', durationMs: 5000, isAborted: false, turnId: 'turn-2', reason: 'answer' } as any)
  await w.clock.settle()
  expect(barText(walk(await band.drawn()))).toContain('ctx …/200000')
})

test('/clear redraws the bar with the new session and its empty context once the command has run', async ($, on) => {
  const NEW_ID = 'b7c3a1d2-0e4f-4a6b-8c9d-1f2e3a4b5c6d'
  let id = SESSION_ID
  let usage: Record<string, unknown> = { context: { tokens: 83000, window: 1000000 }, rateLimits: [], cost: { usd: 1.2345 } }
  world(on, {
    'session.id': () => ({ value: id }),
    'session.usage': () => ({ value: usage }),
    // Beneath the plugin, the core /clear: the process goes on under a new session id
    // whose context no response has measured yet.
    'command.run': (_$: any, e: any) => {
      if (e.command === 'clear') {
        id = NEW_ID
        usage = { context: { window: 1000000 }, cost: { usd: 0 } }
      }
      return { text: '' }
    },
  })
  await start($)
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'cl1' })).drawn()))).toContain(ctxText(83000, 1000000))

  await core($, 'clear')

  const after = await $.ui.mount({ ...BAND_MOUNT, requestId: 'after-clear' })
  const bar = barText(walk(await after.drawn()))
  expect(bar).toContain('ctx …/1000000')
  expect(bar).toContain(NEW_ID)
  expect(bar).not.toContain(SESSION_ID)
})

// Measured on 2.1.280: after /compact the context keeps the figure of the last response
// (the compaction's own request is not one), and the cost has grown by that request.
test('/compact redraws the bar with the cost the compaction added once it has run', async ($, on) => {
  let usage: Record<string, unknown> = { context: { tokens: 42000, window: 200000 }, rateLimits: [], cost: { usd: 0.09 } }
  world(on, {
    'session.usage': () => ({ value: usage }),
    'command.run': (_$: any, e: any) => {
      if (e.command === 'compact') usage = { ...usage, cost: { usd: 0.1 } }
      return { text: 'Compacted' }
    },
  })
  await start($)
  expect(barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'cp1' })).drawn()))).toContain('$0.09')

  await core($, 'compact')

  const bar = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'after-compact' })).drawn()))
  expect(bar).toContain(ctxText(42000, 200000))
  // verbatim (§13.3): the source's own figure, JS number spelling included
  expect(bar).toContain('$0.1')
})

test('a usage read that returns after a newer refresh has drawn does not put its older figures back', async ($, on) => {
  let context: Record<string, number> = { tokens: 12000, window: 200000 }
  let model = 'claude-fable-5-1'
  let stepping = false
  let reads = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let markHeld!: () => void
  const heldStarted = new Promise<void>((resolve) => (markHeld = resolve))
  world(on, {
    'session.model': () => ({ value: model }),
    // The step's second read is the one once its response has arrived: it sees 37K and
    // is held until the refresh after a /config write has drawn newer figures.
    'session.usage': async () => {
      const seen = context
      if (stepping && ++reads === 2) {
        markHeld()
        await held
      }
      return { value: { context: seen, rateLimits: [], cost: { usd: 0.01 } } }
    },
    'turn.step': async function* () {
      context = { tokens: 37000, window: 200000 }
      return { ...STEP_RESULT }
    },
    // Whatever moved the figures while the read was out, the refresh after the write
    // began later and reads them.
    'config.set': (_$: any, e: any) => {
      if (e.key === 'model') {
        model = String(e.value)
        context = { tokens: 52000, window: 200000 }
      }
      return { value: e.value }
    },
  })
  await start($)
  stepping = true

  const stepDone = step($, { model: 'claude-fable-5-1', effort: 'max' })
  await heldStarted
  await $.config.set({ key: 'model', value: 'claude-opus-5-5[1m]', previous: 'claude-fable-5-1', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  release()
  await stepDone

  const bar = barText(walk(await (await $.ui.mount({ ...BAND_MOUNT, requestId: 'after-both' })).drawn()))
  expect(bar).toContain(ctxText(52000, 200000))
  expect(bar).toContain('claude-opus-5-5[1m]')
})

test('a field with no /config row is refused in the panel, not a throw', async ($, on) => {
  const w = world(on, { 'config.list': () => ({ value: [] }) })
  await start($)
  await command($)
  await w.clock.settle()
  const pane = await $.ui.mount(PANE_MOUNT)
  await pane.press({ key: 'seg:model' })
  await w.clock.settle()
  await pane.press({ key: 'mv:left' })
  await w.clock.settle()
  await pane.press({ key: 'save' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  await pane.drawn()
  const notice = await pane.find({ type: 'Text', text: /нет строки \/config/ })
  expect(notice?.text).toContain('template')
})

const PANE = { title: 'Bad hover', isFocused: true, bodyColumns: 120, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} }

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
  await expect($.ui.mount({ plugin: 'bad-hover', surface: 'terminal', component: 'Pane', props: { ...PANE, title: 'Bad hover' }, requestId: 'bad-hover' })).rejects.toThrow(
    /hover has no Box with a key around it/,
  )
})
