// CONSTRAINT (S4-FIX13 Т3, swe2 F1): a name from input (a theme, a palette, an axis value, an element id) never resolves through the prototype chain, and `__proto__` is written as an own key
export const own = <T>(table: Record<string, T>, key: string): T | undefined => Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
export const setOwn = <T>(table: Record<string, T>, key: string, value: T): void => { Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true }) }
