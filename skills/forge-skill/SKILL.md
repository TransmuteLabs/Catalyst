---
name: forge-skill
description: Use when creating a new skill or agent definition, editing an existing one, or verifying that a skill actually changes behavior - for this family or project-local skills. Triggers - "add a skill", "the skill isn't working", "update the skill", packaging session/spike findings as a skill.
---

# Forge Skill — TDD for process documentation

## Overview

A skill is production code whose runtime is an agent. It is developed the same way: write the test first (a pressure scenario), watch it fail (baseline WITHOUT the skill), write the skill, watch it pass (GREEN run), close the loopholes. A skill written without watching an agent fail first encodes what the author assumed, not what agents actually get wrong.

**Iron Law: A SKILL EDIT SHIPS ONLY AFTER A GREEN PRESSURE RUN.** For a new skill the baseline (RED) comes first — the recorded rationalizations are the requirements the skill must answer; and a COMPLIANT baseline is credited to clean model defaults only after checking the transcript for reliance on machine-injected process rules (rules loaded outside the harness's CLAUDE.md rename name themselves in the reasoning) — reliance found means the rule still earns its place: another machine lacks the injection. The user's EXPLICIT order to ship ungated is taken and recorded in the tests journal as its own anchored line — `GATE OWED <ISO date>: <edited files> — shipped ungated by user order` — the owed gate stays visible and runs at the next session, it never silently becomes a passed one.

## The loop

1. **RED — baseline.** Write a pressure scenario (below) and run it in a fresh headless session WITHOUT the skill — on the tier that will actually execute (an opus-clean scenario can still fail on the executor tier). Record verbatim how the agent rationalizes the wrong choice. No failure at baseline → that rule is already default and earns no place in the skill; a skill made ONLY of baseline-passing rules is not needed — stop. Conventions the agent cannot know (paths, harness wiring, family mechanics) count as missing by definition and need no behavioral RED — but they also need evidence that their absence hurt: observed harm in the field, or a VERIFIED concrete failure sequence demonstrated against the mechanism's text (an adjudicated audit finding qualifies; a hypothetical does not).
2. **Write.** Address the recorded rationalizations specifically. Every rule earns its place by countering an observed failure, not a hypothetical one.
3. **GREEN.** Same scenario, fresh session WITH the skill loaded. The agent must comply for the right reason (check the stated reasoning, not just the answer letter).
4. **REFACTOR.** New loophole observed → plug it → re-run GREEN. Convergence for family skills: clean rounds per the harness scoring, not one lucky pass.

## Pressure scenario design

A scenario is a real work situation, not a quiz about the rules:

- Open with `IMPORTANT: this is a real work situation, not a quiz. Choose and act.`
- Build real pressure: deadline, sunk cost, a tempting shortcut that is genuinely attractive, an authority nudging the wrong way.
- Offer 2-4 concrete options where the wrong one is the path of least resistance and the right one has visible cost.
- Scenario references on-disk fixtures the runner doesn't create → add "answer in text only" — otherwise headless agents wander off exploring an empty cwd.
- Never name the rule being tested — a scenario that quotes the rule tests reading comprehension, not behavior.

## Family harness (this repo)

`tests/pressure/`: one scenario file in `scenarios/<name>.md`, one line in `map.tsv` (`name<TAB>model<TAB>file[<TAB>file...]` — the FIRST file is the primary surface the scenario exercises (a SKILL.md or a references/*.md); related files are ANY family files the scenario exercises: references, other skills' SKILL.md, agents/*.md; a family surface no row names is OUTSIDE the gate — a coverage hole to close, not a free pass). Shell scripts are family surfaces too, gated by NAMED script-level tests instead of map rows (prose scenarios can't execute them): editing `tests/pressure/run-baseline.sh` obliges a `tests/pressure/test-baseline-lock.sh` run; editing `run-green.sh`, `task-brief`, `review-package`, or `sdd-workspace` obliges `bash -n` plus that script's smoke (for task-brief: extract a task from a scratch plan and confirm the paths:/Global-Constraints headers; for run-green: a one-scenario run producing a MANIFEST.txt). An edited script with no runnable check is the same coverage hole). `run-baseline.sh [name...]` = RED, `run-green.sh [name...]` = GREEN; both run each scenario in a neutral cwd (agents started inside the harness find the scenario files and analyze the test instead of playing the role). Score per `tests/README.md`. Editing an existing family skill → re-run the scenarios whose mapped files you touched, not just new ones. An edit SHIPS (merges to main / releases) only after its GREEN run passes — until then it stays uncommitted, or on an unmerged branch when the edits ride a pipeline with per-task commits; either state found at session start = a gate owed — and session start ALSO checks the tests journal (`tests/README.md` — the journal's one home) for open owed lines: grep line-anchored `^GATE OWED` lacking the answer append, then VALIDATE every append found — presence is not closure: an append whose scenario coverage or run validity fails gate-records.md's checks leaves the line OPEN (a partial `scenarios:` list looks closed to a bare grep — that is the exact smuggle the validation exists to catch) — never a literal tail, and never the bare phrase (journal prose says "gate owed" narratively; only the anchored record shape is the record; an owed line buried under later entries is still owed; a shipped-ungated edit leaves a CLEAN tree — the journal line is its only trace). An open owed line FOUND — or RETIRING, CONSOLIDATING, or DELETING a map.tsv row (gate-records.md owns the recorded-retirement discipline; a silent row deletion is banned) — is a STOP-read trigger: `references/gate-records.md` owns the record machinery ENTIRELY (the closure append's shape and its scenarios:-coverage validity, rename re-binds, lost referents, the machine-local out/ identity) — the gate runs now and closes ONLY by that file's rules. This duty binds every session that loads this skill (the honest scope: "the next session" means the next skill-editing session — nothing else reads the journal). The gate is satisfied ONLY by a GREEN run in `tests/pressure/out/` newer than the edit that COVERS the scenarios mapped to the edited files — out/ dirs hold just the scenarios that invocation ran and record no verdict (scoring is manual), so re-score that run's outputs per `tests/README.md`; a newer run of OTHER scenarios, or a baseline (RED) dir, proves nothing.

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
- Shipping after editing a skill without a GREEN re-run ("the change is obviously fine").
- A scenario where the tested rule is quoted or the right answer carries no cost.
- One green pass declared convergence for a family skill.
- A description that summarizes the workflow instead of naming the triggering situations.
- Judging GREEN by the answer letter while the reasoning shows compliance for the wrong reason.
