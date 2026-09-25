// Family repo: git, project, files, builds, decorative clock/random quantities.
// Every formula: CATALOGUE-elements-43.md rows E004–E622 of this family, grounded
// against the reference carriers named there.
import type { Collector, ElementDef, Family, FormatArgs, Input, NumberFormat, Ok, Option, Row, Source, Value } from './types'

// One feed of one source. `last` keeps the last good value so a failure after a
// success renders stale, never as zero (types.ts: stale = last good + reason).
type Slot<T> = { ok: true; at: number; v: T } | { ok: false; at: number; err: string; last?: { at: number; v: T } }

type PorcelainEntry = { x: string; y: string; file: string }
type Porcelain = { branch?: string; upstream?: string; entries: PorcelainEntry[]; fatal?: string }
type LsReading = { names: string[]; absent: boolean }
type AssetType = 'png' | 'fbx' | 'wav'
type KitDoc = { rel: string; text: string }
type KitGoalState = { plan: string; queue: string[]; queueIndex: number }

type RepoState = {
  porcelain?: Slot<Porcelain>
  branchList?: Slot<{ name: string; current: boolean }[]>
  worktree?: Slot<{ main?: string; bare: boolean }>
  topLs?: Slot<LsReading>
  buildsLs?: Slot<LsReading>
  binariesLs?: Slot<LsReading>
  assetsLs?: Slot<LsReading>
  buildSize?: Slot<string>
  assetDu?: Slot<Record<AssetType, { count: number; kb: number }>>
  metaFiles?: Slot<{ total: number; textures: number }>
  metaEntries?: Slot<number>
  depth?: Slot<number>
  lang?: Slot<{ py: boolean; js: boolean; rs: boolean }>
  logErrors?: Slot<number>
  unityScene?: Slot<string>
  kit?: Slot<{ state?: KitGoalState; docs: KitDoc[]; heads: KitDoc[] }>
  update?: Slot<{ newer?: boolean; latest?: string }>
  neonProbe?: Slot<'connected' | 'sleeping'>
  neonDns?: Slot<boolean>
  neonRest?: Slot<string>
  files: Record<string, Slot<string>>
  env?: Slot<Record<string, string | undefined>>
  sessionInfo?: Slot<{ transcriptPath?: string }>
  clockAt?: number
}

// ---------------------------------------------------------------- sources

const GIT_STATUS: Source = { kind: 'cmd', argv: ['git', 'status', '--porcelain=v1', '-b'], everyMs: 5000, cwd: 'project' }
const GIT_BRANCHES: Source = { kind: 'cmd', argv: ['git', 'branch', '--sort=-committerdate', '--format=%(HEAD)\t%(refname:short)'], everyMs: 5000, cwd: 'project' }
const GIT_WORKTREE: Source = { kind: 'cmd', argv: ['git', 'worktree', 'list', '--porcelain'], everyMs: 10000, cwd: 'project' }
const LS_TOP: Source = { kind: 'cmd', argv: ['ls', '-A'], everyMs: 30000, cwd: 'project' }
const LS_BUILDS: Source = { kind: 'cmd', argv: ['ls', '-A', 'Builds'], everyMs: 30000, cwd: 'project' }
const LS_BINARIES: Source = { kind: 'cmd', argv: ['ls', '-A', 'Binaries'], everyMs: 30000, cwd: 'project' }
const LS_ASSETS: Source = { kind: 'cmd', argv: ['ls', '-A', 'Assets'], everyMs: 30000, cwd: 'project' }
const DU_BUILDS: Source = { kind: 'cmd', argv: ['du', '-sh', 'Builds', 'Build', 'build'], everyMs: 60000, cwd: 'project' }
// Per-type counts and byte sums in one pass: du -k prints one line per file, so
// the line count is the count and the K column sum is the size (E083–E088).
const ASSET_DU: Source = { kind: 'cmd', argv: ['sh', '-c', 'r=Assets; [ -d Assets ] || r=.; for t in png fbx wav; do echo "@@$t"; find "$r" -type f -name "*.$t" -exec du -k {} + 2>/dev/null; done'], everyMs: 60000, cwd: 'project' }
const META_FILES: Source = { kind: 'cmd', argv: ['find', 'Assets', '-type', 'f', '!', '-name', '*.meta'], everyMs: 60000, cwd: 'project' }
const META_ENTRIES: Source = { kind: 'cmd', argv: ['find', 'Assets', '-mindepth', '1', '!', '-name', '*.meta'], everyMs: 60000, cwd: 'project' }
const DEPTH_FIND: Source = { kind: 'cmd', argv: ['find', '.', '-name', '*.py', '-o', '-name', '*.js', '-o', '-name', '*.rs'], everyMs: 30000, cwd: 'project' }
const LANG_FIND: Source = { kind: 'cmd', argv: ['sh', '-c', 'for e in py js rs; do find . -maxdepth 1 -name "*.$e" -print -quit; done'], everyMs: 30000, cwd: 'project' }
// grep exits 1 on zero matches; that is a measured zero, not a source failure (E052).
const LOG_ERRORS: Source = { kind: 'cmd', argv: ['grep', '-r', '-i', '--include', '*.log', 'error', '.'], everyMs: 60000, cwd: 'project' }
const UNITY_SCENE: Source = { kind: 'cmd', argv: ['find', 'Assets', '-name', '*.unity', '-print', '-quit'], everyMs: 60000, cwd: 'project' }
// The kit state names its plan docs by relative path, so one read walks the
// state file plus the docs themselves; nothing here writes (E096–E100).
const KIT_READ: Source = { kind: 'cmd', argv: ['sh', '-c', 'echo "@@goal-state@@"; cat .kit/goal-state.json 2>/dev/null; echo; for f in docs/plans/*.md; do [ -f "$f" ] || continue; echo "@@doc:$f@@"; head -c 1048576 "$f" 2>/dev/null; echo; done; for f in docs/archive/*.md; do [ -f "$f" ] || continue; echo "@@head:$f@@"; head -c 2048 "$f" 2>/dev/null; echo; done'], everyMs: 30000, cwd: 'project' }
// The cache the product's own updater writes; reading never launches a check (E115).
const UPDATE_READ: Source = { kind: 'cmd', argv: ['sh', '-c', 'cat "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/update-check.json" 2>/dev/null'], everyMs: 60000, cwd: 'project' }
// Keys load from the carrier .env inside the shell: a key value never enters
// argv, stdout or state (SPEC §14.4 E622; DESIGN Р3).
const NEON_PROBE: Source = { kind: 'cmd', argv: ['sh', '-c', 'set -a; [ -f .env ] && . ./.env; set +a; [ -n "$NEON_ENDPOINT" ] && nc -z -w 3 "$NEON_ENDPOINT" 5432 >/dev/null 2>&1 && echo connected || echo sleeping'], everyMs: 60000, cwd: 'project' }
const NEON_DNS: Source = { kind: 'cmd', argv: ['sh', '-c', 'set -a; [ -f .env ] && . ./.env; set +a; [ -n "$NEON_ENDPOINT" ] && nslookup "$NEON_ENDPOINT" >/dev/null 2>&1 && echo dns-ok || echo dns-fail'], everyMs: 60000, cwd: 'project' }
const NEON_REST: Source = { kind: 'cmd', argv: ['sh', '-c', 'set -a; [ -f .env ] && . ./.env; set +a; k="${NEON_API_KEY:-}"; p="${NEON_PROJECT_ID:-}"; [ -n "$k" ] && [ -n "$p" ] && curl -sS -m 5 -H "Authorization: Bearer $k" "https://console.neon.tech/api/v2/consumption_history/projects/$p?limit=1"'], everyMs: 60000, cwd: 'project' }
const F_PACKAGE: Source = { kind: 'file', path: 'package.json', everyMs: 30000, relativeTo: 'project' }
const F_PV: Source = { kind: 'file', path: 'ProjectSettings/ProjectVersion.txt', everyMs: 60000, relativeTo: 'project' }
const F_EBS: Source = { kind: 'file', path: 'ProjectSettings/EditorBuildSettings.asset', everyMs: 60000, relativeTo: 'project' }
const F_PKGS: Source = { kind: 'file', path: 'Packages/manifest.json', everyMs: 60000, relativeTo: 'project' }
const F_DOTENV: Source = { kind: 'file', path: '.env', everyMs: 30000, relativeTo: 'project' }
const ENV_SRC: Source = { kind: 'env', names: ['CLAUDE_INSTANCE_N', 'CLAUDE_CONFIG_DIR', 'PWD', 'KITTY_WINDOW_ID', 'ITERM_SESSION_ID', 'TERM_PROGRAM', 'DEADLINE_TIME', 'NEON_DATABASE', 'NEON_ENDPOINT', 'NEON_API_KEY', 'NEON_PROJECT_ID'] }
const SESSION_INFO: Source = { kind: 'session', call: 'info' }
const CLOCK: Source = { kind: 'clock', everyMs: 10000 }

// ---------------------------------------------------------------- slot helpers

// Feeds are matched by structural key, never by object identity: the core and
// the tests hand in their own copies of a declared source.
function sourceKey(s: Source): string {
  switch (s.kind) {
    case 'cmd': return 'cmd:' + s.argv.join('\u0000')
    case 'file': return 'file:' + s.path
    case 'env': return 'env:' + s.names.join(',')
    case 'session': return 'session:' + s.call
    case 'clock': return 'clock:' + s.everyMs
    case 'event': return 'event:' + s.event
    case 'transcript': return 'transcript'
  }
}

const K = {
  gitStatus: sourceKey(GIT_STATUS),
  gitBranches: sourceKey(GIT_BRANCHES),
  gitWorktree: sourceKey(GIT_WORKTREE),
  lsTop: sourceKey(LS_TOP),
  lsBuilds: sourceKey(LS_BUILDS),
  lsBinaries: sourceKey(LS_BINARIES),
  lsAssets: sourceKey(LS_ASSETS),
  duBuilds: sourceKey(DU_BUILDS),
  assetDu: sourceKey(ASSET_DU),
  metaFiles: sourceKey(META_FILES),
  metaEntries: sourceKey(META_ENTRIES),
  depth: sourceKey(DEPTH_FIND),
  lang: sourceKey(LANG_FIND),
  logErrors: sourceKey(LOG_ERRORS),
  unityScene: sourceKey(UNITY_SCENE),
  kit: sourceKey(KIT_READ),
  update: sourceKey(UPDATE_READ),
  neonProbe: sourceKey(NEON_PROBE),
  neonDns: sourceKey(NEON_DNS),
  neonRest: sourceKey(NEON_REST),
}

// declared sources, exported for the core's dedupe and for tests that feed them
export const SOURCES = {
  GIT_STATUS, GIT_BRANCHES, GIT_WORKTREE, LS_TOP, LS_BUILDS, LS_BINARIES, LS_ASSETS, DU_BUILDS, ASSET_DU,
  META_FILES, META_ENTRIES, DEPTH_FIND, LANG_FIND, LOG_ERRORS, UNITY_SCENE, KIT_READ, UPDATE_READ,
  NEON_PROBE, NEON_DNS, NEON_REST, F_PACKAGE, F_PV, F_EBS, F_PKGS, F_DOTENV, ENV_SRC, SESSION_INFO, CLOCK,
} as const

function slot<T>(prev: Slot<T> | undefined, input: Input, v: T): Slot<T> {
  if (input.ok) return { ok: true, at: input.now, v }
  const err = input.error ?? 'source failed'
  return { ok: false, at: input.now, err, last: prev && prev.ok ? { at: prev.at, v: prev.v } : prev && !prev.ok ? prev.last : undefined }
}

function cmdOut(input: Input): { code?: number; stdout: string; stderr: string } | undefined {
  if (typeof input.data !== 'object' || input.data === null) return undefined
  const d = input.data as { code?: unknown; stdout?: unknown; stderr?: unknown }
  return { code: typeof d.code === 'number' ? d.code : undefined, stdout: typeof d.stdout === 'string' ? d.stdout : '', stderr: typeof d.stderr === 'string' ? d.stderr : '' }
}

function lines(s: string): string[] {
  return s.replace(/\r/g, '').split('\n').filter((l) => l.length > 0)
}

// ---------------------------------------------------------------- parsing (grounded on the reference carriers)

function parsePorcelain(out: string): Porcelain {
  const ls = out.replace(/\r/g, '').split('\n')
  const res: Porcelain = { entries: [] }
  if (ls.length === 0 || !ls[0]!.startsWith('##')) { res.fatal = 'unexpected git status output (missing branch header)'; return res }
  const header = ls[0]!.slice(2).trim()
  const headPart = header.replace(/\s*\[.+\]$/, '').trim()
  const dots = headPart.indexOf('...')
  if (dots !== -1) { res.branch = headPart.slice(0, dots); res.upstream = headPart.slice(dots + 3) } else { res.branch = headPart }
  if (res.branch === 'HEAD (no branch)') res.branch = '(detached)'
  for (const line of ls.slice(1)) {
    if (line.trim().length === 0) continue
    res.entries.push({ x: line[0] ?? ' ', y: line[1] ?? ' ', file: line.slice(3) })
  }
  return res
}

function parseBranchList(out: string): { name: string; current: boolean }[] {
  const res: { name: string; current: boolean }[] = []
  for (const line of lines(out)) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const name = line.slice(tab + 1).trim()
    if (name) res.push({ name, current: line.slice(0, tab).trim() === '*' })
  }
  return res
}

function parseWorktree(out: string): { main?: string; bare: boolean } {
  const first = out.split('\n\n', 1)[0] ?? ''
  const ls = first.split('\n')
  if (ls.length === 0 || !ls[0]!.startsWith('worktree ')) return { bare: false }
  if (ls.some((l) => l.trim() === 'bare')) return { bare: true }
  return { main: ls[0]!.slice('worktree '.length).trim() || undefined, bare: false }
}

function parseAssetDu(out: string): Record<AssetType, { count: number; kb: number }> {
  const res: Record<AssetType, { count: number; kb: number }> = { png: { count: 0, kb: 0 }, fbx: { count: 0, kb: 0 }, wav: { count: 0, kb: 0 } }
  let cur: AssetType | undefined
  for (const line of lines(out)) {
    if (line.startsWith('@@')) { const t = line.slice(2); cur = t === 'png' || t === 'fbx' || t === 'wav' ? t : undefined; continue }
    if (!cur) continue
    const tab = line.indexOf('\t')
    const kb = tab === -1 ? Number(line) || 0 : Number(line.slice(0, tab)) || 0
    res[cur].count += 1
    res[cur].kb += kb
  }
  return res
}

// Port of kit-goal-statusline.js parsePlan/indexSections/sectionProgress (E097, E098).
function parsePlan(doc: string): { sections: { num: string; title: string }[]; chapters: { completed: string | null; next: string | null }[] } {
  const sections: { num: string; title: string }[] = []
  const chapters: { completed: string | null; next: string | null }[] = []
  let block: 'sections' | 'chapters' | null = null
  let chapter: { completed: string | null; next: string | null } | null = null
  for (const line of doc.replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^##\s/.test(line)) {
      const heading = line.replace(/^##\s+/, '').trim()
      block = heading === 'Sections of Work' ? 'sections' : heading === 'Chapters' ? 'chapters' : null
      chapter = null
      continue
    }
    if (block === 'sections') {
      const m = /^###\s+(\d+)\.\s+(.*)$/.exec(line)
      if (m) { const title = m[2]!.trim(); if (title) sections.push({ num: m[1]!, title }) }
    } else if (block === 'chapters') {
      if (/^###\s+Chapter\s+\d+/.test(line)) { chapter = { completed: null, next: null }; chapters.push(chapter); continue }
      if (!chapter) continue
      const c = /^Completed:\s*(.*)$/.exec(line)
      if (c && chapter.completed === null) chapter.completed = c[1]!.trim()
      const n = /^Next:\s*(.*)$/.exec(line)
      if (n && chapter.next === null) chapter.next = n[1]!.trim()
    }
  }
  return { sections, chapters }
}

function pointerFrom(next: string): string {
  if (/^finishing/i.test(next)) return 'finishing'
  const m = /^(?:sections?\s*|§)?(\d{1,4})(?!\d)/i.exec(next)
  return m ? '§' + m[1] : ''
}

function sectionProgress(doc: string): { done: number; total: number; pointer: string } | null {
  const { sections, chapters } = parsePlan(doc)
  if (sections.length === 0) return null
  const byTitle = new Map<string, string[]>()
  const byNum = new Set<string>()
  for (const s of sections) {
    const nums = byTitle.get(s.title)
    if (nums) nums.push(s.num); else byTitle.set(s.title, [s.num])
    byNum.add(s.num)
  }
  const done = new Set<string>()
  for (const ch of chapters) {
    if (!ch.completed) continue
    const titled = byTitle.get(ch.completed)
    if (titled) { for (const num of titled) done.add(num); byTitle.delete(ch.completed) }
    const numbered = /^(\d+)[. ]/.exec(ch.completed)
    if (numbered && byNum.has(numbered[1]!)) done.add(numbered[1]!)
  }
  let pointer = ''
  if (chapters.length === 0) pointer = '§' + sections[0]!.num
  else { const last = chapters[chapters.length - 1]!; if (last.next) pointer = pointerFrom(last.next) }
  return { done: done.size, total: sections.length, pointer }
}

// Front-matter `status: complete` above the first `##` heading — exactly the
// kit leash's terminal marker (kit-goal-lib.js planReadsTerminal).
function planTerminal(doc: string): boolean {
  const heading = /^##/m.exec(doc)
  const front = heading ? doc.slice(0, heading.index) : doc
  const row = /^status:([^\r\n]*)\r?\n/im.exec(front)
  return row !== null && row[1]!.trim().toLowerCase() === 'complete'
}

function normalizeGoalState(raw: string | undefined): KitGoalState | 'absent' | 'malformed' {
  if (raw === undefined || raw.trim() === '') return 'absent'
  try {
    const st = JSON.parse(raw) as { plan?: unknown; queue?: unknown; queueIndex?: unknown }
    if (typeof st.plan !== 'string' || st.plan === '') return 'malformed'
    const plan = st.plan
    const queue = Array.isArray(st.queue) && st.queue.length > 0 && st.queue.every((p) => typeof p === 'string') ? st.queue as string[] : [plan]
    let qi = typeof st.queueIndex === 'number' && Number.isInteger(st.queueIndex) && st.queueIndex >= 0 && st.queueIndex < queue.length ? st.queueIndex : 0
    if (queue[qi] !== plan) { queue.length = 0; queue.push(plan); qi = 0 }
    return { plan, queue, queueIndex: qi }
  } catch { return 'malformed' }
}

type KitWalk = { index: number; stored: number; healed: number; positional: boolean; unresolvable: boolean; cause: string | null; finished: boolean }

// Forward-only walk over the queue's own docs (kit-goal-lib.js queuePosition,
// scan bound 16): an unresolvable entry stops the walk and keeps its position.
function kitWalk(state: KitGoalState, docs: Map<string, string>, heads: Map<string, string>): KitWalk {
  const stored = state.queueIndex
  let index = stored
  const last = state.queue.length - 1
  const entryState = (rel: string): 'complete' | 'pending' | 'unresolvable' => {
    const doc = docs.get(rel) ?? heads.get(rel)
    if (doc !== undefined) return planTerminal(doc) ? 'complete' : 'pending'
    if (rel.startsWith('docs/plans/')) {
      const head = heads.get('docs/archive/' + rel.slice('docs/plans/'.length))
      if (head !== undefined) return planTerminal(head) ? 'complete' : 'pending'
    }
    return 'unresolvable'
  }
  let entry: 'complete' | 'pending' | 'unresolvable' = 'pending'
  for (let scanned = 0; scanned < 16; scanned++) {
    entry = entryState(state.queue[index]!)
    if (entry !== 'complete' || index === last) break
    index++
  }
  return { index, stored, healed: index - stored, positional: state.queue.length > 1, unresolvable: entry === 'unresolvable', cause: entry === 'unresolvable' ? 'unreadable-path' : null, finished: entry === 'complete' }
}

// ---------------------------------------------------------------- elements

function choice(key: string, label: string, options: { id: string; label: string }[], def: string): Option {
  return { kind: 'choice', key, label, choices: options, default: def }
}

const N_REASONS = {
  e004: 'payload total_lines_* не измерен в mod-API; не заменять git numstat',
  neonRest: 'Neon REST/сетевая проба не имеют объявленного источника у нашего мода',
  neonHistory: 'consumption_history Neon отсутствует среди объявленных источников мода',
  cloudflare: 'Cloudflare deployments REST не имеет объявленного адаптера в моде',
} as const

function nEl(id: string, family: Family, label: string, about: string, reason: string, catalogue: string[]): ElementDef {
  return { id, family, label, about, kind: 'text', variants: [{ id: 'na', label: 'n/a' }], outcome: 'N', reason, catalogue, sample: '—' }
}

function one(id: string, family: Family, label: string, about: string, catalogue: string[], sample: string, extra?: Partial<ElementDef>): ElementDef {
  return { id, family, label, about, kind: 'text', variants: [{ id: 'std', label: 'std' }], outcome: 'C', catalogue, sample, ...extra }
}

const ELEMENTS: ElementDef[] = [
  // git
  one('r-flow-target', 'git', 'flow target', 'the branch a git-flow prefix merges into', ['E079'], '→ develop'),
  { id: 'r-dirty-counts', family: 'git', label: 'dirty counts', about: 'porcelain entries counted per category, non-zero only', kind: 'text', variants: [{ id: 'glyph', label: '● ✚ ✖', catalogue: ['E080', 'E081', 'E082'] }, { id: 'letters', label: 'S/U/A' }], outcome: 'C', catalogue: [], sample: '●2 ✚1 ✖1' },
  { id: 'r-paths', family: 'git', label: 'changed paths', about: 'staged, unstaged and untracked paths from porcelain with a +N more overflow', kind: 'list', variants: [{ id: 'all', label: 'all' }], options: [choice('scope', 'scope', [{ id: 'all', label: 'all' }, { id: 'staged', label: 'staged' }, { id: 'unstaged', label: 'unstaged' }, { id: 'untracked', label: 'untracked' }], 'all'), { kind: 'int', key: 'max', label: 'max rows', min: 1, max: 64, default: 8 }], outcome: 'C', catalogue: ['E583', 'E584', 'E585', 'E592'], sample: 'src/a.ts (staged)' },
  { id: 'r-change-count', family: 'git', label: 'change count', about: 'changed entries summed from the porcelain arrays', kind: 'text', variants: [{ id: 'with-untracked', label: 'with untracked', catalogue: ['E586'] }, { id: 'tracked-only', label: 'tracked only', catalogue: ['E590'] }], outcome: 'C', catalogue: [], sample: '6' },
  { id: 'r-branches', family: 'git', label: 'branches', about: 'local branches by last commit date, the current one marked, with a +N more overflow', kind: 'list', variants: [{ id: 'std', label: 'std' }], options: [{ kind: 'int', key: 'max', label: 'max rows', min: 1, max: 200, default: 60 }], outcome: 'C', catalogue: ['E581', 'E582', 'E591'], sample: '● main (current)' },
  one('r-tracked-dirty', 'git', 'tracked dirty', 'one * flag when any tracked entry is dirty; untracked alone does not raise it', ['E614'], '*'),
  one('r-hp', 'decor', 'HP', 'RPG health: 10 minus the porcelain line count', ['E033'], 'HP:7/10'),
  nEl('r-net-lines', 'git', 'net lines', 'session net lines added minus removed', N_REASONS.e004, ['E004']),
  // project
  one('r-engine', 'project', 'engine', 'game engine detected from the project layout', ['E046'], '🎲Unity'),
  one('r-worktree-main', 'project', 'main worktree', 'basename of the first worktree entry, not the common dir', ['E616'], 'Catalyst'),
  one('r-instance', 'system', 'instance', 'parallel instance number from the explicit env override or the config-dir map', ['E095'], '①'),
  one('r-pane', 'system', 'pane', 'terminal pane id from kitty, else the iTerm session id after its last colon', ['E093'], '#12'),
  one('r-dbname', 'project', 'db name', 'the Neon database name in full; cutting it to 6 chars is a view form', ['E619'], 'neon-db-123456'),
  one('r-pool', 'project', 'pool', 'connection pool state derived from the port probe and DNS', ['E620'], 'pool:✓'),
  one('r-write-mb', 'project', 'write activity', 'MB written to the database in the last consumption period, idle at zero', ['E622'], '2MB↑'),
  one('r-mana', 'decor', 'mana', 'blue when a package.json sits in the project root, white otherwise', ['E034'], '🔵'),
  one('r-update', 'project', 'update', 'the newer product tag from the local update-check cache; no check is ever started', ['E115'], '⬆ v2.2.0'),
  one('r-unity-scene', 'project', 'unity scene', 'the first scene found under Assets, not the active one', ['E066'], 'Level_01'),
  one('r-unity-version', 'project', 'unity version', 'the editor version from ProjectVersion.txt cut the way the dashboard reads it', ['E067'], '2022.3'),
  one('r-unity-platform', 'project', 'build target', 'the build platform read as a string search in EditorBuildSettings.asset', ['E068'], '📱iOS'),
  one('r-unity-pkgs', 'project', 'unity packages', 'presence of the Unity package manifest', ['E070'], '📋Pkgs'),
  { id: 'r-asset-bucket', family: 'files', label: 'asset bucket', about: 'the Assets file count bucketed by thresholds', kind: 'text', variants: [{ id: 'perf', label: '2000/1000', catalogue: ['E047'] }, { id: 'dash', label: '1000/500', catalogue: ['E069'] }], outcome: 'C', catalogue: [], sample: '🟢Low' },
  one('r-tex-bucket', 'files', 'texture bucket', 'the texture file count bucketed at 500/200', ['E048'], '🟢Mem'),
  // ci / builds
  one('r-build-size', 'ci', 'build size', 'the first build directory size from du, NoBuild when none exists', ['E049'], '📦 12 MB'),
  one('r-fps', 'decor', 'fps target', 'the named 60 fps constant, not a measured frame rate', ['E050'], '⚡60fps'),
  { id: 'r-platforms', family: 'ci', label: 'platforms', about: 'per-platform build directory presence for Builds and Binaries', kind: 'list', variants: [{ id: 'std', label: 'std' }], outcome: 'C', catalogue: ['E051'], sample: '📱 iOS ✓' },
  one('r-store', 'ci', 'store ready', 'log-file error count bucketed, gated on at least one platform built', ['E052'], '🎮Ready'),
  one('r-build-status', 'ci', 'build status', 'build entries counted per engine, Pending when the directory is absent', ['E621'], '📦3'),
  // files
  { id: 'r-assets', family: 'files', label: 'assets', about: 'png, fbx and wav counts with their byte sums in MB', kind: 'list', variants: [{ id: 'std', label: 'std' }], outcome: 'C', catalogue: ['E083', 'E084', 'E085', 'E086', 'E087', 'E088'], sample: '🖼 12 (3 MB)' },
  one('r-asset-load', 'files', 'asset load', 'png byte total bucketed at 500/100 MB', ['E089'], '🟢Light'),
  one('r-compression', 'files', 'compression', 'Stream when a StreamingAssets directory exists, Auto otherwise', ['E617'], '📦Auto'),
  one('r-pipeline-health', 'files', 'pipeline', 'png+fbx+wav counts summed and bucketed at 1000/2000', ['E618'], '✅Optimal'),
  one('r-depth', 'files', 'depth', 'py/js/rs file count times ten, in meters', ['E011'], 'Depth: 120m'),
  one('r-lang', 'files', 'language', 'the project language glyph by which source files sit at the root', ['E009'], '🦀'),
  // decor
  one('r-daypart', 'decor', 'day part', 'morning, afternoon or evening by the local hour at 12 and 18', ['E005'], '🌤️ Afternoon'),
  one('r-streak', 'decor', 'streak', 'the local day of year modulo 100', ['E006'], '⚡Streak: 67'),
  one('r-cycle', 'decor', 'cycle', 'a color emoji cycling with the clock second', ['E007'], '🟢'),
  one('r-mood', 'decor', 'mood', 'a decorative mood emoji re-rolled from the feed clock, never per render', ['E008'], '🤔'),
  one('r-energy', 'decor', 'energy', 'a decorative 1–100 percent re-rolled from the feed clock', ['E010'], '⚡42%'),
  one('r-creature', 'decor', 'creature', 'a sea creature by code depth thresholds, with a 5% treasure roll', ['E012', 'E013'], '🐋'),
  one('r-deadline', 'decor', 'deadline', 'countdown to DEADLINE_TIME today, OVERTIME past it', ['E045'], '1h 30m'),
  one('r-ui-kinds', 'system', 'ui kinds', 'distinct component kinds the host asked this mod to render', ['E613'], '7 kinds'),
  // workflow (kit)
  one('r-kit-goal', 'workflow', 'armed plan', 'the armed plan name from .kit/goal-state.json', ['E096'], '🎯 ship-v2'),
  one('r-plan-sections', 'workflow', 'sections', 'plan sections done of total by the Completed lines of the chapters', ['E097'], 'Sections: 1/2'),
  one('r-plan-next', 'workflow', 'next', 'the last chapter first Next line as a section pointer', ['E098'], '(Next §2)'),
  one('r-plan-queue', 'workflow', 'plans', 'queue position derived from the plan docs, stored index beside it when healed', ['E099'], 'Plans: 1/2'),
  one('r-plan-unarmed', 'workflow', 'unarmed', 'the nothing-armed state of the goal file', ['E100'], '🎯 unarmed'),
  // N: Neon REST (E053–E060)
  nEl('r-neon-project', 'project', 'neon project', 'the Neon project name over REST', N_REASONS.neonRest, ['E053']),
  nEl('r-neon-branch', 'project', 'neon branch', 'the Neon branch name over REST', N_REASONS.neonRest, ['E054']),
  nEl('r-neon-state', 'project', 'neon state', 'the Neon compute state over REST', N_REASONS.neonRest, ['E055']),
  nEl('r-neon-cu', 'project', 'neon CU', 'the Neon compute units over REST', N_REASONS.neonRest, ['E056']),
  nEl('r-neon-connect', 'project', 'neon connect', 'the Neon port probe result', N_REASONS.neonRest, ['E057']),
  nEl('r-neon-dns', 'project', 'neon dns', 'the Neon endpoint DNS resolution', N_REASONS.neonRest, ['E058']),
  nEl('r-neon-latency', 'project', 'neon latency', 'the Neon probe response time quantized to 1000', N_REASONS.neonRest, ['E059']),
  nEl('r-neon-hours', 'project', 'neon hours', 'Neon active hours from the consumption REST', N_REASONS.neonRest, ['E060']),
  // N: Neon consumption_history (E062–E065)
  nEl('r-neon-storage', 'project', 'neon storage', 'Neon storage bytes from consumption_history', N_REASONS.neonHistory, ['E062']),
  nEl('r-neon-compute', 'project', 'neon compute', 'Neon compute time from consumption_history', N_REASONS.neonHistory, ['E063']),
  nEl('r-neon-cost', 'cost', 'neon cost', 'Neon estimated cost active_h×0.25 + MB×0.0001', N_REASONS.neonHistory, ['E064']),
  nEl('r-neon-plan', 'cost', 'neon plan', 'Neon free/paid classification', N_REASONS.neonHistory, ['E065']),
  // N: Cloudflare (E090–E092)
  nEl('r-cf-state', 'deploy', 'cf state', 'the Cloudflare deployment state over REST', N_REASONS.cloudflare, ['E090']),
  nEl('r-cf-url', 'deploy', 'cf url', 'the Cloudflare deployment URL', N_REASONS.cloudflare, ['E091']),
  nEl('r-cf-age', 'deploy', 'cf age', 'the Cloudflare deployment age', N_REASONS.cloudflare, ['E092']),
]

// ---------------------------------------------------------------- collector

const collector: Collector<RepoState> = {
  family: 'git',
  elements: ELEMENTS,
  variantsFor: [
    {
      element: 'branch',
      variants: [
        { id: 'r-flow', label: 'git-flow', catalogue: ['E078'] },
        { id: 'r-upstream', label: 'upstream', catalogue: ['E580'] },
      ],
    },
    {
      element: 'directory',
      variants: [{ id: 'r-dir-env', label: 'env class', catalogue: ['E061'] }],
    },
  ],
  sources: [
    { source: GIT_STATUS, elements: ['r-flow-target', 'r-dirty-counts', 'r-paths', 'r-change-count', 'r-tracked-dirty', 'r-hp', 'branch'] },
    { source: GIT_BRANCHES, elements: ['r-branches'] },
    { source: GIT_WORKTREE, elements: ['r-worktree-main'] },
    { source: LS_TOP, elements: ['r-engine', 'r-build-status'] },
    { source: LS_BUILDS, elements: ['r-build-status', 'r-platforms', 'r-store'] },
    { source: LS_BINARIES, elements: ['r-build-status', 'r-platforms', 'r-store'] },
    { source: LS_ASSETS, elements: ['r-compression'] },
    { source: DU_BUILDS, elements: ['r-build-size'] },
    { source: ASSET_DU, elements: ['r-assets', 'r-asset-load', 'r-pipeline-health'] },
    { source: META_FILES, elements: ['r-asset-bucket', 'r-tex-bucket'] },
    { source: META_ENTRIES, elements: ['r-asset-bucket'] },
    { source: DEPTH_FIND, elements: ['r-depth', 'r-creature'] },
    { source: LANG_FIND, elements: ['r-lang'] },
    { source: LOG_ERRORS, elements: ['r-store'] },
    { source: UNITY_SCENE, elements: ['r-unity-scene'] },
    { source: KIT_READ, elements: ['r-kit-goal', 'r-plan-sections', 'r-plan-next', 'r-plan-queue', 'r-plan-unarmed'] },
    { source: UPDATE_READ, elements: ['r-update'] },
    { source: NEON_PROBE, elements: ['r-pool'] },
    { source: NEON_DNS, elements: ['r-pool'] },
    { source: NEON_REST, elements: ['r-write-mb'] },
    { source: F_PACKAGE, elements: ['r-mana'] },
    { source: F_PV, elements: ['r-unity-version'] },
    { source: F_EBS, elements: ['r-unity-platform'] },
    { source: F_PKGS, elements: ['r-unity-pkgs'] },
    { source: F_DOTENV, elements: ['r-dbname', 'r-pool', 'r-write-mb'] },
    { source: ENV_SRC, elements: ['r-instance', 'r-pane', 'r-deadline', 'r-dbname', 'r-pool', 'r-write-mb', 'directory'] },
    { source: SESSION_INFO, elements: ['r-instance'] },
    { source: CLOCK, elements: ['r-daypart', 'r-streak', 'r-cycle', 'r-mood', 'r-energy', 'r-deadline'] },
  ],
  init(): RepoState {
    return { files: {} }
  },
  reduce(state: RepoState, input: Input): RepoState {
    const s: RepoState = { ...state, files: { ...state.files } }
    const src = input.source
    if (src.kind === 'clock') { s.clockAt = input.now; return s }
    if (src.kind === 'env') {
      const v = input.ok && typeof input.data === 'object' && input.data !== null ? input.data as Record<string, string | undefined> : {}
      s.env = slot(s.env, input, v)
      return s
    }
    if (src.kind === 'session') {
      const d = input.ok && typeof input.data === 'object' && input.data !== null ? input.data as { transcript_path?: unknown } : {}
      s.sessionInfo = slot(s.sessionInfo, input, { transcriptPath: typeof d.transcript_path === 'string' ? d.transcript_path : undefined })
      return s
    }
    if (src.kind === 'file') {
      s.files[src.path] = slot(s.files[src.path], input, typeof input.data === 'string' ? input.data : '')
      return s
    }
    // cmd sources
    const out = cmdOut(input)
    const raw = out?.stdout ?? ''
    const stderr = out?.stderr ?? ''
    // an absent directory is a reading, not a failure (E051/E621 Pending path)
    const lsSlot = (prev: Slot<LsReading> | undefined): Slot<LsReading> => {
      const absent = !input.ok && /No such file or directory/.test(stderr)
      return slot(prev, absent ? { ...input, ok: true } : input, { names: lines(raw), absent })
    }
    // outside a repository the git commands answer a named route, not pending
    const noRepo = /not a git repository/i.test(stderr)
    const gitSlot = <T>(prev: Slot<T> | undefined, v: T): Slot<T> => slot(prev, noRepo ? { ...input, ok: true } : input, v)
    switch (sourceKey(src)) {
      case K.gitStatus: {
        const p = parsePorcelain(raw)
        if (noRepo) p.fatal = 'не git-репозиторий'
        return { ...s, porcelain: gitSlot(s.porcelain, p) }
      }
      case K.gitBranches: return { ...s, branchList: gitSlot(s.branchList, parseBranchList(raw)) }
      case K.gitWorktree: return { ...s, worktree: gitSlot(s.worktree, parseWorktree(raw)) }
      case K.lsTop: return { ...s, topLs: lsSlot(s.topLs) }
      case K.lsBuilds: return { ...s, buildsLs: lsSlot(s.buildsLs) }
      case K.lsBinaries: return { ...s, binariesLs: lsSlot(s.binariesLs) }
      case K.lsAssets: return { ...s, assetsLs: lsSlot(s.assetsLs) }
      case K.duBuilds: {
        const duAbsent = !input.ok && /No such file or directory/.test(stderr)
        return { ...s, buildSize: slot(s.buildSize, duAbsent ? { ...input, ok: true } : input, lines(raw)[0]?.split('\t')[0]?.trim() ?? '') }
      }
      case K.assetDu: return { ...s, assetDu: slot(s.assetDu, input, parseAssetDu(raw)) }
      case K.metaFiles: {
        const ls = lines(raw)
        const textures = ls.filter((l) => /\.(png|jpg|tga)$/.test(l)).length
        return { ...s, metaFiles: slot(s.metaFiles, input, { total: ls.length, textures }) }
      }
      case K.metaEntries: return { ...s, metaEntries: slot(s.metaEntries, input, lines(raw).length) }
      case K.depth: return { ...s, depth: slot(s.depth, input, lines(raw).length) }
      case K.lang: {
        const ls = lines(raw)
        return { ...s, lang: slot(s.lang, input, { py: ls.some((l) => l.endsWith('.py')), js: ls.some((l) => l.endsWith('.js')), rs: ls.some((l) => l.endsWith('.rs')) }) }
      }
      case K.logErrors: {
        // exit 1 = zero matching lines is a measured zero, not a failure
        const n = out && out.code === 1 ? 0 : lines(raw).length
        const realFail = input.ok === false && out?.code !== 1
        return { ...s, logErrors: slot(s.logErrors, { ...input, ok: !realFail }, n) }
      }
      case K.unityScene: {
        const first = lines(raw)[0]
        const base = first !== undefined ? first.split('/').pop()! : undefined
        return { ...s, unityScene: slot(s.unityScene, input, base !== undefined ? base.replace(/\.unity$/, '') : 'None') }
      }
      case K.kit: return { ...s, kit: slot(s.kit, input, parseKit(raw)) }
      case K.update: return { ...s, update: slot(s.update, input, parseUpdate(raw)) }
      case K.neonProbe: return { ...s, neonProbe: slot(s.neonProbe, input, raw.includes('connected') ? 'connected' : 'sleeping') }
      case K.neonDns: return { ...s, neonDns: slot(s.neonDns, input, raw.includes('dns-ok')) }
      case K.neonRest: return { ...s, neonRest: slot(s.neonRest, input, raw) }
      default: return s
    }
  },
  value(state: RepoState, elementId: string, args: FormatArgs): Value {
    return valueOf(state, elementId, args)
  },
}

function parseKit(raw: string): { state?: KitGoalState; docs: KitDoc[]; heads: KitDoc[] } {
  const docs: KitDoc[] = []
  const heads: KitDoc[] = []
  let stateRaw: string | undefined
  let mode: 'state' | 'doc' | 'head' | 'none' = 'none'
  for (const line of raw.split('\n')) {
    if (line === '@@goal-state@@') { mode = 'state'; continue }
    if (line.startsWith('@@doc:')) { mode = 'doc'; docs.push({ rel: line.slice(6).replace(/@@$/, ''), text: '' }); continue }
    if (line.startsWith('@@head:')) { mode = 'head'; heads.push({ rel: line.slice(7).replace(/@@$/, ''), text: '' }); continue }
    if (mode === 'state') stateRaw = (stateRaw ?? '') + line + '\n'
    else if (mode === 'doc') docs[docs.length - 1]!.text += line + '\n'
    else if (mode === 'head') heads[heads.length - 1]!.text += line + '\n'
  }
  const st = normalizeGoalState(stateRaw !== undefined && stateRaw.trim() !== '' ? stateRaw : undefined)
  return { state: st === 'absent' || st === 'malformed' ? undefined : st, docs, heads }
}

function parseUpdate(raw: string): { newer?: boolean; latest?: string } {
  try {
    const j = JSON.parse(raw) as { newer?: unknown; latest?: unknown }
    return { newer: j.newer === true, latest: typeof j.latest === 'string' ? j.latest : undefined }
  } catch { return {} }
}

// ---------------------------------------------------------------- value

type Good<T> = { kind: 'good'; v: T; at: number; staleReason?: string } | { kind: 'pending' } | { kind: 'failed' }

function good<T>(sl: Slot<T> | undefined): Good<T> {
  if (!sl) return { kind: 'pending' }
  if (sl.ok) return { kind: 'good', v: sl.v, at: sl.at }
  if (sl.last) return { kind: 'good', v: sl.last.v, at: sl.last.at, staleReason: sl.err }
  return { kind: 'failed' }
}

function ok(text: string, at: number, extra?: Partial<Ok>): Ok {
  return { state: 'ok', text, at, ...extra }
}

// pending before the first feed; stale (last good + reason) after a failure.
// A maker that leaves at=0 gets the slot's own timestamp stamped in here.
function wrap<T>(sl: Slot<T> | undefined, make: (v: T) => Value): Value {
  const g = good(sl)
  if (g.kind !== 'good') return { state: 'pending' }
  const built = make(g.v)
  if (built.state !== 'ok') return built
  const stamped = built.at === 0 ? { ...built, at: g.at } : built
  return g.staleReason !== undefined ? { state: 'stale', last: stamped, reason: g.staleReason } : stamped
}

function envOf(state: RepoState): Record<string, string | undefined> {
  return state.env && state.env.ok ? state.env.v : {}
}

function dotenvOf(state: RepoState): Record<string, string> {
  const f = state.files['.env']
  const out: Record<string, string> = {}
  if (!f || !f.ok) return out
  for (const line of f.v.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
    if (m) out[m[1]!] = m[2]!
  }
  return out
}

function baseName(p: string): string {
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  return i === -1 ? t : t.slice(i + 1)
}

// E061: the directory name classed prod / stage / dev, case-insensitive.
function dirEnvClass(dirName: string): string {
  if (/prod|main|master/i.test(dirName)) return 'prod'
  if (/stage|staging/i.test(dirName)) return 'stage'
  return 'dev'
}

// The instance map of claude-infrastructure statusline.sh: ordinal config dirs.
const INSTANCE_DIRS: Record<string, number> = {
  '.claude-next': 1, '.claude-secondary': 2, '.claude-tertiary': 3, '.claude-quaternary': 4, '.claude-quinary': 5,
  '.claude-senary': 6, '.claude-septenary': 7, '.claude-octonary': 8, '.claude-nonary': 9, '.claude-denary': 10,
}
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']

function flowOf(branch: string): { icon: string; target?: string } {
  if (branch.startsWith('feature/')) return { icon: '🌿', target: '→ develop' }
  if (branch.startsWith('release/')) return { icon: '🚀', target: '→ main' }
  if (branch.startsWith('hotfix/')) return { icon: '🔥', target: '→ main+develop' }
  if (branch === 'develop') return { icon: '🔀' }
  if (branch === 'main') return { icon: '🏠' }
  return { icon: '📁' }
}

// E045: today's deadline from DEADLINE_TIME (HH:MM; malformed falls back 15:30).
function deadlineParts(raw: string | undefined): { h: number; m: number } {
  const mm = /^(\d{1,2}):(\d{2})$/.exec((raw ?? '').trim())
  if (!mm) return { h: 15, m: 30 }
  const h = Number(mm[1]), m = Number(mm[2])
  if (h > 23 || m > 59) return { h: 15, m: 30 }
  return { h, m }
}

function dayStartMs(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function localDayOfYear(now: number): number {
  const d = new Date(now)
  const start = Date.UTC(d.getFullYear(), 0, 1)
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.floor((today - start) / 86400000) + 1
}

function duToBytes(size: string): number | undefined {
  const m = /^([\d.]+)([KMGTP]?)$/i.exec(size)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n)) return undefined
  const mult: Record<string, number> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 }
  return n * (mult[m[2]!.toUpperCase()] ?? 1)
}

type Engine = 'Unity' | 'Unreal' | 'Godot' | 'Generic'

type EngineGood = { kind: 'good'; engine: Engine; staleReason?: string } | { kind: 'pending' } | { kind: 'failed' }

function engineOf(state: RepoState): EngineGood {
  const g = good(state.topLs)
  if (g.kind === 'pending') return { kind: 'pending' }
  if (g.kind === 'failed') return { kind: 'failed' }
  const names = new Set(g.v.names)
  let engine: Engine = 'Generic'
  if (names.has('Assets') && names.has('ProjectSettings')) engine = 'Unity'
  // The reference's `*.uproject` test is literal (a file named "*") and never
  // fires; Unreal arrives by Content or Binaries alone (E046 carrier note).
  else if (names.has('Content') || names.has('Binaries')) engine = 'Unreal'
  else if (names.has('project.godot')) engine = 'Godot'
  return { kind: 'good', engine, ...(g.staleReason !== undefined ? { staleReason: g.staleReason } : {}) }
}

const ENGINE_LABEL: Record<Engine, string> = { Unity: '🎲Unity', Unreal: '🎮Unreal', Godot: '👑Godot', Generic: '⚙️Generic' }

function valueOf(state: RepoState, elementId: string, args: FormatArgs): Value {
  const nf: NumberFormat = args.nf
  const env = envOf(state)
  const dot = dotenvOf(state)

  // variants contributed to base elements owned by base.ts
  if (elementId === 'branch' && args.variant === 'r-flow') {
    return wrap(state.porcelain, (p) => {
      if (p.fatal || !p.branch) return { state: 'nosource', reason: p.fatal ?? 'ветка не прочитана' }
      return ok(`${flowOf(p.branch).icon} ${p.branch}`, 0)
    })
  }
  if (elementId === 'branch' && args.variant === 'r-upstream') {
    return wrap(state.porcelain, (p) => {
      if (p.fatal || !p.branch) return { state: 'nosource', reason: p.fatal ?? 'ветка не прочитана' }
      if (!p.upstream) return { state: 'nosource', reason: 'у ветки нет upstream' }
      return ok(`${p.branch} (${p.upstream})`, 0)
    })
  }
  if (elementId === 'directory' && args.variant === 'r-dir-env') {
    const dir = env.PWD
    if (!dir) return { state: 'pending' }
    return ok(`🌍 ${dirEnvClass(baseName(dir))}`, state.clockAt ?? 0)
  }

  const el = ELEMENTS.find((e) => e.id === elementId)
  if (!el) return { state: 'pending' }
  if (el.outcome === 'N') return { state: 'nosource', reason: el.reason ?? 'источник не объявлен' }

  switch (elementId) {
    case 'r-flow-target':
      return wrap(state.porcelain, (p) => {
        if (p.fatal || !p.branch) return { state: 'nosource', reason: p.fatal ?? 'ветка не прочитана' }
        const target = flowOf(p.branch).target
        if (!target) return { state: 'nosource', reason: `ветка вне git-flow: ${p.branch}` }
        return ok(target, 0)
      })
    case 'r-dirty-counts':
      return wrap(state.porcelain, (p) => {
        const mod = p.entries.filter((e) => e.x === ' ' && e.y === 'M').length
        const untr = p.entries.filter((e) => e.x === '?' && e.y === '?').length
        const del = p.entries.filter((e) => e.x === ' ' && e.y === 'D').length
        if (args.variant === 'letters') {
          const staged = p.entries.filter((e) => e.x !== ' ' && e.x !== '?').length
          const unst = p.entries.filter((e) => e.y !== ' ' && e.y !== '?').length
          const parts: string[] = []
          if (staged > 0) parts.push(`S:${nf.count(staged)}`)
          if (unst > 0) parts.push(`U:${nf.count(unst)}`)
          if (untr > 0) parts.push(`A:${nf.count(untr)}`)
          return ok(parts.join(' '), 0, { num: staged + unst + untr, unit: 'count' })
        }
        const parts: string[] = []
        if (mod > 0) parts.push(`●${nf.count(mod)}`)
        if (untr > 0) parts.push(`✚${nf.count(untr)}`)
        if (del > 0) parts.push(`✖${nf.count(del)}`)
        return ok(parts.join(' '), 0, { num: mod + untr + del, unit: 'count' })
      })
    case 'r-paths':
      return wrap(state.porcelain, (p) => {
        const scope = typeof args.options.scope === 'string' ? args.options.scope : 'all'
        const max = typeof args.options.max === 'number' && args.options.max >= 1 ? Math.floor(args.options.max) : 8
        const staged = p.entries.filter((e) => e.x !== ' ' && e.x !== '?')
        const unstaged = p.entries.filter((e) => e.y !== ' ' && e.y !== '?' && !(e.x === '?' && e.y === '?'))
        const untracked = p.entries.filter((e) => e.x === '?' && e.y === '?')
        let rows: Row[] = []
        const addAll = (arr: PorcelainEntry[], cat: string): void => { for (const e of arr) rows.push({ label: e.file, right: cat }) }
        if (scope === 'staged') addAll(staged, 'staged')
        else if (scope === 'unstaged') addAll(unstaged, 'unstaged')
        else if (scope === 'untracked') addAll(untracked, 'untracked')
        else { addAll(staged, 'staged'); addAll(unstaged, 'unstaged'); addAll(untracked, 'untracked') }
        const total = rows.length
        const more = Math.max(0, total - max)
        if (more > 0) rows = rows.slice(0, max).concat([{ label: `+${nf.count(more)} more` }])
        return ok(rows.length === 0 ? '—' : rows.map((r) => r.label).join(', '), 0, { num: total, unit: 'count', rows })
      })
    case 'r-change-count':
      return wrap(state.porcelain, (p) => {
        const staged = p.entries.filter((e) => e.x !== ' ' && e.x !== '?').length
        const unstaged = p.entries.filter((e) => e.y !== ' ' && e.y !== '?' && !(e.x === '?' && e.y === '?')).length
        const untracked = p.entries.filter((e) => e.x === '?' && e.y === '?').length
        const n = args.variant === 'tracked-only' ? staged + unstaged : staged + unstaged + untracked
        return ok(nf.count(n), 0, { num: n, unit: 'count' })
      })
    case 'r-branches':
      return wrap(state.branchList, (branches) => {
        const max = typeof args.options.max === 'number' && args.options.max >= 1 ? Math.floor(args.options.max) : 60
        const rows: Row[] = branches.map((b) => ({ label: `${b.current ? '● ' : ''}${b.name}`, detail: b.current ? 'current' : undefined }))
        const total = rows.length
        const more = Math.max(0, total - max)
        const shown = more > 0 ? rows.slice(0, max).concat([{ label: `+${nf.count(more)} more` }]) : rows
        return ok(shown.length === 0 ? '—' : shown.map((r) => r.label).join(', '), 0, { num: total, unit: 'count', rows: shown })
      })
    case 'r-tracked-dirty':
      return wrap(state.porcelain, (p) => {
        const tracked = p.entries.filter((e) => !(e.x === '?' && e.y === '?'))
        return ok(tracked.length > 0 ? '*' : '', 0, { num: tracked.length > 0 ? 1 : 0, unit: 'count' })
      })
    case 'r-hp':
      return wrap(state.porcelain, (p) => {
        const hp = 10 - p.entries.length
        return ok(`HP:${nf.count(hp)}/10`, 0, { num: hp, unit: 'count' })
      })
    case 'r-engine': {
      const e = engineOf(state)
      if (e.kind !== 'good') return { state: 'pending' }
      const built = ok(ENGINE_LABEL[e.engine], state.topLs?.ok ? state.topLs.at : 0)
      return e.staleReason !== undefined ? { state: 'stale', last: built, reason: e.staleReason } : built
    }
    case 'r-worktree-main':
      return wrap(state.worktree, (w) => {
        if (w.bare) return { state: 'nosource', reason: 'первая запись worktree — bare' }
        if (!w.main) return { state: 'nosource', reason: 'worktree list пуст или не git-репозиторий' }
        return ok(baseName(w.main), 0)
      })
    case 'r-instance': {
      const explicit = env.CLAUDE_INSTANCE_N
      let n: number | undefined
      if (explicit !== undefined && explicit !== '' && /^\d+$/.test(explicit) && Number(explicit) >= 1) n = Number(explicit)
      if (n === undefined) {
        const tp = state.sessionInfo?.ok ? state.sessionInfo.v.transcriptPath : undefined
        let cfg: string | undefined
        if (tp !== undefined && tp.includes('/projects/')) {
          const head = tp.split('/projects/')[0]
          if (head !== '' && head !== tp) cfg = head
        }
        if (cfg === undefined) cfg = env.CLAUDE_CONFIG_DIR
        if (cfg !== undefined && cfg !== '') n = INSTANCE_DIRS[baseName(cfg)]
      }
      if (n === undefined) return { state: 'nosource', reason: 'инстанс не определён: нет CLAUDE_INSTANCE_N, карта каталогов и CLAUDE_CONFIG_DIR не сказали' }
      const circled = env.TERM_PROGRAM === 'iTerm.app' && n <= 20
      return ok(circled ? (CIRCLED[n - 1] ?? `(n)`) : `(${nf.count(n)})`, state.clockAt ?? 0, { num: n, unit: 'count' })
    }
    case 'r-pane': {
      const kitty = env.KITTY_WINDOW_ID
      const iterm = env.ITERM_SESSION_ID
      if (kitty !== undefined && kitty !== '') return ok(`#${kitty}`, state.clockAt ?? 0)
      if (iterm !== undefined && iterm !== '') {
        const cut = iterm.includes(':') ? iterm.slice(iterm.lastIndexOf(':') + 1) : iterm
        return ok(`#${cut}`, state.clockAt ?? 0)
      }
      return { state: 'nosource', reason: 'ни KITTY_WINDOW_ID, ни ITERM_SESSION_ID в окружении' }
    }
    case 'r-dbname': {
      const name = env.NEON_DATABASE ?? dot.NEON_DATABASE
      if (!name) return { state: 'nosource', reason: 'NEON_DATABASE не задан ни в env, ни в .env' }
      return ok(name, state.clockAt ?? 0)
    }
    case 'r-pool': {
      const endpoint = env.NEON_ENDPOINT ?? dot.NEON_ENDPOINT
      if (!endpoint) return { state: 'nosource', reason: 'NEON_ENDPOINT не задан: зонд порта не адресован' }
      const conn = good(state.neonProbe)
      const dns = good(state.neonDns)
      if (conn.kind !== 'good' || dns.kind !== 'good') return { state: 'pending' }
      const pool = conn.v === 'connected' ? 'pool:✓' : dns.v ? 'pool:💤' : 'pool:✗'
      const at = state.neonProbe?.ok ? state.neonProbe.at : 0
      const built = ok(pool, at)
      const reason = conn.staleReason ?? dns.staleReason
      return reason !== undefined ? { state: 'stale', last: built, reason } : built
    }
    case 'r-write-mb': {
      const key = env.NEON_API_KEY ?? dot.NEON_API_KEY
      const proj = env.NEON_PROJECT_ID ?? dot.NEON_PROJECT_ID
      if (!key || !proj) return { state: 'nosource', reason: 'NEON_API_KEY/NEON_PROJECT_ID не заданы: consumption_history недоступен' }
      return wrap(state.neonRest, (rawText) => {
        try {
          const j = JSON.parse(rawText) as { periods?: { written_data_bytes?: unknown }[] }
          const b = j.periods?.[0]?.written_data_bytes
          if (typeof b !== 'number' || b <= 0) return ok('idle', 0)
          const mb = Math.floor(b / 1048576)
          return ok(`${nf.count(mb)}MB↑`, 0, { num: mb, unit: 'bytes' })
        } catch { return { state: 'pending' } }
      })
    }
    case 'r-mana': {
      const f = state.files['package.json']
      if (!f) return { state: 'pending' }
      return ok(f.ok ? '🔵' : '⚪', f.ok ? f.at : (f.last?.at ?? f.at))
    }
    case 'r-update':
      return wrap(state.update, (v) => (v.newer && v.latest ? ok(`⬆ ${v.latest}`, 0) : { state: 'pending' }))
    case 'r-unity-scene':
      return wrap(state.unityScene, (v) => ok(v === 'None' ? 'None' : v, 0))
    case 'r-unity-version': {
      const f = state.files['ProjectSettings/ProjectVersion.txt']
      if (!f) return { state: 'pending' }
      if (!f.ok && !f.last) return { state: 'nosource', reason: 'ProjectVersion.txt не читается' }
      const text = f.ok ? f.v : f.last!.v
      const at = f.ok ? f.at : f.last!.at
      const parts = text.split(':')
      return ok(parts.length > 1 ? parts[1]!.trim().slice(0, 6) : 'Unknown', at)
    }
    case 'r-unity-platform': {
      const f = state.files['ProjectSettings/EditorBuildSettings.asset']
      if (!f) return { state: 'pending' }
      if (!f.ok && !f.last) return { state: 'nosource', reason: 'EditorBuildSettings.asset не читается' }
      const text = f.ok ? f.v : f.last!.v
      const at = f.ok ? f.at : f.last!.at
      if (text.includes('iPhone')) return ok('📱iOS', at)
      if (text.includes('Android')) return ok('🤖And', at)
      if (text.includes('StandaloneWindows')) return ok('🖥️PC', at)
      if (text.includes('WebGL')) return ok('🌐Web', at)
      return ok('⚙️Multi', at)
    }
    case 'r-unity-pkgs': {
      const f = state.files['Packages/manifest.json']
      if (!f) return { state: 'pending' }
      if (!f.ok) return { state: 'nosource', reason: 'Packages/manifest.json нет' }
      return ok('📋Pkgs', f.at)
    }
    case 'r-asset-bucket':
      if (args.variant === 'dash') {
        return wrap(state.metaEntries, (n) => ok(n > 1000 ? '⚠️Assets' : n > 500 ? '📦Assets' : '✅Assets', 0, { num: n, unit: 'count' }))
      }
      return wrap(state.metaFiles, (v) => ok(v.total > 2000 ? '🔴High' : v.total > 1000 ? '🟡Med' : '🟢Low', 0, { num: v.total, unit: 'count' }))
    case 'r-tex-bucket':
      return wrap(state.metaFiles, (v) => ok(v.textures > 500 ? '🔴Mem' : v.textures > 200 ? '🟡Mem' : '🟢Mem', 0, { num: v.textures, unit: 'count' }))
    case 'r-build-size':
      return wrap(state.buildSize, (size) => {
        if (!size) return ok('🔧NoBuild', 0)
        const bytes = duToBytes(size)
        if (bytes === undefined) return ok(`📦 ${size}`, 0)
        return ok(`📦 ${nf.bytes(bytes)}`, 0, { num: bytes, unit: 'bytes' })
      })
    case 'r-fps':
      return ok('⚡60fps', state.clockAt ?? 0, { num: 60, unit: 'rate' })
    case 'r-platforms': {
      const builds = good(state.buildsLs)
      const binaries = good(state.binariesLs)
      if (builds.kind !== 'good' || binaries.kind !== 'good') return { state: 'pending' }
      const mark = (reading: LsReading, dir: string): string => (reading.absent ? '?' : reading.names.includes(dir) ? '✓' : '✗')
      const rows: Row[] = [
        { label: '📱 iOS', right: mark(builds.v, 'iOS'), icon: builds.v.names.includes('iOS') ? 'ok' : builds.v.absent ? 'info' : 'fail' },
        { label: '🤖 Android', right: mark(builds.v, 'Android'), icon: builds.v.names.includes('Android') ? 'ok' : builds.v.absent ? 'info' : 'fail' },
        { label: '🖥️ PC', right: mark(builds.v, 'PC'), icon: builds.v.names.includes('PC') ? 'ok' : builds.v.absent ? 'info' : 'fail' },
        { label: '🌐 WebGL', right: mark(builds.v, 'WebGL'), icon: builds.v.names.includes('WebGL') ? 'ok' : builds.v.absent ? 'info' : 'fail' },
        { label: '🖥️ Win64', right: mark(binaries.v, 'Win64'), icon: binaries.v.names.includes('Win64') ? 'ok' : binaries.v.absent ? 'info' : 'fail' },
        { label: '🍎 Mac', right: mark(binaries.v, 'Mac'), icon: binaries.v.names.includes('Mac') ? 'ok' : binaries.v.absent ? 'info' : 'fail' },
        { label: '🐧 Linux', right: mark(binaries.v, 'Linux'), icon: binaries.v.names.includes('Linux') ? 'ok' : binaries.v.absent ? 'info' : 'fail' },
      ]
      return ok(rows.map((r) => `${r.label} ${r.right}`).join(' '), 0, { rows })
    }
    case 'r-store': {
      const builds = good(state.buildsLs)
      const binaries = good(state.binariesLs)
      const errs = good(state.logErrors)
      if (builds.kind !== 'good' || binaries.kind !== 'good') return { state: 'pending' }
      const anyBuilt = !builds.v.absent && ['iOS', 'Android', 'PC', 'WebGL'].some((d) => builds.v.names.includes(d))
        || !binaries.v.absent && ['Win64', 'Mac', 'Linux'].some((d) => binaries.v.names.includes(d))
      if (!anyBuilt) return ok('🔧Build', 0)
      if (errs.kind !== 'good') return { state: 'pending' }
      return ok(errs.v === 0 ? '🎮Ready' : errs.v < 5 ? '⚠️Issues' : '🔴Errors', 0, { num: errs.v, unit: 'count' })
    }
    case 'r-build-status': {
      const e = engineOf(state)
      if (e.kind !== 'good') return { state: 'pending' }
      const at = state.topLs?.ok ? state.topLs.at : 0
      let built: Ok
      if (e.engine === 'Unity') {
        const b = good(state.buildsLs)
        if (b.kind !== 'good') return { state: 'pending' }
        built = b.v.absent ? ok('🔧Pending', at) : ok(`📦${nf.count(b.v.names.length)}`, 0, { num: b.v.names.length, unit: 'count' })
      } else if (e.engine === 'Unreal') {
        const b = good(state.binariesLs)
        if (b.kind !== 'good') return { state: 'pending' }
        built = b.v.absent ? ok('🔧Pending', at) : ok(`📦${nf.count(b.v.names.length)}`, 0, { num: b.v.names.length, unit: 'count' })
      } else if (e.engine === 'Godot') {
        const top = good(state.topLs)
        if (top.kind !== 'good') return { state: 'pending' }
        built = ok(top.v.names.includes('export') || top.v.names.includes('builds') ? '📦Multi' : '🔧Setup', at)
      } else {
        built = ok('❓Unknown', at)
      }
      const lsStale = state.buildsLs && !state.buildsLs.ok && state.buildsLs.last ? state.buildsLs.err
        : state.binariesLs && !state.binariesLs.ok && state.binariesLs.last ? state.binariesLs.err
        : e.staleReason
      return lsStale !== undefined ? { state: 'stale', last: built, reason: lsStale } : built
    }
    case 'r-assets':
      return wrap(state.assetDu, (a) => {
        const glyphs: Record<AssetType, string> = { png: '🖼', fbx: '🎯', wav: '🔊' }
        const rows: Row[] = (['png', 'fbx', 'wav'] as AssetType[]).map((t) => {
          const { count, kb } = a[t]
          const mb = Math.floor(kb / 1024)
          return { label: `${glyphs[t]} ${nf.count(count)}${count > 0 ? ` (${nf.bytes(mb * 1048576)})` : ' (None)'}`, right: t }
        })
        return ok(rows.map((r) => r.label).join(' '), 0, { rows, num: a.png.count + a.fbx.count + a.wav.count, unit: 'count' })
      })
    case 'r-asset-load':
      return wrap(state.assetDu, (a) => {
        const mb = Math.floor(a.png.kb / 1024)
        return ok(mb > 500 ? '🔴Heavy' : mb > 100 ? '🟡Med' : '🟢Light', 0, { num: mb, unit: 'count' })
      })
    case 'r-compression':
      return wrap(state.assetsLs, (v) => ok(v.names.includes('StreamingAssets') ? '📦Stream' : '📦Auto', 0))
    case 'r-pipeline-health':
      return wrap(state.assetDu, (a) => {
        const total = a.png.count + a.fbx.count + a.wav.count
        return ok(total < 1000 ? '✅Optimal' : total < 2000 ? '⚠️Large' : '🔴Massive', 0, { num: total, unit: 'count' })
      })
    case 'r-depth':
      return wrap(state.depth, (n) => ok(`Depth: ${nf.count(n * 10)}m`, 0, { num: n * 10, unit: 'count' }))
    case 'r-lang':
      return wrap(state.lang, (l) => ok(l.py ? '🐍' : l.js ? '🌐' : l.rs ? '🦀' : '💻', 0))
    case 'r-daypart': {
      if (state.clockAt === undefined) return { state: 'pending' }
      const h = new Date(state.clockAt).getHours()
      return ok(h < 12 ? '☀️ Morning' : h < 18 ? '🌤️ Afternoon' : '🌙 Evening', state.clockAt)
    }
    case 'r-streak': {
      if (state.clockAt === undefined) return { state: 'pending' }
      const n = localDayOfYear(state.clockAt) % 100
      return ok(`⚡Streak: ${nf.count(n)}`, state.clockAt, { num: n, unit: 'count' })
    }
    case 'r-cycle': {
      if (state.clockAt === undefined) return { state: 'pending' }
      return ok(['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'][Math.floor(state.clockAt / 1000) % 6]!, state.clockAt)
    }
    case 'r-mood': {
      if (state.clockAt === undefined) return { state: 'pending' }
      return ok(['😴', '😅', '🤔', '😎', '🤯', '🥳', '😤', '🤖'][Math.floor(state.clockAt / 1000) % 8]!, state.clockAt)
    }
    case 'r-energy': {
      if (state.clockAt === undefined) return { state: 'pending' }
      const n = (Math.floor(state.clockAt / 1000) % 100) + 1
      return ok(`⚡${nf.percent(n / 100)}`, state.clockAt, { num: n, unit: 'percent' })
    }
    case 'r-creature': {
      if (state.clockAt === undefined) return { state: 'pending' }
      const d = good(state.depth)
      if (d.kind !== 'good') return { state: 'pending' }
      const depth = d.v * 10
      // the treasure re-rolls from the feed clock, standing in for the
      // reference's per-render RANDOM % 20 (families see no RNG of their own)
      const treasure = Math.floor(state.clockAt / 1000) % 20 === 0
      const built = ok(treasure ? '💎' : depth > 100 ? '🐋' : depth > 50 ? '🐠' : '🐟', state.clockAt)
      return d.staleReason !== undefined ? { state: 'stale', last: built, reason: d.staleReason } : built
    }
    case 'r-deadline': {
      if (state.clockAt === undefined) return { state: 'pending' }
      const { h, m } = deadlineParts(env.DEADLINE_TIME)
      const deadline = dayStartMs(state.clockAt) + h * 3600000 + m * 60000
      const diff = deadline - state.clockAt
      if (diff <= 0) return ok(`OVERTIME +${nf.duration(-diff)}`, state.clockAt, { num: Math.floor(-diff / 60000), unit: 'ms' })
      return ok(nf.duration(diff), state.clockAt, { num: Math.floor(diff / 60000), unit: 'ms' })
    }
    case 'r-ui-kinds':
      // The reference counted distinct surface:component keys across ui.render
      // asks; the family Source contract carries no ui.render event, so the
      // count has no declared feed until the contract or the core owns one.
      return { state: 'nosource', reason: 'нет источника в контракте: счёт видов UI-компонентов требует события ui.render, которого нет в Source' }
    case 'r-kit-goal':
      return wrap(state.kit, (k) => k.state
        ? ok(`🎯 ${baseName(k.state.plan).replace(/\.md$/i, '')}`, 0)
        : { state: 'nosource', reason: 'цель не вооружена или goal-state нечитаем' })
    case 'r-plan-sections':
      return wrap(state.kit, (k) => {
        if (!k.state) return { state: 'nosource', reason: 'цель не вооружена' }
        const doc = k.docs.find((d) => d.rel === k.state!.plan.replace(/^\.\//, ''))
        if (!doc) return { state: 'pending' }
        const prog = sectionProgress(doc.text)
        if (!prog) return { state: 'nosource', reason: 'в плане нет секций' }
        return ok(`Sections: ${nf.count(prog.done)}/${nf.count(prog.total)}`, 0, { num: prog.done, unit: 'count' })
      })
    case 'r-plan-next':
      return wrap(state.kit, (k) => {
        if (!k.state) return { state: 'nosource', reason: 'цель не вооружена' }
        const doc = k.docs.find((d) => d.rel === k.state!.plan.replace(/^\.\//, ''))
        if (!doc) return { state: 'pending' }
        const prog = sectionProgress(doc.text)
        if (!prog || !prog.pointer) return { state: 'nosource', reason: 'указатель Next не читается' }
        return ok(`(Next ${prog.pointer})`, 0)
      })
    case 'r-plan-queue':
      return wrap(state.kit, (k) => {
        if (!k.state) return { state: 'nosource', reason: 'цель не вооружена' }
        const docs = new Map(k.docs.map((d) => [d.rel, d.text]))
        const heads = new Map(k.heads.map((d) => [d.rel, d.text]))
        const w = kitWalk(k.state, docs, heads)
        if (!w.positional) return { state: 'nosource', reason: 'в очереди один план' }
        const clauses: string[] = []
        if (w.healed > 0) clauses.push(`stored ${w.stored + 1}`)
        if (w.unresolvable) clauses.push(`unresolvable: ${w.cause ?? 'unknown'}`)
        if (w.finished) clauses.push('all complete')
        const suffix = clauses.length > 0 ? ` (${clauses.join(', ')})` : ''
        const name = w.healed > 0 ? ` ${baseName(k.state.queue[w.index] ?? '').replace(/\.md$/i, '')}` : ''
        return ok(`Plans: ${nf.count(w.index + 1)}/${nf.count(k.state.queue.length)}${name}${suffix}`, 0, { num: w.index + 1, unit: 'count' })
      })
    case 'r-plan-unarmed':
      return wrap(state.kit, (k) => (k.state ? { state: 'pending' } : ok('🎯 unarmed', 0)))
    default:
      return { state: 'pending' }
  }
}

export default collector
