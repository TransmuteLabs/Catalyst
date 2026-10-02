# PROVENANCE — контракт типов мод-API в этом каталоге

## Текущее издание: 2.1.287 (02.10)

Порождение на usbox: писатель движка при загрузке сессии с `--plugin-dir`,
свидетель `2026-10-01T21:19:52.828Z`. `/plugin-types` в 287 отсутствует;
`plugin test` и `plugin validate` контракт не породили.

Команда из изолированного скрипта, исполненного под
`systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=0`:

```sh
R=/var/tmp/u15b-fix1-L60xqZxj
export HOME="$R/home" TMPDIR="$R/tmp" CLAUDE_CONFIG_DIR="$R/cc" CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_API_KEY=placeholder
cd "$R/gen"
/Users/maratkarimov/.local/share/claude/versions/2.1.287 --plugin-dir "$R/gen/catalyst-swe-request" --debug-file "$R/logs/load-debug.log" -p "noop"
```

Фиктивный ключ и локальный недоступный адрес отделяют загрузку мода от запроса;
рабочие учётные данные не читались и не передавались. Код запроса — не гейт
порождения; свидетель — строка писателя и существующие файлы.

- Образ `/Users/maratkarimov/.local/share/claude/versions/2.1.287`, SHA-256
  `4ff28540aaa9a0413a9b92624bb9a78b50c231ffd6957e873bd259427e13809c`;
  пристин `versions/2.1.287.orig`, SHA-256
  `3920489a5109cff5786a1a392c25277408ff22bc796d5edb9c16a60e5a1718f0`.
- `--version`: `2.1.287 (Claude Code)` / `4.3.3 (tweakcc)`.
- SHA-256 `claude-code/index.d.ts` `b899fbbd90476599bf236a104c4803bea7335786c016f2f63a84a4a311d35230`.
  Баннер: `// Written by Claude Code 2.1.287.`
- SHA-256 `claude-code-tools/index.d.ts` `4fd8344a01893c21d1f1daeed7cfd1ccb5e8d92a89bebcc8343490efa2b25483`.
  Баннер версии отсутствует; первая строка: `// The inputs of the built-in tools this build has, from each tool's`.
- SHA-256 `claude-code-mcp/index.d.ts` `0cab298516885f406c7762cf83b84334b5f5f02e1207abc79a02d136f518354b`.
  Файл написан при пустом `McpToolInputs`, несмотря на оговорку Р0-д об отсутствии
  файла при нуле MCP. Баннер версии отсутствует; первая строка:
  `// The inputs of the MCP tools the session had connected when this mod`.
- Инструменты теперь объявлены отдельно: 70 имён против 22 в контракте 285.
  Ушёл `ToolSearch`; добавлены `AppifactRepl`, `Artifact`, `ArtifactCheck`,
  `ArtifactComments`, `ArtifactData`, `AskUserQuestion`, `ClaudeDesign`,
  `EndConversation`, `EnterPlanMode`, `ExitPlanMode`, `FetchInboxMessage`,
  `GetTask`, `LSP`, `ListConnectors`, `ListMcpResourcesTool`, `ListPlugins`,
  `ListSkills`, `Monitor`, `Poll`, `Projects`, `ProposeGoal`, `PushNotification`,
  `ReadMcpResourceDirTool`, `ReadMcpResourceTool`, `ReadNotifications`,
  `RemoteTrigger`, `SearchMcpRegistry`, `SearchPlugins`, `SearchSkills`,
  `SendFeedback`, `SendFile`, `SendUserFile`, `SendUserMessage`,
  `ShareOnboardingGuide`, `ShowOnboardingRolePicker`, `SuggestConnectors`,
  `SuggestPluginInstall`, `SuggestSkills`, `TaskCreate`, `TaskGet`, `TaskList`,
  `TaskUpdate`, `TodoWrite`, `WaitForMcpServers`, `memory_list`, `memory_read`,
  `memory_write`, `propose_skills`, `request_computer`.
- `hook_event_name`: 33 имени; против 285 добавленных и удалённых нет.
- Ключи `EngineEventOf` / `NounEventOf` / `OpEventOf`: 103 против 102 в 285;
  добавлена дверь `prompt.compose`, удалённых нет.

Плоские файлы 285 удалены (U15-B FIX1b); tsconfig плагинов включают `../../.claude/types` каталогом.

## Прежнее издание: 2.1.285 (01.10)

- `claude-code.d.ts` и `claude-code-plugins.d.ts` порождены командой `/plugin-types`,
  выполненной неинтерактивно 2026-10-01 на usbox (площадка прогонов стендов) в копии
  этого дерева с изолированными HOME и CLAUDE_CONFIG_DIR (живой дом юзера не читался):

  ```
  cd <копия-дерева> && HOME=<изоляция>/home CLAUDE_CONFIG_DIR=<изоляция>/cc \
    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 \
    /Users/maratkarimov/.local/share/claude/versions/2.1.285 -p "/plugin-types"
  ```

- Запущенный образ: `/Users/maratkarimov/.local/share/claude/versions/2.1.285`,
  SHA-256 `fc7ef021d13df3d890ce4acdafee92a0e0e4137de83ffeff27416aac3233f018`;
  пристин того же издания `versions/2.1.285.orig`, SHA-256
  `33dad1ec615a2e08cc78b494f05c110e49916de2c79d78ec8799ebf46b233d29`;
  `--version`: `2.1.285 (Claude Code)` / `4.3.3 (tweakcc)`; баннер: «`// Written by Claude Code 2.1.285.`».
- SHA-256: `claude-code.d.ts` `cf5d9eb9131aee9c19ade995e364bbf88a9e536e001de3207d97464679167208` (22 встроенных
  инструмента; против 283: ушли `AskUserQuestion`, `Monitor`, `PushNotification`, `RemoteTrigger`,
  `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`; пришли `EnterWorktree`, `ExitWorktree`,
  `WebFetch`, `WebSearch`, `Workflow`), `claude-code-plugins.d.ts` `a0da8c3ed12adbcca5c6761fede64e61c3a210cff619270da7d07db181cf5850`
  (declares nothing: ни один включённый плагин не называет `types`).
- `claude-code-mcp.d.ts` перезаписан изданием 2.1.285 байт в байт равным прежнему
  (в изолированной сессии не подключён ни один MCP-сервер, `McpToolInputs` пуст):
  SHA-256 `47979a1cef42168e2f600c759eb3f650bc33f515baa7a9674a632db16b2533e1`.
- hook_event_name: 33 имени, набор равен изданиям 2.1.278/2.1.283.
- `session.append` — новая дверь издания 2.1.285 (в 2.1.283 отсутствовала).

## Прежнее издание: 2.1.283 (28.09)

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
