import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authTools } from '../src/mcp/tools/auth';
import type { McpContext } from '../src/mcp/registry';

function makeContext(
  transport: 'stdio' | 'http',
  overrides: Partial<{ setTokenCalls: string[]; verifyEmail: unknown; pollTelegram: unknown }> = {},
): { ctx: McpContext; setTokenCalls: string[] } {
  const setTokenCalls: string[] = [];
  const ctx = {
    syntx: {
      auth: {
        isAuthenticated: () => false,
        verifyEmailOtp: overrides.verifyEmail ?? (async () => ({ token: 'jwt-fake' })),
        pollAuthToken: overrides.pollTelegram ?? (async () => ({ valid: true, complete: true, token: 'jwt-fake' })),
        loginWithTelegram: async () => ({
          uuid: 'u',
          deepLink: 'https://t.me/syntxaibot?start=auth_u',
          elapsedMs: 1,
        }),
        startAuth: async () => ({ uuid: 'u' }),
        getTelegramAuthLink: (uuid: string, bot: string) =>
          `https://t.me/${bot}?start=auth_${uuid}`,
      },
    },
    config: {
      baseURL: 'https://api.syntx.ai',
      lang: 'en',
      defaultAI: 'chatgpt',
      pollInterval: 5000,
      pollTimeout: 600000,
      transport,
      httpPort: 3000,
      httpHostname: '127.0.0.1',
      httpToken: undefined,
      streamMode: 'auto',
      wsURL: 'wss://api.syntx.ai/api/v1',
    },
    setToken: (token: string) => {
      setTokenCalls.push(token);
    },
    setDefaultModel: () => {},
    setDefaultAI: () => {},
  } as unknown as McpContext;
  return { ctx, setTokenCalls };
}

function findTool(name: string) {
  const t = authTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} missing`);
  return t;
}

test('set-token: succeeds on stdio', async () => {
  const { ctx, setTokenCalls } = makeContext('stdio');
  const r = await findTool('set-token').handler({ token: 't1' }, ctx);
  assert.equal(r.isError, undefined);
  assert.deepEqual(setTokenCalls, ['t1']);
});

test('set-token: rejected on http', async () => {
  const { ctx, setTokenCalls } = makeContext('http');
  const r = await findTool('set-token').handler({ token: 't1' }, ctx);
  assert.equal(r.isError, true);
  assert.match((r.content[0] as { text: string }).text, /not permitted over the http transport/i);
  assert.equal(setTokenCalls.length, 0, 'setToken must NOT be invoked on http');
});

test('verify-email-otp install_token=true: rejected on http', async () => {
  const { ctx } = makeContext('http');
  const r = await findTool('verify-email-otp').handler(
    { email: 'a@b.c', otp_code: '0000', install_token: true },
    ctx,
  );
  assert.equal(r.isError, true);
  assert.match((r.content[0] as { text: string }).text, /not permitted over the http transport/i);
});

test('verify-email-otp install_token=true: succeeds on stdio', async () => {
  const { ctx } = makeContext('stdio');
  const r = await findTool('verify-email-otp').handler(
    { email: 'a@b.c', otp_code: '0000', install_token: true },
    ctx,
  );
  assert.equal(r.isError, undefined);
});

test('verify-email-otp install_token=false: allowed on http (read-only)', async () => {
  const { ctx } = makeContext('http');
  const r = await findTool('verify-email-otp').handler(
    { email: 'a@b.c', otp_code: '0000', install_token: false },
    ctx,
  );
  assert.equal(r.isError, undefined);
  const text = (r.content[0] as { text: string }).text;
  assert.match(text, /"token_installed": false/);
});

test('poll-telegram-auth install_token=true: rejected on http', async () => {
  const { ctx } = makeContext('http');
  const r = await findTool('poll-telegram-auth').handler(
    { uuid: 'abc', install_token: true },
    ctx,
  );
  assert.equal(r.isError, true);
  assert.match((r.content[0] as { text: string }).text, /not permitted over the http transport/i);
});

test('poll-telegram-auth install_token=false: allowed on http (peek)', async () => {
  const { ctx } = makeContext('http');
  const r = await findTool('poll-telegram-auth').handler(
    { uuid: 'abc', install_token: false },
    ctx,
  );
  assert.equal(r.isError, undefined);
});

test('login-telegram: rejected on http (always installs)', async () => {
  const { ctx } = makeContext('http');
  const r = await findTool('login-telegram').handler({}, ctx);
  // login-telegram returns a JSON success-with-error envelope, not isError,
  // but on http we want the guard to surface a clear rejection.
  assert.equal(r.isError, true);
  assert.match((r.content[0] as { text: string }).text, /not permitted over the http transport/i);
});

test('start-telegram-auth: NOT blocked (does not mutate auth state)', async () => {
  // start-telegram-auth creates a session and returns a deep-link — it does
  // NOT install a token, so the H4 invariant does not apply.
  const { ctx } = makeContext('http');
  const r = await findTool('start-telegram-auth').handler({}, ctx);
  assert.equal(r.isError, undefined);
});
