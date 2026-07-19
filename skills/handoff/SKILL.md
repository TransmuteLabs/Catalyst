---
name: handoff
description: Use when ending a session with unfinished work, before context compaction, or when resuming from a previous session's handoff document. Triggers - session wrap-up, context near limit, "continue from last time".
---

# Handoff — session transfer

## Overview

A handoff transfers the mental model to a fresh session. The cardinal sin: forcing the next instance to re-discover what you already know. The format is ContinuousClaude-compatible: its hooks auto-trigger a handoff before compaction and at 85% context, and parse the `goal:`/`now:` fields into the statusline — those field names must not change.

Division of labor with the arcane-mode ledger: the **ledger** tracks pipeline task progress (what is committed and reviewed); the **handoff** carries the cross-session mental model (how the system works, what was tried, why decisions were made). They complement, not replace each other.

## CREATE mode

Determine the session (from the repo root — all `.catalyst/` paths anchor to `git rev-parse --show-toplevel`, falling back to the cwd outside any git repo, never a repo subdirectory's cwd): `ls -td .catalyst/handoffs/*/ 2>/dev/null | head -1` surfaces the most recent directory — verify it belongs to THIS effort (interleaved efforts: returning to an older one means using ITS directory, not the newest) (or `thoughts/shared/handoffs/` if the project already uses the ContinuousClaude tree — don't grow a second one). No directory yet, or this session started a NEW effort → create `.catalyst/handoffs/<effort-kebab>/` (name it after the effort, not the date; ensure `.catalyst/handoffs/.gitignore` holds a line that is exactly `*` at every write — absent file: create it with `*`; present without that line: PREPEND `*` as the first line, keeping the rest ("contains a `*` somewhere", e.g. `*.log`, does not ignore the workspace) — never only at first creation: the workspace is ephemeral and self-ignores). File: `.catalyst/handoffs/{session}/YYYY-MM-DD_HH-MM-SS_<kebab-description>.yaml` — created EXCLUSIVELY, never overwriting: if the exact path already exists (two auto-triggers of one effort in the same second — the recovery artifact must not be clobbered), suffix the name (`_2`, or the pid) until the create succeeds. Under an active campaign (you are writing the `campaign:` pointer): run campaign's Session-end check FIRST — roadmap currency (every flip carries its stamp) and the state/branch PUSH (campaign `references/state-writes.md`) — the auto-trigger path (85% context / pre-compaction) is exactly where this gets skipped; a failed push is named in `codebase_state` (campaign's named-failure arm), never silent.

Format (required sections marked):

```yaml
---
session: {name}   # this handoff's front-matter field only — NOT the arcane ledger's `session: <ISO> resumed (…)` claim line (arcane's `references/ledger.md`): same word, different record, never cross-parsed
date: YYYY-MM-DD
status: complete|partial|blocked
outcome: SUCCEEDED|PARTIAL_PLUS|PARTIAL_MINUS|FAILED   # OPTIONAL — kept for
        # ContinuousClaude analytics compatibility; no family text reads it
        # (drop it on non-CC projects). PARTIAL_PLUS = partial, path forward
        # clear; PARTIAL_MINUS = partial, path blocked/unclear
---
# ── STATUSLINE (goal:/now: REQUIRED — parsed by hooks) ──
goal: {what this session accomplished}
now: {what the next session should do first}
test: {verification command, e.g. pytest tests/test_foo.py — a statusline MIRROR
      of codebase_state.test_command: that field is the source of truth, on
      divergence it wins}
campaign: {.catalyst/campaign/<name>/ — OPTIONAL, only when the session ran under a campaign; omit otherwise}

# ── MENTAL MODEL (REQUIRED) ──
mental_model: |
  {3-10 lines: how the system ACTUALLY works as discovered this session —
  non-obvious behavior, execution order, real data flow, surprises}

# ── CODEBASE STATE (REQUIRED) ──
codebase_state:
  builds: true|false
  tests_passing: {N}/{total}
  test_command: {...}
  pre_existing_failures: [{failures NOT from this session}]
  uncommitted_changes: true|false
  branch: {...}
  dirty_files: [...]

done_this_session:
  - task: {...}
    files: [...]

decisions:            # capture the WHY
  - name: {...}
    chose: {...}
    over: [{rejected alternatives}]
    because: {the actual reason}

findings:             # tiered
  critical: [{next instance MUST know or they'll waste time}]
  useful: [...]
  fyi: [...]

worked: [{approaches that worked}]
investigated: [{examined and ruled out/confirmed WITHOUT a failure — so the
  next instance doesn't re-explore the same ground}]
failed:
  - attempted: {...}
    root_cause: {...}
    avoid: {which CLASS of approaches to skip}
    use_instead: {...}

user_intent: |        # when non-obvious
  {the real context behind the request: "preparing a demo — looks matter more than architecture"}

hypotheses:           # REQUIRED when status: partial|blocked
  - status: active|confirmed|ruled_out
    claim: {...}
    evidence: [...]
    next_test: {...}

blockers: [...]
questions: [...]
next:                 # the current trajectory, not a wishlist of future work
  - {a concrete step with file:line and function names}

# ── NEXT SESSION PROMPT (REQUIRED) ──
next_session_prompt: |
  {3-15 lines, written as if the user is talking to a fresh instance: files,
  lines, pattern examples, the verification command, agreements that must not break}

# ── FILES (REQUIRED — the resume tear-check keys on it) ──
files:
  created: [...]
  modified: [...]
```

**Quality gates before saving:** mental-model test — would a fresh instance avoid your first 20 minutes of mistakes? decision test — could they judge validity if circumstances changed? dead-end test — would they avoid the failure class, not just the exact attempt? start test — could they begin coding in 30 seconds? No large code blocks — use references like `src/auth.ts:42-68 (validateToken)`. The mental model IS the handoff; everything else is metadata.

## RESUME mode

1. Path given → read the document completely (no limit/offset), plus linked research/plans. Multiple files → the most recent by timestamp; a torn newest file (its required trailing sections — `next_session_prompt`, `files` — missing) means the writer died mid-CREATE: take the prompt/files from the previous complete handoff, but READ the torn file's surviving top sections (`mental_model`, findings) — the freshest mental model is the whole point of a handoff; flag the tear to the user. No parameters → ask which one; NO handoff files at all (a fresh clone — the workspace is self-ignored, handoffs are machine-local) → say so and fall back to durable state: an active campaign's router, a standing starchart map (`.catalyst/map/` — committed, survives clones), the arcane ledger + `git log`, or bootup routing — never invent a resume context.
2. **Campaign pointer first:** the handoff carries `campaign:` → run the campaign router before anything else (read ROADMAP.md; catalyst:campaign rules). A dangling pointer (the campaign directory missing or unreadable) is flagged to the user and the resume proceeds as NON-campaign — never silently, and never looping handoff↔router. The handoff supplies the mental model; the roadmap decides what happens next — a next_session_prompt executes only if the router lands on the same work, on divergence the roadmap wins.
3. **next_session_prompt priority:** if present — present it to the user directly: "The previous session left a prompt: {…}. Proceed or adjust?" Approved → verify the state first with step-4's mechanics scoped to the prompt (a scout checks `codebase_state` — builds/tests/branch/dirty files — and the critical findings' files against reality), then execute as-is; the rest of the handoff is context.
4. No prompt → full analysis: verify the current state against the handoff (scouts under arcane-mode rules), read the critical files from findings, present a synthesis: tasks → status then/now, learnings validity (file:line), recommended actions, conflicts.
5. **Never assume the state matches the handoff.** Scenarios: clean continuation → proceed; diverged codebase → reconcile and adapt the plan; incomplete work → finish it first; stale handoff → re-evaluate the strategy.
6. If an arcane-mode ledger exists — it is the source of truth for pipeline tasks; the handoff is the source of truth for the mental model.

## Red Flags — STOP

- A handoff without a mental_model, or with a model that just retells commits ("did X, did Y" — that's done_this_session, not a model).
- A failed entry without an avoidance class (the next instance will repeat a neighboring variation of the same mistake).
- Resume started working before verifying the state ("the handoff is fresh anyway").
- A next_session_prompt that requires clarifying questions — it isn't ready.
- Renamed goal:/now: fields — the statusline hook parsing breaks.
- Executed a next_session_prompt under a campaign without running the campaign router first.
