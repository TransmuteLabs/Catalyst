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

- **BLOCK** — at least one tiger in `tigers:`: Task 1 is not dispatched until every tiger's mitigation lands in the plan as concrete tasks/verify steps (in must_haves), then the gate re-runs on the reworked plan — the re-run moves each tiger whose mitigation landed to `mitigated:` (BLOCK counts only `tigers:`; a mitigated risk never re-blocks). A tiger with NO viable mitigation path is the user's decision: accept explicitly or rework the scope — never proceed silently. An explicit user acceptance is a RECORDED state change, not a mental note: the tiger moves to `accepted_risks:` in the yaml as the template's FULL SNAPSHOT — `accepted_by: user`, the date, the consequence accepted, `class:`, AND every original field verbatim (a tiger's evidence/root_cause/falsifiable_test/mitigation; an elephant's why_avoided/true_impact): the bookkeeping four alone mint a hollow record from which withdrawal cannot restore the entry (the template comment's rule — restore is from THIS record alone, dropped fields are lost for good) — and the verdict recomputes without it (no other tigers → WARN); the ledger verdict line names it (`WARN — tiger <X> accepted by user <date>`), so no resumed session re-blocks on a decision already made. Every gate RE-RUN reads the existing yaml first: risks in `accepted_risks` stay there — they are never re-listed as tigers and never demand mitigation again — `mitigated:` entries carry over verbatim (dropping them silently upgrades a WARN to PASS and erases the record that the risks were real and answered), and the `amendments:` list carries over verbatim (dropping it makes every standing annotation read as an un-gated amendment); the yaml is the source of the acceptance, the ledger line its cache (a death between the recompute and the ledger write heals from the yaml). An acceptance is the user's decision and the user can REVERSE it — a withdrawal order is a STOP-read trigger: `references/spec-gate.md` owns the withdrawal machinery ENTIRELY (the `withdrawn:` append shape, the one-commit recompute, never-defer transport, re-acceptance supersede, and the per-risk merge arbitration); the effect is immediate — the risk returns to its recorded ORIGINAL class NOW (`class:` in the acceptance record — a withdrawn tiger to `tigers:` with BLOCK force, a withdrawn elephant to `elephants:` with its WARN semantics; a legacy acceptance without `class:` returns to `tigers:`, the conservative default), never parked for a later re-run.
- **WARN** — no unmitigated, unaccepted tigers; paper tigers, elephants, accepted risks and/or `mitigated` entries present: proceed with documented awareness; every elephant gets an owner-decision — a task, or the user's explicit acceptance, and an accepted elephant is RECORDED exactly like an accepted tiger: it moves to `accepted_risks:` as the FULL SNAPSHOT (accepted_by, date, consequence, class, PLUS its why_avoided/true_impact verbatim — the template's elephant variant; the four bookkeeping fields alone leave withdrawal nothing to restore) so no re-run can mistake a decided elephant for an ignored one and re-ask. A yaml holding ONLY mitigated entries — the standard post-BLOCK re-run outcome — is a WARN, not a PASS: the risks were real, and their mitigations are now plan tasks that still have to execute.
- **PASS** — no findings in any class.

Accepting a tiger without mitigation is only ever the user's explicit decision — never self-initiated (that's a form of "accepting the limitation"). File next to the plan: `<plan>.premortem.yaml`, COMMITTED with the plan once the verdict lands (in a git repo; under a campaign the `planned` flip's state commit carries both to the base branch) — the yaml is the durable verdict every re-run and every other machine reads; an AMENDMENT-scoped re-run (arcane-mode's `references/amendment.md`) additionally records the amendment's FULL token in the yaml's `amendments:` LIST — `amendments: ["<token>"]`, each member a DOUBLE-QUOTED string (a list, not repeated scalar keys — duplicate keys are invalid YAML and last-wins parsers silently drop the first token; the quotes protect the ordinal suffix — an unquoted ` #2` is a YAML comment and truncates exactly the byte that distinguishes two same-second tokens) — the exact-match signal the amendment resume sweep keys on (a later amendment's re-run APPENDS its member; existing members stay, through ORDINARY re-runs too — the standard post-BLOCK mitigation re-run regenerating the yaml preserves `amendments:` and `mitigated:` exactly like `accepted_risks`, or the annotations would read as forever-owed and every resume would re-gate); a verdict line goes into the ledger (arcane-mode's `.catalyst/sdd/progress.md` — mechanics in its `references/verification.md`).

A sanctioned PRE-PLAN run (large/risky spec) gates the spec instead: mitigations land as spec must_haves / decisions, the file is `<spec>.premortem.yaml`, COMMITTED with the spec — a spec-gate run AFTER the campaign's `specced` flip commits the yaml (and any spec edits it produced) to base IMMEDIATELY via the referent transport — and PUSHES it when a remote exists (campaign's never-defer push rule; campaign Mechanics is the normative home of this transport) — never waiting for the `planned` flip, which carries only the plan's yaml.

**Post-approval edits to spec-gate ground — the normative home is `references/spec-gate.md`** (entry and marker shapes: crucible's `references/marker-machine.md`). Any edit landing on an approved spec's ground after its approval, any user answer to a pending entry, any rejection's revert, any acceptance WITHDRAWAL order, and any rejection or recompute landing while the phase is already executing → STOP and read that file ENTIRELY before writing, reverting, or dispatching anything — it owns the marker rewrite + entry commit, per-answer recording, stacked and entangled reverts, the yaml recompute, and the amendment-class barring rule. A partial read loses recorded user decisions.

At a spec-gate run the verdict is recorded in the spec's open/deferred section as an anchored append-only record — `premortem: <PASS|WARN|BLOCK> <ISO date> (yaml: <path>)` (the grammar names every reachable verdict — WARN is the STANDARD post-BLOCK re-run outcome and must be writable, or a successful mitigation re-run leaves the governing record stuck at BLOCK), a later re-run appends a new line and the LATEST dated line governs, never a rewrite of an earlier one — consumers (crucible's lost-yaml detection, campaign's stamps) key on this exact shape, not on prose — and only at LINE START in the open/deferred section: a `premortem:`-shaped fragment inside a roadmap stamp, a D-line why-text, or quoted prose is content, never a governing verdict record (no plan, no ledger exists yet): that in-spec record is what makes a LOST yaml detectable — the bridge and the campaign referent check read the spec first, and a spec whose open/deferred records a spec-gate verdict REQUIRES the yaml next to it (absent = a lost referent: recover from the branch or from base git history — campaign's recovery arms, unshallow a shallow clone first — or batch to the user; never "no gate ran") — and the plan-gate run still happens after the plan is written.

The plan-gate run BRIDGES the spec run: it reads `<spec>.premortem.yaml` first and carries its `accepted_risks`, its `amendments:` members (the GOVERNING yaml for the amendment resume sweep is the plan yaml once a plan exists, the spec yaml before that — the bridge's carry is what keeps the sweep's read stable across that handover), still-valid `mitigated` entries (still-valid means the plan actually carries the spec must_have/decision the mitigation landed as; one the plan dropped returns to `tigers:` at the plan gate — UNLESS the risk also sits in `accepted_risks`, a merge union's dual membership: the recorded acceptance governs, it never re-blocks — the dual state is named to the user once), AND any still-live `tigers:` (a spec-gate BLOCK the user walked away from does not dissolve — the live tigers enter the plan gate as tigers, never trusted to be re-discovered by luck) into `<plan>.premortem.yaml` with their records — carried COMPLETE: a legacy/thin acceptance record missing original-class fields is backfilled from the source yaml's own history (the original entry usually still sits in the spec yaml's earlier sections) before the bridge copies it, or FLAGGED to the user when unrecoverable — the bridge must not propagate a hollow record the withdrawal machinery cannot restore from — a decision accepted at the spec gate is never re-asked at the plan gate, and a spec-gate BLOCK bars Task 1 exactly like a plan-gate BLOCK until its tigers are mitigated or user-accepted.

## Red Flags — STOP

- The premortem started after code was written.
- A risk without a falsifiable_test landed in tigers.
- An elephant recorded and silently ignored (no task, no user decision).
- A mitigation reading "we'll handle it during implementation" — not a plan task = not a mitigation.
- Mitigation tasks added but Task 1 dispatched without re-running the gate on the reworked plan.
- All risks came out as paper tigers on a first large project — an overconfidence signal; walk lenses 5-6 again.
- A user acceptance acted on straight from chat — no `accepted_risks:` move in the yaml (and no ledger line where one exists): the decision dies with the session and gets re-asked.
