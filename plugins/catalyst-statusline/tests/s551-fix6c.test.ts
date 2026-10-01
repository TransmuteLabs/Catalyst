import { expect, test } from 'claude-code/testing'
import * as SL from '../hooks/statusline'
import { NS_SESS, EXT_WRITER, v3Key } from './world'

const drain = async () => { for (let i = 0; i < 1200; i++) await Promise.resolve() }
const settle = async () => { for (let i = 0; i < 6; i++) await drain() }
const gate = () => { let open!: () => void; const p = new Promise<void>(r => { open = r }); return { p, open } }
const diag = (key: string) => SL.__diag().filter(d => d.key === key)
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

test('#551 T91 (R8′ capacity hang): a capacity-stage delete deadline stops the pass; both episodes stay open and a second identical hang adds no warn', async () => {
  const w = make(), c = cap(34)
  const first = gate(), hold1 = gate(), hold2 = gate()
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.hangs.push(first.p); await w.publish('hang')
    seedCap(w.m, c)
    const del = w.store.delete
    w.store.delete = async k => { if (k === c[0]) await hold1.p; await del(k) }
    w.tick(); await w.publish('cap-hang-1')
    w.fire(); await settle()
    expect({
      pass1: { prune: diag('session-snapshot-prune').length, ep: SL.__episodes() },
      keys: { c0: w.m.has(c[0]!), c1: w.m.has(c[1]!), c2: w.m.has(c[2]!), c3: w.m.has(c[3]!) },
    }).toEqual({
      pass1: { prune: 1, ep: ['session-snapshot-prune-hung|sess:', 'session-snapshot-prune|sess:'] },
      keys: { c0: true, c1: false, c2: false, c3: true },
    })
    w.store.delete = async k => { if (k === c[0]) await hold2.p; await del(k) }
    w.tick(); await w.publish('cap-hang-2')
    w.fire(); await settle()
    expect({
      pass2: { prune: diag('session-snapshot-prune').length, hung: diag('session-snapshot-prune-hung').length, ep: SL.__episodes() },
      c0: w.m.has(c[0]!),
    }).toEqual({
      pass2: { prune: 1, hung: 1, ep: ['session-snapshot-prune-hung|sess:', 'session-snapshot-prune|sess:'] },
      c0: true,
    })
  } finally { first.open(); hold1.open(); hold2.open(); await settle(); SL.__resetState() }
})

test('#551 T92 (R8′ refusal then deadline): one outside stage with a refusal before a deadline — the deadline wins the stage, the pass stops before the capacity stage', async () => {
  const w = make(), c = cap(33)
  const first = gate(), hold = gate(), later = gate()
  const x1 = v3Key(NS_SESS, 'x1', EXT_WRITER, 1), x2 = v3Key(NS_SESS, 'x2', EXT_WRITER, 1)
  const order: string[] = []
  try {
    await SL.restoreAfterReload(w.$, {} as never)
    w.hangs.push(first.p); await w.publish('hang')
    w.m.set(x1, body('x1', FAR)); w.m.set(x2, body('x2', FAR)); seedCap(w.m, c)
    const del = w.store.delete
    w.store.delete = async k => { if (k === x1 || k === x2) order.push(k === x1 ? 'x1' : 'x2'); if (k === x1) throw new Error('outside delete refused'); if (k === x2) await hold.p; await del(k) }
    w.tick(); await w.publish('refusal-then-hang')
    w.fire(); await settle()
    expect(order).toEqual(['x1', 'x2'])
    expect({ x1: w.m.has(x1), x2: w.m.has(x2), c0: w.m.has(c[0]!), c1: w.m.has(c[1]!), c2: w.m.has(c[2]!) }).toEqual({ x1: true, x2: true, c0: true, c1: true, c2: true })
    expect(diag('session-snapshot-prune').map(d => d.text.includes('store.delete висит > 15 с'))).toEqual([true])
    expect(SL.__episodes()).toEqual(['session-snapshot-prune-hung|sess:', 'session-snapshot-prune|sess:'])
    w.hangs.push(later.p); w.tick(); await w.publish('hang-again')
    w.tick(); await w.publish('after-hang')
    expect(diag('session-snapshot-prune-hung')).toHaveLength(1)
  } finally { first.open(); hold.open(); later.open(); await settle(); SL.__resetState() }
})
