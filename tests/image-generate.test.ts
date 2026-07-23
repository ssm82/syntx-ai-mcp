import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DesignResource } from '../src/resources/design';
import type { BaseClient } from '../src/client';
import { designTools } from '../src/mcp/tools/design';
import { allTools } from '../src/mcp/tools';
import type { McpContext } from '../src/mcp/registry';

// ── DesignResource.generate (SDK) ──────────────────────────────────────────

function capturePost() {
  const calls: Array<{ path: string; body?: unknown; query?: Record<string, unknown> }> = [];
  const client = {
    async post<T>(path: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
      calls.push({ path, body, query });
      return { ok: true } as T;
    },
  };
  return { client, calls };
}

test('DesignResource.generate posts to /api/v1/design/generate with ai_name query param', async () => {
  const { client, calls } = capturePost();
  await new DesignResource(client as unknown as BaseClient).generate('sora-images', {
    chat_uuid: 'chat-1',
    prompt: 'a cat astronaut',
    settings: { n: 1, model_type: 'gpt-image-2' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/design/generate');
  assert.deepEqual(calls[0].query, { ai_name: 'sora-images' });
  assert.deepEqual(calls[0].body, {
    chat_uuid: 'chat-1',
    prompt: 'a cat astronaut',
    settings: { n: 1, model_type: 'gpt-image-2' },
  });
});

test('DesignResource.generate merges model_settings into body.settings (last-wins)', async () => {
  const { client, calls } = capturePost();
  await new DesignResource(client as unknown as BaseClient).generate('sora-images', {
    chat_uuid: 'c',
    prompt: 'p',
    settings: { model_type: 'gpt-image-2', aspect_ratio: '1:1' },
    model_settings: { aspect_ratio: '16:9' },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.aspect_ratio, '16:9', 'model_settings must win the merge');
});

test('DesignResource.generate applies grok_image rule: drops aspect_ratio for grok_i2i_pro', async () => {
  const { client, calls } = capturePost();
  await new DesignResource(client as unknown as BaseClient).generate('grok_image', {
    chat_uuid: 'c',
    prompt: 'p',
    settings: { model_type: 'grok_i2i_pro', aspect_ratio: '1:1', resolution: '1k' },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.aspect_ratio, undefined);
  assert.equal(body.settings.resolution, '1k');
});

test('DesignResource.generate applies ideogram rule: drops aspect_ratio in upscale mode', async () => {
  const { client, calls } = capturePost();
  await new DesignResource(client as unknown as BaseClient).generate('ideogram', {
    chat_uuid: 'c',
    prompt: 'p',
    settings: { mode: 'upscale', aspect_ratio: '1:1', resolution: '1024x1024' },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.aspect_ratio, undefined);
  assert.equal(body.settings.resolution, '1024x1024');
});

test('DesignResource.generate applies seedream rule: 1K → 2K for seedream-4.5', async () => {
  const { client, calls } = capturePost();
  await new DesignResource(client as unknown as BaseClient).generate('seedream', {
    chat_uuid: 'c',
    prompt: 'p',
    settings: { model_type: 'seedream-4.5', resolution: '1K' },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.resolution, '2K');
});

test('DesignResource.generate does not mutate the caller-supplied settings object', async () => {
  const { client } = capturePost();
  const settings = { model_type: 'grok_i2i_pro', aspect_ratio: '1:1' };
  await new DesignResource(client as unknown as BaseClient).generate('grok_image', {
    chat_uuid: 'c',
    prompt: 'p',
    settings,
  });
  assert.equal(settings.aspect_ratio, '1:1');
});

// ── generate-image MCP tool ────────────────────────────────────────────────

test('generate-image MCP tool is registered in allTools', () => {
  assert.ok(designTools.find((t) => t.name === 'generate-image'));
  assert.ok(allTools.some((t) => t.name === 'generate-image'));
});

test('generate-image requires chat_uuid and prompt only', () => {
  const tool = designTools.find((t) => t.name === 'generate-image');
  if (!tool) throw new Error('generate-image tool not found');
  assert.deepEqual(tool.inputSchema.required, ['chat_uuid', 'prompt']);
});

test('generate-image input schema lists model_settings as a free-form object', () => {
  const tool = designTools.find((t) => t.name === 'generate-image');
  if (!tool) throw new Error('generate-image tool not found');
  const props = tool.inputSchema.properties as Record<string, unknown>;
  const ms = props.model_settings as { type: string; additionalProperties?: boolean };
  assert.equal(ms.type, 'object');
  assert.equal(ms.additionalProperties, true);
});

test('generate-image forwards a clean payload to the SDK', async () => {
  const calls: Array<{ aiName: string; params: unknown }> = [];
  const ctx = {
    syntx: {
      design: {
        generate: async (aiName: string, params: unknown) => {
          calls.push({ aiName, params });
          return { id: 11 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = designTools.find((t) => t.name === 'generate-image');
  if (!tool) throw new Error('generate-image tool not found');

  await tool.handler(
    {
      chat_uuid: 'c-1',
      prompt: 'a fox',
      n: 2,
      model_type: 'gpt-image-2',
      resolution: '1024x1024',
      quality: 'high',
      image_url: ['https://r2.syntx.ai/x.png'],
    },
    ctx,
  );
  const params = calls[0].params as { settings: Record<string, unknown> };
  assert.equal(params.settings.n, 2);
  assert.equal(params.settings.model_type, 'gpt-image-2');
  assert.equal(params.settings.resolution, '1024x1024');
  assert.equal(params.settings.quality, 'high');
  assert.deepEqual(params.settings.image_url, ['https://r2.syntx.ai/x.png']);
});

test('generate-image forwards model_settings to the SDK', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      design: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = designTools.find((t) => t.name === 'generate-image');
  if (!tool) throw new Error('generate-image tool not found');

  await tool.handler(
    {
      chat_uuid: 'c',
      prompt: 'p',
      ai_name: 'ideogram',
      model_settings: { mode: 'upscale', rendering_speed: 'TURBO' },
    },
    ctx,
  );
  const params = calls[0].params as { model_settings?: Record<string, unknown> };
  assert.deepEqual(params.model_settings, { mode: 'upscale', rendering_speed: 'TURBO' });
});

test('generate-image model_settings values override top-level keys', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      design: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = designTools.find((t) => t.name === 'generate-image');
  if (!tool) throw new Error('generate-image tool not found');

  await tool.handler(
    {
      chat_uuid: 'c',
      prompt: 'p',
      quality: 'medium',
      model_settings: { quality: 'high' },
    },
    ctx,
  );
  const params = calls[0].params as { settings: Record<string, unknown>; model_settings?: Record<string, unknown> };
  assert.equal(params.model_settings?.quality, 'high', 'model_settings must be forwarded verbatim');
});

test('generate-image rejects non-object model_settings', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      design: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = designTools.find((t) => t.name === 'generate-image');
  if (!tool) throw new Error('generate-image tool not found');

  const result = await tool.handler(
    {
      chat_uuid: 'c',
      prompt: 'p',
      model_settings: ['not', 'an', 'object'],
    },
    ctx,
  );
  assert.equal(result.isError, true);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /model_settings must be a JSON object/);
  assert.equal(calls.length, 0);
});

test('generate-image end-to-end: ideogram upscale strips aspect_ratio through the SDK', async () => {
  const { client, calls } = capturePost();
  const design = new DesignResource(client as unknown as BaseClient);
  // Simulate what the MCP handler forwards: typed settings + model_settings merged
  await design.generate('ideogram', {
    chat_uuid: 'c',
    prompt: 'p',
    settings: { aspect_ratio: '1:1' },
    model_settings: { mode: 'upscale' },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.mode, 'upscale');
  assert.equal(body.settings.aspect_ratio, undefined, 'ideogram rule must strip aspect_ratio in upscale mode');
});

test('generate-image surfaces SDK errors via toMcpError', async () => {
  const ctx = {
    syntx: {
      design: {
        generate: async () => {
          throw new Error('upstream down');
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = designTools.find((t) => t.name === 'generate-image');
  if (!tool) throw new Error('generate-image tool not found');
  const result = await tool.handler({ chat_uuid: 'c', prompt: 'p' }, ctx);
  assert.equal(result.isError, true);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /^generate-image: /);
  assert.match(text, /upstream down/);
});
