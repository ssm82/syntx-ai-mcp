import { test } from 'node:test';
import assert from 'node:assert/strict';

import { logSecurityEvent } from '../src/mcp/security-log';

function captureStderr(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  // Cast through `unknown` because the signature accepts more args than we use.
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    writes.push(s);
    return true;
  };
  return {
    writes,
    restore: () => {
      (process.stderr as unknown as { write: typeof original }).write = original;
    },
  };
}

test('logSecurityEvent writes one-line JSON to stderr', () => {
  const cap = captureStderr();
  try {
    logSecurityEvent({
      kind: 'transport.host.rejected',
      transport: 'http',
      clientAddr: '127.0.0.1',
      reason: 'host-not-allowed',
    });
    assert.equal(cap.writes.length, 1);
    const line = cap.writes[0].replace(/\n$/, '');
    const parsed = JSON.parse(line);
    assert.equal(parsed.kind, 'transport.host.rejected');
    assert.equal(parsed.transport, 'http');
    assert.equal(parsed.clientAddr, '127.0.0.1');
    assert.equal(parsed.reason, 'host-not-allowed');
    assert.equal(parsed.component, 'syntx-mcp');
    assert.ok(typeof parsed.ts === 'string');
  } finally {
    cap.restore();
  }
});

test('logSecurityEvent strips unrecognised meta keys', () => {
  const cap = captureStderr();
  try {
    logSecurityEvent({
      kind: 'upload-files.path.rejected',
      transport: 'http',
      meta: {
        tool: 'upload-files',
        // Not in allow-list — must be stripped.
        secret_token: 'leak',
      } as Record<string, string>,
    });
    const parsed = JSON.parse(cap.writes[0]);
    assert.equal(parsed.meta?.tool, 'upload-files');
    assert.equal(parsed.meta?.secret_token, undefined);
  } finally {
    cap.restore();
  }
});

test('logSecurityEvent never throws on weird input', () => {
  const cap = captureStderr();
  try {
    assert.doesNotThrow(() =>
      logSecurityEvent({
        kind: 'transport.body.too_large',
        transport: 'http',
        reason: 'x'.repeat(10_000),
        meta: { limitBytes: -1 } as unknown as Record<string, string | number | boolean>,
      }),
    );
  } finally {
    cap.restore();
  }
});
