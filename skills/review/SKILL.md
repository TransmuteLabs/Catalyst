---
name: review
description: Use for standalone code review outside the arcane-mode pipeline - "review this code", "review my PR", "check before merge", "what did I break" - and for cleanup requests like "clean this up / remove the AI slop" (the deslop pass). For task review inside the pipeline use arcane-mode's critic flow instead.
---

# Review — standalone review

## Overview

Reviewing existing code/diff/PR outside the arcane-mode pipeline, with the same discipline: structural facts are gathered by agents, semantic reasoning happens on top of facts, the verdict comes after adjudication. Inside the pipeline this skill isn't needed — that's the arcane-mode critic layer. "Something broke and the cause is unknown" is not a review either — that's catalyst:debug; review judges a diff, it doesn't root-cause failures.

## Phase 1 — structural facts (agents, not you)

Determine the scope: for uncommitted work start from `git status --porcelain -uall`, NOT `git diff --stat` alone — `git diff` is blind to untracked new files (`??` rows), and a pre-commit review with brand-new source/test files would otherwise issue a verdict over a silently partial diff (`-uall` matters: without it a new DIRECTORY collapses to one `dir/` row and its files escape the per-file capture). The tracked capture for this scope is `git diff HEAD -U10` — bare `git diff` misses STAGED modifications (worktree-vs-index; proven), `HEAD` covers staged+unstaged together; on an unborn HEAD (a repo before its first commit — `git diff HEAD` exits 128 there, proven) capture `git diff --staged -U10` plus the untracked appends instead. Untracked files are captured as new-file diffs: `git diff --no-index /dev/null <path>` per file, appended with `;`/newlines, NEVER `&&` — `--no-index` exits 1 for every non-empty file (exit 1 IS success there; an `&&` chain silently truncates after the first file). Other scopes: `--staged` alone when asked / against a base ref via `git diff <base-ref>...HEAD` / PR via `gh pr diff`. No changes — stop.

- If `tldr`/`bugbot` respond as themselves (verify by response — e.g. `tldr --version` names the code analyzer; a name on PATH proves nothing, the tldr-pages collision is the canonical trap) — parallel agents run them (`bugbot check`, `impact`/`whatbreaks` on changed functions, `smells`/`complexity`, with a security focus — `secure`/`taint`) and return JSON verbatim, no retelling.
- Otherwise — scouts gather: the full diff to a file (`cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && mkdir -p .catalyst/sdd && { [ -f .catalyst/sdd/.gitignore ] || printf '*\n' > .catalyst/sdd/.gitignore; } && git diff HEAD -U10 <or the other scope args from above> > .catalyst/sdd/review-standalone.diff` — the SAME scope determined in the first line (`--staged` / `<base-ref>...HEAD` / for a PR use `gh pr diff`; uncommitted scope appends the untracked new-file diffs per above), the anchor embedded in the command itself so a subdirectory scout can't fork a sibling workspace, and the workspace self-ignores even when the arcane scripts never ran), the changed functions and their callers (grep), the test baseline BEFORE/AFTER (`N passed; 0 failed; K ignored`), new skips/ignores. The BEFORE baseline never stashes or checks out over the user's working tree: it runs in a separate WORKTREE at the scope's base — created and removed by the REVIEWING SESSION ITSELF, never by a scout (a scout's non-overridable core forbids git-state mutation; the scout only runs the measurement inside the prepared worktree): `git worktree add --detach <tmp> HEAD` for the uncommitted scope, `--detach $(git merge-base <base-ref> HEAD)` for base-ref/PR scopes (the scope's diff is merge-base semantics — a worktree at the base TIP would blame base-side changes on the branch; a bare branch name also fails when checked out anywhere), `<tmp>` under the system temp dir — never inside the repo, where it would pollute later captures — removed right after the measurement with `git worktree remove --force <tmp>` (test runs leave untracked artifacts; a plain remove refuses); on an unborn HEAD the base is the empty tree — no BEFORE tests exist by definition: record `BEFORE: none (unborn HEAD)`; outside git there is no separable base — record the absence honestly, never fake a baseline — the user's tree is never mutated for a measurement.

Diff >500 lines — focus on the files with the highest density of phase-1 findings.

The `.catalyst/sdd` workspace is single-writer — one arcane/review session per checkout (arcane-mode `references/verification.md`); a live arcane effort in this checkout means the review runs from its own worktree — EXCEPT the capture itself on the uncommitted scope: the dirty tree exists only in the live checkout (a linked worktree sees a clean tree), so the capture command runs THERE with its REDIRECT overridden to the review worktree's absolute workspace path (`… > <review-worktree>/.catalyst/sdd/review-standalone.diff` — the embedded anchor still resolves the SCOPE from the live tree; only the write moves, and the live effort's workspace is never written). All `.catalyst/` paths anchor to the repo root (`git rev-parse --show-toplevel`; outside any git repo the cwd IS the root — name it to the user), never a repo subdirectory's cwd — a session opened in a subdirectory that creates `<subdir>/.catalyst/sdd/` escapes the single-writer rule as an invisible sibling.

## Phase 2 — semantics (you, under arcane-mode discipline)

The critic rules from arcane-mode/references/dispatch-templates.md apply here too:
- **Authored probing questions** formulated before reading the diff: cross-interactions, guarantee semantics, "what was lost silently".
- **Hunt categories by change type**: refactor — AST drift, import direction, lost re-exports, stale mocks; bugfix — races, edge cases, swallowed errors, regression scope; always — vacuous-green ("does the test actually exercise the changed path?").
- **No pre-judging**: if the review was ordered with "don't look at X" — X gets checked like everything else, and the conflict goes to the user.
- For every phase-1 structural finding — read the actual code around it and judge: a real problem or acceptable in context; severity by actual risk.

## Verdict

**APPROVE | REQUEST_CHANGES | NEEDS_DISCUSSION** — written to `.catalyst/sdd/review-verdict-<ISO date>_<HH-MM>.md` (the workspace, beside the diff; the time part keeps a same-day second review from overwriting the first — consumers take the latest by filename) BEFORE delivery: the verdict and findings are what the follow-up routes consume and what an interrupted review resumes from — a verdict living only in chat evaporates (the family's artifact doctrine).

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

Follow-up: findings are fixed outside the open review, never woven into it — a reviewer who edits code mid-review stops being a reviewer. Task-sized findings → arcane-mode (fix plan + critic + re-review; its input gate wants an approved spec — the verdict already contains the decisions, so crucible's FAST PATH synthesizes the spec from them, section approvals only, never a fresh interview). A small obvious fix (< ~20 lines, arcane's own do-it-yourself threshold) → apply it AFTER the verdict is delivered, then re-run phases 1-2 on the new diff; the ban is on editing while the review is open, not on fixing after the verdict.

## Deslop mode — cleaning up agent-generated slop

When the request is "clean this up / remove the AI slop" rather than a verdict, run a deletion-first cleanup pass:

1. **Classify before editing.** Sweep the scope and tag findings by slop class: duplication (the same logic re-implemented instead of reused), dead code (unreachable, unused exports, commented-out blocks), needless abstraction (a layer with one caller and no second use in sight), boundary violations (imports against the architecture's direction), missing tests on changed behavior, defaulted UI styling (framework-default colors/shadows/grids kept where a design exists).
2. **Lock behavior first.** Before touching code, add the narrowest regression test over the affected behavior (or record the verification command when a test seam doesn't exist).
3. **One slop class per pass**, ordered safest-first: dead code → duplication → needless abstraction → boundary violations → missing tests → defaulted UI styling (the step-1 classes, same names). Re-run the covering tests after each pass; never bundle unrelated cleanup into one diff. Deletion beats addition — measure the pass by lines removed, not rewritten.

## Red Flags — STOP

- A verdict issued without reading the actual code around the findings (tool facts ≠ a review).
- Severity copied from the linter without judging actual risk.
- The reviewer started fixing findings while the review was still open (post-verdict small fixes and a requested deslop pass are separate engagements, not this).
- The test baseline not compared BEFORE/AFTER ("tests look green").
- The diff built as `HEAD~1` on a multi-commit branch — early commits are lost; only merge-base/an explicit BASE.
- A verdict issued over a capture that silently misses files its sanctioned scope includes (bare `git diff` muscle memory on the default uncommitted scope, whose capture is `git status --porcelain -uall` + `git diff HEAD` + the `--no-index` appends; staged-only, base-ref, PR, and unborn-HEAD scopes use their own recipes above) — the verdict covers only what the capture holds.
