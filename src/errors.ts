/**
 * Custom error thrown by the Syntx SDK on API failures.
 */
export class SyntxAPIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly responseBody?: unknown,
    /**
     * Parsed `Retry-After` header (ms) for 429 responses, when present.
     * Used by the retry layer to honour server-mandated backoff.
     */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'SyntxAPIError';
  }
}

/**
 * Error thrown when authentication is missing or invalid.
 */
export class SyntxAuthError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'SyntxAuthError';
  }
}

/**
 * Error thrown when the upstream API rejects a request with a Cloudflare
 * Turnstile challenge instead of an authentication failure.
 *
 * syntx.ai gates every generative route (`design/generate`, `video/generate`,
 * `audio/generate`, `llm/generate`, `prompt-enhancer/*`) and the registration
 * OTP route behind a Turnstile token carried in the `X-Captcha-Token` header.
 * The server answers a challenge-free request with **403** and a `detail`
 * object; that status used to be collapsed into {@link SyntxAuthError} by
 * `handleResponse`, which hid the challenge from callers entirely.
 *
 * This error extends {@link SyntxAPIError} (not `SyntxAuthError`) so existing
 * `catch` sites keep working while the challenge payload stays addressable.
 *
 * The SDK never solves a challenge itself — it cannot render the widget.
 * Supply a `captchaProvider` to {@link BaseClient} to mint tokens, or read
 * `reason` / `sitekey` off this error and decide what to do.
 */
export class SyntxCaptchaRequiredError extends SyntxAPIError {
  constructor(
    message: string,
    /** Server-declared challenge action (e.g. `"generate"`, `"register"`). */
    public readonly action: string | undefined,
    /** Machine-readable failure reason, e.g. `"interactive_required"`. */
    public readonly reason: string | undefined,
    /** Sitekey for the silent challenge. */
    public readonly sitekey: string | undefined,
    /** Action requested for the human-interactive widget, when any. */
    public readonly interactiveAction: string | undefined,
    /** Sitekey for the human-interactive widget, when any. */
    public readonly interactiveSitekey: string | undefined,
    /**
     * True when the server asked for a human-interactive widget, so a
     * provider-minted token has a chance of satisfying the retry.
     * Terminal reasons (`action_mismatch`, `cdata_`, `hostname_mismatch`)
     * set this to false — retrying them only burns tokens.
     */
    public readonly retryable: boolean,
    responseBody?: unknown,
  ) {
    super(message, 403, undefined, responseBody);
    this.name = 'SyntxCaptchaRequiredError';
  }
}

/**
 * Error thrown when a polling wait exceeds its time budget.
 *
 * Carries the structured context an MCP client needs for self-service
 * recovery: the chat keeps existing on the server after a timeout, so the
 * caller can resume with `get-messages` / `wait-for-response` on
 * {@link chatId} instead of re-sending the prompt (which would duplicate
 * the chat and double the token spend).
 */
export class SyntxTimeoutError extends Error {
  constructor(
    message: string,
    public readonly chatId: string | undefined,
    public readonly elapsedMs: number,
    public readonly timeoutMs: number,
  ) {
    super(message);
    this.name = 'SyntxTimeoutError';
  }
}

/**
 * Error thrown when a wait/poll is cancelled via AbortSignal — typically
 * because the MCP client disconnected or its request-level timeout fired.
 * Distinct from {@link SyntxTimeoutError}: cancellation is not a failure
 * of the upstream API and must not be retried or counted as a poll error.
 */
export class SyntxAbortError extends Error {
  constructor(message = 'Operation cancelled') {
    super(message);
    this.name = 'SyntxAbortError';
  }
}
