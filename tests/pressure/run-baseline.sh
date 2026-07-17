#!/usr/bin/env bash
# RED baseline: fresh headless sessions WITHOUT the skill and WITHOUT the
# global CLAUDE.md.
#
# WARNING: this script temporarily renames ~/.claude/CLAUDE.md — while it runs,
# other FRESHLY-started Claude sessions lose global instructions (already
# running sessions are unaffected: the harness caches CLAUDE.md at startup —
# which is also why a baseline cannot be produced from within a running
# session; you need this script). Restoration is guaranteed by a trap even
# on failure.
#
# Every scenario runs in a neutral empty cwd.
# Usage: run-baseline.sh [scenario-name ...]   # no args = all from map.tsv
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/out/baseline-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
WORK=$(mktemp -d)  # parent; per-scenario subdirs — concurrent sessions must
                   # not share a cwd (cross-scenario contamination)
CM="$HOME/.claude/CLAUDE.md"
BK="$HOME/.claude/CLAUDE.md.pressure-baseline-backup"

restore() { if [ -f "$BK" ]; then mv "$BK" "$CM" && echo "[baseline] CLAUDE.md restored"; fi; }
trap restore EXIT INT TERM

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  while IFS=$'\t' read -r n _rest; do [ -n "$n" ] && names+=("$n"); done < "$HERE/map.tsv"
fi

[ -f "$CM" ] && mv "$CM" "$BK" && echo "[baseline] CLAUDE.md renamed"

for name in "${names[@]}"; do
  line=$(awk -F'\t' -v n="$name" '$1==n' "$HERE/map.tsv")
  [ -z "$line" ] && { echo "SKIP $name: not in map.tsv" >&2; continue; }
  model=$(printf '%s' "$line" | cut -f2)
  mkdir -p "$WORK/$name"
  ( cd "$WORK/$name" && claude -p "$(cat "$HERE/scenarios/$name.md")" --model "$model" \
      > "$OUT/$name.txt" 2> "$OUT/$name.err"
    echo "[baseline] $name done exit=$?" ) &
done
wait
restore
trap - EXIT INT TERM
rm -rf "$WORK" 2>/dev/null || true
echo "[baseline] outputs: $OUT"
