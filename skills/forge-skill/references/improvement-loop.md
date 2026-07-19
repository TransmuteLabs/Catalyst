---
read-on:
  - an edit to an existing skill is being planned or proposed (from friction or absorption)
  - a friction entry is being closed, or an approach is being recorded as a dead end
  - a previously tried approach resurfaces as a candidate fix
home-of:
  - the self-improvement contour (friction → challenger → proposal → outcome)
  - the dead-end veto
  - the one-variable challenger and its boundary with rework-not-patch
  - the held-out validation gate (quantitative checks only)
  - the structure-over-prose rule for recurring corrections
---
# Improvement loop — the family's self-improvement contour

Absorbed from field-proven external sources (journal 0.7.3): a controlled-experiment skill-improvement pipeline, a co-evolving skill/tool framework's measured ablations, and a minimal-diff proposal tool. The evidence base is quantified: removing the failure memory multiplied regressions ×3.6 (the system re-proposed configurations that had already failed); removing typed edit constraints multiplied tool errors ×4.6; the one-variable challenger is what makes a win attributable — "if the challenger wins, you know what changed; if it loses, you know what not to repeat."

The contour closes the loop that FRICTION.md opens: friction is the input, this file is the middle, the outcome record is the output that feeds the next cycle.

```
friction → target → deconstruct → veto check → one challenger → proposal → approval → apply → outcome
```

## 1. Target by friction trend

The edit target is the skill with recurring OPEN friction entries — the component that is actually degrading in production. A quiet skill is not edited (the standing rule: edits source from FRICTION.md, not from taste), and a skill whose entries are all closed is not re-opened for polish. The limited edit budget concentrates where the trend points down.

Harvest discipline (absorbed from a transcript-mining memory updater, journal 0.8.3): when past sessions are swept for missed friction, only DURABLE, reusable items qualify — recurring corrections and stable facts; one-off instructions and transient details do not become entries. A semantically duplicate observation links the existing entry instead of minting a twin. And the null outcome is a valid, stated outcome: "no high-signal friction found" — a sweep never invents entries to justify itself.

## 2. Deconstruct into improvement surfaces

Before writing any fix, name the SURFACE being changed — specific enough to test. "Make the skill better" is not a surface; "the trigger description misses the X situation named in friction entry N" is. Each surface carries:

- **artifact evidence** — where the current skill text shows the behavior (quote it);
- **history evidence** — what prior attempts FRICTION.md and the journal already record;
- **mutation hypothesis** — what the change should improve, falsifiably;
- **regression risk** — what might get worse (which neighboring rule, which trigger);
- **observation plan** — what future friction (or its absence) would confirm or refute the hypothesis. The family has no automated eval; FRICTION.md IS the measurement channel, so the plan names what a future entry would look like;
- **coupling** — which other rules/mirrors move with this one (check norms.yaml).

An improvement whose observation plan can never observe anything was not an improvement — it was decoration; strike it before it is proposed.

**Validation gate where a quantitative check exists** (absorbed from a skill-training framework that treats the skill document as trainable state, journal 0.8.3): if the surface being edited already has a MEASURABLE held-out check — a harness RED-baseline set for a rule, a script's test suite, a lint rule — the edit is accepted only when that check does not regress, and a NEW rule ships with its RED baseline as before. This is not the buried per-edit prose gate (dead ends, 2026-07-19): that epitaph buried LLM-review rounds over skill texts, whose audit surface grows with each fix; a deterministic held-out check is fixed, free, and terminates. The framework's measured result stands as the why: candidate edits accepted only on strict held-out improvement kept skill training stable where uncontrolled self-revision diverged — and its rejected-edit buffer is this family's dead-end epitaphs under another name: a rejected candidate is RECORDED with why, so it is not innocently re-proposed.

**Recurring corrections become structure, not prose** (absorbed from a principle-skill stack, journal 0.8.3): the second time the same instruction is written — or the same friction class re-opens after a wording fix — the fix moves UP a layer: a lint rule, a schema field, a deterministic script check, instead of more text. The family's own precedent is the founding case: free deterministic lint checks replaced whole classes of paid review findings. Text instructs; structure enforces — and only structure survives context pressure.

## 3. The dead-end veto

Before any edit is proposed, check FRICTION.md's **Dead ends (epitaphs)** section. A candidate that matches a buried approach STOPS:

- either the proposal explicitly names the NEW GROUNDS that distinguish it from the burial — what changed since (new evidence, a changed mechanism, a removed constraint) — and records them;
- or the fix takes a different path.

The veto redirects the implementation away from a path verified to fail — it never blocks the INTENT of fixing the friction. And nothing is deleted silently: retiring a rule, a reference, or an approach writes its epitaph (what it was, why it died, what supersedes it) so a functional equivalent is not innocently re-created later. The tests journal's `ROW RETIRED` record is this same discipline for scenarios; epitaphs generalize it to approaches.

## 4. One challenger, one variable — and the rework boundary

An incremental edit is a LOCALIZED challenger against the current skill text: ONE variable moves, unrelated behavior is preserved. When the friction stops, you know what fixed it; when new friction appears, you know what caused it. Two variables per edit make every outcome a two-variable investigation (the same attribution law as arcane's one-new-complexity-source cap for code).

Boundary with SKILL.md's rework-not-patch threshold: wholesale rework is a DIFFERENT arm, licensed only by systematic-failure evidence (the skill fails most of its scenarios; the core is proven wrong). Friction-driven improvement never escalates to rework on taste — and rework never masquerades as a series of "localized" edits that in sum rewrite the core.

## 5. Proposal, then approval

A SELF-INITIATED family edit — one the user did not explicitly order — is proposed, never self-applied. The proposal is a recorded artifact, not chat prose ("a diff rendered in chat instead of a recorded proposal leaves no record and no path to apply"). It carries:

- ONE minimal diff (one skill's scope; interdependent files — SKILL.md + its reference + a script — may join the same proposal as one atomic bundle when they cannot land separately);
- the exact target text quoted, unique at its location (expand the quote until unique);
- the operation named from the edit vocabulary: **split** (per-trigger reference), **compact** (distill without loss), **plug** (loophole counter), **reword** (leading-word strengthening), **retire** (with epitaph), **absorb** (external doctrine) — a proposal that cannot name its operation is an unconstrained rewrite, the measured ×4.6 error class;
- the risk named: **low** (wording/docs), **medium** (behavior), **high** (gates, records, state machinery);
- the friction entry (or user order / baseline record) it sources from.

Approval is the user's explicit answer to THIS proposal; silence, or an old broad approval of something else, is not it. User-ordered edits skip the proposal step (the order IS the approval) but keep every other step of the contour.

## 6. Apply atomically, record the outcome

An approved proposal applies and commits immediately (interdependent files in ONE commit — a half-landed bundle is an invalid intermediate state), and the sourcing friction entry closes with the commit ref in place.

Every applied edit's outcome eventually lands back in FRICTION.md: friction stopped → the entry stays closed (`fixed <commit>`); friction returned or worsened → a NEW entry linking the old one — and if the APPROACH itself is judged wrong (not merely incomplete), a dead-end epitaph, so the veto guards the path from then on. The negative experience is the asset that compounds: "forgetting why something was removed is as dangerous as never having learned it."
