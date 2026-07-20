---
description: Check whether the local Codex CLI is ready (plus grok/kimi vendor availability) and optionally toggle the stop-time review gate; a successful run is recorded per workspace and unlocks task/review/transfer
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/envoy/scripts/envoy-companion.mjs" setup --json $ARGUMENTS
```

If the result says Codex is unavailable and npm is available:
- Use `AskUserQuestion` exactly once to ask whether Claude should install Codex now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Codex (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
npm install -g @openai/codex
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/envoy/scripts/envoy-companion.mjs" setup --json $ARGUMENTS
```

If Codex is already installed or npm is unavailable:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- Append one note after the report: foreground vendor runs are killed by the harness at its `BASH_MAX_TIMEOUT_MS` ceiling (stock: 10 minutes); for longer foreground runs raise it in settings `env` (e.g. `"BASH_MAX_TIMEOUT_MS": "3600000"`), or use `--background`.
- If installation was skipped, present the original setup output.
- If Codex is installed but not authenticated, preserve the guidance to run `!codex login`.
