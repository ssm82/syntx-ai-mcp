import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aiTools } from '../src/mcp/tools/ai';

function createMockSyntx(overrides: Partial<{ ai: Record<string, unknown> }> = {}) {
  return {
    ai: {
      getModelInfo: overrides.ai?.getModelInfo,
    },
  } as unknown as import('../src/syntx-client').SyntxClient;
}

function makeContext(syntx: import('../src/syntx-client').SyntxClient) {
  return {
    syntx,
    config: {
      baseURL: 'https://api.syntx.ai',
      lang: 'en',
      defaultAI: 'chatgpt',
      defaultModel: null,
      pollInterval: 5000,
      pollTimeout: 600000,
      transport: 'stdio' as const,
      httpPort: 3000,
      httpHostname: '127.0.0.1',
      httpToken: undefined,
      streamMode: 'auto' as const,
      wsURL: 'wss://api.syntx.ai/api/v1',
    },
    setToken: () => {},
    setDefaultModel: () => {},
    setDefaultAI: () => {},
  } as unknown as import('../src/mcp/registry').McpContext;
}

test('get-model-info tool is registered with get_cost_params coverage in the schema', () => {
  const tool = aiTools.find((t) => t.name === 'get-model-info');
  assert.ok(tool, 'get-model-info tool must be registered');
  assert.match(tool!.description, /get_cost_params/);
  const props = tool!.inputSchema.properties as Record<string, { type?: string }>;
  assert.equal(props.image_size?.type, 'string');
  assert.equal(props.details_quality?.type, 'string');
});

/**
 * Every field that appears in any provider's catalog `settings.get_cost_params`
 * must be exposed as a flat top-level argument — verified live against
 * /api/v2/get_model_info (2026-09-23): all 23 fields are consumed by the API.
 */
const COST_PARAM_FIELDS: Array<[string, string]> = [
  ['ai_name', 'string'],
  ['model_type', 'string'],
  ['batch_size', 'number'],
  ['quality', 'string'],
  ['video_duration', 'string'], // union ['number','string'] → first entry in props type check
  ['chars_count', 'string'],
  ['mode', 'string'],
  ['image_size', 'string'],
  ['details_quality', 'string'],
  ['resolution', 'string'],
  ['ref_count', 'string'],
  ['size', 'string'],
  ['duration', 'string'],
  ['frame_rate', 'string'],
  ['version', 'string'],
  ['native_audio', 'string'],
  ['generate_audio', 'string'],
  ['draft', 'string'],
  ['upscale', 'string'],
  ['gen_type', 'string'],
  ['width', 'string'],
  ['height', 'string'],
  ['scale_factor', 'string'],
  ['rendering_speed', 'string'],
];

test('get-model-info schema covers every known get_cost_params field', () => {
  const tool = aiTools.find((t) => t.name === 'get-model-info');
  if (!tool) throw new Error('get-model-info tool not found');
  const props = tool.inputSchema.properties as Record<string, { type?: string | string[] }>;
  for (const [field] of COST_PARAM_FIELDS) {
    assert.ok(props[field], `schema must expose ${field}`);
    const type = Array.isArray(props[field].type) ? props[field].type?.join('|') : props[field].type;
    assert.ok(type, `${field} must have a type`);
  }
});

test('get-model-info forwards flat image_size to the SDK (banana path)', async () => {
  const calls: Array<{ params: unknown }> = [];
  const syntx = createMockSyntx({
    ai: {
      getModelInfo: async (params: unknown) => {
        calls.push({ params });
        return { ai_name: 'banana', model_type: 'banana3', cost: { per_image_1K: 25 } };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = aiTools.find((t) => t.name === 'get-model-info')!;

  const result = await tool.handler(
    { ai_name: 'banana', model_type: 'banana3', image_size: '1K' },
    ctx,
  );

  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 1);
  const params = calls[0].params as { image_size?: string };
  assert.equal(params.image_size, '1K');
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /per_image_1K/);
});

test('get-model-info forwards details_quality to the SDK (sora-images path)', async () => {
  const calls: Array<{ params: unknown }> = [];
  const syntx = createMockSyntx({
    ai: {
      getModelInfo: async (params: unknown) => {
        calls.push({ params });
        return { ai_name: 'sora-images', model_type: 'gpt-image-2', cost: 5 };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = aiTools.find((t) => t.name === 'get-model-info')!;

  const result = await tool.handler(
    { ai_name: 'sora-images', model_type: 'gpt-image-2', quality: '1K', details_quality: 'high' },
    ctx,
  );

  assert.equal(result.isError, undefined);
  const params = calls[0].params as { quality?: string; details_quality?: string };
  assert.equal(params.quality, '1K');
  assert.equal(params.details_quality, 'high');
});

test('get-model-info forwards video/scale params to the SDK (veo3/magnific paths)', async () => {
  const calls: Array<{ params: unknown }> = [];
  const syntx = createMockSyntx({
    ai: {
      getModelInfo: async (params: unknown) => {
        calls.push({ params });
        return { ai_name: 'veo3', model_type: 'veo3', cost: 119 };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = aiTools.find((t) => t.name === 'get-model-info')!;

  const result = await tool.handler(
    {
      ai_name: 'veo3',
      model_type: 'veo3',
      upscale: 0,
      video_duration: '6',
      version: '1.6',
      native_audio: true,
      resolution: '720P',
      ref_count: 2,
      scale_factor: '4x',
      rendering_speed: 'TURBO',
    },
    ctx,
  );

  assert.equal(result.isError, undefined);
  const params = calls[0].params as Record<string, unknown>;
  assert.equal(params.upscale, 0);
  assert.equal(params.video_duration, '6');
  assert.equal(params.version, '1.6');
  assert.equal(params.native_audio, true);
  assert.equal(params.resolution, '720P');
  assert.equal(params.ref_count, 2);
  assert.equal(params.scale_factor, '4x');
  assert.equal(params.rendering_speed, 'TURBO');
});

test('get-model-info without image_size still works for providers that do not need it', async () => {
  const calls: Array<{ params: unknown }> = [];
  const syntx = createMockSyntx({
    ai: {
      getModelInfo: async (params: unknown) => {
        calls.push({ params });
        return { ai_name: 'chatgpt', model_type: 'gpt-5-mini' };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = aiTools.find((t) => t.name === 'get-model-info')!;

  const result = await tool.handler({ ai_name: 'chatgpt', model_type: 'gpt-5-mini' }, ctx);

  assert.equal(result.isError, undefined);
  const params = calls[0].params as { image_size?: string };
  assert.equal(params.image_size, undefined);
});

test('get-model-info surfaces SDK errors via toMcpError', async () => {
  const syntx = createMockSyntx({
    ai: {
      getModelInfo: async () => {
        throw new Error('image_size is required for banana');
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = aiTools.find((t) => t.name === 'get-model-info')!;

  const result = await tool.handler({ ai_name: 'banana', model_type: 'banana3' }, ctx);

  assert.equal(result.isError, true);
  assert.match(
    (result.content[0] as { text: string }).text,
    /get-model-info: .*image_size is required for banana/,
  );
});
