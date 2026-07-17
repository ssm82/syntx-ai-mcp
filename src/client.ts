import { SyntxAPIError, SyntxAuthError } from './errors';

export interface SyntxClientConfig {
  /** Base URL for the API. Defaults to https://api.syntx.ai */
  baseURL?: string;
  /** API token or session token */
  token?: string;
  /** Request timeout in ms. Defaults to 30000 */
  timeout?: number;
}

export class BaseClient {
  readonly baseURL: string;
  private token: string | undefined;
  readonly timeout: number;

  constructor(config: SyntxClientConfig = {}) {
    this.baseURL = (config.baseURL ?? 'https://api.syntx.ai').replace(/\/$/, '');
    this.token = config.token;
    this.timeout = config.timeout ?? 30000;
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
    options: RequestInit
  ): Promise<T> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeout);

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
      throw new SyntxAPIError(
        message,
        response.status,
        undefined,
        body
      );
    }

    return body as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(this.baseURL + path);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return this.requestWithTimeout<T>(url.toString(), {
      method: 'GET',
      headers,
    });
  }

  async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(this.baseURL + path);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return this.requestWithTimeout<T>(url.toString(), {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(this.baseURL + path);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return this.requestWithTimeout<T>(url.toString(), {
      method: 'PATCH',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(this.baseURL + path);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return this.requestWithTimeout<T>(url.toString(), {
      method: 'DELETE',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}
