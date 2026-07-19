---
read-on:
  - a critic dispatch is being written
home-of:
  - the critic dispatch template (authored probing questions, hunt categories, verdict form)
---
# Critic dispatch — template

Verbatim arcane-mode doctrine (0.7.x per-role split of dispatch-templates.md — that file keeps the shared, every-dispatch core). Where SKILL.md's sketch differs in detail, THIS file governs.

## Critic dispatch

All per-task critics are "standard" tier, always (sole exception: economics' availability fallback — executor at high effort, flagged to the user, never silent). The critic gets three paths: the brief, the implementer report, the review package (`<skill-dir>/scripts/review-package BASE HEAD` — the arcane-mode skill's own directory, not the project root; BASE recorded before the implementer dispatch — `HEAD~1` silently truncates multi-commit tasks) + the plan's Global Constraints block verbatim.

**Mandatory in every dispatch:**
- **Authored probing questions** from the orchestrator — concrete questions about this task's cross-interactions and semantic points. "Just review it" is a process smell.
- **Hunt categories by change type.** Refactor: AST drift, import direction, lost re-exports, stale mocks. Bugfix: races, edge cases, swallowed errors, regression scope. Always: "does the test actually exercise the changed path?" (vacuous-green), test-baseline BEFORE/AFTER — new tests must raise the counter; unexplained decreases and new `#[ignore]`/skips = a finding.
- **Adjudication requests:** the critic lists separately every place where it ACCEPTED a trade-off or a debatable call. The orchestrator re-reads them all — small volume, high miss density.

**Form of the constraints block in a critic prompt (a recipe, not a prohibition).** The critic learns about mandated decisions from exactly one channel: the plan's Global Constraints block, verbatim. Beyond it, the prompt contains zero sentences about what to flag or not flag, where to file a finding, or what severity to assign. Pre-send check: if the prompt contains a sentence whose subject or object is a specific potential finding ("the singleton", "this pattern", "such places") and whose verb is evaluation or routing ("doesn't count", "don't file", "route to…", "rate as…") — delete it; the mandate is already visible in the Constraints.

Pre-judging doesn't stop being pre-judging when rephrased — and it doesn't stop when relabeled: a "how to treat X" paragraph framed as context ("this is context, not a gag order", "don't spend the pass re-litigating X — it's decided", "route that one to adjudication requests, don't file it") is the same bypass as the blunt forms. Semantic equivalents of "do not flag" — "the mere use of X is not a defect", "don't file a separate finding for X", "X goes only into adjudication requests, not findings", "treat as Minor at most", "don't evaluate the choice of X — it's already decided" — all get deleted by the same pre-send check, however they're framed (observed rationalizations: "this isn't a restriction, it's grounding/routing", "it's context, not a command to be silent"). The critic already knows to route mandate-matching findings to adjudication requests — that's ITS rule (agents/critic.md); the orchestrator writing it into the prompt about a NAMED mechanism is the suppression. The economics favor deletion: a false positive costs one adjudication line, a blind spot on an actively used mechanism is a potential Critical.

Two verdicts are mandatory: spec compliance AND code quality. A report missing either is not accepted.

