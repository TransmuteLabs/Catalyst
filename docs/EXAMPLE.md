# Worked example — one feature through the family

A realistic end-to-end pass: adding per-user rate limiting to an existing API.
Artifacts are abbreviated but shaped exactly as the skills produce them.

## 1. Entry — `catalyst:bootup`

The user opens a session in the repo: "let's add rate limiting to the public
API". Bootup does not read files itself — a scout returns the readiness facts
(build/test commands known, suite baseline `212 passed; 0 failed`, no active
campaign, no standing map) — and routes: feature needing decisions →
`catalyst:crucible`.

## 2. Hardening — `catalyst:crucible`

One question at a time, each carrying a recommended answer:

> **Q1.** Limit scope: per user, per API key, or per IP? Recommendation:
> per API key (matches billing identity; IPs are shared behind NATs).
> — *User: per API key.*
>
> **Q2.** On exceeding the limit — reject with 429, or queue? Recommendation:
> 429 + `Retry-After` (queueing hides overload and complicates clients).
> — *User: 429.*
>
> **Q3.** Where does the counter live? Recommendation: Redis (already in the
> stack, atomic INCR, TTL for the window). — *User: yes, Redis.*

Coverage net (small effort → one list question): *"Marking not-applicable:
users & journey, deployment beyond a config flag, integrations. Confirm?"* —
confirmed. The spec is written **section by section**, each approval recorded
as a dated mark and committed; the file ends up as:

```markdown
status: approved
# Spec: per-key API rate limiting          docs/specs/2026-07-19-rate-limiting-spec.md
## Goal / Non-goals ...
## Decisions
D-01: limit keyed by API key (billing identity), not IP — ...
D-02: 429 + Retry-After on breach — ...
D-03: Redis INCR with per-window TTL — ...
## must_haves
truths:
  - "a key exceeding N req/min receives 429 with Retry-After"
  - "other keys are unaffected by one key's breach"
key_links:
  - "middleware wired into the public router, before auth-heavy handlers"
## Open/deferred ...
```

## 3. Plan + gate — `catalyst:arcane-mode` → `catalyst:premortem`

Arcane-mode writes the plan (2 tasks: middleware + config/tests wiring, each
with exact `Files:` and test plans). The premortem gate runs before Task 1
and finds a tiger:

```yaml
premortem:
  status: BLOCK
  tigers:
    - risk: "Redis outage turns the limiter into a full API outage"
      evidence: "middleware sits before every public handler"
      falsifiable_test: "kill redis in a test; assert requests still pass"
      mitigation: "fail-open on Redis errors + alert metric (plan task)"
```

The mitigation lands as a plan task, the gate re-runs → the tiger moves to
`mitigated:` → **WARN**, verdict line goes to the ledger, Task 1 may dispatch.

## 4. Execution — implementer / critic / ledger

Per task: `task-brief` extracts the task to a file; a fresh implementer
executes it (tests first — the failing test is watched failing), reports
`DONE, 214 passed; 0 failed; commits <a>..<b>`; a critic reviews the diff
against the brief with the orchestrator's authored probing questions; the
orchestrator adjudicates and writes the ledger line:

```
Task 1: complete (commits 3f2a91c04d1e..8b7d3e2f6a90, review clean)
```

An implementer hitting an unexpected red outside its diff stops honestly:
`BLOCKED (own diff green; unexpected red in tests/test_auth.py)` — no
diagnosis, raw output attached. That is the stop rule, and it is the most
baseline-failed behavior in the family's evidence archive.

## 5. Verification and finish

Goal-backward against the spec's must_haves (each truth demonstrated, each
key_link laid), the whole-branch review read personally, then fresh-eyes
audit rounds over the CODE until two consecutive rounds find nothing (the
convergence criterion applies to code — never to prose). User-visible
behavior gets a short conversational UAT pass (`uat:` lines in the ledger).
Branch finish: the base moved → re-gate on the merged head, then ONE
question — merge / PR / keep / discard — and the chosen option is executed
and recorded.

## What did NOT happen

No code before the approved spec. No second question in one message. No
self-approved recommendation. No silent risk acceptance. No "done" without
evidence. Every gate that bent, bent only by the user's explicit, recorded
order — and a waiver never reads as a pass.
