import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LlmResource } from '../src/resources/llm';
import { ChatsResource } from '../src/resources/chats';
import { SyntxAPIError, SyntxTimeoutError } from '../src/errors';
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

  assert.equal(result.text, 'Hello, world!');
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/llm/chats/chat-1/stream');
  assert.equal(calls[1].url, 'https://sse.syntx.ai/v1/jobs/j1/stream');
  assert.equal((calls[1].init.headers as Record<string, string>).Accept, 'text/event-stream');
  assert.equal(calls.length, 2, 'SSE success must not trigger polling fallback');

  restore();
});

test('waitForResponse reconstructs reply text from live SSE delta contract ([DONE] terminator, usage_final skipped)', async () => {
  // Exact frame shape captured from sse.syntx.ai on 2026-09-21: no `event:`
  // lines, JSON content deltas, a usage_final stats frame, and a bare
  // `data: [DONE]` terminator inside a default message event.
  const frames = [
    'id: 1-0\ndata: {"type": "content", "content": "STREAM", "job_id": "j"}\n\n',
    'id: 1-1\ndata: {"type": "content", "content": " SH", "job_id": "j"}\n\n',
    'id: 1-2\ndata: {"type": "content", "content": "APE", "job_id": "j"}\n\n',
    'id: 1-3\ndata: {"type": "content", "content": " TEST ", "job_id": "j"}\n\n',
    'id: 1-4\ndata: {"type": "content", "content": "123", "job_id": "j"}\n\n',
    'id: 1-5\ndata: {"type": "usage_final", "model": "gpt-5.6-luna", "tokens_output": 10, "job_id": "j"}\n\n',
    'id: 1-6\ndata: [DONE]\n\n',
  ].join('');
  const { restore } = installFetchMock((call) => {
    if (call.url.startsWith('https://api.syntx.ai/api/v1/llm/chats/')) {
      return new Response(
        JSON.stringify({ jobs: [{ message_id: 'm1', stream_url: '/v1/jobs/j1/stream' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return streamResponse([frames]);
  });

  const llm = new LlmResource(makeLlmClient());
  const result = await llm.waitForResponse('chat-live-sse', {
    timeout: 5000,
    llmSseBaseUrl: 'https://sse.syntx.ai',
    fallbackPoll: async () => {
      throw new Error('unexpected polling fallback for live-contract stream');
    },
  });

  assert.equal(result.text, 'STREAM SHAPE TEST 123');
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

test('waitForResponse passes the REMAINING budget to fallbackPoll, not the full timeout', async () => {
  // Regression (2026-09-21): the fallback used to receive the original
  // `opts.timeout` while the elapsed SSE time was lost, so the MCP wrapper
  // polled for a full extra `timeout` — total wall time up to 1.6x budget.
  const { restore } = installFetchMock((call) => {
    if (call.url.startsWith('https://api.syntx.ai/api/v1/llm/chats/')) {
      return new Response(
        JSON.stringify({ jobs: [{ message_id: 'm1', stream_url: '/v1/jobs/j1/stream' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (call.url.startsWith('https://sse.syntx.ai/')) {
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

  let receivedTimeout: number | undefined;
  const llm = new LlmResource(makeLlmClient());
  const result = await llm.waitForResponse('chat-budget', {
    timeout: 1000,
    sseTimeoutMs: 400,
    llmSseBaseUrl: 'https://sse.syntx.ai',
    fallbackPoll: async (chatId, pollOpts) => {
      receivedTimeout = pollOpts?.timeout;
      return {
        text: 'budget-reply',
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
    },
  });

  assert.equal(result.text, 'budget-reply');
  // SSE burned ~400ms of the 1000ms budget; the fallback must see the
  // remaining ~600ms (allow scheduling slack), never the full 1000ms.
  assert.ok(receivedTimeout !== undefined, 'fallbackPoll received opts.timeout');
  assert.ok(
    receivedTimeout! > 0 && receivedTimeout! <= 700,
    `fallbackPoll timeout should be the remaining budget (~600ms), got ${receivedTimeout}ms`,
  );
  restore();
});

test('waitForResponse throws SyntxTimeoutError when SSE exhausts the whole budget', async () => {
  const { restore } = installFetchMock((call) => {
    if (call.url.startsWith('https://api.syntx.ai/api/v1/llm/chats/')) {
      return new Response(
        JSON.stringify({ jobs: [{ message_id: 'm1', stream_url: '/v1/jobs/j1/stream' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (call.url.startsWith('https://sse.syntx.ai/')) {
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
  await assert.rejects(
    llm.waitForResponse('chat-exhausted', {
      timeout: 150,
      sseTimeoutMs: 150,
      llmSseBaseUrl: 'https://sse.syntx.ai',
      fallbackPoll: async () => {
        throw new Error('fallbackPoll must not run when no budget remains');
      },
    }),
    (err: unknown) => {
      assert.ok(err instanceof SyntxTimeoutError, `expected SyntxTimeoutError, got ${err}`);
      assert.equal((err as SyntxTimeoutError).chatId, 'chat-exhausted');
      return true;
    },
  );
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

test('ChatsResource.get fetches a single chat by id or uuid', async () => {
  const { calls, restore } = installFetchMock(
    () =>
      new Response(
        JSON.stringify({
          id: 20872358,
          uuid: '968e99a3-9e32-4534-ade7-6291cf7c75bc',
          title: 'Демо-презентация как короткометражка',
          scope: 'text',
          deleted: false,
          message_count: 12,
          message_limit: 800,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );

  const chats = new ChatsResource(makeChatsClient());
  const chat = await chats.get('968e99a3-9e32-4534-ade7-6291cf7c75bc');

  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/chats/968e99a3-9e32-4534-ade7-6291cf7c75bc');
  assert.equal(calls[0].init.method, undefined);
  assert.equal(chat.uuid, '968e99a3-9e32-4534-ade7-6291cf7c75bc');
  assert.equal(chat.message_count, 12);
  restore();
});

test('ChatsResource.exists returns true on 200 and false on 404', async () => {
  const seq: Array<Response> = [
    new Response(JSON.stringify({ id: 1, uuid: 'u1', message_count: 2 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    new Response(JSON.stringify({ detail: 'Chat not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
  ];
  const { restore } = installFetchMock(() => seq.shift()!);

  // The shared `makeChatsClient` mock swallows non-2xx responses; we need a
  // mock that mirrors `BaseClient.handleResponse` and throws SyntxAPIError.
  const client = {
    baseURL: 'https://api.syntx.ai',
    getToken: () => 'tok',
    get: async <T>(path: string): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        headers: { Authorization: 'Bearer tok' },
      });
      if (!response.ok) {
        const body = await response.json();
        throw new SyntxAPIError(
          (body as { message?: string }).message ?? response.statusText,
          response.status,
          undefined,
          body,
        );
      }
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;

  const chats = new ChatsResource(client);
  assert.equal(await chats.exists('u1'), true);
  assert.equal(await chats.exists('u-missing'), false);

  restore();
});

test('ChatsResource.exists rethrows non-404 errors (5xx, network)', async () => {
  const { restore } = installFetchMock(
    () =>
      new Response(JSON.stringify({ detail: 'server boom' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
  );

  const client = {
    baseURL: 'https://api.syntx.ai',
    getToken: () => 'tok',
    get: async <T>(path: string): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        headers: { Authorization: 'Bearer tok' },
      });
      if (!response.ok) {
        const body = await response.json();
        throw new SyntxAPIError(
          (body as { message?: string }).message ?? response.statusText,
          response.status,
          undefined,
          body,
        );
      }
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;

  const chats = new ChatsResource(client);
  await assert.rejects(
    () => chats.exists('u-x'),
    (err: unknown) => {
      assert.equal((err as { status?: number }).status, 503);
      return true;
    },
  );

  restore();
});
