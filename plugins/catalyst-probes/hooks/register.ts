// CONSTRAINT: on(event) argument is a string literal; $ only as $.noun.verb
// call sites; env names string literals (loader scans them). process/Bun undefined.
// One module per plugin: this file IS the core. Consultants are [probe.<id>]
// in probes.toml — a new judge is a table + prompt.md, not a new plugin.
// Prompt authorship is [prompt.<id>] in the same file: one section, tool
// description or command description per table. The dispatch rule is a
// built-in table so its default stays identical to the splice.
// Judge cancel: await the consult, then next(e) or {deny: reason} —
// same as the splice. No PENDING retry. $.fs.write overwrites; never RMW journal.jsonl.
// $.store keys max 256 chars. $.store is per-plugin across sessions: PWD
// first for cwd; last-consultation keys include a cwd tail.

const CWD_KEY = "catalyst-probes:cwd"
const CAP_KEY = "catalyst-probes:sesscap"
// CONSTRAINT: умолчание срока жизни вердиктного кэша живёт в ОДНОМ доме --
// чтение в tool.call и порог уборки sweepVerdictStore обязаны совпадать.
const VERDICT_TTL_MS_DEFAULT = 120000
// CONSTRAINT: версия дублируется в .claude-plugin/plugin.json НАМЕРЕННО --
// манифест читает установщик, константу -- улика. Сверять их В ТЕСТЕ нельзя:
// раннеру официального харнеса манифест недоступен (JSON-импорт парсится как
// JS, node:fs запрещён), поэтому units.test.ts пинит литерал, а расхождение
// трёх домов ловит tests/scripts/test-mod-units.sh (ВЕРСИЯ_МОДА_РАЗОШЛАСЬ).
export const MOD_VERSION = "0.1.40"
// CONSTRAINT: пятичасовой лимит провайдера не должен запирать восстановившуюся
// ступень на пять часов; окно 15 минут допускает четыре повторные пробы в час.
export const RUNG_COOLDOWN_MS = 900000
export const FAILOVER_MAX_NEXT = 3
export const FAILOVER_BIND_CAP = 512
export const COACHING =
  "A subagent dispatch may be reviewed before it runs. " +
  "If one is cancelled, the tool result states the reason: treat that reason as a correction to apply. " +
  "Reissue the dispatch only with the change it names, and never repeat the identical call - an unchanged retry cannot succeed. " +
  "This review is separate from the permission system and from any routing gate, so do not attribute a cancellation to either."
// CONSTRAINT: пин обязан совпадать с sha256 текста RULE шага 26 сплайса
// (Catalyst-CC-Patch/tweakcc-patch.js) и с sha256(COACHING) выше: побайтовый
// паритет двух домов охраняют юнит units.test.ts и ступень 2
// tests/scripts/check-splice-parity.sh (путь к киту -- CATALYST_PATCH_KIT).
// Намеренная смена формулировки правит ОБА дома и ЭТОТ пин вместе.
export const COACHING_SPLICE_SHA256 = "c1b580c5baea717e6236200a8b96d5f78e80750484ec6d0dde87a3d6b5d08bb5"
const FORM_REQ = [
  "brief_path","brief_ref","brief_head","brief_tail","report_path","fence",
  "arm_line","arm_ellipsis","arm_cmd","arm_remote","arm_log","witness_remote",
  "witness_worker","open_door","negation","rule_line","path_line",
  "decision_head","decision_basis","decision_referent","legalize",
  "git_commit","git_commit_ok","git_msg","git_push","git_push_ok","git_force",
  "trailer_a","trailer_b","write_redirect","heredoc",
]

// CONSTRAINT: часы поверхности ЖДУТ и читаются ТОЛЬКО отсюда. Часы стали
// АСИНХРОННЫМИ: на 2.1.270 вызов возвращал число, на 2.1.272 -- промис
// (замерено зондом clock-probe: `[object Promise]`, `JSON.stringify` даёт `{}`,
// после `await` -- миллисекунды). Вызов без ожидания не отказывает, а молча
// отдаёт объект: улики с 13:01 15.09 несут `t0:{}` вместо миллисекунд,
// арифметика даёт NaN, окно мемоизации не закрывается никогда, а
// `new Date(x).toISOString()` бросает и уносит с собой строку журнала под
// глухим catch. Фолбэк на платформенные часы оставлен на случай, когда
// поверхность отдаст непригодное и после ожидания, и он не скрывается --
// улика помечается `clockBad`.
let clockBad = false

async function nowMs($: any): Promise<number> {
  let v: any = null
  try { v = await $.clock.now() } catch (x) { v = null }
  if (typeof v === "number" && isFinite(v)) return v
  clockBad = true
  return Date.now()
}

// CONSTRAINT: временную границу ступени держит ЭТОТ сторож, а не одна лишь
// просьба `arg.timeoutMs`. Ту границу исполняет образ (шаг 31 патча), и её
// нет вовсе, когда поле не доехало; а переход по лестнице в runProbe делается
// ТОЛЬКО через catch -- поэтому вызов, который не вернулся и не бросил,
// останавливал лестницу навсегда: измерено 2026-09-16, диспатч не стартовал
// час при живом прокси и работающих ступенях.
// Гонка НЕ отменяет висящий запрос (мод-API сигнала отмены не принимает:
// `complete(request)` и только) -- она освобождает лестницу, оставляя запрос
// доживать в фоне.
async function raceDeadline($: any, work: Promise<any>, ms: number, label: string, rec: any): Promise<any> {
  if (!(typeof ms === "number" && isFinite(ms) && ms > 0)) return await work
  let wait: Promise<void> | null = null
  try { wait = $.clock.sleep(ms) } catch (x) { wait = null }
  // CONSTRAINT: часы поверхности могут быть недоступны. Тогда сторожа нет, и
  // это ОБЪЯВЛЯЕТСЯ полем улики, а не подменяется молчаливым ожиданием без
  // границы: отсутствие поля означало бы «граница была», ПУСТО != НОЛЬ.
  if (!wait) { rec.deadlineBlind = true; return await work }
  // CONSTRAINT: часы отказывают ОТКЛОНЁННЫМ ПРОМИСОМ, а не броском (замер
  // 2026-09-16: зуб с отключёнными часами терял ОБЕ ответившие ступени) --
  // try выше ловит только синхронную форму. Отказ прибора не вправе гасить
  // ступень: несостоявшееся ожидание становится вечным, и гонку решает работа.
  const armed = wait.then(
    () => { throw new Error("rung-deadline " + label + " " + ms + "ms") },
    (x: any) => {
      rec.deadlineBlind = true
      rec.deadlineBlindErr = String((x && x.message) || x).slice(0, 160)
      return new Promise<never>(() => {})
    },
  )
  return await Promise.race([work, armed])
}

function envOn(v: any): boolean {
  const s = String(v ?? "").trim().toLowerCase()
  return !(s === "" || s === "0" || s === "false" || s === "off" || s === "no")
}

function formOn(v: any): boolean {
  const s = String(v ?? "").trim().toLowerCase()
  return !(s === "0" || s === "false" || s === "off" || s === "no")
}

export function bl3(v: any, defaultTrue: boolean): boolean {
  if (v === undefined || v === null) return defaultTrue
  if (v === false || v === 0) return false
  const s = String(v).trim().toLowerCase()
  if (s === "" || s === "0" || s === "false" || s === "off" || s === "no") return false
  return true
}

export function num(v: any, fallback: number, floor: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10)
  if (!(n >= floor)) return fallback
  return n
}

export function clip(q: string, n: number): string {
  const s = String(q ?? "")
  return s.length > n ? s.slice(0, n) : s
}

function fnv1a(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function safeId(id: string): string {
  let s = ""
  const raw = String(id || "p")
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charAt(i)
    s += /[A-Za-z0-9._-]/.test(c) ? c : "_"
  }
  return s || "p"
}

export function classesOf(prompt: string): string[] {
  const found = String(prompt).match(/\[dispatch-class:[\w-]+\]/g) || []
  const set: string[] = []
  for (let i = 0; i < found.length; i++) {
    const c = found[i].slice(16, -1)
    if (set.indexOf(c) < 0) set.push(c)
  }
  return set
}

export function failoverLadderBind(fo: any, subagentType: string, classId: string, allowedByClass?: any, incomingModel?: string): {
  ladder: string[]
  rungEffort: { [k: string]: string }
  effortBad: { [k: string]: string }
  rungsDropped: number
  source: "agent" | "class" | "default" | "allowed" | "none"
} {
  const empty = { ladder: [] as string[], rungEffort: {} as { [k: string]: string }, effortBad: {} as { [k: string]: string }, rungsDropped: 0, source: "none" as const }
  // CONSTRAINT: allowed -- строго последний уровень. Явная лестница
  // (agent/class/default) -- решение автора; allowed -- допуск клетки и не
  // имеет права её перебить.
  if (fo && typeof fo === "object") {
    const fromAgent = tableRungs(fo.agent && subagentType ? fo.agent[subagentType] : null)
    if (fromAgent.models.length) return { ladder: fromAgent.models, rungEffort: fromAgent.rungEffort, effortBad: fromAgent.effortBad, rungsDropped: fromAgent.dropped, source: "agent" }
    const fromClass = tableRungs(fo.class && classId ? fo.class[classId] : null)
    if (fromClass.models.length) return { ladder: fromClass.models, rungEffort: fromClass.rungEffort, effortBad: fromClass.effortBad, rungsDropped: fromClass.dropped, source: "class" }
    const fromDefault = tableRungs(fo.default)
    if (fromDefault.models.length) return { ladder: fromDefault.models, rungEffort: fromDefault.rungEffort, effortBad: fromDefault.effortBad, rungsDropped: fromDefault.dropped, source: "default" }
  }
  const raw = allowedByClass && classId ? allowedByClass[classId] : null
  if (!Array.isArray(raw) || !raw.length) return empty
  const incoming = String(incomingModel || "")
  const ladder: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i]
    if (typeof m !== "string" || !m) continue
    if (incoming && m === incoming) continue
    ladder.push(m)
  }
  if (!ladder.length) return empty
  // CONSTRAINT: эффорт на этом уровне не выдумывается. Пин клетки живёт во
  // frontmatter агента и в [pins]; выдуманный эффорт хуже отсутствующего.
  // rungsDropped = 0: в allowed нет формы ступени, которую можно уронить.
  return { ladder, rungEffort: {}, effortBad: {}, rungsDropped: 0, source: "allowed" }
}

function allowedTableOf(parsed: any): { usable: true, allowedByClass: { [classId: string]: string[] } } | { usable: false, reason: "unusable" | "noclasses" } {
  const out: { [classId: string]: string[] } = {}
  const classes = parsed && parsed.classes
  if (!classes || typeof classes !== "object" || Array.isArray(classes) || !Object.keys(classes).length) {
    return { usable: false, reason: "noclasses" }
  }
  const ks = Object.keys(classes)
  for (let i = 0; i < ks.length; i++) {
    const id = ks[i]
    const row = classes[id]
    if (!row || typeof row !== "object" || Array.isArray(row)) continue
    if (!Object.prototype.hasOwnProperty.call(row, "allowed")) continue
    const raw = row.allowed
    // CONSTRAINT: поле allowed, которое есть и не является массивом непустых
    // строк, делает таблицу непригодной ЦЕЛИКОМ. Отклонить один ключ и оставить
    // остальные -- отдать потребителю половину таблицы, что хуже, чем не отдать
    // ничего. Отсутствие поля -- законная пустота, не непригодность.
    if (!Array.isArray(raw)) return { usable: false, reason: "unusable" }
    const models: string[] = []
    for (let j = 0; j < raw.length; j++) {
      if (typeof raw[j] !== "string" || !raw[j]) return { usable: false, reason: "unusable" }
      models.push(raw[j])
    }
    out[id] = models
  }
  return { usable: true, allowedByClass: out }
}

function routingCandidates(env: any): { envPath: string, market: string } {
  const envPath = String((env && env.ROUTING_TABLE) || "").trim()
  const root = String((env && env.CONFIG_DIR) || "").trim() || (String((env && env.HOME) || "") + "/.claude")
  return { envPath, market: root + "/plugins/marketplaces/catalyst/hooks/routing-table.toml" }
}

export async function loadAllowedByClass($: any, env: any): Promise<{ allowedByClass: { [classId: string]: string[] }, allowedSrc: string }> {
  // CONSTRAINT: адрес таблицы -- CATALYST_ROUTING_TABLE (тот же handle, что у
  // гварда) либо версионно-свободный marketplace. Относительный путь от дома
  // мода запрещён: версии плагинов расходятся.
  // CONSTRAINT: отсутствие таблицы именуется (absent:<path>), не молчит и не бросает.
  // CONSTRAINT: окно мемо таблицы -- ТО ЖЕ, что у мира (worldFor / WORLD_MEMO_MS).
  // Чтение на каждый диспатч (tool.call без agentId минует кэш мира) запрещено.
  const now = await nowMs($)
  const cand = routingCandidates(env)
  const key = cand.envPath + "\0" + cand.market
  if (allowedMemo && now - allowedMemo.t < WORLD_MEMO_MS && allowedMemo.key === key) {
    return allowedMemo.value
  }
  const chain: string[] = []
  let last = cand.market
  if (cand.envPath) {
    const t = await readText($, cand.envPath)
    if (t.text != null) {
      const got = allowedTableOf(parseToml(t.text))
      if (got.usable) {
        const value = { allowedByClass: got.allowedByClass, allowedSrc: "env" }
        allowedMemo = { t: now, key, value }
        return value
      }
      chain.push("env:" + got.reason)
    } else {
      chain.push("env:absent")
    }
  }
  const t2 = await readText($, cand.market)
  if (t2.text != null) {
    const got = allowedTableOf(parseToml(t2.text))
    if (got.usable) {
      const src = chain.length ? chain.join("→") + "→marketplace" : "marketplace"
      const value = { allowedByClass: got.allowedByClass, allowedSrc: src }
      allowedMemo = { t: now, key, value }
      return value
    }
    chain.push("marketplace:" + got.reason)
  }
  const src = chain.length ? chain.join("→") + "→absent:" + last : "absent:" + last
  const value = { allowedByClass: {}, allowedSrc: src }
  allowedMemo = { t: now, key, value }
  return value
}

export function failoverLadder(fo: any, subagentType: string, classId: string, allowedByClass?: any, incomingModel?: string): string[] {
  return failoverLadderBind(fo, subagentType, classId, allowedByClass, incomingModel).ladder
}

export function nextFailoverModel(ladder: string[], failed: string[]): string | null {
  const rows = Array.isArray(ladder) ? ladder : []
  const skip = Array.isArray(failed) ? failed : []
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i]
    if (!m) continue
    let seen = false
    for (let j = 0; j < skip.length; j++) if (skip[j] === m) { seen = true; break }
    if (!seen) return m
  }
  return null
}

export function failoverAttemptModels(incoming: string, sticky: string | null, ladder: string[]): string[] {
  const out: string[] = []
  const used: string[] = []
  let cur = (sticky && String(sticky)) || String(incoming || "")
  while (out.length < FAILOVER_MAX_NEXT) {
    if (!cur || used.indexOf(cur) >= 0) {
      const n = nextFailoverModel(ladder, used)
      if (!n) break
      cur = n
      continue
    }
    out.push(cur)
    used.push(cur)
    const n = nextFailoverModel(ladder, used)
    if (!n) break
    cur = n
  }
  return out
}

export function isCarrierRefusal(res: any): boolean {
  if (!res || typeof res !== "object") return false
  // CONSTRAINT: оба поля. answer==="" не признак: честный ответ из
  // thinking-блоков несёт пустой текст при живом usage (домен #190).
  // Совпадение имени модели (usage.model) успехом не считается.
  return res.usage === null && res.stopReason === null
}

function parentDir(p: string): string {
  const trimmed = String(p || "").replace(/\/+$/, "")
  const i = trimmed.lastIndexOf("/")
  if (i <= 0) return ""
  return trimmed.slice(0, i)
}

export function normTmp(p: string): string {
  return String(p || "").replace(/^\/private\/tmp\b/, "/tmp")
}

export function resolvePath(p: string, home: string, cwd: string): string {
  let s = String(p)
  if (s.charAt(0) === "~") s = home + s.slice(1)
  if (s.charAt(0) === "/") return s
  return (cwd || ".") + "/" + s
}

// CONSTRAINT: делит только запятая ВЕРХНЕГО уровня -- внутри кавычек, вложенных
// [...] и вложенных {...} запятая не делит. Глубина обязана считать ОБЕ пары
// скобок: пока считались только квадратные, одна строка
// `models = [{ model = "m", effort = "max" }]` рвалась по запятой внутри
// таблицы, и в модель ступени уезжал кусок `{ model = "m"` (измерено 15.09).
function splitTop(s: string): string[] {
  const items: string[] = []
  let cur = ""
  let depth = 0
  let quote = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (quote) {
      cur += c
      if (c === quote) quote = ""
      continue
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    if (c === "[" || c === "{") depth++
    if (c === "]" || c === "}") depth--
    if (c === "," && depth === 0) { items.push(cur); cur = ""; continue }
    cur += c
  }
  items.push(cur)
  return items
}

export function parseVal(raw: string): any {
  let s = String(raw || "").trim()
  if (s.slice(0, 3) === "'''" || s.slice(0, 3) === '"""') {
    const q = s.slice(0, 3)
    const end = s.indexOf(q, 3)
    if (end >= 0) return s.slice(3, end)
  }
  if (s.charAt(0) === '"') {
    const m = /^"([\s\S]*)"\s*(?:#.*)?$/.exec(s)
    if (m) return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"')
  }
  if (s.charAt(0) === "'") {
    const m = /^'([\s\S]*)'\s*(?:#.*)?$/.exec(s)
    if (m) return m[1]
  }
  if (s.charAt(0) === "[") {
    const m = /^\[([\s\S]*)\]\s*(?:#.*)?$/.exec(s)
    if (m) {
      // CONSTRAINT: элемент разбирается тем же parseVal, числа остаются числами
      // (listOf приводит к строке сам).
      const out: any[] = []
      const items = splitTop(m[1])
      for (let i = 0; i < items.length; i++) {
        const el = items[i].trim()
        if (!el) continue
        out.push(parseVal(el))
      }
      return out
    }
  }
  // CONSTRAINT: inline-таблица -- законная форма TOML и единственная, какой
  // ступень записывается ОДНОЙ строкой. Пока её не было, такая строка молча
  // разваливалась на куски-строки, а мусор доезжал до провайдера именем модели.
  // Пара без `=` НЕ роняет разбор и не исчезает: она уходит в __unread той же
  // дорогой, что и непрочитанная строка файла.
  if (s.charAt(0) === "{") {
    const m = /^\{([\s\S]*)\}\s*(?:#.*)?$/.exec(s)
    if (m) {
      const obj: any = {}
      const items = splitTop(m[1])
      const bad: string[] = []
      for (let i = 0; i < items.length; i++) {
        const el = items[i].trim()
        if (!el) continue
        const kv = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*=\s*([\s\S]*)$/.exec(el)
        if (!kv) { bad.push(el.slice(0, 200)); continue }
        const k = kv[1] != null ? kv[1] : (kv[2] != null ? kv[2] : kv[3])
        obj[k] = parseVal(kv[4])
      }
      if (bad.length) obj.__unread = bad
      return obj
    }
  }
  const hash = s.indexOf("#")
  if (hash >= 0) s = s.slice(0, hash).trim()
  if (s === "true") return true
  if (s === "false") return false
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  return s
}

// CONSTRAINT: непрочитанная пара внутри inline-таблицы обязана попасть в ТОТ ЖЕ
// счётчик, что и непрочитанная СТРОКА файла. Свой счётчик у вложенной формы
// разошёлся бы с cfgUnread молча, а cfgUnread -- единственная улика конфига.
// Отметка снимается с узла: разобранная ступень не имеет права нести служебное
// поле дальше в конфиг.
function unreadDeep(v: any, sink: string[]): number {
  if (!v || typeof v !== "object") return 0
  let n = 0
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) n += unreadDeep(v[i], sink)
    return n
  }
  const u = v.__unread
  if (Array.isArray(u)) {
    n += u.length
    for (let i = 0; i < u.length; i++) if (sink.length < 20) sink.push(String(u[i]))
    delete v.__unread
  }
  const ks = Object.keys(v)
  for (let i = 0; i < ks.length; i++) n += unreadDeep(v[ks[i]], sink)
  return n
}

export function parseToml(src: string): any {
  const root: any = {}
  let current: any = root
  function nav(keys: string[], asArray: boolean): any {
    let d: any = root
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]
      if (!d[k] || typeof d[k] !== "object" || Array.isArray(d[k])) d[k] = {}
      d = d[k]
    }
    const last = keys[keys.length - 1]
    if (asArray) {
      if (!Array.isArray(d[last])) d[last] = []
      const obj: any = {}
      d[last].push(obj)
      return obj
    }
    if (!d[last] || typeof d[last] !== "object" || Array.isArray(d[last])) d[last] = {}
    return d[last]
  }
  const lines = String(src || "").split("\n")
  // CONSTRAINT: непрочитанная строка не имеет права исчезать бесследно: у мода
  // нет ни console, ни канала журнала -- улика (cfgUnread) единственная дорога,
  // по которой такая строка становится видимой.
  // CONSTRAINT: счёт отделён от хранения: хранятся первые 20 строк, считается
  // каждая -- потолок хранилища не имеет права быть потолком измерения (иначе
  // «20» неотличимо от «20 и больше»).
  const unread: string[] = []
  let unreadN = 0
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim()
    if (!s || s.charAt(0) === "#") continue
    const aa = /^\[\[(.+)\]\]$/.exec(s)
    if (aa) { current = nav(aa[1].split("."), true); continue }
    const sec = /^\[(.+)\]$/.exec(s)
    if (sec) { current = nav(sec[1].split("."), false); continue }
    // CONSTRAINT: ключ в кавычках -- ОДИН ключ (точки внутри НЕ делят, канон
    // TOML); голый ключ с точками -- путь, узлы создаются как в nav.
    const kv = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*=\s*([\s\S]*)$/.exec(s)
    if (kv) {
      if (kv[3] != null) {
        const path = kv[3].split(".")
        let d: any = current
        for (let j = 0; j < path.length - 1; j++) {
          const k = path[j]
          if (!d[k] || typeof d[k] !== "object" || Array.isArray(d[k])) d[k] = {}
          d = d[k]
        }
        const v = parseVal(kv[4])
        unreadN += unreadDeep(v, unread)
        d[path[path.length - 1]] = v
      } else {
        const v = parseVal(kv[4])
        unreadN += unreadDeep(v, unread)
        current[kv[1] != null ? kv[1] : kv[2]] = v
      }
    } else {
      unreadN++
      if (unread.length < 20) unread.push(s.slice(0, 200))
    }
  }
  if (unread.length) {
    root.__unread = unread
    root.__unreadN = unreadN
  }
  return root
}

function shallowMerge(a: any, b: any): any {
  const out: any = {}
  const ak = Object.keys(a || {})
  for (let i = 0; i < ak.length; i++) out[ak[i]] = a[ak[i]]
  const bk = Object.keys(b || {})
  for (let i = 0; i < bk.length; i++) out[bk[i]] = b[bk[i]]
  return out
}

function listOf(cfg: any, key: string): string[] {
  const f = cfg && cfg.filter
  const v = f && f[key]
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (let i = 0; i < v.length; i++) out.push(String(v[i]))
  return out
}

// CONSTRAINT: ось эффорта -- ЗАКРЫТЫЙ перечень канона (MODEL-ROUTING-PLAYBOOK.md
// §"Effort в Agent-канале": `effort: low|medium|high|xhigh|max`). Сравнение
// строгое и регистрозависимое: значение уезжает провайдеру ДОСЛОВНО (шаг 31
// патча несёт его как reasoning_effort, замер 15.09), поэтому "High" -- такое же
// негодное поле в теле запроса, как "higj".
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"]

// CONSTRAINT: сравнение СТРОГОЕ (===), и это единственная защита от «всего, что
// приводится»: конфиг -- разобранный TOML, где `effort = 3` даёт число, а чужой
// производитель JSON может дать объект с toString. Отдельной проверки типа тут
// нет намеренно -- она была бы мёртвой: её снятие набор зубов не красит
// (измерено 15.09). Заменять === на == запрещено.
export function effortOk(v: any): boolean {
  for (let i = 0; i < EFFORTS.length; i++) if (EFFORTS[i] === v) return true
  return false
}

// CONSTRAINT: отметка -- ОТДЕЛЬНАЯ функция, потому что вызывающий её живёт за
// $ и зубами не покрывается: инлайн-строка в consultBg снималась мутацией молча
// (измерено 15.09). Ставится ДО вызова модели -- негодный эффорт обязан быть
// назван и тогда, когда ступень упала по другой причине.
export function markEffort(rec: any, used: string, rung: any): void {
  if (rung && rung.effortBad) rec["effortBad_" + used] = rung.effortBad
}

type RungItem = {
  model: string
  effort?: string
  effortBad?: string
  max_tokens?: number
  timeout_ms?: number
  context_chars?: number
}

// CONSTRAINT: правило разбора элемента лестницы живёт в ОДНОМ доме --
// судья (rungsOf) и failover (tableRungs) зовут ЭТУ функцию. Вторая копия
// правила -- дефект: богатая форма тогда расходится между дорогами.
function parseRungItem(x: any): RungItem | null {
  if (typeof x === "string" && x) return { model: x }
  if (x && typeof x === "object" && x.model) {
    const r: RungItem = { model: String(x.model) }
    // CONSTRAINT: у max_tokens проверка значения была (num), у эффорта не
    // было вовсе -- негодное значение уезжало провайдеру дословно (#141).
    // Негодное НЕ доезжает и НАЗЫВАЕТСЯ уликой (effortBad_<модель>): молча
    // уронить поле значит сделать опечатку в ступени неотличимой от
    // ступени без эффорта.
    if (x.effort) {
      const ev = String(x.effort)
      if (effortOk(ev)) r.effort = ev
      else r.effortBad = ev.slice(0, 64)
    }
    if (x.max_tokens != null) r.max_tokens = num(x.max_tokens, 0, 1)
    if (x.timeout_ms != null) r.timeout_ms = num(x.timeout_ms, 0, 1)
    if (x.context_chars != null) r.context_chars = num(x.context_chars, 0, 1)
    return r
  }
  return null
}

function tableRungs(table: any): {
  models: string[]
  rungEffort: { [k: string]: string }
  effortBad: { [k: string]: string }
  dropped: number
} {
  const raw = table && table.models
  const models: string[] = []
  const rungEffort: { [k: string]: string } = {}
  const effortBad: { [k: string]: string } = {}
  let dropped = 0
  if (!Array.isArray(raw)) return { models, rungEffort, effortBad, dropped }
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i]
    const r = parseRungItem(x)
    if (!r) {
      // CONSTRAINT: считается ЛЮБОЙ неразобранный элемент, а не только объект
      // без model. Пустая строка и число -- та же опечатка в реестре, и
      // молчаливое их отбрасывание есть ровно тот класс, который эта запись
      // закрывает: ступень исчезла, знаменатель не назван.
      dropped++
      continue
    }
    models.push(r.model)
    if (r.effort && rungEffort[r.model] === undefined) rungEffort[r.model] = r.effort
    if (r.effortBad && effortBad[r.model] === undefined) effortBad[r.model] = r.effortBad
  }
  return { models, rungEffort, effortBad, dropped }
}

export function rungsOf(cfg: any, modelEnv: string): { model: string; effort?: string; effortBad?: string; max_tokens?: number; timeout_ms?: number; context_chars?: number }[] {
  const raw = cfg && cfg.models
  const out: { model: string; effort?: string; effortBad?: string; max_tokens?: number; timeout_ms?: number; context_chars?: number }[] = []
  if (Array.isArray(raw) && raw.length) {
    for (let i = 0; i < raw.length; i++) {
      const r = parseRungItem(raw[i])
      if (r) out.push(r)
    }
  }
  if (!out.length && cfg && cfg.model) out.push({ model: String(cfg.model) })
  if (!out.length) out.push({ model: "glm-5.3" })
  if (modelEnv) {
    // CONSTRAINT: ручка меняет МОДЕЛЬ, не лимиты -- ступень наследует потолки
    // первой ступени конфига.
    const first: any = { ...out[0] }
    first.model = modelEnv
    return [first]
  }
  return out
}

// CONSTRAINT: context_chars ступени разбирался, но не действовал -- потолок
// считался один раз на весь вызов. Потолок обязан быть СВОЙ у каждой ступени:
// иначе назначенный ступени контекст неотличим от общего.
export function rungCtx(rung: any, cfg: any): number {
  const base = num(cfg && cfg.context_chars, 24000, 0) || 24000
  return num(rung && rung.context_chars, base, 0) || base
}

// CONSTRAINT: разбор ответа модели -- ОТДЕЛЬНАЯ чистая функция, потому что
// точка её вызова живёт за $ и зубами не покрывается (урок #141: инлайн-строка
// в consultBg снималась мутацией молча).
//
// CONSTRAINT: форм ответа ДВЕ, и различать их обязан мод, а не оператор.
// Штатный $.model.complete отдаёт СКЛЕЙКУ текстовых блоков (замер байтами
// #190: flatMap по content с фильтром type==="text"), поэтому пустая строка
// означает сразу три разных мира -- модель промолчала, ответ состоял из
// нетекстовых блоков (thinking/tool_use), ответ оборвался по потолку. Шаг 31
// патча по полю detail:true отдаёт полный конверт {text, stopReason, blocks,
// usage}; образ БЕЗ этого шага поле не знает и возвращает строку, поэтому
// detailed=false -- законное состояние, а не отказ.
export type ModelAnswer = {
  text: string
  stopReason: string | null
  blocks: { type: string; len: number }[] | null
  outTok: number | null
  detailed: boolean
}

export function readComplete(raw: any): ModelAnswer {
  const flat: ModelAnswer = { text: "", stopReason: null, blocks: null, outTok: null, detailed: false }
  if (raw === null || raw === undefined) return flat
  if (typeof raw === "object") {
    // CONSTRAINT: конверт опознаётся по СВОИМ полям, а не по типу: объект без
    // них -- чужая форма, и String(объект) дал бы "[object Object]" в роли
    // ответа модели. Пустой text при живом конверте -- ИЗМЕРЕННЫЙ ноль, его
    // и надо отличать от немощи прибора.
    const hasEnvelope = "stopReason" in raw || "blocks" in raw || "usage" in raw
    if (hasEnvelope) {
      const out: ModelAnswer = { text: "", stopReason: null, blocks: null, outTok: null, detailed: true }
      if (typeof raw.text === "string") out.text = raw.text
      if (typeof raw.stopReason === "string") out.stopReason = raw.stopReason
      if (Array.isArray(raw.blocks)) {
        const bs: { type: string; len: number }[] = []
        for (let i = 0; i < raw.blocks.length; i++) {
          const b = raw.blocks[i]
          if (b && typeof b === "object") {
            bs.push({ type: String(b.type ?? "?"), len: num(b.len, 0, 0) })
          }
        }
        out.blocks = bs
      }
      const u = raw.usage
      if (u && typeof u === "object" && typeof u.output_tokens === "number") out.outTok = u.output_tokens
      return out
    }
    return flat
  }
  flat.text = String(raw)
  return flat
}

// Блоки -- ОДНОЙ строкой для улики: протокол «ключ<TAB>значение» обязан
// оставаться однострочным, а перечень типов блоков и есть ответ на вопрос
// «чем был занят ответ, если текста в нём нет».
export function blocksLine(blocks: { type: string; len: number }[] | null): string {
  if (!blocks) return ""
  const out: string[] = []
  for (let i = 0; i < blocks.length; i++) out.push(blocks[i].type + ":" + blocks[i].len)
  return out.join(",")
}

export function parseVerdict(raw: string, rx: string): { kind: string; rest: string } | null {
  const vocab = String(rx || "OK|WARN|BLOCK").replace(/\s+/g, "")
  let re: RegExp
  try { re = new RegExp("^(" + vocab + "):\\s*(.*)$") } catch (x) {
    re = /^(OK|WARN|BLOCK):\s*(.*)$/
  }
  const text = String(raw ?? "")
  const first = text.split("\n")[0].trim()
  const m = re.exec(first)
  if (m) return { kind: m[1], rest: m[2] }
  const lines = text.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const mm = re.exec(lines[i].trim())
    if (mm) return { kind: mm[1], rest: mm[2] }
  }
  return null
}

function outcomeOf(kind: string): string {
  if (kind === "OK" || kind === "WARN" || kind === "SILENT" || kind === "NUDGE") return "ok"
  if (kind === "BLOCK" || kind === "STOP" || kind === "DENY") return "block"
  if (kind === "NONE") return "block_no_verdict"
  // CONSTRAINT: «никто не ответил ВОВРЕМЯ» ПРОПУСКАЕТ диспатч, а не запрещает
  // его (решение юзера 2026-09-16: таймаут -> следующая ступень -> никто не
  // ответил -> пропустить). Это отказ ПРИБОРА, а не вердикт о задаче, и его
  // ценой не может быть остановка работы: судья, который молчит, не вправе
  // запрещать. NONE остаётся за другим случаем -- ступени ОТВЕТИЛИ, но ни в
  // одном ответе не нашлось вердикта.
  if (kind === "TIMEOUT") return "skip"
  // CONSTRAINT: обрезка потолком -- тот же класс, что молчание по времени:
  // ступень НАЧАЛА говорить и была остановлена прибором, вердикта в тексте нет
  // не потому, что судья его не вынес. Отдельное имя (не TIMEOUT) нужно, чтобы
  // журнал различал две причины: по времени лечится ожиданием, по потолку --
  // бюджетом токенов.
  if (kind === "TRUNCATED") return "skip"
  if (kind === "SKIP") return "skip"
  return "skip"
}

function fieldOf(ctx: any, name: string): any {
  if (!name) return undefined
  if (Object.prototype.hasOwnProperty.call(ctx, name)) return ctx[name]
  return undefined
}

function pred(when: any, ctx: any): boolean {
  if (!when || typeof when !== "object") return true
  if (Array.isArray(when.all)) {
    for (let i = 0; i < when.all.length; i++) if (!pred(when.all[i], ctx)) return false
    return true
  }
  if (Array.isArray(when.any)) {
    for (let i = 0; i < when.any.length; i++) if (pred(when.any[i], ctx)) return true
    return when.any.length === 0
  }
  if (when.not) return !pred(when.not, ctx)
  const field = fieldOf(ctx, String(when.field || ""))
  if (Object.prototype.hasOwnProperty.call(when, "equals")) return String(field) === String(when.equals)
  if (Object.prototype.hasOwnProperty.call(when, "in")) {
    const arr = when.in
    if (!Array.isArray(arr)) return false
    const s = String(field)
    for (let i = 0; i < arr.length; i++) if (String(arr[i]) === s) return true
    return false
  }
  if (Object.prototype.hasOwnProperty.call(when, "matches")) {
    try { return new RegExp(String(when.matches)).test(String(field ?? "")) } catch (x) { return false }
  }
  if (Object.prototype.hasOwnProperty.call(when, "count_below")) return Number(field) < Number(when.count_below)
  if (Object.prototype.hasOwnProperty.call(when, "count_at_least")) return Number(field) >= Number(when.count_at_least)
  if (Object.prototype.hasOwnProperty.call(when, "older_than_min")) {
    const last = Number(field || 0)
    if (!last) return true
    return (Number(ctx.now) - last) >= Number(when.older_than_min) * 60000
  }
  if (Object.prototype.hasOwnProperty.call(when, "newer_than_min")) {
    const last = Number(field || 0)
    if (!last) return false
    return (Number(ctx.now) - last) < Number(when.newer_than_min) * 60000
  }
  if (Object.prototype.hasOwnProperty.call(when, "absent")) return field === undefined || field === null || field === ""
  if (Object.prototype.hasOwnProperty.call(when, "present")) return !(field === undefined || field === null || field === "")
  return true
}

async function readText($: any, path: string): Promise<{ text: string | null; unreadable: string }> {
  try {
    const v = await $.fs.read(path)
    if (v === null || v === undefined) return { text: null, unreadable: "" }
    return { text: String(v), unreadable: "" }
  } catch (x) {
    const m = String(x)
    if (m.indexOf("ENOENT") >= 0) return { text: null, unreadable: "" }
    return { text: null, unreadable: m.slice(0, 160) }
  }
}

async function readTextNull($: any, path: string): Promise<string | null> {
  const r = await readText($, path)
  return r.text
}

let journalWriteErr = ""

async function appendJournal($: any, jpath: string, obj: any) {
  // CONSTRAINT: ОДИН дом формата шарда (имя jpath+".shard."+safe(rec)).
  // Отказ записи ПРОБРАСЫВАЕТСЯ; след кладётся в journalWriteErr и уезжает
  // в СЛЕДУЮЩУЮ удачную запись -- пустой catch здесь возвращал бы молчаливую
  // потерю полной улики (тот же класс, что волна 1 чинила у агрегата).
  const recObj = journalWriteErr ? Object.assign({}, obj, { journalWriteErr }) : obj
  const line = JSON.stringify(recObj) + "\n"
  const rec = String((recObj && (recObj.rec || recObj.t)) || ("t" + String(await nowMs($))))
  let safe = ""
  for (let i = 0; i < rec.length; i++) {
    const c = rec.charAt(i)
    safe += /[A-Za-z0-9._-]/.test(c) ? c : "_"
  }
  try {
    await $.fs.write(jpath + ".shard." + safe, line)
    journalWriteErr = ""
  } catch (x) {
    // CONSTRAINT: след НАЗЫВАЕТ владельца отказавшего журнала. Один
    // journalWriteErr обслуживает все пробы, и следующая удачная запись
    // может принадлежать ДРУГОЙ пробе -- без пути читатель отнесёт отказ не
    // к тому журналу. Сообщение носителя путь не гарантирует, поэтому он
    // приписывается здесь.
    journalWriteErr = (jpath + ": " + String((x && (x as any).message) || x)).slice(0, 240)
    throw x
  }
}

async function layerHit($: any, ch: string): Promise<boolean> {
  const r = await readText($, ch + "/probes.toml")
  return !!(r.unreadable || r.text !== null)
}

async function findProjectHome($: any, cwd: string, globalHome: string): Promise<string> {
  if (cwd) {
    let p = cwd
    for (let i = 0; i < 24; i++) {
      if (!p) break
      const ch = p + "/.claude/probes"
      if (normTmp(ch) !== normTmp(globalHome) && await layerHit($, ch)) return ch
      const up = parentDir(p)
      if (!up || up === p) break
      p = up
    }
    return ""
  }
  let dots = ""
  for (let i = 0; i < 24; i++) {
    const rel = dots + ".claude/probes"
    if (await layerHit($, rel)) return rel
    dots = dots + "../"
  }
  return ""
}

function profileOf(id: string, cfg: any): any {
  const kind = String(cfg.kind || (id === "form" ? "form" : "consult"))
  if (id === "judge") {
    return {
      id, cfg, kind: "consult",
      act: String(cfg.act || "cancel"),
      rx: String(cfg.rx || "OK|WARN|BLOCK|STOP|DENY"),
      builtin: true, coaching: true, pending: true,
      mainLoopOnly: true,
    }
  }
  if (id === "idle-watch") {
    return {
      id, cfg, kind: "consult",
      act: String(cfg.act || "nudge"),
      rx: String(cfg.rx || "SILENT|NUDGE"),
      builtin: true, coaching: false, pending: false,
      mainLoopOnly: true,
    }
  }
  if (id === "form" || kind === "form") {
    return {
      id, cfg, kind: "form",
      act: "form",
      rx: "",
      builtin: id === "form", coaching: false, pending: false,
      mainLoopOnly: true,
    }
  }
  return {
    id, cfg, kind,
    act: String(cfg.act || "log_only"),
    rx: String(cfg.rx || "OK|WARN|BLOCK|SILENT|NUDGE"),
    builtin: false,
    coaching: String(cfg.inject_section || "") === "communication:L",
    pending: String(cfg.act || "log_only") === "cancel",
    mainLoopOnly: cfg.subagents !== true,
  }
}

function probesOf(parsed: any, projectParsed: any): any[] {
  const defaults = (parsed && parsed.defaults) || {}
  const pdef = (projectParsed && projectParsed.defaults) || {}
  const baseDef = shallowMerge(defaults, pdef)
  const gProbe = (parsed && parsed.probe) || {}
  const pProbe = (projectParsed && projectParsed.probe) || {}
  const ids: string[] = []
  const gk = Object.keys(gProbe)
  for (let i = 0; i < gk.length; i++) ids.push(gk[i])
  const pk = Object.keys(pProbe)
  for (let i = 0; i < pk.length; i++) if (ids.indexOf(pk[i]) < 0) ids.push(pk[i])
  const out: any[] = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const gt = gProbe[id] || {}
    const pt = pProbe[id] || {}
    const cfg = shallowMerge(baseDef, shallowMerge(gt, pt))
    out.push(profileOf(id, cfg))
  }
  return out
}

// --- Prompt layer -----------------------------------------------------------
// [prompt.<id>] tables author the host's OWN texts at runtime: one section of
// the system prompt, one tool description, or one command description.
// CONSTRAINT: this ports nothing. The tweakcc overlay layer carries ZERO of our
// text (measured 2026-09-12: 901 overlays, class `ours` = 0, with the class
// control passing — the splice's own rule text is live=1/orig=0). The layer is
// a NEW capability, config-driven like the consultants, and it is the only
// prompt authorship that survives a version bump without re-extracting locators.
// Reach measured live on 2.1.267, end to end (the model printed the tokens):
// prompt.section 26 names (main loop; a subagent's assembly carries only
// env_info_model), tool.describe 24, command.describe 254.

function promptProfile(id: string, cfg: any): any {
  let kind = ""
  let target = ""
  if (typeof cfg.section === "string" && cfg.section) { kind = "section"; target = cfg.section }
  if (typeof cfg.tool === "string" && cfg.tool) {
    if (kind) return { id, cfg, skip: "two_targets" }
    kind = "tool"; target = cfg.tool
  }
  if (typeof cfg.command === "string" && cfg.command) {
    if (kind) return { id, cfg, skip: "two_targets" }
    kind = "command"; target = cfg.command
  }
  if (!kind) return { id, cfg, skip: "no_target" }
  const mode = String(cfg.mode || "append").trim().toLowerCase()
  if (mode !== "append" && mode !== "prepend" && mode !== "replace") return { id, cfg, skip: "bad_mode" }
  return { id, cfg, kind, target, mode, text: "", gate: "", skip: "" }
}

// CONSTRAINT: the built-in rule reproduces the splice (injection 26) exactly —
// same text, same gate (carrier `mod` plus CLAUDE_JUDGE on), same site. A
// [prompt.dispatch-rule] table may retarget, remute or disable it, but the
// default with no table present must stay byte-identical to the splice.
function builtinPromptRules(): any[] {
  return [{
    id: "dispatch-rule", builtin: true, kind: "section", target: "communication:L",
    mode: "append", text: COACHING, gate: "judge", cfg: {}, skip: "",
  }]
}

function promptsOf(parsed: any, projectParsed: any): any[] {
  const out = builtinPromptRules()
  const g = (parsed && parsed.prompt) || {}
  const p = (projectParsed && projectParsed.prompt) || {}
  const ids: string[] = []
  const gk = Object.keys(g)
  for (let i = 0; i < gk.length; i++) ids.push(gk[i])
  const pk = Object.keys(p)
  for (let i = 0; i < pk.length; i++) if (ids.indexOf(pk[i]) < 0) ids.push(pk[i])
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const cfg = shallowMerge(g[id] || {}, p[id] || {})
    let hit = -1
    for (let j = 0; j < out.length; j++) if (out[j].id === id) hit = j
    if (hit >= 0) {
      // A built-in keeps its gate; only these keys are overridable, so a table
      // cannot silently strip the judge gate off the dispatch rule.
      const b = out[hit]
      b.cfg = cfg
      if (typeof cfg.section === "string" && cfg.section) b.target = cfg.section
      const m = String(cfg.mode || "").trim().toLowerCase()
      if (m === "append" || m === "prepend" || m === "replace") b.mode = m
      continue
    }
    out.push(promptProfile(id, cfg))
  }
  return out
}

function envSelected(name: string, env: any): boolean {
  // CONSTRAINT: env names are string literals at $.env.get, so `when_env`
  // SELECTS among the already-read bundle. An unknown name is refused rather
  // than read — a typo must not let the text through ungated.
  const n = String(name || "").trim().toUpperCase()
  if (!n) return true
  if (n === "CLAUDE_JUDGE") return envOn(env.JUDGE)
  if (n === "CLAUDE_IDLE") return envOn(env.IDLE)
  if (n === "CLAUDE_FORM") return formOn(env.FORM)
  if (n === "CLAUDE_PROBES") return formOn(env.PROBES)
  if (n === "CLAUDE_PROMPTS") return formOn(env.PROMPTS)
  return false
}

// Cleared when the module reloads (/reload-plugins), which is also when a
// changed text file must be picked up; also cleared at the session boundary
// by newSession().
let promptTextMemo: any = {}

async function ruleText($: any, world: any, r: any): Promise<string> {
  const inline = r.cfg && r.cfg.text
  if (typeof inline === "string" && inline) return inline
  const f = r.cfg && r.cfg.text_file
  if (typeof f === "string" && f) {
    const path = String(f).charAt(0) === "/" ? String(f) : (world.globalHome + "/prompts/" + String(f))
    if (promptTextMemo[path] !== undefined) return promptTextMemo[path]
    const t = await readTextNull($, path)
    promptTextMemo[path] = t === null ? "" : String(t)
    return promptTextMemo[path]
  }
  return String(r.text || "")
}

async function applyPromptRules(
  $: any, world: any, env: any, kind: string, target: string, text: string,
): Promise<{ text: string; applied: string[] }> {
  const applied: string[] = []
  if (!formOn(env.PROMPTS)) return { text, applied }
  const rules = (world && world.prompts) || []
  let out = String(text || "")
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]
    if (r.skip) continue
    if (!bl3(r.cfg && r.cfg.enabled, true)) continue
    if (r.kind !== kind || r.target !== target) continue
    if (r.gate === "judge") {
      if (env.JUDGE_CARRIER.trim().toLowerCase() !== "mod") continue
      if (!envOn(env.JUDGE)) continue
    }
    if (r.cfg && r.cfg.when_env && !envSelected(String(r.cfg.when_env), env)) continue
    const body = await ruleText($, world, r)
    if (!body) continue
    const before = out.length
    if (r.mode === "replace") out = body
    else if (r.mode === "prepend") out = body + "\n\n" + out
    else out = out + "\n\n" + body
    applied.push(r.id)
    try {
      await $.fs.write(
        world.globalHome + "/prompts/records/applied-" + safeId(r.id) + ".json",
        JSON.stringify({
          t: new Date(await nowMs($)).toISOString(), id: r.id, kind: r.kind,
          target: r.target, mode: r.mode, chars_before: before, chars_after: out.length,
          builtin: r.builtin === true,
        }),
      )
    } catch (x) {}
  }
  return { text: out, applied }
}

// CONSTRAINT: command.describe fires 254 times per session and tool.describe 24
// (measured 2026-09-12). Reading probes.toml per call would be 278 file reads
// per session, so the world is memoised for a short window. The world is built
// FROM the working directory (loadWorld -> findProjectHome reads the project
// probes.toml), so the memo MUST be keyed by that directory: a cross-directory
// hit inside the window answers with a foreign projectHome (#308).
const WORLD_MEMO_MS = 5000
let worldMemo: any = null
let allowedMemo: { t: number, key: string, value: { allowedByClass: { [classId: string]: string[] }, allowedSrc: string } } | null = null

export async function worldFor($: any): Promise<any> {
  const now = await nowMs($)
  // CONSTRAINT: каталог -- ключ мемо, поэтому вычисляется ДО кэша той же
  // логикой, что и потребитель (loadWorld), и передаётся ему: повторный
  // расчёт поднимал бы стоимость горячего пути.
  let cwd = ""
  try { cwd = String(await $.env.get("PWD") || "").trim() } catch (x) { cwd = "" }
  if (!cwd) {
    try { cwd = String(await $.store.get(CWD_KEY) || "") } catch (x) { cwd = "" }
  }
  if (cwd && worldMemo && now - worldMemo.t < WORLD_MEMO_MS && worldMemo.cwd === cwd) {
    return worldMemo
  }
  const env = await envBundle($)
  const world = await loadWorld($, env, cwd)
  const packed = { t: now, cwd, env, world }
  // CONSTRAINT: при неопределимом каталоге мемо не используется и не
  // заполняется -- неизвестный ключ никогда не считается совпавшим (#308).
  if (cwd) worldMemo = packed
  return packed
}

// Отсутствие поля sid и есть чинимый дефект: неудача обязана быть ВИДНА
// значением, а не отсутствием ключа. Настоящий sid — имя файла транскрипта
// (UUID), спутать нельзя.
const SID_UNAVAILABLE = "sid-unavailable"

// Идентификатор сессии в пределах процесса неизменен, поэтому кэш без TTL.
// Неудачу НЕ запоминаем: отказ поверхности может быть разовым, а memo живёт
// весь процесс — запомненный sentinel навсегда отнял бы поле.
let sidMemo: string | null = null

async function sidFor($: any): Promise<string> {
  if (sidMemo) return sidMemo
  let v: any = null
  try { v = await $.session.id() } catch (x) { v = null }
  if (typeof v === "string" && v) { sidMemo = v; return v }
  return SID_UNAVAILABLE
}

let rxCache: any = {}
function K(s: string, f: string): RegExp {
  const key = f + "|" + s
  if (rxCache[key]) return rxCache[key]
  const r = new RegExp(s, f)
  rxCache[key] = r
  return r
}

// CONSTRAINT: /clear и /resume НЕ пересоздают процесс, поэтому всё мемо-
// состояние модуля переживает границу сессии, и судья новой сессии отвечал
// бы из памяти прежней (sid вердиктного кэша, мир cwd, тексты промптов,
// регекспы, липкий флаг часов, разовость уборки). Единственная точка сброса
// -- newSession(); epoch дополнительно метит ответы модели, вернувшиеся уже
// из другой сессии (см. consultBg).
let epoch = 0
let sweepDone = false

const failoverBinds = new Map<string, any>()
// CONSTRAINT: недоступность модели относится к процессу, а не к сессии;
// newSession не сбрасывает метки. Ключи — только модели лестниц консультаций.
const rungCooldownMarks = new Map<string, number>()

export function noteRungTimeout(model: string, errText: string, atMs: number, marks: Map<string, number> = rungCooldownMarks, budgetClipped: boolean = false): boolean {
  if (errText.indexOf("rung-deadline") < 0) return false
  // CONSTRAINT: урезанный общим пределом бюджет доказывает таймаут,
  // но не недоступность модели; существующая метка тоже не продлевается.
  if (!budgetClipped) marks.set(model, atMs)
  return true
}

export function rungsAfterCooldown<T extends { model: string }>(ladder: T[], atMs: number, marks: ReadonlyMap<string, number> = rungCooldownMarks): { ladder: T[]; evidence: { [k: string]: any } } {
  const keep: T[] = []
  const skipped: string[] = []
  const ages: { [k: string]: number } = {}
  for (let i = 0; i < ladder.length; i++) {
    const rung = ladder[i]
    const stamp = marks.get(rung.model)
    if (stamp !== undefined && atMs - stamp <= RUNG_COOLDOWN_MS) {
      skipped.push(rung.model)
      ages["rungCooldownAgeMs_" + rung.model] = atMs - stamp
    } else {
      keep.push(rung)
    }
  }
  // CONSTRAINT: пустой фильтр возвращает полный перечень; фактических
  // пропусков в этом случае нет, поэтому нет и полей пропуска в улике.
  if (!keep.length) return { ladder, evidence: {} }
  const evidence: { [k: string]: any } = {}
  if (skipped.length) {
    evidence.rungCooldownSkipped = skipped
    Object.assign(evidence, ages)
  }
  return { ladder: keep, evidence }
}

// --- #178w3: слэш-команда catalyst-ladder ---------------------------------------
// CONSTRAINT: метки остывания живут в процессе, и прочитать их может только
// процесс -- слэш-команда и есть эта дверь наблюдения (#61).
export const LADDER_COMMAND = "catalyst-ladder"
export const LADDER_COMMAND_DESCRIPTION =
  "Ступени лестницы в остывании: версия мода, окно в минутах, модель и сколько " +
  "остывать осталось. Аргумент -- подстрока для фильтра по имени модели."
export const LADDER_COMMAND_ARG_HINT = "[модель]"
// CONSTRAINT: аргумент длиннее 32000 не подаётся в дверь никогда -- граница
// хоста (волна 2 #178, r3: 32000 доставлен, 32001 отвергнут) встречается
// НАШЕЙ обрезкой раньше чужого валидатора.
export const LADDER_COMMAND_ARG_MAX = 32000

export function clipLadderArg(arg: string): string {
  return String(arg || "").slice(0, LADDER_COMMAND_ARG_MAX)
}

// CONSTRAINT: предикат «ещё остывает» -- РОВНО тот, что у rungsAfterCooldown
// (atMs - stamp <= RUNG_COOLDOWN_MS): второй дом правила сделал бы команду и
// фильтр лестницы спорящими об одном окне.
export function cooldownSnapshot(atMs: number, marks: Map<string, number> = rungCooldownMarks): Array<{ model: string; leftMs: number }> {
  const out: Array<{ model: string; leftMs: number }> = []
  marks.forEach((stamp: number, model: string) => {
    if (atMs - stamp <= RUNG_COOLDOWN_MS) {
      out.push({ model, leftMs: RUNG_COOLDOWN_MS - (atMs - stamp) })
    }
  })
  return out
}

// CONSTRAINT: пустая карта и отфильтрованная в ноль -- РАЗНЫЕ явные строки:
// пустой вывод неотличим от молчания команды, а молчание наблюдатель принял бы
// за ноль (ПУСТО != НОЛЬ).
export function ladderCommandText(atMs: number, argRaw: string, marks: Map<string, number> = rungCooldownMarks): string {
  const arg = clipLadderArg(argRaw)
  const snap = cooldownSnapshot(atMs, marks)
  const rows = snap.filter((r) => !arg || r.model.indexOf(arg) >= 0)
  const lines = ["catalyst-ladder " + MOD_VERSION + ": окно остывания " + (RUNG_COOLDOWN_MS / 60000) + " мин"]
  if (!snap.length) {
    lines.push("остывающих ступеней нет")
  } else if (!rows.length) {
    lines.push("под фильтр не попала ни одна ступень")
  } else {
    for (const r of rows) lines.push(r.model + ": остывать ещё " + Math.ceil(r.leftMs / 1000) + " с")
  }
  return lines.join("\n")
}

export function failoverBindReset(): void {
  failoverBinds.clear()
}

export function failoverBindSet(agentId: string, rec: any): void {
  const id = String(agentId || "")
  if (!id || !rec) return
  if (failoverBinds.has(id)) failoverBinds.delete(id)
  failoverBinds.set(id, rec)
  while (failoverBinds.size > FAILOVER_BIND_CAP) {
    const oldest = failoverBinds.keys().next().value
    if (oldest === undefined) break
    failoverBinds.delete(oldest)
  }
}

export function failoverBindGet(agentId: string): any {
  return failoverBinds.get(String(agentId || ""))
}

// CONSTRAINT (#226): исполнитель и проверяющий -- ЯВНЫЕ перечни префиксов
// класса: новый класс не должен присоединиться к правилу незаметно. Класс вне
// обоих перечней -- штатный посторонний, молчать о нём не нужно.
export const EXECUTOR_CLASS_PREFIXES = ["exec-"]
export const REVIEWER_CLASS_PREFIXES = ["crit-", "audit-"]

export function classHasPrefix(classId: string, prefixes: string[]): boolean {
  const c = String(classId || "")
  for (let i = 0; i < prefixes.length; i++) {
    if (prefixes[i] && c.indexOf(prefixes[i]) === 0) return true
  }
  return false
}

// CONSTRAINT (#226): накопитель моделей исполнителей сессии. Потолок 64 имени;
// при переполнении набор НЕ обрезается молча -- добавление прекращается и
// взводится флаг, уезжающий в улику: молча усечённый набор бесшумно выключил
// бы всё правило целиком.
export const SESSION_EXECUTOR_MODELS_CAP = 64
const sessionExecutorModels: string[] = []
let sessionExecutorModelsOverflow = false

export function sessionExecutorsReset(): void {
  sessionExecutorModels.length = 0
  sessionExecutorModelsOverflow = false
}

export function sessionExecutorModelAdd(model: string): void {
  const m = String(model || "")
  if (!m || sessionExecutorModels.indexOf(m) >= 0) return
  if (sessionExecutorModels.length >= SESSION_EXECUTOR_MODELS_CAP) {
    sessionExecutorModelsOverflow = true
    return
  }
  sessionExecutorModels.push(m)
}

export function sessionExecutorHas(model: string): boolean {
  return sessionExecutorModels.indexOf(String(model || "")) >= 0
}

export function failoverWouldSetSticky(didThrow: boolean, res: any, reviewer: boolean, model: string): boolean {
  return !didThrow && !isCarrierRefusal(res) && !(reviewer && sessionExecutorHas(model))
}

// CONSTRAINT: период свёртки 1000 мс. Таймер не переживает смерть процесса,
// поэтому хвост накопленных скучных шагов теряется; типичный turn.step --
// вызов модели (секунды), 1 с ограничивает потерю меньше одного шага.
// Нулевой агрегат файла не пишет: короткий период сам по себе шардов не плодит.
export const FAILOVER_FOLD_PERIOD_MS = 1000

let boringN = 0
let boringT0 = 0
let boringT1 = 0
let boringSticky = ""
// CONSTRAINT (#251): свёртка держит объём (одна agg-запись на окно), но обязана
// вернуть атрибуцию по агенту -- иначе журнал теряет agentId скучных попыток.
// Карта agentId->счёт снимается и возвращается ТЕМ ЖЕ снимком, что boringN
// (влитие при отказе записи -- сложением, не заменой); сумма карты == n.
let boringAgents: Map<string, number> = new Map()
let foldBusy = false
let foldWait: Array<() => void> = []
let foldSeq = 0
let foldWorld: any = null
let foldTimer: { cancel: () => void } | null = null
let foldSid = ""
let foldWriteErr = ""
let foldSplitLost = 0

export function failoverFoldCount(): number {
  return boringN
}

export function failoverFoldNote(tMs: number, sticky?: string, aid?: string): void {
  boringN++
  if (!boringT0) boringT0 = tMs
  boringT1 = tMs
  if (sticky && !boringSticky) boringSticky = String(sticky)
  const a = String(aid || "")
  if (a) boringAgents.set(a, (boringAgents.get(a) || 0) + 1)
}

export function failoverFoldReset(): void {
  boringN = 0
  boringT0 = 0
  boringT1 = 0
  boringSticky = ""
  boringAgents = new Map()
  foldBusy = false
  foldWait = []
  foldWorld = null
  foldSid = ""
  foldWriteErr = ""
  foldSplitLost = 0
  if (foldTimer) {
    try { foldTimer.cancel() } catch (x) {}
    foldTimer = null
  }
}

export function failoverAttemptIsBoring(rec: any, stickyChanged: boolean): boolean {
  if (!rec || rec.outcome !== "ok") return false
  if (Number(rec.attempt) !== 0) return false
  if (stickyChanged) return false
  if (rec.ladderFullTaken) return false
  if (rec.startMatch) return false
  if (rec.stickyDropped) return false
  if (rec.execOverflow) return false
  if (num(rec.rungsFiltered, 0, 0) > 0) return false
  if (num(rec.rungsDropped, 0, 0) > 0) return false
  const ks = Object.keys(rec)
  for (let i = 0; i < ks.length; i++) {
    if (ks[i].indexOf("effortBad_") === 0) return false
  }
  return true
}

function armFailoverFoldTimer($: any, world: any): void {
  if (world) foldWorld = world
  if (foldTimer) return
  try {
    const h = $.clock.every(FAILOVER_FOLD_PERIOD_MS, async () => {
      try { await failoverFoldFlush($, foldWorld) } catch (x) {
        if (!foldWriteErr) foldWriteErr = String((x && (x as any).message) || x).slice(0, 240)
      }
    })
    foldTimer = (h && typeof h.cancel === "function") ? h : { cancel() {} }
  } catch (x) {
    foldTimer = { cancel() {} }
  }
}

function restoreFoldSnapshot(n: number, t0: number, t1: number, sticky: string, agents: Map<string, number>): void {
  boringN += n
  if (!boringT0 || (t0 && t0 < boringT0)) boringT0 = t0
  if (t1 > boringT1) boringT1 = t1
  if (sticky && !boringSticky) boringSticky = sticky
  agents.forEach((c, a) => { boringAgents.set(a, (boringAgents.get(a) || 0) + c) })
}

export async function failoverFoldObserve($: any, world: any, tMs: number, sticky: string, sid: string, aid?: string): Promise<void> {
  const s = String(sticky || "")
  if (boringN > 0 && boringSticky && s && boringSticky !== s) {
    try {
      await failoverFoldFlush($, world)
    } catch (x) {
      // CONSTRAINT: шаг с новой липкостью нельзя влить в возвращённый снимок
      // старого окна. Потеря считается и уезжает в следующую запись полем
      // foldSplitLost -- пишется только при n>0 (отсутствие поля ≠ ноль).
      foldSplitLost++
      throw x
    }
  }
  failoverFoldNote(tMs, s, aid)
  foldSid = sid
  if (s) boringSticky = s
}

export async function failoverFoldFlush($: any, world: any): Promise<void> {
  while (foldBusy) {
    await new Promise<void>(r => { foldWait.push(r) })
  }
  foldBusy = true
  try {
    // CONSTRAINT: доступ к счётчикам сериализует foldBusy (колбэки every
    // перекрываются, замер #175). Снимок забирается под сторожем; отказ
    // записи возвращает снятое (n прибавить, окно t0/t1 расширить, sticky
    // вернуть если текущее пусто, карту агентов #251 влить сложением) -- иначе
    // хвост исчезает, а catch таймера единственной реакцией быть не может.
    const n = boringN
    const t0 = boringT0
    const t1 = boringT1
    const sid = foldSid
    const sticky = boringSticky
    const agents = boringAgents
    const prevErr = foldWriteErr
    boringN = 0
    boringT0 = 0
    boringT1 = 0
    boringSticky = ""
    boringAgents = new Map()
    if (n <= 0) return
    const w = world || foldWorld
    const jpath = w && w.globalHome ? w.globalHome + "/failover/journal.jsonl" : ""
    if (!jpath) {
      restoreFoldSnapshot(n, t0, t1, sticky, agents)
      return
    }
    foldSeq++
    const recKey = "agg-" + String(foldSeq) + "-" + String(t0) + "-" + String(n)
    const rec: any = {
      t: new Date(t1).toISOString(),
      rec: recKey,
      fold: true,
      n,
      sticky,
      tFirst: new Date(t0).toISOString(),
      tLast: new Date(t1).toISOString(),
      dtMs: t1 - t0,
      carrier: "mod",
      probe: "failover",
      sid,
    }
    if (prevErr) rec.foldWriteErr = prevErr
    if (foldSplitLost) rec.foldSplitLost = foldSplitLost
    if (agents.size) rec.agents = Object.fromEntries(agents)
    try {
      await appendJournal($, jpath, rec)
      foldWriteErr = ""
      foldSplitLost = 0
    } catch (x) {
      restoreFoldSnapshot(n, t0, t1, sticky, agents)
      foldWriteErr = String((x && (x as any).message) || x).slice(0, 240)
      throw x
    }
  } finally {
    foldBusy = false
    const nxt = foldWait.shift()
    if (nxt) nxt()
  }
}

function newSession() {
  epoch++
  sidMemo = null
  worldMemo = null
  allowedMemo = null
  promptTextMemo = {}
  rxCache = {}
  clockBad = false
  sweepDone = false
  failoverBindReset()
  sessionExecutorsReset()
  failoverFoldReset()
  journalWriteErr = ""
}

function formKind(p: string, t: string, c: any): string | null {
  const path = String(p ?? "")
  const text = String(t ?? "")
  if (K(c.brief_path, "u").test(path)) {
    if (!text || K(c.brief_head, "iu").test(text.split("\n")[0])) return "brief"
  }
  if (K(c.report_path, "u").test(path)) return "report"
  return null
}

function formEval(ev: any, c: any): { refuse: any[]; warn: any[] } {
  const W: any = { A4: 1, C2: 1 }
  const Rf: any[] = []
  const Wr: any[] = []
  const F = (cl: string, n: number, q: string) => (W[cl] ? Wr : Rf).push({ c: cl, n, q: clip(q, 160) })
  const t = String(ev.text ?? "")
  const ls = t.split("\n")
  let inn = false
  const op = ls.map((l: string) => {
    if (K(c.fence, "u").test(l)) { inn = !inn; return false }
    return !inn
  })
  if (ev.kind === "brief") {
    let ln = -1, ll = ""
    for (let i = 0; i < ls.length; i++) {
      const e = ls[i].trimEnd()
      if (e) { ln = i + 1; ll = e }
    }
    if (ln < 0) F("A1", 0, "")
    else if (ll !== c.brief_tail) F("A1", ln, ll)
    let ac = 0
    for (let i = 0; i < ls.length; i++) {
      let cs2: string[] = []
      if (!op[i]) cs2 = [ls[i]]
      else if (K(c.arm_line, "u").test(ls[i]))
        cs2 = [...ls[i].matchAll(/`([^`]*)`/g)].map((m) => m[1])
      for (let j = 0; j < cs2.length; j++) {
        let b = cs2[j], el = false
        if (K(c.arm_ellipsis, "u").test(b)) {
          el = true
          b = b.replace(K(c.arm_ellipsis, "u"), "")
        }
        if (!K(c.arm_cmd, "u").test(b)) continue
        ac++
        if (el || !K(c.arm_remote, "u").test(b) || !K(c.arm_log, "u").test(b))
          F("A2", i + 1, cs2[j])
      }
    }
    if (ac && !K(c.witness_remote, "iu").test(t))
      F("A2", 0, "арма есть, свидетель [RCH] remote не назван")
    if (K(c.witness_worker, "u").test(t)) {
      for (let i = 0; i < ls.length; i++)
        if (K(c.witness_worker, "u").test(ls[i])) { F("A2", i + 1, ls[i]); break }
    }
    const a3 = new RegExp("(?<!(?:" + c.negation + ")\\s{0,16})(?:" + c.open_door + ")", "iu")
    for (let i = 0; i < ls.length; i++) {
      if (op[i] && a3.test(ls[i])) F("A3", i + 1, ls[i])
    }
    let pc = 0, rl = false
    for (let i = 0; i < ls.length; i++) {
      if (K(c.path_line, "u").test(ls[i])) pc++
      if (K(c.rule_line, "iu").test(ls[i])) rl = true
    }
    if (pc >= c.path_lines_min && !rl)
      F("A4", 0, "строк-путей " + pc + ", строчки правила нет")
  }
  if (ev.kind === "report" || ev.kind === "message") {
    for (let i = 0; i < ls.length; i++) {
      if (op[i] && K(c.legalize, "iu").test(ls[i])) { F("C1", i + 1, ls[i]); break }
    }
    if (K(c.witness_worker, "u").test(t) && !K(c.witness_remote, "iu").test(t)) {
      for (let i = 0; i < ls.length; i++)
        if (K(c.witness_worker, "u").test(ls[i])) { F("C2", i + 1, ls[i]); break }
    }
  }
  if (ev.kind === "message") {
    let h = -1
    for (let i = 0; i < ls.length; i++) if (ls[i].trim()) { h = i; break }
    if (h >= 0 && K(c.decision_head, "u").test(ls[h]) &&
        (!K(c.decision_basis, "iu").test(t) || !K(c.decision_referent, "iu").test(t)))
      F("B", h + 1, ls[h])
  }
  if (ev.kind === "command") {
    if (K(c.git_commit, "u").test(t)) {
      if (!K(c.git_commit_ok, "u").test(t))
        F("F", 1, "git commit: нет " + c.git_commit_ok)
      const ms = [...t.matchAll(K(c.git_msg, "gu"))].map((m) => m[1] ?? m[2] ?? m[3] ?? "")
      const hd = K(c.heredoc, "u").exec(t)
      const ct = hd ? hd[2] : ms.join("\n\n")
      if (ct) {
        const cm = ct.split("\n")
        let ia = -1, ib = -1
        for (let i = 0; i < cm.length; i++) {
          if (ia < 0 && K(c.trailer_a, "mu").test(cm[i])) ia = i
          if (ib < 0 && K(c.trailer_b, "mu").test(cm[i])) ib = i
        }
        if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) !== 1)
          F("F", ia + 1, "трейлеры Session: и Co-Authored-By: не соседние")
      }
    }
    if (K(c.git_push, "u").test(t)) {
      if (!K(c.git_push_ok, "u").test(t)) F("F", 1, "git push: нет " + c.git_push_ok)
      if (K(c.git_force, "u").test(t)) F("F", 1, t)
    }
  }
  return { refuse: Rf, warn: Wr }
}

function formActOf(cfg: any, cls: string): string {
  const a = cfg && cfg.act
  const v = a && typeof a === "object" && !Array.isArray(a) ? a[cls] : null
  return String(v || "log_only")
}

function formTextOf(cfg: any, cls: string): string {
  const a = cfg && cfg.text
  return String((a && a[cls]) || cls)
}

async function envBundle($: any): Promise<any> {
  // CONSTRAINT: env names are string literals. A computed name at $.env.get
  // is not a loadable site — new consultants switch from toml `enabled`,
  // plus CLAUDE_PROBES for the non-splice ids.
  let JUDGE_CARRIER: any = ""
  try { JUDGE_CARRIER = await $.env.get("CLAUDE_JUDGE_CARRIER") } catch (x) {}
  let JUDGE: any = ""
  try { JUDGE = await $.env.get("CLAUDE_JUDGE") } catch (x) {}
  let JUDGE_MODEL: any = ""
  try { JUDGE_MODEL = await $.env.get("CLAUDE_JUDGE_MODEL") } catch (x) {}
  let JUDGE_PROMPT: any = ""
  try { JUDGE_PROMPT = await $.env.get("CLAUDE_JUDGE_PROMPT") } catch (x) {}
  let JUDGE_TIMEOUT: any = ""
  try { JUDGE_TIMEOUT = await $.env.get("CLAUDE_JUDGE_TIMEOUT_MS") } catch (x) {}
  let FORM_CARRIER: any = ""
  try { FORM_CARRIER = await $.env.get("CLAUDE_FORM_CARRIER") } catch (x) {}
  let FORM: any = ""
  try { FORM = await $.env.get("CLAUDE_FORM") } catch (x) {}
  let IDLE_CARRIER: any = ""
  try { IDLE_CARRIER = await $.env.get("CLAUDE_IDLE_CARRIER") } catch (x) {}
  let IDLE: any = ""
  try { IDLE = await $.env.get("CLAUDE_IDLE") } catch (x) {}
  let PROBES: any = ""
  try { PROBES = await $.env.get("CLAUDE_PROBES") } catch (x) {}
  let PROMPTS: any = ""
  try { PROMPTS = await $.env.get("CLAUDE_PROMPTS") } catch (x) {}
  let PROBES_DIR: any = ""
  try { PROBES_DIR = await $.env.get("CLAUDE_PROBES_DIR") } catch (x) {}
  let CONFIG_DIR: any = ""
  try { CONFIG_DIR = await $.env.get("CLAUDE_CONFIG_DIR") } catch (x) {}
  let HOME: any = ""
  try { HOME = await $.env.get("HOME") } catch (x) {}
  let PWD: any = ""
  try { PWD = await $.env.get("PWD") } catch (x) {}
  let ROUTING_TABLE: any = ""
  try { ROUTING_TABLE = await $.env.get("CATALYST_ROUTING_TABLE") } catch (x) {}
  return {
    JUDGE_CARRIER: String(JUDGE_CARRIER || ""),
    JUDGE: String(JUDGE || ""),
    JUDGE_MODEL: String(JUDGE_MODEL || "").trim(),
    JUDGE_PROMPT: String(JUDGE_PROMPT || "").trim(),
    JUDGE_TIMEOUT: String(JUDGE_TIMEOUT || ""),
    FORM_CARRIER: String(FORM_CARRIER || ""),
    FORM: String(FORM || ""),
    IDLE_CARRIER: String(IDLE_CARRIER || ""),
    IDLE: String(IDLE || ""),
    PROBES: String(PROBES || ""),
    PROMPTS: String(PROMPTS || ""),
    PROBES_DIR: String(PROBES_DIR || "").trim(),
    CONFIG_DIR: String(CONFIG_DIR || "").trim(),
    HOME: String(HOME || ""),
    PWD: String(PWD || "").trim(),
    ROUTING_TABLE: String(ROUTING_TABLE || "").trim(),
  }
}

function probeArmed(p: any, env: any): boolean {
  if (p.id === "judge") {
    if (env.JUDGE_CARRIER.trim().toLowerCase() !== "mod") return false
    return envOn(env.JUDGE)
  }
  if (p.id === "form") {
    if (env.FORM_CARRIER.trim().toLowerCase() !== "mod") return false
    return formOn(env.FORM)
  }
  if (p.id === "idle-watch") {
    if (env.IDLE_CARRIER.trim().toLowerCase() !== "mod") return false
    return envOn(env.IDLE)
  }
  return formOn(env.PROBES)
}

function lastKey(id: string, cwd: string): string {
  return "catalyst-probes:last:" + safeId(id) + ":" + String(cwd || "").slice(-80)
}

// CONSTRAINT: sid ограничивает вердиктный кэш сессией отправителя. При
// недоступном sid (SID_UNAVAILABLE) ключ вырождается в общий для всех
// таких сессий -- тогда единственная граница кэша это срок годности
// записи, и это НАМЕРЕННО.
export function verdictKey(id: string, sid: string, tool: string, agent: string, prompt: string): string {
  return ("v:" + safeId(id) + ":" + sid + ":" + tool + "|" + agent + "|" + String(prompt.length) + "|" + fnv1a(prompt)).slice(0, 256)
}

// CONSTRAINT: запись без конечного t -- форма всех ключей, писанных до
// сессионной границы, -- годной не признаётся НИКОГДА. Одобрения (OK/WARN)
// не кэшируются вовсе, поэтому годное мемо -- всегда отказ или NONE.
// CONSTRAINT: параметр НЕ может зваться nowMs -- это имя модульного помощника,
// принимающего $, и затенение делает сканер загрузчика неоднозначным:
// `claude plugin validate` отбивает ВЕСЬ модуль («declared more than once»),
// а зубы, bun build и набор стендов при этом остаются зелёными (измерено 15.09).
export function memoUsable(stored: any, atMs: number, ttlMs: number): boolean {
  if (!stored || typeof stored !== "object" || !stored.kind) return false
  if (stored.kind === "OK" || stored.kind === "WARN") return false
  return Number.isFinite(stored.t) && (atMs - stored.t) <= ttlMs
}

export async function loadWorld($: any, env: any, cwdArg?: string): Promise<any> {
  let globalHome = ""
  if (env.PROBES_DIR) globalHome = env.PROBES_DIR
  else if (env.CONFIG_DIR) globalHome = env.CONFIG_DIR + "/probes"
  else globalHome = env.HOME + "/.claude/probes"
  let cwd = ""
  if (cwdArg !== undefined) cwd = cwdArg
  else {
    cwd = String(env.PWD || "")
    if (!cwd) {
      try { cwd = String(await $.store.get(CWD_KEY) || "") } catch (x) { cwd = "" }
    }
  }
  const gToml = await readText($, globalHome + "/probes.toml")
  const gParsed = parseToml(gToml.text || "")
  let projectHome = ""
  let pParsed: any = {}
  if (!env.PROBES_DIR) {
    projectHome = await findProjectHome($, cwd, globalHome)
    if (projectHome) {
      const pt = await readText($, projectHome + "/probes.toml")
      if (pt.text) pParsed = parseToml(pt.text)
    }
  }
  const cfgUnread = ((gParsed && gParsed.__unreadN) || 0) +
                    ((pParsed && pParsed.__unreadN) || 0)
  const allowedLoaded = await loadAllowedByClass($, env)
  return {
    globalHome, projectHome, cwd, cfgUnread,
    probes: probesOf(gParsed, pParsed),
    prompts: promptsOf(gParsed, pParsed),
    failover: failoverOf(gParsed, pParsed),
    allowedByClass: allowedLoaded.allowedByClass,
    allowedSrc: allowedLoaded.allowedSrc,
  }
}

function failoverOf(gParsed: any, pParsed: any): any {
  const g = (gParsed && gParsed.failover) || {}
  const p = (pParsed && pParsed.failover) || {}
  return {
    enabled: p.enabled !== undefined ? p.enabled : g.enabled,
    default: shallowMerge(g.default || {}, p.default || {}),
    class: shallowMerge(g.class || {}, p.class || {}),
    agent: shallowMerge(g.agent || {}, p.agent || {}),
  }
}

// CONSTRAINT: разовая уборка отравленных вердиктных ключей судьи -- записи
// без t (форма до сессионной границы) и протухшие сверх срока умолчания.
// Префикс v:judge: обязателен: стор общий, чужих ключей не трогаем. Отказ
// уборки не красит и не прерывает консультацию. Разовость -- sweepDone:
// на старте КАЖДОЙ сессии (прежнее место) уборка задерживала session.start
// обходом стора, теперь она едет первой консультацией судьи.
async function sweepVerdictStore($: any, world: any, sid: string): Promise<void> {
  sweepDone = true
  try {
    const all = await $.store.keys()
    const t0 = await nowMs($)
    // CONSTRAINT: уборка сносит РОВНО то, что чтение уже не признаёт годным,
    // и потому зовёт тот же самый предикат memoUsable с тем же сроком. Свой
    // экземпляр условия здесь разошёлся бы с чтением молча: при настроенном
    // verdict_cache_ms длиннее умолчания уборка сносила бы ещё живые записи.
    let ttlMs = VERDICT_TTL_MS_DEFAULT
    for (let i = 0; i < world.probes.length; i++) {
      const p = world.probes[i]
      if (p.id !== "judge") continue
      ttlMs = num(p.cfg && p.cfg.verdict_cache_ms, VERDICT_TTL_MS_DEFAULT, 1)
      break
    }
    let removed = 0
    let scanned = 0
    for (let i = 0; i < all.length && removed < 400; i++) {
      const k = String(all[i])
      if (k.indexOf("v:judge:") !== 0) continue
      scanned++
      let v: any
      try { v = await $.store.get(k) } catch (x) { v = undefined }
      if (memoUsable(v, t0, ttlMs)) continue
      try { await $.store.delete(k); removed++ } catch (x) {}
    }
    try {
      await appendJournal($, world.globalHome + "/judge/journal.jsonl", {
        t: new Date(t0).toISOString(), outcome: "store_sweep", removed, scanned,
        ttlMs, probe: "judge", carrier: "mod", sid,
      })
    } catch (x) {}
  } catch (x) {}
}

// CONSTRAINT: имя и путь улики одним домом -- улика консульта и улика
// попадания в кэш обязаны строиться побайтно одной формой.
function modRecName(e: any): string {
  return "mod-" + String((e && e.tool_use_id) || "noid") + ".json"
}

function modRecPath(world: any, id: string, e: any): string {
  return world.globalHome + "/" + id + "/records/" + modRecName(e)
}

async function consultBg($: any, p: any, env: any, world: any, e: any, ctx: any, key: string, epCall: number): Promise<any> {
  const id = p.id
  const cfg = p.cfg
  const tool = String((e && e.tool) || "")
  const agent = String((e && e.subagent_type) || "")
  const prompt = String((e && e.prompt) || "")
  const t0 = ctx.now
  const recName = modRecName(e)
  const recPath = modRecPath(world, id, e)
  const jpath = world.globalHome + "/" + id + "/journal.jsonl"
  const rec: any = { id: e && e.tool_use_id, probe: id, tool, agent, t0, carrier: "mod", mod: MOD_VERSION, sid: await sidFor($), projectHome: world.projectHome, globalHome: world.globalHome }
  try {
    let sys = ""
    if (id === "judge" && env.JUDGE_PROMPT) {
      const pr = await readText($, env.JUDGE_PROMPT)
      if (pr.text) sys = pr.text
    } else {
      const gPrompt = await readText($, world.globalHome + "/" + id + "/prompt.md")
      if (gPrompt.text) sys = gPrompt.text
      if (world.projectHome) {
        const pPrompt = await readText($, world.projectHome + "/" + id + "/prompt.md")
        if (pPrompt.text) sys = pPrompt.text
        const extra = await readText($, world.projectHome + "/" + id + "/prompt.extra.md")
        if (extra.text) sys = sys + "\n\nПРАВИЛА ЭТОГО ПРОЕКТА\n" + extra.text
      }
    }
    if (!sys) sys = "Answer with ONE line from the vocabulary, then the reason."

    const atn = num(cfg.attach_files, 0, 0)
    const atc = num(cfg.attach_chars, 40000, 0)
    const atb = num(cfg.attach_total, 90000, 0)
    const att: { path: string; n: number }[] = []
    if (atn > 0 && atc > 0 && atb > 0 && prompt) {
      const rx = /(~|\/)[A-Za-z0-9._~\/-]*\.(?:md|txt)(?![A-Za-z0-9])/g
      const seen: any = {}
      let sp = 0
      let mm: RegExpExecArray | null
      while ((mm = rx.exec(prompt)) && att.length < atn) {
        let f = mm[0]
        if (f.charAt(0) === "~") f = env.HOME + f.slice(1)
        if (seen[f]) continue
        seen[f] = 1
        const body = await readText($, f)
        if (body.text == null) continue
        let chunk = body.text
        if (chunk.length > atc) chunk = chunk.slice(0, atc)
        if (sp + chunk.length > atb) chunk = chunk.slice(0, Math.max(0, atb - sp))
        if (!chunk) break
        att.push({ path: f, n: chunk.length })
        sys = sys + "\n\n=== ATTACHED " + f + " ===\n" + chunk
        sp += chunk.length
      }
    }
    rec.att = att
    if (world && world.cfgUnread) rec.cfgUnread = world.cfgUnread

    let msgs: any[] = []
    try { msgs = await $.session.messages() } catch (x) { msgs = [] }
    const ctxLines: string[] = []
    if (Array.isArray(msgs)) {
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i]
        const role = String((m && m.role) || "")
        const text = String((m && m.text) || "")
        const kind = m && typeof m === "object" && "toolResults" in m ? "tool" : role
        ctxLines.push(kind + ": " + text.slice(0, 2000))
      }
    }
    const ctxAll = ctxLines.join("\n")
    // CONSTRAINT: потолок контекста -- СВОЙ у каждой ступени (rungCtx): промт
    // собирается в цикле ступеней, общая обрезка ВНЕ цикла давала всем ступеням
    // один и тот же текст.
    const buildFull = (ctxN: number): string => {
      const context = ctxAll.slice(-ctxN)
      const dchars = num(cfg.dispatch_chars, 16000, 0) || 16000
      const parts: string[] = []
      parts.push("=== SESSION SO FAR ===\n" + context)
      if (p.id === "judge" || (Array.isArray(cfg.show) && cfg.show.indexOf("dispatch") >= 0) || p.act === "cancel") {
        parts.push("=== DISPATCH ===\n" + JSON.stringify({
          tool, subagent_type: agent, model: e && e.model, prompt: prompt.slice(0, dchars),
        }))
      }
      if (p.id === "idle-watch" || (Array.isArray(cfg.show) && cfg.show.indexOf("fleet") >= 0)) {
        parts.push("=== FLEET ===\n" + JSON.stringify({ live_works: ctx.live_works, tool }))
      }
      if (Array.isArray(cfg.show) && cfg.show.indexOf("tool") >= 0 && p.id !== "idle-watch") {
        parts.push("=== TOOL ===\n" + tool)
      }
      const user = parts.join("\n\n")
      return (sys ? sys + "\n\n" : "") + user
    }
    const modelEnv = p.id === "judge" ? env.JUDGE_MODEL : ""
    let ladder = rungsOf(cfg, modelEnv)
    const cooldown = rungsAfterCooldown(ladder, await nowMs($))
    ladder = cooldown.ladder
    Object.assign(rec, cooldown.evidence)
    rec.ladder = ladder.map((r: any) => r.model)
    let verdict: { kind: string; rest: string } | null = null
    let used = ""
    const floorTok = num(cfg.max_tokens, 8000, 1)
    const floorTmo = p.id === "judge" ? num(env.JUDGE_TIMEOUT, num(cfg.timeout_ms, 0, 1), 1) : num(cfg.timeout_ms, 0, 1)
    // CONSTRAINT: предел есть и у СУДА целиком, не только у ступени. Три
    // ступени, каждая в своём пределе, дают тройное ожидание, и диспатч всё это
    // время не стартует. Умолчание равно сумме ступенчатых бюджетов -- без
    // настройки поведение не меняется, настройка `total_timeout_ms` его
    // ужимает.
    const totalTmo = num(cfg.total_timeout_ms, floorTmo * (ladder.length || 1), 1)
    const hardStop = floorTmo ? t0 + totalTmo : 0
    // CONSTRAINT: улика кладётся на диск ДО лестницы и переписывается после.
    // Пока запись была только в конце, зависший суд не оставлял следа ВОВСЕ:
    // инцидент 2026-09-16 (час ожидания) не виден ни в одной из 47 записей
    // своего окна, и диагностировать вис по уликам было нечем.
    if (cfg.record !== false) {
      try { await $.fs.write(recPath, JSON.stringify(Object.assign({}, rec, { inflight: true }))) } catch (x) {}
    }
    for (let i = 0; i < ladder.length; i++) {
      // CONSTRAINT: предел суда проверяется ПЕРЕД ступенью, а не после неё:
      // иначе последняя ступень стартует за миг до истечения и держит диспатч
      // весь свой бюджет сверх общего.
      if (hardStop && await nowMs($) >= hardStop) { rec.deadlineHit = true; break }
      const rung = ladder[i]
      used = rung.model
      const rungCtxN = rungCtx(rung, cfg)
      markEffort(rec, used, rung)
      const full = buildFull(rungCtxN)
      const rungT0 = await nowMs($)
      let rungBudgetClipped = false
      try {
        const arg: any = { model: rung.model, prompt: full }
        // CONSTRAINT: эффорт доставляется штатно (образ 2.1.272, замер
        // 2026-09-15): шаг 31 патча принимает effort в сигнатуре мод-API и
        // передаёт отправителю как extraBodyParams:{reasoning_effort:<effort>};
        // отправитель деструктурирует поле и вливает его в тело запроса
        // единственным spread'ом рядом с metadata/thinking/betas. Канал тот
        // же, каким пользуется встроенный классификатор auto_mode, --
        // значение эффорта доезжает до провайдера дословно.
        if (rung.effort) arg.effort = rung.effort
        const mt = rung.max_tokens || floorTok
        // CONSTRAINT: канонический потолок зовётся maxTokens и ПЕРЕБИВАЕТ
        // max_tokens (замерено на проводе: оба поля читаются, при паре
        // побеждает camelCase). Прибавка резерва условна: она берётся из
        // IJ(model) образа и равна 2048 ТОЛЬКО для моделей, отнесённых к
        // rejects_disabled_thinking; для прочих моделей прибавка 0, а без
        // поля на провод уходит умолчание 256. Запасная дорога не опора:
        // поверхность не монотонна -- часы на 2.1.272 уже сменили природу
        // (#185).
        if (mt) arg.maxTokens = mt
        // CONSTRAINT: предел СУДА обрезает бюджет ступени, а не только решает,
        // пускать ли её. Проверки «перед ступенью» мало: ступень, стартовавшая
        // за миг до границы, держала бы диспатч ещё весь свой бюджет сверх
        // общего, и объявленный total_timeout_ms не выполнялся бы буквально.
        const rungTmo = rung.timeout_ms || floorTmo
        const left = hardStop ? hardStop - rungT0 : 0
        const tmo = (hardStop && left > 0 && left < rungTmo) ? left : rungTmo
        rungBudgetClipped = tmo !== rungTmo
        if (tmo) arg.timeoutMs = tmo
        // CONSTRAINT: detail просят ВСЕГДА. Образ со шагом 31 отдаёт конверт
        // {text, stopReason, blocks, usage}; образ без него поля не знает и
        // возвращает прежнюю строку -- readComplete различает обе формы, и
        // мод остаётся годен на обоих образах (#190).
        arg.detail = true
        // CONSTRAINT: ответ, вернувшийся ПОСЛЕ смены сессии, принадлежит
        // прежнему миру: вердикт не выносится, в кэш не пишется, лестница
        // прекращается. Молчаливый выброс запрещён (ПУСТО -- НЕ НОЛЬ):
        // ступень помечается полем staleEpoch в улике.
        const ans = readComplete(await raceDeadline($, $.model.complete(arg), tmo, used, rec))
        if (epoch !== epCall) {
          rec.staleEpoch = true
          rec["ms_" + used] = await nowMs($) - rungT0
          break
        }
        const rawS = ans.text
        // CONSTRAINT: длительность нужна НА СТУПЕНЬ, а не на улику целиком:
        // пустой ответ быстрой ступени и пустой ответ после долгого молчания --
        // разные явления, а суммарный dtMs их не разделяет (замер #153).
        rec["ms_" + used] = await nowMs($) - rungT0
        // CONSTRAINT: своя обрезка не имеет права маскировать потолок
        // провайдера. При обрезке в 500 медиана непустых ответов нижних
        // ступеней равнялась ровно 500 -- упор в потолок ПРИБОРА неотличим от
        // упора в потолок МОДЕЛИ, и базовая линия для #182 была непригодна.
        // Длина берётся ДО обрезки и хранится своим полем.
        rec["rawLen_" + used] = rawS.length
        rec["ctxN_" + used] = rungCtxN
        rec["raw_" + used] = rawS.slice(0, 2000)
        // CONSTRAINT: причина пустоты пишется ВСЕГДА, когда образ её отдал --
        // и только тогда. Отсутствие полей на старом образе означает «нечем
        // было измерить», а нули означали бы измеренный ноль (ПУСТО != НОЛЬ).
        if (ans.detailed) {
          rec["detail_" + used] = true
          if (ans.stopReason !== null) rec["stop_" + used] = ans.stopReason
          if (ans.blocks !== null) {
            rec["blocks_" + used] = blocksLine(ans.blocks)
            rec["blockN_" + used] = ans.blocks.length
          }
          if (ans.outTok !== null) rec["outTok_" + used] = ans.outTok
        }
        verdict = parseVerdict(rawS, p.rx)
        if (verdict) break
        // CONSTRAINT: ответ, оборванный ПОТОЛКОМ, -- отказ ПРИБОРА, а не
        // суждение о задаче: вердикта в нём нет потому, что ступени не дали
        // договорить. Такой суд обязан ПРОПУСТИТЬ диспатч, как и молчание по
        // времени, а не запретить его именем NONE. Замер 2026-09-16 по 455
        // боевым уликам: stop_* = end_turn 103, max_tokens 1 -- потолок режет
        // редко, но режет молча, и цена молчания здесь -- остановленная работа.
        if (ans.stopReason === "max_tokens") {
          rec.rungTruncated = num(rec.rungTruncated, 0, 0) + 1
        }
      } catch (x) {
        // Длительность ОТКАЗА мерится тем же полем: мгновенный отказ по
        // бюджету и отказ после ожидания провайдера -- разные явления.
        rec["ms_" + used] = await nowMs($) - rungT0
        rec["ctxN_" + used] = rungCtxN
        const es = String(x)
        rec["err_" + used] = es.slice(0, 240)
        // CONSTRAINT: отказ ПО ВРЕМЕНИ считается отдельно от отказа провайдера.
        // Смешать их значит потерять различие между «ступень отказала» и
        // «ступень не ответила»: первое -- вердикт о канале, второе -- о
        // приборе, и исход у них РАЗНЫЙ (block_no_verdict против skip).
        if (noteRungTimeout(used, es, await nowMs($), undefined, rungBudgetClipped)) {
          rec.rungTimeouts = num(rec.rungTimeouts, 0, 0) + 1
          if (rungBudgetClipped) rec["rungDeadlineClipped_" + used] = true
        }
      }
    }
    rec.dtMs = await nowMs($) - t0
    rec.used = used
    if (rec.staleEpoch) {
      // CONSTRAINT: собственный kind, а не NONE: NONE у fail-closed судьи
      // отменяет диспатч, а смена сессии -- не вина диспатча; чужой вердикт
      // неприменим, ступень уже названа полем staleEpoch.
      rec.kind = "STALE_EPOCH"
    } else if (verdict) {
      rec.kind = verdict.kind
      rec.rest = verdict.rest
      // CONSTRAINT: кэш -- только отказ: одобренный диспатч исполняется,
      // шторм повторов бывает после отказа, кэш OK/WARN не защищал ни от
      // чего и молча гасил суд для всех будущих сессий.
      if ((p.pending || p.act === "cancel") && verdict.kind !== "OK" && verdict.kind !== "WARN") {
        try { await $.store.set(key, { kind: verdict.kind, rest: verdict.rest, used, t: await nowMs($), dtMs: rec.dtMs }) } catch (x) {}
      }
      if (verdict.kind === "NUDGE" && p.act === "nudge") {
        try { await $.ui.toast((id) + ": " + verdict.rest.slice(0, 200)) } catch (x) { rec.toastErr = String(x).slice(0, 160) }
      }
    } else {
      // CONSTRAINT: исход зависит от ПРИЧИНЫ молчания. Ступени, не ответившие
      // в срок, и исчерпанный предел суда дают TIMEOUT -> пропуск; ступени,
      // ответившие без вердикта, остаются NONE -> запрет. Пока имя было одно
      // на оба случая, вис был неотличим от отказа и ЗАПРЕЩАЛ диспатч.
      const timedOut = rec.deadlineHit === true || num(rec.rungTimeouts, 0, 0) > 0
      const truncated = num(rec.rungTruncated, 0, 0) > 0
      rec.kind = timedOut ? "TIMEOUT" : (truncated ? "TRUNCATED" : "NONE")
      // CONSTRAINT: в кэш отказов кладётся только NONE. TIMEOUT и TRUNCATED --
      // состояния канала и бюджета, а не свойства диспатча: закэшировав их, мы
      // гасили бы будущие суды по причине, которой уже нет.
      if (!timedOut && !truncated && (p.pending || p.act === "cancel")) {
        try { await $.store.set(key, { kind: "NONE", used, t: await nowMs($), dtMs: rec.dtMs }) } catch (x) {}
      }
    }
  } catch (x) {
    rec.threw = String(x).slice(0, 400)
    rec.dtMs = await nowMs($) - t0
    rec.kind = "NONE"
    if (p.pending || p.act === "cancel") {
      try { await $.store.set(key, { kind: "NONE", threw: rec.threw, t: await nowMs($), dtMs: rec.dtMs }) } catch (y) {}
    }
  }
  if (clockBad) rec.clockBad = true
  if (cfg.record !== false) {
    try { await $.fs.write(recPath, JSON.stringify(rec)) } catch (x) {}
  }
  try {
    const kind = String(rec.kind || "NONE")
    const rest = String(rec.rest || "")
    let oc = outcomeOf(kind)
    const enforce = p.id === "judge" ? (env.JUDGE === "enforce" || bl3(cfg.enforce, true)) : bl3(cfg.enforce, p.act === "cancel")
    if ((kind === "BLOCK" || kind === "STOP" || kind === "DENY") && !enforce) oc = "block_not_enforced"
    await appendJournal($, jpath, {
      t: new Date(t0).toISOString(),
      probe: id, tool, agent, ms: rec.dtMs, outcome: oc,
      verdict: (kind + ": " + rest).slice(0, 400),
      jm: rec.used, rec: recName, carrier: "mod", sid: rec.sid,
    })
  } catch (x) {
    // CONSTRAINT: отказ журнальной дороги НЕ молчит. Улика уже на диске, и
    // причина дописывается в неё вторым заходом: пока catch был глухим, потеря
    // строки обнаруживалась только сличением двух домов, и ровно это скрывало
    // поломку часов поверхности от её начала до разбора #184.
    try {
      rec.journalErr = String((x && (x as any).message) || x).slice(0, 240)
      if (cfg.record !== false) await $.fs.write(recPath, JSON.stringify(rec))
    } catch (y) {}
  }
  return rec
}

async function runForm($: any, p: any, env: any, world: any, e: any): Promise<string | null> {
  const cfg = p.cfg
  const tool = String((e && e.tool) || "")
  if (tool !== "Agent" && tool !== "Task" && tool !== "SendMessage" &&
      tool !== "Write" && tool !== "Edit" && tool !== "Bash") return null
  for (let i = 0; i < FORM_REQ.length; i++) {
    if (typeof cfg[FORM_REQ[i]] !== "string" || !cfg[FORM_REQ[i]]) {
      return null
    }
  }
  if (typeof cfg.path_lines_min !== "number") {
    return null
  }
  const evs: any[] = []
  const sk: string[] = []
  const byPath = async (fp: string) => {
    const t = await readTextNull($, fp)
    if (t === null) return
    const k = formKind(fp, t, cfg)
    if (k) evs.push({ kind: k, text: t, label: tool + ":" + fp })
    else sk.push(fp)
  }
  if (tool === "Agent" || tool === "Task" || tool === "SendMessage") {
    const tx = String((e && (e.prompt || e.message || e.text)) || "")
    const pu: string[] = []
    const re = K(cfg.brief_ref, "gu")
    let m: RegExpExecArray | null
    while ((m = re.exec(tx)) && pu.length < 4) {
      const rp = resolvePath(m[0], env.HOME, world.cwd)
      if (pu.indexOf(rp) < 0) pu.push(rp)
    }
    for (let i = 0; i < pu.length; i++) await byPath(pu[i])
    if (tool === "SendMessage") evs.push({ kind: "message", text: tx, label: "SendMessage:message" })
  } else if (tool === "Write") {
    const fp = String((e && e.file_path) || "")
    const ct = String((e && e.content) || "")
    const k = formKind(fp, ct, cfg)
    if (k) evs.push({ kind: k, text: ct, label: "Write:" + fp })
    else sk.push(fp)
  } else if (tool === "Edit") {
    const fp = String((e && e.file_path) || "")
    const cur = await readTextNull($, fp)
    if (cur !== null) {
      const oldS = String((e && e.old_string) || "")
      const newS = String((e && e.new_string) || "")
      const post = e && e.replace_all ? cur.split(oldS).join(newS) : cur.replace(oldS, newS)
      const k = formKind(fp, post, cfg)
      if (k) evs.push({ kind: k, text: post, label: "Edit:" + fp })
      else sk.push(fp)
    }
  } else {
    const cmd = String((e && e.command) || "")
    const wr = K(cfg.write_redirect, "u").exec(cmd)
    if (wr) {
      const fp = resolvePath(wr[1], env.HOME, world.cwd)
      const hd = K(cfg.heredoc, "u").exec(cmd)
      let body = hd ? hd[2] : ""
      let post = body
      if (/>>|tee/.test(wr[0])) {
        const cur = await readTextNull($, fp)
        post = (cur === null ? "" : cur) + ((cur && cur.length && !cur.endsWith("\n")) ? "\n" : "") + body
      }
      const k = formKind(fp, post, cfg)
      if (k) evs.push({ kind: k, text: post, label: "Bash:" + fp })
      else sk.push(fp)
    }
    if (/git\s+(?:commit|push)\b/.test(cmd))
      evs.push({ kind: "command", text: cmd, label: "Bash:command" })
  }
  if (!evs.length) return null
  const rf: any[] = []
  const wn: any[] = []
  const cls: string[] = []
  for (let i = 0; i < evs.length; i++) {
    const r2 = formEval(evs[i], cfg)
    for (let j = 0; j < r2.refuse.length; j++) rf.push(Object.assign({}, r2.refuse[j], { src: evs[i].label }))
    for (let j = 0; j < r2.warn.length; j++) wn.push(Object.assign({}, r2.warn[j], { src: evs[i].label }))
  }
  for (let i = 0; i < rf.length; i++) if (cls.indexOf(rf[i].c) < 0) cls.push(rf[i].c)
  for (let i = 0; i < wn.length; i++) if (cls.indexOf(wn[i].c) < 0) cls.push(wn[i].c)
  const vk = rf.length ? "refuse" : (wn.length ? "warn" : "pass")
  const src3 = rf[0] || wn[0]
  const lbl = src3 ? src3.src : (evs[0] ? evs[0].label : tool)
  const cnts = cls.map((c3) => c3 + "×" + rf.concat(wn).filter((x) => x.c === c3).length).join(", ")
  const vd = (vk === "pass" ? "PASS" : vk === "warn" ? "WARN" : "REFUSE") + ": " +
    (vk === "pass" ? lbl : cnts + " — " + lbl + " — " + (src3 ? src3.c : "") + " :" + (src3 ? src3.n : "") + " " + (src3 ? src3.q : ""))
  const t0 = await nowMs($)
  const recName = "mod-" + String((e && e.tool_use_id) || "noid") + ".json"
  const jpath = world.globalHome + "/form/journal.jsonl"
  const recPath = world.globalHome + "/form/records/" + recName
  let formJournalErr = ""
  try {
    await appendJournal($, jpath, {
      t: new Date(t0).toISOString(), tool, outcome: vk, verdict: clip(vd, 400),
      cls, jm: "rules", tries: 0, rec: recName, carrier: "mod", sid: await sidFor($), probe: "form",
      skipped: sk.slice(0, 8),
    })
  } catch (x) {
    formJournalErr = String((x && (x as any).message) || x).slice(0, 240)
  }
  if (vk !== "pass") {
    const formRec: any = { ev: tool, cls, refuse: rf, warn: wn, vd }
    if (formJournalErr) formRec.journalErr = formJournalErr
    try { await $.fs.write(recPath, JSON.stringify(formRec)) } catch (x) {}
  }
  if (vk === "refuse") {
    let cancel = false
    for (let i = 0; i < rf.length; i++) {
      if (formActOf(cfg, rf[i].c) === "cancel") cancel = true
    }
    if (cancel) {
      const reason = cls.map((c) => formTextOf(cfg, c)).join("; ")
      return "Form probe refused the call (not the routing gate). " + reason
    }
  }
  return null
}

function builtinTrigger(p: any, e: any, ctx: any): boolean {
  const tool = String((e && e.tool) || "")
  if (p.id === "judge") return tool === "Agent" || tool === "Task"
  if (p.id === "idle-watch") {
    if (tool === "Agent" || tool === "Task") return false
    if (Number(ctx.live_works) > 0) return false
    const cd = num(p.cfg.cooldown_min, 30, 0) * 60 * 1000
    const last = Number(ctx.last_consultation || 0)
    if (last && ctx.now - last < cd) return false
    return true
  }
  return false
}

// CONSTRAINT: «выдача» определяется ровно ЗДЕСЬ -- счёт кусков, прошедших из
// источника в делегацию yield* наружу, -- и нигде больше в файле: второе
// место разойдётся молча. Счёт растёт при ИЗЪЯТИИ куска из источника: yield*
// отдаёт его вызывающему тем же шагом, без точки, где счёт и выдача могли бы
// разойтись.
// CONSTRAINT (#239, замер #242b 17.09): запрет перехода держит число кусков
// С СОДЕРЖИМЫМ, а не число кусков. Отказ носителя приходит после одиннадцати
// кусков вида ровно {kind, ref}, не несущих наружу ничего; счёт по ВСЕМ кускам
// делал afterEmit истинным, и веер запрещался при любом ретраебельном статусе
// до передачи хотя бы одного байта содержимого (503/429/529 неразличимы --
// измерено на стенде #242, обе площадки).
// Предикат СТРУКТУРНЫЙ, а не белый список имён: алфавит kind измерен НЕ
// полностью (thinking / tool_use формой не накрыты), а цена ложно-отрицательной
// ошибки -- склейка ответов двух ступеней (#224), которая портит данные МОЛЧА.
// Поэтому умолчание консервативное: всё, что несёт поля сверх kind/ref, и всё,
// что не разбирается, считается выдачей -- в сторону лишнего запрета перехода,
// никогда в сторону склейки.
export function chunkCarriesContent(c: any): boolean {
  if (c == null || typeof c !== "object") return true
  let ks: string[]
  try { ks = Object.keys(c) } catch (x) { return true }
  for (let i = 0; i < ks.length; i++) {
    if (ks[i] !== "kind" && ks[i] !== "ref") return true
  }
  return false
}

function countEmitted(
  src: any,
  emitted: { n: number; content: number; kinds: string[] },
): any {
  return {
    [Symbol.asyncIterator]: () => {
      const it: any = src[Symbol.asyncIterator]()
      const wrap: any = {
        next: async () => {
          const r = await it.next()
          if (!r.done) {
            emitted.n++
            if (chunkCarriesContent(r.value)) emitted.content++
            // CONSTRAINT (обязательная вторая половина адъюдикации #242b):
            // алфавит kind обязан расти ЗАМЕРОМ, а не догадкой -- каждый вид,
            // впервые встреченный на этой дороге, уезжает в улику попытки.
            // Потолок 16 держит размер улики: алфавит шире шестнадцати сам по
            // себе есть находка, и её видно по достижению потолка.
            const k =
              r.value != null && typeof r.value === "object"
                ? String((r.value as any).kind)
                : "?"
            if (emitted.kinds.length < 16 && emitted.kinds.indexOf(k) < 0) {
              emitted.kinds.push(k)
            }
          }
          return r
        },
      }
      if (typeof it.return === "function") wrap.return = (v: any) => it.return(v)
      if (typeof it.throw === "function") wrap.throw = (x: any) => it.throw(x)
      return wrap
    },
  }
}

// CONSTRAINT: turn.step STREAMS -- простая async роняет загрузку ВСЕГО модуля.
// next() бывает генератором или значением; ветка по Symbol.asyncIterator.
async function* driveNext(
  n: any,
  emitted?: { n: number; content: number; kinds: string[] },
): AsyncGenerator<any, any, any> {
  if (n != null && typeof n[Symbol.asyncIterator] === "function") {
    if (emitted == null) return yield* n
    return yield* countEmitted(n, emitted)
  }
  return n
}

// CONSTRAINT: обработчик отказа хост зовёт в форме хука ($, e, next), но $
// в него недоступен для чтения -- только $.noun.event(...) (статическая
// проверка), и DECISIVE-обработчик его не касается вовсе -- собственный
// грейс 1000 мс не ждёт ничего. caught-поля подняты прямо на next:
// next.error = {kind: "timeout"|"throw", budget}, next.called (замер живым
// зондом и по байтам 2.1.273/274). Ответ обработчика становится результатом
// хука и строкой "hook failed closed ... (its .catch answered)" журнала
// хоста; молчание или отсутствие обработчика -- ветка "skipped", работа
// уходит непроверенной. Форма жёсткая: .catch(handler) цепочкой ровно на
// месте регистрации -- сохранить дескриптор и вызвать позже нельзя.
// CONSTRAINT: next.error.budget -- грейс обработчика отказа (Be=1000), не
// бюджет упавшего хука (1e4) и в текст deny не входит: приписывать хуку
// 1000 мс было бы ложью. Вид -- из next.error.kind.
function decisiveFailClosed($: any, event: string, e: any, next: any): any {
  if (next && next.called) return next(e)
  const err: any = next && next.error
  const timedOut = !!(err && err.kind === "timeout")
  const why = timedOut ? "timed out without answering" : "threw"
  return {
    deny:
      "Subagent dispatch cancelled: the catalyst-probes " + event + " hook " + why +
      " [" + (timedOut ? "timeout" : "throw") + "]. Fail-closed: the dispatch " +
      "never runs unreviewed. This is NOT the routing-table.toml gate. Tell the " +
      "human and do the work without a subagent, or retry later.",
  }
}

// Наблюдательская регистрация не отменяет ничего: её отказ обязан быть
// видимым, и ответ next(e) даёт именно это -- хост пишет свою строку
// "hook failed closed ... (its .catch answered)" вместо молчаливого "skipped".
function observerFailThrough($: any, e: any, next: any): any {
  return next(e)
}

// CONSTRAINT: для стриминговой регистрации обработчик отказа обязан быть
// генератором (валидатор: событие streams -- "it takes async function*") и
// прогонять поток next ТОЙ ЖЕ дорогой, что основной хук -- driveNext по
// Symbol.asyncIterator: голый `return next(e)` отдал бы ОБЪЕКТ ГЕНЕРАТОРА
// вместо потока, шаги не эмитились бы, и это второе место разошлось бы
// молча.
async function* observerFailThroughStream($: any, e: any, next: any): AsyncGenerator<any, any, any> {
  return yield* driveNext(next(e))
}

export function register(on: any) {
  on("session.start", async ($: any, e: any, next: any) => {
    try { if (e && e.cwd) await $.store.set(CWD_KEY, String(e.cwd)) } catch (x) {}
    // CONSTRAINT: регистрация -- ДО next(e) и под отдельным глухим try: отказ
    // двери не имеет права уронить старт сессии. Повторная регистрация --
    // тихая замена (волна 2 #178), поэтому каждый session.start регистрирует
    // смело. immediate: false -- наблюдаемый эффект true волной 2 НЕ измерен,
    // а невыясненное поведение в бой не ставится.
    try {
      await $.command.register({
        name: LADDER_COMMAND,
        description: LADDER_COMMAND_DESCRIPTION,
        argumentHint: LADDER_COMMAND_ARG_HINT,
        immediate: false,
      })
    } catch (x) {}
    return next(e)
  })
    .catch(observerFailThrough)

  on("command.run", { command: ["clear", "resume"] }, async ($: any, e: any, next: any) => {
    const result = await next(e)
    // CONSTRAINT: сброс строго ПОСЛЕ next(e) (образ -- официальный мод diff):
    // команда обязана отработать и при отказе сброса, поэтому newSession
    // взведён под отдельным try.
    try { newSession() } catch (x) {}
    return result
  })
    .catch(observerFailThrough)

  // CONSTRAINT: подписка -- отдельным вызовом ТОЛЬКО на свою команду. Ответ --
  // ровно {text}: $.command.run из command.run-хука хост запрещает (волна 1
  // #178, байты образа: вызов ждал бы ход, который держит этот хук). Матчер --
  // массивная форма: строковая не измерена, массивная дошла до живого хоста
  // (волна 2 #178, r2/r3).
  on("command.run", { command: [LADDER_COMMAND] }, async ($: any, e: any, next: any) => {
    return { text: ladderCommandText(await nowMs($), String((e && e.args) || "")) }
  })
    .catch(observerFailThrough)

  on("prompt.section", async ($: any, e: any, next: any) => {
    const name = String((e && e.name) || "")
    let w: any = null
    try { w = await worldFor($) } catch (x) { w = null }
    if (!w) return next(e)
    const r = await applyPromptRules($, w.world, w.env, "section", name, String((e && e.text) || ""))
    if (!r.applied.length) return next(e)
    return next(Object.assign({}, e, { text: r.text }))
  })
    .catch(observerFailThrough)

  // Field names measured live on 2.1.267: tool.describe carries
  // `tool,description,provider`; command.describe carries
  // `command,description,argumentHint,isHidden,immediate,provider`.
  on("tool.describe", async ($: any, e: any, next: any) => {
    const name = String((e && e.tool) || "")
    if (!name) return next(e)
    let w: any = null
    try { w = await worldFor($) } catch (x) { w = null }
    if (!w) return next(e)
    const r = await applyPromptRules($, w.world, w.env, "tool", name, String((e && e.description) || ""))
    if (!r.applied.length) return next(e)
    return next(Object.assign({}, e, { description: r.text }))
  })
    .catch(observerFailThrough)

  on("command.describe", async ($: any, e: any, next: any) => {
    const raw = String((e && e.command) || "")
    if (!raw) return next(e)
    // A table may name the command with or without the leading slash.
    const bare = raw.charAt(0) === "/" ? raw.slice(1) : raw
    let w: any = null
    try { w = await worldFor($) } catch (x) { w = null }
    if (!w) return next(e)
    const text = String((e && e.description) || "")
    let r = await applyPromptRules($, w.world, w.env, "command", raw, text)
    if (!r.applied.length && bare !== raw) {
      r = await applyPromptRules($, w.world, w.env, "command", bare, text)
    }
    if (!r.applied.length) return next(e)
    return next(Object.assign({}, e, { description: r.text }))
  })
    .catch(observerFailThrough)

  on("tool.call", async ($: any, e: any, next: any) => {
    if ("agentId" in e) return next(e)
    const tool = String((e && e.tool) || "")
    // CONSTRAINT: tool.call главного лупа (нет agentId) -- горячий путь.
    // Замер 2026-09-18, транскрипт worktree claudeapp session 9632494b,
    // 493 часа с tool_use: медиана 41/час, пик 251/час (2026-09-15T20).
    // command.describe даёт 254 чтения за одну сборку промпта; без мемо
    // этот путь читал probes.toml на каждый вызов. Мир берётся через
    // worldFor -- то же окно, что у describe/spawn.
    const packed = await worldFor($)
    const env = packed.env
    const world = packed.world
    const prompt = String((e && e.prompt) || "")
    const agent = String((e && e.subagent_type) || "")
    const t0 = await nowMs($)
    const sid = await sidFor($)
    // CONSTRAINT: метка мира снимается ОДИН раз на консультацию, рядом с sid, и
    // едет в consultBg параметром. Снимать её заново на каждой ступени нельзя:
    // смена сессии, пришедшаяся на ОТКАЗ ступени, дала бы следующей ступени уже
    // свежую метку -- её вердикт применился бы к новому миру, но лёг бы под
    // ключ кэша, посчитанный из СТАРОГО sid (строка ниже).
    const epCall = epoch
    let live = 0
    try {
      const lst = await $.agent.list()
      if (Array.isArray(lst)) live = lst.length
    } catch (x) {}

    let hardDeny: string | null = null
    let cap = 0
    // CONSTRAINT: счётчик сессионный по ключу -- бессрочный кросс-сессионный
    // ключ навсегда хоронил ветку nudge/log_only на значении capMax.
    try { cap = Number(await $.store.get(CAP_KEY + ":" + sid) || 0) } catch (x) { cap = 0 }
    const capMax = 8

    for (let i = 0; i < world.probes.length; i++) {
      const p = world.probes[i]
      if (!probeArmed(p, env)) continue
      if (p.mainLoopOnly && ("agentId" in e)) continue
      if (p.kind === "form") {
        if (p.cfg && p.cfg.enabled === false) continue
        const d = await runForm($, p, env, world, e)
        if (d && !hardDeny) hardDeny = d
        continue
      }
      if (p.kind !== "consult") continue

      let last = 0
      try { last = Number(await $.store.get(lastKey(p.id, world.cwd)) || 0) } catch (x) { last = 0 }
      const ctx: any = {
        now: t0,
        tool_name: tool,
        tool,
        subagent_type: agent,
        prompt,
        live_works: live,
        last_consultation: last,
        agent_id: undefined,
      }

      let fire = false
      if (p.builtin) fire = builtinTrigger(p, e, ctx)
      else if (p.cfg && p.cfg.when) fire = pred(p.cfg.when, ctx)
      else continue
      if (!fire) continue

      if (p.cfg && p.cfg.enabled === false) {
        if (p.id === "judge") {
          const recName = "mod-" + String((e && e.tool_use_id) || "noid") + ".json"
          try {
            await appendJournal($, world.globalHome + "/judge/journal.jsonl", {
              t: new Date(t0).toISOString(), tool, agent, outcome: "skip_disabled",
              rec: recName, carrier: "mod", sid: await sidFor($), ms: 0, probe: "judge",
            })
          } catch (x) {}
        }
        continue
      }

      if (p.id === "judge") {
        const cls = classesOf(prompt)
        const amb = cls.length > 1
        const cl = cls.length === 1 ? cls[0] : ""
        const skipC = listOf(p.cfg, "classes_skip")
        const skipA = listOf(p.cfg, "agents_skip")
        const judgeC = listOf(p.cfg, "classes_judge")
        const judgeA = listOf(p.cfg, "agents_judge")
        let by: string | null = null
        if (!amb) {
          for (let s = 0; s < skipC.length; s++) {
            try { if (cl && new RegExp(skipC[s]).test(cl)) { by = "classes_skip"; break } } catch (x) {}
          }
        }
        if (!by) {
          for (let s = 0; s < skipA.length; s++) {
            try { if (agent && new RegExp(skipA[s]).test(agent)) { by = "agents_skip"; break } } catch (x) {}
          }
        }
        if (!by && (judgeC.length > 0 || judgeA.length > 0) && !amb) {
          let hit = false
          for (let s = 0; s < judgeC.length; s++) {
            try { if (cl && new RegExp(judgeC[s]).test(cl)) hit = true } catch (x) {}
          }
          for (let s = 0; s < judgeA.length; s++) {
            try { if (agent && new RegExp(judgeA[s]).test(agent)) hit = true } catch (x) {}
          }
          if (!hit) by = cl ? "not_in_judge_list" : "no_class_marker"
        }
        if (by) {
          const recName = "mod-" + String((e && e.tool_use_id) || "noid") + ".json"
          try {
            await appendJournal($, world.globalHome + "/judge/journal.jsonl", {
              t: new Date(t0).toISOString(), tool, agent, outcome: "skip",
              rec: recName, carrier: "mod", sid: await sidFor($), reason: by, cls, ms: 0, probe: "judge",
            })
          } catch (x) {}
          continue
        }
      }

      if (p.act === "cancel" || p.pending) {
        if (!sweepDone) await sweepVerdictStore($, world, sid)
        const key = verdictKey(p.id, sid, tool, agent, prompt)
        const ttlMs = num(p.cfg && p.cfg.verdict_cache_ms, VERDICT_TTL_MS_DEFAULT, 1)
        let stored: any
        try { stored = await $.store.get(key) } catch (x) { stored = undefined }
        const enforce = p.id === "judge" ? (env.JUDGE === "enforce" || bl3(p.cfg.enforce, true)) : bl3(p.cfg.enforce, true)
        const failClosed = bl3(p.cfg.fail_closed, p.id === "judge")
        if (memoUsable(stored, t0, ttlMs)) {
          // CONSTRAINT: попадание в кэш обязано оставлять тот же след, что и
          // консульт, -- без улики и строки журнала оно отменяло суд молча.
          const recName = modRecName(e)
          const ageMs = t0 - stored.t
          let recErr = ""
          try {
            await $.fs.write(modRecPath(world, p.id, e), JSON.stringify({
              id: e && e.tool_use_id, probe: p.id, tool, agent, t0, carrier: "mod",
              mod: MOD_VERSION, sid, memo: true, kind: String(stored.kind), ageMs,
              used: stored.used, dtMs: stored.dtMs,
            }))
          } catch (x) { recErr = String(x).slice(0, 240) }
          try {
            const jline: any = {
              t: new Date(t0).toISOString(), tool, agent, outcome: "memo", rec: recName,
              carrier: "mod", sid, kind: String(stored.kind), ageMs, ms: 0, probe: p.id,
            }
            if (recErr) jline.recErr = recErr
            await appendJournal($, world.globalHome + "/" + p.id + "/journal.jsonl", jline)
          } catch (x) {
            try {
              recErr = recErr || String((x && (x as any).message) || x).slice(0, 240)
              await $.fs.write(modRecPath(world, p.id, e), JSON.stringify({
                id: e && e.tool_use_id, probe: p.id, tool, agent, t0, carrier: "mod",
                mod: MOD_VERSION, sid, memo: true, kind: String(stored.kind), ageMs,
                used: stored.used, dtMs: stored.dtMs, journalErr: recErr,
              }))
            } catch (y) {}
          }
          if (stored.kind === "BLOCK" || stored.kind === "STOP" || stored.kind === "DENY") {
            if (!enforce) continue
            hardDeny = "Subagent dispatch cancelled by the dispatch judge (this is NOT the routing-table.toml gate). Reason: " + String(stored.rest || stored.kind)
            continue
          }
          if (stored.kind === "NONE") {
            if (!failClosed) continue
            hardDeny = "Subagent dispatch cancelled: the judge obtained no verdict on any rung. This is NOT the routing-table.toml gate. Tell the human and do the work without a subagent, or retry later."
            continue
          }
        }
        let rec: any = null
        try { rec = await consultBg($, p, env, world, e, ctx, key, epCall) } catch (x) { rec = null }
        const kind = rec && rec.kind ? String(rec.kind) : ""
        if (kind === "OK" || kind === "WARN") continue
        if (kind === "BLOCK" || kind === "STOP" || kind === "DENY") {
          if (enforce) {
            hardDeny = "Subagent dispatch cancelled by the dispatch judge (this is NOT the routing-table.toml gate). Reason: " + String(rec.rest || kind)
          }
          continue
        }
        if (failClosed && (kind === "NONE" || !kind)) {
          hardDeny = "Subagent dispatch cancelled: the judge obtained no verdict on any rung. This is NOT the routing-table.toml gate. Tell the human and do the work without a subagent, or retry later."
        }
        continue
      }

      if (p.act === "nudge" || p.act === "log_only") {
        if (cap >= capMax) {
          continue
        }
        cap++
        try { await $.store.set(CAP_KEY + ":" + sid, cap) } catch (x) {}
        try { await $.store.set(lastKey(p.id, world.cwd), t0) } catch (x) {}
        ;(async () => { await consultBg($, p, env, world, e, ctx, "", epCall) })()
      }
    }

    if (hardDeny) return { deny: hardDeny }
    return next(e)
  })
    .catch(($: any, e: any, next: any) => decisiveFailClosed($, "tool.call", e, next))

  on("agent.spawn", async ($: any, e: any, next: any) => {
    const subagentType = String((e && e.subagentType) || "")
    const cls = classesOf(String((e && e.prompt) || ""))
    const classId = cls.length ? cls[0] : ""
    const spawnModel = String((e && e.model) || "")
    let world: any = null
    try {
      const w = await worldFor($)
      world = w && w.world
    } catch (x) { world = null }
    const result = await next(e)
    if (!result || result.deny || !result.agentId) return result
    if (classHasPrefix(classId, EXECUTOR_CLASS_PREFIXES)) sessionExecutorModelAdd(spawnModel)
    if (!world || !world.failover || !bl3(world.failover.enabled, true)) return result
    const info = failoverLadderBind(world.failover, subagentType, classId, world.allowedByClass, spawnModel)
    // CONSTRAINT: пустая лестница неотличима от забытой, если source/allowedSrc
    // не записаны. Привязка кладётся на всех ветках, включая ladder.length===0
    // (клетка 1d, пустой allowed, оба адреса таблицы недоступны).
    failoverBindSet(String(result.agentId), {
      ladder: info.ladder, subagentType, class: classId, sticky: null,
      rungEffort: info.rungEffort, effortBad: info.effortBad, rungsDropped: info.rungsDropped,
      source: info.source, allowedSrc: world.allowedSrc,
    })
    // CONSTRAINT: журнал пустой лестницы пишется ЗДЕСЬ, один раз на агента.
    // turn.step на пустой привязке выходит до journalExtra -- писать оттуда
    // залило бы журнал на каждом шаге.
    if (!info.ladder.length) {
      try {
        const sid = await sidFor($)
        const t1 = await nowMs($)
        // CONSTRAINT: пустой дом даёт путь от корня -- писать наружу нельзя.
        // Тот же гард несёт писатель попыток ниже.
        const jpath = world.globalHome ? world.globalHome + "/failover/journal.jsonl" : ""
        if (jpath) await appendJournal($, jpath, {
          t: new Date(t1).toISOString(),
          sid,
          rec: "empty-ladder-" + String(result.agentId),
          agentId: String(result.agentId),
          subagentType,
          class: classId,
          source: info.source,
          allowedSrc: world.allowedSrc,
        })
      } catch (x) {}
    }
    return result
  })
    .catch(($: any, e: any, next: any) => decisiveFailClosed($, "agent.spawn", e, next))

  on("turn.step", async function* ($: any, e: any, next: any) {
    const aid = e && e.agentId
    if (aid == null || aid === "") {
      return yield* driveNext(next(e))
    }
    const bind = failoverBindGet(String(aid))
    if (!bind || !bind.ladder || !bind.ladder.length) {
      return yield* driveNext(next(e))
    }
    let world: any = null
    try {
      const w = await worldFor($)
      world = w && w.world
    } catch (x) { world = null }
    if (world && world.failover && !bl3(world.failover.enabled, true)) {
      return yield* driveNext(next(e))
    }
    const original = String(e.model || "")
    // CONSTRAINT (#226): проверяющего (crit-/audit-) нельзя переводить на модель,
    // которой в этой сессии работал исполнитель, -- проверка вырождается в
    // самопроверку. Модель СТАРТА при этом мод не переписывает: назначение вне
    // мода, совпадение уходит в улику отметкой, а не решением.
    const reviewer = classHasPrefix(bind.class, REVIEWER_CLASS_PREFIXES)
    const executor = classHasPrefix(bind.class, EXECUTOR_CLASS_PREFIXES)
    let planLadder: string[] = bind.ladder
    let rungsFiltered = 0
    let ladderFullTaken = false
    const startMatch = reviewer && sessionExecutorHas(original)
    if (reviewer) {
      const keep: string[] = []
      for (let i = 0; i < bind.ladder.length; i++) {
        if (!sessionExecutorHas(bind.ladder[i])) keep.push(bind.ladder[i])
      }
      rungsFiltered = bind.ladder.length - keep.length
      if (keep.length) {
        planLadder = keep
      } else {
        // Остановленный проверяющий хуже проверки той же моделью, но молчаливое
        // совпадение хуже обоих.
        planLadder = bind.ladder
        ladderFullTaken = true
      }
    }
    // CONSTRAINT: bind.ladder и bind.sticky не переписываются -- в привязке
    // лежит объявленная реестром истина и факт «эта ступень отработала»;
    // очистка от моделей исполнителей -- решение одного шага. Порядок ступеней
    // строит failoverAttemptModels -- ТА ЖЕ функция, которую пинят зубы;
    // второй копии порядка в бою не держать. Снятие липкости -- на ИСПОЛЬЗОВАНИИ:
    // накопитель растёт позже установки, проверка в прошлом снова преждевременна.
    let planSticky = bind.sticky
    let stickyDropped = false
    if (reviewer && planSticky && sessionExecutorHas(String(planSticky))) {
      planSticky = null
      stickyDropped = true
    }
    const plan = failoverAttemptModels(original, planSticky, planLadder)
    if (!plan.length) return yield* driveNext(next(e))
    // Отметки шага #226 уезжают в КАЖДУЮ запись попытки: улика попытки
    // самодостаточна и без соседних строк шага.
    const journalExtra: any = {}
    if (reviewer) {
      journalExtra.rungsFiltered = rungsFiltered
      if (ladderFullTaken) journalExtra.ladderFullTaken = true
      if (startMatch) journalExtra.startMatch = true
      if (stickyDropped) journalExtra.stickyDropped = true
    }
    if (sessionExecutorModelsOverflow) journalExtra.execOverflow = true
    if (bind.rungsDropped) journalExtra.rungsDropped = bind.rungsDropped
    if (bind.source) journalExtra.source = bind.source
    if (bind.allowedSrc) journalExtra.allowedSrc = bind.allowedSrc
    let lastRes: any = null
    let lastThrow: any = null
    let sawThrow = false
    for (let attempt = 0; attempt < plan.length; attempt++) {
      const model = plan[attempt]
      const t0 = await nowMs($)
      const declared = bind.rungEffort && bind.rungEffort[model]
      // CONSTRAINT: эффорт применяется ТОЛЬКО на реальном переходе
      // (model !== original). На попытке 0, идущей моделью хоста,
      // авторитет у frontmatter агента -- пин ТОЙ ЖЕ клетки и он
      // конкретнее реестра; hookEffortValue перебил бы его (первый
      // приоритет в DE).
      let req: any
      if (model === original) {
        req = e
      } else if (declared) {
        // CONSTRAINT: поле effort выставляется только когда объявлено и
        // годно. undefined/пустая строка включили бы канал hookEffortValue
        // на пустом значении. Улика называет эффорт ЗАПРОШЕННЫМ
        // (rungEffortRequested), не применённым: x(E, model) тихо клампит
        // max→high / xhigh→high у моделей без соответствующего флага, без
        // отказа, и кламп с этой поверхности ненаблюдаем.
        req = Object.assign({}, e, { model, effort: declared })
      } else {
        req = Object.assign({}, e, { model })
      }
      let res: any = null
      let threw: any = null
      // CONSTRAINT: факт броска несёт ОТДЕЛЬНЫЙ флаг, а не истинность значения.
      // `throw 0` / `throw ""` / `throw null` -- законные броски, и по значению
      // они неотличимы от «не бросали»: ступень объявила бы отказ успехом,
      // залипла на ней и вернула null вызывающему.
      let didThrow = false
      // CONSTRAINT: кусок, уже ушедший наружу, находится у сессии -- отмены
      // нет. Ступень, выдавшая хотя бы один кусок С СОДЕРЖИМЫМ, СОСТОЯЛАСЬ:
      // переход с неё запрещён и при отказе носителя, и при броске, иначе к
      // ответу одной модели приклеится хвост другой.
      // Уточнение 18.09 (#239): «кусок» здесь -- кусок, дошедший до сессии, а
      // не любой элемент потока. Служебная оболочка потока сессии не достаётся,
      // склеивать нечего, и запрет на ней был ложным -- см. chunkCarriesContent.
      const emitted = { n: 0, content: 0, kinds: [] as string[] }
      try {
        res = yield* driveNext(next(req), emitted)
      } catch (x) { threw = x; didThrow = true }
      const t1 = await nowMs($)
      // CONSTRAINT: решает СОДЕРЖИМОЕ, не счёт кусков -- см. countEmitted.
      // Поле emitted в улике остаётся СЫРЫМ счётом: по нему сравниваются все
      // прежние записи, и именно оно показало дефект (11 служебных кусков).
      const afterEmit = emitted.content > 0
      const outcome = didThrow
        ? (afterEmit ? "threw_after_emit" : "threw")
        : (isCarrierRefusal(res) ? (afterEmit ? "empty_after_emit" : "empty") : "ok")
      const recKey = String(aid) + "-" + String(e.turnId || "") + "-" + String(e.index) + "-" + String(attempt)
      // CONSTRAINT: предсказание смены липкости -- тот же предикат, что установка
      // ниже (failoverWouldSetSticky). Улика пишется ДО bind.sticky = model;
      // расхождение двух вызовов посчитает скучность по устаревшему правилу и
      // пропустит разрез окна.
      const willSetSticky = failoverWouldSetSticky(didThrow, res, reviewer, model)
      const stickyChanged = !!(willSetSticky && bind.sticky !== model)
      try {
        let sid = ""
        try { sid = await sidFor($) } catch (x) { sid = "" }
        const jpath = world && world.globalHome ? world.globalHome + "/failover/journal.jsonl" : ""
        if (jpath) {
          const rec: any = {
            t: new Date(t1).toISOString(),
            sid,
            rec: recKey,
            agentId: String(aid),
            subagentType: bind.subagentType,
            class: bind.class,
            turnId: e.turnId,
            index: e.index,
            attempt,
            modelRequested: model,
            outcome,
            emitted: emitted.n,
            emittedContent: emitted.content,
            emittedKinds: emitted.kinds,
            dtMs: t1 - t0,
            laddered: model !== original,
            ...journalExtra,
          }
          if (declared && model !== original) rec.rungEffortRequested = declared
          if (bind.effortBad && bind.effortBad[model]) rec["effortBad_" + model] = bind.effortBad[model]
          armFailoverFoldTimer($, world)
          if (failoverAttemptIsBoring(rec, stickyChanged)) {
            await failoverFoldObserve($, world, t1, String(bind.sticky || model || ""), sid, String(aid))
          } else {
            await failoverFoldFlush($, world)
            await appendJournal($, jpath, rec)
          }
        }
      } catch (x) {}
      if (didThrow) {
        // CONSTRAINT: исключение носителя гасится ТОЛЬКО пока есть следующая
        // ступень. На последней оно уезжает вызывающему нетронутым: съеденное
        // исключение неотличимо от пустого ответа. Выдавшая ступень бросает
        // ту же дисциплину независимо от номера: её куски уже у сессии.
        lastThrow = threw
        sawThrow = true
        if (afterEmit || attempt === plan.length - 1) throw threw
        continue
      }
      lastRes = res
      lastThrow = null
      sawThrow = false
      const refusal = isCarrierRefusal(res)
      // CONSTRAINT (#226): липкость не ставится на ступень-совпадение --
      // failoverAttemptModels кладёт липкую ступень в plan[0], и совпадение
      // зацепило бы проверяющего за модель исполнителя навсегда. У удачной
      // ступени исполнителя модель запоминается как факт сессии.
      if (!refusal) {
        if (executor) sessionExecutorModelAdd(model)
        if (failoverWouldSetSticky(false, res, reviewer, model)) bind.sticky = model
      }
      // CONSTRAINT: отказ носителя ПОСЛЕ выдачи уезжает вызывающему как есть:
      // куски первой ступени уже у сессии, вторая приклеила бы к ним чужой
      // хвост. До первой выдачи поведение прежнее -- отказ ведёт на следующую
      // ступень.
      if (afterEmit || !refusal) return res
    }
    if (sawThrow) throw lastThrow
    return lastRes
  })
    .catch(observerFailThroughStream)
}
