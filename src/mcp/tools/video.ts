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
        frame_rate: {
          type: 'number',
          description:
            'Frame rate (topaz_astra, beeble switchx). Distinct from `fps`: some ' +
            'providers spell the setting `frame_rate`.',
        },
        video_duration: {
          type: ['number', 'string'],
          description:
            'Duration in seconds for providers that spell it `video_duration` ' +
            '(kling: "5"|"10"|"15"; grok_video: "6"|"10"; sora: "4"…"25"; ' +
            'hailuo: "6"|"10"; veo_omni: "4"|"6"|"8"|"10"). String or number both accepted.',
        },
        mode: {
          type: 'string',
          description:
            'Generation mode (kling: "standart"|"hd"|"4K"; seedance: "std"; ' +
            'veo_omni: "frames"|"omni-references"|"edit"|"extend").',
        },
        size: {
          type: 'string',
          description: 'Size/aspect (seedance: "21:9"|"16:9"|"9:16"|"1:1"|"4:3"|"3:4"|"adaptive").',
        },
        version: {
          type: 'string',
          description: 'Model version (kling: "1.5"…"3.0"; kling_motion_control also "standart"|"hd").',
        },
        native_audio: {
          type: 'boolean',
          description: 'Native audio flag (kling, wan_26 i2v/r2v flash).',
        },
        generate_audio: {
          type: 'boolean',
          description: 'Generate audio track (seedance-1.5-pro).',
        },
        draft: {
          type: 'boolean',
          description: 'Draft mode (flux3_video).',
        },
        upscale: {
          type: 'number',
          description: 'Upscale flag as INTEGER 0|1 (veo3 family; the API rejects non-integers).',
        },
        gen_type: {
          type: 'string',
          description: 'Generation type for kling_motion_control ("mcv" | "mci").',
        },
        ref_count: {
          type: 'number',
          description: 'Reference image count (hailuo-3.0).',
        },
        quality: { type: 'string', description: 'Quality preset (e.g. sora: "480"|"720"|"1080").' },
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
        if (args.frame_rate !== undefined) settings.frame_rate = Number(args.frame_rate);
        if (args.video_duration !== undefined) settings.video_duration = args.video_duration;
        if (args.mode !== undefined) settings.mode = String(args.mode);
        if (args.size !== undefined) settings.size = String(args.size);
        if (args.version !== undefined) settings.version = String(args.version);
        if (args.native_audio !== undefined) settings.native_audio = Boolean(args.native_audio);
        if (args.generate_audio !== undefined) settings.generate_audio = Boolean(args.generate_audio);
        if (args.draft !== undefined) settings.draft = Boolean(args.draft);
        if (args.upscale !== undefined) settings.upscale = Number(args.upscale);
        if (args.gen_type !== undefined) settings.gen_type = String(args.gen_type);
        if (args.ref_count !== undefined) settings.ref_count = Number(args.ref_count);
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