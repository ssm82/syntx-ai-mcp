# Архитектура syntx-ai-mcp

**syntx-ai-mcp** — это MCP-сервер (Model Context Protocol), который открывает возможности платформы [syntx.ai](https://syntx.ai) AI-ассистентам (Claude Desktop, IDE-агенты и др.). Сервер построен поверх типизированного SDK и транслирует вызовы API в стандартизованный интерфейс MCP: **tools**, **resources**, **resource templates** и **prompts**.

---

## 1. Принципы проектирования

| Принцип | Реализация |
|---|---|
| **Разделение слоёв** | SDK (HTTP) и MCP (протокол) изолированы; MCP никогда не делает HTTP-запросы напрямую |
| **Один источник истины** | Все данные идут через `SyntxClient`; MCP-слой только адаптирует их под протокол |
| **Детерминированный ввод** | Каждый инструмент имеет JSON Schema; валидация на границе протокола |
| **Чёткие ошибки** | Ошибки SDK маппятся в `isError: true` MCP-ответы, а не в исключения транспорта |
| **Нулевой конфиг** | Все настройки берутся из переменных окружения с разумными defaults |
| **Расширяемость** | Tools/resources/prompts регистрируются декларативно через реестр |

---

## 2. Слои (Layered Architecture)

```
┌──────────────────────────────────────────────────────────────────┐
│  Конфигуратор клиента                                            │
│  Claude Desktop / IDE / любой MCP-клиент                         │
└───────────────▲───────────────────────────────────▲──────────────┘
                │ stdio / HTTP+SSE                   │
┌───────────────┴───────────────────────────────────┴──────────────┐
│  TRANSPORT LAYER   (src/transport/)                              │
│  stdio.ts · http.ts · factory.ts                                 │
└───────────────▲──────────────────────────────────────────────────┘
                │ MCP protocol (JSON-RPC)
┌───────────────┴──────────────────────────────────────────────────┐
│  MCP SERVER LAYER   (src/mcp/)                                   │
│  server.ts (Server factory) · context.ts (SyntxClient) ·         │
│  registry.ts (типы Tool/Resource/Prompt)                         │
│  ├── tools/      → действия  (create-chat, send-message, ...)    │
│  ├── resources/  → данные    (syntx://models, syntx://plans)     │
│  └── prompts/    → шаблоны   (generate-landing, summarize-chat)  │
└───────────────▲──────────────────────────────────────────────────┘
                │ метод SDK
┌───────────────┴──────────────────────────────────────────────────┐
│  SDK LAYER   (src/ — корень)                                     │
│  client.ts (BaseClient) · syntx-client.ts (SyntxClient) ·        │
│  auth.ts · websocket.ts · errors.ts · types.ts · resources/      │
└───────────────▲──────────────────────────────────────────────────┘
                │ fetch / WebSocket
┌───────────────┴──────────────────────────────────────────────────┐
│  syntx.ai API   (https://api.syntx.ai)                           │
└──────────────────────────────────────────────────────────────────┘
```

Направление зависимостей — строго вниз. Транспорт зависит от MCP-ядра, MCP-ядро зависит от SDK, SDK зависит только от платформы (`fetch`, `WebSocket`). Слои выше ничего не знают о деталях реализации слоёв ниже, кроме публичного контракта.

---

## 3. Структура каталогов

```
syntx-ai-mcp/
├── src/
│   ├── index.ts                  # Публичные экспорты (SDK + createMcpServer + runCli)
│   │
│   ├── ── SDK LAYER ──────────────────────────────────────────────
│   ├── client.ts                 # BaseClient: HTTP (get/post/patch/delete)
│   ├── syntx-client.ts           # SyntxClient: агрегатор ресурсов
│   ├── auth.ts                   # SyntxAuth: токены + OAuth-хелперы
│   ├── websocket.ts              # SyntxWebSocket: стриминг
│   ├── errors.ts                 # SyntxAPIError, SyntxAuthError
│   ├── types.ts                  # Все доменные типы
│   ├── resources/                # AIResource, ChatsResource, DesignResource ...
│   │
│   ├── ── CONFIG LAYER ───────────────────────────────────────────
│   ├── config/
│   │   ├── index.ts              # loadConfig(): env → типизированный объект
│   │   └── schema.ts             # интерфейс McpServerConfig + defaults
│   │
│   ├── ── MCP SERVER LAYER ───────────────────────────────────────
│   ├── mcp/
│   │   ├── server.ts             # createMcpServer(config): Server
│   │   ├── context.ts            # McpContext — общее состояние (SyntxClient)
│   │   ├── registry.ts           # типы: SyntxTool, SyntxResource, SyntxPrompt
│   │   ├── errors.ts             # toMcpError(): маппинг ошибок SDK → MCP
│   │   ├── tools/
│   │   │   ├── index.ts          # allTools[] — единый реестр инструментов
│   │   │   ├── auth.ts           # set-token, validate-token, whoami
│   │   │   ├── chats.ts          # list-chats, create-chat, get-messages, send-message, wait-for-response
│   │   │   ├── ai.ts             # list-ai-services, list-models, get-model-info
│   │   │   ├── design.ts         # generate-image
│   │   │   ├── user.ts           # get-profile, get-balance, get-subscription
│   │   │   ├── files.ts          # list-uploaded-files, delete-file
│   │   │   └── folders.ts        # create-project, add-chats-to-project
│   │   ├── resources/
│   │   │   ├── index.ts          # allResources[] + allResourceTemplates[]
│   │   │   ├── static.ts         # syntx://models, syntx://plans, syntx://settings
│   │   │   └── templates.ts      # syntx://chat/{uuid}/messages
│   │   └── prompts/
│   │       ├── index.ts          # allPrompts[]
│   │       └── templates.ts      # generate-landing, summarize-chat, translate
│   │
│   ├── ── TRANSPORT LAYER ────────────────────────────────────────
│   ├── transport/
│   │   ├── index.ts              # createTransport(kind, config)
│   │   ├── stdio.ts              # StdioServerTransport
│   │   └── http.ts               # StreamableHTTPServerTransport (SSE)
│   │
│   └── ── ENTRY POINT ────────────────────────────────────────────
│   └── bin/
│       └── cli.ts                # node CLI: --transport, --token, ...
│
├── docs/                         # Документация
│   └── ARCHITECTURE.md           # Этот файл
├── examples/
│   ├── chat-example.ts           # Прямое использование SDK
│   ├── mcp-client-example.ts     # Использование как MCP-клиента
│   └── claude-desktop-config.json
├── dist/                         # Сборка (tsup)
├── package.json
└── tsconfig.json
```

---

## 4. Конфигурация

Все настройки загружаются из переменных окружения в `config/loadConfig()`.

| Переменная | Тип | Default | Назначение |
|---|---|---|---|
| `SYNTX_TOKEN` | `string` | — | Bearer-токен (обязателен для большинства операций) |
| `SYNTX_BASE_URL` | `string` | `https://api.syntx.ai` | Базовый URL API |
| `SYNTX_TIMEOUT` | `number` | `30000` | Таймаут HTTP, мс |
| `SYNTX_LANG` | `string` | `en` | Язык (для WebSocket/локалей) |
| `SYNTX_DEFAULT_AI` | `string` | `chatgpt` | AI-сервис по умолчанию для чатов |
| `SYNTX_DEFAULT_MODEL` | `string` | — | Модель по умолчанию |
| `SYNTX_POLL_INTERVAL` | `number` | `5000` | Интервал polling ответа, мс |
| `SYNTX_POLL_TIMEOUT` | `number` | `600000` | Таймаут ожидания ответа, мс |
| `MCP_TRANSPORT` | `stdio \| http` | `stdio` | Транспорт MCP-сервера |
| `MCP_HTTP_PORT` | `number` | `3000` | Порт HTTP-транспорта |

Токен также можно передавать динамически через инструмент `set-token` (полезно для multi-tenant).

---

## 5. MCP-инструменты (Tools)

Инструменты — основная поверхность взаимодействия. Каждый инструмент: имя, описание, JSON Schema ввода, async-обработчик.

| Инструмент | Описание | Опасность |
|---|---|---|
| `whoami` | Профиль текущего пользователя | read |
| `set-token` | Установить токен в рантайме | write (state) |
| `validate-token` | Проверить валидность токена | read |
| `list-ai-services` | Доступные AI-сервисы | read |
| `list-models` | Модели с ограничениями | read |
| `get-model-info` | Детальная информация о модели | read |
| `list-chats` | Список чатов (с фильтрами) | read |
| `create-chat` | Создать чат | write |
| `get-messages` | История сообщений чата | read |
| `send-message` | Отправить сообщение и вернуть ack | write |
| `ask` | Отправить промпт + дождаться ответа (one-shot) | write |
| `wait-for-response` | Polling до завершения генерации | read (long) |
| `generate-image` | Генерация изображения | write |
| `get-profile` / `get-balance` / `get-subscription` | Данные пользователя | read |
| `list-uploaded-files` / `delete-file` | Файлы | read / write |
| `create-project` / `add-chats-to-project` / `delete-project` | Создать папку проекта, добавить в неё чаты и удалить проект | write |

**Соглашение:** потенциально опасные (write/long-running) операции имеют явные параметры; read-операции идемпотентны.

---

## 6. MCP-ресурсы (Resources)

| URI | Описание |
|---|---|
| `syntx://models` | Каталог AI-моделей (JSON) |
| `syntx://ai-services` | Список AI-сервисов |
| `syntx://plans` | Тарифные планы |
| `syntx://settings` | Настройки приложения (OAuth-провайдеры) |
| `syntx://user/me` | Профиль текущего пользователя |
| `syntx://user/balance` | Баланс токенов |
| `syntx://chat/{uuid}/messages` *(template)* | Сообщения конкретного чата |

---

## 7. MCP-промпты (Prompts)

| Промпт | Параметры | Назначение |
|---|---|---|
| `generate-landing` | `topic`, `style` | Сгенерировать HTML-лендинг |
| `summarize-chat` | `chat_uuid` | Краткое изложение истории чата |
| `translate` | `text`, `target_lang` | Перевод текста |
| `code-review` | `code` | Ревью кода |

Промпты возвращают заготовленные сообщения, которые ассистент доотправляет через `send-message`/`ask`.

---

## 8. Жизненный цикл запроса (на примере `ask`)

```
MCP-клиент ──CallTool("ask", {prompt})──▶ MCP Server
                                            │
                                            ▼
                   1. Валидация args по JSON Schema
                   2. McpContext.syntx.chats.create({title})
                   3. McpContext.syntx.chats.sendMessage(uuid, ai, [{object_type:"text",...}])
                   4. McpContext.syntx.chats.waitForResponse(uuid, {pollInterval, timeout})
                   5. Формирование CallToolResult { content: [{type:"text", text}] }
                                            │
MCP-клиент ◀──result────────────────────────┘
```

---

## 9. Обработка ошибок

| Слой | Поведение |
|---|---|
| SDK | Бросает `SyntxAPIError` (статус/код) или `SyntxAuthError` |
| MCP | `toMcpError()` ловит и возвращает `{ isError: true, content: [...] }` — протокол не рвётся |
| Transport | Фатальные ошибки запуска => `process.exit(1)` с понятным сообщением |

Текст ошибки всегда содержит HTTP-статус и код API, чтобы ассистент мог реагировать (например, предложить `set-token` при 401).

---

## 10. Транспорты

- **stdio** (по умолчанию) — для Claude Desktop и локальных агентов. Запускается как дочерний процесс.
- **HTTP + SSE** (`StreamableHTTPServerTransport`) — для удалённых/веб-клиентов. Порт задаётся через `MCP_HTTP_PORT`.

`createTransport(kind)` инкапсулирует выбор; CLI флаг `--transport` переключает их.

---

## 11. Сборка и публикация

- Сборщик: **tsup** (CJS + ESM + dts) — уже настроен.
- Точка входа CLI: `dist/bin/cli.js`, регистрируется в `package.json` `bin.syntx-mcp`.
- Subpath exports: `.` (SDK+server factory), `./mcp` (только сервер), `./bin` (CLI).

---

## 12. Расширение проекта

- **Новый инструмент:** добавить файл в `src/mcp/tools/`, экспортировать объект `SyntxTool`, включить в `tools/index.ts`.
- **Новый ресурс:** добавить в `resources/static.ts` или `templates.ts`.
- **Новый SDK-метод:** расширить соответствующий `resources/*.ts`, затем обернуть инструментом.
