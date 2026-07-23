/**
 * Provider-specific normalization rules for `generate-video` / `generate-image`
 * / `generate-audio` SDK resources.
 *
 * The SPA strips or coerces a handful of `settings` keys per provider before
 * posting to the generation APIs. Calling the SDK with an unmodified settings
 * object — even one that matches the catalog's `get_cost_params` — fails with
 * 422 because the SPA's pre-processor runs first on the wire.
 *
 * To bridge that gap, this module exposes a small set of pure-function rules
 * keyed by `ai_name` and grouped by phase:
 *
 *   - `beforeMerge` — runs BEFORE user-supplied `model_settings` are merged.
 *     Used to coerce empty strings to defaults the SPA defaults set on the
 *     client (rare today; reserved for future providers).
 *   - `afterMerge`  — runs AFTER `model_settings` is merged in. Used to drop
 *     keys the SPA strips (e.g. `aspect_ratio` for `grok_i2v`, `mode` for
 *     `kling_o1_*`, etc.) and to coerce values (e.g. `seedream` resets a
 *     disabled resolution to the SPA default).
 *
 * The rules mirror the SPA payload shape captured in
 * `/tmp/kilo/syntx-assets/schema/<provider>.json` — see
 * `.kilo/plans/1784778632752-spa-provider-schema-audit.md` for the audit
 * trail. NO I/O happens here; the dispatcher mutates the supplied `Settings`
 * in place (last-wins style), which matches the SPA's pre-processor idiom.
 */

export type Settings = Record<string, unknown>;

export interface RuleContext {
  /** The `model_type` field passed through to the API, when known. */
  modelType: string;
  /** Number of input files attached to the call (image-to-X, voice-change, …). */
  fileCount?: number;
}

export interface ProviderRule {
  aiName: string;
  beforeMerge?(s: Settings, ctx: RuleContext): void;
  afterMerge?(s: Settings, ctx: RuleContext): void;
}

// ── helpers ────────────────────────────────────────────────────────────────

function drop(s: Settings, k: string): void {
  delete s[k];
}

function dropAll(s: Settings, keys: string[]): void {
  for (const k of keys) drop(s, k);
}

function isLandscape(ratio: string): boolean {
  const parts = ratio.split(':');
  if (parts.length !== 2) return false;
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return false;
  return w / h > 1.05;
}

// ── rules ──────────────────────────────────────────────────────────────────

const grokVideoRule: ProviderRule = {
  aiName: 'grok_video',
  afterMerge(s, ctx) {
    if (ctx.modelType === 'grok_i2v') {
      drop(s, 'aspect_ratio');
    }
    if (ctx.modelType === 'grok_v2v') {
      dropAll(s, ['aspect_ratio', 'video_duration', 'resolution']);
    }
  },
};

const klingVideoRule: ProviderRule = {
  aiName: 'kling',
  afterMerge(s, ctx) {
    if (/^kling_o1_/.test(ctx.modelType)) {
      drop(s, 'mode');
    }
  },
};

const runwayVideoRule: ProviderRule = {
  aiName: 'runway',
  afterMerge(s, ctx) {
    if (ctx.modelType === 'acttwo') {
      drop(s, 'video_duration');
    }
  },
};

const grokImageRule: ProviderRule = {
  aiName: 'grok_image',
  afterMerge(s, ctx) {
    if (ctx.modelType === 'grok_i2i_pro') {
      drop(s, 'aspect_ratio');
      return;
    }
    if (ctx.modelType === 'grok_i2i' && (ctx.fileCount ?? 0) < 2) {
      drop(s, 'aspect_ratio');
    }
  },
};

const ideogramImageRule: ProviderRule = {
  aiName: 'ideogram',
  afterMerge(s) {
    const mode = s.mode;
    if (mode === 'upscale') {
      drop(s, 'aspect_ratio');
      return;
    }
    if (mode === 'describe') {
      // Conservative allowlist — strip every key the SPA strips; the only
      // retained key is `image_url` (see ideogram schema notes). The audit
      // doesn't list the complete allowlist, so we delete the keys it
      // explicitly enumerates.
      dropAll(s, [
        'aspect_ratio',
        'quality',
        'details_quality',
        'seed',
        'style',
        'version',
        'negative_prompt',
        'enhance',
        'rendering_speed',
      ]);
    }
  },
};

const lumaImageRule: ProviderRule = {
  aiName: 'luma_image',
  afterMerge(s, ctx) {
    if ((ctx.fileCount ?? 0) > 0 && s.mode !== undefined) {
      s.mode = 'auto';
    }
    const mode = s.mode;
    const ratio = s.aspect_ratio;
    if (
      mode === 'manga' &&
      typeof ratio === 'string' &&
      /^\d+:\d+$/.test(ratio) &&
      isLandscape(ratio)
    ) {
      s.aspect_ratio = '2:3';
    }
  },
};

const midjourneyImageRule: ProviderRule = {
  aiName: 'midjourney',
  afterMerge(s) {
    const v = s.version;
    if (v === '8.1' || v === 'niji 7') {
      drop(s, 'quality');
    }
  },
};

const runwayFramesImageRule: ProviderRule = {
  aiName: 'runway-frames',
  afterMerge(s) {
    drop(s, 'style');
  },
};

const seedreamImageRule: ProviderRule = {
  aiName: 'seedream',
  afterMerge(s, ctx) {
    if (
      (ctx.modelType === 'seedream-4.5' || ctx.modelType === 'seedream-5') &&
      s.resolution === '1K'
    ) {
      s.resolution = '2K';
    }
    if (ctx.modelType === 'seedream-5.0-pro' && s.resolution === '4K') {
      s.resolution = '2K';
    }
  },
};

const soraImagesRule: ProviderRule = {
  aiName: 'sora-images',
  afterMerge(s, ctx) {
    if (ctx.modelType !== 'gpt-image-2') {
      drop(s, 'quality');
      drop(s, 'details_quality');
    }
  },
};

const wanImageRule: ProviderRule = {
  aiName: 'wan_image',
  afterMerge(s, ctx) {
    if (ctx.modelType === 'wan-2.7-pro' && (ctx.fileCount ?? 0) > 0 && s.resolution === '4K') {
      s.resolution = '2K';
    }
  },
};

const sunoAudioRule: ProviderRule = {
  aiName: 'suno',
  afterMerge(s) {
    // SPA strips these in `mode === 'generate'` (the default). The Suno
    // schema's `default_settings.mode === 'generate'` matches this branch
    // even when callers omit `mode` entirely.
    const mode = s.mode ?? 'generate';
    if (mode === 'generate') {
      dropAll(s, ['audio_url', 'continue_at', 'source_clip_id', 'source_task_id']);
    }
  },
};

export const RULES: ProviderRule[] = [
  // video
  grokVideoRule,
  klingVideoRule,
  runwayVideoRule,
  // image
  grokImageRule,
  ideogramImageRule,
  lumaImageRule,
  midjourneyImageRule,
  runwayFramesImageRule,
  seedreamImageRule,
  soraImagesRule,
  wanImageRule,
  // audio
  sunoAudioRule,
];

/**
 * Dispatch the rules for `aiName` at the given phase.
 *
 * Mutates `settings` in place. Unknown providers are a no-op — the SPA's
 * passthrough for `model_settings` covers them, and the audit confirmed no
 * conditional rules apply.
 */
export function applyProviderRules(
  aiName: string,
  settings: Settings,
  ctx: RuleContext,
  phase: 'before' | 'after',
): void {
  for (const rule of RULES) {
    if (rule.aiName !== aiName) continue;
    const fn = phase === 'before' ? rule.beforeMerge : rule.afterMerge;
    if (fn) fn(settings, ctx);
  }
}
