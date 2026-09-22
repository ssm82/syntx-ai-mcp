import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FoldersResource } from '../src/resources/folders-settings';
import { foldersTools } from '../src/mcp/tools/folders';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function createMockSyntx(overrides: Partial<{ folders: Record<string, unknown> }> = {}) {
  return {
    folders: {
      create: overrides.folders?.create,
      addChats: overrides.folders?.addChats,
      removeChats: overrides.folders?.removeChats,
      update: overrides.folders?.update,
      move: overrides.folders?.move,
      delete: overrides.folders?.delete,
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
    const body =
      next.body === undefined
        ? ''
        : typeof next.body === 'string'
          ? next.body
          : JSON.stringify(next.body);
    return new Response(body, {
      status,
      headers: body.length > 0 ? { 'content-type': 'application/json' } : undefined,
    });
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

test('FoldersResource.create forwards exact JSON body and defaults', async () => {
  const { calls, restore } = installFetchMock([
    { status: 200, body: { uuid: 'p1', title: 'Refactor', scope: 'text' } },
  ]);

  const client = {
    baseURL: 'https://api.syntx.ai',
    getToken: () => 'tok',
    post: async <T>(path: string, body: unknown): Promise<T> => {
      const url = `https://api.syntx.ai${path}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;

  const folders = new FoldersResource(client);
  const created = await folders.create({ title: 'Refactor', chat_uuids: ['c1'] });
  assert.equal(created.uuid, 'p1');
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/folders/create');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(
    readText(calls[0]),
    JSON.stringify({ title: 'Refactor', scope: 'text', color: '#9C9C9C', chat_uuids: ['c1'] }),
  );

  restore();
});

test('FoldersResource.create with only title applies web-client defaults', async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { uuid: 'p2' } }]);
  const client = {
    baseURL: 'https://api.syntx.ai',
    getToken: () => undefined,
    post: async <T>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;

  await new FoldersResource(client).create({ title: 'Empty' });

  assert.equal(
    readText(calls[0]),
    JSON.stringify({ title: 'Empty', scope: 'text', color: '#9C9C9C', chat_uuids: [] }),
  );
  restore();
});

test('FoldersResource.addChats sends bare JSON array of UUIDs', async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { success: true } }]);
  const client = {
    baseURL: 'https://api.syntx.ai',
    getToken: () => 'tok',
    post: async <T>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;

  const result = await new FoldersResource(client).addChats('475d21a2-221e-4f4e-83bf-16066ba33c4f', [
    'a',
    'b',
  ]);
  assert.deepEqual(result, { success: true });
  assert.equal(
    calls[0].url,
    'https://api.syntx.ai/api/v1/folders/475d21a2-221e-4f4e-83bf-16066ba33c4f/add',
  );
  assert.equal(readText(calls[0]), JSON.stringify(['a', 'b']));
  restore();
});

test('create-project tool calls SDK and returns server JSON', async () => {
  const calls: Array<{ args: unknown }> = [];
  const syntx = createMockSyntx({
    folders: {
      create: async (data: unknown) => {
        calls.push({ args: data });
        return { uuid: 'p3', ...(data as Record<string, unknown>) };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'create-project');
  assert.ok(tool, 'create-project tool must be registered');

  const result = await tool!.handler(
    {
      title: ' Refactor ',
      scope: 'image',
      color: '#ABCDEF',
      chat_uuids: ['c1', 'c2'],
    },
    ctx,
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls[0].args, {
    title: 'Refactor',
    scope: 'image',
    color: '#ABCDEF',
    chat_uuids: ['c1', 'c2'],
  });
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /"uuid": "p3"/);
  assert.match(text, /"title": "Refactor"/);
});

test('create-project tool rejects empty title', async () => {
  const syntx = createMockSyntx();
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'create-project')!;
  const result = await tool.handler({ title: '   ' }, ctx);
  assert.equal(result.isError, true);
  assert.match(
    (result.content[0] as { text: string }).text,
    /"title" must be a non-empty string/,
  );
});

test('create-project tool forwards SDK errors via toMcpError', async () => {
  const syntx = createMockSyntx({
    folders: {
      create: async () => {
        throw new Error('boom');
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'create-project')!;
  const result = await tool.handler({ title: 'X' }, ctx);
  assert.equal(result.isError, true);
  assert.match(
    (result.content[0] as { text: string }).text,
    /create-project: boom/,
  );
});

test('add-chats-to-project tool calls SDK with bare UUID array', async () => {
  const calls: Array<{ folder: string; uuids: string[] }> = [];
  const syntx = createMockSyntx({
    folders: {
      addChats: async (folder: string, uuids: string[]) => {
        calls.push({ folder, uuids });
        return { ok: true };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'add-chats-to-project')!;

  const result = await tool.handler(
    {
      folder_uuid: '475d21a2-221e-4f4e-83bf-16066ba33c4f',
      chat_uuids: ['c1', 'c2'],
    },
    ctx,
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [
    { folder: '475d21a2-221e-4f4e-83bf-16066ba33c4f', uuids: ['c1', 'c2'] },
  ]);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /"ok": true/);
});

test('add-chats-to-project tool returns deterministic ack when response is empty', async () => {
  const syntx = createMockSyntx({
    folders: {
      addChats: async () => undefined,
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'add-chats-to-project')!;

  const result = await tool.handler(
    { folder_uuid: 'f-1', chat_uuids: ['c1'] },
    ctx,
  );

  assert.equal(result.isError, undefined);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /Added 1 chat\(s\) to project f-1\./);
});

test('add-chats-to-project tool rejects empty chat_uuids', async () => {
  const syntx = createMockSyntx();
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'add-chats-to-project')!;

  for (const args of [
    { folder_uuid: 'f-1', chat_uuids: [] },
    { folder_uuid: '', chat_uuids: ['c1'] },
  ] as const) {
    const result = await tool.handler(args as Record<string, unknown>, ctx);
    assert.equal(result.isError, true);
    assert.equal((result.content[0] as { type: string }).type, 'text');
  }
});

test('FoldersResource.delete issues DELETE /folders/{uuid}/delete', async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { success: true } }]);
  const client = {
    baseURL: 'https://api.syntx.ai',
    getToken: () => 'tok',
    delete: async <T>(path: string): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer tok',
        },
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;

  const result = await new FoldersResource(client).delete(
    '08615df5-6523-4be0-90dc-55e95b38b7df',
  );
  assert.deepEqual(result, { success: true });
  assert.equal(
    calls[0].url,
    'https://api.syntx.ai/api/v1/folders/08615df5-6523-4be0-90dc-55e95b38b7df/delete',
  );
  assert.equal(calls[0].init.method, 'DELETE');
  restore();
});

test('delete-project tool calls SDK and surfaces server response', async () => {
  const calls: Array<{ folder: string }> = [];
  const syntx = createMockSyntx({
    folders: {
      delete: async (folder: string) => {
        calls.push({ folder });
        return { success: true, message: 'Folder deleted' };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'delete-project')!;

  const result = await tool.handler(
    { folder_uuid: '08615df5-6523-4be0-90dc-55e95b38b7df' },
    ctx,
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [{ folder: '08615df5-6523-4be0-90dc-55e95b38b7df' }]);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /"success": true/);
});

test('delete-project tool returns deterministic ack when response is empty', async () => {
  const syntx = createMockSyntx({
    folders: {
      delete: async () => undefined,
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'delete-project')!;

  const result = await tool.handler(
    { folder_uuid: 'f-2' },
    ctx,
  );

  assert.equal(result.isError, undefined);
  assert.match(
    (result.content[0] as { text: string }).text,
    /Deleted project f-2\./,
  );
});

test('delete-project tool rejects empty folder_uuid', async () => {
  const syntx = createMockSyntx();
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'delete-project')!;
  const result = await tool.handler({ folder_uuid: '   ' }, ctx);
  assert.equal(result.isError, true);
  assert.match(
    (result.content[0] as { text: string }).text,
    /"folder_uuid" must be a non-empty string/,
  );
});

test('delete-project tool maps SDK errors via toMcpError', async () => {
  const syntx = createMockSyntx({
    folders: {
      delete: async () => {
        throw new Error('boom');
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'delete-project')!;
  const result = await tool.handler({ folder_uuid: 'f-3' }, ctx);
  assert.equal(result.isError, true);
  assert.match(
    (result.content[0] as { text: string }).text,
    /delete-project: boom/,
  );
});

test('FoldersResource.removeChats sends bare JSON array of UUIDs', async () => {
  const { calls, restore } = installFetchMock([{ status: 200, body: { success: true } }]);
  const client = {
    baseURL: 'https://api.syntx.ai',
    getToken: () => 'tok',
    post: async <T>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;

  const result = await new FoldersResource(client).removeChats('475d21a2-221e-4f4e-83bf-16066ba33c4f', [
    'a',
    'b',
  ]);
  assert.deepEqual(result, { success: true });
  assert.equal(
    calls[0].url,
    'https://api.syntx.ai/api/v1/folders/475d21a2-221e-4f4e-83bf-16066ba33c4f/remove',
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(readText(calls[0]), JSON.stringify(['a', 'b']));
  restore();
});

test('FoldersResource.update serializes only provided keys', async () => {
  const cases: Array<{ data: { title?: string; color?: string }; expected: string }> = [
    { data: { title: 'New' }, expected: JSON.stringify({ title: 'New' }) },
    { data: { color: '#ABCDEF' }, expected: JSON.stringify({ color: '#ABCDEF' }) },
    { data: { title: 'New', color: '#ABCDEF' }, expected: JSON.stringify({ title: 'New', color: '#ABCDEF' }) },
  ];

  const { calls, restore } = installFetchMock(cases.map(() => ({ status: 200, body: {} })));
  const client = {
    baseURL: 'https://api.syntx.ai',
    getToken: () => 'tok',
    patch: async <T>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;

  const folders = new FoldersResource(client);
  for (const { data } of cases) {
    await folders.update('f-uuid', data);
  }

  for (let i = 0; i < cases.length; i++) {
    assert.equal(calls[i].url, 'https://api.syntx.ai/api/v1/folders/f-uuid/change');
    assert.equal(calls[i].init.method, 'PATCH');
    assert.equal(readText(calls[i]), cases[i].expected);
  }
  restore();
});

test('FoldersResource.move sends after_uuid including null for top', async () => {
  const { calls, restore } = installFetchMock([
    { status: 200, body: { sort_order: 0 } },
    { status: 200, body: { sort_order: 3 } },
  ]);
  const client = {
    baseURL: 'https://api.syntx.ai',
    getToken: () => 'tok',
    patch: async <T>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(`https://api.syntx.ai${path}`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return (await response.json()) as T;
    },
  } as unknown as import('../src/client').BaseClient;

  const folders = new FoldersResource(client);

  const top = await folders.move('f-uuid', null);
  assert.deepEqual(top, { sort_order: 0 });
  assert.equal(calls[0].url, 'https://api.syntx.ai/api/v1/folders/f-uuid/move');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(readText(calls[0]), JSON.stringify({ after_uuid: null }));

  const after = await folders.move('f-uuid', 'after-uuid');
  assert.deepEqual(after, { sort_order: 3 });
  assert.equal(readText(calls[1]), JSON.stringify({ after_uuid: 'after-uuid' }));
  restore();
});

test('remove-chats-from-project tool calls SDK with bare UUID array', async () => {
  const calls: Array<{ folder: string; uuids: string[] }> = [];
  const syntx = createMockSyntx({
    folders: {
      removeChats: async (folder: string, uuids: string[]) => {
        calls.push({ folder, uuids });
        return { ok: true };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'remove-chats-from-project')!;

  const result = await tool.handler(
    {
      folder_uuid: '475d21a2-221e-4f4e-83bf-16066ba33c4f',
      chat_uuids: ['c1', 'c2'],
    },
    ctx,
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [
    { folder: '475d21a2-221e-4f4e-83bf-16066ba33c4f', uuids: ['c1', 'c2'] },
  ]);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /"ok": true/);
});

test('remove-chats-from-project tool returns deterministic ack when response is empty', async () => {
  const syntx = createMockSyntx({
    folders: {
      removeChats: async () => undefined,
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'remove-chats-from-project')!;

  const result = await tool.handler(
    { folder_uuid: 'f-1', chat_uuids: ['c1'] },
    ctx,
  );

  assert.equal(result.isError, undefined);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /Removed 1 chat\(s\) from project f-1\./);
});

test('remove-chats-from-project tool rejects empty chat_uuids', async () => {
  const syntx = createMockSyntx();
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'remove-chats-from-project')!;

  for (const args of [
    { folder_uuid: 'f-1', chat_uuids: [] },
    { folder_uuid: '', chat_uuids: ['c1'] },
  ] as const) {
    const result = await tool.handler(args as Record<string, unknown>, ctx);
    assert.equal(result.isError, true);
    assert.equal((result.content[0] as { type: string }).type, 'text');
  }
});

test('update-project tool forwards only provided fields', async () => {
  const calls: Array<{ folder: string; data: { title?: string; color?: string } }> = [];
  const syntx = createMockSyntx({
    folders: {
      update: async (folder: string, data: { title?: string; color?: string }) => {
        calls.push({ folder, data });
        return { uuid: folder, ...data };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'update-project')!;

  const result = await tool.handler(
    { folder_uuid: 'f-1', title: ' Renamed ', color: '#ABCDEF' },
    ctx,
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [{ folder: 'f-1', data: { title: 'Renamed', color: '#ABCDEF' } }]);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /"title": "Renamed"/);
  assert.match(text, /"color": "#ABCDEF"/);
});

test('update-project tool rejects neither title nor color', async () => {
  const syntx = createMockSyntx();
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'update-project')!;

  const result = await tool.handler({ folder_uuid: 'f-1' }, ctx);
  assert.equal(result.isError, true);
  assert.match(
    (result.content[0] as { text: string }).text,
    /at least one of "title" or "color"/,
  );
});

test('update-project tool rejects empty title or color strings', async () => {
  const syntx = createMockSyntx();
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'update-project')!;

  for (const args of [{ folder_uuid: 'f-1', title: '   ' }, { folder_uuid: 'f-1', color: '' }]) {
    const result = await tool.handler(args, ctx);
    assert.equal(result.isError, true);
  }
});

test('reorder-project tool passes after_uuid through, null means top', async () => {
  const calls: Array<{ folder: string; after: string | null }> = [];
  const syntx = createMockSyntx({
    folders: {
      move: async (folder: string, after: string | null) => {
        calls.push({ folder, after });
        return { sort_order: after === null ? 0 : 1 };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'reorder-project')!;

  const withAfter = await tool.handler(
    { folder_uuid: 'f-1', after_uuid: 'f-2' },
    ctx,
  );
  assert.equal(withAfter.isError, undefined);
  assert.match((withAfter.content[0] as { text: string }).text, /"sort_order": 1/);

  const toTop = await tool.handler({ folder_uuid: 'f-1', after_uuid: null }, ctx);
  assert.equal(toTop.isError, undefined);
  assert.match((toTop.content[0] as { text: string }).text, /"sort_order": 0/);

  const omitted = await tool.handler({ folder_uuid: 'f-1' }, ctx);
  assert.equal(omitted.isError, undefined);

  assert.deepEqual(calls, [
    { folder: 'f-1', after: 'f-2' },
    { folder: 'f-1', after: null },
    { folder: 'f-1', after: null },
  ]);
});

test('reorder-project tool returns deterministic ack when response is empty', async () => {
  const syntx = createMockSyntx({
    folders: {
      move: async () => undefined,
    },
  });
  const ctx = makeContext(syntx);
  const tool = foldersTools.find((t) => t.name === 'reorder-project')!;

  const toTop = await tool.handler({ folder_uuid: 'f-1' }, ctx);
  assert.match((toTop.content[0] as { text: string }).text, /Moved project f-1 to the top\./);

  const after = await tool.handler({ folder_uuid: 'f-1', after_uuid: 'f-2' }, ctx);
  assert.match((after.content[0] as { text: string }).text, /Moved project f-1 after f-2\./);
});
