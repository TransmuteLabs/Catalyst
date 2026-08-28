#!/usr/bin/env bash
# Deterministic tests for the dispatch gate (spec docs/specs/2026-07-27-dispatch-gate-spec.md).
# One block per must_have truth 1-8 (+9), including mutant checks: the same
# dispatch against a table with the rule removed must flip the verdict —
# proving the rule lives in the table, not in the gate's code.
# No live sessions, no network, <2s total.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
GATE="$ROOT/hooks/dispatch-gate.py"
LAUNCHER="$ROOT/hooks/dispatch-gate"
BASE_TABLE="$ROOT/hooks/routing-table.toml"
WORK=$(mktemp -d) || exit 1
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1: expected [$2], got [$3]"; fi
}

# ---- fixtures ----
mkdir -p "$WORK/agents" "$WORK/rw" "$WORK/home"
printf -- '---\nname: withmodel\ndescription: x\nmodel: glm-5.3\neffort: max\n---\nbody\n' > "$WORK/agents/withmodel.md"
printf -- '---\nname: sonnetagent\ndescription: x\nmodel: sonnet\n---\nbody\n'  > "$WORK/agents/sonnetagent.md"
printf -- '---\nname: nomodel\ndescription: x\n---\nbody\n'                     > "$WORK/agents/nomodel.md"
printf -- '---\nname: inheritagent\ndescription: x\nmodel: inherit\n---\nbody\n' > "$WORK/agents/inheritagent.md"
printf -- '---\nname: pinned1a\ndescription: x\neffort: max\n---\nbody\n'        > "$WORK/agents/pinned1a.md"
printf -- '---\nname: badeffort\ndescription: x\nmodel: glm-5.3\neffort: turbo\n---\nbody\n' > "$WORK/agents/badeffort.md"
printf -- '---\nname: kimipin\ndescription: x\nmodel: kimi-k3\neffort: max\n---\nbody\n'     > "$WORK/agents/kimipin.md"
printf -- '---\nname: kimipinok\ndescription: x\nmodel: kimi-k3\neffort: high\n---\nbody\n'  > "$WORK/agents/kimipinok.md"
printf -- '---\nname: gptmedium\ndescription: x\nmodel: gpt-5.6-sol\neffort: medium\n---\nbody\n' > "$WORK/agents/gptmedium.md"
# Analysis-role fixtures: model+effort are VALID, so a denial can only come from
# the role floor — otherwise the effort rule would deny first and prove nothing.
printf -- '---\nname: debug-glm\ndescription: x\nmodel: glm-5.3\neffort: max\n---\nbody\n'  > "$WORK/agents/debug-glm.md"
printf -- '---\nname: sleuth-grok\ndescription: x\nmodel: grok-4.6\neffort: max\n---\nbody\n' > "$WORK/agents/sleuth-grok.md"
printf -- '---\nname: analyzer-gpt\ndescription: x\nmodel: gpt-5.6-sol\neffort: high\n---\nbody\n' > "$WORK/agents/analyzer-gpt.md"
printf -- '---\nname: debug-kimi\ndescription: x\nmodel: kimi-k3\neffort: high\n---\nbody\n' > "$WORK/agents/debug-kimi.md"
# same model+effort as analyzer-gpt but a name the analysis patterns do NOT match
printf -- '---\nname: scout-minimax\ndescription: x\nmodel: MiniMax-M3\neffort: high\n---\nbody\n' > "$WORK/agents/scout-minimax.md"
printf -- '---\nname: scout-dspro\ndescription: x\nmodel: deepseek-v4-pro\neffort: high\n---\nbody\n' > "$WORK/agents/scout-dspro.md"
printf -- '---\nname: impl-gpt\ndescription: x\nmodel: gpt-5.6-sol\neffort: high\n---\nbody\n' > "$WORK/agents/impl-gpt.md"

# ---- fake potionbard daemon for the [limits] quota check ----
# One AF_UNIX server; canned replies come from a JSON file re-read on every
# connection, so scenarios retune without a restart. Each request appends
# "REQ <provider>" to PB_LOG — scenarios assert the socket was NOT touched.
PB_SOCK="$WORK/pb.sock"; PB_SCRIPT="$WORK/pb.json"; PB_LOG="$WORK/pb.log"
: > "$PB_LOG"; printf '{}' > "$PB_SCRIPT"
python3 - "$PB_SOCK" "$PB_SCRIPT" "$PB_LOG" <<'EOF' 2>/dev/null &
import json, os, socket, sys
srv_path, script_path, log_path = sys.argv[1:4]
try:
    os.unlink(srv_path)
except OSError:
    pass
srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
srv.bind(srv_path)
srv.listen(16)
while True:
    conn, _ = srv.accept()
    conn.settimeout(5)
    try:
        data = b""
        while b"\n" not in data:
            chunk = conn.recv(65536)
            if not chunk:
                break
            data += chunk
        req = json.loads(data.split(b"\n", 1)[0].decode())
        with open(log_path, "a") as lf:
            lf.write("REQ %s\n" % req.get("provider", "?"))
        with open(script_path) as sf:
            val = json.load(sf).get(req.get("provider"), "MISSING")
        if val == "NOREPLY":
            pass  # the pool that never answers: connection closed silently
        elif val == "GARBAGE":
            conn.sendall(b"definitely not json\n")
        elif val == "MISSING":
            conn.sendall(json.dumps({"result": "provider_usage",
                                     "provider": req.get("provider"),
                                     "accounts": [], "error": None}).encode() + b"\n")
        else:
            conn.sendall(val.encode() + b"\n")
    except Exception:
        pass
    finally:
        try:
            conn.close()
        except Exception:
            pass
EOF
PB_PID=$!
trap 'kill $PB_PID 2>/dev/null; rm -rf "$WORK"' EXIT
for _ in $(seq 1 100); do [ -S "$PB_SOCK" ] && break; sleep 0.05; done
export POTIONBAR_SOCKET="$PB_SOCK"

pb_table() { # pb_table provider=spec ...; spec: accounts "w,w;w" | NOREPLY | GARBAGE
  python3 - "$PB_SCRIPT" "$@" <<'EOF'
import json, sys
dst, kvs = sys.argv[1], sys.argv[2:]
table = {}
for kv in kvs:
    prov, spec = kv.split("=", 1)
    if spec in ("NOREPLY", "GARBAGE"):
        table[prov] = spec
        continue
    accounts = []
    for acc in spec.split(";"):
        wins = [{"label": "W%d" % i, "used_percent": float(p),
                 "resets_at": "2099-01-0%dT00:00:00Z" % (1 + i),
                 "window_minutes": 10080} for i, p in enumerate(acc.split(","))]
        accounts.append({"account_email": "a@x", "plan": "pro", "windows": wins,
                         "updated_at": "now", "error": None})
    table[prov] = json.dumps({"result": "provider_usage", "provider": prov,
                              "accounts": accounts})
json.dump(table, open(dst, "w"))
EOF
}
pb_count() { wc -l < "$PB_LOG" | tr -d ' '; }

# Idle state for the whole legacy suite: every pool at 1% so existing
# allow-paths stay silent while [limits] is armed.
pb_table codex=1 xaicli=1 kimicode=1

# The shipped table blocks: the model rules are binding. The optional warn mode
# gets its own copy and its own section (t14).
SHIPPED_TABLE="$BASE_TABLE"
sed 's/^mode = "deny"/mode = "warn"/' "$SHIPPED_TABLE" > "$WORK/table-warn.toml"

# Mutant tables: one rule removed each (everything else intact).
# Admission lives in the case tables: naming sonnet in one must ADMIT it.
{ cat "$BASE_TABLE"; printf '\n[classes.mutantonly]\nlabel = "m"\nallowed = ["sonnet"]\n'; } > "$WORK/table-with-sonnet.toml"
sed '/^\[channels\.agent\]/,/^effort_required_for/d' "$BASE_TABLE" > "$WORK/table-no-agent-effort.toml"
sed '/^\[roles\.analysis\]/,/^class/d' "$BASE_TABLE" > "$WORK/table-no-analysis-role.toml"
# No case table names any model -> nothing is admitted anywhere.
python3 - "$BASE_TABLE" "$WORK/table-no-models.toml" <<'EOF'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
text = re.sub(r'^allowed = .*$', 'allowed = []', open(src).read(), flags=re.M)
open(dst, 'w').write(text)
EOF

T="$BASE_TABLE"          # active base table for gate()
O="$WORK/absent-override.toml"  # absent by default — isolates from the user's real override

gate() { # gate <json> -> deny | allow | other:<out> ; also asserts exit 0
  local out rc
  out=$(printf '%s' "$1" | env -u CLAUDE_PLUGIN_ROOT -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI \
        HOME="$WORK/home" CATALYST_ROUTING_TABLE="$T" CATALYST_ROUTING_OVERRIDE="$O" \
        CATALYST_ROUTING_PROJECT_OVERRIDE="${P:-$WORK/absent-override.toml}" \
        CATALYST_AGENT_DIRS="$WORK/agents" python3 "$GATE" 2>/dev/null)
  rc=$?
  if [ "$rc" -ne 0 ]; then echo "rc=$rc"; return; fi
  case "$out" in
    '') echo allow ;;
    *'"deny"'*) echo deny ;;
    *systemMessage*) echo warn ;;    # non-blocking: hatch notice or warn mode
    *) echo "other:$out" ;;
  esac
}
gate_out() { # raw stdout
  printf '%s' "$1" | env -u CLAUDE_PLUGIN_ROOT -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI \
        HOME="$WORK/home" CATALYST_ROUTING_TABLE="$T" CATALYST_ROUTING_OVERRIDE="$O" \
        CATALYST_ROUTING_PROJECT_OVERRIDE="${P:-$WORK/absent-override.toml}" \
        CATALYST_AGENT_DIRS="$WORK/agents" python3 "$GATE" 2>/dev/null
}
task() { # task <subagent_type> <model> [prompt]
  printf '{"tool_name":"Task","tool_input":{"subagent_type":"%s","model":"%s","prompt":"%s"},"cwd":"%s"}' \
    "$1" "$2" "${3:-x}" "$WORK/rw"
}
task_nomodel() { # no model field at all; optional prompt (class marker carrier)
  printf '{"tool_name":"Task","tool_input":{"subagent_type":"%s","prompt":"%s"},"cwd":"%s"}' \
    "$1" "${2:-x}" "$WORK/rw"
}
bashcmd() {
  printf '{"tool_name":"Bash","tool_input":{"command":"%s"},"cwd":"%s"}' "$1" "$WORK/rw"
}

# ---- truth 1: no effective model -> deny naming the field; frontmatter counts ----
check "t1 no model field denied"            deny  "$(gate "$(task_nomodel nomodel)")"
out=$(gate_out "$(task_nomodel nomodel)")
case "$out" in *model*) check "t1 deny names the missing field" 0 0 ;; *) check "t1 deny names the missing field" 0 1 ;; esac
check "t1 explicit model allowed"           allow "$(gate "$(task nomodel opus "[dispatch-class:1c] x")")"
check "t1 frontmatter model resolves"       allow "$(gate "$(task_nomodel withmodel "[dispatch-class:1e]")")"
check "t1 frontmatter inherit = unset"      deny  "$(gate "$(task_nomodel inheritagent)")"
check "t1 unknown agent, no model"          deny  "$(gate "$(task_nomodel ghost-agent)")"

# ---- truth 2: sonnet/haiku banned everywhere, incl. via frontmatter ----
check "t2 sonnet in call denied"            deny  "$(gate "$(task scout sonnet "[dispatch-class:scout] x")")"
check "t2 haiku in call denied"             deny  "$(gate "$(task scout claude-haiku-4-5 "[dispatch-class:scout] x")")"
# MiniMax-M3 was struck from the table 2026-08-16 (out of rotation, CLAUDE.md
# 2026-07-21; gone from the proxy roster 2026-08-08): unlisted anywhere = denied.
# The positive path it used to cover (frontmatter effort on a proxy model in
# scout) moved to a registered model, deepseek-v4-pro.
check "t2 minimax struck from table denied" deny  "$(gate "$(task scout MiniMax-M3 "[dispatch-class:scout] x")")"
check "t2 minimax agent fixture denied"     deny  "$(gate "$(task_nomodel scout-minimax "[dispatch-class:scout]")")"
check "t2 dspro scout with effort ok"       allow "$(gate "$(task_nomodel scout-dspro "[dispatch-class:scout]")")"
# Bans match by NAME: a vendor family whose id omits the vendor name (MiniMax
# abab-*) slips a single-pattern ban — every family name must be listed.
check "t2 minimax abab family denied"       deny  "$(gate "$(task scout abab-6.5s "[dispatch-class:scout] x")")"
check "t2 full dated anthropic id caught"   deny  "$(gate "$(task scout claude-sonnet-4-5-20250929 "[dispatch-class:scout] x")")"
check "t2 bedrock-prefixed id caught"       deny  "$(gate "$(task scout us.anthropic.claude-haiku-4-5 "[dispatch-class:scout] x")")"
check "t2 sonnet via frontmatter denied"    deny  "$(gate "$(task_nomodel sonnetagent "[dispatch-class:1a]")")"
T="$WORK/table-with-sonnet.toml"
check "t2 MUTANT table naming sonnet admits it" allow "$(gate "$(task mutantonly sonnet "[dispatch-class:mutantonly] x")")"
T="$BASE_TABLE"

# ---- truth 3: critic/auditor below opus denied; adjudication never delegated ----
check "t3 critic on glm denied"             deny  "$(gate "$(task catalyst:critic glm-5.2 "[dispatch-class:critique] x")")"
check "t3 critic on opus allowed"           allow "$(gate "$(task catalyst:critic opus "[dispatch-class:critique] x")")"
check "t3 auditor on glm denied"            deny  "$(gate "$(task auditor glm-5.2 "[dispatch-class:audit] x")")"
check "t3 auditor on fable allowed"         allow "$(gate "$(task catalyst:auditor fable "[dispatch-class:audit] x")")"
check "t3 adjudicator never delegated"      deny  "$(gate "$(task adjudicator opus "[dispatch-class:adjudication] x")")"
# analysis floor (§2): diagnosis is never executor-class, whatever the vendor
check "t3 debug on glm denied (role)"       deny  "$(gate "$(task_nomodel debug-glm "[dispatch-class:analysis]")")"
check "t3 sleuth on grok allowed"           allow "$(gate "$(task_nomodel sleuth-grok "[dispatch-class:analysis]")")"
# kimi/grok/gpt were admitted into analysis by the user 2026-08-01. glm stays out
# (§2 keeps it and MiniMax away from diagnosis) — that is what debug-glm pins.
check "t3 analyzer on gpt allowed"          allow "$(gate "$(task_nomodel analyzer-gpt "[dispatch-class:analysis]")")"
check "t3 debug on kimi-k3 allowed"         allow "$(gate "$(task_nomodel debug-kimi "[dispatch-class:analysis]")")"
check "t3 principal-debugger on opus ok"    allow "$(gate "$(task principal-debugger opus "[dispatch-class:analysis] x")")"
check "t3 analyst on fable allowed"         allow "$(gate "$(task session-analyst fable "[dispatch-class:analysis] x")")"
# locate/execution paths must NOT be caught by the analysis patterns
check "t3 non-analysis role on grok ok"     allow "$(gate "$(task pinned1a grok-4.6 "[dispatch-class:1a] x")")"
T="$WORK/table-no-analysis-role.toml"
check "t3 MUTANT no-analysis lets glm"      allow "$(gate "$(task_nomodel debug-glm "[dispatch-class:1e]")")"
T="$BASE_TABLE"
# declared class tightens (D-02): opus is outside class 1a; typo'd class is loud
check "t3 class 1a rejects opus"            deny  "$(gate "$(task implementer opus "[dispatch-class:1a] fix")")"
check "t3 class 1a accepts grok"            allow "$(gate "$(task pinned1a grok-4.6 "[dispatch-class:1a] fix")")"
check "t3 unknown class marker is loud"     deny  "$(gate "$(task implementer opus "[dispatch-class:9z] fix")")"
# allowed lists carry MODEL names only: a vendor/channel name ("codex") would
# admit the literal string model="codex" AND bypass effort_required_for, which
# lists no such pattern. The real id is gpt-5.6-sol and needs an effort.
check "t3 vendor name is not a model"       deny  "$(gate "$(task implementer codex "[dispatch-class:1a] fix")")"
check "t3 vendor name denied in analysis"   deny  "$(gate "$(task debug-agent codex "[dispatch-class:analysis] x")")"
check "t3 real gpt id needs effort"         deny  "$(gate "$(task implementer gpt-5.6-sol "[dispatch-class:1a] fix")")"
check "t3 real gpt id with effort ok"       allow "$(gate "$(printf '{"tool_name":"Task","tool_input":{"subagent_type":"impl-gpt","prompt":"[dispatch-class:1b] fix"},"cwd":"%s"}' "$WORK/rw")")"

# ---- ratified-model registry: family patterns match by substring, so only an
# exact registered id may pass — an unmeasured variant is NOT the measured model
check "t6 luna outside its one class denied" deny "$(gate "$(task implementer gpt-5.6-luna "[dispatch-class:1a] fix")")"
check "t6 kimi-2.7 denied"                  deny  "$(gate "$(task implementer kimi-2.7 "[dispatch-class:1c] fix")")"
check "t6 opus-4.8 string denied"           deny  "$(gate "$(task catalyst:critic opus-4.8 "[dispatch-class:critique] x")")"
check "t6 garbage sharing a family denied"  deny  "$(gate "$(task catalyst:critic opusadjfhk "[dispatch-class:critique] x")")"
check "t6 unregistered model, no role"      deny  "$(gate "$(task implementer gpt-fictional "[dispatch-class:1a] x")")"
check "t6 registered opus alias allowed"    allow "$(gate "$(task catalyst:critic opus "[dispatch-class:critique] x")")"
check "t6 registered opus-5 id allowed"     allow "$(gate "$(task catalyst:critic 'claude-opus-5[1m]' "[dispatch-class:critique] x")")"
T="$WORK/table-no-models.toml"
check "t6 MUTANT empty case tables deny all" deny  "$(gate "$(task catalyst:critic opus "[dispatch-class:critique] x")")"
T="$BASE_TABLE"

# ---- Agent-channel effort: proxy models need explicit effort + accepted pins ----
check "ae glm without effort denied"        deny  "$(gate "$(task nomodel glm-5.3 "[dispatch-class:1e] x")")"
out=$(gate_out "$(task nomodel glm-5.3 "[dispatch-class:1e] x")")
case "$out" in *effort*) check "ae deny names effort" 0 0 ;; *) check "ae deny names effort" 0 1 ;; esac
check "ae anthropic model exempt"           allow "$(gate "$(task nomodel opus "[dispatch-class:1c] x")")"
check "ae frontmatter effort accepted"      allow "$(gate "$(task_nomodel withmodel "[dispatch-class:1e]")")"
check "ae invalid effort value denied"      deny  "$(gate "$(task_nomodel badeffort "[dispatch-class:1e]")")"
check "ae pin kimi-k3 at max denied"        deny  "$(gate "$(task_nomodel kimipin "[dispatch-class:1c]")")"
check "ae pin kimi-k3 at high allowed"      allow "$(gate "$(task_nomodel kimipinok "[dispatch-class:1c]")")"
check "ae pin gpt at medium denied"         deny  "$(gate "$(task_nomodel gptmedium "[dispatch-class:1b]")")"
check "ae pin grok below max denied"        deny  "$(gate "$(task kimipinok grok-4.6 "[dispatch-class:1a] x")")"
T="$WORK/table-no-agent-effort.toml"
check "ae MUTANT no-requirement table"      allow "$(gate "$(task nomodel glm-5.3 "[dispatch-class:1e] x")")"
T="$BASE_TABLE"

# ---- truth 12: a vendor CLI launched DIRECTLY (outside envoy) is the same
# channel — same models, same effort discipline; otherwise the whole table is
# one `codex exec` away from advisory ----
check "t12 direct codex without effort"     deny  "$(gate "$(bashcmd 'codex exec --model gpt-5.6-sol do-it')")"
check "t12 direct codex ratified ok"        allow "$(gate "$(bashcmd 'codex exec --model gpt-5.6-sol --effort high do-it [dispatch-class:1a]')")"
check "t12 direct codex unmeasured model"   deny  "$(gate "$(bashcmd 'codex exec --model gpt-5.6-luna --effort high do-it')")"
check "t12 direct codex naming no model"    deny  "$(gate "$(bashcmd 'codex exec --effort high do-it')")"
check "t12 kimi needs no effort flag"       allow "$(gate "$(bashcmd 'kimi --model kimi-k3 -p task [dispatch-class:1c]')")"
check "t12 kimi unmeasured sibling denied"  deny  "$(gate "$(bashcmd 'kimi --model kimi-k3-256k -p task')")"
check "t12 env prefix does not hide it"     deny  "$(gate "$(bashcmd 'RCH_ENABLED=0 codex exec --model gpt-5.6-sol do-it')")"
check "t12 vendor after && still caught"    deny  "$(gate "$(bashcmd 'cd /x && codex exec --model gpt-5.6-sol do-it')")"
# CLI ceilings are the vendor's own; [pins] are the Agent/proxy accepted efforts.
# Applying them here would deny a legitimate run (grok-CLI tops out at high).
check "t12 CLI does not inherit the pins"   allow "$(gate "$(bashcmd 'grok --model grok-4.6 --effort high go [dispatch-class:1a]')")"
# only the EXECUTABLE position counts — a substring rule would gate these
check "t12 vendor named as an argument"     allow "$(gate "$(bashcmd 'grep codex notes.md')")"
check "t12 vendor inside a pipe filter"     allow "$(gate "$(bashcmd 'ls -la | grep glm')")"
check "t12 script whose name contains it"   allow "$(gate "$(bashcmd './scripts/codex-helper.sh')")"
check "t12 interpreter running a file"      allow "$(gate "$(bashcmd 'python3 tools/grok.py')")"
sed '/^\[channels\.cli\.vendors\.codex\]/,/^model_required/d' "$BASE_TABLE" > "$WORK/table-no-cli-codex.toml"
T="$WORK/table-no-cli-codex.toml"
check "t12 MUTANT vendor gone from table"   allow "$(gate "$(bashcmd 'codex exec --model gpt-5.6-sol do-it')")"
T="$BASE_TABLE"
# The early-exit hint is a CODE constant (it must work with an unreadable table),
# so it can silently fall behind the table. Pin the two together.
hint=$(python3 -c 'import sys;sys.path.insert(0,"hooks");import importlib.util as u;s=u.spec_from_file_location("g","hooks/dispatch-gate.py");m=u.module_from_spec(s);s.loader.exec_module(m);print(" ".join(m.CLI_BIN_HINTS))')
tbl=$(python3 -c 'import tomllib;d=tomllib.load(open("hooks/routing-table.toml","rb"));v=d["channels"]["cli"]["vendors"];print(" ".join(sorted({b for n,c in v.items() for b in (c.get("bin") or [n])})))')
missing=""
for b in $tbl; do case " $hint " in *" $b "*) ;; *) missing="$missing $b" ;; esac; done
case "$missing" in '') check "t12 code hint covers every vendor" 0 0 ;; *) echo "  uncovered:$missing"; check "t12 code hint covers every vendor" 0 1 ;; esac

# ---- truth 13: the class marker is read exactly once and unambiguously ----
check "t13 uppercase marker accepted"       allow "$(gate "$(task implementer opus '[DISPATCH-CLASS:1C] x')")"
check "t13 same marker twice is fine"       allow "$(gate "$(task implementer opus '[dispatch-class:1c] x [dispatch-class:1c]')")"
check "t13 two different classes are loud"  deny  "$(gate "$(task implementer opus '[dispatch-class:1a] x [dispatch-class:1b]')")"
out=$(gate_out "$(task implementer opus '[dispatch-class:1a] x [dispatch-class:1b]')")
case "$out" in *1a*1b*) check "t13 ambiguity names both" 0 0 ;; *) check "t13 ambiguity names both" 0 1 ;; esac

# ---- truth 9: EVERY dispatch declares its class; a dispatch in no case at all
# would be governed by nothing, which is the hole the gate exists to close ----
check "t9 executor without marker denied"   deny  "$(gate "$(task implementer opus)")"
check "t9 critic without marker denied"     deny  "$(gate "$(task catalyst:critic opus)")"
check "t9 scout without marker denied"      deny  "$(gate "$(task catalyst:scout opus)")"
out=$(gate_out "$(task implementer opus)")
case "$out" in *dispatch-class*) check "t9 deny names the marker" 0 0 ;; *) check "t9 deny names the marker" 0 1 ;; esac
check "t9 marker with class ok"             allow "$(gate "$(task implementer opus "[dispatch-class:1c] x")")"
# name and declared class must agree: a critic under an executor class would
# otherwise buy the executor's wider model set
check "t9 critic under 1a denied"           deny  "$(gate "$(task catalyst:critic grok-4.6 "[dispatch-class:1a] x")")"
check "t9 scout under critique denied"      deny  "$(gate "$(task catalyst:scout opus "[dispatch-class:critique] x")")"
out=$(gate_out "$(task catalyst:critic grok-4.6 "[dispatch-class:1a] x")")
case "$out" in *critique*) check "t9 mismatch names the class" 0 0 ;; *) check "t9 mismatch names the class" 0 1 ;; esac
# no role matches "implementer", so no name/class disagreement can arise
check "t9 unnamed agent takes any class"    allow "$(gate "$(task implementer fable "[dispatch-class:critique] x")")"
check "t9 adjudication never delegated"     deny  "$(gate "$(task adjudicator opus "[dispatch-class:adjudication] x")")"
sed 's/^class_marker_required = true/class_marker_required = false/' "$BASE_TABLE" > "$WORK/table-no-marker-req.toml"
T="$WORK/table-no-marker-req.toml"
check "t9 MUTANT requirement off lets it"   allow "$(gate "$(task implementer opus)")"
T="$BASE_TABLE"

# ---- truth 10: the escape hatch — ONE parameter, for an unmeasured model ----
printf 'schema_version = 1\n[experiment]\nallow_all_models = true\n' > "$WORK/override-hatch.toml"
check "t10 unmeasured model denied by default" deny "$(gate "$(task implementer gpt-fictional "[dispatch-class:1a] x")")"
O="$WORK/override-hatch.toml"
check "t10 hatch admits unmeasured model"   warn "$(gate "$(task implementer gpt-fictional "[dispatch-class:1a] x")")"
check "t10 hatch lifts the class floor"     warn "$(gate "$(task catalyst:critic sonnet "[dispatch-class:critique] x")")"
# what the hatch must NOT do: it relaxes WHICH model, never whether a case may be
# delegated, nor the explicit model, nor the mandatory class declaration
check "t10 hatch keeps adjudication closed" deny  "$(gate "$(task adjudicator opus "[dispatch-class:adjudication] x")")"
check "t10 hatch keeps model explicit"      deny  "$(gate "$(task_nomodel nomodel "[dispatch-class:1a]")")"
check "t10 hatch keeps the marker required" deny  "$(gate "$(task implementer opus)")"
check "t10 hatch keeps role/class agreeing" deny  "$(gate "$(task catalyst:critic opus "[dispatch-class:1a] x")")"
slice_hatch=$(CATALYST_ROUTING_TABLE="$BASE_TABLE" CATALYST_ROUTING_OVERRIDE="$O" \
  CATALYST_ROUTING_PROJECT_OVERRIDE="$WORK/absent-override.toml" python3 "$GATE" --render-slice)
case "$slice_hatch" in *allow_all_models*) check "t10 slice announces the hatch" 0 0 ;; *) check "t10 slice announces the hatch" 0 1 ;; esac
O="$WORK/absent-override.toml"
case "$(CATALYST_ROUTING_TABLE="$BASE_TABLE" CATALYST_ROUTING_OVERRIDE="$O" \
  CATALYST_ROUTING_PROJECT_OVERRIDE="$WORK/absent-override.toml" python3 "$GATE" --render-slice)" in
  *allow_all_models*) check "t10 base ships the hatch off" 0 1 ;; *) check "t10 base ships the hatch off" 0 0 ;; esac

# ---- truth 11: override LAYERS — base < home < project, merging by entry ----
printf 'schema_version = 1\n[classes.1a]\nlabel = "x"\nallowed = ["opus"]\n' > "$WORK/override-home.toml"
printf 'schema_version = 1\n[classes.1a]\nlabel = "x"\nallowed = ["fable"]\n' > "$WORK/override-proj.toml"
O="$WORK/override-home.toml"
check "t11 home layer retunes a class"      allow "$(gate "$(task implementer opus "[dispatch-class:1a] x")")"
check "t11 home layer displaces the base"   deny  "$(gate "$(task pinned1a grok-4.6 "[dispatch-class:1a] x")")"
check "t11 unnamed entries survive a layer" allow "$(gate "$(task implementer opus "[dispatch-class:1c] x")")"
P="$WORK/override-proj.toml"
check "t11 project layer beats home"        allow "$(gate "$(task implementer fable "[dispatch-class:1a] x")")"
check "t11 project layer displaces home"    deny  "$(gate "$(task implementer opus "[dispatch-class:1a] x")")"
P="$WORK/absent-override.toml"
O="$WORK/absent-override.toml"
check "t11 layers gone, base governs again" allow "$(gate "$(task pinned1a grok-4.6 "[dispatch-class:1a] x")")"
# a project config is found by walking up from cwd, not only at the exact cwd
mkdir -p "$WORK/rw/.claude/catalyst" "$WORK/rw/deep/deeper"
printf 'schema_version = 1\n[classes.1a]\nlabel = "x"\nallowed = ["fable"]\n' > "$WORK/rw/.claude/catalyst/routing-override.toml"
found=$(printf '{"tool_name":"Task","tool_input":{"subagent_type":"implementer","model":"fable","prompt":"[dispatch-class:1a] x"},"cwd":"%s"}' "$WORK/rw/deep/deeper" \
  | env -u CLAUDE_PLUGIN_ROOT -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI HOME="$WORK/home" \
    CATALYST_ROUTING_TABLE="$BASE_TABLE" CATALYST_ROUTING_OVERRIDE="$WORK/absent-override.toml" \
    CATALYST_AGENT_DIRS="$WORK/agents" python3 "$GATE" 2>/dev/null)
case "$found" in '') check "t11 project config found up the tree" 0 0 ;; *) check "t11 project config found up the tree" 0 1 ;; esac
rm -rf "$WORK/rw/.claude" "$WORK/rw/deep"

# ---- truth 4: envoy/proxy without explicit effort denied where the table requires it ----
check "t4 envoy grok effortless denied"     deny  "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok do-thing')")"
check "t4 envoy grok with effort allowed"   allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok --effort high do-thing [dispatch-class:1a]')")"
check "t4 envoy default codex effortless"   deny  "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --cwd /x do-thing')")"
check "t4 envoy codex with effort allowed"  allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --effort xhigh do-thing [dispatch-class:1a]')")"
check "t4 envoy kimi needs no effort"       allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor kimi --write do-thing [dispatch-class:1c]')")"
check "t4 envoy non-task subcommand passes" allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs status')")"
check "t4 proxy without visible effort"     deny  "$(gate "$(bashcmd 'curl -s http://127.0.0.1:8317/v1/chat/completions -d @body.json')")"
check "t4 proxy with inline effort allowed" allow "$(gate "$(bashcmd 'curl -s http://127.0.0.1:8317/v1/chat/completions -d {\"model\":\"glm-5.3\",\"reasoning_effort\":\"max\"} [dispatch-class:1e]')")"
check "t4 proxy pin glm below max denied"   deny  "$(gate "$(bashcmd 'curl -s http://127.0.0.1:8317/v1/chat/completions -d {\"model\":\"glm-5.3\",\"reasoning_effort\":\"high\"}')")"
check "t4 proxy pin, shell-escaped quotes"  deny  "$(gate "$(bashcmd 'curl -s http://127.0.0.1:8317/v1/chat/completions -d {\\\"model\\\":\\\"kimi-k3\\\",\\\"reasoning_effort\\\":\\\"max\\\"}')")"
check "t4 proxy-critique pinned ok"         allow "$(gate "$(bashcmd 'proxy-critique.sh glm-5.3 max brief.md out.md a.rs [dispatch-class:critique]')")"
check "t4 proxy-critique pin violation"     deny  "$(gate "$(bashcmd 'proxy-critique.sh glm-5.3 high brief.md out.md a.rs')")"
check "t4 proxy-critique unreadable form"   deny  "$(gate "$(bashcmd 'bash proxy-critique.sh')")"
# MUTANT via override (also truth 10): grok freed from the effort requirement
printf 'schema_version = 1\n[channels.envoy]\n[channels.envoy.vendors.grok]\neffort_required = false\n' > "$WORK/override-grok-free.toml"
O="$WORK/override-grok-free.toml"
check "t4 MUTANT override frees grok"       allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok do-thing [dispatch-class:1a]')")"
O="$WORK/absent-override.toml"

# ---- truth 5: non-gated Bash passes untouched, before any table work ----
check "t5 plain bash passes"                allow "$(gate "$(bashcmd 'ls -la')")"
out=$(gate_out "$(bashcmd 'ls -la')")
check "t5 plain bash produces no output"    ""    "$out"
T="$WORK/does-not-exist.toml"
check "t5 broken table still passes bash"   allow "$(gate "$(bashcmd 'git status')")"
check "t5 broken table blocks gated bash"   deny  "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --effort high x')")"
T="$BASE_TABLE"

# ---- truth 6: missing/invalid/unknown-schema table -> dispatches blocked, cause named ----
T="$WORK/does-not-exist.toml"
check "t6 missing table blocks dispatch"    deny  "$(gate "$(task scout opus)")"
out=$(gate_out "$(task scout opus)")
case "$out" in *does-not-exist.toml*) check "t6 deny names the file" 0 0 ;; *) check "t6 deny names the file" 0 1 ;; esac
printf 'not = [valid toml\n' > "$WORK/garbage.toml"
T="$WORK/garbage.toml"
check "t6 invalid toml blocks dispatch"     deny  "$(gate "$(task scout opus)")"
printf 'schema_version = 99\n' > "$WORK/future-schema.toml"
T="$WORK/future-schema.toml"
check "t6 unknown schema blocks dispatch"   deny  "$(gate "$(task scout opus)")"
out=$(gate_out "$(task scout opus)")
case "$out" in *schema_version*) check "t6 deny names schema_version" 0 0 ;; *) check "t6 deny names schema_version" 0 1 ;; esac
grep -v '^schema_version' "$BASE_TABLE" > "$WORK/no-schema.toml"
T="$WORK/no-schema.toml"
check "t6 missing schema_version blocks"    deny  "$(gate "$(task scout opus)")"
T="$BASE_TABLE"
printf 'schema_version = 99\n' > "$WORK/override-bad.toml"
O="$WORK/override-bad.toml"
check "t6 bad override blocks dispatch"     deny  "$(gate "$(task scout opus)")"
O="$WORK/absent-override.toml"

# ---- truth 7: the SessionStart slice is rendered from the same table ----
slice=$(CATALYST_ROUTING_TABLE="$BASE_TABLE" CATALYST_ROUTING_OVERRIDE="$O" python3 "$GATE" --render-slice)
case "$slice" in *kimi-k3*)         check "t7 slice carries allowlists" 0 0 ;; *) check "t7 slice carries allowlists" 0 1 ;; esac
case "$slice" in *dispatch-class*)  check "t7 slice carries classes"    0 0 ;; *) check "t7 slice carries classes"    0 1 ;; esac
case "$slice" in *envoy*)           check "t7 slice carries channels"   0 0 ;; *) check "t7 slice carries channels"   0 1 ;; esac
slice_mut=$(CATALYST_ROUTING_TABLE="$WORK/table-with-sonnet.toml" CATALYST_ROUTING_OVERRIDE="$O" python3 "$GATE" --render-slice)
case "$slice_mut" in *sonnet*) check "t7 MUTANT slice follows the table" 0 0 ;; *) check "t7 MUTANT slice follows the table" 0 1 ;; esac
slice_broken=$(CATALYST_ROUTING_TABLE="$WORK/garbage.toml" CATALYST_ROUTING_OVERRIDE="$O" python3 "$GATE" --render-slice)
case "$slice_broken" in *BROKEN*) check "t7 broken table slice warns loudly" 0 0 ;; *) check "t7 broken table slice warns loudly" 0 1 ;; esac

# ---- truth 16: wave marker — form-only check, optional, one wave per dispatch ----
check "t16 valid wave marker passes"        allow "$(gate "$(task pinned1a grok-4.6 "[dispatch-class:1a] [wave:w13-critics 2/3] fix")")"
check "t16 verbatim repeat passes"          allow "$(gate "$(task pinned1a grok-4.6 "[dispatch-class:1a] [wave:w 1/2] fix per [wave:w 1/2]")")"
check "t16 half-parsed marker denied"       deny  "$(gate "$(task pinned1a grok-4.6 "[dispatch-class:1a] [wave:w13-critics] fix")")"
check "t16 k>N denied"                      deny  "$(gate "$(task pinned1a grok-4.6 "[dispatch-class:1a] [wave:w 3/2] fix")")"
check "t16 k=0 denied"                      deny  "$(gate "$(task pinned1a grok-4.6 "[dispatch-class:1a] [wave:w 0/3] fix")")"
check "t16 two different waves denied"      deny  "$(gate "$(task pinned1a grok-4.6 "[dispatch-class:1a] [wave:a 1/2] [wave:b 1/2] fix")")"
# truth 5 stays stronger: an unrecognized Bash command is never judged, wave garbage included
check "t16 plain bash with wave junk passes" allow "$(gate "$(bashcmd 'echo [wave:oops')")"
# vendor channel inherits the same single implementation
check "t16 envoy with bad wave denied"      deny  "$(gate "$(bashcmd 'node envoy-companion.mjs task --vendor grok --effort high \"[dispatch-class:1a] [wave:w 5/2] x\"')")"

# ---- truth 14: the shipped answer to a broken rule is a REFUSAL. Only the
# fleet observation ([stats], a different hook) is advisory — a rule about which
# model runs a case is binding, and only a deny makes it so. The warn mode
# exists, is not the default, and costs exactly that bindingness ----
check "t14 shipped mode blocks"             deny  "$(gate "$(task implementer opus)")"
check "t14 shipped blocks model out of class" deny "$(gate "$(task implementer opus "[dispatch-class:1a] x")")"
check "t14 shipped blocks unratified model" deny  "$(gate "$(task implementer gpt-5.6-luna "[dispatch-class:1a] x")")"
slice_deny=$(CATALYST_ROUTING_TABLE="$SHIPPED_TABLE" CATALYST_ROUTING_OVERRIDE="$O" \
  CATALYST_ROUTING_PROJECT_OVERRIDE="$WORK/absent-override.toml" python3 "$GATE" --render-slice)
case "$slice_deny" in *ОТКАЗ*) check "t14 slice says refusal" 0 0 ;; *) check "t14 slice says refusal" 0 1 ;; esac
T="$WORK/table-warn.toml"
check "t14 warn mode does not block"        warn  "$(gate "$(task implementer opus)")"
out=$(gate_out "$(task implementer opus)")
case "$out" in *systemMessage*) check "t14 warn is not a permission decision" 0 0 ;; *) check "t14 warn is not a permission decision" 0 1 ;; esac
case "$out" in *permissionDecision*) check "t14 warn grants no permission" 0 1 ;; *) check "t14 warn grants no permission" 0 0 ;; esac
case "$out" in *dispatch-class*) check "t14 warn still says what to fix" 0 0 ;; *) check "t14 warn still says what to fix" 0 1 ;; esac
check "t14 a clean dispatch stays silent"   allow "$(gate "$(task implementer opus "[dispatch-class:1c] x")")"
slice_warn=$(CATALYST_ROUTING_TABLE="$WORK/table-warn.toml" CATALYST_ROUTING_OVERRIDE="$O" \
  CATALYST_ROUTING_PROJECT_OVERRIDE="$WORK/absent-override.toml" python3 "$GATE" --render-slice)
case "$slice_warn" in *"НЕ блокирует"*) check "t14 warn slice states the mode" 0 0 ;; *) check "t14 warn slice states the mode" 0 1 ;; esac
case "$slice_warn" in *отказ*) check "t14 warn slice promises no deny" 0 1 ;; *) check "t14 warn slice promises no deny" 0 0 ;; esac
T="$BASE_TABLE"
# an unreadable table is not a routing choice — fail-closed in either mode
T="$WORK/garbage.toml"
check "t14 broken table blocks"             deny  "$(gate "$(task implementer opus "[dispatch-class:1c] x")")"
T="$BASE_TABLE"
# The shipped template must be a NO-OP: a user copies it, uncomments what they
# need, and an untouched copy must not silently change routing.
O="$ROOT/hooks/routing-override.template.toml"
check "t14 template is inert as override"   allow "$(gate "$(task implementer opus "[dispatch-class:1c] x")")"
check "t14 template keeps rules in force"   deny  "$(gate "$(task implementer opus)")"
O="$WORK/absent-override.toml"
# a hook must not litter bytecode into the plugin it reads
rm -rf "$ROOT/hooks/__pycache__"
printf '{"tool_name":"Task","tool_input":{"subagent_type":"x","model":"opus","prompt":"[dispatch-class:1b] t"},"session_id":"pyc","cwd":"%s"}' "$WORK/rw" \
  | env -u CLAUDE_PLUGIN_ROOT HOME="$WORK/home" CATALYST_ROUTING_TABLE="$BASE_TABLE" \
    CATALYST_ROUTING_OVERRIDE="$WORK/absent-override.toml" \
    CATALYST_ROUTING_PROJECT_OVERRIDE="$WORK/absent-override.toml" \
    python3 "$ROOT/hooks/dispatch-stats.py" >/dev/null 2>&1
[ -d "$ROOT/hooks/__pycache__" ] && check "t14 hooks leave no __pycache__" 0 1 || check "t14 hooks leave no __pycache__" 0 0

# ---- truth 8: a full run creates and modifies no files ----
cp "$BASE_TABLE" "$WORK/table-snapshot.toml"
before=$(find "$WORK/rw" "$WORK/home" | sort)
gate "$(task scout sonnet "[dispatch-class:scout] x")"                >/dev/null   # deny path
gate "$(task scout opus)"                  >/dev/null   # allow path
gate "$(bashcmd 'ls -la')"                 >/dev/null   # early-exit path
gate "$(bashcmd 'node /p/envoy-companion.mjs task x')" >/dev/null  # bash deny path
CATALYST_ROUTING_TABLE="$BASE_TABLE" CATALYST_ROUTING_OVERRIDE="$O" HOME="$WORK/home" \
  python3 "$GATE" --render-slice >/dev/null             # slice path
after=$(find "$WORK/rw" "$WORK/home" | sort)
check "t8 no files created or removed"      "$before" "$after"
cmp -s "$BASE_TABLE" "$WORK/table-snapshot.toml"
check "t8 table byte-identical after runs"  0 $?

# ---- truth 9: no Catalyst agent carries a banned model in its definition ----
if grep -Eq '^model:.*(sonnet|haiku|minimax)' "$ROOT"/agents/*.md; then
  check "t9 no banned model in agent frontmatter" 0 1
else
  check "t9 no banned model in agent frontmatter" 0 0
fi
if grep -q '^model:' "$ROOT/agents/envoy-runner.md"; then
  check "t9 envoy-runner carries no model field" 0 1
else
  check "t9 envoy-runner carries no model field" 0 0
fi

# ---- truth 15: the class marker binds the Bash dispatch channels too ----
# A vendor launched from Bash picks a model for a case exactly as an Agent call
# does, so it declares its case exactly as one. Before this the mandatory marker
# held only on Task/Agent — and the vendor path, where executor work actually
# goes, was declared by nothing (observed live: envoy dispatches recorded with
# class "?" while the table said the marker was required of every dispatch).
T="$SHIPPED_TABLE"; O="$WORK/absent-override.toml"
check "t15 envoy without marker"            deny  "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok --effort high do-thing')")"
out=$(gate_out "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok --effort high do-thing')")
case "$out" in *"declares no class"*) check "t15 envoy denial names the marker" 0 0 ;; *) check "t15 envoy denial names the marker" 0 1 ;; esac
check "t15 direct CLI without marker"       deny  "$(gate "$(bashcmd 'codex exec --model gpt-5.6-sol --effort high do-it')")"
out=$(gate_out "$(bashcmd 'codex exec --model gpt-5.6-sol --effort high do-it')")
case "$out" in *"declares no class"*) check "t15 CLI denial names the marker" 0 0 ;; *) check "t15 CLI denial names the marker" 0 1 ;; esac
check "t15 proxy POST without marker"       deny  "$(gate "$(bashcmd 'curl -s http://127.0.0.1:8317/v1/chat/completions -d {\"model\":\"glm-5.3\",\"reasoning_effort\":\"max\"}')")"
check "t15 proxy-critique without marker"   deny  "$(gate "$(bashcmd 'proxy-critique.sh glm-5.3 max brief.md out.md a.rs')")"
# The rule attaches to the dispatch channels, never to the shell at large.
check "t15 ordinary bash needs no marker"   allow "$(gate "$(bashcmd 'cargo test --lib')")"
check "t15 vendor word off exec position"   allow "$(gate "$(bashcmd 'grep codex notes.md')")"
# The declared case governs the named model on these channels as it does on Agent.
check "t15 CLI model outside its class"     deny  "$(gate "$(bashcmd 'codex exec --model gpt-5.6-sol --effort high do-it [dispatch-class:1c]')")"
out=$(gate_out "$(bashcmd 'codex exec --model gpt-5.6-sol --effort high do-it [dispatch-class:1c]')")
case "$out" in *"outside class '1c'"*) check "t15 CLI denial names the class" 0 0 ;; *) check "t15 CLI denial names the class" 0 1 ;; esac
check "t15 proxy model outside its class"   deny  "$(gate "$(bashcmd 'curl -s http://127.0.0.1:8317/v1/chat/completions -d {\"model\":\"glm-5.3\",\"reasoning_effort\":\"max\"} [dispatch-class:research]')")"
check "t15 proxy-critique outside class"    deny  "$(gate "$(bashcmd 'proxy-critique.sh glm-5.3 max brief.md out.md a.rs [dispatch-class:research]')")"
# Envoy names a vendor, never a model: the case is still checked for being
# delegable at all, which is what CAN be known from the command.
check "t15 envoy takes a delegable class"   allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok --effort high do-thing [dispatch-class:1a]')")"
check "t15 envoy non-delegable class"       deny  "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok --effort high do-thing [dispatch-class:adjudication]')")"
check "t15 unknown class id on bash"        deny  "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok --effort high do-thing [dispatch-class:nope]')")"
check "t15 two different markers on bash"   deny  "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok --effort high x [dispatch-class:1a] y [dispatch-class:1e]')")"
check "t15 same marker twice is one case"   allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok --effort high x [dispatch-class:1a] y [dispatch-class:1a]')")"
# MUTANT: the requirement lives in the table, not in the gate's code.
T="$WORK/table-no-marker-req.toml"
check "t15 MUTANT requirement off lets it"  allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok --effort high do-thing')")"
T="$SHIPPED_TABLE"

# ---- platform format + launcher sanity ----
out=$(printf '%s' "$(task scout sonnet "[dispatch-class:scout] x")" | env -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI \
      CLAUDE_PLUGIN_ROOT="$ROOT" HOME="$WORK/home" CATALYST_ROUTING_TABLE="$BASE_TABLE" \
      CATALYST_ROUTING_OVERRIDE="$O" CATALYST_AGENT_DIRS="$WORK/agents" python3 "$GATE")
case "$out" in *hookSpecificOutput*permissionDecision*) check "claude-format deny shape" 0 0 ;; *) check "claude-format deny shape" 0 1 ;; esac
out=$(printf '%s' "$(bashcmd 'ls -la')" | env -u CLAUDE_PLUGIN_ROOT -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI \
      HOME="$WORK/home" CATALYST_ROUTING_TABLE="$BASE_TABLE" CATALYST_ROUTING_OVERRIDE="$O" \
      CATALYST_AGENT_DIRS="$WORK/agents" bash "$LAUNCHER")
check "launcher passes plain bash"          ""    "$out"

# ---- truth 16: the class has a second, structured carrier ----
# A fork's prompt IS the directive handed to the forked self, so a marker there
# is instruction text the fork must then ignore. `dispatch_class` carries it out
# of band. It must behave exactly like the marker — including that two carriers
# disagreeing is an ambiguity, not a silent first-wins.
T="$BASE_TABLE"; O="$WORK/absent-override.toml"
task_dc() { # task_dc <subagent_type> <model> <dispatch_class> [prompt]
  printf '{"tool_name":"Task","tool_input":{"subagent_type":"%s","model":"%s","dispatch_class":"%s","prompt":"%s"},"cwd":"%s"}' \
    "$1" "$2" "$3" "${4:-x}" "$WORK/rw"
}
check "t16 field alone declares the class"  allow "$(gate "$(task_dc nomodel opus 1c)")"
check "t16 field agreeing with marker"      allow "$(gate "$(task_dc nomodel opus 1c "[dispatch-class:1c] x")")"
check "t16 field disagreeing with marker"   deny  "$(gate "$(task_dc nomodel opus 1c "[dispatch-class:1b] x")")"
check "t16 unknown class in the field"      deny  "$(gate "$(task_dc nomodel opus nosuchclass)")"
check "t16 field buys no wider model set"   deny  "$(gate "$(task_dc nomodel opus 1a)")"
check "t16 empty field is not a decl"       deny  "$(gate "$(task_dc nomodel opus '')")"

# ---- truth 17 ([limits]): potionbard quota check — last in the denial order,
# fail-open on a dead daemon, prefix-mapped pools codex/grok/kimi only ----
T="$BASE_TABLE"; O="$WORK/absent-override.toml"; P="$WORK/absent-override.toml"
lim_codex='codex exec --model gpt-5.6-sol --effort high do-it [dispatch-class:1a]'

pb_table codex=100
check "lim1 exhausted pool denied"           deny  "$(gate "$(bashcmd "$lim_codex")")"
out=$(gate_out "$(bashcmd "$lim_codex")")
case "$out" in *2099-*) check "lim1 deny carries resets_at" 0 0 ;; *) check "lim1 deny carries resets_at" 0 1 ;; esac

pb_table codex=85
check "lim2 85% warns, dispatch runs"        warn  "$(gate "$(bashcmd "$lim_codex")")"

pb_table codex=1
check "lim3 1% passes silently"              allow "$(gate "$(bashcmd "$lim_codex")")"

pb_saved_sock="$POTIONBAR_SOCKET"; export POTIONBAR_SOCKET="$WORK/absent.sock"
check "lim4 dead socket fail-opens"          warn  "$(gate "$(bashcmd "$lim_codex")")"
export POTIONBAR_SOCKET="$pb_saved_sock"

printf 'schema_version = 1\n[limits]\nenabled = false\n' > "$WORK/override-lim-off.toml"
pb_table codex=100
pb_n0=$(pb_count)
O="$WORK/override-lim-off.toml"
check "lim5 enabled=false passes"            allow "$(gate "$(bashcmd "$lim_codex")")"
check "lim5 enabled=false touches no socket" "$pb_n0" "$(pb_count)"
O="$WORK/absent-override.toml"

pb_table codex=1
pb_n0=$(pb_count)
check "lim6 glm model passes"                allow "$(gate "$(task_nomodel withmodel "[dispatch-class:1e]")")"
check "lim6 glm leaves the socket alone"     "$pb_n0" "$(pb_count)"

pb_table codex=0,100
check "lim7 windows are conjunctive"         deny  "$(gate "$(bashcmd "$lim_codex")")"

pb_table "codex=100;5"
check "lim8 accounts are alternatives"       allow "$(gate "$(bashcmd "$lim_codex")")"

pb_table codex=GARBAGE
check "lim9 garbage reply fail-opens"        warn  "$(gate "$(bashcmd "$lim_codex")")"

# the quota check is LAST: an effortless run is denied for effort, not quota
pb_table codex=100
out=$(gate_out "$(bashcmd 'codex exec --model gpt-5.6-sol do-it')")
case "$out" in *effort*) check "lim10 effort denial wins the order" 0 0 ;; *) check "lim10 effort denial wins the order" 0 1 ;; esac
case "$out" in *2099-*)  check "lim10 no quota talk there" 0 1 ;; *) check "lim10 no quota talk there" 0 0 ;; esac

printf 'schema_version = 1\n[limits]\ndeny_at = 100.1\n' > "$WORK/override-lim-mutant.toml"
O="$WORK/override-lim-mutant.toml"
# warn, not allow: 100% is still >= warn_at — but the DENY is gone, which is
# what proves the threshold lives in the table, not in the gate's code
check "lim11 MUTANT deny_at=100.1 flips"     warn  "$(gate "$(bashcmd "$lim_codex")")"
O="$WORK/absent-override.toml"

# unlisted gpt-* ids ride the "gpt-" prefix; glm-* match nothing
printf 'schema_version = 1\n[experiment]\nallow_all_models = true\n' > "$WORK/override-hatch2.toml"
O="$WORK/override-hatch2.toml"
pb_table codex=100
check "lim12 unlisted gpt id hits its pool"  deny  "$(gate "$(task implementer gpt-5.9-nova "[dispatch-class:1a] x")")"
check "lim12 daemon was asked for codex"     "REQ codex" "$(tail -n 1 "$PB_LOG")"
pb_n0=$(pb_count)
check "lim12 glm still unchecked"            warn  "$(gate "$(task_nomodel withmodel "[dispatch-class:1e]")")"
check "lim12 glm leaves the socket alone"    "$pb_n0" "$(pb_count)"
O="$WORK/absent-override.toml"

# longest prefix wins: luna pinned to kimicode over the family "gpt-" = codex
printf 'schema_version = 1\n[limits.models]\n"gpt-" = ["codex"]\n"gpt-5.6-luna" = ["kimicode"]\n' > "$WORK/override-lim-prefix.toml"
O="$WORK/override-lim-prefix.toml"
pb_table codex=1 kimicode=100
check "lim13 longest prefix reroutes luna"   deny  "$(gate "$(bashcmd 'codex exec --model gpt-5.6-luna --effort high x [dispatch-class:scout]')")"
check "lim13 daemon asked for kimicode"      "REQ kimicode" "$(tail -n 1 "$PB_LOG")"
check "lim13 sibling gpt goes to codex"      allow "$(gate "$(bashcmd "$lim_codex")")"
check "lim13 daemon asked for codex"         "REQ codex" "$(tail -n 1 "$PB_LOG")"
O="$WORK/absent-override.toml"

# a model may sit in several pools: deny only when EVERY pool is exhausted,
# and a pool that never answers BLOCKS the deny (fail-open, element-wise)
printf 'schema_version = 1\n[limits.models]\n"gpt-" = ["codex", "opencodegokey"]\n' > "$WORK/override-lim-multi.toml"
O="$WORK/override-lim-multi.toml"
pb_table codex=100 opencodegokey=5
check "lim14 live second pool admits"        allow "$(gate "$(bashcmd "$lim_codex")")"
pb_table codex=100 opencodegokey=100
check "lim15 all pools exhausted denies"     deny  "$(gate "$(bashcmd "$lim_codex")")"
out=$(gate_out "$(bashcmd "$lim_codex")")
case "$out" in *codex*opencodegokey*) check "lim15 deny names every pool" 0 0 ;; *) check "lim15 deny names every pool" 0 1 ;; esac
pb_table codex=100 opencodegokey=NOREPLY
check "lim16 silent pool blocks deny"        warn  "$(gate "$(bashcmd "$lim_codex")")"
out=$(gate_out "$(bashcmd "$lim_codex")")
case "$out" in *opencodegokey*) check "lim16 warn names the silent pool" 0 0 ;; *) check "lim16 warn names the silent pool" 0 1 ;; esac
O="$WORK/absent-override.toml"

echo "test-dispatch-gate: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
