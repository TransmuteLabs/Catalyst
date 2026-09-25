import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Input } from '../hooks/data/types'
import {
  __activeSources, __diag, __feed, __refresh, __render, __resetState, __runEnvSources, __savedIds,
  __setArmEvery, __syncSourceTimers, buildNf, valueOf,
} from '../hooks/statusline'
import * as statusline from '../hooks/statusline'
import { world, start, BAND_MOUNT, walk, textOf } from './world'
import type { Node } from './world'

// Teeth for the timer, scope and cap fixes. The loaded plugin and this import
// are separate module instances: timer refusal is injected through __setArmEvery
// on THIS instance, because the kit owns clock.every on the loaded one.

const drain = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await Promise.resolve()
}

const timerStand = (): { $: any; cmds: string[]; reads: string[]; nowMs: { n: number } } => {
  const cmds: string[] = []
  const reads: string[] = []
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
    fs: {
      read: async (path: string) => {
        reads.push(String(path))
        return ''
      },
    },
    env: { get: async (name: string) => (name === 'HOME' ? '/work/tester' : '') },
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
  return { $, cmds, reads, nowMs }
}

function rowOf(nodes: Node[]): string {
  return nodes.filter((n) => n.type === 'Text').map(textOf).join('')
}

const bandText = async ($: Engine, requestId: string): Promise<string> => {
  const band = await $.ui.mount({ ...BAND_MOUNT, requestId })
  return rowOf(walk(await band.drawn()))
}

const holdTools = (on: any) => {
  const gates = new Map<string, () => void>()
  const hold = (key: string) => new Promise<void>((resolve) => { gates.set(key, resolve) })
  on('tool.call', async (_$: any, e: any) => {
    const id = typeof e.tool_use_id === 'string' && e.tool_use_id !== '' ? String(e.tool_use_id) : String(e.tool)
    await hold(id)
    return { result: 'ok' }
  })
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer ?? '' }))
  const release = (id: string): void => {
    const fn = gates.get(id)
    if (!fn) throw new Error('no gate for ' + id + ' have ' + [...gates.keys()].join(','))
    fn()
  }
  return release
}

test('G1: a source that leaves the layout has cancel() called on its timer', async () => {
  __resetState()
  __render({ template: 'x={git.text}' })
  const stand = timerStand()
  let cancels = 0
  __setArmEvery(() => ({ cancel() { cancels++ } }))
  try {
    await __syncSourceTimers(stand.$)
    await drain()
    expect(cancels).toBe(0)
    __render({ template: 'x={model.text}' })
    await __syncSourceTimers(stand.$)
    await drain()
    expect(cancels).toBeGreaterThan(0)
  } finally {
    __resetState()
  }
})

test('G2: a timer that never fires is re-armed once it is older than two periods', async () => {
  __resetState()
  __render({ template: 'x={git.text}' })
  const stand = timerStand()
  let arms = 0
  let every = 0
  __setArmEvery((ms) => {
    arms++
    // S1-FIX3 F1 widened the arm set: the tooth tracks the 8000 ms git timer,
    // the family clock (1000 ms) arming alongside it is the fixed behavior.
    if (ms === 8000) every = ms
    return { cancel() {} }
  })
  try {
    await __syncSourceTimers(stand.$)
    await drain()
    expect(every).toBe(8000)
    const armed = arms
    stand.nowMs.n += 2 * every + 1001
    await __refresh(stand.$)
    await drain()
    expect(arms).toBeGreaterThan(armed)
    expect(__diag().some((d) => d.kind === 'warn' && d.key.startsWith('timer-dead-') && d.text.includes('every='))).toBe(true)
  } finally {
    __resetState()
  }
})

test('G3: a refused arm is not read again until its everyMs has elapsed on a fresh clock', async () => {
  __resetState()
  __render({ template: 'x={git.text}' })
  const stand = timerStand()
  stand.nowMs.n = 100000
  let every = 0
  __setArmEvery((ms) => {
    // S1-FIX3 F1: the family clock arm joins the 8000 ms git arm and is also
    // refused here; the tooth tracks the git timer it speaks about.
    if (ms === 8000) every = ms
    throw new Error('refused')
  })
  try {
    await __syncSourceTimers(stand.$)
    await drain()
    expect(every).toBe(8000)
    const reads = stand.cmds.filter((c) => c.includes('rev-parse')).length
    expect(reads).toBeGreaterThan(0)
    await __refresh(stand.$)
    await drain()
    expect(stand.cmds.filter((c) => c.includes('rev-parse')).length).toBe(reads)
    stand.nowMs.n = 107999
    await __refresh(stand.$)
    await drain()
    expect(stand.cmds.filter((c) => c.includes('rev-parse')).length).toBe(reads)
    stand.nowMs.n = 108000
    await __refresh(stand.$)
    await drain()
    expect(stand.cmds.filter((c) => c.includes('rev-parse')).length).toBeGreaterThan(reads)
  } finally {
    __resetState()
  }
})

test('G4: a refused clock.now is diagnosed and a refused source is retried on the next refresh', async () => {
  __resetState()
  __render({ template: 'x={git.text}' })
  const stand = timerStand()
  let throwNow = false
  stand.$.clock.now = async () => {
    if (throwNow) throw new Error('clock down')
    return stand.nowMs.n
  }
  __setArmEvery(() => {
    throw new Error('refused')
  })
  try {
    await __syncSourceTimers(stand.$)
    await drain()
    const reads = stand.cmds.filter((c) => c.includes('rev-parse')).length
    expect(reads).toBeGreaterThan(0)
    throwNow = true
    stand.nowMs.n = 1000
    await __refresh(stand.$)
    await drain()
    expect(__diag().some((d) => d.kind === 'warn' && d.key === 'clock-now' && d.text.length > 0)).toBe(true)
    expect(stand.cmds.filter((c) => c.includes('rev-parse')).length).toBeGreaterThan(reads)
  } finally {
    __resetState()
  }
})

test('G5: a settings read whose error text throws becomes stale, not a silent ok', async () => {
  __resetState()
  __render({ template: 'x={style.text}' })
  const stand = timerStand()
  let body = JSON.stringify({ outputStyle: 'explanatory', hooks: {} })
  const poison = { toString() { throw new Error('poison') } }
  const armed: Array<{ ms: number; fn: () => void }> = []
  stand.$.fs.read = async () => {
    if (body === 'THROW') throw poison
    return body
  }
  __setArmEvery((ms: number, fn: () => void) => {
    armed.push({ ms, fn })
    return { cancel() {} }
  })
  const style = () => valueOf('style', undefined, {}, buildNf({}))!.value
  try {
    await __runEnvSources(stand.$)
    await __syncSourceTimers(stand.$)
    await drain()
    const good = style()
    expect(good.state).toBe('ok')
    if (good.state === 'ok') expect(good.text).toBe('explanatory')
    // CONSTRAINT (S1-FIX4 П.4, ADJUDICATION-v0.5-S1-FIX3 Н3): the tooth speaks
    // about the settings-file timer — it must call it by its own ms, the same
    // timer the product armed for everyMs 30000, not by arm position.
    const settingsFns = armed.filter((a) => a.ms === 30000).map((a) => a.fn)
    expect(settingsFns.length).toBe(1)
    body = 'THROW'
    settingsFns[0]!()
    await drain()
    const failed = style()
    expect(failed.state).toBe('stale')
    if (failed.state === 'stale') {
      expect(failed.last.text).toBe('explanatory')
      expect(failed.reason).toContain('unprintable error')
    }
  } finally {
    __resetState()
  }
})

test('G6a: aborting the main turn drops only the call that had no agentId', async ($, on) => {
  const release = holdTools(on)
  const w = world(on)
  await start($)
  await w.clock.settle()
  const read = $.tool.call({ tool: 'Read', tool_use_id: 'rd', input: { file_path: 'a.ts' } } as any)
  const bash = $.tool.call({ tool: 'Bash', tool_use_id: 'sh', agentId: 'main', input: { command: 'ls' } } as any)
  await w.clock.settle()
  expect(await bandText($, 'g6a-run')).toContain('◐ Read')
  expect(await bandText($, 'g6a-bash')).toContain('◐ Bash')
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 'g6a', reason: 'aborted' } as any)
  await w.clock.settle()
  const after = await bandText($, 'g6a-abort')
  expect(after).not.toMatch(/◐ Read/)
  expect(after).toContain('◐ Bash')
  expect(after).not.toContain('Bash ×')
  expect(after).not.toContain('Read ×')
  release('rd')
  release('sh')
  await read
  await bash
})

test('G6b: a real tool_use_id of anon:1 does not share a key with a call that has none', async ($, on) => {
  const release = holdTools(on)
  const w = world(on)
  await start($)
  await w.clock.settle()
  const named = $.tool.call({ tool: 'Read', tool_use_id: 'anon:1', input: { file_path: 'a.ts' } } as any)
  const bare = $.tool.call({ tool: 'Bash', tool_use_id: '', input: { command: 'ls' } } as any)
  await w.clock.settle()
  expect(await bandText($, 'g6b-run')).toContain('◐ Read')
  release('Bash')
  await bare
  await w.clock.settle()
  const after = await bandText($, 'g6b-one')
  expect(after).toContain('◐ Read')
  expect(after).not.toMatch(/◐ Bash/)
  expect(after).toContain('Bash ×1')
  release('anon:1')
  await named
})

test('G7a: an ordinary turn.complete drops its own scope and does not count the row', async ($, on) => {
  const release = holdTools(on)
  const w = world(on)
  await start($)
  await w.clock.settle()
  const bash = $.tool.call({ tool: 'Bash', tool_use_id: 'b', input: { command: 'ls' } } as any)
  const read = $.tool.call({ tool: 'Read', tool_use_id: 'a', agentId: 'other', input: { file_path: 'a.ts' } } as any)
  await w.clock.settle()
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'g7a' } as any)
  await w.clock.settle()
  const after = await bandText($, 'g7a')
  expect(after).not.toMatch(/◐ Bash/)
  expect(after).toContain('◐ Read')
  expect(after).not.toContain('Bash ×')
  release('b')
  release('a')
  await bash
  await read
})

test('G7b: session.start with a new id drops a row left hanging from the previous session', async ($, on) => {
  const release = holdTools(on)
  const w = world(on)
  await start($)
  await w.clock.settle()
  const read = $.tool.call({ tool: 'Read', tool_use_id: 'rd', input: { file_path: 'a.ts' } } as any)
  await w.clock.settle()
  expect(await bandText($, 'g7b-run')).toContain('◐ Read')
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/demo/src', sessionId: 'sess-new' } as any)
  await w.clock.settle()
  expect(await bandText($, 'g7b-next')).not.toMatch(/◐ Read/)
  release('rd')
  await read
})

test('G7c: session.end drops a hanging tool row', async ($, on) => {
  const release = holdTools(on)
  const w = world(on)
  await start($)
  await w.clock.settle()
  const read = $.tool.call({ tool: 'Read', tool_use_id: 'rd', input: { file_path: 'a.ts' } } as any)
  await w.clock.settle()
  expect(await bandText($, 'g7c-run')).toContain('◐ Read')
  await $.session.end({ reason: 'exit', sessionId: 'sess-a' } as any)
  await w.clock.settle()
  expect(await bandText($, 'g7c-end')).not.toMatch(/◐ Read/)
  release('rd')
  await read
})

test('G7d: an empty sessionId after sess-a does not restart the duration', async ($, on) => {
  const w = world(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/demo/src', sessionId: 'sess-a' } as any)
  await w.clock.settle()
  await w.clock.advance(60_000)
  expect(await bandText($, 'g7d-a')).toContain('up ⏱ 1m')
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/demo/src', sessionId: '' } as any)
  await w.clock.settle()
  const kept = await bandText($, 'g7d-b')
  expect(kept).toContain('up ⏱ 1m')
  expect(kept).not.toContain('up ⏱ 0s')
})

test('G8: the 257th simultaneous tool call is diagnosed and counted once', () => {
  __resetState()
  try {
    for (let i = 0; i < 257; i++) {
      const input: Input = {
        source: { kind: 'event', event: 'tool.call' },
        ok: true,
        data: { tool: 'Read', callKey: 't:' + String(i), agentScope: 'm', input: { file_path: String(i) } },
        now: 1,
      }
      __feed(input)
    }
    expect(__diag().some((d) => d.kind === 'warn' && d.key === 'tools-cap' && d.text.length > 0)).toBe(true)
    expect(statusline.__toolsCapDropped()).toBe(1)
  } finally {
    __resetState()
  }
})

test('G9: a tool result that carries no call id clears only its own row', async ($, on) => {
  const release = holdTools(on)
  const w = world(on)
  await start($)
  await w.clock.settle()
  const first = $.tool.call({ tool: 'Read', tool_use_id: 'a', input: { file_path: 'a.ts' } } as any)
  const second = $.tool.call({ tool: 'Read', tool_use_id: 'b', input: { file_path: 'b.ts' } } as any)
  await w.clock.settle()
  release('a')
  await first
  await w.clock.settle()
  const mid = await bandText($, 'g9')
  expect(mid).toContain('◐ Read')
  expect(mid).toContain('Read ×1')
  expect(mid).not.toContain('Read ×2')
  release('b')
  await second
})

test('R11: one env.get per name per pass is shared by every family that declared it', async () => {
  __resetState()
  const got: string[] = []
  const inputs: Array<Record<string, unknown>> = []
  const fam = (label: string) => ({
    family: label,
    elements: [],
    sources: [{ source: { kind: 'env', names: ['PWD'] }, elements: [] }],
    init: () => ({}),
    reduce: (_st: unknown, input: { data?: Record<string, unknown> }) => {
      inputs.push(input.data ?? {})
      return {}
    },
    value: () => ({ state: 'pending' as const }),
  })
  try {
    await __runEnvSources(
      { env: { get: async (name: string) => { got.push(name); return 'probe-' + name } }, clock: { now: async () => 0 } } as never,
      [fam('a'), fam('b')] as never,
    )
    expect(got).toEqual(['PWD'])
    expect(inputs).toHaveLength(2)
    expect(inputs[0]?.['PWD']).toBe('probe-PWD')
    expect(inputs[1]?.['PWD']).toBe('probe-PWD')
  } finally {
    __resetState()
  }
})

test('perf-tick: one timer callback reads only its own source on a layout that arms every family', async () => {
  __resetState()
  __render({ template: 'a={git.text} b={u-git-staged.text} c={a-ship-blockers.text} d={r-dirty-counts.text} e={github.text}' })
  const keys = __activeSources(__savedIds())
  expect(keys.some((k) => k.includes('rev-parse') && k.includes('abbrev-ref'))).toBe(true)
  expect(keys.some((k) => k.includes('--porcelain"'))).toBe(true)
  expect(keys.some((k) => k.includes('porcelain=v1'))).toBe(true)
  expect(keys.some((k) => k.includes('ship-plan-audit'))).toBe(true)
  expect(keys.some((k) => k.includes('"gh"') && k.includes('"repo"') && k.includes('"view"'))).toBe(true)
  const stand = timerStand()
  const fns = new Map<number, Array<() => void>>()
  __setArmEvery((ms: number, fn: () => void) => {
    const list = fns.get(ms) ?? []
    list.push(fn)
    fns.set(ms, list)
    return { cancel() {} }
  })
  try {
    await __syncSourceTimers(stand.$)
    await drain()
    const tick = fns.get(8000) ?? []
    expect(tick).toHaveLength(1)
    const cmds = stand.cmds.length
    const reads = stand.reads.length
    const rev = stand.cmds.filter((c) => c.includes('rev-parse --abbrev-ref')).length
    tick[0]!()
    await drain()
    expect(stand.cmds.filter((c) => c.includes('rev-parse --abbrev-ref')).length).toBe(rev + 1)
    expect(stand.cmds.length).toBe(cmds + 1)
    expect(stand.reads.length).toBe(reads)
  } finally {
    __resetState()
  }
})
