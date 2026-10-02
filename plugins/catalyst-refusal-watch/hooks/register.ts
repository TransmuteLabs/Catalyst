import type { EngineInterface, On, PromptContextResult, TurnStepChunk, TurnStepResult } from 'claude-code'

export const RULE_TEXT =
  "Если ответ был остановлен фильтром сервиса (в разговоре пометка об остановке ответа или результаты вызовов «Not run: … stopped by a safety classifier»): 1) первой строкой следующего ответа сообщи пользователю, что ответ был остановлен, какие действия не выполнены и какая линия работы затронута; 2) не останавливай фоновые задачи и агентов и не прекращай линию работы по своей инициативе — решение о продолжении, изменении задачи или остановке принимает пользователь."

// CONSTRAINT: RULE_TEXT, REFUSAL_RULE and RULE_TEXT_SPLICE_SHA256 must agree byte-for-byte.
export const RULE_TEXT_SPLICE_SHA256 = "4db6139512a61d07f935e0c3b95b6b97f61ab98ed96b2037c40ec9bc27b8b65f"

const MOD_NAME = "catalyst-refusal-watch"
let moduleGeneration = 0

type Environment569 = {
  generation: number
  started: boolean
  passportCovered: boolean
  seatProbePending: boolean
  seatProbeSeen: boolean
  seatProbeResult: "unknown" | "seated" | "unseated" | "unconfirmed"
  diagnosed: Set<string>
}

let snapshotState569: Environment569 | null = null

// CONSTRAINT: шов стенда отдаёт копию состояния окружения, не его изменяемые latch'и.
export function __snapshot569(): (Omit<Environment569, "diagnosed"> & { diagnosed: string[] }) | null {
  return snapshotState569 == null ? null : { ...snapshotState569, diagnosed: [...snapshotState569.diagnosed] }
}

function current569(state: Environment569): boolean {
  return state.generation === moduleGeneration
}

// CONSTRAINT: чтение свойств пойманного значения не бросает: отказ чтения не меняет классификацию.
function errno569(x: unknown): string | null {
  try {
    const code = (x as { code?: unknown } | null)?.code
    if (typeof code === "string") return /^E[A-Z0-9]{1,15}$/.test(code) ? code : null
    const message = (x as { message?: unknown } | null)?.message
    const tail = strOf(message ?? x).split(": ").pop() ?? ""
    return tail.match(/\b(E[A-Z0-9]{1,15})\s*$/)?.[1] ?? null
  } catch {
    return null
  }
}

// CONSTRAINT: экранируются и точки Cf; астральная точка — обе единицы UTF-16, чтобы JSON.parse восстанавливал исходник.
function escapeUnit569(point: string): string {
  let out = ""
  for (let i = 0; i < point.length; i++) out += "\\u" + point.charCodeAt(i).toString(16).padStart(4, "0")
  return out
}

function raw569(value: unknown): string {
  const points = Array.from(strOf(value))
  const quoted = JSON.stringify(points.slice(0, 80).join(""))
  const escaped = quoted.replace(/[\x7f-\x9f\u{2028}\u{2029}\p{Cf}]/gu, escapeUnit569)
  return escaped + (points.length > 80 ? "…" : "")
}

// CONSTRAINT: only module-composed diagnostics use this marker; embedded external values are formatted with raw569 first.
class OwnMessage569 extends Error {}

function error569(x: unknown): string {
  try {
    if (x instanceof OwnMessage569) return x.message
    const message = (x as { message?: unknown } | null)?.message
    return raw569(message ?? x)
  } catch {
    // CONSTRAINT: бросок чтения чужого исключения — собственный литерал в OwnMessage569, не наружу.
    return new OwnMessage569("<unreadable exception>").message
  }
}

async function diagnose569($: EngineInterface, state: Environment569, key: string, text: string, cause?: unknown, reason = errno569(cause) ?? "error"): Promise<void> {
  if (!current569(state)) return
  const prefix = key + ":"
  if (!state.diagnosed.has(prefix + reason) && [...state.diagnosed].filter((entry) => entry.startsWith(prefix) && entry !== prefix + "other").length >= 8) reason = "other"
  const latch = key + ":" + reason
  if (state.diagnosed.has(latch)) return
  state.diagnosed.add(latch)
  try {
    await $.ui.log(text)
  } catch (x) {
    if (!current569(state)) return
    try {
      await $.ui.log("[569] " + MOD_NAME + ": канал " + key + " не сработал: " + error569(x), { to: "debug" })
    } catch {
      // CONSTRAINT: отказ обоих каналов не выходит из наблюдателя и не прерывает цепочку.
    }
  }
}

async function enabled569($: EngineInterface, state: Environment569): Promise<boolean> {
  try {
    const raw = await $.env.get("CLAUDE_REFUSAL_WATCH")
    if (!current569(state)) return false
    const value = String(raw ?? "").trim().toLowerCase()
    if (["1", "true", "yes", "on"].includes(value)) return true
    if (!["", "0", "false", "no", "off"].includes(value)) {
      await diagnose569($, state, "env", "[569] " + MOD_NAME + ": неизвестное значение CLAUDE_REFUSAL_WATCH=" + raw569(raw), undefined, "value")
    }
  } catch (x) {
    await diagnose569($, state, "env", "[569] " + MOD_NAME + ": отказ чтения CLAUDE_REFUSAL_WATCH: " + error569(x), x)
  }
  return false
}

function absent569(x: unknown): boolean {
  return errno569(x) === "ENOENT"
}

async function delivery569($: EngineInterface, state: Environment569, enabled: boolean): Promise<void> {
  if (enabled && state.seatProbeResult === "seated") {
    const uncovered = state.passportCovered ? "нет" : "RULE_TEXT (prompt.context)"
    const covered = state.passportCovered ? "RULE_TEXT" : "нет"
    await diagnose569($, state, "D4", "[569] " + MOD_NAME + ": user tier обойдён организационным sec-default; не доставлены " + uncovered + "; системный носитель подтверждён для " + covered + ".")
  }
}

async function passport569($: EngineInterface, state: Environment569): Promise<void> {
  let version = "?"
  try {
    const info = await $.session.version()
    if (!current569(state)) return
    version = info.version
    const home = await $.env.get("HOME")
    if (!current569(state)) return
    if (typeof version !== "string" || !version || version === "." || version === ".." || /[\/\x00-\x1f\x7f-\x9f]/.test(version)) throw new OwnMessage569("invalid version segment")
    if (typeof home !== "string" || !home.startsWith("/")) throw new OwnMessage569("HOME invalid")
    const root = home.replace(/\/$/, "")
    const dir = root + "/.local/share/catalyst-cc/passports/"
    let entries!: Awaited<ReturnType<EngineInterface["fs"]["list"]>>
    try {
      entries = await $.fs.list(dir)
    } catch (x) {
      if (!current569(state)) return
      if (absent569(x)) return
      throw x
    }
    if (!current569(state)) return
    const prefix = version + "-"
    const names = entries.map((entry) => entry.name).filter((name) =>
      typeof name === "string" && name.startsWith(prefix) && /^[a-z0-9_]+\.json$/.test(name.slice(prefix.length)),
    )
    if (names.length === 0) return
    if (names.length > 1) {
      await diagnose569($, state, "passport-ambiguous", "[569] passport-ambiguous " + raw569(version))
      return
    }
    const only = names[0]!
    const raw = await $.fs.read(dir + only)
    if (!current569(state)) return
    const record = JSON.parse(raw)
    const platform = only.slice(prefix.length, -5)
    if (record?.version !== version || record?.platform !== platform) throw new OwnMessage569("passport version/platform mismatch")
    if (record.step26?.applied !== true || record.step26?.rule_sha256 !== RULE_TEXT_SPLICE_SHA256) return
    let stat!: Awaited<ReturnType<EngineInterface["fs"]["stat"]>>
    try {
      stat = await $.fs.stat(root + "/.local/share/claude/versions/" + version)
    } catch (x) {
      if (!current569(state)) return
      if (!absent569(x)) throw x
      await diagnose569($, state, "passport-stale", "[569] passport-stale " + raw569(version), x)
      return
    }
    if (!current569(state)) return
    if (stat.kind !== "file" || stat.size !== record.size || !Number.isSafeInteger(record.size) || record.size < 0 || !Number.isSafeInteger(stat.size) || stat.size < 0 || !Number.isFinite(record.mtime_ms) || !Number.isFinite(stat.mtimeMs) || !(Math.abs(stat.mtimeMs - record.mtime_ms) <= 1)) {
      await diagnose569($, state, "passport-stale", "[569] passport-stale " + raw569(version))
      return
    }
    state.passportCovered = true
  } catch (x) {
    await diagnose569($, state, "passport-read", "[569] " + MOD_NAME + ": passport-read " + raw569(version) + ": " + error569(x), x)
  }
}

const WINDOW_MS = 30 * 60 * 1000
const STORE_MAX = 100
const STORE_WAIT_MS = 5000

let count = 0
let knownEnd: number | null = null
let knownMarkMax = 0
let unknownMarkMax = 0
let lastAt = Number.NaN
let lastModel = ""
const openings = new Map<number, number>()
let openSeq = 0
let epoch = 0
const refusedTurns = new Map<unknown, Set<unknown>>()
let seq = 0
let wall: () => number = () => Date.now()
let fault: (() => void) | null = null

export function __reset(): void {
  count = 0
  knownEnd = null
  knownMarkMax = 0
  unknownMarkMax = 0
  lastAt = Number.NaN
  lastModel = ""
  openings.clear()
  epoch += 1
  refusedTurns.clear()
  fault = null
}

export function __dedupSize(): number {
  let n = 0
  for (const s of refusedTurns.values()) n += s.size
  return n
}

export function __dedupAgents(): number {
  return refusedTurns.size
}

// CONSTRAINT: `Date.now` в стенде не подменяется (readonly) — шов местного времени для зубов; `null` возвращает `Date.now`.
export function __setWall(f: (() => number) | null): void {
  wall = f ?? (() => Date.now())
}

export const __observed = observed

export const __bounded = bounded

// CONSTRAINT: шов стенда — бросок сразу после постановки метки (без метки не срабатывает); `__reset` его снимает.
export function __setFault(f: (() => void) | null): void {
  fault = f
}

// CONSTRAINT: конец окна — наибольшее известное время обрыва плюс WINDOW_MS; обрыв с неизвестным временем держит конец неизвестным, пока после него не начат обрыв с известным временем (лишний тост дешевле пропущенного).
function windowEnd(): number | null {
  if (unknownMarkMax > knownMarkMax) return Number.NaN
  return knownEnd
}

// CONSTRAINT: ключ — сырые agentId и turnId (ключ Map, без приведения): два разных хода не сливаются, приведение не бросает.
function markTurn(agentId: unknown, turnId: unknown): void {
  if (turnId == null) return
  let s = refusedTurns.get(agentId)
  if (s == null) {
    s = new Set()
    refusedTurns.set(agentId, s)
  }
  s.add(turnId)
}

function takeTurn(agentId: unknown, turnId: unknown): boolean {
  const s = refusedTurns.get(agentId)
  if (s == null) return false
  const had = s.delete(turnId)
  if (s.size === 0) refusedTurns.delete(agentId)
  return had
}

// CONSTRAINT: метка открытия активна, пока местное время не ушло ВПЕРЁД от момента метки на WINDOW_MS (лишний тост дешевле пропущенного): перевод местных часов назад метку не снимает; метка с неизвестным моментом постановки по времени не снимается. Снимает метку её `alert`. Нечисловое местное время входа метки не снимает и считается внутри.
function openingActive(t: number): boolean {
  if (!Number.isFinite(t)) return openings.size > 0
  let active = false
  for (const [k, at] of openings) {
    if (!Number.isFinite(at) || t - at < WINDOW_MS) active = true
    else openings.delete(k)
  }
  return active
}

// CONSTRAINT: один предикат на чанк `stop` и на `stopReason` результата —
// два литерала разошлись бы, и один из двух сигналов обрыва остался бы невидимым.
function stoppedByFilter(stopReason: unknown): boolean {
  return stopReason === "refusal"
}

// CONSTRAINT: поле события хоста может быть любым значением: текст, ключ и журнал не бросают — не-строка приводится `String`, отказ приведения — «?».
function strOf(v: unknown): string {
  if (typeof v === "string") return v
  try {
    return String(v)
  } catch {
    return "?"
  }
}

// CONSTRAINT: поле объекта хоста читается без броска: отказ геттера — `[false, undefined]` и строка канала event с именем поля; `fieldOf` — то же значение без признака.
function fieldTry($: EngineInterface, o: unknown, name: string): [boolean, unknown] {
  if (o == null) return [true, undefined]
  try {
    return [true, (o as Record<string, unknown>)[name]]
  } catch (x) {
    let why: string
    try {
      why = error569(x)
    } catch {
      why = "?"
    }
    reportChannelFailure($, "event", new OwnMessage569(name + ": " + why))
    return [false, undefined]
  }
}

function fieldOf($: EngineInterface, o: unknown, name: string): unknown {
  return fieldTry($, o, name)[1]
}

// CONSTRAINT: каждое внешнее поле события проходит raw569 до любого вывода интерфейса (toast/log/status).
export function formatAlert(info: unknown): string {
  const via = (info as { via?: unknown } | null)?.via
  const tools = (info as { tools?: unknown } | null)?.tools
  const model = (info as { model?: unknown } | null)?.model
  const agentId = (info as { agentId?: unknown } | null)?.agentId
  const category = (info as { category?: unknown } | null)?.category
  const taskId = (info as { taskId?: unknown } | null)?.taskId
  if (via === "step") {
    const names =
      Array.isArray(tools) && tools.length > 0 ? tools.map(raw569).join(", ") : "вызовов нет"
    let text = "⚠ Ответ оборван фильтром сервиса · " + raw569(model)
    if (agentId) text += " · агент " + raw569(agentId)
    return text + " · не выполнено: " + names
  }
  if (via === "complete") {
    let text = "⚠ Ход завершён отказом фильтра без повтора"
    if (category != null) text += " · категория " + raw569(category)
    if (agentId) text += " · агент " + raw569(agentId)
    return text
  }
  return (
    "⚠ После обрыва фильтром остановлена фоновая задача " +
    raw569(taskId) +
    (agentId ? " (остановил агент " + raw569(agentId) + ")" : "") +
    " — проверь, что это было одобрено"
  )
}

function hhmm(now: number): string {
  const d = new Date(now)
  if (!Number.isFinite(d.getTime())) return "--:--"
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return hh + ":" + mm
}

function recordOf(info: unknown, now: number): Record<string, unknown> {
  const row = info as {
    via?: unknown
    model?: unknown
    agentId?: unknown
    turnId?: unknown
    step?: unknown
    tools?: unknown
    category?: unknown
    explanation?: unknown
    taskId?: unknown
  }
  const text = (v: unknown) => (v === null ? null : strOf(v))
  const rec: Record<string, unknown> = { t: Number.isFinite(now) ? now : null, via: row.via }
  if (row.model !== undefined) rec.model = text(row.model)
  if (row.agentId !== undefined) rec.agentId = text(row.agentId)
  if (row.turnId !== undefined) rec.turnId = text(row.turnId)
  if (row.step !== undefined) {
    rec.step =
      typeof row.step === "number" && Number.isFinite(row.step) ? row.step : strOf(row.step)
  }
  if (row.tools !== undefined) {
    try {
      rec.tools = Array.isArray(row.tools) ? row.tools.map((item: unknown) => strOf(item)) : strOf(row.tools)
    } catch {
      rec.tools = strOf(row.tools)
    }
  }
  if (row.category !== undefined) rec.category = text(row.category)
  if (row.explanation !== undefined) rec.explanation = text(row.explanation)
  if (row.taskId !== undefined) rec.taskId = text(row.taskId)
  return rec
}

function reportChannelFailure($: EngineInterface, name: string, x: unknown): void {
  try {
    $.ui.log(
      "catalyst-refusal-watch: канал " + name + " не сработал: " + error569(x),
      { to: "debug" },
    )
  } catch {
    // CONSTRAINT: отказ канала и отказ журнала одновременно — сообщать больше
    // некуда; исключение не должно выйти из alert и оборвать шаг, ход или вызов.
  }
}

// CONSTRAINT: местное время не бросает наружу: отказ или неконечное значение — неизвестное время (NaN); и то и другое названо в debug каналом clock.
function wallOf($: EngineInterface): number {
  try {
    const t = wall()
    if (typeof t === "number" && Number.isFinite(t)) return t
    reportChannelFailure($, "clock", new OwnMessage569("местное время не число: " + raw569(t)))
    return Number.NaN
  } catch (x) {
    reportChannelFailure($, "clock", x)
    return Number.NaN
  }
}

async function nowOf($: EngineInterface, fallback: () => number = () => wallOf($)): Promise<number> {
  try {
    const t = await $.clock.now()
    if (typeof t === "number" && Number.isFinite(t)) return t
    reportChannelFailure($, "clock", new OwnMessage569("не число: " + raw569(t)))
  } catch (x) {
    reportChannelFailure($, "clock", x)
  }
  return fallback()
}

// CONSTRAINT: неизвестное время (ни местное время, ни часы не дали числа) считается внутри окна — лишний тост дешевле пропущенного.
function insideWindow(t: number, until: number): boolean {
  return !Number.isFinite(t) || t < until
}

// CONSTRAINT: ожидание, начатое для диспатча, кончается вместе с ним (`next.signal`); без сигнала ожидание прежнее. Отказ ожидаемого и отмена дают `onAbort()`; бросок `onAbort` отклоняет результат. На `p` подписка ставится всегда и первой — его поздний отказ не остаётся необработанным, а уже отменённый сигнал решает синхронно, раньше ответа `p`.
function bounded<T>(p: Promise<T>, signal: unknown, onAbort: () => T): Promise<T> {
  if (signal == null) return p
  try {
    if (typeof (signal as { addEventListener?: unknown }).addEventListener !== "function") return p
  } catch {
    // CONSTRAINT: нечитаемый сигнал — ожидание без сигнала, как при его отсутствии; исключение не выходит из `alert`.
    return p
  }
  return new Promise<T>((resolve, reject) => {
    let done = false
    const settle = (ok: boolean, v: unknown) => {
      if (done) return
      done = true
      try {
        ;(signal as { removeEventListener: (type: string, fn: () => void) => void }).removeEventListener("abort", stop)
      } catch {
        // CONSTRAINT: отказ отписки не должен удержать уже решённое ожидание.
      }
      if (ok) resolve(v as T)
      else reject(v)
    }
    const stop = () => {
      if (done) return
      let v: T
      try {
        v = onAbort()
      } catch (x) {
        settle(false, x)
        return
      }
      settle(true, v)
    }
    p.then((v) => settle(true, v), stop)
    try {
      if ((signal as { aborted?: unknown }).aborted === true) {
        stop()
        return
      }
      ;(signal as { addEventListener: (type: string, fn: () => void, opts?: { once: boolean }) => void }).addEventListener("abort", stop, { once: true })
    } catch {
      // CONSTRAINT: подписка не удалась — ожидание остаётся прежним, не обрывается.
    }
  })
}

function recordKey(now: number): string {
  seq += 1
  return "log:" + now + ":" + seq + ":" + Math.random().toString(36).slice(2, 8)
}

async function trimLog($: EngineInterface): Promise<void> {
  try {
    const all = await $.store.keys()
    const logKeys: string[] = []
    for (const k of all) {
      if (typeof k === "string" && k.startsWith("log:")) logKeys.push(k)
    }
    const extra = logKeys.length - STORE_MAX
    for (let i = 0; i < extra; i++) await $.store.delete(logKeys[i]!)
  } catch (x) {
    reportChannelFailure($, "store", x)
  }
}

async function writeRecord($: EngineInterface, rec: unknown, now: number): Promise<void> {
  try {
    await $.store.set(recordKey(now), rec)
    await trimLog($)
  } catch (x) {
    reportChannelFailure($, "store", x)
  }
}

// CONSTRAINT: признак отмены читается без броска: `true`, `false` или `null` — сигнал нечитаем.
function abortedOf(signal: unknown): boolean | null {
  if (signal == null) return false
  try {
    return (signal as { aborted?: unknown }).aborted === true
  } catch {
    return null
  }
}

async function waitLimit($: EngineInterface, signal: unknown): Promise<boolean> {
  try {
    await $.clock.sleep(STORE_WAIT_MS, signal != null ? { signal: signal as AbortSignal } : undefined)
    return true
  } catch (x) {
    // CONSTRAINT: молчит только отказ самой отмены диспатча (её причина или `AbortError`); прочий отказ `sleep` — отказ часов и при отменённом сигнале.
    let cancelled = false
    if (abortedOf(signal) === true) {
      let reasonRead = true
      let reason: unknown
      try {
        reason = (signal as { reason?: unknown }).reason
      } catch {
        reasonRead = false
      }
      let name: unknown
      try {
        name = x != null ? (x as { name?: unknown }).name : undefined
      } catch {
        name = undefined
      }
      cancelled = (reasonRead && x === reason) || name === "AbortError"
    }
    if (!cancelled) reportChannelFailure($, "clock", x)
    return false
  }
}

async function alert($: EngineInterface, info: {
  via?: unknown
  model?: unknown
  agentId?: unknown
  turnId?: unknown
  keyRead?: unknown
  step?: unknown
  tools?: unknown
  category?: unknown
  explanation?: unknown
  taskId?: unknown
}, born: number, signal?: unknown): Promise<void> {
  const counts = info.via === "step" || info.via === "complete"
  let mark: number | null = null
  try {
    let wallMemo: number | undefined
    const wallOnce = () => (wallMemo === undefined ? (wallMemo = wallOf($)) : wallMemo)
    // CONSTRAINT: `born` — эпоха на входе хука; обрыв, чья сессия закончилась до `alert`, метку открытия новой сессии не ставит.
    if (counts && born === epoch) {
      openSeq += 1
      mark = openSeq
      openings.set(mark, wallOnce())
    }
    let same = false
    if (counts && born === epoch) {
      // CONSTRAINT: нечитаемый ключ хода запись дедупа не ставит и не снимает: такой обрыв считается отдельно (лишний счёт дешевле пропущенного).
      if (info.via === "step") {
        if (info.keyRead === true) markTurn(info.agentId, info.turnId)
      } else if (info.keyRead === true) same = takeTurn(info.agentId, info.turnId)
      // CONSTRAINT: счёт растёт в момент распознавания, до ответа часов: сведённый complete, пришедший раньше ответа часов шага, не публикует статус без этого обрыва.
      if (!same) count += 1
    }
    if (mark != null && fault != null) fault()
    // CONSTRAINT: тост и строка транскрипта от часов не зависят и уходят синхронно, до первого await: зависшие часы не задерживают уведомление.
    const text = formatAlert(info)
    try {
      $.ui.toast(text, { timeoutMs: 20000 })
    } catch (x) {
      reportChannelFailure($, "toast", x)
    }
    try {
      const where: string[] = []
      if (info.turnId != null) where.push("turn " + raw569(info.turnId))
      if (info.step != null) where.push("step " + raw569(info.step))
      $.ui.log(where.length > 0 ? text + " [" + where.join(", ") + "]" : text)
    } catch (x) {
      reportChannelFailure($, "log", x)
    }
    const now = await bounded(nowOf($, wallOnce), signal, wallOnce)
    // CONSTRAINT: учёт обрыва, чья сессия закончилась (`session.end`) после входа хука, в счётчик, окно, дедуп и статус новой сессии не входит; запись в журнал остаётся.
    if (born === epoch) {
      // CONSTRAINT: сведённый `complete` — тот же обрыв, что уже объявил шаг его хода: счёт, окно и «последний» он не трогает.
      if (counts && !same) {
        const model = info.model ? " " + raw569(info.model) : ""
        if (Number.isFinite(now)) {
          knownEnd = knownEnd === null ? now + WINDOW_MS : Math.max(knownEnd, now + WINDOW_MS)
          if (mark != null && mark > knownMarkMax) knownMarkMax = mark
          if (!Number.isFinite(lastAt) || now >= lastAt) {
            lastAt = now
            lastModel = model
          }
        } else {
          if (mark != null && mark > unknownMarkMax) unknownMarkMax = mark
          if (!Number.isFinite(lastAt)) lastModel = model
        }
      }
      if (mark != null) {
        openings.delete(mark)
        mark = null
      }
      if (info.via !== "taskstop") {
        try {
          $.ui.status(
            "⚠ обрывов фильтром за сессию: " + count + " · последний " + hhmm(lastAt) + lastModel,
          )
        } catch (x) {
          reportChannelFailure($, "status", x)
        }
      }
    }
    const rec = recordOf(info, now)
    const write = writeRecord($, rec, now)
    const outcome = await bounded(
      Promise.race([
        write.then(() => "written"),
        waitLimit($, signal).then((slept) => (slept ? "late" : "released")),
      ]),
      signal,
      () => "aborted",
    )
    if (outcome === "late") {
      reportChannelFailure(
        $,
        "store",
        new OwnMessage569("запись дольше " + STORE_WAIT_MS + " мс; продолжается в фоне"),
      )
    } else if (outcome === "aborted" || outcome === "released") {
      const a = abortedOf(signal)
      const why =
        outcome === "aborted" || a === true
          ? "отменой диспатча"
          : a === null
            ? "отменой или отказом часов (сигнал нечитаем)"
            : "отказом часов"
      reportChannelFailure(
        $,
        "store",
        new OwnMessage569("ожидание записи снято " + why + "; запись не подтверждена"),
      )
    }
  } catch (x) {
    reportChannelFailure($, "alert", x)
  } finally {
    // CONSTRAINT: метка снимается по своему ключу — повторное снятие и снятие после `session.end` (карта уже очищена) чужих меток не трогают.
    if (mark != null) openings.delete(mark)
  }
}

// CONSTRAINT: `yield*` один раз берёт `next` при входе, а `throw`/`return` ищет на каждом вызове; из результата читает `done`, затем `value`, по одному разу. Наблюдатель повторяет ровно это: иначе поток, который видит хост, расходится с голым `yield*`. После отсутствующего `throw` хост закрывает нижний итератор через `return` и результат не читает — наблюдатель отдаёт его как есть.
type ObservedIter = {
  next(v?: unknown): Promise<unknown>
  throw(x?: unknown): Promise<unknown>
  return(v?: unknown): Promise<unknown>
  [Symbol.asyncIterator](): ObservedIter
}

function observed(inner: object, watch: (chunk: unknown) => void, onDone: (value: unknown) => void): ObservedIter {
  const nextFn = (inner as { next: (...args: unknown[]) => Promise<unknown> }).next
  let closing = false
  const pass = (r: unknown): unknown => {
    if (r === null || (typeof r !== "object" && typeof r !== "function")) return r
    const done = (r as { done?: unknown }).done
    const value = (r as { value?: unknown }).value
    if (done) onDone(value)
    else watch(value)
    return { done, value }
  }
  const o = {
    [Symbol.asyncIterator]() {
      return o
    },
    next: async (v?: unknown) => pass(await Reflect.apply(nextFn, inner, [v])),
  }
  for (const name of ["throw", "return"]) {
    Object.defineProperty(o, name, {
      get() {
        if (name === "return" && closing) {
          closing = false
          const f = (inner as Record<string, unknown>)[name]
          if (f == null) return undefined
          if (typeof f !== "function") return f
          return async (...args: unknown[]) => await Reflect.apply(f, inner, args)
        }
        const f = (inner as Record<string, unknown>)[name]
        if (name === "throw" && f == null) {
          closing = true
          return undefined
        }
        if (f == null) return undefined
        if (typeof f !== "function") return f
        return async (x?: unknown) => pass(await Reflect.apply(f, inner, [x]))
      },
    })
  }
  return o as unknown as ObservedIter
}

// CONSTRAINT: успех ядра = `result` — запись вывода TaskStop со строковыми `message`, `task_id`, `task_type`, `command` — отсутствует или строка (claude-code-tools/index.d.ts:4852-4861); хост проверяет схему вывода ПОСЛЕ цепочки tool.call, поэтому подменённый ранним хуком `result` (`[]`, `{}`, неполный объект) успехом не считается; `isError` — только отсутствует или `false`.
function stoppedOk($: EngineInterface, r: unknown): boolean {
  try {
    if (r == null || typeof r !== "object") return false
    const rec = r as { deny?: unknown; isError?: unknown; result?: unknown }
    if (rec.deny != null) return false
    if (!(rec.isError === undefined || rec.isError === false)) return false
    const o = rec.result
    if (o === null || typeof o !== "object" || Array.isArray(o)) return false
    const row = o as { message?: unknown; task_id?: unknown; task_type?: unknown; command?: unknown }
    return (
      typeof row.message === "string" &&
      typeof row.task_id === "string" &&
      typeof row.task_type === "string" &&
      (row.command === undefined || typeof row.command === "string")
    )
  } catch (x) {
    reportChannelFailure($, "result", x)
    return false
  }
}

export function register(on: On): void {
  const state: Environment569 = {
    generation: ++moduleGeneration,
    started: false,
    passportCovered: false,
    seatProbePending: false,
    seatProbeSeen: false,
    seatProbeResult: "unknown",
    diagnosed: new Set(),
  }
  snapshotState569 = state

  on("settings.read", ($, e, next) => {
    if (current569(state) && state.seatProbePending && next.origin?.plugin === MOD_NAME) state.seatProbeSeen = true
    return next(e)
  })

  on("session.start", async ($, e, next) => {
    const generation = state.generation
    if (state.started || !current569(state)) return next(e)
    state.started = true
    await passport569($, state)
    if (generation !== moduleGeneration) return next(e)
    const enabled = await enabled569($, state)
    if (generation !== moduleGeneration) return next(e)
    state.seatProbePending = true
    state.seatProbeSeen = false
    try {
      await $.settings.read()
      if (generation !== moduleGeneration) return next(e)
      state.seatProbePending = false
      state.seatProbeResult = state.seatProbeSeen ? "unseated" : "seated"
      await delivery569($, state, enabled)
      if (generation !== moduleGeneration) return next(e)
    } catch (x) {
      if (generation !== moduleGeneration) return next(e)
      state.seatProbePending = false
      state.seatProbeResult = "unconfirmed"
      await diagnose569($, state, "D4", "[569] " + MOD_NAME + ": доставка не подтверждена наблюдением: " + error569(x), x)
      if (generation !== moduleGeneration) return next(e)
    }
    return next(e)
  })

  on("turn.start", async ($, e, next) => {
    if (!current569(state)) return next(e)
    try {
      const enabled = await enabled569($, state)
      if (current569(state)) await delivery569($, state, enabled)
    } catch (x) {
      if (current569(state)) reportChannelFailure($, "turn.start", x)
    }
    if (!current569(state)) return next(e)
    return next(e)
  })

  // CONSTRAINT: turn.step стримит — обычная async-функция роняет загрузку
  // всего модуля (хост требует async function*). next() бывает генератором
  // или готовым значением; неготовое к итерации возвращается как есть.
  on("turn.step", async function* ($, e, next) {
    const born = epoch
    const model = fieldOf($, e, "model")
    const [agentRead, agentId] = fieldTry($, e, "agentId")
    const [turnRead, turnId] = fieldTry($, e, "turnId")
    const keyRead = agentRead && turnRead
    const stepIndex = fieldOf($, e, "index")
    const signal = fieldOf($, next, "signal")
    const stream = next(e)
    if (stream == null || typeof stream[Symbol.asyncIterator] !== "function") return stream as unknown as void | TurnStepResult
    const it = stream[Symbol.asyncIterator]()
    const tools: string[] = []
    let finalValue: unknown
    let result: unknown
    let alerted: Promise<void> | null = null
    let returned = false
    const fire = () => {
      if (alerted != null) return
      alerted = alert(
        $,
        {
          via: "step",
          model,
          agentId,
          turnId,
          keyRead,
          step: stepIndex,
          tools: tools.slice(),
        },
        born,
        signal,
      )
    }
    try {
      result = yield* (observed(
        it,
        (chunk) => {
          if (chunk == null) return
          const kind = fieldOf($, chunk, "kind")
          if (kind === "tool") {
            const name = fieldOf($, chunk, "name")
            if (typeof name === "string") tools.push(name)
          }
          if (kind === "stop" && stoppedByFilter(fieldOf($, chunk, "stopReason"))) fire()
        },
        (value) => {
          finalValue = value
        },
      ) as unknown as AsyncGenerator<TurnStepChunk, void | TurnStepResult>)
      returned = true
    } finally {
      // CONSTRAINT: обрыв объявляется в момент распознавания чанка `stop`; `finally` ждёт уже начатое объявление и объявляет обрыв, пришедший только в результате шага, — и при исключении, и при отмене сверху; `alert` не бросает.
      if (alerted == null && stoppedByFilter(fieldOf($, finalValue, "stopReason"))) fire()
      if (alerted != null) await alerted
      // CONSTRAINT: шаг хода, вернувшийся без обрыва, закрывает прежний обрыв этого хода — следующий `complete` с отказом считается заново.
      if (alerted == null && returned && born === epoch && keyRead) takeTurn(agentId, turnId)
    }
    return result as unknown as void | TurnStepResult
  })

  on("turn.complete", async ($, e, next) => {
    const born = epoch
    const r = await next(e)
    const [reasonRead, reason] = fieldTry($, e, "reason")
    const [turnRead, turnId] = fieldTry($, e, "turnId")
    const [agentRead, agentId] = fieldTry($, e, "agentId")
    const keyRead = turnRead && agentRead
    if (reason === "refusal") {
      const refusal = fieldOf($, e, "refusal")
      const category = fieldOf($, refusal, "category")
      const explanation = fieldOf($, refusal, "explanation")
      await alert(
        $,
        {
          via: "complete",
          turnId,
          agentId,
          keyRead,
          category: category ?? null,
          explanation: strOf(explanation ?? "").slice(0, 200),
        },
        born,
        fieldOf($, next, "signal"),
      )
    // CONSTRAINT: нечитаемый reason или ключ хода (agentId, turnId) — не отказ и не конец обрыва: запись хода не снимается (строка канала event уже есть).
    } else if (born === epoch && reasonRead && keyRead) {
      takeTurn(agentId, turnId)
    }
    return r
  })

  on("tool.call", { tool: "TaskStop" }, async ($, e, next) => {
    // CONSTRAINT: эпоха, метка открытия, окно и время берутся на входе вызова; время входа — местное время процесса, синхронно: внутри окна — часы не читаются. Без окна местное время решения не даёт. Окно с неизвестным концом (время обрыва не узнано) — внутри, часы не читаются. Иначе чтение часов выдаётся до `next` и дожидается после; окно, открытое во время `next`, исход не решает. Без окна и без метки на входе часы не читаются.
    const born = epoch
    const signal = fieldOf($, next, "signal")
    const wallAtEntry = wallOf($)
    const openAtEntry = openingActive(wallAtEntry)
    const untilAtEntry = windowEnd()
    const endUnknown = untilAtEntry !== null && !Number.isFinite(untilAtEntry)
    const wallInside = untilAtEntry !== null && Number.isFinite(wallAtEntry) && wallAtEntry < untilAtEntry
    const tEntry = !openAtEntry && !endUnknown && !wallInside && untilAtEntry !== null ? nowOf($, () => wallAtEntry) : null
    const taskId = fieldOf($, e, "task_id")
    const shellId = fieldOf($, e, "shell_id")
    const agentId = fieldOf($, e, "agentId")
    const r = await next(e)
    if (stoppedOk($, r) && born === epoch) {
      const inside =
        openAtEntry ||
        endUnknown ||
        wallInside ||
        (tEntry != null && insideWindow(await bounded(tEntry, signal, () => wallAtEntry), untilAtEntry as number))
      if (inside && born === epoch) {
        await alert(
          $,
          {
            via: "taskstop",
            taskId: taskId ?? shellId ?? "?",
            agentId,
          },
          born,
          signal,
        )
      }
    }
    return r
  })

  on("prompt.context", async ($, _e, next) => {
    const r = await next(_e)
    try {
      const src = Array.isArray(r?.blocks) ? r.blocks : []
      const enabled = await enabled569($, state)
      if (!current569(state) || !enabled) return r
      const canonical = src.some((b: unknown) => {
        const text = (b as { text?: unknown } | null)?.text
        return typeof text === "string" && text.indexOf(RULE_TEXT) !== -1
      })
      const insert = enabled && !state.passportCovered && !canonical
      const own = src.filter((b: unknown) => b != null && (b as { name?: unknown }).name === "refusalHandling")
      const kept = own.find((b: unknown) => {
        const text = (b as { text?: unknown } | null)?.text
        return typeof text === "string" && text.indexOf(RULE_TEXT) !== -1
      }) ?? own[0]
      const blocks: unknown[] = []
      let placed = false
      for (const b of src) {
        if (b != null && (b as { name?: unknown }).name === "refusalHandling") {
          if (!placed) {
            const keptText = (kept as { text?: unknown } | undefined)?.text
            if (insert || (typeof keptText === "string" && keptText.indexOf(RULE_TEXT) !== -1)) blocks.push(insert ? { ...(kept as object), name: "refusalHandling", text: RULE_TEXT } : kept)
            placed = true
          }
        } else {
          blocks.push(b)
        }
      }
      if (insert && !placed) blocks.push({ name: "refusalHandling", text: RULE_TEXT })
      return { ...r, blocks } as PromptContextResult
    } catch (x) {
      reportChannelFailure($, "context", x)
      return r
    }
  })

  // CONSTRAINT: `session.start` не приходит на `/clear` (контракт); `session.end` приходит на каждый конец сессии, включая `/clear` и resume.
  on("session.end", async ($, e, next) => {
    __reset()
    return next(e)
  })
}
