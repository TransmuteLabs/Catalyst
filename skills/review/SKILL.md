---
name: review
description: Use for standalone code review outside the arcane-mode pipeline - "review this code", "review my PR", "check before merge", "what did I break". For task review inside the pipeline use arcane-mode's critic flow instead.
---

# Review — standalone review

## Overview

Reviewing existing code/diff/PR outside the arcane-mode pipeline, with the same discipline: structural facts are gathered by agents, semantic reasoning happens on top of facts, the verdict comes after adjudication. Inside the pipeline this skill isn't needed — that's the arcane-mode critic layer.

## Phase 1 — structural facts (agents, not you)

Determine the scope: `git diff --stat` (uncommitted / `--staged` / `--base-ref <ref>` / PR via `gh pr diff`). No changes — stop.

- If `tldr`/`bugbot` are on PATH — parallel agents run them (`bugbot check`, `impact`/`whatbreaks` on changed functions, `smells`/`complexity`, with a security focus — `secure`/`taint`) and return JSON verbatim, no retelling.
- Otherwise — scouts gather: the full diff to a file (`git diff -U10 > .catalyst/sdd/review-standalone.diff`), the changed functions and their callers (grep), the test baseline BEFORE/AFTER (`N passed; 0 failed; K ignored`), new skips/ignores.

Diff >500 lines — focus on the files with the highest density of phase-1 findings.

## Phase 2 — semantics (you, under arcane-mode discipline)

The critic rules from arcane-mode/references/dispatch-templates.md apply here too:
- **Authored probing questions** formulated before reading the diff: cross-interactions, guarantee semantics, "what was lost silently".
- **Hunt categories by change type**: refactor — AST drift, import direction, lost re-exports, stale mocks; bugfix — races, edge cases, swallowed errors, regression scope; always — vacuous-green ("does the test actually exercise the changed path?").
- **No pre-judging**: if the review was ordered with "don't look at X" — X gets checked like everything else, and the conflict goes to the user.
- For every phase-1 structural finding — read the actual code around it and judge: a real problem or acceptable in context; severity by actual risk.

## Verdict

**APPROVE | REQUEST_CHANGES | NEEDS_DISCUSSION**

```markdown
## Review: <scope>
**Verdict:** ...
### Structural facts       — table (lint/regressions/impact/security: counts)
### Blocking               — [severity] description, file:line, fact + semantics + concrete fix
### Warnings               — worth fixing, not blocking
### Observations           — complexity trends, architecture notes
### Test coverage          — changed functions with tests N/M; baseline BEFORE/AFTER; what to add
### Summary                — 2-3 sentences in plain language
```

Follow-up: blocking findings → fix through arcane-mode (fix plan + critic + re-review), never "I'll just patch it in this same review" — a reviewer who edits code stops being a reviewer.

## Red Flags — STOP

- A verdict issued without reading the actual code around the findings (tool facts ≠ a review).
- Severity copied from the linter without judging actual risk.
- The reviewer started fixing findings themselves in the same session.
- The test baseline not compared BEFORE/AFTER ("tests look green").
- The diff built as `HEAD~1` on a multi-commit branch — early commits are lost; only merge-base/an explicit BASE.
