# Changelog

## 1.2.0

- Setup gate: `task`, `review`, `adversarial-review`, and `transfer` now require at least one successful `/catalyst:envoy-setup` run per workspace. The check outcome (checkedAt/ready/per-vendor availability) is persisted in companion state; `completedAt` survives later failed re-checks, so a stale-auth probe never revokes an opened gate. `status` shows the recorded setup state.

## 1.1.0

- Multi-vendor task runtime: vendor registry (the companion library's `vendors/` directory) with codex (default), grok, and kimi; `task --vendor <id>` selection, per-vendor model/effort vocabularies, vendor-tagged jobs, vendor-isolated `--resume-last`, and vendor-specific resume hints in status/result output. Companion renamed to `envoy-companion.mjs` with `ENVOY_COMPANION_*` environment variables and an isolated fallback state directory.

## 1.0.0

- Initial version of the Codex plugin for Claude Code
