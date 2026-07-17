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
- An implementer report asking "does this red pre-exist on BASE?" is the ORCHESTRATOR's check — run it on BASE (the implementer is barred from stash/checkout self-verification) before routing the red.
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

Code-side gates prove the code matches the plan; they do not prove the feature works from the user's seat. After goal-backward passes, for user-visible behavior offer a UAT pass: one scenario at a time ("do X — what do you see?"), the user answers in plain text, each result recorded (`uat:` lines in the ledger). Under a campaign this offer is DEFERRED to the phase acceptance (the campaign's `verified` route) — it runs once, there, not inside this step. A reported gap is a finding like any other: diagnose, fix through the pipeline (fix wave + critic), re-test that scenario. The recorded `uat:` lines make an interrupted pass RESUMABLE: on re-entry, resume from the first unrecorded scenario — "it runs once" bars repeating completed scenarios, never finishing an interrupted pass. Never interrogate with a batch of ten questions, and never mark UAT passed on the user's silence.

**Any fix landed after convergence (a UAT gap, a moved-base re-gate red) re-opens convergence:** re-run the tail gates on the new HEAD and re-enter fresh-eyes rounds scoped to the fix diff until the stop criterion holds again (2 consecutive clean — one clean round re-declares nothing), then refresh the `verification: converged` line. Acceptance evidence must reference the FINAL head, never a pre-fix one — under a campaign, a re-open AFTER the `done` flip voids the acceptance: the row demotes to `verified` with the refreshed rounds and acceptance re-runs (campaign's rule).

## Final whole-branch review

The orchestrator reads the branch review package PERSONALLY (`scripts/review-package MERGE_BASE HEAD`, MERGE_BASE = `git merge-base <base-ref> HEAD` where `<base-ref>` is the branch this effort forked from — never assume `main`). Exception — a package >~150KB: a fresh-eyes subagent on the same top tier with clean context; the orchestrator adjudicates its verdict. The final review receives the ledger's Minor list and triages what must be fixed before merge. Final findings → one fix wave with the complete list → re-review.

## Fresh-eyes convergence (after the final review, iterative)

Rounds of 1-2 auditors with lenses the previous reviewers did NOT have. Lens tiering:

- probing pass over the new mechanisms themselves (what breaks them from inside) → top tier, clean context;
- artifacts / claim-truth / conformance to the spec text → "standard" tier (directed verification).

Rules:
- Every finding of any severity is fixed immediately (completely, never legitimized), one wave per round's list.
- Every new round — fresh context + a NEW lens set; do not repeat exhausted ones.
- Plus the orchestrator's own sweeps: greps by defect class, SHA/doc claim checks, tail gates on the final HEAD. Sweep findings count as the current round's findings — a clean round means zero from auditors AND sweeps, and any finding resets the consecutive counter.
- **Stop criterion: minimum 2 consecutive rounds with zero findings of any severity.** One clean round ≠ convergence. When the criterion is met, immediately write the ledger line `verification: converged (rounds N..M clean)` — the durable convergence evidence — before proceeding to branch finish.

## Ledger

`<repo>/.catalyst/sdd/progress.md` (the workspace self-ignores in git; `git clean -fdx` destroys it — recover from `git log` on the machine that has the branch; after a squash-merge integration the per-task `commits <base7>..<head7>` refs are historical only — recovery there uses the squash commit plus the plan/spec, not per-task hashes; a SHALLOW clone's truncated log under-reports completed tasks the same silent way: unshallow first (`git fetch --unshallow`), or treat the log as unreachable evidence).

- **The workspace is single-writer:** one arcane/review session per checkout at a time — the ledger, briefs, and diff files have fixed paths; concurrent efforts need separate worktrees. Before ARCHIVING a mismatched ledger: workspace files modified within the last few hours (`ls -lt .catalyst/sdd/`), or the user known to run parallel sessions, is a live-sibling signal — on the signal or in doubt, ask the user (archiving is destructive; one question is cheap). Resuming a MATCHING ledger needs no pre-emptive ask: append a `session: <ISO timestamp> resumed` line on resume; any later ledger line you did not write (a foreign session line, an unexpected completion mark) means a live sibling is co-writing — stop and ask. A confirmed live sibling means THIS session moves to its own worktree (or stops); it never archives and never co-writes.
- **The ledger belongs to ONE plan.** Its first line is the plan identity: `Plan: <plan file path> (<branch>)` — and the ONLY identity line: a ledger with a second identity line mid-file is corrupt (a buggy append instead of an archive) — archive it wholesale and rebuild from `git log` + the plan; completion marks in a corrupt ledger are not trusted. It is created when the plan is APPROVED — the user's go on the written plan; the batched pre-flight question is the natural moment — before the premortem gate; plan-writing sessions correctly have no ledger yet. Execution start: read the ledger and compare its identity line against the current plan — a mismatch (new plan, new campaign phase) means the ledger is a previous effort's: archive it (`mv progress.md archive/<plan-slug>-progress.md`) and start a fresh one with the new identity line. Exception — the mismatch is merely a renamed/moved plan FILE of the same effort (same branch, same must_haves): update the identity line in place; archiving live completion marks would re-dispatch finished tasks. Completion marks are only ever trusted for the plan named in the identity line — never carried across plans.
- Same plan: tasks marked complete are DONE — no re-dispatch; resume at the first unmarked task. A ledger with no premortem verdict line means the gate is owed: check for `<plan>.premortem.yaml` (an existing BLOCK: the mitigations may or may not have landed — check the plan for them FIRST, then re-run the gate on the current plan; don't re-add tasks that already landed), run or re-run the gate, and only then dispatch. A ledger whose verdict line IS BLOCK means the gate failed, not that it ran: mitigation work or the user's acceptance decision is owed — Task 1 stays barred until a PASS/WARN verdict replaces it. The verdict line is a CACHE of `<plan>.premortem.yaml` in every direction: before dispatching on a WARN/PASS line, cross-check the yaml — on any mismatch the yaml wins (a fresh BLOCK yaml under a stale WARN line = the gate failed; the line just never caught up); a MISSING yaml leaves the line unconfirmed — the gate is owed, re-run it, never dispatch on the line alone.
- After a task's clean review — one line: `Task N: complete (commits <base7>..<head7>, review clean)`; Minor findings — same file, prefixed `minor:`. Fresh-eyes convergence writes its own line: `verification: converged (rounds N..M clean)` — the durable evidence the campaign router's reconciliation reads. It is the ledger's final line MODULO three sanctioned trailers: `session: <ISO> resumed` lines, `uat:` result lines, and `minor:` lines (a post-convergence fix wave's critic review files its Minors here too) may legitimately follow it — they don't contradict it. TASK lines below it mean convergence was RE-OPENED (a post-convergence fix wave) and the refresh never landed: the converged line is STALE, not corrupt — resume the fix wave/rounds and refresh it (a refresh REPLACES it at the end); never treat a stale one as current. Anything else after it (a foreign session's marks, a second converged line) is a contradiction — surface it, never trust it.
- The ledger stays current after every task — it is the recovery map after compaction; after compaction trust the ledger and `git log`, not conversation memory.
