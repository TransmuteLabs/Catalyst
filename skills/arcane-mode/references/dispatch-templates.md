# Dispatch templates and role rules

## Mandatory elements of EVERY dispatch

1. **Model named explicitly.** An omitted model silently inherits the session's expensive top model and breaks tiering.
2. **`paths:` write scope** — nothing outside the list is touched; anything noticed outside the scope goes into the report as a flag, not an edit.
3. **Permission-to-refuse** — task already done or premise false → proof (grep/diff/test) and stop; fabricating a diff is forbidden.
4. **File handoffs** — brief, report, review package travel as paths. Everything pasted into a prompt stays resident in the orchestrator's context until the session ends.
5. **Report contract** — full report to a file; the reply carries only: status, commits, one exact test-baseline line, concerns.

A dispatch describes one task, not the session's history. Do not paste accumulated summaries of prior tasks: a fresh subagent needs its task, the interfaces it touches, and the global constraints. Nothing else.

## Implementer brief

Readiness test: the implementer can do the task without opening a single file "to scout" and without asking a single question. Fails the test — the brief isn't ready: ground it yourself or via a scout as a separate step. An "executor"-tier brief contains zero open questions; the words "verify / investigate / decide / choose" mean this is not a task for that tier. In "standard"-tier briefs, ungrounded claims are marked: "HYPOTHESIS — verify before relying on it".

Dispatch composition:
1. one line on where the task fits in the project;
2. the brief path (`scripts/task-brief PLAN_FILE N`): "read this first — it is your requirements, use its exact values verbatim";
3. interfaces and decisions from earlier tasks the brief cannot know;
4. your resolution of any ambiguity you noticed in the brief;
5. the report-file path (`task-N-brief.md` → `task-N-report.md`) and the report contract.

Exact values (numbers, magic strings, signatures, test cases) live only in the brief.

### Deviation rules (embed in the brief)

The implementer WILL find work outside the plan. Rules:

- **Rule 1 — auto-fix bugs:** code doesn't work as intended (logic errors, type errors, nulls, broken validation) → fix inline, add/update a test, continue. No permission needed.
- **Rule 2 — auto-add critical functionality:** something essential for correctness/security/basic operation is missing (input validation, error handling) → add it. These aren't "features", they are correctness requirements.
- **Rule 3 — auto-unblock:** something prevents completing the current task (broken import, wrong type, missing env var) → fix it. Exception: a package that fails to install — do not pick a similarly-named alternative, do not retry other names; stop and ask a human.
- **Rule 4 — architectural changes:** new table/service, library switch, breaking API → STOP, return: what was found, the proposed change, why, impact, alternatives. A human decides.

Priority: Rule 4 → stop; Rules 1-3 → fix; in doubt → Rule 4.

**Scope boundary:** Rules 1-3 apply to code the current task CREATES or DIRECTLY TOUCHES — a new endpoint's missing validation is this task's correctness requirement (Rule 2), not a pre-existing condition. Pre-existing warnings and failures in files the task doesn't touch — flag in the report, don't fix. **Limit:** 3 auto-fixes per task, then stop, document the rest in the report; don't keep digging and don't re-run the build hunting for more.

### Git safety (embed in the brief when working in a worktree)

`git stash` (any subcommand) is forbidden in a worktree: the stash stack is shared between the main checkout and every linked worktree (`refs/stash` lives in the parent `.git/`), so `stash pop` can silently apply a sibling worktree's WIP. To set work aside — a throwaway branch (`checkout -b scratch-<task>-wip`, commit, switch back). Checking "does the failure pre-exist on BASE" — not via stash: state it in the report, the orchestrator verifies on BASE. Blanket resets (`git clean`, `git checkout -- .`, `git reset --hard`) are forbidden; reverting one of your own files — `git checkout -- path/to/file`.

### Stop rule (mandatory in every "executor"-tier brief)

Unexpected failure or divergence from the brief → one honest reproduction attempt → status BLOCKED with the raw output, NO deep diagnosis. Hedged diagnosis in an implementer report = automatic escalation of the task to the "standard" tier.

The rule applies even when your own subtask is green and the red is out of scope ("I'm not blocked, my part is DONE" does not cancel it). Allowed in concerns: raw output, the reproducibility fact, a file pointer, and a one-line "unverified hypothesis: <where>" — with no justification. A multi-line root-cause analysis or a proposed fix is the same hedged diagnosis, even under the pretext of "saving the next agent time" or "the N minutes of digging shouldn't go to waste": an unverified diagnosis presented convincingly costs more than the lost minutes, because the consumer will take it for a fact.

### Statuses and the orchestrator's response

| Status | Response |
|---|---|
| DONE | review-package → critic |
| DONE_WITH_CONCERNS | read the concerns before review; correctness/scope concerns get resolved before review |
| NEEDS_CONTEXT | supply the context, re-dispatch the same agent |
| BLOCKED | context problem → supply and re-dispatch; needs more reasoning → tier up; task too big → split; plan wrong → user. Never: the same model unchanged |

### Report self-check section (mandatory)

Before submitting, the implementer verifies their own claims: created files exist (`[ -f path ]`), named commits exist (`git log`), the test baseline is exact (`N passed; 0 failed; K ignored`, per suite). Result — a `Self-Check: PASSED/FAILED` section in the report. FAILED → don't submit, fix.

## Critic dispatch

All per-task critics are "standard" tier, always. The critic gets three paths: the brief, the implementer report, the review package (`scripts/review-package BASE HEAD`; BASE recorded before the implementer dispatch — `HEAD~1` silently truncates multi-commit tasks) + the plan's Global Constraints block verbatim.

**Mandatory in every dispatch:**
- **Authored probing questions** from the orchestrator — concrete questions about this task's cross-interactions and semantic points. "Just review it" is a process smell.
- **Hunt categories by change type.** Refactor: AST drift, import direction, lost re-exports, stale mocks. Bugfix: races, edge cases, swallowed errors, regression scope. Always: "does the test actually exercise the changed path?" (vacuous-green), test-baseline BEFORE/AFTER — new tests must raise the counter; unexplained decreases and new `#[ignore]`/skips = a finding.
- **Adjudication requests:** the critic lists separately every place where it ACCEPTED a trade-off or a debatable call. The orchestrator re-reads them all — small volume, high miss density.

**Form of the constraints block in a critic prompt (a recipe, not a prohibition).** The critic learns about mandated decisions from exactly one channel: the plan's Global Constraints block, verbatim. Beyond it, the prompt contains zero sentences about what to flag or not flag, where to file a finding, or what severity to assign. Pre-send check: if the prompt contains a sentence whose subject or object is a specific potential finding ("the singleton", "this pattern", "such places") and whose verb is evaluation or routing ("doesn't count", "don't file", "route to…", "rate as…") — delete it; the mandate is already visible in the Constraints.

Pre-judging doesn't stop being pre-judging when rephrased. Semantic equivalents of "do not flag" — "the mere use of X is not a defect", "don't file a separate finding for X", "X goes only into adjudication requests, not findings", "treat as Minor at most", "don't evaluate the choice of X — it's already decided" — are the same bypass, observed in real runs under the rationalization "this isn't a restriction, it's grounding/routing". A false positive costs one adjudication line afterwards; a blind spot on an actively used mechanism is a potential Critical.

Two verdicts are mandatory: spec compliance AND code quality. A report missing either is not accepted.

## Fix wave

Critical/Important → fix wave immediately; Minor → into the ledger, the final review triages. **One wave per findings list**, not one fixer per finding (per-finding fixers rebuild context and re-run suites — in a real session the final-review fix wave cost more than all tasks combined). Fix contract: re-run the covering tests of the change (named in the dispatch — a one-line fix doesn't need the whole suite) and report the command + output. Without all three elements (tests, command, output) the re-review is not dispatched. A fix contradicting the plan's text is the user's decision, not the fixer's.

## Scouts

Forbidden in the prompt: "choose / decide / propose / evaluate / conclude". Allowed: "find / list / measure / quote / cross-check / run (read-only)". Choosing among N → the scout returns ALL N with objective attributes (dates, sizes, metrics, file:line) — the orchestrator chooses. A recommendation a scout brings is raw material: re-decide it yourself. Scout claims about the codebase are accepted only with file:line and spot-verified by the consumer.

## Failure escalation and liveness

- Rework #1-2 — same agent (it has the context) with a pointed list; after the second failure — a FRESH agent with clean context + your diagnosis (a buried context is a frequent cause). The fresh one fails too — blocked + a short diagnosis to the user; the pipeline continues on independent tasks.
- Only idle/completed arrived with no report → don't restart, don't guess: SendMessage the same agent "re-send the report".
- An agent died mid-task → a successor with explicit instructions to audit the predecessor's traces (git log, git status, uncommitted work): partial work is often correct — adopt and finish, don't redo from scratch.
- While an implementer works — write the next tasks' briefs; before dispatching a brief written ahead, one-line-check it against the ACTUAL diff of the previous task.
