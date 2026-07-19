---
name: arcane-mode
description: Use when executing a spec or multi-task implementation plan through subagents, when writing such a plan, when verifying a completed branch against its original goal, or when a user-ordered AMENDMENT to an approved spec must be routed (any time, including mid-execution or after acceptance). Triggers - implementation plan exists or is requested, work spans multiple tasks, subagent dispatch is available.
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

**Inputs:** an APPROVED spec (crucible's `status: approved` marker as the TOP-OF-FILE line — a status-shaped line in the body is content, never the marker) and a git repository with a work tree (`git rev-parse --show-toplevel` from the spec's directory succeeds; this pipeline has no repo-less mode — a campaign's ephemeral sanction does not waive this gate). No approved spec → catalyst:crucible first; effort too large and foggy → catalyst:starchart first. The waived shape `status: approved (waived: <date>)` routes normally; the pending shape `…(edits pending re-approval: <date>)` routes here but its owed fast re-approval runs NOW; a markerless spec is a draft — EXCEPT one the effort's history says WAS approved (named to the user with a fast re-approval, never silently re-interviewed); TWO approved specs for one effort → the user picks. **Full marker grammar, per-entry re-approval, amendment-entry completion, and the repo/ephemeral seam: read `references/entry-and-finish.md` §1 ENTIRELY whenever the marker is anything but plain `status: approved`.**

**Micro-exit (explicit user confirmation only):** an APPROVED spec whose whole satisfaction is a < ~20 line change with an obvious direction may, on the user's EXPLICIT confirmation, be executed by the orchestrator directly — no per-task dispatch, no critic wave. The exit is RECORDED in the Iron-rules waiver form: the cost named in one line (“skipping per-task dispatch + critic for an N-line change”) and the ledger's `waived by user` line written where the review evidence would have lived — a waived gate never reads as a passed one. The TAIL is not waived: goal-backward against the spec's must_haves, the full suite run, and the branch-finish question still execute. The DEFAULT is the full pipeline — the orchestrator never proposes this exit beyond the obvious-direction micro-class, and casual pressure is not a command.

**A user-ordered spec AMENDMENT after approval — any time, including mid-execution — is routed, never improvised: the normative home is `references/amendment.md`.** On the order, STOP and read that file ENTIRELY before touching the spec, the plan, the ledger, or a roadmap row — it owns the full route: crucible's fast path scoped to the change, the pending-marker commit-first mechanics, the scoped gate re-run, the plan reconcile with its per-task re-open annotations and ledger lines, the campaign demotion of `verified`/`done` rows, and the post-`done` amendment wave with its branch-point rules. A partial read improvises exactly the steps the route exists to record.

## Pipeline

1. **Plan** — per `references/plan-standard.md`, read ENTIRELY at plan-writing (tracer-first, must_haves, No Placeholders, Interfaces, context budget, Planner authority, the plan self-review — the parenthetical is a preview, never the read's boundary). Before Task 1: a pre-flight scan of the plan for internal contradictions — everything found goes to the user as ONE batched question; then the catalyst:premortem gate (any tiger blocks Task 1 until its mitigation lands as plan tasks and the gate re-runs).
2. **Execution** — per task (a plan task of `Type: approval` is the orchestrator's OWN step — plan-standard's rule — never an implementer dispatch): `scripts/task-brief` → dispatch implementer → `scripts/review-package BASE HEAD` (both run FROM THIS SKILL'S directory — `<dir of this SKILL.md>/scripts/…`; they are not on PATH and not in the project root, so a bare `scripts/…` from the project cwd fails: resolve against the loaded skill's own path) (BASE recorded before dispatch, never `HEAD~1`) → dispatch critic → adjudicate every verdict → fix wave on Critical/Important → re-review → one ledger line. Templates and rules: `references/dispatch-templates.md` (shared core) + `references/brief-implementer.md` / `references/critic-dispatch.md` per role; the adjudication checklist, ledger mechanics (`references/ledger.md`), and gate discipline (`references/review-duties.md`). If `bloks` responds on this machine, briefs carry verbatim knowledge cards and reports feed back ack/nack/learn: `references/knowledge-loop.md`.
3. **Verification** — goal-backward against must_haves + final whole-branch review read personally + iterative fresh-eyes rounds until 2 consecutive clean. For user-facing behavior, offer a conversational UAT pass after the code-side gates (protocol in `references/verify-phase.md`). After convergence: distill session lessons — recurring conventions go to the highest enforcement tier that can express them (lint > types > formatter > pre-commit > CI > prose; see `references/knowledge-loop.md`), the rest into persistent memory (what worked, what failed and why) — knowledge must outlive the session.
4. **Branch finish** — after convergence, never stop silently and never integrate silently: if the base advanced past the branch's last verified merge point, re-gate on the merged head (full suite + the tail gates) BEFORE offering integration; then ONE integrate question — merge / PR / keep / discard — and the chosen option is EXECUTED and recorded, not just named. A post-convergence fix re-opens convergence (a green suite alone never re-earns the question). **Read `references/entry-and-finish.md` §2 ENTIRELY at every branch finish** — it owns the re-gate mechanics, the tail-gate list, and the re-open rules.

## Tiering by decision boundary

| Role | Tier | Rule |
|---|---|---|
| Orchestrator | top | architecture, briefs, adjudication, final verdict, personal read of critical-mechanism cores |
| Analysis / debugging / root-cause / critics | standard minimum | never the "executor" tier (sole exception: the availability fallback in `references/economics.md` — always flagged to the user, never silent) |
| Implementation from a complete brief, fix waves with exact direction | executor | the brief must contain zero open questions |
| Scouts | executor allowed | find/list/measure/quote only — no conclusions; a GROUNDING scout (facts that enter a brief as ground truth) runs "standard" |

Current tier mapping: top = fable, standard = opus, executor = sonnet. Haiku — never. The model is named explicitly in every dispatch. Turn count beats token price: a cheap model taking 2-3× the turns on multi-step work costs more overall — the floor for reviewers and prose-brief implementers is "standard".

Effort is a second dial, set per dispatch independently of tier; budget pressure collapses the agent fleet, never planning or the review floor; model availability is discovered from failed spawns, not assumed: `references/economics.md`.

## Iron rules

- A found defect gets fixed completely, never legitimized (no "accept the limitation", no DEFERRED, no self-initiated stubs).
- **Named gates bend only to the user's EXPLICIT command — and never silently.** The family doctrine: state the cost in one line, execute, and RECORD the waiver where the gate's evidence would have lived (the ledger's `waived by user` line, a spec's open/deferred entry, the campaign `waived` stamp, the tests journal for a skill shipped ungated) — a waived gate must never read as a passed gate, and a recorded waiver is never re-demanded: the user's AUTHORIZATION is never re-litigated — but a record that itself names owed follow-up work (forge's "gate owed" journal line) keeps that work due, and running the owed gate honors the record. A waiver covers the state it was recorded at, never work that lands after it (`references/ledger.md`, the disposition rule). Casual pressure ("demo tomorrow", "skip the ceremony") is not a command. An explicit order to build with NO spec is recorded the same way: in the plan header and the ledger — a waiver, not an approval.
- An implementer brief passes the readiness test: the task can be done without opening a single file "to scout" and without asking a single question.
- A gate is confirmed only by an honest exit-code form (`set -o pipefail` or no pipe at all) and an exact test baseline (`N passed; 0 failed; K ignored`) — never a bare "EXIT 0".
- After compaction trust the ledger `.catalyst/sdd/progress.md` and `git log`, not memory. At execution start, run the ledger identity check (created at plan approval; none for plan-writing sessions): `references/ledger.md`.

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
