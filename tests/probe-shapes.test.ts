import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = join(repoRoot, 'tests', 'fixtures', 'probe-shapes.snapshot.json');

interface NestedShape {
  [path: string]: string;
}
interface EndpointShape {
  path: string;
  method: string;
  response_top_level_keys: string[];
  response_nested_keys: NestedShape;
  note?: string;
}
interface ShapeSnapshot {
  captured_at: string;
  schema_version: number;
  endpoints: Record<string, EndpointShape>;
  notes: string;
}

function load(): ShapeSnapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as ShapeSnapshot;
}

test('probe-shapes snapshot is structurally valid', () => {
  const s = load();
  assert.equal(s.schema_version, 1);
  assert.ok(typeof s.captured_at === 'string');
  assert.ok(!Number.isNaN(Date.parse(s.captured_at)), `captured_at not parseable: ${s.captured_at}`);
  assert.ok(Date.parse(s.captured_at) <= Date.now());
  const entries = Object.entries(s.endpoints);
  assert.ok(entries.length > 0, 'snapshot has no endpoints');
  for (const [toolName, shape] of entries) {
    assert.ok(shape.path.startsWith('GET '), `${toolName} path is not a GET`);
    assert.ok(Array.isArray(shape.response_top_level_keys), `${toolName} top_level_keys not array`);
    for (const key of shape.response_top_level_keys) {
      assert.equal(typeof key, 'string');
      assert.ok(key.length > 0);
    }
    assert.ok(typeof shape.response_nested_keys === 'object');
  }
});

test('probe-shapes nested keys only reference declared top-level keys', () => {
  const s = load();
  for (const [toolName, shape] of Object.entries(s.endpoints)) {
    for (const nested of Object.keys(shape.response_nested_keys)) {
      const top = nested.split('.')[0];
      if (shape.response_top_level_keys.length === 0) {
        assert.fail(`${toolName}: nested key ${nested} but top_level is empty (array root)`);
      }
      assert.ok(
        shape.response_top_level_keys.includes(top),
        `${toolName}: nested ${nested} but ${top} not in top_level`,
      );
    }
  }
});

test('PROBE_SHAPES_LIVE=1 — call each endpoint and compare top-level keys', async (t) => {
  if (process.env.PROBE_SHAPES_LIVE !== '1') {
    t.skip('PROBE_SHAPES_LIVE not set; default run is structural-only.');
    return;
  }
  const token = process.env.SYNTX_TOKEN;
  assert.ok(token, 'PROBE_SHAPES_LIVE=1 requires SYNTX_TOKEN');

  const base = (process.env.SYNTX_API_BASE_URL ?? 'https://api.syntx.ai').replace(/\/$/, '');
  const s = load();
  for (const [toolName, shape] of Object.entries(s.endpoints)) {
    const url = `${base}${shape.path.replace(/^GET\s+/, '').replace('{address}', 'text')}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    assert.ok(res.ok, `${toolName}: ${url} returned ${res.status}`);
    const body: unknown = await res.json();
    const actualKeys = Array.isArray(body)
      ? []
      : Object.keys(body as Record<string, unknown>).sort();
    const expectedKeys = [...shape.response_top_level_keys].sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `${toolName}: top-level keys drift\n  expected ${JSON.stringify(expectedKeys)}\n  actual   ${JSON.stringify(actualKeys)}`,
    );
  }
});