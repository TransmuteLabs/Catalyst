---
read-on:
  - bloks responds on this machine and a pipeline session starts or ends
home-of:
  - the bloks knowledge loop (PREPARE cards into briefs, report feedback fields, DISTILL)
---
# Knowledge loop — optional bloks integration

Activates only when `bloks` responds on this machine (verify by running `bloks --version` or `bloks context .` and checking the output — a name on PATH proves nothing; ContinuousClaude's multitool was once named `cc` and collided with the system C compiler on every Unix machine, which is why it's now `ContinuousClaude`). Without bloks, the loop degrades to what the pipeline already does: lessons distill to persistent memory and the ledger. Nothing else in the pipeline changes.

## PREPARE — front-load cards into briefs

Before dispatching an implementer whose task touches a library with cards:

```
bloks context .                      → project rules, tastes, corrections
bloks recipe {lib} {keywords}        → task-specific API docs + recipes
bloks card {lib} {symbol}            → symbol-level signatures + gotchas
```

Paste the output **verbatim** into the brief's context section, each block with its card id (`card:{lib}:{module}`, `deck:{lib}`, `symbol:{lib}:{symbol}`, or a learned-card slug). Do not summarize or rewrite — the cards are already compressed. bloks returned nothing for a lib → skip it; never fill the section manually.

This does not relax the readiness test: cards are grounding material inside a complete brief, not a substitute for it.

## Reports — three extra fields

When cards were injected, the implementer/critic report gains:

- `bloks_used`: per card — `{id, helpful: true|false, reason}` (only cards actually referenced).
- `corrections`: a card said X, reality is Y — with evidence.
- `discoveries`: non-obvious facts about a library learned the hard way this task.

## DISTILL — after the task (or at branch convergence)

For every card injected this task:
- referenced and correct → `bloks ack {card-id}`
- found wrong/outdated → `bloks nack {card-id}` + `bloks report "<lib>" <error_type> "$(cat <scratch-file>)"` (description written to a scratch file first — see the shell boundary below)
- never referenced → skip (no signal).

Discoveries → write the finding to a scratch file with a file tool, then `bloks learn "<lib>" "$(cat <scratch-file>)"` — **one finding = one card**; five discoveries = five calls. **Shell boundary (non-negotiable):** findings quote external content, and pasted into a command line that text is shell-interpreted even inside double quotes (`$(…)`, backticks) — the file-then-substitution form is the only sanctioned one (substitution output becomes a single argument and is not re-interpreted), and `<lib>` must match `[A-Za-z0-9._-]+`. Atomic cards compose; monoliths rot. A card records the outcome, not the process: "X returns null on empty input", never "investigated X's behavior" — and each fact stands alone, no pronouns pointing at a conversation that will be gone.

**Spikes and research dives** get wrapped up, not abandoned: if the outcome contains repeatable guidance (how to evaluate X, a pattern, a library's gotchas), it becomes bloks cards — or a project-local skill via catalyst:forge-skill when the guidance is a procedure. If the outcome was a one-off decision ("we chose Y, end of story"), it goes to the decision log / memory instead — not every spike deserves a skill.

## Enforcement ladder for distilled conventions

A recurring convention/correction (seen in ~3+ reports) gets promoted to the **highest enforcement tier that can express it** — prose is the last resort, not the first:

```
lint rule (eslint/ruff/clippy) > type system (tsconfig/mypy) > formatter
> pre-commit hook > CI check > CLAUDE.md / memory (only when no tool can express it)
```

Recommendations that change shared config go to the user as one batched question — never applied silently.

## Red Flags — STOP

- A card summary retold in a brief instead of the verbatim block ("I compressed it further").
- `bloks learn` with a batched multi-finding card.
- Finding text pasted inline into a `bloks` command instead of the file-then-substitution form — external text in a shell command line is an execution vector, not data.
- ack/nack skipped after a task whose brief carried cards ("no time") — the loop is the point; skipping it means the project doesn't learn.
- A convention written into CLAUDE.md/memory when a lint rule could enforce it.
- Presence of the tooling assumed from a name on PATH without a responding subcommand.
