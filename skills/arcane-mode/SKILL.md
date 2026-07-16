---
name: arcane-mode
description: Use when executing a spec or multi-task implementation plan through subagents, when writing such a plan, or when verifying a completed branch against its original goal. Triggers - implementation plan exists or is requested, work spans 3+ tasks, subagent dispatch is available.
---

# Arcane Mode — SDD pipeline

## Overview

Subagent-driven development pipeline: spec → plan → execution by fresh subagents → goal verification → convergence. A hybrid of three sources: orchestration and decision-boundary model tiering (ratified SDD process), handoff and plan hygiene (superpowers), executor operating rules and goal-backward verification (GSD).

**Core:** the orchestrator makes decisions and adjudicates; subagents execute decisions already made. Any task that involves making a decision, drawing a conclusion, or diagnosing — "standard" tier minimum. Artifacts travel as files, never pasted into prompts. Progress lives in the ledger, not in conversation memory.

## When to use

- A spec or a 3+ task plan exists and subagent dispatch is available.
- Asked to write an implementation plan for subagent execution.
- A branch/phase is finished — verify against the goal, not against the task list.

**When NOT to use:** a < ~20 line change with an obvious direction — do it yourself, dispatch costs more; pure research with no implementation.

**Inputs:** no approved spec → catalyst:crucible first (decision hardening → spec). Effort larger than one session with a foggy route → catalyst:starchart (decision map), then crucible → spec → here.

## Pipeline

1. **Plan** — per `references/plan-standard.md` (tracer-first, must_haves, No Placeholders, Interfaces, context budget). Before Task 1: a pre-flight scan of the plan for internal contradictions — everything found goes to the user as ONE batched question; then the catalyst:premortem gate (tigers without mitigation block Task 1).
2. **Execution** — per task: `scripts/task-brief` → dispatch implementer → `scripts/review-package BASE HEAD` (BASE recorded before dispatch, never `HEAD~1`) → dispatch critic → adjudicate every verdict → fix wave on Critical/Important → re-review → one ledger line. Templates and rules: `references/dispatch-templates.md`. If `bloks` responds on this machine, briefs carry verbatim knowledge cards and reports feed back ack/nack/learn: `references/knowledge-loop.md`.
3. **Verification** — goal-backward against must_haves + final whole-branch review read personally + iterative fresh-eyes rounds until 2 consecutive clean. Protocol: `references/verification.md`. After convergence: distill session lessons — recurring conventions go to the highest enforcement tier that can express them (lint > types > formatter > pre-commit > CI > prose; see `references/knowledge-loop.md`), the rest into persistent memory (what worked, what failed and why) — knowledge must outlive the session.

## Tiering by decision boundary

| Role | Tier | Rule |
|---|---|---|
| Orchestrator | top | architecture, briefs, adjudication, final verdict, personal read of critical-mechanism cores |
| Analysis / debugging / root-cause / critics | standard minimum | never the "executor" tier |
| Implementation from a complete brief, fix waves with exact direction | executor | the brief must contain zero open questions |
| Scouts | executor allowed | find/list/measure/quote only — no conclusions |

Current tier mapping: top = fable, standard = opus, executor = sonnet. Haiku — never. The model is named explicitly in every dispatch. Turn count beats token price: a cheap model taking 2-3× the turns on multi-step work costs more overall — the floor for reviewers and prose-brief implementers is "standard".

## Iron rules

- A found defect gets fixed completely, never legitimized (no "accept the limitation", no DEFERRED, no self-initiated stubs).
- An implementer brief passes the readiness test: the task can be done without opening a single file "to scout" and without asking a single question.
- A gate is confirmed only by an honest exit-code form (`set -o pipefail` or no pipe at all) and an exact test baseline (`N passed; 0 failed; K ignored`) — never a bare "EXIT 0".
- After compaction trust the ledger `.catalyst/sdd/progress.md` and `git log`, not memory.

## Orchestrator Red Flags — STOP

- Dispatching a critic with "just review it" and no authored probing questions.
- Accepting Approved mechanically, without adjudicating semantics/guarantee-touching Minors.
- An "executor"-tier brief containing "investigate / decide / choose / verify the hypothesis".
- Accepting a fix without covering tests, the command, and its output; skipping re-review.
- Re-dispatching the same model unchanged after BLOCKED.
- A sentence in a critic prompt whose subject or object is a specific potential finding and whose verb is evaluation or routing ("doesn't count as a defect", "don't file separately", "adjudication requests only", "Minor at most") — in any phrasing; the only channel for plan-mandated context is the verbatim Global Constraints block.
- A plan/diff/report pasted into a prompt instead of a file path.
- A task already marked complete in the ledger re-dispatched as new.
