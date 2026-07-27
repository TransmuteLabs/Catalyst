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
printf -- '---\nname: withmodel\ndescription: x\nmodel: glm-5.2\n---\nbody\n' > "$WORK/agents/withmodel.md"
printf -- '---\nname: sonnetagent\ndescription: x\nmodel: sonnet\n---\nbody\n'  > "$WORK/agents/sonnetagent.md"
printf -- '---\nname: nomodel\ndescription: x\n---\nbody\n'                     > "$WORK/agents/nomodel.md"
printf -- '---\nname: inheritagent\ndescription: x\nmodel: inherit\n---\nbody\n' > "$WORK/agents/inheritagent.md"

# Mutant table: the sonnet ban removed (everything else intact).
sed '/^\[bans\.sonnet\]/,/^reason/d' "$BASE_TABLE" > "$WORK/table-no-sonnet-ban.toml"

T="$BASE_TABLE"          # active base table for gate()
O="$WORK/absent-override.toml"  # absent by default — isolates from the user's real override

gate() { # gate <json> -> deny | allow | other:<out> ; also asserts exit 0
  local out rc
  out=$(printf '%s' "$1" | env -u CLAUDE_PLUGIN_ROOT -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI \
        HOME="$WORK/home" CATALYST_ROUTING_TABLE="$T" CATALYST_ROUTING_OVERRIDE="$O" \
        CATALYST_AGENT_DIRS="$WORK/agents" python3 "$GATE" 2>/dev/null)
  rc=$?
  if [ "$rc" -ne 0 ]; then echo "rc=$rc"; return; fi
  case "$out" in
    '') echo allow ;;
    *'"deny"'*) echo deny ;;
    *) echo "other:$out" ;;
  esac
}
gate_out() { # raw stdout
  printf '%s' "$1" | env -u CLAUDE_PLUGIN_ROOT -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI \
        HOME="$WORK/home" CATALYST_ROUTING_TABLE="$T" CATALYST_ROUTING_OVERRIDE="$O" \
        CATALYST_AGENT_DIRS="$WORK/agents" python3 "$GATE" 2>/dev/null
}
task() { # task <subagent_type> <model> [prompt]
  printf '{"tool_name":"Task","tool_input":{"subagent_type":"%s","model":"%s","prompt":"%s"},"cwd":"%s"}' \
    "$1" "$2" "${3:-x}" "$WORK/rw"
}
task_nomodel() { # no model field at all
  printf '{"tool_name":"Task","tool_input":{"subagent_type":"%s","prompt":"x"},"cwd":"%s"}' "$1" "$WORK/rw"
}
bashcmd() {
  printf '{"tool_name":"Bash","tool_input":{"command":"%s"},"cwd":"%s"}' "$1" "$WORK/rw"
}

# ---- truth 1: no effective model -> deny naming the field; frontmatter counts ----
check "t1 no model field denied"            deny  "$(gate "$(task_nomodel nomodel)")"
out=$(gate_out "$(task_nomodel nomodel)")
case "$out" in *model*) check "t1 deny names the missing field" 0 0 ;; *) check "t1 deny names the missing field" 0 1 ;; esac
check "t1 explicit model allowed"           allow "$(gate "$(task nomodel opus)")"
check "t1 frontmatter model resolves"       allow "$(gate "$(task_nomodel withmodel)")"
check "t1 frontmatter inherit = unset"      deny  "$(gate "$(task_nomodel inheritagent)")"
check "t1 unknown agent, no model"          deny  "$(gate "$(task_nomodel ghost-agent)")"

# ---- truth 2: sonnet/haiku banned everywhere, incl. via frontmatter ----
check "t2 sonnet in call denied"            deny  "$(gate "$(task scout sonnet)")"
check "t2 haiku in call denied"             deny  "$(gate "$(task scout claude-haiku-4-5)")"
check "t2 minimax in call denied"           deny  "$(gate "$(task scout MiniMax-M3)")"
check "t2 sonnet via frontmatter denied"    deny  "$(gate "$(task_nomodel sonnetagent)")"
T="$WORK/table-no-sonnet-ban.toml"
check "t2 MUTANT no-ban table lets sonnet"  allow "$(gate "$(task scout sonnet)")"
T="$BASE_TABLE"

# ---- truth 3: critic/auditor below opus denied; adjudication never delegated ----
check "t3 critic on glm denied"             deny  "$(gate "$(task catalyst:critic glm-5.2)")"
check "t3 critic on opus allowed"           allow "$(gate "$(task catalyst:critic opus)")"
check "t3 auditor on glm denied"            deny  "$(gate "$(task auditor glm-5.2)")"
check "t3 auditor on fable allowed"         allow "$(gate "$(task catalyst:auditor fable)")"
check "t3 adjudicator never delegated"      deny  "$(gate "$(task adjudicator opus)")"
# declared class tightens (D-02): opus is outside class 1a; typo'd class is loud
check "t3 class 1a rejects opus"            deny  "$(gate "$(task implementer opus "[dispatch-class:1a] fix")")"
check "t3 class 1a accepts grok"            allow "$(gate "$(task implementer grok-4.5 "[dispatch-class:1a] fix")")"
check "t3 unknown class marker is loud"     deny  "$(gate "$(task implementer opus "[dispatch-class:9z] fix")")"

# ---- truth 4: envoy/proxy without explicit effort denied where the table requires it ----
check "t4 envoy grok effortless denied"     deny  "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok do-thing')")"
check "t4 envoy grok with effort allowed"   allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok --effort high do-thing')")"
check "t4 envoy default codex effortless"   deny  "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --cwd /x do-thing')")"
check "t4 envoy codex with effort allowed"  allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --effort xhigh do-thing')")"
check "t4 envoy kimi needs no effort"       allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor kimi --write do-thing')")"
check "t4 envoy non-task subcommand passes" allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs status')")"
check "t4 proxy without visible effort"     deny  "$(gate "$(bashcmd 'curl -s http://127.0.0.1:8317/v1/chat/completions -d @body.json')")"
check "t4 proxy with inline effort allowed" allow "$(gate "$(bashcmd 'curl -s http://127.0.0.1:8317/v1/chat/completions -d {\"model\":\"glm-5.2\",\"reasoning_effort\":\"xhigh\"}')")"
check "t4 proxy pin glm below xhigh denied" deny  "$(gate "$(bashcmd 'curl -s http://127.0.0.1:8317/v1/chat/completions -d {\"model\":\"glm-5.2\",\"reasoning_effort\":\"high\"}')")"
check "t4 proxy pin, shell-escaped quotes"  deny  "$(gate "$(bashcmd 'curl -s http://127.0.0.1:8317/v1/chat/completions -d {\\\"model\\\":\\\"kimi-k3\\\",\\\"reasoning_effort\\\":\\\"max\\\"}')")"
check "t4 proxy-critique pinned ok"         allow "$(gate "$(bashcmd 'proxy-critique.sh glm-5.2 xhigh brief.md out.md a.rs')")"
check "t4 proxy-critique pin violation"     deny  "$(gate "$(bashcmd 'proxy-critique.sh glm-5.2 high brief.md out.md a.rs')")"
check "t4 proxy-critique unreadable form"   deny  "$(gate "$(bashcmd 'bash proxy-critique.sh')")"
# MUTANT via override (also truth 10): grok freed from the effort requirement
printf 'schema_version = 1\n[channels.envoy]\n[channels.envoy.vendors.grok]\neffort_required = false\n' > "$WORK/override-grok-free.toml"
O="$WORK/override-grok-free.toml"
check "t4 MUTANT override frees grok"       allow "$(gate "$(bashcmd 'node /p/envoy-companion.mjs task --vendor grok do-thing')")"
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
case "$slice" in *sonnet*)          check "t7 slice carries the ban"    0 0 ;; *) check "t7 slice carries the ban"    0 1 ;; esac
case "$slice" in *dispatch-class*)  check "t7 slice carries classes"    0 0 ;; *) check "t7 slice carries classes"    0 1 ;; esac
case "$slice" in *envoy*)           check "t7 slice carries channels"   0 0 ;; *) check "t7 slice carries channels"   0 1 ;; esac
slice_mut=$(CATALYST_ROUTING_TABLE="$WORK/table-no-sonnet-ban.toml" CATALYST_ROUTING_OVERRIDE="$O" python3 "$GATE" --render-slice)
case "$slice_mut" in *sonnet*) check "t7 MUTANT slice follows the table" 0 1 ;; *) check "t7 MUTANT slice follows the table" 0 0 ;; esac
slice_broken=$(CATALYST_ROUTING_TABLE="$WORK/garbage.toml" CATALYST_ROUTING_OVERRIDE="$O" python3 "$GATE" --render-slice)
case "$slice_broken" in *BROKEN*) check "t7 broken table slice warns loudly" 0 0 ;; *) check "t7 broken table slice warns loudly" 0 1 ;; esac

# ---- truth 8: a full run creates and modifies no files ----
cp "$BASE_TABLE" "$WORK/table-snapshot.toml"
before=$(find "$WORK/rw" "$WORK/home" | sort)
gate "$(task scout sonnet)"                >/dev/null   # deny path
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

# ---- platform format + launcher sanity ----
out=$(printf '%s' "$(task scout sonnet)" | env -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI \
      CLAUDE_PLUGIN_ROOT="$ROOT" HOME="$WORK/home" CATALYST_ROUTING_TABLE="$BASE_TABLE" \
      CATALYST_ROUTING_OVERRIDE="$O" CATALYST_AGENT_DIRS="$WORK/agents" python3 "$GATE")
case "$out" in *hookSpecificOutput*permissionDecision*) check "claude-format deny shape" 0 0 ;; *) check "claude-format deny shape" 0 1 ;; esac
out=$(printf '%s' "$(bashcmd 'ls -la')" | env -u CLAUDE_PLUGIN_ROOT -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI \
      HOME="$WORK/home" CATALYST_ROUTING_TABLE="$BASE_TABLE" CATALYST_ROUTING_OVERRIDE="$O" \
      CATALYST_AGENT_DIRS="$WORK/agents" bash "$LAUNCHER")
check "launcher passes plain bash"          ""    "$out"

echo "test-dispatch-gate: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
