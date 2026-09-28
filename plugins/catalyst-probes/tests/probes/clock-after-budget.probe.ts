// #509-FIX7b AR4: замер, не зуб. Тратит ли ожидание $.clock.after внутри
// turn.step бюджет хука хоста (HookBudget.ms = 10 000).
// CONSTRAINT: имя не *.test.ts -- `claude plugin test` мода файл не собирает, в
// основной счёт он не входит. Гоняется копией под именем *.test.ts в отдельном
// каталоге-плагине (`.claude-plugin/plugin.json`, `hooks/hooks.json` с модулем
// `./register.ts`, пустой `register`), `claude plugin test <каталог>`, только на
// usbox под пределами.
// CONSTRAINT: дверь `$` в полёте дольше бюджета кит не меряет: своей реализации двери нет, хук теста снизу сам под бюджетом 10 с (#509-FIX7c, G/logs-fix7c).
import { test, expect } from "claude-code/testing"

const WAIT_MS = 12_000

async function settleStep(g: any): Promise<any> {
  if (g == null) return g
  if (typeof g.next !== "function") return typeof g.then === "function" ? await g : g
  let n = await g.next()
  while (!n.done) n = await g.next()
  return n.value
}

const PROBE_PLUGIN = {
  name: "ar4-clock-after",
  register(on: any) {
    on("turn.step", async function* ($: any, e: any, _next: any) {
      const t0 = Date.now()
      await new Promise<void>((resolve) => { $.clock.after(12_000, () => resolve()) })
      return {
        turnId: e.turnId, index: e.index, answer: "from-hook:" + String(Date.now() - t0),
        toolUses: [], stopReason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, model: e.model },
      }
    })
  },
}

// (а) без реализации clock.after под плагинами: дверь отказывает, ожидание не
// кончается -- видно, что делает бюджет с висящим хуком.
// (б) clock.after снизу реализован настоящим setTimeout на e.ms -- колбэк
// приходит через 12 с реального времени: тратит ли это ожидание бюджет.
for (const variant of ["а-без-реализации", "б-реальное-время"]) test("AR4 (" + variant + "): turn.step ждёт $.clock.after 12000 мс, затем отвечает сам", {
  timeoutMs: 40_000,
  plugins: [PROBE_PLUGIN],
}, async ($: any, on: any) => {
  if (variant === "б-реальное-время") {
    on("clock.after", (_$: any, e: any) => new Promise<void>((resolve) => { setTimeout(resolve, Number(e && e.ms)) }))
  }
  on("turn.step", async function* (_$: any, e: any) {
    return {
      turnId: e.turnId, index: e.index, answer: "beneath", toolUses: [],
      stopReason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, model: e.model },
    }
  })
  const t0 = Date.now()
  let res: any = null
  let threw = ""
  try {
    res = await settleStep($.turn.step({ turnId: "t-ar4", index: 0, model: "m-ar4", messageCount: 1 }))
  } catch (x: any) { threw = String((x && x.message) || x) }
  const obs = { variant, waitMs: WAIT_MS, elapsedMs: Date.now() - t0, answer: res && res.answer, threw }
  console.log("AR4-OBS " + JSON.stringify(obs))
  expect(obs.threw, "шаг не бросил").toBe("")
  expect(String(obs.answer), "ответ пришёл от хука, не снизу").toContain("from-hook:")
})
