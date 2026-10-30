import type { SyntxTool } from '../registry';
import { toMcpError, toolError } from '../errors';
import { wrapSdk, jsonOrAck } from './_helpers';
import {
  assertPathSourceAllowed,
  resolveAllowedRoots,
  resolveFileInputs,
  resolveSafePath,
  type FileInputSpec,
} from './file-input';
import { logSecurityEvent } from '../security-log';
import type { AgentEnabledTools, AgentDefaultModels } from '../../types';

/**
 * Agent management tools — syntx.ai's custom AI agents.
 *
 * Discovered in the prod-SPA bundle `1793202992`, Pinia store `ai-agent`
 * (chunk `FavoriteMessagesButton.js`). The upstream namespace is
 * `/api/v1/agents/*`.
 *
 * Identifier note: `agent_id` is the UUID returned by `list-agents`;
 * `update-agent` and `delete-agent-files` are keyed by the numeric `id`
 * / `file_id` values that the respective payloads carry.
 */
export const agentsTools: SyntxTool[] = [
  {
    name: 'list-agents',
    description:
      'List the AI agents visible to the authenticated account. Mirrors ' +
      '`syntx.agents.list`. Hits `GET /api/v1/agents/list`. Returns ' +
      '`{agents: [{name, description, agent_id, editable, status}], agent_limit, ' +
      'agent_count, can_create_more}` — the list mixes the caller\'s own agents ' +
      'with platform agents shared across accounts (`editable: false`).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: wrapSdk<Record<string, never>, unknown>(
      'list-agents',
      async (_args, ctx) => ctx.syntx.agents.list(),
    ),
  },
  {
    name: 'get-agent',
    description:
      'Fetch one agent\'s full record. Mirrors `syntx.agents.get`. Hits ' +
      '`GET /api/v1/agents/info/{agent_id}`. Returns the agent object ' +
      '(`name`, `system_prompt`, `style_prompt`, `model_name`, `is_ready`, ' +
      '`use_chat_history`, `enabled_tools`, `default_models`, `files[]`).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          minLength: 1,
          description: 'Agent UUID — the `agent_id` field returned by `list-agents`.',
        },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    handler: wrapSdk<{ agent_id: string }, unknown>(
      'get-agent',
      async (args, ctx) => ctx.syntx.agents.get(args.agent_id),
    ),
  },
  {
    name: 'create-agent',
    description:
      'Create an AI agent. Mirrors `syntx.agents.create`. Posts ' +
      '`multipart/form-data` to `POST /api/v1/agents/create`. `name`, ' +
      '`system_prompt` and `model_name` are required (the web client enforces ' +
      'the same). `enabled_tools` / `default_models` are objects and travel as ' +
      'JSON strings inside the multipart body.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, description: 'Agent display name.' },
        system_prompt: {
          type: 'string',
          minLength: 1,
          description: 'System instructions that drive the agent.',
        },
        model_name: {
          type: 'string',
          minLength: 1,
          description: 'Model the agent runs on, e.g. "gpt-4.1".',
        },
        description: { type: 'string', description: 'Optional short description.' },
        style_prompt: { type: 'string', description: 'Optional response-style instructions.' },
        use_chat_history: {
          type: 'boolean',
          description: 'Whether the agent may read the conversation history.',
        },
        enabled_tools: {
          type: 'object',
          description:
            'Tool toggles, e.g. `{"web_search": true, "sora_image": true, ' +
            '"suno_audio": true, "veo3_video": true, "code_interpreter": true}`. ' +
            'Unknown tool names are rejected server-side.',
          additionalProperties: { type: 'boolean' },
        },
        default_models: {
          type: 'object',
          description: 'Default model per media scope, e.g. `{"image": "gpt-image-1"}`.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['name', 'system_prompt', 'model_name'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const name = String(args.name ?? '').trim();
      const systemPrompt = String(args.system_prompt ?? '').trim();
      const modelName = String(args.model_name ?? '').trim();
      if (!name) return toolError('create-agent: "name" must be a non-empty string.');
      if (!systemPrompt) {
        return toolError('create-agent: "system_prompt" must be a non-empty string.');
      }
      if (!modelName) {
        return toolError('create-agent: "model_name" must be a non-empty string.');
      }

      const enabledTools = args.enabled_tools as AgentEnabledTools | undefined;
      const defaultModels = args.default_models as AgentDefaultModels | undefined;

      try {
        const response = await ctx.syntx.agents.create({
          name,
          system_prompt: systemPrompt,
          model_name: modelName,
          description: args.description as string | undefined,
          style_prompt: args.style_prompt as string | undefined,
          use_chat_history: args.use_chat_history as boolean | undefined,
          enabled_tools: enabledTools,
          default_models: defaultModels,
        });
        return jsonOrAck(response, `Created agent "${name}".`);
      } catch (err) {
        return toMcpError(err, 'create-agent');
      }
    },
  },
  {
    name: 'update-agent',
    description:
      'Update an AI agent. Mirrors `syntx.agents.update`. Issues ' +
      '`PUT /api/v1/agents/update/{id}` with the provided fields. The path ' +
      'segment is the agent\'s **numeric** `id` (from `get-agent`), not its ' +
      'UUID. Only the provided fields are sent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'number',
          description: 'Numeric agent id (the `id` field returned by `get-agent`).',
        },
        name: { type: 'string', minLength: 1, description: 'New display name.' },
        description: { type: 'string', description: 'New description.' },
        system_prompt: { type: 'string', description: 'New system instructions.' },
        style_prompt: { type: 'string', description: 'New response-style instructions.' },
        model_name: { type: 'string', minLength: 1, description: 'New model name.' },
        use_chat_history: {
          type: 'boolean',
          description: 'Whether the agent may read the conversation history.',
        },
        enabled_tools: {
          type: 'object',
          description: 'Replacement set of tool toggles.',
          additionalProperties: { type: 'boolean' },
        },
        default_models: {
          type: 'object',
          description: 'Replacement default model per media scope.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const rawId = args.agent_id;
      const id = typeof rawId === 'number' ? rawId : Number(rawId);
      if (!Number.isFinite(id)) {
        return toolError('update-agent: "agent_id" must be a number.');
      }

      const body: Record<string, unknown> = { id };
      if (args.name !== undefined) body.name = String(args.name);
      if (args.description !== undefined) body.description = args.description;
      if (args.system_prompt !== undefined) body.system_prompt = args.system_prompt;
      if (args.style_prompt !== undefined) body.style_prompt = args.style_prompt;
      if (args.model_name !== undefined) body.model_name = args.model_name;
      if (args.use_chat_history !== undefined) body.use_chat_history = args.use_chat_history;
      if (args.enabled_tools !== undefined) body.enabled_tools = args.enabled_tools;
      if (args.default_models !== undefined) body.default_models = args.default_models;

      try {
        const response = await ctx.syntx.agents.update(id, body);
        return jsonOrAck(response, `Updated agent ${id}.`);
      } catch (err) {
        return toMcpError(err, 'update-agent');
      }
    },
  },
  {
    name: 'delete-agent',
    description:
      'Permanently delete an AI agent. Mirrors `syntx.agents.delete`. Issues ' +
      '`DELETE /api/v1/agents/{agent_id}` with the agent UUID. This action is ' +
      'destructive and cannot be undone — confirm before invoking.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          minLength: 1,
          description: 'Agent UUID — the `agent_id` field returned by `list-agents`.',
        },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const agentId = String(args.agent_id ?? '').trim();
      if (!agentId) return toolError('delete-agent: "agent_id" must be a non-empty string.');

      try {
        const response = await ctx.syntx.agents.delete(agentId);
        return jsonOrAck(response, `Deleted agent ${agentId}.`);
      } catch (err) {
        return toMcpError(err, 'delete-agent');
      }
    },
  },
  {
    name: 'list-agent-files',
    description:
      'List the files attached to an AI agent. Mirrors ' +
      '`syntx.agents.listFiles`. Hits `GET /api/v1/agents/files/list/{agent_id}` ' +
      'and returns the file array.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          minLength: 1,
          description: 'Agent UUID — the `agent_id` field returned by `list-agents`.',
        },
      },
      required: ['agent_id'],
      additionalProperties: false,
    },
    handler: wrapSdk<{ agent_id: string }, unknown>(
      'list-agent-files',
      async (args, ctx) => ctx.syntx.agents.listFiles(args.agent_id),
    ),
  },
  {
    name: 'add-agent-files',
    capability: { localFileRead: true },
    description:
      'Attach one or more files to an AI agent. Mirrors ' +
      '`syntx.agents.addFiles`. Posts `multipart/form-data` to ' +
      '`POST /api/v1/agents/files/add/{agent_id}`, repeating the field name ' +
      '`files` once per file. The same LFI caveat as `upload-files` applies — ' +
      '`path` is a server-side file read and is rejected over the HTTP transport.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          minLength: 1,
          description: 'Agent UUID — the `agent_id` field returned by `list-agents`.',
        },
        files: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          description:
            'Files to attach. Each entry takes either `path` (server-side file read) ' +
            'or `content_base64` (inline base64) — exactly one per entry.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to a local file.' },
              content_base64: { type: 'string', description: 'Inline base64 payload.' },
              filename: { type: 'string', description: 'Override for the uploaded filename.' },
              mime_type: { type: 'string', description: 'MIME type hint.' },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['agent_id', 'files'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const agentId = String(args.agent_id ?? '').trim();
      if (!agentId) return toolError('add-agent-files: "agent_id" must be a non-empty string.');

      const rawFiles = args.files;
      if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
        return toolError('add-agent-files: "files" must be a non-empty array.');
      }
      const items = rawFiles as FileInputSpec[];
      const transport = ctx.config.transport;

      try {
        // H1 — same policy as `upload-files`: reject `path` inputs over
        // non-stdio transports BEFORE any filesystem work, and keep stdio
        // reads inside the allow-listed roots.
        for (const item of items) {
          if (typeof item.path === 'string' && item.path.length > 0) {
            assertPathSourceAllowed('path', transport);
          }
        }
        const allowedRoots = resolveAllowedRoots().roots;
        for (const item of items) {
          if (typeof item.path === 'string' && item.path.length > 0) {
            try {
              resolveSafePath(item.path, allowedRoots);
            } catch (err) {
              logSecurityEvent({
                kind: 'add-agent-files.path.rejected',
                transport,
                reason: err instanceof Error ? err.message : String(err),
              });
              throw err;
            }
          }
        }

        const resolved = await resolveFileInputs(items);
        const response = await ctx.syntx.agents.addFiles(
          agentId,
          resolved.map((file) => ({
            // Copy into a fresh ArrayBuffer-backed view — TS 5.7+ rejects
            // `Uint8Array<ArrayBufferLike>` as a BlobPart (could be a
            // SharedArrayBuffer). Same guard as `chats.uploadFiles`.
            blob: new Blob(
              [new Uint8Array(file.buffer)],
              file.mimeType ? { type: file.mimeType } : undefined,
            ),
            filename: file.filename,
          })),
        );
        return jsonOrAck(response, `Attached ${resolved.length} file(s) to agent ${agentId}.`);
      } catch (err) {
        return toMcpError(err, 'add-agent-files');
      }
    },
  },
  {
    name: 'delete-agent-files',
    description:
      'Remove files from an AI agent. Mirrors `syntx.agents.deleteFiles`. Issues ' +
      '`DELETE /api/v1/agents/files/delete/{agent_id}` with ' +
      '`{file_ids: [...]}`. Destructive — confirm before invoking.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          minLength: 1,
          description: 'Agent UUID — the `agent_id` field returned by `list-agents`.',
        },
        file_ids: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          minItems: 1,
          uniqueItems: true,
          description: 'File ids to remove, as returned by `list-agent-files`.',
        },
      },
      required: ['agent_id', 'file_ids'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const agentId = String(args.agent_id ?? '').trim();
      if (!agentId) {
        return toolError('delete-agent-files: "agent_id" must be a non-empty string.');
      }

      const rawFileIds = args.file_ids;
      if (!Array.isArray(rawFileIds) || rawFileIds.length === 0) {
        return toolError('delete-agent-files: "file_ids" must be a non-empty array.');
      }
      if (!rawFileIds.every((f) => typeof f === 'string')) {
        return toolError('delete-agent-files: "file_ids" must be an array of strings.');
      }
      const fileIds = rawFileIds.map((f) => f.trim()).filter((f) => f.length > 0);
      if (fileIds.length === 0) {
        return toolError('delete-agent-files: "file_ids" must contain at least one non-empty id.');
      }

      try {
        const response = await ctx.syntx.agents.deleteFiles(agentId, fileIds);
        return jsonOrAck(
          response,
          `Removed ${fileIds.length} file(s) from agent ${agentId}.`,
        );
      } catch (err) {
        return toMcpError(err, 'delete-agent-files');
      }
    },
  },
];
