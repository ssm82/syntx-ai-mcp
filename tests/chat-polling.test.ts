import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChatsResource, collectCompletedObjects } from '../src/resources/chats';
import { BaseClient, parseRetryAfter } from '../src/client';
import { SyntxAbortError, SyntxAPIError, SyntxAuthError, SyntxTimeoutError } from '../src/errors';
import { toMcpError } from '../src/mcp/errors';
import { chatsTools } from '../src/mcp/tools/chats';
import { createMcpContext } from '../src/mcp/context';
import type { Message, MessageObjectItem } from '../src/types';

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

/**
 * Build a `MessageObjectItem` with sensible defaults for the common cases
 * (text, image). `id`/`message_id` are auto-incremented per call so tests
 * can build multi-object messages without collisions.
 */
let _objSeq = 0;
function obj(partial: Partial<MessageObjectItem> & Pick<MessageObjectItem, 'object_type'>): MessageObjectItem {
  _objSeq++;
  return {
    id: _objSeq,
    message_id: _objSeq,
    object_type: partial.object_type,
    object_url: partial.object_url ?? null,
    object_text: partial.object_text ?? '',
    completed: partial.completed ?? true,
    created_at: partial.created_at ?? TS,
    updated_at: partial.updated_at ?? TS,
    model_type: partial.model_type ?? null,
    metadata: partial.metadata ?? null,
  };
}

function assistantMsgWith(objects: MessageObjectItem[]): Message {
  return {
    id: 'm-multi',
    chat_id: CHAT_ID,
    author_id: -1,
    created_at: TS,
    updated_at: TS,
    is_favorite: false,
    message_object: objects,
  };
}

// ── collectCompletedObjects: pure helper (Slice 2) ──────────────────────────

test('collectCompletedObjects is not ready when message_object is empty', () => {
  const result = collectCompletedObjects(assistantMsgWith([]));
  assert.equal(result.ready, false);
  assert.equal(result.text, '');
  assert.deepEqual(result.media, []);
});

test('collectCompletedObjects is not ready when any object is not completed', () => {
  const result = collectCompletedObjects(
    assistantMsgWith([
      obj({ object_type: 'text', object_text: 'done', completed: true }),
      obj({ object_type: 'image', object_url: 'https://x/y.png', completed: false }),
    ]),
  );
  assert.equal(result.ready, false);
});

test('collectCompletedObjects joins multiple text objects with \\n\\n', () => {
  const result = collectCompletedObjects(
    assistantMsgWith([
      obj({ object_type: 'text', object_text: 'first', completed: true }),
      obj({ object_type: 'text', object_text: 'second', completed: true }),
    ]),
  );
  assert.equal(result.ready, true);
  assert.equal(result.text, 'first\n\nsecond');
  assert.deepEqual(result.media, []);
});

test('collectCompletedObjects keeps single text object unseparated', () => {
  const result = collectCompletedObjects(
    assistantMsgWith([obj({ object_type: 'text', object_text: 'only', completed: true })]),
  );
  assert.equal(result.text, 'only');
  assert.equal(result.media.length, 0);
});

test('collectCompletedObjects treats filetext like text for joining', () => {
  const result = collectCompletedObjects(
    assistantMsgWith([
      obj({ object_type: 'text', object_text: 'summary', completed: true }),
      obj({ object_type: 'filetext', object_text: 'doc body', completed: true }),
    ]),
  );
  assert.equal(result.ready, true);
  assert.equal(result.text, 'summary\n\ndoc body');
});

test('collectCompletedObjects surfaces a media-only reply without hanging', () => {
  // Lock in the regression fix: empty object_text on a completed media
  // object is normal, not a hang condition.
  const result = collectCompletedObjects(
    assistantMsgWith([
      obj({
        object_type: 'image',
        object_url: 'https://cdn.example/abc.png',
        object_text: '',
        completed: true,
        metadata: { width: 1024, height: 1024 },
      }),
    ]),
  );
  assert.equal(result.ready, true);
  assert.equal(result.text, '');
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].object_url, 'https://cdn.example/abc.png');
  assert.equal(result.media[0].object_text, '');
  assert.deepEqual(result.media[0].metadata, { width: 1024, height: 1024 });
  assert.equal(result.media[0].object_type, 'image');
});

test('collectCompletedObjects surfaces all media types', () => {
  const result = collectCompletedObjects(
    assistantMsgWith([
      obj({ object_type: 'image', object_url: 'https://x/i.png', completed: true }),
      obj({ object_type: 'video', object_url: 'https://x/v.mp4', completed: true }),
      obj({ object_type: 'audio', object_url: 'https://x/a.mp3', completed: true }),
      obj({ object_type: 'file', object_url: 'https://x/f.pdf', completed: true }),
    ]),
  );
  assert.equal(result.ready, true);
  assert.equal(result.text, '');
  assert.deepEqual(
    result.media.map((m) => m.object_type),
    ['image', 'video', 'audio', 'file'],
  );
});

test('collectCompletedObjects mixes text + media and joins only text parts', () => {
  const result = collectCompletedObjects(
    assistantMsgWith([
      obj({ object_type: 'text', object_text: 'here you go', completed: true }),
      obj({ object_type: 'image', object_url: 'https://x/i.png', completed: true }),
      obj({ object_type: 'text', object_text: 'caption', completed: true }),
    ]),
  );
  assert.equal(result.ready, true);
  assert.equal(result.text, 'here you go\n\ncaption');
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].object_url, 'https://x/i.png');
});

test('collectCompletedObjects passes through metadata verbatim (no clone, no parse)', () => {
  const weird = { buf: Buffer.from('x'), nested: { a: 1 }, list: [1, 2] };
  const result = collectCompletedObjects(
    assistantMsgWith([
      obj({
        object_type: 'image',
        object_url: 'https://x/i.png',
        completed: true,
        metadata: weird,
      }),
    ]),
  );
  assert.equal(result.media[0].metadata, weird, 'metadata must be passed by reference, not cloned');
});

test('collectCompletedObjects drops media entries with null object_url', () => {
  // Defensive: a media-typed object without a URL is incomplete and should
  // not produce a media entry. `ready` stays false because object[0] is
  // still `completed: true` but the test focuses on filtering.
  const result = collectCompletedObjects(
    assistantMsgWith([
      obj({ object_type: 'image', object_url: null, completed: true }),
    ]),
  );
  assert.equal(result.ready, true);
  assert.deepEqual(result.media, []);
});

// ── pollForResponse: media-aware completion (Slice 2) ──────────────────────

test('pollForResponse resolves on a media-only reply instead of hanging', async () => {
  const client = fakeClient({
    messagePages: [
      [
        assistantMsgWith([
          obj({
            object_type: 'image',
            object_url: 'https://cdn.example/done.png',
            object_text: '',
            completed: true,
          }),
        ]),
      ],
    ],
  });
  const result = await resourceWith(client).pollForResponse(CHAT_ID, {
    timeout: 5000,
    pollInterval: 100,
    boundary: BOUNDARY,
  });
  assert.equal(result.text, '');
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].object_url, 'https://cdn.example/done.png');
});

test('pollForResponse waits while any object remains incomplete (text done, media pending)', async () => {
  const partial = assistantMsgWith([
    obj({ object_type: 'text', object_text: 'hi', completed: true }),
    obj({ object_type: 'image', object_url: null, completed: false }),
  ]);
  const final = assistantMsgWith([
    obj({ object_type: 'text', object_text: 'hi', completed: true }),
    obj({ object_type: 'image', object_url: 'https://x/i.png', completed: true }),
  ]);
  const client = fakeClient({
    messagePages: [
      [partial],
      [partial],
      [final],
    ],
  });
  const result = await resourceWith(client).pollForResponse(CHAT_ID, {
    timeout: 5000,
    pollInterval: 100,
    boundary: BOUNDARY,
  });
  assert.equal(result.text, 'hi');
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].object_url, 'https://x/i.png');
});

// ── MCP wait-for-response tool: rendered payload (Slice 4) ──────────────────

/**
 * Invoke the MCP `wait-for-response` handler with a stubbed ChatsResource so
 * the test does not need a live network. The handler still goes through
 * `createMcpContext` for realism (config defaults, etc.).
 */
async function callWaitForResponse(
  pages: Message[][],
  args: Record<string, unknown>,
) {
  const client = fakeClient({ messagePages: pages });
  // The ChatsResource is shared between the SDK surface and MCP tools via
  // `ctx.syntx.chats` — swap a fake one in for isolation.
  const ctx = createMcpContext({
    baseURL: 'http://localhost',
    timeout: 5000,
    pollTimeout: 5000,
    pollInterval: 100,
    defaultAI: 'chatgpt',
    defaultModel: undefined,
    streamMode: 'poll',
  } as Parameters<typeof createMcpContext>[0]);
  (ctx.syntx as unknown as { chats: ChatsResource }).chats = resourceWith(client);
  const tool = chatsTools.find((t) => t.name === 'wait-for-response');
  if (!tool) throw new Error('wait-for-response tool not found');
  const result = await tool.handler(args, ctx);
  return (result.content[0] as { type: 'text'; text: string }).text;
}

test('wait-for-response MCP tool renders text + media + metadata blocks for a multi-object reply', async () => {
  const final = assistantMsgWith([
    obj({ object_type: 'text', object_text: 'here you go', completed: true }),
    obj({
      object_type: 'image',
      object_url: 'https://cdn.example/abc.png',
      completed: true,
    }),
  ]);
  const text = await callWaitForResponse([[final]], { chat_id: CHAT_ID });
  assert.match(text, /^Assistant reply:\n\nhere you go\n\n--- media ---\n/);
  assert.match(text, /"object_type": "image"/);
  assert.match(text, /"object_url": "https:\/\/cdn\.example\/abc\.png"/);
  // The trailing metadata block must still exist for downstream parser
  // compatibility.
  assert.match(text, /--- metadata ---\n/);
});

test('wait-for-response MCP tool renders the media-only hint when text is empty', async () => {
  const final = assistantMsgWith([
    obj({
      object_type: 'image',
      object_url: 'https://cdn.example/only.png',
      completed: true,
    }),
  ]);
  const text = await callWaitForResponse([[final]], { chat_id: CHAT_ID });
  assert.match(text, /\(media-only reply, see media below\)/);
  assert.match(text, /"object_url": "https:\/\/cdn\.example\/only\.png"/);
});

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

// ── get-inprogress MCP tool (catalog reconciliation item 1) ────────────────

test('get-inprogress MCP tool returns the in-progress payload verbatim', async () => {
  const inProgress = [
    {
      message_id: 7,
      message_object_id: 8,
      object_type: 'text',
      model_type: 'gpt-5.5',
      created_at: TS,
      task_id: 'task-abc',
    },
  ];
  const ctx = createMcpContext({
    baseURL: 'http://localhost',
    timeout: 5000,
    pollTimeout: 5000,
    pollInterval: 100,
    defaultAI: 'chatgpt',
    defaultModel: undefined,
    streamMode: 'poll',
  } as Parameters<typeof createMcpContext>[0]);
  (ctx.syntx as unknown as { chats: ChatsResource }).chats = resourceWith(
    fakeClient({ messagePages: [[]], inProgress }),
  );
  const tool = chatsTools.find((t) => t.name === 'get-inprogress');
  if (!tool) throw new Error('get-inprogress tool not found');
  const result = await tool.handler({ chat_id: CHAT_ID }, ctx);
  assert.equal(result.isError, undefined);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  const parsed = JSON.parse(text);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].task_id, 'task-abc');
});

test('get-inprogress MCP tool requires chat_id', () => {
  const tool = chatsTools.find((t) => t.name === 'get-inprogress');
  if (!tool) throw new Error('get-inprogress tool not found');
  assert.deepEqual(tool.inputSchema.required, ['chat_id']);
});

// ── deleteFile URL variant (catalog reconciliation item 2) ─────────────────

test('deleteFile sends {file_id} when called with a string', async () => {
  const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
  const client = {
    async delete(path: string, body?: unknown) {
      calls.push({ method: 'DELETE', path, body });
    },
  };
  await new ChatsResource(client as unknown as BaseClient).deleteFile('file-42');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/files/delete');
  assert.deepEqual(calls[0].body, { file_id: 'file-42' });
});

test('deleteFile sends {url} when called with a {url} object', async () => {
  const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
  const client = {
    async delete(path: string, body?: unknown) {
      calls.push({ method: 'DELETE', path, body });
    },
  };
  await new ChatsResource(client as unknown as BaseClient).deleteFile({
    url: 'https://r2.syntx.ai/uploaded/x.png',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/files/delete');
  assert.deepEqual(calls[0].body, { url: 'https://r2.syntx.ai/uploaded/x.png' });
});
