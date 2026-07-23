/**
 * Pagination metadata returned by list endpoints
 */
export interface Pagination {
  limit: number;
  offset: number;
  total: number;
}

/**
 * OAuth provider configuration from /api/v1/settings
 */
export interface OAuthProvider {
  name: string;
  client_id: string | null;
  scope: string | null;
  redirect_uri: string | null;
  bot_id: string | null;
  active: boolean;
}

/**
 * Application-wide settings
 */
export interface AppSettings {
  oauth: OAuthProvider[];
  ai_list: Record<string, boolean>;
  client_ip: string;
  country_code: string;
}

/**
 * AI service entry (e.g. Midjourney, Sora, Flux)
 */
export interface AIService {
  value: string;
  label: string;
  scope: string;
  active: boolean;
  description: string | null;
}

/**
 * Model settings (upload constraints, accepted types, etc.)
 */
export interface AIModelSettings {
  uploadable?: boolean;
  max_file_size?: number;
  get_cost_params?: string[];
  max_frame_count?: number;
  attach_info_text?: string | null;
  file_count_limit?: number;
  hdr_video_support?: boolean;
  max_video_duration?: number;
  accepted_file_types?: string[];
  allowed_media_types?: string[];
  width?: number;
  height?: number;
  scale_factor?: number;
}

/**
 * Detailed AI model from /api/v1/ai/models
 */
export interface AIModel {
  value: string;
  label: string;
  ai_name: string;
  active: boolean;
  default: boolean;
  description: string | null;
  type: string | null;
  settings: AIModelSettings;
  features: unknown | null;
}

/**
 * User profile from /api/v1/user.
 *
 * `UserInternal` is the raw wire shape including internal identifiers that
 * must never be exposed to MCP clients (e.g. `chatwoot_hmac`, `ym_client_id`
 * — see security advisory H2). The narrow `PublicUser` projection is the
 * only shape safe to surface through MCP tools/resources.
 */
export interface UserInternal {
  id: number;
  user_id: number;
  created_at: number;
  name: string | null;
  username: string | null;
  email: string | null;
  avatar: string | null;
  auth_services: string[];
  ym_client_id: string | null;
  chatwoot_hmac: string | null;
}

/**
 * Public projection of a syntx.ai user profile — the only shape that should
 * be serialised to MCP clients. Internal identifiers (`chatwoot_hmac`,
 * `ym_client_id`, `created_at`) are intentionally excluded.
 */
export interface PublicUser {
  id: number;
  user_id: number;
  name: string | null;
  username: string | null;
  email: string | null;
  avatar: string | null;
  auth_services: string[];
}

/**
 * @deprecated Use {@link UserInternal} for raw SDK responses and {@link PublicUser}
 *   for the sanitised projection. Retained as a type alias so existing callers
 *   continue to compile; new code must pick the appropriate concrete type.
 */
export type User = UserInternal;

/**
 * Token balance from /api/v1/user/balance
 */
export interface Balance {
  balance: number;
  user_id: string;
}

/**
 * Referral info nested in subscription
 */
export interface ReferralInfo {
  link: string;
  token_balance: string;
  total_sales: number;
  sales_amount: {
    rub: number | null;
    usd: number | null;
    eur: number | null;
    xtr: number | null;
  };
}

/**
 * Active subscription from /api/v1/user/subscription
 */
export interface Subscription {
  active: boolean;
  auto_renewal: boolean;
  type: string;
  gateway: string;
  tokens: string;
  canceled: string | null;
  start_date: string;
  end_date: string;
  refferal: ReferralInfo;
}

/**
 * Result of POST /api/v1/auth/startauth.
 * Server creates a pending auth session and returns its UUID.
 * The user must complete auth via the chosen provider (e.g. by pressing Start
 * in the Telegram bot at `https://telegram.me/<bot>?start=auth_<uuid>`).
 */
export interface AuthStart {
  uuid: string;
}

/**
 * Result of GET /api/v1/auth/token/{uuid}.
 * - `valid: false, complete: false` — unknown / expired session
 * - `valid: true, complete: false`  — pending; user has not finished yet
 * - `valid: true, complete: true, token` — auth done, JWT included
 */
export interface AuthTokenStatus {
  valid: boolean;
  complete: boolean;
  token?: string;
}

/**
 * Result of POST /api/v1/auth/email/send-otp.
 *
 * The server's exact response shape is not pinned by the public API; only the
 * "request accepted" status matters to the SDK. The shape is intentionally
 * loose so we can surface unexpected fields back to the caller (and to logs)
 * without a contract churn.
 */
export interface EmailOtpSendResult {
  ok?: boolean;
  [key: string]: unknown;
}

/**
 * Result of POST /api/v1/auth/email/verify-otp.
 *
 * On success the server returns a JWT somewhere in this object — typically
 * as `token`. If the actual contract nests it (e.g. `data.token` or sets it
 * via a cookie) `token` will be `undefined` and the SDK will skip auto-install;
 * callers can still read the raw fields via `[key: string]: unknown`.
 */
export interface EmailOtpVerifyResult {
  token?: string;
  [key: string]: unknown;
}

/**
 * Options accepted by the email-OTP auth methods.
 *
 * Both fields map directly onto the JSON body the syntx.ai API expects:
 *   `{ email, otp_code, ref_uuid?, utm? }`
 */
export interface EmailOtpOptions {
  /** Referral UUID, forwarded as-is. Mirrors the `ref_uuid` field in `requests.js`. */
  ref_uuid?: string | null;
  /** UTM tag for attribution. Mirrors the `utm` field in `requests.js`. */
  utm?: string;
}

/**
 * Token response from Google's OAuth 2.0 token endpoint
 * (`POST https://oauth2.googleapis.com/token`) for the
 * Authorization Code + PKCE exchange (M3).
 */
export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  refresh_token?: string;
  id_token?: string;
}

/**
 * User settings from /api/v1/user/settings
 */
export interface UserSettings {
  settings: {
    user: unknown | null;
    readonly: unknown | null;
  };
  updated_at: string | null;
}

/**
 * Notification item
 */
export interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

/**
 * Notifications response from /api/v1/notification/global
 */
export interface NotificationsResponse {
  notifications: Notification[];
  pagination: Pagination;
}

/**
 * Unread count from /api/v1/notification/unread/count
 */
export interface UnreadCount {
  count: number;
}

/**
 * Plan description block
 */
export interface PlanCard {
  title: string;
  ai_includes: string;
  possibilities: string;
  possibilities_withoutInt?: string;
  possibilities_annual?: string;
  info_annual: string;
  info_monthly: string;
  tokenUsage_annual: string;
  tokenUsage_monthly: string;
  head?: string;
}

/**
 * Plans response wrapper
 */
export interface PlansResponse {
  status: string;
  message: Record<string, PlanCard>;
}

/**
 * Folder item
 */
export interface Folder {
  id: string;
  name: string;
  type: string;
  created_at: string;
}

/**
 * Chat item (from list endpoint)
 */
export interface Chat {
  id: string;
  title: string | null;
  scope: string;
  created_at: string;
  updated_at: string;
  folder_id: string | null;
  model: string | null;
  pinned: boolean;
  /** Present in detailed / create response */
  uuid?: string;
  owner_id?: number;
  deleted?: boolean;
  is_favorite?: boolean;
  folder_uuids?: string[];
  message_count?: number;
  message_limit?: number;
}

/**
 * Message attachment
 */
export interface MessageAttachment {
  id: string;
  type: string;
  url: string;
  name: string;
  size: number;
  mime_type: string;
}

/**
 * Single object inside a message (text, file, image, etc.)
 */
export interface MessageObjectItem {
  id: number;
  message_id: number;
  object_type: string;
  object_url: string | null;
  object_text: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
  model_type: string | null;
  metadata: unknown | null;
}

/**
 * Message in a chat (as returned by GET /api/v1/chats/{id}/messages)
 *
 * Note: The API returns `author_id` instead of `role`.
 * `author_id === -1` means assistant; user's own id means user message.
 * Content is inside `message_object[]`, not a flat `content` string.
 */
export interface Message {
  id: string;
  chat_id: string;
  author_id: number;
  created_at: string;
  updated_at: string;
  is_favorite: boolean;
  /** Message content is an array of objects (text, filetext, image, etc.) */
  message_object: MessageObjectItem[];
}

/**
 * Messages list response
 */
export interface MessagesResponse {
  messages: Message[];
  pagination: Pagination;
}

/**
 * Locale entry
 */
export interface Locale {
  code: string;
  name: string;
  native_name: string;
  active: boolean;
}

/**
 * Promo banner
 */
export interface PromoBanner {
  id: string;
  title: string;
  description: string;
  image_url: string;
  link: string;
  active: boolean;
}

/**
 * v2 model info response
 */
export interface ModelInfoV2 {
  ai_name: string;
  model_type: string;
  info: unknown;
}

/**
 * Message object sent in chat messages
 */
export interface MessageObject {
  object_type: string;
  object_url: string | null;
  object_text: string;
  model_type?: string;
}

/**
 * Design generation settings
 */
export interface DesignSettings {
  n?: number;
  image_url?: string[];
  model_type?: string;
  resolution?: string;
  quality?: string;
  [key: string]: unknown;
}

/**
 * Audio generation settings (TTS, voice change, music, etc.).
 *
 * Mirrors the SPA's `audio.js:sendMessage` `settings` argument. The exact
 * field set is model-specific (see `list-models` scope=audio); only the
 * most common keys are typed, with an open index signature so callers can
 * pass provider-specific options without casts.
 */
export interface AudioSettings {
  voice_id?: string;
  model_type?: string;
  /** Synthesis duration in seconds, when the model supports it. */
  duration?: number;
  /** Sample rate override in Hz (e.g. 22050, 44100). */
  sample_rate?: number;
  /** Music generation style / mood hint (e.g. "pop, sad, rainy night"). */
  prompt?: string;
  [key: string]: unknown;
}

/**
 * Video generation settings (e.g. wan_video, runway, kling).
 *
 * Mirrors the SPA's `video.js:sendMessage` `settings` argument. The SPA
 * rewrites `<<<url>>>` references inside the prompt into per-frame input
 * URLs; `wan_video` reads `settings.file_urls` for the same purpose. The
 * exact field set is model-specific (see `list-models` scope=video); only
 * the most common keys are typed, with an open index signature so callers
 * can pass provider-specific options without casts.
 */
export interface VideoSettings {
  model_type?: string;
  /** Target duration in seconds. Most video models cap at 5–30 s.
   *
   * Note: some providers expose the field under a different name on the
   * wire. `grok_video` (any model: `grok_t2v`, `grok_i2v`, `grok_15_i2v`,
   * `grok_v2v`) requires `video_duration` (NOT `duration`) and accepts only
   * the literal values `"6"` or `"10"`. `kling_*` also reads `video_duration`.
   * Use the `[key: string]: unknown` index signature below to set
   * provider-specific keys without casts.
   */
  duration?: number;
  /** Output resolution. Most providers accept "1280x720" or "720x1280".
   *
   * `grok_video` is the exception — it requires the literal enum
   * `"480p"` or `"720p"`.
   */
  resolution?: string;
  /** Aspect ratio, e.g. "16:9", "9:16", "1:1". */
  aspect_ratio?: string;
  /** Frame rate override (e.g. 24, 30). */
  fps?: number;
  /** Quality preset (e.g. "low", "medium", "high"). */
  quality?: string;
  /** Input media URLs for image-to-video / video-to-video flows. */
  file_urls?: string[];
  /** Seed for deterministic sampling, when supported. */
  seed?: number;
  /** Provider-specific settings passthrough.
   *
   * Use this for fields the typed surface above does not expose. Common
   * examples:
   * - `grok_video`: `{ video_duration: 6, resolution: '720p' }`
   * - `kling_*`: `{ version: '1.6', mode: 'pro', native_audio: true }`
   * - `veo3`: `{ upscale: true }`
   *
   * Values are sent verbatim. Numeric values are not coerced.
   */
  [key: string]: unknown;
}

/**
 * URL-bearing object surfaced from a completed assistant reply.
 *
 * Populated from `message_object[]` entries whose `object_type` is one of
 * `image`, `video`, `audio`, or `file`. `object_text` for media objects is
 * typically empty (the URL is the payload) but is preserved verbatim so a
 * future "captioned image" generation can be surfaced without a contract
 * churn. `metadata` is the original `MessageObjectItem.metadata` value —
 * loosely typed, passed through unchanged.
 */
export interface CompletedMedia {
  object_type: 'image' | 'video' | 'audio' | 'file';
  object_url: string;
  object_text: string;
  metadata: unknown | null;
}

/**
 * Final shape returned by {@link ChatsResource.waitForResponse} /
 * {@link ChatsResource.pollForResponse}.
 *
 * `text` is the concatenation of all `text` / `filetext` objects in the
 * completed reply (separated by `\n\n` when more than one); it may be the
 * empty string when the assistant turn was 100% media.
 *
 * `media` is the list of URL-bearing objects (`image`, `video`, `audio`,
 * `file`) with non-null `object_url`. Empty when the reply was text-only.
 *
 * `message` is the original wire `Message` so callers can still reach the
 * raw `message_object[]` / `created_at` / etc. without a second round-trip.
 */
export interface CompletedMessage {
  text: string;
  media: CompletedMedia[];
  message: Message;
}

/**
 * In-progress status response
 */
/**
 * Item returned by the `/chats/{id}/inprogress` endpoint.
 * The endpoint returns an array of these; an empty array means nothing
 * is currently generating.
 */
export interface InProgressItem {
  message_id: number;
  message_object_id: number;
  object_type: string;
  model_type: string;
  created_at: string;
  task_id: string | null;
  [key: string]: unknown;
}

/** Response from `/chats/{id}/inprogress` — an array of in-progress items. */
export type InProgressResponse = InProgressItem[];

/**
 * Options for waitForResponse polling
 */
export interface WaitForResponseOptions {
  timeout?: number;
  /**
   * Polling ceiling in milliseconds. The poll loop is adaptive: it starts
   * near `0.4 × pollInterval` and backs off geometrically (×1.5) up to this
   * value, so quick replies are seen fast while long generations cost few
   * requests.
   *
   * **Breaking change in 0.3.0:** prior versions used a fixed delay
   * between polls. The option name and units are unchanged but the value
   * is now an upper bound on the (growing) interval, not a constant.
   */
  pollInterval?: number;
  boundary?: string;
  pageSize?: number;
  preWaitTimeout?: number;
  /**
   * Cancellation signal. Checked between poll ticks and during sleeps —
   * when aborted, the wait rejects promptly with `SyntxAbortError` instead
   * of polling until the timeout. MCP tools wire this to the request
   * cancellation signal so a disconnected client stops server-side polling.
   */
  signal?: AbortSignal;
  /**
   * Heartbeat fired once per poll tick with the elapsed time and total
   * budget. MCP tools forward this as `notifications/progress`, which lets
   * clients using `resetTimeoutOnProgress` keep the request alive through
   * long generations instead of dying with an MCP-layer timeout.
   */
  onProgress?: (elapsedMs: number, timeoutMs: number) => void;
  /**
   * Response strategy:
   *   - `'stream'` — open a WSS connection and consume token-by-token
   *   - `'poll'`   — fall back to REST polling (default pre-streaming behaviour)
   *   - `'auto'`   — try WSS first; fall back to polling on connect / protocol error
   */
  mode?: StreamMode;
  /**
   * Optional callback fired on each incremental chunk during streaming.
   * Receives the new fragment and the cumulative text assembled so far.
   */
  onChunk?: (chunk: string, accumulated: string) => void;
  /**
   * Override the WSS base URL (defaults to `wss://api.syntx.ai/api/v1`).
   */
  wsURL?: string;
  /**
   * Preferred language code for the WSS endpoint (defaults to `'en'`).
   */
  lang?: string;
}

/**
 * Strategy for receiving an assistant reply.
 *  - `stream` — real-time via WebSocket (recommended)
 *  - `poll`   — periodic REST polling (legacy, robust on weak networks)
 *  - `auto`   — try stream, fall back to poll
 */
export type StreamMode = 'stream' | 'poll' | 'auto';

/**
 * Options accepted by {@link ChatsResource.streamResponse}.
 */
export interface StreamResponseOptions {
  /**
   * Total wall-clock budget in milliseconds. Resolved/rejected when exceeded.
   * Default 600000 (10 minutes).
   */
  timeout?: number;
  /**
   * Override the WSS base URL.
   */
  wsURL?: string;
  /**
   * Preferred language code passed to the WSS endpoint.
   */
  lang?: string;
  /**
   * Per-chunk callback. Called with the raw delta and the cumulative text.
   */
  onChunk?: (chunk: string, accumulated: string) => void;
  /**
   * Per-message callback. Called once per complete server `message` frame
   * (in addition to onChunk). Useful for callers that need the full frame
   * metadata (model_type, etc.).
   */
  onMessage?: (msg: import('./websocket').StreamingMessage) => void;
  /**
   * Provider (AI service) name to route the prompt to, e.g. `'gemini'`,
   * `'chatgpt'`, `'claude'`. Forwarded to the REST `sendMessage` call so
   * the server picks the right backend.
   */
  aiName?: string;
  /**
   * Fired exactly once when the chat has been created and its UUID is known.
   * Lets callers capture the UUID for follow-up messages or polling.
   */
  onSession?: (chatUuid: string) => void;
  /**
   * Cancellation signal honoured by the internal poll loop — see
   * {@link WaitForResponseOptions.signal}.
   */
  signal?: AbortSignal;
  /**
   * Heartbeat fired once per poll tick while waiting for the reply — see
   * {@link WaitForResponseOptions.onProgress}.
   */
  onProgress?: (elapsedMs: number, timeoutMs: number) => void;
}

/**
 * Final result of a streamed response.
 */
export interface StreamResponseResult {
  /** Full assistant text (concatenation of all chunks). */
  text: string;
  /**
   * Last `message` frame received from the server. May carry metadata
   * (model_type, usage, etc.). `null` if no message was received.
   */
  message: import('./websocket').StreamingMessage | null;
  /** Time elapsed between prompt submission and completion, in milliseconds. */
  elapsedMs: number;
  /**
   * Chat UUID of the session. Use it for follow-up `send-message` /
   * `wait-for-response` calls.
   */
  chatUuid?: string;
}

/**
 * Voice example item
 */
export interface VoiceExample {
  id: string;
  name: string;
  url: string;
  [key: string]: unknown;
}

/**
 * Voice examples paginated response
 */
export interface VoiceExamplesResponse {
  items: VoiceExample[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Frontend app version info from /version.json
 */
export interface VersionInfo {
  version: string;
  [key: string]: unknown;
}

/**
 * Maintenance status from /maintenance-status.json
 */
export interface MaintenanceStatus {
  maintenance: boolean;
  message?: string;
  [key: string]: unknown;
}
