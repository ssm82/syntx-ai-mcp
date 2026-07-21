import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toPublicUser } from '../src/resources/user';
import type { UserInternal } from '../src/types';
import { authTools } from '../src/mcp/tools/auth';
import { userTools } from '../src/mcp/tools/user';

const RAW: UserInternal = {
  id: 42,
  user_id: 42,
  created_at: 1700000000,
  name: 'Alice',
  username: 'alice',
  email: 'alice@example.com',
  avatar: 'https://example.com/a.png',
  auth_services: ['telegram', 'email'],
  ym_client_id: 'ym-secret-123',
  chatwoot_hmac: 'hmac-secret-456',
};

test('toPublicUser strips chatwoot_hmac and ym_client_id', () => {
  const out = toPublicUser(RAW);
  assert.equal(out.id, 42);
  assert.equal(out.user_id, 42);
  assert.equal(out.name, 'Alice');
  assert.equal(out.username, 'alice');
  assert.equal(out.email, 'alice@example.com');
  assert.equal(out.avatar, 'https://example.com/a.png');
  assert.deepEqual(out.auth_services, ['telegram', 'email']);
  assert.equal((out as Record<string, unknown>).chatwoot_hmac, undefined);
  assert.equal((out as Record<string, unknown>).ym_client_id, undefined);
  assert.equal((out as Record<string, unknown>).created_at, undefined);
});

test('toPublicUser strips unknown future secret-shaped fields', () => {
  const polluted = {
    ...RAW,
    api_key: 'leak',
    secret_token: 'leak',
    someclient_secret: 'leak',
    hmac_key: 'leak',
    benign_field: 'keep',
  } as unknown as UserInternal;
  const out = toPublicUser(polluted);
  const json = JSON.stringify(out);
  // Every secret-shaped field must be absent; benign unknowns are dropped
  // by the explicit projection (which is the intended behaviour: the
  // projection is a closed allow-list, not a denylist).
  assert.doesNotMatch(json, /api[_-]?key/i);
  assert.doesNotMatch(json, /secret/i);
  assert.doesNotMatch(json, /hmac/i);
  assert.doesNotMatch(json, /benign_field/);
});

test('whoami returns sanitised user (no chatwoot_hmac / ym_client_id)', async () => {
  const ctx = {
    syntx: {
      auth: { isAuthenticated: () => true },
      user: {
        mePublic: async () => toPublicUser(RAW),
      },
    },
    config: { transport: 'stdio' },
  } as unknown as import('../src/mcp/registry').McpContext;
  const tool = authTools.find((t) => t.name === 'whoami')!;
  const r = await tool.handler({}, ctx);
  assert.equal(r.isError, undefined);
  const text = (r.content[0] as { text: string }).text;
  assert.doesNotMatch(text, /chatwoot_hmac/);
  assert.doesNotMatch(text, /ym_client_id/);
  assert.doesNotMatch(text, /secret|token|api[_-]?key/i);
  assert.match(text, /"name": "Alice"/);
});

test('get-profile returns sanitised user', async () => {
  const ctx = {
    syntx: {
      auth: { isAuthenticated: () => true },
      user: {
        mePublic: async () => toPublicUser(RAW),
      },
    },
    config: { transport: 'stdio' },
  } as unknown as import('../src/mcp/registry').McpContext;
  const tool = userTools.find((t) => t.name === 'get-profile')!;
  const r = await tool.handler({}, ctx);
  assert.equal(r.isError, undefined);
  const text = (r.content[0] as { text: string }).text;
  assert.doesNotMatch(text, /chatwoot_hmac/);
  assert.doesNotMatch(text, /ym_client_id/);
  assert.doesNotMatch(text, /secret|token|api[_-]?key/i);
});
