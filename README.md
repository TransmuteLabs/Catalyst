# Catalyst

A skills family for disciplined agentic development. Form factor — small self-contained markdown skills plus a few zero-dependency shell scripts. Content — a synthesis of a ratified subagent-driven development process (decision-boundary model tiering, verdict adjudication, fresh-eyes convergence), superpowers' handoff hygiene, GSD's operating rules (tracer-first, goal-backward verification), grilling/wayfinder cores (Matt Pocock, MIT), and the ContinuousClaude process layer absorbed as skills.

## Install (Claude Code)

```
claude plugin marketplace add TransmuteLabs/Catalyst
claude plugin install catalyst@catalyst
```

Or interactively: `/plugin marketplace add TransmuteLabs/Catalyst`, then `/plugin install catalyst@catalyst`. Skills appear namespaced as `catalyst:<skill>` (e.g. `/catalyst:bootup`).

## The workflows

**Entry.** `bootup` is the dispatcher for a new or unfamiliar project: it assesses agent-readiness (build/test/lint commands, gitignore, repo present), closes mechanical gaps through executors, detects an active campaign, and routes the user's intent to the right skill. It reads nothing itself — scouts return verbatim quotes; role integrity over economy.

**A feature.** `crucible` hardens the idea by interview — one question at a time, each carrying a recommended answer — until the decision tree is closed, then writes the spec section by section under user approval. The approved spec (a `status: approved` marker in the file) is the entry ticket to `arcane-mode`: it writes the plan, runs the `premortem` gate (any tiger blocks Task 1 until its mitigation lands as plan tasks), then executes task by task through fresh subagents — implementer on a complete brief, critic on the diff, orchestrator adjudicating every verdict, one ledger line per task. Verification is goal-backward against the plan's must_haves, then a personally-read whole-branch review, then iterative fresh-eyes audit rounds until **two consecutive rounds find nothing**. User-visible behavior gets a conversational UAT pass. Branch finish re-gates against the moved base, asks ONE integrate question (merge / PR / keep / discard), and executes the choice.

**Big fog.** An effort too large for one session with no writable spec goes to `starchart` first: a committed map of decision tickets — each ticket closes one decision, the map is done when nothing is left to decide. The finished map converts naturally into a campaign or feeds `crucible`.

**A program.** `campaign` is the layer above many arcane-mode runs: two committed files (PROGRAM.md — intent, milestones, decision log; ROADMAP.md — phases with evidence stamps) that survive clones and machine changes. Every status flip carries an evidence stamp; a router reconciles the roadmap against reality both ways at every session start; merge conflicts between machines arbitrate by evidence, and the escalations a run DISCOVERS land in one batched question (questions owned by a downstream gate are named there but asked in-route — the batch never front-runs a gate). A milestone closes only by a fresh-eyes audit against the program's INTENT, not the phase checklist.

**Named gates and waivers.** Every named gate in the family (convergence rounds over code, the milestone audit, spec approval) bends only to the user's EXPLICIT command, never to deadline pressure — and the waiver is RECORDED where the gate's evidence would have lived, in a shape no reader can mistake for the gate having passed. A recorded waiver is never re-demanded; it covers the code state it was written at, never work that lands after it.

**A bug.** `debug` before any fix: build a feedback signal that goes red on the exact symptom, minimize it, prove the cause against it (hypotheses must predict observables), fix at the source. Three failed fixes mean the frame is wrong — stop and re-diagnose, never a fourth silent patch — the evidence trail goes to the user and the design conversation happens first. The investigation state lives in a file and survives context resets.

**A review.** `review` for standalone code/PR review outside the pipeline: agents gather structural facts (the capture covers staged, unstaged, and untracked files), the reviewer reasons over them with authored probing questions, the verdict comes after adjudication. Fixes never happen while the review is open.

**Sessions.** `handoff` transfers the mental model between sessions — what the next instance must not re-discover. It complements the pipeline ledger (task progress) rather than duplicating it, and is compatible with ContinuousClaude's auto-handoff hooks.

**Skills themselves.** `forge-skill`: a new rule earns its place only with baseline evidence — a recorded pressure-scenario failure (RED) or verified field harm — and is written against the observed rationalizations. This repo's own `tests/pressure/` harness holds 38 such recorded baselines (see `tests/pressure/INDEX.md`); it runs only to baseline NEW rules, never as a regression gate over text edits.

## Learn by example

`docs/EXAMPLE.md` walks one feature end-to-end through the family (bootup → crucible → premortem → arcane-mode → finish) with realistically-shaped artifacts. `FRICTION.md` at the repo root is the live friction journal — the sole source of skill edits between rule baselines.

## Skills

### `catalyst:bootup` — entry dispatcher
Assesses a project's agent-readiness and routes to the right family skill. Readiness runs through ContinuousClaude tooling when it actually responds (verified by output, never by a name on PATH) or through a scout checklist otherwise; mechanical gaps (linter/formatter configs, gitignore, a missing git repo) are closed by executors on exact briefs — configs only, sources untouched (with one sanctioned, user-consented exception — the git-init initial commit stages sources), and `git init` ships with two guards: the gitignore lands BEFORE the initial commit, and that commit is a named plan item the user consents to. Detects active campaigns and offers them as the default route. The dispatcher never reads project files itself.

### `catalyst:research` — open-ended investigation
For questions whose answer isn't known yet. Codebase facts come from scouts (find/list/measure/quote with file:line, no conclusions), external knowledge from the researcher agent (sources, confidence, counterarguments mandatory). Every claim is checked against the deepest source and marked VERIFIED or INFERRED; inferred never enters conclusions unverified. Giant sources are chunked to disk and fanned out, never streamed through context. The result always materializes as `findings.md`. A deep mode runs an iterative hypothesis loop: an explicit contract with confidence scores earned by evidence, a bias premortem, deepen-before-widen iterations, and hard caps with honest open questions.

### `catalyst:starchart` — decision map for big fog
Plans an effort that doesn't fit one session and can't be specced yet, via a committed map of decision tickets — each closes ONE decision, sized to a session. The map (Destination, decisions index, the fog, out-of-scope) is multi-session, multi-machine memory: committed, pulled before reading, merge conflicts arbitrated by what's on disk, user decisions never auto-merged. Starchart decides — it never builds. The map's Frontier index keeps every currently-open ticket visible, its completeness checked mechanically against the ticket files on disk. When nothing is left to decide, the map feeds crucible or converts into a campaign.

### `catalyst:crucible` — hardening decisions by interview
One question at a time, each with a recommended answer and real alternatives; facts are looked up, never asked; decisions are the user's, and silence is not consent. The interview walks the decision tree in dependency order, locks component topology before drilling deep, and sweeps a coverage net (data/state, security/access, deployment/operations…) before declaring the tree closed. Hard gate: no code, no scaffolding before the spec is approved — with one sanctioned exception, a marked throwaway prototype answering a named design question. The spec is approved section by section; the final approval is a `status: approved` marker in the file. An explicit order to skip a SECTION's approval is recorded in open/deferred — the skipped ground stays visibly unapproved; only an order to skip the FINAL approval itself writes the marker as `status: approved (waived: <date>)`. A fast path synthesizes the spec directly from an already-held design discussion. Approvals are durable: each section's approval writes a dated mark into the draft (a dying session's approvals survive), and post-approval edits travel under a `status: approved (edits pending re-approval: <date>)` marker with per-entry, dated user answers — nothing approved is re-asked, nothing edited slips through as approved.

### `catalyst:premortem` — failure projection before Task 1
The gate between an approved plan and execution: jump to the imagined failure and reason backward through six lenses (wrong base assumptions, shortcuts, weak implementations, missing evaluations, necessity conditions, Nth-order effects). Every failure mode gets a falsifiable check and a class: **tiger** (mitigation becomes plan tasks before Task 1), **paper tiger** (recorded why it's bounded), **elephant** (named out loud — a ticket or an explicit user decision). The verdict lives in a yaml artifact next to the plan; the ledger line is only a cache of it. The same gate can run earlier, against an approved SPEC (the spec-gate): its findings edit the spec under crucible's pending-re-approval marker, and a rejected edit reverts — the gate never silently rewrites approved ground. A user-accepted risk is a recorded, reversible decision: WITHDRAWING an acceptance — any time, even after the work shipped — routes back through this skill's withdrawal machinery (the risk returns to its original class immediately; on shipped work that is a surfaced divergence, never silent history).

### `catalyst:arcane-mode` — the SDD pipeline
Spec → plan → execution by fresh subagents → goal verification → convergence. The orchestrator makes decisions and adjudicates; subagents execute decisions already made. Tiering by decision boundary: analysis/critics never below the standard tier, implementers on the executor tier only with a brief containing zero open questions, scouts find-and-quote only. Per task: brief → implementer → review package → critic (two verdicts plus adjudication requests) → orchestrator adjudication → fix wave → one ledger line. Iron rules: a found defect is fixed completely, never legitimized; named gates bend only to the user's explicit, recorded command; gates are confirmed by honest exit-code forms and exact test baselines, never a bare "EXIT 0"; after compaction, trust the ledger and git log, not memory. Branch finish re-gates on the moved base and executes exactly one user-chosen integration. A user-ordered spec AMENDMENT — any time, even mid-execution or after integration — is routed, never improvised: crucible's fast path hardens it, the effort's gate re-runs scoped to the change, invalidated tasks re-open in the ledger, and a post-done amendment demotes the phase and runs a new scoped plan off the integrated head.

### `catalyst:review` — standalone review
The pipeline's critic discipline outside the pipeline. Phase 1 gathers structural facts by agents: the capture enumerates the full scope (staged, unstaged, AND untracked files — each appended as a new-file diff) so the verdict never rides a silently partial diff; test baselines are compared before/after by exact counts. Phase 2 is semantic: authored probing questions written before reading the diff, hunt categories by change type, severity by actual risk. The verdict is written to a timestamped workspace artifact before delivery — an interrupted review resumes from it — and the BEFORE baseline is measured in a throwaway worktree, never by mutating the user's tree. Findings are fixed outside the open review — small obvious fixes only after the verdict is delivered. A deslop mode runs deletion-first cleanup, one slop class per pass, behavior locked by a regression test first.

### `catalyst:handoff` — session transfer
Carries the mental model to the next session: goal, immediate next step, how the system works, what was tried, why decisions went the way they did. The format is ContinuousClaude-hook compatible (the statusline parses its `goal:`/`now:` fields). Handoffs are keyed by effort, not by date; the pipeline ledger keeps task progress, the handoff keeps everything a fresh instance would otherwise re-discover.

### `catalyst:upgrade-harness` — extend the ouros sandbox
A guided procedure for adding external functions to the ouros sandbox harness (present when the ContinuousClaude binary layer is installed): bridge-function patterns for async APIs and sync local operations, a security policy that denies by default and fails closed, registration, and a test from inside the sandbox.

### `catalyst:install` — toolchain setup and doctor
Installs or repairs the stack the family builds on: the Catalyst plugin, the ContinuousClaude binary layer, and the optional analysis tools (bloks, tldr, fastedit). Detection means the tool responds with its own signature — a name on PATH proves nothing. The flow is dispatcher-shaped: a detection sweep, ONE batched plan the user approves once, execution one component at a time with re-detection after each (an installer's exit 0 is not success; a responding tool is), and a final table with the consequences of anything skipped. Doubles as a doctor for degraded setups.

### `catalyst:debug` — a red loop before fixes
Iron law: no fix without a proven root cause, no hypothesis without a red loop. Gate 1 builds a tight pass/fail signal that goes red on the exact symptom (failing test, replay, bisection harness…) and tightens it — fast, sharp, deterministic; everything after merely consumes it. Hypotheses must predict observables and die against evidence; the fix lands at the source, never the symptom. A third failed fix stops the process — the frame is wrong. Investigation state lives in `.catalyst/debug/<slug>.md` and survives compaction; debugging never runs on the executor tier.

### `catalyst:forge-skill` — TDD for process documentation
A skill is code whose runtime is an agent. New rules start from a RED baseline (recorded rationalizations become the requirements); the evidence archive lives in `tests/pressure/` with its index. Regression gates over skill texts are retired — the harness baselines new rules only. Scenario design rules (real pressure, the wrong option as the path of least resistance, never quoting the tested rule), a frontmatter doctor, and craft levers for predictability (no-op test per sentence, leading words, positive prompting, checkable completion criteria). Wired to this repo's `tests/pressure/` harness.

### `catalyst:campaign` — the program layer
A roadmap of phases toward a milestone, alive across weeks, dozens of sessions, and multiple machines. Two committed files are the program's memory; every status flip writes an evidence stamp onto its row (approved spec → specced, premortem verdict → planned, ledger → executing, converged — or explicitly waived — verification → verified, user acceptance → done, executed integration choice appended). The router reconciles both ways at every session start: evidence that exists but wasn't flipped, statuses that lack their evidence, acceptances voided by a red re-gate (demoted immediately and visibly for every machine). Cross-machine merge conflicts arbitrate by evidence with user escalation for anything genuinely divergent — batched into one question per run. Escalations survive the session that discovered them: an unanswered conflict durabilizes in the roadmap as an explicit `unresolved` shape — never silently swallowed — and a class of never-defer duties (acceptance demotions, spec/marker transport, amendment re-opens) commits AND pushes immediately so every machine sees them. Parked phases preserve their state under an explicit user decision. A milestone closes only by a clean fresh-eyes audit against the program's intent — or a recorded, visible user waiver.

## Agents

Thin role definitions in `agents/`; the dispatch prompt sets scope and focus, each agent's safety core is non-overridable.

- **`catalyst:implementer`** (executor tier for complete briefs; tier named per dispatch, up on the tier-up triggers) — executes ONE pipeline task from a complete brief: implementation, tests, atomic commits, honest report. Makes no decisions; an unexpected red means one honest attempt, then BLOCKED with raw output.
- **`catalyst:critic`** (standard tier minimum; named per dispatch) — reviews one task's diff: spec compliance and code quality as two separate verdicts, adjudication requests as an explicit list.
- **`catalyst:scout`** (executor tier for find-and-quote, standard for grounding scouts; named per dispatch) — fact reconnaissance: find/list/measure/quote with file:line. No conclusions, no recommendations.
- **`catalyst:researcher`** (standard tier; named per dispatch) — external research: web, docs, packages, foreign repos. Sources, confidence, and counterarguments mandatory; sandboxed when the binary layer is present.
- **`catalyst:auditor`** (tier set per dispatch) — fresh-eyes audit of a branch or milestone through an assigned lens set: undirected defect search, claim-truth, goal-backward. Clean context by design.

## ContinuousClaude binary layer

The family is the mandatory skill layer of a ContinuousClaude install and fully replaces its markdown skills. Binary-dependent features (bloks knowledge cards, the ouros sandbox, `ContinuousClaude readiness`, `cc-research`) activate only when the tool actually responds on the machine — never assumed from a name on PATH — and degrade gracefully to memory, scouts, and the web when absent.

## Layout and state

```
skills/<name>/
  SKILL.md          # core: when to use, pipeline, iron rules, red flags
  references/       # heavy reference, loaded on demand
  scripts/          # zero-dep shell tools
agents/             # thin agent role definitions
tests/pressure/     # pressure-test regression suite (see tests/README.md)
```

Working artifacts live in `<repo>/.catalyst/` with a durability split: **ephemeral** workspaces (`sdd/`, `debug/`, `research/`, `handoffs/`) self-ignore in git; **program memory** (`campaign/`, `map/`) is committed — it must survive `git clean`, clones, and machine changes. Skill changes are gated by the pressure suite: `tests/pressure/run-green.sh`.
