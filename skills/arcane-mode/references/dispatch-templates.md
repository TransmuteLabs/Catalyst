---
read-on:
  - any subagent dispatch is being prepared (shared mandatory elements)
  - a dispatched agent failed, stalled, or died (escalation and liveness)
home-of:
  - mandatory dispatch elements by role
  - fix-wave and scout dispatch rules
  - failure escalation and liveness ladder
---
# Dispatch templates — shared core

Role templates split out (0.7.x): implementer brief → `brief-implementer.md`, critic dispatch → `critic-dispatch.md`. This file keeps what EVERY dispatch needs.

## Mandatory elements — by role

Universal (every dispatch, any role):

1. **Model named explicitly.** An omitted model silently inherits the session's expensive top model and breaks tiering.
2. **File handoffs** — brief, report, review package travel as paths. Everything pasted into a prompt stays resident in the orchestrator's context until the session ends.
3. **Report contract** — full report to a file; the reply is EXACTLY the agent contract's reply form, nothing beyond it (implementer: status, commits, the exact test-baseline line, concerns; critic: two one-line verdicts, findings, adjudication requests, baseline; auditor: severity counts + one-line round verdict; scout: the coordinate structure + the `Not determined:` tail; researcher: summary + report path) — there is no universal floor: the role's contract defines every field of its reply, this element only bars anything beyond it.

Writer roles only (implementer, fix-wave executor — anyone whose task EDITS the tree):

4. **`paths:` write scope** — nothing outside the list is touched; anything noticed outside the scope goes into the report as a flag, not an edit. The scope line is READ as backtick-quoted spans (`` `path` ``, comma-separated between spans; spacing around the commas is free): each backtick span is ONE path verbatim — spaces and commas inside a span are part of the path, and splitting the line on commas/whitespace without honoring the backticks mis-reads any path containing either (a legacy unquoted line falls back to comma-splitting). A `paths:` line starting `(none — approval task` is the approval SENTINEL: that brief is orchestrator-owned and must never be dispatched to an implementer — the implementer contract refuses it rather than decoding the prose into paths. Paths bind by exact git-tree spelling — a scoped path absent from the tree that still opens on disk (case/normalization alias) is an identity mismatch, NEEDS_CONTEXT (the implementer contract mirrors this). The header is MANDATORY on every writer brief (approval sentinel included): a brief with no `paths:` line is malformed — the implementer refuses it (NEEDS_CONTEXT naming the missing header) rather than inventing a scope from the body. And every brief ENDS with the terminal marker `<!-- BRIEF COMPLETE -->` as its last line, written atomically (the task-brief script does both; a hand-authored brief carries the same duties) — the implementer treats a markerless brief as truncated and refuses it.
5. **Permission-to-refuse** — task already done or premise false → proof (grep/diff/test) and stop; fabricating a diff is forbidden.

Read-only roles (critic, scout, auditor, researcher) get NO `paths:` write scope — their contract already bars edits entirely; a "refuse" for them is the false-premise stop their agent contracts carry (critic: review premise false → proof and stop; scout/researcher: report the absence as the finding). Imposing the writer elements on a read-only dispatch is noise, not safety.

A dispatch describes one task, not the session's history. Do not paste accumulated summaries of prior tasks: a fresh subagent needs its task, the interfaces it touches, and the global constraints. Nothing else.


## Fix wave

Critical/Important → fix wave immediately; Minor → into the ledger, the final review triages (Minors filed AFTER the final review — a post-convergence fix wave's — are triaged by branch finish before the integrate question: they have no other consumer). **One wave per findings list**, not one fixer per finding (per-finding fixers rebuild context and re-run suites — in a real session the final-review fix wave cost more than all tasks combined). Fix contract: re-run the covering tests of the change (named in the dispatch — a one-line fix doesn't need the whole suite) and report the command + output. Without all three elements (tests, command, output) the re-review is not dispatched. A fix contradicting the plan's text is the user's decision, not the fixer's.

## Scouts

Forbidden in the prompt: "choose / decide / propose / evaluate / conclude". Allowed: "find / list / measure / quote / cross-check / run-to-measure" (build/test/lint baseline runs are sanctioned — agents/scout.md's carve-out: artifact side effects named in the report, everything else read-only). Choosing among N → the scout returns ALL N with objective attributes (dates, sizes, metrics, file:line) — the orchestrator chooses. A recommendation a scout brings is raw material: re-decide it yourself. Scout claims about the codebase are accepted only with file:line and spot-verified by the consumer.

## Failure escalation and liveness

- A "failure" = a delivery that fails verification/review (the original weak delivery is failure #1; rework #1 answers it, rework #2 answers failure #2 — same agent, it has the context, each with a pointed list). Failure #3 → a FRESH agent with clean context + your diagnosis (a buried context is a frequent cause). The fresh one fails too — blocked + a short diagnosis to the user; the pipeline continues on independent tasks. (Effort accompanies the ladder per `economics.md`: rework #1 raises effort one level; it stays raised.)
- Only idle/completed arrived with no report → don't restart, don't guess: SendMessage the same agent "re-send the report".
- An agent died mid-task → a successor with explicit instructions to audit the predecessor's traces (git log, git status, uncommitted work): partial work is often correct — adopt and finish, don't redo from scratch.
- While an implementer works — write the next tasks' briefs; before dispatching a brief written ahead, one-line-check it against the ACTUAL diff of the previous task.

