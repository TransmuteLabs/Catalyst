---
name: research
description: Use for open-ended investigation where the answer is not yet known - exploring a domain, comparing approaches, understanding an unfamiliar system. Not for executing toward a known goal.
---

# Research — open-ended investigation

## Overview

Investigation where the answer isn't known in advance: domain reconnaissance, comparing approaches, understanding an unfamiliar system. Unlike arcane-mode (driving toward a known goal), the goal here is a map of facts and conclusions with evidence. The result always materializes as an artifact — otherwise the research evaporates with the context.

## Rules

1. **Tiering by decision boundary.** Codebase fact gathering — scouts (find/list/measure/quote, everything with file:line; no "choose/evaluate/propose"). External sources (web, docs, packages, foreign repos) — the catalyst-researcher agent (sandbox mode when the ContinuousClaude binary layer is present, clone/degraded otherwise; sources + confidence + inversion mandatory). A source file larger than a context window (log, transcript, dump) with no sandbox available: chunk it to disk and fan out one extraction agent per chunk with the same query, then synthesize over their compact returns — never stream a giant file through your own context. Conclusions and synthesis — "standard" tier minimum, or you. Decisions on the results — the user's.
2. **Grounding.** Every claim is checked against the deepest source (code / original doc, not a retelling). Derived-vs-derived checks don't count. Mark claims: ✓ VERIFIED (read it yourself / scout quoted it) vs ? INFERRED (indirect signals) — inferred never enters conclusions unverified.
3. **Quantifiers and connectives.** When compressing other texts, distortions are born in the connective tissue ("always", "therefore", "after", "most") — verify every added quantifier separately.
4. **Parallelism.** Independent directions — parallel scouts/researchers, one direction per agent, non-overlapping briefs. Choosing among N options: agents return all N with objective attributes — you/the user choose.
5. **Context economy.** Agent reports go to files in `.catalyst/research/<topic>/raw/`; only the synthesis enters context. If Ouros/`cc-research` (ContinuousClaude) responds on this machine — raw material can live in REPL session variables outside the context entirely; an option, not a dependency.

## Deep mode — iterative hypothesis loop

For a broad question that one wave of agents won't close (exploratory domain study, N-way comparison with unknowns), upgrade to a looping pipeline (ContinuousClaude autonomous-research core, binaries optional):

1. **Hypothesis contract first** — before any search, write `.catalyst/research/<topic>/contract.md`: the question, scope (focused ~3 iterations / exploratory ~6 / comparative ~4), and explicit hypotheses, each with `confidence: 0` and `status: pending`. Confidence scale: 0 unknown → 0.3 speculative → 0.6 supported → 0.9 well-established — earned by evidence count and quality, never by plausibility.
2. **Bias premortem** (one pass, before iteration 1): confirmation bias — searching only for supporting evidence? source bias — one source type dominating? blind spots — obvious sub-questions not covered? Fix the hypothesis list before spending iterations.
3. **Iterate**: each round dispatches researchers/scouts per hypothesis (one per agent, prior findings passed as file paths); then validate — do artifacts exist, is each confidence delta justified by the evidence in them, do parallel findings contradict; then evolve the contract — update confidences, mark hypotheses supported/refuted/superseded, add NEW hypotheses from the agents' second-order questions.
4. **Decision gate** after each iteration: all hypotheses ≥ 0.8 → synthesize; context budget ≥ 75% → synthesize (leave room for handoff); user stops → synthesize; otherwise loop. Hard cap by scope (focused 5 / exploratory 10 / comparative 7) — then force-synthesize with Open honestly listing what's unresolved.
5. Each iteration goes **deeper, not wider** by default: wider = new hypotheses (bounded), deeper = more evidence on existing ones.

## Artifact

`.catalyst/research/<topic>/findings.md` — telegraphic:

```markdown
# <Research question>
## Conclusion        — 3-7 sentences, each marked ✓/?
## Facts             — table/list, each with a source (file:line / URL / report name)
## Assumptions chain — what must be true for the conclusion to hold, in dependency
                       order; each VERIFIED/UNVERIFIED/FALSE; the load-bearing one named
## Counterarguments  — the inversion: who disagrees, what would make the conclusion fail
## Rejected          — what was checked and why it doesn't fit (the class, not just the instance)
## Open              — what remains unknown and how to find out
## Second-order      — questions that emerged from the research itself
## Sources           — raw reports, links (years; old sources flagged)
```

Findings feed the next skills: a decision to make → catalyst:crucible; fog wider than a session → catalyst:starchart; ready to build → arcane-mode. Research finds the path — it does not walk it.

## Red Flags — STOP

- A conclusion rests on a ? INFERRED claim that was never verified.
- An agent returned a recommendation and it migrated into findings as a conclusion without your own verification.
- The research ended without an artifact file ("I'll tell it in chat" — it evaporates).
- Raw agent reports pasted into context instead of paths.
- The "research" started changing code — that's implementation; it belongs in arcane-mode.
- A confidence score raised without new evidence ("it sounds increasingly right").
- Deep mode spent an iteration going wider when existing hypotheses sit below 0.6.
