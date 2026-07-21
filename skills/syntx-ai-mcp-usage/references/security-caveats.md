# Security Caveats

Transport-aware security audit summary for `syntx-ai-mcp` MCP server. The full audit, threat model, and remediation roadmap live in [`.kilo/plans/1784624085807-security-hardening-plan.md`](../../../.kilo/plans/1784624085807-security-hardening-plan.md) (a planning artifact in this repository — not shipped to npm, listed here as repo-relative path for traceability).

This reference is the consumer-facing summary: if you operate the MCP server (or build an agent that calls `syntx-ai-mcp_*` tools) you need the awareness below.

## Threat model recap

The MCP server accepts two transports:

| Transport | Trust boundary | Authentication |
|---|---|---|
| `stdio` | The MCP client process spawns the server; pid is shared. | `SYNTX_TOKEN` env or `set-token`. |
| `http` | Reachable over TCP; remote clients can connect from anywhere. | `SYNTX_TOKEN` (caller must set) **or** `MCP_HTTP_TOKEN` + Host/Origin allow-list. |

The default install is `stdio`. HTTP is opt-in via `--transport http`. Every caveat below assumes the server is reachable beyond the local process boundary.

## Five surfaces that require care

### 1. `upload-files` with `path` parameter — LFI

- **Where:** `src/mcp/tools/files.ts:95` (`upload-files` spec) → `src/mcp/tools/file-input.ts:67-95` (`resolveFileInput`).
- **Risk:** Over HTTP, the `path` parameter accepts any server-readable filesystem path. A malicious client can request `/etc/passwd` or `/proc/self/environ` and exfiltrate it as base64 content.
- **Current state:** Centralized path-resolution helper exists but lacks a transport guard. The plan (`H1`) adds an `assertPathSourceAllowed` gate mirroring `transcribe`.
- **Consumer mitigation (today):** Prefer `content_base64` with `filename` for every HTTP deployment. Audit log lines for any client passing `path` over HTTP.
- **Consumer mitigation (post-v0.2.1):** `path` will be rejected outright on non-stdio transport.

### 2. `transcribe` with `path` parameter — same LFI class

- **Where:** `src/mcp/tools/audio.ts:73-81`. Reference implementation of the correct pattern.
- **Risk:** Same as above.
- **Current state:** Already gated by `if (spec.path && ctx.config.transport !== 'stdio') return error`. Use this as the template when extending new file-reading tools.

### 3. `User` field leakage across three MCP surfaces

- **Where:** `User` type at `src/types.ts:80-91` carries `chatwoot_hmac` and `ym_client_id` (internal identifiers). Leaked through:
  - `src/mcp/tools/user.ts:28` (`whoami`)
  - `src/mcp/tools/auth.ts:43-44`
  - `src/mcp/resources/static.ts:86-88`
- **Risk:** `whoami` and the static resource return the full `User` object including the internal identifiers. An attacker who can call these tools can capture those values for downstream abuse.
- **Consumer mitigation (today):** Never log or echo the raw response of `whoami`. Treat `User` as a credential-bearing object.
- **Consumer mitigation (post-H2):** `User` will be split into `UserPublic` (returned to MCP callers) and `UserInternal` (server-side only). The three leak sites will switch to the public type.

### 4. `SyntxWebSocket` token in URL query

- **Where:** `src/websocket.ts:107-110` — `url.searchParams.set('token', this.token)`.
- **Risk:** Bearer tokens in query strings land in proxy logs, browser history, server access logs, and WSS-handshake reverse-proxy logs. Any of those becomes a credential leak.
- **Current state:** Module is marked `@deprecated` and still exported from `src/index.ts:6-9`. The example `examples/chat-example.ts:71,98` still uses it.
- **Consumer mitigation (today):** Do not use `SyntxWebSocket`. Use `ask` / `send-message` / `stream-message` exclusively — they pass the token via headers or in-process state.
- **Consumer mitigation (post-H3):** Deprecated module will require an explicit opt-in flag and the example will be updated to use `stream-message`.

### 5. `set-token` over HTTP — token installation surface

- **Risk:** Over HTTP, any caller who can reach the MCP endpoint can install a fresh bearer token via `set-token`. Combined with a successful `whoami`, this lets the attacker authenticate subsequent calls as the installed user.
- **Current state:** Allowed on `http` if Host/Origin check passes.
- **Consumer mitigation (post-v0.2.1):** `set-token` will be restricted to localhost callers when running over HTTP. Production HTTP deployments should set `SYNTX_TOKEN` via env up front and disable `set-token`.

## Secondary risks (read for context)

These are surfaced in the audit but not part of the top-five consumer summary:

- `cli.ts:121-128` — bootstrap messages are written to **stdout** via `console.log`. Today this is safe because the gating condition is `config.transport === 'http'`. A regression that drops the transport guard would corrupt stdio JSON-RPC framing. Consumer note: do not shell-pipe stdout from `syntx-mcp` start:stdio invocations to parsers expecting MCP framing.
- `http.ts:78-166` — no `Content-Length` cap, no `maxHeaderSize`, no per-chunk accumulator → OOM DoS class. Mitigation belongs to the operator, not the agent caller.
- `http.ts:89-93` — `OPTIONS` returns 200 before the Host/Origin gate runs. CSRF-class risk for browser clients. Mitigation belongs to the operator (deployed behind a same-origin reverse proxy).
- `http.ts:182-205` (`checkHostHeader`) — canonicalization gaps: no IPv4-mapped IPv6 (`[::ffff:127.0.0.1]`), trailing dots, IDN/punycode, proxy headers (`X-Forwarded-Host`). Operator concern.
- `auth.ts:67-77` (`getGoogleLoginUrl`) — uses deprecated `response_type=token` (Implicit Grant). Not reachable from MCP tools but referenced in flow code.

## Consumer checklist before going live

Run through this list before exposing the MCP server to any non-loopback caller:

- [ ] Confirm transport is HTTP only when intentional; otherwise keep the default `stdio`.
- [ ] Set `SYNTX_TOKEN` via environment, not `set-token` over HTTP.
- [ ] Set `MCP_HTTP_TOKEN` for HTTP, plus a tight Host/Origin allow-list.
- [ ] Disable `set-token` over HTTP post-v0.2.1 (or upgrade beyond v0.2.0 first).
- [ ] Never pass `path` to `upload-files` or `transcribe` over HTTP — use `content_base64`.
- [ ] Do not use `SyntxWebSocket` directly.
- [ ] Never log the raw response of `whoami` or any `User`-returning tool.
- [ ] Audit any custom tool that reads files from disk before exposing it over HTTP.
- [ ] If fronting the MCP server with a browser, ensure the reverse proxy enforces same-origin to bypass the OPTIONS / Host-header canonicalization gaps.

## Where the work lives

| ID | Title | File | Status |
|---|---|---|---|
| H1 | Centralized `assertPathSourceAllowed` in `file-input.ts` | `src/mcp/tools/file-input.ts` | Planned for v0.2.1 |
| H2 | Split `User` into `UserPublic` / `UserInternal` | `src/types.ts`, three callers | Planned for v0.2.1 |
| H3 | Remove bearer-in-query from `SyntxWebSocket` | `src/websocket.ts`, `src/index.ts`, `examples/chat-example.ts` | Planned for v0.2.1 |
| M1 | `console.error` (not `console.log`) for bootstrap messages | `src/bin/cli.ts:121-128` | Planned for v0.2.1 |
| M2 | `Content-Length` cap + per-chunk accumulator + `maxHeaderSize` | `src/transport/http.ts` | Planned for v0.2.1 |
| M3 | Proper Host/Origin canonicalization | `src/transport/http.ts:182-205` | Planned for v0.2.1 |
| M4 | CI gates: `npm audit`, secret scan, SAST | `.github/workflows/ci.yml` | Planned for v0.2.1 |

For rationale, threat model, and remediation order, read the security plan directly.
