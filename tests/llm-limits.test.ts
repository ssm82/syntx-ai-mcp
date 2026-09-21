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

function makeClient(token: string | undefined = 'tok') {
  return {
    baseURL: 'https://api.syntx.ai',
    getToken: () => token,
    get: async <T>(path: string): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;
}

test('LlmResource.getLimits hits /api/v1/llm/limits with bearer token', async () => {
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const futureLater = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const future7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const past7dStart = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

  const { calls, restore } = installFetchMock([
    {
      status: 200,
      body: {
        window_6h: { percent_left: 80, started_at: future, expires_at: futureLater },
        window_7d: { percent_left: 95, started_at: past7dStart, expires_at: future7d },
      },
    },
  ]);

  const result = await new LlmResource(makeClient()).getLimits();

  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/llm/limits');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(
    (calls[0].init.headers as Record<string, string>).Authorization,
    'Bearer tok',
  );
  assert.deepEqual(result, {
    window_6h: { percent_left: 80, started_at: future, expires_at: futureLater },
    window_7d: { percent_left: 95, started_at: past7dStart, expires_at: future7d },
  });

  restore();
});

test('LlmResource.getLimits normalises a window with null expires_at to a fresh window', async () => {
  const { restore } = installFetchMock([
    {
      status: 200,
      body: {
        window_6h: { percent_left: 0, started_at: '2026-09-21T00:00:00Z', expires_at: null },
        window_7d: null,
      },
    },
  ]);

  const result = await new LlmResource(makeClient()).getLimits();
  assert.deepEqual(result.window_6h, { percent_left: 100, started_at: null, expires_at: null });
  assert.equal(result.window_7d, null);

  restore();
});

test('LlmResource.getLimits normalises a window with an expired expires_at', async () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const past7dStart = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const { restore } = installFetchMock([
    {
      status: 200,
      body: {
        window_6h: { percent_left: 12, started_at: '2020-01-01T00:00:00Z', expires_at: '2020-01-01T06:00:00Z' },
        window_7d: { percent_left: 30, started_at: past7dStart, expires_at: future },
      },
    },
  ]);

  const result = await new LlmResource(makeClient()).getLimits();
  assert.deepEqual(result.window_6h, { percent_left: 100, started_at: null, expires_at: null });
  assert.deepEqual(result.window_7d, { percent_left: 30, started_at: past7dStart, expires_at: future });

  restore();
});

test('LlmResource.getLimits preserves a null window from the server', async () => {
  const { restore } = installFetchMock([
    {
      status: 200,
      body: { window_6h: null, window_7d: null },
    },
  ]);

  const result = await new LlmResource(makeClient()).getLimits();
  assert.equal(result.window_6h, null);
  assert.equal(result.window_7d, null);

  restore();
});
