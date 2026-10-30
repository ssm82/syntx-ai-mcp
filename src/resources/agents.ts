import { BaseClient } from '../client';
import type {
  AgentDetail,
  AgentFile,
  AgentsListResponse,
  CreateAgentParams,
  UpdateAgentParams,
} from '../types';

/**
 * Resource for the `agents/*` namespace — syntx.ai's custom AI agents.
 *
 * Discovered in the prod-SPA bundle `1793202992`, Pinia store `ai-agent`
 * (chunk `FavoriteMessagesButton.js`). The store's axios instance is
 * `app.js` export `L`, i.e. baseURL `https://api.syntx.ai/api/v1/`.
 *
 * Endpoints:
 *  - `GET    /api/v1/agents/list`
 *  - `GET    /api/v1/agents/info/{agent_id}`
 *  - `POST   /api/v1/agents/create`              (multipart/form-data)
 *  - `PUT    /api/v1/agents/update/{id}`
 *  - `DELETE /api/v1/agents/{agent_id}`
 *  - `GET    /api/v1/agents/files/list/{agent_id}`
 *  - `POST   /api/v1/agents/files/add/{agent_id}` (multipart/form-data)
 *  - `DELETE /api/v1/agents/files/delete/{agent_id}`
 *
 * The agents chat runs over a WebSocket (`agents/chat/{agent_id}`), which
 * this SDK does not implement — WebSocket support was removed from the
 * SDK in `4c01027` and the SSE transport is the supported path.
 *
 * Identifier note: every path segment except `agents/update/{id}` takes
 * the **UUID** (`agent_id`) returned by {@link AgentsResource.list}.
 * `agents/update/{id}` takes the **numeric** `id` from
 * {@link AgentsResource.get}.
 */
export class AgentsResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * List the agents visible to the caller.
   *
   * `GET /api/v1/agents/list`
   *
   * The payload mixes the caller's own agents with platform agents shared
   * with every account (`editable: false`). `agent_count` counts only the
   * caller's own agents; `can_create_more` is the server's own verdict on
   * whether another agent may be created against `agent_limit`.
   */
  async list(): Promise<AgentsListResponse> {
    return this.client.get<AgentsListResponse>('/api/v1/agents/list');
  }

  /**
   * Fetch a single agent's full record.
   *
   * `GET /api/v1/agents/info/{agent_id}`
   *
   * `agent_id` is the UUID from {@link AgentsResource.list}.
   */
  async get(agentId: string): Promise<AgentDetail> {
    return this.client.get<AgentDetail>(
      `/api/v1/agents/info/${encodeURIComponent(agentId)}`,
    );
  }

  /**
   * Create an agent.
   *
   * `POST /api/v1/agents/create` (multipart/form-data)
   *
   * The prod-SPA builds a `FormData` from the form object: scalar fields
   * are appended verbatim, arrays are appended once per element, and
   * nested objects are JSON-stringified. This method reproduces that
   * encoding exactly, so `enabled_tools` / `default_models` travel as
   * JSON strings inside the multipart body.
   */
  async create(params: CreateAgentParams): Promise<unknown> {
    const formData = new FormData();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) formData.append(key, String(item));
      } else if (typeof value === 'object') {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, String(value));
      }
    }
    return this.client.postForm<unknown>('/api/v1/agents/create', formData);
  }

  /**
   * Update an agent.
   *
   * `PUT /api/v1/agents/update/{id}`
   *
   * `id` is the agent's **numeric** id (as returned by
   * {@link AgentsResource.get}), not its UUID. The prod-SPA sends the whole
   * agent record back, so `id` is included in the body automatically;
   * caller-supplied fields win over it.
   */
  async update(id: number | string, params: UpdateAgentParams): Promise<unknown> {
    return this.client.put<unknown>(
      `/api/v1/agents/update/${encodeURIComponent(String(id))}`,
      { id, ...params },
    );
  }

  /**
   * Delete an agent.
   *
   * `DELETE /api/v1/agents/{agent_id}`
   *
   * `agent_id` is the UUID. This is a destructive, irreversible call.
   */
  async delete(agentId: string): Promise<unknown> {
    return this.client.delete<unknown>(
      `/api/v1/agents/${encodeURIComponent(agentId)}`,
    );
  }

  /**
   * List the files attached to an agent.
   *
   * `GET /api/v1/agents/files/list/{agent_id}`
   *
   * `agent_id` is the UUID. The live response is a bare array.
   */
  async listFiles(agentId: string): Promise<AgentFile[]> {
    const res = await this.client.get<AgentFile[] | { files?: AgentFile[] }>(
      `/api/v1/agents/files/list/${encodeURIComponent(agentId)}`,
    );
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.files)) return res.files;
    return [];
  }

  /**
   * Attach files to an agent.
   *
   * `POST /api/v1/agents/files/add/{agent_id}` (multipart/form-data)
   *
   * Each file is appended under the repeated field name `files`, matching
   * the prod-SPA's `FormData` assembly.
   */
  async addFiles(
    agentId: string,
    files: Array<{ blob: Blob; filename: string }>,
  ): Promise<unknown> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file.blob, file.filename);
    }
    return this.client.postForm<unknown>(
      `/api/v1/agents/files/add/${encodeURIComponent(agentId)}`,
      formData,
    );
  }

  /**
   * Remove files from an agent.
   *
   * `DELETE /api/v1/agents/files/delete/{agent_id}` with body
   * `{ file_ids: [...] }`.
   */
  async deleteFiles(agentId: string, fileIds: string[]): Promise<unknown> {
    return this.client.delete<unknown>(
      `/api/v1/agents/files/delete/${encodeURIComponent(agentId)}`,
      { file_ids: fileIds },
    );
  }
}
