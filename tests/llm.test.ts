import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LlmResource } from '../src/resources/llm';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function installFetchMock(responses: Array<{ status?: number; body?: unknown }>): {
  calls: CapturedCall[];
  restore: () => void;
} {
  const calls: CapturedCall[] = [];
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = responses[i++] ?? { status: 200, body: {} };
    const status = next.status ?? 200;
    return new Response(
      next.body === undefined
        ? ''
        : typeof next.body === 'string'
          ? next.body
          : JSON.stringify(next.body),
      { status, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function readText(call: CapturedCall): string {
  return typeof call.init.body === 'string' ? call.init.body : JSON.stringify(call.init.body);
}

function makeClient(token: string | undefined = 'tok') {
  return {
    baseURL: 'https://api.syntx.ai',
    getToken: () => token,
    post: async <T>(path: string, body: unknown, params?: Record<string, unknown>): Promise<T> => {
      const url = new URL(`https://api.syntx.ai${path}`);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined) url.searchParams.set(k, String(v));
        }
      }
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return (await response.json()) as T;
    },
    get: async <T>(path: string, params?: Record<string, unknown>): Promise<T> => {
      const url = new URL(`https://api.syntx.ai${path}`);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined) url.searchParams.set(k, String(v));
        }
      }
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;
}

test('LlmResource.generate posts {text, model} + ai_name query and returns job metadata', async () => {
  const { calls, restore } = installFetchMock([
    {
      status: 200,
      body: { job_id: 'j1', stream_url: '/v1/jobs/j1/stream', message_id: 'm1' },
    },
  ]);

  const result = await new LlmResource(makeClient()).generate({
    prompt: 'hello',
    aiName: 'chatgpt',
    modelType: 'gpt-5',
  });

  assert.equal(result.job_id, 'j1');
  assert.equal(result.message_id, 'm1');
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/llm/generate?ai_name=chatgpt');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(readText(calls[0])), {
    text: 'hello',
    model: 'gpt-5',
  });
  restore();
});

test('LlmResource.generate falls back to default model when modelType is omitted', async () => {
  const { calls, restore } = installFetchMock([
    { status: 200, body: { job_id: 'j', stream_url: '/s', message_id: 'm' } },
  ]);

  await new LlmResource(makeClient()).generate({
    prompt: 'look',
    aiName: 'claude',
  });

  const body = JSON.parse(readText(calls[0]));
  assert.equal(body.text, 'look');
  assert.equal(body.model, 'gpt-5.6-luna');
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/llm/generate?ai_name=claude');
  restore();
});

test('LlmResource.generate binds the message to a chat via chat_uuid', async () => {
  const { calls, restore } = installFetchMock([
    { status: 200, body: { job_id: 'j', stream_url: '/s', message_id: 'm' } },
  ]);

  await new LlmResource(makeClient()).generate({
    prompt: 'ping',
    aiName: 'gemini',
    modelType: 'gemini-3.8-flash',
    chatUuid: '7d6d3bd2-b17e-4785-bb23-e12bad7b939d',
  });

  const body = JSON.parse(readText(calls[0]));
  assert.equal(body.chat_uuid, '7d6d3bd2-b17e-4785-bb23-e12bad7b939d');
  assert.equal(body.text, 'ping');
  assert.equal(body.model, 'gemini-3.8-flash');
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/llm/generate?ai_name=gemini');
  restore();
});

test('LlmResource.generate forwards thinking / plan / deep_research / tools when set', async () => {
  const { calls, restore } = installFetchMock([
    { status: 200, body: { job_id: 'j', stream_url: '/s', message_id: 'm' } },
  ]);

  await new LlmResource(makeClient()).generate({
    prompt: 'go',
    aiName: 'gemini',
    modelType: 'gemini-3.8-flash',
    thinking: false,
    plan: false,
    deepResearch: false,
    tools: ['search', 'code', 'shell', 'files', 'charts'],
  });

  const body = JSON.parse(readText(calls[0]));
  assert.equal(body.thinking, false);
  assert.equal(body.plan, false);
  assert.equal(body.deep_research, false);
  assert.deepEqual(body.tools, ['search', 'code', 'shell', 'files', 'charts']);
  restore();
});

test('LlmResource.listModels unwraps the { models } envelope', async () => {
  const { calls, restore } = installFetchMock([
    {
      status: 200,
      body: {
        models: [
          { value: 'gpt-5', label: 'GPT-5', ai_name: 'chatgpt', scope: 'text', active: true },
        ],
      },
    },
  ]);

  const models = await new LlmResource(makeClient()).listModels({ enabled_only: true, lang: 'en' });

  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/llm/models?enabled_only=true&lang=en');
  assert.equal(models.length, 1);
  assert.equal(models[0].value, 'gpt-5');
  restore();
});

test('LlmResource.getChatStream returns the jobs array', async () => {
  const { calls, restore } = installFetchMock([
    {
      status: 200,
      body: {
        jobs: [
          { message_id: 'm1', stream_url: '/v1/jobs/m1/stream' },
        ],
      },
    },
  ]);

  const res = await new LlmResource(makeClient()).getChatStream('chat-xyz');
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/llm/chats/chat-xyz/stream');
  assert.deepEqual(res, {
    jobs: [{ message_id: 'm1', stream_url: '/v1/jobs/m1/stream' }],
  });
  restore();
});
