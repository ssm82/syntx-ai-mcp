import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authTools } from '../src/mcp/tools/auth';
import type { McpContext } from '../src/mcp/registry';

function makeContext(
  transport: 'stdio' | 'http',
): { ctx: McpContext; setTokenCalls: string[] } {
  const setTokenCalls: string[] = [];
  const ctx = {
    syntx: {
      auth: {
        isAuthenticated: () => false,
      },
    },
    config: {
      baseURL: 'https://api.syntx.ai',
      lang: 'en',
      defaultAI: 'chatgpt',
      pollInterval: 5000,
      pollTimeout: 600000,
      transport,
      httpPort: 3000,
      httpHostname: '127.0.0.1',
      httpToken: undefined,
      streamMode: 'auto',
      wsURL: 'wss://api.syntx.ai/api/v1',
    },
    setToken: (token: string) => {
      setTokenCalls.push(token);
    },
  } as unknown as McpContext;
  return { ctx, setTokenCalls };
}

function findTool(name: string) {
  const t = authTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} missing`);
  return t;
}

test('set-token: succeeds on stdio', async () => {
  const { ctx, setTokenCalls } = makeContext('stdio');
  const r = await findTool('set-token').handler({ token: 't1' }, ctx);
  assert.equal(r.isError, undefined);
  assert.deepEqual(setTokenCalls, ['t1']);
});

test('set-token: rejected on http', async () => {
  const { ctx, setTokenCalls } = makeContext('http');
  const r = await findTool('set-token').handler({ token: 't1' }, ctx);
  assert.equal(r.isError, true);
  assert.match((r.content[0] as { text: string }).text, /not permitted over the http transport/i);
  assert.equal(setTokenCalls.length, 0, 'setToken must NOT be invoked on http');
});

test('whoami: returns authenticated=false when no token is configured', async () => {
  const { ctx } = makeContext('stdio');
  const r = await findTool('whoami').handler({}, ctx);
  assert.equal(r.isError, undefined);
  const text = (r.content[0] as { text: string }).text;
  assert.deepEqual(JSON.parse(text), { authenticated: false, user: null });
});

test('whoami: returns authenticated=true with profile when token is set and SDK succeeds', async () => {
  const ctx = {
    syntx: {
      auth: { isAuthenticated: () => true },
      user: { mePublic: async () => ({ id: 'u1', email: 'a@b.c' }) },
    },
    config: { transport: 'stdio' },
  } as unknown as McpContext;
  const r = await findTool('whoami').handler({}, ctx);
  assert.equal(r.isError, undefined);
  const text = (r.content[0] as { text: string }).text;
  const parsed = JSON.parse(text);
  assert.equal(parsed.authenticated, true);
  assert.deepEqual(parsed.user, { id: 'u1', email: 'a@b.c' });
});

test('whoami: surfaces non-auth failures as MCP errors (network/5xx distinguishability)', async () => {
  const ctx = {
    syntx: {
      auth: { isAuthenticated: () => true },
      user: { mePublic: async () => { throw new Error('boom'); } },
    },
    config: { transport: 'stdio' },
  } as unknown as McpContext;
  const r = await findTool('whoami').handler({}, ctx);
  assert.equal(r.isError, true);
  assert.match((r.content[0] as { text: string }).text, /whoami: boom/);
});
