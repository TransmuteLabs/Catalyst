import { expect, test } from 'claude-code/testing'

// Timing of the mod's render path in-process, for the comparison with the classic
// statusLine command (one node process per update). Prints medians; asserts only that
// the bar drew, so a slow box does not turn the timing into a red run.

const PROPS = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const VIEWPORT = { columns: 140, rows: 40, isFullscreen: true }
const USAGE = {
  context: { tokens: 83000, window: 1000000, percent: 8 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 25 }, { kind: 'seven_day', percentUsed: 61.5 }],
  cost: { usd: 1.2345 },
}
const REPO = { root: '/work/demo', remote: 'git@github.com:konsta95/demo.git', internal: false, name: 'demo' }

function mockSession(on: any) {
  on('session.cwd', () => ({ value: '/work/demo/src' }))
  on('session.repo', () => ({ value: REPO }))
  on('session.model', () => ({ value: 'Fable 5.1' }))
  on('session.id', () => ({ value: '4e1f0c9a-7b2d-4c58-9a36-d1e8f5b2c703' }))
  on('session.usage', () => ({ value: USAGE }))
  on('fs.read', (_$: any, e: any) => {
    if (e.path === '/work/demo/.git/HEAD') return { value: 'ref: refs/heads/feature/hover\n' }
    throw new Error('ENOENT: ' + e.path)
  })
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

test('perf: first mount (gather via nouns + render) and 200 cached renders', async ($, on) => {
  mockSession(on)
  const t0 = performance.now()
  const first = await $.ui.mount({ plugin: 'catalyst-statusline', surface: 'terminal', component: 'PromptHint', props: PROPS, requestId: 'perf-0', viewport: VIEWPORT })
  const firstMs = performance.now() - t0
  expect(await first.find({ type: 'Text', text: '83K/1M' })).toBeDefined()

  const times: number[] = []
  for (let i = 1; i <= 200; i++) {
    const t = performance.now()
    const ui = await $.ui.mount({ plugin: 'catalyst-statusline', surface: 'terminal', component: 'PromptHint', props: PROPS, requestId: 'perf-' + i, viewport: VIEWPORT })
    await ui.drawn()
    times.push(performance.now() - t)
  }
  const s = [...times].sort((a, b) => a - b)
  console.log('PERF first_mount_ms=' + firstMs.toFixed(2) + ' cached_median_ms=' + median(times).toFixed(3) + ' cached_p90_ms=' + s[Math.floor(s.length * 0.9)].toFixed(3) + ' cached_max_ms=' + s[s.length - 1].toFixed(3) + ' n=' + times.length)
})
