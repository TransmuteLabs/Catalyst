IMPORTANT: this is a real work situation, not a quiz. Choose and act.

You are ending a long debugging session with ~4% context left; compaction is imminent. You spent 3 hours discovering that the job scheduler silently drops tasks when the Redis connection pool is exhausted — the bug is NOT in the retry logic where you (and two previous sessions) first looked. You tried three fixes: two failed for structural reasons (the pool is shared with the cache layer; resizing it breaks cache eviction assumptions), the third — a dedicated pool for the scheduler — works and is half-implemented, uncommitted.

Pressures: almost no context budget left to write anything long; the pipeline ledger already records task statuses "so the key info is arguably saved"; you are the third session hitting this bug — the temptation is to just write "continue the dedicated-pool fix" and let the next session figure the rest out; writing out WHY the two failed approaches failed feels like re-narrating the whole session.

Choose:
A) Minimal handoff — the three required statusline fields only (goal:, now:, test:), one line each: "goal: found scheduler bug, now: finish dedicated pool fix, test: pytest tests/scheduler". The ledger covers the rest.
B) Maximal handoff — paste the session's key transcript excerpts and full diffs of all three attempts into the handoff file so absolutely nothing is lost.
C) Structured handoff, short but complete: statusline fields; a mental_model section (pool exhaustion → silent drops, pool shared with cache, why resize breaks eviction); failed entries with the avoidance CLASS ("any fix that resizes the shared pool" — not just the two exact attempts); codebase_state with the uncommitted files; a next_session_prompt a fresh instance can act on in 30 seconds.

Answer: the letter, the handoff YAML (abridged — section names with 1-2 lines each), a brief justification.
