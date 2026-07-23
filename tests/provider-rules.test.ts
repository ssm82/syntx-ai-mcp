import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyProviderRules,
  RULES,
  type Settings,
} from '../src/resources/provider-rules';

// ── dispatcher ─────────────────────────────────────────────────────────────

test('RULES is non-empty and contains the providers the audit flagged', () => {
  const names = RULES.map((r) => r.aiName);
  for (const expected of [
    'grok_video',
    'kling',
    'runway',
    'grok_image',
    'ideogram',
    'luma_image',
    'midjourney',
    'runway-frames',
    'seedream',
    'sora-images',
    'wan_image',
    'suno',
  ]) {
    assert.ok(names.includes(expected), `RULES must include ${expected}`);
  }
});

test('applyProviderRules is a no-op for unknown ai_name', () => {
  const s: Settings = { aspect_ratio: '16:9', duration: 5 };
  applyProviderRules('wan_video', s, { modelType: 'whatever' }, 'after');
  assert.deepEqual(s, { aspect_ratio: '16:9', duration: 5 });
});

test('applyProviderRules mutates the supplied settings in place', () => {
  const s: Settings = { aspect_ratio: '16:9' };
  const ret = applyProviderRules('grok_video', s, { modelType: 'grok_i2v' }, 'after');
  assert.equal(ret, undefined);
  assert.equal(s.aspect_ratio, undefined);
});

// ── grok_video ─────────────────────────────────────────────────────────────

test('grok_video retains aspect_ratio / video_duration / resolution for grok_t2v', () => {
  const s: Settings = { aspect_ratio: '16:9', video_duration: 6, resolution: '720p' };
  applyProviderRules('grok_video', s, { modelType: 'grok_t2v' }, 'after');
  assert.equal(s.aspect_ratio, '16:9');
  assert.equal(s.video_duration, 6);
  assert.equal(s.resolution, '720p');
});

test('grok_video drops aspect_ratio for grok_i2v', () => {
  const s: Settings = { aspect_ratio: '16:9', video_duration: 6, resolution: '720p' };
  applyProviderRules('grok_video', s, { modelType: 'grok_i2v' }, 'after');
  assert.equal(s.aspect_ratio, undefined);
  assert.equal(s.video_duration, 6);
  assert.equal(s.resolution, '720p');
});

test('grok_video drops aspect_ratio / video_duration / resolution for grok_v2v', () => {
  const s: Settings = { aspect_ratio: '16:9', video_duration: 6, resolution: '720p' };
  applyProviderRules('grok_video', s, { modelType: 'grok_v2v' }, 'after');
  assert.equal(s.aspect_ratio, undefined);
  assert.equal(s.video_duration, undefined);
  assert.equal(s.resolution, undefined);
});

// ── kling ──────────────────────────────────────────────────────────────────

test('kling drops mode for kling_o1_* models', () => {
  const s: Settings = { mode: 'pro', video_duration: 5, aspect_ratio: '16:9' };
  applyProviderRules('kling', s, { modelType: 'kling_o1_text2video' }, 'after');
  assert.equal(s.mode, undefined);
  assert.equal(s.video_duration, 5);
  assert.equal(s.aspect_ratio, '16:9');
});

test('kling retains mode for legacy kling_text2video', () => {
  const s: Settings = { mode: 'pro', video_duration: 5, aspect_ratio: '16:9' };
  applyProviderRules('kling', s, { modelType: 'kling_text2video' }, 'after');
  assert.equal(s.mode, 'pro');
});

// ── runway (video) ─────────────────────────────────────────────────────────

test('runway drops video_duration for acttwo', () => {
  const s: Settings = { aspect_ratio: '16:9', video_duration: 5 };
  applyProviderRules('runway', s, { modelType: 'acttwo' }, 'after');
  assert.equal(s.aspect_ratio, '16:9');
  assert.equal(s.video_duration, undefined);
});

// ── grok_image ─────────────────────────────────────────────────────────────

test('grok_image drops aspect_ratio for grok_i2i_pro', () => {
  const s: Settings = { aspect_ratio: '16:9', resolution: '1k' };
  applyProviderRules('grok_image', s, { modelType: 'grok_i2i_pro' }, 'after');
  assert.equal(s.aspect_ratio, undefined);
  assert.equal(s.resolution, '1k');
});

test('grok_image drops aspect_ratio for grok_i2i when fewer than 2 files', () => {
  const s: Settings = { aspect_ratio: '16:9', resolution: '1k' };
  applyProviderRules('grok_image', s, { modelType: 'grok_i2i', fileCount: 1 }, 'after');
  assert.equal(s.aspect_ratio, undefined);
});

test('grok_image keeps aspect_ratio for grok_i2i when 2+ files', () => {
  const s: Settings = { aspect_ratio: '16:9', resolution: '1k' };
  applyProviderRules('grok_image', s, { modelType: 'grok_i2i', fileCount: 2 }, 'after');
  assert.equal(s.aspect_ratio, '16:9');
});

// ── ideogram ───────────────────────────────────────────────────────────────

test('ideogram drops aspect_ratio for mode=upscale', () => {
  const s: Settings = { aspect_ratio: '16:9', resolution: '1024x1024', mode: 'upscale' };
  applyProviderRules('ideogram', s, { modelType: 'ideogram' }, 'after');
  assert.equal(s.aspect_ratio, undefined);
  assert.equal(s.resolution, '1024x1024');
});

test('ideogram strips known keys for mode=describe', () => {
  const s: Settings = {
    aspect_ratio: '16:9',
    quality: 'high',
    details_quality: 'high',
    seed: 42,
    style: 'cinematic',
    version: '3',
    negative_prompt: 'blurry',
    enhance: true,
    rendering_speed: 'TURBO',
    image_url: ['https://example.com/x.jpg'],
    mode: 'describe',
  };
  applyProviderRules('ideogram', s, { modelType: 'ideogram' }, 'after');
  for (const dropped of [
    'aspect_ratio',
    'quality',
    'details_quality',
    'seed',
    'style',
    'version',
    'negative_prompt',
    'enhance',
    'rendering_speed',
  ]) {
    assert.equal(s[dropped], undefined, `${dropped} must be stripped in describe mode`);
  }
  assert.deepEqual(s.image_url, ['https://example.com/x.jpg']);
  assert.equal(s.mode, 'describe');
});

// ── luma_image ─────────────────────────────────────────────────────────────

test('luma_image forces mode=auto when files are attached', () => {
  const s: Settings = { mode: 'manga', aspect_ratio: '2:3' };
  applyProviderRules('luma_image', s, { modelType: 'photon-flash-1', fileCount: 1 }, 'after');
  assert.equal(s.mode, 'auto');
});

test('luma_image coerces manga landscape aspect_ratio to 2:3', () => {
  const s: Settings = { mode: 'manga', aspect_ratio: '16:9' };
  applyProviderRules('luma_image', s, { modelType: 'photon-flash-1' }, 'after');
  assert.equal(s.aspect_ratio, '2:3');
});

test('luma_image keeps portrait aspect_ratio in manga mode', () => {
  const s: Settings = { mode: 'manga', aspect_ratio: '9:16' };
  applyProviderRules('luma_image', s, { modelType: 'photon-flash-1' }, 'after');
  assert.equal(s.aspect_ratio, '9:16');
});

test('luma_image leaves non-manga aspect_ratio alone', () => {
  const s: Settings = { mode: 'auto', aspect_ratio: '16:9' };
  applyProviderRules('luma_image', s, { modelType: 'photon-flash-1' }, 'after');
  assert.equal(s.aspect_ratio, '16:9');
});

// ── midjourney ─────────────────────────────────────────────────────────────

test('midjourney drops quality for v8.1 and niji 7', () => {
  for (const v of ['8.1', 'niji 7']) {
    const s: Settings = { version: v, quality: 1 };
    applyProviderRules('midjourney', s, { modelType: v }, 'after');
    assert.equal(s.quality, undefined, `quality must be dropped for ${v}`);
  }
});

// ── runway-frames (image) ──────────────────────────────────────────────────

test('runway-frames unconditionally drops style', () => {
  const s: Settings = { style: 'cinematic', aspect_ratio: '16:9' };
  applyProviderRules('runway-frames', s, { modelType: 'gen4_turbo' }, 'after');
  assert.equal(s.style, undefined);
  assert.equal(s.aspect_ratio, '16:9');
});

// ── seedream ───────────────────────────────────────────────────────────────

test('seedream resets 1K to 2K for seedream-4.5 and seedream-5', () => {
  for (const mt of ['seedream-4.5', 'seedream-5']) {
    const s: Settings = { resolution: '1K' };
    applyProviderRules('seedream', s, { modelType: mt }, 'after');
    assert.equal(s.resolution, '2K', `seedream must reset 1K for ${mt}`);
  }
});

test('seedream resets 4K to 2K for seedream-5.0-pro', () => {
  const s: Settings = { resolution: '4K' };
  applyProviderRules('seedream', s, { modelType: 'seedream-5.0-pro' }, 'after');
  assert.equal(s.resolution, '2K');
});

test('seedream leaves 2K alone for any model', () => {
  const s: Settings = { resolution: '2K' };
  applyProviderRules('seedream', s, { modelType: 'seedream-5.0-pro' }, 'after');
  assert.equal(s.resolution, '2K');
});

// ── sora-images ────────────────────────────────────────────────────────────

test('sora-images drops quality / details_quality for non gpt-image-2 models', () => {
  const s: Settings = { quality: 'high', details_quality: 'high', aspect_ratio: '1:1' };
  applyProviderRules('sora-images', s, { modelType: 'gpt-image-1' }, 'after');
  assert.equal(s.quality, undefined);
  assert.equal(s.details_quality, undefined);
  assert.equal(s.aspect_ratio, '1:1');
});

test('sora-images keeps quality / details_quality for gpt-image-2', () => {
  const s: Settings = { quality: 'high', details_quality: 'high' };
  applyProviderRules('sora-images', s, { modelType: 'gpt-image-2' }, 'after');
  assert.equal(s.quality, 'high');
  assert.equal(s.details_quality, 'high');
});

// ── wan_image ──────────────────────────────────────────────────────────────

test('wan_image coerces 4K → 2K for wan-2.7-pro when files are attached', () => {
  const s: Settings = { resolution: '4K' };
  applyProviderRules('wan_image', s, { modelType: 'wan-2.7-pro', fileCount: 1 }, 'after');
  assert.equal(s.resolution, '2K');
});

test('wan_image leaves 4K alone for wan-2.7-pro without files', () => {
  const s: Settings = { resolution: '4K' };
  applyProviderRules('wan_image', s, { modelType: 'wan-2.7-pro' }, 'after');
  assert.equal(s.resolution, '4K');
});

// ── suno ───────────────────────────────────────────────────────────────────

test('suno strips source keys in generate mode', () => {
  const s: Settings = {
    mode: 'generate',
    audio_url: 'https://example.com/x.mp3',
    continue_at: 12,
    source_clip_id: 'abc',
    source_task_id: 'xyz',
    title: 'hi',
  };
  applyProviderRules('suno', s, { modelType: 'V4' }, 'after');
  assert.equal(s.audio_url, undefined);
  assert.equal(s.continue_at, undefined);
  assert.equal(s.source_clip_id, undefined);
  assert.equal(s.source_task_id, undefined);
  assert.equal(s.title, 'hi');
});

test('suno strips source keys in generate mode when mode is unset (SPA default)', () => {
  const s: Settings = {
    audio_url: 'https://example.com/x.mp3',
    continue_at: 12,
    source_clip_id: 'abc',
    source_task_id: 'xyz',
  };
  applyProviderRules('suno', s, { modelType: 'V4' }, 'after');
  assert.equal(s.audio_url, undefined);
  assert.equal(s.continue_at, undefined);
  assert.equal(s.source_clip_id, undefined);
  assert.equal(s.source_task_id, undefined);
});

test('suno keeps source keys in extend mode', () => {
  const s: Settings = {
    mode: 'extend',
    audio_url: 'https://example.com/x.mp3',
    continue_at: 12,
  };
  applyProviderRules('suno', s, { modelType: 'V4' }, 'after');
  assert.equal(s.audio_url, 'https://example.com/x.mp3');
  assert.equal(s.continue_at, 12);
});

// ── phase dispatch ─────────────────────────────────────────────────────────

test('applyProviderRules(..., phase="before") does not invoke afterMerge hooks', () => {
  const s: Settings = { aspect_ratio: '16:9' };
  applyProviderRules('grok_video', s, { modelType: 'grok_i2v' }, 'before');
  // grok_video only defines afterMerge, so before must not touch the key
  assert.equal(s.aspect_ratio, '16:9');
});
