import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { FAMILIES } from '../hooks/data'

// R10 teeth (BRIEF-v0.5-S1-FIX2c): only a clock tick may skip a frame. Every
// picture input from FIX2b п.2а gets one tooth: change ONLY that input between
// two clock ticks → the picture rebuilds (the __pictureBuilds() counter +1).
// The teeth run against the imported module instance; the kit's loaded copy is
// deliberately not touched (fix2.test.ts header states the same split).

const drain = async (): Promise<void> => {
  for (let i = 0; i < 60; i++) await Promise.resolve()
}

const RAW = { template: 'dur||x=constant', numDuration: 'clock', details: 'off' }
const event = (name: string, data: unknown, now = 0): void => {
  SL.__feed({ source: { kind: 'event', event: name } as never, ok: true, data, now } as never)
}

type Picture = {
  $: any
  tick: () => Promise<void>
  builds: () => number
  time: { n: number }
  arm: () => void
}

async function picture(check: (p: Picture) => Promise<void>, started = true): Promise<void> {
  SL.__resetState()
  SL.__render(RAW)
  if (started) event('session.start', { sessionId: 'picture-a' })
  const time = { n: 65000 }
  let run: () => void = () => {
    throw new Error('clock source was not armed')
  }
  const arm = (): void =>
    SL.__setArmEvery((ms: number, fn: () => void) => {
      expect(ms).toBe(1000)
      run = fn
      return { cancel() {} }
    })
  const $ = {
    clock: { now: async () => time.n },
    ui: { log: () => undefined, invalidate: () => undefined },
  }
  const tick = async (): Promise<void> => {
    time.n += 1000
    run()
    await drain()
  }
  arm()
  try {
    await SL.__syncSourceTimers($ as never)
    await drain()
    expect(SL.__pictureBuilds()).toBeGreaterThan(0)
    await check({ $, tick, builds: () => SL.__pictureBuilds(), time, arm })
  } finally {
    SL.__resetState()
  }
}

// Change exactly one input between two stable ticks: the second tick must build
// one picture (the clock bucket is 1-minute wide, 65..67 s all read 0:01, so a
// rebuild here can only come from the dirty mark).
async function changed(p: Picture, change: () => unknown | Promise<unknown>): Promise<void> {
  await p.tick()
  const before = p.builds()
  await change()
  await p.tick()
  expect(p.builds()).toBe(before + 1)
}

test('R10-stable: two clock ticks in the same bucket build no pictures', async () => {
  await picture(async (p) => {
    const before = p.builds()
    await p.tick()
    await p.tick()
    expect(p.builds()).toBe(before)
  })
})

test('R10-bucket: a changed clock bucket builds one picture', async () => {
  await picture(async (p) => {
    const before = p.builds()
    p.time.n = 120000
    await p.tick()
    expect(p.builds()).toBe(before + 1)
  })
})

test('R10-feed: family data dirties the next clock picture', async () => {
  await picture(async (p) => changed(p, () => {
    SL.__feed({ source: { kind: 'session', call: 'model' } as never, ok: true, data: 'changed-model', now: p.time.n } as never)
  }))
})

for (const [name, raw] of [
  ['options', { ...RAW, numTokens: 'raw' }],
  ['layout', { ...RAW, template: 'dur||x=changed' }],
  ['elements', { ...RAW, elements: 'dur:lb=off' }],
  ['theme', { ...RAW, theme: 'codex' }],
] as const) {
  test('R10-' + name + ': changed configuration dirties the next clock picture', async () => {
    await picture(async (p) => changed(p, () => SL.__render(raw)))
  })
}

// CONSTRAINT (S1-FIX3 F-diag): the band draws famStates and cfg only; S.diag
// is NOT a picture input — a record must never demand a frame.
test('R10-diag-inert: a diagnostic between two stable ticks builds no picture', async () => {
  await picture(async (p) => {
    await p.tick()
    const before = p.builds()
    SL.parseElements('not-an-element:v=x')
    await p.tick()
    expect(p.builds()).toBe(before)
  })
})

test('R10-userThemes: replacing saved themes dirties the next clock picture', async () => {
  await picture(async (p) => changed(p, () => SL.__pictureThemes({ mine: { shape: 'lean' } })))
})

test('R10-durBase: a changed duration base within the same bucket builds a picture', async () => {
  await picture(async (p) => changed(p, () => event('session.start', { sessionId: 'picture-b' }, 500)))
})

test('R10-sessionId: a new session with the same duration base builds a picture', async () => {
  await picture(async (p) => changed(p, () => event('session.start', { sessionId: 'picture-b' }, 0)))
})

test('R10-active-add: a new active tool dirties the next clock picture', async () => {
  await picture(async (p) => changed(p, () => event('tool.call', { tool: 'Read', callKey: 't:picture', agentScope: 'm' })))
})

for (const [name, input] of [
  ['result', ['tool.call', { callKey: 't:picture', callTool: 'Read', isError: false }]],
  ['turn', ['turn.complete', { turnId: 'picture-turn' }]],
  ['session', ['session.start', { sessionId: 'picture-b' }]],
  ['end', ['session.end', {}]],
] as const) {
  test('R10-active-' + name + ': active removal dirties the next clock picture', async () => {
    await picture(async (p) => {
      event('tool.call', { tool: 'Read', callKey: 't:picture', agentScope: 'm' })
      await p.tick()
      await changed(p, () => event(input[0], input[1]))
    })
  })
}

// A refused clock after a recovery: the transition false→true must dirty even
// when failDiag stays silent (the `clock-now` key is emitted once per life).
// The final tick reads the same refused clock, so no other mark can rescue it.
test('R10-clockFailed-set: a refusal after recovery dirties with no new diagnostic', async () => {
  await picture(async (p) => {
    const bad = { clock: { now: async () => { throw new Error('picture clock') } } }
    await SL.__pictureReadClock(bad as never)
    await p.tick()
    await SL.__pictureReadClock(bad as never)
    const diag = SL.__diag().length
    const before = p.builds()
    p.$.clock.now = async () => { throw new Error('picture clock') }
    await p.tick()
    expect(SL.__diag().length).toBe(diag)
    expect(p.builds()).toBe(before + 1)
  })
})

test('R10-clockFailed-clear: clock recovery dirties the next picture', async () => {
  await picture(async (p) => {
    const goodNow = p.$.clock.now
    p.$.clock.now = async () => { throw new Error('picture clock') }
    await p.tick()
    const before = p.builds()
    p.$.clock.now = goodNow
    await p.tick()
    expect(p.builds()).toBe(before + 1)
  })
})

for (const [name, initial, next] of [
  ['set', undefined, 100000], ['update', 100000, 110000], ['delete', 100000, undefined],
] as const) {
  test('R10-timerRefused-' + name + ': changed refusal state dirties the next clock picture', async () => {
    await picture(async (p) => {
      if (initial !== undefined) {
        SL.__pictureTimerRefused('picture-source', initial)
        await p.tick()
      }
      await changed(p, () => SL.__pictureTimerRefused('picture-source', next))
    })
  })
}

// __resetState zeroes the build counter, so the rebuild after it is exact.
// The refused-clock source keeps dur pending before and after the reset: the
// bucket cannot be the reason the next frame builds.
test('R10-reset: resetting state rebuilds even when the clock value stays pending', async () => {
  await picture(async (p) => {
    await p.tick()
    expect(p.builds()).toBe(1)
    SL.__resetState()
    expect(p.builds()).toBe(0)
    // CONSTRAINT (S1-FIX3 F6): __resetState restores the WHOLE state through
    // freshState(), so the saved layout is gone with it and must be applied
    // again before a source can arm.
    SL.__render(RAW)
    p.arm()
    await SL.__syncSourceTimers(p.$)
    await drain()
    expect(p.builds()).toBe(1)
    await p.tick()
    expect(p.builds()).toBe(1)
  }, false)
})

// FIX2c п.2в / решение п.1: a non-clock source tick must rebuild even with an
// unchanged value (the skip belongs to clock ticks only). run() arms a cmd
// source that answers identically every time.
test('R10-nonclock-tick: an unchanged cmd source tick builds a picture', async () => {
  SL.__resetState()
  SL.__render({ template: 'x={git.text}' })
  const armed: Array<{ ms: number; fn: () => void }> = []
  SL.__setArmEvery((ms: number, fn: () => void) => {
    armed.push({ ms, fn })
    return { cancel() {} }
  })
  const $ = {
    clock: { now: async () => 70000 },
    ui: { log: () => undefined, invalidate: () => undefined },
    process: { run: async () => ({ exitCode: 0, stdout: 'feature/hover\n', stderr: '' }) },
    fs: { read: async () => '' },
  }
  try {
    await SL.__syncSourceTimers($ as never)
    await drain()
    // S1-FIX3 F1 arms the family clock alongside the git cmd on this layout;
    // the tooth counts the rebuild a non-clock tick must add over whatever the
    // sync itself built.
    const before = SL.__pictureBuilds()
    expect(before).toBeGreaterThan(0)
    // CONSTRAINT (S1-FIX4 П.4, ADJUDICATION-v0.5-S1-FIX3 Н3): the non-clock
    // tick is chosen by the git cmd's own everyMs, never by arm position.
    const gitTicks = armed.filter((a) => a.ms === 8000).map((a) => a.fn)
    expect(gitTicks.length).toBe(1)
    gitTicks[0]!()
    await drain()
    expect(SL.__pictureBuilds()).toBe(before + 1)
  } finally {
    SL.__resetState()
  }
})

// ---------- S1-FIX3 F1: the family clock covers EVERY element of its family ----------

// Ground (S1-FIX3 F1): data/external.ts's clock entry lists x-vercel-age,
// x-ci-duration, x-deploy-time, x-ci-wait, x-deploy-wait but x-pr-toast's text
// (its 'N ago' tail) also reads the family clock stamp — the entry list is not
// the list of time-dependent elements.
const GH_PR_FIELDS = 'number,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefOid,headRefName,baseRefName,isCrossRepository,body,url,statusCheckRollup'
const prSrc = { kind: 'cmd', argv: ['gh', 'pr', 'list', '--state', 'all', '--limit', '100', '--json', GH_PR_FIELDS], everyMs: 60000, cwd: 'project' }
const prRow = (merge: string): string => JSON.stringify([{ number: 7, title: 't', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: merge, reviewDecision: '', headRefOid: 'a', headRefName: 'b', baseRefName: 'main', isCrossRepository: false, body: '', url: 'https://github.com/o/r/pull/7', statusCheckRollup: [] }])
const f1stand = (time: { n: number }, onInvalidate?: () => void) => ({
  clock: { now: async () => time.n },
  ui: { log: () => undefined, invalidate: onInvalidate ?? (() => undefined) },
  process: { run: async () => ({ exitCode: 0, stdout: '[]', stderr: '' }) },
  fs: { read: async () => '' },
})

test('F1a: x-pr-toast age advances the picture on family clock ticks', async () => {
  SL.__resetState()
  const RAW = { template: 'dur||p={x-pr-toast.text}', details: 'off' }
  SL.__render(RAW)
  const time = { n: 200000 }
  let invalidates = 0
  const $ = f1stand(time, () => { invalidates++ })
  const ev = (event: string, data: unknown, now: number): void => {
    SL.__feed({ source: { kind: 'event', event } as never, ok: true, data, now } as never)
  }
  ev('turn.start', { text: 'watch https://github.com/o/r/pull/7' }, 100000)
  // the merge-state transition creates prToast at 200000: its age text moves
  // with every 1000 ms family clock tick
  SL.__feed({ source: prSrc as never, ok: true, data: { code: 0, stdout: prRow('BEHIND'), stderr: '' }, now: 200000 } as never)
  SL.__feed({ source: prSrc as never, ok: true, data: { code: 0, stdout: prRow('CLEAN'), stderr: '' }, now: 200000 } as never)
  const clockRuns: Array<() => void> = []
  SL.__setArmEvery((ms: number, fn: () => void) => {
    if (ms === 1000) clockRuns.push(fn)
    return { cancel() {} }
  })
  try {
    await SL.__syncSourceTimers($ as never)
    await drain()
    expect(clockRuns.length).toBeGreaterThan(0)
    const builds0 = SL.__pictureBuilds()
    const inv0 = invalidates
    for (let i = 0; i < 10; i++) {
      time.n += 1000
      for (const fn of clockRuns) {
        fn()
        await drain()
      }
    }
    // the frozen-frame defect: without family coverage the bucket never sees
    // the age advance and every tick below skips the frame
    expect(SL.__pictureBuilds()).toBeGreaterThan(builds0)
    expect(invalidates).toBeGreaterThan(inv0)
    expect(JSON.stringify(SL.__render(RAW))).toContain('10s ago')
  } finally {
    SL.__resetState()
  }
})

test('F1b: a layout of x-pr-toast alone arms the 1000 ms family clock', async () => {
  SL.__resetState()
  SL.__render({ template: 'p={x-pr-toast.text}', details: 'off' })
  const armed: number[] = []
  SL.__setArmEvery((ms: number) => {
    armed.push(ms)
    return { cancel() {} }
  })
  try {
    await SL.__syncSourceTimers(f1stand({ n: 5000 }) as never)
    await drain()
    expect(armed).toContain(1000)
  } finally {
    SL.__resetState()
  }
})

// The class statement of S1-FIX3 F1, not the single element.
test('F1c: every element of a clock-bearing family stands in its clock entry', () => {
  SL.__resetState()
  try {
    let clockEntries = 0
    FAMILIES.forEach((fam, fi) => {
      fam.sources.forEach((entry, ei) => {
        if (entry.source.kind === 'clock') {
          clockEntries++
          const ids = SL.__entryIds(fi, ei)
          for (const def of fam.elements) expect(ids).toContain(def.id)
          expect(ids.slice(0, entry.elements.length)).toEqual(entry.elements)
          expect(new Set(ids).size).toBe(ids.length)
        } else {
          expect(SL.__entryIds(fi, ei)).toEqual(entry.elements)
        }
      })
    })
    expect(clockEntries).toBeGreaterThan(0)
  } finally {
    SL.__resetState()
  }
})

// ---------- S1-FIX3 F-view: the band width is a live render prop ----------

// CONSTRAINT (S1-FIX3 F-view / AR1): bodyColumns arrives with every host
// render and the band draws from it in place; a resize is not a picture input
// and must not demand a rebuild.
const drainLong = async (): Promise<void> => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

test('R10-viewport-live: AbovePrompt follows live bodyColumns without a build', async () => {
  SL.__resetState()
  const renders: Array<(eng: unknown, e: unknown, next: unknown) => Promise<unknown>> = []
  const on = (event: string, ...rest: unknown[]): void => {
    if (event === 'ui.render') renders.push(rest[rest.length - 1] as (typeof renders)[number])
  }
  const table = {
    Box: (props: Record<string, unknown>) => ({ type: 'Box', props, children: props['children'] }),
    Text: (props: Record<string, unknown>) => ({ type: 'Text', props, children: props['children'] }),
  }
  const $ = {
    clock: { now: async () => 70000, every: () => ({ cancel() {} }) },
    ui: { log: async () => undefined, invalidate: () => undefined, status: () => undefined, toast: () => undefined, resolve: async () => table },
    store: { get: async () => undefined, set: async () => undefined, delete: async () => undefined },
    session: { id: async () => 'vp', cwd: async () => '/work/demo', root: async () => '/work/demo', usage: async () => ({ context: { tokens: 1, window: 2 }, rateLimits: [], cost: { usd: 0 } }), model: async () => 'm', turns: async () => 0, messages: async () => [] },
    env: { get: async () => '' },
    fs: { read: async () => '' },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
    config: { list: async () => [], set: async () => undefined },
  }
  const VP = { template: 'a=alpha0123456789 alpha0123456789||b=bravo0123456789 bravo0123456789||c=coda', placement: 'above', details: 'off' }
  SL.register(on as never, VP as never)
  const band = async (columns: number): Promise<string> => {
    const e = { component: 'AbovePrompt', requestId: 'vp', props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: columns, scroll: { offset: 0, bodyRows: 8 }, view: {} } }
    return JSON.stringify(await renders[0]!($ as never, e, async () => undefined) as unknown)
  }
  try {
    await band(140)
    await drainLong()
    const builds = SL.__pictureBuilds()
    const narrow = await band(40)
    const wide = await band(120)
    expect(narrow).not.toBe(wide)
    expect(SL.__pictureBuilds()).toBe(builds)
  } finally {
    SL.__resetState()
  }
})
