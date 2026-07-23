import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';

/**
 * Video generation tool.
 *
 * Wraps `syntx.video.generate`, mirroring `generate-image` / `generate-audio`.
 *
 * Note: the catalog documents the body field as `chat_id` (NOT `chat_uuid`)
 * — distinct from the audio endpoint. If the server rejects with 422 in
 * production, this may need to switch to `chat_uuid`.
 */
export const videoTools: SyntxTool[] = [
  {
    name: 'generate-video',
    capability: { networkCall: true, costSideEffect: true },
    description:
      'Generate a video via syntx.ai. Mirrors `syntx.video.generate` and ' +
      'the SPA `ai-video.sendMessage` flow. ' +
      'Posts to `POST /api/v1/video/generate?ai_name={ai_name}`. ' +
      'Requires a target chat UUID (use `create-chat` first). ' +
      'Generation is long-running — poll the resulting chat with ' +
      '`wait-for-response` or `get-messages` to read the completed video URL ' +
      'once the model finishes.',
    inputSchema: {
      type: 'object',
      properties: {
        ai_name: {
          type: 'string',
          description:
            'Video provider name (e.g. "wan_video", "runway", "kling"). ' +
            'Use `list-models` with scope=video to discover valid values.',
          default: 'wan_video',
        },
        chat_id: { type: 'string', description: 'Target chat UUID (create one with create-chat).' },
        prompt: { type: 'string', description: 'Text prompt describing the video to produce.' },
        model_type: { type: 'string', description: 'Model identifier within the provider.' },
        duration: { type: 'number', minimum: 0, description: 'Target duration in seconds.' },
        resolution: {
          type: 'string',
          description: 'Output resolution, e.g. "1280x720" or "720x1280".',
        },
        aspect_ratio: {
          type: 'string',
          description: 'Aspect ratio, e.g. "16:9", "9:16", "1:1".',
        },
        fps: { type: 'number', description: 'Frame rate override.' },
        quality: { type: 'string', description: 'Quality preset (e.g. "low", "medium", "high").' },
        seed: { type: 'number', description: 'Seed for deterministic sampling, when supported.' },
        file_urls: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional input file URLs (e.g. source image for image-to-video). ' +
            '`wan_video` reads `settings.file_urls` for the same purpose.',
        },
        audio_url: {
          type: 'string',
          description:
            'Optional audio track URL to mix into the generated video. ' +
            'Distinct from `file_urls` (SPA `audio_url` field).',
        },
        model_settings: {
          type: 'object',
          additionalProperties: true,
          description:
            'Provider-specific settings merged into `body.settings` after the ' +
            'top-level fields above. Use for keys the top-level surface does ' +
            'not expose (e.g. grok_video wants `video_duration` not `duration`, ' +
            'and accepts resolution enum `480p`|`720p`; kling wants `version`, ' +
            '`mode`, `native_audio`). Merged AFTER the top-level fields, so ' +
            'values here override them. Only plain JSON values are allowed; ' +
            'arrays and nested objects are passed through verbatim.',
        },
      },
      required: ['chat_id', 'prompt'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const aiName = (args.ai_name as string | undefined) ?? 'wan_video';
        const settings: Record<string, unknown> = {};
        if (args.model_type !== undefined) settings.model_type = String(args.model_type);
        if (args.duration !== undefined) settings.duration = Number(args.duration);
        if (args.resolution !== undefined) settings.resolution = String(args.resolution);
        if (args.aspect_ratio !== undefined) settings.aspect_ratio = String(args.aspect_ratio);
        if (args.fps !== undefined) settings.fps = Number(args.fps);
        if (args.quality !== undefined) settings.quality = String(args.quality);
        if (args.seed !== undefined) settings.seed = Number(args.seed);
        const modelSettings = args.model_settings;
        if (modelSettings !== undefined && modelSettings !== null) {
          if (typeof modelSettings !== 'object' || Array.isArray(modelSettings)) {
            throw new Error('model_settings must be a JSON object');
          }
          for (const [k, v] of Object.entries(modelSettings as Record<string, unknown>)) {
            settings[k] = v;
          }
        }

        const body: {
          chat_id: string;
          prompt: string;
          settings: Record<string, unknown>;
          file_urls?: string[];
          audio_url?: string;
        } = {
          chat_id: String(args.chat_id),
          prompt: String(args.prompt),
          settings,
        };
        const fileUrls = args.file_urls as string[] | undefined;
        if (fileUrls !== undefined) body.file_urls = fileUrls;
        const audioUrl = typeof args.audio_url === 'string' && args.audio_url.length > 0
          ? args.audio_url
          : undefined;
        if (audioUrl !== undefined) body.audio_url = audioUrl;

        const result = await ctx.syntx.video.generate(aiName, body);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'generate-video');
      }
    },
  },
];