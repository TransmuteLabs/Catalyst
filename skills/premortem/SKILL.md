---
name: premortem
description: Use when a plan or spec is ready and implementation has not started - failure-state projection before work begins. The gate between an approved plan and dispatching Task 1. Also gate RE-RUNS on amended or rejected ground, and REVERSALS of a previously accepted risk (the user withdraws an acceptance) - any time, including mid-execution or after the work shipped (the season rule bars retroactive analysis of shipped work, not re-gating amendments or honoring withdrawals).
---

# Premortem — failure analysis before the start

## Overview

Failure-state projection before work begins: mentally jump to the end ("the project failed") and reason backward — what led there. Core: the ContinuousClaude premortem (risk taxonomy + first-principles retrospective), embedded as a pipeline gate: **after the plan, before dispatching Task 1**. Arcane-mode's pre-flight catches contradictions inside the plan's text; premortem catches risks in the world around the plan — wrong assumptions, environment, cascades. The premortem is analysis: under the family tiering (the tier→model mapping lives in arcane-mode's Tiering table) it never runs on the executor tier (economics' availability fallback — the executor model at high reasoning effort, flagged to the user — is the sole exception) — the classification and the BLOCK/WARN/PASS verdict are "standard" minimum, adjudicated by the orchestrator.

## When to use

- The arcane-mode plan is ready, execution has not started.
- The crucible spec is closed and the decision is large/risky — can also run before planning.
- **Not** after code has started — that's no longer a premortem, it's an investigation. (This bars retroactive risk analysis of shipped work; a gate RE-RUN scoped to an amended spec/plan — arcane's amendment route — is in season.)

## Method

Read the plan/spec. Project to completion, then reason backward from the imagined failure. For each failure vector, walk the lenses. Effort is dialed by the ground's own risk surface, not by ceremony: a single-task plan naming NO critical mechanism (no concurrency/locks, no replay/durability, no trust boundary, no data migration) gets one FAST pass — each lens a question answered briefly, and “nothing here” is an honest answer; the artifact, the verdict grammar, and BLOCK semantics never shrink, only the depth of the search does. A plan naming any such mechanism gets the full walk:

1. **Base assumptions that led astray** — which beliefs about users/tech/timeline proved wrong; cross-check against project goals for contradictions.
2. **Shortcuts taken** — where expediency beat quality; which "temporary" solutions will become permanent.
3. **Weak implementations** — components with minimal attention/tests; single points of failure.
4. **Missing evaluations** — which tests/metrics/validations aren't planned; how deviation would have been caught earlier.
5. **Necessity conditions** — what must remain true for success: environment dependencies, resources, access.
6. **Nth-order effects** — secondary consequences of decisions: cascades, emergent behavior, unwanted interactions.

For each identified failure mode: a **falsifiable check** (how to confirm the risk is real, not imagined), the root cause (not the symptom), a cognitive-bias scan (overconfidence, planning fallacy, confirmation, availability) — then classify:

| Class | What it is | Action |
|---|---|---|
| **Tiger** | A clear threat requiring mitigation | Mitigation as plan tasks, before Task 1 |
| **Paper tiger** | Looks threatening but bounded | Record why it's bounded; move on |
| **Elephant** | An avoided topic with systemic impact | Name it out loud: a ticket/task or an explicit user decision |

**Falsifiability rule:** a risk with no statement of what would disprove it is not a verified finding; demote to paper tiger or discard. Every tiger comes with evidence (file:line or an observable condition).

## Output and gate

```yaml
premortem:
  status: BLOCK|WARN|PASS
  tigers:
    - risk: "assumption X breaks when Y"
      evidence: "file:line or observable condition"
      root_cause: "..."
      falsifiable_test: "how to verify or disprove"
      mitigation: "required action before starting"
  paper_tigers:
    - risk: "..."
      why_manageable: "..."
  elephants:
    - risk: "..."
      why_avoided: "..."
      true_impact: "..."
  mitigated:             # tigers whose mitigation LANDED — moved here by the re-run;
                         # the move KEEPS the tiger's evidence/root_cause/falsifiable_test
                         # (a later return to tigers: must not re-derive them)
    - risk: "..."
      evidence: "..."
      root_cause: "..."
      falsifiable_test: "..."
      mitigation_tasks: "task refs in the plan; at a spec-gate run, the spec
                         must_haves/decisions the mitigation landed as"
  amendments: []         # FULL tokens of amendment-scoped re-runs, each a
                         # double-quoted string ("<date>[ <time>][ #N]") — the
                         # resume sweep's exact-match record; survives every
                         # re-run, appended never rewritten.
  accepted_risks:        # only by explicit user decision — see the BLOCK rule.
                         # A FULL snapshot of the original entry: `class:` plus ALL
                         # the original class's fields carried VERBATIM (a tiger's
                         # evidence/root_cause/falsifiable_test/mitigation — the
                         # mitigation text too: a withdrawn tiger re-blocks and its
                         # recorded mitigation path must not be re-derived; an
                         # elephant's why_avoided/true_impact) — a withdrawal
                         # restores the entry from THIS record alone, so a snapshot
                         # that drops fields loses them for good
    - risk: "..."              # accepted TIGER — the five tiger fields verbatim:
      class: tiger
      accepted_by: user, YYYY-MM-DD
      consequence_accepted: "..."
      evidence: "..."
      root_cause: "..."
      falsifiable_test: "..."
      mitigation: "..."
    - risk: "..."              # accepted ELEPHANT — the elephant fields verbatim:
      class: elephant
      accepted_by: user, YYYY-MM-DD
      consequence_accepted: "..."
      why_avoided: "..."
      true_impact: "..."
```

- **BLOCK** — at least one tiger in `tigers:`: Task 1 is not dispatched until every tiger's mitigation lands in the plan as concrete tasks/verify steps, then the gate re-runs on the reworked plan — the re-run moves each mitigated tiger to `mitigated:` (keeping its fields). A tiger with NO viable mitigation path is the user's decision: accept explicitly (recorded as the FULL snapshot in `accepted_risks:` — protocol: `references/gate-mechanics.md` §1) or rework the scope — never proceed silently. Every re-run preserves `accepted_risks:`, `mitigated:`, and `amendments:` verbatim.
- **WARN** — no unmitigated, unaccepted tigers; paper tigers, elephants, accepted risks and/or mitigated entries present: proceed with documented awareness; every elephant gets an owner-decision (a task, or the user's recorded acceptance — gate-mechanics §2). A yaml holding ONLY mitigated entries is a WARN, not a PASS: the mitigations are plan tasks that still have to execute.
- **PASS** — no findings in any class.

Accepting a risk is only ever the user's EXPLICIT decision, never self-initiated, and it is a RECORDED state change: the full snapshot moves into `accepted_risks:` in the yaml, the ledger verdict line names it, and the user can later REVERSE it (withdrawal machinery: `references/spec-gate.md`). File: `<plan>.premortem.yaml`, committed with the plan; an amendment-scoped re-run appends the amendment's FULL token to `amendments:` (double-quoted). Full recording/withdrawal rules: gate-mechanics §3.

A sanctioned PRE-PLAN run (large/risky spec) gates the spec instead: mitigations land as spec must_haves / decisions, the file is `<spec>.premortem.yaml`, COMMITTED with the spec — a spec-gate run AFTER the campaign's `specced` flip commits the yaml (and any spec edits it produced) to base IMMEDIATELY via the referent transport — and PUSHES it when a remote exists (campaign's never-defer push rule; campaign's `references/state-writes.md` is the normative home of this transport) — never waiting for the `planned` flip, which carries only the plan's yaml.

**Post-approval edits to spec-gate ground — the normative home is `references/spec-gate.md`** (entry and marker shapes: crucible's `references/marker-machine.md`). Any edit landing on an approved spec's ground after its approval, any user answer to a pending entry, any rejection's revert, any acceptance WITHDRAWAL order, and any rejection or recompute landing while the phase is already executing → STOP and read that file ENTIRELY before writing, reverting, or dispatching anything — it owns the marker rewrite + entry commit, per-answer recording, stacked and entangled reverts, the yaml recompute, and the amendment-class barring rule. A partial read loses recorded user decisions.

At a spec-gate run the verdict is recorded in the spec's open/deferred section as an anchored append-only record, and a later plan-gate run BRIDGES it: reads `<spec>.premortem.yaml` first and carries its `accepted_risks`, `amendments:`, and standing decisions into `<plan>.premortem.yaml`. Full record shapes and the bridge: gate-mechanics §4-5.

## Red Flags — STOP

- The premortem started after code was written.
- A risk without a falsifiable_test landed in tigers.
- An elephant recorded and silently ignored (no task, no user decision).
- A mitigation reading "we'll handle it during implementation" — not a plan task = not a mitigation.
- Mitigation tasks added but Task 1 dispatched without re-running the gate on the reworked plan.
- All risks came out as paper tigers on a first large project — an overconfidence signal; walk lenses 5-6 again.
- A user acceptance acted on straight from chat — no `accepted_risks:` move in the yaml (and no ledger line where one exists): the decision dies with the session and gets re-asked.
