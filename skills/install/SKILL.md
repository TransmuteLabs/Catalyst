---
name: install
description: Use when setting up or repairing the Catalyst/ContinuousClaude toolchain - a fresh machine, missing binaries, binary-dependent features degrading, or "install/update the toolchain". Also the doctor - run it to diagnose which tools actually respond.
---

# Install — toolchain setup and doctor

## Overview

Installs or repairs the full stack the family builds on: the ContinuousClaude binary layer, the knowledge/analysis tools, and the Catalyst plugin itself. Dispatcher discipline applies: detection and installs run through executors on exact briefs; you present ONE batched plan and the user approves it once. The same skill doubles as a doctor — the detection sweep alone tells which tools respond and which degraded.

## Component table

Detection means the tool **responds with its own signature** — a name on PATH proves nothing (`tldr` is famously also the tldr-pages client; `cc` used to collide with the system C compiler).

| Component | Detect (must respond) | Install | Notes |
|---|---|---|---|
| Catalyst plugin | `claude plugin list` shows `catalyst@catalyst` enabled + its version — the INSTALLED instance (`claude plugin details` answers from the marketplace CATALOG, which can be newer than what sessions actually load — a stale install still looks current there) | `claude plugin marketplace add TransmuteLabs/Catalyst` → `claude plugin install catalyst@catalyst` | if you are reading this, it is likely present |
| ContinuousClaude binary layer (5 binaries, hooks, settings) | `ContinuousClaude --version` output starts `ContinuousClaude <semver>` | *nix: `curl -fsSL https://raw.githubusercontent.com/TransmuteLabs/ContinuousClaude-releases/main/install.sh \| sh` · Windows: `irm https://raw.githubusercontent.com/TransmuteLabs/ContinuousClaude-releases/main/install.ps1 \| iex` | downloads `cc-setup` from the public releases repo (source repo is private); flags pass through (`sh -s -- --add-path --autostart`); cc-setup also installs this plugin |
| bloks (knowledge cards) | `bloks --version` | prebuilt `bloks-<triple>` from [bloks-releases](https://github.com/TransmuteLabs/bloks-releases) Releases → `~/.local/bin/bloks`; or `cc-setup install --with-tools` | `--with-tools` downloads the same prebuilt binaries — no git/cargo access needed |
| tldr (code analysis) | `tldr --version` identifies TransmuteLabs tldr, not tldr-pages | prebuilt `tldr-<triple>` from [tldr-code-releases](https://github.com/TransmuteLabs/tldr-code-releases) Releases → `~/.local/bin/tldr`; or `cc-setup install --with-tools` | PATH collision with tldr-pages is common — signature check is mandatory |
| fastedit (part of the family) | `fastedit --help` responds with fastedit's own usage | prebuilt `fastedit-<triple>`, `fastedit-mcp-<triple>`, `fastedit-hook-<triple>` from [fastedit-rs-releases](https://github.com/TransmuteLabs/fastedit-rs-releases) Releases → `~/.local/bin/`; or `cc-setup install --with-tools` | source repo is private; MCP wiring: `claude mcp add fastedit fastedit-mcp` (see the releases README) |
| ouros CLI (optional) | `ouros --help` | `cargo install ouros` | NOT required when the binary layer is installed — `cc-research` embeds ouros natively |

## Procedure

1. **Detection sweep** — an executor runs every Detect command and returns verbatim outputs + versions. No installs yet.
2. **Plan** — a table of missing/broken components with the exact commands from the table above, plus everything that changes the system named explicitly (PATH edits via `--add-path`, daemon autostart via `--autostart`). Present to the user as ONE batched question; the user picks components and flags once.
3. **Execute** — an executor runs the approved commands one component at a time. After each: the Detect command again — the component is DONE only when it responds with the right signature. Exit code 0 of an installer is not success; a responding tool is.
4. **Report** — final table: component / version / status; skipped components listed with their consequence (which features degrade — the family degrades gracefully, nothing breaks).

A failed install gets one honest retry of the same command; then report the raw output and stop — do not improvise alternative install paths that are not in the table.

## Skill discovery mechanics (for manual/standalone installs)

Verified facts about how harnesses discover skills OUTSIDE plugin delivery (absorbed from a field-tested sync toolchain, journal 0.8.3): Claude Code loads only `~/.claude/skills/<name>/SKILL.md` — exactly one level deep; a per-entry symlink is followed, but a category subfolder is NOT scanned, so nested layouts silently drop skills. Codex scans nested directories, so it accepts whole-root links. When wiring skills by symlink, one flat link per skill for Claude Code, and check name collisions explicitly — the last writer silently wins otherwise.

## Update mode

Same procedure, update commands instead: `cc-setup update --with-tools` (binaries + .claude + refreshes bloks/tldr/fastedit from their releases). The plugin updates in TWO steps — installed plugins are version-pinned copies: `claude plugin marketplace update catalyst` refreshes only the catalog clone (it exits 0 while sessions keep loading the old pinned skills), then `claude plugin update catalyst@catalyst` moves the installed copy (restart required); verify with `claude plugin list` showing the new version — the marketplace step alone never changes what `plugin list` reports. Without the CC layer: re-download prebuilt binaries from the latest `*-releases` Release.

## Red Flags — STOP

- A component marked installed because its name is on PATH — without the signature response.
- An installer's exit 0 treated as success while the tool itself was never re-run.
- Installs started before the single batched consent, or PATH/autostart changed without being named in the plan.
- An improvised install path (brew formula, random script, source build) not in the table — if the table's command fails, that's a report, not an invitation.
- The detection sweep skipped because "it's a fresh machine, nothing can be there".
