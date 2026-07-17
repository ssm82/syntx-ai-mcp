<div align="center">

# syntx-ai-mcp

**MCP-сервер и TypeScript SDK для AI-платформы [syntx.ai](https://syntx.ai)**

Превратите любой MCP-совместимый ассистент (Claude Desktop, Cursor, VS Code, Cline) в полнофункционального клиента syntx.ai: чаты, генерация изображений, каталог моделей, управление аккаунтом — всё через единый протокол Model Context Protocol.

[![MCP](https://img.shields.io/badge/MCP-1.0+-6BA7E1)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## Содержание

- [Обзор](#обзор)
- [Возможности](#возможности)
- [Требования](#требования)
- [Быстрый старт](#быстрый-старт)
- [Подключение к клиентам](#подключение-к-клиентам)
  - [Claude Desktop](#claude-desktop)
  - [Cursor](#cursor)
  - [VS Code (Copilot / Insiders)](#vs-code-copilot--insiders)
  - [Cline](#cline)
  - [Continue / Windsurf](#continue--windsurf)
  - [HTTP / SSE (любой клиент)](#http--sse-любой-клиент)
- [Переменные окружения](#переменные-окружения)
- [Транспорты](#транспорты)
- [Инструменты (Tools)](#инструменты-tools)
  - [Идентификация и токен](#идентификация-и-токен)
  - [Каталог AI](#каталог-ai)
  - [Чаты и сообщения](#чаты-и-сообщения)
  - [Генерация изображений](#генерация-изображений)
  - [Аккаунт пользователя](#аккаунт-пользователя)
  - [Файлы](#файлы)
- [Ресурсы (Resources)](#ресурсы-resources)
- [Промпты (Prompts)](#промпты-prompts)
- [Программное использование (SDK)](#программное-использование-sdk)
- [Примеры](#примеры)
- [Разработка](#разработка)
- [Как это работает](#как-это-работает)
- [Дорожная карта](#дорожная-карта)
- [Лицензия](#лицензия)

---

## Обзор

**syntx-ai-mcp** — это сервер [Model Context Protocol](https://modelcontextprotocol.io), который открывает возможности платформы syntx.ai AI-ассистентам по единому стандарту. Вместо интеграции проприетарного API в каждый инструмент, вы один раз запускаете MCP-сервер — и любой MCP-клиент получает доступ к:

- 💬 **Чатам и моделям** — создание сессий, отправка промптов, ожидание ответа (включая one-shot `ask`).
- 🎨 **Генерации изображений** — Sora, Flux и другие design-сервисы.
- 📚 **Каталогу** — AI-сервисы, модели с ограничениями, тарифные планы.
- 👤 **Аккаунту** — профиль, баланс токенов, подписка.
- 📁 **Файлам** — список и удаление загруженных файлов.

Пакет распространяется как **два-в-одном**: готовый MCP-сервер (`syntx-mcp` CLI) и полноценный типизированный SDK (`SyntxClient`) для прямого программного использования.

## Возможности

| Группа | Что входит |
|---|---|
| 🛠️ **19 инструментов** | Идентификация, чаты, генерация, каталог, аккаунт, файлы |
| 📄 **6 ресурсов** + 1 шаблон | `syntx://models`, `syntx://plans`, `syntx://user/me`, … |
| 💡 **4 промпт-шаблона** | generate-landing, summarize-chat, translate, code-review |
| 🔌 **2 транспорта** | stdio (по умолчанию) и stateless HTTP/SSE |
| 🔐 **Runtime-токен** | Задавайте токен через env **или** инструментом `set-token` |
| 🧱 **Типобезопасность** | Полная типизация TypeScript, JSON Schema для каждого инструмента |
| 🌐 **Dual-формат** | Сборка CJS + ESM + `.d.ts` |

## Требования

- **Node.js ≥ 18** (использует встроенный `fetch` и `WebSocket`)
- Учётная запись и **bearer-токен** [syntx.ai](https://syntx.ai)
- MCP-совместимый клиент (Claude Desktop, Cursor, VS Code Insiders, Cline, …)

---

## Быстрый старт

```bash
# 1. Установить пакет
npm install syntx-ai-mcp

# 2. Собрать (если клонировали репозиторий)
npm install && npm run build

# 3. Запустить MCP-сервер (stdio — стандарт для локальных клиентов)
SYNTX_TOKEN="ваш-токен" npx syntx-ai-mcp
```

Готово — теперь подключите сервер к вашему ассистенту (см. ниже).

> **Токен можно не задавать заранее.** Запустите сервер без `SYNTX_TOKEN` и вызовите инструмент `set-token` прямо из чата — токен применится в рантайме.

---

## Подключение к клиентам

### Claude Desktop

Отредактируйте конфиг Claude Desktop:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "syntx-ai": {
      "command": "npx",
      "args": ["-y", "syntx-ai-mcp"],
      "env": {
        "SYNTX_TOKEN": "ВАШ_ТОКЕН"
      }
    }
  }
}
```

Если пакет собран локально — используйте прямой путь:

```json
{
  "mcpServers": {
    "syntx-ai": {
      "command": "node",
      "args": ["/путь/к/syntx-ai-mcp/dist/bin/cli.js"],
      "env": { "SYNTX_TOKEN": "ВАШ_ТОКЕН" }
    }
  }
}
```

После сохранения перезапустите Claude Desktop. В чате появятся инструменты `ask`, `list-models` и др. — Claude будет вызывать их автоматически.

### Cursor

Файл `.cursor/mcp.json` в корне проекта (или глобально):

```json
{
  "mcpServers": {
    "syntx-ai": {
      "command": "npx",
      "args": ["-y", "syntx-ai-mcp"],
      "env": { "SYNTX_TOKEN": "ВАШ_ТОКЕН" }
    }
  }
}
```

В Cursor: **Settings → Cursor Settings → Features → MCP → Add new MCP Server**.

### VS Code (Copilot / Insiders)

Файл `.vscode/mcp.json` в workspace:

```json
{
  "servers": {
    "syntx-ai": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "syntx-ai-mcp"],
      "env": { "SYNTX_TOKEN": "ВАШ_ТОКЕН" }
    }
  }
}
```

Откройте Command Palette → **MCP: List Servers**, чтобы убедиться, что `syntx-ai` активен.

### Cline

Файл `cline_mcp_settings.json` (через интерфейс Cline → MCP Servers):

```json
{
  "mcpServers": {
    "syntx-ai": {
      "command": "npx",
      "args": ["-y", "syntx-ai-mcp"],
      "env": { "SYNTX_TOKEN": "ВАШ_ТОКЕН" },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### Continue / Windsurf

Используйте стандартный stdio-блок `command`/`args`/`env` (формат идентичен Claude Desktop). Для Windsurf: **Settings → MCP Servers → Add Server**.

### HTTP / SSE (любой клиент)

Запустите сервер в HTTP-режиме и подключите клиента по URL:

```bash
SYNTX_TOKEN="ВАШ_ТОКЕН" npx syntx-ai-mcp --transport http --http-port 8080
# MCP endpoint: http://127.0.0.1:8080/mcp
# Health check:  http://127.0.0.1:8080/health
```

```json
{
  "mcpServers": {
    "syntx-ai": { "url": "http://127.0.0.1:8080/mcp" }
  }
}
```

---

## Переменные окружения

| Переменная | Тип | По умолчанию | Описание |
|---|---|---|---|
| `SYNTX_TOKEN` | string | — | Bearer-токен syntx.ai. Обязателен для большинства операций (можно задать через `set-token`). |
| `SYNTX_BASE_URL` | string | `https://api.syntx.ai` | Базовый URL API. |
| `SYNTX_TIMEOUT` | number | `30000` | Таймаут HTTP-запроса, мс. |
| `SYNTX_LANG` | string | `en` | Язык (локали, WebSocket). |
| `SYNTX_DEFAULT_AI` | string | `chatgpt` | AI-сервис по умолчанию для `send-message`/`ask`. |
| `SYNTX_DEFAULT_MODEL` | string | — | Модель по умолчанию. |
| `SYNTX_POLL_INTERVAL` | number | `5000` | Интервал polling ответа, мс. |
| `SYNTX_POLL_TIMEOUT` | number | `600000` | Максимальное ожидание ответа, мс. |
| `SYNTX_STREAM_MODE` | `auto` \| `stream` \| `poll` \| `off` | `auto` | Стратегия стриминга для `ask` / `stream-message`. |
| `SYNTX_WS_URL` | string | `wss://api.syntx.ai/api/v1` | Базовый URL WSS-эндпоинта. |
| `MCP_TRANSPORT` | `stdio` \| `http` | `stdio` | Транспорт MCP-сервера. |
| `MCP_HTTP_PORT` | number | `3000` | Порт HTTP-транспорта. |

Альтернативно — флаги CLI: `--token`, `--base-url`, `--transport`, `--http-port`. Флаги приоритетнее env.

---

## Транспорты

**syntx-ai-mcp** поддерживает два транспорта Model Context Protocol:

### stdio (по умолчанию)

Клиент запускает сервер как дочерний процесс и общается через стандартные потоки. Рекомендуется для **локальных** ассистентов (Claude Desktop, Cursor, VS Code, Cline). Минимальные задержки, нулевая сетевая конфигурация.

```bash
npx syntx-ai-mcp                          # stdio
npx syntx-ai-mcp --transport stdio        # явно
```

### HTTP + SSE

Stateless Streamable HTTP: на каждый запрос создаётся свежий transport + server (канонический паттерн MCP SDK). Подходит для **удалённых**, облачных и веб-клиентов. Поддерживает health-check `/health`.

```bash
npx syntx-ai-mcp --transport http --http-port 8080
```

---

## Инструменты (Tools)

Все 19 инструментов принимают JSON-аргументы и возвращают структурированный результат. Текстовые ответы — это JSON-снимки данных API; ошибки возвращаются с `isError: true` (без обрыва канала).

### Идентификация и токен

| Инструмент | Описание | Параметры |
|---|---|---|
| `whoami` | Профиль текущего пользователя | — |
| `set-token` | Установить/заменить токен в рантайме | `token`* |
| `validate-token` | Проверить валидность текущего токена | — |

> `*` — обязательный параметр.

### Каталог AI

| Инструмент | Описание | Параметры |
|---|---|---|
| `list-ai-services` | Доступные AI-сервисы (ChatGPT, Midjourney, Sora…) | — |
| `list-models` | Модели с ограничениями и поддерживаемыми форматами | `scope?`, `ai_name?`, `active_only?`, `search?` |
| `get-model-info` | Детальная информация о модели (параметры, лимиты) | `ai_name`*, `model_type`*, `batch_size?`, `quality?`, `video_duration?`, `chars_count?`, `mode?` |

Параметры `list-models` (все опциональны, комбинируются через AND):

- `scope` — категория возможностей: `text` \| `image` \| `video` \| `audio` \| `upscale`. Категория выводится из `ai_name` провайдера; если провайдер неизвестен, модель попадает только в вызовы без фильтра `scope`.
- `ai_name` — точное имя провайдера syntx.ai, например `"chatgpt"`, `"claude"`, `"midjourney"`.
- `active_only` — `true` (по умолчанию) скрывает неактивные модели. Передайте `false`, чтобы получить весь каталог.
- `search` — регистронезависимая подстрока по `value`/`label` (например, `"gpt-5"`).

Пример:

```json
{
  "name": "list-models",
  "arguments": {
    "scope": "text",
    "ai_name": "chatgpt",
    "search": "gpt-5"
  }
}
```

### Чаты и сообщения

| Инструмент | Описание | Параметры |
|---|---|---|
| `list-chats` | Список чатов с фильтрами | `scope?`, `search?`, `direction?`, `page_size?` |
| `create-chat` | Создать чат (обязателен `title`) | `title`*, `scope?`, `model?` |
| `get-messages` | История сообщений чата | `chat_id`*, `page_size?`, `direction?` |
| `send-message` | Отправить промпт, вернуть ack (ответ — асинхронно) | `chat_id`*, `prompt`*, `ai_name?`, `model_type?` |
| `wait-for-response` | Дождаться завершения генерации и вернуть текст | `chat_id`*, `timeout?`, `poll_interval?` |
| `ask` ⭐ | One-shot: создать чат → отправить → дождаться ответа | `prompt`*, `title?`, `ai_name?`, `model_type?`, `scope?`, `timeout?`, `poll_interval?`, `mode?` |
| `stream-message` 🌊 | One-shot со стримингом ответа по WebSocket + `notifications/progress` | `prompt`*, `scope?`, `model?`, `ai_name?`, `model_type?`, `timeout?`, `mode?` |
| `generate-title` | Авто-заголовок для чата | `chat_uuid`* |

> ⭐ **`ask`** — главный инструмент для stateless Q&A. Возвращает `chat_uuid` для последующих уточнений через `send-message` + `wait-for-response`.
>
> 🌊 **`stream-message`** открывает WSS-сессию и доставляет токены по мере поступления. Прогресс отправляется через MCP-нотификации (`notifications/progress` + `notifications/message`); финальный результат содержит полный текст и метаданные (`chat_uuid`, `elapsed_ms`, `chunks`). Управляется переменной `SYNTX_STREAM_MODE` (`auto`/`stream`/`poll`/`off`).

**Пример вызова `ask`:**

```json
{
  "name": "ask",
  "arguments": {
    "prompt": "Объясни квантовую запутанность простыми словами",
    "ai_name": "chatgpt",
    "model_type": "gpt-5-mini"
  }
}
```

### Генерация изображений

| Инструмент | Описание | Параметры |
|---|---|---|
| `generate-image` | Генерация изображений через design-сервис | `chat_uuid`*, `prompt`*, `ai_name?`, `n?`, `model_type?`, `resolution?`, `quality?`, `image_url?` |

```json
{
  "name": "generate-image",
  "arguments": {
    "chat_uuid": "131c1065-644a-492f-a1ff-cdb6ba7d8560",
    "prompt": "Космический корабль в стиле киберпанк, неоновые огни",
    "resolution": "720x1280",
    "quality": "medium",
    "n": 1
  }
}
```

> Сначала создайте чат через `create-chat`, чтобы получить `chat_uuid`.

### Аккаунт пользователя

| Инструмент | Описание |
|---|---|
| `get-profile` | Профиль (имя, email, аватар, auth-сервисы) |
| `get-balance` | Баланс токенов |
| `get-subscription` | Активная подписка и реферальная информация |

### Файлы

| Инструмент | Описание | Параметры |
|---|---|---|
| `list-uploaded-files` | Список загруженных файлов | `scope?`, `page?`, `page_size?` |
| `upload-files` | Загрузить до 10 файлов (≤ 100 МБ каждый) | `files`*, `check_duplicates?` |
| `delete-file` | Удалить файл | `file_id`* |

Каждый элемент массива `files` в `upload-files` принимает **одно из двух**:

- `{ path }` — путь к файлу на машине, где запущен MCP-сервер (stdio/HTTP-сервер должен иметь доступ к ФС).
- `{ content_base64, filename }` — base64-пayload (можно с префиксом `data:<mime>;base64,`). `filename` обязателен, `mime_type` опционален и подбирается по расширению.

Пример (смешанные источники):

```json
{
  "name": "upload-files",
  "arguments": {
    "files": [
      { "path": "C:\\Users\\me\\photo.jpg" },
      {
        "content_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "filename": "pixel.png"
      }
    ],
    "check_duplicates": true
  }
}
```

---

## Ресурсы (Resources)

Ресурсы — это данные, которые ассистент может читать напрямую по URI (возвращаются как JSON).

| URI | Имя | Описание |
|---|---|---|
| `syntx://models` | AI Models Catalog | Полный каталог моделей с ограничениями |
| `syntx://ai-services` | AI Services | Доступные AI-сервисы |
| `syntx://plans` | Subscription Plans | Тарифные планы |
| `syntx://settings` | Application Settings | OAuth-провайдеры, страна, IP |
| `syntx://user/me` | Current User Profile | Профиль текущего пользователя |
| `syntx://user/balance` | Token Balance | Баланс токенов |

**Шаблон ресурса:**

| Шаблон URI | Описание |
|---|---|
| `syntx://chat/{uuid}/messages` | История сообщений конкретного чата по UUID |

---

## Промпты (Prompts)

Готовые шаблоны диалога — ассистент доотправляет их через `ask`/`send-message`.

| Промпт | Параметры | Назначение |
|---|---|---|
| `generate-landing` | `topic`*, `style?` | Сгенерировать одностраничный HTML-лендинг |
| `summarize-chat` | `chat_uuid`* | Краткое изложение истории чата |
| `translate` | `text`*, `target_lang`* | Перевод текста |
| `code-review` | `code`* | Ревью кода с исправленным вариантом |

---

## Программное использование (SDK)

Помимо MCP-сервера, пакет экспортирует типизированный SDK для прямого использования:

```ts
import { SyntxClient } from 'syntx-ai-mcp';

const syntx = new SyntxClient({ token: 'your-token' });

// Профиль и баланс
const me = await syntx.user.me();
const { balance } = await syntx.user.getBalance();

// Список моделей
const models = await syntx.ai.listModels();

// Создать чат и отправить сообщение
const chat = await syntx.chats.create({ scope: 'text', title: 'Demo' });
await syntx.chats.sendMessage(chat.uuid, 'chatgpt', [
  { object_type: 'text', object_url: null, object_text: 'Привет!', model_type: 'gpt-5-mini' },
]);

// Дождаться ответа
const { text } = await syntx.chats.waitForResponse(chat.uuid);
console.log(text);
```

### Программный запуск MCP-сервера

```ts
import { loadConfig, createMcpServer, runTransport } from 'syntx-ai-mcp';

const config = loadConfig();          // из env
const factory = () => createMcpServer(config).server;
await runTransport(factory, 'stdio', 3000);
```

### Экспортируемые сущности SDK

| Группа | Методы |
|---|---|
| `syntx.auth` | `setToken`, `getToken`, `isAuthenticated`, `validateToken`, `logout` |
| `syntx.ai` | `listServices`, `listModels`, `getModelInfo` |
| `syntx.user` | `me`, `getBalance`, `getSubscription`, `getSettings` |
| `syntx.chats` | `list`, `create`, `getMessages`, `sendMessage`, `waitForResponse`, `pollForResponse`, `streamResponse`, `generateTitle`, `delete`, `pin`, `moveToFolder`, `uploadFiles`, `getUploadedFiles`, `deleteFile`, `transcribe` |
| `syntx.design` | `generate` |
| `syntx.audio` | `listVoiceExamples` |
| `syntx.plans` | `list`, `getPromoBanners` |
| `syntx.folders` / `syntx.settings` | папки и настройки приложения |

## Стриминг ответов

`ChatsResource.streamResponse(prompt, options)` создаёт чат, отправляет промпт и опрашивает REST API до появления ответа. Возвращает `{ text, message, elapsedMs, chatUuid }`. Колбэк `onChunk(chunk, accumulated)` вызывается с полным текстом ответа.

```ts
const result = await syntx.chats.streamResponse('Расскажи о Kepler-186f', {
  timeout: 60_000,
  aiName: 'gemini',
  model: 'gemini-3.5-flash',
  onSession: (uuid) => console.log('chat:', uuid),
  onChunk: (chunk, accumulated) => process.stdout.write(chunk),
});
console.log(`\n✓ ${result.text.length} chars in ${result.elapsedMs}ms (chat: ${result.chatUuid})`);
```

> **Как это работает:** API syntx.ai генерирует ответ асинхронно и возвращает его целиком по готовности (инкрементального token-by-token стриминга нет). `streamResponse` предоставляет стриминг-совместимый интерфейс поверх REST-поллинга: `onSession` — при создании чата, `onChunk` — при получении ответа, `chatUuid` — для последующих сообщений.

Внутри MCP-сервера инструмент `stream-message` оборачивает тот же метод, отправляя `notifications/progress` и `notifications/message` (если клиент передал `progressToken` в `_meta`).

Стратегия управляется через `SYNTX_STREAM_MODE`:

| Значение | Поведение |
|---|---|
| `auto` (по умолчанию) | REST-поллинг через `streamResponse` |
| `stream` | То же, что `auto` (WSS-эндпоинт в API отсутствует) |
| `poll` | REST `create` + `sendMessage` + `waitForResponse` |
| `off` | Fire-and-forget: `ask` создаёт чат, отправляет промпт и сразу возвращает `chat_uuid` |

Готовый пример — в [`examples/stream-example.ts`](examples/stream-example.ts).

Полный справочник типов — в `src/types.ts`. Внутреннее устройство слоёв — в [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Примеры

В каталоге [`examples/`](examples) лежат готовые сценарии:

| Файл | Описание |
|---|---|
| `chat-example.ts` | Прямая работа с чатами через SDK |
| `mcp-client-example.ts` | Подключение к серверу как MCP-клиент и вызов `ask` |
| `stream-example.ts` | One-shot WSS-стриминг ответа в консоль |
| `claude-desktop-config.json` | Готовый конфиг для Claude Desktop |

Запуск примеров:

```bash
npm run build
npx tsx examples/mcp-client-example.ts
SYNTX_TOKEN=... npx tsx examples/stream-example.ts "Расскажи анекдот"
```

---

## Разработка

```bash
git clone <repo>
cd syntx-ai-mcp
npm install
npm run build        # CJS + ESM + dts (tsup)
npm run typecheck    # tsc --noEmit
npm run dev          # сборка в watch-режиме
```

**Добавление нового инструмента:**

1. Создайте файл в `src/mcp/tools/` с объектом `SyntxTool`.
2. Включите его в `src/mcp/tools/index.ts` (`allTools`).
3. Готово — сервер и `tools/list` подхватят автоматически.

Аналогично для ресурсов (`src/mcp/resources/`) и промптов (`src/mcp/prompts/`). Детально — в [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Как это работает

```
MCP-клиент (Claude/Cursor/…)
        │  stdio или HTTP+SSE
        ▼
TRANSPORT   src/transport/   ── stdio.ts · http.ts
        │  JSON-RPC
        ▼
MCP SERVER  src/mcp/         ── server.ts · registry.ts · tools/ · resources/ · prompts/
        │  вызовы SDK
        ▼
SDK         src/             ── SyntxClient · resources/ · auth · websocket
        │  fetch / WebSocket
        ▼
syntx.ai API   https://api.syntx.ai
```

Зависимости направлены строго вниз: транспорт зависит от MCP-ядра, ядро — от SDK, SDK — только от платформы. Ошибки API маппятся в `isError`-ответы, поэтому JSON-RPC-канал никогда не обрывается.

---

## Дорожная карта

- [ ] Транскрипция аудио как инструмент (`transcribe`)
- [x] Загрузка файлов (`upload-files`) с поддержкой бинарных данных в MCP
  - [x] Стриминг ответов через WebSocket (см. `stream-message`, `chats.streamResponse`, `SYNTX_STREAM_MODE`)
  - [x] CI: GitHub Actions (`npm run typecheck && npm run build` на Node 18/20/22)
  - [ ] OAuth-flow для получения токена из CLI
  - [ ] Аутентифицированный HTTP-транспорт (Bearer для самого MCP)
  - [ ] Юнит-тесты (Vitest)

---

## Сопутствующие документы

- [CHANGELOG.md](CHANGELOG.md) — история релизов.
- [CONTRIBUTING.md](CONTRIBUTING.md) — правила участия, стиль кода, советы по PR.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — послойное описание архитектуры.

---

## Лицензия

[MIT](LICENSE)
