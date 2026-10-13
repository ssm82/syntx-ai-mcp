import { SyntxAPIError, SyntxAuthError, SyntxCaptchaRequiredError } from './errors';

/** Challenge action the SPA asks Turnstile to attest to. */
export type CaptchaAction = 'register' | 'generate';

/** Context handed to a {@link CaptchaTokenProvider} for one token mint. */
export interface CaptchaRequest {
  /** Action to attest, taken from the local route table or the server challenge. */
  action: string;
  /** Absolute request URL, query string stripped. */
  url: string;
  /** Sitekey advertised by the challenge, when the server supplied one. */
  sitekey?: string;
  /** True when the server escalated to a human-interactive widget. */
  interactive: boolean;
  /** Machine-readable reason from the server challenge, when present. */
  reason?: string;
}

/**
 * Mints a Cloudflare Turnstile token for one gated request.
 *
 * The SDK deliberately ships no solver: Turnstile tokens are bound to a
 * browser context, and standing up a headless browser inside an MCP server
 * is an operational decision its operator has to make. Return `undefined`
 * (or omit the provider) to decline — the SDK then surfaces
 * {@link SyntxCaptchaRequiredError} instead of retrying.
 */
export type CaptchaTokenProvider = (
  request: CaptchaRequest,
) => Promise<string | undefined> | string | undefined;

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
  /**
   * Optional Turnstile token source for the gated generative routes.
   * When omitted the client sends no `X-Captcha-Token` and surfaces a
   * {@link SyntxCaptchaRequiredError} on challenge instead of retrying.
   */
  captchaProvider?: CaptchaTokenProvider;
}

/**
 * Routes the upstream gates behind Turnstile, mirrored verbatim from the
 * prod-SPA request interceptor (bundle `1791811899`, table `$_e`).
 *
 * `POST /auth/email/send-otp` attests `register`; every generative entry
 * point attests `generate`. Paths are matched *after* the `api/vN/`
 * prefix is stripped, because that is what sits in front of them.
 */
const CAPTCHA_ROUTES: ReadonlyArray<{ re: RegExp; action: CaptchaAction }> = [
  { re: /^auth\/email\/send-otp$/, action: 'register' },
  { re: /^design\/generate$/, action: 'generate' },
  { re: /^video\/generate$/, action: 'generate' },
  { re: /^audio\/generate$/, action: 'generate' },
  { re: /^llm\/generate$/, action: 'generate' },
  { re: /^prompt-enhancer\/(enhance|generate)(\/start)?$/, action: 'generate' },
];

/**
 * Challenge reasons the server escalates to a human-interactive widget.
 * Anything outside this set (and outside the terminal set below) is
 * retried with a silent token.
 */
const INTERACTIVE_REASONS = ['interactive_required', 'bot_score', 'ip_velocity'];

/** Reasons no amount of re-minting will fix. */
const TERMINAL_REASONS = ['action_mismatch', 'cdata_', 'hostname_mismatch'];

/**
 * Reduce a request path to the form the gate table is written against:
 * origin, leading slashes and the `api/vN/` mount prefix removed, query
 * dropped. Accepts both the SDK-style `/api/v1/…` path and the absolute
 * URL the request layer works with.
 */
function normaliseRoute(path: string): string {
  return String(path)
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
    .replace(/^\/+/, '')
    .replace(/^api\/v\d+\//, '')
    .split('?')[0];
}

/**
 * Challenge action for a request path, or `null` when the route is not
 * captcha-gated. Exported so callers can pre-mint a token themselves.
 */
export function captchaActionFor(path: string): CaptchaAction | null {
  const route = normaliseRoute(path);
  return CAPTCHA_ROUTES.find((entry) => entry.re.test(route))?.action ?? null;
}

interface CaptchaChallenge {
  action?: string;
  reason?: string;
  sitekey?: string;
  interactiveAction?: string;
  interactiveSitekey?: string;
}

/**
 * Decide whether a 403 body is a Turnstile challenge rather than an
 * authentication failure.
 *
 * A real auth rejection is a bare string detail (`{"detail":"Not
 * authenticated"}`), so the discriminator is a *structured* detail object
 * carrying a sitekey or action. Anything else stays an auth error — we
 * must not misreport a credential problem as a solvable puzzle.
 */
function readCaptchaChallenge(body: unknown): CaptchaChallenge | null {
  if (typeof body !== 'object' || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const raw = detail as Record<string, unknown>;
  const sitekey = typeof raw.sitekey === 'string' ? raw.sitekey : undefined;
  const interactiveSitekey =
    typeof raw.interactiveSitekey === 'string' ? raw.interactiveSitekey : undefined;
  const action = typeof raw.action === 'string' ? raw.action : undefined;
  if (!sitekey && !interactiveSitekey && !action) return null;
  return {
    action,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
    sitekey,
    interactiveAction:
      typeof raw.interactiveAction === 'string' ? raw.interactiveAction : undefined,
    interactiveSitekey,
  };
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
  private readonly captchaProvider: CaptchaTokenProvider | undefined;

  constructor(config: SyntxClientConfig = {}) {
    this.baseURL = (config.baseURL ?? 'https://api.syntx.ai').replace(/\/$/, '');
    this.token = config.token;
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = Math.max(1, config.maxRetries ?? 3);
    this.captchaProvider = config.captchaProvider;
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
    // 401 is unambiguously a credential problem; do not spend a body read
    // on it. 403 is NOT — the upstream also returns 403 for a Turnstile
    // challenge, so it has to be read and discriminated below.
    if (response.status === 401) {
      throw new SyntxAuthError('Authentication failed (401)');
    }

    let body: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      const text = await response.text();
      body = text;
    }

    if (response.status === 403) {
      const challenge = readCaptchaChallenge(body);
      if (challenge) {
        throw new SyntxCaptchaRequiredError(
          BaseClient.challengeMessage(challenge),
          challenge.action,
          challenge.reason,
          challenge.sitekey,
          challenge.interactiveAction,
          challenge.interactiveSitekey,
          !TERMINAL_REASONS.includes(challenge.reason ?? ''),
          body,
        );
      }
      throw new SyntxAuthError('Authentication failed (403)');
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

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | string[] | undefined>,
  ): string {
    const url = new URL(this.baseURL + path);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined) return;
        if (Array.isArray(value)) {
          // `scope[]=video&scope[]=audio` style, used by e.g. `GET /files/generated`.
          for (const v of value) url.searchParams.append(`${key}[]`, String(v));
        } else {
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

  /** Human-readable summary for {@link SyntxCaptchaRequiredError}. */
  private static challengeMessage(challenge: CaptchaChallenge): string {
    const reason = challenge.reason ?? 'captcha_required';
    const action = challenge.action ?? 'generate';
    return (
      `Upstream requires a Cloudflare Turnstile token for action "${action}" (reason: ${reason}). ` +
      'Configure `captchaProvider` on the client to mint one; the SDK does not solve challenges itself.'
    );
  }

  /**
 * Single entry point for every request: mints a proactive token when the
 * route is gated, then transparently replays once against an interactive
 * challenge if — and only if — the provider can produce a token.
 *
 * The replay mirrors the SPA's `__captchaRetried` guard: at most one
 * captcha-driven retry per call, so a misbehaving provider cannot spin.
 * Transport retries (`requestWithRetry`) are unaffected — a 403 is not
 * retryable there, so a challenge always surfaces here first.
 */
private async send<T>(
  url: string,
  makeOptions: (captchaHeaders: Record<string, string>) => RequestInit,
  retryable: boolean,
  timeoutOverride?: number,
): Promise<T> {
  const firstAttempt = await this.mintCaptcha(url, false);
  try {
    return await this.requestWithRetry<T>(
      url,
      makeOptions(firstAttempt ?? {}),
      retryable,
      timeoutOverride,
    );
  } catch (error) {
    if (!(error instanceof SyntxCaptchaRequiredError) || !error.retryable) throw error;
    // Mirror the SPA's escalation: mint an interactive-widget token when the
    // reason calls for one (or the server handed us an interactive sitekey),
    // otherwise a plain silent token is enough.
    const wantsInteractive =
      INTERACTIVE_REASONS.includes(error.reason ?? '') || Boolean(error.interactiveSitekey);
    const replay = await this.mintCaptcha(url, wantsInteractive, error);
    if (!replay) throw error;
    return this.requestWithRetry<T>(url, makeOptions(replay), retryable, timeoutOverride);
  }
}

  /**
   * Ask the configured provider for a Turnstile token for `url`.
   *
   * Returns the header block to merge, or `undefined` when there is nothing
   * to add (no provider, route not gated, provider declined, or the provider
   * threw — a broken provider must not mask the original challenge).
   */
  private async mintCaptcha(
    url: string,
    interactive: boolean,
    challenge?: SyntxCaptchaRequiredError,
  ): Promise<Record<string, string> | undefined> {
    if (!this.captchaProvider) return undefined;
    const action = challenge?.action ?? captchaActionFor(url);
    if (action === null || action === undefined) return undefined;

    let token: string | undefined;
    try {
      token = await this.captchaProvider({
        action,
        url: url.split('?')[0],
        sitekey: challenge?.interactiveSitekey ?? challenge?.sitekey,
        interactive,
        reason: challenge?.reason,
      });
    } catch {
      return undefined;
    }
    if (!token) return undefined;

    return interactive
      ? { 'X-Captcha-Token': token, 'X-Captcha-Widget': 'interactive' }
      : { 'X-Captcha-Token': token };
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | string[] | undefined>,
  ): Promise<T> {
    // GETs are idempotent — safe to retry on transient failures.
    const url = this.buildUrl(path, params);
    return this.send<T>(
      url,
      (captcha) => ({ method: 'GET', headers: { ...this.baseHeaders(), ...captcha } }),
      true,
    );
  }

  /**
   * Open a streaming response without consuming its body.
   *
   * Returns the raw {@link Response} so the caller can read the body as a
   * `ReadableStream<Uint8Array>` (e.g. for Server-Sent Events). The
   * response body is intentionally NOT consumed — `handleResponse` would
   * buffer it and break the stream.
   *
   * Goes through the same timeout/abort/error plumbing as `get`, but skips
   * the retry layer (an open stream cannot be replayed). Status errors are
   * surfaced as `Response` objects so the caller can inspect `ok`; abort is
   * surfaced as `SyntxAPIError(408)` like the other methods.
   *
   * `init.headers` are merged on top of {@link baseHeaders}, so callers can
   * override `Accept` (e.g. to `text/event-stream`) without rebuilding the
   * auth headers.
   */
  async stream(
    path: string,
    init?: { headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Response> {
    const headers = { ...this.baseHeaders(), ...(init?.headers ?? {}) };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? this.timeout);

    const onCallerAbort = () => controller.abort();
    if (init?.signal) {
      if (init.signal.aborted) controller.abort();
      else init.signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      const response = await fetch(this.baseURL + path, {
        ...(init?.signal ? { signal: controller.signal } : {}),
        headers,
      });
      clearTimeout(timer);
      init?.signal?.removeEventListener('abort', onCallerAbort);
      return response;
    } catch (error) {
      clearTimeout(timer);
      init?.signal?.removeEventListener('abort', onCallerAbort);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SyntxAPIError('Request timeout', 408);
      }
      throw error;
    }
  }

  /**
   * Shared implementation for the JSON-bodied HTTP verbs (POST / PATCH /
   * PUT / DELETE): identical pipeline, only the method differs. `body`
   * is falsy-skipped so body-less calls (e.g. toggles) send no payload.
   */
  private async jsonRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.send<T>(
      url,
      (captcha) => ({
        method,
        headers: { ...this.jsonHeaders(), ...captcha },
        body: body ? JSON.stringify(body) : undefined,
      }),
      false,
    );
  }

  async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.jsonRequest<T>('POST', path, body, params);
  }

  async patch<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.jsonRequest<T>('PATCH', path, body, params);
  }

  async put<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.jsonRequest<T>('PUT', path, body, params);
  }

  async delete<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.jsonRequest<T>('DELETE', path, body, params);
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
    const url = this.baseURL + path;
    return this.send<T>(
      url,
      (captcha) => ({ method: 'POST', headers: { ...this.baseHeaders(), ...captcha }, body: formData }),
      false,
      timeoutOverride,
    );
  }
}
