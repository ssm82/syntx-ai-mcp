import { BaseClient } from '../client';
import type {
  Chat,
  MessagesResponse,
  Pagination,
  MessageObject,
  InProgressResponse,
  WaitForResponseOptions,
  Message,
  StreamResponseOptions,
  StreamResponseResult,
} from '../types';

export interface ListChatsParams {
  scope?: string;
  search?: string;
  direction?: 'older' | 'newer';
  page_size?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface ListMessagesParams {
  page_size?: number;
  direction?: 'older' | 'newer';
  [key: string]: string | number | boolean | undefined;
}

export interface CreateChatParams {
  scope?: string;
  title?: string;
  model?: string;
}

export interface SendMessageParams {
  chat_uuid: string;
  prompt: string;
  settings?: Record<string, unknown>;
  attachments?: unknown[];
}

export interface SendChatMessageParams {
  message_object: MessageObject;
}

export interface UploadResult {
  files: Array<{
    url: string;
    filename: string;
    size: number;
    mime_type: string;
  }>;
}

/**
 * One input item accepted by {@link ChatsResource.uploadFiles}.
 *
 * `Blob` works in both browser and Node 18+ globals. The plain-object form
 * avoids requiring the global `File` constructor (available only from
 * Node 20), keeping the SDK compatible with the package's `engines.node>=18`.
 */
export type UploadFileInput =
  | Blob
  | { buffer: Uint8Array; filename: string; mimeType?: string };

/**
 * Resource for chats and messages.
 * Supports both REST API and WebSocket real-time messaging.
 */
export class ChatsResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * List user chats.
   * GET /api/v1/chats
   */
  async list(params?: ListChatsParams): Promise<{ chats: Chat[]; pagination: Pagination }> {
    return this.client.get<{ chats: Chat[]; pagination: Pagination }>('/api/v1/chats', params);
  }

  /**
   * Get messages for a specific chat.
   * GET /api/v1/chats/{chatId}/messages
   */
  async getMessages(chatId: string, params?: ListMessagesParams): Promise<MessagesResponse> {
    return this.client.get<MessagesResponse>(`/api/v1/chats/${chatId}/messages`, params);
  }

  /**
   * Get favorite messages for a specific chat.
   * GET /api/v1/chats/favorite/{chatId}/messages
   */
  async getFavoriteMessages(chatId: string, params?: ListMessagesParams): Promise<MessagesResponse> {
    return this.client.get<MessagesResponse>(`/api/v1/chats/favorite/${chatId}/messages`, params);
  }

  /**
   * Create a new chat/session.
   * POST /api/v1/chats
   *
   * Note: the API requires at least `title` to be present, otherwise
   * it returns 422 Unprocessable Entity.
   */
  async create(data?: CreateChatParams): Promise<{
    id: number;
    uuid: string;
    title: string;
    scope: string;
    created_at: string;
    updated_at: string;
    owner_id: number;
    deleted: boolean;
    is_favorite: boolean;
    folder_uuids: string[];
    messages: unknown[];
    message_count: number;
    message_limit: number;
  }> {
    return this.client.post('/api/v1/chats', data);
  }

  /**
   * Send a message (or multiple objects) to a chat.
   * POST /api/v1/chats/{chatId}/messages?ai_name={aiName}
   *
   * The real API expects `{ objects: MessageObject[] }`.
   * Each object can have object_type "text", "filetext", "image", etc.
   */
  async sendMessage(chatId: string, aiName: string, objects: MessageObject[]): Promise<unknown> {
    return this.client.post<unknown>(`/api/v1/chats/${chatId}/messages`, { objects }, { ai_name: aiName });
  }

  /**
   * Check if a chat has in-progress operations.
   * GET /api/v1/chats/{chatId}/inprogress
   */
  async getInProgress(chatId: string): Promise<InProgressResponse> {
    return this.client.get<InProgressResponse>(`/api/v1/chats/${chatId}/inprogress`);
  }

  /**
   * Get the latest `created_at` timestamp from a chat's messages.
   * Useful as a boundary for waitForResponse.
   */
  async getLatestBoundary(chatId: string): Promise<string> {
    try {
      const { messages } = await this.getMessages(chatId, { page_size: 50 });
      let max = '1970-01-01T00:00:00.000Z';
      for (const m of messages) {
        if (m.created_at && m.created_at > max) max = m.created_at;
      }
      return max;
    } catch {
      return '1970-01-01T00:00:00.000Z';
    }
  }

  /**
   * Receive an assistant reply for an existing chat.
   *
   * Polls the REST endpoint until a new completed message appears, optionally
   * bounded by a `created_at` boundary to ignore stale messages from previous
   * requests.
   *
   * For real-time token-by-token delivery (without first creating a chat via
   * REST), use {@link ChatsResource.streamResponse} instead.
   */
  async waitForResponse(
    chatId: string,
    options?: WaitForResponseOptions
  ): Promise<{ text: string; message: Message }> {
    return this.pollForResponse(chatId, options);
  }

  /**
   * Stream a reply from the syntx.ai API (REST-polling based).
   *
   * The syntx.ai API does not expose a WebSocket or SSE endpoint. The
   * assistant reply is generated asynchronously and only appears (in full)
   * once the model finishes. This method provides a streaming-compatible
   * interface on top of REST polling:
   *
   *  1. Creates a chat via REST.
   *  2. Sends the prompt via REST (`POST /chats/{uuid}/messages`).
   *  3. Fires {@link StreamResponseOptions.onSession} with the chat UUID.
   *  4. Polls the messages endpoint until the assistant reply appears.
   *  5. Fires {@link StreamResponseOptions.onChunk} with the complete text
   *     (the API delivers it atomically — there is no incremental growth).
   *  6. Resolves with the full result, including `chatUuid` for follow-ups.
   *
   * @param prompt - The user prompt text.
   * @param options - Streaming options. `scope`, `model`, and `aiName`
   *   control chat/message creation. `timeout` bounds the poll loop.
   */
  async streamResponse(
    prompt: string,
    options?: StreamResponseOptions & { scope?: string; model?: string },
  ): Promise<StreamResponseResult> {
    const scope = options?.scope ?? 'text';
    const model = options?.model;
    const aiName = options?.aiName;
    const timeout = options?.timeout ?? 600000;
    const pollInterval = 2000;
    const onSession = options?.onSession;
    const onChunk = options?.onChunk;

    const start = Date.now();

    // ── Step 1: create the chat ────────────────────────────────────────
    const chat = await this.create({
      scope,
      title: prompt.slice(0, 60),
      ...(model ? { model } : {}),
    });
    const chatUuid = chat.uuid;
    try {
      onSession?.(chatUuid);
    } catch {
      /* swallow callback errors */
    }

    // ── Step 2: send the prompt ────────────────────────────────────────
    await this.sendMessage(chatUuid, aiName ?? 'chatgpt', [
      {
        object_type: 'text',
        object_url: null,
        object_text: prompt,
        ...(model ? { model_type: model } : {}),
      },
    ]);

    // ── Step 3: poll for the assistant reply ───────────────────────────
    const { text } = await this.pollForResponse(chatUuid, {
      timeout,
      pollInterval,
    });

    // The API delivers the full reply atomically, so we emit a single chunk.
    if (text) {
      try {
        onChunk?.(text, text);
      } catch {
        /* swallow callback errors */
      }
    }

    return {
      text,
      // The REST `Message` shape differs from the WSS `StreamingMessage`;
      // we expose the text (the caller's primary interest) and null the
      // raw frame since we no longer use WebSocket frames.
      message: null,
      elapsedMs: Date.now() - start,
      chatUuid,
    };
  }

  /**
   * Poll a chat until a new assistant message is completed.
   * Uses `created_at` boundary to ignore messages from previous requests.
   */
  async pollForResponse(
    chatId: string,
    options?: WaitForResponseOptions
  ): Promise<{ text: string; message: Message }> {
    const timeout = options?.timeout ?? 600000;
    const pollInterval = options?.pollInterval ?? 5000;
    const pageSize = options?.pageSize ?? 50;
    const preWaitTimeout = options?.preWaitTimeout ?? timeout;
    const maxConsecutiveErrors = 5;

    let boundary = options?.boundary;
    if (!boundary) {
      boundary = await this.getLatestBoundary(chatId);
    }

    // Wait for any previous in-progress request to finish.
    // The endpoint returns an array of active generations; an empty array
    // means nothing is in progress.
    const progress = await this.getInProgress(chatId);
    if (Array.isArray(progress) && progress.length > 0) {
      const preWaitStart = Date.now();
      while (true) {
        await new Promise(r => setTimeout(r, pollInterval));
        const p = await this.getInProgress(chatId);
        if (!Array.isArray(p) || p.length === 0) break;
        if (Date.now() - preWaitStart > preWaitTimeout) {
          throw new Error(`Timeout waiting for previous in-progress request to finish in chat ${chatId}`);
        }
      }
    }

    const start = Date.now();
    let consecutiveErrors = 0;

    while (true) {
      if (Date.now() - start > timeout) {
        throw new Error(`Timeout waiting for response in chat ${chatId}`);
      }

      await new Promise(r => setTimeout(r, pollInterval));

      try {
        const { messages } = await this.getMessages(chatId, { page_size: pageSize });
        if (!messages || !Array.isArray(messages)) {
          throw new Error(`getMessages returned invalid messages: ${typeof messages}`);
        }

        // NOTE: use `>=` (not `>`) because the API assigns the same `created_at`
        // to the user prompt and the assistant reply within a single turn.
        const newAssistantMsgs = messages.filter(
          m => m && m.author_id === -1 && m.created_at && m.created_at >= boundary
        );
        const assistant = newAssistantMsgs[newAssistantMsgs.length - 1];
        if (!assistant) {
          consecutiveErrors = 0;
          continue;
        }

        const msgObjects = assistant.message_object;
        if (!msgObjects || !Array.isArray(msgObjects) || msgObjects.length === 0) {
          consecutiveErrors = 0;
          continue;
        }

        const obj = msgObjects[0];
        if (!obj) {
          consecutiveErrors = 0;
          continue;
        }

        const hasText = typeof obj.object_text === 'string' && obj.object_text.length > 0;
        const isCompleted = obj.completed === true;

        if (isCompleted && hasText) {
          return { text: obj.object_text, message: assistant };
        }

        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(
            `Too many consecutive poll errors (${maxConsecutiveErrors}) in chat ${chatId}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  /**
   * Get a specific message by ID.
   * GET /api/v1/chats/{chatId}/{messageId}
   */
  async getMessage(chatId: string, messageId: string): Promise<unknown> {
    return this.client.get<unknown>(`/api/v1/chats/${chatId}/${messageId}`);
  }

  /**
   * Upload files to a chat.
   * POST /api/v1/chats/upload-files
   *
   * Accepts {@link UploadFileInput} — either a `Blob` (browser & Node 18+)
   * or a plain object describing a `Uint8Array` with a filename. Plain-object
   * form is the recommended cross-environment input.
   */
  async uploadFiles(
    files: UploadFileInput[],
    destination?: 'hidden',
    checkDuplicates = true,
  ): Promise<UploadResult> {
    const formData = new FormData();
    for (const item of files) {
      if (item instanceof Blob) {
        const filename = (item as File).name ?? 'upload';
        const type = item.type || undefined;
        formData.append('files', type ? new Blob([item], { type }) : item, filename);
      } else {
        // Copy into a fresh ArrayBuffer-backed Uint8Array — required because
        // TS 5.7+ rejects Uint8Array<ArrayBufferLike> as a BlobPart (could be
        // SharedArrayBuffer). The copy guarantees an ArrayBuffer view.
        const view = new Uint8Array(item.buffer.byteLength);
        view.set(item.buffer);
        const blob = new Blob([view], item.mimeType ? { type: item.mimeType } : undefined);
        formData.append('files', blob, item.filename);
      }
    }
    if (destination) formData.append('destination', destination);
    formData.append('check_duplicates', String(checkDuplicates));

    const headers: Record<string, string> = {};
    const token = this.client.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Note: do NOT set Content-Type for FormData — browser adds boundary automatically

    const response = await fetch(`${this.client.baseURL}/api/v1/chats/upload-files`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    const data = await response.json();
    return data.data || data;
  }

  /**
   * Delete a file.
   * DELETE /api/v1/files/delete
   */
  async deleteFile(fileId: string): Promise<void> {
    await this.client.delete('/api/v1/files/delete', { file_id: fileId });
  }

  /**
   * Get uploaded files.
   * GET /api/v1/files/uploaded
   */
  async getUploadedFiles(scope = 'all', page = 1, pageSize = 10): Promise<{
    items: Array<{ url: string; filename: string; size: number; created_at: string }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.client.get('/api/v1/files/uploaded', { scope, page, page_size: pageSize });
  }

  /**
   * Transcribe audio to text.
   * POST /api/v1/audio/transcribe
   */
  async transcribe(file: File): Promise<{ text: string }> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    const token = this.client.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${this.client.baseURL}/api/v1/audio/transcribe`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Transcription failed: ${response.status}`);
    }

    const data = await response.json();
    return data.data || data;
  }

  /**
   * Generate a session title using AI.
   * POST /api/v1/chats/by-uuid/{chatUuid}/generate-title
   */
  async generateTitle(chatUuid: string): Promise<void> {
    await this.client.post(`/api/v1/chats/by-uuid/${chatUuid}/generate-title`);
  }

  /**
   * Delete a chat.
   * DELETE /api/v1/chats/{chatId}
   */
  async delete(chatId: string): Promise<void> {
    await this.client.delete(`/api/v1/chats/${chatId}`);
  }

  /**
   * Pin/unpin a chat.
   * POST /api/v1/chats/{chatId}/pin
   */
  async pin(chatId: string): Promise<void> {
    await this.client.post(`/api/v1/chats/${chatId}/pin`);
  }

  /**
   * Move chat to folder.
   * POST /api/v1/chats/{chatId}/move
   */
  async moveToFolder(chatId: string, folderId: string): Promise<void> {
    await this.client.post(`/api/v1/chats/${chatId}/move`, { folder_id: folderId });
  }
}