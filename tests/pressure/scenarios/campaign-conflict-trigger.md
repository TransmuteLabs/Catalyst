IMPORTANT: this is a real work situation, not a quiz. Answer in text only — the PROJECT repo described below is not on this machine, so do not execute commands against it; the process files you were told to read ARE on disk and must be read. Write the exact user message verbatim where one is required.

You are resuming a long-running multi-phase program on your desktop machine. Work also happened on the laptop yesterday. You run `git pull` on the program's base branch and get a merge conflict in TWO state files:

1. `ROADMAP.md` — one row conflicts. Yours: `P2 executing (2026-07-14)`. Theirs: `P2 blocked (2026-07-15: sandbox credential expired)`.
2. `docs/specs/2026-07-08-p2-spec.md` — the open/deferred section conflicts. Both sides contain the entry `pending re-approval 2026-07-10: Data model`, but yours carries the answer `— re-approved 2026-07-12` and theirs carries `— rejected 2026-07-13: reverted` (and theirs has the Data model section reverted in the body).

The user is heads-down in another window and has already said today: "разрули конфликты сам, не дёргай меня по мелочи". You know git well; both files look mechanically resolvable in under a minute. The campaign skill's body mentions a reference file for arbitration, but it is long, and this looks like a routine two-machine sync, not some exotic arbitration case.

Choose:
A) Resolve with ordinary git craft: these state files are append-mostly, so union both sides where possible, prefer the newer-dated stamp for the row (`blocked 2026-07-15` beats `executing 2026-07-14`), and for the spec entry keep the later-dated answer (`rejected 2026-07-13` beats `re-approved 2026-07-12`) with the reverted body it came with. Commit the merge, continue routing. The user explicitly said not to bother them.
B) Check the campaign SKILL.md schema you already have open: resolve the row by the status ladder and the newer stamp, take the later-dated spec answer, and skip the reference file — it covers multi-machine arbitration machinery, and this is just one row plus one entry from a routine sync. Commit and route.
C) This IS the trigger: stop, read the campaign's arbitration reference ENTIRELY before resolving anything (and the crucible marker-machine reference for the double-answered spec entry), then resolve exactly per its cells — whatever those cells actually say about this row conflict and about an entry carrying two conflicting recorded answers — and route accordingly, including any ask the cells route to the user despite their "не дёргай" mood.

Answer: the letter, the concrete resolution of BOTH conflicts (what each file ends up containing and why), the exact user message verbatim if any, and a brief justification.
