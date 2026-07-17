import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';
import { resolveFileInput, type FileInputSpec } from './file-input';

/**
 * Audio transcription tool.
 *
 * Wraps `ChatsResource.transcribe(file)` as an MCP tool. Accepts a single
 * audio file either as a server-side `path` (stdio transport only — see the
 * LFI note below) or inline `content_base64`.
 */

/**
 * Hard size limit for transcription payloads, derived from the syntx.ai audio
 * catalog (`list-models` scope=audio → ElevenLabs Voice Changer `max_file_size`
 * = 52_428_800 bytes ≈ 50 MB; accepted types audio/mpeg|wav|mp3). Enforced on
 * the decoded payload, not the raw base64.
 */
export const TRANSCRIBE_MAX_SIZE = 52_428_800; // 50 MB

/** Accepted audio MIME types for transcription (per syntx.ai audio catalog). */
export const TRANSCRIBE_ACCEPTED_MIMES = ['audio/mpeg', 'audio/wav', 'audio/mp3'];

export const audioTools: SyntxTool[] = [
  {
    name: 'transcribe',
    description:
      'Transcribe an audio file to text via syntx.ai (POST /api/v1/audio/transcribe). ' +
      'Provide a single file either as `path` (server filesystem; stdio transport only) ' +
      'or as `content_base64` with `filename`. ' +
      'IMPORTANT: when the server runs over the HTTP transport, `path` is rejected ' +
      '(arbitrary server-side file reads by remote clients) — use `content_base64` instead. ' +
      `Limit ${Math.round(TRANSCRIBE_MAX_SIZE / (1024 * 1024))} MB; accepted formats: mp3, wav, mpeg. ` +
      'Returns { text }.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Path to an audio file on the MCP server filesystem. ' +
            'stdio transport only — rejected over HTTP. Use content_base64 over HTTP.',
        },
        content_base64: {
          type: 'string',
          description:
            'Inline base64 audio payload (optionally with a `data:<mime>;base64,` prefix). ' +
            'Mutually exclusive with `path`. Preferred for the HTTP transport.',
        },
        filename: {
          type: 'string',
          description:
            'Filename. Required when using `content_base64` (used for MIME inference and the upload name).',
        },
        mime_type: {
          type: 'string',
          description: 'Optional MIME type override (auto-detected from extension if omitted).',
        },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const spec: FileInputSpec = {
          path: typeof args.path === 'string' ? args.path : undefined,
          content_base64: typeof args.content_base64 === 'string' ? args.content_base64 : undefined,
          filename: typeof args.filename === 'string' ? args.filename : undefined,
          mime_type: typeof args.mime_type === 'string' ? args.mime_type : undefined,
        };

        // LFI guard (Opus 4.8): a remote client must not direct the server to
        // read arbitrary files off its filesystem over the HTTP transport.
        if (spec.path && ctx.config.transport !== 'stdio') {
          return toMcpError(
            new Error(
              '`path` is not permitted over the HTTP transport (server-side file read). ' +
                'Send the audio inline via `content_base64` instead.',
            ),
            'transcribe',
          );
        }

        const resolved = await resolveFileInput(spec);

        if (resolved.buffer.byteLength > TRANSCRIBE_MAX_SIZE) {
          return toMcpError(
            new Error(
              `Audio too large: ${resolved.buffer.byteLength} bytes ` +
                `(transcribe limit ${TRANSCRIBE_MAX_SIZE} bytes ≈ ${Math.round(
                  TRANSCRIBE_MAX_SIZE / (1024 * 1024),
                )} MB).`,
            ),
            'transcribe',
          );
        }

        // Copy into an ArrayBuffer-backed view (TS 5.7+ rejects
        // Uint8Array<ArrayBufferLike> as a BlobPart).
        const view = new Uint8Array(resolved.buffer.byteLength);
        view.set(resolved.buffer);
        const fileParts: BlobPart[] = [view];
        const file = new File(fileParts, resolved.filename, {
          type: resolved.mimeType || undefined,
        });

        const result = await ctx.syntx.chats.transcribe(file);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'transcribe');
      }
    },
  },
];
