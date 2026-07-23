import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VideoResource } from '../src/resources/video';
import type { BaseClient } from '../src/client';
import { videoTools } from '../src/mcp/tools/video';
import { allTools } from '../src/mcp/tools';
import { createMcpContext } from '../src/mcp/context';
import type { McpContext } from '../src/mcp/registry';

// ── VideoResource.generate (SDK) ───────────────────────────────────────────

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

test('VideoResource.generate posts to /api/v1/video/generate with ai_name query param', async () => {
  const { client, calls } = capturePost();
  await new VideoResource(client as unknown as BaseClient).generate('wan_video', {
    chat_id: 'chat-1',
    prompt: 'a cat walking on the beach',
    settings: { duration: 5, resolution: '1280x720' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/video/generate');
  assert.deepEqual(calls[0].query, { ai_name: 'wan_video' });
  assert.deepEqual(calls[0].body, {
    chat_id: 'chat-1',
    prompt: 'a cat walking on the beach',
    settings: { duration: 5, resolution: '1280x720' },
  });
});

test('VideoResource.generate uses chat_id (NOT chat_uuid) per catalog #35', async () => {
  const { client, calls } = capturePost();
  await new VideoResource(client as unknown as BaseClient).generate('wan_video', {
    chat_id: 'chat-uuid-here',
    prompt: 'p',
    settings: {},
  });
  const body = calls[0].body as Record<string, unknown>;
  assert.ok('chat_id' in body, 'body must contain chat_id key');
  assert.equal(body.chat_id, 'chat-uuid-here');
  assert.equal(body.chat_uuid, undefined, 'body must NOT contain chat_uuid');
});

test('VideoResource.generate forwards optional file_urls + audio_url when provided', async () => {
  const { client, calls } = capturePost();
  await new VideoResource(client as unknown as BaseClient).generate('kling', {
    chat_id: 'chat-2',
    prompt: 'animate this',
    settings: { model_type: 'kling-1.5' },
    file_urls: ['https://r2.syntx.ai/uploaded/start.png'],
    audio_url: 'https://r2.syntx.ai/uploaded/track.mp3',
  });
  assert.deepEqual(calls[0].body, {
    chat_id: 'chat-2',
    prompt: 'animate this',
    settings: { model_type: 'kling-1.5' },
    file_urls: ['https://r2.syntx.ai/uploaded/start.png'],
    audio_url: 'https://r2.syntx.ai/uploaded/track.mp3',
  });
});

// ── generate-video MCP tool ────────────────────────────────────────────────

test('generate-video MCP tool is registered in videoTools + allTools', () => {
  const tool = videoTools.find((t) => t.name === 'generate-video');
  assert.ok(tool, 'generate-video must be exported from video.ts');
  assert.equal(tool.capability.networkCall, true);
  assert.equal(tool.capability.costSideEffect, true);
  assert.ok(allTools.some((t) => t.name === 'generate-video'));
});

test('generate-video requires chat_id and prompt only', () => {
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');
  assert.deepEqual(tool.inputSchema.required, ['chat_id', 'prompt']);
});

test('generate-video MCP tool input schema lists video-specific settings', () => {
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');
  const props = tool.inputSchema.properties as Record<string, unknown>;
  assert.ok('duration' in props);
  assert.ok('resolution' in props);
  assert.ok('aspect_ratio' in props);
  assert.ok('fps' in props);
  assert.ok('seed' in props);
  assert.ok('audio_url' in props);
  assert.ok('file_urls' in props);
});

test('generate-video forwards a clean payload to the SDK', async () => {
  const calls: Array<{ aiName: string; params: unknown }> = [];
  const ctx = {
    syntx: {
      video: {
        generate: async (aiName: string, params: unknown) => {
          calls.push({ aiName, params });
          return { id: 11, task_id: 'task-y' };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');

  const result = await tool.handler(
    {
      chat_id: 'chat-7',
      prompt: 'bird flying',
      model_type: 'wan_video',
      duration: 8,
      resolution: '1280x720',
      aspect_ratio: '16:9',
      fps: 24,
      quality: 'high',
      seed: 42,
      file_urls: ['https://r2.syntx.ai/uploaded/seed.png'],
      audio_url: 'https://r2.syntx.ai/uploaded/sound.mp3',
    },
    ctx,
  );

  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].aiName, 'wan_video'); // default
  const params = calls[0].params as {
    chat_id: string;
    prompt: string;
    settings: Record<string, unknown>;
    file_urls?: string[];
    audio_url?: string;
  };
  assert.equal(params.chat_id, 'chat-7');
  assert.equal(params.prompt, 'bird flying');
  assert.deepEqual(params.settings, {
    model_type: 'wan_video',
    duration: 8,
    resolution: '1280x720',
    aspect_ratio: '16:9',
    fps: 24,
    quality: 'high',
    seed: 42,
  });
  assert.deepEqual(params.file_urls, ['https://r2.syntx.ai/uploaded/seed.png']);
  assert.equal(params.audio_url, 'https://r2.syntx.ai/uploaded/sound.mp3');
});

test('generate-video omits file_urls and audio_url when not provided', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      video: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');

  await tool.handler(
    {
      chat_id: 'chat-1',
      prompt: 'hi',
    },
    ctx,
  );
  const params = calls[0].params as {
    chat_id: string;
    file_urls?: unknown;
    audio_url?: unknown;
    settings: Record<string, unknown>;
  };
  assert.equal(params.chat_id, 'chat-1');
  assert.equal(params.file_urls, undefined);
  assert.equal(params.audio_url, undefined);
  assert.deepEqual(params.settings, {});
});

test('generate-video drops empty-string audio_url before forwarding', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      video: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');

  await tool.handler({ chat_id: 'c', prompt: 'p', audio_url: '' }, ctx);
  const params = calls[0].params as { audio_url?: unknown };
  assert.equal(params.audio_url, undefined);
});

test('generate-video surfaces SDK errors via toMcpError', async () => {
  const ctx = {
    syntx: {
      video: {
        generate: async () => {
          throw new Error('provider down');
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');
  const result = await tool.handler({ chat_id: 'c', prompt: 'p' }, ctx);
  assert.equal(result.isError, true);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /^generate-video: /);
  assert.match(text, /provider down/);
});

// ── Central registry + SyntxClient wiring ─────────────────────────────────

test('SyntxClient exposes a video resource', () => {
  const ctx = createMcpContext({
    baseURL: 'http://localhost',
    timeout: 5000,
    pollTimeout: 5000,
    pollInterval: 100,
    defaultAI: 'chatgpt',
    defaultModel: undefined,
    streamMode: 'poll',
  } as Parameters<typeof createMcpContext>[0]);
  assert.equal(typeof ctx.syntx.video.generate, 'function');
});

// ── model_settings passthrough (provider-specific keys) ────────────────────

test('generate-video schema exposes model_settings as a free-form object', () => {
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');
  const props = tool.inputSchema.properties as Record<string, unknown>;
  assert.ok('model_settings' in props, 'model_settings must be in the schema');
  const ms = props.model_settings as { type: string; additionalProperties?: boolean };
  assert.equal(ms.type, 'object');
  assert.equal(ms.additionalProperties, true);
});

test('generate-video merges model_settings into body.settings', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      video: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');

  await tool.handler(
    {
      chat_id: 'chat-grok',
      prompt: 'a fox in the snow',
      ai_name: 'grok_video',
      model_type: 'grok_t2v',
      model_settings: { video_duration: 6, resolution: '720p' },
    },
    ctx,
  );

  const params = calls[0].params as { settings: Record<string, unknown> };
  assert.equal(params.settings.model_type, 'grok_t2v');
  assert.equal(params.settings.video_duration, 6);
  assert.equal(params.settings.resolution, '720p');
  assert.equal(params.settings.duration, undefined, 'duration must NOT be set when only model_settings was used');
});

test('generate-video model_settings values override top-level fields', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      video: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');

  await tool.handler(
    {
      chat_id: 'chat-kling',
      prompt: 'p',
      ai_name: 'kling',
      duration: 5,
      resolution: '1280x720',
      model_settings: { version: '1.6', mode: 'pro', native_audio: true },
    },
    ctx,
  );

  const params = calls[0].params as { settings: Record<string, unknown> };
  assert.equal(params.settings.duration, 5);
  assert.equal(params.settings.resolution, '1280x720');
  assert.equal(params.settings.version, '1.6');
  assert.equal(params.settings.mode, 'pro');
  assert.equal(params.settings.native_audio, true);
});

test('generate-video model_settings overrides collide with top-level keys', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      video: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');

  await tool.handler(
    {
      chat_id: 'chat-merge',
      prompt: 'p',
      duration: 10,
      model_settings: { duration: 6 },
    },
    ctx,
  );

  const params = calls[0].params as { settings: Record<string, unknown> };
  assert.equal(params.settings.duration, 6, 'model_settings must win the merge');
});

test('generate-video rejects non-object model_settings', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      video: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');

  const result = await tool.handler(
    {
      chat_id: 'c',
      prompt: 'p',
      model_settings: ['not', 'an', 'object'],
    },
    ctx,
  );
  assert.equal(result.isError, true);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /model_settings must be a JSON object/);
  assert.equal(calls.length, 0, 'SDK must NOT be called when model_settings is invalid');
});

test('generate-video allows model_settings to overwrite the field name (grok_t2v shape)', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      video: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = videoTools.find((t) => t.name === 'generate-video');
  if (!tool) throw new Error('generate-video tool not found');

  await tool.handler(
    {
      chat_id: 'chat-grok-shape',
      prompt: 'aerial shot of a coastal cliff at sunrise',
      ai_name: 'grok_video',
      model_type: 'grok_t2v',
      aspect_ratio: '16:9',
      model_settings: { video_duration: '10', resolution: '720p' },
    },
    ctx,
  );

  const params = calls[0].params as { settings: Record<string, unknown> };
  assert.equal(params.settings.model_type, 'grok_t2v');
  assert.equal(params.settings.aspect_ratio, '16:9');
  assert.equal(params.settings.video_duration, '10', 'video_duration must be passed as-is from model_settings (grok_video requires string literals 6|10)');
  assert.equal(params.settings.resolution, '720p');
});

// ── provider-rules normalization (Phase B wiring through VideoResource) ───

test('VideoResource.generate applies grok_video rule: drops aspect_ratio for grok_i2v', async () => {
  const { client, calls } = capturePost();
  await new VideoResource(client as unknown as BaseClient).generate('grok_video', {
    chat_id: 'c',
    prompt: 'p',
    settings: {
      model_type: 'grok_i2v',
      aspect_ratio: '16:9',
      video_duration: 6,
      resolution: '720p',
    },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.aspect_ratio, undefined, 'aspect_ratio must be stripped for grok_i2v');
  assert.equal(body.settings.video_duration, 6);
  assert.equal(body.settings.resolution, '720p');
});

test('VideoResource.generate applies kling rule: drops mode for kling_o1_* models', async () => {
  const { client, calls } = capturePost();
  await new VideoResource(client as unknown as BaseClient).generate('kling', {
    chat_id: 'c',
    prompt: 'p',
    settings: { model_type: 'kling_o1_text2video', mode: 'pro', video_duration: 5 },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.mode, undefined, 'mode must be stripped for kling_o1_*');
  assert.equal(body.settings.video_duration, 5);
});

test('VideoResource.generate applies runway rule: drops video_duration for acttwo', async () => {
  const { client, calls } = capturePost();
  await new VideoResource(client as unknown as BaseClient).generate('runway', {
    chat_id: 'c',
    prompt: 'p',
    settings: { model_type: 'acttwo', video_duration: 5, aspect_ratio: '16:9' },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.video_duration, undefined);
  assert.equal(body.settings.aspect_ratio, '16:9');
});

test('VideoResource.generate does not mutate the caller-supplied settings object', async () => {
  const { client } = capturePost();
  const settings = { model_type: 'grok_i2v', aspect_ratio: '16:9' };
  await new VideoResource(client as unknown as BaseClient).generate('grok_video', {
    chat_id: 'c',
    prompt: 'p',
    settings,
  });
  assert.equal(settings.aspect_ratio, '16:9', 'caller object must not be mutated');
});