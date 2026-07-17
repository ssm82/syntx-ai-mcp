/**
 * Custom error thrown by the Syntx SDK on API failures.
 */
export class SyntxAPIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly responseBody?: unknown
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
