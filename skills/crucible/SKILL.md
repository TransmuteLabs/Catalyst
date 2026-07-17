---
name: crucible
description: Use when a feature idea, architectural decision, or spec needs hardening before planning - requirements are fuzzy, trade-offs unresolved, or the user wants their thinking stress-tested. Also use before catalyst:arcane-mode when no approved spec exists.
---

# Crucible — hardening decisions by interview

## Overview

A relentless interview that drives an idea/plan/decision to shared understanding, from which a spec is born. Core: the grilling technique (Matt Pocock, MIT) + the superpowers brainstorming hard gate: **no code, no scaffolding, no "quick drafts" before the spec is approved**. This applies to every project regardless of perceived simplicity.

The gate has ONE sanctioned exception: a **throwaway prototype answering a named design question** the interview cannot settle on paper ("does this state model feel right?"). Marked throwaway, no polish, no persistence, state surfaced after every action; the validated ANSWER feeds the interview and the spec — the prototype code never graduates into the implementation (park it out of main with a pointer).

## When to use

- A new feature, an architectural decision, a change of approach — before writing a plan.
- The user asks to discuss / grill / stress-test an idea.
- Before catalyst:arcane-mode when no approved spec exists.

**When NOT to use:** the decision is trivial and the user already named it exactly; the effort is so large and foggy that questions can't be phrased yet — catalyst:starchart first; a READY plan/spec needing failure projection before execution — that's catalyst:premortem (stress-testing an unfinished idea ≠ premortem of a finished plan: the interview re-opens decisions, the premortem attacks their consequences).

## Interview technique

1. **One question at a time.** Ask — wait for the answer. Multiple questions at once bewilder and get shallow answers. Keep the question queue to yourself; the user sees only the current one.
2. **Every question carries your recommended answer** (plus 1-2 alternatives where they are real). A recommendation is input for the user's decision, not the decision itself: **never count your own recommendation as the answer**, even if it seems obvious, even if the user replies slowly. No answer — the question stays open, the interview waits.
3. **Facts are yours, decisions are the user's.** Anything discoverable from the environment (files, code, tools, docs) you look up yourself and never ask. Every *decision* goes to the user, one at a time.
4. **Walk the decision tree in dependency order:** decisions that others depend on come first; a branch closed by the user's answer is not reopened — with ONE exception: a later file-fact that falsifies the premise the user decided on (a constraint the closed answer violates) is presented as one question naming the fact and the affected decision; the user re-decides or keeps it — taste, second thoughts, or "a better idea" never qualify.
5. **Topology before depth.** When the subject has several components, lock the component list with the user FIRST (including what's explicitly deferred), then interrogate — always aiming at the currently weakest component: deep clarity on one component must not mask fog in its siblings. When this collides with dependency order, dependency order wins: aim at the weakest component among those whose upstream decisions are already closed. A NEW component discovered mid-interview amends the topology explicitly (one question: add or defer) — amending the list is allowed; reopening closed branches is not.
6. **Stop gate:** do not act (code, plan, dispatches) until the user confirms shared understanding is reached. Confirmation is explicit, never inferred from silence.

**Stuck-interview levers** (each used at most once, then back to normal questioning): the interview circles without closing branches → a contrarian question ("what if the opposite is true — does this constraint actually exist?"); the scope keeps growing → a simplifier question ("what is the simplest version that is still valuable?"); the core entities keep being renamed round after round → an ontology question ("what IS this thing, really — which entity is the core and which are supporting?").

## Coverage net

The interview follows the decision tree, not a questionnaire — but before declaring the tree closed, sweep the domains that get forgotten systematically. For each: either it produced decisions, or you consciously mark it not-applicable — never silently skipped.

Problem & goals · users & journey · **data & state** (ownership, lifecycle, migrations) · technical landscape (what exists, what it constrains) · scale & performance · integrations & dependencies · **security & access** · **deployment & operations** (rollout, rollback, observability).

A domain that is relevant but produced zero decisions means the tree is not closed.

## Output — the spec

Fast path: when the conversation ALREADY contains the decisions (a long design discussion just happened), don't re-interview — synthesize the spec directly from what was decided, marking anything you had to assume as an open question. Section-by-section approval still applies.

When the decision tree is closed, write the spec **section by section, with user approval after each section**: goal and non-goals → decisions made (D-01, D-02, … with "what was decided and why") → must_haves (truths / artifacts / key_links — the seed for arcane-mode's goal-backward verification) → open/deferred. Save to `docs/specs/YYYY-MM-DD-<topic>-spec.md` (anchored to the repo root — `git rev-parse --show-toplevel`, falling back to the cwd outside any git repo (name the location to the user) — like all family artifact paths: a spec saved under a repo subdirectory is invisible to the arcane/bootup/campaign consumers resolving from the root). The final user approval is recorded IN the file — a `status: approved` line at the top, written only after the last section is approved; until it lands, the file is a draft, and EVERY downstream consumer (arcane-mode's input check, bootup's routing, the campaign router's evidence rule) treats it as no spec. In a git repo the approved spec is COMMITTED at approval (named to the user; under a campaign the `specced` flip's state commit carries it to the base branch) — an uncommitted spec exists on one machine only, and every consumer routing on its link reads an uncommitted referent as missing evidence. The user's EXPLICIT order to skip the interview or a section's approval (an order, not sighing at the pace) is taken and recorded in the spec's open/deferred section ("section X unapproved — skipped by user order <date>") — the skipped ground stays visibly unapproved rather than silently blending in. An order to skip the FINAL approval itself is still the user's approval decision: write the marker as `status: approved (waived: <date>)` — consumers key on it as approved, readers see the shape — plus the open/deferred entry; left markerless, every consumer re-demands the interview the order just skipped. Deferred ideas are recorded in the spec explicitly — they do NOT slip into the plan silently.

Standalone terminal state: approved spec → catalyst:arcane-mode (which writes the plan; its premortem gate runs after the plan, before Task 1). If the interview reveals fog wider than one session — hand off to catalyst:starchart. **When another skill invokes crucible, control returns to the caller — no onward routing.** For a named decision artifact (a starchart ticket's Resolution, a MAP Destination, a campaign Intent/milestones) the output is that artifact, no spec file. For a campaign PHASE SPEC the output IS a spec (standalone rules apply), but it goes back to the campaign router, which owns what happens next.

## Red Flags — STOP

- Wrote code/scaffolding/"a draft to look at" before the spec was approved.
- Asked two or more questions in one message.
- Counted your own recommendation as the user's answer ("the answer is obvious", "the user is busy — proceeding with defaults"). The user's silence is not consent.
- Asked the user about a fact that lives in files/code.
- Retold the whole spec at the end instead of section-by-section approval.
- The interview turned into a lecture: your messages grow, questions disappear from them.
- Invoked by another skill for its artifact, but wrote an artifact of the wrong shape (a spec file where a ticket Resolution / Destination / Intent was asked — the campaign PHASE-SPEC branch legitimately writes a spec) or routed onward anyway — the caller owns the next step.
