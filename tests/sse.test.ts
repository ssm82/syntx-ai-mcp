import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openSse, dispatchFrames, parseFrame } from '../src/transport/sse';
import { BaseClient } from '../src/client';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function installFetchMock(
  responder: (call: CapturedCall) => Promise<Response> | Response,
): { calls: CapturedCall[]; restore: () => void } {
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

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test('parseFrame joins multi-line data with \\n and honours event: line', () => {
  const parsed = parseFrame('event: message\ndata: line1\ndata: line2\n');
  assert.deepEqual(parsed, { event: 'message', data: 'line1\nline2' });
});

test('parseFrame skips comment lines and defaults event to "message"', () => {
  const parsed = parseFrame(': keepalive\ndata: hello\n');
  assert.deepEqual(parsed, { event: 'message', data: 'hello' });
});

test('dispatchFrames emits complete frames and retains the incomplete tail', () => {
  const events: Array<{ event: string; data: string }> = [];
  const ret = dispatchFrames('event: a\ndata: 1\n\nevent: b\ndata: 2\n\nrest', (e) =>
    events.push(e),
  );
  assert.equal(ret, 'rest');
  assert.deepEqual(events, [
    { event: 'a', data: '1' },
    { event: 'b', data: '2' },
  ]);
});

test('openSse dispatches message events and ignores ping frames', async () => {
  const frames =
    'event: ping\ndata: hb\n\nevent: message\ndata: hello\n\nevent: ping\ndata: hb2\n\nevent: complete\ndata: ok\n\n';
  const { calls, restore } = installFetchMock(() =>
    new Response(streamFromChunks([new TextEncoder().encode(frames)]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
  );

  const events: Array<{ event: string; data: string }> = [];
  const handle = openSse({
    url: 'https://sse.example/stream',
    headers: { Accept: 'text/event-stream' },
    onEvent: (e) => events.push(e),
  });

  await handle.done;
  restore();

  assert.equal(calls[0].url, 'https://sse.example/stream');
  assert.equal((calls[0].init.headers as Record<string, string>).Accept, 'text/event-stream');
  assert.deepEqual(events, [
    { event: 'message', data: 'hello' },
    { event: 'complete', data: 'ok' },
  ]);
  assert.equal(handle.closed, true);
});

test('openSse parses frames split across chunks', async () => {
  const all = 'event: message\ndata: abc\n\nevent: message\ndata: def\n\n';
  const split = new TextEncoder().encode(all);
  const { restore } = installFetchMock(() =>
    new Response(streamFromChunks([split.slice(0, 10), split.slice(10)]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
  );

  const events: Array<{ event: string; data: string }> = [];
  const handle = openSse({ url: 'https://sse.example/s', onEvent: (e) => events.push(e) });
  await handle.done;
  restore();
  assert.deepEqual(events, [
    { event: 'message', data: 'abc' },
    { event: 'message', data: 'def' },
  ]);
});

test('openSse close() aborts the in-flight fetch', async () => {
  let abortObserved = false;
  const { restore } = installFetchMock((call) => {
    call.init.signal?.addEventListener('abort', () => {
      abortObserved = true;
    });
    return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      status: 200,
    });
  });

  const handle = openSse({ url: 'https://sse.example/s', onEvent: () => {} });
  handle.close();
  await handle.done;
  restore();
  assert.equal(abortObserved, true);
  assert.equal(handle.closed, true);
});

test('openSse rejects when the upstream HTTP request fails', async () => {
  const { restore } = installFetchMock(() =>
    new Response('boom', { status: 500 }),
  );

  const handle = openSse({ url: 'https://sse.example/s', onEvent: () => {} });
  await assert.rejects(handle.done, /SSE connection failed: 500/);
  restore();
  assert.equal(handle.closed, true);
});

test('BaseClient.stream returns the raw Response without consuming body', async () => {
  const { calls, restore } = installFetchMock(() =>
    new Response(streamFromChunks([new TextEncoder().encode('event: ping\ndata: x\n\n')]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
  );

  const client = new BaseClient({ token: 'tok' });
  const response = await client.stream('/api/v1/llm/chats/abc/stream', {
    headers: { Accept: 'text/event-stream' },
  });

  assert.equal(response.status, 200);
  assert.ok(response.body, 'stream() must not consume the response body');
  // Body must remain readable.
  const reader = response.body!.getReader();
  const { value } = await reader.read();
  assert.ok(value);

  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/llm/chats/abc/stream');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer tok');
  assert.equal(headers.Accept, 'text/event-stream');

  restore();
});
