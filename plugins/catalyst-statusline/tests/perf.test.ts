import { expect, test } from 'claude-code/testing'

// The kit's child prints it; the contract declares no console global
declare const console: { log: (...args: unknown[]) => void }
import { world, start, BAND_MOUNT, walk } from './world'

// Timing of the mod's render path in-process, for the comparison with the classic
// statusLine command (one node process per update). Prints medians; asserts only that
// the bar drew, so a slow box does not turn the timing into a red run.

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

test('perf: first mount (gather via nouns + render) and 200 cached renders', async ($, on) => {
  const w = world(on)
  await start($)
  const t0 = performance.now()
  const first = await $.ui.mount(BAND_MOUNT)
  const firstMs = performance.now() - t0
  const firstText = walk(await first.drawn()).filter((n) => n.type === 'Text').map((n) => (n.children ?? []).join('')).join('')
  expect(firstText).toContain('ctx 83000/1000000')

  const times: number[] = []
  for (let i = 1; i <= 200; i++) {
    const t = performance.now()
    const ui = await $.ui.mount({ ...BAND_MOUNT, requestId: 'perf-' + i })
    await ui.drawn()
    times.push(performance.now() - t)
  }
  await w.clock.settle()
  const s = [...times].sort((a, b) => a - b)
  console.log('PERF first_mount_ms=' + firstMs.toFixed(2) + ' cached_median_ms=' + median(times).toFixed(3) + ' cached_p90_ms=' + (s[Math.floor(s.length * 0.9)] ?? 0).toFixed(3) + ' cached_max_ms=' + (s[s.length - 1] ?? 0).toFixed(3) + ' n=' + times.length)
})
