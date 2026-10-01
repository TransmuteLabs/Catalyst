import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { NS_SESS, EXT_WRITER, v3Key } from './world'

declare const console: { log(s: string): void }
const drain = async () => { for (let i = 0; i < 1200; i++) await Promise.resolve() }
const gate = () => { let open!: () => void; const p = new Promise<void>(r => { open = r }); return { p, open } }
const snap = () => SL.__stateSnapshot() as Record<string, any>
const diag = (key: string) => SL.__diag().filter(d => d.key === key)
const make = () => {
  SL.__resetState()
  const h: Record<string, any> = {}
  SL.register(((event: string, ...args: any[]) => { h[event] = args[args.length - 1] }) as never, {} as never)
  const m = new Map<string, any>(), arms: Array<{ fn: () => void; cancelled: boolean }> = []
  let mono = 0, wall = 5000
  SL.__setNow(() => mono)
  const store = { keys: async () => [...m.keys()], get: async (k: string): Promise<any> => m.get(k), set: async (k: string, v: any) => { m.set(k, v) }, delete: async (k: string) => { m.delete(k) } }
  const $: any = {
    clock: { now: async () => wall, after: (_ms: number, fn: () => void) => { const a = { fn, cancelled: false }; arms.push(a); return { cancel() { a.cancelled = true } } }, every: () => ({ cancel() {} }) },
    store, session: { id: async () => 'A', cwd: async () => '/work', root: async () => '/work', usage: async () => ({ context: { tokens: 1, window: 2 }, rateLimits: [], cost: { usd: 0 } }), model: async () => 'm', turns: async () => 0, messages: async () => [], surfaces: async () => ['terminal'] },
    env: { get: async () => '' }, fs: { read: async () => '' }, process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
    config: { list: async () => [], set: async () => undefined }, command: { register: async () => undefined },
    ui: { log: async () => undefined, invalidate: () => undefined, status: () => undefined, toast: () => undefined, open: async () => undefined, close: async () => undefined }, plugin: { name: 'catalyst-statusline', root: '/stand' },
  }
  const tick = () => { mono += 15001; wall += 15001 }
  const fire = () => { for (const a of arms.filter(a => !a.cancelled)) a.fn() }
  const publish = async (id: string) => {
    SL.__feed({ source: { kind: 'event', event: 'turn.complete' } as never, ok: true, data: { turnId: id, usage: { input_tokens: 5, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }, now: wall })
    await h['session.end']($, {}, async () => ({})); await drain()
  }
  const foreign = v3Key(NS_SESS, 'foreign', EXT_WRITER, 1)
  const seed = () => m.set(foreign, { session: 'foreign', seq: (5000 + 25 * 3600000) * 1000, sum: { total: 1, in: 1, out: 0, cache: 0 }, seenTurns: [], tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, byName: [], done: [] }, agents: { map: [], done: [] }, started: true, resumed: false, resumedDecided: true, mainTurns: 0 })
  return { h, m, store, $, tick, fire, publish, foreign, seed }
}

test('#551 T60 (P1): a bound on keys, get and delete releases prune for the next trigger', async () => {
  for (const call of ['keys', 'get', 'delete'] as const) {
    const w = make(), held = gate()
    let entered = 0
    try {
      await SL.restoreAfterReload(w.$, {} as never); w.seed()
      const original = w.store[call]
      w.store[call] = (async (...args: any[]) => { if (call === 'keys' || args[0] === w.foreign) { entered++; await held.p }; return (original as any)(...args) }) as never
      await w.publish('held-' + call)
      expect(entered).toBe(1)
      w.fire(); await drain()
      expect({ call, flight: snap()['pruneInFlight'], refused: diag('session-snapshot-prune').length }).toEqual({ call, flight: false, refused: 1 })
      w.store[call] = original as never; w.tick(); await w.publish('retry-' + call)
      expect(w.m.has(w.foreign)).toBe(false)
    } finally { held.open(); await drain(); SL.__resetState() }
  }
})

test('#551 T61 (P1): a late get from a completed pass cannot delete or release the newer pass', async () => {
  const w = make(), old = gate(), newer = gate()
  let deletes = 0, reads = 0
  try {
    await SL.restoreAfterReload(w.$, {} as never); w.seed()
    const get = w.store.get, del = w.store.delete
    w.store.get = async k => { if (k === w.foreign) { reads++; await (reads === 1 ? old.p : newer.p) }; return get(k) }
    w.store.delete = async k => { if (k === w.foreign) deletes++; await del(k) }
    await w.publish('old'); w.fire(); await drain()
    expect(snap()['pruneInFlight']).toBe(false)
    w.tick(); await w.publish('new')
    old.open(); await drain()
    expect({ reads, deletes, flight: snap()['pruneInFlight'] }).toEqual({ reads: 2, deletes: 0, flight: true })
    newer.open(); await drain(); expect(deletes).toBe(1)
  } finally { old.open(); newer.open(); await drain(); SL.__resetState() }
})

test('#551 T62 (P1): dropped after callbacks cannot permanently hold prune keys', async () => {
  const w = make(), held = gate()
  let reads = 0
  try {
    await SL.restoreAfterReload(w.$, {} as never); w.seed()
    w.$.clock.after = () => ({ cancel() {} })
    const keys = w.store.keys
    w.store.keys = async () => { reads++; if (reads === 1) await held.p; return keys() }
    await w.publish('old'); w.tick(); await w.publish('retry')
    expect({ reads, present: w.m.has(w.foreign), hung: diag('session-snapshot-prune-hung').length, flight: snap()['pruneInFlight'] }).toEqual({ reads: 2, present: false, hung: 1, flight: false })
    held.open(); await drain(); expect(diag('session-snapshot-prune-hung')).toHaveLength(1)
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T63 (P3): synchronous now and refused cancel leave no orphan deadline rejection', async () => {
  const w = make(); let cancels = 0
  try {
    w.$.clock.now = () => { throw new Error('sync now refused') }
    w.$.clock.after = (_ms: number, fn: () => void) => { w.$.fire = fn; return { cancel() { cancels++; throw new Error('cancel refused') } } }
    await SL.__pictureReadClock(w.$); w.$.fire(); await drain()
    expect(cancels).toBe(1); expect(snap()['clockFailed']).toBe(true)
  } finally { SL.__resetState() }
})

test('#551 T64 (P3 control): asynchronous now refusal also handles an uncancelled deadline', async () => {
  const w = make()
  try {
    w.$.clock.now = async () => { throw new Error('async now refused') }
    w.$.clock.after = (_ms: number, fn: () => void) => { w.$.fire = fn; return { cancel() { throw new Error('cancel refused') } } }
    await SL.__pictureReadClock(w.$); w.$.fire(); await drain()
    expect(snap()['clockFailed']).toBe(true)
  } finally { SL.__resetState() }
})

const restoreClockCase = (target: number, label: string) => async () => {
  const w = make(), held = gate()
  let calls = 0, done = false
  try {
    w.$.clock.after = () => ({ cancel() {} })
    w.$.clock.now = async () => { calls++; if (calls === target) await held.p; return 5000 }
    const pending = SL.restoreAfterReload(w.$, {} as never).then(() => { done = true })
    await drain(); expect(calls).toBe(target); expect(done).toBe(false)
    w.tick(); await SL.__pictureReadClock(w.$); await drain()
    expect({ label, done, recovery: snap()['recovery'].status }).toEqual({ label, done: true, recovery: 'complete' })
    const before = SL.__diag(); held.open(); await pending; await drain(); expect(SL.__diag()).toEqual(before)
  } finally { held.open(); await drain(); SL.__resetState() }
}
test('#551 T65 (P2): dropped after and hung now release epoch bootstrap', restoreClockCase(1, 'epoch bootstrap'))
test('#551 T66 (P2): dropped after and hung now release open flags', restoreClockCase(2, 'open flags'))
test('#551 T67 (P2): dropped after and hung now release newest snapshot', restoreClockCase(3, 'newest snapshot'))
test('#551 T68 (P2): dropped after and hung now release recovery application', restoreClockCase(4, 'recovery application'))

test('#551 T69 (P2): a new timer sync frees a hung clock at the queue head', async () => {
  const w = make(), held = gate(); let calls = 0, first = false, second = false
  try {
    w.$.clock.after = () => ({ cancel() {} })
    w.$.clock.now = async () => { calls++; if (calls === 1) await held.p; return 5000 }
    const a = SL.__syncSourceTimers(w.$).then(() => { first = true })
    await drain(); expect(calls).toBe(1)
    w.tick(); const b = SL.__syncSourceTimers(w.$).then(() => { second = true }); await drain()
    expect({ first, second }).toEqual({ first: true, second: true })
    held.open(); await a; await b
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T70 (P2): the startup env clock cannot keep the started gate closed forever', async () => {
  const w = make(), held = gate(); let clocks = 0
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    let enterEnv = false
    w.$.env.get = async () => { enterEnv = true; return '' }
    w.$.clock.after = () => ({ cancel() {} })
    w.$.clock.now = async () => { clocks++; if (enterEnv) { enterEnv = false; await held.p }; return 5000 }
    const start = w.h['session.start'](w.$, { isInteractive: true }, async () => ({}))
    await drain(); expect(snap()['started']).toBe(true)
    const before = clocks; w.tick(); await SL.__pictureReadClock(w.$); await drain()
    expect(clocks).toBeGreaterThan(before + 1)
    held.open(); await start; await drain()
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T71 (P2): a read-back held at its clock releases verifyPending after a process-clock sweep', async () => {
  const w = make(), held = gate(); let clockPending = false, entered = false
  try {
    await SL.restoreAfterReload(w.$, {} as never); await w.publish('own')
    w.tick()
    const get = w.store.get
    w.store.get = async k => { const v = await get(k); if (k.startsWith(NS_SESS)) clockPending = true; return v }
    w.$.clock.after = () => ({ cancel() {} })
    w.$.clock.now = async () => { if (clockPending) { clockPending = false; entered = true; await held.p }; return 5000 }
    await SL.__refresh(w.$); await drain()
    expect(entered).toBe(true); expect(snap()['verifyPending'].length).toBe(1)
    w.tick(); await SL.__pictureReadClock(w.$); await drain()
    expect(snap()['verifyPending'].length).toBe(0)
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T72 (P2): a held effort clock does not pin the effortSeed memo', async () => {
  const w = make(), held = gate(); let wantClock = false, entered = false
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.$.config.list = async () => { wantClock = true; return [] }
    w.$.clock.after = () => ({ cancel() {} })
    w.$.clock.now = async () => { if (wantClock) { wantClock = false; entered = true; await held.p }; return 5000 }
    await SL.__refresh(w.$); await drain()
    expect(entered).toBe(true); expect(snap()['effortSeeded']).toBe(false)
    w.tick(); await SL.__pictureReadClock(w.$); await drain()
    expect(snap()['effortSeeded']).toBe(true)
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T73 (P1 damage): a hung damage delete cannot hold prune after its deadline', async () => {
  const w = make(), held = gate(); let entered = false
  try {
    await SL.restoreAfterReload(w.$, {} as never); w.m.set(w.foreign, { broken: true })
    const del = w.store.delete
    w.store.delete = async k => { if (k === w.foreign) { entered = true; await held.p }; await del(k) }
    await w.publish('damage'); expect(entered).toBe(true)
    w.fire(); await drain(); expect(snap()['pruneInFlight']).toBe(false)
    const before = SL.__diag(); held.open(); await drain(); expect(SL.__diag()).toEqual(before)
  } finally { held.open(); await drain(); SL.__resetState() }
})

const button = (tree: any, label: string): (() => void) | undefined => {
  if (!tree || typeof tree !== 'object') return undefined
  if (tree.props?.label === label && typeof tree.props.onPress === 'function') return tree.props.onPress
  for (const child of [tree.children, tree.props?.children].flat(Infinity)) {
    const found = button(child, label); if (found) return found
  }
  return undefined
}

test('#551 T74 (P2): a second picker action frees a hung mark freshness read before joining the action queue', async () => {
  const w = make(), held = gate(); let mark = false, entered = false, closes = 0
  try {
    await w.h['command.run'](w.$, { command: 'statusline-mod', args: '' }, async (v: unknown) => v); await drain()
    expect(snap()['pickerOpen']).toBe(true)
    const set = w.store.set
    w.store.set = async (k, v) => { await set(k, v); if (k.startsWith('statusline.open-closed.v3')) mark = true }
    w.$.ui.close = async () => { closes++ }
    w.$.clock.after = () => ({ cancel() {} })
    w.$.clock.now = async () => { if (mark && !entered) { mark = false; entered = true; await held.p }; return 5000 }
    const close = button(SL.__renderPicker({}, 'layout', 120, undefined, w.store, w.$), 'Закрыть')
    expect(typeof close).toBe('function'); close!(); await drain()
    expect(entered).toBe(true); expect(closes).toBe(0)
    w.tick(); close!(); await drain()
    expect(closes).toBe(2)
    expect(diag('picker-close-mark-clock').length).toBe(1)
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T75 (P2): a close trigger frees a hung restore clock before awaiting the restore gate', async () => {
  const w = make(), held = gate(); let calls = 0, opened = false, closed = false
  try {
    w.$.clock.after = () => ({ cancel() {} })
    w.$.clock.now = async () => { calls++; if (calls === 1) await held.p; return 5000 }
    const opening = w.h['command.run'](w.$, { command: 'statusline-mod', args: '' }, async (v: unknown) => v).then(() => { opened = true })
    await drain(); expect(calls).toBe(1); expect(opened).toBe(false)
    w.tick(); const closing = SL.closeKeepDraft(w.$).then(() => { closed = true }); await drain()
    expect({ opened, closed }).toEqual({ opened: true, closed: true })
    held.open(); await opening; await closing
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T76 (P1 token): a replaced pass with a dropped deadline cannot delete or release its successor', async () => {
  const w = make(), old = gate(), newer = gate(); let reads = 0, deletes = 0
  try {
    await SL.restoreAfterReload(w.$, {} as never); w.seed()
    w.$.clock.after = () => ({ cancel() {} })
    const get = w.store.get, del = w.store.delete
    w.store.get = async k => { if (k === w.foreign) { reads++; await (reads === 1 ? old.p : newer.p) }; return get(k) }
    w.store.delete = async k => { if (k === w.foreign) deletes++; await del(k) }
    await w.publish('old'); w.tick(); await w.publish('new')
    expect(reads).toBe(2); old.open(); await drain()
    expect({ deletes, flight: snap()['pruneInFlight'] }).toEqual({ deletes: 0, flight: true })
    newer.open(); await drain(); expect(deletes).toBe(1)
  } finally { old.open(); newer.open(); await drain(); SL.__resetState() }
})
