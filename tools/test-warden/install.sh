#!/usr/bin/env bash
# Install / reinstall the test-warden LaunchAgent (idempotent).
#
# Touches only: ~/.local/libexec/test-warden/, ~/Library/Logs/test-warden/,
# ~/Library/LaunchAgents/com.maratkarimov.test-warden.plist and the launchd job
# gui/$UID/com.maratkarimov.test-warden. It never touches any other job
# (target-warden in particular).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
LABEL=com.maratkarimov.test-warden
LIBEXEC="$HOME/.local/libexec/test-warden"
LOGS="$HOME/Library/Logs/test-warden"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

/usr/bin/python3 -c 'import ast, sys; ast.parse(open(sys.argv[1]).read())' "$HERE/test-warden.py"
plutil -lint "$HERE/$LABEL.plist"

mkdir -p "$LIBEXEC" "$LOGS"
install -m 0755 "$HERE/test-warden.py" "$LIBEXEC/test-warden.py"
install -m 0644 "$HERE/$LABEL.plist" "$PLIST"

# bootout of a job that is not loaded fails (rc 3 / 5, "No such process" /
# "Boot-out failed: 3"); that is the only error ignored here.
set +e
out=$(launchctl bootout "$DOMAIN/$LABEL" 2>&1)
rc=$?
set -e
if [ $rc -ne 0 ]; then
    case "$out" in
        *"No such process"*|*"Could not find specified service"*|*"not find"*|*"Boot-out failed: 3"*|*"Boot-out failed: 113"*)
            echo "bootout: not loaded (rc=$rc), continuing" ;;
        *)
            echo "bootout failed rc=$rc: $out" >&2; exit 1 ;;
    esac
else
    echo "bootout: previous instance unloaded"
fi

# bootout returns before the job is fully torn down; bootstrap right after it
# can fail with "Bootstrap failed: 5: Input/output error". Retry briefly.
i=0
until launchctl bootstrap "$DOMAIN" "$PLIST"; do
    i=$((i+1))
    if [ $i -ge 10 ]; then echo "bootstrap failed after $i attempts" >&2; exit 1; fi
    sleep 0.5
done
sleep 1
# captured first: a direct pipe into head can SIGPIPE launchctl under pipefail.
printed=$(launchctl print "$DOMAIN/$LABEL")
printf '%s\n' "$printed" | head -20
