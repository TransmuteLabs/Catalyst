---
name: crucible
description: Use when a feature idea, architectural decision, or spec needs hardening before planning - requirements are fuzzy, trade-offs unresolved, or the user wants their thinking stress-tested. Also use before catalyst:arcane-mode when no approved spec exists.
---

# Crucible — hardening decisions by interview

## Overview

A relentless interview that drives an idea/plan/decision to shared understanding, from which a spec is born. Core: the grilling technique (Matt Pocock, MIT) + the superpowers brainstorming hard gate: **no code, no scaffolding, no "quick drafts" before the spec is approved**. This applies to every project regardless of perceived simplicity.

## When to use

- A new feature, an architectural decision, a change of approach — before writing a plan.
- The user asks to discuss / grill / stress-test an idea.
- Before catalyst:arcane-mode when no approved spec exists.

**When NOT to use:** the decision is trivial and the user already named it exactly; the effort is so large and foggy that questions can't be phrased yet — catalyst:starchart first.

## Interview technique

1. **One question at a time.** Ask — wait for the answer. Multiple questions at once bewilder and get shallow answers. Keep the question queue to yourself; the user sees only the current one.
2. **Every question carries your recommended answer** (plus 1-2 alternatives where they are real). A recommendation is input for the user's decision, not the decision itself: **never count your own recommendation as the answer**, even if it seems obvious, even if the user replies slowly. No answer — the question stays open, the interview waits.
3. **Facts are yours, decisions are the user's.** Anything discoverable from the environment (files, code, tools, docs) you look up yourself and never ask. Every *decision* goes to the user, one at a time.
4. **Walk the decision tree in dependency order:** decisions that others depend on come first; a branch closed by the user's answer is not reopened.
5. **Stop gate:** do not act (code, plan, dispatches) until the user confirms shared understanding is reached. Confirmation is explicit, never inferred from silence.

## Coverage net

The interview follows the decision tree, not a questionnaire — but before declaring the tree closed, sweep the domains that get forgotten systematically. For each: either it produced decisions, or you consciously mark it not-applicable — never silently skipped.

Problem & goals · users & journey · **data & state** (ownership, lifecycle, migrations) · technical landscape (what exists, what it constrains) · scale & performance · integrations & dependencies · **security & access** · **deployment & operations** (rollout, rollback, observability).

A domain that is relevant but produced zero decisions means the tree is not closed.

## Output — the spec

When the decision tree is closed, write the spec **section by section, with user approval after each section**: goal and non-goals → decisions made (D-01, D-02, … with "what was decided and why") → must_haves (truths / artifacts / key_links — the seed for arcane-mode's goal-backward verification) → open/deferred. Save to `docs/specs/YYYY-MM-DD-<topic>-spec.md`. Deferred ideas are recorded in the spec explicitly — they do NOT slip into the plan silently.

Exactly one terminal state: approved spec → catalyst:premortem (risk gate) → catalyst:arcane-mode (plan). If the interview reveals fog wider than one session — hand off to catalyst:starchart.

## Red Flags — STOP

- Wrote code/scaffolding/"a draft to look at" before the spec was approved.
- Asked two or more questions in one message.
- Counted your own recommendation as the user's answer ("the answer is obvious", "the user is busy — proceeding with defaults"). The user's silence is not consent.
- Asked the user about a fact that lives in files/code.
- Retold the whole spec at the end instead of section-by-section approval.
- The interview turned into a lecture: your messages grow, questions disappear from them.
