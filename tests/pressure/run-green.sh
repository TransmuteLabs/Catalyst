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
# Duplicate map keys would double-launch one identity — refuse the map.
dup_keys=$(cut -f1 "$HERE/map.tsv" | sort | uniq -d)
if [ -n "$dup_keys" ]; then
  echo "[green] map.tsv has duplicate scenario keys: $dup_keys — fix the map first" >&2
  exit 1
fi
# Duplicate selectors share one cwd and one output identity (two truncating
# redirects race) — deduplicate deterministically, keeping first occurrence.
deduped=()
for n in "${names[@]}"; do
  case " ${deduped[*]-} " in
    *" $n "*) echo "SKIP duplicate selector: $n" >&2 ;;
    *) deduped+=("$n") ;;
  esac
done
names=("${deduped[@]}")

# Bounded worker pool: an unthrottled no-args run launches every mapped
# session at once and the resulting process/API burst produces its own
# failures (429s, kills) that read as broken runs.
# PRESSURE_MAX_PAR is VALIDATED before any launch: 0/negative/nonnumeric
# would either wedge the pool forever (the guard never opens) or silently
# disable it (a nonnumeric -ge errors false → unbounded burst).
case "${PRESSURE_MAX_PAR:-4}" in
  ''|*[!0-9]*) echo "[green] invalid PRESSURE_MAX_PAR='${PRESSURE_MAX_PAR:-}' — using 4" >&2; MAX_PAR=4 ;;
  0) echo "[green] PRESSURE_MAX_PAR=0 would never launch — using 4" >&2; MAX_PAR=4 ;;
  *) MAX_PAR="${PRESSURE_MAX_PAR:-4}"
     if [ "$MAX_PAR" -gt 32 ]; then echo "[green] capping PRESSURE_MAX_PAR at 32" >&2; MAX_PAR=32; fi ;;
esac
# Per-scenario wall-clock timeout: a hung session must not starve the pool
# and stall `wait` forever.
case "${PRESSURE_SCENARIO_TIMEOUT_S:-1800}" in
  ''|0|*[!0-9]*) echo "[green] invalid PRESSURE_SCENARIO_TIMEOUT_S — using 1800" >&2; TIMEOUT_S=1800 ;;
  *) TIMEOUT_S="${PRESSURE_SCENARIO_TIMEOUT_S:-1800}" ;;
esac
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
  # argv preflight: the prompt travels as ONE exec argument; past the argv
  # budget execve fails before the session reads anything.
  if [ "${#prompt}" -gt 400000 ]; then
    echo "SKIP $name: prompt ${#prompt} bytes exceeds the argv budget" >&2
    printf 'exit: oversize\n' > "$OUT/$name.status"
    continue
  fi
  mkdir -p "$WORK/$name"
  ( cd "$WORK/$name" || exit 1
    ec=0
    claude -p "$prompt" --model "$model" > "$OUT/$name.txt" 2> "$OUT/$name.err" & cpid=$!
    # Watchdog: TERM at the deadline, KILL after a grace period.
    ( t=0
      while kill -0 "$cpid" 2>/dev/null && [ "$t" -lt "$TIMEOUT_S" ]; do sleep 5; t=$((t+5)); done
      if kill -0 "$cpid" 2>/dev/null; then
        echo "timeout: ${TIMEOUT_S}s" > "$OUT/$name.timeout"
        kill -TERM "$cpid" 2>/dev/null; sleep 5; kill -KILL "$cpid" 2>/dev/null
      fi ) & wpid=$!
    wait "$cpid" || ec=$?
    kill "$wpid" 2>/dev/null || true
    # Durable per-scenario status: the console echo does not survive the
    # run, and a plausible-but-truncated output whose nonzero exit was lost
    # would be scored as a completed answer instead of a broken run.
    { echo "exit: $ec"
      if [ -f "$OUT/$name.timeout" ]; then cat "$OUT/$name.timeout"; fi
      echo "utc_end: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$OUT/$name.status"
    echo "[green] $name done exit=$ec" ) &
done
wait
rm -rf "$WORK" 2>/dev/null || true
# Aggregate durable statuses into the MANIFEST; a broken execution makes the
# whole run exit nonzero (individual outputs are all preserved).
broken=0
for st in "$OUT"/*.status; do
  [ -f "$st" ] || continue
  sn=$(basename "$st" .status)
  sec=$(sed -n 's/^exit: //p' "$st" | head -1)
  flag=""; if [ -f "$OUT/$sn.timeout" ]; then flag=" timeout"; fi
  echo "result $sn exit ${sec:-unknown}$flag" >> "$OUT/MANIFEST.txt"
  [ "${sec:-broken}" = "0" ] || broken=1
done
echo "[green] outputs: $OUT"
echo "[green] Score manually per tests/README.md (letter + for critic-form: paraphrase-suppression check)."
if [ "$broken" -ne 0 ]; then
  echo "[green] one or more scenarios exited nonzero / timed out / were skipped — see the MANIFEST result lines" >&2
  exit 1
fi
