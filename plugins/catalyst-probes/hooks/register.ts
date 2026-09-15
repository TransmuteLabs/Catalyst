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
// чтение в tool.call и порог уборки в session.start обязаны совпадать.
const VERDICT_TTL_MS_DEFAULT = 120000
// CONSTRAINT: версия дублируется в .claude-plugin/plugin.json НАМЕРЕННО --
// манифест читает установщик, константу -- улика; расхождение ловит зуб в
// tests/units.test.ts, сверяющий константу с манифестом.
export const MOD_VERSION = "0.1.13"
const COACHING =
  "A subagent dispatch may be reviewed before it runs. " +
  "If one is cancelled, the tool result states the reason: treat that reason as a correction to apply. " +
  "Reissue the dispatch only with the change it names, and never repeat the identical call — an unchanged retry cannot succeed. " +
  "This review is separate from the permission system and from any routing gate, so do not attribute a cancellation to either."
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

export function rungsOf(cfg: any, modelEnv: string): { model: string; effort?: string; effortBad?: string; max_tokens?: number; timeout_ms?: number; context_chars?: number }[] {
  const raw = cfg && cfg.models
  const out: { model: string; effort?: string; effortBad?: string; max_tokens?: number; timeout_ms?: number; context_chars?: number }[] = []
  if (Array.isArray(raw) && raw.length) {
    for (let i = 0; i < raw.length; i++) {
      const x = raw[i]
      if (typeof x === "string" && x) out.push({ model: x })
      else if (x && typeof x === "object" && x.model) {
        const r: any = { model: String(x.model) }
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
        out.push(r)
      }
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

async function appendJournal($: any, jpath: string, obj: any) {
  const line = JSON.stringify(obj) + "\n"
  const rec = String((obj && (obj.rec || obj.t)) || ("t" + String(await nowMs($))))
  let safe = ""
  for (let i = 0; i < rec.length; i++) {
    const c = rec.charAt(i)
    safe += /[A-Za-z0-9._-]/.test(c) ? c : "_"
  }
  try { await $.fs.write(jpath + ".shard." + safe, line) } catch (x) {}
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
// changed text file must be picked up.
const promptTextMemo: any = {}

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
// per session, so the world is memoised for a short window. Correctness never
// depends on the memo — only cost does.
let worldMemo: any = null

async function worldFor($: any): Promise<any> {
  const now = await nowMs($)
  if (worldMemo && now - worldMemo.t < 5000) return worldMemo
  const env = await envBundle($)
  const world = await loadWorld($, env)
  worldMemo = { t: now, env, world }
  return worldMemo
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

const rxCache: any = {}
function K(s: string, f: string): RegExp {
  const key = f + "|" + s
  if (rxCache[key]) return rxCache[key]
  const r = new RegExp(s, f)
  rxCache[key] = r
  return r
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

async function loadWorld($: any, env: any): Promise<any> {
  let globalHome = ""
  if (env.PROBES_DIR) globalHome = env.PROBES_DIR
  else if (env.CONFIG_DIR) globalHome = env.CONFIG_DIR + "/probes"
  else globalHome = env.HOME + "/.claude/probes"
  let cwd = env.PWD
  if (!cwd) {
    try { cwd = String(await $.store.get(CWD_KEY) || "") } catch (x) { cwd = "" }
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
  return {
    globalHome, projectHome, cwd, cfgUnread,
    probes: probesOf(gParsed, pParsed),
    prompts: promptsOf(gParsed, pParsed),
  }
}

// CONSTRAINT: имя и путь улики одним домом -- улика консульта и улика
// попадания в кэш обязаны строиться побайтно одной формой.
function modRecName(e: any): string {
  return "mod-" + String((e && e.tool_use_id) || "noid") + ".json"
}

function modRecPath(world: any, id: string, e: any): string {
  return world.globalHome + "/" + id + "/records/" + modRecName(e)
}

async function consultBg($: any, p: any, env: any, world: any, e: any, ctx: any, key: string): Promise<any> {
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
    const ladder = rungsOf(cfg, modelEnv)
    rec.ladder = ladder.map((r: any) => r.model)
    let verdict: { kind: string; rest: string } | null = null
    let used = ""
    const floorTok = num(cfg.max_tokens, 8000, 1)
    const floorTmo = p.id === "judge" ? num(env.JUDGE_TIMEOUT, num(cfg.timeout_ms, 0, 1), 1) : num(cfg.timeout_ms, 0, 1)
    for (let i = 0; i < ladder.length; i++) {
      const rung = ladder[i]
      used = rung.model
      const rungCtxN = rungCtx(rung, cfg)
      markEffort(rec, used, rung)
      const full = buildFull(rungCtxN)
      const rungT0 = await nowMs($)
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
        const tmo = rung.timeout_ms || floorTmo
        if (tmo) arg.timeoutMs = tmo
        // CONSTRAINT: detail просят ВСЕГДА. Образ со шагом 31 отдаёт конверт
        // {text, stopReason, blocks, usage}; образ без него поля не знает и
        // возвращает прежнюю строку -- readComplete различает обе формы, и
        // мод остаётся годен на обоих образах (#190).
        arg.detail = true
        const ans = readComplete(await $.model.complete(arg))
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
      } catch (x) {
        // Длительность ОТКАЗА мерится тем же полем: мгновенный отказ по
        // бюджету и отказ после ожидания провайдера -- разные явления.
        rec["ms_" + used] = await nowMs($) - rungT0
        rec["ctxN_" + used] = rungCtxN
        rec["err_" + used] = String(x).slice(0, 240)
      }
    }
    rec.dtMs = await nowMs($) - t0
    rec.used = used
    if (verdict) {
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
      rec.kind = "NONE"
      if (p.pending || p.act === "cancel") {
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
  try {
    await appendJournal($, jpath, {
      t: new Date(t0).toISOString(), tool, outcome: vk, verdict: clip(vd, 400),
      cls, jm: "rules", tries: 0, rec: recName, carrier: "mod", sid: await sidFor($), probe: "form",
      skipped: sk.slice(0, 8),
    })
  } catch (x) {}
  if (vk !== "pass") {
    try { await $.fs.write(recPath, JSON.stringify({ ev: tool, cls, refuse: rf, warn: wn, vd })) } catch (x) {}
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

export function register(on: any) {
  on("session.start", async ($: any, e: any, next: any) => {
    try { if (e && e.cwd) await $.store.set(CWD_KEY, String(e.cwd)) } catch (x) {}
    // CONSTRAINT: разовая уборка отравленных вердиктных ключей судьи --
    // записи без t (форма до сессионной границы) и протухшие сверх срока
    // умолчания. Префикс v:judge: обязателен: стор общий, чужих ключей не
    // трогаем. Отказ уборки не красит и не прерывает session.start.
    try {
      const sid = await sidFor($)
      const world = await loadWorld($, await envBundle($))
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
    return next(e)
  })

  on("prompt.section", async ($: any, e: any, next: any) => {
    const name = String((e && e.name) || "")
    let w: any = null
    try { w = await worldFor($) } catch (x) { w = null }
    if (!w) return next(e)
    const r = await applyPromptRules($, w.world, w.env, "section", name, String((e && e.text) || ""))
    if (!r.applied.length) return next(e)
    return next(Object.assign({}, e, { text: r.text }))
  })

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

  on("tool.call", async ($: any, e: any, next: any) => {
    if ("agentId" in e) return next(e)
    const tool = String((e && e.tool) || "")
    const env = await envBundle($)
    const world = await loadWorld($, env)
    const prompt = String((e && e.prompt) || "")
    const agent = String((e && e.subagent_type) || "")
    const t0 = await nowMs($)
    const sid = await sidFor($)
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
          } catch (x) {}
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
        try { rec = await consultBg($, p, env, world, e, ctx, key) } catch (x) { rec = null }
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
        ;(async () => { await consultBg($, p, env, world, e, ctx, "") })()
      }
    }

    if (hardDeny) return { deny: hardDeny }
    return next(e)
  })
}
