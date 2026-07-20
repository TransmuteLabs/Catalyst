---
name: using-catalyst
description: Use when starting a session or deciding which Catalyst skill a task needs - the family's process-skill routing and its coordination with other libraries. Injected at session start.
user-invocable: false
---

# Using Catalyst

You have **Catalyst** — a disciplined layer for multi-step software work: specs, planning, subagent-driven implementation with decision-boundary model tiering, verification, and handoffs. When a task is more than a quick edit, route it through the matching skill with the `Skill` tool instead of improvising the process.

## Routing

- **bootup** — a new or unfamiliar project, a fresh clone, or no known build/test/lint commands. Assesses readiness and routes onward.
- **research** — open-ended investigation where the answer is not yet known (domain study, comparing approaches, understanding an unfamiliar system).
- **crucible** — harden a vague intent into a spec by interrogation (one question at a time).
- **starchart** — map a decision space wider than one session into decision tickets.
- **premortem** — the gate before implementation starts: surface what would sink the plan.
- **arcane-mode** — the SDD pipeline: spec → plan → briefed implementer/critic subagents, file handoffs, goal-backward verification, fresh-eyes convergence.
- **campaign** — a program layer over arcane-mode for multi-milestone work.
- **review** — standalone review of a change outside the pipeline (hunt lenses, security, deslop).
- **debug** — systematic root-cause investigation with evidence discipline.
- **handoff** — carry a working mental model across a session boundary.
- **forge-skill** — author or improve a Catalyst skill (friction-driven, proposal-gated).
- **envoy** — hand a substantial task to an external vendor (codex/grok/kimi) through the companion runtime.
- **install** — set up or repair the toolchain; also the doctor.

## Coordination with other process libraries

Catalyst owns the development *process* — specs, tiered planning, verification, handoffs. If **superpowers** is also installed, its brainstorming, TDD, and systematic-debugging skills remain the right entry for those specific moments; Catalyst does not replace them and does not re-issue their "check for a skill before acting" rule. Use the most specific applicable skill; when both a Catalyst process skill and a general one apply, the process skill sets the approach and the other carries it out.

## The one rule

For anything beyond a trivial, single-file change, pick the routing skill BEFORE acting — reading the codebase, planning, or answering — and invoke it with the `Skill` tool. The skills tell you how to do the work; skipping them and improvising is the failure this introduction exists to prevent.
