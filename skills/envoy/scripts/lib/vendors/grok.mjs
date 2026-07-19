import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { binaryAvailable } from "../process.mjs";
import { runCliCommand } from "./cli-runner.mjs";

/**
 * Grok vendor module — drives the `grok` CLI in single-turn headless mode.
 *
 * Grounded contract (grok --help + live run, 2026-07-20):
 * - Prompt: `--prompt-file <path>` (headless single turn; stdin is not read).
 * - Output: `--output-format json` prints one final JSON object:
 *   `{ text, stopReason, sessionId, requestId, thought?, usage... }`.
 * - Resume: `-r/--resume <sessionId>` continues a stored session.
 * - Effort: `--reasoning-effort <low|medium|high|xhigh>` (free-form on the
 *   CLI side, validated by the service; vocabulary from the trace metadata
 *   schema). The registry maps the `max` alias to `xhigh`.
 * - Write mode: `--always-approve` auto-approves tool executions.
 *   Read-only mode: `--permission-mode plan` (no edits).
 * - Exit code 0 on success.
 */

export function getGrokAvailability() {
  return binaryAvailable("grok");
}

// Mechanical auth probe for setup: `grok models` requires a valid login and
// costs no model call. Exit 0 = authenticated.
export function probeGrokReadiness() {
  const result = binaryAvailable("grok", ["models"]);
  return {
    ok: Boolean(result.available),
    label: "auth",
    detail: result.available ? "login verified (grok models)" : result.detail
  };
}

function writePromptFile(prompt) {
  const filePath = path.join(
    os.tmpdir(),
    `envoy-grok-prompt-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`
  );
  fs.writeFileSync(filePath, prompt, "utf8");
  return filePath;
}

function parseGrokJson(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ cwd: string, prompt: string, model?: string | null, effort?: string | null, write?: boolean, resumeSessionId?: string | null, onProgress?: (event: object) => void }} request
 * @returns {Promise<{ status: number, sessionId: string | null, finalMessage: string, failureMessage: string, reasoningSummary: string, stderr: string }>}
 */
export async function runGrokTask(request) {
  const onProgress = request.onProgress ?? (() => {});
  const promptFile = writePromptFile(request.prompt ?? "");

  const args = ["--prompt-file", promptFile, "--output-format", "json"];
  if (request.resumeSessionId) {
    args.push("--resume", request.resumeSessionId);
  }
  if (request.model) {
    args.push("--model", request.model);
  }
  if (request.effort) {
    args.push("--reasoning-effort", request.effort);
  }
  if (request.write) {
    args.push("--always-approve");
  } else {
    args.push("--permission-mode", "plan");
  }

  onProgress({ message: "Grok run started.", phase: "running" });

  let execution;
  try {
    execution = await runCliCommand("grok", args, {
      cwd: request.cwd,
      onStderrLine: (line) => onProgress({ stderrMessage: line })
    });
  } finally {
    try {
      fs.unlinkSync(promptFile);
    } catch {
      // best-effort cleanup
    }
  }

  if (execution.spawnError) {
    return {
      status: 1,
      sessionId: null,
      finalMessage: "",
      failureMessage: `Failed to launch the Grok CLI: ${execution.spawnError.message}`,
      reasoningSummary: "",
      stderr: execution.stderr
    };
  }

  const parsed = parseGrokJson(execution.stdout);
  const sessionId = typeof parsed?.sessionId === "string" && parsed.sessionId ? parsed.sessionId : null;
  const finalMessage = typeof parsed?.text === "string" ? parsed.text : "";
  const reasoningSummary = typeof parsed?.thought === "string" ? parsed.thought : "";
  const stopReason = typeof parsed?.stopReason === "string" ? parsed.stopReason : null;

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
        `Grok exited with ${execution.signal ? `signal ${execution.signal}` : `code ${execution.exitCode}`}.`,
      reasoningSummary,
      stderr: execution.stderr
    };
  }

  if (!parsed) {
    return {
      status: 1,
      sessionId: null,
      finalMessage: "",
      failureMessage: "Grok did not return valid JSON output.",
      reasoningSummary: "",
      stderr: execution.stderr
    };
  }

  if (stopReason && stopReason !== "EndTurn") {
    return {
      status: 1,
      sessionId,
      finalMessage,
      failureMessage: `Grok run stopped early: ${stopReason}.`,
      reasoningSummary,
      stderr: execution.stderr
    };
  }

  onProgress({ message: "Grok run finished.", phase: "finished" });
  return {
    status: 0,
    sessionId,
    finalMessage,
    failureMessage: "",
    reasoningSummary,
    stderr: execution.stderr
  };
}
