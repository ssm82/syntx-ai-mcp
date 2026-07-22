import type { SyntxTool, McpContext } from '../registry';
import { textResult, toMcpError } from '../errors';

/**
 * Chat & messaging tools — the primary conversational surface of the server.
 *
 * Two interaction models are exposed:
 *  - `send-message`: fire-and-forget (returns an ack). Pair with `wait-for-response`.
 *  - `ask`: one-shot — sends a prompt and blocks until the assistant reply completes.
 *  - `stream-message`: one-shot with real-time token delivery via WSS
 *    (see the `streamMode` server config and the optional `mode` argument).
 */
export const chatsTools: SyntxTool[] = [
  {
    name: 'list-chats',
    capability: { networkCall: true },
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
    async handler(args, ctx) {
      try {
        const result = await ctx.syntx.chats.list({
          scope: args.scope as string | undefined,
          search: args.search as string | undefined,
          direction: args.direction as 'older' | 'newer' | undefined,
          page_size: args.page_size as number | undefined,
        });
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'list-chats');
      }
    },
  },
  {
    name: 'create-chat',
    capability: { networkCall: true },
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
    async handler(args, ctx) {
      try {
        const chat = await ctx.syntx.chats.create({
          title: String(args.title),
          scope: (args.scope as string | undefined) ?? 'text',
          model: args.model as string | undefined,
        });
        return textResult(JSON.stringify(chat, null, 2));
      } catch (err) {
        return toMcpError(err, 'create-chat');
      }
    },
  },
  {
    name: 'get-messages',
    capability: { networkCall: true },
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
    async handler(args, ctx) {
      try {
        const result = await ctx.syntx.chats.getMessages(String(args.chat_id), {
          page_size: args.page_size as number | undefined,
          direction: args.direction as 'older' | 'newer' | undefined,
        });
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'get-messages');
      }
    },
  },
  {
    name: 'send-message',
    capability: { networkCall: true, costSideEffect: true },
    description:
      'Send a message (prompt) to an existing chat and return immediately. ' +
      'The assistant response is generated asynchronously — poll with `wait-for-response` ' +
      'or use `ask` / `stream-message` for a single blocking call.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or id.' },
        prompt: { type: 'string', description: 'The prompt text to send.' },
        ai_name: { type: 'string', description: 'AI service name. Defaults to the server default.' },
        model_type: { type: 'string', description: 'Model identifier for this message.' },
      },
      required: ['chat_id', 'prompt'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const aiName = (args.ai_name as string | undefined) ?? ctx.config.defaultAI;
        await ctx.syntx.chats.sendMessage(String(args.chat_id), aiName, [
          {
            object_type: 'text',
            object_url: null,
            object_text: String(args.prompt),
            model_type: (args.model_type as string | undefined) ?? ctx.config.defaultModel,
          },
        ]);
        return textResult(
          `Message sent to chat ${args.chat_id}. Use "wait-for-response" or "get-messages" to read the reply.`,
        );
      } catch (err) {
        return toMcpError(err, 'send-message');
      }
    },
  },
  {
    name: 'wait-for-response',
    capability: { networkCall: true },
    description:
      'Block until the latest assistant message in a chat finishes generating, then return its text. ' +
      'Respects the server poll interval/timeout. Use after `send-message`.',
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
    async handler(args, ctx) {
      try {
        const { text, message } = await ctx.syntx.chats.waitForResponse(String(args.chat_id), {
          timeout: (args.timeout as number | undefined) ?? ctx.config.pollTimeout,
          pollInterval: (args.poll_interval as number | undefined) ?? ctx.config.pollInterval,
        });
        return textResult(
          `Assistant reply:\n\n${text}\n\n--- metadata ---\n${JSON.stringify(message, null, 2)}`,
        );
      } catch (err) {
        return toMcpError(err, 'wait-for-response');
      }
    },
  },
  {
    name: 'ask',
    capability: { networkCall: true, costSideEffect: true },
    description:
      'One-shot helper: create a chat, send a prompt, wait for the completed assistant reply, and return it. ' +
      'Ideal for stateless Q&A. The created chat UUID is included in the response for follow-ups. ' +
      'Set `mode: "stream"` to opt into real-time token delivery (default behaviour is controlled by SYNTX_STREAM_MODE).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt to send.' },
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
            'Override the streaming strategy. "stream" uses WSS; "poll" uses REST polling; "auto" tries WSS then falls back to polling; "off" disables waiting (the tool returns after sending).',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    async handler(args, ctx, extra) {
      try {
        const prompt = String(args.prompt);
        const mode = (args.mode as 'auto' | 'stream' | 'poll' | 'off' | undefined) ?? ctx.config.streamMode;

        // `off` — fire-and-forget; create chat + send prompt, return immediately.
        if (mode === 'off') {
          const { uuid } = await ctx.syntx.chats.create({
            title: (args.title as string | undefined) ?? prompt.slice(0, 60),
            scope: (args.scope as string | undefined) ?? 'text',
          });
          await ctx.syntx.chats.sendMessage(uuid, (args.ai_name as string | undefined) ?? ctx.config.defaultAI, [
            {
              object_type: 'text',
              object_url: null,
              object_text: prompt,
              model_type: (args.model_type as string | undefined) ?? ctx.config.defaultModel,
            },
          ]);
          return textResult(
            `chat_uuid: ${uuid}\n\nMessage sent. Use "wait-for-response" or "stream-message" to read the reply.`,
          );
        }

        // `poll` — pure REST: create + send + poll. No streaming attempted.
        if (mode === 'poll') {
          const { uuid, text } = await pollAsk(prompt, args, ctx);
          return textResult(`chat_uuid: ${uuid}\n\n${text}`);
        }

        // `stream` / `auto` — use the one-shot streaming helper. `auto` adds
        // a robust fallback to {@link pollAsk} if the WSS session fails
        // before a chat is established or the reply can't be recovered.
        if (mode === 'stream' || mode === 'auto') {
          return await streamAsk(prompt, args, ctx, extra);
        }

        throw new Error(`Unknown stream mode: ${String(mode)}`);
      } catch (err) {
        return toMcpError(err, 'ask');
      }
    },
  },
  {
    name: 'stream-message',
    capability: { networkCall: true, costSideEffect: true },
    description:
      'One-shot streaming chat: opens a WSS connection, sends the prompt, and ' +
      'streams the assistant reply in real time. Intermediate progress is ' +
      'reported via `notifications/progress` (when the client supplies a ' +
      'progressToken); the final tool result contains the complete text. ' +
      'Falls back to REST polling on transport failure unless `mode: "stream"` ' +
      'is passed explicitly.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt to send.' },
        scope: { type: 'string', default: 'text' },
        model: { type: 'string', description: 'Initial model for the chat.' },
        ai_name: { type: 'string' },
        model_type: { type: 'string' },
        timeout: { type: 'number', description: 'Max wait time in milliseconds.' },
        mode: {
          type: 'string',
          enum: ['auto', 'stream', 'poll'],
          description:
            'Override the streaming strategy. Default "auto" (WSS with polling fallback).',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    async handler(args, ctx, extra) {
      try {
        return await streamAsk(String(args.prompt), args, ctx, extra);
      } catch (err) {
        return toMcpError(err, 'stream-message');
      }
    },
  },
  {
    name: 'generate-title',
    capability: { networkCall: true, costSideEffect: true },
    description: 'Ask syntx.ai to auto-generate a title for an existing chat (by UUID).',
    inputSchema: {
      type: 'object',
      properties: { chat_uuid: { type: 'string' } },
      required: ['chat_uuid'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        await ctx.syntx.chats.generateTitle(String(args.chat_uuid));
        return textResult('Title generation requested. Read it back with list-chats.');
      } catch (err) {
        return toMcpError(err, 'generate-title');
      }
    },
  },
  {
    name: 'delete-chat',
    capability: { networkCall: true },
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
    name: 'pin-chat',
    capability: { networkCall: true },
    description:
      'Toggle pin/unpin for a chat. Mirrors `syntx.chats.pin`. Issues ' +
      '`POST /api/v1/chats/{chat_id}/pin`. The endpoint toggles pinned state, so call again to undo.',
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
        return toMcpError(new Error('"chat_id" must be a non-empty string'), 'pin-chat');
      }
      try {
        await ctx.syntx.chats.pin(chatId);
        return textResult(`Toggled pin state for chat ${chatId}.`);
      } catch (err) {
        return toMcpError(err, 'pin-chat');
      }
    },
  },
  {
    name: 'move-chat-to-project',
    capability: { networkCall: true },
    description:
      'Move a chat into a project (folder). Mirrors `syntx.chats.moveToFolder`. ' +
      'Issues `POST /api/v1/chats/{chat_id}/move` with `{ folder_id }`.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat UUID or numeric id (required).' },
        folder_id: { type: 'string', description: 'Destination folder UUID (required).' },
      },
      required: ['chat_id', 'folder_id'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const chatId = String(args.chat_id ?? '').trim();
      const folderId = String(args.folder_id ?? '').trim();
      if (!chatId) {
        return toMcpError(new Error('"chat_id" must be a non-empty string'), 'move-chat-to-project');
      }
      if (!folderId) {
        return toMcpError(new Error('"folder_id" must be a non-empty string'), 'move-chat-to-project');
      }
      try {
        await ctx.syntx.chats.moveToFolder(chatId, folderId);
        return textResult(`Moved chat ${chatId} to project ${folderId}.`);
      } catch (err) {
        return toMcpError(err, 'move-chat-to-project');
      }
    },
  },
  {
    name: 'get-favorite-messages',
    capability: { networkCall: true },
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
    async handler(args, ctx) {
      try {
        const result = await ctx.syntx.chats.getFavoriteMessages(String(args.chat_id), {
          page_size: args.page_size as number | undefined,
          direction: args.direction as 'older' | 'newer' | undefined,
        });
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'get-favorite-messages');
      }
    },
  },
];

/**
 * Polling-based `ask` implementation: create a chat, send the prompt, then
 * poll the REST endpoint until the assistant reply completes.
 *
 * Used by:
 *  - `ask` with `mode: 'poll'`
 *  - `ask` / `stream-message` with `mode: 'auto'` when the WSS stream failed
 *    before a session was established (no chat to poll) or when polling the
 *    streamed chat itself failed (final fallback).
 */
async function pollAsk(
  prompt: string,
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<{ uuid: string; text: string }> {
  const { uuid } = await ctx.syntx.chats.create({
    title: (args.title as string | undefined) ?? prompt.slice(0, 60),
    scope: (args.scope as string | undefined) ?? 'text',
  });
  const aiName = (args.ai_name as string | undefined) ?? ctx.config.defaultAI;
  await ctx.syntx.chats.sendMessage(uuid, aiName, [
    {
      object_type: 'text',
      object_url: null,
      object_text: prompt,
      model_type: (args.model_type as string | undefined) ?? ctx.config.defaultModel,
    },
  ]);
  const { text } = await ctx.syntx.chats.waitForResponse(uuid, {
    timeout: (args.timeout as number | undefined) ?? ctx.config.pollTimeout,
    pollInterval: (args.poll_interval as number | undefined) ?? ctx.config.pollInterval,
  });
  return { uuid, text };
}

/**
 * Shared implementation behind `ask` (when `mode: 'stream' | 'auto'`) and the
 * dedicated `stream-message` tool.
 *
 * `ChatsResource.streamResponse` now performs REST-polling internally (the
 * syntx.ai API exposes no WebSocket/SSE endpoint). The flow is:
 *
 *  1. Create chat + send prompt via REST.
 *  2. Poll the messages endpoint until the assistant reply appears.
 *  3. Emit the reply as a chunk via `onChunk` and surface progress via
 *     `notifications/progress` / `notifications/message`.
 *  4. Return the chat UUID so callers can continue the conversation.
 *
 * `mode: 'auto'` is kept for backward compatibility — it behaves identically
 * to `'stream'` since there is no transport to fall back from. `'poll'`
 * routes through the lower-level {@link pollAsk} instead.
 */
async function streamAsk(
  prompt: string,
  args: Record<string, unknown>,
  ctx: McpContext,
  _extra?: import('../registry').SyntxToolExtra,
) {
  const timeout = (args.timeout as number | undefined) ?? ctx.config.pollTimeout;
  const aiName = (args.ai_name as string | undefined) ?? ctx.config.defaultAI;
  const modelType = (args.model_type as string | undefined) ?? ctx.config.defaultModel;
  const scope = (args.scope as string | undefined) ?? 'text';

  let chunkCount = 0;
  let chatUuid: string | undefined;
  const result = await ctx.syntx.chats.streamResponse(prompt, {
    timeout,
    scope,
    model: modelType,
    aiName,
    onSession: (uuid) => {
      chatUuid = uuid;
    },
    onChunk: async (_chunk, accumulated) => {
      chunkCount++;
      await ctx.sendProgress?.(accumulated.length, undefined, accumulated);
      await ctx.sendLog?.('info', { chunk: chunkCount, length: accumulated.length }, 'stream-message');
    },
  });

  const uuid = result.chatUuid ?? chatUuid;
  return textResult(
    `chat_uuid: ${uuid ?? '(no session)'}\n` +
      `elapsed_ms: ${result.elapsedMs}\n` +
      `chunks: ${chunkCount}\n\n${result.text}`,
  );
}
