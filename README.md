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
  - [Генерация медиа](#генерация-медиа)
  - [Аудио](#аудио)
  - [Аккаунт пользователя](#аккаунт-пользователя)
  - [Файлы](#файлы)
- [Безопасность](#безопасность)
- [Troubleshooting](#troubleshooting)
- [Получение токена](#получение-токена)
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
- 🎨 **Генерации медиа** — изображения (Sora, Flux и другие design-сервисы), аудио и видео.
- 📚 **Каталогу** — AI-сервисы, модели с ограничениями.
- 👤 **Аккаунту** — профиль, баланс токенов.
- 📁 **Файлам** — список и удаление загруженных файлов.

Пакет распространяется как **два-в-одном**: готовый MCP-сервер (`syntx-mcp` CLI) и полноценный типизированный SDK (`SyntxClient`) для прямого программного использования.

## Возможности

| Группа | Что входит |
|---|---|
| 🛠️ **38 инструментов** | Идентификация, чаты, генерация медиа (изображения, аудио, видео), транскрипция, каталог, аккаунт, файлы, проекты (папки) |
| 🔌 **2 транспорта** | stdio (по умолчанию) и stateless HTTP/SSE |
| 🔐 **Токен в рантайме** | Задавайте токен без перезапуска (`set-token`); проверяйте статус через `whoami` |
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
| `SYNTX_LANG` | string | `en` | Локаль API (например, язык ответов тарифных планов). Не влияет на язык генерации моделей. |
| `SYNTX_DEFAULT_AI` | string | `chatgpt` | AI-сервис по умолчанию для `send-message`/`ask`. |
| `SYNTX_DEFAULT_MODEL` | string | — | Модель по умолчанию. |
| `SYNTX_POLL_INTERVAL` | number | `5000` | Интервал polling ответа, мс. |
| `SYNTX_POLL_TIMEOUT` | number | `600000` | Максимальное ожидание ответа, мс. |
| `SYNTX_STREAM_MODE` | `auto` \| `stream` \| `poll` \| `off` | `auto` | Стратегия стриминга для `ask` / `stream-message`. Влияет только на `ask` (см. ниже). |
| `SYNTX_WS_URL` | string | `wss://api.syntx.ai/api/v1` | Базовый URL WSS-эндпоинта. |
| `SYNTX_LLM_SSE_BASE_URL` | string | `https://sse.syntx.ai` | Базовый URL для SSE-стрима, используемого text-flow `llm/*`. |
| `SYNTX_LEGACY_TEXT_TRANSPORT` | boolean | `false` | Если `true`, инструменты `ask` / `stream-message` / `send-message` / `wait-for-response` используют устаревший путь `chats/{id}/messages` с REST-поллингом вместо нового `llm/*` (text-flow + SSE). |
| `SYNTX_LLM_MODELS_CACHE_MS` | number | `60000` | TTL in-memory кэша для `syntx.llm.listModels()`. |
| `MCP_TRANSPORT` | `stdio` \| `http` | `stdio` | Транспорт MCP-сервера. |
| `MCP_HTTP_PORT` | number | `3000` | Порт HTTP-транспорта. |
| `MCP_HTTP_HOSTNAME` | string | `127.0.0.1` | Адрес привязки HTTP-транспорта (loopback по умолчанию). |
| `MCP_HTTP_TOKEN` | string | — | Bearer-токен для самого MCP-сервера (HTTP-транспорт). Если задан — запросы без совпадающего заголовка `Authorization: Bearer` отклоняются (401, timing-safe сравнение). Если не задан — loopback-only + предупреждение. |

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
# MCP endpoint:  http://127.0.0.1:8080/mcp
# Health check:  http://127.0.0.1:8080/health
```

**Безопасность HTTP-транспорта:**
- **Host/Origin allow-list** включён всегда (защита от DNS-rebinding): запросы с `Host`/`Origin`, не входящим в `{127.0.0.1, localhost, ::1, <bind-host>}`, отклоняются (403).
- **Bearer-аутентификация** (`MCP_HTTP_TOKEN`): если задан, каждый запрос `/mcp` должен нести заголовок `Authorization: Bearer <MCP_HTTP_TOKEN>` (timing-safe сравнение, схема регистронезависима). Иначе — 401.
- `OPTIONS` (CORS preflight) отвечает `200` без проверки токена; wildcard `Access-Control-Allow-Origin` не выдаётся.
- Если `MCP_HTTP_TOKEN` не задан — сервер работает только на loopback и печатает предупреждение. **Не выставляйте HTTP-транспорт в публичные сети без `MCP_HTTP_TOKEN` и файрвола.**

```bash
MCP_HTTP_TOKEN="your-mcp-secret" npx syntx-ai-mcp --transport http --http-port 8080
```

```json
{
  "mcpServers": {
    "syntx-ai": {
      "url": "http://127.0.0.1:8080/mcp",
      "headers": { "Authorization": "Bearer your-mcp-secret" }
    }
  }
}
```

---

## Инструменты (Tools)

Все 38 инструментов принимают JSON-аргументы и возвращают структурированный результат. Текстовые ответы — это JSON-снимки данных API; ошибки возвращаются с `isError: true` (без обрыва канала).

### Идентификация и токен

| Инструмент | Описание | Параметры |
|---|---|---|
| `whoami` | Идентификационная *проверка*: `{ authenticated, user }`. **Никогда не возвращает ошибку** при отсутствии/невалидности (401/403) токена — сообщает `authenticated: false`. Реальные сбои (сеть, 5xx) всё же дают `isError`. | — |
| `get-profile` | Полный профиль пользователя; при отсутствии токена возвращает понятную MCP-ошибку. | — |
| `set-token` | Установить/заменить токен в рантайме (только в памяти — не переживает рестарт). | `token`* |

> `whoami` и `get-profile` различаются **семантикой ошибок**, а не составом полей (оба берут данные из одного `user.me()`). Используйте `whoami` для проверки статуса аутентификации без риска получить ошибку, `get-profile` — когда нужен полный профиль и готов обработать ошибку при отсутствии токена.

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
| `rename-chat` | Переименовать чат (`PUT /api/v1/chats/{chat_id}`) | `chat_id`*, `title`* |
| `chat-exists` | Pre-flight проверка: существует ли чат (`GET /api/v1/chats/{chat_id}`; 404 → `false`) | `chat_id`* |
| `get-messages` | История сообщений чата | `chat_id`*, `page_size?`, `direction?` |
| `get-inprogress` | Активные генерации чата (пустой массив — ничего не генерируется) | `chat_id`* |
| `get-favorite-messages` | Избранные (звёздные) сообщения чата — `get-messages` их не включает | `chat_id`*, `page_size?`, `direction?` |
| `send-message` | Отправить промпт с опциональными вложениями, вернуть ack (ответ — асинхронно) | `chat_id`*, `prompt`*, `ai_name?`, `model_type?`, `attachments?` |
| `wait-for-response` | Дождаться завершения генерации и вернуть текст + media-объекты | `chat_id`*, `timeout?`, `poll_interval?` |
| `ask` ⭐ | One-shot: создать чат → отправить → дождаться ответа | `prompt`*, `title?`, `ai_name?`, `model_type?`, `scope?`, `timeout?`, `poll_interval?`, `mode?` |
| `stream-message` 🌊 | One-shot со стримингом ответа по SSE (`sse.syntx.ai`) + `notifications/progress` | `prompt`*, `scope?`, `model?`, `ai_name?`, `model_type?`, `timeout?`, `mode?` |
| `cancel-message` | Отменить in-flight генерацию сообщения | `chat_id`*, `message_id`* |
| `delete-message` | Удалить отдельное сообщение (`DELETE /api/v1/chats/messages/{message_id}` — без chat id в пути); деструктивно | `message_id`* |
| `delete-chat` | Удалить чат без возможности восстановления (`DELETE /api/v1/chats/{chat_id}`); деструктивно | `chat_id`* |
| `toggle-chat-favorite` | Переключить флаг «избранное» чата: каждый вызов инвертирует состояние; проверить через `list-chats` | `chat_id`* |
| `toggle-message-favorite` | Переключить флаг «избранное» сообщения: каждый вызов инвертирует состояние; читать через `get-favorite-messages` | `chat_id`*, `message_id`* |
| `get-llm-limits` | Текущие LLM-лимиты (окна 6h / 7d) | — |

> ⭐ **`ask`** — главный инструмент для stateless Q&A. Возвращает `chat_uuid` для последующих уточнений через `send-message` + `wait-for-response`.
>
> 🌊 **`stream-message`** для text-scope открывает SSE-соединение на `sse.syntx.ai` и доставляет токены по мере поступления; при сбое транспорта автоматически переключается на REST-поллинг. Прогресс отправляется через MCP-нотификации (`notifications/progress` + `notifications/message`); финальный результат содержит полный текст и метаданные (`chat_uuid`, `elapsed_ms`, `chunks`).

**`ask` vs `stream-message` vs низкоуровневый flow:**

| Подход | Инструменты | Когда использовать |
|---|---|---|
| Быстрый вопрос (блокирующий) | `ask` | Обычный пользовательский запрос; поддерживает `mode: auto\|stream\|poll\|off` |
| Стриминг ответа | `stream-message` | Длинные ответы, UX с прогрессом; режимы `auto\|stream\|poll` (**`off` не поддерживается**) |
| Полный контроль | `create-chat` → `send-message` → `wait-for-response` → `get-messages` | Многошаговый диалог, кастомная логика |

Стратегией управляет `SYNTX_STREAM_MODE`. **Важно:** значение `off` влияет только на `ask` (fire-and-forget: создать чат, отправить промпт, сразу вернуть `chat_uuid`). У `stream-message` нет режима `off`.

**Как `wait-for-response` определяет «готово»:** инструмент резолвится, когда **все** объекты `message_object[i].completed === true`. Это включает ответы, состоящие только из `image` / `video` / `audio` / `file` — раньше такие генерации зависали до таймаута, потому что проверка требовала непустой `object_text` на объекте `[0]`. URL медиа-объектов возвращаются в блоке `media` (JSON) между текстом и метаданными; `metadata` с сервера пробрасывается как есть (без парсинга). Серверного `cancel`-эндпоинта нет — клиентский `AbortSignal` останавливает только локальный цикл опроса.

**Пример вызова `ask`:**

```json
{
  "name": "ask",
  "arguments": {
    "prompt": "Объясни квантовую запутанность простыми словами",
    "ai_name": "chatgpt",
    "model_type": "gpt-5-mini-2025-08-07"
  }
}
```

> Идентификаторы моделей зависят от провайдера и могут меняться. Получите актуальный список через инструмент `list-models` (например, `list-models` с `scope: "text"` и `ai_name: "chatgpt"`).

**Пример вызова с явной моделью:**

```json
{ "name": "ask", "arguments": { "prompt": "Привет!", "ai_name": "chatgpt", "model_type": "gpt-5.5" } }
```

Явный `model_type` переопределяет умолчания `SYNTX_DEFAULT_AI` / `SYNTX_DEFAULT_MODEL`; актуальные идентификаторы моделей получайте через `list-models`.

### Генерация медиа

| Инструмент | Описание | Параметры |
|---|---|---|
| `generate-image` | Генерация изображений через design-сервис | `chat_uuid`*, `prompt`*, `ai_name?`, `n?`, `model_type?`, `resolution?`, `quality?`, `image_url?` |
| `generate-video` | Генерация видео (`wan_video`, `runway`, `kling`…) — долгая операция, ждите через `wait-for-response` | `chat_id`* (не `chat_uuid`!), `prompt`*, `ai_name?`, `model_type?`, `duration?`, `resolution?`, `aspect_ratio?`, `fps?`, `quality?`, `seed?`, `file_urls?`, `audio_url?` |

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
> Результат — JSON-метаданные генерации, которые возвращает design-сервис syntx.ai (состав полей зависит от сервиса; обычно содержит ссылки на сгенерированные изображения и метаданные запроса).

### Аудио

| Инструмент | Описание | Параметры |
|---|---|---|
| `transcribe` | Транскрипция аудио в текст (`POST /api/v1/audio/transcribe`). Возвращает `{ text }`. | `path` или `content_base64`*, `filename?`, `mime_type?` |
| `generate-audio` | TTS / voice-change / генерация музыки (`elevenlabs`, `suno-music`…) | `chat_uuid`*, `prompt`*, `ai_name?`, `voice_id?`, `model_type?`, `style_prompt?`, `duration?`, `sample_rate?`, `file_urls?` |

Один файл передаётся либо как `path` (путь на ФС сервера; **только stdio-транспорт**), либо как `content_base64` с обязательным `filename`.

> ⚠️ **Безопасность:** при HTTP-транспорте `path` **отклоняется** (произвольное чтение файлов сервера удалённым клиентом) — используйте `content_base64`. Лимит 50 МБ (на декодированный файл), форматы: mp3, wav, mpeg.

```json
{
  "name": "transcribe",
  "arguments": {
    "content_base64": "data:audio/mpeg;base64,//uQxAAAAA...",
    "filename": "meeting.mp3"
  }
}
```

### Аккаунт пользователя

| Инструмент | Описание |
|---|---|
| `get-profile` | Профиль (имя, email, аватар, auth-сервисы) |
| `get-balance` | Баланс токенов |

### Файлы

| Инструмент | Описание | Параметры |
|---|---|---|
| `list-uploaded-files` | Список загруженных файлов | `scope?`, `page?`, `page_size?` |
| `upload-files` | Загрузить до 10 файлов (≤ 100 МБ каждый) | `files`*, `check_duplicates?` |
| `delete-file` | Удалить файл | `file_id`* |

Каждый элемент массива `files` в `upload-files` принимает **одно из двух**:

- `{ path }` — путь к файлу на машине, где запущен MCP-сервер (stdio/HTTP-сервер должен иметь доступ к ФС).
- `{ content_base64, filename }` — base64-payload (можно с префиксом `data:<mime>;base64,`). `filename` обязателен, `mime_type` опционален и подбирается по расширению.

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

Чтобы прикрепить загруженный файл к сообщению, передайте поля из ответа `upload-files` в `attachments`:

```json
{
  "name": "send-message",
  "arguments": {
    "chat_id": "<chat-uuid>",
    "prompt": "Опиши изображение",
    "model_type": "<model-id>",
    "attachments": [
      {
        "url": "https://r2.syntx.ai/.../pixel.png",
        "filename": "pixel.png",
        "mime_type": "image/png"
      }
    ]
  }
}
```

`send-message` преобразует MIME-тип в категорию syntx.ai (`image`, `video`, `audio` или `file`). Категорию можно задать явно полем `type`.

### Проекты (папки)

| Инструмент | Описание | Параметры |
|---|---|---|
| `list-projects` | Список проектов для scope (`GET /api/v1/folders/{scope}/list`) | `scope?` (`text` по умолчанию; `text` / `image` / `video` / `audio`) |
| `create-project` | Создать проект (a.k.a. папку) на syntx.ai; опционально сразу добавить чаты. | `title`*, `scope?` (`text` по умолчанию), `color?` (`#9C9C9C` по умолчанию), `chat_uuids?` |
| `add-chats-to-project` | Добавить один или несколько существующих чатов в проект (`POST /api/v1/folders/{folder_uuid}/add`). | `folder_uuid`*, `chat_uuids`* (≥ 1, `uniqueItems`) |
| `remove-chats-from-project` | Убрать чаты из проекта (`POST /api/v1/folders/{folder_uuid}/remove`, bare-массив UUID). | `folder_uuid`*, `chat_uuids`* (≥ 1, `uniqueItems`) |
| `update-project` | Изменить название и/или цвет проекта (`PATCH /api/v1/folders/{folder_uuid}/change`); отправляются только указанные поля. | `folder_uuid`*, `title?`, `color?` (хотя бы один) |
| `reorder-project` | Изменить порядок проекта (`PATCH /api/v1/folders/{folder_uuid}/move`); `after_uuid` опущен или `null` — переместить наверх. | `folder_uuid`*, `after_uuid?` |
| `delete-project` | Удалить проект без возможности восстановления (`DELETE /api/v1/folders/{folder_uuid}/delete`). | `folder_uuid`* |

> Серверная терминология — `folders`. В продукте это «проекты», в SDK — `syntx.folders.create` / `syntx.folders.addChats`.

Пример:

```json
{
  "name": "create-project",
  "arguments": {
    "title": "Refactor plan",
    "scope": "text",
    "color": "#FFAA00",
    "chat_uuids": ["47c2c3c5-f987-451e-9459-1ed4aaf45395"]
  }
}
```

```json
{
  "name": "add-chats-to-project",
  "arguments": {
    "folder_uuid": "475d21a2-221e-4f4e-83bf-16066ba33c4f",
    "chat_uuids": ["1cc76ce8-444b-4358-9ff5-dc77c01fb4fb"]
  }
}
```

---

## Безопасность

- **Токен syntx.ai (`SYNTX_TOKEN` / `set-token` / Telegram-flow) хранится только в памяти** — не пишется на диск, не переживает рестарт процесса, не логируется сервером. При `set-token` токен проходит через JSON-RPC-канал (по сети при HTTP-транспорте) — учитывайте логи вашего MCP-клиента.
- **HTTP-транспорт** по умолчанию слушает только `127.0.0.1` и **не имеет аутентификации**, пока не задан `MCP_HTTP_TOKEN`. Защита от DNS-rebinding обеспечивается Host/Origin allow-list (всегда включён). Для запуска вне loopback **обязательно** задайте `MCP_HTTP_TOKEN` и оградите порт файрволом/реверс-прокси.
- **Stateless HTTP = single-user loopback.** `set-token` меняет токен для всего процесса, поэтому HTTP-транспорт не предназначен для многопользовательского использования — один клиент установит токен, общий для всех.
- **`transcribe` с `path`** разрешён только при stdio-транспорте; при HTTP отклоняется (защита от произвольного чтения файлов сервера — LFI).
- Не передавайте `MCP_HTTP_TOKEN` в query-параметрах URL — только в заголовке `Authorization`.

---

## Troubleshooting

| Симптом | Вероятная причина | Решение |
|---|---|---|
| MCP-клиент не видит инструменты | Неверный путь к команде / Node.js < 18 | Проверьте путь, версию Node, логи клиента |
| `Authentication required or invalid` | Не задан/истёк токен | `set-token` или `SYNTX_TOKEN`; проверьте через `whoami` |
| HTTP `/mcp` возвращает 401 | Отсутствует/неверен `Authorization: Bearer` | Задайте `MCP_HTTP_TOKEN` и передавайте заголовок клиентом |
| HTTP `/mcp` возвращает 403 | `Host`/`Origin` не в allow-list | Используйте `127.0.0.1`/`localhost` либо `MCP_HTTP_HOSTNAME`, совпадающий с Host |
| Стриминг не приходит | `SYNTX_STREAM_MODE=off` или клиент не поддерживает progress | Проверьте `SYNTX_STREAM_MODE`; `off` отключает ожидание только у `ask` |
| Запрос долго висит | Малый `SYNTX_POLL_TIMEOUT` / большой `SYNTX_TIMEOUT` | Настройте таймауты под задачу |
| Модель не найдена | Неверный `model_type` | Вызовите `list-models` и передайте актуальный `model_type` в `ask` / `send-message` |
| `transcribe` отклоняет `path` | Используется HTTP-транспорт | Передайте аудио через `content_base64` |

---

## Получение токена

MCP-инструменты авторизации (Telegram / e-mail OTP) удалены при сокращении поверхности в v0.3.0. Токен устанавливается одним из способов:

- **Переменная окружения** `SYNTX_TOKEN` при запуске MCP-сервера.
- **Инструмент `set-token`** — задать/заменить JWT в рантайме (хранится только в памяти, не переживает рестарт).
- Проверка статуса — `whoami` (никогда не падает) или `get-profile`.

Сам JWT выдаёт платформа: войдите на syntx.ai и скопируйте токен из настроек профиля.

**Через SDK** доступны полноценные программные флоу авторизации — они не зависят от MCP-инструментов:

```ts
import { SyntxClient } from 'syntx-ai-mcp';

const syntx = new SyntxClient();

// Telegram device flow
const { token } = await syntx.auth.loginWithTelegram({
  onLink: (deepLink) => console.log('Откройте:', deepLink),
});

// Либо e-mail OTP
const { token: jwt } = await syntx.auth.loginWithEmail('user@example.com', {
  otpProvider: async () => askUserForOtp(),
});
```

> **Где живёт токен:** JWT хранится только в памяти процесса. После рестарта MCP-сервера задайте его заново (`SYNTX_TOKEN` или `set-token`). Не передавайте токены в query-параметрах — только в `Authorization: Bearer`. Полный список методов SDK: `syntx.auth.startAuth` / `pollAuthToken` / `sendEmailOtp` / `verifyEmailOtp` / `loginWithEmail` / `loginWithTelegram`.

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
  { object_type: 'text', object_url: null, object_text: 'Привет!', model_type: 'your-model-id' },
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
| `syntx.auth` | `setToken`, `getToken`, `isAuthenticated`, `validateToken`, `logout`, `sendEmailOtp`, `verifyEmailOtp`, `loginWithEmail` |
| `syntx.ai` | `listServices`, `listModels`, `getModelInfo` |
| `syntx.user` | `me`, `getBalance`, `getSubscription`, `getSettings` |
| `syntx.chats` | `list`, `create`, `getMessages`, `sendMessage`, `waitForResponse`, `pollForResponse`, `streamResponse`, `cancelMessage`, `generateTitle`, `delete`, `pin`, `moveToFolder`, `uploadFiles`, `getUploadedFiles`, `deleteFile`, `transcribe` |
| `syntx.llm` | `getLimits`, `generate`, `listModels`, `getChatStream`, `waitForResponse` |
| `syntx.design` | `generate` |
| `syntx.audio` | `listVoiceExamples` |
| `syntx.plans` | `list`, `getPromoBanners` |
| `syntx.folders` / `syntx.settings` | список папок по scope, `create({title, scope?, color?, chat_uuids?})`, `addChats(folderUuid, chatUuids)`, `delete(folderUuid)`, настройки приложения |

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

### Text-flow transport (`llm/*`)

`0.4.0` подключает SDK к новым v1-эндпоинтам `llm/*` и SSE-инфраструктуре `sse.syntx.ai`, которые уже использует прод-SPA. Это основной путь для text-scope чатов:

```
MCP-клиент
   │ ask / stream-message / send-message / wait-for-response
   ▼
mcp/tools/chats.ts
   │ routeTextFlow() = scope==='text' && !legacyTextTransport
   ▼
LlmResource
   │ generate → POST /api/v1/llm/generate
   │ getChatStream → GET  /api/v1/llm/chats/{id}/stream
   │ waitForResponse → openSse(...)  ──► https://sse.syntx.ai/...
   │              └ on error/timeout → chats.pollForResponse() (fallback)
```

SSE — primary transport. На сбое соединения, не-2xx от `llm/chats/{id}/stream`, истечении `sseTimeoutMs` (по умолчанию 60% от `pollTimeout`) или `event: error` SDK автоматически переключается на REST-поллинг через `chats.pollForResponse` и возвращает результат как обычно. Для пользователя разницы нет.

Откат на старый путь (`POST /chats/{id}/messages` + REST-поллинг, поведение `0.3.0`):

```bash
SYNTX_LEGACY_TEXT_TRANSPORT=true npx syntx-mcp
```

Полезно, если в вашей среде `sse.syntx.ai` недоступен, и нужно быстро вернуть работоспособность. Для image/video/audio скоупов флаг не действует — эти пути по-прежнему идут через `chats/{id}/messages`.

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

Детально — в [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Agent skills (каталог `skills/`).** В корне репозитория также живут [Anthropic-совместимые](https://agentskills.io/specification) skills для AI-агентов, использующих MCP: каждый skill — это папка `skills/<name>/SKILL.md` (≤ 500 строк) с YAML-frontmatter (`name`, `description`, `license`, `compatibility`, `metadata`), необязательными `references/` и `assets/`. Skill публикуется в git вместе с кодом; на машине пользователя Kilo подхватывает его после копирования в `~/.config/kilo/skills/`. Версия `metadata.version` синхронизируется с `package.json:version`.

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

- [x] Транскрипция аудио как инструмент (`transcribe`)
- [x] Загрузка файлов (`upload-files`) с поддержкой бинарных данных в MCP
  - [x] Стриминг ответов через WebSocket (см. `stream-message`, `chats.streamResponse`, `SYNTX_STREAM_MODE`)
  - [x] CI: GitHub Actions (`npm run typecheck && npm run build` на Node 18/20/22)
  - [x] Аутентифицированный HTTP-транспорт (`MCP_HTTP_TOKEN` + Host/Origin allow-list)
  - [ ] OAuth-flow для получения токена из CLI
  - [ ] Юнит-тесты (Vitest)

---

## Сопутствующие документы

- [CHANGELOG.md](CHANGELOG.md) — история релизов.
- [CONTRIBUTING.md](CONTRIBUTING.md) — правила участия, стиль кода, советы по PR.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — послойное описание архитектуры.
- [`skills/`](skills/) — Anthropic-совместимые agent skills. В [`skills/syntx-ai-mcp-usage/SKILL.md`](skills/syntx-ai-mcp-usage/SKILL.md) — операционные знания для агентов, вызывающих `syntx-ai-mcp_*` инструменты (lifecycle чатов, выбор модели, recovery после timeout, security caveats).

---

## Лицензия

[MIT](LICENSE)
