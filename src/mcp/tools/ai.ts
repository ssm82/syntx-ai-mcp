import type { SyntxTool } from '../registry';
import { wrapSdk } from './_helpers';
import { mergeModelCatalogs, normalizeLlmModel } from '../../resources/ai';
import type { AIModel, AIService } from '../../types';

/**
 * Coarse-grained capability category for an AI model.
 *
 * The upstream API groups services into fine-grained scopes
 * (`text`, `image`, `video`, `audio`, `tool_image_editor`,
 * `tool_image_inpaint`, `tool_image_upscaler`, `tool_video_inpaint`,
 * `tool_video_upscaler`). This filter collapses them into five buckets
 * so the tool surface stays small.
 */
export type Scope = 'text' | 'image' | 'video' | 'audio' | 'upscale';

/**
 * Upstream catalogs `list-models` can read.
 *
 * The schema `enum` and the handler's exhaustiveness check are both
 * derived from this list, so adding a catalog stays a one-line change
 * instead of two edits that can drift apart.
 */
export const MODEL_SOURCES = ['ai', 'llm', 'both'] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

/**
 * Upstream `scope` → coarse bucket.
 *
 * The editor / inpaint scopes produce images, so they fold into `image`;
 * the video-inpaint scope folds into `video`. Only the upscaler scopes
 * fold into `upscale` — `topaz_astra` and `topaz_ai` are video
 * *upscalers*, not video generators.
 */
const SCOPE_BUCKETS: Readonly<Record<string, Scope>> = Object.freeze({
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  tool_image_editor: 'image',
  tool_image_inpaint: 'image',
  tool_image_upscaler: 'upscale',
  tool_video_inpaint: 'video',
  tool_video_upscaler: 'upscale',
});

/**
 * Canonical provider key.
 *
 * The two upstream catalogs disagree on spelling for at least one provider:
 * `GET /api/v1/ai` reports `midjourney-editor` (hyphen) while
 * `GET /api/v1/ai/models` reports `midjourney_editor` (underscore). Joining
 * the catalogs on the raw name therefore silently dropped that provider
 * from every scope bucket. Normalising `_` to `-` makes the join robust to
 * that class of drift.
 */
function canonicalProvider(aiName: string): string {
  return aiName.trim().toLowerCase().replace(/_/g, '-');
}

/**
 * Build the provider → scope map from the live service catalog.
 *
 * DRIFT FIX (2026-10-30): this used to be a hard-coded `KNOWN_PROVIDERS`
 * table. It went stale in both directions — upstream added providers
 * (`kimi`, `zai`, `grok_image`, `veo3`, `wan_video`, …) and retired others
 * (`stable-diffusion`, `recraft`, `kling-kolors`) — and because unknown
 * providers resolved to `null`, a `scope` filter **silently dropped**
 * every model the table did not know about. Live proof: `list-models`
 * with `scope=text` returned 42 models while the catalog held 46 (the
 * missing four were `kimi` ×2 and `zai` ×2).
 *
 * The live catalog (`GET /api/v1/ai`) is the authority, so the map is
 * derived from it on every call instead of being frozen in source.
 */
export function buildScopeMap(services: AIService[]): Map<string, Scope> {
  const map = new Map<string, Scope>();
  for (const service of services) {
    const bucket = SCOPE_BUCKETS[service.scope];
    if (bucket) map.set(canonicalProvider(service.value), bucket);
  }
  return map;
}

/** Return the scope bucket for a syntx.ai provider, or `null` if unknown. */
export function inferScope(
  aiName: string | null | undefined,
  scopeMap: ReadonlyMap<string, Scope>,
): Scope | null {
  if (!aiName) return null;
  return scopeMap.get(canonicalProvider(aiName)) ?? null;
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
  /** Provider → scope map derived from the live service catalog. */
  scopeMap?: ReadonlyMap<string, Scope>;
}

/**
 * Apply `list-models` filters on the client side.
 *
 * Pure function — no API calls, no side effects. Safe to unit-test without
 * mocking. Combines all filters with AND semantics.
 */
export function filterModels(models: AIModel[], params: FilterParams = {}): AIModel[] {
  const { scope, ai_name, active_only = true, search, scopeMap } = params;

  const needle = search?.trim().toLowerCase();

  return models.filter((m) => {
    if (active_only && m.active === false) return false;
    if (ai_name !== undefined && ai_name !== '' && m.ai_name !== ai_name) return false;
    if (scope !== undefined && inferScope(m.ai_name, scopeMap ?? new Map()) !== scope) {
      return false;
    }
    if (needle) {
      // Text-scope models come from the LLM catalog, which carries `id`
      // instead of `value`. Match on whichever identifier the source
      // provides, otherwise a search by model id silently returns nothing.
      const identifier = m.value ?? (m as { id?: unknown }).id;
      const hay = `${identifier ?? ''} ${m.label ?? ''}`.toLowerCase();
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
      '`search` (case-insensitive substring against the model id / `value` and `label`), ' +
      '`source` (which upstream catalog to read: "ai" | "llm" | "both"). ' +
      'The two catalogs are not in sync — use `source: "both"` to see every model. ' +
      '`value` is always the model identifier; text-catalog rows additionally carry an `llm` ' +
      'object with the context window, capabilities and subscription gate.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['text', 'image', 'video', 'audio', 'upscale'],
          description:
            'Capability bucket, resolved against the live provider catalog. ' +
            'Omit to receive models from every bucket (including providers whose ' +
            'scope the API does not report).',
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
          description: 'Case-insensitive substring matched against the model id and `label`.',
        },
        source: {
          type: 'string',
          enum: [...MODEL_SOURCES],
          description:
            'Which catalog to read. "ai" (default) = the platform catalog: the general ' +
            'catalog merged with the text catalog, because upstream keeps the two in ' +
            'sync only partially — "gpt-6.1-sol" exists only in the text catalog. ' +
            '"llm" = the text catalog alone (the view the SPA text-flow picker uses). ' +
            '"both" = an explicit spelling of "ai".',
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
        source?: ModelSource;
      },
      AIModel[]
    >('list-models', async (args, ctx) => {
      // The MCP server validates the arguments against this tool's schema
      // before the handler runs (see `mcp/validation.ts`), so the `enum`
      // above already rejects an unknown `source` for MCP callers. The
      // check below keeps the same guarantee for SDK consumers that invoke
      // the exported handler directly — otherwise an unrecognised value
      // would silently fall back to a catalog the caller did not ask for.
      const requested = args.source;
      if (requested !== undefined && !MODEL_SOURCES.includes(requested)) {
        throw new Error(
          `list-models: unknown source "${String(requested)}" — expected ${MODEL_SOURCES.map((s) => `"${s}"`).join(', ')}.`,
        );
      }

      // The two upstream catalogs are not in sync: the LLM catalog carries
      // text models the general catalog does not (`gpt-6.1-sol`), and the
      // general catalog carries everything non-text.
      //
      // - "ai" (default) = the platform catalog: the general catalog merged
      //   with the text catalog, so every model the platform can serve is
      //   visible here.
      // - "llm" = the text catalog alone — the view the SPA's text-flow
      //   picker uses.
      // - "both" = an explicit spelling of "ai".
      const source = requested ?? 'ai';
      const activeOnly = args.active_only === undefined ? true : args.active_only;

      let models: AIModel[];
      if (source === 'llm') {
        const llmModels = await ctx.syntx.llm.listModels({
          enabled_only: activeOnly ? true : false,
        });
        models = llmModels.map(normalizeLlmModel);
      } else {
        const [aiModels, llmModels] = await Promise.all([
          ctx.syntx.ai.listModels(),
          ctx.syntx.llm.listModels({ enabled_only: activeOnly ? true : false }),
        ]);
        models = mergeModelCatalogs(aiModels, llmModels);
      }

      // The provider → scope map is derived from the live service catalog
      // rather than a frozen table, so a `scope` filter can never silently
      // drop a provider the SDK has not heard of yet.
      const scopeMap =
        args.scope === undefined
          ? new Map()
          : buildScopeMap(await ctx.syntx.ai.listServices());

      return filterModels(models, {
        scope: args.scope,
        ai_name: args.ai_name,
        active_only: activeOnly,
        search: args.search,
        scopeMap,
      });
    }),
  },
];
