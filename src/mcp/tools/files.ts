import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';
import {
  resolveFileInputs,
  MAX_FILE_SIZE,
  MAX_FILES_PER_CALL,
  type FileInputSpec,
} from './file-input';

/** File management tools (uploaded files listing, upload, deletion). */
export const filesTools: SyntxTool[] = [
  {
    name: 'list-uploaded-files',
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
      },
      required: ['files'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const items = (args.files as FileInputSpec[] | undefined) ?? [];
        const resolved = await resolveFileInputs(items);
        const checkDuplicates = args.check_duplicates === undefined
          ? true
          : Boolean(args.check_duplicates);

        const result = await ctx.syntx.chats.uploadFiles(
          resolved.map((r) => ({
            buffer: r.buffer,
            filename: r.filename,
            mimeType: r.mimeType,
          })),
          'hidden',
          checkDuplicates,
        );
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'upload-files');
      }
    },
  },
  {
    name: 'delete-file',
    description: 'Permanently delete an uploaded file by its id.',
    inputSchema: {
      type: 'object',
      properties: { file_id: { type: 'string' } },
      required: ['file_id'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        await ctx.syntx.chats.deleteFile(String(args.file_id));
        return textResult(`File ${args.file_id} deleted.`);
      } catch (err) {
        return toMcpError(err, 'delete-file');
      }
    },
  },
];