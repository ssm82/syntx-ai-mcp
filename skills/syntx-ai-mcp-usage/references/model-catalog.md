# Model Catalog

Working catalog of `ai_name` × `model_type` pairs known to work with `syntx-ai-mcp`. Values are verified against `list-models`; refresh by calling the tool whenever a 400 surfaces — the server is the source of truth.

> Identifier caution: `syntx.ai` model ids do **not** follow OpenAI's `-mini` suffix pattern. Copy the `value` returned by `list-models` exactly. `gpt-5.5` (not `gpt-5-mini`, not `gpt-5.5-mini`) is the literal id for the default GPT-5 family class used in the planning session.

## Discovery workflow

Before any model-sensitive call:

1. `list-ai-services` → list of provider identifiers (`ai_name`).
2. `list-models(ai_name=<chosen>)` → list of `value` strings valid for that provider.
3. `get-model-info(ai_name, model_type)` → confirm pricing and per-call limits.

Omitting both `ai_name` and `model_type` falls back to `get-settings().defaultAI` and `get-settings().default model`. Inspect via `get-settings` whenever you see an unexpected model being selected.

## Known `ai_name` providers (from `list-ai-services`)

| `ai_name` | Scope | Typical use |
|---|---|---|
| `chatgpt` | text | OpenAI-class models (`gpt-5.5` and family). |
| `gemini` | text | Gemini-class models (e.g., `gemini-3.5-flash` is the session default in some installs). |
| `claude` | text | Anthropic Claude-class models. |
| `midjourney` | image | Midjourney design service. |
| `sora-images` | image | Sora design service. |
| `flux` | image | Flux design service. |
| `tts` / `speech` | audio | Text-to-speech synthesis. |
| `voice-clone` | audio | Voice cloning. |
| `music` | audio | Music generation. |
| `video` | video | Video generation. |

> The above list is illustrative — run `list-ai-services` in your session to confirm what is currently provisioned to your account.

## Known `model_type` patterns

These are the identifiers exercised during this skill's authoring session. Always confirm via `list-models(ai_name=...)` in your own session before treating any of these as canonical — syntx.ai may publish new ids at any time.

| `ai_name` | `model_type` (literal) | Notes |
|---|---|---|
| `chatgpt` | `gpt-5.5` | Default GPT-5 family used in planning session. No `-mini` suffix. |
| `gemini` | `gemini-3.5-flash` | Lightweight default observed in this install. |
| `claude` | varies | Discover via `list-models(ai_name="claude")`. |
| `midjourney`, `sora-images`, `flux` | design-service specific | `list-models` returns design variants per provider. |

### Identifier that DOES NOT exist

- `gpt-5-mini` → returns `400 — model not found`.
- `gpt-5-mini-2025-08-07` → returns `400 — model not found` (mirroring OpenAI's date-suffixed ids does not work on syntx.ai).
- `gpt-5.5-mini` → returns `400 — model not found`.

If you must guard against a model id typo, capture the full `detail.message` from a 400 response — the server echoes the valid list back to the caller.

## Default resolution

Resolution order per call when caller omits parameters:

1. `ai_name` → `get-settings().defaultAI` → server default if unset.
2. `model_type` → `get-settings().default model` → server default if unset.

To switch defaults at runtime:

- `set-default-ai("chatgpt")`
- `set-default-model("gpt-5.5")`

To clear an override and revert to server-default behavior, pass `null` to `set-default-model`.

## Cost & limit checks

`get-model-info` returns per-model data including:

- Pricing (`chars_count`, `batch_size`, `mode`, `quality`, `video_duration` — depends on model family).
- Limits (image resolution, video duration, sample rate for audio).

Pass the relevant params explicitly when invoking the corresponding tool. For image generation via `generate-image`, pass `model_type` (`"gpt-image-2"` in current catalogs) and `resolution` (e.g., `"720x1280"`). For audio via `text_to_audio`, pass `voice_id`, `sample_rate`, `bitrate`, etc.

## Catalog refresh cadence

| Event | Action |
|---|---|
| First call in a session | `list-ai-services` + `list-models` for likely `ai_name`. |
| 400 response on `model_type` | Re-run `list-models`; copy verbatim. |
| Provider change announcement | `list-models` again before any production use. |
| Session timeout / reconnect | Defaults may have changed server-side — call `get-settings`. |
