---
name: syntx-ai-mcp-usage
description: Operates the syntx.ai MCP tools (chat, ask, stream-message, files, design, audio, auth, model catalog). Use when calling syntx-ai-mcp_* tools and the JSON schema alone is insufficient — long prompts that exceed the default ask timeout, model identifier selection, chat lifecycle (create / continue / recover), streaming mode choice, security caveats. Use when an existing chat must be resumed or a fresh one created.
license: MIT
compatibility: Requires syntx.ai bearer JWT (set via set-token tool). Targets Kilo / Claude Code agents with the syntx-ai-mcp MCP server installed.
metadata:
  author: syntx-ai-mcp contributors
  version: "0.2.0"
---

# syntx-ai-mcp Usage

Operational knowledge for driving the `syntx-ai-mcp_*` MCP tools. This skill captures the non-obvious behaviors discovered through real use that you cannot infer from the tool JSON schemas alone: model identifier conventions, timeout recovery, chat lifecycle, transport-aware security caveats.

## When to use this skill

Trigger on any of these conditions:

- Calling any `syntx-ai-mcp_*` tool for the first time in a session.
- A prompt exceeds ~1 500 tokens and `ask` is timing out at the default 60 s.
- The user asks to "continue" or "resume" an existing chat.
- A model identifier returns `400 — model not found`.
- Choosing between streaming modes (`auto` / `stream` / `poll` / `off`).
- An authentication failure surfaces and the JWT must be refreshed.
- A `upload-files` or `transcribe` call returns an unexpected error — transport matters.

## Tool inventory — quick reference

| Tool | Purpose | Blocking? | Notes |
|---|---|---|---|
| `set-token` | Install bearer JWT in-process | yes (fast) | Token lives in memory only; lost on restart. |
| `whoami` | Verify auth, return `User` profile | yes | Returns full profile — sanitize before logging. |
| `validate-token` | Non-throwing auth check | yes | Returns `{ authenticated }`; preferred over `whoami` for checks. |
| `list-ai-services` | List syntx.ai providers | yes | Use to discover `ai_name` values. |
| `list-models` | List models with constraints | yes | Source of truth for `model_type` identifiers. |
| `get-model-info` | Per-model pricing/limits | yes | Required for cost estimation. |
| `get-settings` | Read effective runtime config | yes | Confirm `defaultAI` and `default model`. |
| `set-default-ai` / `set-default-model` | Change defaults | yes | Affects tools that omit `ai_name`/`model_type`. |
| `create-chat` | Create persistent chat | yes | Returns `uuid`; safe to call before prompt is final. |
| `list-chats` | List existing chats | yes | Filter by `scope` or `search=<title>` for recovery. |
| `get-messages` | Read chat history | yes | Use `direction="newer"` after recovery. |
| `generate-title` | Auto-title a chat | yes | Cosmetic. |
| `send-message` | Append user message | no | Pairs with `wait-for-response`. |
| `wait-for-response` | Block for assistant reply | yes | Use after `send-message`. |
| `ask` | One-shot: create + send + wait | yes | Default timeout 60 s — often too short. |
| `stream-message` | Stream via WSS with poll fallback | yes | `mode: "auto"` / `"stream"` / `"poll"` / `"off"`. |
| `upload-files` | Upload ≤10 files, ≤100 MB each | yes | `path` is LFI on non-stdio transport — see security caveats. |
| `transcribe` | Audio → text | yes | Same LFI caveat for `path` parameter. |
| `generate-image` | Image generation | yes | Requires target `chat_uuid`. |
| `delete-project` / `delete-file` / `add-chats-to-project` | Project/folder ops | yes | Destructive — confirm before invoking. |
| `list-uploaded-files` | List prior uploads | yes | Useful when resuming work. |

For full per-tool schemas, rely on MCP `tools/list` — they are the source of truth.

## Model identifier quirks

`syntx.ai` model identifiers do not follow OpenAI's `-mini` suffix pattern:

- The literal model id for the default GPT-5 family class is **`gpt-5.5`** — no dot-as-decimal, no `-mini` suffix.
- Initial guesses like `gpt-5-mini`, `gpt-5.5-mini`, `gpt-5-mini-2025-08-07` return `400 — model not found`. On `400`, the server's `detail.message` echoes the full list of valid `value` strings — copy it verbatim.
- `ai_name` (provider identifier such as `"chatgpt"`, `"gemini"`, `"claude"`) and `model_type` (per-model id) are independent dimensions. Omitting either falls back to `defaultAI` / `default model` — see `get-settings`.
- Fresh model ids are published only through `list-models`. Cache nothing.

Discovery workflow before any model-sensitive call:

1. `list-ai-services` → pick `ai_name`.
2. `list-models(ai_name=<picked>)` → copy `value` field of desired model into `model_type`.
3. Optional: `get-model-info(ai_name, model_type)` → confirm pricing / limit params before sending large payloads.

## Chat lifecycle — three patterns

Pick the pattern by intent:

### Pattern A — One-shot (`ask`)

`ask(prompt, ai_name?, model_type?, timeout?, mode?)` creates a chat, sends the prompt, blocks until the assistant reply completes (or times out), returns the reply text and the created `chat_uuid`.

- Use when the answer is the goal and you do not need to follow up.
- Default `timeout` is **60 s**. Insufficient for prompts > ~1 500 tokens.
- For deep-reasoning models (`gpt-5.5`, o-series, `claude-opus`, `gemini-*-thinking`) on long contexts, prefer Pattern B — `ask` is exposed to an MCP-layer timeout (`-32001`) that the tool's `timeout` parameter cannot extend. See [MCP-layer timeout vs tool-layer timeout](#mcp-layer-timeout-vs-tool-layer-timeout).

### Pattern B — Multi-turn (`create-chat` + `send-message` + `wait-for-response`)

1. `create-chat(title, scope="text")` → save `uuid`.
2. `send-message(chat_id=<uuid>, prompt=...)` → returns immediately.
3. `wait-for-response(chat_id=<uuid>, timeout?, poll_interval?)` → blocks for completion.
4. Repeat from step 2 for follow-ups.

Use when you intend to send follow-ups or want to keep the chat for later sessions.

### Pattern C — Recovery after `ask` timeout

The chat was created on the server before the timeout fired. Do **not** re-call `ask` — recover and continue:

1. `list-chats(search=<chat title>)` to find the orphan chat by UUID.
2. `get-messages(chat_id=<uuid>, direction="newer", page_size=3)` to confirm the last assistant message.
3. Continue from the recovered `uuid` with Pattern B (Pattern A would create a duplicate chat).

This pattern was exercised in the planning session on chat `uuid=3beaee7c-3a5e-42e8-ba3a-d0a02655804f` after an `ask` timeout.

For complete flow diagrams, see [`references/chat-lifecycle.md`](references/chat-lifecycle.md).

## Timeouts & streaming modes

**Defaults are not safe for technical prompts.**

| Setting | Default | Recommended for long prompts |
|---|---|---|
| `ask.timeout` | 60 000 ms | 300 000 — 600 000 ms |
| `stream-message.timeout` | server default | 300 000 — 600 000 ms |
| `wait-for-response.poll_interval` | server default | 5 000 — 15 000 ms |
| `mode` for `ask` / `stream-message` | `"auto"` | `"poll"` |

### Mode semantics (`stream-message` and `ask`)

| Mode | Behavior |
|---|---|
| `"auto"` | Tries WSS first, falls back to REST polling on transport failure. |
| `"stream"` | Force WSS — same effective behavior as `"auto"` because the syntx.ai WSS endpoint is currently unavailable. |
| `"poll"` | REST only: `create` + `send-message` + `wait-for-response`. **Most reliable for long technical prompts.** |
| `"off"` | Fire-and-forget: returns `chat_uuid` immediately, no reply — use only when you intend to poll manually. |

For prompts > ~1 500 tokens, always pass `mode: "poll"` explicitly. The default `"auto"` wastes the WSS round-trip on a known-failing path before falling back.

### MCP-layer timeout vs tool-layer timeout

Two distinct timeouts can fire on an `ask` call:

1. **Tool-layer** — the `timeout` parameter inside `ask` (default 60 000 ms). Visible as a normal completion or a `null` result with a tool-level error message.
2. **MCP-layer** — the JSON-RPC ceiling imposed by the MCP transport. Surfaces as `MCP error -32001: Request timed out` **regardless of the `timeout` value passed to `ask`**.

When the server takes longer to generate than the MCP layer allows, `ask` fails with `-32001` even though its internal timer would have waited longer. This is the failure mode observed on chat `uuid=222646e9-07b5-4150-a606-2eea4587af92` with `gpt-5.5` on a ~250-line analytical prompt — the first `ask` returned `-32001`; the retry using the Pattern B triad with `wait-for-response(timeout=240000)` succeeded in ~73 s. `ask`'s `timeout` parameter could not have rescued it because the failure happens above the tool.

**Rule of thumb**: for prompts to deep-reasoning models on contexts > ~1 500 tokens, skip `ask` entirely and go straight to the triad. `send-message` is non-blocking (no MCP ceiling), and only `wait-for-response` blocks — and it accepts an explicit `timeout` you control:

```text
create-chat(title, scope="text")            # save uuid
send-message(chat_id=<uuid>, prompt=...)    # non-blocking, MCP returns immediately
wait-for-response(chat_id=<uuid>, timeout=240000, poll_interval=10000)
```

Practical timings observed on `gpt-5.5` (chat `222646e9-…`): ~73 s for an 8-question review of a structured plan digest. Set `wait-for-response.timeout` to at least **180 000 ms**, ideally **240 000 — 300 000 ms**, for this model class.

See [`references/failure-modes.md`](references/failure-modes.md) for symptom → fix mapping.

## Authentication

Bearer JWT lives **in process memory only**. The lifetime is:

- Single MCP server process lifetime.
- Lost on restart — re-invoke `set-token` or set `SYNTX_TOKEN` in the server's environment.

Verification flow:

1. `set-token(token)` → installs JWT.
2. `whoami` → returns the `User` profile (full fields, including internal ones — see security caveats).
3. `validate-token` → non-throwing alternative that returns `{ authenticated: true | false }`. Prefer this for liveness checks.

The legacy `SyntxWebSocket` class used to send tokens in URL query strings. It is `@deprecated` and tokens must never appear in URL parameters. Use `ask` / `send-message` only.

## Security caveats — summary

Five MCP surfaces require care when the MCP server runs over HTTP transport:

| Surface | Risk | Mitigation in v0.2.x |
|---|---|---|
| `upload-files` with `path` parameter | LFI over HTTP transport | Prefer `content_base64` for HTTP; restriction lands in v0.2.1 (path allowed only for `stdio`). |
| `transcribe` with `path` parameter | Same LFI class | Already guarded by `transport !== 'stdio'` check — use the same pattern when extending. |
| `whoami` / `User`-returning tools | Leaks `chatwoot_hmac`, `ym_client_id` internal identifiers | Never log raw `User` payloads. Sanitize before publishing. |
| `set-token` over HTTP | Will be restricted in v0.2.1 to localhost-only callers | Set `SYNTX_TOKEN` via env in production HTTP deployments. |
| `SyntxWebSocket` (`@deprecated`) | Bearer token in URL query | Do not use. All current use cases are covered by `ask` / `send-message` / `stream-message`. |

Full audit, threat model, and remediation roadmap live in [`references/security-caveats.md`](references/security-caveats.md).

## Failure-mode recipes

Quick index — full details in [`references/failure-modes.md`](references/failure-modes.md):

- **`400 — model not found`** → call `list-models(ai_name=...)`, copy exact `value` into `model_type`.
- **`ask` timeout (>60 s)** → chat already created server-side; do **not** re-call `ask`. Use Pattern C recovery.
- **`ask` returns `MCP error -32001: Request timed out`** → MCP-layer timeout fired before the tool-layer `timeout`; the chat is already created server-side. Do **not** retry `ask` (same failure will recur). For long prompts to deep models, go straight to Pattern B (`create-chat` + `send-message` + `wait-for-response`) with explicit `timeout` on `wait-for-response` — for one-off `ask` failures on short prompts, Pattern C recovery is fine. See [MCP-layer timeout vs tool-layer timeout](#mcp-layer-timeout-vs-tool-layer-timeout).
- **`completed: false` with empty text in `get-messages`** → assistant still generating; `wait-for-response` with longer timeout, or sleep + re-poll.
- **Token missing / 401** → `set-token` then `validate-token` (or `whoami`) to confirm.
- **`upload-files` permission/path error over HTTP** → transport guard rejected `path`; switch to `content_base64`.
- **`generate-image` with no `chat_uuid`** → every design service call needs a target chat; create one first via `create-chat(scope="image")`.
- **`set-default-ai` silently ignored** → check `get-settings` to confirm; some tools require explicit `ai_name` regardless of default.

## End-to-end worked example

Goal: send a 2 000-token technical prompt to `gpt-5.5` and capture the assistant reply without timing out.

```text
# 1. Confirm auth (assumes token already set via set-token or SYNTX_TOKEN env).
whoami                                          # expect populated User profile

# 2. Discover the model id (cheap guard against identifier typos).
list-ai-services                                # pick ai_name
list-models(ai_name="chatgpt")                  # confirm exact value for gpt-5.5

# 3. Create the chat up front so we never depend on ask for persistence.
create-chat(title="Security audit — long prompt", scope="text")
#   → returns uuid, save it.

# 4. Send the prompt (non-blocking).
send-message(
  chat_id=<uuid>,
  prompt=<...2000 tokens...>,
  ai_name="chatgpt",
  model_type="gpt-5.5"
)

# 5. Wait with a generous timeout and explicit polling.
wait-for-response(
  chat_id=<uuid>,
  timeout=600000,
  poll_interval=10000
)
```

This pattern survives `ask`'s 60 s default and produces a chat reusable for follow-ups.

## References

- [`references/chat-lifecycle.md`](references/chat-lifecycle.md) — full create / send / recover / poll flow diagrams.
- [`references/model-catalog.md`](references/model-catalog.md) — known `ai_name` × `model_type` pairs and discovery workflow.
- [`references/failure-modes.md`](references/failure-modes.md) — symptom → fix recipes for common errors.
- [`references/security-caveats.md`](references/security-caveats.md) — transport-aware security audit and cross-reference to the project's hardening plan.
- [`assets/sample-prompts.md`](assets/sample-prompts.md) — copy-paste prompts that exercise tricky parameters.

Also:

- The MCP server's own docs: [`README.md`](../../README.md), [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
- Security plan that motivated `references/security-caveats.md`: [`.kilo/plans/1784624085807-security-hardening-plan.md`](../../.kilo/plans/1784624085807-security-hardening-plan.md) (planning artifact, not shipped to npm).
