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
