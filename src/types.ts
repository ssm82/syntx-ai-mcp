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
 * User profile from /api/v1/user
 */
export interface User {
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
  pollInterval?: number;
  boundary?: string;
  pageSize?: number;
  preWaitTimeout?: number;
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
