// CONSTRAINT: это РЕПЛИКА применителей двери `$.requestText`; канонный дом
// поведения — `Catalyst-CC-Patch/tweakcc-patch.js`, шаг 34, массив `door`
// (`__ctlOne` / `__ctlText` / `__ctlSys` / `__ctlTools`), применяющий правила
// в ИСТОЧНИКАХ system и tools запроса (#468). Расхождение реплики с домом —
// дефект реплики или дома, а не свобода реализации.

type Compiled = { re?: RegExp; find?: string; to: string; tool?: string }

function escapeForModel(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function compile(op: any): Compiled {
  if (typeof op.pattern === "string" && op.pattern.length > 0) {
    return { re: new RegExp(op.pattern, op.flags || ""), to: op.to, tool: op.tool }
  }
  return { find: op.find, to: op.to, tool: op.tool }
}

function one(c: Compiled, text: string): string {
  if (c.re) {
    c.re.lastIndex = 0
    return text.replace(c.re, c.to)
  }
  return text.split(c.find as string).join(c.to)
}

// CONSTRAINT: реплика берёт имя модели из `body.model`, а дом (`__ctlSys`)
// получает его ОТДЕЛЬНЫМ аргументом и снимает маскировку прокси ВНУТРИ себя
// (`__ctlModel`) — для тестов формы эквивалентны, для переноса кода нет.
export function applyRule(rule: any, body: any): any {
  const compiled: Compiled[] = (rule.ops || []).map(compile)
  const sysOps = compiled.filter((c) => !c.tool)
  const toolOps = compiled.filter((c) => !!c.tool)

  // CONSTRAINT: ПОРЯДОК копирует дом: сперва отсев по модели, затем ранний
  // возврат по пустым спискам op. В доме между ними стоит `r.matched++`,
  // наблюдаемый через `list()`, — обратный порядок дал бы другое значение
  // счётчика. Дом делит применение на два вызова (`__ctlSys` по system,
  // `__ctlTools` по заранее снятому снимку tool-op), реплика моделирует их
  // одним вызовом — порядок ветвей при этом тот же.
  const modelRe = new RegExp("^" + escapeForModel(String(rule.model)) + "(?![\\w.-])", "i")
  if (!modelRe.test(String(body.model ?? ""))) return body

  // CONSTRAINT: три ветвления ниже копируют дом: без подходящих op тело
  // возвращается БЕЗ единого присваивания, системная ветка идёт под
  // `sysOps.length`, инструментальная — под `toolOps.length`. Иначе реплика
  // пересоздаёт массивы, которых дом не трогает, и зуб на неизменяемость
  // становится ложно зелёным.
  if (sysOps.length === 0 && toolOps.length === 0) return body

  if (sysOps.length) {
    if (typeof body.system === "string") {
      let text = body.system
      for (const c of sysOps) text = one(c, text)
      // CONSTRAINT: присваивание ТОЛЬКО при фактическом изменении (дом:
      // `if(s2!==b){__ctlChanged++;…;return s2}`). Расхождение наблюдаемо:
      // дом ведёт по этому же условию счётчик `__ctlChanged`, который отдаёт
      // `list()`, — безусловное присваивание завысило бы его.
      if (text !== body.system) body.system = text
    } else if (Array.isArray(body.system)) {
      let changed = false
      const next = body.system.map((k: any) => {
        if (!k || typeof k !== "object" || typeof k.text !== "string") return k
        let text = k.text
        for (const c of sysOps) text = one(c, text)
        if (text === k.text) return k
        changed = true
        return Object.assign({}, k, { text })
      })
      // CONSTRAINT: КОНТЕЙНЕР заменяется только при фактическом изменении
      // элемента (дом: `if(c1){__ctlChanged++;…;return a1}`). Безусловный
      // `.map` отдаёт новый массив там, где дом возвращает прежний по
      // тождеству.
      if (changed) body.system = next
    }
  }

  if (toolOps.length && Array.isArray(body.tools)) {
    let changed = false
    const next = body.tools.map((t: any) => {
      // CONSTRAINT: дом (`__ctlTools`) отсеивает инструмент и по имени
      // (`typeof t.name!=="string"||typeof t.description!=="string"`).
      if (!t || typeof t !== "object" || typeof t.name !== "string" || typeof t.description !== "string") return t
      let description = t.description
      for (const c of toolOps) if (c.tool === t.name) description = one(c, description)
      if (description === t.description) return t
      changed = true
      return Object.assign({}, t, { description })
    })
    // CONSTRAINT: КОНТЕЙНЕР заменяется только при фактическом изменении
    // элемента (дом: `if(c2){…;return a2}`).
    if (changed) body.tools = next
  }

  return body
}
