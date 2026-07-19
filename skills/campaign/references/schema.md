---
read-on:
  - the full annotated ROADMAP/PROGRAM schema is needed (stamp grammar, lineage tokens, head: pin, demotion shapes, Parked protocol)
  - a stamp must be written or decoded beyond the SKILL.md sketch
home-of:
  - the annotated two-file schema
  - stamp grammar and demotion shapes
  - the Parked record shape
---
# Campaign schema (normative)

Verbatim campaign doctrine (0.7.0 distillation; split from mechanics.md by read-trigger in 0.7.x). Where SKILL.md's sketch differs in detail, THIS file governs. Internal references like "Rules", "Mechanics above", "(below)" refer to the pre-split SKILL.md layout; their targets live across the `references/` files — `mechanics.md` is the router. Merge cells and legacy shapes: `arbitration.md`.

## 1. Full annotated schema (authoritative; SKILL.md holds only a sketch)


`<repo>/.catalyst/campaign/<name>/`:

```markdown
# PROGRAM.md
status: active     — first line; DERIVED from the Milestones section, three sanctioned
                     writers: the router's terminal route (→ complete, with the date),
                     a merge recompute, the un-park re-open (→ back to active) — each
                     writes the date of its own flip; bootup keys on it
base: <branch>     — the campaign's BASE branch, written at creation (the branch the
                     roadmap approval commits on); every ON-base check, state commit,
                     and the router's step-0 pull compare `git branch --show-current`
                     against THIS name — never a guessed default (main/master guesses
                     silently commit state onto the wrong branch); a legacy PROGRAM.md
                     without the line is backfilled at first read — the derivation and its
                     cells live in `references/arbitration.md`; a merge can leave
                     `base: unresolved (between: … ||| …; merged <date>)` — a standing ask
                     (arbitration.md), never a branch name to pull or compare against
## Intent          — what this campaign must make true, 3-6 sentences; the milestone
                     audit runs against THIS text, not against the phase list
## Non-goals       — what it deliberately won't do
## Milestones      — M1, M2… each with its own must_haves (truths/artifacts/key_links)
                     and a `status:` line — `open`, `closed (audited: <date>, rounds N..M)`
                     (a clean intent audit; the audit also writes its D-log event — the
                     closing record), or `closed (waived: <date>)` on the user's EXPLICIT
                     order to skip the audit (arcane's Iron rules: cost named, D-logged event;
                     the shape every reader sees — the audit did NOT run; never re-demanded,
                     never read as audited); the merge-born `unresolved (between: <side X>
                     ||| <side Y>; merged <date>)` shape (Rules) is IN the enum — a
                     standing user ask, treated as NOT closed, the audit route barred on
                     it, never a self-consistency abort; a BARE `closed` is the pre-0.4.16
                     migration shape — the once-only backfill ask: its honest shapes, dating,
                     attestation and decline records, and merge cells live in
                     `references/arbitration.md` — never route past a bare `closed` that has
                     neither been asked nor carries its declined-backfill D-line
## Decision log    — D-01… one line per program-level decision + why, each line DATED;
                     also holds sanctioned EVENT records — the full kind VOCABULARY
                     lives in references/arbitration.md (the single normative home;
                     this schema does not duplicate it) — the list is order-free: it
                     serves the collapse rules and records-by-kind arbitration, and
                     the renumber tie-break is date then line text, NEVER kind-ranked
                     — records, not clutter; D-ids are per-file ordinals, never referenced
                     across machines (consumers match by content: kind + phase ids + date)

# ROADMAP.md
## Phases          — table: id | phase | milestone | status | links
                     status: pending → specced → planned → executing → verified → done
                     every flip past `pending` writes its EVIDENCE STAMP onto the row:
                       specced (spec: <approved-spec path>) · planned (premortem: PASS|WARN <date>)
                       executing (ledger: <path>) · verified (converged: rounds N..M)
                       — or verified (waived: <date>) when the user explicitly waived the
                       rounds (economics' review-floor rule; ledger holds the waiver line).
                       PATH CHARSET (write-time gate): a referent path written into a stamp
                       or the links cell must contain no `)`, `|`, backtick, or newline —
                       `)` makes the stamp's closing paren ambiguous (the reader truncates
                       the path, finds it absent, and runs the WRONG repair arm), `|`
                       breaks the row's pipe-cell parse entirely; the writer RENAMES the
                       offending file first (a sanctioned rename, recorded like any other)
                       — never writes an undecodable stamp. The family's spec/plan naming
                       convention (`docs/specs/YYYY-MM-DD-<kebab>.md`) never produces such
                       paths; the gate exists for hand-named files.
                       LINEAGE TOKEN: `rounds N..M` (converged) or `waived <date>` (waived; with the same-day time when one was appended) — the token STRING for a waived lineage is always the word `waived` plus the date (+time), everywhere it is written or compared: extraction from the stamp `verified (waived: <date>)` prepends the word; extraction from the ledger line `verification: waived by user <date> — <scope>` takes `waived <date>` and drops the scope; token EQUALITY (the voiding signature) compares these normalized strings, never raw stamp fragments —
                       every acceptance-side stamp carries its phase's token; tokens are
                       UNIQUE AND MONOTONIC within a phase (verification.md's invariant:
                       round numbers continue, never restart; a same-day extend waiver
                       appends the time) — token equality across generations is reserved
                       as the voiding signature; stamp dates (accepted/reopened) follow the FAMILY-WIDE
                       same-day arm (arbitration.md's rule); stamps
                       written by pre-0.4.15 versions never promised any of this:
                       generation order is established by the stamps' own dates — a
                       token order that the date order CONTRADICTS, or dates still
                       equal/absent after the time-append arm, is unconfirmed
                       monotonicity and disqualifies the mechanical direction cells →
                       the user; token EQUALITY resolves conservatively (reopened wins)
                       and its pedigree is read off the pair's own dates: the demotion
                       dated on/after the acceptance = consistent — assert the voiding
                       flat; dates inconsistent or missing = present it as PRESUMED
                       voiding, the coincidental-restart possibility named; a waiver covers the code state it was
                       recorded at, and a LATER genuine convergence supersedes it: the
                       stamp upgrades to verified (converged: rounds N..M)
                       done (accepted: <date>, <lineage token>, head: <sha>) — the rounds
                       acceptance saw, or `waived <date>` on a waived lineage (never a bare
                       done — see the migration shape in Rules); `head:` = the phase branch
                       head acceptance was given ON (`git rev-parse --short=12`) — it pins
                       WHAT was accepted: branch-finish compares it against the branch's
                       CURRENT tip before executing (tip moved past the accepted head →
                       the acceptance covers a prefix — surface, never integrate the
                       unaccepted suffix silently), and post-squash recovery keys on it
                       BY CHANGE-SET, not by whole tree: compare the candidate squash
                       commit's first-parent patch against the patch of
                       `merge-base(base, head)..head` (patch-id equality) — whole-tree
                       equality holds only when base never advanced past the fork (the
                       squash result carries base's own later commits, including the
                       `done` flip itself, so honest trees differ); ancestry REWRITTEN
                       under the pin (branch amended/rebased after acceptance: the
                       accepted head neither equals the tip nor is its ancestor) →
                       surface to the user, never integrate silently — the acceptance
                       covers history that no longer exists; a DELETED/unreachable
                       branch is not a dead end: `head:` is an OID — branch-finish
                       integrates/verifies by the OID directly while reachable; an
                       UNREACHABLE OID (post-squash prune, object gc'd) has NO
                       mechanical path — the change-set recovery is uncomputable on it
                       (`merge-base(base, head)` and the `..head` patch both need the
                       object, and no fetch returns an unreachable one): surface to
                       the user with the corroborating candidates named (squash
                       commits touching the phase's files near the acceptance date,
                       the plan/spec's stated scope) — the user attests the
                       integrating commit, or the row records `branch: unknown
                       (user <date>)` — never an improvised patch comparison; a legacy stamp with a token but NO `head:`
                       backfills it from the branch tip when the branch is still reachable
                       and reconciliation finds exactly one candidate — otherwise it stays
                       legacy and branch-finish proceeds by the executed-integration
                       verification arm (git evidence, else the user) — never by a tip
                       that does not exist;
                       branch-finish APPENDS `, branch: merged <sha>|pr <ref>|kept|discarded` (`<sha>` = git's full-uniqueness abbreviation, `git rev-parse --short=12`; ANY stored abbreviation that has become ambiguous as the object database grew — a legacy 7-char stamp, or a 12-char one after enough fetches — is the same RECOVERY case — for `branch:` artifacts resolve among the candidates by which is a merge commit touching the phase's files (a `head:` pin is typically NOT a merge commit — an ambiguous `head:` abbreviation goes straight to the user, never through the merge-commit criterion, which could pick a wrong candidate that happens to merge the phase's files), still ambiguous → the user — never read as non-ancestry).
                       AFTER the choice actually executes, recording its artifact (the merge
                       commit, the PR ref) — the append asserts an executed fact, never an
                       intent; a `done` stamp without its `branch:` part means the choice is
                       owed (or already executed and unrecorded — reconciliation verifies
                       against git before re-asking); a bare `done (accepted: <date>)` with
                       NO lineage token at all is the pre-0.4.10 MIGRATION shape — the
                       backfill ask, never the choice window
                       verified (converged: reopened <date>; was rounds N..M) — the DEMOTED
                       shape (waived lineage: verified (waived: reopened <date>; was waived
                       <date>)): an acceptance voided by a re-gate red or a post-done spec
                       amendment, convergence re-opened; a demoted `done` row EXTENDS the
                       was-clause with its executed parts — `…; was rounds N..M, done <date>,
                       head: <sha>, branch: merged <sha>` — ALL of them: the `head:` pin
                       rides into the was-clause too (the executed-and-unrecorded arm and
                       post-squash recovery key on the accepted head — a demotion grammar
                       that dropped it would destroy the one field its own reader names as
                       the recovery key), the integration record never erases — INCLUDING
                       through re-verification: the post-fix rewrite replaces ONLY the
                       `converged:`/`reopened` clause with the refreshed lineage token,
                       the was-clause's executed parts stay in the stamp verbatim
                       (`verified (converged: rounds N..M'; was rounds N..M, done <date>,
                       head: <sha>, branch: merged <sha>)`) until a NEW `done` stamp with
                       its own `head:` — and branch-finish re-executed for it —
                       supersedes them (without this the doc's own lifecycle erased the
                       record its quantifier promised to keep, and two writers minted
                       two stamp variants the merge cells then had to arbitrate);
                       committed at the void so every machine sees it; routed as resume-the-rounds (on the machine
                       with the phase branch; elsewhere the unrecoverable-progress rule) — or,
                       when the spec carries the pending marker or the D-log names the
                       amendment, as arcane's amendment wave (no machine requirement on an
                       integrated phase; a missing `branch:` part is verified against git
                       FIRST — the executed-and-unrecorded arm, incl. its squash/shallow
                       ancestry caveats — before any machine requirement is concluded) —
                       never as a normal verified row
                     the stamp is written by the session that produced the evidence and travels
                     with the row's commit — any machine can evaluate a stamped row without
                     reaching the (machine-local) ledger; the `done` stamp IS the acceptance artifact
                     links: spec, plan, ledger paths, handoffs — as they appear
## Parked          — phases deferred by an explicit user decision: the whole row MOVES here,
                     keeping its last status + stamp, plus the park record in the EXACT shape `parked (<ISO date>; <reason>; was: <full prior status stamp>)` — reader: date to the first `;`, reason to the second, prior stamp everything after `was: ` up to the record's FINAL closing paren — matched ONCE FROM THE END, never at the first `)` encountered (the prior stamp itself legitimately contains `;` and `)` in demoted and record-carrying forms; only the REASON is charset-gated, the stamp is never reworded); the reason is WRITE-GATED like the `|||` sides: containing `;` or `)` it cannot be durabilized decodably — reword it, never mint an ambiguous shape (two machines' "differing park reasons/dates" arbitration needs mechanically extractable fields); parking and
                     un-parking are scope decisions (Decision log). Parked rows are never
                     routed and don't count toward a milestone's "all phases done";
                     un-parking returns the row to ## Phases with its preserved status,
                     re-validated by backward reconciliation PLUS a referent check — the
                     stamp's referents must still exist (an `executing` row's ledger link,
                     a `verified` row's phase branch): a vanished branch/worktree/ledger is
                     surfaced to the user (re-run from the spec/plan, or park back), never
                     routed as-is. Un-parking into a milestone that meanwhile CLOSED (or a
                     campaign gone `complete`) re-opens it — `status: open` again (and
                     `complete` reverts to `active`), Decision-logged with the user: the
                     closure was audited without this phase, so it no longer holds
```

