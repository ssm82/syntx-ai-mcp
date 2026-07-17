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
export const KNOWN_PROVIDERS: Readonly<Record<Scope, ReadonlySet<string>>> = Object.freeze({
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
export function inferScope(aiName: string | null | undefined): Scope | null {
  if (!aiName) return null;
  for (const scope of Object.keys(KNOWN_PROVIDERS) as Scope[]) {
    if (KNOWN_PROVIDERS[scope].has(aiName)) return scope;
  }
  return null;
}

export interface FilterParams {
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
export function filterModels(models: AIModel[], params: FilterParams = {}): AIModel[] {
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