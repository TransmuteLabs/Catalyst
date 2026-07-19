---
read-on:
  - a standalone review reaches phase 2 (semantic reasoning over gathered facts)
  - a critic or auditor dispatch is being written and hunt categories are being chosen
  - a deslop pass needs named smells beyond the SKILL.md list
home-of:
  - the standard hunt-lens catalog for reviews (structural, devex, gating, craft)
  - the severity-trust and unfinished-research rules
---
# Hunt lenses — the standard catalog for reviews and critic dispatches

Absorbed from field-proven review harnesses (journal 0.8.3: a production
branch-audit prompt pair and a principle-skill stack). Dispatches pick lenses
from here by change type; the dispatch prompt may add task-specific lenses but
never replaces the severity rules at the bottom.

## Structural simplification (the ambitious lens)

Do not stop at "this could be a bit cleaner." For every meaningful change ask:
is there a reframing under which whole branches, helpers, modes, or layers
disappear? Prefer the solution that makes the code feel inevitable in
hindsight; if complexity can be deleted rather than rearranged, push for that
path. Flag refactors that move code around without reducing the number of
concepts a reader must hold.

## Spaghetti-growth flags (escalate, not nitpick)

- New ad-hoc conditionals bolted onto unrelated flows; narrow edge-case
  handling planted mid-way through an already busy function.
- One-off booleans, nullable modes, or flags complicating existing control
  flow; "temporary" branching likely to become permanent debt.
- Feature-specific logic leaking into general-purpose modules; bespoke helpers
  where a canonical utility exists; logic landing in the wrong layer.
- Thin or identity wrappers adding indirection without clarity; generic
  "magic" mechanisms hiding simple data-shape assumptions.
- Casts, `any`/`unknown`, unnecessary optionality that obscure the real
  invariant where an explicit typed boundary could exist.
- A file pushed past ~1000 lines by the diff without a strong structural
  reason — ask for decomposition first.
- Copy-pasted logic instead of an extracted helper.
- Independent work serialized for no reason; related updates that can leave
  state half-applied where a more atomic structure is available.

## Craft lenses (pick per change type)

- **Boundary discipline:** guards concentrate at system boundaries (CLI,
  config, network, external APIs); internal code trusts its types; business
  logic stays in pure functions.
- **Idempotency:** commands, lifecycle steps, and processing loops that run
  amid crashes/retries must converge to the same end state regardless of
  partial prior runs.
- **Shared-state separation:** when concurrent actors might write the same
  file/branch/key, eliminate the sharing structurally before reaching for
  serialization; one shared writer must be a real invariant, not an accident.
- **Reader load:** count the layers between a question ("what does this
  value do?") and its answer, and the hidden state the reader must carry;
  collapse one-caller wrappers, shrink mutable scope.
- **Domain modeling:** repeated shape-assumptions and branching across files
  signal a missing structure (state machine, policy object, typed model) —
  a design problem, not a style nit.
- **Deletion bias:** before accepting an addition, ask what the diff could
  have removed; subtract dead weight first, then judge what remains.

## Breaking-devex lens (for infra/config-touching diffs)

Changes that break how developers run or build locally are findings, not
details: renamed/added environment variables, moved secret sources, remapped
ports, new scripts that must run for existing functionality, altered local
workflows. New ALTERNATIVE ways to run things are not breakage; changed
EXISTING ways are.

## Gate-leak lens (for flag/permission-touching diffs)

Features gated behind flags or internal-only checks must not leak past the
gate; leaks are usually subtle (a default flipped, a check reordered, a new
code path skipping the gate). Trace the gate end-to-end.

## Intended-breakage judgment

If a finding IS the branch's stated intent (removing a feature, dropping a
safeguard) and its scope is well constrained — do not report it as a defect.
Report it anyway when the author likely does not see the full implications,
or the blast radius exceeds the stated intent.

## Severity trust and unfinished research (never overridden)

- Never inflate severity: a Minor reported as Critical erodes the trust that
  makes real Criticals actionable. Trace a finding end-to-end to full
  confidence before assigning severity (the family's severity calibration
  rule applies — semantic/guarantee losses are re-checked, not rounded down).
- A finding with unfinished research is not a finding: "X is a problem unless
  the backend handles it" is banned when the backend code is readable — go
  read it. What you could check yourself and didn't is your gap, not a
  hedge.
- Fresh eyes first: run your own audit BEFORE reading other reviewers'/bots'
  comments on the same change; cross-check theirs after, and attribute what
  you adopt.
