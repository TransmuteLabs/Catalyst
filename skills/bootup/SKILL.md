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
- If ContinuousClaude's readiness tooling is available — verify by actually running `ContinuousClaude --version` and checking the output starts with `ContinuousClaude <semver>` (a name on PATH alone proves nothing — the historical `cc` name collided with the system C compiler, which is why the binary was renamed). Toolchain absent or not responding → offer catalyst:install (the doctor) before falling back to manual scouting; the user decides. If confirmed, an executor runs on a brief: `ContinuousClaude readiness` → `ContinuousClaude readiness-fix` → `readiness` again; report: level before/after, files created, failing criteria. The dispatcher receives numbers, not contents.
- Otherwise — a scout gathers facts against the checklist (facts only, file:line): build command known and working? test command + current baseline (`N passed; 0 failed`)? linter/formatter/type-checker configured? `.gitignore` covers artifacts? README with build/run? pre-commit hooks? one-command dev setup?
- Mechanical gaps (linter/formatter configs, .gitignore, Makefile targets) are closed by an executor on an exact brief (paths scope: configs only, **source code untouched**). A missing git repository IS a mechanical gap — for a NEW project (or a directory that isn't a repo), `git init` + an initial commit close it first: every downstream family skill hard-requires a repo (arcane's per-task commits, campaign/starchart committed state, the `.catalyst/` root anchor), and without it the failure surfaces three skills later instead of here. Semantic gaps (README, test scaffolding) — a separate brief, also without touching sources.

**3. Readiness verdict to the user:** level/gaps in one table. Raw project (no build/tests) → propose a readiness pass as separate work before features; the user decides.

**4. Routing** — first check for an active campaign: the scout runs `ls "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"/.catalyst/campaign/*/ROADMAP.md` (anchored to the repo root — a session opened in a subdirectory must not miss the root campaign; outside a git repo the fallback is the cwd and finding nothing is correct) AND returns each found campaign's PROGRAM.md `status:` line (and, when the user's intent points at an existing spec, that spec's `status:` marker) — the dispatcher routes on returned facts, never on its own file reads. An ACTIVE campaign exists (skip `status: complete`) → offer it as the default route ("campaign <name> is active — continue it?") before the open question; several active → list them, the user picks. Otherwise ask the user "what are we kicking off?" and hand over:

| Intent | Skill |
|---|---|
| Explore/understand, answer unknown | catalyst:research |
| Large foggy effort (> one session) | catalyst:starchart |
| Multi-phase program toward a milestone | catalyst:campaign |
| Feature/decision — needs a spec | catalyst:crucible |
| Approved spec exists (`status: approved` in the file; a markerless spec is a draft → crucible) | catalyst:arcane-mode |
| Review existing code/PR | catalyst:review |
| Continue a previous session | catalyst:handoff (resume) |

## Red Flags — STOP

- The dispatcher opened source files "to understand the project" — that's scout work; readiness scripts detect the stack without reading code.
- Readiness fixes touched source code rather than configs.
- Routing chosen for the user when the intent was ambiguous.
