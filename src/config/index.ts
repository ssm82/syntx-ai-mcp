import {
  DEFAULT_CONFIG,
  ENV_KEYS,
  type McpServerConfig,
  type StreamMode,
  type TransportKind,
} from './schema';

/**
 * Load server configuration from environment variables, merged on top of
 * {@link DEFAULT_CONFIG}. Unknown/invalid values fall back to defaults
 * rather than throwing, so the server always boots.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  return {
    ...DEFAULT_CONFIG,
    token: env[ENV_KEYS.token] || undefined,
    baseURL: env[ENV_KEYS.baseURL] || DEFAULT_CONFIG.baseURL,
    timeout: parseNumber(env[ENV_KEYS.timeout], DEFAULT_CONFIG.timeout),
    lang: env[ENV_KEYS.lang] || DEFAULT_CONFIG.lang,
    defaultAI: env[ENV_KEYS.defaultAI] || DEFAULT_CONFIG.defaultAI,
    defaultModel: env[ENV_KEYS.defaultModel] || undefined,
    pollInterval: parseNumber(env[ENV_KEYS.pollInterval], DEFAULT_CONFIG.pollInterval),
    pollTimeout: parseNumber(env[ENV_KEYS.pollTimeout], DEFAULT_CONFIG.pollTimeout),
    transport: parseTransport(env[ENV_KEYS.transport], DEFAULT_CONFIG.transport),
    httpPort: parseNumber(env[ENV_KEYS.httpPort], DEFAULT_CONFIG.httpPort),
    httpHostname: env[ENV_KEYS.httpHostname] || DEFAULT_CONFIG.httpHostname,
    httpToken: env[ENV_KEYS.httpToken] || undefined,
    streamMode: parseStreamMode(env[ENV_KEYS.streamMode], DEFAULT_CONFIG.streamMode),
    wsURL: env[ENV_KEYS.wsURL] || DEFAULT_CONFIG.wsURL,
    llmSseBaseUrl: env[ENV_KEYS.llmSseBaseUrl] || DEFAULT_CONFIG.llmSseBaseUrl,
    legacyTextTransport: parseBool(env[ENV_KEYS.legacyTextTransport], DEFAULT_CONFIG.legacyTextTransport),
    listLlmModelsCacheMs: parseNumber(env[ENV_KEYS.listLlmModelsCacheMs], DEFAULT_CONFIG.listLlmModelsCacheMs),
  };
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseTransport(raw: string | undefined, fallback: TransportKind): TransportKind {
  if (raw === 'stdio' || raw === 'http') return raw;
  return fallback;
}

function parseStreamMode(raw: string | undefined, fallback: StreamMode): StreamMode {
  if (raw === 'auto' || raw === 'stream' || raw === 'poll' || raw === 'off') return raw;
  return fallback;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

export { DEFAULT_CONFIG, ENV_KEYS };
export type { McpServerConfig, StreamMode, TransportKind } from './schema';
