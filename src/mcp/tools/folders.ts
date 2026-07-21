import type { SyntxTool } from '../registry';
import { textResult, toMcpError, toolError } from '../errors';

/**
 * Project (folder) management tools.
 *
 * These mirror the `syntx.folders.create` / `syntx.folders.addChats` SDK
 * methods. The product UI calls these "projects"; the upstream API and SDK
 * still use the `folders` namespace, so the underlying endpoints are
 * `POST /api/v1/folders/create` and `POST /api/v1/folders/{uuid}/add`.
 */
export const foldersTools: SyntxTool[] = [
  {
    name: 'create-project',
    capability: { networkCall: true },
    description:
      'Create a syntx.ai project (a.k.a. folder) and optionally seed it with ' +
      'existing chats. Returns the created project as JSON (uuid, title, scope, ' +
      'color, chats). Mirrors `syntx.folders.create`.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Project title (required).' },
        scope: {
          type: 'string',
          enum: ['text', 'image', 'video', 'audio'],
          default: 'text',
          description: 'Project scope. Defaults to "text" (matches the web client).',
        },
        color: {
          type: 'string',
          default: '#9C9C9C',
          description: 'CSS hex color for the project chip. Defaults to "#9C9C9C".',
        },
        chat_uuids: {
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
          description: 'Optional list of existing chat UUIDs to add on creation.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const title = String(args.title ?? '').trim();
      if (!title) {
        return toMcpError(new Error('"title" must be a non-empty string'), 'create-project');
      }

      const rawChatUuids = args.chat_uuids;
      let chatUuids: string[] | undefined;
      if (rawChatUuids !== undefined) {
        if (!Array.isArray(rawChatUuids) || !rawChatUuids.every((c) => typeof c === 'string')) {
          return toMcpError(
            new Error('"chat_uuids" must be an array of strings when provided'),
            'create-project',
          );
        }
        chatUuids = rawChatUuids.map((c) => c.trim()).filter((c) => c.length > 0);
      }

      try {
        const folder = await ctx.syntx.folders.create({
          title,
          scope: args.scope as string | undefined,
          color: args.color as string | undefined,
          chat_uuids: chatUuids,
        });
        return textResult(JSON.stringify(folder, null, 2));
      } catch (err) {
        return toMcpError(err, 'create-project');
      }
    },
  },
  {
    name: 'add-chats-to-project',
    capability: { networkCall: true },
    description:
      'Add one or more existing chats to an existing project. Mirrors ' +
      '`syntx.folders.addChats`. Sends a bare JSON array of chat UUIDs to ' +
      '`POST /api/v1/folders/{folder_uuid}/add`.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_uuid: { type: 'string', description: 'Project UUID (required).' },
        chat_uuids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          uniqueItems: true,
          description: 'Chat UUIDs to add. Must contain at least one entry.',
        },
      },
      required: ['folder_uuid', 'chat_uuids'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const folderUuid = String(args.folder_uuid ?? '').trim();
      if (!folderUuid) {
        return toMcpError(new Error('"folder_uuid" must be a non-empty string'), 'add-chats-to-project');
      }

      const rawChatUuids = args.chat_uuids;
      if (!Array.isArray(rawChatUuids) || rawChatUuids.length === 0) {
        return toolError(
          'add-chats-to-project: "chat_uuids" must be a non-empty array of chat UUIDs.',
        );
      }
      if (!rawChatUuids.every((c) => typeof c === 'string')) {
        return toMcpError(
          new Error('"chat_uuids" must be an array of strings'),
          'add-chats-to-project',
        );
      }
      const chatUuids = rawChatUuids.map((c) => c.trim()).filter((c) => c.length > 0);
      if (chatUuids.length === 0) {
        return toolError('add-chats-to-project: "chat_uuids" must contain at least one non-empty UUID.');
      }

      try {
        const response = await ctx.syntx.folders.addChats(folderUuid, chatUuids);
        if (response === undefined || response === null) {
          return textResult(
            `Added ${chatUuids.length} chat(s) to project ${folderUuid}.`,
          );
        }
        return textResult(JSON.stringify(response, null, 2));
      } catch (err) {
        return toMcpError(err, 'add-chats-to-project');
      }
    },
  },
  {
    name: 'delete-project',
    capability: { networkCall: true },
    description:
      'Permanently delete a syntx.ai project (a.k.a. folder). ' +
      'Mirrors `syntx.folders.delete`. Issues `DELETE /api/v1/folders/{folder_uuid}/delete`. ' +
      'This action is destructive and cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_uuid: { type: 'string', description: 'Project UUID to delete (required).' },
      },
      required: ['folder_uuid'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const folderUuid = String(args.folder_uuid ?? '').trim();
      if (!folderUuid) {
        return toMcpError(new Error('"folder_uuid" must be a non-empty string'), 'delete-project');
      }

      try {
        const response = await ctx.syntx.folders.delete(folderUuid);
        if (response === undefined || response === null) {
          return textResult(`Deleted project ${folderUuid}.`);
        }
        return textResult(JSON.stringify(response, null, 2));
      } catch (err) {
        return toMcpError(err, 'delete-project');
      }
    },
  },
];
