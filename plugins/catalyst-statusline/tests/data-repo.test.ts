import { expect, test } from 'claude-code/testing'
import repo, { SOURCES } from '../hooks/data/repo'
import type { FormatArgs, Input, NumberFormat, Source } from '../hooks/data/types'

// T-git family teeth: every element answers pending before its first feed, ok
// on a real-shaped sample, stale/nosource on refusal; every variant computes
// its own formula with numbers derived from the fed input, never from output.

const nf: NumberFormat = {
  tokens: (n) => String(n),
  usd: (n) => `$${n}`,
  percent: (r) => `${Math.round(r * 100)}%`,
  duration: (ms) => `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`,
  bytes: (n) => `${Math.floor(n / 1048576)} MB`,
  count: (n) => String(n),
  rate: (n, u) => `${n}/${u}`,
}

function args(variant: string, options: Record<string, unknown> = {}): FormatArgs {
  return { variant, options, nf }
}

type S = ReturnType<typeof repo.init>

function feed(s: S, source: Source, data: unknown, ok = true, error?: string, now = 1700000000000): S {
  return repo.reduce(s, { source, ok, data, error, now })
}

function v(s: S, id: string, variant = 'std', options: Record<string, unknown> = {}): ReturnType<typeof repo.value> {
  return repo.value(s, id, args(variant, options))
}

function txt(x: ReturnType<typeof repo.value>): string {
  expect(x.state).toBe('ok')
  return (x as { text: string }).text
}

// ---------------------------------------------------------------- git porcelain

const PORCELAIN = [
  '## feature/hover...origin/feature/hover [ahead 1]',
  ' M src/a.ts',
  '?? new.txt',
  ' D old.ts',
  'M  staged.ts',
].join('\n')

const GIT_STATUS = SOURCES.GIT_STATUS

function withPorcelain(): S {
  return feed(repo.init(), GIT_STATUS, { code: 0, stdout: PORCELAIN, stderr: '' })
}

test('git elements are pending before the first feed', () => {
  const s = repo.init()
  for (const id of ['r-dirty-counts', 'r-change-count', 'r-paths', 'r-tracked-dirty', 'r-hp', 'r-flow-target']) {
    expect(v(s, id)).toEqual({ state: 'pending' })
  }
  expect(v(s, 'branch', 'r-flow')).toEqual({ state: 'pending' })
})

test('dirty counts glyph variant: 1 modified, 1 untracked, 1 deleted, staged excluded from the glyph form', () => {
  const s = withPorcelain()
  const got = v(s, 'r-dirty-counts', 'glyph')
  expect(txt(got)).toBe('●1 ✚1 ✖1')
  expect((got as { num?: number }).num).toBe(3)
})

test('dirty counts letters variant: the S/U/A partition of the same porcelain', () => {
  const s = withPorcelain()
  const got = v(s, 'r-dirty-counts', 'letters')
  // staged = x not blank/? → 1 ('M '); unstaged = y not blank/? → 2 (' M', ' D'); added = ?? → 1
  expect(txt(got)).toBe('S:1 U:2 A:1')
  expect((got as { num?: number }).num).toBe(4)
})

test('change count: with-untracked sums 1+2+1=4, tracked-only drops the untracked entry to 3', () => {
  const s = withPorcelain()
  expect((v(s, 'r-change-count', 'with-untracked') as { num?: number }).num).toBe(4)
  expect((v(s, 'r-change-count', 'tracked-only') as { num?: number }).num).toBe(3)
})

test('changed paths: all scope lists four paths with category rows; max 3 truncates with +N more (E592)', () => {
  const s = withPorcelain()
  const all = v(s, 'r-paths', 'all') as { num?: number; rows?: { label: string; right?: string }[] }
  expect(all.num).toBe(4)
  expect(all.rows?.map((r) => r.right)).toEqual(['staged', 'unstaged', 'unstaged', 'untracked'])
  const cut = v(s, 'r-paths', 'all', { max: 3 }) as { rows?: { label: string }[] }
  expect(cut.rows?.length).toBe(4)
  expect(cut.rows?.[3]?.label).toBe('+1 more')
  const only = v(s, 'r-paths', 'all', { scope: 'untracked' }) as { num?: number }
  expect(only.num).toBe(1)
})

test('tracked dirty star and HP: 3 tracked entries of 4 total → * and 10−4=6', () => {
  const s = withPorcelain()
  expect(txt(v(s, 'r-tracked-dirty'))).toBe('*')
  expect(txt(v(s, 'r-hp'))).toBe('HP:6/10')
})

test('branch variants: git-flow classifies the prefix, upstream is the part after ...', () => {
  const s = withPorcelain()
  expect(txt(v(s, 'branch', 'r-flow'))).toBe('🌿 feature/hover')
  expect(txt(v(s, 'branch', 'r-upstream'))).toBe('feature/hover (origin/feature/hover)')
  expect(txt(v(s, 'r-flow-target'))).toBe('→ develop')
})

test('flow target on a non-flow branch names the route, main maps home with no target', () => {
  const plain = feed(repo.init(), GIT_STATUS, { code: 0, stdout: '## main\n M a.ts', stderr: '' })
  expect(v(plain, 'r-flow-target')).toEqual({ state: 'nosource', reason: 'ветка вне git-flow: main' })
  expect(txt(v(plain, 'branch', 'r-flow'))).toBe('🏠 main')
})

test('git failure after a success is stale with the last value and the reason', () => {
  let s = withPorcelain()
  s = feed(s, GIT_STATUS, { code: 128, stdout: '', stderr: 'fatal: ...' }, false, 'git gone')
  const got = v(s, 'r-change-count', 'with-untracked')
  expect(got.state).toBe('stale')
  expect((got as { last: { text: string }; reason: string }).last.text).toBe('4')
  expect((got as { last: unknown; reason: string }).reason).toBe('git gone')
})

test('outside a repository the git elements name the missing route, not pending', () => {
  const s = feed(repo.init(), GIT_STATUS, { code: 128, stdout: '', stderr: 'fatal: not a git repository' })
  expect(v(s, 'r-flow-target')).toEqual({ state: 'nosource', reason: 'не git-репозиторий' })
})

// ---------------------------------------------------------------- branches / worktree

const GIT_BRANCHES = SOURCES.GIT_BRANCHES
const GIT_WORKTREE = SOURCES.GIT_WORKTREE

test('branches list: current marked, count as num, +N more past the cap (E582, E591)', () => {
  const out = '*\tmain\n\tdev\n\tfeat/x\n'
  let s = feed(repo.init(), GIT_BRANCHES, { code: 0, stdout: out, stderr: '' })
  const got = v(s, 'r-branches') as { num?: number; rows?: { label: string }[] }
  expect(got.num).toBe(3)
  expect(got.rows?.[0]?.label).toBe('● main')
  s = feed(repo.init(), GIT_BRANCHES, { code: 0, stdout: '*\tmain\n' + Array.from({ length: 61 }, (_, i) => `\tb${i}`).join('\n') + '\n', stderr: '' })
  const cut = v(s, 'r-branches', 'std', { max: 60 }) as { rows?: { label: string }[] }
  expect(cut.rows?.length).toBe(61)
  expect(cut.rows?.[60]?.label).toBe('+2 more')
})

test('main worktree basename from the first porcelain entry; bare answers nosource', () => {
  const out = 'worktree /Users/m/work/Catalyst\nHEAD abc\n\nworktree /Users/m/work/wt1\n'
  const s = feed(repo.init(), GIT_WORKTREE, { code: 0, stdout: out, stderr: '' })
  expect(txt(v(s, 'r-worktree-main'))).toBe('Catalyst')
  const bare = feed(repo.init(), GIT_WORKTREE, { code: 0, stdout: 'worktree /Users/m/work/.git\nbare\n\n', stderr: '' })
  expect(v(bare, 'r-worktree-main').state).toBe('nosource')
})

// ---------------------------------------------------------------- engine / builds

const LS_TOP = SOURCES.LS_TOP
const LS_BUILDS = SOURCES.LS_BUILDS
const LS_BINARIES = SOURCES.LS_BINARIES
const DU_BUILDS = SOURCES.DU_BUILDS
const LOG_ERRORS = SOURCES.LOG_ERRORS

function engine(names: string[]): S {
  return feed(repo.init(), LS_TOP, { code: 0, stdout: names.join('\n'), stderr: '' })
}

test('engine detect: Unity by Assets+ProjectSettings, Unreal by Content, Godot by project.godot, else Generic', () => {
  expect(txt(v(engine(['Assets', 'ProjectSettings', 'Packages']), 'r-engine'))).toBe('🎲Unity')
  expect(txt(v(engine(['Content', 'Config']), 'r-engine'))).toBe('🎮Unreal')
  expect(txt(v(engine(['project.godot']), 'r-engine'))).toBe('👑Godot')
  expect(txt(v(engine(['src', 'README.md']), 'r-engine'))).toBe('⚙️Generic')
})

test('build status per engine: counts, Pending when the directory is absent (E621)', () => {
  const unity = feed(engine(['Assets', 'ProjectSettings']), LS_BUILDS, { code: 0, stdout: 'iOS\nAndroid\n', stderr: '' })
  expect(txt(v(unity, 'r-build-status'))).toBe('📦2')
  const noBuilds = feed(engine(['Assets', 'ProjectSettings']), LS_BUILDS, { code: 2, stdout: '', stderr: 'ls: Builds: No such file or directory' }, false)
  expect(txt(v(noBuilds, 'r-build-status'))).toBe('🔧Pending')
  const godot = feed(engine(['project.godot', 'export']), LS_BUILDS, { code: 2, stdout: '', stderr: 'ls: Builds: No such file or directory' }, false)
  expect(txt(v(godot, 'r-build-status'))).toBe('📦Multi')
  const generic = feed(engine(['src']), LS_BUILDS, { code: 2, stdout: '', stderr: 'ls: Builds: No such file or directory' }, false)
  expect(txt(v(generic, 'r-build-status'))).toBe('❓Unknown')
})

test('platforms rows: built ✓, present-dir missing ✗, absent dir ? (E051)', () => {
  let s = feed(repo.init(), LS_BUILDS, { code: 0, stdout: 'iOS\n', stderr: '' })
  s = feed(s, LS_BINARIES, { code: 0, stdout: 'Mac\n', stderr: '' })
  const got = v(s, 'r-platforms') as { rows?: { label: string; right?: string }[] }
  const marks = got.rows?.map((r) => `${r.label} ${r.right}`)
  expect(marks).toEqual(['📱 iOS ✓', '🤖 Android ✗', '🖥️ PC ✗', '🌐 WebGL ✗', '🖥️ Win64 ✗', '🍎 Mac ✓', '🐧 Linux ✗'])
  let absent = feed(repo.init(), LS_BUILDS, { code: 2, stdout: '', stderr: 'ls: Builds: No such file or directory' }, false)
  absent = feed(absent, LS_BINARIES, { code: 2, stdout: '', stderr: 'ls: Binaries: No such file or directory' }, false)
  const rows = v(absent, 'r-platforms') as { rows?: { right?: string }[] }
  expect(rows.rows?.[0]?.right).toBe('?')
})

test('store readiness: error count 0 ready, 6 errors red, no platform built is Build (E052)', () => {
  let s = feed(repo.init(), LS_BUILDS, { code: 0, stdout: 'iOS\n', stderr: '' })
  s = feed(s, LS_BINARIES, { code: 2, stdout: '', stderr: 'ls: Binaries: No such file or directory' }, false)
  const zero = feed(s, LOG_ERRORS, { code: 1, stdout: '', stderr: '' }, false)
  expect(txt(v(zero, 'r-store'))).toBe('🎮Ready')
  const six = feed(s, LOG_ERRORS, { code: 0, stdout: 'e1\ne2\ne3\ne4\ne5\ne6\n', stderr: '' })
  expect(txt(v(six, 'r-store'))).toBe('🔴Errors')
  let none = feed(repo.init(), LS_BUILDS, { code: 2, stdout: '', stderr: 'ls: Builds: No such file or directory' }, false)
  none = feed(none, LS_BINARIES, { code: 2, stdout: '', stderr: 'ls: Binaries: No such file or directory' }, false)
  expect(txt(v(none, 'r-store'))).toBe('🔧Build')
})

test('build size from the first du line parsed to bytes; NoBuild when du printed nothing (E049)', () => {
  const s = feed(repo.init(), DU_BUILDS, { code: 0, stdout: ' 12M\tBuilds\n', stderr: '' })
  expect(txt(v(s, 'r-build-size'))).toBe('📦 12 MB')
  const none = feed(repo.init(), DU_BUILDS, { code: 1, stdout: '', stderr: 'du: Builds: No such file or directory\ndu: Build: No such file or directory\ndu: build: No such file or directory' }, false)
  expect(txt(v(none, 'r-build-size'))).toBe('🔧NoBuild')
})

// ---------------------------------------------------------------- assets / files

const ASSET_DU = SOURCES.ASSET_DU
const META_FILES = SOURCES.META_FILES
const META_ENTRIES = SOURCES.META_ENTRIES
const DEPTH_FIND = SOURCES.DEPTH_FIND
const LANG_FIND = SOURCES.LANG_FIND
const LS_ASSETS = SOURCES.LS_ASSETS

test('assets rows: per-type count and MB from the du lines; a type with no files reads None (E083–E088)', () => {
  const out = '@@png\n48\ta.png\n1024\tb.png\n@@fbx\n@@wav\n64\tc.wav\n'
  const s = feed(repo.init(), ASSET_DU, { code: 0, stdout: out, stderr: '' })
  const got = v(s, 'r-assets') as { num?: number; rows?: { label: string }[] }
  // png: 2 files, 1072 KB → 1 MB floor; fbx none; wav 1 file 0 MB
  expect(got.rows?.map((r) => r.label)).toEqual(['🖼 2 (1 MB)', '🎯 0 (None)', '🔊 1 (0 MB)'])
  expect(got.num).toBe(3)
})

test('asset load and pipeline health bucket the same sums (E089, E618)', () => {
  const out = '@@png\n' + Array.from({ length: 600 }, () => '1024\tx.png').join('\n') + '\n@@fbx\n@@wav\n'
  const s = feed(repo.init(), ASSET_DU, { code: 0, stdout: out, stderr: '' })
  expect(txt(v(s, 'r-asset-load'))).toBe('🔴Heavy') // 600 files × 1024 KB = 600 MB > 500
  expect(txt(v(s, 'r-pipeline-health'))).toBe('✅Optimal') // 600 files < 1000
  const light = '@@png\n' + Array.from({ length: 60 }, () => '1024\tx.png').join('\n') + '\n@@fbx\n@@wav\n'
  const s2 = feed(repo.init(), ASSET_DU, { code: 0, stdout: light, stderr: '' })
  expect(txt(v(s2, 'r-asset-load'))).toBe('🟢Light') // 60 MB ≤ 100
})

test('asset bucket variants: perf thresholds 2000/1000 on files, dash thresholds 1000/500 on entries (E047, E069)', () => {
  const files = feed(repo.init(), META_FILES, { code: 0, stdout: Array.from({ length: 1500 }, (_, i) => `Assets/f${i}.png`).join('\n'), stderr: '' })
  expect(txt(v(files, 'r-asset-bucket', 'perf'))).toBe('🟡Med')
  const entries = feed(repo.init(), META_ENTRIES, { code: 0, stdout: Array.from({ length: 600 }, (_, i) => `Assets/f${i}`).join('\n'), stderr: '' })
  expect(txt(v(entries, 'r-asset-bucket', 'dash'))).toBe('📦Assets')
})

test('texture bucket counts png/jpg/tga inside the non-meta listing at 500/200 (E048)', () => {
  const out = ['a.png', 'b.jpg', 'c.tga', 'd.png', 'e.cs'].map((f) => `Assets/${f}`).join('\n')
  const s = feed(repo.init(), META_FILES, { code: 0, stdout: out, stderr: '' })
  expect((v(s, 'r-tex-bucket') as { num?: number }).num).toBe(4)
  expect(txt(v(s, 'r-tex-bucket'))).toBe('🟢Mem')
})

test('compression: StreamingAssets inside Assets means Stream (E617)', () => {
  const s = feed(repo.init(), LS_ASSETS, { code: 0, stdout: 'StreamingAssets\nMaterials\n', stderr: '' })
  expect(txt(v(s, 'r-compression'))).toBe('📦Stream')
  const auto = feed(repo.init(), LS_ASSETS, { code: 0, stdout: 'Materials\n', stderr: '' })
  expect(txt(v(auto, 'r-compression'))).toBe('📦Auto')
})

test('depth is the file count times ten (E011)', () => {
  const s = feed(repo.init(), DEPTH_FIND, { code: 0, stdout: Array.from({ length: 12 }, (_, i) => `f${i}.rs`).join('\n'), stderr: '' })
  expect(txt(v(s, 'r-depth'))).toBe('Depth: 120m')
})

test('language glyph by the first matching root source (E009)', () => {
  const rs = feed(repo.init(), LANG_FIND, { code: 0, stdout: 'lib.rs\n', stderr: '' })
  expect(txt(v(rs, 'r-lang'))).toBe('🦀')
  const none = feed(repo.init(), LANG_FIND, { code: 0, stdout: '', stderr: '' })
  expect(txt(v(none, 'r-lang'))).toBe('💻')
})

// ---------------------------------------------------------------- decor clock

const CLOCK = SOURCES.CLOCK
const ENV_SRC = SOURCES.ENV_SRC

test('clock elements are pending before any feed', () => {
  const s = repo.init()
  for (const id of ['r-daypart', 'r-streak', 'r-cycle', 'r-mood', 'r-energy', 'r-deadline']) {
    expect(v(s, id)).toEqual({ state: 'pending' })
  }
})

test('daypart, streak, cycle, mood and energy derive from the fed clock (E005–E010)', () => {
  // local 14:30:05 on 24 Sep 2026 → hour 14, day-of-year 267, epoch-second rolls below
  const now = new Date(2026, 8, 24, 14, 30, 5).getTime()
  const s = feed(repo.init(), CLOCK, undefined, true, undefined, now)
  expect(txt(v(s, 'r-daypart'))).toBe('🌤️ Afternoon')
  expect(txt(v(s, 'r-streak'))).toBe('⚡Streak: 67')
  const sec = Math.floor(now / 1000)
  const cycle = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'][sec % 6]!
  const mood = ['😴', '😅', '🤔', '😎', '🤯', '🥳', '😤', '🤖'][sec % 8]!
  const energy = (sec % 100) + 1
  expect(txt(v(s, 'r-cycle'))).toBe(cycle)
  expect(txt(v(s, 'r-mood'))).toBe(mood)
  expect(txt(v(s, 'r-energy'))).toBe(`⚡${energy}%`)
})

test('morning and evening split at hours 12 and 18', () => {
  const morning = feed(repo.init(), CLOCK, undefined, true, undefined, new Date(2026, 8, 24, 8, 0, 0).getTime())
  expect(txt(v(morning, 'r-daypart'))).toBe('☀️ Morning')
  const evening = feed(repo.init(), CLOCK, undefined, true, undefined, new Date(2026, 8, 24, 19, 0, 0).getTime())
  expect(txt(v(evening, 'r-daypart'))).toBe('🌙 Evening')
})

test('creature by depth and the 5% treasure roll from the clock (E012, E013)', () => {
  const anyDate = new Date(2026, 8, 24, 14, 30, 7).getTime()
  const gemDate = Math.floor(anyDate / 1000 / 20) * 20 * 1000 // an epoch second divisible by 20
  const plainDate = gemDate + 7000 // three rolls away from the treasure second
  const deep = feed(repo.init(), DEPTH_FIND, { code: 0, stdout: Array.from({ length: 12 }, (_, i) => `f${i}.py`).join('\n'), stderr: '' })
  const at120 = feed(deep, CLOCK, undefined, true, undefined, plainDate)
  expect(txt(v(at120, 'r-creature'))).toBe('🐋') // 12 files × 10 = 120m > 100
  const mid = feed(repo.init(), DEPTH_FIND, { code: 0, stdout: Array.from({ length: 7 }, (_, i) => `f${i}.py`).join('\n'), stderr: '' })
  const at70 = feed(mid, CLOCK, undefined, true, undefined, plainDate)
  expect(txt(v(at70, 'r-creature'))).toBe('🐠') // 70m, 50 < depth ≤ 100
  const treasure = feed(deep, CLOCK, undefined, true, undefined, gemDate)
  expect(txt(v(treasure, 'r-creature'))).toBe('💎') // the 1-in-20 roll hits
})

test('deadline countdown to DEADLINE_TIME and OVERTIME past it (E045)', () => {
  let s = repo.init()
  s = feed(s, ENV_SRC, { DEADLINE_TIME: '16:00' }, true, undefined, 0)
  const before = new Date(2026, 8, 24, 14, 30, 0).getTime()
  s = feed(s, CLOCK, undefined, true, undefined, before)
  expect(txt(v(s, 'r-deadline'))).toBe('1h 30m')
  const after = new Date(2026, 8, 24, 17, 0, 0).getTime()
  s = feed(s, CLOCK, undefined, true, undefined, after)
  expect(txt(v(s, 'r-deadline'))).toBe('OVERTIME +1h 0m')
})

test('fps is the named constant, ok with no feed at all (E050)', () => {
  expect(txt(v(repo.init(), 'r-fps'))).toBe('⚡60fps')
})

// ---------------------------------------------------------------- env / system

test('instance number: explicit env wins, config-dir map and the circled glyph follow (E095)', () => {
  let s = repo.init()
  s = feed(s, ENV_SRC, { CLAUDE_INSTANCE_N: '3', TERM_PROGRAM: 'iTerm.app' }, true, undefined, 1)
  expect(txt(v(s, 'r-instance'))).toBe('③')
  const mapSrc = SOURCES.SESSION_INFO
  let s2 = repo.init()
  s2 = feed(s2, mapSrc, { transcript_path: '/Users/m/.claude-next/projects/p/s.json' }, true, undefined, 1)
  s2 = feed(s2, ENV_SRC, { TERM_PROGRAM: 'iTerm.app' }, true, undefined, 1)
  expect(txt(v(s2, 'r-instance'))).toBe('①')
  let s3 = repo.init()
  s3 = feed(s3, ENV_SRC, { CLAUDE_CONFIG_DIR: '/Users/m/.claude-denary' }, true, undefined, 1)
  expect(txt(v(s3, 'r-instance'))).toBe('(10)')
})

test('pane id: kitty window id directly, iterm session id cut after the last colon (E093)', () => {
  let s = repo.init()
  s = feed(s, ENV_SRC, { KITTY_WINDOW_ID: '12' }, true, undefined, 1)
  expect(txt(v(s, 'r-pane'))).toBe('#12')
  let s2 = repo.init()
  s2 = feed(s2, ENV_SRC, { ITERM_SESSION_ID: 'w0t0p0:ABC-123' }, true, undefined, 1)
  expect(txt(v(s2, 'r-pane'))).toBe('#ABC-123')
  expect(v(repo.init(), 'r-pane').state).toBe('nosource')
})

test('directory env variant classifies the working dir name (E061)', () => {
  let s = repo.init()
  s = feed(s, ENV_SRC, { PWD: '/srv/prod-api' }, true, undefined, 1)
  expect(txt(v(s, 'directory', 'r-dir-env'))).toBe('🌍 prod')
  let s2 = repo.init()
  s2 = feed(s2, ENV_SRC, { PWD: '/srv/staging-web' }, true, undefined, 1)
  expect(txt(v(s2, 'directory', 'r-dir-env'))).toBe('🌍 stage')
})

// ---------------------------------------------------------------- neon

const F_DOTENV = SOURCES.F_DOTENV
const NEON_PROBE = SOURCES.NEON_PROBE
const NEON_DNS = SOURCES.NEON_DNS
const NEON_REST = SOURCES.NEON_REST

function neonBase(): S {
  let s = repo.init()
  s = feed(s, F_DOTENV, 'NEON_ENDPOINT=ep.example.com\nNEON_DATABASE=neon-db-123456\nNEON_API_KEY=k\nNEON_PROJECT_ID=p\n')
  return s
}

test('db name is the full value from env or .env; missing names the route (E619)', () => {
  expect(txt(v(neonBase(), 'r-dbname'))).toBe('neon-db-123456')
  expect(v(repo.init(), 'r-dbname')).toEqual({ state: 'nosource', reason: 'NEON_DATABASE не задан ни в env, ни в .env' })
})

test('pool state: connected ✓, sleeping with DNS 💤, sleeping without DNS ✗ (E620)', () => {
  let s = neonBase()
  s = feed(s, NEON_PROBE, { code: 0, stdout: 'connected\n', stderr: '' })
  s = feed(s, NEON_DNS, { code: 0, stdout: 'dns-ok\n', stderr: '' })
  expect(txt(v(s, 'r-pool'))).toBe('pool:✓')
  let s2 = neonBase()
  s2 = feed(s2, NEON_PROBE, { code: 1, stdout: 'sleeping\n', stderr: '' })
  s2 = feed(s2, NEON_DNS, { code: 0, stdout: 'dns-ok\n', stderr: '' })
  expect(txt(v(s2, 'r-pool'))).toBe('pool:💤')
  let s3 = neonBase()
  s3 = feed(s3, NEON_PROBE, { code: 1, stdout: 'sleeping\n', stderr: '' })
  s3 = feed(s3, NEON_DNS, { code: 1, stdout: 'dns-fail\n', stderr: '' })
  expect(txt(v(s3, 'r-pool'))).toBe('pool:✗')
  expect(v(repo.init(), 'r-pool').state).toBe('nosource')
})

test('write activity: MB from written_data_bytes, idle at zero, nosource without keys (E622)', () => {
  let s = neonBase()
  s = feed(s, NEON_REST, { code: 0, stdout: '{"periods":[{"written_data_bytes":3145728}]}', stderr: '' })
  expect(txt(v(s, 'r-write-mb'))).toBe('3MB↑')
  let s2 = neonBase()
  s2 = feed(s2, NEON_REST, { code: 0, stdout: '{"periods":[{"written_data_bytes":0}]}', stderr: '' })
  expect(txt(v(s2, 'r-write-mb'))).toBe('idle')
  expect(v(repo.init(), 'r-write-mb').state).toBe('nosource')
})

// ---------------------------------------------------------------- unity files

const F_PACKAGE = SOURCES.F_PACKAGE
const F_PV = SOURCES.F_PV
const F_EBS = SOURCES.F_EBS
const F_PKGS = SOURCES.F_PKGS
const UNITY_SCENE = SOURCES.UNITY_SCENE

test('mana: package.json present blue, absent white (E034)', () => {
  const blue = feed(repo.init(), F_PACKAGE, '{"name":"x"}')
  expect(txt(v(blue, 'r-mana'))).toBe('🔵')
  const white = feed(repo.init(), F_PACKAGE, '', false, 'absent')
  expect(txt(v(white, 'r-mana'))).toBe('⚪')
})

test('unity scene: first glob hit without the extension, None without scenes (E066)', () => {
  const s = feed(repo.init(), UNITY_SCENE, { code: 0, stdout: 'Assets/Scenes/Level_01.unity\n', stderr: '' })
  expect(txt(v(s, 'r-unity-scene'))).toBe('Level_01')
  const none = feed(repo.init(), UNITY_SCENE, { code: 0, stdout: '', stderr: '' })
  expect(txt(v(none, 'r-unity-scene'))).toBe('None')
})

test('unity version: the dashboard cut of the ProjectVersion row (E067)', () => {
  const content = 'm_EditorVersionWithRevision: 2022.3.21f1 (abc123)\nm_EditorVersion: 2022.3.21f1\n'
  const s = feed(repo.init(), F_PV, content)
  expect(txt(v(s, 'r-unity-version'))).toBe('2022.3')
})

test('unity build target: string search order iPhone, Android, StandaloneWindows, WebGL (E068)', () => {
  const s = feed(repo.init(), F_EBS, '  path: Assets/s.unity\n  platform: iPhone\n')
  expect(txt(v(s, 'r-unity-platform'))).toBe('📱iOS')
  const multi = feed(repo.init(), F_EBS, 'nothing here\n')
  expect(txt(v(multi, 'r-unity-platform'))).toBe('⚙️Multi')
})

test('unity packages manifest presence (E070)', () => {
  const s = feed(repo.init(), F_PKGS, '{"dependencies":{}}')
  expect(txt(v(s, 'r-unity-pkgs'))).toBe('📋Pkgs')
  const none = feed(repo.init(), F_PKGS, '', false, 'absent')
  expect(v(none, 'r-unity-pkgs')).toEqual({ state: 'nosource', reason: 'Packages/manifest.json нет' })
})

// ---------------------------------------------------------------- update cache

const UPDATE_READ = SOURCES.UPDATE_READ

test('update segment only when the cache says newer (E115)', () => {
  const s = feed(repo.init(), UPDATE_READ, { code: 0, stdout: '{"current":"2.1.280","latest":"2.2.0","newer":true}', stderr: '' })
  expect(txt(v(s, 'r-update'))).toBe('⬆ 2.2.0')
  const current = feed(repo.init(), UPDATE_READ, { code: 0, stdout: '{"current":"2.2.0","latest":"2.2.0","newer":false}', stderr: '' })
  expect(v(current, 'r-update')).toEqual({ state: 'pending' })
})

// ---------------------------------------------------------------- kit plans

const KIT_READ = SOURCES.KIT_READ

const GOAL_STATE = '{"plan":"docs/plans/ship-v2.md","queue":["docs/plans/alpha.md","docs/plans/ship-v2.md"],"queueIndex":1}'
const ALPHA_DOC = 'status: complete\n\n## Plan\n## Sections of Work\n### 1. First\n### 2. Second\n## Chapters\n### Chapter 1\nCompleted: 1. First\nNext: 2. Port the widget\n'
const SHIP_DOC = 'status: active\n\n## Sections of Work\n### 1. Ground\n### 2. Ship\n### 3. Verify\n## Chapters\n### Chapter 3\nCompleted: Ground\nNext: finishing\n'

function kitOut(state: string, docs: { rel: string; text: string }[]): string {
  return '@@goal-state@@\n' + state + '\n' + docs.map((d) => `@@doc:${d.rel}@@\n${d.text}`).join('') + '\n'
}

test('armed plan name, sections progress, next pointer (E096–E098)', () => {
  const out = kitOut(GOAL_STATE, [{ rel: 'docs/plans/alpha.md', text: ALPHA_DOC }, { rel: 'docs/plans/ship-v2.md', text: SHIP_DOC }])
  const s = feed(repo.init(), KIT_READ, { code: 0, stdout: out, stderr: '' })
  expect(txt(v(s, 'r-kit-goal'))).toBe('🎯 ship-v2')
  // ship doc: 3 sections, Completed 'Ground' matches section 1 by title → 1/3
  expect(txt(v(s, 'r-plan-sections'))).toBe('Sections: 1/3')
  expect(txt(v(s, 'r-plan-next'))).toBe('(Next finishing)')
})

test('queue walk: stored index stays when the entry is live; heals past finished docs (E099)', () => {
  const out = kitOut(GOAL_STATE, [{ rel: 'docs/plans/alpha.md', text: ALPHA_DOC }, { rel: 'docs/plans/ship-v2.md', text: SHIP_DOC }])
  const s = feed(repo.init(), KIT_READ, { code: 0, stdout: out, stderr: '' })
  expect(txt(v(s, 'r-plan-queue'))).toBe('Plans: 2/2')
  const healedState = '{"plan":"docs/plans/alpha.md","queue":["docs/plans/alpha.md","docs/plans/ship-v2.md"],"queueIndex":0}'
  const s2 = feed(repo.init(), KIT_READ, { code: 0, stdout: kitOut(healedState, [{ rel: 'docs/plans/alpha.md', text: ALPHA_DOC }, { rel: 'docs/plans/ship-v2.md', text: SHIP_DOC }]), stderr: '' })
  expect(txt(v(s2, 'r-plan-queue'))).toBe('Plans: 2/2 ship-v2 (stored 1)')
  const missingState = '{"plan":"docs/plans/gone.md","queue":["docs/plans/gone.md","docs/plans/ship-v2.md"],"queueIndex":0}'
  const s3 = feed(repo.init(), KIT_READ, { code: 0, stdout: kitOut(missingState, [{ rel: 'docs/plans/ship-v2.md', text: SHIP_DOC }]), stderr: '' })
  expect(txt(v(s3, 'r-plan-queue'))).toBe('Plans: 1/2 (unresolvable: unreadable-path)')
})

test('unarmed when the goal state file answers nothing (E100)', () => {
  const s = feed(repo.init(), KIT_READ, { code: 0, stdout: '@@goal-state@@\n\n', stderr: '' })
  expect(txt(v(s, 'r-plan-unarmed'))).toBe('🎯 unarmed')
  const armed = feed(repo.init(), KIT_READ, { code: 0, stdout: kitOut(GOAL_STATE, [{ rel: 'docs/plans/ship-v2.md', text: SHIP_DOC }]), stderr: '' })
  expect(v(armed, 'r-plan-unarmed')).toEqual({ state: 'pending' })
})

// ---------------------------------------------------------------- N rows and the catalogue cover

test('N elements answer nosource with the SPEC table reason verbatim', () => {
  const expect_ = (id: string, reason: string): void => {
    expect(v(repo.init(), id)).toEqual({ state: 'nosource', reason })
  }
  expect_('r-net-lines', 'payload total_lines_* не измерен в mod-API; не заменять git numstat')
  expect_('r-neon-project', 'Neon REST/сетевая проба не имеют объявленного источника у нашего мода')
  expect_('r-neon-storage', 'consumption_history Neon отсутствует среди объявленных источников мода')
  expect_('r-cf-state', 'Cloudflare deployments REST не имеет объявленного адаптера в моде')
})

test('ui kinds names the missing contract feed until the core owns one (E613)', () => {
  const got = v(repo.init(), 'r-ui-kinds')
  expect(got.state).toBe('nosource')
  expect((got as { reason: string }).reason).toContain('ui.render')
})

test('every C row of the T-git range lands in exactly one element or variant', () => {
  const own = new Set<string>()
  for (const el of repo.elements) {
    if (el.outcome === 'N') continue
    for (const c of el.catalogue) own.add(c)
    for (const variant of el.variants) for (const c of variant.catalogue ?? []) own.add(c)
  }
  for (const vf of repo.variantsFor ?? []) for (const variant of vf.variants) for (const c of variant.catalogue ?? []) own.add(c)
  const expected = new Set<string>()
  const ranges: [number, number][] = [[5, 13], [33, 34], [45, 52], [61, 61], [66, 70], [78, 89], [93, 93], [95, 100], [115, 115], [580, 586], [590, 592], [613, 614], [616, 622]]
  for (const [a, b] of ranges) for (let n = a; n <= b; n++) expected.add('E' + String(n).padStart(3, '0'))
  expect(own).toEqual(expected)
  const ownN = new Set<string>()
  for (const el of repo.elements) if (el.outcome === 'N') for (const c of el.catalogue) ownN.add(c)
  const nRows = new Set<string>()
  const nRanges: [number, number][] = [[4, 4], [53, 60], [62, 65], [90, 92]]
  for (const [a, b] of nRanges) for (let n = a; n <= b; n++) nRows.add('E' + String(n).padStart(3, '0'))
  expect(ownN).toEqual(nRows)
})

test('variants registered for base ids carry their own catalogue rows', () => {
  const branch = repo.variantsFor?.find((x) => x.element === 'branch')
  expect(branch?.variants.map((x) => x.id)).toEqual(['r-flow', 'r-upstream'])
  expect(branch?.variants.flatMap((x) => x.catalogue ?? [])).toEqual(['E078', 'E580'])
  const dir = repo.variantsFor?.find((x) => x.element === 'directory')
  expect(dir?.variants[0]?.catalogue).toEqual(['E061'])
})

test('cmd refusals on first feed leave git counts pending, never zero', () => {
  const s = feed(repo.init(), GIT_STATUS, { code: 1, stdout: '', stderr: 'odd' }, false, 'boom')
  expect(v(s, 'r-dirty-counts')).toEqual({ state: 'pending' })
  expect(v(s, 'r-change-count', 'with-untracked')).toEqual({ state: 'pending' })
})
