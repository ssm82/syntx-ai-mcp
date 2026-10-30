import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = join(repoRoot, 'tests', 'fixtures', 'probe-enums.snapshot.json');

interface CaptchaActions {
  [route: string]: string;
}
interface Snapshot {
  captured_at: string;
  schema_version: number;
  ai_services: { count: number; by_scope: Record<string, string[]> };
  llm_models_count: number;
  ai_models_count: number;
  ai_models_with_get_cost_params: number;
  enums: {
    plans_tariffs_period: string[];
    ref_list_filter: string[];
    chats_scope: string[];
    message_direction: string[];
    captcha_actions: CaptchaActions;
  };
  notes: string;
}

function load(): Snapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
}

test('probe-enums snapshot is structurally valid', () => {
  const s = load();
  assert.equal(s.schema_version, 1, 'schema_version must be 1');
  assert.ok(typeof s.captured_at === 'string' && s.captured_at.length > 0, 'captured_at required');
  assert.ok(!Number.isNaN(Date.parse(s.captured_at)), `captured_at not parseable: ${s.captured_at}`);
  assert.ok(Date.parse(s.captured_at) <= Date.now(), 'captured_at is in the future');
  assert.equal(typeof s.ai_services.count, 'number');
  assert.ok(s.ai_services.count > 0, 'ai_services.count must be positive');
  assert.equal(typeof s.llm_models_count, 'number');
  assert.ok(s.llm_models_count > 0, 'llm_models_count must be positive');
  assert.equal(typeof s.ai_models_count, 'number');
  assert.ok(s.ai_models_count > 0, 'ai_models_count must be positive');
  for (const scope of Object.keys(s.ai_services.by_scope)) {
    assert.ok(Array.isArray(s.ai_services.by_scope[scope]), `by_scope.${scope} not array`);
    for (const name of s.ai_services.by_scope[scope]) {
      assert.equal(typeof name, 'string', `by_scope.${scope} contains non-string: ${name}`);
    }
  }
});

test('probe-enums enum strings are non-empty and unique', () => {
  const s = load();
  const sets = [
    ['plans_tariffs_period', s.enums.plans_tariffs_period],
    ['ref_list_filter', s.enums.ref_list_filter],
    ['chats_scope', s.enums.chats_scope],
    ['message_direction', s.enums.message_direction],
  ] as const;
  for (const [name, arr] of sets) {
    assert.ok(arr.length > 0, `${name} is empty`);
    assert.equal(arr.length, new Set(arr).size, `${name} contains duplicates`);
    for (const v of arr) assert.ok(v.length > 0, `${name} contains empty value`);
  }
});

test('probe-enums captcha actions cover the SPA gate table', () => {
  const s = load();
  const routes = Object.keys(s.enums.captcha_actions);
  for (const required of [
    'auth/email/send-otp',
    'design/generate',
    'video/generate',
    'audio/generate',
    'llm/generate',
  ]) {
    assert.ok(routes.includes(required), `captcha_actions missing ${required}`);
  }
  for (const [, action] of Object.entries(s.enums.captcha_actions)) {
    assert.ok(action === 'register' || action === 'generate', `unexpected action: ${action}`);
  }
});