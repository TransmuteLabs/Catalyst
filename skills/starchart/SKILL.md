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

`<repo>/.catalyst/map/<effort-kebab>/MAP.md` — one directory per effort, so maps never share a path or ticket numbering; tickets — `<repo>/.catalyst/map/<effort-kebab>/tickets/NNN-<slug>.md`. Starting starchart while a DIFFERENT effort's map dir exists → leave it untouched, create your own effort's directory. A map converted into a campaign stays in place (committed history; the campaign's Decision log points at it). `<repo>` resolves as `git rev-parse --show-toplevel` — every `.catalyst/` path anchors to the repo root, never a repo subdirectory's cwd (a session opened in a subdirectory must not fork a second map); no git repo at all → the map cannot be committed: surface it to the user (init a repo, or explicitly accept an ephemeral map), never proceed silently. The map directory is **committed to the repo** (multi-session memory — it must survive `git clean` and clones, unlike the ephemeral self-ignored `.catalyst/` workspaces); if the project's `.gitignore` swallows it (a wholesale `.catalyst/` rule, or `.catalyst/*` without this dir's negation), fix the rule at the first map commit (named to the user, never silent): ensure `.catalyst/*` plus BOTH `!.catalyst/map/` and `!.catalyst/campaign/` (unconditionally — a map often converts into a campaign, and the half-remedy would swallow it) — a bare negation under an ignored directory doesn't work, and `git add -f` is banned (the next clone re-hits the same swallow); a rejected push at session end → fetch + merge under the arbitration below, retry once; still failing or offline → tell the user the map is local-only (the unpushed-map red flag below is about SILENT unpushed state, not a named failure); escalations one map load discovers (conflicting Resolutions, Out-of-scope conflicts, index lines without ticket files) are presented as ONE batched question, never a drip; the session that writes a Resolution — or any map edit — commits it immediately (to the effort's base branch, never a scratch branch), session end is a safety net, not the commit point; when a remote exists — pull before reading the map, push at session end, and a merge conflict is arbitrated by what's on disk in the tickets: an on-disk Resolution wins over an index line; TWO DIFFERENT Resolutions of the same ticket → the user decides (a user decision is never auto-picked or silently discarded); a Destination conflict → the user (the destination is a crucible-hardened user decision — never auto-merged); conflicts in Not-yet-specified/Notes merge as a union; Out-of-scope conflicts → the user — same evidence-first discipline as campaign state. If the project has an issue tracker and the user prefers it — the same structure lives there (map issue + child issues), same format.

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

**Re-entering a half-charted map** (MAP.md exists but charting died mid-way — tickets partial, blocked-by edges missing): reconcile, never re-chart — existing tickets keep their numbers, missing edges are wired in, phrasable fog becomes tickets; an empty frontier with remaining fog and NO open tickets is an un-matured map, not a done one and not a blocked cycle — walk the fog boundary again (charting step 2), don't force vague tickets.

**Working the map:** load MAP.md (the map is an index: read only the ticket you take) → take ONE ticket from the frontier (an on-disk `## Resolution` means the ticket is CLOSED even if the index lacks its line — reconcile Decisions so far, never re-decide; the mirror case — an index line whose ticket FILE is missing — is a lost decision: surface it to the user, never re-decide silently and never treat the one-liner as the full decision; a Resolution missing its required fields is a torn write, not a decision: the why / context pointer may be completed from the ticket's own evidence, but a missing DECISION forces re-open with the user — self-completing it is answering a Grilling ticket for the user; reconciliation is bookkeeping and does not consume this session's ONE ticket) → resolve it by its type → write the Resolution and, immediately after, its line in Decisions so far → new questions: into tickets or into the fog; matured fog — into tickets → **stop**. **Never more than one ticket per session** (exception — research tickets: they may be burned down in a batch by parallel scouts). A ticket's resolution spawns the next session, not a continuation of this one: fresh context per decision is the whole point of the map.

**Done:** Not yet specified is empty, the frontier is empty, AND no open tickets remain. An empty frontier with open tickets is a blocked-by cycle, not a charted map — break it with the user (merge the tickets into one decision, or close one on an explicitly recorded assumption). When truly charted: Exit routes (the user picks): the remaining work fits one spec → catalyst:crucible for final hardening → spec → catalyst:arcane-mode; the work clusters into several phases toward a milestone → convert the map into a catalyst:campaign (destination → Intent, Decisions so far → Decision log, work clusters → phases). If the effort turned out small — straight to the spec.

## Red Flags — STOP

- Code/diff/implementation appeared in a ticket's Resolution — a ticket decides, it doesn't do ("might as well build it while I understand it" — that's a second ticket or a future plan's task).
- Closed a second ticket in the same session ("time left over", "respawn is expensive") — non-research tickets close one per session.
- Answered for the user in a Grilling ticket.
- A ticket whose question can't be answered without decisions not yet made was taken instead of getting a blocked-by edge.
- An Out-of-scope item silently returned to work without a user decision.
- Fog written down as a ticket with a vague question ("figure out storage") — if the question can't be phrased precisely, it's fog, not a ticket.
- Session ended with an uncommitted Resolution (or unpushed map commits when a remote exists) — a user decision that dies with a `git clean` or never reaches another machine gets re-decided.
