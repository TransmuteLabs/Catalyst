---
name: starchart
description: Use when an effort is too large for one agent session and the route is still foggy - you can feel the shape of the work but cannot yet write it down as a spec or a plan. Also for re-entering a standing decision map - a committed .catalyst/map/ directory in the repo. Not for well-scoped features.
---

# Starchart — a decision map for big fog

## Overview

Planning an effort that doesn't fit one session, via a shared map of **decision tickets**: each ticket closes one decision — a question to settle, not a slice of a build to execute. Core: wayfinder (Matt Pocock, MIT), adapted to a local markdown tracker and Catalyst tiering. **Starchart plans, it doesn't do**: it produces decisions, not deliverables; the map is done when nothing is left to decide and a spec can be written.

## When to use

- The effort is larger than one agent session AND the route is foggy: a spec or plan can't be written yet.
- **Not** for a well-scoped feature — this is the heaviest, slowest flow; for those go straight to catalyst:crucible → spec → catalyst:arcane-mode.

## Artifacts (local tracker)

`<repo>/.catalyst/map/<effort-kebab>/MAP.md`, tickets in `tickets/NNN-<slug>.md` — one directory per effort. `<repo>` = `git rev-parse --show-toplevel`, never a subdirectory's cwd. The map directory is **committed to the repo** (multi-session memory — it must survive `git clean` and clones); every Resolution or map edit **commits immediately to the effort's base branch** (MAP.md's `base:` line), session end is a safety net, not the commit point; when a remote exists — pull before reading, push at session end. No git repo → surface to the user (init, or an explicitly accepted ephemeral map — the acceptance covers MAP state only), never proceed silently.

**STOP-read trigger — read `references/map-mechanics.md` ENTIRELY** on: any merge conflict or pull/push failure, two Resolutions of one ticket, duplicate NNN/slug collisions, orphaned or missing ticket files, torn Resolutions, `.gitignore` swallowing the map dir, the write guard (re-read / surgical in-place / blob check — a live sibling session on the same checkout), the map→campaign conversion contract. Its cells are normative; improvising past any of these shapes is a defect.

```markdown
# MAP: <effort>
base: <branch>        — the branch every map commit and pull targets (durable identity:
                        a fresh clone / second machine reads it here — the current checkout
                        is NOT the record; a legacy map without the line backfills it from the
                        branch its creation commit sits on, two candidates → the user)
## Destination        — where we're going, 2-4 sentences
## Notes              — mode agreements, each DATED (e.g. permission to "do", if the user granted it)
## Decisions so far   — index: one line per closed ticket + link (the map is an index, not a store)
## Frontier           — index: one line per OPEN ticket + its blocked-by refs; maintained by the
                        writer that creates, blocks, or closes a ticket — so taking a ticket never
                        requires sweeping every open ticket file
## Not yet specified  — the fog: areas where the question can't be phrased precisely yet
## Out of scope       — beyond the destination; nothing graduates back silently
```

Ticket: `created: <ISO date>` + `## Question` (ONE decision, sized to one session) + `## Blocked by` (links) + after closing `## Resolution` (decision + why + context pointer, DATED; the pointer targets a COMMITTED path or the extract is inlined — never a self-ignored workspace). **Frontier** = open, unblocked tickets; the index reconciles against ticket files on load (an on-disk Resolution beats a stale index line; repairs are committed). A ticket is created in ONE commit carrying both the file and its index line. Full anatomy and repair arms: map-mechanics §2.

## Ticket types

| Type | Who decides | How |
|---|---|---|
| Grilling (default) | HITL | a catalyst:crucible session on the ticket's question; the agent never answers for the user |
| Research | AFK | scouts / "standard" tier under arcane-mode rules (facts with file:line, no decision-conclusions); parallelizable, findings go into the ticket |
| Prototype | HITL | a cheap throwaway artifact that makes the decision visible; then discarded |
| Task | HITL/AFK | rare: work that unblocks a decision (the only type that *does* rather than decides) |

## Fog of war

The map is deliberately incomplete. The "fog or ticket" test: **can you phrase the question precisely now** — not "can you answer it now". Phrasable → a ticket; not → a line in Not yet specified. Fog matures into tickets as neighboring decisions close.

## Invocation

**Charting the map:** (1) Destination — via catalyst:crucible; (2) walk the fog boundary with questions — what is already phrasable; (3) create MAP.md and the tickets, wire blocked-by edges in a second pass; (4) research tickets may go to scouts immediately, in parallel; (5) stop. If there turned out to be no fog — the map isn't needed; go to crucible → spec.

**Re-entering a half-charted map** (MAP.md exists but charting died mid-way — tickets partial, blocked-by edges missing): reconcile, never re-chart — existing tickets keep their numbers, missing edges are wired in, phrasable fog becomes tickets; an empty frontier with remaining fog and NO open tickets is an un-matured map, not a done one and not a blocked cycle — walk the fog boundary again (charting step 2), don't force vague tickets.

**Working the map:** load MAP.md (it is an index — read only the ticket you take) → take ONE ticket from the frontier → resolve it by its type → write the Resolution and its Decisions-so-far line, commit → new questions become tickets or fog → **stop**. **Never more than one ticket per session** (exception: research tickets may be burned down in a batch by parallel scouts) — fresh context per decision is the whole point. Reconciliation cases (closed-but-unindexed tickets, missing files, torn Resolutions) are bookkeeping, don't consume the session's one ticket, and follow map-mechanics §3.

**Done:** Not yet specified is empty, the frontier is empty, no open tickets remain (checked against `ls tickets/`, not the index alone). An empty frontier WITH open tickets is a blocked-by cycle — break it with the user. Exit routes (the user picks): one spec's worth of work → crucible → spec → arcane-mode; clusters toward a milestone → convert into a catalyst:campaign under the COMPLETE conversion contract (map-mechanics §4 — an ephemeral map re-raises campaign's repo question there); small after all → straight to the spec.

**When another skill invokes starchart**, control RETURNS to the caller — no onward routing. The contract binds callers that persist: a campaign router (its roadmap survives every session — the map's outcome feeds it). A bootup DISPATCH into starchart merely STARTS a standalone lineage: bootup does not survive to the map's Done, so the Done session uses the normal exit routes (the user picks) — there is no caller left to return to. When the caller IS the campaign router, clusters become phases or scope edits of the EXISTING campaign via its Decision-logged scope decision, never a nested second campaign, and never a direct crucible → arcane chain past the router's flips and stamps.

## Red Flags — STOP

- Code/diff/implementation appeared in a ticket's Resolution — a ticket decides, it doesn't do ("might as well build it while I understand it" — that's a second ticket or a future plan's task).
- Closed a second ticket in the same session ("time left over", "respawn is expensive") — non-research tickets close one per session.
- Answered for the user in a Grilling ticket.
- A ticket whose question can't be answered without decisions not yet made was taken instead of getting a blocked-by edge.
- An Out-of-scope item silently returned to work without a user decision.
- Fog written down as a ticket with a vague question ("figure out storage") — if the question can't be phrased precisely, it's fog, not a ticket.
- Session ended with an uncommitted Resolution (or unpushed map commits when a remote exists) — a user decision that dies with a `git clean` or never reaches another machine gets re-decided.
- A Resolution's context pointer targets a self-ignored workspace — the committed decision rests on evidence that dangles on every other machine; inline the extract or commit the source.
