import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioResource } from '../src/resources/audio';
import type { BaseClient } from '../src/client';
import { audioTools } from '../src/mcp/tools/audio';
import { allTools } from '../src/mcp/tools';
import type { McpContext } from '../src/mcp/registry';

// ── AudioResource.generate (SDK) ───────────────────────────────────────────

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

test('AudioResource.generate posts to /api/v1/audio/generate with ai_name query param', async () => {
  const { client, calls } = capturePost();
  await new AudioResource(client as unknown as BaseClient).generate('elevenlabs', {
    chat_uuid: 'chat-1',
    prompt: 'say hello in a calm voice',
    settings: { voice_id: 'v-1', model_type: 'eleven_multilingual_v2' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/audio/generate');
  assert.deepEqual(calls[0].query, { ai_name: 'elevenlabs' });
  assert.deepEqual(calls[0].body, {
    chat_uuid: 'chat-1',
    prompt: 'say hello in a calm voice',
    settings: { voice_id: 'v-1', model_type: 'eleven_multilingual_v2' },
  });
});

test('AudioResource.generate forwards file_urls when provided (matches SPA body shape)', async () => {
  const { client, calls } = capturePost();
  await new AudioResource(client as unknown as BaseClient).generate('suno-music', {
    chat_uuid: 'chat-2',
    prompt: 'moody piano',
    settings: { duration: 30 },
    file_urls: ['https://r2.syntx.ai/uploaded/source.mp3'],
  });
  assert.equal(calls[0].path, '/api/v1/audio/generate');
  assert.deepEqual(calls[0].body, {
    chat_uuid: 'chat-2',
    prompt: 'moody piano',
    settings: { duration: 30 },
    file_urls: ['https://r2.syntx.ai/uploaded/source.mp3'],
  });
});

// ── generate-audio MCP tool ────────────────────────────────────────────────

test('generate-audio MCP tool is registered in audioTools + allTools', () => {
  const tool = audioTools.find((t) => t.name === 'generate-audio');
  assert.ok(tool, 'generate-audio must be exported from audio.ts');
  assert.equal(tool.capability.networkCall, true);
  assert.equal(tool.capability.costSideEffect, true);
  assert.deepEqual(allTools.map((t) => t.name), [
    ...allTools.map((t) => t.name),
  ].filter((n, i, arr) => arr.indexOf(n) === i));
  assert.ok(allTools.some((t) => t.name === 'generate-audio'));
});

test('generate-audio requires chat_uuid and prompt only', () => {
  const tool = audioTools.find((t) => t.name === 'generate-audio');
  if (!tool) throw new Error('generate-audio tool not found');
  assert.deepEqual(tool.inputSchema.required, ['chat_uuid', 'prompt']);
});

test('generate-audio forwards a clean settings + file_urls payload', async () => {
  const calls: Array<{ aiName: string; params: unknown }> = [];
  const ctx = {
    syntx: {
      audio: {
        generate: async (aiName: string, params: unknown) => {
          calls.push({ aiName, params });
          return { id: 7, task_id: 'task-x' };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = audioTools.find((t) => t.name === 'generate-audio');
  if (!tool) throw new Error('generate-audio tool not found');

  const result = await tool.handler(
    {
      chat_uuid: 'chat-7',
      prompt: 'narrate this poem',
      voice_id: 'v-1',
      model_type: 'eleven_multilingual_v2',
      duration: 12,
      sample_rate: 44100,
      style_prompt: 'warm, intimate',
      file_urls: ['https://r2.syntx.ai/uploaded/x.mp3'],
    },
    ctx,
  );

  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].aiName, 'elevenlabs'); // default when omitted
  assert.deepEqual(calls[0].params, {
    chat_uuid: 'chat-7',
    prompt: 'narrate this poem',
    settings: {
      voice_id: 'v-1',
      model_type: 'eleven_multilingual_v2',
      duration: 12,
      sample_rate: 44100,
      prompt: 'warm, intimate', // style_prompt → settings.prompt
    },
    file_urls: ['https://r2.syntx.ai/uploaded/x.mp3'],
  });
});

test('generate-audio omits file_urls when not provided', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      audio: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = audioTools.find((t) => t.name === 'generate-audio');
  if (!tool) throw new Error('generate-audio tool not found');

  await tool.handler(
    {
      chat_uuid: 'chat-1',
      prompt: 'hi',
    },
    ctx,
  );
  assert.equal((calls[0].params as { file_urls?: unknown }).file_urls, undefined);
  assert.deepEqual((calls[0].params as { settings: Record<string, unknown> }).settings, {});
});

test('generate-audio surfaces SDK errors via toMcpError', async () => {
  const ctx = {
    syntx: {
      audio: {
        generate: async () => {
          throw new Error('upstream down');
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = audioTools.find((t) => t.name === 'generate-audio');
  if (!tool) throw new Error('generate-audio tool not found');
  const result = await tool.handler({ chat_uuid: 'c', prompt: 'p' }, ctx);
  assert.equal(result.isError, true);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /^generate-audio: /);
  assert.match(text, /upstream down/);
});

// ── model_settings passthrough + provider-rules (Phase B/C) ────────────────

import { AudioResource } from '../src/resources/audio';

test('AudioResource.generate merges model_settings into body.settings (last-wins)', async () => {
  const { client, calls } = capturePost();
  await new AudioResource(client as unknown as BaseClient).generate('elevenlabs', {
    chat_uuid: 'c',
    prompt: 'p',
    settings: { voice_id: 'v-1', model_type: 'eleven_multilingual_v2' },
    model_settings: { voice_id: 'v-2' },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.voice_id, 'v-2', 'model_settings must win the merge');
});

test('AudioResource.generate applies suno rule: strips source keys in generate mode', async () => {
  const { client, calls } = capturePost();
  await new AudioResource(client as unknown as BaseClient).generate('suno', {
    chat_uuid: 'c',
    prompt: 'p',
    settings: {},
    model_settings: {
      mode: 'generate',
      audio_url: 'https://example.com/x.mp3',
      continue_at: 12,
      source_clip_id: 'abc',
      source_task_id: 'xyz',
      title: 'hi',
    },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.audio_url, undefined);
  assert.equal(body.settings.continue_at, undefined);
  assert.equal(body.settings.source_clip_id, undefined);
  assert.equal(body.settings.source_task_id, undefined);
  assert.equal(body.settings.title, 'hi');
  assert.equal(body.settings.mode, 'generate');
});

test('AudioResource.generate does not strip source keys in suno extend mode', async () => {
  const { client, calls } = capturePost();
  await new AudioResource(client as unknown as BaseClient).generate('suno', {
    chat_uuid: 'c',
    prompt: 'p',
    settings: {},
    model_settings: {
      mode: 'extend',
      audio_url: 'https://example.com/x.mp3',
      continue_at: 12,
    },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.audio_url, 'https://example.com/x.mp3');
  assert.equal(body.settings.continue_at, 12);
});

test('AudioResource.generate does not mutate the caller-supplied settings object', async () => {
  const { client } = capturePost();
  const settings: Record<string, unknown> = {};
  const model_settings = { mode: 'generate', audio_url: 'https://example.com/x.mp3' };
  await new AudioResource(client as unknown as BaseClient).generate('suno', {
    chat_uuid: 'c',
    prompt: 'p',
    settings,
    model_settings,
  });
  assert.equal(model_settings.audio_url, 'https://example.com/x.mp3', 'caller model_settings must not be mutated');
});

test('generate-audio input schema lists model_settings as a free-form object', () => {
  const tool = audioTools.find((t) => t.name === 'generate-audio');
  if (!tool) throw new Error('generate-audio tool not found');
  const props = tool.inputSchema.properties as Record<string, unknown>;
  const ms = props.model_settings as { type: string; additionalProperties?: boolean };
  assert.equal(ms.type, 'object');
  assert.equal(ms.additionalProperties, true);
});

test('generate-audio forwards model_settings to the SDK', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      audio: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = audioTools.find((t) => t.name === 'generate-audio');
  if (!tool) throw new Error('generate-audio tool not found');

  await tool.handler(
    {
      chat_uuid: 'c',
      prompt: 'p',
      ai_name: 'suno',
      model_settings: { mode: 'generate', title: 'hi', is_instrumental: true },
    },
    ctx,
  );
  const params = calls[0].params as { model_settings?: Record<string, unknown> };
  assert.deepEqual(params.model_settings, { mode: 'generate', title: 'hi', is_instrumental: true });
});

test('generate-audio rejects non-object model_settings', async () => {
  const calls: Array<{ params: unknown }> = [];
  const ctx = {
    syntx: {
      audio: {
        generate: async (_aiName: string, params: unknown) => {
          calls.push({ params });
          return { id: 1 };
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = audioTools.find((t) => t.name === 'generate-audio');
  if (!tool) throw new Error('generate-audio tool not found');

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

test('generate-audio end-to-end: suno generate mode strips source keys through the SDK', async () => {
  const { client, calls } = capturePost();
  const audio = new AudioResource(client as unknown as BaseClient);
  await audio.generate('suno', {
    chat_uuid: 'c',
    prompt: 'p',
    settings: {},
    model_settings: {
      mode: 'generate',
      audio_url: 'https://example.com/x.mp3',
      continue_at: 12,
      source_clip_id: 'abc',
      source_task_id: 'xyz',
      title: 'hi',
    },
  });
  const body = calls[0].body as { settings: Record<string, unknown> };
  assert.equal(body.settings.audio_url, undefined);
  assert.equal(body.settings.continue_at, undefined);
  assert.equal(body.settings.source_clip_id, undefined);
  assert.equal(body.settings.source_task_id, undefined);
  assert.equal(body.settings.title, 'hi');
});