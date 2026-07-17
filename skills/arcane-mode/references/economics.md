# Dispatch economics — effort, budget, availability

Tiering (SKILL.md) decides WHO thinks; this reference decides HOW HARD and HOW MANY. Both dials are set per dispatch, and both degrade under real-session constraints without ever degrading the decision boundary silently — the one sanctioned boundary exception (availability fallback below) is always flagged to the user.

## Effort — a second dial, orthogonal to model tier

Route effort by the task's residual ambiguity, not by its model tier: an "executor"-tier task is low/medium effort *because its brief resolved the forks*, and a "standard"-tier mechanism can still be medium effort when the spec fully fixed the design.

| Effort | Use for | Signal |
|---|---|---|
| low | Scouts running fixed queries, mechanical fix waves, gate re-runs | zero judgment calls in execution |
| medium | Implementers with a complete brief (the default) | the brief resolved the forks |
| high | Critics, auditors, debuggers, implementers facing tradeoffs the plan left open | judgment calls remain at execution time |

Role floors: reviewers/critics/auditors never below high; verification-command runs never above low.

**Escalation order (within the "standard"+ tiers — executor failures classify via the statuses table, see Precedence):** a "failure" = a delivery that fails verification/review (the original weak delivery is failure #1 — same counting as the dispatch-templates ladder). First failure → same model, effort one level up = that ladder's rework #1; the ladder continues there (failure #2 → rework #2, same agent; failure #3 → a FRESH agent), effort staying at the raised level — this order raises effort before considering any model change. **Never raise effort as a substitute for a missing brief** — if the agent is guessing because the brief is incomplete, fix the brief, not the effort.

**Precedence — the three ladders never compete, they answer different events:** an explicit BLOCKED status routes by the statuses table in dispatch-templates (context problem → supply it; "needs more reasoning" → tier up: an executor brief with zero open questions that still lacks reasoning was mis-tiered, and effort will not fix a classification error). The effort-first order above governs weak or failed results within the "standard"+ tiers. Rework of review findings goes to the same agent (the dispatch-templates ladder). Statuses table > effort dial > rework ladder, by event type. An executor-tier result that fails the consumer's verification WITHOUT reporting BLOCKED (e.g. scout coordinates that don't spot-check) is treated as BLOCKED "needs more reasoning" — classify the event, then apply its ladder.

## Budget degradation — collapse agents, never planning or review

Every subagent costs fixed overhead (system prompt, reading the brief, reporting) before it does any work; when budget shrinks, the overhead-to-work ratio is what kills you. Budget state comes only from the user's words or runtime signals (rate-limit errors, degraded responses) — never from a guess presented as fact. No budget concern raised → rung 1, the default pipeline; budget raised as a concern but unquantified → rung 2, not the optimistic top.

Degradation ladder (each step keeps spec → plan → premortem → verification intact):

1. **Full pipeline** — as written.
2. **Collapsed fleet** — batch small same-area tasks into one implementer dispatch; batch gate re-runs per group; orchestrator grounds briefs itself instead of dispatching scouts for small codebases. Per-task critic review survives.
3. **Orchestrator-executes** — the orchestrator implements the remaining plan itself in task order, granular commits per task. Per-task review persists here too: a critic reviews each task's diff (batched per group at minimum) — the fleet collapse removes implementers, never reviewers.

**The review floor does not degrade silently:** the fresh-eyes convergence audit and the final whole-branch review are never collapsed into self-review on your own initiative — dropping them is an explicit user decision, offered with the cost stated, and RECORDED where the evidence would have lived: the ledger's `verification: waived by user <date> — <scope>` line (verification.md), under a campaign surfacing as the `verified (waived: <date>)` stamp — a standing record no resumed session re-demands, and one no reader mistakes for rounds that ran. On a runtime budget signal: finish the in-flight agent, drop one step down, tell the user in one line — never silently keep dispatching into a rate limit.

## Model availability — discovered, not assumed

The tier mapping is the ideal, not an assumption. **A failed spawn is data:** a model erroring as unavailable updates the session's ladder — don't retry it per task. Fallbacks preserve the decision boundary: top unavailable → the orchestrator holds top-role ORCHESTRATION itself, but clean-context review roles (fresh-eyes rounds, an oversized final review) fall to "standard"-tier subagents instead — clean context beats tier there, and the substitution is flagged to the user (never a silent slide into self-review); "standard" unavailable → executor model at high effort, flagged to the user as elevated risk on analysis tasks (never silently); executor unavailable → "standard" at medium effort (paying more per token, not more thinking). If the user's plan meters models unevenly, ask once and route by what is actually cheap *for this user*.
