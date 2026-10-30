import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AgentsResource } from '../src/resources/agents';
import { LlmResource } from '../src/resources/llm';
import { allTools } from '../src/mcp/tools';
import type { McpContext } from '../src/mcp/registry';
import type { BaseClient } from '../src/client';

/**
 * Drift coverage for the 2026-10-30 sweep (prod-SPA bundle `1793202992`).
 *
 * The `agents/*` namespace is a **new upstream surface** — it did not exist
 * in the 2026-10-13 catalog. These tests pin the wire contract that was
 * extracted from the prod-SPA `ai-agent` Pinia store and confirmed against
 * the live API.
 */

interface CapturedCall {
  method: string;
  path: string;
  body?: unknown;
}

function mockClient(responder: (call: CapturedCall) => unknown) {
  const calls: CapturedCall[] = [];
  const record = async (method: string, path: string, body?: unknown) => {
    const call: CapturedCall = { method, path, body };
    calls.push(call);
    return responder(call);
  };
  const client = {
    get: (path: string) => record('GET', path),
    post: (path: string, body?: unknown) => record('POST', path, body),
    postForm: (path: string, formData: FormData) => record('POST', path, formData),
    put: (path: string, body?: unknown) => record('PUT', path, body),
    patch: (path: string, body?: unknown) => record('PATCH', path, body),
    delete: (path: string, body?: unknown) => record('DELETE', path, body),
  } as unknown as BaseClient;
  return { client, calls };
}

function tool(name: string) {
  const found = allTools.find((t) => t.name === name);
  assert.ok(found, `tool not registered: ${name}`);
  return found;
}

test('agents.list hits GET /api/v1/agents/list and returns the quota envelope', async () => {
  const { client, calls } = mockClient(() => ({
    agents: [
      {
        name: 'Helper',
        description: 'desc',
        agent_id: '8259dba7-5432-4e2c-beb3-2dc11def1ea9',
        editable: false,
        status: 'ready',
      },
    ],
    agent_limit: 2,
    agent_count: 1,
    can_create_more: true,
  }));

  const out = await new AgentsResource(client).list();

  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].path, '/api/v1/agents/list');
  assert.equal(out.agents.length, 1);
  assert.equal(out.agent_limit, 2);
  assert.equal(out.agent_count, 1);
  assert.equal(out.can_create_more, true);
});

test('agents.get encodes the agent id in the path', async () => {
  const { client, calls } = mockClient(() => ({ id: 15, uuid: 'a b' }));

  await new AgentsResource(client).get('a b');

  assert.equal(calls[0].path, '/api/v1/agents/info/a%20b');
});

test('agents.listFiles accepts both the bare array and the {files} envelope', async () => {
  const bare = mockClient(() => [{ id: 'f1' }]);
  assert.deepEqual(await new AgentsResource(bare.client).listFiles('x'), [{ id: 'f1' }]);

  const enveloped = mockClient(() => ({ files: [{ id: 'f2' }] }));
  assert.deepEqual(await new AgentsResource(enveloped.client).listFiles('x'), [{ id: 'f2' }]);
});

test('agents.create sends multipart/form-data and JSON-stringifies nested objects', async () => {
  const { client, calls } = mockClient(() => ({ ok: true }));

  await new AgentsResource(client).create({
    name: 'My agent',
    system_prompt: 'be nice',
    model_name: 'gpt-4.1',
    enabled_tools: { web_search: true },
    default_models: { image: 'gpt-image-1' },
  });

  const form = calls[0].body as FormData;
  assert.ok(form instanceof FormData);
  assert.equal(calls[0].path, '/api/v1/agents/create');
  assert.equal(form.get('name'), 'My agent');
  assert.equal(form.get('system_prompt'), 'be nice');
  assert.equal(form.get('model_name'), 'gpt-4.1');
  assert.equal(form.get('enabled_tools'), '{"web_search":true}');
  assert.equal(form.get('default_models'), '{"image":"gpt-image-1"}');
});

test('agents.update uses the numeric id path segment', async () => {
  const { client, calls } = mockClient(() => ({}));

  await new AgentsResource(client).update(15, { name: 'renamed' });

  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].path, '/api/v1/agents/update/15');
  assert.deepEqual(calls[0].body, { id: 15, name: 'renamed' });
});

test('agents.deleteFiles sends the {file_ids} body', async () => {
  const { client, calls } = mockClient(() => ({}));

  await new AgentsResource(client).deleteFiles('agent-1', ['f1', 'f2']);

  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].path, '/api/v1/agents/files/delete/agent-1');
  assert.deepEqual(calls[0].body, { file_ids: ['f1', 'f2'] });
});

test('all eight agent tools are registered and reject unknown arguments', () => {
  const names = [
    'list-agents',
    'get-agent',
    'create-agent',
    'update-agent',
    'delete-agent',
    'list-agent-files',
    'add-agent-files',
    'delete-agent-files',
  ];
  for (const name of names) {
    const t = tool(name);
    assert.equal(t.inputSchema.additionalProperties, false, `${name} must not allow extra args`);
  }
  const required: Record<string, string[]> = {
    'get-agent': ['agent_id'],
    'create-agent': ['name', 'system_prompt', 'model_name'],
    'update-agent': ['agent_id'],
    'delete-agent': ['agent_id'],
    'list-agent-files': ['agent_id'],
    'add-agent-files': ['agent_id', 'files'],
    'delete-agent-files': ['agent_id', 'file_ids'],
  };
  for (const [name, keys] of Object.entries(required)) {
    const t = tool(name);
    const schema = t.inputSchema as { required?: string[] };
    assert.deepEqual([...(schema.required ?? [])].sort(), [...keys].sort(), `${name} required args`);
  }
});

test('create-agent rejects a blank name before touching the network', async () => {
  const t = tool('create-agent');
  const ctx = {
    syntx: {
      agents: {
        create: async () => {
          throw new Error('must not be called');
        },
      },
    },
  } as unknown as McpContext;
  const res = await t.handler({ name: '  ', system_prompt: 'x', model_name: 'y' }, ctx);
  assert.equal(res.isError, true);
  assert.match(JSON.stringify(res.content), /name/);
});

test('get-llm-reset-price is registered and reads GET /api/v1/llm/limits/reset/price', async () => {
  const t = tool('get-llm-reset-price');
  assert.equal(t.inputSchema.additionalProperties, false);

  const { client, calls } = mockClient(() => ({
    plan: 'pro',
    window_6h: null,
    window_7d: { window: '7d', available: true, price_tokens: 72, used_percent: 34.2, reason: null },
  }));

  const out = await new LlmResource(client).getResetPrice();
  assert.equal(calls[0].path, '/api/v1/llm/limits/reset/price');
  assert.equal(out.plan, 'pro');
  assert.equal(out.window_6h, null);
  assert.equal(out.window_7d?.price_tokens, 72);
});

// ─── H1 — path-input policy on `add-agent-files` ───────────────────────────

test('add-agent-files declares the localFileRead capability', () => {
  const t = tool('add-agent-files');
  assert.equal(t.capability?.localFileRead, true);
});

test('add-agent-files rejects a `path` input over the HTTP transport', async () => {
  const t = tool('add-agent-files');
  const ctx = {
    syntx: {
      agents: {
        addFiles: async () => {
          throw new Error('must not be called');
        },
      },
    },
    config: { transport: 'http' },
  } as unknown as McpContext;

  const res = await t.handler(
    { agent_id: 'a1', files: [{ path: '/etc/passwd' }] },
    ctx,
  );
  assert.equal(res.isError, true);
  assert.match(
    (res.content[0] as { text: string }).text,
    /not permitted over the HTTP transport/,
  );
});

test('add-agent-files rejects a `path` outside the allow-listed roots', async () => {
  const t = tool('add-agent-files');
  const ctx = {
    syntx: {
      agents: {
        addFiles: async () => {
          throw new Error('must not be called');
        },
      },
    },
    config: { transport: 'stdio' },
  } as unknown as McpContext;

  const res = await t.handler(
    { agent_id: 'a1', files: [{ path: '/etc/passwd' }] },
    ctx,
  );
  assert.equal(res.isError, true);
  assert.match(
    (res.content[0] as { text: string }).text,
    /outside of allowed roots|File not found/,
  );
});
