import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wrapSdk } from '../src/mcp/tools/_helpers';
import { SyntxTimeoutError } from '../src/errors';
import type { McpContext } from '../src/mcp/registry';

/**
 * wrapSdk should preserve the SyntxTimeoutError.chatId recovery hint when an
 * SDK call rejects with a structured timeout. The hint is rendered by
 * `toMcpError` — `wrapSdk` is the only call path that funnels SDK errors
 * through that helper for the Class A CRUD tools, so a regression here would
 * silently break the recovery hint for every wrapped tool.
 */
test('wrapSdk preserves chatId recovery hint on SyntxTimeoutError', async () => {
  const ctx = {} as McpContext;
  const handler = wrapSdk('demo-tool', async () => {
    throw new SyntxTimeoutError('demo timeout', 'chat-recover-42', 61000, 60000);
  });
  const result = await handler({}, ctx);
  assert.equal(result.isError, true);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /tool:demo-tool: demo timeout/);
  assert.match(text, /61000 ms of 60000 ms/);
  assert.match(text, /get-messages\(chat_id="chat-recover-42"\)/);
  assert.match(text, /wait-for-response\(chat_id="chat-recover-42"\)/);
  assert.match(text, /Do NOT re-send the prompt/);
});

test('wrapSdk preserves chatId recovery hint when the timeout carries no chatId', async () => {
  const ctx = {} as McpContext;
  const handler = wrapSdk('no-chat', async () => {
    throw new SyntxTimeoutError('bare timeout', undefined, 1000, 500);
  });
  const result = await handler({}, ctx);
  assert.equal(result.isError, true);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.match(text, /tool:no-chat: bare timeout/);
  assert.match(text, /1000 ms of 500 ms/);
  // No chatId → no recovery hint line.
  assert.doesNotMatch(text, /get-messages\(chat_id=/);
  assert.doesNotMatch(text, /Do NOT re-send the prompt/);
});

test('wrapSdk JSON-stringifies the SDK payload verbatim on success', async () => {
  const ctx = {} as McpContext;
  const handler = wrapSdk('echo', async (_args, _ctx) => ({ hello: 'world', n: 7 }));
  const result = await handler({}, ctx);
  assert.equal(result.isError, undefined);
  const text = (result.content[0] as { type: 'text'; text: string }).text;
  assert.deepEqual(JSON.parse(text), { hello: 'world', n: 7 });
});
