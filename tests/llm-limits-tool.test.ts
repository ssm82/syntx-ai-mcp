import { test } from 'node:test';
import assert from 'node:assert/strict';

import { llmTools } from '../src/mcp/tools/llm';

function createMockSyntx(overrides: Partial<{ llm: Record<string, unknown> }> = {}) {
  return {
    llm: {
      getLimits: overrides.llm?.getLimits,
    },
  } as unknown as import('../src/syntx-client').SyntxClient;
}

function makeContext(syntx: import('../src/syntx-client').SyntxClient) {
  return {
    syntx,
    config: {
      baseURL: 'https://api.syntx.ai',
      lang: 'en',
      defaultAI: 'chatgpt',
      defaultModel: null,
      pollInterval: 5000,
      pollTimeout: 600000,
      transport: 'stdio' as const,
      httpPort: 3000,
      httpHostname: '127.0.0.1',
      httpToken: undefined,
      streamMode: 'auto' as const,
      wsURL: 'wss://api.syntx.ai/api/v1',
    },
    setToken: () => {},
    setDefaultModel: () => {},
    setDefaultAI: () => {},
  } as unknown as import('../src/mcp/registry').McpContext;
}

test('get-llm-limits tool is registered', () => {
  const tool = llmTools.find((t) => t.name === 'get-llm-limits');
  assert.ok(tool, 'get-llm-limits tool must be registered');
  assert.match(tool!.description, /6h and 7d windows/);
  assert.match(tool!.description, /normalized to \{percent_left: 100/);
});

test('get-llm-limits tool returns the normalised SDK payload', async () => {
  const calls: Array<{ args: unknown }> = [];
  const syntx = createMockSyntx({
    llm: {
      getLimits: async () => {
        calls.push({ args: {} });
        return {
          window_6h: { percent_left: 42, started_at: null, expires_at: null },
          window_7d: { percent_left: 100, started_at: null, expires_at: null },
        };
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = llmTools.find((t) => t.name === 'get-llm-limits')!;

  const result = await tool.handler({}, ctx);

  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 1);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /"percent_left": 42/);
  assert.match(text, /"window_7d"/);
});

test('get-llm-limits tool surfaces SDK errors via toMcpError', async () => {
  const syntx = createMockSyntx({
    llm: {
      getLimits: async () => {
        throw new Error('boom');
      },
    },
  });
  const ctx = makeContext(syntx);
  const tool = llmTools.find((t) => t.name === 'get-llm-limits')!;

  const result = await tool.handler({}, ctx);

  assert.equal(result.isError, true);
  assert.match(
    (result.content[0] as { text: string }).text,
    /get-llm-limits: boom/,
  );
});
