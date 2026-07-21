import { createHash, randomBytes } from 'node:crypto';
import { BaseClient } from './client';
import { SyntxAuthError } from './errors';
import type {
  AuthStart,
  AuthTokenStatus,
  EmailOtpOptions,
  EmailOtpSendResult,
  EmailOtpVerifyResult,
  GoogleTokenResponse,
} from './types';

/** base64url-encode without padding (RFC 7636 §4.2). */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Authentication module for syntx.ai.
 *
 * Supports multiple OAuth providers (Telegram, Google, Email).
 * The exact token mechanism may vary; this module provides the
 * standard Bearer token flow and placeholders for OAuth redirects.
 */
export class SyntxAuth {
  constructor(private readonly client: BaseClient) {}

  /**
   * Set the API token directly (e.g. after obtaining it via OAuth).
   */
  setToken(token: string): void {
    this.client.setToken(token);
  }

  /**
   * Get the current token.
   */
  getToken(): string | undefined {
    return this.client.getToken();
  }

  /**
   * Check if a token is set.
   */
  isAuthenticated(): boolean {
    return this.client.isAuthenticated();
  }

  /**
   * Clear the current token.
   */
  logout(): void {
    this.client.setToken(undefined);
  }

  /**
   * Placeholder: Initiate Telegram OAuth login.
   * In a browser, this typically opens a Telegram login widget popup
   * or redirects to the Telegram OAuth page.
   */
  getTelegramLoginUrl(redirectUri?: string, botId = 'syntxaibot'): string {
    const url = new URL('https://oauth.telegram.org/auth');
    url.searchParams.set('bot_id', botId);
    if (redirectUri) {
      url.searchParams.set('origin', redirectUri);
    }
    return url.toString();
  }

  /**
   * Generate a PKCE key pair (RFC 7636): a high-entropy `code_verifier`
   * and its `S256` `code_challenge`. Use the challenge when building the
   * authorization URL ({@link getGoogleLoginUrl}) and keep the verifier
   * secret until {@link exchangeGoogleCode}.
   */
  static generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
    return { codeVerifier, codeChallenge };
  }

  /**
   * Build a Google OAuth 2.0 authorization URL using the
   * **Authorization Code + PKCE** flow (M3, v0.3.0).
   *
   * The legacy Implicit Grant (`response_type=token`) is deprecated by
   * OAuth 2.0 Security Best Current Practice — access tokens must no longer
   * travel through the browser front-channel. Pass the `codeChallenge` from
   * {@link generatePkcePair} and, after the redirect, call
   * {@link exchangeGoogleCode} with the matching verifier.
   *
   * @param clientId  Google OAuth client ID (public / installed-app client).
   * @param redirectUri  Registered redirect URI.
   * @param options.state  Optional CSRF token round-tripped through Google.
   * @param options.codeChallenge  PKCE S256 challenge. REQUIRED in practice —
   *   omit only when talking to a legacy authorization server; Google
   *   accepts the flow without it but you lose the interception defence.
   */
  getGoogleLoginUrl(
    clientId: string,
    redirectUri: string,
    options: { state?: string; codeChallenge?: string } = {},
  ): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'email profile');
    if (options.state) {
      url.searchParams.set('state', options.state);
    }
    if (options.codeChallenge) {
      url.searchParams.set('code_challenge', options.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  /**
   * Exchange an authorization `code` (plus the PKCE `codeVerifier`) for
   * tokens at Google's token endpoint. Intended for public clients
   * (installed apps / CLI tools) where no `client_secret` exists — the
   * verifier proves continuity with the original authorization request.
   *
   * This call bypasses the syntx.ai API base URL on purpose: it talks to
   * `https://oauth2.googleapis.com/token` directly. If your deployment
   * instead routes the exchange through a syntx.ai endpoint that accepts
   * `code_verifier`, prefer that endpoint and keep this method for local
   * development.
   *
   * Throws `SyntxAuthError` when Google rejects the exchange.
   */
  async exchangeGoogleCode(options: {
    clientId: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  }): Promise<GoogleTokenResponse> {
    const { clientId, redirectUri, code, codeVerifier } = options;
    if (!code.trim() || !codeVerifier.trim()) {
      throw new SyntxAuthError('exchangeGoogleCode requires non-empty code and codeVerifier.');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    });
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const detail =
        typeof payload.error_description === 'string'
          ? payload.error_description
          : typeof payload.error === 'string'
            ? payload.error
            : response.statusText;
      throw new SyntxAuthError(`Google code exchange failed (${response.status}): ${detail}`);
    }
    return payload as unknown as GoogleTokenResponse;
  }

  /**
   * Request an OTP code to be mailed to `email`.
   *
   * Calls `POST /api/v1/auth/email/send-otp` with `{ email, ref_uuid, utm }`.
   * Does NOT install a token — this method only kicks off delivery. Pair
   * with {@link verifyEmailOtp} (or {@link loginWithEmail} for the
   * callback-driven one-shot) once the user has read the code from their
   * inbox.
   *
   * Throws `SyntxAPIError` on transport / 4xx / 5xx failures.
   */
  async sendEmailOtp(email: string, options: EmailOtpOptions = {}): Promise<EmailOtpSendResult> {
    return this.client.post<EmailOtpSendResult>('/api/v1/auth/email/send-otp', {
      email,
      ref_uuid: options.ref_uuid ?? null,
      utm: options.utm ?? '',
    });
  }

  /**
   * Exchange an OTP code for a JWT bearer token.
   *
   * Calls `POST /api/v1/auth/email/verify-otp` with
   * `{ email, otp_code, ref_uuid, utm }`. When the response carries a `token`
   * field, it is installed as the active bearer via {@link setToken} so the
   * caller can immediately use authenticated endpoints.
   *
   * Pass `options.install === false` to peek at the response without
   * committing the token to the in-process bearer store (useful for UIs that
   * want to confirm before swapping identity).
   *
   * If the server returns the JWT under a different key, `token` will be
   * `undefined` and the SDK will not install anything — the caller can
   * inspect the raw fields via the returned `EmailOtpVerifyResult` and call
   * {@link setToken} manually.
   */
  async verifyEmailOtp(
    email: string,
    otpCode: string,
    options: EmailOtpOptions & { install?: boolean } = {},
  ): Promise<EmailOtpVerifyResult> {
    const code = String(otpCode ?? '').trim();
    if (!code) {
      throw new SyntxAuthError('otpCode must be a non-empty string.');
    }
    const result = await this.client.post<EmailOtpVerifyResult>(
      '/api/v1/auth/email/verify-otp',
      {
        email,
        otp_code: code,
        ref_uuid: options.ref_uuid ?? null,
        utm: options.utm ?? '',
      },
    );
    const shouldInstall = options.install !== false;
    if (
      shouldInstall &&
      result &&
      typeof result.token === 'string' &&
      result.token.length > 0
    ) {
      this.setToken(result.token);
    }
    return result;
  }

  /**
   * One-shot email-OTP login.
   *
   * Convenience wrapper around {@link sendEmailOtp} + {@link verifyEmailOtp}.
   * Use this when you have a way to obtain the OTP from the user without
   * surfacing a separate tool call (e.g. an interactive CLI prompt).
   *
   * The OTP must be supplied by `options.otpProvider` — an async callback
   * that resolves with the code the user read from their inbox. This avoids
   * blocking forever: if no provider is given, the method throws
   * `SyntxAuthError` immediately.
   */
  async loginWithEmail(
    email: string,
    options: EmailOtpOptions & {
      otpProvider?: () => Promise<string>;
    } = {},
  ): Promise<EmailOtpVerifyResult> {
    const { otpProvider, ...otpOptions } = options;
    if (typeof otpProvider !== 'function') {
      throw new SyntxAuthError(
        'loginWithEmail requires options.otpProvider — a () => Promise<string> ' +
          'that resolves with the OTP code from the user.',
      );
    }
    await this.sendEmailOtp(email, otpOptions);
    const otpCode = (await otpProvider()).trim();
    if (!otpCode) {
      throw new SyntxAuthError('OTP provider returned an empty code.');
    }
    // `verifyEmailOtp` re-trims and validates, so no need to pre-validate here.
    return this.verifyEmailOtp(email, otpCode, otpOptions);
  }

  /**
   * Validate the current token by calling /api/v1/user.
   * Throws SyntxAuthError if no token is set.
   */
  async validateToken(): Promise<boolean> {
    if (!this.isAuthenticated()) {
      throw new SyntxAuthError('No token set');
    }
    try {
      await this.client.get('/api/v1/user');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start an authentication session on syntx.ai.
   *
   * Calls `POST /api/v1/auth/startauth` and returns the session UUID.
   * The user must then complete the auth flow through one of the supported
   * providers — for Telegram this means opening the deep-link returned by
   * {@link getTelegramAuthLink} and pressing Start in the bot.
   *
   * Pair with {@link pollAuthToken} (or {@link loginWithTelegram} for the
   * all-in-one flow) to obtain the JWT bearer token.
   */
  async startAuth(): Promise<AuthStart> {
    return this.client.post<AuthStart>('/api/v1/auth/startauth');
  }

  /**
   * Poll the status of an auth session.
   *
   * Calls `GET /api/v1/auth/token/{uuid}`. Typical responses:
   * - `{ valid: false, complete: false }` — unknown/expired UUID
   * - `{ valid: true,  complete: false }` — waiting for the user
   * - `{ valid: true,  complete: true, token }` — auth finished, JWT present
   *
   * Does NOT mutate the local token — call {@link setToken} once `complete`
   * becomes true.
   */
  async pollAuthToken(uuid: string): Promise<AuthTokenStatus> {
    return this.client.get<AuthTokenStatus>(`/api/v1/auth/token/${encodeURIComponent(uuid)}`);
  }

  /**
   * Build a `t.me` deep-link that opens the syntx.ai Telegram bot with a
   * pre-filled `start` payload. When the user presses Start, the bot
   * receives `auth_<uuid>` and binds the session to the user's Telegram
   * identity, which unblocks the polling endpoint.
   *
   * `botUsername` defaults to `syntxaibot` (the public bot used by
   * syntx.ai). Override only if you are pointing at a custom bot.
   */
  getTelegramAuthLink(uuid: string, botUsername = 'syntxaibot'): string {
    return `https://telegram.me/${botUsername}?start=auth_${uuid}`;
  }

  /**
   * Full Telegram device-auth flow:
   * 1. Create a session via {@link startAuth}.
   * 2. Return the bot deep-link — the caller is expected to open it
   *    (browser tab, `open()` from a UI, or hand it to the user).
   * 3. Poll `GET /api/v1/auth/token/{uuid}` every `pollIntervalMs`
   *    until `complete === true` or `valid === false`.
   * 4. Persist the JWT via {@link setToken}.
   *
   * The returned object is intentionally explicit so callers can render
   * the link separately from the polling loop and decide what to do on
   * cancellation / timeout.
   */
  async loginWithTelegram(options: {
    botUsername?: string;
    pollIntervalMs?: number;
    timeoutMs?: number;
    /** Called every poll with the latest status — useful for UIs. */
    onPoll?: (status: AuthTokenStatus, elapsedMs: number) => void;
    /** Called once when the bot link is ready — receives the deep-link. */
    onLink?: (deepLink: string, uuid: string) => void;
  } = {}): Promise<{
    uuid: string;
    deepLink: string;
    token: string;
    status: AuthTokenStatus;
    elapsedMs: number;
  }> {
    const {
      botUsername = 'syntxaibot',
      pollIntervalMs = 3000,
      timeoutMs = 5 * 60_000, // 5 min — Telegram Start button is manual
      onPoll,
      onLink,
    } = options;

    const { uuid } = await this.startAuth();
    const deepLink = this.getTelegramAuthLink(uuid, botUsername);
    if (onLink) onLink(deepLink, uuid);

    const start = Date.now();
    // Hard ceiling: stop after `timeoutMs` regardless of cadence.
    while (Date.now() - start < timeoutMs) {
      const status = await this.pollAuthToken(uuid);
      const elapsedMs = Date.now() - start;
      if (onPoll) onPoll(status, elapsedMs);

      if (!status.valid) {
        throw new SyntxAuthError(
          `Auth session ${uuid} is invalid (expired or unknown). Restart the flow.`,
        );
      }
      if (status.complete) {
        if (!status.token) {
          throw new SyntxAuthError(
            `Auth session ${uuid} is complete but no token was returned.`,
          );
        }
        this.setToken(status.token);
        return { uuid, deepLink, token: status.token, status, elapsedMs };
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new SyntxAuthError(
      `Telegram auth timed out after ${timeoutMs}ms. User did not press Start in the bot.`,
    );
  }
}