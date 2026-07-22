import { SyntxAPIError, SyntxAuthError } from './errors';

export interface SyntxClientConfig {
  /** Base URL for the API. Defaults to https://api.syntx.ai */
  baseURL?: string;
  /** API token or session token */
  token?: string;
  /** Request timeout in ms. Defaults to 30000 */
  timeout?: number;
  /**
   * Max attempts for idempotent GET requests on transient failures
   * (429 / 5xx / network errors / own 408 timeout). Defaults to 3
   * (1 initial try + 2 retries). Mutating requests (POST/PATCH/DELETE)
   * are never retried automatically — e.g. re-sending a chat message
   * would double the token spend.
   */
  maxRetries?: number;
}

/** Backoff schedule: base delay, growth factor, ceiling, jitter. */
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 8000;
const RETRY_JITTER_MS = 250;
/**
 * Upper bound for a `Retry-After` hint we honour. A hostile, buggy, or
 * custom-`baseURL` upstream can advertise arbitrary values (e.g. 86400 s
 * or a far-future HTTP-date) — clamping prevents a single response from
 * parking an MCP request slot for an attacker-chosen duration.
 */
const RETRY_HINT_CAP_MS = 60000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse a `Retry-After` header value into milliseconds.
 * Supports both delta-seconds and HTTP-date forms; returns undefined
 * when the header is absent or unparsable.
 */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - now);
  }
  return undefined;
}

/** True for failures worth another attempt on an idempotent request. */
function isRetryable(error: unknown): boolean {
  if (error instanceof SyntxAPIError) {
    // 408 is our own client-side timeout — a retry on a GET is safe.
    // 429 and 5xx are transient by definition. Other 4xx are caller bugs.
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  // fetch() rejects with TypeError on network-level failures (DNS, reset, …).
  return error instanceof TypeError;
}

export class BaseClient {
  readonly baseURL: string;
  private token: string | undefined;
  readonly timeout: number;
  readonly maxRetries: number;

  constructor(config: SyntxClientConfig = {}) {
    this.baseURL = (config.baseURL ?? 'https://api.syntx.ai').replace(/\/$/, '');
    this.token = config.token;
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = Math.max(1, config.maxRetries ?? 3);
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  getToken(): string | undefined {
    return this.token;
  }

  isAuthenticated(): boolean {
    return !!this.token;
  }

  private async requestWithTimeout<T>(
    url: string,
    options: RequestInit,
    timeoutOverride?: number,
  ): Promise<T> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutOverride ?? this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(id);
      return this.handleResponse<T>(response);
    } catch (error) {
      clearTimeout(id);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SyntxAPIError('Request timeout', 408);
      }
      throw error;
    }
  }

  /**
   * Execute a request, retrying transient failures with exponential
   * backoff + jitter when `retryable` is true. A `Retry-After` hint from
   * a 429 response overrides the computed delay.
   */
  private async requestWithRetry<T>(
    url: string,
    options: RequestInit,
    retryable: boolean,
    timeoutOverride?: number,
  ): Promise<T> {
    const maxAttempts = retryable ? this.maxRetries : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.requestWithTimeout<T>(url, options, timeoutOverride);
      } catch (error) {
        if (attempt >= maxAttempts || !isRetryable(error)) {
          throw error;
        }
        // Clamp the server-supplied hint so a malicious or buggy value
        // (e.g. 24 h, far-future HTTP-date) cannot stall the caller.
        const rawHint = error instanceof SyntxAPIError ? error.retryAfterMs : undefined;
        const hint =
          rawHint !== undefined && rawHint > 0 && rawHint <= RETRY_HINT_CAP_MS ? rawHint : undefined;
        const computed = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS);
        const delay = (hint ?? computed) + Math.floor(Math.random() * RETRY_JITTER_MS);
        await sleep(delay);
      }
    }
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 401 || response.status === 403) {
      throw new SyntxAuthError(
        `Authentication failed (${response.status})`
      );
    }

    let body: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      const text = await response.text();
      body = text;
    }

    if (!response.ok) {
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as Record<string, unknown>).message)
          : response.statusText;
      // Honour `Retry-After` for 429 and any 5xx (especially 503 during
      // overload, which routinely carries the header). Other 4xx are not
      // retried so the hint is moot.
      const status = response.status;
      const retryAfterHint =
        status === 429 || status >= 500 ? parseRetryAfter(response.headers.get('retry-after')) : undefined;
      throw new SyntxAPIError(
        message,
        status,
        undefined,
        body,
        retryAfterHint,
      );
    }

    return body as T;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(this.baseURL + path);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }
    return url.toString();
  }

  /** Shared `Accept` + bearer-token header block used by every request. */
  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.baseHeaders(), 'Content-Type': 'application/json' };
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    // GETs are idempotent — safe to retry on transient failures.
    return this.requestWithRetry<T>(this.buildUrl(path, params), {
      method: 'GET',
      headers: this.baseHeaders(),
    }, true);
  }

  async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.requestWithRetry<T>(this.buildUrl(path, params), {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    }, false);
  }

  async patch<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.requestWithRetry<T>(this.buildUrl(path, params), {
      method: 'PATCH',
      headers: this.jsonHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    }, false);
  }

  async delete<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.requestWithRetry<T>(this.buildUrl(path, params), {
      method: 'DELETE',
      headers: this.jsonHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    }, false);
  }

  /**
   * POST a `FormData` body through the same timeout / auth / error-mapping
   * pipeline as JSON requests.
   *
   * Unlike JSON POSTs, `Content-Type` is intentionally NOT set — fetch
   * fills in the multipart boundary. `timeoutOverride` defaults to 5 min
   * because uploads/transcriptions routinely exceed the 30 s API default.
   */
  async postForm<T>(path: string, formData: FormData, timeoutOverride = 300000): Promise<T> {
    return this.requestWithRetry<T>(this.baseURL + path, {
      method: 'POST',
      headers: this.baseHeaders(),
      body: formData,
    }, false, timeoutOverride);
  }
}
