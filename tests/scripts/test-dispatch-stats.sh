#!/usr/bin/env bash
# Behaviour tests for hooks/dispatch-stats.py — fleet bookkeeping and the
# monoculture nudge. Same shape as test-dispatch-gate.sh: exercise the hook
# through its real stdin contract, and pin every rule with a mutant table so a
# green run proves the rule lives in the table rather than in the code.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$ROOT/hooks/dispatch-stats.py"
BASE_TABLE="$ROOT/hooks/routing-table.toml"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
check() {
  if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1: expected [$2], got [$3]"; fi
}

T="$BASE_TABLE"
SES="s1"
fresh() { SES="$1"; rm -rf "$WORK/home"; mkdir -p "$WORK/home"; }

# Proxy models need their pinned effort, or the dispatch is a GATE breach and
# (in warn mode) the recorder carries it into the output — entangling these
# tests with the gate's rules instead of testing the fleet view.
effort_for() {
  case "$1" in
    glm-5.2)     echo xhigh ;;
    kimi-k3)     echo high ;;
    grok-4.5)    echo max ;;
    gpt-5.6-sol) echo high ;;
    MiniMax-M3)  echo high ;;
    *)           echo "" ;;
  esac
}
send() { # send <subagent> <model> <class> -> stdout of the hook
  printf '{"tool_name":"Task","tool_input":{"subagent_type":"%s","model":"%s","effort":"%s","prompt":"[dispatch-class:%s] t"},"session_id":"%s","cwd":"%s"}' \
    "$1" "$2" "$(effort_for "$2")" "$3" "$SES" "$WORK" \
  | env -u CLAUDE_PLUGIN_ROOT -u COPILOT_CLI HOME="$WORK/home" \
      CATALYST_ROUTING_TABLE="$T" CATALYST_ROUTING_OVERRIDE="$WORK/absent.toml" \
      CATALYST_ROUTING_PROJECT_OVERRIDE="$WORK/absent.toml" python3 "$HOOK" 2>/dev/null
}
sendbash() { # sendbash <command>
  printf '{"tool_name":"Bash","tool_input":{"command":"%s"},"session_id":"%s","cwd":"%s"}' "$1" "$SES" "$WORK" \
  | env -u CLAUDE_PLUGIN_ROOT -u COPILOT_CLI HOME="$WORK/home" \
      CATALYST_ROUTING_TABLE="$T" CATALYST_ROUTING_OVERRIDE="$WORK/absent.toml" \
      CATALYST_ROUTING_PROJECT_OVERRIDE="$WORK/absent.toml" python3 "$HOOK" 2>/dev/null
}
report() {
  env -u CLAUDE_PLUGIN_ROOT HOME="$WORK/home" CATALYST_ROUTING_TABLE="$T" \
      CATALYST_ROUTING_OVERRIDE="$WORK/absent.toml" python3 "$HOOK" --report "$SES" 2>/dev/null
}
spam() { # spam <n> <model> <class> -> concatenated output
  local i=1; local out=""
  while [ "$i" -le "$1" ]; do out="$out$(send implementer "$2" "$3")"; i=$((i+1)); done
  printf '%s' "$out"
}

# ---- 1: a monoculture run is noticed, and the nudge is concrete ----
fresh mono
out=$(spam 8 opus 1b)
case "$out" in *DISPATCH-FLEET*) check "s1 monoculture nudges"        0 0 ;; *) check "s1 monoculture nudges"        0 1 ;; esac
case "$out" in *opus*)           check "s1 nudge names the model"     0 0 ;; *) check "s1 nudge names the model"     0 1 ;; esac
case "$out" in *1a*)             check "s1 nudge names unused class"  0 0 ;; *) check "s1 nudge names unused class"  0 1 ;; esac
case "$out" in *grok*)           check "s1 nudge names its models"    0 0 ;; *) check "s1 nudge names its models"    0 1 ;; esac

# ---- 2: a fleet that IS being used stays silent — the nudge must not be noise ----
fresh div
out=$(send implementer opus 1b)$(send a grok-4.5 1a)$(send b glm-5.2 1e)$(send catalyst:critic fable critique)
out="$out$(send c kimi-k3 1c)$(send d gpt-5.6-sol 1a)$(send catalyst:auditor opus audit)$(send e glm-5.2 1e)"
case "$out" in '') check "s2 diverse run is silent" 0 0 ;; *) check "s2 diverse run is silent" 0 1 ;; esac

# ---- 3: throttled — one nudge per remind_every, not one per dispatch ----
fresh throttle
out=$(spam 16 opus 1b)
n=$(printf '%s' "$out" | grep -o '</DISPATCH-FLEET>' | wc -l | tr -d ' ')
# both brakes are in force: the clock one caps a burst at a single nudge
check "s3 one nudge in a burst of 16" 1 "$n"

# ---- 4: quiet below min_dispatches — no verdict from too little data ----
fresh few
out=$(spam 5 opus 1b)
case "$out" in '') check "s4 quiet below the minimum" 0 0 ;; *) check "s4 quiet below the minimum" 0 1 ;; esac

# ---- 5: the thresholds are TABLE data, not code ----
sed 's/^enabled = true/enabled = false/' "$BASE_TABLE" > "$WORK/table-stats-off.toml"
T="$WORK/table-stats-off.toml"; fresh off
out=$(spam 12 opus 1b)
case "$out" in '') check "s5 MUTANT disabled in table" 0 0 ;; *) check "s5 MUTANT disabled in table" 0 1 ;; esac
sed 's/^min_dispatches = 6/min_dispatches = 99/' "$BASE_TABLE" > "$WORK/table-stats-high.toml"
T="$WORK/table-stats-high.toml"; fresh high
out=$(spam 12 opus 1b)
case "$out" in '') check "s5 MUTANT minimum raised" 0 0 ;; *) check "s5 MUTANT minimum raised" 0 1 ;; esac
T="$BASE_TABLE"

# ---- 6: Bash channels count too — the fleet is not only the Agent tool ----
fresh bash
sendbash 'codex exec --model gpt-5.6-sol --effort high go' >/dev/null
sendbash 'node envoy-companion.mjs task --vendor kimi --effort high go' >/dev/null
rep=$(report)
case "$rep" in *gpt-5.6-sol*) check "s6 direct CLI recorded"  0 0 ;; *) check "s6 direct CLI recorded"  0 1 ;; esac
case "$rep" in *kimi*)        check "s6 envoy run recorded"   0 0 ;; *) check "s6 envoy run recorded"   0 1 ;; esac
case "$rep" in *cli*)         check "s6 channel recorded"     0 0 ;; *) check "s6 channel recorded"     0 1 ;; esac

# ---- 9: coverage — dominance alone is blind to a two-model rotation ----
fresh rot
out=$(send a opus 1b)$(send b fable critique)$(send c opus 1b)$(send d fable critique)
out="$out$(send e opus 1b)$(send f fable critique)$(send g opus 1b)$(send h fable critique)"
case "$out" in *DISPATCH-FLEET*) check "s9 two-model rotation caught" 0 0 ;; *) check "s9 two-model rotation caught" 0 1 ;; esac
case "$out" in *grok-4.5*)        check "s9 names the idle models"   0 0 ;; *) check "s9 names the idle models"   0 1 ;; esac

# ---- 10: one model under two ids is one model, not fleet diversity ----
fresh alias
out=$(spam 4 opus 1b)$(spam 4 'claude-opus-5[1m]' 1b)
case "$out" in *"на одну модель"*) check "s10 alias collapses for counting" 0 0 ;; *) check "s10 alias collapses for counting" 0 1 ;; esac
rep=$(report)
case "$rep" in *"claude-opus-5"*) check "s10 report shows one name" 0 1 ;; *) check "s10 report shows one name" 0 0 ;; esac

# ---- 11: the verdict is passed on the RECENT slice, not a week of history ----
fresh stale
spam 8 opus 1b >/dev/null                    # spends the cooldown too
python3 - "$WORK/home/.claude/catalyst/stats/stale.json" <<'EOF'
import json, sys, time
p = sys.argv[1]
st = json.load(open(p))
old = int(time.time()) - 7 * 86400           # a week-long session
for e in st["entries"]:
    e["t"] = old
st["reminded_at"] = 0
st["reminded_t"] = 0
json.dump(st, open(p, "w"))
EOF
out=$(spam 5 grok-4.5 1a)
case "$out" in '') check "s11 stale history does not judge" 0 0 ;; *) check "s11 stale history does not judge" 0 1 ;; esac
rep=$(report)
case "$rep" in *cumulative*) check "s11 report keeps cumulative" 0 0 ;; *) check "s11 report keeps cumulative" 0 1 ;; esac
case "$rep" in *"last 30 min"*) check "s11 report has recent block" 0 0 ;; *) check "s11 report has recent block" 0 1 ;; esac

# ---- 12: the clock brake — not more than one nudge per cooldown ----
fresh clock
out=$(spam 24 opus 1b)
n=$(printf '%s' "$out" | grep -o '</DISPATCH-FLEET>' | wc -l | tr -d ' ')
check "s12 one nudge per cooldown" 1 "$n"

# ---- 13: deliberate concentration is a decision, not a lapse ----
sed 's/^deliberate_model = ""/deliberate_model = "opus"/' "$BASE_TABLE" > "$WORK/table-pinned.toml"
T="$WORK/table-pinned.toml"; fresh pinned
out=$(spam 10 opus 1b)
case "$out" in '') check "s13 pinned model silences the fleet nudge" 0 0 ;; *) check "s13 pinned model silences the fleet nudge" 0 1 ;; esac
T="$BASE_TABLE"

# ---- 14: in warn mode the gate's breach must reach the MODEL, or the reminder
# only ever lands in the user's terminal and the next dispatch repeats it ----
sed 's/^mode = "deny"/mode = "warn"/' "$BASE_TABLE" > "$WORK/table-warn.toml"
T="$WORK/table-warn.toml"; fresh breach
out=$(printf '{"tool_name":"Task","tool_input":{"subagent_type":"implementer","model":"opus","prompt":"no marker"},"session_id":"breach","cwd":"%s"}' "$WORK" \
  | env -u CLAUDE_PLUGIN_ROOT -u COPILOT_CLI HOME="$WORK/home" \
      CATALYST_ROUTING_TABLE="$T" CATALYST_ROUTING_OVERRIDE="$WORK/absent.toml" \
      CATALYST_ROUTING_PROJECT_OVERRIDE="$WORK/absent.toml" python3 "$HOOK" 2>/dev/null)
case "$out" in *dispatch-class*) check "s14 warn breach carried to context" 0 0 ;; *) check "s14 warn breach carried to context" 0 1 ;; esac
T="$BASE_TABLE"; fresh breachdeny   # shipped mode: the gate already stopped it
out=$(printf '{"tool_name":"Task","tool_input":{"subagent_type":"implementer","model":"opus","prompt":"no marker"},"session_id":"breachdeny","cwd":"%s"}' "$WORK" \
  | env -u CLAUDE_PLUGIN_ROOT -u COPILOT_CLI HOME="$WORK/home" \
      CATALYST_ROUTING_TABLE="$T" CATALYST_ROUTING_OVERRIDE="$WORK/absent.toml" \
      CATALYST_ROUTING_PROJECT_OVERRIDE="$WORK/absent.toml" python3 "$HOOK" 2>/dev/null)
case "$out" in '') check "s14 deny mode adds no duplicate" 0 0 ;; *) check "s14 deny mode adds no duplicate" 0 1 ;; esac
T="$BASE_TABLE"

# ---- 7: bookkeeping never breaks the tool call it follows ----
fresh robust
out=$(printf 'not json at all' | env -u CLAUDE_PLUGIN_ROOT HOME="$WORK/home" \
  CATALYST_ROUTING_TABLE="$T" CATALYST_ROUTING_OVERRIDE="$WORK/absent.toml" python3 "$HOOK" 2>&1; echo "rc=$?")
check "s7 garbage input exits clean" "rc=0" "$out"
out=$(printf '{"tool_name":"Read","tool_input":{"file_path":"/x"},"session_id":"robust"}' \
  | env -u CLAUDE_PLUGIN_ROOT HOME="$WORK/home" CATALYST_ROUTING_TABLE="$T" \
    CATALYST_ROUTING_OVERRIDE="$WORK/absent.toml" python3 "$HOOK" 2>&1; echo "rc=$?")
check "s7 non-dispatch tool ignored"  "rc=0" "$out"
out=$(printf '{"tool_name":"Task","tool_input":{"model":"opus","prompt":"x"},"session_id":"robust"}' \
  | env -u CLAUDE_PLUGIN_ROOT HOME="$WORK/home" CATALYST_ROUTING_TABLE="$WORK/missing.toml" \
    CATALYST_ROUTING_OVERRIDE="$WORK/absent.toml" python3 "$HOOK" 2>&1; echo "rc=$?")
check "s7 broken table exits clean"   "rc=0" "$out"

# ---- 8: writes stay inside the stats directory ----
fresh scoped
before=$(find "$WORK/home" | sort)
spam 3 opus 1b >/dev/null
after=$(find "$WORK/home" | sort)
# the stats dir and the ancestors it needs are the sanctioned writes
new=$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") \
      | grep -vE '/\.claude(/catalyst(/stats(/.*)?)?)?$' || true)
case "$new" in '') check "s8 writes only under stats/" 0 0 ;; *) echo "  stray:$new"; check "s8 writes only under stats/" 0 1 ;; esac

echo "test-dispatch-stats: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
