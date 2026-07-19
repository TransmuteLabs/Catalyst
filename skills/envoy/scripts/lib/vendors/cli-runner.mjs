import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Shared subprocess runner for CLI-driven vendors (grok, kimi).
 *
 * Spawns the vendor CLI in the same process tree (no detach), collects stdout
 * and stderr fully, and optionally forwards stderr lines to a progress
 * callback so background jobs get live log lines.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, input?: string, onStderrLine?: (line: string) => void }} [options]
 * @returns {Promise<{ exitCode: number | null, signal: string | null, stdout: string, stderr: string, spawnError: Error | null }>}
 */
export function runCliCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    let stdout = "";
    let stderr = "";
    let stderrLineBuffer = "";

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [options.input == null ? "ignore" : "pipe", "pipe", "pipe"],
      shell: process.platform === "win32" ? (process.env.SHELL || true) : false,
      windowsHide: true
    });

    if (options.input != null && child.stdin) {
      child.stdin.write(options.input);
      child.stdin.end();
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (!options.onStderrLine) {
        return;
      }
      stderrLineBuffer += chunk;
      let newlineIndex = stderrLineBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stderrLineBuffer.slice(0, newlineIndex).trimEnd();
        stderrLineBuffer = stderrLineBuffer.slice(newlineIndex + 1);
        if (line) {
          options.onStderrLine(line);
        }
        newlineIndex = stderrLineBuffer.indexOf("\n");
      }
    });

    child.on("error", (error) => {
      settle({ exitCode: null, signal: null, stdout, stderr, spawnError: error });
    });

    child.on("close", (code, signal) => {
      if (options.onStderrLine && stderrLineBuffer.trim()) {
        options.onStderrLine(stderrLineBuffer.trimEnd());
      }
      settle({ exitCode: code, signal, stdout, stderr, spawnError: null });
    });
  });
}
