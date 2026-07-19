# Changelog

## 1.1.0

- Multi-vendor task runtime: vendor registry (the companion library's `vendors/` directory) with codex (default), grok, and kimi; `task --vendor <id>` selection, per-vendor model/effort vocabularies, vendor-tagged jobs, vendor-isolated `--resume-last`, and vendor-specific resume hints in status/result output. Companion renamed to `envoy-companion.mjs` with `ENVOY_COMPANION_*` environment variables and an isolated fallback state directory.

## 1.0.0

- Initial version of the Codex plugin for Claude Code
