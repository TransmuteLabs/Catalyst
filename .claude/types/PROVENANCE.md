# PROVENANCE — контракт типов мод-API в этом каталоге

## Текущее издание: 2.1.283 (28.09)

- `claude-code.d.ts` и `claude-code-plugins.d.ts` порождены командой `/plugin-types`,
  которую юзер выполнил 2026-09-28 13:25 в сессии каталога
  `/Users/maratkarimov/work/SIB/Agents/claudeapp`; файлы скопированы сюда байт в байт.
- Образ: `/Users/maratkarimov/.local/bin/claude` → `/Users/maratkarimov/.local/share/claude/versions/2.1.283`,
  225 034 896 Б, SHA-256 `23163f8ee7df6d7e6f33514dadb5ed6fb6e3faec8490ec6f06e00b94a8baa328`;
  `--version`: `2.1.283 (Claude Code)` / `4.3.3 (tweakcc)`; баннер: «`// Written by Claude Code 2.1.283.`».
- SHA-256: `claude-code.d.ts` `62eca4548f32e84be006a265b77c5c39d59ec943d692b664bbbc969100b8b5b5` (25 встроенных
  инструментов), `claude-code-plugins.d.ts` `44150f02dcf449a67bf96e5f2c9265c39189900781004b38b7a4914bbe3decc8`
  (declares nothing: ни один включённый плагин не называет `types`).
- `claude-code-mcp.d.ts` НЕ заменён: его содержимое — MCP-инструменты сессии порождения
  (там — коннектор claude.ai Claude Docs), мод их не использует; оставлен пустой набор издания 2.1.278.
- hook_event_name: 33 имени, набор равен изданию 2.1.278.

## Прежнее издание: 2.1.278 (21.09)

Порождение: команда `/plugin-types` (команда сессии Claude Code, `type:"local"`),
выполненная неинтерактивно:

```
cd /Users/maratkarimov/work/SIB/Transmutation/Nexus/Catalyst/Catalyst && \
  /Users/maratkarimov/.local/bin/claude -p "/plugin-types"
```

Свидетельство живого образа:

- Образ: `/Users/maratkarimov/.local/bin/claude` → симлинк на
  `/Users/maratkarimov/.local/share/claude/versions/2.1.278`
- Размер: 217 694 272 Б
- SHA-256: `34ccf9100fdcd859d571ad143af89ac619358470b85b792e522cf97316836303`
- Версия из баннера сгенерированных файлов: **2.1.278**
  («`// Written by Claude Code 2.1.278.`» — первая строка `claude-code.d.ts`
  и `claude-code-plugins.d.ts`)
- `--version` образа даёт две строки (свидетель патча): `2.1.278 (Claude Code)`
  и `4.3.3 (tweakcc)`
- Дата порождения: 2026-09-21 (первый прогон 21:06, контрольный повтор после
  `/reload-plugins` 21:08; файлы идентичны по смыслу вывода)

Файлы:

- `claude-code.d.ts` — контракт движка (модуль `claude-code`, 24 встроенных
  инструмента), 499 789 Б. Предмет задач #342/#343.
- `claude-code-plugins.d.ts` — контракты ВКЛЮЧЁННЫХ плагинов. На момент
  генерации НИ один включённый плагин не называет контракт типа в манифесте
  (поле `types` в `plugin.json`), поэтому файл declares nothing. В частности,
  `catalyst-probes` 0.1.46 поля `types` в манифесте не несёт (проверено по
  `/Users/maratkarimov/.claude/plugins/cache/catalyst/catalyst-probes/0.1.46/.claude-plugin/plugin.json`
  и по `plugins/catalyst-probes/.claude-plugin/plugin.json` в этом репозитории).
- `claude-code-mcp.d.ts` — из `tools/list` MCP-серверов ТОЙ сессии. В сессии
  генерации не был подключен НИ один MCP-сервер, поэтому `McpToolInputs` пуст:
  набор заведомо УРЕЗАННЫЙ, это свойство сессии, не дефект контракта.
  Регенерируйте после подключения нужных серверов.
- `claude-code-plugins/` — пуст: нет плагинов с контрактом для копирования.

Контракт доказывает ДЕКЛАРАЦИЮ, не поведение: совпадение декларации с рантаймом
движка проверяется отдельными поведенческими пробами.

Регенерация: той же командой выше; не редактировать руками (баннер файлов
предписывает regenerate, не edit).
