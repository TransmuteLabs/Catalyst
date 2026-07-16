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

**Scope boundary:** Rules 1-3 apply to code the current task CREATES or DIRECTLY TOUCHES — a new endpoint's missing validation is this task's correctness requirement (Rule 2), not a pre-existing condition. Pre-existing warnings and failures in files the task doesn't touch — flag in the report, don't fix; a flag governs what you did to the CODE (nothing), never the STATUS line — a report whose body flags an unverified red under any heading ("out-of-scope regression flagged", "concerns") while its STATUS says DONE is the forbidden form, whatever the flag's honesty. **The tiebreak between Rules 1-3 and the stop rule:** Rules 1-3 govern only code your task creates or directly touches, and only when the cause is EVIDENT — you can point at the defective line and state the fix with no diagnosis beyond running the covering test; fix inline, within the auto-fix limit. Every other red is UNEXPECTED — any red in untouched code that the brief or the orchestrator has NOT declared pre-existing (however evident it looks), and any red you cannot explain without diagnosis — and routes through the stop rule below (one repro attempt → BLOCKED, raw output, no diagnosis); a brief-declared known red is the flag case above, not a stop. An evident-cause fix that fails to turn its red green disproves "evident": reclassify UNEXPECTED and report BLOCKED — don't spend the remaining auto-fixes re-explaining the same red. "Pre-existing" is a verified fact — stated in the brief, or verified by the ORCHESTRATOR on BASE; the implementer never self-verifies pre-existence (that's the stash/checkout move Git safety forbids), so a red discovered mid-task without those two sources is an unexpected red, full stop. **Flagging governs the CODE (don't touch it), never the STATUS:** while an unexpected red stands unresolved, the report status is the exact form `BLOCKED (<own-work state>; unexpected red in <path>)`, where own-work state is whichever is true — `own diff green` (your work done, red elsewhere), `fix attempt failed` (an evident-cause fix didn't green it), or `own scope, undiagnosed` (the red is in your code and needs diagnosis you're barred from doing) — and it IS the accurate report: `own diff green` states your success; STATUS names the pipeline's state, not your performance. DONE asserts "ready for review" — with an unverified red standing, that assertion is false, so DONE is the inaccurate status ("BLOCKED would misreport my finished work" has it backwards). The STATUS line BEGINS with the word BLOCKED — hybrid framings ("DONE (own task) / BLOCKED (suite gate)", "DONE, gate blocked") are the forbidden DONE+flag with extra words: the leading token is what routing reads, and your own success already has its sanctioned home inside the parenthetical (`own diff green`), never as the leading token. `DONE`/`DONE_WITH_CONCERNS` with the red as a flag is the hedged-diagnosis pattern the stop rule forbids, however honest the flag reads. Nor does "preserving the investigation's value" enlarge the allowance: the channel is the one-line unverified hypothesis by design — hand over raw outputs, not conclusions or fix sketches; rediscovery from raw data is cheaper than a wrong anchor delivered convincingly. **Limit:** 3 auto-fixes per task, then stop, document the rest in the report; don't keep digging and don't re-run the build hunting for more.

### Git safety (embed in the brief when working in a worktree)

`git stash` (any subcommand) is forbidden in a worktree: the stash stack is shared between the main checkout and every linked worktree (`refs/stash` lives in the parent `.git/`), so `stash pop` can silently apply a sibling worktree's WIP. To set work aside — a throwaway branch (`checkout -b scratch-<task>-wip`, commit, switch back). Checking "does the failure pre-exist on BASE" — not via stash: state it in the report, the orchestrator verifies on BASE. Blanket resets (`git clean`, `git checkout -- .`, `git reset --hard`) are forbidden; reverting one of your own files — `git checkout -- path/to/file`.

### Stop rule (mandatory in every "executor"-tier brief)

Unexpected failure or divergence from the brief → one honest reproduction attempt → status BLOCKED with the raw output, NO deep diagnosis. Hedged diagnosis in an implementer report = automatic escalation of the task to the "standard" tier.

The rule applies even when your own subtask is green and the red is out of scope ("I'm not blocked, my part is DONE" does not cancel it) — the sanctioned status form is `BLOCKED (own diff green; unexpected red in <path>)`: it reports your own work truthfully while routing the red to the orchestrator; DONE with the red as a flag is not an honest-report alternative, it is the violation. Allowed in concerns: raw output, the reproducibility fact, a file pointer, and a one-line "unverified hypothesis: <where>" — with no justification. A multi-line root-cause analysis or a proposed fix is the same hedged diagnosis, even under the pretext of "saving the next agent time" or "the N minutes of digging shouldn't go to waste": an unverified diagnosis presented convincingly costs more than the lost minutes, because the consumer will take it for a fact. The report is the ONLY channel — a "separate message to the orchestrator" carrying the diagnosis or fix sketch outside the report body is the same hedged diagnosis one envelope over; the one-line hypothesis allowance is the entire budget, wherever written.

### Statuses and the orchestrator's response

| Status | Response |
|---|---|
| DONE | review-package → critic |
| DONE_WITH_CONCERNS | read the concerns before review; correctness/scope concerns get resolved before review. An unexpected red arriving as a "concern" is the forbidden DONE+flag form under another name: treat the report as BLOCKED and route per the BLOCKED row's unexpected-red branch; the hedged-diagnosis tier escalation (stop rule) applies to the agent |
| NEEDS_CONTEXT | supply the context, re-dispatch the same agent |
| BLOCKED | context problem → supply and re-dispatch; needs more reasoning → tier up; task too big → split; unexpected red (own diff may be green) → the diagnosis is the orchestrator's (catalyst:debug), then a fix task; plan wrong → user. Never: the same model unchanged |

### Report self-check section (mandatory)

Before submitting, the implementer verifies their own claims: created files exist (`[ -f path ]`), named commits exist (`git log`), the test baseline is exact (`N passed; 0 failed; K ignored`, per suite), AND the STATUS line matches the report body: any unresolved unexpected red mentioned ANYWHERE in the report (flags, concerns, "out-of-scope" sections) → the status must be the sanctioned BLOCKED form with a truthful own-work state (own diff green / fix attempt failed / own scope, undiagnosed) — a DONE/DONE_WITH_CONCERNS status above a flagged red fails this check. Result — a `Self-Check: PASSED/FAILED` section in the report. FAILED → don't submit, fix.

## Critic dispatch

All per-task critics are "standard" tier, always. The critic gets three paths: the brief, the implementer report, the review package (`scripts/review-package BASE HEAD`; BASE recorded before the implementer dispatch — `HEAD~1` silently truncates multi-commit tasks) + the plan's Global Constraints block verbatim.

**Mandatory in every dispatch:**
- **Authored probing questions** from the orchestrator — concrete questions about this task's cross-interactions and semantic points. "Just review it" is a process smell.
- **Hunt categories by change type.** Refactor: AST drift, import direction, lost re-exports, stale mocks. Bugfix: races, edge cases, swallowed errors, regression scope. Always: "does the test actually exercise the changed path?" (vacuous-green), test-baseline BEFORE/AFTER — new tests must raise the counter; unexplained decreases and new `#[ignore]`/skips = a finding.
- **Adjudication requests:** the critic lists separately every place where it ACCEPTED a trade-off or a debatable call. The orchestrator re-reads them all — small volume, high miss density.

**Form of the constraints block in a critic prompt (a recipe, not a prohibition).** The critic learns about mandated decisions from exactly one channel: the plan's Global Constraints block, verbatim. Beyond it, the prompt contains zero sentences about what to flag or not flag, where to file a finding, or what severity to assign. Pre-send check: if the prompt contains a sentence whose subject or object is a specific potential finding ("the singleton", "this pattern", "such places") and whose verb is evaluation or routing ("doesn't count", "don't file", "route to…", "rate as…") — delete it; the mandate is already visible in the Constraints.

Pre-judging doesn't stop being pre-judging when rephrased — and it doesn't stop when relabeled: a "how to treat X" paragraph framed as context ("this is context, not a gag order", "don't spend the pass re-litigating X — it's decided", "route that one to adjudication requests, don't file it") is the same bypass as the blunt forms. Semantic equivalents of "do not flag" — "the mere use of X is not a defect", "don't file a separate finding for X", "X goes only into adjudication requests, not findings", "treat as Minor at most", "don't evaluate the choice of X — it's already decided" — all get deleted by the same pre-send check, however they're framed (observed rationalizations: "this isn't a restriction, it's grounding/routing", "it's context, not a command to be silent"). The critic already knows to route mandate-matching findings to adjudication requests — that's ITS rule (agents/critic.md); the orchestrator writing it into the prompt about a NAMED mechanism is the suppression. The economics favor deletion: a false positive costs one adjudication line, a blind spot on an actively used mechanism is a potential Critical.

Two verdicts are mandatory: spec compliance AND code quality. A report missing either is not accepted.

## Fix wave

Critical/Important → fix wave immediately; Minor → into the ledger, the final review triages. **One wave per findings list**, not one fixer per finding (per-finding fixers rebuild context and re-run suites — in a real session the final-review fix wave cost more than all tasks combined). Fix contract: re-run the covering tests of the change (named in the dispatch — a one-line fix doesn't need the whole suite) and report the command + output. Without all three elements (tests, command, output) the re-review is not dispatched. A fix contradicting the plan's text is the user's decision, not the fixer's.

## Scouts

Forbidden in the prompt: "choose / decide / propose / evaluate / conclude". Allowed: "find / list / measure / quote / cross-check / run (read-only)". Choosing among N → the scout returns ALL N with objective attributes (dates, sizes, metrics, file:line) — the orchestrator chooses. A recommendation a scout brings is raw material: re-decide it yourself. Scout claims about the codebase are accepted only with file:line and spot-verified by the consumer.

## Failure escalation and liveness

- A "failure" = a delivery that fails verification/review (the original weak delivery is failure #1; rework #1 answers it, rework #2 answers failure #2 — same agent, it has the context, each with a pointed list). Failure #3 → a FRESH agent with clean context + your diagnosis (a buried context is a frequent cause). The fresh one fails too — blocked + a short diagnosis to the user; the pipeline continues on independent tasks. (Effort accompanies the ladder per `economics.md`: rework #1 raises effort one level; it stays raised.)
- Only idle/completed arrived with no report → don't restart, don't guess: SendMessage the same agent "re-send the report".
- An agent died mid-task → a successor with explicit instructions to audit the predecessor's traces (git log, git status, uncommitted work): partial work is often correct — adopt and finish, don't redo from scratch.
- While an implementer works — write the next tasks' briefs; before dispatching a brief written ahead, one-line-check it against the ACTUAL diff of the previous task.
