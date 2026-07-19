# Friction journal — the only source of skill edits

The family is validated by PRODUCTION, not by test runs (policy: journal 0.6.3
NOTE). This file is the receiver for that policy: whenever real use rubs — a
skill fired on the wrong trigger or missed its trigger, a model re-asked
something the skill should have answered, a rule was ambiguous at the moment
of use, a referenced norm could not be found — record ONE line here at the
moment of friction. Skill edits source from these entries (or from a NEW-rule
baseline, forge-skill's Iron Law); "I remember it being awkward" is not a
source. The full contour — how an entry becomes a targeted, veto-checked,
one-variable edit and how its outcome lands back here:
`skills/forge-skill/references/improvement-loop.md`.

Entry format (append new lines at the END of the file; each entry ONE line):

```
- YYYY-MM-DD <skill-or-agent> — what rubbed, in one sentence [status: open | fixed <commit> | won't-fix — <why> | dead-end → epitaph]
```

An entry stays open until a fix commit, an explicit won't-fix, or a dead-end
verdict closes it — by editing the status field of the SAME line in place;
the entry text itself never changes.

## Dead ends (epitaphs)

The family's negative memory: approaches tried and buried, and rules/files
retired — each with its reason. Before ANY skill edit is proposed, this
section is checked (the dead-end veto; normative home:
`skills/forge-skill/references/improvement-loop.md`): a candidate matching a
buried approach needs explicitly named new grounds, or a different path.
Nothing is deleted silently — every retirement writes its epitaph here.
Epitaphs append at the end of THIS section (before Entries); shape:

```
- YYYY-MM-DD <scope> — <the buried approach>; why: <what failed, with evidence>; superseded-by: <what to do instead, or ->
```

- 2026-07-19 family-wide — per-edit GREEN regression gates and clean-rounds convergence over skill TEXTS; why: prose audit loops diverge — each fix mints new audit surface, ~30 live sessions per gate run burned ~$6000 over rounds 39-45 with no measurable defect payoff (journal 0.6.3 NOTE); superseded-by: free deterministic lint + FRICTION-sourced edits; the harness baselines NEW rules only.
- 2026-07-19 family-wide — merging/cutting the skill count to "reduce mass"; why: skill count costs almost nothing (skills load by trigger; always-on cost is the description line), and the merge proposal was rejected by the user — mass lives in hot-path bytes, not in the number of skills; superseded-by: distillation — hot core ≤12KB per skill, doctrine verbatim in references.

## Entries

(append below; newest last)

---
