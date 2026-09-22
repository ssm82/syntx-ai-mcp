import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BaseClient } from '../src/client';
import { ChatsResource } from '../src/resources/chats';
import { chatsTools } from '../src/mcp/tools/chats';

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
      {
        status,
        headers: { 'content-type': 'application/json' },
      },
    );
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function readBody(call: CapturedCall): string | undefined {
  return typeof call.init.body === 'string' ? call.init.body : undefined;
}

function makeClient(): BaseClient {
  return new BaseClient({ baseURL: 'https://api.syntx.ai', token: 'tok' });
}

function createMockSyntx(overrides: Partial<{ chats: Record<string, unknown> }> = {}) {
  return {
    chats: {
      rename: overrides.chats?.rename,
      toggleFavorite: overrides.chats?.toggleFavorite,
      toggleMessageFavorite: overrides.chats?.toggleMessageFavorite,
      deleteMessage: overrides.chats?.deleteMessage,
    },
  } as unknown as import('../src/syntx-client').SyntxClient;
}

function makeContext(syntx: import('../src/syntx-client').SyntxClient) {
  return {
    syntx,
    config: {
      baseURL: 'https://api.syntx.ai',
      lang: 'en',
      defaultAI: 'chatgpt',
      defaultModel: null,
      pollInterval: 5000,
      pollTimeout: 600000,
      transport: 'stdio' as const,
      httpPort: 3000,
      httpHostname: '127.0.0.1',
      httpToken: undefined,
      streamMode: 'auto' as const,
      wsURL: 'wss://api.syntx.ai/api/v1',
    },
    setToken: () => {},
    setDefaultModel: () => {},
    setDefaultAI: () => {},
  } as unknown as import('../src/mcp/registry').McpContext;
}

test('BaseClient.put sends a PUT request with a JSON body', async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { ok: true } }]);

  const result = await makeClient().put<{ ok: boolean }>('/api/v1/chats/c1', { title: 'New' });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/chats/c1');
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(readBody(calls[0]), JSON.stringify({ title: 'New' }));
  restore();
});

test('ChatsResource.rename issues PUT /chats/{id} with {title}', async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { uuid: 'c1' } }]);

  const result = await new ChatsResource(makeClient()).rename('c1', 'New title');

  assert.deepEqual(result, { uuid: 'c1' });
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/chats/c1');
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(readBody(calls[0]), JSON.stringify({ title: 'New title' }));
  restore();
});

test('ChatsResource.toggleFavorite issues body-less POST', async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { ok: true } }]);

  const result = await new ChatsResource(makeClient()).toggleFavorite('c1');

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/chats/c1/favorite');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, undefined);
  restore();
});

test('ChatsResource.toggleMessageFavorite issues body-less POST with both ids encoded', async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { ok: true } }]);

  const result = await new ChatsResource(makeClient()).toggleMessageFavorite('chat uuid', '42');

  assert.deepEqual(result, { ok: true });
  assert.equal(
    calls[0].url,
    'https://api.syntx.ai/api/v1/chats/chat%20uuid/messages/42/favorite',
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, undefined);
  restore();
});

test('ChatsResource.deleteMessage issues DELETE /chats/messages/{id} without chatId', async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: {} }]);

  await new ChatsResource(makeClient()).deleteMessage('42');

  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/chats/messages/42');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.body, undefined);
  restore();
});

test('rename-chat tool passes trimmed args and returns server JSON', async () => {
  const calls: Array<{ chat: string; title: string }> = [];
  const syntx = createMockSyntx({
    chats: {
      rename: async (chat: string, title: string) => {
        calls.push({ chat, title });
        return { uuid: chat, title };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = chatsTools.find((t) => t.name === 'rename-chat')!;
  assert.ok(tool, 'rename-chat tool must be registered');

  const result = await tool.handler({ chat_id: ' c1 ', title: ' New title ' }, ctx);

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [{ chat: 'c1', title: 'New title' }]);
  assert.match((result.content[0] as { text: string }).text, /"title": "New title"/);
});

test('rename-chat tool rejects empty title and empty chat_id', async () => {
  const ctx = makeContext(createMockSyntx());
  const tool = chatsTools.find((t) => t.name === 'rename-chat')!;

  const emptyTitle = await tool.handler({ chat_id: 'c1', title: '   ' }, ctx);
  assert.equal(emptyTitle.isError, true);
  assert.match(
    (emptyTitle.content[0] as { text: string }).text,
    /"title" must be a non-empty string/,
  );

  const emptyChat = await tool.handler({ chat_id: '', title: 'x' }, ctx);
  assert.equal(emptyChat.isError, true);
  assert.match(
    (emptyChat.content[0] as { text: string }).text,
    /"chat_id" must be a non-empty string/,
  );
});

test('rename-chat tool returns deterministic ack when response is empty', async () => {
  const syntx = createMockSyntx({
    chats: {
      rename: async () => undefined,
    },
  });
  const ctx = makeContext(syntx);
  const tool = chatsTools.find((t) => t.name === 'rename-chat')!;

  const result = await tool.handler({ chat_id: 'c1', title: 'New' }, ctx);

  assert.equal(result.isError, undefined);
  assert.match(
    (result.content[0] as { text: string }).text,
    /Renamed chat c1 to "New"\./,
  );
});

test('delete-message tool rejects empty message_id and acks on success', async () => {
  const calls: Array<{ message: string }> = [];
  const syntx = createMockSyntx({
    chats: {
      deleteMessage: async (message: string) => {
        calls.push({ message });
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = chatsTools.find((t) => t.name === 'delete-message')!;
  assert.ok(tool, 'delete-message tool must be registered');

  const rejected = await tool.handler({ message_id: '  ' }, ctx);
  assert.equal(rejected.isError, true);
  assert.match(
    (rejected.content[0] as { text: string }).text,
    /"message_id" must be a non-empty string/,
  );

  const ok = await tool.handler({ message_id: '42' }, ctx);
  assert.equal(ok.isError, undefined);
  assert.deepEqual(calls, [{ message: '42' }]);
  assert.match((ok.content[0] as { text: string }).text, /Deleted message 42\./);
});

test('delete-message tool description warns the action is destructive', () => {
  const tool = chatsTools.find((t) => t.name === 'delete-message')!;
  assert.match(tool.description, /destructive and cannot be undone/);
});

test('toggle-chat-favorite tool passes chat id and documents flip semantics', async () => {
  const calls: Array<{ chat: string }> = [];
  const syntx = createMockSyntx({
    chats: {
      toggleFavorite: async (chat: string) => {
        calls.push({ chat });
        return { ok: true };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = chatsTools.find((t) => t.name === 'toggle-chat-favorite')!;
  assert.ok(tool, 'toggle-chat-favorite tool must be registered');
  assert.match(tool.description, /flips/);
  assert.match(tool.description, /list-chats/);

  const result = await tool.handler({ chat_id: 'c1' }, ctx);

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [{ chat: 'c1' }]);
  assert.match((result.content[0] as { text: string }).text, /"ok": true/);
});

test('toggle-chat-favorite tool rejects empty chat_id', async () => {
  const ctx = makeContext(createMockSyntx());
  const tool = chatsTools.find((t) => t.name === 'toggle-chat-favorite')!;

  const result = await tool.handler({ chat_id: '' }, ctx);
  assert.equal(result.isError, true);
  assert.match(
    (result.content[0] as { text: string }).text,
    /"chat_id" must be a non-empty string/,
  );
});

test('toggle-message-favorite tool passes both ids and documents flip semantics', async () => {
  const calls: Array<{ chat: string; message: string }> = [];
  const syntx = createMockSyntx({
    chats: {
      toggleMessageFavorite: async (chat: string, message: string) => {
        calls.push({ chat, message });
        return { ok: true };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = chatsTools.find((t) => t.name === 'toggle-message-favorite')!;
  assert.ok(tool, 'toggle-message-favorite tool must be registered');
  assert.match(tool.description, /flips/);
  assert.match(tool.description, /get-favorite-messages/);

  const result = await tool.handler({ chat_id: 'c1', message_id: '42' }, ctx);

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [{ chat: 'c1', message: '42' }]);
  assert.match((result.content[0] as { text: string }).text, /"ok": true/);
});

test('toggle-message-favorite tool rejects empty ids', async () => {
  const ctx = makeContext(createMockSyntx());
  const tool = chatsTools.find((t) => t.name === 'toggle-message-favorite')!;

  for (const args of [
    { chat_id: '', message_id: '42' },
    { chat_id: 'c1', message_id: '' },
  ]) {
    const result = await tool.handler(args, ctx);
    assert.equal(result.isError, true);
  }
});
