---
name: forge-skill
description: Use when creating a new skill or agent definition, editing an existing one, or verifying that a skill actually changes behavior - for this family or project-local skills. Triggers - "add a skill", "the skill isn't working", "update the skill", packaging session/spike findings as a skill.
---

# Forge Skill — TDD for process documentation

## Overview

A skill is production code whose runtime is an agent. It is developed the same way: write the test first (a pressure scenario), watch it fail (baseline WITHOUT the skill), write the skill, watch it pass (GREEN run), close the loopholes. A skill written without watching an agent fail first encodes what the author assumed, not what agents actually get wrong.

**Iron Law: A NEW RULE EARNS ITS PLACE ONLY WITH BASELINE EVIDENCE.** Before authoring a rule, record the failure it prevents: a RED baseline run (a fresh session WITHOUT the skill fails the scenario; the recorded rationalizations are the requirements the rule must answer), or — for a convention rule — sanctioned field evidence (observed harm, a verified concrete failure sequence). A COMPLIANT baseline is credited to clean model defaults only after checking the transcript for reliance on machine-injected process rules — reliance found means the rule still earns its place. Shipping without evidence on the user's EXPLICIT order is recorded in the tests journal (record shapes: `references/gate-records.md`). Per-edit GREEN regression gates over skill TEXTS are retired (user decision, journal 0.6.3): a convergence criterion belongs to code, not prose — text edits ship on review, and the harness runs only to baseline a NEW rule.

## The loop

1. **RED — baseline.** Write a pressure scenario (below) and run it in a fresh headless session WITHOUT the skill — on the tier that will actually execute (an opus-clean scenario can still fail on the executor tier). Record verbatim how the agent rationalizes the wrong choice. No failure at baseline → that rule is already default and earns no place in the skill; a skill made ONLY of baseline-passing rules is not needed — stop. Conventions the agent cannot know (paths, harness wiring, family mechanics) count as missing by definition and need no behavioral RED — but they also need evidence that their absence hurt: observed harm in the field, or a VERIFIED concrete failure sequence demonstrated against the mechanism's text (an adjudicated audit finding qualifies; a hypothetical does not).
2. **Write.** Address the recorded rationalizations specifically. Every rule earns its place by countering an observed failure, not a hypothetical one.
3. **GREEN.** Same scenario, fresh session WITH the skill loaded. The agent must comply for the right reason (check the stated reasoning, not just the answer letter).
4. **REFACTOR.** New loophole observed in real use → plug it. (The former clean-rounds convergence criterion for skill texts is retired — it belongs to code.)

## Pressure scenario design

A scenario is a real work situation, not a quiz about the rules:

- Open with `IMPORTANT: this is a real work situation, not a quiz. Choose and act.`
- Build real pressure: deadline, sunk cost, a tempting shortcut that is genuinely attractive, an authority nudging the wrong way.
- Offer 2-4 concrete options where the wrong one is the path of least resistance and the right one has visible cost.
- Scenario references on-disk fixtures the runner doesn't create → add "answer in text only" — otherwise headless agents wander off exploring an empty cwd.
- Never name the rule being tested — a scenario that quotes the rule tests reading comprehension, not behavior.

## Family harness (this repo)

`tests/pressure/`: scenarios in `scenarios/<name>.md`, the map in `map.tsv`, runners `run-baseline.sh` (RED — renames the global CLAUDE.md for the run, restores it guaranteed) and `run-green.sh` (WITH the skill), durable per-scenario statuses and a MANIFEST binding each run to the exact revision and scenario bytes. The journal `tests/README.md` is append-only history. **Full mechanics, scoring, and the journal record machinery: `references/harness.md` and `references/gate-records.md` — read before ANY harness run or journal write.** The harness exists to BASELINE NEW RULES; it is not a regression gate (retired, see Iron Law).

## Frontmatter doctor

Before shipping, check the four defects that kill discovery:

- `description` states WHEN to use (symptoms, triggers, "Use when...") — never a summary of the process; the agent decides to load from the description alone.
- `name` is kebab-case, letters/digits/hyphens only, matches the directory.
- No echoed or truncated trigger lists copy-pasted from another skill.
- Body rules are behavioral ("do X before Y", red flags with rationalization counters) — anything expressible as a lint/validation belongs in tooling, not prose.

## Craft — what makes a skill predictable

A skill exists to wrangle determinism out of a stochastic system; predictability of PROCESS (same steps every run) is the root virtue. The levers:

- **No-op test, per sentence:** does this line change behavior versus the agent's default? "Be thorough" fails it; delete failing sentences whole, don't trim them. Every surviving line pays context rent.
- **Leading words:** one pretrained concept ("tight" loop, loop goes "red", "tracer" task) anchors a whole region of behavior in one token — hunt for triads of adjectives and collapse them into a single strong word. A weak word's fix is a stronger word ("relentless"), not more prose.
- **Prompt the positive:** prohibition names the elephant ("don't think of X" makes X more available). State the target behavior; keep a prohibition only as a hard guardrail you can't phrase positively, paired with what to do instead.
- **Completion criteria, checkable and exhaustive:** each step ends on a condition the agent can verify ("every modified file accounted for", not "produce a list") — a fuzzy criterion invites premature completion.
- **Progressive disclosure by branches:** inline what every run needs; push what only some branches reach into a linked reference file. Cure sprawl with the ladder, not by deleting live rules.
- **Invocation economics:** a model-invoked skill pays context load (its description sits in every turn) — worth it only when the agent must reach it autonomously. Rarely-fired hand-tools can be user-invoked (zero context load, you are the index); many of those pile up cognitive load — cure with one router skill.

## What deserves a skill

Repeatable guidance an agent will need again: a technique, a discipline, a reference. NOT: one-off solutions ("we chose library Y" → decision log/memory), things a validator can enforce, retellings of how one problem was solved once. Family skills are written in English; project-local skills go to the project's `.claude/skills/`, not the family.

## Red Flags — STOP

- A skill written or edited with no baseline evidence of the failure it prevents — nor, for a convention rule, the sanctioned field evidence (observed harm, or a verified concrete failure sequence).
- A rule shipped on "it's obviously needed" with neither a baseline nor field evidence.
- A scenario where the tested rule is quoted or the right answer carries no cost.
- A live harness run launched for anything other than baselining a NEW rule (regression gates over text edits are retired — they burn live sessions for nothing).
- A description that summarizes the workflow instead of naming the triggering situations.
- Judging GREEN by the answer letter while the reasoning shows compliance for the wrong reason.
