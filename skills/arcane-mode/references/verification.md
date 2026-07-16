# Verification and convergence

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
- Exact test baseline instead of "EXIT 0": `N passed; 0 failed; K ignored` per suite; compare BEFORE/AFTER. New tests must raise the counter; unexplained decreases and new skips/ignores are a finding. This catches vacuous-green, which EXIT 0 cannot see.
- Tail gates before the final verdict run on the final HEAD, not on the memory of past runs.

## Goal-backward: verify the goal, not the tasks

All tasks done ≠ goal achieved. Against the plan's `must_haves`:

- **truths** — every observable behavior demonstrated (command + output), not inferred from "the code was written".
- **artifacts** — every file exists and is non-empty.
- **key_links** — every link actually laid: X calls Y (not "both exist"), data from Z reaches its consumer.

**Stub scan** over all created/modified files: hardcoded empty values (`=[]`, `={}`, `=null`) flowing into render/output; placeholder texts ("not available", "coming soon", TODO/FIXME); components with no data source wired. Every found stub is either wired up or explicitly accepted by the user as intentional. A silent stub = verification failure.

**Grounding for doc/synthesis claims:** every claim is checked against the deepest source (code, not a retelling); separately check the connectives and quantifiers added during compression ("when", "always", "after", "therefore", "most") — distortions are born in the connective tissue absent from the source. Derived-vs-derived checks don't count.

## Conversational UAT (user-facing behavior)

Code-side gates prove the code matches the plan; they do not prove the feature works from the user's seat. After goal-backward passes, for user-visible behavior offer a UAT pass: one scenario at a time ("do X — what do you see?"), the user answers in plain text, each result recorded (`uat:` lines in the ledger). A reported gap is a finding like any other — diagnose, fix through the pipeline (fix wave + critic), re-test that scenario. Never interrogate with a batch of ten questions, and never mark UAT passed on the user's silence.

## Final whole-branch review

The orchestrator reads the branch review package PERSONALLY (`scripts/review-package MERGE_BASE HEAD`, MERGE_BASE = `git merge-base main HEAD`). Exception — a package >~150KB: a fresh-eyes subagent on the same top tier with clean context; the orchestrator adjudicates its verdict. The final review receives the ledger's Minor list and triages what must be fixed before merge. Final findings → one fix wave with the complete list → re-review.

## Fresh-eyes convergence (after the final review, iterative)

Rounds of 1-2 auditors with lenses the previous reviewers did NOT have. Lens tiering:

- probing pass over the new mechanisms themselves (what breaks them from inside) → top tier, clean context;
- artifacts / claim-truth / conformance to the spec text → "standard" tier (directed verification).

Rules:
- Every finding of any severity is fixed immediately (completely, never legitimized), one wave per round's list.
- Every new round — fresh context + a NEW lens set; do not repeat exhausted ones.
- Plus the orchestrator's own sweeps: greps by defect class, SHA/doc claim checks, tail gates on the final HEAD.
- **Stop criterion: minimum 2 consecutive rounds with zero findings of any severity.** One clean round ≠ convergence.

## Ledger

`<repo>/.catalyst/sdd/progress.md` (the workspace self-ignores in git; `git clean -fdx` destroys it — recover from `git log`).

- Skill start: read the ledger; tasks marked complete are DONE — no re-dispatch; resume at the first unmarked task.
- After a task's clean review — one line: `Task N: complete (commits <base7>..<head7>, review clean)`; Minor findings — same file, prefixed `minor:`.
- The ledger stays current after every task — it is the recovery map after compaction; after compaction trust the ledger and `git log`, not conversation memory.
