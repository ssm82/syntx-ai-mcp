import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appTools } from '../src/mcp/tools/app';
import { settingsTools } from '../src/mcp/tools/settings';
import { allTools } from '../src/mcp/tools';
import { createMcpContext } from '../src/mcp/context';
import type { McpContext } from '../src/mcp/registry';

// ── list-locales (catalog reconciliation item 7, SettingsResource) ────────

test('list-locales MCP tool is registered and exposes optional lang/namespace', () => {
  const tool = settingsTools.find((t) => t.name === 'list-locales');
  assert.ok(tool, 'list-locales tool must be exported from settings.ts');
  const props = tool.inputSchema.properties as Record<string, { type: string }>;
  assert.equal(props.lang.type, 'string');
  assert.equal(props.namespace.type, 'string');
  // No required fields — both args are optional.
  assert.equal(tool.inputSchema.required, undefined);
});

test('list-locales forwards lang + namespace and returns the JSON payload', async () => {
  const calls: Array<{ lang?: string; namespace?: string }> = [];
  const ctx = {
    syntx: {
      settings: {
        getLocales: async (lang?: string, namespace?: string) => {
          calls.push({ lang, namespace });
          return [
            { code: 'en', name: 'English', native_name: 'English', active: true },
            { code: 'ru', name: 'Russian', native_name: 'Русский', active: true },
          ];
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = settingsTools.find((t) => t.name === 'list-locales');
  if (!tool) throw new Error('list-locales tool not found');

  const result = await tool.handler({ lang: 'en', namespace: 'common' }, ctx);
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [{ lang: 'en', namespace: 'common' }]);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  const parsed = JSON.parse(text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].code, 'en');
});

test('list-locales drops empty-string lang/namespace before forwarding', async () => {
  const calls: Array<{ lang?: string; namespace?: string }> = [];
  const ctx = {
    syntx: {
      settings: {
        getLocales: async (lang?: string, namespace?: string) => {
          calls.push({ lang, namespace });
          return [];
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = settingsTools.find((t) => t.name === 'list-locales');
  if (!tool) throw new Error('list-locales tool not found');

  await tool.handler({ lang: '', namespace: '' }, ctx);
  assert.deepEqual(calls, [{ lang: undefined, namespace: undefined }]);
});

// ── get-version (catalog reconciliation item 7, AppResource) ───────────────

test('get-version MCP tool is registered with no required args', () => {
  const tool = appTools.find((t) => t.name === 'get-version');
  assert.ok(tool, 'get-version tool must be exported from app.ts');
  assert.equal(tool.inputSchema.required, undefined);
});

test('get-version returns the JSON payload verbatim', async () => {
  const fixture = { version: '1.2.3', build: 'abc123', deployed_at: '2026-07-22T00:00:00Z' };
  const ctx = {
    syntx: {
      app: {
        getVersion: async () => fixture,
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = appTools.find((t) => t.name === 'get-version');
  if (!tool) throw new Error('get-version tool not found');
  const result = await tool.handler({}, ctx);
  assert.equal(result.isError, undefined);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.deepEqual(JSON.parse(text), fixture);
});

test('get-version surfaces SDK errors via toMcpError', async () => {
  const ctx = {
    syntx: {
      app: {
        getVersion: async () => {
          throw new Error('network down');
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = appTools.find((t) => t.name === 'get-version');
  if (!tool) throw new Error('get-version tool not found');
  const result = await tool.handler({}, ctx);
  assert.equal(result.isError, true);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /^get-version: /);
  assert.match(text, /network down/);
});

// ── get-maintenance-status (catalog reconciliation item 7) ─────────────────

test('get-maintenance-status MCP tool is registered with no required args', () => {
  const tool = appTools.find((t) => t.name === 'get-maintenance-status');
  assert.ok(tool, 'get-maintenance-status tool must be exported from app.ts');
  assert.equal(tool.inputSchema.required, undefined);
});

test('get-maintenance-status returns the JSON payload verbatim', async () => {
  const fixture = { maintenance: false, message: '' };
  const ctx = {
    syntx: {
      app: {
        getMaintenanceStatus: async () => fixture,
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = appTools.find((t) => t.name === 'get-maintenance-status');
  if (!tool) throw new Error('get-maintenance-status tool not found');
  const result = await tool.handler({}, ctx);
  assert.equal(result.isError, undefined);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.deepEqual(JSON.parse(text), fixture);
});

// ── Central registry wiring ────────────────────────────────────────────────

test('allTools includes the new list-locales, get-version and get-maintenance-status tools', () => {
  const names = new Set(allTools.map((t) => t.name));
  assert.ok(names.has('list-locales'), 'allTools must include list-locales');
  assert.ok(names.has('get-version'), 'allTools must include get-version');
  assert.ok(names.has('get-maintenance-status'), 'allTools must include get-maintenance-status');
});

test('createMcpContext exposes settings and app resources for the new tools', () => {
  const ctx = createMcpContext({
    baseURL: 'http://localhost',
    timeout: 5000,
    pollTimeout: 5000,
    pollInterval: 100,
    defaultAI: 'chatgpt',
    defaultModel: undefined,
    streamMode: 'poll',
  } as Parameters<typeof createMcpContext>[0]);
  assert.equal(typeof ctx.syntx.settings.getLocales, 'function');
  assert.equal(typeof ctx.syntx.app.getVersion, 'function');
  assert.equal(typeof ctx.syntx.app.getMaintenanceStatus, 'function');
});