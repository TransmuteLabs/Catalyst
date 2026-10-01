# catalyst-probes — consultation engine

The module is the core. Consultants are rows in `~/.claude/probes/probes.toml`.
A new consultant is a `[probe.<id>]` table plus `~/.claude/probes/<id>/prompt.md`.
It is not a new plugin. The host loads one hooks module per plugin; this plugin
is that one module.

Companion: kit `docs/probe-core.md`, `docs/probe-registry-spec.md` (vocabulary).
Live home of this source: `TransmuteLabs/Catalyst` `plugins/catalyst-probes/`.
The patch kit does not ship the live plugin.

## Form semantics (0.1.55)

The form judge uses the union of zsh and bash semantics, including aliases and
function bodies from shell snapshots, static assignments, and active glob words.
Commit and push options and write targets are token-based.

судятся перенаправления, tee и перечисленные писатели; записи внутри интерпретаторов — вне суда

The writers are `cp`, `mv`, `install`, `dd of=`, in-place `sed`/`perl`, `truncate`,
and symbolic forced `ln`. Without `-e`/`-E`, perl's first operand is its script,
not a write target. Bash writes are judged from their actual post-state, even
when execution throws, except for `form-post-skipped-fanout` below.
`cancel`/`refuse` restores the saved file/link/absent state only when the condemned
fingerprint still matches. Judgment text and the byte fingerprint come from one
read; a changed size/mtime or byte length during judgment prevents restoration.
Targets above 4 MiB use a full-file host SHA-256; a failed or malformed hash
result prevents restoration. Unreadable post-state is F; metadata-only comparison
is used only when reading bytes fails but stat succeeds, not for large targets.
Without a fingerprint, restoration is skipped and named; a changed fingerprint
also skips restoration. A changed resolved parent path skips restoration; a
write to a different resolved target without its backup is named as unrestored.
Restoration copies the backup with preserved attributes into a sibling temporary
file and replaces the current non-directory object. Directories are skipped and
named. Rollback warnings are merged into the original record, preserving its
kind and refusal; their separate journal line refers to that same record.
Бэкап создаётся, только если хотя бы один класс из набора цели действует
`cancel`/`refuse`; отказ класса с `log_only` не откатывает никогда, даже при
существующем бэкапе.

The host provides no file locks. A write between the last comparison and the
restoration `mv` is replaced; the ordinary-file replacement window is narrowed
to that `mv`. A new object with the same kind, bytes and mtime is treated as the
same state.

Referent fingerprints reuse judged bytes only when the resolved target is the
saved referent and its size/mtime agree. A retargeted link requires an independent
referent read. Conflicting fingerprints for an overlapping candidate/referent
path skip restoration; an existing judged entry is never overwritten.

Missing parents are saved as the nearest existing resolved ancestor plus the
lexical tail. Restoration requires the same ancestor and parent resolution and
no links in the created tail. Created directories are not removed. Restore temps
are placed in the checked physical parent and removed in `finally`.
Linux restoration uses `mv -f -T` and `ln -s -f -T`; Darwin uses `mv -f -h` and
`ln -s -f -h`. Link replacement is one operation. The restored ordinary-file
fingerprint or link spelling is checked after replacement; a changed destination
produces `destination changed during restore` and an error journal entry.
The five-second SHA-256 command bound applies only to backed-up targets above
4 MiB and at most 32 MiB; larger backup volume refuses execution.

### Perl option measurements

Measured on usbox with `/usr/bin/perl` v5.40.2, x86_64-linux-thread-multi
(17 registered patches). Every listed letter consumes an attached cluster tail;
`i` terminates the cluster and `e`/`E` mark inline scripts.

| Letter | Takes next argument with empty tail | Measured exit | Witness |
|---|---|---:|---|
| `0` | no | 0 | script compiled and ran; DATA stayed in argv |
| `C` | no | 0 | script compiled and ran; DATA stayed in argv |
| `d` | no, controller decision from perlrun | 2 | debugger unavailable: perl5db.pl missing |
| `D` | no | 0 | script ran; build lacks DEBUGGING |
| `e` | yes | 255 | next script path parsed as inline code |
| `E` | yes | 255 | next script path parsed as inline code |
| `F` | no | 0 | script compiled; DATA opened as input |
| `i` | no | 0 | script compiled and ran; DATA stayed in argv |
| `I` | yes | 2 | DATA became the script operand |
| `l` | no | 0 | script ran with output newline |
| `m` | no | 29 | module name required |
| `M` | no | 29 | module name required |
| `x` | no | 0 | script compiled and ran; DATA stayed in argv |

perlrun's `-d`/`-dt` description: “Runs the program under the Perl debugger.”
Debugger modules use the attached `-d:MOD[=bar,baz]` / `-dt:MOD[=bar,baz]`
forms, not a separate module operand. The `d` row is not claimed as a completed
runtime demonstration; its rule was adjudicated from perlrun.

Only a complete, non-append stdout write from a quoted heredoc can be judged
before execution. Caps are 256 candidate paths, 64 expansion variants, and
8 times the 4 MiB file threshold in backup bytes per call. Candidate overflow
under `log_only` skips backup/post-judgment, records the skip, and names it in
model context. Превышение объёма бэкапа отказывает вызов до исполнения,
independently of class F's action. Missing required canon keys produce F on every
form call and one module log line per missing key.

The kit keys `git_msg` and `write_redirect` are removed; the target predicate is
`write_target`. Deliver module 0.1.55 first, then the canon, in one delivery step.
The new-module/old-canon interval is explicit through missing-key F; do not
open the old-module/new-canon interval.

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
A carrier handle left unset or empty now means `mod` (the patch copy of the
probes is gone — there is no other carrier to name). The probe switch is
asked BEFORE the carrier: a switched-off probe stays silent even when its
carrier handle names something foreign, exactly as a switched-off probe
always did. A switched-ON probe whose carrier handle (after trim +
lowercase) is non-empty and not `mod` is a configuration naming a carrier
that no longer exists. The refusal fires exactly where the probe would
have acted — after its scope guards (main loop only, the judge's
Agent/Task trigger and its class/agent skip lists — a computed boundary,
the same notion as the form's tool list — and the form's tool list, the
idle trigger) and after `enabled = false`: a probe disabled by config is
the same class as a probe switched off by its handle, and stays silent.
A dispatch the armed judge would have skipped leaves NO judge record
under a foreign carrier — the judge never worked, so its journal has
nothing to describe. Every call inside
that scope is denied with an operator-facing text naming the probe, the
handle and its actual value, and one `carrier-foreign-refused` line
lands in `failover/journal.jsonl` (fields: probe, handle, value). The journal line is deduped per process
per (probe, handle value) — the probe loop re-raises the refusal on every
tool call and would otherwise flood the journal. The deny itself is NOT
deduped: the second and every later dispatch must be cancelled exactly
like the first — letting the journal dedup leak into the deny would
silence a live configuration error after its first mention.

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
on = ["PreToolUse"]       # and/or every_min = N; see «Триггеры и доставка»

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
`absent`, `present`, `all`, `any`, `not`). `when` filters a trigger; a
new id without `on` and without `every_min` never consults and writes
`skip_degraded` / `by:"no-trigger"`. A new id with a trigger and no `when`
consults on every firing of its trigger, within its `cooldown_min` and the
session cap (see «Триггеры и доставка»). Built-in ids carry default
triggers, so the live toml does not need the new keys.

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
| `judge` | `on = ["PreToolUse"]`, main-loop Agent/Task | cancel (await, then run or deny) | OK\|WARN\|BLOCK\|STOP\|DENY |
| `idle-watch` | `on = ["PreToolUse"]` plus timer every `live_recheck_ms`; README «Thresholds» gate | nudge | SILENT\|NUDGE |
| `form` | main-loop Write/Edit/Bash/Agent/Task/SendMessage | per-class `[probe.form.act]` | rules |

A project layer may disable one (`enabled = false`), override keys, or
add a new id. `CLAUDE_PROBES_DIR` disables layering.

## Триггеры и доставка

**`on = ["<Имя>", …]`** — hook-event names of the contract
(`hook_event_name` in `.claude/types/claude-code.d.ts`, 33 names), held in
ONE constant `CLASSIC_EVENTS`; `tests/scripts/test-mod-units.sh`
(step classic-events) recounts it against the d.ts and against the
`classic.*` subscriptions.

- `PreToolUse` — the single `tool.call` subscription, before `next(e)`.
  `PostToolUse` — the same subscription, after `await next(e)`; `show =
  ["tool"]` puts the result into the payload. A second `tool.call`
  subscription is forbidden (it silently replaces the first, #447).
- Every other name — one `on("classic.<Имя>")` each. The event name is a
  literal: the loader rejects a computed name. With no listening probe the
  hook returns `next(e)` synchronously, with no `$` and no await.
- `MessageDisplay` is not subscribed: it fires on every render delta. In
  `on` it gives `on_bad` with `by:"MessageDisplay:per-delta"`.
- An unknown name gives `on_bad` with `by:"<имя>"`; the probe's valid names
  still work.
- `act = "cancel"` (and the judge) waits for a verdict before `next(e)`,
  which exists only on `PreToolUse`. Any other name or `every_min` on such a
  probe gives `on_bad` with `by:"<имя>:cancel-needs-PreToolUse"` and is
  dropped.
- `on_bad` and `skip_degraded`/`no-trigger` are written once per (probe,
  mark) per session, by armed probes only.
- The listener index is rebuilt on every world build (session start,
  `tool.call`, timer tick). A `probes.toml` edit takes effect no later than
  the next build. `/clear` and `/resume` empty the index together with the
  world, so the first event of the new session takes the slow path. The
  list of main-only probes that an agent's `tool.call` counts as
  `not-main` is emptied too. An agent call that entered while the index
  was empty is counted on the slow path, after the world build that
  rebuilds the list, the same way as on the fast path. A `tool_use_id`
  counted by one path is not counted again by the other (a set of at most
  256 ids, the oldest dropped, emptied on `/clear` and `/resume`).

**`every_min = N`** — evaluation on the 60 s tick of the stale-agents
timer. There is no second timer. An evaluation runs when `now − lastEval ≥
N min`; the first one runs N min after the session start. The context has
`event = "timer"` and no tool fields. The consultation targets the main
loop. The epoch and the timer generation are re-checked after every await,
before consultation and before delivery.

**Context of the predicate.** The context has `event`, `agent_id`, and the
flat (string / number / boolean) top-level fields of the event input.
`show = ["event"]` puts the input JSON into the payload, clipped by
`dispatch_chars`. The judge, and any probe with `show ∋ "dispatches"`, gets
`=== DISPATCHES ===`: one JSON line `{tool, subagent_type, model,
description, now?, self?}` per `Agent`/`Task` call in the assistant rows of
`$.session.messages()`. `now` marks the calls of the row that holds the
current `tool_use_id`, and `self` marks the current call. At most 20 past
calls are listed, without `now`. When no row holds the current id, no line
has `now`, and the probe journal gets one `fan-self-absent` line per id.
A call without a `tool_use_id` has no current call: no line has `now` or
`self`, and no `fan-self-absent` line is written. The ids the mod makes up
for a timer tick and for a classic event without its own id count as no
id. The `=== DISPATCH ===` object carries `self: true`.

**Defaults of the built-in ids.**

- `judge`: `on = ["PreToolUse"]`, fires on main-loop Agent/Task.
- `idle-watch`: `on = ["PreToolUse"]` plus the timer every `live_recheck_ms`
  (default 60000; `every_min` overrides it).
- `form`: unchanged, not a trigger probe.

**idle-watch gate** (README «Thresholds»; the first failing condition is
the `by`). The current Agent/Task call is counted before the count.

1. Live works of `live_kinds` with status `running` / `pending` must be
   `< live_threshold`, else `live-work:N`. `AgentInfo` has no kind:
   `type = "teammate"` maps to `in_process_teammate`, every other type to
   `local_agent`. `$.agent.list` does not return remote works.
2. Main-loop Agent/Task launches in the last `window_min` must be
   `< threshold`, else `window-count:N`.
3. The session age must be `≥ window_min`, else `window-not-filled`.
4. `now − last_consultation` must be `≥ cooldown_min`, else `cooldown`.

A failed `$.agent.list` gives `when_bad` `unknown=live_works`. Launch marks
and the session start reset on `/clear` and `/resume`. The launch history
drops marks older than the largest `window_min` of the armed probes and
keeps at most max(256, largest `threshold` + 1) marks, so the count never
falls below a configured threshold.

**Filtered.** An evaluation that does not reach a consultation writes
`outcome:"filtered"`, with `by` one of `live-work:N`, `window-not-filled`,
`window-count:N`, `cooldown`, `when-false`, `not-main` or `consult-cap`.
At most one line is written per (probe, `by` class) per `cooldown_min`.
`when_bad` lines have the same limit, with their own class. The limit is
never shorter than 60 s: `cooldown_min = 0` removes the pause between
consultations, not the limit on journal lines.

`not-main` covers a main-only probe on an agent's event. On an agent's
`tool.call` the path reads no clock and calls no `$`: it only counts, and
the tick writes the line with `n`.

**Delivery of `act = "nudge"`.** The text `[<probe>] <verdict rest>` is
queued per (session, agent). The main loop's queue has key `""`. Any other
queue has the id of the agent whose event caused the consultation. Timer
probes queue for the main loop.

- (a) The next `tool.call` of the same agent returns the whole queue in its
  result's `context`, after the result's own `context`. On `deny` nothing is
  delivered and the queue waits.
- (b) On the tick, main-loop text at least 60 s old goes to
  `$.prompt.submit({text})`, but only in an interactive session. If the
  session is not interactive or its mode is unknown, the journal gets
  `nudge_undelivered` with `by:"not-interactive"` / `"interactive-unknown"`,
  once per entry, and the text stays for (a).
- One text, one delivery. An entry whose submit was sent and has not
  answered is in flight: it stays in the queue, but no channel hands it out
  — neither (b) on later ticks nor (a) in `context`. An entry in flight
  waits for the host's answer to its submit. If the host never answers,
  the model does not get the text until the session changes, and the
  journal has `submit-timeout`.
- The submit has a 60 s deadline, a race with `$.clock.after`. When it
  expires, the journal gets `nudge_undelivered` with `by:"submit-timeout"`,
  once per entry. The entry stays in flight and does not go back to the
  head of the queue; the tick no longer waits for that submit.
- A submit that succeeds, on time or late, removes the entry and writes
  `nudge_delivered` with `channel:"submit"` (`late: true` after the
  deadline). A submit that resolves to `{ drop: reason }` did not enter
  (a hook refused it): the entry is removed without a retry, with
  `nudge_undelivered` `by:"drop"` and `reason` (`late: true` after the
  deadline). An empty `drop` string is a drop too, here and for the #530
  signal below; its `reason` is `(пустая причина)`. A submit that fails, on time or late, clears the in-flight
  mark and moves the entry to the head of the queue for (a) and (b), with
  `nudge_undelivered` `by:"submit-failed"`, once per entry (`late: true`
  after the deadline). The third failure of the same entry removes it,
  with `nudge_undelivered` `by:"submit-failed"` and `attempts`.
- (c) The toast is additional. It is written as the field `toast` on the
  consultation line and never marks `nudge_delivered`.

Delivery by one channel removes the text. A delivery line is
`nudge_delivered` with `channel: "context" | "submit"`.

`/clear` and `/resume` remove every queue: the text of one session does
not reach the next. Each removed entry is written as `nudge_dropped` with
`by:"session-reset"` (`fly: true` for an entry in flight). A `tool.call`
that began before the change does not take the new session's queue into
its result.

The queue holds at most 5 entries per agent, entries in flight included.
The oldest entry not in flight is evicted as `nudge_dropped` with
`by:"queue-max"`. An entry in flight is never evicted: when all five are
in flight, the new entry itself is `nudge_dropped` with `by:"queue-cap"`.
There are at most 64 agent queues (the main loop's queue is not counted).
A new queue beyond that evicts the agent queue with the oldest last entry;
each of its entries is `nudge_dropped` with `by:"queue-cap"`. Only the main
loop's queue can hold entries in flight. An agent whose status in
`$.agent.list` is terminal is gone at once. An agent absent from the list
on every tick for 10 minutes (counted from the first such tick; seeing it
again resets the count) is gone too. A gone agent's queue is written as
`nudge_undelivered` with `by:"agent-gone"` and removed. That applies only to
entries queued before the list was requested.

The stale-agents signal (#530) has the same 60 s deadline on its submit,
and the same in-flight rule. While a signal's submit has not answered, no
tick of the same session sends a second signal. On expiry, the journal gets
`kind:"STALE_AGENTS_SUBMIT_TIMEOUT"`, and the signal stays in flight. A late
success ends the flight, and the signal window stays closed from that
signal. A late failure ends the flight, writes `STALE_AGENTS_SUBMIT_ERR`
with `late: true` and reopens the window, so the next tick signals again.
A submit that resolves to `{ drop: reason }` is a failure too: the line is
`STALE_AGENTS_SUBMIT_ERR` with `by:"drop"` and `reason` instead of `err`,
and the window moves as for a failure on time or late. A tick that finds
idle-watch not armed does not end a flight; only the submit's answer or
`/clear` / `/resume` does.

The activity records hold at most 256 agents; a new one evicts the record
without an activity mark that has the oldest `lastAt`, else the oldest
inserted. While `$.agent.list` fails, a record without an activity mark
for longer than twice `stale_agent_min` is removed.

**Consultation cap.** At most 8 consultations of `act = "nudge"` /
`"log_only"` per session in the last 60 minutes. The cap is shared by
every trigger: `PreToolUse`, the other hook events, and the timer. The store
key holds consultation times. A plain number from an older build is read
once per process as that many consultations at the time of reading, and
the times are written back to the store at once, so a reload of the mod
reads times and the window does not move. All writes of the times go
through one chain, and each writes the times current when it runs. On
`/clear` or `/resume` the in-process copy (times and the once-per-process
mark of an old number) drops the keys of the sessions before the change.
The drop is the last link of the chain: the writes already queued reach
the store first, and `/resume` of that session reads its times. A key the
new session has already used is kept. A key whose last write to the store
failed is kept too, until a later write of that key succeeds: the store
does not hold its times, and dropping the copy would let `/resume` read the
old number and date it again. Such unlanded keys are bounded by
`CAP_UNLANDED_MAX` (64): one more evicts the oldest unlanded key other than
the current session's, drops its in-process times if no session touched
them since the last change, and writes `lost` `session-cap-unlanded-evicted`
with the session id. The last-consultation marks (`lastMirror`, used by
`cooldown_min`) are bounded by the number of (probe × cwd) pairs over the
life of the process and are never evicted: a mark carries a live cooldown.
A full window writes `filtered` with `by:"consult-cap"`,
subject to the same per-class frequency as every `filtered` line. An
idle-watch that consults every 30 minutes is never silenced for good.

**Cooldown of every probe.** `cooldown_min` from `[defaults]` or from the
probe's table applies to every non-cancel probe on any trigger. No key
means no pause, and `0` turns it off. A pause writes `filtered` with
`by:"cooldown"`. The built-in probes keep their own thresholds. The
cooldown (idle-watch's too) is checked again in the same synchronous step
that takes the cap and marks the consultation: two evaluations that both
passed the early check (two events, or the timer and a `tool.call`) give
one consultation, and the other writes `filtered` `by:"cooldown"`.

**`remote_agent`.** `$.agent.list` does not return remote works, so this
kind cannot be observed. If idle-watch's `live_kinds` names it (the default
does), the journal gets one line per session: `skip_degraded` with
`by:"live_kinds_unobservable:remote_agent"`. The kind is never inferred
into the count.

**Before the first world build**, and after `/clear` / `/resume`, the
listener index is empty (null). A `classic.*` hook and an agent's
`tool.call` then take the slow path: they build the world and decide from
it. An event that arrives before `session.start`, or before the new
session's first world build, is not lost.

## Failover ladder: who answered, and where it stops

**A refusal is the carrier's, not the model's.** The ladder moves to the
next rung only on a carrier refusal: a step with no usage and no stop
reason (`isCarrierRefusal`), or a throw before any content. A model that
answered with the text of a refusal, with live usage, gave an answer. The
ladder does not read the content of an answer, and it does not change the
model on it.

**Who answered.** Every attempt record carries `modelServed`, which is
`usage.model` of the step result, or `null` without usage. It also carries
`declared`, the agent's declared model. A matching name is not taken as
success. A step answered with `ok` by a rung that is not the declared model
queues a hint for the main loop at most once per (agent, rung model) per
session: `агент <agentId> (<subagent_type>): шаг агента обслужила <model>
(объявлена <declared>)`. That bounds
the queuing, not the delivery. The hint goes through the main loop's common
queue: in `context` of the next main-loop `tool.call`, or by `submit` on the
tick once the text is at least 60 s old. An eviction from the queue is
written as `nudge_dropped`; a failed enqueue is `lost`
`failover-served-nudge`. When the agent watchers see the agent completed
(terminal status in `agent.list`), one `served-summary` journal record
lists `{model, steps}` of its steps if at least one step was served by a
model other than the declared one; no hint goes to the conversation
(#509-FIX9 R5).

**Reviewers stay apart.** A reviewer's spawn registers its declared model,
and every `ok` step registers its rung model (at most 64 agents). A
reviewer's plan drops the rungs that serve another reviewer of the session
within the last 2 h, and counts them in `rungsFilteredReviewer`. Its own
declared model is not dropped. When every rung is taken, the plan keeps the
rungs left after the executor filter and marks `ladderFullTaken`. The
reviewer's sticky model is dropped by the same rule, also under
`ladderFullTaken`, and the records carry `stickyDroppedReviewer`.

Each reviewer attempt registers its model at the start, in the same
synchronous step that checks it, so two reviewers do not pick one free
model in parallel. A rung that is not the declared model and not the
terminal, taken by another reviewer, is skipped with a `reviewer-taken`
record while a later element of the plan is not taken (the terminal counts
as free); with none left, the taken model is tried. The probe of the wait
(heartbeat or deadline) makes the same check at the target's position in
the step plan: a `reviewer-taken` probe goes on to the later elements of
the plan in order, as a pass does, and the taken model is not probed again
in that turn of the wait. A target that is not in the plan (dead, or skipped
for a known reset) makes the check with the whole plan ahead of it. Such a
probe follows the general rule: the taken model is allowed when no free
element is ahead of it. The
target itself is chosen only among models that serve no other reviewer of
the session (the reviewer's own declared model and the terminal stay
candidates); with no candidate left, the wait ends as `wait-no-target`.

Each reservation keeps the entry it replaced. An attempt that ends in a
refusal or a throw before any content first marks its reservation
cancelled, whether or not the entry is still its own. If the entry is still
this attempt's own, the agent gets back the first entry in the chain of
replaced entries that is not a cancelled reservation, or no entry. So when
two overlapping steps of one agent reserve in turn and both fail, in either
order, the entry from before both comes back, not the reservation of the
other step. A success writes a new entry, and an attempt that emitted
content keeps its reservation; both drop the link to the replaced entry. A
cancelled link is held while a newer unsettled reservation of the same
agent refers to it; settling the newest reservation frees the chain. Every entry carries a sequence number of its own, so "this attempt's
own" is decided by that number, not by the model and time: two overlapping
steps of one agent on one model at one instant stay apart.
The registry keeps the 64 entries with the latest time: a new entry evicts
the entry with the oldest time among the others, not the one inserted
first, and never the entry it has just put, however old its time is.
Putting a reservation back, whether or not the entry is still its own,
returns every entry that the reservation evicted whose agent has none by
then. The entry that comes back is the first entry of the evicted entry's
chain that is not a cancelled reservation, and the 2 h window
(`REVIEWER_LIVE_MS`, counted from the time of the reservation) is measured
on that entry. The registry is then ordered by time and cut to 64, keeping
the agent's own entry if it came back, so a returned entry can be evicted
again as the oldest. Every entry also carries the generation of the
registry it was put into; the generation grows each time the registry is
reset for a new session. A reservation of an earlier generation, put back
after the reset, only marks itself cancelled: it returns neither its own
previous entry nor the entries it evicted. A success of a step and a spawn
write their entries (and the executor models) only when the generation has
not changed since the step's reservation, or since the start of the step
or of the spawn when there is no reservation; otherwise both writes are
skipped. So nothing of the old session enters the new one. Two paths put the entry back when no content
was emitted: the `finally` of the attempt, reached after a `yield` (the
consumer calls `.return()` while the attempt waits for the next chunk); and
the `abort` of `next.signal`, for a stream that hangs before its first chunk,
where `.return()` is queued behind the pending `.next()` and never reaches
`finally`. The subscription to `abort` is made once per reservation and is
removed in `finally`.

**Refusal classes.** A JSON body in the refusal line whose `error.code` is
`model_not_found` is `permanent-model`. On a rung with a non-Anthropic
model, `error.code` `1308` or the text `Usage limit reached for <N> hour`
(the z.ai quota window) is `quota`. The same body on an Anthropic model
keeps its previous class. A dead provider named in the text
(`PROVIDER_GONE_RX`) is `permanent-model`, the fallback when no JSON code
is read. A quota refusal (`QUOTA_RX`) is `quota`. In `QUOTA_RX`, 402 counts
only as an HTTP status: at the start of the line followed by a space or
the end of the line (`402 <body>`), `API Error: 402`, `"status": 402`,
`status=402` or `HTTP 402`. A bare number, such as `line 402`, a `/402/`
path or `402/…`, `402.`, `402-` at the start, is not a quota. A line that
names a dead provider and carries a 402 status, such as `API Error: 402
model x is not available on this server`, is `permanent-model`: the dead
provider is checked before the quota. `quota` has a 60 min
cooldown, unless the text carries `soonest recovery in <N>h<N>m<N>s` (any
subsequence of the ordered h/m/s parts, integer, which may be separated by
spaces): then the mark
lives the parsed duration; the
duration is read from the full refusal line, not the clipped evidence
(#509-FIX9 R3, #509-FIX10 F4). A numeric unit after the parsed part, such as
`2m 1h`, breaks the order: the shortened duration would be false, so the
text carries no term and the mark lives the default cooldown (#509-FIX11 B5).
`last upstream error: quota)` and `spent allowance` are
quota marks each on its own. Inside the `API Error` wrapper the HTTP status
is parsed (#509-FIX9 R4, #509-FIX10 F3): 413 is `request` by the status
alone; 400 is `request` only when the text carries a size subject of the
request — a size word before `too long`, `too many tokens`, or a
context-length excess, and `token limit exceeded` / `input length exceeded`
are size subjects too (#509-FIX11 B4); a time subject keeps
`temporary-unknown` with the other 4xx: the temporary verb `took` between
the subject and `too long` (`request/query/message/input/body/payload/history took too long`, and `processing took too long` with no size word at
all) is a duration, not a size; 401,
403 and 404 are `permanent-model`;
402, a dead provider and `model_not_found` are decided by the body before
the wrapper status. The body-decided classes (402, a dead provider,
`model_not_found`) are checked before the prefix tables, so they also win
over the `API Error` wrapper, and a body that names a dead provider or
model wins over a request prefix: a change of model cures it; the wrapper
status classes above (400/413/401/403/404) are decided inside the
`API Error` branch itself. A terminal
rung with a live `temporary-known` or `quota` mark is skipped entirely:
unlike a regular rung, which a live mark only defers to the tail of the
plan on the first pass (it is still called), the terminal is called in no
full pass, first or later — and when the declared model is the terminal, the
same rule removes it from the head of the plan too; once its term is past,
it is called as before (#509-FIX9 R2, #509-FIX10 F1). The heartbeat and
deadline probes still call it for liveness while the step waits: a probe is
not a full pass. When the plan is empty because the live mark removed its
only model, the step waits for the term by the regular wait (wake at the
term, heartbeat liveness probes) instead of passing the call straight
through the mark; a genuinely empty plan (no declared model, no rungs) still
passes straight through (#509-FIX11 B2). A probe refusal (heartbeat or
deadline) does not move the term of a live mark of the same model: not with
the same refusal class, and not when the class changes inside the
`temporary-known`/`quota` pair in either direction — the pair is one group
for this ban (#509-FIX10 F2). Inside the pair a strictly earlier credible
recovery read from the probe's own line shortens the term; an equal or
later term does not move it (#509-FIX11 B3). The probe itself is not
suppressed: it keeps calling `next` at the heartbeat pace of `waitPaceOf`
(240 s by default, shorter when a smaller stall timeout brings the deadline
closer). A class outside the pair, or an expired
mark, is written by the general rule of refusal marks. Once the term is past,
the next full pass calls the model again (#514 FIX3 L2, #509-FIX10 F2).
A reviewer's registry
entry is released when the agent watchers see its
agent completed, before the 2 h bound, which stays the upper limit
(#509-FIX9 R7). The request
class decides when the tail names no model. A body that does not parse as JSON has
no code, and the text rules still apply. These classes are also known
lines. So when `next` throws with only such a body, with no `API Error`
prefix and no fresh session line, the step moves to the next rung with
that class. It does not end as `hook-error`. A message (or thrown text)
that is one JSON document as a whole (after trimming, an object `{…}` or
an array `[…]` that parses) is decided by its body, and its lines are not
checked. With a body class, its `error.code` wins over the text of its
`message` line, and the refusal line is the whole text with every run of
whitespace folded into one space. With no body class, the message gives no
known line (a bare `402` line inside it is not a quota), and the older
messages are checked. Any other message is decided by its lines; a line
that carries JSON inside it (the host form `API Error: 404 {…}`) is decided
by its body.

**The hook budget and `$.clock.after`.** Measured on 2026-09-28 with the
`claude plugin test` kit of 2.1.283, probe
`tests/probes/clock-after-budget.probe.ts`. A `turn.step` hook that waits
12 000 ms for a `$.clock.after` callback is cut at the 10 000 ms budget.
This holds when the timer fires in real time, and when the timer has no
implementation. The step result then comes from beneath. A wait on
`$.clock.after` spends the hook budget.

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

## #306 — AGENTS.md carrier removed (2026-09-19): 2.1.277 ships `agents-md@builtin`

## #495 — environment memo when the working directory is unknown (0.1.52)

The world memo is keyed by the working directory (#308), so when the
directory is unknown (`PWD` unreadable or empty and no saved cwd) it is
neither read nor written. Before 0.1.52 this also meant `envBundle` (about
25 `$.env.get` reads) and the `env-unreadable:*` loss notes ran on every
call. Now that branch keeps a separate short memo of the ENVIRONMENT only,
`{ t, env }`: inside `WORLD_MEMO_MS` of the same epoch the environment
comes from the memo, `envBundle` is not called and the `env-unreadable:*`
notes are not repeated. The memo is reset by `newSession` together with the
world memo and is not written by a call that saw the epoch change. The WORLD
under an unknown directory is still built by `loadWorld` on every call:
`findProjectHome` walks relative paths from the process's actual directory,
so the key `""` never counts as a match. A known directory never uses the
environment memo. Teeth: `units.test.ts` Z495-a…d.

All three memos (`envMemo`, `worldMemo`, `allowedMemo`) use the half-open
window `[t, t + WORLD_MEMO_MS)`: equal clocks hit; clocks rolled back to
`t - 1` miss. Teeth: AR2-env/world/allowed. The environment memo's epoch
boundary is its reset in `newSession`, not a second epoch field; the
post-load epoch guard still prevents an old call from writing a new memo.
The stand has one host-boundary door, `hostMemoReset`, for all three memos:
`envMemo`, `worldMemo`, and `allowedMemo`. A fresh stand host models a fresh
production process, so none of these module-level memos may survive that
boundary. Base unit host constructors (`fsEnv$`, `env495$`, `fan313$`,
`mod$393`) call the door; wrappers, including `host514`, inherit it through
`mod$393`. The behavior stand calls it in `wired` and before each direct
`{}` host. Z495-f fills all three on host A, resets once, and counts fresh
reads on host B on the same clocks; Z495-c changes epoch on the SAME host,
so the constructor reset cannot hide a missing `newSession` reset.

## #497 — `heredoc` key dropped from the canon

`FORM_REQ` no longer lists `heredoc` and nothing in the module reads it
(the shell scanner replaced the regex, #489-B1-FIX5). The kit canon
`probes/probes.toml` drops the line; tooth Z497 pins that the form probe
still judges a heredoc body without the key.
