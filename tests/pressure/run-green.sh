#!/usr/bin/env bash
# GREEN run: fresh headless sessions WITH the instruction to read the skill.
# Never touches CLAUDE.md. Every scenario runs in a neutral cwd
# (lesson from the 2026-07-16 campaign: an agent started inside the harness
# directory found the scenario files and analyzed the test instead of playing
# the role).
#
# Usage: run-green.sh [scenario-name ...]   # no args = all from map.tsv
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
FAMILY=$(cd "$HERE/../.." && pwd)
OUT="$HERE/out/green-$(date -u +%Y%m%d-%H%M%S)Z"
# Identity must be unique (two same-second runs previously shared a dir via
# mkdir -p and mixed/overwrote outputs) — on collision, suffix the pid.
if ! mkdir "$OUT" 2>/dev/null; then
  OUT="$OUT-$$"
  mkdir "$OUT"
fi
# Bind the run to the exact revision it proves (a newer-by-timestamp run from
# another branch/dirty tree must not pass as evidence for this edit).
{
  echo "head: $(git -C "$FAMILY" rev-parse HEAD 2>/dev/null || echo no-git)"
  echo "dirty: $(git -C "$FAMILY" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  echo "map_sha256: $(shasum -a 256 "$HERE/map.tsv" | cut -d' ' -f1)"
  echo "cli: $(claude --version 2>/dev/null | head -1 || echo unknown)"
  echo "utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$OUT/MANIFEST.txt"
WORK=$(mktemp -d)  # parent; each scenario gets its own subdir — concurrent
                   # sessions must not share a cwd (an agent materializing an
                   # artifact as a file would contaminate every sibling's
                   # "empty" cwd — the cross-scenario variant of the
                   # neutral-cwd lesson above)

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  while IFS=$'\t' read -r n _rest; do [ -n "$n" ] && names+=("$n"); done < "$HERE/map.tsv"
fi

# Bounded worker pool: an unthrottled no-args run launches every mapped
# session at once and the resulting process/API burst produces its own
# failures (429s, kills) that read as broken runs.
MAX_PAR="${PRESSURE_MAX_PAR:-4}"
for name in "${names[@]}"; do
  line=$(awk -F'\t' -v n="$name" '$1==n' "$HERE/map.tsv")
  [ -z "$line" ] && { echo "SKIP $name: not in map.tsv" >&2; continue; }
  [ -f "$HERE/scenarios/$name.md" ] || { echo "SKIP $name: scenario file missing" >&2; continue; }
  model=$(printf '%s' "$line" | cut -f2)
  echo "scenario $name model $model sha256 $(shasum -a 256 "$HERE/scenarios/$name.md" | cut -d' ' -f1)" >> "$OUT/MANIFEST.txt"
  while [ "$(jobs -pr | wc -l | tr -d ' ')" -ge "$MAX_PAR" ]; do sleep 1; done
  skills=$(printf '%s' "$line" | cut -f3- | tr '\t' '\n')
  preamble="Your process is governed by a skill. Read these files FIRST — actually open and read them with your file tools before answering; an answer that does not engage their text is invalid and will be discarded. Only your FINAL message is recorded: it must contain the complete deliverable in full (the chosen letter, every message/artifact the scenario asks you to write out, and the justification) — restate everything even if you already said it in an earlier turn; a final message that defers to an earlier turn is discarded as no answer:"
  while read -r rel; do [ -n "$rel" ] && preamble+=$'\n'"- $FAMILY/$rel"; done <<< "$skills"
  prompt="$preamble

$(cat "$HERE/scenarios/$name.md")"
  mkdir -p "$WORK/$name"
  ( cd "$WORK/$name" || exit 1
    ec=0
    claude -p "$prompt" --model "$model" > "$OUT/$name.txt" 2> "$OUT/$name.err" || ec=$?
    # `|| ec=$?` keeps the report line alive under set -e (a bare failing
    # command would abort the subshell before the echo — silent failures)
    echo "[green] $name done exit=$ec" ) &
done
wait
rm -rf "$WORK" 2>/dev/null || true
echo "[green] outputs: $OUT"
echo "[green] Score manually per tests/README.md (letter + for critic-form: paraphrase-suppression check)."
