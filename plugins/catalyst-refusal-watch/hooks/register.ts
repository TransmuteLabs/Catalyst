export const RULE_TEXT =
  "Если ответ был остановлен фильтром сервиса (в разговоре пометка об остановке ответа или результаты вызовов «Not run: … stopped by a safety classifier»): 1) первой строкой следующего ответа сообщи пользователю, что ответ был остановлен, какие действия не выполнены и какая линия работы затронута; 2) не останавливай фоновые задачи и агентов и не прекращай линию работы по своей инициативе — решение о продолжении, изменении задачи или остановке принимает пользователь."

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
function fieldTry($: any, o: any, name: string): [boolean, any] {
  if (o == null) return [true, undefined]
  try {
    return [true, o[name]]
  } catch (x) {
    let why: string
    try {
      why = strOf((x as any)?.message ?? x)
    } catch {
      why = "?"
    }
    reportChannelFailure($, "event", new Error(name + ": " + why))
    return [false, undefined]
  }
}

function fieldOf($: any, o: any, name: string): any {
  return fieldTry($, o, name)[1]
}

export function formatAlert(info: any): string {
  if (info?.via === "step") {
    const names =
      Array.isArray(info.tools) && info.tools.length > 0 ? info.tools.map(strOf).join(", ") : "вызовов нет"
    let text = "⚠ Ответ оборван фильтром сервиса · " + strOf(info.model)
    if (info.agentId) text += " · агент " + strOf(info.agentId)
    return text + " · не выполнено: " + names
  }
  if (info?.via === "complete") {
    let text = "⚠ Ход завершён отказом фильтра без повтора"
    if (info.category != null) text += " · категория " + strOf(info.category)
    if (info.agentId) text += " · агент " + strOf(info.agentId)
    return text
  }
  return (
    "⚠ После обрыва фильтром остановлена фоновая задача " +
    strOf(info.taskId) +
    (info.agentId ? " (остановил агент " + strOf(info.agentId) + ")" : "") +
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

function recordOf(info: any, now: number): any {
  const text = (v: any) => (v === null ? null : strOf(v))
  const rec: any = { t: Number.isFinite(now) ? now : null, via: info.via }
  if (info.model !== undefined) rec.model = text(info.model)
  if (info.agentId !== undefined) rec.agentId = text(info.agentId)
  if (info.turnId !== undefined) rec.turnId = text(info.turnId)
  if (info.step !== undefined) {
    rec.step =
      typeof info.step === "number" && Number.isFinite(info.step) ? info.step : strOf(info.step)
  }
  if (info.tools !== undefined) {
    try {
      rec.tools = Array.isArray(info.tools) ? info.tools.map(strOf) : strOf(info.tools)
    } catch {
      rec.tools = strOf(info.tools)
    }
  }
  if (info.category !== undefined) rec.category = text(info.category)
  if (info.explanation !== undefined) rec.explanation = text(info.explanation)
  if (info.taskId !== undefined) rec.taskId = text(info.taskId)
  return rec
}

function reportChannelFailure($: any, name: string, x: any): void {
  try {
    $.ui.log(
      "catalyst-refusal-watch: канал " + name + " не сработал: " + String(x?.message ?? x),
      { to: "debug" },
    )
  } catch {
    // CONSTRAINT: отказ канала и отказ журнала одновременно — сообщать больше
    // некуда; исключение не должно выйти из alert и оборвать шаг, ход или вызов.
  }
}

// CONSTRAINT: местное время не бросает наружу: отказ или неконечное значение — неизвестное время (NaN); и то и другое названо в debug каналом clock.
function wallOf($: any): number {
  try {
    const t = wall()
    if (typeof t === "number" && Number.isFinite(t)) return t
    reportChannelFailure($, "clock", new Error("местное время не число: " + strOf(t)))
    return Number.NaN
  } catch (x) {
    reportChannelFailure($, "clock", x)
    return Number.NaN
  }
}

async function nowOf($: any, fallback: () => number = () => wallOf($)): Promise<number> {
  try {
    const t = await $.clock.now()
    if (typeof t === "number" && Number.isFinite(t)) return t
    reportChannelFailure($, "clock", new Error("не число: " + String(t)))
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
function bounded<T>(p: Promise<T>, signal: any, onAbort: () => T): Promise<T> {
  if (signal == null) return p
  try {
    if (typeof signal.addEventListener !== "function") return p
  } catch {
    // CONSTRAINT: нечитаемый сигнал — ожидание без сигнала, как при его отсутствии; исключение не выходит из `alert`.
    return p
  }
  return new Promise<T>((resolve, reject) => {
    let done = false
    const settle = (ok: boolean, v: any) => {
      if (done) return
      done = true
      try {
        signal.removeEventListener("abort", stop)
      } catch {
        // CONSTRAINT: отказ отписки не должен удержать уже решённое ожидание.
      }
      if (ok) resolve(v)
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
      if (signal.aborted === true) {
        stop()
        return
      }
      signal.addEventListener("abort", stop, { once: true })
    } catch {
      // CONSTRAINT: подписка не удалась — ожидание остаётся прежним, не обрывается.
    }
  })
}

function recordKey(now: number): string {
  seq += 1
  return "log:" + now + ":" + seq + ":" + Math.random().toString(36).slice(2, 8)
}

async function trimLog($: any): Promise<void> {
  try {
    const all = await $.store.keys()
    const logKeys: string[] = []
    for (const k of all) {
      if (typeof k === "string" && k.startsWith("log:")) logKeys.push(k)
    }
    const extra = logKeys.length - STORE_MAX
    for (let i = 0; i < extra; i++) await $.store.delete(logKeys[i])
  } catch (x) {
    reportChannelFailure($, "store", x)
  }
}

async function writeRecord($: any, rec: any, now: number): Promise<void> {
  try {
    await $.store.set(recordKey(now), rec)
    await trimLog($)
  } catch (x) {
    reportChannelFailure($, "store", x)
  }
}

// CONSTRAINT: признак отмены читается без броска: `true`, `false` или `null` — сигнал нечитаем.
function abortedOf(signal: any): boolean | null {
  if (signal == null) return false
  try {
    return signal.aborted === true
  } catch {
    return null
  }
}

async function waitLimit($: any, signal: any): Promise<boolean> {
  try {
    await $.clock.sleep(STORE_WAIT_MS, signal != null ? { signal } : undefined)
    return true
  } catch (x) {
    // CONSTRAINT: молчит только отказ самой отмены диспатча (её причина или `AbortError`); прочий отказ `sleep` — отказ часов и при отменённом сигнале.
    let cancelled = false
    if (abortedOf(signal) === true) {
      let reasonRead = true
      let reason: unknown
      try {
        reason = signal.reason
      } catch {
        reasonRead = false
      }
      let name: unknown
      try {
        name = x != null ? (x as any).name : undefined
      } catch {
        name = undefined
      }
      cancelled = (reasonRead && x === reason) || name === "AbortError"
    }
    if (!cancelled) reportChannelFailure($, "clock", x)
    return false
  }
}

async function alert($: any, info: any, born: number, signal?: any): Promise<void> {
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
      if (info.turnId != null) where.push("turn " + strOf(info.turnId))
      if (info.step != null) where.push("step " + strOf(info.step))
      $.ui.log(where.length > 0 ? text + " [" + where.join(", ") + "]" : text)
    } catch (x) {
      reportChannelFailure($, "log", x)
    }
    const now = await bounded(nowOf($, wallOnce), signal, wallOnce)
    // CONSTRAINT: учёт обрыва, чья сессия закончилась (`session.end`) после входа хука, в счётчик, окно, дедуп и статус новой сессии не входит; запись в журнал остаётся.
    if (born === epoch) {
      // CONSTRAINT: сведённый `complete` — тот же обрыв, что уже объявил шаг его хода: счёт, окно и «последний» он не трогает.
      if (counts && !same) {
        const model = info.model ? " " + strOf(info.model) : ""
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
        new Error("запись дольше " + STORE_WAIT_MS + " мс; продолжается в фоне"),
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
        new Error("ожидание записи снято " + why + "; запись не подтверждена"),
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
function observed(inner: any, watch: (chunk: any) => void, onDone: (value: any) => void): any {
  const nextFn = inner.next
  let closing = false
  const pass = (r: any) => {
    if (r === null || (typeof r !== "object" && typeof r !== "function")) return r
    const done = r.done
    const value = r.value
    if (done) onDone(value)
    else watch(value)
    return { done, value }
  }
  const o: any = {
    [Symbol.asyncIterator]() {
      return o
    },
    next: async (v?: any) => pass(await Reflect.apply(nextFn, inner, [v])),
  }
  for (const name of ["throw", "return"]) {
    Object.defineProperty(o, name, {
      get() {
        if (name === "return" && closing) {
          closing = false
          const f = inner[name]
          if (f == null) return undefined
          if (typeof f !== "function") return f
          return async (...args: any[]) => await Reflect.apply(f, inner, args)
        }
        const f = inner[name]
        if (name === "throw" && f == null) {
          closing = true
          return undefined
        }
        if (f == null) return undefined
        if (typeof f !== "function") return f
        return async (x?: any) => pass(await Reflect.apply(f, inner, [x]))
      },
    })
  }
  return o
}

// CONSTRAINT: успех ядра = `result` — запись вывода TaskStop со строковыми `message`, `task_id`, `task_type`, `command` — отсутствует или строка (claude-code.d.ts:12981-12990); хост проверяет схему вывода ПОСЛЕ цепочки tool.call, поэтому подменённый ранним хуком `result` (`[]`, `{}`, неполный объект) успехом не считается; `isError` — только отсутствует или `false`.
function stoppedOk($: any, r: any): boolean {
  try {
    if (r == null || typeof r !== "object" || r.deny != null) return false
    if (!(r.isError === undefined || r.isError === false)) return false
    const o = r.result
    return (
      o !== null &&
      typeof o === "object" &&
      !Array.isArray(o) &&
      typeof o.message === "string" &&
      typeof o.task_id === "string" &&
      typeof o.task_type === "string" &&
      (o.command === undefined || typeof o.command === "string")
    )
  } catch (x) {
    reportChannelFailure($, "result", x)
    return false
  }
}

export function register(on: any): void {
  // CONSTRAINT: turn.step стримит — обычная async-функция роняет загрузку
  // всего модуля (хост требует async function*). next() бывает генератором
  // или готовым значением; неготовое к итерации возвращается как есть.
  on("turn.step", async function* ($: any, e: any, next: any) {
    const born = epoch
    const model = fieldOf($, e, "model")
    const [agentRead, agentId] = fieldTry($, e, "agentId")
    const [turnRead, turnId] = fieldTry($, e, "turnId")
    const keyRead = agentRead && turnRead
    const stepIndex = fieldOf($, e, "index")
    const signal = fieldOf($, next, "signal")
    const stream = next(e)
    if (stream == null || typeof stream[Symbol.asyncIterator] !== "function") return stream
    const it = stream[Symbol.asyncIterator]()
    const tools: string[] = []
    let finalValue: any
    let result: any
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
      result = yield* observed(
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
      )
      returned = true
    } finally {
      // CONSTRAINT: обрыв объявляется в момент распознавания чанка `stop`; `finally` ждёт уже начатое объявление и объявляет обрыв, пришедший только в результате шага, — и при исключении, и при отмене сверху; `alert` не бросает.
      if (alerted == null && stoppedByFilter(fieldOf($, finalValue, "stopReason"))) fire()
      if (alerted != null) await alerted
      // CONSTRAINT: шаг хода, вернувшийся без обрыва, закрывает прежний обрыв этого хода — следующий `complete` с отказом считается заново.
      if (alerted == null && returned && born === epoch && keyRead) takeTurn(agentId, turnId)
    }
    return result
  })

  on("turn.complete", async ($: any, e: any, next: any) => {
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

  on("tool.call", { tool: "TaskStop" }, async ($: any, e: any, next: any) => {
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

  on("prompt.context", async ($: any, _e: any, next: any) => {
    const r = await next(_e)
    try {
      const src = Array.isArray(r?.blocks) ? r.blocks : []
      const blocks: any[] = []
      let placed = false
      for (const b of src) {
        if (b != null && b.name === "refusalHandling") {
          if (!placed) {
            blocks.push({ ...b, name: "refusalHandling", text: RULE_TEXT })
            placed = true
          }
        } else {
          blocks.push(b)
        }
      }
      if (!placed) blocks.push({ name: "refusalHandling", text: RULE_TEXT })
      return { ...r, blocks }
    } catch (x) {
      reportChannelFailure($, "context", x)
      return r
    }
  })

  // CONSTRAINT: `session.start` не приходит на `/clear` (контракт); `session.end` приходит на каждый конец сессии, включая `/clear` и resume.
  on("session.end", async ($: any, e: any, next: any) => {
    __reset()
    return next(e)
  })
}
