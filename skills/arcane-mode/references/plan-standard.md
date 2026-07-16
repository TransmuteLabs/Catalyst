# Plan standard

A plan is written for an implementer with zero context on the codebase and questionable taste. They are a skilled developer who doesn't know our toolset, our domain, or good test design. A plan is a prompt, not a document that later becomes a prompt.

Save to: `docs/plans/YYYY-MM-DD-<feature>.md` (user preferences override the default).

## Plan header (required)

```markdown
# <Feature> Implementation Plan

**Goal:** [one sentence — what we are building]
**Architecture:** [2-3 sentences on the approach]

## Global Constraints
[The spec's project-wide requirements verbatim: version floors, dependency
limits, naming rules, platform — one line each. Every task's requirements
implicitly include this section.]

## must_haves
truths:      [observable behaviors proving the goal is met]
artifacts:   [files that must exist]
key_links:   [critical connections: "X actually calls Y", "data from Z reaches the UI"]
```

`must_haves` is the input for goal-backward verification (see verification.md). Derived from the goal, not from the task list.

## Tracer-first (default)

The first task of every plan is a `tracer`: the thinnest slice that passes end-to-end through every layer the plan will touch. Production quality, not a prototype: a real verification, an atomic commit, it becomes the skeleton of the system. Stubs are allowed only where they can later be filled without an architectural change: functional gaps yes, architectural gaps no.

**Gate:** until the tracer passes its end-to-end check, no expansion task runs. An architectural dead-end is caught after one commit, not ten.

Opting out of tracer-first is allowed only when the architecture is already proven and a thin slice adds no information; the plan states this explicitly with the reason.

## Task anatomy

```markdown
### Task N: <action-oriented name>

**Files:**
- Create: exact/path/file.py
- Modify: exact/path/existing.py:123-145
- Test: tests/exact/path/test.py

**Interfaces:**
- Consumes: [what this task takes from earlier tasks — exact signatures]
- Produces: [what later tasks rely on — names, parameter and return types.
  An implementer sees only their own task; this block is the only channel
  through which they learn the names and types of neighboring tasks.]

Steps as checkboxes, one action per step (2-5 min):
- [ ] write the failing test (test code inside the step)
- [ ] run it, confirm it fails (command + expected output)
- [ ] minimal implementation (code inside the step)
- [ ] run it, confirm it passes
- [ ] commit
```

## Approval tasks (aesthetic / user-taste gates)

Work whose acceptance criterion is the user's taste — UI, visual design, layout, typography, tone of generated text — cannot be verified goal-backward by tests alone. The plan encodes it as an explicit **approval task** placed BEFORE the implementation tasks that depend on the chosen direction:

```markdown
### Task N: <direction> approval gate
**Type:** approval
- [ ] produce 2-3 concrete variants (real artifacts: rendered screens/snippets, not descriptions)
- [ ] present to the user, ask which direction (or what to change)
- [ ] record the chosen direction; it becomes verbatim context for dependent tasks
```

The gate loops until the user approves. Dependent tasks do not dispatch before it passes — building on an unapproved direction is speculative work that a taste reversal deletes wholesale. A plan that routes aesthetic acceptance through "tests pass" instead of an approval task is a plan defect.

## No Placeholders — these are plan defects

Never write:
- "TBD", "TODO", "implement later", "fill in details"
- "add appropriate error handling / validation / edge cases"
- "write tests for the above" without actual test code
- "Similar to Task N" — repeat the code: tasks may be read out of order
- steps that describe WHAT without HOW (a code step must contain code)
- references to types/functions not defined in any task

## Ban on simplification language

Forbidden patterns in tasks: "v1", "v2", "simplified version", "static for now", "hardcoded for now", "future enhancement", "basic/minimal version", "will be wired later", "skip for now" — any wording that reduces a spec decision to less than what was specified.

If the spec says "the cost is computed from the billing table" — the plan must deliver the computation from the billing table, not a "static label as v1". Doesn't fit — propose a split, never a cut.

## Planner authority

The planner does not decide what is "too hard". There are exactly three legitimate reasons to split or flag:

1. **Context budget** — implementation would consume >50% of one agent's window.
2. **Missing information** — required data absent from every source artifact.
3. **Dependency conflict** — the feature can't be built until another phase ships.

None of the three apply — the feature gets planned. Period.

## Context budget

A plan completes within ~50% of the executing session's context (not 80%): no context anxiety, headroom for unexpected complexity. Guideline: 2-3 tasks per plan; >3 tasks, multiple subsystems (DB+API+UI), a task touching >5 files — split signals.

## Plan self-review (author's checklist, not a subagent)

1. **Spec coverage:** for each spec section/requirement — can you point at the task implementing it? Gaps → add tasks.
2. **Placeholder scan:** grep the plan for the patterns from "No Placeholders" and "Ban on simplification language". Found → fix.
3. **Type consistency:** do signatures/names in later tasks match those defined in earlier ones? `clearLayers()` in Task 3 and `clearFullLayers()` in Task 7 is a plan bug.
4. **must_haves derivable:** every truth is reachable by composing the tasks; every key_link is actually laid by someone.

## Pre-flight (orchestrator, before Task 1)

One pass over the plan: tasks contradicting each other or the Global Constraints; anything the plan explicitly mandates that the review rubric treats as a defect (a test asserting nothing, verbatim duplication of a logic block). Everything found goes to the user as ONE batched question — each finding beside the plan text that mandates it, asking which governs — not one interrupt per discovery. Clean scan — proceed silently.
