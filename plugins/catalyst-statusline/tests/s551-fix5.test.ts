import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { NS_SESS, EXT_WRITER, v3Key } from './world'

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
  return { h, m, store, $, tick, fire, publish, foreign }
}

test('#551 T77 (R1): a clean prune closes the hung episode before the next hang', async () => {
  const w = make(), held = gate(); let reads = 0
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.$.clock.after = () => ({ cancel() {} })
    const keys = w.store.keys
    w.store.keys = async () => { reads++; if (reads === 1 || reads === 3) await held.p; return keys() }
    await w.publish('first-hang'); w.tick(); await w.publish('first-clean')
    expect({ reads, flight: snap()['pruneInFlight'], hung: diag('session-snapshot-prune-hung').length }).toEqual({ reads: 2, flight: false, hung: 1 })
    w.tick(); await w.publish('second-hang'); w.tick(); await w.publish('second-clean')
    expect({ reads, flight: snap()['pruneInFlight'], hung: diag('session-snapshot-prune-hung').length }).toEqual({ reads: 4, flight: false, hung: 2 })
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T78 (R2 refusal): a refused damage delete names its key and the next damage is deleted in the same pass', async () => {
  const w = make(), next = gate(); const other = v3Key(NS_SESS, 'other', EXT_WRITER, 2)
  let refused = 0, deleted = 0
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.m.set(w.foreign, { broken: true }); w.m.set(other, { broken: true })
    const get = w.store.get, del = w.store.delete
    w.store.get = async k => { if (k === other) await next.p; return get(k) }
    w.store.delete = async k => { if (k === w.foreign) { refused++; throw new Error('damage delete refused') }; if (k === other) deleted++; await del(k) }
    await w.publish('refusal'); expect(refused).toBe(1)
    next.open(); await drain()
    expect({ refused, deleted, present: w.m.has(other), flight: snap()['pruneInFlight'] }).toEqual({ refused: 1, deleted: 1, present: false, flight: false })
    expect(diag('store-damage').some(d => d.text.includes(w.foreign) && d.text.includes('damage delete refused'))).toBe(true)
    expect(diag('session-snapshot-prune')).toHaveLength(0)
  } finally { next.open(); await drain(); SL.__resetState() }
})

test('#551 T79 (R2 hang): a damage deadline stops the pass before a later key can be deleted', async () => {
  const w = make(), held = gate(), next = gate(); const other = v3Key(NS_SESS, 'other', EXT_WRITER, 2)
  let entered = 0, deleted = 0, latest!: () => void, damageDeadline!: () => void
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.m.set(w.foreign, { broken: true }); w.m.set(other, { broken: true })
    w.$.clock.after = (_ms: number, fn: () => void) => { latest = fn; return { cancel() {} } }
    const get = w.store.get, del = w.store.delete
    w.store.get = async k => { if (k === other) await next.p; return get(k) }
    w.store.delete = async k => { if (k === w.foreign) { entered++; damageDeadline = latest; await held.p }; if (k === other) deleted++; await del(k) }
    await w.publish('hang'); expect(entered).toBe(1)
    damageDeadline(); await drain(); next.open(); await drain()
    expect({ deleted, present: w.m.has(other), flight: snap()['pruneInFlight'] }).toEqual({ deleted: 0, present: true, flight: false })
    expect(diag('session-snapshot-prune')).toHaveLength(1)
  } finally { held.open(); next.open(); await drain(); SL.__resetState() }
})

test('#551 T80 (R6): a generation change inside prune records session snapshot prune staleDrop', async () => {
  const w = make(), held = gate(); let entered = false
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    const keys = w.store.keys
    w.store.keys = async () => { entered = true; await held.p; return keys() }
    await w.publish('old'); expect(entered).toBe(true)
    SL.__resetState(); held.open(); await drain()
    expect(diag('stale-session snapshot prune').some(d => d.text.includes('session snapshot prune'))).toBe(true)
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T81 (R3 started): only ensureStarted can free the startup env clock before the second start next', async () => {
  const w = make(), held = gate(); let wantClock = false, entered = false, clocks = 0, advance = false, observed = 0
  try {
    await w.h['ui.render'](w.$, { component: 'Pane', requestId: 'statusline', props: {} }, async (v: unknown) => v); await drain()
    w.$.env.get = async () => { if (!entered) wantClock = true; return '' }
    w.$.clock.after = () => { const moves = advance; advance = false; return { cancel() { if (moves) w.tick() } } }
    w.$.clock.now = async () => { clocks++; if (wantClock) { wantClock = false; entered = true; await held.p }; return 5000 }
    await w.h['session.start'](w.$, { isInteractive: true }, async () => ({})); await drain()
    expect(entered).toBe(true); expect(snap()['started']).toBe(true)
    const before = clocks; advance = true
    await w.h['session.start'](w.$, { isInteractive: true }, async () => { await drain(); observed = clocks; return {} })
    expect(observed).toBeGreaterThan(before + 1)
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T82 (R3 restore): a second pane render frees the restore clock without startup or readClock entry', async () => {
  const w = make(), held = gate(); let clocks = 0
  try {
    w.$.clock.after = () => ({ cancel() {} })
    w.$.clock.now = async () => { clocks++; if (clocks === 1) await held.p; return 5000 }
    const pane = { component: 'Pane', requestId: 'statusline', props: {} }
    await w.h['ui.render'](w.$, pane, async (v: unknown) => v); await drain()
    expect(clocks).toBe(1); expect(snap()['recovery'].status).toBe('pending')
    w.tick(); await w.h['ui.render'](w.$, pane, async (v: unknown) => v); await drain()
    expect(snap()['recovery'].status).toBe('complete')
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T83 (R3 session): the second gather reaches recovery memo after its last earlier clock sweep', async () => {
  const w = make(), held = gate(); let wantClock = false, entered = false, first = false, second = false, advance = false
  try {
    w.$.clock.after = () => ({ cancel() {} })
    const keys = w.store.keys
    w.store.keys = async () => { wantClock = true; return keys() }
    w.$.clock.now = async () => { if (wantClock && !entered) { wantClock = false; entered = true; await held.p }; return 5000 }
    const usage = w.$.session.usage
    w.$.session.usage = async () => { if (advance) { advance = false; w.tick() }; return usage() }
    const a = SL.__refresh(w.$).then(() => { first = true }); await drain()
    expect(entered).toBe(true); expect(first).toBe(false)
    advance = true; const b = SL.__refresh(w.$).then(() => { second = true }); await drain()
    expect({ first, second, recovery: snap()['recovery'].status }).toEqual({ first: true, second: true, recovery: 'complete' })
    await a; await b
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T84 (R3 verify): only verifyStore releases read-back before the second gather info source', async () => {
  const w = make(), held = gate(); let wantClock = false, entered = false, advance = false, observed = -1
  try {
    await SL.restoreAfterReload(w.$, {} as never); await w.publish('own'); w.tick()
    const get = w.store.get
    w.store.get = async k => { const value = await get(k); if (k.startsWith(NS_SESS) && !entered) wantClock = true; return value }
    w.$.clock.after = () => { const moves = advance; advance = false; return { cancel() { if (moves) w.tick() } } }
    w.$.clock.now = async () => { if (wantClock) { wantClock = false; entered = true; await held.p }; return 5000 }
    await SL.__refresh(w.$); await drain()
    expect(entered).toBe(true); expect(snap()['verifyPending'].length).toBe(1)
    w.$.session.cwd = async () => { await drain(); observed = snap()['verifyPending'].length; return '/work' }
    advance = true; await SL.__refresh(w.$); await drain()
    expect(observed).toBe(0)
  } finally { held.open(); await drain(); SL.__resetState() }
})

test('#551 T85 (R3 effort): the second gather advances process time after verify and before the effort memo', async () => {
  const w = make(), held = gate(); let wantClock = false, entered = false, advance = false
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.$.config.list = async () => { if (!entered) wantClock = true; return [] }
    w.$.clock.after = () => ({ cancel() {} })
    w.$.clock.now = async () => { if (wantClock) { wantClock = false; entered = true; await held.p }; return 5000 }
    await SL.__refresh(w.$); await drain()
    expect(entered).toBe(true); expect(snap()['effortSeeded']).toBe(false)
    w.$.session.turns = async () => { if (advance) { advance = false; w.tick() }; return 0 }
    let observed = false
    const usage = w.$.session.usage
    w.$.session.usage = async () => { await drain(); observed = snap()['effortSeeded']; return usage() }
    advance = true; await SL.__refresh(w.$); await drain()
    expect(observed).toBe(true)
  } finally { held.open(); await drain(); SL.__resetState() }
})
