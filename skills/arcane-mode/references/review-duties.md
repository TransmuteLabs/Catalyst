---
read-on:
  - a critic report arrived (adjudicate before accepting any verdict)
  - a task touched a critical mechanism (personal read of the core)
  - a gate result is being confirmed (exit-code and baseline discipline)
home-of:
  - verdict adjudication checklist
  - personal-read rule for critical mechanisms
  - gate confirmation discipline
---
# Review duties — adjudication, personal read, gate discipline

Verbatim arcane-mode doctrine (0.7.x per-trigger split of verification.md; that file is now the router). Where SKILL.md's sketch differs in detail, THIS file governs.

## Adjudicating every verdict (after every review)

Approved is not accepted mechanically. Orchestrator checklist per critic report:

1. Every Minor touching semantics / guarantees / counters — re-evaluate personally (precedent: a "Minor, spec-sanctioned" turned out to be a lost guarantee).
2. Letter-vs-intent: the spec itself may be incomplete — you are its author; the letter matched, did the intent?
3. Cross-task / cross-program consistency.
4. "What was lost silently" — behavior that existed before the diff and is mentioned in neither the report nor the review.
5. The critic's adjudication requests — re-read all of them.
6. Every severity recalibration in the report carries its "Mitigated by:" rationale — a downgrade without one is re-evaluated from scratch; data-loss/security/financial findings are never accepted downgraded.

Critics are strong at directed verification and weak at: semantic drift against intent, undirected search, severity calibration, asking the right questions. Those four layers are the orchestrator's — via authored questions in the dispatch and adjudication afterwards.

## Personal read of the core

Critical mechanisms (concurrency/locks, replay/durability, guarantee counters, trust boundaries) — after the critic, a pointed personal read of the mechanism's core by the orchestrator: 1-2 files, not the whole diff, without waiting for the final review.

## Gate discipline

- Never confirm a gate with `cmd | tail -N; echo $?` — that's the pipe tail's exit code; a failed command looks green. Form: `set -o pipefail` before the pipe, or the exit code with no pipe.
- An implementer report asking "does this red pre-exist on BASE?" is the ORCHESTRATOR's check — run it on BASE (the implementer is barred from stash/checkout self-verification) before routing the red.
- Exact test baseline instead of "EXIT 0": `N passed; 0 failed; K ignored` per suite; compare BEFORE/AFTER. New tests must raise the counter; unexplained decreases and new skips/ignores are a finding. This catches vacuous-green, which EXIT 0 cannot see.
- Tail gates before the final verdict run on the final HEAD, not on the memory of past runs.

