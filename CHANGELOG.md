# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - Unreleased

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

[Unreleased]: https://example.com/syntx-ai-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://example.com/syntx-ai-mcp/releases/tag/v0.2.0
[0.1.0]: https://example.com/syntx-ai-mcp/releases/tag/v0.1.0
