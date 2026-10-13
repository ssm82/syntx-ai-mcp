import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { BaseClient, captchaActionFor } from '../src/client';
import { SyntxAPIError, SyntxAuthError, SyntxCaptchaRequiredError } from '../src/errors';

/**
 * S1 — syntx.ai gates every generative route behind Cloudflare Turnstile.
 * Before this change a 403 was collapsed into `SyntxAuthError`, so a solvable
 * challenge was indistinguishable from a dead token.
 */

/** The SPA's gate table (bundle `1791811899`, `$_e`), copied verbatim. */
const GATED: Array<[path: string, action: 'register' | 'generate']> = [
  ['/api/v1/auth/email/send-otp', 'register'],
  ['/api/v1/design/generate', 'generate'],
  ['/api/v1/video/generate', 'generate'],
  ['/api/v1/audio/generate', 'generate'],
  ['/api/v1/llm/generate', 'generate'],
  ['/api/v1/prompt-enhancer/enhance/start', 'generate'],
];

const NOT_GATED = [
  '/api/v1/chats',
  '/api/v1/design/editor',
  '/api/v1/design/flux/tool',
  '/api/v1/ai/models',
  '/api/v1/llm/limits',
  '/api/v1/llm/models',
  '/api/v1/auth/identities',
  '/api/v1/prompt-enhancer/cost',
];

interface Recorded {
  path: string;
  token: string | undefined;
  widget: string | undefined;
}

/**
 * Spin a single-use script server. `script` is consumed one entry per
 * request; the last entry repeats so a test can assert "no more calls".
 */
function serve(
  script: Array<{ status: number; body: unknown }>,
): Promise<{ baseURL: string; seen: Recorded[]; close: () => Promise<void> }> {
  const seen: Recorded[] = [];
  let cursor = 0;
  const server = http.createServer((req, res) => {
    seen.push({
      path: req.url ?? '',
      token: (req.headers['x-captcha-token'] as string | undefined) ?? undefined,
      widget: (req.headers['x-captcha-widget'] as string | undefined) ?? undefined,
    });
    const step = script[Math.min(cursor, script.length - 1)];
    cursor += 1;
    res.writeHead(step.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(step.body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseURL: `http://127.0.0.1:${port}`,
        seen,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const INTERACTIVE_CHALLENGE = {
  detail: {
    reason: 'interactive_required',
    action: 'generate',
    sitekey: '0x4AAAAAAESlfXNPLR7obroN',
    interactiveAction: 'generate',
    interactiveSitekey: '0x4AAAAAAESlfXNPLR7obroN',
  },
};

// ── route table ─────────────────────────────────────────────────────────────

test('captchaActionFor mirrors the SPA gate table for every gated route', () => {
  for (const [path, action] of GATED) {
    assert.equal(captchaActionFor(path), action, path);
  }
});

test('captchaActionFor is inert on ungated routes', () => {
  for (const path of NOT_GATED) {
    assert.equal(captchaActionFor(path), null, path);
  }
});

test('captchaActionFor tolerates query strings and v2 mounts', () => {
  assert.equal(captchaActionFor('/api/v1/llm/generate?ai_name=chatgpt'), 'generate');
  assert.equal(captchaActionFor('llm/generate'), 'generate');
  assert.equal(captchaActionFor('/api/v2/llm/generate'), 'generate');
});

// ── error classification ────────────────────────────────────────────────────

test('a Turnstile 403 raises SyntxCaptchaRequiredError, not SyntxAuthError', async () => {
  const s = await serve([{ status: 403, body: INTERACTIVE_CHALLENGE }]);
  try {
    const client = new BaseClient({ baseURL: s.baseURL, token: 't' });
    await assert.rejects(
      () => client.post('/api/v1/llm/generate', { text: 'hi', model: 'gpt-5.6-luna' }),
      (err: unknown) => {
        assert.ok(err instanceof SyntxCaptchaRequiredError);
        assert.ok(!(err instanceof SyntxAuthError));
        assert.equal((err as SyntxCaptchaRequiredError).status, 403);
        assert.equal((err as SyntxCaptchaRequiredError).reason, 'interactive_required');
        assert.equal((err as SyntxCaptchaRequiredError).action, 'generate');
        assert.equal((err as SyntxCaptchaRequiredError).retryable, true);
        // Still an API error, so existing catch sites keep working.
        assert.ok(err instanceof SyntxAPIError);
        return true;
      },
    );
  } finally {
    await s.close();
  }
});

test('a real 403 credential rejection is still SyntxAuthError', async () => {
  const s = await serve([{ status: 403, body: { detail: 'Not authenticated' } }]);
  try {
    const client = new BaseClient({ baseURL: s.baseURL, token: 't' });
    await assert.rejects(
      () => client.post('/api/v1/llm/generate', { text: 'hi' }),
      (err: unknown) => err instanceof SyntxAuthError && !(err instanceof SyntxCaptchaRequiredError),
    );
  } finally {
    await s.close();
  }
});

test('401 stays an auth error', async () => {
  const s = await serve([{ status: 401, body: { detail: 'Not authenticated' } }]);
  try {
    const client = new BaseClient({ baseURL: s.baseURL, token: 't' });
    await assert.rejects(() => client.get('/api/v1/chats'), SyntxAuthError);
  } finally {
    await s.close();
  }
});

test('terminal challenge reasons are marked non-retryable', async () => {
  const s = await serve([
    {
      status: 403,
      body: { detail: { reason: 'action_mismatch', action: 'generate', sitekey: 'k' } },
    },
  ]);
  try {
    const client = new BaseClient({
      baseURL: s.baseURL,
      token: 't',
      captchaProvider: () => 'token',
    });
    await assert.rejects(
      () => client.post('/api/v1/llm/generate', { text: 'hi' }),
      (err: unknown) => {
        assert.ok(err instanceof SyntxCaptchaRequiredError);
        assert.equal((err as SyntxCaptchaRequiredError).retryable, false);
        return true;
      },
    );
    // The proactive mint is just a header on the first request, so a terminal
    // reason must not add a second one.
    assert.equal(s.seen.length, 1);
    assert.equal(s.seen[0].token, 'token');
  } finally {
    await s.close();
  }
});

// ── provider wiring ─────────────────────────────────────────────────────────

test('a proactive token is attached only to gated routes', async () => {
  const s = await serve([{ status: 200, body: { ok: true } }]);
  const calls: string[] = [];
  try {
    const client = new BaseClient({
      baseURL: s.baseURL,
      token: 't',
      captchaProvider: (req) => {
        calls.push(req.action);
        return `tok-${req.action}`;
      },
    });
    await client.post('/api/v1/llm/generate', { text: 'hi' });
    await client.get('/api/v1/chats');
    await client.post('/api/v1/design/editor', {});

    assert.deepEqual(calls, ['generate'], 'provider must not fire on ungated routes');
    assert.equal(s.seen[0].token, 'tok-generate');
    assert.equal(s.seen[0].widget, undefined, 'proactive mint is silent, never interactive');
    assert.equal(s.seen[1].token, undefined);
    assert.equal(s.seen[2].token, undefined);
  } finally {
    await s.close();
  }
});

test('an interactive challenge is replayed exactly once with the widget header', async () => {
  const s = await serve([
    { status: 403, body: INTERACTIVE_CHALLENGE },
    { status: 200, body: { ok: true } },
  ]);
  const seen: boolean[] = [];
  try {
    const client = new BaseClient({
      baseURL: s.baseURL,
      token: 't',
      captchaProvider: (req) => {
        seen.push(req.interactive);
        return req.interactive ? 'interactive-token' : 'silent-token';
      },
    });
    const out = await client.post('/api/v1/llm/generate', { text: 'hi' });
    assert.deepEqual(out, { ok: true });

    assert.deepEqual(seen, [false, true], 'silent mint first, interactive on replay');
    assert.equal(s.seen.length, 2);
    assert.equal(s.seen[0].token, 'silent-token');
    assert.equal(s.seen[0].widget, undefined);
    assert.equal(s.seen[1].token, 'interactive-token');
    assert.equal(s.seen[1].widget, 'interactive');
  } finally {
    await s.close();
  }
});

test('a silent challenge replays without the interactive widget header', async () => {
  const s = await serve([
    { status: 403, body: { detail: { reason: 'captcha_failed', action: 'generate', sitekey: 'k' } } },
    { status: 200, body: { ok: true } },
  ]);
  try {
    const client = new BaseClient({
      baseURL: s.baseURL,
      token: 't',
      captchaProvider: () => 'tok',
    });
    await client.post('/api/v1/llm/generate', { text: 'hi' });
    assert.equal(s.seen.length, 2);
    assert.equal(s.seen[1].widget, undefined);
    assert.equal(s.seen[1].token, 'tok');
  } finally {
    await s.close();
  }
});

test('a provider that declines leaves the original challenge intact', async () => {
  const s = await serve([{ status: 403, body: INTERACTIVE_CHALLENGE }]);
  try {
    const client = new BaseClient({
      baseURL: s.baseURL,
      token: 't',
      captchaProvider: () => undefined,
    });
    await assert.rejects(
      () => client.post('/api/v1/llm/generate', { text: 'hi' }),
      SyntxCaptchaRequiredError,
    );
    assert.equal(s.seen.length, 1, 'no replay when the provider declines');
  } finally {
    await s.close();
  }
});

test('a throwing provider degrades to the challenge, never to a crash', async () => {
  const s = await serve([{ status: 403, body: INTERACTIVE_CHALLENGE }]);
  try {
    const client = new BaseClient({
      baseURL: s.baseURL,
      token: 't',
      captchaProvider: () => {
        throw new Error('browser not available');
      },
    });
    await assert.rejects(
      () => client.post('/api/v1/llm/generate', { text: 'hi' }),
      SyntxCaptchaRequiredError,
    );
    assert.equal(s.seen.length, 1);
  } finally {
    await s.close();
  }
});

test('the client never solves a challenge on its own', async () => {
  const s = await serve([{ status: 403, body: INTERACTIVE_CHALLENGE }]);
  try {
    // No provider configured at all — the SDK must attempt nothing extra.
    const client = new BaseClient({ baseURL: s.baseURL, token: 't' });
    await assert.rejects(
      () => client.post('/api/v1/llm/generate', { text: 'hi' }),
      SyntxCaptchaRequiredError,
    );
    assert.equal(s.seen.length, 1);
    assert.equal(s.seen[0].token, undefined);
  } finally {
    await s.close();
  }
});

test('the captcha replay is bounded to one extra request', async () => {
  // Server challenges forever: the client must give up after one replay.
  const s = await serve([{ status: 403, body: INTERACTIVE_CHALLENGE }]);
  try {
    const client = new BaseClient({
      baseURL: s.baseURL,
      token: 't',
      captchaProvider: () => 'tok',
    });
    await assert.rejects(
      () => client.post('/api/v1/llm/generate', { text: 'hi' }),
      SyntxCaptchaRequiredError,
    );
    assert.equal(s.seen.length, 2, 'proactive + one replay, never more');
  } finally {
    await s.close();
  }
});