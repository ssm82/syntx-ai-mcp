import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SyntxWebSocket } from '../src/websocket';

test('SyntxWebSocket.buildUrl does NOT include token in query string (H3)', () => {
  const ws = new SyntxWebSocket({ token: 'super-secret-token', lang: 'en' });
  // Force-build the URL via a public-ish path: we use the fact that
  // `currentEndpoint` is null until `connect` runs, so we go through a
  // a private helper exported for tests is not available — exercise
  // `buildUrl` indirectly via `createSession`, which auto-connects.
  //
  // Instead, we snapshot the URL the moment `connect` is invoked. We can't
  // actually open a socket (no server), but we can intercept the WebSocket
  // constructor by monkey-patching the global.
  const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  let capturedUrl: string | null = null;
  let capturedInit: unknown = null;
  class FakeWebSocket {
    readyState = 0; // CONNECTING
    constructor(url: string, init?: unknown) {
      capturedUrl = url;
      capturedInit = init;
    }
    close() {}
  }
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;

  try {
    const w = new SyntxWebSocket({ token: 'super-secret-token', lang: 'en' });
    w.connect('chats/stream');
    assert.ok(capturedUrl, 'WebSocket constructor must have been called');
    assert.ok(
      !capturedUrl!.includes('token='),
      `URL must not contain token= (got: ${capturedUrl})`,
    );
    assert.ok(
      !capturedUrl!.includes('super-secret-token'),
      `URL must not contain the raw bearer (got: ${capturedUrl})`,
    );
    // lang is a public, non-secret parameter and should be preserved.
    assert.match(capturedUrl!, /[?&]lang=en/);
    // Bearer travels in the Authorization header instead.
    assert.ok(capturedInit && typeof capturedInit === 'object');
    const initObj = capturedInit as { headers?: Record<string, string> };
    assert.equal(initObj.headers?.Authorization, 'Bearer super-secret-token');
  } finally {
    (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
  }
});
