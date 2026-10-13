import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { SyntxClient } from '../src/syntx-client';

/**
 * 2026-10-13 drift sweep — Tier 1 endpoints and the three Tier 2 shape
 * fixes. Each test stands up a tiny mock server, exercises the SDK
 * method, and asserts the wire shape and URL.
 */

function serve(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => void,
  opts?: { onRequest?: (url: URL) => void },
): Promise<{ baseURL: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', `http://127.0.0.1`);
    opts?.onRequest?.(u);
    handler(req, res, u);
  });
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

// ─── Tier 1 — read-only additions ─────────────────────────────────────────

test('chats.getGeneratedFiles sends scope[]=image&scope[]=video&scope[]=audio by default', async () => {
  let captured: URL | null = null;
  const s = await serve(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          items: [
            { id: 'img-1', url: 'https://cdn/x.png', scope: 'image', created_at: '2026-10-13T00:00:00Z' },
            { id: 'vid-1', url: 'https://cdn/x.mp4', scope: 'video', created_at: '2026-10-12T00:00:00Z' },
          ],
          page: 1,
          page_size: 20,
          total: 2,
          has_more: false,
        }),
      );
    },
    { onRequest: (u) => (captured = u) },
  );
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.chats.getGeneratedFiles();
    assert.equal(out.items.length, 2);
    assert.equal(out.items[0].scope, 'image');
    assert.equal(out.has_more, false);
    assert.ok(captured, 'request URL was not captured');
    assert.equal(captured.searchParams.getAll('scope[]').join(','), 'image,video,audio');
    assert.equal(captured.searchParams.get('page'), '1');
    assert.equal(captured.searchParams.get('page_size'), '20');
  } finally {
    await s.close();
  }
});

test('chats.getGeneratedFiles accepts a subset of scopes', async () => {
  let captured: URL | null = null;
  const s = await serve(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: [], page: 1, page_size: 5, total: 0, has_more: false }));
    },
    { onRequest: (u) => (captured = u) },
  );
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    await client.chats.getGeneratedFiles(['audio'], 1, 5);
    assert.equal(captured!.searchParams.getAll('scope[]').join(','), 'audio');
    assert.equal(captured!.searchParams.get('page_size'), '5');
  } finally {
    await s.close();
  }
});

test('user.getTokensHistory forwards cursor and page_size', async () => {
  let captured: URL | null = null;
  const s = await serve(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          items: [
            {
              id: 'txn-1',
              amount: -42,
              type: 'image_generation',
              description: 'flux call',
              created_at: '2026-10-13T00:00:00Z',
            },
          ],
          page: 2,
          page_size: 5,
          total: 17,
          next_cursor: 'cur-3',
        }),
      );
    },
    { onRequest: (u) => (captured = u) },
  );
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.user.getTokensHistory({ cursor: 'cur-2', page_size: 5 });
    assert.equal(out.items[0].amount, -42);
    assert.equal(out.next_cursor, 'cur-3');
    assert.equal(captured!.searchParams.get('cursor'), 'cur-2');
    assert.equal(captured!.searchParams.get('page_size'), '5');
  } finally {
    await s.close();
  }
});

test('plans.listTariffs defaults to monthly', async () => {
  let captured: URL | null = null;
  const s = await serve(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 'free', period: 'monthly', price: 0, currency: 'USD' }]));
    },
    { onRequest: (u) => (captured = u) },
  );
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.plans.listTariffs();
    assert.equal(out[0].id, 'free');
    assert.equal(captured!.searchParams.get('period'), 'monthly');
  } finally {
    await s.close();
  }
});

test('plans.listTariffs accepts annual', async () => {
  let captured: URL | null = null;
  const s = await serve(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[]');
    },
    { onRequest: (u) => (captured = u) },
  );
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    await client.plans.listTariffs('annual');
    assert.equal(captured!.searchParams.get('period'), 'annual');
  } finally {
    await s.close();
  }
});

test('tokensPricing.list returns the {items:[…]} envelope', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        items: [
          { id: 'gpt-6.1-sol', cost: 12 },
          { id: 'flux-1.1-pro', cost: 5 },
        ],
      }),
    );
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.tokensPricing.list();
    assert.equal(out.items.length, 2);
    assert.equal(out.items[0].cost, 12);
  } finally {
    await s.close();
  }
});

test('trends.categories / .tags work', async () => {
  let mode: 'cat' | 'tag' = 'cat';
  const s = await serve((_req, res, u) => {
    mode = u.pathname.endsWith('/tags') ? 'tag' : 'cat';
    res.writeHead(200, { 'content-type': 'application/json' });
    if (mode === 'cat') {
      res.end(JSON.stringify({ categories: [{ slug: 'art', name: 'Art' }] }));
    } else {
      res.end(JSON.stringify({ tags: [{ name: 'cinematic' }] }));
    }
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const cats = await client.trends.categories();
    const tags = await client.trends.tags();
    assert.equal(cats.categories[0].slug, 'art');
    assert.equal(tags.tags[0].name, 'cinematic');
  } finally {
    await s.close();
  }
});

test('events.list paginates', async () => {
  let captured: URL | null = null;
  const s = await serve(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          items: [{ id: 'e-1', title: 'New feature', created_at: '2026-10-13T00:00:00Z' }],
          total: 1,
          page: 3,
          page_size: 5,
        }),
      );
    },
    { onRequest: (u) => (captured = u) },
  );
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.events.list(3, 5);
    assert.equal(out.items[0].id, 'e-1');
    assert.equal(captured!.searchParams.get('page'), '3');
    assert.equal(captured!.searchParams.get('page_size'), '5');
  } finally {
    await s.close();
  }
});

// ─── prompt-enhancer (captcha-gated) ──────────────────────────────────────

test('promptEnhancer.getCost forwards model_type', async () => {
  let captured: URL | null = null;
  const s = await serve(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model_type: 'gpt-6.1-sol', cost: 8, enhanceable: true }));
    },
    { onRequest: (u) => (captured = u) },
  );
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.promptEnhancer.getCost('gpt-6.1-sol');
    assert.equal(out.cost, 8);
    assert.equal(captured!.searchParams.get('model_type'), 'gpt-6.1-sol');
  } finally {
    await s.close();
  }
});

test('promptEnhancer.start posts the verbatim body', async () => {
  let capturedBody = '';
  const s = await serve((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      capturedBody = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ task_id: 'task-42' }));
    });
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.promptEnhancer.start({
      prompt: 'Write a haiku about Rust',
      model_type: 'gpt-6.1-sol',
    });
    assert.equal(out.task_id, 'task-42');
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.prompt, 'Write a haiku about Rust');
    assert.equal(parsed.model_type, 'gpt-6.1-sol');
  } finally {
    await s.close();
  }
});

test('promptEnhancer.getTask URL-encodes the id and returns the envelope', async () => {
  let captured: URL | null = null;
  const s = await serve(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ id: 'task/with-slash', status: 'completed', enhanced_prompt: 'A haiku' }),
      );
    },
    { onRequest: (u) => (captured = u) },
  );
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.promptEnhancer.getTask('task/with-slash');
    assert.equal(out.status, 'completed');
    assert.equal(out.enhanced_prompt, 'A haiku');
    assert.equal(captured!.pathname, '/api/v1/prompt-enhancer/tasks/task%2Fwith-slash');
  } finally {
    await s.close();
  }
});

// ─── Tier 2 — shape fixes ─────────────────────────────────────────────────

test('folders.listTextFolders returns the {folders, pagination} envelope (was Folder[])', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        folders: [
          {
            uuid: 'p-1',
            title: 'Demo',
            scope: 'text',
            color: '#9C9C9C',
            sort_order: 0,
            chat_count: 0,
            chats: [],
            created_at: '2026-10-13T00:00:00Z',
            updated_at: '2026-10-13T00:00:00Z',
          },
        ],
        pagination: { total: 1, page: 1, page_size: 10, has_more: false },
      }),
    );
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.folders.listTextFolders();
    assert.equal(out.folders[0].uuid, 'p-1');
    assert.equal(out.folders[0].title, 'Demo');
    assert.equal(out.pagination.total, 1);
  } finally {
    await s.close();
  }
});

test('folders.listImage/Video/Audio all return the envelope', async () => {
  const s = await serve((_req, res, u) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ folders: [], pagination: { total: 0, page: 1, page_size: 10, has_more: false } }));
    void u;
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    for (const out of await Promise.all([
      client.folders.listImageFolders(),
      client.folders.listVideoFolders(),
      client.folders.listAudioFolders(),
    ])) {
      assert.ok(Array.isArray(out.folders));
      assert.ok(out.pagination);
    }
  } finally {
    await s.close();
  }
});

test('notifications.getUnreadCount reads {total:number} (was {count:number})', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ total: 6 }));
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.notifications.getUnreadCount();
    assert.equal(out.total, 6);
  } finally {
    await s.close();
  }
});

test('plans.getPromoBanners returns the {header, landing} envelope (was PromoBanner[])', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        header: [
          {
            uuid: 'b-1',
            body: 'Welcome',
            buttons: [{ label: 'Get started', url: 'https://syntx.ai/start' }],
            open_in_new_tab: true,
            order: 0,
            updated_at: '2026-10-13T00:00:00Z',
          },
        ],
        landing: [],
      }),
    );
  });
  try {
    const client = new SyntxClient({ baseURL: s.baseURL, token: 't' });
    const out = await client.plans.getPromoBanners();
    assert.equal(out.header[0].uuid, 'b-1');
    assert.equal(out.header[0].body, 'Welcome');
    assert.equal(out.landing.length, 0);
  } finally {
    await s.close();
  }
});
