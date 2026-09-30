// run-limits, node half. Imported by the node prologue (NOTES.md).
//   await enter(profile)             -- first action of an entry point; forwards SIGINT/SIGTERM/SIGHUP
//   await runChild(argv, profile, o) -- one limited child -> { status, signal, code }
// Codes and rules: NOTES.md.
import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNLIMITS_PY = join(dirname(fileURLToPath(import.meta.url)), 'runlimits.py');
const PY = 'python3';

function exitCode(status, signal) {
  if (status !== null && status !== undefined) return status;
  return 128 + (constants.signals[signal] ?? 0);
}

export async function enter(profile) {
  const label = process.argv[1] ?? process.execPath;
  if (process.env.RUNLIMITS_ACTIVE) {
    const chk = spawnSync(PY, [RUNLIMITS_PY, '--is-active', profile], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (chk.error) {
      process.stderr.write(`RUNLIMITS: ${label} refused: ${PY} not runnable (${chk.error.message})\n`);
      process.exit(88);
    }
    if (chk.status === 0) return;
    if (chk.status === 88) process.exit(88);
  }
  // execArgv keeps interpreter flags (--test, --max-old-space-size, ...) of this run.
  const argv = [RUNLIMITS_PY, '--wrap', profile, '--label', label, '--',
    process.execPath, ...process.execArgv, ...process.argv.slice(1)];
  const c = spawn(PY, argv, { stdio: 'inherit' });
  // this node stays the supervisor's parent: signals sent to it go to the supervisor
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { c.kill(s); });
  const r = await new Promise((resolve) => {
    c.on('error', (error) => resolve({ error }));
    c.on('close', (status, signal) => resolve({ status, signal }));
  });
  if (r.error) {
    process.stderr.write(`RUNLIMITS: ${label} refused: ${PY} not runnable (${r.error.message})\n`);
    process.exit(88);
  }
  process.exit(exitCode(r.status, r.signal));
}

export function runChild(argv, profile, opts = {}) {
  const args = argv.map(String);
  return new Promise((resolve, reject) => {
    const c = spawn(PY, [RUNLIMITS_PY, '--wrap', profile, '--label', args[0], '--', ...args], { stdio: 'inherit', ...opts });
    c.on('error', reject);
    c.on('close', (status, signal) => resolve({ status, signal, code: exitCode(status, signal) }));
  });
}
