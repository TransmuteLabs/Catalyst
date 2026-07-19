---
name: campaign
description: Use for a program of work spanning many sessions and multiple arcane-mode runs - several phases toward a milestone, "what's next" when a campaign exists under .catalyst/campaign/, or closing out a milestone. Not for a single feature (crucible → arcane-mode), a single foggy decision map (starchart), or resuming ordinary non-campaign work (handoff).
---

# Campaign — the program layer

## Overview

Arcane-mode executes one plan; a campaign is the umbrella above many of them: a roadmap of phases toward a milestone, alive across weeks and dozens of sessions. The orchestrator surfacing from one finished branch must never navigate from memory — the campaign state answers "where are we and what's next". Core: GSD's roadmap/milestone lifecycle, reduced to two files over the existing family (no tracker, no config layer).

**Campaign decides sequence; each phase is still delivered by the family flow** (crucible → arcane-mode, whose premortem gate precedes Task 1 → verification). The campaign never re-implements those skills' jobs.

## State (two files)

`<repo>/.catalyst/campaign/<name>/` — **committed to the repo**, the program's memory across weeks, clones, and machines. Sketch (the FULL annotated schema — stamp grammar, `head:` pin recovery, demotion shapes, Parked protocol — is `references/schema.md`, and it governs):

```markdown
# PROGRAM.md
status: active|complete — first line, DERIVED from the Milestones section
base: <branch>     — the campaign's BASE branch; every state commit, ON-base check,
                     and the router's step-0 pull target THIS name, never a guess
## Intent          — what must become true, 3-6 sentences; milestone audits run against THIS
## Non-goals       — the scope fence; nothing graduates back silently
## Milestones      — M1… each with must_haves and status: open |
                     closed (audited: <date>, rounds N..M) | closed (waived: <date>)
## Decision log    — D-01… one DATED line per program decision + why; also sanctioned
                     event records (kind vocabulary: references/arbitration.md)

# ROADMAP.md
## Phases          — table: id | phase | milestone | status | links
                     status: pending → specced → planned → executing → verified → done
                     every flip past pending writes its EVIDENCE STAMP onto the row:
                       specced (spec: <path>) · planned (premortem: PASS|WARN <date>)
                       executing (ledger: <path>) · verified (converged: rounds N..M)
                       or verified (waived: <date>) · done (accepted: <date>, <lineage
                       token>, head: <sha>) — branch-finish later APPENDS
                       `, branch: merged <sha>|pr <ref>|kept|discarded` (executed fact only)
                     demoted shapes carry `reopened <date>; was: …` — the executed
                     record (head:, branch:) rides the was-clause, never erased
## Parked          — rows deferred by EXPLICIT user decision, shape
                     `parked (<ISO date>; <reason>; was: <full prior stamp>)`;
                     never routed, never counted toward "all phases done"
```

## Rules — the invariants

- **Every state write commits IMMEDIATELY, on the BASE branch** (never a phase branch); push at session end when a remote exists. No git repo → surface to the user (an explicitly accepted ephemeral run covers campaign state only), never proceed silently.
- **Status changes only with evidence, and the flip writes its stamp onto the row** — written by the session that produced the evidence; a stamped row is evaluable on any machine without the machine-local ledger.
- Roadmap edits that change scope (add/remove/reorder phases) are user decisions, logged in the Decision log — never silent.
- **A recorded user decision is never overwritten, auto-picked, or silently dropped.** Conflicts, undecidable records, and every "surface to the user" one router run discovers are presented as **ONE batched question**, never a drip (full batching rule: mechanics §7).
- One session advances ONE phase's state as far as it honestly goes; parallel phases only by explicit user sanction with file-disjointness checked (mechanics §5).

**STOP-read triggers — read the named file ENTIRELY before acting:**
- Any merge conflict in state files, any `unresolved (…)`/legacy/suspect shape, a hand-demotion, a bare `closed`/`done` → `references/arbitration.md`.
- Stamp decode, demotion, parking/un-parking → `references/schema.md`. Any state write/commit, the write guard, pull/push/transport failures, gitignore, ephemeral → `references/state-writes.md`. Worktrees/flips, parallel sanction, the batched question → `references/phases.md`. Step-0/scans, reconciliation, full route cells → `references/router.md`. Creation details, milestone audit → `references/creation-and-audit.md`. (`references/mechanics.md` is the router for pre-split pointers.)

## Router — every campaign session starts here

**Step 0 — pull first** when a remote exists: the branch pulled, read, and committed to is PROGRAM.md's `base:` line (failure shapes: `references/state-writes.md` + `references/router.md`). Then: an `executing` phase ANYWHERE takes precedence — resume it first; two+ `executing` rows are consistent only with a parallel-sanction D-line (`references/phases.md`, `references/router.md`). Otherwise take the first milestone whose status is not `closed` and its first non-`done` phase; **reconcile both ways before dispatching** — forward (evidence already on disk → flip with stamp, don't redo) and backward (every claimed status still backed by its referent; gaps → `references/router.md`). Then route:

| State found | Route |
|---|---|
| Phase `executing` | resume: its ledger + `git log` are the truth (arcane-mode rules) |
| Phase `planned` | dispatch into arcane-mode execution |
| Phase `specced` | plan it — check the roadmap's plan/ledger links first (full cell: `references/router.md`) |
| Phase `pending` | catalyst:crucible for its spec; control returns to THIS router |
| Phase `verified` | acceptance → UAT offer → `done` flip → branch-finish question (full cell, incl. reopened/demoted arms: `references/router.md`) |
| All phases of a milestone `done` | milestone audit (below) — mandatory |
| Every milestone `closed` | campaign complete: `status: complete` + terminal sweep (full cell: `references/router.md`) |
| No roadmap | creation (below) — only when the user actually asked for a program |

## Creating a campaign

1. Intent and milestones through catalyst:crucible; a finished starchart map converts COMPLETELY (Destination → Intent, decisions → Decision log with original dates, out-of-scope → Non-goals) — full mapping: `references/creation-and-audit.md`.
2. Slice phases tracer-first, 3-9 per milestone; ONE phase = the single-feature red flag — at creation this REFUSES (route to crucible → arcane-mode) unless the user explicitly orders the umbrella with the cost named.
3. Write both files (`base:` = `git branch --show-current` at creation), get the roadmap approved as ONE question, Decision-log the approval; all three land in ONE genesis commit (`references/creation-and-audit.md`).

## Milestone audit — against intent, not the checklist

When all of a milestone's phases are `done`: spot-check the `branch:` claims against git, then a fresh-eyes audit against the PROGRAM's Intent text (not the phase list); clean → `closed (audited: <date>, rounds N..M)` + its D-log event; findings → fix phases first. The user's explicit skip → `closed (waived: <date>)`, D-logged, never re-demanded, never read as audited. Full protocol: `references/creation-and-audit.md`.

## Session end

Campaign sessions end through catalyst:handoff; the handoff carries the campaign path so the next session's router starts warm. Before the handoff, VERIFY the roadmap is already current — statuses flipped when their evidence appeared, each flip carrying its evidence stamp (a stamp is exactly what another machine routes on — a bare flip found here is half-done), links laid; a missed flip found here is fixed now, but session end is the safety net, not the flip point. The roadmap, not the handoff, is the program's memory.

## Red Flags — STOP

- Navigating the program from memory or the conversation instead of reading ROADMAP.md.
- Starting a new phase while another is `executing` ("it's stuck anyway") — resume or explicitly park it with the user first.
- A status advanced without its evidence (specced with no spec file, verified with neither a converged verification nor its recorded waiver line).
- Roadmap scope edited silently — add/remove/reorder is a user decision with a Decision-log line.
- Milestone declared done from the phase checklist without the intent audit.
- Program details accumulating in ROADMAP.md instead of the linked artifacts — the index rots into a monolith.
- A campaign created for a single-feature effort — that's crucible → arcane-mode, the umbrella adds only weight.
- Campaign state uncommitted at session end, or committed onto a phase work branch instead of the base branch. (The one sanctioned deferral: a single-checkout flip edit awaiting the next base checkout per Mechanics — committed at branch finish at the latest; the never-defer CLASS — the `reopened` demotion, a post-flip spec-gate yaml + its spec edits, an amendment wave's edits + pending marker, each recorded pending-entry answer, each unresolved-shape answer, the hand-demotion suspect's answering D-line, and an acceptance withdrawal — is NOT in it: those commit to base now — and push now when a remote exists, per Mechanics.)
- Routed with a remote configured but without the step-0 pull; or (when a remote exists) the session ended with unpushed state commits / an unpushed phase branch.
- A status flipped without writing its evidence stamp onto the row.
