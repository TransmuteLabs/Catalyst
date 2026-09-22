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
}

export function register(on: any) {
  on("session.start", async ($: any, e: any, next: any) => {
    try { await $.requestText.register(RULE) }
    catch (x: any) {
      // CONSTRAINT: отказ САМОГО логгера не имеет права подменить причину —
      // `throw x` с исходной причиной выполняется в любом случае. Глушение
      // безмолвно только для строки лога: причина `x` остаётся наблюдаемой
      // вторым каналом — хост печатает свою строку о сбойном хуке (имя плагина,
      // событие, причина) в транскрипт и в `--debug-file`.
      try { $.ui.log("catalyst-swe-request: requestText unavailable: " + String(x?.message ?? x)) } catch {}
      throw x
    }
    return next(e)
  })
}
