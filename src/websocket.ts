/**
 * WebSocket-based real-time messaging for syntx.ai.
 *
 * @deprecated The syntx.ai API does not expose a WebSocket endpoint. The
 *   `wss://api.syntx.ai/api/v1/chats/stream` path is parsed by the server as
 *   `/chats/{chat_uuid}` (returning HTTP 422 for the non-UUID string "stream").
 *   This class is retained for potential future API support but is no longer
 *   used by {@link ChatsResource.streamResponse}, which now polls via REST.
 *   Do not rely on this module for production use.
 *
 * Security note (H3): the bearer token is no longer sent as a URL query
 * parameter (it leaked into access logs, browser history, and proxy traces).
 * In Node it is passed via the `Authorization: Bearer …` header instead.
 * The browser `WebSocket` constructor cannot set custom headers, so this
 * class is Node-only by definition.
 *
 * Migration: prefer {@link ChatsResource.waitForResponse} (REST polling) for
 * any production usage. The `wss://…/api/v1/chats/stream` endpoint has never
 * been functional against the live syntx.ai API.
 */

export interface WSSMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Shape of an incoming WSS frame. The server is permissive — extra fields are
 * preserved on the object so callers can read provider-specific metadata
 * (model_type, usage, etc.).
 */
export interface StreamingMessage {
  /** Server-issued message type, e.g. `session`, `message`, `done`, `error`. */
  type?: string;
  /** Incremental text fragment (when type === 'message'). */
  content?: string;
  /** Cumulative text assembled so far (provided by some providers). */
  text?: string;
  role?: 'user' | 'assistant' | 'system';
  /** Chat session UUID (set on `session` messages). */
  uuid?: string;
  /** Message UUID for the streamed assistant reply. */
  id?: string;
  /** True on the terminal `done` frame. */
  done?: boolean;
  error?: string;
  [key: string]: unknown;
}

export type MessageHandler = (msg: StreamingMessage) => void;
export type ConnectionHandler = () => void;
export type ErrorHandler = (error: Error) => void;

/** Options accepted by {@link SyntxWebSocket}. */
export interface SyntxWebSocketOptions {
  token?: string;
  lang?: string;
  /** Override the WSS base URL (defaults to `wss://api.syntx.ai/api/v1`). */
  baseURL?: string;
  /** Send a ping frame every N ms; 0 disables. Default 30000. */
  pingIntervalMs?: number;
  /** Reconnect automatically when the socket closes unexpectedly. Default false. */
  autoReconnect?: boolean;
}

interface InternalHandler {
  type: string | null; // null === wildcard
  once: boolean;
  fn: MessageHandler;
}

/**
 * Lightweight WSS client for the syntx.ai streaming endpoint.
 *
 * The class intentionally keeps a single connection — `connect()` will throw
 * if the socket is already open, since reusing a WSS across sessions is
 * fragile and not supported by the syntx backend.
 */
export class SyntxWebSocket {
  private ws: WebSocket | null = null;
  private baseURL: string;
  private token: string;
  private lang: string;
  private endpoint: string | null = null;
  private handlers: InternalHandler[] = [];
  private connectHandlers: ConnectionHandler[] = [];
  private disconnectHandlers: ConnectionHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingIntervalMs: number;
  private autoReconnect: boolean;
  private closedByUser = false;

  constructor(tokenOrOptions: string | SyntxWebSocketOptions = {}, lang = 'en') {
    if (typeof tokenOrOptions === 'string') {
      this.token = tokenOrOptions;
      this.lang = lang;
      this.baseURL = 'wss://api.syntx.ai/api/v1';
      this.pingIntervalMs = 30000;
      this.autoReconnect = false;
    } else {
      this.token = tokenOrOptions.token ?? '';
      this.lang = tokenOrOptions.lang ?? 'en';
      this.baseURL = (tokenOrOptions.baseURL ?? 'wss://api.syntx.ai/api/v1').replace(/\/$/, '');
      this.pingIntervalMs = tokenOrOptions.pingIntervalMs ?? 30000;
      this.autoReconnect = tokenOrOptions.autoReconnect ?? false;
    }
  }

  /**
   * Build the WSS URL for an endpoint. The bearer token is intentionally
   * NOT placed in the query string (H3) — only the public `lang` parameter
   * remains. The token travels in the `Authorization: Bearer …` header set
   * by `connect()`.
   */
  private buildUrl(endpoint: string): string {
    const url = new URL(`${this.baseURL}/${endpoint.replace(/^\//, '')}`);
    if (this.lang) url.searchParams.set('lang', this.lang);
    return url.toString();
  }

  /**
   * Open a new WSS connection. Throws if the socket is already open.
   *
   * The bearer token is passed via the `Authorization` header (Node `ws`)
   * rather than as a query parameter (H3). The browser `WebSocket` global
   * cannot set custom headers and will silently drop the auth header; this
   * class is therefore Node-only.
   *
   * @param endpoint - Path under the base URL, e.g. `chats/stream`.
   */
  connect(endpoint: string): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      throw new Error('WebSocket already connected; call close() first');
    }
    this.endpoint = endpoint;
    this.closedByUser = false;
    const url = this.buildUrl(endpoint);
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    // The browser `WebSocket` global does not accept a headers object; the
    // `ws` package used in Node does. Cast through `unknown` because we
    // require Node ≥ 18 (engines.node) and `ws` is on the dev/runtime
    // contract for any caller that imports this module.
    const ws = new (WebSocket as unknown as new (
      url: string,
      opts?: { headers?: Record<string, string> },
    ) => WebSocket)(url, { headers });
    this.ws = ws;

    ws.onopen = () => {
      this.connectHandlers.forEach((h) => h());
      this.startPing();
    };

    ws.onmessage = (event) => {
      let parsed: StreamingMessage;
      try {
        parsed = JSON.parse(event.data as string) as StreamingMessage;
      } catch {
        return; // ignore non-JSON frames
      }
      this.dispatch(parsed);
    };

    ws.onerror = () => {
      const error = new Error('WebSocket error');
      this.errorHandlers.forEach((h) => h(error));
    };

    ws.onclose = () => {
      this.stopPing();
      this.disconnectHandlers.forEach((h) => h());
      if (this.autoReconnect && !this.closedByUser && this.endpoint) {
        // Reconnect to the same endpoint.
        try {
          this.connect(this.endpoint);
        } catch {
          /* swallow — onerror already surfaced */
        }
      }
    };
  }

  /**
   * Send a JSON frame over the open socket. No-op if the socket is not yet open.
   */
  send(data: Record<string, unknown>): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /**
   * Create a new chat session via WSS and resolve with the chat UUID.
   *
   * Sends `{ action: 'create', scope, model? }` and waits for the
   * `session` message carrying `uuid`.
   */
  createSession(scope = 'text', model?: string, timeoutMs = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.endpoint) {
        this.connect('chats/stream');
      }
      const t = setTimeout(() => {
        reject(new Error('Timeout waiting for session response'));
      }, timeoutMs);
      this.once('session', (msg) => {
        clearTimeout(t);
        if (msg.uuid) resolve(msg.uuid as string);
        else reject(new Error('No uuid in session response'));
      });
      this.once('error', (msg) => {
        clearTimeout(t);
        reject(new Error((msg.error as string) || 'Session creation failed'));
      });
      this.send({
        action: 'create',
        scope,
        ...(model ? { model } : {}),
      });
    });
  }

  /**
   * Send a prompt to an existing chat session. The server will respond with
   * a stream of `message` frames and a final `done` frame.
   */
  sendPrompt(
    chatUuid: string,
    prompt: string,
    settings?: Record<string, unknown>,
  ): boolean {
    return this.send({
      action: 'prompt',
      chat_uuid: chatUuid,
      prompt,
      settings: settings ?? {},
    });
  }

  /** Close the connection and release all handlers. Idempotent. */
  close(): void {
    this.closedByUser = true;
    this.stopPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.handlers = [];
  }

  /** Register a handler for every incoming message. */
  onMessage(handler: MessageHandler): void {
    this.handlers.push({ type: null, once: false, fn: handler });
  }

  /** Register a one-shot handler for messages of a given `type`. */
  once(type: string, handler: MessageHandler): void {
    this.handlers.push({ type, once: true, fn: handler });
  }

  /** Listen for connection-open events. */
  onConnect(handler: ConnectionHandler): void {
    this.connectHandlers.push(handler);
  }

  /** Listen for connection-close events. */
  onDisconnect(handler: ConnectionHandler): void {
    this.disconnectHandlers.push(handler);
  }

  /** Listen for transport-level errors. */
  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** The endpoint this socket is (or was last) connected to. */
  get currentEndpoint(): string | null {
    return this.endpoint;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private dispatch(msg: StreamingMessage): void {
    const handlers = this.handlers;
    const keep: InternalHandler[] = [];
    for (const h of handlers) {
      if (h.type === null || h.type === msg.type) {
        try {
          h.fn(msg);
        } catch {
          /* swallow handler errors so they don't break the stream */
        }
        if (!h.once) keep.push(h);
      } else {
        keep.push(h);
      }
    }
    this.handlers = keep;
  }

  private startPing(): void {
    this.stopPing();
    if (this.pingIntervalMs <= 0) return;
    this.pingTimer = setInterval(() => {
      // The server doesn't require ping frames, but a no-op message keeps
      // intermediate proxies from closing an idle connection.
      this.send({ action: 'ping' });
    }, this.pingIntervalMs);
    // Don't keep the event loop alive purely for the ping.
    if (typeof this.pingTimer === 'object' && this.pingTimer && 'unref' in this.pingTimer) {
      (this.pingTimer as { unref?: () => void }).unref?.();
    }
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}