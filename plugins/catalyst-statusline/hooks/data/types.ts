// Contract between the core (hooks/statusline.ts) and the data families (hooks/data/<family>.ts).
// CONSTRAINT: family modules are pure — no `$`, no `on`, no I/O. They declare sources; the core
// runs them (events, host commands, file reads, session calls) and feeds the results in. The
// host resolver laws (#363) bind `$` spelling to the entry file, so `$` never crosses into a family.
// CONSTRAINT: render reads only `value()` of the last state; sources run on events and timers.

export type Unit = 'tokens' | 'usd' | 'percent' | 'ms' | 'bytes' | 'count' | 'rate' | 'text'

export type Row = {
  icon?: 'ok' | 'run' | 'fail' | 'todo' | 'info'
  label: string
  detail?: string
  right?: string
}

export type Ok = {
  state: 'ok'
  text: string
  num?: number
  unit?: Unit
  ratio?: number
  rows?: Row[]
  at: number
}

// pending = the source exists and has not answered yet (never shown as zero);
// stale = the last good value with the reason the refresh failed;
// nosource = no source on this machine or route, with the named reason.
export type Value =
  | Ok
  | { state: 'pending' }
  | { state: 'stale'; last: Ok; reason: string }
  | { state: 'nosource'; reason: string }

export type Variant = { id: string; label: string; catalogue?: string[] }

export type Option =
  | { key: string; label: string; kind: 'choice'; choices: { id: string; label: string }[]; default: string }
  | { key: string; label: string; kind: 'toggle'; default: boolean }
  | { key: string; label: string; kind: 'int'; min: number; max: number; step?: number; default: number }
  | { key: string; label: string; kind: 'text'; default: string }

export type Family =
  | 'model' | 'context' | 'tokens' | 'cost' | 'limits' | 'session' | 'agents' | 'tools'
  | 'git' | 'project' | 'files' | 'system' | 'github' | 'ci' | 'deploy' | 'workflow' | 'decor'

export type ElementDef = {
  id: string
  family: Family
  label: string
  about: string
  // text: one inline value; meter: a ratio drawn as a bar with value/percent; list: rows of its own
  kind: 'text' | 'meter' | 'list'
  // first variant is the default; a variant is a different formula or form of the same quantity
  variants: Variant[]
  options?: Option[]
  // 'C' = has a source here; 'N' = listed, unavailable, reason shown in the picker (SPEC §14.4)
  outcome: 'C' | 'N'
  reason?: string
  catalogue: string[]
  sample: string
}

// CONSTRAINT: 'info' is the core's COMPOSITE source — the host has no
// $.session.info door; the core assembles data = { cwd: string; root: string;
// id: string; turns: number; transcriptPath?: string }.
// CONSTRAINT: a turn.complete input's data is { ...the event input,
// ...the result of next(e) } — on a name conflict the result's field wins.
export type Source =
  | { kind: 'event'; event: 'session.start' | 'session.end' | 'turn.start' | 'turn.step' | 'turn.complete' | 'tool.call' | 'agent.spawn' | 'config.set' }
  | { kind: 'session'; call: 'usage' | 'messages' | 'model' | 'info' }
  | { kind: 'cmd'; argv: readonly string[]; everyMs: number; cwd?: 'project' }
  | { kind: 'file'; path: string; everyMs: number; relativeTo?: 'project' | 'home' }
  | { kind: 'transcript'; everyMs: number }
  | { kind: 'env'; names: readonly string[] }
  | { kind: 'clock'; everyMs: number }

export type Input = {
  source: Source
  ok: boolean
  data?: unknown
  error?: string
  now: number
}

export type NumberFormat = {
  tokens(n: number): string
  usd(n: number): string
  percent(ratio: number): string
  duration(ms: number): string
  bytes(n: number): string
  count(n: number): string
  rate(perSec: number, unit: string): string
}

export type FormatArgs = {
  variant: string
  options: Record<string, unknown>
  nf: NumberFormat
}

export type Collector<S = unknown> = {
  family: Family
  elements: ElementDef[]
  // a source is run only while at least one of its elements is placed in the saved layout
  sources: { source: Source; elements: string[] }[]
  // variants this family adds to an element owned by another family (base ids of hooks/data/base.ts);
  // the core routes value() for such a variant to the contributing family, never to the owner
  variantsFor?: { element: string; variants: Variant[] }[]
  init(): S
  reduce(state: S, input: Input): S
  value(state: S, elementId: string, args: FormatArgs): Value
}
