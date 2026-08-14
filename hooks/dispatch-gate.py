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
            ~/.claude/catalyst/routing-override.toml and then by the nearest
            <project>/.claude/catalyst/routing-override.toml at or above cwd.
            A layer's second-level table (e.g. [classes.1e]) replaces the base
            entry WHOLESALE; entries it does not name survive. Missing/invalid
            table or an unknown schema_version anywhere → fail-closed
            (dispatches and gated Bash channels are denied with the file and
            the breakage named).
  writes  : none, ever. The gate reads the table and agent frontmatter only.

Effective model resolution: tool_input.model → agent frontmatter ``model:`` →
unset ("inherit"/"default" count as unset) → deny. Inheriting the parent model
silently is the defect class this gate closes. Every dispatch must also declare
its case with a [dispatch-class:<id>] marker: a dispatch belonging to no case is
checked by nothing, which is the same hole one level up.

Gated Bash channels: the envoy companion, the proxy POST, the proxy-critique
wrapper, and a vendor CLI launched DIRECTLY (outside envoy) — same models and
same ledger, so the same effort and admission rules.

The channel identification constants below are contract constants mirrored in
routing-table.toml's header comment: the Bash early-exit must work even when
the table is unreadable — a broken table blocks dispatches and gated channels,
never unrelated Bash commands.

Env knobs (used by tests/scripts/test-dispatch-gate.sh):
  CATALYST_ROUTING_TABLE     base table path (default: alongside this script)
  CATALYST_ROUTING_OVERRIDE  machine override (default: ~/.claude/catalyst/routing-override.toml)
  CATALYST_ROUTING_PROJECT_OVERRIDE  project override (default: found by walking up from cwd)
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
# Vendor CLIs launched directly (outside the envoy companion). This tuple is the
# EARLY-EXIT hint only — it decides whether the table is worth reading, and so
# must live in code like the other channel constants (the early exit has to work
# with an unreadable table). The authoritative per-vendor rules are the table's
# [channels.cli.vendors.*]; a vendor added there must be added here too, which
# tests/scripts/test-dispatch-gate.sh pins.
CLI_BIN_HINTS = ("codex", "grok", "kimi", "glm")

EFFORT_WORDS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
UNSET_MODELS = ("", "inherit", "default")
CLASS_MARKER_RE = re.compile(r"\[dispatch-class:\s*([0-9A-Za-z_-]+)\s*\]", re.I)
ENVOY_TASK_RE = re.compile(r"envoy-companion\.mjs[\"']?\s+task\b")
ENVOY_VENDOR_RE = re.compile(r"--vendor[=\s]+[\"']?([A-Za-z0-9_-]+)")
ENVOY_EFFORT_RE = re.compile(r"--effort[=\s]+[\"']?(%s)\b" % "|".join(EFFORT_WORDS))
PROXY_CRITIQUE_RE = re.compile(
    r"proxy-critique(?:\.sh)?[\"']?\s+[\"']?([A-Za-z0-9._\[\]-]+)[\"']?\s+[\"']?([A-Za-z]+)")
# Inline JSON bodies appear both raw ("model":"x") and with shell-escaped
# quotes (\"model\":\"x\" inside a double-quoted bash payload) — accept both.
PROXY_MODEL_RE = re.compile(r'\\?"model\\?"\s*:\s*\\?"([^"\\]+)')
PROXY_EFFORT_RE = re.compile(r'\\?"reasoning_effort\\?"\s*:\s*\\?"([A-Za-z]+)')


class Violation(Exception):
    """A broken routing rule. What HAPPENS to it is the caller's decision.

    The checks raise; the boundary decides. That split is what lets one rule set
    serve two modes (block the dispatch, or let it run and remind) and lets the
    PostToolUse recorder re-evaluate the same rules without a second copy.
    """

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def emit_deny(reason):
    raise Violation("Dispatch gate: " + reason)


def print_deny(reason):
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


def print_warn(reason):
    """Non-blocking: the dispatch proceeds, the breach is said out loud.

    Never a permissionDecision — an "allow" from a PreToolUse hook would also
    auto-approve the tool call, and a routing reminder must not hand out
    permissions as a side effect. The model-facing copy of this reminder is
    added by the PostToolUse recorder, which has a context channel.
    """
    print(json.dumps({"systemMessage": reason}, ensure_ascii=False))


def base_table_path():
    return os.environ.get("CATALYST_ROUTING_TABLE") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "routing-table.toml")


PROJECT_OVERRIDE_REL = os.path.join(".claude", "catalyst", "routing-override.toml")


def find_project_override(cwd):
    """Nearest .claude/catalyst/routing-override.toml at or above cwd, or None.

    Walked rather than resolved through git so a checkout-less tree and a nested
    directory-scoped config both work; the FIRST (most specific) hit wins.
    """
    d = os.path.abspath(cwd or os.getcwd())
    while True:
        cand = os.path.join(d, PROJECT_OVERRIDE_REL)
        if os.path.isfile(cand):
            return cand
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def override_paths(cwd):
    """Override layers over the base table, LEAST specific first.

    base (ships with the plugin) < ~/.claude/... (machine) < <project>/.claude/...
    Each layer merges: a named entry replaces its base namesake whole, entries it
    does not name survive. So a project config can retune one class without
    restating the table.
    """
    layers = []
    env_home = os.environ.get("CATALYST_ROUTING_OVERRIDE")
    layers.append(env_home if env_home is not None else os.path.expanduser(
        os.path.join("~", ".claude", "catalyst", "routing-override.toml")))
    env_proj = os.environ.get("CATALYST_ROUTING_PROJECT_OVERRIDE")
    if env_proj is not None:
        layers.append(env_proj)
    else:
        found = find_project_override(cwd)
        if found and os.path.abspath(found) not in {os.path.abspath(l) for l in layers}:
            layers.append(found)
    return layers


def check_schema(tbl, path, required=True):
    v = tbl.get("schema_version")
    if v is None:
        return f"{path}: schema_version is missing" if required else None
    if v not in SCHEMA_SUPPORTED:
        return (f"{path}: unknown schema_version {v!r} (supported: "
                f"{', '.join(map(str, SCHEMA_SUPPORTED))}) — the plugin and the table "
                f"disagree; update the older side")
    return None


def load_table(cwd=None):
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
    for over_p in override_paths(cwd):
        if not over_p or not os.path.isfile(over_p):
            continue
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


def known_model_ids(table):
    """Every model named by any [classes.*] entry.

    There is no separate model registry on purpose: a model is listed in the
    classes where it may work, and the permitted set is the union of those. A
    model named nowhere is permitted nowhere. [roles.*] deliberately holds no
    model lists — a second set would drift from this one. An empty union is a
    table defect, not a licence to pass everything.
    """
    ids = set()
    for entry in section(table, "classes").values():
        for a in entry.get("allowed") or []:
            ids.add(str(a).strip().lower())
    if not ids:
        emit_deny("routing table names no models in any [classes.*] entry — "
                  "fail-closed: dispatches stay blocked until the table is "
                  "repaired (routing home: hooks/routing-table.toml).")
    return ids


def declared_class(text):
    """The single class id declared in a prompt/command, or None.

    Case-insensitive (a controller writing [DISPATCH-CLASS:1B] declared a class
    and must not be told it declared none). Two DIFFERENT ids is an ambiguity,
    not a first-wins: silently picking one is the defect class this gate closes.
    """
    found = [m.group(1).strip().lower() for m in CLASS_MARKER_RE.finditer(text or "")]
    if not found:
        return None
    distinct = sorted(set(found))
    if len(distinct) > 1:
        emit_deny(f"the prompt declares more than one dispatch class "
                  f"({', '.join(distinct)}) — one dispatch is one case. Leave the "
                  f"marker of the class this dispatch actually belongs to; quoting "
                  f"another class's marker inside the brief text is what makes this "
                  f"ambiguous.")
    return distinct[0]


HEREDOC_OPEN_RE = re.compile(
    r"<<-?\s*(?:'([A-Za-z_][A-Za-z0-9_]*)'|\"([A-Za-z_][A-Za-z0-9_]*)\"|\\?([A-Za-z_][A-Za-z0-9_]*))"
)


def strip_heredoc_bodies(cmd):
    """Drop here-doc BODIES before shell segmentation.

    Body text is data, not shell: a markdown row ``| kimi | ... |`` or a
    python script fed via ``python3 - <<PY`` would otherwise be split on
    ``|``/newlines and put a vendor name in executable position. An opener
    whose terminator line never appears is left untouched (better to
    over-gate than to silently swallow the rest of a command on a ``<<``
    that was not a heredoc at all).
    """
    lines = cmd.split("\n")
    out, i, n = [], 0, len(lines)
    while i < n:
        line = lines[i]
        out.append(line)
        i += 1
        for m in HEREDOC_OPEN_RE.finditer(line):
            delim = m.group(1) or m.group(2) or m.group(3)
            dash = line[m.start():m.start() + 3] == "<<-"
            j = i
            while j < n:
                term = lines[j].lstrip("\t") if dash else lines[j]
                if term == delim:
                    break
                j += 1
            if j < n:  # terminator found: skip body AND terminator (both are
                i = j + 1  # heredoc syntax, not shell segments)
    return "\n".join(out)


def executables(cmd):
    """The executable word of each shell segment (past VAR=val prefixes)."""
    out = []
    for seg in re.split(r"(?:\|\||&&|[;|&\n])", strip_heredoc_bodies(cmd)):
        for word in seg.split():
            bare = os.path.basename(word.strip("\"'"))
            if word.startswith("-"):
                break
            if "=" in bare:
                continue
            if bare in ("env", "exec", "command", "nohup", "time", "sudo"):
                continue
            out.append(bare.lower())
            break
    return out


def names_cli_hint(cmd):
    """Cheap, table-free: does this command launch a known vendor CLI?"""
    return any(x in CLI_BIN_HINTS for x in executables(cmd))


def cli_vendor(cmd, table):
    """(vendor_name, cfg) when the command DIRECTLY launches a vendor CLI.

    Only the executable position counts: the first bare word of each segment,
    past ``VAR=val`` prefixes and ``env``. So ``grep codex notes.md`` is not a
    codex run, while ``codex exec ...`` is — a substring match would gate the
    former and be worse than no rule.
    """
    vendors = (section(table, "channels").get("cli") or {}).get("vendors") or {}
    if not vendors:
        return None, None
    bins = {}
    for name, cfg in vendors.items():
        for bin_name in (cfg.get("bin") or [name]):
            bins[str(bin_name).lower()] = (name, cfg)
    for exe in executables(cmd):
        hit = bins.get(exe)
        if hit:
            return hit
    return None, None


def hatch_admits(_model, table):
    """The escape hatch — ONE parameter: [experiment] allow_all_models.

    Purpose: run a model that has not been measured yet (a new release, a
    channel test) without editing the ratified case tables. It relaxes WHICH
    model may run a case; it never relaxes WHETHER a case may be delegated
    (an empty ``allowed`` still means nobody) and never waives the explicit
    model, the explicit effort, or the class marker.

    Home: [experiment] in the table, or the machine-local override
    ~/.claude/catalyst/routing-override.toml. Base ships it off.
    """
    exp = table.get("experiment")
    if exp is None:
        return False
    if not isinstance(exp, dict):
        emit_deny("routing table section [experiment] is malformed (expected a table) "
                  "— fail-closed until it is repaired")
    return bool(exp.get("allow_all_models"))


def hatch_note(table):
    """A one-line description of an ACTIVE hatch, or None."""
    if hatch_admits(None, table):
        return "[experiment] allow_all_models — ЛЮБАЯ модель проходит таблицы случаев"
    return None


def warn_hatch(table):
    """Surface an active hatch on the dispatch itself (best-effort, non-blocking).

    Never emits a permission decision: an "allow" from a PreToolUse hook would
    also auto-approve the tool call, which must not be a side effect of a model
    experiment. The guaranteed channel is the SessionStart slice; this is the
    second, in-the-moment one.
    """
    note = hatch_note(table)
    if note:
        print(json.dumps({"systemMessage": "Dispatch gate: " + note + " (снять: убрать "
                          "allow_all_models из routing-override.toml)"},
                         ensure_ascii=False))


def check_known_model(model, table, where):
    """Deny a model that no case table permits anywhere."""
    if hatch_admits(model, table):
        return
    if model.strip().lower() not in known_model_ids(table):
        emit_deny(f"{where}: model '{model}' is not named in any case table "
                  f"([classes.*] in hooks/routing-table.toml), so it is "
                  f"permitted nowhere. Matching is EXACT: an unmeasured sibling "
                  f"(gpt-5.6-luna vs gpt-5.6-sol, kimi-k3-256k vs kimi-k3) is a "
                  f"different model. Measure it, then list it in the cases where it "
                  f"is ratified. Testing an unmeasured model on purpose? Set "
                  f"[experiment] allow_all_models = true in "
                  f"~/.claude/catalyst/routing-override.toml.")


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


def frontmatter_fields(subagent_type, cwd):
    """``model:`` and ``effort:`` from the agent's definition file.

    First existing <name>.md wins (project > user > plugins — the harness's own
    precedence). A found definition ends the search even when it declares
    neither field: that IS the definition.
    """
    fields = {"model": None, "effort": None}
    name = subagent_type.rsplit(":", 1)[-1].strip()
    if not name or not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        return fields
    for d in agent_dirs(cwd):
        path = os.path.join(d, name + ".md")
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            return fields
        if not text.startswith("---\n"):
            return fields
        end = text.find("\n---", 4)
        if end == -1:
            return fields
        for line in text[4:end].split("\n"):
            for key in ("model", "effort"):
                if line.startswith(key + ":"):
                    fields[key] = line.partition(":")[2].strip().strip("\"'")
        return fields
    return fields


def resolve_class(text, table, where, declared=None):
    """The case this dispatch declares: (cid, entry), or (None, None).

    ONE rule with ONE implementation. "Every dispatch declares its case" holds
    on the Agent channel and on every Bash dispatch channel alike; a second copy
    of the check would drift from this one, and the drift would show up exactly
    where it is least visible — on the vendor channels. (None, None) comes back
    only when the table does not require the marker at all.

    ``declared`` is the Agent channel's structured carrier (the tool's
    ``dispatch_class`` field). It exists because a fork has nowhere good to put
    the marker: its prompt IS the directive handed to the forked self, so a
    marker there becomes instruction text the fork then has to ignore. Bash
    channels pass nothing and keep using the marker alone.
    """
    classes = section(table, "classes")
    known = ", ".join(sorted(classes)) or "none"
    cid = declared_class(text)
    structured = (declared or "").strip().lower() or None
    if structured and cid and structured != cid:
        emit_deny(f"{where} declares class '{structured}' in the dispatch_class field "
                  f"but '{cid}' in the prompt marker — one dispatch is one case. Two "
                  f"carriers disagreeing is the same ambiguity as two markers: leave "
                  f"whichever one is right.")
    cid = structured or cid
    dsp = table.get("dispatch") or {}
    if not isinstance(dsp, dict):
        emit_deny("routing table section [dispatch] is malformed (expected a table) "
                  "— fail-closed until it is repaired")
    if cid is None:
        if not dsp.get("class_marker_required", False):
            return None, None
        emit_deny(f"{where} declares no class: add a [dispatch-class:<id>] marker "
                  f"(known: {known}). An undeclared dispatch is governed by nothing. "
                  f"Routing home: hooks/routing-table.toml "
                  f"[dispatch].class_marker_required.")
    cls = classes.get(cid)
    if cls is None:
        emit_deny(f"declared dispatch class '{cid}' is not in the routing table "
                  f"(known: {known}). Fix the marker or the table — a silently "
                  f"ignored typo would be a new silent defect.")
    return cid, cls


def check_class_delegable(cid, cls):
    """A case with an empty allow-list goes to nobody — on every channel."""
    if not (cls.get("allowed") or []):
        emit_deny(f"class '{cid}' ({cls.get('label', '')}) is never delegated to any "
                  f"model: {cls.get('reason', '')}")


def check_class_admits(model, source, cid, cls, table):
    """The named model must belong to the declared case."""
    check_class_delegable(cid, cls)
    allowed = cls.get("allowed") or []
    if (str(model).strip().lower() not in {str(a).lower() for a in allowed}
            and not hatch_admits(model, table)):
        emit_deny(f"model '{model}' (from {source}) is outside class '{cid}' "
                  f"({cls.get('label', '')}): allowed {allowed}. "
                  f"{cls.get('reason', '')}")


def check_dispatch(tool_input, table, cwd):
    st = str(tool_input.get("subagent_type") or "")
    fm = frontmatter_fields(st, cwd)
    model = str(tool_input.get("model") or "").strip()
    source = "the call"
    if model.lower() in UNSET_MODELS:
        model = (fm["model"] or "").strip()
        source = f"the frontmatter of agent '{st}'"
        if model.lower() in UNSET_MODELS:
            emit_deny(
                f"dispatch of '{st}' carries no effective model: 'model' is set neither "
                f"in the call nor in the agent definition. Add an explicit model to the "
                f"dispatch — silently inheriting the parent model is the defect class "
                f"this gate closes (routing home: hooks/routing-table.toml).")
    eff = model.lower()

    check_known_model(model, table, f"dispatch of '{st}' (model from {source})")

    # The declared class is the ONE gate every dispatch passes. A dispatch that
    # lands in no case at all is checked by nothing, and that hole is what this
    # gate exists to close — so declaring the class is mandatory, for executors
    # and for critics/auditors/scouts alike. WHICH class it is stays the
    # controller's decision; escalating after a failure = declare a higher one.
    cid, cls = resolve_class(str(tool_input.get("prompt") or ""), table,
                             f"dispatch of '{st}'",
                             declared=str(tool_input.get("dispatch_class") or ""))
    if cid is None:
        return

    # The agent's NAME must agree with the declared class: a critic dispatched
    # under an executor class would otherwise buy the executor's wider model set.
    stl = st.lower()
    for role_name, role in section(table, "roles").items():
        if not any(str(m).lower() in stl for m in role.get("match") or []):
            continue
        want = str(role.get("class") or "")
        if want and want != cid:
            emit_deny(f"subagent '{st}' matches role '{role_name}', whose class is "
                      f"'{want}', but the dispatch declares '{cid}'. Declare "
                      f"[dispatch-class:{want}] or dispatch a different agent — the "
                      f"name and the class must not disagree.")

    check_class_admits(model, source, cid, cls, table)

    # Agent-channel effort: proxy models must carry an explicit effort — the
    # carrier is the agent definition's frontmatter ``effort:`` field (the
    # harness sends it as output_config.effort; measured honored 2026-07-27).
    agent_cfg = section(table, "channels").get("agent") or {}
    required_for = agent_cfg.get("effort_required_for") or []
    if eff in {str(p).lower() for p in required_for}:
        effort = str(tool_input.get("effort") or "").strip().lower() \
            or str(fm["effort"] or "").strip().lower()
        if not effort:
            emit_deny(f"proxy model '{model}' dispatched without an explicit effort — "
                      f"the vendor's silent default effort is the defect class this "
                      f"gate closes. Carriers: the dispatch's own `effort` field "
                      f"(the only one a fork has, its definition being synthetic), or "
                      f"the agent definition's frontmatter "
                      f"`effort: low|medium|high|xhigh|max` (dispatch an effort-pinned "
                      f"agent). Routing home: hooks/routing-table.toml [channels.agent].")
        if effort not in EFFORT_WORDS:
            emit_deny(f"effort '{effort}' (agent '{st}') is not a valid level "
                      f"({'|'.join(EFFORT_WORDS)}) — an unknown value would be "
                      f"silently ignored by the harness.")
        check_pins(model, effort, table, "Agent-channel effort pin violated")


def pins_table(table):
    """The channel-neutral accepted-effort pins ([pins]): model pattern -> efforts."""
    pins = table.get("pins")
    if pins is None:
        return {}
    if not isinstance(pins, dict) or any(not isinstance(v, list) for v in pins.values()):
        emit_deny("routing table section [pins] is malformed (expected "
                  "model-pattern = [efforts]) — fail-closed until the table is repaired")
    return pins


def check_pins(model, effort, table, where):
    """Accepted-effort pins apply on every channel where model+effort are known."""
    if not effort:
        return
    eff_model = model.strip().lower()
    for pat, allowed in pins_table(table).items():
        if str(pat).lower() == eff_model:
            allowed_l = [str(a).lower() for a in allowed]
            if effort not in allowed_l:
                emit_deny(f"{where}: model '{model}' runs at {allowed} "
                          f"(accepted-effort pin), got '{effort}' "
                          f"(routing home: hooks/routing-table.toml [pins]).")


def check_channel_model(model, effort, table, where="proxy channel"):
    """Admission + accepted-effort pins for a model/effort pair from a Bash call."""
    check_known_model(model, table, where)
    check_pins(model, effort, table, f"{where} effort pin violated")


CLI_MODEL_RE = re.compile(r"(?:--model|-m)[=\s]+[\"']?([A-Za-z0-9._\[\]-]+)")
CLI_EFFORT_RE = re.compile(r"(?:--effort|--reasoning[-_]effort)[=\s]+[\"']?(%s)\b"
                           % "|".join(EFFORT_WORDS))


def check_bash(cmd, table):
    channels = section(table, "channels")
    kinds = []   # the dispatch channel(s) this command uses
    named = []   # (model, source) the command itself names

    # Direct vendor CLI, launched WITHOUT the envoy companion. Same models, same
    # ledger, so the same rules — otherwise the whole table is one `codex exec`
    # away from being advisory.
    vendor, vcfg = cli_vendor(cmd, table)
    if vcfg is not None:
        kinds.append(f"direct '{vendor}' CLI run")
        mm = CLI_MODEL_RE.search(cmd)
        em = CLI_EFFORT_RE.search(cmd)
        if bool(vcfg.get("effort_required", True)) and not em:
            emit_deny(f"direct '{vendor}' CLI run without an explicit effort — a "
                      f"vendor's silent default effort is the defect class this gate "
                      f"closes, and running outside envoy does not change that. Add "
                      f"--effort <level>, or go through the envoy companion "
                      f"(routing home: hooks/routing-table.toml [channels.cli]).")
        if mm:
            # Admission only, no [pins]: the pins are the Agent/proxy accepted
            # efforts, and a vendor CLI has its own ceilings (grok-CLI <= high) —
            # the table says so where the pins are defined, and applying them
            # here would deny a legitimate run.
            check_known_model(mm.group(1), table, f"direct '{vendor}' CLI")
            named.append((mm.group(1), f"--model of the '{vendor}' CLI run"))
        elif vcfg.get("model_required", False):
            emit_deny(f"direct '{vendor}' CLI run naming no model — the CLI's default "
                      f"model is not a routing decision. Name it with --model "
                      f"(routing home: hooks/routing-table.toml [channels.cli]).")

    if ENVOY_MARK in cmd and ENVOY_TASK_RE.search(cmd):
        vm = ENVOY_VENDOR_RE.search(cmd)
        vendor = vm.group(1).lower() if vm else "codex"
        kinds.append(f"envoy task via vendor '{vendor}'")
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
        kinds.append("proxy-critique call")
        m = PROXY_CRITIQUE_RE.search(cmd)
        if not m or m.group(2).lower() not in EFFORT_WORDS:
            emit_deny("proxy-critique call whose model/effort cannot be read from the "
                      "command — expected form: proxy-critique.sh <model> <effort> "
                      "<brief> <out> <files...> with an explicit effort.")
        check_channel_model(m.group(1), m.group(2).lower(), table)
        named.append((m.group(1), "the proxy-critique call"))

    if PROXY_MARK in cmd:
        kinds.append("proxy chat/completions call")
        pcfg = channels.get("proxy") or {}
        if bool(pcfg.get("effort_required", True)) and "reasoning_effort" not in cmd:
            emit_deny("proxy chat/completions call without a visible reasoning_effort — "
                      "effort must be explicit on this channel. Inline the request body "
                      "(\"reasoning_effort\": \"...\") or use the proxy-critique wrapper.")
        mm = PROXY_MODEL_RE.search(cmd)
        em = PROXY_EFFORT_RE.search(cmd)
        if mm and em:
            check_channel_model(mm.group(1), em.group(1).lower(), table)
            named.append((mm.group(1), "the proxy request body"))

    # A vendor launched from Bash IS a dispatch: it picks a model for a case
    # exactly as an Agent call does, so it declares its case exactly as one.
    # The rule attaches to the recognized dispatch channels, never to the shell
    # at large — an unrecognized command has returned by now and is not gated.
    # Envoy names only a vendor, never a model, so there the declared case can
    # be checked for being delegable at all, but not against a model id.
    if not kinds:
        return
    cid, cls = resolve_class(cmd, table, " + ".join(kinds))
    if cid is None:
        return
    check_class_delegable(cid, cls)
    for model, source in named:
        check_class_admits(model, source, cid, cls, table)


def render_slice():
    """A compact rules slice for SessionStart — rendered from the SAME table
    the gate reads (truth 7: no second, separately maintained copy)."""
    table, err = load_table(os.getcwd())
    if err:
        print(f"!! DISPATCH ROUTING TABLE BROKEN — {err}\n"
              f"!! The dispatch gate is fail-closed: Task/Agent dispatches and "
              f"envoy/proxy calls will be DENIED until this is fixed.")
        return
    deny = gate_mode(table) == "deny"
    answer = ("нарушение = ОТКАЗ" if deny else
              "нарушение НЕ блокирует: гейт напоминает, диспатч идёт — но "
              "напоминание попадает и в контекст, так что нарушать его "
              "бессмысленно, оно вернётся на следующем диспатче")
    breach = "отказ" if deny else "нарушение"
    lines = [
        "<DISPATCH-ROUTING>",
        f"Маршрутизация диспатчей (hooks/routing-table.toml — PreToolUse-гейт "
        f"проверяет эту же таблицу; {answer}):",
        f"- Каждый Task/Agent-диспатч: model ЯВНО в вызове (или в определении "
        f"агента); ни там, ни там = {breach}.",
    ]
    classes = table.get("classes") or {}
    if (table.get("dispatch") or {}).get("class_marker_required", False):
        lines.append(f"- КАЖДЫЙ диспатч объявляет класс маркером "
                     f"[dispatch-class:<id>]: в промпте Task/Agent ИЛИ в тексте "
                     f"команды вендорского канала (envoy, вендорский CLI, "
                     f"прокси); без маркера = {breach}.")
    for cid, c in classes.items():
        allowed = c.get("allowed")
        target = "|".join(str(a) for a in allowed) if allowed else "НЕ делегируется"
        lines.append(f"- Класс {cid} ({c.get('label', '')}) → {target}.")
    for name, role in (table.get("roles") or {}).items():
        match = "|".join(str(m) for m in role.get("match") or [])
        if role.get("class"):
            lines.append(f"- Имя агента содержит {match} → класс {role['class']} "
                         f"(объявить другой = {breach}).")
    agent_cfg = (table.get("channels") or {}).get("agent") or {}
    required_for = agent_cfg.get("effort_required_for") or []
    if required_for:
        lines.append("- Прокси-модели в Agent-канале ("
                     + "|".join(str(p) for p in required_for)
                     + "): effort ОБЯЗАТЕЛЕН — frontmatter `effort:` определения агента.")
    pins = table.get("pins") or {}
    if pins:
        lines.append("- Принятые effort по моделям (Agent/прокси; envoy-CLI — свои потолки): "
                     + ", ".join(f"{m}→{'|'.join(str(a) for a in al)}"
                                 for m, al in pins.items()) + ".")
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
        lines.append("- прокси-POST (127.0.0.1:8317): reasoning_effort обязан быть "
                     "виден в команде.")
    lines.append("- Оверрайды (слоями, последний сильнее): база плагина < "
                 "~/.claude/catalyst/routing-override.toml < "
                 "<проект>/.claude/catalyst/routing-override.toml. Названная "
                 "запись заменяет базовую целиком, неназванные сохраняются.")
    note = hatch_note(table)
    if note:
        lines.append("!! ЭКСПЕРИМЕНТАЛЬНЫЙ ДОПУСК АКТИВЕН: " + note
                     + ". Таблицы случаев в этой части НЕ действуют — это режим "
                       "проверки неизмеренной модели, не рабочий дефолт.")
    lines.append("</DISPATCH-ROUTING>")
    print("\n".join(lines))


def gate_mode(table):
    """"warn" (default) or "deny" — how a broken rule is answered."""
    mode = str(((table or {}).get("dispatch") or {}).get("mode") or "warn").lower()
    return "deny" if mode == "deny" else "warn"


def evaluate(data):
    """(violation_reason, mode) for one hook payload; (None, mode) when clean.

    The single entry point for judging a payload — used by this hook and by
    hooks/dispatch-stats.py, so the rules are never implemented twice.
    """
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
                and PROXY_CRITIQUE_MARK not in cmd
                and not names_cli_hint(cmd)):
            return None, "warn"
    elif tool not in ("Task", "Agent"):
        return None, "warn"

    table, err = load_table(cwd)
    if err:
        # An unreadable table is not a routing choice to remind about: nothing
        # can be judged at all, so this stays fail-closed in either mode.
        return ("Dispatch gate: " + err + " — dispatches and gated channels are "
                "blocked until the table is repaired."), "deny"
    try:
        if tool == "Bash":
            check_bash(str(tool_input.get("command") or ""), table)
        else:
            check_dispatch(tool_input, table, cwd)
    except Violation as v:
        return v.reason, gate_mode(table)
    return None, gate_mode(table)


def main(argv):
    if "--render-slice" in argv:
        render_slice()
        return
    try:
        data = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001 — protocol break must be loud
        print_deny(f"Dispatch gate: hook input is not valid JSON ({e}) — refusing "
                   f"rather than passing unseen dispatches (fail-closed).")
        return
    if not isinstance(data, dict):
        print_deny("Dispatch gate: hook input is not a JSON object — refusing "
                   "(fail-closed).")
        return
    reason, mode = evaluate(data)
    if reason is not None:
        (print_deny if mode == "deny" else print_warn)(reason)
        return
    table, err = load_table(str(data.get("cwd") or "") or None)
    if not err:
        try:
            warn_hatch(table)
        except Violation:
            pass


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — an internal error must not become a silent pass
        print_deny(f"Dispatch gate: internal gate error "
                   f"({e.__class__.__name__}: {e}) — fail-closed.")
