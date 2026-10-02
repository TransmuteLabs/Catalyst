import { expect, test } from 'claude-code/testing'
import { buildNf, composeElement, REGISTRY_IDS, resolveView } from '../hooks/statusline'

// CONSTRAINT: значение вне союза Value не читается — текст не содержит полей
// этого значения и ключа ratio нет. Новое состояние Value обязано краснеть здесь.
test('composeElement outside the union does not read the value', () => {
  const id = REGISTRY_IDS[0]
  if (id === undefined) throw new Error('registry empty')
  const { view } = resolveView({}, {})
  const v = JSON.parse('{"state":"weird","text":"X"}')
  const comp = composeElement(id, v, {}, view, buildNf({}))
  expect(comp).not.toBeNull()
  if (comp === null) throw new Error('composeElement returned null')
  expect(comp.text.includes('X')).toBe(false)
  expect(Object.prototype.hasOwnProperty.call(comp, 'ratio')).toBe(false)
})
