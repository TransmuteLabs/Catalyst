---
name: arcane-mode
description: Use when executing a spec or multi-task implementation plan through subagents, when writing such a plan, or when verifying a completed branch against its original goal. Triggers - implementation plan exists or is requested, work spans multiple tasks, subagent dispatch is available.
---

# Arcane Mode — SDD pipeline

## Overview

Subagent-driven development pipeline: spec → plan → execution by fresh subagents → goal verification → convergence. A hybrid of three sources: orchestration and decision-boundary model tiering (ratified SDD process), handoff and plan hygiene (superpowers), executor operating rules and goal-backward verification (GSD).

**Core:** the orchestrator makes decisions and adjudicates; subagents execute decisions already made. Any task that involves making a decision, drawing a conclusion, or diagnosing — "standard" tier minimum. Artifacts travel as files, never pasted into prompts. Progress lives in the ledger, not in conversation memory.

## When to use

- A spec or a multi-task (2+) plan exists and subagent dispatch is available.
- Asked to write an implementation plan for subagent execution.
- A branch/phase is finished — verify against the goal, not against the task list.

**When NOT to use:** a < ~20 line change with an obvious direction — do it yourself, dispatch costs more; pure research with no implementation.

**Inputs:** no approved spec → catalyst:crucible first (decision hardening → spec; approved = the spec file carries crucible's `status: approved` marker, including its skip-order shape `status: approved (waived: <date>)` — a markerless file is a draft; a markerless spec the effort's history says WAS approved (a pre-marker effort resumed after an upgrade) is NAMED to the user with a fast re-approval offered — never silently re-interviewed; TWO approved specs for the same effort → the user picks, never the newest silently — under a campaign the ROADMAP row's spec link names THE spec). Effort larger than one session with a foggy route → catalyst:starchart (decision map), then crucible → spec → here.

## Pipeline

1. **Plan** — per `references/plan-standard.md` (tracer-first, must_haves, No Placeholders, Interfaces, context budget). Before Task 1: a pre-flight scan of the plan for internal contradictions — everything found goes to the user as ONE batched question; then the catalyst:premortem gate (any tiger blocks Task 1 until its mitigation lands as plan tasks and the gate re-runs).
2. **Execution** — per task (a plan task of `Type: approval` is the orchestrator's OWN step — plan-standard's rule — never an implementer dispatch): `scripts/task-brief` → dispatch implementer → `scripts/review-package BASE HEAD` (BASE recorded before dispatch, never `HEAD~1`) → dispatch critic → adjudicate every verdict → fix wave on Critical/Important → re-review → one ledger line. Templates and rules: `references/dispatch-templates.md`; the adjudication checklist, ledger mechanics, and gate discipline: `references/verification.md`. If `bloks` responds on this machine, briefs carry verbatim knowledge cards and reports feed back ack/nack/learn: `references/knowledge-loop.md`.
3. **Verification** — goal-backward against must_haves + final whole-branch review read personally + iterative fresh-eyes rounds until 2 consecutive clean. For user-facing behavior, offer a conversational UAT pass after the code-side gates (protocol in `references/verification.md`). After convergence: distill session lessons — recurring conventions go to the highest enforcement tier that can express them (lint > types > formatter > pre-commit > CI > prose; see `references/knowledge-loop.md`), the rest into persistent memory (what worked, what failed and why) — knowledge must outlive the session.
4. **Branch finish** — after convergence, never stop silently and never integrate silently: if the base branch advanced past the branch's last verified merge point (the fork, or a previous re-gate's merged head whose suite AND tail gates ran green — a head whose re-gate ran red is not a verified point; "since fork" alone re-fires forever after any advance), merge it forward into the branch (or rebase per repo convention) and re-run the suite + tail gates on the MERGED head — green-on-branch proves nothing about the merge result, and a red here is a finding for a fix wave, not a reason to integrate anyway — and any post-convergence fix RE-OPENS convergence: re-enter fresh-eyes rounds until 2 consecutive clean and refresh the converged line — on a WAIVED lineage, the disposition ask instead: rounds now, or a fresh recorded waiver (`references/verification.md`) — a green suite after the fix is not that criterion; then verify the suite AND the tail gates are green on the final HEAD, triage any ledger `minor:` lines filed after the final review (post-convergence critics file here and nothing else consumes them), and present ONE question — merge into the base branch locally / push and open a PR / keep the branch as-is / discard — and execute the choice. Cleanup (worktree, temp branches) only after the choice lands — and under a campaign never before the row's repo-file referents (spec, plan, premortem yamls) are committed on base (campaign's transport rule): a `discarded` branch may hold their only copies. **Under a campaign, control returns to the campaign router at convergence:** the moved-base re-gate and the phase acceptance (campaign's `verified` row, in that order) happen BEFORE this question — acceptance decides whether the branch integrates at all, and branch finish then executes the choice without repeating the re-gate (unless base advanced again since).

## Tiering by decision boundary

| Role | Tier | Rule |
|---|---|---|
| Orchestrator | top | architecture, briefs, adjudication, final verdict, personal read of critical-mechanism cores |
| Analysis / debugging / root-cause / critics | standard minimum | never the "executor" tier (sole exception: the availability fallback in `references/economics.md` — always flagged to the user, never silent) |
| Implementation from a complete brief, fix waves with exact direction | executor | the brief must contain zero open questions |
| Scouts | executor allowed | find/list/measure/quote only — no conclusions |

Current tier mapping: top = fable, standard = opus, executor = sonnet. Haiku — never. The model is named explicitly in every dispatch. Turn count beats token price: a cheap model taking 2-3× the turns on multi-step work costs more overall — the floor for reviewers and prose-brief implementers is "standard".

Effort is a second dial, set per dispatch independently of tier; budget pressure collapses the agent fleet, never planning or the review floor; model availability is discovered from failed spawns, not assumed: `references/economics.md`.

## Iron rules

- A found defect gets fixed completely, never legitimized (no "accept the limitation", no DEFERRED, no self-initiated stubs).
- **Named gates bend only to the user's EXPLICIT command — and never silently.** The family doctrine: state the cost in one line, execute, and RECORD the waiver where the gate's evidence would have lived (the ledger's `waived by user` line, a spec's open/deferred entry, the campaign `waived` stamp, the tests journal for a skill shipped ungated) — a waived gate must never read as a passed gate, and a recorded waiver is never re-demanded: the user's AUTHORIZATION is never re-litigated — but a record that itself names owed follow-up work (forge's "gate owed" journal line) keeps that work due, and running the owed gate honors the record. A waiver covers the state it was recorded at, never work that lands after it (verification.md's disposition rule). Casual pressure ("demo tomorrow", "skip the ceremony") is not a command. An explicit order to build with NO spec is recorded the same way: in the plan header and the ledger — a waiver, not an approval.
- An implementer brief passes the readiness test: the task can be done without opening a single file "to scout" and without asking a single question.
- A gate is confirmed only by an honest exit-code form (`set -o pipefail` or no pipe at all) and an exact test baseline (`N passed; 0 failed; K ignored`) — never a bare "EXIT 0".
- After compaction trust the ledger `.catalyst/sdd/progress.md` and `git log`, not memory. At execution start, run the ledger identity check (created at plan approval; none for plan-writing sessions): `references/verification.md`.

## Orchestrator Red Flags — STOP

- Dispatching a critic with "just review it" and no authored probing questions.
- Accepting Approved mechanically, without adjudicating semantics/guarantee-touching Minors.
- An "executor"-tier brief containing "investigate / decide / choose / verify the hypothesis".
- Accepting a fix without covering tests, the command, and its output; skipping re-review.
- Re-dispatching the same model unchanged after BLOCKED.
- A sentence in a critic prompt whose subject or object is a specific potential finding and whose verb is evaluation or routing ("doesn't count as a defect", "don't file separately", "adjudication requests only", "Minor at most") — in any phrasing; the only channel for plan-mandated context is the verbatim Global Constraints block.
- A plan/diff/report pasted into a prompt instead of a file path.
- A task already marked complete in the ledger re-dispatched as new.
- Presented the integrate question (or merged) while the base branch had advanced, without the merged-head suite + tail-gate run.
- Presented the integrate question after a post-convergence fix on the strength of a green suite alone — the fix re-opened convergence (and a waived lineage owes its disposition ask); the stop criterion — or, on a waived lineage whose recorded disposition answer was extend, the fresh recorded waiver — must hold again first.
- A waiver written in the passed/converged shape — a waived gate must never read as a passed gate.
