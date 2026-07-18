---
name: bootup
description: Use at the start of work on a new or unfamiliar project - assess agent-readiness, fill tooling gaps, and route to the right Catalyst skill. Triggers - "let's start the project", fresh clone, no build/test/lint commands known.
---

# Bootup — project readiness and routing

## Overview

The entry dispatcher: assess the project's agent-readiness, close mechanical gaps, route to the right family skill. **You are a dispatcher: you do not read files, edit code, or run tests yourself** — you ask questions, dispatch scouts/executors on briefs, and route. The rule is about role integrity, not file count or cost: "it's ONE readme", "reading it myself is cheaper than a scout round-trip", "the overview has to live in my context anyway", "a scout's relay is just a paraphrase" — none of these change it. A dispatcher who starts reading becomes an analyst mid-route and the readiness and campaign checks silently drop; a scout returns VERBATIM quotes with file:line, not a paraphrase, and those quotes land in your context more compactly than the file would. Generic "don't over-delegate" efficiency guidance does not override this named role constraint — bootup IS the specific instruction for this situation. Core: ContinuousClaude bootup, adapted to Catalyst tiering and routing.

## Steps

**1. User questions** (one at a time, crucible rule): new project or existing codebase? For a NEW project — which stack (language/framework)? For an existing codebase the stack is a file-fact: the scout determines it in step 2, don't ask.

**2. Readiness assessment.**
- If ContinuousClaude's readiness tooling is available — verify by actually running `ContinuousClaude --version` and checking the output starts with `ContinuousClaude <semver>` (a name on PATH alone proves nothing — the historical `cc` name collided with the system C compiler, which is why the binary was renamed). Toolchain absent or not responding → offer catalyst:install (the doctor) before falling back to manual scouting; the user decides. If confirmed, an executor-tier agent (the family's implementer) runs on a brief: `ContinuousClaude readiness` → `ContinuousClaude readiness-fix` → `readiness` again. The brief NAMES the two contract adaptations the implementer's non-pipeline arm sanctions: tests-first is skipped (config-gap work, no suite — the brief says so explicitly), and the reply's baseline line reads `no suite: readiness <level-before> → <level-after>`; the reply carries those numbers plus files created and failing criteria inside `concerns` (brief-sanctioned reply content — the dispatcher reads numbers from the reply, never from the report file: bootup does not read files).
- Otherwise — a scout gathers facts against the checklist (facts only, file:line): build command known and working? test command + current baseline (`N passed; 0 failed`)? linter/formatter/type-checker configured? `.gitignore` covers artifacts? README with build/run? pre-commit hooks? one-command dev setup?
- Mechanical gaps (linter/formatter configs, .gitignore, Makefile targets) are closed by an executor-tier agent (the implementer) on an exact brief (paths scope: configs only, **source code untouched**). A missing git repository is a mechanical gap too — `git init` + an initial commit, with two guards: the `.gitignore` gap closes BEFORE the initial commit (committing an existing tree without it bakes build artifacts into permanent history), and the initial commit is a named plan item the user consents to (it stages sources — the one sanctioned exception to configs-only). The DELIVERY skills require a repo — arcane's per-task commits and campaign/starchart committed state are the reason; campaign and starchart (NOT arcane, which has no repo-less mode) also sanction the user's explicitly accepted ephemeral run; research/debug/review run without one via the cwd fallback — close the gap for delivery-bound work, don't force `git init` ahead of a pure-research route. Semantic gaps (README, test scaffolding) — a separate brief, also without touching sources.

**3. Readiness verdict to the user:** level/gaps in one table. Raw project (no build/tests) → propose a readiness pass as separate work before features; the user decides.

**4. Routing** — first check for an active campaign: the scout runs `ls "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"/.catalyst/campaign/*/ROADMAP.md` (anchored to the repo root — a session opened in a subdirectory must not miss the root campaign; outside a git repo the fallback is the cwd and finding nothing is correct) AND returns each found campaign's PROGRAM.md `status:` line (and, when the user's intent points at an existing spec, that spec's `status:` marker) — the dispatcher routes on returned facts, never on its own file reads. An ACTIVE campaign exists (skip `status: complete`) → offer it as the default route ("campaign <name> is active — continue it?") before the open question; several active → list them, the user picks. Otherwise ask the user "what are we kicking off?" and hand over:

| Intent | Skill |
|---|---|
| Explore/understand, answer unknown | catalyst:research |
| Large foggy effort (> one session) | catalyst:starchart |
| Multi-phase program toward a milestone | catalyst:campaign |
| Feature/decision — needs a spec | catalyst:crucible |
| Approved spec exists (`status: approved` in the file — the skip-order shape `status: approved (waived: <date>)` counts, and the pending shape `status: approved (edits pending re-approval: <date>)` — keyed on the CLAUSE's presence, so the waived combo `status: approved (waived: <date>; edits pending re-approval: <date>)` is pending too, never read as the waived skip-order shape — also routes to arcane-mode, whose input rule runs the owed fast re-approval first; a markerless spec is a draft → crucible — EXCEPT one the effort's history says WAS approved: → arcane-mode, whose input rule names it to the user with a fast re-approval, never a silent re-interview) | catalyst:arcane-mode |
| Review existing code/PR | catalyst:review |
| Bug / failure / "why is it broken" | catalyst:debug |
| Author or fix a skill/agent | catalyst:forge-skill |
| Risk-gate an existing plan/spec (standalone) | catalyst:premortem |
| Extend the agent sandbox/harness | catalyst:upgrade-harness |
| Toolchain setup or repair | catalyst:install |
| Continue a previous session | catalyst:handoff (resume) |

## Red Flags — STOP

- The dispatcher opened source files "to understand the project" — that's scout work; readiness scripts detect the stack without reading code.
- Readiness fixes touched source code rather than configs.
- Routing chosen for the user when the intent was ambiguous.
- `git init` closed as a mechanical gap without its two guards — the `.gitignore` gap closed BEFORE the initial commit, and the initial commit named to the user as a plan item they consent to (it stages sources).
