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
export const MOD_VERSION = "0.1.59"
// CONSTRAINT: пятичасовой лимит провайдера не должен запирать восстановившуюся
// ступень на пять часов; окно 15 минут допускает четыре повторные пробы в час.
export const RUNG_COOLDOWN_MS = 900000
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
  "git_commit","git_commit_ok","git_push","git_push_ok","git_force",
  "trailer_a","trailer_b","write_target",
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

// CONSTRAINT: время вне диапазона Date (±8.64e15) -- отказ часов: такое значение рвёт isoOf-поля и проход свёртки compact.py.
export async function nowMs($: any): Promise<number> {
  let v: any = null
  try { v = await $.clock.now() } catch (x) { v = null }
  if (typeof v === "number" && isFinite(v) && Math.abs(v) <= 8.64e15) return v
  clockBad = true
  return Date.now()
}

// CONSTRAINT: `new Date(x).toISOString()` бросает RangeError вне ±8.64e15 и на NaN; время записи журнала не имеет права уносить запись (и состояние сброса) с собой.
function isoOf(t: number): string {
  const d = new Date(t)
  return Number.isFinite(d.getTime()) ? d.toISOString() : "invalid-time:" + String(t)
}

// CONSTRAINT (#509-FIX7d AR4): живой движок 2.1.283 не снимает turn.step, пока хук ждёт гонку двери со сроком ($.clock.after и $.clock.sleep): шаг прожил 30 с при бюджете 10 с, remainingMs не менялся (Catalyst-programs/2026-09-25-ladder-terminal-509/probe-ar4-live/logs/probe.jsonl); изолированное ожидание часов дольше бюджета не мерилось. Кит claude plugin test одиночное ожидание clock.after снимает на 10 с, поэтому такое ожидание зубом кита не мерится.
// CONSTRAINT: временную границу ступени держит ЭТОТ сторож, а не одна лишь
// просьба `arg.timeoutMs`. Ту границу исполняет образ (шаг 31 патча), и её
// нет вовсе, когда поле не доехало; а переход по лестнице в runProbe делается
// ТОЛЬКО через catch -- поэтому вызов, который не вернулся и не бросил,
// останавливал лестницу навсегда: измерено 2026-09-16, диспатч не стартовал
// час при живом прокси и работающих ступенях.
// Гонка НЕ отменяет висящий запрос (мод-API сигнала отмены не принимает:
// `complete(request)` и только) -- она освобождает лестницу, оставляя запрос
// доживать в фоне.
async function raceDeadline($: any, work: Promise<any>, ms: number, label: string, rec: any, site: string): Promise<any> {
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
  let dl: any = null
  const armed = wait.then(
    () => { dl = new Error("rung-deadline " + label + " " + ms + "ms"); throw dl },
    (x: any) => {
      rec.deadlineBlind = true
      rec.deadlineBlindErr = safeText(x).slice(0, 160)
      return new Promise<never>(() => {})
    },
  )
  try {
    return await Promise.race([work, armed])
  } catch (x) {
    // CONSTRAINT (#509-FIX8 Р12): работа, проигравшая срок, доживает в фоне, и её поздний отказ -- noteLost(site); отказ победившей работы несёт вызывающий, второй записи нет.
    if (dl !== null && x === dl) work.catch((y: any) => noteLost(site, y, $))
    throw x
  }
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

export function failoverLadderBind(fo: any, subagentType: string, classId: string): {
  ladder: string[]
  rungEffort: { [k: string]: string }
  effortBad: { [k: string]: string }
  rungsDropped: number
  source: "agent" | "class" | "default" | "none"
} {
  const empty = { ladder: [] as string[], rungEffort: {} as { [k: string]: string }, effortBad: {} as { [k: string]: string }, rungsDropped: 0, source: "none" as const }
  if (fo && typeof fo === "object") {
    const fromAgent = tableRungs(fo.agent && subagentType ? fo.agent[subagentType] : null)
    if (fromAgent.models.length) return { ladder: fromAgent.models, rungEffort: fromAgent.rungEffort, effortBad: fromAgent.effortBad, rungsDropped: fromAgent.dropped, source: "agent" }
    const fromClass = tableRungs(fo.class && classId ? fo.class[classId] : null)
    if (fromClass.models.length) return { ladder: fromClass.models, rungEffort: fromClass.rungEffort, effortBad: fromClass.effortBad, rungsDropped: fromClass.dropped, source: "class" }
    const fromDefault = tableRungs(fo.default)
    if (fromDefault.models.length) return { ladder: fromDefault.models, rungEffort: fromDefault.rungEffort, effortBad: fromDefault.effortBad, rungsDropped: fromDefault.dropped, source: "default" }
  }
  return empty
}

// CONSTRAINT (#509-FIX1 E1): ОДНА нормализация имени модели в моде: trim,
// нижний регистр, снятие суффикса окна "[1m]"/"[2m]". Второй дом правила
// развёл бы вердикты сравнений на одном входе.
// CONSTRAINT (#509-FIX3 AR-4): нормализованный id -- ТОЛЬКО для сравнений
// (допуск, план, терминал, метки, фильтр #226). В next уходит строка как
// написана: окно 1M и бета хоста ставятся только по суффиксу в строке модели.
export function normModelId(x: any): string {
  const s = String(x == null ? "" : x).trim().toLowerCase()
  return /\[[12]m\]$/.test(s) ? s.slice(0, -4).trim() : s
}

// CONSTRAINT (#509-FIX1 E2): короткие имена версионно-зависимы
// (rules/model-routing.md) -- терминалом не принимаются ни модом, ни прибором.
export const TERMINAL_ALIASES = ["opus", "fable", "sonnet", "haiku"]

// CONSTRAINT (#509-FIX1 B1): признак Anthropic-носителя с нативным эффортом --
// нормализованный id с префиксом "claude-"; ему пин клетки не нужен.
export function isAnthropicModelId(x: any): boolean {
  return normModelId(x).indexOf("claude-") === 0
}

export function failoverTerminal(fo: any): { model: string; effort: string; effortBad: string; absent: string } {
  const raw = fo && typeof fo === "object" ? fo.terminal : undefined
  if (raw === undefined || raw === null) return { model: "", effort: "", effortBad: "", absent: "ключ terminal не объявлен" }
  // CONSTRAINT: пустота меряется после trim.
  if (typeof raw === "string" && !raw.trim()) return { model: "", effort: "", effortBad: "", absent: "ключ terminal пуст" }
  const r = Array.isArray(raw) ? null : parseRungItem(raw)
  const norm = r ? normModelId(r.model) : ""
  if (!norm) return { model: "", effort: "", effortBad: "", absent: "форма terminal негодна" }
  if (TERMINAL_ALIASES.indexOf(norm) >= 0) return { model: "", effort: "", effortBad: "", absent: "terminal-alias-refused" }
  // CONSTRAINT (#509-FIX1 E3): терминал лестницы -- только Anthropic-носитель;
  // не-Anthropic терминал отвергается.
  if (!isAnthropicModelId(norm)) return { model: "", effort: "", effortBad: "", absent: "terminal-not-anthropic" }
  return { model: String((r as RungItem).model), effort: r && r.effort || "", effortBad: r && r.effortBad || "", absent: "" }
}

// CONSTRAINT (#509-FIX1 A2/A3): ступень берётся, только если её нормализованное
// имя есть в СЛИТОМ допуске клетки. Непригодный допуск не допускает ничего --
// проход сводится к объявленной модели и терминалу, а не к полной лестнице.
export function admitLadder(ladder: string[], classId: string, allowedByClass: any, usable: boolean): { ladder: string[]; notAdmitted: string[]; unavailable: boolean } {
  const rows = Array.isArray(ladder) ? ladder : []
  if (!usable) return { ladder: [], notAdmitted: [], unavailable: true }
  const row = allowedByClass && typeof allowedByClass === "object" && Object.prototype.hasOwnProperty.call(allowedByClass, classId)
    ? allowedByClass[classId] : []
  const admitted: string[] = []
  if (Array.isArray(row)) for (let i = 0; i < row.length; i++) admitted.push(normModelId(row[i]))
  const keep: string[] = []
  const not: string[] = []
  for (let i = 0; i < rows.length; i++) {
    if (admitted.indexOf(normModelId(rows[i])) >= 0) keep.push(rows[i])
    else not.push(rows[i])
  }
  return { ladder: keep, notAdmitted: not, unavailable: false }
}

export function admissionUsable(world: any): boolean {
  const src = String((world && world.allowedSrc) || "")
  if (!src || (world && world.allowedRefused)) return false
  return src.indexOf("absent:") < 0
}

// --- #514: класс отказа и срок из текста -------------------------------------

export const REFUSAL_TEXT_MAX = 300

// CONSTRAINT (#509-FIX3 M1/M2): строка отказа -- первая непустая строка
// СВЕЖЕГО assistant-текста (добавленного после начала попытки); класс решает
// таблица префиксов ниже. Старая строка истории класс не решает.
export function refusalLineOf(text: any): string {
  const lines = String(text == null ? "" : text).split("\n")
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (l) return l
  }
  return ""
}

// CONSTRAINT (#509-FIX3 M2): таблица -- дословные тексты хоста. Решает
// НАЧАЛО строки, не вхождение: «API Error: 402 Credit balance is too low» --
// не форма хоста и не permanent-model.
// CONSTRAINT (#509-FIX6 А3): дом переписи -- G/SCOUT-HOST-REFUSAL-TEXTS-283.md
// (2.1.283, функция yUn); переход версии обязан перемерить перепись, а
// таблица зуба -- сверить каждый литерал.
export const REFUSAL_REQUEST_PREFIXES = [
  "Prompt is too long", "Request too large (max", "Request too large for the API",
  "Image was too large.", "PDF too large (max ", "PDF is password protected.", "The PDF file was not valid.",
  "An image in the conversation exceeds the dimension limit", "Auto mode is unavailable for your plan",
  "Autocompact is thrashing:",
]
// CONSTRAINT (#514 Р9): отказ о состоянии учётки (вход, токен, ключ, учётные
// данные провайдера) -- temporary-unknown с backoff, не permanent-model: за
// шлюзом localhost:8317 учётка ротируется и возвращается сама, а метка
// permanent-model на час снимала объявленную модель агента одним 403. Шлюз,
// не вошедший к своему провайдеру (nin 2.1.287), -- та же учётка за шлюзом.
// Отказы аккаунта и политики (кредит, план, организация, «Gateway refused
// the request») остаются permanent.
export const REFUSAL_AUTH_PREFIXES = [
  "Authentication error · The gateway could not authenticate with its upstream provider",
  "Your account does not have access to Claude.",
  "Not logged in · Please run /login",
  "Authentication required · Sign in again to continue",
  "Please run /login",
  "Failed to authenticate.",
  "OAuth token revoked · Please run /login",
  "Login expired · ",
  "Failed to authenticate: OAuth session expired and could not be refreshed",
  "Invalid API key · ", "Invalid auth token · ",
  "Your apiKeyHelper script is failing · ",
  "Anthropic profile login expired · ",
  "AWS credentials expired or invalid", "AWS authentication failed",
  "Google Cloud credentials expired or invalid", "Google Cloud authentication failed",
  "Microsoft Foundry authentication failed",
]
// CONSTRAINT (#514 Р9-FIX1): хвост ветки remedy "model_access" хоста 2.1.287
// (Bedrock: модель не включена для аккаунта и региона) -- отказ МОДЕЛИ при
// префиксе учётки AWS; ротация учётки его не снимет.
export const REFUSAL_AUTH_MODEL_ACCESS = " · enable this model for your account and region in the Amazon Bedrock console"
// CONSTRAINT (#514 Р9-FIX2): 403 Bedrock «is not authorized to perform:
// bedrock:InvokeModel» хост 2.1.287 (Cut, yJ) судит отдельным классом denied,
// не credential: политика IAM на ресурс модели -- отказ МОДЕЛИ при префиксе
// учётки AWS; ни ротация учётки, ни ожидание его не снимают.
export const REFUSAL_AUTH_MODEL_DENIED_RX = /is not authorized to perform: bedrock:InvokeModel/i
export const REFUSAL_PERMANENT_PREFIXES = [
  "Credit balance is too low",
  "Claude Opus is not available with the Claude Pro plan",
  "Invalid ANTHROPIC_CUSTOM_HEADERS · ",
  "Invalid request header from the environment · ",
  "Your ANTHROPIC_API_KEY belongs to a disabled organization · ",
  "Your organization has disabled Claude subscription access for Claude Code · ",
  "Your organization has disabled API key authentication · ",
  "Your account is on hold and can't use Claude Code.",
  "This service is disabled for your org",
  "Gateway refused the request",
  "There's an issue with the selected model (",
  "CLAUDE_CODE_NO_MODEL_FALLBACK is set: model substitution is disabled",
  "The server routed this response to a model that is not in your organization’s availableModels allowlist; the response was discarded.",
]
// CONSTRAINT (#509-FIX7 А-Р6): строка хоста Hdt сама говорит о временности --
// temporary-unknown; сверяется целиком и ДО префиксов permanent.
export const REFUSAL_TEMPORARY_EXACT = [
  "Authentication error · This may be a temporary network issue, please try again",
]
// CONSTRAINT (#509-FIX7 Р14): мёртвый провайдер и квота решаются по тексту
// строки ДО префиксных таблиц, включая обёртку `API Error`. Квота -- не лимит
// Claude (#514): свой класс quota и своё остывание.
export const PROVIDER_GONE_RX = /\b(unknown provider|model not found|no such model|unknown model|model [^\s]+ (?:is not|isn't) (?:available|supported))\b/i
// CONSTRAINT (#509-FIX7b AR1): 402 -- только HTTP-статус (начало строки,
// `API Error: 402`, `"status": 402`, `status=402`, `HTTP 402`); свободное число
// («line 402», путь `/402/`) квотой не считается.
// CONSTRAINT (#509-FIX8 Р2): в начале строки -- `402`, за которым пробел или
// конец строки (форма SDK `<status> <тело>`); `402/…`, `402.`, `402-` -- не статус.
// CONSTRAINT (#509-FIX9 R3): отказ прокси «last upstream error: quota)» и
// «spent allowance» -- quota, каждый признак сам по себе.
export const QUOTA_RX = /^\s*402(?=\s|$)|(?:\bAPI Error:\s*|"status"\s*:\s*|\bstatus\s*[=:]\s*|\bHTTP(?:\/[\d.]+)?\s+)402\b|\b(?:payment required|insufficient (?:balance|credits?|quota)|credential_quota|quota (?:exceeded|exhausted))\b|\blast upstream error:\s*quota\)|\bspent allowance\b/i
export const QUOTA_COOLDOWN_MS = 60 * 60 * 1000
// CONSTRAINT (#509-FIX9 R3): срок квоты из текста -- «soonest recovery in
// <N>h<N>m<N>s», любая подпоследовательность частей в этом порядке, N целые,
// части могут разделяться пробелами (#509-FIX10 F4); формы нет -- -1, срок
// метки тогда QUOTA_COOLDOWN_MS.
// CONSTRAINT (#509-FIX11 B5): после удачно разобранной части не должно стоять
// другого числового unit («2m 1h» не упорядочен) -- укороченный срок ложен.
export const QUOTA_RECOVERY_RX = /\bsoonest recovery in\s+(?=\d+[hms])(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?(?!\w)/i
export function quotaRecoveryMsOf(text: any): number {
  const s = String(text == null ? "" : text)
  const m = QUOTA_RECOVERY_RX.exec(s)
  if (!m) return -1
  if (/^\s*\d+\s*[hms]/.test(s.slice(m.index + m[0].length))) return -1
  return ((Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 1000
}
// CONSTRAINT (#509-FIX7 ADD1 Р14b): окно квоты z.ai (1308) по тексту -- запасной
// признак к error.code; решает только на ступени не-Anthropic модели.
export const QUOTA_WINDOW_RX = /\bUsage limit reached for \d+ hour/i
const REFUSAL_JSON_TRIES = 8

// CONSTRAINT (#509-FIX7 ADD1 Р14a/Р14b): error.code первого JSON-объекта строки
// отказа, у которого есть error.code; строкой. Разбор без броска наружу: не
// разобрано -- "" (кода нет), классификация идёт дальше по тексту. Пробуются
// не больше REFUSAL_JSON_TRIES начал «{» и концов «}».
export function refusalErrorCodeOf(text: any): string {
  const s = String(text == null ? "" : text)
  const starts: number[] = []
  for (let i = s.indexOf("{"); i >= 0 && starts.length < REFUSAL_JSON_TRIES; i = s.indexOf("{", i + 1)) starts.push(i)
  const ends: number[] = []
  for (let i = s.lastIndexOf("}"); i >= 0 && ends.length < REFUSAL_JSON_TRIES; i = i > 0 ? s.lastIndexOf("}", i - 1) : -1) ends.push(i)
  for (let a = 0; a < starts.length; a++) {
    for (let b = 0; b < ends.length; b++) {
      if (ends[b] <= starts[a]) continue
      let o: any = null
      try { o = JSON.parse(s.slice(starts[a], ends[b] + 1)) } catch (x) { continue }
      const e = o && typeof o === "object" ? o.error : null
      if (e && typeof e === "object" && e.code !== undefined && e.code !== null) return String(e.code)
    }
  }
  return ""
}
// CONSTRAINT (#509-FIX6 А3): форма хоста «The model <id> is not available on
// your <deployment> deployment» -- permanent-model, та же ступень, что префиксы.
export const REFUSAL_MODEL_UNAVAILABLE_RX = /^The model [^\r\n]+ is not available on your /
// CONSTRAINT (#509-FIX3 M2): список лимитных префиксов хоста qDr, дословно.
export const REFUSAL_LIMIT_PREFIXES = [
  "You've hit your", "You've reached your", "You're out of usage credits",
  "Your org is out of usage · add funds to continue", "Your org is out of usage · contact your admin",
  "Your seat type doesn't include usage credits", "Your seat type doesn't include usage",
  "Your usage allocation has been disabled by your admin", "Your group's usage limit is set to $0",
  "Fable 5 requires usage credits.", "You're out of extra usage", "Your seat type doesn't include extra usage",
  "Fable limit reached · ",
]
// CONSTRAINT (#509-FIX4 F-3): лимитный класс несёт и форму билдера хоста fLn
// «<Name> requires usage credits» (AN-509-HOST-REPORT Q2): имя непусто и без
// переводов строки; qDr держит из этой формы одно «Fable 5».
// CONSTRAINT (#509-FIX5 Р4): имя без двоеточия -- обёртка `API Error`/`Request
// timed out` решает раньше всех форм, и «API Error: <Name> requires usage
// credits» -- её класс, не лимитный.
export const REFUSAL_CREDITS_RX = /^[^\r\n:]+ requires usage credits/
// CONSTRAINT (#509-FIX6 А3): форма хоста «<Name> now uses usage credits · …» --
// лимит Claude (#514); имя без двоеточия по той же причине, что у CREDITS_RX.
export const REFUSAL_CREDITS_NOW_RX = /^[^\r\n:]+ now uses usage credits · /
// CONSTRAINT (#509-FIX4 AR-c/F-5): прочие начала строк таблицы хоста; класс
// у них -- temporary-unknown, но строка известна и решает поиск строки отказа.
export const REFUSAL_OTHER_PREFIXES = ["API Error", "Request timed out"]
// CONSTRAINT (#509-FIX9 R4, #509-FIX10 F3): статус обёртки `API Error: <NNN>` --
// 413 -- request, 400 -- request только с предметом размера запроса
// (предикат refusalRequestSize), 404 -- permanent-model, 401/403 --
// temporary-unknown (учётка, #514 Р9), прочие -- temporary-unknown. 402, мёртвый провайдер и model_not_found решает тело
// строки раньше обёртки.
export const REFUSAL_WRAP_STATUS_RX = /^API Error:\s*(\d{3})(?!\d)/
// CONSTRAINT (#509-FIX10 F3, #509-FIX11 B4, #509-FIX12 T1/T2, #509-FIX13,
// #509-FIX14, #509-FIX15, #509-FIX16): явные размерные формы делятся на
// СИЛЬНЫЕ и НЕОДНОЗНАЧНЫЕ и проверяются по СМЫСЛОВОЙ ЧАСТИ ПРИЧИНЫ текста
// после префикса обёртки, не поиском по всей строке (#509-FIX16: частота
// спрашивается у части кандидата, не у всего предложения). СИЛЬНЫЕ -- слова
// размера length|window|size, которые нельзя спутать с голым плановым/частотным «request limit»:
// «request entity too large»; «<request|prompt|input|payload|message|body|
// image|pdf> [is|was] too large»; «[maximum] <context|input|token(s)|payload|
// prompt|request> + length|window|size + [limit] exceeded» с пробелом ИЛИ
// «_» (включая request_size_limit_exceeded и maximum_request_size_exceeded);
// exceed-глагол с предметом и квалификатором length|window|size.
// НЕОДНОЗНАЧНЫЕ: «too many tokens»; «<tokens|context|input|payload|prompt>
// limit exceeded» с пробелом или «_»; «<context|input|payload|prompt|request>
// tokens exceeded» с пробелом или «_»; exceed-глагол с «<subject>
// limit|tokens» -- размер только без частотного/планового квалификатора в
// ТОЙ ЖЕ части причины (FREQ_RX), а глагольное
// «exceed… [the] [maximum] request limit» без слова размера -- план или
// частота, НЕ размер никогда: флаг i держит исходный регистр матча, поэтому
// пара групп сверяется с приведением к нижнему регистру.
const REFUSAL_SIZE_STRONG_RX = /\brequest entity too large\b|\b(?:request|prompt|input|payload|message|body|image|pdf)\s+(?:is\s+|was\s+)?too large\b|\b(?:maximum[ _]+)?(?:context|input|tokens?|payload|prompt|request)[ _]+(?:length|window|size)(?:[ _]+limit)?[ _]+exceeded\b|\bexceed(?:s|ed|ing)?\b\s+(?:the\s+)?(?:maximum\s+)?(?:context|tokens?|input|prompt|request)\b\s+(?:length|window|size)(?:[ _]+limit)?\b/gi
// CONSTRAINT (#509-FIX14, #509-FIX15): группы 1/2 неоднозначной глагольной
// формы несут пару предмет+квалификатор -- «request»+«limit» читается
// напрямую (регистр матча произволен) и запрещена; «request size limit
// exceeded» -- СИЛЬНАЯ форма и здесь не доезжает.
const REFUSAL_SIZE_AMBIGUOUS_RX = /\btoo many tokens\b|\b(?:tokens?|context|input|payload|prompt)[ _]+limit[ _]+exceeded\b|\b(?:context|input|payload|prompt|request)[ _]+tokens[ _]+exceeded\b|\bexceed(?:s|ed|ing)?\b\s+(?:the\s+)?(?:maximum\s+)?(context|tokens?|input|request|prompt)\b\s+(limit|tokens)\b/gi
// CONSTRAINT (#509-FIX14, #509-FIX15, #509-FIX16): частотный/плановый
// квалификатор запрещает только НЕОДНОЗНАЧНУЮ форму и только в её
// смысловой части причины; сильную форму не запрещает и из чужой части не
// доходит (#509-FIX15: единицы частоты -- second..year с множественным
// числом).
const REFUSAL_SIZE_FREQ_RX = /\bper\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b|\b(?:current|this)\s+(?:second|minute|hour|day|week|month|year)\b|\b(?:requests?|tokens?)\s+per\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b|\bfor\s+your\s+plan\b/i
// CONSTRAINT (#509-FIX16, #509-FIX17): границы причины. «but|however|and|:»
// разрывают причины ВСЕГДА; запятая -- только когда в НЕПОСРЕДСТВЕННО
// следующей сырой части до следующего разделителя есть новый самостоятельный
// размерный кандидат-форма: дальний скан за границей разделителя отрывал
// частотный квалификатор от первой причины. Без кандидата продолжение вида
// «, 60 requests per minute» квалифицирует прежнюю причину и остаётся с ней;
// на последующих запятых алгоритм повторяется.
const REFUSAL_SIZE_CAUSE_SPLIT_RX = /(,|:|\bbut\b|\bhowever\b|\band\b)/i
// CONSTRAINT (#509-FIX13, #509-FIX15, #509-FIX16, #509-FIX17, #509-FIX18,
// #509-FIX20): свободная форма «subject … too long» -- предмет размера
// внутри ОДНОЙ свободной части: текст после префикса обёртки делится по
// «. ! ? ; \r \n», предложение -- по запятой, «but», «however», «and», «:»
// и целому «so» (только свободная часть: явные неоднозначные причины «so»
// не делят); «so» режет ТОЛЬКО новую клаузу с целым размерным предметом
// (артикль/указатель перед ним допустим) -- степенной оборот «so verbose»
// клаузой не считается; целое слово предмета -- не далее 80 знаков перед
// «too long» в ТОЙ ЖЕ части. Временной veto позиционен для КОНКРЕТНОГО
// «too long» (#509-FIX17: маркер ПОСЛЕ него ранее названный размер не
// отвергает; до него в той же части -- отвергает, если сам НЕ отрица́н:
// «not a timeout», «no timeout», «without a timeout», «not because of a
// request timeout», «didn't/did not time out»; #509-FIX18: расширенное
// «not because of a <1-3 слова>» отрица́ет ТОЛЬКО сам маркер timeout/
// time out, чужой последующий положительный «timed out» -- никогда;
// #509-FIX20: маркер немится только узкими маркерными формами, не
// глагольным отрицанием длительности с предметом).
// Длительность субъекта -- «<request|query|message|input|body|payload|
// history> + has|have|had|is|was|were|will|did + [already] run» ДО
// кандидатного «too long» в той же части (включая прямой объект); «run»
// с дефисом или продолжением слова («run-length») глаголом не считается;
// длительность кормит ТОЛЬКО БЛИЖАЙШИЙ следующий «too long» части --
// законченная прежде длительность следующий кандидат не veto.
// После «too long» длительность -- «to arrive» либо «to run» БЕЗ
// названного объекта: «to run compaction» -- императив, не время запроса.
// Отрица́нный глагол длительности или связка be прямо перед фразой
// (семейства take и run с отрицаниями didn't/doesn't/don't/isn't/wasn't/
// weren't/hasn't/haven't/hadn't/not/never, включая «is never», и модальными
// will/would/should/must/can/could not,
// won't/can't/couldn't/cannot/wouldn't/shouldn't/mustn't;
// не более один целый предмет между (узкий порядок прилагательное→артикль
// допустим), пробел перед голым предметом обязателен) -- отрицание размера,
// не его подтверждение; самостоятельный положительный размер позже в части
// не гасится.
const REFUSAL_SIZE_TEMPORAL_RX = /\b(?:took|take|takes|taking|taken|running|ran|timed|timing|timeout|time[\s-]+out|processing|waiting|deadline|latency|elapsed|duration|arrive|arrives|arrived|arriving)\b/gi
const REFUSAL_SIZE_AUX_RUN_RX = /\b(?:request|query|message|input|body|payload|history)\b\s+(?:has|have|had|is|was|were|will|did)\s+(?:already\s+)?run(?![\w-])/i
// CONSTRAINT (#509-FIX17): дополнительное отрицание ТОЛЬКО временного
// маркера (не размерной фразы): «not because of a <существительное>
// timeout» и «didn't/did not time out».
const REFUSAL_SIZE_MARKER_NEG_EXTRA_RX = /\bnot\s+because\s+of\s+(?:a|an|the)\s+[a-z]+\s*$|\b(?:didn't|did\s+not)\s*$/i
// CONSTRAINT (#509-FIX18, #509-FIX19): «not because of a <1-3 слова>» --
// та же форма с составным существительным; отрица́ет ТОЛЬКО маркер
// timeout/time out, к чужим последующим «timed»/«took» не применяется.
// Слово в окне -- буквенное, цифровое («3») или дефисное («client-side»).
const REFUSAL_SIZE_MARKER_NEG_TIMEOUT_RX = /\bnot\s+because\s+of\s+(?:a|an|the)\s+(?:[a-z0-9-]+\s+){0,2}[a-z0-9-]+\s*$/i
const REFUSAL_SIZE_SENTENCE_RX = /[.!?\r\n;]/
const REFUSAL_SIZE_FREE_PART_RX = /(,|:|\bbut\b|\bhowever\b|\band\b|\bso\b)/i
// CONSTRAINT (#509-FIX18, #509-FIX19): «so» режет свободную часть только
// перед новой клаузой с целым размерным предметом (артикль/указатель перед
// ним допустим, узкое вводное now/then и прилагательное
// overall/entire/whole/full/total/current -- тоже часть клаузы);
// группа в FREE_PART_RX несёт разделитель для этого решения.
const REFUSAL_SIZE_SO_CLAUSE_RX = /^\s*(?:(?:now|then)\s+)?(?:(?:a|an|the|this|that|these|those)\s+)?(?:(?:overall|entire|whole|full|total|current)\s+)?(?:(?:a|an|the|this|that|these|those)\s+)?(?:prompt|request|input|context|message|payload|body|query|history|tokens?|length|size)\b/i
const REFUSAL_SIZE_TOO_LONG_AFTER_RX = /^\s*to\s+arrive\b|^\s*to\s+run\b(?!\s+[A-Za-z])/i
const REFUSAL_SIZE_FREE_SUBJECT_RX = /\b(?:prompt|request|input|context|message|payload|body|query|history|tokens?|length|size)\b/gi
const REFUSAL_SIZE_TOO_LONG_RX = /\btoo long\b/gi
// CONSTRAINT (#509-FIX15, #509-FIX16, #509-FIX18, #509-FIX19, #509-FIX20,
// #509-FIX21, #509-FIX22):
// отрицание ЛОКАЛЬНО к размерной фразе и применяется ТОЛЬКО к ней
// (refusalSizeNegated); отрицание ВРЕМЕННОГО МАРКЕРА решает отдельная
// узкая форма REFUSAL_SIZE_MARKER_NEG_BEFORE_RX. Глобальное «любое
// not/no/never/without до совпадения отрицает его» отменено: (а) прямо
// перед фразой «not|no|never|without», «is|was|were not» и сокращения
// isn't/wasn't/weren't, затем необязательное «because of» и необязательный
// артикль (в обоих порядках); (б) отрицанная связка be перед фразой:
// «not be», «will/would/should/must/can/could not be», «won't/can't/
// couldn't/cannot/wouldn't/shouldn't/mustn't be»; двойное отрицание be --
// сжатое («can't not be») И развёрнутое («would not not be»: модальное
// not непосредственно перед заключательным not) -- утвердительный размер, НЕ
// отрицание; (в) отрицание didn't/doesn't/don't/isn't/wasn't/
// weren't/hasn't/haven't/hadn't/not и never (включая «is never»), а также
// «will/would/should/must/can/could not»,
// «won't/can't/couldn't/cannot/wouldn't/shouldn't/mustn't» +
// глагол длительности take/run-семейства (run с дефисом или продолжением
// слова глаголом не считается; одиночное «not» не накрывает составные
// отрицания «would not»/«was not»/«has not» -- у каждой составной группы
// своя альтернатива, ветка погашения остаётся однофакторной) с НЕ БОЛЕЕ
// одним целым предметом --
// пробел перед предметом обязателен и не поглощается факультативным
// определителем (артикль/указатель/притяжательное) или узким прилагательным
// (допустим и узкий порядок прилагательное→артикль→предмет, как у
// REFUSAL_SIZE_SO_CLAUSE_RX);
// (г) сразу после фразы «is|was|were not»/сокращение + «the|a|an» +
// «cause|reason|error|issue».
// Между отрицающим словом и фразой допустимы только артикль, «because of»,
// глагол длительности/связка и один предмет, поэтому отрицание не
// переносится через «but|however|and|so», запятую, разделитель предложения
// или другой «too long», а «not only» -- усиление, не отрицание.
// Одно правило для сильной, неоднозначной и свободной форм.
const REFUSAL_SIZE_NEGATE_BEFORE_RX = /(?:\b(?:not|no|never|without)|\b(?:is|was|were)\s+not|\b(?:isn't|wasn't|weren't))(?:\s+(?:a|an|the))?(?:\s+because\s+of)?(?:\s+(?:a|an|the))?\s*$|\b(?:(?<!\b(?:can't|couldn't|won't|wouldn't|shouldn't|mustn't|cannot|(?:will|would|should|must|can|could)\s+not)\s+)not|(?:will|would|should|must|can|could)\s+not|won't|can't|couldn't|cannot|wouldn't|shouldn't|mustn't)\s+be\s*$|\b(?:didn't|did\s+not|doesn't|does\s+not|don't|do\s+not|isn't|is\s+not|wasn't|was\s+not|weren't|were\s+not|hasn't|has\s+not|haven't|have\s+not|hadn't|had\s+not|never|(?:is|was|were)\s+never|(?<!\b(?:will|would|should|must|can|could|is|was|were|has|have|had|do|does|did)\s)not|(?:will|would|should|must|can|could)\s+not|won't|can't|couldn't|cannot|wouldn't|shouldn't|mustn't)\s+(?:takes?|took|taking|taken|running|ran|run(?![\w-]))(?:\s+(?:(?:a|an|the|this|that|these|those|my|your|our|their|its)\s+)?(?:(?:overall|entire|whole|full|total|current)\s+)?(?:(?:a|an|the|this|that|these|those)\s+)?(?:prompt|request|input|context|message|payload|body|query|history|tokens?|length|size))?\s*$/i
// CONSTRAINT (#509-FIX20, #509-FIX21): отрицание ВРЕМЕННОГО МАРКЕРА -- узкая
// форма без глагольных take/run-альтернатив: отрицённая длительность
// («didn't run payload», «didn't take its request») чужой последующий маркер
// «timed out»/«timeout»/«deadline» НЕ немит; прямое «didn't time out» немит
// только REFUSAL_SIZE_MARKER_NEG_EXTRA_RX.
const REFUSAL_SIZE_MARKER_NEG_BEFORE_RX = /(?:\b(?:not|no|never|without)|\b(?:is|was|were)\s+not|\b(?:isn't|wasn't|weren't))(?:\s+(?:a|an|the))?(?:\s+because\s+of)?(?:\s+(?:a|an|the))?\s*$/i
const REFUSAL_SIZE_NEGATE_AFTER_RX = /^\s*(?:(?:is|was|were)\s+not|isn't|wasn't|weren't)\s+(?:the|a|an)\s+(?:cause|reason|error|issue)\b/i

function refusalSizeNegated(before: string, after: string): boolean {
  return REFUSAL_SIZE_NEGATE_BEFORE_RX.test(before) || REFUSAL_SIZE_NEGATE_AFTER_RX.test(after)
}

// CONSTRAINT (#509-FIX16, #509-FIX17, #509-FIX18, #509-FIX20, #509-FIX21):
// временной veto -- только НЕотрица́емый маркер ДО кандидатного «too long»
// (переданный префикс); ближайшее локальное отрицание прямо перед маркером
// делает его немым, включая формы REFUSAL_SIZE_MARKER_NEG_EXTRA_RX и узкую
// маркерную форму REFUSAL_SIZE_MARKER_NEG_BEFORE_RX (без глагольных
// take/run-альтернатив -- отрицённая длительность чужой маркер не немит);
// расширенное составное «not because of a <1-3 слова>» немит только маркер
// timeout/time out; позиция проверяется по каждому матчу, не по всей строке.
function refusalSizeTemporalDenies(before: string): boolean {
  REFUSAL_SIZE_TEMPORAL_RX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = REFUSAL_SIZE_TEMPORAL_RX.exec(before)) !== null) {
    const head = before.slice(0, m.index)
    const marker = m[0].toLowerCase()
    const timeoutMarker = marker === "timeout" || /^time[\s-]+out$/.test(marker)
    if (
      !REFUSAL_SIZE_MARKER_NEG_BEFORE_RX.test(head) &&
      !REFUSAL_SIZE_MARKER_NEG_EXTRA_RX.test(head) &&
      !(timeoutMarker && REFUSAL_SIZE_MARKER_NEG_TIMEOUT_RX.test(head))
    ) return true
  }
  return false
}

// CONSTRAINT (#509-FIX16, #509-FIX17, #509-FIX18, #509-FIX19, #509-FIX20):
// новый самостоятельный размерный кандидат для решения о разрыве запятой --
// ФОРМА (сильная, неоднозначная или свободная С целым предметом перед
// «too long» в пределах 80 знаков в ЭТОЙ части), не её действительность,
// НО отрицание сверяется у САМОГО совпадения (refusalSizeNegated его
// before/after) -- для сильной/неоднозначной формы отрицённая причина
// кандидатом не считается и остаётся при частотной клаузе. Голое «too
// long»/«took too long» кандидатом НЕ является; свободный кандидат
// временного вида (неотрица́емый temporal-маркер или AUX_RUN до него, хвост
// «to arrive»/безобъектный «to run») ИЛИ отрицённая фраза кандидатом не
// считается -- veto решается для конкретного совпадения, не для всей части;
// частоту «too many tokens» отрицённая средняя часть не отрывает.
// Запрещённая пара request+limit кандидатом не считается.
function refusalSizeCandidateIn(t: string): boolean {
  let m: RegExpExecArray | null
  REFUSAL_SIZE_STRONG_RX.lastIndex = 0
  while ((m = REFUSAL_SIZE_STRONG_RX.exec(t)) !== null) {
    if (!refusalSizeNegated(t.slice(0, m.index), t.slice(m.index + m[0].length))) return true
  }
  REFUSAL_SIZE_AMBIGUOUS_RX.lastIndex = 0
  while ((m = REFUSAL_SIZE_AMBIGUOUS_RX.exec(t)) !== null) {
    if (m[1] !== undefined && m[1].toLowerCase() === "request" && m[2].toLowerCase() === "limit") continue
    if (!refusalSizeNegated(t.slice(0, m.index), t.slice(m.index + m[0].length))) return true
  }
  REFUSAL_SIZE_TOO_LONG_RX.lastIndex = 0
  let auxFrom = 0
  while ((m = REFUSAL_SIZE_TOO_LONG_RX.exec(t)) !== null) {
    const before = t.slice(0, m.index)
    const after = t.slice(m.index + m[0].length)
    const veto =
      refusalSizeTemporalDenies(before) ||
      REFUSAL_SIZE_AUX_RUN_RX.test(t.slice(auxFrom, m.index)) ||
      REFUSAL_SIZE_TOO_LONG_AFTER_RX.test(after) ||
      refusalSizeNegated(before, after)
    auxFrom = m.index + m[0].length
    if (veto) continue
    REFUSAL_SIZE_FREE_SUBJECT_RX.lastIndex = 0
    let sm: RegExpExecArray | null
    while ((sm = REFUSAL_SIZE_FREE_SUBJECT_RX.exec(t)) !== null) {
      if (sm.index + sm[0].length <= m.index && m.index - (sm.index + sm[0].length) <= 80) return true
    }
  }
  return false
}

// CONSTRAINT (#509-FIX16, #509-FIX17): смысловые части причины одного
// предложения; кандидата запятой спрашивают у НЕПОСРЕДСТВЕННО следующей
// сырой части, не у всего остатка.
function refusalSizeCauseParts(s: string): string[] {
  const raw = s.split(REFUSAL_SIZE_CAUSE_SPLIT_RX)
  const parts: string[] = [raw[0]]
  for (let i = 1; i + 1 < raw.length; i += 2) {
    const sep = raw[i]
    if (sep === "," && !refusalSizeCandidateIn(raw[i + 1])) {
      parts[parts.length - 1] += sep + raw[i + 1]
    } else {
      parts.push(raw[i + 1])
    }
  }
  return parts
}

// CONSTRAINT (#509-FIX18): части свободного предложения; разделитель «so»
// без новой клаузы с целым размерным предметом остаётся внутри прежней
// части.
function refusalSizeFreeParts(s: string): string[] {
  const raw = s.split(REFUSAL_SIZE_FREE_PART_RX)
  const parts: string[] = [raw[0]]
  for (let i = 1; i + 1 < raw.length; i += 2) {
    const sep = raw[i]
    const next = raw[i + 1]
    if (sep.toLowerCase() === "so" && !REFUSAL_SIZE_SO_CLAUSE_RX.test(next)) {
      parts[parts.length - 1] += sep + next
    } else {
      parts.push(next)
    }
  }
  return parts
}

function refusalRequestSizeFree(text: string): boolean {
  const w = REFUSAL_WRAP_STATUS_RX.exec(text)
  const body = w ? text.slice(w[0].length) : text
  const sentences = body.split(REFUSAL_SIZE_SENTENCE_RX)
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    if (!s) continue
    const parts = refusalSizeFreeParts(s)
    for (let j = 0; j < parts.length; j++) {
      const p = parts[j]
      if (!p) continue
      REFUSAL_SIZE_TOO_LONG_RX.lastIndex = 0
      let m: RegExpExecArray | null
      let auxFrom = 0
      while ((m = REFUSAL_SIZE_TOO_LONG_RX.exec(p)) !== null) {
        const before = p.slice(0, m.index)
        const after = p.slice(m.index + m[0].length)
        const veto =
          refusalSizeTemporalDenies(before) ||
          REFUSAL_SIZE_AUX_RUN_RX.test(p.slice(auxFrom, m.index)) ||
          REFUSAL_SIZE_TOO_LONG_AFTER_RX.test(after)
        auxFrom = m.index + m[0].length
        if (veto) continue
        REFUSAL_SIZE_FREE_SUBJECT_RX.lastIndex = 0
        let sm: RegExpExecArray | null
        while ((sm = REFUSAL_SIZE_FREE_SUBJECT_RX.exec(p)) !== null) {
          if (sm.index + sm[0].length <= m.index && m.index - (sm.index + sm[0].length) <= 80) {
            if (!refusalSizeNegated(before, after)) return true
          }
        }
      }
    }
  }
  return false
}

// CONSTRAINT (#509-FIX13, #509-FIX14, #509-FIX15, #509-FIX16): единый
// предикат предмета размера для кода 400; статус 413 решает request
// безусловно, прочие статусы предмет не спрашивают. Явные формы идут
// СМЫСЛОВЫМИ ЧАСТЯМИ ПРИЧИНЫ текста после префикса обёртки: при нескольких
// причинах достаточно одной настоящей размерной, неотрицанной и, для
// неоднозначной формы, нечастотной в её части.
function refusalRequestSize(text: string): boolean {
  const w = REFUSAL_WRAP_STATUS_RX.exec(text)
  const body = w ? text.slice(w[0].length) : text
  const sentences = body.split(REFUSAL_SIZE_SENTENCE_RX)
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    if (!s) continue
    const parts = refusalSizeCauseParts(s)
    for (let j = 0; j < parts.length; j++) {
      const p = parts[j]
      if (!p) continue
      const freq = REFUSAL_SIZE_FREQ_RX.test(p)
      let m: RegExpExecArray | null
      REFUSAL_SIZE_STRONG_RX.lastIndex = 0
      while ((m = REFUSAL_SIZE_STRONG_RX.exec(p)) !== null) {
        if (!refusalSizeNegated(p.slice(0, m.index), p.slice(m.index + m[0].length))) return true
      }
      REFUSAL_SIZE_AMBIGUOUS_RX.lastIndex = 0
      while ((m = REFUSAL_SIZE_AMBIGUOUS_RX.exec(p)) !== null) {
        if (m[1] !== undefined && m[1].toLowerCase() === "request" && m[2].toLowerCase() === "limit") continue
        if (freq || refusalSizeNegated(p.slice(0, m.index), p.slice(m.index + m[0].length))) continue
        return true
      }
    }
  }
  return refusalRequestSizeFree(text)
}

function startsWithAny(text: string, prefixes: string[]): boolean {
  for (let i = 0; i < prefixes.length; i++) if (text.indexOf(prefixes[i]) === 0) return true
  return false
}

function isLimitLine(text: string): boolean {
  return startsWithAny(text, REFUSAL_LIMIT_PREFIXES) || REFUSAL_CREDITS_RX.test(text) || REFUSAL_CREDITS_NOW_RX.test(text)
}

function isPermanentLine(text: string): boolean {
  return startsWithAny(text, REFUSAL_PERMANENT_PREFIXES) || REFUSAL_MODEL_UNAVAILABLE_RX.test(text)
}

// CONSTRAINT (#509-FIX7 Р14/Р14a/Р14b): классы, решаемые телом строки раньше
// префиксных таблиц; "" -- тело класса не решает. Правило окна z.ai -- только
// при модели ступени не-Anthropic.
function refusalBodyClassOf(text: string, model: string): string {
  const code = refusalErrorCodeOf(text)
  if (code === "model_not_found") return "permanent-model"
  if (model && !isAnthropicModelId(model) && (code === "1308" || QUOTA_WINDOW_RX.test(text))) return "quota"
  if (PROVIDER_GONE_RX.test(text)) return "permanent-model"
  if (QUOTA_RX.test(text)) return "quota"
  return ""
}

// CONSTRAINT (#509-FIX7b AR8): известны и классы тела (refusalBodyClassOf) --
// бросок next одним телом такого отказа идёт дорогой лестницы, не hook-error.
export function refusalKnown(line: any, model: string = ""): boolean {
  const t = String(line == null ? "" : line).trim()
  if (!t) return false
  return startsWithAny(t, REFUSAL_REQUEST_PREFIXES) || REFUSAL_TEMPORARY_EXACT.indexOf(t) >= 0 ||
    startsWithAny(t, REFUSAL_AUTH_PREFIXES) || isPermanentLine(t) ||
    isLimitLine(t) || startsWithAny(t, REFUSAL_OTHER_PREFIXES) || refusalBodyClassOf(t, model) !== ""
}

function wholeIsJson(text: string): boolean {
  const t = text.trim()
  const open = t.charAt(0)
  const close = open === "{" ? "}" : open === "[" ? "]" : ""
  if (!close || t.charAt(t.length - 1) !== close) return false
  try { JSON.parse(t) } catch (x) { return false }
  return true
}

// CONSTRAINT (#509-FIX4 F-5): свежие assistant-тексты -- от старшего к
// новейшему. Решает первая строка с известным началом таблицы: сообщения от
// новейшего к старшему, внутри сообщения -- сверху вниз. Такой нет -- первая
// непустая строка новейшего.
// CONSTRAINT (#509-FIX8c Р1, #509-FIX8f Р2/Р4): сообщение, целиком являющееся JSON-документом (после trim объект «{…}» или массив «[…]», JSON.parse проходит), решает своим телом, и его строки не проверяются: класс тела есть -- строка отказа весь текст со свёрнутыми пробелами, нет -- сообщение известной строки не даёт. Иное сообщение решают его строки; строка с JSON внутри (форма хоста «API Error: 404 {…}») решает своим телом.
export function refusalLineOfMessages(texts: any[], model: string = ""): { line: string; known: boolean } {
  const rows = Array.isArray(texts) ? texts : []
  for (let i = rows.length - 1; i >= 0; i--) {
    const whole = String(rows[i] == null ? "" : rows[i])
    const doc = wholeIsJson(whole)
    if (doc && refusalBodyClassOf(whole, model) !== "") return { line: whole.replace(/\s+/g, " ").trim(), known: true }
    if (doc) continue
    const lines = whole.split("\n")
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j].trim()
      if (l && refusalKnown(l, model)) return { line: l, known: true }
    }
  }
  return { line: rows.length ? refusalLineOf(rows[rows.length - 1]) : "", known: false }
}

// CONSTRAINT (#509-FIX4 F1): session.messages отдаёт новейшие 4096 записей
// (claude-code.d.ts:2404-2409). Чтение, упёршееся в окно, длиной не
// сравнивается: окно сдвигается, и длина после попытки не растёт.
export const SESSION_MESSAGES_WINDOW = 4096

function historyIds(xs: any): string[] {
  const out: string[] = []
  if (Array.isArray(xs)) for (let i = 0; i < xs.length; i++) out.push(String(xs[i] && xs[i].tool_use_id))
  return out
}

// CONSTRAINT (#509-FIX5 Р2): ключ записи -- role, text, tool_use_id каждой
// записи toolUses и каждой записи toolResults по порядку. result/text/isError
// tool-записей в ключ не входят: они появляются после ответа, и одна запись
// разошлась бы сама с собой между двумя чтениями.
function historyKey(row: any): string {
  return JSON.stringify([String(row && row.role), String(row && row.text), historyIds(row && row.toolUses), historyIds(row && row.toolResults)])
}

// Все длины L >= 1, при которых суффикс before длины L равен префиксу after
// длины L, от наибольшей: наибольшая и цепочка границ префикса after этой длины.
function historyOverlaps(before: any[], after: any[]): number[] {
  const a = after.map(historyKey)
  const b = before.map(historyKey)
  const m = a.length
  if (!m || !b.length) return []
  const pi: number[] = [0]
  for (let i = 1, k = 0; i < m; i++) {
    while (k > 0 && a[i] !== a[k]) k = pi[k - 1]
    if (a[i] === a[k]) k++
    pi.push(k)
  }
  let q = 0
  for (let i = 0; i < b.length; i++) {
    while (q > 0 && (q === m || a[q] !== b[i])) q = pi[q - 1]
    if (q < m && a[q] === b[i]) q++
  }
  const out: number[] = []
  for (let l = q; l > 0; l = pi[l - 1]) out.push(l)
  return out
}

// CONSTRAINT (#509-FIX4 F1, #509-FIX5 Р2): у предела окна свежие записи -- после
// единственного перекрытия: суффикс before равен началу after (по historyKey);
// перекрытия нет -- чтение не выровнено (unread), старые строки свежими не
// читаются; перекрытий больше одного -- window-ambiguous (unread).
export function freshHistory(before: any[], after: any[]): { rows: any[] | null; why: string } {
  const capped = before.length >= SESSION_MESSAGES_WINDOW || after.length >= SESSION_MESSAGES_WINDOW
  if (!capped) {
    if (after.length < before.length) return { rows: null, why: "history-shrank" }
    return { rows: after.slice(before.length), why: "" }
  }
  const lens = historyOverlaps(before, after)
  if (lens.length < 1) return { rows: null, why: "window-unaligned" }
  // CONSTRAINT (#509-FIX5 Р2): неоднозначное выравнивание не доказывает
  // отсутствие свежего отказа -- unread, не выбор одного из перекрытий.
  if (lens.length > 1) return { rows: null, why: "window-ambiguous" }
  return { rows: after.slice(lens[0]), why: "" }
}

function zoneParts(ms: number, tz: string): number[] | null {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  const parts = f.formatToParts(new Date(ms))
  const get = (t: string) => {
    for (let i = 0; i < parts.length; i++) if (parts[i].type === t) return Number(parts[i].value)
    return NaN
  }
  const out = [get("year"), get("month"), get("day"), get("hour") % 24, get("minute"), get("second")]
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) return null
  return out
}

function zoneOffsetMs(ms: number, tz: string): number {
  const p = zoneParts(ms, tz)
  if (!p) return NaN
  return Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) - (ms - (((ms % 1000) + 1000) % 1000))
}

// CONSTRAINT (#509-FIX4 F5): ВСЕ UTC-моменты, у которых стенное время в зоне
// равно дате и h:mm: повторный осенний час даёт два, весенний пропуск -- ни
// одного, и тогда момент сдвигается вперёд на величину пропуска (стенное
// минус смещение до перехода). Смещения берутся за сутки до и после стенного:
// два перехода одной зоны ближе суток друг к другу не стоят.
function wallInstants(y: number, mo: number, d: number, h: number, mi: number, tz: string): number[] {
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0)
  const cd = new Date(wall)
  if (!Number.isFinite(wall) || cd.getUTCFullYear() !== y || cd.getUTCMonth() !== mo - 1 || cd.getUTCDate() !== d) return []
  const before = zoneOffsetMs(wall - 86400000, tz)
  const after = zoneOffsetMs(wall + 86400000, tz)
  const offs = [before, zoneOffsetMs(wall, tz), after]
  const out: number[] = []
  for (let i = 0; i < offs.length; i++) {
    if (!Number.isFinite(offs[i])) continue
    const t = wall - offs[i]
    if (out.indexOf(t) >= 0) continue
    const q = zoneParts(t, tz)
    if (q && q[0] === y && q[1] === mo && q[2] === d && q[3] === h && q[4] === mi) out.push(t)
  }
  if (!out.length && Number.isFinite(before) && Number.isFinite(after) && after > before) out.push(wall - before)
  return out
}

const RESET_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const RX_RESETS = /·\s*resets\s+(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?,\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(([A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*)\)/i

// CONSTRAINT (#509-FIX3 M2): хвост хоста « · resets <t> (<IANA>)»: t --
// «h[:mm]am|pm» или «H:MM», с датой -- «[День, ]Mon D[, YYYY], t».
// CONSTRAINT (#509-FIX4 F5): кандидаты -- все наступления: время без даты --
// на сегодня и завтра по дате зоны в atMs; дата без года -- в текущем и
// следующем году зоны; с годом -- только в нём. Берётся наименьший кандидат
// позади не больше чем на минуту; он позади вовсе -- срок неизвестен
// (AR-FIX3-2: хост печатает минуты усечёнными, такой сброс ещё впереди, а не
// через сутки). Кандидата нет -- срок неизвестен.
export const RESET_BEHIND_MS = 60000
export function resetsAtOf(line: string, atMs: number): { at: number; err: any } {
  const m = RX_RESETS.exec(String(line || ""))
  if (!m) return { at: 0, err: null }
  let h = Number(m[4])
  const mm = m[5] ? Number(m[5]) : 0
  const ap = m[6] ? m[6].toLowerCase() : ""
  const tz = m[7]
  if (ap) {
    if (h < 1 || h > 12) return { at: 0, err: null }
    h = h % 12 + (ap === "pm" ? 12 : 0)
  }
  if (h > 23 || mm > 59) return { at: 0, err: null }
  try {
    if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") return { at: 0, err: null }
    const p = zoneParts(atMs, tz)
    if (!p) return { at: 0, err: null }
    const cands: number[] = []
    const take = (xs: number[]): void => { for (let i = 0; i < xs.length; i++) cands.push(xs[i]) }
    if (m[1]) {
      const mo = RESET_MONTHS.indexOf(m[1].toLowerCase()) + 1
      const d = Number(m[2])
      if (mo < 1 || d < 1 || d > 31) return { at: 0, err: null }
      if (m[3]) take(wallInstants(Number(m[3]), mo, d, h, mm, tz))
      else {
        take(wallInstants(p[0], mo, d, h, mm, tz))
        take(wallInstants(p[0] + 1, mo, d, h, mm, tz))
      }
    } else {
      take(wallInstants(p[0], p[1], p[2], h, mm, tz))
      const nd = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1))
      take(wallInstants(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate(), h, mm, tz))
    }
    let best = NaN
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i]
      // CONSTRAINT (AR-FIX3-2): граница строгая -- ровно 60 с позади не «меньше минуты», кандидат отброшен.
      if (!(Number.isFinite(c) && c > atMs - RESET_BEHIND_MS)) continue
      if (!(c >= best)) best = c
    }
    if (!Number.isFinite(best) || best < atMs) return { at: 0, err: null }
    return { at: best, err: null }
  } catch (x) {
    return { at: 0, err: x }
  }
}

// CONSTRAINT (#509-FIX3 M2): порядок -- request, permanent-model, лимит qDr
// (temporary-known при разобранном сроке), иначе temporary-unknown. Дефект
// запроса одинаков для любой модели и решает раньше модели.
// CONSTRAINT (#509-FIX5 Р4, #509-FIX7 Р14/А-Р6/ADD1): порядок -- пусто,
// error.code model_not_found (permanent-model), окно квоты z.ai на ступени
// не-Anthropic модели (фильтр модели первым; error.code 1308 или
// QUOTA_WINDOW_RX -- quota), мёртвый провайдер по тексту (permanent-model),
// квота по тексту (quota), обёртка `API Error`/`Request timed out`
// (по статусу обёртки -- request / permanent-model, иначе temporary-unknown;
// #509-FIX9 R4), request, точная временная строка (temporary-unknown),
// permanent, лимит. Без модели ступени правило окна не действует.
export function classifyRefusal(line: string, atMs: number, model: string = ""): { class: string; readyAt: number; err: any } {
  const text = String(line || "").trim()
  if (!text) return { class: "temporary-unknown", readyAt: 0, err: null }
  const body = refusalBodyClassOf(text, model)
  if (body === "quota") {
    // CONSTRAINT (#509-FIX9 R3): срок читается из ПОЛНОЙ строки: улика
    // попытки урезана до REFUSAL_TEXT_MAX, форма срока бывает дальше.
    const d = quotaRecoveryMsOf(text)
    return { class: body, readyAt: d >= 0 ? atMs + d : 0, err: null }
  }
  if (body) return { class: body, readyAt: 0, err: null }
  if (startsWithAny(text, REFUSAL_OTHER_PREFIXES)) {
    const st = REFUSAL_WRAP_STATUS_RX.exec(text)
    const code = st ? Number(st[1]) : 0
    if (code === 413 || (code === 400 && refusalRequestSize(text))) return { class: "request", readyAt: 0, err: null }
    if (code === 404) return { class: "permanent-model", readyAt: 0, err: null }
    return { class: "temporary-unknown", readyAt: 0, err: null }
  }
  if (startsWithAny(text, REFUSAL_REQUEST_PREFIXES)) return { class: "request", readyAt: 0, err: null }
  if (REFUSAL_TEMPORARY_EXACT.indexOf(text) >= 0) return { class: "temporary-unknown", readyAt: 0, err: null }
  if (startsWithAny(text, REFUSAL_AUTH_PREFIXES)) {
    if (text.indexOf(REFUSAL_AUTH_MODEL_ACCESS) >= 0 || REFUSAL_AUTH_MODEL_DENIED_RX.test(text)) return { class: "permanent-model", readyAt: 0, err: null }
    return { class: "temporary-unknown", readyAt: 0, err: null }
  }
  if (isPermanentLine(text)) return { class: "permanent-model", readyAt: 0, err: null }
  if (isLimitLine(text)) {
    const r = resetsAtOf(text, atMs)
    if (r.at > 0) return { class: "temporary-known", readyAt: r.at, err: null }
    return { class: "temporary-unknown", readyAt: 0, err: r.err }
  }
  return { class: "temporary-unknown", readyAt: 0, err: null }
}

// CONSTRAINT (#509-FIX4 F4, #509-FIX5 Р3): сторож фонового агента задаёт
// CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS -- хост 2.1.282 берёт её первой и
// допускает от 1 мс (AN-509-HOST-REPORT Q1: dl()); без неё сторож не меньше
// 600 с. S -- целое конечное > 0, иначе сердцебиение по умолчанию. T =
// pauseTimeout -- предел обеих дверей сна (кусок ожидания, пауза
// перечитывания): min(15000, 2 * chunk + 1000).
// CONSTRAINT (#509-FIX6 А1, #509-FIX7 А-Р1): следующий next при ожидании
// начинается не позже D = callEndAt + S_eff - G плюс цена синхронного хвоста
// и чтений часов. Ни одна дверь между проверкой срока и next за D не выходит:
// сон ожидания и пауза перечитывания -- min(C, D - now - G/2) с пределом
// двери min(T, D - now), при D - now <= G/2 сна нет; чтение истории (снимок
// «до», перечитывание), свёртка и запись попытки (failoverFoldFlush /
// failoverFoldObserve / appendJournal), записи журнала шага (waitRec,
// skipped-dead, skipped-known, refusal-unread, rung-effort-refused) и тосты
// (ожидание, нечитаемый отказ) ждутся гонкой raceUntil с остатком до D;
// проигрыш -- дверь доживает в фоне, снимок истории тогда нечитаем и назван
// строкой history-past-deadline. Записи выхода из шага (wait-aborted,
// wait-unavailable, wait-no-target, wait-budget-exhausted) next не
// предшествуют и ждутся целиком. Перебег виден записью stall-margin-exceeded,
// меряемой непосредственно перед next; при S < 2000 гарантии нет -- запись
// stall-below-floor. Выдать безвредный кусок вместо вызова нельзя: у потока
// шесть видов кусков, и каждый уходит в сессию; engine -- только со своим ref
// и один раз.
export const HEARTBEAT_DEFAULT_MS = 240000
export const STALL_FLOOR_MS = 2000
export const PAUSE_TIMEOUT_MAX_MS = 15000
// CONSTRAINT (#509-FIX6 А1): сторож хоста без переменной -- 600 с
// (AN-509-HOST-REPORT Q1).
export const STALL_HOST_DEFAULT_MS = 600000
export function waitPaceOf(raw: any): { stall: number; stallEff: number; margin: number; heartbeat: number; chunk: number; belowFloor: boolean; pauseTimeout: number } {
  let s = NaN
  try { s = raw === undefined || raw === null ? NaN : Number(raw) } catch (x) { s = NaN }
  const ok = Number.isInteger(s) && s > 0
  let heartbeat = HEARTBEAT_DEFAULT_MS
  if (ok) heartbeat = s > 30000 ? Math.min(HEARTBEAT_DEFAULT_MS, s - 15000) : Math.max(1000, Math.floor(s / 2))
  const chunk = Math.min(4000, Math.floor(heartbeat / 2))
  const pauseTimeout = Math.min(PAUSE_TIMEOUT_MAX_MS, 2 * chunk + 1000)
  const stallEff = ok ? s : STALL_HOST_DEFAULT_MS
  const margin = Math.min(30000, Math.max(500, Math.floor(stallEff / 4)))
  return { stall: ok ? s : 0, stallEff, margin, heartbeat, chunk, belowFloor: ok && s < STALL_FLOOR_MS, pauseTimeout }
}

function allowedTableOf(parsed: any): { usable: true, allowedByClass: { [classId: string]: string[] }, effortByClass: { [classId: string]: string } } | { usable: false, reason: "unusable" | "noclasses" } {
  const out: { [classId: string]: string[] } = {}
  const efforts: { [classId: string]: string } = {}
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
    // CONSTRAINT: пин эффорта клетки -- поле effort той же записи. Годность
    // судит ПОТРЕБИТЕЛЬ (переход отказывает громко, называя значение), а не
    // загрузчик: негодный пин -- улика, молча выбросить её нельзя.
    if (row.effort != null && row.effort !== "") efforts[id] = String(row.effort).slice(0, 64)
  }
  return { usable: true, allowedByClass: out, effortByClass: efforts }
}

function routingCandidates(env: any): { envPath: string, market: string } {
  const envPath = String((env && env.ROUTING_TABLE) || "").trim()
  const root = String((env && env.CONFIG_DIR) || "").trim() || (String((env && env.HOME) || "") + "/.claude")
  return { envPath, market: root + "/plugins/marketplaces/catalyst/hooks/routing-table.toml" }
}

// CONSTRAINT: порядок и семантика слоёв -- ДОСЛОВНО dispatch-gate.py
// (override_paths + load_table): машинный, затем проектный; запись клетки
// ЗАМЕНЯЕТ базовую ЦЕЛИКОМ; дубликат машинного слоя по пути проектным не
// становится. Второй дом этой логики расходился бы с гвардом молча --
// паритет и есть чинимый дефект (#274). env-ручки гварда
// (CATALYST_ROUTING_OVERRIDE / CATALYST_ROUTING_PROJECT_OVERRIDE) мод не
// читает: набор чтений env -- снимок поверхности мода
// (tests/fixtures/mod-surface.txt), новое имя роняет стенд; слои живут по
// домам по умолчанию.
async function pathExists($: any, path: string): Promise<boolean> {
  const r = await readText($, path)
  return r.text !== null || !!r.unreadable
}

async function findProjectOverride($: any, cwd: string, machineAbs: string): Promise<string> {
  // CONSTRAINT: тем же способом, каким находится проектный probes.toml
  // (findProjectHome): вверх от cwd, первый существующий слой выигрывает.
  if (!cwd) return ""
  let p = String(cwd)
  for (let i = 0; i < 24; i++) {
    if (!p) break
    const cand = p + "/.claude/catalyst/routing-override.toml"
    if (normTmp(cand) !== normTmp(machineAbs) && await pathExists($, cand)) return cand
    const up = parentDir(p)
    if (!up || up === p) break
    p = up
  }
  return ""
}

function mergeTableLayer(base: any, over: any): any {
  const out: any = base
  const ks = Object.keys(over || {})
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]
    if (k === "schema_version") continue
    const v = over[k]
    if (v && typeof v === "object" && !Array.isArray(v)
        && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = shallowMerge(out[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}

export async function loadAllowedByClass($: any, env: any, cwdArg?: string): Promise<{ allowedByClass: { [classId: string]: string[] }, effortByClass: { [classId: string]: string }, allowedSrc: string, refused?: string }> {
  // CONSTRAINT: адрес таблицы -- CATALYST_ROUTING_TABLE (тот же handle, что у
  // гварда) либо версионно-свободный marketplace. Относительный путь от дома
  // мода запрещён: версии плагинов расходятся.
  // CONSTRAINT: отсутствие таблицы именуется (absent:<path>), не молчит и не бросает.
  // CONSTRAINT: окно мемо таблицы -- ТО ЖЕ, что у мира (worldFor / WORLD_MEMO_MS).
  // Чтение на каждый диспатч (tool.call без agentId минует кэш мира) запрещено.
  // CONSTRAINT: битый слой (нечитаем или с неразобранными строками) -- ГРОМКИЙ
  // отказ (refused, веер пуст), не тихий откат к базе: тихий откат к базе и
  // есть дефект #274.
  const now = await nowMs($)
  const cand = routingCandidates(env)
  const cwd = cwdArg !== undefined ? cwdArg : String((env && env.PWD) || "")
  const home = String((env && env.HOME) || "").trim()
  const machine = home ? home + "/.claude/catalyst/routing-override.toml" : ""
  const project = await findProjectOverride($, cwd, machine)
  const layers: string[] = []
  if (machine) layers.push(machine)
  if (project) layers.push(project)
  const routingUnread = !!(env && Array.isArray(env.UNREADABLE) && env.UNREADABLE.indexOf("CATALYST_ROUTING_TABLE") >= 0)
  const key = (routingUnread ? "u\0" : "p\0" + cand.envPath) + "\0" + cand.market + "\0" + layers.join("\0")
  if (allowedMemo && now >= allowedMemo.t && now - allowedMemo.t < WORLD_MEMO_MS && allowedMemo.key === key) {
    return allowedMemo.value
  }
  const chain: string[] = []
  const applied: string[] = []
  let last = cand.market
  let parsed: any = null
  let baseSrc = ""
  if (routingUnread) {
    chain.push("env:unreadable")
  } else if (cand.envPath) {
    const t = await readText($, cand.envPath)
    if (t.text != null) {
      const got = allowedTableOf(parseToml(t.text))
      if (got.usable) {
        parsed = parseToml(t.text)
        baseSrc = "env"
      } else {
        chain.push("env:" + got.reason)
      }
    } else if (t.unreadable) {
      chain.push("env:unreadable")
    } else {
      chain.push("env:absent")
    }
  }
  if (parsed == null) {
    const t2 = await readText($, cand.market)
    if (t2.text != null) {
      const got = allowedTableOf(parseToml(t2.text))
      if (got.usable) {
        parsed = parseToml(t2.text)
        baseSrc = chain.length ? chain.join("→") + "→marketplace" : "marketplace"
      } else {
        chain.push("marketplace:" + got.reason)
      }
    } else if (t2.unreadable) {
      chain.push("marketplace:unreadable")
    }
  }
  if (parsed == null) {
    const src = chain.length ? chain.join("→") + "→absent:" + last : "absent:" + last
    const value = { allowedByClass: {}, effortByClass: {}, allowedSrc: src }
    allowedMemo = { t: now, key, value }
    return value
  }
  for (let i = 0; i < layers.length; i++) {
    const path = layers[i]
    const r = await readText($, path)
    if (r.text == null && !r.unreadable) continue
    if (r.text == null) {
      const value = { allowedByClass: {}, effortByClass: {}, allowedSrc: baseSrc + "+ovr:unreadable", refused: path + ": " + r.unreadable }
      allowedMemo = { t: now, key, value }
      return value
    }
    const over = parseToml(r.text || "")
    if (over.__unreadN) {
      const value = { allowedByClass: {}, effortByClass: {}, allowedSrc: baseSrc + "+ovr:unreadable", refused: path + ": не разобран как TOML (" + over.__unreadN + " строк)" }
      allowedMemo = { t: now, key, value }
      return value
    }
    parsed = mergeTableLayer(parsed, over)
    applied.push(path === machine ? "machine" : "project")
  }
  const got = allowedTableOf(parsed)
  if (!got.usable) {
    const value = { allowedByClass: {}, effortByClass: {}, allowedSrc: baseSrc + "+ovr:" + got.reason, refused: "слияние слоёв: таблица непригодна (" + got.reason + ")" }
    allowedMemo = { t: now, key, value }
    return value
  }
  const src = baseSrc + (applied.length ? "+ovr:" + applied.join("+") : "")
  const value = { allowedByClass: got.allowedByClass, effortByClass: got.effortByClass, allowedSrc: src }
  allowedMemo = { t: now, key, value }
  return value
}

export function failoverLadder(fo: any, subagentType: string, classId: string): string[] {
  return failoverLadderBind(fo, subagentType, classId).ladder
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

// CONSTRAINT (#514 H4, #330): план начинается с ОБЪЯВЛЕННОЙ модели, липкая
// идёт второй. Липкая впереди объявленной навсегда уводила агента с его
// модели: объявленная в план больше не возвращалась.
// CONSTRAINT (#509-FIX3 AR-4): повтор узнаётся по нормализованному id, а в
// план идёт первое вхождение как написано.
export function failoverAttemptModels(incoming: string, sticky: string | null, ladder: string[]): string[] {
  const out: string[] = []
  const keys: string[] = []
  const add = (x: any): void => {
    const m = x ? String(x) : ""
    if (!m) return
    const k = normModelId(m)
    if (keys.indexOf(k) >= 0) return
    keys.push(k)
    out.push(m)
  }
  add(incoming)
  add(sticky)
  const rows = Array.isArray(ladder) ? ladder : []
  for (let i = 0; i < rows.length; i++) add(rows[i])
  return out
}

// CONSTRAINT (#509-FIX1 C, #514 H3, #509-FIX3 H1): порядок плана шага --
// объявленная КАК НАПИСАНА, липкая, допущенные ступени, отложенные остывающие
// (temporary-*), ТЕРМИНАЛ строго последним. Терминал, совпавший с моделью из
// середины, оттуда снимается. Объявленная, совпавшая с терминалом, остаётся
// первой, терминал второй раз не добавляется и перехода нет (termAt -1, D-8a);
// остывая, она уходит в самый конец и там -- терминал. Живая метка permanent-model пропускает
// модель (dead), кроме терминала. Любой проход (#514 Р9) снимает модели с
// живой меткой temporary-known ИЛИ quota (#509-FIX11 B1: живая quota не менее
// известна -- ответ до срока известен заранее): вызов до срока -- заведомый
// отказ на каждом шаге, видимый в сессии. Длина плана не ограничена счётом (H9).
export function failoverStepPlan(incoming: string, sticky: string | null, ladder: string[], terminal: string, atMs: number, marks: ReadonlyMap<string, RungCooldownMark> = rungCooldownMarks): { plan: string[]; all: string[]; dead: string[]; evidence: { [k: string]: any }; termAt: number; skippedKnown: string[] } {
  const base = failoverAttemptModels(incoming, sticky, ladder)
  const term = String(terminal || "")
  const termN = term ? normModelId(term) : ""
  const inc = String(incoming || "")
  const declTerm = !!termN && !!inc && normModelId(inc) === termN
  const body: string[] = []
  for (let i = 0; i < base.length; i++) {
    if (i === 0 && declTerm) body.push(base[i])
    else if (!termN || normModelId(base[i]) !== termN) body.push(base[i])
  }
  const alive: string[] = []
  const dead: string[] = []
  for (let i = 0; i < body.length; i++) {
    const mark = marks.get(normModelId(body[i]))
    if (!(declTerm && i === 0) && mark && mark.class === "permanent-model" && isModelCooling(body[i], atMs, marks)) dead.push(body[i])
    else alive.push(body[i])
  }
  const d = deferCoolingAttemptModels(alive, atMs, marks)
  let plan = d.plan.slice()
  if (declTerm && isModelCooling(body[0], atMs, marks)) {
    const j = plan.indexOf(body[0])
    if (j >= 0) { plan.splice(j, 1); plan.push(body[0]) }
  }
  const all = body.slice()
  const skippedKnown: string[] = []
  const known = (m: string): boolean => {
    const mk = marks.get(normModelId(m))
    if (!mk || !isModelCooling(m, atMs, marks)) return false
    return mk.class === "temporary-known" || mk.class === "quota"
  }
  {
    const keep: string[] = []
    for (let i = 0; i < plan.length; i++) {
      if (known(plan[i])) skippedKnown.push(plan[i])
      else keep.push(plan[i])
    }
    plan = keep
  }
  // CONSTRAINT (#509-FIX9 R2): терминал с живой меткой temporary-known или
  // quota (срок в будущем) снимается в skippedKnown в любом проходе, как
  // ступени; срок истёк -- в плане, как прежде.
  const termKnown = (m: string): boolean => {
    const mk = marks.get(normModelId(m))
    return !!(mk && (mk.class === "temporary-known" || mk.class === "quota") && isModelCooling(m, atMs, marks))
  }
  let termAt = -1
  // CONSTRAINT (#509-FIX4 AR-5): остывшая объявленная, равная терминалу, в
  // хвосте плана ПОСЛЕ ступеней -- терминальная попытка (cell-exhausted,
  // без липкости); на первой позиции -- модель агента, не переход (D-8a).
  if (declTerm) {
    const j = plan.indexOf(body[0])
    if (j > 0) termAt = j
  }
  if (term && !declTerm) {
    all.push(term)
    if (termKnown(term)) skippedKnown.push(term)
    else { termAt = plan.length; plan.push(term) }
  }
  // CONSTRAINT (#509-FIX10 F1): объявленная = терминал с живой меткой
  // temporary-known/quota снимается в skippedKnown — вызова нет ни как
  // ступени, ни как терминала, ни в первом, ни в последующих проходах.
  if (declTerm && termKnown(body[0])) {
    const j = plan.indexOf(body[0])
    if (j >= 0) plan.splice(j, 1)
    if (skippedKnown.indexOf(body[0]) < 0) skippedKnown.push(body[0])
    termAt = -1
  }
  return { plan, all, dead, evidence: d.evidence, termAt, skippedKnown }
}

// CONSTRAINT (#509-FIX3 AR-4): словари ступеней ключены строкой как написана;
// точный ключ решает первым, нормализованный -- когда точного нет.
export function modelKeyed(table: any, model: string): any {
  if (!table || typeof table !== "object") return undefined
  if (Object.prototype.hasOwnProperty.call(table, model)) return table[model]
  const k = normModelId(model)
  const ks = Object.keys(table)
  for (let i = 0; i < ks.length; i++) if (normModelId(ks[i]) === k) return table[ks[i]]
  return undefined
}

// CONSTRAINT (#509-FIX7 Р11): seen.served -- кто ответил, usage.model результата
// или null без usage; берётся из ТОГО ЖЕ чтения usage, что предикат (#489-B1-FIX5
// Z13.4: одно чтение полей ответа на попытку).
export function isCarrierRefusal(res: any, seen?: { served: string | null }): boolean {
  if (seen) seen.served = null
  if (!res || typeof res !== "object") return false
  // CONSTRAINT: оба поля. answer==="" не признак: честный ответ из
  // thinking-блоков несёт пустой текст при живом usage (домен #190).
  // Совпадение имени модели (usage.model) успехом не считается.
  // CONSTRAINT (#509-FIX7 Р15): отказ модели текстом при живом usage -- ответ носителя, лестница по содержанию модель не меняет.
  const u = res.usage
  if (seen) {
    try { seen.served = u && typeof u === "object" && typeof u.model === "string" ? u.model : null } catch (x) { noteLost("failover-served-model", x) }
  }
  return u === null && res.stopReason === null
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

// CONSTRAINT (#391): негодный образец из конфига НАЗЫВАЕТСЯ уликой -- пустой
// catch делал опечатку в списке неотличимой от решения не сработать. Возврат
// false негодного -- НЕ разрешение: решение принимает вызывающий, читая bad.
// Пустой subject проверяется ДО компиляции: образец, до которого дело не
// дошло, уликой не считается (иначе список судьи гас бы на промте без класса).
// Граница 64 символа -- та же, что у effortBad (parseRungItem).
export function reTestMark(src: string, subject: string, field: string, bad: string[]): boolean {
  if (!subject) return false
  try {
    return new RegExp(src).test(subject)
  } catch (x) {
    bad.push(field + "=" + String(src).slice(0, 64))
    return false
  }
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
      const text = raw.text
      if (typeof text === "string") out.text = text
      const stopReason = raw.stopReason
      if (typeof stopReason === "string") out.stopReason = stopReason
      const blocks = raw.blocks
      if (Array.isArray(blocks)) {
        const bs: { type: string; len: number }[] = []
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i]
          if (b && typeof b === "object") {
            bs.push({ type: String(b.type ?? "?"), len: num(b.len, 0, 0) })
          }
        }
        out.blocks = bs
      }
      const u = raw.usage
      if (u && typeof u === "object") {
        const outputTokens = u.output_tokens
        if (typeof outputTokens === "number") out.outTok = outputTokens
      }
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

// CONSTRAINT: ЕДИНСТВЕННЫЙ дом словаря вердиктов. emits -- то, что проба
// ПИШЕТ в поле `verdict` улики (ПРОПИСНЫЕ виды); folds -- класс
// эквивалентности, в который МЕТРИКИ прибора сворачивают вид при подсчёте
// (Catalyst-CC-Patch/judge/validate.py:440, adjudicate.py:107), а НЕ «что
// проба отменяет». Поле `act` здесь не используется: в моде оно занято
// именем режима (cancel/nudge/log_only/form), и вторая семантика под тем же
// именем -- тот дефект, которым словарь разошлся с поведением. Запись "*"
// -- профиль пользовательских проб (profileOf, ветка по умолчанию) и
// защитный дефолт parseVerdict, который пробу не знает; прибор читает
// только три именованные записи -- корпус размечается по встроенным пробам.
type VocabRow = { probe: string; emits: string; folds: string }

const VERDICT_VOCAB_FILE: VocabRow[] = [
  { probe: "judge", emits: "OK|BLOCK|STOP|DENY|WARN", folds: "BLOCK|STOP|DENY" },
  { probe: "form", emits: "PASS|WARN|REFUSE", folds: "REFUSE|WARN" },
  { probe: "idle-watch", emits: "SILENT|NUDGE", folds: "NUDGE" },
  { probe: "*", emits: "OK|WARN|BLOCK|SILENT|NUDGE", folds: "BLOCK" },
]

let VERDICT_VOCAB: VocabRow[] = VERDICT_VOCAB_FILE

// CONSTRAINT: посев -- шов стенда для дома словаря, и он ОБЯЗАН быть
// возвратным: verdictVocabReset возвращает ровно объявленный в файле набор,
// иначе порядок сценариев стал бы несущим, а дом -- зависящим от того, какой
// тест отработал раньше.
export function verdictVocabSeed(rows: VocabRow[]): void {
  VERDICT_VOCAB = (rows || []).slice()
}

export function verdictVocabReset(): void {
  VERDICT_VOCAB = VERDICT_VOCAB_FILE
}

// CONSTRAINT: запасная строка -- ЛИТЕРАЛ, а не рекурсивный поиск "*": таблица,
// в которой строки "*" нет, зациклила бы vocabRow на себе. Её пустой emits
// означает «вид неизвестен» для любого вида -- сломанный дом не пропускает
// вердикт, а гасит его, и это направление выбрано сознательно.
const VOCAB_FALLBACK: VocabRow = { probe: "*", emits: "", folds: "" }

function vocabRow(probe: string): VocabRow {
  for (let i = 0; i < VERDICT_VOCAB.length; i++) if (VERDICT_VOCAB[i].probe === probe) return VERDICT_VOCAB[i]
  if (probe !== "*") for (let i = 0; i < VERDICT_VOCAB.length; i++) if (VERDICT_VOCAB[i].probe === "*") return VERDICT_VOCAB[i]
  return VOCAB_FALLBACK
}

function emitsOf(probe: string): string { return vocabRow(probe).emits }

// CONSTRAINT: «действующий» и «не действующий» -- один предикат и его
// отрицание НА ОБЛАСТИ СЛОВАРЯ пробы: foldedKind требует вхождения и в
// emits, и в folds, passKind -- в emits и НЕ в folds. Вид из folds не может
// пройти как не-действующий ни в одной точке поведения. NONE, TIMEOUT,
// TRUNCATED, SKIP, STALE_EPOCH под предикат НЕ подводятся: это служебные
// исходы прибора («вердикта нет» и причины), а не виды -- их места остаются
// литеральными (outcomeOf, memo-ветка диспатча), и это решение, а не
// недосмотр.
function foldedKind(probe: string, kind: string): boolean {
  const row = vocabRow(probe)
  return row.emits.split("|").indexOf(kind) >= 0 && row.folds.split("|").indexOf(kind) >= 0
}

function passKind(probe: string, kind: string): boolean {
  const row = vocabRow(probe)
  return row.emits.split("|").indexOf(kind) >= 0 && row.folds.split("|").indexOf(kind) < 0
}

// CONSTRAINT (#375): выбор прописного вида формы -- ЧИСТАЯ функция над домом,
// а не выражение внутри runForm. Официальный стенд исполняет хук в экземпляре
// модуля, недоступном посеву из теста, поэтому рассогласование дома и правил
// проверяемо ТОЛЬКО здесь; выражение, спрятанное в runForm, не имело бы зуба
// вовсе. null означает «дом такого вида не знает» -- это отказ прибора, а не
// пустая строка, которая уходила в улику видом вердикта.
export function formVerdictUpper(vk: string): string | null {
  const upper = emitsOf("form").split("|")
  const lower = upper.map((s) => s.toLowerCase())
  const i = lower.indexOf(vk)
  return i >= 0 ? upper[i] : null
}

export function formVocabRefusal(vk: string): string {
  return 'словарь пробы "form" не знает вид "' + vk + '"; emits дома: ' + emitsOf("form")
}

// CONSTRAINT (#391): накопитель bad -- та же дорога улики, что у reTestMark, и
// потому ТРЕТИЙ аргумент, а не поле результата: негодный словарь обязан быть
// назван и тогда, когда разбор вернул null, а форма результата покрыта зубами.
export function parseVerdict(raw: string, rx: string, bad?: string[]): { kind: string; rest: string } | null {
  // CONSTRAINT: дефолт -- профиль "*", а не судейский: parseVerdict не знает
  // пробы, и защитный словарь обязан быть общим надёжным над всеми видами.
  const vocab = String(rx || emitsOf("*")).replace(/\s+/g, "")
  let re: RegExp
  try { re = new RegExp("^(" + vocab + "):\\s*(.*)$") } catch (x) {
    // CONSTRAINT (#391): подмена словаря ОСТАЁТСЯ -- без словаря разбора нет;
    // но молча она выдавала вердикт ЧУЖОГО профиля за вердикт этого.
    if (bad) bad.push("rx=" + vocab.slice(0, 64))
    re = new RegExp("^(" + emitsOf("*") + "):\\s*(.*)$")
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

export function outcomeOf(kind: string, probe: string): string {
  if (passKind(probe, kind)) return "ok"
  if (foldedKind(probe, kind)) return "block"
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

function enforceOf(p: any, env: any, cfg: any): boolean {
  if (p.id === "judge") return env.JUDGE === "enforce" || bl3(cfg.enforce, true)
  return bl3(cfg.enforce, p.act === "cancel" || p.act === "nudge")
}

function fieldOf(ctx: any, name: string): any {
  if (!name) return undefined
  if (Object.prototype.hasOwnProperty.call(ctx, name)) return ctx[name]
  return undefined
}

// CONSTRAINT: дедуп when_bad -- один дом на оба источника мёртвого правила:
// негодный образец здесь (pred) и неизвестное поле ctx выше по стеку
// (whenFields). Вторая копия дедупа разошлась бы с первой молча.
function addWhenBad(ctx: any, add: string): void {
  if (ctx && typeof ctx === "object") {
    const cur = String(ctx.whenBad || "")
    if (cur.split(" ").indexOf(add) < 0) ctx.whenBad = cur ? cur + " " + add : add
  }
}

function whenFields(when: any): string[] {
  const out: string[] = []
  if (!when || typeof when !== "object") return out
  if (Array.isArray(when.all) || Array.isArray(when.any)) {
    const rows: any[] = Array.isArray(when.all) ? when.all : when.any
    for (let i = 0; i < rows.length; i++) {
      const sub = whenFields(rows[i])
      for (let j = 0; j < sub.length; j++) if (out.indexOf(sub[j]) < 0) out.push(sub[j])
    }
    return out
  }
  if (when.not) return whenFields(when.not)
  const f = String(when.field || "")
  if (f) out.push(f)
  return out
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
    try { return new RegExp(String(when.matches)).test(String(field ?? "")) } catch (x) {
      // CONSTRAINT (#391): fail-closed к срабатыванию ОСТАЁТСЯ -- мёртвое
      // правило не имеет права запускать пробу; но мертвело оно МОЛЧА. Улика
      // копится в ctx (сигнатуру pred менять нельзя: рекурсия all/any/not),
      // а читает её вызывающий -- он же передаёт ctx дальше в consultBg.
      addWhenBad(ctx, "matches=" + String(when.matches).slice(0, 64))
      return false
    }
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
    // CONSTRAINT: отсутствие — code ENOENT (доступ к code внутри try) или текст с ENOENT; пустая строка и всё прочее — unreadable, и он непуст.
    let codeEnoent = false
    try { codeEnoent = !!(x && (x as any).code === "ENOENT") } catch (y) { codeEnoent = false }
    const m = safeText(x)
    if (codeEnoent || m.indexOf("ENOENT") >= 0) return { text: null, unreadable: "" }
    return { text: null, unreadable: m.slice(0, 160) }
  }
}

let journalWriteErr = ""
let journalErrSeq = 0

async function appendJournal($: any, jpath: string, obj: any) {
  // CONSTRAINT: ОДИН дом формата шарда (имя jpath+".shard."+safe(rec)).
  // Отказ записи ПРОБРАСЫВАЕТСЯ; след кладётся в journalWriteErr и уезжает
  // в СЛЕДУЮЩУЮ удачную запись -- пустой catch здесь возвращал бы молчаливую
  // потерю полной улики (тот же класс, что волна 1 чинила у агрегата).
  let lostSnap: Record<string, { n: number; last: string }> | null = null
  try {
    const carriedErr = journalWriteErr
    const carriedSeq = journalErrSeq
    lostSnap = lostWrites
    lostWrites = {}
    const extra: any = {}
    if (carriedErr) extra.journalWriteErr = carriedErr
    if (lostSnap && Object.keys(lostSnap).length) extra.lost = lostSnap
    const recObj = Object.keys(extra).length ? Object.assign({}, obj, extra) : obj
    const line = JSON.stringify(recObj) + "\n"
    const rec = String((recObj && (recObj.rec || recObj.t)) || ("t" + String(await nowMs($))))
    let safe = ""
    for (let i = 0; i < rec.length; i++) {
      const c = rec.charAt(i)
      safe += /[A-Za-z0-9._-]/.test(c) ? c : "_"
    }
    await $.fs.write(jpath + ".shard." + safe, line)
    // CONSTRAINT: запись очищает только ошибку, которую сама унесла; отказ соседней записи за время этой -- даже с тем же текстом -- меняет journalErrSeq и остаётся на следующую.
    if (journalErrSeq === carriedSeq) journalWriteErr = ""
  } catch (x) {
    // CONSTRAINT: след НАЗЫВАЕТ владельца отказавшего журнала. Один
    // journalWriteErr обслуживает все пробы, и следующая удачная запись
    // может принадлежать ДРУГОЙ пробе -- без пути читатель отнесёт отказ не
    // к тому журналу. Сообщение носителя путь не гарантирует, поэтому он
    // приписывается здесь.
    journalErrSeq++
    journalWriteErr = (jpath + ": " + safeText(x)).slice(0, 240)
    if (lostSnap) {
      for (const k of Object.keys(lostSnap)) {
        lostWrites[k] = { n: lostSnap[k].n + (lostWrites[k] ? lostWrites[k].n : 0), last: lostWrites[k] ? lostWrites[k].last : lostSnap[k].last }
      }
    }
    throw x
  }
}

// CONSTRAINT: отказ записи/состояния учитывается по имени места и уезжает полем
// `lost` следующей удачной записи журнала; пустой catch терял его бесследно (#393).
let lostWrites: Record<string, { n: number; last: string }> = {}

export function lostWritesSnapshot(): Record<string, { n: number; last: string }> {
  return JSON.parse(JSON.stringify(lostWrites))
}

// CONSTRAINT: носитель отказа не вправе бросать — иначе отказ, который он несёт, превращается в обрыв вызывающего (turn.step).
// CONSTRAINT: message, name и String(x) читаются каждый своим try: бросок одного поля не стирает уже прочитанный текст другого. Имя не теряется, если String(x) — только ярлык [object …].
function safeText(x: any): string {
  let msg = ""
  let name = ""
  let full = ""
  let anyThrew = false
  try {
    const v = x == null ? undefined : x.message
    if (v != null) msg = String(v)
  } catch (y) {
    msg = ""
    anyThrew = true
  }
  try {
    const v = x == null ? undefined : x.name
    if (v != null) name = String(v)
  } catch (y) {
    name = ""
    anyThrew = true
  }
  try {
    full = String(x)
  } catch (y) {
    full = ""
    anyThrew = true
  }
  const tag = /^\[object [^\]]*\]$/.test(full)
  let out = ""
  if (name && name !== "Error") {
    if (full && !tag && (msg === "" || full.indexOf(msg) >= 0)) out = full
    else if (msg) out = name + ": " + msg
    else out = name
  } else {
    if (msg) out = msg
    else if (full && !tag) out = full
    else if (name) out = name
    else out = full
  }
  if (out) return out
  return anyThrew ? "unprintable error" : "(empty error)"
}

function noteLost(site: string, x: any, $?: any): void {
  const m = safeText(x).slice(0, 200)
  const cur = lostWrites[site]
  lostWrites[site] = { n: (cur ? cur.n : 0) + 1, last: m }
  // CONSTRAINT: проверка «$ передан» не может быть if ($) — валидатор хоста
  // запрещает читать $ вне $.noun.verb; отсутствие $ даёт тот же пойманный
  // отказ, что и отказ самого канала debug.
  try { $.ui.log("catalyst-probes: " + site + ": " + m, { to: "debug" }) } catch (y) {
    // CONSTRAINT: отказал и канал debug — отказ уже учтён в lostWrites и уедет следующей удачной записью журнала.
  }
}

// CONSTRAINT (#489-B1-FIX5 Z13): снимок события читает каждый ключ РОВНО ОДИН
// раз; повторное чтение исходного объекта хостом не гарантировано стабильным
// (геттер-улики Z13-a…f). Отказ ключа вычитается из снимка и учитывается по
// сайту <событие>:<ключ>. Параметр назван не `e`: ценз Z13.6 нулит каждое
// обращение к сырому событию по индексу, а снимку такое чтение необходимо.
export function snapEvent($: any, raw: any, site: string): any {
  if (raw === null || typeof raw !== "object") return {}
  let ks: string[]
  try { ks = Object.keys(raw) } catch (x) { noteLost(site + ":keys", x, $); return {} }
  const out: any = {}
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]
    try { out[k] = raw[k] } catch (x) { noteLost(site + ":" + k, x, $) }
  }
  return out
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

// CONSTRAINT: словарь ключа `on` -- ровно перечень hook_event_name контракта
// (claude-code.d.ts); гейт test-mod-units.sh пересчитывает его по d.ts, а зуб
// p531 T13 сверяет с ним подписки classic.*.
export const CLASSIC_EVENTS: readonly string[] = [
  "ConfigChange", "CwdChanged", "DirectoryAdded", "Elicitation", "ElicitationResult",
  "FileChanged", "InstructionsLoaded", "MessageDisplay", "Notification", "PermissionDenied",
  "PermissionRequest", "PostCompact", "PostModelSwitch", "PostToolBatch", "PostToolUseFailure",
  "PostToolUse", "PreCompact", "PreModelSwitch", "PreToolUse", "SessionEnd",
  "SessionStart", "Setup", "StopFailure", "Stop", "SubagentStart",
  "SubagentStop", "TaskCompleted", "TaskCreated", "TeammateIdle", "UserPromptExpansion",
  "UserPromptSubmit", "WorktreeCreate", "WorktreeRemove",
]
// CONSTRAINT: PreToolUse и PostToolUse обслуживает единственная подписка
// tool.call (вторая подписка той же двери молча заменила бы первую, #447);
// MessageDisplay приходит на каждую дельту отрисовки и не регистрируется.
const CLASSIC_VIA_TOOL_CALL = ["PreToolUse", "PostToolUse"]
const CLASSIC_PER_DELTA = ["MessageDisplay"]

// CONSTRAINT: отмена ждёт вердикта до next(e) -- это есть только у PreToolUse;
// cancel/pending на прочем имени и на таймере -- on_bad, имя снимается.
function probeTriggersOf(id: string, cfg: any, act: string, pending: boolean, builtin: boolean): { on: string[]; onBad: string[]; everyMs: number } {
  const on: string[] = []
  const onBad: string[] = []
  const blocking = act === "cancel" || pending
  let raw: any = cfg.on
  if (raw === undefined || raw === null) raw = builtin ? ["PreToolUse"] : []
  if (!Array.isArray(raw)) raw = [raw]
  for (let i = 0; i < raw.length; i++) {
    const name = String(raw[i])
    if (CLASSIC_PER_DELTA.indexOf(name) >= 0) { if (onBad.indexOf(name + ":per-delta") < 0) onBad.push(name + ":per-delta"); continue }
    if (CLASSIC_EVENTS.indexOf(name) < 0) { if (onBad.indexOf(name) < 0) onBad.push(name); continue }
    if (blocking && name !== "PreToolUse") { if (onBad.indexOf(name + ":cancel-needs-PreToolUse") < 0) onBad.push(name + ":cancel-needs-PreToolUse"); continue }
    if (on.indexOf(name) < 0) on.push(name)
  }
  let everyMs = num(cfg.every_min, 0, 1) * 60000
  if (!everyMs && id === "idle-watch") everyMs = num(cfg.live_recheck_ms, 60000, 1000)
  if (everyMs && blocking) { onBad.push("every_min:cancel-needs-PreToolUse"); everyMs = 0 }
  return { on, onBad, everyMs }
}

function profileOf(id: string, cfg: any): any {
  const p = profileBase(id, cfg)
  if (p.kind === "consult") Object.assign(p, probeTriggersOf(id, cfg, p.act, p.pending, p.builtin))
  else Object.assign(p, { on: [], onBad: [], everyMs: 0 })
  return p
}

function profileBase(id: string, cfg: any): any {
  const kind = String(cfg.kind || (id === "form" ? "form" : "consult"))
  if (id === "judge") {
    return {
      id, cfg, kind: "consult",
      act: String(cfg.act || "cancel"),
      rx: String(cfg.rx || emitsOf("judge")),
      builtin: true, coaching: true, pending: true,
      mainLoopOnly: true,
    }
  }
  if (id === "idle-watch") {
    return {
      id, cfg, kind: "consult",
      act: String(cfg.act || "nudge"),
      rx: String(cfg.rx || emitsOf("idle-watch")),
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
    rx: String(cfg.rx || emitsOf("*")),
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
  if (Array.isArray(env.UNREADABLE) && env.UNREADABLE.indexOf(n) >= 0) return false
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
    const got = await readText($, path)
    if (got.unreadable) {
      noteLost("prompt-rule-text", new Error(path + ": " + got.unreadable), $)
      return ""
    }
    const t = got.text === null ? "" : String(got.text)
    promptTextMemo[path] = t
    return t
  }
  return String(r.text || "")
}

async function applyPromptRules(
  $: any, world: any, env: any, kind: string, target: string, text: string,
): Promise<{ text: string; applied: string[] }> {
  const applied: string[] = []
  if (!formOn(env.PROMPTS)) return { text, applied }
  if (Array.isArray(env.UNREADABLE) && env.UNREADABLE.indexOf("CLAUDE_PROMPTS") >= 0) return { text, applied }
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
          t: isoOf(await nowMs($)), id: r.id, kind: r.kind,
          target: r.target, mode: r.mode, chars_before: before, chars_after: out.length,
          builtin: r.builtin === true,
        }),
      )
    } catch (x) { noteLost("prompt-applied-record", x, $) }
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
// CONSTRAINT (#495): при неизвестном каталоге (cwd === "") мемоизируется ТОЛЬКО
// окружение -- envBundle и имена env-unreadable:*; мир при неизвестном каталоге
// не мемоизируется никогда: findProjectHome идёт относительными путями от
// фактического каталога процесса, и ключ "" не может считаться совпавшим (#308).
let envMemo: { t: number, env: any } | null = null
let allowedMemo: { t: number, key: string, value: { allowedByClass: { [classId: string]: string[] }, effortByClass: { [classId: string]: string }, allowedSrc: string, refused?: string } } | null = null

// CONSTRAINT: однократность журнальной записи громкого отказа слоя допуска --
// на ПРОЦЕСС, не на сессию: newSession её не сбрасывает, повторный отказ той
// же причины после /resume не молчит вечно, но и не заливает журнал.
const admissionRefusedSaid = new Set<string>()

// CONSTRAINT (#509-FIX1 A2/A3/G, #514 H3): однократные записи лестницы -- на
// ПРОЦЕСС, тем же приёмом, что admissionRefusedSaid: ключ держит только
// удавшаяся запись.
const terminalAbsentSaid = new Set<string>()
const rungNotAdmittedSaid = new Set<string>()
const admissionUnavailableSaid = new Set<string>()
const skippedDeadSaid = new Set<string>()

// CONSTRAINT: дверь сброса -- для тестового стенда; продовое поведение её не
// зовёт (однократность на процесс).
export function failoverSaidReset(): void {
  terminalAbsentSaid.clear()
  rungNotAdmittedSaid.clear()
  admissionUnavailableSaid.clear()
  skippedDeadSaid.clear()
}

// CONSTRAINT (#509-FIX7 Р16): fan-self-absent -- одна запись на tool_use_id,
// потолок множества FAN_SELF_ABSENT_MAX, вытесняется старейший.
const DISPATCHES_PAST_MAX = 20
const FAN_SELF_ABSENT_MAX = 256
const fanSelfAbsentSaid = new Set<string>()
export function fanSelfAbsentReset(): void { fanSelfAbsentSaid.clear() }
// CONSTRAINT (#509-FIX7b AR11): события с tool_use_id, выданным модом (таймер,
// classic без своего), -- имя улики, не вызов: текущего вызова у них нет.
const calllessEvents = new WeakSet<object>()

async function journalOnce($: any, said: Set<string>, key: string, jpath: string, rec: any, site: string): Promise<void> {
  if (!jpath || said.has(key)) return
  said.add(key)
  try {
    await appendJournal($, jpath, rec)
  } catch (x) {
    said.delete(key)
    noteLost(site, x, $)
  }
}

// CONSTRAINT (#335): громкий отказ чужого носителя пишет в журнал ОДИН раз на
// процесс на пару «проба x значение ручки» -- цикл проб видит отказ на каждом
// вызове инструмента, и без однократности он заливал бы журнал. Дедуп НЕ
// распространяется на сам отказ: гасится КАЖДЫЙ диспатч -- второй и все
// последующие тоже, без исключений.
const carrierForeignSaid = new Set<string>()

// CONSTRAINT (#393): дедуп журнала нечитаемой ручки -- один раз на процесс на
// пару «проба x ручка», по образцу carrierForeignSaid: цикл проб видит отказ
// на каждом вызове инструмента. Отказ НЕ дедуплицируется -- гасится КАЖДЫЙ
// вызов, как и у чужого носителя.
const carrierEnvUnreadableSaid = new Set<string>()

// CONSTRAINT: отказ чтения даёт тот же путь, что пустое значение, и он виден через env-unreadable:<имя>; реакцию имеют выключатель CLAUDE_PROMPTS и allowedSrc для CATALYST_ROUTING_TABLE.
const ENV_UNREADABLE_NINE = [
  "CLAUDE_JUDGE_MODEL", "CLAUDE_JUDGE_PROMPT", "CLAUDE_JUDGE_TIMEOUT_MS",
  "CLAUDE_PROMPTS", "CLAUDE_PROBES_DIR", "CLAUDE_CONFIG_DIR",
  "HOME", "PWD", "CATALYST_ROUTING_TABLE",
]

export async function worldFor($: any): Promise<any> {
  const ep = epoch
  const now = await nowMs($)
  // CONSTRAINT: каталог -- ключ мемо, поэтому вычисляется ДО кэша той же
  // логикой, что и потребитель (loadWorld), и передаётся ему: повторный
  // расчёт поднимал бы стоимость горячего пути.
  let cwd = ""
  try { cwd = String(await $.env.get("PWD") || "").trim() } catch (x) { cwd = ""; noteLost("cwd-env-read", x, $) }
  if (!cwd && !cwdStoreStale) {
    try { cwd = String(await $.store.get(CWD_KEY) || "") } catch (x) { cwd = ""; noteLost("cwd-store-read", x, $) }
  }
  if (cwd && worldMemo && now >= worldMemo.t && now - worldMemo.t < WORLD_MEMO_MS && worldMemo.cwd === cwd) {
    if (probeHear === null) probeIndexFrom(worldMemo)
    return worldMemo
  }
  // CONSTRAINT (#495): окно мемо окружения -- [t, t + WORLD_MEMO_MS): часы,
  // ушедшие назад, не продлевают мемо, пока снова не догонят t.
  const envHit = !cwd && envMemo !== null && now >= envMemo.t && now - envMemo.t < WORLD_MEMO_MS
  let env: any
  if (envHit) env = (envMemo as { env: any }).env
  else {
    env = await envBundle($)
    for (let i = 0; i < ENV_UNREADABLE_NINE.length; i++) {
      const name = ENV_UNREADABLE_NINE[i]
      if (Array.isArray(env.UNREADABLE) && env.UNREADABLE.indexOf(name) >= 0)
        noteLost("env-unreadable:" + name, new Error(name + " unreadable"), $)
    }
  }
  const world = await loadWorld($, env, cwd)
  const packed = { t: now, cwd, env, world }
  // CONSTRAINT (#509-FIX8 Р5): мир, загруженный в прежней эпохе, -- мир прежней сессии: мемо и индекс слушателей новой эпохи он не пишет.
  if (ep !== epoch) return packed
  // CONSTRAINT: при неопределимом каталоге мемо мира не используется и не
  // заполняется -- неизвестный ключ никогда не считается совпавшим (#308);
  // вместо него пишется мемо одного окружения (#495).
  if (cwd) worldMemo = packed
  else if (!envHit) envMemo = { t: now, env }
  probeIndexFrom(packed)
  return packed
}

// CONSTRAINT: индекс слушателей читает быстрый путь classic.* синхронно, без
// $ и без await; он пересобирается при каждой сборке мира (session.start,
// tool.call, тик), поэтому правка probes.toml видна не позже следующей сборки.
// null -- индекс ещё не построен (загрузка модуля или смена эпохи: мир новой
// сессии может слушать другое): classic-хук и tool.call агента идут медленным
// путём (сборка мира и решение по ней), первое событие не теряется.
let probeHear: Set<string> | null = null
let probeHearAgentTool = false
let probeNotMain: string[] = []

// CONSTRAINT: дверь сброса -- для тестового стенда (состояние загрузки модуля).
export function probeIndexReset(): void {
  probeHear = null
  probeHearAgentTool = false
  probeNotMain = []
}

function probeListens(p: any, env: any, withForm = false): boolean {
  if (!p || (p.kind !== "consult" && !(withForm && p.kind === "form"))) return false
  if (p.cfg && p.cfg.enabled === false) return false
  return armStateOf(p, env).state === "armed"
}

function probeIndexFrom(packed: any): void {
  const hear = new Set<string>()
  let agentTool = false
  const notMain: string[] = []
  const probes = packed && packed.world && Array.isArray(packed.world.probes) ? packed.world.probes : []
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i]
    if (!probeListens(p, packed.env)) continue
    const on: string[] = Array.isArray(p.on) ? p.on : []
    let toolEv = false
    for (let j = 0; j < on.length; j++) {
      if (CLASSIC_VIA_TOOL_CALL.indexOf(on[j]) >= 0) toolEv = true
      else hear.add(on[j])
    }
    if (toolEv && p.mainLoopOnly) notMain.push(String(p.id))
    if (toolEv && !p.mainLoopOnly) agentTool = true
  }
  probeHear = hear
  probeHearAgentTool = agentTool
  probeNotMain = notMain
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
// CONSTRAINT (#391): третий аргумент -- ИМЯ поля конфига, откуда приехал
// образец. Fail-closed выше по стеку верен и не меняется, но его текст
// («hook threw») не называл причину: оператор не узнавал, что отказ вызван
// опечаткой в ЕГО конфиге и в каком именно поле.
// CONSTRAINT: matchAll читает lastIndex исходника; K отдаёт его нулевым.
export function K(s: string, f: string, field?: string): RegExp {
  const key = f + "|" + s
  if (rxCache[key]) {
    const r = rxCache[key]
    r.lastIndex = 0
    return r
  }
  let r: RegExp
  try {
    r = new RegExp(s, f)
  } catch (x) {
    throw new Error(
      "негодный образец конфига форм" + (field ? " (" + field + ")" : "") +
      ": " + String(s).slice(0, 64))
  }
  rxCache[key] = r
  r.lastIndex = 0
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
// CONSTRAINT: отказ уборки не бьёт по каждой консультации судьи: повтор
// не раньше SWEEP_RETRY_MS от момента отказа по СВЕЖЕМУ чтению часов (t0
// консультации, начатой до чужого отказа, окно не мерит); шаг часов назад за
// момент отказа повтор разрешает; отказ в момент 0 окно держит (флаг, не
// время); стоящие часы окно не держат дольше SWEEP_RETRY_CALLS пропусков;
// нечисловое время окно меряет только счётом пропусков; счёт пропусков --
// на консультацию: конкурентные консультации одного окна -- каждая свой пропуск.
let sweepFailed = false
let sweepFailedAt = 0
let sweepSkips = 0
let sweepRunning = false
let sweepGen = 0
const SWEEP_RETRY_MS = 600000
export const SWEEP_RETRY_CALLS = 64

export function sweepRetryDue(tn: number): boolean {
  const timed = Number.isFinite(tn) && Number.isFinite(sweepFailedAt)
  if (timed && (tn < sweepFailedAt || tn - sweepFailedAt >= SWEEP_RETRY_MS)) return true
  if (sweepSkips >= SWEEP_RETRY_CALLS) return true
  sweepSkips++
  return false
}
// CONSTRAINT: несостоявшаяся запись cwd оставляет в сторе каталог ПРОШЛОЙ
// сессии; фолбэк на него давал бы чужой projectHome и чужой допуск классов.
let cwdStoreStale = false
// CONSTRAINT: отказ стора не обнуляет счёт и отметку: без зеркала отказ записи
// снимал кэп и кулдаун.
const capMirror = new Map<string, number[]>()
const lastMirror = new Map<string, number>()

const failoverBinds = new Map<string, any>()
// CONSTRAINT: недоступность модели относится к процессу, а не к сессии;
// newSession не сбрасывает метки. Ключи — модели лестниц консультаций И
// модели веера turn.step (#313). Метка несёт ПРИЧИНУ: читатели засчитывают
// РАЗНЫЕ наборы причин, и без причины в метке дорога консультаций молча
// расширила бы то, что она судит.
// CONSTRAINT (#514 H3): метка веера несёт СРОК (until) и КЛАСС отказа; окно
// RUNG_COOLDOWN_MS судит только метки без срока (дорога консультаций,
// rung-timeout).
export type RungCooldownMark = { at: number; reason: string; until?: number; class?: string; n?: number; text?: string }
export const RUNG_COOLDOWN_REASON_TIMEOUT = "rung-timeout"
export const RUNG_COOLDOWN_REASON_CARRIER = "carrier-refusal"
export const RUNG_COOLDOWN_REASON_THROW = "carrier-throw"
export const RUNG_COOLDOWN_REASONS_ALL = [RUNG_COOLDOWN_REASON_TIMEOUT, RUNG_COOLDOWN_REASON_CARRIER, RUNG_COOLDOWN_REASON_THROW]
const rungCooldownMarks = new Map<string, RungCooldownMark>()

// CONSTRAINT (#514 H3): backoff неизвестного срока по n подряд идущих отказов
// модели: 30, 60, 120, 240 с, далее 240 с; отказ по модели -- час.
export const REFUSAL_BACKOFF_MS = [30000, 60000, 120000, 240000]
export const PERMANENT_MARK_MS = 3600000

export function refusalBackoffMs(n: number): number {
  const i = Math.max(1, Math.floor(Number(n) || 1)) - 1
  return REFUSAL_BACKOFF_MS[Math.min(i, REFUSAL_BACKOFF_MS.length - 1)]
}

// CONSTRAINT: окно остывания судит ТОЛЬКО этот предикат. Второй дом правила
// (rungsAfterCooldown против cooldownSnapshot против веера) спорил бы об
// одном окне; до #313 два дома держались только комментарием.
// CONSTRAINT (#509-FIX3 AR-4): ключ метки -- нормализованный id; строка как
// написана в ключ не идёт, иначе «X[1m]» и «x» остывали бы порознь.
export function isModelCooling(model: string, atMs: number, marks: ReadonlyMap<string, RungCooldownMark> = rungCooldownMarks, reasons: readonly string[] = RUNG_COOLDOWN_REASONS_ALL): boolean {
  const mark = marks.get(normModelId(model))
  if (mark === undefined || reasons.indexOf(mark.reason) < 0) return false
  if (typeof mark.until === "number") return atMs < mark.until
  return atMs - mark.at <= RUNG_COOLDOWN_MS
}

// CONSTRAINT (#514 H3): срок метки -- из класса отказа. Класс request метки
// не ставит: дефект запроса одинаков для любой модели и о модели не говорит.
// CONSTRAINT (#509-FIX7 Р14): quota -- QUOTA_COOLDOWN_MS от отказа; метка не
// мёртвая: модель откладывается в хвост плана, как остывающая.
// CONSTRAINT (#509-FIX9 R3): срок quota, разобранный classifyRefusal из
// «soonest recovery in» (readyAt > 0), заменяет QUOTA_COOLDOWN_MS.
// Срок temporary-known, не лежащий в будущем, читается как неизвестный --
// иначе перепроба шла бы без паузы.
export function noteModelRefusal(model: string, atMs: number, cls: string, readyAt: number, reason: string, text: string, marks: Map<string, RungCooldownMark> = rungCooldownMarks): RungCooldownMark | null {
  if (cls === "request") return null
  const key = normModelId(model)
  const prev = marks.get(key)
  const n = (prev && typeof prev.n === "number" ? prev.n : 0) + 1
  let klass = cls
  let until = 0
  if (cls === "permanent-model") until = atMs + PERMANENT_MARK_MS
  else if (cls === "quota") until = readyAt > 0 ? readyAt : atMs + QUOTA_COOLDOWN_MS
  else if (cls === "temporary-known" && readyAt > atMs) until = readyAt
  else { klass = "temporary-unknown"; until = atMs + refusalBackoffMs(n) }
  const mark: RungCooldownMark = { at: atMs, reason, until, class: klass, n, text: String(text || "").slice(0, REFUSAL_TEXT_MAX) }
  marks.set(key, mark)
  return mark
}

// CONSTRAINT (#514 H3, З6): успех модели снимает её метку целиком, вместе со
// счётом подряд идущих отказов.
export function noteModelSuccess(model: string, marks: Map<string, RungCooldownMark> = rungCooldownMarks): void {
  marks.delete(normModelId(model))
}

export function noteRungTimeout(model: string, errText: string, atMs: number, marks: Map<string, RungCooldownMark> = rungCooldownMarks, budgetClipped: boolean = false): boolean {
  if (errText.indexOf("rung-deadline") < 0) return false
  // CONSTRAINT: урезанный общим пределом бюджет доказывает таймаут,
  // но не недоступность модели; существующая метка тоже не продлевается.
  if (!budgetClipped) marks.set(normModelId(model), { at: atMs, reason: RUNG_COOLDOWN_REASON_TIMEOUT })
  return true
}

// CONSTRAINT: метка отказа носителя ставится ТОЛЬКО на отказ ДО первого
// содержимого. Бросок — транспортный отказ, а не отказ носителя (различение
// #239); ступень, выдавшая содержимое, состоялась. Обе вырезки — прямые
// аналоги budgetClipped у noteRungTimeout: метится только то, что доказывает
// недоступность МОДЕЛИ.
export function noteRungCarrierRefusal(model: string, atMs: number, marks: Map<string, RungCooldownMark> = rungCooldownMarks): void {
  noteModelRefusal(model, atMs, "temporary-unknown", 0, RUNG_COOLDOWN_REASON_CARRIER, "", marks)
}

// CONSTRAINT: дверь сброса — для ТЕСТОВОГО стенда и будущих ручек; продовое
// поведение её не зовёт: недоступность модели относится к процессу и переживает
// newSession (CONSTRAINT у карты выше). Без двери соседний зуб, чья модель
// отказала в предыдущем, молча меняет смысл.
export function rungCooldownReset(): void {
  rungCooldownMarks.clear()
}

// CONSTRAINT: набор причин дороги консультаций — ТОЛЬКО отказ по времени:
// расширение набора молча изменило бы то, что судья пропускает.
export function rungsAfterCooldown<T extends { model: string }>(ladder: T[], atMs: number, marks: ReadonlyMap<string, RungCooldownMark> = rungCooldownMarks, reasons: readonly string[] = [RUNG_COOLDOWN_REASON_TIMEOUT]): { ladder: T[]; evidence: { [k: string]: any } } {
  const keep: T[] = []
  const skipped: string[] = []
  const ages: { [k: string]: number } = {}
  for (let i = 0; i < ladder.length; i++) {
    const rung = ladder[i]
    if (isModelCooling(rung.model, atMs, marks, reasons)) {
      const mark = marks.get(normModelId(rung.model)) as RungCooldownMark
      skipped.push(rung.model)
      ages["rungCooldownAgeMs_" + rung.model] = atMs - mark.at
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

// CONSTRAINT: предикат «ещё остывает» — isModelCooling, ОДИН дом для фильтра
// лестницы, этой команды и веера: второй дом правила сделал бы их спорящими
// об одном окне.
// CONSTRAINT: дверь наблюдения засчитывает ОБЕ причины метки и называет
// причину в выводе — дверь, скрывающая половину меток, хуже отсутствующей.
export function cooldownSnapshot(atMs: number, marks: ReadonlyMap<string, RungCooldownMark> = rungCooldownMarks, reasons: readonly string[] = RUNG_COOLDOWN_REASONS_ALL): Array<{ model: string; leftMs: number; reason: string; class?: string }> {
  const out: Array<{ model: string; leftMs: number; reason: string; class?: string }> = []
  marks.forEach((mark: RungCooldownMark, model: string) => {
    if (isModelCooling(model, atMs, marks, reasons)) {
      if (typeof mark.until === "number") out.push({ model, leftMs: mark.until - atMs, reason: mark.reason, class: String(mark.class || "") })
      else out.push({ model, leftMs: RUNG_COOLDOWN_MS - (atMs - mark.at), reason: mark.reason })
    }
  })
  return out
}

// CONSTRAINT: пустая карта и отфильтрованная в ноль -- РАЗНЫЕ явные строки:
// пустой вывод неотличим от молчания команды, а молчание наблюдатель принял бы
// за ноль (ПУСТО != НОЛЬ).
export function ladderCommandText(atMs: number, argRaw: string, marks: ReadonlyMap<string, RungCooldownMark> = rungCooldownMarks): string {
  const arg = clipLadderArg(argRaw)
  const snap = cooldownSnapshot(atMs, marks)
  const rows = snap.filter((r) => !arg || r.model.indexOf(arg) >= 0)
  const lines = ["catalyst-ladder " + MOD_VERSION + ": окно остывания " + (RUNG_COOLDOWN_MS / 60000) + " мин"]
  if (!snap.length) {
    lines.push("остывающих ступеней нет")
  } else if (!rows.length) {
    lines.push("под фильтр не попала ни одна ступень")
  } else {
    for (const r of rows) lines.push(r.model + ": остывать ещё " + Math.ceil(r.leftMs / 1000) + " с (" + r.reason + (r.class ? ", " + r.class : "") + ")")
  }
  return lines.join("\n")
}

// --- #313: отсрочка остывающих моделей в плане веера --------------------------

// CONSTRAINT: остывающая модель НИКОГДА не удаляется из плана — только
// переставляется в хвост (стабильно: взаимный порядок и готовых, и остывающих
// прежний). Удаление воспроизводило бы отклонённую #311: собственная
// назначенная модель агента исчезала из плана, и агент возвращал отказ, ни
// разу её не вызвав. Ложная или протухшая метка обязана стоить лишнего круга
// веера, а не отказа при живой модели. Длина плана до и после совпадает.
export function deferCoolingAttemptModels(plan: string[], atMs: number, marks: ReadonlyMap<string, RungCooldownMark> = rungCooldownMarks, reasons: readonly string[] = RUNG_COOLDOWN_REASONS_ALL): { plan: string[]; evidence: { [k: string]: any } } {
  const ready: string[] = []
  const deferred: string[] = []
  for (let i = 0; i < plan.length; i++) {
    if (isModelCooling(plan[i], atMs, marks, reasons)) deferred.push(plan[i])
    else ready.push(plan[i])
  }
  // CONSTRAINT: при нуле отложенных полей улики нет вовсе — форма
  // rungsAfterCooldown: пустой фильтр не несёт полей пропуска.
  if (!deferred.length) return { plan, evidence: {} }
  const evidence: { [k: string]: any } = { cooldownDeferred: deferred.slice() }
  for (let i = 0; i < deferred.length; i++) {
    const mark = marks.get(normModelId(deferred[i])) as RungCooldownMark
    evidence["cooldownAgeMs_" + deferred[i]] = atMs - mark.at
    evidence["cooldownReason_" + deferred[i]] = mark.reason
    if (mark.class) evidence["cooldownClass_" + deferred[i]] = mark.class
  }
  return { plan: ready.concat(deferred), evidence }
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

// CONSTRAINT (#514 Р8): ожидающий агент берёт лестницу, эффорты ступеней и
// терминал из мира момента пробы, не спавна: привязка спавна замораживала
// клетку с одной ступенью, и агент вечно ждал её окна. Отказавшие модели
// отсеивают метки rungCooldownMarks, а не перечень привязки.
export function failoverBindRefresh(bind: any, world: any): void {
  if (!bind || !world || !world.failover) return
  const info = failoverLadderBind(world.failover, bind.subagentType, bind.class)
  const term = failoverTerminal(world.failover)
  const adm = admitLadder(info.ladder, bind.class, world.allowedByClass, admissionUsable(world))
  // CONSTRAINT: нечитаемый слой лестницы или допуска не подтверждает и не
  // снимает ступени -- привязка ожидающего остаётся прежней. Прочитанный мир,
  // сузивший лестницу или терминал, сужает их и здесь, как на спавне. Слой,
  // не назвавший клетке ни лестницы, ни терминала (пустой или оборванный
  // probes.toml), -- не сужение, а потеря слоя: привязка тоже остаётся.
  if (world.probesUnread || adm.unavailable) return
  if (!info.ladder.length && !term.model) return
  let rungEffort = info.rungEffort
  let effortBad = info.effortBad
  if (term.effort && modelKeyed(rungEffort, term.model) === undefined) rungEffort = Object.assign({}, rungEffort, { [term.model]: term.effort })
  if (term.effortBad && modelKeyed(effortBad, term.model) === undefined) effortBad = Object.assign({}, effortBad, { [term.model]: term.effortBad })
  bind.ladder = adm.ladder
  bind.rungEffort = rungEffort
  bind.effortBad = effortBad
  bind.rungsDropped = info.rungsDropped
  bind.source = info.source
  bind.allowedSrc = world.allowedSrc
  bind.terminal = term.model
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

// CONSTRAINT: дверь сброса -- для тестового стенда (новый хост моделирует новый процесс).
export function hostMemoReset(): void { envMemo = null; worldMemo = null; allowedMemo = null }

export function sessionExecutorsReset(): void {
  sessionExecutorModels.length = 0
  sessionExecutorModelsOverflow = false
  sessionReviewerServed.clear()
  sessionReviewerServedGen++
}

// CONSTRAINT (#509-FIX7 Р13): кто обслуживает проверяющих сессии -- агент ->
// {модель, момент}: объявленная на спавне, модель ступени на каждом ok-шаге.
// Потолок 64 агента, вытесняется старейший по t. План проверяющего вычитает из
// СТУПЕНЕЙ модели других проверяющих не старше REVIEWER_LIVE_MS; объявленная
// модель самого агента не вычитается.
export const REVIEWER_LIVE_MS = 2 * 3600 * 1000
export const SESSION_REVIEWER_SERVED_CAP = 64
// CONSTRAINT (#509-FIX8f Р1): prevRec -- запись, которую заменил резерв (только
// у резерва); cancelled -- резерв снят restore. Снятый узел держится, пока на
// него ссылается более новый неурегулированный резерв того же агента;
// урегулирование самого нового резерва освобождает цепочку.
type ReviewerServedRec = { model: string; t: number; seq: number; gen: number; prevRec?: ReviewerServedRec; cancelled?: boolean }
const sessionReviewerServed = new Map<string, ReviewerServedRec>()
// CONSTRAINT (#509-FIX8c Р4): владелец записи -- seq постановки, не (модель, t):
// два перекрывающихся шага одного агента на той же модели в тот же момент различимы.
let sessionReviewerServedSeq = 0
// CONSTRAINT (#509-FIX8g): поколение реестра растёт на каждом sessionExecutorsReset; запись несёт поколение своей постановки.
let sessionReviewerServedGen = 0

// CONSTRAINT (#509-FIX8f Р5): реестр держит SESSION_REVIEWER_SERVED_CAP самых
// свежих по t и хранится в порядке возрастания t (сортировка устойчива: при
// равном t раньше вытесняется поставленная раньше); вытесненные -- наружу.
// CONSTRAINT (#509-FIX8h Р4): запись keep -- только что поставленная этим же
// вызовом -- не вытесняется, какой бы старой по t она ни была: часы не обязаны
// быть монотонными.
function sessionReviewerServedTrim(keep: string): Array<[string, ReviewerServedRec]> {
  const rows = Array.from(sessionReviewerServed.entries())
  rows.sort((a, b) => a[1].t - b[1].t)
  sessionReviewerServed.clear()
  let drop = rows.length - SESSION_REVIEWER_SERVED_CAP
  const evicted: Array<[string, ReviewerServedRec]> = []
  for (let i = 0; i < rows.length; i++) {
    if (drop > 0 && rows[i][0] !== keep) { evicted.push(rows[i]); drop-- }
    else sessionReviewerServed.set(rows[i][0], rows[i][1])
  }
  return evicted
}

export function sessionReviewerServedSet(agentId: string, model: string, t: number, opts?: { reserve?: boolean }): Array<[string, ReviewerServedRec]> {
  const id = String(agentId || "")
  const m = String(model || "")
  if (!id || !m) return []
  const rec: ReviewerServedRec = { model: m, t, seq: ++sessionReviewerServedSeq, gen: sessionReviewerServedGen }
  if (opts && opts.reserve) {
    const before = sessionReviewerServed.get(id)
    if (before) rec.prevRec = before
  }
  sessionReviewerServed.delete(id)
  sessionReviewerServed.set(id, rec)
  return sessionReviewerServedTrim(id)
}

export function sessionReviewerServedGenOf(): number {
  return sessionReviewerServedGen
}

export function sessionReviewerServedGet(agentId: string): ReviewerServedRec | undefined {
  return sessionReviewerServed.get(String(agentId || ""))
}

function reviewerServedLive(rec: ReviewerServedRec | undefined): ReviewerServedRec | undefined {
  let p = rec
  while (p && p.cancelled) p = p.prevRec
  return p
}

// CONSTRAINT (#509-FIX8 Р4, #509-FIX8c Р4/Р7, #509-FIX8f Р1/Р5): restore
// первым делом помечает резерв снятым -- и при своём seq, и при чужом: чужой
// резерв, заменивший этот, иначе вернул бы его мёртвым. Свой seq -- встаёт
// первая неснятая запись цепочки prevRec, её нет -- запись удаляется. Затем при
// любом seq обратно встают записи, вытесненные постановкой резерва (снятый
// резерв -- первой неснятой записью своей цепочки), если их id в реестре нет и
// они не старше REVIEWER_LIVE_MS на момент резерва; реестр перестраивается по t
// и обрезается до потолка.
export function sessionReviewerServedRestore(agentId: string, reserved: ReviewerServedRec, evicted: Array<[string, ReviewerServedRec]>): void {
  const id = String(agentId || "")
  reserved.cancelled = true
  // CONSTRAINT (#509-FIX8g): резерв прошлого поколения (реестр сброшен новой сессией) ничего не возвращает -- ни своей записи, ни вытесненных.
  if (reserved.gen !== sessionReviewerServedGen) return
  const cur = sessionReviewerServed.get(id)
  const own = !!cur && cur.seq === reserved.seq
  let back: ReviewerServedRec | undefined = undefined
  if (own) {
    back = reviewerServedLive(reserved.prevRec)
    if (back) sessionReviewerServed.set(id, back)
    else sessionReviewerServed.delete(id)
  }
  for (let i = 0; i < evicted.length; i++) {
    const k = evicted[i][0]
    const rec = reviewerServedLive(evicted[i][1])
    if (rec && !sessionReviewerServed.has(k) && reserved.t - rec.t <= REVIEWER_LIVE_MS) sessionReviewerServed.set(k, rec)
  }
  sessionReviewerServedTrim(back ? id : "")
}

export function sessionReviewersServedByOthers(agentId: string, atMs: number): string[] {
  const id = String(agentId || "")
  const out: string[] = []
  sessionReviewerServed.forEach((r, k) => {
    if (k === id || !(atMs - r.t <= REVIEWER_LIVE_MS)) return
    const n = normModelId(r.model)
    if (n && out.indexOf(n) < 0) out.push(n)
  })
  return out
}

// CONSTRAINT (#509-FIX9 R7): завершённый агент (терминальный статус в списке
// agent.list) освобождает свою запись раньше REVIEWER_LIVE_MS -- только запись,
// поставленную ДО запроса списка (seq не больше seqBefore): запись позже --
// шаг возобновлённого агента, список её не видел.
export function sessionReviewerServedRelease(agentId: string, seqBefore: number): boolean {
  const id = String(agentId || "")
  const cur = sessionReviewerServed.get(id)
  if (!cur || cur.seq > seqBefore) return false
  sessionReviewerServed.delete(id)
  return true
}

export function sessionReviewerServedSeqOf(): number {
  return sessionReviewerServedSeq
}

// CONSTRAINT (#509-FIX9 R7): тику нужен список агентов, пока в реестре есть
// запись не старше REVIEWER_LIVE_MS -- её некому снять раньше срока, кроме тика.
export function sessionReviewerServedLiveAt(atMs: number): boolean {
  let live = false
  sessionReviewerServed.forEach((r) => { if (atMs - r.t <= REVIEWER_LIVE_MS) live = true })
  return live
}

// CONSTRAINT (#509-FIX3 M4): накопитель и проверка -- по нормализованному id с
// обеих сторон: исполнитель «X[1m]» и терминал «x» -- одна модель.
export function sessionExecutorModelAdd(model: string): void {
  const m = normModelId(model)
  if (!m || sessionExecutorModels.indexOf(m) >= 0) return
  if (sessionExecutorModels.length >= SESSION_EXECUTOR_MODELS_CAP) {
    sessionExecutorModelsOverflow = true
    return
  }
  sessionExecutorModels.push(m)
}

export function sessionExecutorHas(model: string): boolean {
  const m = normModelId(model)
  return !!m && sessionExecutorModels.indexOf(m) >= 0
}

// CONSTRAINT (#489-B1-FIX5 Z13.4): второй аргумент -- Булево refusal, а не res:
// isCarrierRefusal читает поля ответа, и на попытку он вычисляется ОДИН раз
// вызывающим; предикат обязан оставаться чистым от чтений хостового объекта.
export function failoverWouldSetSticky(didThrow: boolean, refusal: boolean, reviewer: boolean, model: string, terminalAttempt: boolean): boolean {
  if (terminalAttempt) return false
  return !didThrow && !refusal && !(reviewer && sessionExecutorHas(model))
}

// CONSTRAINT: период свёртки 1000 мс. Таймер не переживает смерть процесса,
// поэтому хвост накопленных скучных шагов теряется; типичный turn.step --
// вызов модели (секунды), 1 с ограничивает потерю меньше одного шага.
// Нулевой агрегат файла не пишет: короткий период сам по себе шардов не плодит.
export const FAILOVER_FOLD_PERIOD_MS = 1000

// CONSTRAINT: повтор взвода после отказа часов держится окном от момента
// отказа; без окна каждый шаг часового колбэка бил бы в отказавший clock.every.
export const FOLD_ARM_RETRY_MS = 60000
// CONSTRAINT: стоящие часы не держат окно вечно -- после стольких пропущенных вызовов взвод повторяется.
export const FOLD_ARM_RETRY_CALLS = 64

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
let foldArmFailed = false
let foldArmFailedAt = 0
let foldArmSkips = 0
// CONSTRAINT: таймер, чью отмену хост отказал, после сброса инертен: колбэк
// сверяет поколение.
let foldGen = 0
let foldSid = ""
let foldWriteErr = ""
let foldSplitLost = 0
let foldResetLost = 0
let foldWriteErrCut = 0
let foldLostFrom: string[] = []
let foldLostFromMore = 0

export function failoverFoldCount(): number {
  return boringN
}

export function failoverFoldWriteErr(): string {
  return foldWriteErr
}

export function failoverFoldSplitLost(): number {
  return foldSplitLost
}

export function failoverFoldResetLost(): number {
  return foldResetLost
}

const FOLD_ERR_CAP = 720
const FOLD_LOST_FROM_CAP = 16

// CONSTRAINT: текст ошибок свёртки держит голову (новое) и режет старое; отрезанное не молчит -- число отброшенных символов копится в foldWriteErrCut и едет записью.
function joinFoldErr(parts: string[]): { text: string; cut: number } {
  const all = parts.filter(s => !!s).join(" | ")
  if (all.length <= FOLD_ERR_CAP) return { text: all, cut: 0 }
  return { text: all.slice(0, FOLD_ERR_CAP), cut: all.length - FOLD_ERR_CAP }
}

// CONSTRAINT: "" -- только foldSid до первого наблюдения: при старте модуля и после сброса (`failoverFoldReset`); потери в состоянии при нём уже помечены прежним сбросом или хвостом, поэтому "" пропускается и в lostFromMore не идёт; «sid неизвестен» -- SID_UNAVAILABLE, не "".
function addLostFrom(sids: any[], more: number): void {
  for (const s0 of sids) {
    const s = String(s0 || "")
    if (!s || foldLostFrom.indexOf(s) >= 0) continue
    if (foldLostFrom.length < FOLD_LOST_FROM_CAP) foldLostFrom.push(s)
    else foldLostFromMore++
  }
  foldLostFromMore += num(more, 0, 0)
}

type FoldCarry = { split: number; reset: number; err: string; cut: number; from: string[]; fromMore: number }

function takeFoldCarry(): FoldCarry {
  const c: FoldCarry = { split: foldSplitLost, reset: foldResetLost, err: foldWriteErr, cut: foldWriteErrCut, from: foldLostFrom, fromMore: foldLostFromMore }
  foldSplitLost = 0
  foldResetLost = 0
  foldWriteErr = ""
  foldWriteErrCut = 0
  foldLostFrom = []
  foldLostFromMore = 0
  return c
}

function putFoldCarry(rec: any, c: FoldCarry): void {
  if (c.err) rec.foldWriteErr = c.err
  if (c.cut) rec.foldWriteErrCut = c.cut
  if (c.split) rec.foldSplitLost = c.split
  if (c.reset) rec.foldResetLost = c.reset
  if (c.from.length) rec.lostFrom = c.from.slice()
  if (c.fromMore) rec.lostFromMore = c.fromMore
}

// CONSTRAINT: возврат забранного: новый отказ впереди, затем то, что успело накопиться за время записи, затем забранное; steps/stepsSid -- шаги старой свёртки (чужой sid) при отказе записи после сброса; msgCut -- символы сообщения отказа, отрезанные до 240 у вызывающего.
function returnFoldCarry(c: FoldCarry, msg: string, steps: number, stepsSid: string, msgCut: number): void {
  foldSplitLost += c.split
  foldResetLost += c.reset + num(steps, 0, 0)
  const j = joinFoldErr([msg, foldWriteErr, c.err])
  foldWriteErr = j.text
  foldWriteErrCut += c.cut + j.cut + num(msgCut, 0, 0)
  addLostFrom(c.from, c.fromMore)
  if (steps > 0) addLostFrom([stepsSid], 0)
}

// CONSTRAINT: неписаный хвост сброса не теряет содержимое: его шаги уезжают счётом foldResetLost (в boringN не вливаются -- чужой sid) с происхождением lostFrom, потери, ошибка хвоста и отрезанное возвращаются в состояние; доставка -- следующей записью свёртки или хвостом следующего сброса.
export function failoverFoldTailLost(rec: any, x: any): void {
  const full = safeText(x)
  returnFoldCarry(
    {
      split: num(rec && rec.foldSplitLost, 0, 0),
      reset: num(rec && rec.foldResetLost, 0, 0),
      err: rec && rec.foldWriteErr ? String(rec.foldWriteErr) : "",
      cut: num(rec && rec.foldWriteErrCut, 0, 0),
      from: rec && Array.isArray(rec.lostFrom) ? rec.lostFrom : [],
      fromMore: num(rec && rec.lostFromMore, 0, 0),
    },
    full.slice(0, 240),
    num(rec && rec.n, 0, 0),
    rec && rec.sid ? String(rec.sid) : "",
    Math.max(0, full.length - 240),
  )
}

export function failoverFoldNote(tMs: number, sticky?: string, aid?: string): void {
  boringN++
  if (!boringT0) boringT0 = tMs
  boringT1 = tMs
  if (sticky && !boringSticky) boringSticky = String(sticky)
  const a = String(aid || "")
  if (a) boringAgents.set(a, (boringAgents.get(a) || 0) + 1)
}

function foldRecord(n: number, t0: number, t1: number, sticky: string, agents: Map<string, number>, sid: string): any {
  foldSeq++
  const recKey = "agg-" + String(foldSeq) + "-" + String(t0) + "-" + String(n)
  const rec: any = {
    t: isoOf(t1),
    rec: recKey,
    fold: true,
    n,
    sticky,
    tFirst: isoOf(t0),
    tLast: isoOf(t1),
    dtMs: t1 - t0,
    carrier: "mod",
    probe: "failover",
    sid,
  }
  if (agents.size) rec.agents = Object.fromEntries(agents)
  return rec
}

export function failoverFoldReset(): { rec: any; world: any } | null {
  const waiters = foldWait
  // CONSTRAINT: накопленный хвост -- та же запись свёртки (тот же строитель),
  // но с resetTail: сброс не молчит о несказанном окне, запись уезжает вызывающему.
  let tail: { rec: any; world: any } | null = null
  if (boringN > 0) {
    tail = { rec: foldRecord(boringN, boringT0, boringT1, boringSticky, boringAgents, foldSid), world: foldWorld }
    tail.rec.resetTail = true
    putFoldCarry(tail.rec, takeFoldCarry())
  } else if (foldWriteErr || foldSplitLost || foldResetLost) {
    // CONSTRAINT: без шагов хвоста нет: недоставленное остаётся в состоянии и уедет записью новой сессии -- с происхождением прежней.
    addLostFrom([foldSid], 0)
  }
  foldGen++
  boringN = 0
  boringT0 = 0
  boringT1 = 0
  boringSticky = ""
  boringAgents = new Map()
  foldBusy = false
  foldWait = []
  foldWorld = null
  foldSid = ""
  foldArmFailed = false
  foldArmFailedAt = 0
  foldArmSkips = 0
  if (foldTimer) {
    try { foldTimer.cancel() } catch (x) { noteLost("failover-fold-timer-cancel", x) }
    foldTimer = null
  }
  // CONSTRAINT: сброс не бросает ожидающих: их резолверы были взяты из
  // СТАРОГО foldWait, и без пробуждения здесь ожидание висело бы вечно.
  for (let i = 0; i < waiters.length; i++) waiters[i]()
  return tail
}

export function failoverAttemptIsBoring(rec: any, stickyChanged: boolean): boolean {
  if (!rec || rec.outcome !== "ok") return false
  if (Number(rec.attempt) !== 0) return false
  if (stickyChanged) return false
  if (rec.ladderFullTaken) return false
  if (rec.terminal) return false
  if (rec.startMatch) return false
  if (rec.stickyDropped) return false
  if (rec.execOverflow) return false
  if (num(rec.rungsFiltered, 0, 0) > 0) return false
  if (num(rec.rungsFilteredReviewer, 0, 0) > 0) return false
  if (num(rec.rungsDropped, 0, 0) > 0) return false
  const ks = Object.keys(rec)
  for (let i = 0; i < ks.length; i++) {
    if (ks[i].indexOf("effortBad_") === 0) return false
  }
  return true
}

export function armFailoverFoldTimer($: any, world: any, tMs: number): void {
  if (world) foldWorld = world
  if (foldTimer) return
  // CONSTRAINT: отказ часов учитывается один раз на окно, не на каждый шаг; отказ в момент 0 окно держит (флаг, не время); откат часов за момент отказа окно снимает; нечисловое время окно меряет только счётом пропусков.
  if (foldArmFailed) {
    const timed = Number.isFinite(tMs) && Number.isFinite(foldArmFailedAt)
    const inWindow = timed ? tMs >= foldArmFailedAt && tMs - foldArmFailedAt < FOLD_ARM_RETRY_MS : true
    if (inWindow && foldArmSkips < FOLD_ARM_RETRY_CALLS) {
      foldArmSkips++
      return
    }
  }
  try {
    const gen = foldGen
    const h = $.clock.every(FAILOVER_FOLD_PERIOD_MS, async () => {
      if (gen !== foldGen) return
      // CONSTRAINT: своё состояние по отказу записи ставит failoverFoldFlush
      // в СВОЁМ поколении (перед броском); здесь после await поколение могло
      // смениться, и запись в catch относила бы ошибку чужой сессии к новой.
      try { await failoverFoldFlush($, foldWorld) } catch (x) {
        noteLost("failover-fold-timer-flush", x, $)
      }
    })
    // CONSTRAINT: ручка без cancel видима как потеря -- молчаливая пустышка
    // делала бы таймер «стоящим» без возможности снять или узнать об этом.
    if (h && typeof h.cancel === "function") foldTimer = h
    else {
      foldTimer = { cancel() {} }
      noteLost("failover-fold-timer-handle", new Error("clock.every returned no cancel"), $)
    }
    foldArmFailed = false
    foldArmFailedAt = 0
    foldArmSkips = 0
  } catch (x) {
    // CONSTRAINT: пустышка здесь запрещена: она гасила бы повтор попытки до
    // конца сессии -- foldTimer = null даёт следующему вызову новую попытку.
    foldTimer = null
    foldArmFailed = true
    foldArmFailedAt = tMs
    foldArmSkips = 0
    noteLost("failover-fold-timer-arm", x, $)
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
  const gen = foldGen
  const s = String(sticky || "")
  if (boringN > 0 && boringSticky && s && boringSticky !== s) {
    try {
      await failoverFoldFlush($, world)
    } catch (x) {
      // CONSTRAINT: шаг с новой липкостью нельзя влить в возвращённый снимок
      // старого окна. Потеря считается и уезжает в следующую запись полем
      // foldSplitLost -- пишется только при n>0 (отсутствие поля ≠ ноль).
      if (gen === foldGen) foldSplitLost++
      else noteLost("failover-fold-stale-split", x, $)
      throw x
    }
  }
  if (gen !== foldGen) {
    noteLost("failover-fold-stale-attempt", new Error("attempt of a reset session"), $)
    return
  }
  failoverFoldNote(tMs, s, aid)
  foldSid = sid
  if (s) boringSticky = s
}

export async function failoverFoldFlush($: any, world: any): Promise<void> {
  // CONSTRAINT: сброс сессии меняет поколение; запись, начатая до сброса, не
  // трогает состояние новой сессии, а её отказ учитывается как потерянный.
  const gen = foldGen
  while (foldBusy) {
    await new Promise<void>(r => { foldWait.push(r) })
    if (gen !== foldGen) return
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
    const rec = foldRecord(n, t0, t1, sticky, agents, sid)
    // CONSTRAINT: недоставленное забирается в запись при отправке и возвращается только отказом: каждая единица потери живёт ровно в одном месте -- в состоянии или в одной записи в полёте; удача ничего не вычитает.
    const sent = takeFoldCarry()
    putFoldCarry(rec, sent)
    try {
      await appendJournal($, jpath, rec)
    } catch (x) {
      const full = safeText(x)
      const msg = full.slice(0, 240)
      if (gen !== foldGen) {
        // CONSTRAINT: отказ записи, начатой до сброса: шаги старой свёртки уезжают счётом foldResetLost (чужой sid, в boringN не вливаются) с происхождением, забранное возвращается -- правило хвоста сброса.
        noteLost("failover-fold-stale", x, $)
        returnFoldCarry(sent, msg, n, sid, Math.max(0, full.length - 240))
        return
      }
      restoreFoldSnapshot(n, t0, t1, sticky, agents)
      returnFoldCarry(sent, msg, 0, "", Math.max(0, full.length - 240))
      throw x
    }
  } finally {
    if (gen === foldGen) {
      foldBusy = false
      const nxt = foldWait.shift()
      if (nxt) nxt()
    }
  }
}

function newSession($: any): { rec: any; world: any } | null {
  epoch++
  capEpochPrune()
  sidMemo = null
  worldMemo = null
  envMemo = null
  probeHear = null
  probeHearAgentTool = false
  probeNotMain = []
  allowedMemo = null
  promptTextMemo = {}
  rxCache = {}
  clockBad = false
  sweepDone = false
  sweepFailed = false
  sweepFailedAt = 0
  sweepSkips = 0
  sweepRunning = false
  sweepGen++
  staleAgents.clear()
  staleNudgedAt.clear()
  staleLastSubmitAt = null
  staleFlyAt = null
  probeSessionReset($)
  failoverBindReset()
  sessionExecutorsReset()
  return failoverFoldReset()
}

function formKind(p: string, t: string, c: any): string | null {
  const path = String(p ?? "")
  const text = String(t ?? "")
  if (K(c.brief_path, "u", "brief_path").test(path)) {
    if (!text || K(c.brief_head, "iu", "brief_head").test(text.split("\n")[0])) return "brief"
  }
  if (K(c.report_path, "u", "report_path").test(path)) return "report"
  return null
}

async function formEval(ev: any, c: any): Promise<{ refuse: any[]; warn: any[] }> {
  const W: any = { A4: 1, C2: 1 }
  const Rf: any[] = []
  const Wr: any[] = []
  const F = (cl: string, n: number, q: string) => (W[cl] ? Wr : Rf).push({ c: cl, n, q: clip(q, 160) })
  const t = String(ev.text ?? "")
  const ls = t.split("\n")
  let inn = false
  const op = ls.map((l: string) => {
    if (K(c.fence, "u", "fence").test(l)) { inn = !inn; return false }
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
      else if (K(c.arm_line, "u", "arm_line").test(ls[i]))
        cs2 = [...ls[i].matchAll(/`([^`]*)`/g)].map((m) => m[1])
      for (let j = 0; j < cs2.length; j++) {
        let b = cs2[j], el = false
        if (K(c.arm_ellipsis, "u", "arm_ellipsis").test(b)) {
          el = true
          b = b.replace(K(c.arm_ellipsis, "u", "arm_ellipsis"), "")
        }
        if (!K(c.arm_cmd, "u", "arm_cmd").test(b)) continue
        ac++
        if (el || !K(c.arm_remote, "u", "arm_remote").test(b) || !K(c.arm_log, "u", "arm_log").test(b))
          F("A2", i + 1, cs2[j])
      }
    }
    if (ac && !K(c.witness_remote, "iu", "witness_remote").test(t))
      F("A2", 0, "арма есть, свидетель [RCH] remote не назван")
    if (K(c.witness_worker, "u", "witness_worker").test(t)) {
      for (let i = 0; i < ls.length; i++)
        if (K(c.witness_worker, "u", "witness_worker").test(ls[i])) { F("A2", i + 1, ls[i]); break }
    }
    // CONSTRAINT (#391): собранный из ДВУХ полей образец называет оба -- иначе
    // оператор не знает, которое из них он сломал.
    let a3: RegExp
    try {
      a3 = new RegExp("(?<!(?:" + c.negation + ")\\s{0,16})(?:" + c.open_door + ")", "iu")
    } catch (x) {
      throw new Error(
        "негодный образец конфига форм (negation|open_door): " +
        String(c.negation).slice(0, 32) + " | " + String(c.open_door).slice(0, 32))
    }
    for (let i = 0; i < ls.length; i++) {
      if (op[i] && a3.test(ls[i])) F("A3", i + 1, ls[i])
    }
    let pc = 0, rl = false
    for (let i = 0; i < ls.length; i++) {
      if (K(c.path_line, "u", "path_line").test(ls[i])) pc++
      if (K(c.rule_line, "iu", "rule_line").test(ls[i])) rl = true
    }
    if (pc >= c.path_lines_min && !rl)
      F("A4", 0, "строк-путей " + pc + ", строчки правила нет")
  }
  if (ev.kind === "report" || ev.kind === "message") {
    for (let i = 0; i < ls.length; i++) {
      if (op[i] && K(c.legalize, "iu", "legalize").test(ls[i])) { F("C1", i + 1, ls[i]); break }
    }
    if (K(c.witness_worker, "u", "witness_worker").test(t) && !K(c.witness_remote, "iu", "witness_remote").test(t)) {
      for (let i = 0; i < ls.length; i++)
        if (K(c.witness_worker, "u", "witness_worker").test(ls[i])) { F("C2", i + 1, ls[i]); break }
    }
  }
  if (ev.kind === "message") {
    let h = -1
    for (let i = 0; i < ls.length; i++) if (ls[i].trim()) { h = i; break }
    if (h >= 0 && K(c.decision_head, "u", "decision_head").test(ls[h]) &&
        (!K(c.decision_basis, "iu", "decision_basis").test(t) || !K(c.decision_referent, "iu", "decision_referent").test(t)))
      F("B", h + 1, ls[h])
  }
  if (ev.kind === "command") {
    // CONSTRAINT: message values, pathspecs and redirection targets are not
    // options. Nested executable text remains subject to the three-level bound.
    // CONSTRAINT (#494 FIX10): вложенный текст (тело исполняемого heredoc, строка
    // в кавычках вне данных и вне сообщения живого commit) судится рекурсивно как
    // своя команда: `bash -c "echo --only ; git commit"` — две команды, а не одна.
    // Глубже трёх уровней суд не идёт, и это отказ, не пропуск.
    const judge = async (tx: string, lvl: number): Promise<void> => {
      if (ev.sources) {
        const issues: any[] = []
        const variants = formExpand(tx, ev.sources, issues, [], 0, lvl)
        for (const issue of issues) F(issue.c, issue.n, issue.q)
        if (variants.some(v => v !== tx)) { for (const variant of variants) await judge(variant, lvl); return }
      }
      const gc = [...tx.matchAll(K(c.git_commit, "gu", "git_commit"))].map((m) => m.index as number)
      const scan = shellScan(tx)
      const calls = gitCalls(tx, scan, ev.cwd || "", ev.home || "")
      const tokAll = [...new Set(calls.filter(g => g.sub === "commit" || g.sub === "unknown").map(g => g.at))]
      // CONSTRAINT (#494 FIX10c): слова не заходят в инертный текст, а регулярка не
      // видит `"git" commit`, `g\it commit`, `git -C . commit` — кавычка или тело
      // heredoc, чей текст как команда несёт коммит, даёт попадание внутри себя,
      // и дальше идёт путь попаданий регулярки (данные, сообщение, вложение).
      const hidden: number[] = []
      const inRegion = (rs: number, re: number): boolean =>
        gc.some((g) => g >= rs && g < re) || tokAll.some((w) => w >= rs && w < re)
      for (let qi = 0; qi < scan.quotes.length; qi++) {
        const q = scan.quotes[qi]
        if (inRegion(q.s, q.e) || !gitSubDeep(q.text, "commit", 0)) continue
        let p = q.s + 1
        while (p < q.e && !(scan.inert(p) && scan.quoteAt(p) === q)) p++
        if (p < q.e) hidden.push(p)
      }
      for (let hi = 0; hi < scan.heredocs.length; hi++) {
        const h = scan.heredocs[hi]
        if (h.bodyStart >= h.bodyEnd || inRegion(h.bodyStart, h.bodyEnd)) continue
        if (gitSubDeep(h.body, "commit", 0)) hidden.push(h.bodyStart)
      }
      gc.push(...hidden)
      const pushAt: number[] = []
      const addPush = (p: number): void => { if (pushAt.indexOf(p) < 0) pushAt.push(p) }
      for (const m of tx.matchAll(K(c.git_push, "gu", "git_push"))) addPush(m.index as number)
      const pushTok = gitSubWords(tx, scan, "push")
      for (let k = 0; k < pushTok.length; k++) addPush(pushTok[k])
      const inPush = (rs: number, re: number): boolean => pushAt.some((g) => g >= rs && g < re)
      for (let qi = 0; qi < scan.quotes.length; qi++) {
        const q = scan.quotes[qi]
        if (inPush(q.s, q.e) || !gitSubDeep(q.text, "push", 0)) continue
        let p = q.s + 1
        while (p < q.e && !(scan.inert(p) && scan.quoteAt(p) === q)) p++
        if (p < q.e) addPush(p)
      }
      for (let hi = 0; hi < scan.heredocs.length; hi++) {
        const h = scan.heredocs[hi]
        if (h.bodyStart >= h.bodyEnd || inPush(h.bodyStart, h.bodyEnd)) continue
        if (gitSubDeep(h.body, "push", 0)) addPush(h.bodyStart)
      }
      if (!gc.length && !tokAll.length && !pushAt.length) return
      const commitSeen = new Set<number>()
      const bodyOf = (at: number): Heredoc | undefined =>
        scan.heredocs.find((h) => h.bodyStart <= at && at < h.bodyEnd)
      const masked = (s: number, e: number): string => {
        let r = ""
        for (let q = s; q < e; q++) r += scan.inert(q) ? " " : tx[q]
        return r
      }
      const writesOut = (s: number, e: number, fid: number): boolean => {
        for (let p = s; p < e; p++) {
          if (tx[p] !== ">" || scan.inert(p) || scan.frameOf(p) !== fid) continue
          let q = p + 1
          if (tx[q] === ">" || tx[q] === "|") q++
          if (tx[q] === "&") {
            if (/[0-9-]/.test(tx[q + 1] ?? "")) continue
            q++
          }
          while (tx[q] === " " || tx[q] === "\t") q++
          const w = (/^[^\s<>|;&()]*/.exec(tx.slice(q, e)) as RegExpExecArray)[0]
          if (SAFE_SINKS.indexOf(w) < 0) return true
        }
        return false
      }
      const dataCmd = (s: number, e: number, fid: number, parent: boolean): boolean => {
        const seg = tx.slice(s, e)
        const w = cmdWord(seg)
        if (DATA_CMDS.indexOf(w) < 0 && !(parent && SUBST_PARENTS.indexOf(w) >= 0)) return false
        if (funcDef(seg)) return false
        const m = masked(s, e)
        if (w === "printf" && /(?<!\S)-v/.test(m)) return false
        if (w === "rg" && /(?<!\S)--pre(?:=|\s|$)/.test(m)) return false
        return !writesOut(s, e, fid)
      }
      // CONSTRAINT (#494 FIX10 F3): вывод команды в рамке подстановки — данные,
      // только если рамка стоит аргументом (не первым словом и не значением
      // присваивания) команды, которая сама данные по той же цепочке.
      const argPos = (open: number): boolean => {
        const [ps] = scan.cmdOf(open)
        return /^[^\s<>|;&()]+\s/.test(cmdHead(tx.slice(ps, open)))
      }
      const dataChain = (at: number, parent: boolean): boolean => {
        const [s, e] = scan.cmdOf(at)
        const fid = scan.frameOf(at)
        if (!dataCmd(s, e, fid, parent)) return false
        if (tx[e] === "|" && tx[e + 1] !== "|" && !dataChain(tx[e + 1] === "&" ? e + 2 : e + 1, false)) return false
        if (fid === 0) return true
        const open = scan.frames[fid].open
        return argPos(open) && dataChain(open, true)
      }
      const isData = (at: number): boolean => dataChain(at, false)
      const tok = tokAll.filter((w) => {
        const [ts] = scan.cmdOf(w)
        return !gc.some((g) => !scan.inert(g) && !scan.comment(g) && scan.cmdOf(g)[0] === ts)
      })
      const live = gc.filter((g) => !scan.inert(g) && !scan.comment(g) && !bodyOf(g) && !isData(g))
        .concat(tok.filter((w) => !isData(w)))
      const liveIn = (s: number, e: number): boolean => live.some((g) => g >= s && g < e)
      const nested: Heredoc[] = []
      const nestedQ: ShellQuote[] = []
      const entries = gc.map((g) => ({ g, tk: false })).concat(tok.map((g) => ({ g, tk: true })))
      for (let gi = 0; gi < entries.length; gi++) {
        const { g, tk } = entries[gi]
        if (!tk && scan.comment(g)) continue
        const hb = tk ? undefined : bodyOf(g)
        if (hb) {
          const [hs, he] = scan.cmdOf(hb.op)
          if (!liveIn(hs, he) && !isData(hb.op) && nested.indexOf(hb) < 0) nested.push(hb)
          continue
        }
        if (isData(g)) continue
        const [s, e] = scan.cmdOf(g)
        const isLive = tk || !scan.inert(g)
        if (!isLive && liveIn(s, e)) continue
        if (!isLive) {
          const qa = scan.quoteAt(g)
          if (qa) {
            if (nestedQ.indexOf(qa) < 0) nestedQ.push(qa)
            continue
          }
        }
        if (commitSeen.has(s)) continue
        commitSeen.add(s)
        const own = scan.heredocs.filter(h => h.op >= s && h.op < e)
        for (const call of calls.filter(call => scan.cmdOf(call.at)[0] === s && call.sub !== "push")) {
          if (call.sub === "unknown") { F("F", 1, "git: subcommand not static"); continue }
          const parsed = gitOptions(call.args, "commit")
          if (!parsed.options.some(o => o.literal && K(c.git_commit_ok, "u", "git_commit_ok").test(o.name))) F("F", 1, "git commit: нет " + c.git_commit_ok)
          const parts: string[] = []
          let undeterminable = false
          for (const option of parsed.options) {
            const value = option.value
            if (["-C", "-c", "--reuse-message", "--reedit-message", "-e", "--edit", "-t", "--template", "--fixup", "--squash"].includes(option.name)) { undeterminable = true; continue }
            if (["-m", "--message"].includes(option.name)) {
              const bodies = value ? own.filter(h => h.op >= value.at && h.op < value.end) : []
              if (bodies.length) parts.push(bodies[bodies.length - 1].body)
              else if (value && !value.dyn) parts.push(value.text)
              else undeterminable = true
            }
            if (["-F", "--file"].includes(option.name)) {
              if (!value || value.dyn || value.glob) { undeterminable = true; continue }
              if (value.text === "-") {
                if (own.length) parts.push(own[own.length - 1].body)
                else undeterminable = true
              } else if (call.cwd !== null && ev.readMessage) {
                const got = await ev.readMessage(resolvePath(value.text, ev.home || "", call.cwd))
                if (got.text === null || got.unreadable) undeterminable = true
                else parts.push(got.text)
              } else undeterminable = true
            }
          }
          if (undeterminable || !parts.length) F("F", 1, "git commit: message undeterminable")
          const ct = parts.join("\n\n")
          if (ct) {
            const cm = ct.split("\n")
            let ia = -1, ib = -1
            for (let i = 0; i < cm.length; i++) {
              if (ia < 0 && K(c.trailer_a, "mu", "trailer_a").test(cm[i])) ia = i
              if (ib < 0 && K(c.trailer_b, "mu", "trailer_b").test(cm[i])) ib = i
            }
            if (ia >= 0 && ib >= 0 && Math.abs(ia - ib) !== 1) F("F", ia + 1, "трейлеры Session: и Co-Authored-By: не соседние")
          }
        }
      }
      // CONSTRAINT (#494 FIX10c): push судится по сегменту своей команды на каждом уровне, как commit; сырой текст всей команды давал ложный отказ на кавычке и чужом -f.
      const pushSeen: number[] = []
      for (let pi = 0; pi < pushAt.length; pi++) {
        const g = pushAt[pi]
        const tk = pushTok.indexOf(g) >= 0
        if (!tk && scan.comment(g)) continue
        const hb = tk ? undefined : bodyOf(g)
        if (hb) {
          const [hs, he] = scan.cmdOf(hb.op)
          if (!liveIn(hs, he) && !isData(hb.op) && nested.indexOf(hb) < 0) nested.push(hb)
          continue
        }
        if (isData(g)) continue
        const [s, e] = scan.cmdOf(g)
        if (!tk && scan.inert(g)) {
          if (liveIn(s, e)) continue
          const qa = scan.quoteAt(g)
          if (qa) {
            if (nestedQ.indexOf(qa) < 0) nestedQ.push(qa)
            continue
          }
        }
        if (pushSeen.indexOf(s) >= 0) continue
        pushSeen.push(s)
        for (const call of calls.filter(call => scan.cmdOf(call.at)[0] === s && call.sub === "push")) {
          const parsed = gitOptions(call.args, "push")
          const remote = parsed.positional[0]
          if (!remote || remote.dyn || remote.glob || parsed.positional.length < 2 || !parsed.positional.slice(1).every(w => !w.dyn && !w.glob && K(c.git_push_ok, "u", "git_push_ok").test(remote.text + " " + w.text)) || parsed.options.some(o => ["--mirror", "--delete", "-d", "--all", "--tags"].includes(o.name))) F("F", 1, "git push: нет " + c.git_push_ok)
          if (parsed.options.some(o => o.literal && K(c.git_force, "u", "git_force").test(o.name))) F("F", 1, tx.slice(s, e))
        }
      }
      const inner = nested.map((h) => h.body).concat(nestedQ.map((q) => q.text))
      if (lvl < 3) for (let k = 0; k < inner.length; k++) await judge(inner[k], lvl + 1)
      else if (inner.length) F("F", 1, "git: вложение глубже 3 уровней не судится")
    }
    await judge(t, 0)
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

// CONSTRAINT (#393): отказ ЧТЕНИЯ ручки и «ручка не закреплена» обязаны быть
// различимы: до этой волны пустой catch приравнивал отказ к пустому значению,
// а пустое значение -- законное «не задано». Отказы собираются в UNREADABLE
// ИМЕНАМИ (значения учётки не печатаются никогда), отсортированными.
async function envBundle($: any): Promise<any> {
  // CONSTRAINT: env names are string literals. A computed name at $.env.get
  // is not a loadable site — new consultants switch from toml `enabled`,
  // plus CLAUDE_PROBES for the non-splice ids.
  const unreadable: string[] = []
  let JUDGE_CARRIER: any = ""
  try { JUDGE_CARRIER = await $.env.get("CLAUDE_JUDGE_CARRIER") } catch (x) { unreadable.push("CLAUDE_JUDGE_CARRIER") }
  let JUDGE: any = ""
  try { JUDGE = await $.env.get("CLAUDE_JUDGE") } catch (x) { unreadable.push("CLAUDE_JUDGE") }
  let JUDGE_MODEL: any = ""
  try { JUDGE_MODEL = await $.env.get("CLAUDE_JUDGE_MODEL") } catch (x) { unreadable.push("CLAUDE_JUDGE_MODEL") }
  let JUDGE_PROMPT: any = ""
  try { JUDGE_PROMPT = await $.env.get("CLAUDE_JUDGE_PROMPT") } catch (x) { unreadable.push("CLAUDE_JUDGE_PROMPT") }
  let JUDGE_TIMEOUT: any = ""
  try { JUDGE_TIMEOUT = await $.env.get("CLAUDE_JUDGE_TIMEOUT_MS") } catch (x) { unreadable.push("CLAUDE_JUDGE_TIMEOUT_MS") }
  let FORM_CARRIER: any = ""
  try { FORM_CARRIER = await $.env.get("CLAUDE_FORM_CARRIER") } catch (x) { unreadable.push("CLAUDE_FORM_CARRIER") }
  let FORM: any = ""
  try { FORM = await $.env.get("CLAUDE_FORM") } catch (x) { unreadable.push("CLAUDE_FORM") }
  let IDLE_CARRIER: any = ""
  try { IDLE_CARRIER = await $.env.get("CLAUDE_IDLE_CARRIER") } catch (x) { unreadable.push("CLAUDE_IDLE_CARRIER") }
  let IDLE: any = ""
  try { IDLE = await $.env.get("CLAUDE_IDLE") } catch (x) { unreadable.push("CLAUDE_IDLE") }
  let PROBES: any = ""
  try { PROBES = await $.env.get("CLAUDE_PROBES") } catch (x) { unreadable.push("CLAUDE_PROBES") }
  let PROMPTS: any = ""
  try { PROMPTS = await $.env.get("CLAUDE_PROMPTS") } catch (x) { unreadable.push("CLAUDE_PROMPTS") }
  let PROBES_DIR: any = ""
  try { PROBES_DIR = await $.env.get("CLAUDE_PROBES_DIR") } catch (x) { unreadable.push("CLAUDE_PROBES_DIR") }
  let CONFIG_DIR: any = ""
  try { CONFIG_DIR = await $.env.get("CLAUDE_CONFIG_DIR") } catch (x) { unreadable.push("CLAUDE_CONFIG_DIR") }
  let HOME: any = ""
  try { HOME = await $.env.get("HOME") } catch (x) { unreadable.push("HOME") }
  let PWD: any = ""
  try { PWD = await $.env.get("PWD") } catch (x) { unreadable.push("PWD") }
  let ROUTING_TABLE: any = ""
  try { ROUTING_TABLE = await $.env.get("CATALYST_ROUTING_TABLE") } catch (x) { unreadable.push("CATALYST_ROUTING_TABLE") }
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
    UNREADABLE: unreadable.slice().sort(),
  }
}

// CONSTRAINT (#335): вооружение различается ТИПОМ, а не строкой-магией.
// Выключатель спрашивается РАНЬШЕ носителя: выключенная проба с чужой
// ручкой обязана молчать. ПУСТАЯ ручка носителя означает мод -- копия в
// патче снята, другого носителя нет; непустая и не «mod» -- чужой
// носитель, и такая конфигурация обязана отказать громко.
// CONSTRAINT (#393): НЕЧИТАЕМАЯ ручка (отказ чтения окружения) -- четвёртый
// исход: нечитаемый выключатель НЕ читается как «выключено», нечитаемый
// носитель -- как «мод»; состояние пробы неизвестно и отказывает громко.
type ArmState =
  | { state: "armed" }
  | { state: "off" }
  | { state: "foreign-carrier", probe: string, handle: string, value: string }
  | { state: "env-unreadable", probe: string, handle: string }

function armStateOf(p: any, env: any): ArmState {
  const unreadable = (handle: string): boolean =>
    Array.isArray(env.UNREADABLE) && env.UNREADABLE.indexOf(handle) >= 0
  const byCarrier = (field: string, handle: string, onHandle: string, on: boolean): ArmState => {
    if (unreadable(onHandle)) return { state: "env-unreadable", probe: String(p.id), handle: onHandle }
    if (!on) return { state: "off" }
    if (unreadable(handle)) return { state: "env-unreadable", probe: String(p.id), handle }
    const value = String(env[field] ?? "")
    const norm = value.trim().toLowerCase()
    if (norm !== "" && norm !== "mod") return { state: "foreign-carrier", probe: String(p.id), handle, value }
    return { state: "armed" }
  }
  if (p.id === "judge") return byCarrier("JUDGE_CARRIER", "CLAUDE_JUDGE_CARRIER", "CLAUDE_JUDGE", envOn(env.JUDGE))
  if (p.id === "form") return byCarrier("FORM_CARRIER", "CLAUDE_FORM_CARRIER", "CLAUDE_FORM", formOn(env.FORM))
  if (p.id === "idle-watch") return byCarrier("IDLE_CARRIER", "CLAUDE_IDLE_CARRIER", "CLAUDE_IDLE", envOn(env.IDLE))
  // Пробы без своей ручки носителя двузначны: носителя у них не спрашивают.
  if (unreadable("CLAUDE_PROBES")) return { state: "env-unreadable", probe: String(p.id), handle: "CLAUDE_PROBES" }
  return formOn(env.PROBES) ? { state: "armed" } : { state: "off" }
}

// CONSTRAINT (#335): отказ чужого носителя живёт В ТОЧКЕ ДЕЙСТВИЯ пробы --
// после области (mainLoopOnly), триггера (fire / список инструментов формы)
// и конфигурационного выключателя (enabled): выключенная конфигурацией проба
// -- тот же класс, что выключенная ручкой, о носителе она не кричит.
async function refuseForeignCarrier($: any, world: any, arm: any, t0: number, sid: string): Promise<string> {
  // CONSTRAINT: дедуп -- ТОЛЬКО у записи в журнал (один раз на процесс на
  // пару «проба x значение ручки»: цикл проб видит отказ на каждом вызове
  // инструмента). Текст отказа возвращается ВСЕГДА -- дедуп журнала не имеет
  // права перейти на отказ: второй и последующие вызовы гасятся так же.
  const saidKey = JSON.stringify([arm.probe, arm.handle, arm.value])
  if (!carrierForeignSaid.has(saidKey)) {
    carrierForeignSaid.add(saidKey)
    try {
      await appendJournal($, world.globalHome + "/failover/journal.jsonl", {
        t: isoOf(t0),
        sid,
        rec: "carrier-foreign-refused",
        probe: arm.probe,
        handle: arm.handle,
        value: arm.value,
      })
    } catch (x) {
      // CONSTRAINT: дедуп держит только УДАВШУЮСЯ запись: при отказе ключ снимается,
      // и следующий такой же отказ пишет строку снова.
      carrierForeignSaid.delete(saidKey)
      noteLost("journal-carrier-foreign", x, $)
    }
  }
  // CONSTRAINT: возврат вне try -- отказ выставляется и когда запись не легла
  // (appendJournal бросает): запись -- улика, отказ -- механизм.
  return "Вызов инструмента погашен: проба «" + arm.probe + "» включена, а назначенный ею носитель не существует. " +
    "Ручка " + arm.handle + " = «" + arm.value + "»; копия проб в патче снята, единственный носитель теперь мод. " +
    "Это НЕ гейт routing-table.toml. Починка: установите " + arm.handle + "=mod или снимите ручку -- " +
    "до исправления конфигурации гасится каждый вызов, на котором эта проба действует."
}

// CONSTRAINT (#393): отказ нечитаемой ручки живёт В ТОЧКЕ ДЕЙСТВИЯ пробы --
// та же граница, что у чужого носителя. Причина отказа ОБЯЗАНА отличаться от
// «чужой носитель»: это отказ чтения окружения, состояние вооружения пробы
// неизвестно, значения ручки нет и печатать нечего.
async function refuseEnvUnreadable($: any, world: any, arm: any, t0: number, sid: string): Promise<string> {
  // CONSTRAINT: дедуп -- ТОЛЬКО у записи в журнал (один раз на процесс на
  // пару «проба x ручка»). Текст отказа возвращается ВСЕГДА -- дедуп журнала
  // не имеет права перейти на отказ: второй и последующие вызовы гасятся
  // так же.
  const saidKey = JSON.stringify([arm.probe, arm.handle])
  if (!carrierEnvUnreadableSaid.has(saidKey)) {
    carrierEnvUnreadableSaid.add(saidKey)
    try {
      await appendJournal($, world.globalHome + "/failover/journal.jsonl", {
        t: isoOf(t0),
        sid,
        rec: "carrier-env-unreadable-refused",
        probe: arm.probe,
        handle: arm.handle,
      })
    } catch (x) {
      // CONSTRAINT: дедуп держит только УДАВШУЮСЯ запись: при отказе ключ снимается,
      // и следующий такой же отказ пишет строку снова.
      carrierEnvUnreadableSaid.delete(saidKey)
      noteLost("journal-carrier-env-unreadable", x, $)
    }
  }
  // CONSTRAINT: возврат вне try -- отказ выставляется и когда запись не легла
  // (appendJournal бросает): запись -- улика, отказ -- механизм.
  return "Вызов инструмента погашен: ручка " + arm.handle + " НЕ ПРОЧИТАНА -- отказ чтения окружения, " +
    "а не пустое значение и не чужой носитель. Состояние вооружения пробы «" + arm.probe + "» неизвестно: " +
    "нечитаемый выключатель не читается как «выключено», нечитаемый носитель -- как «мод». " +
    "Это НЕ гейт routing-table.toml. Починка: сделайте чтение ручки работающим -- " +
    "до исправления гасится каждый вызов, на котором эта проба действует."
}

// CONSTRAINT (#335, Ч2): поле carrier журнала несёт ФАКТИЧЕСКОГО носителя
// пробы -- нормализованное значение её ручки (пустое = мод), а не константу:
// запись, подписанная «mod» при чужой ручке, лжёт о том, кто работал.
function carrierOfJournal(p: any, env: any): string {
  const field = p.id === "judge" ? "JUDGE_CARRIER" : p.id === "form" ? "FORM_CARRIER" : p.id === "idle-watch" ? "IDLE_CARRIER" : ""
  if (!field) return "mod"
  const norm = String(env[field] ?? "").trim().toLowerCase()
  return norm === "" ? "mod" : norm
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
export function memoUsable(stored: any, atMs: number, ttlMs: number, probe = "*"): boolean {
  if (!stored || typeof stored !== "object") return false
  const kind = stored.kind
  if (!kind || passKind(probe, kind)) return false
  const t = stored.t
  return Number.isFinite(t) && (atMs - t) <= ttlMs
}

export async function loadWorld($: any, env: any, cwdArg: string): Promise<any> {
  let globalHome = ""
  if (env.PROBES_DIR) globalHome = env.PROBES_DIR
  else if (env.CONFIG_DIR) globalHome = env.CONFIG_DIR + "/probes"
  else globalHome = env.HOME + "/.claude/probes"
  const cwd = cwdArg
  const gToml = await readText($, globalHome + "/probes.toml")
  if (gToml.unreadable) noteLost("global-probes-toml", new Error(globalHome + "/probes.toml: " + gToml.unreadable), $)
  const gParsed = parseToml(gToml.text || "")
  let projectHome = ""
  let pParsed: any = {}
  let probesUnread = gToml.unreadable ? "global" : ""
  if (!env.PROBES_DIR) {
    projectHome = await findProjectHome($, cwd, globalHome)
    if (projectHome) {
      const pt = await readText($, projectHome + "/probes.toml")
      if (pt.unreadable) noteLost("project-probes-toml", new Error(projectHome + "/probes.toml: " + pt.unreadable), $)
      if (pt.unreadable) probesUnread = probesUnread ? probesUnread + ",project" : "project"
      if (pt.text) pParsed = parseToml(pt.text)
    }
  }
  const cfgUnread = ((gParsed && gParsed.__unreadN) || 0) +
                    ((pParsed && pParsed.__unreadN) || 0)
  const allowedLoaded = await loadAllowedByClass($, env, cwd)
  // CONSTRAINT: громкий отказ слоя допуска пишется в журнал ОДИН раз на
  // процесс на причину: мир строится на каждом шаге (окно мемо 5 с), и отказ
  // без однократности заливал бы журнал одной и той же строкой.
  if (allowedLoaded.refused) {
    const refKey = String(allowedLoaded.refused)
    if (!admissionRefusedSaid.has(refKey)) {
      admissionRefusedSaid.add(refKey)
      try {
        await appendJournal($, globalHome + "/failover/journal.jsonl", {
          t: isoOf(await nowMs($)),
          sid: await sidFor($),
          rec: "routing-admission-refused",
          reason: refKey,
          allowedSrc: allowedLoaded.allowedSrc,
        })
      } catch (x) {
        // CONSTRAINT: дедуп держит только УДАВШУЮСЯ запись: при отказе ключ снимается,
        // и следующий такой же отказ пишет строку снова.
        admissionRefusedSaid.delete(refKey)
        noteLost("journal-admission-refused", x, $)
      }
    }
  }
  return {
    globalHome, projectHome, cwd, cfgUnread, probesUnread,
    probes: probesOf(gParsed, pParsed),
    prompts: promptsOf(gParsed, pParsed),
    failover: failoverOf(gParsed, pParsed),
    effortByClass: allowedLoaded.effortByClass,
    allowedByClass: allowedLoaded.allowedByClass,
    allowedRefused: allowedLoaded.refused || "",
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
    terminal: p.terminal !== undefined ? p.terminal : g.terminal,
  }
}

// CONSTRAINT: разовая уборка отравленных вердиктных ключей судьи -- записи
// без t (форма до сессионной границы) и протухшие сверх срока умолчания.
// Префикс v:judge: обязателен: стор общий, чужих ключей не трогаем. Отказ
// уборки не красит и не прерывает консультацию. Разовость -- sweepDone:
// на старте КАЖДОЙ сессии (прежнее место) уборка задерживала session.start
// обходом стора, теперь она едет первой консультацией судьи. Отказ, частичный
// или полный, повторяет уборку не раньше SWEEP_RETRY_MS -- без этого
// постоянный отказ стора обходил бы его на каждой консультации.
async function sweepVerdictStore($: any, world: any, sid: string, env: any): Promise<void> {
  sweepDone = true
  sweepFailed = false
  sweepFailedAt = 0
  sweepSkips = 0
  sweepRunning = true
  const gen = sweepGen
  // CONSTRAINT: отказ публикуется флагом и моментом одним шагом ПОСЛЕ чтения часов и только в своём поколении: уборка, начатая до /clear, не пишет отказ в новую сессию.
  const fail = async () => {
    const tf = await nowMs($)
    if (gen !== sweepGen) return
    sweepFailedAt = tf
    sweepFailed = true
  }
  try {
    const all = await $.store.keys()
    const t0 = await nowMs($)
    // CONSTRAINT: уборка сносит РОВНО то, что чтение уже не признаёт годным,
    // и потому зовёт тот же самый предикат memoUsable с тем же сроком. Свой
    // экземпляр условия здесь разошёлся бы с чтением молча: при настроенном
    // verdict_cache_ms длиннее умолчания уборка сносила бы ещё живые записи.
    let ttlMs = VERDICT_TTL_MS_DEFAULT
    let judgeProbe: any = null
    for (let i = 0; i < world.probes.length; i++) {
      const p = world.probes[i]
      if (p.id !== "judge") continue
      judgeProbe = p
      ttlMs = num(p.cfg && p.cfg.verdict_cache_ms, VERDICT_TTL_MS_DEFAULT, 1)
      break
    }
    let removed = 0
    let scanned = 0
    let deleteFailed = 0
    let goneMeanwhile = 0
    let deleteErr = ""
    let readFailed = 0
    for (let i = 0; i < all.length && removed < 400; i++) {
      const k = String(all[i])
      if (k.indexOf("v:judge:") !== 0) continue
      scanned++
      let v: any
      try { v = await $.store.get(k) } catch (x) { readFailed++; continue }
      if (memoUsable(v, t0, ttlMs, "judge")) continue
      try { await $.store.delete(k); removed++ } catch (x) {
        // CONSTRAINT: удаление, отказавшее на ключе, которого уже нет (снесла соседняя уборка после /clear), -- не отказ уборки; отказ -- только если ключ остался или перечитать нельзя.
        let still = true
        try { still = (await $.store.get(k)) !== undefined } catch (y) { still = true; noteLost("judge-store-sweep-reread", y, $) }
        if (still) { deleteFailed++; deleteErr = safeText(x).slice(0, 240) }
        else goneMeanwhile++
      }
    }
    if (deleteFailed + readFailed > 0) {
      noteLost("judge-store-sweep-items", new Error("delete " + deleteFailed + ", read " + readFailed + ": " + deleteErr), $)
      await fail()
    }
    try {
      const sweepRec: any = {
        t: isoOf(t0), outcome: "store_sweep", removed, scanned,
        ttlMs, probe: "judge", carrier: carrierOfJournal(judgeProbe || { id: "judge" }, env || {}), sid,
        deleteFailed, goneMeanwhile, readFailed,
      }
      if (deleteErr) sweepRec.deleteErr = deleteErr
      await appendJournal($, world.globalHome + "/judge/journal.jsonl", sweepRec)
    } catch (x) { noteLost("journal-store-sweep", x, $) }
  } catch (x) {
    noteLost("judge-store-sweep", x, $)
    await fail()
  } finally {
    if (gen === sweepGen) sweepRunning = false
  }
}

// CONSTRAINT: имя и путь улики одним домом -- улика консульта и улика
// попадания в кэш обязаны строиться побайтно одной формой.
function modRecName(ev: any): string {
  return "mod-" + String((ev && ev.tool_use_id) || "noid") + ".json"
}

function modRecPath(world: any, id: string, ev: any): string {
  return world.globalHome + "/" + id + "/records/" + modRecName(ev)
}

async function consultBg($: any, p: any, env: any, world: any, ev: any, ctx: any, key: string, epCall: number): Promise<any> {
  const id = p.id
  const cfg = p.cfg
  const tool = String((ev && ev.tool) || "")
  const agent = String((ev && ev.subagent_type) || "")
  const prompt = String((ev && ev.prompt) || "")
  const t0 = ctx.now
  const recName = modRecName(ev)
  const recPath = modRecPath(world, id, ev)
  const jpath = world.globalHome + "/" + id + "/journal.jsonl"
  const rec: any = { id: ev && ev.tool_use_id, probe: id, tool, agent, t0, carrier: carrierOfJournal(p, env), mod: MOD_VERSION, sid: await sidFor($), projectHome: world.projectHome, globalHome: world.globalHome }
  const enforce = enforceOf(p, env, cfg)
  try {
    let sys = ""
    if (id === "judge" && env.JUDGE_PROMPT) {
      const pr = await readText($, env.JUDGE_PROMPT)
      if (pr.unreadable) noteLost("probe-prompt-read", new Error(env.JUDGE_PROMPT + ": " + pr.unreadable), $)
      if (pr.text) sys = pr.text
    } else {
      const gPath = world.globalHome + "/" + id + "/prompt.md"
      const gPrompt = await readText($, gPath)
      if (gPrompt.unreadable) noteLost("probe-prompt-read", new Error(gPath + ": " + gPrompt.unreadable), $)
      if (gPrompt.text) sys = gPrompt.text
      if (world.projectHome) {
        const pPath = world.projectHome + "/" + id + "/prompt.md"
        const pPrompt = await readText($, pPath)
        if (pPrompt.unreadable) noteLost("probe-prompt-read", new Error(pPath + ": " + pPrompt.unreadable), $)
        if (pPrompt.text) sys = pPrompt.text
        const ePath = world.projectHome + "/" + id + "/prompt.extra.md"
        const extra = await readText($, ePath)
        if (extra.unreadable) noteLost("probe-prompt-read", new Error(ePath + ": " + extra.unreadable), $)
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
        if (body.unreadable) {
          noteLost("probe-attach-read", new Error(f + ": " + body.unreadable), $)
          continue
        }
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
    if (ctx && ctx.badPattern) rec.badPattern = ctx.badPattern
    if (ctx && ctx.whenBad) rec.whenBad = ctx.whenBad

    let msgs: any[] = []
    try { msgs = await $.session.messages() } catch (x) { msgs = []; rec.messagesUnread = true; noteLost("session-messages", x, $) }
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
    // CONSTRAINT (#509-FIX7 Р16): лента диспатчей -- контракт промта судьи
    // (~/.claude/probes/judge/prompt.md, «Как читать веер по ленте»): строка на
    // вызов Agent/Task из toolUses ассистентских строк; now -- у вызовов строки,
    // несущей tool_use_id текущего вызова, self -- у него самого; прошлые -- не
    // больше DISPATCHES_PAST_MAX последних, без now. Строки текущего вызова нет --
    // now нет, одна запись fan-self-absent на tool_use_id; без tool_use_id
    // (calllessEvents) текущего вызова нет, и записи нет (#509-FIX7b AR11).
    let dispatchesText = ""
    if (id === "judge" || (Array.isArray(cfg.show) && cfg.show.indexOf("dispatches") >= 0)) {
      if (rec.messagesUnread) dispatchesText = "[session messages unreadable]"
      else {
        const tuidCur = ev && ev.tool_use_id != null && !(typeof ev === "object" && calllessEvents.has(ev)) ? String(ev.tool_use_id) : ""
        const lineOf = (u: any, now: boolean, self: boolean): string => {
          const inp = u && u.input && typeof u.input === "object" ? u.input : {}
          const o: any = {
            tool: String(u.tool),
            subagent_type: inp.subagent_type == null ? null : String(inp.subagent_type),
            model: inp.model == null ? null : String(inp.model),
            description: String(inp.description == null ? "" : inp.description).slice(0, 200),
          }
          if (now) o.now = true
          if (self) o.self = true
          return JSON.stringify(o)
        }
        const past: string[] = []
        let nowLines: string[] | null = null
        const ml: any[] = Array.isArray(msgs) ? msgs : []
        for (let i = 0; i < ml.length; i++) {
          const m = ml[i]
          if (!m || m.role !== "assistant" || !Array.isArray(m.toolUses)) continue
          const uses = m.toolUses.filter((u: any) => u && (u.tool === "Agent" || u.tool === "Task"))
          let cur = false
          if (tuidCur) for (let j = 0; j < m.toolUses.length; j++) if (m.toolUses[j] && String(m.toolUses[j].tool_use_id) === tuidCur) cur = true
          if (cur && nowLines === null) {
            nowLines = uses.map((u: any) => lineOf(u, true, String(u.tool_use_id) === tuidCur))
          } else {
            for (let j = 0; j < uses.length; j++) past.push(lineOf(uses[j], false, false))
          }
        }
        dispatchesText = past.slice(-DISPATCHES_PAST_MAX).concat(nowLines || []).join("\n")
        if (nowLines === null && tuidCur) {
          await journalOnce($, fanSelfAbsentSaid, tuidCur, jpath, {
            t: isoOf(await nowMs($)), probe: id, rec: "fan-self-absent-" + (tuidCur || "none"),
            outcome: "fan-self-absent", tool_use_id: tuidCur, sid: rec.sid,
          }, "journal-fan-self-absent")
          while (fanSelfAbsentSaid.size > FAN_SELF_ABSENT_MAX) {
            const oldest = fanSelfAbsentSaid.values().next().value
            if (oldest === undefined) break
            fanSelfAbsentSaid.delete(oldest)
          }
        }
      }
    }
    // CONSTRAINT: потолок контекста -- СВОЙ у каждой ступени (rungCtx): промт
    // собирается в цикле ступеней, общая обрезка ВНЕ цикла давала всем ступеням
    // один и тот же текст.
    const buildFull = (ctxN: number): string => {
      // CONSTRAINT: нечитаемый контекст -- не пустой; модель различает
      // «сообщений нет» и «сообщения недоступны» (как live_works_unknown).
      const context = rec.messagesUnread ? "[session messages unreadable]" : ctxAll.slice(-ctxN)
      const dchars = num(cfg.dispatch_chars, 16000, 0) || 16000
      const parts: string[] = []
      parts.push("=== SESSION SO FAR ===\n" + context)
      if (p.id === "judge" || (Array.isArray(cfg.show) && cfg.show.indexOf("dispatch") >= 0) || p.act === "cancel") {
        parts.push("=== DISPATCH ===\n" + JSON.stringify({
          tool, subagent_type: agent, model: ev && ev.model, prompt: prompt.slice(0, dchars), self: true,
        }))
      }
      if (id === "judge" || (Array.isArray(cfg.show) && cfg.show.indexOf("dispatches") >= 0)) {
        parts.push("=== DISPATCHES ===\n" + dispatchesText)
      }
      if (p.id === "idle-watch" || (Array.isArray(cfg.show) && cfg.show.indexOf("fleet") >= 0)) {
        parts.push("=== FLEET ===\n" + JSON.stringify(ctx.live_works === null ? { live_works: null, live_works_unknown: true, tool } : { live_works: ctx.live_works, tool }))
      }
      if (Array.isArray(cfg.show) && cfg.show.indexOf("tool") >= 0 && p.id !== "idle-watch") {
        parts.push("=== TOOL ===\n" + tool + (ctx && ctx.event === "PostToolUse" ? "\n" + jsonClip(ctx.tool_result, dchars) : ""))
      }
      if (Array.isArray(cfg.show) && cfg.show.indexOf("event") >= 0) {
        parts.push("=== EVENT ===\n" + jsonClip(ctx && ctx.eventInput !== undefined ? ctx.eventInput : ev, dchars))
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
      try { await $.fs.write(recPath, JSON.stringify(Object.assign({}, rec, { inflight: true }))) } catch (x) {
        rec.inflightWriteErr = safeText(x).slice(0, 240)
        noteLost("judge-record-inflight", x, $)
      }
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
        const ans = readComplete(await raceDeadline($, $.model.complete(arg), tmo, used, rec, "probe-rung-late"))
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
        const vocabBad: string[] = []
        verdict = parseVerdict(rawS, p.rx, vocabBad)
        if (vocabBad.length) rec["vocabBad_" + used] = vocabBad[0]
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
        const es = safeText(x)
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
      if ((p.pending || p.act === "cancel") && !passKind(p.id, verdict.kind)) {
        try { await $.store.set(key, { kind: verdict.kind, rest: verdict.rest, used, t: await nowMs($), dtMs: rec.dtMs }) } catch (x) {
          rec.cacheErr = safeText(x).slice(0, 240)
          noteLost("judge-verdict-cache", x, $)
        }
      }
      if (foldedKind(p.id, verdict.kind) && p.act === "nudge" && enforce) {
        // CONSTRAINT: тост модели не виден -- доставка идёт очередью (context
        // ближайшего tool.call того же агента либо submit на тике); тост --
        // дополнительный канал и метки доставки не ставит.
        const tq = await nowMs($)
        rec.queued = epoch === epCall
        if (rec.queued) await nudgeEnqueue($, ctx && ctx.agent_id ? String(ctx.agent_id) : "", {
          text: "[" + id + "] " + clip(verdict.rest, NUDGE_TEXT_MAX), probe: id, t: tq, jpath, sid: rec.sid,
        })
        try {
          await $.ui.toast((id) + ": " + verdict.rest.slice(0, 200))
          rec.toast = true
        } catch (x) {
          rec.toast = false
          rec.toastErr = safeText(x).slice(0, 160)
        }
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
        try { await $.store.set(key, { kind: "NONE", used, t: await nowMs($), dtMs: rec.dtMs }) } catch (x) {
          rec.cacheErr = safeText(x).slice(0, 240)
          noteLost("judge-verdict-cache", x, $)
        }
      }
    }
  } catch (x) {
    rec.threw = safeText(x).slice(0, 400)
    rec.dtMs = await nowMs($) - t0
    rec.kind = "NONE"
    if (p.pending || p.act === "cancel") {
      try { await $.store.set(key, { kind: "NONE", threw: rec.threw, t: await nowMs($), dtMs: rec.dtMs }) } catch (y) {
        rec.cacheErr = safeText(y).slice(0, 240)
        noteLost("judge-verdict-cache", y, $)
      }
    }
  }
  if (clockBad) rec.clockBad = true
  const kind = String(rec.kind || "NONE")
  const rest = String(rec.rest || "")
  let oc = outcomeOf(kind, p.id)
  if (foldedKind(p.id, kind) && !enforce) oc = "block_not_enforced"
  // CONSTRAINT (#374): класс свёртки считается ЗДЕСЬ ОДИН раз, едет в улику
  // полем outcome, и журнальная строка переиспользует ЭТО ЖЕ значение. Второй
  // потребитель (прибор judge/compact.py) обязан читать готовое поле, а не
  // пересчитывать его по собственной копии таблицы: копии разошлись молча на
  // пяти видах, и расхождение было видно только сличением двух домов.
  rec.outcome = oc
  if (cfg.record !== false) {
    try { await $.fs.write(recPath, JSON.stringify(rec)) } catch (x) { noteLost("judge-record", x, $) }
  }
  try {
    const jline: any = {
      t: isoOf(t0),
      probe: id, tool, agent, ms: rec.dtMs, outcome: oc,
      verdict: (kind + ": " + rest).slice(0, 400),
      jm: rec.used, rec: recName, carrier: carrierOfJournal(p, env), sid: rec.sid,
    }
    if (rec.toast !== undefined) jline.toast = rec.toast
    if (rec.queued !== undefined) jline.queued = rec.queued
    await appendJournal($, jpath, jline)
  } catch (x) {
    // CONSTRAINT: отказ журнальной дороги НЕ молчит. Улика уже на диске, и
    // причина дописывается в неё вторым заходом: пока catch был глухим, потеря
    // строки обнаруживалась только сличением двух домов, и ровно это скрывало
    // поломку часов поверхности от её начала до разбора #184.
    try {
      rec.journalErr = safeText(x).slice(0, 240)
      if (cfg.record !== false) await $.fs.write(recPath, JSON.stringify(rec))
    } catch (y) { noteLost("judge-record-journalErr", y, $) }
  }
  return rec
}

// CONSTRAINT: список инструментов формы -- ОДИН дом: его читает и страж
// runForm, и отказ чужого носителя (#335) -- вторая копия разошлась бы молча.
function formActsOnTool(tool: string): boolean {
  return tool === "Agent" || tool === "Task" || tool === "SendMessage" ||
         tool === "Write" || tool === "Edit" || tool === "Bash"
}

// CONSTRAINT (#489-B1-FIX5 Z12): регулярка cfg.heredoc не выражала продолжение
// backslash+newline, несколько тел одной логической строки, кавычки в
// слове-разделителе и `$(` внутри двойных кавычек. Единственный посимвольный
// автомат держит все четыре; образец правила `$(` в `"…"` --
// Catalyst-CC-Patch/tools/heredoc-anchor.py:52-66. Ключ cfg.heredoc снят с
// чтения: ни один потребитель больше его не трогает (снятие из канона -- #497).
export type Heredoc = {
  op: number; delim: string; strip: boolean; quoted: boolean
  lineStart: number; lineEnd: number
  bodyStart: number; bodyEnd: number; body: string; terminated: boolean
}
export type ShellQuote = { s: number; e: number; kind: string; raw: string; text: string }
export type ShellFrame = { lo: number; hi: number; open: number; sub: string }
export type ShellScan = {
  heredocs: Heredoc[]
  inert: (i: number) => boolean
  lineOf: (i: number) => [number, number]
  cmdOf: (i: number) => [number, number]
  comment: (i: number) => boolean
  frames: ShellFrame[]
  frameOf: (i: number) => number
  segments: () => Array<[number, number]>
  quoteAt: (i: number) => ShellQuote | undefined
  quotes: ShellQuote[]
  quoteFrom: (i: number) => ShellQuote | undefined
  frameFrom: (i: number) => ShellFrame | undefined
}

type ScanCtx = {
  kind: string; depth: number; sub: string; paren: number
  id: number; open: number; cs: string[]; pp: number; patClose: number; dbl: boolean
  ps: boolean[]
}

export function shellScan(cmd: string): ShellScan {
  const n = cmd.length
  const heredocs: Heredoc[] = []
  const inertFlags = new Uint8Array(n)
  const commentFlags = new Uint8Array(n)
  const cuts: number[] = []
  const pend: Heredoc[] = []
  // CONSTRAINT (#489-B1-FIX7 F-2): у каждой кодовой рамки (корень, `$(`, обратные
  // кавычки) свой отрезок [lo, hi) и свои разделители; cmdOf режет по самой
  // внутренней рамке, иначе две команды внутри `$(…)` делят одно сообщение.
  const spans: ShellFrame[] = [{ lo: 0, hi: n, open: -1, sub: "root" }]
  const seps: number[][] = [[]]
  const quotes: ShellQuote[] = []
  const quoteEnd = (q: ScanCtx, e: number): void => {
    const raw = cmd.slice(q.open + (q.kind === "ansi" ? 2 : 1), e)
    const text = q.kind === "sq" ? raw
      : q.kind === "dq" ? raw.replace(/\\([$`"\\\n])/g, (_m, ch) => ch === "\n" ? "" : ch)
      : raw.replace(/\\(.)/gs, (m, ch) => ch === "n" ? "\n" : ch === "t" ? "\t" : ch === "\\" || ch === "'" || ch === '"' ? ch : m)
    quotes.push({ s: q.open, e, kind: q.kind, raw, text })
  }
  // CONSTRAINT (#489-B1-FIX8): `)` закрытия `$(`/`$((` и закрывающая обратная
  // кавычка продолжают слово (`$(a)#b` — одно слово `a#b`); начинают слово
  // только открывающая обратная кавычка и прочие `;&|()`.
  const substClose = new Uint8Array(n)
  const mk = (kind: string, depth: number, sub: string, paren: number): ScanCtx =>
    ({ kind, depth, sub, paren, id: -1, open: -1, cs: [], pp: 0, patClose: -1, dbl: false, ps: [] })
  const codeFrame = (depth: number, sub: string, open: number, lo: number): ScanCtx => {
    const f = mk("code", depth, sub, 0)
    f.id = spans.length
    f.open = open
    spans.push({ lo, hi: n, open, sub })
    seps.push([])
    return f
  }
  const quoteCtx = (kind: string, depth: number, open: number): ScanCtx => {
    const q = mk(kind, depth, "", 0)
    q.open = open
    return q
  }
  const root = mk("code", 0, "root", 0)
  root.id = 0
  const stack: ScanCtx[] = [root]
  let d0Start = 0
  let i = 0
  const wordStart = (p: number): boolean => {
    if (p === 0) return true
    const b = cmd[p - 1]
    if (b === " " || b === "\t" || b === "\n") return true
    return ";&|()`".indexOf(b) >= 0 && !substClose[p - 1]
  }
  const wordEnd = (c: string): boolean =>
    c === " " || c === "\t" || c === "\n" || ";>|<()&".indexOf(c) >= 0
  const kwAt = (p: number, w: string): boolean =>
    wordStart(p) && cmd.startsWith(w, p) && (p + w.length >= n || wordEnd(cmd[p + w.length]))
  // CONSTRAINT (#489-B1-FIX6 F1): bash распознаёт case/esac как ключевые слова
  // только в командной позиции; аргумент (`echo case`) состояние не трогает.
  // CONSTRAINT (#489-B1-FIX7 F-1): `)` даёт командную позицию, только если это
  // закрытие шаблона case этой рамки; обратная кавычка — только открывающая свою
  // рамку. После `>|`, `>&`, `<&` стоит имя файла, не команда.
  const cmdPos = (p: number): boolean => {
    const top = stack[stack.length - 1]
    let q = p - 1
    while (q >= 0 && (cmd[q] === " " || cmd[q] === "\t")) q--
    if (q < 0) return true
    const b = cmd[q]
    if (b === "\n" || b === ";" || b === "(") return true
    if (b === "&" || b === "|") return q === 0 || (cmd[q - 1] !== ">" && cmd[q - 1] !== "<")
    if (b === ")") return top.patClose === q
    if (b === "`") return top.sub === "bt" && top.open === q
    let s = q
    while (s - 1 >= 0 && cmd[s - 1] !== " " && cmd[s - 1] !== "\t" && ";&|()\n".indexOf(cmd[s - 1]) < 0) s--
    const w = cmd.slice(s, q + 1)
    return w === "then" || w === "do" || w === "else" || w === "elif" || w === "if" ||
      w === "while" || w === "until" || w === "{" || w === "!" || w === "time"
  }
  // `esac` закрывает case в фазе шаблонов только в голове шаблона: после `;;`,
  // `;&`, `;;&` или сразу после `in`.
  const patHead = (p: number): boolean => {
    let q = p - 1
    while (q >= 0 && (cmd[q] === " " || cmd[q] === "\t" || cmd[q] === "\n")) q--
    if (q < 0) return false
    if (cmd[q] === ";" || cmd[q] === "&") return true
    return q >= 1 && cmd[q] === "n" && cmd[q - 1] === "i" && wordStart(q - 1)
  }
  const delimWord = (q: number): { delim: string; next: number } => {
    let w = q
    let out = ""
    while (w < n) {
      const c = cmd[w]
      if (wordEnd(c)) break
      if (c === "'") {
        const cl = cmd.indexOf("'", w + 1)
        out += cmd.slice(w + 1, cl < 0 ? n : cl)
        w = cl < 0 ? n : cl + 1
        continue
      }
      if (c === '"') {
        let k = w + 1
        while (k < n && cmd[k] !== '"') {
          if (cmd[k] === "\\") { out += k + 1 < n ? cmd[k + 1] : ""; k += 2; continue }
          out += cmd[k]
          k++
        }
        w = k < n ? k + 1 : n
        continue
      }
      if (c === "$" && cmd[w + 1] === "'") {
        const cl = cmd.indexOf("'", w + 2)
        out += cmd.slice(w + 2, cl < 0 ? n : cl)
        w = cl < 0 ? n : cl + 1
        continue
      }
      if (c === "\\") { out += w + 1 < n ? cmd[w + 1] : ""; w += 2; continue }
      out += c
      w++
    }
    return { delim: out, next: w }
  }
  const readBodies = (trig: number, trigDepth: number, fid: number): number => {
    let p = trig + 1
    // CONSTRAINT: кодовый `\n` изымает ВСЮ очередь -- прочитанное тело не
    // должно доставаться повторно следующим `\n` того же разбора (F1/F16b).
    const queue = pend.slice()
    pend.length = 0
    for (let pi = 0; pi < queue.length; pi++) {
      const h = queue[pi]
      h.bodyStart = p
      const lines: string[] = []
      let terminated = false
      let rawEnd = n
      while (p < n) {
        let eol = cmd.indexOf("\n", p)
        const last = eol < 0
        if (last) eol = n
        const probe = h.strip ? cmd.slice(p, eol).replace(/^\t+/, "") : cmd.slice(p, eol)
        if (probe === h.delim) {
          terminated = true
          rawEnd = p
          if (!last) {
            if (trigDepth === 0) { cuts.push(eol); d0Start = eol + 1 }
            seps[fid].push(eol)
          }
          p = last ? n : eol + 1
          break
        }
        lines.push(probe)
        p = last ? n : eol + 1
      }
      if (!terminated) rawEnd = n
      h.bodyEnd = rawEnd
      h.terminated = terminated
      h.body = lines.join("\n")
      for (let q = h.bodyStart; q < rawEnd; q++) inertFlags[q] = 1
      if (!terminated) p = n
    }
    return p
  }
  while (i < n) {
    const top = stack[stack.length - 1]
    const c = cmd[i]
    if (top.kind === "sq") {
      inertFlags[i] = 1
      if (c === "'") { quoteEnd(top, i); stack.pop() }
      i++
      continue
    }
    if (top.kind === "ansi") {
      inertFlags[i] = 1
      if (c === "\\") { if (i + 1 < n) inertFlags[i + 1] = 1; i += 2; continue }
      if (c === "'") { quoteEnd(top, i); stack.pop() }
      i++
      continue
    }
    if (top.kind === "comment") {
      // CONSTRAINT (#489-B1-FIX8): тело обратных кавычек bash выделяет ДО разбора,
      // поэтому комментарий внутри них кончается на закрывающей кавычке, а не на
      // переводе строки; иначе команды за ней становятся инертными.
      const encBt = stack.length >= 2 && stack[stack.length - 2].sub === "bt"
      if (encBt && c === "`") { stack.pop(); continue }
      if (encBt && c === "\\" && cmd[i + 1] === "`") {
        inertFlags[i] = 1; inertFlags[i + 1] = 1; commentFlags[i] = 1; commentFlags[i + 1] = 1
        i += 2
        continue
      }
      inertFlags[i] = 1
      if (c === "\n") {
        stack.pop()
        const enc = stack[stack.length - 1]
        const d = enc.kind === "code" ? enc.depth : 0
        const fid = enc.kind === "code" ? enc.id : 0
        if (d === 0) { cuts.push(i); d0Start = i + 1 }
        if (!enc.dbl) seps[fid].push(i)
        i++
        if (pend.length) i = readBodies(i - 1, d, fid)
        continue
      }
      commentFlags[i] = 1
      i++
      continue
    }
    if (top.kind === "arith") {
      inertFlags[i] = 1
      if (c === "(") top.paren++
      else if (c === ")") { top.paren--; if (top.paren <= 0) { if (top.sub === "darith") substClose[i] = 1; stack.pop() } }
      i++
      continue
    }
    if (top.kind === "dq") {
      inertFlags[i] = 1
      if (c === "\\") { if (i + 1 < n) inertFlags[i + 1] = 1; i += 2; continue }
      if (c === '"') { quoteEnd(top, i); stack.pop(); i++; continue }
      if (c === "$" && cmd[i + 1] === "(") {
        inertFlags[i] = 1; inertFlags[i + 1] = 1
        stack.push(codeFrame(top.depth + 1, "dollar", i, i + 2))
        i += 2
        continue
      }
      if (c === "`") {
        stack.push(codeFrame(top.depth + 1, "bt", i, i + 1))
        i++
        continue
      }
      i++
      continue
    }
    // code (любая глубина)
    const ph = top.cs.length ? top.cs[top.cs.length - 1] : ""
    if (c === "\\") { i += 2; continue }
    if (c === "\n") {
      if (top.depth === 0) { cuts.push(i); d0Start = i + 1 }
      if (!top.dbl) seps[top.id].push(i)
      const trig = i
      i++
      if (pend.length) i = readBodies(trig, top.depth, top.id)
      continue
    }
    // CONSTRAINT (#489-B1-FIX7 F-1): фазы case на рамку: "w" — слово до `in`,
    // "p" — шаблоны (`(` в начале, `|`, `)` закрывает шаблон), "b" — тело до
    // `;;`/`;&`/`;;&`. `?(` `*(` `+(` `@(` `!(` — скобки extglob внутри шаблона.
    if (ph === "w" && kwAt(i, "in")) { top.cs[top.cs.length - 1] = "p"; i += 2; continue }
    if (ph === "p") {
      if (c === "(") {
        // CONSTRAINT (#494 FIX10 AR-3, bash 5.2 на usbox): внутри открытого
        // extglob bash считает КАЖДУЮ скобку (`case "(b)" in @(a|(b)))` совпадает);
        // вне его без префикса — только необязательная ведущая `(` шаблона.
        if (top.pp > 0 || (i > 0 && "?*+@!".indexOf(cmd[i - 1]) >= 0)) top.pp++
        i++
        continue
      }
      if (c === ")") {
        if (top.pp > 0) { top.pp--; i++; continue }
        top.patClose = i
        seps[top.id].push(i)
        top.cs[top.cs.length - 1] = "b"
        i++
        continue
      }
      if (c === "|") { i++; continue }
      if (kwAt(i, "esac") && patHead(i)) { top.cs.pop(); i += 4; continue }
    }
    if (ph === "b" && c === ";" && (cmd[i + 1] === ";" || cmd[i + 1] === "&")) {
      seps[top.id].push(i)
      top.cs[top.cs.length - 1] = "p"
      i += 2
      continue
    }
    // CONSTRAINT: группа аргумента — одно слово; её | не разделяет команды.
    if (c === "(" && !top.dbl && (!cmdPos(i) || "?*+@!".includes(cmd[i - 1] || "\u0000")) && cmd[i + 1] !== ")") {
      i = shellGroupEnd(cmd, i)
      continue
    }
    // CONSTRAINT (#489-B1-FIX6 F2): `>&`, `<&`, `&>` и `>|` — перенаправления, не разделители.
    // CONSTRAINT (#489-B1-FIX7 F-2): внутри `[[ … ]]` `&&` и `||` — операторы выражения.
    if (!top.dbl && (c === ";" ||
        (c === "|" && cmd[i - 1] !== ">") ||
        (c === "&" && cmd[i - 1] !== ">" && cmd[i - 1] !== "<" && cmd[i + 1] !== ">"))) {
      seps[top.id].push(i); i++; continue
    }
    if (c === "'") { inertFlags[i] = 1; stack.push(quoteCtx("sq", top.depth, i)); i++; continue }
    if (c === '"') { inertFlags[i] = 1; stack.push(quoteCtx("dq", top.depth, i)); i++; continue }
    if (c === "$" && cmd[i + 1] === "'") {
      inertFlags[i] = 1; inertFlags[i + 1] = 1
      stack.push(quoteCtx("ansi", top.depth, i))
      i += 2
      continue
    }
    if (c === "$" && cmd[i + 1] === "(" && cmd[i + 2] === "(") {
      inertFlags[i] = 1; inertFlags[i + 1] = 1; inertFlags[i + 2] = 1
      stack.push(mk("arith", top.depth, "darith", 2))
      i += 3
      continue
    }
    if (c === "$" && cmd[i + 1] === "(") {
      stack.push(codeFrame(top.depth + 1, "dollar", i, i + 2))
      i += 2
      continue
    }
    // CONSTRAINT (#494 FIX10 F2): `<(…)` и `>(…)` — подстановка процесса, своя
    // кодовая рамка: команды внутри не принадлежат внешней простой команде.
    if ((c === "<" || c === ">") && cmd[i + 1] === "(") {
      stack.push(codeFrame(top.depth + 1, c === "<" ? "pin" : "pout", i, i + 2))
      i += 2
      continue
    }
    if (c === "(" && cmd[i + 1] === "(" && wordStart(i)) {
      inertFlags[i] = 1; inertFlags[i + 1] = 1
      stack.push(mk("arith", top.depth, "", 2))
      i += 2
      continue
    }
    // CONSTRAINT (#489-B1-FIX9): `(` в командной позиции вне `[[ … ]]` открывает
    // подоболочку, и её скобки — границы команды: `if (echo --only ) then git commit`
    // — разные команды. Прочие `(` (массив, `f()`) только считаются.
    if (c === "(") {
      const sub = !top.dbl && cmdPos(i)
      top.ps.push(sub)
      if (sub) seps[top.id].push(i)
      i++
      continue
    }
    if (ph !== "w" && ph !== "p" && kwAt(i, "case") && cmdPos(i)) { top.cs.push("w"); i += 4; continue }
    if (ph === "b" && kwAt(i, "esac") && cmdPos(i)) { top.cs.pop(); i += 4; continue }
    if (ph !== "w" && ph !== "p" && !top.dbl && kwAt(i, "[[") && cmdPos(i)) { top.dbl = true; i += 2; continue }
    if (top.dbl && kwAt(i, "]]")) { top.dbl = false; i += 2; continue }
    if (c === "#" && wordStart(i)) {
      inertFlags[i] = 1
      commentFlags[i] = 1
      stack.push(mk("comment", top.depth, "", 0))
      i++
      continue
    }
    if (c === "`") {
      if (top.sub === "bt") { spans[top.id].hi = i; substClose[i] = 1; stack.pop(); i++; continue }
      stack.push(codeFrame(top.depth + 1, "bt", i, i + 1))
      i++
      continue
    }
    // CONSTRAINT (#489-B1-FIX5b Z17): закрывает подстановку `$(` только `)` вне
    // открытых скобок рамки и вне шаблона `case` — иначе `$( (a) )` и `a)` режут её раньше срока.
    if (c === ")" && top.ps.length) {
      if (top.ps.pop()) seps[top.id].push(i)
      i++
      continue
    }
    if (c === ")" && (top.sub === "dollar" || top.sub === "pin" || top.sub === "pout") && top.depth > 0) {
      spans[top.id].hi = i
      substClose[i] = 1
      stack.pop()
      const parent = stack[stack.length - 1]
      if (parent.kind === "dq") inertFlags[i] = 1
      i++
      continue
    }
    if (c === "<" && cmd[i + 1] === "<" && cmd[i + 2] !== "<" && (i === 0 || cmd[i - 1] !== "<")) {
      let q = i + 2
      let strip = false
      if (cmd[q] === "-") { strip = true; q++ }
      while (cmd[q] === " " || cmd[q] === "\t") q++
      const w = delimWord(q)
      if (w.delim !== "") {
        const h: Heredoc = {
          op: i, delim: w.delim, strip, quoted: /['"\\]/.test(cmd.slice(q, w.next)),
          lineStart: d0Start, lineEnd: n,
          bodyStart: n, bodyEnd: n, body: "", terminated: false,
        }
        heredocs.push(h)
        pend.push(h)
        i = w.next
        continue
      }
      i++
      continue
    }
    i++
  }
  for (let k = 0; k < stack.length; k++) {
    const q = stack[k]
    if (q.kind === "sq" || q.kind === "dq" || q.kind === "ansi") quoteEnd(q, n)
  }
  for (let hi = 0; hi < heredocs.length; hi++) {
    const h = heredocs[hi]
    for (let ci = 0; ci < cuts.length; ci++) {
      if (cuts[ci] >= h.lineStart) { h.lineEnd = cuts[ci]; break }
    }
  }
  const lineOf = (idx: number): [number, number] => {
    let lo = 0
    for (let ci = 0; ci < cuts.length; ci++) {
      if (cuts[ci] >= idx) return [lo, cuts[ci]]
      lo = cuts[ci] + 1
    }
    return [lo, n]
  }
  const frameOf = (idx: number): number => {
    let fid = 0
    for (let k = 1; k < spans.length; k++) {
      if (spans[k].lo <= idx && idx < spans[k].hi && spans[k].lo >= spans[fid].lo) fid = k
    }
    return fid
  }
  const cmdOf = (idx: number): [number, number] => {
    const fid = frameOf(idx)
    let lo = spans[fid].lo
    const bs = seps[fid]
    for (let k = 0; k < bs.length; k++) {
      if (bs[k] >= idx) return [lo, bs[k]]
      lo = bs[k] + 1
    }
    return [lo, spans[fid].hi]
  }
  const inert = (idx: number): boolean => {
    if (idx < 0 || idx >= n) return false
    return inertFlags[idx] === 1
  }
  const comment = (idx: number): boolean => idx >= 0 && idx < n && commentFlags[idx] === 1
  const segments = (): Array<[number, number]> => {
    const out: Array<[number, number]> = []
    for (let fid = 0; fid < spans.length; fid++) {
      let lo = spans[fid].lo
      const bs = seps[fid]
      for (let k = 0; k < bs.length; k++) { out.push([lo, bs[k]]); lo = bs[k] + 1 }
      out.push([lo, spans[fid].hi])
    }
    return out
  }
  const quoteAt = (idx: number): ShellQuote | undefined => {
    let best: ShellQuote | undefined
    for (let k = 0; k < quotes.length; k++) {
      const q = quotes[k]
      if (q.s < idx && idx < q.e && (!best || q.s > best.s)) best = q
    }
    return best
  }
  const quoteFrom = (idx: number): ShellQuote | undefined => quotes.find((q) => q.s === idx)
  const frameFrom = (idx: number): ShellFrame | undefined => spans.find((f, k) => k > 0 && f.open === idx)
  return { heredocs, inert, comment, lineOf, cmdOf, frames: spans, frameOf, segments, quoteAt, quotes, quoteFrom, frameFrom }
}

// CONSTRAINT (#489-B1-FIX7 F-7): аргументы и stdin этих команд — данные, не
// исполняемый текст; выход в `|` к не-данным снимает статус (приёмник может исполнить).
// CONSTRAINT (#494 FIX10 F3/AR-1): вывод, который может стать исполняемым, статус
// снимает: запись в файл или процесс, подстановка в командной позиции или в
// присваивании, аргумент команды вне DATA_CMDS/SUBST_PARENTS. `tee` пишет файлы —
// не данные. Судимый лишний раз коммит — безопасное направление, пропущенный — нет.
const DATA_CMDS = ["echo", "printf", "cat", "grep", "egrep", "fgrep", "rg"]
const SUBST_PARENTS = ["git", "gh"]
const SAFE_SINKS = ["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty", "/dev/fd/1", "/dev/fd/2"]
// CONSTRAINT (#494 FIX10 AR-5): опции git, забирающие СЛЕДУЮЩЕЕ слово как значение.
const GIT_OPT_ARG = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]

function cmdHead(seg: string): string {
  let r = seg
  for (;;) {
    const m = /^(?:[\s({!]+|(?:then|do|else|elif|if|while|until|time)(?=\s)|[A-Za-z_][A-Za-z0-9_]*=\S*(?=\s))/.exec(r)
    if (!m) break
    r = r.slice(m[0].length)
  }
  return r
}

function cmdWord(seg: string): string {
  const w = (/^[^\s<>|;&()]*/.exec(cmdHead(seg)) as RegExpExecArray)[0]
  return w.slice(w.lastIndexOf("/") + 1)
}

// CONSTRAINT (#494 FIX10 qwen F-2): `name() { … }` — определение функции; её
// тело исполнится вызовом имени, поэтому имя data-команды статуса не даёт.
function funcDef(seg: string): boolean {
  return /^[^\s<>|;&()]+\s*\(\s*\)/.test(cmdHead(seg))
}

type ShWord = {
  at: number; end: number; text: string; raw: string; dyn: boolean; glob: boolean
  role: "command" | "argument" | "assignment" | "redirection" | "target"
  split: boolean; quoted: boolean
}

function shellGroupEnd(tx: string, at: number): number {
  let depth = 1, quote = "", p = at + 1
  for (; p < tx.length; p++) {
    const c = tx[p]
    if (c === "\\") { p++; continue }
    if (quote) { if (c === quote) quote = ""; continue }
    if (c === "'" || c === '"') { quote = c; continue }
    if (c === "(") depth++
    if (c === ")" && --depth === 0) return p + 1
    if (c !== ")") depth += 0
  }
  return p
}

function shellGlob(text: string): RegExp {
  let out = "", depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if ("?*+@!".includes(c) && text[i + 1] === "(") {
      if (c === "!") { out += ".*"; i = shellGroupEnd(text, i + 1) - 1; continue }
      out += c === "@" ? "@?" : c === "+" ? "\\+?" : ""
      continue
    }
    if (c === "*") out += ".*"
    else if (c === "?") out += "."
    else if (c === "(") { out += "(?:"; depth++ }
    else if (c === ")" && depth) { out += ")"; depth-- }
    else if (c === "|" && depth) out += "|"
    else if (c === "[") {
      const end = text.indexOf("]", i + 1)
      if (end > i + 1) { out += "[" + text.slice(i + 1, end).replace(/^!/, "^") + "]"; i = end }
      else out += "\\["
    } else out += c.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
  }
  while (depth-- > 0) out += ")"
  return new RegExp("^(?:" + out + ")$")
}

function shellMatch(w: ShWord, text: string): boolean {
  if (w.dyn) return false
  return w.glob ? shellGlob(w.text).test(text) : w.text === text
}

// CONSTRAINT: redirection operands cannot become git options or commands.
function shellWords(tx: string, lo: number, hi: number, scan: ShellScan, vars: Record<string, string> = {}): ShWord[] {
  const out: ShWord[] = []
  const brk = (ch: string): boolean => /[\s;&|<>)]/.test(ch)
  const skip = (q: number): boolean => scan.comment(q) || scan.heredocs.some(h => h.bodyStart <= q && q < h.bodyEnd)
  let p = lo, head = true, target = false
  const value = (raw: string): { text: string; dyn: boolean; split: boolean } => {
    let dyn = false, split = false
    const text = raw.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (m, a, b) => {
      const k = a || b
      if (!(k in vars)) { dyn = true; return m }
      if (/[ \t\n]/.test(vars[k])) split = true
      return vars[k]
    })
    if (/[$`]/.test(text)) dyn = true
    return { text, dyn, split }
  }
  while (p < hi) {
    if (skip(p) || /[\s;|)]/.test(tx[p]) || (tx[p] === "&" && tx[p + 1] !== ">")) { p++; continue }
    const rd = /^(?:\d*)?(?:&>>!?|&>!?|>>!?|>\||>!|>&|>|<<<|<<-?|<&|<)/.exec(tx.slice(p, hi))
    if (rd) {
      out.push({ at: p, end: p + rd[0].length, text: rd[0], raw: rd[0], dyn: false, glob: false, split: false, quoted: false, role: "redirection" })
      p += rd[0].length; target = true; continue
    }
    if (tx[p] === "(" && (p === lo || scan.cmdOf(p)[1] === p)) { p++; continue }
    const at = p
    let text = "", dyn = false, glob = false, split = false, quoted = false
    while (p < hi && !brk(tx[p]) && !skip(p)) {
      const ch = tx[p]
      if (ch === "\\") { if (tx[p + 1] !== "\n") text += tx[p + 1] ?? ""; p += 2; quoted = true; continue }
      const q = (ch === "'" || ch === '"' || (ch === "$" && tx[p + 1] === "'")) ? scan.quoteFrom(p) : undefined
      if (q) {
        const v = q.kind === "dq" ? value(q.text) : { text: q.text, dyn: false, split: false }
        text += v.text; dyn ||= v.dyn; quoted = true; p = q.e + 1; continue
      }
      if (ch === "$" || ch === "`") {
        const f = scan.frameFrom(p)
        if (f) { dyn = true; text += tx.slice(p, f.hi + 1); p = f.hi + 1; continue }
        const m = /^\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/.exec(tx.slice(p))
        const v = value(m ? m[0] : ch)
        text += v.text; dyn ||= v.dyn; split ||= v.split; p += m ? m[0].length : 1; continue
      }
      if (ch === "(") { const e = Math.min(hi, shellGroupEnd(tx, p)); text += tx.slice(p, e); glob = true; p = e; continue }
      if ("*?[".includes(ch)) glob = true
      text += ch; p++
    }
    if (p === at) { p++; continue }
    let role: ShWord["role"] = target ? "target" : head && /^[A-Za-z_][A-Za-z0-9_]*=/.test(text) ? "assignment" : head ? "command" : "argument"
    if (role === "command" && ["then", "do", "else", "elif", "if", "while", "until", "time", "!", "{"].includes(text)) role = "argument"
    else if (role === "command") head = false
    target = false
    out.push({ at, end: p, raw: tx.slice(at, p), text, dyn, glob, split, quoted, role })
  }
  return out
}

type ShellView = { s: number; e: number; words: ShWord[]; cwd: string | null }
function shellScope(tx: string, scan: ShellScan, at: number): string {
  const fid = scan.frameOf(at)
  const opens: number[] = []
  for (let p = scan.frames[fid].lo; p < at; p++) {
    if (scan.inert(p)) continue
    if (tx[p] === "(") {
      if (scan.cmdOf(p)[1] === p) opens.push(p)
      else p = shellGroupEnd(tx, p) - 1
    } else if (tx[p] === ")" && opens.length) opens.pop()
  }
  return fid + "/" + opens.join("/")
}

// CONSTRAINT: prefix assignments never enter the persistent scope map.
function shellViews(tx: string, scan: ShellScan, cwd = "", home = ""): ShellView[] {
  type State = { vars: Record<string, string>; cwd: string | null }
  const clone = (state: State): State => ({ vars: { ...state.vars }, cwd: state.cwd })
  const unique = (states: State[]): State[] => states.filter((state, i) => states.findIndex(other => JSON.stringify(other) === JSON.stringify(state)) === i)
  const scopes = new Map<string, State[]>([["0/", [{ vars: {}, cwd }]]])
  const pipelines = new Map<string, State[]>()
  const out: ShellView[] = []
  for (const [s, e] of scan.segments().sort((a, b) => a[0] - b[0])) {
    const raw = shellWords(tx, s, e, scan)
    if (!raw.length) continue
    const key = shellScope(tx, scan, raw[0].at)
    if (!scopes.has(key)) {
      const parentKey = key.slice(0, key.lastIndexOf("/")) + "/"
      scopes.set(key, (scopes.get(parentKey) || scopes.get("0/")!).map(clone))
    }
    const pipeOut = tx[e] === "|" && tx[e + 1] !== "|" && tx[e - 1] !== "|"
    if (pipeOut && !pipelines.has(key)) pipelines.set(key, scopes.get(key)!.map(clone))
    const before = pipelines.get(key) || scopes.get(key)!
    const after: State[] = []
    for (const input of before) {
      const state = clone(input), vars = { ...state.vars }
      for (const w of raw) {
        if (w.role !== "assignment") break
        const parsed = shellWords(tx, w.at, w.end, scan, vars)[0]
        const eq = parsed.text.indexOf("=")
        const name = parsed.text.slice(0, eq)
        if (parsed.dyn) delete vars[name]
        else vars[name] = parsed.text.slice(eq + 1)
      }
      const words = shellWords(tx, s, e, scan, vars)
      if (words.every(w => w.role === "assignment")) state.vars = vars
      out.push({ s, e, words, cwd: state.cwd })
      const bash = words.flatMap(w => w.split && !w.quoted ? w.text.split(/[ \t\n]+/).filter(Boolean).map(text => ({ ...w, text, split: false })) : [w])
      if (bash.map(w => w.text).join("\u0000") !== words.map(w => w.text).join("\u0000")) out.push({ s, e, words: bash, cwd: state.cwd })
      const cmd = words.find(w => w.role === "command")
      if (cmd && !cmd.dyn && (cmd.text === "cd" || cmd.text === "pushd")) {
        const args = words.slice(words.indexOf(cmd) + 1).filter(w => w.role === "argument")
        let i = 0
        while (args[i] && !args[i].dyn && /^-(?:[PLqs]+)$/.test(args[i].text)) i++
        if (args[i]?.text === "--") i++
        const arg = args[i]
        state.cwd = arg && !arg.dyn && !arg.glob && arg.text !== "-" && state.cwd !== null ? formResolve(arg.text, home, state.cwd) : null
      }
      after.push(state)
    }
    if (!pipeOut) {
      scopes.set(key, unique(pipelines.has(key) ? before.concat(after) : after))
      pipelines.delete(key)
    }
  }
  return out
}

type GitCall = { at: number; sub: string; args: ShWord[]; cwd: string | null }
function gitCalls(tx: string, scan: ShellScan, cwd = "", home = ""): GitCall[] {
  const out: GitCall[] = []
  for (const view of shellViews(tx, scan, cwd, home)) {
    const ws = view.words.filter(w => w.role !== "assignment" && w.role !== "redirection" && w.role !== "target")
    for (let k = 0; k < ws.length; k++) {
      const w = ws[k]
      const base = { ...w, text: w.text.slice(w.text.lastIndexOf("/") + 1).replace(/^=/, "") }
      if (!w.dyn && !shellMatch(base, "git")) continue
      let j = k + 1, baseCwd = view.cwd
      while (j < ws.length && !ws[j].dyn && ws[j].text.startsWith("-") && ws[j].text !== "--") {
        const option = ws[j]
        if (option.text === "-C" || option.text.startsWith("-C")) {
          const dir = option.text === "-C" ? ws[j + 1] : { ...option, text: option.text.slice(2) }
          baseCwd = dir && !dir.dyn && !dir.glob && baseCwd !== null ? (dir.text ? formResolve(dir.text, home, baseCwd) : baseCwd) : null
        }
        j += GIT_OPT_ARG.includes(option.text) ? 2 : 1
      }
      if (ws[j]?.text === "--") j++
      if (j >= ws.length) continue
      if (ws[j].dyn) {
        out.push({ at: w.at, sub: "unknown", args: ws.slice(j + 1), cwd: baseCwd })
        if (j + 1 < ws.length && !ws[j + 1].dyn) for (const sub of ["commit", "push"]) if (shellMatch(ws[j + 1], sub)) out.push({ at: w.at, sub, args: ws.slice(j + 2), cwd: baseCwd })
      } else for (const sub of ["commit", "push"]) if (shellMatch(ws[j], sub)) out.push({ at: w.at, sub, args: ws.slice(j + 1), cwd: baseCwd })
    }
  }
  return out
}

function gitSubWords(tx: string, scan: ShellScan, sub: string): number[] {
  return [...new Set(gitCalls(tx, scan).filter(g => g.sub === sub || (sub === "commit" && g.sub === "unknown")).map(g => g.at))]
}

// CONSTRAINT (#494 FIX10c): один дом детекции вложенного `git <sub>` для входа в суд
// и для попаданий внутри кавычек и тел heredoc: слова не заходят в инертный текст,
// поэтому каждая кавычка и тело разбираются как своя команда. Глубина 8 — предел
// разбора, не предел суда (суд глубже 3 уровней отказывает сам).
type GitOption = { name: string; value?: ShWord; literal: boolean }
function gitOptions(words: ShWord[], sub: string): { options: GitOption[]; positional: ShWord[] } {
  const options: GitOption[] = [], positional: ShWord[] = []
  const shortArg = sub === "commit" ? "mFCct" : "or"
  const longArg = sub === "commit" ? ["message", "file", "reuse-message", "reedit-message", "author", "date", "cleanup", "template", "fixup", "squash", "trailer", "pathspec-from-file"] : ["repo", "receive-pack", "exec", "push-option"]
  let ended = false
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (!ended && !w.dyn && !w.glob && w.text === "--") { ended = true; continue }
    if (ended || !w.text.startsWith("-") || w.text === "-") { positional.push(w); continue }
    if (w.text.startsWith("--")) {
      const eq = w.text.indexOf("=")
      const name = eq < 0 ? w.text : w.text.slice(0, eq)
      const takes = longArg.includes(name.slice(2))
      const value = takes ? eq >= 0 ? { ...w, text: w.text.slice(eq + 1) } : words[++i] : undefined
      options.push({ name: takes ? name : w.text, value, literal: !w.dyn && !w.glob })
      continue
    }
    for (let j = 1; j < w.text.length; j++) {
      const name = "-" + w.text[j]
      if (sub === "commit" && "uS".includes(w.text[j])) {
        const value = j + 1 < w.text.length ? { ...w, text: w.text.slice(j + 1) } : undefined
        options.push({ name, value, literal: !w.dyn && !w.glob }); break
      }
      if (shortArg.includes(w.text[j])) {
        const value = j + 1 < w.text.length ? { ...w, text: w.text.slice(j + 1) } : words[++i]
        options.push({ name, value, literal: !w.dyn && !w.glob }); break
      }
      options.push({ name, literal: !w.dyn && !w.glob })
    }
  }
  return { options, positional }
}

type FormSources = { aliases: Map<string, string[]>; functions: Map<string, string[]>; warn: any[] }
function formFunctionBodies(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const rx = /^([A-Za-z_][A-Za-z0-9_!-]*)\s*\(\)\s*\{/gm
  for (const m of text.matchAll(rx)) {
    const start = (m.index || 0) + m[0].length
    let depth = 1, quote = "", p = start
    for (; p < text.length; p++) {
      const c = text[p]
      if (c === "\\") { p++; continue }
      if (quote) { if (c === quote) quote = ""; continue }
      if (c === "'" || c === '"' || c === "`") { quote = c; continue }
      if (c === "#") { const e = text.indexOf("\n", p); p = e < 0 ? text.length : e; continue }
      if (c === "{") depth++
      else if (c === "}" && --depth === 0) break
    }
    if (!depth) out.push([m[1], text.slice(start, p)])
  }
  return out
}
export function formBase64Payload(text: string): string {
  return text.replace(/[\r\n]/g, "")
}

function formBase64(text: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const bytes: number[] = []
  let n = 0, bits = 0
  for (const c of text) {
    const v = alphabet.indexOf(c)
    if (v < 0) continue
    n = (n << 6) | v; bits += 6
    if (bits >= 8) { bits -= 8; bytes.push((n >> bits) & 255) }
  }
  return decodeURIComponent(bytes.map(n => "%" + n.toString(16).padStart(2, "0")).join(""))
}
async function formSources($: any, home: string, config = ""): Promise<FormSources> {
  const sources: FormSources = { aliases: new Map(), functions: new Map(), warn: [] }
  const dir = (config || home + "/.claude") + "/shell-snapshots"
  let entries: any
  try { entries = await $.fs.list(dir) } catch (x) {
    if (!fleetEnoent(x)) sources.warn.push({ c: "form-alias-source-unreadable", n: 0, q: "shell-snapshots", src: "Bash:command" })
    return sources
  }
  const add = (map: Map<string, string[]>, name: string, text: string) => {
    const values = map.get(name) || []
    if (!values.includes(text)) values.push(text)
    map.set(name, values)
  }
  for (const entry of Array.isArray(entries) ? entries : []) {
    const name = String(entry?.name || "")
    if (!/^snapshot-(?:zsh|bash)-[^/]+\.sh$/.test(name)) continue
    const got = await readText($, dir + "/" + name)
    if (got.unreadable || got.text === null) { sources.warn.push({ c: "form-alias-source-unreadable", n: 0, q: name, src: "Bash:command" }); continue }
    const text = got.text
    for (const line of text.split("\n")) {
      const m = /^alias -- ([^=\s]+)=(.*)$/.exec(line)
      if (!m) continue
      const scan = shellScan(m[2])
      const words = shellWords(m[2], 0, m[2].length, scan)
      if (words.length === 1 && !words[0].dyn) add(sources.aliases, m[1], words[0].text)
    }
    const bodies = formFunctionBodies(text)
    for (const m of text.matchAll(/^eval "\$\(echo '([A-Za-z0-9+/=\r\n]+)' \| base64 -d\)"/gm)) {
      try { bodies.push(...formFunctionBodies(formBase64(formBase64Payload(m[1])))) } catch (x) { sources.warn.push({ c: "form-alias-source-unreadable", n: 0, q: name, src: "Bash:command" }) }
    }
    for (const m of text.matchAll(/^eval "\$\(echo '([^']*)' \| base64 -d\)"/gm)) {
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(m[1])) sources.warn.push({ c: "form-alias-source-unreadable", n: 0, q: name, src: "Bash:command" })
    }
    for (const [name, body] of bodies) add(sources.functions, name, body)
  }
  return sources
}

// CONSTRAINT: alias recursion belongs to the substituted value, not to later
// independent commands; an expanded segment is never also judged in raw form.
function formExpand(text: string, sources: FormSources, warn: any[], seen: string[] = [], depth = 0, funcDepth = 0): string[] {
  let overflow = false
  const push = (list: string[], value: string): void => {
    if (list.includes(value)) return
    if (list.length >= FORM_VARIANTS_MAX) {
      overflow = true
      if (!warn.some(w => w.q === "form-fanout-exceeded variants")) warn.push({ c: "F", n: 0, q: "form-fanout-exceeded variants", src: "Bash:command", refuse: true })
    } else list.push(value)
  }
  const scan = shellScan(text)
  const replacements: Array<{ s: number; e: number; values: string[] }> = []
  for (const [s, e] of scan.segments()) {
    const ws = shellWords(text, s, e, scan)
    const w = ws.find(w => w.role === "command")
    if (!w || w.dyn) continue
    const aliases = !w.quoted && !seen.includes(w.text) ? sources.aliases.get(w.text) : undefined
    const funcs = sources.functions.get(w.text)
    if (!aliases && !funcs) continue
    if (aliases && depth >= 8) { warn.push({ c: "F", n: 1, q: "alias expansion too deep", src: "Bash:command", refuse: true }); continue }
    if (!aliases && funcDepth >= 3) { warn.push({ c: "F", n: 1, q: "git: вложение глубже 3 уровней не судится", src: "Bash:command", refuse: true }); continue }
    const values: string[] = []
    for (const value of aliases || funcs || []) {
      if (overflow) break
      const suffix = text.slice(w.end, e)
      if (aliases && /\s$/.test(value)) {
        const expandNext = (index: number, from: number, used: string[], level: number): string[] => {
          const next = ws[index]
          const extra = next && !next.quoted && !next.dyn && sources.aliases.get(next.text)
          if (!extra || used.includes(next.text)) return [text.slice(from, e)]
          if (level >= 8) { warn.push({ c: "F", n: 1, q: "alias expansion too deep", src: "Bash:command", refuse: true }); return [text.slice(from, e)] }
          const tails: string[] = []
          for (const v of extra) {
            if (overflow) break
            for (const expanded of formExpand(v, sources, warn, used.concat(next.text), level + 1, funcDepth)) {
              const rest = /\s$/.test(v) ? expandNext(index + 1, next.end, used.concat(next.text), level + 1) : [text.slice(next.end, e)]
              for (const tail of rest) push(tails, text.slice(from, next.at) + expanded + tail)
            }
          }
          return tails
        }
        for (const expanded of formExpand(value, sources, warn, seen.concat(w.text), depth + 1, funcDepth)) {
          for (const tail of expandNext(ws.indexOf(w) + 1, w.end, seen.concat(w.text), depth + 1)) push(values, text.slice(s, w.at) + expanded + tail)
        }
        continue
      }
      for (const expanded of formExpand(value, sources, warn, aliases ? seen.concat(w.text) : seen, aliases ? depth + 1 : depth, aliases ? funcDepth : funcDepth + 1)) {
        push(values, text.slice(s, w.at) + (aliases ? expanded : "(" + expanded + ")") + (aliases ? suffix : ""))
      }
    }
    replacements.push({ s, e, values })
  }
  let variants = [text]
  for (const replacement of replacements.sort((a, b) => b.s - a.s)) {
    const next: string[] = []
    for (const t of variants) for (const v of replacement.values) push(next, t.slice(0, replacement.s) + v + t.slice(replacement.e))
    variants = next
  }
  return variants
}

function gitSubDeep(tx: string, sub: string, lvl: number): boolean {
  const scan = shellScan(tx)
  if (gitSubWords(tx, scan, sub).length) return true
  if (lvl >= 8) return false
  for (let qi = 0; qi < scan.quotes.length; qi++) if (gitSubDeep(scan.quotes[qi].text, sub, lvl + 1)) return true
  for (let hi = 0; hi < scan.heredocs.length; hi++) if (gitSubDeep(scan.heredocs[hi].body, sub, lvl + 1)) return true
  return false
}

type FormTarget = { path: string; word: ShWord; append: boolean; body?: Heredoc; unknown: boolean }
const FORM_FILE_BYTES_MAX = 4 * 1024 * 1024
const FORM_TARGETS_MAX = 256
const FORM_VARIANTS_MAX = 64
const FORM_BACKUP_BYTES_MAX = 8 * FORM_FILE_BYTES_MAX
type FormMissingParent = { ancestor: string; real: string; tail: string[] }
type FormSaved = { path: string; kind: "file" | "link" | "absent"; backup: string | null; parentReal: string; parentMissing?: FormMissingParent; real?: string; link?: string; referent?: string; referentState?: FormSaved }
type FormFingerprint = { size: number; mtime: number; kind: string; real?: string; link?: string; digest?: string; sha256?: string }
type FormState = { p: any; targets: FormTarget[]; backups: FormSaved[]; skipped: string[]; before: Map<string, string>; fanout?: number; copyFlag?: string }

function formResolve(path: string, home: string, cwd: string): string {
  const parts: string[] = []
  const resolved = resolvePath(path, home, cwd)
  for (const part of resolved.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  return "/" + parts.join("/")
}

function isAppend(words: ShWord[]): boolean {
  return words.some(w => !w.dyn && !w.glob && (w.text === "--append" || /^-[^-]*a/.test(w.text)))
}

export async function formTargets($: any, command: string, cwd: string, home: string): Promise<FormTarget[]> {
  const scan = shellScan(command)
  const targets: FormTarget[] = []
  const add = async (word: ShWord, view: ShellView, append: boolean, exact: boolean) => {
    const own = scan.heredocs.filter(h => h.op >= view.s && h.op < view.e)
    const body = exact && !append && own.length && own[own.length - 1].quoted && own[own.length - 1].terminated ? own[own.length - 1] : undefined
    if (word.dyn || (view.cwd === null && !word.text.startsWith("/") && !word.text.startsWith("~/"))) {
      targets.push({ path: "", word, append, body, unknown: true }); return
    }
    const path = formResolve(word.text, home, view.cwd || cwd)
    const candidates = [path]
    if (word.glob) {
      const parts = path.split("/").filter(Boolean)
      let dirs = [""]
      for (let i = 0; i < parts.length; i++) {
        const names: string[] = []
        for (const dir of dirs) {
          if (!/[?*[(]/.test(parts[i])) { names.push(dir + "/" + parts[i]); continue }
          let entries: any
          try { entries = await $.fs.list(dir || "/") } catch (x) { if (!fleetEnoent(x)) noteLost("form-target-list", x, $); continue }
          for (const entry of Array.isArray(entries) ? entries : []) {
            const name = String(entry?.name || "")
            if (name.includes("/") || name === "." || name === "..") continue
            if (shellGlob(parts[i]).test(name)) names.push(dir + "/" + name)
          }
        }
        dirs = names
      }
      candidates.push(...dirs)
    }
    for (const candidate of [...new Set(candidates)]) targets.push({ path: candidate, word, append, body: word.glob ? undefined : body, unknown: false })
  }
  for (const view of shellViews(command, scan, cwd, home)) {
    const ws = view.words
    const cmd = ws.find(w => w.role === "command")
    const dataWriter = !!cmd && !cmd.dyn && (cmd.text === "cat" || cmd.text === "tee")
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i], next = ws[i + 1]
      if (w.role !== "redirection" || !next || next.role !== "target") continue
      if (!/^(?:\d*)?(?:&>>!?|&>!?|>>!?|>\||>!|>&|>)$/.test(w.text)) continue
      if (/>&$/.test(w.text) && !next.dyn && /^[0-9-]+$/.test(next.text)) continue
      const stdout = /^(?:1)?(?:&>>!?|&>!?|>>!?|>\||>!|>)$/.test(w.text)
      await add(next, view, />>/.test(w.text), stdout && dataWriter && !ws.some(w => w.role === "argument" && !w.text.startsWith("-")))
    }
    if (cmd && !cmd.dyn && cmd.text === "tee") {
      const operands: ShWord[] = [], options: ShWord[] = []
      let ended = false
      for (const w of ws.slice(ws.indexOf(cmd) + 1).filter(w => w.role === "argument")) {
        if (!ended && w.text === "--" && !w.dyn) { ended = true; continue }
        if (!ended && w.text.startsWith("-") && w.text !== "-") options.push(w)
        else operands.push(w)
      }
      for (const operand of operands) await add(operand, view, isAppend(options), true)
    }
    if (cmd && !cmd.dyn) {
      const writer = cmd.text.slice(cmd.text.lastIndexOf("/") + 1)
      const args = ws.slice(ws.indexOf(cmd) + 1).filter(w => w.role === "argument")
      if (writer === "dd") {
        for (const w of args) if (w.text.startsWith("of=")) await add({ ...w, text: w.text.slice(3) }, view, false, false)
      } else if (["cp", "mv", "install", "sed", "perl", "truncate", "ln"].includes(writer)) {
        const operands: ShWord[] = []
        const flags = new Set<string>()
        let ended = false, directory: ShWord | undefined, script = false
        const shortArgs = writer === "sed" ? "ef" : writer === "perl" ? "CDeEFiImMx" : writer === "truncate" ? "sr" : writer === "install" ? "tSmog" : "tS"
        const longArgs = ["target-directory", "suffix", "mode", "owner", "group", "context", "size", "reference", "expression", "file"]
        for (let i = 0; i < args.length; i++) {
          const w = args[i]
          if (!ended && !w.dyn && w.text === "--") { ended = true; continue }
          if (ended || !w.text.startsWith("-") || w.text === "-") { operands.push(w); continue }
          if (w.text.startsWith("--")) {
            const eq = w.text.indexOf("="), name = (eq < 0 ? w.text : w.text.slice(0, eq)).slice(2)
            flags.add(name)
            if (longArgs.includes(name)) {
              const value = eq >= 0 ? { ...w, text: w.text.slice(eq + 1) } : args[++i]
              if (name === "target-directory") directory = value
              if (["expression", "file"].includes(name)) script = true
            }
          } else for (let j = 1; j < w.text.length; j++) {
            const ch = w.text[j]; flags.add(ch)
            // perl reads a typed value after -0 (hex) and -d (module tail); a letter after the hex digits is a new switch, and perl 5.40.2 gives -x the rest of the word as its directory (-0x1Fpi: "Can't chdir to 1Fpi"), so the hex arm only adds candidates; R does not consume the octal value of -0/-l or a -d tail without ':'/'=': the digits fall through as inert flags and each letter after them is read as its own switch, which gives perl 5.40.2's candidates on every perl-diff row (-l7pi edits in place).
            if (writer === "perl" && "0d".includes(ch)) {
              const typed = ch === "0" ? /^(?:[xX][0-9a-fA-F]*)?/ : /^(?:[:=][\s\S]*)?/
              j += w.text.slice(j + 1).match(typed)![0].length
              continue
            }
            if (shortArgs.includes(ch)) {
              const value = j + 1 < w.text.length ? { ...w, text: w.text.slice(j + 1) } : writer !== "perl" || "eEI".includes(ch) ? args[++i] : undefined
              if (ch === "t") directory = value
              if ("ef".includes(ch)) script = true
              break
            }
            if ((writer === "sed" || writer === "perl") && ch === "i") break
          }
        }
        if (["cp", "mv", "install", "ln"].includes(writer)) {
          if (writer !== "ln" || ((flags.has("s") || flags.has("symbolic")) && (flags.has("f") || flags.has("force")))) {
            let dest = directory || operands[operands.length - 1]
            if (dest) {
              let isDir = !!directory
              if (!isDir && !flags.has("T") && !flags.has("no-target-directory") && !dest.dyn && !dest.glob && view.cwd !== null) {
                try { isDir = (await $.fs.stat(formResolve(dest.text, home, view.cwd))).kind === "dir" } catch (x) { if (!fleetEnoent(x)) noteLost("form-writer-stat", x, $) }
              }
              if (isDir) for (const source of directory ? operands : operands.slice(0, -1)) await add({ ...dest, text: dest.text.replace(/\/$/, "") + "/" + source.text.slice(source.text.lastIndexOf("/") + 1), dyn: dest.dyn || source.dyn, glob: dest.glob || source.glob }, view, false, false)
              else await add(dest, view, false, false)
            }
          }
        } else if (writer === "truncate" || flags.has("i") || flags.has("in-place")) {
          const paths = ((writer === "sed" && !script) || (writer === "perl" && !flags.has("e") && !flags.has("E"))) ? operands.slice(1) : operands
          for (const operand of paths) await add(operand, view, false, false)
        }
      }
    }
  }
  return targets.filter((t, i) => targets.findIndex(other => other.path === t.path && other.word.at === t.word.at) === i)
}

async function formLink($: any, path: string): Promise<string> {
  const result = await $.process.run(["/usr/bin/readlink", path], { timeoutMs: 5000 })
  if (result?.exitCode !== 0 || typeof result.stdout !== "string") throw new Error("readlink failed: " + path)
  return result.stdout.replace(/\n$/, "")
}
async function formPlatform($: any): Promise<string> {
  const platform = await $.process.run(["/usr/bin/uname", "-s"], { timeoutMs: 5000 })
  const name = String(platform?.stdout || "").trim()
  if (platform?.exitCode !== 0 || !["Linux", "Darwin"].includes(name)) throw new Error("platform unavailable for preserving copy")
  return name
}
function formParent(path: string): string { return path.slice(0, path.lastIndexOf("/")) || "/" }
async function formParentReal($: any, path: string): Promise<string> {
  const stat = await $.fs.stat(formParent(path), { resolve: true })
  if (typeof stat.realPath !== "string" || !stat.realPath) throw new Error("parent realPath unavailable: " + path)
  return stat.realPath
}
async function formSaveParent($: any, path: string): Promise<{ parentReal: string; parentMissing?: FormMissingParent }> {
  let ancestor = formParent(path)
  const tail: string[] = []
  for (;;) {
    try {
      const stat = await $.fs.stat(ancestor, { resolve: true })
      if (stat.kind !== "dir" || typeof stat.realPath !== "string" || !stat.realPath) throw new Error("parent realPath unavailable: " + path)
      return { parentReal: formResolve(tail.join("/"), "", stat.realPath), ...(tail.length ? { parentMissing: { ancestor, real: stat.realPath, tail } } : {}) }
    } catch (x) {
      if (!fleetEnoent(x) || ancestor === "/") throw x
      tail.unshift(ancestor.slice(ancestor.lastIndexOf("/") + 1))
      ancestor = formParent(ancestor)
    }
  }
}
async function formParentUnchanged($: any, saved: FormSaved): Promise<boolean> {
  try {
    if (await formParentReal($, saved.path) !== saved.parentReal) return false
    if (saved.parentMissing) {
      let path = saved.parentMissing.ancestor
      const ancestor = await $.fs.stat(path, { resolve: true })
      if (ancestor.realPath !== saved.parentMissing.real) return false
      for (const part of saved.parentMissing.tail) {
        path = formResolve(part, "", path)
        const stat = await $.fs.stat(path)
        if (stat.kind !== "dir" || stat.isLink) return false
      }
    }
    return true
  } catch (x) { if (fleetEnoent(x)) return false; throw x }
}
function formDecodeBytes(base64: string): { text: string; length: number } {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const bytes: number[] = []
  let n = 0, bits = 0
  for (const c of base64) {
    const v = alphabet.indexOf(c)
    if (v < 0) continue
    n = (n << 6) | v; bits += 6
    if (bits >= 8) { bits -= 8; bytes.push((n >> bits) & 255) }
  }
  // CONSTRAINT: fs text reads replace invalid UTF-8 and retain a leading BOM.
  const text: string[] = []
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++]
    if (a < 0x80) { text.push(String.fromCharCode(a)); continue }
    const width = a >= 0xc2 && a <= 0xdf ? 2 : a >= 0xe0 && a <= 0xef ? 3 : a >= 0xf0 && a <= 0xf4 ? 4 : 0
    if (!width) { text.push("�"); continue }
    let cp = a & (width === 2 ? 31 : width === 3 ? 15 : 7), used = 1
    for (; used < width && i < bytes.length; used++) {
      const b = bytes[i]
      const min = used === 1 && a === 0xe0 ? 0xa0 : used === 1 && a === 0xf0 ? 0x90 : 0x80
      const max = used === 1 && a === 0xed ? 0x9f : used === 1 && a === 0xf4 ? 0x8f : 0xbf
      if (b < min || b > max) break
      cp = (cp << 6) | (b & 63); i++
    }
    text.push(used === width ? String.fromCodePoint(cp) : "�")
  }
  return { text: text.join(""), length: bytes.length }
}
async function formFingerprint($: any, path: string, digest: boolean, allowAbsent = false, knownStat?: any, knownBytes?: string): Promise<FormFingerprint | null> {
  let stat = knownStat
  if (!stat) try { stat = await $.fs.stat(path) } catch (x) {
    return allowAbsent && fleetEnoent(x) ? { size: 0, mtime: 0, kind: "absent" } : null
  }
  let resolved: any
  try { resolved = await $.fs.stat(path, { resolve: true }) } catch (x) { return null }
  const fingerprint: FormFingerprint = { size: stat.size, mtime: stat.mtimeMs, kind: stat.isLink ? "link:" + stat.kind : stat.kind, real: resolved.realPath }
  if (stat.isLink) try { fingerprint.link = await formLink($, path) } catch (x) { return null }
  if (digest) {
    if (stat.size > FORM_FILE_BYTES_MAX) {
      try {
        const linux = await formPlatform($) === "Linux"
        const result = await $.process.run(linux ? ["/usr/bin/sha256sum", "--", path] : ["/usr/bin/shasum", "-a", "256", "--", path], { timeoutMs: 5000 })
        const output = String(result?.stdout || "").replace(/\n$/, "")
        if (result?.exitCode !== 0 || !/^[a-fA-F0-9]{64}  /.test(output) || output.slice(66) !== path) return null
        fingerprint.sha256 = output.slice(0, 64).toLowerCase()
      } catch (x) { return null }
    } else {
      const bytes = knownBytes === undefined ? await $.fs.read(path, { as: "bytes" }) : { base64: knownBytes }
      if (!bytes || typeof bytes.base64 !== "string") throw new Error("form byte read has no base64: " + path)
      // CONSTRAINT: full byte encoding is collision-free; metadata alone is only Ф12a's unreadable fallback.
      fingerprint.digest = bytes.base64
    }
  }
  return fingerprint
}
async function formRestoreObject($: any, state: FormState, saved: FormSaved, warn: (code: string, path: string) => void): Promise<boolean> {
  if (!await formParentUnchanged($, saved)) { warn("form-rollback-skipped-retargeted", saved.path); return false }
  if (saved.kind === "absent") {
    const result = await $.process.run(["/bin/rm", "-f", "--", saved.path], { timeoutMs: 5000 })
    if (result?.exitCode !== 0) throw new Error("restore exit " + String(result?.exitCode))
    return true
  }
  if (!saved.backup) throw new Error("missing backup: " + saved.path)
  const temp = saved.parentReal.replace(/\/$/, "") + "/." + saved.path.slice(saved.path.lastIndexOf("/") + 1) + ".form-restore." + crypto.randomUUID()
  let misplaced = ""
  try {
    const copied = await $.process.run(["/bin/cp", state.copyFlag!, "--", saved.backup, temp], { timeoutMs: 5000 })
    if (copied?.exitCode !== 0) throw new Error("restore copy exit " + String(copied?.exitCode))
    let current: any = null
    try { current = await $.fs.stat(saved.path) } catch (x) { if (!fleetEnoent(x)) throw x }
    if (current?.kind === "dir" && !current.isLink) { warn("form-rollback-skipped-nonfile", saved.path); return false }
    if (!await formParentUnchanged($, saved)) { warn("form-rollback-skipped-retargeted", saved.path); return false }
    const destinationFlag = await formPlatform($) === "Linux" ? "-T" : "-h"
    const moved = await $.process.run(["/bin/mv", "-f", destinationFlag, "--", temp, saved.path], { timeoutMs: 5000 })
    if (moved?.exitCode !== 0) throw new Error("restore move exit " + String(moved?.exitCode))
    const restored = await $.fs.stat(saved.path)
    if (restored.kind === "dir") {
      const resolved = await $.fs.stat(saved.path, { resolve: true })
      if (resolved.realPath) misplaced = resolved.realPath.replace(/\/$/, "") + "/" + temp.slice(temp.lastIndexOf("/") + 1)
    }
    const actual = !restored.isLink && restored.kind === "file" ? await formFingerprint($, saved.path, true, false, restored) : null
    const expected = await formFingerprint($, saved.backup, true)
    if (!actual || !expected || actual.digest !== expected.digest || actual.sha256 !== expected.sha256) throw new Error("destination changed during restore")
    return true
  } finally {
    for (const path of [temp, ...(misplaced ? [misplaced] : [])]) try {
      const removed = await $.process.run(["/bin/rm", "-f", "--", path], { timeoutMs: 5000 })
      if (removed?.exitCode !== 0) noteLost("form-restore-cleanup", new Error(path + ": rm exit " + String(removed?.exitCode)), $)
    } catch (x) { noteLost("form-restore-cleanup", x, $) }
  }
}
async function formBackup($: any, state: FormState, world: any, env: any, ev: any, budget: { bytes: number }): Promise<string | null> {
  if (state.fanout) return null
  for (const target of state.targets) {
    try {
      const stat = await $.fs.stat(target.path)
      state.before.set(target.path, stat.isLink ? "link" : stat.kind)
    } catch (x) { state.before.set(target.path, fleetEnoent(x) ? "absent" : "unknown") }
  }
  let prepared = false
  for (const target of state.targets) {
    const classes = new Set<string>(["F"])
    if (K(state.p.cfg.brief_path, "u", "brief_path").test(target.path)) for (const cls of ["A1", "A2", "A3"]) classes.add(cls)
    if (K(state.p.cfg.report_path, "u", "report_path").test(target.path)) classes.add("C1")
    if (![...classes].some(cls => ["cancel", "refuse"].includes(formActOf(state.p.cfg, cls)))) continue
    if (state.backups.some(b => b.path === target.path)) continue
    try {
      let stat: any = null
      try { stat = await $.fs.stat(target.path, { resolve: true }) } catch (x) { if (!fleetEnoent(x)) throw x }
      const saved: FormSaved = { path: target.path, kind: !stat ? "absent" : stat.isLink ? "link" : "file", backup: null, ...await formSaveParent($, target.path), real: stat?.realPath }
      state.backups.push(saved)
      let copyFrom = target.path
      if (saved.kind === "link") {
        saved.link = await formLink($, target.path)
        saved.referent = stat.realPath || formResolve(saved.link, "", formParent(target.path))
        copyFrom = saved.referent
        try { stat = await $.fs.stat(copyFrom, { resolve: true }) } catch (x) { if (fleetEnoent(x)) stat = null; else throw x }
        saved.referentState = { path: copyFrom, kind: stat ? "file" : "absent", backup: null, ...await formSaveParent($, copyFrom), real: stat?.realPath }
      }
      if (!stat) continue
      if (stat.kind !== "file") throw new Error("not a regular referent: " + copyFrom)
      budget.bytes += stat.size
      if (budget.bytes > FORM_BACKUP_BYTES_MAX) throw new Error("backup volume exceeded")
      if (!prepared) {
        state.copyFlag = await formPlatform($) === "Linux" ? "--preserve=all" : "-p"
        const dir = world.globalHome + "/form-backup"
        const made = await $.process.run(["/bin/mkdir", "-p", "-m", "700", "--", dir], { timeoutMs: 5000 })
        if (made?.exitCode !== 0) throw new Error("mkdir exit " + String(made?.exitCode))
        const privateDir = await $.process.run(["/bin/chmod", "700", "--", dir], { timeoutMs: 5000 })
        if (privateDir?.exitCode !== 0) throw new Error("chmod exit " + String(privateDir?.exitCode))
        prepared = true
      }
      saved.backup = world.globalHome + "/form-backup/" + crypto.randomUUID()
      if (saved.referentState) saved.referentState.backup = saved.backup
      const result = await $.process.run(["/bin/cp", state.copyFlag!, "--", copyFrom, saved.backup], { timeoutMs: 5000 })
      if (result?.exitCode !== 0) throw new Error("cp exit " + String(result?.exitCode))
    } catch (x) { return "form-backup-failed: " + target.path + ": " + safeText(x) }
  }
  return null
}

async function formCleanup($: any, states: FormState[]): Promise<void> {
  for (const state of states) for (const saved of state.backups) {
    if (!saved.backup) continue
    try {
      const result = await $.process.run(["/bin/rm", "-f", "--", saved.backup], { timeoutMs: 5000 })
      if (result?.exitCode !== 0) noteLost("form-backup-cleanup", new Error(saved.backup + ": rm exit " + String(result?.exitCode)), $)
    } catch (x) { noteLost("form-backup-cleanup", x, $) }
  }
}

export async function formPost($: any, state: FormState, env: any, world: any, ev: any): Promise<string | null> {
  if (state.fanout) return null
  const events: any[] = [], failures: any[] = [], warns: any[] = [], rollback = new Set<string>()
  const judged = new Map<string, FormFingerprint | null>()
  const conflicts = new Set<string>()
  const remember = (path: string, fingerprint: FormFingerprint | null) => {
    if (judged.has(path)) {
      if (JSON.stringify(judged.get(path)) !== JSON.stringify(fingerprint)) conflicts.add(path)
    } else judged.set(path, fingerprint)
  }
  const actionable = (refuse: any[]) => refuse.some(r => ["cancel", "refuse"].includes(formActOf(state.p.cfg, r.c)))
  for (const target of state.targets) {
    let stat: any, got: any, bytes: string | undefined, problem = "", digest = true, absent = false, unstable = false
    try { stat = await $.fs.stat(target.path) } catch (x) {
      if (fleetEnoent(x)) absent = true
      else { problem = "target unreadable after write: " + safeText(x); noteLost("form-path-read", x, $) }
    }
    if (stat?.size > FORM_FILE_BYTES_MAX) problem = "target too large to judge"
    else if (stat) {
      try {
        const raw = await $.fs.read(target.path, { as: "bytes" })
        if (!raw || typeof raw.base64 !== "string") throw new Error("form byte read has no base64: " + target.path)
        bytes = raw.base64
        const decoded = formDecodeBytes(bytes)
        got = { text: decoded.text }
        const after = await $.fs.stat(target.path)
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || decoded.length !== stat.size) {
          problem = "target changed during judgement"; unstable = true
        }
      } catch (x) {
        if (fleetEnoent(x)) absent = true
        else {
          problem = "target unreadable after write: " + safeText(x)
          digest = false
          noteLost("form-path-read", x, $)
        }
      }
    }
    if (absent) {
      if (state.before.get(target.path) === "absent") continue
      problem = "target removed after write"
    }
    if (problem) {
      const refusal = { c: "F", n: 0, q: problem, src: "Bash:" + target.path }
      failures.push(refusal)
      if (actionable([refusal])) rollback.add(target.path)
    } else {
      const kind = formKind(target.path, got.text, state.p.cfg)
      if (kind) {
        const event = { kind, text: got.text, label: "Bash:" + target.path, judged: await formEval({ kind, text: got.text }, state.p.cfg) }
        events.push(event)
        if (actionable(event.judged.refuse)) rollback.add(target.path)
      }
    }
    if (!rollback.has(target.path)) continue
    let fingerprint: FormFingerprint | null = absent && !stat ? { size: 0, mtime: 0, kind: "absent" } : null
    if (stat && !unstable) {
      try { fingerprint = await formFingerprint($, target.path, digest && !absent, false, stat, bytes) } catch (x) {
        failures.push({ c: "F", n: 0, q: "target unreadable after write", src: "Bash:" + target.path })
        fingerprint = await formFingerprint($, target.path, false, false, stat)
      }
    }
    remember(target.path, fingerprint)
    const saved = state.backups.find(saved => saved.path === target.path)
    if (saved?.referent && saved.referent !== target.path) {
      let referent: FormFingerprint | null = null
      let reused = false
      if (fingerprint && !absent) try {
        const resolved = await $.fs.stat(target.path, { resolve: true })
        const referentStat = await $.fs.stat(saved.referent)
        if (resolved.realPath === saved.referent && resolved.size === stat?.size && resolved.mtimeMs === stat?.mtimeMs && referentStat.size === resolved.size && referentStat.mtimeMs === resolved.mtimeMs) {
          referent = await formFingerprint($, saved.referent, digest, true, referentStat, bytes)
          reused = true
        }
      } catch (x) {}
      if (!reused) {
        try { referent = await formFingerprint($, saved.referent, true, true) } catch (x) { referent = await formFingerprint($, saved.referent, false, true) }
      }
      remember(saved.referent, referent)
    }
  }
  const denial = await runForm($, state.p, env, world, { ...ev, formPost: events, formRefuse: failures, formWarn: warns, formSkipped: state.skipped })
  let failed = ""
  const skipWarnings: any[] = []
  const warn = (code: string, path: string) => skipWarnings.push({ c: code, n: 0, q: code + " " + path, src: "Bash:" + path })
  for (const saved of state.backups) {
    if (!rollback.has(saved.path)) continue
    try {
      const condemnedTarget = judged.get(saved.path)
      const expectedReal = saved.real || formResolve(saved.path.slice(saved.path.lastIndexOf("/") + 1), "", saved.parentReal)
      if (condemnedTarget?.real && condemnedTarget.real !== expectedReal) warn("form-rollback-unrestored", condemnedTarget.real)
      const objects = [saved, ...(saved.referentState ? [saved.referentState] : [])]
      if (objects.some(object => conflicts.has(object.path))) { warn("form-rollback-skipped-changed", saved.path); continue }
      let retargeted = false
      for (const object of objects) if (!await formParentUnchanged($, object)) { warn("form-rollback-skipped-retargeted", object.path); retargeted = true }
      if (retargeted) continue
      let skip = ""
      for (const path of [...new Set([saved.path, ...(saved.referent ? [saved.referent] : [])])]) {
        const condemned = judged.get(path)
        if (!condemned) { skip = "form-rollback-skipped-unfingerprintable"; break }
        let current: FormFingerprint | null = null
        try { current = await formFingerprint($, path, condemned.digest !== undefined || condemned.sha256 !== undefined, condemned.kind === "absent") } catch (x) { current = null }
        if (!current || JSON.stringify(current) !== JSON.stringify(condemned)) { skip = "form-rollback-skipped-changed"; break }
      }
      if (skip) { warn(skip, saved.path); continue }
      if (saved.kind === "link") {
        if (!saved.referentState) throw new Error("missing referent state: " + saved.path)
        if (!await formRestoreObject($, state, saved.referentState, warn)) continue
        if (!await formParentUnchanged($, saved)) { warn("form-rollback-skipped-retargeted", saved.path); continue }
        let current: any = null
        try { current = await $.fs.stat(saved.path) } catch (x) { if (!fleetEnoent(x)) throw x }
        if (current?.kind === "dir" && !current.isLink) { warn("form-rollback-skipped-nonfile", saved.path); continue }
        const destinationFlag = await formPlatform($) === "Linux" ? "-T" : "-h"
        const linked = await $.process.run(["/bin/ln", "-s", "-f", destinationFlag, "--", saved.link!, saved.path], { timeoutMs: 5000 })
        if (linked?.exitCode !== 0) throw new Error("link restore exit " + String(linked?.exitCode))
        const restored = await $.fs.stat(saved.path)
        if (!restored.isLink || await formLink($, saved.path) !== saved.link) throw new Error("destination changed during restore")
      } else await formRestoreObject($, state, saved, warn)
    } catch (x) {
      const verdict = "rollback failed: " + saved.path + (safeText(x).includes("destination changed during restore") ? ": destination changed during restore" : "")
      failed += (failed ? "; " : "") + verdict
      noteLost("form-rollback", x, $)
      try { await appendJournal($, world.globalHome + "/form/journal.jsonl", { outcome: "error", level: "error", verdict, probe: "form" }) } catch (y) { noteLost("form-rollback-journal", y, $) }
    }
  }
  if (skipWarnings.length) await runForm($, state.p, env, world, { ...ev, formPost: [], formWarn: skipWarnings, formMergeWarnings: true })
  const refusal = denial ? denial + (skipWarnings.length ? "; " + skipWarnings.map(w => w.q).join("; ") : "") : ""
  return [refusal, failed].filter(Boolean).join("; ") || null
}

const formCanonLogged = new Set<string>()
async function runForm($: any, p: any, env: any, world: any, ev: any, states?: FormState[]): Promise<string | null> {
  const cfg = p.cfg
  const tool = String((ev && ev.tool) || "")
  if (!formActsOnTool(tool)) return null
  const missing = FORM_REQ.filter(key => typeof cfg[key] !== "string" || !cfg[key])
  if (typeof cfg.path_lines_min !== "number") missing.push("path_lines_min")
  if (missing.length) {
    for (const key of missing) if (!formCanonLogged.has(key)) {
      formCanonLogged.add(key)
      try { await $.ui.log("form-canon-key-missing " + key) } catch (x) { noteLost("form-canon-log", x, $) }
    }
    ev = { ...ev, formRefuse: missing.map(key => ({ c: "F", n: 0, q: "form-canon-key-missing " + key, src: tool })) }
  }
  const evs: any[] = []
  const sk: string[] = []
  const unreadWarns: any[] = []
  const noteUnread = (fp: string, label: string, why: string) => {
    noteLost("form-path-read", new Error(fp + ": " + why), $)
    unreadWarns.push({ c: "target-unreadable", n: 0, q: clip(why, 160), src: label })
  }
  const byPath = async (fp: string) => {
    const got = await readText($, fp)
    if (got.unreadable) { noteUnread(fp, tool + ":" + fp, got.unreadable); return }
    const t = got.text
    if (t === null) return
    const k = formKind(fp, t, cfg)
    if (k) evs.push({ kind: k, text: t, label: tool + ":" + fp })
    else sk.push(fp)
  }
  if (missing.length) {
    // CONSTRAINT: incomplete canon must not enter regex-dependent judgments.
  } else if (tool === "Agent" || tool === "Task" || tool === "SendMessage") {
    const tx = String((ev && (ev.prompt || ev.message || ev.text)) || "")
    const pu: string[] = []
    for (const m of tx.matchAll(K(cfg.brief_ref, "gu", "brief_ref"))) {
      if (m[0].length === 0) continue
      const rp = resolvePath(m[0], env.HOME, world.cwd)
      if (pu.indexOf(rp) < 0) pu.push(rp)
      if (pu.length >= 4) break
    }
    for (let i = 0; i < pu.length; i++) await byPath(pu[i])
    if (tool === "SendMessage") evs.push({ kind: "message", text: tx, label: "SendMessage:message" })
  } else if (tool === "Write") {
    const fp = String((ev && ev.file_path) || "")
    const ct = String((ev && ev.content) || "")
    const k = formKind(fp, ct, cfg)
    if (k) evs.push({ kind: k, text: ct, label: "Write:" + fp })
    else sk.push(fp)
  } else if (tool === "Edit") {
    const fp = String((ev && ev.file_path) || "")
    const gotE = await readText($, fp)
    if (gotE.unreadable) noteUnread(fp, "Edit:" + fp, gotE.unreadable)
    const cur = gotE.unreadable ? null : gotE.text
    if (cur !== null) {
      const oldS = String((ev && ev.old_string) || "")
      const newS = String((ev && ev.new_string) || "")
      const post = ev && ev.replace_all ? cur.split(oldS).join(newS) : cur.replace(oldS, newS)
      const k = formKind(fp, post, cfg)
      if (k) evs.push({ kind: k, text: post, label: "Edit:" + fp })
      else sk.push(fp)
    }
  } else if (ev.formPost) {
    evs.push(...ev.formPost)
    unreadWarns.push(...(ev.formWarn || []))
    sk.push(...(ev.formSkipped || []))
  } else {
    const cmd = String((ev && ev.command) || "")
    const sources = await formSources($, env.HOME, env.CONFIG_DIR)
    unreadWarns.push(...sources.warn)
    const variants = formExpand(cmd, sources, unreadWarns)
    const targets: FormTarget[] = [], candidatePaths = new Set<string>()
    for (const variant of variants) {
      for (const target of await formTargets($, variant, world.cwd, env.HOME)) {
        if (target.unknown) {
          const code = target.word.dyn ? "form-target-dynamic" : "form-cwd-unknown"
          unreadWarns.push({ c: code, n: 0, q: code + " " + target.word.text, src: "Bash:target" })
          continue
        }
        candidatePaths.add(target.path)
        if (!K(cfg.write_target, "u", "write_target").test(target.path)) continue
        const kind = formKind(target.path, target.body ? target.body.body : "", cfg)
        if (!kind) { sk.push(target.path); continue }
        if (!targets.some(t => t.path === target.path)) targets.push(target)
        // CONSTRAINT: только точное полное содержимое даёт пред-суд; append судится после next.
        if (target.body) {
          const judged = await formEval({ kind, text: target.body.body }, cfg)
          if (judged.refuse.some(r => ["cancel", "refuse"].includes(formActOf(cfg, r.c)))) evs.push({ kind, text: target.body.body, label: "Bash:" + target.path, judged })
        }
      }
    }
    const fanout = candidatePaths.size > FORM_TARGETS_MAX ? candidatePaths.size : undefined
    if (fanout) {
      unreadWarns.push({ c: "F", n: 0, q: "form-fanout-exceeded " + fanout, src: "Bash:command", refuse: true })
      if (!["cancel", "refuse"].includes(formActOf(cfg, "F"))) unreadWarns.push({ c: "form-post-skipped-fanout", n: 0, q: "form-post-skipped-fanout " + fanout, src: "Bash:command" })
    }
    if ((targets.length || fanout) && states) states.push({ p, targets, backups: [], skipped: sk.slice(), before: new Map(), fanout })
    if (variants.some(text => gitCalls(text, shellScan(text), world.cwd, env.HOME).some(call => ["commit", "push", "unknown"].includes(call.sub)) || gitSubDeep(text, "commit", 0) || gitSubDeep(text, "push", 0))) evs.push({ kind: "command", text: cmd, label: "Bash:command", cwd: world.cwd, home: env.HOME, sources,
      readMessage: async (path: string) => {
        const got = await readText($, path)
        return got
      },
    })
  }
  if (!evs.length && !unreadWarns.length && !ev.formRefuse?.length) return null
  const rf: any[] = (ev.formRefuse || []).concat(unreadWarns.filter(issue => issue.refuse))
  const wn: any[] = unreadWarns.filter(issue => !issue.refuse)
  const cls: string[] = []
  for (let i = 0; i < evs.length; i++) {
    const r2 = evs[i].judged || await formEval(evs[i], cfg)
    for (let j = 0; j < r2.refuse.length; j++) rf.push(Object.assign({}, r2.refuse[j], { src: evs[i].label }))
    for (let j = 0; j < r2.warn.length; j++) wn.push(Object.assign({}, r2.warn[j], { src: evs[i].label }))
  }
  for (let i = 0; i < rf.length; i++) if (cls.indexOf(rf[i].c) < 0) cls.push(rf[i].c)
  for (let i = 0; i < wn.length; i++) if (cls.indexOf(wn[i].c) < 0) cls.push(wn[i].c)
  const vk = rf.length ? "refuse" : (wn.length ? "warn" : "pass")
  const src3 = rf[0] || wn[0]
  const lbl = src3 ? src3.src : (evs[0] ? evs[0].label : tool)
  const cnts = cls.map((c3) => c3 + "×" + rf.concat(wn).filter((x) => x.c === c3).length).join(", ")
  // CONSTRAINT: прописной вид строится из emits дома пробы "form"; строчные
  // pass/warn/refuse -- поле outcome улики, отдельное от verdict, и в доме
  // не участвуют.
  const upper = formVerdictUpper(vk)
  // CONSTRAINT (#375): рассогласование дома и правил формы -- ОТКАЗ ПРИБОРА, а
  // не пустой вид. Пока голова vd собиралась тернаром, улика и журнальная
  // строка уходили на диск с пустым видом, и «вердикта нет» становилось
  // неотличимо от «вердикт есть»: увидеть подмену можно было только сличением
  // двух домов. ГРАНИЦА отказа -- ровно построение вида: вызов без событий
  // формы вернулся выше (evs.length), чужие пробы сюда не заходят, и отказ не
  // вправе гасить ничего за пределами этой точки.
  if (upper === null) {
    const why = formVocabRefusal(vk)
    try {
      await appendJournal($, world.globalHome + "/form/journal.jsonl", {
        t: isoOf(await nowMs($)), tool, outcome: "form-vocab-refused",
        verdict: clip(why, 400), cls, jm: "rules", tries: 0,
        carrier: carrierOfJournal(p, env), sid: await sidFor($), probe: "form",
      })
    } catch (x) { noteLost("journal-form-vocab-refused", x, $) }
    return "Form probe refused the call (not the routing gate): " + why +
      " -- the probe returns deny instead of writing a record with an empty verdict kind."
  }
  const vd = upper + ": " +
    (vk === "pass" ? lbl : cnts + " — " + lbl + " — " + (src3 ? src3.c : "") + " :" + (src3 ? src3.n : "") + " " + (src3 ? src3.q : ""))
  const t0 = await nowMs($)
  const recName = "mod-" + String((ev && ev.tool_use_id) || "noid") + ".json"
  const jpath = world.globalHome + "/form/journal.jsonl"
  const recPath = world.globalHome + "/form/records/" + recName
  let formJournalErr = ""
  try {
    await appendJournal($, jpath, {
      t: isoOf(t0), tool, outcome: vk, verdict: clip(vd, 400),
      cls, jm: "rules", tries: 0, rec: recName, carrier: carrierOfJournal(p, env), sid: await sidFor($), probe: "form",
      skipped: sk.slice(0, 8),
      // CONSTRAINT (#489-B1-FIX5 Z16): срез восьми молча терял остаток; полное
      // число пропусков несёт отдельное поле, срез остаётся прежним домом.
      skippedN: sk.length,
    })
  } catch (x) {
    formJournalErr = safeText(x).slice(0, 240)
  }
  if (vk !== "pass") {
    // CONSTRAINT (#374): улика формы несёт вид ОТДЕЛЬНЫМ полем kind, как и
    // улика судьи. Пока вид жил только внутри склеенной строки vd, проектор
    // прибора (judge/compact.py, _line_from_mod) не мог определить класс
    // свёртки записи формы ВООБЩЕ -- поля kind у неё не было, и проход
    // `--probe form` упирался бы в улику без вида. Поле добавлено, а не
    // выведено разбором строки: разбор склейки -- второй дом формата.
    const formRec: any = { ev: tool, cls, refuse: rf, warn: wn, vd, kind: upper, rest: vd.slice(upper.length + 2) }
    if (formJournalErr) formRec.journalErr = formJournalErr
    try {
      if (ev.formMergeWarnings) {
        const previous = await readText($, recPath)
        if (previous.unreadable || previous.text === null) throw new Error("form record unavailable for warning merge: " + recPath)
        const record = JSON.parse(previous.text)
        // CONSTRAINT: rollback warnings share the original evidence; kind/refuse/vd are immutable here.
        record.warn = (record.warn || []).concat(wn)
        record.cls = [...new Set((record.cls || []).concat(cls))]
        if (formJournalErr) record.journalErr = formJournalErr
        await $.fs.write(recPath, JSON.stringify(record))
      } else await $.fs.write(recPath, JSON.stringify(formRec))
    } catch (x) { noteLost("form-record", x, $) }
  }
  if (vk === "refuse") {
    let cancel = false
    for (let i = 0; i < rf.length; i++) {
      if (["cancel", "refuse"].includes(formActOf(cfg, rf[i].c))) cancel = true
    }
    if (cancel) {
      const reason = cls.map((c) => formTextOf(cfg, c)).join("; ")
      return "Form probe refused the call (not the routing gate). " + reason
    }
  }
  return null
}

function builtinTrigger(p: any, ev: any, ctx: any): boolean {
  const tool = String((ev && ev.tool) || "")
  if (p.id === "judge") return tool === "Agent" || tool === "Task"
  return false
}

// CONSTRAINT: предикат idle-watch -- README «Thresholds» (порядок отказов:
// живая работа, счёт окна, незаполненное окно, cooldown); текущий запуск
// Agent/Task учтён до счёта. "" -- все условия прошли; "when-bad" -- флот
// неизвестен: неизвестный флот не пустой, причина уходит в when_bad.
function idleGate(p: any, ctx: any, lst: any[] | null, now: number): string {
  if (lst === null) { addWhenBad(ctx, "unknown=live_works"); return "when-bad" }
  const cfg = p.cfg || {}
  const kinds = idleKindsOf(cfg)
  let liveN = 0
  for (let i = 0; i < lst.length; i++) {
    const a = lst[i]
    if (!a) continue
    const st = String(a.status)
    if (st !== "running" && st !== "pending") continue
    if (kinds.indexOf(liveKindOf(a)) >= 0) liveN++
  }
  if (liveN >= num(cfg.live_threshold, 1, 0)) return "live-work:" + liveN
  const winMs = num(cfg.window_min, 30, 0) * 60000
  let launches = 0
  for (let i = 0; i < probeLaunches.length; i++) if (now - probeLaunches[i] < winMs && now >= probeLaunches[i]) launches++
  if (launches >= num(cfg.threshold, 1, 0)) return "window-count:" + launches
  const born = sessionStartAt === null ? now : sessionStartAt
  if (now - born < winMs) return "window-not-filled"
  const cd = idleCooldownMs(cfg)
  const last = Number(ctx.last_consultation || 0)
  if (last && now - last < cd) return "cooldown"
  return ""
}

// CONSTRAINT: один дом cooldown idle-watch -- для idleGate и поздней
// перепроверки probeMarkTake (две копии разошлись бы молча).
function idleCooldownMs(cfg: any): number {
  return num(cfg && cfg.cooldown_min, 30, 0) * 60000
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
  try { ks = Object.keys(c) } catch (x) { noteLost("turn-step-chunk-keys", x); return true }
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
      // CONSTRAINT (#489-B1-FIX5 Z13.4): СВОЙСТВО next читается один раз на
      // итератор; шаг зовёт сохранённое значение -- повторное обращение было бы
      // новым чтением геттера хоста.
      const itNext = it.next
      const wrap: any = {
        next: async () => {
          const r = await itNext.call(it)
          const done = r.done
          const value = r.value
          if (!done) {
            emitted.n++
            if (chunkCarriesContent(value)) emitted.content++
            // CONSTRAINT (обязательная вторая половина адъюдикации #242b):
            // алфавит kind обязан расти ЗАМЕРОМ, а не догадкой -- каждый вид,
            // впервые встреченный на этой дороге, уезжает в улику попытки.
            // Потолок 16 держит размер улики: алфавит шире шестнадцати сам по
            // себе есть находка, и её видно по достижению потолка.
            let k = "?"
            if (value != null && typeof value === "object") {
              try {
                k = String((value as any).kind)
              } catch (x) {
                noteLost("turn-step-chunk-kind", x)
                k = "?unprintable"
              }
            }
            if (emitted.kinds.length < 16 && emitted.kinds.indexOf(k) < 0) {
              emitted.kinds.push(k)
            }
          }
          return { done, value }
        },
      }
      const returnMethod = it.return
      const throwMethod = it.throw
      if (typeof returnMethod === "function") wrap.return = (v: any) => returnMethod.call(it, v)
      if (typeof throwMethod === "function") wrap.throw = (x: any) => throwMethod.call(it, x)
      return wrap
    },
  }
}

// CONSTRAINT: пометка агента ставится на КАЖДОМ куске до его выдачи хосту и
// только на куске (конец потока -- не активность); без часов и без await.
// Форма -- как у countEmitted: next, return, throw исходного итератора читаются
// по одному разу, return()/throw() потребителя доходят до потока.
function touchEach(src: any, aid: string): any {
  return {
    [Symbol.asyncIterator]: () => {
      const it: any = src[Symbol.asyncIterator]()
      const itNext = it.next
      const wrap: any = {
        next: async () => {
          const r = await itNext.call(it)
          const done = r.done
          const value = r.value
          if (!done) {
            try { staleRecOf(aid).touched = true } catch (x) { noteLost("stale-agents-track", x) }
          }
          return { done, value }
        },
      }
      const returnMethod = it.return
      const throwMethod = it.throw
      if (typeof returnMethod === "function") wrap.return = (v: any) => returnMethod.call(it, v)
      if (typeof throwMethod === "function") wrap.throw = (x: any) => throwMethod.call(it, x)
      return wrap
    },
  }
}

// CONSTRAINT: turn.step STREAMS -- простая async роняет загрузку ВСЕГО модуля.
// next() бывает генератором или значением; ветка по Symbol.asyncIterator.
async function* driveNext(
  n: any,
  emitted?: { n: number; content: number; kinds: string[] },
  aid?: string,
): AsyncGenerator<any, any, any> {
  const iteratorMethod = n == null ? undefined : n[Symbol.asyncIterator]
  if (typeof iteratorMethod === "function") {
    let src: any = { [Symbol.asyncIterator]: () => iteratorMethod.call(n) }
    if (aid != null) src = touchEach(src, aid)
    if (emitted == null) return yield* src
    return yield* countEmitted(src, emitted)
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
  // CONSTRAINT: текст броска хост не передаёт; скобка — только из поля message контракта либо из самого значения вне контракта.
  let kind: any
  let kindRead = false
  if (err != null && typeof err === "object") {
    try {
      kind = err.kind
      kindRead = true
    } catch (y) {
      kindRead = false
    }
  }
  const timedOut = !!(kindRead && kind === "timeout")
  const contract = err != null && typeof err === "object" && kindRead && typeof kind === "string" && kind !== ""
  const why = timedOut ? "timed out without answering" : "threw"
  // CONSTRAINT (#391): текст броска доезжает до оператора -- отказ обязан
  // называть СВОЮ причину, а не только факт. Fail-closed не ослабляется.
  let msg = ""
  if (err == null) {
    msg = ""
  } else if (contract) {
    let raw: any
    let hasMsg = false
    try {
      const v = err.message
      raw = v
      hasMsg = v != null
    } catch (y) {
      hasMsg = false
    }
    if (hasMsg) msg = " (" + safeText(raw).slice(0, 200) + ")"
  } else {
    msg = " (" + safeText(err).slice(0, 200) + ")"
  }
  return {
    deny:
      "Subagent dispatch cancelled: the catalyst-probes " + event + " hook " + why + msg +
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

// --- idle-watch: висящие агенты сессии и счёт флота сессий -------------------
// CONSTRAINT: $.agent.list отдаёт агентов ТОЛЬКО своей сессии, общего реестра
// флота у хоста нет -- счёт флота собирается из файлов, которые каждая сессия
// публикует сама в <globalHome>/idle-watch/fleet/.
export const STALE_AGENTS_PERIOD_MS = 60000
export const FLEET_FRESH_MS = 180000
export const FLEET_PRUNE_AGE_MS = 24 * 3600 * 1000
export const FLEET_PRUNE_EVERY_MS = 3600 * 1000
export const FLEET_TOOL = "fleet_status"
export const FLEET_TOOL_FULL = "mcp__catalyst-probes__fleet_status"
export const FLEET_TOOL_DESCRIPTION = "Сколько субагентов сейчас запущено во всех сессиях Claude Code на этой машине и в этой сессии"
export const FLEET_COMMAND = "catalyst-fleet"
export const FLEET_COMMAND_DESCRIPTION = "Сколько субагентов сейчас запущено во всех сессиях Claude Code на этой машине и в этой сессии."

// CONSTRAINT: хуки не ждут и не читают часы хоста: они ставят только флаг
// touched и вызов в полёте без времени; время -- now тика (точность ±1 период).
type StaleRec = { firstSeen: number | null; lastAt: number | null; touched: boolean; inFlight: Map<string, { tool: string; seenAt: number | null }> }
const staleAgents = new Map<string, StaleRec>()
const staleNudgedAt = new Map<string, number>()
let staleLastSubmitAt: number | null = null
// CONSTRAINT: now тика, чей сигнал отправлен submit и не ответил; пока не null,
// второго сигнала той же сессии нет (висящий submit доставит первый).
let staleFlyAt: number | null = null
let staleTimer: { cancel: () => void } | null = null
let staleGen = 0
let staleCallSeq = 0
let staleArmFailedAt = -Infinity
// CONSTRAINT: null -- session.start не наблюдался; сигнал уходит только при true.
let staleInteractive: boolean | null = null
let fleetPrunedAt = -Infinity
const STALE_TERMINAL = ["completed", "failed", "killed"]

const STALE_AGENTS_MAX = 256

function staleRecOf(id: string): StaleRec {
  let r = staleAgents.get(id)
  if (!r) {
    if (staleAgents.size >= STALE_AGENTS_MAX) staleEvictOne()
    r = { firstSeen: null, lastAt: null, touched: false, inFlight: new Map() }
    staleAgents.set(id, r)
  }
  return r
}

// CONSTRAINT: жёсткий предел учёта (список агентов может отказывать всю
// сессию, а новые agentId приходят): вытесняется запись без пометки
// активности с самым старым lastAt; все с пометкой -- первая по порядку
// вставки. Хук часов не читает, поэтому возраст пометки -- её порядок, не время.
function staleEvictOne(): void {
  const ents = Array.from(staleAgents.entries())
  let vk: string | null = null
  let vt = Infinity
  for (let i = 0; i < ents.length; i++) {
    const r = ents[i][1]
    if (r.touched) continue
    const t = r.lastAt === null ? -Infinity : r.lastAt
    if (vk === null || t < vt) { vk = ents[i][0]; vt = t }
  }
  if (vk === null && ents.length) vk = ents[0][0]
  if (vk === null) return
  staleAgents.delete(vk)
  staleNudgedAt.delete(vk)
}

export function staleAgentsSnapshot(): Record<string, { firstSeen: number | null; lastAt: number | null; touched: boolean; inFlight: number; nudgedAt: number | null }> {
  const out: Record<string, { firstSeen: number | null; lastAt: number | null; touched: boolean; inFlight: number; nudgedAt: number | null }> = {}
  staleAgents.forEach((r, id) => {
    const n = staleNudgedAt.get(id)
    out[id] = { firstSeen: r.firstSeen, lastAt: r.lastAt, touched: r.touched, inFlight: r.inFlight.size, nudgedAt: n === undefined ? null : n }
  })
  return out
}

// CONSTRAINT: дверь сброса -- для тестового стенда; продовое поведение её не
// зовёт (состояние «session.start не наблюдался» иначе недостижимо в процессе).
export function staleInteractiveReset(): void {
  staleInteractive = null
}

// CONSTRAINT: открытое множество статусов движка -- живой всякий, кроме
// терминальных: в сторону сообщения, не молчания.
function staleOpen(lst: any[]): Map<string, { a: any; status: string }> {
  const out = new Map<string, { a: any; status: string }>()
  for (let i = 0; i < lst.length; i++) {
    const a = lst[i]
    if (!a || !a.id) continue
    const status = String(a.status)
    if (STALE_TERMINAL.indexOf(status) >= 0) continue
    out.set(String(a.id), { a, status })
  }
  return out
}

// CONSTRAINT: тот же образец, что armFailoverFoldTimer: поколение гасит колбэк
// отменённой ручки (отказ cancel не оставляет второго живого тика) и ручки без
// cancel. Отказ вооружения и ручка без cancel оставляют null и метку отказа:
// tool.call главного лупа вооружает заново не чаще раза в период.
export function armStaleAgentsTimer($: any, now: number): void {
  staleGen++
  const gen = staleGen
  const prev = staleTimer
  staleTimer = null
  if (prev) {
    try { prev.cancel() } catch (x) { noteLost("stale-agents-timer-cancel", x, $) }
  }
  try {
    const h = $.clock.every(STALE_AGENTS_PERIOD_MS, async () => {
      if (gen !== staleGen) return
      probeTickShare = null
      try { await staleAgentsTick($, gen) } catch (x) { noteLost("stale-agents-tick", x, $) }
      try { await probeTimerTick($, gen) } catch (x) { noteLost("probe-timer-tick", x, $) }
    })
    if (h && typeof h.cancel === "function") staleTimer = h
    else {
      staleTimer = null
      staleArmFailedAt = now
      noteLost("stale-agents-timer-handle", new Error("clock.every returned no cancel"), $)
    }
  } catch (x) {
    staleTimer = null
    staleArmFailedAt = now
    noteLost("stale-agents-timer-arm", x, $)
  }
}

function idleWatchArm(packed: any): string {
  const world = packed && packed.world
  const probes = world && Array.isArray(world.probes) ? world.probes : []
  for (let i = 0; i < probes.length; i++) {
    if (probes[i] && probes[i].id === "idle-watch") return armStateOf(probes[i], packed.env).state
  }
  return "absent"
}

function idleWatchOf(packed: any): any {
  const probes = packed.world.probes
  for (let i = 0; i < probes.length; i++) if (probes[i].id === "idle-watch") return probes[i]
  return null
}

function fleetDir(world: any): string {
  return world.globalHome + "/idle-watch/fleet"
}

function fleetSafe(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    out += /[A-Za-z0-9._-]/.test(c) ? c : "_"
  }
  return out
}

// CONSTRAINT: сентинел sid общий для всех сессий без sid -- запись под ним
// сливала бы их счёт в одну сессию; такой записи нет вовсе.
async function fleetPublish($: any, world: any, sid: string, rec: any, site: string = "fleet-publish"): Promise<void> {
  if (sid === SID_UNAVAILABLE) {
    noteLost("fleet-sid-unavailable", new Error("session id unavailable: own fleet record not written"), $)
    return
  }
  try {
    await $.fs.write(fleetDir(world) + "/" + fleetSafe(sid) + ".json", JSON.stringify(rec))
  } catch (x) { noteLost(site, x, $) }
}

function fleetEnoent(x: any): boolean {
  let code = false
  try { code = !!(x && (x as any).code === "ENOENT") } catch (y) { code = false }
  return code || safeText(x).indexOf("ENOENT") >= 0
}

let fleetCensusErr = ""

type FleetRow = { sid: string; cwd: string; running: number | null; idleMax: number }
type FleetCensus = { sessions: number; agents: number; unknown: number; unreadable: number; vanished: number; mine: number | null; rows: FleetRow[] }

// CONSTRAINT: прополка удаляет только имя, пришедшее из list этого каталога:
// имя с "/" или ".." вышло бы из каталога и пропускается целиком (не читается,
// не считается, не удаляется); двери удаления у $.fs нет -- отсюда rm -f.
export async function fleetCensus($: any, world: any): Promise<FleetCensus | null> {
  const dir = fleetDir(world)
  const now = await nowMs($)
  let ents: any
  try { ents = await $.fs.list(dir) } catch (x) {
    const m = safeText(x)
    fleetCensusErr = (m.indexOf("fs.list") === 0 ? m : "fs.list: " + m).slice(0, 160)
    noteLost("fleet-list", x, $)
    return null
  }
  if (!Array.isArray(ents)) {
    fleetCensusErr = "fs.list вернул " + typeof ents
    noteLost("fleet-list", new Error(fleetCensusErr), $)
    return null
  }
  const own = fleetSafe(await sidFor($)) + ".json"
  // CONSTRAINT: запись под сентинелом sid (от прежней версии) -- не сессия и не своя: mine при недоступном sid остаётся null.
  const sentinel = fleetSafe(SID_UNAVAILABLE) + ".json"
  const prune = !(now - fleetPrunedAt < FLEET_PRUNE_EVERY_MS)
  if (prune) fleetPrunedAt = now
  const c: FleetCensus = { sessions: 0, agents: 0, unknown: 0, unreadable: 0, vanished: 0, mine: null, rows: [] }
  for (let i = 0; i < ents.length; i++) {
    const name = String((ents[i] && ents[i].name) || "")
    if (name.slice(-5) !== ".json") continue
    if (name.indexOf("/") >= 0 || name.indexOf("..") >= 0) continue
    if (name === sentinel) {
      c.unreadable++
      continue
    }
    const path = dir + "/" + name
    const r = await readText($, path)
    if (r.text === null) {
      // CONSTRAINT: файл, снятый между list и чтением (чужая прополка, конец сессии), -- не порча записи.
      let gone = false
      try { await $.fs.stat(path) } catch (x) { gone = fleetEnoent(x) }
      if (gone) c.vanished++
      else c.unreadable++
      continue
    }
    let rec: any = null
    try { rec = JSON.parse(String(r.text)) } catch (x) { rec = null }
    if (!rec || typeof rec !== "object" || typeof rec.t !== "number" || !Number.isFinite(rec.t)) {
      c.unreadable++
      continue
    }
    if (prune && now - rec.t > FLEET_PRUNE_AGE_MS) {
      try {
        const pr = await $.process.run(["/bin/rm", "-f", path], { timeoutMs: 5000 })
        const code = pr && typeof pr === "object" ? pr.exitCode : undefined
        if (code !== 0) noteLost("fleet-prune", new Error(path + ": rm exit " + String(code)), $)
      } catch (x) { noteLost("fleet-prune", x, $) }
      continue
    }
    if (rec.ended === true || now - rec.t > FLEET_FRESH_MS) continue
    c.sessions++
    const run = typeof rec.running === "number" && Number.isFinite(rec.running) ? rec.running : null
    if (run === null) c.unknown++
    else c.agents += run
    if (name === own) c.mine = run
    let idleMax = 0
    const ags = Array.isArray(rec.agents) ? rec.agents : []
    for (let j = 0; j < ags.length; j++) {
      const im = Number(ags[j] && ags[j].idleMin)
      if (im > idleMax) idleMax = im
    }
    c.rows.push({ sid: String(rec.sid || name.slice(0, -5)), cwd: String(rec.cwd || ""), running: run, idleMax })
  }
  return c
}

// CONSTRAINT: одна форма чисел для сообщения и fleet_status; все поля всегда -- частичный счёт не выглядит полным.
function fleetNumbers(c: FleetCensus): string {
  return "агентов " + c.agents + ", сессий " + c.sessions + " (в этой " + (c.mine === null ? "?" : String(c.mine)) + "); без счёта " + c.unknown + ", нечитаемых " + c.unreadable
}

function fleetText(c: FleetCensus | null, why: string): string {
  if (!c) return "Флот: счёт недоступен (" + why + ")"
  const lines = ["Флот: " + fleetNumbers(c)]
  if (c.rows.length) {
    lines.push("sid | cwd | running | самый долгий простой, мин")
    for (let i = 0; i < c.rows.length; i++) {
      const r = c.rows[i]
      lines.push(r.sid.slice(0, 8) + " | " + r.cwd + " | " + (r.running === null ? "?" : String(r.running)) + " | " + r.idleMax)
    }
  }
  return lines.join("\n")
}

async function fleetAnswer($: any): Promise<string> {
  let packed: any = null
  try { packed = await worldFor($) } catch (x) {
    noteLost("fleet-world", x, $)
    return fleetText(null, "мир не прочитан: " + safeText(x).slice(0, 160))
  }
  const arm = idleWatchArm(packed)
  if (arm !== "armed") return fleetText(null, "idle-watch не вооружён: " + arm)
  const c = await fleetCensus($, packed.world)
  return fleetText(c, fleetCensusErr)
}

async function staleAgentsTick($: any, gen: number): Promise<void> {
  let packed: any = null
  try { packed = await worldFor($) } catch (x) { noteLost("stale-agents-world", x, $); return }
  if (idleWatchArm(packed) !== "armed") {
    // CONSTRAINT: учёт заводят хуки при любом состоянии пробы; не вооружённый тик только чистит его, иначе записи копятся до конца процесса.
    // Сигнал в полёте (staleFlyAt) тик не забывает: его снимает только ответ submit или смена эпохи.
    staleAgents.clear()
    staleNudgedAt.clear()
    staleLastSubmitAt = null
    return
  }
  const world = packed.world
  const p = idleWatchOf(packed)
  // CONSTRAINT: /clear и /resume меняют epoch, не поколение таймера: сверка обоих
  // после каждого await перед публикацией, submit и тостом не пускает запись и
  // сигнал прежней сессии в новую (агенты выбраны по прежней). Между сверкой и
  // действием await нет -- повторная сверка там ничего бы не ловила.
  const ep = epoch
  const live = (): boolean => gen === staleGen && ep === epoch
  const sid = await sidFor($)
  let lst: any = null
  let listErr: any = null
  const listSeq = nudgeSeq
  const ladderSeq = ladderSeqNow()
  try { lst = await $.agent.list() } catch (x) { listErr = x }
  probeTickShare = { ep, seq: listSeq, lst: listErr === null && Array.isArray(lst) ? lst : null, lseq: ladderSeq }
  const now = await nowMs($)
  if (!live()) return
  if (listErr !== null || !Array.isArray(lst)) {
    if (listErr !== null) noteLost("stale-agents-list", listErr, $)
    else noteLost("stale-agents-list-shape", new Error("agent.list returned " + typeof lst), $)
    // CONSTRAINT: без списка учёт не чистится по нему: запись без пометки
    // активности дольше 2× порога висящего агента снимается по возрасту.
    const staleDropMs = 2 * num(p.cfg.stale_agent_min, 30, 1) * 60000
    staleAgents.forEach((r, id) => { if (!r.touched && r.lastAt !== null && now - r.lastAt > staleDropMs) { staleAgents.delete(id); staleNudgedAt.delete(id) } })
    await fleetPublish($, world, sid, { v: 1, sid, cwd: world.cwd, t: now, running: null, agents: [] })
    return
  }
  const open = staleOpen(lst)
  staleAgents.forEach((_r, id) => { if (!open.has(id)) staleAgents.delete(id) })
  staleNudgedAt.forEach((_t, id) => { if (!open.has(id)) staleNudgedAt.delete(id) })
  const thr = num(p.cfg.stale_agent_min, 30, 1)
  const cd = num(p.cfg.cooldown_min, 30, 0)
  const pub: any[] = []
  const hung: Array<{ id: string; a: any; status: string; r: StaleRec }> = []
  open.forEach((o, id) => {
    const r = staleRecOf(id)
    if (r.firstSeen === null) r.firstSeen = now
    if (r.lastAt === null || r.touched) {
      r.lastAt = now
      r.touched = false
    }
    r.inFlight.forEach((f) => { if (f.seenAt === null) f.seenAt = now })
    const idle = now - (r.lastAt as number)
    pub.push({ id, type: String(o.a.type || ""), idleMin: Math.floor(idle / 60000) })
    if (idle >= thr * 60000) hung.push({ id, a: o.a, status: o.status, r })
  })
  const windowOpen = (): boolean => staleFlyAt === null && (staleLastSubmitAt === null || !(now - staleLastSubmitAt < cd * 60000))
  await fleetPublish($, world, sid, { v: 1, sid, cwd: world.cwd, t: now, running: open.size, agents: pub })
  const signal = hung.length > 0 && windowOpen()
  if (!signal && now - fleetPrunedAt < FLEET_PRUNE_EVERY_MS) return
  const census = await fleetCensus($, world)
  if (!signal) return
  // CONSTRAINT: выбор сделан до await тика; агент, получивший touched или
  // ставший терминальным/исчезнувший за это время, из сигнала выбрасывается.
  // Отказ повторного list не гасит сигнал -- в сторону сообщения.
  let again: any = null
  let againErr: any = null
  try { again = await $.agent.list() } catch (x) { againErr = x }
  if (!live()) return
  let againOpen: Map<string, { a: any; status: string }> | null = null
  let recheck = "ok"
  if (againErr !== null) {
    noteLost("stale-agents-recheck", againErr, $)
    recheck = "failed: " + safeText(againErr).slice(0, 160)
  } else if (!Array.isArray(again)) {
    noteLost("stale-agents-recheck-shape", new Error("agent.list returned " + typeof again), $)
    recheck = "not-array: " + typeof again
  } else againOpen = staleOpen(again)
  const named = hung.filter((h) => !h.r.touched && (againOpen === null || againOpen.has(h.id)))
  // CONSTRAINT: окно -- не больше одного сигнала на сессию за cooldown_min;
  // проверка и отметка без await между ними (параллельный тик второго сигнала
  // не даёт), отметка до submit (бросок submit не даёт повтора каждую минуту).
  if (!named.length || !windowOpen()) return
  const prevSubmitAt = staleLastSubmitAt
  staleLastSubmitAt = now
  const lines: string[] = ["[catalyst-probes idle-watch] В этой сессии висят незакрытые агенты (без шагов модели и без новых вызовов инструментов ≥ " + thr + " мин):"]
  const jAgents: any[] = []
  const stops: string[] = []
  for (let i = 0; i < named.length; i++) {
    const h = named[i]
    const prev = staleNudgedAt.get(h.id)
    staleNudgedAt.set(h.id, now)
    const idleMin = Math.floor((now - (h.r.lastAt as number)) / 60000)
    const ageMin = Math.floor((now - (h.r.firstSeen as number)) / 60000)
    let oldest: { tool: string; seenAt: number } | null = null
    h.r.inFlight.forEach((f) => {
      if (f.seenAt !== null && (oldest === null || f.seenAt < oldest.seenAt)) oldest = { tool: f.tool, seenAt: f.seenAt }
    })
    let line = "- " + h.id + " «" + String(h.a.description || "") + "» (" + String(h.a.type || "") + (h.status !== "running" ? ", статус " + h.status : "") + "): без активности " + idleMin + " мин, живёт " + ageMin + " мин"
    const ja: any = { id: h.id, type: String(h.a.type || ""), idleMin, ageMin }
    if (prev !== undefined) ja.prevNudgedAt = isoOf(prev)
    const o = oldest as { tool: string; seenAt: number } | null
    if (o) {
      line += "; ждёт инструмент " + o.tool + " ≥ " + Math.floor((now - o.seenAt) / 60000) + " мин"
      ja.inFlightTool = o.tool
    }
    lines.push(line)
    jAgents.push(ja)
    stops.push("TaskStop " + h.id)
  }
  lines.push("Если отчёт агента уже получен и сохранён — закрой агента (" + stops.join(", ") + "). Если отчёта нет — проверь его вывод и сними его фоновые процессы и циклы ожидания. Не держи законченных агентов открытыми.")
  lines.push(census ? "Флот сейчас: " + fleetNumbers(census) + "." : "Флот: счёт недоступен (" + fleetCensusErr + ").")
  const jrec: any = { t: isoOf(now), kind: "STALE_AGENTS", agents: jAgents, recheck }
  if (staleInteractive !== true) {
    // CONSTRAINT: прогон без человека (-p, SDK) и неизвестный режим сигнала не получают -- чужой ход в автоматическом прогоне; след остаётся в журнале.
    jrec.delivered = staleInteractive === false ? "not-interactive" : "interactive-unknown"
  } else {
    // CONSTRAINT: submit не ждётся -- его ответ может прийти лишь после хода сессии, и ожидание держало бы тик; отказ пишется отдельной записью под своим именем шарда (одно t с записью тика перетёрло бы её).
    const text = lines.join("\n")
    const tNudge = isoOf(now)
    // CONSTRAINT: сигнал в полёте до ответа submit (staleFlyAt): истечение срока
    // пишет строку и повтора не открывает. Поздний успех снимает полёт (окно
    // закрыто от этого сигнала); поздний отказ снимает полёт и открывает окно --
    // повтор на следующем тике. Трогаются только свой полёт и своё окно (новая
    // сессия их сбросила).
    staleFlyAt = now
    const landed = (): void => { if (epoch === ep && staleFlyAt === now) staleFlyAt = null }
    // CONSTRAINT: строка отказа сигнала -- и бросок submit (err), и разрешённый
    // { drop } (by drop, reason): drop -- решение хука, не потеря, noteLost нет.
    const refusal = (r: SubmitAns, isLate: boolean): any => {
      const o: any = { t: tNudge, rec: "stale-agents-submit-err-" + String(now), kind: "STALE_AGENTS_SUBMIT_ERR" }
      if (isLate) o.late = true
      if (r.kind === "drop") { o.by = "drop"; o.reason = clip(r.reason, 240) }
      else if (r.kind === "err") o.err = safeText(r.x).slice(0, 240)
      return o
    }
    const late = (r: SubmitAns): void => {
      landed()
      if (r.kind === "ok") return
      if (r.kind === "err") noteLost("stale-agents-submit-late", r.x, $)
      if (epoch === ep && staleLastSubmitAt === now) staleLastSubmitAt = prevSubmitAt
      void appendJournal($, world.globalHome + "/idle-watch/journal.jsonl", refusal(r, true)).catch((y: any) => noteLost("stale-agents-journal", y, $))
    }
    void submitBounded($, text, "stale-agents-submit", late).then((r) => {
      if (r.kind === "timeout") {
        return appendJournal($, world.globalHome + "/idle-watch/journal.jsonl", {
          t: tNudge, rec: "stale-agents-submit-timeout-" + String(now), kind: "STALE_AGENTS_SUBMIT_TIMEOUT", ms: SUBMIT_DEADLINE_MS,
        }).catch((y: any) => noteLost("stale-agents-journal", y, $))
      }
      landed()
      if (r.kind === "ok") return undefined
      if (r.kind === "err") noteLost("stale-agents-submit", r.x, $)
      return appendJournal($, world.globalHome + "/idle-watch/journal.jsonl", refusal(r, false)).catch((y: any) => noteLost("stale-agents-journal", y, $))
    })
    try { await $.ui.toast(("idle-watch: незакрытых агентов " + named.length + ": " + named.map((h) => h.id).join(", ")).slice(0, 200)) } catch (x) {
      jrec.toastErr = safeText(x).slice(0, 160)
      noteLost("stale-agents-toast", x, $)
    }
  }
  try { await appendJournal($, world.globalHome + "/idle-watch/journal.jsonl", jrec) } catch (x) { noteLost("stale-agents-journal", x, $) }
}

// --- #531: триггеры проб (on / every_min), idle-watch по README, доставка nudge ---
const IDLE_LIVE_KINDS = ["local_agent", "remote_agent", "in_process_teammate"]

// CONSTRAINT: AgentInfo вида работы не несёт: type "teammate" -- in-process
// teammate, прочее -- локальный агент; удалённых работ $.agent.list не отдаёт.
function liveKindOf(a: any): string {
  return String(a && a.type) === "teammate" ? "in_process_teammate" : "local_agent"
}

function idleKindsOf(cfg: any): string[] {
  return cfg && Array.isArray(cfg.live_kinds) ? cfg.live_kinds.map((k: any) => String(k)) : IDLE_LIVE_KINDS
}

export const NUDGE_QUEUE_MAX = 5
export const NUDGE_SUBMIT_AGE_MS = 60000
export const NUDGE_AGENT_QUEUES_MAX = 64
const NUDGE_AGENT_GONE_MS = 600000
const SUBMIT_DEADLINE_MS = 60000
const NUDGE_TEXT_MAX = 2000
const PROBE_LAUNCH_MAX = 256
const PROBE_CAP_MAX = 8
const PROBE_CAP_WINDOW_MS = 3600000
const NUDGE_SUBMIT_FAILS_MAX = 3
const PROBE_SAY_FLOOR_MS = 60000

// CONSTRAINT: fly -- submit записи отправлен и не ответил (срок истёк или нет):
// текст модель получит при следующем простое. Такую запись не отдаёт ни один
// канал, её не вытесняют и не снимают как agent-gone; снимает её только ответ
// submit -- успех (доставлена), drop (отказ хука) или отказ (fly снят, запись
// в голову очереди; NUDGE_SUBMIT_FAILS_MAX отказов подряд -- снята), либо
// смена эпохи. fails -- число отказов submit этой записи.
type NudgeItem = { text: string; probe: string; t: number; jpath: string; sid: string; seq: number; said: string[]; done?: boolean; fly?: boolean; fails?: number }

// CONSTRAINT: очередь -- на (сессия, агент): ключ "" -- главный луп, иначе id
// агента, чьё событие вызвало консультацию; сессию держит newSession.
const nudgeQueue = new Map<string, NudgeItem[]>()
let nudgeSeq = 0
let probeRecSeq = 0
let sessionStartAt: number | null = null
let probeLaunches: number[] = []
const probeEvalAt = new Map<string, number>()
const filteredSaidAt = new Map<string, number>()
const probeConfigSaid = new Set<string>()
const notMainPending = new Map<string, number>()
// CONSTRAINT (#509-FIX7 Р17): барьер двойного счёта not-main -- tool_use_id,
// засчитанный одним из путей (быстрым или медленным), второй раз не считается;
// потолок NOT_MAIN_COUNTED_MAX, вытесняется старейший.
const NOT_MAIN_COUNTED_MAX = 256
const notMainCounted = new Set<string>()
function notMainMark(tuid: string): void {
  notMainCounted.add(tuid)
  while (notMainCounted.size > NOT_MAIN_COUNTED_MAX) {
    const oldest = notMainCounted.values().next().value
    if (oldest === undefined) break
    notMainCounted.delete(oldest)
  }
}
function notMainCount(tuid: string): void {
  if (!probeNotMain.length || (tuid && notMainCounted.has(tuid))) return
  for (let i = 0; i < probeNotMain.length; i++) notMainPending.set(probeNotMain[i], (notMainPending.get(probeNotMain[i]) || 0) + 1)
  if (tuid) notMainMark(tuid)
}
// CONSTRAINT (#509-FIX7 Р12): подсказка главному лупу о шаге, обслуженном не
// объявленной моделью, -- одна на (агент, модель ступени) в сессии.
const ladderServedSaid = new Set<string>()
const nudgeAbsentSince = new Map<string, number>()
// CONSTRAINT (#509-FIX9 R5/R7): lseq -- счётчики реестра проверяющих и учёта
// шагов, снятые ДО запроса списка тиком висящих агентов.
let probeTickShare: { ep: number; seq: number; lst: any[] | null; lseq: LadderSeq } | null = null

// CONSTRAINT (#509-FIX9 R5): учёт ok-шагов агента по модели ступени (ключ --
// normModelId, имя -- первое как написано) живёт до завершения агента или
// смены сессии; потолок LADDER_SERVED_TALLY_MAX агентов, вытесняется
// старейший по постановке, вытеснение -- noteLost ladder-served-tally-evicted.
// other -- хоть один шаг обслужила не объявленная (тот же предикат, что у
// подсказки: model !== original).
export const LADDER_SERVED_TALLY_MAX = 256
type LadderSeq = { r: number; t: number }
type ServedTally = { declared: string; other: boolean; rows: Array<{ model: string; key: string; steps: number }>; seq: number; jpath: string; sid: string; subagentType: any; cls: any }
const ladderServedTally = new Map<string, ServedTally>()
let ladderServedTallySeq = 0

function ladderServedTallyAdd(aid: string, declared: string, model: string, jpath: string, sid: string, subagentType: any, cls: any, $?: any): void {
  if (!jpath) return
  let tl = ladderServedTally.get(aid)
  if (!tl) {
    while (ladderServedTally.size >= LADDER_SERVED_TALLY_MAX) {
      const oldest = ladderServedTally.keys().next().value
      if (oldest === undefined) break
      ladderServedTally.delete(oldest)
      noteLost("ladder-served-tally-evicted", new Error("агент " + String(oldest)), $)
    }
    tl = { declared, other: false, rows: [], seq: 0, jpath, sid, subagentType, cls }
    ladderServedTally.set(aid, tl)
  }
  tl.seq = ++ladderServedTallySeq
  tl.jpath = jpath
  tl.sid = sid
  if (model !== declared) tl.other = true
  const k = normModelId(model)
  let row: { model: string; key: string; steps: number } | undefined = undefined
  for (let i = 0; i < tl.rows.length; i++) if (tl.rows[i].key === k) row = tl.rows[i]
  if (!row) { row = { model, key: k, steps: 0 }; tl.rows.push(row) }
  row.steps++
}

function ladderSeqNow(): LadderSeq {
  return { r: sessionReviewerServedSeqOf(), t: ladderServedTallySeq }
}

function ladderWatchPending(atMs: number): boolean {
  return ladderServedTally.size > 0 || sessionReviewerServedLiveAt(atMs)
}

// CONSTRAINT (#509-FIX9 R5/R7): агент с терминальным статусом в списке тика
// (STALE_TERMINAL) завершён: снимается его запись реестра проверяющих (R7) и
// его учёт шагов; при other -- одна запись served-summary в журнал лестницы.
// Учёт, тронутый после запроса списка (seq больше seq.t), -- шаг
// возобновлённого агента: не снимается и не пишется. Отсутствие в списке
// завершением не считается. Подсказки в разговор нет.
async function ladderAgentsListed($: any, lst: any[] | null | undefined, seq: LadderSeq, now: number): Promise<void> {
  if (!Array.isArray(lst)) return
  for (let i = 0; i < lst.length; i++) {
    const a = lst[i]
    if (!a || !a.id || STALE_TERMINAL.indexOf(String(a.status)) < 0) continue
    const id = String(a.id)
    sessionReviewerServedRelease(id, seq.r)
    const tl = ladderServedTally.get(id)
    if (!tl || tl.seq > seq.t) continue
    ladderServedTally.delete(id)
    if (!tl.other) continue
    try {
      await appendJournal($, tl.jpath, {
        t: isoOf(now), sid: tl.sid,
        rec: id + "-served-summary-" + String(now),
        outcome: "served-summary",
        agentId: id, subagentType: tl.subagentType, class: tl.cls,
        declared: tl.declared,
        served: tl.rows.map((r) => ({ model: r.model, steps: r.steps })),
      })
    } catch (x) { noteLost("ladder-served-summary", x, $) }
  }
}

// CONSTRAINT: смена эпохи снимает очереди прежней сессии (текст в новую не
// переносится), но не молча: каждая снятая запись -- строка nudge_dropped
// session-reset в её журнал (её jpath и sid), запись в полёте -- с fly.
// Снимок очереди -- синхронно до clear, строки -- после, без ожидания.
function probeSessionReset($: any): void {
  const dropped: Array<{ k: string; it: NudgeItem }> = []
  nudgeQueue.forEach((q, k) => { for (let i = 0; i < q.length; i++) dropped.push({ k, it: q[i] }) })
  if (dropped.length) void (async () => {
    for (let i = 0; i < dropped.length; i++) {
      const d = dropped[i]
      const extra: any = { outcome: "nudge_dropped", by: "session-reset", agent: d.k || "main" }
      if (d.it.fly) extra.fly = true
      await nudgeJournal($, d.it, extra)
    }
  })()
  nudgeQueue.clear()
  nudgeAbsentSince.clear()
  sessionStartAt = null
  probeLaunches = []
  probeEvalAt.clear()
  filteredSaidAt.clear()
  probeConfigSaid.clear()
  notMainPending.clear()
  notMainCounted.clear()
  ladderServedSaid.clear()
  ladderServedTally.clear()
  probeTickShare = null
}

export function probeQueueSnapshot(): any {
  const out: any = {}
  nudgeQueue.forEach((q, k) => { out[k] = q.map((it) => ({ text: it.text, probe: it.probe, t: it.t, fly: it.fly === true })) })
  return out
}

// CONSTRAINT: кэп nudge/log_only -- не больше PROBE_CAP_MAX консультаций на
// сессию за последние PROBE_CAP_WINDOW_MS (отметки времени, не пожизненный
// счёт). Число в сторе -- прежняя форма без времён: его отметки ставятся
// временем ПЕРВОГО чтения в процессе (дальше число не читается, отметки живут
// в зеркале) и сразу пишутся в стор массивом (capSeedFrom), иначе прежний
// исчерпанный счёт немел бы навсегда, а каждая перезагрузка мода датировала
// бы число заново. Отметка из будущего (часы назад) считается в окне -- в
// сторону ограничения расхода.
const capLegacySeen = new Set<string>()
function capMarksOf(v: any, now: number, sid: string): number[] {
  if (Array.isArray(v)) return v.map((t: any) => Number(t)).filter((t: number) => Number.isFinite(t))
  const n = typeof v === "number" ? v : Number(v)
  if (!(Number.isFinite(n) && n > 0) || capLegacySeen.has(sid)) return []
  capLegacySeen.add(sid)
  return new Array(Math.min(Math.floor(n), PROBE_CAP_MAX)).fill(now)
}

function capLive(marks: number[], now: number): number[] {
  return marks.filter((t) => now - t < PROBE_CAP_WINDOW_MS).slice(-PROBE_CAP_MAX)
}

// CONSTRAINT: зеркало -- больший из двух живых наборов (стор и зеркало), как
// максимум у прежнего счёта: стор ниже зеркала значит упавшую свою запись.
// Пишется и при удачном чтении: отказ следующего чтения не снимает кэп.
function capSeed(sid: string, stored: number[], now: number): void {
  const a = capLive(stored, now)
  const b = capLive(capMirror.get(sid) || [], now)
  capMirror.set(sid, a.length > b.length ? a : b)
}

// CONSTRAINT: проверка и отметка -- синхронно по зеркалу, без await между ними:
// две параллельные оценки не проходят кэп обе. null -- окно полно.
function capTake(sid: string, now: number): number[] | null {
  const cur = capLive(capMirror.get(sid) || [], now)
  if (cur.length >= PROBE_CAP_MAX) { capMirror.set(sid, cur); return null }
  const next = cur.concat([now])
  capMirror.set(sid, next)
  return next
}

function capSeedFrom($: any, sid: string, v: any, now: number): void {
  let stored: number[] = []
  try { stored = capMarksOf(v, now, sid) } catch (x) { noteLost("session-cap-read", x, $) }
  capSeed(sid, stored, now)
  if (stored.length && !Array.isArray(v)) capPersist($, sid)
}

// CONSTRAINT: все записи массива кэпа -- одной цепочкой, и каждая берёт
// ТЕКУЩЕЕ зеркало в момент исполнения, не снимок до await: записи,
// завершившиеся в обратном порядке, иначе оставляли бы в сторе меньший набор.
// Вызывающий цепочку не ждёт: висящая запись стора не держит tool.call.
let capWriteChain: Promise<void> = Promise.resolve()
// CONSTRAINT (#509-FIX7 Р18): sid, чья последняя запись кэпа отказана, --
// в capUnlanded до удачной записи; прополка эпохи такой ключ не снимает: в
// сторе прежнее число, и /resume датировал бы его заново.
const capUnlanded = new Set<string>()
// CONSTRAINT (#509-FIX8 Р9): неприземлённых ключей не больше CAP_UNLANDED_MAX.
// Сверх предела вытесняется старейший по порядку вставки, кроме sid текущей
// эпохи; зеркало вытесненного снимается, только если его массив -- тот же, что
// на последней смене эпохи (capEpochSeen): тронутый новой эпохой ключ несёт её
// отметки. Вытеснение названо noteLost.
export const CAP_UNLANDED_MAX = 64
let capEpochSeen = new Map<string, number[]>()
function capUnlandedEvict($: any, sid: string): void {
  while (capUnlanded.size > CAP_UNLANDED_MAX) {
    const ks = Array.from(capUnlanded)
    let victim = ""
    for (let i = 0; i < ks.length; i++) if (ks[i] !== sid && ks[i] !== sidMemo) { victim = ks[i]; break }
    if (!victim) return
    capUnlanded.delete(victim)
    const m = capMirror.get(victim)
    if (m !== undefined && capEpochSeen.get(victim) === m) capMirror.delete(victim)
    noteLost("session-cap-unlanded-evicted", new Error(victim), $)
  }
}
function capPersist($: any, sid: string): void {
  const run = async (): Promise<void> => {
    const cur = capMirror.get(sid)
    if (!cur) return
    try {
      await $.store.set(CAP_KEY + ":" + sid, cur.slice())
      capUnlanded.delete(sid)
    } catch (x) {
      capUnlanded.add(sid)
      capUnlandedEvict($, sid)
      noteLost("session-cap", x, $)
    }
  }
  capWriteChain = capWriteChain.then(run, run)
}

// CONSTRAINT: память кэпа прошлой эпохи (зеркало и отметки прежнего числа)
// снимается последним звеном цепочки записей, после записей, уже стоящих в
// очереди: они берут зеркало в момент исполнения, и итог старого sid доходит
// до стора (его читает /resume). Снимается только ключ, не тронутый новой
// эпохой (тот же массив зеркала): тронутый -- текущий sid, его запись идёт
// следом и без зеркала пропала бы. Иначе память процесса росла бы с числом
// сессий.
function capEpochPrune(): void {
  const seen = new Map<string, number[]>()
  capMirror.forEach((m, k) => { seen.set(k, m) })
  capEpochSeen = seen
  const legacy = Array.from(capLegacySeen)
  const prune = (): void => {
    seen.forEach((m, k) => { if (capMirror.get(k) === m && !capUnlanded.has(k)) capMirror.delete(k) })
    for (const k of legacy) if (!capMirror.has(k)) capLegacySeen.delete(k)
  }
  capWriteChain = capWriteChain.then(prune, prune)
}

// CONSTRAINT: двери -- для тестового стенда: ключи зеркала кэпа, отметки
// прежнего числа, неприземлённые ключи и сброс состояния кэпа процесса (так
// выглядит перезагрузка мода; стор остаётся).
export function probeCapSids(): string[] {
  return Array.from(capMirror.keys())
}

export function probeCapLegacySids(): string[] {
  return Array.from(capLegacySeen)
}

export function probeCapUnlandedSids(): string[] {
  return Array.from(capUnlanded)
}

export function probeCapStateReset(): void {
  capMirror.clear()
  capLegacySeen.clear()
  capUnlanded.clear()
  capEpochSeen = new Map()
  capWriteChain = Promise.resolve()
}

// CONSTRAINT: cooldown не-cancel пробы на любом триггере -- cooldown_min из
// [defaults] или таблицы (cfg уже слит); ключа нет -- паузы нет, 0 -- выключено.
// Встроенные пробы держат свои пороги (idle-watch -- idleGate, судья -- cancel).
function probeCooldownMs(p: any): number {
  if (p.builtin || p.act === "cancel" || p.pending) return 0
  const raw = p.cfg ? p.cfg.cooldown_min : undefined
  if (raw === undefined || raw === null) return 0
  const cd = num(raw, 0, 0) * 60000
  return cd
}

function probeCooldownBy(p: any, last: number, now: number): string {
  const cd = probeCooldownMs(p)
  return cd > 0 && last && now - last < cd ? "cooldown" : ""
}

// CONSTRAINT: отметка консультации -- один синхронный шаг ПОСЛЕ последнего
// await оценки: перепроверка cooldown пробы по зеркалу отметки, кэп, отметка и
// постановка записи кэпа. Ранняя проверка до await пересечения двух оценок
// (два события, таймер и tool.call) не закрывает: обе видят старую отметку.
// "" -- консультация идёт, иначе причина filtered.
function probeMarkTake($: any, p: any, lk: string, sid: string, now: number): string {
  const cd = p.id === "idle-watch" ? idleCooldownMs(p.cfg) : probeCooldownMs(p)
  const prev = lastMirror.get(lk) || 0
  if (cd > 0 && prev && now - prev < cd) return "cooldown"
  const marks = capTake(sid, now)
  if (!marks) return "consult-cap"
  lastMirror.set(lk, now)
  capPersist($, sid)
  return ""
}

// CONSTRAINT: разрешённое значение submit -- PromptSubmitResult: объект со
// строкой drop, в том числе пустой, -- текст не вошёл (отказ хука), не доставка.
// Чтение значения, бросившее, -- отказ submit, не успех.
type SubmitAns = { kind: "ok" } | { kind: "drop"; reason: string } | { kind: "err"; x: any }
function submitAnsOf(v: any): SubmitAns {
  try {
    if (v && typeof v === "object" && typeof v.drop === "string") return { kind: "drop", reason: v.drop || "(пустая причина)" }
  } catch (x) { return { kind: "err", x } }
  return { kind: "ok" }
}

// CONSTRAINT: $.prompt.submit ограничен сроком гонкой с $.clock.after. Истечение
// срока не отменяет висящий submit: его поздний ответ уходит в late(r), и
// вызывающий снимает повтор сам. Часы, отказавшие взвести срок, названы
// noteLost; ожидание тогда без срока, как до него.
function submitBounded($: any, text: string, site: string, late: (r: SubmitAns) => void): Promise<SubmitAns | { kind: "timeout" }> {
  return new Promise((resolve) => {
    let state = 0
    let timer: any = null
    try {
      timer = $.clock.after(SUBMIT_DEADLINE_MS, () => {
        if (state !== 0) return
        state = 2
        resolve({ kind: "timeout" })
      })
    } catch (x) { noteLost(site + "-deadline", x, $) }
    const stop = (): void => {
      try { if (timer && typeof timer.cancel === "function") timer.cancel() } catch (x) { noteLost(site + "-deadline-cancel", x, $) }
    }
    Promise.resolve().then(() => $.prompt.submit({ text })).then(
      (v: any) => {
        const r = submitAnsOf(v)
        if (state === 2) { late(r); return }
        state = 1
        stop()
        resolve(r)
      },
      (x: any) => {
        if (state === 2) { late({ kind: "err", x }); return }
        state = 1
        stop()
        resolve({ kind: "err", x })
      },
    )
  })
}

// CONSTRAINT (#509-FIX7d AR4): живой движок 2.1.283 не снимает turn.step, пока хук ждёт гонку двери со сроком ($.clock.after и $.clock.sleep): шаг прожил 30 с при бюджете 10 с, remainingMs не менялся (Catalyst-programs/2026-09-25-ladder-terminal-509/probe-ar4-live/logs/probe.jsonl); изолированное ожидание часов дольше бюджета не мерилось. Кит claude plugin test одиночное ожидание clock.after снимает на 10 с, поэтому такое ожидание зубом кита не мерится.
// CONSTRAINT (#509-FIX7 А-Р1): ожидание двери ограничено сроком гонкой с
// $.clock.after; срок истёк -- {late: true}, дверь доживает в фоне, её поздний
// отказ -- noteLost(site). Отказ двери до срока пробрасывается. Часы, отказавшие
// взвести срок, -- noteLost, ожидание тогда без срока.
// CONSTRAINT (#509-FIX8 Р6): поздний успех двери, чьё значение несёт причину
// отказа (lateWhy вернул не null/undefined), -- тоже noteLost(site).
function raceUntil($: any, work: Promise<any>, ms: number, site: string, lateWhy?: (v: any) => any): Promise<{ late: boolean; v?: any }> {
  return new Promise((resolve, reject) => {
    let state = 0
    let timer: any = null
    const lateNow = (): void => {
      if (state !== 0) return
      state = 2
      resolve({ late: true })
    }
    if (!(ms > 0)) lateNow()
    else {
      try { timer = $.clock.after(ms, lateNow) } catch (x) { noteLost(site + "-deadline", x, $) }
    }
    const stop = (): void => {
      try { if (timer && typeof timer.cancel === "function") timer.cancel() } catch (x) { noteLost(site + "-deadline-cancel", x, $) }
    }
    Promise.resolve(work).then(
      (v: any) => {
        if (state === 2) {
          if (lateWhy) {
            const why = lateWhy(v)
            if (why !== null && why !== undefined) noteLost(site, why, $)
          }
          return
        }
        state = 1
        stop()
        resolve({ late: false, v })
      },
      (x: any) => {
        if (state === 2) { noteLost(site, x, $); return }
        state = 1
        stop()
        reject(x)
      },
    )
  })
}

function jsonClip(v: any, n: number): string {
  let s: any = ""
  try { s = JSON.stringify(v === undefined ? null : v) } catch (x) { s = "[unserializable: " + safeText(x).slice(0, 80) + "]" }
  s = String(s)
  return n > 0 && s.length > n ? s.slice(0, n) : s
}

function flatInto(ctx: any, ev: any): void {
  if (!ev || typeof ev !== "object") return
  const ks = Object.keys(ev)
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]
    if (Object.prototype.hasOwnProperty.call(ctx, k)) continue
    const v = ev[k]
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") ctx[k] = v
  }
}

function probeRec(kind: string, t: number): string {
  return kind + "-" + String(t) + "-" + String(++probeRecSeq)
}

async function probeAgentList($: any): Promise<any[] | null> {
  try {
    const l = await $.agent.list()
    if (Array.isArray(l)) return l
    noteLost("agent-list-shape", new Error("agent.list returned " + typeof l), $)
    return null
  } catch (x) {
    noteLost("agent-list", x, $)
    return null
  }
}

// CONSTRAINT (#509-FIX7 Р12): подсказка без дома журнала (лестница без
// globalHome) ставится и доставляется; её строк журнала нет.
async function nudgeJournal($: any, it: NudgeItem, extra: any, t?: number): Promise<void> {
  if (!it.jpath) return
  try {
    const tn = t === undefined ? await nowMs($) : t
    await appendJournal($, it.jpath, Object.assign({ t: isoOf(tn), probe: it.probe }, extra, {
      text: clip(it.text, 400), rec: probeRec(String(extra.outcome), tn), sid: it.sid,
    }))
  } catch (x) { noteLost("nudge-journal", x, $) }
}

// CONSTRAINT: вытесняется старейшая запись; вставка и вытеснение -- без await
// между ними (параллельная консультация не видит очередь длиннее предела).
// CONSTRAINT: очередей агентов не больше NUDGE_AGENT_QUEUES_MAX; при новой
// очереди сверх предела снимается та, в которую дольше всех не ставили (её
// последняя запись с наименьшим seq); очередь главного лупа в предел не входит.
async function nudgeEnqueue($: any, key: string, it: { text: string; probe: string; t: number; jpath: string; sid: string }): Promise<void> {
  let q = nudgeQueue.get(key)
  const capped: Array<{ k: string; it: NudgeItem }> = []
  if (!q) {
    q = []
    nudgeQueue.set(key, q)
    if (key) {
      let n = 0
      nudgeQueue.forEach((_q, k) => { if (k) n++ })
      while (n > NUDGE_AGENT_QUEUES_MAX) {
        let vk = ""
        let vs = Infinity
        const ents = Array.from(nudgeQueue.entries())
        for (let i = 0; i < ents.length; i++) {
          const k = ents[i][0]
          const qq = ents[i][1]
          if (!k || k === key) continue
          const s = qq.length ? qq[qq.length - 1].seq : -1
          if (s < vs) { vs = s; vk = k }
        }
        if (!vk) break
        const vq = nudgeQueue.get(vk) || []
        nudgeQueue.delete(vk)
        nudgeAbsentSince.delete(vk)
        for (let i = 0; i < vq.length; i++) capped.push({ k: vk, it: vq[i] })
        n--
      }
    }
  }
  const fresh: NudgeItem = Object.assign({ seq: ++nudgeSeq, said: [] as string[] }, it)
  q.push(fresh)
  // CONSTRAINT: запись в полёте занимает слот и не вытесняется: уходит старейшая
  // не в полёте; все прочие в полёте -- не встаёт сама новая (queue-cap).
  const out: Array<{ it: NudgeItem; by: string }> = []
  while (q.length > NUDGE_QUEUE_MAX) {
    const d = q.splice(q.findIndex((x) => !x.fly), 1)[0]
    out.push({ it: d, by: d === fresh ? "queue-cap" : "queue-max" })
  }
  for (let i = 0; i < capped.length; i++) await nudgeJournal($, capped[i].it, { outcome: "nudge_dropped", by: "queue-cap", agent: capped[i].k })
  for (let i = 0; i < out.length; i++) await nudgeJournal($, out[i].it, { outcome: "nudge_dropped", by: out[i].by, agent: key || "main" })
}

// CONSTRAINT: канал (а): очередь агента уходит полем context результата его
// ближайшего tool.call; свой context результата сохраняется; deny не несёт
// текста -- очередь ждёт следующего вызова. Снятие очереди -- синхронно до
// первого await: второй канал того же текста уже не увидит.
async function nudgeDeliverContext($: any, key: string, res: any): Promise<any> {
  const q = nudgeQueue.get(key)
  if (!q || !q.length) return res
  if (!res || typeof res !== "object" || Array.isArray(res) || "deny" in res) return res
  const give = q.filter((it) => !it.fly)
  if (!give.length) return res
  const keep = q.filter((it) => it.fly)
  if (keep.length) nudgeQueue.set(key, keep)
  else nudgeQueue.delete(key)
  const own: string[] = Array.isArray(res.context) ? res.context.slice() : (res.context != null ? [String(res.context)] : [])
  const out = Object.assign({}, res, { context: own.concat(give.map((it) => it.text)) })
  const t = await nowMs($)
  for (let i = 0; i < give.length; i++) await nudgeJournal($, give[i], { outcome: "nudge_delivered", channel: "context", agent: key || "main" }, t)
  return out
}

// CONSTRAINT: запись в полёте остаётся в очереди главного лупа, поэтому ответ
// submit работает с ней на месте: успех снимает, отказ переносит в голову.
// Очередь прежней эпохи уже сброшена -- искать не в чем.
function nudgeFlyTake(it: NudgeItem): void {
  const q = nudgeQueue.get("")
  const j = q ? q.indexOf(it) : -1
  if (!q || j < 0) return
  q.splice(j, 1)
  if (!q.length) nudgeQueue.delete("")
}

function nudgeFlyToHead(it: NudgeItem, ep: number): void {
  if (epoch !== ep) return
  const q = nudgeQueue.get("")
  const j = q ? q.indexOf(it) : -1
  if (!q || j < 0) return
  q.splice(j, 1)
  q.unshift(it)
}

// CONSTRAINT: не больше одной строки filtered / when_bad на (проба, класс) за
// cooldown_min и не чаще раза в PROBE_SAY_FLOOR_MS: cooldown_min = 0 снимает
// паузу консультаций, не предел строк журнала. Отметка ставится синхронно до
// await записи (параллельная оценка второй строки не даёт). false -- строка
// подавлена частотой.
function probeSayDue(p: any, cls: string, now: number): boolean {
  const key = p.id + "|" + cls
  const cd = Math.max(num(p.cfg && p.cfg.cooldown_min, 30, 0) * 60000, PROBE_SAY_FLOOR_MS)
  const prev = filteredSaidAt.get(key)
  if (prev !== undefined && now >= prev && now - prev < cd) return false
  filteredSaidAt.set(key, now)
  return true
}

async function probeFiltered($: any, world: any, p: any, by: string, event: string, now: number, n?: number): Promise<boolean> {
  const cls = by.split(":")[0]
  if (!probeSayDue(p, cls, now)) return false
  const rec: any = { t: isoOf(now), probe: p.id, outcome: "filtered", by, event, rec: probeRec("filtered-" + cls, now), sid: await sidFor($) }
  if (n !== undefined) rec.n = n
  try { await appendJournal($, world.globalHome + "/" + p.id + "/journal.jsonl", rec) } catch (x) { noteLost("probe-filtered", x, $) }
  return true
}

// CONSTRAINT: строка конфига -- одна на (проба, отметка) за сессию; пишут её
// только вооружённые пробы (выключенная проба не работает и не отчитывается).
async function probeConfigNotes($: any, packed: any, now: number): Promise<void> {
  const probes = packed.world.probes
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i]
    if (!probeListens(p, packed.env)) continue
    const jpath = packed.world.globalHome + "/" + p.id + "/journal.jsonl"
    const bad: string[] = Array.isArray(p.onBad) ? p.onBad : []
    for (let j = 0; j < bad.length; j++) {
      const key = p.id + "|on_bad|" + bad[j]
      if (probeConfigSaid.has(key)) continue
      await journalOnce($, probeConfigSaid, key, jpath, { t: isoOf(now), probe: p.id, outcome: "on_bad", by: bad[j], rec: probeRec("on_bad", now), sid: await sidFor($) }, "probe-on-bad")
    }
    if (!p.builtin && !p.on.length && !p.everyMs) {
      const key = p.id + "|no-trigger"
      if (probeConfigSaid.has(key)) continue
      await journalOnce($, probeConfigSaid, key, jpath, { t: isoOf(now), probe: p.id, outcome: "skip_degraded", by: "no-trigger", rec: probeRec("skip_degraded", now), sid: await sidFor($) }, "probe-no-trigger")
    }
    // CONSTRAINT: $.agent.list удалённых работ не отдаёт -- вид remote_agent в
    // live_kinds ненаблюдаем; строка -- одна на сессию, вид из счёта не выводится.
    if (p.id === "idle-watch" && idleKindsOf(p.cfg).indexOf("remote_agent") >= 0) {
      const by = "live_kinds_unobservable:remote_agent"
      const key = p.id + "|" + by
      if (probeConfigSaid.has(key)) continue
      await journalOnce($, probeConfigSaid, key, jpath, { t: isoOf(now), probe: p.id, outcome: "skip_degraded", by, rec: probeRec("skip_degraded", now), sid: await sidFor($) }, "probe-live-kinds")
    }
  }
}

function probeCtxOf(event: string, ev: any, input: any, now: number, aid: string | undefined, lst: any[] | null, last: number): any {
  const ctx: any = {
    now, event,
    live_works: lst === null ? null : lst.length,
    unknown: lst === null ? ["live_works"] : [],
    last_consultation: last,
    agent_id: aid,
  }
  if (event === "PostToolUse") ctx.tool_name = String((ev && ev.tool) || "")
  if (event !== "timer") flatInto(ctx, input)
  Object.defineProperty(ctx, "eventInput", { value: input, enumerable: false })
  return ctx
}

async function probeWhenBad($: any, world: any, p: any, env: any, ev: any, ctx: any, now: number): Promise<void> {
  if (!probeSayDue(p, "when_bad", now)) return
  try {
    await appendJournal($, world.globalHome + "/" + p.id + "/journal.jsonl", {
      t: isoOf(now), tool: String((ev && ev.tool) || ""), agent: String((ev && ev.subagent_type) || ""), outcome: "when_bad",
      rec: modRecName(ev), carrier: carrierOfJournal(p, env), sid: await sidFor($),
      whenBad: ctx.whenBad, ms: 0, probe: p.id,
    })
  } catch (x) { noteLost("journal-when-bad", x, $) }
}

async function probeObserveBg($: any, p: any, env: any, world: any, ev: any, ctx: any, sid: string, epCall: number): Promise<void> {
  let raw: any = undefined
  try { raw = await $.store.get(CAP_KEY + ":" + sid) } catch (x) { noteLost("session-cap-read", x, $) }
  if (epoch !== epCall) return
  // CONSTRAINT: слияние стора с зеркалом -- ПОСЛЕ await, отметка -- без await
  // следом: две параллельные оценки не проходят кэп и cooldown обе.
  capSeedFrom($, sid, raw, ctx.now)
  const lk = lastKey(p.id, world.cwd)
  const why = probeMarkTake($, p, lk, sid, ctx.now)
  if (why) { await probeFiltered($, world, p, why, String(ctx.event || ""), ctx.now); return }
  try { await $.store.set(lk, ctx.now) } catch (x) { noteLost("consult-last", x, $) }
  if (epoch !== epCall) return
  ;(async () => { try { await consultBg($, p, env, world, ev, ctx, "", epCall) } catch (x) { noteLost("observer-consult", x, $) } })()
}

// CONSTRAINT: оценка наблюдающей пробы вне PreToolUse (прочие classic-события,
// PostToolUse, таймер); отмена сюда не доходит -- её имена сняты on_bad.
async function probeEvaluate($: any, packed: any, p: any, o: { event: string; ev: any; input: any; lst: any[] | null; now: number; aid: string | undefined; ep: number; toolResult?: any }): Promise<void> {
  if (p.act === "cancel" || p.pending) return
  const env = packed.env
  const world = packed.world
  if (p.mainLoopOnly && o.aid) { await probeFiltered($, world, p, "not-main", o.event, o.now); return }
  const lk = lastKey(p.id, world.cwd)
  let lastStore = 0
  try { lastStore = Number(await $.store.get(lk) || 0) } catch (x) { noteLost("consult-last-read", x, $) }
  const last = Math.max(lastStore, lastMirror.get(lk) || 0)
  lastMirror.set(lk, last)
  const ctx = probeCtxOf(o.event, o.ev, o.input, o.now, o.aid, o.lst, last)
  if (o.event === "PostToolUse") ctx.tool_result = o.toolResult
  let by = ""
  if (p.id === "idle-watch") by = idleGate(p, ctx, o.lst, o.now)
  else if (p.cfg && p.cfg.when) {
    const u = whenFields(p.cfg.when).filter((f) => ctx.unknown.indexOf(f) >= 0)
    if (u.length) { for (const f of u) addWhenBad(ctx, "unknown=" + f); by = "when-bad" }
    else if (!pred(p.cfg.when, ctx)) by = "when-false"
  }
  if (!by) by = probeCooldownBy(p, last, o.now)
  if (ctx.whenBad) { await probeWhenBad($, world, p, env, o.ev, ctx, o.now); return }
  if (by) { await probeFiltered($, world, p, by, o.event, o.now); return }
  if (epoch !== o.ep) return
  await probeObserveBg($, p, env, world, o.ev, ctx, await sidFor($), o.ep)
}

async function classicRun($: any, name: string, e: any, next: any): Promise<any> {
  try { await classicProbe($, name, e) } catch (x) { noteLost("probe-classic", x, $) }
  return next(e)
}

async function classicProbe($: any, name: string, e: any): Promise<void> {
  const ev = snapEvent($, e, "classic." + name)
  const ep = epoch
  const packed = await worldFor($)
  const now = await nowMs($)
  if (ep !== epoch) return
  if (sessionStartAt === null) sessionStartAt = now
  await probeConfigNotes($, packed, now)
  const ps: any[] = packed.world.probes.filter((p: any) => probeListens(p, packed.env) && p.on.indexOf(name) >= 0)
  if (!ps.length) return
  const aid = ev.agent_id != null && ev.agent_id !== "" ? String(ev.agent_id) : undefined
  const lst = await probeAgentList($)
  // CONSTRAINT: у classic-события нет tool_use_id -- без своего имени улика и
  // шард журнала каждого события ложились бы в один mod-noid.
  const evc = Object.assign({}, ev, { tool_use_id: ev.tool_use_id || probeRec("classic-" + name, now) })
  if (!ev.tool_use_id) calllessEvents.add(evc)
  for (let i = 0; i < ps.length; i++) {
    if (ep !== epoch) return
    await probeEvaluate($, packed, ps[i], { event: name, ev: evc, input: ev, lst, now, aid, ep })
  }
}

// CONSTRAINT: main-only проба на tool.call агента -- оценка not-main; путь
// агента не читает часов и не зовёт $, поэтому он только считает, а строку
// пишет тик (счёт n -- с прошлой записанной строки).
async function probeNotMainFlush($: any, packed: any, now: number): Promise<void> {
  if (!notMainPending.size) return
  const pend = Array.from(notMainPending.entries())
  notMainPending.clear()
  for (let i = 0; i < pend.length; i++) {
    const id = pend[i][0]
    const n = pend[i][1]
    const p = packed.world.probes.find((x: any) => x && x.id === id)
    if (!p) continue
    if (!(await probeFiltered($, packed.world, p, "not-main", "tool.call", now, n))) {
      notMainPending.set(id, (notMainPending.get(id) || 0) + n)
    }
  }
}

async function probeTimerDeliver($: any, lst: any[] | null | undefined, listSeq: number, now: number, ep: number): Promise<void> {
  if (Array.isArray(lst)) {
    const open = staleOpen(lst)
    const listed = new Set<string>()
    for (let i = 0; i < lst.length; i++) if (lst[i] && lst[i].id) listed.add(String(lst[i].id))
    const gone: Array<{ k: string; it: NudgeItem }> = []
    nudgeQueue.forEach((q, k) => {
      if (!k) return
      if (open.has(k)) { nudgeAbsentSince.delete(k); return }
      // CONSTRAINT: терминальный статус в списке -- ушедший сразу (Р6). Агента
      // нет в списке -- ушедший после NUDGE_AGENT_GONE_MS подряд (отсчёт -- с
      // первого тика без него, появление его сбрасывает); разовое отсутствие в
      // списке очередь не снимает.
      if (!listed.has(k)) {
        const since = nudgeAbsentSince.get(k)
        if (since === undefined) { nudgeAbsentSince.set(k, now); return }
        if (now - since < NUDGE_AGENT_GONE_MS) return
      }
      // CONSTRAINT: ушедшим считается только агент записи, поставленной ДО
      // запроса списка: агент, родившийся после запроса, в нём быть не мог.
      const keep = q.filter((it) => it.seq > listSeq)
      for (let i = 0; i < q.length; i++) if (q[i].seq <= listSeq) gone.push({ k, it: q[i] })
      if (keep.length) nudgeQueue.set(k, keep)
      else nudgeQueue.delete(k)
    })
    for (let i = 0; i < gone.length; i++) await nudgeJournal($, gone[i].it, { outcome: "nudge_undelivered", by: "agent-gone", agent: gone[i].k })
    nudgeAbsentSince.forEach((_t, k) => { if (!nudgeQueue.has(k)) nudgeAbsentSince.delete(k) })
  }
  if (epoch !== ep) return
  const q = nudgeQueue.get("")
  if (!q || !q.length) return
  if (staleInteractive === true) {
    const ripe = q.filter((it) => !it.fly && now - it.t >= NUDGE_SUBMIT_AGE_MS)
    if (!ripe.length) return
    // CONSTRAINT: submit не ждётся (его ответ может прийти лишь после хода
    // сессии). Один текст -- одна доставка: запись остаётся в очереди в полёте
    // до ответа submit; истечение срока пишет строку и не возвращает текст ни
    // одному каналу (висящий submit доставит его при простое сессии).
    for (let i = 0; i < ripe.length; i++) {
      const it = ripe[i]
      it.fly = true
      const answered = (r: SubmitAns, late: boolean): Promise<void> | undefined => {
        if (r.kind === "ok") {
          nudgeFlyTake(it)
          if (it.done) return undefined
          it.done = true
          const extra: any = { outcome: "nudge_delivered", channel: "submit", agent: "main" }
          if (late) extra.late = true
          return nudgeJournal($, it, extra)
        }
        // CONSTRAINT: drop -- отказ хука, решение, не сбой: запись снимается,
        // повторной отправки нет.
        if (r.kind === "drop") {
          nudgeFlyTake(it)
          if (it.done) return undefined
          it.done = true
          const dx: any = { outcome: "nudge_undelivered", by: "drop", agent: "main", reason: clip(r.reason, 240) }
          if (late) dx.late = true
          return nudgeJournal($, it, dx)
        }
        noteLost(late ? "nudge-submit-late" : "nudge-submit", r.x, $)
        it.fly = false
        it.fails = (it.fails || 0) + 1
        // CONSTRAINT: отказ submit, повторяющийся каждый тик, ограничен:
        // NUDGE_SUBMIT_FAILS_MAX отказов подряд одной записи -- запись снята
        // строкой с числом попыток (успех и drop снимают её раньше).
        if (it.fails >= NUDGE_SUBMIT_FAILS_MAX) {
          nudgeFlyTake(it)
          if (it.done) return undefined
          it.done = true
          const gx: any = { outcome: "nudge_undelivered", by: "submit-failed", agent: "main", attempts: it.fails, err: safeText(r.x).slice(0, 240) }
          if (late) gx.late = true
          return nudgeJournal($, it, gx)
        }
        nudgeFlyToHead(it, ep)
        if (it.said.indexOf("submit-failed") >= 0) return undefined
        it.said.push("submit-failed")
        const fx: any = { outcome: "nudge_undelivered", by: "submit-failed", agent: "main", err: safeText(r.x).slice(0, 240) }
        if (late) fx.late = true
        return nudgeJournal($, it, fx)
      }
      void submitBounded($, it.text, "nudge-submit", (r) => { void answered(r, true) }).then((r) => {
        if (r.kind !== "timeout") return answered(r, false)
        if (it.said.indexOf("submit-timeout") >= 0) return undefined
        it.said.push("submit-timeout")
        return nudgeJournal($, it, { outcome: "nudge_undelivered", by: "submit-timeout", agent: "main" })
      })
    }
    return
  }
  // CONSTRAINT: прогон без человека и неизвестный режим submit не получают
  // (механика #530); строка -- одна на запись и причину, текст ждёт канала (а).
  const by = staleInteractive === false ? "not-interactive" : "interactive-unknown"
  for (let i = 0; i < q.length; i++) {
    const it = q[i]
    if (it.fly || now - it.t < NUDGE_SUBMIT_AGE_MS || it.said.indexOf(by) >= 0) continue
    it.said.push(by)
    await nudgeJournal($, it, { outcome: "nudge_undelivered", by, agent: "main" })
  }
}

// CONSTRAINT: отдельного таймера нет -- тик 60 с #530 зовёт это после проверки
// агентов; список агентов берётся у тика висящих агентов, если тот его снял.
// Список нужен и лестнице: завершённый агент освобождает запись реестра
// проверяющих (#509-FIX9 R7) и даёт served-summary (R5).
async function probeTimerTick($: any, gen: number): Promise<void> {
  const share = probeTickShare
  probeTickShare = null
  if (gen !== staleGen) return
  const ep = epoch
  const live = (): boolean => gen === staleGen && ep === epoch
  const packed = await worldFor($)
  const now = await nowMs($)
  if (!live()) return
  if (sessionStartAt === null) sessionStartAt = now
  await probeConfigNotes($, packed, now)
  if (!live()) return
  const born: number = sessionStartAt === null ? now : sessionStartAt
  const due: any[] = []
  const probes = packed.world.probes
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i]
    if (!probeListens(p, packed.env) || !p.everyMs || p.act === "cancel" || p.pending) continue
    const lastEval = probeEvalAt.has(p.id) ? (probeEvalAt.get(p.id) as number) : born
    if (now - lastEval >= p.everyMs) due.push(p)
  }
  let agentKeys = false
  nudgeQueue.forEach((_q, k) => { if (k) agentKeys = true })
  let lst: any[] | null | undefined = undefined
  let listSeq = 0
  let ladderSeq: LadderSeq = { r: 0, t: 0 }
  // CONSTRAINT (#509-FIX9 R5/R7): список нужен и лестнице -- пока есть учёт
  // шагов или живая запись реестра проверяющих (ladderWatchPending).
  if (due.length || agentKeys || ladderWatchPending(now)) {
    if (share && share.ep === ep) { lst = share.lst; listSeq = share.seq; ladderSeq = share.lseq }
    else {
      listSeq = nudgeSeq
      ladderSeq = ladderSeqNow()
      lst = await probeAgentList($)
    }
    if (!live()) return
    await ladderAgentsListed($, lst, ladderSeq, now)
    if (!live()) return
  }
  const evT = { tool_use_id: "timer-" + String(now) }
  calllessEvents.add(evT)
  for (let i = 0; i < due.length; i++) {
    if (!live()) return
    probeEvalAt.set(due[i].id, now)
    await probeEvaluate($, packed, due[i], { event: "timer", ev: evT, input: { event: "timer" }, lst: lst === undefined ? null : lst, now, aid: undefined, ep })
  }
  if (!live()) return
  await probeNotMainFlush($, packed, now)
  if (!live()) return
  await probeTimerDeliver($, lst, listSeq, now, ep)
}

// CONSTRAINT: для стриминговой регистрации обработчик отказа обязан быть
// генератором (валидатор: событие streams -- "it takes async function*") и
// прогонять поток next ТОЙ ЖЕ дорогой, что основной хук -- driveNext по
// Symbol.asyncIterator: голый `return next(e)` отдал бы ОБЪЕКТ ГЕНЕРАТОРА
// вместо потока, шаги не эмитились бы, и это второе место разошлось бы
// молча.
// CONSTRAINT: $ здесь не читается -- отказ чтения agentId учитывается noteLost без $.
async function* observerFailThroughStream($: any, e: any, next: any): AsyncGenerator<any, any, any> {
  let aid: string | undefined = undefined
  try {
    const a = e == null ? undefined : e.agentId
    if (a != null && a !== "") aid = String(a)
  } catch (x) { noteLost("stale-agents-track", x) }
  return yield* driveNext(next(e), undefined, aid)
}

// CONSTRAINT: одно тело для главного лупа и для агента при пробе
// subagents = true на Pre/PostToolUse; main-only пробы агента пропускаются.
// Объявление -- на верхнем уровне файла: загрузчик пускает $ только в такие.
async function toolCallProbed($: any, e: any, next: any, isAgent: boolean, aid: string, hearNull: boolean = false): Promise<any> {
  const ev = snapEvent($, e, "tool.call")
  if (ev.tool === FLEET_TOOL_FULL) return { result: await fleetAnswer($) }
  if (!isAgent && !staleTimer) {
    const tArm = await nowMs($)
    if (!(tArm - staleArmFailedAt < STALE_AGENTS_PERIOD_MS)) armStaleAgentsTimer($, tArm)
  }
  const tool = String((ev && ev.tool) || "")
  // CONSTRAINT: tool.call главного лупа (нет agentId) -- горячий путь.
  // Замер 2026-09-18, транскрипт worktree claudeapp session 9632494b,
  // 493 часа с tool_use: медиана 41/час, пик 251/час (2026-09-15T20).
  // command.describe даёт 254 чтения за одну сборку промпта; без мемо
  // этот путь читал probes.toml на каждый вызов. Мир берётся через
  // worldFor -- то же окно, что у describe/spawn.
  const packed = await worldFor($)
  // CONSTRAINT (#509-FIX7 Р17): вызов агента, вошедший при probeHear === null,
  // считает not-main по индексу, собранному этим worldFor, -- как быстрый путь.
  if (isAgent && hearNull) notMainCount(ev && ev.tool_use_id != null && ev.tool_use_id !== "" ? String(ev.tool_use_id) : "")
  const env = packed.env
  const world = packed.world
  const prompt = String((ev && ev.prompt) || "")
  const agent = String((ev && ev.subagent_type) || "")
  const t0 = await nowMs($)
  const sid = await sidFor($)
  // CONSTRAINT: метка мира снимается ОДИН раз на консультацию, рядом с sid, и
  // едет в consultBg параметром. Снимать её заново на каждой ступени нельзя:
  // смена сессии, пришедшаяся на ОТКАЗ ступени, дала бы следующей ступени уже
  // свежую метку -- её вердикт применился бы к новому миру, но лёг бы под
  // ключ кэша, посчитанный из СТАРОГО sid (строка ниже).
  const epCall = epoch
  if (sessionStartAt === null) sessionStartAt = t0
  // CONSTRAINT: запуск Agent/Task главного лупа учитывается ДО счёта окна
  // idle-watch (README «Thresholds»: текущий диспатч в окне).
  if (!isAgent && (tool === "Agent" || tool === "Task")) {
    probeLaunches.push(t0)
    probeLaunchesPrune(world, env, t0)
  }
  await probeConfigNotes($, packed, t0)
  let live: number | null = 0
  let lstArr: any[] | null = []
  try {
    const lst = await $.agent.list()
    if (Array.isArray(lst)) { live = lst.length; lstArr = lst }
    // CONSTRAINT: не-массив -- не «ноль живых», а неизвестность: live=null
    // уводит when по live_works в ветку unknown, а не в ложное срабатывание.
    else { live = null; lstArr = null; noteLost("agent-list-shape", new Error("agent.list returned " + typeof lst), $) }
  } catch (x) { live = null; lstArr = null; noteLost("agent-list", x, $) }

  let hardDeny: string | null = null
  const formStates: FormState[] = []
  // CONSTRAINT: ключ кэпа сессионный -- бессрочный кросс-сессионный ключ
  // навсегда хоронил ветку nudge/log_only; окно и слияние -- capSeed/capTake.
  let capRaw: any = undefined
  try { capRaw = await $.store.get(CAP_KEY + ":" + sid) } catch (x) { noteLost("session-cap-read", x, $) }
  capSeedFrom($, sid, capRaw, t0)

  for (let i = 0; i < world.probes.length; i++) {
    const p = world.probes[i]
    const arm = armStateOf(p, env)
    if (arm.state === "off") continue
    if (p.mainLoopOnly && isAgent) continue
    if (p.kind === "form") {
      if (p.cfg && p.cfg.enabled === false) continue
      // CONSTRAINT (#335): отказ -- в точке действия формы (её список
      // инструментов); вне списка форма не действовала бы -- и не гасит.
      // CONSTRAINT (#393): нечитаемая ручка -- та же точка действия.
      if (arm.state === "env-unreadable" && formActsOnTool(String((ev && ev.tool) || ""))) {
        const d = await refuseEnvUnreadable($, world, arm, t0, sid)
        if (d && !hardDeny) hardDeny = d
        continue
      }
      if (arm.state === "foreign-carrier" && formActsOnTool(String((ev && ev.tool) || ""))) {
        const d = await refuseForeignCarrier($, world, arm, t0, sid)
        if (d && !hardDeny) hardDeny = d
        continue
      }
      const d = await runForm($, p, env, world, ev, formStates)
      if (d && !hardDeny) hardDeny = d
      continue
    }
    if (p.kind !== "consult") continue
    if (!Array.isArray(p.on) || p.on.indexOf("PreToolUse") < 0) continue

    let last = 0
    let lastStore = 0
    try { lastStore = Number(await $.store.get(lastKey(p.id, world.cwd)) || 0) } catch (x) { noteLost("consult-last-read", x, $) }
    // CONSTRAINT: максимум, не последнее чтение: зеркало ставится синхронно, стор --
    // после await; стор ниже зеркала бывает и при упавшей своей записи, и при
    // чередовании двух консультаций (запись поздней отметки завершилась раньше
    // ранней). Шаг часов назад понижает оба дома одной отметкой.
    last = Math.max(lastStore, lastMirror.get(lastKey(p.id, world.cwd)) || 0)
    // CONSTRAINT: зеркало отметки пишется и при удачном чтении -- та же
    // дыра, что у кэпа: отказ чтения стора не должен открывать окно.
    lastMirror.set(lastKey(p.id, world.cwd), last)
    const ctx: any = {
      now: t0,
      tool_name: tool,
      tool,
      subagent_type: agent,
      prompt,
      live_works: live,
      unknown: live === null ? ["live_works"] : [],
      last_consultation: last,
      agent_id: isAgent ? aid : undefined,
      event: "PreToolUse",
    }
    flatInto(ctx, ev)

    let fire = false
    let by = ""
    if (p.id === "idle-watch") { by = idleGate(p, ctx, lstArr, t0); fire = by === "" }
    else if (p.builtin) { fire = builtinTrigger(p, ev, ctx); if (!fire) by = "when-false" }
    else if (p.cfg && p.cfg.when) { const u = whenFields(p.cfg.when).filter((f) => ctx.unknown.indexOf(f) >= 0); if (u.length) { for (const f of u) addWhenBad(ctx, "unknown=" + f); fire = false } else { fire = pred(p.cfg.when, ctx); if (!fire) by = "when-false" } }
    else fire = true
    if (fire) { by = probeCooldownBy(p, last, t0); if (by) fire = false }
    if (!fire) {
      // CONSTRAINT: несработавший триггер вооружённой пробы пишет filtered
      // (частота -- probeFiltered); мёртвое правило пишет when_bad ниже.
      if (!ctx.whenBad && by && by !== "when-bad" && arm.state === "armed" && !(p.cfg && p.cfg.enabled === false)) {
        await probeFiltered($, world, p, by, "PreToolUse", t0)
      }
      // CONSTRAINT (#391): при несработавшем правиле consultBg не зовётся, и
      // улика из ctx не доехала бы никуда -- поэтому мёртвое правило пишет
      // СВОЮ строку. Граница молчания чужого носителя -- та же, что у
      // пропуска судьи (#335): он не работал, ему не о чем отчитываться.
      // Нечитаемая ручка (#393) -- та же граница: состояние неизвестно.
      if (ctx.whenBad && arm.state !== "foreign-carrier" && arm.state !== "env-unreadable" && probeSayDue(p, "when_bad", t0)) {
        try {
          await appendJournal($, world.globalHome + "/" + p.id + "/journal.jsonl", {
            t: isoOf(t0), tool, agent, outcome: "when_bad",
            rec: modRecName(ev), carrier: carrierOfJournal(p, env), sid: await sidFor($),
            whenBad: ctx.whenBad, ms: 0, probe: p.id,
          })
        } catch (x) { noteLost("journal-when-bad", x, $) }
      }
      continue
    }

    if (p.cfg && p.cfg.enabled === false) {
      if (p.id === "judge") {
        const recName = "mod-" + String((ev && ev.tool_use_id) || "noid") + ".json"
        try {
          await appendJournal($, world.globalHome + "/judge/journal.jsonl", {
            t: isoOf(t0), tool, agent, outcome: "skip_disabled",
            rec: recName, carrier: carrierOfJournal(p, env), sid: await sidFor($), ms: 0, probe: "judge",
          })
        } catch (x) { noteLost("journal-skip-disabled", x, $) }
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
      const badPat: string[] = []
      let by: string | null = null
      if (!amb) {
        for (let s = 0; s < skipC.length; s++) {
          if (reTestMark(skipC[s], cl, "classes_skip", badPat)) { by = "classes_skip"; break }
        }
      }
      if (!by) {
        for (let s = 0; s < skipA.length; s++) {
          if (reTestMark(skipA[s], agent, "agents_skip", badPat)) { by = "agents_skip"; break }
        }
      }
      if (!by && (judgeC.length > 0 || judgeA.length > 0) && !amb) {
        let hit = false
        const badBefore = badPat.length
        for (let s = 0; s < judgeC.length; s++) {
          if (reTestMark(judgeC[s], cl, "classes_judge", badPat)) hit = true
        }
        for (let s = 0; s < judgeA.length; s++) {
          if (reTestMark(judgeA[s], agent, "agents_judge", badPat)) hit = true
        }
        // CONSTRAINT (#391): негодный образец в списках СУДЬИ судью НЕ
        // снимает -- направление отказа в сторону защиты. Негодность
        // skip-списков сюда не считается (там пропуск просто не случится),
        // потому граница берётся по длине bad ДО этих двух циклов.
        if (!hit && badPat.length === badBefore) by = cl ? "not_in_judge_list" : "no_class_marker"
      }
      if (badPat.length) ctx.badPattern = badPat.join(" ")
      if (by) {
        // CONSTRAINT (#335): чужой носитель не работал -- журнал судьи
        // описывает содеянное им, а он не сделал ничего: пропуск молчит.
        // CONSTRAINT (#393): нечитаемая ручка -- та же граница молчания:
        // состояние пробы неизвестно, журнал не называет ложную причину
        // пропуска и не подписывает неизвестного носителя.
        if (arm.state !== "foreign-carrier" && arm.state !== "env-unreadable") {
          const recName = "mod-" + String((ev && ev.tool_use_id) || "noid") + ".json"
          try {
            const jskip: any = {
              t: isoOf(t0), tool, agent, outcome: "skip",
              rec: recName, carrier: carrierOfJournal(p, env), sid: await sidFor($), reason: by, cls, ms: 0, probe: "judge",
            }
            if (badPat.length) jskip.badPattern = badPat.join(" ")
            await appendJournal($, world.globalHome + "/judge/journal.jsonl", jskip)
          } catch (x) { noteLost("journal-skip", x, $) }
        }
        continue
      }
    }

    // CONSTRAINT (#335): точка отказа консультации -- за ВЫЧИСЛЯЕМОЙ
    // границей действия судьи, его списками классов и агентов: пропуск по
    // ним -- та же граница, что список инструментов у формы, вычисляемая,
    // а не статическая. Консультация без списков блок не проходит вовсе,
    // и её отказ стоит здесь же -- сразу за выключателем enabled.
    // CONSTRAINT (#393): нечитаемая ручка отказывает в той же точке.
    if (arm.state === "env-unreadable") {
      const d = await refuseEnvUnreadable($, world, arm, t0, sid)
      if (d && !hardDeny) hardDeny = d
      continue
    }
    if (arm.state === "foreign-carrier") {
      const d = await refuseForeignCarrier($, world, arm, t0, sid)
      if (d && !hardDeny) hardDeny = d
      continue
    }

    if (p.act === "cancel" || p.pending) {
      // CONSTRAINT: допуск повтора уборки решается синхронно ПОСЛЕ чтения часов: идущая уборка и уже снятый отказ повтора не открывают, две консультации одного окна не запускают две уборки.
      if (!sweepRunning && (!sweepDone || sweepFailed)) {
        let due = !sweepDone
        if (!due) {
          const tn = await nowMs($)
          due = !sweepRunning && sweepFailed && sweepRetryDue(tn)
        }
        if (due) await sweepVerdictStore($, world, sid, env)
      }
      const key = verdictKey(p.id, sid, tool, agent, prompt)
      const ttlMs = num(p.cfg && p.cfg.verdict_cache_ms, VERDICT_TTL_MS_DEFAULT, 1)
      let stored: any
      try { stored = await $.store.get(key) } catch (x) { stored = undefined; noteLost("verdict-cache-read", x, $) }
      const enforce = enforceOf(p, env, p.cfg)
      const failClosed = bl3(p.cfg.fail_closed, p.id === "judge")
      const storedKind = stored && typeof stored === "object" ? stored.kind : undefined
      const storedT = storedKind && !passKind(p.id, storedKind) ? stored.t : undefined
      if (memoUsable({ kind: storedKind, t: storedT }, t0, ttlMs, p.id)) {
        stored = { kind: storedKind, t: storedT, used: stored.used, dtMs: stored.dtMs, threw: stored.threw, rest: stored.rest }
        // CONSTRAINT: попадание в кэш обязано оставлять тот же след, что и
        // консульт, -- без улики и строки журнала оно отменяло суд молча.
        const recName = modRecName(ev)
        const ageMs = t0 - stored.t
        let recErr = ""
        try {
          await $.fs.write(modRecPath(world, p.id, ev), JSON.stringify({
            id: ev && ev.tool_use_id, probe: p.id, tool, agent, t0, carrier: carrierOfJournal(p, env),
            mod: MOD_VERSION, sid, memo: true, kind: String(stored.kind), ageMs,
            used: stored.used, dtMs: stored.dtMs, ...(stored.threw !== undefined ? { threw: stored.threw } : {}),
          }))
        } catch (x) { recErr = safeText(x).slice(0, 240) }
        try {
          const jline: any = {
            t: isoOf(t0), tool, agent, outcome: "memo", rec: recName,
            carrier: carrierOfJournal(p, env), sid, kind: String(stored.kind), ageMs, ms: 0, probe: p.id,
          }
          if (recErr) jline.recErr = recErr
          await appendJournal($, world.globalHome + "/" + p.id + "/journal.jsonl", jline)
        } catch (x) {
          try {
            recErr = recErr || safeText(x).slice(0, 240)
            await $.fs.write(modRecPath(world, p.id, ev), JSON.stringify({
              id: ev && ev.tool_use_id, probe: p.id, tool, agent, t0, carrier: carrierOfJournal(p, env),
              mod: MOD_VERSION, sid, memo: true, kind: String(stored.kind), ageMs,
              used: stored.used, dtMs: stored.dtMs, ...(stored.threw !== undefined ? { threw: stored.threw } : {}), journalErr: recErr,
            }))
          } catch (y) { noteLost("judge-memo-record", y, $) }
        }
        if (foldedKind(p.id, String(stored.kind))) {
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
      try { rec = await consultBg($, p, env, world, ev, ctx, key, epCall) } catch (x) { rec = null; noteLost("judge-consult", x, $) }
      const kind = rec && rec.kind ? String(rec.kind) : ""
      if (passKind(p.id, kind)) continue
      if (foldedKind(p.id, kind)) {
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
      const why = probeMarkTake($, p, lastKey(p.id, world.cwd), sid, t0)
      if (why) {
        await probeFiltered($, world, p, why, "PreToolUse", t0)
        continue
      }
      try { await $.store.set(lastKey(p.id, world.cwd), t0) } catch (x) { noteLost("consult-last", x, $) }
      ;(async () => { try { await consultBg($, p, env, world, ev, ctx, "", epCall) } catch (x) { noteLost("observer-consult", x, $) } })()
    }
  }

  if (hardDeny) return { deny: hardDeny }
  // CONSTRAINT: агент без id не получает очередь главного лупа.
  const aKey: string | null = isAgent ? (aid || null) : ""
  const post: any[] = []
  for (let i = 0; i < world.probes.length; i++) {
    const p = world.probes[i]
    if (!probeListens(p, env, true)) continue
    if (p.kind === "form") {
      if (formStates.some(state => state.p === p)) post.push(p)
      continue
    }
    if (p.on.indexOf("PostToolUse") < 0) continue
    if ((p.mainLoopOnly && isAgent) || p.act === "cancel" || p.pending) continue
    post.push(p)
  }
  const qPending = aKey === null ? undefined : nudgeQueue.get(aKey)
  if (!post.length && !(qPending && qPending.length)) return next(e)
  try {
    const backupBudget = { bytes: 0 }
    for (const state of formStates) {
      const failure = await formBackup($, state, world, env, ev, backupBudget)
      if (failure) return { deny: failure }
    }
    let res: any, nextError: any, nextThrew = false
    try { res = await next(e) } catch (x) { nextError = x; nextThrew = true }
    let formDeny: string | null = null
    // CONSTRAINT: откат принадлежит своему вызову даже при смене эпохи и исключении next.
    try {
      for (const state of formStates) {
        const denial = await formPost($, state, env, world, ev)
        if (denial && !formDeny) formDeny = denial
      }
    } finally { if (nextThrew) throw nextError }
    if (post.length && epoch === epCall) {
      const tp = await nowMs($)
      for (let i = 0; i < post.length; i++) {
        if (epoch !== epCall) break
        if (post[i].kind === "form") continue
        await probeEvaluate($, packed, post[i], {
          event: "PostToolUse", ev, input: ev, lst: lstArr, now: tp, aid: isAgent ? aid : undefined, ep: epCall,
          toolResult: res && typeof res === "object" ? res.result : res,
        })
      }
    }
    if (formDeny) return { deny: formDeny }
    const fanoutWarnings = formStates.filter(state => state.fanout).map(state => "form-post-skipped-fanout " + state.fanout)
    if (fanoutWarnings.length) res = { ...(res && typeof res === "object" ? res : { result: res }), context: (Array.isArray(res?.context) ? res.context : res?.context == null ? [] : [String(res.context)]).concat(fanoutWarnings) }
    // CONSTRAINT: эпоха сменилась за время вызова -- очередь уже новой сессии.
    if (aKey === null || epoch !== epCall) return res
    return nudgeDeliverContext($, aKey, res)
  } finally {
    await formCleanup($, formStates)
  }
}

// CONSTRAINT: история запусков -- для счёта окна idle-watch: прополка по
// возрасту (старше наибольшего window_min вооружённых проб; нет вооружённых --
// по возрасту не полется) и предел длины не ниже наибольшего threshold + 1:
// усечение ниже порога меняло бы смысл условия launches < threshold.
function probeLaunchesPrune(world: any, env: any, now: number): void {
  let winMs = -1
  let thr = 0
  const probes = world && Array.isArray(world.probes) ? world.probes : []
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i]
    if (!probeListens(p, env)) continue
    const cfg = p.cfg || {}
    winMs = Math.max(winMs, num(cfg.window_min, 30, 0) * 60000)
    thr = Math.max(thr, num(cfg.threshold, 1, 0))
  }
  if (winMs >= 0) probeLaunches = probeLaunches.filter((t) => !(now - t > winMs))
  const lim = Math.max(PROBE_LAUNCH_MAX, thr + 1)
  if (probeLaunches.length > lim) probeLaunches.splice(0, probeLaunches.length - lim)
}

export function register(on: any) {
  on("session.start", async ($: any, e: any, next: any) => {
    const ev = snapEvent($, e, "session.start")
    try {
      const cwd = ev && ev.cwd
      if (cwd) { await $.store.set(CWD_KEY, String(cwd)); cwdStoreStale = false }
    } catch (x) { cwdStoreStale = true; noteLost("session-cwd", x, $) }
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
    } catch (x) { noteLost("ladder-command-register", x, $) }
    staleInteractive = !!(ev && ev.isInteractive === true)
    try {
      const tStart = await nowMs($)
      sessionStartAt = tStart
      armStaleAgentsTimer($, tStart)
    } catch (x) { noteLost("stale-agents-timer-start", x, $) }
    // CONSTRAINT: индекс слушателей classic.* строится сборкой мира; без неё
    // событие до первого tool.call не видело бы ни одной пробы.
    try { await worldFor($) } catch (x) { noteLost("probe-index-start", x, $) }
    try {
      await $.tool.register({ name: FLEET_TOOL, description: FLEET_TOOL_DESCRIPTION, inputSchema: { type: "object", properties: {} } })
    } catch (x) { noteLost("fleet-tool-register", x, $) }
    try {
      await $.command.register({ name: FLEET_COMMAND, description: FLEET_COMMAND_DESCRIPTION, immediate: false })
    } catch (x) { noteLost("fleet-command-register", x, $) }
    return next(e)
  })
    .catch(observerFailThrough)

  // CONSTRAINT: session.end публикует конец сессии под её собственным id
  // (e.sessionId): после /clear процесс продолжается под другим, и запись
  // живой сессии не должна перекрыться чужим концом.
  on("session.end", async ($: any, e: any, next: any) => {
    const ev = snapEvent($, e, "session.end")
    let packed: any = null
    try { packed = await worldFor($) } catch (x) { noteLost("fleet-end-world", x, $) }
    if (packed && idleWatchArm(packed) === "armed") {
      try {
        const sid = String((ev && ev.sessionId) || "") || await sidFor($)
        await fleetPublish($, packed.world, sid, { v: 1, sid, cwd: packed.world.cwd, t: await nowMs($), running: 0, agents: [], ended: true }, "fleet-end-publish")
      } catch (x) { noteLost("fleet-end-publish", x, $) }
    }
    return next(e)
  })
    .catch(observerFailThrough)

  on("command.run", { command: [FLEET_COMMAND] }, async ($: any, e: any, next: any) => {
    return { text: await fleetAnswer($) }
  })
    .catch(observerFailThrough)

  on("command.run", { command: ["clear", "resume"] }, async ($: any, e: any, next: any) => {
    const ev = snapEvent($, e, "command.run")
    const result = await next(e)
    // CONSTRAINT: сброс строго ПОСЛЕ next(e) (образ -- официальный мод diff):
    // команда обязана отработать и при отказе сброса, поэтому newSession
    // взведён под отдельным try.
    // CONSTRAINT: хвост пишется отдельно от ответа команды -- запись не
    // задерживает /clear, отказ учитывается по месту failover-fold-reset-tail.
    let tail: any = null
    try { tail = newSession($) } catch (x) { noteLost("new-session", x, $) }
    if (tail) {
      const w = tail.world
      const jpath = w && w.globalHome ? w.globalHome + "/failover/journal.jsonl" : ""
      if (!jpath) {
        const x = new Error("no journal home, n=" + String(tail.rec.n))
        noteLost("failover-fold-reset-tail", x, $)
        failoverFoldTailLost(tail.rec, x)
      } else void (async () => {
        try { await appendJournal($, jpath, tail.rec) } catch (x) {
          noteLost("failover-fold-reset-tail", x, $)
          failoverFoldTailLost(tail.rec, x)
        }
      })()
    }
    return result
  })
    .catch(observerFailThrough)

  // CONSTRAINT: подписка -- отдельным вызовом ТОЛЬКО на свою команду. Ответ --
  // ровно {text}: $.command.run из command.run-хука хост запрещает (волна 1
  // #178, байты образа: вызов ждал бы ход, который держит этот хук). Матчер --
  // массивная форма: строковая не измерена, массивная дошла до живого хоста
  // (волна 2 #178, r2/r3).
  on("command.run", { command: [LADDER_COMMAND] }, async ($: any, e: any, next: any) => {
    const ev = snapEvent($, e, "command.run")
    return { text: ladderCommandText(await nowMs($), String((ev && ev.args) || "")) }
  })
    .catch(observerFailThrough)

  on("prompt.section", async ($: any, e: any, next: any) => {
    const ev = snapEvent($, e, "prompt.section")
    const name = String((ev && ev.name) || "")
    let w: any = null
    try { w = await worldFor($) } catch (x) { w = null; noteLost("prompt-section-world", x, $) }
    if (!w) return next(e)
    const r = await applyPromptRules($, w.world, w.env, "section", name, String((ev && ev.text) || ""))
    if (!r.applied.length) return next(e)
    return next(Object.assign({}, ev, { text: r.text }))
  })
    .catch(observerFailThrough)

  // Field names measured live on 2.1.267: tool.describe carries
  // `tool,description,provider`; command.describe carries
  // `command,description,argumentHint,isHidden,immediate,provider`.
  on("tool.describe", async ($: any, e: any, next: any) => {
    const ev = snapEvent($, e, "tool.describe")
    const name = String((ev && ev.tool) || "")
    if (!name) return next(e)
    let w: any = null
    try { w = await worldFor($) } catch (x) { w = null; noteLost("tool-describe-world", x, $) }
    if (!w) return next(e)
    const r = await applyPromptRules($, w.world, w.env, "tool", name, String((ev && ev.description) || ""))
    if (!r.applied.length) return next(e)
    return next(Object.assign({}, ev, { description: r.text }))
  })
    .catch(observerFailThrough)

  on("command.describe", async ($: any, e: any, next: any) => {
    const ev = snapEvent($, e, "command.describe")
    const raw = String((ev && ev.command) || "")
    if (!raw) return next(e)
    // A table may name the command with or without the leading slash.
    const bare = raw.charAt(0) === "/" ? raw.slice(1) : raw
    let w: any = null
    try { w = await worldFor($) } catch (x) { w = null; noteLost("command-describe-world", x, $) }
    if (!w) return next(e)
    const text = String((ev && ev.description) || "")
    let r = await applyPromptRules($, w.world, w.env, "command", raw, text)
    if (!r.applied.length && bare !== raw) {
      r = await applyPromptRules($, w.world, w.env, "command", bare, text)
    }
    if (!r.applied.length) return next(e)
    return next(Object.assign({}, ev, { description: r.text }))
  })
    .catch(observerFailThrough)

  on("tool.call", async ($: any, e: any, next: any) => {
    // CONSTRAINT (#489-B1-FIX5 Z13.5): ловушка has прокси срабатывает на
    // КАЖДОЙ проверке `"agentId" in`; вычисляется один раз здесь и берётся
    // ниже из isAgent.
    const isAgent = "agentId" in e
    // CONSTRAINT: инструмент флота обслуживает ЭТА подписка первой веткой, для главного лупа и агентов: у плагина ровно одна подписка tool.call (вторая той же двери могла бы молча заменить первую -- судью, #447).
    if (isAgent) {
      // CONSTRAINT: событие агента не материализуется: читаются ровно tool,
      // agentId, tool_use_id по разу. Учёт активности не имеет права ломать
      // вызов: он под глухим try, next(e) зовётся при любом его исходе.
      let toolA: any = undefined
      let aidA: any = undefined
      let tuidA: any = undefined
      try {
        toolA = e.tool
        aidA = e.agentId
        tuidA = e.tool_use_id
      } catch (x) { noteLost("stale-agents-track", x, $) }
      if (toolA === FLEET_TOOL_FULL) return { result: await fleetAnswer($) }
      let aidT = ""
      let keyT = ""
      try {
        if (aidA != null && aidA !== "") {
          aidT = String(aidA)
          const r = staleRecOf(aidT)
          r.touched = true
          keyT = tuidA != null && tuidA !== "" ? String(tuidA) : "seq-" + String(++staleCallSeq)
          r.inFlight.set(keyT, { tool: String(toolA || ""), seenAt: null })
        }
      } catch (x) { noteLost("stale-agents-track", x, $) }
      // CONSTRAINT: main-only проба, слушающая Pre/PostToolUse, на вызове агента
      // оценивается как not-main; путь агента не читает часов и не зовёт $ --
      // здесь только счёт, строку пишет тик.
      const tuidT = tuidA != null && tuidA !== "" ? String(tuidA) : ""
      const hearNull = probeHear === null
      notMainCount(tuidT)
      try {
        if (hearNull || probeHearAgentTool) return await toolCallProbed($, e, next, true, aidT, hearNull)
        const epA = epoch
        const res = await next(e)
        return aidT && epoch === epA && nudgeQueue.has(aidT) ? await nudgeDeliverContext($, aidT, res) : res
      } finally {
        if (aidT) {
          try {
            const r = staleRecOf(aidT)
            r.touched = true
            r.inFlight.delete(keyT)
          } catch (x) { noteLost("stale-agents-track", x, $) }
        }
      }
    }
    return toolCallProbed($, e, next, false, "")
  })
    .catch(($: any, e: any, next: any) => decisiveFailClosed($, "tool.call", e, next))

  // CONSTRAINT: по одной подписке на имя CLASSIC_EVENTS кроме PreToolUse,
  // PostToolUse (tool.call) и MessageDisplay (дельта отрисовки). Имя события в
  // on() -- литерал: загрузчик отвергает вычисленное имя (замер #531,
  // loader-a-loop.log), поэтому цикла здесь нет. Быстрый путь -- синхронный
  // next(e) без $ и без await, когда индекс не знает слушателя.
  on("classic.ConfigChange", ($: any, e: any, next: any) => probeHear === null || probeHear.has("ConfigChange") ? classicRun($, "ConfigChange", e, next) : next(e)).catch(observerFailThrough)
  on("classic.CwdChanged", ($: any, e: any, next: any) => probeHear === null || probeHear.has("CwdChanged") ? classicRun($, "CwdChanged", e, next) : next(e)).catch(observerFailThrough)
  on("classic.DirectoryAdded", ($: any, e: any, next: any) => probeHear === null || probeHear.has("DirectoryAdded") ? classicRun($, "DirectoryAdded", e, next) : next(e)).catch(observerFailThrough)
  on("classic.Elicitation", ($: any, e: any, next: any) => probeHear === null || probeHear.has("Elicitation") ? classicRun($, "Elicitation", e, next) : next(e)).catch(observerFailThrough)
  on("classic.ElicitationResult", ($: any, e: any, next: any) => probeHear === null || probeHear.has("ElicitationResult") ? classicRun($, "ElicitationResult", e, next) : next(e)).catch(observerFailThrough)
  on("classic.FileChanged", ($: any, e: any, next: any) => probeHear === null || probeHear.has("FileChanged") ? classicRun($, "FileChanged", e, next) : next(e)).catch(observerFailThrough)
  on("classic.InstructionsLoaded", ($: any, e: any, next: any) => probeHear === null || probeHear.has("InstructionsLoaded") ? classicRun($, "InstructionsLoaded", e, next) : next(e)).catch(observerFailThrough)
  on("classic.Notification", ($: any, e: any, next: any) => probeHear === null || probeHear.has("Notification") ? classicRun($, "Notification", e, next) : next(e)).catch(observerFailThrough)
  on("classic.PermissionDenied", ($: any, e: any, next: any) => probeHear === null || probeHear.has("PermissionDenied") ? classicRun($, "PermissionDenied", e, next) : next(e)).catch(observerFailThrough)
  on("classic.PermissionRequest", ($: any, e: any, next: any) => probeHear === null || probeHear.has("PermissionRequest") ? classicRun($, "PermissionRequest", e, next) : next(e)).catch(observerFailThrough)
  on("classic.PostCompact", ($: any, e: any, next: any) => probeHear === null || probeHear.has("PostCompact") ? classicRun($, "PostCompact", e, next) : next(e)).catch(observerFailThrough)
  on("classic.PostModelSwitch", ($: any, e: any, next: any) => probeHear === null || probeHear.has("PostModelSwitch") ? classicRun($, "PostModelSwitch", e, next) : next(e)).catch(observerFailThrough)
  on("classic.PostToolBatch", ($: any, e: any, next: any) => probeHear === null || probeHear.has("PostToolBatch") ? classicRun($, "PostToolBatch", e, next) : next(e)).catch(observerFailThrough)
  on("classic.PostToolUseFailure", ($: any, e: any, next: any) => probeHear === null || probeHear.has("PostToolUseFailure") ? classicRun($, "PostToolUseFailure", e, next) : next(e)).catch(observerFailThrough)
  on("classic.PreCompact", ($: any, e: any, next: any) => probeHear === null || probeHear.has("PreCompact") ? classicRun($, "PreCompact", e, next) : next(e)).catch(observerFailThrough)
  on("classic.PreModelSwitch", ($: any, e: any, next: any) => probeHear === null || probeHear.has("PreModelSwitch") ? classicRun($, "PreModelSwitch", e, next) : next(e)).catch(observerFailThrough)
  on("classic.SessionEnd", ($: any, e: any, next: any) => probeHear === null || probeHear.has("SessionEnd") ? classicRun($, "SessionEnd", e, next) : next(e)).catch(observerFailThrough)
  on("classic.SessionStart", ($: any, e: any, next: any) => probeHear === null || probeHear.has("SessionStart") ? classicRun($, "SessionStart", e, next) : next(e)).catch(observerFailThrough)
  on("classic.Setup", ($: any, e: any, next: any) => probeHear === null || probeHear.has("Setup") ? classicRun($, "Setup", e, next) : next(e)).catch(observerFailThrough)
  on("classic.StopFailure", ($: any, e: any, next: any) => probeHear === null || probeHear.has("StopFailure") ? classicRun($, "StopFailure", e, next) : next(e)).catch(observerFailThrough)
  on("classic.Stop", ($: any, e: any, next: any) => probeHear === null || probeHear.has("Stop") ? classicRun($, "Stop", e, next) : next(e)).catch(observerFailThrough)
  on("classic.SubagentStart", ($: any, e: any, next: any) => probeHear === null || probeHear.has("SubagentStart") ? classicRun($, "SubagentStart", e, next) : next(e)).catch(observerFailThrough)
  on("classic.SubagentStop", ($: any, e: any, next: any) => probeHear === null || probeHear.has("SubagentStop") ? classicRun($, "SubagentStop", e, next) : next(e)).catch(observerFailThrough)
  on("classic.TaskCompleted", ($: any, e: any, next: any) => probeHear === null || probeHear.has("TaskCompleted") ? classicRun($, "TaskCompleted", e, next) : next(e)).catch(observerFailThrough)
  on("classic.TaskCreated", ($: any, e: any, next: any) => probeHear === null || probeHear.has("TaskCreated") ? classicRun($, "TaskCreated", e, next) : next(e)).catch(observerFailThrough)
  on("classic.TeammateIdle", ($: any, e: any, next: any) => probeHear === null || probeHear.has("TeammateIdle") ? classicRun($, "TeammateIdle", e, next) : next(e)).catch(observerFailThrough)
  on("classic.UserPromptExpansion", ($: any, e: any, next: any) => probeHear === null || probeHear.has("UserPromptExpansion") ? classicRun($, "UserPromptExpansion", e, next) : next(e)).catch(observerFailThrough)
  on("classic.UserPromptSubmit", ($: any, e: any, next: any) => probeHear === null || probeHear.has("UserPromptSubmit") ? classicRun($, "UserPromptSubmit", e, next) : next(e)).catch(observerFailThrough)
  on("classic.WorktreeCreate", ($: any, e: any, next: any) => probeHear === null || probeHear.has("WorktreeCreate") ? classicRun($, "WorktreeCreate", e, next) : next(e)).catch(observerFailThrough)
  on("classic.WorktreeRemove", ($: any, e: any, next: any) => probeHear === null || probeHear.has("WorktreeRemove") ? classicRun($, "WorktreeRemove", e, next) : next(e)).catch(observerFailThrough)

  on("agent.spawn", async ($: any, e: any, next: any) => {
    // CONSTRAINT (#509-FIX8h Р2): поколение реестров сессии -- до первого await; сменилось к записи (сброс новой сессией) -- обе записи спавна пропускаются.
    const genSpawn = sessionReviewerServedGenOf()
    const ev = snapEvent($, e, "agent.spawn")
    const subagentType = String((ev && ev.subagentType) || "")
    const cls = classesOf(String((ev && ev.prompt) || ""))
    const classId = cls.length ? cls[0] : ""
    const spawnModel = String((ev && ev.model) || "")
    let world: any = null
    try {
      const w = await worldFor($)
      world = w && w.world
    } catch (x) { world = null; noteLost("failover-spawn-world", x, $) }
    const result = await next(e)
    // CONSTRAINT (#489-B1-FIX5 Z13.4): deny и agentId ответа хоста читаются по
    // ОДНОМУ разу в локальные сразу после await; все дальнейшие места -- локальные.
    const resDeny = result && result.deny
    const resAgentId = result && result.agentId
    if (!result || resDeny || !resAgentId) return result
    const spawnReviewer = classHasPrefix(classId, REVIEWER_CLASS_PREFIXES)
    const tSpawn = spawnReviewer ? await nowMs($) : 0
    const spawnGenOk = genSpawn === sessionReviewerServedGenOf()
    if (spawnGenOk && classHasPrefix(classId, EXECUTOR_CLASS_PREFIXES)) sessionExecutorModelAdd(spawnModel)
    if (spawnGenOk && spawnReviewer) sessionReviewerServedSet(String(resAgentId), spawnModel, tSpawn)
    if (!world || !world.failover || !bl3(world.failover.enabled, true)) return result
    const info = failoverLadderBind(world.failover, subagentType, classId)
    const term = failoverTerminal(world.failover)
    const adm = admitLadder(info.ladder, classId, world.allowedByClass, admissionUsable(world))
    let rungEffort = info.rungEffort
    let effortBad = info.effortBad
    // CONSTRAINT (D-3a): одноимённая ступень лестницы сохраняет свой эффорт.
    if (term.effort && modelKeyed(rungEffort, term.model) === undefined) rungEffort = Object.assign({}, rungEffort, { [term.model]: term.effort })
    if (term.effortBad && modelKeyed(effortBad, term.model) === undefined) effortBad = Object.assign({}, effortBad, { [term.model]: term.effortBad })
    // CONSTRAINT: пустая лестница неотличима от забытой, если source/allowedSrc
    // не записаны. Привязка кладётся на всех ветках, включая ladder.length===0
    // (клетка без лестницы, слитый допуск без её ступеней или непригоден).
    failoverBindSet(String(resAgentId), {
      ladder: adm.ladder, subagentType, class: classId, sticky: null,
      rungEffort, effortBad, rungsDropped: info.rungsDropped,
      source: info.source, allowedSrc: world.allowedSrc, terminal: term.model,
    })
    const jpath = world.globalHome ? world.globalHome + "/failover/journal.jsonl" : ""
    let sidS = ""
    try { sidS = await sidFor($) } catch (x) { sidS = SID_UNAVAILABLE }
    const tS = await nowMs($)
    if (adm.unavailable && info.ladder.length) {
      const key = String(world.allowedSrc || "") + "\0" + String(world.allowedRefused || "")
      await journalOnce($, admissionUnavailableSaid, key, jpath, {
        t: isoOf(tS), sid: sidS,
        rec: "admission-unavailable-" + String(resAgentId),
        outcome: "admission-unavailable",
        agentId: String(resAgentId), subagentType, class: classId,
        allowedSrc: world.allowedSrc,
        reason: world.allowedRefused || (world.allowedSrc ? "допуск не найден" : "допуск не прочитан"),
        rungsDeclared: info.ladder.slice(),
      }, "journal-admission-unavailable")
    }
    for (let i = 0; i < adm.notAdmitted.length; i++) {
      const model = adm.notAdmitted[i]
      await journalOnce($, rungNotAdmittedSaid, classId + "\0" + normModelId(model), jpath, {
        t: isoOf(tS), sid: sidS,
        rec: "rung-not-admitted-" + String(resAgentId) + "-" + String(i),
        outcome: "rung-not-admitted",
        agentId: String(resAgentId), subagentType, class: classId,
        model, source: info.source, allowedSrc: world.allowedSrc,
      }, "journal-rung-not-admitted")
    }
    // CONSTRAINT: журнал пустой лестницы пишется ЗДЕСЬ, один раз на агента.
    // turn.step на пустой привязке выходит до journalExtra -- писать оттуда
    // залило бы журнал на каждом шаге.
    if (!adm.ladder.length) {
      try {
        // CONSTRAINT: пустой дом даёт путь от корня -- писать наружу нельзя.
        // Тот же гард несёт писатель попыток ниже.
        if (jpath) await appendJournal($, jpath, {
          t: isoOf(tS),
          sid: sidS,
          rec: "empty-ladder-" + String(resAgentId),
          agentId: String(resAgentId),
          subagentType,
          class: classId,
          source: info.source,
          allowedSrc: world.allowedSrc,
          terminal: term.model,
        })
      } catch (x) { noteLost("journal-empty-ladder", x, $) }
    }
    if (term.absent) {
      await journalOnce($, terminalAbsentSaid, term.absent, jpath, {
        t: isoOf(tS),
        sid: sidS,
        rec: "terminal-absent-" + String(resAgentId),
        agentId: String(resAgentId),
        subagentType,
        class: classId,
        reason: term.absent,
      }, "journal-terminal-absent")
    }
    return result
  })
    .catch(($: any, e: any, next: any) => decisiveFailClosed($, "agent.spawn", e, next))

  on("turn.step", async function* ($: any, e: any, next: any) {
    // CONSTRAINT (#509-FIX8h Р2): поколение реестров сессии на начало шага -- до первого await; попытка с резервом сверяет поколение резерва.
    const genStep = sessionReviewerServedGenOf()
    const ev = snapEvent($, e, "turn.step")
    const aid = ev && ev.agentId
    if (aid != null && aid !== "") {
      try {
        staleRecOf(String(aid)).touched = true
      } catch (x) { noteLost("stale-agents-track", x, $) }
    }
    if (aid == null || aid === "") {
      return yield* driveNext(next(e))
    }
    const bind = failoverBindGet(String(aid))
    if (!bind || ((!bind.ladder || !bind.ladder.length) && !bind.terminal)) {
      return yield* driveNext(next(e), undefined, String(aid))
    }
    let world: any = null
    try {
      const w = await worldFor($)
      world = w && w.world
    } catch (x) { world = null; noteLost("failover-step-world", x, $) }
    if (world && world.failover && !bl3(world.failover.enabled, true)) {
      return yield* driveNext(next(e), undefined, String(aid))
    }
    const original = String(ev.model || "")
    // CONSTRAINT (#226): проверяющего (crit-/audit-) нельзя переводить на модель,
    // которой в этой сессии работал исполнитель, -- проверка вырождается в
    // самопроверку. Модель СТАРТА при этом мод не переписывает: назначение вне
    // мода, совпадение уходит в улику отметкой, а не решением.
    const reviewer = classHasPrefix(bind.class, REVIEWER_CLASS_PREFIXES)
    const executor = classHasPrefix(bind.class, EXECUTOR_CLASS_PREFIXES)
    let planLadder: string[] = bind.ladder
    let rungsFiltered = 0
    let rungsFilteredReviewer = 0
    let ladderFullTaken = false
    const startMatch = reviewer && sessionExecutorHas(original)
    const epStep = epoch
    let others: string[] = []
    const origN = normModelId(original)
    const filterLadder = async (): Promise<void> => {
    planLadder = bind.ladder
    rungsFiltered = 0
    rungsFilteredReviewer = 0
    ladderFullTaken = false
    if (reviewer) {
      const bindLadder: string[] = bind.ladder ?? []
      const keep: string[] = []
      for (let i = 0; i < bindLadder.length; i++) {
        if (!sessionExecutorHas(bindLadder[i])) keep.push(bindLadder[i])
      }
      rungsFiltered = bindLadder.length - keep.length
      // CONSTRAINT (#509-FIX7 Р13): из ступеней проверяющего вычитаются модели,
      // обслуживающие ДРУГИХ проверяющих сессии не дольше REVIEWER_LIVE_MS;
      // объявленная модель самого агента этим фильтром не снимается.
      others = sessionReviewersServedByOthers(String(aid), await nowMs($))
      const keepR: string[] = []
      for (let i = 0; i < keep.length; i++) {
        const k = normModelId(keep[i])
        if (k === origN || others.indexOf(k) < 0) keepR.push(keep[i])
      }
      rungsFilteredReviewer = keep.length - keepR.length
      if (keepR.length) {
        planLadder = keepR
      } else if (bindLadder.length) {
        // Остановленный проверяющий хуже проверки той же моделью, но молчаливое
        // совпадение хуже обоих.
        // CONSTRAINT (#509-FIX7 Р13): занятость другими проверяющими снимает
        // только свой фильтр -- фильтр моделей исполнителя (#226) остаётся.
        planLadder = keep.length ? keep : bind.ladder
        ladderFullTaken = true
      }
    }
    }
    await filterLadder()
    // CONSTRAINT: bind.sticky не переписывается, bind.ladder -- только свежим
    // миром ожидающего (failoverBindRefresh, #514 Р8): в привязке лежит
    // объявленная реестром истина и факт «эта ступень отработала»; очистка от
    // моделей исполнителей -- решение шага. Порядок ступеней
    // строит failoverAttemptModels -- ТА ЖЕ функция, которую пинят зубы;
    // второй копии порядка в бою не держать. Снятие липкости -- на ИСПОЛЬЗОВАНИИ:
    // накопитель растёт позже установки, проверка в прошлом снова преждевременна.
    let planSticky = bind.sticky
    let stickyDropped = false
    let stickyDroppedReviewer = false
    if (reviewer && planSticky && sessionExecutorHas(String(planSticky))) {
      planSticky = null
      stickyDropped = true
    }
    // CONSTRAINT (#509-FIX8 Р3): липкая модель, обслуживающая другого
    // проверяющего сессии, снимается тем же фильтром, что ступени (Р13), и при
    // ladderFullTaken; объявленная модель самого агента не снимается.
    if (reviewer && planSticky && normModelId(String(planSticky)) !== origN && others.indexOf(normModelId(String(planSticky))) >= 0) {
      planSticky = null
      stickyDroppedReviewer = true
    }
    // CONSTRAINT (#313): остывающие модели ОТКЛАДЫВАЮТСЯ в хвост плана, но не
    // удаляются — удаление возвращало бы отказ при живой собственной модели
    // (дефект отклонённой #311). Исключение -- живая метка permanent-model
    // (#514 H3): такая модель пропускается, терминал -- никогда.
    // CONSTRAINT (#509-FIX1 D): терминал модели исполнителя снимается у
    // проверяющего при ЛЮБОЙ базе, включая пустую, -- тем же фильтром, что ступени.
    let planTerminal = ""
    let terminalFiltered = false
    const filterTerminal = (): void => {
      const termModel = String(bind.terminal || "")
      planTerminal = termModel
      terminalFiltered = false
      if (termModel && reviewer && sessionExecutorHas(termModel)) {
        planTerminal = ""
        terminalFiltered = true
      }
    }
    filterTerminal()
    const firstPlan = failoverStepPlan(original, planSticky, planLadder, planTerminal, await nowMs($))
    // CONSTRAINT (#509-FIX11 B2): прямой проход -- только для ДЕЙСТВИТЕЛЬНО
    // пустого плана; план, опустевший от снятых живых меток, уходит в штатное
    // ожидание (wake по сроку, пробы живости), а не в прямой вызов мимо метки.
    if (!firstPlan.plan.length && !firstPlan.dead.length && firstPlan.skippedKnown.length === 0) return yield* driveNext(next(e), undefined, String(aid))
    // CONSTRAINT (#509-FIX3 M5, #509-FIX4 F4, #509-FIX5 Р3): сторож сбрасывает
    // только поток агента, в том числе запись отказа next; сердцебиение, кусок
    // и предел двери паузы -- из waitPaceOf по переменной сторожа, прочитанной
    // один раз на шаг ДО первого прохода: пауза перечитывания первого прохода
    // уже идёт куском и пределом T от S.
    let stallRaw: any = undefined
    try { stallRaw = await $.env.get("CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS") } catch (x) { stallRaw = undefined; noteLost("failover-stall-env", x, $) }
    const pace = waitPaceOf(stallRaw)
    const HEARTBEAT_MS = pace.heartbeat
    const CHUNK_MS = pace.chunk
    const CHUNK_ARG = (CHUNK_MS / 1000).toFixed(3)
    const CHUNK_REAL_MS = Math.floor(CHUNK_MS * 3 / 4)
    const PAUSE_TIMEOUT_MS = pace.pauseTimeout
    const STALL_EFF_MS = pace.stallEff
    const MARGIN_MS = pace.margin
    const HALF_MARGIN_MS = Math.floor(MARGIN_MS / 2)
    // Отметки шага #226 уезжают в КАЖДУЮ запись попытки: улика попытки
    // самодостаточна и без соседних строк шага.
    const journalBase: any = { declared: original }
    if (reviewer) {
      journalBase.rungsFiltered = rungsFiltered
      journalBase.rungsFilteredReviewer = rungsFilteredReviewer
      if (ladderFullTaken) journalBase.ladderFullTaken = true
      if (startMatch) journalBase.startMatch = true
      if (stickyDropped) journalBase.stickyDropped = true
      if (stickyDroppedReviewer) journalBase.stickyDroppedReviewer = true
    }
    if (terminalFiltered) journalBase.terminalFiltered = true
    if (sessionExecutorModelsOverflow) journalBase.execOverflow = true
    if (bind.rungsDropped) journalBase.rungsDropped = bind.rungsDropped
    if (bind.source) journalBase.source = bind.source
    if (bind.allowedSrc) journalBase.allowedSrc = bind.allowedSrc
    let jpath = world && world.globalHome ? world.globalHome + "/failover/journal.jsonl" : ""
    const recHead = String(aid) + "-" + String(ev.turnId || "") + "-" + String(ev.index)
    let lastRes: any = null
    let lastClass = ""
    let lastText = ""
    let attemptN = 0
    let waitN = 0
    let passN = 0
    // CONSTRAINT (#509-FIX1 I, #509-FIX3 L1): rungsTried -- ТОЛЬКО реально
    // вызванные модели ТЕКУЩЕГО прохода; отказанные по эффорту и пропущенные
    // мёртвые -- своими списками того же прохода. Через проходы не копятся.
    let called: string[] = []
    let effortRefused: string[] = []
    let skippedDead: string[] = []
    // CONSTRAINT (#509-FIX3 M3): цель пробуждения не берёт модель, которую
    // вызвать нельзя (эффорт), и модель, ответившую дефектом запроса: такой
    // ответ не зависит от времени, и её «готовность сейчас» крутила бы
    // пробуждения через кусок паузы.
    const stepEffortRefused: string[] = []
    const stepRequest: string[] = []
    let unreadToasted = false
    const newPass = (): void => { passN++; called = []; effortRefused = []; skippedDead = [] }
    let planTermN = planTerminal ? normModelId(planTerminal) : ""
    const refreshForWait = async (): Promise<void> => {
      let w: any = null
      try { w = await worldFor($) } catch (x) { noteLost("failover-wait-world", x, $); return }
      const fw = w && w.world
      if (!fw || !fw.failover || !bl3(fw.failover.enabled, true)) return
      // CONSTRAINT (#514 Р8-FIX1): свежий мир несёт и пины эффорта клетки, и
      // дом журнала -- шаг, начатый без мира, иначе отказывал бы ступени по
      // эффорту и не писал бы эпизод ожидания.
      world = fw
      if (!jpath && fw.globalHome) jpath = fw.globalHome + "/failover/journal.jsonl"
      failoverBindRefresh(bind, fw)
      await filterLadder()
      filterTerminal()
      planTermN = planTerminal ? normModelId(planTerminal) : ""
      // CONSTRAINT (#226): липкая модель, начавшая обслуживать исполнителя посреди
      // ожидания, снимается у проверяющего так же, как на старте шага.
      if (reviewer && planSticky && sessionExecutorHas(String(planSticky))) {
        planSticky = null
        stickyDropped = true
        journalBase.stickyDropped = true
      }
      const put = (k: string, v: any): void => { if (v) journalBase[k] = v; else delete journalBase[k] }
      if (reviewer) {
        journalBase.rungsFiltered = rungsFiltered
        journalBase.rungsFilteredReviewer = rungsFilteredReviewer
        put("ladderFullTaken", ladderFullTaken)
      }
      put("terminalFiltered", terminalFiltered)
      put("rungsDropped", bind.rungsDropped)
      put("source", bind.source)
      put("allowedSrc", bind.allowedSrc)
    }
    let builtTermN = planTermN
    // CONSTRAINT (#514 Р8-FIX1): план ожидания сменяется при ЛЮБОМ расхождении
    // состава со свежим миром -- и при новой ступени, и при снятой (допуск,
    // занятость исполнителем, терминал); снятая модель не пробуется до своего
    // срока. Смена пишется в журнал: улика «откуда взялась ступень».
    const swapPlan = async (fresh: any): Promise<boolean> => {
      const added = fresh.all.filter((m: string) => built.all.indexOf(m) < 0)
      const removed = built.all.filter((m: string) => fresh.all.indexOf(m) < 0)
      const termChanged = builtTermN !== planTermN
      if (!added.length && !removed.length && !termChanged) return false
      built = fresh
      builtTermN = planTermN
      await waitRec("wait-plan-refresh", { added, removed, terminal: planTerminal })
      return true
    }
    const aborted = (): boolean => {
      try { return !!(next.signal && next.signal.aborted) } catch (x) { noteLost("failover-signal", x, $); return false }
    }
    // CONSTRAINT: next без счётчика (движок, корневой next теста) -- бюджет
    // бесконечен (d.ts NextBudget: remainingMs Infinity).
    const budgetLeft = (): number => {
      try {
        const b = next.budget
        const v = b ? Number(b.remainingMs) : Infinity
        return Number.isNaN(v) ? Infinity : v
      } catch (x) { noteLost("failover-budget", x, $); return Infinity }
    }
    const markOf = (m: string): any => rungCooldownMarks.get(normModelId(m))
    // CONSTRAINT (#509-FIX6 А1): конец последнего неудачного вызова next --
    // первым await после его окончания, до журнала, чтения истории и паузы
    // перечитывания; 0 -- неудачного вызова в шаге не было.
    let callEndAt = 0
    let waiting = false
    // CONSTRAINT (#509-FIX7 А-Р1): D = callEndAt + S_eff - G; ниже пола и до
    // первого неудачного вызова срока нет.
    const deadlineAt = (): number => (!pace.belowFloor && callEndAt > 0 ? callEndAt + STALL_EFF_MS - MARGIN_MS : Infinity)
    // CONSTRAINT (#509-FIX7 А-Р1): дверь, которую путь к next ждёт, ждётся не
    // дольше остатка до D; проигрыш -- {late: true}, дверь доживает в фоне.
    // Дверь стартует после чтения часов и в том же синхронном отрезке, что
    // взвод срока: между её стартом и взводом нет await.
    const byD = async (work: () => Promise<any>, site: string, lateWhy?: (v: any) => any): Promise<{ late: boolean; v?: any }> => {
      const d = deadlineAt()
      if (d === Infinity) return { late: false, v: await work() }
      const left = d - (await nowMs($))
      return await raceUntil($, work(), left, site, lateWhy)
    }
    // CONSTRAINT (#509-FIX7 А-Р1): сон -- min(C, D - now - G/2), предел двери
    // min(T, D - now); остаток до D не больше G/2 -- сна нет (ms <= 0). cut --
    // предел двери держит D, а не T.
    const sleepPlan = (now: number): { ms: number; arg: string; limit: number; cut: boolean; realMs: number } => {
      const left = deadlineAt() - now
      const ms = left === Infinity ? CHUNK_MS : Math.min(CHUNK_MS, left - HALF_MARGIN_MS)
      const limit = left === Infinity ? PAUSE_TIMEOUT_MS : Math.max(0, Math.min(PAUSE_TIMEOUT_MS, left))
      const full = ms === CHUNK_MS
      return { ms, arg: full ? CHUNK_ARG : (Math.max(0, ms) / 1000).toFixed(3), limit, cut: left <= PAUSE_TIMEOUT_MS, realMs: full ? CHUNK_REAL_MS : Math.floor(ms * 3 / 4) }
    }
    // CONSTRAINT (#509-FIX7 А-Р1): запись на пути к next ждётся гонкой с D
    // (raced); запись выхода из шага next не предшествует -- ждётся целиком.
    const writeRec = async (rec: any, site: string, raced: boolean = true): Promise<void> => {
      if (!jpath) return
      try {
        if (raced) await byD(() => appendJournal($, jpath, rec), site)
        else await appendJournal($, jpath, rec)
      } catch (x) { noteLost(site, x, $) }
    }
    let sidStep = ""
    try { sidStep = await sidFor($) } catch (x) { sidStep = SID_UNAVAILABLE }
    const waitRec = async (kind: string, fields: any, raced: boolean = true): Promise<void> => {
      const tW = await nowMs($)
      await writeRec(Object.assign({
        t: isoOf(tW), sid: sidStep,
        rec: recHead + "-" + kind + "-" + String(waitN++),
        outcome: kind,
        agentId: String(aid), subagentType: bind.subagentType, class: bind.class,
        turnId: ev.turnId, index: ev.index,
      }, journalBase, fields), "journal-" + kind, raced)
    }
    const toastByD = async (text: string, site: string): Promise<void> => {
      try { await byD(async () => await $.ui.toast(text), site) } catch (x) { noteLost(site, x, $) }
    }
    // CONSTRAINT (#509-FIX4 F6): начало последнего вызова next -- ставится ДО
    // вызова: сердцебиение меряет промежуток между началами вызовов.
    let lastProbeAt = 0
    // CONSTRAINT (#509-FIX4 F2): штатный ответ {deny} и любой ответ не списком --
    // чтение не состоялось (unread), а не пустая история: иначе старые строки
    // читались бы свежими, а бросок без строки -- ошибкой хука.
    // CONSTRAINT (#509-FIX8c Р2): пойманный бросок null/undefined -- why явная строка, прочие -- значение как есть: поздний исход читается по why (histLateWhy), и отказ значением null/undefined иначе терялся молча.
    const readHistory = async (): Promise<{ rows: any[] | null; why: any }> => {
      let got: any = null
      try {
        got = await $.session.messages({ agentId: String(aid) })
        if (Array.isArray(got)) {
          const rows: any[] = []
          const idsOf = (xs: any): any[] => historyIds(xs).map(id => ({ tool_use_id: id }))
          for (let i = 0; i < got.length; i++) {
            const r = got[i]
            rows.push({ role: String(r && r.role), text: String(r == null || r.text == null ? "" : r.text), toolUses: idsOf(r && r.toolUses), toolResults: idsOf(r && r.toolResults) })
          }
          return { rows, why: null }
        }
        if (got && typeof got === "object" && got.deny !== undefined) return { rows: null, why: "session.messages deny: " + String(got.deny) }
      } catch (x) { return { rows: null, why: x === null || x === undefined ? "(отказ без значения: " + String(x) + ")" : x } }
      return { rows: null, why: "session.messages: ответ не список и не {deny}" }
    }
    const histLateWhy = (v: any): any => v && v.why

    const attemptOne = async function* (model: string, terminalAttempt: boolean, extra: any, heartbeat: boolean = false, ahead: { plan: string[]; at: number; termAt: number } | null = null): AsyncGenerator<any, { final: boolean; res: any; paused?: boolean; taken?: boolean }, any> {
      const attempt = attemptN++
      const t0 = await nowMs($)
      const declared = modelKeyed(bind.rungEffort, model)
      const bad = modelKeyed(bind.effortBad, model)
      // CONSTRAINT: эффорт применяется ТОЛЬКО на реальном переходе
      // (model !== original). На попытке, идущей моделью хоста, авторитет у
      // frontmatter агента -- пин ТОЙ ЖЕ клетки и он конкретнее реестра;
      // hookEffortValue перебил бы его (первый приоритет в DE).
      let req: any = null
      let refuseReason = ""
      if (model === original) {
        req = e
      } else if (declared) {
        // CONSTRAINT: поле effort выставляется только когда объявлено и
        // годно. undefined/пустая строка включили бы канал hookEffortValue
        // на пустом значении. Улика называет эффорт ЗАПРОШЕННЫМ
        // (rungEffortRequested), не применённым: x(E, model) тихо клампит
        // max→high / xhigh→high у моделей без соответствующего флага, без
        // отказа, и кламп с этой поверхности ненаблюдаем.
        req = Object.assign({}, ev, { model, effort: declared })
      } else if (isAnthropicModelId(model)) {
        // CONSTRAINT (#509-FIX1 B1/B2): Anthropic-носитель освобождён от пина:
        // без объявленного эффорта запрос уходит с УДАЛЁННЫМ полем effort --
        // пин модели старта не наследуется (#266), хост применяет нативный.
        // Негодный объявленный эффорт -- отказ с той же причиной, что у
        // прибора, а не тихая езда без эффорта.
        if (bad) {
          refuseReason = "эффорт негоден: " + String(bad)
        } else {
          req = Object.assign({}, ev, { model })
          delete req.effort
        }
      } else {
        // CONSTRAINT (#266): «ступень без эффорта» невозможна -- поле effort
        // отсутствующим не бывает, движок восполняет его пином frontmatter
        // МОДЕЛИ СТАРТА, и перенос полей события исполнял бы ступень на
        // ЧУЖОМ пине. Пин берётся СВОЙ -- поле effort клетки в таблице
        // маршрутизации; нет пина (или он негоден) -- ступень ОТКАЗЫВАЕТ
        // громко, с именем ступени и клетки, а не едет на чужом. Какой эффорт
        // у какой паре «клетка x модель» -- решение юзера (#266), мод его не
        // выдумывает.
        const pin = world && world.effortByClass ? world.effortByClass[bind.class] : undefined
        if (effortOk(pin)) {
          req = Object.assign({}, ev, { model, effort: pin })
        } else {
          refuseReason = pin === undefined || pin === null || pin === ""
            ? "пин эффорта клетки не объявлен"
            : "пин эффорта клетки не годен: " + String(pin)
        }
      }
      if (refuseReason) {
        effortRefused.push(model)
        if (stepEffortRefused.indexOf(model) < 0) stepEffortRefused.push(model)
        const recR: any = {
          t: isoOf(await nowMs($)),
          sid: sidStep,
          rec: recHead + "-" + String(attempt) + "-rung-effort-refused",
          agentId: String(aid),
          subagentType: bind.subagentType,
          class: bind.class,
          turnId: ev.turnId,
          index: ev.index,
          attempt,
          pass: passN,
          modelRequested: model,
          outcome: "rung-effort-refused",
          reason: refuseReason,
          source: bind.source,
          allowedSrc: bind.allowedSrc,
        }
        if (terminalAttempt) {
          recR.terminal = true
          recR.terminalReason = "cell-exhausted"
          recR.rungsTried = called.slice()
          recR.rungsEffortRefused = effortRefused.slice(0, -1)
          recR.rungsSkippedDead = skippedDead.slice()
        }
        // CONSTRAINT: негодный эффорт ступени обязан быть НАЗВАН и в
        // отказе (parseRungItem обещает улику effortBad_<модель>): без
        // поля читатель отличил бы отказ по опечатке от отказа по
        // отсутствию пина.
        if (bad) recR["effortBad_" + model] = bad
        await writeRec(recR, "journal-rung-effort-refused")
        return { final: false, res: null }
      }
      // CONSTRAINT (#509-FIX8 Р4): проверка занятости и резерв модели
      // проверяющего -- одним синхронным отрезком от t0, без await между ними:
      // два проверяющих не выбирают одну свободную модель параллельно. Пропуск
      // -- только не объявленной и не терминальной попытки и только пока в
      // плане впереди есть модель, не занятая другими (терминал свободен);
      // проход без свободных пробует занятую.
      let reserved: ReviewerServedRec | null = null
      let reservedEvicted: Array<[string, ReviewerServedRec]> = []
      if (reviewer) {
        const takenBy = sessionReviewersServedByOthers(String(aid), t0)
        const busy = (m: string): boolean => takenBy.indexOf(normModelId(m)) >= 0
        let freeAhead = false
        if (ahead) {
          for (let j = ahead.at + 1; j < ahead.plan.length && !freeAhead; j++) {
            if (j === ahead.termAt || !busy(ahead.plan[j])) freeAhead = true
          }
        }
        if (model !== original && !terminalAttempt && busy(model) && freeAhead) {
          await writeRec({
            t: isoOf(t0),
            sid: sidStep,
            rec: recHead + "-" + String(attempt) + "-reviewer-taken",
            agentId: String(aid),
            subagentType: bind.subagentType,
            class: bind.class,
            turnId: ev.turnId,
            index: ev.index,
            attempt,
            pass: passN,
            modelRequested: model,
            outcome: "reviewer-taken",
            source: bind.source,
            allowedSrc: bind.allowedSrc,
          }, "journal-reviewer-taken")
          return { final: false, res: null, taken: true }
        }
        reservedEvicted = sessionReviewerServedSet(String(aid), model, t0, { reserve: true })
        reserved = sessionReviewerServedGet(String(aid)) || null
      }
      // CONSTRAINT: кусок, уже ушедший наружу, находится у сессии -- отмены
      // нет. Ступень, выдавшая хотя бы один кусок С СОДЕРЖИМЫМ, СОСТОЯЛАСЬ:
      // переход с неё запрещён и при отказе носителя, и при броске, иначе к
      // ответу одной модели приклеится хвост другой.
      // Уточнение 18.09 (#239): «кусок» здесь -- кусок, дошедший до сессии, а
      // не любой элемент потока. Служебная оболочка потока сессии не достаётся,
      // склеивать нечего, и запрет на ней был ложным -- см. chunkCarriesContent.
      const emitted = { n: 0, content: 0, kinds: [] as string[] }
      let reserveSettled = false
      // CONSTRAINT (#509-FIX8c Р3): .return() на генераторе, чей .next() ждёт зависший поток, до finally не доходит; резерв снимает отмена next.signal (одноразовая подписка, снимается в finally) тем же правилом, что finally. Сигнала без addEventListener нет или он уже отменён -- немедленная проверка aborted().
      let reserveUnsub: (() => void) | null = null
      if (reserved) {
        const rsv = reserved
        const onAbort = (): void => {
          if (!reserveSettled && emitted.content === 0) { sessionReviewerServedRestore(String(aid), rsv, reservedEvicted); reserveSettled = true }
        }
        let sig: any = null
        try { sig = next.signal } catch (x) { noteLost("failover-signal", x, $) }
        if (sig && !aborted() && typeof sig.addEventListener === "function") {
          try {
            sig.addEventListener("abort", onAbort, { once: true })
            reserveUnsub = () => sig.removeEventListener("abort", onAbort)
          } catch (x) { noteLost("failover-reserve-abort", x, $) }
        } else if (aborted()) onAbort()
      }
      try {
        const triedBefore = called.slice()
        called.push(model)
        // CONSTRAINT (#509-FIX3 M1, #509-FIX4 F1): строку отказа решают только
        // записи, добавленные ПОСЛЕ начала попытки; снимок «до» -- сами записи
        // (роль и текст), не их число: у окна 4096 число не растёт.
        // CONSTRAINT (#509-FIX7 А-Р1): снимок ждётся не дольше D; проигрыш --
        // вызов без свежего снимка (снимок нечитаем) и строка history-past-deadline.
        let snap0: { rows: any[] | null; why: any } = { rows: null, why: null }
        const s0 = await byD(readHistory, "failover-history-late", histLateWhy)
        if (s0.late) {
          snap0 = { rows: null, why: "deadline: снимок истории не успел к D" }
          void waitRec("history-past-deadline", { forAttempt: attempt, modelRequested: model }, false).catch(x => noteLost("failover-history-late-rec", x, $))
        } else snap0 = s0.v
        // CONSTRAINT (#509-FIX7 А-Р2/А-Р8): перебег срока меряется непосредственно
        // перед next, после всех ждущихся дверей; ниже пола записи нет. Запись
        // не ждётся -- вызов она не задерживает.
        const tCall = await nowMs($)
        if (!pace.belowFloor && waiting && callEndAt && tCall - callEndAt >= STALL_EFF_MS) {
          void waitRec("stall-margin-exceeded", { gapMs: tCall - callEndAt, stallMs: STALL_EFF_MS, marginMs: MARGIN_MS }, false).catch(x => noteLost("failover-stall-margin", x, $))
        }
        lastProbeAt = t0
        let res: any = null
        let threw: any = null
        // CONSTRAINT: факт броска несёт ОТДЕЛЬНЫЙ флаг, а не истинность значения.
        // `throw 0` / `throw ""` / `throw null` -- законные броски, и по значению
        // они неотличимы от «не бросали»: ступень объявила бы отказ успехом,
        // залипла на ней и вернула null вызывающему.
        let didThrow = false
        try {
          res = yield* driveNext(next(req), emitted, String(aid))
        } catch (x) { threw = x; didThrow = true }
        // CONSTRAINT (#489-B1-FIX5 Z13.4): refusal -- ЕДИНСТВЕННОЕ чтение полей
        // ответа на попытку; outcome, sticky и метка остывания берут его.
        const seenRes: { served: string | null } = { served: null }
        const refusal = isCarrierRefusal(res, seenRes)
        const served = seenRes.served
        const t1 = await nowMs($)
        // CONSTRAINT: решает СОДЕРЖИМОЕ, не счёт кусков -- см. countEmitted.
        // Поле emitted в улике остаётся СЫРЫМ счётом: по нему сравниваются все
        // прежние записи, и именно оно показало дефект (11 служебных кусков).
        const afterEmit = emitted.content > 0
        const outcome = didThrow
          ? (afterEmit ? "threw_after_emit" : "threw")
          : (refusal ? (afterEmit ? "empty_after_emit" : "empty") : "ok")
        const failed = (didThrow || refusal) && !afterEmit
        if (failed) callEndAt = t1
        if (failed && reserved) { sessionReviewerServedRestore(String(aid), reserved, reservedEvicted); reserveSettled = true }
        let stopNow = failed && aborted()
        let cls = ""
        let clsText = ""
        let readyAt = 0
        let unread = false
        let unreadErr: any = null
        let reread = false
        let rereadStep = false
        let rereadAborted = false
        let pausedOk = false
        if (failed && !stopNow) {
          // CONSTRAINT (#514 H1, З2, З7, #509-FIX3 M1/AR-5): класс отказа различает
          // ТОЛЬКО свежий текст сессии агента; поля ответа у лимита Claude и у
          // любого отказа одни и те же (usage null, stopReason null). Отказ
          // чтения -- temporary-unknown.
          // CONSTRAINT (#509-FIX4 AR-c, #509-FIX5 Р3/Р11, #509-FIX8c Р1): порядок у
          // броска -- свежая строка с известным началом; иначе текст самой ошибки
          // тем же выбором, что свежие сообщения (refusalLineOfMessages: текст целиком
          // JSON -- класс тела, иначе строка с известным началом); иначе одна пауза куском ожидания и одно повторное
          // чтение против того же снимка «до» (когда запись отказа хоста
          // становится видна относительно броска, не доказано); иначе
          // нечитаемое -- temporary-unknown, прочитанное без свежей строки --
          // hook-error. При нечитаемом снимке «до» шаг 3 -- только пауза;
          // перечитывать не против чего, итог unread.
          let line = ""
          let fresh = false
          let known = false
          // CONSTRAINT (#509-FIX5 Р10): улика нечитаемого -- одна на попытку.
          let lostSaid = false
          const look = async (): Promise<void> => {
            let s1 = snap0
            if (snap0.rows) {
              const g = await byD(readHistory, "failover-history-late", histLateWhy)
              s1 = g.late ? { rows: null, why: "deadline: чтение истории не успело к D" } : g.v
            }
            const fr = snap0.rows && s1.rows ? freshHistory(snap0.rows, s1.rows) : { rows: null, why: s1.why }
            if (!fr.rows) {
              unread = true
              unreadErr = fr.why
              fresh = false
              known = false
              line = ""
              if (!lostSaid) { lostSaid = true; noteLost("failover-refusal-messages", unreadErr, $) }
              return
            }
            unread = false
            unreadErr = null
            const texts: string[] = []
            for (let i = 0; i < fr.rows.length; i++) if (fr.rows[i].role === "assistant") texts.push(fr.rows[i].text)
            fresh = texts.length > 0
            const pick = refusalLineOfMessages(texts, model)
            line = pick.line
              known = pick.known
          }
          await look()
          if (didThrow && !known) {
            const errPick = refusalLineOfMessages([safeText(threw)], model)
            if (errPick.known) { line = errPick.line; known = true; unread = false }
          }
          if (didThrow && !known) {
            rereadStep = true
            // CONSTRAINT (#509-FIX5 Р3, #509-FIX7 А-Р1): пауза -- один сон
            // ожидания по правилу срока D (sleepPlan: длительность и предел) и
            // засчитывается его правилом: код 0 и не меньше трёх четвертей его
            // длительности по часам мода. Несостоявшаяся пауза барьера появления
            // строки отказа не выдержала -- unread, повторного чтения нет; нет
            // места для сна или сон оборван пределом D -- reread-pause-deadline.
            const tPause = await nowMs($)
            const sp = sleepPlan(tPause)
            let pauseCode: any = undefined
            let pauseThrew = false
            let pauseByD = sp.ms <= 0
            let pauseElapsed = 0
            if (!pauseByD) {
              try {
                const pr = await $.process.run(["/bin/sleep", sp.arg], { timeoutMs: sp.limit })
                pauseCode = pr && typeof pr === "object" ? pr.exitCode : undefined
              } catch (x) { pauseThrew = true; noteLost("failover-reread-pause", x, $) }
              pauseElapsed = (await nowMs($)) - tPause
              if (sp.cut && pauseElapsed >= sp.limit && (pauseThrew || pauseCode !== 0 || !(pauseElapsed >= sp.realMs))) pauseByD = true
            }
            if (aborted()) { stopNow = true; rereadAborted = true; unread = false }
            else if (pauseByD) {
              if (snap0.rows) { unread = true; unreadErr = "reread-pause-deadline" }
            } else if (pauseThrew || pauseCode !== 0 || !(pauseElapsed >= sp.realMs)) {
              // CONSTRAINT (#509-FIX5b (б)): reread-pause-failed -- причина только
              // при читаемом снимке «до»; при нечитаемом причина -- ошибка его
              // чтения, а несостоявшаяся пауза уходит в noteLost.
              if (snap0.rows) { unread = true; unreadErr = "reread-pause-failed" }
              else if (!pauseThrew) noteLost("failover-reread-pause", "кусок паузы: код " + String(pauseCode) + ", прошло " + String(pauseElapsed) + " мс", $)
            } else {
              // CONSTRAINT (#509-FIX5b (а)): reread -- повторное чтение состоялось;
              // при нечитаемом снимке «до» читать не против чего.
              pausedOk = true
              if (snap0.rows) reread = true
              await look()
            }
          }
          if (!stopNow) {
            if (unread) {
              cls = "temporary-unknown"
            } else if (didThrow && !fresh && !known) {
              cls = "hook-error"
            } else {
              const c = classifyRefusal(line, t1, model)
              if (c.err) noteLost("failover-refusal-time", c.err, $)
              cls = c.class
              readyAt = c.readyAt
              clsText = line.slice(0, REFUSAL_TEXT_MAX)
            }
            lastClass = cls
            lastText = clsText
            if (cls === "request" && stepRequest.indexOf(model) < 0) stepRequest.push(model)
          }
        }
        // CONSTRAINT: предсказание смены липкости -- тот же предикат, что установка
        // ниже (failoverWouldSetSticky). Улика пишется ДО bind.sticky = model;
        // расхождение двух вызовов посчитает скучность по устаревшему правилу и
        // пропустит разрез окна.
        const willSetSticky = failoverWouldSetSticky(didThrow, refusal, reviewer, model, terminalAttempt)
        const stickyChanged = !!(willSetSticky && bind.sticky !== model)
        try {
          if (jpath) {
            const rec: any = {
              t: isoOf(t1),
              sid: sidStep,
              rec: recHead + "-" + String(attempt),
              agentId: String(aid),
              subagentType: bind.subagentType,
              class: bind.class,
              turnId: ev.turnId,
              index: ev.index,
              attempt,
              pass: passN,
              modelRequested: model,
              outcome,
              emitted: emitted.n,
              emittedContent: emitted.content,
              emittedKinds: emitted.kinds,
              dtMs: t1 - t0,
              laddered: model !== original,
              modelServed: served,
              ...extra,
            }
            if (terminalAttempt) {
              rec.terminal = true
              rec.reason = "cell-exhausted"
              rec.rungsTried = triedBefore
              rec.rungsEffortRefused = effortRefused.slice()
              rec.rungsSkippedDead = skippedDead.slice()
            }
            if (cls) {
              rec.refusalClass = cls
              rec.refusalText = clsText
              if (readyAt) rec.readyAt = isoOf(readyAt)
            }
            if (stopNow) rec.aborted = true
            if (rereadStep) rec.reread = reread
            if (declared && model !== original) rec.rungEffortRequested = declared
            if (bad) rec["effortBad_" + model] = bad
            armFailoverFoldTimer($, world, t1)
            const boring = failoverAttemptIsBoring(rec, stickyChanged)
            await byD(async () => {
              if (boring) {
                await failoverFoldObserve($, world, t1, String(bind.sticky || model || ""), sidStep, String(aid))
              } else {
                await failoverFoldFlush($, world)
                await appendJournal($, jpath, rec)
              }
            }, "failover-fold-journal")
          }
        } catch (x) { noteLost("failover-fold-journal", x, $) }
        if (rereadAborted) await waitRec("wait-aborted", { reason: "прерван во время паузы повторного чтения" }, false)
        if (unread) {
          const why = safeText(unreadErr).slice(0, 200)
          await writeRec({
            t: isoOf(t1), sid: sidStep,
            rec: recHead + "-" + String(attempt) + "-refusal-unread",
            outcome: "refusal-unread",
            agentId: String(aid), subagentType: bind.subagentType, class: bind.class,
            turnId: ev.turnId, index: ev.index,
            forAttempt: attempt, pass: passN, modelRequested: model,
            reason: why,
          }, "journal-refusal-unread")
          if (!unreadToasted) {
            unreadToasted = true
            await toastByD("агент " + String(bind.subagentType || aid) + ": текст отказа не прочитан (" + why + ")", "failover-unread-toast")
          }
        }
        // CONSTRAINT (#509-FIX3 L2, #509-FIX10 F2, #509-FIX11 B3): отказ ПРОБЫ
        // (heartbeat/deadline -- attemptOne(..., true)) при живой метке той же
        // модели срок не продлевает ни при равном классе, ни при смене внутри
        // пары temporary-known/quota (одна группа запрета, в обе стороны):
        // иначе проба каждые 240 с продлевала бы метку бессрочно, и полный
        // проход после её срока не наступал бы. Внутри пары более ранний
        // достоверный recovery (строго раньше mk.until) срок СОКРАЩАЕТ --
        // отбрасывать его -- держать агента дольше необходимого; равный или
        // поздний срок метку не двигает. Класс вне пары и истёкшая метка --
        // прежняя логика записи.
        const markRefusal = (reason: string): void => {
          if (!cls) return
          const mk = heartbeat ? markOf(model) : null
          const pair = (c: string): boolean => c === "temporary-known" || c === "quota"
          const pairLive = !!(mk && pair(mk.class) && pair(cls) && isModelCooling(model, t1))
          if (mk && (mk.class === cls || (pair(mk.class) && pair(cls))) && isModelCooling(model, t1)) {
            if (!(pairLive && typeof readyAt === "number" && readyAt > 0 && readyAt < mk.until)) return
          }
          noteModelRefusal(model, t1, cls, readyAt, reason, clsText)
        }
        if (didThrow) {
          // CONSTRAINT: выдавшая ступень бросает ту же дисциплину независимо от
          // номера: её куски уже у сессии. Бросок ДО выдачи со свежей строкой --
          // отказ по общему пути (#514 H8): исчерпанный проход не бросает.
          // hook-error (AR-5) пробрасывается видимо, без метки и ожидания.
          if (afterEmit || cls === "hook-error") throw threw
          markRefusal(RUNG_COOLDOWN_REASON_THROW)
          return { final: stopNow, res: lastRes, paused: pausedOk }
        }
        // CONSTRAINT (#226): липкость не ставится на совпадение проверяющего с
        // моделью исполнителя. У удачной ступени исполнителя модель запоминается
        // как факт сессии.
        if (!refusal) {
          // CONSTRAINT (#509-FIX8h Р2): поколение реестров сменилось с резерва (без резерва -- с начала шага) -- обе записи успеха пропускаются: старая сессия в новую не пишет.
          const stepGenOk = (reserved ? reserved.gen : genStep) === sessionReviewerServedGenOf()
          if (stepGenOk && executor) sessionExecutorModelAdd(model)
          if (reviewer) {
            if (reserved) reserved.prevRec = undefined
            if (stepGenOk) sessionReviewerServedSet(String(aid), model, t1)
            reserveSettled = true
          }
          if (failoverWouldSetSticky(false, refusal, reviewer, model, terminalAttempt)) bind.sticky = model
          noteModelSuccess(model)
          // CONSTRAINT (#509-FIX7 Р12, #509-FIX8 Р10): шаг, обслуженный не
          // объявленной моделью, -- подсказка главному лупу ставится не больше
          // одного раза на (агент, модель ступени) за сессию: постановка
          // at-most-once, не гарантия доставки; ключ -- модель ступени, не
          // usage.model. Подсказка идёт общей очередью главного лупа: context
          // следующего tool.call либо submit на тике, когда тексту не меньше 60 с;
          // вытеснение названо nudge_dropped, отказ постановки -- noteLost
          // failover-served-nudge. Эпоха сменилась за шаг -- подсказка не
          // ставится (очередь уже новой сессии).
          // CONSTRAINT (#509-FIX9 R5): каждый ok-шаг учитывается моделью ступени
          // для записи served-summary при завершении агента (ladderAgentsListed).
          if (epoch === epStep) ladderServedTallyAdd(String(aid), original, model, jpath, sidStep, bind.subagentType, bind.class, $)
          if (model !== original && epoch === epStep) {
            const said = String(aid) + "\0" + normModelId(model)
            if (!ladderServedSaid.has(said)) {
              ladderServedSaid.add(said)
              void nudgeEnqueue($, "", {
                text: "агент " + String(aid) + " (" + String(bind.subagentType || "") + "): шаг агента обслужила " + model + " (объявлена " + original + ")",
                probe: "failover", t: t1, jpath, sid: sidStep,
              }).catch(x => noteLost("failover-served-nudge", x, $))
            }
          }
          return { final: true, res }
        }
        lastRes = res
        // CONSTRAINT: отказ носителя ПОСЛЕ выдачи уезжает вызывающему как есть:
        // куски первой ступени уже у сессии, вторая приклеила бы к ним чужой
        // хвост. До первой выдачи отказ ведёт на следующую ступень.
        if (afterEmit) return { final: true, res }
        // CONSTRAINT (#313): метка -- ТОЛЬКО на отказ ДО первого содержимого;
        // метка процессная и переживает newSession.
        markRefusal(RUNG_COOLDOWN_REASON_CARRIER)
        return { final: stopNow, res, paused: pausedOk }
      } finally {
        // CONSTRAINT (#509-FIX8b): любой иной выход из попытки, в том числе брошенный потребителем генератор (.return() на yield* driveNext), снимает резерв правилом отказа: без содержимого у сессии ступень не состоялась.
        if (reserved && !reserveSettled && emitted.content === 0) sessionReviewerServedRestore(String(aid), reserved, reservedEvicted)
        if (reserved && !reserveSettled && emitted.content > 0) reserved.prevRec = undefined
        if (reserveUnsub) { try { reserveUnsub() } catch (x) { noteLost("failover-reserve-abort", x, $) } }
      }
    }

    // CONSTRAINT (#509-FIX4 F3, #509-FIX5 Р1): выход без ожидания -- только
    // если хотя бы одна модель дала request в этом шаге, а каждая прочая
    // различная модель полного плана шага (объявленная, липкая, ступени,
    // терминал; по normModelId) дала request, отказана по эффорту или несёт на
    // atMs живую метку permanent-model (skipped-dead на начало прохода или
    // получившая permanent в этом шаге): у permanent срока, которого можно
    // дождаться, нет, и выход она не держит. Пропущенная skipped-known-until
    // или несущая живую метку иного класса модель ждёт своего срока. Все
    // permanent и ни одного request -- ожидание permanentOnly.
    const inNorm = (list: string[], k: string): boolean => {
      for (let i = 0; i < list.length; i++) if (normModelId(list[i]) === k) return true
      return false
    }
    const stepAllRequest = (built: any, atMs: number): boolean => {
      const keys: string[] = []
      let n = 0
      for (let i = 0; i < built.all.length; i++) {
        const m = built.all[i]
        const k = normModelId(m)
        if (keys.indexOf(k) >= 0) continue
        keys.push(k)
        if (inNorm(stepEffortRefused, k)) continue
        const pm = markOf(m)
        if (pm && pm.class === "permanent-model" && isModelCooling(m, atMs)) continue
        if (!inNorm(stepRequest, k)) return false
        if (isModelCooling(m, atMs)) return false
        n++
      }
      return n > 0
    }

    const passOnce = async function* (built: any, wake: boolean): AsyncGenerator<any, { final: boolean; res: any; allRequest: boolean; paused: boolean }, any> {
      newPass()
      const tP = await nowMs($)
      for (let i = 0; i < built.dead.length; i++) {
        const m = built.dead[i]
        if (skippedDead.indexOf(m) < 0) skippedDead.push(m)
        const mk = markOf(m)
        await byD(() => journalOnce($, skippedDeadSaid, normModelId(m) + "\0" + String(mk ? mk.at : ""), jpath, {
          t: isoOf(tP), sid: sidStep,
          rec: recHead + "-skipped-dead-" + String(attemptN) + "-" + String(i),
          outcome: "skipped-dead",
          agentId: String(aid), subagentType: bind.subagentType, class: bind.class,
          turnId: ev.turnId, index: ev.index, pass: passN,
          model: m, until: mk && typeof mk.until === "number" ? isoOf(mk.until) : "",
          refusalText: mk ? String(mk.text || "") : "",
        }, "journal-skipped-dead"), "journal-skipped-dead")
      }
      // CONSTRAINT (#509-FIX3 AR-3, #514 Р9): ни один проход не зовёт модель с
      // живым известным сроком -- ответ до срока известен заранее; пропуск назван.
      for (let i = 0; i < built.skippedKnown.length; i++) {
        const m = built.skippedKnown[i]
        const mk = markOf(m)
        await writeRec({
          t: isoOf(tP), sid: sidStep,
          rec: recHead + "-skipped-known-" + String(passN) + "-" + String(i),
          outcome: "skipped-known-until",
          agentId: String(aid), subagentType: bind.subagentType, class: bind.class,
          turnId: ev.turnId, index: ev.index, pass: passN,
          model: m, until: mk && typeof mk.until === "number" ? isoOf(mk.until) : "",
          refusalText: mk ? String(mk.text || "") : "",
        }, "journal-skipped-known")
      }
      const extra = Object.assign({}, journalBase, built.evidence)
      if (built.dead.length) extra.rungsSkippedDeadStep = built.dead.slice()
      // CONSTRAINT (#509-FIX6 А1): флаг паузы -- от последней попытки с
      // вызовом; отказ по эффорту вызова не делал и флаг не трогает.
      let paused = false
      for (let i = 0; i < built.plan.length; i++) {
        const r = yield* attemptOne(built.plan[i], i === built.termAt, extra, false, { plan: built.plan, at: i, termAt: built.termAt })
        if (r.final) return { final: true, res: r.res, allRequest: false, paused: false }
        if (r.paused !== undefined) paused = r.paused
      }
      return { final: false, res: lastRes, allRequest: stepAllRequest(built, await nowMs($)), paused }
    }

    lastProbeAt = await nowMs($)
    const first = yield* passOnce(firstPlan, false)
    if (first.final) return first.res
    // CONSTRAINT (#514 H6): дефект запроса одинаков для любой модели --
    // ожидание его не лечит; переполнение контекста обрабатывает харнес.
    if (first.allRequest) return lastRes

    // --- #514 H5: ожидание вместо смерти агента -------------------------------
    // CONSTRAINT (#509-FIX4 F-2): пауза -- $.process.run(sleep): бюджет хука
    // она не тратит (измерено, AN-509-HOST.md:11), $.clock.sleep тратит. Кусок
    // не больше 4 с меньше lingerMs 5 с, поэтому прерывание юзером отпускает
    // шаг чисто. Потолка числа циклов нет (слово юзера 2); выходы -- успех,
    // прерывание, отказ двери паузы, нет цели; ветка wait-budget-exhausted --
    // страховка на хосте, чей next бюджет считает.
    if (pace.belowFloor) await waitRec("stall-below-floor", { stallMs: pace.stall, heartbeatMs: HEARTBEAT_MS })
    // CONSTRAINT (#514 H5.1): цель -- наименьший срок по моделям прохода и
    // терминалу; permanent-model не в счёт, пока есть хоть одна другая.
    // Отказанные по эффорту не в счёт вовсе: вызова не будет, и их протухшая
    // метка крутила бы проходы без паузы. Модель без метки готова сейчас.
    // CONSTRAINT (#509-FIX8d Р1): у проверяющего кандидат цели -- не модель, обслуживающая другого проверяющего (sessionReviewersServedByOthers на atMs); объявленная модель самого агента и терминал не вычитаются -- то же правило, что у плана (Р13) и у пропуска попытки (терминал свободен). Кандидатов нет -- null, выход «нет цели».
    const wakeTarget = (atMs: number, built: any): { wakeAt: number; model: string; permanentOnly: boolean } | null => {
      const takenW = reviewer ? sessionReviewersServedByOthers(String(aid), atMs) : []
      const takenOut = (m: string): boolean => {
        const k = normModelId(m)
        return k !== origN && k !== planTermN && takenW.indexOf(k) >= 0
      }
      const cands: string[] = []
      for (let i = 0; i < built.all.length; i++) {
        const m = built.all[i]
        if (stepEffortRefused.indexOf(m) < 0 && stepRequest.indexOf(m) < 0 && cands.indexOf(m) < 0 && !takenOut(m)) cands.push(m)
      }
      if (!cands.length) return null
      const untilOf = (m: string): number => {
        const mk = markOf(m)
        if (!mk) return atMs
        if (typeof mk.until === "number") return mk.until
        return mk.at + RUNG_COOLDOWN_MS
      }
      const isPerm = (m: string): boolean => { const mk = markOf(m); return !!(mk && mk.class === "permanent-model" && untilOf(m) > atMs) }
      let pool = cands.filter(m => !isPerm(m))
      const permanentOnly = !pool.length
      if (permanentOnly) pool = cands
      let best = pool[0]
      for (let i = 1; i < pool.length; i++) if (untilOf(pool[i]) < untilOf(best)) best = pool[i]
      return { wakeAt: untilOf(best), model: best, permanentOnly }
    }
    const marksView = (built: any): any => {
      const out: any = {}
      for (let i = 0; i < built.all.length; i++) {
        const mk = markOf(built.all[i])
        if (mk) out[built.all[i]] = { until: typeof mk.until === "number" ? isoOf(mk.until) : "", class: String(mk.class || mk.reason || "") }
      }
      return out
    }
    let built = firstPlan
    let begun = false
    // CONSTRAINT (#514 FIX2): пауза между двумя вызовами модели гарантируется
    // флагом, а не метками. Модель без будущей метки даёт wakeAt = now, и ветка
    // wake без флага крутила бы вызовы без паузы -- горячий цикл запросов к API;
    // потолка числа циклов нет (слово юзера), поэтому держит только кусок паузы.
    // Первый проход до цикла -- тоже вызов.
    // CONSTRAINT (#509-FIX6 А1): засчитанная пауза перечитывания последней
    // попытки -- тоже пауза после вызова.
    // CONSTRAINT (#509-FIX11 B2): первый проход без единой попытки (план опустел
    // от живых меток) -- не пауза после вымышленного next: вызова не было, wake
    // по сроку и пробы живости разрешены сразу. От непустого плана случай
    // отличается именно пустотой плана.
    let pausedSinceCall = firstPlan.plan.length === 0 || !!first.paused
    const begin = async (target: any): Promise<void> => {
      if (begun) return
      begun = true
      await waitRec("wait-begin", {
        refusalClass: lastClass, refusalText: lastText,
        wakeAt: isoOf(target.wakeAt), wakeModel: target.model,
        permanentOnly: target.permanentOnly, marks: marksView(built),
      })
      // CONSTRAINT (#514 H7): один тост на агента на эпизод ожидания.
      await toastByD("агент " + String(bind.subagentType || aid) + " ждёт сброса лимита: " + target.model + " до " + isoOf(target.wakeAt), "failover-wait-toast")
    }
    await refreshForWait()
    await swapPlan(failoverStepPlan(original, planSticky, planLadder, planTerminal, await nowMs($), rungCooldownMarks))
    waiting = true
    for (;;) {
      if (aborted()) { await waitRec("wait-aborted", {}, false); return lastRes }
      const left = budgetLeft()
      if (left < 1500) { await waitRec("wait-budget-exhausted", { reason: "бюджет хука хоста", remainingMs: left }, false); return lastRes }
      const now = await nowMs($)
      const target = wakeTarget(now, built)
      if (!target) { await waitRec("wait-no-target", { reason: "в проходе нет вызываемой модели" }, false); return lastRes }
      const mayCall = pausedSinceCall
      if (mayCall && now >= target.wakeAt) {
        await begin(target)
        await waitRec("wait-probe", { kind: "wake", model: target.model })
        lastProbeAt = now
        await refreshForWait()
        // CONSTRAINT (#514 Р9-FIX1): проход пробуждения идёт по свежему плану и
        // при том же составе -- метки dead/known сдвигают plan, не all; проба
        // сердцебиения держит план прохода: reviewer-taken ведёт по нему.
        const fresh = failoverStepPlan(original, planSticky, planLadder, planTerminal, now, rungCooldownMarks)
        await swapPlan(fresh)
        built = fresh
        builtTermN = planTermN
        const r = yield* passOnce(built, true)
        pausedSinceCall = !!r.paused
        if (r.final) return r.res
        if (r.allRequest) return lastRes
        continue
      }
      // CONSTRAINT (#509-FIX6 А1, #509-FIX7 А-Р1): проба по сроку D =
      // callEndAt + S_eff - G допустима и без паузы после вызова: до D остаётся
      // не больше G/2 -- места для сна нет. Ниже пола ветки срока нет: при
      // S <= 1000 срок D наступает не позже куска от конца вызова, и ветка
      // крутила бы вызовы без паузы (#514 FIX2).
      const heartbeatDue = mayCall && now - lastProbeAt >= HEARTBEAT_MS
      const deadlineDue = deadlineAt() - now <= HALF_MARGIN_MS
      if (heartbeatDue || deadlineDue) {
        // CONSTRAINT (#514 Р8): ступень, появившаяся в мире после спавна, идёт
        // проходом пробуждения следующего витка, а не ждёт пробы старой цели;
        // снятая -- выпадает из цели до пробы (swapPlan).
        await refreshForWait()
        if (await swapPlan(failoverStepPlan(original, planSticky, planLadder, planTerminal, now, rungCooldownMarks))) continue
        await begin(target)
        await waitRec("wait-probe", { kind: heartbeatDue ? "heartbeat" : "deadline", model: target.model })
        lastProbeAt = now
        newPass()
        // CONSTRAINT (#509-FIX5 Р5): проба терминала -- терминальная попытка
        // и при объявленной = терминал: cell-exhausted, без липкости.
        const isTerm = !!planTermN && normModelId(target.model) === planTermN
        // CONSTRAINT (#509-FIX8c Р6, #509-FIX8d Р1): проба несёт ahead позиции цели в плане шага -- та же проверка «модель занята другим проверяющим», что у прохода; reviewer-taken ведёт на следующие элементы плана тем же циклом, что проход, без повторной пробы занятой. Цели нет в плане (dead, skippedKnown) -- позиция -1: весь план впереди.
        const probeAt = built.plan.indexOf(target.model)
        const probeExtra = Object.assign({}, journalBase, built.evidence)
        const r = yield* attemptOne(target.model, isTerm, probeExtra, true, { plan: built.plan, at: probeAt, termAt: built.termAt })
        if (r.taken) {
          let pausedRest = false
          for (let j = probeAt + 1; j < built.plan.length; j++) {
            const rj = yield* attemptOne(built.plan[j], j === built.termAt, probeExtra, false, { plan: built.plan, at: j, termAt: built.termAt })
            if (rj.final) return rj.res
            if (rj.paused !== undefined) pausedRest = rj.paused
          }
          pausedSinceCall = pausedRest
          continue
        }
        pausedSinceCall = !!r.paused
        if (r.final) return r.res
        continue
      }
      // CONSTRAINT (#509-FIX7 А-Р1): сон -- sleepPlan: не дольше min(C, D -
      // now - G/2), предел двери min(T, D - now). Сон, оборванный пределом D
      // (прошло не меньше предела), -- не отказ двери: срок наступил, следующий
      // виток зовёт next веткой срока.
      const sp = sleepPlan(now)
      let ran: any = null
      let ranErr: any = null
      let ranThrew = false
      try {
        ran = await $.process.run(["/bin/sleep", sp.arg], { timeoutMs: sp.limit })
      } catch (x) { ranThrew = true; ranErr = x }
      // CONSTRAINT (#509-FIX3 L5): прерывание -- первым после куска, раньше
      // begin(), журнала и тоста.
      if (aborted()) { await waitRec("wait-aborted", {}, false); return lastRes }
      // CONSTRAINT (#509-FIX3 L4, #509-FIX4 F4): кусок засчитывается паузой
      // только при коде 0 и не меньше трёх четвертей куска по часам мода;
      // иначе названный выход, не вызов модели без паузы.
      const tChunk = await nowMs($)
      const code = !ranThrew && ran && typeof ran === "object" ? ran.exitCode : undefined
      const elapsed = tChunk - now
      const sleptOk = !ranThrew && code === 0 && elapsed >= sp.realMs
      // CONSTRAINT: страховка от бесконечного цикла без паузы при D в прошлом (мутант f6-a1-deadline); в бою первой срабатывает ветка срока.
      if (!sleptOk && sp.cut && sp.limit > 0 && elapsed >= sp.limit) {
        void waitRec("sleep-cut-deadline", { limitMs: sp.limit, elapsedMs: elapsed, exitCode: code, threw: ranThrew }, false).catch(x => noteLost("failover-sleep-cut", x, $))
        continue
      }
      if (ranThrew) {
        // CONSTRAINT: отказ двери паузы -- названный выход, не цикл без паузы.
        await waitRec("wait-unavailable", { reason: safeText(ranErr).slice(0, 200), wakeAt: isoOf(target.wakeAt), wakeModel: target.model, begun }, false)
        return lastRes
      }
      if (!sleptOk) {
        await waitRec("wait-unavailable", { reason: "кусок паузы: код " + String(code) + ", прошло " + String(elapsed) + " мс", exitCode: code, elapsedMs: elapsed, wakeAt: isoOf(target.wakeAt), wakeModel: target.model, begun }, false)
        return lastRes
      }
      // CONSTRAINT: агент, ждущий окна лимита, жив -- засчитанная пауза ставит пометку; незасчитанная выходит выше без неё.
      try { staleRecOf(String(aid)).touched = true } catch (x) { noteLost("stale-agents-track", x) }
      pausedSinceCall = true
      await begin(target)
    }
  })
    .catch(observerFailThroughStream)
}
