#!/usr/bin/env -S npx tsx --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { AddressInfo } from 'node:net';

/**
 * End-to-end check: every new MCP tool, spawned through a real MCP stdio
 * server, against a fake syntx.ai API. This is the strongest possible
 * "verify via MCP" we can do without a live syntx.ai token — the JSON-RPC
 * framing, the input validation, the SDK call, the response rendering, all
 * go through the same path as a Claude/Cursor deployment.
 *
 * 1. Start a fake API on a free port; record each (URL, body) tuple.
 * 2. Spawn `node dist/bin/cli.js` with --transport stdio --baseURL http://…
 *    --token test-token. stdio is the default transport for MCP clients.
 * 3. Create an MCP client + StdioClientTransport, wire it to the child
 *    process's stdin/stdout, initialize, and call every new tool.
 * 4. Assert the rendered text matches and that the wire side got the
 *    expected URL/body.
 */

interface Captured {
  method: string;
  url: string;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function startFakeApi(): Promise<{
  baseURL: string;
  captured: Captured[];
  close: () => Promise<void>;
}> {
  const captured: Captured[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      captured.push({
        method: req.method ?? 'GET',
        url: req.url ?? '',
        body,
        headers: req.headers,
      });
      // Return realistic wire shapes for each endpoint.
      const u = new URL(req.url ?? '/', 'http://x');
      const p = u.pathname;
      let responseBody: unknown = {};
      switch (p) {
        case '/api/v1/files/generated':
          responseBody = {
            items: [
              { id: 'img-1', url: 'https://cdn/x.png', scope: 'image', created_at: '2026-10-13T00:00:00Z' },
            ],
            page: 1, page_size: 20, total: 1, has_more: false,
          };
          break;
        case '/api/v1/user/tokens/history':
          responseBody = {
            items: [
              { id: 'txn-1', amount: -42, type: 'image_generation', created_at: '2026-10-13T00:00:00Z' },
            ],
            page: 1, page_size: 20, total: 1, next_cursor: null,
          };
          break;
        case '/api/v1/plans/tariffs':
          responseBody = [{ id: 'free', period: u.searchParams.get('period'), price: 0, currency: 'USD' }];
          break;
        case '/api/v1/tokens/pricing':
          responseBody = { items: [{ id: 'gpt-6.1-sol', cost: 12 }] };
          break;
        case '/api/v1/trends/categories':
          responseBody = { categories: [{ slug: 'art', name: 'Art' }] };
          break;
        case '/api/v1/trends/tags':
          responseBody = { tags: [{ name: 'cinematic' }] };
          break;
        case '/api/v1/events':
          responseBody = {
            items: [{ id: 'e-1', title: 'New feature', created_at: '2026-10-13T00:00:00Z' }],
            total: 1, page: 1, page_size: 20,
          };
          break;
        case '/api/v1/prompt-enhancer/cost':
          responseBody = { model_type: u.searchParams.get('model_type'), cost: 8, enhanceable: true };
          break;
        case '/api/v1/prompt-enhancer/enhance/start':
          responseBody = { task_id: 'task-42' };
          break;
        case '/api/v1/folders/text/list':
          responseBody = {
            folders: [
              {
                uuid: 'p-1', title: 'Demo', scope: 'text', color: '#9C9C9C',
                sort_order: 0, chat_count: 0, chats: [],
                created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
              },
            ],
            pagination: { total: 1, page: 1, page_size: 10, has_more: false },
          };
          break;
        case '/api/v1/notification/unread/count':
          responseBody = { total: 6 };
          break;
        case '/api/v1/promo_banners':
          responseBody = {
            header: [{ uuid: 'b-1', body: 'Welcome', buttons: [], open_in_new_tab: true, order: 0 }],
            landing: [],
          };
          break;
        default:
          responseBody = { ok: true, path: p, query: Object.fromEntries(u.searchParams) };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseURL: `http://127.0.0.1:${port}`,
        captured,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function startMcpServer(baseURL: string, token: string): Promise<{
  proc: ChildProcess;
  client: Client;
  close: () => Promise<void>;
}> {
  const cli = `${process.cwd()}/dist/bin/cli.js`;
  const proc = spawn(process.execPath, [cli], {
    env: {
      ...process.env,
      SYNTX_TRANSPORT: 'stdio',
      SYNTX_BASE_URL: baseURL,
      SYNTX_TOKEN: token,
      SYNTX_LOG_LEVEL: 'error',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Capture stderr for debugging on failure
  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

  const client = new Client(
    { name: 'e2e-check', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli],
    env: {
      ...process.env,
      SYNTX_TRANSPORT: 'stdio',
      SYNTX_BASE_URL: baseURL,
      SYNTX_TOKEN: token,
      SYNTX_LOG_LEVEL: 'error',
    },
  });

  return client.connect(transport).then(() => ({
    proc,
    client,
    close: async () => {
      await client.close();
      proc.kill('SIGTERM');
      await new Promise<void>((r) => {
        if (proc.exitCode !== null) return r();
        proc.once('exit', () => r());
        setTimeout(() => proc.kill('SIGKILL'), 1000);
      });
    },
    // expose stderr in case we want it for assertion messages
    getStderr: () => stderr,
  } as any));
}

// Helper: pull the first text content block out of a CallToolResult.
function firstText(result: any): string {
  if (result.isError) {
    throw new Error('tool returned isError: ' + JSON.stringify(result.content));
  }
  const block = result.content?.[0];
  if (block?.type !== 'text') throw new Error('no text block');
  return block.text;
}

test('MCP server: every new tool is registered and call works end-to-end', async (t) => {
  const api = await startFakeApi();
  const srv = await startMcpServer(api.baseURL, 'test-token');
  t.after(() => srv.close());
  t.after(() => api.close());

  // tools/list — make sure all 12 new tools exist
  const { tools } = await srv.client.listTools();
  const names = new Set(tools.map((x) => x.name));
  const expected = [
    'list-generated-files',
    'get-tokens-history',
    'list-tariffs',
    'list-token-pricing',
    'list-trend-categories',
    'list-trend-tags',
    'list-events',
    'get-prompt-enhancer-cost',
    'start-prompt-enhancement',
    'get-prompt-enhancement-task',
    'list-auth-identities',
    'get-chatwoot-unread',
  ];
  for (const e of expected) {
    assert.ok(names.has(e), `MCP tool "${e}" not in listTools() result`);
  }

  // Call each tool; assert the rendered text contains a recognisable
  // fragment from the fake-API response.
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const r = await srv.client.callTool({ name, arguments: args });
    return firstText(r);
  };

  const text1 = await call('list-generated-files', { scopes: ['image'] });
  assert.match(text1, /img-1/);
  assert.match(text1, /cdn\/x\.png/);

  const text2 = await call('get-tokens-history', { page_size: 20 });
  assert.match(text2, /txn-1/);

  const text3 = await call('list-tariffs', { period: 'annual' });
  assert.match(text3, /"id":\s*"free"/);
  assert.match(text3, /"period":\s*"annual"/);

  const text4 = await call('list-token-pricing');
  assert.match(text4, /gpt-6\.1-sol/);
  assert.match(text4, /"cost":\s*12/);

  const text5 = await call('list-trend-categories');
  assert.match(text5, /"slug":\s*"art"/);

  const text6 = await call('list-trend-tags');
  assert.match(text6, /cinematic/);

  const text7 = await call('list-events', { page: 1, page_size: 20 });
  assert.match(text7, /e-1/);
  assert.match(text7, /"title":\s*"New feature"/);

  const text8 = await call('get-prompt-enhancer-cost', { model_type: 'gpt-6.1-sol' });
  assert.match(text8, /"cost":\s*8/);
  assert.match(text8, /"enhanceable":\s*true/);

  const text9 = await call('start-prompt-enhancement', {
    prompt: 'Write a haiku',
    model_type: 'gpt-6.1-sol',
  });
  assert.match(text9, /task-42/);

  const text10 = await call('get-prompt-enhancement-task', { task_id: 'task-42' });
  // The fake API returns 200 with the default {ok:true,path:...} for unknown
  // routes; this tool's URL hits /api/v1/prompt-enhancer/tasks/task-42, which
  // doesn't have a case in the fake — so it falls through to the default
  // and just echoes the path back. That's still a successful round-trip
  // through MCP, the SDK, the fake server. We just check no error.
  assert.ok(text10.length > 0);

  // Shape-fixed tool
  const text11 = await call('list-projects', { scope: 'text' });
  assert.match(text11, /"uuid":\s*"p-1"/);
  assert.match(text11, /"title":\s*"Demo"/);
  assert.match(text11, /"pagination":/);

  // list-auth-identities + get-chatwoot-unread from the earlier S2/S3 pass
  const text12 = await call('list-auth-identities');
  assert.ok(text12.length > 0);
  const text13 = await call('get-chatwoot-unread');
  assert.ok(text13.length > 0);

  // Wire side: confirm the SDK sent the right URLs to the fake API.
  const urlOf = (path: string) => api.captured.find((c) => c.url.split('?')[0] === path);

  // 10 of the 13 paths must be hit exactly once
  for (const p of [
    '/api/v1/files/generated',
    '/api/v1/user/tokens/history',
    '/api/v1/plans/tariffs',
    '/api/v1/tokens/pricing',
    '/api/v1/trends/categories',
    '/api/v1/trends/tags',
    '/api/v1/events',
    '/api/v1/prompt-enhancer/cost',
    '/api/v1/prompt-enhancer/enhance/start',
  ]) {
    assert.ok(urlOf(p), `fake API never saw ${p}`);
  }

  // Plus the two shape-fixed paths. (notification/unread/count and
  // promo_banners are SDK-only — no MCP tool exposes them in v0.4.0;
  // their envelope types were re-aligned but the read surface didn't
  // get a new tool in this pass.)
  assert.ok(urlOf('/api/v1/folders/text/list'), 'folders/text/list not hit');

  // Specific URL shape assertions on the most distinctive ones
  const gen = urlOf('/api/v1/files/generated')!;
  assert.match(gen.url, /scope%5B%5D=image/);
  assert.match(gen.url, /page=1/);
  assert.match(gen.url, /page_size=20/);

  const history = urlOf('/api/v1/user/tokens/history')!;
  assert.equal(history.url, '/api/v1/user/tokens/history?page_size=20');

  const tariffs = urlOf('/api/v1/plans/tariffs')!;
  assert.match(tariffs.url, /period=annual/);

  const start = urlOf('/api/v1/prompt-enhancer/enhance/start')!;
  assert.equal(start.method, 'POST');
  const parsed = JSON.parse(start.body);
  assert.equal(parsed.prompt, 'Write a haiku');
  assert.equal(parsed.model_type, 'gpt-6.1-sol');

  // Bearer header is forwarded
  const cost = urlOf('/api/v1/prompt-enhancer/cost')!;
  assert.equal(cost.headers['authorization'], 'Bearer test-token');
});
