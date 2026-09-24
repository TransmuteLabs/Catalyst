# catalyst-statusline

Catalyst packaging of the ClaudeCodeMods `statusline` mod (konsta95, MIT, upstream
0.3.2 at `c49ad4a`; licence in `LICENSE-ClaudeCodeMods`). Install:
`claude plugin install catalyst-statusline@catalyst`. The mod needs function hooks
enabled (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`). Options live in `/config`; the
picker is `/statusline-mod`. Everything below is the upstream README.

## statusline (upstream)

[ClaudeCodeStatusline](https://github.com/konsta95/ClaudeCodeStatusline) as a
function-hook mod. The shell version is a `statusLine` command that Claude Code spawns
on every status-line update (a new assistant message is one trigger among session
start, `/compact`, permission-mode and vim-mode changes and timers, debounced at
300 ms), feeding it a JSON payload on stdin and printing the line it returns under the
prompt. This version runs inside the process: a `ui.render` hook on the `PromptHint`
site, the dim hint line under the prompt where the shell line drew, builds the same
segments from the session's own nouns (`$.session.cwd()`, `repo()`, `model()`,
`usage()`, `id()`), so there is no process to spawn and no payload to parse. Each
segment reveals its details when the pointer is over it, and `/statusline-mod` picks
the segments, their order and the options.

## What it draws

One row: the chosen segments separated by `|` and painted in the chosen scheme, then
the engine's own hint (`? for shortcuts`, `esc to interrupt`) dim after them. Claude
Code draws its own pills, such as the permission mode, to the left of the bar.

| Segment | On by default | Drawn as | Detail on hover |
| --- | --- | --- | --- |
| git branch | yes | `repo(branch)` from the nearest `.git/HEAD` (worktree `.git` files followed, at most 12 levels up); the directory name when there is no repository | repository, branch, GitHub `owner/name` from the remote, and the cwd |
| directory | no | the name of the current directory | the full path |
| branch | no | the branch alone | the branch and its repository |
| github | no | `owner/name` from the GitHub remote | the same |
| model | yes | the display name derived from the model id with its spaces removed, as the shell version prints it (`claude-opus-5-5[1m]` reads `Opus5.5`), then the effort level once a main-loop `turn.step` has carried one | the model id and the effort level |
| context | yes | `used/window` tokens, coloured by the percentage used | the token count and the percentage |
| 5h | yes | percentage of the five-hour window used | the exact percentage and when it resets |
| 7d | yes | percentage of the seven-day window used | the same for the weekly window |
| session | yes | the session id | the id, which is also the transcript file name |
| cost | yes | `$0.00` once the session has cost anything | the cost to four decimals |

A segment whose noun failed is drawn dim as `<id>!` with the error in its detail; a
segment with nothing to show yet (no cost, no rate-limit window) is left out. With
every segment off, the hint line is passed through unchanged.

With `details` on, hovering a segment shows its detail on a one-row card over the row
above the bar, which in the fullscreen UI is the prompt box's bottom rule, starting at
the bar's first column. The card is placed out of the layout, so showing it moves
nothing on screen.

The bar is rebuilt after `session.start`, as every model request of the main loop
goes out (`turn.step`, while the request is in flight, so the request waits for
nothing), after every `turn.complete`, after `/model`, `/compact` and `/clear` return,
and after the model row of `/config` is written. Once each main-loop response has
arrived, the bar reads the usage again, one call before the response's tools run, so
the context the response was answered over, the rate limits and the cost show while
those tools run. The classic command showed them at the same point, because Claude Code
re-ran it on every new message. A model switch shows at the latest from the first
request after it. A subagent's request changes nothing on the bar: it names its own
model and effort, not the session's. Rebuilds overlap, and one that finishes after a
newer one is dropped.

## /statusline-mod

In an interactive session `/statusline-mod` opens a picker in the band directly above
the prompt, across its full width, where Claude Code draws its own surveys: a preview
of the bar, a row per segment, the chosen ones first in their order and then the rest,
and the options. The line under the prompt follows every change at once.

| Key | Pressed in | Does |
| --- | --- | --- |
| `1` to `0` | the empty prompt or the band | toggles the segment on that row |
| ctrl+x tab | the prompt | gives the band the keys, with the focus on the first row |
| ↑ ↓ | the band | walk the rows and the options, wrapping at either end |
| Enter | the band | presses the row or option in focus |
| `u` `d` | the band | move the segment that last had the focus up or down |
| `s` `h` `p` | the band | the next scheme, hover details on or off, the pinned copy on or off |
| `r` | the band | resets the segments |
| `q` | the band | closes the picker |
| Esc | the band | gives the keys back to the prompt and leaves the picker open |

A toggled segment moves to the end of the chosen ones or back among the rest, and `u`,
`d` and reset move rows too; through each of these the focus stays on the segment it
was on. With the focus on Move up or Move down, Enter moves the same segment again. The
picker closes with `q` or when a prompt is sent, stays open through the module reloads
an option change causes, and is not drawn in another session. In a band too short for
a row per segment the segments are laid out in a grid without their descriptions, and
the footer is drawn while it fits.

The chosen segments and their order are kept in the plugin's store and persist across
sessions. The options are the plugin's own `/config` rows: the picker writes them, and
Claude Code reloads the mod with the new value.

`/statusline-mod show` prints the current line and options, and `/statusline-mod reset`
restores the default segments. In a non-interactive session the bare command prints
what `show` prints.

## Options

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scheme` | `claude-code`, `codex` or `mono` | `claude-code` | The palette. `claude-code` uses the hues the shell version copied from the theme; `mono` paints nothing and dims every segment. |
| `details` | boolean | `true` | Reveal a segment's details on hover. Needs the fullscreen terminal UI with mouse tracking. |
| `pin_status` | boolean | `false` | Also pin the bar as plain text under the prompt through `$.ui.status`, where no hover is needed. |

Run it from a clone with

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir mods/statusline

The mod neither reads nor changes the `statusLine` setting. To use it in place of the
shell version, remove the `statusLine` entry from `settings.json`.

## Measured

Claude Code 2.1.280, 2026-09-22. The mod rows come from three sessions, each on
Opus 5.5 in a 140 by 40 tmux pane with one short turn: two in the fullscreen UI and one
in the classic UI. The shell row is three runs of 30 spawns of the classic command
with a fixed payload on 2026-09-21.

| What | Value |
| --- | --- |
| Bar on screen after the process was spawned | 2.0 to 2.6 s (the screen was read every 0.5 s) |
| First render after `session.start` | 183 to 508 ms |
| Cold gather of the nouns, twice at start | 120 to 318 ms |
| Warm gather after a turn | 16 to 42 ms |
| Usage read once a response has arrived | 0.53 and 0.73 ms, against 31.2 and 28.4 ms for the whole gathers as the same two requests went out (one Haiku 4.5 probe session) |
| Render of the hint line | median 0.47 ms, 0.21 to 11.13 ms, across 21 renders |
| Shell version, one `statusLine` spawn | 132.4 ms median of 30, with 122.0 and 137.1 ms in two other runs of 30 (bare `node` spawn 119.4 ms median of 30); paid on every status-line update, asynchronously and off the renderer's path, so not on the same clock as the render row |
| Kit, one run from this repository | first mount 91.1 ms, 200 cached renders median 1.41 ms, p90 2.07 ms, max 12.1 ms |

The hover reveal was observed in both fullscreen sessions. With all seven default
segments on the bar, the pointer was moved to the middle of each segment by writing
SGR mouse reports into the pane. Each position showed that segment's detail and no
other, on the row above the bar, and the bar stayed on the last row. With the pointer
off the bar, before and after, no detail was shown. The one other row that changed was
the engine's notice line, whose tmux focus-events notice was also on screen with the
pointer off the bar. The same sweep over the previous build, which laid the details
out in the hint line itself, showed the detail of three of the seven segments: each
reveal wrapped that line and shifted the bottom 15 rows of the screen, taking the bar
from under the pointer.

In the classic scrolling UI (`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`) the bar is drawn
in the same line, but tmux reported no mouse mode enabled by Claude Code, where the
fullscreen sessions had any-motion and SGR reporting on. No pointer position reaches
the session there, so nothing reveals.

The model switch was measured on 2026-09-22 in four Haiku 4.5 sessions in a 140 by 40
pty, driven by `claude_live_probe`, two on this build and two on 0.2.0. After
`/model sonnet` this build redrew the bar as `Sonnet5`, where 0.2.0 redrew it as
`Haiku4.5`. In a turn of two model requests, a file read and then the answer, this
build redrew the context as `37K/200K` after the read and before the answer, where 0.2.0
kept `0/200K` until the turn ended.

The context during a response's tools, `/clear` and `/compact` were measured the same
day in eight more such sessions, four on this build and four on 0.2.1. In a turn whose
first response ran `sleep 20`, this build showed `42K/200K` and the cost for the whole
sleep, where 0.2.1 showed `0/200K` until the next request went out. On forks of that
conversation, `/clear` made this build show `0/200K` and the new session id, where 0.2.1
kept `42K/200K` and the old id. After `/compact` both builds kept `42K/200K`, because the
engine goes on reporting the last response's figure; this build showed the cost growing
from $0.09 to $0.10 with the compaction's own request, and 0.2.1 kept $0.09.

The picker was driven on 2026-09-22 in Haiku 4.5 sessions on a 280 by 69 pty, the
owner's fullscreen layout, recording after each key the cells drawn inverted, which is
where the focus is. There the pane of 0.2.2 docked beside the transcript, and once its
Scheme select had the focus, ↓ cycled the schemes and the two options after it were
never reached. In the band, ↓ walked the ten rows and the seven options and wrapped.
`u`, `u`, `d`, `d` moved the context segment and the focus stayed on it at each new
row, as it did through a toggle off and back on, a digit toggling another row, and a
reset. A digit typed into the empty prompt toggled its row, and the next key typed
reached the prompt. `q` closed the picker, and so did sending a prompt. On a 100 by 30
pty the band drew the grid with the footer, and the digits and the focus worked the
same.

Two engine behaviours shaped the picker (2.1.280). After a module reload the engine
asked for the band twice before the first draw was done; in 11 of 15 runs that reloaded
the module, every press on the band was dropped afterwards while the focus still moved.
The mod finishes the band's draws in the order they began, and presses then survived
the reload in 5 of 5 such runs and in all four reloads of the final runs. And the focus
keeps its place in the band rather than its element: a plugin's `$.ui.focus` lands on
the element where the band shows it before the redraw a press asked for, so the mod
draws the segment the focus was on under a key no drawing had yet, which the engine
waits for (13 ms in a probe), and the focus lands on the redrawn row.

The line under the prompt was recorded frame by frame on 2026-09-22 and 2026-09-23, in
Haiku 4.5 sessions on a 280 by 69 pty whose output was replayed through a terminal
emulator. Each time Claude Code 2.1.280 dispatches a hooked hint line again, for a change
of its props or a redraw the plugin asked for, one frame draws the engine's own hint row
with the bar drawn last on the row below it, pushing the prompt up a row, before the new
answer puts the bar back beside the pill: a copy of the bar one row down, for one frame.
In a turn of six tool calls, a session with no hook on the line drew no such frame in two
runs, and a hook drawing fixed text that never asked for a redraw drew one at each change
of the engine's hint, among them the first key typed into the empty prompt during a
streamed turn. 0.3.0 asked for a redraw after every refresh, two per model request, and
the six-tool turn drew 16, 8 of them with nothing on the bar changed. This build asks only
when what the bar draws has changed: the same turn drew 7 in a copy carrying the change
and 9 on this build. The 2 in the second changed no cell of the bar, and without the mod's
redraws that turn drew none mid-turn, so by elimination they were a hover card's figures,
the exact tokens or the cost to four places. Typing during a streamed turn drew 6 on 0.3.0
and 5 on this build: three at hint changes, one at a figure's change, and one at the
turn's end with the bar unchanged, which the fixed-text hook drew too.

The context after an interrupted turn was measured on 2026-09-23 in the same kind of
Haiku 4.5 sessions, with every read the mod made traced. When Esc interrupted a turn,
`turn.complete` came with `isAborted` true and the engine answered `$.session.usage()` with
the window and no token count, 41 ms after the read at the step's end had 37,105; its
typings keep a missing count for a fresh or just-compacted window. In the same situation
the engine's classic status line payload kept `total_input_tokens` at 37,191. 0.3.0 and
0.3.1 drew the missing count as `0/200K` until the next response, in 6 of 6 interrupted
runs (three each) and none of 6 finished ones. This build keeps the figure on the bar after an interrupted turn: the
next interrupted run kept `37K/200K` until the next prompt, as did a run left to finish.

## Limits

- Hover is applied by the terminal surface. No hook runs when the pointer moves, so
  the mod cannot observe or log a reveal, and the kit cannot test one; the kit tests
  check the tree (every segment names a scope, each scope has a card placed out of
  the layout over the row above, a malformed hover tree is refused).
- A card is one row. Claude Code clips an absolutely placed box at the edge of its
  region, so a detail longer than the room from the bar's first column to the right
  edge of the terminal is cut off there.
- The mods API gives the model id only; the display name is derived from it, and an
  id that is not `claude-*` is shown as it came.
- The effort level is unknown until the first `turn.step`. The `/config` rows are
  read once in case one carries it; in each measured session none of the 43 rows did.
- After `/compact` the context keeps the figure of the last response until the next
  one arrives, because that is the figure the engine reports (measured on 2.1.280). The
  types describe it as the status line's own `total_input_tokens`.
- A switch made in the `/model` picker was not observed live, because the probe types
  one line and cannot pick an entry. If `command.run` resolves before the pick, the bar
  keeps the old model until the next model request redraws it.
- `PROBE_RUN` in the environment makes `turn.complete` write a JSON timing dump, under
  `out/<PROBE_RUN>` unless `PROBE_OUT` names another directory. Both exist for
  measurement and are otherwise inert.
- The picker draws in the band above the prompt, which Claude Code raises on the
  terminal only, as it does the hint line the bar draws in.
- A plugin cannot give the band the keys (2.1.280 answers `that site does not hold the
  keyboard`), so the picker opens with the keys in the prompt: the digits work from
  there, the arrows and Enter after ctrl+x tab, as the picker's footer says.
- While the picker is open, a digit typed first into the empty prompt toggles a row,
  as a survey's digits do. The picker closes once a prompt is sent.
- The rows are re-sorted after a toggle, the chosen segments first, so after one a
  digit may name another segment.
- The kit has no implementation of a plugin's own `$.ui.focus` (2.1.280: the call
  throws, and the test's `on('ui.focus')` never sees it). The kit checks that the
  segment is drawn under a new key; the focus landing on it was observed live.
- The typings say a tree taller than the band scrolls and arms no digit. At 100
  columns the grid needs six rows, eight with the footer, and a shorter band scrolls it.
- Each change of the engine's hint still shows the copy of the bar one row down for a
  frame: the first key typed into the empty prompt during a turn, sending a prompt, and
  the turn's end. A hook cannot avoid it, since one drawing fixed text shows it too; only
  Claude Code can. It is reported on the mods feedback thread,
  https://github.com/anthropics/claude-code/issues/91870#issuecomment-5790602695.
- A change to a hover card's figures alone still asks for a redraw, so the cards stay
  current, and costs that frame too.
- After an interrupted turn the next request still shows `0/200K` until its response
  arrives, since the engine has no count then either: the screen read 0.8 s after the prompt
  was sent showed it, and the one 0.8 s later showed the new figure. A finished turn,
  `/clear` and `/compact` show what the engine reports.
