import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { allTools } from '../src/mcp/tools';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readDoc(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

/**
 * Extract tool-table row names (`| `tool-name` | …`) between two headings.
 * Inline mentions in Notes columns never match — the regex anchors on the
 * row start, right after the leading table pipe.
 */
function toolRowsInSpan(doc: string, startHeading: string, endHeading: string): string[] {
  const start = doc.indexOf(startHeading);
  assert.ok(start !== -1, `heading not found: ${startHeading}`);
  const rest = doc.slice(start + startHeading.length);
  const end = rest.indexOf(endHeading);
  const span = end === -1 ? rest : rest.slice(0, end);
  const names = [...span.matchAll(/^\| `([a-z0-9-]+)`/gm)].map((m) => m[1]);
  assert.ok(names.length > 0, `no tool rows found between ${startHeading} and ${endHeading}`);
  return [...new Set(names)].sort();
}

test('allTools exposes exactly 38 tools', () => {
  assert.equal(allTools.length, 38);
});

test('all tool names are unique', () => {
  const names = allTools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('README tool tables match allTools exactly (no ghosts, none missing)', () => {
  const rows = toolRowsInSpan(readDoc('README.md'), '## Инструменты (Tools)', '## Безопасность');
  const expected = allTools.map((t) => t.name).sort();
  assert.deepEqual(rows, expected);
});

test('SKILL.md tool tables match allTools exactly (no ghosts, none missing)', () => {
  const rows = toolRowsInSpan(
    readDoc(join('skills', 'syntx-ai-mcp-usage', 'SKILL.md')),
    '### Auth',
    '## Model identifier quirks',
  );
  const expected = allTools.map((t) => t.name).sort();
  assert.deepEqual(rows, expected);
});
