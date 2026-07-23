import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NotificationsResource } from '../src/resources/notifications';
import type { BaseClient } from '../src/client';
import { notificationsTools } from '../src/mcp/tools/notifications';
import { allTools } from '../src/mcp/tools';
import type { McpContext } from '../src/mcp/registry';

// ── NotificationsResource.markAsRead (SDK) ─────────────────────────────────

function capturePatch() {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const client = {
    async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
      calls.push({ path, body });
      return undefined as T;
    },
  };
  return { client, calls };
}

test('markAsRead hits the SPA-observed notification/mark/global/{id} path (NOT the 404 path)', async () => {
  const { client, calls } = capturePatch();
  await new NotificationsResource(client as unknown as BaseClient).markAsRead('42');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/notification/mark/global/42');
});

test('markAsRead URL-encodes the id segment', async () => {
  const { client, calls } = capturePatch();
  await new NotificationsResource(client as unknown as BaseClient).markAsRead('a/b c');
  assert.equal(calls[0].path, '/api/v1/notification/mark/global/a%2Fb%20c');
});

// ── NotificationsResource.markAll (SDK) ────────────────────────────────────

test('markAll hits /api/v1/notification/mark/all with no body', async () => {
  const { client, calls } = capturePatch();
  await new NotificationsResource(client as unknown as BaseClient).markAll();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/notification/mark/all');
  assert.equal(calls[0].body, undefined);
});

// ── mark-all-notifications-read MCP tool ───────────────────────────────────

test('mark-all-notifications-read MCP tool is registered in notificationsTools + allTools', () => {
  const tool = notificationsTools.find((t) => t.name === 'mark-all-notifications-read');
  assert.ok(tool, 'mark-all-notifications-read must be exported from notifications.ts');
  assert.equal(tool.capability.networkCall, true);
  assert.ok(allTools.some((t) => t.name === 'mark-all-notifications-read'));
});

test('mark-all-notifications-read MCP tool takes no arguments', () => {
  const tool = notificationsTools.find((t) => t.name === 'mark-all-notifications-read');
  if (!tool) throw new Error('mark-all-notifications-read tool not found');
  assert.equal(tool.inputSchema.required, undefined);
  assert.deepEqual(tool.inputSchema.properties, {});
});

test('mark-all-notifications-read calls SDK markAll and returns success text', async () => {
  const calls: string[] = [];
  const ctx = {
    syntx: {
      notifications: {
        markAll: async () => {
          calls.push('markAll');
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = notificationsTools.find((t) => t.name === 'mark-all-notifications-read');
  if (!tool) throw new Error('mark-all-notifications-read tool not found');
  const result = await tool.handler({}, ctx);
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, ['markAll']);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /Marked all notifications as read/);
});

test('mark-all-notifications-read surfaces SDK errors via toMcpError', async () => {
  const ctx = {
    syntx: {
      notifications: {
        markAll: async () => {
          throw new Error('auth expired');
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = notificationsTools.find((t) => t.name === 'mark-all-notifications-read');
  if (!tool) throw new Error('mark-all-notifications-read tool not found');
  const result = await tool.handler({}, ctx);
  assert.equal(result.isError, true);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /^mark-all-notifications-read: /);
  assert.match(text, /auth expired/);
});

// ── mark-notification-read: existing tool still works on the new SDK path ──

test('mark-notification-read MCP tool forwards to SDK markAsRead (new SPA path)', async () => {
  const calls: Array<{ id: string }> = [];
  const ctx = {
    syntx: {
      notifications: {
        markAsRead: async (id: string) => {
          calls.push({ id });
        },
      },
    },
    config: {},
  } as unknown as McpContext;
  const tool = notificationsTools.find((t) => t.name === 'mark-notification-read');
  if (!tool) throw new Error('mark-notification-read tool not found');
  const result = await tool.handler({ id: 'abc-123' }, ctx);
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [{ id: 'abc-123' }]);
});