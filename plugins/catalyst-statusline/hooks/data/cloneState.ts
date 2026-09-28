// CONSTRAINT (S4-FIX11 Н3): feed reduces a CLONE of the family state so a
// throw inside reduce leaves the stored original intact (S4-FIX11 brief Н3,
// critic S4-FIX10 sol №2 / swe2 В5). This covers what family states hold:
// plain JSON-shaped nodes (objects, arrays, Set, Map, primitives). An
// unsupported node is a loud TypeError BEFORE the reduce — `feed` then resets
// the family to init() with the diagnosis `family-state-reset`; a silent
// partial clone is not an option because the reduce would run on a state the
// store never held.
// CONSTRAINT (S4-FIX11b): the clone keeps the GRAPH — a cycle and a shared
// link survive as one node reached the same way (seen-memory registers the
// empty container before its children are walked). applySnapshot rebuilds a
// restored record from the AgentRec fields and drops a non-string `turn`
// (base.ts:998), so restore brings no cycle in; the clone keeps a cyclic graph
// for a state planted any other way (the Р12 carrier), where a walk without
// seen-memory recurses to a RangeError.
const cloneNode = (value: unknown, seen: Map<object, unknown>): unknown => {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t !== 'object' && t !== 'function') return value
  if (t === 'function') throw new TypeError('cloneState: unsupported function')
  if (seen.has(value)) return seen.get(value)
  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const entry of value) out.push(cloneNode(entry, seen))
    return out
  }
  if (value instanceof Set) {
    const out = new Set<unknown>()
    seen.set(value, out)
    for (const entry of value) out.add(cloneNode(entry, seen))
    return out
  }
  if (value instanceof Map) {
    const out = new Map<unknown, unknown>()
    seen.set(value, out)
    for (const [k, v] of value) out.set(cloneNode(k, seen), cloneNode(v, seen))
    return out
  }
  const proto = Object.getPrototypeOf(value)
  if (proto === Object.prototype || proto === null) {
    const out = proto === null ? Object.create(null) as Record<string, unknown> : {} as Record<string, unknown>
    seen.set(value, out)
    // CONSTRAINT (S4-FIX13 Т6, swe2 Q2c): Object.entries sees neither symbol
    // nor non-enumerable keys — such a node is refused aloud, not cloned partly
    if (Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== Object.keys(value).length) throw new TypeError('cloneState: symbol or non-enumerable key')
    // CONSTRAINT (S4-FIX12 Н1): own keys are installed with defineProperty —
    // a plain write of the own key "__proto__" (JSON.parse of a file like
    // prd.json yields it as a data property) would re-prototype the clone
    // instead of copying the field, and the next clone then throws as an
    // unsupported object, freezing the family (critic sol №1)
    for (const [k, v] of Object.entries(value)) Object.defineProperty(out, k, { value: cloneNode(v, seen), enumerable: true, writable: true, configurable: true })
    return out
  }
  const name = (value as { constructor?: { name?: string } }).constructor?.name
  throw new TypeError('cloneState: unsupported ' + (name === undefined || name === '' ? 'object' : name))
}

export function cloneState<T>(value: T): T {
  return cloneNode(value, new Map<object, unknown>()) as T
}
