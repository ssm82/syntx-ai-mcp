import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';
import {
  assertPathSourceAllowed,
  resolveAllowedRoots,
  resolveFileInputs,
  resolveSafePath,
  MAX_FILE_SIZE,
  MAX_FILES_PER_CALL,
  type FileInputSpec,
} from './file-input';
import { logSecurityEvent } from '../security-log';

/** File management tools (uploaded files listing, upload, deletion). */
export const filesTools: SyntxTool[] = [
  {
    name: 'list-uploaded-files',
    capability: { networkCall: true },
    description: 'List files previously uploaded to the syntx.ai account.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Filter by scope: all, text, image, audio, or video.',
          default: 'all',
        },
        page: { type: 'number', minimum: 1, default: 1 },
        page_size: { type: 'number', minimum: 1, maximum: 100, default: 10 },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const result = await ctx.syntx.chats.getUploadedFiles(
          (args.scope as string | undefined) ?? 'all',
          (args.page as number | undefined) ?? 1,
          (args.page_size as number | undefined) ?? 10,
        );
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'list-uploaded-files');
      }
    },
  },
  {
    name: 'upload-files',
    capability: { localFileRead: true, externalExfiltration: true, networkCall: true, costSideEffect: true },
    description:
      'Upload one or more files to the syntx.ai account. ' +
      'Each file entry accepts either `path` (server-side file path, e.g. "C:\\photo.jpg") ' +
      'OR `content_base64` (inline base64, with optional `data:<mime>;base64,` prefix). ' +
      'For base64 entries, `filename` is required; `mime_type` is auto-guessed from extension if omitted. ' +
      `Max ${MAX_FILES_PER_CALL} files per call, ${Math.round(MAX_FILE_SIZE / (1024 * 1024))} MB each. ` +
      'Returns `{ files: [{ url, filename, size, mime_type }] }`.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_FILES_PER_CALL,
          description: 'Files to upload.',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Filesystem path readable by the MCP server.',
              },
              content_base64: {
                type: 'string',
                description:
                  'Inline base64 payload. May include a `data:<mime>;base64,` prefix. ' +
                  'Mutually exclusive with `path`.',
              },
              filename: {
                type: 'string',
                description:
                  'Override or supply the filename. Required for `content_base64` entries.',
              },
              mime_type: {
                type: 'string',
                description:
                  'MIME type override. Auto-detected from the filename extension if omitted.',
              },
            },
            additionalProperties: false,
            anyOf: [{ required: ['path'] }, { required: ['content_base64'] }],
          },
        },
        check_duplicates: {
          type: 'boolean',
          default: true,
          description: 'Ask the server to detect duplicates and skip them.',
        },
        model_type: {
          type: 'string',
          description:
            'Model identifier to scope the upload to (mirrors the SPA\'s ' +
            '`settings.model_type` field). Defaults to the server default model, ' +
            'or empty string when none is configured.',
        },
      },
      required: ['files'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const items = (args.files as FileInputSpec[] | undefined) ?? [];
        const transport = ctx.config.transport;

        // H1: reject `path` inputs over non-stdio transports BEFORE doing
        // any filesystem work. Remote clients must use `content_base64`.
        for (const item of items) {
          const hasPath = typeof item.path === 'string' && item.path.length > 0;
          if (hasPath) {
            assertPathSourceAllowed('path', transport);
          }
        }

        // For stdio, validate every `path` entry is inside the allow-list
        // (anti-symlink-escape, anti-special-files, anti-`/etc/passwd`).
        // For HTTP, the guard above is sufficient; any `path` that slips
        // through (none should) would already be rejected.
        const allowedRoots = resolveAllowedRoots().roots;
        for (const item of items) {
          if (typeof item.path === 'string' && item.path.length > 0) {
            try {
              resolveSafePath(item.path, allowedRoots);
            } catch (err) {
              logSecurityEvent({
                kind: 'upload-files.path.rejected',
                transport,
                reason: err instanceof Error ? err.message : String(err),
              });
              throw err;
            }
          }
        }

        const resolved = await resolveFileInputs(items);
        const checkDuplicates = args.check_duplicates === undefined
          ? true
          : Boolean(args.check_duplicates);
        const modelTypeRaw = args.model_type;
        const modelType =
          typeof modelTypeRaw === 'string' && modelTypeRaw.length > 0
            ? modelTypeRaw
            : (ctx.config.defaultModel ?? '');

        const result = await ctx.syntx.chats.uploadFiles(
          resolved.map((r) => ({
            buffer: r.buffer,
            filename: r.filename,
            mimeType: r.mimeType,
          })),
          'hidden',
          checkDuplicates,
          modelType,
        );
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'upload-files');
      }
    },
  },
  {
    name: 'delete-file',
    capability: { networkCall: true },
    description:
      'Permanently delete an uploaded file. Accepts either `file_id` (the ' +
      'historical behaviour) or `url` (the uploaded R2 URL, mirroring the SPA\'s ' +
      '`file-storage.remove`). Exactly one of the two must be provided.',
    inputSchema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Uploaded file id.' },
        url: { type: 'string', description: 'Uploaded file URL.' },
      },
      additionalProperties: false,
      anyOf: [{ required: ['file_id'] }, { required: ['url'] }],
    },
    async handler(args, ctx) {
      const fileId = typeof args.file_id === 'string' ? args.file_id.trim() : '';
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!fileId && !url) {
        return toMcpError(
          new Error('Exactly one of "file_id" or "url" must be provided'),
          'delete-file',
        );
      }
      try {
        const target: string | { url: string } = fileId ? fileId : { url };
        await ctx.syntx.chats.deleteFile(target);
        const label = fileId ? `file_id ${fileId}` : `url ${url}`;
        return textResult(`Deleted ${label}.`);
      } catch (err) {
        return toMcpError(err, 'delete-file');
      }
    },
  },
];