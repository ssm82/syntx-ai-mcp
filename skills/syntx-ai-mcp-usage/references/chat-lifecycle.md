# Chat Lifecycle

State diagrams for the three lifecycle patterns in [`SKILL.md`](../SKILL.md). Use these to choose between `ask`, `create-chat` + `send-message`, and recovery flows.

## Pattern A — One-shot (`ask`)

The fastest path when you only need the assistant reply and have no plans to continue:

```
   caller                 syntx-ai-mcp_*              syntx.ai
     │                          │                        │
     │  ask(prompt, ...)        │                        │
     ├─────────────────────────►│                        │
     │                          │  POST /chats (create)  │
     │                          ├───────────────────────►│
     │                          │◄────── chat uuid ──────┤
     │                          │                        │
     │                          │  sendMessage + wait    │
     │                          ├───────────────────────►│
     │                          │◄─── assistant reply ───┤
     │  { text, chat_uuid }     │                        │
     │◄─────────────────────────┤                        │
```

When `ask` times out, the chat exists server-side (state: "user prompt sent, assistant generation in flight or pending"). Move to Pattern C; never re-invoke `ask`.

## Pattern B — Multi-turn (`create-chat` + `send-message` + `wait-for-response`)

The persistent-chat pattern. Use when follow-ups are likely or the chat should outlive the session.

```
   caller                       syntx-ai-mcp_*           syntx.ai
     │                                │                     │
     │  create-chat(title, scope)     │                     │
     ├────────────────────────────────►│                     │
     │                                │  POST /chats        │
     │                                ├────────────────────►│
     │  { uuid }                      │◄──── uuid ──────────┤
     │◄───────────────────────────────┤                     │
     │                                │                     │
     │  send-message(chat_id, p0)     │                     │
     ├────────────────────────────────►│                     │
     │                                │  POST messages      │
     │                                ├────────────────────►│
     │  { status: queued }            │                     │
     │◄───────────────────────────────┤                     │
     │                                │                     │
     │  wait-for-response(chat_id)    │                     │
     ├────────────────────────────────►│                     │
     │                                │  poll GET /messages │
     │                                ├────────────────────►│
     │  { text: assistant_reply_0 }   │                     │
     │◄───────────────────────────────┤                     │
     │                                │                     │
     │  ... repeat send + wait for p1, p2, ...              │
```

### Persisting the uuid

The `uuid` is the only stable handle. Store it across turns:

- In a session variable when running inside an orchestrator.
- In a project artifact (a scratch file) if a human will resume later.
- In a `folder` / `project` (via `add-chats-to-project`) to group related chats.

### Polling cadence

`wait-for-response` uses `get-messages(direction="newer", page_size=N)`. For long generations, prefer:

- `poll_interval`: 5 000 — 15 000 ms (10 s is a good default for technical prompts).
- `timeout`: ≥ the longest acceptable end-to-end latency. 300 s is comfortable; 600 s is the ceiling for current API behavior.

Avoid tight sub-second polling — the syntx.ai backend rate-limits `get-messages` aggressively.

## Pattern C — Recovery after `ask` timeout

When `ask` returns a timeout error, the chat is already on the server. Recover, do not duplicate.

```
   caller                          syntx-ai-mcp_*                 syntx.ai
     │                                  │                            │
     │  ask(prompt) → TIMEOUT           │                            │
     │                                  │                            │
     │  list-chats(search=title)        │                            │
     ├─────────────────────────────────►│  GET /chats?search=...      │
     │                                  ├───────────────────────────►│
     │  [ { uuid, title, updated_at } ] │                            │
     │◄─────────────────────────────────┤                            │
     │                                  │                            │
     │  get-messages(chat_id,           │                            │
     │    direction="newer",            │                            │
     │    page_size=3)                  │                            │
     ├─────────────────────────────────►│  GET /messages?...          │
     │                                  ├───────────────────────────►│
     │  [ user(prompt), assistant(?) ]  │                            │
     │◄─────────────────────────────────┤                            │
     │                                  │                            │
     │  If assistant is present → done. │                            │
     │  If assistant missing            │                            │
     │    → wait-for-response(chat_id)  │                            │
     │    to capture in-flight reply.   │                            │
```

### Worked example from the planning session

The planning session that produced this skill recovered chat `3beaee7c-3a5e-42e8-ba3a-d0a02655804f` after a 60 s `ask` timeout on a long security-audit prompt. The recovery path was:

1. `list-chats(search="syntx-ai-mcp security audit")` → returned the orphan chat with the correct `uuid`.
2. `get-messages(direction="newer", page_size=3)` → confirmed the `user` prompt was present, `assistant` message had `completed: true` and full text — work was preserved.
3. The chat was reused for the follow-up question by invoking `send-message` + `wait-for-response`.

### When to discard vs recover

Discard and start fresh if:

- The recovered chat contains a `system`-level message that is no longer valid (e.g., you have switched providers or models).
- The user prompt is corrupted or has been edited.

Recover if:

- The `user` prompt is intact and the `assistant` reply is missing or partial.
- You suspect the generation is still in flight (poll once before assuming loss).

## Edge cases

### Multiple assistants in one chat

A chat may have several assistant replies if the user interleaves inputs. Use `get-messages(direction="newer")` with a small `page_size` to avoid pulling the full history each time.

### Empty assistant message with `completed: false`

This is the in-flight state — generation is still running. Wait, do not send another `user` prompt, or you will interleave two messages and the assistant will lose context.

### Token expiry mid-chat

If `send-message` or `wait-for-response` returns 401, call `set-token` again and retry the last call. Existing messages are preserved server-side; only auth state was lost.

### Conflict between `ask` patterns

Never mix Pattern A (`ask`) with Pattern B (`send-message` + `wait-for-response`) on the same chat. `ask` creates its own fresh chat every time, so calling `ask(uuid=existing)` is not supported. Switch entirely to Pattern B if you need to resume.
