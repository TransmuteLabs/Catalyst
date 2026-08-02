#!/usr/bin/env python3
"""Catalyst dispatch stats — PostToolUse hook: fleet usage, and a nudge when it collapses.

Why this exists: the routing gate can only judge the dispatch in front of it. It
cannot see that the last eight went to the same model — and that pattern is the
actual field failure, because naming a model is one parameter while routing a
task to the right cheap-but-capable executor is a decision the orchestrator has
to remember to make. Monoculture is therefore invisible per-dispatch and obvious
in aggregate; this hook holds the aggregate.

Separate from the gate on purpose: the gate provably writes nothing (spec truth
8), which is what lets it stay trivially safe to reason about. Bookkeeping needs
to write, so it lives here and runs AFTER the tool — a denied dispatch never
happened and must not be counted.

Contract:
  input   : PostToolUse hook JSON on stdin (tool_name, tool_input, session_id, cwd)
  silent  : exit 0, no output — the normal case
  nudge   : exit 0, one JSON object with hookSpecificOutput.additionalContext
            (Claude Code) or plain text (other harnesses)
  writes  : ~/.claude/catalyst/stats/<session>.json only
  failure : any error is swallowed — bookkeeping must never break a tool call

  --report [session]  print the session's usage table instead of recording

Second duty: in the gate's non-blocking "warn" mode the breach must still reach
the MODEL, or the reminder only ever reaches the user's terminal and changes
nothing about the next dispatch. This hook re-evaluates the same rules through
the gate's own entry point (never a second copy of them) and carries the breach
into context alongside the fleet observation.

Thresholds live in the routing table's [stats] section, not here, so the rule
can be retuned (and mutant-tested) as data like the rest of the routing rules.
"""
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
STATS_DIR = os.path.join(os.path.expanduser("~"), ".claude", "catalyst", "stats")
KEEP_ENTRIES = 128          # bounded file: enough for any window, never unbounded
PRUNE_AFTER_DAYS = 14

DEFAULTS = {
    "enabled": True,
    "window": 8,             # dispatches considered
    "min_dispatches": 6,     # stay quiet until there is enough to judge
    "monoculture_share": 0.75,
    "remind_every": 8,       # at most one nudge per N dispatches
    # Dominance alone is blind to the real pattern: rotating between two or
    # three models never crosses a share threshold, yet the rest of the fleet
    # sits idle. Coverage is the second, independent signal.
    "min_distinct_models": 3,
    "min_distinct_classes": 3,
    # A session can run for a week. Judging it whole would let a model used
    # five days ago count as "the fleet is in use" while today is monoculture,
    # so the verdict is passed on the RECENT slice; the cumulative view stays
    # available in --report as context, never as the trigger.
    "recent_minutes": 30,
    # Two independent brakes, both must clear. The count brake keeps a busy
    # burst from repeating; the clock brake keeps a slow session from being
    # nagged every few dispatches over hours. A reminder that arrives too often
    # stops being read, and then it protects nothing.
    "remind_cooldown_minutes": 30,
    # Concentration is sometimes the DECISION, not a lapse: a period where
    # everything genuinely must run on one model with priority. Naming that
    # model here silences the fleet observation for it — the rule reminders
    # from the gate still fire. Without this the nudge would be loudest exactly
    # when the user is doing the right thing, and a reminder that is noise
    # stops being read.
    "deliberate_model": "",
}


def gate_module():
    """The gate module, for table loading and rule evaluation (no second copy).

    Bytecode writing is off for this import: the gate lives in the plugin's own
    directory, and a hook must not litter __pycache__ into a distributed,
    possibly read-only install just by reading it.
    """
    import importlib.util
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(
        "catalyst_dispatch_gate", os.path.join(HERE, "dispatch-gate.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def settings(table):
    cfg = dict(DEFAULTS)
    raw = (table or {}).get("stats")
    if isinstance(raw, dict):
        for k in DEFAULTS:
            if k in raw:
                cfg[k] = raw[k]
    return cfg


def aliases(table):
    """Ids of the SAME model collapsed to one name, for counting only.

    ``opus`` and ``claude-opus-5[1m]`` are one model under two spellings:
    counted separately they read as fleet diversity that does not exist. The
    gate keeps matching ids exactly — an alias here would let an unmeasured
    sibling in. This is a stats-only view.
    """
    raw = ((table or {}).get("stats") or {}).get("aliases")
    if not isinstance(raw, dict):
        return {}
    return {str(k).strip().lower(): str(v).strip().lower() for k, v in raw.items()}


def canon(model, alias_map):
    m = str(model or "?").strip().lower()
    return alias_map.get(m, m)


def fleet(table, alias_map):
    """Every model the case tables admit anywhere, collapsed by alias."""
    out = set()
    for entry in ((table or {}).get("classes") or {}).values():
        for a in entry.get("allowed") or []:
            out.add(canon(a, alias_map))
    return out


def state_path(session_id):
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", str(session_id or "unknown"))[:120]
    return os.path.join(STATS_DIR, safe + ".json")


def load_state(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            st = json.load(f)
        if isinstance(st, dict) and isinstance(st.get("entries"), list):
            return st
    except (OSError, ValueError):
        pass
    return {"entries": [], "total": 0, "reminded_at": 0, "reminded_t": 0}


def save_state(path, st):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False)
    os.replace(tmp, path)


def prune_old():
    """Old session files are garbage; losing one costs nothing."""
    import time
    cutoff = time.time() - PRUNE_AFTER_DAYS * 86400
    try:
        for name in os.listdir(STATS_DIR):
            p = os.path.join(STATS_DIR, name)
            if os.path.isfile(p) and os.path.getmtime(p) < cutoff:
                os.remove(p)
    except OSError:
        pass


AXES = ("model", "class", "role", "agent", "channel")


def role_of(subagent_type, table):
    """The [roles.*] entry whose match hits this agent name, or "-".

    Role and class are pinned 1:1 by the gate, so this axis mirrors ``class``
    for role-governed dispatches — it earns its place by making the executor
    dispatches (no role) visible as a group, next to the ``agent`` axis, which
    is the one thing the class breakdown cannot show: WHICH concrete agent runs.
    """
    stl = str(subagent_type or "").lower()
    for name, role in ((table or {}).get("roles") or {}).items():
        if any(str(m).lower() in stl for m in role.get("match") or []):
            return name
    return "-"


def observe(gate, data, table):
    """One record per dispatch (see AXES), or None when it is not a dispatch."""
    tool = str(data.get("tool_name") or data.get("tool") or "")
    ti = data.get("tool_input")
    ti = ti if isinstance(ti, dict) else {}

    def rec(model, klass, channel, role="-", agent="-"):
        return {"model": str(model or "?").lower(), "class": klass,
                "role": role, "agent": agent, "channel": channel}

    if tool in ("Task", "Agent"):
        st = str(ti.get("subagent_type") or "?")
        model = str(ti.get("model") or "").strip()
        if model.lower() in gate.UNSET_MODELS:
            try:
                fm = gate.frontmatter_fields(st, str(data.get("cwd") or ""))
                model = (fm.get("model") or "").strip()
            except Exception:  # noqa: BLE001 — bookkeeping never breaks the call
                model = ""
        found = gate.CLASS_MARKER_RE.search(str(ti.get("prompt") or ""))
        return rec(model or "?", found.group(1).lower() if found else "?",
                   "agent", role_of(st, table), st.lower())

    if tool == "Bash":
        cmd = str(ti.get("command") or "")
        # On this channel the marker lives in the command text, not in a
        # ``prompt`` field. Reading only ``prompt`` here recorded every vendor
        # dispatch as classless, which then understated the coverage signal: a
        # fleet rotating properly across cases still looked like it used one.
        cm = gate.CLASS_MARKER_RE.search(cmd)
        kls = cm.group(1).lower() if cm else "?"
        if gate.ENVOY_MARK in cmd and gate.ENVOY_TASK_RE.search(cmd):
            vm = gate.ENVOY_VENDOR_RE.search(cmd)
            return rec(vm.group(1) if vm else "codex", kls, "envoy")
        vendor, cfg = None, None
        try:
            vendor, cfg = gate.cli_vendor(cmd, table)
        except Exception:  # noqa: BLE001
            pass
        if cfg is not None:
            mm = gate.CLI_MODEL_RE.search(cmd)
            return rec(mm.group(1) if mm else vendor, kls, "cli")
        if gate.PROXY_CRITIQUE_MARK in cmd:
            m = gate.PROXY_CRITIQUE_RE.search(cmd)
            return rec(m.group(1) if m else "?", kls, "proxy")
        if gate.PROXY_MARK in cmd:
            mm = gate.PROXY_MODEL_RE.search(cmd)
            return rec(mm.group(1) if mm else "?", kls, "proxy")
    return None


def recent(entries, minutes):
    """Entries inside the last N minutes. Entries with no timestamp are old."""
    cutoff = time.time() - float(minutes) * 60.0
    return [e for e in entries if float(e.get("t") or 0) >= cutoff]


def dominant(values):
    """(value, share) of the most frequent entry, or (None, 0.0)."""
    if not values:
        return None, 0.0
    counts = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    top = max(counts, key=lambda k: counts[k])
    return top, counts[top] / len(values)


def nudge_text(table, st, cfg):
    """The reminder, or None. Grounded in the table — never generic advice.

    Two independent signals, because either alone has a blind spot. DOMINANCE
    catches one model taking the window; COVERAGE catches the case dominance
    cannot see — a steady rotation between two or three models, which never
    crosses a share threshold while the rest of the fleet never runs.
    """
    span = recent(st["entries"], cfg["recent_minutes"])
    win = span[-int(cfg["window"]):]
    if len(win) < int(cfg["min_dispatches"]):
        return None
    alias_map = aliases(table)
    deliberate = canon(cfg.get("deliberate_model") or "", alias_map)
    share = float(cfg["monoculture_share"])
    win_models = [canon(e.get("model"), alias_map) for e in win]
    win_classes = [e.get("class", "?") for e in win]
    top_model, m_share = dominant(win_models)
    top_class, c_share = dominant(win_classes)

    seen_models = {m for m in win_models if m != "?"}
    seen_classes = {c for c in win_classes if c != "?"}
    available = fleet(table, alias_map)
    classes = (table or {}).get("classes") or {}
    delegable = {cid for cid, c in classes.items() if (c.get("allowed") or [])}
    # Never ask for more variety than the table actually offers.
    want_models = min(int(cfg["min_distinct_models"]), len(available) or 1)
    want_classes = min(int(cfg["min_distinct_classes"]), len(delegable) or 1)

    if deliberate and deliberate != "?" and top_model == deliberate:
        return None              # recorded decision, not forgetfulness

    lines = []
    if top_model and top_model != "?" and m_share >= share:
        lines.append(f"{int(m_share * 100)}% из {len(win)} диспатчей за последние "
                     f"{int(float(cfg['recent_minutes']))} мин ушли на одну "
                     f"модель — {top_model}.")
    elif seen_models and len(seen_models) < want_models:
        lines.append(f"За последние {int(float(cfg['recent_minutes']))} мин "
                     f"({len(win)} диспатчей) задействовано {len(seen_models)} "
                     f"модели(ей) из {len(available)} доступных: "
                     f"{', '.join(sorted(seen_models))}.")
    if top_class and top_class != "?" and c_share >= share:
        lines.append(f"{int(c_share * 100)}% из них объявлены одним классом — "
                     f"{top_class}.")
    elif seen_classes and len(seen_classes) < want_classes:
        lines.append(f"Объявлено классов: {len(seen_classes)} из {len(delegable)} "
                     f"({', '.join(sorted(seen_classes))}).")
    if not lines:
        return None

    mins = int(float(cfg["recent_minutes"]))
    idle = sorted(available - {canon(e.get("model"), alias_map) for e in span})
    if idle:
        lines.append(f"Ни разу за последние {mins} мин: " + ", ".join(idle) + ".")
    used = {e.get("class") for e in span}
    unused = [(cid, c) for cid, c in classes.items()
              if cid not in used and (c.get("allowed") or [])]
    if unused:
        lines.append("Классы без диспатча за это время: " + "; ".join(
            f"{cid} → {'|'.join(str(a) for a in (c.get('allowed') or [])[:3])}"
            for cid, c in unused[:5]) + ".")
    lines.append("Это наблюдение, не запрет: если задачи действительно одного "
                 "класса — так и оставить. Но если очередная задача механическая "
                 "или объёмная по готовому брифу, у неё есть более дешёвый "
                 "исполнитель, и флот простаивает.")
    return "\n".join(lines)


def emit(text):
    if os.environ.get("CLAUDE_PLUGIN_ROOT") and not os.environ.get("COPILOT_CLI"):
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "<DISPATCH-FLEET>\n" + text + "\n</DISPATCH-FLEET>",
        }}, ensure_ascii=False))
    else:
        print("<DISPATCH-FLEET>\n" + text + "\n</DISPATCH-FLEET>")


def report(session_id):
    path = state_path(session_id) if session_id else None
    if not path or not os.path.isfile(path):
        try:
            files = [os.path.join(STATS_DIR, f) for f in os.listdir(STATS_DIR)]
            files = [f for f in files if f.endswith(".json")]
            path = max(files, key=os.path.getmtime) if files else None
        except OSError:
            path = None
    if not path or not os.path.isfile(path):
        print("no dispatch stats recorded yet")
        return
    st = load_state(path)

    def block(entries, title):
        if not entries:
            print(f"{title}: nothing")
            return
        print(title + ":")
        for key in AXES:
            bucket = {}
            for e in entries:
                v = e.get(key, "?")
                bucket[v] = bucket.get(v, 0) + 1
            row = ", ".join(f"{k}={v}" for k, v in
                            sorted(bucket.items(), key=lambda kv: -kv[1]))
            print(f"  by {key:<8} {row}")

    gate = gate_module()
    table, err = gate.load_table(os.getcwd())
    cfg = settings(None if err else table)
    mins = int(float(cfg["recent_minutes"]))
    print(f"session: {os.path.basename(path)[:-5]}   dispatches: {st.get('total', 0)}"
          f"   (last {len(st['entries'])} kept)")
    block(st["entries"], "cumulative")
    block(recent(st["entries"], mins), f"last {mins} min")


def main(argv):
    if "--report" in argv:
        i = argv.index("--report")
        report(argv[i + 1] if len(argv) > i + 1 else None)
        return
    try:
        data = json.load(sys.stdin)
    except Exception:  # noqa: BLE001 — a protocol break must not break the tool
        return
    if not isinstance(data, dict):
        return
    gate = gate_module()
    table, err = gate.load_table(str(data.get("cwd") or "") or None)
    if err:
        return                       # the gate already reported it; stay quiet
    cfg = settings(table)
    if not cfg.get("enabled", True):
        return
    entry = observe(gate, data, table)
    if entry is None:
        return
    breach = None
    try:
        reason, mode = gate.evaluate(data)
        if reason and mode != "deny":
            breach = reason      # deny mode already stopped it; nothing ran
    except Exception:  # noqa: BLE001 — bookkeeping never breaks the call
        pass
    entry["model"] = canon(entry["model"], aliases(table))  # one model, one name
    entry["t"] = int(time.time())
    path = state_path(data.get("session_id"))
    st = load_state(path)
    st["entries"].append(entry)
    st["entries"] = st["entries"][-KEEP_ENTRIES:]
    st["total"] = int(st.get("total", 0)) + 1

    text = None
    quiet_for = time.time() - float(st.get("reminded_t") or 0)
    if (st["total"] - int(st.get("reminded_at", 0)) >= int(cfg["remind_every"])
            and quiet_for >= float(cfg["remind_cooldown_minutes"]) * 60.0):
        text = nudge_text(table, st, cfg)
        if text:
            st["reminded_at"] = st["total"]
            st["reminded_t"] = int(time.time())
    save_state(path, st)
    prune_old()
    if breach and text:
        emit(breach + "\n\n" + text)
    elif breach:
        emit(breach)
    elif text:
        emit(text)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception:  # noqa: BLE001 — bookkeeping is never worth a broken call
        pass
