---
name: envoy
description: Use only inside the catalyst:envoy-runner subagent and the envoy slash-commands (catalyst:envoy-review, catalyst:envoy-rescue and the rest) - the helper contract for calling the envoy companion runtime (vendor-neutral job/state/background layer; registered vendors: codex (default), grok, kimi). Result presentation rules - references/result-handling.md.
user-invocable: false
---
# Envoy Runtime

Use this skill only inside the `catalyst:envoy-runner` subagent.

Setup gate: `task`, `review`, `adversarial-review`, and `transfer` refuse to run until `/catalyst:envoy-setup` has passed successfully at least once for the workspace (the outcome is persisted in the companion state; a later failed re-check does not revoke it). If the companion reports "Envoy setup has not passed", run `/catalyst:envoy-setup` and return its output — do not retry the task blindly.

Vendor model: the companion's job/state/background machinery is vendor-neutral; concrete harnesses live in the `vendors/` directory of the companion library (registry: `vendors/index.mjs`). Vendor facts are established only by mechanical metadata — a probe command's exit code in setup, the session id parsed from the vendor's structured output — never by narrative text from any model. `--vendor <codex|grok|kimi>` selects one (default: `codex`). Per-vendor knobs: codex takes `--effort none|minimal|low|medium|high|xhigh` and maps model alias `spark`; grok takes `--effort low|medium|high|xhigh` (alias `max` maps to `xhigh`); kimi takes no `--effort` (requests with it fail fast), and kimi runs are always write-capable — kimi-code prompt mode auto-approves tool actions and rejects approval flags, so a read-only kimi request is rejected up front (re-run with `--write` or pick codex/grok for read-only work). Session resume is vendor-isolated: `--resume-last` only continues sessions of the same vendor.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/skills/envoy/scripts/envoy-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Foreground `task` Bash calls must set the Bash tool `timeout` parameter to `3600000` ms — the harness clamps it to its `BASH_MAX_TIMEOUT_MS` ceiling (stock ceiling: 10 minutes; raise it in settings `env` for longer foreground runs). A harness-killed foreground call terminates the vendor process mid-run; anything that may outlast the ceiling belongs in `--background`.
- Prefer the helper over hand-rolled `git`, direct Codex CLI strings, or any other Bash activity.
- Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel` from `catalyst:envoy-runner`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- You may read `references/gpt-5-4-prompting.md` (and the recipe files it links) to rewrite the user's request into a tighter Codex prompt before the single `task` call.
- That prompt drafting is the only Claude-side work allowed. Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.
- Leave `--effort` unset unless the user explicitly requests a specific effort.
- Leave model unset by default. Add `--model` only when the user explicitly asks for one.
- Map `spark` to `--model gpt-5.3-codex-spark`.
- Default to a write-capable Codex run by adding `--write` unless the user explicitly asks for read-only behavior or only wants review, diagnosis, or research without edits.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control only. Strip it before calling `task`, and do not treat it as part of the natural-language task text.
- If the forwarded request includes `--model`, normalize `spark` to `gpt-5.3-codex-spark` and pass it through to `task`.
- If the forwarded request includes `--effort`, pass it through to `task`.
- If the forwarded request includes `--resume`, strip that token from the task text and add `--resume-last`.
- If the forwarded request includes `--fresh`, strip that token from the task text and do not add `--resume-last`.
- `--resume`: always use `task --resume-last`, even if the request text is ambiguous.
- `--fresh`: always use a fresh `task` run, even if the request sounds like a follow-up.
- `--effort`: accepted values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- `--vendor`: pass through to `task` only when the user explicitly names a vendor (asks for Grok/Kimi or passes the flag); the registry validates it (unknown vendors are rejected with the supported list). Leave unset for Codex.
- `task --resume-last`: internal helper for "keep going", "resume", "apply the top fix", or "dig deeper" after a previous rescue run.

Safety rules:
- Default to write-capable Codex work in `catalyst:envoy-runner` unless the user explicitly asks for read-only behavior.
- Preserve the user's task text as-is apart from stripping routing flags.
- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or Codex cannot be invoked, return nothing.
