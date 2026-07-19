---
name: upgrade-harness
description: Use when extending the ouros sandbox with a new external function - "add X search to the sandbox", "database query function from sandbox", "extend sandbox with X". Requires the ContinuousClaude binary layer (tools/ouros_harness.py present in the project).
---

# Upgrade harness — new ouros external functions

## Overview

Walk through adding a new external function to the ouros sandbox harness (ContinuousClaude core, carried by the family so the capability survives the skill-layer replacement). External functions are the sandbox's only way to interact with the outside world — each one pauses Python execution, runs the real operation on the host, and returns the result.

**Precondition:** `tools/ouros_harness.py` exists in the project (verify the file, not a name on PATH). Absent → this skill does not apply; the sandbox itself ships with the ContinuousClaude binary layer.

## Steps

1. **Understand the request.** Ask the user (one question at a time): what function, what parameters, async web API or sync local, what security constraints (path restrictions, API keys, rate limits).

2. **Read the current harness** for established patterns: bridge functions after imports, before `SECURITY_POLICY`; the `SECURITY_POLICY` dict defines allowed paths/commands; `EXTERNAL_FUNCTIONS` maps names to handlers.

3. **Write the bridge function.** Async web API → async function + sync wrapper (ouros calls sync only):

```python
async def _call_new_function(param1, param2="default"):
    """Bridge to the real API."""
    if not param1:
        return {"error": "param1 is required"}
    try:
        return await api_call(param1=param1, param2=param2)
    except Exception as e:  # the bridge boundary: errors return, never escape
        logging.exception("new_function bridge failure")  # full detail stays host-side
        return {"error": f"{type(e).__name__} (details logged host-side)"}

def _call_new_function_sync(*args, **kwargs):
    try:
        return asyncio.run(_call_new_function(*args, **kwargs))
    except Exception as e:  # asyncio.run itself can raise (nested loop, etc.)
        logging.exception("new_function sync-wrapper failure")
        return {"error": f"{type(e).__name__} (details logged host-side)"}
```

Error strings cross the sandbox boundary, so they are REDACTED by construction: an SDK/HTTP exception's `str(e)` can carry URLs, headers, local paths, or an API token — the sandbox gets only the exception TYPE plus a fixed message, and the full detail goes to host-side logging. Never interpolate `{e}` (or `repr(e)`, or a traceback) into the returned dict.

Sync local operation → plain function with a policy check first (`_check_path_allowed(...)`), all exceptions caught and returned as `{"error": "..."}`. Bridge functions must return JSON-serializable dicts/strings and keep parameters simple (strings, ints, bools, lists).

4. **Security policy** for anything touching filesystem/network/shell: add rules to `SECURITY_POLICY`, use `_check_path_allowed()` or a custom check. Principles: deny by default, allowlists over denylists, check before executing, fail closed on errors. Never widen `run_command`'s allowlist with anything that has a code-execution surface.

5. **Register** in `EXTERNAL_FUNCTIONS` — the key becomes the name sandbox code calls.

6. **Test end-to-end** — smoke (works?), security (blocks unauthorized access?), error handling (fails gracefully?), redaction (raise a test exception whose message embeds a fake secret — the sandbox-visible return must show the type only, never the secret):

```bash
echo 'result = new_function("test_arg"); print(result)' | python tools/ouros_harness.py
```

Add cases to `test_ouros_harness.py` if it exists.

7. **Close the loop:** update the function table in the project's `.claude/CLAUDE.md`; install Python deps into the sandbox venv and document them; copy any helper scripts next to the harness.

Completion checklist to present: bridge written, security policy added, registered, smoke tested, security tested, docs updated, dependencies documented.

## Red Flags — STOP

- A bridge function that lets exceptions escape instead of returning `{"error": ...}`.
- A new `run_command` allowlist entry that can execute arbitrary code (interpreters, package managers, `git`, `rg --pre`).
- Security check performed after the operation instead of before.
- Function registered but never smoke-tested through the harness.
