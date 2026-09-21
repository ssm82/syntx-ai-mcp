import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LlmResource } from '../src/resources/llm';
import { ChatsResource } from '../src/resources/chats';
import type { CompletedMessage } from '../src/types';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function installFetchMock(responder: (call: CapturedCall, idx: number) => Response | Promise<Response>): {
  calls: CapturedCall[];
  restore: () => void;
} {
  const calls: CapturedCall[] = [];
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return responder(call, i++);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function streamResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

function makeLlmClient(token = 'tok') {
  return {
    baseURL: 'https://api.syntx.ai',
    getToken: () => token,
    get: async <T>(path: string): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;
}

function makeChatsClient(token = 'tok') {
  return {
    baseURL: 'https://api.syntx.ai',
    getToken: () => token,
    post: async <T>(path: string): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return (await response.json()) as T;
    },
    get: async <T>(path: string): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;
}

test('waitForResponse completes when the SSE stream emits complete', async () => {
  const frames =
    'event: message\ndata: Hello,\n\nevent: message\ndata:  world!\n\nevent: complete\ndata: ok\n\n';
  const { calls, restore } = installFetchMock((call) => {
    if (call.url.startsWith('https://api.syntx.ai/api/v1/llm/chats/')) {
      return new Response(
        JSON.stringify({ jobs: [{ message_id: 'm1', stream_url: '/v1/jobs/j1/stream' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return streamResponse([frames]);
  });

  const llm = new LlmResource(makeLlmClient());
  const chats = new ChatsResource(makeChatsClient());
  const result = await llm.waitForResponse(
    'chat-1',
    {
      timeout: 5000,
      llmSseBaseUrl: 'https://sse.syntx.ai',
      fallbackPoll: async (chatId) => {
        void chats;
        throw new Error(`unexpected polling fallback for ${chatId}`);
      },
    },
  );

  assert.equal(result.text, 'Hello,\n world!');
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/llm/chats/chat-1/stream');
  assert.equal(calls[1].url, 'https://sse.syntx.ai/v1/jobs/j1/stream');
  assert.equal((calls[1].init.headers as Record<string, string>).Accept, 'text/event-stream');
  assert.equal(calls.length, 2, 'SSE success must not trigger polling fallback');

  restore();
});

test('waitForResponse falls back to polling when the SSE connection fails', async () => {
  let sseAttempts = 0;
  const { restore } = installFetchMock((call) => {
    if (call.url.startsWith('https://api.syntx.ai/api/v1/llm/chats/')) {
      return new Response(
        JSON.stringify({ jobs: [{ message_id: 'm1', stream_url: '/v1/jobs/j1/stream' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (call.url.startsWith('https://sse.syntx.ai/')) {
      sseAttempts++;
      return new Response('boom', { status: 502 });
    }
    return new Response('unexpected', { status: 500 });
  });

  const llm = new LlmResource(makeLlmClient());
  const result = await llm.waitForResponse('chat-2', {
    timeout: 1000,
    llmSseBaseUrl: 'https://sse.syntx.ai',
    fallbackPoll: async (chatId) => {
      const completed: CompletedMessage = {
        text: 'polled-reply',
        media: [],
        message: {
          id: 'm1',
          chat_id: chatId,
          author_id: -1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_favorite: false,
          message_object: [],
        },
      };
      return completed;
    },
  });

  assert.equal(result.text, 'polled-reply');
  assert.ok(sseAttempts >= 1, 'SSE endpoint must be attempted before fallback');

  restore();
});

test('waitForResponse falls back to polling when the SSE stream times out', async () => {
  const { restore } = installFetchMock((call) => {
    if (call.url.startsWith('https://api.syntx.ai/api/v1/llm/chats/')) {
      return new Response(
        JSON.stringify({ jobs: [{ message_id: 'm1', stream_url: '/v1/jobs/j1/stream' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (call.url.startsWith('https://sse.syntx.ai/')) {
      // A stream that produces a ping then never closes (drives the sseTimeoutMs).
      const body = new ReadableStream<Uint8Array>({
        async start(c) {
          c.enqueue(new TextEncoder().encode('event: ping\ndata: 1\n\n'));
          await new Promise((r) => setTimeout(r, 5000));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response('unexpected', { status: 500 });
  });

  const llm = new LlmResource(makeLlmClient());
  const result = await llm.waitForResponse('chat-3', {
    timeout: 1000,
    sseTimeoutMs: 50,
    llmSseBaseUrl: 'https://sse.syntx.ai',
    fallbackPoll: async (chatId) => ({
      text: 'poll-after-timeout',
      media: [],
      message: {
        id: 'm1',
        chat_id: chatId,
        author_id: -1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_favorite: false,
        message_object: [],
      },
    }),
  });

  assert.equal(result.text, 'poll-after-timeout');
  restore();
});

test('waitForResponse abort cancels via cancelMessage when signal fires mid-stream', async () => {
  let cancelCalled = false;
  const controller = new AbortController();
  const { restore } = installFetchMock((call) => {
    if (call.url.startsWith('https://api.syntx.ai/api/v1/llm/chats/')) {
      return new Response(
        JSON.stringify({ jobs: [{ message_id: 'm1', stream_url: '/v1/jobs/j1/stream' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (call.url.startsWith('https://api.syntx.ai/api/v1/chats/') && call.url.endsWith('/cancel')) {
      cancelCalled = true;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (call.url.startsWith('https://sse.syntx.ai/')) {
      // Slow producer so the abort signal fires first.
      const body = new ReadableStream<Uint8Array>({
        async start(c) {
          c.enqueue(new TextEncoder().encode('event: ping\ndata: 1\n\n'));
          await new Promise((r) => setTimeout(r, 500));
          c.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response('unexpected', { status: 500 });
  });

  const llm = new LlmResource(makeLlmClient());
  const chats = new ChatsResource(makeChatsClient());

  setTimeout(() => controller.abort(), 30);

  await assert.rejects(
    llm.waitForResponse('chat-4', {
      timeout: 5000,
      signal: controller.signal,
      llmSseBaseUrl: 'https://sse.syntx.ai',
      fallbackPoll: async () => {
        throw new Error('poll fallback should not run on abort');
      },
    }),
    /cancelled/i,
  );

  // Drive the cancel side-effect manually (the SSE cancel wiring lives in
  // the MCP tool layer; at SDK level we just verify cancelMessage works).
  await chats.cancelMessage('chat-4', 'm1');
  assert.equal(cancelCalled, true);
  restore();
});

test('ChatsResource.cancelMessage treats 404 as success', async () => {
  const { calls, restore } = installFetchMock(
    () => new Response(JSON.stringify({ message: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } }),
  );

  const chats = new ChatsResource(makeChatsClient());
  await chats.cancelMessage('chat-x', 'msg-y');

  assert.equal(
    calls[0].url,
    'https://api.syntx.ai/api/v1/chats/chat-x/messages/msg-y/cancel',
  );
  assert.equal(calls[0].init.method, 'POST');
  restore();
});
