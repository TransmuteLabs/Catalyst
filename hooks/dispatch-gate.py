#!/usr/bin/env python3
"""Catalyst dispatch gate — PreToolUse hook (spec: docs/specs/2026-07-27-dispatch-gate-spec.md).

One routing table, two consumers: this gate verifies every Task/Agent dispatch
and every envoy/proxy Bash call at execution time; hooks/session-start injects
a compact slice of the SAME table (``--render-slice``) so the choice is right
before the dispatch is assembled.

Contract (runtime-independent — a Rust replacement must preserve it):
  input   : hook JSON on stdin: {"tool_name": ..., "tool_input": {...}, "cwd": ...}
  allow   : exit 0, no output
  deny    : exit 0, one JSON object on stdout —
            Claude Code: {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                          "permissionDecision": "deny",
                          "permissionDecisionReason": "..."}}
            Cursor:      {"permission": "deny", "userMessage": ..., "agentMessage": ...}
            otherwise:   {"decision": "deny", "reason": "..."}
  table   : hooks/routing-table.toml (base, ships with the plugin) overlaid by
            ~/.claude/catalyst/routing-override.toml. An override's
            second-level table (e.g. [bans.minimax], [roles.critic]) replaces
            the base entry WHOLESALE. Missing/invalid table or an unknown
            schema_version anywhere → fail-closed (dispatches and gated Bash
            channels are denied with the file and the breakage named).
  writes  : none, ever. The gate reads the table and agent frontmatter only.

Effective model resolution: tool_input.model → agent frontmatter ``model:`` →
unset ("inherit"/"default" count as unset) → deny. Inheriting the parent model
silently is the defect class this gate closes.

The channel identification constants below are contract constants mirrored in
routing-table.toml's header comment: the Bash early-exit must work even when
the table is unreadable — a broken table blocks dispatches and gated channels,
never unrelated Bash commands.

Env knobs (used by tests/scripts/test-dispatch-gate.sh):
  CATALYST_ROUTING_TABLE     base table path (default: alongside this script)
  CATALYST_ROUTING_OVERRIDE  override path (default: ~/.claude/catalyst/routing-override.toml)
  CATALYST_AGENT_DIRS        os.pathsep-separated agent dirs (replaces defaults)
"""
import glob
import json
import os
import re
import sys

try:
    import tomllib
except ImportError:  # Python < 3.11 — fail-closed with the cause named
    tomllib = None

SCHEMA_SUPPORTED = (1,)

# Channel identification — contract constants (see module docstring).
ENVOY_MARK = "envoy-companion.mjs"
PROXY_MARK = "8317/v1/chat/completions"
PROXY_CRITIQUE_MARK = "proxy-critique"

EFFORT_WORDS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
UNSET_MODELS = ("", "inherit", "default")
CLASS_MARKER_RE = re.compile(r"\[dispatch-class:\s*([0-9A-Za-z_-]+)\s*\]")
ENVOY_TASK_RE = re.compile(r"envoy-companion\.mjs[\"']?\s+task\b")
ENVOY_VENDOR_RE = re.compile(r"--vendor[=\s]+[\"']?([A-Za-z0-9_-]+)")
ENVOY_EFFORT_RE = re.compile(r"--effort[=\s]+[\"']?(%s)\b" % "|".join(EFFORT_WORDS))
PROXY_CRITIQUE_RE = re.compile(
    r"proxy-critique(?:\.sh)?[\"']?\s+[\"']?([A-Za-z0-9._\[\]-]+)[\"']?\s+[\"']?([A-Za-z]+)")
# Inline JSON bodies appear both raw ("model":"x") and with shell-escaped
# quotes (\"model\":\"x\" inside a double-quoted bash payload) — accept both.
PROXY_MODEL_RE = re.compile(r'\\?"model\\?"\s*:\s*\\?"([^"\\]+)')
PROXY_EFFORT_RE = re.compile(r'\\?"reasoning_effort\\?"\s*:\s*\\?"([A-Za-z]+)')


def emit_deny(reason):
    reason = "Dispatch gate: " + reason
    if os.environ.get("CURSOR_PLUGIN_ROOT"):
        out = {"permission": "deny", "userMessage": reason, "agentMessage": reason}
    elif os.environ.get("CLAUDE_PLUGIN_ROOT") and not os.environ.get("COPILOT_CLI"):
        out = {"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }}
    else:
        out = {"decision": "deny", "reason": reason}
    print(json.dumps(out, ensure_ascii=False))
    raise SystemExit(0)


def base_table_path():
    return os.environ.get("CATALYST_ROUTING_TABLE") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "routing-table.toml")


def override_path():
    env = os.environ.get("CATALYST_ROUTING_OVERRIDE")
    if env is not None:
        return env
    return os.path.expanduser(os.path.join("~", ".claude", "catalyst", "routing-override.toml"))


def check_schema(tbl, path, required=True):
    v = tbl.get("schema_version")
    if v is None:
        return f"{path}: schema_version is missing" if required else None
    if v not in SCHEMA_SUPPORTED:
        return (f"{path}: unknown schema_version {v!r} (supported: "
                f"{', '.join(map(str, SCHEMA_SUPPORTED))}) — the plugin and the table "
                f"disagree; update the older side")
    return None


def load_table():
    """Return (table, None) on success or (None, error_text) — never raises."""
    base_p = base_table_path()
    if tomllib is None:
        return None, (f"python tomllib is unavailable (Python >= 3.11 required) — "
                      f"cannot read {base_p}")
    try:
        with open(base_p, "rb") as f:
            base = tomllib.load(f)
    except FileNotFoundError:
        return None, (f"routing table missing: {base_p} — the base table ships with the "
                      f"plugin, so its absence means a broken install (catalyst:install)")
    except (tomllib.TOMLDecodeError, OSError) as e:
        return None, f"routing table unreadable: {base_p}: {e}"
    err = check_schema(base, base_p)
    if err:
        return None, err
    over_p = override_path()
    if over_p and os.path.isfile(over_p):
        try:
            with open(over_p, "rb") as f:
                over = tomllib.load(f)
        except (tomllib.TOMLDecodeError, OSError) as e:
            return None, f"routing override unreadable: {over_p}: {e}"
        err = check_schema(over, over_p, required=False)
        if err:
            return None, err
        for k, v in over.items():
            if k == "schema_version":
                continue
            if isinstance(v, dict) and isinstance(base.get(k), dict):
                merged = dict(base[k])
                merged.update(v)
                base[k] = merged
            else:
                base[k] = v
    return base, None


def section(table, name):
    """A table section as a dict of dicts; malformed shapes → fail-closed."""
    sec = table.get(name)
    if sec is None:
        return {}
    if not isinstance(sec, dict) or any(not isinstance(v, dict) for v in sec.values()):
        emit_deny(f"routing table section [{name}] is malformed (expected tables) — "
                  f"fail-closed until the table is repaired")
    return sec


def agent_dirs(cwd):
    env = os.environ.get("CATALYST_AGENT_DIRS")
    if env is not None:
        return [d for d in env.split(os.pathsep) if d]
    home = os.path.expanduser("~")
    dirs = []
    if cwd:
        dirs.append(os.path.join(cwd, ".claude", "agents"))
    dirs.append(os.path.join(home, ".claude", "agents"))
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if plugin_root:
        dirs.append(os.path.join(plugin_root, "agents"))
    dirs.extend(sorted(glob.glob(
        os.path.join(home, ".claude", "plugins", "cache", "*", "*", "*", "agents"))))
    return dirs


def frontmatter_model(subagent_type, cwd):
    """The ``model:`` field of the agent's definition file, or None.

    First existing <name>.md wins (project > user > plugins — the harness's own
    precedence). A found definition without a model field ends the search:
    that IS the definition, and it declares no model.
    """
    name = subagent_type.rsplit(":", 1)[-1].strip()
    if not name or not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        return None
    for d in agent_dirs(cwd):
        path = os.path.join(d, name + ".md")
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            return None
        if not text.startswith("---\n"):
            return None
        end = text.find("\n---", 4)
        if end == -1:
            return None
        for line in text[4:end].split("\n"):
            if line.startswith("model:"):
                return line.partition(":")[2].strip().strip("\"'")
        return None
    return None


def check_dispatch(tool_input, table, cwd):
    st = str(tool_input.get("subagent_type") or "")
    model = str(tool_input.get("model") or "").strip()
    source = "the call"
    if model.lower() in UNSET_MODELS:
        model = (frontmatter_model(st, cwd) or "").strip()
        source = f"the frontmatter of agent '{st}'"
        if model.lower() in UNSET_MODELS:
            emit_deny(
                f"dispatch of '{st}' carries no effective model: 'model' is set neither "
                f"in the call nor in the agent definition. Add an explicit model to the "
                f"dispatch — silently inheriting the parent model is the defect class "
                f"this gate closes (routing home: hooks/routing-table.toml).")
    eff = model.lower()

    for ban_name, ban in section(table, "bans").items():
        for p in ban.get("patterns") or []:
            if str(p).lower() in eff:
                emit_deny(f"model '{model}' (from {source}) is banned "
                          f"(ban '{ban_name}', pattern '{p}'): {ban.get('reason', '')}")

    stl = st.lower()
    for role_name, role in section(table, "roles").items():
        if not any(str(m).lower() in stl for m in role.get("match") or []):
            continue
        allowed = role.get("allowed")
        if allowed is None:
            continue
        if allowed == []:
            emit_deny(f"role '{role_name}' (subagent_type '{st}') is never delegated to "
                      f"any model: {role.get('reason', '')}")
        if not any(str(a).lower() in eff for a in allowed):
            emit_deny(f"model '{model}' (from {source}) is below the floor for role "
                      f"'{role_name}' (subagent_type '{st}'): allowed {allowed}. "
                      f"{role.get('reason', '')}")

    marker = CLASS_MARKER_RE.search(str(tool_input.get("prompt") or ""))
    if marker:
        cid = marker.group(1)
        classes = section(table, "classes")
        cls = classes.get(cid)
        if cls is None:
            emit_deny(f"declared dispatch class '{cid}' is not in the routing table "
                      f"(known: {', '.join(sorted(classes)) or 'none'}). Fix the marker "
                      f"or the table — a silently ignored typo would be a new silent defect.")
        allowed = cls.get("allowed") or []
        if not any(str(a).lower() in eff for a in allowed):
            emit_deny(f"model '{model}' is outside declared class '{cid}' "
                      f"({cls.get('label', '')}): allowed {allowed}. Escalating after a "
                      f"failure? Remove the class marker or declare the higher class — "
                      f"the classification stays the controller's decision.")


def check_channel_model(model, effort, table):
    """Bans + proxy effort pins for a model/effort pair extracted from a Bash call."""
    eff_model = model.lower()
    for ban_name, ban in section(table, "bans").items():
        for p in ban.get("patterns") or []:
            if str(p).lower() in eff_model:
                emit_deny(f"model '{model}' is banned (ban '{ban_name}', pattern '{p}'): "
                          f"{ban.get('reason', '')}")
    channels = section(table, "channels")
    pins = (channels.get("proxy") or {}).get("pins") or {}
    for pat, allowed in pins.items():
        if str(pat).lower() in eff_model:
            allowed_l = [str(a).lower() for a in allowed]
            if effort not in allowed_l:
                emit_deny(f"proxy effort pin violated: model '{model}' runs at "
                          f"{allowed} on this channel, got '{effort}' "
                          f"(routing home: hooks/routing-table.toml).")


def check_bash(cmd, table):
    channels = section(table, "channels")

    if ENVOY_MARK in cmd and ENVOY_TASK_RE.search(cmd):
        vm = ENVOY_VENDOR_RE.search(cmd)
        vendor = vm.group(1).lower() if vm else "codex"
        vendors = (channels.get("envoy") or {}).get("vendors") or {}
        vcfg = vendors.get(vendor)
        # Unknown vendor: conservative — require an explicit effort.
        required = True if vcfg is None else bool(vcfg.get("effort_required", True))
        if required and not ENVOY_EFFORT_RE.search(cmd):
            emit_deny(f"envoy task via vendor '{vendor}' without an explicit --effort — "
                      f"the vendor's silent default effort is the defect class this gate "
                      f"closes (precedent: R3 rank retract 2026-07-20). Add "
                      f"--effort <level> (routing home: hooks/routing-table.toml).")

    if PROXY_CRITIQUE_MARK in cmd:
        m = PROXY_CRITIQUE_RE.search(cmd)
        if not m or m.group(2).lower() not in EFFORT_WORDS:
            emit_deny("proxy-critique call whose model/effort cannot be read from the "
                      "command — expected form: proxy-critique.sh <model> <effort> "
                      "<brief> <out> <files...> with an explicit effort.")
        check_channel_model(m.group(1), m.group(2).lower(), table)

    if PROXY_MARK in cmd:
        pcfg = channels.get("proxy") or {}
        if bool(pcfg.get("effort_required", True)) and "reasoning_effort" not in cmd:
            emit_deny("proxy chat/completions call without a visible reasoning_effort — "
                      "effort must be explicit on this channel. Inline the request body "
                      "(\"reasoning_effort\": \"...\") or use the proxy-critique wrapper.")
        mm = PROXY_MODEL_RE.search(cmd)
        em = PROXY_EFFORT_RE.search(cmd)
        if mm and em:
            check_channel_model(mm.group(1), em.group(1).lower(), table)


def render_slice():
    """A compact rules slice for SessionStart — rendered from the SAME table
    the gate reads (truth 7: no second, separately maintained copy)."""
    table, err = load_table()
    if err:
        print(f"!! DISPATCH ROUTING TABLE BROKEN — {err}\n"
              f"!! The dispatch gate is fail-closed: Task/Agent dispatches and "
              f"envoy/proxy calls will be DENIED until this is fixed.")
        return
    lines = [
        "<DISPATCH-ROUTING>",
        "Маршрутизация диспатчей (hooks/routing-table.toml — PreToolUse-гейт проверяет "
        "эту же таблицу; нарушение = отказ):",
        "- Каждый Task/Agent-диспатч: model ЯВНО в вызове (или в определении агента); "
        "ни там, ни там = отказ.",
    ]
    bans = table.get("bans") or {}
    if bans:
        pats = sorted({str(p) for b in bans.values() for p in (b.get("patterns") or [])})
        lines.append("- Запрещены везде: " + ", ".join(pats) + ".")
    for name, role in (table.get("roles") or {}).items():
        match = "|".join(str(m) for m in role.get("match") or [])
        allowed = role.get("allowed")
        target = "|".join(str(a) for a in allowed) if allowed else "НЕ делегируется"
        lines.append(f"- Роль {match} → {target}.")
    classes = table.get("classes") or {}
    if classes:
        parts = [f"{cid} → {'|'.join(str(a) for a in (c.get('allowed') or []))}"
                 for cid, c in classes.items()]
        lines.append("- Классы исполнения (опц. маркер [dispatch-class:<id>] в промпте): "
                     + "; ".join(parts) + ".")
    vendors = ((table.get("channels") or {}).get("envoy") or {}).get("vendors") or {}
    if vendors:
        req = [v for v, c in vendors.items() if c.get("effort_required", True)]
        noreq = [v for v, c in vendors.items() if not c.get("effort_required", True)]
        line = "- envoy task: --effort обязателен для " + ", ".join(sorted(req))
        if noreq:
            line += "; без --effort: " + ", ".join(sorted(noreq))
        lines.append(line + ".")
    proxy = (table.get("channels") or {}).get("proxy") or {}
    if proxy.get("effort_required", True):
        line = ("- прокси-POST (127.0.0.1:8317): reasoning_effort обязан быть виден "
                "в команде")
        pins = proxy.get("pins") or {}
        if pins:
            line += ("; пины: " + ", ".join(
                f"{m}→{'|'.join(str(a) for a in al)}" for m, al in pins.items()))
        lines.append(line + ".")
    lines.append("- Оверрайд: ~/.claude/catalyst/routing-override.toml "
                 "(запись второго уровня перекрывает базовую целиком).")
    lines.append("</DISPATCH-ROUTING>")
    print("\n".join(lines))


def main(argv):
    if "--render-slice" in argv:
        render_slice()
        return
    try:
        data = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001 — protocol break must be loud
        emit_deny(f"hook input is not valid JSON ({e}) — refusing rather than passing "
                  f"unseen dispatches (fail-closed).")
    if not isinstance(data, dict):
        emit_deny("hook input is not a JSON object — refusing (fail-closed).")
    tool = str(data.get("tool_name") or data.get("tool") or "")
    tool_input = data.get("tool_input")
    if not isinstance(tool_input, dict):
        tool_input = {}
    cwd = str(data.get("cwd") or "") or os.getcwd()

    if tool == "Bash":
        cmd = str(tool_input.get("command") or "")
        # Early exit for everything that is not a gated channel — BEFORE any
        # table read (truth 5): a broken table never blocks unrelated Bash.
        if (ENVOY_MARK not in cmd and PROXY_MARK not in cmd
                and PROXY_CRITIQUE_MARK not in cmd):
            return
        table, err = load_table()
        if err:
            emit_deny(err + " — fail-closed: gated Bash channels are blocked until "
                            "the table is repaired.")
        check_bash(cmd, table)
    elif tool in ("Task", "Agent"):
        table, err = load_table()
        if err:
            emit_deny(err + " — fail-closed: dispatches are blocked until the table "
                            "is repaired.")
        check_dispatch(tool_input, table, cwd)
    # Any other tool: allow silently.


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — an internal error must not become a silent pass
        emit_deny(f"internal gate error ({e.__class__.__name__}: {e}) — fail-closed.")
