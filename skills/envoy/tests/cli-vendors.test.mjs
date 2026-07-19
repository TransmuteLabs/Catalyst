import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { makeTempDir, run, writeExecutable } from "./helpers.mjs";
import { buildEnv } from "./fake-codex-fixture.mjs";
import { resolveStateDir } from "../scripts/lib/state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "envoy-companion.mjs");

function installFakeGrok(binDir) {
  const argsFile = path.join(binDir, "grok-calls.jsonl");
  const scriptPath = path.join(binDir, "grok");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("fake-grok 0.0.0");
  process.exit(0);
}
let promptText = null;
const promptFileIndex = args.indexOf("--prompt-file");
if (promptFileIndex !== -1) {
  promptText = fs.readFileSync(args[promptFileIndex + 1], "utf8");
}
fs.appendFileSync(${JSON.stringify(argsFile)}, JSON.stringify({ args, promptText }) + "\\n");
const resumeIndex = args.indexOf("--resume");
const sessionId = resumeIndex === -1 ? "grok-sess-1" : "grok-sess-resumed";
process.stdout.write(JSON.stringify({
  text: "OK from grok",
  stopReason: "EndTurn",
  sessionId,
  requestId: "req-1"
}));
`;
  writeExecutable(scriptPath, source);
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "grok.cmd"), `@echo off\r\nnode "%~dp0grok" %*\r\n`, "utf8");
  }
  return { argsFile };
}

function installFakeKimi(binDir) {
  const argsFile = path.join(binDir, "kimi-calls.jsonl");
  const scriptPath = path.join(binDir, "kimi");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("fake-kimi 0.0.0");
  process.exit(0);
}
fs.appendFileSync(${JSON.stringify(argsFile)}, JSON.stringify({ args }) + "\\n");
const resumeIndex = args.indexOf("-r");
const sessionId = resumeIndex === -1 ? "session_kimi_1" : "session_kimi_resumed";
console.log(JSON.stringify({ role: "assistant", content: "OK from kimi" }));
console.log(JSON.stringify({
  role: "meta",
  type: "session.resume_hint",
  session_id: sessionId,
  command: "kimi -r " + sessionId
}));
`;
  writeExecutable(scriptPath, source);
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "kimi.cmd"), `@echo off\r\nnode "%~dp0kimi" %*\r\n`, "utf8");
  }
  return { argsFile };
}

function readCalls(argsFile) {
  return fs
    .readFileSync(argsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function loadJobs(workspace) {
  const stateFile = path.join(resolveStateDir(workspace), "state.json");
  return JSON.parse(fs.readFileSync(stateFile, "utf8")).jobs;
}

test("task --vendor grok drives the grok CLI read-only by default and records the session", () => {
  const binDir = makeTempDir();
  const workspace = makeTempDir();
  const { argsFile } = installFakeGrok(binDir);

  const result = run("node", [SCRIPT, "task", "--vendor", "grok", "investigate the flaky test"], {
    cwd: workspace,
    env: buildEnv(binDir)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK from grok/);

  const calls = readCalls(argsFile).filter((call) => !call.args.includes("--version"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].promptText, "investigate the flaky test");
  assert.ok(calls[0].args.includes("--output-format"));
  assert.ok(calls[0].args.includes("json"));
  assert.ok(calls[0].args.includes("--permission-mode"));
  assert.ok(calls[0].args.includes("plan"));
  assert.ok(!calls[0].args.includes("--always-approve"));

  const jobs = loadJobs(workspace);
  const taskJob = jobs.find((job) => job.jobClass === "task");
  assert.ok(taskJob, "expected a tracked task job");
  assert.equal(taskJob.vendor, "grok");
  assert.equal(taskJob.threadId, "grok-sess-1");
  assert.equal(taskJob.status, "completed");
});

test("task --vendor grok --write --effort max maps to --always-approve and xhigh", () => {
  const binDir = makeTempDir();
  const workspace = makeTempDir();
  const { argsFile } = installFakeGrok(binDir);

  const result = run(
    "node",
    [SCRIPT, "task", "--vendor", "grok", "--write", "--effort", "max", "--model", "grok-4.5-build", "fix it"],
    {
      cwd: workspace,
      env: buildEnv(binDir)
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const calls = readCalls(argsFile).filter((call) => !call.args.includes("--version"));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes("--always-approve"));
  assert.ok(!calls[0].args.includes("--permission-mode"));
  const effortIndex = calls[0].args.indexOf("--reasoning-effort");
  assert.notEqual(effortIndex, -1);
  assert.equal(calls[0].args[effortIndex + 1], "xhigh");
  const modelIndex = calls[0].args.indexOf("--model");
  assert.equal(calls[0].args[modelIndex + 1], "grok-4.5-build");
});

test("grok resume-last resumes the tracked grok session and stays vendor-isolated", () => {
  const binDir = makeTempDir();
  const workspace = makeTempDir();
  const { argsFile } = installFakeGrok(binDir);
  installFakeKimi(binDir);
  const env = buildEnv(binDir);

  const first = run("node", [SCRIPT, "task", "--vendor", "grok", "start the work"], {
    cwd: workspace,
    env
  });
  assert.equal(first.status, 0, first.stderr);

  const resumed = run("node", [SCRIPT, "task", "--vendor", "grok", "--resume-last", "keep going"], {
    cwd: workspace,
    env
  });
  assert.equal(resumed.status, 0, resumed.stderr);

  const calls = readCalls(argsFile).filter((call) => !call.args.includes("--version"));
  assert.equal(calls.length, 2);
  const resumeIndex = calls[1].args.indexOf("--resume");
  assert.notEqual(resumeIndex, -1);
  assert.equal(calls[1].args[resumeIndex + 1], "grok-sess-1");

  // The grok session must be invisible to another vendor's resume flow.
  const crossVendor = run("node", [SCRIPT, "task", "--vendor", "kimi", "--resume-last"], {
    cwd: workspace,
    env
  });
  assert.notEqual(crossVendor.status, 0);
  assert.match(crossVendor.stderr, /No previous Kimi task session was found/);
});

test("task --vendor kimi parses stream-json, records the session, and honors --write", () => {
  const binDir = makeTempDir();
  const workspace = makeTempDir();
  const { argsFile } = installFakeKimi(binDir);
  const env = buildEnv(binDir);

  const readOnly = run("node", [SCRIPT, "task", "--vendor", "kimi", "summarize the repo"], {
    cwd: workspace,
    env
  });
  assert.equal(readOnly.status, 0, readOnly.stderr);
  assert.match(readOnly.stdout, /OK from kimi/);

  const written = run("node", [SCRIPT, "task", "--vendor", "kimi", "--write", "apply the fix"], {
    cwd: workspace,
    env
  });
  assert.equal(written.status, 0, written.stderr);

  const calls = readCalls(argsFile).filter((call) => !call.args.includes("--version"));
  assert.equal(calls.length, 2);
  assert.ok(!calls[0].args.includes("--yolo"));
  assert.ok(calls[1].args.includes("--yolo"));
  for (const call of calls) {
    assert.ok(call.args.includes("--output-format"));
    assert.ok(call.args.includes("stream-json"));
    assert.ok(call.args.includes("-p"));
  }

  const jobs = loadJobs(workspace);
  const kimiJobs = jobs.filter((job) => job.vendor === "kimi");
  assert.equal(kimiJobs.length, 2);
  assert.equal(kimiJobs[0].threadId, "session_kimi_1");
});

test("kimi rejects --effort fast without launching the CLI", () => {
  const binDir = makeTempDir();
  const workspace = makeTempDir();
  const { argsFile } = installFakeKimi(binDir);

  const result = run("node", [SCRIPT, "task", "--vendor", "kimi", "--effort", "high", "do it"], {
    cwd: workspace,
    env: buildEnv(binDir)
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Vendor "kimi" does not support --effort\./);
  assert.ok(!fs.existsSync(argsFile), "the kimi CLI must not have been invoked");
});

test("setup reports per-vendor availability and suggests installing missing CLI vendors", () => {
  const binDir = makeTempDir();
  const workspace = makeTempDir();
  installFakeGrok(binDir);
  fs.symlinkSync(process.execPath, path.join(binDir, "node"));

  // PATH contains only the fake bin dir: grok is present, kimi is not.
  const result = run("node", [SCRIPT, "setup", "--json"], {
    cwd: workspace,
    env: {
      ...process.env,
      PATH: binDir
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payload.vendors));
  assert.deepEqual(
    payload.vendors.map((vendor) => vendor.id),
    ["codex", "grok", "kimi"]
  );
  const grok = payload.vendors.find((vendor) => vendor.id === "grok");
  const kimi = payload.vendors.find((vendor) => vendor.id === "kimi");
  const codex = payload.vendors.find((vendor) => vendor.id === "codex");
  assert.equal(codex.default, true);
  assert.equal(grok.available, true);
  assert.equal(kimi.available, false);
  assert.ok(
    payload.nextSteps.some((step) => step.includes("--vendor kimi")),
    "expected an install hint for the missing kimi CLI"
  );
  assert.ok(
    !payload.nextSteps.some((step) => step.includes("--vendor grok")),
    "no install hint expected for the available grok CLI"
  );

  const rendered = run("node", [SCRIPT, "setup"], {
    cwd: workspace,
    env: {
      ...process.env,
      PATH: binDir
    }
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /Vendors:/);
  assert.match(rendered.stdout, /- codex \(default\): /);
  assert.match(rendered.stdout, /- grok: available/);
  assert.match(rendered.stdout, /- kimi: not found/);
});

test("task fails fast when the requested CLI vendor is not installed", () => {
  const binDir = makeTempDir();
  const workspace = makeTempDir();
  fs.symlinkSync(process.execPath, path.join(binDir, "node"));

  const result = run("node", [SCRIPT, "task", "--vendor", "grok", "do something"], {
    cwd: workspace,
    env: {
      ...process.env,
      PATH: binDir
    }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Grok CLI \(`grok`\) is not installed or not on PATH\./);
});

test("result renders vendor-specific resume hints for CLI vendor jobs", () => {
  const binDir = makeTempDir();
  const workspace = makeTempDir();
  installFakeGrok(binDir);
  const env = buildEnv(binDir);

  const task = run("node", [SCRIPT, "task", "--vendor", "grok", "investigate"], {
    cwd: workspace,
    env
  });
  assert.equal(task.status, 0, task.stderr);

  const result = run("node", [SCRIPT, "result"], {
    cwd: workspace,
    env
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Session ID: grok-sess-1/);
  assert.match(result.stdout, /Resume in Grok: grok --resume grok-sess-1/);
});
