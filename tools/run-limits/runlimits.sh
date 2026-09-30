# run-limits, bash half. Sourced by the bash prologue (NOTES.md); bash 3.2+.
#   runlimits_enter <profile> "$@"       -- first action of an entry point
#   runlimits_child <profile> -- argv... -- one limited child, returns its code
# Codes and rules: NOTES.md.
RUNLIMITS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
RUNLIMITS_PY="$RUNLIMITS_DIR/runlimits.py"

runlimits_enter() {
    local _rlprof=$1 _rlscript=${BASH_SOURCE[1]} _rlrc=1
    shift
    if [ -n "${RUNLIMITS_ACTIVE:-}" ]; then
        if python3 "$RUNLIMITS_PY" --is-active "$_rlprof"; then _rlrc=0; else _rlrc=$?; fi
    fi
    if [ $_rlrc -eq 0 ]; then return 0; fi
    if [ $_rlrc -eq 88 ]; then exit 88; fi
    exec python3 "$RUNLIMITS_PY" --wrap "$_rlprof" --label "$_rlscript" -- "${BASH:-bash}" "$_rlscript" "$@"
}

runlimits_child() {
    local _rlprof=$1
    shift
    if [ "${1:-}" = "--" ]; then shift; fi
    python3 "$RUNLIMITS_PY" --wrap "$_rlprof" -- "$@"
}
