import { BaseClient } from '../client';
import type { Folder, Locale, AppSettings } from '../types';

/**
 * Input accepted by {@link FoldersResource.create}.
 *
 * Mirrors the JSON body of `POST /api/v1/folders/create` observed in the
 * captured traffic. `title` is required; the server enforces non-empty
 * input and returns 422 otherwise.
 */
export interface CreateFolderParams {
  title: string;
  scope?: string;
  color?: string;
  chat_uuids?: string[];
}

/**
 * Server response from `POST /api/v1/folders/create`.
 *
 * The wire shape is loose — only `uuid` is consistently observed, with the
 * remaining fields forwarded from upstream. Additional unknown fields are
 * preserved through the `unknown` passthrough below.
 */
export interface CreatedFolder {
  uuid: string;
  title?: string;
  scope?: string;
  color?: string;
  chats?: unknown[];
  [key: string]: unknown;
}

/**
 * Resource for folders (chat organization).
 */
export class FoldersResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * List text folders.
   * GET /api/v1/folders/text/list
   */
  async listTextFolders(): Promise<Folder[]> {
    return this.client.get<Folder[]>('/api/v1/folders/text/list');
  }

  /**
   * List image folders.
   * GET /api/v1/folders/image/list
   */
  async listImageFolders(): Promise<Folder[]> {
    return this.client.get<Folder[]>('/api/v1/folders/image/list');
  }

  /**
   * List video folders.
   * GET /api/v1/folders/video/list
   */
  async listVideoFolders(): Promise<Folder[]> {
    return this.client.get<Folder[]>('/api/v1/folders/video/list');
  }

  /**
   * List audio folders.
   * GET /api/v1/folders/audio/list
   */
  async listAudioFolders(): Promise<Folder[]> {
    return this.client.get<Folder[]>('/api/v1/folders/audio/list');
  }

  /**
   * Create a folder (project) on syntx.ai.
   *
   * `POST /api/v1/folders/create`
   *
   * The server expects `{ title, scope, color, chat_uuids }` exactly; missing
   * `scope`/`color`/`chat_uuids` are filled with the same defaults the web
   * client uses (`text`, `#9C9C9C`, `[]`). Pass `chat_uuids` to seed the
   * folder with existing chats.
   */
  async create(data: CreateFolderParams): Promise<CreatedFolder> {
    const body: CreateFolderParams = {
      title: data.title,
      scope: data.scope ?? 'text',
      color: data.color ?? '#9C9C9C',
      chat_uuids: data.chat_uuids ?? [],
    };
    return this.client.post<CreatedFolder>('/api/v1/folders/create', body);
  }

  /**
   * Add one or more existing chats to a folder (project).
   *
   * `POST /api/v1/folders/{folderUuid}/add`
   *
   * The server consumes the body as a bare JSON array of chat UUIDs — the
   * SDK therefore serialises the array as-is, matching the captured request
   * payload. Returns the upstream response unchanged; the wire shape is not
   * pinned by the public docs.
   */
  async addChats(folderUuid: string, chatUuids: string[]): Promise<unknown> {
    return this.client.post<unknown>(`/api/v1/folders/${encodeURIComponent(folderUuid)}/add`, chatUuids);
  }

  /**
   * Remove one or more chats from a folder (project).
   *
   * `POST /api/v1/folders/{folderUuid}/remove`
   *
   * Inverse of {@link addChats}: the server consumes the body as a bare
   * JSON array of chat UUIDs (captured `ai-folders` Pinia store call:
   * `qn.post(\`/folders/${_}/remove\`,S)` with `S=[]` default). Returns
   * the upstream response unchanged; the wire shape is not pinned.
   */
  async removeChats(folderUuid: string, chatUuids: string[]): Promise<unknown> {
    return this.client.post<unknown>(`/api/v1/folders/${encodeURIComponent(folderUuid)}/remove`, chatUuids);
  }

  /**
   * Update a folder's title and/or color.
   *
   * `PATCH /api/v1/folders/{folderUuid}/change`
   *
   * Mirrors the `updateFolder(uuid,{title,color})` action in the captured
   * `ai-folders` Pinia store: only the provided keys are serialized. The
   * SPA merges the response into the local folder object; the SDK
   * surfaces the raw response without pinning its schema.
   */
  async update(folderUuid: string, data: { title?: string; color?: string }): Promise<unknown> {
    const body: { title?: string; color?: string } = {};
    if (data.title !== undefined) body.title = data.title;
    if (data.color !== undefined) body.color = data.color;
    return this.client.patch<unknown>(`/api/v1/folders/${encodeURIComponent(folderUuid)}/change`, body);
  }

  /**
   * Reorder a folder within its scope.
   *
   * `PATCH /api/v1/folders/{folderUuid}/move` with body
   * `{after_uuid: string | null}`.
   *
   * Mirrors the captured `ai-folders` Pinia store call
   * (`qn.patch(\`/folders/${_}/move\`,{after_uuid:S})`): pass the uuid of
   * the folder to position after, or `null` to move to the top. The
   * response has been observed to contain `sort_order`; the raw response
   * is passed through unpinned.
   */
  async move(folderUuid: string, afterUuid: string | null): Promise<unknown> {
    return this.client.patch<unknown>(
      `/api/v1/folders/${encodeURIComponent(folderUuid)}/move`,
      { after_uuid: afterUuid },
    );
  }

  /**
   * Permanently delete a folder (project).
   *
   * `DELETE /api/v1/folders/{folderUuid}/delete`
   *
   * Matches the endpoint the syntx.ai web client uses (see the captured
   * `ai-folders` Pinia store: `zr.delete(\`/folders/${R}/delete\`)`). The
   * server returns `{ success: boolean, ... }`; the SDK surfaces the raw
   * response without inventing an unverified schema.
   */
  async delete(folderUuid: string): Promise<unknown> {
    return this.client.delete<unknown>(`/api/v1/folders/${encodeURIComponent(folderUuid)}/delete`);
  }
}

/**
 * Resource for application settings and localizations.
 */
export class SettingsResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Get application-wide settings (OAuth providers, available AI list, IP, country).
   * GET /api/v1/settings
   */
  async get(): Promise<AppSettings> {
    return this.client.get<AppSettings>('/api/v1/settings');
  }

  /**
   * Get available UI locales.
   * GET /api/v1/i18n/locales
   */
  async getLocales(lang?: string, namespace?: string): Promise<Locale[]> {
    return this.client.get<Locale[]>('/api/v1/i18n/locales', { lang, namespace });
  }
}
