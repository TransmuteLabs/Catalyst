---
name: debug
description: Use when facing a bug, test failure, or unexpected behavior whose cause is not yet proven - before proposing or applying any fix. Also when a previous fix didn't hold, or debugging spans context resets. Triggers - "why is this failing", "it broke", flaky behavior, a fix that didn't stick.
---

# Debug — root cause before fixes

## Overview

Random fixes waste time and mask real defects. This skill is the family's debugging discipline: prove the root cause, then fix it completely — never patch the symptom. Debugging is analysis: under the family tiering it never runs on the executor tier; a dispatched debugger is "standard" minimum, and the verdict on the cause is adjudicated by the orchestrator.

**Iron Law: NO FIX WITHOUT A PROVEN ROOT CAUSE.** A fix proposed before the cause is demonstrated is a guess, even when it "obviously" works.

## Debug state survives the session

Non-trivial investigations outlive context windows. Keep the state in `.catalyst/debug/<slug>.md` from the first hypothesis on:

```markdown
# <slug> — <symptom, one line>
status: investigating | cause-proven | fixing | resolved
repro: <exact command + observed output, or NOT-YET>
evidence: - <fact, file:line / command output>   # facts only, no guesses
hypotheses: - H1 <statement> → tested <how> → rejected/confirmed
fixes-tried: - <change> → <result>               # count them
```

After a compaction or in a new session: trust this file and `git log`, not conversation memory. Resuming = reading the file, not re-deriving.

## The four gates

Pass them in order; each gate's output lands in the state file.

1. **Reproduce.** An exact command that triggers the failure, run now, output captured honestly (`set -o pipefail`, exact test baseline `N passed; 0 failed; K ignored` — never a piped tail). Can't reproduce → gather more evidence; do not guess. Read the full error text — stack traces usually name the answer.
2. **Localize.** Recent changes first (`git log`/diff against the last known-good). In multi-component paths, instrument each boundary (what enters, what exits) and run once — find WHERE it breaks before reasoning about WHY. Trace the bad value backward to its origin; the fix belongs at the source, not where the error surfaced.
3. **Prove.** One written hypothesis: "X is the root cause because Y". Test it with the smallest possible change or probe — one variable at a time. Rejected → write it down, form the next one. Confirmed → the cause is proven only when the evidence excludes the alternatives, not when the story sounds plausible.
4. **Fix.** First a failing test that reproduces the defect (watch it fail); then ONE fix at the proven source; then the test passes and the full baseline holds BEFORE/AFTER. No bundled refactoring, no "while I'm here". The defect gets fixed completely — never legitimized (no retry-masking, no "accept the limitation", no test pinned to the broken behavior).

## The 3-fix rule

Count `fixes-tried`. After the 3rd failed fix, STOP: this is no longer a bug, it is an architecture question. Each failed fix that surfaces a new symptom elsewhere is evidence of a wrong pattern, not bad luck. Take the evidence trail to the user and question the design — do not attempt fix #4 silently.

## Inside vs outside the pipeline

- Inside arcane-mode: an implementer hitting an unexpected failure follows its stop rule (one honest repro attempt → BLOCKED with raw output). The ORCHESTRATOR then runs this skill — the implementer never root-causes.
- Standalone ("why is this failing?"): the deliverable is the proven cause and the evidence; apply the fix only when the user asked for a fix.

## Red Flags — STOP

- "Quick fix now, investigate later" / "just try changing X and see".
- Two changes tested at once — a confirmed hypothesis can't be attributed.
- A fix without a failing test that reproduced the defect first.
- A retry/sleep/timeout added where the cause is unknown — that is masking, not fixing.
- Fix #4 about to be attempted without an architecture conversation.
- A green re-run declared from memory instead of a fresh command on the current state.
- Debug findings living only in conversation — the state file was never written.
