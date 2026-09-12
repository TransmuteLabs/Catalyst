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
