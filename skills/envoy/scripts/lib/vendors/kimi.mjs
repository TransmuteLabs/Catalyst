import { binaryAvailable } from "../process.mjs";
import { runCliCommand } from "./cli-runner.mjs";

/**
 * Kimi vendor module — drives the system `kimi` CLI (kimi-code) in
 * non-interactive prompt mode.
 *
 * Grounded contract (kimi --help + live run, 2026-07-20):
 * - Prompt: `-p <prompt>` runs one prompt non-interactively (the prompt is an
 *   argv argument; kimi-code has no prompt-file flag).
 * - Output: `--output-format stream-json` prints one JSON object per line:
 *   `{"role":"assistant","content":"..."}` for response text and
 *   `{"role":"meta","type":"session.resume_hint","session_id":"...","command":"kimi -r ..."}`
 *   carrying the session id.
 * - Resume: `-r <sessionId>` (the exact form the CLI's own resume hint emits).
 * - Effort: not supported — kimi-code exposes no reasoning-effort flag; the
 *   registry declares an empty effort vocabulary so `--effort` fails fast.
 * - Write mode: `--yolo` auto-approves all actions. Read-only mode: default
 *   permission mode (no auto-approve; `--plan` cannot be combined with `-p`).
 * - Exit code 0 on success.
 */

export function getKimiAvailability() {
  return { available: binaryAvailable("kimi") };
}

function parseKimiStream(stdout) {
  const assistantParts = [];
  let sessionId = null;

  for (const line of String(stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") {
      continue;
    }
    if (event.role === "assistant" && typeof event.content === "string" && event.content) {
      assistantParts.push(event.content);
      continue;
    }
    if (
      event.role === "meta" &&
      typeof event.session_id === "string" &&
      event.session_id
    ) {
      sessionId = event.session_id;
    }
  }

  return { assistantParts, sessionId };
}

/**
 * @param {{ cwd: string, prompt: string, model?: string | null, write?: boolean, resumeSessionId?: string | null, onProgress?: (event: object) => void }} request
 * @returns {Promise<{ status: number, sessionId: string | null, finalMessage: string, failureMessage: string, reasoningSummary: string, stderr: string }>}
 */
export async function runKimiTask(request) {
  const onProgress = request.onProgress ?? (() => {});

  const args = [];
  if (request.resumeSessionId) {
    args.push("-r", request.resumeSessionId);
  }
  if (request.model) {
    args.push("-m", request.model);
  }
  if (request.write) {
    args.push("--yolo");
  }
  args.push("--output-format", "stream-json", "-p", request.prompt ?? "");

  onProgress({ message: "Kimi run started.", phase: "running" });

  const execution = await runCliCommand("kimi", args, {
    cwd: request.cwd,
    onStderrLine: (line) => onProgress({ stderrMessage: line })
  });

  if (execution.spawnError) {
    return {
      status: 1,
      sessionId: null,
      finalMessage: "",
      failureMessage: `Failed to launch the Kimi CLI: ${execution.spawnError.message}`,
      reasoningSummary: "",
      stderr: execution.stderr
    };
  }

  const { assistantParts, sessionId } = parseKimiStream(execution.stdout);
  const finalMessage = assistantParts.length > 0 ? assistantParts.join("\n\n") : String(execution.stdout ?? "").trim();

  if (sessionId) {
    onProgress({ threadId: sessionId });
  }

  if (execution.exitCode !== 0) {
    return {
      status: execution.exitCode ?? 1,
      sessionId,
      finalMessage,
      failureMessage:
        execution.stderr.trim() ||
        `Kimi exited with ${execution.signal ? `signal ${execution.signal}` : `code ${execution.exitCode}`}.`,
      reasoningSummary: "",
      stderr: execution.stderr
    };
  }

  onProgress({ message: "Kimi run finished.", phase: "finished" });
  return {
    status: 0,
    sessionId,
    finalMessage,
    failureMessage: "",
    reasoningSummary: "",
    stderr: execution.stderr
  };
}
