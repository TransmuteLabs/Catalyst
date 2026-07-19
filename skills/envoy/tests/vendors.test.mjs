import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VENDOR,
  listVendorIds,
  normalizeVendorEffort,
  normalizeVendorModel,
  resolveJobVendor,
  resolveVendor
} from "../scripts/lib/vendors/index.mjs";

test("codex is the default vendor and the registry lists codex, grok, kimi", () => {
  assert.equal(DEFAULT_VENDOR, "codex");
  assert.deepEqual(listVendorIds(), ["codex", "grok", "kimi"]);
  assert.equal(resolveVendor().id, "codex");
  assert.equal(resolveVendor("codex").id, "codex");
  assert.equal(resolveVendor("  GROK  ").id, "grok");
  assert.equal(resolveVendor("kimi").id, "kimi");
  assert.equal(resolveVendor(null).id, "codex");
  assert.equal(resolveVendor("").id, "codex");
});

test("unknown vendors are rejected with the supported list", () => {
  assert.throws(
    () => resolveVendor("mistral"),
    /Unsupported vendor "mistral"\. Supported vendors: codex, grok, kimi\./
  );
});

test("job records resolve their vendor with codex as the legacy default", () => {
  assert.equal(resolveJobVendor({ vendor: "grok" }).id, "grok");
  assert.equal(resolveJobVendor({ vendor: "kimi" }).id, "kimi");
  assert.equal(resolveJobVendor({}).id, "codex");
  assert.equal(resolveJobVendor(null).id, "codex");
  assert.equal(resolveJobVendor({ vendor: "gone-vendor" }).id, "codex");
});

test("vendor model aliases resolve through the registry", () => {
  const codex = resolveVendor("codex");
  assert.equal(normalizeVendorModel(codex, "spark"), "gpt-5.3-codex-spark");
  assert.equal(normalizeVendorModel(codex, "SPARK"), "gpt-5.3-codex-spark");
  assert.equal(normalizeVendorModel(codex, "gpt-5.4-mini"), "gpt-5.4-mini");
  assert.equal(normalizeVendorModel(codex, null), null);
  assert.equal(normalizeVendorModel(codex, "   "), null);
  const grok = resolveVendor("grok");
  assert.equal(normalizeVendorModel(grok, "grok-4.5-build"), "grok-4.5-build");
  const kimi = resolveVendor("kimi");
  assert.equal(normalizeVendorModel(kimi, "kimi-k3"), "kimi-k3");
});

test("vendor effort vocabulary is enforced per vendor", () => {
  const codex = resolveVendor("codex");
  for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh"]) {
    assert.equal(normalizeVendorEffort(codex, effort), effort);
  }
  assert.equal(normalizeVendorEffort(codex, "  HIGH "), "high");
  assert.equal(normalizeVendorEffort(codex, null), null);
  assert.throws(() => normalizeVendorEffort(codex, "ultra"), /Unsupported reasoning effort "ultra"/);

  const grok = resolveVendor("grok");
  for (const effort of ["low", "medium", "high", "xhigh"]) {
    assert.equal(normalizeVendorEffort(grok, effort), effort);
  }
  assert.equal(normalizeVendorEffort(grok, "max"), "xhigh");
  assert.throws(() => normalizeVendorEffort(grok, "none"), /Unsupported reasoning effort "none"/);

  const kimi = resolveVendor("kimi");
  assert.equal(normalizeVendorEffort(kimi, null), null);
  assert.throws(() => normalizeVendorEffort(kimi, "high"), /Vendor "kimi" does not support --effort\./);
});

test("resume commands are vendor-specific", () => {
  assert.equal(resolveVendor("codex").resumeCommand("thr_1"), "codex resume thr_1");
  assert.equal(resolveVendor("grok").resumeCommand("sess-1"), "grok --resume sess-1");
  assert.equal(resolveVendor("kimi").resumeCommand("session_a"), "kimi -r session_a");
});
