---
name: debug
description: Use when facing a bug, test failure, performance regression, or unexpected behavior whose cause is not yet proven - before proposing or applying any fix. Also when a previous fix didn't hold, or debugging spans context resets. Triggers - "why is this failing", "it broke", "it's slow", flaky behavior, a fix that didn't stick.
---

# Debug — a red loop before fixes

## Overview

Random fixes waste time and mask real defects. This skill is the family's debugging discipline: build a feedback loop that goes red on the bug, prove the cause against it, fix at the source — never patch the symptom. Debugging is analysis: under the family tiering (the tier→model mapping lives in arcane-mode's Tiering table) it never runs on the executor tier; a dispatched debugger is "standard" minimum, and the verdict on the cause is adjudicated by the orchestrator.

**Iron Law: NO FIX WITHOUT A PROVEN ROOT CAUSE. NO HYPOTHESIS WITHOUT A RED LOOP.**

## Debug state survives the session

Non-trivial investigations outlive context windows. Keep the state in `.catalyst/debug/<slug>.md` from the start (on first creation write a `.catalyst/debug/.gitignore` containing `*` — the workspace is ephemeral and self-ignores; the path anchors to the repo root — `git rev-parse --show-toplevel`, falling back to the cwd outside any git repo (name the location to the user) — never a repo subdirectory's cwd, or a resumed session in a subdirectory misses the state file):

```markdown
# <slug> — <symptom, one line>
status: building-loop | investigating | cause-proven | fixing | resolved
loop: <the one command that goes red, or NOT-YET + what was tried>
evidence: - <fact, file:line / command output>   # facts only, no guesses
hypotheses: - H1 <statement> → predicts <observable> → rejected/confirmed
fixes-tried: - <change> → <result>               # count them
```

After a compaction or in a new session: trust this file and `git log`, not conversation memory. The file is self-ignored, so git never carries it: on a WORKTREE MOVE (arcane's live-sibling rule) or before any worktree cleanup, COPY `.catalyst/debug/<slug>.md` to the destination root yourself — the root of the checkout where the investigation CONTINUES: on a move, the new sibling worktree; before a cleanup, the main checkout (never another worktree that may itself be cleaned) — a lost state file is rebuilt from `git log` and the fix commits, but the `fixes-tried` count is then only a floor (≥ the visible fix commits): say so in the file, and let the 3-fix rule count from the floor, never from zero.

## Gate 1 — build a tight loop (this IS the skill)

A **tight** pass/fail signal that goes red on THIS bug — everything after merely consumes it. Spend disproportionate effort here. Construction ladder, roughly in order: failing test at whatever seam reaches the bug → HTTP script against a dev server → CLI run with a fixture, diffed against known-good → headless browser script → replay of a captured real payload/trace → throwaway harness (minimal subset, mocked deps) → property/fuzz loop for "sometimes wrong" → bisection harness (`git bisect run`) when it appeared between two known states → differential run (old vs new, config A vs B).

Then tighten: faster (seconds, not minutes), sharper (assert the user's EXACT symptom, not "didn't crash"), deterministic (pin time, seed RNG, isolate fs/network). Non-deterministic bugs: don't chase a clean repro — raise the reproduction rate (loop the trigger 100×, add stress, narrow timing) until it's debuggable.

**Completion criterion:** ONE command you have already run at least once (invocation + output in the state file), red-capable on the exact symptom, deterministic enough, agent-runnable. Genuinely cannot build one → stop and say so: list what was tried, ask for a captured artifact (log dump, trace, recording), environment access, or permission for temporary instrumentation. Reading code to build a theory before this command exists is the exact failure this skill prevents.

## Gate 2 — minimise

Run the loop, watch it go red, confirm it is the USER'S failure mode (a nearby different failure = wrong bug = wrong fix). Then shrink the repro one cut at a time, re-running after each, until **every remaining element is load-bearing**. A minimal repro shrinks the hypothesis space and becomes the regression test.

## Gate 3 — prove

3-5 **ranked, falsifiable** hypotheses before testing any (a single hypothesis anchors on the first plausible idea). Format: "if X is the cause, changing Y makes the loop green / Z makes it worse" — no stated prediction means it's a vibe, sharpen or discard. One of the candidates is always **"the measurement is wrong, not the system"** — the loop itself, the query, the fixture, or a premise (one key applied across distinct entities, a filter not matching the data's grain) may be the defect; audit the premise before escalating a strange result to a system bug. Show the ranking to the user — they often re-rank instantly ("we just deployed #3") — but don't block on them.

Rank by evidence strength, not by plausibility: controlled reproduction > primary artifacts (logs, traces, git history, file:line behavior) > independent sources converging > single-source code-path inference > circumstantial (timing, naming, resemblance to past bugs) > intuition. A hypothesis resting on lower tiers is down-ranked when a rival holds stronger tiers; each top hypothesis must also carry evidence AGAINST itself and name the **cheapest probe that discriminates it from the next-best**; the discriminating probe between the top TWO hypotheses runs first. Two "different" hypotheses that reduce to the same mechanism are merged, not counted as convergence.

Probe one variable at a time, each probe mapped to a prediction: debugger/REPL breakpoint first, targeted logs at hypothesis-separating boundaries second — every log tagged with one prefix (`[DBG-<slug>]`) so cleanup is a single grep; never "log everything and grep". Performance regressions: logs lie — take a baseline measurement (profiler, timing harness, query plan), then bisect; measure first, fix second.

## Gate 4 — fix

Regression test at a **correct seam** — one that exercises the real bug pattern at its call site; a too-shallow seam gives false confidence, and **no correct seam existing is itself a finding** (the architecture prevents locking the bug down — flag it). Then: watch it fail → ONE fix at the proven source → it passes, the full baseline holds BEFORE/AFTER (`N passed; 0 failed; K ignored`, `set -o pipefail`) → re-run the Gate-1 loop on the original un-minimised scenario. No bundled refactoring. The defect gets fixed completely — never legitimized (no retry-masking, no "accept the limitation", no test pinned to broken behavior). Before resolved: grep the debug tag — zero instrumentation left; the confirmed hypothesis goes into the commit message; only after the fix is in, ask "what would have prevented this?" — architectural answers go to the user as a follow-up, not as scope creep.

## The 3-fix rule

Count `fixes-tried` — record the attempt in the state file BEFORE running the fix (count first, then try: a session dying mid-attempt must not undercount). A resumed session finding a counted attempt with no recorded result determines that attempt's outcome FIRST — re-run the loop on the current state, record it — the rule counts failures, not intentions. After the 3rd failed fix, STOP: each failed fix surfacing a new symptom elsewhere is evidence of a wrong pattern, not bad luck. Take the evidence trail to the user and question the design — do not attempt fix #4 silently.

## Inside vs outside the pipeline

- Inside arcane-mode: an implementer hitting an unexpected failure follows its stop rule (one honest repro attempt → BLOCKED with raw output). The ORCHESTRATOR then runs this skill — the implementer never root-causes.
- Standalone ("why is this failing?"): the deliverable is the proven cause and the evidence; apply the fix only when the user asked for a fix.

## Red Flags — STOP

- Reading code to build a theory before a red-capable command exists.
- "Quick fix now, investigate later" / "just try changing X and see".
- One hypothesis, tested immediately — anchoring on the first plausible story.
- Two changes probed at once — a confirmed hypothesis can't be attributed.
- A retry/sleep/timeout added where the cause is unknown — masking, not fixing.
- A regression test forced into a wrong seam to have "a test".
- Fix #4 about to be attempted without an architecture conversation.
- A green re-run declared from memory instead of the loop re-run on the current state.
- Debug findings living only in conversation — the state file was never written.
