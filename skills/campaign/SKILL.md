---
name: campaign
description: Use for a program of work spanning many sessions and multiple arcane-mode runs - several phases toward a milestone, "what's next in the project", resuming a long effort, or closing out a milestone. Not for a single feature (crucible → arcane-mode) or a single foggy decision map (starchart).
---

# Campaign — the program layer

## Overview

Arcane-mode executes one plan; a campaign is the umbrella above many of them: a roadmap of phases toward a milestone, alive across weeks and dozens of sessions. The orchestrator surfacing from one finished branch must never navigate from memory — the campaign state answers "where are we and what's next". Core: GSD's roadmap/milestone lifecycle, reduced to two files over the existing family (no tracker, no config layer).

**Campaign decides sequence; each phase is still delivered by the family flow** (crucible → premortem → arcane-mode → verification). The campaign never re-implements those skills' jobs.

## State (two files)

`<repo>/.catalyst/campaign/<name>/`:

```markdown
# PROGRAM.md
## Intent          — what this campaign must make true, 3-6 sentences; the milestone
                     audit runs against THIS text, not against the phase list
## Non-goals       — what it deliberately won't do
## Milestones      — M1, M2… each with its own must_haves (truths/artifacts/key_links)
## Decision log    — D-01… one line per program-level decision + why

# ROADMAP.md
## Phases          — table: id | phase | milestone | status | links
                     status: pending → specced → planned → executing → verified → done
                     links: spec path, ledger path, handoffs — as they appear
## Parked          — phases deferred by an explicit user decision (with the reason)
```

Rules: PROGRAM.md and ROADMAP.md are **committed to the repo** — they are the program's memory for weeks and must survive `git clean`, clones, and machine changes (commit after every status change; unlike the ephemeral self-ignored `.catalyst/` workspaces). ROADMAP is an index — details live in the linked specs/ledgers. Status changes only with evidence (a spec file exists → specced; premortem passed + plan written → planned; ledger shows tasks closing → executing; arcane verification converged → verified; user accepted → done). Roadmap edits that change scope (add/remove/reorder phases) are user decisions, logged in the Decision log — never silent.

## Router — every campaign session starts here

Read ROADMAP.md (and nothing else yet). Take the first milestone not yet closed in PROGRAM.md: if ALL its phases are `done`, the route is its milestone audit — a later milestone's pending phases never skip an unclosed earlier one past its audit. Otherwise route by that milestone's first phase whose status is not `done`:

| State found | Route |
|---|---|
| Phase `executing` | resume it: its ledger + `git log` are the truth (arcane-mode rules) — never start another phase on top |
| Phase `planned` | dispatch into arcane-mode execution |
| Phase `specced` | arcane-mode step 1: write the plan; its premortem gate precedes Task 1 |
| Phase `pending` | catalyst:crucible for its spec (fog wider than a question → starchart first) |
| Phase `verified` | present to the user for acceptance (UAT offer per verification.md), then `done` |
| All phases of a milestone `done` | milestone audit (below) — mandatory, before any celebration or next milestone |
| No roadmap | this is campaign creation (below) |

One session advances ONE phase's state as far as it honestly goes; parallel phases only by explicit user decision and only when file-disjoint.

## Creating a campaign

1. Intent and milestones — through catalyst:crucible (the intent is a decision, not a transcription); starchart's finished map converts naturally: destination → Intent, closed decisions → Decision log, remaining work clusters → phases.
2. Slice phases tracer-first (each phase leaves the system demonstrably better/shippable), 3-9 phases per milestone; a phase should fit one arcane-mode plan (2-3 tasks) — bigger means it's a milestone, not a phase.
3. Write both files, get the user's approval of the roadmap as ONE question, set every phase `pending`.

## Milestone audit — against intent, not the checklist

When a milestone's phases are all `done`: goal-backward audit of the MILESTONE against `PROGRAM.md ## Intent` and the milestone's must_haves — fresh-eyes auditor (top tier, clean context), the same discipline as arcane verification but one level up: phases all done ≠ intent achieved (integration seams between phases are exactly what per-phase verification never saw). Findings → fix phases into the roadmap (user approves), not silent patches. Clean audit → milestone closed in PROGRAM.md, next milestone or campaign end — the user's call.

## Session end

Campaign sessions end through catalyst:handoff; the handoff carries the campaign path so the next session's router starts warm. Update ROADMAP.md links/status BEFORE the handoff — the roadmap, not the handoff, is the program's memory.

## Red Flags — STOP

- Navigating the program from memory or the conversation instead of reading ROADMAP.md.
- Starting a new phase while another is `executing` ("it's stuck anyway") — resume or explicitly park it with the user first.
- A status advanced without its evidence (specced with no spec file, verified with no converged verification).
- Roadmap scope edited silently — add/remove/reorder is a user decision with a Decision-log line.
- Milestone declared done from the phase checklist without the intent audit.
- Program details accumulating in ROADMAP.md instead of the linked artifacts — the index rots into a monolith.
- A campaign created for a single-feature effort — that's crucible → arcane-mode, the umbrella adds only weight.
