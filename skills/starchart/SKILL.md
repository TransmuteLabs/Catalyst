---
name: starchart
description: Use when an effort is too large for one agent session and the route is still foggy - you can feel the shape of the work but cannot yet write it down as a spec or a plan. Not for well-scoped features.
---

# Starchart — a decision map for big fog

## Overview

Planning an effort that doesn't fit one session, via a shared map of **decision tickets**: each ticket closes one decision — a question to settle, not a slice of a build to execute. Core: wayfinder (Matt Pocock, MIT), adapted to a local markdown tracker and Catalyst tiering. **Starchart plans, it doesn't do**: it produces decisions, not deliverables; the map is done when nothing is left to decide and a spec can be written.

## When to use

- The effort is larger than one agent session AND the route is foggy: a spec or plan can't be written yet.
- **Not** for a well-scoped feature — this is the heaviest, slowest flow; for those go straight to catalyst:crucible → spec → catalyst:arcane-mode.

## Artifacts (local tracker)

`<repo>/.catalyst/map/MAP.md` — the map (one per effort); tickets — `<repo>/.catalyst/map/tickets/NNN-<slug>.md`. If the project has an issue tracker and the user prefers it — the same structure lives there (map issue + child issues), same format.

```markdown
# MAP: <effort>
## Destination        — where we're going, 2-4 sentences
## Notes              — mode agreements (e.g. permission to "do", if the user granted it)
## Decisions so far   — index: one line per closed ticket + link (the map is an index, not a store)
## Not yet specified  — the fog: areas where the question can't be phrased precisely yet
## Out of scope       — beyond the destination; nothing graduates back silently
```

Ticket: `## Question` (one decision, sized to one session) + `## Blocked by` (links) + after closing `## Resolution` (decision + why + context pointer). **Frontier** = open, unblocked tickets.

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

**Working the map:** load MAP.md (the map is an index: read only the ticket you take) → take ONE ticket from the frontier → resolve it by its type → write the Resolution and a line in Decisions so far → new questions: into tickets or into the fog; matured fog — into tickets → **stop**. **Never more than one ticket per session** (exception — research tickets: they may be burned down in a batch by parallel scouts). A ticket's resolution spawns the next session, not a continuation of this one: fresh context per decision is the whole point of the map.

**Done:** Not yet specified is empty and the frontier is empty → the map is charted → catalyst:crucible for final hardening → spec → catalyst:arcane-mode. If the effort turned out small — straight to the spec.

## Red Flags — STOP

- Code/diff/implementation appeared in a ticket's Resolution — a ticket decides, it doesn't do ("might as well build it while I understand it" — that's a second ticket or a future plan's task).
- Closed a second ticket in the same session ("time left over", "respawn is expensive") — non-research tickets close one per session.
- Answered for the user in a Grilling ticket.
- A ticket whose question can't be answered without decisions not yet made was taken instead of getting a blocked-by edge.
- An Out-of-scope item silently returned to work without a user decision.
- Fog written down as a ticket with a vague question ("figure out storage") — if the question can't be phrased precisely, it's fog, not a ticket.
