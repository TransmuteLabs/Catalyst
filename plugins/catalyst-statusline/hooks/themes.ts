// The theme registry (DESIGN Р6). A theme fixes every view axis plus a
// palette by slots. CONSTRAINT: palette values are copied VERBATIM from
// CATALOGUE-view-43.md («Палитры: дословные значения новых носителей»,
// «ClaudeCodeMods/codex, claude-code, mono»); the slot mapping is ours.
// Theme names in the registry are English; the picker shows them as they are.

export type Pal = {
  model?: string
  path?: string
  branch?: string
  github?: string
  label?: string
  session?: string
  cost?: string
  sep?: string
  ok?: string
  mid?: string
  high?: string
  fresh?: string
  fast?: string
  agents?: string
  tools?: string
  dim?: string
}

export type ThemeDef = {
  // every THEME_AXIS resolved; the axis fields take 'theme' off this map
  axes: Record<string, string>
  palette: Pal
}

// flowpane/catppuccin (theme.ts:83–94)
const catppuccin: Pal = {
  model: '#89b4fa', path: '#cdd6f4', branch: '#a6e3a1', github: '#cba6f7', label: '#7f849c',
  session: '#94e2d5', cost: '#a6e3a1', sep: '#7f849c', ok: '#a6e3a1', mid: '#f9e2af', high: '#f38ba8',
  fresh: '#a6e3a1', fast: '#f9e2af', agents: '#94e2d5', tools: '#89b4fa', dim: '#7f849c',
}
// flowpane/nord (theme.ts:109–120)
const nord: Pal = {
  model: '#88c0d0', path: '#e5e9f0', branch: '#a3be8c', github: '#b48ead', label: '#7b889c',
  session: '#8fbcbb', cost: '#a3be8c', sep: '#7b889c', ok: '#a3be8c', mid: '#ebcb8b', high: '#bf616a',
  fresh: '#a3be8c', fast: '#ebcb8b', agents: '#8fbcbb', tools: '#88c0d0', dim: '#7b889c',
}
// flowpane/gruvbox (theme.ts:96–107)
const gruvbox: Pal = {
  model: '#83a598', path: '#ebdbb2', branch: '#b8bb26', github: '#d3869b', label: '#928374',
  session: '#8ec07c', cost: '#b8bb26', sep: '#928374', ok: '#b8bb26', mid: '#fabd2f', high: '#fb4934',
  fresh: '#b8bb26', fast: '#fabd2f', agents: '#8ec07c', tools: '#83a598', dim: '#928374',
}
// flowpane/tokyo-night (theme.ts:70–81)
const tokyo: Pal = {
  model: '#7aa2f7', path: '#dfe3ea', branch: '#4cc38a', github: '#a88fd6', label: '#7b8492',
  session: '#5fa8b8', cost: '#4cc38a', sep: '#7b8492', ok: '#4cc38a', mid: '#f2b33d', high: '#f2635f',
  fresh: '#4cc38a', fast: '#f2b33d', agents: '#5fa8b8', tools: '#7aa2f7', dim: '#7b8492',
}
// flowpane/dracula (theme.ts:122–133)
const dracula: Pal = {
  model: '#bd93f9', path: '#f8f8f2', branch: '#50fa7b', github: '#ff79c6', label: '#6272a4',
  session: '#8be9fd', cost: '#50fa7b', sep: '#6272a4', ok: '#50fa7b', mid: '#f1fa8c', high: '#ff5555',
  fresh: '#50fa7b', fast: '#f1fa8c', agents: '#8be9fd', tools: '#bd93f9', dim: '#6272a4',
}
// flowpane/solarized (theme.ts:135–146)
const solarizedDark: Pal = {
  model: '#268bd2', path: '#93a1a1', branch: '#859900', github: '#6c71c4', label: '#586e75',
  session: '#2aa198', cost: '#859900', sep: '#586e75', ok: '#859900', mid: '#b58900', high: '#dc322f',
  fresh: '#859900', fast: '#b58900', agents: '#2aa198', tools: '#268bd2', dim: '#586e75',
}
// flowpane/solarized-light (theme.ts:220–231)
const solarizedLight: Pal = {
  model: '#268bd2', path: '#586e75', branch: '#859900', github: '#6c71c4', label: '#93a1a1',
  session: '#2aa198', cost: '#859900', sep: '#93a1a1', ok: '#859900', mid: '#b58900', high: '#dc322f',
  fresh: '#859900', fast: '#b58900', agents: '#2aa198', tools: '#268bd2', dim: '#93a1a1',
}
// claude-hud colors (DATA-claude-hud §Ось 3): label dim, context green,
// model cyan, project yellow, git magenta, gitBranch cyan, warning/critical
const hudPal: Pal = {
  model: 'cyan', path: 'yellow', branch: 'cyan', github: 'magenta', label: 'dim',
  session: 'dim', cost: 'green', sep: 'dim', ok: 'green', mid: 'yellow', high: 'red',
  fresh: 'green', fast: 'yellow', agents: 'cyan', tools: 'cyan', dim: 'dim',
}
// ClaudeCodeMods statusline SCHEMES (SL:34–61), verbatim
const codex: Pal = {
  path: 'green', branch: 'magenta', github: 'magenta', label: 'magenta', model: '#d77757',
  session: 'white', cost: 'green', ok: 'green', mid: 'yellow', high: 'red', fresh: 'green', fast: 'dim',
}
const claudeCode: Pal = {
  path: '#4782c8', branch: '#af87ff', github: '#b1b9f9', label: '#b1b9f9', model: '#d77757',
  session: '#999999', cost: '#4eba65', sep: '#505050', ok: '#4eba65', mid: '#ffc107', high: '#ff6b80',
  fresh: '#4eba65', fast: '#ff6a00',
}
const monoPal: Pal = {}

const T = (axes: Record<string, string>, palette: Pal): ThemeDef => ({ axes, palette })

export const THEMES: Record<string, ThemeDef> = {
  // the default: the claude-hud look — dim labels, green bars, plain segments
  hud: T(
    { shape: 'plain', caps: 'none', glyphs: 'unicode', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'hud', thresholds: '50,75', face: 'label=dim', border: 'none', overflow: 'evict', separator: ' │ ', align: 'left' },
    hudPal,
  ),
  powerline: T(
    { shape: 'powerline', caps: 'arrow', glyphs: 'nerd', fill: 'segment', bar: 'blocks', barWidth: 'adaptive', palette: 'codex', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: '', align: 'left' },
    codex,
  ),
  pill: T(
    { shape: 'pill', caps: 'round', glyphs: 'nerd', fill: 'segment', bar: 'blocks', barWidth: 'adaptive', palette: 'codex', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: '', align: 'left' },
    codex,
  ),
  'catppuccin-mocha': T(
    { shape: 'plain', caps: 'none', glyphs: 'unicode', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'catppuccin-mocha', thresholds: '50,75', face: 'label=dim', border: 'none', overflow: 'evict', separator: ' │ ', align: 'left' },
    catppuccin,
  ),
  nord: T(
    { shape: 'plain', caps: 'none', glyphs: 'unicode', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'nord', thresholds: '50,75', face: 'label=dim', border: 'none', overflow: 'evict', separator: ' │ ', align: 'left' },
    nord,
  ),
  'gruvbox-dark': T(
    { shape: 'plain', caps: 'none', glyphs: 'unicode', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'gruvbox-dark', thresholds: '50,75', face: 'label=dim', border: 'none', overflow: 'evict', separator: ' │ ', align: 'left' },
    gruvbox,
  ),
  'tokyo-night': T(
    { shape: 'plain', caps: 'none', glyphs: 'unicode', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'tokyo-night', thresholds: '50,75', face: 'label=dim', border: 'none', overflow: 'evict', separator: ' │ ', align: 'left' },
    tokyo,
  ),
  dracula: T(
    { shape: 'plain', caps: 'none', glyphs: 'unicode', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'dracula', thresholds: '50,75', face: 'label=dim', border: 'none', overflow: 'evict', separator: ' │ ', align: 'left' },
    dracula,
  ),
  'solarized-dark': T(
    { shape: 'plain', caps: 'none', glyphs: 'unicode', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'solarized-dark', thresholds: '50,75', face: 'label=dim', border: 'none', overflow: 'evict', separator: ' │ ', align: 'left' },
    solarizedDark,
  ),
  // the one light theme
  'solarized-light': T(
    { shape: 'plain', caps: 'none', glyphs: 'unicode', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'solarized-light', thresholds: '50,75', face: 'label=dim', border: 'none', overflow: 'evict', separator: ' │ ', align: 'left' },
    solarizedLight,
  ),
  mono: T(
    { shape: 'lean', caps: 'none', glyphs: 'none', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'mono', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: ' ', align: 'left' },
    monoPal,
  ),
  minimal: T(
    { shape: 'lean', caps: 'none', glyphs: 'none', fill: 'none', bar: 'shade', barWidth: 'adaptive', palette: 'mono', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: ' ', align: 'left' },
    monoPal,
  ),
  classic: T(
    { shape: 'classic', caps: 'none', glyphs: 'none', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'claude-code', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: ' │ ', align: 'left' },
    claudeCode,
  ),
  'claude-code': T(
    { shape: 'classic', caps: 'none', glyphs: 'none', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'claude-code', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: '|', align: 'left' },
    claudeCode,
  ),
  codex: T(
    { shape: 'classic', caps: 'none', glyphs: 'none', fill: 'none', bar: 'blocks', barWidth: 'adaptive', palette: 'codex', thresholds: '50,75', face: '', border: 'none', overflow: 'evict', separator: '|', align: 'left' },
    codex,
  ),
}

export const THEME_NAMES: string[] = Object.keys(THEMES)

export const THEME_AXES = ['shape', 'caps', 'glyphs', 'fill', 'bar', 'barWidth', 'palette', 'thresholds', 'face', 'border', 'overflow', 'separator', 'align'] as const

// Every palette the axes can name; slot tables live here (0.4.0 carried the
// same tables; the named themes add theirs verbatim).
export const PALETTES: Record<string, Pal> = {
  semantic: { ok: 'green', mid: 'yellow', high: 'red' },
  mono: monoPal,
  codex,
  'claude-code': claudeCode,
  hud: hudPal,
  'catppuccin-mocha': catppuccin,
  nord,
  'gruvbox-dark': gruvbox,
  'tokyo-night': tokyo,
  dracula,
  'solarized-dark': solarizedDark,
  'solarized-light': solarizedLight,
}
