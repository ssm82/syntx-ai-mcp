import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BaseClient } from '../src/client';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function installFetchMock(responder: (call: CapturedCall) => Response | Promise<Response>): {
  calls: CapturedCall[];
  restore: () => void;
} {
  const calls: CapturedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('BaseClient.stream builds the full URL from baseURL + path', async () => {
  const { calls, restore } = installFetchMock(() =>
    new Response('data: hello', { status: 200 }),
  );

  const client = new BaseClient({ token: 'tok' });
  await client.stream('/api/v1/llm/chats/abc/stream');

  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/llm/chats/abc/stream');
  restore();
});

test('BaseClient.stream sends Authorization + Accept, allows caller override', async () => {
  const { calls, restore } = installFetchMock(() =>
    new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }),
  );

  const client = new BaseClient({ token: 'tok' });
  await client.stream('/api/v1/llm/chats/abc/stream', {
    headers: { Accept: 'text/event-stream', 'X-Trace': 'yes' },
  });

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer tok');
  assert.equal(headers.Accept, 'text/event-stream');
  assert.equal(headers['X-Trace'], 'yes');
  restore();
});

test('BaseClient.stream does NOT consume the response body', async () => {
  const { calls, restore } = installFetchMock(() =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('event: ping\ndata: 1\n\n'));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ),
  );

  const client = new BaseClient({ token: 'tok' });
  const response = await client.stream('/api/v1/llm/chats/abc/stream');

  // The body MUST still be readable for the SSE consumer.
  assert.ok(response.body);
  const reader = response.body!.getReader();
  const { value, done } = await reader.read();
  assert.equal(done, false);
  assert.ok(value && value.length > 0);

  assert.equal(calls.length, 1, 'stream must not retry on the underlying fetch');
  restore();
});

test('BaseClient.stream honours an external AbortSignal', async () => {
  const controller = new AbortController();
  const { restore } = installFetchMock((call) => {
    return new Promise<Response>((_resolve, reject) => {
      call.init.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  });

  const client = new BaseClient({ token: 'tok' });
  const promise = client.stream('/api/v1/llm/chats/abc/stream', {
    signal: controller.signal,
    timeoutMs: 10000,
  });
  controller.abort();
  await assert.rejects(promise, /timeout/i);

  restore();
});
