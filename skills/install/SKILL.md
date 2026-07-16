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
| Catalyst plugin | `claude plugin details catalyst@catalyst` | `claude plugin marketplace add TransmuteLabs/Catalyst` → `claude plugin install catalyst@catalyst` | if you are reading this, it is likely present |
| ContinuousClaude binary layer (5 binaries, hooks, settings) | `ContinuousClaude --version` output starts `ContinuousClaude <semver>` | *nix: `curl -fsSL https://raw.githubusercontent.com/TransmuteLabs/ContinuousClaude-releases/main/install.sh \| sh` · Windows: `irm https://raw.githubusercontent.com/TransmuteLabs/ContinuousClaude-releases/main/install.ps1 \| iex` | downloads `cc-setup` from the public releases repo (source repo is private); flags pass through (`sh -s -- --add-path --autostart`); cc-setup also installs this plugin |
| bloks (knowledge cards) | `bloks --version` | prebuilt `bloks-<triple>` from [bloks-releases](https://github.com/TransmuteLabs/bloks-releases) Releases → `~/.local/bin/bloks`; or `cc-setup install --with-tools` | source repo is private — `cargo install --git` works only with repo access |
| tldr (code analysis) | `tldr --version` identifies TransmuteLabs tldr, not tldr-pages | prebuilt `tldr-<triple>` from [tldr-code-releases](https://github.com/TransmuteLabs/tldr-code-releases) Releases → `~/.local/bin/tldr`; or `cc-setup install --with-tools` | PATH collision with tldr-pages is common — signature check is mandatory |
| fastedit (optional) | `fastedit --help` | `pip install "fastedits[mlx]"` on Apple Silicon, `pip install fastedits` otherwise; then `fastedit pull` (~1.7 GB model) | MCP wiring is manual — see its README |
| ouros CLI (optional) | `ouros --help` | `cargo install ouros` | NOT required when the binary layer is installed — `cc-research` embeds ouros natively |

## Procedure

1. **Detection sweep** — an executor runs every Detect command and returns verbatim outputs + versions. No installs yet.
2. **Plan** — a table of missing/broken components with the exact commands from the table above, plus everything that changes the system named explicitly (PATH edits via `--add-path`, daemon autostart via `--autostart`, ~1.7 GB model download). Present to the user as ONE batched question; the user picks components and flags once.
3. **Execute** — an executor runs the approved commands one component at a time. After each: the Detect command again — the component is DONE only when it responds with the right signature. Exit code 0 of an installer is not success; a responding tool is.
4. **Report** — final table: component / version / status; skipped components listed with their consequence (which features degrade — the family degrades gracefully, nothing breaks).

A failed install gets one honest retry of the same command; then report the raw output and stop — do not improvise alternative install paths that are not in the table.

## Update mode

Same procedure, update commands instead: `cc-setup update` (binaries + .claude), `claude plugin marketplace update catalyst` (skills), `cargo install --force --git …` (bloks/tldr), `pip install -U fastedits`.

## Red Flags — STOP

- A component marked installed because its name is on PATH — without the signature response.
- An installer's exit 0 treated as success while the tool itself was never re-run.
- Installs started before the single batched consent, or PATH/autostart changed without being named in the plan.
- An improvised install path (brew formula, random script, source build) not in the table — if the table's command fails, that's a report, not an invitation.
- The detection sweep skipped because "it's a fresh machine, nothing can be there".
