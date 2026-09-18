# catalyst-probes — consultation engine

The module is the core. Consultants are rows in `~/.claude/probes/probes.toml`.
A new consultant is a `[probe.<id>]` table plus `~/.claude/probes/<id>/prompt.md`.
It is not a new plugin. The host loads one hooks module per plugin; this plugin
is that one module.

Companion: kit `docs/probe-core.md`, `docs/probe-registry-spec.md` (vocabulary).
Live home of this source: `TransmuteLabs/Catalyst` `plugins/catalyst-probes/`.
The patch kit does not ship the live plugin.

## Arming

```
claude plugin marketplace add TransmuteLabs/Catalyst
claude plugin install catalyst-probes@catalyst
```

`~/.claude/settings.json`:

```
env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
env.CLAUDE_JUDGE_CARRIER=mod
env.CLAUDE_FORM_CARRIER=mod
env.CLAUDE_IDLE_CARRIER=mod
enabledPlugins["catalyst-probes@catalyst"]=true
```

`CLAUDE_JUDGE` / `CLAUDE_IDLE` empty = off (same as the splices).
`CLAUDE_FORM` empty = on. `CLAUDE_PROBES` empty = on (new consultants only).
Without `CLAUDE_*_CARRIER=mod` the matching splice-backed probe is inert here
and the splice keeps running.

Acceptance of a load is the debug line
`hooks module catalyst-probes loaded (worker, environment 1, tier user)`
plus `$ built for catalyst-probes`. A green `plugin validate` is not
acceptance.

## Adding a consultant

In `probes.toml` (global home, or `<project>/.claude/probes/probes.toml`):

```toml
[probe.model-coverage]
enabled = true
kind = "consult"          # default
act = "log_only"          # default for a new id; voice is granted later
rx = "SILENT|NUDGE"
cooldown_min = 60

  [probe.model-coverage.when]
  field = "live_works"
  count_below = 1
```

And `~/.claude/probes/model-coverage/prompt.md`. Reload plugins, do not
rebuild the binary, do not add a plugin.

`act`: `log_only` | `nudge` | `cancel`. New ids default to `log_only`
(incubation; false blocks absent by construction).
`rx`: first-line vocabulary, same parser as the judge.
`when`: closed predicate vocabulary (`equals`, `in`, `matches`,
`count_below`, `count_at_least`, `older_than_min`, `newer_than_min`,
`absent`, `present`, `all`, `any`, `not`). A missing `when` on a new id
does not fire (`skip_no_when`). Built-in ids have implicit triggers so the
live toml does not need the new keys.

`kind = "form"` is the deterministic rule probe (id `form` today). It is
not a consultation.

## Authoring a prompt

`[prompt.<id>]` tables in the same `probes.toml` author the host's own
texts at runtime. Exactly one target per table:

```toml
[prompt.house-style]
section = "communication:L"   # or tool = "Read", or command = "commit"
mode    = "append"            # append (default) | prepend | replace
text    = "One short rule."   # or text_file = "house-style.md"
when_env = "CLAUDE_JUDGE"     # optional gate, see below
enabled = true
```

`text_file` resolves against `<probes home>/prompts/`. A rule that
applies writes `<probes home>/prompts/records/applied-<id>.json` — that
record is the acceptance, nothing is printed to the chat.

Reach measured live on 2.1.267 (the model printed the planted tokens):
26 sections of the main-loop system prompt, 24 tool descriptions, 254
command descriptions. NOT re-measured since the supported floor rose to
2.1.270: these are that day's figures on that day's bundle, not a claim
about the floor version — a section or description count is exactly the
kind of figure an upstream bundle moves without announcing it.

A subagent's assembly is NOT the main loop's, and the three targets differ
there — measured by clock-stamping every firing of a dispatching run:

| target | main loop | subagent assembly |
|---|---|---|
| `section` | 26 | 1 (`env_info_model` only) |
| `tool` | every tool | the subagent's own tools (`Read`, `Bash` for a scout) |
| `command` | 254 | none |

So a **section** rule cannot reach a subagent, while a **tool** rule
reaches every agent that holds that tool. Write tool rules for both
readers, or gate them.

A repeated firing does NOT compound: in a dispatching run `Bash` was
described twice and both firings carried the ORIGINAL text
(`chars_before` equal, zero markers already present), so an `append` rule
adds its text once per assembly, never twice.

`when_env` SELECTS among the env names the module already reads —
`CLAUDE_JUDGE`, `CLAUDE_IDLE`, `CLAUDE_FORM`, `CLAUDE_PROBES`,
`CLAUDE_PROMPTS`. Any other name is refused and the rule does not fire
(a typo must not let text through ungated). `CLAUDE_PROMPTS` empty = on,
`0`/`off`/`false` disables the whole layer.

`dispatch-rule` is a built-in table: the judge's cancellation rule, same
text and same gate as splice 26 (`carrier=mod` plus `CLAUDE_JUDGE` on). A
table of that id may retarget, change its mode or disable it; it cannot
strip the gate.

This layer replaces nothing in the image. Measured 2026-09-12: of the 901
prompt overlays in the tweakcc home, **zero** carry our text (class
control passing — splice 26's own rule text is present in the live image
and absent from the pristine twin). There was never anything to port.

## Built-in ids (live toml without `on`/`act`/`rx`)

| id | trigger | act | rx |
|---|---|---|---|
| `judge` | main-loop Agent/Task | cancel (await, then run or deny) | OK\|WARN\|BLOCK\|STOP\|DENY |
| `idle-watch` | main-loop, no live work, cooldown | nudge | SILENT\|NUDGE |
| `form` | main-loop Write/Edit/Bash/Agent/Task/SendMessage | per-class `[probe.form.act]` | rules |

A project layer may disable one (`enabled = false`), override keys, or
add a new id. `CLAUDE_PROBES_DIR` disables layering.

## What the core does not do

- It does not raise the 10 s host budget (unpatchable; bytecode).
- It does not move the proxy splices.
- `act: cancel` is the splice: await the consult, then `next(e)` on
  OK/WARN or `{deny: reason}` on BLOCK/NONE. No PENDING, no retry of
  the same call. `$.ui.log` is not used for verdicts.
- `$.fs.write` overwrites. Index lines go to `journal.jsonl.shard.<rec>`.

## Journal

`~/.claude/probes/<id>/journal.jsonl` via shards;
`~/.claude/probes/<id>/records/mod-*.json` are the durable records.

## Host clock (2026-09-15)

`$.clock.now()` is awaited, and read through `nowMs($)` and nowhere else. The
host clock became ASYNCHRONOUS: on 2.1.270 the call returned a number, on 2.1.272
it returns a promise (measured with the clock-probe mod: `[object Promise]`,
`JSON.stringify` gives `{}`, and after `await` it is milliseconds). An unawaited
call does not fail — it silently hands back the promise object: every record
written after the binary was swapped carries `"t0":{}` and `"dtMs":null`, while
records from the minutes before it carry milliseconds. Arithmetic on that value
yields NaN silently — the duration
became null, the world memo window never closed (so the per-call file reads the
memo exists to avoid came back), and `new Date(x).toISOString()` threw inside the
journal block, where a silent `catch` swallowed it. The shard was then never
written: 42 records lost their journal line, and every one of them had `t0:{}`
while all 179 records with a numeric `t0` kept theirs.

`nowMs` awaits the host clock, validates what comes back, and falls back to
`Date.now()` only if that is still unusable — marking the record with `clockBad`
so the fallback is never invisible. The journal `catch`
now appends its reason to the already-written record (`journalErr`) instead of
staying mute — losing a line used to be detectable only by comparing two homes,
which is exactly what hid this defect.

This is a surface change on the upstream side, not a broken host: returning a
promise is a legitimate shape, and the caller is the one that has to wait for it.
The probe that established this lives in the session scratchpad (clock-probe):
one mod, one file, run against both images.

## Own truncation of model replies

`raw_<model>` is cut at 2000 chars and the pre-cut length is kept in
`rawLen_<model>`. At the previous cut of 500 the median non-empty reply of the
lower rungs was exactly 500 — a ceiling of the INSTRUMENT is indistinguishable
from a ceiling of the MODEL, and the baseline for the token-cap work was
unusable.

## Why an empty reply is three different worlds

`$.model.complete` hands the mod only the CONCATENATION of the text blocks
(measured in the image's bytes: a flatMap over `content` keeping `type ===
"text"`), so an empty string means one of three things and the mod could not
tell them apart: the model stayed silent, the reply consisted of non-text
blocks (thinking / tool_use), or the reply was cut off at the token ceiling.
The patch's step 31 therefore accepts `detail: true` and returns the full
envelope `{text, stopReason, blocks:[{type,len}], usage}` from the same point
where the text was being flattened.

The mod asks for `detail` ALWAYS. An image WITHOUT step 31 does not know the
field and returns the old string, so `readComplete` (a pure exported function —
the call site lives behind `$` and no tooth reaches it) accepts both forms and
reports which one it saw. The record carries `detail_<model>`, `stop_<model>`,
`blocks_<model>` (one line, `type:len` comma-separated), `blockN_<model>` and
`outTok_<model>` — and carries them ONLY when the image actually answered with
the envelope: absent fields mean "there was nothing to measure with", while
zeros would mean a measured zero.

## #293 — AGENTS.md via `prompt.context` (mod copy of patch step 25)

When `CLAUDE_MEMORY_CARRIER=mod`, the module subscribes to `prompt.context` and
appends `AGENTS.md` / `.claude/AGENTS.md` discovered by `$.fs.ancestors`. The
file is a reserve: it is skipped when that same directory already contributed
a project/local `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md`. Paths
are deduped after `\`→`/` and trailing-slash strip; `content.trim()` matching
an existing project/local record is also dropped (the file is already in the
list under another name). Insertion sits at the first project/local whose
directory is below the candidate, else after the last project/local, else
before the first `memory`, else at the end.

The handler changes only `instructionFiles`. Editing `blocks` in the same step
makes the host void the list (`instructionFiles: undefined`). Any throw inside
the handler, or an empty/failed `fs.ancestors`, returns the original list.
Any value other than `mod` (including unset) is inert and does not call
`fs.ancestors`. Default carrier remains the byte patch.

User-level `~/.claude/AGENTS.md` is outside `fs.ancestors` by host construction
(Managed/User homes excluded). This wave does not add a second reader for that
layer. GEMINI/CRUSH/QWEN/IFLOW/WARP/copilot-instructions are out of this wave.
