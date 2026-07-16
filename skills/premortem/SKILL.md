---
name: premortem
description: Use when a plan or spec is ready and implementation has not started - failure-state projection before work begins. The gate between an approved plan and dispatching Task 1.
---

# Premortem — failure analysis before the start

## Overview

Failure-state projection before work begins: mentally jump to the end ("the project failed") and reason backward — what led there. Core: the ContinuousClaude premortem (risk taxonomy + first-principles retrospective), embedded as a pipeline gate: **after the plan, before dispatching Task 1**. Arcane-mode's pre-flight catches contradictions inside the plan's text; premortem catches risks in the world around the plan — wrong assumptions, environment, cascades.

## When to use

- The arcane-mode plan is ready, execution has not started.
- The crucible spec is closed and the decision is large/risky — can also run before planning.
- **Not** after code has started — that's no longer a premortem, it's an investigation.

## Method

Read the plan/spec. Project to completion, then reason backward from the imagined failure. For each failure vector, walk the lenses:

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
```

- **BLOCK** — at least one tiger: Task 1 is not dispatched until every tiger's mitigation lands in the plan as concrete tasks/verify steps (in must_haves), then the gate re-runs on the reworked plan. A tiger with NO viable mitigation path is the user's decision: accept explicitly or rework the scope — never proceed silently.
- **WARN** — no tigers; paper tigers and/or elephants present: proceed with documented awareness; every elephant gets an owner-decision (a task or the user's explicit acceptance).
- **PASS** — no findings in any class.

Accepting a tiger without mitigation is only ever the user's explicit decision — never self-initiated (that's a form of "accepting the limitation"). File next to the plan: `<plan>.premortem.yaml`; a verdict line goes into the ledger.

## Red Flags — STOP

- The premortem started after code was written.
- A risk without a falsifiable_test landed in tigers.
- An elephant recorded and silently ignored (no task, no user decision).
- A mitigation reading "we'll handle it during implementation" — not a plan task = not a mitigation.
- All risks came out as paper tigers on a first large project — an overconfidence signal; walk lenses 5-6 again.
