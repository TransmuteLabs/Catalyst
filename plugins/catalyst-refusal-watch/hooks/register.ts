export const RULE_TEXT =
  "Если ответ был остановлен фильтром сервиса (в разговоре пометка об остановке ответа или результаты вызовов «Not run: … stopped by a safety classifier»): 1) первой строкой следующего ответа сообщи пользователю, что ответ был остановлен, какие действия не выполнены и какая линия работы затронута; 2) не останавливай фоновые задачи и агентов и не прекращай линию работы по своей инициативе — решение о продолжении, изменении задачи или остановке принимает пользователь."

const WINDOW_MS = 30 * 60 * 1000
const DEDUP_MS = 60 * 1000
const STORE_MAX = 100

let count = 0
let windowUntil = 0
const lastTurnAlert = new Map<string, number>()

export function __reset(): void {
  count = 0
  windowUntil = 0
  lastTurnAlert.clear()
}

// CONSTRAINT: один предикат на чанк `stop` и на `stopReason` результата —
// два литерала разошлись бы, и один из двух сигналов обрыва остался бы невидимым.
function stoppedByFilter(stopReason: unknown): boolean {
  return stopReason === "refusal"
}

export function formatAlert(info: any): string {
  if (info?.via === "step") {
    const names =
      Array.isArray(info.tools) && info.tools.length > 0 ? info.tools.join(", ") : "вызовов нет"
    let text = "⚠ Ответ оборван фильтром сервиса · " + info.model
    if (info.agentId) text += " · агент " + info.agentId
    return text + " · не выполнено: " + names
  }
  if (info?.via === "complete") {
    let text = "⚠ Ход завершён отказом фильтра без повтора"
    if (info.category != null) text += " · категория " + info.category
    if (info.agentId) text += " · агент " + info.agentId
    return text
  }
  return (
    "⚠ После обрыва фильтром остановлена фоновая задача " +
    info.taskId +
    " — проверь, что это было одобрено"
  )
}

function hhmm(now: number): string {
  const d = new Date(now)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return hh + ":" + mm
}

function recordOf(info: any, now: number): any {
  const rec: any = { t: now, via: info.via }
  if (info.model !== undefined) rec.model = info.model
  if (info.agentId !== undefined) rec.agentId = info.agentId
  if (info.turnId !== undefined) rec.turnId = info.turnId
  if (info.step !== undefined) rec.step = info.step
  if (info.tools !== undefined) rec.tools = info.tools
  if (info.category !== undefined) rec.category = info.category
  if (info.explanation !== undefined) rec.explanation = info.explanation
  if (info.taskId !== undefined) rec.taskId = info.taskId
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

async function alert($: any, info: any): Promise<void> {
  try {
    const now = Number(await $.clock.now())
    const counts = info.via === "step" || info.via === "complete"
    let bump = counts
    if (info.via === "complete" && info.turnId != null) {
      const prev = lastTurnAlert.get(String(info.turnId))
      if (typeof prev === "number" && now - prev <= DEDUP_MS) bump = false
    }
    if (bump) count += 1
    if (counts) windowUntil = now + WINDOW_MS
    if (info.via === "step" && info.turnId != null) lastTurnAlert.set(String(info.turnId), now)
    const text = formatAlert(info)
    try {
      $.ui.toast(text, { timeoutMs: 20000 })
    } catch (x) {
      reportChannelFailure($, "toast", x)
    }
    if (info.via !== "taskstop") {
      const model = info.model ? " " + info.model : ""
      try {
        $.ui.status(
          "⚠ обрывов фильтром за сессию: " + count + " · последний " + hhmm(now) + model,
        )
      } catch (x) {
        reportChannelFailure($, "status", x)
      }
    }
    try {
      const where: string[] = []
      if (info.turnId != null) where.push("turn " + info.turnId)
      if (info.step != null) where.push("step " + info.step)
      $.ui.log(where.length > 0 ? text + " [" + where.join(", ") + "]" : text)
    } catch (x) {
      reportChannelFailure($, "log", x)
    }
    try {
      const prev = await $.store.get("log")
      const entries = Array.isArray(prev) ? prev.slice() : []
      entries.push(recordOf(info, now))
      const kept = entries.length > STORE_MAX ? entries.slice(entries.length - STORE_MAX) : entries
      await $.store.set("log", kept)
    } catch (x) {
      reportChannelFailure($, "store", x)
    }
  } catch (x) {
    reportChannelFailure($, "alert", x)
  }
}

export function register(on: any): void {
  // CONSTRAINT: turn.step стримит — обычная async-функция роняет загрузку
  // всего модуля (хост требует async function*). next() бывает генератором
  // или готовым значением; неготовое к итерации возвращается как есть.
  on("turn.step", async function* ($: any, e: any, next: any) {
    const stream = next(e)
    if (stream == null || typeof stream[Symbol.asyncIterator] !== "function") return stream
    const it = stream[Symbol.asyncIterator]()
    const tools: string[] = []
    let sawStop = false
    let r: any
    // CONSTRAINT: ручная итерация (ради наблюдения чанков) не закрывает нижний
    // поток при отмене сверху, как закрыл бы `yield*` — закрываем явно.
    try {
      while (!(r = await it.next()).done) {
        const chunk = r.value
        if (chunk != null && chunk.kind === "tool" && typeof chunk.name === "string") tools.push(chunk.name)
        if (chunk != null && chunk.kind === "stop" && stoppedByFilter(chunk.stopReason)) sawStop = true
        yield chunk
      }
    } finally {
      if (!r?.done && typeof it.return === "function") await it.return(undefined)
    }
    const result = r.value
    if (stoppedByFilter(result?.stopReason) || sawStop) {
      await alert($, {
        via: "step",
        model: e.model,
        agentId: e.agentId,
        turnId: e.turnId,
        step: e.index,
        tools,
      })
    }
    return result
  })

  on("turn.complete", async ($: any, e: any, next: any) => {
    const r = await next(e)
    if (e?.reason === "refusal") {
      await alert($, {
        via: "complete",
        turnId: e.turnId,
        agentId: e.agentId,
        category: e.refusal?.category ?? null,
        explanation: (e.refusal?.explanation ?? "").slice(0, 200),
      })
    }
    return r
  })

  on("tool.call", { tool: "TaskStop" }, async ($: any, e: any, next: any) => {
    const r = await next(e)
    try {
      const now = Number(await $.clock.now())
      if (now < windowUntil) {
        await alert($, { via: "taskstop", taskId: e.task_id ?? e.shell_id ?? "?" })
      }
    } catch (x) {
      reportChannelFailure($, "clock", x)
    }
    return r
  })

  on("prompt.context", async ($: any, _e: any, next: any) => {
    const r = await next(_e)
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
  })
}
