# Failure-Mode Recipes

Symptom → fix recipes for the common failure modes when operating `syntx-ai-mcp_*` tools. Use the table of contents to jump to a recipe.

## Contents

- [Model not found (400)](#model-not-found-400)
- [ask timeout (recovery)](#ask-timeout-recovery)
- [completed: false with empty text](#completed-false-with-empty-text)
- [Token missing or 401](#token-missing-or-401)
- [Attached file not recognized by AI](#attached-file-not-recognized-by-ai)
- [upload-files path rejected over HTTP](#upload-files-path-rejected-over-http)
- [transcribe path rejected over HTTP](#transcribe-path-rejected-over-http)
- [generate-image requires a chat_uuid](#generate-image-requires-a-chat_uuid)
- [set-default-ai silently ignored](#set-default-ai-silently-ignored)
- [Streaming mode fails to connect](#streaming-mode-fails-to-connect)
- [Rate-limit / 429](#rate-limit--429)
- [Destructive tool used by accident](#destructive-tool-used-by-accident)

## Model not found (400)

**Symptom:** Tool returns `400` with `detail.message` like `model 'gpt-5-mini' not found`.

**Cause:** `model_type` does not match the literal `value` field returned by `list-models`.

**Fix:**

1. `list-models(ai_name=<your provider>)` — inspect the full list.
2. Copy the exact `value` from the row you want into `model_type`.
3. Re-run the call.

Notes:

- `syntx.ai` ids are literal strings. `gpt-5.5` is correct; `gpt-5-mini`, `gpt-5.5-mini`, `gpt-5-mini-2025-08-07` are all `400`.
- `ai_name` is a separate axis. A valid `model_type` under `chatgpt` may not exist under `claude`.

## ask timeout (recovery)

**Symptom:** `ask` returns a timeout error after 60 s; you have a long prompt and need the result.

**Cause:** Default `ask.timeout` is 60 s, insufficient for prompts > ~1 500 tokens. The chat was still created server-side before the timeout fired.

**Fix — recovery (do not re-invoke `ask`):**

1. `list-chats(search=<title or distinctive prompt fragment>)` → recover the chat `uuid`.
2. `get-messages(chat_id=<uuid>, direction="newer", page_size=3)` → confirm whether the assistant reply is present.
3. If reply missing or partial → `wait-for-response(chat_id=<uuid>, timeout=600000, poll_interval=10000)`.
4. For new prompts, switch to Pattern B: `create-chat` + `send-message` + `wait-for-response`.

**Fix — prevention:** increase the `timeout` parameter explicitly when calling `ask` with long prompts (300 000 — 600 000 ms is a reasonable range for technical work).

See [`chat-lifecycle.md`](chat-lifecycle.md) for full diagrams and the worked recovery example.

## completed: false with empty text

**Symptom:** `get-messages` or `wait-for-response` returns an assistant message where `completed: false` and `text: ""`.

**Cause:** The assistant is still generating. This is normal mid-flight state.

**Fix:**

- Do **not** send another user message — that will interleave and break the assistant's context.
- Sleep / poll longer. `wait-for-response` will resolve when `completed: true`. If the timeout is hit, raise it.

## Token missing or 401

**Symptom:** Any tool returns `401 Unauthorized`, or `whoami` returns `{ authenticated: false }`.

**Cause:** Bearer JWT missing, expired, or never set.

**Fix:**

1. Acquire a fresh JWT (the syntx.ai account flow — see project README).
2. `set-token(<fresh JWT>)` — installs in process memory.
3. `validate-token` (or `whoami`) to confirm — non-throwing.
4. Retry the failed call.

The JWT is in-memory only — lost on server restart. For HTTP transport deployments, prefer setting `SYNTX_TOKEN` in the server's environment.

## Attached file not recognized by AI ("вы не прикрепили файл")

**Symptom:** After sending a message with an attached file via `send-message`, the AI replies that no file was attached (e.g., *"вы не прикрепили файл к сообщению"*).

**Cause:** The attachment's `object_type` in the API request was set to `"file"`, which is not a valid input type. The syntx.ai API silently drops attachment objects with unrecognized `object_type` values. Only `"filetext"` is accepted for non-media files.

**Fix:** The MCP server now maps all non-media MIME types to `object_type: "filetext"` automatically (since v0.2.0). Ensure you are running the latest build. If you are writing a custom caller:

1. For text documents, PDFs, and other non-media files → use `object_type: "filetext"`.
2. For images → `object_type: "image"`.
3. For video → `object_type: "video"`.
4. For audio → `object_type: "audio"`.

Do **not** use `"file"` as an `object_type` in request payloads — it is only valid in API *responses*.

**Verification:** Call `get-messages(chat_id=<uuid>)` on the sent message. If the response contains only one `message_object` (text) instead of two (text + file), the attachment was dropped. Attachments with the correct `object_type` produce two `message_object` entries in the response.

## upload-files path rejected over HTTP

**Symptom:** `upload-files` returns an error mentioning transport / path / file-input.

**Cause:** When the MCP server runs over non-stdio transport, file paths are restricted to prevent LFI. Resolved centrally in `src/mcp/tools/file-input.ts:67-95`.

**Fix:** For HTTP deployments, read the file in the client and pass it as `content_base64` with a `filename` and (optionally) `mime_type`:

```json
{
  "files": [
    {
      "content_base64": "<base64 of file>",
      "filename": "report.pdf",
      "mime_type": "application/pdf"
    }
  ]
}
```

The `path`-based form remains available for `stdio` transport only. For stdio, either form is accepted.

## transcribe path rejected over HTTP

**Symptom:** `transcribe` returns a transport error when called with `path`.

**Cause:** Same LFI class as `upload-files`. Reference implementation at `src/mcp/tools/audio.ts:73-81` enforces `ctx.config.transport !== 'stdio'` check before allowing server-side file reads.

**Fix:** Switch to `content_base64` + `filename` (and optional `mime_type`). Recommended for HTTP deployments; reduces attack surface.

## generate-image requires a chat_uuid

**Symptom:** `generate-image` returns an error mentioning `chat_uuid` is required.

**Cause:** Design services (`sora-images`, `midjourney`, `flux`) attach the generated image to a chat. The call must include a target `chat_uuid`.

**Fix:**

1. `create-chat(title, scope="image")` → returns `uuid`.
2. `generate-image(chat_uuid=<uuid>, prompt=..., model_type=..., resolution=..., image_url?=[...])`.

The image is attached to the chat history and visible via `get-messages(chat_id=<uuid>, direction="newer")`.

## set-default-ai silently ignored

**Symptom:** After calling `set-default-ai("claude")`, subsequent calls still route to the previous default.

**Cause:** Some tools require explicit `ai_name` regardless of the default. The default is consulted only when the caller omits the parameter.

**Fix:** Pass `ai_name="claude"` explicitly on the affected call, or confirm the issue is config-routing by:

1. `get-settings` → confirm `defaultAI` actually updated.
2. Re-invoke the failing tool with explicit `ai_name` + `model_type`.

## Streaming mode fails to connect

**Symptom:** `stream-message(mode="auto")` or `mode="stream"` returns a WSS / connection error.

**Cause:** The syntx.ai WSS endpoint is currently unavailable or unstable. Auto falls back to polling automatically; explicit `stream` does not.

**Fix:** Use `mode: "poll"` explicitly. Polling via `create` + `send-message` + `wait-for-response` is the most reliable path for long technical prompts.

## Rate-limit / 429

**Symptom:** Tool returns `429 Too Many Requests`.

**Cause:** Either the syntx.ai backend throttled the caller, or `get-messages` polling cadence was too aggressive.

**Fix:**

- Increase `poll_interval` for `wait-for-response` to ≥ 5 000 ms; 10 000 — 15 000 ms is safer for long generations.
- Batch user prompts into fewer, larger messages where possible.
- If calls are serial across multiple chats, serialize them.

## Destructive tool used by accident

**Symptom:** `delete-file` / `delete-project` / `add-chats-to-project` was invoked unintentionally.

**Cause:** Tool name does not telegraph destructive intent strongly enough. Always read the tool description carefully before invoking.

**Mitigation:**

- The server-side is the source of truth; there is no client-side undo.
- For project-level operations, list the targets first (`list-chats`, `list-uploaded-files`) and re-confirm before deleting.
- Consider not exposing these tools over HTTP without an upstream auth layer (see [`security-caveats.md`](security-caveats.md)).
