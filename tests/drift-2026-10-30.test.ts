import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:http';

import { SyntxClient } from '../src/syntx-client';
import { buildScopeMap, filterModels, inferScope } from '../src/mcp/tools/ai';
import type { AIService, AIModel } from '../src/types';

/**
 * 2026-10-30 drift sweep — prod-SPA bundle `1793202992`.
 *
 * Covers the shape and enum/range fixes that the sweep found:
 *   • `GET /api/v1/llm/limits` gained a top-level `plan` key.
 *   • `GET /api/v1/trends/categories` elements are `{id, slug, title}`.
 *   • `GET /api/v1/promo_banners` — the `landing` group has its own shape.
 *   • The provider → scope map used by `list-models` is derived from the
 *     live catalog instead of a frozen table, so a `scope` filter can no
 *     longer silently drop providers the SDK has not heard of.
 */

function serve(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void,
): Promise<{ baseURL: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    handler(req, res, u);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseURL: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// ─── SHAPE — llm/limits gained `plan` ─────────────────────────────────────

test('llm.getLimits surfaces the top-level `plan` key', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        plan: 'pro',
        window_6h: { percent_left: 100, started_at: null, expires_at: null },
        window_7d: { percent_left: 65.8, started_at: '2026-10-29T00:00:00Z', expires_at: '2026-11-05T00:00:00Z' },
      }),
    );
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.llm.getLimits();
    assert.equal(out.plan, 'pro');
    assert.equal(out.window_6h?.percent_left, 100);
    assert.equal(out.window_7d?.percent_left, 65.8);
  } finally {
    await s.close();
  }
});

test('llm.getLimits reports plan as null when the server omits it', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ window_6h: null, window_7d: null }));
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.llm.getLimits();
    assert.equal(out.plan, null);
  } finally {
    await s.close();
  }
});

// ─── SHAPE — trends/categories elements ────────────────────────────────────

test('trends.categories returns {id, slug, title} elements', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        categories: [
          { id: '01a08aac-b48c-70fc-8558-de624cac8186', slug: 'new', title: 'New' },
        ],
      }),
    );
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.trends.categories();
    assert.equal(out.categories[0].title, 'New');
    assert.equal(out.categories[0].slug, 'new');
    assert.equal(out.categories[0].id, '01a08aac-b48c-70fc-8558-de624cac8186');
    // The legacy `name` alias stays optional and is absent on the wire.
    assert.equal(out.categories[0].name, undefined);
  } finally {
    await s.close();
  }
});

// ─── SHAPE — promo_banners has two distinct element shapes ────────────────

test('plans.getPromoBanners keeps the header and landing shapes apart', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        header: [
          {
            uuid: 'h1',
            body: '<p>Kling 4.0</p>',
            buttons: [{ link: 'https://syntx.ai/video/kling', text: 'Try it' }],
            open_in_new_tab: true,
            order: 1,
          },
        ],
        landing: [
          {
            uuid: 'l1',
            primary_title: 'Try Kling 4.0',
            secondary_title: 'IN KEYFRAMES AND OMNI-REFERENCE',
            subtitle: null,
            feature: 'Up to 30 seconds',
            description: '…',
            type: 'info',
            model_name: 'Kling 4.0',
            button: { active: true, link: 'https://syntx.ai/video/kling', text: 'Try Kling 4.0', new_tab: true },
            date: null,
            media_url: ['https://r2.syntx.ai/ERP/landing_banners/x.webp'],
          },
        ],
      }),
    );
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.plans.getPromoBanners();
    assert.equal(out.header[0].body, '<p>Kling 4.0</p>');
    assert.equal(out.header[0].buttons?.[0].text, 'Try it');
    assert.equal(out.landing[0].primary_title, 'Try Kling 4.0');
    assert.equal(out.landing[0].button?.text, 'Try Kling 4.0');
    assert.equal(out.landing[0].media_url?.length, 1);
  } finally {
    await s.close();
  }
});

// ─── ENUM/RANGE — the provider → scope map is live, not frozen ────────────

test('buildScopeMap folds the upstream tool_* scopes into the coarse buckets', () => {
  const services: AIService[] = [
    { value: 'chatgpt', label: 'ChatGPT', scope: 'text', active: true, description: null },
    { value: 'kimi', label: 'Kimi', scope: 'text', active: true, description: null },
    { value: 'zai', label: 'Zhipu AI', scope: 'text', active: true, description: null },
    { value: 'wan_image', label: 'Wan', scope: 'image', active: true, description: null },
    { value: 'veo3', label: 'Google Veo', scope: 'video', active: true, description: null },
    { value: 'video2audio', label: 'Video to audio', scope: 'audio', active: true, description: null },
    { value: 'seedream-editor', label: 'Seedream 5 Pro Editor', scope: 'tool_image_inpaint', active: true, description: null },
    { value: 'clarity', label: 'Clarity', scope: 'tool_image_upscaler', active: true, description: null },
    { value: 'topaz_astra', label: 'Topaz Astra', scope: 'tool_video_upscaler', active: true, description: null },
  ];
  const map = buildScopeMap(services);

  assert.equal(inferScope('chatgpt', map), 'text');
  assert.equal(inferScope('kimi', map), 'text');
  assert.equal(inferScope('zai', map), 'text');
  assert.equal(inferScope('wan_image', map), 'image');
  assert.equal(inferScope('veo3', map), 'video');
  assert.equal(inferScope('video2audio', map), 'audio');
  assert.equal(inferScope('seedream-editor', map), 'image');
  assert.equal(inferScope('clarity', map), 'upscale');
  assert.equal(inferScope('topaz_astra', map), 'upscale');
});

test('filterModels keeps providers the scope filter knows about (regression: kimi / zai were dropped)', () => {
  const models: AIModel[] = [
    { value: 'kimi-k2', label: 'Kimi K2', ai_name: 'kimi', active: true, default: false, description: null, type: null, settings: {}, features: null },
    { value: 'glm-4', label: 'GLM 4', ai_name: 'zai', active: true, default: false, description: null, type: null, settings: {}, features: null },
    { value: 'gpt-6', label: 'GPT 6', ai_name: 'chatgpt', active: true, default: false, description: null, type: null, settings: {}, features: null },
  ];
  const scopeMap = buildScopeMap([
    { value: 'chatgpt', label: 'ChatGPT', scope: 'text', active: true, description: null },
    { value: 'kimi', label: 'Kimi', scope: 'text', active: true, description: null },
    { value: 'zai', label: 'Zhipu AI', scope: 'text', active: true, description: null },
  ]);

  const out = filterModels(models, { scope: 'text', scopeMap });
  assert.deepEqual(
    out.map((m) => m.value).sort(),
    ['glm-4', 'gpt-6', 'kimi-k2'],
  );
});

test('filterModels drops providers outside the requested bucket', () => {
  const models: AIModel[] = [
    { value: 'kimi-k2', label: 'Kimi K2', ai_name: 'kimi', active: true, default: false, description: null, type: null, settings: {}, features: null },
    { value: 'wan', label: 'Wan', ai_name: 'wan_image', active: true, default: false, description: null, type: null, settings: {}, features: null },
  ];
  const scopeMap = buildScopeMap([
    { value: 'kimi', label: 'Kimi', scope: 'text', active: true, description: null },
    { value: 'wan_image', label: 'Wan', scope: 'image', active: true, description: null },
  ]);

  assert.deepEqual(
    filterModels(models, { scope: 'image', scopeMap }).map((m) => m.value),
    ['wan'],
  );
});

test('buildScopeMap joins the two catalogs despite `_` vs `-` provider spellings', () => {
  const map = buildScopeMap([
    { value: 'midjourney-editor', label: 'MJ Editor', scope: 'tool_image_editor', active: true, description: null },
  ]);
  // `/api/v1/ai/models` spells the same provider `midjourney_editor`.
  assert.equal(inferScope('midjourney-editor', map), 'image');
  assert.equal(inferScope('midjourney_editor', map), 'image');
});

test('filterModels searches the LLM-catalog identifier (`id`) when `value` is absent', () => {
  // The text scope is served from `GET /api/v1/llm/models`, whose rows carry
  // `id` instead of `value` — a search by model id used to match nothing.
  const textRows = [
    { id: 'claude-opus-5', label: 'Claude Opus 5', ai_name: 'claude' },
    { id: 'gpt-6-luna', label: 'GPT 6 Luna', ai_name: 'chatgpt' },
  ] as unknown as AIModel[];

  assert.deepEqual(
    filterModels(textRows, { search: 'claude-opus-5' }).map((m) => (m as unknown as { id: string }).id),
    ['claude-opus-5'],
  );
  assert.deepEqual(
    filterModels(textRows, { search: 'gpt-6' }).map((m) => (m as unknown as { id: string }).id),
    ['gpt-6-luna'],
  );
});
