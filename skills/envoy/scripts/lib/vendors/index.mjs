/**
 * Vendor registry — the envoy companion's single source of truth for which
 * external harnesses it can drive and how their runtime knobs are shaped.
 *
 * codex is the default vendor (driven through its app-server by the
 * companion itself); grok and kimi are CLI-driven vendors whose `runTask`
 * implementations live in their vendor modules. Everything companion-level
 * (jobs, state, rendering, background workers) stays vendor-neutral and
 * reads these descriptors instead of hardcoding vendor specifics.
 */

import { getGrokAvailability, runGrokTask } from "./grok.mjs";
import { getKimiAvailability, runKimiTask } from "./kimi.mjs";

export const DEFAULT_VENDOR = "codex";

/**
 * @typedef {Object} VendorDescriptor
 * @property {string} id            registry key, also stored on job records
 * @property {string} title         human-readable vendor name for rendering
 * @property {string} cli           the executable this vendor drives
 * @property {string[]} reasoningEfforts  accepted --effort values ([] = effort unsupported)
 * @property {Map<string, string>} effortAliases  user-facing effort alias → real value
 * @property {Map<string, string>} modelAliases   user-facing model alias → real model id
 * @property {(sessionId: string) => string} resumeCommand  shell command that resumes a session
 * @property {(() => { available: boolean }) | null} getAvailability  CLI availability probe (null = companion handles it)
 * @property {((request: object) => Promise<object>) | null} runTask  CLI task runner (null = companion drives the vendor itself)
 */

/** @type {Map<string, VendorDescriptor>} */
const VENDORS = new Map([
  [
    "codex",
    {
      id: "codex",
      title: "Codex",
      cli: "codex",
      reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
      effortAliases: new Map(),
      modelAliases: new Map([["spark", "gpt-5.3-codex-spark"]]),
      resumeCommand: (sessionId) => `codex resume ${sessionId}`,
      getAvailability: null,
      runTask: null
    }
  ],
  [
    "grok",
    {
      id: "grok",
      title: "Grok",
      cli: "grok",
      reasoningEfforts: ["low", "medium", "high", "xhigh"],
      effortAliases: new Map([["max", "xhigh"]]),
      modelAliases: new Map(),
      resumeCommand: (sessionId) => `grok --resume ${sessionId}`,
      getAvailability: getGrokAvailability,
      runTask: runGrokTask
    }
  ],
  [
    "kimi",
    {
      id: "kimi",
      title: "Kimi",
      cli: "kimi",
      reasoningEfforts: [],
      effortAliases: new Map(),
      modelAliases: new Map(),
      resumeCommand: (sessionId) => `kimi -r ${sessionId}`,
      getAvailability: getKimiAvailability,
      runTask: runKimiTask
    }
  ]
]);

export function listVendorIds() {
  return [...VENDORS.keys()];
}

/**
 * @param {string | null | undefined} id
 * @returns {VendorDescriptor}
 */
export function resolveVendor(id = DEFAULT_VENDOR) {
  const normalized = String(id ?? "").trim().toLowerCase() || DEFAULT_VENDOR;
  const vendor = VENDORS.get(normalized);
  if (!vendor) {
    throw new Error(`Unsupported vendor "${id}". Supported vendors: ${listVendorIds().join(", ")}.`);
  }
  return vendor;
}

/**
 * Vendor stored on a job record; legacy records without the field are codex.
 * @param {{ vendor?: string } | null | undefined} job
 * @returns {VendorDescriptor}
 */
export function resolveJobVendor(job) {
  try {
    return resolveVendor(job?.vendor ?? DEFAULT_VENDOR);
  } catch {
    return resolveVendor(DEFAULT_VENDOR);
  }
}

/**
 * Resolve a user-supplied model name through the vendor's alias table.
 * @param {VendorDescriptor} vendor
 * @param {string | null | undefined} model
 * @returns {string | null}
 */
export function normalizeVendorModel(vendor, model) {
  if (model == null) {
    return null;
  }
  const normalized = String(model).trim();
  if (!normalized) {
    return null;
  }
  return vendor.modelAliases.get(normalized.toLowerCase()) ?? normalized;
}

/**
 * Validate a user-supplied reasoning effort against the vendor's vocabulary.
 * @param {VendorDescriptor} vendor
 * @param {string | null | undefined} effort
 * @returns {string | null}
 */
export function normalizeVendorEffort(vendor, effort) {
  if (effort == null) {
    return null;
  }
  let normalized = String(effort).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  normalized = vendor.effortAliases.get(normalized) ?? normalized;
  if (vendor.reasoningEfforts.length === 0) {
    throw new Error(`Vendor "${vendor.id}" does not support --effort.`);
  }
  if (!vendor.reasoningEfforts.includes(normalized)) {
    throw new Error(
      `Unsupported reasoning effort "${effort}". Use one of: ${vendor.reasoningEfforts.join(", ")}.`
    );
  }
  return normalized;
}
