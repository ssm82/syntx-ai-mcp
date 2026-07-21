# Sample Prompts

Copy-pasteable prompt templates that exercise the tricky parameter shapes of the `syntx-ai-mcp_*` tools. Adjust identifiers (`gpt-5.5`, `chatgpt`) per session after running `list-models` + `list-ai-services`.

## 1. Long technical prompt → gpt-5.5 (Pattern B)

Use for prompts over ~1 500 tokens. Creates the chat up front so a timeout does not lose work.

```text
# step 1: discover
list-ai-services
list-models(ai_name="chatgpt")

# step 2: create
create-chat(title="Security review — http transport", scope="text")
# → returns { uuid: "..." }

# step 3: send
send-message(
  chat_id=<uuid>,
  prompt="<long technical prompt here>",
  ai_name="chatgpt",
  model_type="gpt-5.5"
)

# step 4: wait (NOT ask; this avoids the 60s default)
wait-for-response(
  chat_id=<uuid>,
  timeout=600000,
  poll_interval=10000
)
```

## 2. Recovery after `ask` timeout

```text
list-chats(search="Security review — http transport")
# → returns [{ uuid: "...", title: "..." }]

get-messages(
  chat_id=<uuid>,
  direction="newer",
  page_size=3
)
# → returns the user prompt and any assistant reply

# If the assistant reply is present, you are done.
# If empty / completed:false → continue with wait-for-response.

wait-for-response(chat_id=<uuid>, timeout=300000, poll_interval=10000)
```

## 3. Image generation via `generate-image`

```text
create-chat(title="cover art attempt", scope="image")
# → uuid

generate-image(
  chat_uuid=<uuid>,
  prompt="minimalist cover art, navy + gold gradient, abstract geometry, no text",
  ai_name="sora-images",
  model_type="gpt-image-2",
  resolution="1024x1024",
  quality="high"
)
# → returns image URL(s); also visible via get-messages
```

## 4. Audio transcription (HTTP-safe form)

```text
# HTTP transport: use content_base64, NOT path
transcribe(
  content_base64="<base64 of audio file>",
  filename="interview.mp3",
  mime_type="audio/mpeg"
)
# → returns { text }
```

## 5. Atomic HTTP-safe file upload

```text
upload-files(
  files=[
    {
      "content_base64": "<base64>",
      "filename": "contract.pdf",
      "mime_type": "application/pdf"
    }
  ]
)
# → returns [{ url, filename, size, mime_type }]
```

## 6. Discover-then-default dance

```text
# What defaults are active?
get-settings
# → returns effective config (defaultAI, default model, base URL, ...)

# Switch to chatgpt + gpt-5.5 for the rest of the session
set-default-ai("chatgpt")
set-default-model("gpt-5.5")

# Subsequent tool calls that omit ai_name/model_type now resolve to these.
# Verify:
get-settings
```

## 7. Multi-turn follow-up on a chat

```text
# Continue a recovered chat with a focused follow-up
send-message(
  chat_id=<uuid>,
  prompt="Given the previous answer, summarize the three highest-impact changes for the v0.2.1 release.",
  ai_name="chatgpt",
  model_type="gpt-5.5"
)

wait-for-response(
  chat_id=<uuid>,
  timeout=300000,
  poll_interval=10000
)
```

## 8. Auth liveness check (non-throwing)

```text
# Preferred over whoami when you only need to know if the token works.
validate-token
# → returns { authenticated: true, user: <UserPublic> } or { authenticated: false }

# Only call whoami when you need the full profile (and remember to sanitize it).
whoami
```

## Anti-patterns

These will silently waste time, leak secrets, or corrupt the chat history. Avoid them.

- ❌ `ask(prompt)` for prompts > ~1 500 tokens — default 60 s timeout will fire.
- ❌ `ask(uuid=<existing>)` — `ask` always creates a new chat; resuming mid-chat requires `send-message`.
- ❌ `upload-files` with `path` parameter when the MCP server runs over HTTP — LFI surface.
- ❌ `transcribe(path=...)` over HTTP for the same reason.
- ❌ Calling `set-default-ai` / `set-default-model` and assuming every tool honors defaults — some require explicit `ai_name`.
- ❌ Logging the raw response of `whoami` or any `User`-returning tool — internal identifiers leak.
- ❌ Re-invoking `ask` after a timeout instead of recovering with `list-chats` + `get-messages` — produces duplicate chats.
- ❌ `set-token` over HTTP for production deployments — restricted in v0.2.1; set `SYNTX_TOKEN` via env instead.
- ❌ Importing `SyntxWebSocket` directly — bearer-token-in-URL class. Use `ask` / `send-message` / `stream-message`.
