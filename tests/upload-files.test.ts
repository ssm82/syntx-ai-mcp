import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  assertPathSourceAllowed,
  resolveAllowedRoots,
  resolveSafePath,
} from '../src/mcp/tools/file-input';
import { chatsTools } from '../src/mcp/tools/chats';
import type { McpContext } from '../src/mcp/registry';
import { ChatsResource } from '../src/resources/chats';
import type { BaseClient } from '../src/client';

function makeFile(dir: string, name = 'fixture.txt', body = 'hello'): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
}

test('resolveAllowedRoots defaults to process.cwd() (never os.tmpdir())', () => {
  // Unset MCP_FILE_ROOTS for this test to make the default path deterministic.
  const previous = process.env.MCP_FILE_ROOTS;
  delete process.env.MCP_FILE_ROOTS;
  try {
    const cfg = resolveAllowedRoots();
    assert.equal(cfg.source, 'default');
    assert.equal(cfg.roots.length, 1);
    assert.notEqual(cfg.roots[0], os.tmpdir(), 'must never include os.tmpdir()');
    assert.equal(fs.realpathSync(cfg.roots[0]), fs.realpathSync(process.cwd()));
  } finally {
    if (previous !== undefined) process.env.MCP_FILE_ROOTS = previous;
  }
});

test('resolveAllowedRoots honours MCP_FILE_ROOTS env var', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntx-mcp-test-'));
  const previous = process.env.MCP_FILE_ROOTS;
  process.env.MCP_FILE_ROOTS = dir;
  try {
    const cfg = resolveAllowedRoots();
    assert.equal(cfg.source, 'env');
    assert.equal(cfg.roots.length, 1);
    assert.equal(cfg.roots[0], fs.realpathSync(dir));
  } finally {
    if (previous !== undefined) process.env.MCP_FILE_ROOTS = previous;
    else delete process.env.MCP_FILE_ROOTS;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('assertPathSourceAllowed: rejects path over HTTP, allows on stdio', () => {
  assert.doesNotThrow(() => assertPathSourceAllowed('path', 'stdio'));
  assert.throws(
    () => assertPathSourceAllowed('path', 'http'),
    /not permitted over the http transport/i,
  );
  // base64 is always allowed.
  assert.doesNotThrow(() => assertPathSourceAllowed('base64', 'http'));
  assert.doesNotThrow(() => assertPathSourceAllowed('base64', 'stdio'));
});

test('resolveSafePath: regular file inside root resolves and passes', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'syntx-mcp-safe-')));
  try {
    const f = makeFile(dir);
    const resolved = resolveSafePath(f, [dir]);
    assert.equal(resolved, fs.realpathSync(f));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveSafePath: rejects paths outside the allow-list', () => {
  const inside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'syntx-mcp-inside-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'syntx-mcp-outside-')));
  try {
    const outsideFile = makeFile(outside);
    assert.throws(
      () => resolveSafePath(outsideFile, [inside]),
      /outside of allowed roots/i,
    );
  } finally {
    fs.rmSync(inside, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('resolveSafePath: rejects /etc/passwd even when included literally', () => {
  // Either "not found" (file absent) or "outside of allowed roots" is the
  // expected outcome — what we explicitly reject is a successful read.
  assert.throws(
    () => resolveSafePath('/etc/passwd', [process.cwd()]),
    /not found|not readable|outside of allowed roots/i,
  );
});

test('resolveSafePath: rejects FIFOs (anti-special-file)', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'syntx-mcp-fifo-')));
  try {
    const fifo = path.join(dir, 'pipe');
    try {
      fs.mkfifoSync(fifo);
    } catch {
      // Some CI envs (Windows) cannot mkfifo — skip the assertion.
      return;
    }
    assert.throws(() => resolveSafePath(fifo, [dir]), /not a regular file|FIFO|special/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveSafePath: rejects symlink that escapes the allow-list', () => {
  const inside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'syntx-mcp-sym-in-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'syntx-mcp-sym-out-')));
  try {
    const realFile = makeFile(outside, 'secret.txt');
    const link = path.join(inside, 'link.txt');
    try {
      fs.symlinkSync(realFile, link);
    } catch {
      // Symlink permission may not be available in some CI envs.
      return;
    }
    assert.throws(() => resolveSafePath(link, [inside]), /outside of allowed roots/i);
  } finally {
    fs.rmSync(inside, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('send-message exposes uploaded-file attachments in its input schema', () => {
  const tool = chatsTools.find((candidate) => candidate.name === 'send-message');
  assert.ok(tool);
  assert.ok('attachments' in tool.inputSchema.properties);
  const attachmentSchema = tool.inputSchema.properties.attachments as {
    items: { properties: Record<string, unknown> };
  };
  assert.ok('size' in attachmentSchema.items.properties);
});

test('send-message forwards uploaded files as attachment message objects', async () => {
  const calls: unknown[][] = [];
  const ctx = {
    syntx: {
      chats: {
        sendMessage: async (...args: unknown[]) => {
          calls.push(args);
        },
      },
    },
    config: {
      defaultAI: 'chatgpt',
      defaultModel: 'gpt-5.5',
    },
  } as unknown as McpContext;
  const tool = chatsTools.find((candidate) => candidate.name === 'send-message');
  assert.ok(tool);

  const result = await tool.handler(
    {
      chat_id: 'chat-1',
      prompt: 'Describe the attachment',
      attachments: [
        {
          url: 'https://r2.syntx.ai/uploaded/diagram.png',
          filename: 'diagram.png',
          mime_type: 'image/png',
        },
      ],
    },
    ctx,
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [
    [
      'chat-1',
      'chatgpt',
      [
        {
          object_type: 'text',
          object_url: null,
          object_text: 'Describe the attachment',
          model_type: 'gpt-5.5',
        },
        {
          object_type: 'image',
          object_url: 'https://r2.syntx.ai/uploaded/diagram.png',
          object_text: 'diagram.png',
          model_type: 'gpt-5.5',
        },
      ],
    ],
  ]);
});

// ── uploadFiles: model_type form field (catalog reconciliation item 3) ─────

function capturePostForm() {
  const calls: Array<{ path: string; form: FormData }> = [];
  const client = {
    async postForm<T>(path: string, form: FormData): Promise<T> {
      calls.push({ path, form });
      return { data: { files: [] } } as T;
    },
  };
  return { client, calls };
}

function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

test('uploadFiles appends an empty model_type when none is provided', async () => {
  const { client, calls } = capturePostForm();
  await new ChatsResource(client as unknown as BaseClient).uploadFiles([
    { buffer: new Uint8Array([1, 2, 3]), filename: 'a.bin' },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/chats/upload-files');
  assert.equal(formToObject(calls[0].form).model_type, '');
  assert.equal(formToObject(calls[0].form).check_duplicates, 'true');
});

test('uploadFiles appends the provided model_type verbatim', async () => {
  const { client, calls } = capturePostForm();
  await new ChatsResource(client as unknown as BaseClient).uploadFiles(
    [{ buffer: new Uint8Array([1, 2, 3]), filename: 'a.bin' }],
    undefined,
    true,
    'gpt-5-mini',
  );
  assert.equal(formToObject(calls[0].form).model_type, 'gpt-5-mini');
});

test('upload-files MCP tool falls back to defaultModel when model_type is omitted', async () => {
  const calls: Array<{ path: string; form: FormData }> = [];
  const ctx = {
    syntx: {
      chats: {
        uploadFiles: async (
          _files: unknown,
          _destination: unknown,
          _checkDuplicates: unknown,
          modelType?: string,
        ) => {
          calls.push({
            path: '/api/v1/chats/upload-files',
            form: new FormData(),
          });
          calls[calls.length - 1].form.append('model_type', modelType ?? '');
          return { files: [] };
        },
      },
    },
    config: { defaultModel: 'gpt-5-mini', transport: 'stdio' },
  } as unknown as McpContext;
  const { filesTools } = await import('../src/mcp/tools/files');
  const tool = filesTools.find((t) => t.name === 'upload-files');
  if (!tool) throw new Error('upload-files tool not found');

  await tool.handler(
    {
      files: [{ content_base64: Buffer.from('x').toString('base64'), filename: 'x.txt' }],
    },
    ctx,
  );
  assert.equal(calls.length, 1);
  assert.equal(formToObject(calls[0].form).model_type, 'gpt-5-mini');
});

test('upload-files MCP tool uses explicit model_type over defaultModel', async () => {
  const calls: Array<{ form: FormData }> = [];
  const ctx = {
    syntx: {
      chats: {
        uploadFiles: async (
          _files: unknown,
          _destination: unknown,
          _checkDuplicates: unknown,
          modelType?: string,
        ) => {
          calls.push({ form: new FormData() });
          calls[calls.length - 1].form.append('model_type', modelType ?? '');
          return { files: [] };
        },
      },
    },
    config: { defaultModel: 'gpt-5-mini', transport: 'stdio' },
  } as unknown as McpContext;
  const { filesTools } = await import('../src/mcp/tools/files');
  const tool = filesTools.find((t) => t.name === 'upload-files');
  if (!tool) throw new Error('upload-files tool not found');

  await tool.handler(
    {
      files: [{ content_base64: Buffer.from('x').toString('base64'), filename: 'x.txt' }],
      model_type: 'claude-sonnet-4',
    },
    ctx,
  );
  assert.equal(formToObject(calls[0].form).model_type, 'claude-sonnet-4');
});
