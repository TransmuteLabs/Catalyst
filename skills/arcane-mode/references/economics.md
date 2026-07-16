# Dispatch economics — effort, budget, availability

Tiering (SKILL.md) decides WHO thinks; this reference decides HOW HARD and HOW MANY. Both dials are set per dispatch, and both degrade under real-session constraints without ever degrading the decision boundary itself.

## Effort — a second dial, orthogonal to model tier

Route effort by the task's residual ambiguity, not by its model tier: an "executor"-tier task is low/medium effort *because its brief resolved the forks*, and a "standard"-tier mechanism can still be medium effort when the spec fully fixed the design.

| Effort | Use for | Signal |
|---|---|---|
| low | Scouts running fixed queries, mechanical fix waves, gate re-runs | zero judgment calls in execution |
| medium | Implementers with a complete brief (the default) | the brief resolved the forks |
| high | Critics, auditors, debuggers, implementers facing tradeoffs the plan left open | judgment calls remain at execution time |

Role floors: reviewers/critics/auditors never below high; verification-command runs never above low.

**Escalation order:** first failure → same model, effort one level up, before considering a model change; second failure at high → the fresh-agent ladder (dispatch-templates), still at high. **Never raise effort as a substitute for a missing brief** — if the agent is guessing because the brief is incomplete, fix the brief, not the effort.

## Budget degradation — collapse agents, never planning or review

Every subagent costs fixed overhead (system prompt, reading the brief, reporting) before it does any work; when budget shrinks, the overhead-to-work ratio is what kills you. Budget state comes only from the user's words or runtime signals (rate-limit errors, degraded responses) — never from a guess presented as fact. Unknown budget → assume the middle, not the optimistic top.

Degradation ladder (each step keeps spec → plan → premortem → verification intact):

1. **Full pipeline** — as written.
2. **Collapsed fleet** — batch small same-area tasks into one implementer dispatch; batch gate re-runs per group; orchestrator grounds briefs itself instead of dispatching scouts for small codebases. Per-task critic review survives.
3. **Orchestrator-executes** — the orchestrator implements the remaining plan itself in task order, granular commits per task.

**The review floor does not degrade silently:** the fresh-eyes convergence audit and the final whole-branch review are never collapsed into self-review on your own initiative — dropping them is an explicit user decision, offered with the cost stated. On a runtime budget signal: finish the in-flight agent, drop one step down, tell the user in one line — never silently keep dispatching into a rate limit.

## Model availability — discovered, not assumed

The tier mapping is the ideal, not an assumption. **A failed spawn is data:** a model erroring as unavailable updates the session's ladder — don't retry it per task. Fallbacks preserve the decision boundary: top unavailable → orchestrator holds top-role work itself; "standard" unavailable → executor model at high effort, flagged to the user as elevated risk on analysis tasks (never silently); executor unavailable → "standard" at medium effort (paying more per token, not more thinking). If the user's plan meters models unevenly, ask once and route by what is actually cheap *for this user*.
