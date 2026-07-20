---
read-on:
  - an implementation plan is being written or reviewed
home-of:
  - the plan standard (tracer-first, must_haves, no placeholders, task anatomy, approval tasks, context budget, self-review)
  - the one-new-complexity-source cap and baseline verification tiers
---
# Plan standard

A plan is written for an implementer with zero context on the codebase and questionable taste. They are a skilled developer who doesn't know our toolset, our domain, or good test design. A plan is a prompt, not a document that later becomes a prompt.

Save to: `docs/plans/YYYY-MM-DD-<feature>.md`, anchored to the repo root (`git rev-parse --show-toplevel`; outside any git repo — the cwd, named to the user — an arm reachable only OUTSIDE this pipeline, e.g. a draft written before bootup's git-init closes the gap: arcane's own input gate requires a repo before execution), never a repo subdirectory's cwd (user preferences override the default). In a git repo the plan is COMMITTED at approval, together with its premortem yaml once the verdict lands (under a campaign, the `planned` flip's state commit carries both to the base branch) — an uncommitted plan is machine-local and breaks resume anywhere else.

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

## One new complexity source per task, on a verified baseline

A task introduces at most ONE new source of complexity — a new dependency, a new concurrency pattern, a new data path, a new tool — on top of a passing baseline. When the task goes red, the cause is then attributable to the one thing that changed; two new sources per task turn every failure into a two-variable investigation. Doesn't fit in one task — propose a split, never bundle.

Baseline verification is tiered: **current run** (the gate ran in THIS session, output in hand) > **proven artifact** (a recorded passing run against this exact revision — a CI link, a journal/ledger line naming the head) > **claim** ("it worked", memory, a README sentence). A plan builds only on the first two tiers: a claim-tier baseline is restored and verified BEFORE new complexity lands on it — "it was green when I left it" is where multi-day debugging sessions are born.

## Task anatomy

Grammar-shaped lines are POSITIONAL: `**Type:**`/`**Files:**` belong to the task header, before the checklist steps — and before ANY list-shaped content: a checklist bullet, a `Steps:`/`**Steps:**` header, or a numbered item (`1.`/`1)`) all CLOSE the task header, so numbered constraint lists and other list-shaped prose go AFTER the Files field or inside a fence (the extractor refuses a Files line below list content rather than guess which list was steps). Any ILLUSTRATION of these shapes inside step bodies (tutorials, examples) MUST be fenced — an unfenced example is parsed as grammar (task-brief refuses a Files line after steps began, and harvesting an example into the write scope is the defect that rule exists to stop).

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

The gate loops until the user approves. An approval task is executed by the ORCHESTRATOR, never dispatched to an implementer: an implementer has no user channel, and a brief containing "ask the user" fails the readiness test — variant PRODUCTION may be dispatched as ordinary implementer tasks (executor tier; each variant an exact brief, zero open questions), but the presentation, the ask, and the recording are the orchestrator's own steps. Dependent tasks do not dispatch before it passes — building on an unapproved direction is speculative work that a taste reversal deletes wholesale. A plan that routes aesthetic acceptance through "tests pass" instead of an approval task is a plan defect.

## Migration and subtraction discipline

Absorbed from a principle-skill stack (journal 0.8.3), aligned with the family's no-partial-fix mandate:

- **Migrate callers, then delete — same wave.** A plan introducing a replacement API/mechanism migrates every caller and deletes the legacy path within the SAME plan; a compatibility layer or a dual path left "temporarily" is a plan defect, not a convenience. If the wave genuinely cannot land at once, that is a scoping decision the user makes explicitly — never the plan's silent default.
- **Subtract before you add.** When a task builds on cluttered ground, its first step removes the dead weight (unused branches, redundant validators, stub references) and only then builds on the simpler base — deletion first makes the addition smaller and the diff reviewable.
- **Exhaust the design space for novel decisions.** A plan facing an interface or architecture choice with NO precedent in the codebase does not commit to the first shape: 2-3 radically DIFFERENT candidate shapes are produced (parallel scouts each given the same requirements and told to differ structurally, not cosmetically), compared on the actual call sites, and the choice is recorded with its rejected alternatives. Decisions with existing precedent follow the precedent — this lens is for genuinely novel ground only. Candidate interfaces are compared on: surface size (fewest entry points that still serve the callers), general-purpose vs specialized fit, DEPTH (a small interface hiding substantial implementation is good; a wide interface over a thin implementation is the defect), and ease-of-correct-use vs ease-of-misuse — never on implementation effort (effort is paid once; the interface is paid by every caller forever).
- **Dependency category decides the test-double strategy** — name it in the plan for every reshaped boundary: an in-process dependency is merged or exercised directly (no double); a locally substitutable one (embedded DB, in-mem FS) is exercised against the stand-in; a remote-but-owned service gets a port at the boundary with an in-memory adapter for tests and the real adapter for prod; only a true external (third-party API) is mocked at the boundary. A plan that says "mock it" without naming the category defaults to over-mocking.

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
5. **No time estimates:** a plan names tasks and dependencies, never durations ("2-3 weeks", "quick") — estimates are noise that reads as commitment; effort is expressed only through the split signals above.

## Pre-flight (orchestrator, before Task 1)

One pass over the plan: tasks contradicting each other or the Global Constraints; anything the plan explicitly mandates that the review rubric treats as a defect (a test asserting nothing, verbatim duplication of a logic block). Everything found goes to the user as ONE batched question — each finding beside the plan text that mandates it, asking which governs — not one interrupt per discovery. Clean scan — proceed silently.
