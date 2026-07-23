import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { startHttp } from '../src/transport/http';
import { createMcpServer, matchTemplate } from '../src/mcp/server';
import { createMcpContext } from '../src/mcp/context';
import { allTools } from '../src/mcp/tools';
import { audioTools } from '../src/mcp/tools/audio';
import { DEFAULT_CONFIG } from '../src/config';
import { SyntxClient } from '../src/syntx-client';
import { SyntxAuth } from '../src/auth';
import type { McpContext } from '../src/mcp/registry';
import type { SyntxResourceTemplate } from '../src/mcp/registry';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ── M2 — request-scoped credentials ─────────────────────────────────────────

test('M2: context uses requestToken over config.token and freezes setToken', () => {
  const ctx = createMcpContext({ ...DEFAULT_CONFIG, token: 'env-token' }, 'req-token');
  assert.equal(ctx.syntx.auth.getToken(), 'req-token');
  assert.throws(() => ctx.setToken('other'), /request-scoped credential/);
});

test('M2: context falls back to config.token when no requestToken', () => {
  const ctx = createMcpContext({ ...DEFAULT_CONFIG, token: 'env-token' });
  assert.equal(ctx.syntx.auth.getToken(), 'env-token');
  ctx.setToken('runtime-token');
  assert.equal(ctx.syntx.auth.getToken(), 'runtime-token');
});

interface ProbeResult {
  stop: () => Promise<void>;
  port: number;
}

async function startProbeServer(
  factory: (requestToken?: string) => Server,
  opts: { httpToken?: string; maxSseClients?: number } = {},
): Promise<ProbeResult> {
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const stop = await startHttp({
    serverFactory: factory,
    port,
    hostname: '127.0.0.1',
    httpToken: opts.httpToken,
    maxSseClients: opts.maxSseClients,
  });
  return { stop, port };
}

function fakeServer(): Server {
  return {
    connect: async () => {},
    close: async () => {},
    setRequestHandler: () => {},
  } as unknown as Server;
}

function rawRequest(
  port: number,
  opts: { method: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: opts.method,
        path: '/mcp',
        headers: {
          host: '127.0.0.1',
          ...(opts.body
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(opts.body).toString(),
              }
            : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('M2: HTTP Authorization header is forwarded to the server factory (passthrough)', async () => {
  let seen: string | undefined | null = null;
  const { stop, port } = await startProbeServer((tok) => {
    seen = tok ?? null;
    return fakeServer();
  });
  try {
    await rawRequest(port, {
      method: 'POST',
      headers: { authorization: 'Bearer tenant-token-123' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(seen, 'tenant-token-123');
  } finally {
    await stop();
  }
});

test('M2: Authorization header is NOT forwarded when MCP_HTTP_TOKEN gate is active', async () => {
  let seen: string | undefined | null = null;
  const { stop, port } = await startProbeServer(
    (tok) => {
      seen = tok ?? null;
      return fakeServer();
    },
    { httpToken: 'gate-secret' },
  );
  try {
    await rawRequest(port, {
      method: 'POST',
      headers: { authorization: 'Bearer gate-secret' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(seen, null);
  } finally {
    await stop();
  }
});

// ── M5 — hard fail on unauthenticated non-loopback bind ─────────────────────

test('M5: non-loopback bind without MCP_HTTP_TOKEN fails startup', async () => {
  await assert.rejects(
    () =>
      startHttp({
        serverFactory: () => fakeServer(),
        port: 0,
        hostname: '0.0.0.0',
      }),
    /Refusing to start/,
  );
});

test('M5: non-loopback bind with MCP_HTTP_TOKEN is allowed', async () => {
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const stop = await startHttp({
    serverFactory: () => fakeServer(),
    port,
    hostname: '0.0.0.0',
    httpToken: 'gate-secret',
  });
  await stop();
});

// ── M6 — SSE concurrency cap ────────────────────────────────────────────────

test('M6: excess concurrent SSE streams are rejected with 429', async () => {
  // First GET occupies the single SSE slot by blocking in server.connect.
  let releaseFirst: () => void = () => {};
  const firstConnected = new Promise<void>((r) => {
    releaseFirst = r;
  });
  let connectCalls = 0;
  const factory = (): Server =>
    ({
      connect: () => {
        connectCalls++;
        return connectCalls === 1 ? firstConnected : Promise.resolve();
      },
      close: async () => {},
      setRequestHandler: () => {},
    }) as unknown as Server;

  const { stop, port } = await startProbeServer(factory, { maxSseClients: 1 });

  const first = http.request({
    hostname: '127.0.0.1',
    port,
    method: 'GET',
    path: '/mcp',
    headers: { host: '127.0.0.1', accept: 'text/event-stream' },
  });
  first.on('response', (res) => res.resume());
  first.on('error', () => {});
  first.end();

  // Give the first request a moment to reach server.connect.
  await new Promise((r) => setTimeout(r, 150));

  const second = await rawRequest(port, {
    method: 'GET',
    headers: { accept: 'text/event-stream' },
  });
  assert.equal(second.status, 429);
  assert.match(second.body, /Too many concurrent SSE streams/);

  releaseFirst();
  first.destroy();
  await stop();
});

// ── M3 — OAuth Authorization Code + PKCE ────────────────────────────────────

test('M3: getGoogleLoginUrl uses response_type=code and PKCE S256', () => {
  const auth = new SyntxClient().auth;
  const url = new URL(
    auth.getGoogleLoginUrl('client-1', 'https://app.example/cb', {
      state: 'csrf-1',
      codeChallenge: 'challenge-1',
    }),
  );
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-1');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'csrf-1');
  assert.equal(url.searchParams.get('client_id'), 'client-1');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example/cb');
});

test('M3: generatePkcePair produces a valid S256 challenge', () => {
  const { codeVerifier, codeChallenge } = SyntxAuth.generatePkcePair();
  assert.equal(codeVerifier.length, 43); // 32 bytes base64url, no padding
  const expected = b64url(createHash('sha256').update(codeVerifier).digest());
  assert.equal(codeChallenge, expected);
});

test('M3: exchangeGoogleCode rejects empty code/verifier', async () => {
  const auth = new SyntxClient().auth;
  await assert.rejects(
    () =>
      auth.exchangeGoogleCode({
        clientId: 'c',
        redirectUri: 'https://app.example/cb',
        code: ' ',
        codeVerifier: 'v',
      }),
    /non-empty code and codeVerifier/,
  );
});

// ── I1 — transcribe MIME whitelist ──────────────────────────────────────────

function fakeCtx(transport: 'stdio' | 'http' = 'stdio'): McpContext {
  const syntx = new SyntxClient({ token: 't' });
  syntx.chats.transcribe = (async () => ({ text: 'ok' })) as typeof syntx.chats.transcribe;
  return {
    syntx,
    config: { ...DEFAULT_CONFIG, transport },
    setToken: () => {},
    setDefaultModel: () => {},
    setDefaultAI: () => {},
  };
}

test('I1: transcribe rejects a non-audio payload', async () => {
  const tool = audioTools[0];
  const result = await tool.handler(
    {
      content_base64: Buffer.from('not audio').toString('base64'),
      filename: 'evil.txt',
    },
    fakeCtx(),
  );
  assert.equal(result.isError, true);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /Unsupported audio type/);
});

test('I1: transcribe rejects an unknown (uninferrable) MIME type', async () => {
  const tool = audioTools[0];
  const result = await tool.handler(
    {
      content_base64: Buffer.from('xxxx').toString('base64'),
      filename: 'blob.bin',
    },
    fakeCtx(),
  );
  assert.equal(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /Unsupported audio type/);
});

test('I1: transcribe accepts whitelisted audio (mp3 by extension)', async () => {
  const tool = audioTools[0];
  const result = await tool.handler(
    {
      content_base64: Buffer.from('fake mp3 bytes').toString('base64'),
      filename: 'clip.mp3',
    },
    fakeCtx(),
  );
  assert.notEqual(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /"text": "ok"/);
});

// ── I2 — ReDoS-safe matchTemplate ───────────────────────────────────────────

function tpl(uriTemplate: string): SyntxResourceTemplate {
  return {
    uriTemplate,
    name: 't',
    read: async () => ({ contents: [] }),
  };
}

test('I2: normal template still matches and extracts params', () => {
  const params = matchTemplate(tpl('syntx://chat/{uuid}/messages'), 'syntx://chat/abc-123/messages');
  assert.deepEqual(params, { uuid: 'abc-123' });
});

test('I2: regex metacharacters in template literals are escaped', () => {
  // `.` must match a literal dot, not any character.
  assert.deepEqual(matchTemplate(tpl('syntx://x/{a}.json'), 'syntx://x/foo.json'), { a: 'foo' });
  assert.equal(matchTemplate(tpl('syntx://x/{a}.json'), 'syntx://x/fooXjson'), null);
});

test('I2: overlong URI / template are rejected without evaluation', () => {
  assert.equal(matchTemplate(tpl('syntx://chat/{uuid}'), `syntx://chat/${'a'.repeat(600)}`), null);
  assert.equal(matchTemplate(tpl(`syntx://chat/{${'u'.repeat(300)}}`), 'syntx://chat/x'), null);
});

// ── I3 — capability inventory ───────────────────────────────────────────────

test('I3: every tool declares a capability inventory', () => {
  for (const tool of allTools) {
    assert.ok(
      tool.capability !== undefined,
      `tool ${tool.name} is missing capability metadata`,
    );
  }
});

test('I3: filesystem-reading tools are flagged localFileRead', () => {
  const flagged = allTools.filter((t) => t.capability?.localFileRead).map((t) => t.name);
  assert.ok(flagged.includes('upload-files'));
  assert.ok(flagged.includes('transcribe'));
});

test('I3: auth-mutating tools are flagged authMutation', () => {
  const flagged = allTools.filter((t) => t.capability?.authMutation).map((t) => t.name);
  for (const name of ['set-token', 'poll-telegram-auth', 'login-telegram', 'verify-email-otp']) {
    assert.ok(flagged.includes(name), `${name} must be flagged authMutation`);
  }
  assert.ok(!flagged.includes('whoami'));
});

test('I3: message tools that forward user content are flagged externalExfiltration', () => {
  const flagged = allTools.filter((tool) => tool.capability?.externalExfiltration).map((tool) => tool.name);
  assert.ok(flagged.includes('send-message'));
});
