import type { SyntxTool } from '../registry';
import { textResult, toMcpError, toolError } from '../errors';
import { wrapSdk } from './_helpers';

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
    name: 'list-projects',
    description:
      'List projects (a.k.a. folders) for a given scope. Mirrors `syntx.folders.listTextFolders` ' +
      '/ `listImageFolders` / `listVideoFolders` / `listAudioFolders`. Hits ' +
      '`GET /api/v1/folders/{scope}/list`. Returns an array of `Folder` items.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['text', 'image', 'video', 'audio'],
          default: 'text',
          description: 'Project scope. Defaults to "text" (matches the web client).',
        },
      },
      additionalProperties: false,
    },
    handler: wrapSdk<{ scope?: 'text' | 'image' | 'video' | 'audio' }, unknown>(
      'list-projects',
      async (args, ctx) => {
        switch (args.scope ?? 'text') {
          case 'image':
            return ctx.syntx.folders.listImageFolders();
          case 'video':
            return ctx.syntx.folders.listVideoFolders();
          case 'audio':
            return ctx.syntx.folders.listAudioFolders();
          case 'text':
          default:
            return ctx.syntx.folders.listTextFolders();
        }
      },
    ),
  },
  {
    name: 'create-project',
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
  {
    name: 'remove-chats-from-project',
    description:
      'Remove one or more chats from a project. Mirrors `syntx.folders.removeChats`. ' +
      'Inverse of `add-chats-to-project`: sends a bare JSON array of chat UUIDs to ' +
      '`POST /api/v1/folders/{folder_uuid}/remove`.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_uuid: { type: 'string', description: 'Project UUID (required).' },
        chat_uuids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          uniqueItems: true,
          description: 'Chat UUIDs to remove. Must contain at least one entry.',
        },
      },
      required: ['folder_uuid', 'chat_uuids'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const folderUuid = String(args.folder_uuid ?? '').trim();
      if (!folderUuid) {
        return toMcpError(new Error('"folder_uuid" must be a non-empty string'), 'remove-chats-from-project');
      }

      const rawChatUuids = args.chat_uuids;
      if (!Array.isArray(rawChatUuids) || rawChatUuids.length === 0) {
        return toolError(
          'remove-chats-from-project: "chat_uuids" must be a non-empty array of chat UUIDs.',
        );
      }
      if (!rawChatUuids.every((c) => typeof c === 'string')) {
        return toMcpError(
          new Error('"chat_uuids" must be an array of strings'),
          'remove-chats-from-project',
        );
      }
      const chatUuids = rawChatUuids.map((c) => c.trim()).filter((c) => c.length > 0);
      if (chatUuids.length === 0) {
        return toolError('remove-chats-from-project: "chat_uuids" must contain at least one non-empty UUID.');
      }

      try {
        const response = await ctx.syntx.folders.removeChats(folderUuid, chatUuids);
        if (response === undefined || response === null) {
          return textResult(
            `Removed ${chatUuids.length} chat(s) from project ${folderUuid}.`,
          );
        }
        return textResult(JSON.stringify(response, null, 2));
      } catch (err) {
        return toMcpError(err, 'remove-chats-from-project');
      }
    },
  },
  {
    name: 'update-project',
    description:
      'Update a project\'s title and/or color. Mirrors `syntx.folders.update`. ' +
      'Issues `PATCH /api/v1/folders/{folder_uuid}/change`; only the provided ' +
      'fields are sent. At least one of `title` / `color` is required.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_uuid: { type: 'string', description: 'Project UUID (required).' },
        title: { type: 'string', description: 'New project title.' },
        color: { type: 'string', description: 'New project color (e.g. a CSS hex value like "#9C9C9C").' },
      },
      required: ['folder_uuid'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const folderUuid = String(args.folder_uuid ?? '').trim();
      if (!folderUuid) {
        return toMcpError(new Error('"folder_uuid" must be a non-empty string'), 'update-project');
      }

      const data: { title?: string; color?: string } = {};
      if (args.title !== undefined) {
        const title = String(args.title).trim();
        if (!title) {
          return toMcpError(new Error('"title" must be a non-empty string when provided'), 'update-project');
        }
        data.title = title;
      }
      if (args.color !== undefined) {
        const color = String(args.color).trim();
        if (!color) {
          return toMcpError(new Error('"color" must be a non-empty string when provided'), 'update-project');
        }
        data.color = color;
      }
      if (data.title === undefined && data.color === undefined) {
        return toolError('update-project: provide at least one of "title" or "color".');
      }

      try {
        const response = await ctx.syntx.folders.update(folderUuid, data);
        if (response === undefined || response === null) {
          return textResult(`Updated project ${folderUuid}.`);
        }
        return textResult(JSON.stringify(response, null, 2));
      } catch (err) {
        return toMcpError(err, 'update-project');
      }
    },
  },
  {
    name: 'reorder-project',
    description:
      'Reorder a project within its scope. Mirrors `syntx.folders.move`. ' +
      'Issues `PATCH /api/v1/folders/{folder_uuid}/move` with `{after_uuid}`. ' +
      'Pass the UUID of the project to place it after; omit `after_uuid` (or pass null) to move to the top.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_uuid: { type: 'string', description: 'Project UUID (required).' },
        after_uuid: {
          type: ['string', 'null'],
          description: 'UUID of the project to place this one after. Omit or pass null to move to the top.',
        },
      },
      required: ['folder_uuid'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const folderUuid = String(args.folder_uuid ?? '').trim();
      if (!folderUuid) {
        return toMcpError(new Error('"folder_uuid" must be a non-empty string'), 'reorder-project');
      }

      let afterUuid: string | null = null;
      if (args.after_uuid !== undefined && args.after_uuid !== null) {
        afterUuid = String(args.after_uuid).trim();
        if (!afterUuid) {
          return toMcpError(new Error('"after_uuid" must be a non-empty string or null'), 'reorder-project');
        }
      }

      try {
        const response = await ctx.syntx.folders.move(folderUuid, afterUuid);
        if (response === undefined || response === null) {
          return textResult(
            afterUuid === null
              ? `Moved project ${folderUuid} to the top.`
              : `Moved project ${folderUuid} after ${afterUuid}.`,
          );
        }
        return textResult(JSON.stringify(response, null, 2));
      } catch (err) {
        return toMcpError(err, 'reorder-project');
      }
    },
  },
];
