import type { SyntxTool } from '../registry';
import { wrapSdk } from './_helpers';
import type { AIModel } from '../../types';

/**
 * Coarse-grained capability category for an AI model.
 *
 * Inferred from `ai_name` (the syntx.ai service identifier). New providers
 * that don't match any bucket resolve to `null` and are only returned by
 * `list-models` when the `scope` filter is omitted — so they never get
 * silently mis-categorized, but also never disappear from the full listing.
 */
export type Scope = 'text' | 'image' | 'video' | 'audio' | 'upscale';

/**
 * Known provider → scope mapping. Extend here when syntx.ai onboards a new
 * service so it can be filtered explicitly.
 */
const KNOWN_PROVIDERS: Readonly<Record<Scope, ReadonlySet<string>>> = Object.freeze({
  text: new Set([
    'chatgpt',
    'claude',
    'deepseek',
    'gemini',
    'qwen',
    'grok',
    'perplexity',
  ]),
  image: new Set([
    'midjourney',
    'flux',
    'sora-images',
    'banana',
    'ideogram',
    'stable-diffusion',
    'recraft',
    'runway-frames',
    'seedream',
    'higgsfield-soul',
    'higgsfield',
    'kling-kolors',
    'kling',
  ]),
  video: new Set([
    'topaz_astra',
    'seedance',
    'beeble',
  ]),
  audio: new Set([
    'suno',
    'elevenlabs',
  ]),
  upscale: new Set([
    'magnific',
    'topaz_ai',
  ]),
});

/** Return the scope bucket for a syntx.ai provider, or `null` if unknown. */
function inferScope(aiName: string | null | undefined): Scope | null {
  if (!aiName) return null;
  for (const scope of Object.keys(KNOWN_PROVIDERS) as Scope[]) {
    if (KNOWN_PROVIDERS[scope].has(aiName)) return scope;
  }
  return null;
}

interface FilterParams {
  /** Limit to a single capability bucket. Omit to keep all models. */
  scope?: Scope;
  /** Exact match on the syntx.ai provider name (e.g. `"chatgpt"`). */
  ai_name?: string;
  /** Drop inactive models. Defaults to `true`. */
  active_only?: boolean;
  /** Case-insensitive substring against `value` and `label`. */
  search?: string;
}

/**
 * Apply `list-models` filters on the client side.
 *
 * Pure function — no API calls, no side effects. Safe to unit-test without
 * mocking. Combines all filters with AND semantics.
 */
function filterModels(models: AIModel[], params: FilterParams = {}): AIModel[] {
  const { scope, ai_name, active_only = true, search } = params;

  const needle = search?.trim().toLowerCase();

  return models.filter((m) => {
    if (active_only && m.active === false) return false;
    if (ai_name !== undefined && ai_name !== '' && m.ai_name !== ai_name) return false;
    if (scope !== undefined && inferScope(m.ai_name) !== scope) return false;
    if (needle) {
      const hay = `${m.value} ${m.label}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/** Catalog tools: AI services, models, and detailed model info. */
export const aiTools: SyntxTool[] = [
  {
    name: 'list-ai-services',
    description: 'List all syntx.ai AI services (e.g. ChatGPT, Midjourney, Sora) with their scope and status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: wrapSdk('list-ai-services', async (_args, ctx) => ctx.syntx.ai.listServices()),
  },
  {
    name: 'list-models',
    description:
      'List AI models with upload constraints, supported media types, and features. ' +
      'Filters (all optional, combined with AND): `scope` (text|image|video|audio|upscale), ' +
      '`ai_name` (exact match, e.g. "chatgpt"), `active_only` (default true), ' +
      '`search` (case-insensitive substring against `value`/`label`).',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['text', 'image', 'video', 'audio', 'upscale'],
          description:
            'Capability bucket inferred from the syntx.ai provider. ' +
            'Omit to receive models from every bucket (including providers that don\'t match any known bucket).',
        },
        ai_name: {
          type: 'string',
          description: 'Exact syntx.ai provider name, e.g. "chatgpt", "claude", "midjourney".',
        },
        active_only: {
          type: 'boolean',
          default: true,
          description: 'When true (default), drop inactive models. Set false to include them.',
        },
        search: {
          type: 'string',
          description: 'Case-insensitive substring matched against the model `value` and `label`.',
        },
      },
      additionalProperties: false,
    },
    handler: wrapSdk<
      {
        scope?: 'text' | 'image' | 'video' | 'audio' | 'upscale';
        ai_name?: string;
        active_only?: boolean;
        search?: string;
      },
      AIModel[]
    >('list-models', async (args, ctx) =>
      filterModels(await ctx.syntx.ai.listModels(), {
        scope: args.scope,
        ai_name: args.ai_name,
        active_only: args.active_only === undefined ? true : args.active_only,
        search: args.search,
      }),
    ),
  },
  {
    name: 'get-model-info',
    description:
      'Return detailed information about a specific AI model (pricing/cost params, limits). ' +
      'Providers whose catalog declares `get_cost_params` reject the request with 400 until ' +
      'the listed params are supplied — every `get_cost_params` field is accepted here as a ' +
      'flat top-level argument (see per-field descriptions for provider-specific enums).',
    inputSchema: {
      type: 'object',
      properties: {
        ai_name: { type: 'string', description: 'AI service name, e.g. "chatgpt".' },
        model_type: { type: 'string', description: 'Model identifier, e.g. "gpt-5-mini".' },
        batch_size: { type: 'number' },
        quality: {
          type: 'string',
          description:
            'Quality/size tier. For sora-images gpt-image-2 the API validates it as ' +
            '"1K" | "2K" | "4K" (NOT low/medium/high).',
        },
        video_duration: { type: 'number' },
        chars_count: { type: 'number' },
        mode: { type: 'string' },
        image_size: {
          type: 'string',
          description:
            'Image size tier, e.g. "1K", "2K", "4K". Required (in the query string) by ' +
            'providers with `get_cost_params: ["image_size"]` — banana / banana2 / banana3, ' +
            'seedream. Exposed flat because some MCP clients cannot pass nested objects reliably.',
        },
        details_quality: {
          type: 'string',
          description:
            'Details level (sora-images gpt-image-2: "high" confirmed; grok_imagine_2: ' +
            '"low" | "medium"). Required by /api/v2/get_model_info together with quality ' +
            'for that provider.',
        },
        resolution: {
          type: 'string',
          description:
            'Output resolution. Enum is per-provider, e.g. wan_video "720P"|"1080P", ' +
            'grok_image "1k"|"2k", hailuo-minimax "512p"|"768p"|"1080p"|"2K" (per model), ' +
            'topaz_astra/beeble "1920x1080"|"3840x2160". An invalid value yields a 400 ' +
            'listing the valid options.',
        },
        ref_count: {
          type: 'number',
          description:
            'Reference image count (sora-images gpt-image-2.5-*, grok_imagine_2, hailuo-3.0).',
        },
        size: {
          type: 'string',
          description:
            'Size tier. wan_image models use "1K"; seedance uses aspect ratios ' +
            '("21:9", "16:9", "9:16", "1:1", "4:3", "3:4", "adaptive").',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds (seedance-2.x, wan_2x r2v/videoedit, heygen, elevenlabs sts).',
        },
        frame_rate: {
          type: 'number',
          description: 'Frame rate (topaz_astra, beeble switchx).',
        },
        version: {
          type: 'string',
          description:
            'Model version (kling: "1.5"…"3.0"; kling_motion_control also "standart"|"hd"; suno: "V6").',
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
        width: { type: 'number', description: 'Target width (magnific).' },
        height: { type: 'number', description: 'Target height (magnific).' },
        scale_factor: {
          type: 'string',
          description: 'Upscale factor (magnific): "2x" | "4x" | "8x" | "16x".',
        },
        rendering_speed: {
          type: 'string',
          description: 'Rendering speed (ideogram), e.g. "TURBO".',
        },
      },
      required: ['ai_name', 'model_type'],
      additionalProperties: false,
    },
    handler: wrapSdk(
      'get-model-info',
      async (
        args: {
          ai_name: string;
          model_type: string;
          batch_size?: number;
          quality?: string;
          video_duration?: number | string;
          chars_count?: number;
          mode?: string;
          image_size?: string;
          details_quality?: string;
          resolution?: string;
          ref_count?: number;
          size?: string;
          duration?: number | string;
          frame_rate?: number;
          version?: string;
          native_audio?: boolean;
          generate_audio?: boolean;
          draft?: boolean;
          upscale?: number;
          gen_type?: string;
          width?: number;
          height?: number;
          scale_factor?: string;
          rendering_speed?: string;
        },
        ctx,
      ) =>
        ctx.syntx.ai.getModelInfo({
          ai_name: args.ai_name,
          model_type: args.model_type,
          batch_size: args.batch_size,
          quality: args.quality,
          video_duration: args.video_duration,
          chars_count: args.chars_count,
          mode: args.mode,
          image_size: args.image_size,
          details_quality: args.details_quality,
          resolution: args.resolution,
          ref_count: args.ref_count,
          size: args.size,
          duration: args.duration,
          frame_rate: args.frame_rate,
          version: args.version,
          native_audio: args.native_audio,
          generate_audio: args.generate_audio,
          draft: args.draft,
          upscale: args.upscale,
          gen_type: args.gen_type,
          width: args.width,
          height: args.height,
          scale_factor: args.scale_factor,
          rendering_speed: args.rendering_speed,
        }),
    ),
  },
];
