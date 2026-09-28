// The same bounded representation is used at capture and at persistence:
// replay must compare the complete incoming id with its stored identity.
// CONSTRAINT (S4-FIX10 Ж9, S4-FIX11 Н1): the function is injective (an image
// is exactly 200 code units while a passed-through input is at most 191) and
// NOT idempotent — re-encoding an image changes it. Only capture, and restore
// of a snapshot without the NORM marker, may re-apply it to an id field; a
// marked snapshot's ids are canonical UP TO THE SIZE BOUND — past 200 code
// units even a marked id takes this image (restore trusts the marker, never
// a store-limit violation: FIX8 Ф4).
let longHashes = 0

// CONSTRAINT (S4-FIX10 Ж9): the schema marker every snapshot created by this
// code carries; a stored value without it predates capture-side id
// normalization, so restore canonicalizes its ids the way capture would.
export const NORM = 1

// CONSTRAINT (S4-FIX10 Ж9, S4-FIX11 Н8): the table of snapshot ID fields
// RESTORE reads — boundJson takes it verbatim (a marked snapshot trusts these
// paths up to the size bound, a legacy snapshot canonicalizes them, FIX8 Ф4
// bounds every other string on the unmarked pass). Capture does NOT read this
// table: it normalizes inline at the sites it writes — base.ts:266 (seenTurns
// keys), :282/:314/:357 (agent ids and map keys), :284 (AgentRec.turn), :344
// (finished tool names), :360/:363/:364/:316 (name/desc/model). The parity
// between the table and those sites is pinned by tests/s4-fix11.test.ts Н8:
// every table path carries a capture driver, and each driver must yield the
// snapshotText image of its raw value at the exact path. The path grammar is
// boundJson's (element `[]`, object field the JSON-quoted key — same grammar
// as SESS_ARRAY_PATHS).
export const SESS_ID_PATHS = new Set([
  '"seenTurns"/[]',
  '"agents"/"map"/[]/[]',
  '"agents"/"map"/[]/[]/"name"',
  '"agents"/"map"/[]/[]/"desc"',
  '"agents"/"map"/[]/[]/"model"',
  '"agents"/"map"/[]/[]/"turn"',
  '"agents"/"done"/[]',
  '"tools"/"byName"/[]/[]',
  '"tools"/"done"/[]/"name"',
])

export function __snapshotLongHashes(): number {
  return longHashes
}

// CONSTRAINT (S4-FIX10b): ids need injectivity (snapshotText), every other
// string and object key needs idempotence (boundText) — boundJson re-passes
// stored values on each write and read-back, and a non-idempotent bound would
// drift a non-id string by one image per cycle.
function fnv32hex(text: string): string {
  // FNV-1a over UTF-16 code units; Math.imul keeps the product in 32 bits.
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function snapshotText(text: string): string {
  if (text.length <= 191) return text
  longHashes++
  return text.slice(0, 191) + '#' + fnv32hex(text)
}

// The image is exactly 200 code units, so a passed-through input and the
// image of a longer one are indistinguishable to a later pass: idempotent.
export function boundText(text: string): string {
  if (text.length <= 200) return text
  longHashes++
  return text.slice(0, 191) + '#' + fnv32hex(text)
}
