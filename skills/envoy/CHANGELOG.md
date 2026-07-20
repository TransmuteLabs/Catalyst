# Changelog

## 1.4.0

- Kimi adapted to kimi-code >=0.27: prompt mode (`-p`) rejects `--yolo`/`--auto` and implicitly auto-approves tool actions, so write mode passes no approval flag; read-only kimi requests are rejected before the CLI is invoked (new registry field `enforcesReadOnly`, validated at task parse time) instead of silently running write-capable.
- Foreground timeout doctrine: the runner agent, review commands, and SKILL.md now require an explicit Bash-tool `timeout` of 3600000 ms on foreground companion calls (the harness clamps to its `BASH_MAX_TIMEOUT_MS` ceiling), and the setup command surfaces how to raise the stock 10-minute ceiling.

## 1.3.0

- Mechanical readiness probes in setup: each available non-default vendor answers a cheap probe command (`grok models` for auth, `kimi doctor` for config) whose exit code is the fact — setup output shows `auth check passed` / `config check FAILED: <detail>` per vendor, and the probe results persist in the recorded setup state. Doctrine: vendor facts are established only by mechanical metadata, never by narrative model output.

## 1.2.0

- Setup gate: `task`, `review`, `adversarial-review`, and `transfer` now require at least one successful `/catalyst:envoy-setup` run per workspace. The check outcome (checkedAt/ready/per-vendor availability) is persisted in companion state; `completedAt` survives later failed re-checks, so a stale-auth probe never revokes an opened gate. `status` shows the recorded setup state.

## 1.1.0

- Multi-vendor task runtime: vendor registry (the companion library's `vendors/` directory) with codex (default), grok, and kimi; `task --vendor <id>` selection, per-vendor model/effort vocabularies, vendor-tagged jobs, vendor-isolated `--resume-last`, and vendor-specific resume hints in status/result output. Companion renamed to `envoy-companion.mjs` with `ENVOY_COMPANION_*` environment variables and an isolated fallback state directory.

## 1.0.0

- Initial version of the Codex plugin for Claude Code
