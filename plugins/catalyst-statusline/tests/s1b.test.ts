import { expect, test } from 'claude-code/testing'
import repo from '../hooks/data/repo'
import external from '../hooks/data/external'
import { FAMILIES } from '../hooks/data'
import {
  __resetState, __render, __savedIds, __activeSources, __syncSourceTimers, __runEnvSources, __diag, valueOf, buildNf,
} from '../hooks/statusline'
import { world, start } from './world'

// The S1b teeth: the classic-event transcript channel (Y1, Y3), the shared
// claude --version run (Y5), the core env literals (Y7, Y8), the five-family
// registry (Y9) and body-armed sources (Y10). Live where the kit drives the
// plugin's own chain, stand where the fixed plugin options cannot place an
// element (the measured limit of REPORT-impl-v0.4-waveA). CONSTRAINT (measured
// this wave): the test's import graph and the loaded plugin are SEPARATE module
// instances — family inputs are observed only through the __-seams of this
// file's own instance; the live core is observed through the world's records.

const drain = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

test('Y1: classic SessionStart and UserPromptSubmit handlers always call next', async ($, on) => {
  const seen: string[] = []
  // the kit has nothing beneath the plugins: this bottom answers, it cannot
  // call next (measured this wave — calling next here is "no implementation")
  on('classic.SessionStart', async () => {
    seen.push('start')
    return {}
  })
  on('classic.UserPromptSubmit', async () => {
    seen.push('prompt')
    return {}
  })
  const w = world(on)
  await start($)
  await w.clock.settle()
  await ($ as unknown as { classic: { SessionStart: (e: unknown) => Promise<unknown> } }).classic.SessionStart({ source: 'startup' })
  await ($ as unknown as { classic: { UserPromptSubmit: (e: unknown) => Promise<unknown> } }).classic.UserPromptSubmit({ prompt: 'hi' })
  expect(seen).toEqual(['start', 'prompt'])
})

test('Y3: a transcript_path from classic.SessionStart is read at once, without waiting everyMs', async ($, on) => {
  on('classic.SessionStart', async () => ({}))
  const w = world(on)
  await start($)
  await w.clock.settle()
  expect(w.reads).not.toContain('/t/live.jsonl')
  await ($ as unknown as { classic: { SessionStart: (e: unknown) => Promise<unknown> } }).classic.SessionStart({ source: 'startup', transcript_path: '/t/live.jsonl' })
  await w.clock.settle()
  expect(w.reads).toContain('/t/live.jsonl')
  expect(w.clock.now()).toBeLessThan(60000)
})

test('Y5: ver and the E119 current are ONE claude --version run for both families', async () => {
  __resetState()
  const cmds: string[] = []
  const $: unknown = {
    clock: { now: async () => 0, every: () => { throw new Error('direct clock.every') } },
    process: {
      run: async (argv: string[]) => {
        cmds.push(argv.join(' '))
        return { exitCode: 0, stdout: argv[0] === 'curl' ? '2.1.282\n' : '2.1.281 (tweakcc)\n', stderr: '' }
      },
    },
    fs: { read: async () => '' },
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
  __render({ template: 'v={ver.text}||u={u-newer-version.mark}' })
  await __syncSourceTimers($ as never)
  await drain()
  expect(cmds.filter((c) => c.startsWith('claude --version'))).toHaveLength(1)
  // both families consumed the one run: base's ver draws, usage shows the arrow
  const ver = valueOf('ver', undefined, {}, buildNf({}))
  expect(ver?.value.state).toBe('ok')
  const newer = valueOf('u-newer-version', undefined, {}, buildNf({}))
  expect(newer?.value.state).toBe('ok')
  if (newer?.value.state === 'ok') expect(newer.value.text).toBe('↑2.1.282')
  __render({})
  __resetState()
})

test('Y7: the core reads every family env name through its literal; NEON_API_KEY never carries its value', async ($, on) => {
  const NEON_SENTINEL = 'stand-invented-key-value-xyz'
  const FAMILY_NAMES = ['HEADSIGN_OBSERVER', 'CLAUDE_INSTANCE_N', 'CLAUDE_CONFIG_DIR', 'PWD', 'KITTY_WINDOW_ID', 'ITERM_SESSION_ID', 'TERM_PROGRAM', 'DEADLINE_TIME', 'NEON_DATABASE', 'NEON_ENDPOINT', 'NEON_API_KEY', 'NEON_PROJECT_ID']
  const values: Record<string, string> = {
    HOME: '/work/tester',
    CLAUDE_CODE_EXECPATH: '/fake/bin/claude',
  }
  for (const n of FAMILY_NAMES) values[n] = n === 'NEON_API_KEY' ? NEON_SENTINEL : 'probe-' + n
  // live: every family name (and HOME) is asked through the literal set
  const asked = new Set<string>()
  const w = world(on, { 'env.get': (_$: unknown, e: { name: string }) => { asked.add(e.name); return { value: values[e.name] } } })
  await start($)
  await w.clock.settle()
  for (const n of [...FAMILY_NAMES, 'HOME']) expect(asked.has(n)).toBe(true)
  expect(w.logs.some((l) => l.includes('env-literal-') || l.includes('no core literal'))).toBe(false)
  // stand: the env inputs the families receive — only the marker crosses
  const captured: unknown[] = []
  const origRepo = repo.reduce
  const origExt = external.reduce
  const tap = (orig: unknown) => (st: unknown, input: unknown) => {
    captured.push(JSON.parse(JSON.stringify(input)))
    return (orig as (st: unknown, input: unknown) => unknown)(st, input)
  }
  ;(repo as { reduce: unknown }).reduce = tap(origRepo)
  ;(external as { reduce: unknown }).reduce = tap(origExt)
  try {
    __resetState()
    await __runEnvSources({ env: { get: async (name: string) => values[name] }, clock: { now: async () => 0 } } as never)
    const envInputs = captured.filter((i) => (i as { source?: { kind?: string } }).source?.kind === 'env')
    const repoEnv = envInputs.find((i) => JSON.stringify((i as { source?: { names?: string[] } }).source?.names ?? []).includes('NEON_API_KEY')) as { data?: Record<string, unknown> }
    expect(repoEnv).toBeDefined()
    expect(repoEnv?.data?.['NEON_API_KEY']).toBe('set')
    expect(JSON.stringify(captured)).not.toContain(NEON_SENTINEL)
    expect(__diag().filter((d) => d.key.startsWith('env-literal-'))).toEqual([])
  } finally {
    ;(repo as { reduce: unknown }).reduce = origRepo
    ;(external as { reduce: unknown }).reduce = origExt
    __resetState()
  }
})

test('Y8: an env.get refusal is loud — the env-read-<name> diagnostic names it', async ($, on) => {
  const w = world(on, {
    'env.get': async (_$: unknown, e: { name: string }) => {
      if (e.name === 'PWD') throw new Error('not allowed here')
      return { value: e.name === 'HOME' ? '/work/tester' : e.name === 'CLAUDE_CODE_EXECPATH' ? '/fake/bin/claude' : 'v' }
    },
  })
  await start($)
  await w.clock.settle()
  // the live core's diag buffer is its own instance; its flush reaches ui.log
  expect(w.logs.some((l) => l.includes('PWD: env.get refused'))).toBe(true)
})

test('Y9: FAMILIES is the complete five-family registry; element ids unique across families', () => {
  expect(FAMILIES.map((f) => f.family)).toEqual(['model', 'context', 'agents', 'git', 'github'])
  const ids = FAMILIES.flatMap((f) => f.elements.map((e) => e.id))
  expect(new Set(ids).size).toBe(ids.length)
  // a family may add variants to another family's element; the owner keeps the id
  const contributor = FAMILIES.find((f) => (f.variantsFor ?? []).some((vf) => vf.element === 'ctx'))
  expect(contributor?.elements.some((e) => e.id === 'ctx')).toBe(false)
})

test('Y10: a segment body x={ctx.text} arms the usage ctx sources through savedIds', () => {
  __resetState()
  __render({ template: 'x={ctx.text}' })
  expect(__savedIds()).toContain('ctx')
  const keys = __activeSources(__savedIds())
  expect(keys.some((k) => k.includes('"kind":"transcript"'))).toBe(true)
  __render({})
  __resetState()
})
