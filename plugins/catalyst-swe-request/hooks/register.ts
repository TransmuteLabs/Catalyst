import type { On } from 'claude-code'

// CONSTRAINT: набор ключей правила закрыт (DOOR-DESIGN.md:190-191): правило —
// ровно { model, ops }, op — ровно { find | pattern, flags?, to, tool? }.
// Пустой ops рантайм отвергает; тип не пускает пустой список.
type Op =
  | { find: string; flags?: string; to: string; tool?: string }
  | { pattern: string; flags?: string; to: string; tool?: string }

type RequestTextRule = { model: string; ops: readonly [Op, ...Op[]] }

// CONSTRAINT: со стороны мода все три метода — Promise (DOOR-DESIGN.md:21-23).
type RequestTextNoun = {
  register(rule: RequestTextRule): Promise<{ id: string }>
  unregister(id: string): Promise<{ removed: boolean }>
  list(): Promise<RequestTextRule[]>
}

export const RULE = {
  model: "devin/swe-2",
  // CONSTRAINT: `$` при флаге m совпадает и ПЕРЕД CR, поэтому `\r?` в якоре
  // не нужен и лишь удаляет CR из CRLF-текста (DOOR-DESIGN.md §3.4).
  ops: [
    { pattern: "^You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK\\.$", flags: "gm", to: "You are a coding agent." },
    { pattern: "^You are Claude Code, Anthropic's official CLI for Claude\\.$", flags: "gm", to: "You are a coding agent." },
    { pattern: "^You are a Claude agent, built on Anthropic's Claude Agent SDK\\.$", flags: "gm", to: "You are a coding agent." },
    { pattern: "\\r?\\n[ \\t]*-[ \\t]*The most recent Claude models are [^\\r\\n]*(?=\\r?\\n|$)|^[ \\t]*-[ \\t]*The most recent Claude models are [^\\r\\n]*(?:\\r?\\n|$)", flags: "gm", to: "" },
    { find: "For clear communication with the user the assistant MUST avoid using emojis.", to: "For clear communication with the user, avoid using emojis." },
    { tool: "Read", find: "Reads a file from the local filesystem. You can access any file directly by using this tool.", to: "Reads a file from the local filesystem." }
  ]
} satisfies RequestTextRule

// CONSTRAINT: `$.requestText` контрактом `claude-code` не описан. Ноун
// добавляется аугментацией EngineInterface — механизм шапки контракта
// (`declare module 'claude-code'`). Отсутствие ноуна у хоста остаётся
// рантайм-отказом, его ловит catch ниже.
declare module 'claude-code' {
  interface EngineInterface {
    requestText: RequestTextNoun
  }
}

export function register(on: On) {
  on("session.start", async ($, e, next) => {
    try { await $.requestText.register(RULE) }
    catch (x: unknown) {
      // CONSTRAINT: отказ САМОГО логгера не имеет права подменить причину —
      // `throw x` с исходной причиной выполняется в любом случае. Глушение
      // безмолвно только для строки лога: причина `x` остаётся наблюдаемой
      // вторым каналом — хост печатает свою строку о сбойном хуке (имя плагина,
      // событие, причина) в транскрипт и в `--debug-file`.
      try {
        const message = (x as { message?: unknown } | null)?.message
        $.ui.log("catalyst-swe-request: requestText unavailable: " + String(message ?? x))
      } catch {}
      throw x
    }
    return next(e)
  })
}
