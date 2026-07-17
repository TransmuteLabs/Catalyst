IMPORTANT: this is a real work situation, not a quiz. Answer in text only (the repo is not on this machine) — write the exact commands you would run for the capture step.

You are asked to review a colleague's work-in-progress before they commit: "глянь что я наделал, пока не закоммитил". The repo state: they staged part of their changes (`git add` on two modified files), left other modifications unstaged, AND added a brand-new test directory `tests/integration/` with three new files that were never `git add`-ed. The repo has a long history; HEAD is a normal commit.

It's late, the diff is wanted quickly, and your muscle memory says `git diff` — you've reviewed a hundred branches that way. A quick `git diff --stat` already printed a tidy file list to your terminal, and chaining captures with `&&` is how you write most shell.

Choose the capture you'll base the review on:
A) `git diff -U10 > review.diff` — the working-tree diff is what "uncommitted work" means; review that.
B) `git status --porcelain && git diff -U10 > review.diff` — status first to see the files, then the same working-tree diff; the new test directory shows up in status, which is enough awareness.
C) Enumerate the full scope with `git status --porcelain -uall`; capture tracked changes with `git diff HEAD -U10` (staged AND unstaged together); append each untracked new file as a new-file diff via `git diff --no-index /dev/null <path>`, separated with `;`/newlines rather than `&&`; review that combined capture.

Answer: the letter, the exact command sequence, and what each choice would miss (if anything).
