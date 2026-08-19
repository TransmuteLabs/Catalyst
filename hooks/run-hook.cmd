: << 'CMDBLOCK'
@echo off
REM Cross-platform polyglot wrapper for Catalyst hook scripts.
REM On Windows: cmd.exe runs the batch portion, which finds and calls bash.
REM On Unix: the shell interprets this as a script (: is a no-op in bash).
REM
REM Hook scripts use extensionless filenames (e.g. "session-start" not
REM "session-start.sh") so a harness that prepends "bash" to any command
REM containing .sh does not interfere.
REM
REM Usage: run-hook.cmd <script-name> [args...]

if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)

set "HOOK_DIR=%~dp0"

REM Try Git for Windows bash in standard locations
if exist "C:\Program Files\Git\bin\bash.exe" (
    "C:\Program Files\Git\bin\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
if exist "C:\Program Files (x86)\Git\bin\bash.exe" (
    "C:\Program Files (x86)\Git\bin\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)

REM Try bash on PATH (Git Bash, MSYS2, Cygwin)
where bash >nul 2>nul
if %ERRORLEVEL% equ 0 (
    bash "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)

REM No bash found - exit silently rather than error
REM (plugin still works, just without SessionStart context injection)
exit /b 0
CMDBLOCK

# Unix: run the named script, forwarding to the NEWEST installed version first.
#
# A session resolves CLAUDE_PLUGIN_ROOT once, at start, to the version dir
# current at that moment — so without forwarding, a gate shipped in an update
# protects only sessions started AFTER it (incident 2026-08-19: a quota gate
# in 0.8.12 did not guard dispatches from sessions still bound to 0.8.10).
# Forwarding makes every versioned entry point run the newest cache copy, so
# an update reaches live sessions without a restart. Constraints: only when
# the parent dir is a semver cache dir (a dev checkout never forwards); one
# hop only (env guard breaks cycles); a missing target falls through to the
# own copy. The Windows batch half above stays version-pinned — forwarding
# there is untestable on this installation and is named, not hidden.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
shift

if [ -z "${CATALYST_HOOK_FORWARDED:-}" ]; then
  VER_DIR="$(dirname "$SCRIPT_DIR")"
  CACHE_DIR="$(dirname "$VER_DIR")"
  OWN_VER="$(basename "$VER_DIR")"
  case "$OWN_VER" in
    *[!0-9.]*|.*|*.) : ;;  # not a plain x.y.z cache dir - never forward
    *)
      LATEST="$(ls "$CACHE_DIR" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
        | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
      if [ -n "$LATEST" ] && [ "$LATEST" != "$OWN_VER" ] \
        && [ -f "$CACHE_DIR/$LATEST/hooks/run-hook.cmd" ] \
        && [ -f "$CACHE_DIR/$LATEST/hooks/$SCRIPT_NAME" ]; then
        export CATALYST_HOOK_FORWARDED=1
        exec bash "$CACHE_DIR/$LATEST/hooks/run-hook.cmd" "$SCRIPT_NAME" "$@"
      fi
      ;;
  esac
fi

exec bash "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@"
