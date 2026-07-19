---
read-on:
  - a hypothesis is about to be recorded rejected/confirmed (Gate 3)
  - evidence is being weighed between rival hypotheses
  - a probe or test run failed for infrastructure reasons
  - a factor is about to be declared irrelevant ("X doesn't affect it")
home-of:
  - probe outcome partition (pass / fail / infra / not-run)
  - probe pre-commitment
  - the independence unit (pseudoreplication)
  - absence-of-evidence discipline (the sensitivity argument)
  - aliasing and missingness checks
---
# Evidence discipline — how probe results earn their weight

Absorbed from field-proven experimental-methodology sources (journal 0.7.2). The debug SKILL.md sketch points here; where the sketch and this file differ, this file governs.

## Outcome partition: pass / fail / infra / not-run

Every probe outcome lands in exactly one of four bins. **pass** and **fail** speak to the hypothesis. **infra** (the probe itself broke: env, tooling, flaky harness) is INCONCLUSIVE — it can neither confirm nor refute the hypothesis it was probing, and recording it as a fail (or silently, as "didn't work") corrupts the evidence trail the ranking runs on. **not-run** stays visible in the state file: a probe planned but never executed is not a probe that passed, and a resumed session must see the difference.

A partial finding surfaced DURING an infra failure — the probe died but its output already showed something real — is still recorded as evidence and addressed. The infra failure voids the probe's verdict, never the facts it emitted before dying.

## Pre-commitment: the deciding probe is named before its output

Which observation "counts" for a hypothesis is fixed BEFORE the probe's output is seen — that is exactly what the hypothesis's `predicts <observable>` line in the state file is for. Choosing the confirming log line after the fact is evidence-hacking even when honest: any rich output contains something that fits any story. The prediction was written first; the output either matches it or it doesn't, and a non-matching output does not get to nominate a substitute observation from the same run — that substitute becomes a NEW prediction for a NEW probe run.

## The independence unit — pseudoreplication

N assertions over one fixture / seed / process / cached state = ONE confirmation, not N. Evidence multiplies only across INDEPENDENT units: a different fixture, a different seed, a different machine or config path, a different day's data. Before counting "three probes agree" as convergence, name what actually VARIED between them — three reads of the same cached state agree by construction and carry the weight of one. This is the independence axis the evidence-strength ranking (SKILL.md Gate 3) implicitly assumes; when rivals tie on tier, the one backed by more independent units wins.

## Absence of evidence ≠ evidence of absence

"The log shows nothing" supports "it doesn't happen" only together with a SENSITIVITY argument: state what this probe WOULD have shown had the defect been present, and why the probe was in a position to catch it (right log level, right process, right time window). No sensitivity argument → the silence is not-run-grade, not a refutation — and a hypothesis must never be recorded `rejected` on such silence alone.

## Aliasing — before "factor X doesn't matter"

A manipulation rarely changes exactly one thing. Before concluding a factor is irrelevant, name what the manipulation was CONFOUNDED with: toggling the flag also recompiled, the restart also cleared the cache, the newer branch also bumped a dependency. "X doesn't affect it" is claimable only when the manipulation isolates X — or when each named alias has been separately probed.

## Missingness mechanism

Skipped tests, filtered-out runs, gaps in a log series: ask whether the ABSENCE itself is informative before reasoning over what remains. A test skipped BECAUSE the environment is broken (the missingness correlates with the defect) reads very differently from a test skipped at random; a data filter whose criterion correlates with the symptom silently biases every conclusion drawn downstream of it. When the mechanism of missingness is unknown, say so in the evidence list — an unexamined filter is a premise, and Gate 3 already mandates auditing premises before escalating strange results to system bugs.
