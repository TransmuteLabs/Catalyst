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
