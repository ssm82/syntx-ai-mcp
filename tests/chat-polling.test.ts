import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChatsResource } from '../src/resources/chats';
import { BaseClient, parseRetryAfter } from '../src/client';
import { SyntxAbortError, SyntxAPIError, SyntxAuthError, SyntxTimeoutError } from '../src/errors';
import { toMcpError } from '../src/mcp/errors';
import type { Message } from '../src/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CHAT_ID = 'c1';
const BOUNDARY = '2025-01-01T00:00:00.000Z';
const TS = '2026-01-01T00:00:00.000Z';

function assistantMsg(text: string, completed: boolean): Message {
  return {
    id: 'm1',
    chat_id: CHAT_ID,
    author_id: -1,
    created_at: TS,
    updated_at: TS,
    is_favorite: false,
    message_object: [
      {
        id: 1,
        message_id: 1,
        object_type: 'text',
        object_url: null,
        object_text: text,
        completed,
        created_at: TS,
        updated_at: TS,
        model_type: 'gpt-5.5',
        metadata: null,
      },
    ],
  };
}

/**
 * Fake BaseClient: routes GETs by URL substring. `messagePages` is a queue —
 * each /messages call shifts one page; the last page repeats when exhausted.
 */
function fakeClient(opts: { messagePages: Message[][]; inProgress?: unknown[] }) {
  const calls: string[] = [];
  const client = {
    calls,
    async get(path: string) {
      calls.push(path);
      if (path.includes('/inprogress')) return opts.inProgress ?? [];
      if (path.includes('/messages')) {
        const page = opts.messagePages.length > 1 ? opts.messagePages.shift()! : opts.messagePages[0];
        return { messages: page, pagination: { limit: 50, offset: 0, total: page.length } };
      }
      throw new Error(`unexpected GET ${path}`);
    },
    async post() {
      throw new Error('unexpected POST');
    },
  };
  return client;
}

function resourceWith(client: ReturnType<typeof fakeClient>): ChatsResource {
  return new ChatsResource(client as unknown as BaseClient);
}

// ── pollForResponse: heartbeat ──────────────────────────────────────────────

test('pollForResponse fires onProgress heartbeat once per tick', async () => {
  const client = fakeClient({
    messagePages: [
      [assistantMsg('', false)],
      [assistantMsg('partial', false)],
      [assistantMsg('done', true)],
    ],
  });
  const beats: Array<{ elapsed: number; total: number }> = [];
  const res = resourceWith(client);

  const { text } = await res.pollForResponse(CHAT_ID, {
    timeout: 10000,
    pollInterval: 100,
    boundary: BOUNDARY,
    onProgress: (elapsed, total) => beats.push({ elapsed, total }),
  });

  assert.equal(text, 'done');
  assert.ok(beats.length >= 2, `expected >=2 heartbeats, got ${beats.length}`);
  for (const b of beats) assert.equal(b.total, 10000);
  for (let i = 1; i < beats.length; i++) {
    assert.ok(beats[i].elapsed >= beats[i - 1].elapsed, 'elapsed must be non-decreasing');
  }
});

test('pollForResponse works without onProgress (backwards compatible)', async () => {
  const client = fakeClient({ messagePages: [[assistantMsg('hi', true)]] });
  const { text } = await resourceWith(client).pollForResponse(CHAT_ID, {
    timeout: 5000,
    pollInterval: 100,
    boundary: BOUNDARY,
  });
  assert.equal(text, 'hi');
});

// ── pollForResponse: adaptive interval ──────────────────────────────────────

test('pollForResponse first tick fires well below the pollInterval ceiling', async () => {
  const client = fakeClient({ messagePages: [[assistantMsg('fast', true)]] });
  const started = Date.now();
  await resourceWith(client).pollForResponse(CHAT_ID, {
    timeout: 10000,
    pollInterval: 2000,
    boundary: BOUNDARY,
  });
  const elapsed = Date.now() - started;
  // Old behaviour slept the full 2000 ms before the first poll.
  assert.ok(elapsed < 1900, `first poll should happen before the ceiling, took ${elapsed} ms`);
});

// ── pollForResponse: cancellation ───────────────────────────────────────────

test('pollForResponse rejects promptly with SyntxAbortError when the signal aborts', async () => {
  const client = fakeClient({ messagePages: [[assistantMsg('', false)]] });
  const controller = new AbortController();
  const started = Date.now();
  setTimeout(() => controller.abort(), 150);

  await assert.rejects(
    resourceWith(client).pollForResponse(CHAT_ID, {
      timeout: 60000,
      pollInterval: 500,
      boundary: BOUNDARY,
      signal: controller.signal,
    }),
    (err: unknown) => err instanceof SyntxAbortError,
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `abort should be prompt, took ${elapsed} ms`);
});

test('pollForResponse with an already-aborted signal rejects immediately', async () => {
  const client = fakeClient({ messagePages: [[assistantMsg('x', true)]] });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    resourceWith(client).pollForResponse(CHAT_ID, {
      timeout: 5000,
      pollInterval: 100,
      boundary: BOUNDARY,
      signal: controller.signal,
    }),
    SyntxAbortError,
  );
});

// ── pollForResponse: structured timeout ─────────────────────────────────────

test('pollForResponse timeout rejects with SyntxTimeoutError carrying chatId and budget', async () => {
  const client = fakeClient({ messagePages: [[assistantMsg('', false)]] });
  const started = Date.now();
  await assert.rejects(
    resourceWith(client).pollForResponse(CHAT_ID, {
      timeout: 300,
      pollInterval: 100,
      boundary: BOUNDARY,
    }),
    (err: unknown) => {
      assert.ok(err instanceof SyntxTimeoutError, `expected SyntxTimeoutError, got ${err}`);
      assert.equal(err.chatId, CHAT_ID);
      assert.equal(err.timeoutMs, 300);
      // The budget check happens BEFORE the sleep, so when elapsed lands
      // exactly on `timeout`, the loop may run one more `pollInterval`
      // tick before throwing. Allow that plus generous slack for CI.
      assert.ok(err.elapsedMs >= 300, `elapsedMs=${err.elapsedMs}`);
      assert.ok(err.elapsedMs <= 1000, `elapsedMs=${err.elapsedMs} should be near budget`);
      return true;
    },
  );
  assert.ok(Date.now() - started < 3000, 'timeout should fire near its budget');
});

test('pollForResponse pre-wait timeout error reports elapsed against preWaitTimeout, not the shared budget', async () => {
  // inProgress always non-empty → enters the pre-wait loop. Shared timeout
  // is generous (10 s) so the pre-wait-specific cap fires first.
  const client = fakeClient({
    messagePages: [[assistantMsg('never', false)]],
    inProgress: [{ message_id: 1, message_object_id: 1, object_type: 'text', model_type: 'gpt-5.5', created_at: TS, task_id: null }],
  });
  await assert.rejects(
    resourceWith(client).pollForResponse(CHAT_ID, {
      timeout: 10000,
      pollInterval: 100,
      preWaitTimeout: 200,
      boundary: BOUNDARY,
    }),
    (err: unknown) => {
      assert.ok(err instanceof SyntxTimeoutError);
      assert.equal(err.chatId, CHAT_ID);
      assert.equal(err.timeoutMs, 200, 'pre-wait timeout uses preWaitTimeout as budget');
      // elapsed should be measured from preWaitStart (not from start), so
      // the rendered `elapsed X of Y` is consistent.
      assert.ok(err.elapsedMs <= 200 + 200, `elapsed ${err.elapsedMs} should track preWaitTimeout`);
      return true;
    },
  );
});

// ── toMcpError mapping ──────────────────────────────────────────────────────

test('toMcpError renders SyntxTimeoutError with a recovery hint', () => {
  const result = toMcpError(new SyntxTimeoutError('Timeout waiting for response in chat abc', 'abc', 61000, 60000), 'wait-for-response');
  assert.equal(result.isError, true);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /wait-for-response: Timeout waiting/);
  assert.match(text, /61000 ms of 60000 ms/);
  assert.match(text, /get-messages\(chat_id="abc"\)/);
  assert.match(text, /Do NOT re-send the prompt/);
});

test('toMcpError renders SyntxAbortError as a cancellation', () => {
  const result = toMcpError(new SyntxAbortError('Wait cancelled in chat abc'), 'ask');
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /^ask: Cancelled: Wait cancelled/);
});

// ── BaseClient: retry ───────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function withStubbedFetch<T>(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('BaseClient GET retries transient 5xx and eventually succeeds', async () => {
  let calls = 0;
  await withStubbedFetch(async () => {
    calls++;
    return calls < 3 ? jsonResponse(500, { message: 'boom' }) : jsonResponse(200, { ok: true });
  }, async () => {
    const client = new BaseClient({ maxRetries: 3 });
    const result = await client.get<{ ok: boolean }>('/api/v1/test');
    assert.equal(result.ok, true);
  });
  assert.equal(calls, 3);
});

test('BaseClient GET honours Retry-After on 429 and surfaces retryAfterMs', async () => {
  let calls = 0;
  await withStubbedFetch(async () => {
    calls++;
    return calls === 1
      ? jsonResponse(429, { message: 'slow down' }, { 'retry-after': '0' })
      : jsonResponse(200, { ok: true });
  }, async () => {
    const client = new BaseClient({ maxRetries: 2 });
    const result = await client.get<{ ok: boolean }>('/api/v1/test');
    assert.equal(result.ok, true);
  });
  assert.equal(calls, 2);
});

test('BaseClient GET does not retry permanent 4xx', async () => {
  let calls = 0;
  await withStubbedFetch(async () => {
    calls++;
    return jsonResponse(422, { message: 'bad input' });
  }, async () => {
    const client = new BaseClient({ maxRetries: 3 });
    await assert.rejects(client.get('/api/v1/test'), (err: unknown) => {
      assert.ok(err instanceof SyntxAPIError);
      assert.equal(err.status, 422);
      return true;
    });
  });
  assert.equal(calls, 1);
});

test('BaseClient POST is never retried (cost side effects)', async () => {
  let calls = 0;
  await withStubbedFetch(async () => {
    calls++;
    return jsonResponse(500, { message: 'boom' });
  }, async () => {
    const client = new BaseClient({ maxRetries: 3 });
    await assert.rejects(client.post('/api/v1/test', { a: 1 }), SyntxAPIError);
  });
  assert.equal(calls, 1);
});

test('BaseClient gives up after maxRetries and throws the last error', async () => {
  let calls = 0;
  await withStubbedFetch(async () => {
    calls++;
    return jsonResponse(503, { message: 'down' });
  }, async () => {
    const client = new BaseClient({ maxRetries: 2 });
    await assert.rejects(client.get('/api/v1/test'), (err: unknown) => {
      assert.ok(err instanceof SyntxAPIError);
      assert.equal(err.status, 503);
      return true;
    });
  });
  assert.equal(calls, 2);
});

test('BaseClient honours Retry-After on 503 (not just 429) and surfaces retryAfterMs', async () => {
  let calls = 0;
  await withStubbedFetch(async () => {
    calls++;
    return calls === 1
      ? jsonResponse(503, { message: 'overloaded' }, { 'retry-after': '0' })
      : jsonResponse(200, { ok: true });
  }, async () => {
    const client = new BaseClient({ maxRetries: 2 });
    const result = await client.get<{ ok: boolean }>('/api/v1/test');
    assert.equal(result.ok, true);
  });
  assert.equal(calls, 2);
});

test('BaseClient clamps malicious Retry-After (>60s) to the computed backoff', async () => {
  // A hostile or buggy upstream advertising Retry-After: 86400 must not
  // park the caller for 24h. The hint is ignored and the computed backoff
  // (500 ms base + jitter) is used instead.
  let calls = 0;
  const started = Date.now();
  await withStubbedFetch(async () => {
    calls++;
    return calls === 1
      ? jsonResponse(429, { message: 'rate limit' }, { 'retry-after': '86400' })
      : jsonResponse(200, { ok: true });
  }, async () => {
    const client = new BaseClient({ maxRetries: 2 });
    await client.get('/api/v1/test');
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `malicious Retry-After must not stall the call, took ${elapsed} ms`);
  assert.equal(calls, 2);
});

// ── BaseClient: postForm ────────────────────────────────────────────────────

test('postForm maps 401 to SyntxAuthError and sends no manual Content-Type', async () => {
  let seenContentType: string | null | undefined;
  await withStubbedFetch(async (_url, init) => {
    seenContentType = new Headers(init?.headers).get('content-type');
    return jsonResponse(401, { message: 'nope' });
  }, async () => {
    const client = new BaseClient({ token: 't' });
    const form = new FormData();
    form.append('f', new Blob(['x']), 'x.txt');
    await assert.rejects(client.postForm('/api/v1/upload', form), SyntxAuthError);
  });
  assert.equal(seenContentType, null, 'Content-Type must be left to fetch (multipart boundary)');
});

test('postForm returns parsed body on success and carries the bearer token', async () => {
  let seenAuth: string | null | undefined;
  await withStubbedFetch(async (_url, init) => {
    seenAuth = new Headers(init?.headers).get('authorization');
    return jsonResponse(200, { data: { files: [] } });
  }, async () => {
    const client = new BaseClient({ token: 'secret' });
    const result = await client.postForm<{ data: { files: unknown[] } }>('/api/v1/upload', new FormData());
    assert.deepEqual(result.data.files, []);
  });
  assert.equal(seenAuth, 'Bearer secret');
});

// ── parseRetryAfter ─────────────────────────────────────────────────────────

test('parseRetryAfter handles delta-seconds, HTTP-date and garbage', () => {
  assert.equal(parseRetryAfter('5'), 5000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter('garbage'), undefined);
  const future = new Date(Date.now() + 2000).toUTCString();
  const parsed = parseRetryAfter(future);
  assert.ok(parsed !== undefined && parsed > 0 && parsed <= 2000, `parsed=${parsed}`);
});
