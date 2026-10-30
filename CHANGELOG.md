# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-10-30

### Added

- **New SDK resource `syntx.agents` — the `agents/*` surface.** The namespace
  was already catalogued on 2026-10-13 but explicitly deferred ("large
  subsystem, separate decision"); this cycle implements it. Source: the
  prod-SPA bundle `1793202992` (Pinia store `ai-agent`, chunk
  `FavoriteMessagesButton.js`), re-verified against the live API. Eight REST
  methods:
  - `agents.list()` → `GET /api/v1/agents/list` —
    `{agents: [{name, description, agent_id, editable, status, processing_progress?}], agent_limit, agent_count, can_create_more}`.
    The list mixes the caller's own agents with platform agents shared
    across accounts (`editable: false`).
  - `agents.get(agentId)` → `GET /api/v1/agents/info/{agent_id}` — the full
    record (`system_prompt`, `style_prompt`, `model_name`, `is_ready`,
    `use_chat_history`, `enabled_tools`, `default_models`, `files[]`).
  - `agents.create(params)` → `POST /api/v1/agents/create`
    (`multipart/form-data`). Nested objects (`enabled_tools`,
    `default_models`) are JSON-stringified inside the multipart body,
    matching the prod-SPA's `FormData` assembly.
  - `agents.update(id, params)` → `PUT /api/v1/agents/update/{id}` — the
    path segment is the agent's **numeric** `id`, not its UUID; `id` is
    included in the body the way the SPA sends the whole record back.
  - `agents.delete(agentId)` → `DELETE /api/v1/agents/{agent_id}`.
  - `agents.listFiles(agentId)` → `GET /api/v1/agents/files/list/{agent_id}`.
  - `agents.addFiles(agentId, files)` → `POST /api/v1/agents/files/add/{agent_id}`
    (`multipart/form-data`, repeated `files` field).
  - `agents.deleteFiles(agentId, fileIds)` →
    `DELETE /api/v1/agents/files/delete/{agent_id}` with `{file_ids: [...]}`.
  - The agents **chat** runs over a WebSocket (`agents/chat/{agent_id}`).
    This SDK does not implement it — WebSocket support was removed in
    `4c01027` and the SSE transport is the supported path.
- **New MCP tools `list-agents`, `get-agent`, `create-agent`,
  `update-agent`, `delete-agent`, `list-agent-files`, `add-agent-files`,
  `delete-agent-files`** — the `agents/*` surface. `add-agent-files` reuses
  the `upload-files` path-input policy, so `path` is rejected over the HTTP
  transport. Tool count: 49 → 58.
- **Tool arguments are now validated against the tool's JSON Schema at the
  server's single `call-tool` entry point (ajv).** Every tool advertised a
  schema with `enum`, `required` and `additionalProperties: false`, but the
  server passed `arguments` straight to the handler — those constraints
  were advisory only. A client could send `source: "bogus"` to `list-models`
  and the handler silently fell back to the default catalog, or pass a
  misspelled argument that was ignored without a word. Validation now
  rejects the call before the handler runs and names every violation:
  `list-models: invalid arguments:` / `  - "source": must be one of: "ai",
  "llm", "both"`. Types are never coerced and schema `default`s are not
  applied — a wrong type is an error the caller can correct, not a value
  the server guesses at. New public export `validateToolArgs(name, schema,
  args)` for SDK consumers that invoke an exported tool handler directly.
  `ajv` is now a direct dependency of the package.
- **New SDK method `syntx.llm.getResetPrice()`** →
  `GET /api/v1/llm/limits/reset/price`. Returns the quote for resetting the
  LLM usage windows: each window reports `available`, `price_tokens`
  (`null` when the window cannot be reset), `used_percent` and `reason`.
  Read-only — the matching `POST /api/v1/llm/limits/reset/purchase` spends
  tokens and is **not** exposed. New MCP tool `get-llm-reset-price`.

- **Captcha support for the gated generative routes.** syntx.ai now answers
  challenge-free requests to `llm/generate`, `design/generate`,
  `video/generate`, `audio/generate` and `auth/email/send-otp` with **403**.
  - `SyntxClientConfig.captchaProvider` / `BaseClient` — a
    `CaptchaTokenProvider` seam. The SDK asks it for a Turnstile token and
    attaches `X-Captcha-Token`; on an interactive challenge it replays once
    with `X-Captcha-Widget: interactive`. Replay is bounded to a single
    attempt, mirroring the SPA's `__captchaRetried` guard.
  - `captchaActionFor(path)` — the gate table, mirrored verbatim from the
    prod-SPA request interceptor (bundle `1791811899`). Exported so callers
    can pre-mint a token before they need one.
  - `McpServerConfig.captchaToken` / `SYNTX_CAPTCHA_TOKEN` — pre-minted token
    for headless MCP deployments. Turnstile tokens are single-use and
    short-lived, so this covers a burst, not a permanent configuration.
  - **The SDK ships no solver.** It cannot render the widget, and standing up
    a headless browser inside an MCP server is an operator decision. With no
    provider configured the request goes out unaugmented and the 403
    surfaces as {@link SyntxCaptchaRequiredError}.
- New SDK resource `syntx.llm` exposing the `llm/*` text-flow namespace
  used by the prod-SPA bundle (`1789730449`):
  - `llm.getLimits()` → `GET /api/v1/llm/limits`. Returns `{ window_6h, window_7d }`,
    each normalised: `null`/`expires_at === null`/past → `{percent_left:100, started_at:null, expires_at:null}`.
  - `llm.generate({ prompt, aiName, modelType?, chatId?, attachments? })` →
    `POST /api/v1/llm/generate?ai_name=…`.
  - `llm.listModels({ enabled_only?, lang? })` →
    `GET /api/v1/llm/models`.
  - `llm.getChatStream(chatId)` →
    `GET /api/v1/llm/chats/{chatId}/stream`.
  - `llm.waitForResponse(chatId, { timeout?, signal?, sseTimeoutMs?, llmSseBaseUrl?, fallbackPoll? })`
    — SSE primary via the shared `sse.syntx.ai` transport; falls back to
    `chats.pollForResponse` on transport failure / timeout.
- New SDK method `syntx.chats.cancelMessage(chatId, messageId)` →
  `POST /api/v1/chats/{chatId}/messages/{messageId}/cancel`. 404 is
  treated as success (race with completion).
- New SDK chat-mutation methods (all shapes extracted from the prod-SPA
  bundle `1789730449`; response bodies unpinned → `unknown`):
  - `syntx.chats.rename(chatId, title)` → `PUT /api/v1/chats/{chatId}`,
    body `{title}`.
  - `syntx.chats.toggleFavorite(chatId)` → body-less
    `POST /api/v1/chats/{chatId}/favorite` — **toggle**, flips
    `chat.is_favorite` per call.
  - `syntx.chats.toggleMessageFavorite(chatId, messageId)` → body-less
    `POST /api/v1/chats/{chatId}/messages/{messageId}/favorite` —
    **toggle** of `message.is_favorite`.
  - `syntx.chats.deleteMessage(messageId)` →
    `DELETE /api/v1/chats/messages/{messageId}` (no chatId segment;
    404 propagates).
- New SDK folder methods (from the captured `ai-folders` Pinia store):
  - `syntx.folders.removeChats(folderUuid, chatUuids)` →
    `POST /api/v1/folders/{uuid}/remove`, bare JSON array body (inverse
    of `addChats`).
  - `syntx.folders.update(folderUuid, {title?, color?})` →
    `PATCH /api/v1/folders/{uuid}/change`; only provided keys serialized.
  - `syntx.folders.move(folderUuid, afterUuid | null)` →
    `PATCH /api/v1/folders/{uuid}/move`, body `{after_uuid}` (`null` =
    move to top).
- New `BaseClient.put(path, body?, params?)` — mirrors `patch` with
  `method: 'PUT'`.
- New MCP tools `get-llm-limits` — returns the SDK `LlmLimits` payload.
- New MCP tool `cancel-message` — wraps `syntx.chats.cancelMessage`.
- New MCP tools `rename-chat`, `delete-message` (destructive),
  `toggle-chat-favorite`, `toggle-message-favorite` — wrap the new
  chat-mutation SDK methods; toggle tools document flip semantics
  (verify via `list-chats` / `get-favorite-messages`).
- New MCP tools `remove-chats-from-project`, `update-project`,
  `reorder-project` — wrap the new folder SDK methods; named
  `reorder-` to avoid confusion with `add-chats-to-project` / chat
  moving. `reorder-project`'s schema tightened: `after_uuid` carries
  `minLength: 1` (empty strings are still rejected by the handler too).
- New `BaseClient.stream(path, init?)` — opens a `Response` without
  consuming the body. Used by the SSE transport; not retried.
- New minimal SSE client `src/transport/sse.ts` (`openSse({ url, headers, signal, onEvent })`)
  — WHATWG frame parser, multi-line `data:` join, `event: ping` no-op,
  abort-aware `close()`.
- New SDK method `syntx.auth.listIdentities()` → `GET /api/v1/auth/identities`.
  Returns a sanitised `{provider, email, username, linked_at}` projection
  — the per-provider breakdown that `get-profile` does not carry.
- New SDK method `syntx.auth.chatwootUnread()` → `GET /api/v1/chatwoot/unread`.
  Returns `{contact_found, has_unread}`. The `chatwoot_hmac` that gates the
  call server-side never reaches the SDK or the caller.
- New MCP tool `list-auth-identities` — wraps `syntx.auth.listIdentities()`.
- New MCP tool `get-chatwoot-unread` — wraps `syntx.auth.chatwootUnread()`.
- New SDK method `syntx.chats.getGeneratedFiles(scopes?, page?, pageSize?)`
  → `GET /api/v1/files/generated?scope[]=…`. Default scope covers image
  / video / audio to match the SPA. New MCP tool `list-generated-files`.
- New SDK method `syntx.user.getTokensHistory({ cursor?, page_size? })`
  → `GET /api/v1/user/tokens/history`. Cursor-paginated; `next_cursor` is
  `null` on the last page. New MCP tool `get-tokens-history`.
- New SDK method `syntx.plans.listTariffs(period)` →
  `GET /api/v1/plans/tariffs?period=monthly|annual`. New MCP tool
  `list-tariffs`. The server 422s on any other period value, so the
  enum is pinned in the SDK and the tool schema.
- New SDK method `syntx.tokensPricing.list()` →
  `GET /api/v1/tokens/pricing`. New MCP tool `list-token-pricing`.
- New SDK methods `syntx.trends.categories()` and `syntx.trends.tags()` →
  `GET /api/v1/trends/categories` and `…/trends/tags`. New MCP tools
  `list-trend-categories` and `list-trend-tags`.
- New SDK method `syntx.events.list(page, pageSize)` →
  `GET /api/v1/events`. New MCP tool `list-events`.
- New SDK resource `syntx.promptEnhancer` with three methods:
  - `getCost(modelType)` → `GET /api/v1/prompt-enhancer/cost?model_type=…`.
    422 / `model_not_enhanceable` for unsupported models.
  - `start({ prompt, model_type })` → `POST /api/v1/prompt-enhancer/enhance/start`.
    **Captcha-gated** (rule `^prompt-enhancer\/(enhance|generate)(\/start)?$`,
    action `generate`); without `SYNTX_CAPTCHA_TOKEN` (or a configured
    `captchaProvider`) the call 403s with `SyntxCaptchaRequiredError`.
  - `getTask(taskId)` → `GET /api/v1/prompt-enhancer/tasks/{id}`.
  - New MCP tools `get-prompt-enhancer-cost`, `start-prompt-enhancement`,
    `get-prompt-enhancement-task`.

### Changed

- **Text-scope chat tools (`ask`, `stream-message`, `send-message`,
  `wait-for-response`) now route through the new `llm/*` text-flow** —
  `llm.generate` for submission, `llm.waitForResponse` (SSE primary +
  polling fallback) for delivery. Non-text scopes (`image`/`video`/`audio`)
  continue to use the legacy `chats/{id}/messages` path.
- `BaseClient` adds `stream()` — the only HTTP method that does not
  consume the response body. All other methods are unchanged.
- New config keys (all with env-var equivalents):
  `llmSseBaseUrl` (default `https://sse.syntx.ai`),
  `legacyTextTransport` (default `false`),
  `listLlmModelsCacheMs` (default `60000`).
  Set `SYNTX_LEGACY_TEXT_TRANSPORT=true` to restore the v0.3.0 behaviour.

- **Shape drift — `GET /api/v1/llm/limits` now returns a top-level `plan`.**
  The live payload is `{plan, window_6h, window_7d}`; the SDK declared only
  the two windows, so the plan name was dropped. `LlmLimits` gained
  `plan: string | null` and `syntx.llm.getLimits()` forwards it.
- **Shape drift — `GET /api/v1/trends/categories` elements are
  `{id, slug, title}`.** The label key `name` is **gone** upstream — the SDK
  declared `name: string` as required, so the type was lying. `TrendCategory`
  now declares `id` and `title` as required and keeps `name` as an optional
  legacy alias (absent on the wire).
- **Shape drift — `GET /api/v1/promo_banners` has two distinct element
  shapes.** The `header` group is `{uuid, body, buttons[], open_in_new_tab,
  order, …}`; the `landing` group has no `body` and no `buttons[]` — its
  text is split across `primary_title` / `secondary_title` / `subtitle` /
  `feature` / `description` and the call-to-action is a single `button`
  object. `PromoBannersResponse` now types the two groups separately
  (`PromoHeaderBanner[]` / `PromoLandingBanner[]`). `PromoBanner` is kept as
  a deprecated alias and will be removed in the next minor version.
- **ENUM/RANGE drift — the provider → scope map behind `list-models` is now
  derived from the live catalog.** It used to be a frozen table
  (`KNOWN_PROVIDERS`) that had drifted in both directions: upstream added
  providers (`kimi`, `zai`, `grok_image`, `luma_image`, `wan_image`,
  `veo3`, `wan_video`, `video2audio`, `flux3_video`, …) and retired others
  (`stable-diffusion`, `recraft`, `kling-kolors`). Because an unknown
  provider resolved to `null`, a `scope` filter **silently dropped** every
  model the table did not know about — `list-models` with `scope=text`
  returned 42 models while the live catalog held 46 (the missing four were
  `kimi` ×2 and `zai` ×2). The map is now built from `GET /api/v1/ai` on
  demand, and the upstream `tool_*` scopes are folded into the coarse
  buckets (`tool_image_inpaint` → `image`, `tool_video_upscaler` →
  `upscale`, …). The `scope` enum itself is unchanged.
- **Two follow-up defects in `list-models`, both found while verifying the
  fix above and now closed.**
  - `search` matched only `value` / `label`, but the text scope is served
    from `GET /api/v1/llm/models`, whose rows carry `id` instead of
    `value`. A search by model id on `scope=text` therefore returned
    nothing (`search="claude-opus-5"` → 0 hits with the scope, 1 hit
    without). The filter now falls back to `id`.
  - The scope map joins two catalogs that disagree on spelling:
    `GET /api/v1/ai` reports `midjourney-editor` (hyphen) while
    `GET /api/v1/ai/models` reports `midjourney_editor` (underscore), so
    that provider was dropped from every scope bucket. Provider keys are
    now canonicalised (`_` → `-`) on both sides of the join.
- **`list-models` gained a `source` selector, and the two upstream model
  catalogs are now merged instead of being picked between.**
  `GET /api/v1/ai/models` (general, every media scope) and
  `GET /api/v1/llm/models` (text) are **not** in sync:
  - `gpt-6.1-sol` and `gpt-6.1-terra` exist **only** in the LLM catalog —
    `list-models` without `scope` never showed them.
  - `deepseek-r1`, `gemini-3.7-flash` and `grok-4.6` are enabled for text
    upstream but flagged inactive in the general catalog.
  - `source` accepts `"ai"` (the platform catalog), `"llm"` (the text
    catalog alone) or `"both"` (an explicit spelling of `"ai"`). The
    default is `"ai"`, which is the **merged** view — the general catalog
    union the text catalog (197 active models vs. 188 general / 46 text).
    `gpt-6.1-sol` and `gpt-6.1-terra` are therefore present in the general
    catalog view, and the text models that upstream flags inactive in the
    general catalog (`deepseek-r1`, `gemini-3.7-flash`, `grok-4.6`) are
    listed as available. Use `source: "llm"` for the text-only view the
    SPA's model picker uses.
  - New SDK exports `normalizeLlmModel(row)` and
    `mergeModelCatalogs(aiModels, llmModels)`; the merge keys on the model
    identifier, lets the LLM catalog decide availability for text models,
    and keeps the general catalog's upload metadata.

- **Breaking (type-only) — `LlmModel` now matches the wire.** The live
  `GET /api/v1/llm/models` row is keyed by `id` and uses `enabled`; it has
  no `value`, `active` or `scope` field, so the previous declaration made
  every consumer read `undefined`. `LlmModel.id` / `LlmModel.enabled` (plus
  `context_window`, `default_max_tokens`, `capabilities`,
  `supported_tools`, `min_subscription`, `performance_level`, `is_free`) are
  now declared. `AIModel` gained an optional `llm` field carrying the
  text-catalog row verbatim, so `list-models` returns one uniform shape:
  `value` is always the model identifier.

### Fixed

- **The enum-drift probe could not run.** `scripts/probe-enums.ts` expected
  `GET /api/v1/ai` and `GET /api/v1/ai/models` to return arrays of **strings**;
  the live API returns **objects** (`{value, label, scope, active, description}`
  / `{value, label, ai_name, settings, …}`) and
  `GET /api/v1/llm/models` returns a `{models, count}` envelope. The
  shape-guard therefore aborted with
  `GET /api/v1/ai: non-string element {"value":"topaz_astra",…}` and exited 1
  on every run, so the drift baseline could not be regenerated. The probe now
  parses the real shapes, derives `ai_services.by_scope` from the live `scope`
  field instead of a hand-curated partition (schema_version 2), and counts
  `ai_models_with_get_cost_params` over models whose `settings.get_cost_params`
  is a non-empty array.
- **The enum/shape baselines were stale.** `tests/fixtures/probe-enums.snapshot.json`
  was regenerated against the live API (services 44 → 45, ai models 215 → 226,
  llm models 43 → 46, models with cost params 103 → 111; the `upscale` scope was
  replaced upstream by `tool_image_upscaler` / `tool_video_upscaler`).
  `tests/fixtures/probe-shapes.snapshot.json` was corrected: `get-balance`
  returns `balance` / `user_id` (the baseline claimed `currency`), and
  `get-llm-limits` carries the new `plan` key. Entries were added for
  `list-agents`, `get-llm-reset-price`, `list-models` and
  `list-trend-categories`; `schema_version` is now 2.
- **Shape drift — `GET /api/v1/notification/unread/count` now returns
  `{ total: number }` (was declared as `{ count: number }` and was
  `undefined` at runtime).** The `UnreadCount` type and
  `syntx.notifications.getUnreadCount()` were aligned with the live
  wire shape as of 2026-10-13.
- **Shape drift — `GET /api/v1/folders/{scope}/list` now returns
  `{ folders: Folder[]; pagination: Pagination }` (was declared as
  `Folder[]`, which caused `list-projects` to surface the wrapper
  verbatim).** A new `FolderListResponse` envelope type was added and
  the four `list*Folders()` methods were retyped. The `Folder` element
  shape itself (`uuid` / `title` / `scope` / `color` / `sort_order` /
  `chat_count` / `chats` / `created_at` / `updated_at`) is now the
  authoritative SDK projection; the legacy `id` / `name` / `type` keys
  remain in the type as optional fallbacks for backward compat.
- **Shape drift — `GET /api/v1/promo_banners` now returns
  `{ header: PromoBanner[]; landing: PromoBanner[] }` (was declared as
  `PromoBanner[]`, dropping both groups).** A new `PromoBannersResponse`
  envelope type was added; `syntx.plans.getPromoBanners()` was retyped.
  The `PromoBanner` element shape was aligned with the live fields
  (`uuid` / `body` / `buttons[]` / `open_in_new_tab` / `order` /
  `start_date` / `end_date` / `updated_at`); the legacy `id` / `title` /
  `description` / `image_url` / `link` / `active` keys remain in the
  type as optional fallbacks.
- Internal refactor (no behavior change): shared `jsonOrAck` helper for
  mutation-tool acks and `BaseClient.jsonRequest` behind
  `post`/`patch`/`put`/`delete` — removes six duplicated if/return
  blocks and four near-identical HTTP-verb methods.
- README / SKILL.md resynced to the real 49-tool MCP surface: removed
  11 ghost tool rows (auth flows, `get-settings`, `set-default-model`,
  `set-default-ai`, `get-subscription`, `generate-title`), removed the
  stale Resources / Prompts sections and MCP auth walkthroughs
  (features deleted in 0.3.0; replaced with a short "Получение токена"
  section), added the missing tool rows across multiple passes. The
  `tests/tool-inventory.test.ts` test pins the count and keeps both
  docs in sync with `allTools`.

### Security

- **Fixed — captcha 403s were misreported as authentication failures.**
  `BaseClient.handleResponse` collapsed *every* 401 and 403 into
  `SyntxAuthError` without reading the body, so an upstream Turnstile
  challenge was indistinguishable from a dead token: the caller was told to
  re-authenticate when the actual fix was to supply a captcha token. 403
  responses are now read and discriminated — a structured `detail` carrying a
  sitekey/action raises the new `SyntxCaptchaRequiredError` (a
  `SyntxAPIError` subclass, so existing `catch` sites are unaffected) with
  `action`, `reason`, `sitekey`, `interactiveAction`, `interactiveSitekey`
  and a `retryable` flag. A genuine credential rejection — a bare string
  `detail`, or a 401 — still raises `SyntxAuthError`, deliberately.
- **Re-evaluated and shipped — `GET /api/v1/auth/identities`.** The 2026-10-13
  drift sweep had declined this endpoint pending a sanitisation decision.
  Re-walking the live response showed every field is already projected by
  `get-profile` (`email`, `username`) plus the per-provider `linked_at`
  timestamp. The SDK now exposes `syntx.auth.listIdentities()` (and the
  `list-auth-identities` MCP tool) and projects onto an explicit allowlist
  `{provider, email, username, linked_at}`. Any field whose name looks
  credential-shaped is dropped at the SDK boundary, so a future server-side
  addition can never leak through a tool surface without an explicit SDK
  update. Covered by `tests/auth-identities.test.ts`.
- **Re-evaluated and shipped — `GET /api/v1/chatwoot/unread`.** Same sweep
  had declined this on the suspicion that wrapping it would either leak
  `chatwoot_hmac` or make the SDK hold a credential. The endpoint is in fact
  gated *server-side* on `chatwoot_hmac`: the SDK never holds it, never
  forwards it, and the response is a flat `{contact_found, has_unread}` pair
  with no credential-shaped fields. The SDK now exposes
  `syntx.auth.chatwootUnread()` (and the `get-chatwoot-unread` MCP tool).
  The previously-pinning `tests/security-declined-endpoints.test.ts` has
  been removed; `tests/user-sanitize.test.ts` continues to pin
  `chatwoot_hmac` / `ym_client_id` stripping for `get-profile`.
- Pinned transitive dependencies via `package.json#overrides` to clear
  `npm audit --omit=dev --audit-level=high` (was 4 vulnerabilities, 2 high):
  - `fast-uri` `^3.1.8` (was 3.1.4 — host confusion / SSRF via URI parsing;
    pulled in by `ajv` used for tool-input JSON-Schema validation)
  - `hono` `^4.13.8` (was 4.12.30 — ReDoS / proxy-header leaks; pulled in
    by `@modelcontextprotocol/sdk` transport)
  - `ip-address` `^10.7.2` (was 10.2.0 — SSRF via IPv4/IPv6 misclassification;
    pulled in via `express-rate-limit` from MCP SDK OAuth handlers — those
    handlers are not wired by syntx-ai-mcp, so this was not reachable at
    runtime, but the override keeps the audit clean and the lockfile honest)
  - `qs` `^6.16.0` (was 6.15.3 — array-limit bypass; same dead-path origin)

## [0.3.0] - Unreleased

### Changed

- **Breaking — MCP surface reduction (51 → 28 tools, ≈45%).** The MCP layer
  is now focused on the conversational core plus project (folder) management.
  Twenty-three tools have been removed and the rest are unchanged in
  behaviour. See "Removed" below for the full list.
- **Breaking — `./mcp` subpath export now resolves.** `dist/mcp/server.{js,mjs,d.ts}`
  is now produced by the build (previously the export pointed at a non-existent
  path). Consumers can `import 'syntx-ai-mcp/mcp'` to get `createMcpServer`.
- **Breaking — `McpContext` narrowed.** `setDefaultModel` and `setDefaultAI`
  have been removed (their only callers were the deleted `set-default-model`
  / `set-default-ai` tools). External consumers implementing `McpContext`
  manually will see TypeScript errors. `sendLog` is **retained** — it is
  used by `stream-message` for per-chunk `notifications/message` frames
  (`chats.ts:streamAsk.onChunk`).
- **Breaking — `SyntxToolCapability` narrowed.** `networkCall`,
  `externalExfiltration`, `costSideEffect`, and `authMutation` have been
  removed; only `localFileRead` remains. Of those four, **none were ever
  enforced at runtime** — the previous metadata was documentation-only. The
  one enforced capability (`localFileRead`) continues to gate `path`-bearing
  tool calls over non-`stdio` transports (I3 in `server.ts`).
- **Breaking — all MCP resources and prompts removed.** The 6 static
  resources (`syntx://models`, `syntx://ai-services`, `syntx://plans`,
  `syntx://settings`, `syntx://user/me`, `syntx://user/balance`), the one
  resource template (`syntx://chat/{uuid}/messages`), and the 4 prompts
  (`generate-landing`, `summarize-chat`, `translate`, `code-review`) have
  been removed. ReDoS-hardened `matchTemplate` (the resource-template URI
  matcher) was removed alongside them.
- **New `src/mcp/tools/_helpers.ts` — `wrapSdk`.** A two-level abstraction
  applied to the 16 pure CRUD tools (`list-chats`, `create-chat`,
  `get-messages`, `get-inprogress`, `get-favorite-messages`,
  `list-uploaded-files`, `delete-file`, `get-profile` stays manual due to
  pre-checks, `get-balance`, `list-ai-services`, `list-models`,
  `get-model-info`, `list-projects`, `create-project` and `delete-project`
  stay manual due to pre-checks, `add-chats-to-project` stays manual due to
  pre-checks). Streaming (`send-message`, `wait-for-response`, `ask`,
  `stream-message`) and media (`upload-files`, `transcribe`,
  `generate-audio`, `generate-video`, `generate-image`) tools remain as
  manual handlers because they consume `ctx.sendProgress` / `ctx.sendLog`
  inside callbacks or return non-JSON content.
- **`model-scope.ts` inlined into `ai.ts`.** `KNOWN_PROVIDERS`, `inferScope`,
  and `filterModels` are now private to `ai.ts`; the file was deleted.
  Behaviour unchanged.
- `auth.ts` (493 → ~190 LOC): only `whoami` and `set-token` remain; the
  `assertLocalAuthMutationAllowed` H4 transport guard is retained.
  `validate-token`, `start-telegram-auth`, `poll-telegram-auth`,
  `login-telegram`, `send-email-otp`, `verify-email-otp` have been removed.

### Removed

- **MCP tools:** `pin-chat`, `move-chat-to-project`, `generate-title`,
  `get-subscription`, `validate-token`, `start-telegram-auth`,
  `poll-telegram-auth`, `login-telegram`, `send-email-otp`,
  `verify-email-otp`, `get-settings`, `set-default-model`, `list-locales`,
  `set-default-ai`, `list-notifications`, `get-unread-notification-count`,
  `mark-notification-read`, `mark-all-notifications-read`, `list-plans`,
  `list-promo-banners`, `get-version`, `get-maintenance-status`,
  `list-voice-examples`.
- **Files:** `src/mcp/tools/{settings,notifications,plans,app,model-scope}.ts`,
  `src/mcp/resources/`, `src/mcp/prompts/`.
- **Exports:** `allResources`, `allResourceTemplates`, `allPrompts`, the
  `SyntxResource` / `SyntxResourceTemplate` / `SyntxPrompt` types, and
  `ServerCapabilities`.
- **Internal:** `matchTemplate` and its I2 ReDoS-hardening tests (the
  resources/templates feature was removed alongside).

### Security

- I3 enforcement surface (`localFileRead` path-rejection over non-`stdio`
  transports) is unchanged — `upload-files` and `transcribe` keep their
  `capability: { localFileRead: true }` declarations and the metadata-driven
  block in `server.ts`.
- H4 transport guard (`assertLocalAuthMutationAllowed`) is retained for
  `set-token` (stdio only); the removed login-flow tools no longer reach
  that helper.
- M2 request-scoped credential guard is unchanged — `setToken` on a
  context built with a `requestToken` still throws.

### Added

- `wrapSdk` regression test in `tests/wrap-sdk.test.ts`: locks in that the
  `SyntxTimeoutError.chatId` recovery hint survives the helper, so the
  `wait-for-response` / `ask` / `stream-message` flow can resume from
  interrupted generations without re-sending the prompt (avoiding duplicate
  token spend).

## [0.3.0] - Unreleased (prior entries)

### Added

- `upload-files` silently rewrites `.js`, `.css`, `.json`, `.py` to `.txt` on
  the storage layer (filename and URL extension; content bytes unchanged).
  Rationale: some downstream models (notably `gemini-3.5-flash`) gate content
  extraction on the URL's file extension and silently ignore `.js` attachments
  even when the upstream API request succeeded. The rewrite only touches the
  last extension (`app.min.js` → `app.min.txt`); other extensions are passed
  through verbatim. The rewritten URL is what `upload-files` returns.
- `send-message` now accepts uploaded files through `attachments` and sends the
  upstream `objects` payload expected by syntx.ai. Each attachment reuses the
  `url`, `filename`, and `mime_type` returned by `upload-files`; `type` can be
  supplied explicitly for `image`, `video`, or `audio`.

### Security
- **M2 — request-scoped credentials over HTTP.** `createMcpServer` /
  `createMcpContext` now accept an optional `requestToken`; the HTTP
  transport forwards the request's `Authorization: Bearer` credential to the
  MCP layer when the transport-level `MCP_HTTP_TOKEN` gate is not configured
  (credential-passthrough / multi-tenant mode). A request-scoped token is
  immutable: `setToken` on such a context throws. Token precedence:
  request header → runtime `set-token` (stdio only) → `SYNTX_TOKEN` env.
- **M3 — Google OAuth moved to Authorization Code + PKCE.**
  `getGoogleLoginUrl(clientId, redirectUri, { state?, codeChallenge? })`
  now emits `response_type=code` (Implicit Grant removed). New
  `SyntxAuth.generatePkcePair()` and `syntx.auth.exchangeGoogleCode(...)`
  helpers complete the flow. **Breaking** for the previous placeholder
  signature.
- **M5 — hard fail on unauthenticated non-loopback bind.** Starting the
  HTTP transport on a non-loopback address without `MCP_HTTP_TOKEN` now
  throws at startup instead of printing a warning.
- **M6 — SSE connection limits.** Standalone SSE (GET) streams are capped
  (`MCP_HTTP_MAX_SSE_CLIENTS`, default 100 → 429 beyond) and idle streams
  are reaped (`MCP_HTTP_SSE_IDLE_TIMEOUT_MS`, default 60 000 ms; `0`
  disables). Per-client queue bounding is implicit via TCP backpressure —
  the stateless transport keeps no server-side event queue.
- **I1 — transcribe MIME whitelist enforced.** The `transcribe` tool now
  rejects payloads whose resolved MIME type is not in
  `TRANSCRIBE_ACCEPTED_MIMES` (`audio/mpeg`, `audio/wav`, `audio/mp3`).
- **I2 — ReDoS-safe resource template matching.** `matchTemplate` escapes
  regex metacharacters in template literals and hard-caps URI (512) and
  template (256) lengths.
- **I3 — tool capability inventory.** `SyntxTool.capability` metadata
  (`localFileRead` / `authMutation` / `externalExfiltration` /
  `networkCall` / `costSideEffect`) is declared for every tool; the server
  generically rejects `path` arguments for `localFileRead` tools on
  non-stdio transports.
- **M4 — CI security gates.** New `security` job: `npm audit
  --omit=dev --audit-level=high`, `google/osv-scanner-action@v2`, and
  `gitleaks/gitleaks-action@v2`.
- **Polling / transport reliability (P0–P3).**
  - `pollForResponse` now emits an `onProgress(elapsed, total)` heartbeat
    on every tick; MCP tools forward it as `notifications/progress` so
    clients with `resetTimeoutOnProgress` survive long generations.
  - `WaitForResponseOptions.signal` (an `AbortSignal`) is honoured by the
    poll loop — when the MCP request is cancelled or the client
    disconnects, the wait rejects promptly with `SyntxAbortError` instead
    of polling until the timeout. `SyntxToolExtra` now exposes `signal`.
  - New exported error classes: `SyntxTimeoutError` (carrying `chatId`,
    `elapsedMs`, `timeoutMs` for self-service recovery) and
    `SyntxAbortError`. `toMcpError` renders a structured message with a
    recovery hint ("recover with `get-messages` / `wait-for-response`,
    do NOT re-send the prompt").
  - `BaseClient` now retries idempotent GET requests on 408/429/5xx and
    network failures with exponential backoff + jitter (base 500 ms, cap
    8 s, max 3 attempts). `Retry-After` is honoured for 429 **and** 5xx,
    clamped to 60 s so a malicious or buggy upstream cannot park the
    caller. `POST` / `PATCH` / `DELETE` are never auto-retried — re-sending
    a chat message would double the token spend. New `maxRetries` option
    on `SyntxClientConfig`.
  - New `BaseClient.postForm()` shared by `ChatsResource.uploadFiles`
    and `ChatsResource.transcribe`; uploads now route through the same
    timeout / auth / error-mapping pipeline (401 → `SyntxAuthError`,
    30 s → 5 min timeout override).

### Changed

- **Breaking:** `waitForResponse` / `pollForResponse` now resolve when **every**
  `message_object[i].completed === true` (was: `message_object[0].completed &&
  object_text non-empty`). Fixes the silent-hang on image / video / audio /
  file-only replies and the early-return on multi-object text+media replies.
  The return shape is now `{ text, media, message }` (was `{ text, message }):
  `text` concatenates `text` / `filetext` `object_text` values (separated by
  `\n\n` when more than one), `media` is the list of URL-bearing objects
  (`image` | `video` | `audio` | `file`) with `object_url` and `metadata`
  passed through verbatim, and `message` is the original wire `Message`.
  Migration: destructure `result.media` alongside `result.text`; an empty
  `text` plus a non-empty `media` is the normal "media-only reply" case.
  The MCP `wait-for-response` tool renders the new `media` block between the
  assistant text and the trailing `--- metadata ---` JSON block (existing
  downstream parsers that pattern-match the metadata block keep working).
- **Breaking:** `WaitForResponseOptions.pollInterval` is now an adaptive
  ceiling rather than a fixed inter-poll delay. The first tick fires
  near `0.4 × pollInterval` and backs off ×1.5 up to the configured
  value. Quick replies surface faster; long generations cost fewer
  requests. The option name and units are unchanged.
- **Breaking:** `pollForResponse` now uses a single wall-clock `timeout`
  budget shared by the in-progress pre-wait and the reply poll. Prior
  versions gave each phase its own budget (worst case ~2× `timeout`).
  Pre-existing callers who relied on the longer worst case should
  increase `timeout` accordingly.
- `toMcpError` timeout output text is now a structured string
  (`Timeout waiting for response in chat <id> (elapsed X ms of Y ms
  budget). The chat persists on the server — recover with
  get-messages(chat_id="<id>") … Do NOT re-send the prompt.`) — the
  original `Timeout waiting for response in chat <id>` prefix is
  preserved at the start. Any consumer pattern-matching the full
  string should switch to matching the prefix only.

## [Unreleased]

### Added
- **Project (folder) write APIs** mirroring the captured `requests.js`
  traffic:
  - SDK: `syntx.folders.create({ title, scope?, color?, chat_uuids? })`
    and `syntx.folders.addChats(folderUuid, chatUuids)` — typed returns,
    defaults match the web client (`text` / `#9C9C9C` / `[]`).
  - MCP tools: `create-project` and `add-chats-to-project`. The product UI
    calls these "projects"; the upstream API still uses `folders`, so the
    underlying endpoints stay `POST /api/v1/folders/create` and
    `POST /api/v1/folders/{folder_uuid}/add`.
  - SDK `syntx.folders.delete(folderUuid)` and MCP tool `delete-project`
    (`DELETE /api/v1/folders/{folder_uuid}/delete`). The action is
    destructive and cannot be undone — the tool description calls this out
    so the assistant prompts for confirmation before invoking it.
  - New exported types: `CreateFolderParams`, `CreatedFolder` from
    `src/resources/folders-settings.ts`.
  - README section "Проекты (папки)" + updated tools / SDK tables.
  - Architecture doc: `src/mcp/tools/folders.ts` listed alongside other tool
    modules.

### Security
- `requests.js` previously contained a real bearer token. The token has been
  redacted in the working tree (`Bearer <REDACTED>`); **rotate/revoke the
  credential externally** because the value remains recoverable from git
  history.

### Added (previous entry, still Unreleased)
- **Email-OTP authentication flow** mirroring the `requests.js` snapshot:
  - SDK: `syntx.auth.sendEmailOtp(email, opts?)`,
    `syntx.auth.verifyEmailOtp(email, otpCode, opts?)` (auto-installs the JWT),
    and a callback-driven `syntx.auth.loginWithEmail(email, opts?)`.
  - MCP tools: `send-email-otp` and `verify-email-otp` (mirrors the
    `start-telegram-auth` / `poll-telegram-auth` split; no one-shot equivalent
    because the OTP comes from the user's inbox, not a server-side session).
  - New types: `EmailOtpSendResult`, `EmailOtpVerifyResult`, `EmailOtpOptions`
    in `src/types.ts`.
  - README section "Авторизация через Email (OTP)" + updated tools / SDK
    tables.

### Changed (previous entry, still Unreleased)
- **Breaking:** `SyntxAuth.loginWithEmail(email, password)` (placeholder,
  pointed at a non-existent `/api/v1/auth/login`) was removed and replaced by
  the new `loginWithEmail(email, opts?)` whose signature is incompatible with
  the old one. No callers were found in-tree.

## [0.2.0] — 2026-07-17

### Added
- **`transcribe` MCP tool** (audio transcription) — wraps
  `POST /api/v1/audio/transcribe`. Accepts a single audio file as `path`
  (stdio only) or `content_base64`. 50 MB limit; accepted formats mp3/wav/mpeg.
  Tool count is now **25** (was 24 in code, README previously misstated 22/19).
- **Authenticated HTTP transport.** New `MCP_HTTP_TOKEN` env var: when set,
  MCP clients must present a matching `Authorization: Bearer` header
  (timing-safe compare). New `MCP_HTTP_HOSTNAME` env var controls the bind
  address (defaults to `127.0.0.1`). A Host/Origin allow-list is enforced on
  every request as a DNS-rebinding defense.
- `get-settings` and the `syntx://settings` resource now surface `httpHostname`
  and `httpAuthEnabled`.

### Changed
- **`whoami` vs `get-profile` are now differentiated by error semantics, not
  field set** (both still resolve from the same `user.me()` profile):
  - `whoami` returns `{ authenticated, user }` and never raises an MCP error on
    missing/invalid (401/403) tokens — it reports `authenticated: false`.
    Real failures (network, 5xx) still raise an MCP error.
  - `get-profile` returns the full profile and raises a clear MCP error when
    no token is set.
- HTTP `OPTIONS` requests are answered `200` without a bearer check (CORS
  preflight). No wildcard `Access-Control-Allow-Origin` is emitted.

### Security
- HTTP transport: Host/Origin allow-list (DNS-rebinding defense), timing-safe
  bearer compare, no `?token=` query fallback (secrets must not appear in URLs).
- `transcribe` `{path}` is rejected over the HTTP transport to prevent
  server-side file reads by remote clients (LFI).
- When `MCP_HTTP_TOKEN` is unset, the server prints a security warning; binding
  to a non-loopback address without a token is flagged as dangerous.

### Fixed
- Corrected the documented tool count (README previously stated 22 and 19; the
  code exposes 25 tools as of this release).

## [0.1.0] — 2025-01-XX

### Added
- First published version: MCP server + TypeScript SDK for syntx.ai.
  - 22 MCP tools covering identity, runtime settings, AI catalog,
    chats/messaging, image generation, account, and file management.
  - 6 resources + 1 resource template (models, plans, user, settings, …).
  - 4 prompt templates (`generate-landing`, `summarize-chat`, `translate`,
    `code-review`).
  - Dual stdio and HTTP/SSE transports.
  - Runtime settings tools: `get-settings`, `set-default-model`,
    `set-default-ai`. The default model and AI provider can now be changed
    via MCP without restarting the server.
  - `syntx://settings` resource now also surfaces the live MCP server
    configuration alongside the remote `AppSettings` payload.
  - `upload-files` tool for path- and base64-based file uploads.

[Unreleased]: https://github.com/ssm82/syntx-ai-mcp/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/ssm82/syntx-ai-mcp/releases/tag/v0.4.0
[0.2.0]: https://example.com/syntx-ai-mcp/releases/tag/v0.2.0
[0.1.0]: https://example.com/syntx-ai-mcp/releases/tag/v0.1.0
