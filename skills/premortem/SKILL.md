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
  mitigated:             # tigers whose mitigation LANDED — moved here by the re-run;
                         # the move KEEPS the tiger's evidence/root_cause/falsifiable_test
                         # (a later return to tigers: must not re-derive them)
    - risk: "..."
      evidence: "..."
      root_cause: "..."
      falsifiable_test: "..."
      mitigation_tasks: "task refs in the plan; at a spec-gate run, the spec
                         must_haves/decisions the mitigation landed as"
  accepted_risks:        # only by explicit user decision — see the BLOCK rule
    - risk: "..."
      accepted_by: user, YYYY-MM-DD
      consequence_accepted: "..."
```

- **BLOCK** — at least one tiger in `tigers:`: Task 1 is not dispatched until every tiger's mitigation lands in the plan as concrete tasks/verify steps (in must_haves), then the gate re-runs on the reworked plan — the re-run moves each tiger whose mitigation landed to `mitigated:` (BLOCK counts only `tigers:`; a mitigated risk never re-blocks). A tiger with NO viable mitigation path is the user's decision: accept explicitly or rework the scope — never proceed silently. An explicit user acceptance is a RECORDED state change, not a mental note: the tiger moves to `accepted_risks:` in the yaml (`accepted_by: user`, the date, the consequence accepted) and the verdict recomputes without it (no other tigers → WARN); the ledger verdict line names it (`WARN — tiger <X> accepted by user <date>`), so no resumed session re-blocks on a decision already made. Every gate RE-RUN reads the existing yaml first: risks in `accepted_risks` stay there — they are never re-listed as tigers and never demand mitigation again; the yaml is the source of the acceptance, the ledger line its cache (a death between the recompute and the ledger write heals from the yaml).
- **WARN** — no unmitigated, unaccepted tigers; paper tigers, elephants, accepted risks and/or `mitigated` entries present: proceed with documented awareness; every elephant gets an owner-decision — a task, or the user's explicit acceptance, and an accepted elephant is RECORDED exactly like an accepted tiger: it moves to `accepted_risks:` (accepted_by, date, consequence) so no re-run can mistake a decided elephant for an ignored one and re-ask. A yaml holding ONLY mitigated entries — the standard post-BLOCK re-run outcome — is a WARN, not a PASS: the risks were real, and their mitigations are now plan tasks that still have to execute.
- **PASS** — no findings in any class.

Accepting a tiger without mitigation is only ever the user's explicit decision — never self-initiated (that's a form of "accepting the limitation"). File next to the plan: `<plan>.premortem.yaml`, COMMITTED with the plan once the verdict lands (in a git repo; under a campaign the `planned` flip's state commit carries both to the base branch) — the yaml is the durable verdict every re-run and every other machine reads; a verdict line goes into the ledger (arcane-mode's `.catalyst/sdd/progress.md` — mechanics in its `references/verification.md`). A sanctioned PRE-PLAN run (large/risky spec) gates the spec instead: mitigations land as spec must_haves / decisions, the file is `<spec>.premortem.yaml`, COMMITTED with the spec — a spec-gate run AFTER the campaign's `specced` flip commits the yaml (and any spec edits it produced) to base IMMEDIATELY via the referent transport, never waiting for the `planned` flip, which carries only the plan's yaml — and a spec edit landing AFTER the spec's approval never hides under the standing `status: approved` marker: the changed must_haves/decisions are named to the user for crucible's fast re-approval (the same arm a markerless approved spec uses), and the approval record updates with it — the marker attests what the user saw — and the verdict is recorded in the spec's open/deferred section (no plan, no ledger exists yet): that in-spec record is what makes a LOST yaml detectable — the bridge and the campaign referent check read the spec first, and a spec whose open/deferred records a spec-gate verdict REQUIRES the yaml next to it (absent = a lost referent: recover from the branch or batch to the user — never "no gate ran") — and the plan-gate run still happens after the plan is written. The plan-gate run BRIDGES the spec run: it reads `<spec>.premortem.yaml` first and carries its `accepted_risks`, still-valid `mitigated` entries (still-valid means the plan actually carries the spec must_have/decision the mitigation landed as; one the plan dropped returns to `tigers:` at the plan gate), AND any still-live `tigers:` (a spec-gate BLOCK the user walked away from does not dissolve — the live tigers enter the plan gate as tigers, never trusted to be re-discovered by luck) into `<plan>.premortem.yaml` with their records — a decision accepted at the spec gate is never re-asked at the plan gate, and a spec-gate BLOCK bars Task 1 exactly like a plan-gate BLOCK until its tigers are mitigated or user-accepted.

## Red Flags — STOP

- The premortem started after code was written.
- A risk without a falsifiable_test landed in tigers.
- An elephant recorded and silently ignored (no task, no user decision).
- A mitigation reading "we'll handle it during implementation" — not a plan task = not a mitigation.
- Mitigation tasks added but Task 1 dispatched without re-running the gate on the reworked plan.
- All risks came out as paper tigers on a first large project — an overconfidence signal; walk lenses 5-6 again.
- A user acceptance acted on straight from chat — no `accepted_risks:` move in the yaml (and no ledger line where one exists): the decision dies with the session and gets re-asked.
