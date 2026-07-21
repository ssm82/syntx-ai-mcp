# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
