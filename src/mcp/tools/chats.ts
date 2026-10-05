import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';
import { wrapSdk, jsonOrAck } from './_helpers';
import { SyntxAPIError } from '../../errors';

/**
 * Chat & messaging tools — the primary conversational surface of the server.
 *
 * All text-scope interactions go through the `llm/*` text-flow (SSE primary
 * with REST polling fallback). The legacy `chats/{id}/messages` write path
 * (`objects[]` with `model_type`) was removed in v0.4.0.
 *
 * Three interaction models are exposed:
 *  - `send-message`: fire-and-forget (returns an ack). Pair with `wait-for-response`.
 *  - `ask`: one-shot — sends a prompt and blocks until the assistant reply completes.
 *  - `stream-message`: one-shot with SSE streaming + per-chunk `notifications/progress`.
 */
export const chatsTools: SyntxTool[] = [
  {
    name: 'list-chats',
    description: 'List the user chats, optionally filtered by scope or a search query.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Chat scope: text, image, audio, or video.' },
        search: { type: 'string', description: 'Substring to filter chat titles.' },
        direction: { type: 'string', enum: ['older', 'newer'] },
        page_size: { type: 'number', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    handler: wrapSdk<
      { scope?: string; search?: string; direction?: 'older' | 'newer'; page_size?: number },
      unknown
    >('list-chats', async (args, ctx) =>
      ctx.syntx.chats.list({
        scope: args.scope,
        search: args.search,
        direction: args.direction,
        page_size: args.page_size,
      }),
    ),
  },
  {
    name: 'create-chat',
    description: 'Create a new syntx.ai chat session and return its UUID. A title is required by the API.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Chat title (required).' },
        scope: { type: 'string', description: 'Chat scope. Defaults to "text".', default: 'text' },
        model: { type: 'string', description: 'Initial model for the chat.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    handler: wrapSdk<
      { title: string; scope?: string; model?: string },
      unknown
    >('create-chat', async (args, ctx) =>
      ctx.syntx.chats.create({
        title: args.title,
        scope: args.scope ?? 'text',
        model: args.model,
      }),
    ),
  },
  {
    name: 'get-messages',
    description: 'Return the message history of a chat (by UUID or numeric id).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or id.' },
        page_size: { type: 'number', minimum: 1, maximum: 100 },
        direction: { type: 'string', enum: ['older', 'newer'] },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
    handler: wrapSdk<
      { chat_id: string; page_size?: number; direction?: 'older' | 'newer' },
      unknown
    >('get-messages', async (args, ctx) =>
      ctx.syntx.chats.getMessages(args.chat_id, {
        page_size: args.page_size,
        direction: args.direction,
      }),
    ),
  },
  {
    name: 'chat-exists',
    description:
      'Pre-flight check: returns whether a chat (by id or uuid) currently exists on the server. ' +
      'Use this before `send-message` if you may be holding a stale reference. ' +
      'Backed by `GET /api/v1/chats/{chatId}` — 404 maps to `false`, 200 maps to `true`.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat numeric id or uuid.' },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
    handler: wrapSdk<{ chat_id: string }, { exists: boolean; chat_id: string }>(
      'chat-exists',
      async (args, ctx) => {
        const chatId = String(args.chat_id);
        const exists = await ctx.syntx.chats.exists(chatId);
        return { exists, chat_id: chatId };
      },
    ),
  },

  {
    name: 'send-message',
    description:
      'Send a message (prompt) with optional uploaded-file attachments to an existing chat and return immediately. ' +
      'The assistant response is generated asynchronously — poll with `wait-for-response` ' +
      'or use `ask` / `stream-message` for a single blocking call.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or id.' },
        prompt: { type: 'string', description: 'The prompt text to send.' },
        ai_name: { type: 'string', description: 'AI service name. Defaults to the server default.' },
        model_type: { type: 'string', description: 'Model identifier for this message.' },
        attachments: {
          type: 'array',
          maxItems: 10,
          description: 'Files returned by `upload-files` to attach to this message.',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', minLength: 1, description: 'Uploaded file URL.' },
              filename: { type: 'string', minLength: 1, description: 'File name shown in the chat.' },
              mime_type: { type: 'string', minLength: 1, description: 'Uploaded file MIME type.' },
              size: { type: 'number', minimum: 0, description: 'Uploaded file size in bytes.' },
              type: {
                type: 'string',
                enum: ['image', 'video', 'audio'],
                description:
                  'Optional category hint for media files (image/video/audio). ' +
                  'When set, the attachment is sent with the corresponding object_type. ' +
                  'For text documents and other non-media files, omit this field — ' +
                  'the type is inferred from mime_type and sent as "filetext". ' +
                  'NOTE: "file" is NOT a valid input object_type on the syntx.ai API; ' +
                  'use "filetext" instead.',
              },
            },
            required: ['url', 'filename'],
            anyOf: [{ required: ['mime_type'] }, { required: ['type'] }],
            additionalProperties: false,
          },
        },
      },
      required: ['chat_id', 'prompt'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const aiName = (args.ai_name as string | undefined) ?? ctx.config.defaultAI;
        const modelType = (args.model_type as string | undefined) ?? ctx.config.defaultModel;
        const attachments = (args.attachments as Array<{
          url: string;
          filename: string;
          mime_type?: string;
          type?: string;
        }> | undefined) ?? [];
        const chatId = String(args.chat_id);

        // Pre-flight existence check: `llm/generate` happily accepts a stale
        // (e.g. soft-deleted) chat_uuid and silently creates a floating job.
        // Validating up front lets us return a clear `chat_not_found` error
        // before any generation work.
        if (!(await ctx.syntx.chats.exists(chatId))) {
          throw new SyntxAPIError(
            `Chat ${chatId} not found. Use chat-exists to validate before sending, or list-chats to find a valid id.`,
            404,
            'chat_not_found',
          );
        }

        // Map MCP `attachments` (richer shape, with optional filename/mime_type)
        // to the SPA's canonical `files[]` field — see live `text.js` → `Le()`.
        // `object_type` is `'image'` when the MCP caller hints `type === 'image'`
        // or the MIME is image/*; everything else is `'file'`.
        const files = attachments.map((att) => {
          const mimeCategory = att.mime_type?.split('/', 1)[0]?.toLowerCase();
          const category = att.type ?? mimeCategory;
          return {
            object_type: category === 'image' ? 'image' as const : 'file' as const,
            object_url: att.url,
          };
        });

        // Modern text-flow: `llm/generate` with `chat_uuid` binds the
        // assistant reply to this chat. Live SPA capture (2026-10-04,
        // `text.js`): body = { chat_uuid, text, model, ..., files? }.
        await ctx.syntx.llm.generate({
          prompt: String(args.prompt),
          aiName,
          modelType,
          chatUuid: chatId,
          ...(files.length > 0 ? { files } : {}),
        });
        return textResult(
          files.length > 0
            ? `Message with ${files.length} attachment(s) sent to chat ${chatId}. Use "wait-for-response" or "get-messages" to read the reply.`
            : `Message sent to chat ${chatId}. Use "wait-for-response" or "get-messages" to read the reply.`,
        );
      } catch (err) {
        return toMcpError(err, 'send-message');
      }
    },
  },
  {
    name: 'wait-for-response',
    description:
      'Block until the latest assistant message in a chat finishes generating, then return its text and media URLs. ' +
      'Resolves when every message_object[i].completed === true — including image / video / audio / file-only replies. ' +
      'Text-scope chats open an SSE connection on sse.syntx.ai and fall back to REST polling on transport failure. ' +
      'Use after `send-message`.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string' },
        timeout: { type: 'number', description: 'Override max wait time in milliseconds.' },
        poll_interval: { type: 'number', description: 'Override poll interval in milliseconds.' },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
    async handler(args, ctx, extra) {
      try {
        const chatId = String(args.chat_id);
        if (!(await ctx.syntx.chats.exists(chatId))) {
          throw new SyntxAPIError(
            `Chat ${chatId} not found. Use chat-exists to validate, or list-chats to find a valid id.`,
            404,
            'chat_not_found',
          );
        }
        const completed = await ctx.syntx.llm.waitForResponse(chatId, {
          timeout: (args.timeout as number | undefined) ?? ctx.config.pollTimeout,
          signal: extra?.signal,
          onProgress: (elapsed, total) => {
            void ctx.sendProgress?.(elapsed, total, 'Waiting for assistant reply…');
          },
          llmSseBaseUrl: ctx.config.llmSseBaseUrl,
          fallbackPoll: async (cid, opts2) =>
            ctx.syntx.chats.pollForResponse(cid, {
              timeout: opts2.timeout ?? ctx.config.pollTimeout,
              signal: opts2.signal,
              pollInterval: ctx.config.pollInterval,
            }),
        });
        const textBlock =
          completed.text ||
          (completed.media.length === 0 ? '(no assistant reply yet)' : '(media-only reply, see media below)');
        return textResult(
          `Assistant reply:\n\n${textBlock}\n\n` +
            `--- media ---\n${JSON.stringify(completed.media, null, 2)}\n\n` +
            `--- metadata ---\n${JSON.stringify(completed.message, null, 2)}`,
        );
      } catch (err) {
        return toMcpError(err, 'wait-for-response');
      }
    },
  },
  {
    name: 'ask',
    description:
      'One-shot helper: create a chat, send a prompt, wait for the completed assistant reply, and return it. ' +
      'Ideal for stateless Q&A. The created chat UUID is included in the response for follow-ups. ' +
      'Set `mode: "stream"` to opt into real-time token delivery (default behaviour is controlled by SYNTX_STREAM_MODE).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt text to send.' },
        title: { type: 'string', description: 'Chat title. Defaults to a truncated prompt.' },
        ai_name: { type: 'string' },
        model_type: { type: 'string' },
        scope: { type: 'string', default: 'text' },
        timeout: { type: 'number' },
        poll_interval: { type: 'number' },
        mode: {
          type: 'string',
          enum: ['auto', 'stream', 'poll', 'off'],
          description:
            'Override the streaming strategy. "stream" uses SSE only; "poll" uses REST polling; "auto" tries SSE then falls back to polling; "off" disables waiting (the tool returns after sending).',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    async handler(args, ctx, extra) {
      try {
        const prompt = String(args.prompt);
        const mode = (args.mode as 'auto' | 'stream' | 'poll' | 'off' | undefined) ?? ctx.config.streamMode;
        const scope = (args.scope as string | undefined) ?? 'text';
        const aiName = (args.ai_name as string | undefined) ?? ctx.config.defaultAI;
        const modelType = (args.model_type as string | undefined) ?? ctx.config.defaultModel;
        const timeout = (args.timeout as number | undefined) ?? ctx.config.pollTimeout;

        if ((scope ?? 'text') !== 'text') {
          throw new SyntxAPIError(
            `scope="${scope}" is no longer supported by ask; the legacy chats/{id}/messages path was removed. ` +
              'Use the dedicated generate-image / generate-audio / generate-video tools for non-text outputs.',
            400,
            'unsupported_scope',
          );
        }

        const { uuid } = await ctx.syntx.chats.create({
          title: (args.title as string | undefined) ?? prompt.slice(0, 60),
          scope,
        });

        // `off` — fire-and-forget; create chat + submit prompt, return immediately.
        if (mode === 'off') {
          await ctx.syntx.llm.generate({ prompt, aiName, modelType, chatUuid: uuid });
          return textResult(
            `chat_uuid: ${uuid}\n\nMessage sent. Use "wait-for-response" or "stream-message" to read the reply.`,
          );
        }

        await ctx.syntx.llm.generate({ prompt, aiName, modelType, chatUuid: uuid });
        const completed = await ctx.syntx.llm.waitForResponse(uuid, {
          timeout,
          signal: extra?.signal,
          llmSseBaseUrl: ctx.config.llmSseBaseUrl,
          fallbackPoll: async (cid, opts2) =>
            ctx.syntx.chats.pollForResponse(cid, {
              timeout: opts2.timeout ?? ctx.config.pollTimeout,
              signal: opts2.signal,
              pollInterval: ctx.config.pollInterval,
            }),
          onProgress: (elapsed, total) => {
            void ctx.sendProgress?.(elapsed, total, 'Waiting for assistant reply…');
          },
        });
        return textResult(
          `chat_uuid: ${uuid}\n\n` +
            (completed.text || (completed.media.length === 0 ? '(no assistant reply yet)' : '(media-only reply)')),
        );
      } catch (err) {
        return toMcpError(err, 'ask');
      }
    },
  },
  {
    name: 'stream-message',
    description:
      'One-shot streaming chat for text scope: opens an SSE connection on ' +
      'sse.syntx.ai, sends the prompt, and streams the assistant reply. ' +
      'Falls back to REST polling on transport failure. Intermediate progress ' +
      'is reported via `notifications/progress` (when the client supplies a ' +
      'progressToken); the final tool result contains the complete text.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt text to send.' },
        scope: { type: 'string', default: 'text' },
        model: { type: 'string', description: 'Initial model for the chat.' },
        ai_name: { type: 'string' },
        model_type: { type: 'string' },
        timeout: { type: 'number', description: 'Max wait time in milliseconds.' },
        mode: {
          type: 'string',
          enum: ['auto', 'stream', 'poll'],
          description:
            'Override the streaming strategy. Default "auto" (SSE with polling fallback).',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    async handler(args, ctx, extra) {
      try {
        const prompt = String(args.prompt);
        const scope = (args.scope as string | undefined) ?? 'text';
        if (scope !== 'text') {
          throw new SyntxAPIError(
            `stream-message only supports scope="text"; scope="${scope}" requires the dedicated generate-image/audio/video tools.`,
            400,
            'unsupported_scope',
          );
        }
        const aiName = (args.ai_name as string | undefined) ?? ctx.config.defaultAI;
        const modelType = (args.model_type as string | undefined) ?? ctx.config.defaultModel;
        const timeout = (args.timeout as number | undefined) ?? ctx.config.pollTimeout;

        const { uuid } = await ctx.syntx.chats.create({
          title: prompt.slice(0, 60),
          scope,
          ...(modelType ? { model: modelType } : {}),
        });
        await ctx.syntx.llm.generate({ prompt, aiName, modelType, chatUuid: uuid });
        let chunkCount = 0;
        const completed = await ctx.syntx.llm.waitForResponse(uuid, {
          timeout,
          signal: extra?.signal,
          llmSseBaseUrl: ctx.config.llmSseBaseUrl,
          fallbackPoll: async (cid, opts2) =>
            ctx.syntx.chats.pollForResponse(cid, {
              timeout: opts2.timeout ?? ctx.config.pollTimeout,
              signal: opts2.signal,
              pollInterval: ctx.config.pollInterval,
            }),
          onProgress: (elapsed, total) => {
            void ctx.sendProgress?.(elapsed, total, 'Waiting for assistant reply…');
          },
        });
        if (completed.text) {
          chunkCount = 1;
          await ctx.sendProgress?.(completed.text.length, undefined, completed.text);
          await ctx.sendLog?.('info', { chunk: chunkCount, length: completed.text.length }, 'stream-message');
        }
        return textResult(
          `chat_uuid: ${uuid}\n` +
            `elapsed_ms: ${Date.now()}\n` +
            `chunks: ${chunkCount}\n\n${completed.text}`,
        );
      } catch (err) {
        return toMcpError(err, 'stream-message');
      }
    },
  },
  {
    name: 'delete-chat',
    description:
      'Permanently delete a chat. Mirrors `syntx.chats.delete`. Issues ' +
      '`DELETE /api/v1/chats/{chat_id}`. This action is destructive and cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or numeric id (required).' },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const chatId = String(args.chat_id ?? '').trim();
      if (!chatId) {
        return toMcpError(new Error('"chat_id" must be a non-empty string'), 'delete-chat');
      }
      try {
        await ctx.syntx.chats.delete(chatId);
        return textResult(`Deleted chat ${chatId}.`);
      } catch (err) {
        return toMcpError(err, 'delete-chat');
      }
    },
  },
  {
    name: 'get-inprogress',
    description:
      'Return the in-progress generations for a chat. Mirrors `syntx.chats.getInProgress`. ' +
      'Hits `GET /api/v1/chats/{chat_id}/inprogress`. An empty array means nothing is currently ' +
      'generating; otherwise each entry describes an active assistant object (model, object_type, ' +
      'created_at, task_id). Used internally by `wait-for-response` to gate on prior requests.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or numeric id (required).' },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
    handler: wrapSdk<{ chat_id: string }, unknown>('get-inprogress', async (args, ctx) =>
      ctx.syntx.chats.getInProgress(args.chat_id),
    ),
  },
  {
    name: 'get-favorite-messages',
    description:
      'Return the favorite (bookmarked) messages for a chat. Mirrors `syntx.chats.getFavoriteMessages`. ' +
      'Hits `GET /api/v1/chats/favorite/{chat_id}/messages`. This is the only way to read ' +
      'starred messages through MCP — `get-messages` does not include them.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or numeric id (required).' },
        page_size: { type: 'number', minimum: 1, maximum: 100 },
        direction: { type: 'string', enum: ['older', 'newer'] },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
    handler: wrapSdk<
      { chat_id: string; page_size?: number; direction?: 'older' | 'newer' },
      unknown
    >('get-favorite-messages', async (args, ctx) =>
      ctx.syntx.chats.getFavoriteMessages(args.chat_id, {
        page_size: args.page_size,
        direction: args.direction,
      }),
    ),
  },
  {
    name: 'cancel-message',
    description:
      'Cancel an in-flight assistant message generation. ' +
      'Mirrors `syntx.chats.cancelMessage`. ' +
      'Issues `POST /api/v1/chats/{chat_id}/messages/{message_id}/cancel`. ' +
      'A 404 response is treated as success (the message already finished).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or numeric id (required).' },
        message_id: { type: 'string', description: 'Message id to cancel (required).' },
      },
      required: ['chat_id', 'message_id'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      try {
        const chatId = String(args.chat_id);
        const messageId = String(args.message_id);
        await ctx.syntx.chats.cancelMessage(chatId, messageId);
        return textResult(`Cancelled message ${messageId} in chat ${chatId}.`);
      } catch (err) {
        return toMcpError(err, 'cancel-message');
      }
    },
  },
  {
    name: 'rename-chat',
    description:
      'Rename a chat. Mirrors `syntx.chats.rename`. Issues ' +
      '`PUT /api/v1/chats/{chat_id}` with body `{title}`.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or numeric id (required).' },
        title: { type: 'string', description: 'New chat title (required).' },
      },
      required: ['chat_id', 'title'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const chatId = String(args.chat_id ?? '').trim();
      if (!chatId) {
        return toMcpError(new Error('"chat_id" must be a non-empty string'), 'rename-chat');
      }
      const title = String(args.title ?? '').trim();
      if (!title) {
        return toMcpError(new Error('"title" must be a non-empty string'), 'rename-chat');
      }

      try {
        const response = await ctx.syntx.chats.rename(chatId, title);
        return jsonOrAck(response, `Renamed chat ${chatId} to "${title}".`);
      } catch (err) {
        return toMcpError(err, 'rename-chat');
      }
    },
  },
  {
    name: 'delete-message',
    description:
      'Permanently delete a single message. Mirrors `syntx.chats.deleteMessage`. ' +
      'Issues `DELETE /api/v1/chats/messages/{message_id}` (no chat id in the path). ' +
      'This action is destructive and cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message id to delete (required).' },
      },
      required: ['message_id'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const messageId = String(args.message_id ?? '').trim();
      if (!messageId) {
        return toMcpError(new Error('"message_id" must be a non-empty string'), 'delete-message');
      }

      try {
        await ctx.syntx.chats.deleteMessage(messageId);
        return textResult(`Deleted message ${messageId}.`);
      } catch (err) {
        return toMcpError(err, 'delete-message');
      }
    },
  },
  {
    name: 'toggle-chat-favorite',
    description:
      'Toggle the favorite (bookmark) flag of a chat. Mirrors `syntx.chats.toggleFavorite`. ' +
      'Issues `POST /api/v1/chats/{chat_id}/favorite` (no body). Each call flips the ' +
      'current state — favorited becomes unfavorited and vice versa; verify the result via `list-chats`.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or numeric id (required).' },
      },
      required: ['chat_id'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const chatId = String(args.chat_id ?? '').trim();
      if (!chatId) {
        return toMcpError(new Error('"chat_id" must be a non-empty string'), 'toggle-chat-favorite');
      }

      try {
        const response = await ctx.syntx.chats.toggleFavorite(chatId);
        return jsonOrAck(response, `Toggled favorite flag of chat ${chatId}.`);
      } catch (err) {
        return toMcpError(err, 'toggle-chat-favorite');
      }
    },
  },
  {
    name: 'toggle-message-favorite',
    description:
      'Toggle the favorite (bookmark) flag of a single message. Mirrors ' +
      '`syntx.chats.toggleMessageFavorite`. Issues ' +
      '`POST /api/v1/chats/{chat_id}/messages/{message_id}/favorite` (no body). ' +
      'Each call flips the current state; favorites are readable via `get-favorite-messages`.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or numeric id (required).' },
        message_id: { type: 'string', description: 'Message id (required).' },
      },
      required: ['chat_id', 'message_id'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const chatId = String(args.chat_id ?? '').trim();
      if (!chatId) {
        return toMcpError(new Error('"chat_id" must be a non-empty string'), 'toggle-message-favorite');
      }
      const messageId = String(args.message_id ?? '').trim();
      if (!messageId) {
        return toMcpError(new Error('"message_id" must be a non-empty string'), 'toggle-message-favorite');
      }

      try {
        const response = await ctx.syntx.chats.toggleMessageFavorite(chatId, messageId);
        return jsonOrAck(
          response,
          `Toggled favorite flag of message ${messageId} in chat ${chatId}.`,
        );
      } catch (err) {
        return toMcpError(err, 'toggle-message-favorite');
      }
    },
  },
];
