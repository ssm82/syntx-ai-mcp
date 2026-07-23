import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';
import {
  assertPathSourceAllowed,
  resolveAllowedRoots,
  resolveFileInput,
  resolveSafePath,
  type FileInputSpec,
} from './file-input';
import { logSecurityEvent } from '../security-log';

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
    capability: { localFileRead: true, externalExfiltration: true, networkCall: true, costSideEffect: true },
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

        // LFI guard (H1): a remote client must not direct the server to
        // read arbitrary files off its filesystem over the HTTP transport.
        // On stdio, the path must still resolve inside the allow-listed
        // roots (anti-symlink-escape, anti-special-files).
        if (spec.path) {
          assertPathSourceAllowed('path', ctx.config.transport);
          try {
            resolveSafePath(spec.path, resolveAllowedRoots().roots, TRANSCRIBE_MAX_SIZE);
          } catch (err) {
            logSecurityEvent({
              kind: 'upload-files.path.rejected',
              transport: ctx.config.transport,
              reason: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
        }

        const resolved = await resolveFileInput(spec);

        // I1: enforce the advertised MIME whitelist. `resolveFileInput`
        // infers the type from the filename extension (or an explicit
        // `mime_type` override) but does not validate it — without this
        // check the tool would happily forward a `.exe` to the transcribe
        // endpoint.
        const resolvedMime = (resolved.mimeType ?? '').toLowerCase().split(';')[0].trim();
        if (!TRANSCRIBE_ACCEPTED_MIMES.includes(resolvedMime)) {
          logSecurityEvent({
            kind: 'transcribe.mime.rejected',
            transport: ctx.config.transport,
            reason: resolvedMime || 'unknown',
            meta: { mime: resolvedMime || 'unknown' },
          });
          return toMcpError(
            new Error(
              `Unsupported audio type: ${resolved.mimeType ?? 'unknown'} ` +
                `(accepted: ${TRANSCRIBE_ACCEPTED_MIMES.join(', ')}).`,
            ),
            'transcribe',
          );
        }

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
  {
    name: 'list-voice-examples',
    capability: { networkCall: true },
    description:
      'List ElevenLabs voice examples (preview clips and metadata). Mirrors `syntx.audio.listVoiceExamples`. ' +
      'Hits `GET /api/v1/audio/elevenlabs/voice_examples`. Use `search` to narrow by name/label.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', minimum: 1, description: '1-based page number.' },
        page_size: { type: 'number', minimum: 1, maximum: 100, description: 'Items per page.' },
        search: { type: 'string', description: 'Case-insensitive substring against voice name/label.' },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const params: { page?: number; page_size?: number; search?: string } = {};
      if (args.page !== undefined) params.page = Number(args.page);
      if (args.page_size !== undefined) params.page_size = Number(args.page_size);
      if (args.search !== undefined) params.search = String(args.search);
      try {
        const result = await ctx.syntx.audio.listVoiceExamples(params);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'list-voice-examples');
      }
    },
  },
  {
    name: 'generate-audio',
    capability: { networkCall: true, costSideEffect: true },
    description:
      'Generate audio (TTS, voice change, music) via syntx.ai. Mirrors ' +
      '`syntx.audio.generate` and the SPA `ai-audio.sendMessage` flow. ' +
      'Posts to `POST /api/v1/audio/generate?ai_name={ai_name}`. ' +
      'Requires a target chat UUID (use `create-chat` first). ' +
      'The result includes generation metadata returned by the API; ' +
      'follow up with `wait-for-response` or `get-messages` to read the ' +
      'completed audio URL once the model finishes.',
    inputSchema: {
      type: 'object',
      properties: {
        ai_name: {
          type: 'string',
          description:
            'Audio provider name (e.g. "elevenlabs", "suno-music"). ' +
            'Use `list-models` with scope=audio to discover valid values.',
          default: 'elevenlabs',
        },
        chat_uuid: { type: 'string', description: 'Target chat UUID (create one with create-chat).' },
        prompt: { type: 'string', description: 'Text prompt describing the audio to produce.' },
        voice_id: { type: 'string', description: 'Voice identifier for TTS models (e.g. ElevenLabs voice_id).' },
        model_type: { type: 'string', description: 'Model identifier within the provider.' },
        duration: { type: 'number', minimum: 0, description: 'Target duration in seconds (music/clip models).' },
        sample_rate: {
          type: 'number',
          description: 'Sample rate override in Hz (e.g. 22050, 44100).',
        },
        style_prompt: {
          type: 'string',
          description: 'Provider-specific style/mood hint (e.g. "pop, sad, rainy night").',
        },
        file_urls: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional input file URLs (e.g. source audio for voice-change). ' +
            'Mirrors the SPA `attachments` argument translated to `file_urls`.',
        },
        model_settings: {
          type: 'object',
          additionalProperties: true,
          description:
            'Provider-specific settings merged into `body.settings` after the ' +
            'top-level fields above. Use for keys the top-level surface does ' +
            'not expose (e.g. suno wants `mode`, `is_instrumental`, `styles`, ' +
            '`title`, `negative_tags`, `source_clip_id`, `source_task_id`, ' +
            '`continue_at`). Merged AFTER the top-level fields, so values ' +
            'here override them. Only plain JSON values are allowed; arrays ' +
            'and nested objects are passed through verbatim.',
        },
      },
      required: ['chat_uuid', 'prompt'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const aiName = (args.ai_name as string | undefined) ?? 'elevenlabs';
        const settings: Record<string, unknown> = {};
        if (args.voice_id !== undefined) settings.voice_id = String(args.voice_id);
        if (args.model_type !== undefined) settings.model_type = String(args.model_type);
        if (args.duration !== undefined) settings.duration = Number(args.duration);
        if (args.sample_rate !== undefined) settings.sample_rate = Number(args.sample_rate);
        if (args.style_prompt !== undefined) settings.prompt = String(args.style_prompt);

        const modelSettings = args.model_settings;
        if (modelSettings !== undefined && modelSettings !== null) {
          if (typeof modelSettings !== 'object' || Array.isArray(modelSettings)) {
            throw new Error('model_settings must be a JSON object');
          }
        }

        const bodyParams: {
          chat_uuid: string;
          prompt: string;
          settings: Record<string, unknown>;
          file_urls?: string[];
          model_settings?: Record<string, unknown>;
        } = {
          chat_uuid: String(args.chat_uuid),
          prompt: String(args.prompt),
          settings,
          file_urls: (args.file_urls as string[] | undefined) ?? undefined,
        };
        if (modelSettings !== undefined && modelSettings !== null) {
          bodyParams.model_settings = modelSettings as Record<string, unknown>;
        }
        const result = await ctx.syntx.audio.generate(aiName, bodyParams);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'generate-audio');
      }
    },
  },
];
