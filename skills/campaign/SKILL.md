---
name: campaign
description: Use for a program of work spanning many sessions and multiple arcane-mode runs - several phases toward a milestone, "what's next" when a campaign exists under .catalyst/campaign/, or closing out a milestone. Not for a single feature (crucible → arcane-mode), a single foggy decision map (starchart), or resuming ordinary non-campaign work (handoff).
---

# Campaign — the program layer

## Overview

Arcane-mode executes one plan; a campaign is the umbrella above many of them: a roadmap of phases toward a milestone, alive across weeks and dozens of sessions. The orchestrator surfacing from one finished branch must never navigate from memory — the campaign state answers "where are we and what's next". Core: GSD's roadmap/milestone lifecycle, reduced to two files over the existing family (no tracker, no config layer).

**Campaign decides sequence; each phase is still delivered by the family flow** (crucible → arcane-mode, whose premortem gate precedes Task 1 → verification). The campaign never re-implements those skills' jobs.

## State (two files)

`<repo>/.catalyst/campaign/<name>/`:

```markdown
# PROGRAM.md
status: active     — first line; flips to `complete` (with the date) only by the
                     router's terminal route; bootup keys on it
## Intent          — what this campaign must make true, 3-6 sentences; the milestone
                     audit runs against THIS text, not against the phase list
## Non-goals       — what it deliberately won't do
## Milestones      — M1, M2… each with its own must_haves (truths/artifacts/key_links)
                     and a `status: open|closed` line — closed ONLY by a clean intent audit
## Decision log    — D-01… one line per program-level decision + why

# ROADMAP.md
## Phases          — table: id | phase | milestone | status | links
                     status: pending → specced → planned → executing → verified → done
                     links: spec, plan, ledger paths, handoffs — as they appear
## Parked          — phases deferred by an explicit user decision (with the reason)
```

Rules: PROGRAM.md and ROADMAP.md are **committed to the repo** — they are the program's memory for weeks and must survive `git clean`, clones, and machine changes. State commits go to the campaign's BASE branch (the branch phases fork from), never onto a phase work branch — a discarded phase branch must not carry the program's memory away with it. Mechanics: when a remote exists, the router's FIRST action is a fast-forward pull of the base checkout (a stale local roadmap routes wrongly), and session end pushes the state commits AND the phase branch (an unpushed phase branch is unrecoverable from any other machine). A merge conflict in ROADMAP.md/PROGRAM.md is arbitrated by the evidence rule — per phase row, the side whose status carries its evidence wins; scope differences (added/removed phases) reconcile through the Decision log with the user — never blind ours/theirs. Run phases in WORKTREES off the base (the default — the base checkout stays available), and **the session that produces the evidence flips the status in the base checkout and commits there immediately**, not at handoff time (the Session-end check is a safety net, not the flip point). Single-checkout branch workflow: edit the flip immediately, commit it at the next moment base is checked out — branch finish at the latest, never onto the phase branch. Parallel phases (user-sanctioned): ONE session, named by the user, owns all roadmap flips — the others leave the evidence on disk and name it in their handoffs; the owner (or the next router run's reconciliation) flips from it. ROADMAP is an index — details live in the linked specs/ledgers. Status changes only with evidence (an APPROVED spec exists → specced — crucible marks approval inside the spec file, a markerless file is a draft, not evidence; the premortem gate returned PASS or WARN — BLOCK bars it — and the plan is written → planned; ledger shows tasks closing → executing; arcane verification converged — the ledger's `verification: converged` line → verified; user accepted → done). Roadmap edits that change scope (add/remove/reorder phases) are user decisions, logged in the Decision log — never silent.

## Router — every campaign session starts here

Read ROADMAP.md and PROGRAM.md's Milestones section (nothing else yet). Take the first milestone whose `status:` is not `closed`: if ALL its phases are `done`, the route is its milestone audit — a later milestone's pending phases never skip an unclosed earlier one past its audit. Otherwise route by that milestone's first phase whose status is not `done`. Before dispatching into the route, reconcile BOTH ways: (a) forward — if the phase's NEXT evidence already exists on disk (an approved spec for `pending`, the ledger's `verification: converged` line for `executing` — resolve the ROADMAP ledger link, which may point into a phase worktree; an unreachable ledger is NOT evidence: route resume, and arcane re-derives from `git log` only on the machine that has the phase branch — on a fresh clone without it, the phase's progress is unrecoverable: say so to the user, never silently restart the phase), the previous session died in the flip window — flip first, then route; (b) backward — if the CURRENT status lacks its own evidence (`planned` with no plan file, `done` with no acceptance — a hand edit?), do NOT route on it: surface the gap to the user with the evidence rule quoted. Then warm up: if `.catalyst/handoffs/` holds a handoff carrying this campaign's pointer, read the latest one — the roadmap decides WHAT happens next, the handoff's mental model saves re-discovering HOW things work.

| State found | Route |
|---|---|
| Phase `executing` | resume it: its ledger + `git log` are the truth (arcane-mode rules) — never start another phase on top |
| Phase `planned` | dispatch into arcane-mode execution |
| Phase `specced` | check the ROADMAP plan/ledger links first: a ledger naming this phase's plan AND carrying a PASS/WARN premortem verdict line holds `planned`'s full evidence (a death before the flip) — flip and route accordingly; a ledger with NO verdict line means the plan is approved but the gate is owed — resume at the premortem gate, the status stays `specced` until the verdict; a BLOCK verdict line means the phase is premortem-blocked — route to the pending mitigation rework / user acceptance decision (premortem's BLOCK rule), never to plan-writing and never to Task 1; otherwise arcane-mode step 1: write the plan; its premortem gate precedes Task 1 |
| Phase `pending` | catalyst:crucible for its spec — the spec is produced standalone, but control returns to THIS router (no self-routing onward); fog wider than a question → starchart first |
| Phase `verified` | present to the user for acceptance (UAT offer per arcane-mode's `references/verification.md` — this IS the phase's one UAT pass, deferred out of arcane's verification step; it never runs twice) BEFORE arcane's branch-finish question — acceptance decides whether the branch integrates; then `done` |
| All phases of a milestone `done` | milestone audit (below) — mandatory, before any celebration or next milestone |
| Every milestone `closed` | the campaign is COMPLETE: write `status: complete` (with the date) at the top of PROGRAM.md, commit, tell the user — nothing routes; bootup skips complete campaigns |
| No roadmap | campaign creation (below) — only when the user actually asked for a program; a bare "what's next" with no roadmap is not that ask → route back (handoff resume / bootup routing) |

One session advances ONE phase's state as far as it honestly goes; parallel phases only by explicit user decision and only when file-disjoint.

## Creating a campaign

1. Intent and milestones — through catalyst:crucible (the intent is a decision, not a transcription); starchart's finished map converts naturally: destination → Intent, closed decisions → Decision log, remaining work clusters → phases.
2. Slice phases tracer-first (each phase leaves the system demonstrably better/shippable), 3-9 phases per milestone; a phase should fit one arcane-mode plan (a few tasks) — a bigger chunk splits into more phases; a milestone is a set of phases, never one oversized phase.
3. Write both files, get the user's approval of the roadmap as ONE question, set every milestone `status: open` and every phase `pending`.

## Milestone audit — against intent, not the checklist

When a milestone's phases are all `done`: goal-backward audit of the MILESTONE against `PROGRAM.md ## Intent` and the milestone's must_haves — fresh-eyes auditor (top tier, clean context), the same discipline as arcane verification but one level up: phases all done ≠ intent achieved (integration seams between phases are exactly what per-phase verification never saw). Findings → fix phases into the roadmap (user approves), not silent patches. Convergence uses the same stop criterion — iterative rounds until 2 consecutive clean; then the milestone closes in PROGRAM.md, next milestone or campaign end — the user's call.

## Session end

Campaign sessions end through catalyst:handoff; the handoff carries the campaign path so the next session's router starts warm. Before the handoff, VERIFY the roadmap is already current — statuses flipped when their evidence appeared, links laid; a missed flip found here is fixed now, but session end is the safety net, not the flip point. The roadmap, not the handoff, is the program's memory.

## Red Flags — STOP

- Navigating the program from memory or the conversation instead of reading ROADMAP.md.
- Starting a new phase while another is `executing` ("it's stuck anyway") — resume or explicitly park it with the user first.
- A status advanced without its evidence (specced with no spec file, verified with no converged verification).
- Roadmap scope edited silently — add/remove/reorder is a user decision with a Decision-log line.
- Milestone declared done from the phase checklist without the intent audit.
- Program details accumulating in ROADMAP.md instead of the linked artifacts — the index rots into a monolith.
- A campaign created for a single-feature effort — that's crucible → arcane-mode, the umbrella adds only weight.
- Campaign state uncommitted at session end, or committed onto a phase work branch instead of the base branch. (The one sanctioned deferral: a single-checkout flip edit awaiting the next base checkout per Mechanics — committed at branch finish at the latest.)
