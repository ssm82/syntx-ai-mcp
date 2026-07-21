import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { startHttp, checkHostHeader } from '../src/transport/http';
import { createMcpServer } from '../src/mcp/server';
import { DEFAULT_CONFIG } from '../src/config';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

function makeServerFactory(): () => Server {
  // The transport never actually invokes tool handlers in these tests —
  // any request that reaches the inner handler can fail gracefully.
  return () =>
    ({
      connect: async () => {},
      close: async () => {},
      setRequestHandler: () => {},
      oninitialized: undefined,
    }) as unknown as Server;
}

interface RequestOpts {
  method: string;
  path?: string;
  host?: string;
  origin?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

async function sendRequest(
  base: { hostname: string; port: number },
  opts: RequestOpts,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: base.hostname,
        port: base.port,
        method: opts.method,
        path: opts.path ?? '/mcp',
        headers: {
          host: opts.host ?? '127.0.0.1',
          ...(opts.origin ? { origin: opts.origin } : {}),
          ...(opts.body
            ? { 'content-length': Buffer.byteLength(opts.body).toString() }
            : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function startTestServer(opts: { httpToken?: string; hostname?: string; maxBodyBytes?: number } = {}) {
  const stop = await startHttp({
    serverFactory: makeServerFactory(),
    port: 0, // ephemeral
    hostname: opts.hostname ?? '127.0.0.1',
    httpToken: opts.httpToken,
    maxBodyBytes: opts.maxBodyBytes,
  });
  // Find the bound address by binding a temporary server (cleaner than
  // patching startHttp to expose the server). Easier: spin a probe server
  // on port 0 to discover an unused port? Cleaner: refactor startHttp to
  // expose addr. For now use the listener pattern.
  // We resolve the actual port by briefly listening ourselves.
  return stop;
}

async function startAndProbe(
  opts: Parameters<typeof startTestServer>[0] = {},
  factory?: () => Server,
) {
  // Create an internal probe server on port 0 to learn a free port, then
  // immediately close it. Race-condition-tolerant for tests.
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));

  const stop = await startHttp({
    serverFactory: factory ?? makeServerFactory(),
    port,
    hostname: opts.hostname ?? '127.0.0.1',
    httpToken: opts.httpToken,
    maxBodyBytes: opts.maxBodyBytes,
  });
  const base = { hostname: '127.0.0.1', port };
  return { stop, base };
}

// ── L1 / L2 — Host/Origin gate + method allow-list ─────────────────────────

test('OPTIONS /mcp: 200 after Host gate (L1)', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, { method: 'OPTIONS', host: '127.0.0.1' });
    assert.equal(res.status, 200);
  } finally {
    await stop();
  }
});

test('OPTIONS /mcp with disallowed host → 403 BEFORE OPTIONS handler (L1)', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, { method: 'OPTIONS', host: 'evil.com' });
    assert.equal(res.status, 403);
  } finally {
    await stop();
  }
});

test('HEAD /mcp → 405 with Allow header', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, { method: 'HEAD' });
    assert.equal(res.status, 405);
    assert.match(String(res.headers.allow ?? ''), /POST/);
  } finally {
    await stop();
  }
});

test('PUT /mcp → 405', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, { method: 'PUT' });
    assert.equal(res.status, 405);
  } finally {
    await stop();
  }
});

test('DELETE /mcp → 405', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, { method: 'DELETE' });
    assert.equal(res.status, 405);
  } finally {
    await stop();
  }
});

test('GET /mcp without SSE Accept → 405', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, { method: 'GET' });
    assert.equal(res.status, 405);
  } finally {
    await stop();
  }
});

// ── L4 — adversarial Host/Origin gate ──────────────────────────────────────

// End-to-end Host gate: every input here is something Node's HTTP parser
// actually allows over the wire. Inputs that contain control characters /
// NUL / non-ASCII are exercised in the unit-test block below via
// `checkHostHeader` directly (Node's outbound `setHeader` rejects them).
const ADVERSARIAL_HOSTS: Array<{ name: string; host: string; allowed: boolean }> = [
  { name: 'normal loopback', host: '127.0.0.1', allowed: true },
  { name: 'localhost', host: 'localhost', allowed: true },
  { name: 'IPv6 loopback bracketed', host: '[::1]', allowed: true },
  { name: 'uppercase LOCALHOST', host: 'LOCALHOST', allowed: true },
  { name: 'mixed-case LocalHost', host: 'LocalHost', allowed: true },
  { name: 'trailing dot', host: 'localhost.', allowed: true },
  { name: 'evil host', host: 'evil.com', allowed: false },
  { name: 'localhost.evil.com (suffix trick)', host: 'localhost.evil.com', allowed: false },
  { name: 'allowed host with port', host: 'localhost:8080', allowed: true },
  { name: 'evil host with allowed suffix', host: 'allowed.example.com.evil.com', allowed: false },
  { name: 'multi-value host header', host: 'localhost, evil.com', allowed: false },
  { name: 'comma only', host: ',', allowed: false },
];

for (const c of ADVERSARIAL_HOSTS) {
  test(`L4 Host gate: ${c.name} (${JSON.stringify(c.host)}) → ${c.allowed ? 'allow' : 'reject'}`, async () => {
    const { stop, base } = await startAndProbe();
    try {
      const res = await sendRequest(base, { method: 'OPTIONS', host: c.host });
      if (c.allowed) {
        assert.equal(res.status, 200, `expected 200 for ${c.name}`);
      } else {
        assert.equal(res.status, 403, `expected 403 for ${c.name}`);
      }
    } finally {
      await stop();
    }
  });
}

// Unit tests for inputs that Node's HTTP parser refuses to put on the wire.
const ALLOWED = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const ADVERSARIAL_UNIT: Array<{ name: string; host: string; expected: boolean }> = [
  { name: 'embedded NUL', host: 'localhost\x00.evil.com', expected: false },
  { name: 'tab in host', host: 'localhost\t', expected: false },
  { name: 'space in host', host: 'localhost ', expected: false },
  { name: 'newline in host', host: 'localhost\n', expected: false },
  { name: 'unicode host (IDN)', host: 'xn--nxasmq6b.example', expected: false },
  { name: 'Cyrillic host', host: 'пример.рф', expected: false },
  { name: 'multiple colons (bare IPv6 wrong)', host: 'localhost:80:80', expected: false },
  { name: 'empty header', host: '', expected: false },
  { name: 'whitespace-only', host: '   ', expected: false },
  { name: 'multiple value array', host: 'evil.com', expected: false }, // tested via array overload below
  { name: 'IPv4-mapped IPv6', host: '::ffff:127.0.0.1', expected: false },
  { name: '127.0.0.001 leading zeros', host: '127.0.0.001', expected: true },
];

for (const c of ADVERSARIAL_UNIT) {
  test(`L4 checkHostHeader: ${c.name} (${JSON.stringify(c.host)}) → ${c.expected ? 'allow' : 'reject'}`, () => {
    const got = checkHostHeader(c.host, ALLOWED);
    assert.equal(got, c.expected, `checkHostHeader(${JSON.stringify(c.host)}) returned ${got}, expected ${c.expected}`);
  });
}

test('L4 checkHostHeader: multi-value array → reject', () => {
  assert.equal(checkHostHeader(['localhost', 'evil.com'], ALLOWED), false);
});

test('L4 checkHostHeader: Origin undefined → true when optional', () => {
  assert.equal(checkHostHeader(undefined, ALLOWED, true), true);
  assert.equal(checkHostHeader(undefined, ALLOWED, false), false);
});

test('L4 Origin: Origin: null rejected (e2e)', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, {
      method: 'OPTIONS',
      host: '127.0.0.1',
      origin: 'null',
    });
    assert.equal(res.status, 403);
  } finally {
    await stop();
  }
});

test('L4 Origin: mismatched scheme/host rejected (e2e)', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, {
      method: 'OPTIONS',
      host: '127.0.0.1',
      origin: 'http://evil.com',
    });
    assert.equal(res.status, 403);
  } finally {
    await stop();
  }
});

// ── M1 — body size limit + Content-Encoding + Content-Type ─────────────────

test('POST /mcp with 2 MB body → 413', async () => {
  const { stop, base } = await startAndProbe({ maxBodyBytes: 1024 * 1024 });
  try {
    const big = 'a'.repeat(2 * 1024 * 1024);
    const res = await sendRequest(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: big,
    });
    assert.equal(res.status, 413);
  } finally {
    await stop();
  }
});

test('POST /mcp with Content-Length over limit → 413 fast', async () => {
  const { stop, base } = await startAndProbe({ maxBodyBytes: 1024 });
  try {
    const res = await sendRequest(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      body: '{}',
    });
    assert.equal(res.status, 413);
  } finally {
    await stop();
  }
});

test('POST /mcp with Content-Encoding: gzip → 415', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: '{}',
    });
    assert.equal(res.status, 415);
  } finally {
    await stop();
  }
});

test('POST /mcp with text/plain Content-Type → 415', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hi',
    });
    assert.equal(res.status, 415);
  } finally {
    await stop();
  }
});

// ── Bearer auth ────────────────────────────────────────────────────────────

test('Bearer auth: missing token → 401', async () => {
  const { stop, base } = await startAndProbe({ httpToken: 'secret' });
  try {
    const res = await sendRequest(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  } finally {
    await stop();
  }
});

test('Bearer auth: wrong token → 401', async () => {
  const { stop, base } = await startAndProbe({ httpToken: 'secret' });
  try {
    const res = await sendRequest(base, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong',
      },
      body: '{}',
    });
    assert.equal(res.status, 401);
  } finally {
    await stop();
  }
});

// ── /health bypass ─────────────────────────────────────────────────────────

test('/health returns 200 without auth', async () => {
  const { stop, base } = await startAndProbe({ httpToken: 'secret' });
  try {
    const res = await sendRequest(base, { method: 'GET', path: '/health' });
    assert.equal(res.status, 200);
    assert.match(res.body, /"status":"ok"/);
  } finally {
    await stop();
  }
});

// ── End-to-end MCP round-trip (regression: POST must reach the MCP layer) ──

function mcpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...extra,
  };
}

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'transport-test', version: '0.0.0' },
  },
});

test('POST /mcp with valid initialize JSON-RPC reaches the MCP server (200)', async () => {
  const factory = () => createMcpServer({ ...DEFAULT_CONFIG, transport: 'http' }).server;
  const { stop, base } = await startAndProbe({}, factory);
  try {
    const res = await sendRequest(base, {
      method: 'POST',
      headers: mcpHeaders(),
      body: INITIALIZE_BODY,
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.body.slice(0, 200)}`);
    // Stateless default streams the response as SSE; either SSE frames or a
    // plain JSON body carrying the initialize result proves the round trip.
    assert.match(
      res.body,
      /"result"|event: message/,
      `expected initialize result in body, got: ${res.body.slice(0, 300)}`,
    );
    assert.match(res.body, /syntx-ai-mcp/);
  } finally {
    await stop();
  }
});

test('POST /mcp with malformed JSON → 400 parse error', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, {
      method: 'POST',
      headers: mcpHeaders(),
      body: '{not-json',
    });
    assert.equal(res.status, 400);
    assert.match(res.body, /-32700/);
  } finally {
    await stop();
  }
});

test('GET /mcp with a body → 400', async () => {
  const { stop, base } = await startAndProbe();
  try {
    const res = await sendRequest(base, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
      body: 'x',
    });
    assert.equal(res.status, 400);
  } finally {
    await stop();
  }
});

test('GET /mcp (SSE) without bearer → 401 when httpToken is set', async () => {
  const { stop, base } = await startAndProbe({ httpToken: 'secret' });
  try {
    const res = await sendRequest(base, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    });
    assert.equal(res.status, 401);
  } finally {
    await stop();
  }
});

test('POST /mcp with valid bearer reaches the MCP layer', async () => {
  const factory = () => createMcpServer({ ...DEFAULT_CONFIG, transport: 'http' }).server;
  const { stop, base } = await startAndProbe({ httpToken: 'secret' }, factory);
  try {
    const res = await sendRequest(base, {
      method: 'POST',
      headers: mcpHeaders({ authorization: 'Bearer secret' }),
      body: INITIALIZE_BODY,
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.body.slice(0, 200)}`);
  } finally {
    await stop();
  }
});
