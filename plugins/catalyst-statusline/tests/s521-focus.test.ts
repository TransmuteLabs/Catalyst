import { expect, test } from 'claude-code/testing'
import { world, start, command, PANE_MOUNT, SESSION_ID, draftOf } from './world'

// #521 tooth 9 / tooth 11 (host UI calls): a refused $.ui.focus of a pill
// move lands in the diagnostics. The kit answers the plugin's own focus move
// «no implementation for ui.focus» (ANALYSIS-521-qwen-flash) — the refusal
// stands up by itself. CONSTRAINT: its own file — the unguarded form fails
// the whole file with «a rejection nothing handled», which would hide the
// other #521 teeth.

const drain = async (): Promise<void> => { for (let i = 0; i < 60; i++) await Promise.resolve() }

test('#521 tooth 9 (Р9): a refused ui.focus of a move is a diagnostic, not a rejection nothing handled', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()
  await command($)
  await w.clock.settle()
  const pane = await $.ui.mount(PANE_MOUNT)
  await w.clock.settle()
  await pane.press({ key: 'seg:ctx' })
  await w.clock.settle()
  await pane.press({ key: 'mv:up' })
  await w.clock.settle()
  await drain()
  // #521 FIX2 Р13: the draft lives under its session's key
  const d = draftOf(w.persisted, SESSION_ID) as unknown as { lines: { id: string }[][] }
  expect(d.lines[0]!.map((s) => s.id)).toContain('ctx')
  await w.clock.advance(3000)
  await w.clock.settle()
  expect(w.logs.some((l) => l.includes('the focus could not follow the moved pill'))).toBe(true)
})
