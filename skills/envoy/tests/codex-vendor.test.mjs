import test from "node:test";
import assert from "node:assert/strict";

import { resolveCodexTaskSandbox } from "../scripts/lib/vendors/codex.mjs";

test("codex expands only write-capable task sandboxes", () => {
  assert.equal(resolveCodexTaskSandbox("workspace-write"), "danger-full-access");
  assert.equal(resolveCodexTaskSandbox("read-only"), "read-only");
  assert.equal(resolveCodexTaskSandbox("danger-full-access"), "danger-full-access");
  assert.equal(resolveCodexTaskSandbox(undefined), undefined);
});
