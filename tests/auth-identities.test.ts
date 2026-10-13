import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { SyntxClient } from '../src/syntx-client';
import { authTools } from '../src/mcp/tools/auth';
import type { McpContext } from '../src/mcp/registry';

/**
 * S2 / S3 — re-evaluated 2026-10-13.
 *
 * The 2026-10-13 drift sweep declined both endpoints on security grounds
 * and pinned the decision with `tests/security-declined-endpoints.test.ts`.
 * This file documents the reversal: after walking through the live
 * responses, both can be wrapped safely.
 *
 *  - `GET /api/v1/auth/identities` returns only `{provider, email, username,
 *    linked_at}` — every field is already in `get-profile`, plus the per-
 *    provider `linked_at` timestamp. The SDK projects onto an explicit
 *    allowlist and drops any future field (and any secret-shaped name) at
 *    the boundary, so a server-side addition cannot leak through without an
 *    SDK update.
 *  - `GET /api/v1/chatwoot/unread` returns only `{contact_found, has_unread}`.
 *    The endpoint is gated server-side on the internal `chatwoot_hmac`,
 *    which the SDK never holds or forwards.
 */

function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{
  baseURL: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseURL: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const SAMPLE_IDENTITIES = {
  identities: [
    { provider: 'telegram', email: null, username: 'seme_ai', linked_at: 1746120478 },
    { provider: 'email', email: 'ssm-82@example.com', username: 'ssm-82', linked_at: 1784614303 },
  ],
};

test('listIdentities returns the allowlist projection', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(SAMPLE_IDENTITIES));
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.auth.listIdentities();
    assert.equal(out.identities.length, 2);
    assert.deepEqual(out.identities[0], {
      provider: 'telegram',
      email: null,
      username: 'seme_ai',
      linked_at: 1746120478,
    });
    assert.deepEqual(out.identities[1], {
      provider: 'email',
      email: 'ssm-82@example.com',
      username: 'ssm-82',
      linked_at: 1784614303,
    });
  } finally {
    await s.close();
  }
});

test('listIdentities drops unknown server-side fields at the boundary', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        identities: [
          {
            provider: 'telegram',
            email: null,
            username: 'seme_ai',
            linked_at: 1746120478,
            leaked_field: 'oops',
            // This one is a *secret-shaped* name. Must NOT be forwarded.
            internal_hmac: 'should-not-leak',
          },
        ],
      }),
    );
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.auth.listIdentities();
    const serialised = JSON.stringify(out);
    assert.doesNotMatch(serialised, /leaked_field/);
    assert.doesNotMatch(serialised, /internal_hmac/);
    assert.doesNotMatch(serialised, /hmac/i);
    assert.doesNotMatch(serialised, /should-not-leak/);
    assert.deepEqual(out.identities[0], {
      provider: 'telegram',
      email: null,
      username: 'seme_ai',
      linked_at: 1746120478,
    });
  } finally {
    await s.close();
  }
});

test('listIdentities normalises malformed rows without throwing', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        identities: [
          { provider: 'telegram' /* missing email, username, linked_at */ },
          'not-an-object',
          null,
          { provider: 'email', email: 'a@b.com', username: 'a', linked_at: 'not-a-number' },
        ],
      }),
    );
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.auth.listIdentities();
    assert.equal(out.identities.length, 4);
    assert.deepEqual(out.identities[0], { provider: 'telegram', email: null, username: null, linked_at: null });
    // `not-an-object` and `null` are coerced to a blank identity.
    assert.deepEqual(out.identities[1], { provider: '', email: null, username: null, linked_at: null });
    assert.deepEqual(out.identities[2], { provider: '', email: null, username: null, linked_at: null });
    assert.equal(out.identities[3].linked_at, null, 'non-numeric linked_at must be normalised to null');
  } finally {
    await s.close();
  }
});

test('listIdentities tolerates a missing identities field', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({}));
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.auth.listIdentities();
    assert.deepEqual(out, { identities: [] });
  } finally {
    await s.close();
  }
});

test('chatwootUnread returns the boolean pair as-is', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ contact_found: true, has_unread: false }));
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.auth.chatwootUnread();
    assert.deepEqual(out, { contact_found: true, has_unread: false });
  } finally {
    await s.close();
  }
});

// ── MCP tool surface ───────────────────────────────────────────────────────

function makeCtx(syntx: SyntxClient): McpContext {
  return {
    syntx,
    config: { transport: 'stdio' },
    setToken: () => undefined,
  } as unknown as McpContext;
}

test('list-auth-identities tool returns the allowlist projection as JSON', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(SAMPLE_IDENTITIES));
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const tool = authTools.find((t) => t.name === 'list-auth-identities')!;
    const r = await tool.handler({}, makeCtx(client));
    assert.equal(r.isError, undefined);
    const text = (r.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    assert.deepEqual(parsed.identities[0], {
      provider: 'telegram',
      email: null,
      username: 'seme_ai',
      linked_at: 1746120478,
    });
    assert.doesNotMatch(text, /secret|token|hmac|api[_-]?key/i);
  } finally {
    await s.close();
  }
});

test('get-chatwoot-unread tool returns the boolean pair', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ contact_found: false, has_unread: false }));
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const tool = authTools.find((t) => t.name === 'get-chatwoot-unread')!;
    const r = await tool.handler({}, makeCtx(client));
    assert.equal(r.isError, undefined);
    const text = (r.content[0] as { text: string }).text;
    assert.deepEqual(JSON.parse(text), { contact_found: false, has_unread: false });
  } finally {
    await s.close();
  }
});

test('get-chatwoot-unread tool surfaces 5xx as an MCP error', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Support channel temporarily unavailable' }));
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const tool = authTools.find((t) => t.name === 'get-chatwoot-unread')!;
    const r = await tool.handler({}, makeCtx(client));
    assert.equal(r.isError, true);
    const text = (r.content[0] as { text: string }).text;
    assert.match(text, /503/);
  } finally {
    await s.close();
  }
});