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
