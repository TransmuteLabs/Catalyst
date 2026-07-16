# Catalyst

## Install (Claude Code)

```
claude plugin marketplace add TransmuteLabs/Catalyst
claude plugin install catalyst@catalyst
```

Or interactively: `/plugin marketplace add TransmuteLabs/Catalyst`, then `/plugin install catalyst@catalyst`. Skills appear namespaced as `catalyst:<skill>` (e.g. `/catalyst:bootup`).

## Overview

A skills family for disciplined agentic development. Form factor — superpowers-style: small self-contained markdown skills + a couple of shell scripts, zero runtime dependencies. Content — a synthesis of three sources: a ratified SDD process (decision-boundary model tiering, verdict adjudication, fresh-eyes convergence), superpowers' handoff hygiene, and GSD's operating rules (deviation rules, tracer-first, goal-backward verification), plus grilling/wayfinder cores (Matt Pocock, MIT) and the ContinuousClaude process layer (premortem, handoff, bootup) absorbed as skills.

## Skills

| Skill | Purpose |
|---|---|
| `catalyst:bootup` | Entry dispatcher: project readiness assessment + routing to the right skill |
| `catalyst:research` | Open-ended investigation → `findings.md` artifact with verified/inferred marking |
| `catalyst:starchart` | Decision-ticket map for foggy multi-session efforts (wayfinder core); decides, doesn't do |
| `catalyst:crucible` | Hardening an idea/decision by one-question-at-a-time interview → approved spec (grilling core + hard gate) |
| `catalyst:premortem` | Failure-state projection gate between an approved plan and Task 1 (tiger / paper tiger / elephant) |
| `catalyst:arcane-mode` | SDD pipeline: spec → plan → subagent execution → goal verification → convergence |
| `catalyst:review` | Standalone code/PR review outside the pipeline, same critic discipline |
| `catalyst:handoff` | Session transfer: mental-model handoff create/resume (ContinuousClaude-hook compatible) |
| `catalyst:upgrade-harness` | Extend the ouros sandbox with new external functions (requires the ContinuousClaude binary layer) |
| `catalyst:install` | Toolchain setup and doctor: detect-by-response, one batched consent, verify every component |
| `catalyst:debug` | A red feedback loop before fixes: build/tighten the loop → minimise → prove → fix at the source; persistent debug state; 3-fix rule |
| `catalyst:forge-skill` | TDD for skills: RED baseline → write → GREEN pressure run → close loopholes (wires tests/pressure) |
| `catalyst:campaign` | Program layer above arcane-mode: PROGRAM/ROADMAP state, phase router, milestone audit against intent |

Flow: fog bigger than a session → `starchart` → `crucible` → spec → `arcane-mode` (plan → `premortem` gate → execution). A well-scoped feature goes straight to `crucible` → spec → `arcane-mode`. A multi-phase program toward a milestone — `campaign` (each phase still runs the flow above). Entry from scratch — `bootup`.

## Agents

Thin role definitions in `agents/` (the dispatch prompt always overrides): `catalyst:implementer` (sonnet, executes one task from a complete brief), `catalyst:critic` (opus, two verdicts + adjudication requests), `catalyst:scout` (sonnet, codebase facts only), `catalyst:researcher` (opus, external research with sources/confidence/inversion; ouros sandbox when present, clone/web otherwise), `catalyst:auditor` (model set per dispatch — top tier for mechanism-probing/milestone lenses, opus for claim-truth/conformance; fresh-eyes convergence lens).

## ContinuousClaude binary layer

The family is the mandatory skill layer of a ContinuousClaude install and fully replaces its markdown skills (bootup, research, autonomous, premortem, review, handoffs, upgrade-harness — all absorbed or superseded; `/autonomous`'s pipeline is superseded by `arcane-mode`, its knowledge loop lives in `arcane-mode/references/knowledge-loop.md`, its looping research in `research`'s deep mode). Binary-dependent features (bloks cards, ouros sandbox, `ContinuousClaude readiness`, `cc-research`) activate only when the tool actually responds on the machine — never assumed from a name on PATH — and degrade gracefully to memory/scouts/web when absent.

## Layout

```
skills/<name>/
  SKILL.md          # core: when to use, pipeline, iron rules, red flags
  references/       # heavy reference, loaded on demand
  scripts/          # zero-dep shell tools
agents/             # thin agent role definitions
tests/pressure/     # pressure-test regression suite (see tests/README.md)
```

Working artifacts live in `<repo>/.catalyst/` with a durability split: **ephemeral** workspaces (`sdd/`, `debug/`, `research/`, `handoffs/`) self-ignore in git — the skill that creates one writes a `*` .gitignore inside it; **program memory** (`campaign/`, `map/`) is committed — it must survive `git clean`, clones, and machine changes. Skill changes are gated by the pressure suite: `tests/pressure/run-green.sh`.
