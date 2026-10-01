import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { NS_SESS, EXT_WRITER, v3Key } from './world'

const drain = async () => { for (let i = 0; i < 1200; i++) await Promise.resolve() }
const settle = async () => { for (let i = 0; i < 6; i++) await drain() }
const gate = () => { let open!: () => void; const p = new Promise<void>(r => { open = r }); return { p, open } }
const diag = (key: string) => SL.__diag().filter(d => d.key === key)
const said = () => diag('session-snapshot-prune').map(d => ({ kind: d.kind, refused: d.text.includes('delete refused') }))
const FAR = (5000 + 10 * 86400000) * 1000
const body = (session: string, seq: number) => ({
  session, seq, origin: 'ffffffffffffffff', n: 0,
  sum: { total: 1, in: 1, out: 0, cache: 0 }, seenTurns: [],
  tools: { sawAny: false, sawTurnComplete: false, doneTotal: 0, errTotal: 0, byName: [], done: [] },
  agents: { map: [], done: [] }, started: true, resumed: false, resumedDecided: true, mainTurns: 0,
})
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
    await h['session.end']($, {}, async () => ({})); await settle()
  }
  // the first keys call of each armed hang waits on its gate; the rest list the store
  const hangs: Array<Promise<void>> = []
  const keys = store.keys
  store.keys = async () => { const held = hangs.shift(); if (held) await held; return keys() }
  return { h, m, store, $, tick, fire, publish, hangs }
}
const cap = (n: number) => Array.from({ length: n }, (_, i) => v3Key(NS_SESS, 'c' + i, EXT_WRITER, 1))
const seedCap = (m: Map<string, any>, keys: string[]) => keys.forEach((k, i) => m.set(k, body('c' + i, (1000 + i) * 1000)))

test('#551 T86 (R8′ outside): a refused outside-window delete is one warn; the next outside key and the capacity stage run in the same pass', async () => {
  const w = make(), c = cap(33)
  const x1 = v3Key(NS_SESS, 'x1', EXT_WRITER, 1), x2 = v3Key(NS_SESS, 'x2', EXT_WRITER, 1)
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.m.set(x1, body('x1', FAR)); w.m.set(x2, body('x2', FAR)); seedCap(w.m, c)
    const del = w.store.delete
    w.store.delete = async k => { if (k === x1) throw new Error('outside delete refused'); await del(k) }
    await w.publish('outside-refusal')
    expect({ x1: w.m.has(x1), x2: w.m.has(x2), c0: w.m.has(c[0]!), c1: w.m.has(c[1]!), c2: w.m.has(c[2]!) }).toEqual({ x1: true, x2: false, c0: false, c1: false, c2: true })
    expect(said()).toEqual([{ kind: 'warn', refused: true }])
  } finally { SL.__resetState() }
})

test('#551 T87 (R8′ capacity): a refused capacity delete is one warn; the other deletes of the stage run and the pass ends the hung episode', async () => {
  const w = make(), c = cap(34), first = gate(), later = gate()
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.hangs.push(first.p); await w.publish('hang')
    seedCap(w.m, c)
    const del = w.store.delete
    w.store.delete = async k => { if (k === c[0]) throw new Error('capacity delete refused'); await del(k) }
    w.tick(); await w.publish('capacity-refusal')
    expect({ c0: w.m.has(c[0]!), c1: w.m.has(c[1]!), c2: w.m.has(c[2]!), c3: w.m.has(c[3]!), hung: diag('session-snapshot-prune-hung').length }).toEqual({ c0: true, c1: false, c2: false, c3: true, hung: 1 })
    expect(said()).toEqual([{ kind: 'warn', refused: true }])
    w.hangs.push(later.p); w.tick(); await w.publish('hang-again')
    w.tick(); await w.publish('after-hang')
    expect({ hung: diag('session-snapshot-prune-hung').length, said: said().length }).toEqual({ hung: 2, said: 1 })
  } finally { first.open(); later.open(); await settle(); SL.__resetState() }
})

test('#551 T88 (R8′ episode): two passes with a refused delete are one warn; the refused pass ends the hung episode only', async () => {
  const w = make(), first = gate(), later = gate()
  const x = v3Key(NS_SESS, 'x', EXT_WRITER, 1)
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.hangs.push(first.p); await w.publish('hang')
    w.m.set(x, body('x', FAR))
    const del = w.store.delete
    w.store.delete = async k => { if (k === x) throw new Error('outside delete refused'); await del(k) }
    w.tick(); await w.publish('refused-1')
    expect({ hung: diag('session-snapshot-prune-hung').length, said: said() }).toEqual({ hung: 1, said: [{ kind: 'warn', refused: true }] })
    w.tick(); await w.publish('refused-2')
    expect({ present: w.m.has(x), said: said() }).toEqual({ present: true, said: [{ kind: 'warn', refused: true }] })
    w.hangs.push(later.p); w.tick(); await w.publish('hang-again')
    w.tick(); await w.publish('refused-3')
    expect({ hung: diag('session-snapshot-prune-hung').length, said: said().length }).toEqual({ hung: 2, said: 1 })
  } finally { first.open(); later.open(); await settle(); SL.__resetState() }
})

test('#551 T89 (R8′ damage episode): a pass with a refused damage delete keeps the refusal episode open', async () => {
  const w = make()
  const d = v3Key(NS_SESS, 'damaged', EXT_WRITER, 1)
  let refuseKeys = true
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    const keys = w.store.keys, del = w.store.delete
    w.store.keys = async () => { if (refuseKeys) { refuseKeys = false; throw new Error('keys refused') }; return keys() }
    w.store.delete = async k => { if (k === d) throw new Error('damage delete refused'); await del(k) }
    await w.publish('refuse')
    expect(diag('session-snapshot-prune')).toHaveLength(1)
    w.m.set(d, { broken: true })
    w.tick(); await w.publish('damage-refused')
    expect({ present: w.m.has(d), said: diag('store-damage').filter(x => x.text.includes('damage delete refused')).length }).toEqual({ present: true, said: 1 })
    refuseKeys = true
    w.tick(); await w.publish('refuse-again')
    expect({ refuseKeys, prune: diag('session-snapshot-prune').length }).toEqual({ refuseKeys: false, prune: 1 })
  } finally { SL.__resetState() }
})

test('#551 T90 (R8′ hang): an outside delete deadline stops the pass over a refusal of the same stage; the hung episode stays open', async () => {
  const w = make(), c = cap(33), first = gate(), hold = gate(), later = gate()
  const x1 = v3Key(NS_SESS, 'x1', EXT_WRITER, 1), x2 = v3Key(NS_SESS, 'x2', EXT_WRITER, 1)
  let entered = 0
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.hangs.push(first.p); await w.publish('hang')
    w.m.set(x1, body('x1', FAR)); w.m.set(x2, body('x2', FAR)); seedCap(w.m, c)
    const del = w.store.delete
    w.store.delete = async k => { if (k === x1) { entered++; await hold.p }; if (k === x2) throw new Error('outside delete refused'); await del(k) }
    w.tick(); await w.publish('outside-hang')
    expect({ entered, hung: diag('session-snapshot-prune-hung').length }).toEqual({ entered: 1, hung: 1 })
    w.fire(); await settle()
    expect({ x1: w.m.has(x1), x2: w.m.has(x2), c0: w.m.has(c[0]!), c1: w.m.has(c[1]!) }).toEqual({ x1: true, x2: true, c0: true, c1: true })
    expect(diag('session-snapshot-prune').map(d => d.text.includes('store.delete висит > 15 с'))).toEqual([true])
    w.hangs.push(later.p); w.tick(); await w.publish('hang-again')
    w.tick(); await w.publish('after-hang')
    expect(diag('session-snapshot-prune-hung')).toHaveLength(1)
  } finally { first.open(); hold.open(); later.open(); await settle(); SL.__resetState() }
})
