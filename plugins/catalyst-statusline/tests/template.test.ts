import { expect, test } from 'claude-code/testing'
import { parseTemplate, serializeTemplate, templateRoundTrip, sameLayout, presetLines, REGISTRY_IDS, __render, __diag } from '../hooks/statusline'
import { world, start, BAND_MOUNT, walk, rowText, SURFACES } from './world'
import type { Node } from './world'

// The teeth of SPEC §13.6 (1-9) and §14.3 (10-13, 20) for the wave A template
// engine. Two levers, both real code paths of the module:
// - the stand (__render): the same applyOptions register() runs, then the same
//   vars, lines and tree the render hooks build. CONSTRAINT: the kit loads the
//   folder plugin once with its manifest defaults, an inline test plugin has
//   neither options nor closures (the kit's Plugin type) and one registrar
//   cannot register the same event twice — so option-dependent drawing cannot
//   reach a second live mount and runs through the stand;
// - a live mount for what the folder plugin's own defaults already exercise.

const SNAP = {
  cwd: '/work/demo/src',
  repo: 'demo',
  branch: 'feature/hover',
  branchKind: 'branch',
  github: 'konsta95/demo',
  model: 'Fable 5.1',
  effort: undefined,
  context: { tokens: 83000, window: 1000000, percent: 8 },
  five: { percentUsed: 25, resetsAt: '2026-09-21T20:00:00Z' },
  seven: { percentUsed: 61.5 },
  cost: 1.2345,
  session: '4e1f0c9a-7b2d-4c58-9a36-d1e8f5b2c703',
  errors: {},
}

const render = (raw: Record<string, string>, width = 140, maxRows = 8): Node => __render(raw, SNAP, width, maxRows) as Node

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
  expect(custom).toContain('(feature/hover)')
  expect(custom).toContain('$1.2345')
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
  const noGithub = { ...SNAP, github: null }
  const out = __render({ template: 'model={model.text}||github={github.text}||cost={cost.text}', theme: 'plain' }, noGithub) as Node
  const rows = lineRows(out)
  expect(rows).toHaveLength(1)
  const t = rowText(walk(rows[0]!))
  expect(t).toContain('Fable 5.1')
  expect(t).toContain('$1.2345')
  // no doubled separator, none hanging on either edge
  expect(t.startsWith('│')).toBe(false)
  expect(t.endsWith('│')).toBe(false)
  expect(t).not.toContain('││')
})

test('13.6-3: a segment with two variables disappears whole when one is absent', () => {
  const t = text({ template: 'combo={model.raw} {model.fast}||ok={model.raw}' })
  // model.fast has no source (DATA §6): the combo segment is gone as a whole,
  // the single-variable segment survives
  expect(t).toContain('Fable 5.1')
  expect(t.match(/Fable 5\.1/g)).toHaveLength(1)
})

test('13.6-4: pending dots do not remove a segment (stale is a later tooth)', () => {
  expect(text({ template: 'route={route.label}' })).toContain('…')
})

test('13.6-5: empty settings give the working default bar', async ($, on) => {
  const stand = text({})
  for (const piece of ['(feature/hover)', 'Fable 5.1', 'ctx 83000/1000000', '5h 25%', '7d 61.5%', '$1.2345']) expect(stand).toContain(piece)
  expect(stand).toContain('4e1f0c9a')
  world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND_MOUNT, surface, requestId: surface + '-5' })
    expect(rowText(walk(await ui.drawn()))).toContain('ctx 83000/1000000')
  }
})

test('13.6-6: an unknown variable name is visible in the bar and in the diagnostics', () => {
  expect(text({ template: 'a={bogus.x}' })).toContain('{?bogus.x}')
  expect(__diag().some((d) => d.text.includes("unknown variable 'bogus.x'"))).toBe(true)
})

test('13.6-7: a broken config is replaced aloud, not silently', () => {
  const t = text({ template: ' ;; ' })
  expect(t).toContain('(feature/hover)')
  expect(__diag().some((d) => d.text.includes('template parsed to zero lines'))).toBe(true)
})

test('13.6-8: the render frame reads nothing, and no template can open an expensive source', async ($, on) => {
  // the closed dictionary: a filter is an unknown NAME in full, shown aloud —
  // there is no variable whose read would cost a subprocess or a file
  expect(text({ template: 'x={cost.usd|round:2}||y={ram.used}' })).toContain('{?cost.usd|round:2}')
  // the live hook: a draw of the band adds not one noun read
  const w = world(on)
  await start($)
  await w.clock.settle()
  const before = w.reads.length
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND_MOUNT, surface, requestId: surface + '-8' })
    expect(rowText(walk(await ui.drawn()))).toContain('Fable 5.1')
  }
  expect(w.reads.length).toBe(before)
})

test('13.6-9: values are substituted verbatim, no rounding or shortening', () => {
  const t = text({ template: 'c={cost.usd}||t={ctx.tokens}' })
  expect(t).toContain('1.2345')
  expect(t).toContain('83000')
  expect(t).not.toContain('$1.23')
  expect(t).not.toContain('83K')
})

test('14.8-10: a template with the line token gives N lines; without it exactly one', () => {
  const rows = lineRows(render({ template: 'a={git.text} ;; b={model.text} ;; c={cost.text}' }))
  expect(rows).toHaveLength(3)
  expect(rowText(walk(rows[0]!))).toContain('(feature/hover)')
  expect(rowText(walk(rows[2]!))).toContain('$1.2345')
})

test('14.8-10/0.2.0: a template without the line token reads as one line', () => {
  expect(parseTemplate('model={model.text}||ctx={ctx.text}')).toHaveLength(1)
  expect(parseTemplate('plain text segment')).toHaveLength(1)
  expect(parseTemplate('a={git.text}||b={cost.text}')[0]).toHaveLength(2)
  // the bare-id shorthand a preset serializes into parses back to the same body
  expect(parseTemplate('git-branch||model')[0]![0]).toEqual({ id: 'git-branch', body: '{git-branch.text}' })
  // an unknown bare word stays a literal body, not a variable reference
  expect(parseTemplate('hello')[0]![0]).toEqual({ id: 's1', body: 'hello' })
})

test('14.8-11: a line with no surviving segment is not drawn; no empty rows', () => {
  const noGithub = { ...SNAP, github: null }
  const rows = lineRows(__render({ template: 'gone={model.fast}||ok={model.text} ;; gone2={github.text}' }, noGithub))
  expect(rows).toHaveLength(1)
  expect(rowText(walk(rows[0]!)).trim()).not.toBe('')
})

test('14.8-12: eviction is per line — narrowing hits each line by the common order', () => {
  const out = render({ template: 'cost={cost.text}||model={model.text} ;; git={git.text}||directory={directory.text}', theme: 'plain' }, 18)
  const rows = lineRows(out)
  expect(rows).toHaveLength(2)
  const first = rowText(walk(rows[0]!))
  const second = rowText(walk(rows[1]!))
  // line 1 evicted its first-evict segment (cost) and kept the last survivor (model)
  expect(first).toContain('Fable 5.1')
  expect(first).not.toContain('$')
  // line 2 evicted directory (before git in the order) and kept git
  expect(second).toContain('(feature/hover)')
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
  for (const preset of ['default', 'ClaudeCodeStatusline', 'claude-hud']) {
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
  for (const preset of ['default', 'ClaudeCodeStatusline', 'claude-hud']) {
    for (const line of presetLines(preset)) for (const seg of line) expect(REGISTRY_IDS).toContain(seg.id)
  }
})
