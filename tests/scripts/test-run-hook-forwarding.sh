#!/usr/bin/env bash
# run-hook.cmd version forwarding: a versioned cache entry point must execute
# the NEWEST installed version's hooks (live sessions bind CLAUDE_PLUGIN_ROOT
# once, at session start — incident 2026-08-19: a gate shipped in an update did
# not guard dispatches from sessions still bound to the previous version).
# Rows assert: the forward happens, the loop guard holds, a dev checkout and a
# missing target never forward.
set -u

# CONSTRAINT: ожидаемое число рядов объявлено ЗДЕСЬ и больше нигде. Стенд
# печатает фактически прогнанное, и расхождение в ЛЮБУЮ сторону -- КРАСНЫЙ, а не
# «НЕ ИЗМЕРЕНО»: ряд, тихо выпавший из прогона (ранний выход, потерянный вызов),
# неотличим от ряда, которого никогда не писали. Код 1, а не 3, выбран замером
# агрегатора: `tests/run-all.sh` считает НЕ ИЗМЕРЕНО отдельной категорией, и
# дверь приёмки на ней НЕ краснеет -- пин с кодом 3 был бы декоративным.
EXPECTED_ROWS=5

HOOKS_DIR="$(cd "$(dirname "$0")/../../hooks" && pwd)"
FAILS=0
ROWS=0

row() { # label expected actual
  ROWS=$((ROWS + 1))
  if [ "$2" != "$3" ]; then
    echo "FAIL: $1: expected '$2', got '$3'"
    FAILS=$((FAILS + 1))
  fi
}

WORK="$(mktemp -d /tmp/runhook-fwd.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# Fake cache: catalyst/<ver>/hooks with a probe that names its home version.
for ver in 0.0.1 0.0.10 0.0.2; do
  mkdir -p "$WORK/cache/catalyst/$ver/hooks"
  cp "$HOOKS_DIR/run-hook.cmd" "$WORK/cache/catalyst/$ver/hooks/run-hook.cmd"
  printf '#!/usr/bin/env bash\necho "probe-from=%s"\n' "$ver" \
    > "$WORK/cache/catalyst/$ver/hooks/probe"
done

# 1. An old entry point forwards to the numerically newest version
#    (0.0.10 > 0.0.2 — numeric per-component order, not lexicographic).
OUT="$(env -u CATALYST_HOOK_FORWARDED bash "$WORK/cache/catalyst/0.0.1/hooks/run-hook.cmd" probe)"
row "old entry forwards to newest" "probe-from=0.0.10" "$OUT"

# 2. The newest entry point runs its own copy (no self-forward loop).
OUT="$(env -u CATALYST_HOOK_FORWARDED bash "$WORK/cache/catalyst/0.0.10/hooks/run-hook.cmd" probe)"
row "newest entry runs itself" "probe-from=0.0.10" "$OUT"

# 3. The loop guard: an already-forwarded call never forwards again.
OUT="$(CATALYST_HOOK_FORWARDED=1 bash "$WORK/cache/catalyst/0.0.1/hooks/run-hook.cmd" probe)"
row "forwarded call stays home" "probe-from=0.0.1" "$OUT"

# 4. A dev checkout (parent dir is not x.y.z) never forwards.
mkdir -p "$WORK/checkout/hooks" "$WORK/checkout-sibling"
cp "$HOOKS_DIR/run-hook.cmd" "$WORK/checkout/hooks/run-hook.cmd"
printf '#!/usr/bin/env bash\necho "probe-from=checkout"\n' > "$WORK/checkout/hooks/probe"
OUT="$(env -u CATALYST_HOOK_FORWARDED bash "$WORK/checkout/hooks/run-hook.cmd" probe)"
row "dev checkout stays home" "probe-from=checkout" "$OUT"

# 5. A newest version that lacks the requested script falls through to home.
mkdir -p "$WORK/cache/catalyst/0.0.11/hooks"
cp "$HOOKS_DIR/run-hook.cmd" "$WORK/cache/catalyst/0.0.11/hooks/run-hook.cmd"
OUT="$(env -u CATALYST_HOOK_FORWARDED bash "$WORK/cache/catalyst/0.0.1/hooks/run-hook.cmd" probe)"
row "missing target script falls through" "probe-from=0.0.1" "$OUT"

if [ "$ROWS" -ne "$EXPECTED_ROWS" ]; then
  echo "test-run-hook-forwarding: ПРОВАЛ: прогнано рядов $ROWS при объявленных $EXPECTED_ROWS -- прогон не тот, который пинили" >&2
  exit 1
fi
if [ "$FAILS" -ne 0 ]; then
  echo "test-run-hook-forwarding: $FAILS/$ROWS FAILED"
  exit 1
fi
echo "test-run-hook-forwarding: OK ($ROWS rows, expected $EXPECTED_ROWS)"
