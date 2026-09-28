// CONSTRAINT (#514 FIX2b): предел вызовов модели на весь стенд -- тот же класс
// дефекта, что уронил мак 26.09: зуб, чей цикл зовёт модель без паузы, растил
// память без предела. Один дом предела для обоих файлов зубов. Счёт -- на
// экземпляр фейка (next, обработчик модели движка, стенд model.complete):
// каждый тест строит свои. Отказ шага -- поток с куском содержимого и броском:
// бросок до содержимого мод читает отказом носителя и крутит цикл дальше, после
// содержимого -- пробрасывает (attemptOne), и зуб падает этой ошибкой.
export const STAND_MODEL_CALL_CAP = 2000
export const STAND_MODEL_CAP_TEXT = "stand: model call cap " + String(STAND_MODEL_CALL_CAP)
const standModelCalls = new WeakMap<object, number>()

export function standModelOver(key: object): boolean {
  const n = (standModelCalls.get(key) || 0) + 1
  standModelCalls.set(key, n)
  return n > STAND_MODEL_CALL_CAP
}

export function standModelCapStream(): any {
  return (async function* () {
    yield { kind: "text", text: STAND_MODEL_CAP_TEXT }
    throw new Error(STAND_MODEL_CAP_TEXT)
  })()
}

export function cappedNext(next: any): any {
  if (typeof next !== "function") return next
  return new Proxy(next, {
    apply(target: any, self: any, args: any[]) {
      if (standModelOver(target)) return standModelCapStream()
      return Reflect.apply(target, self, args)
    },
  })
}

// CONSTRAINT: обёртка сохраняет род обработчика -- зубы сверяют род
// подписки с формой события (turn.step -- async-генератор).
export function cappedStep(fn: any): any {
  if (typeof fn !== "function") return fn
  if (fn.constructor && fn.constructor.name === "AsyncGeneratorFunction") {
    return async function* (this: any, $: any, e: any, next: any) { return yield* fn.call(this, $, e, cappedNext(next)) }
  }
  return function (this: any, $: any, e: any, next: any) { return fn.call(this, $, e, cappedNext(next)) }
}

// Захват подписок мода: next у turn.step и у его .catch-обработчика --
// модельный вызов.
export function cappedRegister(raw: (on: any) => any): (on: any) => any {
  return (on: any) => raw((...a: any[]) => {
    const step = a[0] === "turn.step"
    const r = on(...(step ? a.map((x: any, i: number) => (i > 0 ? cappedStep(x) : x)) : a))
    if (!step || !r || typeof r.catch !== "function") return r
    return Object.assign({}, r, { catch: (h: any) => r.catch.call(r, cappedStep(h)) })
  })
}

// Обработчик turn.step, подписанный зубом у движка стенда (модель под модом).
export function modelCapped(fn: any): any {
  const key = {}
  return async function* (this: any, ...args: any[]) {
    if (standModelOver(key)) return yield* standModelCapStream()
    return yield* fn.apply(this, args)
  }
}
