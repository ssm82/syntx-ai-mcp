import { BaseClient } from './client';
import { SyntxAuthError } from './errors';

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
   * Placeholder: Initiate Google OAuth login.
   * You will need to configure your Google OAuth client_id.
   */
  getGoogleLoginUrl(clientId: string, redirectUri: string, state?: string): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('scope', 'email profile');
    if (state) {
      url.searchParams.set('state', state);
    }
    return url.toString();
  }

  /**
   * Placeholder: Email/password login.
   *
   * The actual endpoint and payload format are unknown from the snapshot.
   * This method attempts a POST to /api/v1/auth/login; you may need
   * to adjust the path and payload after inspecting real traffic.
   */
  async loginWithEmail(email: string, password: string): Promise<{ token: string; user: unknown }> {
    const response = await this.client.post<{ token: string; user: unknown }>('/api/v1/auth/login', {
      email,
      password,
    });
    if (response.token) {
      this.setToken(response.token);
    }
    return response;
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
}
