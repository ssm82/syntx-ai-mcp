/**
 * Typed configuration for the syntx-ai-mcp server.
 *
 * All values originate from environment variables (see {@link loadConfig}),
 * but can also be supplied programmatically to {@link createMcpServer}.
 */

export type TransportKind = 'stdio' | 'http';

/** How the streaming chat endpoint should receive assistant replies. */
export type StreamMode = 'auto' | 'stream' | 'poll' | 'off';

export interface McpServerConfig {
  /** syntx.ai Bearer token. Optional — may be set at runtime via the `set-token` tool. */
  token?: string;
  /** Base URL of the syntx.ai API. */
  baseURL: string;
  /** HTTP request timeout in milliseconds. */
  timeout: number;
  /** Preferred language code (used by WebSocket streaming and locales). */
  lang: string;
  /** Default AI service name used when a tool omits `ai_name` (e.g. "chatgpt"). */
  defaultAI: string;
  /** Default model type used when a tool omits `model`. */
  defaultModel?: string;
  /** Polling interval (ms) for `wait-for-response` / `ask`. */
  pollInterval: number;
  /** Max wait time (ms) for a streamed/polling assistant response. */
  pollTimeout: number;
  /** MCP transport kind. */
  transport: TransportKind;
  /** Port for the HTTP transport. */
  httpPort: number;
  /**
   * Default streaming strategy for chat tools.
   *  - `'auto'`   — try WSS, fall back to REST polling on error
   *  - `'stream'` — WSS only (failures surface to the caller)
   *  - `'poll'`   — REST polling only (legacy behaviour)
   *  - `'off'`    — disable `wait-for-response`/`ask` streaming helpers entirely
   */
  streamMode: StreamMode;
  /** Override the WSS base URL (used by streaming endpoints). */
  wsURL: string;
}

/** Sensible defaults applied when an environment variable is absent. */
export const DEFAULT_CONFIG: McpServerConfig = {
  baseURL: 'https://api.syntx.ai',
  timeout: 30000,
  lang: 'en',
  defaultAI: 'chatgpt',
  pollInterval: 5000,
  pollTimeout: 600000,
  transport: 'stdio',
  httpPort: 3000,
  streamMode: 'auto',
  wsURL: 'wss://api.syntx.ai/api/v1',
};

/** Environment variable names → config keys mapping. */
export const ENV_KEYS = {
  token: 'SYNTX_TOKEN',
  baseURL: 'SYNTX_BASE_URL',
  timeout: 'SYNTX_TIMEOUT',
  lang: 'SYNTX_LANG',
  defaultAI: 'SYNTX_DEFAULT_AI',
  defaultModel: 'SYNTX_DEFAULT_MODEL',
  pollInterval: 'SYNTX_POLL_INTERVAL',
  pollTimeout: 'SYNTX_POLL_TIMEOUT',
  transport: 'MCP_TRANSPORT',
  httpPort: 'MCP_HTTP_PORT',
  streamMode: 'SYNTX_STREAM_MODE',
  wsURL: 'SYNTX_WS_URL',
} as const;
