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
                     every flip past `pending` writes its EVIDENCE STAMP onto the row:
                       specced (spec: <approved-spec path>) · planned (premortem: PASS|WARN <date>)
                       executing (ledger: <path>) · verified (converged: rounds N..M)
                       done (accepted: <date>, rounds N..M) — the rounds acceptance saw;
                       branch-finish APPENDS `, branch: merged <sha7>|pr <ref>|kept|discarded`
                       AFTER the choice actually executes, recording its artifact (the merge
                       commit, the PR ref) — the append asserts an executed fact, never an
                       intent; a `done` stamp without its `branch:` part means the accepted
                       branch was never integrated: the choice is owed
                     the stamp is written by the session that produced the evidence and travels
                     with the row's commit — any machine can evaluate a stamped row without
                     reaching the (machine-local) ledger; the `done` stamp IS the acceptance artifact
                     links: spec, plan, ledger paths, handoffs — as they appear
## Parked          — phases deferred by an explicit user decision: the whole row MOVES here,
                     keeping its last status + stamp, plus the reason and date; parking and
                     un-parking are scope decisions (Decision log). Parked rows are never
                     routed and don't count toward a milestone's "all phases done";
                     un-parking returns the row to ## Phases with its preserved status,
                     re-validated by backward reconciliation PLUS a referent check — the
                     stamp's referents must still exist (an `executing` row's ledger link,
                     a `verified` row's phase branch): a vanished branch/worktree/ledger is
                     surfaced to the user (re-run from the spec/plan, or park back), never
                     routed as-is. Un-parking into a milestone that meanwhile CLOSED (or a
                     campaign gone `complete`) re-opens it — `status: open` again (and
                     `complete` reverts to `active`), Decision-logged with the user: the
                     closure was audited without this phase, so it no longer holds
```

Rules: PROGRAM.md and ROADMAP.md are **committed to the repo** — they are the program's memory for weeks and must survive `git clean`, clones, and machine changes. If the project's `.gitignore` swallows the committed dir — a wholesale `.catalyst/` rule, OR a `.catalyst/*` rule missing this dir's negation (the shape a starchart-first remedy can leave) — the first state commit fixes the rule (named to the user, never silent): ensure `.catalyst/*` plus `!.catalyst/campaign/` and `!.catalyst/map/` — a bare negation UNDER an ignored directory doesn't work (git never descends into it), and `git add -f` is banned: it leaves the rule in place so every future clone re-hits the same swallow. State commits go to the campaign's BASE branch (the branch phases fork from), never onto a phase work branch — a discarded phase branch must not carry the program's memory away with it. Mechanics: when a remote exists, the router pulls the base checkout FIRST (step 0 below), and session end pushes the state commits AND the phase branch (an unpushed phase branch is unrecoverable from any other machine). Pull failure shapes are routed, never improvised: a deferred single-checkout flip edit is committed BEFORE pulling (commit-then-pull, never stash); the pull hitting divergence → fetch and merge, conflicts resolved by the arbitration below; remote unreachable → proceed on local state and tell the user the roadmap may be stale. Push failures are routed the same way: a rejected push (the remote advanced during the session) → fetch + merge under the same arbitration, then retry once; still failing, offline, or auth-refused → tell the user the state is local-only (the red flag below is about SILENT unpushed state, not about a named failure). State commits verify the base checkout is actually ON the base branch first (`git branch --show-current`): a detached HEAD or a wrong branch is surfaced, never committed onto — a detached-HEAD commit lands on no branch and dies silently in the reflog. Merge-conflict arbitration for ROADMAP.md/PROGRAM.md: per phase row, a status WITH its evidence stamp beats one without; both stamped → the further status wins (evidence is cumulative) — EXCEPT `done` vs a `verified` whose converged rounds differ from the rounds in the `done` stamp: that acceptance was overtaken by a re-opened convergence (acceptance must reference the final head — arcane's verification rule), and "cumulative" is false → the user; two `done` rows where one side merely EXTENDS the other's stamp with its `branch:` part → the superset wins mechanically (the append is cumulative evidence, no escalation); a row parked on one side and advanced in ## Phases on the other → the user ("further wins" never auto-un-parks: parking is a user decision, and a user decision is never silently discarded); neither stamped, or conflicting `done` rows, or two different values for the same stamp → the user; scope differences (added/removed phases, parking) reconcile through the Decision log with the user — never blind ours/theirs. Rows stamped by pre-0.4.10 versions (a bare `done (accepted: <date>)`, no rounds, no `branch:`) are a MIGRATION shape, not deaths: ask the user once per campaign to backfill the executed choices — never re-execute them blindly; a missing rounds part arbitrates as unknown (→ the user). Run phases in WORKTREES off the base (the default — the base checkout stays available), and **the session that produces the evidence flips the status in the base checkout and commits there immediately**, not at handoff time (the Session-end check is a safety net, not the flip point). Single-checkout branch workflow: edit the flip immediately, commit it at the next moment base is checked out — branch finish at the latest, never onto the phase branch. Parallel phases (user-sanctioned): ONE session, named by the user, owns all roadmap flips — the others leave the evidence on disk and name it in their handoffs; the owner (or the next router run's reconciliation) flips from it. ROADMAP is an index — details live in the linked specs/ledgers. **Status changes only with evidence, and the flip writes the evidence stamp onto the row** (stamp formats in the schema above): an APPROVED spec (crucible's `status: approved` marker — a markerless file is a draft, not evidence) → specced; premortem PASS/WARN — BLOCK bars it — plus the written plan → planned; ledger shows tasks closing → executing; the ledger's `verification: converged` line → verified; user accepted → done (no other acceptance artifact exists — an unstamped `done` is unevidenced by definition). Roadmap edits that change scope (add/remove/reorder phases) are user decisions, logged in the Decision log — never silent.

## Router — every campaign session starts here

**Step 0 — pull first** when a remote exists (Mechanics above; failure shapes routed there). Then read ROADMAP.md and PROGRAM.md's Milestones section (nothing else yet) **from the BASE checkout** — a phase worktree's copy is stale as of its fork; resuming inside a worktree (e.g. via a handoff), locate the base checkout first, and anchor every `.catalyst/` path to the repo root, never the cwd; a roadmap failing self-consistency — duplicate phase ids, a status outside the enum — is surfaced to the user, never routed on. Take the first milestone whose `status:` is not `closed`: if ALL its phases are `done`, the route is its milestone audit — a later milestone's pending phases never skip an unclosed earlier one past its audit. Otherwise route by that milestone's first phase whose status is not `done`. Before dispatching into the route, reconcile BOTH ways: (a) forward — if the phase's NEXT evidence already exists on disk (an approved spec for `pending`, the ledger's `verification: converged` line as the ledger's final line for `executing` — trailing `session:`/`uat:`/`minor:` lines are sanctioned (verification.md's currency rule), but TASK lines below it mean a re-opened convergence that never refreshed: the converged line is stale, route resume, don't flip; resolve the ROADMAP ledger link, which may point into a phase worktree; an unreachable ledger is NOT evidence: route resume, and arcane re-derives from `git log` only on the machine that has the phase branch — on a fresh clone without it, the phase's progress is unrecoverable: say so to the user, never silently restart the phase), the previous session died in the flip window — flip (with the stamp) first, then route; (b) backward — over EVERY row of the routed milestone, not just the routed phase (this is the only checkpoint the milestone-audit and terminal routes pass through — a hand-edited stampless `done` on the LAST phase must not slip a milestone closed): a status whose row lacks its evidence STAMP and whose evidence isn't reachable locally either (`planned` with neither stamp nor plan file, `done` with no acceptance stamp — a hand edit?) → do NOT route on it: surface the gap to the user with the evidence rule quoted; a `done` stamp missing its `branch:` part → the integration choice never executed: route to arcane's branch-finish question for THAT phase first, never past it ("keep the branch as-is" is itself a recorded choice — `branch: kept`); if the re-gate on that resume goes red, the fix re-opens convergence and VOIDS the acceptance (it no longer references the final head): demote the row to `verified` with the refreshed rounds stamp — the one sanctioned backward flip — and acceptance re-runs before any new `done`; a stamped row is evidenced on every machine — no ledger reach needed, no false alarm. Then warm up: if `.catalyst/handoffs/` holds a handoff carrying this campaign's pointer, read the latest one — the roadmap decides WHAT happens next, the handoff's mental model saves re-discovering HOW things work.

| State found | Route |
|---|---|
| Phase `executing` | resume it: its ledger + `git log` are the truth (arcane-mode rules) — never start another phase on top |
| Phase `planned` | dispatch into arcane-mode execution |
| Phase `specced` | check the ROADMAP plan/ledger links first: a ledger naming this phase's plan AND carrying a PASS/WARN premortem verdict line holds `planned`'s full evidence (a death before the flip) — cross-check `<plan>.premortem.yaml` before flipping: the line is a CACHE and the yaml wins in every direction (arcane's verification rule — a fresh BLOCK yaml under a stale WARN line means the gate failed; a stamp written off the stale line would make the false verdict durable on every machine); a MISSING yaml means the line is an unconfirmed cache: the gate is owed — re-run it, never flip on the line alone; flip and route only on a yaml-confirmed verdict; a ledger with NO verdict line means the plan is approved but the gate is owed — resume at the premortem gate, the status stays `specced` until the verdict; a BLOCK verdict line means the phase is premortem-blocked — route to the pending mitigation rework / user acceptance decision (premortem's BLOCK rule), never to plan-writing and never to Task 1; otherwise arcane-mode step 1: write the plan; its premortem gate precedes Task 1 |
| Phase `pending` | catalyst:crucible for its spec — the spec is produced standalone, but control returns to THIS router (no self-routing onward); fog wider than a question → starchart first |
| Phase `verified` | FIRST the moved-base re-gate: base advanced past the branch's last verified merge point (the fork, or a previous re-gate's merged head — "since fork" alone re-fires forever after any advance) → merge it forward into the phase branch, re-run the suite + tail gates on the merged head (arcane's branch-finish rule) — a red is a fix wave, then convergence re-entered until the stop criterion holds again, the converged line refreshed AND the row's `verified` stamp rewritten with the refreshed rounds (stale rounds in the stamp force the arbitration escalation later); THEN acceptance on the FINAL head (UAT offer per arcane-mode's `references/verification.md` — the phase's one UAT pass, deferred out of arcane's verification step; never twice); acceptance decides whether the branch integrates → `done (accepted: <date>, rounds N..M)` — the rounds just verified → arcane's branch-finish question executes the choice and APPENDS `, branch: <choice>` to the stamp. The flip and the append are two commits by design: a death between them leaves a `done` row without `branch:`, which backward reconciliation routes back to the question — never past it |
| All phases of a milestone `done` | milestone audit (below) — mandatory, before any celebration or next milestone |
| Every milestone `closed` | the campaign is COMPLETE: write `status: complete` (with the date) at the top of PROGRAM.md, commit, tell the user — nothing routes; bootup skips complete campaigns |
| No roadmap | campaign creation (below) — only when the user actually asked for a program; a bare "what's next" with no roadmap is not that ask → route back (handoff resume / bootup routing) |

One session advances ONE phase's state as far as it honestly goes; parallel phases only by explicit user decision and only when file-disjoint.

## Creating a campaign

1. Intent and milestones — through catalyst:crucible (the intent is a decision, not a transcription); starchart's finished map converts naturally: destination → Intent, closed decisions → Decision log, remaining work clusters → phases.
2. Slice phases tracer-first (each phase leaves the system demonstrably better/shippable), 3-9 phases per milestone; a phase should fit one arcane-mode plan (a few tasks) — a bigger chunk splits into more phases; a milestone is a set of phases, never one oversized phase.
3. Write both files, get the user's approval of the roadmap as ONE question, set every milestone `status: open` and every phase `pending`.

## Milestone audit — against intent, not the checklist

When a milestone's phases are all `done` — each row carrying its full `done` stamp (a stampless or `branch:`-less row is a backward-reconciliation case, not an audit input), and the audit spot-checks the `branch:` claims against git first: a `merged <sha7>` whose commit is not an ancestor of the base branch is a claim git refutes — a reconciliation case, never an audit input: goal-backward audit of the MILESTONE against `PROGRAM.md ## Intent` and the milestone's must_haves — fresh-eyes auditor (top tier, clean context), the same discipline as arcane verification but one level up: phases all done ≠ intent achieved (integration seams between phases are exactly what per-phase verification never saw). Findings → fix phases into the roadmap (user approves), not silent patches. Convergence uses the same stop criterion — iterative rounds until 2 consecutive clean; then the milestone closes in PROGRAM.md, next milestone or campaign end — the user's call.

## Session end

Campaign sessions end through catalyst:handoff; the handoff carries the campaign path so the next session's router starts warm. Before the handoff, VERIFY the roadmap is already current — statuses flipped when their evidence appeared, each flip carrying its evidence stamp (a stamp is exactly what another machine routes on — a bare flip found here is half-done), links laid; a missed flip found here is fixed now, but session end is the safety net, not the flip point. The roadmap, not the handoff, is the program's memory.

## Red Flags — STOP

- Navigating the program from memory or the conversation instead of reading ROADMAP.md.
- Starting a new phase while another is `executing` ("it's stuck anyway") — resume or explicitly park it with the user first.
- A status advanced without its evidence (specced with no spec file, verified with no converged verification).
- Roadmap scope edited silently — add/remove/reorder is a user decision with a Decision-log line.
- Milestone declared done from the phase checklist without the intent audit.
- Program details accumulating in ROADMAP.md instead of the linked artifacts — the index rots into a monolith.
- A campaign created for a single-feature effort — that's crucible → arcane-mode, the umbrella adds only weight.
- Campaign state uncommitted at session end, or committed onto a phase work branch instead of the base branch. (The one sanctioned deferral: a single-checkout flip edit awaiting the next base checkout per Mechanics — committed at branch finish at the latest.)
- Routed with a remote configured but without the step-0 pull; or the session ended with unpushed state commits / an unpushed phase branch.
- A status flipped without writing its evidence stamp onto the row.
