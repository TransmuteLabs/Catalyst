// CONSTRAINT (#509-FIX1 E3): таблица входов [failover].terminal для мода
// (units.test.ts). Между маркерами BEGIN-JSON/END-JSON -- только JSON.
// Вердикт: green -- терминал принят и
// вызываем, red -- отвергнут. Строка {"absent": true} -- ключа нет. Входы без
// [pins]: паритет судится на словаре эффорта мода (EFFORTS в register.ts).
export const TERMINAL_PARITY_509: any[] =
// BEGIN-JSON
[
  {"absent": true, "verdict": "red"},
  {"raw": "", "verdict": "red"},
  {"raw": "  ", "verdict": "red"},
  {"raw": {"model": "  "}, "verdict": "red"},
  {"raw": ["x"], "verdict": "red"},
  {"raw": true, "verdict": "red"},
  {"raw": 42, "verdict": "red"},
  {"raw": {"effort": "high"}, "verdict": "red"},
  {"raw": "opus", "verdict": "red"},
  {"raw": "fable", "verdict": "red"},
  {"raw": " Sonnet ", "verdict": "red"},
  {"raw": "haiku", "verdict": "red"},
  {"raw": "glm-5.3", "verdict": "red"},
  {"raw": {"model": "claude-opus-5-5", "effort": "bogus"}, "verdict": "red"},
  {"raw": {"model": "claude-opus-5-5", "effort": "High"}, "verdict": "red"},
  {"raw": {"model": "claude-opus-5-5", "effort": "xhigh"}, "verdict": "green"},
  {"raw": {"model": "claude-opus-5-5", "effort": "high"}, "verdict": "green"},
  {"raw": " Claude-Opus-5-5 ", "verdict": "green"},
  {"raw": "claude-opus-5-5[1m]", "verdict": "green"},
  {"raw": "claude-opus-5-5", "verdict": "green"}
]
// END-JSON
