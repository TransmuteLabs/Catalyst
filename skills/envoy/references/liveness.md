---
read-on:
  - a background vendor task has been running long and it is unclear whether it is still working
  - deciding whether to cancel/restart a vendor run or keep waiting
home-of:
  - the log-mtime liveness signal (hang vs still-thinking)
  - early session-id capture for deterministic resume
---
# Vendor liveness — telling a hang from long thinking

Absorbed from a field-proven codex-driver (journal 0.8.6). A long background vendor run has two indistinguishable-looking states from the outside: still reasoning, or hung. `status` shows `running` for both. Two mechanics tell them apart and make recovery deterministic.

## The signal is log mtime, not final output

A vendor's reasoning/progress stream keeps writing to its job log while it works. So **freshness of the log file's mtime is the liveness signal — not the presence of a final result.** A run whose log mtime advanced within the last handful of seconds is alive (thinking, tool-calling, streaming); a run whose log mtime has been frozen for a long stretch (on the order of several minutes) while the process is still alive is a TRUE hang, not slow thinking. Judging liveness by "no final answer yet" is wrong — a correct long run has no final answer for many minutes; judging by mtime distinguishes the two.

This is why the companion streams vendor progress to the job log rather than swallowing it: the log is both the transcript and the heartbeat. Suppressing that stream to keep output clean removes the only hang signal — for an unattended long run, keep it flowing to the log.

## Capture the session id early, for deterministic resume

The moment a vendor emits its session id (grep it from the first lines of the log / structured output), record it against the job. Recovery from a hang is then deterministic: cancel the stuck process, then resume THAT exact session by id.

Do not recover a hung run with a "resume the latest" shortcut when other vendor runs may be in flight on the machine — "latest" is cwd/time-filtered and races parallel runs, so it can resume the wrong session. The explicit session id captured up front is race-proof; the family's resume is already vendor-isolated (`--resume-last` only continues sessions of the same vendor), and the id makes it run-isolated too.
